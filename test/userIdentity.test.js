import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/js/app.js', import.meta.url), 'utf8');
const start = source.indexOf('function updateUserIdentity()');
const end = source.indexOf('\nasync function loadGlobalProfile()', start);

function createIdentityView() {
  const images = [];
  const avatar = {
    dataset: {}, image: null, textContent: '',
    querySelector: () => avatar.image,
    replaceChildren: image => { avatar.image = image; }
  };
  const context = vm.createContext({
    currentUsername: 'alice', identityProfile: { displayName: 'Alice', avatarUrl: 'https://example.com/alice' },
    userDisplayName: {}, userAvatarLetter: avatar,
    readPref: () => '', document: { getElementById: () => null },
    Image: class { constructor() { images.push(this); } }
  });
  vm.runInContext(source.slice(start, end), context);
  return { context, avatar, images, update: () => vm.runInContext('updateUserIdentity()', context) };
}

test('avatar reutiliza la misma carga y no borra una imagen visible', () => {
  const view = createIdentityView();
  view.update();
  view.update();
  assert.equal(view.images.length, 1);
  view.images[0].onload();
  view.update();
  assert.equal(view.avatar.image, view.images[0]);
  assert.equal(view.images.length, 1);
});

test('avatar no reintenta en cada actualización si la imagen falla', () => {
  const view = createIdentityView();
  view.update();
  view.update();
  assert.equal(view.avatar.textContent, 'A');
  assert.equal(view.images.length, 1);
});

test('avatar descarta la carga pendiente al cambiar de identidad', () => {
  const view = createIdentityView();
  view.update();
  view.context.currentUsername = 'bob';
  view.context.identityProfile = { displayName: 'Bob', avatarUrl: 'https://example.com/bob' };
  view.update();
  view.images[0].onload();
  assert.equal(view.avatar.image, null);
  assert.equal(view.avatar.textContent, 'B');
  view.images[1].onload();
  assert.equal(view.avatar.image, view.images[1]);
});
