import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import webpush from 'web-push';

// Notificaciones push de la app instalada (PWA): avisan de que Claude ha terminado o necesita
// permiso aunque la app esté cerrada. Las claves VAPID se generan una vez y se guardan en data/.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, '..', 'data');
const pushPath = path.join(dataDir, 'push.json');

function load() {
  try {
    if (fs.existsSync(pushPath)) return JSON.parse(fs.readFileSync(pushPath, 'utf-8'));
  } catch (err) {
    console.warn('Error leyendo push.json:', err.message);
  }
  return {};
}

function save() {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(pushPath, JSON.stringify(store, null, 2), { encoding: 'utf-8', mode: 0o600 });
  } catch (err) {
    console.error('Error guardando push.json:', err.message);
  }
}

const store = load();
if (!store.vapid) {
  store.vapid = webpush.generateVAPIDKeys();
  store.subscriptions = [];
  save();
}
store.subscriptions ||= [];
// El contacto lo exigen los servicios push; no se usa para nada más
webpush.setVapidDetails('mailto:claudezer0@localhost', store.vapid.publicKey, store.vapid.privateKey);

export function getPushPublicKey() {
  return store.vapid.publicKey;
}

export function addSubscription(owner, subscription) {
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.keys) {
    throw new Error('Suscripción no válida');
  }
  // Un mismo dispositivo puede cambiar de usuario: la suscripción pertenece al último que la registra
  store.subscriptions = store.subscriptions.filter(s => s.subscription.endpoint !== subscription.endpoint);
  store.subscriptions.push({ owner, subscription: { endpoint: subscription.endpoint, keys: subscription.keys }, createdAt: Date.now() });
  save();
}

export function removeSubscription(owner, endpoint) {
  const before = store.subscriptions.length;
  store.subscriptions = store.subscriptions.filter(s => !(s.owner === owner && s.subscription.endpoint === endpoint));
  if (store.subscriptions.length !== before) save();
}

export function forgetUserPush(owner) {
  store.subscriptions = store.subscriptions.filter(s => s.owner !== owner);
  save();
}

/**
 * Enviar una notificación a todos los dispositivos suscritos de un usuario.
 * El service worker no la muestra si la app está abierta y visible.
 * @param {string} owner
 * @param {{title: string, body: string, tag?: string, url?: string}} payload
 */
export async function notifyUser(owner, payload) {
  const targets = store.subscriptions.filter(s => s.owner === owner);
  if (!targets.length) return;
  const body = JSON.stringify(payload);
  let changed = false;
  await Promise.all(targets.map(async (s) => {
    try {
      await webpush.sendNotification(s.subscription, body, { TTL: 3600, urgency: 'high' });
    } catch (err) {
      // 404/410: el navegador anuló la suscripción (app desinstalada o permiso retirado)
      if (err.statusCode === 404 || err.statusCode === 410) {
        store.subscriptions = store.subscriptions.filter(x => x !== s);
        changed = true;
      } else {
        console.warn('Error enviando notificación push:', err.statusCode || err.message);
      }
    }
  }));
  if (changed) save();
}
