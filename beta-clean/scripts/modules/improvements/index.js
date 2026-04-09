import { auth, db, onUserChange } from "../../shared/firebase/index.js";
import {
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { ensureEcharts } from "../../shared/vendors/echarts.js";
import { subscribeSyncState } from "../../shared/services/sync-manager.js?v=2026-04-05-v5";

const DEFAULT_VIEW_ID = "view-books";
const DEFAULT_BOARD_ID = "board-general";
const PRIORITY_ORDER = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};
const PRIORITY_LABELS = {
  critical: "Critica",
  high: "Alta",
  medium: "Media",
  low: "Baja",
};
const STATUS_LABELS = {
  pending: "Pendiente",
  resolved: "Resuelto",
};
const FIX_TYPE_PRESETS = [
  {
    key: "sin-tipo",
    label: "Sin tipo",
    tone: "slate",
    aliases: ["sin tipo", "sin clasificar", "untyped", "unknown"],
  },
  {
    key: "estetico",
    label: "Estetico",
    tone: "rose",
    aliases: ["estetico", "estetica", "visual", "ui", "diseno", "layout", "style", "styling", "css", "maquetacion"],
  },
  {
    key: "logico",
    label: "Logico",
    tone: "blue",
    aliases: ["logico", "logica", "logic", "logical", "funcional", "functional", "behavior", "behaviour", "comportamiento", "bug"],
  },
  {
    key: "ux",
    label: "UX",
    tone: "green",
    aliases: ["ux", "usabilidad", "flujo", "interaccion", "interaction"],
  },
  {
    key: "datos",
    label: "Datos",
    tone: "amber",
    aliases: ["datos", "data", "firebase", "sync", "sincronizacion", "persistencia", "storage", "import", "export"],
  },
  {
    key: "rendimiento",
    label: "Rendimiento",
    tone: "slate",
    aliases: ["rendimiento", "performance", "perf", "optimizacion", "optimizar", "lento", "slow"],
  },
  {
    key: "contenido",
    label: "Contenido",
    tone: "green",
    aliases: ["contenido", "content", "copy", "texto", "text", "traduccion", "translation", "label"],
  },
  {
    key: "otro",
    label: "Otro",
    tone: "slate",
    aliases: ["otro", "otros", "other", "misc", "varios"],
  },
];
const FIX_TYPE_META = Object.fromEntries(
  FIX_TYPE_PRESETS.map((preset, index) => [preset.key, { ...preset, index }])
);
const VIEW_LABELS = {
  "view-books": "Libros",
  "view-videos-hub": "Videos Hub",
  "view-recipes": "Recetas",
  "view-habits": "Habitos",
  "view-games": "Juegos",
  "view-media": "Media",
  "view-world": "Mundo",
  "view-finance": "Cuentas",
  "view-gym": "Gym",
};
const VIEW_TONES = {
  "view-books": "blue",
  "view-videos-hub": "rose",
  "view-recipes": "amber",
  "view-habits": "green",
  "view-games": "blue",
  "view-media": "rose",
  "view-world": "green",
  "view-finance": "amber",
  "view-gym": "slate",
};
const MODULE_EMOJIS = {
  books: "📚",
  "videos-hub": "🎬",
  recipes: "🍳",
  habits: "✅",
  games: "🎮",
  media: "🎞️",
  world: "🌍",
  finance: "💸",
  gym: "🏋️",
  general: "🧩",
};
const BOARD_TONES = new Set(["slate", "blue", "green", "amber", "rose"]);
const BOARD_ACCENT_COLORS = {
  slate: "#b7c5df",
  blue: "#73b8ff",
  green: "#5fdaab",
  amber: "#ffb05c",
  rose: "#ff6b7c",
};
const STATS_COLORS = {
  pending: "#ffbf69",
  resolved: "#64dca7",
  backlog: "#7cc2ff",
  created: "#8ea7ff",
  resolvedFlow: "#5fdaab",
  critical: "#ff6b7c",
};

const state = {
  initialized: false,
  root: null,
  uid: "",
  path: "",
  viewVisible: false,
  boards: {},
  items: {},
  activeViewId: DEFAULT_VIEW_ID,
  currentWindow: "main",
  editingItemId: "",
  editorOpen: false,
  exportOpen: false,
  activeTypeFilters: new Set(),
  selectedItems: new Set(),
  exportText: "",
  expandedItems: new Set(),
  collapsedItems: new Set(),
  listeners: [],
  authUnsub: null,
  eventsBound: false,
  resolvedPanelCollapsed: false,
  statsCharts: {
    donut: null,
    bar: null,
    line: null,
  },
  statsResizeRaf: 0,
  handleWindowResize: null,
  statsRenderIdleHandle: 0,
  renderFrame: 0,
  syncUnsubscribe: null,
  syncState: null,
  performance: {
    busy: false,
    status: "idle",
    statusText: "La auditoria solo se ejecuta manualmente.",
    result: null,
    lastRunAt: 0,
  },
  derived: {
    dirty: true,
    allItems: [],
    itemsByView: new Map(),
    countsByView: new Map(),
    globalCounts: { pending: 0, resolved: 0 },
    availableBoardsRaw: [],
    availableBoardsSorted: [],
    typeStatsByView: new Map(),
    statsByView: new Map(),
  },
};

let improvementsEchartsPromise = null;
let improvementsPerformanceAuditPromise = null;

function ensureImprovementsEchartsReady() {
  if (window.echarts?.init) {
    return Promise.resolve(window.echarts);
  }
  if (!improvementsEchartsPromise) {
    improvementsEchartsPromise = ensureEcharts().finally(() => {
      improvementsEchartsPromise = null;
    });
  }
  return improvementsEchartsPromise;
}

function ensureImprovementsPerformanceAuditReady() {
  if (!improvementsPerformanceAuditPromise) {
    improvementsPerformanceAuditPromise = import("./performance-audit.js");
  }
  return improvementsPerformanceAuditPromise;
}

function waitForAnimationFrames(count = 2) {
  const total = Math.max(1, Math.floor(Number(count) || 1));
  return new Promise((resolve) => {
    let remaining = total;
    const tick = () => {
      remaining -= 1;
      if (remaining <= 0) {
        resolve();
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

async function measureImprovementMainRender() {
  const startedAt = performance.now();
  renderMainWindow();
  await waitForAnimationFrames(2);
  return Math.round(performance.now() - startedAt);
}

async function measureImprovementStatsRender() {
  const startedAt = performance.now();
  renderImprovementStats({ deferCharts: false });
  await waitForAnimationFrames(2);
  if (state.currentWindow !== "stats") {
    disposeImprovementStatsCharts();
  }
  return Math.round(performance.now() - startedAt);
}

async function measureImprovementEditorOpen() {
  if (!els.editorBackdrop || state.editorOpen) return null;
  const previousVisibility = els.editorBackdrop.style.visibility;
  const startedAt = performance.now();
  els.editorBackdrop.style.visibility = "hidden";
  openEditorModal({ focus: false });
  await waitForAnimationFrames(2);
  closeEditorModal({ reset: false });
  els.editorBackdrop.style.visibility = previousVisibility;
  return Math.round(performance.now() - startedAt);
}

async function runPerformanceAudit() {
  if (state.performance.busy) return;
  state.performance.busy = true;
  state.performance.status = "preparing";
  state.performance.statusText = "Preparando muestras de shell, UI y datos...";
  renderPerformanceWindow();

  try {
    const { runBookshellPerformanceAudit, saveAuditResult } = await ensureImprovementsPerformanceAuditReady();
    const result = await runBookshellPerformanceAudit({
      auth,
      db,
      itemCount: getAllItems().length,
      currentViewId: ensureActiveViewId(),
      onStageChange: (stage, label) => {
        state.performance.status = stage;
        state.performance.statusText = label;
        renderPerformanceWindow();
      },
      measureListRender: measureImprovementMainRender,
      measureStatsRender: measureImprovementStatsRender,
      measureModalOpen: measureImprovementEditorOpen,
    });
    state.performance.result = result;
    state.performance.lastRunAt = Number(result?.executedAt) || Date.now();
    state.performance.status = "done";
    state.performance.statusText = "Auditoria terminada. Puedes recalcular cuando quieras.";
    // Guardar el resultado en el historico
    saveAuditResult(result);
  } catch (error) {
    state.performance.status = "error";
    state.performance.statusText = String(error?.message || error || "La auditoria no pudo completarse.");
    console.warn("[improvements] performance audit failed", error);
  } finally {
    state.performance.busy = false;
    renderPerformanceWindow();
  }
}

const els = {};

function isItemExpanded(itemId, { defaultExpanded = false } = {}) {
  const nextItemId = String(itemId || "").trim();
  if (!nextItemId) return false;
  if (defaultExpanded) return !state.collapsedItems.has(nextItemId);
  return state.expandedItems.has(nextItemId);
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

function formatDateTime(ts) {
  if (!ts) return "--";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleString("es-ES", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatShortDate(ts) {
  if (!ts) return "--";
  const date = new Date(Number(ts));
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
  });
}

function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || "").split("-");
  const date = new Date(Number(year), Math.max(0, Number(month) - 1), 1);
  if (Number.isNaN(date.getTime())) return "--";
  return date.toLocaleDateString("es-ES", {
    month: "short",
    year: "2-digit",
  });
}

function formatPercent(value) {
  return `${Math.round(Number(value) || 0)}%`;
}

function scheduleIdleTask(callback, timeout = 300) {
  if (typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(callback, { timeout });
  }
  return window.setTimeout(() => callback({ didTimeout: true, timeRemaining: () => 0 }), 1);
}

function cancelIdleTask(handle) {
  if (!handle) return;
  if (typeof window !== "undefined" && typeof window.cancelIdleCallback === "function") {
    window.cancelIdleCallback(handle);
    return;
  }
  window.clearTimeout(handle);
}

function scheduleImprovementRender() {
  if (state.renderFrame) return;
  if (typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") {
    renderAll();
    return;
  }
  state.renderFrame = window.requestAnimationFrame(() => {
    state.renderFrame = 0;
    renderAll();
  });
}

function cancelScheduledImprovementRender() {
  if (!state.renderFrame) return;
  if (typeof window !== "undefined" && typeof window.cancelAnimationFrame === "function") {
    window.cancelAnimationFrame(state.renderFrame);
  }
  state.renderFrame = 0;
}

function createImprovementDerivedState() {
  return {
    dirty: true,
    allItems: [],
    itemsByView: new Map(),
    countsByView: new Map(),
    globalCounts: { pending: 0, resolved: 0 },
    availableBoardsRaw: [],
    availableBoardsSorted: [],
    typeStatsByView: new Map(),
    statsByView: new Map(),
  };
}

function invalidateImprovementDerivedData() {
  state.derived = createImprovementDerivedState();
}

function getAllItems() {
  return ensureImprovementDerivedData().allItems;
}

function getPriorityWeight(priority) {
  return PRIORITY_ORDER[sanitizePriority(priority)] || 0;
}

function getBoardAccent(boardLike) {
  const tone = sanitizeBoardTone(boardLike?.tone || boardLike);
  return BOARD_ACCENT_COLORS[tone] || BOARD_ACCENT_COLORS.slate;
}

function getItemAgeDays(item) {
  const ts = Number(item?.createdAt) || Number(item?.updatedAt) || 0;
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / (24 * 60 * 60 * 1000)));
}

function describeAgeDays(days) {
  const safeDays = Math.max(0, Number(days) || 0);
  if (!safeDays) return "hoy";
  if (safeDays === 1) return "1 dia";
  return `${safeDays} dias`;
}

function monthKeyFromTimestamp(ts) {
  const safeTs = Number(ts) || 0;
  if (!safeTs) return "";
  const date = new Date(safeTs);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStartFromKey(monthKey) {
  const [year, month] = String(monthKey || "").split("-");
  return new Date(Number(year), Math.max(0, Number(month) - 1), 1);
}

function shiftMonthKey(monthKey, offset = 0) {
  const date = monthStartFromKey(monthKey);
  if (Number.isNaN(date.getTime())) return "";
  date.setMonth(date.getMonth() + Number(offset || 0));
  return monthKeyFromTimestamp(date.getTime());
}

function isStatsViewVisible() {
  return Boolean(state.viewVisible && state.root?.classList?.contains("view-active") && state.currentWindow === "stats");
}

function normalizeToken(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function titleCaseSlug(value) {
  return String(value || "")
    .split("-")
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function titleCaseWords(value) {
  return String(value || "")
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeBoardSeed(value) {
  return String(value || "")
    .trim()
    .replace(/^view-/, "")
    .replace(/^board-/, "")
    .trim();
}

function sanitizeBoardTone(value) {
  const next = String(value || "").trim().toLowerCase();
  return BOARD_TONES.has(next) ? next : "slate";
}

function createCustomBoardId(value) {
  const token = normalizeToken(normalizeBoardSeed(value));
  return token ? `board-${token}` : DEFAULT_BOARD_ID;
}

function inferCustomBoardLabel(value) {
  const formatted = normalizeBoardSeed(value)
    .replace(/[_-]+/g, " ")
    .trim();

  return titleCaseWords(formatted) || "General";
}

function createBoardRecord({
  id,
  moduleKey = "",
  label = "",
  tone = "slate",
  isCustom = false,
  createdAt = null,
  updatedAt = null,
} = {}) {
  const nextId = String(id || "").trim() || DEFAULT_BOARD_ID;
  const nextLabel = String(label || "").trim() || inferCustomBoardLabel(nextId);

  return {
    id: nextId,
    viewId: nextId,
    moduleKey: String(moduleKey || normalizeBoardSeed(nextId) || normalizeToken(nextLabel) || "general").trim(),
    label: nextLabel,
    tone: sanitizeBoardTone(tone),
    isCustom: Boolean(isCustom),
    createdAt: Number(createdAt) || null,
    updatedAt: Number(updatedAt) || null,
  };
}

function getGeneralBoard() {
  return createBoardRecord({
    id: DEFAULT_BOARD_ID,
    moduleKey: "general",
    label: "General",
    tone: "slate",
    isCustom: true,
  });
}

function matchesBoardToken(board, normalizedValue) {
  if (!board || !normalizedValue) return false;

  return (
    normalizeToken(board.id) === normalizedValue
    || normalizeToken(normalizeBoardSeed(board.id)) === normalizedValue
    || normalizeToken(board.moduleKey) === normalizedValue
    || normalizeToken(board.label) === normalizedValue
  );
}

function getNavButtonForView(viewId) {
  return document.querySelector(`.bottom-nav .nav-btn[data-view="${viewId}"]`);
}

function inferViewLabel(viewId, moduleKey) {
  const navButton = getNavButtonForView(viewId);
  const label = String(
    navButton?.getAttribute("aria-label")
      || navButton?.title
      || VIEW_LABELS[viewId]
      || titleCaseSlug(moduleKey)
  ).trim();

  return label || titleCaseSlug(moduleKey) || "Pestana";
}

function inferBoardEmoji(boardLike, moduleKey = "") {
  const board = typeof boardLike === "object" && boardLike
    ? boardLike
    : { id: boardLike, moduleKey };
  const viewId = String(board?.id || "").trim();
  const nextModuleKey = String(
    board?.moduleKey
    || moduleKey
    || normalizeBoardSeed(viewId)
    || "general"
  ).trim();
  const navEmoji = String(getNavButtonForView(viewId)?.textContent || "").trim();

  if (navEmoji) return navEmoji;
  if (MODULE_EMOJIS[nextModuleKey]) return MODULE_EMOJIS[nextModuleKey];
  if (viewId === DEFAULT_BOARD_ID || nextModuleKey === "general") return MODULE_EMOJIS.general;
  return "🗂️";
}

function getShellTabs() {
  const seen = new Set();
  const tabs = Array.from(document.querySelectorAll(".view[data-module-view]"))
    .map((view) => {
      const viewId = String(view.id || "").trim();
      const moduleKey = String(view.dataset.moduleView || "").trim();
      if (!viewId || !moduleKey || moduleKey === "improvements" || seen.has(viewId)) return null;

      seen.add(viewId);
      return createBoardRecord({
        id: viewId,
        moduleKey,
        label: inferViewLabel(viewId, moduleKey),
        tone: VIEW_TONES[viewId] || "slate",
      });
    })
    .filter(Boolean);

  if (tabs.length) return tabs;

  return [createBoardRecord({
    id: DEFAULT_VIEW_ID,
    moduleKey: "books",
    label: VIEW_LABELS[DEFAULT_VIEW_ID],
    tone: VIEW_TONES[DEFAULT_VIEW_ID],
  })];
}

function normalizeStoredBoards(rawBoards, tabs = getShellTabs()) {
  const nextBoards = {};

  Object.entries(rawBoards || {}).forEach(([rawId, rawBoard]) => {
    if (rawId === "_init" || rawBoard == null) return;

    const boardId = resolveLegacyViewId(rawId, [...tabs, getGeneralBoard()], rawBoards);
    if (tabs.some((tab) => tab.id === boardId)) return;

    const rawLabel = typeof rawBoard === "string"
      ? rawBoard
      : (rawBoard?.name || rawBoard?.label || rawBoard?.title || "");

    nextBoards[boardId] = createBoardRecord({
      id: boardId,
      moduleKey: typeof rawBoard === "object" ? rawBoard?.moduleKey : "",
      label: String(rawLabel || "").trim() || inferCustomBoardLabel(rawId),
      tone: typeof rawBoard === "object" ? rawBoard?.tone : "slate",
      isCustom: true,
      createdAt: typeof rawBoard === "object" ? rawBoard?.createdAt : null,
      updatedAt: typeof rawBoard === "object" ? rawBoard?.updatedAt : null,
    });
  });

  return nextBoards;
}

function buildFallbackBoard(boardId) {
  const shellBoard = findTabById(boardId, getShellTabs());
  if (shellBoard) return shellBoard;

  const storedBoard = state.boards?.[boardId];
  if (storedBoard) return storedBoard;

  return createBoardRecord({
    id: createCustomBoardId(boardId),
    label: inferCustomBoardLabel(boardId),
    tone: "slate",
    isCustom: true,
  });
}

function compareBoards(a, b) {
  const aIsGeneral = isGeneralBoardViewId(a?.id);
  const bIsGeneral = isGeneralBoardViewId(b?.id);
  if (aIsGeneral && !bIsGeneral) return -1;
  if (!aIsGeneral && bIsGeneral) return 1;

  const countsA = getTabCounts(a.id);
  const countsB = getTabCounts(b.id);
  const pendingDiff = countsB.pending - countsA.pending;
  if (pendingDiff) return pendingDiff;

  const totalDiff = (countsB.pending + countsB.resolved) - (countsA.pending + countsA.resolved);
  if (totalDiff) return totalDiff;

  const resolvedDiff = countsB.resolved - countsA.resolved;
  if (resolvedDiff) return resolvedDiff;

  return String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" });
}

function ensureImprovementDerivedData() {
  if (!state.derived?.dirty) return state.derived;

  const mergedBoards = new Map();
  const addBoard = (board) => {
    if (!board?.id) return;
    const prev = mergedBoards.get(board.id);
    mergedBoards.set(board.id, prev
      ? {
          ...prev,
          ...board,
          label: String(board.label || prev.label || "").trim() || inferCustomBoardLabel(board.id),
          tone: sanitizeBoardTone(board.tone || prev.tone),
        }
      : board);
  };

  getShellTabs().forEach(addBoard);
  addBoard(getGeneralBoard());
  Object.values(state.boards || {}).forEach(addBoard);

  const allItems = Object.entries(state.items || {}).map(([id, item]) => ({ id, ...(item || {}) }));
  const itemsByView = new Map([[DEFAULT_BOARD_ID, allItems]]);
  const countsByView = new Map([[DEFAULT_BOARD_ID, { pending: 0, resolved: 0 }]]);
  const globalCounts = { pending: 0, resolved: 0 };

  allItems.forEach((item) => {
    if (item?.viewId) addBoard(buildFallbackBoard(item.viewId));
    const viewId = String(item?.viewId || DEFAULT_BOARD_ID).trim() || DEFAULT_BOARD_ID;
    if (!itemsByView.has(viewId)) itemsByView.set(viewId, []);
    itemsByView.get(viewId).push(item);

    if (!countsByView.has(viewId)) countsByView.set(viewId, { pending: 0, resolved: 0 });
    const bucket = countsByView.get(viewId);
    const status = sanitizeStatus(item?.status);
    if (status === "resolved") {
      bucket.resolved += 1;
      globalCounts.resolved += 1;
    } else {
      bucket.pending += 1;
      globalCounts.pending += 1;
    }
  });

  countsByView.set(DEFAULT_BOARD_ID, { ...globalCounts });

  const compareBoardsByCounts = (a, b) => {
    const aIsGeneral = isGeneralBoardViewId(a?.id);
    const bIsGeneral = isGeneralBoardViewId(b?.id);
    if (aIsGeneral && !bIsGeneral) return -1;
    if (!aIsGeneral && bIsGeneral) return 1;

    const countsA = countsByView.get(a.id) || { pending: 0, resolved: 0 };
    const countsB = countsByView.get(b.id) || { pending: 0, resolved: 0 };
    const pendingDiff = countsB.pending - countsA.pending;
    if (pendingDiff) return pendingDiff;

    const totalDiff = (countsB.pending + countsB.resolved) - (countsA.pending + countsA.resolved);
    if (totalDiff) return totalDiff;

    const resolvedDiff = countsB.resolved - countsA.resolved;
    if (resolvedDiff) return resolvedDiff;

    return String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" });
  };

  state.derived = {
    dirty: false,
    allItems,
    itemsByView,
    countsByView,
    globalCounts,
    availableBoardsRaw: Array.from(mergedBoards.values()),
    availableBoardsSorted: Array.from(mergedBoards.values()).sort(compareBoardsByCounts),
    typeStatsByView: new Map(),
    statsByView: new Map(),
  };

  return state.derived;
}

function getAvailableBoards({ sort = true } = {}) {
  const derived = ensureImprovementDerivedData();
  return sort ? derived.availableBoardsSorted : derived.availableBoardsRaw;
}

function getDefaultViewId(tabs = getAvailableBoards({ sort: false })) {
  return (
    tabs.find((tab) => tab.id === DEFAULT_BOARD_ID)?.id
    || tabs.find((tab) => tab.id === DEFAULT_VIEW_ID)?.id
    || tabs[0]?.id
    || DEFAULT_BOARD_ID
  );
}

function findTabById(viewId, tabs = getAvailableBoards({ sort: false })) {
  const rawId = String(viewId || "").trim();
  if (!rawId) return null;

  const byExactId = tabs.find((tab) => tab.id === rawId);
  if (byExactId) return byExactId;

  const normalizedRaw = normalizeToken(rawId);
  const normalizedSeed = normalizeToken(normalizeBoardSeed(rawId));
  return tabs.find((tab) => {
    return matchesBoardToken(tab, normalizedRaw) || matchesBoardToken(tab, normalizedSeed);
  }) || null;
}

function resolveLegacyViewId(rawValue, tabs = getAvailableBoards({ sort: false }), rawBoards = null) {
  const rawId = String(rawValue || "").trim();
  if (!rawId) return getDefaultViewId(tabs);

  if (tabs.some((tab) => tab.id === rawId)) return rawId;

  const normalizedRaw = normalizeToken(rawId);
  const normalizedSeed = normalizeToken(normalizeBoardSeed(rawId));
  const byDirectMatch = tabs.find((tab) => {
    return matchesBoardToken(tab, normalizedRaw) || matchesBoardToken(tab, normalizedSeed);
  });
  if (byDirectMatch) return byDirectMatch.id;

  const legacyName = String(
    typeof rawBoards?.[rawId] === "string"
      ? rawBoards?.[rawId]
      : (rawBoards?.[rawId]?.name || rawBoards?.[rawId]?.label || rawBoards?.[rawId]?.title || "")
  ).trim();
  if (legacyName) {
    const normalizedLegacyName = normalizeToken(legacyName);
    const byLegacyName = tabs.find((tab) => {
      return matchesBoardToken(tab, normalizedLegacyName);
    });
    if (byLegacyName) return byLegacyName.id;
    return createCustomBoardId(legacyName);
  }

  return createCustomBoardId(rawId);
}

function sanitizePriority(value) {
  const next = String(value || "").trim().toLowerCase();
  return PRIORITY_ORDER[next] ? next : "medium";
}

function sanitizeStatus(value) {
  return String(value || "").trim().toLowerCase() === "resolved" ? "resolved" : "pending";
}

function findFixTypePreset(value) {
  const token = normalizeToken(value);
  if (!token) return null;

  return FIX_TYPE_PRESETS.find((preset) => {
    if (token === normalizeToken(preset.key) || token === normalizeToken(preset.label)) return true;
    return preset.aliases.some((alias) => {
      const aliasToken = normalizeToken(alias);
      return aliasToken && (token === aliasToken || token.includes(aliasToken) || aliasToken.includes(token));
    });
  }) || null;
}

function inferFixTypeFromItemText(item) {
  const rawText = normalizeToken([
    item?.title,
    item?.description,
    item?.details,
    item?.instructions,
  ].filter(Boolean).join(" "));

  if (!rawText) return null;

  return FIX_TYPE_PRESETS
    .filter((preset) => !["sin-tipo", "otro"].includes(preset.key))
    .find((preset) => {
      return preset.aliases.some((alias) => {
        const aliasToken = normalizeToken(alias);
        return aliasToken && rawText.includes(aliasToken);
      });
    }) || null;
}

function resolveFixTypeKey(value, item = null) {
  const rawValue = String(value || "").trim();
  const preset = findFixTypePreset(rawValue);
  if (preset) return preset.key;
  if (rawValue) return "otro";

  const inferred = inferFixTypeFromItemText(item);
  return inferred?.key || "sin-tipo";
}

function getFixTypeMeta(value, item = null) {
  const key = resolveFixTypeKey(value, item);
  return FIX_TYPE_META[key] || FIX_TYPE_META["sin-tipo"];
}

function getItemFixType(item) {
  if (!item || typeof item !== "object") return FIX_TYPE_META["sin-tipo"];

  const rawValue = [
    item.fixType,
    item.type,
    item.kind,
    item.category,
  ].find((candidate) => String(candidate || "").trim()) || "";

  return getFixTypeMeta(rawValue, item);
}

function normalizeItems(rawItems, rawBoards = null) {
  const shellTabs = getShellTabs();
  const tabs = [...shellTabs, getGeneralBoard(), ...Object.values(normalizeStoredBoards(rawBoards, shellTabs))];
  const nextItems = {};

  Object.entries(rawItems || {}).forEach(([id, item]) => {
    if (id === "_init" || !item || typeof item !== "object") return;

    const status = sanitizeStatus(item.status);
    const nextFixType = resolveFixTypeKey(
      item.fixType || item.type || item.kind || item.category,
      item
    );
    nextItems[id] = {
      title: String(item.title || "").trim().slice(0, 120),
      description: String(item.description || "").trim().slice(0, 1200),
      details: String(item.details || "").trim().slice(0, 1200),
      instructions: String(item.instructions || "").trim().slice(0, 1200),
      type: nextFixType,
      fixType: nextFixType,
      category: String(item.category || "").trim().slice(0, 120),
      kind: String(item.kind || "").trim().slice(0, 120),
      viewId: resolveLegacyViewId(item.viewId || item.boardId || item.tabId, tabs, rawBoards),
      priority: sanitizePriority(item.priority),
      status,
      createdAt: Number(item.createdAt) || Date.now(),
      updatedAt: Number(item.updatedAt) || Number(item.createdAt) || Date.now(),
      resolvedAt: status === "resolved"
        ? (Number(item.resolvedAt) || Number(item.updatedAt) || Date.now())
        : null,
    };
  });

  return nextItems;
}

function ensureActiveViewId() {
  const tabs = getAvailableBoards({ sort: false });
  if (!tabs.some((tab) => tab.id === state.activeViewId)) {
    state.activeViewId = getDefaultViewId(tabs);
  }
  return state.activeViewId;
}

function isGeneralBoardViewId(viewId) {
  return String(viewId || "").trim() === DEFAULT_BOARD_ID;
}

function getItemList(viewId = "") {
  const derived = ensureImprovementDerivedData();
  if (!viewId || isGeneralBoardViewId(viewId)) return derived.allItems;
  return derived.itemsByView.get(viewId) || [];
}

function getTabCounts(viewId) {
  const counts = ensureImprovementDerivedData().countsByView.get(String(viewId || DEFAULT_BOARD_ID).trim() || DEFAULT_BOARD_ID);
  return counts ? { ...counts } : { pending: 0, resolved: 0 };
}

function getGlobalCounts() {
  return { ...ensureImprovementDerivedData().globalCounts };
}

function compareFixTypeEntries(a, b) {
  const pendingDiff = (Number(b.pending) || 0) - (Number(a.pending) || 0);
  if (pendingDiff) return pendingDiff;

  const totalDiff = (Number(b.total) || 0) - (Number(a.total) || 0);
  if (totalDiff) return totalDiff;

  const orderDiff = (FIX_TYPE_META[a.key]?.index ?? 999) - (FIX_TYPE_META[b.key]?.index ?? 999);
  if (orderDiff) return orderDiff;

  return String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" });
}

function buildFixTypeStats(items = []) {
  const typeMap = new Map();

  items.forEach((item) => {
    const type = getItemFixType(item);
    if (!typeMap.has(type.key)) {
      typeMap.set(type.key, {
        key: type.key,
        label: type.label,
        tone: type.tone || "slate",
        total: 0,
        pending: 0,
        resolved: 0,
        criticalOpen: 0,
        highOpen: 0,
      });
    }

    const entry = typeMap.get(type.key);
    const status = sanitizeStatus(item?.status);
    const priority = sanitizePriority(item?.priority);

    entry.total += 1;
    if (status === "resolved") {
      entry.resolved += 1;
      return;
    }

    entry.pending += 1;
    if (priority === "critical") entry.criticalOpen += 1;
    if (priority === "high") entry.highOpen += 1;
  });

  return Array.from(typeMap.values()).sort(compareFixTypeEntries);
}

function getFixTypeStatsForView(viewId = DEFAULT_BOARD_ID) {
  const safeViewId = String(viewId || DEFAULT_BOARD_ID).trim() || DEFAULT_BOARD_ID;
  const derived = ensureImprovementDerivedData();
  if (derived.typeStatsByView.has(safeViewId)) {
    return derived.typeStatsByView.get(safeViewId);
  }
  const stats = buildFixTypeStats(getItemList(safeViewId));
  derived.typeStatsByView.set(safeViewId, stats);
  return stats;
}

function syncActiveTypeFilters(items = getItemList(ensureActiveViewId())) {
  const availableKeys = new Set(buildFixTypeStats(items).map((entry) => entry.key));
  state.activeTypeFilters = new Set(
    [...state.activeTypeFilters].filter((key) => availableKeys.has(key))
  );
}

function filterItemsByActiveTypes(items = []) {
  if (!state.activeTypeFilters.size) return items;
  return items.filter((item) => state.activeTypeFilters.has(getItemFixType(item).key));
}

function buildImprovementTimeline(items = []) {
  const eventMonthKeys = items
    .flatMap((item) => [
      monthKeyFromTimestamp(item?.createdAt),
      monthKeyFromTimestamp(item?.resolvedAt),
    ])
    .filter(Boolean);

  if (!eventMonthKeys.length) return [];

  const sortedEventKeys = Array.from(new Set(eventMonthKeys)).sort();
  const firstKey = sortedEventKeys[0];
  const lastKey = monthKeyFromTimestamp(Date.now()) || sortedEventKeys[sortedEventKeys.length - 1];
  const monthKeys = [];

  let cursor = firstKey;
  while (cursor) {
    monthKeys.push(cursor);
    if (cursor === lastKey || monthKeys.length > 72) break;
    cursor = shiftMonthKey(cursor, 1);
  }

  const visibleKeys = monthKeys.slice(-8);
  if (!visibleKeys.length) return [];

  const seriesMap = new Map(
    visibleKeys.map((key) => [key, {
      key,
      label: formatMonthLabel(key),
      created: 0,
      resolved: 0,
    }])
  );

  items.forEach((item) => {
    const createdKey = monthKeyFromTimestamp(item?.createdAt);
    const resolvedKey = monthKeyFromTimestamp(item?.resolvedAt);
    if (seriesMap.has(createdKey)) {
      seriesMap.get(createdKey).created += 1;
    }
    if (seriesMap.has(resolvedKey)) {
      seriesMap.get(resolvedKey).resolved += 1;
    }
  });

  const firstVisibleDate = monthStartFromKey(visibleKeys[0]);
  const firstVisibleTs = Number(firstVisibleDate?.getTime?.()) || 0;
  let backlog = items.reduce((acc, item) => {
    const createdAt = Number(item?.createdAt) || 0;
    const resolvedAt = Number(item?.resolvedAt) || 0;
    if (createdAt && createdAt < firstVisibleTs && (!resolvedAt || resolvedAt >= firstVisibleTs)) {
      return acc + 1;
    }
    return acc;
  }, 0);

  return visibleKeys.map((key) => {
    const point = seriesMap.get(key) || {
      key,
      label: formatMonthLabel(key),
      created: 0,
      resolved: 0,
    };
    backlog += point.created - point.resolved;
    return {
      ...point,
      backlog: Math.max(0, backlog),
    };
  });
}

function buildImprovementStats() {
  const activeViewId = ensureActiveViewId();
  const derived = ensureImprovementDerivedData();
  const cacheKey = String(activeViewId || DEFAULT_BOARD_ID).trim() || DEFAULT_BOARD_ID;
  if (derived.statsByView.has(cacheKey)) {
    return derived.statsByView.get(cacheKey);
  }

  const items = derived.allItems;
  const tabs = derived.availableBoardsRaw;
  const types = buildFixTypeStats(items);
  const totals = {
    total: items.length,
    pending: 0,
    resolved: 0,
  };
  const categoriesMap = new Map();

  const ensureCategory = (viewId) => {
    const nextViewId = String(viewId || DEFAULT_BOARD_ID).trim() || DEFAULT_BOARD_ID;
    const board = findTabById(nextViewId, tabs) || buildFallbackBoard(nextViewId);
    if (!categoriesMap.has(nextViewId)) {
      categoriesMap.set(nextViewId, {
        id: nextViewId,
        label: String(board?.label || "General").trim() || "General",
        tone: board?.tone || "slate",
        emoji: inferBoardEmoji(board),
        total: 0,
        pending: 0,
        resolved: 0,
        pendingScore: 0,
        criticalOpen: 0,
        highOpen: 0,
      });
    }
    return categoriesMap.get(nextViewId);
  };

  items.forEach((item) => {
    const category = ensureCategory(item?.viewId);
    const status = sanitizeStatus(item?.status);
    const priority = sanitizePriority(item?.priority);

    category.total += 1;

    if (status === "resolved") {
      totals.resolved += 1;
      category.resolved += 1;
      return;
    }

    totals.pending += 1;
    category.pending += 1;
    category.pendingScore += getPriorityWeight(priority);
    if (priority === "critical") category.criticalOpen += 1;
    if (priority === "high") category.highOpen += 1;
  });

  const categories = Array.from(categoriesMap.values())
    .map((category) => ({
      ...category,
      resolutionRate: category.total ? (category.resolved / category.total) * 100 : 0,
      problemScore:
        (category.pending * 100)
        + (category.pendingScore * 10)
        + (category.criticalOpen * 25)
        + (category.highOpen * 12),
    }))
    .sort((a, b) => {
      const scoreDiff = b.problemScore - a.problemScore;
      if (scoreDiff) return scoreDiff;
      const pendingDiff = b.pending - a.pending;
      if (pendingDiff) return pendingDiff;
      const totalDiff = b.total - a.total;
      if (totalDiff) return totalDiff;
      return String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" });
    });

  const pendingItems = items
    .filter((item) => sanitizeStatus(item?.status) !== "resolved")
    .map((item) => ({
      ...item,
      ageDays: getItemAgeDays(item),
      board: ensureCategory(item?.viewId),
    }))
    .sort((a, b) => {
      const priorityDiff = getPriorityWeight(b.priority) - getPriorityWeight(a.priority);
      if (priorityDiff) return priorityDiff;
      const ageDiff = b.ageDays - a.ageDays;
      if (ageDiff) return ageDiff;
      return (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
    });

  const topCategory = categories.find((category) => category.pending > 0)
    || [...categories].sort((a, b) => {
      const totalDiff = b.total - a.total;
      if (totalDiff) return totalDiff;
      return b.resolved - a.resolved;
    })[0]
    || null;

  const activeCategory = !isGeneralBoardViewId(activeViewId)
    ? (categories.find((category) => category.id === activeViewId) || null)
    : null;
  const topType = types.find((type) => type.pending > 0) || types[0] || null;

  const timeline = buildImprovementTimeline(items);
  const recentTimeline = timeline.slice(-3);
  const recentCreated = recentTimeline.reduce((acc, point) => acc + (Number(point.created) || 0), 0);
  const recentResolved = recentTimeline.reduce((acc, point) => acc + (Number(point.resolved) || 0), 0);

  const result = {
    items,
    totals,
    categories,
    types,
    openCategories: categories.filter((category) => category.pending > 0).length,
    resolvedRate: totals.total ? (totals.resolved / totals.total) * 100 : 0,
    riskyPending: pendingItems.filter((item) => ["critical", "high"].includes(sanitizePriority(item.priority))).length,
    topCategory,
    topType,
    topPendingItem: pendingItems[0] || null,
    oldestPendingItem: [...pendingItems].sort((a, b) => b.ageDays - a.ageDays)[0] || null,
    activeCategory,
    timeline,
    recentCreated,
    recentResolved,
  };
  derived.statsByView.set(cacheKey, result);
  return result;
}

function getActiveTab() {
  const tabs = getAvailableBoards({ sort: false });
  return findTabById(ensureActiveViewId(), tabs) || tabs[0] || null;
}

function getPriorityBoard() {
  return getAvailableBoards()[0] || null;
}

function renderWindowNavigation() {
  els.windowTabs?.querySelectorAll?.("[data-window]").forEach((button) => {
    const isActive = (button.dataset.window || "main") === state.currentWindow;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
  });

  els.windowPanels?.forEach?.((panel) => {
    panel.classList.toggle("is-active", panel.dataset.windowPanel === state.currentWindow);
  });
}

function setBoardFieldValue(boardId = ensureActiveViewId()) {
  if (!els.boardSelect) return;
  const board = findTabById(boardId);
  const nextValue = String(board?.id || getDefaultViewId() || "").trim();
  const hasOption = Array.from(els.boardSelect.options || []).some((option) => option.value === nextValue);

  if (hasOption) {
    els.boardSelect.value = nextValue;
    return;
  }

  if (els.boardSelect.options.length) {
    els.boardSelect.selectedIndex = 0;
  }
}

function getEditingItem() {
  if (!state.editingItemId) return null;
  const item = state.items[state.editingItemId];
  return item ? { id: state.editingItemId, ...item } : null;
}

function sortPendingItems(a, b) {
  const priorityDiff = (PRIORITY_ORDER[b.priority] || 0) - (PRIORITY_ORDER[a.priority] || 0);
  if (priorityDiff) return priorityDiff;
  const createdDiff = (Number(a.createdAt) || 0) - (Number(b.createdAt) || 0);
  if (createdDiff) return createdDiff;
  const updatedDiff = (Number(a.updatedAt) || 0) - (Number(b.updatedAt) || 0);
  if (updatedDiff) return updatedDiff;
  return String(a.id || "").localeCompare(String(b.id || ""), "es", { sensitivity: "base" });
}

function sortResolvedItems(a, b) {
  return (Number(b.resolvedAt) || Number(b.updatedAt) || 0) - (Number(a.resolvedAt) || Number(a.updatedAt) || 0);
}

function renderSummary() {
  if (!els.summary) return;
  const tabs = getAvailableBoards();
  const totals = getGlobalCounts();

  els.summary.innerHTML = `
    <article class="glassCard improvements__summaryCard improvements__summaryCard--categories">
      <small>Categorias</small>
      <strong>${tabs.length}</strong>
      <span>Boards visibles</span>
    </article>
    <article class="glassCard improvements__summaryCard improvements__summaryCard--pending">
      <small>Pendientes</small>
      <strong>${totals.pending}</strong>
      <span>Fixes por cerrar</span>
    </article>
    <article class="glassCard improvements__summaryCard improvements__summaryCard--resolved">
      <small>Resueltos</small>
      <strong>${totals.resolved}</strong>
      <span>Fixes completados</span>
    </article>
  `;
}

function disposeImprovementStatsChart(key) {
  const chart = state.statsCharts?.[key];
  if (!chart) return;
  try {
    chart.dispose();
  } catch (_) {}
  state.statsCharts[key] = null;
}

function disposeImprovementStatsCharts() {
  ["donut", "bar", "line"].forEach(disposeImprovementStatsChart);
}

function renderImprovementStatsChartEmpty(host, chartKey, message) {
  disposeImprovementStatsChart(chartKey);
  if (!host) return;
  host.innerHTML = `<div class="improvements__statsChartEmpty">${escapeHtml(message)}</div>`;
}

function getImprovementStatsChart(chartKey, host) {
  if (!host || typeof window === "undefined" || typeof window.echarts === "undefined") return null;

  let chart = state.statsCharts?.[chartKey] || null;
  if (chart && chart.getDom?.() !== host) {
    disposeImprovementStatsChart(chartKey);
    chart = null;
  }

  if (!chart) {
    host.innerHTML = "";
    chart = window.echarts.init(host);
    state.statsCharts[chartKey] = chart;
  }

  return chart;
}

function resizeImprovementStatsCharts() {
  if (!isStatsViewVisible()) return;
  if (state.statsResizeRaf) {
    cancelAnimationFrame(state.statsResizeRaf);
  }
  state.statsResizeRaf = requestAnimationFrame(() => {
    Object.values(state.statsCharts || {}).forEach((chart) => {
      try {
        chart?.resize?.();
      } catch (_) {}
    });
    state.statsResizeRaf = 0;
  });
}

function cancelImprovementStatsRender() {
  if (!state.statsRenderIdleHandle) return;
  cancelIdleTask(state.statsRenderIdleHandle);
  state.statsRenderIdleHandle = 0;
}

function scheduleImprovementStatsCharts(stats) {
  cancelImprovementStatsRender();
  state.statsRenderIdleHandle = scheduleIdleTask(() => {
    state.statsRenderIdleHandle = 0;
    if (!isStatsViewVisible()) return;
    renderImprovementStatsCharts(stats);
  }, 180);
}

function renderImprovementStatsCharts(stats) {
  if (!isStatsViewVisible()) return;

  if (typeof window === "undefined" || typeof window.echarts === "undefined") {
    void ensureImprovementsEchartsReady()
      .then(() => {
        if (!isStatsViewVisible()) return;
        renderImprovementStatsCharts(stats);
      })
      .catch((error) => {
        console.warn("[improvements] no se pudo cargar ECharts", error);
        renderImprovementStatsChartEmpty(els.statsDonut, "donut", "No se encontro la libreria de graficas.");
        renderImprovementStatsChartEmpty(els.statsBar, "bar", "No se encontro la libreria de graficas.");
        renderImprovementStatsChartEmpty(els.statsLine, "line", "No se encontro la libreria de graficas.");
      });
    return;
  }

  const tooltipStyle = {
    backgroundColor: "rgba(7, 11, 20, 0.96)",
    borderColor: "rgba(255,255,255,0.12)",
    borderWidth: 1,
    textStyle: {
      color: "#edf4ff",
      fontSize: 11,
    },
  };

  const donutChart = getImprovementStatsChart("donut", els.statsDonut);
  if (donutChart) {
    donutChart.setOption({
      animationDuration: 450,
      color: [STATS_COLORS.pending, STATS_COLORS.resolved],
      tooltip: {
        ...tooltipStyle,
        trigger: "item",
        formatter: ({ name, value, percent }) => `${name}: ${value} (${percent}%)`,
      },
      series: [
        {
          type: "pie",
          radius: ["58%", "78%"],
          center: ["50%", "52%"],
          startAngle: 90,
          avoidLabelOverlap: true,
          label: {
            color: "#dce7fa",
            fontSize: 11,
            formatter: ({ name, value }) => `${name}\n${value}`,
          },
          labelLine: {
            lineStyle: {
              color: "rgba(220, 231, 250, 0.34)",
            },
          },
          itemStyle: {
            borderColor: "rgba(8, 12, 20, 0.95)",
            borderWidth: 3,
          },
          data: [
            { name: "Pendientes", value: stats.totals.pending },
            { name: "Resueltos", value: stats.totals.resolved },
          ],
        },
      ],
      graphic: [
        {
          type: "text",
          left: "center",
          top: "40%",
          style: {
            text: formatPercent(stats.resolvedRate),
            fill: "#f5fbff",
            font: "700 24px sans-serif",
            textAlign: "center",
          },
        },
        {
          type: "text",
          left: "center",
          top: "53%",
          style: {
            text: "cerrados",
            fill: "rgba(216, 230, 252, 0.72)",
            font: "12px sans-serif",
            textAlign: "center",
          },
        },
      ],
    }, true);
  }

  if (els.statsBar) {
    els.statsBar.style.height = `${Math.max(250, stats.categories.length * 52)}px`;
  }
  const barChart = getImprovementStatsChart("bar", els.statsBar);
  if (barChart) {
    barChart.setOption({
      animationDuration: 450,
      color: [STATS_COLORS.pending, STATS_COLORS.resolved],
      tooltip: {
        ...tooltipStyle,
        trigger: "axis",
        axisPointer: {
          type: "shadow",
          shadowStyle: {
            color: "rgba(255,255,255,0.04)",
          },
        },
      },
      legend: {
        top: 0,
        right: 0,
        itemWidth: 12,
        itemHeight: 12,
        textStyle: {
          color: "rgba(216, 230, 252, 0.75)",
          fontSize: 11,
        },
      },
      grid: {
        left: 6,
        right: 10,
        top: 28,
        bottom: 8,
        containLabel: true,
      },
      xAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: {
          color: "rgba(216, 230, 252, 0.64)",
          fontSize: 10,
        },
        splitLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.06)",
          },
        },
      },
      yAxis: {
        type: "category",
        inverse: true,
        axisTick: { show: false },
        axisLine: { show: false },
        axisLabel: {
          color: "#e6efff",
          fontSize: 11,
        },
        data: stats.categories.map((category) => category.label),
      },
      series: [
        {
          name: "Pendientes",
          type: "bar",
          stack: "total",
          barWidth: 18,
          itemStyle: {
            borderRadius: [0, 10, 10, 0],
          },
          emphasis: { focus: "series" },
          data: stats.categories.map((category) => ({
            value: category.pending,
            itemStyle: {
              color: category.pending > 0 ? STATS_COLORS.pending : "rgba(255,255,255,0.12)",
            },
          })),
        },
        {
          name: "Resueltos",
          type: "bar",
          stack: "total",
          barWidth: 18,
          itemStyle: {
            borderRadius: [0, 10, 10, 0],
          },
          emphasis: { focus: "series" },
          data: stats.categories.map((category) => ({
            value: category.resolved,
            itemStyle: {
              color: category.id === stats.activeCategory?.id
                ? getBoardAccent(category)
                : STATS_COLORS.resolved,
            },
          })),
        },
      ],
    }, true);
  }

  if (!stats.timeline.length) {
    renderImprovementStatsChartEmpty(els.statsLine, "line", "Sin historial temporal suficiente.");
    resizeImprovementStatsCharts();
    return;
  }

  const lineChart = getImprovementStatsChart("line", els.statsLine);
  if (lineChart) {
    lineChart.setOption({
      animationDuration: 500,
      color: [STATS_COLORS.created, STATS_COLORS.resolvedFlow, STATS_COLORS.backlog],
      tooltip: {
        ...tooltipStyle,
        trigger: "axis",
      },
      legend: {
        top: 0,
        right: 0,
        textStyle: {
          color: "rgba(216, 230, 252, 0.75)",
          fontSize: 11,
        },
      },
      grid: {
        left: 8,
        right: 12,
        top: 32,
        bottom: 10,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: stats.timeline.map((point) => point.label),
        axisLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.08)",
          },
        },
        axisLabel: {
          color: "rgba(216, 230, 252, 0.64)",
          fontSize: 10,
        },
      },
      yAxis: {
        type: "value",
        minInterval: 1,
        axisLabel: {
          color: "rgba(216, 230, 252, 0.64)",
          fontSize: 10,
        },
        splitLine: {
          lineStyle: {
            color: "rgba(255,255,255,0.06)",
          },
        },
      },
      series: [
        {
          name: "Entran",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: {
            width: 3,
          },
          areaStyle: {
            opacity: 0.12,
          },
          data: stats.timeline.map((point) => point.created),
        },
        {
          name: "Se cierran",
          type: "line",
          smooth: true,
          symbol: "circle",
          symbolSize: 7,
          lineStyle: {
            width: 3,
          },
          areaStyle: {
            opacity: 0.08,
          },
          data: stats.timeline.map((point) => point.resolved),
        },
        {
          name: "Backlog",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: {
            width: 2,
            type: "dashed",
          },
          data: stats.timeline.map((point) => point.backlog),
        },
      ],
    }, true);
  }

  resizeImprovementStatsCharts();
}

function renderImprovementStats({ deferCharts = false } = {}) {
  if (
    !els.statsSubtitle
    || !els.statsKpis
    || !els.statsInsights
    || !els.statsTypes
    || !els.statsBreakdown
  ) {
    return;
  }

  const activeTab = getActiveTab();
  const activeLabel = activeTab?.label || "Global";

  if (!state.uid) {
    els.statsSubtitle.textContent = "Inicia sesion para ver el historico y las tendencias de fixes.";
    els.statsKpis.innerHTML = '<div class="improvements__statsPanelEmpty">Las metricas aparecen cuando la cuenta tenga acceso a sus fixes.</div>';
    els.statsInsights.innerHTML = '<div class="improvements__statsPanelEmpty">Sin sesion no se calcula la carga por categoria ni el ritmo de cierre.</div>';
    els.statsTypes.innerHTML = '<div class="improvements__statsPanelEmpty">Sin sesion no se puede repartir la carga por tipo de fix.</div>';
    els.statsBreakdown.innerHTML = '<div class="improvements__statsPanelEmpty">Los rankings por categoria se mostraran aqui cuando haya datos.</div>';
    renderImprovementStatsChartEmpty(els.statsDonut, "donut", "Sin sesion activa.");
    renderImprovementStatsChartEmpty(els.statsBar, "bar", "Sin sesion activa.");
    renderImprovementStatsChartEmpty(els.statsLine, "line", "Sin sesion activa.");
    return;
  }

  const stats = buildImprovementStats();
  if (!stats.totals.total) {
    els.statsSubtitle.textContent = "Todavia no hay fixes guardados para dibujar la radiografia.";
    els.statsKpis.innerHTML = '<div class="improvements__statsPanelEmpty">Cuando empieces a crear fixes veras aqui volumen, backlog y riesgo.</div>';
    els.statsInsights.innerHTML = '<div class="improvements__statsPanelEmpty">Tambien apareceran la categoria mas cargada y el fix mas bloqueado.</div>';
    els.statsTypes.innerHTML = '<div class="improvements__statsPanelEmpty">Al clasificar fixes por tipo veras aqui su reparto.</div>';
    els.statsBreakdown.innerHTML = '<div class="improvements__statsPanelEmpty">El desglose por categoria se llenara automaticamente.</div>';
    renderImprovementStatsChartEmpty(els.statsDonut, "donut", "Todavia no hay datos.");
    renderImprovementStatsChartEmpty(els.statsBar, "bar", "Todavia no hay categorias con fixes.");
    renderImprovementStatsChartEmpty(els.statsLine, "line", "Todavia no hay actividad suficiente.");
    return;
  }

  els.statsSubtitle.textContent = stats.activeCategory
    ? `Vista global. Categoria activa: ${activeLabel}. El ranking inferior la marca para comparar contra el resto y el reparto por tipo mantiene el mismo backlog.`
    : "Vista global de categorias y tipos. Las graficas combinan estado actual, carga por tablero, clasificacion y ritmo reciente.";

  els.statsKpis.innerHTML = `
    <article class="improvements__statsKpi" data-tone="blue">
      <small>Total fixes</small>
      <strong>${stats.totals.total}</strong>
      <span>${stats.categories.length} categorias y ${stats.types.length} tipos con historial</span>
    </article>
    <article class="improvements__statsKpi" data-tone="amber">
      <small>Aun pendientes</small>
      <strong>${stats.totals.pending}</strong>
      <span>${stats.openCategories} categorias con deuda abierta</span>
    </article>
    <article class="improvements__statsKpi" data-tone="green">
      <small>Tasa resuelta</small>
      <strong>${formatPercent(stats.resolvedRate)}</strong>
      <span>${stats.totals.resolved} fixes cerrados hasta ahora</span>
    </article>
    <article class="improvements__statsKpi" data-tone="rose">
      <small>Riesgo alto</small>
      <strong>${stats.riskyPending}</strong>
      <span>Criticos o altos todavia abiertos</span>
    </article>
  `;

  els.statsTypes.innerHTML = stats.types.length
    ? stats.types.map((type) => {
        const isHot = stats.topType?.key === type.key && type.pending > 0;
        return `
          <article class="improvements__statsTypeCard ${isHot ? "is-hot" : ""}" data-fix-type="${type.key}">
            <div class="improvements__statsTypeTop">
              <span class="improvements__fixTypeChip improvements__fixTypeChip--${type.key}">${escapeHtml(type.label)}</span>
              <strong>${type.pending} / ${type.total}</strong>
            </div>
            <p>${type.pending ? `${type.pending} abiertos ahora mismo.` : "Sin abiertos ahora mismo."} ${type.resolved} resueltos acumulados.</p>
            <div class="improvements__statsTypeMeta">
              <span>${type.resolved} resueltos</span>
              <span>${type.criticalOpen} criticos</span>
            </div>
          </article>
        `;
      }).join("")
    : '<div class="improvements__statsPanelEmpty">Todavia no hay tipos clasificados.</div>';

  const hotCategory = stats.topCategory;
  const topPendingItem = stats.topPendingItem;
  const trendImproving = stats.recentResolved >= stats.recentCreated;
  const recentPeriodLabel = stats.timeline.length <= 1 ? "este mes" : "los ultimos 3 meses";
  const oldestPendingText = stats.oldestPendingItem
    ? `El abierto mas veterano lleva ${describeAgeDays(stats.oldestPendingItem.ageDays)}.`
    : "No queda deuda historica abierta.";

  els.statsInsights.innerHTML = `
    <article class="improvements__statsInsight" data-tone="amber">
      <div class="improvements__statsInsightTop">
        <h4 class="improvements__statsInsightTitle">Categoria que mas aprieta</h4>
        <span class="improvements__statsInsightBadge">${hotCategory?.pending || 0} P</span>
      </div>
      <p>${hotCategory
        ? hotCategory.pending > 0
          ? `${escapeHtml(hotCategory.label)} concentra ${hotCategory.pending} pendientes, ${hotCategory.criticalOpen} criticos y ${hotCategory.highOpen} altos abiertos.`
          : `${escapeHtml(hotCategory.label)} lidera por volumen historico, pero ahora mismo no tiene backlog abierto.`
        : "Todavia no hay suficiente informacion para destacar una categoria."
      }</p>
      <div class="improvements__statsInsightMeta">
        <span>${hotCategory?.total || 0} total</span>
        <span>${hotCategory?.resolved || 0} resueltos</span>
        <span>${hotCategory ? formatPercent(hotCategory.resolutionRate) : "0%"} cerrados</span>
      </div>
    </article>
    <article class="improvements__statsInsight" data-tone="rose">
      <div class="improvements__statsInsightTop">
        <h4 class="improvements__statsInsightTitle">Fix mas bloqueado</h4>
        <span class="improvements__statsInsightBadge">${topPendingItem ? PRIORITY_LABELS[sanitizePriority(topPendingItem.priority)] : "Limpio"}</span>
      </div>
      <p>${topPendingItem
        ? `${escapeHtml(topPendingItem.title || "Sin titulo")} sigue abierto desde hace ${describeAgeDays(topPendingItem.ageDays)} en ${escapeHtml(topPendingItem.board?.label || "General")}.`
        : "No hay fixes pendientes ahora mismo."
      }</p>
      <div class="improvements__statsInsightMeta">
        <span>${topPendingItem ? escapeHtml(topPendingItem.board?.label || "General") : "Sin backlog"}</span>
        <span>${topPendingItem ? `Creado ${escapeHtml(formatShortDate(topPendingItem.createdAt))}` : "Todo al dia"}</span>
        <span>${oldestPendingText}</span>
      </div>
    </article>
    <article class="improvements__statsInsight" data-tone="blue">
      <div class="improvements__statsInsightTop">
        <h4 class="improvements__statsInsightTitle">Ritmo reciente</h4>
        <span class="improvements__statsInsightBadge">${stats.recentResolved}/${stats.recentCreated}</span>
      </div>
      <p>En ${recentPeriodLabel} entraron ${stats.recentCreated} fixes y se cerraron ${stats.recentResolved}.${trendImproving ? " El backlog va aflojando." : " Sigue entrando mas carga de la que sale."}</p>
      <div class="improvements__statsInsightMeta">
        <span>${stats.totals.pending} backlog actual</span>
        <span>${stats.timeline.length ? `${stats.timeline[stats.timeline.length - 1].label}` : "Sin serie"}</span>
        <span>${trendImproving ? "Tendencia estable" : "Tendencia en tension"}</span>
      </div>
    </article>
  `;

  els.statsBreakdown.innerHTML = stats.categories.map((category) => {
    const isActive = stats.activeCategory?.id === category.id;
    const isHot = hotCategory?.id === category.id && category.pending > 0;
    const accent = getBoardAccent(category);
    return `
      <article class="improvements__statsBreakdownRow ${isActive ? "is-active" : ""} ${isHot ? "is-hot" : ""}">
        <div class="improvements__statsBreakdownTop">
          <div class="improvements__statsBreakdownLabel">
            <span class="improvements__statsBreakdownEmoji" style="border-color:${accent}55;background:${accent}1f;" aria-hidden="true">${escapeHtml(category.emoji || "")}</span>
            <div class="improvements__statsBreakdownName">
              <strong>${escapeHtml(category.label)}</strong>
              <span>${category.pending ? `${category.pending} abiertos ahora` : "Sin deuda abierta"}</span>
            </div>
          </div>
          <div class="improvements__statsBreakdownCounts">
            <strong>${category.pending} / ${category.total}</strong>
            <span>Pendientes / total</span>
          </div>
        </div>
        <div class="improvements__statsProgress" style="--stats-progress:${Math.max(0, Math.min(100, category.resolutionRate))}%;">
          <i></i>
        </div>
        <div class="improvements__statsBreakdownMeta">
          <span>${category.resolved} resueltos</span>
          <span>${formatPercent(category.resolutionRate)} cerrados</span>
          <span>${category.criticalOpen} criticos</span>
          <span>${category.highOpen} altos</span>
          ${isActive ? '<span>Categoria activa</span>' : ""}
          ${isHot ? '<span>Punto caliente</span>' : ""}
        </div>
      </article>
    `;
  }).join("");

  if (!isStatsViewVisible()) return;
  if (deferCharts) {
    scheduleImprovementStatsCharts(stats);
    return;
  }

  cancelImprovementStatsRender();
  renderImprovementStatsCharts(stats);
}

function renderBoardTabs() {
  if (!els.boardTabs) return;
  const tabs = getAvailableBoards();

  const markup = tabs.map((tab) => {
    const counts = getTabCounts(tab.id);
    const isActive = tab.id === state.activeViewId;
    return `
      <button
        class="improvements__boardTab ${isActive ? "is-active" : ""}"
        data-board-tab="${tab.id}"
        data-tab-tone="${tab.tone}"
        type="button"
      >
        <span class="improvements__boardTabName">${escapeHtml(tab.label)}</span>
        <span class="improvements__boardTabCounts">${counts.pending} ⌛ / ${counts.resolved} ✅</span>
      </button>
    `;
  }).join("");

  els.boardTabs.innerHTML = markup
    .replace(/âŒ›/g, "P")
    .replace(/âœ…/g, "R");

  els.boardTabs.innerHTML = els.boardTabs.innerHTML.replace(
    /(\d+)\s+[^<]+?\/\s+(\d+)\s+[^<]+?(?=<\/span>)/g,
    "$1 P / $2 R"
  );

  if (els.tabCount) {
    els.tabCount.textContent = String(tabs.length);
  }
}

function renderBoardMeta() {
  if (!els.boardMeta) return;
  const totals = getGlobalCounts();
  if (!totals.pending && !totals.resolved) {
    els.boardMeta.innerHTML = `
      <div class="improvements__boardMetaCopy">
        <p class="improvements__sectionLabel">Prioridad</p>
        <h3 class="improvements__sectionTitle">Sin fixes por priorizar</h3>
        <p class="improvements__boardDescription">
          Las categorias se ordenaran automaticamente en cuanto guardes fixes pendientes o resueltos.
        </p>
      </div>
    `;
    return;
  }

  const tab = getPriorityBoard();
  if (!tab) {
    els.boardMeta.innerHTML = "";
    return;
  }

  const counts = getTabCounts(tab.id);
  const description = counts.pending
    ? `${counts.pending} pendientes y ${counts.resolved} resueltos en ${tab.label}. Esta categoria encabeza la lista porque concentra mas fixes abiertos ahora mismo.`
    : `${tab.label} no tiene fixes pendientes ahora mismo y acumula ${counts.resolved} resueltos.`;

  els.boardMeta.innerHTML = `
    <div class="improvements__boardMetaCopy">
      <p class="improvements__sectionLabel">Mas pendientes</p>
      <h3 class="improvements__sectionTitle">${escapeHtml(tab.label)}</h3>
      <p class="improvements__boardDescription">
        ${escapeHtml(description)}
      </p>
    </div>
  `;
}

function renderBoardSelectOptions() {
  if (!els.boardOptions) return;
  const tabs = getAvailableBoards();
  const seen = new Set();

  els.boardOptions.innerHTML = tabs.map((tab) => {
    const normalizedLabel = normalizeToken(tab.label);
    if (!normalizedLabel || seen.has(normalizedLabel)) return "";
    seen.add(normalizedLabel);
    return `<option value="${escapeHtml(tab.label)}"></option>`;
  }).join("");
}

function setEditorDisabled(disabled) {
  [
    els.title,
    els.details,
    els.boardSelect,
    els.fixType,
    els.priority,
    els.status,
    els.itemSubmit,
    els.deleteItemBtn,
    els.cancelEditBtn,
    els.openEditorBtn,
  ].forEach((element) => {
    if (element) element.disabled = disabled;
  });
}

function renderEditorState() {
  const editingItem = getEditingItem();
  if (els.editorTitle) {
    els.editorTitle.textContent = editingItem ? "Editar mejora" : "Nueva mejora";
  }
  els.cancelEditBtn?.classList.toggle("hidden", !editingItem);
  els.deleteItemBtn?.classList.toggle("hidden", !editingItem);
  setEditorDisabled(!state.uid);
}

function syncModalBodyState() {
  document.body.classList.toggle("has-open-modal", state.editorOpen || state.exportOpen);
}

function renderEditorModal() {
  if (!els.editorBackdrop) return;
  els.editorBackdrop.classList.toggle("hidden", !state.editorOpen);
  els.editorBackdrop.setAttribute("aria-hidden", String(!state.editorOpen));
  syncModalBodyState();
}

function renderExportModal() {
  if (!els.exportBackdrop) return;
  const hasPrompt = Boolean(state.exportText);
  els.exportBackdrop.classList.toggle("hidden", !state.exportOpen);
  els.exportBackdrop.setAttribute("aria-hidden", String(!state.exportOpen));
  if (els.exportText) {
    els.exportText.value = state.exportText;
  }
  if (els.copyExportBtn) {
    els.copyExportBtn.disabled = !hasPrompt;
  }
  syncModalBodyState();
}

function renderEmptyList(target, text) {
  if (!target) return;
  target.innerHTML = `<div class="empty-state improvements__empty">${escapeHtml(text)}</div>`;
}

function toggleItemExpanded(itemId) {
  const nextItemId = String(itemId || "").trim();
  if (!nextItemId) return;
  const defaultExpanded = isGeneralBoardViewId(getActiveTab()?.id);

  if (defaultExpanded) {
    if (state.collapsedItems.has(nextItemId)) {
      state.collapsedItems.delete(nextItemId);
    } else {
      state.collapsedItems.add(nextItemId);
    }
  } else if (state.expandedItems.has(nextItemId)) {
    state.expandedItems.delete(nextItemId);
  } else {
    state.expandedItems.add(nextItemId);
  }

  const itemNode = state.root?.querySelector?.(`.improvements__item [data-item-action="expand"][data-item-id="${nextItemId}"]`)?.closest(".improvements__item");
  if (!itemNode) {
    renderFilteredLists();
    return;
  }

  const body = itemNode.querySelector(".improvements__itemBody");
  const foldButton = itemNode.querySelector('[data-item-action="expand"]');
  const isExpanded = isItemExpanded(nextItemId, { defaultExpanded });

  itemNode.classList.toggle("is-expanded", isExpanded);
  body?.classList.toggle("hidden", !isExpanded);
  if (foldButton) {
    foldButton.setAttribute("aria-expanded", String(isExpanded));
    foldButton.setAttribute("title", isExpanded ? "Plegar fix" : "Desplegar fix");
  }
}

function renderBoardTabsCompact() {
  if (!els.boardTabs) return;
  const tabs = getAvailableBoards();

  els.boardTabs.innerHTML = tabs.map((tab) => {
    const counts = getTabCounts(tab.id);
    const isActive = tab.id === state.activeViewId;
    return `
      <button
        class="improvements__boardTab ${isActive ? "is-active" : ""}"
        data-board-tab="${tab.id}"
        data-tab-tone="${tab.tone}"
        type="button"
      >
        <span class="improvements__boardTabName">${escapeHtml(tab.label)}</span>
        <span class="improvements__boardTabCounts">${counts.pending} ⌛ / ${counts.resolved} ✅</span>
      </button>
    `;
  }).join("");

  if (els.tabCount) {
    els.tabCount.textContent = String(tabs.length);
  }
}

function renderActiveBoardMeta() {
  if (!els.boardMeta) return;
  const tab = getActiveTab();
  if (!tab) {
    els.boardMeta.innerHTML = "";
    return;
  }

  const counts = getTabCounts(tab.id);
  const emoji = inferBoardEmoji(tab);

  els.boardMeta.innerHTML = `
    <div class="improvements__boardMetaStat improvements__boardMetaStat--board" data-tab-tone="${tab.tone}">
      <span class="improvements__boardMetaEmoji" aria-hidden="true">${escapeHtml(emoji)}</span>
      <div class="improvements__boardMetaCopy">
        <p class="improvements__sectionLabel">Categoria seleccionada</p>
        <h3 class="improvements__sectionTitle">${escapeHtml(tab.label)}</h3>
      </div>
    </div>
    <div class="improvements__boardMetaStat improvements__boardMetaStat--pending">
      <small>Pendientes</small>
      <strong>${counts.pending}</strong>
    </div>
    <div class="improvements__boardMetaStat improvements__boardMetaStat--resolved">
      <small>Resueltos</small>
      <strong>${counts.resolved}</strong>
    </div>
  `;
}

function renderTypeFilters() {
  if (!els.typeFilters) return;

  if (!state.uid) {
    els.typeFilters.innerHTML = '<div class="improvements__statsPanelEmpty">Inicia sesion para filtrar y agrupar fixes por tipo.</div>';
    els.clearTypeFiltersBtn?.classList.add("hidden");
    return;
  }

  const activeViewId = ensureActiveViewId();
  const items = getItemList(activeViewId);
  const typeStats = getFixTypeStatsForView(activeViewId);
  syncActiveTypeFilters(items);
  const hasActiveFilters = state.activeTypeFilters.size > 0;

  els.clearTypeFiltersBtn?.classList.toggle("hidden", !hasActiveFilters);

  if (!typeStats.length) {
    els.typeFilters.innerHTML = '<div class="improvements__statsPanelEmpty">Todavia no hay fixes clasificados por tipo en esta vista.</div>';
    return;
  }

  const allChip = `
    <button
      class="improvements__typeFilterChip ${hasActiveFilters ? "" : "is-active"}"
      data-type-filter="all"
      data-fix-type="sin-tipo"
      type="button"
    >
      <span>Todos</span>
      <span class="improvements__typeFilterChipCount">${items.length}</span>
    </button>
  `;

  const typeChips = typeStats.map((type) => `
    <button
      class="improvements__typeFilterChip ${state.activeTypeFilters.has(type.key) ? "is-active" : ""}"
      data-type-filter="${type.key}"
      data-fix-type="${type.key}"
      type="button"
    >
      <span>${escapeHtml(type.label)}</span>
      <span class="improvements__typeFilterChipCount">${type.total}</span>
    </button>
  `).join("");

  els.typeFilters.innerHTML = `${allChip}${typeChips}`;
}

function renderBoardSelectInput() {
  if (!els.boardSelect) return;
  const tabs = getAvailableBoards({ sort: false });
  const currentViewId = getEditingItem()?.viewId || ensureActiveViewId();

  els.boardSelect.innerHTML = tabs.map((tab) => {
    const emoji = inferBoardEmoji(tab);
    return `<option value="${escapeHtml(tab.id)}">${escapeHtml(`${emoji} ${tab.label}`)}</option>`;
  }).join("");

  setBoardFieldValue(currentViewId);
}

function buildCompactItemMarkup(item, { selectable = false, defaultExpanded = false } = {}) {
  const tab = findTabById(item.viewId) || buildFallbackBoard(item.viewId);
  const emoji = inferBoardEmoji(tab);
  const fixType = getItemFixType(item);
  const isExpanded = isItemExpanded(item.id, { defaultExpanded });
  const stampLabel = item.status === "resolved" ? "Resuelto" : "Actualizado";
  const stampValue = item.status === "resolved" ? item.resolvedAt : item.updatedAt;
  const detailsHtml = item.details
    ? `<p class="improvements__itemDetails">${escapeHtml(item.details).replace(/\n/g, "<br />")}</p>`
    : '<p class="improvements__itemDetails improvements__itemDetails--muted">Sin descripcion todavia.</p>';

  return `
    <article class="improvements__item improvements__item--${item.priority} ${item.status === "resolved" ? "is-resolved" : ""} ${isExpanded ? "is-expanded" : ""}">
      <div class="improvements__itemShell">
        ${selectable ? `
          <label class="improvements__itemPick" aria-label="Seleccionar fix para exportar">
            <input
              class="improvements__itemPickInput"
              data-item-action="select"
              data-item-id="${item.id}"
              type="checkbox"
              ${state.selectedItems.has(item.id) ? "checked" : ""}
            />
            <span class="improvements__itemPickUi" aria-hidden="true"></span>
          </label>
        ` : ""}
        <button
          class="improvements__itemFold"
          data-item-action="expand"
          data-item-id="${item.id}"
          type="button"
          aria-expanded="${isExpanded}"
          title="${isExpanded ? "Plegar fix" : "Desplegar fix"}"
        >
          <span class="improvements__itemEmoji" data-tab-tone="${tab?.tone || "slate"}" aria-hidden="true">${escapeHtml(emoji)}</span>
          <span class="improvements__itemTitle">${escapeHtml(item.title || "Sin titulo")}</span>
        </button>

        <label class="improvements__itemCheckbox" aria-label="${item.status === "resolved" ? "Marcar como pendiente" : "Marcar como resuelto"}">
          <input
            class="improvements__itemCheckboxInput"
            data-item-action="toggle"
            data-item-id="${item.id}"
            type="checkbox"
            ${item.status === "resolved" ? "checked" : ""}
          />
          <span class="improvements__itemCheckboxUi" aria-hidden="true"></span>
        </label>
      </div>

      <div class="improvements__itemBody ${isExpanded ? "" : "hidden"}">
        <div class="improvements__itemBadges">
          <span class="improvements__boardChip" data-tab-tone="${tab?.tone || "slate"}">${escapeHtml(`${emoji} ${tab?.label || "Categoria"}`)}</span>
          <span class="improvements__fixTypeChip improvements__fixTypeChip--${fixType.key}">${escapeHtml(fixType.label)}</span>
          <span class="improvements__priorityChip improvements__priorityChip--${item.priority}">${PRIORITY_LABELS[item.priority]}</span>
          <span class="improvements__statusChip ${item.status === "resolved" ? "is-resolved" : ""}">${STATUS_LABELS[item.status]}</span>
        </div>
        ${detailsHtml}
        <div class="improvements__itemMeta">
          <span class="improvements__itemStamp">Creado: ${escapeHtml(formatDateTime(item.createdAt))}</span>
          <span class="improvements__itemStamp">${stampLabel}: ${escapeHtml(formatDateTime(stampValue))}</span>
        </div>
        <div class="improvements__itemActions">
          <button class="btn ghost btn-compact" data-item-action="export" data-item-id="${item.id}" type="button">Exportar</button>
          <button class="btn ghost btn-compact" data-item-action="edit" data-item-id="${item.id}" type="button">Editar</button>
          <button class="btn ghost danger btn-compact" data-item-action="delete" data-item-id="${item.id}" type="button">Eliminar</button>
        </div>
      </div>
    </article>
  `;
}

function renderCompactItemList(target, items, emptyText, { selectable = false, defaultExpanded = false, forceGroups = false } = {}) {
  if (!target) return;
  if (!items.length) {
    renderEmptyList(target, emptyText);
    return;
  }

  const groupMap = new Map();
  items.forEach((item) => {
    const fixType = getItemFixType(item);
    if (!groupMap.has(fixType.key)) {
      groupMap.set(fixType.key, {
        key: fixType.key,
        label: fixType.label,
        pending: 0,
        total: 0,
        items: [],
      });
    }

    const entry = groupMap.get(fixType.key);
    entry.total += 1;
    if (sanitizeStatus(item.status) !== "resolved") entry.pending += 1;
    entry.items.push(item);
  });

  const groups = Array.from(groupMap.values()).sort(compareFixTypeEntries);
  const shouldGroup = forceGroups || groups.length > 1 || state.activeTypeFilters.size > 0;

  if (!shouldGroup) {
    target.innerHTML = items.map((item) => buildCompactItemMarkup(item, { selectable, defaultExpanded })).join("");
    return;
  }

  target.innerHTML = groups.map((group) => `
    <section class="improvements__typeGroup" data-fix-type="${group.key}">
      <div class="improvements__typeGroupHead">
        <span class="improvements__fixTypeChip improvements__fixTypeChip--${group.key}">${escapeHtml(group.label)}</span>
        <span class="improvements__typeGroupCount">${group.items.length} ${group.items.length === 1 ? "fix" : "fixes"}</span>
      </div>
      <div class="improvements__typeGroupItems">
        ${group.items.map((item) => buildCompactItemMarkup(item, { selectable, defaultExpanded })).join("")}
      </div>
    </section>
  `).join("");
}

function renderFilteredLists() {
  const activeTab = getActiveTab();
  const activeLabel = activeTab?.label || "esta categoria";
  const isGeneralView = isGeneralBoardViewId(activeTab?.id);

  if (els.pendingLabel) els.pendingLabel.textContent = "Pendientes";
  if (els.resolvedLabel) els.resolvedLabel.textContent = "Resueltos";
  if (els.pendingTitle) {
    els.pendingTitle.textContent = isGeneralView
      ? "Todos los fixes abiertos"
      : `Fixes abiertos en ${activeLabel}`;
  }
  if (els.resolvedTitle) {
    els.resolvedTitle.textContent = isGeneralView
      ? "Todos los fixes cerrados"
      : `Fixes cerrados en ${activeLabel}`;
  }

  if (!state.uid) {
    renderEmptyList(els.pendingList, "Inicia sesion para guardar y gestionar mejoras.");
    renderEmptyList(els.resolvedList, "Los fixes resueltos apareceran aqui cuando tengas sesion activa.");
    if (els.pendingCount) els.pendingCount.textContent = "0";
    if (els.resolvedCount) els.resolvedCount.textContent = "0";
    return;
  }

  const items = filterItemsByActiveTypes(getItemList(ensureActiveViewId()));
  const pendingItems = items.filter((item) => item.status !== "resolved").sort(sortPendingItems);
  const resolvedItems = items.filter((item) => item.status === "resolved").sort(sortResolvedItems);
  const visibleTypeCount = buildFixTypeStats(items).length;
  const shouldGroupByType = visibleTypeCount > 1 || state.activeTypeFilters.size > 0 || isGeneralView;

  if (els.pendingCount) els.pendingCount.textContent = String(pendingItems.length);
  if (els.resolvedCount) els.resolvedCount.textContent = String(resolvedItems.length);
  renderResolvedPanelState();

  renderCompactItemList(
    els.pendingList,
    pendingItems,
    isGeneralView
      ? "No hay mejoras pendientes."
      : `No hay mejoras pendientes en ${activeLabel}.`,
    { selectable: true, forceGroups: shouldGroupByType }
  );
  if (state.resolvedPanelCollapsed) {
    if (els.resolvedList) els.resolvedList.innerHTML = "";
    return;
  }

  renderCompactItemList(
    els.resolvedList,
    resolvedItems,
    isGeneralView
      ? "Todavia no has marcado fixes como resueltos."
      : `Todavia no has marcado fixes como resueltos en ${activeLabel}.`,
    { forceGroups: shouldGroupByType }
  );
}

function renderResolvedPanelState() {
  if (!els.resolvedListBlock || !els.toggleResolvedBtn || !els.resolvedList) return;

  const collapsed = Boolean(state.resolvedPanelCollapsed);
  els.resolvedListBlock.classList.toggle("is-collapsed", collapsed);
  els.resolvedList.classList.toggle("hidden", collapsed);
  els.toggleResolvedBtn.setAttribute("aria-expanded", String(!collapsed));
  els.toggleResolvedBtn.textContent = collapsed ? "Desplegar" : "Plegar";
}

function renderItemList(target, items, emptyText) {
  if (!target) return;
  if (!items.length) {
    renderEmptyList(target, emptyText);
    return;
  }

  target.innerHTML = items.map((item) => {
    const tab = findTabById(item.viewId);
    const detailsHtml = item.details
      ? `<p class="improvements__itemDetails">${escapeHtml(item.details).replace(/\n/g, "<br />")}</p>`
      : '<p class="improvements__itemDetails improvements__itemDetails--muted">Sin descripcion todavia.</p>';
    const toggleLabel = item.status === "resolved" ? "Reabrir" : "Marcar resuelto";
    const stampLabel = item.status === "resolved" ? "Resuelto" : "Actualizado";
    const stampValue = item.status === "resolved" ? item.resolvedAt : item.updatedAt;

    return `
      <article class="improvements__item improvements__item--${item.priority} ${item.status === "resolved" ? "is-resolved" : ""}">
        <div class="improvements__itemTop">
          <div class="improvements__itemHeading">
            <h4>${escapeHtml(item.title || "Sin titulo")}</h4>
            <div class="improvements__itemBadges">
              <span class="improvements__priorityChip improvements__priorityChip--${item.priority}">${PRIORITY_LABELS[item.priority]}</span>
              <span class="improvements__statusChip ${item.status === "resolved" ? "is-resolved" : ""}">${STATUS_LABELS[item.status]}</span>
              <span class="improvements__boardChip" data-tab-tone="${tab?.tone || "slate"}">${escapeHtml(tab?.label || "Categoria")}</span>
            </div>
          </div>
          <span class="improvements__itemStamp">${stampLabel}: ${escapeHtml(formatDateTime(stampValue))}</span>
        </div>
        ${detailsHtml}
        <div class="improvements__itemActions">
          <button class="btn ghost btn-compact" data-item-action="toggle" data-item-id="${item.id}" type="button">${toggleLabel}</button>
          <button class="btn ghost btn-compact" data-item-action="edit" data-item-id="${item.id}" type="button">Editar</button>
          <button class="btn ghost danger btn-compact" data-item-action="delete" data-item-id="${item.id}" type="button">Eliminar</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderLists() {
  if (!state.uid) {
    renderEmptyList(els.pendingList, "Inicia sesion para guardar y gestionar mejoras.");
    renderEmptyList(els.resolvedList, "Los fixes resueltos apareceran aqui cuando tengas sesion activa.");
    if (els.pendingCount) els.pendingCount.textContent = "0";
    if (els.resolvedCount) els.resolvedCount.textContent = "0";
    return;
  }

  const items = getItemList(ensureActiveViewId());
  const pendingItems = items.filter((item) => item.status !== "resolved").sort(sortPendingItems);
  const resolvedItems = items.filter((item) => item.status === "resolved").sort(sortResolvedItems);

  if (els.pendingCount) els.pendingCount.textContent = String(pendingItems.length);
  if (els.resolvedCount) els.resolvedCount.textContent = String(resolvedItems.length);

  renderItemList(els.pendingList, pendingItems, "No hay mejoras pendientes en esta categoria.");
  renderItemList(els.resolvedList, resolvedItems, "Todavia no has marcado fixes como resueltos aqui.");
}

function renderMainWindow() {
  renderSummary();
  renderBoardTabsCompact();
  renderActiveBoardMeta();
  renderTypeFilters();
  renderFilteredLists();
}

function renderPerformanceWindow() {
  if (
    !els.performanceRunBtn
    || !els.performanceSync
    || !els.performanceStatus
    || !els.performanceSummary
    || !els.performanceMetrics
    || !els.performanceFindings
    || !els.performanceChart
  ) {
    return;
  }

  els.performanceRunBtn.disabled = state.performance.busy;
  els.performanceRunBtn.textContent = state.performance.busy
    ? "Midiendo..."
    : "Calcular rendimiento";

  const sync = state.syncState || {};
  const syncTone = (Number(sync.failedCount) || 0) > 0
    ? "rose"
    : (Number(sync.totalCount) || 0) > 0
      ? (sync.rtdbConnected ? "blue" : "amber")
      : (!sync.appOnline || !sync.rtdbConnected)
        ? "amber"
        : "green";
  const syncLabel = (Number(sync.failedCount) || 0) > 0
    ? `${sync.failedCount} con error`
    : (Number(sync.totalCount) || 0) > 0
      ? `${sync.totalCount} pendiente${sync.totalCount === 1 ? "" : "s"}`
      : (!sync.appOnline || !sync.rtdbConnected)
        ? "Sin conexiÃ³n"
        : "Sincronizado";

  els.performanceSync.innerHTML = `
    <article class="improvements__perfSyncCard" data-tone="${syncTone}">
      <small>Sync</small>
      <strong>${escapeHtml(syncLabel)}</strong>
      <span>${escapeHtml(sync.lastSyncAt ? `Ultimo sync ${formatDateTime(sync.lastSyncAt)}` : "Sin actividad reciente.")}</span>
    </article>
    <article class="improvements__perfSyncCard" data-tone="${(Number(sync.totalCount) || 0) > 0 ? "blue" : "green"}">
      <small>Cola</small>
      <strong>${Number(sync.totalCount) || 0}</strong>
      <span>${Number(sync.syncingCount) || 0} sincronizando · ${Number(sync.failedCount) || 0} con error</span>
    </article>
    <article class="improvements__perfSyncCard" data-tone="${sync.appOnline && sync.rtdbConnected ? "green" : "amber"}">
      <small>Conexion</small>
      <strong>${sync.appOnline && sync.rtdbConnected ? "RTDB OK" : "Limitada"}</strong>
      <span>${sync.appOnline ? "Browser online" : "Browser offline"} · ${sync.rtdbConnected ? "socket activo" : "socket caido"}</span>
    </article>
  `;

  const statusState = state.performance.busy
    ? "running"
    : state.performance.status === "error"
      ? "error"
      : state.performance.result
        ? "done"
        : "idle";
  els.performanceStatus.innerHTML = `
    <div class="improvements__perfStatusCard" data-state="${statusState}">
      <span class="improvements__perfStatusDot" aria-hidden="true"></span>
      <span>${escapeHtml(state.performance.statusText || "La auditoria solo se ejecuta manualmente.")}</span>
    </div>
  `;

  if (!state.performance.result) {
    els.performanceSummary.innerHTML = '<div class="improvements__perfEmpty">Pulsa "Calcular rendimiento" para lanzar una medicion breve y controlada.</div>';
    els.performanceMetrics.innerHTML = '<div class="improvements__perfEmpty">Las submetricas apareceran aqui en cuanto termine la auditoria.</div>';
    els.performanceFindings.innerHTML = '<div class="improvements__perfEmpty">Los hallazgos accionables se mostraran aqui cuando haya resultados.</div>';
    // Aun asi intentar renderizar el historico si existe
    requestAnimationFrame(() => {
      renderPerformanceHistoryChart();
    });
    return;
  }

  const result = state.performance.result;
  const overallTone = result.overallScore >= 85
    ? "green"
    : result.overallScore >= 65
      ? "blue"
      : result.overallScore >= 45
        ? "amber"
        : "rose";

  els.performanceSummary.innerHTML = `
    <article class="improvements__perfSummaryCard improvements__perfSummaryMain" data-tone="${overallTone}">
      <small>Score global</small>
      <strong>${result.overallScore}</strong>
      <span>${escapeHtml(result.summaryText || "Medicion completada.")}</span>
    </article>
    <div class="improvements__perfSummaryBreakdown">
      <article class="improvements__perfSummaryCard" data-tone="blue">
        <small>Ultimo calculo</small>
        <strong>${escapeHtml(formatDateTime(state.performance.lastRunAt))}</strong>
        <span>${escapeHtml(result.sampleText || "Muestras breves sobre shell, UI y datos.")}</span>
      </article>
      <article class="improvements__perfSummaryCard" data-tone="${(result.longTaskCount || 0) > 0 ? "amber" : "green"}">
        <small>Long tasks</small>
        <strong>${result.longTaskCount || 0}</strong>
        <span>${escapeHtml(result.longTaskText || "Sin tareas largas en la ventana medida.")}</span>
      </article>
    </div>
  `;

  els.performanceMetrics.innerHTML = (result.categories || []).map((category) => `
    <article class="improvements__perfMetricCard">
      <small>${escapeHtml(category.label || category.key || "Categoria")}</small>
      <strong>${escapeHtml(String(category.score ?? "--"))}</strong>
      <span>${escapeHtml(category.summary || "Sin observaciones.")}</span>
    </article>
  `).join("");

  els.performanceFindings.innerHTML = (result.findings || []).length
    ? result.findings.map((finding) => `
      <article class="improvements__perfFinding" data-tone="${escapeHtml(finding.tone || "blue")}">
        <h4>${escapeHtml(finding.title || "Observacion")}</h4>
        <p>${escapeHtml(finding.message || "")}</p>
      </article>
    `).join("")
    : '<div class="improvements__perfEmpty">No se han detectado hallazgos relevantes en esta pasada.</div>';

  // Renderizar grafica de historico
  requestAnimationFrame(() => {
    renderPerformanceHistoryChart();
  });
}

async function renderPerformanceHistoryChart() {
  if (!els.performanceChart) return;

  try {
    const { renderPerformanceHistoryChart: renderChart } = await ensureImprovementsPerformanceAuditReady();
    await renderChart(els.performanceChart);
  } catch (error) {
    console.warn("[improvements] no se pudo renderizar la grafica de historico", error);
    if (els.performanceChart) {
      els.performanceChart.innerHTML = '<div class="improvements__perfEmpty">La grafica del historico no pudo cargarse.</div>';
    }
  }
}

function renderActiveWindow() {
  renderWindowNavigation();
  renderEditorState();
  renderEditorModal();
  renderExportModal();

  if (state.currentWindow === "stats") {
    renderImprovementStats({ deferCharts: true });
    return;
  }

  if (state.currentWindow === "performance") {
    cancelImprovementStatsRender();
    disposeImprovementStatsCharts();
    renderPerformanceWindow();
    return;
  }

  cancelImprovementStatsRender();
  disposeImprovementStatsCharts();
  renderMainWindow();
}

function renderAll() {
  if (!state.root) return;
  ensureActiveViewId();
  if (state.editorOpen || state.editingItemId) {
    renderBoardSelectInput();
  }
  renderActiveWindow();
}

function openEditorModal({ focus = false } = {}) {
  if (!state.uid) return;
  state.editorOpen = true;
  renderEditorModal();
  if (focus) {
    requestAnimationFrame(() => {
      els.title?.focus();
    });
  }
}

function closeEditorModal({ reset = false } = {}) {
  state.editorOpen = false;
  renderEditorModal();
  if (reset) {
    resetEditor({ viewId: ensureActiveViewId() });
  }
}

function openExportModal(promptText) {
  state.exportText = String(promptText || "").trim();
  state.exportOpen = true;
  renderExportModal();
  requestAnimationFrame(() => {
    els.exportText?.focus();
    els.exportText?.setSelectionRange(0, 0);
  });
}

function closeExportModal() {
  state.exportOpen = false;
  renderExportModal();
}

function resetEditor({ focus = false, viewId = ensureActiveViewId() } = {}) {
  state.editingItemId = "";
  if (els.itemForm) els.itemForm.reset();
  if (els.fixType) els.fixType.value = "sin-tipo";
  if (els.priority) els.priority.value = "medium";
  if (els.status) els.status.value = "pending";
  renderBoardSelectInput();
  setBoardFieldValue(viewId);
  renderEditorState();
  if (focus) {
    requestAnimationFrame(() => {
      els.title?.focus();
    });
  }
}

function startEditingItem(itemId) {
  const item = state.items[itemId];
  if (!item) return;

  state.editingItemId = itemId;
  if (els.title) els.title.value = item.title || "";
  if (els.details) els.details.value = item.details || "";
  if (els.fixType) els.fixType.value = getItemFixType(item).key;
  if (els.priority) els.priority.value = sanitizePriority(item.priority);
  if (els.status) els.status.value = sanitizeStatus(item.status);
  renderBoardSelectInput();
  setBoardFieldValue(item.viewId || ensureActiveViewId());
  renderEditorState();
  openEditorModal({ focus: true });
}

function stopDataSubscriptions() {
  state.listeners.forEach((off) => {
    try {
      off?.();
    } catch (_) {}
  });
  state.listeners = [];
}

function subscribeData() {
  if (!state.path) return;
  stopDataSubscriptions();
  cancelScheduledImprovementRender();

  const stop = onValue(ref(db, state.path), (snap) => {
    const raw = snap.val() || {};
    state.boards = normalizeStoredBoards(raw.boards);
    state.items = normalizeItems(raw.items, raw.boards);
    state.expandedItems = new Set(
      [...state.expandedItems].filter((itemId) => Boolean(state.items[itemId]))
    );
    state.collapsedItems = new Set(
      [...state.collapsedItems].filter((itemId) => Boolean(state.items[itemId]))
    );
    state.selectedItems = new Set(
      [...state.selectedItems].filter((itemId) => Boolean(state.items[itemId]) && state.items[itemId].status !== "resolved")
    );

    if (state.editingItemId && !state.items[state.editingItemId]) {
      resetEditor({ viewId: ensureActiveViewId() });
    }

    invalidateImprovementDerivedData();
    scheduleImprovementRender();
  });

  state.listeners.push(stop);
}

function setUnauthenticatedState() {
  state.uid = "";
  state.path = "";
  state.boards = {};
  state.items = {};
  state.activeTypeFilters = new Set();
  state.expandedItems = new Set();
  state.collapsedItems = new Set();
  state.selectedItems = new Set();
  state.activeViewId = getDefaultViewId();
  state.editorOpen = false;
  state.exportOpen = false;
  state.exportText = "";
  invalidateImprovementDerivedData();
  resetEditor({ viewId: state.activeViewId });
  renderAll();
}

function handleAuthUser(user) {
  stopDataSubscriptions();

  if (!user?.uid) {
    setUnauthenticatedState();
    return;
  }

  state.uid = user.uid;
  state.path = `v2/users/${user.uid}/improvements`;
  subscribeData();
}

function collectItemPayload() {
  const title = String(els.title?.value || "").trim().slice(0, 120);
  if (!title) return null;

  const tabs = getAvailableBoards({ sort: false });
  const nextViewId = resolveLegacyViewId(els.boardSelect?.value, tabs);
  const nextBoard = findTabById(nextViewId, tabs) || buildFallbackBoard(nextViewId);

  return {
    title,
    details: String(els.details?.value || "").trim().slice(0, 1200),
    viewId: nextViewId,
    boardLabel: nextBoard.label,
    boardTone: nextBoard.tone,
    isCustomBoard: Boolean(nextBoard.isCustom),
    fixType: resolveFixTypeKey(els.fixType?.value),
    type: resolveFixTypeKey(els.fixType?.value),
    priority: sanitizePriority(els.priority?.value),
    status: sanitizeStatus(els.status?.value),
  };
}

async function saveItem() {
  if (!state.path) return;
  const payload = collectItemPayload();
  if (!payload) {
    els.title?.focus();
    return;
  }

  const {
    boardLabel,
    boardTone,
    isCustomBoard,
    ...itemPayload
  } = payload;
  const now = Date.now();
  const editingItem = getEditingItem();

  const previousItems = { ...state.items };
  const previousBoards = { ...state.boards };
  const tempItemId = editingItem ? editingItem.id : `tmp-${now}`;
  const resolvedAt = payload.status === "resolved"
    ? (editingItem?.resolvedAt || now)
    : null;

  if (isCustomBoard) {
    state.boards[payload.viewId] = createBoardRecord({
      ...(state.boards[payload.viewId] || {}),
      id: payload.viewId,
      moduleKey: state.boards[payload.viewId]?.moduleKey || normalizeBoardSeed(payload.viewId) || "general",
      label: boardLabel,
      tone: boardTone,
      isCustom: true,
      createdAt: Number(state.boards?.[payload.viewId]?.createdAt) || now,
      updatedAt: now,
    });
  }

  state.items[tempItemId] = {
    ...(editingItem || {}),
    ...itemPayload,
    createdAt: editingItem?.createdAt || now,
    updatedAt: now,
    resolvedAt,
  };
  state.activeViewId = payload.viewId;
  invalidateImprovementDerivedData();
  closeEditorModal();
  resetEditor({ viewId: payload.viewId });
  renderAll();

  try {
    const updates = {};

    if (isCustomBoard) {
      updates[`boards/${payload.viewId}`] = {
        name: boardLabel,
        label: boardLabel,
        tone: boardTone,
        createdAt: Number(state.boards?.[payload.viewId]?.createdAt) || now,
        updatedAt: now,
      };
    }

    if (editingItem) {
      updates[`items/${editingItem.id}`] = {
        ...itemPayload,
        boardId: payload.viewId,
        updatedAt: now,
        resolvedAt,
      };
      await update(ref(db, state.path), updates);
      return;
    }

    const newRef = push(ref(db, `${state.path}/items`));
    await set(newRef, {
      ...itemPayload,
      boardId: payload.viewId,
      createdAt: now,
      updatedAt: now,
      resolvedAt,
    });
    if (state.items[tempItemId]) {
      delete state.items[tempItemId];
      invalidateImprovementDerivedData();
      renderAll();
    }
  } catch (error) {
    state.items = previousItems;
    state.boards = previousBoards;
    invalidateImprovementDerivedData();
    renderAll();
    window.alert("No se pudo guardar la mejora. Revisa la conexion e intentalo de nuevo.");
  }
}

async function deleteItem(itemId) {
  const item = state.items[itemId];
  if (!item || !state.path) return;
  const shouldDelete = window.confirm(`Eliminar "${item.title || "esta mejora"}"?`);
  if (!shouldDelete) return;

  const previousItem = state.items[itemId];
  delete state.items[itemId];
  if (state.selectedItems.has(itemId)) state.selectedItems.delete(itemId);
  if (state.expandedItems.has(itemId)) state.expandedItems.delete(itemId);
  invalidateImprovementDerivedData();
  renderAll();

  try {
    await remove(ref(db, `${state.path}/items/${itemId}`));
    closeEditorModal();
    if (state.editingItemId === itemId) {
      resetEditor({ viewId: ensureActiveViewId() });
    }
  } catch (_) {
    state.items[itemId] = previousItem;
    invalidateImprovementDerivedData();
    renderAll();
    window.alert("No se pudo eliminar la mejora. Intentalo de nuevo.");
  }
}

async function toggleItemResolved(itemId) {
  const item = state.items[itemId];
  if (!item || !state.path) return;
  const nextStatus = item.status === "resolved" ? "pending" : "resolved";
  const now = Date.now();

  const previous = { ...item };
  state.items[itemId] = {
    ...item,
    status: nextStatus,
    updatedAt: now,
    resolvedAt: nextStatus === "resolved" ? now : null,
  };
  if (nextStatus === "resolved") state.selectedItems.delete(itemId);
  invalidateImprovementDerivedData();
  if (state.currentWindow === "stats") {
    renderImprovementStats({ deferCharts: true });
  } else {
    renderMainWindow();
  }

  try {
    await update(ref(db, `${state.path}/items/${itemId}`), {
      status: nextStatus,
      updatedAt: now,
      resolvedAt: nextStatus === "resolved" ? now : null,
    });
  } catch (_) {
    state.items[itemId] = previous;
    invalidateImprovementDerivedData();
    renderAll();
    window.alert("No se pudo actualizar el estado. Intentalo de nuevo.");
  }
}

function getPendingItemsForExport() {
  const visibleItemIds = new Set(
    filterItemsByActiveTypes(getItemList(ensureActiveViewId())).map((item) => item.id)
  );
  const selectedPending = Object.entries(state.items)
    .map(([id, item]) => ({ id, ...item }))
    .filter((item) => item.status !== "resolved" && state.selectedItems.has(item.id) && visibleItemIds.has(item.id))
    .sort(sortPendingItems);
  if (selectedPending.length) return selectedPending;

  const activeViewId = ensureActiveViewId();
  return filterItemsByActiveTypes(getItemList(activeViewId))
    .filter((item) => item.status !== "resolved")
    .sort(sortPendingItems);
}

function normalizeExportText(value) {
  return String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isVisualFix(item) {
  const fixType = getItemFixType(item);
  if (["estetico", "ux"].includes(fixType.key)) return true;
  if (["logico", "datos", "rendimiento"].includes(fixType.key)) return false;

  const rawText = normalizeToken([
    item?.title,
    item?.description,
    item?.details,
    item?.instructions,
  ].filter(Boolean).join(" "));

  if (!rawText) return false;
  return [
    "visual",
    "estetica",
    "estetico",
    "diseno",
    "maquet",
    "layout",
    "ui",
    "css",
    "estilo",
    "color",
    "tipografia",
    "animacion",
  ].some((token) => rawText.includes(token));
}

function getExportClosing(items) {
  const hasVisualFix = items.some((item) => isVisualFix(item));
  if (!hasVisualFix) {
    return "Aplícalos sin romper lo existente y respetando la estética y funcionamiento actuales.";
  }
  return "Aplícalos sin romper lo existente y respetando lo que no forme parte del cambio solicitado.";
}

function buildItemExportBody(item) {
  return normalizeExportText(item?.details);
}

function resolveItemBoardForExport(item) {
  if (!item || typeof item !== "object") return getGeneralBoard();
  const tabs = getAvailableBoards({ sort: false });
  const viewId = resolveLegacyViewId(item.viewId || item.boardId || item.tabId, tabs, state.boards);
  return findTabById(viewId, tabs) || buildFallbackBoard(viewId);
}

function buildExportPrompt(items, { board = getActiveTab() } = {}) {
  const safeItems = (items || [])
    .filter((item) => item?.status !== "resolved")
    .sort(sortPendingItems);
  if (!safeItems.length) return "";

  const resolvedBoards = safeItems
    .map((item) => resolveItemBoardForExport(item)?.id)
    .filter(Boolean);
  const uniqueBoards = Array.from(new Set(resolvedBoards));
  const categoryLabel = uniqueBoards.length === 1
    ? normalizeExportText(resolveItemBoardForExport(safeItems[0])?.label || board?.label || "General")
    : "multicategoria";
  const intro = uniqueBoards.length === 1
    ? `Estamos trabajando en una web app/PWA desplegada en GitHub Pages, con guardado en Firebase. Queremos resolver los siguientes fixes de la pestaña [${categoryLabel}].`
    : "Estamos trabajando en una web app/PWA desplegada en GitHub Pages, con guardado en Firebase. Queremos resolver los siguientes fixes agrupados por su pestaña real.";
  const closing = getExportClosing(safeItems);
  const lines = safeItems.map((item, index) => {
    const title = normalizeExportText(item?.title || "");
    const body = buildItemExportBody(item);
    const itemBoard = resolveItemBoardForExport(item);
    const itemBoardLabel = normalizeExportText(itemBoard?.label || "General");
    return `${index + 1}. [${itemBoardLabel}] ${title} — ${body}`;
  });

  return [intro, closing, "", ...lines].join("\n");
}

async function copyTextToClipboard(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }

  if (!els.exportText) return false;
  els.exportText.value = text;
  els.exportText.focus();
  els.exportText.select();
  return document.execCommand("copy");
}

async function exportFixes(items, board) {
  const prompt = buildExportPrompt(items, { board });
  if (!prompt) {
    window.alert("No hay fixes pendientes para exportar con los filtros actuales.");
    return;
  }

  try {
    await copyTextToClipboard(prompt);
  } catch (_) {}

  openExportModal(prompt);
}

function toggleItemSelection(itemId, selected) {
  const item = state.items[itemId];
  if (!item || item.status === "resolved") {
    state.selectedItems.delete(itemId);
    return;
  }

  if (selected) state.selectedItems.add(itemId);
  else state.selectedItems.delete(itemId);
}

function bindEvents() {
  if (state.eventsBound || !state.root) return;

  els.openEditorBtn?.addEventListener("click", () => {
    resetEditor({ viewId: ensureActiveViewId() });
    openEditorModal({ focus: true });
  });

  els.cancelEditBtn?.addEventListener("click", () => {
    resetEditor({ viewId: ensureActiveViewId(), focus: true });
  });

  els.itemForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    void saveItem();
  });

  els.deleteItemBtn?.addEventListener("click", () => {
    if (!state.editingItemId) return;
    void deleteItem(state.editingItemId);
  });

  els.boardTabs?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-board-tab]");
    if (!button) return;
    state.activeViewId = String(button.dataset.boardTab || getDefaultViewId());
    if (!state.editingItemId && els.boardSelect) {
      setBoardFieldValue(state.activeViewId);
    }
    renderMainWindow();
  });

  els.windowTabs?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-window]");
    if (!button) return;
    const nextWindow = ["stats", "performance"].includes(button.dataset.window)
      ? button.dataset.window
      : "main";
    if (state.currentWindow === nextWindow) return;
    state.currentWindow = nextWindow;
    renderActiveWindow();
    if (nextWindow === "stats") {
      requestAnimationFrame(() => {
        resizeImprovementStatsCharts();
      });
    }
  });

  els.exportBtn?.addEventListener("click", () => {
    const items = getPendingItemsForExport();
    void exportFixes(items, getActiveTab());
  });

  els.performanceRunBtn?.addEventListener("click", () => {
    void runPerformanceAudit();
  });

  els.typeFilters?.addEventListener("click", (event) => {
    const button = event.target?.closest?.("[data-type-filter]");
    if (!button) return;

    const nextFilter = String(button.dataset.typeFilter || "").trim();
    if (!nextFilter || nextFilter === "all") {
      state.activeTypeFilters = new Set();
      renderTypeFilters();
      renderFilteredLists();
      return;
    }

    if (state.activeTypeFilters.has(nextFilter)) {
      state.activeTypeFilters.delete(nextFilter);
    } else {
      state.activeTypeFilters.add(nextFilter);
    }

    renderTypeFilters();
    renderFilteredLists();
  });

  els.clearTypeFiltersBtn?.addEventListener("click", () => {
    if (!state.activeTypeFilters.size) return;
    state.activeTypeFilters = new Set();
    renderTypeFilters();
    renderFilteredLists();
  });

  els.editorBackdrop?.addEventListener("click", (event) => {
    if (event.target === els.editorBackdrop || event.target?.closest?.("#improvements-close-editor-btn")) {
      closeEditorModal({ reset: true });
    }
  });

  els.exportBackdrop?.addEventListener("click", (event) => {
    if (event.target === els.exportBackdrop || event.target?.closest?.("#improvements-close-export-btn")) {
      closeExportModal();
    }
  });

  els.copyExportBtn?.addEventListener("click", () => {
    if (!state.exportText) return;
    void copyTextToClipboard(state.exportText);
  });

  els.toggleResolvedBtn?.addEventListener("click", () => {
    state.resolvedPanelCollapsed = !state.resolvedPanelCollapsed;
    renderResolvedPanelState();
    if (state.resolvedPanelCollapsed) {
      if (els.resolvedList) els.resolvedList.innerHTML = "";
      return;
    }
    renderFilteredLists();
  });

  const handleListAction = (event) => {
    const actionButton = event.target?.closest?.("[data-item-action][data-item-id]");
    if (!actionButton) return;
    const itemId = String(actionButton.dataset.itemId || "").trim();
    const action = String(actionButton.dataset.itemAction || "").trim();
    if (!itemId || !action) return;

    if (action === "edit") {
      startEditingItem(itemId);
      return;
    }
    if (action === "export") {
      const item = state.items[itemId];
      if (!item) return;
      const board = findTabById(item.viewId) || getActiveTab();
      void exportFixes([{ id: itemId, ...item }], board);
      return;
    }
    if (action === "expand") {
      toggleItemExpanded(itemId);
      return;
    }
    if (action === "delete") {
      void deleteItem(itemId);
    }
  };

  const handleListToggle = (event) => {
    const selectionInput = event.target?.closest?.('input[data-item-action="select"][data-item-id]');
    if (selectionInput) {
      const itemId = String(selectionInput.dataset.itemId || "").trim();
      if (!itemId) return;
      toggleItemSelection(itemId, Boolean(selectionInput.checked));
      return;
    }

    const checkbox = event.target?.closest?.('input[data-item-action="toggle"][data-item-id]');
    if (!checkbox) return;
    const itemId = String(checkbox.dataset.itemId || "").trim();
    if (!itemId) return;
    void toggleItemResolved(itemId);
  };

  els.pendingList?.addEventListener("click", handleListAction);
  els.resolvedList?.addEventListener("click", handleListAction);
  els.pendingList?.addEventListener("change", handleListToggle);
  els.resolvedList?.addEventListener("change", handleListToggle);

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (state.editorOpen) {
      closeEditorModal({ reset: true });
      return;
    }
    if (state.exportOpen) {
      closeExportModal();
      return;
    }
  });

  if (!state.handleWindowResize) {
    state.handleWindowResize = () => {
      resizeImprovementStatsCharts();
    };
    window.addEventListener("resize", state.handleWindowResize, { passive: true });
    window.addEventListener("orientationchange", state.handleWindowResize, { passive: true });
  }

  state.eventsBound = true;
}

function cacheElements(root) {
  state.root = root;
  els.windowTabs = root.querySelector(".improvements__windowTabs");
  els.windowPanels = Array.from(root.querySelectorAll("[data-window-panel]"));
  els.summary = root.querySelector("#improvements-summary");
  els.statsSubtitle = root.querySelector("#improvements-stats-subtitle");
  els.statsKpis = root.querySelector("#improvements-stats-kpis");
  els.statsInsights = root.querySelector("#improvements-stats-insights");
  els.statsTypes = root.querySelector("#improvements-stats-types");
  els.statsDonut = root.querySelector("#improvements-stats-donut");
  els.statsBar = root.querySelector("#improvements-stats-bar");
  els.statsLine = root.querySelector("#improvements-stats-line");
  els.statsBreakdown = root.querySelector("#improvements-stats-breakdown");
  els.performanceRunBtn = root.querySelector("#improvements-performance-run-btn");
  els.performanceSync = root.querySelector("#improvements-performance-sync");
  els.performanceStatus = root.querySelector("#improvements-performance-status");
  els.performanceSummary = root.querySelector("#improvements-performance-summary");
  els.performanceMetrics = root.querySelector("#improvements-performance-metrics");
  els.performanceFindings = root.querySelector("#improvements-performance-findings");
  els.performanceChart = root.querySelector("#improvements-performance-chart");
  els.tabCount = root.querySelector("#improvements-tab-count");
  els.boardTabs = root.querySelector("#improvements-board-tabs");
  els.boardMeta = root.querySelector("#improvements-board-meta");
  els.editorBackdrop = root.querySelector("#improvements-editor-backdrop");
  els.exportBackdrop = root.querySelector("#improvements-export-backdrop");
  els.openEditorBtn = root.querySelector("#improvements-open-editor-btn");
  els.exportBtn = root.querySelector("#improvements-export-btn");
  els.exportText = root.querySelector("#improvements-export-text");
  els.copyExportBtn = root.querySelector("#improvements-copy-export-btn");
  els.typeFilters = root.querySelector("#improvements-type-filters");
  els.clearTypeFiltersBtn = root.querySelector("#improvements-clear-type-filters-btn");
  els.itemForm = root.querySelector("#improvements-item-form");
  els.itemSubmit = root.querySelector('#improvements-item-form button[type="submit"]');
  els.cancelEditBtn = root.querySelector("#improvements-cancel-edit-btn");
  els.deleteItemBtn = root.querySelector("#improvements-delete-item-btn");
  els.editorTitle = root.querySelector("#improvements-editor-title");
  els.title = root.querySelector("#improvements-title");
  els.details = root.querySelector("#improvements-details");
  els.boardSelect = root.querySelector("#improvements-board-select");
  els.fixType = root.querySelector("#improvements-fix-type");
  els.boardOptions = root.querySelector("#improvements-board-options");
  els.priority = root.querySelector("#improvements-priority");
  els.status = root.querySelector("#improvements-status");
  els.pendingLabel = root.querySelector("#improvements-pending-label");
  els.pendingTitle = root.querySelector("#improvements-pending-title");
  els.pendingCount = root.querySelector("#improvements-pending-count");
  els.resolvedLabel = root.querySelector("#improvements-resolved-label");
  els.resolvedTitle = root.querySelector("#improvements-resolved-title");
  els.resolvedCount = root.querySelector("#improvements-resolved-count");
  els.toggleResolvedBtn = root.querySelector("#improvements-toggle-resolved-btn");
  els.pendingList = root.querySelector("#improvements-pending-list");
  els.resolvedListBlock = root.querySelector("#improvements-resolved-list")?.closest(".improvements__listBlock");
  els.resolvedList = root.querySelector("#improvements-resolved-list");
}

export async function init({ root }) {
  if (!root) return;

  cacheElements(root);
  bindEvents();
  if (!state.syncUnsubscribe) {
    state.syncUnsubscribe = subscribeSyncState((snapshot) => {
      state.syncState = snapshot;
      if (state.currentWindow === "performance") {
        renderPerformanceWindow();
      }
    });
  }
  state.viewVisible = true;
  state.activeViewId = getDefaultViewId();
  resetEditor({ viewId: state.activeViewId });

  if (!state.authUnsub) {
    state.authUnsub = onUserChange((user) => {
      handleAuthUser(user || auth.currentUser || null);
    });
  }

  handleAuthUser(auth.currentUser || null);
  window.__bookshellImprovements = {
    closeEditorModal: (options = {}) => closeEditorModal(options),
  };
  state.initialized = true;
}

export async function onShow() {
  state.viewVisible = true;
  if (state.uid && state.path && !state.listeners.length) {
    subscribeData();
  }
  renderAll();
  if (state.currentWindow === "stats") {
    requestAnimationFrame(() => {
      resizeImprovementStatsCharts();
    });
  }
}

export async function onHide() {
  state.viewVisible = false;
  cancelImprovementStatsRender();
  cancelScheduledImprovementRender();
  stopDataSubscriptions();
  disposeImprovementStatsCharts();
}

export function destroy() {
  void onHide();
  state.editorOpen = false;
  state.exportOpen = false;
  state.currentWindow = "main";
  state.viewVisible = false;
  syncModalBodyState();
  cancelImprovementStatsRender();
  disposeImprovementStatsCharts();
  if (state.statsResizeRaf) {
    cancelAnimationFrame(state.statsResizeRaf);
    state.statsResizeRaf = 0;
  }
  cancelScheduledImprovementRender();
  if (state.handleWindowResize) {
    window.removeEventListener("resize", state.handleWindowResize);
    window.removeEventListener("orientationchange", state.handleWindowResize);
    state.handleWindowResize = null;
  }
  if (state.syncUnsubscribe) {
    state.syncUnsubscribe();
    state.syncUnsubscribe = null;
  }
  if (window.__bookshellImprovements?.closeEditorModal) {
    delete window.__bookshellImprovements;
  }
}
