const CACHE_NAME = 'abaco-cache-v3';
const APP_SHELL = ['/offline.html', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(
        nombres
          .filter((nombre) => nombre.startsWith('abaco-cache-') && nombre !== CACHE_NAME)
          .map((nombre) => caches.delete(nombre))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  // Documentos HTML (navegación): siempre la red primero
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() => caches.match('/offline.html'))
    );
    return;
  }

  // Never cache authenticated API responses, RSC payloads or profile data.
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith('/_next/static/')) return;
  // Archivos estáticos con hash: cache-first.
  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return (
        respuestaCache ||
        fetch(event.request).then((respuestaRed) => {
          if (respuestaRed.ok) {
            const clon = respuestaRed.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clon));
          }
          return respuestaRed;
        })
      );
    })
  );
});
