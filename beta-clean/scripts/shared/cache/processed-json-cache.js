const STORAGE_PREFIX = "bookshell:processed-cache:";
const INDEX_KEY = `${STORAGE_PREFIX}index`;
const MAX_ENTRIES = 24;
const memoryCache = new Map();

function getStorageKey(key) {
  return `${STORAGE_PREFIX}${String(key || "").trim()}`;
}

function readIndex() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(INDEX_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function writeIndex(index) {
  try {
    window.localStorage.setItem(INDEX_KEY, JSON.stringify(index));
  } catch (_) {}
}

function dropEntryByStorageKey(storageKey, index = readIndex()) {
  memoryCache.delete(storageKey);
  try {
    window.localStorage.removeItem(storageKey);
  } catch (_) {}
  if (index[storageKey] != null) {
    delete index[storageKey];
    writeIndex(index);
  }
}

function pruneIndex(index = readIndex()) {
  const entries = Object.entries(index);
  if (entries.length <= MAX_ENTRIES) return;

  entries
    .sort((a, b) => Number(a[1] || 0) - Number(b[1] || 0))
    .slice(0, Math.max(0, entries.length - MAX_ENTRIES))
    .forEach(([storageKey]) => {
      dropEntryByStorageKey(storageKey, index);
    });
}

function rememberEntry(storageKey, entry) {
  memoryCache.set(storageKey, entry);
  const index = readIndex();
  index[storageKey] = Number(entry?.updatedAt || Date.now());
  writeIndex(index);
  pruneIndex(index);
}

function isExpired(entry) {
  const expiresAt = Number(entry?.expiresAt || 0);
  return expiresAt > 0 && expiresAt <= Date.now();
}

export function readProcessedJsonCache(key) {
  if (typeof window === "undefined" || !window.localStorage) return null;
  const storageKey = getStorageKey(key);

  const memoryEntry = memoryCache.get(storageKey);
  if (memoryEntry) {
    if (isExpired(memoryEntry)) {
      dropEntryByStorageKey(storageKey);
      return null;
    }
    return memoryEntry.value ?? null;
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) || "null");
    if (!parsed || typeof parsed !== "object") return null;
    if (isExpired(parsed)) {
      dropEntryByStorageKey(storageKey);
      return null;
    }
    rememberEntry(storageKey, parsed);
    return parsed.value ?? null;
  } catch (_) {
    dropEntryByStorageKey(storageKey);
    return null;
  }
}

export function writeProcessedJsonCache(key, value, { ttlMs = 30 * 60 * 1000 } = {}) {
  if (typeof window === "undefined" || !window.localStorage) return value;
  const storageKey = getStorageKey(key);
  const entry = {
    updatedAt: Date.now(),
    expiresAt: ttlMs > 0 ? Date.now() + ttlMs : 0,
    value,
  };

  memoryCache.set(storageKey, entry);
  try {
    window.localStorage.setItem(storageKey, JSON.stringify(entry));
    rememberEntry(storageKey, entry);
  } catch (_) {}
  return value;
}

export function clearProcessedJsonCache(key) {
  if (typeof window === "undefined" || !window.localStorage) return;
  dropEntryByStorageKey(getStorageKey(key));
}
