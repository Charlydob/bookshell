import {
  ensureCurrentUserDataRootReady,
  getCurrentUser,
  getCurrentUserAuthUid,
  getCurrentUserDataKey,
  getCurrentUserDataRootKey,
  getCurrentUserEmailKey,
  getCurrentUserId,
  onUserChange,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
} from "../firebase/index.js";

export {
  ensureCurrentUserDataRootReady,
  getCurrentUser,
  getCurrentUserAuthUid,
  getCurrentUserDataKey,
  getCurrentUserDataRootKey,
  getCurrentUserEmailKey,
  getCurrentUserId,
  onUserChange,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
};

export function normalizeFirebaseUser(user = null) {
  if (!user) return null;
  const uid = String(user.uid || "").trim();
  return {
    provider: "firebase",
    id: uid,
    uid,
    authUid: uid,
    email: String(user.email || "").trim(),
    displayName: String(user.displayName || user.email || "").trim(),
    legacyFirebaseUid: uid,
    userDataRootKey: uid,
    firebaseUser: user,
  };
}
