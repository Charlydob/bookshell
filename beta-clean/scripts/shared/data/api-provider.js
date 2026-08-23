import { API_BASE_URL } from "./config.js";
export { logDataUsage, DATA_USAGE_OPERATIONS } from "./data-usage.js";

export const providerName = "api";
export const db = null;
export const firebasePaths = Object.freeze({});
export const PUBLIC_PATHS = Object.freeze({});

function notImplemented(name) {
  return () => {
    throw new Error(`[data:api] ${name} is not implemented yet. Base URL: ${API_BASE_URL}`);
  };
}

// Future API implementation should preserve these data method names so modules
// can move one at a time without changing their database call sites.
export const readOnce = notImplemented("readOnce");
export const readValue = notImplemented("readValue");
export const listen = notImplemented("listen");
export const listenValue = notImplemented("listenValue");
export const writeValue = notImplemented("writeValue");
export const patchValue = notImplemented("patchValue");
export const deleteValue = notImplemented("deleteValue");
export const createKey = notImplemented("createKey");
export const createRecord = notImplemented("createRecord");
export const runValueTransaction = notImplemented("runValueTransaction");

export const get = notImplemented("get");
export const onValue = notImplemented("onValue");
export const push = notImplemented("push");
export const ref = notImplemented("ref");
export const remove = notImplemented("remove");
export const runTransaction = notImplemented("runTransaction");
export const set = notImplemented("set");
export const update = notImplemented("update");
export const query = notImplemented("query");
export const orderByChild = notImplemented("orderByChild");
export const startAt = notImplemented("startAt");
export const endAt = notImplemented("endAt");
export const limitToFirst = notImplemented("limitToFirst");

export const getStorageService = notImplemented("getStorageService");
