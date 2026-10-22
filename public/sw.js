// Service worker de Zer0Code: hace la web instalable como app, la abre aunque no haya red
// (con aviso de «sin conexión») y muestra las notificaciones push del servidor.
const CACHE = 'zer0code-v8';
const SHELL = [
  '/',
  '/css/style.css',
  '/js/app.js',
  '/manifest.json?v=4',
  '/favicon.svg?v=4',
  '/icon.svg?v=4',
  '/icon-192.png?v=4',
  '/icon-512.png?v=4',
  '/apple-touch-icon.png?v=4'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Primero la red (así cada cambio del servidor se ve al momento) y la caché solo sin conexión.
// La API y las rutas internas nunca se guardan: llevan datos privados del usuario.
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === 'basic') {
          const copy = res.clone();
          caches.open(CACHE).then(cache => cache.put(req.mode === 'navigate' ? '/' : req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req.mode === 'navigate' ? '/' : req);
        return cached || Response.error();
      })
  );
});

// --------------------------------------------------------------------------
// Notificaciones push
// --------------------------------------------------------------------------
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'Zer0Code', {
      body: data.body || '',
      tag: data.tag,
      renotify: !!data.tag,
      icon: '/icon-192.png?v=4',
      badge: '/icon-192.png?v=4',
      data: { sessionId: data.sessionId || null }
    })
  );
});

// Al tocar la notificación: abrir la app (o traerla al frente) en esa conversación
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sessionId = event.notification.data?.sessionId;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(c => new URL(c.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      if (sessionId) client.postMessage({ type: 'open_session', sessionId });
      return;
    }
    await self.clients.openWindow(sessionId ? `/?session=${encodeURIComponent(sessionId)}` : '/');
  })());
});
