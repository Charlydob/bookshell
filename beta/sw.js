const STATIC_CACHE = "bookshell-static-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/mainstyles.css",
  "./styles/mainpage.css",
  "./styles/dashboard.css",
  "./styles/videos.css",
  "./styles/recipes.css",
  "./styles/habits.css",
  "./styles/media.css",
  "./styles/world.css",
  "./styles/gym.css",
  "./styles/finance.css",
  "./styles/main.css",
  "./scripts/app.js",
  "./scripts/recipes.js",
  "./scripts/countries.js",
  "./scripts/world-heatmap.js",
  "./scripts/firebase-shared.js",
  "./icons/favicon-16.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png"
];

function resolveAppUrl(path = "./") {
  return new URL(path, self.registration.scope).toString();
}


self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(APP_SHELL.map((path) => resolveAppUrl(path)))));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== STATIC_CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

function isFirebaseRequest(url) {
  return url.hostname.includes("firebaseio.com")
    || url.hostname.includes("firebasedatabase.app")
    || url.hostname.includes("googleapis.com");
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isFirebaseRequest(url)) return;

  const isNavigate = request.mode === "navigate";
  const isStaticAsset = request.destination === "style"
    || request.destination === "script"
    || request.destination === "image"
    || request.destination === "font";

  if (!isNavigate && !isStaticAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(STATIC_CACHE);

    if (isNavigate) {
      try {
        const networkResponse = await fetch(request, { cache: "no-store" });
        if (networkResponse && networkResponse.ok) {
          cache.put(request, networkResponse.clone());
          cache.put(resolveAppUrl("./index.html"), networkResponse.clone());
        }
        return networkResponse;
      } catch (_) {
        return (await cache.match(request)) || (await cache.match(resolveAppUrl("./index.html")));
      }
    }

    const cached = await cache.match(request);
    const networkFetch = fetch(request)
      .then((response) => {
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cached || caches.match(resolveAppUrl("./index.html")));

    // Stale-while-revalidate para estÃ¡ticos: evita quedarnos "pegados" a una versiÃ³n antigua.
    if (cached) {
      event.waitUntil(networkFetch);
      return cached;
    }
    return networkFetch;
  })());
});
