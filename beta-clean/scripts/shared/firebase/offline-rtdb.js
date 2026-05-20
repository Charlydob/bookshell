import {
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { auth, db } from "./index.js";
import { enqueueOfflineOperation } from "../storage/offline-queue.js?v=2026-04-05-v5";
import {
  canWriteDirectly,
  notifyOfflineQueueChanged,
} from "../services/sync-manager.js?v=2026-04-05-v5";

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

function buildDefaultDedupeKey(writeType, firebasePath, payload = null) {
  return `${writeType}:${firebasePath}:${JSON.stringify(payload ?? null)}`;
}

async function performDirectWrite(writeType, firebasePath, payload) {
  const safePath = sanitizePath(firebasePath);
  if (!safePath) throw new Error("[offline-rtdb] missing firebase path");
  if (writeType === "update") return update(ref(db, safePath), payload || {});
  if (writeType === "remove" || payload == null) return remove(ref(db, safePath));
  return set(ref(db, safePath), payload);
}

export function createOfflinePushId(firebasePath) {
  const safePath = sanitizePath(firebasePath);
  if (!safePath) return "";
  return push(ref(db, safePath)).key || "";
}

export async function writeRtdbWithOfflineQueue(input = {}) {
  const safeUid = String(input.uid || auth.currentUser?.uid || "").trim();
  const safeWriteType = normalizeWriteType(input.writeType);
  const basePath = sanitizePath(input.firebasePath);
  const safePath = safeWriteType === "push" ? sanitizePath(`${basePath}/${input.pushId || createOfflinePushId(basePath)}`) : basePath;
  const payload = cloneValue(input.payload ?? null);
  const clientMutationId = String(input.clientMutationId || buildClientMutationId()).trim();
  if (!safeUid || !safePath) return { ok: false, queued: false, error: new Error("[offline-rtdb] missing uid or path") };

  const dedupeKey = String(input.dedupeKey || buildDefaultDedupeKey(safeWriteType, safePath, payload)).trim();
  const metadata = { ...(input.metadata && typeof input.metadata === "object" ? cloneValue(input.metadata) : {}), clientMutationId };

  console.info("[firebase:write:start]", { writeType: safeWriteType, path: safePath, clientMutationId });
  if (canWriteDirectly()) {
    try {
      await performDirectWrite(safeWriteType, safePath, payload);
      console.info("[firebase:write:done]", { writeType: safeWriteType, path: safePath, clientMutationId });
      return { ok: true, queued: false, mode: "direct", clientMutationId, path: safePath };
    } catch (error) {
      console.warn("[firebase:write:queued]", { path: safePath, error: String(error?.message || error || "") });
    }
  }

  const { operation, replaced } = await enqueueOfflineOperation({
    uid: safeUid,
    module: input.module || "",
    entityType: input.entityType || "",
    actionType: input.actionType || "",
    firebasePath: safePath,
    payload,
    writeType: safeWriteType === "remove" ? "set" : safeWriteType,
    dedupeKey,
    metadata,
  });
  console.info("[offline:queue:add]", { opId: operation?.opId, replaced, path: safePath, clientMutationId });
  await notifyOfflineQueueChanged();
  return { ok: true, queued: true, mode: "queued", operation, clientMutationId, path: safePath };
}
