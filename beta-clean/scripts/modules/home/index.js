import { auth, db } from "../../shared/firebase/index.js";
import {
  onValue,
  ref,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const HOME_VIEW_ID = "view-home";
const HOME_SYNC_EVENT = "bookshell:sync-state";
const HOME_HISTORY_EVENT = "bookshell:view-history-changed";
const HOME_REFRESH_MS = 30000;

const FALLBACK_VIEW_META = Object.freeze({
  "view-home": { label: "Home diario", shortLabel: "Diario" },
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
});

const FALLBACK_QUICK_ACTIONS = Object.freeze([
  { key: "books", label: "Leer", viewId: "view-books" },
  { key: "improvements", label: "Fix", viewId: "view-improvements" },
  { key: "media", label: "Media", viewId: "view-media" },
  { key: "notes", label: "Nota", viewId: "view-notes" },
  { key: "videos", label: "Video", viewId: "view-videos-hub" },
  { key: "gym", label: "Gym", viewId: "view-gym" },
  { key: "recipes", label: "Comida", viewId: "view-recipes" },
  { key: "finance", label: "Gasto", viewId: "view-finance" },
]);

let currentRoot = null;
let eventsBound = false;
let renderTimer = 0;
let syncBound = false;
let historyBound = false;
let activeSessionsUnsubscribe = null;
let activeSessionSnapshot = null;

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function getViewMeta(viewId) {
  return window.__bookshellGetViewMeta?.(viewId) || FALLBACK_VIEW_META[viewId] || {
    label: viewId,
    shortLabel: viewId,
  };
}

function getQuickActions() {
  const actions = window.__bookshellGetGlobalQuickFabActions?.();
  return Array.isArray(actions) && actions.length ? actions : [...FALLBACK_QUICK_ACTIONS];
}

function getRecentViews(limit = 4) {
  const values = window.__bookshellGetRecentViews?.({
    limit,
    excludeHome: true,
  });
  return Array.isArray(values) ? values : [];
}

function getLastNonHomeView() {
  return window.__bookshellGetLastNonHomeView?.() || getRecentViews(1)[0] || null;
}

function getSyncSnapshot() {
  return window.__bookshellGetSyncSnapshot?.() || null;
}

function formatLongDate() {
  try {
    return new Intl.DateTimeFormat("es-ES", {
      weekday: "long",
      day: "numeric",
      month: "long",
    }).format(new Date());
  } catch (_) {
    return "Hoy";
  }
}

function formatRelativeTime(ts) {
  const numeric = Number(ts) || 0;
  if (!numeric) return "Hace un momento";

  const diffMs = Date.now() - numeric;
  const diffMin = Math.max(0, Math.round(diffMs / 60000));
  if (diffMin < 1) return "Ahora mismo";
  if (diffMin === 1) return "Hace 1 min";
  if (diffMin < 60) return `Hace ${diffMin} min`;

  const diffHours = Math.round(diffMin / 60);
  if (diffHours === 1) return "Hace 1 h";
  if (diffHours < 24) return `Hace ${diffHours} h`;

  const diffDays = Math.round(diffHours / 24);
  if (diffDays === 1) return "Ayer";
  return `Hace ${diffDays} d`;
}

function formatClock(ts) {
  const numeric = Number(ts) || 0;
  if (!numeric) return "";
  try {
    return new Date(numeric).toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch (_) {
    return "";
  }
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const totalMinutes = Math.floor(safeSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours} h ${String(minutes).padStart(2, "0")} min`;
  }
  return `${Math.max(1, totalMinutes)} min`;
}

function getSessionElapsedSec(session) {
  if (!session || typeof session !== "object") return 0;
  if (Number.isFinite(Number(session.elapsedSec))) {
    return Math.max(0, Number(session.elapsedSec));
  }

  const accMs = Math.max(0, Number(session.accMs) || 0);
  const startedAt = Math.max(0, Number(session.startedAt) || 0);
  const isPaused = String(session.status || "") === "paused";
  if (!startedAt || isPaused) {
    return Math.round(accMs / 1000);
  }

  return Math.round((accMs + Math.max(0, Date.now() - startedAt)) / 1000);
}

function getActiveSessionsPath(uid) {
  return uid ? `v2/users/${uid}/habits/habits/activeSessions` : "";
}

function pickActiveSession(rawValue) {
  if (!rawValue || typeof rawValue !== "object") return null;

  const candidates = Object.entries(rawValue)
    .map(([sessionId, value]) => ({
      sessionId,
      ...(value || {}),
    }))
    .filter((session) => session && typeof session === "object");

  if (!candidates.length) return null;

  candidates.sort((a, b) => {
    const aRunning = String(a.status || "") === "running" ? 1 : 0;
    const bRunning = String(b.status || "") === "running" ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;
    const aTs = Number(a.updatedAt || a.startedAt || a.createdAt) || 0;
    const bTs = Number(b.updatedAt || b.startedAt || b.createdAt) || 0;
    return bTs - aTs;
  });

  return candidates[0] || null;
}

function getSessionSourceLabel(session) {
  const source = String(session?.meta?.source || "").trim();
  switch (source) {
    case "books":
      return "Lectura";
    case "videos":
      return "Videos";
    case "media":
      return "Media";
    case "recipes":
      return "Comida";
    case "gym":
      return "Gym";
    default:
      return "Habitos";
  }
}

function getSessionHabitLabel(session) {
  const habitId = String(session?.habitId || "").trim();
  const habitsApi = window.__bookshellHabits;
  if (habitId && typeof habitsApi?.listActiveHabits === "function") {
    const match = habitsApi.listActiveHabits().find((habit) => String(habit?.id || "") === habitId);
    if (match?.name) return match.name;
  }
  return getSessionSourceLabel(session);
}

function describeView(viewId) {
  if (viewId === "view-books") {
    const recentBook = window.__bookshellBooks?.getRecentBook?.();
    if (recentBook?.title) {
      return `Ultimo libro: ${recentBook.title}`;
    }
    return "Volver a libros y seguir leyendo.";
  }

  if (viewId === "view-recipes") {
    const trackedRecipe = window.__bookshellRecipes?.getTrackedRecipe?.()
      || window.__bookshellRecipes?.getLastViewedRecipe?.()
      || window.__bookshellRecipes?.getRecentRecipeFallback?.();
    if (trackedRecipe?.title) {
      return `Receta activa: ${trackedRecipe.title}`;
    }
    return "Retomar recetas y registros recientes.";
  }

  if (viewId === "view-notes") {
    return "Seguir con tus notas y capturas rapidas.";
  }

  if (viewId === "view-habits") {
    return "Volver al seguimiento del dia y las sesiones activas.";
  }

  if (viewId === "view-finance") {
    return "Anadir o revisar movimientos recientes.";
  }

  return "Abrir el modulo donde te quedaste.";
}

function buildContinueCards() {
  const cards = [];

  if (activeSessionSnapshot) {
    const habitLabel = getSessionHabitLabel(activeSessionSnapshot);
    const syncLabel = String(activeSessionSnapshot.status || "") === "paused" ? "En pausa" : "En curso";
    cards.push({
      eyebrow: "Sesion activa",
      title: habitLabel,
      meta: `${syncLabel} · ${formatDuration(getSessionElapsedSec(activeSessionSnapshot))}`,
      copy: "Abrir Habitos para seguir, pausar o cerrar la sesion.",
      viewId: "view-habits",
      reset: false,
    });
  }

  const lastView = getLastNonHomeView();
  if (lastView?.viewId) {
    const meta = getViewMeta(lastView.viewId);
    cards.push({
      eyebrow: "Ultimo modulo",
      title: meta.label,
      meta: formatRelativeTime(lastView.at),
      copy: describeView(lastView.viewId),
      viewId: lastView.viewId,
      reset: false,
    });
  }

  return cards.filter((card, index, list) => list.findIndex((entry) => entry.viewId === card.viewId) === index);
}

function renderSyncPill() {
  const pill = currentRoot?.querySelector("#home-sync-pill");
  if (!pill) return;

  const snapshot = getSyncSnapshot();
  let text = "Sincronizado";
  let tone = "synced";

  if (snapshot?.syncing || (Number(snapshot?.syncingCount) || 0) > 0) {
    text = "Sincronizando";
    tone = "syncing";
  } else if ((Number(snapshot?.failedCount) || 0) > 0) {
    text = `${snapshot.failedCount} con error`;
    tone = "error";
  } else if ((Number(snapshot?.totalCount) || 0) > 0) {
    text = `${snapshot.totalCount} pendiente${Number(snapshot.totalCount) === 1 ? "" : "s"}`;
    tone = snapshot?.rtdbConnected ? "pending" : "offline";
  } else if (!snapshot?.appOnline || !snapshot?.rtdbConnected) {
    text = "Sin conexion";
    tone = "offline";
  } else {
    const clock = formatClock(snapshot?.lastSyncAt);
    if (clock) text = `Sync ${clock}`;
  }

  pill.dataset.state = tone;
  pill.textContent = text;
}

function renderDateLabel() {
  const label = currentRoot?.querySelector("#home-date-label");
  if (!label) return;
  label.textContent = formatLongDate();
}

function renderContinueButtonLabel() {
  const button = currentRoot?.querySelector("[data-home-open-continue]");
  if (!button) return;

  const session = activeSessionSnapshot;
  if (session) {
    button.textContent = "Seguir sesion";
    return;
  }

  const lastView = getLastNonHomeView();
  if (!lastView?.viewId) {
    button.textContent = "Abrir libros";
    return;
  }

  button.textContent = `Continuar ${getViewMeta(lastView.viewId).shortLabel || getViewMeta(lastView.viewId).label}`;
}

function renderContinueCards() {
  const host = currentRoot?.querySelector("#home-continue-list");
  if (!host) return;

  const cards = buildContinueCards();
  if (!cards.length) {
    host.innerHTML = `
      <p class="home-empty">
        Aun no hay nada para continuar. Empieza por Habitos, Libros o una quick action.
      </p>
    `;
    return;
  }

  host.innerHTML = cards.map((card) => `
    <button
      class="home-list-card"
      type="button"
      data-home-open-view="${escapeHtml(card.viewId)}"
      data-home-reset="${card.reset ? "1" : "0"}"
    >
      <span class="home-list-eyebrow">${escapeHtml(card.eyebrow)}</span>
      <span class="home-list-title">${escapeHtml(card.title)}</span>
      <span class="home-list-meta">${escapeHtml(card.meta)}</span>
      <span class="home-list-copy">${escapeHtml(card.copy)}</span>
    </button>
  `).join("");
}

function renderRecentCards() {
  const host = currentRoot?.querySelector("#home-recent-list");
  if (!host) return;

  const recentViews = getRecentViews(4);
  if (!recentViews.length) {
    host.innerHTML = `
      <p class="home-empty">
        Tus accesos recientes apareceran aqui para retomar la app sin pensar demasiado.
      </p>
    `;
    return;
  }

  host.innerHTML = recentViews.map((entry) => {
    const meta = getViewMeta(entry.viewId);
    return `
      <button class="home-list-card" type="button" data-home-open-view="${escapeHtml(entry.viewId)}" data-home-reset="0">
        <span class="home-list-eyebrow">Reciente</span>
        <span class="home-list-title">${escapeHtml(meta.label)}</span>
        <span class="home-list-meta">${escapeHtml(formatRelativeTime(entry.at))}</span>
        <span class="home-list-copy">${escapeHtml(describeView(entry.viewId))}</span>
      </button>
    `;
  }).join("");
}

function renderQuickActions() {
  const host = currentRoot?.querySelector("#home-quick-actions");
  if (!host) return;

  const actions = getQuickActions();
  host.innerHTML = actions.map((action) => {
    const viewMeta = action.viewMeta || getViewMeta(action.viewId);
    return `
      <button class="home-quick-action" type="button" data-home-run-quick="${escapeHtml(action.key)}">
        <span class="home-card-kicker">${escapeHtml(viewMeta.shortLabel || viewMeta.label || "Accion")}</span>
        <span class="home-quick-action-title">${escapeHtml(action.label)}</span>
        <span class="home-quick-action-copy">Abrir ${escapeHtml(viewMeta.label || "modulo")} con su acceso rapido existente.</span>
      </button>
    `;
  }).join("");
}

function renderHome() {
  if (!currentRoot) return;
  renderDateLabel();
  renderSyncPill();
  renderContinueButtonLabel();
  renderContinueCards();
  renderRecentCards();
  renderQuickActions();
}

async function openView(viewId, { resetToRoot = false } = {}) {
  const safeViewId = String(viewId || "").trim();
  if (!safeViewId) return;

  if (resetToRoot && typeof window.__bookshellOpenViewRoot === "function") {
    await window.__bookshellOpenViewRoot(safeViewId);
    return;
  }

  if (typeof window.__bookshellNavigateToView === "function") {
    await window.__bookshellNavigateToView(safeViewId);
  }
}

async function openContinueTarget() {
  if (activeSessionSnapshot) {
    await openView("view-habits");
    return;
  }

  const lastView = getLastNonHomeView();
  if (lastView?.viewId) {
    await openView(lastView.viewId);
    return;
  }

  await openView("view-books");
}

function handleRootClick(event) {
  const quickActionButton = event.target?.closest?.("[data-home-run-quick]");
  if (quickActionButton) {
    event.preventDefault();
    const actionKey = String(quickActionButton.dataset.homeRunQuick || "").trim();
    if (actionKey) {
      void window.__bookshellRunGlobalQuickFabAction?.(actionKey);
    }
    return;
  }

  const continueButton = event.target?.closest?.("[data-home-open-continue]");
  if (continueButton) {
    event.preventDefault();
    void openContinueTarget();
    return;
  }

  const fabButton = event.target?.closest?.("[data-home-open-fab]");
  if (fabButton) {
    event.preventDefault();
    window.__bookshellOpenGlobalQuickFab?.();
    return;
  }

  const openViewButton = event.target?.closest?.("[data-home-open-view]");
  if (!openViewButton) return;

  event.preventDefault();
  const viewId = String(openViewButton.dataset.homeOpenView || "").trim();
  const resetToRoot = String(openViewButton.dataset.homeReset || "") === "1";
  void openView(viewId, { resetToRoot });
}

function bindRootEvents() {
  if (!currentRoot || eventsBound) return;
  currentRoot.addEventListener("click", handleRootClick);
  eventsBound = true;
}

function unbindActiveSessionsFeed() {
  if (typeof activeSessionsUnsubscribe === "function") {
    try {
      activeSessionsUnsubscribe();
    } catch (_) {}
  }
  activeSessionsUnsubscribe = null;
}

function bindActiveSessionsFeed() {
  const uid = auth.currentUser?.uid || "";
  if (!uid) {
    activeSessionSnapshot = null;
    renderHome();
    return;
  }

  unbindActiveSessionsFeed();
  activeSessionsUnsubscribe = onValue(ref(db, getActiveSessionsPath(uid)), (snapshot) => {
    activeSessionSnapshot = pickActiveSession(snapshot.val());
    renderHome();
  }, (error) => {
    console.warn("[home] no se pudo escuchar activeSessions", error);
  });
}

function startRenderTimer() {
  stopRenderTimer();
  renderTimer = window.setInterval(() => {
    if (document.documentElement.dataset.currentViewId !== HOME_VIEW_ID) return;
    renderHome();
  }, HOME_REFRESH_MS);
}

function stopRenderTimer() {
  if (renderTimer) {
    window.clearInterval(renderTimer);
  }
  renderTimer = 0;
}

function bindGlobalEvents() {
  if (!syncBound) {
    window.addEventListener(HOME_SYNC_EVENT, () => {
      if (document.documentElement.dataset.currentViewId === HOME_VIEW_ID) {
        renderHome();
      }
    });
    syncBound = true;
  }

  if (!historyBound) {
    window.addEventListener(HOME_HISTORY_EVENT, () => {
      if (document.documentElement.dataset.currentViewId === HOME_VIEW_ID) {
        renderHome();
      }
    });
    historyBound = true;
  }
}

export async function init({ root }) {
  currentRoot = root;
  bindRootEvents();
  bindGlobalEvents();
  renderHome();
}

export async function onShow({ root }) {
  currentRoot = root;
  bindRootEvents();
  bindGlobalEvents();
  bindActiveSessionsFeed();
  renderHome();
  startRenderTimer();
}

export async function onHide() {
  stopRenderTimer();
  unbindActiveSessionsFeed();
}
