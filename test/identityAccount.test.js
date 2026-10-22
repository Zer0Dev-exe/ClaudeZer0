import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentityAccountLookup } from '../server/identityAccount.js';

const admin = { role: 'admin' };

test('identidad no consulta al anfitrión para usuarios normales ni en modo Client', async () => {
  const lookup = createIdentityAccountLookup({ readAccount: () => assert.fail('No debe ejecutar Claude') });
  assert.equal(await lookup({ role: 'user' }, 'Hoster'), null);
  assert.equal(await lookup(admin, 'Client'), null);
});

test('identidad consulta sin bloquear, deduplica y cachea la cuenta', async () => {
  let calls = 0;
  let resolveAccount;
  let clock = 100;
  const account = { email: 'owner@example.com' };
  const lookup = createIdentityAccountLookup({
    now: () => clock,
    readAccount: () => { calls++; return new Promise(resolve => { resolveAccount = resolve; }); }
  });
  const first = lookup(admin, 'Hoster');
  const second = lookup(admin, 'Hoster');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(calls, 1);
  resolveAccount(account);
  assert.deepEqual(await Promise.all([first, second]), [account, account]);
  assert.equal(await lookup(admin, 'Hoster'), account);
  assert.equal(calls, 1);
  clock += 300001;
  const expired = lookup(admin, 'Hoster');
  await new Promise(resolve => setImmediate(resolve));
  resolveAccount(account);
  await expired;
  assert.equal(calls, 2);
});

test('identidad conserva un fallo temporal sin repetir procesos y permite reintentar', async () => {
  let clock = 100;
  let calls = 0;
  const lookup = createIdentityAccountLookup({ now: () => clock, readAccount: async () => {
    calls++;
    throw new Error('timeout');
  } });
  assert.equal(await lookup(admin, 'Hoster'), null);
  assert.equal(await lookup(admin, 'Hoster'), null);
  assert.equal(calls, 1);
  clock += 30001;
  assert.equal(await lookup(admin, 'Hoster'), null);
  assert.equal(calls, 2);
});
