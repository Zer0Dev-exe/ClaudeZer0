import fs from 'fs';
import os from 'os';
import path from 'path';

// Codex CLI guarda en cada sesión (~/.codex/sessions/AAAA/MM/DD/rollout-*.jsonl) los límites de la
// suscripción de ChatGPT que le informa el servidor. Leemos el último registro: es la cuota real.
const MAX_FILES = 8;
const TAIL_BYTES = 256 * 1024;

function sessionsDir() {
  return path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'sessions');
}

function recentRollouts(dir) {
  const files = [];
  const walk = (current, depth) => {
    let entries;
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && depth < 4) walk(full, depth + 1);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try { files.push({ full, mtime: fs.statSync(full).mtimeMs }); } catch { /* archivo en uso */ }
      }
    }
  };
  walk(dir, 0);
  return files.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_FILES);
}

function lastRateLimits(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const { size } = fs.fstatSync(fd);
    const length = Math.min(size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    const lines = buffer.toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      if (!lines[i].includes('"rate_limits"')) continue;
      try {
        const limits = JSON.parse(lines[i])?.payload?.rate_limits;
        if (limits?.primary || limits?.secondary) return limits;
      } catch { /* primera línea cortada por el tail */ }
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

function toWindow(w) {
  if (!w || typeof w.used_percent !== 'number') return null;
  return {
    percent: Math.max(0, Math.min(100, w.used_percent)),
    resetsAt: typeof w.resets_at === 'number' ? new Date(w.resets_at * 1000).toISOString() : null
  };
}

/** Última cuota de ChatGPT conocida, o { success: false } si Codex aún no la ha registrado. */
export function getCodexLimits(dir = sessionsDir()) {
  try {
    for (const { full, mtime } of recentRollouts(dir)) {
      const limits = lastRateLimits(full);
      if (!limits) continue;
      return {
        success: true,
        fetchedAt: new Date(mtime).toISOString(),
        plan: limits.plan_type || null,
        session: toWindow(limits.primary),
        weekly: toWindow(limits.secondary)
      };
    }
  } catch (err) {
    return { success: false, message: err.message };
  }
  return { success: false, message: 'Codex aún no ha registrado la cuota de ChatGPT. Aparecerá tras el próximo uso de Codex.' };
}
