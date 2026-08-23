import { API_BASE_URL, DATA_PROVIDER } from "./config.js";
import * as apiProvider from "./api-provider.js";
export { logDataUsage, DATA_USAGE_OPERATIONS } from "./data-usage.js";

const firebaseProvider = DATA_PROVIDER === "firebase"
  ? await import("./firebase-provider.js")
  : null;

// This is the single provider selection point for app data access.
export const activeDataProvider = DATA_PROVIDER === "firebase" && firebaseProvider
  ? firebaseProvider
  : apiProvider;
export const activeDataProviderName = activeDataProvider.providerName;
export { API_BASE_URL, DATA_PROVIDER };

export const db = activeDataProvider.db;
export const firebasePaths = activeDataProvider.firebasePaths;
export const PUBLIC_PATHS = activeDataProvider.PUBLIC_PATHS;

export const readOnce = (...args) => activeDataProvider.readOnce(...args);
export const readValue = (...args) => activeDataProvider.readValue(...args);
export const listen = (...args) => activeDataProvider.listen(...args);
export const listenValue = (...args) => activeDataProvider.listenValue(...args);
export const writeValue = (...args) => activeDataProvider.writeValue(...args);
export const patchValue = (...args) => activeDataProvider.patchValue(...args);
export const deleteValue = (...args) => activeDataProvider.deleteValue(...args);
export const createKey = (...args) => activeDataProvider.createKey(...args);
export const createRecord = (...args) => activeDataProvider.createRecord(...args);
export const runValueTransaction = (...args) => activeDataProvider.runValueTransaction(...args);

export const get = (...args) => activeDataProvider.get(...args);
export const onValue = (...args) => activeDataProvider.onValue(...args);
export const push = (...args) => activeDataProvider.push(...args);
export const ref = (...args) => activeDataProvider.ref(...args);
export const remove = (...args) => activeDataProvider.remove(...args);
export const runTransaction = (...args) => activeDataProvider.runTransaction(...args);
export const set = (...args) => activeDataProvider.set(...args);
export const update = (...args) => activeDataProvider.update(...args);
export const query = (...args) => activeDataProvider.query(...args);
export const orderByChild = (...args) => activeDataProvider.orderByChild(...args);
export const startAt = (...args) => activeDataProvider.startAt(...args);
export const endAt = (...args) => activeDataProvider.endAt(...args);
export const limitToFirst = (...args) => activeDataProvider.limitToFirst(...args);

export const getStorageService = (...args) => activeDataProvider.getStorageService(...args);
