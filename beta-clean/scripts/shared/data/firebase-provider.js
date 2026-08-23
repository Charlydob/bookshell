import {
  get as firebaseGet,
  limitToFirst as firebaseLimitToFirst,
  onValue as firebaseOnValue,
  orderByChild as firebaseOrderByChild,
  push as firebasePush,
  query as firebaseQuery,
  ref as firebaseRef,
  remove as firebaseRemove,
  runTransaction as firebaseRunTransaction,
  set as firebaseSet,
  startAt as firebaseStartAt,
  endAt as firebaseEndAt,
  update as firebaseUpdate,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { logDataUsage } from "./data-usage.js";
import {
  db,
  firebasePaths,
  getStorageService,
  PUBLIC_PATHS,
} from "../firebase/index.js";

export const providerName = "firebase";

function trimSlashes(value = "") {
  return String(value || "").trim().replace(/^\/+|\/+$/g, "");
}

function resolveTarget(pathOrRef = "") {
  if (pathOrRef && typeof pathOrRef === "object") return pathOrRef;
  return firebaseRef(db, String(pathOrRef || ""));
}

function getTelemetryUserId() {
  return "";
}

function getPathFromUrl(value = "") {
  const safe = String(value || "").trim();
  if (!safe) return "";
  try {
    const url = new URL(safe);
    return trimSlashes(decodeURIComponent(url.pathname || "").replace(/\.json$/i, ""));
  } catch (_) {
    return trimSlashes(safe.split("?")[0]);
  }
}

function resolveLogicalPath(pathOrRef = "") {
  if (typeof pathOrRef === "string") return trimSlashes(pathOrRef);
  if (!pathOrRef || typeof pathOrRef !== "object") return "";
  const fromKeyPath = Array.isArray(pathOrRef?._path?.pieces_)
    ? pathOrRef._path.pieces_.join("/")
    : "";
  if (fromKeyPath) return trimSlashes(fromKeyPath);
  const fromRefKeyPath = Array.isArray(pathOrRef?.ref?._path?.pieces_)
    ? pathOrRef.ref._path.pieces_.join("/")
    : "";
  if (fromRefKeyPath) return trimSlashes(fromRefKeyPath);
  if (typeof pathOrRef.toString === "function") return getPathFromUrl(pathOrRef.toString());
  return "";
}

function joinPath(basePath = "", childPath = "") {
  return [trimSlashes(basePath), trimSlashes(childPath)].filter(Boolean).join("/");
}

function logUsage(operation = "", pathOrRef = "") {
  const path = resolveLogicalPath(pathOrRef);
  if (!path) return;
  logDataUsage({
    userId: getTelemetryUserId(),
    path,
    operation,
  });
}

function logPatchUsage(operation = "UPDATE", pathOrRef = "", patch = {}) {
  const basePath = resolveLogicalPath(pathOrRef);
  const entries = patch && typeof patch === "object" && !Array.isArray(patch)
    ? Object.keys(patch)
    : [];
  if (!entries.length) {
    logUsage(operation, basePath);
    return;
  }
  entries.slice(0, 50).forEach((childPath) => {
    logDataUsage({
      userId: getTelemetryUserId(),
      path: joinPath(basePath, childPath),
      operation,
    });
  });
  if (entries.length > 50) {
    logDataUsage({
      userId: getTelemetryUserId(),
      path: joinPath(basePath, "__batch_truncated__"),
      operation,
    });
  }
}

export function readOnce(pathOrQuery) {
  logUsage("READ", pathOrQuery);
  return firebaseGet(resolveTarget(pathOrQuery));
}

export async function readValue(pathOrQuery) {
  const snap = await readOnce(pathOrQuery);
  return snap.val();
}

export function listen(pathOrQuery, callback, onError) {
  logUsage("LISTEN", pathOrQuery);
  return firebaseOnValue(resolveTarget(pathOrQuery), callback, onError);
}

export function listenValue(pathOrQuery, callback, onError) {
  return listen(pathOrQuery, (snap) => callback?.(snap.val(), snap), onError);
}

export function writeValue(pathOrRef, payload) {
  logUsage("WRITE", pathOrRef);
  return firebaseSet(resolveTarget(pathOrRef), payload);
}

export function patchValue(pathOrRef, patch = {}) {
  logPatchUsage("UPDATE", pathOrRef, patch);
  return firebaseUpdate(resolveTarget(pathOrRef), patch || {});
}

export function deleteValue(pathOrRef) {
  logUsage("DELETE", pathOrRef);
  return firebaseRemove(resolveTarget(pathOrRef));
}

export function createKey(path = "") {
  return firebasePush(firebaseRef(db, String(path || ""))).key || "";
}

export async function createRecord(path = "", payload = {}) {
  const target = firebasePush(firebaseRef(db, String(path || "")));
  logUsage("CREATE", target);
  await firebaseSet(target, payload);
  return target.key || "";
}

export function runValueTransaction(pathOrRef, updater) {
  logUsage("TRANSACTION", pathOrRef);
  return firebaseRunTransaction(resolveTarget(pathOrRef), updater);
}

export function get(pathOrQuery) {
  logUsage("READ", pathOrQuery);
  return firebaseGet(resolveTarget(pathOrQuery));
}

export function onValue(pathOrQuery, callback, onError) {
  logUsage("LISTEN", pathOrQuery);
  return firebaseOnValue(resolveTarget(pathOrQuery), callback, onError);
}

export function push(pathOrRef, value) {
  const target = firebasePush(resolveTarget(pathOrRef), value);
  logUsage("CREATE", target);
  return target;
}
export const ref = firebaseRef;

export function remove(pathOrRef) {
  logUsage("DELETE", pathOrRef);
  return firebaseRemove(resolveTarget(pathOrRef));
}

export function runTransaction(pathOrRef, updater) {
  logUsage("TRANSACTION", pathOrRef);
  return firebaseRunTransaction(resolveTarget(pathOrRef), updater);
}

export function set(pathOrRef, payload) {
  logUsage("WRITE", pathOrRef);
  return firebaseSet(resolveTarget(pathOrRef), payload);
}

export function update(pathOrRef, patch = {}) {
  logPatchUsage("UPDATE", pathOrRef, patch);
  return firebaseUpdate(resolveTarget(pathOrRef), patch || {});
}

export const query = firebaseQuery;
export const orderByChild = firebaseOrderByChild;
export const startAt = firebaseStartAt;
export const endAt = firebaseEndAt;
export const limitToFirst = firebaseLimitToFirst;

export {
  db,
  firebasePaths,
  getStorageService,
  PUBLIC_PATHS,
};
