import {
  deleteOperationFromDb,
  getOperationFromDb,
  listOperationsFromDb,
  putOperationInDb,
} from "./offline-db.js?v=2026-04-05-v5";

export const OFFLINE_OPERATION_STATUS = Object.freeze({
  PENDING: "pending",
  SYNCING: "syncing",
  SYNCED: "synced",
  FAILED: "failed",
});

const ACTIVE_STATUSES = new Set([
  OFFLINE_OPERATION_STATUS.PENDING,
  OFFLINE_OPERATION_STATUS.SYNCING,
  OFFLINE_OPERATION_STATUS.FAILED,
]);

let operationsCache = [];
let queueCacheReady = false;
let queueCachePromise = null;

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function splitPath(path) {
  return String(path || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean);
}

function sanitizePath(path) {
  return splitPath(path).join("/");
}

function getNowTs() {
  return Date.now();
}

function createOperationId() {
  const now = getNowTs().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `op-${now}-${rand}`;
}

function computeRetryDelay(attempts = 0) {
  const safeAttempts = Math.max(0, Math.floor(Number(attempts) || 0));
  return Math.min(5 * 60 * 1000, 1000 * (2 ** safeAttempts));
}

function compareOperations(a, b) {
  const createdDiff = (Number(a?.createdAt) || 0) - (Number(b?.createdAt) || 0);
  if (createdDiff) return createdDiff;
  return String(a?.opId || "").localeCompare(String(b?.opId || ""));
}

function normalizeWriteType(value) {
  return value === "update" ? "update" : "set";
}

function mergeUpdatePayload(existingPayload, nextPayload) {
  if (!existingPayload || typeof existingPayload !== "object") {
    return cloneValue(nextPayload || {});
  }
  if (!nextPayload || typeof nextPayload !== "object") {
    return cloneValue(existingPayload);
  }
  return { ...cloneValue(existingPayload), ...cloneValue(nextPayload) };
}

function normalizeOperation(input = {}) {
  const now = getNowTs();
  const opId = String(input.opId || createOperationId()).trim();
  const writeType = normalizeWriteType(input.writeType);
  const firebasePath = sanitizePath(input.firebasePath);
  const createdAt = Number(input.createdAt) || now;
  const updatedAt = Number(input.updatedAt) || now;
  const attempts = Math.max(0, Math.floor(Number(input.attempts) || 0));
  const status = Object.values(OFFLINE_OPERATION_STATUS).includes(input.status)
    ? input.status
    : OFFLINE_OPERATION_STATUS.PENDING;
  const dedupeKey = String(
    input.dedupeKey
    || `${writeType}:${firebasePath}`
  ).trim();

  return {
    opId,
    uid: String(input.uid || "").trim(),
    module: String(input.module || "").trim(),
    entityType: String(input.entityType || "").trim(),
    actionType: String(input.actionType || "").trim(),
    writeType,
    firebasePath,
    payload: cloneValue(writeType === "set" ? input.payload ?? null : (input.payload || {})),
    createdAt,
    updatedAt,
    status,
    attempts,
    nextRetryAt: Number(input.nextRetryAt) || 0,
    dedupeKey,
    metadata: input.metadata && typeof input.metadata === "object" ? cloneValue(input.metadata) : null,
    lastError: String(input.lastError || "").trim(),
  };
}

function replaceCachedOperation(operation) {
  const index = operationsCache.findIndex((entry) => entry.opId === operation.opId);
  if (index >= 0) {
    operationsCache.splice(index, 1, cloneValue(operation));
  } else {
    operationsCache.push(cloneValue(operation));
  }
  operationsCache.sort(compareOperations);
}

function removeCachedOperation(opId) {
  operationsCache = operationsCache.filter((entry) => entry.opId !== opId);
}

function isSamePathOperation(operation, uid, firebasePath) {
  return (
    operation?.uid === uid
    && sanitizePath(operation?.firebasePath) === sanitizePath(firebasePath)
    && ACTIVE_STATUSES.has(operation?.status)
  );
}

function shouldAutoReplaceOperation(existingOperation, nextOperation) {
  if (!existingOperation || !nextOperation) return false;
  if (!ACTIVE_STATUSES.has(existingOperation.status)) return false;
  if (existingOperation.uid !== nextOperation.uid) return false;
  if (existingOperation.dedupeKey !== nextOperation.dedupeKey) return false;
  return true;
}

function applySetAtPath(baseValue, segments, payload) {
  if (!segments.length) {
    return cloneValue(payload);
  }

  const root = (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue))
    ? cloneValue(baseValue)
    : {};
  let cursor = root;

  for (let index = 0; index < segments.length - 1; index += 1) {
    const key = segments[index];
    const next = cursor[key];
    if (!next || typeof next !== "object" || Array.isArray(next)) {
      cursor[key] = {};
    } else {
      cursor[key] = cloneValue(next);
    }
    cursor = cursor[key];
  }

  const leafKey = segments[segments.length - 1];
  if (payload == null) {
    delete cursor[leafKey];
  } else {
    cursor[leafKey] = cloneValue(payload);
  }

  return root;
}

function applyUpdateAtPath(baseValue, segments, payload) {
  const root = segments.length
    ? applySetAtPath(baseValue, segments, {})
    : ((baseValue && typeof baseValue === "object" && !Array.isArray(baseValue))
      ? cloneValue(baseValue)
      : {});

  const updates = payload && typeof payload === "object" ? payload : {};
  let nextValue = root;

  Object.entries(updates).forEach(([relativePath, relativePayload]) => {
    const fullSegments = [...segments, ...splitPath(relativePath)];
    nextValue = applySetAtPath(nextValue, fullSegments, relativePayload);
  });

  return nextValue;
}

function applyOperationToValue(baseValue, basePath, operation) {
  const safeBasePath = sanitizePath(basePath);
  const safeOpPath = sanitizePath(operation?.firebasePath);
  if (!safeBasePath || !safeOpPath) return cloneValue(baseValue);
  if (!(safeOpPath === safeBasePath || safeOpPath.startsWith(`${safeBasePath}/`))) {
    return cloneValue(baseValue);
  }

  const relativePath = safeOpPath.slice(safeBasePath.length).replace(/^\/+/, "");
  const relativeSegments = splitPath(relativePath);

  if (operation.writeType === "update") {
    return applyUpdateAtPath(baseValue, relativeSegments, operation.payload || {});
  }

  return applySetAtPath(baseValue, relativeSegments, operation.payload ?? null);
}

export async function ensureOfflineQueueCacheReady() {
  if (queueCacheReady) return operationsCache;
  if (queueCachePromise) return queueCachePromise;

  queueCachePromise = listOperationsFromDb()
    .then((operations) => {
      operationsCache = Array.isArray(operations) ? operations.sort(compareOperations) : [];
      queueCacheReady = true;
      return operationsCache;
    })
    .finally(() => {
      queueCachePromise = null;
    });

  return queueCachePromise;
}

export function getOfflineQueueCache() {
  return operationsCache.map(cloneValue);
}

export async function enqueueOfflineOperation(input = {}) {
  await ensureOfflineQueueCacheReady();

  const nextOperation = normalizeOperation({
    ...input,
    status: OFFLINE_OPERATION_STATUS.PENDING,
    updatedAt: getNowTs(),
    attempts: 0,
    lastError: "",
    nextRetryAt: 0,
  });

  const samePathOperations = operationsCache.filter((operation) => isSamePathOperation(operation, nextOperation.uid, nextOperation.firebasePath));
  const isDeleteLike = nextOperation.writeType === "set" && nextOperation.payload == null;

  if (isDeleteLike && samePathOperations.length) {
    await Promise.all(samePathOperations.map((operation) => deleteOperationFromDb(operation.opId)));
    samePathOperations.forEach((operation) => removeCachedOperation(operation.opId));
  }

  const existing = operationsCache.find((operation) => shouldAutoReplaceOperation(operation, nextOperation));
  if (existing) {
    const merged = normalizeOperation({
      ...existing,
      ...nextOperation,
      opId: existing.opId,
      createdAt: existing.createdAt,
      attempts: 0,
      lastError: "",
      nextRetryAt: 0,
      payload: nextOperation.writeType === "update"
        ? mergeUpdatePayload(existing.payload, nextOperation.payload)
        : cloneValue(nextOperation.payload),
    });
    await putOperationInDb(merged);
    replaceCachedOperation(merged);
    return { operation: merged, replaced: true };
  }

  await putOperationInDb(nextOperation);
  replaceCachedOperation(nextOperation);
  return { operation: nextOperation, replaced: false };
}

export async function deleteOfflineOperation(opId) {
  await deleteOperationFromDb(opId);
  removeCachedOperation(String(opId || "").trim());
}

export async function getOfflineOperation(opId) {
  await ensureOfflineQueueCacheReady();
  const cached = operationsCache.find((operation) => operation.opId === opId);
  if (cached) return cloneValue(cached);
  return getOperationFromDb(opId);
}

export async function updateOfflineOperation(opId, patch = {}) {
  const current = await getOfflineOperation(opId);
  if (!current) return null;
  const merged = normalizeOperation({
    ...current,
    ...patch,
    opId: current.opId,
    createdAt: current.createdAt,
  });
  await putOperationInDb(merged);
  replaceCachedOperation(merged);
  return merged;
}

export async function markOfflineOperationSyncing(opId) {
  return updateOfflineOperation(opId, {
    status: OFFLINE_OPERATION_STATUS.SYNCING,
    updatedAt: getNowTs(),
  });
}

export async function markOfflineOperationSynced(opId) {
  return updateOfflineOperation(opId, {
    status: OFFLINE_OPERATION_STATUS.SYNCED,
    updatedAt: getNowTs(),
    lastError: "",
    nextRetryAt: 0,
  });
}

export async function markOfflineOperationFailed(opId, errorMessage = "") {
  const current = await getOfflineOperation(opId);
  if (!current) return null;
  const nextAttempts = Math.max(0, Math.floor(Number(current.attempts) || 0)) + 1;
  return updateOfflineOperation(opId, {
    status: OFFLINE_OPERATION_STATUS.FAILED,
    attempts: nextAttempts,
    updatedAt: getNowTs(),
    lastError: String(errorMessage || "").trim(),
    nextRetryAt: getNowTs() + computeRetryDelay(nextAttempts),
  });
}

export async function reviveInterruptedOfflineOperations() {
  await ensureOfflineQueueCacheReady();
  const syncingOperations = operationsCache.filter(
    (operation) => operation.status === OFFLINE_OPERATION_STATUS.SYNCING,
  );

  if (!syncingOperations.length) return 0;

  await Promise.all(syncingOperations.map((operation) => updateOfflineOperation(operation.opId, {
    status: OFFLINE_OPERATION_STATUS.PENDING,
    updatedAt: getNowTs(),
    lastError: "",
    nextRetryAt: 0,
  })));

  return syncingOperations.length;
}

export async function pruneSyncedOfflineOperations({ maxAgeMs = 6 * 60 * 60 * 1000 } = {}) {
  await ensureOfflineQueueCacheReady();
  const now = getNowTs();
  const targets = operationsCache.filter((operation) => {
    if (operation.status !== OFFLINE_OPERATION_STATUS.SYNCED) return false;
    return now - (Number(operation.updatedAt) || 0) > maxAgeMs;
  });

  if (!targets.length) return 0;
  await Promise.all(targets.map((operation) => deleteOperationFromDb(operation.opId)));
  targets.forEach((operation) => removeCachedOperation(operation.opId));
  return targets.length;
}

export async function listOfflineOperations({ uid = "", statuses = null, includeSynced = false } = {}) {
  await ensureOfflineQueueCacheReady();
  const safeUid = String(uid || "").trim();
  const allowedStatuses = Array.isArray(statuses) && statuses.length
    ? new Set(statuses)
    : null;

  return operationsCache
    .filter((operation) => {
      if (safeUid && operation.uid !== safeUid) return false;
      if (!includeSynced && operation.status === OFFLINE_OPERATION_STATUS.SYNCED) return false;
      if (allowedStatuses && !allowedStatuses.has(operation.status)) return false;
      return true;
    })
    .sort(compareOperations)
    .map(cloneValue);
}

export async function listRetryableOfflineOperations(uid = "", now = getNowTs()) {
  const operations = await listOfflineOperations({
    uid,
    statuses: [
      OFFLINE_OPERATION_STATUS.PENDING,
      OFFLINE_OPERATION_STATUS.FAILED,
    ],
  });

  return operations.filter((operation) => {
    if (operation.status === OFFLINE_OPERATION_STATUS.PENDING) return true;
    return (Number(operation.nextRetryAt) || 0) <= now;
  });
}

export async function getOfflineQueueSummary(uid = "") {
  const operations = await listOfflineOperations({ uid, includeSynced: false });
  return operations.reduce((summary, operation) => {
    summary.total += 1;
    if (operation.status === OFFLINE_OPERATION_STATUS.SYNCING) summary.syncing += 1;
    else if (operation.status === OFFLINE_OPERATION_STATUS.FAILED) summary.failed += 1;
    else summary.pending += 1;
    return summary;
  }, {
    total: 0,
    pending: 0,
    syncing: 0,
    failed: 0,
  });
}

export function applyQueuedWritesToPath(basePath, value, { uid = "" } = {}) {
  const safeUid = String(uid || "").trim();
  if (!safeUid || !queueCacheReady) return cloneValue(value);

  const operations = operationsCache
    .filter((operation) => {
      if (operation.uid !== safeUid) return false;
      return ACTIVE_STATUSES.has(operation.status);
    })
    .sort(compareOperations);

  return operations.reduce((nextValue, operation) => {
    return applyOperationToValue(nextValue, basePath, operation);
  }, cloneValue(value));
}
