import {webMode,prepareVersionedWrite,applyVersionedWrite} from './versioned-web.js';
import {
  db,
  push,
  ref,
  remove,
  set,
  update,
} from "../data/index.js";
import { auth } from "../auth/index.js";
import { enqueueOfflineOperation, updateOfflineOperation } from "../storage/offline-queue.js";
import {
  canWriteDirectly,
  notifyOfflineQueueChanged,
} from "../services/sync-manager.js";

function sanitizePath(path) {
  return String(path || "")
    .split("/")
    .map((part) => String(part || "").trim())
    .filter(Boolean)
    .join("/");
}

function cloneValue(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeWriteType(value) {
  return ["set", "update", "remove", "push"].includes(value) ? value : "set";
}

function buildClientMutationId() {
  return `cmid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function buildDefaultDedupeKey(writeType, backendPath, payload = null) {
  return `${writeType}:${backendPath}:${JSON.stringify(payload ?? null)}`;
}

async function performDirectWrite(writeType, backendPath, payload) {
  const safePath = sanitizePath(backendPath);
  if (!safePath) throw new Error("[offline-backend] missing backend path");
  if (writeType === "update") return update(ref(db, safePath), payload || {});
  if (writeType === "remove" || payload == null) return remove(ref(db, safePath));
  return set(ref(db, safePath), payload);
}

export function createOfflinePushId(backendPath) {
  const safePath = sanitizePath(backendPath);
  if (!safePath) return "";
  return push(ref(db, safePath)).key || "";
}

export async function writeBackendWithOfflineQueue(input = {}) {
  const safeUid = String(input.uid || auth.currentUser?.uid || "").trim();
  const safeWriteType = normalizeWriteType(input.writeType);
  const basePath = sanitizePath(input.backendPath || input.firebasePath);
  const safePath = safeWriteType === "push" ? sanitizePath(`${basePath}/${input.pushId || createOfflinePushId(basePath)}`) : basePath;
  const payload = cloneValue(input.payload ?? null);
  const clientMutationId = String(input.clientMutationId || buildClientMutationId()).trim();
  if (!safeUid || !safePath) return { ok: false, queued: false, error: new Error("[offline-backend] missing uid or path") };

  const dedupeKey = String(input.dedupeKey || buildDefaultDedupeKey(safeWriteType, safePath, payload)).trim();
  const metadata = { ...(input.metadata && typeof input.metadata === "object" ? cloneValue(input.metadata) : {}), clientMutationId };

  console.info("[backend:write:start]", { writeType: safeWriteType, path: safePath, clientMutationId });
  let versionedMutation=null,conflict=null;
  try{if(await webMode()!=='legacy')versionedMutation=await prepareVersionedWrite(safeWriteType==='update'?'PATCH':payload==null?'DELETE':'PUT',safePath,payload);}
  catch(error){conflict=error;}
  if(versionedMutation)metadata.versionedMutation=versionedMutation;
  if (canWriteDirectly()&&!conflict) {
    try {
      if(versionedMutation)await applyVersionedWrite(versionedMutation);else await performDirectWrite(safeWriteType, safePath, payload);
      console.info("[backend:write:done]", { writeType: safeWriteType, path: safePath, clientMutationId });
      return { ok: true, queued: false, mode: "direct", clientMutationId, path: safePath };
    } catch (error) {
      if([409,428].includes(error.status))conflict=error;
      console.warn("[backend:write:queued]", { path: safePath, error: String(error?.message || error || "") });
    }
  }

  const { operation, replaced } = await enqueueOfflineOperation({
    uid: safeUid,
    module: input.module || "",
    entityType: input.entityType || "",
    actionType: input.actionType || "",
    backendPath: safePath,
    payload,
    writeType: safeWriteType === "remove" ? "set" : safeWriteType,
    dedupeKey,
    metadata,
  });
  if(conflict){await updateOfflineOperation(operation.opId,{status:"conflict",lastError:conflict.message});globalThis.dispatchEvent?.(new Event("bookshell:offline-conflicts"));}
  console.info("[offline:queue:add]", { opId: operation?.opId, replaced, path: safePath, clientMutationId });
  await notifyOfflineQueueChanged();
  return { ok: !conflict, conflict:!!conflict, error:conflict, queued: true, mode: conflict?"conflict":"queued", operation, clientMutationId, path: safePath };
}

export const writeRtdbWithOfflineQueue = writeBackendWithOfflineQueue;
