const CACHE_NAME = "bookshell-static-v1";
const ASSETS = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/styles/mainstyles.css",
  "/styles/mainpage.css",
  "/styles/dashboard.css",
  "/styles/videos.css",
  "/styles/recipes.css",
  "/styles/habits.css",
  "/styles/media.css",
  "/styles/world.css",
  "/styles/gym.css",
  "/scripts/main.js",
  "/scripts/videos.js",
  "/scripts/recipes.js",
  "/scripts/habits.js",
  "/scripts/dashboard.js",
  "/scripts/media.js",
  "/scripts/world.js",
  "/scripts/gym.js",
  "/scripts/countries.js",
  "/scripts/world-heatmap.js",
  "/scripts/firebase-shared.js",
  "/icons/favicon-16.png",
  "/icons/favicon-32.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
    ))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
