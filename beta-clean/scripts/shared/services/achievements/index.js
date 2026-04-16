import { auth, db, onUserChange } from "../../firebase/index.js";
import {
  get,
  onValue,
  ref,
  runTransaction,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { resolveFinancePathCandidates } from "../../../modules/finance/finance/data.js";
import { getAchievementCatalog, getAchievementModuleMeta } from "./catalog.js";
import {
  MODULE_META,
  buildAchievementsContext,
  computeModuleMetrics,
  getModuleKeys,
  mergeFinanceSnapshot,
} from "./metrics.js";

const ACHIEVEMENTS_ROOT_SEGMENT = "meta/achievements";
const ACHIEVEMENT_SEEN_PREFIX = "bookshell:achievements:seen:v1:";
const MODULE_CACHE_MAX_AGE_MS = 90 * 1000;
const EVALUATE_DEBOUNCE_MS = 220;
const WARM_FETCH_DELAY_MS = 650;

const state = {
  initialized: false,
  uid: "",
  authUnsub: null,
  remoteUnsub: null,
  remoteHydrated: false,
  evaluateTimer: 0,
  warmTimer: 0,
  boundDataEvents: false,
  seenUnlockIds: new Set(),
  pendingUnlockIds: new Set(),
  moduleSnapshots: {},
  achievementsRoot: "",
  remoteData: {
    unlocked: {},
    usage: {},
  },
  ui: {
    centerOpen: false,
    activeModuleFilter: "all",
  },
  toasts: [],
};

function getAchievementsRoot(uid = state.uid) {
  return uid ? `v2/users/${uid}/${ACHIEVEMENTS_ROOT_SEGMENT}` : "";
}

function getSeenUnlockStorageKey(uid = state.uid) {
  return `${ACHIEVEMENT_SEEN_PREFIX}${uid || "anonymous"}`;
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

function formatDate(ts) {
  const numeric = Number(ts);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  try {
    return new Date(numeric).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (_) {
    return "—";
  }
}

function getLocalDayKey() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getViewIdToModuleMap() {
  return Object.values(MODULE_META).reduce((acc, meta) => {
    if (meta.viewId) acc[meta.viewId] = meta.key;
    return acc;
  }, {});
}

const VIEW_ID_TO_MODULE = getViewIdToModuleMap();

function readSeenUnlockIds(uid = state.uid) {
  if (!uid) return new Set();
  try {
    const raw = localStorage.getItem(getSeenUnlockStorageKey(uid));
    const parsed = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.map((value) => String(value || "").trim()).filter(Boolean) : []);
  } catch (_) {
    return new Set();
  }
}

function persistSeenUnlockIds() {
  if (!state.uid) return;
  try {
    localStorage.setItem(getSeenUnlockStorageKey(state.uid), JSON.stringify(Array.from(state.seenUnlockIds)));
  } catch (_) {}
}

function markUnlockAsSeen(achievementId = "") {
  const safeId = String(achievementId || "").trim();
  if (!safeId) return;
  state.seenUnlockIds.add(safeId);
  persistSeenUnlockIds();
}

function ensureTopBarButton() {
  let button = document.getElementById("app-achievements-btn");
  if (button) return button;

  const wrap = document.querySelector(".app-sync-indicator-wrap");
  if (!wrap) return null;

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

  wrap.prepend(button);
  button.addEventListener("click", () => {
    if (state.ui.centerOpen) closeAchievementsCenter();
    else openAchievementsCenter();
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
  document.body.appendChild(stack);
  stack.addEventListener("click", (event) => {
    const closeButton = event.target?.closest?.("[data-achievement-toast-close]");
    if (!closeButton) return;
    dismissToast(closeButton.dataset.achievementToastClose || "");
  });
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

  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target?.closest?.("[data-achievements-close]")) {
      closeAchievementsCenter();
    }
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.ui.centerOpen) {
      closeAchievementsCenter();
    }
  });
  return backdrop;
}

function getVisibleModalCount() {
  return document.querySelectorAll(
    ".modal-backdrop:not(.hidden), .nav-manage-backdrop:not(.hidden), .nav-compose-backdrop:not(.hidden)",
  ).length;
}

function syncBodyModalLock() {
  document.body.classList.toggle("has-open-modal", getVisibleModalCount() > 0);
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
    case "books":
      return window.__bookshellBooks?.getAchievementsSnapshot?.() || null;
    case "recipes":
      return window.__bookshellRecipes?.getAchievementsSnapshot?.() || null;
    case "gym":
      return window.__bookshellGym?.getAchievementsSnapshot?.() || null;
    case "habits":
      return window.__bookshellHabits?.getAchievementsSnapshot?.() || null;
    case "finance":
      return window.__bookshellFinance?.getAchievementsSnapshot?.() || null;
    case "notes":
      return window.__bookshellNotes?.getAchievementsSnapshot?.() || null;
    case "videos":
      return window.__bookshellVideosHub?.getAchievementsSnapshot?.() || null;
    case "media":
      return window.__bookshellMedia?.getAchievementsSnapshot?.() || null;
    default:
      return null;
  }
}

async function fetchRemoteModuleSnapshot(moduleKey = "") {
  if (!state.uid) return null;
  switch (moduleKey) {
    case "books": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/books`));
      return snapshot.val() || {};
    }
    case "recipes": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/recipes`));
      return snapshot.val() || {};
    }
    case "gym": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/gym/gym`));
      return snapshot.val() || {};
    }
    case "habits": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/habits`));
      return snapshot.val() || {};
    }
    case "finance": {
      const [primaryPath, legacyPath] = resolveFinancePathCandidates(state.uid);
      const [primarySnap, legacySnap] = await Promise.all([
        get(ref(db, primaryPath)),
        primaryPath === legacyPath ? Promise.resolve({ val: () => ({}) }) : get(ref(db, legacyPath)),
      ]);
      return mergeFinanceSnapshot(primarySnap.val() || {}, legacySnap.val() || {});
    }
    case "notes": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/notes`));
      return snapshot.val() || {};
    }
    case "videos": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/videosHub/videos`));
      return snapshot.val() || {};
    }
    case "media": {
      const snapshot = await get(ref(db, `v2/users/${state.uid}/movies/media`));
      return snapshot.val() || {};
    }
    default:
      return null;
  }
}

function writeModuleMetrics(moduleKey = "", snapshot, source = "live") {
  const safeModule = String(moduleKey || "").trim();
  if (!safeModule) return null;
  const metrics = computeModuleMetrics(safeModule, snapshot || {});
  state.moduleSnapshots[safeModule] = {
    source,
    updatedAt: Date.now(),
    metrics,
  };
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
    if (liveSnapshot) {
      return writeModuleMetrics(safeModule, liveSnapshot, "live");
    }
  }

  try {
    const remoteSnapshot = await fetchRemoteModuleSnapshot(safeModule);
    return writeModuleMetrics(safeModule, remoteSnapshot, "remote");
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
  state.warmTimer = window.setTimeout(() => {
    void warmAllModuleMetrics();
  }, WARM_FETCH_DELAY_MS);
}

function getUsageData() {
  return state.remoteData?.usage || {};
}

function getAchievementsContext() {
  const moduleMetrics = {};
  getModuleKeys().forEach((moduleKey) => {
    moduleMetrics[moduleKey] = state.moduleSnapshots[moduleKey]?.metrics || null;
  });
  return buildAchievementsContext(moduleMetrics, getUsageData());
}

function formatAchievementValue(stateItem, value) {
  const numeric = Number(value);
  const safeValue = Number.isFinite(numeric) ? numeric : 0;
  if (typeof stateItem?.formatValue === "function") {
    try {
      return stateItem.formatValue(safeValue);
    } catch (_) {}
  }

  const hasFraction = Math.abs(safeValue % 1) > 0.0001;
  return safeValue.toLocaleString("es-ES", {
    minimumFractionDigits: hasFraction && safeValue < 10 ? 1 : 0,
    maximumFractionDigits: hasFraction ? 2 : 0,
  });
}

function formatAchievementScope(stateItem) {
  if (stateItem?.scopeLabel) {
    return `${stateItem.moduleMeta.label} · ${stateItem.scopeLabel}`;
  }
  return stateItem?.moduleMeta?.label || "General";
}

function computeAchievementStates() {
  const context = getAchievementsContext();
  const unlockedMap = state.remoteData?.unlocked || {};
  return getAchievementCatalog(context).map((achievement) => {
    let currentValue = 0;
    try {
      currentValue = Math.max(0, Number(achievement.getCurrentValue(context) || 0));
    } catch (error) {
      console.warn(`[achievements] fallo al evaluar ${achievement.id}`, error);
      currentValue = 0;
    }
    const targetValue = Math.max(1, Number(achievement.targetValue || 1));
    const unlockedRecord = unlockedMap?.[achievement.id] || null;
    const unlocked = Boolean(unlockedRecord);
    const satisfied = currentValue >= targetValue;
    const completed = unlocked || satisfied;
    const progressRatio = completed ? 1 : Math.max(0, Math.min(1, currentValue / targetValue));
    const hiddenLocked = Boolean(achievement.hidden && !completed);
    return {
      ...achievement,
      moduleMeta: getAchievementModuleMeta(achievement.module),
      currentValue,
      targetValue,
      unlockedAt: Number(unlockedRecord?.unlockedAt || 0) || 0,
      unlocked,
      satisfied,
      state: completed ? "completed" : (currentValue > 0 ? "in_progress" : "blocked"),
      completed,
      hiddenLocked,
      progressRatio,
      remaining: Math.max(0, targetValue - currentValue),
    };
  });
}

function buildSummary(states = []) {
  const visibleStates = states.filter((stateItem) => !stateItem.hiddenLocked);
  const completed = visibleStates.filter((stateItem) => stateItem.completed);
  return {
    completedCount: completed.length,
    availableCount: visibleStates.length,
    completionPct: visibleStates.length ? Math.round((completed.length / visibleStates.length) * 100) : 0,
  };
}

function getClosestAchievements(states = [], limit = 6) {
  const sorted = states
    .filter((stateItem) => !stateItem.completed && !stateItem.hiddenLocked && stateItem.currentValue > 0)
    .sort((a, b) => {
      const ratioDiff = b.progressRatio - a.progressRatio;
      if (Math.abs(ratioDiff) > 0.0001) return ratioDiff;
      if (a.remaining !== b.remaining) return a.remaining - b.remaining;
      return a.targetValue - b.targetValue;
    });

  const picked = [];
  const seenModules = new Set();

  sorted.forEach((stateItem) => {
    if (picked.length >= limit) return;
    if (seenModules.has(stateItem.module)) return;
    seenModules.add(stateItem.module);
    picked.push(stateItem);
  });

  if (picked.length < limit) {
    sorted.forEach((stateItem) => {
      if (picked.length >= limit) return;
      if (picked.some((entry) => entry.id === stateItem.id)) return;
      picked.push(stateItem);
    });
  }

  return picked.slice(0, limit);
}

function groupStatesByModule(states = []) {
  return states.reduce((acc, stateItem) => {
    const key = stateItem.module;
    if (!acc[key]) acc[key] = [];
    acc[key].push(stateItem);
    return acc;
  }, {});
}

function formatRemainingLabel(stateItem) {
  const unit = stateItem.unitLabel || "pasos";
  const safeRemaining = Math.max(0, Number(stateItem.remaining || 0));
  if (typeof stateItem?.formatValue === "function") {
    return `Te faltan ${formatAchievementValue(stateItem, safeRemaining)} para desbloquear ${stateItem.title}.`;
  }
  if (safeRemaining === 1) {
    const singular = unit.replace(/s$/, "") || unit;
    return `Te falta ${formatAchievementValue(stateItem, 1)} ${singular} para desbloquear ${stateItem.title}.`;
  }
  return `Te faltan ${formatAchievementValue(stateItem, safeRemaining)} ${unit} para desbloquear ${stateItem.title}.`;
}

function renderProgressBar(progressRatio = 0) {
  const pct = Math.max(0, Math.min(100, Math.round(progressRatio * 100)));
  return `
    <div class="app-achievements-progress" aria-hidden="true">
      <i style="width:${pct}%"></i>
    </div>
  `;
}

function renderAchievementCard(stateItem, { compact = false } = {}) {
  const title = stateItem.hiddenLocked ? "Logro oculto" : stateItem.title;
  const description = stateItem.hiddenLocked ? "Sigue usando la app para descubrirlo." : stateItem.description;
  const progressText = stateItem.completed
    ? `Desbloqueado · ${formatDate(stateItem.unlockedAt)}`
    : `${formatAchievementValue(stateItem, stateItem.currentValue)}/${formatAchievementValue(stateItem, stateItem.targetValue)}`;
  return `
    <article class="app-achievement-card${compact ? " is-compact" : ""}" data-achievement-state="${stateItem.state}">
      <div class="app-achievement-card__head">
        <div class="app-achievement-card__icon" aria-hidden="true">${escapeHtml(stateItem.hiddenLocked ? "✨" : stateItem.icon)}</div>
        <div class="app-achievement-card__copy">
          <strong>${escapeHtml(title)}</strong>
          <span>${escapeHtml(description)}</span>
        </div>
      </div>
      ${stateItem.completed ? "" : renderProgressBar(stateItem.progressRatio)}
      <div class="app-achievement-card__meta">
        <span>${escapeHtml(formatAchievementScope(stateItem))}</span>
        <span>${escapeHtml(progressText)}</span>
      </div>
    </article>
  `;
}

function renderGroupedSection(title, states = [], { showDates = false } = {}) {
  if (!states.length) {
    return `
      <section class="sheet-section">
        <div class="sheet-section-title">${escapeHtml(title)}</div>
        <p class="app-achievements-empty">Todavía no hay elementos en esta sección.</p>
      </section>
    `;
  }

  const groups = groupStatesByModule(states);
  const body = Object.entries(groups)
    .sort((a, b) => {
      const order = ["general", ...getModuleKeys()];
      return order.indexOf(a[0]) - order.indexOf(b[0]);
    })
    .map(([moduleKey, moduleStates]) => {
      const meta = getAchievementModuleMeta(moduleKey);
      const sorted = [...moduleStates].sort((a, b) => {
        if (showDates && b.unlockedAt !== a.unlockedAt) return b.unlockedAt - a.unlockedAt;
        const groupDiff = String(a.groupLabel || "").localeCompare(String(b.groupLabel || ""), "es");
        if (groupDiff) return groupDiff;
        if (b.progressRatio !== a.progressRatio) return b.progressRatio - a.progressRatio;
        return a.targetValue - b.targetValue;
      });
      const subgroupMap = sorted.reduce((acc, stateItem) => {
        const subgroupKey = String(stateItem.groupKey || "__default");
        if (!acc[subgroupKey]) {
          acc[subgroupKey] = {
            label: String(stateItem.groupLabel || "").trim(),
            items: [],
          };
        }
        acc[subgroupKey].items.push(stateItem);
        return acc;
      }, {});
      const subgroupEntries = Object.values(subgroupMap);
      return `
        <div class="app-achievements-group">
          <div class="app-achievements-group__title">${escapeHtml(`${meta.emoji} ${meta.label}`)}</div>
          ${subgroupEntries.map((subgroup) => `
            <div class="app-achievements-subgroup">
              ${subgroup.label ? `<div class="app-achievements-subgroup__title">${escapeHtml(subgroup.label)}</div>` : ""}
              <div class="app-achievements-grid">
                ${subgroup.items.map((stateItem) => renderAchievementCard(stateItem, { compact: true })).join("")}
              </div>
            </div>
          `).join("")}
        </div>
      `;
    })
    .join("");

  return `
    <section class="sheet-section">
      <div class="sheet-section-title">${escapeHtml(title)}</div>
      ${body}
    </section>
  `;
}

function renderAchievementsButton() {
  const button = ensureTopBarButton();
  if (!button) return;
  const summary = buildSummary(computeAchievementStates());
  const count = button.querySelector("[data-achievements-count]");
  if (count) count.textContent = `${summary.completedCount}/${summary.availableCount}`;
  button.classList.toggle("hidden", !state.uid);
}

function renderAchievementsCenter() {
  const body = document.getElementById("app-achievements-body");
  if (!body || !state.ui.centerOpen) {
    renderAchievementsButton();
    return;
  }

  const states = computeAchievementStates();
  const summary = buildSummary(states);
  const closest = getClosestAchievements(states, 6);
  const inProgress = states.filter((stateItem) => !stateItem.completed && !stateItem.hiddenLocked && stateItem.currentValue > 0);
  const completed = states.filter((stateItem) => stateItem.completed);

  body.innerHTML = `
    <section class="sheet-section app-achievements-summary">
      <div class="app-achievements-summary__stats">
        <article class="app-achievements-stat">
          <small>Logrados</small>
          <strong>${summary.completedCount}</strong>
        </article>
        <article class="app-achievements-stat">
          <small>Disponibles</small>
          <strong>${summary.availableCount}</strong>
        </article>
        <article class="app-achievements-stat">
          <small>Progreso</small>
          <strong>${summary.completionPct}%</strong>
        </article>
      </div>
      ${renderProgressBar(summary.completionPct / 100)}
    </section>

    <section class="sheet-section">
      <div class="sheet-section-title">Casi lo consigues</div>
      <div class="app-achievements-nearby">
        ${closest.length
          ? closest.map((stateItem) => `
            <article class="app-achievements-nearby__item">
              <div class="app-achievements-nearby__top">
                <span>${escapeHtml(`${stateItem.moduleMeta.emoji} ${stateItem.title}`)}</span>
                <strong>${Math.round(stateItem.progressRatio * 100)}%</strong>
              </div>
              ${renderProgressBar(stateItem.progressRatio)}
              <p>${escapeHtml(formatRemainingLabel(stateItem))}</p>
            </article>
          `).join("")
          : '<p class="app-achievements-empty">Todavía no hay logros cercanos con progreso real.</p>'}
      </div>
    </section>

    ${renderGroupedSection("En progreso", inProgress)}
    ${renderGroupedSection("Desbloqueados", completed, { showDates: true })}
  `;

  renderAchievementsButton();
}

// Cola visual compacta: evita repetir notificaciones y permite encadenar varios desbloqueos.
function renderToasts() {
  const stack = ensureToastStack();
  if (!stack) return;
  stack.innerHTML = state.toasts.map((toast) => `
    <article class="app-achievement-toast" data-achievement-toast-id="${escapeHtml(toast.id)}">
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

function enqueueToast(achievementState) {
  if (!achievementState) return;
  const toastId = `${achievementState.id}-${Date.now()}`;
  state.toasts = [...state.toasts, {
    id: toastId,
    icon: achievementState.icon,
    title: `Logro desbloqueado: ${achievementState.title}`,
    description: achievementState.description,
  }].slice(-3);
  renderToasts();
  window.setTimeout(() => dismissToast(toastId), 4200);
}

function queueUnlockNotifications(unlockIds = []) {
  const states = computeAchievementStates();
  unlockIds.forEach((achievementId) => {
    const stateItem = states.find((entry) => entry.id === achievementId);
    if (!stateItem || stateItem.hiddenLocked) return;
    markUnlockAsSeen(achievementId);
    enqueueToast(stateItem);
  });
  renderAchievementsButton();
}

function updateRemoteState(payload = {}) {
  state.remoteData = {
    unlocked: payload?.unlocked && typeof payload.unlocked === "object" ? payload.unlocked : {},
    usage: payload?.usage && typeof payload.usage === "object" ? payload.usage : {},
  };
  renderAchievementsButton();
  renderAchievementsCenter();
}

function handleRemoteSnapshot(payload = {}) {
  const nextUnlocked = payload?.unlocked && typeof payload.unlocked === "object" ? payload.unlocked : {};
  if (!state.remoteHydrated) {
    updateRemoteState(payload);
    Object.keys(nextUnlocked).forEach((achievementId) => markUnlockAsSeen(achievementId));
    state.remoteHydrated = true;
    scheduleEvaluation(getModuleKeys());
    return;
  }

  const previousUnlocked = state.remoteData?.unlocked || {};
  updateRemoteState(payload);
  const newUnlockIds = Object.keys(nextUnlocked).filter((achievementId) => !previousUnlocked?.[achievementId] && !state.seenUnlockIds.has(achievementId));
  if (newUnlockIds.length) queueUnlockNotifications(newUnlockIds);
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

async function persistNewUnlocks(unlockRecords = {}) {
  const entries = Object.entries(unlockRecords || {});
  if (!entries.length || !state.achievementsRoot) return;
  const patch = {
    lastEvaluatedAt: Date.now(),
  };
  entries.forEach(([achievementId, record]) => {
    patch[`unlocked/${achievementId}`] = record;
  });
  await update(ref(db, state.achievementsRoot), patch);
}

// Motor central: evalúa el catálogo con métricas derivadas y guarda solo los desbloqueos nuevos.
async function evaluateAchievements({ moduleKeys = [], forceFetch = false } = {}) {
  if (!state.uid || !state.remoteHydrated) return;
  const targets = moduleKeys.length ? Array.from(new Set(moduleKeys)) : getModuleKeys();
  if (forceFetch) {
    await Promise.all(targets.map((moduleKey) => ensureModuleMetrics(moduleKey, { forceRemote: true })));
  }

  const states = computeAchievementStates();
  const unlockedMap = state.remoteData?.unlocked || {};
  const pending = {};
  states.forEach((stateItem) => {
    if (stateItem.unlocked) return;
    if (state.pendingUnlockIds.has(stateItem.id)) return;
    if (!stateItem.satisfied) return;
    pending[stateItem.id] = {
      achievementId: stateItem.id,
      module: stateItem.module,
      unlockedAt: Date.now(),
      currentValue: stateItem.currentValue,
      targetValue: stateItem.targetValue,
      title: stateItem.title,
    };
  });

  const newUnlockIds = Object.keys(pending).filter((achievementId) => !unlockedMap?.[achievementId]);
  if (!newUnlockIds.length) {
    renderAchievementsButton();
    renderAchievementsCenter();
    return;
  }

  newUnlockIds.forEach((achievementId) => state.pendingUnlockIds.add(achievementId));
  try {
    await persistNewUnlocks(pending);
    queueUnlockNotifications(newUnlockIds);
  } catch (error) {
    console.warn("[achievements] no se pudieron guardar los desbloqueos", error);
  } finally {
    newUnlockIds.forEach((achievementId) => state.pendingUnlockIds.delete(achievementId));
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
    if (liveSnapshot) {
      writeModuleMetrics(moduleKey, liveSnapshot, "live");
    } else {
      requiresRemoteRefresh = true;
    }
  });

  renderAchievementsButton();
  renderAchievementsCenter();
  // Los módulos disparan `bookshell:data`; aquí lo convertimos en una re-evaluación ligera por módulo.
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
  state.remoteData = { unlocked: {}, usage: {} };
  state.seenUnlockIds = new Set();
  state.pendingUnlockIds = new Set();
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
  state.seenUnlockIds = readSeenUnlockIds(nextUid);
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
  state.authUnsub = onUserChange((user) => {
    handleAuthUser(user || auth.currentUser || null);
  });
  handleAuthUser(auth.currentUser || null);
  window.__bookshellAchievements = {
    openCenter: openAchievementsCenter,
    closeCenter: closeAchievementsCenter,
    getStates: () => computeAchievementStates(),
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
  if (liveSnapshot) {
    writeModuleMetrics(moduleKey, liveSnapshot, "live");
    scheduleEvaluation([moduleKey]);
    renderAchievementsButton();
    renderAchievementsCenter();
  }
}
