import { auth, db, onUserChange } from "../../shared/firebase/index.js";
import {
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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

const state = {
  initialized: false,
  root: null,
  uid: "",
  path: "",
  boards: {},
  items: {},
  activeViewId: DEFAULT_VIEW_ID,
  editingItemId: "",
  editorOpen: false,
  exportOpen: false,
  selectedItems: new Set(),
  exportText: "",
  expandedItems: new Set(),
  listeners: [],
  authUnsub: null,
  eventsBound: false,
};

const els = {};

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

function getAvailableBoards({ sort = true } = {}) {
  const merged = new Map();
  const addBoard = (board) => {
    if (!board?.id) return;
    const prev = merged.get(board.id);
    merged.set(board.id, prev
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
  Object.values(state.items || {}).forEach((item) => {
    if (!item?.viewId) return;
    addBoard(buildFallbackBoard(item.viewId));
  });

  const boards = Array.from(merged.values());
  return sort ? boards.sort(compareBoards) : boards;
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

function normalizeItems(rawItems, rawBoards = null) {
  const shellTabs = getShellTabs();
  const tabs = [...shellTabs, getGeneralBoard(), ...Object.values(normalizeStoredBoards(rawBoards, shellTabs))];
  const nextItems = {};

  Object.entries(rawItems || {}).forEach(([id, item]) => {
    if (id === "_init" || !item || typeof item !== "object") return;

    const status = sanitizeStatus(item.status);
    nextItems[id] = {
      title: String(item.title || "").trim().slice(0, 120),
      description: String(item.description || "").trim().slice(0, 1200),
      details: String(item.details || "").trim().slice(0, 1200),
      instructions: String(item.instructions || "").trim().slice(0, 1200),
      type: String(item.type || "").trim().slice(0, 120),
      fixType: String(item.fixType || "").trim().slice(0, 120),
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
  const items = Object.entries(state.items)
    .map(([id, item]) => ({ id, ...(item || {}) }));

  if (!viewId || isGeneralBoardViewId(viewId)) return items;
  return items.filter((item) => item.viewId === viewId);
}

function getTabCounts(viewId) {
  return getItemList(viewId).reduce((acc, item) => {
    if (item.status === "resolved") acc.resolved += 1;
    else acc.pending += 1;
    return acc;
  }, { pending: 0, resolved: 0 });
}

function getGlobalCounts() {
  return Object.values(state.items).reduce((acc, item) => {
    if (sanitizeStatus(item.status) === "resolved") acc.resolved += 1;
    else acc.pending += 1;
    return acc;
  }, { pending: 0, resolved: 0 });
}

function getActiveTab() {
  const tabs = getAvailableBoards({ sort: false });
  return findTabById(ensureActiveViewId(), tabs) || tabs[0] || null;
}

function getPriorityBoard() {
  return getAvailableBoards()[0] || null;
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

function renderEditorModal() {
  if (!els.editorBackdrop) return;
  els.editorBackdrop.classList.toggle("hidden", !state.editorOpen);
  els.editorBackdrop.setAttribute("aria-hidden", String(!state.editorOpen));
  document.body.classList.toggle("has-open-modal", state.editorOpen || state.exportOpen);
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
  document.body.classList.toggle("has-open-modal", state.editorOpen || state.exportOpen);
}

function renderEmptyList(target, text) {
  if (!target) return;
  target.innerHTML = `<div class="empty-state improvements__empty">${escapeHtml(text)}</div>`;
}

function toggleItemExpanded(itemId) {
  const nextItemId = String(itemId || "").trim();
  if (!nextItemId) return;

  if (state.expandedItems.has(nextItemId)) {
    state.expandedItems.delete(nextItemId);
  } else {
    state.expandedItems.add(nextItemId);
  }

  renderAll();
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

function renderCompactItemList(target, items, emptyText, { selectable = false } = {}) {
  if (!target) return;
  if (!items.length) {
    renderEmptyList(target, emptyText);
    return;
  }

  target.innerHTML = items.map((item) => {
    const tab = findTabById(item.viewId) || buildFallbackBoard(item.viewId);
    const emoji = inferBoardEmoji(tab);
    const isExpanded = state.expandedItems.has(item.id);
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
  }).join("");
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

  const items = getItemList(ensureActiveViewId());
  const pendingItems = items.filter((item) => item.status !== "resolved").sort(sortPendingItems);
  const resolvedItems = items.filter((item) => item.status === "resolved").sort(sortResolvedItems);

  if (els.pendingCount) els.pendingCount.textContent = String(pendingItems.length);
  if (els.resolvedCount) els.resolvedCount.textContent = String(resolvedItems.length);

  renderCompactItemList(
    els.pendingList,
    pendingItems,
    isGeneralView
      ? "No hay mejoras pendientes."
      : `No hay mejoras pendientes en ${activeLabel}.`,
    { selectable: true }
  );
  renderCompactItemList(
    els.resolvedList,
    resolvedItems,
    isGeneralView
      ? "Todavia no has marcado fixes como resueltos."
      : `Todavia no has marcado fixes como resueltos en ${activeLabel}.`
  );
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

function renderAll() {
  if (!state.root) return;
  ensureActiveViewId();
  renderSummary();
  renderBoardTabsCompact();
  renderActiveBoardMeta();
  renderBoardSelectInput();
  renderEditorState();
  renderEditorModal();
  renderExportModal();
  renderFilteredLists();
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

  const stop = onValue(ref(db, state.path), (snap) => {
    const raw = snap.val() || {};
    state.boards = normalizeStoredBoards(raw.boards);
    state.items = normalizeItems(raw.items, raw.boards);
    state.expandedItems = new Set(
      [...state.expandedItems].filter((itemId) => Boolean(state.items[itemId]))
    );
    state.selectedItems = new Set(
      [...state.selectedItems].filter((itemId) => Boolean(state.items[itemId]) && state.items[itemId].status !== "resolved")
    );

    if (state.editingItemId && !state.items[state.editingItemId]) {
      resetEditor({ viewId: ensureActiveViewId() });
    }

    renderAll();
  });

  state.listeners.push(stop);
}

function setUnauthenticatedState() {
  state.uid = "";
  state.path = "";
  state.boards = {};
  state.items = {};
  state.expandedItems = new Set();
  state.selectedItems = new Set();
  state.activeViewId = getDefaultViewId();
  state.editorOpen = false;
  state.exportOpen = false;
  state.exportText = "";
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

  if (isCustomBoard) {
    await update(ref(db, `${state.path}/boards/${payload.viewId}`), {
      name: boardLabel,
      label: boardLabel,
      tone: boardTone,
      createdAt: Number(state.boards?.[payload.viewId]?.createdAt) || now,
      updatedAt: now,
    });
  }

  if (editingItem) {
    await update(ref(db, `${state.path}/items/${editingItem.id}`), {
      ...itemPayload,
      boardId: payload.viewId,
      updatedAt: now,
      resolvedAt: payload.status === "resolved"
        ? (editingItem.resolvedAt || now)
        : null,
    });
  } else {
    const newRef = push(ref(db, `${state.path}/items`));
    await set(newRef, {
      ...itemPayload,
      boardId: payload.viewId,
      createdAt: now,
      updatedAt: now,
      resolvedAt: payload.status === "resolved" ? now : null,
    });
  }

  state.activeViewId = payload.viewId;
  closeEditorModal();
  resetEditor({ viewId: payload.viewId });
}

async function deleteItem(itemId) {
  const item = state.items[itemId];
  if (!item || !state.path) return;
  const shouldDelete = window.confirm(`Eliminar "${item.title || "esta mejora"}"?`);
  if (!shouldDelete) return;

  await remove(ref(db, `${state.path}/items/${itemId}`));
  closeEditorModal();
  if (state.editingItemId === itemId) {
    resetEditor({ viewId: ensureActiveViewId() });
  }
}

async function toggleItemResolved(itemId) {
  const item = state.items[itemId];
  if (!item || !state.path) return;
  const nextStatus = item.status === "resolved" ? "pending" : "resolved";
  const now = Date.now();

  await update(ref(db, `${state.path}/items/${itemId}`), {
    status: nextStatus,
    updatedAt: now,
    resolvedAt: nextStatus === "resolved" ? now : null,
  });
}

function getPendingItemsForExport() {
  const selectedPending = Object.entries(state.items)
    .map(([id, item]) => ({ id, ...item }))
    .filter((item) => item.status !== "resolved" && state.selectedItems.has(item.id))
    .sort(sortPendingItems);
  if (selectedPending.length) return selectedPending;

  const activeViewId = ensureActiveViewId();
  return getItemList(activeViewId)
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
  const directType = normalizeToken(item?.type || item?.fixType || item?.category || item?.kind);
  if (directType) {
    if (["visual", "ui", "ux", "estetico", "estetica", "diseno", "style", "styling"].some((token) => directType.includes(token))) {
      return true;
    }
    if (["functional", "funcional", "technical", "tecnico", "comportamiento", "behavior"].some((token) => directType.includes(token))) {
      return false;
    }
  }

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

function buildExportPrompt(items, { board = getActiveTab() } = {}) {
  const safeItems = (items || [])
    .filter((item) => item?.status !== "resolved")
    .sort(sortPendingItems);
  if (!safeItems.length) return "";

  const categoryLabel = normalizeExportText(board?.label || "General");
  const intro = `Estamos trabajando en una web app/PWA desplegada en GitHub Pages, con guardado en Firebase. Queremos resolver los siguientes fixes de la pestaña [${categoryLabel}].`;
  const closing = getExportClosing(safeItems);
  const lines = safeItems.map((item, index) => {
    const title = normalizeExportText(item?.title || "");
    const body = buildItemExportBody(item);
    return `${index + 1}. ${title} — ${body}`;
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
    renderAll();
  });

  els.exportBtn?.addEventListener("click", () => {
    const items = getPendingItemsForExport();
    void exportFixes(items, getActiveTab());
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
    }
  });

  state.eventsBound = true;
}

function cacheElements(root) {
  state.root = root;
  els.summary = root.querySelector("#improvements-summary");
  els.tabCount = root.querySelector("#improvements-tab-count");
  els.boardTabs = root.querySelector("#improvements-board-tabs");
  els.boardMeta = root.querySelector("#improvements-board-meta");
  els.editorBackdrop = root.querySelector("#improvements-editor-backdrop");
  els.exportBackdrop = root.querySelector("#improvements-export-backdrop");
  els.openEditorBtn = root.querySelector("#improvements-open-editor-btn");
  els.exportBtn = root.querySelector("#improvements-export-btn");
  els.exportText = root.querySelector("#improvements-export-text");
  els.copyExportBtn = root.querySelector("#improvements-copy-export-btn");
  els.itemForm = root.querySelector("#improvements-item-form");
  els.itemSubmit = root.querySelector('#improvements-item-form button[type="submit"]');
  els.cancelEditBtn = root.querySelector("#improvements-cancel-edit-btn");
  els.deleteItemBtn = root.querySelector("#improvements-delete-item-btn");
  els.editorTitle = root.querySelector("#improvements-editor-title");
  els.title = root.querySelector("#improvements-title");
  els.details = root.querySelector("#improvements-details");
  els.boardSelect = root.querySelector("#improvements-board-select");
  els.boardOptions = root.querySelector("#improvements-board-options");
  els.priority = root.querySelector("#improvements-priority");
  els.status = root.querySelector("#improvements-status");
  els.pendingLabel = root.querySelector("#improvements-pending-label");
  els.pendingTitle = root.querySelector("#improvements-pending-title");
  els.pendingCount = root.querySelector("#improvements-pending-count");
  els.resolvedLabel = root.querySelector("#improvements-resolved-label");
  els.resolvedTitle = root.querySelector("#improvements-resolved-title");
  els.resolvedCount = root.querySelector("#improvements-resolved-count");
  els.pendingList = root.querySelector("#improvements-pending-list");
  els.resolvedList = root.querySelector("#improvements-resolved-list");
}

export async function init({ root }) {
  if (!root) return;

  cacheElements(root);
  bindEvents();
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
  renderAll();
}

export function destroy() {
  stopDataSubscriptions();
  if (window.__bookshellImprovements?.closeEditorModal) {
    delete window.__bookshellImprovements;
  }
}
