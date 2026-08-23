import { API_BASE_URL, DATA_PROVIDER } from "./config.js";
import * as apiProvider from "./api-provider.js";
import * as firebaseProvider from "./firebase-provider.js";

const providers = Object.freeze({
  api: apiProvider,
  firebase: firebaseProvider,
});

// This is the single provider selection point for app data access.
export const activeDataProvider = providers[DATA_PROVIDER] || firebaseProvider;
export const activeDataProviderName = activeDataProvider.providerName;
export { API_BASE_URL, DATA_PROVIDER };

export const auth = activeDataProvider.auth;
export const db = activeDataProvider.db;
export const firebasePaths = activeDataProvider.firebasePaths;
export const PUBLIC_PATHS = activeDataProvider.PUBLIC_PATHS;

export const getCurrentUserContext = (...args) => activeDataProvider.getCurrentUserContext(...args);
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

export const ensureCurrentUserDataRootReady = (...args) => activeDataProvider.ensureCurrentUserDataRootReady(...args);
export const getCurrentUser = (...args) => activeDataProvider.getCurrentUser(...args);
export const getCurrentUserAuthUid = (...args) => activeDataProvider.getCurrentUserAuthUid(...args);
export const getCurrentUserDataKey = (...args) => activeDataProvider.getCurrentUserDataKey(...args);
export const getCurrentUserDataRootKey = (...args) => activeDataProvider.getCurrentUserDataRootKey(...args);
export const getCurrentUserId = (...args) => activeDataProvider.getCurrentUserId(...args);
export const getStorageService = (...args) => activeDataProvider.getStorageService(...args);
export const getUserDataKey = (...args) => activeDataProvider.getUserDataKey(...args);
export const getUserDataRootKey = (...args) => activeDataProvider.getUserDataRootKey(...args);
export const onUserChange = (...args) => activeDataProvider.onUserChange(...args);
export const signInWithEmail = (...args) => activeDataProvider.signInWithEmail(...args);
export const signOutCurrentUser = (...args) => activeDataProvider.signOutCurrentUser(...args);
export const signUpWithEmail = (...args) => activeDataProvider.signUpWithEmail(...args);
