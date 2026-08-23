import { AUTH_PROVIDER, SIGNUP_ENABLED } from "./config.js";
import * as apiAuth from "./api-auth.js";
import * as firebaseAuth from "./firebase-auth.js";

const listeners = new Set();

const state = {
  provider: AUTH_PROVIDER,
  activeProvider: "",
  apiUser: null,
  firebaseUser: firebaseAuth.normalizeFirebaseUser(firebaseAuth.getCurrentUser()),
  currentUser: null,
  initialized: false,
  initPromise: null,
  firebaseUnsubscribe: null,
};

export const auth = {
  get currentUser() {
    return state.currentUser;
  },
};

function hasLegacyFirebaseUid(user = null) {
  return Boolean(String(user?.legacyFirebaseUid || user?.userDataRootKey || "").trim());
}

function normalizeActiveApiUser(user = null) {
  if (!user || !hasLegacyFirebaseUid(user)) return null;
  return {
    ...user,
    provider: "api",
    uid: String(user.legacyFirebaseUid || user.userDataRootKey || "").trim(),
    userDataRootKey: String(user.legacyFirebaseUid || user.userDataRootKey || "").trim(),
  };
}

function chooseActiveUser() {
  if (AUTH_PROVIDER === "api") {
    return normalizeActiveApiUser(state.apiUser);
  }
  if (AUTH_PROVIDER === "firebase") {
    return state.firebaseUser;
  }
  return normalizeActiveApiUser(state.apiUser) || state.firebaseUser || null;
}

function emitAuthDebug() {
  const current = state.currentUser;
  console.debug("[auth]", {
    provider: state.activeProvider || "",
    configuredProvider: AUTH_PROVIDER,
    apiSession: !!state.apiUser,
    firebaseUid: state.firebaseUser?.uid || "",
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
  setCurrentUser(chooseActiveUser());
}

async function refreshApiSession({ quiet = false } = {}) {
  if (AUTH_PROVIDER === "firebase") return null;
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

function bindFirebaseListener() {
  if (state.firebaseUnsubscribe || AUTH_PROVIDER === "api") return;
  state.firebaseUnsubscribe = firebaseAuth.onUserChange((user) => {
    state.firebaseUser = firebaseAuth.normalizeFirebaseUser(user);
    refreshActiveUser();
  });
}

async function tryEnsureFirebaseDataSession(email, password, expectedUid = "") {
  if (AUTH_PROVIDER === "api") return;
  const safeExpectedUid = String(expectedUid || "").trim();
  const currentFirebaseUid = String(firebaseAuth.getCurrentUser()?.uid || "").trim();
  if (safeExpectedUid && currentFirebaseUid === safeExpectedUid) return;
  try {
    const credential = await firebaseAuth.signInWithEmail(email, password);
    const firebaseUser = firebaseAuth.normalizeFirebaseUser(credential?.user || firebaseAuth.getCurrentUser());
    if (safeExpectedUid && firebaseUser?.uid && firebaseUser.uid !== safeExpectedUid) {
      console.warn("[auth] Firebase data session UID did not match API legacyFirebaseUid; signing Firebase out.");
      await firebaseAuth.signOutCurrentUser().catch(() => {});
      state.firebaseUser = null;
      return;
    }
    state.firebaseUser = firebaseUser;
  } catch (error) {
    console.warn("[auth] Firebase data session could not be established; API identity remains active.", error);
  }
}

export async function getSession() {
  if (state.initPromise) return state.initPromise;
  if (state.initialized) return state.currentUser;

  state.initPromise = (async () => {
    await refreshApiSession({ quiet: true });
    bindFirebaseListener();
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
  if (AUTH_PROVIDER !== "firebase") {
    try {
      state.apiUser = await apiAuth.login(email, password);
      if (hasLegacyFirebaseUid(state.apiUser)) {
        await tryEnsureFirebaseDataSession(email, password, state.apiUser.legacyFirebaseUid);
        refreshActiveUser();
        return state.currentUser;
      }
      console.warn("[auth] API login succeeded but did not include legacyFirebaseUid; trying Firebase fallback.");
    } catch (error) {
      if (AUTH_PROVIDER === "api") throw error;
      console.warn("[auth] API login failed; trying Firebase fallback.", error);
    }
  }

  if (AUTH_PROVIDER === "api") {
    throw new Error("La API ha iniciado sesion, pero /auth/me no devuelve legacyFirebaseUid para cargar tus datos Firebase.");
  }

  const credential = await firebaseAuth.signInWithEmail(email, password);
  state.firebaseUser = firebaseAuth.normalizeFirebaseUser(credential?.user || firebaseAuth.getCurrentUser());
  refreshActiveUser();
  return state.currentUser;
}

export async function logout() {
  const errors = [];
  if (AUTH_PROVIDER !== "firebase" && state.apiUser) {
    try {
      await apiAuth.logout();
    } catch (error) {
      errors.push(error);
    }
  }
  state.apiUser = null;
  if (AUTH_PROVIDER !== "api" && firebaseAuth.getCurrentUser()) {
    try {
      await firebaseAuth.signOutCurrentUser();
    } catch (error) {
      errors.push(error);
    }
  }
  state.firebaseUser = null;
  refreshActiveUser();
  if (errors.length) throw errors[0];
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
  if (state.currentUser.provider === "firebase") {
    return firebaseAuth.ensureCurrentUserDataRootReady();
  }
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
  if (!SIGNUP_ENABLED) {
    return Promise.reject(new Error("Registro deshabilitado temporalmente durante la migracion de autenticacion."));
  }
  return firebaseAuth.signUpWithEmail(...arguments);
}

export { AUTH_PROVIDER, SIGNUP_ENABLED } from "./config.js";
