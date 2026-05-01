import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { auth } from "./app.js";
import { getUserDataKey } from "./rtdb-paths.js";
import { ensureUserDataRootReady } from "./user-data.js";

export function signUpWithEmail(email, password) {
  return createUserWithEmailAndPassword(auth, email, password);
}

export function signInWithEmail(email, password) {
  return signInWithEmailAndPassword(auth, email, password);
}

export function signOutCurrentUser() {
  return signOut(auth);
}

export function onUserChange(callback) {
  return onAuthStateChanged(auth, async (user) => {
    if (user) {
      try {
        await ensureUserDataRootReady(user);
      } catch (_) {}
    }
    return callback(user);
  });
}

export function getCurrentUser() {
  return auth.currentUser;
}

export function getCurrentUserId() {
  return auth.currentUser?.uid ?? null;
}

export function getCurrentUserDataKey() {
  return getUserDataKey(auth.currentUser);
}

export function ensureCurrentUserDataRootReady() {
  return ensureUserDataRootReady(auth.currentUser);
}
