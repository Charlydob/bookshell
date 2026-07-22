import { onRequest } from 'firebase-functions/v2/https';
import { defineString } from 'firebase-functions/params';
import admin from 'firebase-admin';
import {
  SUPPORTED_CURRENCIES,
  buildCategoryCatalogPayload,
  buildShortcutMovementPayload,
  financeRoot,
  legacyFinanceRoot,
} from './shortcuts-finance.js';

admin.initializeApp({ databaseURL: 'https://bookshell-59703-default-rtdb.europe-west1.firebasedatabase.app' });
const db = admin.database();
const REGION = 'europe-west1';
const SHORTCUTS_TOKEN = defineString('SHORTCUTS_TOKEN', { default: '' });
const SHORTCUTS_UID = defineString('SHORTCUTS_UID', { default: '' });
const SHORTCUTS_TOKEN_MAP = defineString('SHORTCUTS_TOKEN_MAP', { default: '{}' });

function parseTokenMap() {
  try { return JSON.parse(SHORTCUTS_TOKEN_MAP.value() || '{}') || {}; } catch { return {}; }
}
function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Authorization,Content-Type');
}
function readBearer(req) {
  const header = String(req.get('authorization') || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : String(req.query.token || '').trim();
}
function requireShortcutAuth(req) {
  const token = readBearer(req);
  const uid = parseTokenMap()[token] || (token && token === SHORTCUTS_TOKEN.value() ? SHORTCUTS_UID.value() : '');
  if (!token || !uid) throw Object.assign(new Error('No autorizado'), { status: 401 });
  return String(uid).trim();
}
async function readFinanceRoot(uid) {
  const root = financeRoot(uid);
  const snap = await db.ref(root).get();
  if (snap.exists()) return { root, data: snap.val() || {} };
  const legacyRoot = legacyFinanceRoot(uid);
  const legacySnap = await db.ref(legacyRoot).get();
  return { root, data: legacySnap.val() || {} };
}
function normalizeMap(value = {}) { return value && typeof value === 'object' ? value : {}; }
function configPayload(financeData = {}) {
  const accounts = normalizeMap(financeData.accounts);
  const categories = normalizeMap(financeData.catalog?.categories || financeData.categories);
  return {
    accounts: Object.entries(accounts).map(([id, row]) => ({ id, ...(row || {}) })),
    categories: Object.entries(categories).map(([id, row]) => ({ id, ...(row || {}) })),
    currencies: SUPPORTED_CURRENCIES,
    defaultAccountId: String(financeData.balance?.defaultAccountId || financeData.defaultAccountId || ''),
  };
}
async function createMovement(uid, input = {}) {
  const { root, data } = await readFinanceRoot(uid);
  const accountsById = normalizeMap(data.accounts);
  const txRef = db.ref(`${root}/transactions`).push();
  const now = Date.now();
  const payload = buildShortcutMovementPayload(input, { id: txRef.key, accountsById, now });
  const updates = { [`${root}/transactions/${txRef.key}`]: payload };
  if (payload.type !== 'transfer') {
    updates[`${root}/catalog/categories/${payload.category}`] = buildCategoryCatalogPayload(payload.category, { lastUsedAt: now, updatedAt: now });
  }
  await db.ref().update(updates);
  return { id: txRef.key, movement: payload };
}

export const shortcutsApi = onRequest({ region: REGION, cors: false, secrets: [] }, async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  try {
    const uid = requireShortcutAuth(req);
    const path = String(req.path || req.url || '').split('?')[0].replace(/^\/api\/shortcuts/, '').replace(/^\/+|\/+$/g, '');
    if (req.method === 'GET' && path === 'finance/config') {
      const { data } = await readFinanceRoot(uid);
      return res.json(configPayload(data));
    }
    if (req.method === 'POST' && path === 'finance/movements') {
      const result = await createMovement(uid, req.body || {});
      return res.status(201).json(result);
    }
    if (req.method === 'POST' && path === 'finance/transfers') {
      const result = await createMovement(uid, { ...(req.body || {}), type: 'transfer' });
      return res.status(201).json(result);
    }
    return res.status(404).json({ error: 'not-found' });
  } catch (error) {
    const status = Number(error?.status || 400);
    return res.status(status).json({ error: error?.message || String(error || 'error') });
  }
});
