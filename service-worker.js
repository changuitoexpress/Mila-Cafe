// Solo archivos locales de la interfaz. Nunca interceptar datos de Supabase ni CDN externos.
const STATIC_CACHE = "mila-static-v5";
const STATIC_FILES = [
  "./",
  "./index.html",
  "./theme.css",
  "./theme.js",
  "./styles.css",
  "./main.js",
  "./product-media.js",
  "./product-customization.js",
  "./client-product-sheet.js",
  "./product-sheet.css",
  "./menu-experience.css",
  "./menu-motion.css",
  "./menu-motion.js",
  "./pwa.js",
  "./manifest.webmanifest",
  "./brand/logo-verde.png",
  "./brand/logo-crema.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./icons/apple-touch-icon.png",
  "./icons/favicon.png",
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