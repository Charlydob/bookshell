import { AUTH_PROVIDER, SIGNUP_ENABLED } from "./config.js";
import * as apiAuth from "./api-auth.js";

const listeners = new Set();

const state = {
  provider: AUTH_PROVIDER,
  activeProvider: "",
  apiUser: null,
  currentUser: null,
  initialized: false,
  initPromise: null,
};

export const auth = {
  get currentUser() {
    return state.currentUser;
  },
  login(email, password) {
    return login(email, password);
  },
  logout() {
    return logout();
  },
};

function hasLegacyFirebaseUid(user = null) {
  return Boolean(String(user?.legacyFirebaseUid || user?.userDataRootKey || "").trim());
}

function normalizeActiveApiUser(user = null) {
  if (!user || !hasLegacyFirebaseUid(user)) return null;
  const legacyFirebaseUid = String(user.legacyFirebaseUid || user.userDataRootKey || "").trim();
  return {
    ...user,
    provider: "api",
    uid: legacyFirebaseUid,
    userDataRootKey: legacyFirebaseUid,
  };
}

function emitAuthDebug() {
  const current = state.currentUser;
  console.log("[auth]", {
    provider: state.activeProvider || "",
    configuredProvider: AUTH_PROVIDER,
    apiSession: !!state.apiUser,
    legacyFirebaseUid: current?.legacyFirebaseUid || current?.userDataRootKey || "",
  });
}

function setCurrentUser(user = null) {
  const previousKey = `${state.currentUser?.provider || ""}:${state.currentUser?.id || ""}:${state.currentUser?.uid || ""}`;
  state.currentUser = user;
  state.activeProvider = user?.provider || "";
  const nextKey = `${state.currentUser?.provider || ""}:${state.currentUser?.id || ""}:${state.currentUser?.uid || ""}`;
  emitAuthDebug();
  if (previousKey === nextKey) return;
  listeners.forEach((callback) => {
    try {
      callback(state.currentUser);
    } catch (error) {
      console.warn("[auth] listener failed", error);
    }
  });
}

function refreshActiveUser() {
  setCurrentUser(normalizeActiveApiUser(state.apiUser));
}

async function refreshApiSession({ quiet = false } = {}) {
  try {
    state.apiUser = await apiAuth.getSession();
    if (state.apiUser && !hasLegacyFirebaseUid(state.apiUser)) {
      console.warn("[auth] API session ignored for Firebase data: /auth/me must return legacyFirebaseUid.");
    }
    return state.apiUser;
  } catch (error) {
    state.apiUser = null;
    if (!quiet) console.warn("[auth] API session check failed", error);
    return null;
  }
}

export async function getSession() {
  if (state.initPromise) return state.initPromise;
  if (state.initialized) return state.currentUser;

  state.initPromise = (async () => {
    await refreshApiSession({ quiet: true });
    state.initialized = true;
    refreshActiveUser();
    return state.currentUser;
  })().finally(() => {
    state.initPromise = null;
  });

  return state.initPromise;
}

export function onAuthChange(callback) {
  if (typeof callback !== "function") return () => {};
  listeners.add(callback);
  void getSession().then(() => callback(state.currentUser));
  return () => {
    listeners.delete(callback);
  };
}

export const onUserChange = onAuthChange;

export async function login(email, password) {
  state.apiUser = await apiAuth.login(email, password);
  if (!hasLegacyFirebaseUid(state.apiUser)) {
    state.apiUser = null;
    refreshActiveUser();
    throw new Error("La API ha iniciado sesion, pero /auth/me no devuelve legacyFirebaseUid para cargar tus datos Firebase.");
  }
  refreshActiveUser();
  return state.currentUser;
}

export async function logout() {
  await apiAuth.logout();
  state.apiUser = null;
  refreshActiveUser();
}

export async function getCurrentUser() {
  await getSession();
  return state.currentUser;
}

export function getCurrentUserId() {
  return state.currentUser?.id || state.currentUser?.uid || null;
}

export function getCurrentUserAuthUid() {
  return state.currentUser?.authUid || state.currentUser?.id || state.currentUser?.uid || null;
}

export function getCurrentUserDataKey() {
  return state.currentUser?.userDataRootKey || state.currentUser?.legacyFirebaseUid || state.currentUser?.uid || null;
}

export const getCurrentUserDataRootKey = getCurrentUserDataKey;

export function getCurrentUserEmailKey() {
  return state.currentUser?.email || "";
}

export function getUserDataKey(user = null) {
  const target = user || state.currentUser;
  return target?.userDataRootKey || target?.legacyFirebaseUid || target?.uid || "";
}

export const getUserDataRootKey = getUserDataKey;

export async function ensureCurrentUserDataRootReady() {
  await getSession();
  if (!state.currentUser) return null;
  if (!getCurrentUserDataRootKey()) {
    throw new Error("La sesion API no incluye legacyFirebaseUid; no se puede resolver la raiz Firebase.");
  }
  return {
    uid: state.currentUser.id,
    authUid: state.currentUser.id,
    userDataRootKey: getCurrentUserDataRootKey(),
    userRootKey: getCurrentUserDataRootKey(),
  };
}

export function signInWithEmail(email, password) {
  return login(email, password);
}

export function signOutCurrentUser() {
  return logout();
}

export function signUpWithEmail() {
  return Promise.reject(new Error("Registro deshabilitado: la autenticacion se gestiona exclusivamente desde la API."));
}

export { AUTH_PROVIDER, SIGNUP_ENABLED } from "./config.js";
