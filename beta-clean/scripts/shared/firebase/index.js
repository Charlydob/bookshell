export { firebaseConfig, FIREBASE_MODULE_URLS, FIREBASE_SDK_VERSION } from "./config.js";
export { firebaseApp, auth, db, storage } from "./app.js";
export {
  getCurrentUser,
  getCurrentUserId,
  onUserChange,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
} from "./auth.js";
export { getDbRef, getUserRootDbPath, getUserRootDbRef } from "./database.js";
