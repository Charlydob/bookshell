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
import {
  auth,
  db,
  ensureCurrentUserDataRootReady,
  firebasePaths,
  getAuthUid,
  getCurrentUser,
  getCurrentUserAuthUid,
  getCurrentUserDataKey,
  getCurrentUserDataRootKey,
  getCurrentUserEmailKey,
  getCurrentUserId,
  getEmailKey,
  getStorageService,
  getUserDataKey,
  getUserDataRootKey,
  onUserChange,
  PUBLIC_PATHS,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
} from "../firebase/index.js";

export const providerName = "firebase";

function resolveTarget(pathOrRef = "") {
  if (pathOrRef && typeof pathOrRef === "object") return pathOrRef;
  return firebaseRef(db, String(pathOrRef || ""));
}

export function getCurrentUserContext(user = auth.currentUser) {
  const targetUser = user || auth.currentUser;
  return {
    user: targetUser,
    authUid: getAuthUid(targetUser) || getCurrentUserAuthUid(),
    uid: getUserDataKey(targetUser),
    userDataRootKey: getUserDataRootKey(targetUser),
    emailKey: getEmailKey(targetUser) || getCurrentUserEmailKey(),
  };
}

export function readOnce(pathOrQuery) {
  return firebaseGet(resolveTarget(pathOrQuery));
}

export async function readValue(pathOrQuery) {
  const snap = await readOnce(pathOrQuery);
  return snap.val();
}

export function listen(pathOrQuery, callback, onError) {
  return firebaseOnValue(resolveTarget(pathOrQuery), callback, onError);
}

export function listenValue(pathOrQuery, callback, onError) {
  return listen(pathOrQuery, (snap) => callback?.(snap.val(), snap), onError);
}

export function writeValue(pathOrRef, payload) {
  return firebaseSet(resolveTarget(pathOrRef), payload);
}

export function patchValue(pathOrRef, patch = {}) {
  return firebaseUpdate(resolveTarget(pathOrRef), patch || {});
}

export function deleteValue(pathOrRef) {
  return firebaseRemove(resolveTarget(pathOrRef));
}

export function createKey(path = "") {
  return firebasePush(firebaseRef(db, String(path || ""))).key || "";
}

export async function createRecord(path = "", payload = {}) {
  const target = firebasePush(firebaseRef(db, String(path || "")));
  await firebaseSet(target, payload);
  return target.key || "";
}

export function runValueTransaction(pathOrRef, updater) {
  return firebaseRunTransaction(resolveTarget(pathOrRef), updater);
}

export const get = firebaseGet;
export const onValue = firebaseOnValue;
export const push = firebasePush;
export const ref = firebaseRef;
export const remove = firebaseRemove;
export const runTransaction = firebaseRunTransaction;
export const set = firebaseSet;
export const update = firebaseUpdate;
export const query = firebaseQuery;
export const orderByChild = firebaseOrderByChild;
export const startAt = firebaseStartAt;
export const endAt = firebaseEndAt;
export const limitToFirst = firebaseLimitToFirst;

export {
  auth,
  db,
  ensureCurrentUserDataRootReady,
  firebasePaths,
  getCurrentUser,
  getCurrentUserAuthUid,
  getCurrentUserDataKey,
  getCurrentUserDataRootKey,
  getCurrentUserId,
  getStorageService,
  getUserDataKey,
  getUserDataRootKey,
  onUserChange,
  PUBLIC_PATHS,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
};
