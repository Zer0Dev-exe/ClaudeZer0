import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'zer0code-profile-name-'));
process.env.ZER0CODE_DATA_DIR = directory;
const { setProfileDisplayName, getProfileIdentity, getProfilePrompt } = await import('../server/profiles.js');
const profilesPath = path.join(directory, 'profiles.json');
test.after(() => fs.rmSync(directory, { recursive: true, force: true }));

test('nombre visible persiste por usuario sin cambiar email, instrucciones ni otras cuentas', () => {
  fs.writeFileSync(profilesPath, JSON.stringify({ alice: { email: 'alice@example.com', systemPrompt: 'Privado', greeting: 'Hola' }, bob: { displayName: 'Bob' } }));
  assert.deepEqual(setProfileDisplayName('alice', '  Alicia  '), { email: 'alice@example.com', displayName: 'Alicia' });
  assert.equal(getProfileIdentity('alice').displayName, 'Alicia');
  assert.equal(getProfilePrompt('alice'), 'Privado');
  assert.equal(getProfileIdentity('bob').displayName, 'Bob');
  assert.equal(JSON.parse(fs.readFileSync(profilesPath, 'utf8')).alice.greeting, 'Hola');
});

test('nombre vacío recupera la identidad automática sin eliminar el correo', () => {
  setProfileDisplayName('alice', '');
  assert.deepEqual(getProfileIdentity('alice'), { email: 'alice@example.com', displayName: '' });
});

test('nombre visible valida tipo, longitud y caracteres de control antes de escribir', () => {
  const before = fs.readFileSync(profilesPath, 'utf8');
  for (const value of [undefined, null, 42, {}, 'x'.repeat(41), 'Nombre\nOtro']) {
    assert.throws(() => setProfileDisplayName('alice', value));
  }
  assert.equal(fs.readFileSync(profilesPath, 'utf8'), before);
});

test('un archivo de perfiles dañado no se sobrescribe', () => {
  fs.writeFileSync(profilesPath, 'broken');
  assert.throws(() => setProfileDisplayName('alice', 'Alicia'));
  assert.equal(fs.readFileSync(profilesPath, 'utf8'), 'broken');
});
