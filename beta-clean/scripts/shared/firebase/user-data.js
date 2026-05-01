import { get, ref, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { auth, db } from "./app.js";
import { buildUserDataContext } from "./rtdb-paths.js";

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

function mergePreferTarget(targetValue, sourceValue) {
  if (targetValue === undefined || targetValue === null) {
    return cloneJsonValue(sourceValue);
  }
  if (sourceValue === undefined || sourceValue === null) {
    return cloneJsonValue(targetValue);
  }
  if (Array.isArray(targetValue) || Array.isArray(sourceValue)) {
    return cloneJsonValue(targetValue);
  }
  if (isPlainObject(targetValue) && isPlainObject(sourceValue)) {
    const merged = {};
    const keys = new Set([
      ...Object.keys(sourceValue),
      ...Object.keys(targetValue),
    ]);
    keys.forEach((key) => {
      const hasTarget = Object.prototype.hasOwnProperty.call(targetValue, key);
      const hasSource = Object.prototype.hasOwnProperty.call(sourceValue, key);
      if (hasTarget && hasSource) {
        merged[key] = mergePreferTarget(targetValue[key], sourceValue[key]);
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

async function migrateUserDataRoot(user = auth.currentUser) {
  const context = buildUserDataContext(user);
  const { uid, userKey, userRoot, legacyUserRoot } = context;

  if (!uid || !userKey) {
    console.info("[user-key:migrate:skip]", {
      uid,
      userKey,
      reason: "missing-user-context",
    });
    return context;
  }

  if (!legacyUserRoot || !userRoot || legacyUserRoot === userRoot) {
    console.info("[user-key:migrate:skip]", {
      uid,
      userKey,
      reason: "legacy-and-target-match",
      path: userRoot || legacyUserRoot,
    });
    return context;
  }

  console.info("[user-key:migrate:start]", {
    uid,
    userKey,
    from: legacyUserRoot,
    to: userRoot,
  });

  try {
    const [legacySnap, targetSnap] = await Promise.all([
      get(ref(db, legacyUserRoot)),
      get(ref(db, userRoot)),
    ]);

    if (!legacySnap.exists()) {
      console.info("[user-key:migrate:skip]", {
        uid,
        userKey,
        reason: "legacy-node-missing",
        from: legacyUserRoot,
        to: userRoot,
      });
      return context;
    }

    const legacyValue = legacySnap.val();
    const targetValue = targetSnap.exists() ? targetSnap.val() : null;
    const mergedValue = mergePreferTarget(targetValue, legacyValue);

    if (jsonEquals(mergedValue, targetValue)) {
      console.info("[user-key:migrate:skip]", {
        uid,
        userKey,
        reason: "target-already-covered",
        from: legacyUserRoot,
        to: userRoot,
      });
      return context;
    }

    await set(ref(db, userRoot), mergedValue);
    console.info("[user-key:migrate:done]", {
      uid,
      userKey,
      from: legacyUserRoot,
      to: userRoot,
      targetExisted: targetSnap.exists(),
    });
    return context;
  } catch (error) {
    console.error("[user-key:migrate:error]", {
      uid,
      userKey,
      from: legacyUserRoot,
      to: userRoot,
      message: error?.message || String(error || ""),
    });
    throw error;
  }
}

export function ensureUserDataRootReady(user = auth.currentUser) {
  const context = buildUserDataContext(user);
  const cacheKey = `${context.uid}:${context.userKey}`;
  if (!context.uid || !context.userKey) {
    return Promise.resolve(context);
  }
  if (!userDataReadyPromises.has(cacheKey)) {
    userDataReadyPromises.set(cacheKey, migrateUserDataRoot(user));
  }
  return userDataReadyPromises.get(cacheKey);
}
