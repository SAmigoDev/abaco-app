const CACHE_NAME = 'abaco-cache-v2';
const APP_SHELL = ['/', '/manifest.webmanifest'];

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
          .filter((nombre) => nombre !== CACHE_NAME)
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
      fetch(event.request).catch(() => caches.match('/'))
    );
    return;
  }

  // Archivos estáticos (JS, CSS, imágenes con hash): cache-first está bien
  event.respondWith(
    caches.match(event.request).then((respuestaCache) => {
      return (
        respuestaCache ||
        fetch(event.request).then((respuestaRed) => {
          const clon = respuestaRed.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clon));
          return respuestaRed;
        })
      );
    })
  );
});