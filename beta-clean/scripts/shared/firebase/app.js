import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { firebaseConfig } from "./config.js";

function getOrCreateFirebaseApp() {
  return getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
}

export const firebaseApp = getOrCreateFirebaseApp();
export const auth = { currentUser: null };
export const db = getDatabase(firebaseApp);

let storageInstance = null;

export async function getStorageService() {
  if (storageInstance) return storageInstance;
  const { getStorage } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js");
  storageInstance = getStorage(firebaseApp);
  return storageInstance;
}
