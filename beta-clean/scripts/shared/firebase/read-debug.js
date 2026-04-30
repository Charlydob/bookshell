const state = {
  reads: [],
  counts: new Map(),
  activeListeners: new Map(),
  viewListeners: new Map(),
  listenerKeys: new Map(),
  bytesRisk: [],
};

function nowIso() {
  return new Date().toISOString();
}

function bump(path) {
  state.counts.set(path, (state.counts.get(path) || 0) + 1);
}

function cloneDefault(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === "object") return { ...value };
  return value;
}

function normalizeViewId(viewId = "") {
  return String(viewId || "global").trim() || "global";
}

function looksHeavyFirebasePath(path = "") {
  const safePath = String(path || "").trim();
  if (!safePath) return false;
  return /v2\/users\/[^/]+$|v2\/users\/[^/]+\/(finance|recipes|habits|world|notes)$|v2\/users\/[^/]+\/finance\/(?:transactions|movements|tx|foodItems|shoppingHub|tickets)(?:\/|$)|v2\/users\/[^/]+\/recipes\/(?:nutrition|products|dailyLogsByDate)(?:\/|$)|v2\/users\/[^/]+\/habits\/habitSessions(?:\/|$)|v2\/public(?:\/|$)/.test(safePath);
}

export function logFirebaseBytesRisk({ path = "", reason = "", viewId = "global", estimatedCount = null } = {}) {
  const item = {
    at: nowIso(),
    path,
    reason,
    viewId: normalizeViewId(viewId),
    estimatedCount,
  };
  state.bytesRisk.push(item);
  if (state.bytesRisk.length > 500) state.bytesRisk.shift();
  console.warn("[firebase:bytes-risk]", item);
}

export function logFirebaseRead({
  path = "",
  mode = "get",
  reason = "",
  viewId = "global",
  estimatedCount = null,
  bounded = false,
  querySummary = "",
} = {}) {
  const item = {
    at: nowIso(),
    path,
    mode,
    reason,
    viewId: normalizeViewId(viewId),
    estimatedCount,
    bounded: !!bounded,
    querySummary: String(querySummary || "").trim(),
  };
  state.reads.push(item);
  if (state.reads.length > 1000) state.reads.shift();
  bump(path);
  if (looksHeavyFirebasePath(path) && !bounded) {
    logFirebaseBytesRisk({ path, reason: reason || mode, viewId, estimatedCount });
  }
  const tag = mode === "get"
    ? "[firebase:get]"
    : mode === "onValue"
      ? "[firebase:listen:attach]"
      : "[firebase:read]";
  console.debug(tag, item);
}

function detachListenerId(id, { invoke = true, stopReason = "" } = {}) {
  const entry = state.activeListeners.get(id);
  if (!entry) return;

  if (invoke) {
    try { entry.unsubscribe?.(); } catch (_) {}
  }

  const list = state.viewListeners.get(entry.viewId) || [];
  const nextList = list.filter((listenerId) => listenerId !== id);
  if (nextList.length) state.viewListeners.set(entry.viewId, nextList);
  else state.viewListeners.delete(entry.viewId);

  if (entry.listenerKey) {
    const current = state.listenerKeys.get(entry.listenerKey);
    if (current === id) state.listenerKeys.delete(entry.listenerKey);
  }

  state.activeListeners.delete(id);
  console.debug("[firebase:listen:stop]", {
    at: nowIso(),
    viewId: entry.viewId,
    path: entry.path || "",
    key: entry.key || "",
    mode: entry.mode || "onValue",
    reason: stopReason || entry.reason || "",
  });
}

export function registerViewListener(viewId, unsubscribe, meta = {}) {
  if (typeof unsubscribe !== "function") return unsubscribe;
  const safeViewId = normalizeViewId(viewId);
  const key = String(meta.key || "").trim();
  const listenerKey = key ? `${safeViewId}:${key}` : "";
  const existingId = listenerKey ? state.listenerKeys.get(listenerKey) : "";
  if (existingId) {
    detachListenerId(existingId, { invoke: true, stopReason: "replaced" });
  }

  const id = `${safeViewId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  state.activeListeners.set(id, {
    viewId: safeViewId,
    unsubscribe,
    ...meta,
    key,
    listenerKey,
    startedAt: nowIso(),
  });
  const list = state.viewListeners.get(safeViewId) || [];
  list.push(id);
  state.viewListeners.set(safeViewId, list);
  if (listenerKey) state.listenerKeys.set(listenerKey, id);

  if (meta.path) {
    if (looksHeavyFirebasePath(meta.path) && !meta.bounded) {
      logFirebaseBytesRisk({
        path: meta.path,
        reason: meta.reason || meta.mode || "listen-start",
        viewId: safeViewId,
        estimatedCount: meta.estimatedCount ?? null,
      });
    }
    console.debug("[firebase:listen:start]", {
      at: nowIso(),
      viewId: safeViewId,
      path: meta.path,
      key,
      mode: meta.mode || "onValue",
      reason: meta.reason || "",
    });
  }

  return () => {
    detachListenerId(id, { invoke: true, stopReason: "manual" });
  };
}

export function cleanupViewListeners(viewId) {
  const safeViewId = normalizeViewId(viewId);
  const ids = [...(state.viewListeners.get(safeViewId) || [])];
  ids.forEach((id) => {
    detachListenerId(id, { invoke: true, stopReason: "view-cleanup" });
  });
}

export function clearReadCache(key = "") {
  const safeKey = String(key || "").trim();
  if (!safeKey) return;
  try {
    localStorage.removeItem(`bookshell:cache:${safeKey}`);
  } catch (_) {}
}

export function exposeFirebaseReadDebug() {
  if (typeof window === "undefined") return;
  window.__bookshellDebug = window.__bookshellDebug || {};
  window.__bookshellDebug.firebaseReads = () => ({
    reads: [...state.reads],
    counts: Object.fromEntries(state.counts.entries()),
    activeListeners: [...state.activeListeners.values()],
    bytesRisk: [...state.bytesRisk],
    suspicious: state.reads.filter((r) => looksHeavyFirebasePath(r.path) && !r.bounded),
  });
}

export function readWithCache({ key, ttlMs, loader }) {
  const storageKey = `bookshell:cache:${key}`;
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.cacheUpdatedAt && Date.now() - parsed.cacheUpdatedAt < ttlMs) {
        return Promise.resolve(parsed.data);
      }
    }
  } catch (_) {}
  return Promise.resolve(loader()).then((data) => {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ cacheUpdatedAt: Date.now(), data: cloneDefault(data) }));
    } catch (_) {}
    return data;
  });
}
