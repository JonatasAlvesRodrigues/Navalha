const CACHE_VERSION = 'navalha-v4';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/pwa/icon.svg',
  '/cliente/index.html',
  '/cliente/styles.css',
  '/cliente/app.js',
  '/barbearia/index.html',
  '/barbearia/styles.css',
  '/barbearia/app.js',
  '/barbearia/favicon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => null)
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key !== STATIC_CACHE)
        .map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => caches.match(req).then((cached) => cached || new Response(JSON.stringify({ error: 'Sem conexão.' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' }
      })))
    );
    return;
  }

  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;

        if (url.pathname.startsWith('/barbearia') || url.pathname.startsWith('/t/')) {
          return caches.match('/barbearia/index.html');
        }
        if (url.pathname.startsWith('/cliente')) {
          return caches.match('/cliente/index.html');
        }
        return caches.match('/index.html');
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        if (response && response.ok && !response.redirected) {
          const copy = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => null);
        }
        return response;
      });
    })
  );
});

