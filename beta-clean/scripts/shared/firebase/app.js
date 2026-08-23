import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { DATA_PROVIDER } from "../data/config.js";
import { firebaseConfig } from "./config.js";

function getOrCreateFirebaseApp() {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export const firebaseApp = getOrCreateFirebaseApp();
export const auth = { currentUser: null };
export const db = DATA_PROVIDER === "api"
  ? Object.freeze({ provider: "firebase-rtdb-forbidden" })
  : (await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js")).getDatabase(firebaseApp);

let storageInstance = null;

export async function getStorageService() {
  if (storageInstance) return storageInstance;
  const { getStorage } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js");
  storageInstance = getStorage(firebaseApp);
  return storageInstance;
}
