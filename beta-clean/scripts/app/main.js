import {
  auth,
  db,
  firebasePaths,
  getCurrentUserDataRootKey,
  getUserDataRootKey,
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
import {
  initAchievementsService,
  trackAchievementViewVisit,
} from "../shared/services/achievements/index.js";
import { initGeneralCenterService } from "../shared/services/general-center/index.js";
import { applyTheme, getAvailableThemes, getCurrentTheme, initThemeService } from "../shared/services/theme/index.js";
import { registerPublicCatalogMigrationDebugApi } from "../shared/services/public-catalog-migration.js";
import { cleanupViewListeners, clearFirebaseMetrics, exposeFirebaseReadDebug, getFirebaseMetricsSnapshot, logFirebaseRead, registerViewListener } from "../shared/firebase/read-debug.js";

const LAST_VIEW_KEY = "bookshell:lastView";
const NAV_LAYOUT_KEY = "bookshell:navLayout:v1";
const NAV_LAYOUT_VERSION = 4;
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
exposeFirebaseReadDebug();
const NAV_DEFAULT_GROUP_LABEL = "Grupo";
const NAV_GROUP_EMOJI_FALLBACK = "🗂️";
const NAV_LONG_PRESS_MS = 420;
const NAV_MENU_MARGIN = 10;
const NAV_VIEW_META = {
  "view-books": { label: "Libros", shortLabel: "Libros" },
  "view-notes": { label: "Notas", shortLabel: "Notas" },
  "view-videos-hub": { label: "Videos", shortLabel: "Videos" },
  "view-recipes": { label: "Recetas", shortLabel: "Comida" },
  "view-habits": { label: "Habitos", shortLabel: "Hoy" },
  "view-games": { label: "Juegos", shortLabel: "Juegos" },
  "view-media": { label: "Media", shortLabel: "Media" },
  "view-world": { label: "Mundo", shortLabel: "Mundo" },
  "view-finance": { label: "Cuentas", shortLabel: "Gastos" },
  "view-improvements": { label: "Mejoras", shortLabel: "Fix" },
  "view-gym": { label: "Gym", shortLabel: "Gym" },
};
const LEGACY_DEFAULT_NAV_ORDER = Object.freeze([
  "view-books",
  "view-notes",
  "view-videos-hub",
  "view-recipes",
  "view-habits",
  "view-games",
  "view-media",
  "view-world",
  "view-finance",
  "view-improvements",
  "view-gym",
]);
const RECOMMENDED_NAV_ORDER = Object.freeze([
  HABITS_VIEW_ID,
  "view-books",
  "view-notes",
  "group-media",
  "group-more",
]);
const RECOMMENDED_NAV_GROUPS = Object.freeze({
  "group-media": {
    id: "group-media",
    label: "Media",
    emoji: "M",
    items: ["view-videos-hub", "view-media", "view-games", "view-world"],
  },
  "group-more": {
    id: "group-more",
    label: "Mas",
    emoji: "+",
    items: ["view-recipes", "view-finance", "view-improvements", "view-gym"],
  },
});
const APP_PERF_STORE_KEY = "__bookshellPerfMetrics";
const HABITS_MODULE_VERSION = "2026-04-05-v7";
const NOTES_MODULE_VERSION = "2026-04-28-v2";
const GLOBAL_QUICK_FAB_ACTIONS = Object.freeze([
  { key: "books", label: "Leer", viewId: "view-books" },
  { key: "improvements", label: "Fix", viewId: "view-improvements" },
  { key: "media", label: "Media", viewId: "view-media" },
  { key: "notes", label: "Nota", viewId: "view-notes" },
  { key: "videos", label: "Video", viewId: "view-videos-hub" },
  { key: "gym", label: "Gym", viewId: "view-gym" },
  { key: "recipes", label: "Comida", viewId: "view-recipes" },
  { key: "finance", label: "Gasto", viewId: "view-finance" },
]);

registerPublicCatalogMigrationDebugApi();

function getGlobalQuickFabIconMarkup(actionKey) {
  if (actionKey === "books") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M6 5.5A2.5 2.5 0 0 1 8.5 3H18v17h-9.5A2.5 2.5 0 0 0 6 22Z" />
        <path d="M6 5.5V22" />
        <path d="M9.5 7.5H15" />
      </svg>
    `;
  }

  if (actionKey === "improvements") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M14.5 6.5a4.5 4.5 0 0 0 2.8 4.16l-6.14 6.14a2 2 0 1 1-2.83-2.83l6.14-6.14A4.5 4.5 0 0 0 17.5 3l-2.09 2.09-.91-.59-.59-.91L16 1.5a4.48 4.48 0 0 0-1.5 5Z" />
      </svg>
    `;
  }

  if (actionKey === "media") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="5" width="16" height="14" rx="2" />
        <path d="M8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4" />
      </svg>
    `;
  }

  if (actionKey === "notes") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M8 4h8l4 4v10a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z" />
        <path d="M14 4v4h4M9 13h6M9 17h4" />
      </svg>
    `;
  }

  if (actionKey === "videos") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <rect x="4" y="6" width="12" height="12" rx="2" />
        <path d="m16 10 4-2v8l-4-2M10 10.5l3 1.9-3 1.9Z" />
      </svg>
    `;
  }

  if (actionKey === "gym") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M5 9v6M8 7v10M16 7v10M19 9v6M8 12h8" />
        <path d="M3 10v4M21 10v4" />
      </svg>
    `;
  }

  if (actionKey === "recipes") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M7 4v7M10 4v7M7 11a3 3 0 0 0 3 3v6M15 4v8a2 2 0 0 0 2 2v6M15 8h2" />
      </svg>
    `;
  }

  if (actionKey === "finance") {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5Z" />
        <path d="M4 9h16M15.5 14h.01M13 14h.01" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 5v14M5 12h14" />
    </svg>
  `;
}

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

function describeViewInitError(error) {
  return {
    errorName: String(error?.name || ""),
    message: String(error?.message || error || ""),
    stack: String(error?.stack || ""),
    cause: error?.cause ? String(error.cause?.message || error.cause || "") : "",
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
  if (typeof logger === "function") {
    logger.call(console, `[view:init] ${viewId} ${phase}`, payload);
  } else {
    console.log(`[view:init] ${viewId} ${phase}`, payload);
  }
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
  const detail = String(message || "").trim() || "El contenido de esta vista no está disponible sin conexión en este dispositivo.";
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

function ensureSyncIndicatorActionsNode(indicator) {
  if (!(indicator instanceof HTMLElement)) return null;

  let actionsNode = indicator.querySelector(".app-sync-indicator__actions");
  if (actionsNode) return actionsNode;

  actionsNode = document.createElement("span");
  actionsNode.className = "app-sync-indicator__actions";
  indicator.append(actionsNode);
  return actionsNode;
}

function logPwaEvent(event, detail = {}) {
  console.info(`[pwa] ${event}`, {
    at: new Date().toISOString(),
    ...detail,
  });
}

function logSettingsEvent(event, detail = {}) {
  console.info(`[settings] ${event}`, {
    at: new Date().toISOString(),
    ...detail,
  });
}

function getVisibleShellModalCount() {
  return document.querySelectorAll(".modal-backdrop:not(.hidden), .nav-manage-backdrop:not(.hidden), .nav-compose-backdrop:not(.hidden)").length;
}

function syncShellModalLock() {
  document.body.classList.toggle("has-open-modal", getVisibleShellModalCount() > 0);
}

function hideLegacyThemeControl() {
  document.getElementById("app-theme-switcher")?.remove();
  document.getElementById("app-theme-panel")?.remove();
  document.getElementById("app-theme-panel-backdrop")?.remove();
}

async function hardResetApp() {
  const ok = window.confirm("Esto recargará la app y limpiará caché de archivos. No borra tus datos.");
  if (!ok) return;
  logSettingsEvent("hard-reset:start");
  console.info("[hard-reset] starting");
  try {
    if ("serviceWorker" in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
      console.info("[hard-reset] service workers unregistered", regs.length);
    }
    if ("caches" in window) {
      const keys = await caches.keys();
      const appKeys = keys.filter((key) => /bookshell|bookshelf|pwa|static|assets|vite|app/i.test(key));
      await Promise.all(appKeys.map((key) => caches.delete(key)));
      console.info("[hard-reset] caches deleted", appKeys);
      logSettingsEvent("hard-reset:cache-cleared", {
        caches: appKeys,
      });
    }
  } catch (error) {
    console.warn("[hard-reset] partial failure", error);
  }
  const cleanPath = `${location.origin}${location.pathname}`;
  logSettingsEvent("hard-reset:reload", {
    cleanPath,
  });
  location.replace(`${cleanPath}?hardReset=${Date.now()}`);
}

function ensureHardResetSyncAction(indicator) {
  const actionsNode = ensureSyncIndicatorActionsNode(indicator);
  if (!(actionsNode instanceof HTMLElement)) return;
  if (actionsNode.querySelector("[data-hard-reset-app]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "app-theme-switcher__trigger";
  button.dataset.hardResetApp = "true";
  button.setAttribute("aria-label", "Hard reset y recarga de app");
  button.textContent = "⚡ Hard reset / Recargar app";
  actionsNode.append(button);
}

const SYNC_METRIC_MODULE_ORDER = Object.freeze([
  { key: "finance", label: "Finanzas" },
  { key: "habits", label: "Habitos" },
  { key: "recipes", label: "Recetas" },
  { key: "gym", label: "Gym" },
  { key: "world", label: "Mundo" },
  { key: "books", label: "Libros" },
  { key: "games", label: "Juegos" },
  { key: "notes", label: "Notas/Recordatorios" },
  { key: "videos-hub", label: "Videos" },
  { key: "media", label: "Media" },
  { key: "improvements", label: "Mejoras" },
  { key: "shell", label: "Shell" },
]);

function formatMetricBytes(bytes = 0) {
  const safe = Math.max(0, Number(bytes) || 0);
  if (safe >= 1024 * 1024) return `${(safe / (1024 * 1024)).toFixed(2)} MB`;
  if (safe >= 1024) return `${(safe / 1024).toFixed(1)} KB`;
  return `${safe} B`;
}

function formatMetricRelativeTime(ts = 0) {
  const safeTs = Number(ts || 0);
  if (!safeTs) return "Nunca";
  const diffMs = Math.max(0, Date.now() - safeTs);
  if (diffMs < 60 * 1000) return "Hace <1 min";
  if (diffMs < 60 * 60 * 1000) return `Hace ${Math.round(diffMs / (60 * 1000))} min`;
  if (diffMs < 24 * 60 * 60 * 1000) return `Hace ${Math.round(diffMs / (60 * 60 * 1000))} h`;
  return `Hace ${Math.round(diffMs / (24 * 60 * 60 * 1000))} d`;
}

function ensureSyncIconAction(actionsNode, {
  id,
  icon,
  title,
  ariaLabel,
  datasetKey,
  onClick,
} = {}) {
  if (!(actionsNode instanceof HTMLElement) || !id) return null;
  let button = actionsNode.querySelector(`#${id}`);
  if (button) return button;
  button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = "app-sync-menu__button";
  button.textContent = icon || "•";
  button.title = title || ariaLabel || "";
  button.setAttribute("aria-label", ariaLabel || title || "");
  if (datasetKey) button.dataset[datasetKey] = "true";
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onClick?.(event);
  });
  actionsNode.append(button);
  return button;
}

function closeSyncIndicatorMenu() {
  const indicator = document.getElementById("app-sync-indicator");
  setSyncIndicatorExpanded(indicator, false);
}

function normalizeSyncIndicatorShortcuts(indicator) {
  if (!(indicator instanceof HTMLElement)) return;
  hideLegacyThemeControl();
  indicator.querySelector("[data-hard-reset-app]")?.remove();

  const achievementsBtn = indicator.querySelector("#app-achievements-btn");
  if (achievementsBtn instanceof HTMLElement) {
    achievementsBtn.setAttribute("title", "Logros");
    achievementsBtn.setAttribute("aria-label", "Abrir logros");
  }

  const generalBtn = indicator.querySelector("#app-general-btn");
  if (generalBtn instanceof HTMLElement) {
    generalBtn.setAttribute("title", "Misiones");
    generalBtn.setAttribute("aria-label", "Abrir misiones");
    const text = generalBtn.querySelector(".app-general-btn__text");
    if (text) text.textContent = "Misiones";
  }
}

function orderSyncIndicatorActions(indicator) {
  const actionsNode = ensureSyncIndicatorActionsNode(indicator);
  if (!(actionsNode instanceof HTMLElement)) return;
  [
    "#app-achievements-btn",
    "#app-general-btn",
    "#app-reminder-notifications-btn",
    "#app-sync-settings-btn",
    "#app-sync-metrics-btn",
  ].forEach((selector) => {
    const node = actionsNode.querySelector(selector);
    if (node) actionsNode.append(node);
  });
}

function closeSettingsModal() {
  const backdrop = document.getElementById("app-settings-backdrop");
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  syncShellModalLock();
}

async function renderSettingsModal() {
  const body = document.getElementById("app-settings-body");
  if (!(body instanceof HTMLElement)) return;

  let storageEstimate = null;
  try {
    storageEstimate = await navigator.storage?.estimate?.();
  } catch (_) {}

  const themeButtons = getAvailableThemes().map((theme) => `
    <button
      type="button"
      class="app-settings-themeBtn ${getCurrentTheme() === theme.id ? "is-active" : ""}"
      data-settings-theme="${theme.id}"
      aria-pressed="${getCurrentTheme() === theme.id ? "true" : "false"}"
    >${theme.label}</button>
  `).join("");

  body.innerHTML = `
    <section class="app-settings-section">
      <div class="app-settings-section__eyebrow">Tema y apariencia</div>
      <h3>Tema activo: ${getCurrentTheme()}</h3>
      <div class="app-settings-themeGrid">${themeButtons}</div>
    </section>
    <section class="app-settings-section">
      <div class="app-settings-section__eyebrow">Notificaciones</div>
      <div class="app-settings-section__actions">
        <button type="button" class="app-settings-actionBtn" data-settings-open-notifications>Abrir panel de notificaciones</button>
      </div>
    </section>
    <section class="app-settings-section">
      <div class="app-settings-section__eyebrow">Cache local</div>
      <div class="app-settings-kpis">
        <div class="app-settings-kpi">
          <small>Ultima vista</small>
          <strong>${window.localStorage.getItem(LAST_VIEW_KEY) || DEFAULT_VIEW_ID}</strong>
        </div>
        <div class="app-settings-kpi">
          <small>Uso navegador</small>
          <strong>${storageEstimate?.usage ? formatMetricBytes(storageEstimate.usage) : "No disponible"}</strong>
        </div>
      </div>
    </section>
    <section class="app-settings-section">
      <div class="app-settings-section__eyebrow">Limpieza fuerte</div>
      <p>El hard reset limpia caches del service worker y fuerza una recarga limpia. No borra tus datos de Firebase.</p>
      <div class="app-settings-section__actions">
        <button type="button" class="app-settings-dangerBtn" data-settings-hard-reset>Hard reset</button>
      </div>
    </section>
  `;
}

function ensureSettingsModal() {
  let backdrop = document.getElementById("app-settings-backdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "app-settings-backdrop";
  backdrop.className = "modal-backdrop app-settings-backdrop hidden";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.innerHTML = `
    <section class="modal app-settings-modal" role="dialog" aria-modal="true" aria-labelledby="app-settings-title">
      <header class="modal-header app-settings-modal__header">
        <div>
          <div class="app-settings-modal__eyebrow">Global</div>
          <div class="modal-title" id="app-settings-title">Ajustes</div>
        </div>
        <button class="btn-x" type="button" aria-label="Cerrar ajustes" data-settings-close>✕</button>
      </header>
      <div class="modal-body app-settings-modal__body" id="app-settings-body"></div>
    </section>
  `;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target?.closest?.("[data-settings-close]")) {
      closeSettingsModal();
    }
  });
  backdrop.addEventListener("click", (event) => {
    const themeButton = event.target?.closest?.("[data-settings-theme]");
    if (themeButton) {
      applyTheme(themeButton.dataset.settingsTheme || "");
      void renderSettingsModal();
      return;
    }
    if (event.target?.closest?.("[data-settings-open-notifications]")) {
      window.__bookshellNotes?.openReminderNotificationsPanel?.();
      return;
    }
    if (event.target?.closest?.("[data-settings-hard-reset]")) {
      hardResetApp();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.classList.contains("hidden")) {
      closeSettingsModal();
    }
  });
  document.body.append(backdrop);
  return backdrop;
}

function openSettingsModal() {
  const backdrop = ensureSettingsModal();
  if (!backdrop) return;
  logSettingsEvent("open");
  closeMetricsModal();
  closeSyncIndicatorMenu();
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  syncShellModalLock();
  void renderSettingsModal();
}

function getMetricsPanelState() {
  const state = getShellState();
  if (!state.metricsPanelState) {
    state.metricsPanelState = {
      rangeKey: "10m",
    };
  }
  return state.metricsPanelState;
}

function buildModuleMetricCards(snapshot) {
  const moduleMap = new Map((snapshot?.modules || []).map((module) => [module.module, module]));
  return SYNC_METRIC_MODULE_ORDER.map((entry) => {
    const module = moduleMap.get(entry.key) || {
      module: entry.key,
      label: entry.label,
      getCount: 0,
      listenerStarts: 0,
      listenerEvents: 0,
      bytesReceived: 0,
      cacheBytes: 0,
      activeListeners: 0,
      duplicateListeners: 0,
      riskyReads: 0,
      lastReadAt: 0,
      paths: [],
    };
    return {
      ...module,
      label: module.label || entry.label,
    };
  });
}

async function renderMetricsModal() {
  const body = document.getElementById("app-metrics-body");
  if (!(body instanceof HTMLElement)) return;

  const metricsState = getMetricsPanelState();
  const snapshot = getFirebaseMetricsSnapshot(metricsState.rangeKey);
  let storageEstimate = null;
  try {
    storageEstimate = await navigator.storage?.estimate?.();
  } catch (_) {}

  const modules = buildModuleMetricCards(snapshot);
  const rangeButtons = [
    ["1m", "1m"],
    ["10m", "10m"],
    ["1h", "1h"],
    ["24h", "24h"],
    ["1w", "1 sem"],
    ["1mo", "1 mes"],
    ["since-start", "Inicio"],
  ].map(([key, label]) => `
    <button
      type="button"
      class="app-metrics-rangeBtn ${metricsState.rangeKey === key ? "is-active" : ""}"
      data-metrics-range="${key}"
      aria-pressed="${metricsState.rangeKey === key ? "true" : "false"}"
    >${label}</button>
  `).join("");

  const alertsMarkup = snapshot.alerts?.length
    ? snapshot.alerts.map((alert) => `
      <li>
        <strong>${alert.module || "modulo"}</strong>
        <span>${alert.message}</span>
      </li>
    `).join("")
    : '<li><strong>OK</strong><span>No se detectaron alertas en este rango.</span></li>';

  const moduleMarkup = modules.map((module) => `
    <details class="app-metrics-module">
      <summary>
        <span>${module.label}</span>
        <span>${formatMetricBytes(module.bytesReceived)} · ${module.activeListeners} listeners</span>
      </summary>
      <div class="app-metrics-module__grid">
        <div><small>get()</small><strong>${module.getCount}</strong></div>
        <div><small>Listeners activos</small><strong>${module.activeListeners}</strong></div>
        <div><small>Eventos</small><strong>${module.listenerEvents}</strong></div>
        <div><small>Cache local</small><strong>${formatMetricBytes(module.cacheBytes)}</strong></div>
        <div><small>Duplicados</small><strong>${module.duplicateListeners}</strong></div>
        <div><small>Ultima lectura</small><strong>${formatMetricRelativeTime(module.lastReadAt)}</strong></div>
      </div>
      <div class="app-metrics-pathList">
        ${(module.paths || []).slice(0, 5).map((pathRow) => `
          <article>
            <code>${pathRow.path}</code>
            <small>${pathRow.readCount} eventos · ${formatMetricBytes(pathRow.bytes)}${pathRow.risks?.length ? ` · riesgo: ${pathRow.risks.join(", ")}` : ""}</small>
          </article>
        `).join("") || '<article><small>Sin lecturas registradas todavia.</small></article>'}
      </div>
    </details>
  `).join("");

  body.innerHTML = `
    <section class="app-metrics-section">
      <div class="app-metrics-section__top">
        <div class="app-metrics-section__eyebrow">Rango</div>
        <div class="app-metrics-rangeRow">${rangeButtons}</div>
      </div>
      <div class="app-metrics-kpis">
        <div class="app-metrics-kpi"><small>Bytes Firebase</small><strong>${formatMetricBytes(snapshot.totals.bytesReceived)}</strong></div>
        <div class="app-metrics-kpi"><small>get()</small><strong>${snapshot.totals.getCount}</strong></div>
        <div class="app-metrics-kpi"><small>Listeners activos</small><strong>${snapshot.totals.activeListeners}</strong></div>
        <div class="app-metrics-kpi"><small>Eventos listener</small><strong>${snapshot.totals.listenerEvents}</strong></div>
        <div class="app-metrics-kpi"><small>Cache local</small><strong>${formatMetricBytes(snapshot.totals.cacheBytes)}</strong></div>
        <div class="app-metrics-kpi"><small>Uso navegador</small><strong>${storageEstimate?.usage ? formatMetricBytes(storageEstimate.usage) : "No disponible"}</strong></div>
      </div>
    </section>
    <section class="app-metrics-section">
      <div class="app-metrics-section__top">
        <div class="app-metrics-section__eyebrow">Alertas</div>
        <button type="button" class="app-settings-actionBtn" data-metrics-clear>Limpiar metricas</button>
      </div>
      <ul class="app-metrics-alerts">${alertsMarkup}</ul>
    </section>
    <section class="app-metrics-section">
      <div class="app-metrics-section__eyebrow">Por pestaña</div>
      <div class="app-metrics-moduleList">${moduleMarkup}</div>
    </section>
  `;
}

function closeMetricsModal() {
  const backdrop = document.getElementById("app-metrics-backdrop");
  if (!backdrop) return;
  backdrop.classList.add("hidden");
  backdrop.setAttribute("aria-hidden", "true");
  syncShellModalLock();
}

function ensureMetricsModal() {
  let backdrop = document.getElementById("app-metrics-backdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "app-metrics-backdrop";
  backdrop.className = "modal-backdrop app-metrics-backdrop hidden";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.innerHTML = `
    <section class="modal app-metrics-modal" role="dialog" aria-modal="true" aria-labelledby="app-metrics-title">
      <header class="modal-header app-metrics-modal__header">
        <div>
          <div class="app-metrics-modal__eyebrow">Firebase y almacenamiento</div>
          <div class="modal-title" id="app-metrics-title">Metricas</div>
        </div>
        <button class="btn-x" type="button" aria-label="Cerrar metricas" data-metrics-close>✕</button>
      </header>
      <div class="modal-body app-metrics-modal__body" id="app-metrics-body"></div>
    </section>
  `;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target?.closest?.("[data-metrics-close]")) {
      closeMetricsModal();
      return;
    }
    const rangeButton = event.target?.closest?.("[data-metrics-range]");
    if (rangeButton) {
      getMetricsPanelState().rangeKey = rangeButton.dataset.metricsRange || "10m";
      void renderMetricsModal();
      return;
    }
    if (event.target?.closest?.("[data-metrics-clear]")) {
      clearFirebaseMetrics();
      void renderMetricsModal();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !backdrop.classList.contains("hidden")) {
      closeMetricsModal();
    }
  });
  document.body.append(backdrop);
  return backdrop;
}

function openMetricsModal() {
  const backdrop = ensureMetricsModal();
  if (!backdrop) return;
  closeSettingsModal();
  closeSyncIndicatorMenu();
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  syncShellModalLock();
  void renderMetricsModal();
}

function ensureSettingsSyncAction(indicator) {
  const actionsNode = ensureSyncIndicatorActionsNode(indicator);
  return ensureSyncIconAction(actionsNode, {
    id: "app-sync-settings-btn",
    icon: "⚙",
    title: "Ajustes",
    ariaLabel: "Abrir ajustes",
    datasetKey: "syncSettingsBtn",
    onClick: () => openSettingsModal(),
  });
}

function ensureMetricsSyncAction(indicator) {
  const actionsNode = ensureSyncIndicatorActionsNode(indicator);
  return ensureSyncIconAction(actionsNode, {
    id: "app-sync-metrics-btn",
    icon: "📊",
    title: "Metricas",
    ariaLabel: "Abrir metricas",
    datasetKey: "syncMetricsBtn",
    onClick: () => openMetricsModal(),
  });
}

function setSyncIndicatorExpanded(indicator, isOpen) {
  if (!(indicator instanceof HTMLElement)) return;
  indicator.classList.toggle("is-open", isOpen);
  indicator.setAttribute("aria-expanded", String(isOpen));
}

function prepareSyncIndicator(indicator) {
  if (!(indicator instanceof HTMLElement)) return null;

  const textNode = ensureSyncIndicatorTextNode(indicator);
  ensureSyncIndicatorActionsNode(indicator);
  hideLegacyThemeControl();
  indicator.querySelector("[data-hard-reset-app]")?.remove();
  ensureReminderNotificationsButton(indicator);
  ensureSettingsSyncAction(indicator);
  ensureMetricsSyncAction(indicator);
  normalizeSyncIndicatorShortcuts(indicator);
  orderSyncIndicatorActions(indicator);
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
    text = "Sin conexión";
    tone = "offline";
  }

  const timeLabel = formatSyncTimestamp(snapshot?.lastSyncAt);
  const indicatorText = timeLabel && tone === "synced" ? `${text} · ${timeLabel}` : text;
  indicator.dataset.state = tone;
  textNode.textContent = indicatorText;
  indicator.setAttribute("aria-label", `Estado de sincronización: ${indicatorText}`);
  indicator.classList.remove("hidden");
  updateReminderBadge(indicator);
}

function ensureReminderNotificationsButton(indicator) {
  const actionsNode = ensureSyncIndicatorActionsNode(indicator);
  if (!(actionsNode instanceof HTMLElement)) return null;
  let button = actionsNode.querySelector("#app-reminder-notifications-btn");
  if (button) {
    button.className = "app-sync-menu__button";
    button.textContent = "🔔";
    button.title = "Notificaciones";
    button.setAttribute("aria-label", "Abrir notificaciones");
    return button;
  }
  button = document.createElement("button");
  button.id = "app-reminder-notifications-btn";
  button.className = "app-sync-menu__button";
  button.type = "button";
  button.textContent = "🔔";
  button.title = "Notificaciones";
  button.setAttribute("aria-label", "Abrir notificaciones");
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    window.__bookshellNotes?.openReminderNotificationsPanel?.();
  });
  actionsNode.append(button);
  return button;
}

function updateReminderBadge(indicator) {
  if (!(indicator instanceof HTMLElement)) return;
  let badge = indicator.querySelector(".app-sync-indicator__badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "app-sync-indicator__badge hidden";
    indicator.append(badge);
  }
  const pending = Number(window.__bookshellReminderPendingToday || 0);
  badge.textContent = String(pending);
  badge.classList.toggle("hidden", pending <= 0);
}

function bindSyncIndicatorToggles() {
  const state = getShellState();
  if (state.syncIndicatorToggleBound) return;

  document.querySelectorAll(".app-sync-indicator").forEach((indicator) => {
    prepareSyncIndicator(indicator);
    setSyncIndicatorExpanded(indicator, indicator.classList.contains("is-open"));
  });

  document.addEventListener("click", (event) => {
    const hardResetButton = event.target?.closest?.("[data-hard-reset-app]");
    if (hardResetButton instanceof HTMLElement) {
      event.preventDefault();
      event.stopPropagation();
      hardResetApp();
      return;
    }
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
    state.lastSyncSnapshot = snapshot || null;
    window.__bookshellLastSyncSnapshot = state.lastSyncSnapshot;
    try {
      window.dispatchEvent(new CustomEvent("bookshell:sync-state", {
        detail: state.lastSyncSnapshot,
      }));
    } catch (_) {}
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
  "view-notes": {
    cssUrl: `../../styles/modules/notes.css?v=${NOTES_MODULE_VERSION}`,
    htmlUrl: `../../views/notes.html?v=${NOTES_MODULE_VERSION}`,
    moduleLoader: () => import(`../modules/notes/index.js?v=${NOTES_MODULE_VERSION}`),
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

function logRestoreLastViewOnce(viewId) {
  const state = getShellState();
  if (!viewId || state.lastRestoredViewId === viewId) return;
  state.lastRestoredViewId = viewId;
  logPwaEvent("restore:last-view", { viewId });
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

  const existing = Array.from(document.querySelectorAll('link[rel="stylesheet"]'))
    .find((node) => node.href === absoluteUrl);
  if (existing) {
    const resolved = Promise.resolve(existing);
    loadedStyles.set(absoluteUrl, resolved);
    return resolved;
  }

  const preloaded = Array.from(document.querySelectorAll('link[rel="preload"][as="style"]'))
    .find((node) => node.href === absoluteUrl);
  if (preloaded) {
    preloaded.rel = "stylesheet";
    if (highPriority && "fetchPriority" in preloaded) {
      preloaded.fetchPriority = "high";
    }
    const resolved = Promise.resolve(preloaded);
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
          const errorDebug = describeViewInitError(error);
          logViewInit(viewId, "shell:error", errorDebug, "error");
          moduleState.htmlLoaded = false;
          moduleState.shellFailed = true;
          renderViewUnavailableFallback(
            root,
            viewId,
            navigator.onLine
              ? "No se pudo reconstruir esta vista ahora mismo. Puedes seguir usando el resto de la app."
              : "Esta vista no está cacheada todaví­a. Cuando vuelvas a tener red se cargará automáticamente.",
          );
          recordViewMetrics(viewId, {
            shellLoadMs: Math.round(performance.now() - shellStartedAt),
            shellReadyAt: Date.now(),
            shellOfflineFallback: true,
            lastError: errorDebug.message,
          });
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
        const errorDebug = describeViewInitError(error);
        logViewInit(viewId, "module:error", {
          stage: "import/init",
          ...errorDebug,
        }, "error");
        console.error(`[shell] no se pudo inicializar ${viewId}`, error);
        moduleState.module = null;
        moduleState.initialized = false;
        renderViewUnavailableFallback(
          root,
          viewId,
          navigator.onLine
            ? "Esta vista no se pudo inicializar ahora mismo. Si acabas de actualizar la app, recarga para refrescar los modulos en cache."
            : "La shell está disponible, pero esta vista necesita recursos que aíºn no se han cacheado.",
        );
        recordViewMetrics(viewId, {
          moduleReadyAt: Date.now(),
          moduleOfflineFallback: true,
          lastError: errorDebug.message,
        });
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
        ...describeViewInitError(error),
        onShowMs: Math.round(performance.now() - onShowStartedAt),
      }, "error");
      if (!moduleState.onShowRetryInFlight) {
        moduleState.onShowRetryInFlight = true;
        moduleState.initialized = false;
        try {
          root.innerHTML = "";
          logViewInit(viewId, "module:onShow:retry", {
            reason: "onShow failed; forcing module reinit",
          }, "warn");
          const retriedModule = await ensureViewModule(viewId, {
            runOnShow: true,
            highPriority: true,
          });
          return retriedModule || null;
        } catch (retryError) {
          logViewInit(viewId, "module:onShow:retry:error", {
            ...describeViewInitError(retryError),
          }, "error");
        } finally {
          moduleState.onShowRetryInFlight = false;
        }
      }
      renderViewUnavailableFallback(
        root,
        viewId,
        "Esta vista encontró un error al mostrarse. Se aplicó una recuperación automática y puedes cambiar de pestaña sin reiniciar la app.",
      );
      return null;
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
  if (isValidView(storedViewId)) {
    logRestoreLastViewOnce(storedViewId);
    return storedViewId;
  }

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

function getNavLayoutDbPath(authUid) {
  return firebasePaths.navLayout(authUid);
}

function getCurrentNavUserRootKey() {
  return getCurrentUserDataRootKey() || null;
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
      const shortLabel = String(meta.shortLabel || label).trim();
      const glyph = String(button.textContent || meta.glyph || label.slice(0, 1) || NAV_GROUP_EMOJI_FALLBACK).trim();

      return {
        viewId,
        label,
        shortLabel,
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

function cloneRecommendedNavGroups() {
  return Object.fromEntries(
    Object.entries(RECOMMENDED_NAV_GROUPS).map(([groupId, group]) => [
      groupId,
      {
        id: group.id,
        label: group.label,
        emoji: group.emoji,
        items: [...group.items],
      },
    ]),
  );
}

function buildRecommendedNavLayout() {
  return {
    version: NAV_LAYOUT_VERSION,
    order: [...RECOMMENDED_NAV_ORDER],
    groups: cloneRecommendedNavGroups(),
  };
}

function getRawGroupCount(rawLayout = null) {
  if (!rawLayout || typeof rawLayout !== "object") return 0;
  if (Array.isArray(rawLayout.groups)) return rawLayout.groups.length;
  if (rawLayout.groups && typeof rawLayout.groups === "object") {
    return Object.keys(rawLayout.groups).length;
  }
  return 0;
}

function isLegacyDefaultTopLevelLayout(rawLayout = null) {
  const rawOrder = Array.isArray(rawLayout?.order)
    ? rawLayout.order.map((token) => String(token || "").trim()).filter(Boolean)
    : [];
  if (rawOrder.length !== LEGACY_DEFAULT_NAV_ORDER.length) return false;
  return LEGACY_DEFAULT_NAV_ORDER.every((viewId, index) => rawOrder[index] === viewId);
}

function removeHomeFromLegacyLayout(rawLayout = null) {
  if (!rawLayout || typeof rawLayout !== "object") {
    return buildRecommendedNavLayout();
  }

  const rawOrder = Array.isArray(rawLayout.order) ? rawLayout.order : [];
  const rawGroups = rawLayout.groups && typeof rawLayout.groups === "object" ? rawLayout.groups : {};
  return {
    ...rawLayout,
    version: NAV_LAYOUT_VERSION,
    order: rawOrder.filter((token) => String(token || "").trim() && String(token || "").trim() !== "view-home"),
    groups: Object.fromEntries(
      Object.entries(rawGroups).map(([groupId, group]) => [
        groupId,
        {
          ...(group || {}),
          items: Array.isArray(group?.items)
            ? group.items.filter((item) => String(item || "").trim() !== "view-home")
            : [],
        },
      ]),
    ),
  };
}

function migrateLegacyNavLayout(rawLayout = null, defaultLayout = buildRecommendedNavLayout()) {
  if (!rawLayout || typeof rawLayout !== "object") {
    return defaultLayout;
  }

  const version = Number(rawLayout.version) || 0;
  if (version >= NAV_LAYOUT_VERSION) {
    return rawLayout;
  }

  if (!getRawGroupCount(rawLayout) && isLegacyDefaultTopLevelLayout(rawLayout)) {
    return defaultLayout;
  }

  return removeHomeFromLegacyLayout(rawLayout);
}

function getDefaultNavLayout() {
  return buildRecommendedNavLayout();
}

function normalizeNavLayout(rawLayout = null) {
  const defaultLayout = buildRecommendedNavLayout();
  const layoutSource = migrateLegacyNavLayout(rawLayout, defaultLayout);
  const validViewIds = new Set(getNavButtonRegistry().map(({ viewId }) => viewId));
  const normalizedGroups = {};
  const groupedViewIds = new Set();
  const rawGroupsSource = layoutSource && typeof layoutSource === "object" ? layoutSource.groups : null;
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
  const rawOrder = Array.isArray(layoutSource?.order) ? layoutSource.order : defaultLayout.order;

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

async function primeNavLayoutForUser(authUid) {
  const state = getShellState();
  if (!authUid) {
    state.navLayout = normalizeNavLayout(readStoredNavLayout());
    return state.navLayout;
  }

  let remoteLayout = null;
  try {
    logFirebaseRead({ path: getNavLayoutDbPath(authUid), mode: "get", reason: "load-nav-layout", viewId: "shell" });
    const snap = await get(ref(db, getNavLayoutDbPath(authUid)));
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

function startNavLayoutSync(authUid) {
  const state = getShellState();
  if (!authUid) {
    stopNavLayoutSync();
    return;
  }

  if (state.navLayoutSyncUid === authUid && typeof state.navLayoutUnsubscribe === "function") {
    return;
  }

  stopNavLayoutSync();
  state.navLayoutSyncUid = authUid;

  logFirebaseRead({ path: getNavLayoutDbPath(authUid), mode: "onValue", reason: "watch-nav-layout", viewId: "shell" });
  state.navLayoutUnsubscribe = registerViewListener("shell", onValue(ref(db, getNavLayoutDbPath(authUid)), (snap) => {
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
  }), {
    key: "nav-layout",
    path: getNavLayoutDbPath(authUid),
    mode: "onValue",
    reason: "watch-nav-layout",
  });
}

async function syncNavLayoutToRemote({ useStoredFallback = false } = {}) {
  const state = getShellState();
  const authUid = getCurrentNavUserRootKey();
  if (!authUid) return;

  const layout = normalizeNavLayout(useStoredFallback ? (readStoredNavLayout() || state.navLayout) : state.navLayout);
  try {
    await update(ref(db, getNavLayoutDbPath(authUid)), {
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
        <button class="btn-cancelar-creacion-grupo" data-nav-selection-cancel type="button">Cancelar</button>
        <button class="btn-agrupar-creacion-grupo" data-nav-selection-group type="button"${canGroup ? "" : " disabled"}>Agrupar</button>
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
        <button class="btn-x icon-btn-small" data-nav-compose-close type="button" aria-label="Cerrar">x</button>
      </div>
      <form class="modal-form nav-compose-form" data-nav-compose-form>
        <div class="modal-body nav-compose-body" id="modal-crear-grupo-navegacion">
          <section class="sheet-section" id="paneles-crear-grupo-navegacion">
            <div class="sheet-section-title">Pestañas seleccionadas</div>
            <p class="nav-compose-summary">${escapeHtml(selectedLabels)}</p>
          </section>
          <section class="sheet-section" id="meta-crear-grupo-navegacion">
            <label class="field" id="nombre-crear-grupo-navegacion">
              <input name="nav-group-label" maxlength="18" placeholder="Grupo principal" type="text" value="${escapeHtml(getNextNavGroupLabel())}" />
            </label>
            <label class="field" id="emoji-crear-grupo-navegacion">
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
    const icon = document.createElement("span");
    icon.className = "nav-btn-icon";
    icon.setAttribute("aria-hidden", "true");
    icon.textContent = meta.glyph;

    const label = document.createElement("span");
    label.className = "nav-btn-label";
    label.textContent = meta.shortLabel || meta.label;

    button.append(icon, label);
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
        <button class="btn-x icon-btn-small" data-nav-manager-close type="button" aria-label="Cerrar">x</button>
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
  document.querySelectorAll(".bottom-nav .nav-group").forEach((groupEl) => {
    groupEl.classList.remove("nav-group-active");
  });
  document.querySelectorAll(".bottom-nav [data-nav-group-toggle]").forEach((button) => {
    const groupId = button.dataset.navGroupToggle;
    const isActive = Boolean(groupId && layout.groups[groupId]?.items.includes(viewId));
    button.classList.toggle("nav-btn-active", isActive);
    button.closest(".nav-group")?.classList.toggle("nav-group-active", isActive);
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
    let readyModule = null;
    try {
      readyModule = await ensureViewModule(viewId, { highPriority });
    } catch (error) {
      logViewInit(viewId, "setView:error", {
        stage: "same-view",
        ...describeViewInitError(error),
      }, "error");
      console.error(`[shell] fallo setView(${viewId})`, error);
    }
    window.localStorage.setItem(LAST_VIEW_KEY, viewId);
    recordViewMetrics(viewId, {
      lastShowMs: Math.round(performance.now() - viewSwitchStartedAt),
      lastShownAt: Date.now(),
      viewReady: Boolean(readyModule),
    });
    return;
  }

  const previousViewId = state.currentViewId;
  if (previousViewId) {
    await callViewHook(previousViewId, "onHide");
    cleanupViewListeners(previousViewId);
  }

  syncViews(viewId);
  syncNav(viewId);
  let readyModule = null;
  try {
    readyModule = await ensureViewModule(viewId, { highPriority });
  } catch (error) {
    logViewInit(viewId, "setView:error", {
      ...describeViewInitError(error),
    }, "error");
    console.error(`[shell] fallo setView(${viewId})`, error);
  }
  recordViewMetrics(viewId, {
    lastShowMs: Math.round(performance.now() - viewSwitchStartedAt),
    lastShownAt: Date.now(),
    viewReady: Boolean(readyModule),
  });

  state.currentViewId = viewId;
  window.localStorage.setItem(LAST_VIEW_KEY, viewId);
  scheduleLikelyVendorWarmup(viewId);
  trackAchievementViewVisit(viewId);

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

function getGlobalQuickFabState() {
  const state = getShellState();
  if (!state.globalQuickFab) {
    state.globalQuickFab = {
      open: false,
      bound: false,
    };
  }
  return state.globalQuickFab;
}

function getGlobalQuickFabRoot() {
  return document.getElementById("app-global-fab");
}

function setGlobalQuickFabOpen(isOpen) {
  const fabState = getGlobalQuickFabState();
  fabState.open = Boolean(isOpen);
  const root = getGlobalQuickFabRoot();
  if (!root) return;
  root.classList.toggle("is-open", fabState.open);
  root.setAttribute("data-open", fabState.open ? "1" : "0");
  const toggle = root.querySelector("[data-global-fab-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-expanded", fabState.open ? "true" : "false");
  }
}

function closeGlobalQuickFab() {
  setGlobalQuickFabOpen(false);
}

function toggleGlobalQuickFab() {
  if (document.body.classList.contains("has-open-modal")) return;
  setGlobalQuickFabOpen(!getGlobalQuickFabState().open);
}

function buildGlobalQuickFabActionsMarkup() {
  const startAngle = 160;
  const endAngle = 270;
  const total = GLOBAL_QUICK_FAB_ACTIONS.length;

  return GLOBAL_QUICK_FAB_ACTIONS.map((action, index) => {
    const angle = total <= 1
      ? 250
      : startAngle + (((endAngle - startAngle) / (total - 1)) * index);
    const radians = (angle * Math.PI) / 180;
    const x = Math.round(Math.cos(radians) * 90);
    const y = Math.round(Math.sin(radians) * 90);
    return `
      <button
        class="app-global-fab__action"
        type="button"
        data-global-fab-action="${action.key}"
        aria-label="${action.label}"
        title="${action.label}"
        style="--fab-x:${x}px;--fab-y:${y}px;--fab-index:${index};"
      >
        <span class="app-global-fab__actionIcon" aria-hidden="true">${getGlobalQuickFabIconMarkup(action.key)}</span>
        <span class="app-global-fab__actionLabel">${action.label}</span>
      </button>
    `;
  }).join("");
}

function ensureGlobalQuickFab() {
  let root = getGlobalQuickFabRoot();
  if (root) return root;

  root = document.createElement("div");
  root.id = "app-global-fab";
  root.className = "app-global-fab";
  root.innerHTML = `
    <button class="app-global-fab__backdrop" type="button" tabindex="-1" aria-hidden="true" data-global-fab-backdrop></button>
    <div class="app-global-fab__dock" aria-hidden="false">
      <div class="app-global-fab__cluster">
        ${buildGlobalQuickFabActionsMarkup()}
        <button
          class="app-global-fab__toggle"
          type="button"
          aria-label="Abrir accesos rápidos"
          aria-expanded="false"
          data-global-fab-toggle
        >
          <span class="app-global-fab__togglePlus" aria-hidden="true">🌎</span>
        </button>
      </div>
    </div>
  `;

  document.body.appendChild(root);
  setGlobalQuickFabOpen(false);
  return root;
}

function waitForFrames(count = 2) {
  const total = Math.max(1, Number(count) || 1);
  return new Promise((resolve) => {
    let remaining = total;
    const step = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  });
}

async function waitForValue(getter, { attempts = 24, delayMs = 50 } = {}) {
  for (let index = 0; index < attempts; index += 1) {
    const value = getter();
    if (value) return value;
    await new Promise((resolve) => window.setTimeout(resolve, delayMs));
  }
  return null;
}

async function clickWhenReady(getter) {
  const element = await waitForValue(getter);
  if (!(element instanceof HTMLElement)) return false;
  element.click();
  return true;
}

async function openViewAndRunQuickAction(viewId, runner) {
  await setView(viewId, { highPriority: true });
  await waitForFrames(2);
  return runner();
}

async function runGlobalQuickFabAction(actionKey) {
  if (actionKey === "books") {
    await ensureSessionQuickstartReady();
    return openViewAndRunQuickAction("view-books", () => {
      return clickWhenReady(() => document.getElementById("books-start-session"));
    });
  }

  if (actionKey === "improvements") {
    return openViewAndRunQuickAction("view-improvements", async () => {
      const openEditor = await waitForValue(() => window.__bookshellImprovements?.openEditorModal || null);
      if (typeof openEditor === "function") {
        openEditor({ focus: true });
        return true;
      }
      return clickWhenReady(() => document.getElementById("improvements-open-editor-btn"));
    });
  }

  if (actionKey === "media") {
    return openViewAndRunQuickAction("view-media", () => {
      return clickWhenReady(() => document.getElementById("media-fab-add"));
    });
  }

  if (actionKey === "notes") {
    return openViewAndRunQuickAction("view-notes", async () => {
      const openNoteModal = await waitForValue(() => window.__bookshellNotes?.openGlobalNoteModal || null);
      if (typeof openNoteModal === "function") {
        openNoteModal();
        return true;
      }
      return false;
    });
  }

  if (actionKey === "videos") {
    return openViewAndRunQuickAction("view-videos-hub", () => {
      return clickWhenReady(() => document.getElementById("videos-hub-create-btn"));
    });
  }

  if (actionKey === "gym") {
    return openViewAndRunQuickAction("view-gym", () => {
      return clickWhenReady(() => document.getElementById("gym-start-workout"));
    });
  }

  if (actionKey === "recipes") {
    return openViewAndRunQuickAction("view-recipes", async () => {
      const openFoodAdd = await waitForValue(() => window.__bookshellRecipes?.openGlobalFoodAdd || null);
      if (typeof openFoodAdd === "function") {
        openFoodAdd();
        return true;
      }
      return false;
    });
  }

  if (actionKey === "finance") {
    return openViewAndRunQuickAction("view-finance", () => {
      return clickWhenReady(() => document.getElementById("anadir-gastos"));
    });
  }

  return false;
}

function bindGlobalQuickFab() {
  const fabState = getGlobalQuickFabState();
  if (fabState.bound) return;

  const root = ensureGlobalQuickFab();
  root.addEventListener("click", (event) => {
    const toggle = event.target?.closest?.("[data-global-fab-toggle]");
    if (toggle) {
      event.preventDefault();
      toggleGlobalQuickFab();
      return;
    }

    const backdrop = event.target?.closest?.("[data-global-fab-backdrop]");
    if (backdrop) {
      event.preventDefault();
      closeGlobalQuickFab();
      return;
    }

    const action = event.target?.closest?.("[data-global-fab-action]");
    if (!action) return;

    event.preventDefault();
    const actionKey = String(action.dataset.globalFabAction || "").trim();
    if (!actionKey) return;
    closeGlobalQuickFab();
    void runGlobalQuickFabAction(actionKey);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!getGlobalQuickFabState().open) return;
    closeGlobalQuickFab();
  });

  document.addEventListener("click", () => {
    if (!getGlobalQuickFabState().open) return;
    if (document.body.classList.contains("has-open-modal")) {
      closeGlobalQuickFab();
    }
  }, true);

  fabState.bound = true;
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

async function ensureUserSchema(authUid) {
  const root = firebasePaths.userRoot(authUid);
  const schemaPath = firebasePaths.userMetaSchemaVersion(authUid);
  logFirebaseRead({ path: schemaPath, mode: "get", reason: "ensure-user-schema:meta", viewId: "shell" });
  const snap = await get(ref(db, schemaPath));
  if (snap.exists()) return;

  const now = Date.now();
  logFirebaseRead({ path: root, mode: "get", reason: "ensure-user-schema:seed-root", viewId: "shell" });
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

function getActiveHabitSessionsPath(authUid) {
  return firebasePaths.activeHabitSessions(authUid);
}

async function hasRemoteActiveHabitSession(authUid) {
  if (!authUid) return false;
  try {
    const snap = await get(ref(db, getActiveHabitSessionsPath(authUid)));
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
  bindGlobalQuickFab();
  bindGlobalSyncIndicator();
  state.booted = true;
}

function exposeShellApis() {
  window.__bookshellNavigateToView = (viewId, options = {}) => setView(viewId, options);
  window.__bookshellOpenViewRoot = async (viewId, options = {}) => {
    await setView(viewId, {
      pushHash: options.pushHash !== false,
      highPriority: options.highPriority !== false,
    });
    if (options.resetToRoot === false) return;
    await maybeResetTabToRoot(viewId);
  };
  window.__bookshellGetViewMeta = (viewId) => getNavButtonMeta(viewId) || NAV_VIEW_META[viewId] || null;
  window.__bookshellGetGlobalQuickFabActions = () => GLOBAL_QUICK_FAB_ACTIONS.map((action) => ({
    ...action,
    viewMeta: getNavButtonMeta(action.viewId) || NAV_VIEW_META[action.viewId] || null,
  }));
  window.__bookshellRunGlobalQuickFabAction = (actionKey) => runGlobalQuickFabAction(actionKey);
  window.__bookshellOpenGlobalQuickFab = () => {
    bindGlobalQuickFab();
    ensureGlobalQuickFab();
    setGlobalQuickFabOpen(true);
  };
  window.__bookshellGetSyncSnapshot = () => getShellState().lastSyncSnapshot || null;
  window.__bookshellOpenSettings = () => openSettingsModal();
  window.__bookshellOpenMetrics = () => openMetricsModal();
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
        cleanupViewListeners(state.currentViewId);
        state.currentViewId = null;
        syncCurrentViewState("");
      }
      cleanupViewListeners("shell");
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
    const authUid = getUserDataRootKey(user);

    void ensureUserSchema(authUid).catch((error) => {
      console.warn("[schema] seed failed", error);
    });

    void primeNavLayoutForUser(authUid)
      .catch((error) => {
        console.warn("[shell] no se pudo preparar navLayout inicial", error);
      })
      .finally(() => {
        startNavLayoutSync(authUid);
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
      const hasActiveSession = await hasRemoteActiveHabitSession(authUid);
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
initThemeService();
hideLegacyThemeControl();
initAchievementsService();
initGeneralCenterService();
bindSyncIndicatorToggles();
exposeShellApis();
bindAuthGate();
bindViewportHeightVar();
bindNetworkDebug();
logPwaEvent("cold-start", {
  visibility: document.visibilityState,
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    logPwaEvent("resume", {
      viewId: getCurrentViewId() || getInitialView(),
    });
  }
});
bindGlobalSyncIndicator();
window.addEventListener("bookshell:reminder-notifications", (event) => {
  window.__bookshellReminderPendingToday = Number(event?.detail?.pendingTodayCount || 0);
  renderGlobalSyncIndicator(getShellState().lastSyncSnapshot || null);
});
scheduleIdleTask(() => registerAppServiceWorker(), { delayMs: 600, timeout: 3000 });
window.__bookshellEnsureHabitsApi = ensureHabitsApiReady;
schedulePostBootTask(() => preloadViewModule("view-notes"), 1200);
