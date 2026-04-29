import {
  onValue,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  ensureOfflineQueueCacheReady,
  getOfflineQueueSummary,
  listRetryableOfflineOperations,
  markOfflineOperationFailed,
  markOfflineOperationSynced,
  markOfflineOperationSyncing,
  pruneSyncedOfflineOperations,
  reviveInterruptedOfflineOperations,
} from "../storage/offline-queue.js";
import {
  getMetaRecord,
  putMetaRecord,
} from "../storage/offline-db.js";

const SYNC_META_KEY = "sync:state";

const state = {
  initialized: false,
  appOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  rtdbConnected: false,
  syncing: false,
  pendingCount: 0,
  syncingCount: 0,
  failedCount: 0,
  totalCount: 0,
  lastSyncAt: 0,
  lastSyncDurationMs: 0,
  lastError: "",
  lastErrorAt: 0,
};

let syncManagerDb = null;
let getCurrentUserId = () => "";
let connectionUnsubscribe = null;
let syncScheduledTimer = 0;
let syncInitPromise = null;
let listenersBound = false;

const subscribers = new Set();

function cloneState() {
  return { ...state };
}

function emitSyncState() {
  const snapshot = cloneState();
  subscribers.forEach((callback) => {
    try {
      callback(snapshot);
    } catch (error) {
      console.warn("[sync-manager] listener failed", error);
    }
  });
}

function clearSyncTimer() {
  if (!syncScheduledTimer) return;
  window.clearTimeout(syncScheduledTimer);
  syncScheduledTimer = 0;
}

function getActiveUid() {
  return String(getCurrentUserId?.() || "").trim();
}

function isWriteConnectionReady() {
  return Boolean(state.appOnline && state.rtdbConnected);
}

function isConnectivityError(error) {
  const text = String(error?.code || error?.message || error || "").toLowerCase();
  return [
    "offline",
    "network",
    "disconnected",
    "failed to fetch",
    "timeout",
    "connection",
  ].some((token) => text.includes(token));
}

function describeSyncError(error) {
  return String(error?.message || error?.code || error || "Unknown sync error").trim();
}

async function persistSyncMeta() {
  await putMetaRecord({
    key: SYNC_META_KEY,
    data: {
      lastSyncAt: state.lastSyncAt,
      lastSyncDurationMs: state.lastSyncDurationMs,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt,
    },
  });
}

async function hydrateSyncMeta() {
  const record = await getMetaRecord(SYNC_META_KEY);
  if (!record?.data) return;
  state.lastSyncAt = Number(record.data.lastSyncAt) || 0;
  state.lastSyncDurationMs = Number(record.data.lastSyncDurationMs) || 0;
  state.lastError = String(record.data.lastError || "").trim();
  state.lastErrorAt = Number(record.data.lastErrorAt) || 0;
}

async function refreshQueueSummary() {
  const summary = await getOfflineQueueSummary(getActiveUid());
  state.pendingCount = summary.pending;
  state.syncingCount = summary.syncing;
  state.failedCount = summary.failed;
  state.totalCount = summary.total;
}

async function applyRemoteOperation(operation) {
  if (!syncManagerDb) {
    throw new Error("[sync-manager] missing database instance");
  }

  const safePath = String(operation?.firebasePath || "").trim();
  if (!safePath) {
    throw new Error("[sync-manager] missing firebase path");
  }

  if (operation.writeType === "update") {
    await update(ref(syncManagerDb, safePath), operation.payload || {});
    return;
  }

  if (operation.payload == null) {
    await remove(ref(syncManagerDb, safePath));
    return;
  }

  await set(ref(syncManagerDb, safePath), operation.payload);
}

async function finishSyncCycle(startedAt, hadSuccess = false) {
  state.syncing = false;
  if (hadSuccess) {
    state.lastSyncAt = Date.now();
    state.lastSyncDurationMs = Math.max(0, Date.now() - startedAt);
    state.lastError = "";
    state.lastErrorAt = 0;
    await persistSyncMeta();
  } else if (state.lastError) {
    state.lastErrorAt = Date.now();
    await persistSyncMeta();
  }
  await pruneSyncedOfflineOperations();
  await refreshQueueSummary();
  emitSyncState();
}

async function runSyncCycle(reason = "manual") {
  if (state.syncing) return false;
  if (!isWriteConnectionReady()) return false;

  const uid = getActiveUid();
  if (!uid) {
    await refreshQueueSummary();
    emitSyncState();
    return false;
  }

  const operations = await listRetryableOfflineOperations(uid);
  if (!operations.length) {
    await refreshQueueSummary();
    emitSyncState();
    return true;
  }

  const startedAt = Date.now();
  let hadSuccess = false;
  state.syncing = true;
  emitSyncState();

  for (const operation of operations) {
    if (!isWriteConnectionReady()) break;

    await markOfflineOperationSyncing(operation.opId);
    await refreshQueueSummary();
    emitSyncState();

    try {
      await applyRemoteOperation(operation);
      await markOfflineOperationSynced(operation.opId);
      hadSuccess = true;
    } catch (error) {
      state.lastError = describeSyncError(error);
      await markOfflineOperationFailed(operation.opId, state.lastError);
      if (isConnectivityError(error)) {
        break;
      }
    }
  }

  await finishSyncCycle(startedAt, hadSuccess);

  const remaining = await listRetryableOfflineOperations(uid);
  if (remaining.length && isWriteConnectionReady()) {
    scheduleSync({ reason: `${reason}:remaining`, delayMs: 900 });
  }

  return hadSuccess;
}

function bindConnectivityListeners() {
  if (listenersBound) return;

  window.addEventListener("online", () => {
    state.appOnline = true;
    emitSyncState();
    scheduleSync({ reason: "browser-online", delayMs: 120 });
  });

  window.addEventListener("offline", () => {
    state.appOnline = false;
    emitSyncState();
  });

  listenersBound = true;
}

export async function initSyncManager({ db, getUserId } = {}) {
  if (state.initialized) return cloneState();
  if (syncInitPromise) return syncInitPromise;

  syncInitPromise = (async () => {
    syncManagerDb = db || syncManagerDb;
    if (typeof getUserId === "function") {
      getCurrentUserId = getUserId;
    }

    await Promise.all([
      ensureOfflineQueueCacheReady(),
      hydrateSyncMeta(),
    ]);
    await reviveInterruptedOfflineOperations();

    await refreshQueueSummary();
    bindConnectivityListeners();

    if (syncManagerDb && !connectionUnsubscribe) {
      connectionUnsubscribe = onValue(ref(syncManagerDb, ".info/connected"), (snap) => {
        state.rtdbConnected = !!snap.val();
        emitSyncState();
        if (state.rtdbConnected) {
          scheduleSync({ reason: "rtdb-connected", delayMs: 120 });
        }
      });
    }

    state.initialized = true;
    emitSyncState();
    return cloneState();
  })().finally(() => {
    syncInitPromise = null;
  });

  return syncInitPromise;
}

export function subscribeSyncState(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }
  subscribers.add(callback);
  callback(cloneState());
  return () => {
    subscribers.delete(callback);
  };
}

export function getSyncState() {
  return cloneState();
}

export function canWriteDirectly() {
  return isWriteConnectionReady();
}

export async function notifyOfflineQueueChanged() {
  await ensureOfflineQueueCacheReady();
  await refreshQueueSummary();
  emitSyncState();
  if (isWriteConnectionReady()) {
    scheduleSync({ reason: "queue-changed", delayMs: 90 });
  }
}

export async function notifySyncUserChanged() {
  await refreshQueueSummary();
  emitSyncState();
  if (isWriteConnectionReady()) {
    scheduleSync({ reason: "auth-changed", delayMs: 140 });
  }
}

export function scheduleSync({ reason = "scheduled", delayMs = 60 } = {}) {
  if (typeof window === "undefined") return;
  clearSyncTimer();
  syncScheduledTimer = window.setTimeout(() => {
    syncScheduledTimer = 0;
    void runSyncCycle(reason);
  }, Math.max(0, Number(delayMs) || 0));
}
