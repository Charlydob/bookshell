const APP_VERSION = "2026-04-15-v2";
const STATIC_CACHE = `bookshell-static-${APP_VERSION}`;
const RUNTIME_CACHE = `bookshell-runtime-${APP_VERSION}`;

const LOCAL_PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./styles/core/base.css",
  "./styles/core/shell.css",
  "./styles/core/achievements.css",
  "./styles/modules/books.css",
  "./styles/modules/finance.css",
  "./styles/modules/games.css",
  "./styles/modules/gym.css",
  "./styles/modules/habits.css",
  "./styles/modules/improvements.css",
  "./styles/modules/media.css",
  "./styles/modules/notes.css",
  "./styles/modules/recipes.css",
  "./styles/modules/videos-hub.css",
  "./styles/modules/world.css",
  "./views/books.html",
  "./views/finance.html",
  "./views/games.html",
  "./views/gym.html",
  "./views/habits.html",
  "./views/improvements.html",
  "./views/media.html",
  "./views/notes.html",
  "./views/recipes.html",
  "./views/videos-hub.html",
  "./views/world.html",
  "./scripts/app/main.js",
  "./scripts/app/nav-root-reset.js",
  "./scripts/app/session-quickstart.js",
  "./scripts/modules/books/index.js",
  "./scripts/modules/books/runtime.js",
  "./scripts/modules/finance/index.js",
  "./scripts/modules/finance/runtime.js",
  "./scripts/modules/finance/finance/data.js",
  "./scripts/modules/games/index.js",
  "./scripts/modules/games/runtime.js",
  "./scripts/modules/gym/index.js",
  "./scripts/modules/gym/runtime.js",
  "./scripts/modules/habits/index.js",
  "./scripts/modules/habits/runtime.js",
  "./scripts/modules/habits/time-by-habit.js",
  "./scripts/modules/habits/export-utils.js",
  "./scripts/modules/habits/schedule-credits.js",
  "./scripts/modules/improvements/index.js",
  "./scripts/modules/improvements/performance-audit.js",
  "./scripts/modules/media/index.js",
  "./scripts/modules/notes/index.js",
  "./scripts/modules/notes/runtime.js",
  "./scripts/modules/notes/domain/store.js",
  "./scripts/modules/notes/persist/notes-datasource.js",
  "./scripts/modules/notes/persist/notes-mapper.js",
  "./scripts/modules/recipes/index.js",
  "./scripts/modules/recipes/runtime.js",
  "./scripts/modules/recipes/countries.js",
  "./scripts/modules/recipes/world-heatmap.js",
  "./scripts/modules/recipes/finance-data.js",
  "./scripts/modules/recipes/met-catalog.js",
  "./scripts/modules/recipes/foodrepo.js",
  "./scripts/modules/videos-hub/index.js",
  "./scripts/modules/world/index.js",
  "./scripts/shared/cache/processed-json-cache.js",
  "./scripts/shared/config/app-paths.js",
  "./scripts/shared/firebase/app.js",
  "./scripts/shared/firebase/auth.js",
  "./scripts/shared/firebase/config.js",
  "./scripts/shared/firebase/database.js",
  "./scripts/shared/firebase/index.js",
  "./scripts/shared/firebase/offline-rtdb.js",
  "./scripts/shared/services/sync-manager.js",
  "./scripts/shared/services/achievements/index.js",
  "./scripts/shared/services/achievements/catalog.js",
  "./scripts/shared/services/achievements/metrics.js",
  "./scripts/shared/storage/offline-db.js",
  "./scripts/shared/storage/offline-queue.js",
  "./scripts/shared/storage/offline-snapshots.js",
  "./scripts/shared/vendors/echarts.js",
  "./icons/favicon-16.png",
  "./icons/favicon-32.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

const CACHEABLE_HOSTS = new Set([
  self.location.host,
  "www.gstatic.com",
  "cdn.jsdelivr.net",
  "echarts.apache.org",
  "raw.githubusercontent.com",
]);

const ASSET_PATTERN = /\.(?:js|mjs|css|json|geojson|html|png|jpe?g|svg|webp|woff2?)$/i;
const APP_INDEX_URL = new URL("./index.html", self.location.href).href;

function isHttpRequest(request) {
  return request.url.startsWith("http://") || request.url.startsWith("https://");
}

function isCacheableAsset(request, url) {
  if (request.method !== "GET") return false;
  if (!CACHEABLE_HOSTS.has(url.host)) return false;
  if (request.mode === "navigate") return true;
  if (request.destination === "script" || request.destination === "style" || request.destination === "worker") {
    return true;
  }
  return ASSET_PATTERN.test(url.pathname);
}

async function putInCache(cacheName, request, response) {
  if (!response || (!response.ok && response.type !== "opaque")) return response;
  const cache = await caches.open(cacheName);
  await cache.put(request, response.clone());
  return response;
}

async function matchAnyCache(request) {
  const runtimeCache = await caches.open(RUNTIME_CACHE);
  const staticCache = await caches.open(STATIC_CACHE);
  const [staticMatch, runtimeMatch] = await Promise.all([
    runtimeCache.match(request),
    staticCache.match(request),
  ]);
  return runtimeMatch || staticMatch || null;
}

async function precacheLocalAssets() {
  await Promise.allSettled(LOCAL_PRECACHE_ASSETS.map(async (asset) => {
    const url = new URL(asset, self.location.href);
    const request = new Request(url.href, { cache: "no-store" });
    const response = await fetch(request);
    await putInCache(STATIC_CACHE, request, response);
  }));
}

async function staleWhileRevalidate(request) {
  const cached = await matchAnyCache(request);
  const networkPromise = fetch(request)
    .then((response) => putInCache(RUNTIME_CACHE, request, response))
    .catch(() => null);

  if (cached) {
    void networkPromise;
    return cached;
  }

  const networkResponse = await networkPromise;
  return networkResponse || Response.error();
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    await putInCache(STATIC_CACHE, request, response);
    return response;
  } catch (_) {
    const cached = await matchAnyCache(request);
    if (cached) return cached;
    return caches.match(APP_INDEX_URL);
  }
}

function isLocalCodeRequest(request, url) {
  if (url.origin !== self.location.origin) return false;
  if (request.mode === "navigate") return true;
  if (request.destination === "script" || request.destination === "style" || request.destination === "worker") {
    return true;
  }
  return /\.(?:html|js|mjs|css)$/i.test(url.pathname);
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    precacheLocalAssets().then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(
        keys
          .filter((key) => key.startsWith("bookshell-") && key !== STATIC_CACHE && key !== RUNTIME_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isHttpRequest(request)) return;

  const url = new URL(request.url);
  if (!isCacheableAsset(request, url)) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }

  if (isLocalCodeRequest(request, url)) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(staleWhileRevalidate(request));
});
