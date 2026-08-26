const APP_VERSION = "2026-08-26-reminders-occurrences-v3";
const PUBLISHED_COMMIT = "local-reminders-v3";
const CACHE_PREFIX = "bookshell-";
const STATIC_CACHE = `bookshell-static-${APP_VERSION}`;
const RUNTIME_CACHE = `bookshell-runtime-${APP_VERSION}`;
const ACTIVE_CACHE_NAMES = Object.freeze([STATIC_CACHE, RUNTIME_CACHE]);

const LOCAL_PRECACHE_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./assets/geo/world.json",
  "./styles/core/themes.css",
  "./styles/core/shell.css",
  
  "./styles/modules/books.css",
  "./styles/modules/finance.css",
  
  "./styles/modules/gym.css",
  "./styles/modules/habits.css",
  
  "./styles/modules/notes.css",
  "./styles/modules/recipes.css",
  "./styles/modules/world.css",
  "./views/books.html",
  "./views/finance.html",
  
  "./views/gym.html",
  "./views/habits.html",
  
  "./views/notes.html",
  "./views/recipes.html",
  "./views/world.html",
  "./scripts/app/main.js",
  "./scripts/app/nav-root-reset.js",
  "./scripts/app/session-quickstart.js",
  "./scripts/modules/books/index.js",
  "./scripts/modules/books/runtime.js",
  "./scripts/modules/finance/index.js",
  "./scripts/modules/finance/runtime.js",
  "./scripts/modules/finance/finance/data.js",
  "./scripts/modules/finance/finance/shortcut-integration.js",
  
  
  "./scripts/modules/gym/index.js",
  "./scripts/modules/gym/runtime.js",
  "./scripts/modules/habits/index.js",
  "./scripts/modules/habits/runtime.js",
  "./scripts/modules/habits/time-by-habit.js",
  "./scripts/modules/habits/export-utils.js",
  "./scripts/modules/habits/schedule-credits.js",
  
  "./scripts/modules/notes/index.js",
  "./scripts/modules/notes/runtime.js",
  "./scripts/modules/notes/reminders-runtime-guards.js",
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
  "./scripts/modules/world/index.js",
  "./scripts/modules/world/stays.js",
  "./scripts/shared/cache/processed-json-cache.js",
  "./scripts/shared/config/app-paths.js",
  "./scripts/shared/data/api-provider.js",
  "./scripts/shared/data/config.js",
  "./scripts/shared/data/data-usage.js",
  "./scripts/shared/data/index.js",
  "./scripts/shared/data/offline-backend.js",
  "./scripts/shared/data/paths.js",
  "./scripts/shared/data/read-debug.js",
  "./scripts/shared/data/reminders-api.js",
  "./scripts/shared/services/sync-manager.js",
  
  
  
  
  "./scripts/shared/services/theme/index.js",
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
  if (!response || (!response.ok && response.type !== "opaque")) {
    if (response && !response.ok) {
      console.warn("[sw:cache:skip]", {
        cacheName,
        path: new URL(request.url).pathname,
        status: response.status,
      });
    }
    return response;
  }
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
  const match = runtimeMatch || staticMatch || null;
  console.info(match ? "[sw:cache:hit:active-only]" : "[sw:cache:miss:active-only]", {
    path: new URL(request.url).pathname,
    activeCaches: ACTIVE_CACHE_NAMES,
  });
  return match;
}

async function precacheLocalAssets() {
  await Promise.allSettled(LOCAL_PRECACHE_ASSETS.map(async (asset) => {
    const url = new URL(asset, self.location.href);
    const request = new Request(url.href, { cache: "no-store" });
    const response = await fetch(request);
    await putInCache(STATIC_CACHE, request, response);
  }));
}

async function navigationNetworkFirst(request) {
  const appIndexRequest = new Request(APP_INDEX_URL, { cache: "no-store" });

  try {
    const response = await fetch(request, { cache: "no-store" });
    console.info("[sw:navigation:network]", new URL(request.url).pathname, { status: response.status });
    await putInCache(STATIC_CACHE, appIndexRequest, response);
    return response;
  } catch (_) {
    const staticCache = await caches.open(STATIC_CACHE);
    const cachedShell = await staticCache.match(appIndexRequest) || await staticCache.match(APP_INDEX_URL);
    if (cachedShell) {
      console.warn("[sw:navigation:cache-fallback]", new URL(request.url).pathname);
      return cachedShell;
    }
    return Response.error();
  }
}

async function networkFirst(request) {
  const url = new URL(request.url);
  try {
    const response = await fetch(request, { cache: "no-store" });
    console.info("[sw:network-first:network]", {
      path: url.pathname,
      status: response.status,
      strategy: "network-first",
      cacheWrite: response.ok || response.type === "opaque",
    });
    await putInCache(url.origin === self.location.origin ? STATIC_CACHE : RUNTIME_CACHE, request, response);
    return response;
  } catch (_) {
    const cached = await matchAnyCache(request);
    if (cached) {
      console.warn("[sw:network-first:cache-fallback]", {
        path: url.pathname,
        activeCaches: ACTIVE_CACHE_NAMES,
      });
      return cached;
    }
    console.warn("[sw:network-first:miss]", url.pathname);
    return Response.error();
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

function isExecutableRequest(request, url) {
  if (request.destination === "script" || request.destination === "worker") return true;
  return /\.(?:js|mjs)$/i.test(url.pathname);
}

function isServiceWorkerScript(url) {
  return url.origin === self.location.origin && url.pathname.endsWith("/service-worker.js");
}

async function purgeBookshellCaches(reason = "unknown") {
  const keys = await caches.keys();
  const staleKeys = keys.filter((key) => key.startsWith(CACHE_PREFIX));
  console.info("[sw:cache:keys-before-purge]", {
    reason,
    keys,
    bookshellKeys: staleKeys,
    nextActiveCaches: ACTIVE_CACHE_NAMES,
  });
  await Promise.all(staleKeys.map(async (key) => {
    const deleted = await caches.delete(key);
    console.warn("[sw:cache:deleted]", { key, deleted, reason });
    return deleted;
  }));
  return staleKeys;
}

async function notifyClients(message = {}) {
  const clientList = await self.clients.matchAll({ includeUncontrolled: true, type: "window" });
  clientList.forEach((client) => {
    client.postMessage({
      source: "bookshell-service-worker",
      version: APP_VERSION,
      commit: PUBLISHED_COMMIT,
      activeCaches: ACTIVE_CACHE_NAMES,
      ...message,
    });
  });
}

self.addEventListener("install", (event) => {
  console.info("[offline:boot]", { phase: "sw-install", version: APP_VERSION, commit: PUBLISHED_COMMIT });
  self.skipWaiting();
  event.waitUntil(Promise.resolve());
});

self.addEventListener("activate", (event) => {
  console.info("[offline:boot]", { phase: "sw-activate", version: APP_VERSION, commit: PUBLISHED_COMMIT });
  event.waitUntil(
    (async () => {
      await self.skipWaiting();
      const purgedKeys = await purgeBookshellCaches("activate-force-purge");
      await precacheLocalAssets();
      const activeKeys = (await caches.keys()).filter((key) => key.startsWith(CACHE_PREFIX));
      console.info("[sw:cache:active-after-purge]", {
        activeKeys,
        expected: ACTIVE_CACHE_NAMES,
      });
      await self.clients.claim();
      await notifyClients({
        type: "activated",
        purgedKeys,
        activeKeys,
      });
    })(),
  );
});

self.addEventListener("message", (event) => {
  const type = String(event?.data?.type || "");
  if (type === "BOOKSHELL_GET_VERSION") {
    event.source?.postMessage?.({
      source: "bookshell-service-worker",
      type: "version",
      version: APP_VERSION,
      commit: PUBLISHED_COMMIT,
      activeCaches: ACTIVE_CACHE_NAMES,
    });
    return;
  }
  if (type === "BOOKSHELL_PURGE_CACHES") {
    event.waitUntil(
      purgeBookshellCaches("message-purge").then((purgedKeys) => notifyClients({
        type: "purged",
        purgedKeys,
      })),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (!isHttpRequest(request)) return;

  const url = new URL(request.url);
  if (isServiceWorkerScript(url)) {
    console.debug("[sw:fetch] service-worker-network-only", {
      path: url.pathname,
      version: APP_VERSION,
    });
    event.respondWith(fetch(request, { cache: "no-store" }));
    return;
  }

  if (!isCacheableAsset(request, url)) return;

  if (request.mode === "navigate") {
    console.debug("[sw:fetch] nav-network-first", {
      path: url.pathname,
      version: APP_VERSION,
      activeCaches: ACTIVE_CACHE_NAMES,
    });
    event.respondWith(navigationNetworkFirst(request));
    return;
  }

  if (isExecutableRequest(request, url)) {
    console.debug("[sw:fetch] executable-network-first", {
      path: url.pathname,
      version: APP_VERSION,
      activeCaches: ACTIVE_CACHE_NAMES,
    });
    event.respondWith(networkFirst(request));
    return;
  }

  if (isLocalCodeRequest(request, url)) {
    console.debug("[sw:fetch] local-code-network-first", {
      path: url.pathname,
      version: APP_VERSION,
      activeCaches: ACTIVE_CACHE_NAMES,
    });
    event.respondWith(networkFirst(request));
    return;
  }

  console.debug("[sw:fetch] asset-network-first", {
    path: url.pathname,
    version: APP_VERSION,
    activeCaches: ACTIVE_CACHE_NAMES,
  });
  event.respondWith(networkFirst(request));
});
