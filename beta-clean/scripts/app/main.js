import {
  auth,
  db,
  onUserChange,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
} from "../shared/firebase/index.js";
import {
  get,
  onValue,
  ref,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  initSyncManager,
  notifySyncUserChanged,
  subscribeSyncState,
} from "../shared/services/sync-manager.js?v=2026-04-05-v5";

const LAST_VIEW_KEY = "bookshell:lastView";
const NAV_LAYOUT_KEY = "bookshell:navLayout:v1";
const NAV_LAYOUT_VERSION = 2;
const DEFAULT_VIEW_ID = "view-books";
const HABITS_VIEW_ID = "view-habits";
const SHELL_STATE_KEY = "__bookshellCleanShellState";
const APP_BOOT_TS = performance.now();
const ECHARTS_LIKELY_VIEW_IDS = new Set([
  "view-finance",
  "view-games",
  "view-habits",
  "view-media",
  "view-gym",
  "view-improvements",
  "view-world",
]);
const loadedStyles = new Map();
let navRootResetApiPromise = null;
let sessionQuickstartPromise = null;
const NAV_DEFAULT_GROUP_LABEL = "Grupo";
const NAV_GROUP_EMOJI_FALLBACK = "🗂️";
const NAV_LONG_PRESS_MS = 420;
const NAV_MENU_MARGIN = 10;
const NAV_VIEW_META = {
  "view-books": { label: "Libros" },
  "view-videos-hub": { label: "Videos" },
  "view-recipes": { label: "Recetas" },
  "view-habits": { label: "Habitos" },
  "view-games": { label: "Juegos" },
  "view-media": { label: "Media" },
  "view-world": { label: "Mundo" },
  "view-finance": { label: "Cuentas" },
  "view-improvements": { label: "Mejoras" },
  "view-gym": { label: "Gym" },
};
const APP_PERF_STORE_KEY = "__bookshellPerfMetrics";
const HABITS_MODULE_VERSION = "2026-04-05-v7";

function getAppPerfStore() {
  if (!window[APP_PERF_STORE_KEY]) {
    window[APP_PERF_STORE_KEY] = {
      appBootStartedAt: Date.now(),
      appBootStartedPerf: APP_BOOT_TS,
      boot: {
        initialLoadMs: 0,
      },
      views: {},
    };
  }

  return window[APP_PERF_STORE_KEY];
}

function recordAppBootMetrics(patch = {}) {
  const store = getAppPerfStore();
  store.boot = {
    ...store.boot,
    ...patch,
  };
}

function recordViewMetrics(viewId, patch = {}) {
  const safeViewId = String(viewId || "").trim();
  if (!safeViewId) return;
  const store = getAppPerfStore();
  const current = store.views[safeViewId] || {};
  store.views[safeViewId] = {
    label: NAV_VIEW_META[safeViewId]?.label || safeViewId,
    ...current,
    ...patch,
  };
}

function buildViewInitDebug(viewId, extra = {}) {
  return {
    viewId,
    online: navigator.onLine,
    serviceWorkerControlled: !!navigator.serviceWorker?.controller,
    currentViewId: getCurrentViewId?.() || "",
    at: new Date().toISOString(),
    ...extra,
  };
}

function logViewInit(viewId, phase, extra = {}, level = "info") {
  const payload = buildViewInitDebug(viewId, { phase, ...extra });
  const state = getShellState();
  if (!Array.isArray(state.viewInitLog)) {
    state.viewInitLog = [];
  }
  state.viewInitLog.push(payload);
  window.__bookshellViewInitLog = state.viewInitLog;

  const logger = typeof console[level] === "function" ? console[level] : console.log;
  logger.call(console, `[view:init] ${viewId} ${phase}`, payload);
}

function logNetworkDebug(phase, extra = {}, level = "info") {
  const payload = {
    phase,
    online: navigator.onLine,
    serviceWorkerControlled: !!navigator.serviceWorker?.controller,
    currentViewId: getCurrentViewId?.() || "",
    uid: auth.currentUser?.uid || "",
    at: new Date().toISOString(),
    ...extra,
  };
  const state = getShellState();
  if (!Array.isArray(state.networkLog)) {
    state.networkLog = [];
  }
  state.networkLog.push(payload);
  window.__bookshellNetworkLog = state.networkLog;

  const logger = typeof console[level] === "function" ? console[level] : console.log;
  logger.call(console, `[network] ${phase}`, payload);
}

function renderViewUnavailableFallback(root, viewId, message = "") {
  if (!root) return;
  const label = NAV_VIEW_META[viewId]?.label || "vista";
  const isOnline = navigator.onLine;
  const eyebrow = isOnline ? "Carga pendiente" : "Modo offline";
  const fallbackDetail = String(message || "").trim() || (isOnline
    ? "Esta vista no se pudo inicializar en este momento."
    : "El contenido de esta vista no esta disponible sin conexion en este dispositivo.");
  logViewInit(viewId, "fallback:rendered", {
    eyebrow,
    message: fallbackDetail,
  }, isOnline ? "warn" : "info");
  const detail = String(message || "").trim() || "El contenido de esta vista no estÃ¡ disponible sin conexiÃ³n en este dispositivo.";
  root.innerHTML = `
    <section class="shell-view-fallback">
      <p class="shell-view-fallback-eyebrow">${escapeHtml(eyebrow)}</p>
      <h3>${escapeHtml(label)}</h3>
      <p>${escapeHtml(fallbackDetail)}</p>
    </section>
  `;
}

function formatSyncTimestamp(ts) {
  const value = Number(ts) || 0;
  if (!value) return "";
  try {
    return new Date(value).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

function ensureSyncIndicatorTextNode(indicator) {
  if (!(indicator instanceof HTMLElement)) return null;

  let textNode = indicator.querySelector(".sync-text");
  if (textNode) return textNode;

  textNode = document.createElement("span");
  textNode.className = "sync-text";

  Array.from(indicator.childNodes).forEach((node) => {
    if (node.nodeType !== Node.TEXT_NODE) return;
    const value = node.textContent || "";
    if (value.trim()) {
      textNode.textContent = [textNode.textContent, value.trim()].filter(Boolean).join(" ");
    }
    indicator.removeChild(node);
  });

  indicator.append(textNode);

  return textNode;
}

function setSyncIndicatorExpanded(indicator, isOpen) {
  if (!(indicator instanceof HTMLElement)) return;
  indicator.classList.toggle("is-open", isOpen);
  indicator.setAttribute("aria-expanded", String(isOpen));
}

function prepareSyncIndicator(indicator) {
  if (!(indicator instanceof HTMLElement)) return null;

  const textNode = ensureSyncIndicatorTextNode(indicator);
  if (!indicator.hasAttribute("aria-label")) {
    indicator.setAttribute("aria-label", "Estado de sincronización");
  }

  if (indicator instanceof HTMLButtonElement) {
    indicator.type = "button";
  } else {
    indicator.setAttribute("role", "button");
    if (!indicator.hasAttribute("tabindex")) {
      indicator.tabIndex = 0;
    }
  }

  if (!indicator.hasAttribute("aria-expanded")) {
    indicator.setAttribute("aria-expanded", "false");
  }

  return textNode;
}

function toggleSyncIndicator(indicator) {
  if (!(indicator instanceof HTMLElement) || indicator.classList.contains("hidden")) return;
  prepareSyncIndicator(indicator);
  setSyncIndicatorExpanded(indicator, !indicator.classList.contains("is-open"));
}

function renderGlobalSyncIndicator(snapshot) {
  const indicator = document.getElementById("app-sync-indicator");
  if (!indicator) return;

  const textNode = prepareSyncIndicator(indicator);
  if (!textNode) return;

  const isAuthenticated = Boolean(auth.currentUser?.uid);
  const hasChanges = (Number(snapshot?.totalCount) || 0) > 0;
  if (!isAuthenticated && !hasChanges) {
    setSyncIndicatorExpanded(indicator, false);
    indicator.classList.add("hidden");
    return;
  }

  let text = "Sincronizado";
  let tone = "synced";
  if (snapshot?.syncing || (Number(snapshot?.syncingCount) || 0) > 0) {
    text = "Sincronizando...";
    tone = "syncing";
  } else if ((Number(snapshot?.failedCount) || 0) > 0) {
    text = `${snapshot.failedCount} con error`;
    tone = "error";
  } else if ((Number(snapshot?.totalCount) || 0) > 0) {
    text = `${snapshot.totalCount} pendiente${snapshot.totalCount === 1 ? "" : "s"}`;
    tone = snapshot?.rtdbConnected ? "pending" : "offline";
  } else if (!snapshot?.appOnline || !snapshot?.rtdbConnected) {
    text = "Sin conexiÃ³n";
    tone = "offline";
  }

  const timeLabel = formatSyncTimestamp(snapshot?.lastSyncAt);
  const indicatorText = timeLabel && tone === "synced" ? `${text} · ${timeLabel}` : text;
  indicator.dataset.state = tone;
  textNode.textContent = indicatorText;
  indicator.setAttribute("aria-label", `Estado de sincronización: ${indicatorText}`);
  indicator.classList.remove("hidden");
}

function bindSyncIndicatorToggles() {
  const state = getShellState();
  if (state.syncIndicatorToggleBound) return;

  document.querySelectorAll(".app-sync-indicator").forEach((indicator) => {
    prepareSyncIndicator(indicator);
    setSyncIndicatorExpanded(indicator, indicator.classList.contains("is-open"));
  });

  document.addEventListener("click", (event) => {
    const indicator = event.target?.closest?.(".app-sync-indicator");
    if (!(indicator instanceof HTMLElement)) return;
    toggleSyncIndicator(indicator);
  });

  document.addEventListener("keydown", (event) => {
    const indicator = event.target?.closest?.(".app-sync-indicator");
    if (!(indicator instanceof HTMLElement) || indicator instanceof HTMLButtonElement) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleSyncIndicator(indicator);
  });

  state.syncIndicatorToggleBound = true;
}

function bindGlobalSyncIndicator() {
  const state = getShellState();
  if (state.syncIndicatorUnsubscribe) return;
  logNetworkDebug("sync:subscribe:start");
  state.syncIndicatorUnsubscribe = subscribeSyncState((snapshot) => {
    logNetworkDebug("sync:state", {
      connected: Boolean(snapshot?.connected),
      syncing: Boolean(snapshot?.syncing),
      totalCount: Number(snapshot?.totalCount) || 0,
      pendingCount: Number(snapshot?.pendingCount) || 0,
      failedCount: Number(snapshot?.failedCount) || 0,
    });
    renderGlobalSyncIndicator(snapshot);
  });
}

function bindNetworkDebug() {
  const state = getShellState();
  if (state.networkDebugBound) return;

  const handleOnline = () => {
    logNetworkDebug("browser:online");
  };
  const handleOffline = () => {
    logNetworkDebug("browser:offline", {}, "warn");
  };

  window.addEventListener("online", handleOnline);
  window.addEventListener("offline", handleOffline);
  logNetworkDebug("boot");
  state.networkDebugBound = true;
}

function updateAppViewportHeightVar() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight || document.documentElement.clientHeight || 0;
  if (!viewportHeight) return;
  document.documentElement.style.setProperty("--app-dvh", `${Math.round(viewportHeight)}px`);
}

function scheduleIdleTask(task, { delayMs = 0, timeout = 4000 } = {}) {
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      const runTask = () => {
        Promise.resolve(task()).catch((error) => {
          console.warn("[shell] tarea idle fallo", error);
        });
      };

      if (typeof window.requestIdleCallback === "function") {
        window.requestIdleCallback(runTask, { timeout });
        return;
      }

      runTask();
    }, delayMs);
  });
}

function bindViewportHeightVar() {
  updateAppViewportHeightVar();
  window.addEventListener("resize", updateAppViewportHeightVar, { passive: true });
  window.addEventListener("orientationchange", updateAppViewportHeightVar, { passive: true });
  window.visualViewport?.addEventListener("resize", updateAppViewportHeightVar, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateAppViewportHeightVar, { passive: true });
}

function shouldWarmLikelyHeavyVendors(viewId) {
  const candidateIds = new Set([
    String(viewId || "").trim(),
    String(getInitialView() || "").trim(),
    String(window.localStorage.getItem(LAST_VIEW_KEY) || "").trim(),
  ]);
  if (![...candidateIds].some((candidateId) => ECHARTS_LIKELY_VIEW_IDS.has(candidateId))) {
    return false;
  }

  const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection || null;
  if (connection?.saveData) return false;
  return document.visibilityState !== "hidden";
}

function scheduleLikelyVendorWarmup(viewId) {
  if (!shouldWarmLikelyHeavyVendors(viewId)) return;

  const state = getShellState();
  if (state.echartsWarmScheduled) return;
  state.echartsWarmScheduled = true;

  scheduleIdleTask(async () => {
    state.echartsWarmScheduled = false;
    const { warmEcharts } = await import("../shared/vendors/echarts.js");
    warmEcharts({ idle: false });
  }, { delayMs: 1200, timeout: 5000 });
}

async function registerAppServiceWorker() {
  if (!("serviceWorker" in navigator)) return null;
  try {
    const swUrl = new URL("../../service-worker.js", import.meta.url);
    return await navigator.serviceWorker.register(swUrl, {
      scope: new URL("../../", import.meta.url).pathname,
    });
  } catch (error) {
    console.warn("[shell] no se pudo registrar el service worker", error);
    return null;
  }
}

const viewModules = {
  "view-books": {
    cssUrl: "../../styles/modules/books.css",
    htmlUrl: "../../views/books.html",
    moduleLoader: () => import("../modules/books/index.js"),
  },
  "view-videos-hub": {
    cssUrl: "../../styles/modules/videos-hub.css",
    htmlUrl: "../../views/videos-hub.html",
    moduleLoader: () => import("../modules/videos-hub/index.js"),
  },
  "view-world": {
    cssUrl: "../../styles/modules/world.css",
    htmlUrl: "../../views/world.html",
    moduleLoader: () => import("../modules/world/index.js"),
  },
  "view-media": {
    cssUrl: "../../styles/modules/media.css",
    htmlUrl: "../../views/media.html",
    moduleLoader: () => import("../modules/media/index.js"),
  },
  "view-recipes": {
    cssUrl: "../../styles/modules/recipes.css",
    htmlUrl: "../../views/recipes.html",
    moduleLoader: () => import("../modules/recipes/index.js"),
  },
  "view-habits": {
    cssUrl: `../../styles/modules/habits.css?v=${HABITS_MODULE_VERSION}`,
    htmlUrl: `../../views/habits.html?v=${HABITS_MODULE_VERSION}`,
    moduleLoader: () => import(`../modules/habits/index.js?v=${HABITS_MODULE_VERSION}`),
  },
  "view-games": {
    cssUrl: "../../styles/modules/games.css",
    htmlUrl: "../../views/games.html",
    moduleLoader: () => import("../modules/games/index.js"),
  },
  "view-finance": {
    cssUrl: "../../styles/modules/finance.css",
    htmlUrl: "../../views/finance.html",
    moduleLoader: () => import("../modules/finance/index.js"),
  },
  "view-improvements": {
    cssUrl: "../../styles/modules/improvements.css",
    htmlUrl: "../../views/improvements.html",
    moduleLoader: () => import("../modules/improvements/index.js"),
  },
  "view-gym": {
    cssUrl: "../../styles/modules/gym.css",
    htmlUrl: "../../views/gym.html",
    moduleLoader: () => import("../modules/gym/index.js"),
  },
};

function getShellState() {
  if (!window[SHELL_STATE_KEY]) {
    window[SHELL_STATE_KEY] = {
      booted: false,
      currentViewId: null,
      navBound: false,
      authBound: false,
      bootSplashReleased: false,
    };
  }

  return window[SHELL_STATE_KEY];
}

function getViews() {
  return Array.from(document.querySelectorAll(".view[id]"));
}

function getViewModuleState(viewId) {
  const state = getShellState();
  if (!state.moduleStates) {
    state.moduleStates = {};
  }

  if (!state.moduleStates[viewId]) {
    state.moduleStates[viewId] = {
      htmlLoaded: false,
      initialized: false,
      module: null,
      pending: null,
      shellPending: null,
      shellFailed: false,
    };
  }

  return state.moduleStates[viewId];
}

function getCurrentViewId() {
  return String(window.__bookshellCurrentViewId || document.documentElement.dataset.currentViewId || "").trim();
}

async function getNavRootResetApi() {
  if (!navRootResetApiPromise) {
    navRootResetApiPromise = import("./nav-root-reset.js").catch((error) => {
      navRootResetApiPromise = null;
      throw error;
    });
  }

  return navRootResetApiPromise;
}

function ensureSessionQuickstartReady() {
  if (!sessionQuickstartPromise) {
    sessionQuickstartPromise = import("./session-quickstart.js")
      .then(({ initSessionQuickstart }) => {
        initSessionQuickstart({ ensureHabitsApi: ensureHabitsApiReady });
        return true;
      })
      .catch((error) => {
        sessionQuickstartPromise = null;
        throw error;
      });
  }

  return sessionQuickstartPromise;
}

async function fetchHtml(htmlUrl, { highPriority = false } = {}) {
  const absoluteUrl = new URL(htmlUrl, import.meta.url);
  const response = await fetch(absoluteUrl, highPriority ? { priority: "high" } : undefined);
  if (!response.ok) {
    throw new Error(`[shell] no se pudo cargar ${absoluteUrl.pathname}`);
  }

  return response.text();
}

function loadStyleOnce(href, { highPriority = false } = {}) {
  const absoluteUrl = new URL(href, import.meta.url).href;
  if (loadedStyles.has(absoluteUrl)) {
    return loadedStyles.get(absoluteUrl);
  }

  const existing = document.querySelector(`link[rel="stylesheet"][href="${absoluteUrl}"]`);
  if (existing) {
    const resolved = Promise.resolve(existing);
    loadedStyles.set(absoluteUrl, resolved);
    return resolved;
  }

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = absoluteUrl;
  if (highPriority && "fetchPriority" in link) {
    link.fetchPriority = "high";
  }

  const pending = new Promise((resolve, reject) => {
    link.addEventListener("load", () => resolve(link), { once: true });
    link.addEventListener("error", () => {
      loadedStyles.delete(absoluteUrl);
      reject(new Error(`[shell] no se pudo cargar la hoja de estilos ${absoluteUrl}`));
    }, { once: true });
  });

  document.head.appendChild(link);
  loadedStyles.set(absoluteUrl, pending);
  return pending;
}

async function callViewHook(viewId, hookName) {
  const moduleState = getShellState().moduleStates?.[viewId];
  const root = document.getElementById(viewId);
  const hook = moduleState?.module?.[hookName];
  if (!root || typeof hook !== "function") return;

  try {
    await hook({ root, viewId });
  } catch (error) {
    console.warn(`[shell] falló ${hookName} en ${viewId}`, error);
  }
}

async function ensureViewShell(viewId, { highPriority = false } = {}) {
  const config = viewModules[viewId];
  if (!config) return null;

  const moduleState = getViewModuleState(viewId);
  const root = document.getElementById(viewId);
  if (!root) return null;

  if (!moduleState.shellPending) {
    moduleState.shellPending = (async () => {
      if (!moduleState.htmlLoaded || moduleState.shellFailed) {
        const shellStartedAt = performance.now();
        logViewInit(viewId, "shell:start", { highPriority });
        try {
          const html = await fetchHtml(config.htmlUrl, { highPriority });
          if (config.cssUrl) {
            try {
              await loadStyleOnce(config.cssUrl, { highPriority });
            } catch (styleError) {
              console.warn(`[shell] no se pudo cargar la hoja de ${viewId}`, styleError);
            }
          }
          root.innerHTML = html;
          moduleState.htmlLoaded = true;
          moduleState.shellFailed = false;
          recordViewMetrics(viewId, {
            shellLoadMs: Math.round(performance.now() - shellStartedAt),
            shellReadyAt: Date.now(),
            shellOfflineFallback: false,
          });
          logViewInit(viewId, "shell:ready", {
            shellLoadMs: Math.round(performance.now() - shellStartedAt),
          });
        } catch (error) {
          moduleState.htmlLoaded = false;
          moduleState.shellFailed = true;
          renderViewUnavailableFallback(
            root,
            viewId,
            navigator.onLine
              ? "No se pudo reconstruir esta vista ahora mismo. Puedes seguir usando el resto de la app."
              : "Esta vista no estÃ¡ cacheada todavÃ­a. Cuando vuelvas a tener red se cargarÃ¡ automÃ¡ticamente.",
          );
          recordViewMetrics(viewId, {
            shellLoadMs: Math.round(performance.now() - shellStartedAt),
            shellReadyAt: Date.now(),
            shellOfflineFallback: true,
            lastError: String(error?.message || error || ""),
          });
          logViewInit(viewId, "shell:error", {
            message: String(error?.message || error || ""),
            stack: String(error?.stack || ""),
          }, "error");
        }
        releaseBootSplashForShell(root);
      } else if (config.cssUrl) {
        await loadStyleOnce(config.cssUrl, { highPriority });
      }
      return root;
    })().finally(() => {
      moduleState.shellPending = null;
    });
  }

  return moduleState.shellPending;
}

async function ensureViewModule(viewId, { runOnShow = true, highPriority = false } = {}) {
  const config = viewModules[viewId];
  if (!config) return null;

  const root = await ensureViewShell(viewId, { highPriority });
  if (!root) return null;

  const moduleState = getViewModuleState(viewId);
  if (!moduleState.pending) {
    moduleState.pending = (async () => {
      try {
        if (!moduleState.module) {
          logViewInit(viewId, "module:import:start", { highPriority });
          moduleState.module = await config.moduleLoader();
          logViewInit(viewId, "module:import:ready", {
            exports: Object.keys(moduleState.module || {}),
          });
        }

        if (!moduleState.initialized && typeof moduleState.module.init === "function") {
          const initStartedAt = performance.now();
          logViewInit(viewId, "module:init:start");
          await moduleState.module.init({ root, viewId });
          moduleState.initialized = true;
          recordViewMetrics(viewId, {
            moduleInitMs: Math.round(performance.now() - initStartedAt),
            moduleReadyAt: Date.now(),
            moduleOfflineFallback: false,
          });
          logViewInit(viewId, "module:init:ready", {
            moduleInitMs: Math.round(performance.now() - initStartedAt),
          });
        }
        return moduleState.module;
      } catch (error) {
        moduleState.module = null;
        moduleState.initialized = false;
        renderViewUnavailableFallback(
          root,
          viewId,
          navigator.onLine
            ? "Esta vista no se pudo inicializar ahora mismo. Si acabas de actualizar la app, recarga para refrescar los modulos en cache."
            : "La shell estÃ¡ disponible, pero esta vista necesita recursos que aÃºn no se han cacheado.",
        );
        recordViewMetrics(viewId, {
          moduleReadyAt: Date.now(),
          moduleOfflineFallback: true,
          lastError: String(error?.message || error || ""),
        });
        logViewInit(viewId, "module:error", {
          message: String(error?.message || error || ""),
          stack: String(error?.stack || ""),
        }, "error");
        console.warn(`[shell] no se pudo inicializar ${viewId}`, error);
        return null;
      }
    })().finally(() => {
      moduleState.pending = null;
    });
  }

  const module = await moduleState.pending;
  if (!module) return null;

  if (runOnShow && typeof module.onShow === "function") {
    const onShowStartedAt = performance.now();
    logViewInit(viewId, "module:onShow:start");
    try {
      await module.onShow({ root, viewId });
      logViewInit(viewId, "module:onShow:ready", {
        onShowMs: Math.round(performance.now() - onShowStartedAt),
      });
    } catch (error) {
      logViewInit(viewId, "module:onShow:error", {
        message: String(error?.message || error || ""),
        stack: String(error?.stack || ""),
        onShowMs: Math.round(performance.now() - onShowStartedAt),
      }, "error");
      throw error;
    }
  }

  return module;
}

function isValidView(viewId) {
  return Boolean(viewId && document.getElementById(viewId)?.classList.contains("view"));
}

function getInitialView() {
  const hashViewId = (window.location.hash || "").replace(/^#/, "");
  if (isValidView(hashViewId)) return hashViewId;

  const storedViewId = window.localStorage.getItem(LAST_VIEW_KEY);
  if (isValidView(storedViewId)) return storedViewId;

  return DEFAULT_VIEW_ID;
}

function sanitizeNavGroupLabel(value) {
  const trimmed = String(value || "").trim().replace(/\s+/g, " ");
  return trimmed.slice(0, 18) || NAV_DEFAULT_GROUP_LABEL;
}

function sanitizeNavGroupEmoji(value) {
  return String(value || "").trim().slice(0, 8);
}

function readStoredNavLayout() {
  try {
    return JSON.parse(window.localStorage.getItem(NAV_LAYOUT_KEY) || "null");
  } catch (_) {
    return null;
  }
}

function hasStoredNavLayout() {
  try {
    return window.localStorage.getItem(NAV_LAYOUT_KEY) != null;
  } catch (_) {
    return false;
  }
}

function writeStoredNavLayout(layout) {
  try {
    window.localStorage.setItem(NAV_LAYOUT_KEY, JSON.stringify(layout));
  } catch (_) {}
}

function getNavLayoutDbPath(uid) {
  return `v2/users/${uid}/meta/ui/navLayout`;
}

function getCurrentNavUserId() {
  return auth.currentUser?.uid || null;
}

function serializeNavLayout(layout) {
  return JSON.stringify(normalizeNavLayout(layout));
}

function areNavLayoutsEqual(a, b) {
  return serializeNavLayout(a) === serializeNavLayout(b);
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function getNavButtonRegistry() {
  const state = getShellState();
  if (Array.isArray(state.navButtonRegistry) && state.navButtonRegistry.length) {
    return state.navButtonRegistry;
  }

  const entries = Array.from(document.querySelectorAll(".bottom-nav .nav-btn[data-view]"))
    .map((button) => {
      const viewId = String(button.dataset.view || "").trim();
      if (!viewId) return null;

      const meta = NAV_VIEW_META[viewId] || {};
      const label = String(button.getAttribute("aria-label") || button.title || meta.label || viewId).trim();
      const glyph = String(button.textContent || meta.glyph || label.slice(0, 1) || NAV_GROUP_EMOJI_FALLBACK).trim();

      return {
        viewId,
        label,
        glyph: glyph || label.slice(0, 1) || NAV_GROUP_EMOJI_FALLBACK,
      };
    })
    .filter(Boolean);

  state.navButtonRegistry = entries;
  state.navButtonMetaById = Object.fromEntries(entries.map((entry) => [entry.viewId, entry]));
  return entries;
}

function getNavButtonMeta(viewId) {
  const state = getShellState();
  if (!state.navButtonMetaById) {
    getNavButtonRegistry();
  }
  return state.navButtonMetaById?.[viewId] || null;
}

function getDefaultNavLayout() {
  return {
    order: getNavButtonRegistry().map(({ viewId }) => viewId),
    groups: {},
  };
}

function normalizeNavLayout(rawLayout = null) {
  const defaultLayout = getDefaultNavLayout();
  const validViewIds = new Set(defaultLayout.order);
  const normalizedGroups = {};
  const groupedViewIds = new Set();
  const rawGroupsSource = rawLayout && typeof rawLayout === "object" ? rawLayout.groups : null;
  const rawGroupEntries = Array.isArray(rawGroupsSource)
    ? rawGroupsSource.map((group, index) => [group?.id || `group-${index + 1}`, group])
    : Object.entries(rawGroupsSource || {});

  rawGroupEntries.forEach(([fallbackId, rawGroup]) => {
    if (!rawGroup || typeof rawGroup !== "object") return;

    const items = [];
    const rawItems = Array.isArray(rawGroup.items) ? rawGroup.items : [];
    rawItems.forEach((item) => {
      const viewId = String(item || "").trim();
      if (!validViewIds.has(viewId) || groupedViewIds.has(viewId) || items.includes(viewId)) return;
      items.push(viewId);
    });

    if (items.length < 2) return;

    let groupId = String(rawGroup.id || fallbackId || "").trim();
    if (!groupId || normalizedGroups[groupId] || validViewIds.has(groupId)) {
      let suffix = Object.keys(normalizedGroups).length + 1;
      do {
        groupId = `group-${suffix}`;
        suffix += 1;
      } while (normalizedGroups[groupId] || validViewIds.has(groupId));
    }

    items.forEach((viewId) => groupedViewIds.add(viewId));
    normalizedGroups[groupId] = {
      id: groupId,
      label: sanitizeNavGroupLabel(rawGroup.label),
      emoji: sanitizeNavGroupEmoji(rawGroup.emoji || rawGroup.icon),
      items,
    };
  });

  const order = [];
  const seenTokens = new Set();
  const rawOrder = Array.isArray(rawLayout?.order) ? rawLayout.order : defaultLayout.order;

  rawOrder.forEach((token) => {
    const entryId = String(token || "").trim();
    if (!entryId || seenTokens.has(entryId)) return;

    if (normalizedGroups[entryId]) {
      order.push(entryId);
      seenTokens.add(entryId);
      return;
    }

    if (validViewIds.has(entryId) && !groupedViewIds.has(entryId)) {
      order.push(entryId);
      seenTokens.add(entryId);
    }
  });

  Object.keys(normalizedGroups).forEach((groupId) => {
    if (seenTokens.has(groupId)) return;
    order.push(groupId);
    seenTokens.add(groupId);
  });

  defaultLayout.order.forEach((viewId) => {
    if (groupedViewIds.has(viewId) || seenTokens.has(viewId)) return;
    order.push(viewId);
    seenTokens.add(viewId);
  });

  return {
    version: NAV_LAYOUT_VERSION,
    order,
    groups: normalizedGroups,
  };
}

function ensureNavLayout() {
  const state = getShellState();
  if (state.navLayout) return state.navLayout;

  const rawLayout = readStoredNavLayout();
  state.navLayout = normalizeNavLayout(rawLayout);
  return state.navLayout;
}

function persistNavLayout() {
  const state = getShellState();
  state.navLayout = normalizeNavLayout(state.navLayout);

  writeStoredNavLayout(state.navLayout);
  void syncNavLayoutToRemote();

  renderBottomNav();
  syncNav(state.currentViewId || getInitialView());
}

async function primeNavLayoutForUser(uid) {
  const state = getShellState();
  if (!uid) {
    state.navLayout = normalizeNavLayout(readStoredNavLayout());
    return state.navLayout;
  }

  let remoteLayout = null;
  try {
    const snap = await get(ref(db, getNavLayoutDbPath(uid)));
    remoteLayout = snap.val();
  } catch (error) {
    console.warn("[shell] no se pudo leer navLayout remoto", error);
  }

  if (remoteLayout && typeof remoteLayout === "object") {
    state.navLayout = normalizeNavLayout(remoteLayout);
    writeStoredNavLayout(state.navLayout);
  } else {
    state.navLayout = normalizeNavLayout(readStoredNavLayout());
  }

  if (state.booted) {
    renderBottomNav();
    syncNav(state.currentViewId || getInitialView());
  }

  return state.navLayout;
}

function stopNavLayoutSync() {
  const state = getShellState();
  if (typeof state.navLayoutUnsubscribe === "function") {
    try {
      state.navLayoutUnsubscribe();
    } catch (_) {}
  }
  state.navLayoutUnsubscribe = null;
  state.navLayoutSyncUid = null;
  state.navLayoutRemoteReady = false;
  state.navLayoutSeededFromLocal = false;
}

function startNavLayoutSync(uid) {
  const state = getShellState();
  if (!uid) {
    stopNavLayoutSync();
    return;
  }

  if (state.navLayoutSyncUid === uid && typeof state.navLayoutUnsubscribe === "function") {
    return;
  }

  stopNavLayoutSync();
  state.navLayoutSyncUid = uid;

  state.navLayoutUnsubscribe = onValue(ref(db, getNavLayoutDbPath(uid)), (snap) => {
    const remoteLayout = snap.val();
    state.navLayoutRemoteReady = true;

    if (remoteLayout && typeof remoteLayout === "object") {
      const normalized = normalizeNavLayout(remoteLayout);
      if (!areNavLayoutsEqual(normalized, state.navLayout)) {
        state.navLayout = normalized;
        writeStoredNavLayout(state.navLayout);
        renderBottomNav();
        syncNav(state.currentViewId || getInitialView());
      }
      return;
    }

    if (hasStoredNavLayout() && !state.navLayoutSeededFromLocal) {
      state.navLayoutSeededFromLocal = true;
      void syncNavLayoutToRemote({ useStoredFallback: true });
    }
  }, (error) => {
    console.warn("[shell] no se pudo escuchar navLayout remoto", error);
  });
}

async function syncNavLayoutToRemote({ useStoredFallback = false } = {}) {
  const state = getShellState();
  const uid = getCurrentNavUserId();
  if (!uid) return;

  const layout = normalizeNavLayout(useStoredFallback ? (readStoredNavLayout() || state.navLayout) : state.navLayout);
  try {
    await update(ref(db, getNavLayoutDbPath(uid)), {
      version: NAV_LAYOUT_VERSION,
      updatedAt: Date.now(),
      order: layout.order,
      groups: layout.groups,
    });
  } catch (error) {
    console.warn("[shell] no se pudo guardar navLayout remoto", error);
  }
}

function getOrderedNavGroups(layout = ensureNavLayout()) {
  return layout.order.map((token) => layout.groups[token]).filter(Boolean);
}

function getTopLevelNavViewIds(layout = ensureNavLayout()) {
  return layout.order.filter((token) => Boolean(getNavButtonMeta(token)));
}

function getNavSelectionSet() {
  const state = getShellState();
  if (!(state.navSelectionTokens instanceof Set)) {
    state.navSelectionTokens = new Set();
  }
  return state.navSelectionTokens;
}

function isNavSelectionMode() {
  return Boolean(getShellState().navSelectionMode);
}

function getNavSelectionStats(layout = ensureNavLayout()) {
  const topLevelTokens = new Set(layout.order);
  const selectedTokens = Array.from(getNavSelectionSet()).filter((token) => topLevelTokens.has(token));
  const selectedViewIds = selectedTokens.filter((token) => Boolean(getNavButtonMeta(token)));
  const selectedGroupIds = selectedTokens.filter((token) => Boolean(layout.groups[token]));
  const canGroup = selectedViewIds.length >= 2 && selectedGroupIds.length === 0;
  const canUngroup = selectedGroupIds.length === 1 && selectedViewIds.length === 0;

  return {
    selectedTokens,
    selectedViewIds,
    selectedGroupIds,
    canGroup,
    canUngroup,
  };
}

function getNavSelectionSummaryText() {
  const { selectedViewIds, selectedGroupIds, canGroup, canUngroup } = getNavSelectionStats();

  if (!selectedViewIds.length && !selectedGroupIds.length) {
    return "Toca las pestañas que quieras agrupar o un grupo para desagruparlo.";
  }

  if (canGroup) {
    return `${selectedViewIds.length} pestañas listas para agrupar.`;
  }

  if (canUngroup) {
    return "Grupo listo para desagrupar.";
  }

  if (selectedGroupIds.length && selectedViewIds.length) {
    return "No mezcles grupos y pestañas en la misma selección.";
  }

  if (selectedViewIds.length === 1) {
    return "Selecciona al menos 2 pestañas para crear un grupo.";
  }

  if (selectedGroupIds.length > 1) {
    return "Selecciona un solo grupo para desagrupar.";
  }

  return "Ajusta la selección para continuar.";
}

function ensureNavSelectionPanel() {
  const state = getShellState();
  if (state.navSelectionPanel) return state.navSelectionPanel;

  const panel = document.createElement("div");
  panel.className = "nav-selection-panel hidden";
  panel.id = "nav-selection-panel";
  document.body.appendChild(panel);
  state.navSelectionPanel = panel;
  return panel;
}

function renderNavSelectionPanel() {
  const panel = ensureNavSelectionPanel();
  const selectionMode = isNavSelectionMode();
  if (!selectionMode) {
    panel.classList.add("hidden");
    panel.innerHTML = "";
    return;
  }

  const { selectedTokens, canGroup, canUngroup } = getNavSelectionStats();
  panel.classList.remove("hidden");
  panel.innerHTML = `
    <div class="nav-selection-panel-card">
      <div class="nav-selection-copy">
        <strong>Modo selección</strong>
        <span>${escapeHtml(getNavSelectionSummaryText())}</span>
      </div>
      <div class="nav-selection-actions">
        <button class="btn ghost btn-compact" data-nav-selection-cancel type="button">Cancelar</button>
        <button class="btn ghost danger btn-compact" data-nav-selection-ungroup type="button"${canUngroup ? "" : " disabled"}>Desagrupar</button>
        <button class="btn primary btn-compact" data-nav-selection-group type="button"${canGroup ? "" : " disabled"}>Agrupar</button>
      </div>
      <div class="hint nav-selection-count">${selectedTokens.length} seleccion${selectedTokens.length === 1 ? "" : "es"}</div>
    </div>
  `;
}

function exitNavSelectionMode() {
  const state = getShellState();
  state.navSelectionMode = false;
  getNavSelectionSet().clear();
  renderBottomNav();
  syncNav(state.currentViewId || getInitialView());
}

function enterNavSelectionMode(initialToken = null) {
  const state = getShellState();
  closeNavGroups();
  state.navSelectionMode = true;
  const selection = getNavSelectionSet();
  selection.clear();
  if (initialToken) selection.add(initialToken);
  renderBottomNav();
  syncNav(state.currentViewId || getInitialView());
  try { window.navigator.vibrate?.(12); } catch (_) {}
}

function toggleNavSelectionToken(token) {
  const layout = ensureNavLayout();
  if (!layout.order.includes(token)) return;

  const selection = getNavSelectionSet();
  if (selection.has(token)) selection.delete(token);
  else selection.add(token);

  renderBottomNav();
  syncNav(getShellState().currentViewId || getInitialView());
}

function ensureNavComposeBackdrop() {
  const state = getShellState();
  if (state.navComposeBackdrop) return state.navComposeBackdrop;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop nav-compose-backdrop hidden";
  backdrop.id = "nav-compose-backdrop";

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-nav-compose-close]")) {
      event.preventDefault();
      closeNavComposeModal();
    }
  });

  backdrop.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-nav-compose-form]")) return;

    event.preventDefault();
    const { selectedViewIds, canGroup } = getNavSelectionStats();
    if (!canGroup) return;

    createNavGroup({
      items: selectedViewIds,
      label: form.elements["nav-group-label"]?.value,
      emoji: form.elements["nav-group-emoji"]?.value,
    });

    closeNavComposeModal();
    exitNavSelectionMode();
  });

  document.body.appendChild(backdrop);
  state.navComposeBackdrop = backdrop;
  return backdrop;
}

function openNavComposeModal() {
  const { selectedViewIds, canGroup } = getNavSelectionStats();
  if (!canGroup) return;

  const backdrop = ensureNavComposeBackdrop();
  const selectedLabels = selectedViewIds
    .map((viewId) => getNavButtonMeta(viewId)?.label)
    .filter(Boolean)
    .join(" · ");

  backdrop.innerHTML = `
    <div class="modal nav-compose-modal" role="dialog" aria-modal="true" aria-labelledby="nav-compose-title">
      <div class="modal-header">
        <div class="modal-title" id="nav-compose-title">Crear grupo</div>
        <button class="icon-btn icon-btn-small" data-nav-compose-close type="button" aria-label="Cerrar">x</button>
      </div>
      <form class="modal-form nav-compose-form" data-nav-compose-form>
        <div class="modal-body nav-compose-body">
          <section class="sheet-section">
            <div class="sheet-section-title">Pestañas seleccionadas</div>
            <p class="nav-compose-summary">${escapeHtml(selectedLabels)}</p>
          </section>
          <section class="sheet-section">
            <label class="field">
              <span>Nombre del grupo</span>
              <input name="nav-group-label" maxlength="18" placeholder="Grupo principal" type="text" value="${escapeHtml(getNextNavGroupLabel())}" />
            </label>
            <label class="field">
              <span>Emoji del grupo</span>
              <input name="nav-group-emoji" maxlength="8" placeholder="🗂️" type="text" value="${escapeHtml(NAV_GROUP_EMOJI_FALLBACK)}" />
            </label>
          </section>
        </div>
        <div class="modal-footer">
          <button class="btn ghost" data-nav-compose-close type="button">Cancelar</button>
          <button class="btn primary" type="submit">Guardar grupo</button>
        </div>
      </form>
    </div>
  `;

  backdrop.classList.remove("hidden");
  document.body.classList.add("has-open-modal");
}

function closeNavComposeModal() {
  const backdrop = getShellState().navComposeBackdrop;
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  document.body.classList.remove("has-open-modal");
}

function ensureNavGroupMenuPortal() {
  const state = getShellState();
  if (state.navGroupMenuPortal) return state.navGroupMenuPortal;

  const portal = document.createElement("div");
  portal.className = "nav-group-menu-portal hidden";
  portal.id = "nav-group-menu-portal";
  document.body.appendChild(portal);
  state.navGroupMenuPortal = portal;
  return portal;
}

function renderNavGroupMenuPortal() {
  const portal = ensureNavGroupMenuPortal();
  const state = getShellState();
  const layout = ensureNavLayout();
  const group = state.openNavGroupId ? layout.groups[state.openNavGroupId] : null;
  const anchor = group ? document.querySelector(`[data-nav-group-toggle="${group.id}"]`) : null;

  if (!group || !anchor || isNavSelectionMode()) {
    portal.classList.add("hidden");
    portal.innerHTML = "";
    return;
  }

  const itemsHtml = group.items.map((viewId) => {
    const meta = getNavButtonMeta(viewId);
    if (!meta) return "";
    const active = state.currentViewId === viewId ? " nav-btn-active" : "";
    return `
      <button class="nav-btn nav-group-item${active}" data-nav-portal-view="${escapeHtml(viewId)}" type="button">
        <span class="nav-group-item-icon">${escapeHtml(meta.glyph)}</span>
        <span class="nav-group-item-label">${escapeHtml(meta.label)}</span>
      </button>
    `;
  }).join("");

  portal.innerHTML = `
    <div class="nav-group-menu-portal-inner" data-nav-group-portal="${escapeHtml(group.id)}">
      <div class="nav-group-menu-head">
        <span class="nav-group-menu-title">${escapeHtml(getNavGroupGlyph(group))} ${escapeHtml(group.label)}</span>
      </div>
      <div class="nav-group-menu-list">${itemsHtml}</div>
      <button class="nav-group-action" data-nav-portal-ungroup="${escapeHtml(group.id)}" type="button">Desagrupar</button>
    </div>
  `;

  const menu = portal.querySelector(".nav-group-menu-portal-inner");
  if (!menu) {
    portal.classList.add("hidden");
    return;
  }

  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
  const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
  const anchorRect = anchor.getBoundingClientRect();
  const maxWidth = Math.min(280, Math.max(220, viewportWidth - (NAV_MENU_MARGIN * 2)));
  const maxHeight = Math.max(140, anchorRect.top - (NAV_MENU_MARGIN * 2));

  menu.style.maxWidth = `${maxWidth}px`;
  menu.style.maxHeight = `${maxHeight}px`;
  portal.classList.remove("hidden");

  const menuRect = menu.getBoundingClientRect();
  const left = Math.max(
    NAV_MENU_MARGIN,
    Math.min(anchorRect.right - menuRect.width, viewportWidth - menuRect.width - NAV_MENU_MARGIN)
  );
  const top = Math.max(NAV_MENU_MARGIN, anchorRect.top - menuRect.height - 8);

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}

function getNavGroupGlyph(group) {
  const emoji = sanitizeNavGroupEmoji(group?.emoji || group?.icon);
  if (emoji) return emoji;
  return NAV_GROUP_EMOJI_FALLBACK;
}

function createNavViewButton(viewId, { grouped = false } = {}) {
  const meta = getNavButtonMeta(viewId);
  if (!meta) return null;

  const button = document.createElement("button");
  button.type = "button";
  button.className = grouped ? "nav-btn nav-group-item" : "nav-btn";
  button.dataset.view = meta.viewId;
  button.title = meta.label;
  button.setAttribute("aria-label", meta.label);

  if (!grouped) {
    button.textContent = meta.glyph;
    return button;
  }

  const icon = document.createElement("span");
  icon.className = "nav-group-item-icon";
  icon.textContent = meta.glyph;

  const label = document.createElement("span");
  label.className = "nav-group-item-label";
  label.textContent = meta.label;

  button.append(icon, label);
  return button;
}

function applyNavGroupOpenState() {
  const state = getShellState();
  document.querySelectorAll(".bottom-nav .nav-group").forEach((groupEl) => {
    const isOpen = groupEl.dataset.navGroup === state.openNavGroupId;
    groupEl.classList.toggle("is-open", isOpen);
    groupEl.querySelector("[data-nav-group-toggle]")?.setAttribute("aria-expanded", String(isOpen));
  });
  renderNavGroupMenuPortal();
}

function closeNavGroups() {
  const state = getShellState();
  if (!state.openNavGroupId) {
    renderNavGroupMenuPortal();
    return;
  }
  state.openNavGroupId = null;
  applyNavGroupOpenState();
}

function toggleNavGroupMenu(groupId) {
  const state = getShellState();
  const layout = ensureNavLayout();
  if (!layout.groups[groupId]) return;
  if (isNavSelectionMode()) return;
  state.openNavGroupId = state.openNavGroupId === groupId ? null : groupId;
  applyNavGroupOpenState();
}

function renderBottomNav() {
  const nav = document.querySelector(".bottom-nav");
  if (!nav) return;

  const state = getShellState();
  const layout = ensureNavLayout();
  const selectionMode = isNavSelectionMode();
  const selection = getNavSelectionSet();
  const fragment = document.createDocumentFragment();

  layout.order.forEach((token) => {
    const meta = getNavButtonMeta(token);
    if (meta) {
      const button = createNavViewButton(meta.viewId);
      if (button) {
        button.dataset.navToken = meta.viewId;
        button.dataset.navTokenKind = "view";
        button.classList.toggle("nav-btn-selection-mode", selectionMode);
        button.classList.toggle("is-selected", selection.has(meta.viewId));
        fragment.appendChild(button);
      }
      return;
    }

    const group = layout.groups[token];
    if (!group) return;

    const wrap = document.createElement("div");
    wrap.className = "nav-group";
    wrap.dataset.navGroup = group.id;

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "nav-btn nav-group-toggle";
    toggle.dataset.navGroupToggle = group.id;
    toggle.dataset.navToken = group.id;
    toggle.dataset.navTokenKind = "group";
    toggle.title = group.label;
    toggle.setAttribute("aria-label", `${group.label}. Abrir grupo.`);
    toggle.setAttribute("aria-haspopup", "menu");
    toggle.setAttribute("aria-expanded", "false");
    toggle.classList.toggle("nav-btn-selection-mode", selectionMode);
    toggle.classList.toggle("is-selected", selection.has(group.id));

    const toggleMain = document.createElement("span");
    toggleMain.className = "nav-group-toggle-main";

    const glyph = document.createElement("span");
    glyph.className = "nav-group-toggle-icon";
    glyph.textContent = getNavGroupGlyph(group);

    const label = document.createElement("span");
    label.className = "nav-group-toggle-label";
    label.textContent = group.label;

    const caret = document.createElement("span");
    caret.className = "nav-group-toggle-caret";
    caret.setAttribute("aria-hidden", "true");
    caret.textContent = "v";

    toggleMain.append(glyph, label);
    toggle.append(toggleMain, caret);

    wrap.append(toggle);
    fragment.appendChild(wrap);
  });

  nav.replaceChildren(fragment);
  nav.classList.toggle("is-selection-mode", selectionMode);

  if (state.openNavGroupId && !layout.groups[state.openNavGroupId]) {
    state.openNavGroupId = null;
  }

  applyNavGroupOpenState();
  renderNavSelectionPanel();
}

function createNavGroup({ items = [], label = "", emoji = "" }) {
  const state = getShellState();
  const layout = ensureNavLayout();
  const selected = Array.from(new Set(items.map((item) => String(item || "").trim())))
    .filter((viewId) => Boolean(getNavButtonMeta(viewId)) && layout.order.includes(viewId));

  if (selected.length < 2) return false;

  const insertIndex = Math.min(...selected.map((viewId) => layout.order.indexOf(viewId)).filter((index) => index >= 0));
  if (!Number.isFinite(insertIndex)) return false;

  let groupId = "";
  let suffix = 1;
  const stamp = Date.now().toString(36);
  do {
    groupId = `group-${stamp}-${suffix}`;
    suffix += 1;
  } while (layout.groups[groupId]);

  state.navLayout = {
    order: layout.order.filter((token) => !selected.includes(token)),
    groups: {
      ...layout.groups,
      [groupId]: {
        id: groupId,
        label: sanitizeNavGroupLabel(label),
        emoji: sanitizeNavGroupEmoji(emoji),
        items: selected,
      },
    },
  };

  state.navLayout.order.splice(insertIndex, 0, groupId);
  persistNavLayout();
  return true;
}

function ungroupNavGroup(groupId) {
  const state = getShellState();
  const layout = ensureNavLayout();
  const group = layout.groups[groupId];
  if (!group) return false;

  const insertIndex = layout.order.indexOf(groupId);
  const nextGroups = { ...layout.groups };
  delete nextGroups[groupId];

  state.navLayout = {
    order: layout.order.filter((token) => token !== groupId),
    groups: nextGroups,
  };

  if (insertIndex >= 0) {
    state.navLayout.order.splice(insertIndex, 0, ...group.items);
  } else {
    state.navLayout.order.push(...group.items);
  }

  if (state.openNavGroupId === groupId) {
    state.openNavGroupId = null;
  }

  persistNavLayout();
  return true;
}

function getNextNavGroupLabel() {
  return `${NAV_DEFAULT_GROUP_LABEL} ${getOrderedNavGroups().length + 1}`;
}

function updateNavManagerSelectionState() {
  const backdrop = getShellState().navManagerBackdrop;
  if (!backdrop || backdrop.classList.contains("hidden")) return;

  const form = backdrop.querySelector("[data-nav-manager-form]");
  if (!form) return;

  const totalOptions = form.querySelectorAll('input[name="nav-group-item"]').length;
  const selectedCount = form.querySelectorAll('input[name="nav-group-item"]:checked').length;
  const createButton = form.querySelector("[data-nav-create-group]");
  const summary = form.querySelector("[data-nav-manager-selection]");

  if (createButton) {
    createButton.disabled = selectedCount < 2;
  }

  if (summary) {
    if (totalOptions < 2) {
      summary.textContent = "Necesitas 2 botones sueltos para crear un grupo.";
    } else {
      summary.textContent = selectedCount >= 2
        ? `${selectedCount} botones listos para agrupar.`
        : "Selecciona al menos 2 botones.";
    }
  }
}

function renderNavManager() {
  const backdrop = ensureNavManagerBackdrop();
  const layout = ensureNavLayout();
  const topLevelViewIds = getTopLevelNavViewIds(layout);
  const groups = getOrderedNavGroups(layout);
  const canCreateGroup = topLevelViewIds.length >= 2;

  const optionsHtml = topLevelViewIds.length
    ? topLevelViewIds.map((viewId) => {
      const meta = getNavButtonMeta(viewId);
      if (!meta) return "";
      return `
        <label class="nav-manage-option">
          <input type="checkbox" name="nav-group-item" value="${escapeHtml(viewId)}" />
          <span class="nav-manage-option-icon">${escapeHtml(meta.glyph)}</span>
          <span class="nav-manage-option-label">${escapeHtml(meta.label)}</span>
        </label>
      `;
    }).join("")
    : '<div class="nav-manage-empty">No hay suficientes botones sueltos para crear otro grupo.</div>';

  const groupsHtml = groups.length
    ? groups.map((group) => `
      <article class="nav-manage-group-card">
        <div class="nav-manage-group-head">
          <div class="nav-manage-group-title">
            <span class="nav-manage-group-glyph">${escapeHtml(getNavGroupGlyph(group))}</span>
            <span>${escapeHtml(group.label)}</span>
          </div>
          <div class="nav-manage-tags">
            ${group.items.map((viewId) => {
              const meta = getNavButtonMeta(viewId);
              if (!meta) return "";
              return `
                <span class="nav-manage-tag">
                  <span class="nav-manage-tag-icon">${escapeHtml(meta.glyph)}</span>
                  <span>${escapeHtml(meta.label)}</span>
                </span>
              `;
            }).join("")}
          </div>
        </div>
        <button class="btn ghost danger btn-compact" data-nav-manager-ungroup="${escapeHtml(group.id)}" type="button">Desagrupar</button>
      </article>
    `).join("")
    : '<div class="nav-manage-empty">Todavia no has creado grupos.</div>';

  backdrop.innerHTML = `
    <div class="modal nav-manage-modal" role="dialog" aria-modal="true" aria-labelledby="nav-manage-title">
      <div class="modal-header">
        <div class="modal-title" id="nav-manage-title">Agrupar navegacion</div>
        <button class="icon-btn icon-btn-small" data-nav-manager-close type="button" aria-label="Cerrar">x</button>
      </div>
      <form class="modal-form nav-manage-form" data-nav-manager-form>
        <div class="modal-body nav-manage-body">
          <section class="sheet-section">
            <div class="sheet-section-title">Crear grupo</div>
            <label class="field">
              <span>Nombre del grupo</span>
              <input name="nav-group-label" maxlength="18" placeholder="Grupo principal" type="text" value="${escapeHtml(getNextNavGroupLabel())}" />
            </label>
            <label class="field">
              <span>Emoji del grupo</span>
              <input name="nav-group-icon" maxlength="8" placeholder="${escapeHtml(NAV_GROUP_EMOJI_FALLBACK)}" type="text" />
            </label>
            <div class="nav-manage-options">${optionsHtml}</div>
            <div class="hint nav-manage-selection" data-nav-manager-selection>
              ${canCreateGroup ? "Selecciona al menos 2 botones." : "Necesitas 2 botones sueltos para crear un grupo."}
            </div>
          </section>
          <section class="sheet-section">
            <div class="sheet-section-title">Grupos creados</div>
            <div class="nav-manage-groups">${groupsHtml}</div>
          </section>
        </div>
        <div class="modal-footer">
          <button class="btn ghost" data-nav-manager-close type="button">Cerrar</button>
          <button class="btn primary" data-nav-create-group type="submit"${canCreateGroup ? "" : " disabled"}>Agrupar</button>
        </div>
      </form>
    </div>
  `;

  updateNavManagerSelectionState();
}

function ensureNavManagerBackdrop() {
  const state = getShellState();
  if (state.navManagerBackdrop) return state.navManagerBackdrop;

  const backdrop = document.createElement("div");
  backdrop.className = "modal-backdrop nav-manage-backdrop hidden";
  backdrop.id = "nav-manage-backdrop";

  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target.closest("[data-nav-manager-close]")) {
      event.preventDefault();
      closeNavManager();
      return;
    }

    const ungroupButton = event.target.closest("[data-nav-manager-ungroup]");
    if (!ungroupButton) return;

    event.preventDefault();
    const groupId = String(ungroupButton.dataset.navManagerUngroup || "").trim();
    if (!groupId) return;

    ungroupNavGroup(groupId);
    renderNavManager();
  });

  backdrop.addEventListener("submit", (event) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches("[data-nav-manager-form]")) return;

    event.preventDefault();
    const selectedItems = Array.from(form.querySelectorAll('input[name="nav-group-item"]:checked'))
      .map((input) => input.value);

    if (selectedItems.length < 2) {
      updateNavManagerSelectionState();
      return;
    }

    createNavGroup({
      items: selectedItems,
      label: form.elements["nav-group-label"]?.value,
      emoji: form.elements["nav-group-icon"]?.value,
    });
    renderNavManager();
  });

  backdrop.addEventListener("change", (event) => {
    if (!(event.target instanceof HTMLInputElement) || event.target.name !== "nav-group-item") return;
    updateNavManagerSelectionState();
  });

  document.body.appendChild(backdrop);
  state.navManagerBackdrop = backdrop;
  return backdrop;
}

function openNavManager() {
  closeNavGroups();
  renderNavManager();
  const backdrop = ensureNavManagerBackdrop();
  backdrop.classList.remove("hidden");
  document.body.classList.add("has-open-modal");
}

function closeNavManager() {
  const backdrop = getShellState().navManagerBackdrop;
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  document.body.classList.remove("has-open-modal");
}

function clearNavLongPress() {
  const state = getShellState();
  if (state.navLongPressTimer) {
    window.clearTimeout(state.navLongPressTimer);
  }
  state.navLongPressTimer = null;
  state.navLongPressPointerId = null;
  state.navLongPressToken = null;
  state.navLongPressStartX = null;
  state.navLongPressStartY = null;
}

function startNavLongPress(event) {
  if (isNavSelectionMode()) return;
  if (event.button != null && event.button !== 0) return;

  const trigger = event.target?.closest?.(".bottom-nav [data-nav-token]");
  if (!trigger) return;

  const state = getShellState();
  clearNavLongPress();
  state.navLongPressPointerId = event.pointerId ?? null;
  state.navLongPressToken = String(trigger.dataset.navToken || "").trim();
  state.navLongPressStartX = Number(event.clientX || 0);
  state.navLongPressStartY = Number(event.clientY || 0);
  state.navLongPressTriggered = false;
  state.navLongPressTimer = window.setTimeout(() => {
    state.navLongPressTriggered = true;
    state.navSuppressClickUntil = performance.now() + 700;
    enterNavSelectionMode(state.navLongPressToken);
    clearNavLongPress();
  }, NAV_LONG_PRESS_MS);
}

function syncCurrentViewState(viewId) {
  const nextViewId = String(viewId || "").trim();
  window.__bookshellCurrentViewId = nextViewId;
  document.documentElement.dataset.currentViewId = nextViewId;
}

function getNavSelectionTokenFromTarget(target) {
  return String(target?.closest?.(".bottom-nav [data-nav-token]")?.dataset?.navToken || "").trim();
}

function initNavCustomization() {
  getNavButtonRegistry();
  ensureNavLayout();
  ensureNavSelectionPanel();
  ensureNavGroupMenuPortal();
  ensureNavComposeBackdrop();
  window.__bookshellNavigateToView = (viewId, options = {}) => setView(viewId, options);
  renderBottomNav();
}

function syncNav(viewId) {
  document.querySelectorAll(".bottom-nav .nav-btn[data-view]").forEach((button) => {
    const isActive = button.dataset.view === viewId;
    button.classList.toggle("nav-btn-active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });

  const layout = ensureNavLayout();
  document.querySelectorAll(".bottom-nav [data-nav-group-toggle]").forEach((button) => {
    const groupId = button.dataset.navGroupToggle;
    const isActive = Boolean(groupId && layout.groups[groupId]?.items.includes(viewId));
    button.classList.toggle("nav-btn-active", isActive);
  });

  applyNavGroupOpenState();
}

function syncViews(viewId) {
  syncCurrentViewState(viewId);
  getViews().forEach((view) => {
    const isActive = view.id === viewId;
    view.classList.toggle("view-active", isActive);
    view.setAttribute("aria-hidden", String(!isActive));

    if (!isActive) {
      view.scrollTop = 0;
    }
  });
  window.scrollTo(0, 0);
}

async function maybeResetTabToRoot(viewId) {
  if (!viewId || getCurrentViewId() !== String(viewId).trim()) return;

  try {
    const { resetTabToRoot } = await getNavRootResetApi();
    await resetTabToRoot(viewId);
  } catch (error) {
    console.warn("[shell] no se pudo resetear la pestaña", error);
  }
}

async function setView(viewId, { pushHash = true, highPriority = false } = {}) {
  if (!isValidView(viewId)) return;

  const state = getShellState();
  const viewSwitchStartedAt = performance.now();
  closeNavGroups();
  if (state.currentViewId === viewId) {
    syncNav(viewId);
    syncViews(viewId);
    await ensureViewModule(viewId, { highPriority });
    recordViewMetrics(viewId, {
      lastShowMs: Math.round(performance.now() - viewSwitchStartedAt),
      lastShownAt: Date.now(),
    });
    return;
  }

  const previousViewId = state.currentViewId;
  if (previousViewId) {
    await callViewHook(previousViewId, "onHide");
  }

  syncViews(viewId);
  syncNav(viewId);
  await ensureViewModule(viewId, { highPriority });
  recordViewMetrics(viewId, {
    lastShowMs: Math.round(performance.now() - viewSwitchStartedAt),
    lastShownAt: Date.now(),
  });

  state.currentViewId = viewId;
  window.localStorage.setItem(LAST_VIEW_KEY, viewId);
  scheduleLikelyVendorWarmup(viewId);

  if (pushHash) {
    const nextHash = `#${viewId}`;
    if (window.location.hash !== nextHash) {
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
      } catch (_) {
        window.location.hash = nextHash;
      }
    }
  }
}

function bindNav() {
  const state = getShellState();
  if (state.navBound) return;

  document.addEventListener("click", (event) => {
    const suppressLongPressClick = performance.now() < Number(state.navSuppressClickUntil || 0);
    if (suppressLongPressClick && event.target?.closest?.(".bottom-nav [data-nav-token]")) {
      event.preventDefault();
      return;
    }

    if (event.target?.closest?.("[data-nav-selection-cancel]")) {
      event.preventDefault();
      exitNavSelectionMode();
      return;
    }

    if (event.target?.closest?.("[data-nav-selection-group]")) {
      event.preventDefault();
      openNavComposeModal();
      return;
    }

    if (event.target?.closest?.("[data-nav-selection-ungroup]")) {
      event.preventDefault();
      const { selectedGroupIds, canUngroup } = getNavSelectionStats();
      if (canUngroup && selectedGroupIds[0]) {
        ungroupNavGroup(selectedGroupIds[0]);
        exitNavSelectionMode();
      }
      return;
    }

    const portalUngroupButton = event.target?.closest?.("[data-nav-portal-ungroup]");
    if (portalUngroupButton) {
      event.preventDefault();
      const groupId = String(portalUngroupButton.dataset.navPortalUngroup || "").trim();
      if (!groupId) return;
      ungroupNavGroup(groupId);
      return;
    }

    const portalViewButton = event.target?.closest?.("[data-nav-portal-view]");
    if (portalViewButton) {
      event.preventDefault();
      const nextViewId = String(portalViewButton.dataset.navPortalView || "").trim();
      if (!isValidView(nextViewId)) return;
      void (async () => {
        await maybeResetTabToRoot(nextViewId);
        await setView(nextViewId);
      })();
      return;
    }

    if (isNavSelectionMode()) {
      const token = getNavSelectionTokenFromTarget(event.target);
      if (token) {
        event.preventDefault();
        toggleNavSelectionToken(token);
        return;
      }
    }

    const ungroupButton = event.target?.closest?.("[data-nav-ungroup]");
    if (ungroupButton) {
      event.preventDefault();
      const groupId = String(ungroupButton.dataset.navUngroup || "").trim();
      if (!groupId) return;
      ungroupNavGroup(groupId);
      return;
    }

    const groupToggle = event.target?.closest?.("[data-nav-group-toggle]");
    if (groupToggle) {
      event.preventDefault();
      const groupId = String(groupToggle.dataset.navGroupToggle || "").trim();
      if (!groupId) return;
      toggleNavGroupMenu(groupId);
      return;
    }

    const button = event.target?.closest?.(".bottom-nav .nav-btn[data-view]");
    if (!button) {
      if (!event.target?.closest?.(".bottom-nav .nav-group") && !event.target?.closest?.("#nav-group-menu-portal")) {
        closeNavGroups();
      }
      return;
    }

    const nextViewId = button.dataset.view;
    if (!isValidView(nextViewId)) return;

    event.preventDefault();
    void (async () => {
      await maybeResetTabToRoot(nextViewId);
      await setView(nextViewId);
    })();
  }, true);

  document.addEventListener("pointerdown", (event) => {
    startNavLongPress(event);
  }, true);

  document.addEventListener("pointermove", (event) => {
    if (state.navLongPressPointerId == null || event.pointerId !== state.navLongPressPointerId) return;
    const dx = Math.abs(Number(event.clientX || 0) - Number(state.navLongPressStartX || 0));
    const dy = Math.abs(Number(event.clientY || 0) - Number(state.navLongPressStartY || 0));
    if (dx > 12 || dy > 12) {
      clearNavLongPress();
    }
  }, true);

  document.addEventListener("pointerup", clearNavLongPress, true);
  document.addEventListener("pointercancel", clearNavLongPress, true);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;

    const composeOpen = Boolean(getShellState().navComposeBackdrop && !getShellState().navComposeBackdrop.classList.contains("hidden"));
    if (composeOpen) {
      closeNavComposeModal();
      return;
    }

    const navManagerBackdrop = getShellState().navManagerBackdrop;
    const managerOpen = Boolean(navManagerBackdrop && !navManagerBackdrop.classList.contains("hidden"));
    if (managerOpen) {
      closeNavManager();
      return;
    }

    if (isNavSelectionMode()) {
      exitNavSelectionMode();
      return;
    }

    closeNavGroups();
  });

  window.addEventListener("hashchange", () => {
    void setView(getInitialView(), { pushHash: false });
  });

  window.addEventListener("resize", () => {
    closeNavGroups();
    renderNavSelectionPanel();
  }, { passive: true });

  state.navBound = true;
}

function getBootSplash() {
  return window.__bookshellBootSplash || null;
}

function setBootPhase(text, progressHint) {
  try {
    getBootSplash()?.setPhase?.(text, progressHint);
  } catch (_) {}
}

function finishBootSplash() {
  getShellState().bootSplashReleased = true;
  try {
    getBootSplash()?.done?.();
  } catch (_) {}
}

function releaseBootSplashForShell(root) {
  const state = getShellState();
  if (state.bootSplashReleased) return;
  if (!root?.classList?.contains?.("view-active")) return;
  requestAnimationFrame(() => finishBootSplash());
}

function warmInitialViewShell() {
  const viewId = getInitialView();
  if (!isValidView(viewId)) return;

  void ensureViewShell(viewId, { highPriority: true }).catch((error) => {
    console.warn(`[shell] no se pudo adelantar la shell de ${viewId}`, error);
  });
}

function ensureLoginUI() {
  if (document.getElementById("loginBox")) return;

  const box = document.createElement("div");
  box.id = "loginBox";
  box.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    display: grid; place-items: center;
    background: rgba(0,0,0,.55); backdrop-filter: blur(10px);
  `;

  box.innerHTML = `
    <div style="width:min(420px,92vw); padding:16px; border-radius:16px;
      background: rgba(12,20,44,.88); border:1px solid rgba(160,220,255,.25);
      box-shadow: 0 20px 60px rgba(0,0,0,.45); display:grid; gap:10px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="font-weight:700">Bookshell · Login</div>
        <button id="btnLogout" title="Cerrar sesión"
          style="padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);
          background:rgba(255,255,255,.08);color:#fff; display:none;">Salir</button>
      </div>

      <input id="loginEmail" placeholder="Email"
        style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.06);color:#fff;">

      <input id="loginPass" type="password" placeholder="Password"
        style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.06);color:#fff;">

      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button id="btnSignup"
          style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);
          background:rgba(255,255,255,.08);color:#fff;">Crear cuenta</button>

        <button id="btnLogin"
          style="padding:10px 12px;border-radius:10px;border:1px solid rgba(160,220,255,.35);
          background:rgba(160,220,255,.12);color:#fff;">Entrar</button>
      </div>

      <small id="loginErr" style="opacity:.85; color:#ffd1d1;"></small>
    </div>
  `;
  document.body.appendChild(box);

  const err = box.querySelector("#loginErr");
  box.querySelector("#btnLogin").onclick = async () => {
    err.textContent = "";
    const email = box.querySelector("#loginEmail").value.trim();
    const pass = box.querySelector("#loginPass").value;
    try { await signInWithEmail(email, pass); }
    catch (e) { err.textContent = e?.message || String(e); }
  };

  box.querySelector("#btnSignup").onclick = async () => {
    err.textContent = "";
    const email = box.querySelector("#loginEmail").value.trim();
    const pass = box.querySelector("#loginPass").value;
    try { await signUpWithEmail(email, pass); }
    catch (e) { err.textContent = e?.message || String(e); }
  };

  box.querySelector("#btnLogout").onclick = async () => {
    err.textContent = "";
    try { await signOutCurrentUser(); }
    catch (e) { err.textContent = e?.message || String(e); }
  };
}

async function ensureUserSchema(uid) {
  const root = `v2/users/${uid}`;
  const snap = await get(ref(db, root));
  if (snap.exists()) return;

  const now = Date.now();
  await update(ref(db, root), {
    meta: { schemaVersion: 2, createdAt: now },
    books: { _init: true },
    videos: { _init: true },
    videosHub: { _init: true },
    recipes: { _init: true },
    habits: { _init: true },
    games: { _init: true },
    movies: { _init: true },
    trips: { _init: true },
    finance: { _init: true },
    improvements: {
      items: { _init: true },
    },
    gym: { _init: true },
  });
}

function getActiveHabitSessionsPath(uid) {
  return `v2/users/${uid}/habits/habits/activeSessions`;
}

async function hasRemoteActiveHabitSession(uid) {
  if (!uid) return false;
  try {
    const snap = await get(ref(db, getActiveHabitSessionsPath(uid)));
    const raw = snap.val();
    return !!(raw && typeof raw === "object" && Object.keys(raw).length);
  } catch (error) {
    console.warn("[habits] no se pudo comprobar la sesión activa", error);
    return false;
  }
}

function preloadViewModule(viewId) {
  const state = getShellState();
  if (!state.preloadPromises) state.preloadPromises = {};
  if (state.preloadPromises[viewId]) return state.preloadPromises[viewId];

  state.preloadPromises[viewId] = ensureViewModule(viewId, { runOnShow: false })
    .catch((error) => {
      console.warn(`[shell] no se pudo precargar ${viewId}`, error);
      return null;
    })
    .finally(() => {
      state.preloadPromises[viewId] = null;
    });

  return state.preloadPromises[viewId];
}

async function ensureHabitsApiReady() {
  const readyApi = window.__bookshellHabits;
  if (readyApi && typeof readyApi.startHabitSessionUniversal === "function") {
    return readyApi;
  }

  await preloadViewModule(HABITS_VIEW_ID);
  const api = window.__bookshellHabits;
  return (api && typeof api.startHabitSessionUniversal === "function") ? api : null;
}

function bootShell() {
  const state = getShellState();
  if (state.booted) return;

  initNavCustomization();
  bindNav();
  bindGlobalSyncIndicator();
  state.booted = true;
}

function schedulePostBootTask(task, delayMs = 0) {
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      Promise.resolve(task()).catch((error) => {
        console.warn("[shell] tarea post-boot falló", error);
      });
    }, delayMs);
  });
}

function bindAuthGate() {
  const state = getShellState();
  if (state.authBound) return;

  setBootPhase("Inicializando…", 12);

  onUserChange(async (user) => {
    if (!user) {
      void notifySyncUserChanged();
      if (state.currentViewId) {
        await callViewHook(state.currentViewId, "onHide");
        state.currentViewId = null;
        syncCurrentViewState("");
      }
      stopNavLayoutSync();
      closeNavComposeModal();
      closeNavGroups();
      if (isNavSelectionMode()) exitNavSelectionMode();
      setBootPhase("Conectando…", 32);
      ensureLoginUI();
      finishBootSplash();
      return;
    }

    setBootPhase("Conectando…", 38);

    void notifySyncUserChanged();
    document.getElementById("loginBox")?.remove();

    void ensureUserSchema(user.uid).catch((error) => {
      console.warn("[schema] seed failed", error);
    });

    void primeNavLayoutForUser(user.uid)
      .catch((error) => {
        console.warn("[shell] no se pudo preparar navLayout inicial", error);
      })
      .finally(() => {
        startNavLayoutSync(user.uid);
      });

    setBootPhase("Cargando datos…", 62);

    const viewId = getInitialView();
    try {
      await setView(viewId, { pushHash: true, highPriority: true });
      setBootPhase("Preparando interfaz…", 78);
    } finally {
      requestAnimationFrame(() => finishBootSplash());
    }

    schedulePostBootTask(() => {
      if (auth.currentUser?.uid !== user.uid) return;
      bootShell();
    }, 0);

    schedulePostBootTask(() => {
      if (auth.currentUser?.uid !== user.uid) return;
      return ensureSessionQuickstartReady();
    }, 0);

    schedulePostBootTask(async () => {
      if (auth.currentUser?.uid !== user.uid) return;
      if (viewId === HABITS_VIEW_ID) return;
      const hasActiveSession = await hasRemoteActiveHabitSession(user.uid);
      if (!hasActiveSession) return;
      await preloadViewModule(HABITS_VIEW_ID);
    }, 180);

    recordAppBootMetrics({
      initialLoadMs: Math.round(performance.now() - APP_BOOT_TS),
      authenticatedAt: Date.now(),
      initialViewId: viewId,
    });
    console.log("[auth] uid", user.uid);
    console.log("[perf] app-initial-load-ms", Math.round(performance.now() - APP_BOOT_TS));
  });

  state.authBound = true;
}

warmInitialViewShell();
void initSyncManager({
  db,
  getUserId: () => auth.currentUser?.uid || "",
});
bindSyncIndicatorToggles();
bindAuthGate();
bindViewportHeightVar();
bindNetworkDebug();
bindGlobalSyncIndicator();
scheduleIdleTask(() => registerAppServiceWorker(), { delayMs: 600, timeout: 3000 });
window.__bookshellEnsureHabitsApi = ensureHabitsApiReady;
