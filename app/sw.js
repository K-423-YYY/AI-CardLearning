const CACHE_NAME = 'ai-learn-local-v2';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=18',
  './vendor/jszip.min.js',
  './vendor/pdf.mjs',
  './vendor/pdf.worker.mjs',
  './js/local/storage.js?v=18',
  './js/local/db.js?v=18',
  './js/local/core.js?v=18',
  './js/local/ai.js?v=18',
  './js/local/pdf.js?v=18',
  './js/local/export.js?v=18',
  './js/local/import.js?v=18',
  './js/api.js?v=18',
  './js/auth.js?v=18',
  './js/zones.js?v=18',
  './js/cards.js?v=18',
  './js/settings.js?v=18',
  './js/app.js?v=18',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached || Response.error());
      return cached || network;
    })
  );
});
