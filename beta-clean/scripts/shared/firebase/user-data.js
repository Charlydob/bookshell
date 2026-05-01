import { get, ref, set, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { auth, db } from "./app.js";
import { buildUserDataContext, firebasePaths } from "./rtdb-paths.js";

const userDataReadyPromises = new Map();

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function cloneJsonValue(value) {
  if (Array.isArray(value)) return value.map((entry) => cloneJsonValue(entry));
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, cloneJsonValue(entry)]),
    );
  }
  return value;
}

function getTimestampWeight(value) {
  if (!isPlainObject(value)) return Number.NaN;
  const candidates = [
    value.updatedAt,
    value.ts,
    value.lastLoginAt,
    value.lastVisitedAt,
    value.lastCookedAt,
    value.createdAt,
  ];
  for (const candidate of candidates) {
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return Number.NaN;
}

function getArrayEntryKey(entry = {}, index = 0) {
  if (!isPlainObject(entry)) return `value:${JSON.stringify(entry)}:${index}`;
  const idCandidate = entry.id ?? entry.key ?? entry.code ?? entry.dateKey ?? entry.date ?? entry.barcode;
  if (idCandidate != null && String(idCandidate).trim()) return `id:${String(idCandidate).trim()}`;
  const ts = Number(entry.ts ?? entry.updatedAt ?? entry.createdAt ?? 0);
  if (Number.isFinite(ts) && ts > 0) return `ts:${ts}:${index}`;
  return `json:${JSON.stringify(entry)}`;
}

function countNestedContainers(value = {}) {
  if (!isPlainObject(value)) return 0;
  return Object.values(value).filter((entry) => Array.isArray(entry) || isPlainObject(entry)).length;
}

function mergeArraysPreferRecent(targetValue = [], sourceValue = []) {
  const next = new Map();
  targetValue.forEach((entry, index) => {
    next.set(getArrayEntryKey(entry, index), cloneJsonValue(entry));
  });
  sourceValue.forEach((entry, index) => {
    const key = getArrayEntryKey(entry, index);
    if (!next.has(key)) {
      next.set(key, cloneJsonValue(entry));
      return;
    }
    const current = next.get(key);
    const currentTs = getTimestampWeight(current);
    const incomingTs = getTimestampWeight(entry);
    if (Number.isFinite(incomingTs) && (!Number.isFinite(currentTs) || incomingTs > currentTs)) {
      next.set(key, cloneJsonValue(entry));
    }
  });
  return Array.from(next.values());
}

function shouldChooseWholeObject(targetValue, sourceValue) {
  if (!isPlainObject(targetValue) || !isPlainObject(sourceValue)) return false;
  const targetTs = getTimestampWeight(targetValue);
  const sourceTs = getTimestampWeight(sourceValue);
  if (!Number.isFinite(targetTs) && !Number.isFinite(sourceTs)) return false;
  return countNestedContainers(targetValue) <= 1 && countNestedContainers(sourceValue) <= 1;
}

function mergePreferRecent(targetValue, sourceValue) {
  if (targetValue === undefined || targetValue === null) {
    return cloneJsonValue(sourceValue);
  }
  if (sourceValue === undefined || sourceValue === null) {
    return cloneJsonValue(targetValue);
  }
  if (Array.isArray(targetValue) || Array.isArray(sourceValue)) {
    if (Array.isArray(targetValue) && Array.isArray(sourceValue)) {
      return mergeArraysPreferRecent(targetValue, sourceValue);
    }
    return cloneJsonValue(targetValue ?? sourceValue);
  }
  if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
    if (shouldChooseWholeObject(targetValue, sourceValue)) {
      const targetTs = getTimestampWeight(targetValue);
      const sourceTs = getTimestampWeight(sourceValue);
      if (Number.isFinite(sourceTs) && (!Number.isFinite(targetTs) || sourceTs > targetTs)) {
        return cloneJsonValue(sourceValue);
      }
      if (Number.isFinite(targetTs) && (!Number.isFinite(sourceTs) || targetTs >= sourceTs)) {
        return cloneJsonValue(targetValue);
      }
    }
    const merged = {};
    const keys = new Set([
      ...Object.keys(sourceValue),
      ...Object.keys(targetValue),
    ]);
    keys.forEach((key) => {
      const hasTarget = Object.prototype.hasOwnProperty.call(targetValue, key);
      const hasSource = Object.prototype.hasOwnProperty.call(sourceValue, key);
      if (hasTarget && hasSource) {
        merged[key] = mergePreferRecent(targetValue[key], sourceValue[key]);
        return;
      }
      merged[key] = cloneJsonValue(hasTarget ? targetValue[key] : sourceValue[key]);
    });
    return merged;
  }
  return cloneJsonValue(targetValue);
}

function jsonEquals(left, right) {
  try {
    return JSON.stringify(left) === JSON.stringify(right);
  } catch (_) {
    return left === right;
  }
}

function isPermissionDenied(error) {
  const message = String(error?.message || error?.code || "").toLowerCase();
  return message.includes("permission_denied") || message.includes("permission denied");
}

async function syncUserIdentity(context, user = auth.currentUser) {
  const { authUid, emailKey, userDataRootKey } = context;
  if (!authUid || !userDataRootKey) return;
  const now = Date.now();
  const safeEmail = String(user?.email || "").trim();
  const patch = {
    authUid,
    dataRootKey: userDataRootKey,
    lastLoginAt: now,
  };
  if (safeEmail) patch.email = safeEmail;
  if (emailKey) patch.userKey = emailKey;
  await update(ref(db, firebasePaths.userMeta(userDataRootKey)), patch);
}

async function trySetUserIndex(context, user = auth.currentUser) {
  const { authUid, emailKey } = context;
  if (!authUid || !emailKey) return;
  const path = firebasePaths.userIndex(emailKey);
  const payload = {
    uid: authUid,
    email: String(user?.email || "").trim(),
    emailKey,
    updatedAt: Date.now(),
  };
  try {
    await set(ref(db, path), payload);
    console.info("[user-key:index:set]", {
      path,
      uid: authUid,
      emailKey,
      status: "done",
    });
  } catch (error) {
    console.info("[user-key:index:set]", {
      path,
      uid: authUid,
      emailKey,
      status: isPermissionDenied(error) ? "skip" : "error",
      reason: error?.message || String(error || ""),
    });
  }
}

async function migrateUserDataRootBack(user = auth.currentUser) {
  const context = buildUserDataContext(user);
  const {
    authUid,
    emailKey,
    userDataRootKey,
    privateUserRoot,
    legacyUserRoot,
  } = context;

  console.info("[user-key:mode]", {
    mode: "uid-private/email-alias",
    authUid,
    emailKey,
    userDataRootKey,
    privateUserRoot,
    emailAliasRoot: legacyUserRoot || "",
  });

  if (!authUid || !userDataRootKey) {
    return context;
  }

  try {
    await syncUserIdentity(context, user);
  } catch (error) {
    console.warn("[user-key:identity:set]", {
      path: firebasePaths.userMeta(userDataRootKey),
      uid: authUid,
      emailKey,
      status: isPermissionDenied(error) ? "skip" : "error",
      reason: error?.message || String(error || ""),
    });
  }

  await trySetUserIndex(context, user);

  if (!legacyUserRoot || legacyUserRoot === privateUserRoot) {
    return context;
  }

  console.info("[user-key:migrate:back:start]", {
    uid: authUid,
    emailKey,
    from: legacyUserRoot,
    to: privateUserRoot,
  });

  try {
    const [legacySnap, targetSnap] = await Promise.all([
      get(ref(db, legacyUserRoot)),
      get(ref(db, privateUserRoot)),
    ]);

    if (!legacySnap.exists()) {
      console.info("[user-key:migrate:skip]", {
        uid: authUid,
        emailKey,
        reason: "email-alias-node-missing",
        from: legacyUserRoot,
        to: privateUserRoot,
      });
      return context;
    }

    const legacyValue = legacySnap.val();
    const targetValue = targetSnap.exists() ? targetSnap.val() : null;
    const mergedValue = mergePreferRecent(targetValue, legacyValue);

    if (jsonEquals(mergedValue, targetValue)) {
      console.info("[user-key:migrate:skip]", {
        uid: authUid,
        emailKey,
        reason: "uid-root-already-covered",
        from: legacyUserRoot,
        to: privateUserRoot,
      });
      return context;
    }

    await set(ref(db, privateUserRoot), mergedValue);
    console.info("[user-key:migrate:back:done]", {
      uid: authUid,
      emailKey,
      from: legacyUserRoot,
      to: privateUserRoot,
      targetExisted: targetSnap.exists(),
    });
    return context;
  } catch (error) {
    const denied = isPermissionDenied(error);
    console[denied ? "info" : "error"]("[user-key:migrate:error]", {
      uid: authUid,
      emailKey,
      from: legacyUserRoot,
      to: privateUserRoot,
      reason: denied ? "permission-denied" : "unexpected",
      message: error?.message || String(error || ""),
    });
    if (!denied) throw error;
    return context;
  }
}

export function ensureUserDataRootReady(user = auth.currentUser) {
  const context = buildUserDataContext(user);
  const cacheKey = `${context.authUid}:${context.emailKey}`;
  if (!context.authUid && !context.userDataRootKey) {
    return Promise.resolve(context);
  }
  if (!userDataReadyPromises.has(cacheKey)) {
    userDataReadyPromises.set(cacheKey, migrateUserDataRootBack(user));
  }
  return userDataReadyPromises.get(cacheKey);
}
