const FALLBACK_KEY = 'bookshell:indexeddb:fallback';

function isIndexedDbIssue(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  return msg.includes('indexed database server lost')
    || msg.includes('indexeddb')
    || msg.includes('idb')
    || msg.includes('connection to indexed database');
}

export function createMemoryStore() {
  const mem = new Map();
  return {
    getItem: async (key) => (mem.has(key) ? mem.get(key) : null),
    setItem: async (key, value) => { mem.set(key, value); },
    removeItem: async (key) => { mem.delete(key); }
  };
}

export function initIndexedDBSafe({ dbName = 'bookshell-cache', storeName = 'kv', version = 1, onWarning } = {}) {
  let dbPromise = null;
  let status = 'idle'; // idle | opening | ready | closing | fallback
  let closeRequested = false;
  const memory = createMemoryStore();

  const warn = (message, error) => {
    if (typeof onWarning === 'function') onWarning(message, error);
    else console.warn('[indexeddb-safe]', message, error || '');
  };

  async function openDb() {
    if (status === 'ready' && dbPromise) return dbPromise;
    if (status === 'opening' && dbPromise) return dbPromise;
    if (!window.indexedDB) {
      status = 'fallback';
      warn('IndexedDB no disponible; se usa fallback en memoria/localStorage.');
      return null;
    }

    status = 'opening';
    dbPromise = new Promise((resolve, reject) => {
      const req = window.indexedDB.open(dbName, version);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(storeName)) db.createObjectStore(storeName);
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onclose = () => { status = 'idle'; };
        db.onversionchange = () => {
          status = 'closing';
          closeRequested = true;
          try { db.close(); } catch (_) {}
          status = 'idle';
        };
        status = 'ready';
        closeRequested = false;
        resolve(db);
      };
      req.onerror = () => {
        status = 'fallback';
        const error = req.error || new Error('IndexedDB open failed');
        warn('No se pudo abrir IndexedDB; activando fallback.', error);
        reject(error);
      };
      req.onblocked = () => {
        status = 'fallback';
        warn('IndexedDB bloqueada; activando fallback temporal.');
        reject(new Error('IndexedDB blocked'));
      };
    });

    try {
      return await dbPromise;
    } catch (err) {
      dbPromise = null;
      return null;
    }
  }

  async function withStore(mode, action) {
    if (status === 'closing') return null;
    const db = await openDb();
    if (!db) return null;
    return new Promise((resolve, reject) => {
      let tx;
      try {
        tx = db.transaction(storeName, mode);
      } catch (err) {
        status = 'fallback';
        warn('Transacción IndexedDB inválida; fallback activado.', err);
        resolve(null);
        return;
      }
      const store = tx.objectStore(storeName);
      let settled = false;
      tx.oncomplete = () => { if (!settled) resolve(null); };
      tx.onerror = () => {
        status = 'fallback';
        const err = tx.error || new Error('IndexedDB tx error');
        if (!settled) reject(err);
      };
      tx.onabort = () => {
        status = 'fallback';
        const err = tx.error || new Error('IndexedDB tx aborted');
        if (!settled) reject(err);
      };
      action(store, (value) => {
        settled = true;
        resolve(value);
      }, (error) => {
        settled = true;
        reject(error);
      });
    }).catch((err) => {
      if (isIndexedDbIssue(err)) warn('Error controlado de IndexedDB.', err);
      return null;
    });
  }

  const persistFallback = async (key, value) => {
    const payload = { ...(JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}')), [key]: value };
    localStorage.setItem(FALLBACK_KEY, JSON.stringify(payload));
    await memory.setItem(key, value);
  };

  const api = {
    get status() { return status; },
    async ready() {
      try { await openDb(); } catch (_) {}
      return status === 'ready' || status === 'fallback';
    },
    async getItem(key) {
      if (status === 'fallback') {
        const data = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}');
        return data[key] ?? memory.getItem(key);
      }
      const value = await withStore('readonly', (store, done, fail) => {
        const req = store.get(key);
        req.onsuccess = () => done(req.result ?? null);
        req.onerror = () => fail(req.error);
      });
      if (value == null) {
        const data = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}');
        return data[key] ?? null;
      }
      return value;
    },
    async setItem(key, value) {
      if (status === 'fallback') return persistFallback(key, value);
      const ok = await withStore('readwrite', (store, done, fail) => {
        const req = store.put(value, key);
        req.onsuccess = () => done(true);
        req.onerror = () => fail(req.error);
      });
      if (!ok) await persistFallback(key, value);
    },
    async removeItem(key) {
      if (status === 'fallback') {
        const data = JSON.parse(localStorage.getItem(FALLBACK_KEY) || '{}');
        delete data[key];
        localStorage.setItem(FALLBACK_KEY, JSON.stringify(data));
        await memory.removeItem(key);
        return;
      }
      await withStore('readwrite', (store, done, fail) => {
        const req = store.delete(key);
        req.onsuccess = () => done(true);
        req.onerror = () => fail(req.error);
      });
    },
    close() {
      closeRequested = true;
      status = 'closing';
      Promise.resolve(dbPromise).then((db) => {
        try { db?.close(); } catch (_) {}
        status = 'idle';
      });
    },
    isClosing() {
      return closeRequested || status === 'closing';
    }
  };

  window.addEventListener('unhandledrejection', (event) => {
    if (!isIndexedDbIssue(event?.reason)) return;
    event.preventDefault();
    status = 'fallback';
    warn('Se interceptó un error no manejado de IndexedDB; fallback activo.', event.reason);
  });

  window.addEventListener('error', (event) => {
    if (!isIndexedDbIssue(event?.error || event?.message)) return;
    status = 'fallback';
    warn('Error global de IndexedDB interceptado; fallback activo.', event.error || event.message);
  });

  openDb().catch(() => {});
  return api;
}
