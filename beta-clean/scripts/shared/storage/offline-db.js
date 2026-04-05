const DB_NAME = "bookshell-offline-db";
const DB_VERSION = 1;

const OPERATIONS_STORE = "operations";
const SNAPSHOTS_STORE = "snapshots";
const META_STORE = "meta";

const memoryFallback = {
  operations: new Map(),
  snapshots: new Map(),
  meta: new Map(),
};

let dbPromise = null;

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("[offline-db] request failed"));
  });
}

function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error || new Error("[offline-db] transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("[offline-db] transaction failed"));
  });
}

function ensureStores(db) {
  if (!db.objectStoreNames.contains(OPERATIONS_STORE)) {
    db.createObjectStore(OPERATIONS_STORE, { keyPath: "opId" });
  }
  if (!db.objectStoreNames.contains(SNAPSHOTS_STORE)) {
    db.createObjectStore(SNAPSHOTS_STORE, { keyPath: "key" });
  }
  if (!db.objectStoreNames.contains(META_STORE)) {
    db.createObjectStore(META_STORE, { keyPath: "key" });
  }
}

export function isOfflineDbSupported() {
  return typeof window !== "undefined" && "indexedDB" in window;
}

export async function openOfflineDb() {
  if (!isOfflineDbSupported()) return null;
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      ensureStores(request.result);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error || new Error("[offline-db] open failed"));
    };
    request.onblocked = () => {
      console.warn("[offline-db] open blocked by another tab");
    };
  }).catch((error) => {
    console.warn("[offline-db] fallback to memory store", error);
    dbPromise = null;
    return null;
  });

  return dbPromise;
}

export async function listOperationsFromDb() {
  const db = await openOfflineDb();
  if (!db) {
    return Array.from(memoryFallback.operations.values()).map(cloneValue);
  }

  const tx = db.transaction(OPERATIONS_STORE, "readonly");
  const store = tx.objectStore(OPERATIONS_STORE);
  const records = await requestToPromise(store.getAll());
  await transactionDone(tx);
  return Array.isArray(records) ? records.map(cloneValue) : [];
}

export async function getOperationFromDb(opId) {
  const safeId = String(opId || "").trim();
  if (!safeId) return null;

  const db = await openOfflineDb();
  if (!db) {
    return cloneValue(memoryFallback.operations.get(safeId) || null);
  }

  const tx = db.transaction(OPERATIONS_STORE, "readonly");
  const store = tx.objectStore(OPERATIONS_STORE);
  const record = await requestToPromise(store.get(safeId));
  await transactionDone(tx);
  return cloneValue(record || null);
}

export async function putOperationInDb(operation) {
  const safeOperation = cloneValue(operation);
  if (!safeOperation?.opId) return null;

  const db = await openOfflineDb();
  if (!db) {
    memoryFallback.operations.set(safeOperation.opId, safeOperation);
    return cloneValue(safeOperation);
  }

  const tx = db.transaction(OPERATIONS_STORE, "readwrite");
  tx.objectStore(OPERATIONS_STORE).put(safeOperation);
  await transactionDone(tx);
  return cloneValue(safeOperation);
}

export async function deleteOperationFromDb(opId) {
  const safeId = String(opId || "").trim();
  if (!safeId) return false;

  const db = await openOfflineDb();
  if (!db) {
    memoryFallback.operations.delete(safeId);
    return true;
  }

  const tx = db.transaction(OPERATIONS_STORE, "readwrite");
  tx.objectStore(OPERATIONS_STORE).delete(safeId);
  await transactionDone(tx);
  return true;
}

export async function getSnapshotRecord(key) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return null;

  const db = await openOfflineDb();
  if (!db) {
    return cloneValue(memoryFallback.snapshots.get(safeKey) || null);
  }

  const tx = db.transaction(SNAPSHOTS_STORE, "readonly");
  const store = tx.objectStore(SNAPSHOTS_STORE);
  const record = await requestToPromise(store.get(safeKey));
  await transactionDone(tx);
  return cloneValue(record || null);
}

export async function putSnapshotRecord(record) {
  const safeRecord = cloneValue(record);
  if (!safeRecord?.key) return null;

  const db = await openOfflineDb();
  if (!db) {
    memoryFallback.snapshots.set(safeRecord.key, safeRecord);
    return cloneValue(safeRecord);
  }

  const tx = db.transaction(SNAPSHOTS_STORE, "readwrite");
  tx.objectStore(SNAPSHOTS_STORE).put(safeRecord);
  await transactionDone(tx);
  return cloneValue(safeRecord);
}

export async function getMetaRecord(key) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return null;

  const db = await openOfflineDb();
  if (!db) {
    return cloneValue(memoryFallback.meta.get(safeKey) || null);
  }

  const tx = db.transaction(META_STORE, "readonly");
  const store = tx.objectStore(META_STORE);
  const record = await requestToPromise(store.get(safeKey));
  await transactionDone(tx);
  return cloneValue(record || null);
}

export async function putMetaRecord(record) {
  const safeRecord = cloneValue(record);
  if (!safeRecord?.key) return null;

  const db = await openOfflineDb();
  if (!db) {
    memoryFallback.meta.set(safeRecord.key, safeRecord);
    return cloneValue(safeRecord);
  }

  const tx = db.transaction(META_STORE, "readwrite");
  tx.objectStore(META_STORE).put(safeRecord);
  await transactionDone(tx);
  return cloneValue(safeRecord);
}
