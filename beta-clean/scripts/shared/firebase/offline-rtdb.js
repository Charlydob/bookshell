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
  return value === "update" ? "update" : "set";
}

function buildDefaultDedupeKey(writeType, firebasePath) {
  return `${writeType}:${firebasePath}`;
}

async function performDirectWrite(writeType, firebasePath, payload) {
  const safePath = sanitizePath(firebasePath);
  if (!safePath) {
    throw new Error("[offline-rtdb] missing firebase path");
  }

  if (writeType === "update") {
    await update(ref(db, safePath), payload || {});
    return;
  }

  if (payload == null) {
    await remove(ref(db, safePath));
    return;
  }

  await set(ref(db, safePath), payload);
}

export function createOfflinePushId(firebasePath) {
  const safePath = sanitizePath(firebasePath);
  if (!safePath) return "";
  return push(ref(db, safePath)).key || "";
}

export async function writeRtdbWithOfflineQueue({
  uid = auth.currentUser?.uid || "",
  module = "",
  entityType = "",
  actionType = "",
  firebasePath = "",
  payload = null,
  writeType = "set",
  dedupeKey = "",
  metadata = null,
} = {}) {
  const safeUid = String(uid || "").trim();
  const safePath = sanitizePath(firebasePath);
  const safeWriteType = normalizeWriteType(writeType);

  if (!safeUid || !safePath) {
    return { ok: false, queued: false, error: new Error("[offline-rtdb] missing uid or path") };
  }

  if (canWriteDirectly()) {
    try {
      await performDirectWrite(safeWriteType, safePath, payload);
      return { ok: true, queued: false, mode: "direct" };
    } catch (error) {
      console.warn("[offline-rtdb] direct write failed, enqueuing", safePath, error);
    }
  }

  const { operation } = await enqueueOfflineOperation({
    uid: safeUid,
    module,
    entityType,
    actionType,
    firebasePath: safePath,
    payload: cloneValue(payload),
    writeType: safeWriteType,
    dedupeKey: String(dedupeKey || buildDefaultDedupeKey(safeWriteType, safePath)).trim(),
    metadata: metadata && typeof metadata === "object" ? cloneValue(metadata) : null,
  });

  await notifyOfflineQueueChanged();
  return {
    ok: true,
    queued: true,
    mode: "queued",
    operation,
  };
}
