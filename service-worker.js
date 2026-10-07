// Solo archivos locales de la interfaz. Nunca interceptar datos de Supabase ni CDN externos.
const STATIC_CACHE = "mila-static-v2";
const STATIC_FILES = [
  "./",
  "./index.html",
  "./styles.css",
  "./main.js",
  "./product-media.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./icons/mila-icon.svg",
  "./icons/mila-icon-192.png",
  "./icons/mila-icon-512.png",
];
const STATIC_URLS = new Set(STATIC_FILES.map((path) => new URL(path, self.registration.scope).pathname));

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then((cache) => cache.addAll(STATIC_FILES))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || !STATIC_URLS.has(url.pathname)) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.put(request, copy)));
        }
        return response;
      })
      .catch(async () => (await caches.match(request)) || Response.error())
  );
});