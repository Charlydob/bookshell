export { firebaseConfig, FIREBASE_MODULE_URLS, FIREBASE_SDK_VERSION } from "./config.js";
export { firebaseApp, auth, db, getStorageService } from "./app.js";
export {
  ensureCurrentUserDataRootReady,
  getCurrentUserAuthUid,
  getCurrentUserDataRootKey,
  getCurrentUser,
  getCurrentUserDataKey,
  getCurrentUserEmailKey,
  getCurrentUserId,
  onUserChange,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
} from "./auth.js";
export { getDbRef, getUserRootDbPath, getUserRootDbRef } from "./database.js";
export { firebasePaths, PUBLIC_PATHS, buildUserDataContext, getAuthUid, getEmailKey, getUserDataKey, getUserDataRootKey, sanitizeRtdbKeyPart } from "./rtdb-paths.js";
export { ensureUserDataRootReady } from "./user-data.js";
