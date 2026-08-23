export { firebaseConfig, FIREBASE_MODULE_URLS, FIREBASE_SDK_VERSION } from "./config.js";
export { firebaseApp, db, getStorageService } from "./app.js";
export { getDbRef, getUserRootDbPath, getUserRootDbRef } from "./database.js";
export { firebasePaths, PUBLIC_PATHS, sanitizeRtdbKeyPart } from "./rtdb-paths.js";
export { ensureUserDataRootReady } from "./user-data.js";
