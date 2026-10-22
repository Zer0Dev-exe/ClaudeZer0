import crypto from 'node:crypto';

function clean(value, max = 120) {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function profileEmail(user, account = null, configured = null) {
  const ownEmail = clean(configured?.email || user?.email, 254).toLowerCase();
  const email = ownEmail || (user?.role === 'admin' ? clean(account?.email, 254).toLowerCase() : '');
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function createIdentityResolver({ fetchImpl = fetch, now = Date.now, timeoutMs = 2000 } = {}) {
  const cache = new Map();
  const pending = new Map();

  async function lookup(hash) {
    const cached = cache.get(hash);
    if (cached && cached.expiresAt > now()) return cached.profile;
    if (pending.has(hash)) return pending.get(hash);
    const request = (async () => {
      let profile = null;
      try {
        const response = await fetchImpl(`https://api.gravatar.com/v3/profiles/${hash}`, {
          signal: AbortSignal.timeout(timeoutMs), headers: { Accept: 'application/json' }, redirect: 'error'
        });
        if (response.ok) {
          const data = await response.json();
          const displayName = clean(data?.display_name);
          if (displayName) profile = { displayName };
        }
      } catch {}
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(hash, { profile, expiresAt: now() + (profile ? 3600000 : 300000) });
      return profile;
    })();
    pending.set(hash, request);
    try { return await request; } finally { pending.delete(hash); }
  }

  return async (user, { account = null, configured = null } = {}) => {
    const email = profileEmail(user, account, configured);
    const fallback = clean(configured?.displayName) || clean(account && user?.role === 'admin' ? account.name : null) || user.username;
    if (!email) return { username: user.username, displayName: fallback, avatarUrl: null, email: null, source: 'username' };
    const hash = crypto.createHash('sha256').update(email).digest('hex');
    const gravatar = await lookup(hash);
    return {
      username: user.username,
      displayName: clean(configured?.displayName) || gravatar?.displayName || fallback,
      avatarUrl: `https://www.gravatar.com/avatar/${hash}?s=96&d=404`,
      email,
      source: gravatar ? 'gravatar' : 'account'
    };
  };
}

export const resolveIdentityProfile = createIdentityResolver();
