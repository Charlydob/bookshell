import {
  getSnapshotRecord,
  putSnapshotRecord,
} from "./offline-db.js?v=2026-04-05-v5";

function buildSnapshotKey(moduleName, uid) {
  const safeModule = String(moduleName || "").trim();
  const safeUid = String(uid || "").trim();
  if (!safeModule || !safeUid) return "";
  return `${safeModule}:${safeUid}`;
}

export async function readModuleSnapshot({ moduleName, uid }) {
  const key = buildSnapshotKey(moduleName, uid);
  if (!key) return null;
  const record = await getSnapshotRecord(key);
  return record?.data ? record : null;
}

export async function writeModuleSnapshot({ moduleName, uid, data, updatedAt = Date.now(), metadata = null }) {
  const key = buildSnapshotKey(moduleName, uid);
  if (!key) return null;
  return putSnapshotRecord({
    key,
    moduleName: String(moduleName || "").trim(),
    uid: String(uid || "").trim(),
    updatedAt: Number(updatedAt) || Date.now(),
    metadata: metadata && typeof metadata === "object" ? { ...metadata } : null,
    data,
  });
}
