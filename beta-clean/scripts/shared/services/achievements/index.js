import { auth, db, firebasePaths, getUserDataKey, onUserChange } from "../../firebase/index.js";
import { get, onValue, ref, runTransaction, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { resolveFinancePathCandidates } from "../../../modules/finance/finance/data.js";
import { buildAchievementsModel, createPanelPersistenceRecord } from "./model.js";
import { MODULE_META, buildAchievementsContext, computeModuleMetrics, getModuleKeys, mergeFinanceSnapshot } from "./metrics.js";

const ACHIEVEMENTS_ROOT_SEGMENT = "meta/achievements";
const MODULE_CACHE_MAX_AGE_MS = 90 * 1000;
const EVALUATE_DEBOUNCE_MS = 220;
const WARM_FETCH_DELAY_MS = 650;
const ACTIVE_MODULE_STORAGE_KEY = "bookshell:achievements:active-module:v1";

const state = {
  initialized: false,
  uid: "",
  authUnsub: null,
  remoteUnsub: null,
  remoteHydrated: false,
  evaluateTimer: 0,
  warmTimer: 0,
  boundDataEvents: false,
  moduleSnapshots: {},
  achievementsRoot: "",
  remoteData: { panels: {}, usage: {} },
  pendingPanelUpdates: new Map(),
  toasts: [],
  ui: {
    centerOpen: false,
    activeModule: readActiveModule(),
  },
};

function readActiveModule() {
  try {
    return String(localStorage.getItem(ACTIVE_MODULE_STORAGE_KEY) || "general").trim() || "general";
  } catch (_) {
    return "general";
  }
}

function persistActiveModule(moduleKey = "") {
  try {
    localStorage.setItem(ACTIVE_MODULE_STORAGE_KEY, String(moduleKey || "general"));
  } catch (_) {}
}

function resolveAchievementsUserKey(value = state.uid) {
  const explicitUserKey = String(value || "").trim();
  const currentUid = String(auth.currentUser?.uid || "").trim();
  if (explicitUserKey && explicitUserKey !== currentUid) return explicitUserKey;
  return getUserDataKey(auth.currentUser) || explicitUserKey;
}

function getAchievementsRoot(uid = state.uid) {
  const userKey = resolveAchievementsUserKey(uid);
  return userKey ? firebasePaths.achievementsRoot(userKey) : "";
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char] || char);
}

function formatDate(ts) {
  const numeric = Number(ts);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  try {
    return new Date(numeric).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
  } catch (_) {
    return "—";
  }
}

function getLocalDayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

const VIEW_ID_TO_MODULE = Object.values(MODULE_META).reduce((acc, meta) => {
  if (meta.viewId) acc[meta.viewId] = meta.key;
  return acc;
}, {});

function ensureTopBarButton() {
  let button = document.getElementById("app-achievements-btn");
  if (button) return button;

  const indicator = document.querySelector(".app-sync-indicator");
  if (!indicator) return null;
  let actions = indicator.querySelector(".app-sync-indicator__actions");
  if (!actions) {
    actions = document.createElement("span");
    actions.className = "app-sync-indicator__actions";
    indicator.append(actions);
  }

  button = document.createElement("button");
  button.id = "app-achievements-btn";
  button.className = "app-achievements-btn hidden";
  button.type = "button";
  button.setAttribute("aria-label", "Abrir centro de logros");
  button.setAttribute("title", "Logros");
  button.innerHTML = `
    <span class="app-achievements-btn__icon" aria-hidden="true">🏆</span>
    <span class="app-achievements-btn__text">Logros</span>
    <span class="app-achievements-btn__count" data-achievements-count>0</span>
  `;
  actions.append(button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    state.ui.centerOpen ? closeAchievementsCenter() : openAchievementsCenter();
  });
  return button;
}

function ensureToastStack() {
  let stack = document.getElementById("app-achievements-toast-stack");
  if (stack) return stack;
  stack = document.createElement("div");
  stack.id = "app-achievements-toast-stack";
  stack.className = "app-achievements-toast-stack";
  stack.setAttribute("aria-live", "polite");
  stack.setAttribute("aria-atomic", "false");
  stack.addEventListener("click", (event) => {
    const closeButton = event.target?.closest?.("[data-achievement-toast-close]");
    if (!closeButton) return;
    dismissToast(closeButton.dataset.achievementToastClose || "");
  });
  document.body.append(stack);
  return stack;
}

function ensureAchievementsModal() {
  let backdrop = document.getElementById("app-achievements-backdrop");
  if (backdrop) return backdrop;
  backdrop = document.createElement("div");
  backdrop.id = "app-achievements-backdrop";
  backdrop.className = "modal-backdrop app-achievements-backdrop hidden";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.innerHTML = `
    <section class="modal app-achievements-modal" role="dialog" aria-modal="true" aria-labelledby="app-achievements-title">
      <header class="modal-header app-achievements-modal__header">
        <div>
          <div class="app-achievements-modal__eyebrow">General</div>
          <div class="modal-title" id="app-achievements-title">Logros</div>
        </div>
        <button class="app-achievements-modal__close" type="button" aria-label="Cerrar logros" data-achievements-close>✕</button>
      </header>
      <div class="modal-body app-achievements-modal__body" id="app-achievements-body"></div>
    </section>
  `;
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target?.closest?.("[data-achievements-close]")) {
      closeAchievementsCenter();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.ui.centerOpen) closeAchievementsCenter();
  });
  document.body.append(backdrop);
  return backdrop;
}

function getVisibleModalCount() {
  return document.querySelectorAll(".modal-backdrop:not(.hidden), .nav-manage-backdrop:not(.hidden), .nav-compose-backdrop:not(.hidden)").length;
}

function syncBodyModalLock() {
  document.body.classList.toggle("has-open-modal", getVisibleModalCount() > 0);
}

function setActiveModule(moduleKey = "", { rerender = true } = {}) {
  state.ui.activeModule = String(moduleKey || "general").trim() || "general";
  persistActiveModule(state.ui.activeModule);
  if (rerender) renderAchievementsCenter();
}

function openAchievementsCenter() {
  const backdrop = ensureAchievementsModal();
  if (!backdrop) return;
  state.ui.centerOpen = true;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  syncBodyModalLock();
  renderAchievementsCenter();
  scheduleEvaluation(getModuleKeys(), { forceFetch: true });
}

function closeAchievementsCenter() {
  const backdrop = document.getElementById("app-achievements-backdrop");
  state.ui.centerOpen = false;
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
  syncBodyModalLock();
}

function getModuleLiveSnapshot(moduleKey = "") {
  switch (moduleKey) {
    case "books": return window.__bookshellBooks?.getAchievementsSnapshot?.() || null;
    case "recipes": return window.__bookshellRecipes?.getAchievementsSnapshot?.() || null;
    case "gym": return window.__bookshellGym?.getAchievementsSnapshot?.() || null;
    case "habits": return window.__bookshellHabits?.getAchievementsSnapshot?.() || null;
    case "finance": return window.__bookshellFinance?.getAchievementsSnapshot?.() || null;
    case "notes": return window.__bookshellNotes?.getAchievementsSnapshot?.() || null;
    case "videos": return window.__bookshellVideosHub?.getAchievementsSnapshot?.() || null;
    case "media": return window.__bookshellMedia?.getAchievementsSnapshot?.() || null;
    default: return null;
  }
}

async function fetchRemoteModuleSnapshot(moduleKey = "") {
  const userKey = resolveAchievementsUserKey();
  if (!userKey) return null;
  switch (moduleKey) {
    case "books":
      return (await get(ref(db, firebasePaths.booksRoot(userKey)))).val() || {};
    case "recipes":
      return (await get(ref(db, firebasePaths.recipesRoot(userKey)))).val() || {};
    case "gym":
      return (await get(ref(db, firebasePaths.gymRoot(userKey)))).val() || {};
    case "habits":
      return (await get(ref(db, firebasePaths.habitsRoot(userKey)))).val() || {};
    case "notes":
      return (await get(ref(db, firebasePaths.notes(userKey)))).val() || {};
    case "videos":
      return (await get(ref(db, firebasePaths.videosHubVideos(userKey)))).val() || {};
    case "media":
      return (await get(ref(db, firebasePaths.media(userKey)))).val() || {};
    case "finance": {
      const [primaryPath, legacyPath] = resolveFinancePathCandidates(userKey);
      const [primarySnap, legacySnap] = await Promise.all([
        get(ref(db, primaryPath)),
        primaryPath === legacyPath ? Promise.resolve({ val: () => ({}) }) : get(ref(db, legacyPath)),
      ]);
      return mergeFinanceSnapshot(primarySnap.val() || {}, legacySnap.val() || {});
    }
    default:
      return null;
  }
}

function writeModuleMetrics(moduleKey = "", snapshot, source = "live") {
  const safeModule = String(moduleKey || "").trim();
  if (!safeModule) return null;
  const metrics = computeModuleMetrics(safeModule, snapshot || {});
  state.moduleSnapshots[safeModule] = { source, updatedAt: Date.now(), metrics };
  return metrics;
}

async function ensureModuleMetrics(moduleKey = "", { forceRemote = false } = {}) {
  const safeModule = String(moduleKey || "").trim();
  if (!safeModule || safeModule === "general") return null;
  const cached = state.moduleSnapshots[safeModule];
  if (!forceRemote && cached && (Date.now() - Number(cached.updatedAt || 0)) < MODULE_CACHE_MAX_AGE_MS) {
    return cached.metrics;
  }
  if (!forceRemote) {
    const liveSnapshot = getModuleLiveSnapshot(safeModule);
    if (liveSnapshot) return writeModuleMetrics(safeModule, liveSnapshot, "live");
  }
  try {
    return writeModuleMetrics(safeModule, await fetchRemoteModuleSnapshot(safeModule), "remote");
  } catch (error) {
    console.warn(`[achievements] no se pudo cargar ${safeModule}`, error);
    return cached?.metrics || null;
  }
}

async function warmAllModuleMetrics() {
  const moduleKeys = getModuleKeys();
  await Promise.all(moduleKeys.map((moduleKey) => ensureModuleMetrics(moduleKey, { forceRemote: true })));
  renderAchievementsButton();
  renderAchievementsCenter();
  scheduleEvaluation(moduleKeys);
}

function scheduleWarmModuleMetrics() {
  window.clearTimeout(state.warmTimer);
  state.warmTimer = window.setTimeout(() => void warmAllModuleMetrics(), WARM_FETCH_DELAY_MS);
}

function getAchievementsContext() {
  const moduleMetrics = {};
  getModuleKeys().forEach((moduleKey) => {
    moduleMetrics[moduleKey] = state.moduleSnapshots[moduleKey]?.metrics || null;
  });
  return buildAchievementsContext(moduleMetrics, state.remoteData.usage || {});
}

function getAchievementsModel() {
  return buildAchievementsModel({
    context: getAchievementsContext(),
    persistedPanels: state.remoteData.panels || {},
  });
}

function resolveActiveGroup(model) {
  if (!model.groups.length) return null;
  if (model.groupsByModule[state.ui.activeModule]) return model.groupsByModule[state.ui.activeModule];
  const fallback = model.groups[0] || null;
  if (fallback) {
    state.ui.activeModule = fallback.module;
    persistActiveModule(fallback.module);
  }
  return fallback;
}

function renderProgressBar(progressRatio = 0, compact = false) {
  const pct = Math.max(0, Math.min(100, Math.round(progressRatio * 100)));
  return `
    <div class="app-achievements-progress${compact ? " app-achievements-progress--compact" : ""}" aria-hidden="true">
      <i style="width:${pct}%"></i>
    </div>
  `;
}

function renderModuleTabs(model, activeGroup) {
  return `
    <div class="app-achievements-tabs" role="tablist" aria-label="Módulos de logros">
      ${model.groups.map((group) => `
        <button
          type="button"
          class="app-achievements-tab${group.module === activeGroup?.module ? " is-active" : ""}"
          role="tab"
          aria-selected="${group.module === activeGroup?.module ? "true" : "false"}"
          data-achievement-module-tab="${escapeHtml(group.module)}"
          title="${escapeHtml(group.meta.label)}"
        >
          <span class="app-achievements-tab__icon" aria-hidden="true">${escapeHtml(group.meta.emoji)}</span>
          <span class="app-achievements-tab__label">${escapeHtml(group.meta.label)}</span>
          <span class="app-achievements-tab__count">${group.counts.unlocked}/${group.counts.total}</span>
        </button>
      `).join("")}
    </div>
  `;
}

function renderTierRail(panel) {
  return `
    <div class="app-achievement-card__tiers" aria-label="Tiers visibles">
      ${panel.visibleTiers.map((tier) => `
        <span class="app-achievement-tier" data-state="${escapeHtml(tier.state)}">
          <strong>${escapeHtml(tier.tier.icon)}</strong>
          <small>${escapeHtml(tier.label)}</small>
        </span>
      `).join("")}
    </div>
  `;
}

function renderAchievementCard(panel) {
  const progressLabel = panel.nextTier
    ? `${panel.formattedCurrentValue} / ${panel.formattedNextThreshold}`
    : `${panel.formattedCurrentValue} · máximo actual`;
  const subtitle = panel.nextTier
    ? `Siguiente rango: ${panel.nextTier.label}`
    : `Último ascenso: ${formatDate(panel.unlockedAt)}`;

  return `
    <article class="app-achievement-card" data-tone="${escapeHtml(panel.tone)}">
      <header class="app-achievement-card__head">
        <div class="app-achievement-card__identity">
          <span class="app-achievement-card__icon" aria-hidden="true">${escapeHtml(panel.icon)}</span>
          <div class="app-achievement-card__copy">
            <strong>${escapeHtml(panel.title)}</strong>
            <span>${escapeHtml(panel.description)}</span>
          </div>
        </div>
        <div class="app-achievement-card__medal" data-medal-tone="${escapeHtml(panel.currentTier.key)}">
          <span aria-hidden="true">${escapeHtml(panel.currentTier.icon)}</span>
          <b>${escapeHtml(panel.currentTier.shortLabel)}</b>
        </div>
      </header>

      <div class="app-achievement-card__stats">
        <div class="app-achievement-card__metric">
          <strong>${escapeHtml(panel.formattedCurrentValue)}</strong>
          <span>${escapeHtml(panel.metricLabel)}</span>
        </div>
        <div class="app-achievement-card__next">
          <strong>${escapeHtml(panel.nextTier ? panel.formattedRemainingToNext : "Completado")}</strong>
          <span>${escapeHtml(panel.nextTier ? "para el siguiente" : "tier activo")}</span>
        </div>
      </div>

      ${panel.nextTier
        ? renderProgressBar(panel.progressToNext)
        : '<div class="app-achievement-card__maxed">La progresión seguirá extendiéndose cuando superes el rango visible.</div>'}

      <div class="app-achievement-card__meta">
        <span>${escapeHtml(progressLabel)}</span>
        <span>${escapeHtml(subtitle)}</span>
      </div>

      ${renderTierRail(panel)}
    </article>
  `;
}

function renderFocusPanel(group) {
  if (!group?.focusPanel) return "";
  const panel = group.focusPanel;
  return `
    <section class="sheet-section app-achievements-moduleHero" data-tone="${escapeHtml(panel.tone)}">
      <div class="app-achievements-moduleHero__top">
        <div>
          <div class="app-achievements-moduleHero__eyebrow">${escapeHtml(`${group.meta.emoji} ${group.meta.label}`)}</div>
          <h3 class="app-achievements-moduleHero__title">${escapeHtml(panel.title)}</h3>
          <p class="app-achievements-moduleHero__copy">${escapeHtml(panel.description)}</p>
        </div>
        <div class="app-achievements-moduleHero__badge" data-medal-tone="${escapeHtml(panel.currentTier.key)}">
          <span aria-hidden="true">${escapeHtml(panel.currentTier.icon)}</span>
          <strong>${escapeHtml(panel.currentTier.label)}</strong>
        </div>
      </div>

      <div class="app-achievements-moduleHero__stats">
        <article class="app-achievements-stat"><small>Paneles</small><strong>${group.counts.total}</strong></article>
        <article class="app-achievements-stat"><small>Con medalla</small><strong>${group.counts.unlocked}</strong></article>
        <article class="app-achievements-stat"><small>Cerca</small><strong>${group.counts.near}</strong></article>
      </div>

      ${renderProgressBar(group.completionRatio)}
    </section>
  `;
}

function renderNearbyStrip(group) {
  if (!group?.nearbyPanels?.length) return "";
  return `
    <section class="sheet-section">
      <div class="sheet-section-title">Más cerca en ${escapeHtml(group.meta.label)}</div>
      <div class="app-achievements-nearby">
        ${group.nearbyPanels.map((panel) => `
          <article class="app-achievements-nearby__item" data-tone="${escapeHtml(panel.tone)}">
            <div class="app-achievements-nearby__top">
              <span>${escapeHtml(panel.title)}</span>
              <strong>${Math.round(panel.progressToNext * 100)}%</strong>
            </div>
            ${renderProgressBar(panel.progressToNext, true)}
            <p>${escapeHtml(panel.nextTier ? `Faltan ${panel.formattedRemainingToNext} para ${panel.nextTier.label.toLowerCase()}.` : "Rango visible completado.")}</p>
          </article>
        `).join("")}
      </div>
    </section>
  `;
}

function renderEmptyState() {
  return `
    <section class="sheet-section">
      <div class="sheet-section-title">Logros</div>
      <p class="app-achievements-empty">Todavía no hay suficiente actividad para generar progreso en logros.</p>
    </section>
  `;
}

function bindAchievementsInteractions() {
  const body = document.getElementById("app-achievements-body");
  if (!body) return;
  body.querySelectorAll("[data-achievement-module-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      setActiveModule(button.dataset.achievementModuleTab || "general");
    });
  });
}

function renderAchievementsButton() {
  const button = ensureTopBarButton();
  if (!button) return;
  const summary = getAchievementsModel().summary;
  const count = button.querySelector("[data-achievements-count]");
  if (count) count.textContent = summary.totalPanels ? `${summary.unlockedPanels}/${summary.totalPanels}` : "0";
  button.classList.toggle("hidden", !state.uid);
}

function renderAchievementsCenter() {
  const body = document.getElementById("app-achievements-body");
  if (!body || !state.ui.centerOpen) {
    renderAchievementsButton();
    return;
  }

  const model = getAchievementsModel();
  const activeGroup = resolveActiveGroup(model);
  body.innerHTML = !model.groups.length ? renderEmptyState() : `
    <section class="sheet-section app-achievements-shell">
      <div class="app-achievements-shell__summary">
        <div>
          <div class="app-achievements-shell__eyebrow">Centro compacto</div>
          <h3 class="app-achievements-shell__title">Logros por módulo y por entidad</h3>
          <p class="app-achievements-shell__copy">Solo se muestra el módulo activo. Cada pieza resume rango, progreso y siguiente tier sin muros de tarjetas.</p>
        </div>
        <div class="app-achievements-shell__totals">
          <strong>${model.summary.unlockedPanels}</strong>
          <span>con medalla</span>
        </div>
      </div>
      <div class="app-achievements-shell__stats">
        <article class="app-achievements-stat"><small>Paneles</small><strong>${model.summary.totalPanels}</strong></article>
        <article class="app-achievements-stat"><small>Máximo</small><strong>${model.summary.maxedPanels}</strong></article>
        <article class="app-achievements-stat"><small>Cerca</small><strong>${model.summary.nearPanels}</strong></article>
      </div>
    </section>

    ${renderModuleTabs(model, activeGroup)}
    ${renderFocusPanel(activeGroup)}
    ${renderNearbyStrip(activeGroup)}

    <section class="sheet-section">
      <div class="sheet-section-title">${escapeHtml(activeGroup?.meta?.label || "Módulo activo")}</div>
      <div class="app-achievements-panelGrid">
        ${(activeGroup?.panels || []).map(renderAchievementCard).join("")}
      </div>
    </section>
  `;

  bindAchievementsInteractions();
  renderAchievementsButton();
}

function renderToasts() {
  const stack = ensureToastStack();
  if (!stack) return;
  stack.innerHTML = state.toasts.map((toast) => `
    <article class="app-achievement-toast" data-achievement-toast-id="${escapeHtml(toast.id)}" data-tone="${escapeHtml(toast.tone || "earned")}">
      <div class="app-achievement-toast__icon" aria-hidden="true">${escapeHtml(toast.icon || "🏆")}</div>
      <div class="app-achievement-toast__copy">
        <strong>${escapeHtml(toast.title || "Logro desbloqueado")}</strong>
        <p>${escapeHtml(toast.description || "")}</p>
      </div>
      <button class="app-achievement-toast__close" type="button" aria-label="Cerrar notificación" data-achievement-toast-close="${escapeHtml(toast.id)}">✕</button>
    </article>
  `).join("");
}

function dismissToast(toastId = "") {
  const safeId = String(toastId || "").trim();
  state.toasts = state.toasts.filter((toast) => toast.id !== safeId);
  renderToasts();
}

function enqueueToast(panel) {
  if (!panel) return;
  const toastId = `${panel.id}-${Date.now()}`;
  state.toasts = [...state.toasts, {
    id: toastId,
    icon: panel.currentTier?.icon || panel.icon || "🏆",
    tone: panel.tone,
    title: `Medalla ${panel.currentTier?.label || "nueva"} · ${panel.title}`,
    description: panel.nextTier ? `Ahora vas a por ${panel.nextTier.label}.` : "Has superado el rango visible de este panel.",
  }].slice(-3);
  renderToasts();
  window.setTimeout(() => dismissToast(toastId), 4200);
}

function queuePanelNotifications(panelIds = []) {
  const model = getAchievementsModel();
  panelIds.forEach((panelId) => {
    const panel = model.panelsById?.[panelId];
    if (panel) enqueueToast(panel);
  });
  renderAchievementsButton();
}

function cleanupPendingPanelUpdates(nextPanels = {}) {
  Array.from(state.pendingPanelUpdates.entries()).forEach(([panelId, pending]) => {
    const remoteLevelIndex = Math.max(0, Number(nextPanels?.[panelId]?.levelIndex || 0));
    if (remoteLevelIndex >= pending.targetLevelIndex) state.pendingPanelUpdates.delete(panelId);
  });
}

function updateRemoteState(payload = {}) {
  state.remoteData = {
    panels: payload?.panels && typeof payload.panels === "object" ? payload.panels : {},
    usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : {},
  };
  renderAchievementsButton();
  renderAchievementsCenter();
}

function handleRemoteSnapshot(payload = {}) {
  const nextPanels = payload?.panels && typeof payload.panels === "object" ? payload.panels : {};
  if (!state.remoteHydrated) {
    updateRemoteState(payload);
    state.remoteHydrated = true;
    scheduleEvaluation(getModuleKeys());
    return;
  }

  const previousPanels = state.remoteData?.panels || {};
  updateRemoteState(payload);

  const upgradedPanelIds = Object.keys(nextPanels).filter((panelId) => {
    const nextLevelIndex = Math.max(0, Number(nextPanels?.[panelId]?.levelIndex || 0));
    const previousLevelIndex = Math.max(0, Number(previousPanels?.[panelId]?.levelIndex || 0));
    return nextLevelIndex > previousLevelIndex;
  });

  const toastPanelIds = [];
  upgradedPanelIds.forEach((panelId) => {
    const pending = state.pendingPanelUpdates.get(panelId);
    const nextLevelIndex = Math.max(0, Number(nextPanels?.[panelId]?.levelIndex || 0));
    if (pending) {
      if (pending.shouldToast && nextLevelIndex >= pending.shouldToastLevelIndex) toastPanelIds.push(panelId);
      if (nextLevelIndex >= pending.targetLevelIndex) state.pendingPanelUpdates.delete(panelId);
      return;
    }
    toastPanelIds.push(panelId);
  });

  cleanupPendingPanelUpdates(nextPanels);
  if (toastPanelIds.length) queuePanelNotifications(toastPanelIds);
}

function stopRemoteListener() {
  if (typeof state.remoteUnsub === "function") {
    try {
      state.remoteUnsub();
    } catch (_) {}
  }
  state.remoteUnsub = null;
}

function bindRemoteListener(uid = "") {
  stopRemoteListener();
  const root = getAchievementsRoot(uid);
  if (!root) return;
  state.achievementsRoot = root;
  state.remoteHydrated = false;
  state.remoteUnsub = onValue(ref(db, root), (snapshot) => {
    handleRemoteSnapshot(snapshot.val() || {});
  }, (error) => {
    console.warn("[achievements] error escuchando estado remoto", error);
  });
}

async function registerSessionUsage(uid = "") {
  const root = getAchievementsRoot(uid);
  if (!root) return;
  const dayKey = getLocalDayKey();
  const usageRef = ref(db, `${root}/usage`);
  await runTransaction(usageRef, (currentValue) => {
    const usage = currentValue && typeof currentValue === "object" ? currentValue : {};
    const activeDays = usage.activeDays && typeof usage.activeDays === "object" ? { ...usage.activeDays } : {};
    const dayEntry = activeDays[dayKey] && typeof activeDays[dayKey] === "object" ? activeDays[dayKey] : {};
    activeDays[dayKey] = {
      firstSeenAt: Number(dayEntry.firstSeenAt || Date.now()) || Date.now(),
      lastSeenAt: Date.now(),
      sessions: Math.max(1, Number(dayEntry.sessions || 0) + 1),
    };
    return {
      ...usage,
      sessions: Math.max(0, Number(usage.sessions || 0)) + 1,
      activeDays,
      lastSeenDay: dayKey,
      updatedAt: Date.now(),
    };
  });
}

async function persistPanelUnlocks(patchRecords = {}) {
  const entries = Object.entries(patchRecords || {});
  if (!entries.length || !state.achievementsRoot) return;
  const patch = { lastEvaluatedAt: Date.now() };
  entries.forEach(([panelId, record]) => {
    patch[`panels/${panelId}`] = record;
  });
  await update(ref(db, state.achievementsRoot), patch);
}

async function evaluateAchievements({ moduleKeys = [], forceFetch = false } = {}) {
  if (!state.uid || !state.remoteHydrated) return;
  const targets = moduleKeys.length ? Array.from(new Set(moduleKeys)) : getModuleKeys();
  if (forceFetch) {
    await Promise.all(targets.map((moduleKey) => ensureModuleMetrics(moduleKey, { forceRemote: true })));
  }

  const model = getAchievementsModel();
  const pendingRecords = {};
  model.panels.forEach((panel) => {
    if (panel.pendingLevelIndex <= panel.storedRemoteLevelIndex) return;
    const pending = state.pendingPanelUpdates.get(panel.id);
    if (pending && pending.targetLevelIndex >= panel.pendingLevelIndex) return;
    pendingRecords[panel.id] = createPanelPersistenceRecord(panel);
    state.pendingPanelUpdates.set(panel.id, {
      targetLevelIndex: panel.pendingLevelIndex,
      shouldToast: panel.shouldToastLevelIndex > panel.storedRemoteLevelIndex,
      shouldToastLevelIndex: panel.shouldToastLevelIndex,
    });
  });

  if (!Object.keys(pendingRecords).length) {
    renderAchievementsButton();
    renderAchievementsCenter();
    return;
  }

  try {
    await persistPanelUnlocks(pendingRecords);
  } catch (error) {
    Object.keys(pendingRecords).forEach((panelId) => state.pendingPanelUpdates.delete(panelId));
    console.warn("[achievements] no se pudieron guardar los paneles", error);
  }
}

function scheduleEvaluation(moduleKeys = [], { forceFetch = false } = {}) {
  window.clearTimeout(state.evaluateTimer);
  state.evaluateTimer = window.setTimeout(() => {
    void evaluateAchievements({ moduleKeys, forceFetch });
  }, EVALUATE_DEBOUNCE_MS);
}

function inferModuleKeysFromEvent(event) {
  const detailSource = String(event?.detail?.source || "").trim();
  if (detailSource && MODULE_META[detailSource]) return [detailSource];
  const currentViewId = String(window.__bookshellCurrentViewId || document.documentElement.dataset.currentViewId || "").trim();
  if (currentViewId && VIEW_ID_TO_MODULE[currentViewId]) return [VIEW_ID_TO_MODULE[currentViewId]];
  return [];
}

function handleBookshellDataEvent(event) {
  const moduleKeys = inferModuleKeysFromEvent(event);
  if (!moduleKeys.length) {
    renderAchievementsButton();
    return;
  }

  let requiresRemoteRefresh = false;
  moduleKeys.forEach((moduleKey) => {
    const liveSnapshot = getModuleLiveSnapshot(moduleKey);
    if (liveSnapshot) writeModuleMetrics(moduleKey, liveSnapshot, "live");
    else requiresRemoteRefresh = true;
  });

  renderAchievementsButton();
  renderAchievementsCenter();
  scheduleEvaluation(moduleKeys, { forceFetch: requiresRemoteRefresh });
}

function resetStateForLogout() {
  stopRemoteListener();
  window.clearTimeout(state.evaluateTimer);
  window.clearTimeout(state.warmTimer);
  state.uid = "";
  state.achievementsRoot = "";
  state.remoteHydrated = false;
  state.moduleSnapshots = {};
  state.remoteData = { panels: {}, usage: {} };
  state.pendingPanelUpdates.clear();
  state.toasts = [];
  closeAchievementsCenter();
  renderToasts();
  renderAchievementsButton();
}

function handleAuthUser(user) {
  const nextUid = String(user?.uid || "").trim();
  if (!nextUid) {
    resetStateForLogout();
    return;
  }
  if (state.uid === nextUid) return;

  state.uid = nextUid;
  bindRemoteListener(nextUid);
  ensureTopBarButton();
  ensureAchievementsModal();
  ensureToastStack();
  void registerSessionUsage(nextUid).catch((error) => {
    console.warn("[achievements] no se pudo registrar la sesión", error);
  });
  scheduleWarmModuleMetrics();
}

function bindDataEvents() {
  if (state.boundDataEvents) return;
  window.addEventListener("bookshell:data", handleBookshellDataEvent);
  state.boundDataEvents = true;
}

export function initAchievementsService() {
  if (state.initialized) return;
  state.initialized = true;
  ensureTopBarButton();
  ensureAchievementsModal();
  ensureToastStack();
  bindDataEvents();
  state.authUnsub = onUserChange((user) => handleAuthUser(user || auth.currentUser || null));
  handleAuthUser(auth.currentUser || null);
  window.__bookshellAchievements = {
    openCenter: openAchievementsCenter,
    closeCenter: closeAchievementsCenter,
    getModel: () => getAchievementsModel(),
    getContext: () => getAchievementsContext(),
    ensureModuleMetrics: (moduleKey, options) => ensureModuleMetrics(moduleKey, options),
  };
}

export function getAchievementsContextSnapshot() {
  return getAchievementsContext();
}

export function trackAchievementViewVisit(viewId = "") {
  const moduleKey = VIEW_ID_TO_MODULE[String(viewId || "").trim()];
  if (!moduleKey || !state.uid) return;
  const liveSnapshot = getModuleLiveSnapshot(moduleKey);
  if (!liveSnapshot) return;
  writeModuleMetrics(moduleKey, liveSnapshot, "live");
  if (!state.ui.activeModule || state.ui.activeModule === "general") setActiveModule(moduleKey, { rerender: false });
  scheduleEvaluation([moduleKey]);
  renderAchievementsButton();
  renderAchievementsCenter();
}
