import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);

async function readClaudeAccount() {
  const { getClaudeBinary } = await import('./claudeRunner.js');
  const binary = getClaudeBinary();
  const { stdout } = await execFileAsync(process.platform === 'win32' ? `"${binary}"` : binary, ['auth', 'status'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env },
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 65536,
    shell: process.platform === 'win32',
    windowsHide: true
  });
  const match = stdout.match(/\{[\s\S]*\}/);
  const account = match ? JSON.parse(match[0]) : null;
  return account?.loggedIn ? { email: account.email, name: account.name } : null;
}

export function createIdentityAccountLookup({ readAccount = readClaudeAccount, now = Date.now } = {}) {
  let cached = null;
  let expiresAt = 0;
  let pending = null;
  return async (user, mode) => {
    if (user?.role !== 'admin' || mode !== 'Hoster') return null;
    if (expiresAt > now()) return cached;
    if (pending) return pending;
    pending = Promise.resolve().then(readAccount).catch(() => null).then(account => {
      cached = account;
      expiresAt = now() + (account ? 300000 : 30000);
      return cached;
    }).finally(() => { pending = null; });
    return pending;
  };
}

export const getIdentityAccount = createIdentityAccountLookup();
