const CACHE_NAME = 'ai-learn-local-v9';
const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css?v=25',
  './vendor/jszip.min.js',
  './js/local/docx.js?v=25',
  './vendor/pdf.mjs',
  './vendor/pdf.worker.mjs',
  './js/local/storage.js?v=25',
  './js/local/db.js?v=25',
  './js/local/core.js?v=25',
  './js/local/ai.js?v=25',
  './js/local/pdf.js?v=25',
  './js/local/export.js?v=25',
  './js/local/import.js?v=25',
  './js/api.js?v=25',
  './js/auth.js?v=25',
  './js/zones.js?v=25',
  './js/cards.js?v=25',
  './js/settings.js?v=25',
  './js/app.js?v=25',
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
