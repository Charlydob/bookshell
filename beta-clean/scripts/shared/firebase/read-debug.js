const state = {
  reads: [],
  counts: new Map(),
  activeListeners: new Map(),
  viewListeners: new Map(),
};

function nowIso() {
  return new Date().toISOString();
}

function bump(path) {
  state.counts.set(path, (state.counts.get(path) || 0) + 1);
}

export function logFirebaseRead({ path = "", mode = "get", reason = "", viewId = "global", estimatedCount = null }) {
  const item = { at: nowIso(), path, mode, reason, viewId, estimatedCount };
  state.reads.push(item);
  if (state.reads.length > 1000) state.reads.shift();
  bump(path);
  console.debug("[firebase:read]", item);
}

export function registerViewListener(viewId, unsubscribe, meta = {}) {
  if (typeof unsubscribe !== "function") return unsubscribe;
  const id = `${viewId}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
  state.activeListeners.set(id, { viewId, unsubscribe, ...meta, startedAt: nowIso() });
  const list = state.viewListeners.get(viewId) || [];
  list.push(id);
  state.viewListeners.set(viewId, list);
  return () => {
    try { unsubscribe(); } catch (_) {}
    state.activeListeners.delete(id);
  };
}

export function cleanupViewListeners(viewId) {
  const ids = state.viewListeners.get(viewId) || [];
  ids.forEach((id) => {
    const meta = state.activeListeners.get(id);
    try { meta?.unsubscribe?.(); } catch (_) {}
    state.activeListeners.delete(id);
  });
  state.viewListeners.delete(viewId);
}

export function exposeFirebaseReadDebug() {
  if (typeof window === "undefined") return;
  window.__bookshellDebug = window.__bookshellDebug || {};
  window.__bookshellDebug.firebaseReads = () => ({
    reads: [...state.reads],
    counts: Object.fromEntries(state.counts.entries()),
    activeListeners: [...state.activeListeners.values()],
    suspicious: state.reads.filter((r) => /v2\/users\/[^/]+\/(finance|recipes|habits)$|v2\/users\/[^/]+$|v2\/public$/.test(r.path)),
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
      localStorage.setItem(storageKey, JSON.stringify({ cacheUpdatedAt: Date.now(), data }));
    } catch (_) {}
    return data;
  });
}
