import { auth } from "./app.js";
import { getAuthUid, getEmailKey, getUserDataRootKey } from "./rtdb-paths.js";

function disabledFirebaseLogin() {
  return Promise.reject(new Error("Firebase Auth login is disabled. Use shared/auth/api-auth.js through shared/auth/index.js."));
}

export function signUpWithEmail() {
  return disabledFirebaseLogin();
}

export function signInWithEmail() {
  return disabledFirebaseLogin();
}

export function signOutCurrentUser() {
  return disabledFirebaseLogin();
}

export function onUserChange(callback) {
  if (typeof callback !== "function") return () => {};
  queueMicrotask(() => callback(null));
  return () => {};
}

export function getCurrentUser() {
  return null;
}

export function getCurrentUserId() {
  return null;
}

export function getCurrentUserAuthUid() {
  return getAuthUid(auth.currentUser);
}

export function getCurrentUserEmailKey() {
  return getEmailKey(auth.currentUser);
}

export function getCurrentUserDataKey() {
  return getUserDataRootKey(auth.currentUser);
}

export function getCurrentUserDataRootKey() {
  return getUserDataRootKey(auth.currentUser);
}

export function ensureCurrentUserDataRootReady() {
  return Promise.resolve(null);
}
