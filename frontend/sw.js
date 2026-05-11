const CACHE_VERSION = 'navalha-v1';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/styles.css',
  '/manifest.webmanifest',
  '/pwa/icon.svg',
  '/cliente',
  '/cliente/index.html',
  '/cliente/styles.css',
  '/cliente/app.js',
  '/barbearia',
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

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((response) => {
        const copy = response.clone();
        caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy)).catch(() => null);
        return response;
      });
    })
  );
});
