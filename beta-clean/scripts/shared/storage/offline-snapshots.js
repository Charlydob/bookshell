import {
  getSnapshotRecord,
  putSnapshotRecord,
} from "./offline-db.js?v=2026-04-05-v5";
import { registerCacheMetric } from "../firebase/read-debug.js";

function buildSnapshotKey(moduleName, uid) {
  const safeModule = String(moduleName || "").trim();
  const safeUid = String(uid || "").trim();
  if (!safeModule || !safeUid) return "";
  return `${safeModule}:${safeUid}`;
}

function estimateRecordBytes(record = null) {
  try {
    const payload = typeof record === "string" ? record : JSON.stringify(record ?? null);
    if (typeof TextEncoder === "function") {
      return new TextEncoder().encode(payload).length;
    }
    return payload.length;
  } catch (_) {
    return 0;
  }
}

export async function readModuleSnapshot({ moduleName, uid }) {
  const key = buildSnapshotKey(moduleName, uid);
  if (!key) return null;
  const record = await getSnapshotRecord(key);
  if (record?.data) {
    registerCacheMetric({
      module: moduleName,
      key,
      bytes: estimateRecordBytes(record),
      storage: "indexedDB",
      reason: "snapshot-read",
    });
  }
  return record?.data ? record : null;
}

export async function writeModuleSnapshot({ moduleName, uid, data, updatedAt = Date.now(), metadata = null }) {
  const key = buildSnapshotKey(moduleName, uid);
  if (!key) return null;
  const record = {
    key,
    moduleName: String(moduleName || "").trim(),
    uid: String(uid || "").trim(),
    updatedAt: Number(updatedAt) || Date.now(),
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : null,
    data,
  };
  const result = await putSnapshotRecord(record);
  registerCacheMetric({
    module: moduleName,
    key,
    bytes: estimateRecordBytes(record),
    storage: "indexedDB",
    reason: "snapshot-write",
  });
  return result;
}
