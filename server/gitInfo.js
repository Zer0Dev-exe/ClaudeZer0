import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';

// Estado de git de una carpeta de trabajo, para el panel de cambios de la app de escritorio:
// rama y cambios sin guardar (diff contra HEAD, más los archivos nuevos sin seguimiento).

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_FILE_BYTES = 300 * 1024;
const MAX_UNTRACKED = 30;

function git(dir, args, { maxBuffer = 16 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile('git', ['-C', dir, ...args], { timeout: 20000, maxBuffer, encoding: 'utf-8' }, (err, stdout) => resolve(err ? null : stdout));
  });
}

/** Parte la salida de `git diff` en un archivo por bloque `diff --git` */
export function parseDiff(text) {
  const files = [];
  let current = null;
  for (const line of String(text || '').split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = line.match(/^diff --git a\/(.+) b\/(.+)$/);
      current = { path: m ? m[2] : line.slice(11), oldPath: m ? m[1] : null, status: 'M', additions: 0, deletions: 0, binary: false, patch: [] };
      files.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('new file mode')) current.status = 'A';
    else if (line.startsWith('deleted file mode')) current.status = 'D';
    else if (line.startsWith('rename from ')) current.status = 'R';
    else if (line.startsWith('Binary files ') || line.startsWith('GIT binary patch')) current.binary = true;
    else if (line.startsWith('@@')) current.inHunk = true;

    if (current.inHunk) {
      current.patch.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) current.additions++;
      else if (line.startsWith('-') && !line.startsWith('---')) current.deletions++;
    }
  }
  return files.map(({ inHunk, patch, ...f }) => ({ ...f, patch: patch.join('\n') }));
}

function untrackedPatch(rel, content) {
  const lines = content.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return { path: rel, oldPath: null, status: 'A', additions: lines.length, deletions: 0, binary: false, untracked: true,
    patch: `@@ -0,0 +1,${lines.length} @@\n${lines.map(l => `+${l}`).join('\n')}` };
}

/**
 * Cambios sin guardar de `dir`. { isRepo, branch, files: [{ path, status, additions, deletions, patch, ... }],
 * additions, deletions, truncated }
 */
export async function getGitChanges(dir) {
  if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return { isRepo: false, files: [], additions: 0, deletions: 0 };
  const top = await git(dir, ['rev-parse', '--show-toplevel']);
  if (top === null) return { isRepo: false, files: [], additions: 0, deletions: 0 };
  const root = top.trim();

  const branch = (await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']))?.trim() || null;
  const hasHead = branch !== null && branch !== 'HEAD' ? true : (await git(dir, ['rev-parse', '--verify', 'HEAD'])) !== null;
  const base = hasHead ? 'HEAD' : EMPTY_TREE;

  const tracked = parseDiff(await git(root, ['diff', base, '--no-color', '--no-ext-diff', '-U3', '--find-renames']));
  const names = (await git(root, ['ls-files', '--others', '--exclude-standard'])) || '';
  const files = [...tracked];
  for (const rel of names.split('\n').filter(Boolean).slice(0, MAX_UNTRACKED)) {
    try {
      const abs = path.join(root, rel);
      const stat = fs.statSync(abs);
      if (!stat.isFile() || stat.size > MAX_FILE_BYTES) {
        files.push({ path: rel, oldPath: null, status: 'A', additions: 0, deletions: 0, binary: true, untracked: true, patch: '' });
        continue;
      }
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) files.push({ path: rel, oldPath: null, status: 'A', additions: 0, deletions: 0, binary: true, untracked: true, patch: '' });
      else files.push(untrackedPatch(rel, buf.toString('utf-8')));
    } catch {
      // el archivo desapareció entre medias
    }
  }

  let total = 0;
  let truncated = false;
  for (const f of files) {
    if (f.patch.length > MAX_FILE_BYTES || total + f.patch.length > MAX_TOTAL_BYTES) {
      f.patch = '';
      f.tooLarge = true;
      truncated = true;
    }
    total += f.patch.length;
  }
  return {
    isRepo: true,
    root,
    branch: branch === 'HEAD' ? '(HEAD suelto)' : branch,
    files,
    additions: files.reduce((n, f) => n + f.additions, 0),
    deletions: files.reduce((n, f) => n + f.deletions, 0),
    truncated
  };
}

/** Solo rama y recuento de cambios (barato: sin patches) */
export async function getGitSummary(dir) {
  if (!dir || !fs.existsSync(dir)) return { isRepo: false };
  const branch = await git(dir, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (branch === null) return { isRepo: false };
  const root = ((await git(dir, ['rev-parse', '--show-toplevel'])) || dir).trim();
  const hasHead = (await git(dir, ['rev-parse', '--verify', 'HEAD'])) !== null;
  const stat = (await git(root, ['diff', hasHead ? 'HEAD' : EMPTY_TREE, '--shortstat'])) || '';
  const untracked = ((await git(root, ['ls-files', '--others', '--exclude-standard'])) || '').split('\n').filter(Boolean).slice(0, MAX_UNTRACKED);
  // Los archivos nuevos cuentan como líneas añadidas (igual que en el panel de cambios)
  let untrackedLines = 0;
  for (const rel of untracked) {
    try {
      const abs = path.join(root, rel);
      const st = fs.statSync(abs);
      if (!st.isFile() || st.size > MAX_FILE_BYTES) continue;
      const buf = fs.readFileSync(abs);
      if (!buf.includes(0)) untrackedLines += buf.toString('utf-8').split('\n').filter((l, i, a) => i < a.length - 1 || l !== '').length;
    } catch { /* desapareció */ }
  }
  const num = (re) => Number((stat.match(re) || [])[1] || 0);
  return {
    isRepo: true,
    branch: branch.trim(),
    changedFiles: num(/(\d+) files? changed/) + untracked.length,
    additions: num(/(\d+) insertions?/) + untrackedLines,
    deletions: num(/(\d+) deletions?/)
  };
}
