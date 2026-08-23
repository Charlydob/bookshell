import { AUTH_API_BASE_URL } from "./config.js";

const API_BASE = String(AUTH_API_BASE_URL || "").replace(/\/+$/g, "");

function buildUrl(path = "") {
  return `${API_BASE}${String(path || "").startsWith("/") ? "" : "/"}${path}`;
}

function normalizeLegacyFirebaseUid(raw = {}) {
  const legacyIdentities = Array.isArray(raw.legacyIdentities)
    ? raw.legacyIdentities
    : (Array.isArray(raw.legacy_identities) ? raw.legacy_identities : []);
  const firebaseIdentity = legacyIdentities.find((entry) => {
    return String(entry?.provider || "").trim().toLowerCase() === "firebase";
  });
  return String(
    raw.legacyFirebaseUid
      || raw.legacy_firebase_uid
      || raw.firebaseUid
      || raw.firebase_uid
      || raw.legacyUserId
      || raw.legacy_user_id
      || raw?.legacyIdentity?.legacy_user_id
      || raw?.legacyIdentity?.legacyUserId
      || firebaseIdentity?.legacy_user_id
      || firebaseIdentity?.legacyUserId
      || "",
  ).trim();
}

export function normalizeApiUser(raw = null) {
  if (!raw || typeof raw !== "object") return null;
  const source = raw.user && typeof raw.user === "object" ? raw.user : raw;
  const id = String(source.id || source.userId || source.user_id || "").trim();
  const email = String(source.email || "").trim();
  const legacyFirebaseUid = normalizeLegacyFirebaseUid(source);
  if (!id && !email) return null;
  return {
    ...source,
    provider: "api",
    id,
    email,
    displayName: String(source.displayName || source.display_name || source.name || email || "").trim(),
    legacyFirebaseUid,
    userDataRootKey: legacyFirebaseUid,
    uid: legacyFirebaseUid,
  };
}

async function requestJson(path, options = {}) {
  if (!API_BASE) throw new Error("[auth:api] API base URL missing");
  const response = await fetch(buildUrl(path), {
    credentials: "include",
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch (_) {
      payload = { message: text };
    }
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Auth API ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }
  return payload;
}

export async function login(email, password) {
  const payload = await requestJson("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  return normalizeApiUser(payload) || getSession();
}

export async function logout() {
  try {
    await requestJson("/auth/logout", { method: "POST" });
  } catch (error) {
    if (error?.status !== 401) throw error;
  }
}

export async function getSession() {
  try {
    const payload = await requestJson("/auth/me", { method: "GET" });
    return normalizeApiUser(payload);
  } catch (error) {
    if (error?.status === 401 || error?.status === 403) return null;
    throw error;
  }
}

export const getCurrentUser = getSession;
