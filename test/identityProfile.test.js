import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createIdentityResolver, profileEmail } from '../server/identityProfile.js';

const admin = { username: 'owner', role: 'admin' };
const guest = { username: 'guest', role: 'user' };
const account = { email: ' PERSON@EXAMPLE.COM ' };

test('profileEmail normaliza el correo propio y no comparte la identidad del anfitrión', () => {
  assert.equal(profileEmail(admin, account), 'person@example.com');
  assert.equal(profileEmail(guest, account), null);
  assert.equal(profileEmail(guest, account, { email: 'guest@example.com' }), 'guest@example.com');
  assert.equal(profileEmail(admin, { email: 'not-an-email' }), null);
});

test('perfil sin correo no llama a Gravatar y conserva el usuario', async () => {
  const resolver = createIdentityResolver({ fetchImpl: () => assert.fail('No debe consultar la red') });
  const profile = await resolver(guest, { account });
  assert.equal(profile.displayName, 'guest');
  assert.equal(profile.avatarUrl, null);
  assert.equal(profile.email, null);
});

test('Gravatar usa SHA256 y el nombre público, sin enviar el correo en claro', async () => {
  const hash = crypto.createHash('sha256').update('person@example.com').digest('hex');
  const resolver = createIdentityResolver({ fetchImpl: async (url, options) => {
    assert.equal(url, `https://api.gravatar.com/v3/profiles/${hash}`);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    return new Response(JSON.stringify({ display_name: '  Nombre público  ', avatar_url: 'https://untrusted.example/avatar' }));
  } });
  const profile = await resolver(admin, { account });
  assert.equal(profile.displayName, 'Nombre público');
  assert.equal(profile.source, 'gravatar');
  assert.equal(profile.avatarUrl, `https://www.gravatar.com/avatar/${hash}?s=96&d=404`);
});

test('caché global entre dispositivos y deduplicación de consultas', async () => {
  let calls = 0;
  const resolver = createIdentityResolver({ fetchImpl: async () => {
    calls++;
    return new Response(JSON.stringify({ display_name: 'Perfil global' }));
  } });
  const [first, second] = await Promise.all([resolver(admin, { account }), resolver(admin, { account })]);
  assert.deepEqual(first, second);
  await resolver(admin, { account });
  assert.equal(calls, 1);
});

test('404, errores y datos vacíos tienen un fallback sin bloquear el perfil', async () => {
  for (const fetchImpl of [
    async () => new Response('', { status: 404 }),
    async () => { throw new Error('Offline'); },
    async () => new Response(JSON.stringify({ display_name: ' ' })),
    async () => new Response('invalid json')
  ]) {
    const profile = await createIdentityResolver({ fetchImpl })(admin, { account });
    assert.equal(profile.displayName, 'owner');
    assert.equal(profile.source, 'account');
    assert.ok(profile.avatarUrl);
  }
});

test('la caché de fallos caduca y permite recuperar Gravatar', async () => {
  let clock = 0;
  let calls = 0;
  const resolver = createIdentityResolver({ now: () => clock, fetchImpl: async () => {
    calls++;
    return calls === 1 ? new Response('', { status: 429 }) : new Response(JSON.stringify({ display_name: 'Recuperado' }));
  } });
  await resolver(admin, { account });
  await resolver(admin, { account });
  assert.equal(calls, 1);
  clock = 300001;
  assert.equal((await resolver(admin, { account })).displayName, 'Recuperado');
});

test('cada usuario conserva su identidad sin reutilizar datos de otra cuenta', async () => {
  const resolver = createIdentityResolver({ fetchImpl: async () => new Response(JSON.stringify({ display_name: 'Dueño' })) });
  await resolver(admin, { account });
  const profile = await resolver(guest, { account });
  assert.equal(profile.displayName, 'guest');
  assert.equal(profile.avatarUrl, null);
});

test('el nombre configurado mantiene prioridad sobre Gravatar', async () => {
  const resolver = createIdentityResolver({ fetchImpl: async () => new Response(JSON.stringify({ display_name: 'Gravatar' })) });
  assert.equal((await resolver(admin, { account, configured: { displayName: 'Personalizado' } })).displayName, 'Personalizado');
});
