let get;
let onValue;
let auth;
let onUserChange;
let push;
let ref;
let remove;
let set;
let update;
let db;

async function ensureFinanceLoaded() {
  if (db && get && onValue && ref && auth && onUserChange) return;
  const dbMod = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js');
  ({ get, onValue, push, ref, remove, set, update } = dbMod);
  ({ db, auth, onUserChange } = await import('../../shared/firebase/index.js'));
}

import { DEVICE_KEY, HOME_PANEL_VIEW_KEY, RANGE_LABEL, BTC_PRICE_CACHE_KEY, BTC_PRICE_CACHE_TTL_MS, AGG_MODES, FINANCE_DEBUG, state } from './finance/state.js';
import { resolveFinanceRoot, ensureFinanceHost, showFinanceBootError } from './finance/ui.js';
import { resolveFinancePath, resolveFinancePathCandidates } from './finance/data.js';
import { parseImportRaw, parseTicketImport, applyTicketImport, mapTicketCategoryToApp, firebaseSafeKey, TICKET_IMPORT_SAMPLE_V1, resolveTicketMovementCategory } from './finance/import.js';
import { ensureEcharts } from '../../shared/vendors/echarts.js';
import { readProcessedJsonCache, writeProcessedJsonCache } from '../../shared/cache/processed-json-cache.js';
import { normalizeCatalogName, upsertPublicCatalogItem } from '../../shared/services/public-catalog.js';
import { logFirebaseRead, registerViewListener } from '../../shared/firebase/read-debug.js';
import { PUBLIC_PATHS } from '../../shared/firebase/index.js';

let unsubscribeLegacyFinance = null;
let financeRootsCache = { newRoot: {}, legacyRoot: {} };
let financeNeedsLegacyAccountsMerge = false;
let financeRenderPromise = null;
let financeRenderQueued = false;
let financePendingPreserveUi = true;
let financeRemoteApplyTimer = 0;
const FINANCE_GOALS_SORT_MODE_KEY = 'financeGoalsSortMode';
const PRODUCTS_DRAFT_LOCAL_KEY = 'bookshell_finance_products_draft_v1';
const GLOBAL_PRODUCTS_PATH = PUBLIC_PATHS.foodItems;
const FINANCE_CORE_BRANCHES = Object.freeze([
  { key: 'accounts', path: 'accounts', fallback: {} },
  { key: 'transactions', path: 'transactions', fallback: {} },
  { key: 'tx', path: 'tx', fallback: {} },
  { key: 'movements', path: 'movements', fallback: {} },
  { key: 'budgets', path: 'budgets', fallback: {} },
  { key: 'recurring', path: 'recurring', fallback: {} },
  { key: 'goals', path: 'goals', fallback: {} },
  { key: 'shoppingHub', path: 'shoppingHub', fallback: {} },
  { key: 'accountsEntries', path: 'accountsEntries', fallback: {} },
  { key: 'entries', path: 'entries', fallback: {} },
  { key: 'aggregates', path: 'aggregates', fallback: {} },
  { key: 'categories', path: 'catalog/categories', fallback: {} },
  { key: 'snapshots', path: 'balance/snapshots', fallback: {} },
  { key: 'defaultAccountId', path: 'balance/defaultAccountId', fallback: '' },
  { key: 'lastSeenMonthKey', path: 'balance/lastSeenMonthKey', fallback: '' },
]);
const financeDerivedCache = {
  txList: { balanceRef: null, financePath: '', rows: [] },
  recurring: { recurringRef: null, monthMap: new Map() },
  categories: { categoriesKey: '', txRowsRef: null, rows: [] },
  accountModels: { accountsRef: null, legacyEntriesRef: null, btcEurPrice: Number.NaN, rangeMode: '', rows: [] },
  accountMerge: { accountsRef: null, balanceRef: null, goalsRef: null, model: null },
  totalSeries: { accountsRef: null, rows: [] },
};

function cloneFinanceBranchFallback(value) {
  if (Array.isArray(value)) return [...value];
  if (value && typeof value === 'object') return { ...value };
  return value;
}

function setNestedValue(target, path, value) {
  const segments = String(path || '').split('/').filter(Boolean);
  if (!segments.length) return target;
  let cursor = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    if (!cursor[segment] || typeof cursor[segment] !== 'object') {
      cursor[segment] = {};
    }
    cursor = cursor[segment];
  }
  cursor[segments[segments.length - 1]] = value;
  return target;
}

function applyFinanceBranchValue(targetRoot = {}, branch, rawValue) {
  const nextValue = rawValue == null ? cloneFinanceBranchFallback(branch.fallback) : rawValue;
  setNestedValue(targetRoot, branch.path, nextValue);
  return targetRoot;
}

function log(...parts) {
  if (!FINANCE_DEBUG) return;
  console.log('[finance]', ...parts);
}
function warnMissing(id) { console.warn(`[finance] missing DOM node ${id}`); }
function $req(sel, ctx = document) {
  const el = ctx.querySelector(sel);
  if (!el) throw new Error(`[finance] Missing element: ${sel}`);
  return el;
}
function $opt(sel, ctx = document) { return ctx.querySelector(sel); }

function clearFinanceDerivedCaches() {
  financeDerivedCache.txList.balanceRef = null;
  financeDerivedCache.txList.financePath = '';
  financeDerivedCache.txList.rows = [];
  financeDerivedCache.recurring.recurringRef = null;
  financeDerivedCache.recurring.monthMap.clear();
  financeDerivedCache.categories.categoriesKey = '';
  financeDerivedCache.categories.txRowsRef = null;
  financeDerivedCache.categories.rows = [];
  financeDerivedCache.accountModels.accountsRef = null;
  financeDerivedCache.accountModels.legacyEntriesRef = null;
  financeDerivedCache.accountModels.btcEurPrice = Number.NaN;
  financeDerivedCache.accountModels.rangeMode = '';
  financeDerivedCache.accountModels.rows = [];
  financeDerivedCache.accountMerge.accountsRef = null;
  financeDerivedCache.accountMerge.balanceRef = null;
  financeDerivedCache.accountMerge.goalsRef = null;
  financeDerivedCache.accountMerge.model = null;
  financeDerivedCache.totalSeries.accountsRef = null;
  financeDerivedCache.totalSeries.rows = [];
}

function normalizeFinanceGoalsSortMode(value = '') {
  return value === 'incomplete-first' ? 'incomplete-first' : 'due-date';
}

function readFinanceGoalsSortMode() {
  try {
    return normalizeFinanceGoalsSortMode(localStorage.getItem(FINANCE_GOALS_SORT_MODE_KEY) || '');
  } catch (_) {
    return 'due-date';
  }
}

function setFinanceGoalsSortMode(nextMode = 'due-date') {
  state.financeGoalsSortMode = normalizeFinanceGoalsSortMode(nextMode);
  try {
    localStorage.setItem(FINANCE_GOALS_SORT_MODE_KEY, state.financeGoalsSortMode);
  } catch (_) {}
}

state.financeGoalsSortMode = normalizeFinanceGoalsSortMode(state.financeGoalsSortMode || readFinanceGoalsSortMode());

let financeEchartsPromise = null;

function hashString(value = '') {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ensureFinanceEchartsReady() {
  if (window.echarts?.init) {
    return Promise.resolve(window.echarts);
  }
  if (!financeEchartsPromise) {
    financeEchartsPromise = ensureEcharts().finally(() => {
      financeEchartsPromise = null;
    });
  }
  return financeEchartsPromise;
}

function buildFoodHistoryCacheKey(history = []) {
  const signature = history
    .map((row) => [
      firebaseSafeKey(row.vendor || 'unknown') || 'unknown',
      Number(row.ts || 0),
      Number(row.qty || 0),
      Number(row.unitPrice || row.price || 0),
      String(row.unit || 'ud'),
    ].join('|'))
    .join('~');
  return `finance:food-history-chart:v1:${hashString(signature)}`;
}

function readCachedFoodChartSeries(history = []) {
  return readProcessedJsonCache(buildFoodHistoryCacheKey(history));
}

function writeCachedFoodChartSeries(history = [], value) {
  return writeProcessedJsonCache(buildFoodHistoryCacheKey(history), value, {
    ttlMs: 12 * 60 * 60 * 1000,
  });
}

function buildFinanceStatsCacheKey({ monthKey, statsRange, statsScope, statsGroupBy, mode, includeUnlined, rows = [] }) {
  const signature = rows
    .map((row) => [
      String(row.id || row.key || ''),
      Number(row.ts || row.timestamp || row.createdAt || row.updatedAt || 0),
      String(row.type || ''),
      Number(row.amount || 0),
      String(row.category || ''),
      String(row.accountId || ''),
      String(row.fromAccountId || ''),
      String(row.toAccountId || ''),
      String(row.store || ''),
      String(row.mealType || ''),
      String(row.foodId || ''),
    ].join('|'))
    .join('~');
  return `finance:balance-donut:v1:${state.financePath}:${monthKey}:${statsRange}:${statsScope}:${statsGroupBy}:${mode}:${includeUnlined ? '1' : '0'}:${hashString(signature)}`;
}

function serializeFinanceProductMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta || {}).map(([label, value]) => [
      label,
      {
        ...value,
        units: Array.from(value?.units instanceof Set ? value.units : (Array.isArray(value?.units) ? value.units : [])),
      },
    ]),
  );
}

function hydrateFinanceProductMeta(meta = {}) {
  return Object.fromEntries(
    Object.entries(meta || {}).map(([label, value]) => [
      label,
      {
        ...value,
        units: new Set(Array.isArray(value?.units) ? value.units : []),
      },
    ]),
  );
}

function nowTs() { return Date.now(); }
function getMonthKeyFromDate(d = new Date()) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; }
function parseMonthKey(monthKey) { const [y, m] = String(monthKey).split('-').map(Number); return new Date(y, (m || 1) - 1, 1); }
function monthDiffFromNow(monthKey) {
  const target = parseMonthKey(monthKey);
  const now = new Date();
  return (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth());
}

function offsetMonthKey(monthKey, offset) { const d = parseMonthKey(monthKey); d.setMonth(d.getMonth() + offset); return getMonthKeyFromDate(d); }
function monthLabelByKey(monthKey) { return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(parseMonthKey(monthKey)); }
function capitalizeFirst(value = '') { return value ? value.charAt(0).toUpperCase() + value.slice(1) : ''; }
function normalizeHomePanelView(value = '') {
  if (value === 'calendar' || value === 'tickets') return value;
  return 'hero';
}
function setHomePanelView(nextView = 'hero') {
  state.homePanelView = normalizeHomePanelView(nextView);
  try { localStorage.setItem(HOME_PANEL_VIEW_KEY, state.homePanelView); } catch (_) {}
}
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
function fmtCurrency(value) { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value || 0)); }
function fmtSignedCurrency(value) { const num = Number(value || 0); return `${num > 0 ? '+' : ''}${fmtCurrency(num)}`; }
function fmtSignedPercent(value) { const num = Number(value || 0); return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`; }
function toneClass(value) { if (value > 0) return 'is-positive'; if (value < 0) return 'is-negative'; return 'is-neutral'; }
function dayKeyFromTs(ts) { const d = new Date(Number(ts || Date.now())); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseDayKey(key) { return new Date(`${key}T00:00:00`).getTime(); }
function isoWeekKeyFromDate(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  const weekNo = 1 + Math.round((((date.getTime() - week1.getTime()) / 86400000) - 3 + ((week1.getDay() + 6) % 7)) / 7);
  return `${date.getFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}
function bucketKeyForDay(dayKey, mode = 'day') {
  if (!dayKey) return '';
  if (mode === 'day') return dayKey;
  const d = new Date(`${dayKey}T00:00:00`);
  if (mode === 'week') return isoWeekKeyFromDate(d);
  if (mode === 'month') return dayKey.slice(0, 7);
  if (mode === 'year') return dayKey.slice(0, 4);
  return 'all';
}
function bucketKeyForTx(tx = {}, mode = 'day') {
  const day = String(tx.date || isoToDay(tx.dateISO || '') || '');
  return bucketKeyForDay(day, mode);
}
function bucketRange(mode = 'month', bucketKey = '') {
  if (mode === 'total') {
    const accountTs = (state.accounts || []).flatMap((account) => {
      const snapshotsTs = normalizeSnapshots(account?.snapshots || {}).map((row) => parseDayKey(row.day));
      const entriesTs = normalizeDaily(account?.entries || account?.daily || {}).map((row) => Number(row.ts || parseDayKey(row.day)));
      return [...snapshotsTs, ...entriesTs].filter((ts) => Number.isFinite(ts));
    });
    const movementTs = balanceTxList().map((row) => txTs(row)).filter((ts) => Number.isFinite(ts) && ts > 0);
    const allTs = [...accountTs, ...movementTs];
    if (!allTs.length) {
      const now = Date.now();
      return { start: now, end: now + 1 };
    }
    const start = Math.min(...allTs);
    const end = Math.max(...allTs) + 1;
    return { start, end };
  }
  if (mode === 'day') {
    const start = parseDayKey(bucketKey);
    return { start, end: start + 86400000 };
  }
  if (mode === 'week') {
    const match = String(bucketKey).match(/^(\d{4})-W(\d{2})$/);
    if (!match) return { start: 0, end: 0 };
    const year = Number(match[1]);
    const week = Number(match[2]);
    const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
    const dow = simple.getUTCDay() || 7;
    const start = new Date(simple);
    if (dow <= 4) start.setUTCDate(simple.getUTCDate() - dow + 1);
    else start.setUTCDate(simple.getUTCDate() + 8 - dow);
    return { start: start.getTime(), end: start.getTime() + (7 * 86400000) };
  }
  if (mode === 'month') {
    const [y, m] = String(bucketKey).split('-').map(Number);
    const start = new Date(y, (m || 1) - 1, 1).getTime();
    return { start, end: new Date(y, (m || 1), 1).getTime() };
  }
  const year = Number(bucketKey || new Date().getFullYear());
  return { start: new Date(year, 0, 1).getTime(), end: new Date(year + 1, 0, 1).getTime() };
}
function pctDelta(curr = 0, prev = 0) {
  const c = Number(curr || 0);
  const p = Number(prev || 0);
  if (!Number.isFinite(p) || p === 0) return null;
  return ((c - p) / Math.abs(p)) * 100;
}
function financeGoalDueTs(goal = null) {
  const raw = String(goal?.dueDateISO || '').trim();
  if (!raw) return Number.MAX_SAFE_INTEGER;
  const ts = new Date(raw).getTime();
  return Number.isFinite(ts) ? ts : Number.MAX_SAFE_INTEGER;
}
function compareFinanceGoalsByDueDate(a = null, b = null) {
  const dueDiff = financeGoalDueTs(a) - financeGoalDueTs(b);
  if (dueDiff !== 0) return dueDiff;
  const targetDiff = Number(a?.targetAmount || 0) - Number(b?.targetAmount || 0);
  if (targetDiff !== 0) return targetDiff;
  return String(a?.title || '').localeCompare(String(b?.title || ''), 'es', { sensitivity: 'base' });
}
function toIsoDay(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const slash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!slash) return null;
  const day = Number(slash[1]);
  const month = Number(slash[2]);
  const year = Number(slash[3]);
  if (!day || !month || !year || month > 12 || day > 31) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function normalizeTxAllocation(raw = {}, fallbackDate = '') {
  const mode = raw?.mode === 'period' ? 'period' : 'point';
  const period = ['day', 'week', 'month', 'year', 'custom'].includes(raw?.period) ? raw.period : 'day';
  const anchorDate = toIsoDay(String(raw?.anchorDate || fallbackDate || '')) || toIsoDay(fallbackDate) || dayKeyFromTs(Date.now());
  const customStart = toIsoDay(String(raw?.customStart || '')) || null;
  const customEnd = toIsoDay(String(raw?.customEnd || '')) || null;
  if (mode !== 'period') {
    return { mode: 'point', period: 'day', anchorDate };
  }
  if (period === 'custom') {
    const start = customStart || anchorDate;
    const end = customEnd || start;
    return { mode, period, anchorDate, customStart: start, customEnd: end };
  }
  return { mode, period, anchorDate };
}

function localStartOfDayTs(day = '') {
  const normalized = toIsoDay(day);
  if (!normalized) return 0;
  const [y, m, d] = normalized.split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0).getTime();
}

function rangeBoundsForMode(mode = 'month') {
  if (mode === 'month') {
    const key = getSelectedBalanceMonthKey();
    const [year, month] = String(key).split('-').map(Number);
    const start = new Date(year, (month || 1) - 1, 1, 0, 0, 0, 0).getTime();
    const end = new Date(year, (month || 1), 1, 0, 0, 0, 0).getTime();
    return { start, end };
  }
  if (mode === 'total') {
    const rows = balanceTxList();
    if (!rows.length) {
      const now = Date.now();
      return { start: now, end: now + 86400000 };
    }
    const dates = rows
      .map((row) => localStartOfDayTs(row?.date || isoToDay(row?.dateISO || '')))
      .filter((ts) => Number.isFinite(ts) && ts > 0);
    const start = Math.min(...dates);
    const end = Math.max(...dates) + 86400000;
    return { start, end };
  }
  const start = rangeStartByMode(mode);
  if (!Number.isFinite(start)) {
    const now = Date.now();
    return { start: now, end: now + 86400000 };
  }
  if (mode === 'day') return { start, end: start + 86400000 };
  if (mode === 'week') return { start, end: start + (7 * 86400000) };
  if (mode === 'year') {
    const d = new Date(start);
    return { start, end: new Date(d.getFullYear() + 1, 0, 1, 0, 0, 0, 0).getTime() };
  }
  return { start, end: Date.now() + 1 };
}

function isoWeekStartTs(anchorIso = '') {
  const date = new Date(`${anchorIso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function allocationWindowBounds(allocation = {}, fallbackDate = '') {
  const normalized = normalizeTxAllocation(allocation, fallbackDate);
  const anchorDay = normalized.anchorDate;
  if (normalized.mode !== 'period') {
    const start = localStartOfDayTs(anchorDay);
    return { start, end: start + 86400000 };
  }
  if (normalized.period === 'week') {
    const start = isoWeekStartTs(anchorDay);
    return { start, end: start + (7 * 86400000) };
  }
  if (normalized.period === 'month') {
    const [y, m] = anchorDay.split('-').map(Number);
    const start = new Date(y, (m || 1) - 1, 1, 0, 0, 0, 0).getTime();
    return { start, end: new Date(y, (m || 1), 1, 0, 0, 0, 0).getTime() };
  }
  if (normalized.period === 'year') {
    const [y] = anchorDay.split('-').map(Number);
    const start = new Date(y, 0, 1, 0, 0, 0, 0).getTime();
    return { start, end: new Date(y + 1, 0, 1, 0, 0, 0, 0).getTime() };
  }
  if (normalized.period === 'custom') {
    const start = localStartOfDayTs(normalized.customStart || anchorDay);
    const end = localStartOfDayTs(normalized.customEnd || normalized.customStart || anchorDay) + 86400000;
    return { start: Math.min(start, end - 86400000), end: Math.max(end, start + 86400000) };
  }
  const start = localStartOfDayTs(anchorDay);
  return { start, end: start + 86400000 };
}

function overlapDays(windowBounds = {}, rangeBounds = {}) {
  const start = Math.max(Number(windowBounds.start || 0), Number(rangeBounds.start || 0));
  const end = Math.min(Number(windowBounds.end || 0), Number(rangeBounds.end || 0));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return 0;
  return (end - start) / 86400000;
}
function parseEuroNumber(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return NaN;
  const clean = raw.replace(/[^\d,.-]/g, '');
  if (!clean) return NaN;
  const hasComma = clean.includes(',');
  const hasDot = clean.includes('.');
  let normalized = clean;
  if (hasComma && hasDot) {
    normalized = clean.lastIndexOf(',') > clean.lastIndexOf('.') ? clean.replace(/\./g, '').replace(',', '.') : clean.replace(/,/g, '');
  } else if (hasComma) {
    normalized = clean.replace(/\./g, '').replace(',', '.');
  }
  return Number(normalized);
}
function parseMoney(value = '') {
  const parsed = parseEuroNumber(value);
  return Number.isFinite(parsed) ? parsed : Number(value);
}
function formatEditableEuro(value = 0) {
  const num = Number(value || 0);
  if (!Number.isFinite(num)) return '';
  return num.toLocaleString('es-ES', {
    minimumFractionDigits: Math.abs(num % 1) > 0.000001 ? 2 : 0,
    maximumFractionDigits: 2,
  });
}
function parseProductsReceiptMoney(value, fallback = NaN, { blankAsNaN = false } = {}) {
  const raw = String(value ?? '').trim();
  if (!raw) return blankAsNaN ? NaN : fallback;
  const parsed = parseEuroNumber(raw);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}
function resolveProductsReceiptDiffMeta(diff = 0) {
  const safeDiff = Number(diff || 0);
  const tone = safeDiff > 0.005 ? 'expensive' : safeDiff < -0.005 ? 'cheap' : 'even';
  const sign = safeDiff > 0.005 ? '+' : safeDiff < -0.005 ? '-' : '';
  return {
    tone,
    label: `${sign}${fmtCurrency(Math.abs(safeDiff))}`,
  };
}
function syncProductsMoneyFieldDisplay(fieldEl, value) {
  if (!fieldEl) return;
  const safeValue = Math.max(0, Number(value || 0));
  if (!Number.isFinite(safeValue)) return;
  fieldEl.dataset.moneyLastValid = String(safeValue.toFixed(2));
  fieldEl.dataset.value = String(safeValue.toFixed(2));
  if (document.activeElement !== fieldEl) fieldEl.value = fmtCurrency(safeValue);
}

function normalizeReceiptLine(rawLine = {}, fallback = {}) {
  const base = {
    ...fallback,
    ...(rawLine || {}),
  };
  const qty = Math.max(0.01, Number(base.qty || 1));
  const estimatedPrice = normalizeProductPositiveNumber(base.estimatedPrice, 0);
  const actualPrice = normalizeProductPositiveNumber(base.actualPrice, estimatedPrice);
  return {
    ...base,
    qty,
    estimatedPrice,
    actualPrice,
  };
}

function calculateLineTotals(line = {}) {
  const normalized = normalizeReceiptLine(line);
  const estimatedSubtotal = normalized.qty * normalized.estimatedPrice;
  const actualSubtotal = normalized.qty * normalized.actualPrice;
  const diffSubtotal = actualSubtotal - estimatedSubtotal;
  return {
    ...normalized,
    estimatedSubtotal,
    actualSubtotal,
    diffSubtotal,
  };
}

function calculateReceiptTotals(lines = []) {
  return (Array.isArray(lines) ? lines : []).reduce((acc, line) => {
    const totals = calculateLineTotals(line);
    acc.estimatedTotal += Number(totals.estimatedSubtotal || 0);
    acc.actualTotal += Number(totals.actualSubtotal || 0);
    acc.diffTotal += Number(totals.diffSubtotal || 0);
    return acc;
  }, { estimatedTotal: 0, actualTotal: 0, diffTotal: 0 });
}
function clampRatio(value, fallback = 1) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return fallback;
  return Math.min(1, Math.max(0.1, ratio));
}
function clamp01(value, fallback = 1) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return fallback;
  return Math.min(1, Math.max(0, ratio));
}
function isShared(account = {}) {
  return Boolean(account?.shared);
}
function getRatio(account = {}) {
  return isShared(account) ? clampRatio(account?.sharedRatio, 0.5) : 1;
}
function shareAmount(account = {}, amount = 0) {
  return Number(amount || 0) * getRatio(account);
}
function normalizeAccountShare(account = {}) {
  const shared = isShared(account);
  const sharedRatio = getRatio(account);
  return { shared, sharedRatio };
}
function personalRatioForTx(tx = {}, accountsById = {}) {
  if (tx?.personalRatio !== null && tx?.personalRatio !== undefined && String(tx.personalRatio).trim() !== '' && Number.isFinite(Number(tx.personalRatio))) {
  return clamp01(tx.personalRatio, 1);
}
  const account = accountsById?.[tx?.accountId];
  if (!account?.shared) return 1;
  const type = normalizeTxType(tx?.type);
  if (type === 'expense') return clampRatio(account?.sharedRatio, 0.5);
  if (type === 'income') return 0;
  return 0;
}
function personalDeltaForTx(tx = {}, accountsById = {}) {
  const safeType = normalizeTxType(tx?.type);
  const amount = Number(tx?.amount || 0);
  if (!Number.isFinite(amount)) return 0;
  const ratio = personalRatioForTx(tx, accountsById);
if (safeType === 'income') {
  const acc = accountsById[tx?.accountId];
  if (acc?.shared) return 0;
  return amount;
}  if (safeType === 'expense') return -amount * ratio;
  if (safeType === 'transfer') return 0;
  return 0;
}
function movementSign(type) { return type === 'income' ? 1 : -1; }
function txSortTs(row) {
  return new Date(row?.date || row?.dateISO || 0).getTime() || 0;
}
function normalizeTxType(type = '') {
  const safe = String(type || '').trim().toLowerCase();
  if (safe === 'ingreso' || safe === 'ingresos') return 'income';
  if (safe === 'gasto' || safe === 'gastos' || safe === 'egreso' || safe === 'egresos') return 'expense';
  if (safe === 'transferencia' || safe === 'traspaso') return 'transfer';
  if (safe === 'income' || safe === 'expense' || safe === 'transfer') return safe;
  if (safe === 'invest') return 'expense';
  return 'expense';
}
function normalizeTxRow(raw = {}, id = '') {
  const row = raw && typeof raw === 'object' ? raw : {};
  const type = normalizeTxType(row.type ?? row?.extras?.type);
  let amount = row.amount;
  amount = (typeof amount === 'number') ? amount : parseMoney(String(amount ?? ''));
  amount = Number.isFinite(amount) ? amount : 0;
  const dateISO = toIsoDay(String(row.date || row.dateISO || '')) || '';
  const date = dateISO || String(row.date || row.dateISO || '');
  const monthKey = String(row.monthKey ?? row?.extras?.monthKey ?? (dateISO ? dateISO.slice(0, 7) : '') ?? '').slice(0, 7);
  return {
    id: String(row.id || id || ''),
    ...row,
    type,
    amount,
    date: dateISO || date,
    dateISO: dateISO || date,
    monthKey
  };
}
function normalizeBalanceRowRecord(id, row = {}, source = 'transactions', fallbackPath = '', fallbackMonthKey = '') {
  const normalized = normalizeTxRow(row, id);
  const dateISO = String(normalized?.dateISO || '');
  const date = String(normalized?.date || isoToDay(dateISO || normalized?.date || '') || '');
  const monthKey = String(normalized?.monthKey || date.slice(0, 7) || fallbackMonthKey || '');
  const parsedTs = new Date(date || dateISO || 0).getTime();
  if (FINANCE_DEBUG && !Number.isFinite(parsedTs) && (date || dateISO)) {
    console.log('[BALANCE] invalid date row', { source, id, date, dateISO, monthKey });
  }
  return {
    id,
    ...row,
    ...normalized,
    __src: source,
    __path: row?.__path || fallbackPath,
    accountId: String(row?.accountId || ''),
    fromAccountId: String(row?.fromAccountId ?? row?.extras?.fromAccountId ?? ''),
    toAccountId: String(row?.toAccountId ?? row?.extras?.toAccountId ?? ''),
    note: String(row?.note ?? row?.extras?.note ?? ''),
    date,
    dateISO,
    monthKey,
    category: String(row?.category || ''),
    linkedHabitId: String(row?.linkedHabitId || '').trim() || null,
    personalRatio: (row?.personalRatio !== null && row?.personalRatio !== undefined && String(row.personalRatio).trim() !== '' && Number.isFinite(Number(row.personalRatio)))
      ? clamp01(row.personalRatio, 1)
      : null,
    allocation: normalizeTxAllocation(row?.allocation || {}, String(date || isoToDay(dateISO || '') || '')),
    createdAt: Number(row?.createdAt || 0),
    updatedAt: Number(row?.updatedAt || 0),
    extras: normalizeFoodExtras(row?.extras || row?.food || {}, Number(normalized?.amount || 0))
  };
}
function collectBalanceRows(balance = {}, financePath = state.financePath) {
  const fromNew = Object.entries(balance?.transactions || {}).map(([id, row]) => normalizeBalanceRowRecord(id, row, 'transactions', `${financePath}/transactions/${id}`));

  const fromLegacy = [];
  Object.entries(balance?.movements || {}).forEach(([monthKey, rows]) => {
    Object.entries(rows || {}).forEach(([id, row]) => {
      fromLegacy.push(normalizeBalanceRowRecord(id, row, 'movements', `${financePath}/movements/${monthKey}/${id}`, monthKey));
    });
  });

  const legacyTx = Object.entries(balance?.tx || {}).map(([id, row]) => normalizeBalanceRowRecord(id, row, 'tx', `${financePath}/tx/${id}`));
  const newIds = new Set(fromNew.map((row) => String(row.id)));
  const legacyRows = [...fromLegacy, ...legacyTx].filter((row) => !fromNew.length || !newIds.has(String(row.id)));
  const dedup = new Map();
  [...fromNew, ...legacyRows].forEach((row) => {
    const uniqueKey = row.__path || `${row.__src}:${row.id}`;
    if (!dedup.has(uniqueKey)) dedup.set(uniqueKey, row);
  });
  return [...dedup.values()]
    .filter((row) => Number.isFinite(row.amount) && row.monthKey)
    .sort((a, b) => (txSortTs(b) - txSortTs(a)) || (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
}
function collectBalanceRowsFromRoot(root = {}, financePath = state.financePath) {
  return collectBalanceRows({
    tx: root.balance?.tx || root.tx || {},
    movements: root.movements || root.balance?.movements || root.balance?.movement || {},
    transactions: root.transactions || root.balance?.transactions || root.balance?.tx2 || {}
  }, financePath);
}
async function loadFinanceRoot() {
  return loadFinanceRootByBranches(state.financePath, {
    reason: 'finance-core-root-load',
    viewId: 'view-finance',
  });
}
function syncLocalAccountsFromRoot(root = {}) {
  if (!root?.accounts || typeof root.accounts !== 'object') return;
  state.accounts = Object.values(root.accounts).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function pruneLocalLegacyTxRows(txId) {
  const safeId = String(txId || '').trim();
  if (!safeId) return;
  state.balance = state.balance || {};
  state.balance.movements = Object.fromEntries(
    Object.entries(state.balance.movements || {})
      .map(([monthKey, rows]) => [monthKey, Object.fromEntries(Object.entries(rows || {}).filter(([id]) => String(id) !== safeId))])
      .filter(([, rows]) => Object.keys(rows || {}).length)
  );
  if (state.balance.tx?.[safeId]) delete state.balance.tx[safeId];
}
function removeLocalTxEverywhere(txId) {
  const safeId = String(txId || '').trim();
  if (!safeId) return;
  state.balance = state.balance || {};
  if (state.balance.transactions?.[safeId]) delete state.balance.transactions[safeId];
  pruneLocalLegacyTxRows(safeId);
}
function isFoodCategory(category = '') {
  const normalized = String(category || '').trim().toLowerCase();
  return normalized === 'comida' || normalized === 'food';
}
function normalizeFoodName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
}
function normalizeFoodCompareKey(value = '') {
  return normalizeFoodName(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/^[\s\-_,.;:¡!¿?()\[\]{}"'`]+|[\s\-_,.;:¡!¿?()\[\]{}"'`]+$/g, '');
}

function normalizeProductItemLabel(value = '') {
  return normalizeFoodName(value);
}

function normalizeProductItemKey(value = '') {
  return normalizeFoodCompareKey(value);
}
function ticketCategoryToTxCategory(category = '') {
  const safe = String(category || '').trim().toLowerCase();
  if (!safe || safe === 'otros' || safe === 'hogar' || safe === 'higiene' || safe === 'mascotas') return 'Otros';
  return 'Comida';
}


function resolveProductIdentity(item = {}, productsById = {}) {
  const explicitId = String(item?.foodId || item?.productId || '').trim();
  if (explicitId && productsById[explicitId]) return explicitId;
  const productKey = String(item?.productKey || firebaseSafeKey(item?.name || '')).trim();
  if (!productKey) return '';
  const found = Object.values(productsById || {}).find((product) => {
    if (!product) return false;
    if (String(product.idKey || '') === productKey) return true;
    if (firebaseSafeKey(product?.name || '') === productKey) return true;
    if (firebaseSafeKey(product?.displayName || '') === productKey) return true;
    return Array.isArray(product?.aliases) && product.aliases.some((alias) => firebaseSafeKey(alias || '') === productKey);
  });
  return String(found?.id || productKey);
}

function computeUnitPrice(totalPriceInput, qtyInput) {
  const totalPrice = Number(totalPriceInput || 0);
  const qty = Number(qtyInput || 0);
  if (!Number.isFinite(totalPrice) || totalPrice <= 0) return 0;
  if (!Number.isFinite(qty) || qty <= 0) return Number(totalPrice.toFixed(2));
  return Number((totalPrice / qty).toFixed(2));
}

function appendPriceHistoryPoint(pointsByVendorAndDate = {}, row = {}) {
  const vendor = firebaseSafeKey(row?.vendor || 'unknown') || 'unknown';
  const ts = Number(row?.ts || 0);
  const date = String(row?.date || dayKeyFromTs(ts));
  if (!vendor || !date) return pointsByVendorAndDate;
  const key = `${vendor}__${date}`;
  const current = pointsByVendorAndDate[key];
  if (!current || ts >= Number(current.ts || 0)) {
    pointsByVendorAndDate[key] = {
      ...row,
      vendor,
      date,
      ts: Number.isFinite(ts) && ts > 0 ? ts : parseDayKey(date)
    };
  }
  return pointsByVendorAndDate;
}

function getProductItemRows(rows = [], options = {}) {
  const amountByTxId = options?.amountByTxId || {};
  const productsById = options?.productsById || {};
  const vendorFilter = String(options?.vendor || 'all');
  const accountFilter = String(options?.account || 'all');
  const onlyFood = !!options?.onlyFood;
  const output = [];
  rows.forEach((row) => {
    if (normalizeTxType(row?.type) !== 'expense') return;
    const txAmount = Math.abs(Number(amountByTxId[row.id] ?? row.amount ?? 0));
    if (!txAmount) return;
    const ts = txTs(row);
    if (!Number.isFinite(ts) || ts <= 0) return;
    if (accountFilter !== 'all' && String(row?.accountId || '') !== accountFilter) return;
    const txVendor = firebaseSafeKey(normalizeFoodName(row?.extras?.filters?.place || row?.extras?.place || 'unknown')) || 'unknown';
    const validLines = foodItemsFromTx(row).map((item) => {
      const displayName = normalizeProductItemLabel(item?.name || item?.item || item?.productName || '');
      const totalPrice = Math.abs(Number(item?.totalPrice ?? item?.amount ?? item?.price ?? 0));
      const qty = Math.max(1, Number(item?.qty || 1));
      const unit = String(item?.unit || 'ud').trim() || 'ud';
      const unitPrice = Number(item?.unitPrice || computeUnitPrice(totalPrice, qty));
      const vendorKey = firebaseSafeKey(normalizeFoodName(item?.place || txVendor || 'unknown')) || 'unknown';
      const productId = resolveProductIdentity(item, productsById);
      const canonicalName = normalizeProductItemLabel(productsById?.[productId]?.displayName || productsById?.[productId]?.name || displayName || productId || 'Sin datos') || 'Sin datos';
      return {
        txId: String(row?.id || ''),
        accountId: String(row?.accountId || ''),
        ts,
        date: dayKeyFromTs(ts),
        vendorKey,
        itemCategory: String(item?.category || item?.category_app || row?.category || ''),
        nameRaw: displayName,
        foodId: String(item?.foodId || ''),
        productKey: String(item?.productKey || ''),
        productId: String(productId || ''),
        canonicalName,
        qty,
        unit,
        totalPrice,
        unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : totalPrice,
      };
    }).filter((line) => line.nameRaw);
    if (!validLines.length) return;
    const hasDirectLinePrices = validLines.some((line) => line.totalPrice > 0);
    const normalizedLines = hasDirectLinePrices
      ? validLines
      : (() => {
        const totalQty = validLines.reduce((sum, line) => sum + Math.max(1, Number(line.qty || 1)), 0) || validLines.length;
        return validLines.map((line) => {
          const weight = Math.max(1, Number(line.qty || 1)) / totalQty;
          const fallbackTotal = txAmount * weight;
          return {
            ...line,
            totalPrice: fallbackTotal,
            unitPrice: computeUnitPrice(fallbackTotal, line.qty)
          };
        });
      })();
    const linesTotal = normalizedLines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0) || 1;
    normalizedLines.forEach((line) => {
      if (vendorFilter !== 'all' && line.vendorKey !== vendorFilter) return;
      if (onlyFood && !isFoodCategory(line.itemCategory || '')) return;
      output.push({
        ...line,
        scopedAmount: txAmount * (Number(line.totalPrice || 0) / linesTotal)
      });
    });
  });
  return output;
}

function accumulateSpendByProduct(rows = [], amountByTxId = {}, productsById = {}) {
  const spend = {};
  const productKeyByLabel = {};
  const statsByProduct = {};
  const productItemRows = getProductItemRows(rows, { amountByTxId, productsById });
  productItemRows.forEach((line) => {
      const label = normalizeProductItemLabel(line.canonicalName || line.nameRaw || line.productId || 'Sin datos') || 'Sin datos';
      spend[label] = (spend[label] || 0) + Number(line.scopedAmount || 0);
      productKeyByLabel[label] = line.productId || line.productKey || firebaseSafeKey(label);
      const prev = statsByProduct[label] || { purchaseCount: 0, sumUnitPriceWeighted: 0, sumQty: 0, units: new Set() };
      prev.purchaseCount += 1;
      prev.sumUnitPriceWeighted += Number(line.unitPrice || 0) * Number(line.qty || 1);
      prev.sumQty += Number(line.qty || 1);
      prev.units.add(line.unit || 'ud');
      statsByProduct[label] = prev;
  });
  return { spend, productKeyByLabel, statsByProduct, rows: productItemRows };
}

function normalizeCardLast4(value = '') {
  const digits = String(value || '').replace(/\D/g, '').slice(0, 4);
  return /^\d{4}$/.test(digits) ? digits : '';
}

function getCardLast4Duplicates(cardLast4 = '', currentAccountId = '') {
  const normalized = normalizeCardLast4(cardLast4);
  if (!normalized) return [];
  return (state.accounts || []).filter((account) => String(account?.id || '') !== String(currentAccountId || '') && normalizeCardLast4(account?.cardLast4 || '') === normalized);
}

const ACCOUNT_MERGE_STOPWORDS = new Set([
  'banco',
  'bank',
  'cuenta',
  'account',
  'cta',
  'tarjeta',
  'card',
  'visa',
  'mastercard',
  'master',
  'debito',
  'debit',
  'credito',
  'credit',
  'prepago',
  'prepaid',
  'corriente',
  'checking',
  'ahorro',
  'savings',
  'shared',
  'compartida',
  'personal',
  'main',
  'principal',
  'wallet',
  'monedero',
  'the',
  'del',
  'de',
  'la',
  'el',
  'los',
  'las',
  'mi',
  'my'
]);

const ACCOUNT_MERGE_TYPE_TOKENS = new Set([
  'debito',
  'debit',
  'credito',
  'credit',
  'prepago',
  'prepaid',
  'corriente',
  'checking',
  'ahorro',
  'savings',
  'cash',
  'efectivo',
  'wallet',
  'bitcoin',
  'btc',
  'crypto',
  'cripto',
  'shared',
  'compartida'
]);

function normalizeAccountName(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenizeAccountName(value = '') {
  return normalizeAccountName(value).split(' ').filter(Boolean);
}

function getAccountEntryMap(account = {}) {
  if (account?.entries && typeof account.entries === 'object' && !Array.isArray(account.entries)) return account.entries;
  if (account?.daily && typeof account.daily === 'object' && !Array.isArray(account.daily)) return account.daily;
  return {};
}

function getAccountEntryCount(account = {}) {
  return normalizeDaily(getAccountEntryMap(account)).length;
}

function getAccountSnapshotCount(account = {}) {
  return normalizeSnapshots(account?.snapshots || {}).length;
}

function getAccountSemanticTokens(account = {}) {
  return tokenizeAccountName(account?.name || '')
    .filter((token) => token.length > 1 && !ACCOUNT_MERGE_STOPWORDS.has(token));
}

function getAccountMergeExtraText(account = {}) {
  return [
    account?.alias,
    account?.bank,
    account?.bankName,
    account?.entity,
    account?.type,
    account?.kind,
    account?.nickname,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .join(' ');
}

function detectAccountTypeHint(account = {}, tokens = []) {
  if (account?.isBitcoin || tokens.includes('bitcoin') || tokens.includes('btc') || tokens.includes('crypto') || tokens.includes('cripto')) return 'bitcoin';
  if (tokens.includes('credito') || tokens.includes('credit')) return 'credit';
  if (tokens.includes('debito') || tokens.includes('debit')) return 'debit';
  if (tokens.includes('ahorro') || tokens.includes('savings')) return 'savings';
  if (tokens.includes('corriente') || tokens.includes('checking')) return 'checking';
  if (tokens.includes('cash') || tokens.includes('efectivo')) return 'cash';
  if (account?.shared) return 'shared';
  return '';
}

function buildAccountMergeUsageMap(accounts = state.accounts, txRows = balanceTxList()) {
  const usage = {};
  (accounts || []).forEach((account) => {
    const id = String(account?.id || '').trim();
    if (!id) return;
    usage[id] = {
      txRefs: 0,
      recurringRefs: 0,
      goalRefs: 0,
      entryCount: getAccountEntryCount(account),
      snapshotCount: getAccountSnapshotCount(account),
      legacyCount: Object.keys(normalizeLegacyEntries(state.legacyEntries?.[id] || {})).length,
    };
  });

  (txRows || []).forEach((row) => {
    [row?.accountId, row?.fromAccountId, row?.toAccountId].forEach((accountId) => {
      const id = String(accountId || '').trim();
      if (!id || !usage[id]) return;
      usage[id].txRefs += 1;
    });
  });

  Object.values(state.balance?.recurring || {}).forEach((row) => {
    [row?.accountId, row?.fromAccountId, row?.toAccountId].forEach((accountId) => {
      const id = String(accountId || '').trim();
      if (!id || !usage[id]) return;
      usage[id].recurringRefs += 1;
    });
  });

  Object.values(state.goals?.goals || {}).forEach((goal) => {
    (goal?.accountsIncluded || []).forEach((accountId) => {
      const id = String(accountId || '').trim();
      if (!id || !usage[id]) return;
      usage[id].goalRefs += 1;
    });
  });

  return usage;
}

function buildAccountMergeProfile(account = {}, usage = {}) {
  const extraText = getAccountMergeExtraText(account);
  const normalizedName = normalizeAccountName(account?.name || '');
  const normalizedExtra = normalizeAccountName(extraText);
  const rawTokens = [...new Set([
    ...tokenizeAccountName(account?.name || ''),
    ...tokenizeAccountName(extraText),
  ])];
  const semanticTokens = rawTokens.filter((token) => token.length > 1 && !ACCOUNT_MERGE_STOPWORDS.has(token));
  const nameTokens = semanticTokens.filter((token) => !ACCOUNT_MERGE_TYPE_TOKENS.has(token) && !/^\d+$/.test(token));
  const baseName = nameTokens.join(' ').trim() || semanticTokens.join(' ').trim() || normalizedName;
  const cardLast4 = normalizeCardLast4(account?.cardLast4 || '');
  const typeHint = detectAccountTypeHint(account, rawTokens);
  const searchText = [
    normalizedName,
    normalizedExtra,
    baseName,
    nameTokens.join(' '),
    semanticTokens.join(' '),
    cardLast4,
    typeHint,
    account?.shared ? 'shared compartida' : '',
    account?.isBitcoin ? 'bitcoin btc crypto cripto' : '',
  ].filter(Boolean).join(' ');
  const referenceCount = Number(usage?.txRefs || 0) + Number(usage?.recurringRefs || 0) + Number(usage?.goalRefs || 0);
  return {
    id: String(account?.id || '').trim(),
    normalizedName,
    semanticTokens,
    nameTokens,
    baseName,
    cardLast4,
    typeHint,
    searchText,
    referenceCount,
    dataDensity: Number(usage?.entryCount || 0) + Number(usage?.snapshotCount || 0) + Number(usage?.legacyCount || 0),
    usage,
  };
}

function compareTokenSets(left = [], right = []) {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const common = [...leftSet].filter((token) => rightSet.has(token));
  const denom = Math.max(leftSet.size, rightSet.size, 1);
  return {
    common,
    ratio: common.length / denom,
  };
}

function getAccountMergeSuggestionModel(accounts = state.accounts) {
  const cache = financeDerivedCache.accountMerge;
  if (
    cache.accountsRef === state.accounts &&
    cache.balanceRef === state.balance &&
    cache.goalsRef === state.goals?.goals &&
    cache.model
  ) {
    return cache.model;
  }

  const usageById = buildAccountMergeUsageMap(accounts, balanceTxList());
  const profilesById = Object.fromEntries((accounts || []).map((account) => {
    const id = String(account?.id || '').trim();
    return [id, buildAccountMergeProfile(account, usageById[id] || {})];
  }));

  const suggestions = [];
  for (let index = 0; index < (accounts || []).length; index += 1) {
    for (let compareIndex = index + 1; compareIndex < (accounts || []).length; compareIndex += 1) {
      const left = accounts[index];
      const right = accounts[compareIndex];
      const leftId = String(left?.id || '').trim();
      const rightId = String(right?.id || '').trim();
      const leftProfile = profilesById[leftId];
      const rightProfile = profilesById[rightId];
      if (!leftProfile || !rightProfile) continue;

      let score = 0;
      const reasons = [];
      const sameNormalized = leftProfile.normalizedName && leftProfile.normalizedName === rightProfile.normalizedName;
      const sameBaseName = leftProfile.baseName && leftProfile.baseName === rightProfile.baseName && leftProfile.baseName.length >= 4;
      const baseContains = leftProfile.baseName && rightProfile.baseName
        && leftProfile.baseName !== rightProfile.baseName
        && (
          (leftProfile.baseName.length >= 5 && rightProfile.baseName.includes(leftProfile.baseName))
          || (rightProfile.baseName.length >= 5 && leftProfile.baseName.includes(rightProfile.baseName))
        );
      const overlap = compareTokenSets(leftProfile.semanticTokens, rightProfile.semanticTokens);
      const strongCommonTokens = overlap.common.filter((token) => !ACCOUNT_MERGE_TYPE_TOKENS.has(token) && token.length >= 3);
      const sameLast4 = leftProfile.cardLast4 && leftProfile.cardLast4 === rightProfile.cardLast4;
      const sameType = leftProfile.typeHint && leftProfile.typeHint === rightProfile.typeHint;
      const genericOnly = !sameLast4 && !sameBaseName && !baseContains && strongCommonTokens.length === 0;

      if (sameNormalized) {
        score += 34;
        reasons.push('nombre normalizado igual');
      }
      if (sameBaseName) {
        score += 32;
        reasons.push('nombre base igual');
      } else if (baseContains) {
        score += 22;
        reasons.push('nombre base contenido');
      }
      if (sameLast4) {
        score += 40;
        reasons.push(`misma tarjeta ••••${leftProfile.cardLast4}`);
      }
      if (strongCommonTokens.length >= 2 && overlap.ratio >= 0.5) {
        score += 18;
        reasons.push(`tokens comunes: ${strongCommonTokens.slice(0, 2).join(', ')}`);
      } else if (strongCommonTokens.length >= 1 && overlap.ratio >= 0.34) {
        score += 10;
        reasons.push(`token común: ${strongCommonTokens[0]}`);
      }
      if (sameType) {
        score += 6;
        reasons.push(`tipo parecido: ${leftProfile.typeHint}`);
      }
      if (!!left?.isBitcoin !== !!right?.isBitcoin) score -= 18;
      if (!!left?.shared !== !!right?.shared && !sameLast4) score -= 4;
      if (genericOnly || score < 40) continue;

      suggestions.push({
        id: `acc-merge-${hashString(`${leftId}:${rightId}:${score}`)}`,
        accountIds: [leftId, rightId],
        score,
        reasons: [...new Set(reasons)].slice(0, 3),
      });
    }
  }

  suggestions.sort((left, right) => {
    if (right.score !== left.score) return right.score - left.score;
    const leftNames = left.accountIds.map((id) => String(accounts.find((account) => account.id === id)?.name || id)).join(' ');
    const rightNames = right.accountIds.map((id) => String(accounts.find((account) => account.id === id)?.name || id)).join(' ');
    return leftNames.localeCompare(rightNames, 'es', { sensitivity: 'base' });
  });

  cache.accountsRef = state.accounts;
  cache.balanceRef = state.balance;
  cache.goalsRef = state.goals?.goals;
  cache.model = {
    usageById,
    profilesById,
    suggestions,
  };
  return cache.model;
}

function getPossibleAccountMergeSuggestions(accounts = state.accounts) {
  return getAccountMergeSuggestionModel(accounts).suggestions;
}

function scoreAccountAsMergePrimary(account = {}, usage = {}) {
  const profile = buildAccountMergeProfile(account, usage);
  const createdAtBonus = Number(account?.createdAt || 0) > 0 ? 1 / Math.max(1, Number(account.createdAt || 1)) : 0;
  return (
    profile.referenceCount * 8
    + profile.dataDensity * 4
    + (profile.cardLast4 ? 10 : 0)
    + (profile.baseName.length >= 4 ? 6 : 0)
    + (profile.typeHint ? 3 : 0)
    + createdAtBonus
  );
}

function choosePreferredAccountMergeDestination(accountIds = [], accountsById = {}, usageById = {}) {
  const ids = [...new Set((accountIds || []).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return '';
  return ids
    .slice()
    .sort((leftId, rightId) => {
      const left = accountsById[leftId] || {};
      const right = accountsById[rightId] || {};
      const leftScore = scoreAccountAsMergePrimary(left, usageById[leftId] || {});
      const rightScore = scoreAccountAsMergePrimary(right, usageById[rightId] || {});
      if (rightScore !== leftScore) return rightScore - leftScore;
      const leftCreatedAt = Number(left?.createdAt || 0);
      const rightCreatedAt = Number(right?.createdAt || 0);
      if (leftCreatedAt !== rightCreatedAt) return leftCreatedAt - rightCreatedAt;
      return String(left?.name || leftId).localeCompare(String(right?.name || rightId), 'es', { sensitivity: 'base' });
    })[0];
}

function resolveTicketCardAccountPreview(ticket = null, accounts = []) {
  const cardLast4 = String(ticket?.purchase?.card_last4 || '').trim();
  if (!/^\d{4}$/.test(cardLast4)) return { cardLast4: '', matches: [], selected: null, status: 'none' };
  const matches = accounts.filter((account) => normalizeCardLast4(account?.cardLast4 || '') === cardLast4);
  if (matches.length === 1) return { cardLast4, matches, selected: matches[0], status: 'single' };
  if (matches.length > 1) return { cardLast4, matches, selected: null, status: 'multiple' };
  return { cardLast4, matches: [], selected: null, status: 'zero' };
}
function isTicketExtraLike(name = '') {
  const safe = normalizeFoodName(name).toLowerCase();
  return /bolsa|descuento|cupon|cupón|redondeo|deposito|depósito/.test(safe);
}
function toTicketPriceLine(item = {}) {
  const fromGuess = escapeHtml(String(item.category_guess || 'otros'));
  const toApp = escapeHtml(String(item.category_app || mapTicketCategoryToApp(item.category_guess || 'otros')));
  const inferredNote = item.category_inferred ? ' ⚠ heurística' : '';
  return `${escapeHtml(item.name_norm || item.name_raw || 'Producto')} — ${fromGuess} → ${toApp}${inferredNote} · ${Number(item.qty || 1)} × ${fmtCurrency(item.total_price || 0)}`;
}
function normalizeFoodMap(map = {}) {
  const out = {};
  Object.entries(map || {}).forEach(([name, payload]) => {
    const safeName = normalizeFoodName(name);
    if (!safeName) return;
    out[safeName] = {
      createdAt: Number(payload?.createdAt || 0) || nowTs(),
      count: Number(payload?.count || 0),
      lastUsedAt: Number(payload?.lastUsedAt || 0),
      lastPrice: Number(payload?.lastPrice || 0),
      lastCategory: String(payload?.lastCategory || ''),
      lastAccountId: String(payload?.lastAccountId || ''),
      lastNote: String(payload?.lastNote || ''),
      lastExtras: payload?.lastExtras || {}
    };
  });
  return out;
}
function financeDebug(...parts) {
  if (!FINANCE_DEBUG) return;
  console.log('[FINANCE][DEBUG]', ...parts);
}

function normalizeProductText(value = '') {
  return String(value || '').trim();
}

function normalizeProductNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function normalizeProductPositiveNumber(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

function normalizeProductUnit(value = '') {
  return normalizeProductText(value).toLowerCase() || 'ud';
}

function normalizeProductTags(value = []) {
  const source = Array.isArray(value)
    ? value
    : String(value || '').split(',');
  return [...new Set(source.map((entry) => normalizeFoodName(entry)).filter(Boolean))];
}

function normalizeProductBoolean(value, fallback = true) {
  if (value === null || value === undefined || value === '') return fallback;
  return !(value === false || value === 'false' || value === 0 || value === '0');
}

function normalizeProductDateValue(value = '') {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  const iso = toIsoDay(String(value || ''));
  if (!iso) return 0;
  return parseDayKey(iso);
}

function createFinanceProductId(name = '', existingMap = {}) {
  const seed = firebaseSafeKeyLoose(normalizeFoodName(name || '').replace(/\s+/g, '-'));
  const base = `prd-${seed || 'item'}`;
  if (!existingMap?.[base]) return base;
  let index = 2;
  while (existingMap?.[`${base}-${index}`]) index += 1;
  return `${base}-${index}`;
}

function normalizeFinanceProductMeta(payload = {}, previous = {}) {
  return {
    productType: normalizeFoodName(payload?.productType || payload?.mealType || previous?.productType || previous?.mealType || ''),
    productCategory: normalizeFoodName(payload?.productCategory || payload?.subtype || previous?.productCategory || previous?.subtype || ''),
    preferredStore: normalizeFoodName(payload?.preferredStore || payload?.place || previous?.preferredStore || previous?.place || ''),
    brand: normalizeProductText(payload?.brand || previous?.brand || ''),
    format: normalizeProductText(payload?.format || payload?.size || previous?.format || previous?.size || ''),
    usualPrice: normalizeProductPositiveNumber(payload?.usualPrice, normalizeProductPositiveNumber(previous?.usualPrice, 0)),
    estimatedPrice: normalizeProductPositiveNumber(payload?.estimatedPrice, normalizeProductPositiveNumber(previous?.estimatedPrice, 0)),
    lastPrice: normalizeProductPositiveNumber(payload?.lastPrice, normalizeProductPositiveNumber(previous?.lastPrice, 0)),
    usualQty: normalizeProductPositiveNumber(payload?.usualQty, normalizeProductPositiveNumber(previous?.usualQty, 1)),
    unit: normalizeProductUnit(payload?.unit || previous?.unit || 'ud'),
    lastPurchaseAt: normalizeProductDateValue(payload?.lastPurchaseAt || previous?.lastPurchaseAt || 0),
    purchaseFrequencyDays: normalizeProductPositiveNumber(payload?.purchaseFrequencyDays, normalizeProductPositiveNumber(previous?.purchaseFrequencyDays, 0)),
    estimatedDurationDays: normalizeProductPositiveNumber(payload?.estimatedDurationDays, normalizeProductPositiveNumber(previous?.estimatedDurationDays, 0)),
    notes: normalizeProductText(payload?.notes || previous?.notes || ''),
    active: normalizeProductBoolean(payload?.active, normalizeProductBoolean(previous?.active, true)),
    tags: normalizeProductTags(payload?.tags ?? previous?.tags ?? []),
  };
}

function normalizeFoodEntityMap(map = {}) {
  const out = {};
  const nameToId = {};
  Object.entries(map || {}).forEach(([id, payload]) => {
    const safeId = String(id || '').trim();
    if (!safeId) return;
    const safeName = normalizeFoodName(payload?.name || '');
    if (!safeName) return;
    out[safeId] = {
      id: safeId,
      idKey: String(payload?.idKey || firebaseSafeKey(safeName)),
      name: safeName,
      displayName: String(payload?.displayName || safeName),
      aliases: Array.isArray(payload?.aliases) ? payload.aliases.map((alias) => normalizeFoodName(alias)).filter(Boolean) : [],
      vendorAliases: payload?.vendorAliases && typeof payload.vendorAliases === 'object' ? payload.vendorAliases : {},
      createdFromVendor: String(payload?.createdFromVendor || ''),
      mealType: normalizeFoodName(payload?.mealType || payload?.foodMealType || ''),
      cuisine: normalizeFoodName(payload?.cuisine || payload?.healthy || payload?.foodCuisine || ''),
      healthy: normalizeFoodName(payload?.healthy || payload?.cuisine || ''),
      place: normalizeFoodName(payload?.place || payload?.foodPlace || ''),
      defaultPrice: Number(payload?.defaultPrice || 0),
      ...normalizeFinanceProductMeta(payload, payload),
      priceHistory: normalizeFoodPriceHistory(payload?.priceHistory || {}),
      countUsed: Number(payload?.countUsed || payload?.count || 0),
      createdAt: Number(payload?.createdAt || 0) || nowTs(),
      updatedAt: Number(payload?.updatedAt || 0) || nowTs()
    };
    nameToId[safeName.toLowerCase()] = safeId;
  });
  return { out, nameToId };
}

function normalizeFoodPriceHistory(map = {}) {
  const out = {};
  const entries = Object.entries(map || {});
  const looksLikeLegacy = entries.some(([, value]) => Number.isFinite(Number(value?.price)));
  if (looksLikeLegacy) {
    out.unknown = {};
    entries.forEach(([entryId, value]) => {
      const price = Number(value?.price);
      const ts = Number(value?.ts || 0);
      if (!entryId || !Number.isFinite(price) || !Number.isFinite(ts) || ts <= 0) return;
      out.unknown[entryId] = {
        price,
        ts,
        date: String(value?.date || dayKeyFromTs(ts)),
        source: String(value?.source || ''),
        expenseId: String(value?.expenseId || ''),
        vendor: 'unknown',
        unitPrice: Number(value?.unitPrice || price),
        linePrice: Number(value?.linePrice || price)
      };
    });
    return out;
  }
  entries.forEach(([vendorRaw, vendorRows]) => {
    const vendor = firebaseSafeKey(vendorRaw) || 'unknown';
    out[vendor] = {};
    Object.entries(vendorRows || {}).forEach(([entryId, value]) => {
      const price = Number(value?.price);
      const ts = Number(value?.ts || 0);
      if (!entryId || !Number.isFinite(price) || !Number.isFinite(ts) || ts <= 0) return;
      out[vendor][entryId] = {
        price,
        ts,
        date: String(value?.date || dayKeyFromTs(ts)),
        source: String(value?.source || ''),
        expenseId: String(value?.expenseId || ''),
        vendor,
        unitPrice: Number(value?.unitPrice || price),
        linePrice: Number(value?.linePrice || price)
      };
    });
  });
  return out;
}

function foodPriceHistoryList(food = {}) {
  return Object.entries(food?.priceHistory || {}).flatMap(([vendorKey, vendorRows]) => Object.entries(vendorRows || {}).map(([entryId, row]) => ({
      entryId: String(entryId || ''),
      vendor: firebaseSafeKey(vendorKey) || 'unknown',
      price: Number(row?.price),
      unitPrice: Number(row?.unitPrice || row?.price || 0),
      linePrice: Number(row?.linePrice || row?.price || 0),
      ts: Number(row?.ts),
      date: String(row?.date || dayKeyFromTs(Number(row?.ts || 0))),
      source: String(row?.source || ''),
      expenseId: String(row?.expenseId || '')
    })))
    .filter((row) => Number.isFinite(Number(row?.price)) && Number.isFinite(Number(row?.ts)))
    .sort((a, b) => a.ts - b.ts);
}

function resolveFoodItemByAnyKey(rawKey = '') {
  const safeKey = String(rawKey || '').trim();
  if (!safeKey) return null;
  if (state.food.itemsById?.[safeKey]) return state.food.itemsById[safeKey];
  const normalized = firebaseSafeKey(safeKey);
  return Object.values(state.food.itemsById || {}).find((item) => {
    if (!item) return false;
    if (String(item.id || '') === safeKey) return true;
    if (String(item.idKey || '') === safeKey) return true;
    if (firebaseSafeKey(item?.name || '') === safeKey) return true;
    if (firebaseSafeKey(item?.displayName || '') === safeKey) return true;
    return normalized && (String(item.idKey || '') === normalized || firebaseSafeKey(item?.name || '') === normalized);
  }) || null;
}

function foodHistoryFromTransactions(food = {}) {
  const byKey = {};
  const foodId = String(food?.id || '');
  const foodName = normalizeFoodName(food?.name || '').toLowerCase();
  const foodDisplay = normalizeFoodName(food?.displayName || '').toLowerCase();
  const foodIdKey = String(food?.idKey || firebaseSafeKey(food?.name || '') || '');
  balanceTxList().forEach((row) => {
    if (normalizeTxType(row?.type) !== 'expense') return;
    const txItems = foodItemsFromTx(row);
    txItems.forEach((item) => {
      const itemFoodId = String(item?.foodId || '');
      const itemName = normalizeFoodName(item?.name || '').toLowerCase();
      const itemKey = String(item?.productKey || firebaseSafeKey(item?.name || '') || '');
      const matches = (foodId && itemFoodId === foodId)
        || (foodIdKey && itemKey === foodIdKey)
        || (foodName && itemName === foodName)
        || (foodDisplay && itemName === foodDisplay);
      if (!matches) return;
      const ts = Number(row?.date ? parseDayKey(row.date) : txSortTs(row));

const totalPriceRaw = item?.totalPrice ?? item?.amount ?? item?.price ?? 0;
const totalPrice = Number(totalPriceRaw);

if (!Number.isFinite(ts) || ts <= 0 || !Number.isFinite(totalPrice) || totalPrice <= 0) return;

const qty = Math.max(1, Number(item?.qty ?? 1));
const unitPrice = Number(item?.unitPrice ?? computeUnitPrice(totalPrice, qty) ?? 0);

const vendor =
  firebaseSafeKey(
    item?.place ??
    row?.extras?.filters?.place ??
    row?.extras?.place ??
    food?.place ??
    "unknown"
  ) || "unknown";

const key = `${vendor}__${String(row?.id ?? "") || ts}`;

byKey[key] = {
  vendor,
  price: unitPrice,
  unitPrice,
  qty,
  unit: String(item?.unit ?? "ud").trim() || "ud",
  totalPrice,
  linePrice: totalPrice,
  ts,
  date: String(row?.date ?? dayKeyFromTs(ts)),
  source: "expense-line",
  expenseId: String(row?.id ?? "")
};
    });
  });
  return Object.values(byKey).sort((a, b) => a.ts - b.ts);
}

function mergedFoodHistory(food = {}) {
  const explicit = foodPriceHistoryList(food);
  const implicit = foodHistoryFromTransactions(food);
  const byVendorAndDate = {};

  [...explicit, ...implicit].forEach((row) => {
    const unitPriceRaw = row?.unitPrice ?? row?.price ?? 0;
    const totalPriceRaw = row?.totalPrice ?? row?.linePrice ?? row?.price ?? 0;
    const linePriceRaw  = row?.linePrice  ?? row?.totalPrice ?? row?.price ?? 0;

    const qty = Math.max(1, Number(row?.qty ?? 1));
    const unit = String(row?.unit ?? "ud").trim() || "ud"; // aquí sí usamos || por si trim() da ''

    const normalized = {
      ...row,
      price: Number(unitPriceRaw),
      unitPrice: Number(unitPriceRaw),
      totalPrice: Number(totalPriceRaw),
      linePrice: Number(linePriceRaw),
      qty,
      unit
    };

    appendPriceHistoryPoint(byVendorAndDate, normalized);
  });

  return Object.values(byVendorAndDate)
    .filter((row) =>
      Number.isFinite(row.ts) &&
      row.ts > 0 &&
      Number.isFinite(Number(row.unitPrice ?? row.price)) &&
      Number(row.unitPrice ?? row.price) > 0
    )
    .sort((a, b) => a.ts - b.ts);
}

function shouldAppendFoodPricePoint(food = {}, priceInput) {
  const price = Number(priceInput);
  if (!Number.isFinite(price) || price <= 0) return false;

  const history = foodPriceHistoryList(food);
  if (!history.length) return true;

  return Math.abs(Number(history[history.length - 1]?.price ?? 0) - price) > 0.001;
}

async function recordFoodPricePoint(foodId, priceInput, source = "expense", options = {}) {
  const safeFoodId = String(foodId ?? "").trim();
  const price = Number(priceInput);
  if (!safeFoodId || !Number.isFinite(price) || price <= 0) return;

  const ts = Number(options?.ts ?? nowTs());
  const vendor = firebaseSafeKey(options?.vendor ?? "unknown") || "unknown";
  const date = String(options?.date ?? dayKeyFromTs(ts));
  const expenseId = String(options?.expenseId ?? "").trim();

  const food = state.food.itemsById?.[safeFoodId] ?? null;

  if (expenseId) {
    const exists = Object.values(food?.priceHistory ?? {}).some((vendorRows) =>
      Object.values(vendorRows ?? {}).some((entry) => String(entry?.expenseId ?? "") === expenseId)
    );
    if (exists) return;
  }

  const entryId = push(ref(db, `${state.financePath}/foodItems/${safeFoodId}/priceHistory/${vendor}`)).key;

  const qty = Math.max(1, Number(options?.qty ?? 1));
  const unit = String(options?.unit ?? "ud").trim() || "ud";

  const totalPrice = Number(options?.totalPrice ?? options?.linePrice ?? price);
  const unitPrice = Number(options?.unitPrice ?? computeUnitPrice(totalPrice, qty) ?? price);

  const payload = {
    price: unitPrice,
    unitPrice,
    qty,
    unit,
    totalPrice,
    linePrice: totalPrice,
    ts: Number.isFinite(ts) && ts > 0 ? ts : nowTs(),
    date,
    vendor,
    source: String(source ?? ""),
    ...(expenseId ? { expenseId } : {})
  };

  await safeFirebase(() =>
    set(ref(db, `${state.financePath}/foodItems/${safeFoodId}/priceHistory/${vendor}/${entryId}`), payload)
  );

  if (!state.food.itemsById?.[safeFoodId]) return;

  if (!state.food.itemsById[safeFoodId].priceHistory?.[vendor]) {
    state.food.itemsById[safeFoodId].priceHistory[vendor] = {};
  }

  state.food.itemsById[safeFoodId].priceHistory = {
    ...(state.food.itemsById[safeFoodId].priceHistory ?? {}),
    [vendor]: {
      ...(state.food.itemsById[safeFoodId].priceHistory?.[vendor] ?? {}),
      [entryId]: payload
    }
  };
}

async function deleteFoodPricePoint(foodId, vendor, entryId) {
  const safeFoodId = String(foodId ?? "").trim();
  const safeVendor = firebaseSafeKey(vendor ?? "unknown") || "unknown";
  const safeEntryId = String(entryId ?? "").trim();
  if (!safeFoodId || !safeEntryId) return false;

  await safeFirebase(() =>
    remove(ref(db, `${state.financePath}/foodItems/${safeFoodId}/priceHistory/${safeVendor}/${safeEntryId}`))
  );

  if (!state.food.itemsById?.[safeFoodId]?.priceHistory?.[safeVendor]) return true;

  const nextVendorRows = { ...(state.food.itemsById[safeFoodId].priceHistory[safeVendor] ?? {}) };
  delete nextVendorRows[safeEntryId];

  state.food.itemsById[safeFoodId].priceHistory = {
    ...(state.food.itemsById[safeFoodId].priceHistory ?? {}),
    [safeVendor]: nextVendorRows
  };

  if (!Object.keys(nextVendorRows).length) {
    delete state.food.itemsById[safeFoodId].priceHistory[safeVendor];
  }
  return true;
}

function getFoodByName(name = '') {
  const safe = normalizeFoodName(name).toLowerCase();
  if (!safe) return null;
  const id = state.food.nameToId?.[safe];
  return id ? state.food.itemsById?.[id] || null : null;
}
function foodOptionList(kind) {
  return Object.keys(state.food.options?.[kind] || {}).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}
function foodItemsList() {
  return Object.values(state.food.itemsById || {}).map((item) => ({
    id: item.id,
    name: item.name,
    count: Number(item.countUsed || 0),
    lastUsedAt: Number(item.updatedAt || 0),
    meta: item
  }));
}

function buildMergeProductDiagnostics() {
  const items = foodItemsList();
  const groups = {};
  items.forEach((item) => {
    const canonicalId = resolveMergeCanonicalId(item.id);
    if (!groups[canonicalId]) groups[canonicalId] = new Set();
    groups[canonicalId].add(item.id);
  });
  return { groups };
}

function isResolvedProductForMerge(product = {}, diagnostics = {}) {
  const id = String(product.id || '').trim();
  if (!id) return { resolved: false, canonicalId: '', reasons: [], aliasCount: 0, groupSize: 1, absorbed: false };
  const meta = product.meta || state.food.itemsById?.[id] || {};
  const canonicalId = resolveMergeCanonicalId(id);
  const mergedInto = String(meta.mergedInto || '').trim();
  const hiddenMerged = !!meta.hiddenMerged;
  const redirectedToCanonical = !!canonicalId && canonicalId !== id;
  const groupSize = Number(diagnostics?.groups?.[canonicalId]?.size || 1);
  const aliasCount = new Set([
    ...(Array.isArray(meta.aliases) ? meta.aliases : []),
    ...(Object.values(state.foodCatalog.canonicals?.[id]?.aliasesByStore || {}).flatMap((list) => Array.isArray(list) ? list : []))
  ].map((alias) => normalizeFoodName(alias)).filter(Boolean)).size;
  const hasLinkedGroup = groupSize > 1;
  const hasUsefulAliases = aliasCount > 1;
  const absorbed = hiddenMerged || !!mergedInto || redirectedToCanonical;
  const reasons = [];
  if (hiddenMerged) reasons.push('hiddenMerged');
  if (mergedInto) reasons.push('mergedInto');
  if (redirectedToCanonical) reasons.push('redirected');
  if (hasLinkedGroup) reasons.push('grouped');
  if (hasUsefulAliases) reasons.push('aliases');
  return {
    resolved: absorbed || hasLinkedGroup || hasUsefulAliases,
    canonicalId,
    reasons,
    aliasCount,
    groupSize,
    absorbed
  };
}

function getMergeEligibleProducts({ hideResolved = false, searchTerm = '', selectedIds = [] } = {}) {
  const selectedSet = new Set((Array.isArray(selectedIds) ? selectedIds : []).map((id) => String(id || '').trim()).filter(Boolean));
  const diagnostics = buildMergeProductDiagnostics();
  const query = normalizeFoodCompareKey(searchTerm || '');
  const all = foodItemsList().map((item) => {
    const mergeMeta = isResolvedProductForMerge(item, diagnostics);
    return { ...item, mergeMeta };
  });
  const origin = all.filter((item) => {
    if (item.mergeMeta.absorbed) return false;
    if (hideResolved && item.mergeMeta.resolved && !selectedSet.has(item.id)) return false;
    if (query && !normalizeFoodCompareKey(item.name).includes(query)) return false;
    return true;
  });
  const pendingCount = all.filter((item) => !item.mergeMeta.resolved && !item.mergeMeta.absorbed).length;
  const destination = all.filter((item) => {
    if (item.mergeMeta.absorbed) return false;
    if (item.mergeMeta.canonicalId && item.mergeMeta.canonicalId !== item.id) return false;
    return true;
  });
  return {
    origin: sortProductsForMergeList(origin),
    destination: sortProductsForMergeList(destination),
    all,
    pendingCount
  };
}

function sortProductsForMergeList(products = []) {
  const collator = new Intl.Collator('es', {
    usage: 'sort',
    sensitivity: 'base',
    numeric: true,
    ignorePunctuation: true
  });
  return (Array.isArray(products) ? products : [])
    .map((product, index) => ({ product, index }))
    .sort((a, b) => {
      const nameA = String(a.product?.name || '').normalize('NFC').trim();
      const nameB = String(b.product?.name || '').normalize('NFC').trim();
      const byName = collator.compare(nameA, nameB);
      if (byName !== 0) return byName;
      return a.index - b.index;
    })
    .map(({ product }) => product);
}

function topFoodItems(limit = 5) {
  return foodItemsList().sort((a, b) => (b.count - a.count) || (b.lastUsedAt - a.lastUsedAt) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' })).slice(0, limit);
}

async function loadFoodCatalog(force = false) {
  if (state.food.loading) return;
  if (state.food.loaded && !force) return;
  state.food.loading = true;
  try {
    const snap = await safeFirebase(() => get(ref(db, `${state.financePath}/catalog`)));
    const val = snap?.val() || {};
    state.food.options = {
      typeOfMeal: normalizeFoodMap(val.foodOptions?.typeOfMeal || {}),
      cuisine: normalizeFoodMap(val.foodOptions?.cuisine || {}),
      place: normalizeFoodMap(val.foodOptions?.place || {})
    };
    state.food.items = normalizeFoodMap(val.foodItems || {});
    const foodSnap = await safeFirebase(() => get(ref(db, `${state.financePath}/foodItems`)));
    const entityMap = foodSnap?.val() || {};
    const normalizedEntities = normalizeFoodEntityMap(entityMap);
    if (!Object.keys(normalizedEntities.out).length && Object.keys(state.food.items || {}).length) {
      Object.entries(state.food.items || {}).forEach(([key, legacy]) => {
        const id = window.crypto?.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
        normalizedEntities.out[id] = {
          id,
          name: normalizeFoodName(legacy?.name || key || ''),
          mealType: normalizeFoodName(legacy?.lastExtras?.mealType || ''),
          cuisine: normalizeFoodName(legacy?.lastExtras?.cuisine || ''),
          healthy: normalizeFoodName(legacy?.lastExtras?.healthy || legacy?.lastExtras?.cuisine || ''),
          place: normalizeFoodName(legacy?.lastExtras?.place || ''),
          defaultPrice: Number(legacy?.lastPrice || 0),
          countUsed: Number(legacy?.count || 0),
          createdAt: Number(legacy?.createdAt || 0) || nowTs(),
          updatedAt: Number(legacy?.lastUsedAt || 0) || nowTs()
        };
        if (normalizedEntities.out[id].name) normalizedEntities.nameToId[normalizedEntities.out[id].name.toLowerCase()] = id;
      });
      financeDebug('migrated legacy foodItems into entities', { count: Object.keys(normalizedEntities.out).length });
    }
    try {
      const publicSnap = await safeFirebase(() => get(ref(db, GLOBAL_PRODUCTS_PATH)));
      const publicRows = publicSnap?.val() || {};
      Object.entries(publicRows).forEach(([publicId, row]) => {
        const normalizedName = normalizeFoodName(row?.name || '');
        if (!normalizedName) return;
        const barcode = String(row?.barcode || '').trim();
        const brand = String(row?.brand || '').trim();
        const category = String(row?.category || '').trim();
        const existingId = normalizedEntities.nameToId[normalizedName.toLowerCase()];
        const fallbackId = existingId || `pub-${firebaseSafeKey(publicId || normalizedName)}`;
        const current = normalizedEntities.out[fallbackId] || {};
        normalizedEntities.out[fallbackId] = {
          ...current,
          id: fallbackId,
          publicProductId: String(publicId || '').trim(),
          name: normalizedName,
          displayName: String(row?.name || normalizedName).trim() || normalizedName,
          normalizedName: normalizeCatalogName(row?.name || normalizedName),
          brand,
          category,
          barcode,
          mealType: normalizeFoodName(current.mealType || ''),
          cuisine: normalizeFoodName(current.cuisine || ''),
          healthy: normalizeFoodName(current.healthy || ''),
          place: normalizeFoodName(current.place || ''),
          defaultPrice: Number(current.defaultPrice || row?.defaultPrice || 0),
          baseUnit: String(row?.baseUnit || current.baseUnit || '').trim(),
          macros: row?.macros && typeof row.macros === 'object' ? row.macros : (current.macros || {}),
          source: current.source || 'public',
          countUsed: Number(current.countUsed || 0),
          createdAt: Number(current.createdAt || row?.createdAt || 0) || nowTs(),
          updatedAt: Number(current.updatedAt || row?.updatedAt || 0) || nowTs(),
        };
        normalizedEntities.nameToId[normalizedName.toLowerCase()] = fallbackId;
      });
    } catch (error) {
      financeDebug('public catalog load failed', { message: error?.message || String(error || '') });
    }
    state.food.itemsById = normalizedEntities.out;
    state.food.nameToId = normalizedEntities.nameToId;
    financeDebug('food catalog loaded', { options: Object.keys(state.food.options?.typeOfMeal || {}).length, items: Object.keys(state.food.itemsById || {}).length });
    state.food.loaded = true;
  } finally {
    state.food.loading = false;
  }
}

async function ensureFoodCatalogLoaded(force = false) {
  await loadFoodCatalog(force);
}

function normalizeAliasKey(value = '') {
  return firebaseSafeKey(normalizeFoodName(value).toLowerCase());
}

async function loadFoodMetaCatalog(force = false) {
  if (state.foodCatalog.loading) return;
  if (state.foodCatalog.loaded && !force) return;
  state.foodCatalog.loading = true;
  try {
    const snap = await safeFirebase(() => get(ref(db, `${state.financePath}/foodCatalog`)));
    const val = snap?.val() || {};
    state.foodCatalog.canonicals = Object.entries(val.canonicals && typeof val.canonicals === 'object' ? val.canonicals : {}).reduce((acc, [id, row]) => {
      const aliasesByStore = row?.aliasesByStore && typeof row.aliasesByStore === 'object' ? row.aliasesByStore : {};
      const pricesByStore = row?.pricesByStore && typeof row.pricesByStore === 'object' ? row.pricesByStore : {};
      acc[id] = { ...row, aliasesByStore, pricesByStore };
      return acc;
    }, {});
    state.foodCatalog.aliases = val.aliases && typeof val.aliases === 'object' ? val.aliases : {};
    state.foodCatalog.ignored = val.ignored && typeof val.ignored === 'object' ? val.ignored : {};
    state.foodCatalog.merges = Object.entries(val.merges && typeof val.merges === 'object' ? val.merges : {}).reduce((acc, [id, row]) => {
      if (typeof row === 'string') { acc[id] = { canonicalId: row }; return acc; }
      if (row && typeof row === 'object' && row.canonicalId) { acc[id] = row; return acc; }
      return acc;
    }, {});
    state.foodCatalog.loaded = true;
  } finally {
    state.foodCatalog.loading = false;
  }
}

async function ensureFoodMetaCatalogLoaded(force = false) {
  await loadFoodMetaCatalog(force);
}

const DEBUG_FINANCE_PRODUCTS = FINANCE_DEBUG;

function parseProductsRangeValue(rangeType = 'month', rangeValue = '') {
  const safeType = ['day', 'week', 'month', 'year', 'total', 'custom'].includes(String(rangeType || '')) ? String(rangeType) : 'month';
  const rawValue = String(rangeValue || '').trim();
  const now = new Date();
  if (!rawValue) {
    if (safeType === 'day' || safeType === 'week') return dayKeyFromTs(now.getTime());
    if (safeType === 'month') return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    if (safeType === 'year') return String(now.getFullYear());
    return '';
  }
  if (safeType === 'day' || safeType === 'week') return toIsoDay(rawValue) || dayKeyFromTs(now.getTime());
  if (safeType === 'month') return /^\d{4}-\d{2}$/.test(rawValue) ? rawValue : `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  if (safeType === 'year') return /^\d{4}$/.test(rawValue) ? rawValue : String(now.getFullYear());
  return rawValue;
}

function getProductRowsForRange(rangeType = 'month', rangeValue = '', filters = {}) {
  const allTxRows = balanceTxList();
  const range = ['day', 'week', 'month', 'year', 'total', 'custom'].includes(String(rangeType || '')) ? String(rangeType) : 'month';
  const safeValue = parseProductsRangeValue(range, rangeValue);
  let rows = [];
  let start = null;
  let end = null;
  if (range === 'custom') {
    const now = Date.now();
    const startTs = parseDayKey(filters.customStart || dayKeyFromTs(now - (30 * 86400000)));
    const endTs = parseDayKey(filters.customEnd || dayKeyFromTs(now)) + 86400000;
    start = Math.min(startTs, endTs - 86400000);
    end = Math.max(endTs, startTs + 86400000);
    rows = allTxRows.filter((row) => {
      const ts = txTs(row);
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
  } else if (range === 'day') {
    start = parseDayKey(safeValue || dayKeyFromTs(Date.now()));
    end = start + 86400000;
    rows = allTxRows.filter((row) => {
      const ts = txTs(row);
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
  } else if (range === 'week') {
    start = isoWeekStartTs(safeValue || dayKeyFromTs(Date.now()));
    end = start + (7 * 86400000);
    rows = allTxRows.filter((row) => {
      const ts = txTs(row);
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
  } else if (range === 'month') {
    const [year, month] = String(safeValue || '').split('-').map(Number);
    start = new Date(year, (month || 1) - 1, 1, 0, 0, 0, 0).getTime();
    end = new Date(year, (month || 1), 1, 0, 0, 0, 0).getTime();
    rows = allTxRows.filter((row) => {
      const ts = txTs(row);
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
  } else if (range === 'year') {
    const year = Number(safeValue || new Date().getFullYear());
    start = new Date(year, 0, 1, 0, 0, 0, 0).getTime();
    end = new Date(year + 1, 0, 1, 0, 0, 0, 0).getTime();
    rows = allTxRows.filter((row) => {
      const ts = txTs(row);
      return Number.isFinite(ts) && ts >= start && ts < end;
    });
  } else {
    rows = allTxRows.slice();
    const txTimestamps = rows.map((row) => txTs(row)).filter((ts) => Number.isFinite(ts) && ts > 0);
    start = txTimestamps.length ? Math.min(...txTimestamps) : null;
    end = txTimestamps.length ? (Math.max(...txTimestamps) + 1) : null;
  }
  console.log('[Productos][Rango] dataset resuelto', { range, rangeValue: safeValue, rows: rows.length, start, end });
  return { rows, start, end, range, rangeValue: safeValue };
}

function resolveProductsRangeRows(filters = {}) {
  const range = ['day', 'week', 'month', 'year', 'total', 'custom'].includes(String(filters.range || ''))
    ? String(filters.range)
    : 'month';
  const rangeValue = String(filters.rangeValue || '');
  return getProductRowsForRange(range, rangeValue, filters);
}

function buildFoodLines(rows = [], filters = {}) {
  const vendorFilter = String(filters.vendor || 'all');
  const accountFilter = String(filters.account || 'all');
  const foodOnly = !!filters.onlyFood;
  const lines = [];
  let purchaseCount = 0;
  rows.forEach((row) => {
    if (normalizeTxType(row?.type) !== 'expense') return;
    const ts = txTs(row);
    if (!Number.isFinite(ts) || ts <= 0) return;
    if (accountFilter !== 'all' && String(row?.accountId || '') !== accountFilter) return;
    purchaseCount += 1;
    const items = foodItemsFromTx(row).filter((item) => normalizeFoodName(item?.name || ''));
    if (!items.length) return;
    const txVendor = firebaseSafeKey(normalizeFoodName(row?.extras?.filters?.place || row?.extras?.place || 'unknown')) || 'unknown';
    const txAmount = Math.abs(Number(row?.amount || 0));
    let valid = items.map((item) => {
      const totalPrice = Math.abs(Number(item?.totalPrice ?? item?.amount ?? item?.price ?? 0));
      const qty = Math.max(1, Number(item?.qty || 1));
      const unit = String(item?.unit || 'ud').trim() || 'ud';
      const unitPrice = Number(item?.unitPrice || computeUnitPrice(totalPrice, qty));
      const vendorKey = firebaseSafeKey(normalizeFoodName(item?.place || txVendor || 'unknown')) || 'unknown';
      return {
        txId: row.id,
        accountId: String(row?.accountId || ''),
        ts,
        date: dayKeyFromTs(ts),
        vendorKey,
        nameRaw: normalizeFoodName(item?.name || ''),
        foodId: String(item?.foodId || ''),
        productKey: String(item?.productKey || ''),
        itemCategory: String(item?.category || item?.category_app || row?.category || ''),
        qty,
        unit,
        totalPrice,
        unitPrice: Number.isFinite(unitPrice) && unitPrice > 0 ? unitPrice : totalPrice,
      };
    });
    const hasDirectLinePrices = valid.some((line) => line.totalPrice > 0);
    if (!hasDirectLinePrices && txAmount > 0 && valid.length) {
      const totalQty = valid.reduce((sum, line) => sum + Math.max(1, Number(line.qty || 1)), 0) || valid.length;
      valid = valid.map((line) => {
        const weight = Math.max(1, Number(line.qty || 1)) / totalQty;
        const fallbackTotal = txAmount * weight;
        return {
          ...line,
          totalPrice: fallbackTotal,
          unitPrice: computeUnitPrice(fallbackTotal, line.qty)
        };
      });
    }
    valid = valid.filter((line) => line.totalPrice > 0);
    valid.forEach((line) => {
      if (vendorFilter !== 'all' && line.vendorKey !== vendorFilter) return;
      if (foodOnly && !isFoodCategory(line.itemCategory || '')) return;
      lines.push(line);
    });
  });
  return { lines, purchaseCount };
}

function resolveMergeCanonicalId(rawId = '') {
  const safeId = String(rawId || '').trim();
  if (!safeId) return '';
  const visited = new Set();
  let currentId = safeId;
  while (currentId && !visited.has(currentId)) {
    visited.add(currentId);
    const mergeValue = state.foodCatalog.merges?.[currentId] || state.foodCatalog.merges?.[firebaseSafeKeyLoose(currentId)];
    if (!mergeValue) return currentId;
    if (typeof mergeValue === 'string') {
      const nextId = String(mergeValue || currentId).trim();
      if (!nextId || nextId === currentId) return currentId;
      currentId = nextId;
      continue;
    }
    if (mergeValue && typeof mergeValue === 'object' && mergeValue.canonicalId) {
      const nextId = String(mergeValue.canonicalId || currentId).trim();
      if (!nextId || nextId === currentId) return currentId;
      currentId = nextId;
      continue;
    }
    return currentId;
  }
  return currentId || safeId;
}

function resolveCanonicalForLine(line = {}) {
  const vendorKey = firebaseSafeKey(line.vendorKey || 'unknown') || 'unknown';
  const aliasKey = normalizeAliasKey(normalizeFoodCompareKey(line.nameRaw || line.productKey || ''));
  const byVendor = state.foodCatalog.aliases?.[vendorKey] || {};
  const byUnknown = state.foodCatalog.aliases?.unknown || {};
  const fromAlias = byVendor?.[aliasKey]?.canonicalId || byUnknown?.[aliasKey]?.canonicalId;
  if (fromAlias) return resolveMergeCanonicalId(String(fromAlias));
  if (line.foodId) return resolveMergeCanonicalId(String(line.foodId));
  const resolvedFood = resolveFoodItemByAnyKey(line.nameRaw || line.productKey || '');
  if (resolvedFood?.id) return resolveMergeCanonicalId(String(resolvedFood.id));
  return `pseudo_${aliasKey || normalizeAliasKey('sin-datos')}`;
}

function aggregateProducts(lines = [], purchaseCount = 0) {
  const acc = {};
  const totalFood = lines.reduce((sum, line) => sum + Number(line.totalPrice || 0), 0);
  lines.forEach((line) => {
    const canonicalId = resolveCanonicalForLine(line);
    const canonicalMeta = state.foodCatalog.canonicals?.[canonicalId] || state.food.itemsById?.[canonicalId] || {};
    const canonicalName = normalizeFoodName(canonicalMeta?.name || canonicalMeta?.displayName || line.nameRaw || canonicalId.replace(/^pseudo_/, '')) || 'Sin datos';
    if (!acc[canonicalId]) {
      acc[canonicalId] = { canonicalId, canonicalName, total: 0, count: 0, purchases: new Set(), vendors: {}, lastTs: 0, lastPrice: null, lastVendor: '', aliases: new Set() };
    }
    const row = acc[canonicalId];
    row.total += Number(line.totalPrice || 0);
    row.count += Math.max(1, Number(line.qty || 1));
    row.purchases.add(line.txId);
    row.aliases.add(line.nameRaw);
    if (line.ts >= row.lastTs) {
      row.lastTs = line.ts;
      row.lastPrice = line.unitPrice || line.totalPrice;
      row.lastVendor = line.vendorKey;
    }
    if (!row.vendors[line.vendorKey]) row.vendors[line.vendorKey] = { aliasSet: new Set(), prices: [], count: 0, lastTs: 0, lastPrice: null, unit: line.unit || 'ud' };
    const vendor = row.vendors[line.vendorKey];
    vendor.aliasSet.add(line.nameRaw);
    vendor.prices.push(line.unitPrice || line.totalPrice);
    vendor.count += 1;
    if (line.ts >= vendor.lastTs) {
      vendor.lastTs = line.ts;
      vendor.lastPrice = line.unitPrice || line.totalPrice;
      vendor.unit = line.unit || vendor.unit || 'ud';
    }
  });
  const products = Object.values(acc).map((row) => {
    const vendorRows = Object.entries(row.vendors).map(([vendorKey, meta]) => {
      const avg = meta.prices.length ? (meta.prices.reduce((sum, p) => sum + Number(p || 0), 0) / meta.prices.length) : null;
      const minPrice = meta.prices.length ? Math.min(...meta.prices) : null;
      return { vendorKey, aliasText: [...meta.aliasSet].join(', '), count: meta.count, lastPrice: meta.lastPrice, avgPrice: avg, minPrice, unit: meta.unit || 'ud', lastTs: meta.lastTs };
    }).sort((a, b) => (a.avgPrice ?? Infinity) - (b.avgPrice ?? Infinity));
    const cheapest = vendorRows.find((v) => Number.isFinite(v.avgPrice));
    const pricy = vendorRows.slice().reverse().find((v) => Number.isFinite(v.avgPrice));
    return {
      ...row,
      purchases: row.purchases.size,
      aliases: [...row.aliases],
      percentOfFood: totalFood > 0 ? (row.total / totalFood) * 100 : 0,
      vendorRows,
      cheapestVendorKey: cheapest?.vendorKey || '',
      cheapestPrice: cheapest?.avgPrice ?? null,
      pricyVendorKey: pricy?.vendorKey || '',
      pricyPrice: pricy?.avgPrice ?? null
    };
  }).filter((row) => !state.foodCatalog.ignored?.[row.canonicalId]);
  const topVendorByEur = lines.reduce((accVendor, line) => {
    accVendor[line.vendorKey] = (accVendor[line.vendorKey] || 0) + Number(line.totalPrice || 0);
    return accVendor;
  }, {});
  const topVendor = Object.entries(topVendorByEur).sort((a, b) => b[1] - a[1])[0] || null;
  return { products, totalFood, purchaseCount, itemsCount: lines.length, topVendor: topVendor ? { key: topVendor[0], total: topVendor[1] } : null };
}

function applyMergeSearchFilter(inputEl, selector) {
  if (!inputEl) return;
  const queryKey = normalizeProductItemKey(inputEl.value || '');
  const scope = inputEl.closest('#finance-modal') || document;
  const rows = scope.querySelectorAll(selector);
  
  requestAnimationFrame(() => {
    rows.forEach((row) => {
      const haystack = String(row.dataset.foodMergeName || '');
      const shouldShow = !queryKey || haystack.includes(queryKey);
      row.style.display = shouldShow ? '' : 'none';
    });
  });
}

function productsHubPath(path = '') {
  return `${state.financePath}/shoppingHub${path ? `/${path}` : ''}`;
}

function cloneProductsLineMap(lines = {}) {
  return Object.fromEntries(
    Object.entries(lines || {}).map(([lineId, line]) => [
      lineId,
      { ...(line || {}) },
    ]),
  );
}

function cloneProductsListRecord(list = {}) {
  return {
    ...(list || {}),
    lines: cloneProductsLineMap(list?.lines || {}),
    tickets: Object.fromEntries(
      Object.entries(list?.tickets || {}).map(([ticketId, ticket]) => [ticketId, { ...(ticket || {}) }]),
    ),
  };
}

function normalizeProductsListTicketMeta(ticketId = '', payload = {}) {
  const safeId = String(ticketId || payload?.id || createFinanceRecordId('lticket')).trim();
  return {
    id: safeId,
    label: normalizeProductText(payload?.label || ''),
    store: normalizeFoodName(payload?.store || ''),
    accountId: normalizeProductText(payload?.accountId || ''),
    paymentMethod: normalizeProductText(payload?.paymentMethod || 'Tarjeta') || 'Tarjeta',
    plannedFor: toIsoDay(String(payload?.plannedFor || '')) || dayKeyFromTs(nowTs()),
    notes: normalizeProductText(payload?.notes || ''),
    confirmedAt: normalizeProductNumber(payload?.confirmedAt, 0),
    accountedTxId: normalizeProductText(payload?.accountedTxId || ''),
    confirmedTicketId: normalizeProductText(payload?.confirmedTicketId || ''),
    sortOrder: normalizeProductNumber(payload?.sortOrder, 0),
    createdAt: normalizeProductNumber(payload?.createdAt, nowTs()),
    updatedAt: normalizeProductNumber(payload?.updatedAt, nowTs()),
  };
}

function ensureProductsListTickets(list = {}) {
  const nextList = cloneProductsListRecord(list);
  const primaryTicketId = String(nextList.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  const baseMeta = normalizeProductsListTicketMeta(primaryTicketId, {
    label: 'Sin asignar',
    store: nextList.store,
    accountId: nextList.accountId,
    paymentMethod: nextList.paymentMethod,
    plannedFor: nextList.plannedFor,
    notes: nextList.notes,
    sortOrder: 0,
    createdAt: nextList.createdAt,
    updatedAt: nextList.updatedAt,
  });
  const ticketMap = Object.entries(nextList.tickets || {}).reduce((acc, [ticketId, payload]) => {
    const normalized = normalizeProductsListTicketMeta(ticketId, payload);
    acc[normalized.id] = normalized;
    return acc;
  }, {});
  if (!ticketMap[primaryTicketId]) ticketMap[primaryTicketId] = baseMeta;
  const lineEntries = Object.entries(nextList.lines || {});
  const usedTicketIds = new Set();
  lineEntries.forEach(([lineId, line]) => {
    const currentTicketId = String(line?.ticketId || '').trim();
    const safeTicketId = currentTicketId && ticketMap[currentTicketId] ? currentTicketId : primaryTicketId;
    if (!ticketMap[safeTicketId]) ticketMap[safeTicketId] = baseMeta;
    usedTicketIds.add(safeTicketId);
    nextList.lines[lineId] = { ...(line || {}), ticketId: safeTicketId };
  });
  if (!lineEntries.length) usedTicketIds.add(primaryTicketId);
  if (!Object.keys(ticketMap).length) ticketMap[primaryTicketId] = baseMeta;
  nextList.primaryTicketId = primaryTicketId;
  const activeTicketCandidate = String(nextList.activeTicketId || '').trim();
  nextList.activeTicketId = ticketMap[activeTicketCandidate] ? activeTicketCandidate : (ticketMap[primaryTicketId] ? primaryTicketId : Object.keys(ticketMap)[0] || primaryTicketId);
  nextList.tickets = ticketMap;
  return nextList;
}

function buildNextTicketLabel(list = {}) {
  const taken = new Set(
    Object.values(list?.tickets || {})
      .map((ticket) => normalizeProductText(ticket?.label || '').toLowerCase())
      .filter(Boolean),
  );
  let index = Math.max(1, Object.keys(list?.tickets || {}).length + 1);
  let label = `Ticket ${index}`;
  while (taken.has(label.toLowerCase())) {
    index += 1;
    label = `Ticket ${index}`;
  }
  return label;
}

function resolveProductsTicketBaseLabel(ticket = {}, fallback = 'Sin asignar') {
  return normalizeFoodName(ticket?.store || '') || fallback;
}

function buildProductsTicketDisplayLabelMap(tickets = [], fallback = 'Sin asignar') {
  const totals = new Map();
  tickets.forEach((ticket) => {
    const baseLabel = resolveProductsTicketBaseLabel(ticket, fallback);
    const key = normalizeProductItemKey(baseLabel) || baseLabel.toLowerCase();
    totals.set(key, Number(totals.get(key) || 0) + 1);
  });
  const seen = new Map();
  return tickets.reduce((acc, ticket) => {
    const baseLabel = resolveProductsTicketBaseLabel(ticket, fallback);
    const key = normalizeProductItemKey(baseLabel) || baseLabel.toLowerCase();
    const nextIndex = Number(seen.get(key) || 0) + 1;
    seen.set(key, nextIndex);
    const repeated = Number(totals.get(key) || 0) > 1;
    acc[String(ticket?.id || '').trim()] = repeated && nextIndex > 1 ? `${baseLabel} ${nextIndex}` : baseLabel;
    return acc;
  }, {});
}

function createEmptyProductsList(seed = {}, { temporary = false } = {}) {
  const now = nowTs();
  const fallbackStore = normalizeFoodName(seed?.store || state.productsHub?.settings?.defaultStore || '');
  const fallbackAccountId = String(seed?.accountId || state.productsHub?.settings?.defaultAccountId || '').trim();
  const fallbackPaymentMethod = String(seed?.paymentMethod || state.productsHub?.settings?.defaultPaymentMethod || 'Tarjeta').trim() || 'Tarjeta';
  const list = normalizeProductsHubList(
    temporary ? '__draft__' : String(seed?.id || createFinanceRecordId('list')).trim(),
    {
      name: seed?.name || 'Lista activa',
      status: 'draft',
      store: fallbackStore,
      accountId: fallbackAccountId,
      paymentMethod: fallbackPaymentMethod,
      plannedFor: toIsoDay(String(seed?.plannedFor || '')) || dayKeyFromTs(now),
      notes: seed?.notes || '',
      sourceTicketId: seed?.sourceTicketId || '',
      lines: seed?.lines || {},
      createdAt: Number(seed?.createdAt || 0) || now,
      updatedAt: Number(seed?.updatedAt || 0) || now,
    },
  );
  return ensureProductsListTickets(list);
}

function readLocalProductsDraft() {
  try {
    const raw = localStorage.getItem(PRODUCTS_DRAFT_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return normalizeProductsHubList('__draft__', { ...parsed, id: '__draft__' });
  } catch (_) {
    return null;
  }
}

function writeLocalProductsDraft(list = null) {
  try {
    if (!list || String(list.id || '') !== '__draft__') {
      localStorage.removeItem(PRODUCTS_DRAFT_LOCAL_KEY);
      return;
    }
    localStorage.setItem(PRODUCTS_DRAFT_LOCAL_KEY, JSON.stringify(list));
  } catch (_) {}
}

function resolveActiveProductsList() {
  const activeId = String(state.productsHub?.settings?.activeListId || '').trim();
  if (activeId && state.productsHub?.lists?.[activeId]) {
    return ensureProductsListTickets(cloneProductsListRecord(state.productsHub.lists[activeId]));
  }
  if (state.productsHub?.lists?.__draft__) {
    return ensureProductsListTickets(cloneProductsListRecord(state.productsHub.lists.__draft__));
  }
  const localDraft = readLocalProductsDraft();
  if (localDraft) return ensureProductsListTickets(cloneProductsListRecord(localDraft));
  return createEmptyProductsList({}, { temporary: true });
}

function syncProductsDraftListLocal(list = null) {
  if (!list) return null;
  if (String(list.id || '') === '__draft__') {
    writeLocalProductsDraft(list);
    state.productsHub = {
      ...(state.productsHub || normalizeProductsHub()),
      lists: {
        ...(state.productsHub?.lists || {}),
        __draft__: cloneProductsListRecord(list),
      },
    };
    return list;
  }
  const nextLists = { ...(state.productsHub?.lists || {}) };
  delete nextLists.__draft__;
  writeLocalProductsDraft(null);
  nextLists[list.id] = cloneProductsListRecord(list);
  state.productsHub = {
    ...(state.productsHub || normalizeProductsHub()),
    settings: {
      ...(state.productsHub?.settings || {}),
      activeListId: String(list.id || ''),
    },
    lists: nextLists,
  };
  return list;
}

function resolveProductsCatalogPrice(row = {}) {
  return normalizeProductPositiveNumber(
    row.currentUnitPrice,
    normalizeProductPositiveNumber(
      row.estimatedPrice,
      normalizeProductPositiveNumber(
        row.usualPrice,
        normalizeProductPositiveNumber(row.lastPrice, 0),
      ),
    ),
  );
}

function formatProductsShortDate(ts = 0) {
  if (!ts) return '--';
  try {
    return new Date(Number(ts)).toLocaleDateString('es-ES', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
    });
  } catch (_) {
    return '--';
  }
}

function formatProductsDays(days = null) {
  if (!Number.isFinite(days)) return 'Sin base';
  if (days === 0) return 'Hoy';
  if (days === 1) return '1 dia';
  if (days === -1) return 'Ayer';
  return `${Math.abs(Math.round(days))} dias${days < 0 ? ' tarde' : ''}`;
}

function resolveProductsDueTone(daysRemaining = null, isActive = true) {
  if (!isActive) return 'inactive';
  if (!Number.isFinite(daysRemaining)) return 'unknown';
  if (daysRemaining <= 0) return 'critical';
  if (daysRemaining <= 5) return 'soon';
  return 'stable';
}

function resolveProductsDueLabel(daysRemaining = null, tone = 'unknown') {
  if (tone === 'inactive') return 'Inactivo';
  if (tone === 'critical') return `Comprar ya · ${formatProductsDays(daysRemaining)}`;
  if (tone === 'soon') return `Reponer pronto · ${formatProductsDays(daysRemaining)}`;
  if (!Number.isFinite(daysRemaining)) return 'Sin frecuencia';
  return `Cobertura ${formatProductsDays(daysRemaining)}`;
}

function buildProductsSparklinePath(history = []) {
  const points = (Array.isArray(history) ? history : [])
    .slice()
    .sort((a, b) => Number(a.ts || 0) - Number(b.ts || 0))
    .slice(-10);
  if (points.length < 2) return '';
  const values = points.map((point) => Number(point.unitPrice || point.price || 0)).filter((value) => Number.isFinite(value) && value >= 0);
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(0.01, max - min);
  return points.map((point, index) => {
    const value = Number(point.unitPrice || point.price || 0);
    const x = points.length === 1 ? 0 : (index / (points.length - 1)) * 100;
    const y = 26 - (((value - min) / range) * 22);
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
}

function buildProductsCatalogLine(line = {}) {
  const canonicalId = resolveMergeCanonicalId(
    resolveCanonicalForLine(line)
    || line.productId
    || line.foodId
    || line.productKey
    || `pseudo_${normalizeAliasKey(line.canonicalName || line.nameRaw || 'sin-datos')}`,
  );
  const existing = state.food.itemsById?.[canonicalId] || resolveFoodItemByAnyKey(canonicalId) || null;
  return {
    ...line,
    canonicalId,
    canonicalName: normalizeFoodName(existing?.displayName || existing?.name || line.canonicalName || line.nameRaw || canonicalId.replace(/^pseudo_/, '')) || 'Producto',
    scopedTotal: Number(line.scopedAmount || line.totalPrice || 0),
  };
}

function resolveProductsPriceBand(price = 0) {
  if (!Number.isFinite(price) || price <= 0) return 'none';
  if (price < 3) return 'budget';
  if (price < 8) return 'standard';
  return 'premium';
}

function resolveProductsCadenceBand(days = 0) {
  if (!Number.isFinite(days) || days <= 0) return 'unknown';
  if (days <= 7) return 'weekly';
  if (days <= 21) return 'biweekly';
  if (days <= 45) return 'monthly';
  return 'slow';
}

function resolveProductsGroupMeta(row = {}, groupBy = 'type') {
  if (groupBy === 'store') {
    const store = row.preferredStore || row.bestStoreKey || row.lastStore || '';
    return { key: store || 'sin-tienda', label: store || 'Sin tienda' };
  }
  if (groupBy === 'date') {
    if (!row.lastPurchaseAt) return { key: 'sin-historico', label: 'Sin historico' };
    const date = new Date(Number(row.lastPurchaseAt || 0));
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
    return {
      key,
      label: new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(date),
    };
  }
  if (groupBy === 'status') {
    if (!row.active) return { key: 'inactive', label: 'Inactivos' };
    if (row.dueTone === 'critical') return { key: 'critical', label: 'Comprar ya' };
    if (row.dueTone === 'soon') return { key: 'soon', label: 'Reposicion proxima' };
    if (!row.purchaseCount) return { key: 'untracked', label: 'Sin historico' };
    return { key: 'stable', label: 'Controlados' };
  }
  const type = row.productType || row.mealType || '';
  return { key: type || 'sin-tipo', label: type || 'Sin tipo' };
}

function buildProductsRangeLabel(cfg = {}) {
  const safeRange = String(cfg.range || 'month');
  if (safeRange === 'total') return 'Historico total';
  if (safeRange === 'custom') {
    const from = cfg.customStart || '...';
    const to = cfg.customEnd || '...';
    return `${from} - ${to}`;
  }
  if (safeRange === 'month') {
    return monthLabelByKey(String(cfg.rangeValue || getMonthKeyFromDate()));
  }
  if (safeRange === 'year') return String(cfg.rangeValue || new Date().getFullYear());
  return String(cfg.rangeValue || dayKeyFromTs(nowTs()));
}

function averageProductsGapDays(timestamps = []) {
  const ordered = [...new Set((Array.isArray(timestamps) ? timestamps : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
  if (ordered.length < 2) return 0;
  const gaps = ordered.slice(1).map((ts, index) => Math.max(1, Math.round((ts - ordered[index]) / 86400000)));
  return gaps.length ? Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length) : 0;
}

function averageProductsDurationDays(timestamps = []) {
  const ordered = [...new Set((Array.isArray(timestamps) ? timestamps : [])
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value > 0))]
    .sort((a, b) => a - b);
  if (ordered.length < 2) return 0;
  const durations = ordered.slice(1).map((ts, index) => {
    const gapDays = Math.max(1, Math.round((ts - ordered[index]) / 86400000));
    return Math.max(1, gapDays - 1);
  });
  return durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
}

function matchesProductsReplenishmentWindow(windowKey = 'all', row = {}) {
  const safeKey = String(windowKey || 'all');
  if (safeKey === 'all') return true;
  const daysRemaining = Number(row?.daysRemaining);
  if (!Number.isFinite(daysRemaining)) return safeKey === 'unknown';
  if (safeKey === 'critical') return daysRemaining <= 0;
  if (safeKey === 'next3') return daysRemaining > 0 && daysRemaining <= 3;
  if (safeKey === 'next7') return daysRemaining > 3 && daysRemaining <= 7;
  if (safeKey === 'later') return daysRemaining > 7;
  return true;
}

function buildProductsViewModel(cfg = {}) {
  const allowedRanges = ['day', 'week', 'month', 'year', 'total', 'custom'];
  const allowedGroups = ['type', 'store', 'date', 'status'];
  const allowedSorts = ['forecast', 'name', 'price', 'last-purchase', 'duration', 'consumption', 'spend'];
  const allowedStatus = ['all', 'active', 'inactive', 'due'];
  const allowedReplenishmentWindows = ['all', 'critical', 'next3', 'next7', 'later', 'unknown'];
  const allowedTabs = ['list', 'catalog'];
  const allowedCatalogPanels = ['catalog', 'editor', 'insights'];
  const rawTab = String(cfg?.tab || state.foodProductsView?.tab || 'list');
  const nextCfg = {
    ...(state.foodProductsView || {}),
    ...(cfg || {}),
    tab: allowedTabs.includes(rawTab) ? rawTab : 'list',
    range: allowedRanges.includes(String(cfg?.range || state.foodProductsView?.range || 'month')) ? String(cfg?.range || state.foodProductsView?.range || 'month') : 'month',
    groupBy: allowedGroups.includes(String(cfg?.groupBy || state.foodProductsView?.groupBy || 'type')) ? String(cfg?.groupBy || state.foodProductsView?.groupBy || 'type') : 'type',
    sortBy: allowedSorts.includes(String(cfg?.sortBy || state.foodProductsView?.sortBy || 'forecast')) ? String(cfg?.sortBy || state.foodProductsView?.sortBy || 'forecast') : 'forecast',
    status: allowedStatus.includes(String(cfg?.status || state.foodProductsView?.status || 'active')) ? String(cfg?.status || state.foodProductsView?.status || 'active') : 'active',
    scope: String(cfg?.scope || state.foodProductsView?.scope || 'personal') === 'global' ? 'global' : 'personal',
    vendor: String(cfg?.vendor || state.foodProductsView?.vendor || 'all'),
    account: String(cfg?.account || state.foodProductsView?.account || 'all'),
    productsQuery: String(cfg?.productsQuery || state.foodProductsView?.productsQuery || ''),
    productType: String(cfg?.productType || state.foodProductsView?.productType || 'all'),
    category: String(cfg?.category || state.foodProductsView?.category || 'all'),
    store: String(cfg?.store || state.foodProductsView?.store || 'all'),
    priceBand: String(cfg?.priceBand || state.foodProductsView?.priceBand || 'all'),
    frequencyBand: String(cfg?.frequencyBand || state.foodProductsView?.frequencyBand || 'all'),
    durationBand: String(cfg?.durationBand || state.foodProductsView?.durationBand || 'all'),
    replenishmentWindow: allowedReplenishmentWindows.includes(String(cfg?.replenishmentWindow || state.foodProductsView?.replenishmentWindow || 'all'))
      ? String(cfg?.replenishmentWindow || state.foodProductsView?.replenishmentWindow || 'all')
      : 'all',
    historyRange: String(cfg?.historyRange || state.foodProductsView?.historyRange || '90d'),
    selectedProductId: String(cfg?.selectedProductId || state.foodProductsView?.selectedProductId || ''),
    selectedIds: [...new Set(Array.isArray(cfg?.selectedIds || state.foodProductsView?.selectedIds) ? (cfg?.selectedIds || state.foodProductsView?.selectedIds) : [])],
    expandedIds: [...new Set(Array.isArray(cfg?.expandedIds || state.foodProductsView?.expandedIds) ? (cfg?.expandedIds || state.foodProductsView?.expandedIds) : [])],
    listQuery: String(cfg?.listQuery || state.foodProductsView?.listQuery || ''),
    catalogPanel: allowedCatalogPanels.includes(String(cfg?.catalogPanel || state.foodProductsView?.catalogPanel || 'catalog'))
      ? String(cfg?.catalogPanel || state.foodProductsView?.catalogPanel || 'catalog')
      : 'catalog',
    catalogCollapsed: Boolean(cfg?.catalogCollapsed ?? state.foodProductsView?.catalogCollapsed ?? true),
    catalogGroupsOpen: (cfg?.catalogGroupsOpen && typeof cfg.catalogGroupsOpen === 'object')
      ? cfg.catalogGroupsOpen
      : ((state.foodProductsView?.catalogGroupsOpen && typeof state.foodProductsView.catalogGroupsOpen === 'object')
        ? state.foodProductsView.catalogGroupsOpen
        : {}),
    catalogSearchByGroup: (cfg?.catalogSearchByGroup && typeof cfg.catalogSearchByGroup === 'object')
      ? cfg.catalogSearchByGroup
      : ((state.foodProductsView?.catalogSearchByGroup && typeof state.foodProductsView.catalogSearchByGroup === 'object')
        ? state.foodProductsView.catalogSearchByGroup
        : {}),
  };

  const accountsById = Object.fromEntries((state.accounts || []).map((account) => [account.id, account]));
  const buildAmountByTx = (rows = []) => rows.reduce((acc, row) => {
    if (normalizeTxType(row?.type) !== 'expense') return acc;
    const scopedAmount = nextCfg.scope === 'global'
      ? Math.abs(Number(row?.amount || 0))
      : Math.abs(personalDeltaForTx(row, accountsById));
    if (scopedAmount > 0) acc[row.id] = scopedAmount;
    return acc;
  }, {});

  const rangeData = getProductRowsForRange(nextCfg.range, String(nextCfg.rangeValue || ''), nextCfg);
  nextCfg.rangeValue = String(rangeData.rangeValue || '');
  const allRows = balanceTxList();
  const monthData = getProductRowsForRange('month', getMonthKeyFromDate(), nextCfg);
  const lineOptions = {
    productsById: state.food.itemsById || {},
    vendor: nextCfg.vendor,
    account: nextCfg.account,
    onlyFood: !!nextCfg.onlyFood,
  };
  const allLines = getProductItemRows(allRows, { amountByTxId: buildAmountByTx(allRows), ...lineOptions }).map(buildProductsCatalogLine);
  const rangeLines = getProductItemRows(rangeData.rows, { amountByTxId: buildAmountByTx(rangeData.rows), ...lineOptions }).map(buildProductsCatalogLine);
  const monthLines = getProductItemRows(monthData.rows, { amountByTxId: buildAmountByTx(monthData.rows), ...lineOptions }).map(buildProductsCatalogLine);

  const aggregates = {};
  const ensureAggregate = (canonicalId, seed = {}) => {
    const safeId = String(canonicalId || '').trim();
    if (!safeId) return null;
    if (aggregates[safeId]) return aggregates[safeId];
    const product = state.food.itemsById?.[safeId] || resolveFoodItemByAnyKey(safeId) || {};
    const meta = normalizeFinanceProductMeta(product, product);
    const preferredStore = meta.preferredStore || normalizeFoodName(product?.place || seed?.vendorKey || '');
    const initialName = normalizeFoodName(product?.displayName || product?.name || seed?.canonicalName || seed?.nameRaw || safeId.replace(/^pseudo_/, '')) || 'Producto';
    aggregates[safeId] = {
      canonicalId: safeId,
      canonicalName: initialName,
      displayName: initialName,
      aliasList: [...new Set(Array.isArray(product?.aliases) ? product.aliases : [])],
      productType: meta.productType || normalizeFoodName(product?.mealType || ''),
      productCategory: meta.productCategory || '',
      preferredStore,
      brand: normalizeProductText(product?.brand || ''),
      format: normalizeProductText(product?.format || ''),
      usualPrice: normalizeProductPositiveNumber(product?.usualPrice, normalizeProductPositiveNumber(product?.defaultPrice, 0)),
      estimatedPrice: normalizeProductPositiveNumber(product?.estimatedPrice, normalizeProductPositiveNumber(product?.usualPrice, normalizeProductPositiveNumber(product?.defaultPrice, 0))),
      lastPrice: normalizeProductPositiveNumber(product?.lastPrice, 0),
      usualQty: normalizeProductPositiveNumber(product?.usualQty, 1),
      unit: normalizeProductUnit(product?.unit || 'ud'),
      lastPurchaseAt: normalizeProductNumber(product?.lastPurchaseAt, 0),
      purchaseFrequencyDays: normalizeProductPositiveNumber(product?.purchaseFrequencyDays, 0),
      estimatedDurationDays: normalizeProductPositiveNumber(product?.estimatedDurationDays, 0),
      notes: normalizeProductText(product?.notes || ''),
      active: normalizeProductBoolean(product?.active, !product?.hiddenMerged),
      tags: normalizeProductTags(product?.tags || []),
      countUsed: Number(product?.countUsed || 0),
      hiddenMerged: Boolean(product?.hiddenMerged),
      totalSpend: 0,
      visibleSpend: 0,
      monthSpend: 0,
      totalQty: 0,
      visibleQty: 0,
      monthQty: 0,
      lastStore: '',
      bestStoreKey: '',
      bestStorePrice: 0,
      currentUnitPrice: 0,
      weightedAvgPrice: 0,
      projectedMonthlySpend: 0,
      predictedLineCost: 0,
      dueTone: 'unknown',
      dueLabel: 'Sin frecuencia',
      purchaseCount: 0,
      visiblePurchaseCount: 0,
      monthPurchaseCount: 0,
      daysSinceLastPurchase: null,
      daysRemaining: null,
      searchIndex: '',
      vendorRows: [],
      history: [],
      recentHistory: [],
      sparklinePath: '',
      _vendorMap: {},
      _history: [],
      _purchaseDateSet: new Set(),
      _purchaseTs: [],
      _visibleDateSet: new Set(),
      _monthDateSet: new Set(),
    };
    return aggregates[safeId];
  };

  Object.entries(state.food.itemsById || {}).forEach(([id, product]) => {
    if (product?.hiddenMerged) return;
    ensureAggregate(resolveMergeCanonicalId(id), product);
  });

  const applyLineToAggregate = (line, bucket = 'all') => {
    const row = ensureAggregate(line.canonicalId, line);
    if (!row) return;
    const scopedTotal = Number(line.scopedTotal || line.scopedAmount || line.totalPrice || 0);
    const qty = Math.max(1, Number(line.qty || 1));
    if (bucket === 'all') {
      row.totalSpend += scopedTotal;
      row.totalQty += qty;
      row._history.push({
        txId: line.txId,
        ts: Number(line.ts || 0),
        date: line.date,
        vendorKey: line.vendorKey,
        qty,
        unit: line.unit,
        unitPrice: Number(line.unitPrice || 0),
        totalPrice: scopedTotal,
      });
      if (line.date) {
        row._purchaseDateSet.add(line.date);
        row._purchaseTs.push(parseDayKey(line.date));
      }
      const vendor = row._vendorMap[line.vendorKey] || {
        vendorKey: line.vendorKey,
        spend: 0,
        qty: 0,
        prices: [],
        purchaseDates: new Set(),
        lastTs: 0,
        lastPrice: 0,
      };
      vendor.spend += scopedTotal;
      vendor.qty += qty;
      vendor.prices.push(Number(line.unitPrice || 0));
      if (line.date) vendor.purchaseDates.add(line.date);
      if (Number(line.ts || 0) >= Number(vendor.lastTs || 0)) {
        vendor.lastTs = Number(line.ts || 0);
        vendor.lastPrice = Number(line.unitPrice || 0);
      }
      row._vendorMap[line.vendorKey] = vendor;
      if (Number(line.ts || 0) >= Number(row.lastPurchaseAt || 0)) {
        row.lastPurchaseAt = Number(line.ts || 0);
        row.lastStore = line.vendorKey;
        row.lastPrice = Number(line.unitPrice || line.totalPrice || row.lastPrice || 0);
      }
    }
    if (bucket === 'visible') {
      row.visibleSpend += scopedTotal;
      row.visibleQty += qty;
      if (line.date) row._visibleDateSet.add(line.date);
    }
    if (bucket === 'month') {
      row.monthSpend += scopedTotal;
      row.monthQty += qty;
      if (line.date) row._monthDateSet.add(line.date);
    }
  };

  allLines.forEach((line) => applyLineToAggregate(line, 'all'));
  rangeLines.forEach((line) => applyLineToAggregate(line, 'visible'));
  monthLines.forEach((line) => applyLineToAggregate(line, 'month'));

  const rangeTotalSpend = rangeLines.reduce((sum, line) => sum + Number(line.scopedTotal || 0), 0);
  const monthTotalSpend = monthLines.reduce((sum, line) => sum + Number(line.scopedTotal || 0), 0);
  const activeList = resolveActiveProductsList();
  const activeListProductIds = new Set(Object.values(activeList.lines || {}).map((line) => String(line.productId || '').trim()).filter(Boolean));

  const allCatalogRows = Object.values(aggregates)
    .filter((row) => !row.hiddenMerged)
    .filter((row) => !state.foodCatalog.ignored?.[row.canonicalId])
    .map((row) => {
      const purchaseTs = [...new Set(row._purchaseTs.filter((ts) => Number.isFinite(ts) && ts > 0))].sort((a, b) => a - b);
      const observedFrequencyDays = averageProductsGapDays(purchaseTs);
      const observedDurationDays = averageProductsDurationDays(purchaseTs);
      const replenishmentCycleDays = normalizeProductPositiveNumber(
        observedFrequencyDays,
        normalizeProductPositiveNumber(row.purchaseFrequencyDays, 0),
      );
      const effectiveDurationDays = normalizeProductPositiveNumber(
        observedDurationDays,
        normalizeProductPositiveNumber(
          row.estimatedDurationDays,
          normalizeProductPositiveNumber(replenishmentCycleDays > 0 ? replenishmentCycleDays - 1 : 0, 0),
        ),
      );
      const daysSinceLastPurchase = row.lastPurchaseAt
        ? Math.max(0, Math.round((nowTs() - Number(row.lastPurchaseAt || 0)) / 86400000))
        : null;
      const daysRemaining = Number.isFinite(daysSinceLastPurchase) && effectiveDurationDays > 0
        ? Math.round(effectiveDurationDays - daysSinceLastPurchase)
        : null;
      const weightedAvgPrice = row.totalQty > 0
        ? row._history.reduce((sum, item) => sum + (Number(item.unitPrice || 0) * Math.max(1, Number(item.qty || 1))), 0) / row.totalQty
        : 0;
      const currentUnitPrice = normalizeProductPositiveNumber(row.lastPrice, normalizeProductPositiveNumber(row.estimatedPrice, normalizeProductPositiveNumber(row.usualPrice, weightedAvgPrice)));
      const recurringQty = normalizeProductPositiveNumber(row.usualQty, 1);
      const predictedLineCost = currentUnitPrice * recurringQty;
      const projectedMonthlySpend = replenishmentCycleDays > 0
        ? (30 / replenishmentCycleDays) * predictedLineCost
        : row.monthSpend;
      const vendorRows = Object.values(row._vendorMap)
        .map((vendor) => ({
          vendorKey: vendor.vendorKey,
          spend: vendor.spend,
          qty: vendor.qty,
          avgPrice: vendor.qty > 0
            ? vendor.prices.reduce((sum, value) => sum + Number(value || 0), 0) / Math.max(1, vendor.prices.length)
            : 0,
          lastPrice: Number(vendor.lastPrice || 0),
          purchaseCount: vendor.purchaseDates.size,
          lastTs: Number(vendor.lastTs || 0),
        }))
        .sort((a, b) => Number(a.avgPrice || Infinity) - Number(b.avgPrice || Infinity));
      const bestStore = vendorRows[0] || null;
      const searchIndex = normalizeProductItemKey([
        row.canonicalId,
        row.canonicalName,
        row.productType,
        row.productCategory,
        row.preferredStore,
        row.brand,
        row.format,
        row.notes,
        ...(Array.isArray(row.tags) ? row.tags : []),
        ...(Array.isArray(row.aliasList) ? row.aliasList : []),
      ].filter(Boolean).join(' '));
      const dueTone = resolveProductsDueTone(daysRemaining, row.active);
      const nextForecastDate = replenishmentCycleDays > 0 && row.lastPurchaseAt
        ? dayKeyFromTs(Number(row.lastPurchaseAt || 0) + (replenishmentCycleDays * 86400000))
        : '';
      return {
        ...row,
        currentUnitPrice,
        weightedAvgPrice,
        purchaseCount: row._purchaseDateSet.size,
        visiblePurchaseCount: row._visibleDateSet.size,
        monthPurchaseCount: row._monthDateSet.size,
        observedFrequencyDays,
        observedDurationDays,
        estimatedDurationDays: effectiveDurationDays,
        replenishmentCycleDays,
        daysSinceLastPurchase,
        daysRemaining,
        dueTone,
        dueLabel: resolveProductsDueLabel(daysRemaining, dueTone),
        predictedLineCost,
        projectedMonthlySpend,
        priceBand: resolveProductsPriceBand(currentUnitPrice),
        frequencyBand: resolveProductsCadenceBand(replenishmentCycleDays),
        durationBand: resolveProductsCadenceBand(effectiveDurationDays),
        bestStoreKey: bestStore?.vendorKey || '',
        bestStorePrice: Number(bestStore?.avgPrice || 0),
        vendorRows,
        history: row._history.slice().sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)),
        recentHistory: row._history.slice().sort((a, b) => Number(b.ts || 0) - Number(a.ts || 0)).slice(0, 5),
        sparklinePath: buildProductsSparklinePath(row._history),
        searchIndex,
        nextForecastDate,
        inActiveList: activeListProductIds.has(row.canonicalId),
      };
    });
  const catalogRows = allCatalogRows
    .filter((row) => {
      if (nextCfg.status === 'active' && !row.active) return false;
      if (nextCfg.status === 'inactive' && row.active) return false;
      if (nextCfg.status === 'due' && !['critical', 'soon'].includes(row.dueTone)) return false;
      if (nextCfg.productType !== 'all' && row.productType !== nextCfg.productType) return false;
      if (nextCfg.category !== 'all' && row.productCategory !== nextCfg.category) return false;
      if (nextCfg.store !== 'all' && (row.preferredStore || row.bestStoreKey || row.lastStore || '') !== nextCfg.store) return false;
      if (nextCfg.priceBand !== 'all' && row.priceBand !== nextCfg.priceBand) return false;
      if (nextCfg.frequencyBand !== 'all' && row.frequencyBand !== nextCfg.frequencyBand) return false;
      if (nextCfg.durationBand !== 'all' && row.durationBand !== nextCfg.durationBand) return false;
      if (!matchesProductsReplenishmentWindow(nextCfg.replenishmentWindow, row)) return false;
      if (nextCfg.onlyWithItems && row.visiblePurchaseCount <= 0) return false;
      const queryKey = normalizeProductItemKey(nextCfg.productsQuery || '');
      if (queryKey && !String(row.searchIndex || '').includes(queryKey)) return false;
      return true;
    });

  const sorters = {
    forecast: (a, b) => {
      const toneWeight = { critical: 4, soon: 3, stable: 2, unknown: 1, inactive: 0 };
      return (toneWeight[b.dueTone] || 0) - (toneWeight[a.dueTone] || 0)
        || Number(a.daysRemaining ?? Infinity) - Number(b.daysRemaining ?? Infinity)
        || Number(b.projectedMonthlySpend || 0) - Number(a.projectedMonthlySpend || 0);
    },
    name: (a, b) => String(a.canonicalName || '').localeCompare(String(b.canonicalName || ''), 'es', { sensitivity: 'base' }),
    price: (a, b) => Number(b.currentUnitPrice || 0) - Number(a.currentUnitPrice || 0),
    'last-purchase': (a, b) => Number(b.lastPurchaseAt || 0) - Number(a.lastPurchaseAt || 0),
    duration: (a, b) => Number(a.estimatedDurationDays || Infinity) - Number(b.estimatedDurationDays || Infinity),
    consumption: (a, b) => Number(b.totalQty || 0) - Number(a.totalQty || 0),
    spend: (a, b) => Number(b.totalSpend || 0) - Number(a.totalSpend || 0),
  };

  const filteredRows = catalogRows.slice().sort(sorters[nextCfg.sortBy] || sorters.forecast);
  const filteredVisibleSpend = filteredRows.reduce((sum, row) => sum + Number(row.visibleSpend || 0), 0);
  const filteredVisibleQty = filteredRows.reduce((sum, row) => sum + Number(row.visibleQty || 0), 0);
  const listQueryKey = normalizeProductItemKey(nextCfg.listQuery || '');
  const quickRows = allCatalogRows
    .filter((row) => row.active !== false)
    .filter((row) => !listQueryKey || String(row.searchIndex || '').includes(listQueryKey))
    .slice()
    .sort(sorters.forecast);
  const groupedMap = filteredRows.reduce((acc, row) => {
    const group = resolveProductsGroupMeta(row, nextCfg.groupBy);
    if (!acc[group.key]) {
      acc[group.key] = {
        key: group.key,
        label: group.label,
        rows: [],
      };
    }
    acc[group.key].rows.push(row);
    return acc;
  }, {});
  const groups = Object.values(groupedMap)
    .map((group) => ({
      key: group.key,
      label: group.label,
      allRows: group.rows,
    }))
    .map((group) => {
      const searchQuery = String(nextCfg.catalogSearchByGroup?.[group.key] || '');
      const searchKey = normalizeProductItemKey(searchQuery);
      const visibleRows = searchKey
        ? group.allRows.filter((row) => String(row.searchIndex || '').includes(searchKey))
        : group.allRows;
      return {
        ...group,
        searchQuery,
        rows: visibleRows,
        totalCount: group.allRows.length,
        visibleCount: visibleRows.length,
        totalSpend: group.allRows.reduce((sum, row) => sum + Number(row.totalSpend || 0), 0),
        projectedSpend: group.allRows.reduce((sum, row) => sum + Number(row.projectedMonthlySpend || 0), 0),
        dueCount: group.allRows.filter((row) => ['critical', 'soon'].includes(row.dueTone)).length,
      };
    })
    .sort((a, b) => String(a.label || '').localeCompare(String(b.label || ''), 'es', { sensitivity: 'base' }));

  const catalogById = Object.fromEntries(allCatalogRows.map((row) => [row.canonicalId, row]));
  const selectedIds = nextCfg.selectedIds.filter((id) => Boolean(catalogById[id]));
  let selectedProductId = nextCfg.selectedProductId;
  const wantsNewProduct = selectedProductId === '__new__';
  if (wantsNewProduct) {
    selectedProductId = '';
  } else if (!selectedProductId || !catalogById[selectedProductId]) {
    selectedProductId = filteredRows[0]?.canonicalId || catalogRows[0]?.canonicalId || allCatalogRows[0]?.canonicalId || '';
  }
  const selectedProduct = wantsNewProduct ? null : (selectedProductId ? catalogById[selectedProductId] || null : null);
  const allListLines = Object.values(activeList.lines || {})
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0))
    .map((line) => {
      const linkedProduct = catalogById[line.productId] || state.food.itemsById?.[line.productId] || null;
      const estimatedPrice = normalizeProductPositiveNumber(
        line.estimatedPrice,
        normalizeProductPositiveNumber(linkedProduct?.estimatedPrice, resolveProductsCatalogPrice(linkedProduct || {})),
      );
      const actualPrice = normalizeProductPositiveNumber(line.actualPrice, estimatedPrice);
      const computedLine = calculateLineTotals({ ...line, estimatedPrice, actualPrice });
      return {
        ...line,
        name: normalizeFoodName(line.name || linkedProduct?.canonicalName || linkedProduct?.displayName || linkedProduct?.name || line.productId || 'Producto'),
        unit: normalizeProductUnit(line.unit || linkedProduct?.unit || 'ud'),
        estimatedPrice,
        actualPrice,
        estimatedSubtotal: computedLine.estimatedSubtotal,
        actualSubtotal: computedLine.actualSubtotal,
        linkedProduct,
      };
    });
  const ticketsById = Object.entries(activeList.tickets || {}).reduce((acc, [ticketId, ticketMeta]) => {
    acc[ticketId] = { ...ticketMeta, id: ticketId, lines: [] };
    return acc;
  }, {});
  const primaryTicketId = String(activeList.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  if (!ticketsById[primaryTicketId]) ticketsById[primaryTicketId] = normalizeProductsListTicketMeta(primaryTicketId, { label: 'Sin asignar' });
  allListLines.forEach((line) => {
    const ticketId = String(line.ticketId || primaryTicketId).trim() || primaryTicketId;
    if (!ticketsById[ticketId]) ticketsById[ticketId] = normalizeProductsListTicketMeta(ticketId, { label: `Ticket ${Object.keys(ticketsById).length + 1}` });
    ticketsById[ticketId].lines.push(line);
  });
  const tickets = Object.values(ticketsById)
    .map((ticket, index) => ({
      ...ticket,
      label: ticket.label || (index === 0 ? 'Sin asignar' : `Ticket ${index + 1}`),
      sortOrder: Number(ticket.sortOrder || index),
      estimatedTotal: (ticket.lines || []).reduce((sum, line) => sum + Number(line.estimatedSubtotal || 0), 0),
      actualTotal: (ticket.lines || []).reduce((sum, line) => sum + Number(line.actualSubtotal || 0), 0),
      lineCount: (ticket.lines || []).length,
    }))
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const ticketDisplayLabels = buildProductsTicketDisplayLabelMap(tickets, 'Sin asignar');
  const ticketsWithDisplay = tickets.map((ticket) => ({
    ...ticket,
    displayLabel: ticketDisplayLabels[ticket.id] || resolveProductsTicketBaseLabel(ticket, 'Sin asignar'),
  }));
  const activeTicketId = ticketsById[activeList.activeTicketId] ? activeList.activeTicketId : (tickets[0]?.id || primaryTicketId);
  const activeTicket = ticketsWithDisplay.find((ticket) => ticket.id === activeTicketId) || ticketsWithDisplay[0] || { id: primaryTicketId, lines: [], estimatedTotal: 0, actualTotal: 0, lineCount: 0, displayLabel: 'Sin asignar' };
  const listLines = activeTicket.lines || [];

  const activeListEstimatedTotal = allListLines.reduce((sum, line) => sum + Number(line.estimatedSubtotal || 0), 0);
  const activeListActualTotal = allListLines.reduce((sum, line) => sum + Number(line.actualSubtotal || 0), 0);
  const dueSuggestions = allCatalogRows
    .filter((row) => row.active && !activeListProductIds.has(row.canonicalId))
    .sort(sorters.forecast)
    .slice(0, 6);
  const recentTickets = Object.values(state.productsHub?.tickets || {})
    .map((ticket) => ({
      ...ticket,
      actualTotal: normalizeProductPositiveNumber(ticket.actualTotal, Object.values(ticket.lines || {}).reduce((sum, line) => sum + (Math.max(0.01, Number(line.qty || 1)) * normalizeProductPositiveNumber(line.actualPrice || line.estimatedPrice, 0)), 0)),
      lineCount: Object.keys(ticket.lines || {}).length,
      confirmedAt: normalizeProductNumber(ticket.confirmedAt, normalizeProductNumber(ticket.updatedAt, parseDayKey(String(ticket.dateISO || '')))),
    }))
    .sort((a, b) => Number(b.confirmedAt || 0) - Number(a.confirmedAt || 0));
  const reusableLists = Object.values(state.productsHub?.lists || {})
    .filter((list) => list.id !== activeList.id && list.id !== '__draft__' && Object.keys(list.lines || {}).length)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, 6);
  const dueSuggestedSpend = dueSuggestions.reduce((sum, row) => sum + Number(row.predictedLineCost || 0), 0);
  const monthlyTarget = normalizeProductPositiveNumber(state.productsHub?.settings?.monthlyTarget, 0);
  const nowDate = new Date();
  const daysInMonth = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0).getDate();
  const dayOfMonth = Math.max(1, nowDate.getDate());
  const projectedMonthSpend = dayOfMonth > 0 ? (monthTotalSpend / dayOfMonth) * daysInMonth : monthTotalSpend;
  const budgetRemaining = monthlyTarget - monthTotalSpend;
  const budgetAfterSuggestions = monthlyTarget - monthTotalSpend - dueSuggestedSpend;

  return {
    cfg: nextCfg,
    products: allCatalogRows,
    listVisible: filteredRows,
    quickRows,
    groups,
    selectedIds,
    selectedProductId,
    selectedProduct,
    catalogById,
    activeList,
    activeTicket,
    activeTicketId,
    tickets: ticketsWithDisplay,
    allListLines,
    listLines,
    activeListEstimatedTotal,
    activeListActualTotal,
    dueSuggestions,
    recentTickets,
    reusableLists,
    monthlyTarget,
    monthTotalSpend,
    projectedMonthSpend,
    budgetRemaining,
    budgetAfterSuggestions,
    dueSuggestedSpend,
    rangeTotalSpend,
    rangeLabel: buildProductsRangeLabel(nextCfg),
    vendorOptions: ['all', ...new Set(allLines.map((line) => line.vendorKey).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    accountOptions: ['all', ...new Set(balanceTxList().filter((row) => normalizeTxType(row?.type) === 'expense').map((row) => String(row.accountId || '')).filter(Boolean))],
    typeOptions: ['all', ...new Set(allCatalogRows.map((row) => row.productType).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    categoryOptions: ['all', ...new Set(allCatalogRows.map((row) => row.productCategory).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    storeOptions: ['all', ...new Set(allCatalogRows.map((row) => row.preferredStore || row.bestStoreKey || row.lastStore).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' })),
    totalCatalogSpend: allCatalogRows.reduce((sum, row) => sum + Number(row.totalSpend || 0), 0),
    totalProjectedSpend: allCatalogRows.reduce((sum, row) => sum + Number(row.projectedMonthlySpend || 0), 0),
    activeCount: allCatalogRows.filter((row) => row.active).length,
    dueCount: allCatalogRows.filter((row) => ['critical', 'soon'].includes(row.dueTone)).length,
    filteredCount: filteredRows.length,
    catalogCount: allCatalogRows.length,
    filteredVisibleSpend,
    filteredVisibleQty,
    purchaseCount: rangeLines.length ? new Set(rangeLines.map((line) => line.txId)).size : 0,
    itemsCount: rangeLines.length,
    topVendor: (() => {
      const vendorSpend = rangeLines.reduce((acc, line) => {
        acc[line.vendorKey] = (acc[line.vendorKey] || 0) + Number(line.scopedTotal || 0);
        return acc;
      }, {});
      const top = Object.entries(vendorSpend).sort((a, b) => b[1] - a[1])[0] || null;
      return top ? { key: top[0], total: top[1] } : null;
    })(),
    lines: rangeLines,
  };
}

function renderProductsSummaryCards(model) {
  const trendTone = model.monthlyTarget > 0 && model.projectedMonthSpend > model.monthlyTarget ? 'is-danger' : 'is-calm';
  const { cfg } = model;
  const rangeOptions = [
    ['day', 'Dia'],
    ['week', 'Semana'],
    ['month', 'Mes'],
    ['year', 'Ano'],
    ['total', 'Total'],
    ['custom', 'Personal'],
  ];
  const groupOptions = [
    ['type', 'Tipo'],
    ['store', 'Tienda'],
    ['date', 'Fecha'],
    ['status', 'Estado'],
  ];
  const sortOptions = [
    ['forecast', 'Reposicion'],
    ['name', 'Nombre'],
    ['price', 'Precio'],
    ['last-purchase', 'Ultima compra'],
    ['duration', 'Duracion'],
    ['consumption', 'Consumo'],
    ['spend', 'Gasto acumulado'],
  ];
  return `
    <section class="productsWorkbench__hero" id="financeProductsTopPanel">
     <div class="productsWorkbench__statsGrid">
        <article class="productsWorkbench__statCard">
          <span>Catalogados</span>
          <strong>${model.catalogCount}</strong>
          <small>${model.activeCount} activos · ${model.filteredCount} visibles</small>
        </article>
        <article class="productsWorkbench__statCard">
          <span>Compra en rango</span>
          <strong>${fmtCurrency(model.rangeTotalSpend)}</strong>
          <small>${model.purchaseCount} tickets · ${model.itemsCount} lineas</small>
        </article>
        <article class="productsWorkbench__statCard">
          <span>Mes real</span>
          <strong>${fmtCurrency(model.monthTotalSpend)}</strong>
          <small>${model.monthlyTarget > 0 ? `Objetivo ${fmtCurrency(model.monthlyTarget)}` : 'Sin objetivo mensual'}</small>
        </article>
        <article class="productsWorkbench__statCard ${trendTone}">
          <span>Proyeccion</span>
          <strong>${fmtCurrency(model.projectedMonthSpend)}</strong>
          <small>${model.monthlyTarget > 0 ? `${fmtCurrency(model.budgetRemaining)} restantes hoy` : 'Basado en ritmo diario'}</small>
        </article>
        <article class="productsWorkbench__statCard is-warning">
          <span>Reposicion sugerida</span>
          <strong>${model.dueCount}</strong>
          <small>${fmtCurrency(model.dueSuggestedSpend)} potenciales</small>
        </article>
        <article class="productsWorkbench__statCard">
          <span>Vendor dominante</span>
          <strong>${model.topVendor ? escapeHtml(model.topVendor.key) : '—'}</strong>
          <small>${model.topVendor ? fmtCurrency(model.topVendor.total) : 'Sin historico visible'}</small>
        </article>
      </div>
      <div class="productsWorkbench__heroText" id="financeProductsTopPanelSearch">
        <label class="productsWorkbench__field productsWorkbench__field--search finance-products-search">
          <span>Buscar productos</span>
          <input class="food-control" type="search" value="${escapeHtml(cfg.productsQuery || '')}" data-products-filter="productsQuery" placeholder="nombre, marca, tag, id..." />
        </label>
      </div>
      <div class="productsWorkbench__toolbarMain finance-products-filter-main" id="financeProductsTopPanelFilters">
        <label class="productsWorkbench__field">
          <span>Rango</span>
          <select class="food-control" data-products-filter="range">
            ${rangeOptions.map(([value, label]) => `<option value="${value}" ${cfg.range === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="productsWorkbench__field">
          <span>Agrupar</span>
          <select class="food-control" data-products-filter="groupBy">
            ${groupOptions.map(([value, label]) => `<option value="${value}" ${cfg.groupBy === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="productsWorkbench__field">
          <span>Ordenar</span>
          <select class="food-control" data-products-filter="sortBy">
            ${sortOptions.map(([value, label]) => `<option value="${value}" ${cfg.sortBy === value ? 'selected' : ''}>${label}</option>`).join('')}
          </select>
        </label>
        <label class="productsWorkbench__field">
          <span>Scope</span>
          <select class="food-control" data-products-filter="scope">
            <option value="personal" ${cfg.scope === 'personal' ? 'selected' : ''}>Mi parte</option>
            <option value="global" ${cfg.scope === 'global' ? 'selected' : ''}>Global</option>
          </select>
        </label>
      </div>
      <details class="productsWorkbench__settingsCard productsWorkbench__collapse finance-products-filter-section" id="financeProductsTopPanelSettings">
        <summary class="productsWorkbench__settingsSummary">
          <span>Más filtros</span>
          <span class="productsWorkbench__groupChevron" aria-hidden="true">›</span>
        </summary>
        <div class="productsWorkbench__settingsGrid finance-products-filter-section">
          <div class="finance-products-filter-row">
            <label class="productsWorkbench__field">
              <span>Objetivo mensual</span>
              <input class="food-control" type="number" step="0.01" min="0" value="${Number(model.monthlyTarget || 0) || ''}" data-products-setting="monthlyTarget" />
            </label>
            <label class="productsWorkbench__field">
              <span>Cuenta por defecto</span>
              <select class="food-control" data-products-setting="defaultAccountId">
                <option value="">Seleccionar</option>
                ${(state.accounts || []).map((account) => `<option value="${escapeHtml(account.id)}" ${state.productsHub?.settings?.defaultAccountId === account.id ? 'selected' : ''}>${escapeHtml(account.name || account.id)}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__field">
              <span>Supermercado base</span>
              <input class="food-control" type="text" value="${escapeHtml(state.productsHub?.settings?.defaultStore || '')}" data-products-setting="defaultStore" placeholder="mercadona" />
            </label>
            <label class="productsWorkbench__field">
              <span>Pago base</span>
              <input class="food-control" type="text" value="${escapeHtml(state.productsHub?.settings?.defaultPaymentMethod || 'Tarjeta')}" data-products-setting="defaultPaymentMethod" placeholder="Tarjeta" />
            </label>
          </div>
          <div class="finance-products-filter-row">
            <label class="productsWorkbench__field">
              <span>Rango</span>
              <select class="food-control" data-products-filter="range">
                ${rangeOptions.map(([value, label]) => `<option value="${value}" ${cfg.range === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__field">
              <span>Tipo</span>
              <select class="food-control" data-products-filter="productType">
                ${model.typeOptions.map((value) => `<option value="${escapeHtml(value)}" ${cfg.productType === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'Todos' : value)}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__field">
              <span>Categoría</span>
              <select class="food-control" data-products-filter="category">
                ${model.categoryOptions.map((value) => `<option value="${escapeHtml(value)}" ${cfg.category === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'Todas' : value)}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__toggle">
              <input type="checkbox" ${cfg.onlyWithItems ? 'checked' : ''} data-products-filter="onlyWithItems" />
              <span>Solo actividad</span>
            </label>
          </div>
          <div class="finance-products-filter-row">
            <label class="productsWorkbench__field">
              <span>Tienda</span>
              <select class="food-control" data-products-filter="store">
                ${model.storeOptions.map((value) => `<option value="${escapeHtml(value)}" ${cfg.store === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'Todas' : value)}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__field">
              <span>Vendedor</span>
              <select class="food-control" data-products-filter="vendor">
                ${model.vendorOptions.map((value) => `<option value="${escapeHtml(value)}" ${cfg.vendor === value ? 'selected' : ''}>${escapeHtml(value === 'all' ? 'Todos' : value)}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__field">
              <span>Cuenta</span>
              <select class="food-control" data-products-filter="account">
                ${model.accountOptions.map((id) => `<option value="${escapeHtml(id)}" ${cfg.account === id ? 'selected' : ''}>${escapeHtml(id === 'all' ? 'Todas' : (state.accounts.find((account) => account.id === id)?.name || id))}</option>`).join('')}
              </select>
            </label>
            <label class="productsWorkbench__field">
              <span>Estado</span>
              <select class="food-control" data-products-filter="status">
                <option value="active" ${cfg.status === 'active' ? 'selected' : ''}>Activos</option>
                <option value="all" ${cfg.status === 'all' ? 'selected' : ''}>Todos</option>
                <option value="due" ${cfg.status === 'due' ? 'selected' : ''}>Por reponer</option>
                <option value="inactive" ${cfg.status === 'inactive' ? 'selected' : ''}>Inactivos</option>
              </select>
            </label>
          </div>
          <label class="productsWorkbench__field">
            <span>Agrupar</span>
            <select class="food-control" data-products-filter="groupBy">
              ${groupOptions.map(([value, label]) => `<option value="${value}" ${cfg.groupBy === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          <label class="productsWorkbench__field">
            <span>Ordenar</span>
            <select class="food-control" data-products-filter="sortBy">
              ${sortOptions.map(([value, label]) => `<option value="${value}" ${cfg.sortBy === value ? 'selected' : ''}>${label}</option>`).join('')}
            </select>
          </label>
          ${cfg.range === 'custom' ? `
            <label class="productsWorkbench__field">
              <span>Desde</span>
              <input class="food-control" type="date" value="${escapeHtml(cfg.customStart || '')}" data-products-filter="customStart" />
            </label>
            <label class="productsWorkbench__field">
              <span>Hasta</span>
              <input class="food-control" type="date" value="${escapeHtml(cfg.customEnd || '')}" data-products-filter="customEnd" />
            </label>
          ` : ''}
        </div>
        <button type="button" class="food-history-btn productsWorkbench__settingsSave" data-products-save-settings>Guardar ajustes</button>
      </details>
     
    </section>
  `;
}

function renderProductsFilters(model) {
  return '';
}

function productsWorkbenchDomId(prefix = 'product', value = '') {
  return `${prefix}-${hashString(String(value || ''))}`;
}

function renderProductsSubviewSwitch(model) {
  const activeTab = model?.cfg?.tab === 'catalog' ? 'catalog' : 'list';
  const tabRows = [
    ['list', 'Lista y ticket', `${model.listLines.length} items`, 'Preparar compra'],
    ['catalog', 'Catalogo operativo', `${model.filteredCount}/${model.catalogCount}`, 'Gestionar productos'],
  ];
  return `
    <nav class="productsWorkbench__viewSwitch" aria-label="Vista de productos">
      ${tabRows.map(([value, label, meta, hint]) => `
        <button
          type="button"
          class="productsWorkbench__viewSwitchBtn ${activeTab === value ? 'is-active' : ''}"
          data-products-tab="${value}"
          aria-pressed="${activeTab === value ? 'true' : 'false'}">
          <span>${escapeHtml(label)}</span>
          <small>${escapeHtml(meta)} · ${escapeHtml(hint)}</small>
        </button>
      `).join('')}
    </nav>
  `;
}

function buildProductsStoreChoices(model = null) {
  const activeList = model?.activeList || resolveActiveProductsList();
  return [
    activeList.store,
    state.productsHub?.settings?.defaultStore,
    ...(Array.isArray(model?.storeOptions) ? model.storeOptions.filter((value) => value !== 'all') : []),
    ...foodOptionList('place'),
  ]
    .map((value) => normalizeFoodName(value || ''))
    .filter(Boolean)
    .filter((value, index, arr) => arr.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index)
    .sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}

function renderProductsStoreSelect(model = null) {
  const activeList = model?.activeList || resolveActiveProductsList();
  const current = normalizeFoodName(model?.activeTicket?.store || activeList.store || state.productsHub?.settings?.defaultStore || '');
  const choices = buildProductsStoreChoices(model);
  const hasCurrent = !current || choices.some((value) => value.toLowerCase() === current.toLowerCase());
  const options = [
    '<option value="">Seleccionar</option>',
    ...(!hasCurrent ? [`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)}</option>`] : []),
    ...choices.map((value) => `<option value="${escapeHtml(value)}" ${current && value.toLowerCase() === current.toLowerCase() ? 'selected' : ''}>${escapeHtml(value)}</option>`),
    '<option value="__new__">+ Nuevo supermercado</option>',
  ].join('');
  return `
    <select class="food-control" name="store" data-products-store-select>
      ${options}
    </select>
    <input class="food-control productsWorkbench__newStoreInput" type="text" data-products-new-store-input placeholder="Nuevo supermercado" hidden />
  `;
}

function renderProductsAccountSelect(model = null) {
  const activeList = model?.activeList || resolveActiveProductsList();
  const current = String(model?.activeTicket?.accountId || activeList.accountId || '').trim();
  return `
    <select class="food-control productsWorkbench__receiptMetaControl productsWorkbench__receiptMetaControl--payment" name="accountId" data-products-receipt-payment aria-label="Cuenta">
      <option value="">Sin cuenta</option>
      ${(state.accounts || []).map((account) => `<option value="${escapeHtml(account.id)}" ${current === account.id ? 'selected' : ''}>${escapeHtml(account.name || account.id)}</option>`).join('')}
    </select>
  `;
}

function buildProductsReceiptSuggestions(model = null, query = '', { limit = 7, excludeList = true } = {}) {
  const activeProductIds = new Set((model?.listLines || []).map((line) => String(line.productId || '').trim()).filter(Boolean));
  const queryKey = normalizeProductItemKey(query || '');
  return (model?.products || [])
    .map((row) => {
      const nameKey = normalizeProductItemKey(row.canonicalName || row.displayName || row.name || '');
      const searchKey = String(row.searchIndex || `${nameKey} ${normalizeProductItemKey(row.brand || '')} ${normalizeProductItemKey(row.productCategory || '')}`);
      if (queryKey && !searchKey.includes(queryKey)) return null;
      if (excludeList && activeProductIds.has(String(row.canonicalId || '').trim())) return null;
      const starts = queryKey && nameKey.startsWith(queryKey) ? 10000 : 0;
      const contains = queryKey ? Math.max(0, 7000 - Math.max(0, nameKey.indexOf(queryKey)) * 30) : 0;
      const usage = Number(row.purchaseCount || 0) * 85;
      const recent = Number(row.lastPurchaseAt || 0) / 100000000000;
      return { ...row, _receiptScore: starts + contains + usage + recent };
    })
    .filter(Boolean)
    .sort((a, b) => Number(b._receiptScore || 0) - Number(a._receiptScore || 0) || String(a.canonicalName || '').localeCompare(String(b.canonicalName || ''), 'es', { sensitivity: 'base' }))
    .slice(0, limit);
}

function renderProductsReceiptSuggestionList(model = null, query = '', lineId = '') {
  const rows = buildProductsReceiptSuggestions(model, query, { excludeList: !lineId });
  const safeLineId = String(lineId || '').trim();
  if (!rows.length) {
    return `<div class="productsWorkbench__receiptSuggestEmpty">${query ? `Sin coincidencias para "${escapeHtml(query)}"` : 'Empieza a escribir para buscar'}</div>`;
  }
  return rows.map((row) => `
    <button
      type="button"
      class="productsWorkbench__receiptSuggestion"
      data-products-receipt-pick="${escapeHtml(row.canonicalId)}"
      ${safeLineId ? `data-products-receipt-pick-line="${escapeHtml(safeLineId)}"` : ''}>
      <strong>${escapeHtml(row.canonicalName || 'Producto')}</strong>
      <small>${escapeHtml(row.productCategory || row.productType || row.preferredStore || row.bestStoreKey || 'Catalogo')} · ${fmtCurrency(resolveProductsCatalogPrice(row))}</small>
    </button>
  `).join('');
}

function renderProductsReceiptLineRow(line, model) {
  const lineId = String(line.id || '').trim();
  const listId = String(model?.activeList?.id || '__draft__');
  const selection = state.foodProductsView?.receiptSelections?.[listId] || {};
  const isSelected = !!selection[lineId];
  const normalized = calculateLineTotals(line);
  const lineDiffMeta = resolveProductsReceiptDiffMeta(normalized.diffSubtotal);
  return `
    <div class="productsWorkbench__receiptRow ${isSelected ? 'is-selected' : ''}" data-products-receipt-row="${escapeHtml(lineId)}">
      <label class="productsWorkbench__receiptSelectWrap" aria-label="Seleccionar ${escapeHtml(line.name || 'producto')}">
        <input type="checkbox" class="productsWorkbench__receiptSelect" data-products-receipt-select="${escapeHtml(lineId)}" ${isSelected ? 'checked' : ''} />
      </label>
      <input
        class="productsWorkbench__receiptQty food-control"
        type="number"
        min="0.01"
        step="0.01"
        inputmode="decimal"
        value="${Number(normalized.qty || 1)}"
        aria-label="Cantidad de ${escapeHtml(line.name || 'producto')}"
        data-products-receipt-qty="${escapeHtml(lineId)}" />
      <div class="productsWorkbench__receiptNameWrap">
        <input
          class="productsWorkbench__receiptName food-control"
          type="search"
          value="${escapeHtml(line.name || 'Producto')}"
          autocomplete="off"
          aria-label="Producto"
          data-products-receipt-name="${escapeHtml(lineId)}" />
        <div class="productsWorkbench__receiptSuggest" data-products-receipt-suggest="${escapeHtml(lineId)}" hidden>
          ${renderProductsReceiptSuggestionList(model, line.name || '', lineId)}
        </div>
      </div>
      <input
        class="productsWorkbench__receiptUnit food-control"
        type="text"
        inputmode="decimal"
        value="${escapeHtml(fmtCurrency(normalized.estimatedPrice || 0))}"
        aria-label="Precio previsto de ${escapeHtml(line.name || 'producto')}"
        data-money-last-valid="${escapeHtml(String(Number(normalized.estimatedPrice || 0).toFixed(2)))}"
        data-products-receipt-unit="${escapeHtml(lineId)}" />
      <div class="productsWorkbench__receiptTotalStack">
        <input
          class="productsWorkbench__receiptTotal food-control"
          type="text"
          inputmode="decimal"
          value="${escapeHtml(fmtCurrency(normalized.actualPrice || 0))}"
          aria-label="Precio real de ${escapeHtml(line.name || 'producto')}"
          data-money-last-valid="${escapeHtml(String(Number(normalized.actualPrice || 0).toFixed(2)))}"
          data-products-receipt-total="${escapeHtml(lineId)}" />
        <small class="productsWorkbench__receiptLineDiff is-${lineDiffMeta.tone}" data-products-receipt-diff="${escapeHtml(lineId)}">${lineDiffMeta.label}</small>
      </div>
      <button type="button" class="productsWorkbench__receiptRemove" data-products-remove-line="${escapeHtml(lineId)}" aria-label="Eliminar ${escapeHtml(line.name || 'linea')}">❌</button>
    </div>
  `;
}

function renderProductsReceiptEmptyRow(model) {
  return `
    <div class="productsWorkbench__receiptRow productsWorkbench__receiptRow--add" data-products-receipt-add-row>
      <span class="productsWorkbench__receiptSelectWrap productsWorkbench__receiptSelectWrap--placeholder" aria-hidden="true"></span>
      <input class="productsWorkbench__receiptQty food-control" type="number" min="1" step="0.01" inputmode="decimal" value="1" aria-label="Cantidad nueva" data-products-receipt-add-qty />
      <div class="productsWorkbench__receiptNameWrap">
        <input class="productsWorkbench__receiptName food-control" type="search" autocomplete="off" placeholder="Escribir producto..." aria-label="Anadir producto" data-products-receipt-add-name />
        <div class="productsWorkbench__receiptSuggest" data-products-receipt-add-suggest hidden>
          ${renderProductsReceiptSuggestionList(model, '')}
        </div>
      </div>
      <input class="productsWorkbench__receiptUnit food-control" type="number" min="0" step="0.01" inputmode="decimal" placeholder="precio/u" aria-label="Precio unitario nuevo" data-products-receipt-add-unit />
      <strong class="productsWorkbench__receiptTotal" data-products-receipt-add-total>${fmtCurrency(0)}</strong>
      <button type="button" class="productsWorkbench__receiptAddHint" data-products-receipt-add-line aria-label="Añadir línea">+</button>
    </div>
  `;
}

function renderProductsBulkBar(model) {
  const selectedCount = model.selectedIds.length;
  if (selectedCount > 0) {
    return `
      <div class="productsWorkbench__bulkBar productsWorkbench__bulkBar--selected" data-products-bulk-bar>
        <div>
          <strong data-products-selected-count>${selectedCount} seleccionados</strong>
          <small>Acciones rapidas sobre la seleccion actual</small>
        </div>
        <div class="productsWorkbench__bulkActions">
          <button type="button" class="food-history-btn" data-products-create-ticket-from-selected>🧾 Nuevo ticket</button>
          <button type="button" class="food-history-btn" data-products-open-batch-modal>✏️ Editar</button>
          <button type="button" class="food-history-btn" data-food-merge-open="${escapeHtml(model.selectedIds[0] || '')}" ${selectedCount >= 2 ? '' : 'disabled'}>📚 Fusionar</button>
          <button type="button" class="food-history-btn" data-products-delete-selected ${selectedCount ? '' : 'disabled'}>❌ Eliminar</button>
        </div>
      </div>
    `;
  }
  return `
    <div class="productsWorkbench__bulkBar" data-products-bulk-bar>
      <div>
        <strong data-products-selected-count>${selectedCount} seleccionados</strong>
        <small>Marca productos para ver acciones rapidas</small>
      </div>
      <div class="productsWorkbench__bulkActions">
        <button type="button" class="food-history-btn" data-products-select-visible>Seleccionar visibles</button>
      </div>
    </div>
  `;
}

function renderProductsBatchToolbar(model, options = {}) {
  const selectedCount = model.selectedIds.length;
  const variantClass = options.modal ? 'productsWorkbench__batchForm--modal' : 'productsWorkbench__batchForm--toolbar';
  const hiddenAttr = options.modal ? '' : (selectedCount ? '' : 'hidden');
  const cancelAction = options.modal ? '<button type="button" class="food-history-btn" data-close-modal>Cerrar</button>' : '';
  return `
    <form class="productsWorkbench__batchForm ${variantClass}" data-products-batch-form data-products-batch-toolbar ${hiddenAttr}>
      <header>
        <strong>Edicion en bloque</strong>
        <small><span data-products-selected-count>${selectedCount} seleccionados</span></small>
      </header>
      <label class="productsWorkbench__field">
        <span>Tipo</span>
        <input class="food-control" type="text" name="productType" placeholder="Nuevo tipo comun" />
      </label>
      <label class="productsWorkbench__field">
        <span>Categoria</span>
        <input class="food-control" type="text" name="productCategory" placeholder="Nueva categoria comun" />
      </label>
      <label class="productsWorkbench__field">
        <span>Tienda</span>
        <input class="food-control" type="text" name="preferredStore" placeholder="Tienda comun" />
      </label>
      <label class="productsWorkbench__field">
        <span>Tags</span>
        <input class="food-control" type="text" name="tags" placeholder="stock, promo" />
      </label>
      <label class="productsWorkbench__field">
        <span>Estado</span>
        <select class="food-control" name="activeState">
          <option value="keep">Mantener</option>
          <option value="active">Activar</option>
          <option value="inactive">Desactivar</option>
        </select>
      </label>
      <div class="productsWorkbench__editorActions">
        <button class="food-history-btn" type="submit" ${selectedCount ? '' : 'disabled'}>Aplicar seleccion</button>
        <button type="button" class="food-history-btn" data-products-clear-selection ${selectedCount ? '' : 'disabled'}>Deseleccionar todo</button>
        ${cancelAction}
      </div>
    </form>
  `;
}

function renderProductsCatalogGroup(group, model) {
  const selectedSet = new Set(model.selectedIds || []);
  const safeGroupKey = escapeHtml(group.key);
  const carouselId = escapeHtml(productsWorkbenchDomId('financeProductsCategoryCarousel', group.key));
  const shouldOpenByDefault = Boolean(model.cfg?.catalogGroupsOpen?.[group.key]);
  return `
    <details class="productsWorkbench__group" data-products-catalog-group="${safeGroupKey}" ${shouldOpenByDefault ? 'open' : ''}>
      <summary class="productsWorkbench__groupHead">
        <div class="productsWorkbench__groupTitle">
          <strong>${escapeHtml(group.label)}</strong>
          <small>${group.totalCount} productos</small>
        </div>
        <div class="productsWorkbench__groupAside">
          <div class="productsWorkbench__groupMeta">
            <span data-products-catalog-visible>${group.visibleCount} visibles</span>
            <span>${group.dueCount} por reponer</span>
          </div>
          <span class="productsWorkbench__groupChevron" aria-hidden="true">›</span>
        </div>
      </summary>
      <div class="productsWorkbench__catalogGrid finance-products-carousel" id="${carouselId}" data-products-catalog-track>
        ${group.rows.map((row) => {
          const selectedClass = model.selectedProductId === row.canonicalId ? 'is-selected' : '';
          const dueText = row.inActiveList ? 'En lista' : row.dueLabel;
          const metaText = [row.preferredStore || row.bestStoreKey || '', Number(row.currentUnitPrice || 0) > 0 ? fmtCurrency(row.currentUnitPrice || 0) : ''].filter(Boolean).join(' · ');
          return `
          <article
            class="productsWorkbench__productCard ${selectedClass} is-${escapeHtml(row.dueTone)} ${!row.active ? 'is-inactive' : ''} ${row.inActiveList ? 'is-in-list' : ''}"
            id="${escapeHtml(productsWorkbenchDomId('product-card', row.canonicalId))}"
            data-products-catalog-card
            data-products-open-product="${escapeHtml(row.canonicalId)}"
            data-products-id="${escapeHtml(row.canonicalId)}"
            data-products-search="${escapeHtml(row.searchIndex || '')}">
            <div class="productsWorkbench__productTop">
              <label class="productsWorkbench__check" aria-label="Seleccionar ${escapeHtml(row.canonicalName)}">
                <input class="productsWorkbench__checkInput" type="checkbox" data-products-toggle-select="${escapeHtml(row.canonicalId)}" ${selectedSet.has(row.canonicalId) ? 'checked' : ''} />
                <i class="productsWorkbench__checkVisual" aria-hidden="true"></i>
              </label>
              <button type="button" class="productsWorkbench__productHeading" data-products-select-product="${escapeHtml(row.canonicalId)}">
                <strong>${escapeHtml(row.canonicalName)}</strong>
                <small class="productsWorkbench__status productsWorkbench__status--${escapeHtml(row.dueTone)}">${escapeHtml(dueText)}</small>
              </button>
              <div class="productsWorkbench__cardActions">
                <button type="button" class="productsWorkbench__miniAction" data-products-add-to-list="${escapeHtml(row.canonicalId)}" aria-label="Anadir ${escapeHtml(row.canonicalName)} a la lista">+</button>
                <button type="button" class="productsWorkbench__miniAction productsWorkbench__miniAction--danger" data-products-delete-product="${escapeHtml(row.canonicalId)}" aria-label="Eliminar ${escapeHtml(row.canonicalName)} del catalogo">×</button>
              </div>
            </div>
            ${metaText ? `<div class="productsWorkbench__productMeta"><span class="productsWorkbench__badge">${escapeHtml(metaText)}</span></div>` : ''}
          </article>
        `;
        }).join('')}
        <div class="productsWorkbench__emptyMini productsWorkbench__catalogEmpty" ${group.visibleCount ? 'hidden' : ''}>No hay productos en este tipo para esa busqueda.</div>
      </div>
    </details>
  `;
}

function renderProductsCatalogGroups(model) {
  if (!model.groups.some((group) => group.totalCount > 0)) {
    return '<div id="financeProductsCatalogGroups" class="productsWorkbench__catalogGroups"><div class="productsWorkbench__empty">No hay productos para este filtro.</div></div>';
  }
  return `<div id="financeProductsCatalogGroups" class="productsWorkbench__catalogGroups">${model.groups.map((group) => renderProductsCatalogGroup(group, model)).join('')}</div>`;
}

function applyProductsCatalogGroupSearch(inputEl) {
  const groupEl = inputEl?.closest?.('[data-products-catalog-group]');
  const groupKey = String(inputEl?.dataset?.productsCatalogGroupKey || groupEl?.dataset?.productsCatalogGroup || '').trim();
  if (!groupEl || !groupKey) return;
  const query = String(inputEl.value || '');
  const groupWasOpen = !!groupEl.open;
  const selectionStart = inputEl.selectionStart ?? query.length;
  const selectionEnd = inputEl.selectionEnd ?? query.length;
  const nextGroupSearch = {
    ...((state.foodProductsView && state.foodProductsView.catalogSearchByGroup && typeof state.foodProductsView.catalogSearchByGroup === 'object')
      ? state.foodProductsView.catalogSearchByGroup
      : {}),
    [groupKey]: query,
  };
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    catalogGroupsOpen: {
      ...((state.foodProductsView?.catalogGroupsOpen && typeof state.foodProductsView.catalogGroupsOpen === 'object')
        ? state.foodProductsView.catalogGroupsOpen
        : {}),
      [groupKey]: groupWasOpen,
    },
    catalogSearchByGroup: nextGroupSearch,
  };
  const model = buildCurrentProductsModel();
  const groupModel = (model.groups || []).find((group) => group.key === groupKey);
  const nextGroupNode = createProductsNode(groupModel
    ? renderProductsCatalogGroup(groupModel, model)
    : '<section class="productsWorkbench__group"></section>');
  if (groupWasOpen && 'open' in nextGroupNode) nextGroupNode.open = true;
  groupEl.replaceWith(nextGroupNode);
  const nextInput = nextGroupNode.querySelector('[data-products-catalog-search]');
  if (nextInput) {
    nextInput.focus();
    try {
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    } catch (_) {}
  }
}

function scrollProductsCatalogCarousel(buttonEl) {
  const groupEl = buttonEl?.closest?.('[data-products-catalog-group]');
  const track = groupEl?.querySelector?.('[data-products-catalog-track]');
  if (!track) return;
  const direction = Number(buttonEl.dataset.productsCarouselScroll || 1) < 0 ? -1 : 1;
  const visibleCards = Array.from(track.querySelectorAll('[data-products-catalog-card]:not([hidden])'));
  const cardWidth = visibleCards[0]?.getBoundingClientRect?.().width || track.clientWidth * 0.72;
  track.scrollBy({ left: direction * Math.max(cardWidth + 12, track.clientWidth * 0.72), behavior: 'smooth' });
}

function renderProductsCatalogPanel(model) {
  return `
    <section class="productsWorkbench__panel productsWorkbench__panel--catalog" data-products-catalog-panel id="financeProductsCatalogView">
      <header class="productsWorkbench__panelHead">
        <div>
          <h3>Catalogo operativo</h3>
          <p>${model.filteredCount} visibles · ${model.dueCount} por reponer</p>
        </div>
        <div class="productsWorkbench__panelActions">
          <button type="button" class="food-history-btn" data-products-new-product>Nuevo producto</button>
        </div>
      </header>
      ${renderProductsBulkBar(model)}
      <div class="productsWorkbench__collapseBody">
        ${renderProductsCatalogGroups(model)}
      </div>
    </section>
  `;
}

function renderProductsBatchEditModal(model) {
  return `
    <div id="finance-modal" class="finance-modal food-sheet-modal productsWorkbenchModal" role="dialog" aria-modal="true" tabindex="-1">
      <header class="food-sheet-header">
        <h3>Editar seleccion</h3>
        <button class="btn-x food-sheet-close" data-close-modal aria-label="Cerrar">✕</button>
      </header>
      <section class="finFoodDetailSection finFoodCard">
        ${renderProductsBatchToolbar(model, { modal: true })}
      </section>
    </div>
  `;
}

function renderProductsEditorPanel(model) {
  const selected = model.selectedProduct;
  const ticketQuickActionDisabled = !selected ? 'disabled' : '';
  const detailEntity = selected ? resolveFoodItemByAnyKey(selected.canonicalId || selected.id || '') : null;
  const detailActionDisabled = !selected || !detailEntity ? 'disabled' : '';
  const values = selected || {
    canonicalId: '',
    canonicalName: '',
    productType: '',
    productCategory: '',
    preferredStore: state.productsHub?.settings?.defaultStore || '',
    brand: '',
    format: '',
    usualPrice: 0,
    estimatedPrice: 0,
    lastPrice: 0,
    usualQty: 1,
    unit: 'ud',
    lastPurchaseAt: 0,
    purchaseFrequencyDays: 0,
    estimatedDurationDays: 0,
    notes: '',
    active: true,
    tags: [],
    vendorRows: [],
    recentHistory: [],
    sparklinePath: '',
  };
  const selectionTitle = selected ? selected.canonicalName : 'Nuevo producto';
  return `
    <section class="productsWorkbench__panel productsWorkbench__panel--editor" data-products-editor-panel>
      <header class="productsWorkbench__panelHead">
        <div>
          <h3>Editor de producto</h3>
          <p>${escapeHtml(selectionTitle)} · ${selected ? 'ficha conectada con historico real' : 'crea una referencia reusable para listas y tickets'}</p>
        </div>
        <div class="productsWorkbench__panelActions">
          <button type="button" class="food-history-btn" data-products-add-to-list="${escapeHtml(values.canonicalId || '')}" ${ticketQuickActionDisabled}>A lista</button>
          <button type="button" class="food-history-btn" data-food-item-detail="${escapeHtml(detailEntity?.id || values.canonicalId || '')}" ${detailActionDisabled}>Ficha completa</button>
        </div>
      </header>
      <div class="productsWorkbench__collapseBody">
      <form class="productsWorkbench__editorForm" data-products-editor-form>
        <input type="hidden" name="productId" value="${escapeHtml(values.canonicalId || '')}" />
        <label class="productsWorkbench__field">
          <span>ID</span>
          <input class="food-control" type="text" value="${escapeHtml(values.canonicalId || 'Se generara al guardar')}" readonly />
        </label>
        <label class="productsWorkbench__field">
          <span>Nombre</span>
          <input class="food-control" type="text" name="name" value="${escapeHtml(values.canonicalName || '')}" placeholder="Leche semidesnatada" required />
        </label>
        <label class="productsWorkbench__field">
          <span>Tipo</span>
          <input class="food-control" type="text" name="productType" value="${escapeHtml(values.productType || '')}" placeholder="Despensa" />
        </label>
        <label class="productsWorkbench__field">
          <span>Categoria</span>
          <input class="food-control" type="text" name="productCategory" value="${escapeHtml(values.productCategory || '')}" placeholder="Lacteos" />
        </label>
        <label class="productsWorkbench__field">
          <span>Supermercado habitual</span>
          <input class="food-control" type="text" name="preferredStore" value="${escapeHtml(values.preferredStore || '')}" placeholder="mercadona" />
        </label>
        <label class="productsWorkbench__field">
          <span>Marca</span>
          <input class="food-control" type="text" name="brand" value="${escapeHtml(values.brand || '')}" placeholder="Hacendado" />
        </label>
        <label class="productsWorkbench__field">
          <span>Formato / tamano</span>
          <input class="food-control" type="text" name="format" value="${escapeHtml(values.format || '')}" placeholder="1L brick" />
        </label>
        <label class="productsWorkbench__field">
          <span>Cantidad habitual</span>
          <input class="food-control" type="number" min="1" step="0.01" name="usualQty" value="${Number(values.usualQty || 1)}" />
        </label>
        <label class="productsWorkbench__field">
          <span>Unidad</span>
          <input class="food-control" type="text" name="unit" value="${escapeHtml(values.unit || 'ud')}" placeholder="ud, kg, l..." />
        </label>
        <label class="productsWorkbench__field">
          <span>Precio habitual</span>
          <input class="food-control" type="number" min="0" step="0.01" name="usualPrice" value="${Number(values.usualPrice || 0) || ''}" />
        </label>
        <label class="productsWorkbench__field">
          <span>Precio estimado</span>
          <input class="food-control" type="number" min="0" step="0.01" name="estimatedPrice" value="${Number(values.estimatedPrice || 0) || ''}" />
        </label>
        <label class="productsWorkbench__field">
          <span>Precio ultimo</span>
          <input class="food-control" type="number" min="0" step="0.01" name="lastPrice" value="${Number(values.lastPrice || 0) || ''}" />
        </label>
        <label class="productsWorkbench__field">
          <span>Ultima compra</span>
          <input class="food-control" type="date" name="lastPurchaseAt" value="${values.lastPurchaseAt ? escapeHtml(dayKeyFromTs(values.lastPurchaseAt)) : ''}" />
        </label>
        <label class="productsWorkbench__field">
          <span>Frecuencia</span>
          <input class="food-control" type="number" min="0" step="1" name="purchaseFrequencyDays" value="${Number(values.purchaseFrequencyDays || 0) || ''}" placeholder="dias" />
        </label>
        <label class="productsWorkbench__field">
          <span>Duracion estimada</span>
          <input class="food-control" type="number" min="0" step="1" name="estimatedDurationDays" value="${Number(values.estimatedDurationDays || 0) || ''}" placeholder="dias" />
        </label>
        <label class="productsWorkbench__field productsWorkbench__field--wide">
          <span>Etiquetas</span>
          <input class="food-control" type="text" name="tags" value="${escapeHtml((values.tags || []).join(', '))}" placeholder="desayuno, esencial, oferta" />
        </label>
        <label class="productsWorkbench__field productsWorkbench__field--wide">
          <span>Notas</span>
          <textarea class="food-control productsWorkbench__textarea" name="notes" placeholder="Formato ideal, marca preferida, rango de precio...">${escapeHtml(values.notes || '')}</textarea>
        </label>
        <label class="productsWorkbench__toggle productsWorkbench__toggle--inline">
          <input type="checkbox" name="active" ${values.active !== false ? 'checked' : ''} />
          <span>Producto activo</span>
        </label>
        <div class="productsWorkbench__editorActions">
          <button class="food-history-btn" type="submit">Guardar producto</button>
          <button type="button" class="food-history-btn" data-products-new-product>Limpiar editor</button>
        </div>
      </form>
      <div class="productsWorkbench__editorInsights">
        <div class="productsWorkbench__sparklineCard">
          <div>
            <strong>Evolucion de precio</strong>
            <small>${values.vendorRows?.length ? `${values.vendorRows.length} tiendas detectadas` : 'Sin serie suficiente'}</small>
          </div>
          <svg viewBox="0 0 100 28" preserveAspectRatio="none">
            ${values.sparklinePath ? `<path d="${values.sparklinePath}" />` : ''}
          </svg>
        </div>
        <div class="productsWorkbench__vendorList">
          ${(values.vendorRows || []).slice(0, 4).map((vendor) => `
            <div class="productsWorkbench__vendorRow">
              <span>${escapeHtml(vendor.vendorKey || 'unknown')}</span>
              <strong>${fmtCurrency(vendor.avgPrice || 0)}</strong>
              <small>${vendor.purchaseCount} compras · ultimo ${escapeHtml(formatProductsShortDate(vendor.lastTs))}</small>
            </div>
          `).join('') || '<div class="productsWorkbench__emptyMini">Sin comparativa por tienda todavia.</div>'}
        </div>
        <div class="productsWorkbench__historyList">
          ${(values.recentHistory || []).map((entry) => `
            <div class="productsWorkbench__historyRow">
              <span>${escapeHtml(formatProductsShortDate(entry.ts))}</span>
              <span>${escapeHtml(entry.vendorKey || 'unknown')}</span>
              <strong>${fmtCurrency(entry.totalPrice || 0)}</strong>
            </div>
          `).join('') || '<div class="productsWorkbench__emptyMini">Sin compras reales registradas.</div>'}
        </div>
      </div>
      </div>
    </section>
  `;
}

function renderProductsListPanel(model) {
  const activeList = model.activeList;
  return `
    <section class="productsWorkbench__panel productsWorkbench__panel--shopping" data-products-shopping-panel>
      <header class="productsWorkbench__panelHead">
        <div>
          <h3>Lista y ticket</h3>
          <p>Prevision, ticket editable y conversion directa a gasto real.</p>
        </div>
        <div class="productsWorkbench__panelActions">
          <button type="button" class="food-history-btn" data-products-save-list>Guardar lista</button>
          <button type="button" class="food-history-btn" data-products-clear-list ${model.allListLines.length ? '' : 'disabled'}>Vaciar</button>
        </div>
      </header>
      <form class="productsWorkbench__listForm" data-products-list-form data-products-list-id="${escapeHtml(activeList.id || '__draft__')}" data-products-active-ticket-id="${escapeHtml(model.activeTicketId || activeList.activeTicketId || activeList.primaryTicketId || 'ticket-1')}">
        <div class="productsWorkbench__lineList productsWorkbench__lineList--backing" aria-hidden="true">
          ${model.allListLines.map((line, index) => `
            <div class="productsWorkbench__lineRow ${line.checked === false ? 'is-unchecked' : 'is-checked'}" data-products-line-row="${escapeHtml(line.id)}">
              <input type="hidden" value="${escapeHtml(line.productId || '')}" data-products-line-product-id="${escapeHtml(line.id)}" />
              <input type="hidden" value="${escapeHtml(line.unit || 'ud')}" data-products-line-unit="${escapeHtml(line.id)}" />
              <input type="hidden" value="${escapeHtml(line.ticketId || activeList.primaryTicketId || 'ticket-1')}" data-products-line-ticket-id="${escapeHtml(line.id)}" />
              <label class="productsWorkbench__lineCheck" aria-label="Marcar ${escapeHtml(line.name || 'Producto')}">
                <input type="checkbox" data-products-line-checked="${escapeHtml(line.id)}" ${line.checked === false ? '' : 'checked'} />
              </label>
              <div class="productsWorkbench__lineMain">
                <strong>${escapeHtml(line.name || 'Producto')}</strong>
                <small>${escapeHtml(line.linkedProduct?.brand || line.store || line.linkedProduct?.preferredStore || 'Sin referencia')}</small>
              </div>
              <label class="productsWorkbench__lineField">
                <span>Cant.</span>
                <input class="food-control" type="number" min="1" step="0.01" value="${Number(line.qty || 1)}" data-products-line-qty="${escapeHtml(line.id)}" />
              </label>
              <label class="productsWorkbench__lineField">
                <span>Prev.</span>
                <input class="food-control" type="number" min="0" step="0.01" value="${Number(line.estimatedPrice || 0) || ''}" data-products-line-estimate="${escapeHtml(line.id)}" />
              </label>
              <label class="productsWorkbench__lineField">
                <span>Real</span>
                <input class="food-control" type="number" min="0" step="0.01" value="${Number(line.actualPrice || 0) || ''}" data-products-line-actual="${escapeHtml(line.id)}" />
              </label>
              <div class="productsWorkbench__lineTotals">
                <span data-products-line-est-total="${escapeHtml(line.id)}">${fmtCurrency(line.estimatedSubtotal || 0)}</span>
                <strong data-products-line-act-total="${escapeHtml(line.id)}">${fmtCurrency(line.actualSubtotal || 0)}</strong>
              </div>
              <button type="button" class="productsWorkbench__miniAction" data-products-remove-line="${escapeHtml(line.id)}" aria-label="Eliminar linea ${index + 1}">×</button>
            </div>
          `).join('')}
        </div>
      </form>
    </section>
  `;
}

function renderProductsTicketHero(model, options = {}) {
  const showSubviewSwitch = options.showSubviewSwitch !== false;
  const showRegistry = options.showRegistry !== false;
  const containerId = String(options.containerId || (options.embedded ? 'finance-ticket-preview' : 'seccion-ticket')).trim() || 'seccion-ticket';
  const ticketRows = Array.isArray(options.tickets) ? options.tickets : (Array.isArray(model.tickets) ? model.tickets : []);
  const emptyNotice = options.emptyNotice ? `<p class="productsWorkbench__receiptEmptyNotice">${escapeHtml(options.emptyNotice)}</p>` : '';
  const activeList = model.activeList;
  const selectedCount = Object.keys(state.foodProductsView?.receiptSelections?.[activeList.id] || {}).length;
  const plannedFor = model.activeTicket?.plannedFor || activeList.plannedFor || dayKeyFromTs(nowTs());
  const receiptEstimatedTotal = (model.listLines || []).reduce((sum, line) => sum + Number(line.estimatedSubtotal || 0), 0);
  const receiptActualTotal = (model.listLines || []).reduce((sum, line) => sum + Number(line.actualSubtotal || 0), 0);
  const diffMeta = resolveProductsReceiptDiffMeta(receiptActualTotal - receiptEstimatedTotal);
  return `
      <section class="productsWorkbench__ticketHero" data-products-ticket-hero>
      ${showSubviewSwitch ? renderProductsSubviewSwitch(model) : ''}

    <div id="${escapeHtml(containerId)}">
      <div class="productsWorkbench__ticketBar">
        <div class="productsWorkbench__ticketSwitches" aria-label="Tickets">
          ${ticketRows.map((ticket, index) => `
            <button type="button" class="food-history-btn ${ticket.id === model.activeTicketId ? 'is-active' : ''}" data-products-switch-ticket="${escapeHtml(ticket.id)}">
              ${escapeHtml(ticket.displayLabel || ticket.label || `Ticket ${index + 1}`)} · ${ticket.lineCount}
            </button>
          `).join('')}
        </div>

        <span class="productsWorkbench__ticketBarDivider" aria-hidden="true">|</span>
        <div class="productsWorkbench__panelActions productsWorkbench__panelActions--inlineReceipt productsWorkbench__panelActions--ticketCrud">
          <button type="button" class="food-history-btn" data-products-create-empty-ticket>Nuevo ticket</button>
          <button type="button" class="food-history-btn" data-products-delete-ticket="${escapeHtml(model.activeTicketId || '')}">Eliminar ticket</button>
        </div>
      </div>
      ${emptyNotice}
      <div class="productsWorkbench__receipt" data-products-receipt>
        <header>
          <div class="productsWorkbench__receiptMetaGroup">
            ${renderProductsStoreSelect(model)
              .replace('class="food-control"', 'class="food-control productsWorkbench__receiptMetaControl productsWorkbench__receiptMetaControl--store"')
              .replace('data-products-store-select', 'data-products-store-select data-products-receipt-store')}
          </div>
          <div class="productsWorkbench__panelActions productsWorkbench__panelActions--inlineReceipt productsWorkbench__panelActions--receiptHeader" ${selectedCount ? '' : 'hidden'} data-products-receipt-move-actions>
            <button type="button" class="food-history-btn" data-products-move-selected-ticket>Nuevo ticket (${selectedCount})</button>
          </div>
          <input class="food-control productsWorkbench__receiptMetaControl productsWorkbench__receiptMetaControl--date" type="date" name="plannedFor" value="${escapeHtml(plannedFor)}" data-products-receipt-date aria-label="Fecha del ticket" />
        </header>
        <div class="productsWorkbench__receiptLines">
          ${model.listLines.map((line) => renderProductsReceiptLineRow(line, model)).join('')}
          ${renderProductsReceiptEmptyRow(model)}
        </div>
        <footer>
          <div class="productsWorkbench__receiptDivider"></div>
          <div class="productsWorkbench__receiptTotalRow">
            <span>Total</span>
            <strong data-products-ticket-total-footer>${fmtCurrency(receiptActualTotal)}</strong>
          </div>
          <div class="productsWorkbench__receiptTotalRow productsWorkbench__receiptTotalRow--muted">
            <span>Previsto</span>
            <strong data-products-list-total>${fmtCurrency(receiptEstimatedTotal)}</strong>
          </div>
          <div class="productsWorkbench__receiptTotalRow productsWorkbench__receiptTotalRow--diff is-${diffMeta.tone}" data-products-ticket-diff-row>
            <span>Diferencia</span>
            <strong data-products-ticket-diff>${diffMeta.label}</strong>
          </div>
          ${renderProductsAccountSelect(model)}
        </footer>
      </div>
      <div class="productsWorkbench__panelActions productsWorkbench__panelActions--footer">
        <button type="button" class="food-history-btn" data-products-export-ticket ${model.listLines.length ? '' : 'disabled'}>Exportar</button>
        <button type="button" class="food-history-btn" data-products-confirm-ticket ${model.listLines.length ? '' : 'disabled'}>Confirmar compra</button>
      </div>

      </div>
      ${showRegistry ? renderProductsTicketRegistry(model) : ''}
      </section>
  `;
}

function renderProductsTicketRegistry(model) {
  const groupedTickets = model.recentTickets.reduce((acc, ticket) => {
    const ticketDateTs = Number(ticket.confirmedAt || 0) || parseDayKey(ticket.dateISO || '');
    const dayKey = dayKeyFromTs(ticketDateTs || nowTs());
    if (!acc[dayKey]) acc[dayKey] = [];
    acc[dayKey].push({ ...ticket, _ticketDateTs: ticketDateTs });
    return acc;
  }, {});
  const groupedRows = Object.entries(groupedTickets)
    .sort(([dayA], [dayB]) => parseDayKey(dayB) - parseDayKey(dayA))
    .map(([dayKey, tickets]) => {
      const dayLabel = formatProductsShortDate(parseDayKey(dayKey));
      const ticketRows = tickets
        .slice()
        .sort((a, b) => Number(b._ticketDateTs || 0) - Number(a._ticketDateTs || 0))
        .map((ticket) => {
          const accountNameValue = ticket.accountId
            ? (state.accounts.find((account) => account.id === ticket.accountId)?.name || ticket.accountId)
            : 'Sin cuenta';
          const ticketDate = formatProductsShortDate(ticket._ticketDateTs || parseDayKey(ticket.dateISO || ''));
          const ticketStatus = ticket.txId ? 'Contabilizado' : 'Sin asiento';
          const ticketBlockedDeletion = Boolean(String(ticket.txId || '').trim());
          const ticketDeleteHint = ticketBlockedDeletion
            ? 'No se puede borrar: tiene movimiento contabilizado'
            : 'Eliminar ticket del registro';
          const imageUrl = String(ticket.imageUrl || ticket.receiptImageUrl || ticket.image || '').trim();
          return `
            <details class="productsWorkbench__ticketRegistryItem" data-products-ticket-history-item="${escapeHtml(ticket.id)}">
              <summary>
                <span>${escapeHtml(ticketDate)} · ${escapeHtml(ticket.store || 'Supermercado')} · ${fmtCurrency(ticket.actualTotal || 0)}</span>
                <small>${ticket.lineCount} líneas · ${escapeHtml(ticketStatus)}</small>
              </summary>
              <div class="productsWorkbench__ticketRegistryDetail">
                <div class="productsWorkbench__ticketRegistryMeta">
                  <span>${escapeHtml(accountNameValue)}</span>
                  <span>${escapeHtml(ticket.paymentMethod || 'Tarjeta')}</span>
                  ${ticket.note ? `<span>${escapeHtml(ticket.note)}</span>` : ''}
                </div>
                ${imageUrl ? `<img src="${escapeHtml(imageUrl)}" alt="Imagen de ticket ${escapeHtml(ticket.store || ticket.id)}" loading="lazy" />` : ''}
                <div class="productsWorkbench__ticketRegistryLines">
                  ${Object.values(ticket.lines || {}).map((line) => `
                    <div class="productsWorkbench__ticketRegistryLine">
                      <span>${Math.max(0.01, Number(line.qty || 1))} × ${escapeHtml(line.name || 'Producto')}</span>
                      <strong>${fmtCurrency(Math.max(0.01, Number(line.qty || 1)) * Number(line.actualPrice || line.estimatedPrice || 0))}</strong>
                    </div>
                  `).join('') || '<div class="productsWorkbench__emptyMini">Ticket sin líneas.</div>'}
                </div>
                <div class="productsWorkbench__ticketTotals">
                  <small>Previsto ${fmtCurrency(ticket.estimatedTotal || 0)}</small>
                  <strong>${fmtCurrency(ticket.actualTotal || 0)}</strong>
                </div>
                <div class="productsWorkbench__ticketRegistryActions">
                  <button type="button" class="food-history-btn" data-products-reuse-ticket="${escapeHtml(ticket.id)}">Reutilizar como lista</button>
                  <button
                    type="button"
                    class="food-history-btn"
                    data-products-delete-history-ticket="${escapeHtml(ticket.id)}"
                    aria-label="${escapeHtml(ticketDeleteHint)}"
                    title="${escapeHtml(ticketDeleteHint)}"
                    ${ticketBlockedDeletion ? 'disabled' : ''}
                  >Eliminar</button>
                </div>
              </div>
            </details>
          `;
        })
        .join('');
      return `
        <section class="productsWorkbench__ticketRegistryGroup" data-products-ticket-group="${escapeHtml(dayKey)}">
          <h4>${escapeHtml(dayLabel)}</h4>
          ${ticketRows}
        </section>
      `;
    })
    .join('');
  return `
    <details class="productsWorkbench__ticketRegistry" data-products-ticket-registry>
      <summary>
        <span>Registro de tickets</span>
        <small>${model.recentTickets.length} guardados</small>
      </summary>
      <div class="productsWorkbench__ticketRegistryList">
        ${groupedRows || '<div class="productsWorkbench__empty">Todavía no hay tickets confirmados desde esta vista.</div>'}
      </div>
    </details>
  `;
}

function renderFinanceTicketPreview() {
  const model = buildCurrentProductsModel();
  const orderedTickets = [...(model.tickets || [])].sort((a, b) => (
    Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0)
  ) || (
    Number(a.sortOrder || 0) - Number(b.sortOrder || 0)
  ));
  const emptyNotice = !model.listLines.length ? 'Sin tickets pendientes' : '';
  return `<article class="finance__calendarPreview finance__calendarPreview--tickets">
    <div class="financePanelTopbar">
      <div class="financePanelHeading"><h2>Tickets</h2></div>
      ${renderFinanceHomePanelToggle('tickets')}
    </div>
    <div class="financeTicketPreview">
      <div class="financeProductsView productsWorkbench productsWorkbench--homePreview" data-products-workbench data-products-home-preview="true" data-products-active-tab="list">
        ${renderProductsTicketHero({ ...model, tickets: orderedTickets }, {
          embedded: true,
          containerId: 'finance-ticket-preview',
          showSubviewSwitch: false,
          showRegistry: true,
          tickets: orderedTickets,
          emptyNotice,
        })}
        <div class="productsWorkbench__homeBacking" hidden>
          ${renderProductsListPanel(model)}
        </div>
        <div class="productsWorkbench__subview" data-products-subview="catalog" hidden></div>
      </div>
    </div>
  </article>`;
}

function renderProductsHistoryPanel(model) {
  return `
    <section class="productsWorkbench__footerGrid">
      <section class="productsWorkbench__panel">
        <header class="productsWorkbench__panelHead">
          <div>
            <h3>Prevision y recompra</h3>
            <p>Sugerencias construidas con frecuencia observada, precio actual y objetivo mensual.</p>
          </div>
        </header>
        <div class="productsWorkbench__forecastStrip">
          <article>
            <span>Ritmo proyectado</span>
            <strong>${fmtCurrency(model.projectedMonthSpend || 0)}</strong>
            <small>${model.monthlyTarget > 0 ? `vs objetivo ${fmtCurrency(model.monthlyTarget)}` : 'Sin techo mensual definido'}</small>
          </article>
          <article>
            <span>Margen restante</span>
            <strong>${fmtCurrency(model.budgetRemaining || 0)}</strong>
            <small>${model.monthlyTarget > 0 ? 'Antes de sugerencias' : 'Configura objetivo para medir desvio'}</small>
          </article>
          <article>
            <span>Si compras lo urgente</span>
            <strong>${fmtCurrency(model.budgetAfterSuggestions || 0)}</strong>
            <small>${fmtCurrency(model.dueSuggestedSpend || 0)} comprometidos</small>
          </article>
        </div>
        <div class="productsWorkbench__forecastList">
          ${model.dueSuggestions.map((row) => `
            <article class="productsWorkbench__forecastRow is-${escapeHtml(row.dueTone)}">
              <div>
                <strong>${escapeHtml(row.canonicalName)}</strong>
                <small>${escapeHtml(row.productType || row.productCategory || 'Sin clasificar')} · ${escapeHtml(row.preferredStore || row.bestStoreKey || 'Sin tienda')}</small>
              </div>
              <div>
                <span>${escapeHtml(row.dueLabel)}</span>
                <strong>${fmtCurrency(row.predictedLineCost || 0)}</strong>
              </div>
            </article>
          `).join('') || '<div class="productsWorkbench__empty">No hay productos con reposicion urgente.</div>'}
        </div>
      </section>
      ${model.reusableLists.length ? `
        <section class="productsWorkbench__panel">
          <header class="productsWorkbench__panelHead">
            <div>
              <h3>Listas reutilizables</h3>
              <p>Acceso rápido para rearmar una compra sin rehacer el ticket.</p>
            </div>
          </header>
          <div class="productsWorkbench__reuseLists">
            ${model.reusableLists.map((list) => `
              <button type="button" class="productsWorkbench__reuseListBtn" data-products-reuse-list="${escapeHtml(list.id)}">
                <span>${escapeHtml(list.name || 'Lista')}</span>
                <small>${Object.keys(list.lines || {}).length} items · ${escapeHtml(list.store || 'Sin tienda')}</small>
              </button>
            `).join('')}
          </div>
        </section>
      ` : ''}
    </section>
  `;
}

function renderProductsCatalogWorkspace(model) {
  const isCollapsed = model.cfg?.catalogCollapsed !== false;
  const activePanel = model.cfg?.catalogPanel || 'catalog';
  return `
    <details class="productsWorkbench__catalogWorkspace" data-products-catalog-workspace ${isCollapsed ? '' : 'open'}>
      <summary>
        <strong>Catálogo operativo</strong>
        <small>${model.filteredCount}/${model.catalogCount} productos</small>
      </summary>
      <div class="productsWorkbench__catalogTabs" role="tablist" aria-label="Paneles del catálogo">
        ${[
          ['catalog', 'Catálogo'],
          ['editor', 'Editor'],
          ['insights', 'Análisis'],
        ].map(([key, label]) => `
          <button type="button" class="food-history-btn ${activePanel === key ? 'is-active' : ''}" data-products-catalog-panel-tab="${key}" role="tab" aria-selected="${activePanel === key ? 'true' : 'false'}">${label}</button>
        `).join('')}
      </div>
      <div class="productsWorkbench__catalogSlides" data-products-catalog-slides>
        <section class="productsWorkbench__catalogSlide ${activePanel === 'catalog' ? 'is-active' : ''}" data-products-catalog-panel-view="catalog">
          ${renderProductsCatalogPanel(model)}
        </section>
        <section class="productsWorkbench__catalogSlide ${activePanel === 'editor' ? 'is-active' : ''}" data-products-catalog-panel-view="editor">
          ${renderProductsEditorPanel(model)}
        </section>
        <section class="productsWorkbench__catalogSlide ${activePanel === 'insights' ? 'is-active' : ''}" data-products-catalog-panel-view="insights">
          ${renderProductsHistoryPanel(model)}
        </section>
      </div>
    </details>
  `;
}

function renderProductsCatalogSubview(model) {
  return `
    <div class="productsWorkbench__catalogSubview" data-products-catalog-subview>
      ${renderProductsSummaryCards(model)}
      ${renderProductsFilters(model)}
      ${renderProductsCatalogWorkspace(model)}
    </div>
  `;
}

function renderProductsView(isModal = false) {
  const model = buildProductsViewModel(state.foodProductsView || {});
  const activeTab = model.cfg.tab === 'catalog' ? 'catalog' : 'list';
  const content = `
    <div class="financeProductsView productsWorkbench" data-products-workbench data-products-active-tab="${escapeHtml(activeTab)}">
      ${renderProductsTicketHero(model)}
      <div class="productsWorkbench__subview" data-products-subview="list" ${activeTab === 'list' ? '' : 'hidden'}>
      ${renderProductsListPanel(model)}
      </div>
      <div class="productsWorkbench__subview" data-products-subview="catalog" ${activeTab === 'catalog' ? '' : 'hidden'}>
      ${renderProductsCatalogSubview(model)}
      </div>
    </div>
  `;
  if (isModal) {
    return `<div id="finance-modal" class="finance-modal food-sheet-modal productsWorkbenchModal" role="dialog" aria-modal="true" tabindex="-1"><header class="food-sheet-header"><h3>Centro de productos</h3><button class=" btn-x food-sheet-close" data-close-modal aria-label="Cerrar">✕</button></header>${content}</div>`;
  }
  return `<section class="financeBalanceView financeBalanceView--products">${content}</section>`;
}

function renderFoodProductsModal() {
  return renderProductsView(true);
}

function renderFinanceProducts() {
  return renderProductsView(false);
}

function applyProductsSearchFilter(inputEl) {
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    productsQuery: String(inputEl?.value || ''),
  };
  applyProductsCatalogGlobalSearch(inputEl);
}

function applyProductsFiltersDirectDom() {
  patchProductsCatalogSubview();
}

function createProductsNode(html = '') {
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  return template.content.firstElementChild || document.createElement('div');
}

function getProductsWorkbenchRoot(root = document) {
  return root?.querySelector?.('[data-products-workbench]') || document.querySelector('[data-products-workbench]');
}

function buildCurrentProductsModel() {
  return buildProductsViewModel(state.foodProductsView || {});
}

function captureProductsCatalogOpenState(root = null) {
  const host = root || getProductsWorkbenchRoot();
  const workspace = host?.querySelector?.('[data-products-catalog-workspace]');
  const groupOpenState = {};
  host?.querySelectorAll?.('[data-products-catalog-group]').forEach((groupEl) => {
    const key = String(groupEl?.dataset?.productsCatalogGroup || '').trim();
    if (key) groupOpenState[key] = !!groupEl.open;
  });
  return {
    catalogCollapsed: workspace ? !workspace.open : undefined,
    catalogGroupsOpen: groupOpenState,
  };
}

function mergeProductsCatalogOpenState(snapshot = {}) {
  const nextView = { ...(state.foodProductsView || {}) };
  if (typeof snapshot.catalogCollapsed === 'boolean') {
    nextView.catalogCollapsed = snapshot.catalogCollapsed;
  }
  if (snapshot.catalogGroupsOpen && typeof snapshot.catalogGroupsOpen === 'object') {
    nextView.catalogGroupsOpen = {
      ...((state.foodProductsView?.catalogGroupsOpen && typeof state.foodProductsView.catalogGroupsOpen === 'object')
        ? state.foodProductsView.catalogGroupsOpen
        : {}),
      ...snapshot.catalogGroupsOpen,
    };
  }
  state.foodProductsView = nextView;
  return nextView;
}

function patchProductsShoppingPanel(model = null) {
  const root = getProductsWorkbenchRoot();
  const current = root?.querySelector?.('[data-products-shopping-panel]');
  if (!current) return false;
  const nextModel = model || buildCurrentProductsModel();
  patchProductsTicketHero(nextModel);
  const next = createProductsNode(renderProductsListPanel(nextModel));
  current.replaceWith(next);
  const quickSearch = next.querySelector('[data-products-quick-search]');
  if (quickSearch) applyProductsQuickSearch(quickSearch);
  return true;
}

function patchProductsEditorPanel(model = null) {
  const root = getProductsWorkbenchRoot();
  const current = root?.querySelector?.('[data-products-editor-panel]');
  if (!current) return false;
  const nextModel = model || buildCurrentProductsModel();
  current.replaceWith(createProductsNode(renderProductsEditorPanel(nextModel)));
  updateProductsCatalogSelectedDom(nextModel.selectedProductId);
  return true;
}

function patchProductsTicketHero(model = null) {
  const root = getProductsWorkbenchRoot();
  const current = root?.querySelector?.('[data-products-ticket-hero]');
  if (!current) return false;
  const nextModel = model || buildCurrentProductsModel();
  current.replaceWith(createProductsNode(renderProductsTicketHero(nextModel)));
  return true;
}

function patchProductsCatalogSubview(model = null) {
  const root = getProductsWorkbenchRoot();
  const subview = root?.querySelector?.('[data-products-subview="catalog"]');
  if (!subview) {
    triggerRender();
    return false;
  }
  const openState = captureProductsCatalogOpenState(root);
  const nextView = mergeProductsCatalogOpenState(openState);
  const nextModel = buildProductsViewModel({
    ...((model?.cfg && typeof model.cfg === 'object') ? model.cfg : {}),
    ...(nextView || {}),
  });
  subview.innerHTML = renderProductsCatalogSubview(nextModel);
  return true;
}

function patchProductsWorkbench(model = null) {
  const root = getProductsWorkbenchRoot();
  if (!root) return false;
  const nextModel = model || buildCurrentProductsModel();
  const switchEl = root.querySelector('.productsWorkbench__viewSwitch');
  if (switchEl) switchEl.replaceWith(createProductsNode(renderProductsSubviewSwitch(nextModel)));
  patchProductsShoppingPanel(nextModel);
  patchProductsCatalogSubview(nextModel);
  switchProductsSubview(nextModel.cfg.tab);
  return true;
}

function switchProductsSubview(tab = 'list') {
  const nextTab = tab === 'catalog' ? 'catalog' : 'list';
  state.foodProductsView = { ...(state.foodProductsView || {}), tab: nextTab };
  const root = getProductsWorkbenchRoot();
  if (!root) {
    triggerRender();
    return;
  }
  root.dataset.productsActiveTab = nextTab;
  root.querySelectorAll('[data-products-tab]').forEach((button) => {
    const active = button.dataset.productsTab === nextTab;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  });
  root.querySelectorAll('[data-products-subview]').forEach((subview) => {
    subview.hidden = subview.dataset.productsSubview !== nextTab;
  });
}

function applyProductsQuickSearch(inputEl) {
  const root = inputEl?.closest?.('[data-products-quick-picker]');
  if (!root) return;
  const query = String(inputEl.value || '');
  state.foodProductsView = { ...(state.foodProductsView || {}), listQuery: query };
  const queryKey = normalizeProductItemKey(query);
  const rows = Array.from(root.querySelectorAll('[data-products-quick-row]'));
  let visibleCount = 0;
  rows.forEach((row) => {
    const matches = !queryKey || String(row.dataset.productsSearch || '').includes(queryKey);
    row.hidden = !matches;
    if (matches) visibleCount += 1;
  });
  const count = root.querySelector('[data-products-quick-count]');
  if (count) count.textContent = String(visibleCount);
  const empty = root.querySelector('.productsWorkbench__quickEmpty');
  if (empty) empty.hidden = visibleCount > 0;
}

function updateProductsQuickSearch(inputEl) {
  if (!inputEl) return;
  const query = String(inputEl.value || '');
  state.foodProductsView = { ...(state.foodProductsView || {}), listQuery: query };
  const selectionStart = inputEl.selectionStart ?? query.length;
  const selectionEnd = inputEl.selectionEnd ?? query.length;
  syncProductsDraftListLocal(readProductsListDraftFromDom());
  patchProductsShoppingPanel(buildCurrentProductsModel());
  const nextInput = document.querySelector('[data-products-quick-search]');
  if (nextInput) {
    nextInput.focus();
    try {
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    } catch (_) {}
  }
}

function applyProductsCatalogGlobalSearch(inputEl) {
  const query = String(inputEl?.value || '');
  state.foodProductsView = { ...(state.foodProductsView || {}), productsQuery: query };
  const selectionStart = inputEl?.selectionStart ?? query.length;
  const selectionEnd = inputEl?.selectionEnd ?? query.length;
  patchProductsCatalogSubview(buildCurrentProductsModel());
  const nextInput = document.querySelector('[data-products-filter="productsQuery"]');
  if (nextInput) {
    nextInput.focus();
    try {
      nextInput.setSelectionRange(selectionStart, selectionEnd);
    } catch (_) {}
  }
}

function updateProductsCatalogSelectedDom(productId = '') {
  const root = getProductsWorkbenchRoot();
  if (!root) return;
  const safeId = String(productId || '').trim();
  root.querySelectorAll('[data-products-catalog-card]').forEach((card) => {
    card.classList.toggle('is-selected', String(card.dataset.productsId || '') === safeId);
  });
}

function selectProductsCatalogProduct(productId = '', options = {}) {
  const safeId = String(productId || '').trim();
  if (!safeId) return;
  const switchToEditor = options?.switchToEditor !== false;
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    tab: 'catalog',
    selectedProductId: safeId,
    ...(switchToEditor ? { catalogPanel: 'editor' } : {}),
  };
  patchProductsCatalogSubview(buildCurrentProductsModel());
}

function syncProductsBulkBarDom() {
  const root = getProductsWorkbenchRoot();
  if (!root) return;
  const selectedIds = Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : [];
  const selectedSet = new Set(selectedIds);
  root.querySelectorAll('[data-products-toggle-select]').forEach((input) => {
    input.checked = selectedSet.has(String(input.dataset.productsToggleSelect || '').trim());
    input.closest('[data-products-catalog-card]')?.classList.toggle('is-multi-selected', input.checked);
  });
  root.querySelectorAll('[data-products-selected-count]').forEach((node) => {
    node.textContent = `${selectedIds.length} seleccionados`;
  });
  root.querySelectorAll('[data-products-add-selected-list], [data-products-batch-active], [data-products-clear-selection]').forEach((button) => {
    button.disabled = selectedIds.length === 0;
  });
  root.querySelectorAll('[data-products-batch-toolbar]').forEach((formEl) => {
    formEl.hidden = selectedIds.length === 0;
  });
  root.querySelectorAll('[data-food-merge-open]').forEach((button) => {
    button.dataset.foodMergeOpen = selectedIds[0] || '';
    button.disabled = selectedIds.length < 2;
  });
}

function setProductsSelectedIds(ids = []) {
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    selectedIds: [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))],
  };
  if (!patchProductsCatalogSubview(buildCurrentProductsModel())) {
    syncProductsBulkBarDom();
  }
}

function clearProductsSelection() {
  setProductsSelectedIds([]);
}

function toggleProductsSelection(productId = '', checked = null) {
  const safeId = String(productId || '').trim();
  if (!safeId) return;
  const selected = new Set(Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : []);
  const shouldSelect = checked == null ? !selected.has(safeId) : Boolean(checked);
  if (shouldSelect) selected.add(safeId);
  else selected.delete(safeId);
  setProductsSelectedIds([...selected]);
}

async function removeProductsCatalogItems(productIds = [], options = {}) {
  const ids = [...new Set((Array.isArray(productIds) ? productIds : [productIds]).map((id) => String(id || '').trim()).filter(Boolean))];
  if (!ids.length) return { removed: 0, labels: [] };
  state.foodCatalog.ignored = state.foodCatalog.ignored && typeof state.foodCatalog.ignored === 'object' ? state.foodCatalog.ignored : {};
  const now = nowTs();
  const updatesMap = {};
  const labels = [];
  const backings = [];
  ids.forEach((safeId) => {
    const snapshot = resolveProductsCatalogSnapshot(safeId);
    const backingItem = state.food.itemsById?.[safeId] || resolveFoodItemByAnyKey(safeId) || null;
    updatesMap[`${state.financePath}/foodCatalog/ignored/${safeId}`] = true;
    if (backingItem?.id) {
      updatesMap[`${state.financePath}/foodItems/${backingItem.id}/active`] = false;
      updatesMap[`${state.financePath}/foodItems/${backingItem.id}/updatedAt`] = now;
    }
    backings.push({ safeId, backingId: backingItem?.id || '' });
    labels.push(snapshot?.canonicalName || backingItem?.displayName || backingItem?.name || safeId);
  });
  await safeFirebase(() => update(ref(db), updatesMap));
  backings.forEach(({ safeId, backingId }) => {
    state.foodCatalog.ignored[safeId] = true;
    if (backingId && state.food.itemsById?.[backingId]) {
      state.food.itemsById[backingId] = {
        ...state.food.itemsById[backingId],
        active: false,
        updatedAt: now,
      };
    }
  });
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    selectedIds: (Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : []).filter((id) => !ids.includes(String(id || '').trim())),
    selectedProductId: ids.includes(String(state.foodProductsView?.selectedProductId || '').trim()) ? '' : String(state.foodProductsView?.selectedProductId || '').trim(),
  };
  clearFinanceDerivedCaches();
  const nextModel = buildCurrentProductsModel();
  patchProductsCatalogSubview(nextModel);
  patchProductsShoppingPanel(nextModel);
  if (!options.silent) {
    toast(ids.length === 1 ? `Producto eliminado del catalogo: ${labels[0]}` : `${ids.length} productos eliminados del catalogo`);
  }
  return { removed: ids.length, labels };
}

async function removeProductsCatalogItem(productId = '', options = {}) {
  const result = await removeProductsCatalogItems([productId], options);
  return result.removed > 0;
}

function selectVisibleProductsFromDom() {
  const root = getProductsWorkbenchRoot();
  const current = new Set(Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : []);
  root?.querySelectorAll?.('[data-products-catalog-card]:not([hidden])')?.forEach((card) => {
    const id = String(card.dataset.productsId || '').trim();
    if (id) current.add(id);
  });
  setProductsSelectedIds([...current]);
}

function toggleProductsCardExpanded(productId = '') {
  const safeId = String(productId || '').trim();
  if (!safeId) return;
  const expanded = new Set(Array.isArray(state.foodProductsView?.expandedIds) ? state.foodProductsView.expandedIds : []);
  const isOpen = !expanded.has(safeId);
  if (isOpen) expanded.add(safeId);
  else expanded.delete(safeId);
  state.foodProductsView = { ...(state.foodProductsView || {}), expandedIds: [...expanded] };
  const card = document.getElementById(productsWorkbenchDomId('product-card', safeId));
  if (!card) return;
  card.classList.toggle('is-expanded', isOpen);
  const drawer = card.querySelector('.productsWorkbench__productDrawer');
  if (drawer) drawer.hidden = !isOpen;
  const button = card.querySelector('[data-products-expand-product]');
  if (button) {
    button.textContent = isOpen ? 'Ocultar' : 'Detalles';
    button.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
}

function syncQuickLineQtyToList(inputEl) {
  const lineId = String(inputEl?.dataset?.productsQuickLineQty || '').trim();
  if (!lineId) return;
  const listInput = document.querySelector(`[data-products-line-qty="${lineId}"]`);
  if (listInput) listInput.value = inputEl.value;
  syncProductsTicketComposerDom(document);
  syncProductsDraftListLocal(readProductsListDraftFromDom(document));
}

function adjustProductsLineQtyFromDom(lineId = '', delta = 0) {
  const safeId = String(lineId || '').trim();
  if (!safeId) return;
  const listInput = document.querySelector(`[data-products-line-qty="${safeId}"]`);
  const receiptInput = document.querySelector(`[data-products-receipt-qty="${safeId}"]`);
  const quickInput = document.querySelector(`[data-products-quick-line-qty="${safeId}"]`);
  const current = Number(receiptInput?.value || listInput?.value || quickInput?.value || 1);
  const next = Math.max(1, current + Number(delta || 0));
  if (listInput) listInput.value = String(next);
  if (receiptInput) receiptInput.value = String(next);
  if (quickInput) quickInput.value = String(next);
  syncProductsTicketComposerDom(document);
  syncProductsDraftListLocal(readProductsListDraftFromDom(document));
}

function getReceiptSelectionMap(listId = '') {
  const safeListId = String(listId || resolveActiveProductsList().id || '__draft__').trim() || '__draft__';
  return state.foodProductsView?.receiptSelections?.[safeListId] || {};
}

function setReceiptSelectionMap(listId = '', nextMap = {}) {
  const safeListId = String(listId || resolveActiveProductsList().id || '__draft__').trim() || '__draft__';
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    receiptSelections: {
      ...(state.foodProductsView?.receiptSelections || {}),
      [safeListId]: { ...(nextMap || {}) },
    },
  };
}

function toggleReceiptLineSelection(lineId = '', checked = null) {
  const safeLineId = String(lineId || '').trim();
  if (!safeLineId) return;
  const listId = String(resolveActiveProductsList().id || '__draft__');
  const next = { ...getReceiptSelectionMap(listId) };
  const nextChecked = checked == null ? !next[safeLineId] : !!checked;
  if (nextChecked) next[safeLineId] = true;
  else delete next[safeLineId];
  setReceiptSelectionMap(listId, next);
  const row = document.querySelector(`[data-products-receipt-row="${safeLineId}"]`);
  if (row) row.classList.toggle('is-selected', nextChecked);
  syncProductsTicketComposerDom(document);
}

async function switchProductsActiveTicket(ticketId = '') {
  const safeTicketId = String(ticketId || '').trim();
  if (!safeTicketId) return;
  const draft = ensureProductsListTickets(readProductsListDraftFromDom(document));
  if (!draft.tickets?.[safeTicketId]) return;
  draft.activeTicketId = safeTicketId;
  syncProductsDraftListLocal(draft);
  triggerRender();
}

async function moveSelectedReceiptLinesToNewTicket() {
  const draft = ensureProductsListTickets(readProductsListDraftFromDom(document));
  const listId = String(draft.id || '__draft__');
  const selectedIds = Object.keys(getReceiptSelectionMap(listId) || {}).filter((lineId) => draft.lines?.[lineId]);
  if (!selectedIds.length) return;
  const nextTicketId = createFinanceRecordId('ticketlist');
  const baseTicket = draft.tickets?.[draft.activeTicketId] || draft.tickets?.[draft.primaryTicketId] || {};
  const nextTicketIndex = Object.keys(draft.tickets || {}).length + 1;
  draft.tickets[nextTicketId] = normalizeProductsListTicketMeta(nextTicketId, {
    ...baseTicket,
    label: buildNextTicketLabel(draft),
    sortOrder: nextTicketIndex - 1,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  });
  selectedIds.forEach((lineId) => {
    if (!draft.lines[lineId]) return;
    draft.lines[lineId] = { ...(draft.lines[lineId] || {}), ticketId: nextTicketId, updatedAt: nowTs() };
    const ticketField = document.querySelector(`[data-products-line-ticket-id="${lineId}"]`);
    if (ticketField) ticketField.value = nextTicketId;
  });
  draft.activeTicketId = nextTicketId;
  syncProductsDraftListLocal(draft);
  setReceiptSelectionMap(listId, {});
  toast(selectedIds.length > 1 ? 'Lineas movidas a un nuevo ticket' : 'Linea movida a un nuevo ticket');
  triggerRender();
}

async function createEmptyProductsTicket() {
  const draft = ensureProductsListTickets(readProductsListDraftFromDom(document));
  const nextTicketId = createFinanceRecordId('ticketlist');
  const baseTicket = draft.tickets?.[draft.activeTicketId] || draft.tickets?.[draft.primaryTicketId] || {};
  const nextSortOrder = Object.keys(draft.tickets || {}).length;
  draft.tickets[nextTicketId] = normalizeProductsListTicketMeta(nextTicketId, {
    ...baseTicket,
    label: buildNextTicketLabel(draft),
    sortOrder: nextSortOrder,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  });
  draft.activeTicketId = nextTicketId;
  draft.updatedAt = nowTs();
  syncProductsDraftListLocal(draft);
  toast('Ticket vacío creado');
  triggerRender();
}

async function deleteProductsTicket(ticketId = '') {
  const safeTicketId = String(ticketId || '').trim();
  if (!safeTicketId) return;
  const draft = ensureProductsListTickets(readProductsListDraftFromDom(document));
  if (!draft.tickets?.[safeTicketId]) return;
  const ticketIds = Object.keys(draft.tickets || {});
  const lineIds = Object.entries(draft.lines || {})
    .filter(([, line]) => String(line?.ticketId || '').trim() === safeTicketId)
    .map(([lineId]) => lineId);
  const hasLines = lineIds.length > 0;
  const draftTicketDisplayLabels = buildProductsTicketDisplayLabelMap(
    Object.entries(draft.tickets || {}).map(([id, meta]) => ({ ...(meta || {}), id })),
    'Sin asignar',
  );
  const confirmMessage = hasLines
    ? `Este ticket tiene ${lineIds.length} ${lineIds.length === 1 ? 'línea' : 'líneas'}. Se moverán a "${draftTicketDisplayLabels[draft.primaryTicketId] || 'Sin asignar'}". ¿Eliminar ticket?`
    : '¿Eliminar ticket vacío?';
  if (!window.confirm(confirmMessage)) return;
  if (hasLines && ticketIds.length > 1) {
    const fallbackTicketId = draft.primaryTicketId && draft.primaryTicketId !== safeTicketId
      ? draft.primaryTicketId
      : ticketIds.find((id) => id !== safeTicketId) || draft.primaryTicketId;
    lineIds.forEach((lineId) => {
      draft.lines[lineId] = {
        ...(draft.lines[lineId] || {}),
        ticketId: fallbackTicketId,
        updatedAt: nowTs(),
      };
    });
  }
  delete draft.tickets[safeTicketId];
  if (ticketIds.length <= 1) {
    draft.lines = {};
  }
  const nextTicketIds = Object.keys(draft.tickets || {});
  if (!nextTicketIds.length) {
    const replacementId = 'ticket-1';
    draft.primaryTicketId = replacementId;
    draft.activeTicketId = replacementId;
    draft.tickets[replacementId] = normalizeProductsListTicketMeta(replacementId, {
      label: 'Sin asignar',
      store: draft.store,
      accountId: draft.accountId,
      paymentMethod: draft.paymentMethod,
      plannedFor: draft.plannedFor,
      notes: draft.notes,
      sortOrder: 0,
      createdAt: nowTs(),
      updatedAt: nowTs(),
    });
  } else {
    if (!nextTicketIds.includes(draft.primaryTicketId)) draft.primaryTicketId = nextTicketIds[0] || 'ticket-1';
    if (!nextTicketIds.includes(draft.activeTicketId)) draft.activeTicketId = nextTicketIds[0] || draft.primaryTicketId;
  }
  draft.updatedAt = nowTs();
  const normalizedDraft = ensureProductsListTickets(draft);
  if (normalizedDraft.id === '__draft__') {
    syncProductsDraftListLocal(normalizedDraft);
  } else {
    await persistProductsListRecord(normalizedDraft, { activate: true });
  }
  const listId = String(normalizedDraft.id || '__draft__');
  const selection = { ...getReceiptSelectionMap(listId) };
  lineIds.forEach((lineId) => { delete selection[lineId]; });
  setReceiptSelectionMap(listId, selection);
  toast('Ticket eliminado');
  triggerRender();
}

async function exportActiveProductsTicketNamesFromDom() {
  const draft = ensureProductsListTickets(readProductsListDraftFromDom(document));
  const activeTicketId = String(draft.activeTicketId || draft.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  const ticketLines = Object.values(draft.lines || {})
    .filter((line) => String(line?.ticketId || draft.primaryTicketId || '').trim() === activeTicketId)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0));
  const names = ticketLines
    .map((line) => normalizeFoodName(line?.name || ''))
    .filter((name) => !!String(name || '').trim());
  if (!names.length) {
    toast('El ticket activo no tiene productos para exportar');
    return;
  }
  const exportText = names.join('\n');
  if (navigator.share) {
    try {
      await navigator.share({
        title: 'Lista de ticket',
        text: exportText,
      });
      toast('Lista compartida');
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(exportText);
      toast('Lista copiada al portapapeles');
      return;
    }
  } catch (error) {
    // fallback below
  }
  window.prompt('Copia la lista del ticket:', exportText);
}

async function deleteProductsHistoryTicket(ticketId = '') {
  const safeTicketId = String(ticketId || '').trim();
  if (!safeTicketId) return;
  const ticket = state.productsHub?.tickets?.[safeTicketId];
  if (!ticket) return;
  if (String(ticket.txId || '').trim()) {
    toast('No se puede borrar un ticket ya contabilizado');
    return;
  }
  if (!window.confirm('¿Eliminar este ticket del registro?')) return;
  const nextTickets = { ...(state.productsHub?.tickets || {}) };
  delete nextTickets[safeTicketId];
  const nextLists = Object.entries(state.productsHub?.lists || {}).reduce((acc, [listId, list]) => {
    const nextListTickets = Object.entries(list?.tickets || {}).reduce((ticketAcc, [metaId, meta]) => {
      if (String(meta?.confirmedTicketId || '').trim() !== safeTicketId) {
        ticketAcc[metaId] = meta;
        return ticketAcc;
      }
      ticketAcc[metaId] = normalizeProductsListTicketMeta(metaId, {
        ...meta,
        confirmedAt: 0,
        confirmedTicketId: '',
        accountedTxId: '',
        updatedAt: nowTs(),
      });
      return ticketAcc;
    }, {});
    acc[listId] = { ...(list || {}), tickets: nextListTickets };
    return acc;
  }, {});
  state.productsHub = {
    ...(state.productsHub || normalizeProductsHub()),
    tickets: nextTickets,
    lists: nextLists,
  };
  const updatesMap = {
    [productsHubPath(`tickets/${safeTicketId}`)]: null,
  };
  Object.entries(nextLists).forEach(([listId, list]) => {
    updatesMap[productsHubPath(`lists/${listId}`)] = list;
  });
  await safeFirebase(() => update(ref(db), updatesMap));
  toast('Ticket eliminado del registro');
  triggerRender();
}

function productsDomValue(root = document, selectors = [], fallback = '') {
  for (const selector of selectors) {
    const el = root?.querySelector?.(selector);
    if (el) return el.value ?? el.textContent ?? fallback;
  }
  return fallback;
}

function syncProductsReceiptLineToBacking(root = document, lineId = '') {
  const safeId = String(lineId || '').trim();
  if (!safeId) return;
  const rowEl = root?.querySelector?.(`[data-products-line-row="${safeId}"]`);
  if (!rowEl) return;
  const receiptQty = root.querySelector(`[data-products-receipt-qty="${safeId}"]`);
  const receiptName = root.querySelector(`[data-products-receipt-name="${safeId}"]`);
  const receiptUnit = root.querySelector(`[data-products-receipt-unit="${safeId}"]`);
  const receiptTotal = root.querySelector(`[data-products-receipt-total="${safeId}"]`);
  const qtyInput = rowEl.querySelector(`[data-products-line-qty="${safeId}"]`);
  const actualInput = rowEl.querySelector(`[data-products-line-actual="${safeId}"]`);
  const estimateInput = rowEl.querySelector(`[data-products-line-estimate="${safeId}"]`);
  const nameNode = rowEl.querySelector('.productsWorkbench__lineMain strong');
  const unitHidden = rowEl.querySelector(`[data-products-line-unit="${safeId}"]`);
  const baseLine = resolveActiveProductsList()?.lines?.[safeId] || {};
  const qty = Math.max(0.01, Number(productsDomValue(root, [`[data-products-receipt-qty="${safeId}"]`, `[data-products-line-qty="${safeId}"]`], baseLine.qty || 1) || baseLine.qty || 1));
  const estimatedPrice = parseProductsReceiptMoney(receiptUnit?.value, normalizeProductPositiveNumber(baseLine.estimatedPrice, 0));
  const actualPrice = parseProductsReceiptMoney(receiptTotal?.value, normalizeProductPositiveNumber(baseLine.actualPrice, baseLine.estimatedPrice || 0));
  if (receiptQty && qtyInput && document.activeElement !== qtyInput) qtyInput.value = String(qty);
  if (actualInput && document.activeElement !== actualInput) actualInput.value = actualPrice ? String(Number(actualPrice.toFixed(6))) : '';
  if (estimateInput && document.activeElement !== estimateInput) estimateInput.value = estimatedPrice ? String(Number(estimatedPrice.toFixed(6))) : '';
  if (receiptName && nameNode) nameNode.textContent = normalizeFoodName(receiptName.value || nameNode.textContent || 'Producto') || 'Producto';
  if (unitHidden && !unitHidden.value) unitHidden.value = 'ud';
}

function readProductsListDraftFromDom(root = document) {
  const formEl = root?.querySelector?.('[data-products-list-form]');
  const baseList = resolveActiveProductsList();
  if (!formEl) return baseList;
  const scope = formEl.closest('[data-products-workbench]') || root;
  const nextList = cloneProductsListRecord(baseList);
  nextList.id = String(formEl.dataset.productsListId || nextList.id || '__draft__').trim() || '__draft__';
  nextList.name = normalizeProductText(formEl.querySelector('[name="listName"]')?.value || nextList.name || 'Lista activa') || 'Lista activa';
  const storeSelect = scope.querySelector('[name="store"]');
  const newStoreValue = scope.querySelector('[data-products-new-store-input]')?.value || '';
  nextList.store = normalizeFoodName((storeSelect?.value === '__new__' ? newStoreValue : storeSelect?.value) || nextList.store || '');
  nextList.plannedFor = toIsoDay(String(scope.querySelector('[name="plannedFor"]')?.value || nextList.plannedFor || '')) || dayKeyFromTs(nowTs());
  nextList.accountId = String(scope.querySelector('[name="accountId"]')?.value || nextList.accountId || '').trim();
  nextList.paymentMethod = normalizeProductText(scope.querySelector('[name="paymentMethod"]')?.value || nextList.paymentMethod || 'Tarjeta') || 'Tarjeta';
  nextList.notes = normalizeProductText(formEl.querySelector('[name="notes"]')?.value || nextList.notes || '');
  const activeTicketId = String(formEl.dataset.productsActiveTicketId || nextList.activeTicketId || nextList.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  nextList.activeTicketId = activeTicketId;
  nextList.tickets = { ...(nextList.tickets || {}) };
  nextList.tickets[activeTicketId] = normalizeProductsListTicketMeta(activeTicketId, {
    ...(nextList.tickets?.[activeTicketId] || {}),
    store: nextList.store,
    plannedFor: nextList.plannedFor,
    accountId: nextList.accountId,
    paymentMethod: nextList.paymentMethod,
    notes: nextList.notes,
    updatedAt: nowTs(),
  });
  nextList.updatedAt = nowTs();
  const lineEntries = Array.from(formEl.querySelectorAll('[data-products-line-row]')).map((rowEl, index) => {
    const lineId = String(rowEl.dataset.productsLineRow || '').trim() || createFinanceRecordId('line');
    const baseLine = baseList.lines?.[lineId] || {};
    const lineTicketId = String(rowEl.querySelector(`[data-products-line-ticket-id="${lineId}"]`)?.value || baseList.lines?.[lineId]?.ticketId || nextList.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
    syncProductsReceiptLineToBacking(root, lineId);
    const receiptName = productsDomValue(root, [`[data-products-receipt-name="${lineId}"]`], '');
    const qty = Math.max(0.01, Number(productsDomValue(root, [`[data-products-receipt-qty="${lineId}"]`], rowEl.querySelector(`[data-products-line-qty="${lineId}"]`)?.value || baseLine.qty || 1) || rowEl.querySelector(`[data-products-line-qty="${lineId}"]`)?.value || baseLine.qty || 1));
    const estimatedPriceFallback = Math.max(0, normalizeProductPositiveNumber(baseLine.estimatedPrice, Number(rowEl.querySelector(`[data-products-line-estimate="${lineId}"]`)?.value || 0)));
    const actualPriceFallback = Math.max(0, normalizeProductPositiveNumber(baseLine.actualPrice, Number(rowEl.querySelector(`[data-products-line-actual="${lineId}"]`)?.value || baseLine.estimatedPrice || 0)));
    const estimatedPrice = parseProductsReceiptMoney(productsDomValue(root, [`[data-products-receipt-unit="${lineId}"]`], estimatedPriceFallback), estimatedPriceFallback);
    const actualPrice = parseProductsReceiptMoney(productsDomValue(root, [`[data-products-receipt-total="${lineId}"]`], actualPriceFallback), actualPriceFallback);
    return [lineId, {
      id: lineId,
      productId: String(rowEl.querySelector(`[data-products-line-product-id="${lineId}"]`)?.value || baseList.lines?.[lineId]?.productId || '').trim(),
      name: normalizeFoodName(receiptName || baseList.lines?.[lineId]?.name || rowEl.querySelector('.productsWorkbench__lineMain strong')?.textContent || ''),
      qty,
      unit: normalizeProductUnit(rowEl.querySelector(`[data-products-line-unit="${lineId}"]`)?.value || baseList.lines?.[lineId]?.unit || 'ud'),
      estimatedPrice,
      actualPrice,
      store: normalizeFoodName(baseList.lines?.[lineId]?.store || nextList.store || ''),
      checked: rowEl.querySelector(`[data-products-line-checked="${lineId}"]`)?.checked !== false,
      ticketId: lineTicketId,
      note: normalizeProductText(baseList.lines?.[lineId]?.note || ''),
      sortOrder: index,
      createdAt: Number(baseList.lines?.[lineId]?.createdAt || nowTs()),
      updatedAt: nowTs(),
    }];
  });
  nextList.lines = normalizeProductsHubLineMap(Object.fromEntries(lineEntries));
  return ensureProductsListTickets(nextList);
}

function syncProductsTicketComposerDom(root = document) {
  const formEl = root?.querySelector?.('[data-products-list-form]');
  if (!formEl) return;
  const scope = formEl.closest('[data-products-workbench]') || root;
  const activeTicketId = String(formEl.dataset.productsActiveTicketId || '').trim();
  const lineTotals = [];
  const activeTicketLineTotals = [];
  formEl.querySelectorAll('[data-products-line-row]').forEach((rowEl) => {
    const lineId = String(rowEl.dataset.productsLineRow || '').trim();
    if (!lineId) return;
    syncProductsReceiptLineToBacking(root, lineId);
    const qty = Math.max(0.01, Number(productsDomValue(root, [`[data-products-receipt-qty="${lineId}"]`, `[data-products-line-qty="${lineId}"]`], 1)));
    const estimatedPriceFallback = Math.max(0, Number(rowEl.querySelector(`[data-products-line-estimate="${lineId}"]`)?.value || 0));
    const actualPriceFallback = Math.max(0, Number(rowEl.querySelector(`[data-products-line-actual="${lineId}"]`)?.value || estimatedPriceFallback));
    const estimatedPriceParsed = parseProductsReceiptMoney(productsDomValue(root, [`[data-products-receipt-unit="${lineId}"]`], ''), NaN, { blankAsNaN: true });
    const actualPriceParsed = parseProductsReceiptMoney(productsDomValue(root, [`[data-products-receipt-total="${lineId}"]`], ''), NaN, { blankAsNaN: true });
    const isChecked = rowEl.querySelector(`[data-products-line-checked="${lineId}"]`)?.checked !== false;
    const estimatedPrice = Number.isFinite(estimatedPriceParsed) ? estimatedPriceParsed : estimatedPriceFallback;
    const actualPrice = Number.isFinite(actualPriceParsed) ? actualPriceParsed : actualPriceFallback;
    const computedLine = calculateLineTotals({ qty, estimatedPrice, actualPrice });
    const estimatedSubtotal = computedLine.estimatedSubtotal;
    const actualSubtotal = computedLine.actualSubtotal;
    const rowTicketId = String(rowEl.querySelector(`[data-products-line-ticket-id="${lineId}"]`)?.value || '').trim();
    if (rowTicketId && rowTicketId === activeTicketId) {
      activeTicketLineTotals.push(computedLine);
    }
    lineTotals.push(computedLine);
    rowEl.classList.toggle('is-unchecked', !isChecked);
    rowEl.classList.toggle('is-checked', isChecked);
    const estimatedNode = root.querySelector(`[data-products-line-est-total="${lineId}"]`);
    const actualNode = root.querySelector(`[data-products-line-act-total="${lineId}"]`);
    const receiptQty = root.querySelector(`[data-products-receipt-qty="${lineId}"]`);
    const receiptUnit = root.querySelector(`[data-products-receipt-unit="${lineId}"]`);
    const receiptTotal = root.querySelector(`[data-products-receipt-total="${lineId}"]`);
    const receiptDiff = root.querySelector(`[data-products-receipt-diff="${lineId}"]`);
    const quickQty = root.querySelector(`[data-products-quick-line-qty="${lineId}"]`);
    const lineDiffMeta = resolveProductsReceiptDiffMeta(actualSubtotal - estimatedSubtotal);
    if (estimatedNode) estimatedNode.textContent = fmtCurrency(estimatedSubtotal);
    if (actualNode) actualNode.textContent = fmtCurrency(actualSubtotal);
    if (receiptQty && document.activeElement !== receiptQty) receiptQty.value = String(qty);
    syncProductsMoneyFieldDisplay(receiptUnit, estimatedPrice);
    syncProductsMoneyFieldDisplay(receiptTotal, actualPrice);
    if (receiptDiff) {
      receiptDiff.textContent = lineDiffMeta.label;
      receiptDiff.classList.toggle('is-expensive', lineDiffMeta.tone === 'expensive');
      receiptDiff.classList.toggle('is-cheap', lineDiffMeta.tone === 'cheap');
      receiptDiff.classList.toggle('is-even', lineDiffMeta.tone === 'even');
    }
    if (quickQty && document.activeElement !== quickQty) quickQty.value = String(qty);
  });
  const receiptTotals = calculateReceiptTotals(lineTotals);
  const activeTicketTotals = calculateReceiptTotals(activeTicketLineTotals);
  const addQty = root.querySelector('[data-products-receipt-add-qty]');
  const addUnit = root.querySelector('[data-products-receipt-add-unit]');
  const addTotal = root.querySelector('[data-products-receipt-add-total]');
  if (addTotal) addTotal.textContent = fmtCurrency(Math.max(0, Number(addQty?.value || 1)) * Math.max(0, Number(addUnit?.value || 0)));
  const storeSelect = scope.querySelector('[name="store"]');
  const storeValue = String((storeSelect?.value === '__new__' ? scope.querySelector('[data-products-new-store-input]')?.value : storeSelect?.value) || 'Supermercado').trim() || 'Supermercado';
  const accountSelect = scope.querySelector('[name="accountId"]');
  const accountId = String(accountSelect?.value || '').trim();
  const receiptStore = scope.querySelector('[data-products-receipt-store]');
  const receiptPayment = scope.querySelector('[data-products-receipt-payment]');
  const receiptDate = scope.querySelector('[data-products-receipt-date]');
  const listTotal = scope.querySelector('[data-products-list-total]');
  const ticketTotal = scope.querySelector('[data-products-ticket-total]');
  const ticketTotalFooter = scope.querySelector('[data-products-ticket-total-footer]');
  const ticketDiff = scope.querySelector('[data-products-ticket-diff]');
  const ticketDiffRow = scope.querySelector('[data-products-ticket-diff-row]');
  if (receiptStore && document.activeElement !== receiptStore && storeValue && receiptStore.value !== storeValue) receiptStore.value = storeValue;
  if (receiptPayment && document.activeElement !== receiptPayment && receiptPayment.value !== accountId) receiptPayment.value = accountId;
  if (receiptDate && document.activeElement !== receiptDate && !receiptDate.value) receiptDate.value = dayKeyFromTs(nowTs());
  if (listTotal) listTotal.textContent = fmtCurrency(activeTicketTotals.estimatedTotal);
  if (ticketTotal) ticketTotal.textContent = fmtCurrency(receiptTotals.actualTotal);
  if (ticketTotalFooter) ticketTotalFooter.textContent = fmtCurrency(activeTicketTotals.actualTotal);
  if (ticketDiffRow) {
    const diffMeta = resolveProductsReceiptDiffMeta(activeTicketTotals.diffTotal);
    if (ticketDiff) ticketDiff.textContent = diffMeta.label;
    ticketDiffRow.classList.toggle('is-expensive', diffMeta.tone === 'expensive');
    ticketDiffRow.classList.toggle('is-cheap', diffMeta.tone === 'cheap');
    ticketDiffRow.classList.toggle('is-even', diffMeta.tone === 'even');
  }
  const selectedCount = Object.keys(state.foodProductsView?.receiptSelections?.[formEl.dataset.productsListId] || {}).length;
  const selectedMap = state.foodProductsView?.receiptSelections?.[formEl.dataset.productsListId] || {};
  root.querySelectorAll('[data-products-receipt-row]').forEach((receiptRow) => {
    const lineId = String(receiptRow.dataset.productsReceiptRow || '').trim();
    receiptRow.classList.toggle('is-selected', !!selectedMap[lineId]);
  });
  const moveActions = root.querySelector('[data-products-receipt-move-actions]');
  const moveBtn = moveActions?.querySelector?.('[data-products-move-selected-ticket]');
  if (moveActions) moveActions.hidden = !selectedCount;
  if (moveBtn) moveBtn.textContent = `Mover a nuevo ticket (${selectedCount})`;
}

async function updateReceiptLine(ticketId = '', lineId = '', patch = {}, options = {}) {
  const safeLineId = String(lineId || '').trim();
  if (!safeLineId) return null;
  const root = options.root || document;
  const draft = ensureProductsListTickets(readProductsListDraftFromDom(root));
  const currentLine = draft.lines?.[safeLineId];
  if (!currentLine) return null;
  const targetTicketId = String(ticketId || currentLine.ticketId || draft.activeTicketId || draft.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  const nextLine = calculateLineTotals(normalizeReceiptLine({ ...currentLine, ...patch, ticketId: targetTicketId }, currentLine));
  draft.lines[safeLineId] = {
    ...currentLine,
    ...nextLine,
    ticketId: targetTicketId,
    updatedAt: nowTs(),
  };
  draft.updatedAt = nowTs();
  const normalizedDraft = ensureProductsListTickets(draft);
  if (normalizedDraft.id === '__draft__') {
    syncProductsDraftListLocal(normalizedDraft);
  } else if (options.persist !== false) {
    await persistProductsListRecord(normalizedDraft, { activate: true });
  } else {
    syncProductsDraftListLocal(normalizedDraft);
  }
  syncProductsTicketComposerDom(root);
  return normalizedDraft.lines[safeLineId];
}

const receiptLineCommitTimers = new Map();
const receiptEditSession = {
  active: false,
  lineId: null,
  field: null,
  startedAt: 0,
};

function resolveReceiptEditField(target) {
  if (!(target instanceof Element)) return '';
  if (target.matches('[data-products-receipt-qty], [data-products-receipt-add-qty]')) return 'qty';
  if (target.matches('[data-products-receipt-unit], [data-products-receipt-add-unit]')) return 'unit';
  if (target.matches('[data-products-receipt-total]')) return 'total';
  if (target.matches('[data-products-receipt-name], [data-products-receipt-add-name]')) return 'name';
  return '';
}

function isActiveTicketInput(target = document.activeElement) {
  if (!(target instanceof Element)) return false;
  return target.matches(
    '[data-products-receipt-qty], [data-products-receipt-unit], [data-products-receipt-total], [data-products-receipt-name], [data-products-receipt-add-qty], [data-products-receipt-add-unit], [data-products-receipt-add-name]'
  );
}

function beginReceiptEditSession(target) {
  if (!isActiveTicketInput(target)) return;
  const lineId = String(
    target?.dataset?.productsReceiptQty
      || target?.dataset?.productsReceiptUnit
      || target?.dataset?.productsReceiptTotal
      || target?.dataset?.productsReceiptName
      || ''
  ).trim() || null;
  receiptEditSession.active = true;
  receiptEditSession.lineId = lineId;
  receiptEditSession.field = resolveReceiptEditField(target) || null;
  receiptEditSession.startedAt = nowTs();
}

function endReceiptEditSession(target) {
  if (target && isActiveTicketInput(document.activeElement)) return;
  receiptEditSession.active = false;
  receiptEditSession.lineId = null;
  receiptEditSession.field = null;
  receiptEditSession.startedAt = 0;
}

function scheduleReceiptLineCommit(lineId = '', patch = {}, { root = document, delayMs = 260 } = {}) {
  const safeLineId = String(lineId || '').trim();
  if (!safeLineId) return;
  if (receiptLineCommitTimers.has(safeLineId)) {
    window.clearTimeout(receiptLineCommitTimers.get(safeLineId));
  }
  const timerId = window.setTimeout(async () => {
    receiptLineCommitTimers.delete(safeLineId);
    try {
      await updateReceiptLine('', safeLineId, patch, { root, persist: true });
    } catch (error) {
      console.warn('[finance][receipt] commit failed', { safeLineId, patch, error });
    }
  }, Math.max(120, Number(delayMs) || 260));
  receiptLineCommitTimers.set(safeLineId, timerId);
}

async function commitReceiptLineEdit(lineId = '', patch = {}, { root = document } = {}) {
  const safeLineId = String(lineId || '').trim();
  if (!safeLineId) return;
  if (receiptLineCommitTimers.has(safeLineId)) {
    window.clearTimeout(receiptLineCommitTimers.get(safeLineId));
    receiptLineCommitTimers.delete(safeLineId);
  }
  await updateReceiptLine('', safeLineId, patch, { root, persist: true });
}

async function persistProductsHubSettings(patch = {}) {
  const nextSettings = {
    ...(state.productsHub?.settings || {}),
    monthlyTarget: normalizeProductPositiveNumber(patch.monthlyTarget ?? state.productsHub?.settings?.monthlyTarget, 0),
    defaultAccountId: String(patch.defaultAccountId ?? state.productsHub?.settings?.defaultAccountId ?? '').trim(),
    defaultStore: normalizeFoodName(patch.defaultStore ?? state.productsHub?.settings?.defaultStore ?? ''),
    defaultPaymentMethod: normalizeProductText(patch.defaultPaymentMethod ?? state.productsHub?.settings?.defaultPaymentMethod ?? 'Tarjeta') || 'Tarjeta',
    activeListId: String(patch.activeListId ?? state.productsHub?.settings?.activeListId ?? '').trim(),
  };
  state.productsHub = {
    ...(state.productsHub || normalizeProductsHub()),
    settings: nextSettings,
  };
  await safeFirebase(() => update(ref(db, productsHubPath('settings')), nextSettings));
  return nextSettings;
}

async function persistProductsListRecord(list = {}, { activate = false } = {}) {
  const normalized = normalizeProductsHubList(String(list?.id || ''), list);
  if (normalized.id === '__draft__') {
    syncProductsDraftListLocal(normalized);
    return normalized;
  }
  writeLocalProductsDraft(null);
  const updatesMap = {
    [productsHubPath(`lists/${normalized.id}`)]: normalized,
  };
  const nextSettings = {
    ...(state.productsHub?.settings || {}),
  };
  if (activate) {
    nextSettings.activeListId = normalized.id;
    updatesMap[productsHubPath('settings/activeListId')] = normalized.id;
  }
  const nextLists = { ...(state.productsHub?.lists || {}) };
  delete nextLists.__draft__;
  nextLists[normalized.id] = normalized;
  state.productsHub = {
    ...(state.productsHub || normalizeProductsHub()),
    settings: nextSettings,
    lists: nextLists,
  };
  await safeFirebase(() => update(ref(db), updatesMap));
  return normalized;
}

async function ensurePersistedActiveProductsList(seed = null) {
  const draft = normalizeProductsHubList(
    String(seed?.id || resolveActiveProductsList().id || '__draft__'),
    seed || resolveActiveProductsList(),
  );
  if (draft.id !== '__draft__') {
    return persistProductsListRecord(draft, { activate: true });
  }
  const persisted = normalizeProductsHubList(createFinanceRecordId('list'), {
    ...draft,
    createdAt: draft.createdAt || nowTs(),
    updatedAt: nowTs(),
  });
  return persistProductsListRecord(persisted, { activate: true });
}

function resolveProductsCatalogSnapshot(productId = '') {
  const safeId = String(productId || '').trim();
  if (!safeId) return null;
  const model = buildProductsViewModel(state.foodProductsView || {});
  return model.catalogById?.[safeId] || state.food.itemsById?.[safeId] || resolveFoodItemByAnyKey(safeId) || null;
}

function upsertProductLineIntoList(list = {}, productSnapshot = null, options = {}) {
  const product = productSnapshot || {};
  const productId = String(product?.canonicalId || product?.id || '').trim();
  if (!productId) return cloneProductsListRecord(list);
  const nextList = ensureProductsListTickets(cloneProductsListRecord(list));
  const activeTicketId = String(options?.ticketId || nextList.activeTicketId || nextList.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  const existingEntry = Object.entries(nextList.lines || {}).find(([, line]) => (
    String(line?.productId || '').trim() === productId
    && String(line?.ticketId || activeTicketId || '').trim() === activeTicketId
  ));
  const price = resolveProductsCatalogPrice(product);
  if (existingEntry) {
    const [lineId, line] = existingEntry;
    nextList.lines[lineId] = {
      ...line,
      qty: Math.max(1, Number(line?.qty || 1)) + Math.max(1, Number(product?.usualQty || 1)),
      estimatedPrice: normalizeProductPositiveNumber(line?.estimatedPrice, price || 0),
      actualPrice: normalizeProductPositiveNumber(line?.actualPrice, normalizeProductPositiveNumber(line?.estimatedPrice, price || 0)),
      updatedAt: nowTs(),
    };
    nextList.updatedAt = nowTs();
    return nextList;
  }
  const lineId = createFinanceRecordId('line');
  nextList.lines[lineId] = {
    id: lineId,
    productId,
    name: normalizeFoodName(product?.canonicalName || product?.displayName || product?.name || productId),
    qty: Math.max(1, Number(product?.usualQty || 1)),
    unit: normalizeProductUnit(product?.unit || 'ud'),
    estimatedPrice: price || 0,
    actualPrice: price || 0,
    store: normalizeFoodName(product?.preferredStore || product?.place || nextList.store || ''),
      checked: true,
      ticketId: activeTicketId,
      note: '',
    sortOrder: Object.keys(nextList.lines || {}).length,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  };
  nextList.updatedAt = nowTs();
  return ensureProductsListTickets(nextList);
}

async function addProductToActiveProductsList(productId = '') {
  const product = resolveProductsCatalogSnapshot(productId);
  if (!product) return;
  const syncedDraft = readProductsListDraftFromDom();
  syncProductsDraftListLocal(syncedDraft);
  const persistedBase = await ensurePersistedActiveProductsList(syncedDraft);
  const nextList = upsertProductLineIntoList(persistedBase, product);
  await persistProductsListRecord(nextList, { activate: true });
  toast('Producto anadido a la lista');
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function addProductToActiveProductsListFromReceipt(productId = '') {
  const product = resolveProductsCatalogSnapshot(productId);
  if (!product) return;
  const syncedDraft = readProductsListDraftFromDom();
  syncProductsDraftListLocal(syncedDraft);
  const persistedBase = await ensurePersistedActiveProductsList(syncedDraft);
  let nextList = upsertProductLineIntoList(persistedBase, product);
  const activeTicketId = String(nextList.activeTicketId || nextList.primaryTicketId || 'ticket-1').trim();
  const addedLine = Object.values(nextList.lines || {})
    .filter((line) => String(line.productId || '').trim() === String(product.canonicalId || product.id || '').trim())
    .filter((line) => String(line.ticketId || '').trim() === activeTicketId)
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0];
  const addQty = Number(document.querySelector('[data-products-receipt-add-qty]')?.value || 1);
  const addUnit = Number(document.querySelector('[data-products-receipt-add-unit]')?.value || 0);
  if (addedLine?.id) {
    nextList.lines[addedLine.id] = {
      ...nextList.lines[addedLine.id],
      qty: Math.max(0.01, addQty || nextList.lines[addedLine.id].qty || 1),
      actualPrice: Math.max(0, addUnit || nextList.lines[addedLine.id].actualPrice || nextList.lines[addedLine.id].estimatedPrice || 0),
      estimatedPrice: Math.max(0, nextList.lines[addedLine.id].estimatedPrice || addUnit || 0),
      updatedAt: nowTs(),
    };
  }
  await persistProductsListRecord(nextList, { activate: true });
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
  requestAnimationFrame(() => document.querySelector('[data-products-receipt-add-name]')?.focus());
}

async function changeProductsReceiptLineProduct(lineId = '', productId = '') {
  const safeLineId = String(lineId || '').trim();
  const product = resolveProductsCatalogSnapshot(productId);
  if (!safeLineId || !product) return;
  const draft = readProductsListDraftFromDom();
  const line = draft?.lines?.[safeLineId];
  if (!line) return;
  const price = resolveProductsCatalogPrice(product);
  draft.lines[safeLineId] = {
    ...line,
    productId: String(product.canonicalId || product.id || '').trim(),
    name: normalizeFoodName(product.canonicalName || product.displayName || product.name || line.name),
    unit: normalizeProductUnit(product.unit || line.unit || 'ud'),
    estimatedPrice: normalizeProductPositiveNumber(line.estimatedPrice, price || 0),
    actualPrice: normalizeProductPositiveNumber(price, normalizeProductPositiveNumber(line.actualPrice, line.estimatedPrice || 0)),
    store: normalizeFoodName(product.preferredStore || product.place || draft.store || line.store || ''),
    updatedAt: nowTs(),
  };
  if (draft.id === '__draft__') syncProductsDraftListLocal(draft);
  else await persistProductsListRecord(draft, { activate: true });
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
  requestAnimationFrame(() => document.querySelector(`[data-products-receipt-unit="${safeLineId}"]`)?.focus());
}

function updateProductsReceiptSuggestions(inputEl) {
  const root = getProductsWorkbenchRoot();
  if (!root || !inputEl) return;
  const lineId = inputEl.dataset.productsReceiptName || '';
  const suggest = lineId
    ? root.querySelector(`[data-products-receipt-suggest="${lineId}"]`)
    : root.querySelector('[data-products-receipt-add-suggest]');
  if (!suggest) return;
  const query = String(inputEl.value || '');
  suggest.innerHTML = renderProductsReceiptSuggestionList(buildCurrentProductsModel(), query, lineId);
  suggest.hidden = false;
}

function closeProductsReceiptSuggestions(root = document, exceptEl = null) {
  root?.querySelectorAll?.('[data-products-receipt-suggest], [data-products-receipt-add-suggest]')?.forEach((suggest) => {
    if (exceptEl && (suggest === exceptEl || suggest.contains(exceptEl))) return;
    suggest.hidden = true;
  });
}

function closeProductsReceiptSuggestionsSoon(root = document, relatedTarget = null) {
  window.setTimeout(() => {
    if (relatedTarget?.closest?.('[data-products-receipt-suggest], [data-products-receipt-add-suggest]')) return;
    const active = document.activeElement;
    if (active?.matches?.('[data-products-receipt-add-name], [data-products-receipt-name]')) return;
    closeProductsReceiptSuggestions(root);
  }, 0);
}

async function createProductFromReceiptRow() {
  const nameInput = document.querySelector('[data-products-receipt-add-name]');
  const name = normalizeFoodName(nameInput?.value || '');
  if (!name) return;
  const storeSelect = document.querySelector('[data-products-store-select]');
  const defaultStore = normalizeFoodName((storeSelect?.value === '__new__' ? document.querySelector('[data-products-new-store-input]')?.value : storeSelect?.value) || state.productsHub?.settings?.defaultStore || '');
  const unitPrice = Math.max(0, Number(document.querySelector('[data-products-receipt-add-unit]')?.value || 0));
  const savedId = await upsertFoodItem({
    name,
    displayName: name,
    place: defaultStore,
    preferredStore: defaultStore,
    estimatedPrice: unitPrice,
    usualPrice: unitPrice,
    defaultPrice: unitPrice,
    unit: 'ud',
    usualQty: 1,
    active: true,
  }, false);
  if (!savedId) return;
  await addProductToActiveProductsListFromReceipt(savedId);
}

async function createProductFromQuickSearch(query = '') {
  const name = normalizeFoodName(query);
  if (!name) {
    toast('Escribe un nombre de producto');
    return;
  }
  const defaultStore = normalizeFoodName(state.productsHub?.settings?.defaultStore || '');
  const savedId = await upsertFoodItem({
    name,
    displayName: name,
    place: defaultStore,
    preferredStore: defaultStore,
    unit: 'ud',
    usualQty: 1,
    active: true,
  }, false);
  if (!savedId) return;
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    selectedProductId: savedId,
    listQuery: '',
  };
  await addProductToActiveProductsList(savedId);
}

async function addSelectedProductsToActiveList() {
  const ids = Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : [];
  if (!ids.length) return;
  const syncedDraft = readProductsListDraftFromDom();
  syncProductsDraftListLocal(syncedDraft);
  let nextList = await ensurePersistedActiveProductsList(syncedDraft);
  ids.forEach((productId) => {
    nextList = upsertProductLineIntoList(nextList, resolveProductsCatalogSnapshot(productId));
  });
  await persistProductsListRecord(nextList, { activate: true });
  toast(`${ids.length} productos enviados a la lista`);
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function addSelectedProductsToNewTicket() {
  const ids = Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : [];
  if (!ids.length) return;
  const syncedDraft = readProductsListDraftFromDom();
  syncProductsDraftListLocal(syncedDraft);
  const persistedBase = await ensurePersistedActiveProductsList(syncedDraft);
  let nextList = ensureProductsListTickets(cloneProductsListRecord(persistedBase));
  const nextTicketId = createFinanceRecordId('ticketlist');
  const baseTicket = nextList.tickets?.[nextList.activeTicketId] || nextList.tickets?.[nextList.primaryTicketId] || {};
  const nextSortOrder = Object.keys(nextList.tickets || {}).length;
  nextList.tickets[nextTicketId] = normalizeProductsListTicketMeta(nextTicketId, {
    ...baseTicket,
    label: buildNextTicketLabel(nextList),
    sortOrder: nextSortOrder,
    createdAt: nowTs(),
    updatedAt: nowTs(),
  });
  nextList.activeTicketId = nextTicketId;
  ids.forEach((productId) => {
    nextList = upsertProductLineIntoList(nextList, resolveProductsCatalogSnapshot(productId), { ticketId: nextTicketId });
  });
  await persistProductsListRecord(nextList, { activate: true });
  toast(ids.length === 1 ? 'Nuevo ticket creado con 1 producto' : `Nuevo ticket creado con ${ids.length} productos`);
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function saveActiveProductsListFromDom() {
  const draft = readProductsListDraftFromDom();
  if (!draft) return null;
  if (draft.store) await upsertFoodOption('place', draft.store, true);
  const persisted = await ensurePersistedActiveProductsList(draft);
  toast('Lista guardada');
  patchProductsShoppingPanel(buildCurrentProductsModel());
  return persisted;
}

async function removeProductsLineFromActiveList(lineId = '') {
  const draft = readProductsListDraftFromDom();
  if (!draft?.lines?.[lineId]) return;
  delete draft.lines[lineId];
  draft.updatedAt = nowTs();
  if (draft.id === '__draft__') {
    syncProductsDraftListLocal(draft);
  } else {
    await persistProductsListRecord(draft, { activate: true });
  }
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function clearProductsActiveList() {
  const draft = readProductsListDraftFromDom();
  if (!draft) return;
  const nextList = createEmptyProductsList({
    ...draft,
    id: draft.id,
    name: draft.name || 'Lista activa',
    store: draft.store,
    accountId: draft.accountId,
    paymentMethod: draft.paymentMethod,
    plannedFor: dayKeyFromTs(nowTs()),
  }, { temporary: draft.id === '__draft__' });
  if (nextList.id === '__draft__') {
    syncProductsDraftListLocal(nextList);
  } else {
    await persistProductsListRecord(nextList, { activate: true });
  }
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function persistProductsEditorForm(formEl) {
  if (!formEl) return;
  const form = new FormData(formEl);
  const productId = String(form.get('productId') || '').trim();
  const name = normalizeFoodName(String(form.get('name') || ''));
  if (!name) {
    toast('Nombre obligatorio');
    return;
  }
  const preferredStore = normalizeFoodName(String(form.get('preferredStore') || ''));
  const productType = normalizeFoodName(String(form.get('productType') || ''));
  const previous = productId ? (state.food.itemsById?.[productId] || null) : null;
  const payload = {
    id: productId,
    name,
    displayName: name,
    aliases: Array.isArray(previous?.aliases) ? previous.aliases : [],
    vendorAliases: previous?.vendorAliases && typeof previous.vendorAliases === 'object' ? previous.vendorAliases : {},
    mealType: productType,
    cuisine: previous?.cuisine || '',
    healthy: previous?.healthy || previous?.cuisine || '',
    place: preferredStore,
    productType,
    productCategory: normalizeFoodName(String(form.get('productCategory') || '')),
    preferredStore,
    brand: String(form.get('brand') || ''),
    format: String(form.get('format') || ''),
    usualPrice: Number(form.get('usualPrice') || 0),
    estimatedPrice: Number(form.get('estimatedPrice') || 0),
    lastPrice: Number(form.get('lastPrice') || 0),
    usualQty: Number(form.get('usualQty') || 1),
    unit: String(form.get('unit') || 'ud'),
    lastPurchaseAt: String(form.get('lastPurchaseAt') || ''),
    purchaseFrequencyDays: Number(form.get('purchaseFrequencyDays') || 0),
    estimatedDurationDays: Number(form.get('estimatedDurationDays') || 0),
    notes: String(form.get('notes') || ''),
    active: form.get('active') === 'on',
    tags: String(form.get('tags') || '').split(',').map((tag) => normalizeFoodName(tag)).filter(Boolean),
    defaultPrice: Number(form.get('estimatedPrice') || form.get('usualPrice') || form.get('lastPrice') || previous?.defaultPrice || 0),
  };
  const savedId = await upsertFoodItem(payload, false);
  if (productType) await upsertFoodOption('typeOfMeal', productType, false);
  if (preferredStore) await upsertFoodOption('place', preferredStore, false);
  state.foodProductsView = {
    ...(state.foodProductsView || {}),
    selectedProductId: savedId,
  };
  toast(productId ? 'Producto actualizado' : 'Producto creado');
  const model = buildCurrentProductsModel();
  patchProductsCatalogSubview(model);
  patchProductsShoppingPanel(model);
}

async function applyProductsBatchForm(formEl) {
  const ids = Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : [];
  if (!ids.length) return;
  const form = new FormData(formEl);
  const patch = {
    productType: normalizeFoodName(String(form.get('productType') || '')),
    productCategory: normalizeFoodName(String(form.get('productCategory') || '')),
    preferredStore: normalizeFoodName(String(form.get('preferredStore') || '')),
    tags: String(form.get('tags') || '').split(',').map((tag) => normalizeFoodName(tag)).filter(Boolean),
    activeState: String(form.get('activeState') || 'keep'),
  };
  for (const productId of ids) {
    const previous = state.food.itemsById?.[productId];
    if (!previous) continue;
    const nextTags = patch.tags.length
      ? [...new Set([...(Array.isArray(previous.tags) ? previous.tags : []), ...patch.tags])]
      : (Array.isArray(previous.tags) ? previous.tags : []);
    await upsertFoodItem({
      ...previous,
      id: productId,
      name: previous.name,
      displayName: previous.displayName || previous.name,
      productType: patch.productType || previous.productType || previous.mealType,
      productCategory: patch.productCategory || previous.productCategory,
      preferredStore: patch.preferredStore || previous.preferredStore || previous.place,
      place: patch.preferredStore || previous.preferredStore || previous.place,
      mealType: patch.productType || previous.productType || previous.mealType,
      tags: nextTags,
      active: patch.activeState === 'keep' ? previous.active !== false : patch.activeState === 'active',
    }, false);
  }
  toast(`Aplicado a ${ids.length} productos`);
  const shouldCloseModal = state.modal?.type === 'products-batch-edit';
  if (shouldCloseModal) {
    state.modal = { type: null };
  }
  const model = buildCurrentProductsModel();
  patchProductsCatalogSubview(model);
  patchProductsShoppingPanel(model);
  if (shouldCloseModal) triggerRender();
}

async function applyProductsSelectedActiveState(activeState = 'active') {
  const ids = Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : [];
  if (!ids.length) return;
  const makeActive = activeState !== 'inactive';
  for (const productId of ids) {
    const previous = state.food.itemsById?.[productId];
    if (!previous) continue;
    await upsertFoodItem({
      ...previous,
      id: productId,
      name: previous.name,
      displayName: previous.displayName || previous.name,
      active: makeActive,
    }, false);
  }
  toast(makeActive ? 'Productos activados' : 'Productos desactivados');
  const model = buildCurrentProductsModel();
  patchProductsCatalogSubview(model);
  patchProductsShoppingPanel(model);
}

async function persistProductsQuickEditForm(formEl) {
  if (!formEl) return;
  const productId = String(formEl.dataset.productsId || '').trim();
  const previous = state.food.itemsById?.[productId] || resolveProductsCatalogSnapshot(productId);
  if (!productId || !previous) return;
  const form = new FormData(formEl);
  const preferredStore = normalizeFoodName(String(form.get('preferredStore') || previous.preferredStore || previous.place || ''));
  await upsertFoodItem({
    ...previous,
    id: productId,
    name: previous.name || previous.canonicalName || previous.displayName || productId,
    displayName: previous.displayName || previous.canonicalName || previous.name || productId,
    estimatedPrice: Number(form.get('estimatedPrice') || previous.estimatedPrice || previous.currentUnitPrice || 0),
    usualQty: Number(form.get('usualQty') || previous.usualQty || 1),
    estimatedDurationDays: Number(form.get('estimatedDurationDays') || previous.estimatedDurationDays || 0),
    preferredStore,
    place: preferredStore || previous.place || '',
  }, false);
  toast('Producto actualizado');
  const model = buildCurrentProductsModel();
  patchProductsCatalogSubview(model);
  patchProductsShoppingPanel(model);
}

async function reuseProductsTicketAsActiveList(ticketId = '') {
  const ticket = state.productsHub?.tickets?.[ticketId];
  if (!ticket) return;
  const nextList = createEmptyProductsList({
    name: `Lista ${ticket.store || 'reutilizada'}`,
    store: ticket.store,
    accountId: ticket.accountId,
    paymentMethod: ticket.paymentMethod,
    plannedFor: dayKeyFromTs(nowTs()),
    notes: ticket.note || '',
    sourceTicketId: ticket.id,
    lines: Object.fromEntries(Object.values(ticket.lines || {}).map((line, index) => {
      const lineId = createFinanceRecordId('line');
      return [lineId, {
        id: lineId,
        productId: String(line.productId || '').trim(),
        name: normalizeFoodName(line.name || ''),
        qty: Math.max(0.01, Number(line.qty || 1)),
        unit: normalizeProductUnit(line.unit || 'ud'),
        estimatedPrice: normalizeProductPositiveNumber(line.actualPrice || line.estimatedPrice, 0),
        actualPrice: normalizeProductPositiveNumber(line.actualPrice || line.estimatedPrice, 0),
        store: normalizeFoodName(line.store || ticket.store || ''),
        checked: true,
        note: normalizeProductText(line.note || ''),
        sortOrder: index,
        createdAt: nowTs(),
        updatedAt: nowTs(),
      }];
    })),
  });
  await persistProductsListRecord(nextList, { activate: true });
  toast('Ticket reutilizado como lista');
  switchProductsSubview('list');
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function reuseProductsListAsActiveList(listId = '') {
  const list = state.productsHub?.lists?.[listId];
  if (!list) return;
  const nextList = createEmptyProductsList({
    name: `${list.name || 'Lista'} copia`,
    store: list.store,
    accountId: list.accountId,
    paymentMethod: list.paymentMethod,
    plannedFor: dayKeyFromTs(nowTs()),
    notes: list.notes || '',
    sourceTicketId: list.sourceTicketId || '',
    lines: Object.fromEntries(Object.values(list.lines || {}).map((line, index) => {
      const lineId = createFinanceRecordId('line');
      return [lineId, {
        ...line,
        id: lineId,
        sortOrder: index,
        createdAt: nowTs(),
        updatedAt: nowTs(),
      }];
    })),
  });
  await persistProductsListRecord(nextList, { activate: true });
  toast('Lista duplicada como compra activa');
  switchProductsSubview('list');
  const model = buildCurrentProductsModel();
  patchProductsShoppingPanel(model);
  patchProductsCatalogSubview(model);
}

async function saveProductsPurchaseTransaction(list = {}) {
  const lines = Object.values(list.lines || {}).map((line) => ({
    ...line,
    qty: Math.max(0.01, Number(line.qty || 1)),
    estimatedPrice: normalizeProductPositiveNumber(line.estimatedPrice, 0),
    actualPrice: normalizeProductPositiveNumber(line.actualPrice, normalizeProductPositiveNumber(line.estimatedPrice, 0)),
  })).filter((line) => line.name);
  if (!lines.length) {
    toast('La lista no tiene lineas');
    return null;
  }
  const accountId = String(list.accountId || state.productsHub?.settings?.defaultAccountId || state.balance?.defaultAccountId || '').trim();
  if (!accountId) {
    toast('Selecciona una cuenta antes de confirmar');
    return null;
  }
  const confirmedAt = Number(list.confirmedAt || list.registeredAt || 0);
  const confirmedDateISO = confirmedAt > 0 ? dayKeyFromTs(confirmedAt) : '';
  const dateISO = toIsoDay(String(list.confirmedDateISO || confirmedDateISO || list.plannedFor || '')) || dayKeyFromTs(nowTs());
  const category = 'Compra';
  const ticketReference = normalizeProductText(list.ticketRef || list.ticketLabel || '');
  const note = normalizeProductText(
    list.notes
    || `Compra ${list.store || ''}${ticketReference ? ` · ${ticketReference}` : ''}`,
  ) || 'Compra';
  const totalAmount = lines.reduce((sum, line) => sum + (Number(line.actualPrice || 0) * Math.max(0.01, Number(line.qty || 1))), 0);
  if (!(totalAmount > 0)) {
    toast('El ticket debe tener importe real');
    return null;
  }

  const normalizedLines = [];
  await ensureFoodCatalogLoaded();
  for (const line of lines) {
    const productSnapshot = resolveProductsCatalogSnapshot(line.productId);
    const savedFoodId = await upsertFoodItem({
      id: String(line.productId || productSnapshot?.canonicalId || productSnapshot?.id || '').trim(),
      name: normalizeFoodName(line.name || productSnapshot?.canonicalName || productSnapshot?.displayName || productSnapshot?.name || ''),
      displayName: normalizeFoodName(line.name || productSnapshot?.canonicalName || productSnapshot?.displayName || productSnapshot?.name || ''),
      aliases: Array.isArray(productSnapshot?.aliasList || productSnapshot?.aliases) ? (productSnapshot?.aliasList || productSnapshot?.aliases) : [],
      vendorAliases: productSnapshot?.vendorAliases && typeof productSnapshot.vendorAliases === 'object' ? productSnapshot.vendorAliases : {},
      mealType: normalizeFoodName(productSnapshot?.productType || productSnapshot?.mealType || ''),
      cuisine: normalizeFoodName(productSnapshot?.cuisine || ''),
      healthy: normalizeFoodName(productSnapshot?.healthy || productSnapshot?.cuisine || ''),
      place: normalizeFoodName(line.store || list.store || productSnapshot?.preferredStore || productSnapshot?.place || ''),
      productType: normalizeFoodName(productSnapshot?.productType || productSnapshot?.mealType || ''),
      productCategory: normalizeFoodName(productSnapshot?.productCategory || ''),
      preferredStore: normalizeFoodName(line.store || list.store || productSnapshot?.preferredStore || productSnapshot?.place || ''),
      brand: String(productSnapshot?.brand || ''),
      format: String(productSnapshot?.format || ''),
      usualPrice: Number(productSnapshot?.usualPrice || line.actualPrice || line.estimatedPrice || 0),
      estimatedPrice: Number(line.estimatedPrice || productSnapshot?.estimatedPrice || line.actualPrice || 0),
      lastPrice: Number(line.actualPrice || productSnapshot?.lastPrice || 0),
      usualQty: Number(productSnapshot?.usualQty || line.qty || 1),
      unit: String(line.unit || productSnapshot?.unit || 'ud'),
      lastPurchaseAt: dateISO,
      purchaseFrequencyDays: Number(productSnapshot?.purchaseFrequencyDays || 0),
      estimatedDurationDays: Number(productSnapshot?.estimatedDurationDays || 0),
      notes: String(productSnapshot?.notes || ''),
      active: productSnapshot?.active !== false,
      tags: Array.isArray(productSnapshot?.tags) ? productSnapshot.tags : [],
      defaultPrice: Number(line.actualPrice || line.estimatedPrice || productSnapshot?.estimatedPrice || productSnapshot?.defaultPrice || 0),
    }, true, {
      lastCategory: category,
      lastAccountId: accountId,
      lastNote: note,
      lastPrice: Number(line.actualPrice || line.estimatedPrice || 0),
      lastPurchaseAt: parseDayKey(dateISO),
      unit: String(line.unit || productSnapshot?.unit || 'ud'),
    });
    const itemPayload = {
      foodId: savedFoodId,
      productKey: String(savedFoodId || firebaseSafeKey(line.name || '')).trim(),
      name: normalizeFoodName(line.name || productSnapshot?.canonicalName || productSnapshot?.displayName || productSnapshot?.name || ''),
      qty: Math.max(1, Number(line.qty || 1)),
      unit: normalizeProductUnit(line.unit || productSnapshot?.unit || 'ud'),
      unitPrice: Number(line.actualPrice || line.estimatedPrice || 0),
      amount: Number(line.actualPrice || line.estimatedPrice || 0) * Math.max(1, Number(line.qty || 1)),
      totalPrice: Number(line.actualPrice || line.estimatedPrice || 0) * Math.max(1, Number(line.qty || 1)),
      price: Number(line.actualPrice || line.estimatedPrice || 0) * Math.max(1, Number(line.qty || 1)),
      mealType: normalizeFoodName(productSnapshot?.productType || productSnapshot?.mealType || ''),
      cuisine: normalizeFoodName(productSnapshot?.cuisine || ''),
      place: normalizeFoodName(line.store || list.store || productSnapshot?.preferredStore || productSnapshot?.place || ''),
      healthy: normalizeFoodName(productSnapshot?.healthy || productSnapshot?.cuisine || ''),
    };
    normalizedLines.push(itemPayload);
    if (itemPayload.mealType) await upsertFoodOption('typeOfMeal', itemPayload.mealType, true);
    if (itemPayload.place) await upsertFoodOption('place', itemPayload.place, true);
    await recordFoodPricePoint(savedFoodId, Number(itemPayload.unitPrice || 0), 'expense', {
      ts: parseDayKey(dateISO) || nowTs(),
      date: dateISO,
      vendor: itemPayload.place || list.store || 'unknown',
      unitPrice: Number(itemPayload.unitPrice || 0),
      qty: Math.max(1, Number(itemPayload.qty || 1)),
      unit: String(itemPayload.unit || 'ud'),
      totalPrice: Number(itemPayload.totalPrice || 0),
      linePrice: Number(itemPayload.totalPrice || 0),
    });
  }

  const saveId = push(ref(db, `${state.financePath}/transactions`)).key;
  const extras = {
    items: normalizedLines,
    filters: {
      mealType: '',
      cuisine: '',
      place: normalizeFoodName(list.store || ''),
      healthy: '',
    },
    ticketData: {
      schema: 'SHOPPING_TICKET_V1',
      source: { vendor: normalizeFoodName(list.store || 'unknown') || 'unknown' },
      ticketId: String(list.ticketId || ''),
      ticketRef: ticketReference,
      confirmedAt: confirmedAt || nowTs(),
      paymentMethod: list.paymentMethod || 'Tarjeta',
      estimatedTotal: lines.reduce((sum, line) => sum + (Number(line.estimatedPrice || 0) * Math.max(1, Number(line.qty || 1))), 0),
      actualTotal: totalAmount,
    },
  };
  const payload = {
    type: 'expense',
    amount: totalAmount,
    date: dateISO,
    monthKey: dateISO.slice(0, 7),
    accountId,
    fromAccountId: '',
    toAccountId: '',
    category,
    note,
    allocation: normalizeTxAllocation({ mode: 'point', period: 'day', anchorDate: dateISO }, dateISO),
    extras,
    updatedAt: nowTs(),
    createdAt: nowTs(),
  };
  const txPersisted = await safeFirebase(async () => {
    await update(ref(db), {
      [`${state.financePath}/transactions/${saveId}`]: payload,
      [`${state.financePath}/catalog/categories/${category}`]: { name: category, lastUsedAt: nowTs() },
    });
    return true;
  }, false);
  if (!txPersisted) {
    toast('No se pudo registrar el gasto en finanzas');
    return null;
  }

  const freshRoot = await loadFinanceRoot();
  await recomputeAccountEntries(accountId, dateISO, freshRoot);
  const refreshedRoot = await loadFinanceRoot();
  state.balance = state.balance || {};
  state.balance.transactions = {
    ...(state.balance.transactions || {}),
    [saveId]: payload,
  };
  syncLocalAccountsFromRoot(refreshedRoot);
  clearFinanceDerivedCaches();
  scheduleAggregateRebuild();
  localStorage.setItem('bookshell_finance_lastMovementAccountId', accountId);
  state.lastMovementAccountId = accountId;
  return { txId: saveId, total: totalAmount, payload };
}

async function confirmProductsTicketFromDom() {
  const draft = ensureProductsListTickets(readProductsListDraftFromDom());
  const activeTicketId = String(draft.activeTicketId || draft.primaryTicketId || 'ticket-1').trim() || 'ticket-1';
  const activeTicketMeta = draft.tickets?.[activeTicketId] || {};
  const activeTicketLines = Object.fromEntries(
    Object.entries(draft.lines || {}).filter(([, line]) => String(line?.ticketId || draft.primaryTicketId || '').trim() === activeTicketId),
  );
  if (!draft || !Object.keys(activeTicketLines || {}).length) {
    toast('No hay lineas para confirmar');
    return;
  }
  if (activeTicketMeta.accountedTxId) {
    toast('Este ticket ya está contabilizado');
    return;
  }
  if (activeTicketMeta.store || draft.store) await upsertFoodOption('place', activeTicketMeta.store || draft.store, true);
  const persistedList = await ensurePersistedActiveProductsList(draft);
  const persistedTicketMeta = persistedList.tickets?.[activeTicketId] || {};
  if (persistedTicketMeta.accountedTxId) {
    toast('Este ticket ya fue contabilizado');
    return;
  }
  const confirmedAtTs = nowTs();
  const confirmedDateISO = dayKeyFromTs(confirmedAtTs);
  const ticketPayload = normalizeProductsHubList(persistedList.id, {
    ...persistedList,
    store: activeTicketMeta.store || persistedList.store,
    accountId: activeTicketMeta.accountId || persistedList.accountId,
    paymentMethod: activeTicketMeta.paymentMethod || persistedList.paymentMethod,
    plannedFor: activeTicketMeta.plannedFor || persistedList.plannedFor,
    confirmedAt: confirmedAtTs,
    confirmedDateISO,
    notes: activeTicketMeta.notes || persistedList.notes,
    ticketId: activeTicketId,
    ticketLabel: activeTicketMeta.label || '',
    ticketRef: activeTicketMeta.label ? `ticket ${activeTicketMeta.label}` : `ticket ${activeTicketId}`,
    lines: activeTicketLines,
  });
  const txResult = await saveProductsPurchaseTransaction(ticketPayload);
  if (!txResult) return;
  const ticketId = createFinanceRecordId('ticket');
  const estimatedTotal = Object.values(activeTicketLines || {}).reduce((sum, line) => sum + (Math.max(1, Number(line.qty || 1)) * normalizeProductPositiveNumber(line.estimatedPrice, 0)), 0);
  const ticketRecord = normalizeProductsHubTicket(ticketId, {
    listId: persistedList.id,
    txId: txResult.txId,
    store: ticketPayload.store,
    accountId: ticketPayload.accountId,
    paymentMethod: ticketPayload.paymentMethod,
    note: ticketPayload.notes,
    dateISO: confirmedDateISO,
    confirmedAt: confirmedAtTs,
    estimatedTotal,
    actualTotal: txResult.total,
    lines: activeTicketLines,
    createdAt: confirmedAtTs,
    updatedAt: confirmedAtTs,
  });
  const remainingLines = Object.fromEntries(
    Object.entries(persistedList.lines || {}).filter(([, line]) => String(line?.ticketId || persistedList.primaryTicketId || '').trim() !== activeTicketId),
  );
  const nextTicketsMeta = Object.fromEntries(
    Object.entries(persistedList.tickets || {}).map(([ticketMetaId, ticketMeta]) => {
      if (ticketMetaId !== activeTicketId) return [ticketMetaId, ticketMeta];
      return [
        ticketMetaId,
        normalizeProductsListTicketMeta(ticketMetaId, {
          ...ticketMeta,
          confirmedAt: confirmedAtTs,
          accountedTxId: txResult.txId,
          confirmedTicketId: ticketId,
          updatedAt: confirmedAtTs,
        }),
      ];
    }),
  );
  const remainingTicketIds = Object.keys(nextTicketsMeta).filter((ticketMetaId) => ticketMetaId !== activeTicketId);
  const nextActiveTicketId = remainingTicketIds.find((ticketMetaId) => (
    Object.values(remainingLines).some((line) => String(line?.ticketId || '').trim() === ticketMetaId)
  )) || remainingTicketIds[0] || persistedList.primaryTicketId;
  const convertedList = ensureProductsListTickets({
    ...persistedList,
    lines: remainingLines,
    tickets: nextTicketsMeta,
    status: Object.keys(remainingLines).length ? 'draft' : 'converted',
    sourceTicketId: Object.keys(remainingLines).length ? persistedList.sourceTicketId : ticketId,
    activeTicketId: nextActiveTicketId,
    updatedAt: nowTs(),
  });
  const nextActiveList = createEmptyProductsList({
    name: 'Lista activa',
    store: ticketPayload.store,
    accountId: ticketPayload.accountId,
    paymentMethod: ticketPayload.paymentMethod,
  });
  const shouldRotateList = !Object.keys(remainingLines).length;
  state.productsHub = {
    ...(state.productsHub || normalizeProductsHub()),
    settings: {
      ...(state.productsHub?.settings || {}),
      activeListId: shouldRotateList ? nextActiveList.id : convertedList.id,
    },
    lists: {
      ...Object.fromEntries(Object.entries(state.productsHub?.lists || {}).filter(([id]) => id !== '__draft__')),
      [convertedList.id]: convertedList,
      ...(shouldRotateList ? { [nextActiveList.id]: nextActiveList } : {}),
    },
    tickets: {
      ...(state.productsHub?.tickets || {}),
      [ticketRecord.id]: ticketRecord,
    },
  };
  await safeFirebase(() => update(ref(db), {
    [productsHubPath(`tickets/${ticketRecord.id}`)]: ticketRecord,
    [productsHubPath(`lists/${convertedList.id}`)]: convertedList,
    ...(shouldRotateList ? { [productsHubPath(`lists/${nextActiveList.id}`)]: nextActiveList } : {}),
    [productsHubPath('settings/activeListId')]: shouldRotateList ? nextActiveList.id : convertedList.id,
  }));
  setReceiptSelectionMap(convertedList.id, {});
  toast('Compra confirmada y gasto registrado');
  triggerRender();
}

function firebaseSafeKeyLoose(s) {
  return String(s ?? '')
    .trim()
    .toLowerCase()
    .replace(/[.#$\[\]\/]/g, '_')
    .replace(/\s+/g, ' ')
    .slice(0, 120) || 'unknown';
}

function firebaseClean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (v === undefined) continue;
    if (Number.isNaN(v)) continue;
    if (v === Infinity || v === -Infinity) continue;
    if (v instanceof Date || v instanceof Map || v instanceof Set || Array.isArray(v) || (v && typeof v === 'object')) continue;
    out[k] = v === null ? null : v;
  }
  return out;
}

function clonePlain(value) {
  if (value == null) return value;
  try {
    if (typeof structuredClone === 'function') return structuredClone(value);
  } catch (_) {}
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return value;
  }
}

function createFinanceRecordId(prefix = 'item') {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function normalizeProductsHubLineMap(lines = {}) {
  const sourceEntries = Array.isArray(lines)
    ? lines.map((line, index) => [String(line?.id || `line-${index}`), line])
    : Object.entries(lines || {});
  return sourceEntries.reduce((acc, [lineId, line]) => {
    const safeId = String(lineId || line?.id || createFinanceRecordId('line')).trim();
    const payload = line && typeof line === 'object' ? line : {};
    const name = normalizeFoodName(payload?.name || payload?.productName || '');
    acc[safeId] = {
      id: safeId,
      productId: String(payload?.productId || payload?.foodId || '').trim(),
      name: name || normalizeFoodName(payload?.productId || safeId),
      qty: Math.max(0.01, Number(payload?.qty || 1)),
      unit: normalizeProductUnit(payload?.unit || 'ud'),
      estimatedPrice: normalizeProductPositiveNumber(payload?.estimatedPrice ?? payload?.plannedPrice ?? payload?.unitPrice ?? payload?.price, 0),
      actualPrice: normalizeProductPositiveNumber(payload?.actualPrice ?? payload?.finalPrice ?? payload?.estimatedPrice ?? payload?.unitPrice ?? payload?.price, 0),
      store: normalizeFoodName(payload?.store || payload?.place || ''),
      checked: payload?.checked !== false,
      ticketId: String(payload?.ticketId || '').trim(),
      note: normalizeProductText(payload?.note || ''),
      sortOrder: normalizeProductNumber(payload?.sortOrder, 0),
      createdAt: normalizeProductNumber(payload?.createdAt, nowTs()),
      updatedAt: normalizeProductNumber(payload?.updatedAt, nowTs()),
    };
    return acc;
  }, {});
}

function normalizeProductsHubList(id = '', payload = {}) {
  const safeId = String(id || payload?.id || createFinanceRecordId('list')).trim();
  const normalized = {
    id: safeId,
    name: normalizeProductText(payload?.name || 'Lista activa') || 'Lista activa',
    status: ['draft', 'converted', 'archived'].includes(String(payload?.status || '')) ? String(payload.status) : 'draft',
    store: normalizeFoodName(payload?.store || ''),
    accountId: normalizeProductText(payload?.accountId || ''),
    paymentMethod: normalizeProductText(payload?.paymentMethod || 'Tarjeta') || 'Tarjeta',
    plannedFor: toIsoDay(String(payload?.plannedFor || '')) || dayKeyFromTs(nowTs()),
    notes: normalizeProductText(payload?.notes || ''),
    ticketId: normalizeProductText(payload?.ticketId || ''),
    ticketLabel: normalizeProductText(payload?.ticketLabel || ''),
    ticketRef: normalizeProductText(payload?.ticketRef || ''),
    sourceTicketId: normalizeProductText(payload?.sourceTicketId || ''),
    lines: normalizeProductsHubLineMap(payload?.lines || {}),
    primaryTicketId: normalizeProductText(payload?.primaryTicketId || 'ticket-1') || 'ticket-1',
    activeTicketId: normalizeProductText(payload?.activeTicketId || payload?.primaryTicketId || 'ticket-1') || 'ticket-1',
    tickets: Object.entries(payload?.tickets || {}).reduce((acc, [ticketId, ticketPayload]) => {
      const normalizedTicket = normalizeProductsListTicketMeta(ticketId, ticketPayload);
      acc[normalizedTicket.id] = normalizedTicket;
      return acc;
    }, {}),
    createdAt: normalizeProductNumber(payload?.createdAt, nowTs()),
    updatedAt: normalizeProductNumber(payload?.updatedAt, nowTs()),
  };
  return ensureProductsListTickets(normalized);
}

function normalizeProductsHubTicket(id = '', payload = {}) {
  const safeId = String(id || payload?.id || createFinanceRecordId('ticket')).trim();
  const normalizedConfirmedAt = normalizeProductNumber(payload?.confirmedAt, normalizeProductNumber(payload?.registeredAt, 0));
  return {
    id: safeId,
    listId: normalizeProductText(payload?.listId || ''),
    txId: normalizeProductText(payload?.txId || ''),
    store: normalizeFoodName(payload?.store || ''),
    accountId: normalizeProductText(payload?.accountId || ''),
    paymentMethod: normalizeProductText(payload?.paymentMethod || 'Tarjeta') || 'Tarjeta',
    note: normalizeProductText(payload?.note || ''),
    dateISO: toIsoDay(String(payload?.dateISO || payload?.date || '')) || dayKeyFromTs(nowTs()),
    confirmedAt: normalizedConfirmedAt,
    estimatedTotal: normalizeProductPositiveNumber(payload?.estimatedTotal, 0),
    actualTotal: normalizeProductPositiveNumber(payload?.actualTotal, 0),
    lines: normalizeProductsHubLineMap(payload?.lines || {}),
    createdAt: normalizeProductNumber(payload?.createdAt, nowTs()),
    updatedAt: normalizeProductNumber(payload?.updatedAt, nowTs()),
  };
}

function normalizeProductsHub(rawHub = {}) {
  const raw = rawHub && typeof rawHub === 'object' ? rawHub : {};
  const lists = Object.entries(raw?.lists || {}).reduce((acc, [id, payload]) => {
    acc[id] = normalizeProductsHubList(id, payload);
    return acc;
  }, {});
  const tickets = Object.entries(raw?.tickets || {}).reduce((acc, [id, payload]) => {
    acc[id] = normalizeProductsHubTicket(id, payload);
    return acc;
  }, {});
  const settings = {
    monthlyTarget: normalizeProductPositiveNumber(raw?.settings?.monthlyTarget, 0),
    defaultAccountId: normalizeProductText(raw?.settings?.defaultAccountId || ''),
    defaultStore: normalizeFoodName(raw?.settings?.defaultStore || ''),
    defaultPaymentMethod: normalizeProductText(raw?.settings?.defaultPaymentMethod || 'Tarjeta') || 'Tarjeta',
    activeListId: normalizeProductText(raw?.settings?.activeListId || ''),
  };
  return {
    settings,
    lists,
    tickets,
  };
}

async function mergeFoodProducts(selection = [], destinationId = '') {
  const ids = [...new Set(selection.map((id) => String(id || '').trim()).filter(Boolean))];
  console.log('[mergeFoodProducts] selected product ids/names', ids.map((id) => ({ id, name: state.food.itemsById?.[id]?.displayName || state.food.itemsById?.[id]?.name || id })));
  if (ids.length < 2) return false;

  const canonicalId = String(destinationId || ids[0]).trim();
  if (!ids.includes(canonicalId)) return false;

  const canonicalItem = state.food.itemsById?.[canonicalId] || {};
  const canonicalName = normalizeFoodName(canonicalItem.displayName || canonicalItem.name || canonicalId) || canonicalId;
  const canonicalIdKey = String(canonicalItem.idKey || firebaseSafeKey(canonicalName) || canonicalId).trim();
  const sourceIds = ids.filter((id) => id !== canonicalId);
  const sourceItems = sourceIds.map((id) => ({ id, ...(state.food.itemsById?.[id] || {}) }));
  const prevCanonical = state.foodCatalog.canonicals?.[canonicalId] || {};
  const canonicalSnapshotBefore = JSON.parse(JSON.stringify(prevCanonical || {}));
  const sourceSnapshotsBefore = sourceItems.map((item) => ({
    id: item.id,
    name: item.displayName || item.name || item.id,
    aliases: Array.isArray(item.aliases) ? item.aliases : [],
    vendorAliases: item.vendorAliases || {},
    priceHistoryStores: Object.keys(item.priceHistory || {}),
    mergedInto: item.mergedInto || null,
    hiddenMerged: !!item.hiddenMerged
  }));

  console.log('[mergeFoodProducts] target product id/name', { canonicalId, canonicalName });
  console.log('[mergeFoodProducts] source snapshot before merge', sourceSnapshotsBefore);
  console.log('[mergeFoodProducts] target snapshot before merge', canonicalSnapshotBefore);

  const aliasesByStore = prevCanonical.aliasesByStore && typeof prevCanonical.aliasesByStore === 'object' ? JSON.parse(JSON.stringify(prevCanonical.aliasesByStore)) : {};
  const pricesByStore = prevCanonical.pricesByStore && typeof prevCanonical.pricesByStore === 'object' ? JSON.parse(JSON.stringify(prevCanonical.pricesByStore)) : {};
  const updatesToCommit = {};
  const nextAliasesState = JSON.parse(JSON.stringify(state.foodCatalog.aliases || {}));
  const nextMergesState = JSON.parse(JSON.stringify(state.foodCatalog.merges || {}));
  const now = nowTs();

  const normalizedSourceNames = new Set();
  const normalizedSourceKeys = new Set();
  sourceItems.forEach((item) => {
    normalizedSourceKeys.add(String(item.id || '').trim());
    normalizedSourceKeys.add(String(item.idKey || '').trim());
    [item.name, item.displayName, ...(Array.isArray(item.aliases) ? item.aliases : [])]
      .map((v) => normalizeFoodName(v))
      .filter(Boolean)
      .forEach((alias) => {
        normalizedSourceNames.add(normalizeFoodCompareKey(alias));
        normalizedSourceKeys.add(firebaseSafeKey(alias));
      });
  });

  const preRebuild = buildProductsViewModel(state.foodProductsView || {});
  const preProducts = preRebuild?.products || [];
  const preTargetTotal = Number(preProducts.find((row) => row.canonicalId === canonicalId)?.totalSpend || preProducts.find((row) => row.canonicalId === canonicalId)?.total || 0);
  const preSourceTotal = preProducts.filter((row) => sourceIds.includes(row.canonicalId)).reduce((sum, row) => sum + Number(row.totalSpend || row.total || 0), 0);
  console.log('[mergeFoodProducts] source totals before merge', { preTargetTotal, preSourceTotal });

  for (const item of [{ id: canonicalId, ...canonicalItem }, ...sourceItems]) {
    const baseAliases = [...new Set([item.name, item.displayName, ...(Array.isArray(item.aliases) ? item.aliases : []), item.id].map((v) => normalizeFoodName(v)).filter(Boolean))];
    const vendorAliases = item.vendorAliases && typeof item.vendorAliases === 'object' ? item.vendorAliases : {};
    const vendorKeys = new Set(['unknown', normalizeFoodName(item.place || ''), normalizeFoodName(item.createdFromVendor || ''), ...Object.keys(vendorAliases || {}), ...Object.keys(item.priceHistory || {})]);

    for (const vendorRaw of vendorKeys) {
      if (!vendorRaw) continue;
      const vendorKey = firebaseSafeKeyLoose(vendorRaw || 'unknown');
      const aliasesForVendor = [...new Set([
        ...baseAliases,
        ...((Array.isArray(vendorAliases[vendorRaw]) ? vendorAliases[vendorRaw] : []).map((v) => normalizeFoodName(v)).filter(Boolean))
      ])];
      if (!aliasesByStore[vendorKey]) aliasesByStore[vendorKey] = [];
      aliasesByStore[vendorKey] = [...new Set([...(aliasesByStore[vendorKey] || []), ...aliasesForVendor])];

      for (const aliasRaw of aliasesForVendor) {
        const aliasCandidates = [...new Set([
          normalizeAliasKey(aliasRaw),
          normalizeAliasKey(normalizeFoodCompareKey(aliasRaw))
        ].filter(Boolean))];
        for (const aliasKey of aliasCandidates) {
          const payload = firebaseClean({ canonicalId, aliasRaw: String(aliasRaw || ''), updatedAt: now });
          updatesToCommit[`${state.financePath}/foodCatalog/aliases/${vendorKey}/${aliasKey}`] = payload;
          if (!nextAliasesState[vendorKey]) nextAliasesState[vendorKey] = {};
          nextAliasesState[vendorKey][aliasKey] = payload;
        }
      }

      const vendorRows = item.priceHistory?.[vendorRaw] || item.priceHistory?.[vendorKey] || {};
      const numericPrices = Object.values(vendorRows || {}).map((row) => Number(row?.unitPrice || row?.price || 0)).filter((v) => Number.isFinite(v) && v > 0);
      if (!pricesByStore[vendorKey]) pricesByStore[vendorKey] = [];
      pricesByStore[vendorKey] = [...pricesByStore[vendorKey], ...numericPrices].slice(-250);
    }
  }

  if (!sourceItems.every((item) => {
    const name = normalizeFoodName(item.displayName || item.name || item.id);
    return Object.values(aliasesByStore).some((list) => Array.isArray(list) && list.includes(name));
  })) {
    console.error('[mergeFoodProducts] abort: alias migration incomplete', { sourceIds, aliasesByStore });
    return false;
  }

  const txRows = balanceTxList().filter((row) => normalizeTxType(row?.type) === 'expense');
  const txPatchByPath = {};
  let sourceHistoricalLines = 0;
  let migratedHistoricalLines = 0;

  txRows.forEach((row) => {
    const items = foodItemsFromTx(row);
    if (!items.length || !row.__path) return;
    let touched = false;
    const nextItems = items.map((item) => {
      const itemFoodId = String(item?.foodId || '').trim();
      const itemProductKey = String(item?.productKey || '').trim();
      const itemNameKey = normalizeFoodCompareKey(item?.name || '');
      const matchesSource = sourceIds.includes(itemFoodId)
        || normalizedSourceKeys.has(itemProductKey)
        || normalizedSourceNames.has(itemNameKey)
        || normalizedSourceKeys.has(itemFoodId);
      if (!matchesSource) return item;
      sourceHistoricalLines += 1;
      touched = true;
      migratedHistoricalLines += 1;
      return {
        ...item,
        foodId: canonicalId,
        productKey: canonicalIdKey
      };
    });
    if (!touched) return;
    const nextExtras = {
      ...(row.extras && typeof row.extras === 'object' ? row.extras : {}),
      items: nextItems,
      migratedAt: now,
      migratedToCanonicalId: canonicalId
    };
    txPatchByPath[row.__path] = nextExtras;
    updatesToCommit[`${row.__path}/extras`] = nextExtras;
  });

  if (sourceHistoricalLines !== migratedHistoricalLines) {
    console.error('[mergeFoodProducts] abort: historical migration mismatch', { sourceHistoricalLines, migratedHistoricalLines });
    return false;
  }

  const canonicalPayload = {
    name: String(canonicalName || canonicalId),
    createdAt: Number(prevCanonical?.createdAt || now),
    updatedAt: now,
    aliasesByStore: Object.fromEntries(Object.entries(aliasesByStore).map(([store, list]) => [store, [...new Set((Array.isArray(list) ? list : []).map((it) => normalizeFoodName(it)).filter(Boolean))]])),
    pricesByStore: Object.fromEntries(Object.entries(pricesByStore).map(([store, list]) => [store, (Array.isArray(list) ? list : []).map((v) => Number(v)).filter((v) => Number.isFinite(v) && v > 0).slice(-250)]))
  };

  console.log('[mergeFoodProducts] merged aliases result', canonicalPayload.aliasesByStore);
  console.log('[mergeFoodProducts] merged price stores result', Object.fromEntries(Object.entries(canonicalPayload.pricesByStore || {}).map(([k, v]) => [k, (Array.isArray(v) ? v.length : 0)])));

  updatesToCommit[`${state.financePath}/foodCatalog/canonicals/${canonicalId}`] = canonicalPayload;

  sourceIds.forEach((id) => {
    const mergeFromId = firebaseSafeKeyLoose(id);
    const mergePayload = firebaseClean({ canonicalId, updatedAt: now });
    updatesToCommit[`${state.financePath}/foodCatalog/merges/${id}`] = mergePayload;
    updatesToCommit[`${state.financePath}/foodCatalog/merges/${mergeFromId}`] = mergePayload;
    updatesToCommit[`${state.financePath}/foodItems/${id}/mergedInto`] = canonicalId;
    updatesToCommit[`${state.financePath}/foodItems/${id}/hiddenMerged`] = true;
    updatesToCommit[`${state.financePath}/foodItems/${id}/updatedAt`] = now;
    nextMergesState[id] = mergePayload;
    nextMergesState[mergeFromId] = mergePayload;
  });

  if (!Object.keys(updatesToCommit).length) {
    console.error('[mergeFoodProducts] abort: empty persistence payload');
    return false;
  }

  console.log('[mergeFoodProducts] persistence payload', { paths: Object.keys(updatesToCommit).length, sourceIds, canonicalId, migratedHistoricalLines });

  try {
    await safeFirebase(() => update(ref(db), updatesToCommit));
  } catch (error) {
    console.error('[mergeFoodProducts] abort: persistence failed, no local mutation applied', error);
    return false;
  }

  state.foodCatalog.canonicals[canonicalId] = canonicalPayload;
  state.foodCatalog.aliases = nextAliasesState;
  state.foodCatalog.merges = nextMergesState;
  sourceIds.forEach((id) => {
    if (!state.food.itemsById?.[id]) return;
    state.food.itemsById[id] = { ...state.food.itemsById[id], mergedInto: canonicalId, hiddenMerged: true, updatedAt: now };
  });

  Object.entries(txPatchByPath).forEach(([path, extras]) => {
    const match = path.match(/\/(transactions|tx)\/([^/]+)$/);
    if (match && state.balance?.[match[1]]?.[match[2]]) {
      state.balance[match[1]][match[2]] = { ...state.balance[match[1]][match[2]], extras };
      return;
    }
    const legacyMatch = path.match(/\/movements\/([^/]+)\/([^/]+)$/);
    if (legacyMatch && state.balance?.movements?.[legacyMatch[1]]?.[legacyMatch[2]]) {
      state.balance.movements[legacyMatch[1]][legacyMatch[2]] = { ...state.balance.movements[legacyMatch[1]][legacyMatch[2]], extras };
    }
  });
  clearFinanceDerivedCaches();

  const rebuild = buildProductsViewModel(state.foodProductsView || {});
  const visibleCanonicalIds = (rebuild?.products || []).map((row) => row.canonicalId);
  const canonicalStats = (rebuild?.products || []).find((row) => row.canonicalId === canonicalId) || null;
  const postTargetTotal = Number(canonicalStats?.totalSpend || canonicalStats?.total || 0);
  const targetAliasesFlat = Object.values(canonicalPayload.aliasesByStore || {}).flatMap((list) => Array.isArray(list) ? list : []);
  const expectedAliasNames = sourceItems.map((item) => normalizeFoodName(item.displayName || item.name || item.id)).filter(Boolean);
  const aliasesVerified = expectedAliasNames.every((name) => targetAliasesFlat.includes(name));
  const totalsVerified = postTargetTotal + 0.0001 >= (preTargetTotal + preSourceTotal);
  const sourceHiddenVerified = sourceIds.every((id) => !visibleCanonicalIds.includes(id));

  console.log('[mergeFoodProducts] merged totals result', { preTargetTotal, preSourceTotal, postTargetTotal });
  console.log('[mergeFoodProducts] source redirect/hidden status after merge', sourceIds.map((id) => ({ id, mergedInto: state.food.itemsById?.[id]?.mergedInto, hiddenMerged: state.food.itemsById?.[id]?.hiddenMerged })));
  console.log('[mergeFoodProducts] rebuilt stats for target', canonicalStats);
  console.log('[mergeFoodProducts] visible products after rebuild', visibleCanonicalIds);

  if (!aliasesVerified || !totalsVerified || !sourceHiddenVerified) {
    console.error('[mergeFoodProducts][CRITICAL] post-merge verification failed', {
      aliasesVerified,
      totalsVerified,
      sourceHiddenVerified,
      expectedAliasNames,
      postTargetTotal,
      expectedMinTotal: preTargetTotal + preSourceTotal,
      visibleCanonicalIds
    });
  }

  return aliasesVerified && totalsVerified;
}

function normalizeFoodExtras(rawExtras = {}, amount = 0) {
  if (!rawExtras || typeof rawExtras !== 'object') return null;
  const extras = { ...rawExtras };
  const items = Array.isArray(extras.items)
    ? extras.items.map((item) => ({
      foodId: String(item?.foodId || ''),
      productKey: String(item?.productKey || ''),
      name: normalizeFoodName(item?.name || item?.item || item?.productName || ''),
      qty: Math.max(1, Number(item?.qty || 1)),
      unit: String(item?.unit || 'ud').trim() || 'ud',
      amount: Number((item?.amount ?? item?.totalPrice ?? item?.price) || 0),
      totalPrice: Number((item?.totalPrice ?? item?.amount ?? item?.price) || 0),
      price: Number((item?.price ?? item?.totalPrice ?? item?.amount) || 0),
      unitPrice: Number((item?.unitPrice ?? item?.unit_price) || computeUnitPrice((item?.totalPrice ?? item?.amount ?? item?.price), item?.qty || 1)),
      mealType: normalizeFoodName(item?.mealType || item?.typeOfMeal || ''),
      cuisine: normalizeFoodName(item?.cuisine || ''),
      place: normalizeFoodName(item?.place || ''),
      healthy: String(item?.healthy || '')
    })).filter((item) => item.name)
    : [];
  if (!items.length) {
    const legacyName = normalizeFoodName(extras.item || extras.productName || extras.name || '');
    if (legacyName) {
      items.push({
        foodId: String(extras.foodId || ''),
        productKey: String(extras.productKey || ''),
        name: legacyName,
        qty: Math.max(1, Number(extras.qty || 1)),
        unit: String(extras.unit || 'ud').trim() || 'ud',
        amount: Number((extras.amount ?? extras.totalPrice ?? extras.price ?? amount) || 0),
        totalPrice: Number((extras.totalPrice ?? extras.amount ?? extras.price ?? amount) || 0),
        price: Number((extras.price ?? extras.totalPrice ?? extras.amount ?? amount) || 0),
        unitPrice: Number((extras.unitPrice ?? extras.unit_price) || computeUnitPrice((extras.totalPrice ?? extras.amount ?? extras.price ?? amount), extras.qty || 1)),
        mealType: normalizeFoodName(extras.mealType || extras.foodType || ''),
        cuisine: normalizeFoodName(extras.cuisine || ''),
        place: normalizeFoodName(extras.place || ''),
        healthy: String(extras.healthy || '')
      });
    }
  }
  if (!items.length) return null;
  return {
    items,
    filters: {
      mealType: normalizeFoodName(extras.filters?.mealType || extras.mealType || extras.foodType || items[0]?.mealType || ''),
      cuisine: normalizeFoodName(extras.filters?.cuisine || extras.cuisine || items[0]?.cuisine || ''),
      place: normalizeFoodName(extras.filters?.place || extras.place || items.find((item) => item?.place)?.place || ''),
      healthy: String(extras.healthy || items[0]?.healthy || '')
    }
  };
}

function foodItemsFromTx(row = {}) {
  return normalizeFoodExtras(row.extras || row.food || {}, row.amount)?.items || [];
}

function groupTxByDay(txList = [], accountsById = {}, scope = 'personal') {
  const grouped = {};
  txList.forEach((rawRow) => {
    const row = normalizeTxRow(rawRow, rawRow?.id);
    const day = isoToDay(row.date || row.dateISO || '');
    if (!day) return;
    if (!grouped[day]) grouped[day] = { dayISO: day, rows: [], totalIncome: 0, totalExpense: 0, net: 0 };
    const amount = Number.isFinite(row.amount) ? row.amount : 0;
    const impact = row.recurringVirtual
      ? 0
      : (scope === 'global'
      ? (row.type === 'income' ? amount : (row.type === 'expense' ? -amount : 0))
      : personalDeltaForTx(row, accountsById));
    grouped[day].rows.push(row);
    if (impact >= 0) grouped[day].totalIncome += impact;
    else grouped[day].totalExpense += Math.abs(impact);
    grouped[day].net += impact;
  });
  return Object.values(grouped).sort((a, b) => b.dayISO.localeCompare(a.dayISO));
}

function recurringForMonth(monthKey = getSelectedBalanceMonthKey()) {
  return recurringResolvedForMonth(monthKey, balanceTxList(), { includeFuture: true });
}

function buildRecurringInstancePayload(recurringId = '', recurringData = {}, monthKey = getMonthKeyFromDate(), { now = nowTs(), autoCreated = true } = {}) {
  const safeRecurringId = String(recurringId || '').trim();
  const scheduledDateISO = resolveRecurringScheduledDateISO(recurringData, monthKey);
  const type = normalizeTxType(recurringData?.type || 'expense');
  return {
    type,
    amount: Number(recurringData?.amount || 0),
    date: scheduledDateISO,
    dateISO: scheduledDateISO,
    monthKey: normalizeRecurringMonthKey(scheduledDateISO),
    recurringId: safeRecurringId,
    recurringMonthKey: normalizeRecurringMonthKey(scheduledDateISO),
    recurringDueDateISO: scheduledDateISO,
    recurringAutoCreated: !!autoCreated,
    accountId: type === 'transfer' ? '' : String(recurringData?.accountId || '').trim(),
    fromAccountId: type === 'transfer' ? String(recurringData?.fromAccountId || '').trim() : '',
    toAccountId: type === 'transfer' ? String(recurringData?.toAccountId || '').trim() : '',
    category: type === 'transfer' ? 'transfer' : (String(recurringData?.category || '').trim() || 'Sin categoría'),
    note: String(recurringData?.note || '').trim(),
    ...(Number.isFinite(Number(recurringData?.personalRatio)) ? { personalRatio: clamp01(recurringData.personalRatio, 1) } : {}),
    linkedHabitId: String(recurringData?.linkedHabitId || '').trim() || null,
    allocation: normalizeTxAllocation(recurringData?.allocation || {}, scheduledDateISO),
    extras: mergeRecurringTemplateExtras(recurringData?.extras, null),
    updatedAt: now,
    createdAt: now,
  };
}

async function ensureRecurringCurrentMonthInstances() {
  const currentMonthKey = getMonthKeyFromDate();
  const todayKey = dayKeyFromTs(Date.now());
  const txRows = balanceTxList();
  const updatesMap = {};
  const localPayloads = {};
  const touchedAccounts = new Set();
  let recomputeStart = todayKey;

  Object.entries(state.balance.recurring || {}).forEach(([recurringId, recurringData]) => {
    if (!recurringData || recurringData.disabled || recurringData.autoCreate === false) return;
    const schedule = recurringData.schedule || {};
    if ((schedule.frequency || 'monthly') !== 'monthly') return;
    const scheduledDateISO = resolveRecurringScheduledDateISO(recurringData, currentMonthKey);
    if (!scheduledDateISO || scheduledDateISO > todayKey) return;
    if (schedule.startDate && scheduledDateISO < String(schedule.startDate)) return;
    if (schedule.endDate && scheduledDateISO > String(schedule.endDate)) return;
    if (findRecurringInstanceTx(recurringId, currentMonthKey, txRows, recurringData)) return;
    const nextId = push(ref(db, `${state.financePath}/transactions`)).key;
    const payload = buildRecurringInstancePayload(recurringId, recurringData, currentMonthKey, { autoCreated: true });
    updatesMap[`${state.financePath}/transactions/${nextId}`] = payload;
    localPayloads[nextId] = payload;
    [payload.accountId, payload.fromAccountId, payload.toAccountId].filter(Boolean).forEach((accountId) => touchedAccounts.add(accountId));
    if (scheduledDateISO < recomputeStart) recomputeStart = scheduledDateISO;
  });

  if (!Object.keys(updatesMap).length) return [];

  try {
    await update(ref(db), updatesMap);
  } catch (error) {
    log('no se pudieron materializar recurrentes del mes', error);
    return [];
  }

  state.balance = state.balance || {};
  state.balance.transactions = {
    ...(state.balance.transactions || {}),
    ...localPayloads,
  };
  clearFinanceDerivedCaches();

  try {
    const freshRoot = await loadFinanceRoot();
    await Promise.all(Array.from(touchedAccounts).map((accountId) => recomputeAccountEntries(accountId, recomputeStart, freshRoot)));
    const refreshedRoot = await loadFinanceRoot();
    syncLocalAccountsFromRoot(refreshedRoot);
  } catch (error) {
    log('no se pudieron recomputar cuentas tras materializar recurrentes', error);
  }

  scheduleAggregateRebuild();
  return Object.keys(localPayloads);
}

async function upsertFoodOption(kind, value, incrementCount = false) {
  const name = normalizeFoodName(value);
  if (!name) return '';
  if (!state.food.options[kind]) state.food.options[kind] = {};
  const prev = state.food.options[kind][name] || {};
  const payload = {
    createdAt: Number(prev.createdAt || 0) || nowTs(),
    count: Number(prev.count || 0) + (incrementCount ? 1 : 0)
  };
  state.food.options[kind][name] = payload;
  await safeFirebase(() => update(ref(db, `${state.financePath}/catalog/foodOptions/${kind}/${name}`), payload));
  return name;
}

async function upsertFoodItem(value, incrementCount = false, patch = {}) {
  const payloadInput = typeof value === 'object' && value ? value : { name: value };
  const name = normalizeFoodName(payloadInput.name || '');
  if (!name) return '';
  const existingId = payloadInput.id || state.food.nameToId?.[name.toLowerCase()] || '';
  const foodId = existingId || createFinanceProductId(name, state.food.itemsById || {});
  const prevEntity = state.food.itemsById?.[foodId] || getFoodByName(name) || {};
  const normalizedMeta = normalizeFinanceProductMeta({
    ...prevEntity,
    ...payloadInput,
    unit: payloadInput.unit ?? patch.unit ?? prevEntity.unit,
    lastPrice: payloadInput.lastPrice ?? patch.lastPrice ?? prevEntity.lastPrice ?? payloadInput.defaultPrice,
    lastPurchaseAt: payloadInput.lastPurchaseAt ?? patch.lastPurchaseAt ?? prevEntity.lastPurchaseAt,
  }, prevEntity);
  const defaultPrice = normalizeProductPositiveNumber(
    payloadInput.defaultPrice ?? normalizedMeta.estimatedPrice ?? normalizedMeta.usualPrice ?? patch.lastPrice ?? prevEntity.defaultPrice ?? 0,
    0,
  );
  const payload = {
    id: foodId,
    idKey: firebaseSafeKey(name),
    name,
    displayName: String(payloadInput.displayName || prevEntity.displayName || name).trim() || name,
    aliases: Array.isArray(payloadInput.aliases) ? payloadInput.aliases.map((alias) => normalizeFoodName(alias)).filter(Boolean) : (prevEntity.aliases || []),
    vendorAliases: payloadInput.vendorAliases && typeof payloadInput.vendorAliases === 'object' ? payloadInput.vendorAliases : (prevEntity.vendorAliases || {}),
    createdFromVendor: String(payloadInput.createdFromVendor || prevEntity.createdFromVendor || ''),
    mealType: normalizeFoodName(payloadInput.mealType ?? patch.lastExtras?.mealType ?? prevEntity.mealType ?? ''),
    cuisine: normalizeFoodName(payloadInput.cuisine ?? patch.lastExtras?.cuisine ?? prevEntity.cuisine ?? ''),
    healthy: normalizeFoodName(payloadInput.healthy ?? patch.lastExtras?.healthy ?? prevEntity.healthy ?? ''),
    place: normalizeFoodName(payloadInput.place ?? patch.lastExtras?.place ?? prevEntity.place ?? ''),
    defaultPrice,
    ...normalizedMeta,
    priceHistory: prevEntity.priceHistory || {},
    countUsed: Number(prevEntity.countUsed || 0) + (incrementCount ? 1 : 0),
    createdAt: Number(prevEntity.createdAt || 0) || nowTs(),
    updatedAt: nowTs()
  };
  state.food.itemsById[foodId] = payload;
  state.food.nameToId[name.toLowerCase()] = foodId;
  financeDebug('upsert food item', { foodId, name, incrementCount, payload });
  await safeFirebase(() => set(ref(db, `${state.financePath}/foodItems/${foodId}`), payload));
  const legacyKey = firebaseSafeKey(name);
  const prev = state.food.items[legacyKey] || state.food.items[name] || {};
  const legacyPayload = {
    name,
    key: legacyKey,
    createdAt: Number(prev.createdAt || 0) || nowTs(),
    count: Number(prev.count || 0) + (incrementCount ? 1 : 0),
    lastUsedAt: incrementCount ? nowTs() : Number(prev.lastUsedAt || 0),
    lastPrice: Number(payload.defaultPrice || patch.lastPrice || prev.lastPrice || 0),
    lastCategory: String(patch.lastCategory ?? prev.lastCategory ?? ''),
    lastAccountId: String(patch.lastAccountId ?? prev.lastAccountId ?? ''),
    lastNote: String(patch.lastNote ?? prev.lastNote ?? ''),
    lastExtras: { mealType: payload.mealType, cuisine: payload.cuisine, place: payload.place, healthy: payload.healthy }
  };
  state.food.items[legacyKey] = legacyPayload;
  await safeFirebase(() => update(ref(db, `${state.financePath}/catalog/foodItems/${legacyKey}`), legacyPayload));
  if (auth?.currentUser?.uid) {
    const globalItem = {
      name: payload.displayName || payload.name,
      normalizedName: normalizeCatalogName(payload.displayName || payload.name || ''),
      brand: String(payload.brand || '').trim(),
      barcode: String(payload.barcode || '').trim(),
      category: String(payload.cuisine || payload.category || '').trim(),
      baseUnit: String(payload.unit || payload.baseUnit || '').trim(),
      macros: payload.macros && typeof payload.macros === 'object' ? payload.macros : undefined,
      defaultPrice,
    };
    await upsertPublicCatalogItem(GLOBAL_PRODUCTS_PATH, globalItem, auth.currentUser.uid);
  }
  return foodId;
}

async function deleteManagedStatItem(kind, rawName) {
  const name = normalizeFoodName(rawName);
  if (!name) return;
  if (kind === 'category') {
    const updatesMap = {};
    const replacement = '(Eliminado)';
    balanceTxList().forEach((row) => {
      if (String(row.category || '').trim().toLowerCase() !== name.toLowerCase()) return;
      updatesMap[`${state.financePath}/transactions/${row.id}/category`] = replacement;
      updatesMap[`${state.financePath}/transactions/${row.id}/updatedAt`] = nowTs();
    });
    updatesMap[`${state.financePath}/catalog/categories/${name}`] = null;
    if (Object.keys(updatesMap).length) await safeFirebase(() => update(ref(db), updatesMap));
    delete state.balance.categories[name];
    clearFinanceDerivedCaches();
    toast('Categoría eliminada (migrada a "(Eliminado)")');
    return;
  }
  if (kind === 'place' || kind === 'typeOfMeal' || kind === 'cuisine') {
    await safeFirebase(() => remove(ref(db, `${state.financePath}/catalog/foodOptions/${kind}/${name}`)));
    if (state.food.options?.[kind]) delete state.food.options[kind][name];
    toast('Elemento eliminado del selector');
  }
}

function renderFoodOptionField(kind, label, selectName) {
  const options = foodOptionList(kind);
  return `
    <div class="food-extra-field" data-food-kind="${kind}">
      <label class="finFood__label">${label}</label>
      <select class="food-control" name="${selectName}" data-food-select="${kind}">
        <option value="">Elegir</option>
        ${options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}
      </select>
      <button type="button" class="food-mini-btn foodX-mini" data-food-add="${kind}" aria-label="Añadir ${escapeHtml(label)}">+</button>
    </div>`;
}

function renderFoodExtrasSection() {
  const topItems = topFoodItems(5);
  return `
    <div class="finFood">
      <div class="finFood__head">
        <h4 class="finFood__title">Extras de comida</h4>
      </div>

   <details class="finFood__dropdown">
  <summary class="finFood__dropdownSummary">Extras de comida</summary>

  <section class="finFood__quick foodX-grid" data-food-extra>
    ${renderFoodOptionField('typeOfMeal', 'Tipo', 'foodMealType')}
    ${renderFoodOptionField('cuisine', 'Saludable', 'foodCuisine')}
    ${renderFoodOptionField('place', 'Dónde', 'foodPlace')}
  </section>
</details>

      <section class="finFood__card">

        

        <div class="finFood__block">
          <label class="finFood__label">Buscar</label>
<div class="busqueda-precio foodX-inline">
          <input class="finFood__search" type="search" data-food-item-search placeholder="Buscar plato (ej: pollo)" autocomplete="off" />
          <input class="finFood__price" type="number" step="0.01" min="0" placeholder="Precio" data-food-item-price />
</div>
          <div class="finFood__results" data-food-item-results>
          </div>
        </div>

        <div class="finFood__draft foodX-inline">
          <button type="button" class="finance-pill finFood__btn" data-food-item-add>Añadir</button>
          <button type="button" class="finance-pill finance-pill--mini finFood__btn finFood__btn--ghost" data-food-reset-amount>Reset €</button>
        </div>

        <div class="finFood__selected" data-food-items-list>
          <small class="finance-empty">Sin productos añadidos.</small>
        </div>

        <input type="hidden" name="foodItems" data-food-items-json value="[]" />
        <input type="hidden" name="foodItem" data-food-item-value />
        <input type="hidden" name="foodId" data-food-id-value />
      </section>
    </div>

    <div class="finFood__block">
          <div class="finFood__labelRow">
            <label class="finFood__label">Producto / Plato</label>
            <span class="finFood__tag">Habituales</span>
          </div>

          <div class="food-list food-items-grid" data-food-top>
            ${
  topItems.map(item => `
    <div class="food-item">
      
      <div class="food-pill" data-food-top-item="${escapeHtml(item.id)}">
        
        <button type="button" class="food-pill__main">
          <span class="food-pill__name">${escapeHtml(item.name)}</span>
          <small class="food-pill__count">×${item.count}</small>
        </button>
        <button type="button"
            class="food-iconbtn"
            data-food-item-info="${escapeHtml(item.id)}"
            title="Ficha del producto"
            aria-label="Ficha del producto">
            ℹ️
          </button>
          <button type="button"
            class="food-iconbtn"
            data-food-item-detail="${escapeHtml(item.id)}"
            title="Detalle de precios"
            aria-label="Detalle de precios">
            📈
          </button>

          <button type="button"
            class="food-iconbtn"
            data-food-item-edit="${escapeHtml(item.id)}"
            title="Editar comida"
            aria-label="Editar comida">
            ✏️
          </button>

      </div>

    </div>
  `).join('') || `<small class="finance-empty">Sin habituales aún.</small>`
}
          </div>
        </div>
  `;
}

function foodChartSeriesByVendor(history = [], range = 'total') {
  const now = Date.now();
  const days = range === '30d' ? 30 : (range === '90d' ? 90 : 0);
  const minTs = days ? (now - (days * 86400000)) : 0;
  const filtered = history.filter((row) => !days || Number(row.ts || 0) >= minTs);
  const byVendor = filtered.reduce((acc, row) => {
    const vendor = firebaseSafeKey(row.vendor || 'unknown') || 'unknown';
    if (!acc[vendor]) acc[vendor] = [];
    acc[vendor].push(row);
    return acc;
  }, {});
  Object.values(byVendor).forEach((rows) => rows.sort((a, b) => a.ts - b.ts));
  return byVendor;
}

function foodDetailViewModel(food = {}, fallbackName = '') {
  const name = normalizeFoodName(food?.name || fallbackName || '');
  const displayName = String(food?.displayName || name || food?.idKey || 'Producto').trim() || 'Producto';
  const history = mergedFoodHistory(food);
  const explicitHistory = foodPriceHistoryList(food);
  const byVendor = history.reduce((acc, row) => {
    const vendor = firebaseSafeKey(row.vendor || 'unknown') || 'unknown';
    if (!acc[vendor]) acc[vendor] = [];
    acc[vendor].push(row);
    return acc;
  }, {});
  const vendors = Object.keys(byVendor);
  const latestByVendor = vendors.map((vendor) => {
    const last = (byVendor[vendor] || []).slice().sort((a, b) => b.ts - a.ts)[0] || null;
    return last ? { vendor, ...last } : null;
  }).filter(Boolean).sort((a, b) => b.ts - a.ts);
  const latest = latestByVendor[0] || null;
  const totalQty = history.reduce((sum, row) => sum + Math.max(1, Number(row.qty || 1)), 0);
  const weightedAvgUnitPrice = totalQty > 0
    ? history.reduce((sum, row) => sum + (Number(row.unitPrice || row.price || 0) * Math.max(1, Number(row.qty || 1))), 0) / totalQty
    : null;
  const uniqueUnits = [...new Set(history.map((row) => String(row.unit || 'ud').trim() || 'ud'))];
  const hasSingleUnit = uniqueUnits.length === 1;
  const unitLabel = hasSingleUnit ? uniqueUnits[0] : '';
  const latestLine = latest
    ? `Último: ${Number(latest.unitPrice || latest.price || 0).toFixed(2)} €/` + `${latest.unit || 'ud'} · Media: ${hasSingleUnit && Number.isFinite(weightedAvgUnitPrice) ? `${weightedAvgUnitPrice.toFixed(2)} €/` + unitLabel : '—'} · Compras: ${history.length}`
    : 'Último: — · Media: — · Compras: 0';
  const vendorAliases = food?.vendorAliases && typeof food.vendorAliases === 'object' ? food.vendorAliases : {};
  const vendorSet = new Set([...vendors, ...Object.keys(vendorAliases || {})]);
  const allVendors = [...vendorSet].filter(Boolean).sort((a, b) => a.localeCompare(b, 'es'));
  const latestByVendorMap = latestByVendor.reduce((acc, row) => ({ ...acc, [row.vendor]: row }), {});
  const explicitByVendor = explicitHistory.reduce((acc, row) => {
    const vendor = firebaseSafeKey(row.vendor || 'unknown') || 'unknown';
    if (!acc[vendor]) acc[vendor] = [];
    acc[vendor].push(row);
    return acc;
  }, {});
  const tableRows = allVendors.map((vendor) => {
    const latestVendor = latestByVendorMap[vendor] || null;
    const aliases = Array.isArray(vendorAliases[vendor]) ? vendorAliases[vendor] : [];
    const explicitRows = (explicitByVendor[vendor] || []).slice().sort((a, b) => b.ts - a.ts);
    return {
      vendor,
      aliases,
      aliasText: aliases.join(', '),
      latest: latestVendor,
      latestDateLabel: latestVendor ? new Date(latestVendor.ts).toLocaleDateString('es-ES') : '—',
      latestPriceLabel: latestVendor ? `${Number(latestVendor.unitPrice || latestVendor.price || 0).toFixed(2)} €/` + `${latestVendor.unit || 'ud'}` : '—',
      latestEntry: explicitRows[0] || null,
      hasExplicit: !!explicitRows.length
    };
  });
  return {
    name,
    displayName,
    history,
    byVendor,
    vendors,
    latest,
    latestByVendor,
    latestLine,
    chartByVendor: readCachedFoodChartSeries(history) || writeCachedFoodChartSeries(history, foodChartSeriesByVendor(history, 'total')),
    vendorAliases,
    tableRows
  };
}

function renderFoodPriceHistorySection(food = {}, options = {}) {
  const view = foodDetailViewModel(food, options?.presetName || '');
  const currentRows = view.tableRows.map((row) => `<tr data-food-vendor-row="${escapeHtml(row.vendor)}"><td><button type="button" class="finFoodLinkBtn" data-food-focus-vendor="${escapeHtml(row.vendor)}">${escapeHtml(row.vendor)}</button></td><td><button type="button" class="finFoodAliasBtn" data-food-alias-edit="${escapeHtml(row.vendor)}" data-food-current-alias="${escapeHtml(row.aliasText)}">${escapeHtml(row.aliasText || '—')}</button></td><td><strong>${row.latestPriceLabel}</strong></td><td>${row.latestDateLabel}</td><td><div class="finFoodTableActions"><button type="button" class="finFoodIconAction" data-food-price-add-vendor="${escapeHtml(row.vendor)}" aria-label="Registrar precio en ${escapeHtml(row.vendor)}">＋</button>${row.latestEntry ? `<button type="button" class="finFoodIconAction finFoodIconAction--danger" data-food-price-delete="${escapeHtml(row.vendor)}:${escapeHtml(row.latestEntry.entryId || '')}" aria-label="Borrar último registro de ${escapeHtml(row.vendor)}">🗑</button>` : ''}</div></td></tr>`).join('');
  const vendorChips = view.vendors.map((vendor) => `<span class="finFoodChip">${escapeHtml(vendor)}</span>`).join('') || '<span class="finFoodChip">Sin vendor</span>';
  const overviewSub = [food?.mealType || 'Sin categoría', view.vendors.length ? `${view.vendors.length} vendor${view.vendors.length > 1 ? 's' : ''}` : 'Sin vendors', view.latestLine].join(' · ');
  const vendorOptions = ['unknown', ...new Set(view.tableRows.map((row) => row.vendor))].map((vendor) => `<option value="${escapeHtml(vendor)}">${escapeHtml(vendor)}</option>`).join('');
  return `
    <section class="finFoodDetailHead finFoodCard">
      <div class="finFoodCardTitleRow">
        <div>
          <h2>🍽️ ${escapeHtml(view.displayName)}</h2>
          <p>${escapeHtml(overviewSub)}</p>
        </div>
        <button type="button" class="food-history-btn" data-food-open-edit="${escapeHtml(food.id || '')}">Editar</button>
      </div>
    </section>

    <section class="finFoodDetailSection finFoodDetailSection--chips finFoodCard">
      <button type="button" class="finFoodChip finFoodChip--action" data-food-scroll-to="aliases">Aliases</button>
      <button type="button" class="finFoodChip finFoodChip--action" data-food-toggle-register>+ Precio</button>
      <button type="button" class="finFoodChip finFoodChip--action" data-food-view-purchases="${escapeHtml(food.id || '')}">Ver compras</button>
    </section>

    <section class="finFoodDetailSection finFoodCard" data-food-detail-card="evolution">
      <div class="finFoodCardTitleRow"><h4>Evolución</h4><div class="finFoodMiniTabs"><button type="button" class="finFoodMiniTab is-active" data-food-chart-type="line">Línea</button><button type="button" class="finFoodMiniTab" data-food-chart-type="bar">Barras</button></div></div>
      <div class="finFoodMiniTabs" data-food-vendor-legend></div>
      <div class="finFoodMiniTabs" data-food-range-tabs><button type="button" class="finFoodMiniTab" data-food-chart-range="30d">30d</button><button type="button" class="finFoodMiniTab" data-food-chart-range="90d">90d</button><button type="button" class="finFoodMiniTab is-active" data-food-chart-range="total">Total</button></div>
      ${view.history.length
        ? `<div class="finFoodInfo__chartWrap" data-food-history-chart data-food-chart-type="line" data-food-chart-range="total" data-food-history-series='${escapeHtml(JSON.stringify(view.chartByVendor))}'></div>`
        : '<div class="finFoodInfo__chartWrap finFoodInfo__chartWrap--empty"><span>Sin historial. Registra un precio para ver evolución.</span></div>'}
    </section>

    <section class="finFoodDetailSection finFoodCard" data-food-detail-card="prices">
      <div class="finFoodCardTitleRow"><h4>Precios</h4><button type="button" class="food-history-btn" data-food-toggle-register>+ registrar precio</button></div>
      <div class="finFoodInlineRegister" data-food-register-inline hidden>
        <div class="food-form-grid finFoodRegisterGrid">
          <div class="food-form-row"><label class="food-form-label" for="food-register-vendor">Supermercado</label><select id="food-register-vendor" class="food-control" data-food-register-vendor><option value="">Seleccionar</option>${vendorOptions}</select></div>
          <div class="food-form-row"><label class="food-form-label" for="food-register-price">Precio</label><input id="food-register-price" class="food-control" type="number" min="0" step="0.01" data-food-register-price placeholder="0.00" /></div>
          <div class="food-form-row"><label class="food-form-label" for="food-register-date">Fecha</label><input id="food-register-date" class="food-control" type="date" data-food-register-date value="${escapeHtml(dayKeyFromTs(nowTs()))}" /></div>
          <div class="food-form-row finFoodRegisterAction"><button type="button" class="food-history-btn" data-food-register-submit="${escapeHtml(food.id || '')}">Guardar precio</button></div>
        </div>
      </div>
      ${view.tableRows.length
        ? `<div class="finFoodPriceTableWrap"><table class="finFoodPriceTable"><thead><tr><th>Supermercado</th><th>Alias</th><th>Último precio</th><th>Fecha</th><th>Acciones</th></tr></thead><tbody>${currentRows}</tbody></table></div>`
        : '<div class="finFoodInfo__chartWrap finFoodInfo__chartWrap--empty"><span>Sin historial</span></div>'}
    </section>

    <details class="finFoodDetailSection finFoodCard" data-food-detail-card="data">
      <summary class="finFoodDetailSummary">Datos</summary>
      <div class="finFoodDetailBody food-form-grid foodX-stack">
      
      <div class="meta-vista-detalle-producto">
        <div class="food-form-row"><label class="food-form-label" for="food-name-input">Nombre</label><input id="food-name-input" class="food-control" name="name" required value="${escapeHtml(food?.name || options?.presetName || '')}" /></div>        
        <div class="food-form-row"><label class="food-form-label" for="food-displayName-input">Display name</label><input id="food-displayName-input" class="food-control" name="displayName" value="${escapeHtml(food?.displayName || options?.presetName || '')}" data-food-display-name /></div>       
        <div class="food-form-row"><label class="food-form-label" for="food-defaultPrice-input">Precio</label><input id="food-defaultPrice-input" class="food-control" name="defaultPrice" type="number" step="0.01" min="0" value="${Number(food?.defaultPrice || 0) || ''}" /></div>
      </div>

      <div class= "selectores-ficha-detalle-producto">
        <div class="food-form-row"><label class="food-form-label" for="food-mealType-input">Categoría <button type="button" class="finFoodLabelAction" data-food-add="typeOfMeal">+ Añadir</button></label><select id="food-mealType-input" class="food-control" name="mealType"><option value="">Seleccionar</option>${foodOptionList('typeOfMeal').map((name) => `<option value="${escapeHtml(name)}" ${name === (food?.mealType || '') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div>        
        <div class="food-form-row"><label class="food-form-label" for="food-cuisine-input">Saludable <button type="button" class="finFoodLabelAction" data-food-add="cuisine">+ Añadir</button></label><select id="food-cuisine-input" class="food-control" name="cuisine"><option value="">Seleccionar</option>${foodOptionList('cuisine').map((name) => `<option value="${escapeHtml(name)}" ${name === (food?.cuisine || food?.healthy || '') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div>
        <div class="food-form-row"><label class="food-form-label" for="food-place-input">Dónde <button type="button" class="finFoodLabelAction" data-food-add="place">+ Añadir</button></label><select id="food-place-input" class="food-control" name="place"><option value="">Seleccionar</option>${foodOptionList('place').map((name) => `<option value="${escapeHtml(name)}" ${name === (food?.place || '') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select></div>
      </div>  
        </div>
    </details>

    <details class="finFoodDetailSection finFoodCard" data-food-detail-card="aliases" id="food-detail-aliases">
      <summary class="finFoodDetailSummary">Aliases</summary>
      <div class="finFoodDetailBody">
        ${renderFoodAliasEditor(food || {})}
        <div class="food-form-row"><label class="food-form-label" for="food-vendorAliases-input">Alias por súper</label><input id="food-vendorAliases-input" class="food-control" name="vendorAliases" value="${escapeHtml(options.vendorAliasList || '')}" placeholder="mercadona:coca cola|coke" /></div>
        <div class="finFoodAliasPicker">
          <div class="food-form-row"><label class="food-form-label" for="food-alias-canonical-picker">Producto existente</label><input id="food-alias-canonical-picker" class="food-control" type="search" list="food-alias-canonical-list" placeholder="Buscar canonical" data-food-alias-canonical-picker /></div>
          <div class="food-form-row"><label class="food-form-label" for="food-alias-vendor-picker">Supermercado</label><input id="food-alias-vendor-picker" class="food-control" type="search" list="food-alias-vendor-list" placeholder="Buscar vendor" data-food-alias-vendor-picker /></div>
          <button type="button" class="food-history-btn" data-food-alias-associate="${escapeHtml(food?.id || '')}" ${food?.id ? '' : 'disabled'}>Asociar</button>
          <datalist id="food-alias-canonical-list">${Object.values(state.food.itemsById || {}).map((item) => `<option value="${escapeHtml(item.id || '')}">${escapeHtml(item.displayName || item.name || item.id || '')}</option>`).join('')}</datalist>
          <datalist id="food-alias-vendor-list">${[...new Set(Object.keys(view.byVendor || {}).concat(Object.keys(view.vendorAliases || {})))].filter(Boolean).sort((a,b)=>a.localeCompare(b,'es')).map((vendor) => `<option value="${escapeHtml(vendor)}"></option>`).join('')}</datalist>
        </div>
        <div class="finFoodChipRow">${vendorChips}</div>
      </div>
    </details>
  `;
}

function renderFoodAliasEditor(editing = {}) {
  const aliases = Array.isArray(editing?.aliases) ? editing.aliases : [];
  return `<div class="finFoodAliasEditor" data-food-alias-editor>
    <input type="hidden" name="aliases" value="${escapeHtml(aliases.join(', '))}" data-food-aliases-hidden />
    <div class="finFoodChipRow" data-food-aliases-chips>${aliases.map((alias, index) => `<button type="button" class="finFoodChip finFoodChip--remove" data-food-alias-remove="${index}">${escapeHtml(alias)} ×</button>`).join('') || '<span class="finFoodChip">Sin alias</span>'}</div>
    <div class="food-form-inline"><input class="food-control" type="text" data-food-alias-input placeholder="Añadir alias" /><button type="button" class="finFoodInlineAddBtn" data-food-alias-add>➕</button></div>
  </div>`;
}

function renderFoodItemModalForm(editing, presetName, mode = 'edit') {
  const isDetail = mode === 'detail';
  const isInfo = mode === 'info' || isDetail;
  const displayName = String(editing?.displayName || presetName || '');
  const vendorAliasList = editing?.vendorAliases && typeof editing.vendorAliases === 'object'
    ? Object.entries(editing.vendorAliases).map(([vendor, list]) => `${vendor}:${Array.isArray(list) ? list.join('|') : ''}`).join(', ')
    : '';
  const detailBody = renderFoodPriceHistorySection(editing || { name: presetName, displayName }, { presetName, vendorAliasList });
  return `<form class="food-sheet-form" data-food-item-form data-food-item-mode="${isDetail ? 'detail' : (isInfo ? 'info' : 'edit')}">
        <input type="hidden" name="foodId" value="${escapeHtml(editing?.id || '')}" />
        ${isDetail ? detailBody : `
        <section class="finFoodDetailSection">
          <h4>Header</h4>
          <div class="food-form-grid foodX-stack">
            <div class="food-form-row"><label class="food-form-label" for="food-name-input">Nombre</label><input id="food-name-input" class="food-control" name="name" required value="${escapeHtml(presetName)}" /></div>
            <div class="food-form-row"><label class="food-form-label" for="food-displayName-input">Display name</label><input id="food-displayName-input" class="food-control" name="displayName" value="${escapeHtml(displayName)}" data-food-display-name /></div>
          </div>
        </section>
        <details class="finFoodDetailSection finFoodDetailSection--aliases">
  <summary class="finFoodDetailSummary">
    Aliases
  </summary>

  <div class="finFoodDetailBody">
    ${renderFoodAliasEditor(editing || {})}

    <div class="food-form-row">
      <label class="food-form-label" for="food-vendorAliases-input">
        Alias por súper
      </label>

      <input
        id="food-vendorAliases-input"
        class="food-control"
        name="vendorAliases"
        value="${escapeHtml(vendorAliasList)}"
        placeholder="mercadona:coca cola|coke"
      />
    </div>
  </div>
</details>
        <section class="finFoodDetailSection">
          <h4>Atributos</h4>
          <div class="food-form-grid foodX-stack">
            <div class="food-form-row"><label class="food-form-label" for="food-mealType-input">Tipo</label><div class="food-form-inline"><select id="food-mealType-input" class="food-control" name="mealType"><option value="">Seleccionar</option>${foodOptionList('typeOfMeal').map((name) => `<option value="${escapeHtml(name)}" ${name === (editing?.mealType || '') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="food-mini-btn" data-food-add="typeOfMeal" aria-label="Añadir nuevo tipo">+</button></div></div>
            <div class="food-form-row"><label class="food-form-label" for="food-cuisine-input">Saludable</label><div class="food-form-inline"><select id="food-cuisine-input" class="food-control" name="cuisine"><option value="">Seleccionar</option>${foodOptionList('cuisine').map((name) => `<option value="${escapeHtml(name)}" ${name === (editing?.cuisine || editing?.healthy || '') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="food-mini-btn" data-food-add="cuisine" aria-label="Añadir nuevo saludable">+</button></div></div>
            <div class="food-form-row"><label class="food-form-label" for="food-place-input">Dónde</label><div class="food-form-inline"><select id="food-place-input" class="food-control" name="place"><option value="">Seleccionar</option>${foodOptionList('place').map((name) => `<option value="${escapeHtml(name)}" ${name === (editing?.place || '') ? 'selected' : ''}>${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="food-mini-btn" data-food-add="place" aria-label="Añadir nuevo dónde">+</button></div></div>
            <div class="food-form-row"><label class="food-form-label" for="food-defaultPrice-input">Precio por defecto</label><input id="food-defaultPrice-input" class="food-control" name="defaultPrice" type="number" step="0.01" min="0" value="${Number(editing?.defaultPrice || 0) || ''}" /></div>
          </div>
        </section>
        ${isInfo ? `<input type="hidden" name="saveMode" value="info" />${detailBody}` : ''}`}
        <footer class="food-sheet-footer"><button class="finance-pill food-sheet-submit" type="submit" ${isDetail ? 'data-food-save disabled' : ''}>Guardar</button></footer>
      </form>`;
}

async function renderFoodHistoryVendorChart() {
  const host = document.querySelector('[data-food-history-chart]');
  if (!host) return;
  if (typeof echarts === 'undefined') {
    try {
      await ensureFinanceEchartsReady();
    } catch (error) {
      console.warn('[finance] no se pudo cargar ECharts para food history', error);
      return;
    }
  }
  let byVendor = {};
  try { byVendor = JSON.parse(host.dataset.foodHistorySeries || '{}'); } catch (_) { byVendor = {}; }
  const vendorKeys = Object.keys(byVendor || {});
  if (!vendorKeys.length) return;
  const chartType = host.dataset.foodChartType === 'bar' ? 'bar' : 'line';
  const range = host.dataset.foodChartRange || 'total';
  const points = Object.entries(byVendor).flatMap(([vendor, rows]) => (rows || []).map((row) => ({ ...row, vendor })));
  const filtered = foodChartSeriesByVendor(points, range);
  const vendors = Object.keys(filtered);
  if (!vendors.length) return;
  const hiddenVendors = new Set(String(host.dataset.foodHiddenVendors || '').split(',').map((v) => firebaseSafeKey(v || '')).filter(Boolean));
  const palette = ['#7dbdff', '#7af0c8', '#f9b571', '#dba4ff', '#ff7d9f', '#ffe082'];
  const legendHost = document.querySelector('[data-food-vendor-legend]');
  if (legendHost) {
    legendHost.innerHTML = vendors.map((vendor, index) => {
      const isHidden = hiddenVendors.has(vendor);
      return `<button type="button" class="finFoodMiniTab ${isHidden ? '' : 'is-active'}" data-food-vendor-toggle="${escapeHtml(vendor)}" style="--vendor-color:${palette[index % palette.length]}">${escapeHtml(vendor)}</button>`;
    }).join('');
  }
  const series = vendors.map((vendor, index) => ({
    name: vendor,
    type: chartType,
    showSymbol: chartType === 'line',
    smooth: false,
    lineStyle: { width: 2 },
    itemStyle: { color: palette[index % palette.length] },
    data: hiddenVendors.has(vendor) ? [] : (filtered[vendor] || []).map((row) => [String(row.date || dayKeyFromTs(row.ts)), Number(row.unitPrice || row.price || 0), row])
  }));
  const chart = echarts.getInstanceByDom(host) || echarts.init(host);
chart.setOption({
  animation: false,
  backgroundColor: 'transparent',
  tooltip: {
    trigger: 'axis',
    confine: true,
    borderRadius: 10,
    padding: [6, 8],
    backgroundColor: '#0d1329',
    borderColor: 'rgba(125,190,255,.35)',
    textStyle: { color: '#f4f8ff', fontSize: 11 },
    formatter: (points = []) => {
      if (!points.length) return '';
      const date = points[0]?.axisValueLabel || '';
      const lines = points.map((point) => {
        const payload = point?.data?.[2] || {};
        const unit = payload?.unit || 'ud';
        const qty = Number(payload?.qty || 1);
        const total = Number(payload?.totalPrice || payload?.linePrice || 0);
        return `${point.marker}${point.seriesName}: <strong>${Number(point.value?.[1] || 0).toFixed(2)} €/` + `${unit}</strong><br/><small>qty: ${qty} · total: ${fmtCurrency(total)}</small>`;
      });
      return `<strong>${date}</strong><br/>${lines.join('<br/>')}`;
    }
  },
  legend: { show: false },

  grid: { left: 36, right: 16, top: 18, bottom: 34, containLabel: true },

  xAxis: {
    type: 'time',
    axisLabel: {
      color: '#9fb2da',
      hideOverlap: true,
      interval: 'auto',
      margin: 10,
      formatter: (v) => {
        const d = new Date(v);
        return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`;
      }
    },
    axisTick: { show: false },
    splitLine: { show: false }
  },

  yAxis: {
    type: 'value',
    axisLabel: { color: '#9fb2da', margin: 10, fontSize: 11 },
    axisTick: { show: false },
    splitLine: { show: false } // 👈 adiós líneas intermedias
  },

  series
}, { notMerge: true });
}

function snapshotFoodDetailForm(formEl) {
  if (!formEl) return '{}';
  const fd = new FormData(formEl);
  const keys = ['foodId', 'name', 'displayName', 'aliases', 'vendorAliases', 'mealType', 'cuisine', 'place', 'defaultPrice'];
  const snap = keys.reduce((acc, key) => {
    acc[key] = String(fd.get(key) || '').trim();
    return acc;
  }, {});
  return JSON.stringify(snap);
}

function updateFoodDetailSaveState(formEl) {
  if (!formEl || formEl.dataset.foodItemMode !== 'detail') return;
  const saveBtn = formEl.querySelector('[data-food-save]');
  if (!saveBtn) return;
  if (!formEl.dataset.foodInitialSnapshot) formEl.dataset.foodInitialSnapshot = snapshotFoodDetailForm(formEl);
  const dirty = formEl.dataset.foodInitialSnapshot !== snapshotFoodDetailForm(formEl);
  saveBtn.disabled = !dirty;
}

function initFoodDetailInteractions() {
  const formEl = document.querySelector('[data-food-item-form][data-food-item-mode="detail"]');
  if (!formEl) return;
  formEl.dataset.foodInitialSnapshot = snapshotFoodDetailForm(formEl);
  updateFoodDetailSaveState(formEl);
}

function isoToDay(dateISO = '') { return String(dateISO).slice(0, 10); }

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_KEY, generated);
  return generated;
}

function calendarAnchorDate() {
  const date = new Date();
  date.setMonth(date.getMonth() + state.calendarMonthOffset);
  return date;
}

function calendarSourceSeries(accounts, totalSeries) {
  if (state.calendarAccountId === 'total') return totalSeries.map((point, idx, arr) => ({ ...point, delta: idx ? point.value - arr[idx - 1].value : 0 }));
  return accounts.find((acc) => acc.id === state.calendarAccountId)?.daily || [];
}

function closePointBefore(series, tsExclusive) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].ts < tsExclusive) return series[i];
  }
  return null;
}

function deltaByBounds(series, startTs, endTs) {
  const prev = closePointBefore(series, startTs);
  const end = closePointBefore(series, endTs);
  if (!prev && !end) return { delta: 0, deltaPct: 0, isEmpty: true };
  const startValue = Number(prev?.value ?? end?.value ?? 0);
  const endValue = Number(end?.value ?? startValue);
  const delta = endValue - startValue;
  const deltaPct = startValue ? (delta / startValue) * 100 : 0;
  return { delta, deltaPct, isEmpty: false };
}

function safeFirebase(action, fallback = null) {
  return action().catch((error) => {
    log('firebase error', error);
    toast('No se pudo guardar en Firebase');
    return fallback;
  });
}

function normalizeDaily(daily = {}) {
  return Object.entries(daily).map(([day, record]) => ({ day, ts: Number(record?.ts || parseDayKey(day)), value: Number(record?.value || 0) }))
    .filter((item) => Number.isFinite(item.value) && item.day).sort((a, b) => a.ts - b.ts);
}
function normalizeSnapshots(snapshots = {}) {
  return Object.entries(snapshots || {}).map(([day, row]) => ({ day, value: Number(row?.value), updatedAt: Number(row?.updatedAt || 0) }))
    .filter((row) => row.day && Number.isFinite(row.value)).sort((a, b) => parseDayKey(a.day) - parseDayKey(b.day));
}
function movementRowsByAccount(accountId) {
  return balanceTxList().filter((row) => row.accountId === accountId);
}
async function recomputeAccountEntries(accountId, fromDay, rootOverride = null) {
  if (!accountId) return;
  const root = rootOverride && typeof rootOverride === 'object' ? rootOverride : await loadFinanceRoot();
  const account = root.accounts?.[accountId] || state.accounts.find((item) => item.id === accountId);
  if (!account) return;
  const snapshots = normalizeSnapshots(account.snapshots || {});
  const txRows = collectBalanceRowsFromRoot(root, state.financePath).filter((row) => (
    row.accountId === accountId || row.fromAccountId === accountId || row.toAccountId === accountId
  ));
  const movements = txRows.sort((a, b) => txSortTs(a) - txSortTs(b));
  const daySet = new Set([
    ...snapshots.map((row) => row.day),
    ...movements.map((row) => String(row.date || isoToDay(row.dateISO || '')))
  ].filter(Boolean));
  if (fromDay) daySet.add(fromDay);
  const allDays = [...daySet].sort();
  if (!allDays.length) return;
  const normalizedFromDay = toIsoDay(fromDay || '') || fromDay;
  const startDay = normalizedFromDay || allDays[0];
  financeDebug('recompute account entries', { accountId, startDay, txCount: movements.length });

  const dayEvents = {};
  movements.forEach((row) => {
    const day = String(row.date || isoToDay(row.dateISO || ''));
    if (!day) return;
    let delta = 0;
    if (row.type === 'income' && row.accountId === accountId) delta = Number(row.amount || 0);
    else if (row.type === 'expense' && row.accountId === accountId) delta = -Number(row.amount || 0);
    else if (row.type === 'transfer') {
      if (row.fromAccountId === accountId) delta = -Number(row.amount || 0);
      if (row.toAccountId === accountId) delta += Number(row.amount || 0);
    }
    if (!delta) return;
    if (!dayEvents[day]) dayEvents[day] = [];
    const ts = Number(row.ts || row.timestamp || row.createdAt || row.updatedAt || 0);
    dayEvents[day].push({ kind: 'tx', ts: Number.isFinite(ts) ? ts : 0, delta });
  });
  snapshots.forEach((row) => {
    if (!dayEvents[row.day]) dayEvents[row.day] = [];
    const ts = Number(row.updatedAt || 0);
    dayEvents[row.day].push({ kind: 'snapshot', ts: Number.isFinite(ts) && ts > 0 ? ts : Number.MAX_SAFE_INTEGER, value: row.value });
  });

  const existingEntries = account.entries || account.daily || {};
  let carry = 0;
  const prevDays = Object.keys(existingEntries).filter((day) => day < startDay).sort();
  if (prevDays.length) carry = Number(existingEntries[prevDays.at(-1)]?.value || 0);
  else {
    const prevSnapshot = snapshots.filter((row) => row.day < startDay).at(-1);
    if (prevSnapshot) carry = prevSnapshot.value;
  }

  const updatesMap = {};
  const targetDays = allDays.filter((day) => day >= startDay);
  targetDays.forEach((day) => {
    let value = carry;
    const events = (dayEvents[day] || []).sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.kind === b.kind) return 0;
      return a.kind === 'tx' ? -1 : 1;
    });
    if (!events.length) {
      value = carry;
    } else {
      events.forEach((event) => {
        if (event.kind === 'snapshot') value = Number(event.value || 0);
        else value += Number(event.delta || 0);
      });
    }
    carry = value;
    updatesMap[`${state.financePath}/accounts/${accountId}/entries/${day}`] = {
      dateISO: `${day}T00:00:00.000Z`,
      value,
      updatedAt: nowTs(),
      source: events.some((event) => event.kind === 'snapshot') ? 'snapshot' : 'derived'
    };
  });
  updatesMap[`${state.financePath}/accounts/${accountId}/updatedAt`] = nowTs();
  await safeFirebase(() => update(ref(db), updatesMap));
}
function normalizeLegacyEntries(entriesMap = {}) {
  const grouped = {};
  Object.values(entriesMap || {}).forEach((entry) => {
    const ts = Number(entry?.ts || 0);
    const value = Number(entry?.value);
    if (!Number.isFinite(ts) || !Number.isFinite(value)) return;
    const day = dayKeyFromTs(ts);
    if (!grouped[day] || grouped[day].ts < ts) grouped[day] = { ts, value };
  });
  return grouped;
}

function getRangeBounds(mode, anchorDate = new Date()) {
  const now = new Date(anchorDate);
  if (mode === 'total') return { start: -Infinity, end: Infinity };
  if (mode === 'week') {
    const day = now.getDay() || 7;
    const start = new Date(now); start.setDate(now.getDate() - day + 1); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(start.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() };
  }
  if (mode === 'year') return { start: new Date(now.getFullYear(), 0, 1).getTime(), end: new Date(now.getFullYear() + 1, 0, 1).getTime() };
  return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime() };
}
function computeDeltaForRange(series, mode) {
  if (!series.length) return { delta: 0, deltaPct: 0, startValue: 0, endValue: 0 };
  const { start, end } = getRangeBounds(mode);
  const startPoint = series.find((point) => point.ts >= start) || series[0];
  const endPoint = [...series].reverse().find((point) => point.ts < end) || series.at(-1);
  const delta = endPoint.value - startPoint.value;
  const deltaPct = startPoint.value ? (delta / startPoint.value) * 100 : 0;
  return { delta, deltaPct, startValue: startPoint.value, endValue: endPoint.value };
}
function computeDeltaWithinBounds(series, bounds) {
  if (!series.length) return { delta: 0, deltaPct: 0, startValue: 0, endValue: 0 };
  const startPoint = series.find((point) => point.ts >= bounds.start) || series[0];
  const endPoint = [...series].reverse().find((point) => point.ts < bounds.end) || series.at(-1);
  const delta = endPoint.value - startPoint.value;
  const deltaPct = startPoint.value ? (delta / startPoint.value) * 100 : 0;
  return { delta, deltaPct, startValue: startPoint.value, endValue: endPoint.value };
}

function accountValueForDay(account = {}, day = '') {
  const safeDay = toIsoDay(day) || String(day || '').slice(0, 10);
  if (!safeDay) return 0;
  const snapshots = normalizeSnapshots(account.snapshots || {});
  const exactSnapshot = snapshots.find((row) => row.day === safeDay);
  if (exactSnapshot) return Number(exactSnapshot.value || 0);
  const previousSnapshot = snapshots.filter((row) => row.day < safeDay).at(-1);
  if (previousSnapshot) return Number(previousSnapshot.value || 0);
  const entries = normalizeDaily(account.entries || account.daily || {});
  const prevEntry = entries.filter((row) => row.day <= safeDay).at(-1);
  return Number(prevEntry?.value || 0);
}

function readCachedBtcPrice() {
  try {
    const raw = localStorage.getItem(BTC_PRICE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Number.isFinite(parsed?.price) || !Number.isFinite(parsed?.ts)) return null;
    if ((Date.now() - parsed.ts) > BTC_PRICE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function ensureBtcEurPrice(force = false) {
  const cached = readCachedBtcPrice();
  if (!force && cached) {
    const nextPrice = Number(cached.price || 0);
    if (state.btcEurPrice !== nextPrice) clearFinanceDerivedCaches();
    state.btcEurPrice = nextPrice;
    state.btcPriceTs = Number(cached.ts || 0);
    return state.btcEurPrice;
  }
  try {
    const res = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=eur');
    const json = await res.json();
    const price = Number(json?.bitcoin?.eur || 0);
    if (Number.isFinite(price) && price > 0) {
      if (state.btcEurPrice !== price) clearFinanceDerivedCaches();
      state.btcEurPrice = price;
      state.btcPriceTs = Date.now();
      localStorage.setItem(BTC_PRICE_CACHE_KEY, JSON.stringify({ price, ts: state.btcPriceTs }));
      return price;
    }
  } catch (error) {
    log('btc price fetch failed', error);
  }
  if (cached?.price) {
    const nextPrice = Number(cached.price);
    if (state.btcEurPrice !== nextPrice) clearFinanceDerivedCaches();
    state.btcEurPrice = nextPrice;
    state.btcPriceTs = Number(cached.ts || 0);
  }
  return state.btcEurPrice || 0;
}

function buildAccountModels() {
  const cache = financeDerivedCache.accountModels;
  if (
    cache.accountsRef === state.accounts &&
    cache.legacyEntriesRef === state.legacyEntries &&
    cache.btcEurPrice === state.btcEurPrice &&
    cache.rangeMode === state.rangeMode
  ) {
    return cache.rows;
  }

  const rows = state.accounts.map((account) => {
    const share = normalizeAccountShare(account);


    const sourceEntries = Object.keys(account.entries || {}).length ? (account.entries || {}) : (account.daily || {});
    const modernDaily = normalizeDaily(sourceEntries);
    const modernByDay = Object.fromEntries(modernDaily.map((item) => [item.day, { value: item.value, ts: item.ts, source: item.source || 'derived' }]));
    const legacyDaily = normalizeLegacyEntries(state.legacyEntries[account.id] || {});
    Object.entries(legacyDaily).forEach(([day, record]) => {
      if (!modernByDay[day] || modernByDay[day].ts < record.ts) modernByDay[day] = { ...record, source: 'legacy' };
    });
    const dailyReal = Object.entries(modernByDay).map(([day, record]) => ({ day, ts: Number(record.ts || parseDayKey(day)), value: Number(record.value || 0), source: record.source || 'derived' }))
      .sort((a, b) => a.ts - b.ts);
    const btcUnits = Number(account?.btcUnits || 0);
    const btcPrice = Number(state.btcEurPrice || 0);
    const hasBtc = Boolean(account?.isBitcoin);
    let currentReal = dailyReal.at(-1)?.value ?? 0;
    if (hasBtc) currentReal = btcUnits * btcPrice;
    const current = currentReal * share.sharedRatio;



    const daily = dailyReal.map((point, index, arr) => {
      const prev = arr[index - 1];
      const myValue = point.value * share.sharedRatio;
      const prevValue = prev ? prev.value * share.sharedRatio : 0;
      const delta = prev ? myValue - prevValue : 0;
      const deltaPct = prevValue ? (delta / prevValue) * 100 : 0;
      return { ...point, value: myValue, realValue: point.value, delta, deltaPct };
    });
    const range = computeDeltaForRange(daily, state.rangeMode);
    
    if (share.shared) log(`account sharedRatio=${share.sharedRatio} applied`, { accountId: account.id });

    return { ...account, ...share, daily, dailyReal, current, currentReal, btcPrice, range, };
  });

  cache.accountsRef = state.accounts;
  cache.legacyEntriesRef = state.legacyEntries;
  cache.btcEurPrice = state.btcEurPrice;
  cache.rangeMode = state.rangeMode;
  cache.rows = rows;
  return rows;
}

function buildTotalSeries(accounts) {
  const cache = financeDerivedCache.totalSeries;
  if (cache.accountsRef === accounts) {
    return cache.rows;
  }
  const daySet = new Set();
  accounts.forEach((account) => account.daily.forEach((point) => daySet.add(point.day)));
  const days = [...daySet].sort();
  if (!days.length) {
    cache.accountsRef = accounts;
    cache.rows = [];
    return cache.rows;
  }
  const perAccount = Object.fromEntries(accounts.map((account) => [account.id, Object.fromEntries(account.daily.map((p) => [p.day, p.value]))]));
  const running = Object.fromEntries(accounts.map((account) => [account.id, 0]));
  cache.accountsRef = accounts;
  cache.rows = days.map((day) => {
    accounts.forEach((account) => { if (perAccount[account.id][day] != null) running[account.id] = perAccount[account.id][day]; });
    return { day, ts: parseDayKey(day), value: Object.values(running).reduce((sum, val) => sum + Number(val || 0), 0) };
  });
  return cache.rows;
}
function filterSeriesByRange(series, mode) {
  if (mode === 'total') return series;
  const { start, end } = getRangeBounds(mode);
  const filtered = series.filter((point) => point.ts >= start && point.ts < end);
  return filtered.length ? filtered : series.slice(-1);
}
function chartModelForRange(series, mode) {
  const points = filterSeriesByRange(series, mode);
  const delta = computeDeltaForRange(points.map((point) => ({ ...point, value: point.value })), 'total').delta;
  return { points, tone: toneClass(delta) };
}

const FINANCE_TOTALS_CACHE_KEY = 'bookshell:finance:totals:v1';

function emitFinanceData(reason = '') {
  try {
    window.dispatchEvent(new CustomEvent('bookshell:data', { detail: { source: 'finance', reason } }));
    return;
  } catch (_) {}
  try { window.dispatchEvent(new Event('bookshell:data')); } catch (_) {}
}

function syncFinanceAchievementsApi() {
  try {
    window.__bookshellFinance = {
      getAchievementsSnapshot: () => ({
        accounts: Object.fromEntries((state.accounts || []).map((account) => [account.id, account])),
        transactions: state.balance?.transactions || {},
        budgets: state.balance?.budgets || {},
        goals: state.goals || { goals: {} },
      }),
    };
  } catch (_) {}
}

function publishFinanceTotals(accounts = []) {
  const myTotal = accounts.reduce((sum, account) => sum + Number(account.current || 0), 0);
  const totalReal = accounts.reduce((sum, account) => sum + Number(account.currentReal || 0), 0);
  const payload = { myTotal, totalReal, ts: Date.now() };
  try { localStorage.setItem(FINANCE_TOTALS_CACHE_KEY, JSON.stringify(payload)); } catch (_) {}
  try { window.__bookshellFinanceTotals = payload; } catch (_) {}
  try { window.dispatchEvent(new CustomEvent('bookshell:finance-totals', { detail: payload })); } catch (_) {}
}

async function maybeAutoBitcoinDailySnapshots(accounts = []) {
  const btcPrice = Number(state.btcEurPrice || 0);
  if (!Number.isFinite(btcPrice) || btcPrice <= 0) return;

  const todayKey = dayKeyFromTs(Date.now());
  if (!todayKey) return;

  const candidates = (accounts || []).filter((acc) => Boolean(acc?.isBitcoin));
  for (const account of candidates) {
    const btcUnits = Number(account?.btcUnits || 0);
    if (!Number.isFinite(btcUnits) || btcUnits <= 0) continue;

    const snapshots = account?.snapshots || {};
    const hasSnapshotToday = !!snapshots?.[todayKey] || normalizeSnapshots(snapshots).some((row) => row.day === todayKey);
    if (hasSnapshotToday) continue;

    const value = Math.round((btcUnits * btcPrice) * 100) / 100;
    if (!Number.isFinite(value) || value <= 0) continue;

    await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${account.id}/snapshots/${todayKey}`), {
      value,
      updatedAt: nowTs(),
      source: 'btcAuto',
      btcUnits,
      btcEurPrice: btcPrice
    }));

    await recomputeAccountEntries(account.id, todayKey);
  }
}

function ensureLineChartTooltip(container) {
  if (!container) return null;
  let node = container.querySelector('.finance-lineChart-tooltip');
  if (!node) {
    node = document.createElement('div');
    node.className = 'finance-lineChart-tooltip';
    container.appendChild(node);
  }
  return node;
}

function ensureLineChartDot(container) {
  if (!container) return null;
  let node = container.querySelector('.finance-lineChart-dot');
  if (!node) {
    node = document.createElement('div');
    node.className = 'finance-lineChart-dot';
    container.appendChild(node);
  }
  return node;
}

function closestLineChartPoint(points, chartEl, clientX) {
  if (!points?.length || !chartEl) return null;
  const rect = chartEl.getBoundingClientRect();
  const relX = Math.min(Math.max(0, (clientX || 0) - rect.left), rect.width || 0);
  const ratio = rect.width ? relX / rect.width : 0;
  const idx = Math.round(ratio * Math.max(points.length - 1, 0));
  const point = points[idx] || null;
  return point ? { point, idx } : null;
}

function lineChartCoords(points = [], idx = 0, width = 320, height = 120, pad = 10) {
  const safeIdx = Math.max(0, Math.min(idx, Math.max(points.length - 1, 0)));
  const vals = points.map((p) => Number(p?.value || 0));
  const min = vals.length ? Math.min(...vals) : 0;
  const max = vals.length ? Math.max(...vals) : 0;
  const spread = max - min || 1;
  const innerH = Math.max(1, height - pad * 2);
  const x = (safeIdx / Math.max(points.length - 1, 1)) * width;
  const v = Number(points[safeIdx]?.value || 0);
  const y = pad + (innerH - ((v - min) / spread) * innerH);
  return { x, y, width, height };
}

function showLineChartPoint(chartEl, point, idx, points) {
  if (!chartEl || !point) return;
  const tooltip = ensureLineChartTooltip(chartEl);
  const dot = ensureLineChartDot(chartEl);
  if (!tooltip) return;
  tooltip.textContent = `${new Date(point.ts).toLocaleDateString('es-ES')} - ${fmtCurrency(point.value)}`;
  tooltip.classList.add('is-open');
  clearTimeout(tooltip.__hideTimer);
  tooltip.__hideTimer = setTimeout(() => tooltip.classList.remove('is-open'), 1400);

  if (dot && Array.isArray(points) && Number.isFinite(Number(idx))) {
    const svg = chartEl.querySelector('svg');
    const svgRect = svg?.getBoundingClientRect?.();
    const chartRect = chartEl.getBoundingClientRect();
    if (svgRect?.width && svgRect?.height && chartRect?.width && chartRect?.height) {
      const { x, y } = lineChartCoords(points, idx);
      const left = (svgRect.left - chartRect.left) + (x / 320) * svgRect.width;
      const top = (svgRect.top - chartRect.top) + (y / 120) * svgRect.height;
      dot.style.left = `${left}px`;
      dot.style.top = `${top}px`;
      dot.classList.add('is-open');
      clearTimeout(dot.__hideTimer);
      dot.__hideTimer = setTimeout(() => dot.classList.remove('is-open'), 1400);
    }
  }
}
function linePath(points, width = 320, height = 120, tension = 0.7, pad = 10) {
  if (!points.length) return '';

  const vals = points.map(p => p.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const spread = max - min || 1;

  const innerH = Math.max(1, height - pad * 2);

  const coords = points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width;
    const y = pad + (innerH - ((point.value - min) / spread) * innerH);
    return { x, y };
  });

  if (coords.length < 2) return `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;

  let d = `M${coords[0].x.toFixed(1)},${coords[0].y.toFixed(1)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] || coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] || p2;

    const c1x = p1.x + (p2.x - p0.x) / 6 * tension;
    const c1y = p1.y + (p2.y - p0.y) / 6 * tension;
    const c2x = p2.x - (p3.x - p1.x) / 6 * tension;
    const c2y = p2.y - (p3.y - p1.y) / 6 * tension;

    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}

function calendarData(accounts, totalSeries) {
  const date = calendarAnchorDate();
  const year = date.getFullYear(); const month = date.getMonth();
  const monthStartDate = new Date(year, month, 1); const monthStart = monthStartDate.getTime(); const monthEnd = new Date(year, month + 1, 1).getTime();
  const daysInMonth = new Date(year, month + 1, 0).getDate(); const firstWeekdayOffset = (monthStartDate.getDay() + 6) % 7;
  const source = calendarSourceSeries(accounts, totalSeries);
  const pointsByDay = {};
  source.filter((point) => point.ts >= monthStart && point.ts < monthEnd).forEach((point) => {
    const prev = source.filter((i) => i.ts < point.ts).at(-1); const delta = prev ? point.value - prev.value : point.delta || 0; const deltaPct = prev?.value ? (delta / prev.value) * 100 : 0;
    pointsByDay[new Date(point.ts).getDate()] = { ...point, delta, deltaPct };
  });
  const cells = []; for (let i = 0; i < firstWeekdayOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dayKey = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push(pointsByDay[day] ? { ...pointsByDay[day], dayNumber: day, dayKey } : { dayNumber: day, dayKey, delta: 0, deltaPct: 0, isEmpty: true });
  }
  return { cells, year, month };
}

function calendarMonthData(accounts, totalSeries) {
  const date = calendarAnchorDate();
  const year = date.getFullYear();
  const source = calendarSourceSeries(accounts, totalSeries);
  const months = Array.from({ length: 12 }, (_, index) => {
    const monthStart = new Date(year, index, 1).getTime();
    const monthEnd = new Date(year, index + 1, 1).getTime();
    const deltaRow = deltaByBounds(source, monthStart, monthEnd);
    return {
      month: index,
      monthKey: `${year}-${String(index + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('es-ES', { month: 'long' }).format(new Date(year, index, 1)),
      ...deltaRow
    };
  });
  return { year, months };
}

function calendarYearData(accounts, totalSeries) {
  const source = calendarSourceSeries(accounts, totalSeries);
  const years = [...new Set(source.map((point) => new Date(point.ts).getFullYear()))].sort((a, b) => a - b);
  if (!years.length) years.push(new Date().getFullYear());
  return years.map((year) => {
    const start = new Date(year, 0, 1).getTime();
    const end = new Date(year + 1, 0, 1).getTime();
    const deltaRow = deltaByBounds(source, start, end);
    return { year, ...deltaRow };
  });
}

function balanceTxList() {
  const cache = financeDerivedCache.txList;
  if (cache.balanceRef === state.balance && cache.financePath === state.financePath) {
    return cache.rows;
  }
  cache.balanceRef = state.balance;
  cache.financePath = state.financePath;
  cache.rows = collectBalanceRows(state.balance, state.financePath);
  return cache.rows;
}
function getSelectedBalanceMonthKey() {
  return offsetMonthKey(getMonthKeyFromDate(), state.balanceMonthOffset);
}
function normalizeRecurringMonthKey(value = '') {
  return String(value || '').trim().slice(0, 7);
}
function compareMonthKeys(left = '', right = '') {
  return normalizeRecurringMonthKey(left).localeCompare(normalizeRecurringMonthKey(right));
}
function resolveRecurringScheduledDateISO(recurringData = {}, monthKey = getSelectedBalanceMonthKey()) {
  const safeMonthKey = normalizeRecurringMonthKey(monthKey);
  if (!safeMonthKey) return '';
  const [year, month] = safeMonthKey.split('-').map(Number);
  if (!year || !month) return '';
  const schedule = recurringData?.schedule || {};
  const rawDay = Number(
    schedule.dayOfMonth
    ?? schedule.dueDay
    ?? schedule.paymentDay
    ?? schedule.scheduledDay
    ?? 1
  );
  const dayOfMonth = Math.max(1, Math.min(31, rawDay || 1));
  const daysInMonth = new Date(year, month, 0).getDate();
  const safeDay = Math.min(dayOfMonth, daysInMonth);
  return `${safeMonthKey}-${String(safeDay).padStart(2, '0')}`;
}
function recurringInstanceMonthKey(row = {}) {
  return normalizeRecurringMonthKey(row?.recurringMonthKey || row?.monthKey || row?.date || row?.dateISO || '');
}
function mergeRecurringTemplateExtras(templateExtras = null, instanceExtras = null) {
  const base = templateExtras && typeof templateExtras === 'object' ? clonePlain(templateExtras) : {};
  const patch = instanceExtras && typeof instanceExtras === 'object' ? clonePlain(instanceExtras) : {};
  if (!Object.keys(base).length && !Object.keys(patch).length) return null;
  return {
    ...base,
    ...patch,
    filters: {
      ...(base.filters || {}),
      ...(patch.filters || {}),
    },
  };
}
function recurringMatchesFallbackTx(row = {}, recurringData = {}, monthKey = '', scheduledDateISO = '') {
  const txDateISO = toIsoDay(String(row?.date || row?.dateISO || '')) || '';
  const txMonthKey = normalizeRecurringMonthKey(row?.monthKey || txDateISO);
  if (!txMonthKey || txMonthKey !== normalizeRecurringMonthKey(monthKey)) return false;
  if (normalizeTxType(row?.type) !== normalizeTxType(recurringData?.type)) return false;
  const sameCategory = String(row?.category || '').trim().toLowerCase() === String(recurringData?.category || '').trim().toLowerCase();
  if (!sameCategory) return false;
  const sameAccount = String(row?.accountId || '') === String(recurringData?.accountId || '')
    && String(row?.fromAccountId || '') === String(recurringData?.fromAccountId || '')
    && String(row?.toAccountId || '') === String(recurringData?.toAccountId || '');
  if (!sameAccount) return false;
  const rowNoteKey = normalizeFoodCompareKey(row?.note || '');
  const recurringNoteKey = normalizeFoodCompareKey(recurringData?.note || '');
  if (rowNoteKey && recurringNoteKey && rowNoteKey !== recurringNoteKey) return false;
  if (scheduledDateISO && txDateISO && txDateISO !== scheduledDateISO) return false;
  return true;
}
function findRecurringInstanceTx(recurringId = '', monthKey = '', txRows = balanceTxList(), recurringData = null) {
  const safeRecurringId = String(recurringId || '').trim();
  const safeMonthKey = normalizeRecurringMonthKey(monthKey);
  if (!safeRecurringId || !safeMonthKey) return null;
  const rows = Array.isArray(txRows) ? txRows : balanceTxList();
  const explicitMatch = rows.find((row) => (
    String(row?.recurringId || '').trim() === safeRecurringId
    && recurringInstanceMonthKey(row) === safeMonthKey
  ));
  if (explicitMatch) return explicitMatch;
  if (!recurringData) return null;
  const scheduledDateISO = resolveRecurringScheduledDateISO(recurringData, safeMonthKey);
  return rows.find((row) => recurringMatchesFallbackTx(row, recurringData, safeMonthKey, scheduledDateISO)) || null;
}
function recurringStatusForMonth(monthKey = '', scheduledDateISO = '') {
  const currentMonthKey = getMonthKeyFromDate();
  const todayKey = dayKeyFromTs(Date.now());
  const monthCompare = compareMonthKeys(monthKey, currentMonthKey);
  if (monthCompare < 0) return 'pending';
  if (monthCompare > 0) return 'upcoming';
  if (!scheduledDateISO) return 'pending';
  if (scheduledDateISO > todayKey) return 'upcoming';
  if (scheduledDateISO === todayKey) return 'due';
  return 'pending';
}
function buildRecurringVirtualRow(recurringId = '', recurringData = {}, monthKey = '', scheduledDateISO = '', recurringStatus = 'upcoming') {
  return normalizeTxRow({
    id: `rec-${recurringId}-${monthKey}`,
    recurringId,
    recurringMonthKey: monthKey,
    recurringVirtual: true,
    recurringStatus,
    recurringDueDateISO: scheduledDateISO,
    ...recurringData,
    extras: mergeRecurringTemplateExtras(recurringData?.extras, null),
    date: scheduledDateISO,
    dateISO: scheduledDateISO,
    monthKey,
    personalRatio: Number.isFinite(Number(recurringData?.personalRatio)) ? clamp01(recurringData.personalRatio, 1) : null
  }, `rec-${recurringId}-${monthKey}`);
}
function recurringResolvedForMonth(monthKey = getSelectedBalanceMonthKey(), txRows = balanceTxList(), { includeFuture = true } = {}) {
  const safeMonthKey = normalizeRecurringMonthKey(monthKey) || getSelectedBalanceMonthKey();
  const rows = [];
  Object.entries(state.balance.recurring || {}).forEach(([id, recurringData]) => {
    if (!recurringData || recurringData.disabled) return;
    const schedule = recurringData.schedule || {};
    const frequency = schedule.frequency || 'monthly';
    if (frequency !== 'monthly') return;
    const scheduledDateISO = resolveRecurringScheduledDateISO(recurringData, safeMonthKey);
    if (!scheduledDateISO) return;
    if (schedule.startDate && scheduledDateISO < String(schedule.startDate)) return;
    if (schedule.endDate && scheduledDateISO > String(schedule.endDate)) return;
    const instance = findRecurringInstanceTx(id, safeMonthKey, txRows, recurringData);
    if (instance) {
      rows.push(normalizeTxRow({
        ...recurringData,
        ...instance,
        recurringId: id,
        recurringMonthKey: recurringInstanceMonthKey(instance) || safeMonthKey,
        recurringVirtual: false,
        recurringStatus: 'materialized',
        recurringDueDateISO: scheduledDateISO,
        schedule: recurringData.schedule || instance.schedule || {},
        autoCreate: recurringData.autoCreate !== false,
        extras: mergeRecurringTemplateExtras(recurringData.extras, instance.extras),
      }, instance.id));
      return;
    }
    const status = recurringStatusForMonth(safeMonthKey, scheduledDateISO);
    if (!includeFuture && status === 'upcoming') return;
    rows.push(buildRecurringVirtualRow(id, recurringData, safeMonthKey, scheduledDateISO, status));
  });
  return rows.sort((left, right) => (
    txSortTs(right) - txSortTs(left)
    || String(right?.id || '').localeCompare(String(left?.id || ''))
  ));
}
function recurringVirtualForMonth(monthKey = getSelectedBalanceMonthKey(), txRows = balanceTxList(), { includeFuture = true } = {}) {
  return recurringResolvedForMonth(monthKey, txRows, { includeFuture }).filter((row) => row.recurringVirtual);
}
function summaryForMonth(monthKey, accountsById = {}, txRows = balanceTxList()) {
  const resolvedAccountsById = Object.keys(accountsById || {}).length ? accountsById : Object.fromEntries((state.accounts || []).map((account) => [account.id, account]));
  const rows = txRows.filter((tx) => tx.monthKey === monthKey);
  const income = rows.filter((tx) => tx.type === 'income').reduce((s, tx) => s + (Number(tx.amount || 0) * personalRatioForTx(tx, resolvedAccountsById)), 0);
  const expense = rows.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + (Number(tx.amount || 0) * personalRatioForTx(tx, resolvedAccountsById)), 0);
  const transferImpact = 0;
  return { income, expense, transferImpact, net: income - expense };
}

function calcAggForBucket(txListBucket = [], accountsById = {}) {
  const incomeMy = txListBucket
    .filter((tx) => normalizeTxType(tx.type) === 'income')
    .reduce((s, tx) => s + Math.max(0, personalDeltaForTx(tx, accountsById)), 0);

  const expenseMy = txListBucket
    .filter((tx) => normalizeTxType(tx.type) === 'expense')
    .reduce((s, tx) => s + Math.max(0, -personalDeltaForTx(tx, accountsById)), 0);

  const transferImpactMy = txListBucket
    .filter((tx) => normalizeTxType(tx.type) === 'transfer')
    .reduce((s, tx) => s + personalDeltaForTx(tx, accountsById), 0);

  const incomeTotal = txListBucket.filter((tx) => normalizeTxType(tx.type) === 'income').reduce((s, tx) => s + Number(tx.amount || 0), 0);
  const expenseTotal = txListBucket.filter((tx) => normalizeTxType(tx.type) === 'expense').reduce((s, tx) => s + Number(tx.amount || 0), 0);

  return {
    incomeMy,
    expenseMy,
    netOperativeMy: incomeMy - expenseMy,
    transferImpactMy,
    netWealthMy: incomeMy - expenseMy + transferImpactMy,
    incomeTotal,
    expenseTotal,
    netOperativeTotal: incomeTotal - expenseTotal,
    transferImpactTotal: 0,
    netWealthTotal: incomeTotal - expenseTotal
  };
}

function accountValueByTs(account = {}, ts = 0) {
  const day = dayKeyFromTs(ts);
  return accountValueForDay(account, day);
}

function calcAccountsDeltaForBucket(mode = 'month', bucketKey = '', accounts = state.accounts) {
  const bounds = bucketRange(mode, bucketKey);
  const startTs = bounds.start;
  const endTs = Math.max(bounds.start, bounds.end - 1);
  return (accounts || []).reduce((sum, account) => {
    const start = accountValueByTs(account, startTs);
    const end = accountValueByTs(account, endTs);
    return sum + (end - start);
  }, 0);
}

function scheduleAggregateRebuild() {
  clearTimeout(state.aggregateRebuildTimer);
  state.aggregateRebuildTimer = setTimeout(() => {
    rebuildAggregates().catch((error) => console.error('[finance] aggregate rebuild failed', error));
  }, 250);
}

async function rebuildAggregates() {
  const rows = balanceTxList();
  const accountsById = Object.fromEntries(state.accounts.map((account) => [account.id, account]));
  const grouped = { day: {}, week: {}, month: {}, year: {}, total: { all: rows } };
  rows.forEach((tx) => {
    ['day', 'week', 'month', 'year'].forEach((mode) => {
      const key = bucketKeyForTx(tx, mode);
      if (!key) return;
      grouped[mode][key] = grouped[mode][key] || [];
      grouped[mode][key].push(tx);
    });
  });
  const updates = {};
  AGG_MODES.forEach((mode) => {
    Object.entries(grouped[mode] || {}).forEach(([bucketKey, list]) => {
      const agg = calcAggForBucket(list, accountsById);
      const accountsDeltaReal = calcAccountsDeltaForBucket(mode, bucketKey, state.accounts);
      updates[`${state.financePath}/aggregates/${mode}/${bucketKey}`] = {
        ...agg,
        accountsDeltaReal,
        updatedAt: nowTs()
      };
    });
  });
  if (Object.keys(updates).length) await safeFirebase(() => update(ref(db), updates));
}

function metricValue(row, scope = 'my', metric = 'netOperative') {
  const suffix = scope === 'total' ? 'Total' : 'My';
  const key = `${metric}${suffix}`;
  return Number(row?.[key] || 0);
}


function openBalanceDrilldown(txType) {
  if (txType !== 'income' && txType !== 'expense') return;
  state.modal = {
    type: 'balance-drilldown',
    txType,
    monthOffset: state.balanceMonthOffset,
    importRaw: '',
    importPreview: null,
    importError: ''
  };
  triggerRender();
}

function getMovementFormMeta() {
  if (!state.balanceFormMeta || typeof state.balanceFormMeta !== 'object') {
    state.balanceFormMeta = { saving: false, mode: 'create' };
  }
  return state.balanceFormMeta;
}

function movementDefaultAccountId() {
  return String(state.balance?.defaultAccountId || '').trim();
}

function getEmptyMovementForm(overrides = {}) {
  const defaultDate = toIsoDay(String(overrides.dateISO || '')) || dayKeyFromTs(Date.now());
  const defaultAccountId = String(overrides.accountId ?? movementDefaultAccountId() ?? '').trim();
  return {
    type: 'expense',
    amount: '',
    dateISO: defaultDate,
    accountId: defaultAccountId,
    fromAccountId: '',
    toAccountId: '',
    category: '',
    note: '',
    linkedHabitId: '',
    allocationMode: 'point',
    allocationPeriod: 'day',
    allocationAnchorDate: defaultDate,
    allocationCustomStart: '',
    allocationCustomEnd: '',
    personalRatioMode: 'auto',
    personalRatioPercent: '',
    personalRatioAdvanced: false,
    foodMealType: '',
    foodCuisine: '',
    foodPlace: '',
    foodItem: '',
    foodId: '',
    foodExtrasOpen: false,
    foodResultsScrollTop: 0,
    importedFoodItems: [],
    ticketData: null,
    ticketScanMeta: null,
    recurringId: '',
    recurringMonthKey: defaultDate.slice(0, 7),
    recurringDueDateISO: '',
    recurringEnabled: false,
    txWizardStep: 'base',
    ...overrides,
  };
}

function resetMovementForm(overrides = {}) {
  state.balanceAmountAuto = true;
  state.balanceFormState = getEmptyMovementForm(overrides);
  const meta = getMovementFormMeta();
  meta.saving = false;
  meta.mode = String(overrides?.mode || 'create');
}

function movementDraftFromRecurring(recurringId = '', recurringData = {}, monthKey = getSelectedBalanceMonthKey()) {
  const scheduledDateISO = resolveRecurringScheduledDateISO(recurringData, monthKey) || `${normalizeRecurringMonthKey(monthKey) || getMonthKeyFromDate()}-01`;
  const foodExtras = normalizeFoodExtras(recurringData.extras || recurringData.food || {}, Number(recurringData.amount || 0));
  const allocation = normalizeTxAllocation(recurringData.allocation || {}, scheduledDateISO);
  return getEmptyMovementForm({
    type: normalizeTxType(recurringData.type || 'expense'),
    amount: Number.isFinite(Number(recurringData.amount)) ? String(Math.abs(Number(recurringData.amount || 0))) : '',
    dateISO: scheduledDateISO,
    accountId: String(recurringData.accountId || '').trim(),
    fromAccountId: String(recurringData.fromAccountId || '').trim(),
    toAccountId: String(recurringData.toAccountId || '').trim(),
    category: String(recurringData.category || '').trim(),
    note: String(recurringData.note || '').trim(),
    linkedHabitId: String(recurringData.linkedHabitId || '').trim(),
    allocationMode: allocation.mode === 'period' ? allocation.period : 'point',
    allocationPeriod: allocation.mode === 'period' ? allocation.period : 'day',
    allocationAnchorDate: allocation.anchorDate || scheduledDateISO,
    allocationCustomStart: allocation.customStart || '',
    allocationCustomEnd: allocation.customEnd || '',
    personalRatioMode: Number.isFinite(Number(recurringData.personalRatio)) ? 'custom' : 'auto',
    personalRatioPercent: Number.isFinite(Number(recurringData.personalRatio)) ? String(Math.round(clamp01(recurringData.personalRatio, 1) * 100)) : '',
    personalRatioAdvanced: Number.isFinite(Number(recurringData.personalRatio)),
    foodMealType: foodExtras?.filters?.mealType || '',
    foodCuisine: foodExtras?.filters?.cuisine || '',
    foodPlace: foodExtras?.filters?.place || '',
    foodItem: foodExtras?.items?.[0]?.name || '',
    foodId: foodExtras?.items?.[0]?.foodId || '',
    importedFoodItems: foodExtras?.items || [],
    foodExtrasOpen: !!foodExtras?.items?.length,
    recurringId: String(recurringId || '').trim(),
    recurringMonthKey: scheduledDateISO.slice(0, 7),
    recurringDueDateISO: scheduledDateISO,
    recurringEnabled: false,
    txWizardStep: 'base',
  });
}

function openCreateMovementModal(overrides = {}) {
  resetMovementForm({ ...overrides, mode: 'create' });
  state.modal = { type: 'tx', txType: state.balanceFormState.type || 'expense' };
  return triggerRender({ preserveUi: false, force: true });
}

function openEditMovementModal(movement = null) {
  const row = movement || null;
  resetMovementForm({
    recurringId: String(row?.recurringId || '').trim(),
    recurringMonthKey: recurringInstanceMonthKey(row) || normalizeRecurringMonthKey(row?.monthKey || row?.date || row?.dateISO || '') || getMonthKeyFromDate(),
    recurringDueDateISO: String(row?.recurringDueDateISO || '').trim(),
    recurringEnabled: false,
    mode: 'edit',
  });
  state.modal = { type: 'tx', txId: String(row?.id || '').trim() };
  return triggerRender({ preserveUi: false, force: true });
}

function openRecurringMovementModal(recurringId = '', monthKey = getSelectedBalanceMonthKey()) {
  const safeRecurringId = String(recurringId || '').trim();
  if (!safeRecurringId) return Promise.resolve(null);
  const recurringData = state.balance?.recurring?.[safeRecurringId];
  if (!recurringData) return Promise.resolve(null);
  const existing = findRecurringInstanceTx(safeRecurringId, monthKey, balanceTxList(), recurringData);
  if (existing) return openEditMovementModal(existing);
  return openCreateMovementModal(movementDraftFromRecurring(safeRecurringId, recurringData, monthKey));
}

function closeMovementModal() {
  resetMovementForm();
  state.modal = { type: null };
  return triggerRender({ preserveUi: false, force: true });
}

function setMovementFormBusy(formEl = null, busy = false) {
  const meta = getMovementFormMeta();
  meta.saving = !!busy;
  if (!formEl?.querySelectorAll) return;
  formEl.dataset.saving = busy ? '1' : '0';
  formEl.querySelectorAll('button[type="submit"]').forEach((button) => {
    button.disabled = !!busy;
    const idleLabel = String(button.dataset.submitLabel || button.textContent || '').trim();
    button.textContent = busy ? 'Guardando…' : idleLabel;
  });
}

function buildDrilldownRows(txType, monthKey) {
  return balanceTxList()
    .filter((row) => row.type === txType && row.monthKey === monthKey)
    .sort((a, b) => txSortTs(b) - txSortTs(a));
}

function monthlyNetRows(accountsById = {}, txRows = balanceTxList()) {
  const resolvedAccountsById = Object.keys(accountsById || {}).length ? accountsById : Object.fromEntries((state.accounts || []).map((account) => [account.id, account]));
  const grouped = {};
  txRows.forEach((tx) => {
    if (!tx.monthKey) return;
    grouped[tx.monthKey] = grouped[tx.monthKey] || [];
    grouped[tx.monthKey].push(tx);
  });
  return Object.entries(grouped).map(([month, rows]) => {
    const agg = calcAggForBucket(rows, resolvedAccountsById);
    const accountsDeltaReal = calcAccountsDeltaForBucket('month', month, state.accounts);
    return { month, netOperative: agg.netOperativeMy, netWealth: agg.netWealthMy, accountsDeltaReal };
  }).sort((a, b) => b.month.localeCompare(a.month));
}

function categoryColor(index = 0) {
  const palette = ['#65d8ff', '#8aff8a', '#ffcf66', '#ff8fb6', '#b7a1ff', '#75f0d6', '#ffc78a', '#9fb8ff'];
  return palette[index % palette.length];
}

function buildBalanceStats(rows, accountsById) {
  const spentByCategoryPersonal = {};
  const incomeByCategoryPersonal = {};
  const spentByCategoryGlobal = {};
  const incomeByCategoryGlobal = {};
  const foodByItemPersonal = {};
  const foodByItemGlobal = {};
  let totalFoodSpentPersonal = 0;
  let totalFoodSpentGlobal = 0;
  rows.forEach((row) => {
    const amountGlobal = Math.abs(Number(row.amount || 0));
    const amountPersonal = Math.abs(personalDeltaForTx(row, accountsById));
    if (!amountPersonal && !amountGlobal) return;
    const category = row.category || 'Sin categoría';
    if (row.type === 'expense') {
      spentByCategoryPersonal[category] = (spentByCategoryPersonal[category] || 0) + amountPersonal;
      spentByCategoryGlobal[category] = (spentByCategoryGlobal[category] || 0) + amountGlobal;
      if (isFoodCategory(category)) {
        totalFoodSpentPersonal += amountPersonal;
        totalFoodSpentGlobal += amountGlobal;
      }
      const foodItems = foodItemsFromTx(row);
      if (foodItems.length) {
        const personalFactor = amountGlobal ? (amountPersonal / amountGlobal) : getRatio(accountsById[row.accountId]);
        foodItems.forEach((foodItem) => {
          const spentGlobal = Number(foodItem.price || 0) > 0 ? Number(foodItem.price || 0) : amountGlobal;
          const spentPersonal = spentGlobal * personalFactor;
          foodByItemPersonal[foodItem.name] = foodByItemPersonal[foodItem.name] || { name: foodItem.name, total: 0, count: 0 };
          foodByItemPersonal[foodItem.name].total += spentPersonal;
          foodByItemPersonal[foodItem.name].count += 1;
          foodByItemGlobal[foodItem.name] = foodByItemGlobal[foodItem.name] || { name: foodItem.name, total: 0, count: 0 };
          foodByItemGlobal[foodItem.name].total += spentGlobal;
          foodByItemGlobal[foodItem.name].count += 1;
        });
      }
    }
    if (row.type === 'income') {
      incomeByCategoryPersonal[category] = (incomeByCategoryPersonal[category] || 0) + amountPersonal;
      incomeByCategoryGlobal[category] = (incomeByCategoryGlobal[category] || 0) + amountGlobal;
    }
  });
  const totalSpentPersonal = Object.values(spentByCategoryPersonal).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalIncomePersonal = Object.values(incomeByCategoryPersonal).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalSpentGlobal = Object.values(spentByCategoryGlobal).reduce((sum, value) => sum + Number(value || 0), 0);
  const totalIncomeGlobal = Object.values(incomeByCategoryGlobal).reduce((sum, value) => sum + Number(value || 0), 0);
  const topFoodItemsPersonal = Object.values(foodByItemPersonal)
    .sort((a, b) => (b.total - a.total) || (b.count - a.count) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .slice(0, 5);
  const topFoodItemsGlobal = Object.values(foodByItemGlobal)
    .sort((a, b) => (b.total - a.total) || (b.count - a.count) || a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }))
    .slice(0, 5);
  return {
    spentByCategoryPersonal,
    incomeByCategoryPersonal,
    spentByCategoryGlobal,
    incomeByCategoryGlobal,
    totalSpentPersonal,
    totalIncomePersonal,
    totalSpentGlobal,
    totalIncomeGlobal,
    totalFoodSpentPersonal,
    totalFoodSpentGlobal,
    topFoodItemsPersonal,
    topFoodItemsGlobal
  };
}

function rangeStartByMode(mode = 'month', anchorDate = '') {
  const baseIso = toIsoDay(anchorDate) || dayKeyFromTs(Date.now());
  const [y, m, d] = baseIso.split('-').map(Number);
  const start = new Date(y, (m || 1) - 1, d || 1, 0, 0, 0, 0);

  if (mode === 'day') return start.getTime();

  if (mode === 'week') {
    const day = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - day);
    return start.getTime();
  }

  if (mode === 'year') {
    start.setMonth(0, 1);
    return start.getTime();
  }

  if (mode === 'month') {
    start.setDate(1);
    return start.getTime();
  }

  return null;
}

function txTs(row = {}) {
  return new Date(row.dateISO || row.date || 0).getTime() || 0;
}

function filterTxByRange(rows = [], mode = 'month') {
  if (mode === 'total') return rows;
  const start = rangeStartByMode(mode);
  if (start == null) return rows;
  const end = Date.now();
  return rows.filter((row) => {
    const ts = txTs(row);
    return ts >= start && ts <= end;
  });
}

function listHabitOptions() {
  const apiList = window.__bookshellHabits?.listActiveHabits;
  const habits = typeof apiList === 'function' ? apiList() : [];
  if (!Array.isArray(habits)) return [];
  return habits
    .map((habit) => ({ id: String(habit?.id || ''), name: String(habit?.name || '').trim() }))
    .filter((habit) => habit.id && habit.name);
}

function getHoursByHabitId(range = 'month', explicitBounds = null) {
  const safeRange = ['day', 'week', 'month', 'year', 'total'].includes(range) ? range : 'month';
  const reader = window.__bookshellHabits?.getHoursByHabitId;
  if (typeof reader !== 'function') return {};
  try {
    const payload = explicitBounds && Number.isFinite(explicitBounds.start) && Number.isFinite(explicitBounds.end)
      ? { range: safeRange, start: explicitBounds.start, end: explicitBounds.end }
      : safeRange;
    const hours = reader(payload);
    if (!hours || typeof hours !== 'object') return {};
    return Object.fromEntries(Object.entries(hours).map(([habitId, value]) => [habitId, Number(value || 0)]));
  } catch (err) {
    console.warn('[finance] getHoursByHabitId failed', err);
    return {};
  }
}

function amountAllocatedToRange(row = {}, rangeBounds = {}) {
  const amount = Number(row?.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const fallbackDate = String(row?.date || isoToDay(row?.dateISO || '') || '');
  const allocation = normalizeTxAllocation(row?.allocation || {}, fallbackDate);
  const txDayTs = localStartOfDayTs(fallbackDate || allocation.anchorDate);
  if (allocation.mode === 'point') {
    return txDayTs >= rangeBounds.start && txDayTs < rangeBounds.end ? amount : 0;
  }
  const windowBounds = allocationWindowBounds(allocation, fallbackDate);
  const windowDays = overlapDays(windowBounds, windowBounds);
  if (!windowDays) return 0;
  const overlap = overlapDays(windowBounds, rangeBounds);
  if (!overlap) return 0;
  return amount * (overlap / windowDays);
}

function computeTransactionAmountInRange(row = {}, viewedRange = {}) {
  return amountAllocatedToRange(row, viewedRange);
}

function aggregateStatsGroup(rows = [], groupBy = 'category', txMode = 'expense', scope = 'personal', accountsById = {}, options = {}) {
  const output = {};
  const productKeyByLabel = {};
  const ungroupedLabel = 'Importe sin líneas';
  const includeUnlined = !!options.includeUnlined;
  let unlinedTotal = 0;
  const isMissingGroupedValue = (value = '') => {
    const normalized = normalizeFoodName(value).toLowerCase();
    if (!normalized) return true;
    return normalized.startsWith('sin ');
  };
  rows.forEach((row) => {
    if (row.type !== txMode) return;
    const amount = scope === 'global'
      ? Math.abs(Number(row.amount || 0))
      : Math.abs(personalDeltaForTx(row, accountsById));
    if (!amount) return;
    let key = 'Sin datos';
    if (groupBy === 'account') key = accountsById[row.accountId]?.name || 'Sin cuenta';
    else if (groupBy === 'store') {
      const items = foodItemsFromTx(row);
      key = normalizeFoodName(row.extras?.filters?.place || row.extras?.place || items.find((item) => item?.place)?.place || '');
      if (isMissingGroupedValue(key)) return;
    } else if (groupBy === 'mealType') {
      key = normalizeFoodName(row.extras?.filters?.mealType || row.extras?.mealType || '');
      if (isMissingGroupedValue(key)) return;
    }
    else if (groupBy === 'product') {
      const items = foodItemsFromTx(row);
      const hasLines = items.some((item) => normalizeFoodName(item?.name || ''));
      if (!hasLines) {
        unlinedTotal += amount;
        if (includeUnlined) output[ungroupedLabel] = (output[ungroupedLabel] || 0) + amount;
      }
      return;
    } else key = row.category || 'Sin categoría';
    output[key] = (output[key] || 0) + amount;
  });
  if (groupBy === 'product') {
    const scopedAmountByTx = {};
    rows.forEach((row) => {
      if (row.type !== txMode) return;
      const scopedAmount = scope === 'global' ? Math.abs(Number(row.amount || 0)) : Math.abs(personalDeltaForTx(row, accountsById));
      if (!scopedAmount) return;
      scopedAmountByTx[row.id] = scopedAmount;
    });
    const spendStats = accumulateSpendByProduct(rows.filter((row) => row.type === txMode), scopedAmountByTx, state.food.itemsById || {});
    Object.entries(spendStats.spend || {}).forEach(([label, value]) => {
      if (isMissingGroupedValue(label)) return;
      output[label] = (output[label] || 0) + Number(value || 0);
      if (!productKeyByLabel[label] && spendStats.productKeyByLabel?.[label]) productKeyByLabel[label] = spendStats.productKeyByLabel[label];
    });
    state.balanceStatsProductMeta = spendStats.statsByProduct || {};
  } else {
    state.balanceStatsProductMeta = {};
  }
  return { breakdown: output, unlinedTotal, productKeyByLabel };
}

async function renderFixedExpenseCharts() {
  if (typeof echarts === 'undefined') {
    try {
      await ensureFinanceEchartsReady();
    } catch (error) {
      log('no se pudo cargar ECharts para fixed expense charts', error);
      return;
    }
  }

  const fixedDonutHost = document.querySelector('#financeFixedDonut');
  if (fixedDonutHost && fixedDonutHost.dataset.financeStatsDonut) {
    try {
      let rows = [];
      try { rows = JSON.parse(fixedDonutHost.dataset.financeStatsDonut || '[]'); } catch (_) { rows = []; }
      
      if (Array.isArray(rows) && rows.length > 0) {
        const chart = echarts.getInstanceByDom(fixedDonutHost) || echarts.init(fixedDonutHost);
        chart.setOption({
          animation: false,
          tooltip: { show: false },
          series: [{
            type: 'pie',
            radius: ['58%', '80%'],
            avoidLabelOverlap: true,
            label: { show: false },
            labelLine: false,
            emphasis: { disabled: true },
            itemStyle: {
              borderColor: 'rgba(8,14,34,.9)',
              borderWidth: 2
            },
            data: rows.map((row) => ({
              name: row.name,
              value: Number(row.value || 0),
              _key: row._key,
              productKey: row.productKey,
              pct: Number(row.pct || 0),
              midAngle: Number(row.midAngle || 0),
              itemStyle: { color: row.color }
            }))
          }]
        }, { notMerge: true });
        chart.resize();
      }
    } catch (error) {
      log('error rendering fixed expense donut', error);
    }
  }
}

function computeFinanceStatsDonutPayload(rows = [], accountsById = {}, options = {}) {
  const {
    monthKey = '',
    statsRange = 'month',
    statsScope = 'personal',
    statsGroupBy = 'category',
    mode = 'expense',
    includeUnlined = false,
  } = options;
  const cacheKey = buildFinanceStatsCacheKey({
    monthKey,
    statsRange,
    statsScope,
    statsGroupBy,
    mode,
    includeUnlined,
    rows,
  });
  const cached = readProcessedJsonCache(cacheKey);
  if (cached?.segments && cached?.donutAggregation) {
    state.balanceStatsProductMeta = hydrateFinanceProductMeta(cached.productMeta || {});
    return cached;
  }

  const donutAggregation = aggregateStatsGroup(rows, statsGroupBy, mode, statsScope, accountsById, {
    includeUnlined: includeUnlined && statsGroupBy === 'product',
  });
  const donutMap = donutAggregation.breakdown;
  const donutTotal = Object.values(donutMap).reduce((sum, value) => sum + Number(value || 0), 0);
  const payload = {
    donutAggregation,
    donutTotal,
    segments: donutSegments(donutMap, donutTotal, { productKeyByLabel: donutAggregation.productKeyByLabel }),
    productMeta: serializeFinanceProductMeta(state.balanceStatsProductMeta || {}),
  };
  writeProcessedJsonCache(cacheKey, payload, {
    ttlMs: 20 * 60 * 1000,
  });
  return payload;
}

function donutSegments(mapData = {}, total = 0, options = {}) {
  if (!total) return [];
  const productKeyByLabel = options?.productKeyByLabel || {};
  let accumulatedRatio = 0;
  return Object.entries(mapData)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value], index) => {
      const ratio = Number(value || 0) / total;
      const startRatio = accumulatedRatio;
      const endRatio = accumulatedRatio + ratio;
      const midAngle = ((startRatio + endRatio) / 2) * (Math.PI * 2) - (Math.PI / 2);
      const segment = {
        label,
        value,
        color: categoryColor(index),
        pct: ratio * 100,
        midAngle,
        key: `${firebaseSafeKey(label)}__${index}`,
        _key: String(productKeyByLabel[label] || firebaseSafeKey(label)),
        productKey: String(productKeyByLabel[label] || firebaseSafeKey(label))
      };
      accumulatedRatio = endRatio;
      return segment;
    });
}

let financeStatsDonutChart = null;

function updateLegendSelection(selectedKey = '') {
  const rows = document.querySelectorAll('[data-finance-stats-segment]');
  rows.forEach((row) => {
    row.classList.toggle('is-active', String(row.dataset.financeStatsSegment || '') === String(selectedKey || ''));
  });
}

async function openProductDetail(productKey = '') {
  const safeKey = String(productKey || '').trim();
  if (!safeKey) return;
  await ensureFoodCatalogLoaded();
  const item = resolveFoodItemByAnyKey(safeKey);
  if (item) {
    state.modal = { type: 'food-item', foodId: item.id, mode: 'detail', source: 'stats-legend' };
  } else {
    const snapshot = resolveProductsCatalogSnapshot(safeKey);
    if (!snapshot?.canonicalName) {
      toast('Ese producto aun no tiene ficha propia');
      return;
    }
    state.modal = { type: 'food-item', foodName: snapshot.canonicalName, source: 'stats-legend-create' };
  }
  triggerRender();
}

function ensureFinanceStatsCallout(host) {
  if (!host) return { callout: null, line: null };
  let callout = host.querySelector('#financeStatsDonutCallout');
  if (!callout) {
    callout = document.createElement('div');
    callout.id = 'financeStatsDonutCallout';
    callout.className = 'financeStats__callout';
    host.appendChild(callout);
  }
  let line = host.querySelector('#financeStatsDonutCalloutLine');
  if (!line) line = host.querySelector('[data-finance-stats-callout-line]');
  return { callout, line };
}

function updateCalloutFromSlice(params) {
  const host = document.querySelector('[data-finance-stats-donut-wrap]');
  if (!host) return;
  const { callout, line } = ensureFinanceStatsCallout(host);
  if (!callout || !line) return;
  const hasValidData = Boolean(params?.data?.name) && params?.data?.value != null;
  if (!hasValidData || !Number.isFinite(Number(params?.data?.midAngle))) {
    callout.style.display = 'none';
    callout.textContent = '';
    line.style.display = 'none';
    line.setAttribute('points', '');
    return;
  }
  const sliceMidAngle = Number(params.data.midAngle);
  const sliceLabel = String(params.data.name || '');
  const sliceValue = Number(params.data.value || 0);
  const slicePct = Number(params?.percent ?? params?.data?.pct ?? 0);
  const calloutInnerRadius = 46;
  const calloutOuterRadius = 56;
  const calloutBoxRadius = 64;
  const calloutFrom = { x: 50 + (Math.cos(sliceMidAngle) * calloutInnerRadius), y: 50 + (Math.sin(sliceMidAngle) * calloutInnerRadius) };
  const calloutTo = { x: 50 + (Math.cos(sliceMidAngle) * calloutOuterRadius), y: 50 + (Math.sin(sliceMidAngle) * calloutOuterRadius) };
  const rawX = 50 + (Math.cos(sliceMidAngle) * calloutBoxRadius);
  const rawY = 50 + (Math.sin(sliceMidAngle) * calloutBoxRadius);
  const margin = 25;
  const calloutBox = { x: Math.max(margin, Math.min(100 - margin, rawX)), y: Math.max(margin, Math.min(100 - margin, rawY)) };
  line.setAttribute('points', `${calloutFrom.x},${calloutFrom.y} ${calloutTo.x},${calloutTo.y} ${calloutBox.x},${calloutBox.y}`);
  callout.style.left = `calc(${calloutBox.x}% )`;
  callout.style.top = `calc(${calloutBox.y}% )`;
  callout.innerHTML = `<strong>${escapeHtml(sliceLabel)}</strong><small>${fmtCurrency(sliceValue)} · ${slicePct.toFixed(1)}%</small>`;
  callout.style.display = 'grid';
  line.style.display = 'block';
}

function updateCallout(selectedKey = '') {
  const host = document.querySelector('[data-finance-stats-donut-wrap]');
  if (!host) return;
  let segments = [];
  try { segments = JSON.parse(host.dataset.financeStatsSegments || '[]'); } catch (_) { segments = []; }
  const segment = segments.find((row) => String(row?._key || '') === String(selectedKey || '')) || null;
  if (!segment) {
    updateCalloutFromSlice(null);
    return;
  }
  updateCalloutFromSlice({
    data: {
      name: segment.label,
      value: Number(segment.value || 0),
      pct: Number(segment.pct || 0),
      midAngle: Number(segment.midAngle)
    },
    percent: Number(segment.pct || 0)
  });
}

function disposeFinanceStatsDonutChart() {
  if (!financeStatsDonutChart) return;
  const zr = financeStatsDonutChart.getZr?.();
  if (zr && financeStatsDonutChart.__financeBgClickHandler) {
    zr.off('click', financeStatsDonutChart.__financeBgClickHandler);
    financeStatsDonutChart.__financeBgClickHandler = null;
  }
  try { financeStatsDonutChart.dispose(); } catch (_) {}
  financeStatsDonutChart = null;
}

async function renderFinanceStatsDonutChart() {
  const host = document.querySelector('[data-finance-stats-donut]');
  if (!host) {
    disposeFinanceStatsDonutChart();
    return;
  }
  let rows = [];
  try { rows = JSON.parse(host.dataset.financeStatsDonut || '[]'); } catch (_) { rows = []; }
  if (!Array.isArray(rows) || !rows.length) {
    disposeFinanceStatsDonutChart();
    return;
  }
  if (typeof echarts === 'undefined') {
    try {
      await ensureFinanceEchartsReady();
    } catch (error) {
      console.warn('[finance] no se pudo cargar ECharts para balance stats', error);
      disposeFinanceStatsDonutChart();
      return;
    }
  }
  if (!financeStatsDonutChart || financeStatsDonutChart.getDom() !== host) {
    disposeFinanceStatsDonutChart();
    financeStatsDonutChart = echarts.init(host);
  }
financeStatsDonutChart.setOption({
  animation: false,

  tooltip: {
    show: false
  },

  series: [{
    type: 'pie',
    radius: ['58%', '80%'],
    avoidLabelOverlap: true,
    label: { show: false },
    labelLine: false ,
    emphasis: { disabled: true },   // 👈 evita hover visual
    itemStyle: {
      borderColor: 'rgba(8,14,34,.9)',
      borderWidth: 2
    },
    data: rows.map((row) => ({
      name: row.name,
      value: Number(row.value || 0),
      _key: row._key,
      productKey: row.productKey,
      pct: Number(row.pct || 0),
      midAngle: Number(row.midAngle || 0),
      itemStyle: { color: row.color }
    }))
  }]
}, { notMerge: true });

  const resetSelection = ({ rerender = true } = {}) => {
    financeStatsDonutChart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    updateCallout('');
    if (state.balanceStatsActiveSegment) {
      state.balanceStatsActiveSegment = null;
      state.balanceStatsSelectedSliceKey = null;
      updateLegendSelection('');
      updateCallout('');
      if (rerender) triggerRender();
    }
  };

  financeStatsDonutChart.off('click');
  financeStatsDonutChart.on('click', (params) => {
    if (params?.seriesType !== 'pie' || !params?.data) return;
    const idx = Number(params.dataIndex);
    const segmentKey = String(params.data._key || '');
    if (!segmentKey || !Number.isInteger(idx) || idx < 0) return;
    if (state.balanceStatsActiveSegment === segmentKey) {
      resetSelection({ rerender: false });
      return;
    }
    state.balanceStatsActiveSegment = segmentKey;
    state.balanceStatsSelectedSliceKey = segmentKey;
    financeStatsDonutChart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
    financeStatsDonutChart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx });
    updateLegendSelection(segmentKey);
    updateCalloutFromSlice(params);
  });

  const zr = financeStatsDonutChart.getZr?.();
  if (zr && financeStatsDonutChart.__financeBgClickHandler) {
    zr.off('click', financeStatsDonutChart.__financeBgClickHandler);
  }
  financeStatsDonutChart.__financeBgClickHandler = (event) => {
    if (event?.target) return;
    resetSelection();
  };
  if (zr) zr.on('click', financeStatsDonutChart.__financeBgClickHandler);

  financeStatsDonutChart.resize();
  updateCalloutFromSlice(null);
  if (state.balanceStatsActiveSegment) {
    const selectedIndex = rows.findIndex((row) => row._key === state.balanceStatsActiveSegment);
    if (selectedIndex >= 0) {
      financeStatsDonutChart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
      financeStatsDonutChart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: selectedIndex });
      updateLegendSelection(state.balanceStatsActiveSegment);
      updateCallout(state.balanceStatsActiveSegment);
    }
  } else {
    updateLegendSelection('');
    updateCallout('');
  }
}

function categoriesList(txRows = balanceTxList()) {
  const cache = financeDerivedCache.categories;
  const categoryKey = Object.entries(state.balance.categories || {})
    .map(([name, row]) => `${name}:${String(row?.emoji || '')}`)
    .sort((a, b) => a.localeCompare(b, 'es'))
    .join('|');
  if (cache.categoriesKey === categoryKey && cache.txRowsRef === txRows) {
    return cache.rows;
  }
  const dynamic = Object.values(state.balance.categories || {}).map((row) => String(row?.name || '')).filter(Boolean);
  const fromTx = [...new Set(txRows.map((tx) => tx.category).filter((name) => name && String(name).toLowerCase() !== 'transfer'))];
  cache.categoriesKey = categoryKey;
  cache.txRowsRef = txRows;
  cache.rows = [...new Set([...dynamic, ...fromTx])].sort((a, b) => a.localeCompare(b, 'es'));
  return cache.rows;
}

const CATEGORY_EMOJI_FALLBACK = {
  comida: '🍔',
  supermercados: '🧺',
  super: '🧺',
  casa: '🏠',
  alquiler: '🏠',
  luz: '💡',
  agua: '🚰',
  gas: '🔥',
  internet: '📶',
  telefono: '📱',
  transporte: '🚗',
  gasolina: '⛽',
  salud: '🩺',
  farmacia: '💊',
  ocio: '🎮',
  regalos: '🎁',
  ropa: '👕',
  suscripciones: '🔁',
  viaje: '✈️',
  formacion: '📚',
  impuestos: '🧾',
  otros: '🧩',
};

function normalizeTxWizardStep(value) {
  const v = String(value || '').trim().toLowerCase();
  if (v === 'base' || v === 'category' || v === 'food') return v;
  return 'base';
}

function isFoodCategoryName(name) {
  const v = String(name || '').trim().toLowerCase();
  return v === 'comida' || v.includes('comida');
}

function categoryEmojiForName(name) {
  const key = String(name || '').trim();
  if (!key) return '';
  const direct = state.balance.categories?.[key]?.emoji;
  if (direct) return String(direct);
  const lower = key.toLowerCase();
  return CATEGORY_EMOJI_FALLBACK[lower] || '';
}

function categoriesMetaList() {
  return categoriesList().map((name) => ({
    name,
    emoji: categoryEmojiForName(name),
    hasCustomEmoji: Boolean(state.balance.categories?.[name]?.emoji),
  }));
}
function getBudgetItems(monthKey = getSelectedBalanceMonthKey()) {
  const monthBudgets = state.balance.budgets?.[monthKey] || {};
  return Object.entries(monthBudgets).map(([id, payload]) => {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.category != null) return { id, category: String(payload.category), limit: Number(payload.limit || 0) };
    if (id === '_total') return { id, category: 'Total', limit: Number(payload.limit || 0) };
    if (payload.limit == null) return null;
    return { id, category: id, limit: Number(payload.limit || 0) };
  }).filter((row) => row && row.category);
}

function openAccountDetail(accountId) {
  log(`openAccountDetail accountId=${accountId}`);
  state.modal = { type: 'account-detail', accountId, importRaw: '', importPreview: null, importError: '' };
  triggerRender();
}

function parseCsvRows(rawCsv = '') {
  const lines = String(rawCsv || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], validRows: [], invalidRows: 0, totalRows: 0 };
  const parseLine = (line) => {
    const out = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i += 1; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        out.push(current.trim());
        current = '';
      } else current += ch;
    }
    out.push(current.trim());
    return out;
  };
  const firstCols = parseLine(lines[0]).map((col) => col.toLowerCase());
  const hasHeader = firstCols.includes('date') || firstCols.includes('value');
  const offset = hasHeader ? 1 : 0;
  const sourceRows = lines.slice(offset).map(parseLine);
  const mapped = sourceRows.map((cols, index) => {
    const dateISO = toIsoDay(cols[0]);
    const value = parseEuroNumber(cols[1]);
    const valid = Boolean(dateISO) && Number.isFinite(value);
    return { lineNumber: index + offset + 1, raw: cols, dateISO, value, valid };
  });
  const validRows = mapped.filter((row) => row.valid);
  log(`import parsed rows=${mapped.length}`);
  return { rows: mapped, validRows, invalidRows: mapped.length - validRows.length, totalRows: mapped.length };
}

async function applyImportRows(accountId, parsed) {
  const byDay = {};
  parsed.validRows.forEach((row) => { byDay[row.dateISO] = row.value; });
  const days = Object.keys(byDay).sort();
  if (!days.length) return 0;
  const updatesMap = {};
  days.forEach((day) => {
    updatesMap[`${state.financePath}/accounts/${accountId}/snapshots/${day}`] = { value: byDay[day], updatedAt: nowTs() };
  });
  updatesMap[`${state.financePath}/accounts/${accountId}/updatedAt`] = nowTs();
  updatesMap[`${state.financePath}/accounts/${accountId}/lastImportAt`] = nowTs();
  await safeFirebase(() => update(ref(db), updatesMap));
  await recomputeAccountEntries(accountId, days[0]);
  log(`import applied days=${days.length}`);
  return days.length;
}

async function maybeRolloverSnapshot() {
  const currentMonthKey = getMonthKeyFromDate();
  if (state.balance.lastSeenMonthKey === currentMonthKey) return;
  const prevMonthKey = offsetMonthKey(currentMonthKey, -1);
  const prev = summaryForMonth(prevMonthKey);
  const updatesMap = {};
  updatesMap[`${state.financePath}/balance/snapshots/${prevMonthKey}`] = prev;
  updatesMap[`${state.financePath}/balance/lastSeenMonthKey`] = currentMonthKey;
  await safeFirebase(() => update(ref(db), updatesMap));
  toast(`Snapshot mensual ${prevMonthKey} guardado`);
  log('balance init', { currentMonthKey, prevMonthKey, prev });
}

function renderFinanceNav() {
  const nav = document.getElementById('finance-topnav');
  if (!nav) return;
  const items = [['home', '🪙'], ['balance', '⚖️'], ['goals', '🎯'], ['calendar', '📅'], ['products', '🛒']];
  nav.innerHTML = `<div class="financeInnerNav" aria-label="Secciones de finanzas">${items.map(([id, label]) => `<button type="button" class="finance-topnav__btn ${state.activeView === id ? 'is-active' : ''}" data-finance-view="${id}" aria-pressed="${state.activeView === id ? 'true' : 'false'}">${label}</button>`).join('')}</div>`;
}

function renderFinanceHomePanelToggle(activeView = 'hero') {
  const currentView = normalizeHomePanelView(activeView);
  return `<div class="financePanelToggle" role="group" aria-label="Cambiar vista del panel principal">
    <button type="button" class="financePanelToggle__btn ${currentView === 'hero' ? 'is-active' : ''}" data-home-panel-view="hero" aria-pressed="${currentView === 'hero' ? 'true' : 'false'}" title="Resumen">&#129297;</button>
    <button type="button" class="financePanelToggle__btn ${currentView === 'calendar' ? 'is-active' : ''}" data-home-panel-view="calendar" aria-pressed="${currentView === 'calendar' ? 'true' : 'false'}" title="Calendario">&#128197;</button>
    <button type="button" class="financePanelToggle__btn ${currentView === 'tickets' ? 'is-active' : ''}" data-home-panel-view="tickets" aria-pressed="${currentView === 'tickets' ? 'true' : 'false'}" title="Tickets">&#129534;</button>
  </div>`;
}

function renderFinanceHeroPanel({ total, totalReal, totalRange, chart }, { withToggle = false } = {}) {
  const toggle = withToggle ? renderFinanceHomePanelToggle('hero') : '';
  return `<article class="finance__hero">
    <div class="financePanelTopbar">
      <div class="financePanelHeading"><p class="finance__eyebrow">TOTAL</p></div>
      ${toggle}
    </div>
    <h2 id="finance-totalValue">${fmtCurrency(total)}</h2>
    <p id="finance-totalDelta" class="${toneClass(totalRange.delta)}">${fmtSignedCurrency(totalRange.delta)} · ${fmtSignedPercent(totalRange.deltaPct)}</p>
    <p>Saldo real: <strong>${fmtCurrency(totalReal)}</strong> · Mi parte: <strong>${fmtCurrency(total)}</strong></p>
    <div id="finance-lineChart" class="${chart.tone}">${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos para este rango.</div>'}</div>
  </article>`;
}


function isFixedRecurring(row = {}) {
  if (!row || row.disabled) return false;
  const schedule = row.schedule || {};
  if ((schedule.frequency || 'monthly') !== 'monthly') return false;
  return true;
}

function getFixedRecurringRows(monthKey = getMonthKeyFromDate()) {
  const rows = recurringForMonth(monthKey)
    .filter((row) => isFixedRecurring(row))
    .map((row) => {
      const extras = row.extras || {};
      const emoji = String(
        extras.fixedEmoji ||
        extras.emoji ||
        row.emoji ||
        ''
      ).trim();

      const color = String(
        extras.fixedColor ||
        extras.color ||
        row.color ||
        ''
      ).trim();

      const name = String(
        extras.fixedName ||
        row.note ||
        row.category ||
        'Fijo'
      ).trim();

      return {
        ...row,
        fixedName: name,
        fixedEmoji: emoji || '💸',
        fixedColor: color || '',
        fixedAmountAbs: Math.abs(Number(row.amount || 0)),
        fixedDay: Number(String(row.dateISO || row.date || '').slice(8, 10) || 1),
      };
    });

  return rows;
}

function groupFixedRecurringByDay(monthKey = getMonthKeyFromDate()) {
  const grouped = {};
  getFixedRecurringRows(monthKey).forEach((row) => {
    const dayKey = String(row.dateISO || row.date || '');
    if (!dayKey) return;
    if (!grouped[dayKey]) grouped[dayKey] = [];
    grouped[dayKey].push(row);
  });
  return grouped;
}

function getFixedRecurringSummary(monthKey = getMonthKeyFromDate()) {
  const rows = getFixedRecurringRows(monthKey);
  const total = rows.reduce((sum, row) => sum + Math.abs(Number(row.amount || 0)), 0);

  return rows
    .map((row) => {
      const amountAbs = Math.abs(Number(row.amount || 0));
      return {
        id: String(row.recurringId || row.id || ''),
        name: row.fixedName || row.category || 'Fijo',
        emoji: row.fixedEmoji || '💸',
        color: row.fixedColor || '',
        amount: amountAbs,
        type: normalizeTxType(row.type),
        dateISO: String(row.dateISO || row.date || ''),
        day: row.fixedDay || 1,
        category: String(row.category || ''),
        accountId: String(row.accountId || ''),
        percentage: total > 0 ? (amountAbs / total) * 100 : 0,
      };
    })
    .sort((a, b) => b.amount - a.amount);
}
function getFixedExpenseChartRows(monthKey = getMonthKeyFromDate()) {
  const rows = getFixedRecurringSummary(monthKey);
  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);

  return rows.map((row, index) => ({
    name: `${row.emoji || '💸'} ${row.name || 'Fijo'}`.trim(),
    value: Number(row.amount || 0),
    pct: total > 0 ? (Number(row.amount || 0) / total) * 100 : 0,
    color: categoryColor(index),
    _key: String(row.id || firebaseSafeKey(row.name || `fixed-${index}`)),
    productKey: String(row.id || firebaseSafeKey(row.name || `fixed-${index}`)),
    midAngle: 0
  }));
}

function getFixedExpenseLineSeries(monthBack = 5) {
  const seriesMap = {};
  const monthKeys = [];

  for (let i = monthBack; i >= 0; i -= 1) {
    const monthKey = offsetMonthKey(getMonthKeyFromDate(), -i);
    monthKeys.push(monthKey);

    getFixedRecurringSummary(monthKey).forEach((row) => {
      const key = String(row.id || firebaseSafeKey(row.name || 'fixed'));
      if (!seriesMap[key]) {
        seriesMap[key] = {
          key,
          name: row.name || 'Fijo',
          emoji: row.emoji || '💸',
          values: {}
        };
      }
      seriesMap[key].values[monthKey] = Number(row.amount || 0);
    });
  }

  return {
    monthKeys,
    series: Object.values(seriesMap).map((item) => ({
      ...item,
      points: monthKeys.map((monthKey) => ({
        monthKey,
        value: Number(item.values[monthKey] || 0)
      }))
    }))
  };
}
function defaultFixedExpenseFormState() {
  const monthKey = offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset || 0);
  const accounts = buildAccountModels();
  const defaultAccountId =
    state.calendarAccountId && state.calendarAccountId !== 'total'
      ? state.calendarAccountId
      : (accounts[0]?.id || '');

  return {
    id: '',
    name: '',
    emoji: '💸',
    amount: '',
    type: 'expense',
    category: 'Fijos',
    accountId: defaultAccountId,
    dayOfMonth: 1,
    startDate: `${monthKey}-01`,
    endDate: '',
    active: true,
    autoCreate: true,
    color: '',
    note: ''
  };
}

function fixedExpenseFormStateFromRecurring(recurringId = '', recurringData = {}) {
  if (!recurringId || !recurringData) return defaultFixedExpenseFormState();
  
  const extras = recurringData.extras || {};
  const schedule = recurringData.schedule || {};
  const amount = Math.abs(Number(recurringData.amount || 0));
  
  return {
    id: recurringId,
    name: extras.fixedName || recurringData.note || recurringData.category || '',
    emoji: extras.fixedEmoji || '💸',
    amount: amount ? String(amount) : '',
    type: recurringData.type === 'income' ? 'income' : 'expense',
    category: recurringData.category || 'Fijos',
    accountId: recurringData.accountId || '',
    dayOfMonth: Math.max(1, Math.min(31, Number(schedule.dayOfMonth || 1))),
    startDate: schedule.startDate || '',
    endDate: schedule.endDate || '',
    active: !recurringData.disabled,
    autoCreate: recurringData.autoCreate !== false,
    color: extras.fixedColor || '',
    note: recurringData.note || '',
    createdAt: recurringData.createdAt || 0
  };
}
function shuffleFixedExpenseRows(rows = []) {
  const sorted = [...rows].sort((a, b) => (
    Number(b.amount || 0) - Number(a.amount || 0)
    || String(a.id || '').localeCompare(String(b.id || ''))
  ));
  const bucketSize = rows.length >= 10 ? 4 : rows.length >= 6 ? 3 : 2;
  const mixed = [];
  for (let index = 0; index < sorted.length; index += bucketSize) {
    const bucket = sorted.slice(index, index + bucketSize);
    for (let cursor = bucket.length - 1; cursor > 0; cursor -= 1) {
      const swapIndex = Math.floor(Math.random() * (cursor + 1));
      [bucket[cursor], bucket[swapIndex]] = [bucket[swapIndex], bucket[cursor]];
    }
    mixed.push(...bucket);
  }
  return mixed;
}
function truncateFixedExpenseLabel(value = '', maxLength = 20) {
  const text = String(value || '').trim();
  if (text.length <= maxLength) return text;
  return `${text.slice(0, Math.max(1, maxLength - 1)).trimEnd()}...`;
}
function formatFixedExpenseYearly(value = 0) {
  return `~${fmtCurrency(value)}/yr`;
}
function formatFixedExpensePct(value = 0) {
  return `${Math.round(Number(value || 0))}%`;
}
function getFixedExpenseTreemapMetrics(count = 0) {
  const viewportWidth = typeof window !== 'undefined' ? Number(window.innerWidth || 0) : 1280;
  const safeCount = Math.max(1, Number(count || 0));
  if (viewportWidth <= 480) {
    const width = Math.max(320, viewportWidth - 28);
    const height = Math.min(560, 388 + Math.max(0, safeCount - 6) * 18);
    return { width, height, gap: 8 };
  }
  if (viewportWidth <= 720) {
    const width = Math.max(360, Math.min(520, viewportWidth - 44));
    const height = Math.min(620, 430 + Math.max(0, safeCount - 7) * 16);
    return { width, height, gap: 10 };
  }
  if (viewportWidth <= 1080) {
    return { width: 560, height: Math.min(660, 478 + Math.max(0, safeCount - 8) * 14), gap: 12 };
  }
  return { width: 600, height: Math.min(700, 520 + Math.max(0, safeCount - 9) * 12), gap: 14 };
}
const FIXED_EXPENSE_TREEMAP_MIN_RATIO = 0.55;
const FIXED_EXPENSE_TREEMAP_MAX_RATIO = 2.2;
const FIXED_EXPENSE_TREEMAP_RESIDUAL_RATIO = 2.6;

function getFixedExpenseRectAspectRatio(rect = {}) {
  return Math.max(0.0001, Number(rect.width || 0)) / Math.max(0.0001, Number(rect.height || 0));
}
function getFixedExpenseAspectPenalty(width = 1, height = 1) {
  const ratio = Math.max(0.0001, Number(width || 0)) / Math.max(0.0001, Number(height || 0));
  const normalized = ratio >= 1 ? ratio : 1 / ratio;
  const lowerOverflow = ratio < FIXED_EXPENSE_TREEMAP_MIN_RATIO ? (FIXED_EXPENSE_TREEMAP_MIN_RATIO / ratio) - 1 : 0;
  const upperOverflow = ratio > FIXED_EXPENSE_TREEMAP_MAX_RATIO ? (ratio / FIXED_EXPENSE_TREEMAP_MAX_RATIO) - 1 : 0;
  return normalized + (lowerOverflow * 14) + (upperOverflow * 14);
}
function layoutFixedExpenseTreemapRow(row = [], rect = { x: 0, y: 0, width: 1, height: 1 }, orientation = 'auto') {
  if (!row.length) return { items: [], remainingRect: rect };
  const totalArea = row.reduce((sum, item) => sum + Number(item.treemapArea || 0), 0);
  const horizontal = orientation === 'horizontal'
    ? true
    : orientation === 'vertical'
      ? false
      : rect.width >= rect.height;
  const items = [];
  if (horizontal) {
    const rowHeight = totalArea / Math.max(rect.width, 0.0001);
    let x = rect.x;
    row.forEach((item) => {
      const width = Number(item.treemapArea || 0) / Math.max(rowHeight, 0.0001);
      items.push({ ...item, x, y: rect.y, width, height: rowHeight });
      x += width;
    });
    return {
      items,
      remainingRect: {
        x: rect.x,
        y: rect.y + rowHeight,
        width: rect.width,
        height: Math.max(0, rect.height - rowHeight),
      },
      orientation: 'horizontal',
      rowSize: rowHeight,
    };
  }
  const rowWidth = totalArea / Math.max(rect.height, 0.0001);
  let y = rect.y;
  row.forEach((item) => {
    const height = Number(item.treemapArea || 0) / Math.max(rowWidth, 0.0001);
    items.push({ ...item, x: rect.x, y, width: rowWidth, height });
    y += height;
  });
  return {
    items,
    remainingRect: {
      x: rect.x + rowWidth,
      y: rect.y,
      width: Math.max(0, rect.width - rowWidth),
      height: rect.height,
    },
    orientation: 'vertical',
    rowSize: rowWidth,
  };
}
function evaluateFixedExpenseTreemapRow(row = [], rect = { x: 0, y: 0, width: 1, height: 1 }, orientation = 'horizontal') {
  const layout = layoutFixedExpenseTreemapRow(row, rect, orientation);
  const penalties = layout.items.map((item) => getFixedExpenseAspectPenalty(item.width, item.height));
  const worstPenalty = penalties.length ? Math.max(...penalties) : Number.POSITIVE_INFINITY;
  const totalPenalty = penalties.reduce((sum, penalty) => sum + penalty, 0);
  const shortSide = Math.max(1, Math.min(Number(rect.width || 0), Number(rect.height || 0)));
  const minDesiredStrip = shortSide * 0.2;
  const thinStripPenalty = layout.rowSize < minDesiredStrip
    ? ((minDesiredStrip - layout.rowSize) / Math.max(1, minDesiredStrip)) * 8
    : 0;
  const crowdedRowPenalty = row.length > 4 ? (row.length - 4) * 0.65 : 0;
  return {
    ...layout,
    worstPenalty,
    score: (worstPenalty * 4.5) + (totalPenalty * 0.35) + thinStripPenalty + crowdedRowPenalty,
  };
}
function getBestFixedExpenseTreemapRowLayout(row = [], rect = { x: 0, y: 0, width: 1, height: 1 }) {
  const horizontal = evaluateFixedExpenseTreemapRow(row, rect, 'horizontal');
  const vertical = evaluateFixedExpenseTreemapRow(row, rect, 'vertical');
  return horizontal.score <= vertical.score ? horizontal : vertical;
}
function shouldUseFixedExpenseBinaryFallback(rect = {}, pendingCount = 0) {
  const ratio = getFixedExpenseRectAspectRatio(rect);
  const extremeRatio = Math.max(ratio, 1 / Math.max(ratio, 0.0001));
  return pendingCount >= 3 && extremeRatio >= FIXED_EXPENSE_TREEMAP_RESIDUAL_RATIO;
}
function splitFixedExpenseTreemapItems(items = []) {
  if (items.length <= 1) return [items.slice(), []];
  const totalArea = items.reduce((sum, item) => sum + Number(item.treemapArea || 0), 0);
  let runningArea = 0;
  let bestIndex = 1;
  let bestDelta = Number.POSITIVE_INFINITY;
  for (let index = 1; index < items.length; index += 1) {
    runningArea += Number(items[index - 1].treemapArea || 0);
    const delta = Math.abs((totalArea / 2) - runningArea);
    if (delta < bestDelta) {
      bestDelta = delta;
      bestIndex = index;
    }
  }
  return [items.slice(0, bestIndex), items.slice(bestIndex)];
}
function layoutFixedExpenseBinaryTreemap(items = [], rect = { x: 0, y: 0, width: 1, height: 1 }) {
  if (!items.length) return [];
  if (items.length === 1) {
    return [{ ...items[0], x: rect.x, y: rect.y, width: rect.width, height: rect.height }];
  }
  const [first, second] = splitFixedExpenseTreemapItems(items);
  if (!first.length || !second.length) {
    return items.map((item, index) => ({
      ...item,
      x: rect.x,
      y: rect.y + ((rect.height / items.length) * index),
      width: rect.width,
      height: rect.height / items.length,
    }));
  }
  const firstArea = first.reduce((sum, item) => sum + Number(item.treemapArea || 0), 0);
  const secondArea = second.reduce((sum, item) => sum + Number(item.treemapArea || 0), 0);
  const totalArea = Math.max(0.0001, firstArea + secondArea);
  if (rect.width >= rect.height) {
    const firstWidth = rect.width * (firstArea / totalArea);
    return [
      ...layoutFixedExpenseBinaryTreemap(first, { x: rect.x, y: rect.y, width: firstWidth, height: rect.height }),
      ...layoutFixedExpenseBinaryTreemap(second, { x: rect.x + firstWidth, y: rect.y, width: Math.max(0, rect.width - firstWidth), height: rect.height }),
    ];
  }
  const firstHeight = rect.height * (firstArea / totalArea);
  return [
    ...layoutFixedExpenseBinaryTreemap(first, { x: rect.x, y: rect.y, width: rect.width, height: firstHeight }),
    ...layoutFixedExpenseBinaryTreemap(second, { x: rect.x, y: rect.y + firstHeight, width: rect.width, height: Math.max(0, rect.height - firstHeight) }),
  ];
}
function resolveFixedExpenseTreemapSize(node = {}, metrics = { width: 1, height: 1 }) {
  const totalArea = Math.max(1, Number(metrics.width || 1) * Number(metrics.height || 1));
  const areaRatio = (Math.max(0, Number(node.width || 0)) * Math.max(0, Number(node.height || 0))) / totalArea;
  const minSide = Math.min(Number(node.width || 0), Number(node.height || 0));
  if (areaRatio >= 0.16 || (areaRatio >= 0.11 && minSide >= 170)) return 'large';
  if (areaRatio >= 0.085 || minSide >= 130) return 'medium';
  if (areaRatio >= 0.045 || minSide >= 92) return 'small';
  return 'tiny';
}
function resolveFixedExpenseLayoutVariant(node = {}, metrics = { width: 1, height: 1 }) {
  const width = Math.max(1, Number(node.width || 0));
  const height = Math.max(1, Number(node.height || 0));
  const aspectRatio = width / height;
  const totalArea = Math.max(1, Number(metrics.width || 1) * Number(metrics.height || 1));
  const areaRatio = (width * height) / totalArea;
  const minSide = Math.min(width, height);

  if (areaRatio <= 0.028 || width <= 94 || height <= 66 || minSide <= 58) return 'compact';
  if (aspectRatio >= 1.95 && height <= 110 && minSide <= 108 && areaRatio <= 0.082) return 'wide';
  if (aspectRatio <= 0.7 && width <= 110 && minSide <= 106 && areaRatio <= 0.072) return 'tall';
  if (areaRatio >= 0.072 || minSide >= 112 || height >= 124) return 'large';
  if (aspectRatio >= 2.2 && height <= 122 && areaRatio <= 0.095) return 'wide';
  if (aspectRatio <= 0.62 && width <= 118) return 'tall';
  if (areaRatio <= 0.04 || minSide <= 76) return 'compact';
  return 'large';
}
function clampFixedExpenseVisualValue(value, min, max) {
  return Math.min(max, Math.max(min, Number(value || 0)));
}
function estimateFixedExpenseTextWidth(text = '', fontSize = 14, kind = 'body') {
  const content = String(text || '');
  let units = 0;
  for (const char of content) {
    if (char === ' ') units += 0.28;
    else if (/[MW@#%&8]/.test(char)) units += 0.92;
    else if (/[A-ZÁÉÍÓÚÜÑ]/.test(char)) units += 0.72;
    else if (/[0-9]/.test(char)) units += kind === 'amount' ? 0.64 : 0.6;
    else if (/[.,:;|/\\-]/.test(char)) units += 0.34;
    else if (/[€$£¥+~]/.test(char)) units += 0.62;
    else units += kind === 'amount' ? 0.58 : 0.54;
  }
  return units * Number(fontSize || 14);
}
function estimateFixedExpenseWrappedLines(text = '', fontSize = 14, availableWidth = 120, kind = 'body') {
  const width = Math.max(1, Number(availableWidth || 0));
  const words = String(text || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 1;
  let lines = 1;
  let lineWidth = 0;
  for (const word of words) {
    const wordWidth = estimateFixedExpenseTextWidth(word, fontSize, kind);
    const spaceWidth = lineWidth > 0 ? estimateFixedExpenseTextWidth(' ', fontSize, kind) : 0;
    if (lineWidth > 0 && (lineWidth + spaceWidth + wordWidth) <= width) {
      lineWidth += spaceWidth + wordWidth;
      continue;
    }
    if (wordWidth <= width) {
      if (lineWidth > 0) lines += 1;
      lineWidth = wordWidth;
      continue;
    }
    const chunks = Math.max(1, Math.ceil(wordWidth / width));
    if (lineWidth > 0) lines += 1;
    lines += chunks - 1;
    lineWidth = wordWidth / chunks;
  }
  return lines;
}
function truncateFixedExpenseTextToFit(text = '', fontSize = 14, availableWidth = 120, maxLines = 1, kind = 'body') {
  const source = String(text || '').trim();
  if (!source) return '';
  if (estimateFixedExpenseWrappedLines(source, fontSize, availableWidth, kind) <= maxLines) return source;
  let value = source;
  while (value.length > 1) {
    const next = `${value.trimEnd()}...`;
    if (estimateFixedExpenseWrappedLines(next, fontSize, availableWidth, kind) <= maxLines) return next;
    value = value.slice(0, -1);
  }
  return source.slice(0, 1);
}
function fitFixedExpenseTextBlock({
  text = '',
  baseFont = 14,
  minFont = 10,
  availableWidth = 120,
  preferredLines = 1,
  maxLines = 2,
  baseLineHeight = 1.1,
  minLineHeight = 0.96,
  kind = 'body',
}) {
  const source = String(text || '').trim();
  const preferred = Math.max(1, Number(preferredLines || 1));
  const allowed = Math.max(preferred, Number(maxLines || preferred));
  const minSize = Math.min(Number(baseFont || 14), Number(minFont || 10));
  const lineHeightStep = 0.04;

  for (let linesLimit = preferred; linesLimit <= allowed; linesLimit += 1) {
    for (let fontSize = Math.round(baseFont); fontSize >= Math.round(minSize); fontSize -= 1) {
      for (let lineHeight = Number(baseLineHeight); lineHeight >= Number(minLineHeight); lineHeight = Number((lineHeight - lineHeightStep).toFixed(2))) {
        const estimatedLines = estimateFixedExpenseWrappedLines(source, fontSize, availableWidth, kind);
        if (estimatedLines <= linesLimit) {
          return {
            fontSize,
            lineHeight,
            linesLimit,
            truncated: false,
            text: source,
          };
        }
      }
    }
  }

  const fontSize = Math.round(minSize);
  const lineHeight = Number(minLineHeight);
  return {
    fontSize,
    lineHeight,
    linesLimit: allowed,
    truncated: true,
    text: truncateFixedExpenseTextToFit(source, fontSize, availableWidth, allowed, kind),
  };
}
function fitFixedExpenseInlineText({
  text = '',
  baseFont = 18,
  minFont = 14,
  availableWidth = 120,
  kind = 'amount',
}) {
  const source = String(text || '').trim();
  for (let fontSize = Math.round(baseFont); fontSize >= Math.round(minFont); fontSize -= 1) {
    if (estimateFixedExpenseTextWidth(source, fontSize, kind) <= availableWidth) {
      return { fontSize, truncated: false, text: source };
    }
  }
  return { fontSize: Math.round(minFont), truncated: false, text: source };
}
function resolveFixedExpenseVisualTokens(node = {}, metrics = { width: 1, height: 1 }) {
  const boxWidth = Math.max(1, Number(node.width || 0));
  const boxHeight = Math.max(1, Number(node.height || 0));
  const boxArea = boxWidth * boxHeight;
  const aspectRatio = boxWidth / boxHeight;
  const minSide = Math.min(boxWidth, boxHeight);
  const layoutArea = Math.max(1, Number(metrics.width || 1) * Number(metrics.height || 1));
  const areaRatio = boxArea / layoutArea;
  const layoutVariant = node.layoutVariant || resolveFixedExpenseLayoutVariant(node, metrics);

  let sizeTier = 'md';
  if (minSide >= 200 || areaRatio >= 0.16) sizeTier = 'xl';
  else if (minSide >= 158 || areaRatio >= 0.1) sizeTier = 'lg';
  else if (minSide >= 120 || areaRatio >= 0.06) sizeTier = 'md';
  else if (minSide >= 92 || areaRatio >= 0.038) sizeTier = 'sm';
  else sizeTier = 'xs';

  const densityBias = layoutVariant === 'compact'
    ? 0.84
    : layoutVariant === 'wide'
      ? 0.94
      : layoutVariant === 'tall'
        ? 0.9
        : 1;
  const fontScale = clampFixedExpenseVisualValue((minSide / 132) * densityBias, 0.68, 1.28);
  const emojiScale = clampFixedExpenseVisualValue((minSide / 120) * (layoutVariant === 'wide' ? 0.9 : 1), 0.72, 1.32);
  const paddingScale = clampFixedExpenseVisualValue((minSide / 144) * densityBias, 0.72, 1.18);

  let cellPad = Math.round(clampFixedExpenseVisualValue(minSide * 0.115 * paddingScale, 8, 22));
  let cellGap = Math.round(clampFixedExpenseVisualValue(minSide * 0.072 * densityBias, 4, 14));
  let bodyGap = Math.round(clampFixedExpenseVisualValue(cellGap * 0.45, 2, 8));
  const emojiSize = Math.round(clampFixedExpenseVisualValue(minSide * 0.27 * emojiScale, 18, 50));
  const pctFontBase = Math.round(clampFixedExpenseVisualValue(minSide * 0.09 * densityBias, 9, 14));
  const pctPadYBase = Math.round(clampFixedExpenseVisualValue(minSide * 0.035, 3, 6));
  const pctPadXBase = Math.round(clampFixedExpenseVisualValue(minSide * 0.075, 7, 12));
  const pctMinWidthBase = Math.round(clampFixedExpenseVisualValue(minSide * 0.38, 0, 56));
  const nameFontBase = Math.round(clampFixedExpenseVisualValue(
    minSide * (layoutVariant === 'wide' ? 0.09 : layoutVariant === 'compact' ? 0.085 : 0.105) * fontScale,
    10,
    24,
  ));
  const amountFontBase = Math.round(clampFixedExpenseVisualValue(
    minSide * (layoutVariant === 'compact' ? 0.135 : layoutVariant === 'tall' ? 0.145 : 0.16) * fontScale,
    14,
    36,
  ));
  let annualFont = Math.round(clampFixedExpenseVisualValue(minSide * 0.076 * densityBias, 9, 14));
  const cornerRadius = Math.round(clampFixedExpenseVisualValue(minSide * 0.16, 12, 24));
  const bodyMaxWidth = `${Math.round(clampFixedExpenseVisualValue(
    layoutVariant === 'wide' ? 100 : layoutVariant === 'tall' ? 94 : 92,
    82,
    100,
  ))}%`;

  const amountText = fmtCurrency(node.amount || 0);
  const annualText = formatFixedExpenseYearly(Number(node.amount || 0) * 12);
  const sourceName = String(node.name || 'Fijo').trim() || 'Fijo';

  const preferredNameLines = layoutVariant === 'wide'
    ? 1
    : layoutVariant === 'compact'
      ? 1
      : layoutVariant === 'tall'
        ? 2
        : 2;
  const supportedNameLines = layoutVariant === 'compact'
    ? 1
    : layoutVariant === 'wide'
      ? (boxHeight >= 112 ? 2 : 1)
      : layoutVariant === 'tall'
        ? 3
        : 2;

  let showAnnual = !(layoutVariant === 'compact' || sizeTier === 'xs' || boxHeight < 88 || boxWidth < 104);
  let showPct = !(sizeTier === 'xs' || (layoutVariant === 'compact' && boxWidth < 126) || boxWidth < 84 || boxHeight < 52);
  const showName = !(sizeTier === 'xs' && boxWidth < 72);
  const amountEmphasis = sizeTier === 'xl' || sizeTier === 'lg' ? 'high' : sizeTier === 'xs' ? 'compact' : 'balanced';
  const nameMinFont = layoutVariant === 'compact' ? 9 : 10;
  const amountMinFont = layoutVariant === 'compact' ? 13 : 14;

  const computeTextWidth = (pctVisible = showPct) => {
    if (layoutVariant === 'wide' || layoutVariant === 'compact') {
      return Math.max(42, boxWidth - (cellPad * 2) - emojiSize - (pctVisible ? pctMinWidthBase : 0) - (cellGap * (pctVisible ? 2 : 1)));
    }
    return Math.max(48, boxWidth - (cellPad * 2));
  };
  const tightenDensity = () => {
    cellPad = Math.max(7, Math.round(cellPad * 0.9));
    cellGap = Math.max(4, Math.round(cellGap * 0.88));
    bodyGap = Math.max(2, Math.round(bodyGap * 0.84));
    annualFont = Math.max(9, Math.round(annualFont * 0.95));
  };

  let availableTextWidth = computeTextWidth(showPct);
  let amountFit = fitFixedExpenseInlineText({
    text: amountText,
    baseFont: amountFontBase,
    minFont: amountMinFont,
    availableWidth: availableTextWidth,
    kind: 'amount',
  });
  let nameFit = fitFixedExpenseTextBlock({
    text: sourceName,
    baseFont: nameFontBase,
    minFont: nameMinFont,
    availableWidth: availableTextWidth,
    preferredLines: preferredNameLines,
    maxLines: supportedNameLines,
    baseLineHeight: layoutVariant === 'compact' ? 1.03 : layoutVariant === 'wide' ? 1.06 : 1.1,
    minLineHeight: 0.94,
    kind: 'body',
  });

  if (nameFit.truncated && showPct && layoutVariant !== 'large') {
    showPct = false;
    availableTextWidth = computeTextWidth(false);
    amountFit = fitFixedExpenseInlineText({
      text: amountText,
      baseFont: amountFontBase,
      minFont: amountMinFont,
      availableWidth: availableTextWidth,
      kind: 'amount',
    });
    nameFit = fitFixedExpenseTextBlock({
      text: sourceName,
      baseFont: nameFontBase,
      minFont: nameMinFont,
      availableWidth: availableTextWidth,
      preferredLines: preferredNameLines,
      maxLines: supportedNameLines,
      baseLineHeight: layoutVariant === 'compact' ? 1.03 : layoutVariant === 'wide' ? 1.06 : 1.1,
      minLineHeight: 0.94,
      kind: 'body',
    });
  }

  if (nameFit.truncated) {
    tightenDensity();
    availableTextWidth = computeTextWidth(showPct);
    amountFit = fitFixedExpenseInlineText({
      text: amountText,
      baseFont: amountFit.fontSize,
      minFont: amountMinFont,
      availableWidth: availableTextWidth,
      kind: 'amount',
    });
    nameFit = fitFixedExpenseTextBlock({
      text: sourceName,
      baseFont: nameFit.fontSize,
      minFont: nameMinFont,
      availableWidth: availableTextWidth,
      preferredLines: preferredNameLines,
      maxLines: supportedNameLines,
      baseLineHeight: nameFit.lineHeight,
      minLineHeight: 0.92,
      kind: 'body',
    });
  }

  if ((nameFit.truncated || amountFit.fontSize <= amountMinFont + 1) && showAnnual && boxHeight < 126) {
    showAnnual = false;
  }

  const nameLines = Number(nameFit.linesLimit || preferredNameLines);
  const nameMaxChars = Math.max(showName ? 6 : 0, String(nameFit.text || sourceName).replace(/\.\.\.$/, '').length);
  const pctFont = Math.round(clampFixedExpenseVisualValue(showPct ? pctFontBase : pctFontBase * 0.92, 9, 14));
  const pctPadY = Math.round(clampFixedExpenseVisualValue(pctPadYBase, 3, 6));
  const pctPadX = Math.round(clampFixedExpenseVisualValue(pctPadXBase, 7, 12));
  const pctMinWidth = showPct ? pctMinWidthBase : 0;

  return {
    boxWidth,
    boxHeight,
    boxArea,
    aspectRatio,
    sizeTier,
    fontScale,
    emojiScale,
    paddingScale,
    showAnnual,
    showName,
    showPct,
    nameLines,
    nameMaxChars,
    amountEmphasis,
    nameText: showName ? nameFit.text : '',
    amountText,
    annualText,
    styleVars: {
      '--cell-pad': `${cellPad}px`,
      '--cell-gap': `${cellGap}px`,
      '--cell-gap-inline': `${Math.round(clampFixedExpenseVisualValue(cellGap * 0.78, 4, 12))}px`,
      '--body-gap': `${bodyGap}px`,
      '--emoji-size': `${emojiSize}px`,
      '--emoji-radius': `${Math.round(clampFixedExpenseVisualValue(cornerRadius * 0.58, 10, 16))}px`,
      '--pct-font': `${pctFont}px`,
      '--pct-pad-y': `${pctPadY}px`,
      '--pct-pad-x': `${pctPadX}px`,
      '--pct-min-width': `${pctMinWidth}px`,
      '--name-font': `${nameFit.fontSize}px`,
      '--name-lines': String(nameLines),
      '--name-line-height': String(nameFit.lineHeight),
      '--amount-font': `${amountFit.fontSize}px`,
      '--annual-font': `${annualFont}px`,
      '--corner-radius': `${cornerRadius}px`,
      '--body-max-width': bodyMaxWidth,
    },
  };
}
function buildFixedExpenseTreemap(rows = [], options = {}) {
  const metrics = { ...getFixedExpenseTreemapMetrics(rows.length), ...(options || {}) };
  if (!rows.length) return { ...metrics, items: [] };

  const layoutArea = Math.max(1, metrics.width * metrics.height);
  const normalizedRows = rows.map((row, index) => ({
    ...row,
    _treemapOrder: index,
    _value: Math.max(0, Number(row.amount || 0)),
  }));
  const totalValue = normalizedRows.reduce((sum, row) => sum + row._value, 0);
  const baseArea = totalValue > 0 ? 0 : layoutArea / Math.max(1, normalizedRows.length);
  const pending = normalizedRows
    .map((row) => ({
      ...row,
      treemapArea: totalValue > 0 ? (row._value / totalValue) * layoutArea : baseArea,
    }))
    .sort((a, b) => b.treemapArea - a.treemapArea || a._treemapOrder - b._treemapOrder);

  const frame = { x: 0, y: 0, width: metrics.width, height: metrics.height };
  const placements = [];
  let row = [];

  while (pending.length) {
    if (shouldUseFixedExpenseBinaryFallback(frame, pending.length + row.length)) {
      const residualItems = row.length ? [...row, ...pending] : pending.slice();
      placements.push(...layoutFixedExpenseBinaryTreemap(residualItems, frame));
      pending.length = 0;
      row = [];
      break;
    }
    const candidate = pending[0];
    const currentLayout = row.length ? getBestFixedExpenseTreemapRowLayout(row, frame) : null;
    const nextLayout = getBestFixedExpenseTreemapRowLayout([...row, candidate], frame);
    if (!row.length || nextLayout.score <= (currentLayout?.score ?? Number.POSITIVE_INFINITY)) {
      row.push(candidate);
      pending.shift();
      continue;
    }
    placements.push(...currentLayout.items);
    frame.x = currentLayout.remainingRect.x;
    frame.y = currentLayout.remainingRect.y;
    frame.width = currentLayout.remainingRect.width;
    frame.height = currentLayout.remainingRect.height;
    row = [];
  }

  if (row.length) {
    const laidOut = getBestFixedExpenseTreemapRowLayout(row, frame);
    placements.push(...laidOut.items);
  }

  return {
    ...metrics,
    items: placements
      .map((item) => {
        const displaySize = resolveFixedExpenseTreemapSize(item, metrics);
        const layoutVariant = resolveFixedExpenseLayoutVariant(item, metrics);
        const visualTokens = resolveFixedExpenseVisualTokens({ ...item, layoutVariant }, metrics);
        return {
          ...item,
          displaySize,
          layoutVariant,
          boxWidth: visualTokens.boxWidth,
          boxHeight: visualTokens.boxHeight,
          boxArea: visualTokens.boxArea,
          aspectRatio: visualTokens.aspectRatio,
          sizeTier: visualTokens.sizeTier,
          fontScale: visualTokens.fontScale,
          emojiScale: visualTokens.emojiScale,
          paddingScale: visualTokens.paddingScale,
          showAnnual: visualTokens.showAnnual,
          showName: visualTokens.showName,
          showPct: visualTokens.showPct,
          nameLines: visualTokens.nameLines,
          amountEmphasis: visualTokens.amountEmphasis,
          visualTokens,
        };
      })
      .sort((a, b) => a.y - b.y || a.x - b.x),
  };
}
function renderFixedExpenseSquares(monthKey = getMonthKeyFromDate()) {
  const rows = getFixedRecurringSummary(monthKey);
  if (!rows.length) return '<p class="finance-empty">Sin gastos fijos este mes.</p>';

  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0);
  const yearlyTotal = total * 12;
  const mixedRows = rows
    .slice()
    .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0) || String(a.name || '').localeCompare(String(b.name || ''), 'es'))
    .map((row, index) => ({
    ...row,
    emoji: (String(row.emoji || '').trim() && !/^(?:í|ð)/.test(String(row.emoji || '').trim())) ? row.emoji : '💸',
    color: row.color || categoryColor(index),
  }));
  const treemap = buildFixedExpenseTreemap(mixedRows);
  const gap = Number(treemap.gap || 0);
  const halfGap = gap / 2;

  return `
    <div class="financeFixedSquaresContainer">
      <div class="financeFixedSquaresTreemap" style="--fixed-treemap-height:${Math.round(treemap.height)}px; --fixed-treemap-gap:${gap}px;">
        ${treemap.items.map((row) => {
          const percentage = total > 0 ? (Number(row.amount || 0) / total) * 100 : Number(row.percentage || 0);
          const itemEmoji = /^(?:�|�)/.test(String(row.emoji || '').trim()) ? '??' : (String(row.emoji || '').trim() || '??');
          const layoutVariant = row.layoutVariant || 'large';
          const visualTokens = row.visualTokens || {};
          const showAnnual = visualTokens.showAnnual !== false;
          const showName = visualTokens.showName !== false;
          const showPct = visualTokens.showPct !== false;
          const compactName = String(visualTokens.nameText || row.name || 'Fijo');
          const amountText = String(visualTokens.amountText || fmtCurrency(row.amount || 0));
          const annualText = String(visualTokens.annualText || formatFixedExpenseYearly(Number(row.amount || 0) * 12));
          const visualVarEntries = Object.entries(visualTokens.styleVars || {}).map(([key, value]) => `${key}:${value}`);
          const cellStyle = [
            `left:calc(${((Number(row.x || 0) / Math.max(1, treemap.width)) * 100).toFixed(4)}% + ${halfGap}px)`,
            `top:calc(${((Number(row.y || 0) / Math.max(1, treemap.height)) * 100).toFixed(4)}% + ${halfGap}px)`,
            `width:max(0px, calc(${((Number(row.width || 0) / Math.max(1, treemap.width)) * 100).toFixed(4)}% - ${gap}px))`,
            `height:max(0px, calc(${((Number(row.height || 0) / Math.max(1, treemap.height)) * 100).toFixed(4)}% - ${gap}px))`,
            `--square-color:${row.color || '#65d8ff'}`,
            ...visualVarEntries,
          ].join(';');
          return `
            <button
              type="button"
              class="financeFixedSquareCell is-${row.displaySize} is-layout-${layoutVariant}"
              data-fixed-expense-edit="${escapeHtml(String(row.id || ''))}"
              data-layout-variant="${escapeHtml(layoutVariant)}"
              data-size-tier="${escapeHtml(String(visualTokens.sizeTier || row.displaySize || 'md'))}"
              id="fixed-expense-square-${escapeHtml(String(row.id || ''))}"
              title="${escapeHtml(row.name || 'Fijo')} - ${fmtCurrency(row.amount || 0)} - ${percentage.toFixed(1)}%"
              style="${cellStyle}"
            >
              <span class="financeFixedSquareCell__emoji">${escapeHtml(itemEmoji)}</span>
              ${showPct ? `<span class="financeFixedSquareCell__pct">${formatFixedExpensePct(percentage)}</span>` : ''}
              <span class="financeFixedSquareCell__body">
                ${showName ? `<strong class="financeFixedSquareCell__name">${escapeHtml(compactName || 'Fijo')}</strong>` : ''}
                <span class="financeFixedSquareCell__amount">${escapeHtml(amountText)}</span>
                ${showAnnual ? `<span class="financeFixedSquareCell__annual">${escapeHtml(annualText)}</span>` : ''}
              </span>
            </button>
          `;
        }).join('')}
      </div>
      <div class="financeFixedSquaresSummary">
        <div class="financeFixedSquaresSummary__block">
          <span class="financeFixedSquaresSummary__label">TOTAL / MONTH</span>
          <strong class="financeFixedSquaresSummary__value">${fmtCurrency(total)}</strong>
        </div>
        <div class="financeFixedSquaresSummary__block is-yearly">
          <span class="financeFixedSquaresSummary__label">YEARLY PROJECTION</span>
          <strong class="financeFixedSquaresSummary__value">${fmtCurrency(yearlyTotal)}</strong>
        </div>
      </div>
    </div>
  `;
}
function renderFixedExpenseDonut(monthKey = getMonthKeyFromDate()) {
  const rows = getFixedExpenseChartRows(monthKey);
  if (!rows.length) return '<p class="finance-empty">Sin datos para donut.</p>';

  return `
    <div class="financeFixedDonutWrap" id="financeFixedDonutContainer">
      <div
        class="financeStats__donut"
        id="financeFixedDonut"
        data-finance-stats-donut='${escapeHtml(JSON.stringify(rows))}'
        data-finance-stats-donut-wrap
        style="min-height: 240px; width: 100%;"
      ></div>
    </div>
  `;
}
function renderFixedExpenseLineChart() {
  const data = getFixedExpenseLineSeries(5);
  if (!data.series.length) return '<p class="finance-empty">Sin histórico para gráfico.</p>';

  const maxValue = Math.max(
    1,
    ...data.series.flatMap((serie) => serie.points.map((point) => Number(point.value || 0)))
  );

  const width = 100;
  const height = 44;

  const lines = data.series.map((serie, serieIndex) => {
    const points = serie.points.map((point, index) => {
      const x = data.monthKeys.length === 1 ? 0 : (index / (data.monthKeys.length - 1)) * width;
      const y = height - ((Number(point.value || 0) / maxValue) * height);
      return `${x},${y}`;
    }).join(' ');

    return `
      <g class="financeFixedLineGroup" data-fixed-line-key="${escapeHtml(serie.key)}">
        <polyline
          class="financeFixedLine financeFixedLine--${serieIndex % 6}"
          fill="none"
          points="${points}"
        ></polyline>
      </g>
    `;
  }).join('');

  const legend = data.series.map((serie) => `
    <button type="button" class="financeFixedLegendItem" id="fixed-line-legend-${escapeHtml(serie.key)}" data-fixed-line-filter="${escapeHtml(serie.key)}">
      <span>${escapeHtml(serie.emoji || '💸')}</span>
      <span>${escapeHtml(serie.name || 'Fijo')}</span>
    </button>
  `).join('');

  return `
    <div class="financeFixedLineWrap" id="financeFixedLineChartContainer">
      <svg class="financeFixedLineChart" id="financeFixedLineChart" viewBox="0 0 100 44" preserveAspectRatio="none">
        ${lines}
      </svg>
      <div class="financeFixedLineMonths">
        ${data.monthKeys.map((monthKey, idx) => `<span id="fixed-line-month-${idx}">${escapeHtml(monthKey.slice(5, 7))}/${escapeHtml(monthKey.slice(2, 4))}</span>`).join('')}
      </div>
      <div class="financeFixedLegend" id="financeFixedLineLegend">${legend}</div>
    </div>
  `;
}
console.log('FIXED RECURRING HELPERS OK');

function getBalanceTrendSeries(accountsById = {}, txRows = balanceTxList(), trendMode = 'expense', trendCategory = 'all') {
  const seriesMap = {};
  const monthKeys = [];
  const allMonthsSet = new Set();

  txRows.forEach((tx) => {
    const monthKey = String(tx.monthKey || '');
    if (monthKey) allMonthsSet.add(monthKey);
  });

  const sortedMonths = Array.from(allMonthsSet).sort();
  monthKeys.push(...sortedMonths);

  if (monthKeys.length === 0) {
    return { monthKeys: [], series: [], tone: 'is-neutral' };
  }

  const filteredTx = txRows.filter((tx) => {
    const txType = normalizeTxType(tx.type);
    if (trendMode === 'expense' && txType !== 'expense') return false;
    if (trendMode === 'income' && txType !== 'income') return false;
    if (trendMode === 'all') return true;
    if (trendCategory !== 'all' && tx.category !== trendCategory) return false;
    return true;
  });

  if (trendCategory === 'all') {
    const categoryVolume = {};
    filteredTx.forEach((tx) => {
      const cat = tx.category || 'sin-categoría';
      categoryVolume[cat] = (categoryVolume[cat] || 0) + Math.abs(Number(tx.amount || 0));
    });

    let categoriesToShow = Object.entries(categoryVolume)
      .sort(([, a], [, b]) => b - a)
      .map(([cat]) => cat);

    if (categoriesToShow.length > 8) {
      categoriesToShow = categoriesToShow.slice(0, 7);
    }

    categoriesToShow.forEach((category) => {
      const key = category;
      seriesMap[key] = {
        key,
        name: category,
        emoji: categoryEmojiForName(category),
        values: {},
        type: trendMode
      };

      filteredTx.filter((tx) => (tx.category || 'sin-categoría') === category).forEach((tx) => {
        const monthKey = String(tx.monthKey || '');
        if (!monthKey) return;
        seriesMap[key].values[monthKey] = (seriesMap[key].values[monthKey] || 0) + Number(tx.amount || 0);
      });
    });
  } else {
    const key = trendCategory;
    seriesMap[key] = {
      key,
      name: trendCategory,
      emoji: categoryEmojiForName(trendCategory),
      values: {},
      type: trendMode
    };

    filteredTx.forEach((tx) => {
      const monthKey = String(tx.monthKey || '');
      if (!monthKey) return;
      seriesMap[key].values[monthKey] = (seriesMap[key].values[monthKey] || 0) + Number(tx.amount || 0);
    });
  }

  const colors = ['#4bf2a8', '#ff708f', '#9db0df', '#ffa500', '#ff69b4', '#00d4ff', '#baff12', '#ff6b6b'];
  const series = Object.values(seriesMap)
    .filter((s) => Object.values(s.values).some((v) => v !== 0))
    .map((item, idx) => {
      let color = '#ff708f';
      if (trendMode === 'income') color = '#4bf2a8';
      else if (trendMode === 'all') color = colors[idx % colors.length];
      else if (trendCategory === 'all') color = colors[idx % colors.length];
      return {
        ...item,
        color,
        points: monthKeys.map((monthKey) => ({
          monthKey,
          value: Number(item.values[monthKey] || 0)
        }))
      };
    });

  const allValues = series.flatMap((s) => s.points.map((p) => Math.abs(Number(p.value || 0))));
  const maxValue = allValues.length ? Math.max(...allValues) : 1;
  const tone = trendMode === 'income' ? 'is-positive' : (trendMode === 'all' ? 'is-neutral' : 'is-negative');

  return { monthKeys, series, tone, maxValue };
}

function renderBalanceTrendChart(data = { monthKeys: [], series: [], tone: 'is-neutral' }) {
  if (!data.series.length) {
    return '<p class="finance-empty">Sin datos.</p>';
  }

  const width = 280;
  const height = 100;
  const pad = 8;
  const labelHeight = 12;
  const chartH = height - pad * 2 - labelHeight;
  const chartW = width - pad * 2;

  const allVals = data.series.flatMap((s) => data.monthKeys.map((m) => Math.abs(Number(s.values?.[m] || 0))));
  const maxVal = allVals.length ? Math.max(...allVals) : 1;
  const range = Math.max(1, maxVal);

  const lines = data.series.map((serie) => {
    const points = data.monthKeys.map((monthKey, idx) => {
      const pct = data.monthKeys.length > 1 ? idx / (data.monthKeys.length - 1) : 0.5;
      const x = pad + pct * chartW;
      const val = Math.abs(Number(serie.values?.[monthKey] || 0));
      const normalized = Math.max(0, Math.min(1, val / range));
      const y = pad + chartH - normalized * chartH;
      return { x, y, idx, monthKey, val };
    });

    const path = points.map((p, i) => {
      if (i === 0) return `M${p.x.toFixed(1)},${p.y.toFixed(1)}`;
      return `L${p.x.toFixed(1)},${p.y.toFixed(1)}`;
    }).join(' ');

    return { path, color: serie.color, points, name: serie.name };
  });

  const verticalGuides = data.monthKeys.map((monthKey, idx) => {
    const pct = data.monthKeys.length > 1 ? idx / (data.monthKeys.length - 1) : 0.5;
    const x = pad + pct * chartW;
    return { x, idx, monthKey };
  });

  const dateStep = Math.max(1, Math.ceil(data.monthKeys.length / 5));
  const dateLabels = verticalGuides
    .filter(({ idx }) => idx % dateStep === 0 || idx === data.monthKeys.length - 1)
    .map(({ x, monthKey }) => {
      const mm = monthKey.slice(5, 7);
      const yy = monthKey.slice(2, 4);
      return { label: `${mm}/${yy}`, x };
    });

  const tooltipValues = data.series.length === 1 
    ? data.monthKeys.map((monthKey, idx) => {
        const pct = data.monthKeys.length > 1 ? idx / (data.monthKeys.length - 1) : 0.5;
        const x = pad + pct * chartW;
        const val = Number(data.series[0].values?.[monthKey] || 0);
        const label = idx % dateStep === 0 || idx === data.monthKeys.length - 1 ? fmtCurrency(val) : '';
        return { x, label, idx, color: data.series[0].color };
      })
    : [];

  const chartGeometry = JSON.stringify({
    monthKeys: data.monthKeys,
    seriesData: data.series.map((s) => ({ name: s.name, color: s.color, emoji: s.emoji, values: s.values || {} })),
    width, height, pad, chartH, chartW
  });

  return `
    <div id="fin-trendChart" class="${data.tone}" data-fin-chart-geometry="${escapeHtml(chartGeometry)}" style="--fin-trend-chart-height: 160px; margin-top: 10px; height: var(--fin-trend-chart-height); border-radius: 14px; border: 1px solid rgba(173, 197, 255, 0.15); background: linear-gradient(135deg, rgba(5, 15, 38, 0.5), rgba(7, 22, 54, 0.25)); padding: 10px; position: relative; display: flex; flex-direction: column;">
      <div class="grafica-balance-gastos" >
        <svg viewBox="0 0 ${width} ${height}" style="flex: 1; width: 100%; display: block; user-select: none; cursor: crosshair;">
          ${verticalGuides.map(({ x }) => `<line x1="${x.toFixed(1)}" y1="${pad.toFixed(1)}" x2="${x.toFixed(1)}" y2="${(pad + chartH).toFixed(1)}" stroke="rgba(255,255,255,0.04)" stroke-width="1"></line>`).join('')}
          ${lines.map((line) => `<path d="${line.path}" stroke="${line.color}" fill="none" stroke-width="2.5" stroke-linecap="butt" stroke-linejoin="bevel" opacity="0.9" style="filter: drop-shadow(0 0 6px ${line.color.replace(')', ', 0.4)')});"></path>`).join('')}
          ${dateLabels.map((dl) => `<text x="${dl.x.toFixed(1)}" y="${(height - 1).toFixed(1)}" font-size="10" text-anchor="middle" fill="rgba(255,255,255,0.45)" font-weight="500">${escapeHtml(dl.label)}</text>`).join('')}
          ${tooltipValues.filter((tv) => tv.label).map((tv) => `<text x="${tv.x.toFixed(1)}" y="${(pad + chartH - 8).toFixed(1)}" font-size="8" text-anchor="middle" fill="${tv.color}" opacity="0.8" font-weight="600">${escapeHtml(tv.label)}</text>`).join('')}
          <circle cx="0" cy="0" r="0" class="fin-trend-activeMarker" style="fill: none; stroke: rgba(255,255,255,0.5); stroke-width: 2; pointer-events: none; transition: all 0.1s ease;"></circle>
        </svg>
        <div data-fin-trend-tooltip style="position: absolute; top: 4px; left: 50%; transform: translateX(-50%); background: rgba(8, 14, 28, 0.9); border: 1px solid rgba(173, 197, 255, 0.3); border-radius: 8px; padding: 6px 10px; font-size: 11px; color: var(--fin-text); pointer-events: none; opacity: 0; transition: opacity 0.1s ease; white-space: nowrap; z-index: 10; backdrop-filter: blur(8px);"></div>
      </div>
      <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; font-size: 11px;">
        ${data.series.map((serie) => `<span style="display: inline-flex; align-items: center; gap: 4px; color: ${serie.color};"><span style="width: 5px; height: 5px; border-radius: 50%; background: ${serie.color}; display: inline-block; flex-shrink: 0;"></span><span>${escapeHtml(serie.emoji || '')} ${escapeHtml(serie.name)}</span></span>`).join('')}
      </div>
    </div>
  `;
}

function renderBalanceTrendControls(categories = categoriesList(), mode = 'expense', category = 'all') {
  const modeLabel = mode === 'all' ? 'Ambos' : (mode === 'income' ? 'Ingresos' : 'Gastos');
  return `
    <div class="selectores-grafica-balance" >
      <select class="finance-pill-grafica" data-balance-trend-mode style="min-width: 90px;">
        <option value="expense" ${mode === 'expense' ? 'selected' : ''}>Gastos</option>
        <option value="income" ${mode === 'income' ? 'selected' : ''}>Ingresos</option>
        <option value="all" ${mode === 'all' ? 'selected' : ''}>Ambos</option>
      </select>
      <select class="finance-pill-grafica" data-balance-trend-category style="flex: 1; min-width: 120px;">
        <option value="all" ${category === 'all' ? 'selected' : ''}>Todas las categorías</option>
        ${categories.map((cat) => `<option value="${escapeHtml(cat)}" ${category === cat ? 'selected' : ''}>${escapeHtml(categoryEmojiForName(cat) || '')} ${escapeHtml(cat)}</option>`).join('')}
      </select>
    </div>
  `;
}

console.log('BALANCE TREND HELPERS OK');


function renderFinanceCalendarPanel(accounts, totalSeries, { withToggle = false } = {}) {

  
  const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const dayCalendar = calendarData(accounts, totalSeries);
  const monthCalendar = calendarMonthData(accounts, totalSeries);
  const yearCalendar = calendarYearData(accounts, totalSeries);
  const fixedByDay = groupFixedRecurringByDay(
  offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset)
);
  const modeLabel = state.calendarMode === 'month'
    ? `${monthCalendar.year}`
    : (state.calendarMode === 'year' ? 'A&ntilde;os' : monthLabelByKey(offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset)));
  const toggle = withToggle ? renderFinanceHomePanelToggle('calendar') : '';
  let content = '';
  if (state.calendarMode === 'month') {
    content = `<div class="finance-calendar-months">${monthCalendar.months.map((point) => {
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-open-month="${point.monthKey}"><strong>${escapeHtml(point.label)}</strong><span>${point.isEmpty ? '&mdash;' : fmtSignedCurrency(point.delta)}</span><span>${point.isEmpty ? '&mdash;' : fmtSignedPercent(point.deltaPct)}</span></button>`;
    }).join('')}</div>`;
  } else if (state.calendarMode === 'year') {
    content = `<div class="finance-calendar-years">${yearCalendar.map((point) => {
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-open-year="${point.year}"><strong>${point.year}</strong><span>${point.isEmpty ? '&mdash;' : fmtSignedCurrency(point.delta)}</span></button>`;
    }).join('')}</div>`;
  } else {
    content = `<div class="finance-calendar-grid"><div class="finance-calendar-weekdays">${weekdayLabels.map((label) => `<span>${label}</span>`).join('')}</div><div class="finance-calendar-days">${dayCalendar.cells.map((point) => {
      if (!point) return '<div class="financeCalCell financeCalCell--blank"></div>';
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-day="${point.dayKey}"><strong>${point.dayNumber}</strong><span>${point.isEmpty ? '&mdash;' : fmtSignedCurrency(point.delta)}</span><span>${point.isEmpty ? '&mdash;' : fmtSignedPercent(point.deltaPct)}</span></button>`;
    }).join('')}</div></div>`;
  }
  return `<article class="finance__calendarPreview">
    <div class="financePanelTopbar">
      <div class="financePanelHeading"><h2>Calendario</h2></div>
      ${toggle}
    </div>
    <div class="finance-calendar-controls" id="selectores-calendario">
     
      <select class="finance-pill" id="selector-cuenta-calendario" data-calendar-account>
      
      <option value="total" ${state.calendarAccountId === 'total' ? 'selected' : ''}>Total</option>${accounts.map((a) => `<option value="${a.id}" ${state.calendarAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select>

      <select class="finance-pill" id="selector-rango-calendario" data-calendar-mode>
      <option value="day" ${state.calendarMode === 'day' ? 'selected' : ''}>D&iacute;a</option><option value="month" ${state.calendarMode === 'month' ? 'selected' : ''}>Mes</option><option value="year" ${state.calendarMode === 'year' ? 'selected' : ''}>A&ntilde;o</option></select>
    </div>
    
    <div id="nav-mes-calendario">
       <button type="button" class="boton-calendario" data-month-shift="-1">&#9664;</button>
    <span class="finance-month-label">${modeLabel}</span>
          <button type="button" class="boton-calendario" data-month-shift="1">&#9654;</button>
    </div>
    ${content}
  </article>`;
}

function renderFinanceHome(accounts, totalSeries) {
  const root = resolveFinanceRoot();
  if (!root) throw new Error('[finance] finance root not available before renderFinanceHome');
  if (!$opt('#finance-content')) ensureFinanceHost($opt, $req);

  const total = accounts.reduce((sum, account) => sum + account.current, 0);
  const totalReal = accounts.reduce((sum, account) => sum + Number(account.currentReal || 0), 0);
  const totalRange = computeDeltaForRange(totalSeries, state.rangeMode);
  const chart = chartModelForRange(totalSeries, state.rangeMode);
  const homePanelView = normalizeHomePanelView(state.homePanelView);
  state.lineChart = { points: chart.points || [], mode: state.rangeMode, kind: 'total' };
  const compareBounds = getRangeBounds(state.compareMode);
  const compareCurrent = computeDeltaWithinBounds(totalSeries, compareBounds);
  const previousBounds = { start: compareBounds.start - (compareBounds.end - compareBounds.start), end: compareBounds.start };
  const comparePrev = computeDeltaWithinBounds(totalSeries, previousBounds);
  const primaryPanel = homePanelView === 'calendar'
    ? renderFinanceCalendarPanel(accounts, totalSeries, { withToggle: true })
    : homePanelView === 'tickets'
      ? renderFinanceTicketPreview()
      : renderFinanceHeroPanel({ total, totalReal, totalRange, chart }, { withToggle: true });
  if (homePanelView === 'calendar' || homePanelView === 'tickets') {
    return `
      <section class="finance-home ${toneClass(totalRange.delta)} finance-home--${homePanelView}">
        ${primaryPanel}
        <article class="finance__accounts"><div class="finance__sectionHeader"><h2></h2><div class="finance-row-cuenta"><button class="finance-pill" data-new-account>+ Cuenta</button></div></div>
        <div id="finance-accountsList">${accounts.map((account) => { const editableBalance = account.shared ? account.currentReal : account.current; return `<article class="financeAccountCard ${toneClass(account.range.delta)}" data-open-detail="${account.id}"><div><strong>${escapeHtml(account.name)}</strong><div class="financeAccountCard__balanceWrap"><span class="financeAccountCard__balanceLabel">${account.shared ? 'Saldo real' : 'Mi saldo'}</span><input class="financeAccountCard__balance" data-account-input="${account.id}" value="${editableBalance.toFixed(2)}" inputmode="decimal" placeholder="" /><button class="finance-pill finance-pill--mini" data-account-save="${account.id}">Guardar</button></div>${account.shared ? `<small class="finance-shared-chip">Compartida ${(account.sharedRatio * 100).toFixed(0)}% · Mi parte: ${fmtCurrency(account.current)}</small>` : ''}</div><div class="financeAccountCard__side"><span class="financeAccountCard__deltaPill finance-chip ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]} ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span><button class="financeAccountCard__menuBtn" data-delete-account="${account.id}">⋯</button></div></article>`; }).join('') || '<p class="finance-empty">Sin cuentas todaví­a.</p>'}</div></article>
      </section>`;
  }
  return `
    <section class="finance-home ${toneClass(totalRange.delta)} finance-home--${homePanelView}">
      <article class="finance__hero"><div class="financePanelTopbar"><div class="financePanelHeading"><p class="finance__eyebrow">TOTAL</p></div>${renderFinanceHomePanelToggle('hero')}</div><h2 id="finance-totalValue">${fmtCurrency(total)}</h2>
        <p id="finance-totalDelta" class="${toneClass(totalRange.delta)}">${fmtSignedCurrency(totalRange.delta)} · ${fmtSignedPercent(totalRange.deltaPct)}</p>
        <p>Saldo real: <strong>${fmtCurrency(totalReal)}</strong> · Mi parte: <strong>${fmtCurrency(total)}</strong></p><div id="finance-lineChart" class="${chart.tone}">${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos para este rango.</div>'}</div></article>
      
        <article class="finance__controls" id="controles-ventana-main-finanzas">
        <select class="finance-pill" data-range><option value="total" ${state.rangeMode === 'total' ? 'selected' : ''}>Total</option><option value="month" ${state.rangeMode === 'month' ? 'selected' : ''}>Mes</option><option value="week" ${state.rangeMode === 'week' ? 'selected' : ''}>Semana</option><option value="year" ${state.rangeMode === 'year' ? 'selected' : ''}>Año</option></select>
        <button class="finance-pill" data-history>Historial</button>
        <select class="finance-pill" data-compare><option value="month" ${state.compareMode === 'month' ? 'selected' : ''}>Mes vs Mes</option><option value="week" ${state.compareMode === 'week' ? 'selected' : ''}>Semana vs Semana</option></select></article>
      <article class="finance__compareRow"><div class="finance-chip ${toneClass(compareCurrent.delta)}">Actual: ${fmtSignedCurrency(compareCurrent.delta)} (${fmtSignedPercent(compareCurrent.deltaPct)})</div><div class="finance-chip ${toneClass(comparePrev.delta)}">Anterior: ${fmtSignedCurrency(comparePrev.delta)} (${fmtSignedPercent(comparePrev.deltaPct)})</div></article>
      <article class="finance__accounts"><div class="finance__sectionHeader"><h2></h2><div class="finance-row-cuenta"><button class="finance-pill finance-pill--mini" id="fusionar-cuentas" data-account-merge-open>Fusionar</button><button class="finance-pill" data-new-account>+ Cuenta</button></div></div>
      <div id="finance-accountsList">${accounts.map((account) => { const editableBalance = account.shared ? account.currentReal : account.current; return `<article class="financeAccountCard ${toneClass(account.range.delta)}" data-open-detail="${account.id}"><div><strong>${escapeHtml(account.name)}</strong><div class="financeAccountCard__balanceWrap"><span class="financeAccountCard__balanceLabel">${account.shared ? 'Saldo real' : 'Mi saldo'}</span><input class="financeAccountCard__balance" data-account-input="${account.id}" value="${editableBalance.toFixed(2)}" inputmode="decimal" placeholder="" /><button class="finance-pill finance-pill--mini" data-account-save="${account.id}">Guardar</button></div>${account.shared ? `<small class="finance-shared-chip">Compartida ${(account.sharedRatio * 100).toFixed(0)}% · Mi parte: ${fmtCurrency(account.current)}</small>` : ''}</div><div class="financeAccountCard__side"><span class="financeAccountCard__deltaPill finance-chip ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]} ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span><button class="financeAccountCard__menuBtn" data-delete-account="${account.id}">🗑️</button></div></article>`; }).join('') || '<p class="finance-empty">Sin cuentas todavía.</p>'}</div></article>
    </section>`;
}

function renderFinanceCalendar(accounts, totalSeries) {
  
  const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const dayCalendar = calendarData(accounts, totalSeries);
  const monthCalendar = calendarMonthData(accounts, totalSeries);
  const yearCalendar = calendarYearData(accounts, totalSeries);
  const fixedByDay = groupFixedRecurringByDay(
  offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset)
);
const toggle = typeof renderFinanceHomePanelToggle === 'function'
  ? ''
  : '';
  const modeLabel = state.calendarMode === 'month'
    ? `${monthCalendar.year}`
    : (state.calendarMode === 'year' ? 'Años' : monthLabelByKey(offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset)));
  let content = '';
  if (state.calendarMode === 'month') {
    content = `<div class="finance-calendar-months">${monthCalendar.months.map((point) => {
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-open-month="${point.monthKey}"><strong>${escapeHtml(point.label)}</strong><span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span><span>${point.isEmpty ? '—' : fmtSignedPercent(point.deltaPct)}</span></button>`;
    }).join('')}</div>`;

    const fixedSummaryContent =
  fixedSummaryView === 'donut'
    ? renderFixedExpenseDonut(selectedMonthKey)
    : fixedSummaryView === 'line'
      ? renderFixedExpenseLineChart()
      : renderFixedExpenseSquares(selectedMonthKey);

const fixedSummaryBlock = `
  <section class="financeFixedSummary">
    <div class="financePanelTopbar">
      <div class="financePanelHeading"><h3>Gastos fijos</h3></div>
      ${fixedSummaryControls}
    </div>
    ${fixedSummaryContent}
  </section>
`;
  } else if (state.calendarMode === 'year') {
    content = `<div class="finance-calendar-years">${yearCalendar.map((point) => {
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-open-year="${point.year}"><strong>${point.year}</strong><span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span></button>`;
    }).join('')}</div>`;
  } else {
    content = `<div class="finance-calendar-grid"><div class="finance-calendar-weekdays">${weekdayLabels.map((l) => `<span>${l}</span>`).join('')}</div><div class="finance-calendar-days">${dayCalendar.cells.map((point) => {
      if (!point) return '<div class="financeCalCell financeCalCell--blank"></div>';
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      const fixedItems = fixedByDay[point.dayKey] || [];
const fixedEmojis = fixedItems.length
  ? `<div class="financeCalFixedRow">${fixedItems.slice(0, 4).map((item) => `
      <div class="financeCalFixedEmoji" title="${escapeHtml(item.fixedName || item.category || 'Fijo')} · ${fmtCurrency(item.fixedAmountAbs || item.amount || 0)}">
        ${escapeHtml(item.fixedEmoji || '💸')}
      </div>
    `).join('')}${fixedItems.length > 4 ? `<span class="financeCalFixedMore">+${fixedItems.length - 4}</span>` : ''}</div>`
  : '';

return `<button class="financeCalCell ${tone}" data-calendar-day="${point.dayKey}">
  <strong>${point.dayNumber}</strong>
  ${fixedEmojis}
  <span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span>
  <span>${point.isEmpty ? '—' : fmtSignedPercent(point.deltaPct)}</span>
</button>`;
    }).join('')}</div></div>`;
  }
const selectedMonthKey = offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset);
const fixedSummaryView = state.calendarFixedView || 'squares';

const fixedSummaryControls = `
  <div class="financeFixedSummaryToggle" role="group" aria-label="Cambiar resumen de gastos fijos">
    <button type="button" class="finance-pill ${fixedSummaryView === 'squares' ? 'is-active' : ''}" data-fixed-summary-view="squares">Cuadrados</button>
    <button type="button" class="finance-pill ${fixedSummaryView === 'donut' ? 'is-active' : ''}" data-fixed-summary-view="donut">Donut</button>
    <button type="button" class="finance-pill ${fixedSummaryView === 'line' ? 'is-active' : ''}" data-fixed-summary-view="line">Línea</button>
  </div>
`;

const fixedSummaryContent =
  fixedSummaryView === 'donut'
    ? renderFixedExpenseDonut(selectedMonthKey)
    : fixedSummaryView === 'line'
      ? renderFixedExpenseLineChart()
      : renderFixedExpenseSquares(selectedMonthKey);

const fixedSummaryBlock = `
  <section class="financeFixedSummary">
    <div class="financePanelTopbar" id="gastos-fijos-control">
      <div class="financePanelHeading"><h3>Gastos fijos</h3></div>
      ${fixedSummaryControls}
    </div>
    ${fixedSummaryContent}
  </section>
`;
  return `<article class="finance__calendarPreview">
  <div class="financePanelTopbar">
    <div class="financePanelHeading"><h2>Calendario</h2></div>
    ${toggle}
  </div>
  <div class="finance-calendar-controls" id="selectores-calendario">
    
    <select class="finance-pill" id="selector-cuenta-calendario" data-calendar-account><option value="total" ${state.calendarAccountId === 'total' ? 'selected' : ''}>Total</option>${accounts.map((a) => `<option value="${a.id}" ${state.calendarAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select>

    <select class="finance-pill" id="selector-rango-calendario" data-calendar-mode><option value="day" ${state.calendarMode === 'day' ? 'selected' : ''}>D&iacute;a</option><option value="month" ${state.calendarMode === 'month' ? 'selected' : ''}>Mes</option><option value="year" ${state.calendarMode === 'year' ? 'selected' : ''}>A&ntilde;o</option></select>
  </div>
      <button type="button" class="finance-pill finance-pill--add-fixed" data-open-fixed-expense>+ Fijo</button>

  <div id="nav-mes-calendario">
    <button class="boton-calendario" data-month-shift="-1">&#9664;</button>
  <span class="finance-month-label">${modeLabel}</span>
    <button class="boton-calendario" data-month-shift="1">&#9654;</button>
    </div>
  ${content}
  ${fixedSummaryBlock}
</article>`;
}

function renderFinanceBalance(accounts = buildAccountModels(), categories = categoriesList(), txRows = balanceTxList()) {
  const monthKey = getSelectedBalanceMonthKey();
  if (FINANCE_DEBUG) {
    const txNew = Object.keys(state.balance.transactions || {}).length;
    const movLegacyMonths = Object.keys(state.balance.movements || {}).length;
    const txLegacy = Object.keys(state.balance.tx || {}).length;
    const monthCount = txRows.filter((row) => row.monthKey === monthKey).length;
    financeDebug('balance sources', { txNew, movLegacyMonths, txLegacy });
    financeDebug('balance month rows', { monthKey, monthCount });
  }
  const accountsById = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const monthActualTx = txRows.filter((row) => row.monthKey === monthKey);
  const monthPendingRecurringTx = recurringVirtualForMonth(monthKey, txRows, { includeFuture: false });
  const allMonthDisplayTx = [...monthActualTx, ...monthPendingRecurringTx];
  const tx = allMonthDisplayTx
    .filter((row) => state.balanceFilterType === 'all' || row.type === state.balanceFilterType)
    .filter((row) => state.balanceFilterCategory === 'all' || row.category === state.balanceFilterCategory)
    .filter((row) => {
      if (state.balanceAccountFilter === 'all') return true;
      return row.accountId === state.balanceAccountFilter || row.fromAccountId === state.balanceAccountFilter || row.toAccountId === state.balanceAccountFilter;
    })
    .filter((row) => {
      if (!state.balanceFilterUnlinedOnly) return true;
      if (row.type !== 'expense') return false;
      return !foodItemsFromTx(row).length;
    });
  const monthSummary = summaryForMonth(monthKey, accountsById, txRows);
  const prevSummary = summaryForMonth(offsetMonthKey(monthKey, -1), accountsById, txRows);
  const monthAgg = calcAggForBucket(monthActualTx, accountsById);
  financeDebug('balance aggregate', { monthKey, rows: monthActualTx.length, monthAgg });
  const monthAccountsDeltaReal = calcAccountsDeltaForBucket('month', monthKey, state.accounts);
  const prevMonthKey = offsetMonthKey(monthKey, -1);
  const prevMonthRows = txRows.filter((row) => row.monthKey === prevMonthKey);
  const prevMonthAgg = calcAggForBucket(prevMonthRows, accountsById);
  const prevMonthAccountsDeltaReal = calcAccountsDeltaForBucket('month', prevMonthKey, state.accounts);
  const statsMonth = buildBalanceStats(monthActualTx, accountsById);
  const spentByCategory = statsMonth.spentByCategoryPersonal;
  const totalSpent = statsMonth.totalSpentPersonal;
  const budgetItems = getBudgetItems(monthKey);
  const monthNetList = monthlyNetRows(accountsById, txRows);
  const metricRows = [
    { id: 'netOperative', label: 'Operativo', current: monthAgg.netOperativeMy, prev: prevMonthAgg.netOperativeMy },
    { id: 'netWealth', label: 'Patrimonio', current: monthAgg.netWealthMy, prev: prevMonthAgg.netWealthMy },
    { id: 'accountsDeltaReal', label: 'Δ Cuentas', current: monthAccountsDeltaReal, prev: prevMonthAccountsDeltaReal }
  ];
  const accountName = (id) => escapeHtml(accounts.find((a) => a.id === id)?.name || 'Sin cuenta');
  const mode = state.balanceStatsMode === 'income' ? 'income' : 'expense';
  const statsRange = ['day', 'week', 'month', 'year', 'total'].includes(state.balanceStatsRange) ? state.balanceStatsRange : 'month';
  const statsScope = state.balanceStatsScope === 'global' ? 'global' : 'personal';
  const statsGroupBy = ['category', 'account', 'store', 'mealType', 'product'].includes(state.balanceStatsGroupBy) ? state.balanceStatsGroupBy : 'category';
  const includeUnlined = !!state.balanceStatsIncludeUnlined;
  const allTxRows = txRows;
  const rangeRows = statsRange === 'month'
    ? txRows.filter((row) => row.monthKey === monthKey)
    : filterTxByRange(txRows, statsRange);
  const rangeStats = buildBalanceStats(rangeRows, accountsById);
  const donutPayload = computeFinanceStatsDonutPayload(rangeRows, accountsById, {
    monthKey,
    statsRange,
    statsScope,
    statsGroupBy,
    mode,
    includeUnlined,
  });
  const donutAggregation = donutPayload.donutAggregation;
  const donutMap = donutAggregation.breakdown;
  const unlinedTotal = donutAggregation.unlinedTotal;
  const donutTotal = Number(donutPayload.donutTotal || 0);
  const segments = Array.isArray(donutPayload.segments) ? donutPayload.segments : donutSegments(donutMap, donutTotal, { productKeyByLabel: donutAggregation.productKeyByLabel });
  const selectedSegment = segments.find((segment) => segment._key === state.balanceStatsActiveSegment) || null;
  if (!selectedSegment && state.balanceStatsActiveSegment) state.balanceStatsActiveSegment = null;
  const legendExpanded = state.balanceStatsLegendExpanded !== false;
  const monthScopeLabel = statsRange === 'month' ? ` — ${capitalizeFirst(monthLabelByKey(monthKey))}` : '';
  const totalIncome = statsScope === 'global' ? rangeStats.totalIncomeGlobal : rangeStats.totalIncomePersonal;
  const totalSpentRange = statsScope === 'global' ? rangeStats.totalSpentGlobal : rangeStats.totalSpentPersonal;
  const topFoodItems = statsScope === 'global' ? rangeStats.topFoodItemsGlobal : rangeStats.topFoodItemsPersonal;
  const totalFoodSpent = statsScope === 'global' ? rangeStats.totalFoodSpentGlobal : rangeStats.totalFoodSpentPersonal;
  const comparisonMax = Math.max(totalIncome, totalSpentRange, 1);
  const groupLabel = ({ category: 'Categorías', account: 'Cuentas', store: 'Supermercado', mealType: 'Tipo comida', product: 'Producto / Item' })[statsGroupBy] || 'Categorías';
  const showUnlinedNotice = statsGroupBy === 'product' && mode === 'expense' && unlinedTotal > 0;
  const scopeLabel = statsScope === 'global' ? 'total global' : 'mi parte';
  const txByDay = groupTxByDay(tx, accountsById, statsScope);
  const aggScope = state.balanceAggScope === 'total' ? 'total' : 'my';

  return `<section class="financeBalanceView"><header class="financeViewHeader"><h2>Balance</h2></header>
  <article class="financeGlassCard">
  <div class="finance-row-balance">
  <button class="boton-calendario" data-balance-month="-1">◀</button>
  <strong>${monthLabelByKey(monthKey)}</strong>
  <button class="boton-calendario" data-balance-month="1">▶</button></div>

  <div class="finAgg__scopeToggle">
    <button class="finance-pill ${state.balanceAggScope === 'my' ? 'finAgg__active' : ''}" data-fin-agg-scope="my">Mi parte</button>
    <button class="finance-pill ${state.balanceAggScope === 'total' ? 'finAgg__active' : ''}" data-fin-agg-scope="total">Total</button>
  </div>
  <div class="financeSummaryGrid">
  <button class="dash-balance" type="button" data-balance-drilldown="income"><small class="pill-ingresos-mes">Ingresos (${aggScope === 'total' ? 'total' : 'mi parte'})</small><strong class="is-positive">${fmtCurrency(aggScope === 'total' ? monthAgg.incomeTotal : monthAgg.incomeMy)}</strong></button>
  <button class="dash-balance" type="button" data-balance-drilldown="expense"><small class="pill-gastos-mes">Gastos (${aggScope === 'total' ? 'total' : 'mi parte'})</small><strong class="is-negative">${fmtCurrency(aggScope === 'total' ? monthAgg.expenseTotal : monthAgg.expenseMy)}</strong></button>
    <div class="dash-balance">
      <small>ΔNeto</small><strong class="${toneClass(aggScope === 'total' ? monthAgg.netOperativeTotal : monthAgg.netOperativeMy)}">${fmtCurrency(aggScope === 'total' ? monthAgg.netOperativeTotal : monthAgg.netOperativeMy)}</strong></div>
    
  

    <div class="dash-balance"><small>Δ Cuentas (real)</small><strong class="${toneClass(monthAccountsDeltaReal)}">${fmtCurrency(monthAccountsDeltaReal)}</strong></div>
    </div>
  <div class="dash-balance-patrimonio"><small>ΔPatrimonio</small><strong class="${toneClass(aggScope === 'total' ? monthAgg.netWealthTotal : monthAgg.netWealthMy)}">${fmtCurrency(aggScope === 'total' ? monthAgg.netWealthTotal : monthAgg.netWealthMy)}</strong>
    
      <small>Imp.trans.: ${fmtSignedCurrency(aggScope === 'total' ? monthAgg.transferImpactTotal : monthAgg.transferImpactMy)}</small></div>
  <div class="finance-chip ${toneClass(prevSummary.net)}">Mes anterior: ${fmtSignedCurrency(prevSummary.net)}</div></article>
  
  
 <details class="financeGlassCard" id="finance-balance-tx-details" data-balance-tx-details ${state.balanceTxDetailsOpen ? 'open' : ''}>

  <summary class="financeAccordion__summary">
    <span>Transacciones</span>
  </summary>


    <div class="finance-row">
    <h3>Transacciones</h3>
    <div class="finance-row-transacciones">
    <select class="finance-pill-transacciones" data-balance-type><option value="all">Todos</option><option value="expense" ${state.balanceFilterType === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${state.balanceFilterType === 'income' ? 'selected' : ''}>Ingreso</option><option value="transfer" ${state.balanceFilterType === 'transfer' ? 'selected' : ''}>Transferencia</option></select>
    <select class="finance-pill-transacciones" data-balance-category><option value="all">Todas</option>${categories.map((c) => `<option ${state.balanceFilterCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select>
    <select class="finance-pill-transacciones" data-balance-account><option value="all">Cuentas</option>${accounts.map((a) => `<option value="${a.id}" ${state.balanceAccountFilter === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select>
    ${state.balanceFilterUnlinedOnly ? '<button class="btn-x finance-pill finance-pill--mini" data-balance-filter-unlined-clear>Sin desglose ✕</button>' : ''}</div></div>
    <div class="financeTxList financeTxList--scroll" style="max-height:260px;overflow-y:auto;">${(state.balanceShowAllTx ? txByDay : txByDay.slice(0, 10)).map((day) => {
      const label = new Date(`${day.dayISO}T00:00:00`).toLocaleDateString('es-ES', { day: '2-digit', month: '2-digit', year: 'numeric' });
      return `<button type="button" class="financeTxRow finTxDay__row" data-tx-day-open="${day.dayISO}"><span class="${toneClass(day.net)}">${label}</span><span class="${toneClass(day.net)}">${day.rows.length} movimientos</span><strong class="${toneClass(day.net)}">${fmtSignedCurrency(day.net)}</strong></button>`;
    }).join('') || '<p class="finance-empty">Sin movimientos en este mes.</p>'}</div>${txByDay.length > 10 ? `<div class="finance-row"><button class="finance-pill finance-pill--mini" data-balance-showmore>${state.balanceShowAllTx ? 'Ver menos' : `Ver más (${txByDay.length - 10})`}</button></div>` : ''}
</details>

  <article class="financeGlassCard">
    ${(() => {
      const trendData = getBalanceTrendSeries(accountsById, txRows, state.balanceTrendMode, state.balanceTrendCategory);
      return `
        ${renderBalanceTrendControls(categories, state.balanceTrendMode, state.balanceTrendCategory)}
        ${renderBalanceTrendChart(trendData)}
      `;
    })()}
  </article>

  <article class="financeGlassCard financeStats">
    <div class="financeStats__header">
      <h3 class="financeStats__title">Estadísticas${monthScopeLabel}</h3>
      <div class="financeStats__mode">
        
      </div>
    </div>

    <div class="financeStats__scope">
      <button class="financeStats__scopeBtn ${statsScope === 'personal' ? 'financeStats__scopeBtn--active' : ''}" data-finance-stats-scope="personal">Mi parte</button>

      <button class="financeStats__scopeBtn ${statsScope === 'global' ? 'financeStats__scopeBtn--active' : ''}" data-finance-stats-scope="global">Total</button>

      <button class="financeStats__modeBtn ${mode === 'expense' ? 'financeStats__modeBtn--active' : ''}" data-finance-stats-mode="expense">Gastos</button>
        <button class="financeStats__modeBtn ${mode === 'income' ? 'financeStats__modeBtn--active' : ''}" data-finance-stats-mode="income">Ingresos</button>


    </div>

    <div class="financeStats__rangeBar">
      ${[['day', 'Día'], ['week', 'Semana'], ['month', 'Mes'], ['year', 'Año'], ['total', 'Total']].map(([key, label]) => `<button class="financeStats__rangeBtn ${statsRange === key ? 'financeStats__rangeBtn--active' : ''}" data-finance-stats-range="${key}">${label}</button>`).join('')}
    </div>
    <div class="financeStats__group">
      <label class="financeStats__groupLabel" for="financeStatsGroupSelect">Agrupar por</label>
      <select id="financeStatsGroupSelect" class="financeStats__groupSelect" data-finance-stats-group>
        <option value="category" ${statsGroupBy === 'category' ? 'selected' : ''}>Categorías</option>
        <option value="account" ${statsGroupBy === 'account' ? 'selected' : ''}>Cuentas</option>
        <option value="store" ${statsGroupBy === 'store' ? 'selected' : ''}>Supermercado</option>
        <option value="mealType" ${statsGroupBy === 'mealType' ? 'selected' : ''}>Tipo comida</option>
        <option value="product" ${statsGroupBy === 'product' ? 'selected' : ''}>Producto / Item</option>
      </select>
      ${statsGroupBy === 'product' && mode === 'expense' ? `<label class="financeStats__checkbox"><input type="checkbox" data-finance-stats-include-unlined ${includeUnlined ? 'checked' : ''}> Incluir gastos sin líneas</label>` : ''}
    </div>

    <div class="financeStats__donutWrap" data-finance-stats-donut-wrap data-finance-stats-segments='${escapeHtml(JSON.stringify(segments))}'>
      <div
        class="financeStats__donutChart"
        data-finance-stats-donut="${escapeHtml(JSON.stringify(segments.map((segment) => ({
          name: segment.label,
          value: segment.value,
          _key: segment._key,
          productKey: segment.productKey,
          pct: segment.pct,
          midAngle: segment.midAngle,
          color: segment.color
        }))))}"
        aria-label="Distribución por agrupación"
      ></div>
      <svg class="financeStats__calloutSvg" viewBox="0 0 0 0" aria-hidden="true"><polyline id="financeStatsDonutCalloutLine" class="financeStats__calloutLine" data-finance-stats-callout-line style="display:none"></polyline></svg>
      <div id="financeStatsDonutCallout" class="financeStats__callout" data-finance-stats-callout style="display:none"></div>
      <div class="financeStats__donutCenter">
        <small>${statsGroupBy === 'product' ? `Total (${scopeLabel})` : `Total (${scopeLabel})`}</small>
        <strong class="financeStats__donutValue">${fmtCurrency(donutTotal)}</strong>
        <small class="financeStats__donutSub">${groupLabel.toLowerCase()}</small>
      </div>
      ${segments.length ? '' : '<p class="financeStats__emptyHint">Sin datos para agrupar.</p>'}
    </div>
    ${showUnlinedNotice ? `<div class="financeStats__unlinedNotice"><span>Aviso: ${fmtCurrency(unlinedTotal)} en gastos sin desglose (no incluidos en este gráfico)</span><button type="button" class="finance-pill finance-pill--mini" data-finance-stats-view-unlined>Ver</button></div>` : ''}

    <details class="financeStats__details" data-finance-stats-legend-details ${legendExpanded ? 'open' : ''}>
      <summary class="financeStats__detailsSummary" data-finance-stats-legend-summary>Leyenda</summary>
      <div class="financeStats__detailsBody financeStats__legendGrid">
        ${segments.length ? segments.map((segment, index) => {
          const productMeta = state.balanceStatsProductMeta?.[segment.label] || null;
          const hasSingleUnit = productMeta && productMeta.units instanceof Set && productMeta.units.size === 1;
          const unit = hasSingleUnit ? [...productMeta.units][0] : '';
          const avgUnitPrice = (productMeta && Number(productMeta.sumQty || 0) > 0 && hasSingleUnit)
            ? (Number(productMeta.sumUnitPriceWeighted || 0) / Number(productMeta.sumQty || 1))
            : null;
          const micro = productMeta
            ? `${fmtCurrency(segment.value)} · ${productMeta.purchaseCount} compras · ${Number.isFinite(avgUnitPrice) ? `${Number(avgUnitPrice).toFixed(2)} €/` + unit : 'Media: —'}`
            : `${fmtCurrency(segment.value)} · ${segment.pct.toFixed(1)}%`;
          return `<div class="financeStats__rankRow ${state.balanceStatsActiveSegment === segment._key ? 'is-active' : ''} financeLegendRow" data-finance-stats-segment="${escapeHtml(segment._key)}" data-product-key="${escapeHtml(segment.productKey || '')}"><div class="financeStats__left"><span class="financeStats__rank">${index + 1}</span><span class="financeStats__name"><i class="financeStats__dot" style="background:${segment.color}"></i>${escapeHtml(segment.label)}</span></div><div class="financeStats__right">${statsGroupBy === 'product' ? `<button type="button" class="financeProductStatsBtn" data-finance-product-stats="${escapeHtml(segment.productKey || segment._key)}" aria-label="Ver estadísticas del producto">📈</button>` : ''}<span class="financeStats__meta">${fmtCurrency(segment.value)} · ${segment.pct.toFixed(1)}%</span>${statsGroupBy === 'product' ? `<small class="financeStats__micro">${escapeHtml(micro)}</small>` : ''}</div></div>`;
        }).join('') : '<p class="finance-empty">Sin datos.</p>'}
      </div>
    </details>

    <div class="financeStats__compare">
      <h4>Comparativa del período (${scopeLabel})</h4>
      <div class="financeStats__compareRow">
        <div class="financeStats__row"><span>Ingresos</span><strong>${fmtCurrency(totalIncome)}</strong></div>
        <div class="financeStats__bar"><div class="financeStats__barFill financeStats__barFill--income" style="width:${(totalIncome / comparisonMax) * 100}%"></div></div>
      </div>
      <div class="financeStats__compareRow">
        <div class="financeStats__row"><span>Gastos</span><strong>${fmtCurrency(totalSpentRange)}</strong></div>
        <div class="financeStats__bar"><div class="financeStats__barFill financeStats__barFill--expense" style="width:${(totalSpentRange / comparisonMax) * 100}%"></div></div>
      </div>
    </div>

    <details class="financeStats__foodsDetails">
      <summary class="financeStats__detailsSummary">Productos/Comidas más comprados (${scopeLabel})</summary>
      <div class="financeStats__detailsBody financeStats__foodsList">
        ${topFoodItems.length ? topFoodItems.map((item) => `<div class="financeStats__foodRow"><span>${escapeHtml(item.name)} · x${item.count}</span><small>${(totalFoodSpent > 0 ? ((item.total / totalFoodSpent) * 100) : 0).toFixed(1)}%</small><strong>${fmtCurrency(item.total)}</strong><button type="button" class="food-iconbtn" data-food-item-detail-name="${escapeHtml(item.name)}" aria-label="Abrir ficha de ${escapeHtml(item.name)}">📈</button></div>`).join('') : '<p class="finance-empty">Sin datos.</p>'}
      </div>
    </details>

    <details class="financeStats__details financeStats__manage">
      <summary class="financeStats__detailsSummary">Gestión</summary>
      <div class="financeStats__detailsBody">
        <div class="financeStats__manageRow"><strong>Categorías</strong></div>
        ${Object.keys(state.balance.categories || {}).length ? Object.keys(state.balance.categories || {}).sort((a, b) => a.localeCompare(b, 'es')).map((name) => `<div class="financeStats__manageRow"><span>${escapeHtml(name)}</span><button class="financeStats__deleteBtn" data-finance-manage-delete="category" data-finance-manage-value="${escapeHtml(name)}">❌</button></div>`).join('') : '<p class="finance-empty">Sin categorías.</p>'}
        <div class="financeStats__manageRow"><strong>Supermercados</strong></div>
        ${foodOptionList('place').length ? foodOptionList('place').map((name) => `<div class="financeStats__manageRow"><span>${escapeHtml(name)}</span><button class="financeStats__deleteBtn" data-finance-manage-delete="place" data-finance-manage-value="${escapeHtml(name)}">❌</button></div>`).join('') : '<p class="finance-empty">Sin supermercados.</p>'}
        <div class="financeStats__manageRow"><strong>Tipo comida</strong></div>
        ${foodOptionList('typeOfMeal').length ? foodOptionList('typeOfMeal').map((name) => `<div class="financeStats__manageRow"><span>${escapeHtml(name)}</span><button class="financeStats__deleteBtn" data-finance-manage-delete="typeOfMeal" data-finance-manage-value="${escapeHtml(name)}">❌</button></div>`).join('') : '<p class="finance-empty">Sin tipos.</p>'}
        <div class="financeStats__manageRow"><strong>Saludable</strong></div>
        ${foodOptionList('cuisine').length ? foodOptionList('cuisine').map((name) => `<div class="financeStats__manageRow"><span>${escapeHtml(name)}</span><button class="financeStats__deleteBtn" data-finance-manage-delete="cuisine" data-finance-manage-value="${escapeHtml(name)}">❌</button></div>`).join('') : '<p class="finance-empty">Sin datos.</p>'}
        <div class="financeStats__manageRow"><strong>Productos</strong><button type="button" class="finance-pill finance-pill--mini" data-finance-view="products">Food / Productos</button></div>
        ${foodItemsList().length ? foodItemsList().sort((a, b) => a.name.localeCompare(b.name, 'es')).map((item) => `<div class="financeStats__manageRow"><span>${escapeHtml(item.name)}</span><button type="button" class="food-iconbtn" data-food-item-detail="${escapeHtml(item.id)}" aria-label="Abrir ficha de ${escapeHtml(item.name)}">📈</button></div>`).join('') : '<p class="finance-empty">Sin productos.</p>'}
      </div>
    </details>
  </article>

  <article class="financeGlassCard"><div class="finance-row"><h3>Presupuestos</h3><button class="finance-pill" data-open-modal="budget">+ Presupuesto</button></div>
  <div class="financeBudgetList">${budgetItems.length ? budgetItems.map((budget) => {
    const spent = budget.category.toLowerCase() === 'total' ? totalSpent : Number(spentByCategory[budget.category] || 0);
    const limit = Number(budget.limit || 0);
    const pct = limit ? (spent / limit) * 100 : 0;

return `<div class="financeBudgetRow">
  <div class="finance-row">
    <span>${escapeHtml(budget.category)}</span>
    <div class="finance-row">
      <button class="finance-pill finance-pill--mini" data-budget-menu="${budget.id}">✏️</button>
      <button class="finance-pill finance-pill--mini" data-budget-delete="${budget.id}">❌</button>
    </div>
  </div>

  <small>${fmtCurrency(spent)} / ${fmtCurrency(limit)} (${pct.toFixed(0)}%)</small>

  <div class="financeProgress">
    <div class="financeProgress__bar" style="width:${Math.max(0, Math.min(100, pct)).toFixed(2)}%"></div>
  </div>
</div>`;


  }).join('') : '<p class="finance-empty">Sin presupuestos.</p>'}</div></article>



  <article class="financeGlassCard">
    <h3>Balance neto por mes</h3>
    <div class="finAgg__totals">
    
    ${metricRows.map((metric) => {
      const pct = pctDelta(metric.current, metric.prev);
      const best = monthNetList.reduce((pick, row) => {
        const value = Number(row[metric.id] || 0);
        if (!pick || value > pick.value) return { month: row.month, value };
        return pick;
      }, null);
      const worst = monthNetList.reduce((pick, row) => {
        const value = Number(row[metric.id] || 0);
        if (!pick || value < pick.value) return { month: row.month, value };
        return pick;
      }, null);
      const avg = monthNetList.length ? monthNetList.reduce((sum, row) => sum + Number(row[metric.id] || 0), 0) / monthNetList.length : 0;
      return `<div><small>${metric.label}</small><strong class="${toneClass(metric.current)}">${fmtCurrency(metric.current)}</strong><small>
      Media ${fmtCurrency(avg)} 
      
      Mejor ${best ? `${best.month} ${fmtCurrency(best.value)}` : '—'} 

       
      Peor ${worst ? `${worst.month} ${fmtCurrency(worst.value)}` : '—'} ${pct == null ? '' : `· Δ% ${fmtSignedPercent(pct)}`}
      </small>
      
      </div>`;
    }).join('')}
    
  </div>

  <div class="financeTxList" style="max-height:220px;overflow-y:auto;">${monthNetList.map((row) => `<div class="financeTxRow-balance-por-mes"><span>${row.month}</span><strong class="${toneClass(row.netOperative)}">Op ${fmtSignedCurrency(row.netOperative)}</strong><strong class="${toneClass(row.netWealth)}">Pat ${fmtSignedCurrency(row.netWealth)}</strong><strong class="${toneClass(row.accountsDeltaReal)}">ΔC ${fmtSignedCurrency(row.accountsDeltaReal)}</strong></div>`).join('') || '<p class="finance-empty">Sin meses con movimientos.</p>'}</div></article></section>`;
}

function renderFinanceGoalsLegacy(accounts = buildAccountModels()) {
  const goals = Object.entries(state.goals.goals || {})
    .map(([id, row]) => ({ id, ...row }))
    .sort((a, b) => Number(a?.dueDateISO ? new Date(a.dueDateISO).getTime() : 0) - Number(b?.dueDateISO ? new Date(b.dueDateISO).getTime() : 0));

  const accountsById = Object.fromEntries(accounts.map((account) => [account.id, account]));

  const totalObjective = goals.reduce((sum, goal) => sum + Number(goal.targetAmount || 0), 0);
  const contributingAccounts = new Set();
  goals.forEach((goal) => (goal.accountsIncluded || []).forEach((id) => contributingAccounts.add(id)));
  const totalPool = [...contributingAccounts].reduce((sum, id) => sum + Number(accountsById[id]?.current || 0), 0);
  const globalPct = totalObjective > 0 ? Math.max(0, Math.min(100, (totalPool / totalObjective) * 100)) : 0;
  const sortedGoals = goals.slice().sort((a, b) => {
    const aDue = a?.dueDateISO ? new Date(a.dueDateISO).getTime() : Number.MAX_SAFE_INTEGER;
    const bDue = b?.dueDateISO ? new Date(b.dueDateISO).getTime() : Number.MAX_SAFE_INTEGER;
    if (aDue !== bDue) return aDue - bDue;
    return Number(a.targetAmount || 0) - Number(b.targetAmount || 0);
  });
  const allocationByGoal = {};
  let remainingPool = totalPool;
  sortedGoals.forEach((goal) => {
    const target = Math.max(0, Number(goal.targetAmount || 0));
    const assigned = Math.max(0, Math.min(target, remainingPool));
    allocationByGoal[goal.id] = assigned;
    remainingPool -= assigned;
  });

  return `
  <section class="financeBalanceView financeGoalsView">
    <header class="financeViewHeader financeGoalsView__header">
      <button  id="boton-objetivo" data-open-modal="goal">+ Objetivo</button>
    </header>

    <article class="financeGlassCard financeGoalsCard financeGoalsCard--summary">
      <div class="financeSummaryGrid financeGoalsSummaryGrid">
        <div class="valoracion-mes financeGoalsSummaryStat"><small>Total objetivo</small><strong>${fmtCurrency(totalObjective)}</strong></div>
        <div class="valoracion-mes financeGoalsSummaryStat"><small>Total ahorrado</small><strong class="${toneClass(totalPool)}">${fmtCurrency(totalPool)}</strong></div>
      </div>
      <div class="media-mensual financeGoalsProgressHead">
        <div>
          <small>Progreso global</small>
          <strong class="${toneClass(globalPct - 100)}">${globalPct.toFixed(2)}%</strong>
        </div>
        <small>${contributingAccounts.size} ${contributingAccounts.size === 1 ? 'cuenta' : 'cuentas'} aportando</small>
      </div>
      <div class="financeProgress financeProgress--goal"><div class="financeProgress__bar" style="width:${Math.max(0, Math.min(100, globalPct)).toFixed(2)}%"></div></div>
    </article>

    <article class="financeGlassCard financeGoalsCard">
      <div class="financeBudgetList financeGoalsList">
        ${
          goals.length
            ? goals.map(goal => {
                const target = Number(goal.targetAmount || 0);
                const includedIds = goal.accountsIncluded || [];
                const assigned = Number(allocationByGoal[goal.id] || 0);
                const pct = target > 0 ? Math.max(0, Math.min(100, (assigned / target) * 100)) : 0;
                const remaining = Math.max(0, target - assigned);
                const complete = remaining <= 0.000001 && target > 0;
                const dueLabel = goal.dueDateISO ? new Date(goal.dueDateISO).toLocaleDateString('es-ES') : 'sin fecha';

                return `
                  <div class="financeBudgetRow financeGoalCard ${complete ? 'is-complete' : ''}">
                    <div class="financeGoalCard__header">
                      <div class="financeGoalCard__titleBlock">
                        <strong>${escapeHtml(goal.title || 'Objetivo')}</strong>
                        <small>Vence ${dueLabel}</small>
                      </div>
                      <div class="financeGoalCard__actions">
                        <button class="finance-pill finance-pill--mini" data-open-goal="${goal.id}">✏️</button>
                        <button class="finance-pill finance-pill--mini" data-delete-goal="${goal.id}">❌</button>
                      </div>
                    </div>

                    <div class="financeGoalCard__meta">
                      ${fmtCurrency(target)} ·
                      asignado ${fmtCurrency(assigned)} (${pct.toFixed(0)}%) ·
                      restante ${fmtCurrency(remaining)} ·
                      vence ${goal.dueDateISO ? new Date(goal.dueDateISO).toLocaleDateString('es-ES') : 'sin fecha'} ·
                      ${includedIds.length} cuentas ·
                      ${complete ? 'completo' : 'pendiente'}
                    </div>

                    <div class="financeProgress">
                      <div class="financeProgress__bar" style="width:${pct.toFixed(2)}%"></div>
                    </div>
                  </div>
                `;
              }).join('')
            : `<p class="finance-empty">Sin objetivos todavía.</p>`
        }
      </div>
    </article>
  </section>`;
}

function renderFinanceGoals(accounts = buildAccountModels()) {
  const sortMode = normalizeFinanceGoalsSortMode(state.financeGoalsSortMode || readFinanceGoalsSortMode());
  state.financeGoalsSortMode = sortMode;
  const goals = Object.entries(state.goals.goals || {})
    .map(([id, row]) => ({ id, ...row }));

  const accountsById = Object.fromEntries(accounts.map((account) => [account.id, account]));
  const totalObjective = goals.reduce((sum, goal) => sum + Number(goal.targetAmount || 0), 0);
  const contributingAccounts = new Set();
  goals.forEach((goal) => (goal.accountsIncluded || []).forEach((id) => contributingAccounts.add(id)));
  const totalPool = [...contributingAccounts].reduce((sum, id) => sum + Number(accountsById[id]?.current || 0), 0);
  const assignedGlobal = Math.min(totalObjective, totalPool);
  const pendingGlobal = Math.max(0, totalObjective - assignedGlobal);
  const availableGlobal = Math.max(0, totalPool - assignedGlobal);
  const globalPct = totalObjective > 0 ? Math.max(0, Math.min(100, (totalPool / totalObjective) * 100)) : 0;
  const donutPct = Math.max(0, Math.min(100, globalPct));
  const heroNote = totalObjective <= 0
    ? 'Crea un objetivo para empezar a seguir tu ahorro.'
    : pendingGlobal > 0
      ? `Faltan ${fmtCurrency(pendingGlobal)} para cubrir todos los objetivos con las cuentas vinculadas.`
      : availableGlobal > 0
        ? `Ya cubres los objetivos y te quedan ${fmtCurrency(availableGlobal)} disponibles.`
        : 'Ahora mismo las cuentas vinculadas cubren exactamente el total de objetivos.';
  const allocationOrderGoals = goals.slice().sort(compareFinanceGoalsByDueDate);
  const allocationByGoal = {};
  let remainingPool = totalPool;
  allocationOrderGoals.forEach((goal) => {
    const target = Math.max(0, Number(goal.targetAmount || 0));
    const assigned = Math.max(0, Math.min(target, remainingPool));
    allocationByGoal[goal.id] = assigned;
    remainingPool -= assigned;
  });
  const displayGoals = goals
    .map((goal) => {
      const target = Number(goal.targetAmount || 0);
      const includedIds = goal.accountsIncluded || [];
      const assigned = Number(allocationByGoal[goal.id] || 0);
      const pct = target > 0 ? Math.max(0, Math.min(100, (assigned / target) * 100)) : 0;
      const remaining = Math.max(0, target - assigned);
      const complete = remaining <= 0.000001 && target > 0;
      const dueLabel = goal.dueDateISO ? new Date(goal.dueDateISO).toLocaleDateString('es-ES') : 'sin fecha';
      const dueSummaryLabel = goal.dueDateISO ? `Vence ${dueLabel}` : 'Sin fecha';
      const accountNames = includedIds.map((id) => String(accountsById[id]?.name || '').trim()).filter(Boolean);
      const accountsPreview = accountNames.length
        ? `${accountNames.slice(0, 2).join(' · ')}${accountNames.length > 2 ? ` +${accountNames.length - 2}` : ''}`
        : 'Sin cuentas vinculadas';

      return {
        goal,
        target,
        includedIds,
        assigned,
        pct,
        remaining,
        complete,
        dueLabel,
        dueSummaryLabel,
        accountsPreview,
      };
    })
    .sort((a, b) => {
      if (sortMode === 'incomplete-first' && a.complete !== b.complete) {
        return Number(a.complete) - Number(b.complete);
      }
      return compareFinanceGoalsByDueDate(a.goal, b.goal);
    });

  return `
  <section class="financeBalanceView financeGoalsView">
    <header class="financeViewHeader financeGoalsView__header">
      <div class="financeGoalsView__controls">
        <button class="finance-pill" id="boton-objetivo" data-open-modal="goal">+ Objetivo</button>
      </div>
    </header>

    <article class="financeGlassCard financeGoalsCard financeGoalsHero ${pendingGlobal <= 0 && totalObjective > 0 ? 'is-complete' : ''}">
      <div class="financeGoalsHero__top" >
        <div>
          <small>Resumen global</small>
          <h3>Ahorro vinculado a objetivos</h3>
        </div>
        <span>${goals.length} ${goals.length === 1 ? 'objetivo activo' : 'objetivos activos'}</span>
      </div>

      <div class="financeGoalsHero__body" id="objetivos-resumen-top" >
        <div class="financeGoalsDonutWrap">
          <div class="financeGoalsDonut ${pendingGlobal <= 0 && totalObjective > 0 ? 'is-complete' : ''}" style="--goal-progress:${donutPct.toFixed(2)};">
            <div class="financeGoalsDonut__inner">
              <small>Global</small>
              <strong>${donutPct.toFixed(0)}%</strong>
              <span>${fmtCurrency(assignedGlobal)}</span>
            </div>
          </div>
        </div>

        <div class="financeGoalsHero__stats" id="objetivos-resumen-stats" >
          <div class="financeGoalsHero__metric">
            <small>Total objetivo</small>
            <strong>${fmtCurrency(totalObjective)}</strong>
          </div>
          <div class="financeGoalsHero__metric">
            <small>Total ahorrado</small>
            <strong class="${toneClass(totalPool)}">${fmtCurrency(totalPool)}</strong>
          </div>
          <div class="financeGoalsHero__metric">
            <small>Disponible</small>
            <strong class="${toneClass(availableGlobal)}">${fmtCurrency(availableGlobal)}</strong>
          </div>
          <div class="financeGoalsHero__metric">
            <small>Cuentas aportando</small>
            <strong>${contributingAccounts.size}</strong>
          </div>
        </div>
      </div>

      <div class="progreso-global-objetivo">
        <div>
          <small>Progreso global</small>
          <strong class="${toneClass(globalPct - 100)}">${globalPct.toFixed(2)}%</strong>
        </div>
        <small>${heroNote}</small>
      </div>
      <div class="financeProgress financeProgress--goal financeGoalsHero__progress">
        <div class="financeProgress__bar" style="width:${donutPct.toFixed(2)}%"></div>
      </div>
    </article>
<label class="financeGoalsSort">
          <select class="financeGoalsSort__select" data-finance-goals-sort>
            <option value="due-date" ${sortMode === 'due-date' ? 'selected' : ''}>Vencimiento</option>
            <option value="incomplete-first" ${sortMode === 'incomplete-first' ? 'selected' : ''}>Incompletos primero</option>
          </select>
        </label>
    <article class="financeGlassCard financeGoalsCard">
      <div class="financeBudgetList financeGoalsList">
        ${displayGoals.length
          ? displayGoals.map(({ goal, target, includedIds, assigned, pct, remaining, complete, dueLabel, dueSummaryLabel, accountsPreview }) => {
              return `
                <details class="financeBudgetRow financeGoalCard ${complete ? 'is-complete' : ''}">
                  <summary class="financeGoalCard__collapsed">
                    <span class="financeGoalCard__collapsedMain">
                      <span class="financeGoalCard__collapsedTitle">${escapeHtml(goal.title || 'Objetivo')}</span>
                      <span class="financeGoalCard__collapsedMeta">${escapeHtml(dueSummaryLabel)}</span>
                    </span>
                    <span class="financeGoalCard__collapsedMoney">${fmtCurrency(assigned)} / ${fmtCurrency(target)}</span>
                    <span class="financeGoalCard__collapsedPct">${pct.toFixed(0)}%</span>
                  </summary>

                  <div class="financeGoalCard__expanded">
                    <div class="financeGoalCard__header">
                      <div class="financeGoalCard__titleBlock">
                        <strong>${escapeHtml(goal.title || 'Objetivo')}</strong>
                        <small>Vence ${dueLabel}</small>
                      </div>
                      <div class="financeGoalCard__actions">
                        <button class="finance-pill finance-pill--mini" data-open-goal="${goal.id}">✏️</button>
                        <button class="finance-pill finance-pill--mini" data-delete-goal="${goal.id}">❌</button>
                      </div>
                    </div>

                    <div class="financeGoalCard__subline">
                      <span>${accountsPreview}</span>
                      <span>${complete ? 'Completo' : 'Pendiente'}</span>
                    </div>

                    <div class="financeGoalCard__amounts">
                      <div class="kpi-panel-ahorro" id="objetivos-kpi-objetivo">
                        <small>Objetivo</small>
                        <strong>${fmtCurrency(target)}</strong>
                      </div>
                      <div class="kpi-panel-ahorro" id="objetivos-kpi-ahorrado">
                        <small>Ahorrado</small>
                        <strong>${fmtCurrency(assigned)}</strong>
                      </div>
                      <div class="kpi-panel-ahorro" id="objetivos-kpi-faltan">
                        <small>Faltan</small>
                        <strong>${fmtCurrency(remaining)}</strong>
                      </div>
                    </div>

                    <div class="financeProgress financeProgress--goal">
                      <div class="financeProgress__bar" style="width:${pct.toFixed(2)}%"></div>
                    </div>

                    <div class="financeGoalCard__footer">
                      <span>${pct.toFixed(0)}% completado</span>
                      <span>${includedIds.length} ${includedIds.length === 1 ? 'cuenta' : 'cuentas'}</span>
                    </div>
                  </div>
                </details>
              `;
            }).join('')
          : `<p class="finance-empty financeGoalsEmpty">Sin objetivos todavía.</p>`}
      </div>
    </article>
  </section>`;
}

function renderGoalEditorModal(goal = null, resolvedAccounts = []) {
  const safeGoal = goal && typeof goal === 'object' ? goal : null;
  const isEdit = Boolean(safeGoal?.id);
  const selected = new Set(Array.isArray(safeGoal?.accountsIncluded) ? safeGoal.accountsIncluded : []);
  const targetAmount = Number.isFinite(Number(safeGoal?.targetAmount)) ? String(Number(safeGoal.targetAmount)) : '';
  const dueDate = toIsoDay(String(safeGoal?.dueDateISO || ''));
  const accountsOptions = resolvedAccounts.map((account) => `
    <label class="financeGoalAccountOption">
      <input type="checkbox" name="accountsIncluded" value="${escapeHtml(account.id)}" ${selected.has(account.id) ? 'checked' : ''}/>
      <span>${escapeHtml(account.name)}</span>
    </label>
  `).join('');
  const summaryBlock = isEdit ? `
      <div class="financeGoalDetailCard">
        <div class="financeGoalDetailCard__stat">
          <small>Meta actual</small>
          <strong>${fmtCurrency(Number(safeGoal?.targetAmount || 0))}</strong>
        </div>
        <div class="financeGoalDetailCard__stat">
          <small>Vence</small>
          <strong>${dueDate ? new Date(safeGoal.dueDateISO).toLocaleDateString('es-ES') : 'Sin fecha'}</strong>
        </div>
      </div>
  ` : '';

  return `<div id="finance-modal" class="finance-modal finance-modal--goal" role="dialog" aria-modal="true" tabindex="-1">
    <header class="financeGoalModal__header">
      <div>
        <h3>${isEdit ? 'Editar objetivo' : 'Nuevo objetivo'}</h3>
        <p>${isEdit ? 'Actualiza importe, fecha y cuentas sin salir del flujo actual.' : 'Define una meta y las cuentas que quieres usar para seguirla.'}</p>
      </div>
      <button class="finance-pill" data-close-modal>Cerrar</button>
    </header>
    ${summaryBlock}
    <form class="finance-goal-form financeGoalForm" id="modal-objetivo" data-goal-form>
      ${isEdit ? `<input type="hidden" name="goalId" value="${escapeHtml(safeGoal.id)}" />` : ''}
      <label class="financeGoalForm__field"  id="titulo-del-objetivo">
        <input name="title" required placeholder="Nombre del objetivo" value="${escapeHtml(safeGoal?.title || '')}" />
      </label>
      <div class="financeGoalForm__grid" id="cantidad-fecha-del-objetivo">
        <label class="financeGoalForm__field" id="cantidad-del-objetivo">
          <span>Cantidad objetivo</span>
          <input name="targetAmount" required type="number" step="0.01" min="0" inputmode="decimal" placeholder="0,00" value="${escapeHtml(targetAmount)}" />
        </label>
        <label class="financeGoalForm__field" id="fecha-del-objetivo">
          <span>Fecha límite</span>
          <input name="dueDateISO" required type="date" value="${escapeHtml(dueDate)}" />
        </label>
      </div>
      <fieldset class="financeGoalForm__accounts" id="cuentas-del-objetivo">
        <legend>Cuentas incluidas</legend>
        <div class="financeGoalAccountsList">${accountsOptions || '<p class="finance-empty">No hay cuentas.</p>'}</div>
      </fieldset>
      <button class="finance-pill financeGoalForm__submit" id="btn-guardar-objetivo" type="submit">${isEdit ? 'Guardar cambios' : 'Guardar'}</button>
    </form>
  </div>`;
}

function getAccountMergeResolvedIds(resolvedGroups = []) {
  return new Set((resolvedGroups || []).flatMap((group) => {
    const destinationId = String(group?.destinationId || '').trim();
    const sourceIds = Array.isArray(group?.sourceIds) ? group.sourceIds.map((id) => String(id || '').trim()).filter(Boolean) : [];
    return [destinationId, ...sourceIds].filter(Boolean);
  }));
}

function normalizeAccountMergeModalState(modal = state.modal, accounts = buildAccountModels()) {
  const accountsById = Object.fromEntries((accounts || []).map((account) => [String(account?.id || '').trim(), account]));
  const resolvedGroups = Array.isArray(modal?.resolvedGroups)
    ? modal.resolvedGroups.map((group) => ({
      id: String(group?.id || `resolved-${hashString(JSON.stringify(group || {}))}`),
      destinationId: String(group?.destinationId || '').trim(),
      destinationName: String(group?.destinationName || '').trim(),
      sourceIds: Array.isArray(group?.sourceIds) ? group.sourceIds.map((id) => String(id || '').trim()).filter(Boolean) : [],
      sourceNames: Array.isArray(group?.sourceNames) ? group.sourceNames.map((name) => String(name || '').trim()).filter(Boolean) : [],
      mergedAt: Number(group?.mergedAt || 0) || nowTs(),
    })).filter((group) => group.destinationId || group.sourceIds.length)
    : [];
  const resolvedIds = getAccountMergeResolvedIds(resolvedGroups);
  const selectedIds = [...new Set((modal?.selectedIds || []).map((id) => String(id || '').trim()).filter((id) => accountsById[id] && !resolvedIds.has(id)))];
  const suggestionModel = getAccountMergeSuggestionModel(accounts);
  let destinationId = String(modal?.destinationId || '').trim();
  if (!selectedIds.includes(destinationId)) {
    destinationId = choosePreferredAccountMergeDestination(selectedIds, accountsById, suggestionModel.usageById);
  }
  return {
    ...modal,
    type: 'account-merge',
    query: String(modal?.query || ''),
    showResolved: !!modal?.showResolved,
    selectedIds,
    destinationId,
    merging: !!modal?.merging,
    resolvedGroups,
  };
}

function getAccountMergeSeedIds(seedAccountId = '', accounts = buildAccountModels()) {
  const seedId = String(seedAccountId || '').trim();
  if (!seedId) return [];
  const ids = new Set([seedId]);
  const seedAccount = (accounts || []).find((account) => String(account?.id || '').trim() === seedId) || null;
  const sameLast4 = getCardLast4Duplicates(seedAccount?.cardLast4 || '', seedId);
  sameLast4.forEach((account) => ids.add(String(account?.id || '').trim()));
  getPossibleAccountMergeSuggestions(accounts)
    .filter((suggestion) => suggestion.accountIds.includes(seedId))
    .slice(0, 3)
    .forEach((suggestion) => suggestion.accountIds.forEach((id) => ids.add(String(id || '').trim())));
  return [...ids].filter(Boolean);
}

function openAccountMergeModal(seedAccountId = '') {
  const accounts = buildAccountModels();
  const seedIds = getAccountMergeSeedIds(seedAccountId, accounts);
  state.modal = normalizeAccountMergeModalState({
    type: 'account-merge',
    query: '',
    showResolved: false,
    selectedIds: seedIds,
    destinationId: seedIds.includes(String(seedAccountId || '').trim()) ? String(seedAccountId || '').trim() : '',
    resolvedGroups: [],
    merging: false,
  }, accounts);
  triggerRender();
}

function updateAccountMergeSelection(accountId, forceSelected = null) {
  if (state.modal?.type !== 'account-merge') return;
  const accounts = buildAccountModels();
  const current = normalizeAccountMergeModalState(state.modal, accounts);
  const resolvedIds = getAccountMergeResolvedIds(current.resolvedGroups);
  const safeId = String(accountId || '').trim();
  if (!safeId || resolvedIds.has(safeId)) return;
  const nextSelected = new Set(current.selectedIds);
  const shouldSelect = forceSelected == null ? !nextSelected.has(safeId) : !!forceSelected;
  if (shouldSelect) nextSelected.add(safeId);
  else nextSelected.delete(safeId);
  state.modal = normalizeAccountMergeModalState({
    ...current,
    selectedIds: [...nextSelected],
    destinationId: shouldSelect && !current.destinationId ? safeId : current.destinationId,
  }, accounts);
  syncAccountMergeModal(null, accounts);
}

function setAccountMergeDestination(accountId) {
  if (state.modal?.type !== 'account-merge') return;
  const accounts = buildAccountModels();
  const current = normalizeAccountMergeModalState(state.modal, accounts);
  const safeId = String(accountId || '').trim();
  if (!current.selectedIds.includes(safeId)) return;
  state.modal = normalizeAccountMergeModalState({ ...current, destinationId: safeId }, accounts);
  syncAccountMergeModal(null, accounts);
}

function clearAccountMergeSelection() {
  if (state.modal?.type !== 'account-merge') return;
  const accounts = buildAccountModels();
  state.modal = normalizeAccountMergeModalState({ ...state.modal, selectedIds: [], destinationId: '' }, accounts);
  syncAccountMergeModal(null, accounts);
}

function applyAccountMergeSuggestion(suggestionId = '') {
  if (state.modal?.type !== 'account-merge') return;
  const accounts = buildAccountModels();
  const current = normalizeAccountMergeModalState(state.modal, accounts);
  const suggestionModel = getAccountMergeSuggestionModel(accounts);
  const suggestion = suggestionModel.suggestions.find((item) => item.id === suggestionId);
  if (!suggestion) return;
  state.modal = normalizeAccountMergeModalState({
    ...current,
    selectedIds: suggestion.accountIds,
    destinationId: choosePreferredAccountMergeDestination(
      suggestion.accountIds,
      Object.fromEntries(accounts.map((account) => [String(account?.id || '').trim(), account])),
      suggestionModel.usageById
    ),
  }, accounts);
  syncAccountMergeModal(null, accounts);
}

function buildAccountMergeViewModel(accounts = buildAccountModels()) {
  const modalState = normalizeAccountMergeModalState(state.modal, accounts);
  if (state.modal !== modalState) state.modal = modalState;
  const { usageById, profilesById, suggestions } = getAccountMergeSuggestionModel(accounts);
  const accountsById = Object.fromEntries((accounts || []).map((account) => [String(account?.id || '').trim(), account]));
  const query = normalizeAccountName(modalState.query || '');
  const selectedSet = new Set(modalState.selectedIds);
  const resolvedIds = getAccountMergeResolvedIds(modalState.resolvedGroups);
  const suggestionScoreById = {};
  suggestions.forEach((suggestion) => {
    suggestion.accountIds.forEach((accountId) => {
      suggestionScoreById[accountId] = Math.max(Number(suggestionScoreById[accountId] || 0), Number(suggestion.score || 0));
    });
  });

  const matchesQuery = (accountId) => {
    if (!query) return true;
    const profile = profilesById[accountId];
    return String(profile?.searchText || '').includes(query);
  };

  const pendingAccounts = (accounts || [])
    .filter((account) => modalState.showResolved || !resolvedIds.has(String(account?.id || '').trim()))
    .filter((account) => matchesQuery(String(account?.id || '').trim()))
    .sort((left, right) => {
      const leftId = String(left?.id || '').trim();
      const rightId = String(right?.id || '').trim();
      const leftSuggestion = Number(suggestionScoreById[leftId] || 0);
      const rightSuggestion = Number(suggestionScoreById[rightId] || 0);
      if (rightSuggestion !== leftSuggestion) return rightSuggestion - leftSuggestion;
      const leftRefs = Number(usageById[leftId]?.txRefs || 0) + Number(usageById[leftId]?.recurringRefs || 0);
      const rightRefs = Number(usageById[rightId]?.txRefs || 0) + Number(usageById[rightId]?.recurringRefs || 0);
      if (rightRefs !== leftRefs) return rightRefs - leftRefs;
      return String(left?.name || '').localeCompare(String(right?.name || ''), 'es', { sensitivity: 'base' });
    });

  const selectedAccounts = modalState.selectedIds.map((id) => accountsById[id]).filter(Boolean);
  const visibleSuggestions = suggestions.filter((suggestion) => {
    if (!query) return !suggestion.accountIds.every((id) => resolvedIds.has(id));
    return suggestion.accountIds.some((id) => matchesQuery(id));
  });
  const resolvedGroups = modalState.resolvedGroups.slice().sort((left, right) => Number(right?.mergedAt || 0) - Number(left?.mergedAt || 0));
  const destinationAccount = accountsById[modalState.destinationId] || null;
  const canMerge = selectedAccounts.length >= 2 && !!destinationAccount && !modalState.merging;

  return {
    modalState,
    accountsById,
    usageById,
    profilesById,
    selectedSet,
    resolvedIds,
    suggestionScoreById,
    pendingAccounts,
    selectedAccounts,
    visibleSuggestions,
    resolvedGroups,
    destinationAccount,
    canMerge,
    summaryText: `${pendingAccounts.length} pendientes · ${visibleSuggestions.length} sugerencias · ${resolvedGroups.length} resueltas en esta sesión`,
  };
}

function formatAccountMergeType(typeHint = '') {
  const map = {
    bitcoin: 'Bitcoin',
    credit: 'Crédito',
    debit: 'Débito',
    savings: 'Ahorro',
    checking: 'Corriente',
    cash: 'Efectivo',
    shared: 'Compartida',
  };
  return map[typeHint] || '';
}

function buildAccountMergeMetaLine(account = {}, profile = {}, usage = {}) {
  const parts = [];
  if (profile?.cardLast4) parts.push(`••••${profile.cardLast4}`);
  const typeLabel = formatAccountMergeType(profile?.typeHint || '');
  if (typeLabel) parts.push(typeLabel);
  const refs = Number(usage?.txRefs || 0) + Number(usage?.recurringRefs || 0);
  if (refs) parts.push(`${refs} refs`);
  const records = Number(usage?.entryCount || 0) + Number(usage?.snapshotCount || 0) + Number(usage?.legacyCount || 0);
  if (records) parts.push(`${records} registros`);
  const current = Number(account?.current ?? account?.currentReal);
  if (Number.isFinite(current)) parts.push(fmtCurrency(current));
  return parts.join(' · ');
}

function renderAccountMergePendingRow(account = {}, vm = {}) {
  const id = String(account?.id || '').trim();
  const profile = vm.profilesById?.[id] || {};
  const usage = vm.usageById?.[id] || {};
  const isSelected = vm.selectedSet?.has(id);
  const isResolved = vm.resolvedIds?.has(id);
  const isDestination = String(vm.destinationAccount?.id || '') === id;
  const badges = [];
  if (isDestination) badges.push('<span class="financeAccountMergeBadge financeAccountMergeBadge--primary">principal</span>');
  if (isSelected && !isDestination) badges.push('<span class="financeAccountMergeBadge financeAccountMergeBadge--selected">seleccionada</span>');
  if (vm.suggestionScoreById?.[id]) badges.push('<span class="financeAccountMergeBadge financeAccountMergeBadge--suggested">sugerida</span>');
  if (isResolved) badges.push('<span class="financeAccountMergeBadge financeAccountMergeBadge--resolved">resuelta</span>');
  return `
    <article class="financeAccountMergeRow${isSelected ? ' is-selected' : ''}${isResolved ? ' is-resolved' : ''}" data-account-merge-row="${escapeHtml(id)}" data-account-merge-key="pending:${escapeHtml(id)}">
      <button type="button" class="financeAccountMergeRow__main" data-account-merge-toggle="${escapeHtml(id)}" aria-pressed="${isSelected ? 'true' : 'false'}" ${isResolved ? 'disabled' : ''}>
        <div class="financeAccountMergeRow__titleLine">
          <strong>${escapeHtml(account?.name || 'Sin nombre')}</strong>
          <span class="financeAccountMergeRow__cta">${isSelected ? 'Quitar' : 'Revisar'}</span>
        </div>
        <small class="financeAccountMergeRow__meta">${escapeHtml(buildAccountMergeMetaLine(account, profile, usage) || 'Sin metadatos relevantes')}</small>
        ${badges.length ? `<div class="financeAccountMergeBadgeRow">${badges.join('')}</div>` : ''}
      </button>
    </article>
  `;
}

function renderAccountMergeSelectionRow(account = {}, vm = {}) {
  const id = String(account?.id || '').trim();
  const profile = vm.profilesById?.[id] || {};
  const usage = vm.usageById?.[id] || {};
  const isDestination = String(vm.destinationAccount?.id || '') === id;
  return `
    <article class="financeAccountMergeSelectionCard${isDestination ? ' is-primary' : ''}" data-account-merge-key="selection:${escapeHtml(id)}">
      <div class="financeAccountMergeSelectionCard__copy">
        <strong>${escapeHtml(account?.name || 'Sin nombre')}</strong>
        <small>${escapeHtml(buildAccountMergeMetaLine(account, profile, usage) || 'Sin metadatos')}</small>
      </div>
      <div class="financeAccountMergeBadgeRow">
        ${isDestination ? '<span class="financeAccountMergeBadge financeAccountMergeBadge--primary">principal</span>' : ''}
        ${profile?.cardLast4 ? `<span class="financeAccountMergeBadge">••••${escapeHtml(profile.cardLast4)}</span>` : ''}
      </div>
      <div class="financeAccountMergeSelectionActions">
        <button type="button" class="finance-pill finance-pill--mini" data-account-merge-destination="${escapeHtml(id)}" ${isDestination ? 'disabled' : ''}>Principal</button>
        <button type="button" class="finance-pill finance-pill--mini" data-account-merge-toggle="${escapeHtml(id)}">Quitar</button>
      </div>
    </article>
  `;
}

function renderAccountMergeSuggestionRow(suggestion = {}, vm = {}) {
  const accounts = suggestion.accountIds.map((id) => vm.accountsById?.[id]).filter(Boolean);
  const labels = accounts.map((account) => escapeHtml(account?.name || account?.id || 'Cuenta')).join(' ↔ ');
  return `
    <article class="financeAccountMergeSuggestionRow" data-account-merge-key="suggestion:${escapeHtml(suggestion.id || '')}">
      <div class="financeAccountMergeSuggestionRow__top">
        <strong>${labels}</strong>
        <span class="financeAccountMergeBadge">${Number(suggestion.score || 0)} pts</span>
      </div>
      <div class="financeAccountMergeBadgeRow">
        ${(suggestion.reasons || []).map((reason) => `<span class="financeAccountMergeBadge financeAccountMergeBadge--suggested">${escapeHtml(reason)}</span>`).join('')}
      </div>
      <div class="financeAccountMergeSelectionActions">
        <button type="button" class="finance-pill finance-pill--mini" data-account-merge-apply-suggestion="${escapeHtml(suggestion.id)}">Revisar grupo</button>
      </div>
    </article>
  `;
}

function renderAccountMergeResolvedRow(group = {}) {
  const title = group.destinationName || group.destinationId || 'Cuenta principal';
  const sources = (group.sourceNames || []).join(', ') || (group.sourceIds || []).join(', ');
  const when = Number(group.mergedAt || 0) ? new Date(group.mergedAt).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }) : '';
  return `
    <article class="financeAccountMergeResolvedRow" data-account-merge-key="resolved:${escapeHtml(group.id || '')}">
      <div class="financeAccountMergeResolvedRow__top">
        <strong>${escapeHtml(title)}</strong>
        <span class="financeAccountMergeBadge financeAccountMergeBadge--resolved">fusionada</span>
      </div>
      <small>${escapeHtml(sources ? `Absorbió: ${sources}` : 'Grupo resuelto')}</small>
      <small>${escapeHtml(when ? `Guardado a las ${when}` : '')}</small>
    </article>
  `;
}

function createAccountMergeKeyedNode(html = '') {
  const template = document.createElement('template');
  template.innerHTML = String(html || '').trim();
  return template.content.firstElementChild || document.createElement('div');
}

function patchAccountMergeSection(container, items = [], emptyHtml = '<p class="finance-empty">Sin datos.</p>') {
  if (!container) return;
  const scrollTop = container.scrollTop;
  if (!items.length) {
    container.innerHTML = emptyHtml;
    container.scrollTop = Math.max(0, scrollTop);
    return;
  }

  [...container.children].forEach((node) => {
    if (!node.matches?.('[data-account-merge-key]')) node.remove();
  });

  const existing = new Map(
    [...container.children]
      .map((node) => [String(node.dataset?.accountMergeKey || '').trim(), node])
      .filter(([key]) => key)
  );

  items.forEach((item) => {
    const key = String(item?.key || '').trim();
    const html = String(item?.html || '').trim();
    if (!key || !html) return;
    const currentNode = existing.get(key) || null;
    let nextNode = currentNode;
    if (!currentNode) {
      nextNode = createAccountMergeKeyedNode(html);
    } else if (currentNode.outerHTML !== html) {
      nextNode = createAccountMergeKeyedNode(html);
      currentNode.replaceWith(nextNode);
    }
    existing.delete(key);
    container.appendChild(nextNode);
  });

  existing.forEach((node) => node.remove());
  container.scrollTop = Math.max(0, scrollTop);
}

function renderAccountMergeModalShell() {
  return `
    <div id="finance-modal" class="finance-modal finance-modal--account-merge" role="dialog" aria-modal="true" tabindex="-1" data-account-merge-modal>
      <header class="financeAccountMerge__header">
        <div class="financeAccountMerge__heading">
          <h3>Fusionar cuentas</h3>
          <p class="financeAccountMerge__subtitle" data-account-merge-summary></p>
        </div>
        <div class="finance-row">
          <button type="button" class="finance-pill finance-pill--mini" data-account-merge-clear>Limpiar</button>
          <button type="button" class="finance-pill" data-close-modal>Cerrar</button>
        </div>
      </header>
      <div class="financeAccountMerge__toolbar">
        <input class="food-control" type="search" placeholder="Buscar por nombre, tarjeta o tipo" data-account-merge-search />
        <label class="financeStats__checkbox">
          <input type="checkbox" data-account-merge-show-resolved />
          Mostrar resueltas en la lista
        </label>
      </div>
      <div class="financeAccountMerge__layout">
        <section class="financeAccountMergePanel">
          <div class="financeAccountMergePanel__head">
            <div>
              <h4>Pendientes</h4>
              <small data-account-merge-pending-count></small>
            </div>
          </div>
          <div class="financeAccountMergeList" data-account-merge-pending-list></div>
        </section>
        <section class="financeAccountMergePanel financeAccountMergePanel--selection">
          <div class="financeAccountMergePanel__head">
            <div>
              <h4>Grupo actual</h4>
              <small data-account-merge-selection-count></small>
            </div>
          </div>
          <div class="financeAccountMergeList financeAccountMergeList--selection" data-account-merge-selection-list></div>
          <div class="financeAccountMergeActions">
            <p class="financeAccountMergeActions__copy" data-account-merge-action-copy>Selecciona al menos 2 cuentas para preparar la fusión.</p>
            <button type="button" class="finance-pill" data-account-merge-confirm disabled>Fusionar seleccionadas</button>
          </div>
        </section>
        <section class="financeAccountMergePanel financeAccountMergePanel--side">
          <div class="financeAccountMergeSideBlock">
            <div class="financeAccountMergePanel__head">
              <div>
                <h4>Posibles duplicados</h4>
                <small data-account-merge-suggestions-count></small>
              </div>
            </div>
            <div class="financeAccountMergeList financeAccountMergeList--suggestions" data-account-merge-suggestions-list></div>
          </div>
          <div class="financeAccountMergeSideBlock">
            <div class="financeAccountMergePanel__head">
              <div>
                <h4>Resueltas</h4>
                <small data-account-merge-resolved-count></small>
              </div>
            </div>
            <div class="financeAccountMergeList financeAccountMergeList--resolved" data-account-merge-resolved-list></div>
          </div>
        </section>
      </div>
    </div>
  `;
}

function syncAccountMergeModal(modalRoot = null, accounts = buildAccountModels()) {
  if (state.modal?.type !== 'account-merge') return;
  const root = modalRoot || document.querySelector('[data-account-merge-modal]');
  if (!root) return;
  const vm = buildAccountMergeViewModel(accounts);
  const searchInput = root.querySelector('[data-account-merge-search]');
  const showResolvedInput = root.querySelector('[data-account-merge-show-resolved]');
  const summary = root.querySelector('[data-account-merge-summary]');
  const pendingCount = root.querySelector('[data-account-merge-pending-count]');
  const selectionCount = root.querySelector('[data-account-merge-selection-count]');
  const suggestionCount = root.querySelector('[data-account-merge-suggestions-count]');
  const resolvedCount = root.querySelector('[data-account-merge-resolved-count]');
  const actionCopy = root.querySelector('[data-account-merge-action-copy]');
  const confirmButton = root.querySelector('[data-account-merge-confirm]');

  if (searchInput && document.activeElement !== searchInput) searchInput.value = vm.modalState.query || '';
  if (showResolvedInput) showResolvedInput.checked = !!vm.modalState.showResolved;
  if (summary) summary.textContent = vm.summaryText;
  if (pendingCount) pendingCount.textContent = `${vm.pendingAccounts.length} cuentas`;
  if (selectionCount) selectionCount.textContent = `${vm.selectedAccounts.length} seleccionadas`;
  if (suggestionCount) suggestionCount.textContent = `${vm.visibleSuggestions.length} grupos`;
  if (resolvedCount) resolvedCount.textContent = `${vm.resolvedGroups.length} grupos`;
  if (actionCopy) {
    actionCopy.textContent = vm.destinationAccount
      ? `Cuenta principal: ${vm.destinationAccount.name}. Se absorberán ${Math.max(0, vm.selectedAccounts.length - 1)} cuentas.`
      : 'Selecciona el grupo y marca una cuenta principal antes de fusionar.';
  }
  if (confirmButton) {
    confirmButton.disabled = !vm.canMerge;
    confirmButton.textContent = vm.modalState.merging ? 'Fusionando…' : 'Fusionar seleccionadas';
  }

  patchAccountMergeSection(
    root.querySelector('[data-account-merge-pending-list]'),
    vm.pendingAccounts.map((account) => {
      const id = String(account?.id || '').trim();
      return { key: `pending:${id}`, html: renderAccountMergePendingRow(account, vm) };
    }),
    '<p class="finance-empty">No quedan cuentas pendientes con este filtro.</p>'
  );
  patchAccountMergeSection(
    root.querySelector('[data-account-merge-selection-list]'),
    vm.selectedAccounts.map((account) => {
      const id = String(account?.id || '').trim();
      return { key: `selection:${id}`, html: renderAccountMergeSelectionRow(account, vm) };
    }),
    '<p class="finance-empty">Todavía no hay grupo de fusión.</p>'
  );
  patchAccountMergeSection(
    root.querySelector('[data-account-merge-suggestions-list]'),
    vm.visibleSuggestions.map((suggestion) => ({
      key: `suggestion:${String(suggestion?.id || '').trim()}`,
      html: renderAccountMergeSuggestionRow(suggestion, vm),
    })),
    '<p class="finance-empty">No hay sugerencias fiables con las cuentas actuales.</p>'
  );
  patchAccountMergeSection(
    root.querySelector('[data-account-merge-resolved-list]'),
    vm.resolvedGroups.map((group) => ({
      key: `resolved:${String(group?.id || '').trim()}`,
      html: renderAccountMergeResolvedRow(group),
    })),
    '<p class="finance-empty">Aún no has resuelto ningún grupo en esta sesión.</p>'
  );
}

function renderAccountMergeModal(backdrop, accounts = buildAccountModels()) {
  if (!backdrop.querySelector('[data-account-merge-modal]')) {
    backdrop.innerHTML = renderAccountMergeModalShell();
  }
  syncAccountMergeModal(backdrop.querySelector('[data-account-merge-modal]'), accounts);
}

function renderModal({ accounts = null, categories = null, txRows = null } = {}) {
  const backdrop = document.getElementById('finance-modalOverlay');
  if (!backdrop) return;
  if (!state.modal.type) {
    backdrop.classList.remove('is-open'); backdrop.classList.add('hidden'); backdrop.setAttribute('aria-hidden', 'true'); backdrop.innerHTML = ''; document.body.classList.remove('finance-modal-open'); return;
  }
  const resolvedAccounts = accounts || buildAccountModels();
  const resolvedTxRows = txRows || balanceTxList();
  const resolvedCategories = categories || categoriesList(resolvedTxRows);
  backdrop.classList.add('is-open'); backdrop.classList.remove('hidden'); backdrop.setAttribute('aria-hidden', 'false'); document.body.classList.add('finance-modal-open');
  if (state.modal.type === 'account-merge') {
    renderAccountMergeModal(backdrop, resolvedAccounts);
    return;
  }
  if (state.modal.type === 'account-detail') {
    const account = resolvedAccounts.find((item) => item.id === state.modal.accountId);
    if (!account) { state.modal = { type: null }; triggerRender(); return; }
    const chart = chartModelForRange(account.daily, 'total');
    state.lineChart = { points: chart.points || [], mode: 'total', kind: 'account', accountId: account.id, accountName: account.name };
    const preview = state.modal.importPreview;
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3> ${escapeHtml(account.name)}</h3><div class="finance-row"><button class="finance-pill finance-pill--mini" data-edit-account="${account.id}">Editar cuenta</button><button class="finance-pill" data-close-modal>Cerrar</button></div></header>
      <p>Saldo real: <strong>${fmtCurrency(account.currentReal)}</strong>${account.shared ? ` · Mi parte: <strong>${fmtCurrency(account.current)}</strong>` : ''}</p><div id="finance-lineChart" class="${chart.tone}">${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos.</div>'}</div>
      <form class="finance-entry-form" data-account-entry-form="${account.id}"><input name="day" type="date" value="${dayKeyFromTs(Date.now())}" required /><input name="value" type="number" step="0.01" placeholder="Valor real" required /><button class="finance-pill" id="guardar-dato-vista-detalle" type="submit">💳</button></form>
      <div class="finance-table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Δ</th><th>Δ%</th><th></th></tr></thead><tbody>${account.daily.slice().reverse().map((row) => `<tr><td>${new Date(row.ts).toLocaleDateString('es-ES')}</td><td><form data-account-row-form="${account.id}:${row.day}"><input name="value" type="number" step="0.01" value="${Number(row.realValue || row.value || 0)}"/></form></td><td class="${toneClass(row.delta)}">${fmtSignedCurrency(row.delta)}</td><td class="${toneClass(row.deltaPct)}">${fmtSignedPercent(row.deltaPct)}</td><td>
      <div class="boton-editar-borrar"><button class="finance-pill finance-pill--mini" data-save-day="${account.id}:${row.day}">✏️</button><button class="finance-pill finance-pill--mini" data-delete-day="${account.id}:${row.day}">❌</button></div></td></tr>`).join('') || '<tr><td colspan="5">Sin registros.</td></tr>'}</tbody></table></div>
      <section class="financeImportBox">
      
      <section class="financeImportBox">
  <details class="finance-import-details">
    <summary class="finance-import-summary">
      <span>Importar CSV</span>
      <span class="finance-import-chevron">⌄</span>
    </summary>

    <div class="finance-import-body">

      <form class="finance-budget-form" data-import-preview-form="${account.id}">
        <input type="file" accept=".csv,text/csv" data-import-file="${account.id}" />

        <textarea 
          name="csvText" 
          placeholder="date,value&#10;2026-01-01,1200.50"
        >${escapeHtml(state.modal.importRaw || '')}</textarea>

        <button class="finance-pill" type="submit">
          Previsualizar
        </button>
      </form>

      ${state.modal.importError 
        ? `<p class="is-negative">${escapeHtml(state.modal.importError)}</p>` 
        : ''}

      ${preview ? `
        <p>${preview.validRows.length} filas válidas / ${preview.totalRows}</p>

        <div class="finance-table-wrap">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Fecha</th>
                <th>Valor</th>
              </tr>
            </thead>
            <tbody>
              ${
                preview.validRows.slice(0, 10).map((row) => `
                  <tr>
                    <td>${row.lineNumber}</td>
                    <td>${row.dateISO}</td>
                    <td>${fmtCurrency(row.value)}</td>
                  </tr>
                `).join('') || 
                `<tr><td colspan="3">Sin filas válidas.</td></tr>`
              }
            </tbody>
          </table>
        </div>

        <button class="finance-pill" data-import-apply="${account.id}">
          Importar ahora
        </button>
      ` : ''}

    </div>
  </details>
</section>`;
    return;
  }
  if (state.modal.type === 'categories') {
    const rows = categoriesMetaList();
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal fm-modal" role="dialog" aria-modal="true" tabindex="-1" data-category-editor-modal>
      <header class="fm-modal__header">
        <h3 class="fm-modal__title">Categorías</h3>
        <button class="finance-pill fm-modal__close" type="button" data-category-editor-back>Volver</button>
      </header>
      <form class="fm-form finCatForm" data-category-editor-form>
        <div class="finCatForm__hint">Asigna un emoji a cada categoría (se usa en el selector rápido).</div>
        <div class="finCatGrid">
          ${rows.length ? rows.map((row) => `
            <div class="finCatRow" data-category-row="${escapeHtml(row.name)}">
              <div class="finCatEmojiBox">${escapeHtml(row.emoji || '⬜')}</div>
              <div class="finCatName">${escapeHtml(row.name)}</div>
              <input class="finCatEmojiInput" type="text" inputmode="text" maxlength="4" placeholder="😀" value="${escapeHtml(row.emoji || '')}" data-category-emoji="${escapeHtml(row.name)}" aria-label="Emoji para ${escapeHtml(row.name)}" />
              <button type="button" class="finance-pill finance-pill--mini finCatDelete" data-category-delete="${escapeHtml(row.name)}" aria-label="Eliminar ${escapeHtml(row.name)}">🗑️</button>
            </div>
          `).join('') : '<p class="finance-empty">Sin categorías.</p>'}
        </div>

        <div class="finCatAdd">
          <input class="finCatAdd__name" type="text" placeholder="Nueva categoría" autocomplete="off" data-category-add-name />
          <input class="finCatAdd__emoji" type="text" placeholder="Emoji" autocomplete="off" maxlength="4" data-category-add-emoji />
          <button type="button" class="finance-pill finCatAdd__btn" data-category-add>+ Añadir</button>
        </div>

        <div class="fm-actions">
          <button class="finance-pill fm-action fm-action--submit" type="submit">Guardar</button>
        </div>
      </form>
    </div>`;
    return;
  }
  if (state.modal.type === 'fixed-expense') {
  const form = state.fixedExpenseFormState || defaultFixedExpenseFormState();
  const isEditMode = !!String(form.id || '').trim();
  const modalTitle = isEditMode ? 'Editar gasto fijo' : 'Nuevo gasto fijo';
  const accountOptions = resolvedAccounts
    .map((a) => `<option value="${a.id}" ${String(form.accountId || '') === String(a.id) ? 'selected' : ''}>${escapeHtml(a.name)}</option>`)
    .join('');
  
  const categoryList = categoriesList();
  const categoryOptions = categoryList
    .map((c) => `<option value="${escapeHtml(c)}" ${String(form.category || '') === String(c) ? 'selected' : ''}>${escapeHtml(c)}</option>`)
    .join('');

  backdrop.innerHTML = `
    <div id="fixed-expense-modal" class="finance-modal fm-modal fin-move-modal fin-fixed-modal" role="dialog" aria-modal="true" tabindex="-1">
      <header class="fm-modal__header fin-move-header fin-fixed-header" id="fixed-expense-modal-header">
        <div class="finWizardHeader fin-fixed-wizard-header">
          <h3 class="fm-modal__title fin-move-title fin-fixed-title" id="fixed-expense-modal-title">${escapeHtml(modalTitle)}</h3>
        </div>
        <button class="finance-pill fm-modal__close fin-fixed-close" type="button" id="fixed-expense-close-btn" data-close-modal>Cerrar</button>
      </header>

      <form class="finance-entry-form fm-form fin-move-form fin-fixed-form" id="fixed-expense-edit-form" data-fixed-expense-form>
        <input type="hidden" name="id" id="fixed-expense-id-input" value="${escapeHtml(String(form.id || ''))}" />
        <div class="finance-form-grid fin-fixed-grid">

        <div id="meta-gasto-fijo">
            <label class="fin-fixed-field fin-fixed-field--emoji" for="fixed-expense-emoji-input">
              <span class="fin-fixed-label">Emoji</span>
              <input id="fixed-expense-emoji-input" name="emoji" type="text" maxlength="4" value="${escapeHtml(form.emoji || '💸')}" placeholder="💸" class="fin-fixed-input" />
            </label>

            <label class="fin-fixed-field fin-fixed-field--day" for="fixed-expense-day-input">
              <span class="fin-fixed-label">Día del mes</span>
              <input id="fixed-expense-day-input" name="dayOfMonth" type="number" min="1" max="31" value="${escapeHtml(String(form.dayOfMonth || 1))}" class="fin-fixed-input" />
            </label>

            <label class="fin-fixed-field fin-fixed-field--full fin-fixed-field--name" for="fixed-expense-name-input">
              <span class="fin-fixed-label">Nombre</span>
              <input id="fixed-expense-name-input" name="name" type="text" value="${escapeHtml(form.name || '')}" placeholder="Alquiler" class="fin-fixed-input fin-fixed-input--text" />
            </label>
        </div>

        <div id="meta-2-gasto-fijo">

          <label class="fin-fixed-field fin-fixed-field--amount" for="fixed-expense-amount-input">
            <span class="fin-fixed-label">Importe (€)</span>
            <input id="fixed-expense-amount-input" name="amount" type="number" step="0.01" inputmode="decimal" value="${escapeHtml(String(form.amount || ''))}" placeholder="0.00" class="fin-fixed-input fin-fixed-input--number" />
          </label>

          <label class="fin-fixed-field fin-fixed-field--type" for="fixed-expense-type-select">
            <span class="fin-fixed-label">Tipo</span>
            <select id="fixed-expense-type-select" name="type" class="fin-fixed-select fin-fixed-input">
              <option value="expense" ${form.type === 'expense' ? 'selected' : ''}>Gasto</option>
              <option value="income" ${form.type === 'income' ? 'selected' : ''}>Ingreso</option>
            </select>
          </label>
</div>
        <div id="meta-4-gasto-fijo">

                <div id="categoria-gasto-fijo">
                      <label class="fin-fixed-field fin-fixed-field--category" for="fixed-expense-category-select">
                        <span class="fin-fixed-label">Categoría</span>
                        <select id="fixed-expense-category-select" name="category" class="fin-fixed-select fin-fixed-input" required>
                          <option value="">Selecciona categoría</option>
                          ${categoryOptions}
                          <option value="Fijos" ${String(form.category || '') === 'Fijos' ? 'selected' : ''}>Fijos</option>
                        </select>
                      </label>
                </div>

            <div id="cuenta-gasto-fijo">
                      <label class="fin-fixed-field fin-fixed-field--account" for="fixed-expense-account-select">
                        <span class="fin-fixed-label">Cuenta</span>
                        <select id="fixed-expense-account-select" name="accountId" class="fin-fixed-select fin-fixed-input" required>
                          <option value="">Selecciona cuenta</option>
                          ${accountOptions}
                        </select>
                      </label>
            </div>
        </div>

        <div id="meta-3-gasto-fijo">
          <label class="fin-fixed-field fin-fixed-field--start-date" for="fixed-expense-start-date-input">
            <span class="fin-fixed-label">Inicio</span>
            <input id="fixed-expense-start-date-input" name="startDate" type="date" value="${escapeHtml(form.startDate || '')}" class="fin-fixed-input fin-fixed-input--date" />
          </label>

          <label class="fin-fixed-field fin-fixed-field--end-date" for="fixed-expense-end-date-input">
            <span class="fin-fixed-label">Fin</span>
            <input id="fixed-expense-end-date-input" name="endDate" type="date" value="${escapeHtml(form.endDate || '')}" class="fin-fixed-input fin-fixed-input--date" />
          </label>

          <label class="fin-fixed-field fin-fixed-field--full fin-fixed-field--note" for="fixed-expense-note-input">
            <span class="fin-fixed-label">Nota</span>
            <input id="fixed-expense-note-input" name="note" type="text" value="${escapeHtml(form.note || '')}" placeholder="Opcional" class="fin-fixed-input fin-fixed-input--text" />
          </label>
        </div>


          <label class="fin-fixed-check fin-fixed-field--checkbox" for="fixed-expense-active-checkbox">
            <input id="fixed-expense-active-checkbox" name="active" type="checkbox" ${form.active ? 'checked' : ''} class="fin-fixed-checkbox" />
            <span class="fin-fixed-check-label">Activo</span>
          </label>

          <label class="fin-fixed-check fin-fixed-field--checkbox" for="fixed-expense-autocreate-checkbox">
            <input id="fixed-expense-autocreate-checkbox" name="autoCreate" type="checkbox" ${form.autoCreate ? 'checked' : ''} class="fin-fixed-checkbox" />
            <span class="fin-fixed-check-label">Crear movimiento automáticamente</span>
          </label>
          <div class="fin-fixed-actions" style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
          <button type="button" class="finance-pill fin-fixed-action fin-fixed-action--cancel" id="fixed-expense-cancel-btn" data-close-modal>Cancelar</button>
          ${isEditMode ? `<button type="button" class="finance-pill finance-pill--danger fin-fixed-action fin-fixed-action--delete" id="fixed-expense-delete-btn" data-delete-fixed-expense="${escapeHtml(String(form.id || ''))}">🗑️ Eliminar</button>` : ''}
          <button type="button" class="finance-pill fin-fixed-action fin-fixed-action--test" id="fixed-expense-test-btn" data-test-fixed-expense>🧪 Prueba</button>
          <button type="submit" class="finance-pill finance-pill--primary fin-fixed-action fin-fixed-action--submit" id="fixed-expense-submit-btn">Guardar</button>
        </div>
        </div>

        
      </form>
    </div>
  `;
  return;
}
  if (state.modal.type === 'tx') {
  const accountsById = Object.fromEntries(resolvedAccounts.map((a) => [a.id, a]));
  const txEdit = state.modal.txId ? resolvedTxRows.find((row) => row.id === state.modal.txId) : null;
  const defaultAccountId = txEdit?.accountId || state.balanceFormState.accountId || state.balance.defaultAccountId || '';
  const defaultType = txEdit?.type || state.balanceFormState.type || 'expense';
  const defaultCategory = txEdit?.category || state.balanceFormState.category || '';
  const defaultDate = txEdit?.date || isoToDay(txEdit?.dateISO || '') || state.balanceFormState.dateISO || dayKeyFromTs(Date.now());
  const defaultAmount = txEdit ? String(txEdit?.amount ?? '') : (state.balanceFormState.amount || '');
  const defaultNote = txEdit?.note || state.balanceFormState.note || '';
  const defaultLinkedHabitId = (txEdit?.linkedHabitId || state.balanceFormState.linkedHabitId || '').trim();
  const defaultAllocation = normalizeTxAllocation(txEdit?.allocation || {
    mode: state.balanceFormState.allocationMode || 'point',
    period: state.balanceFormState.allocationPeriod || 'day',
    anchorDate: state.balanceFormState.allocationAnchorDate || defaultDate,
    customStart: state.balanceFormState.allocationCustomStart || '',
    customEnd: state.balanceFormState.allocationCustomEnd || ''
  }, defaultDate);
  const habitOptions = listHabitOptions();
  const defaultFoodId = state.balanceFormState.foodId || '';
  const defaultFoodItem = state.balanceFormState.foodItem || '';
  const defaultFoodMealType = state.balanceFormState.foodMealType || '';
  const defaultFoodCuisine = state.balanceFormState.foodCuisine || '';
  const defaultFoodPlace = state.balanceFormState.foodPlace || '';
  const defaultFoodExtrasOpen = !!state.balanceFormState.foodExtrasOpen;
  const defaultFoodResultsScrollTop = Number(state.balanceFormState.foodResultsScrollTop || 0);
  const defaultFrom = txEdit?.fromAccountId || state.balanceFormState.fromAccountId || defaultAccountId || '';
  const defaultTo = txEdit?.toAccountId || state.balanceFormState.toAccountId || '';
  const defaultPersonalRatioMode = Number.isFinite(Number(txEdit?.personalRatio)) ? 'custom' : (state.balanceFormState.personalRatioMode || 'auto');
  const defaultPersonalRatioPercent = Number.isFinite(Number(txEdit?.personalRatio)) ? String(Math.round(clamp01(txEdit.personalRatio, 1) * 100)) : (state.balanceFormState.personalRatioPercent || '');
  const defaultPersonalRatioAdvanced = Number.isFinite(Number(txEdit?.personalRatio)) || !!state.balanceFormState.personalRatioAdvanced;
  const linkedRecurringId = String(state.balanceFormState.recurringId || txEdit?.recurringId || '').trim();
  const recurringTemplate = linkedRecurringId ? (state.balance?.recurring?.[linkedRecurringId] || null) : null;
  const recurringSchedule = recurringTemplate?.schedule || txEdit?.schedule || {};
  const isRecurringInstanceEdit = !!(txEdit && linkedRecurringId);
  const defaultRecurringEnabled = !!state.balanceFormState.recurringEnabled;
  const defaultRecurringDay = Math.max(1, Math.min(31, Number(
    state.balanceFormState.recurringDay
    || recurringSchedule.dayOfMonth
    || recurringSchedule.dueDay
    || recurringSchedule.paymentDay
    || recurringSchedule.scheduledDay
    || String(defaultDate).slice(8, 10)
    || 1
  )));
  const defaultRecurringStart = state.balanceFormState.recurringStart || recurringSchedule.startDate || defaultDate;
  const defaultRecurringEnd = state.balanceFormState.recurringEnd || recurringSchedule.endDate || '';
  const recurringToggleLabel = isRecurringInstanceEdit ? 'Actualizar recurrente' : 'Activar';
  const isMovementSaving = !!getMovementFormMeta().saving;
  const accountOptions = resolvedAccounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const ticketImportState = state.modal.ticketImport || { raw: '', parsed: null, error: '', warnings: [], open: false };
  const ticketPreview = ticketImportState.parsed?.ok ? ticketImportState.parsed.data : null;
  const ticketPreviewWarnings = [...(ticketImportState.parsed?.warnings || []), ...(ticketImportState.warnings || [])];
  const diagnostic = ticketImportState.diagnostic || ticketImportState.parsed?.diagnostic || null;
  const rawText = String(ticketImportState.raw || '');
  const rawPreviewHead = rawText.slice(0, 80);
  const rawPreviewTail = rawText.length > 80 ? rawText.slice(-80) : '';
  const ticketCardPreview = resolveTicketCardAccountPreview(ticketPreview, resolvedAccounts);
  const selectedIsFood = isFoodCategoryName(defaultCategory);
  const wizardStepDraft = normalizeTxWizardStep(state.balanceFormState.txWizardStep);
  const wizardStep = wizardStepDraft === 'food' && !selectedIsFood ? 'category' : wizardStepDraft;
  const stepLabel = wizardStep === 'base' ? '1/3' : wizardStep === 'category' ? '2/3' : '3/3';
  const categoriesMeta = categoriesMetaList();
  backdrop.innerHTML = 
  
  `<div id="finance-modal" class="finance-modal fm-modal fin-move-modal" role="dialog" aria-modal="true" tabindex="-1" data-tx-step="${escapeHtml(wizardStep)}" data-tx-food="${selectedIsFood ? '1' : '0'}">
    <header class="fm-modal__header fin-move-header">
      <div class="finWizardHeader">
        <button type="button" class="finance-pill finance-pill--mini finWizardBack" data-tx-step-back ${wizardStep === 'base' ? 'hidden' : ''} aria-label="Volver">←</button>
      <h3 class="fm-modal__title fin-move-title">${txEdit ? 'Editar movimiento' : 'Añadir movimiento'}</h3>
      
        <div class="finWizardStep">${escapeHtml(stepLabel)}</div>
      </div>
      <button class="finance-pill fm-modal__close" type="button" data-close-modal>Cerrar</button>
    </header>

    <form class="finance-entry-form finance-tx-form fm-form fin-move-form" data-balance-form>
      <input type="hidden" name="txId" value="${escapeHtml(txEdit?.id || '')}" />
      <input type="hidden" name="recurringId" value="${escapeHtml(linkedRecurringId)}" />
      <input type="hidden" name="recurringMonthKey" value="${escapeHtml(state.balanceFormState.recurringMonthKey || txEdit?.recurringMonthKey || defaultDate.slice(0, 7))}" />
      <input type="hidden" name="recurringDueDateISO" value="${escapeHtml(state.balanceFormState.recurringDueDateISO || txEdit?.recurringDueDateISO || '')}" />

      <div class="fm-grid fm-grid--top fin-move-grid">


        
      <div class="fm-field fm-field--account" data-tx-account-single>
        <select id="fm-tx-account" class="fm-control fm-control--account fm-control--select" name="accountId" aria-label="Cuenta">
        <option value="">Cuenta</option>${accountOptions}</select>
      </div>

      

      <div class="fm-field fm-field--date">
        <input id="fm-tx-date" class="fm-control fm-control--date" name="dateISO" type="date" value="${defaultDate}" aria-label="Fecha"/>
      </div>
        

      </div>
      <div class="tipo-y-cantidad">
<div class="fm-field fm-field--type">
          <div class="finTypeChoices" role="group" aria-label="Tipo de movimiento">
            <button type="button" class="finTypeBtn ${defaultType === 'income' ? 'is-active' : ''}" data-tx-type-pick="income" aria-label="Ingreso">🤑</button>
            <button type="button" class="finTypeBtn ${defaultType === 'expense' ? 'is-active' : ''}" data-tx-type-pick="expense" aria-label="Gasto">💀</button>
            <button type="button" class="finTypeBtn ${defaultType === 'transfer' ? 'is-active' : ''}" data-tx-type-pick="transfer" aria-label="Transferencia">🔁</button>
          </div>
          <select id="fm-tx-type" name="type" class="finance-pill fm-control fm-control--select" data-tx-type hidden aria-hidden="true">
            <option value="expense" ${defaultType === 'expense' ? 'selected' : ''}>Gasto</option>
            <option value="income" ${defaultType === 'income' ? 'selected' : ''}>Ingreso</option>
            <option value="transfer" ${defaultType === 'transfer' ? 'selected' : ''}>Transferencia</option>
          </select>
        </div>

      <div class="fm-field fm-field--amount">
        <input id="fm-tx-amount" class="fm-control fm-control--amount" required name="amount" type="number" step="0.01" placeholder="Cantidad (€)" value="${escapeHtml(defaultAmount)}" aria-label="Cantidad"/>
        </div>
      <div class="fm-field fm-field--account" data-tx-account-from hidden>
        <label class="fm-label-cuenta-origen" for="fm-tx-account-from">Cuenta origen</label>
        
        <select id="fm-tx-account-from" class="fm-control fm-control--account fm-control--select" name="fromAccountId">
        <option value="">Selecciona cuenta</option>${accountOptions}</select>
      </div>

      <div class="fm-field fm-field--account" data-tx-account-to hidden>
        <label class="fm-label-cuenta-destino" for="fm-tx-account-to">Cuenta destino</label>
        <select id="fm-tx-account-to" class="fm-control fm-control--account fm-control--select" name="toAccountId">
        <option value="">Selecciona cuenta</option>${accountOptions}</select>
      </div>

    </div>


      <div class="fm-grid fm-grid--meta fin-move-grid fin-move-grid--meta">

        <div class="fm-field financeRoi__field">
          <label class="fm-label" for="fm-tx-linked-habit">Vincular a hábito (opcional)</label>
          <select id="fm-tx-linked-habit" class="fm-control fm-control--select" name="linkedHabitId" data-linked-habit-select>
            <option value="">Sin vincular</option>
            ${habitOptions.map((habit) => `<option value="${escapeHtml(habit.id)}" ${defaultLinkedHabitId === habit.id ? 'selected' : ''}>${escapeHtml(habit.name)}</option>`).join('')}
          </select>
        </div>

        <div class="fm-field financeRoi__field" data-allocation-block ${defaultLinkedHabitId ? '' : 'hidden'}>
          <label class="fm-label" for="fm-tx-allocation-mode">Distribución</label>
          <select id="fm-tx-allocation-mode" class="fm-control fm-control--select" name="allocationMode" data-allocation-mode>
            <option value="point" ${defaultAllocation.mode === 'point' ? 'selected' : ''}>Puntual (solo ese día)</option>
            <option value="month" ${(defaultAllocation.mode === 'period' && defaultAllocation.period === 'month') ? 'selected' : ''}>Mensual</option>
            <option value="week" ${(defaultAllocation.mode === 'period' && defaultAllocation.period === 'week') ? 'selected' : ''}>Semanal</option>
            <option value="year" ${(defaultAllocation.mode === 'period' && defaultAllocation.period === 'year') ? 'selected' : ''}>Anual</option>
            <option value="custom" ${(defaultAllocation.mode === 'period' && defaultAllocation.period === 'custom') ? 'selected' : ''}>Personalizado</option>
          </select>
          <label class="fm-label" data-allocation-anchor-label for="fm-tx-allocation-anchor" ${defaultAllocation.mode === 'point' ? 'hidden' : ''}>Periodo de referencia (ancla)</label>
          <input id="fm-tx-allocation-anchor" type="date" class="fm-control" name="allocationAnchorDate" value="${escapeHtml(defaultAllocation.anchorDate || defaultDate)}" data-allocation-anchor ${defaultAllocation.mode === 'point' ? 'hidden' : ''} />
          <div class="financeRoi__customDates" data-allocation-custom ${defaultAllocation.period === 'custom' && defaultAllocation.mode === 'period' ? '' : 'hidden'}>
            <label class="fm-label" for="fm-tx-allocation-custom-start">Desde (incl.)</label>
            <input id="fm-tx-allocation-custom-start" type="date" class="fm-control" name="allocationCustomStart" value="${escapeHtml(defaultAllocation.customStart || defaultAllocation.anchorDate || defaultDate)}" />
            <label class="fm-label" for="fm-tx-allocation-custom-end">Hasta (incl.)</label>
            <input id="fm-tx-allocation-custom-end" type="date" class="fm-control" name="allocationCustomEnd" value="${escapeHtml(defaultAllocation.customEnd || defaultAllocation.anchorDate || defaultDate)}" />
          </div>
        </div>

        <div class="fm-field fm-field--category fin-move-field" data-category-block>
          <div class="finCatScreenTop">
            <div class="finCatScreenTitle">Categoría</div>
            <button type="button" class="finance-pill finance-pill--mini" data-tx-edit-categories>Editar</button>
          </div>

          <select id="fm-tx-category" class="fm-control fm-control--category fm-control--select fin-move-select" name="category" hidden aria-hidden="true">
            <option value="">Seleccionar</option>${resolvedCategories.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}
          </select>

          <div class="finCatPicker" role="listbox" aria-label="Selecciona categoría">
            ${categoriesMeta.map((row) => `
              <button type="button" class="finCatTile ${String(defaultCategory || '').toLowerCase() === String(row.name || '').toLowerCase() ? 'is-selected' : ''}" data-tx-category-pick="${escapeHtml(row.name)}" aria-label="${escapeHtml(row.name)}">
                <span class="finCatTile__emoji" aria-hidden="true">${escapeHtml(row.emoji || '⬜')}</span>
              </button>
            `).join('')}
          </div>
        </div>
        
        <div class="fm-field fm-field--note">
          <input id="fm-tx-note" class="fm-control fm-control--note" name="note" type="text" placeholder="Nota (opcional)" value="${escapeHtml(defaultNote)}" aria-label="Nota"/>
        </div>
      </div>

      <div class="fm-field fin-move-field" data-personal-ratio-block>
        <label><input type="checkbox" name="personalRatioAdvanced" data-personal-ratio-advanced ${defaultPersonalRatioAdvanced ? 'checked' : ''}/> Ajuste avanzado</label>
        <div data-personal-ratio-wrap hidden>
          <label class="fm-label" for="fm-tx-personal-ratio-mode">Mi porcentaje</label>
          <select id="fm-tx-personal-ratio-mode" class="fm-control fm-control--select" name="personalRatioMode" data-personal-ratio-mode>
            <option value="auto" ${defaultPersonalRatioMode === 'auto' ? 'selected' : ''}>Automático</option>
            <option value="custom" ${defaultPersonalRatioMode === 'custom' ? 'selected' : ''}>Manual</option>
          </select>
          <div data-personal-ratio-manual-wrap hidden>
            <input class="fm-control" type="range" min="0" max="100" step="1" name="personalRatioPercent" data-personal-ratio-percent value="${escapeHtml(defaultPersonalRatioPercent || '50')}"/>
          </div>
          <small>Imputado a mí: <strong data-personal-ratio-preview>—</strong></small>
        </div>
      </div>

<details class="fm-details fin-move-extras" ${ticketImportState.open ? 'open' : ''}>
  <summary class="fm-details__summary">
    <span class="fm-details__title">Import</span>
    <span class="fm-details__hint">Ticket JSON</span>
    <span class="fm-details__chev" aria-hidden="true">⌄</span>
  </summary>
  <div class="fm-details__body">
    <div class="finance-row" style="gap:8px;flex-wrap:wrap;">
      <button type="button" class="finance-pill finance-pill--mini" data-ticket-import-preview>Preview</button>
      <button type="button" class="finance-pill finance-pill--mini" data-ticket-import-paste>📋 Pegar</button>
      <button type="button" class="finance-pill finance-pill--mini" data-ticket-import-sample>Pegar ejemplo</button>
      <button type="button" class="finance-pill finance-pill--mini" data-ticket-import-cancel>Cancel</button>
      <button type="button" class="finance-pill finance-pill--mini" data-ticket-import-copy-diagnostic>Copiar diagnóstico</button>
    </div>
    <textarea name="ticketImportRaw" data-ticket-import-raw rows="10" autocapitalize="off" autocorrect="off" spellcheck="false" style="width:100%;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;">${escapeHtml(ticketImportState.raw || '')}</textarea>
    <p class="finance-help" style="margin:6px 0 0 0;">raw.length=${rawText.length} · head=${escapeHtml(rawPreviewHead)}${rawPreviewTail ? ` · tail=${escapeHtml(rawPreviewTail)}` : ''}</p>
    ${ticketImportState.error ? `<p class="is-negative">${escapeHtml(ticketImportState.error)}</p>` : ''}
    ${diagnostic ? `
      <div class="finance-mini-list" style="margin-top:8px;max-height:220px;overflow:auto;">
        <p><strong>Diagnóstico</strong></p>
        <p>stage: ${escapeHtml(String(diagnostic.stage || 'unknown'))}</p>
        <p>raw.length: ${Number(diagnostic.raw_length || rawText.length)}</p>
        <p>sanitized.length: ${Number(diagnostic.sanitized_length || 0)}</p>
        <p>sanitize.changes: ${(diagnostic.sanitize_changes || []).map((it) => escapeHtml(String(it))).join(', ') || 'none'}</p>
        ${Number.isFinite(Number(diagnostic.computed_total)) || Number.isFinite(Number(diagnostic.purchase_total))
          ? `<p>computed_total: ${fmtCurrency(diagnostic.computed_total || 0)} · purchase.total: ${fmtCurrency(diagnostic.purchase_total || 0)}</p>`
          : ''}
        ${(diagnostic.validate_errors || []).map((entry) => `<p class="is-negative">• ${escapeHtml(String(entry.path || 'root'))}: ${escapeHtml(String(entry.message || entry.code || 'error'))}</p>`).join('')}
        ${diagnostic.parse_error?.snippet ? `<p>snippet: ${escapeHtml(String(diagnostic.parse_error.snippet || ''))}</p>` : ''}
        ${Array.isArray(diagnostic.parse_error?.charCodes) && diagnostic.parse_error.charCodes.length
          ? `<p>charCodes: ${escapeHtml(diagnostic.parse_error.charCodes.map((row) => `${row.offset}:${row.code}`).join(', '))}</p>`
          : ''}
      </div>
    ` : ''}
    ${ticketPreview ? `
      <div class="finance-mini-list" style="margin-top:8px;max-height:240px;overflow:auto;">
        <p><strong>Supermercado:</strong> ${escapeHtml(ticketPreview.source?.vendor || 'unknown')}</p>
        <p><strong>Fecha:</strong> ${escapeHtml(ticketPreview.purchase?.date || '—')}</p>
        <p><strong>ticket_total:</strong> ${fmtCurrency(ticketPreview.purchase?.total || 0)}</p>
        <p><strong>computed_total:</strong> ${fmtCurrency(ticketPreview.purchase?.computed_total || 0)}</p>
        ${ticketCardPreview.cardLast4 ? `<p><strong>Pago:</strong> tarjeta ****${escapeHtml(ticketCardPreview.cardLast4)}</p>` : ''}
        <p><strong>Cuenta sugerida:</strong> ${ticketCardPreview.status === 'single' ? escapeHtml(ticketCardPreview.selected?.name || '—') : 'No se pudo decidir'}</p>
        ${(ticketPreviewWarnings || []).map((warning) => `<p class="is-negative">⚠ ${escapeHtml(warning)}</p>`).join('')}
        <ul>${(ticketPreview.items || []).map((item) => `<li>${toTicketPriceLine(item)}</li>`).join('')}</ul>
      </div>
      <button type="button" class="finance-pill" data-ticket-import-apply>Apply Import</button>
    ` : ''}
  </div>
</details>


<details class="fm-details fm-details--extras fin-move-extras" data-section="food-extras" ${defaultFoodExtrasOpen ? 'open' : ''}>
<summary class="fm-details__summary">
<span class="fm-details__title">Extras</span>
<span class="fm-details__hint">Opcional</span>
<span class="fm-details__chev" aria-hidden="true">⌄</span>
</summary>
      
      <div class="fm-details__body">${renderFoodExtrasSection()}</div></details>


<details class="fm-details finFixed__wrap" >

  <summary class="fm-details__summary">
  <span class="fm-details__title">Recurrente / fijo</span>
  </summary>
  
  <div class="fm-details__body finFixed__fields">
<div class="boton-activar-programacion">
  <label><input type="checkbox" name="isRecurring" ${defaultRecurringEnabled ? "checked" : ""}/> ${recurringToggleLabel}</label>
  
  <select name="recurringFrequency"><option value="monthly">Mensual</option></select>
</div>
<div class="seleccion-programacion">
  <input type="number" name="recurringDay" min="1" max="31" placeholder="Día del mes" value="${escapeHtml(String(defaultRecurringDay || ""))}"/>
  
  <input type="date" name="recurringStart" value="${escapeHtml(defaultRecurringStart)}"/>
  
  <input type="date" name="recurringEnd" value="${escapeHtml(defaultRecurringEnd)}"/>
</div>

  </div>

</details>
      <div class="fm-actions fin-move-footer finWizardFooter">
        <button class="finance-pill finWizardNext" type="button" data-tx-step-next>Continuar</button>
        <button class="finance-pill fm-action fm-action--submit finWizardSubmit" type="submit" data-submit-label="${escapeHtml(txEdit ? 'Guardar cambios' : 'Añadir movimiento')}" ${isMovementSaving ? 'disabled' : ''}>${isMovementSaving ? 'Guardando…' : (txEdit ? 'Guardar cambios' : 'Añadir movimiento')}</button>
      </div>
    </form>
  </div>`;

  const form = backdrop.querySelector('[data-balance-form]');
  if (form) {
  ensureTxAdvancedDetails(form);
  const typeSel = form.querySelector('[data-tx-type]');
  const catSel = form.querySelector('select[name="category"]');

  // enganchar cambios
  typeSel?.addEventListener('change', () => {
    syncTxTypeFields(form);
  });
  form.querySelector('select[name="accountId"]')?.addEventListener('change', () => syncPersonalRatioFields(form));
  form.querySelector('[data-personal-ratio-advanced]')?.addEventListener('change', () => syncPersonalRatioFields(form));
  form.querySelector('[data-personal-ratio-mode]')?.addEventListener('change', () => syncPersonalRatioFields(form));
  form.querySelector('[data-personal-ratio-percent]')?.addEventListener('input', () => syncPersonalRatioFields(form));
  catSel?.addEventListener('change', () => {
    void toggleFoodExtras(form);
  });
  form.querySelector('[data-linked-habit-select]')?.addEventListener('change', () => syncAllocationFields(form));
  form.querySelector('[data-allocation-mode]')?.addEventListener('change', () => syncAllocationFields(form));

  // aplicar estado inicial (después de setear defaults)
  syncTxTypeFields(form);
  syncAllocationFields(form);
  syncPersonalRatioFields(form);
  void toggleFoodExtras(form);
}
if (form) {
  state.balanceAmountAuto = true;
  const acc = form.querySelector('select[name="accountId"]');
  if (acc) acc.value = defaultAccountId || '';

  const cat = form.querySelector('select[name="category"]');
  if (cat) cat.value = defaultCategory || '';

  const from = form.querySelector('select[name="fromAccountId"]');
  if (from) from.value = defaultFrom || '';

  const to = form.querySelector('select[name="toAccountId"]');
  if (to) to.value = defaultTo || '';
  const ratioMode = form.querySelector('select[name="personalRatioMode"]');
  if (ratioMode) ratioMode.value = defaultPersonalRatioMode;
  const ratioPercent = form.querySelector('input[name="personalRatioPercent"]');
  if (ratioPercent && defaultPersonalRatioPercent) ratioPercent.value = defaultPersonalRatioPercent;

  // primero: que la UI refleje tipo + categoría
  syncTxTypeFields(form);
  syncAllocationFields(form);
  syncPersonalRatioFields(form);
  void toggleFoodExtras(form);
  maybeToggleCategoryCreate(form);

  // luego: extras (y vuelve a toggle por si categoría viene de txEdit)
  if (Array.isArray(state.balanceFormState.importedFoodItems) && state.balanceFormState.importedFoodItems.length) {
    writeFoodItemsToForm(form, state.balanceFormState.importedFoodItems);
    recalcFoodAmount(form);
    void toggleFoodExtras(form);
  } else if (txEdit?.extras || txEdit?.food) {
    const extras = normalizeFoodExtras(txEdit.extras || txEdit.food, txEdit.amount);
    const refs = getFoodFormRefs(form);
    if (refs.mealType) refs.mealType.value = extras?.filters?.mealType || '';
    if (refs.cuisine) refs.cuisine.value = extras?.filters?.cuisine || '';
    if (refs.place) refs.place.value = extras?.filters?.place || '';
    const firstName = extras?.items?.[0]?.name || '';
    if (refs.itemSearch) refs.itemSearch.value = firstName;
    if (refs.itemValue) refs.itemValue.value = firstName;
    writeFoodItemsToForm(form, extras?.items || []);
    recalcFoodAmount(form);
    void toggleFoodExtras(form);
  } else {
    writeFoodItemsToForm(form, []);
    const refs = getFoodFormRefs(form);
    if (refs.itemSearch) refs.itemSearch.value = defaultFoodItem;
    if (refs.itemValue) refs.itemValue.value = defaultFoodItem;
    if (refs.foodId) refs.foodId.value = defaultFoodId;
    if (refs.mealType) refs.mealType.value = defaultFoodMealType;
    if (refs.cuisine) refs.cuisine.value = defaultFoodCuisine;
    if (refs.place) refs.place.value = defaultFoodPlace;
  }
  const foodDetails = form.querySelector('[data-section="food-extras"]');
  foodDetails?.addEventListener('toggle', () => {
    state.balanceFormState = { ...state.balanceFormState, foodExtrasOpen: !!foodDetails.open };
  });
  const refs = getFoodFormRefs(form);
  if (refs.itemResults) {
    refs.itemResults.scrollTop = Number.isFinite(defaultFoodResultsScrollTop) ? defaultFoodResultsScrollTop : 0;
    refs.itemResults.addEventListener('scroll', () => {
      state.balanceFormState = { ...state.balanceFormState, foodResultsScrollTop: refs.itemResults.scrollTop };
    });
  }
}
  return;
}
  if (state.modal.type === 'tx-day') {
    const day = String(state.modal.day || '');
    const monthKey = String(day).slice(0, 7);
    const rows = [
      ...resolvedTxRows.filter((row) => isoToDay(row.date || row.dateISO || '') === day),
      ...recurringVirtualForMonth(monthKey, resolvedTxRows, { includeFuture: true }).filter((row) => row.date === day)
    ].sort((a, b) => txSortTs(b) - txSortTs(a));
    const accountName = (id) => escapeHtml(resolvedAccounts.find((a) => a.id === id)?.name || 'Sin cuenta');
    const ratioAccountsById = Object.fromEntries(resolvedAccounts.map((a) => [a.id, a]));
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Movimientos del día ${escapeHtml(day)}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><div class="financeTxList">${rows.map((row) => {
      const accountText = row.type === 'transfer' ? `${accountName(row.fromAccountId)} → ${accountName(row.toAccountId)}` : accountName(row.accountId);
      const ratioMy = personalRatioForTx(row, ratioAccountsById);
      const ratioBadge = row.type === 'transfer' ? '' : `<small> · Imputado a mí: ${Math.round(ratioMy * 100)}%</small>`;
      const recurringBadge = row.recurringVirtual
        ? `<small> · recurrente ${row.recurringStatus === 'upcoming' ? 'programado' : (row.recurringStatus === 'due' ? 'vence hoy' : 'pendiente')}</small>`
        : '';
      const actionButtons = row.recurringVirtual
        ? `<button class="finance-pill finance-pill--mini" data-recurring-instance-open="${escapeHtml(String(row.recurringId || ''))}" data-recurring-month="${escapeHtml(String(row.monthKey || monthKey))}">✏️</button>`
        : `<button class="finance-pill finance-pill--mini" data-tx-edit="${row.id}">✏️</button><button class="finance-pill finance-pill--mini" data-tx-delete="${row.id}">❌</button>`;
      return `<div class="financeTxRow"><span>${escapeHtml(row.note || row.category || '—')} · ${accountText}${ratioBadge}${recurringBadge}</span><strong class="${toneClass(personalDeltaForTx(row, ratioAccountsById))}">${fmtCurrency(row.amount)}</strong><span class="finance-row">${actionButtons}</span></div>`;
    }).join('') || '<p class="finance-empty">Sin movimientos.</p>'}</div></div>`;
    return;
  }
  if (state.modal.type === 'balance-drilldown') {
    const txType = state.modal.txType === 'income' ? 'income' : 'expense';
    const monthOffset = Number(state.modal.monthOffset || 0);
    const monthKey = offsetMonthKey(getMonthKeyFromDate(), monthOffset);
    const rows = buildDrilldownRows(txType, monthKey);
    const title = txType === 'income' ? 'Ingresos' : 'Gastos';
    const accountName = (id) => escapeHtml(resolvedAccounts.find((a) => a.id === id)?.name || 'Sin cuenta');
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>${title} · ${monthLabelByKey(monthKey)}</h3><div class="finance-row"><button class="finance-pill" data-drilldown-month="-1">◀</button><button class="finance-pill" data-drilldown-month="1">▶</button><button class="finance-pill" data-drilldown-add="${txType}">+ Añadir</button><button class="finance-pill" data-close-modal>Cerrar</button></div></header><div class="financeTxList financeTxList--scroll" style="max-height:360px;overflow-y:auto;">${rows.map((row) => `<div class="financeTxRow"><span>${new Date(row.date || row.dateISO).toLocaleDateString('es-ES')}</span><span>${escapeHtml(row.note || row.category || '—')} · ${accountName(row.accountId)}</span><strong class="${txType === 'income' ? 'is-positive' : 'is-negative'}">${fmtCurrency(row.amount)}</strong></div>`).join('') || '<p class="finance-empty">Sin registros en este mes.</p>'}</div></div>`;
    return;
  }
  if (state.modal.type === 'calendar-day-edit') {
    const day = String(state.modal.day || '').trim();
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Editar saldos · ${escapeHtml(day)}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <form id="vista-detalle-dia" data-calendar-day-form="${escapeHtml(day)}">${resolvedAccounts.map((account) => `<label>${escapeHtml(account.name)}<input name="acc_${account.id}" type="number" step="0.01" value="${accountValueForDay(account, day)}" /></label>`).join('') || '<p class="finance-empty">No hay cuentas.</p>'}<button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'budget') {
    const monthKey = getSelectedBalanceMonthKey();
    const budget = state.modal.budgetId ? getBudgetItems(monthKey).find((item) => item.id === state.modal.budgetId) : null;
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>${budget ? 'Editar' : 'Nuevo'} presupuesto (${monthKey})</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
 
    <form class="finance-budget-form-presupuesto" data-budget-form>
    
    <input name="category" list="finance-cat-list" value="${escapeHtml(budget?.category || '')}" placeholder="Categoría o Total" required />
    
    <datalist id="finance-cat-list">
    
    <option value="Total"></option>
    
    ${resolvedCategories.map((c) => `
      
      <option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      
      <input name="limit" type="number" step="0.01" value="${Number(budget?.limit || 0)}" placeholder="Límite €" required />
      <input name="monthKey" type="month" value="${monthKey}" required />
      
      <button class="finance-pill" type="submit">Guardar presupuesto</button>
      </form>
      ${budget ? `<button class="finance-pill" type="button" data-budget-delete="${budget.id}">Eliminar</button>` : ''}</div>`;
    return;
  }
  if (state.modal.type === 'goal') {
    backdrop.innerHTML = renderGoalEditorModal(null, resolvedAccounts);
    return;
  }
  if (state.modal.type === 'goal-detail') {
    const goal = state.goals.goals?.[state.modal.goalId];
    if (!goal) { state.modal = { type: null }; triggerRender(); return; }
    backdrop.innerHTML = renderGoalEditorModal({ id: state.modal.goalId, ...goal }, resolvedAccounts);
    return;
  }
  if (state.modal.type === 'goal-legacy') {
    const accountsOptions = resolvedAccounts.map((a) => `<label><input type="checkbox" name="accountsIncluded" value="${a.id}" /> ${escapeHtml(a.name)}</label>`).join('');
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Nuevo objetivo</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
    <form class="finance-goal-form" data-goal-form><input name="title" required placeholder="Título" /><input name="targetAmount" required type="number" step="0.01" placeholder="Cantidad objetivo"/><input name="dueDateISO" required type="date" /><fieldset><legend>Cuentas incluidas</legend>${accountsOptions || '<p class="finance-empty">No hay cuentas.</p>'}</fieldset><button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'goal-detail-legacy') {
    const goal = state.goals.goals?.[state.modal.goalId]; if (!goal) { state.modal = { type: null }; triggerRender(); return; }
    const selected = new Set(goal.accountsIncluded || []);
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>${escapeHtml(goal.title)}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <p>Meta ${fmtCurrency(goal.targetAmount)} · vence ${new Date(goal.dueDateISO).toLocaleDateString('es-ES')}</p><p>Prioridad por (dinero / días).</p>
      <form data-goal-accounts-form="${state.modal.goalId}">${resolvedAccounts.map((a) => `<label><input type="checkbox" value="${a.id}" ${selected.has(a.id) ? 'checked' : ''}/> ${escapeHtml(a.name)}</label>`).join('')}<button class="finance-pill" type="submit">Actualizar cuentas</button></form></div>`;
    return;
  }

  if (state.modal.type === 'roi-info') {
    const habits = listHabitOptions();
    const hasGermanClassesHabit = habits.some((habit) => /alem[aá]n/i.test(habit.name) && /clase/i.test(habit.name));
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Cómo se calcula €/h por hábito</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <div class="finance-info-copy">
        <p><strong>Distribución:</strong> Puntual cuenta solo el día del movimiento. Mensual/Semanal/Anual usan su periodo de referencia. Personalizado usa el rango [desde, hasta] (incluyentes).</p>
        <p><strong>Rango visible:</strong> este panel usa solo las horas del hábito dentro del rango que estás viendo (día/semana/mes/año/total).</p>
        <p><strong>Prorrateo:</strong> si tu rango visible cubre solo parte del periodo de una transacción, se imputa solo la parte proporcional por solape de días.</p>
        <p><strong>Ejemplo:</strong> Ingreso mensual 300€ en febrero + 30h en febrero = 10€/h. Si luego registras más horas ese mes, el €/h baja.</p>
        <p><strong>Horas = 0:</strong> se muestra N/A.</p>
        <p><strong>Movimientos sin vínculo a hábito:</strong> no cuentan aquí.</p>
        <hr />
        <p><strong>Alemán recomendado en 2 hábitos:</strong></p>
        <ul>
          <li><strong>Alemán (clases):</strong> usa solo el botón “Clase” (1h por clase) y vincula aquí el gasto de clases.</li>
          <li><strong>Alemán (autoestudio):</strong> Duolingo/otros, sin coste asociado.</li>
        </ul>
        <p>${hasGermanClassesHabit ? 'Las horas de “Alemán (clases)” salen del botón Clase (1h por pulsación).' : 'Si activas el botón “Clase”, las horas pueden contarse como 1h por pulsación en “Alemán (clases)”.'}</p>
      </div>
    </div>`;
    return;
  }

  if (state.modal.type === 'history') {
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Historial</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><div class="finance-history-list">${accounts.map((account) => `<details class="finance-history-item" data-history-account="${account.id}"><summary><strong>${escapeHtml(account.name)}</strong><small>${account.daily.length} registros · ${fmtCurrency(account.current)}</small></summary><div class="finance-history-rows" data-history-rows="${account.id}"><p class="finance-empty">Pulsa para cargar…</p></div></details>`).join('') || '<p class="finance-empty">Sin historial.</p>'}</div></div>`;
    return;
  }
  if (state.modal.type === 'edit-account') {
    const account = accounts.find((item) => item.id === state.modal.accountId);
    if (!account) { state.modal = { type: null }; triggerRender(); return; }
    const duplicateCardAccounts = getCardLast4Duplicates(account.cardLast4, account.id);
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Editar cuenta</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
    
    <form id="grid-modal-edicion-cuenta" class="finance-entry-form" data-edit-account-form="${account.id}">
    
    <input type="text" name="name" value="${escapeHtml(account.name)}" required />
    
    <div id="checkboxs-edicion-cuenta">
    <label>
    <input class="app-toggle__input" type="checkbox" name="shared" ${account.shared ? 'checked' : ''} /> <span>Cuenta compartida</span>
    </label>

    <select name="sharedRatio"><option value="0.5" ${(account.sharedRatio === 0.5) ? 'selected' : ''}>50%</option></select>
    
    <div id="btc-input">
    <label><input class="app-toggle__input" type="checkbox" name="isBitcoin" ${account.isBitcoin ? 'checked' : ''} /><span> Cuenta Bitcoin</span></label>
    <input type="number" name="btcUnits" step="0.00000001" min="0" value="${Number(account.btcUnits || 0)}" placeholder="BTC unidades" />

    </div>
    </div>

    
    <label>Tarjeta (últimos 4)
    <input type="text" name="cardLast4" data-card-last4-input inputmode="numeric" maxlength="4" pattern="\\d{4}" value="${escapeHtml(normalizeCardLast4(account.cardLast4 || ''))}" placeholder="1234" />
    </label>

    ${duplicateCardAccounts.length ? '<small class="is-negative">⚠ last4 duplicado: el import no podrá decidir.</small>' : ''}
    
    
    
    <small id="valor-btc">BTC/EUR: ${state.btcEurPrice ? fmtCurrency(state.btcEurPrice) : '—'} · Valor estimado: ${fmtCurrency(Number(account.btcUnits || 0) * Number(state.btcEurPrice || 0))}</small>
    <button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'new-account') {
    backdrop.innerHTML =
    `<div id="finance-modal" class="finance-modal finance-modal--new-account" role="dialog" aria-modal="true" tabindex="-1">
    <section id="financeAccountCreateModal">
    <header class="financeAccountCreateModal__header">
    <h3>Nueva cuenta</h3>
    <button class="finance-pill finance-pill--mini" type="button" data-close-modal aria-label="Cerrar">✕</button></header>
    <form id="financeAccountCreateForm" class="finance-account-create-form finance-entry-form" data-new-account-form>
      <div class="finance-account-create-grid">
      <label class="financeAccountForm__field">
        <span class="financeAccountForm__label">Nombre</span>
        <input type="text" name="name" data-account-name-input placeholder="Nombre de la cuenta" required />
      </label>
      <label class="financeAccountForm__field">
        <span class="financeAccountForm__label">Tarjeta</span>
        <input type="text" name="cardLast4" data-card-last4-input inputmode="numeric" maxlength="4" pattern="\\d{4}" placeholder="Últimos 4" />
      </label>
      <label class="financeAccountForm__field">
        <span class="financeAccountForm__label">Valor inicial</span>
        <input type="number" name="initialValue" step="0.01" inputmode="decimal" value="0" placeholder="0.00" />
      </label>
      </div>
      <div class="financeAccountForm__toggles finance-account-create-flags" role="group" aria-label="Opciones de cuenta">
        <label class="financeAccountForm__toggle"><input type="checkbox" name="shared" /> <span>Compartida</span></label>
        <label class="financeAccountForm__toggle"><input type="checkbox" name="isBitcoin" /> <span>Cuenta Bitcoin</span></label>
      </div>
      <div class="financeAccountForm__conditional finance-account-create-shared" data-account-shared-fields hidden>
        <label class="financeAccountForm__field">
          <span class="financeAccountForm__label">Porcentaje compartido</span>
          <select name="sharedRatio">
            <option value="50">50%</option>
          </select>
        </label>
      </div>
      <div class="financeAccountForm__conditional finance-account-create-btc" data-account-btc-fields hidden>
        <label class="financeAccountForm__field">
          <span class="financeAccountForm__label">BTC unidades</span>
          <input type="number" name="btcUnits" step="0.00000001" min="0" value="0" placeholder="BTC unidades" />
        </label>
        <p class="financeAccountForm__hint" data-account-btc-hint>BTC/EUR: ${state.btcEurPrice ? fmtCurrency(state.btcEurPrice) : '—'} · Valor estimado: ${fmtCurrency(0)}</p>
      </div>
      <div class="financeAccountForm__actions"><button class="finance-pill" type="submit">Crear</button></div>
    </form></section></div>`;
    queueMicrotask(() => syncNewAccountFormUI(document.querySelector('[data-new-account-form]')));
    return;
  }
  if (state.modal.type === 'food-products') {
    ensureFoodCatalogLoaded();
    ensureFoodMetaCatalogLoaded();
    backdrop.innerHTML = renderFoodProductsModal();
    return;
  }
  if (state.modal.type === 'products-batch-edit') {
    ensureFoodCatalogLoaded();
    ensureFoodMetaCatalogLoaded();
    backdrop.innerHTML = renderProductsBatchEditModal(buildCurrentProductsModel());
    return;
  }
  if (state.modal.type === 'food-merge') {
    ensureFoodCatalogLoaded();
    ensureFoodMetaCatalogLoaded();
    const selected = Array.isArray(state.modal.selected) ? state.modal.selected : [];
    const destinationId = String(state.modal.destinationId || selected[0] || '');
    const hideResolved = state.modal.hideResolved !== false;
    const destinationSearch = normalizeFoodCompareKey(state.modal.destinationSearch || '');
    const { origin, destination, all, pendingCount } = getMergeEligibleProducts({ hideResolved, searchTerm: state.modal.search || '', selectedIds: selected });
    const options = origin;
    const selectedOptions = destination
      .filter((item) => selected.includes(item.id))
      .filter((item) => !destinationSearch || normalizeFoodCompareKey(item.name).includes(destinationSearch));
    const selectedSet = new Set(selected);
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal food-sheet-modal" role="dialog" aria-modal="true" tabindex="-1"><header class="food-sheet-header"><h3>Fusionar productos</h3><button class="btn-x food-sheet-close" data-close-modal aria-label="Cerrar">✕</button></header><section class="finFoodDetailSection finFoodCard"><div class="finFoodMergeHead"><input class="food-control" type="search" placeholder="Buscar productos a fusionar" value="${escapeHtml(state.modal.search || '')}" data-food-merge-search /><label class="financeStats__checkbox"><input type="checkbox" data-food-merge-hide-resolved ${hideResolved ? 'checked' : ''}> Solo pendientes</label><small class="finFoodMergeCounter">Mostrando ${options.length} de ${all.length} · pendientes: ${pendingCount}</small></div><div class="finFoodMergeList">${options.map((item) => `<label class="finFoodMergeRow" data-food-merge-option data-food-merge-name="${escapeHtml(normalizeProductItemKey(item.name))}"><input type="checkbox" data-food-merge-select="${escapeHtml(item.id)}" ${selectedSet.has(item.id) ? 'checked' : ''}> <span>${escapeHtml(item.name)}</span>${!hideResolved ? `<small class="finFoodMergeBadgeRow">${item.mergeMeta.absorbed ? '<span class="finFoodMergeBadge finFoodMergeBadge--absorbed">absorbido</span>' : ''}${item.mergeMeta.canonicalId === item.id ? '<span class="finFoodMergeBadge">canónico</span>' : ''}${item.mergeMeta.resolved && !item.mergeMeta.absorbed ? '<span class="finFoodMergeBadge finFoodMergeBadge--resolved">resuelto</span>' : ''}</small>` : ''}</label>`).join('') || '<p class="finance-empty">Sin productos para mostrar con el filtro actual.</p>'}</div><label class="financeStats__checkbox">Producto destino</label><input class="food-control" type="search" placeholder="Buscar destino" value="${escapeHtml(state.modal.destinationSearch || '')}" data-food-merge-destination-search /><div class="finFoodMergeList">${selectedOptions.map((item) => `<label class="finFoodMergeRow" data-food-merge-destination-option data-food-merge-name="${escapeHtml(normalizeProductItemKey(item.name))}"><input type="radio" name="food-merge-destination" data-food-merge-destination="${escapeHtml(item.id)}" ${destinationId === item.id ? 'checked' : ''}> <span>${escapeHtml(item.name)}</span></label>`).join('') || '<p class="finance-empty">Selecciona al menos 2 productos canónicos para elegir destino.</p>'}</div><div class="finFoodChipRow"><button type="button" class="food-history-btn" data-food-merge-confirm ${(selected.length < 2 || !destinationId || !selectedSet.has(destinationId)) ? 'disabled' : ''}>Fusionar seleccionados</button></div></section></div>`;
    return;
  }
  if (state.modal.type === 'food-item') {
  const editing = state.modal.foodId
    ? (state.food.itemsById?.[state.modal.foodId] || resolveFoodItemByAnyKey(state.modal.foodId) || null)
    : null;

  const presetName = normalizeFoodName(state.modal.foodName || editing?.name || '');
  const mode = state.modal.mode || 'edit';

  // 👇 título = nombre del producto (fallback decente)
  const productTitle = presetName || editing?.name || 'Producto';

  const title =
    (mode === 'info' || mode === 'detail')
      ? escapeHtml(productTitle)
      : (editing ? 'Editar comida' : 'Nueva comida');

  backdrop.innerHTML = `<div id="finance-modal" class="finance-modal food-sheet-modal" role="dialog" aria-modal="true" tabindex="-1">
    <header class="food-sheet-header">
      <h3>${title}</h3>
      <button class="btn-x food-sheet-close" data-close-modal aria-label="Cerrar">✕</button>
    </header>
    ${renderFoodItemModalForm(editing, presetName, mode)}
  </div>`;

  void renderFoodHistoryVendorChart();
  initFoodDetailInteractions();
  return;
}
}

function getFoodFormRefs(form) {
  if (!form) return {};
  return {
    extra: form.querySelector('[data-food-extra]'),
    category: form.querySelector('select[name="category"]'),
    mealType: form.querySelector('select[name="foodMealType"]'),
    cuisine: form.querySelector('select[name="foodCuisine"]'),
    place: form.querySelector('select[name="foodPlace"]'),
    itemSearch: form.querySelector('[data-food-item-search]'),
    itemValue: form.querySelector('[data-food-item-value]'),
    foodId: form.querySelector('[data-food-id-value]'),
    itemResults: form.querySelector('[data-food-item-results]'),
    itemPrice: form.querySelector('[data-food-item-price]'),
    itemsJson: form.querySelector('[data-food-items-json]'),
    itemsList: form.querySelector('[data-food-items-list]')
  };
}

function clearFoodFormState(form) {
  const refs = getFoodFormRefs(form);
  if (refs.mealType) refs.mealType.value = '';
  if (refs.cuisine) refs.cuisine.value = '';
  if (refs.place) refs.place.value = '';
  if (refs.itemSearch) refs.itemSearch.value = '';
  if (refs.itemValue) refs.itemValue.value = '';
  if (refs.foodId) refs.foodId.value = '';
  if (refs.itemResults) refs.itemResults.innerHTML = '';
}

function keepFoodExtrasOpen(form) {
  const details = form?.querySelector('[data-section="food-extras"]');
  if (!details || details.hidden) return;
  details.open = true;
  state.balanceFormState = { ...state.balanceFormState, foodExtrasOpen: true };
}

function resetFoodEntryForm(form, { keepDropdownOpen = true } = {}) {
  const refs = getFoodFormRefs(form);
  if (refs.itemSearch) refs.itemSearch.value = '';
  if (refs.itemValue) refs.itemValue.value = '';
  if (refs.foodId) refs.foodId.value = '';
  if (refs.itemPrice) refs.itemPrice.value = '';
  if (refs.mealType) refs.mealType.value = '';
  if (refs.cuisine) refs.cuisine.value = '';
  if (refs.place) refs.place.value = '';
  if (!keepDropdownOpen) {
    const details = form?.querySelector('[data-section="food-extras"]');
    if (details) details.open = false;
  }
}

function readFoodItemsFromForm(form) {
  const refs = getFoodFormRefs(form);
  try {
    const items = JSON.parse(refs.itemsJson?.value || '[]');
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function writeFoodItemsToForm(form, items = []) {
  const refs = getFoodFormRefs(form);
  if (refs.itemsJson) refs.itemsJson.value = JSON.stringify(items);
  if (refs.itemsList) {
    refs.itemsList.innerHTML = items.length
      ? items.map((item, index) => `<div class="finFood__selectedItem"><span>${escapeHtml(item.name)} · ${fmtCurrency(item.price || 0)}</span><button type="button" class="finance-pill finance-pill--mini finance-pill-borrar-comida" data-food-item-remove="${index}">×</button></div>`).join('')
      : '<small class="finance-empty">Sin productos añadidos.</small>';
  }
}

function recalcFoodAmount(form) {
  const amountInput = form?.querySelector('input[name="amount"]');
  if (!amountInput || !state.balanceAmountAuto) return;
  const sum = readFoodItemsFromForm(form).reduce((acc, item) => acc + Number(item?.price || 0), 0);
  amountInput.value = sum ? String(sum.toFixed(2)) : '';
}

function renderFoodItemSearchResults(form) {
  const refs = getFoodFormRefs(form);
  if (!refs.itemResults) return;
  const prevScrollTop = refs.itemResults.scrollTop;
  const query = normalizeFoodName(refs.itemSearch?.value || '').toLowerCase();
  const mealType = normalizeFoodName(refs.mealType?.value || '').toLowerCase();
  const place = normalizeFoodName(refs.place?.value || '').toLowerCase();
  const cuisine = normalizeFoodName(refs.cuisine?.value || '').toLowerCase();
  const all = foodItemsList();
  const filteredByMeta = all.filter((row) => {
    const extras = row.meta || {};
    if (mealType && normalizeFoodName(extras.mealType || '').toLowerCase() !== mealType) return false;
    if (place && normalizeFoodName(extras.place || '').toLowerCase() !== place) return false;
    if (cuisine && normalizeFoodName(extras.cuisine || '').toLowerCase() !== cuisine) return false;
    return true;
  });
  const source = (mealType || place || cuisine) ? filteredByMeta : all;
  const filtered = query ? source.filter((row) => row.name.toLowerCase().includes(query)) : source;
  const rows = filtered.slice(0, 10).map((row) => { const selected = String(refs.foodId?.value || '') === String(row.id); return `
<div class="food-item" id="panel-lista-platos">
  <button type="button" class="food-pill ${selected ? 'is-selected' : ''}" data-food-item-select="${escapeHtml(row.id)}" id="plato-pill">

    <span class="food-pill__name">${escapeHtml(row.name)}</span>

    <small class="food-pill__count">×${row.count}</small>

  <button type="button" class="food-iconbtn" data-food-item-info="${escapeHtml(row.id)}" title="Ficha del producto" aria-label="Ficha del producto">ℹ️</button>

  <button type="button" class="food-iconbtn" data-food-item-edit="${escapeHtml(row.id)}" aria-label="Editar comida">✏️</button>

  </button>

</div>
    
    `; });
  const canCreate = query && !all.some((row) => row.name.toLowerCase() === query);
  if (canCreate) rows.push(`<button type="button" class="food-pill food-pill--create" data-food-item-create="${escapeHtml(refs.itemSearch?.value || '')}">Crear “${escapeHtml(refs.itemSearch?.value || '')}”</button>`);
  refs.itemResults.innerHTML = rows.join('') || '<small class="finance-empty">Sin resultados.</small>';
  const maxScrollTop = Math.max((refs.itemResults.scrollHeight || 0) - (refs.itemResults.clientHeight || 0), 0);
  refs.itemResults.scrollTop = Math.min(prevScrollTop, maxScrollTop);
  state.balanceFormState = { ...state.balanceFormState, foodResultsScrollTop: refs.itemResults.scrollTop };
}

function refreshFoodTopItems(form) {
  const host = form?.querySelector('[data-food-top]');
  if (!host) return;
  const topItems = topFoodItems(5);
  host.innerHTML = topItems.map((item) => 
    `<div class="food-item" id="contenedor-habituales">

  <div class="food-pill" data-food-top-item="${escapeHtml(item.id)}">

    <button type="button" class="food-pill__main">
      <span class="food-pill__name">${escapeHtml(item.name)}</span>
      <small class="food-pill__count">×${item.count}</small>
    </button>

    <div class="food-pill__actions">
      <button type="button"
        class="food-iconbtn"
        data-food-item-info="${escapeHtml(item.id)}"
        title="Ficha del producto"
        aria-label="Ficha del producto">
        ℹ️
      </button>

      <button type="button"
        class="food-iconbtn"
        data-food-item-edit="${escapeHtml(item.id)}"
        aria-label="Editar comida">
        ✏️
      </button>
    </div>

  </div>

</div>`
).join('') || '<small class="finance-empty">Sin habituales aún.</small>';
}

async function applyFoodItemPreset(form, foodIdOrName) {
  const safeValue = normalizeFoodName(foodIdOrName);
  if (!form || !safeValue) return;
  const refs = getFoodFormRefs(form);
  const preset = state.food.itemsById?.[safeValue] || getFoodByName(safeValue) || null;
  const name = normalizeFoodName(preset?.name || safeValue);
  if (refs.itemSearch) refs.itemSearch.value = name;
  if (refs.itemValue) refs.itemValue.value = name;
  if (refs.foodId) refs.foodId.value = preset?.id || '';
  if (refs.itemPrice && Number(preset?.defaultPrice || 0) > 0 && !String(refs.itemPrice.value || '').trim()) refs.itemPrice.value = String(preset.defaultPrice);
  const accountSelect = form.querySelector('select[name="accountId"]');
  if (accountSelect && preset?.lastAccountId) accountSelect.value = preset.lastAccountId;
  if (refs.mealType) refs.mealType.value = preset?.mealType || '';
  if (refs.cuisine) refs.cuisine.value = preset?.cuisine || preset?.healthy || '';
  if (refs.place) refs.place.value = preset?.place || '';
  financeDebug('food selected in form', { foodId: preset?.id || null, name });
  await toggleFoodExtras(form);
  persistBalanceFormState(form);
}

async function syncFoodOptionsInForm(form) {
  const refs = getFoodFormRefs(form);
  [['typeOfMeal', refs.mealType], ['cuisine', refs.cuisine], ['place', refs.place]].forEach(([kind, select]) => {
    if (!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">Seleccionar (opcional)</option>${foodOptionList(kind).map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}`;
    select.value = current;
  });
  refreshFoodTopItems(form);
  renderFoodItemSearchResults(form);
}




function syncTxTypeFields(form) {
  const typeSel = form.querySelector('[data-tx-type]');
  const elSingle = form.querySelector('[data-tx-account-single]');
  const elFrom = form.querySelector('[data-tx-account-from]');
  const elTo = form.querySelector('[data-tx-account-to]');
  if (!typeSel || !elSingle || !elFrom || !elTo) return;

  const isTransfer = typeSel.value === 'transfer';

  // Cuenta única
  elSingle.style.display = isTransfer ? 'none' : '';

  // Origen / destino
  elFrom.style.display = isTransfer ? '' : 'none';
  elTo.style.display = isTransfer ? '' : 'none';

  syncPersonalRatioFields(form);
}

function syncPersonalRatioFields(form) {
  const block = form?.querySelector('[data-personal-ratio-block]');
  const wrap = form?.querySelector('[data-personal-ratio-wrap]');
  const advanced = form?.querySelector('[data-personal-ratio-advanced]');
  const typeSel = form?.querySelector('[data-tx-type]');
  const accountSel = form?.querySelector('select[name="accountId"]');
  const modeSel = form?.querySelector('[data-personal-ratio-mode]');
  const manualWrap = form?.querySelector('[data-personal-ratio-manual-wrap]');
  const percentInput = form?.querySelector('[data-personal-ratio-percent]');
  const preview = form?.querySelector('[data-personal-ratio-preview]');
  if (!block || !wrap || !advanced || !typeSel || !accountSel || !modeSel || !manualWrap || !percentInput || !preview) return;

  const type = normalizeTxType(typeSel.value || 'expense');
  const accountId = String(accountSel.value || '');
  const account = (state.accounts || []).find((row) => row.id === accountId);
  const isSharedAccount = !!account?.shared;
  const visible = type !== 'transfer' && (isSharedAccount || advanced.checked);
  block.style.display = type === 'transfer' ? 'none' : '';
  wrap.hidden = !visible;

  const autoRatio = personalRatioForTx({ type, accountId }, Object.fromEntries((state.accounts || []).map((row) => [row.id, row])));
  const isManual = modeSel.value === 'custom';
  manualWrap.hidden = !isManual;
  const ratio = isManual ? clamp01(Number(percentInput.value || 0) / 100, autoRatio) : autoRatio;
  preview.textContent = `${Math.round(ratio * 100)}%`;
}

function syncAllocationFields(form) {
  const linked = form?.querySelector('[data-linked-habit-select]');
  const block = form?.querySelector('[data-allocation-block]');
  const modeSel = form?.querySelector('[data-allocation-mode]');
  const customWrap = form?.querySelector('[data-allocation-custom]');
  const anchorInput = form?.querySelector('[data-allocation-anchor]');
  const anchorLabel = form?.querySelector('[data-allocation-anchor-label]');
  if (!linked || !block || !modeSel || !customWrap || !anchorInput || !anchorLabel) return;
  const hasHabit = !!String(linked.value || '').trim();
  block.hidden = !hasHabit;
  const mode = String(modeSel.value || 'point');
  const isCustom = mode === 'custom';
  const showAnchor = mode !== 'point' && !isCustom;
  anchorInput.hidden = !showAnchor;
  anchorLabel.hidden = !showAnchor;
  customWrap.hidden = !(mode !== 'point' && isCustom);
}

function maybeToggleCategoryCreate(form) {
  const input = form?.querySelector('[data-category-new]');
  const btn = form?.querySelector('[data-category-create]');
  if (!input || !btn) return;
  const value = String(input.value || '').trim();
  const exists = categoriesList().some((row) => row.toLowerCase() === value.toLowerCase());
  btn.disabled = !value || exists;
  btn.textContent = value ? `+ añadir "${value}"` : '+';
}

function ensureTxAdvancedDetails(form) {
  if (!form || form.querySelector('[data-tx-advanced]')) return;

  const linkedField = form.querySelector('#fm-tx-linked-habit')?.closest('.fm-field') || null;
  const allocationField = form.querySelector('[data-allocation-block]') || null;
  const personalRatioField = form.querySelector('[data-personal-ratio-block]') || null;
  const recurringDetails = form.querySelector('details.finFixed__wrap') || null;
  const nodes = [linkedField, allocationField, personalRatioField, recurringDetails].filter(Boolean);
  if (!nodes.length) return;

  const details = document.createElement('details');
  details.className = 'fm-details finWizardAdvanced';
  details.dataset.txAdvanced = '1';
  details.innerHTML = `
    <summary class="fm-details__summary">
      <span class="fm-details__title">Ajustes avanzados</span>
      <span class="fm-details__hint">Opcional</span>
      <span class="fm-details__chev" aria-hidden="true">⌄</span>
    </summary>
    <div class="fm-details__body"></div>
  `;
  const body = details.querySelector('.fm-details__body');
  nodes.forEach((node) => body.appendChild(node));

  const importDetails = form.querySelector('details.fin-move-extras:not([data-section="food-extras"])');
  if (importDetails) importDetails.insertAdjacentElement('beforebegin', details);
  else form.appendChild(details);
}
async function toggleFoodExtras(form) {
  const catSel = form.querySelector('select[name="category"]');
  const foodBox = form.querySelector('[data-section="food-extras"]');
  if (!foodBox) return;

  const v = (catSel?.value || '').toLowerCase();
  const isFood = v === 'comida' || v.includes('comida');
  foodBox.hidden = !isFood;

  if (!isFood) {
    foodBox.removeAttribute('open');
    state.balanceFormState = { ...state.balanceFormState, foodExtrasOpen: false };
    return;
  }
  await ensureFoodCatalogLoaded();
  await syncFoodOptionsInForm(form);
  if (state.balanceFormState.foodExtrasOpen) foodBox.open = true;
}
function persistBalanceFormState(form) {
  if (!form) return;
  const prev = state.balanceFormState || {};
  const fd = new FormData(form);
  const next = {
    type: String(fd.get('type') || ''),
    amount: String(fd.get('amount') || ''),
    dateISO: String(fd.get('dateISO') || ''),
    accountId: String(fd.get('accountId') || ''),
    fromAccountId: String(fd.get('fromAccountId') || ''),
    toAccountId: String(fd.get('toAccountId') || ''),
    category: String(fd.get('category') || ''),
    note: String(fd.get('note') || ''),
    linkedHabitId: String(fd.get('linkedHabitId') || ''),
    allocationMode: String(fd.get('allocationMode') || 'point'),
    allocationPeriod: String(fd.get('allocationMode') || 'point'),
    allocationAnchorDate: String(fd.get('allocationAnchorDate') || ''),
    allocationCustomStart: String(fd.get('allocationCustomStart') || ''),
    allocationCustomEnd: String(fd.get('allocationCustomEnd') || ''),
    personalRatioMode: String(fd.get('personalRatioMode') || 'auto'),
    personalRatioPercent: String(fd.get('personalRatioPercent') || ''),
    personalRatioAdvanced: fd.get('personalRatioAdvanced') === 'on',
    foodMealType: String(fd.get('foodMealType') || ''),
    foodCuisine: String(fd.get('foodCuisine') || ''),
    foodPlace: String(fd.get('foodPlace') || ''),
    foodItem: String(fd.get('foodItem') || ''),
    foodId: String(fd.get('foodId') || ''),
    recurringId: String(fd.get('recurringId') || ''),
    recurringMonthKey: String(fd.get('recurringMonthKey') || ''),
    recurringDueDateISO: String(fd.get('recurringDueDateISO') || ''),
    recurringEnabled: fd.get('isRecurring') === 'on',
    recurringDay: String(fd.get('recurringDay') || ''),
    recurringStart: String(fd.get('recurringStart') || ''),
    recurringEnd: String(fd.get('recurringEnd') || ''),
    foodExtrasOpen: !!form.querySelector('[data-section="food-extras"]')?.open,
    foodResultsScrollTop: Number(form.querySelector('[data-food-item-results]')?.scrollTop || 0)
  };

  // Preserva campos del wizard/import que no existen como inputs del form
  state.balanceFormState = {
    ...prev,
    ...next,
    txWizardStep: prev.txWizardStep || 'base',
    importedFoodItems: prev.importedFoodItems,
    ticketData: prev.ticketData,
    ticketScanMeta: prev.ticketScanMeta,
  };
}

function renderToast() {
  let el = document.getElementById('finance-toast');
  if (!el) { el = document.createElement('div'); el.id = 'finance-toast'; el.className = 'finance-toast hidden'; document.getElementById('view-finance')?.append(el); }
  if (!state.toast) { el.classList.add('hidden'); el.textContent = ''; return; }
  el.textContent = state.toast; el.classList.remove('hidden');
}
function toast(message) { state.toast = message; renderToast(); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => { state.toast = ''; renderToast(); }, 1800); }

async function migrateLegacy(entriesMap = {}, accounts = []) {
  const updatesMap = {}; let writes = 0;
  accounts.forEach((account) => {
    const legacyByDay = normalizeLegacyEntries(entriesMap[account.id] || {});
    Object.entries(legacyByDay).forEach(([day, record]) => {
      const current = account.daily?.[day];
      if (!current || Number(current.ts || 0) < Number(record.ts)) { updatesMap[`${state.financePath}/accounts/${account.id}/entries/${day}`] = { value: record.value, ts: record.ts, source: 'legacy', updatedAt: nowTs(), dateISO: `${day}T00:00:00.000Z` }; writes += 1; }
    });
  });
  if (writes) await safeFirebase(() => update(ref(db), updatesMap));
}

async function ensurePersonalRatioMigrationV1() {
  const migrationPath = `${state.financePath}/meta/migrations/personalRatioV1`;
  const migrationSnap = await safeFirebase(() => get(ref(db, migrationPath)));
  if (migrationSnap?.exists()) return;

  const updatesMap = {};
  const accountsById = Object.fromEntries((state.accounts || []).map((account) => [account.id, account]));
  const txRows = balanceTxList();
  txRows.forEach((tx) => {
    const type = normalizeTxType(tx?.type);
    if (type !== 'income' && type !== 'expense') return;
    if (Number.isFinite(Number(tx?.personalRatio))) return;
    const ratio = personalRatioForTx(tx, accountsById);
    if (!tx?.__path) return;
    updatesMap[`${tx.__path}/personalRatio`] = ratio;
    if (tx.__src === 'transactions' && state.balance.transactions?.[tx.id]) state.balance.transactions[tx.id].personalRatio = ratio;
    if (tx.__src === 'movements' && state.balance.movements?.[tx.monthKey]?.[tx.id]) state.balance.movements[tx.monthKey][tx.id].personalRatio = ratio;
    if (tx.__src === 'tx' && state.balance.tx?.[tx.id]) state.balance.tx[tx.id].personalRatio = ratio;
  });

  Object.entries(state.balance.recurring || {}).forEach(([id, rec]) => {
    const type = normalizeTxType(rec?.type);
    if (type !== 'income' && type !== 'expense') return;
    if (Number.isFinite(Number(rec?.personalRatio))) return;
    const ratio = personalRatioForTx(rec, accountsById);
    updatesMap[`${state.financePath}/recurring/${id}/personalRatio`] = ratio;
    if (state.balance.recurring?.[id]) state.balance.recurring[id].personalRatio = ratio;
  });

  updatesMap[migrationPath] = nowTs();
  if (Object.keys(updatesMap).length) {
    clearFinanceDerivedCaches();
    updatesMap[`${state.financePath}/aggregates`] = null;
    await safeFirebase(() => update(ref(db), updatesMap));
    scheduleAggregateRebuild();
  }
}

function applyRemoteData(val = {}, replace = false) {
  clearFinanceDerivedCaches();
  const root = val && typeof val === 'object' ? val : {};
  const accountsMap = root.accounts || (replace ? {} : Object.fromEntries(state.accounts.map((acc) => [acc.id, acc])));
  const fallbackEntries = replace ? {} : state.legacyEntries;
  state.accounts = Object.values(accountsMap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.legacyEntries = root.accountsEntries || root.entries || fallbackEntries;
  state.balance = {
    tx: root.balance?.tx || root.tx || (replace ? {} : state.balance.tx),
    movements: root.movements || root.balance?.movements || root.balance?.movement || (replace ? {} : state.balance.movements),
    transactions: root.transactions || root.balance?.transactions || root.balance?.tx2 || (replace ? {} : state.balance.transactions),
    categories: root.catalog?.categories || root.balance?.categories || (replace ? {} : state.balance.categories),
    budgets: root.budgets || root.balance?.budgets || (replace ? {} : state.balance.budgets),
    snapshots: root.balance?.snapshots || root.snapshots || (replace ? {} : state.balance.snapshots),
    recurring: root.recurring || root.balance?.recurring || (replace ? {} : state.balance.recurring),
    defaultAccountId: root.balance?.defaultAccountId || (replace ? '' : state.balance.defaultAccountId),
    aggregates: root.aggregates || root.balance?.aggregates || (replace ? {} : state.balance.aggregates),
    lastSeenMonthKey: root.balance?.lastSeenMonthKey || (replace ? '' : state.balance.lastSeenMonthKey)
  };
  state.goals = { goals: root.goals?.goals || (replace ? {} : state.goals.goals) };
  state.productsHub = normalizeProductsHub(root.shoppingHub || (replace ? {} : state.productsHub));
  syncFinanceAchievementsApi();
  financeDebug('sample tx', balanceTxList().slice(0, 5));
}

function hasData(value) {
  if (!value || typeof value !== 'object') return false;
  return Array.isArray(value) ? value.length > 0 : Object.keys(value).length > 0;
}

function mergeFinanceRoots(newRoot = {}, legacyRoot = {}) {
  const rootNew = newRoot && typeof newRoot === 'object' ? newRoot : {};
  const rootLegacy = legacyRoot && typeof legacyRoot === 'object' ? legacyRoot : {};
  const pick = (key, preferNew = true) => {
    if (preferNew && hasData(rootNew[key])) return rootNew[key];
    if (hasData(rootLegacy[key])) return rootLegacy[key];
    return rootNew[key] ?? rootLegacy[key];
  };
  return {
    ...rootLegacy,
    ...rootNew,
    transactions: pick('transactions', true),
    budgets: pick('budgets', true),
    tx: pick('tx', true),
    movements: pick('movements', true),
    recurring: pick('recurring', true),
    accounts: pick('accounts', true),
    snapshots: pick('snapshots', true),
    catalog: pick('catalog', true),
    foodItems: pick('foodItems', true),
    shoppingHub: pick('shoppingHub', true),
    goals: pick('goals', true),
    accountsEntries: pick('accountsEntries', true),
    entries: pick('entries', true)
  };
}

function chooseFinancePath(newPath, legacyPath, newRoot = {}, legacyRoot = {}) {
  const newHasTransactions = hasData(newRoot?.transactions);
  const newHasAccounts = hasData(newRoot?.accounts);
  const legacyHasTransactions = hasData(legacyRoot?.transactions);
  const legacyHasAccounts = hasData(legacyRoot?.accounts);
  if (newHasTransactions) return newPath;
  if (newHasAccounts) return newPath;
  if (legacyHasTransactions || legacyHasAccounts) return legacyPath;
  return newPath;
}

async function readFinancePresence(path, { viewId = 'view-finance', reason = 'probe-finance-presence' } = {}) {
  if (!path) {
    return { hasTransactions: false, hasAccounts: false };
  }
  const transactionsPath = `${path}/transactions`;
  const accountsPath = `${path}/accounts`;
  logFirebaseRead({ path: transactionsPath, mode: 'get', reason: `${reason}:transactions`, viewId });
  logFirebaseRead({ path: accountsPath, mode: 'get', reason: `${reason}:accounts`, viewId });
  const [transactionsSnap, accountsSnap] = await Promise.all([
    safeFirebase(() => get(ref(db, transactionsPath))),
    safeFirebase(() => get(ref(db, accountsPath))),
  ]);
  return {
    hasTransactions: Boolean(transactionsSnap?.exists?.()),
    hasAccounts: Boolean(accountsSnap?.exists?.()),
  };
}

async function loadFinanceRootByBranches(rootPath, { reason = 'finance-core-root', viewId = 'view-finance' } = {}) {
  if (!rootPath) return {};
  const root = {};
  await Promise.all(FINANCE_CORE_BRANCHES.map(async (branch) => {
    const branchPath = `${rootPath}/${branch.path}`;
    logFirebaseRead({ path: branchPath, mode: 'get', reason: `${reason}:${branch.key}`, viewId });
    const snap = await safeFirebase(() => get(ref(db, branchPath)));
    applyFinanceBranchValue(root, branch, snap?.val());
  }));
  return root;
}

async function probeFinanceRoots() {
  const [newPath, legacyPath] = resolveFinancePathCandidates();
  const [newPresence, legacyPresence] = await Promise.all([
    readFinancePresence(newPath, { reason: 'probe-finance-root', viewId: 'view-finance' }),
    readFinancePresence(legacyPath, { reason: 'probe-finance-legacy-root', viewId: 'view-finance' }),
  ]);
  const newRootStub = {
    transactions: newPresence.hasTransactions ? { __present: true } : {},
    accounts: newPresence.hasAccounts ? { __present: true } : {},
  };
  const legacyRootStub = {
    transactions: legacyPresence.hasTransactions ? { __present: true } : {},
    accounts: legacyPresence.hasAccounts ? { __present: true } : {},
  };
  const preferredPath = chooseFinancePath(newPath, legacyPath, newRootStub, legacyRootStub);
  const shouldLoadNewRoot = preferredPath === newPath || (!newPresence.hasAccounts && legacyPresence.hasAccounts);
  const shouldLoadLegacyRoot = preferredPath === legacyPath || (!newPresence.hasAccounts && legacyPresence.hasAccounts);
  const [newRoot, legacyRoot] = await Promise.all([
    shouldLoadNewRoot
      ? loadFinanceRootByBranches(newPath, { reason: 'load-finance-new-root', viewId: 'view-finance' })
      : Promise.resolve({}),
    shouldLoadLegacyRoot
      ? loadFinanceRootByBranches(legacyPath, { reason: 'load-finance-legacy-root', viewId: 'view-finance' })
      : Promise.resolve({}),
  ]);
  const chosenPath = chooseFinancePath(newPath, legacyPath, newRoot, legacyRoot);
  return { newPath, legacyPath, newRoot, legacyRoot, chosenPath };
}

async function detectFinancePath(basePath) {
  const candidates = [];
  const add = (path) => {
    if (path && !candidates.includes(path)) candidates.push(path);
  };

  add(basePath);
  if (/\/finance\/?$/.test(basePath) && !/\/finance\/finance\/?$/.test(basePath)) {
    add(basePath.replace(/\/finance\/?$/, '/finance/finance'));
  }
  if (/\/finance\/finance\/?$/.test(basePath)) {
    add(basePath.replace(/\/finance\/finance\/?$/, '/finance'));
  }
  if (!/\/finance\/finance\/?$/.test(basePath)) {
    add(basePath.replace(/\/$/, '') + '/finance');
  }

  for (const root of candidates) {
    try {
      logFirebaseRead({ path: `${root}/transactions`, mode: 'get', reason: 'detect-finance-path:transactions', viewId: 'view-finance' });
      const snap = await get(ref(db, `${root}/transactions`));
      if (snap?.exists()) return root;
    } catch (error) {
      console.warn('[FINANCE] detectFinancePath probe failed', root, error?.message || error);
    }
  }

  for (const root of candidates) {
    try {
      logFirebaseRead({ path: `${root}/accounts`, mode: 'get', reason: 'detect-finance-path:accounts', viewId: 'view-finance' });
      const snap = await get(ref(db, `${root}/accounts`));
      if (snap?.exists()) return root;
    } catch {
      // noop
    }
  }

  return basePath;
}

async function loadDataOnce() {
  const { newRoot, legacyRoot } = financeRootsCache;
  const mergedRoot = mergeFinanceRoots(newRoot, legacyRoot);
  applyRemoteData(mergedRoot, true);
  const txCount = Object.keys((state.balance.transactions || {})).length;
  financeDebug('after applyRemoteData txCount', txCount);
  financeNeedsLegacyAccountsMerge = !hasData(newRoot?.accounts) && hasData(legacyRoot?.accounts);
  financeDebug('root counts', {
    accounts: Object.keys((mergedRoot.accounts || {})).length,
    transactions: Object.keys((mergedRoot.transactions || {})).length
  });
  state.hydratedFromRemote = true;
  log('loaded accounts:', state.accounts.length);
}

function applyMergedFinanceRemote(reason = 'finance-live-sync') {
  financeRemoteApplyTimer = 0;
  const mergedRoot = mergeFinanceRoots(financeRootsCache.newRoot, financeRootsCache.legacyRoot);
  applyRemoteData(mergedRoot, true);
  state.hydratedFromRemote = true;
  if (state.activeView === 'products' && patchProductsWorkbench()) {
    renderToast();
    emitFinanceData(reason);
    return;
  }
  triggerRender();
  emitFinanceData(reason);
}

function queueMergedFinanceRemoteApply(reason = 'finance-live-sync') {
  if (financeRemoteApplyTimer) return;
  financeRemoteApplyTimer = window.setTimeout(() => applyMergedFinanceRemote(reason), 0);
}

function subscribeFinanceRootBranches(rootPath, targetKey, labelSuffix = 'primary') {
  const unsubs = [];
  FINANCE_CORE_BRANCHES.forEach((branch) => {
    const branchPath = `${rootPath}/${branch.path}`;
    financeDebug('subscribe firebase branch', branchPath);
    logFirebaseRead({ path: branchPath, mode: 'onValue', reason: `finance-live-sync:${labelSuffix}:${branch.key}`, viewId: 'view-finance' });
    const stop = registerViewListener('view-finance', onValue(ref(db, branchPath), (snap) => {
      applyFinanceBranchValue(financeRootsCache[targetKey], branch, snap.val());
      queueMergedFinanceRemoteApply(`remote:finance:${labelSuffix}:${branch.key}`);
    }, (error) => {
      state.error = String(error?.message || error);
      triggerRender();
    }), {
      key: `${targetKey}:${branch.key}`,
      path: branchPath,
      mode: 'onValue',
      reason: `finance-live-sync:${labelSuffix}:${branch.key}`,
    });
    if (typeof stop === 'function') unsubs.push(stop);
  });
  return () => {
    unsubs.splice(0).forEach((stop) => {
      try { stop(); } catch (_) {}
    });
  };
}

function subscribe() {
  if (state.unsubscribe) state.unsubscribe();
  if (unsubscribeLegacyFinance) {
    unsubscribeLegacyFinance();
    unsubscribeLegacyFinance = null;
  }
  if (financeRemoteApplyTimer) {
    clearTimeout(financeRemoteApplyTimer);
    financeRemoteApplyTimer = 0;
  }

  const primaryTarget = state.financePath === resolveFinancePath() ? 'newRoot' : 'legacyRoot';
  state.unsubscribe = subscribeFinanceRootBranches(state.financePath, primaryTarget, 'primary');

  if (financeNeedsLegacyAccountsMerge) {
    const legacyPath = resolveFinancePathCandidates()[1];
    financeDebug('subscribe firebase legacy merge', legacyPath);
    unsubscribeLegacyFinance = subscribeFinanceRootBranches(legacyPath, 'legacyRoot', 'legacy');
  }
}

async function addAccount({ name, shared = false, sharedRatio = 0.5, isBitcoin = false, btcUnits = 0, cardLast4 = '', initialValue = 0 }) {
  const id = push(ref(db, `${state.financePath}/accounts`)).key;
  const ratio = shared ? clampRatio(sharedRatio, 0.5) : 1;
  await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${id}`), { id, name, shared, sharedRatio: ratio, isBitcoin: Boolean(isBitcoin), btcUnits: Number(btcUnits || 0), cardLast4: normalizeCardLast4(cardLast4), createdAt: nowTs(), updatedAt: nowTs(), entries: {}, snapshots: {} }));
  const parsedInitial = parseEuroNumber(initialValue);
  if (Number.isFinite(parsedInitial)) {
    const day = dayKeyFromTs(Date.now());
    await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${id}/snapshots/${day}`), { value: parsedInitial, updatedAt: nowTs() }));
    await recomputeAccountEntries(id, day);
  }
}

function syncNewAccountFormUI(formEl) {
  if (!formEl) return;
  const isShared = !!formEl.querySelector('input[name="shared"]')?.checked;
  const isBitcoin = !!formEl.querySelector('input[name="isBitcoin"]')?.checked;
  const sharedBlock = formEl.querySelector('[data-account-shared-fields]');
  const bitcoinBlock = formEl.querySelector('[data-account-btc-fields]');
  if (sharedBlock) sharedBlock.hidden = !isShared;
  if (bitcoinBlock) bitcoinBlock.hidden = !isBitcoin;

  const ratioInput = formEl.querySelector('[name="sharedRatio"]');
  if (ratioInput && !isShared) ratioInput.value = '50';

  const btcUnits = Number(formEl.querySelector('input[name="btcUnits"]')?.value || 0);
  const btcHint = formEl.querySelector('[data-account-btc-hint]');
  if (btcHint) {
    btcHint.textContent = `BTC/EUR: ${state.btcEurPrice ? fmtCurrency(state.btcEurPrice) : '—'} · Valor estimado: ${fmtCurrency(Number.isFinite(btcUnits) ? btcUnits * Number(state.btcEurPrice || 0) : 0)}`;
  }
}
async function updateAccountMeta(accountId, payload = {}) {
  const shared = Boolean(payload.shared);
  const sharedRatio = shared ? clampRatio(payload.sharedRatio, 0.5) : 1;
  await safeFirebase(() => update(ref(db, `${state.financePath}/accounts/${accountId}`), { ...payload, shared, sharedRatio, isBitcoin: Boolean(payload.isBitcoin), btcUnits: Number(payload.btcUnits || 0), cardLast4: normalizeCardLast4(payload.cardLast4), updatedAt: nowTs() }));
}
async function saveSnapshot(accountId, day, value) {
  const parsedValue = parseEuroNumber(value);
  if (!Number.isFinite(parsedValue) || !day) return false;
  await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${accountId}/snapshots/${day}`), { value: parsedValue, updatedAt: nowTs() }));
  await recomputeAccountEntries(accountId, day);
  toast('Guardado');
  return true;
}

async function deleteDay(accountId, day) {
  await safeFirebase(() => remove(ref(db, `${state.financePath}/accounts/${accountId}/snapshots/${day}`)));
  await safeFirebase(() => remove(ref(db, `${state.financePath}/accounts/${accountId}/entries/${day}`)));
  await recomputeAccountEntries(accountId, day);
}
async function deleteAccount(accountId) { await safeFirebase(() => remove(ref(db, `${state.financePath}/accounts/${accountId}`))); }

function mergeAccountEntryMaps(destinationAccount = {}, sourceAccounts = [], legacyEntries = {}) {
  const merged = {};
  const assign = (day, record = {}, priority = 0) => {
    if (!day) return;
    const value = Number(record?.value);
    const ts = Number(record?.ts || parseDayKey(day));
    if (!Number.isFinite(value) || !Number.isFinite(ts)) return;
    const current = merged[day];
    if (!current || ts > current.ts || (ts === current.ts && priority > current.priority)) {
      merged[day] = { value, ts, source: 'merged', priority };
    }
  };

  [destinationAccount, ...(sourceAccounts || [])].forEach((account, index) => {
    normalizeDaily(getAccountEntryMap(account)).forEach((row) => assign(row.day, row, index === 0 ? 2 : 1));
    Object.entries(normalizeLegacyEntries(legacyEntries?.[account?.id] || {})).forEach(([day, row]) => assign(day, row, 1));
  });

  return Object.fromEntries(
    Object.entries(merged)
      .sort((left, right) => parseDayKey(left[0]) - parseDayKey(right[0]))
      .map(([day, row]) => [day, firebaseClean({ value: row.value, ts: row.ts, source: 'merged', updatedAt: nowTs(), dateISO: `${day}T00:00:00.000Z` })])
  );
}

function mergeAccountSnapshotsMap(destinationAccount = {}, sourceAccounts = []) {
  const merged = {};
  const assign = (day, record = {}, priority = 0) => {
    if (!day) return;
    const value = Number(record?.value);
    const updatedAt = Number(record?.updatedAt || record?.ts || parseDayKey(day));
    if (!Number.isFinite(value) || !Number.isFinite(updatedAt)) return;
    const current = merged[day];
    if (!current || updatedAt > current.updatedAt || (updatedAt === current.updatedAt && priority > current.priority)) {
      merged[day] = { value, updatedAt, priority };
    }
  };

  [destinationAccount, ...(sourceAccounts || [])].forEach((account, index) => {
    normalizeSnapshots(account?.snapshots || {}).forEach((row) => assign(row.day, row, index === 0 ? 2 : 1));
  });

  return Object.fromEntries(
    Object.entries(merged)
      .sort((left, right) => parseDayKey(left[0]) - parseDayKey(right[0]))
      .map(([day, row]) => [day, firebaseClean({ value: row.value, updatedAt: row.updatedAt })])
  );
}

function rewriteAccountRefsInRow(row = {}, destinationId = '', sourceIds = new Set(), now = nowTs()) {
  const extras = row?.extras && typeof row.extras === 'object' ? { ...row.extras } : {};
  let changed = false;
  const next = { ...row };
  const directFields = ['accountId', 'fromAccountId', 'toAccountId'];

  directFields.forEach((field) => {
    const current = String(next?.[field] || extras?.[field] || '').trim();
    if (!current || !sourceIds.has(current)) return;
    next[field] = destinationId;
    extras[field] = destinationId;
    changed = true;
  });

  if (!changed) return { changed: false, row };
  if (Object.keys(extras).length) next.extras = extras;
  next.updatedAt = now;
  return { changed: true, row: next };
}

function rewriteAccountIdList(values = [], destinationId = '', sourceIds = new Set()) {
  const next = [...new Set((values || []).map((value) => {
    const id = String(value || '').trim();
    if (!id) return '';
    return sourceIds.has(id) ? destinationId : id;
  }).filter(Boolean))];
  return next;
}

async function mergeAccounts(selection = [], destinationId = '') {
  await ensureFinanceLoaded();
  const ids = [...new Set((selection || []).map((id) => String(id || '').trim()).filter(Boolean))];
  const canonicalId = String(destinationId || '').trim();
  if (ids.length < 2 || !canonicalId || !ids.includes(canonicalId)) return null;

  const accountsById = Object.fromEntries((state.accounts || []).map((account) => [String(account?.id || '').trim(), account]));
  const destinationAccount = accountsById[canonicalId];
  if (!destinationAccount) return null;
  const sourceIds = new Set(ids.filter((id) => id !== canonicalId));
  if (!sourceIds.size) return null;
  const sourceAccounts = [...sourceIds].map((id) => accountsById[id]).filter(Boolean);
  if (sourceAccounts.length !== sourceIds.size) return null;

  const now = nowTs();
  const mergedEntries = mergeAccountEntryMaps(destinationAccount, sourceAccounts, state.legacyEntries || {});
  const mergedSnapshots = mergeAccountSnapshotsMap(destinationAccount, sourceAccounts);
  const mergedCardLast4Candidates = [...new Set([normalizeCardLast4(destinationAccount?.cardLast4 || ''), ...sourceAccounts.map((account) => normalizeCardLast4(account?.cardLast4 || ''))].filter(Boolean))];
  const mergedCardLast4 = normalizeCardLast4(destinationAccount?.cardLast4 || '') || (mergedCardLast4Candidates.length === 1 ? mergedCardLast4Candidates[0] : '');
  const canonicalPayload = {
    ...destinationAccount,
    cardLast4: mergedCardLast4,
    entries: mergedEntries,
    snapshots: mergedSnapshots,
    createdAt: Math.min(...[destinationAccount, ...sourceAccounts].map((account) => Number(account?.createdAt || now)).filter((value) => Number.isFinite(value) && value > 0)),
    updatedAt: now,
  };

  const updatesMap = {
    [`${state.financePath}/accounts/${canonicalId}`]: canonicalPayload,
  };

  Object.entries(state.balance.transactions || {}).forEach(([txId, row]) => {
    const rewritten = rewriteAccountRefsInRow(row, canonicalId, sourceIds, now);
    if (!rewritten.changed) return;
    updatesMap[`${state.financePath}/transactions/${txId}`] = rewritten.row;
  });
  Object.entries(state.balance.movements || {}).forEach(([monthKey, rows]) => {
    Object.entries(rows || {}).forEach(([txId, row]) => {
      const rewritten = rewriteAccountRefsInRow(row, canonicalId, sourceIds, now);
      if (!rewritten.changed) return;
      updatesMap[`${state.financePath}/movements/${monthKey}/${txId}`] = rewritten.row;
    });
  });
  Object.entries(state.balance.tx || {}).forEach(([txId, row]) => {
    const rewritten = rewriteAccountRefsInRow(row, canonicalId, sourceIds, now);
    if (!rewritten.changed) return;
    updatesMap[`${state.financePath}/tx/${txId}`] = rewritten.row;
  });
  Object.entries(state.balance.recurring || {}).forEach(([txId, row]) => {
    const rewritten = rewriteAccountRefsInRow(row, canonicalId, sourceIds, now);
    if (!rewritten.changed) return;
    updatesMap[`${state.financePath}/recurring/${txId}`] = rewritten.row;
  });
  Object.entries(state.goals?.goals || {}).forEach(([goalId, goal]) => {
    const currentIds = Array.isArray(goal?.accountsIncluded) ? goal.accountsIncluded : [];
    const nextIds = rewriteAccountIdList(currentIds, canonicalId, sourceIds);
    if (JSON.stringify(nextIds) === JSON.stringify(currentIds)) return;
    updatesMap[`${state.financePath}/goals/goals/${goalId}/accountsIncluded`] = nextIds;
    updatesMap[`${state.financePath}/goals/goals/${goalId}/updatedAt`] = now;
  });

  if (sourceIds.has(String(state.balance?.defaultAccountId || '').trim())) {
    updatesMap[`${state.financePath}/balance/defaultAccountId`] = canonicalId;
  }

  [...sourceIds].forEach((accountId) => {
    updatesMap[`${state.financePath}/accounts/${accountId}`] = null;
    updatesMap[`${state.financePath}/accountsEntries/${accountId}`] = null;
    updatesMap[`${state.financePath}/entries/${accountId}`] = null;
  });

  try {
    await update(ref(db), updatesMap);
  } catch (error) {
    log('firebase error', error);
    toast('No se pudo fusionar en Firebase');
    return null;
  }

  state.accounts = state.accounts
    .filter((account) => !sourceIds.has(String(account?.id || '').trim()))
    .map((account) => (String(account?.id || '').trim() === canonicalId ? canonicalPayload : account));

  const patchLocalRow = (row = {}) => rewriteAccountRefsInRow(row, canonicalId, sourceIds, now).row;
  state.balance.transactions = Object.fromEntries(Object.entries(state.balance.transactions || {}).map(([txId, row]) => [txId, patchLocalRow(row)]));
  state.balance.movements = Object.fromEntries(Object.entries(state.balance.movements || {}).map(([monthKey, rows]) => [monthKey, Object.fromEntries(Object.entries(rows || {}).map(([txId, row]) => [txId, patchLocalRow(row)]))]));
  state.balance.tx = Object.fromEntries(Object.entries(state.balance.tx || {}).map(([txId, row]) => [txId, patchLocalRow(row)]));
  state.balance.recurring = Object.fromEntries(Object.entries(state.balance.recurring || {}).map(([txId, row]) => [txId, patchLocalRow(row)]));
  if (!state.goals) state.goals = { goals: {} };
  state.goals.goals = Object.fromEntries(Object.entries(state.goals?.goals || {}).map(([goalId, goal]) => [goalId, {
    ...goal,
    accountsIncluded: rewriteAccountIdList(goal?.accountsIncluded || [], canonicalId, sourceIds),
  }]));
  state.legacyEntries = Object.fromEntries(Object.entries(state.legacyEntries || {}).filter(([accountId]) => !sourceIds.has(String(accountId || '').trim())));
  if (sourceIds.has(String(state.balance?.defaultAccountId || '').trim())) state.balance.defaultAccountId = canonicalId;
  if (sourceIds.has(String(state.balanceAccountFilter || '').trim())) state.balanceAccountFilter = canonicalId;
  if (sourceIds.has(String(state.calendarAccountId || '').trim())) state.calendarAccountId = canonicalId;
  if (sourceIds.has(String(state.lastMovementAccountId || '').trim())) {
    state.lastMovementAccountId = canonicalId;
    try { localStorage.setItem('bookshell_finance_lastMovementAccountId', canonicalId); } catch (_) {}
  }
  if (sourceIds.has(String(state.balanceFormState?.accountId || '').trim())) state.balanceFormState = { ...state.balanceFormState, accountId: canonicalId };
  if (sourceIds.has(String(state.balanceFormState?.fromAccountId || '').trim())) state.balanceFormState = { ...state.balanceFormState, fromAccountId: canonicalId };
  if (sourceIds.has(String(state.balanceFormState?.toAccountId || '').trim())) state.balanceFormState = { ...state.balanceFormState, toAccountId: canonicalId };

  clearFinanceDerivedCaches();
  scheduleAggregateRebuild();

  return {
    destinationId: canonicalId,
    destinationName: String(destinationAccount?.name || canonicalId),
    sourceIds: [...sourceIds],
    sourceNames: sourceAccounts.map((account) => String(account?.name || account?.id || '')).filter(Boolean),
    mergedAt: now,
  };
}


function captureFinanceUiState() {
  const isProductsView = state.activeView === 'products' || state.modal?.type === 'food-products';
  if (!isProductsView) return null;
  const sc = document.querySelector('[data-finance-products-scroll]');
  const openDetails = [...document.querySelectorAll('.financeTab details[id], #finance-modal details[id]')]
    .map((el) => ({ id: el.id, open: !!el.open }));
  return { y: sc?.scrollTop ?? 0, openDetails };
}

function restoreFinanceUiState(snapshot) {
  if (!snapshot) return;
  snapshot.openDetails.forEach((row) => {
    const el = document.getElementById(row.id);
    if (el) el.open = !!row.open;
  });
  requestAnimationFrame(() => {
    const sc = document.querySelector('[data-finance-products-scroll]');
    if (sc) sc.scrollTop = snapshot.y || 0;
  });
}

function triggerRender(options = {}) {
  if (!options.force && (receiptEditSession.active || isActiveTicketInput(document.activeElement))) {
    return Promise.resolve(null);
  }
  financePendingPreserveUi = financePendingPreserveUi && options.preserveUi !== false;
  if (financeRenderPromise) {
    financeRenderQueued = true;
    return financeRenderPromise;
  }

  financeRenderPromise = (async () => {
    do {
      financeRenderQueued = false;
      const preserveUi = financePendingPreserveUi;
      financePendingPreserveUi = true;
      const txDetails = document.getElementById('finance-balance-tx-details');
      if (txDetails && txDetails.tagName === 'DETAILS') {
        state.balanceTxDetailsOpen = !!txDetails.open;
      }
      const uiSnapshot = preserveUi ? captureFinanceUiState() : null;
      try {
        await render();
        if (preserveUi) restoreFinanceUiState(uiSnapshot);
      } catch (e) {
        console.error('[finance] render top-level', e);
        showFinanceBootError($opt, e);
      }
    } while (financeRenderQueued);
  })().finally(() => {
    financeRenderPromise = null;
    financePendingPreserveUi = true;
  });

  return financeRenderPromise;
}

function ensureFinanceAddTxFab() {
  const view = document.getElementById('view-finance');
  if (!view) return null;
  let fab = document.getElementById('anadir-gastos');
  if (!fab) {
    fab = document.createElement('button');
    fab.id = 'anadir-gastos';
    view.appendChild(fab);
  }
  fab.type = 'button';
  fab.className = 'finance-fab';
  fab.dataset.openModal = 'tx';
  fab.textContent = '💲';
  fab.title = 'Añadir gasto';
  fab.setAttribute('aria-label', 'Añadir gasto');
  return fab;
}

async function render() {
  try {
    const host = ensureFinanceHost($opt, $req);
    renderFinanceNav();
    if (state.error) { host.innerHTML = `<article class=\"finance-panel\"><h3>Error cargando finanzas</h3><p>${state.error}</p></article>`; return; }
    await renderFinanceStatsDonutChart();
    await ensureBtcEurPrice();
    await ensureRecurringCurrentMonthInstances();
    const accounts = buildAccountModels();
    const totalSeries = buildTotalSeries(accounts);
    const txRows = balanceTxList();
    const categories = (state.activeView === 'balance' || state.modal?.type) ? categoriesList(txRows) : [];
    await maybeAutoBitcoinDailySnapshots(state.accounts);
    publishFinanceTotals(accounts);
    if (state.activeView === 'balance') {
      await ensureFoodCatalogLoaded();
      host.innerHTML = renderFinanceBalance(accounts, categories, txRows);
      await renderFinanceStatsDonutChart();
      await maybeRolloverSnapshot();
      if (!Object.keys(state.balance.aggregates || {}).length) scheduleAggregateRebuild();
    } else if (state.activeView === 'products') {
      disposeFinanceStatsDonutChart();
      await ensureFoodCatalogLoaded();
      await ensureFoodMetaCatalogLoaded();
      host.innerHTML = renderFinanceProducts();
    } else {
      disposeFinanceStatsDonutChart();
      if (state.activeView === 'goals') host.innerHTML = renderFinanceGoals(accounts);
      else if (state.activeView === 'calendar') host.innerHTML = renderFinanceCalendar(accounts, totalSeries);
      else host.innerHTML = renderFinanceHome(accounts, totalSeries);
    }
    await renderFixedExpenseCharts();
    renderModal({ accounts, categories, txRows });
    renderToast();
    ensureFinanceAddTxFab();
  } catch (err) {
    console.error('[finance] render crashed', err);
    showFinanceBootError($opt, err);
  }
}

function bindEvents() {
  
  const view = document.getElementById('view-finance'); if (!view || view.dataset.financeBound === '1') return; view.dataset.financeBound = '1';
  state.eventsAbortController = new AbortController();
  const evtOpts = { signal: state.eventsAbortController.signal };
  const chartEvtOpts = { signal: state.eventsAbortController.signal, passive: false };
  const unlockFinanceScroll = () => {
    if (!view.dataset.__scrollLocked) return;
    view.dataset.__scrollLocked = '';
    if (view.dataset.__prevOverflowY != null) view.style.overflowY = view.dataset.__prevOverflowY;
    else view.style.overflowY = '';
  };
  const lockFinanceScroll = () => {
    if (view.dataset.__scrollLocked === '1') return;
    view.dataset.__scrollLocked = '1';
    view.dataset.__prevOverflowY = view.style.overflowY || '';
    view.style.overflowY = 'hidden';
  };
  let chartPointerId = null;
  let chartPointerActive = false;
  let chartPointerEl = null;

  view.addEventListener('pointerdown', (event) => {
    const target = event.target;
    const chartEl = target?.closest?.('#finance-lineChart');
    if (!chartEl) return;

    const points = state.lineChart?.points || [];
    if (!points.length) return;

    chartPointerActive = true;
    chartPointerId = event.pointerId;
    chartPointerEl = chartEl;
    lockFinanceScroll();

    try { chartEl.style.touchAction = 'none'; } catch (_) {}
    try { chartEl.setPointerCapture?.(event.pointerId); } catch (_) {}

    event.preventDefault();
    event.stopPropagation();

    const hit = closestLineChartPoint(points, chartEl, event.clientX);
    if (hit) showLineChartPoint(chartEl, hit.point, hit.idx, points);
  }, chartEvtOpts);

  view.addEventListener('pointermove', (event) => {
    const trendChart = event.target.closest('#fin-trendChart');
    if (trendChart) {
      const svg = trendChart.querySelector('svg');
      if (!svg) return;
      
      const rect = svg.getBoundingClientRect();
      const relX = event.clientX - rect.left;
      const pctX = Math.max(0, Math.min(1, relX / rect.width));
      
      try {
        const geometry = JSON.parse(trendChart.dataset.finChartGeometry);
        const idx = Math.round(pctX * (geometry.monthKeys.length - 1));
        if (idx < 0 || idx >= geometry.monthKeys.length) return;
        
        const monthKey = geometry.monthKeys[idx];
        const mm = monthKey.slice(5, 7);
        const yy = monthKey.slice(2, 4);
        const tooltip = trendChart.querySelector('[data-fin-trend-tooltip]');
        const marker = trendChart.querySelector('.fin-trend-activeMarker');
        
        if (tooltip && marker) {
          const pctForCoord = idx / Math.max(geometry.monthKeys.length - 1, 1);
          const xCoord = geometry.pad + pctForCoord * geometry.chartW;
          
          let tooltipText = `${mm}/${yy}`;
          let color = 'rgba(255,255,255,0.6)';
          
          if (geometry.seriesData.length === 1) {
            const serie = geometry.seriesData[0];
            const val = serie.values[monthKey] || 0;
            tooltipText = `${serie.emoji || ''} ${mm}/${yy}: ${fmtCurrency(val)}`;
            color = serie.color;
          } else if (geometry.seriesData.length > 1) {
            tooltipText = `${mm}/${yy}`;
          }
          
          tooltip.textContent = tooltipText;
          tooltip.style.color = color;
          tooltip.style.opacity = '1';
          
          marker.setAttribute('cx', xCoord.toFixed(1));
          marker.setAttribute('cy', (geometry.pad + geometry.chartH / 2).toFixed(1));
          marker.setAttribute('r', '6');
        }
      } catch (e) {
        // Silenciar errores de parsing
      }
      return;
    }
    
    if (!chartPointerActive) return;
    if (chartPointerId != null && event.pointerId !== chartPointerId) return;
    if (!chartPointerEl) return;

    const points = state.lineChart?.points || [];
    if (!points.length) return;

    event.preventDefault();
    const hit = closestLineChartPoint(points, chartPointerEl, event.clientX);
    if (hit) showLineChartPoint(chartPointerEl, hit.point, hit.idx, points);
  }, chartEvtOpts);

  const endPointer = (event) => {
    if (!chartPointerActive) return;
    if (chartPointerId != null && event.pointerId !== chartPointerId) return;
    chartPointerActive = false;
    chartPointerId = null;
    chartPointerEl = null;
    unlockFinanceScroll();
  };

  view.addEventListener('pointerup', (event) => { endPointer(event); }, chartEvtOpts);
  view.addEventListener('pointercancel', (event) => { endPointer(event); }, chartEvtOpts);

  view.addEventListener('pointerleave', (event) => {
    const trendChart = event.target.closest('#fin-trendChart');
    if (trendChart) {
      const tooltip = trendChart.querySelector('[data-fin-trend-tooltip]');
      const marker = trendChart.querySelector('.fin-trend-activeMarker');
      if (tooltip) tooltip.style.opacity = '0';
      if (marker) {
        marker.setAttribute('cx', '0');
        marker.setAttribute('cy', '0');
        marker.setAttribute('r', '0');
      }
    }
  }, chartEvtOpts);

  view.addEventListener('click', async (event) => {
    const target = event.target;

    const lineChart = target?.closest?.('#finance-lineChart');
    if (lineChart) {
      const points = state.lineChart?.points || [];
      if (!points.length) { toast('Sin datos para este gráfico'); return; }
      const hit = closestLineChartPoint(points, lineChart, event.clientX);
      if (!hit) { toast('Sin datos para este punto'); return; }
      showLineChartPoint(lineChart, hit.point, hit.idx, points);
      return;
    }

    const formButton = target.closest('button:not([type]), button[type="submit"]');
 if (formButton) {
   const form = formButton.closest('form');
  // Si el botón está dentro de un form, NO bloquees: deja que dispare submit
  if (!form) {
    event.preventDefault();
    event.stopPropagation();
  }
}
    const fakeLink = target.closest('a[href]');
    const ticketImportRawEl = document.querySelector('[data-ticket-import-raw]');

if (ticketImportRawEl && state.modal?.type === 'tx') {
      state.modal = {
        ...state.modal,
        ticketImport: {
          ...(state.modal.ticketImport || {}),
          raw: String(ticketImportRawEl.value || '')
        }
      };
    }
    if (target.closest('[data-ticket-import-paste]')) {
      try {
        const text = await navigator.clipboard.readText();
        state.modal = { ...state.modal, ticketImport: { ...(state.modal.ticketImport || {}), open: true, raw: text, error: '', diagnostic: null } };
      } catch {
        state.modal = { ...state.modal, ticketImport: { ...(state.modal.ticketImport || {}), open: true, error: 'No se pudo leer el portapapeles' } };
      }
      triggerRender();
      return;
    }
    if (target.closest('[data-ticket-import-sample]')) {
      state.modal = { ...state.modal, ticketImport: { ...(state.modal.ticketImport || {}), open: true, raw: TICKET_IMPORT_SAMPLE_V1, error: '', diagnostic: null } };
      triggerRender();
      return;
    }
    if (target.closest('[data-ticket-import-cancel]')) {
      state.modal = { ...state.modal, ticketImport: { raw: '', parsed: null, error: '', warnings: [], open: false, diagnostic: null } };
      triggerRender();
      return;
    }
    if (target.closest('[data-ticket-import-copy-diagnostic]')) {
      try {
        const diagnostic = state.modal.ticketImport?.diagnostic || state.modal.ticketImport?.parsed?.diagnostic || { message: 'Sin diagnóstico aún' };
        await navigator.clipboard.writeText(JSON.stringify(diagnostic, null, 2));
        toast('Diagnóstico copiado');
      } catch {
        toast('No se pudo copiar el diagnóstico');
      }
      return;
    }
    if (target.closest('[data-ticket-import-preview]')) {
      const raw = String(ticketImportRawEl?.value || state.modal.ticketImport?.raw || '');
      const parsed = parseTicketImport(raw);
      state.modal = {
        ...state.modal,
        ticketImport: {
          ...(state.modal.ticketImport || {}),
          open: true,
          raw,
          parsed,
          diagnostic: parsed.diagnostic || null,
          error: parsed.ok ? '' : parsed.error,
          warnings: []
        }
      };
      triggerRender();
      return;
    }
    if (target.closest('[data-ticket-import-apply]')) {
      try {
        const parsed = state.modal.ticketImport?.parsed;
        if (!parsed?.ok) {
          state.modal = {
            ...state.modal,
            ticketImport: {
              ...(state.modal.ticketImport || {}),
              error: parsed?.stage === 'validate'
                ? 'No se pudo aplicar por validación. Revisa Diagnóstico.'
                : 'No se pudo aplicar por parse. Revisa Diagnóstico.',
              diagnostic: parsed?.diagnostic || { stage: 'apply', error: 'Primero genera un preview válido' }
            }
          };
          triggerRender();
          return;
        }
        await ensureFoodCatalogLoaded();
        const currentDraft = {
          amount: Number(state.balanceFormState.amount || 0),
          note: state.balanceFormState.note || '',
          dateISO: state.balanceFormState.dateISO || dayKeyFromTs(Date.now()),
          accountId: state.balanceFormState.accountId || ''
        };
        const products = Object.values(state.food.itemsById || {});
        const importResult = applyTicketImport(parsed.data, currentDraft, products, state.accounts || []);
        const updatesMap = {};
        const purchaseTs = parseDayKey(parsed.data?.purchase?.date || dayKeyFromTs(Date.now()));
        importResult.createdProducts.forEach((product) => {
          const productKey = firebaseSafeKey(product.name);
          const id = window.crypto?.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
          const vendorKey = firebaseSafeKey(parsed.data?.source?.vendor || product.place || 'unknown') || 'unknown';
          const payload = {
            id,
            idKey: productKey,
            name: product.name,
            displayName: String(product.displayName || product.name || '').trim() || product.name,
            aliases: Array.isArray(product.aliases) ? product.aliases : [],
            vendorAliases: product.vendorAliases && typeof product.vendorAliases === 'object' ? product.vendorAliases : {},
            createdFromVendor: String(parsed.data?.source?.vendor || ''),
            key: productKey,
            mealType: '',
            cuisine: String(product.cuisine || product.healthy || ''),
            healthy: String(product.healthy || product.cuisine || ''),
            place: String(product.place || parsed.data?.source?.vendor || 'unknown'),
            defaultPrice: Number(product.defaultPrice || 0),
            priceHistory: {
              [vendorKey]: {}
            },
            countUsed: 0,
            createdAt: nowTs(),
            updatedAt: nowTs()
          };
          updatesMap[`${state.financePath}/foodItems/${id}`] = payload;
          updatesMap[`${state.financePath}/catalog/foodItems/${productKey}`] = {
            name: product.name,
            key: productKey,
            createdAt: nowTs(),
            count: 0,
            lastUsedAt: nowTs(),
            lastPrice: Number(product.defaultPrice || 0),
            lastCategory: 'Comida',
            lastAccountId: '',
            lastNote: 'Import ticket',
            lastExtras: { mealType: '', cuisine: String(product.cuisine || product.healthy || ''), place: String(product.place || 'unknown'), healthy: String(product.healthy || product.cuisine || '') }
          };
        });
        importResult.updatedProducts.forEach((product) => {
          if (Number.isFinite(Number(product.defaultPrice))) {
            updatesMap[`${state.financePath}/foodItems/${product.id}/defaultPrice`] = Number(product.defaultPrice || 0);
          }
          if (String(product.cuisine || '').trim()) {
            updatesMap[`${state.financePath}/foodItems/${product.id}/cuisine`] = String(product.cuisine || '').trim();
          }
          if (String(product.healthy || '').trim()) {
            updatesMap[`${state.financePath}/foodItems/${product.id}/healthy`] = String(product.healthy || '').trim();
          }
          updatesMap[`${state.financePath}/foodItems/${product.id}/updatedAt`] = nowTs();
          const vendorKey = firebaseSafeKey(parsed.data?.source?.vendor || 'unknown') || 'unknown';
          const entryId = push(ref(db, `${state.financePath}/foodItems/${product.id}/priceHistory/${vendorKey}`)).key;
          updatesMap[`${state.financePath}/foodItems/${product.id}/priceHistory/${vendorKey}/${entryId}`] = {
            price: Number(product.defaultPrice || 0),
            unitPrice: Number(product.defaultPrice || 0),
            linePrice: Number(product.defaultPrice || 0),
            date: dayKeyFromTs(purchaseTs),
            vendor: vendorKey,
            ts: purchaseTs,
            source: 'ticket_import'
          };
        });
        if (Object.keys(updatesMap).length) await safeFirebase(() => update(ref(db), updatesMap));
        await ensureFoodCatalogLoaded(true);
        const importedItems = importResult.updatedDraft.importedItems.map((item) => {
          const qty = Math.max(1, Number(item.qty || 1));
          const totalPrice = Number(item.totalPrice || item.price || 0);
          const unitPrice = Number(item.unitPrice || computeUnitPrice(totalPrice, qty));
          return {
            foodId: item.productId || (getFoodByName(item.name)?.id || ''),
            productKey: String(item.productId || firebaseSafeKey(item.name)),
            name: item.name,
            qty,
            unit: String(item.unit || 'ud').trim() || 'ud',
            unitPrice,
            amount: totalPrice,
            totalPrice,
            price: totalPrice,
            mealType: '',
            cuisine: String(isTicketExtraLike(item.name) ? 'otros' : item.categoryApp || ''),
            place: String(importResult.updatedDraft.importedVendor || 'unknown'),
            healthy: String(isTicketExtraLike(item.name) ? 'otros' : item.categoryApp || '')
          };
        });
        const category = String(state.balanceFormState.category || '').trim().toLowerCase() === 'sin categoría' || !String(state.balanceFormState.category || '').trim()
          ? resolveTicketMovementCategory(parsed.data)
          : (state.balanceFormState.category || importResult.updatedDraft.category || 'Sin categoría');
        state.balanceFormState = {
          ...state.balanceFormState,
          type: 'expense',
          amount: String(importResult.updatedDraft.amount || 0),
          dateISO: importResult.updatedDraft.dateISO || dayKeyFromTs(Date.now()),
          note: importResult.updatedDraft.note || '',
          accountId: importResult.updatedDraft.accountId || state.balanceFormState.accountId || '',
          category,
          foodPlace: String(importResult.updatedDraft.importedVendor || 'unknown'),
          importedFoodItems: importedItems,
          foodExtrasOpen: true
        };
        state.modal = {
          ...state.modal,
          ticketImport: {
            ...(state.modal.ticketImport || {}),
            open: true,
            warnings: importResult.warnings,
            error: '',
            diagnostic: {
              ...(parsed.diagnostic || {}),
              stage: 'apply',
              apply: 'ok',
              warnings: importResult.warnings,
              computed_total: parsed.data?.purchase?.computed_total,
              purchase_total: parsed.data?.purchase?.total
            }
          }
        };
        triggerRender();
        toast('Import aplicado');
      } catch (error) {
        state.modal = {
          ...state.modal,
          ticketImport: {
            ...(state.modal.ticketImport || {}),
            error: `No se pudo aplicar el import: ${error?.message || 'error desconocido'}`,
            diagnostic: {
              ...(state.modal.ticketImport?.diagnostic || state.modal.ticketImport?.parsed?.diagnostic || {}),
              stage: 'apply',
              apply_error: String(error?.message || 'error desconocido')
            }
          }
        };
        triggerRender();
      }
      return;
    }

    const txTypePick = target.closest('[data-tx-type-pick]')?.dataset.txTypePick;
    if (txTypePick) {
      const form = document.querySelector('#finance-modal [data-balance-form]');
      const sel = form?.querySelector('[data-tx-type]');
      if (sel) {
        sel.value = String(txTypePick);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      const buttons = [...document.querySelectorAll('#finance-modal [data-tx-type-pick]')];
      buttons.forEach((btn) => btn.classList.toggle('is-active', btn.dataset.txTypePick === String(txTypePick)));
      if (form) persistBalanceFormState(form);
      return;
    }

    if (target.closest('[data-tx-step-back]')) {
      const form = document.querySelector('#finance-modal [data-balance-form]');
      if (form) persistBalanceFormState(form);
      const step = normalizeTxWizardStep(state.balanceFormState.txWizardStep);
      state.balanceFormState = {
        ...state.balanceFormState,
        txWizardStep: step === 'food' ? 'category' : step === 'category' ? 'base' : 'base'
      };
      triggerRender();
      return;
    }

    if (target.closest('[data-tx-step-next]')) {
      const formEl = document.querySelector('#finance-modal [data-balance-form]');
      if (!formEl) return;
      persistBalanceFormState(formEl);
      const fd = new FormData(formEl);
      const type = normalizeTxType(String(fd.get('type') || 'expense'));
      const amountRaw = String(fd.get('amount') || '').trim();
      const dateRaw = String(fd.get('dateISO') || '').trim();
      const accountId = String(fd.get('accountId') || '').trim();
      const fromAccountId = String(fd.get('fromAccountId') || '').trim();
      const toAccountId = String(fd.get('toAccountId') || '').trim();
      const category = String(fd.get('category') || '').trim();

      const step = normalizeTxWizardStep(state.balanceFormState.txWizardStep);
      if (step === 'base') {
        if (!dateRaw) { toast('Falta la fecha'); return; }
        if (type === 'transfer') {
          if (!fromAccountId || !toAccountId) { toast('Faltan cuentas'); return; }
        } else if (!accountId) {
          toast('Falta la cuenta');
          return;
        }
        state.balanceFormState = { ...state.balanceFormState, txWizardStep: 'category' };
        triggerRender();
        return;
      }

      if (step === 'category') {
        if (!category) { toast('Selecciona una categoría'); return; }
        if (isFoodCategoryName(category)) {
          state.balanceFormState = { ...state.balanceFormState, txWizardStep: 'food' };
          triggerRender();
          return;
        }
        formEl.requestSubmit();
        return;
      }

      formEl.requestSubmit();
      return;
    }

    const txCategoryPick = target.closest('[data-tx-category-pick]')?.dataset.txCategoryPick;
    if (txCategoryPick) {
      const form = document.querySelector('#finance-modal [data-balance-form]');
      const sel = form?.querySelector('select[name="category"]');
      if (sel) {
        sel.value = String(txCategoryPick);
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      if (form) persistBalanceFormState(form);
      state.balanceFormState = {
        ...state.balanceFormState,
        txWizardStep: isFoodCategoryName(txCategoryPick) ? 'food' : 'category'
      };
      triggerRender();
      return;
    }

    if (target.closest('[data-tx-edit-categories]')) {
      const form = document.querySelector('#finance-modal [data-balance-form]');
      if (form) persistBalanceFormState(form);
      const returnModal = { ...state.modal };
      state.modal = { type: 'categories', returnModal };
      triggerRender();
      return;
    }

    if (target.closest('[data-category-editor-back]')) {
      state.modal = state.modal?.returnModal ? { ...state.modal.returnModal } : { type: null };
      triggerRender();
      return;
    }

    if (target.closest('[data-category-add]') && state.modal?.type === 'categories') {
      const nameRaw = document.querySelector('[data-category-add-name]')?.value || '';
      const emojiRaw = document.querySelector('[data-category-add-emoji]')?.value || '';
      const name = normalizeFoodName(String(nameRaw || ''));
      const emoji = String(emojiRaw || '').trim();
      if (!name) { toast('Nombre obligatorio'); return; }
      await safeFirebase(() => set(ref(db, `${state.financePath}/catalog/categories/${name}`), { name, emoji, lastUsedAt: nowTs() }));
      state.balance.categories[name] = { ...(state.balance.categories[name] || {}), name, emoji, lastUsedAt: nowTs() };
      toast('Categoría añadida');
      triggerRender();
      return;
    }

    const categoryDelete = target.closest('[data-category-delete]')?.dataset.categoryDelete;
    if (categoryDelete && state.modal?.type === 'categories') {
      const name = String(categoryDelete || '').trim();
      if (!name) return;
      if (!window.confirm(`¿Eliminar "${name}"?`)) return;
      await safeFirebase(() => remove(ref(db, `${state.financePath}/catalog/categories/${name}`)));
      if (state.balance?.categories?.[name]) delete state.balance.categories[name];
      if (state.modal?.returnModal?.type === 'tx' && String(state.balanceFormState.category || '').toLowerCase() === name.toLowerCase()) {
        state.balanceFormState = { ...state.balanceFormState, category: '' };
      }
      toast('Categoría eliminada');
      triggerRender();
      return;
    }

    const segmentToggle = target.closest('[data-finance-stats-segment]')?.dataset.financeStatsSegment;
    if (segmentToggle && !target.closest('[data-finance-product-stats]')) {
      state.balanceStatsActiveSegment = state.balanceStatsActiveSegment === segmentToggle ? null : segmentToggle;
      state.balanceStatsSelectedSliceKey = state.balanceStatsActiveSegment;
      updateLegendSelection(state.balanceStatsActiveSegment || '');
      updateCallout(state.balanceStatsActiveSegment || '');
      if (financeStatsDonutChart) {
        financeStatsDonutChart.dispatchAction({ type: 'downplay', seriesIndex: 0 });
        const rows = (() => { try { return JSON.parse(document.querySelector('[data-finance-stats-donut]')?.dataset.financeStatsDonut || '[]'); } catch (_) { return []; } })();
        const idx = rows.findIndex((row) => String(row?._key || '') === String(state.balanceStatsActiveSegment || ''));
        if (idx >= 0) financeStatsDonutChart.dispatchAction({ type: 'highlight', seriesIndex: 0, dataIndex: idx });
      }
      return;
    }
    const legendProductKey = target.closest('[data-finance-product-stats]')?.dataset.financeProductStats || target.closest('.financeLegendRow')?.dataset.productKey;
    if (target.closest('[data-finance-product-stats]') && legendProductKey) {
      await openProductDetail(legendProductKey);
      return;
    }
    if (target.closest('[data-food-open-products]')) {
      state.activeView = 'products';
      state.foodProductsView = { ...(state.foodProductsView || {}), tab: 'list' };
      triggerRender();
      return;
    }
    const productsTab = target.closest('[data-products-tab]')?.dataset.productsTab;
    if (productsTab) {
      switchProductsSubview(productsTab);
      return;
    }
    const saveProductsSettingsBtn = target.closest('[data-products-save-settings]');
    if (saveProductsSettingsBtn) {
      await persistProductsHubSettings({
        monthlyTarget: document.querySelector('[data-products-setting="monthlyTarget"]')?.value || 0,
        defaultAccountId: document.querySelector('[data-products-setting="defaultAccountId"]')?.value || '',
        defaultStore: document.querySelector('[data-products-setting="defaultStore"]')?.value || '',
        defaultPaymentMethod: document.querySelector('[data-products-setting="defaultPaymentMethod"]')?.value || 'Tarjeta',
      });
      toast('Ajustes de compra guardados');
      triggerRender();
      return;
    }
    const carouselScrollBtn = target.closest('[data-products-carousel-scroll]');
    if (carouselScrollBtn) {
      scrollProductsCatalogCarousel(carouselScrollBtn);
      return;
    }
    const expandProductId = target.closest('[data-products-expand-product]')?.dataset.productsExpandProduct;
    if (expandProductId) {
      toggleProductsCardExpanded(expandProductId);
      return;
    }
    const lineStepBtn = target.closest('[data-products-line-step]');
    if (lineStepBtn) {
      adjustProductsLineQtyFromDom(lineStepBtn.dataset.productsLineStep, Number(lineStepBtn.dataset.productsLineStepDelta || 0));
      return;
    }
    if (target.closest('[data-products-select-visible]')) {
      selectVisibleProductsFromDom();
      return;
    }
    if (target.closest('[data-products-create-ticket-from-selected]')) {
      await addSelectedProductsToNewTicket();
      return;
    }
    if (target.closest('[data-products-open-batch-modal]')) {
      state.modal = { type: 'products-batch-edit' };
      triggerRender();
      return;
    }
    if (target.closest('[data-products-delete-selected]')) {
      const selectedIds = [...new Set((Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
      if (!selectedIds.length) return;
      if (!window.confirm(`Vas a eliminar ${selectedIds.length} productos del catalogo. El historico de compras no se borra. ¿Continuar?`)) return;
      await removeProductsCatalogItems(selectedIds);
      return;
    }
    if (target.closest('[data-products-clear-selection]')) {
      clearProductsSelection();
      if (state.modal?.type === 'products-batch-edit') {
        state.modal = { type: null };
        triggerRender();
      }
      return;
    }
    const batchActiveState = target.closest('[data-products-batch-active]')?.dataset.productsBatchActive;
    if (batchActiveState) {
      await applyProductsSelectedActiveState(batchActiveState);
      return;
    }
    const addToListId = target.closest('[data-products-add-to-list]')?.dataset.productsAddToList;
    if (addToListId) {
      await addProductToActiveProductsList(addToListId);
      return;
    }
    const deleteProductId = target.closest('[data-products-delete-product]')?.dataset.productsDeleteProduct;
    if (deleteProductId) {
      const productLabel = resolveProductsCatalogSnapshot(deleteProductId)?.canonicalName || deleteProductId;
      if (!window.confirm(`Vas a eliminar "${productLabel}" del catalogo. El historico de compras no se borra. ¿Continuar?`)) return;
      await removeProductsCatalogItem(deleteProductId);
      return;
    }
    const receiptPick = target.closest('[data-products-receipt-pick]');
    if (receiptPick) {
      const productId = receiptPick.dataset.productsReceiptPick;
      const lineId = String(receiptPick.dataset.productsReceiptPickLine || '').trim();
      closeProductsReceiptSuggestions(view);
      if (lineId) await changeProductsReceiptLineProduct(lineId, productId);
      else await addProductToActiveProductsListFromReceipt(productId);
      return;
    }
    const createFromSearch = target.closest('[data-products-create-from-search]')?.dataset.productsCreateFromSearch;
    if (createFromSearch) {
      await createProductFromQuickSearch(createFromSearch);
      return;
    }
    const selectProductId = target.closest('[data-products-select-product]')?.dataset.productsSelectProduct;
    if (selectProductId) {
      selectProductsCatalogProduct(selectProductId);
      return;
    }
    const openProductCardId = target.closest('[data-products-open-product]')?.dataset.productsOpenProduct;
    if (openProductCardId && !target.closest('[data-products-add-to-list], [data-products-toggle-select], .productsWorkbench__check, .productsWorkbench__miniAction, .productsWorkbench__productHeading')) {
      selectProductsCatalogProduct(openProductCardId);
      return;
    }
    if (target.closest('[data-products-add-selected-list]')) {
      await addSelectedProductsToActiveList();
      return;
    }
    const removeLineId = target.closest('[data-products-remove-line]')?.dataset.productsRemoveLine;
    if (removeLineId) {
      await removeProductsLineFromActiveList(removeLineId);
      return;
    }
    const switchTicketId = target.closest('[data-products-switch-ticket]')?.dataset.productsSwitchTicket;
    if (switchTicketId) {
      await switchProductsActiveTicket(switchTicketId);
      return;
    }
    if (target.closest('[data-products-move-selected-ticket]')) {
      await moveSelectedReceiptLinesToNewTicket();
      return;
    }
    if (target.closest('[data-products-create-empty-ticket]')) {
      await createEmptyProductsTicket();
      return;
    }
    const deleteTicketId = target.closest('[data-products-delete-ticket]')?.dataset.productsDeleteTicket;
    if (deleteTicketId) {
      await deleteProductsTicket(deleteTicketId);
      return;
    }
    if (target.closest('[data-products-receipt-add-line]')) {
      await createProductFromReceiptRow();
      return;
    }
    if (target.closest('[data-products-save-list]')) {
      await saveActiveProductsListFromDom();
      return;
    }
    if (target.closest('[data-products-clear-list]')) {
      if (!window.confirm('Vas a vaciar la lista activa. ¿Continuar?')) return;
      await clearProductsActiveList();
      return;
    }
    if (target.closest('[data-products-export-ticket]')) {
      await exportActiveProductsTicketNamesFromDom();
      return;
    }
    if (target.closest('[data-products-confirm-ticket]')) {
      await confirmProductsTicketFromDom();
      return;
    }
    const catalogPanelTab = target.closest('[data-products-catalog-panel-tab]')?.dataset.productsCatalogPanelTab;
    if (catalogPanelTab) {
      state.foodProductsView = {
        ...(state.foodProductsView || {}),
        tab: 'catalog',
        catalogPanel: catalogPanelTab,
      };
      patchProductsCatalogSubview(buildCurrentProductsModel());
      return;
    }
    const reuseTicketId = target.closest('[data-products-reuse-ticket]')?.dataset.productsReuseTicket;
    if (reuseTicketId) {
      await reuseProductsTicketAsActiveList(reuseTicketId);
      return;
    }
    const deleteHistoryTicketId = target.closest('[data-products-delete-history-ticket]')?.dataset.productsDeleteHistoryTicket;
    if (deleteHistoryTicketId) {
      await deleteProductsHistoryTicket(deleteHistoryTicketId);
      return;
    }
    const reuseListId = target.closest('[data-products-reuse-list]')?.dataset.productsReuseList;
    if (reuseListId) {
      await reuseProductsListAsActiveList(reuseListId);
      return;
    }
    if (target.closest('[data-products-new-product]')) {
      state.foodProductsView = {
        ...(state.foodProductsView || {}),
        selectedProductId: '__new__',
      };
      patchProductsEditorPanel(buildCurrentProductsModel());
      return;
    }
    const foodProductsTab = target.closest('[data-food-products-tab]')?.dataset.foodProductsTab;
    if (foodProductsTab) {
      state.foodProductsView = { ...state.foodProductsView, tab: foodProductsTab };
      applyProductsFiltersDirectDom();
      return;
    }
    if (target.closest('[data-food-merge-open]')) {
      const seed = String(target.closest('[data-food-merge-open]')?.dataset.foodMergeOpen || '').trim();
      const selectedIds = [...new Set((Array.isArray(state.foodProductsView?.selectedIds) ? state.foodProductsView.selectedIds : []).map((id) => String(id || '').trim()).filter(Boolean))];
      const selected = selectedIds.length >= 2 ? selectedIds : (seed ? [seed] : []);
      const preferredDestination = selected.includes(String(state.foodProductsView?.selectedProductId || '').trim())
        ? String(state.foodProductsView?.selectedProductId || '').trim()
        : String(selected[0] || seed || '').trim();
      state.modal = { type: 'food-merge', selected, destinationId: preferredDestination, search: '', destinationSearch: '', hideResolved: true };
      triggerRender();
      return;
    }
    const mergeCheck = target.closest('[data-food-merge-select]')?.dataset.foodMergeSelect;
    if (mergeCheck) {
      const selected = new Set(Array.isArray(state.modal.selected) ? state.modal.selected : []);
      if (target.matches('input[type="checkbox"]') ? target.checked : !selected.has(mergeCheck)) selected.add(mergeCheck);
      else selected.delete(mergeCheck);
      const selectedList = [...selected];
      const currentDestination = String(state.modal.destinationId || '');
      const destinationId = selected.has(currentDestination) ? currentDestination : (selectedList[0] || '');
      console.log('[mergeFoodProducts] selección UI', { selected: selectedList, destinationId });
      state.modal = { ...state.modal, selected: selectedList, destinationId };
      triggerRender();
      return;
    }
    const mergeDestination = target.closest('[data-food-merge-destination]')?.dataset.foodMergeDestination;
    if (mergeDestination) {
      state.modal = { ...state.modal, destinationId: String(mergeDestination || '').trim() };
      triggerRender();
      return;
    }
    if (target.matches('[data-food-merge-hide-resolved]')) {
      state.modal = { ...state.modal, hideResolved: !!target.checked };
      triggerRender();
      return;
    }
    if (target.closest('[data-food-merge-confirm]')) {
      const selected = Array.isArray(state.modal.selected) ? state.modal.selected : [];
      const destinationId = String(state.modal.destinationId || selected[0] || '').trim();
      if (selected.length < 2) return;
      if (!destinationId || !selected.includes(destinationId)) return;
      if (!window.confirm(`Vas a fusionar ${selected.length} productos en 1 canonical. ¿Continuar?`)) return;
      const mergedOk = await mergeFoodProducts(selected, destinationId);
      if (!mergedOk) {
        toast('No se pudo completar la fusión de forma segura');
        return;
      }
      toast('Productos fusionados');
      state.modal = state.activeView === 'products' ? { type: null } : { type: 'food-products' };
      triggerRender();
      return;
    }
    const accountMergeOpen = target.closest('[data-account-merge-open]')?.dataset.accountMergeOpen;
    if (accountMergeOpen != null) {
      openAccountMergeModal(accountMergeOpen);
      return;
    }
    const accountMergeToggle = target.closest('[data-account-merge-toggle]')?.dataset.accountMergeToggle;
    if (accountMergeToggle) {
      updateAccountMergeSelection(accountMergeToggle);
      return;
    }
    const accountMergeDestination = target.closest('[data-account-merge-destination]')?.dataset.accountMergeDestination;
    if (accountMergeDestination) {
      setAccountMergeDestination(accountMergeDestination);
      return;
    }
    if (target.closest('[data-account-merge-clear]')) {
      clearAccountMergeSelection();
      return;
    }
    const accountMergeSuggestion = target.closest('[data-account-merge-apply-suggestion]')?.dataset.accountMergeApplySuggestion;
    if (accountMergeSuggestion) {
      applyAccountMergeSuggestion(accountMergeSuggestion);
      return;
    }
    if (target.closest('[data-account-merge-confirm]')) {
      const accounts = buildAccountModels();
      const current = normalizeAccountMergeModalState(state.modal, accounts);
      const selection = [...current.selectedIds];
      const destinationId = String(current.destinationId || '').trim();
      if (current.merging || selection.length < 2 || !destinationId || !selection.includes(destinationId)) return;
      const destinationAccount = accounts.find((account) => String(account?.id || '').trim() === destinationId) || null;
      const destinationLabel = destinationAccount?.name || destinationId;
      if (!window.confirm(`Se fusionaran ${selection.length} cuentas en "${destinationLabel}". ¿Continuar?`)) return;

      state.modal = { ...current, merging: true };
      syncAccountMergeModal(null, accounts);

      const merged = await mergeAccounts(selection, destinationId);
      const refreshedAccounts = buildAccountModels();
      const nextBaseState = normalizeAccountMergeModalState({ ...state.modal, merging: false }, refreshedAccounts);
      if (!merged) {
        state.modal = nextBaseState;
        syncAccountMergeModal(null, refreshedAccounts);
        return;
      }

      const resolvedGroup = {
        id: `resolved-${hashString(`${merged.destinationId}:${merged.sourceIds.join(',')}:${merged.mergedAt}`)}`,
        ...merged,
      };
      state.modal = normalizeAccountMergeModalState({
        ...nextBaseState,
        merging: false,
        selectedIds: [],
        destinationId: '',
        resolvedGroups: [resolvedGroup, ...nextBaseState.resolvedGroups],
      }, refreshedAccounts);
      toast(selection.length > 2 ? 'Cuentas fusionadas' : 'Fusion completada');
      triggerRender();
      return;
    }
    const ignoreFoodId = target.closest('[data-food-ignore-product]')?.dataset.foodIgnoreProduct;
    if (ignoreFoodId) {
      await safeFirebase(() => set(ref(db, `${state.financePath}/foodCatalog/ignored/${ignoreFoodId}`), true));
      state.foodCatalog.ignored[ignoreFoodId] = true;
      toast('Producto ocultado en rankings');
      triggerRender();
      return;
    }
    const foodDetailId = target.closest('[data-food-item-detail]')?.dataset.foodItemDetail;
    if (foodDetailId) {
      const item = resolveFoodItemByAnyKey(foodDetailId);
      if (item) {
        state.modal = { type: 'food-item', foodId: item.id, mode: 'detail', source: 'stats-list-detail' };
      } else {
        const snapshot = resolveProductsCatalogSnapshot(foodDetailId);
        if (!snapshot?.canonicalName) {
          toast('Ese producto aun no tiene ficha propia');
          return;
        }
        state.modal = { type: 'food-item', foodName: snapshot.canonicalName, source: 'stats-list-detail-create' };
      }
      triggerRender();
      return;
    }
    const foodDetailName = target.closest('[data-food-item-detail-name]')?.dataset.foodItemDetailName;
    if (foodDetailName) {
      const found = getFoodByName(foodDetailName);
      state.modal = found
        ? { type: 'food-item', foodId: found.id, mode: 'detail', source: 'stats-list-detail-name' }
        : { type: 'food-item', foodName: foodDetailName, source: 'stats-list-detail-name-create' };
      triggerRender();
      return;
    }
    if (state.balanceStatsActiveSegment && state.activeView === 'balance' && !target.closest('.financeStats')) {
      state.balanceStatsActiveSegment = null;
      triggerRender();
    }
    if (!target.closest('[data-products-receipt-suggest], [data-products-receipt-add-suggest], [data-products-receipt-name], [data-products-receipt-add-name]')) {
      closeProductsReceiptSuggestions(view);
    }
    const aliasRemoveIndex = target.closest('[data-food-alias-remove]')?.dataset.foodAliasRemove;
    const aliasAddBtn = target.closest('[data-food-alias-add]');
    if (aliasRemoveIndex != null || aliasAddBtn) {
      const formEl = target.closest('[data-food-item-form]');
      const hidden = formEl?.querySelector('[data-food-aliases-hidden]');
      const input = formEl?.querySelector('[data-food-alias-input]');
      const chips = formEl?.querySelector('[data-food-aliases-chips]');
      if (!hidden || !chips) return;
      const aliases = String(hidden.value || '').split(',').map((row) => normalizeFoodName(row)).filter(Boolean);
      if (aliasRemoveIndex != null) aliases.splice(Number(aliasRemoveIndex), 1);
      if (aliasAddBtn) {
        const alias = normalizeFoodName(String(input?.value || ''));
        if (alias && !aliases.includes(alias)) aliases.push(alias);
        if (input) input.value = '';
      }
      hidden.value = aliases.join(', ');
      chips.innerHTML = aliases.length
        ? aliases.map((alias, index) => `<button type="button" class="finFoodChip finFoodChip--remove" data-food-alias-remove="${index}">${escapeHtml(alias)} ×</button>`).join('')
        : '<span class="finFoodChip">Sin alias</span>';
      return;
    }
    const foodAdd = target.closest('[data-food-add]')?.dataset.foodAdd;
    if (foodAdd) {
      const hostForm = target.closest('[data-balance-form], [data-food-item-form]');
      if (!hostForm) return;
      const typed = window.prompt('Nuevo valor');
      const name = normalizeFoodName(typed || '');
      if (!name) return;
      await loadFoodCatalog();
      await upsertFoodOption(foodAdd, name, false);
      if (hostForm.matches('[data-balance-form]')) {
        await syncFoodOptionsInForm(hostForm);
      } else {
        triggerRender();
      }
      const select = hostForm.querySelector(`[data-food-select="${foodAdd}"], select[name="${foodAdd === 'typeOfMeal' ? 'mealType' : foodAdd}"]`);
      if (select) select.value = name;
      return;
    }
    const topItem = target.closest('[data-food-top-item]')?.dataset.foodTopItem;
    if (topItem) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      await applyFoodItemPreset(form, topItem);
      renderFoodItemSearchResults(form);
      return;
    }
    const selectedItem = target.closest('[data-food-item-select]')?.dataset.foodItemSelect;
    if (selectedItem) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      await applyFoodItemPreset(form, selectedItem);
      renderFoodItemSearchResults(form);
      return;
    }
    const createItem = target.closest('[data-food-item-create]')?.dataset.foodItemCreate;
    if (createItem != null) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const name = normalizeFoodName(createItem);
      if (!name) return;
      state.modal = { type: 'food-item', foodName: name, source: 'balance-form-create' };
      triggerRender();
      return;
    }
    const foodInfoId = target.closest('[data-food-item-info]')?.dataset.foodItemInfo;
    if (foodInfoId) {
      event.stopPropagation();
      state.modal = { type: 'food-item', foodId: foodInfoId, mode: 'info', source: 'balance-form-info' };
      triggerRender();
      return;
    }
    const editFoodId = target.closest('[data-food-item-edit]')?.dataset.foodItemEdit;
    if (editFoodId) {
      event.stopPropagation();
      state.modal = { type: 'food-item', foodId: editFoodId, source: 'balance-form-edit' };
      triggerRender();
      return;
    }
    const registerFoodHistory = target.closest('[data-food-history-register]')?.dataset.foodHistoryRegister;
    if (registerFoodHistory) {
      const registerInline = document.querySelector('[data-food-register-inline]');
      if (registerInline) registerInline.hidden = false;
      return;
    }
    const toggleInlineRegister = target.closest('[data-food-toggle-register]');
    if (toggleInlineRegister) {
      const registerInline = document.querySelector('[data-food-register-inline]');
      if (!registerInline) return;
      registerInline.hidden = !registerInline.hidden;
      if (!registerInline.hidden) registerInline.querySelector('[data-food-register-price]')?.focus();
      return;
    }
    const submitRegister = target.closest('[data-food-register-submit]')?.dataset.foodRegisterSubmit;
    if (submitRegister) {
      const registerWrap = document.querySelector('[data-food-register-inline]');
      const vendor = String(document.querySelector('[data-food-register-vendor]')?.value || '').trim();
      const price = parseEuroNumber(document.querySelector('[data-food-register-price]')?.value || '');
      const date = String(document.querySelector('[data-food-register-date]')?.value || dayKeyFromTs(nowTs()));
      if (!vendor) { toast('Selecciona supermercado'); return; }
      if (!Number.isFinite(price) || price <= 0) { toast('Precio inválido'); return; }
      await recordFoodPricePoint(submitRegister, price, 'manual', { vendor, date, ts: parseDayKey(date) || nowTs() });
      if (registerWrap) registerWrap.hidden = true;
      toast('Precio registrado');
      triggerRender();
      return;
    }
    const addVendorPrice = target.closest('[data-food-price-add-vendor]')?.dataset.foodPriceAddVendor;
    if (addVendorPrice) {
      const registerInline = document.querySelector('[data-food-register-inline]');
      if (!registerInline) return;
      registerInline.hidden = false;
      const vendorInput = registerInline.querySelector('[data-food-register-vendor]');
      if (vendorInput) vendorInput.value = addVendorPrice;
      registerInline.querySelector('[data-food-register-price]')?.focus();
      return;
    }
    const deletePriceKey = target.closest('[data-food-price-delete]')?.dataset.foodPriceDelete;
    if (deletePriceKey) {
      const [vendor, entryId] = String(deletePriceKey).split(':');
      const foodId = state.modal.foodId || '';
      if (!foodId || !vendor || !entryId) return;
      if (!window.confirm('¿Borrar este precio?')) return;
      await deleteFoodPricePoint(foodId, vendor, entryId);
      toast('Registro eliminado');
      triggerRender();
      return;
    }
    const editVendorAlias = target.closest('[data-food-alias-edit]')?.dataset.foodAliasEdit;
    if (editVendorAlias) {
      const aliasesCard = document.querySelector('[data-food-detail-card="aliases"]');
      if (aliasesCard && aliasesCard.tagName === 'DETAILS') aliasesCard.open = true;
      const input = document.querySelector('#food-vendorAliases-input');
      if (!input) return;
      const key = firebaseSafeKey(editVendorAlias);
      const map = String(input.value || '').split(',').reduce((acc, row) => {
        const [rawVendor, rawVals] = String(row || '').split(':');
        const vendor = firebaseSafeKey(rawVendor || '');
        if (!vendor) return acc;
        acc[vendor] = String(rawVals || '').split('|').map((it) => normalizeFoodName(it)).filter(Boolean);
        return acc;
      }, {});
      if (!map[key]) map[key] = [];
      input.value = Object.entries(map).map(([vendor, aliases]) => `${vendor}:${aliases.join('|')}`).join(', ');
      input.focus();
      toast(`Edita alias para ${editVendorAlias} y pulsa Guardar`);
      return;
    }
    const aliasAssociateFoodId = target.closest('[data-food-alias-associate]')?.dataset.foodAliasAssociate;
    if (aliasAssociateFoodId) {
      const canonicalRaw = String(document.querySelector('[data-food-alias-canonical-picker]')?.value || '').trim();
      const vendorRaw = String(document.querySelector('[data-food-alias-vendor-picker]')?.value || '').trim();
      const currentFood = state.food.itemsById?.[aliasAssociateFoodId] || null;
      const aliasRaw = normalizeFoodName(currentFood?.displayName || currentFood?.name || '');
      const canonicalId = firebaseSafeKeyLoose(canonicalRaw || aliasAssociateFoodId);
      const vendorKey = firebaseSafeKeyLoose(vendorRaw || 'unknown');
      const aliasKey = firebaseSafeKeyLoose(normalizeAliasKey(aliasRaw));
      if (!canonicalId || !aliasKey) { toast('Selecciona producto y vendor'); return; }
      const payload = firebaseClean({ canonicalId, aliasRaw, updatedAt: nowTs() });
      await safeFirebase(() => update(ref(db, `${state.financePath}/foodCatalog/aliases/${vendorKey}/${aliasKey}`), payload));
      if (!state.foodCatalog.aliases[vendorKey]) state.foodCatalog.aliases[vendorKey] = {};
      state.foodCatalog.aliases[vendorKey][aliasKey] = payload;
      if (canonicalId !== aliasAssociateFoodId) {
        await safeFirebase(() => update(ref(db, `${state.financePath}/foodCatalog/merges/${firebaseSafeKeyLoose(aliasAssociateFoodId)}`), firebaseClean({ canonicalId })));
      }
      toast('Alias asociado');
      triggerRender();
      return;
    }

    const vendorFocus = target.closest('[data-food-focus-vendor]')?.dataset.foodFocusVendor;
    if (vendorFocus) {
      const host = document.querySelector('[data-food-history-chart]');
      if (!host) return;
      host.dataset.foodHiddenVendors = Object.keys(JSON.parse(host.dataset.foodHistorySeries || '{}')).filter((vendor) => vendor !== vendorFocus).join(',');
      void renderFoodHistoryVendorChart();
      return;
    }
    const vendorToggle = target.closest('[data-food-vendor-toggle]')?.dataset.foodVendorToggle;
    if (vendorToggle) {
      const host = document.querySelector('[data-food-history-chart]');
      if (!host) return;
      const hidden = new Set(String(host.dataset.foodHiddenVendors || '').split(',').map((row) => firebaseSafeKey(row || '')).filter(Boolean));
      const vendorKey = firebaseSafeKey(vendorToggle || '');
      if (!vendorKey) return;
      if (hidden.has(vendorKey)) hidden.delete(vendorKey); else hidden.add(vendorKey);
      host.dataset.foodHiddenVendors = [...hidden].join(',');
      void renderFoodHistoryVendorChart();
      return;
    }
    const openFoodEdit = target.closest('[data-food-open-edit]')?.dataset.foodOpenEdit;
    if (openFoodEdit) {
      state.modal = { type: 'food-item', foodId: openFoodEdit, source: 'detail-edit' };
      triggerRender();
      return;
    }
    const chartTypeBtn = target.closest('[data-food-chart-type]');
    if (chartTypeBtn) {
      const host = document.querySelector('[data-food-history-chart]');
      if (!host) return;
      host.dataset.foodChartType = chartTypeBtn.dataset.foodChartType || 'line';
      document.querySelectorAll('[data-food-chart-type]').forEach((el) => el.classList.toggle('is-active', el === chartTypeBtn));
      void renderFoodHistoryVendorChart();
      return;
    }
    const chartRangeBtn = target.closest('[data-food-chart-range]');
    if (chartRangeBtn) {
      const host = document.querySelector('[data-food-history-chart]');
      if (!host) return;
      host.dataset.foodChartRange = chartRangeBtn.dataset.foodChartRange || 'total';
      document.querySelectorAll('[data-food-chart-range]').forEach((el) => el.classList.toggle('is-active', el === chartRangeBtn));
      void renderFoodHistoryVendorChart();
      return;
    }
    const scrollToCard = target.closest('[data-food-scroll-to]')?.dataset.foodScrollTo;
    if (scrollToCard) {
      document.querySelector(`[data-food-detail-card="${scrollToCard}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const viewPurchasesFood = target.closest('[data-food-view-purchases]')?.dataset.foodViewPurchases;
    if (viewPurchasesFood) {
      toast('Filtra por producto desde “Movimientos” (próx. atajo directo)');
      return;
    }
    const addFoodItem = target.closest('[data-food-item-add]');
    if (addFoodItem) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const refs = getFoodFormRefs(form);
      const name = normalizeFoodName(refs.itemValue?.value || refs.itemSearch?.value || '');
      if (!name) return;
      const price = Number(refs.itemPrice?.value || 0);
      const items = readFoodItemsFromForm(form);
      items.push({
        foodId: refs.foodId?.value || '',
        name,
        price: Number.isFinite(price) ? price : 0,
        mealType: refs.mealType?.value || '',
        cuisine: refs.cuisine?.value || '',
        place: refs.place?.value || '',
        healthy: refs.cuisine?.value || ''
      });
      writeFoodItemsToForm(form, items);
      recalcFoodAmount(form);
      resetFoodEntryForm(form, { keepDropdownOpen: true });
      keepFoodExtrasOpen(form);
      renderFoodItemSearchResults(form);
      persistBalanceFormState(form);
      return;
    }
    const removeFoodItem = target.closest('[data-food-item-remove]')?.dataset.foodItemRemove;
    if (removeFoodItem != null) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const items = readFoodItemsFromForm(form);
      items.splice(Number(removeFoodItem), 1);
      writeFoodItemsToForm(form, items);
      recalcFoodAmount(form);
      persistBalanceFormState(form);
      return;
    }
    if (target.closest('[data-food-reset-amount]')) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      state.balanceAmountAuto = true;
      recalcFoodAmount(form);
      return;
    }
    const txDayOpen = target.closest('[data-tx-day-open]')?.dataset.txDayOpen;
    if (txDayOpen) {
      state.modal = { type: 'tx-day', day: txDayOpen, monthOffset: state.balanceMonthOffset };
      triggerRender();
      return;
    }
    const txEdit = target.closest('[data-tx-edit]')?.dataset.txEdit;
    if (txEdit) {
      const currentRow = balanceTxList().find((row) => row.id === txEdit) || null;
      if (!currentRow) return;
      openEditMovementModal(currentRow);
      return;
    }
    const recurringInstanceOpen = target.closest('[data-recurring-instance-open]')?.dataset.recurringInstanceOpen;
    if (recurringInstanceOpen) {
      const recurringMonth = target.closest('[data-recurring-month]')?.dataset.recurringMonth
        || target.dataset.recurringMonth
        || getSelectedBalanceMonthKey();
      openRecurringMovementModal(recurringInstanceOpen, recurringMonth);
      return;
    }
const txDelete = target.closest('[data-tx-delete]')?.dataset.txDelete;
if (txDelete && window.confirm('¿Eliminar movimiento?')) {
  const existing = balanceTxList().find((row) => row.id === txDelete);
  if (!existing) return;

  const path = existing.__path || `${state.financePath}/transactions/${txDelete}`;
  console.log('[FINANCE][BALANCE] delete', path);

  await safeFirebase(() => remove(ref(db, path)));

  const freshRoot = await loadFinanceRoot();
  const touched = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean);
  for (const accountId of [...new Set(touched)]) {
    await recomputeAccountEntries(accountId, existing.date || isoToDay(existing.dateISO || ''), freshRoot);
  }
  const refreshedRoot = await loadFinanceRoot();
  removeLocalTxEverywhere(txDelete);
  syncLocalAccountsFromRoot(refreshedRoot);
  clearFinanceDerivedCaches();

  toast('Movimiento eliminado');
  scheduleAggregateRebuild();
  triggerRender();
  return;
}
    const createCategory = target.closest('[data-category-create]');
    if (createCategory) {
      const form = target.closest('[data-balance-form]');
      const categoryInput = form?.querySelector('[data-category-new]');
      const categorySelect = form?.querySelector('select[name="category"]');
      const category = normalizeFoodName(String(categoryInput?.value || ''));
      if (!category) return;
      await safeFirebase(() => set(ref(db, `${state.financePath}/catalog/categories/${category}`), { name: category, lastUsedAt: nowTs() }));
      state.balance.categories[category] = { name: category, lastUsedAt: nowTs() };
      if (categorySelect && ![...categorySelect.options].some((opt) => opt.value === category)) {
        categorySelect.insertAdjacentHTML('beforeend', `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`);
      }
      if (categorySelect) categorySelect.value = category;
      if (categoryInput) categoryInput.value = '';
      maybeToggleCategoryCreate(form);
      await toggleFoodExtras(form);
      persistBalanceFormState(form);
      toast('Categoría creada');
      return;
    }
    const nextHomePanelView = target.closest('[data-home-panel-view]')?.dataset.homePanelView;
    if (nextHomePanelView) {
      const normalizedHomePanelView = normalizeHomePanelView(nextHomePanelView);
      if (state.homePanelView !== normalizedHomePanelView) {
        setHomePanelView(normalizedHomePanelView);
        triggerRender();
      }
      return;
    }
    const nextView = target.closest('[data-finance-view]')?.dataset.financeView; if (nextView) { state.activeView = nextView; if (nextView === 'products') state.foodProductsView = { ...(state.foodProductsView || {}), tab: 'list' }; triggerRender(); return; }
    if (target.closest('[data-close-modal]') || target.id === 'finance-modalOverlay') {
      if (state.modal?.type === 'tx') {
        if (getMovementFormMeta().saving) return;
        closeMovementModal();
        return;
      }
      state.modal = { type: null };
      triggerRender();
      return;
    }
    if (target.closest('[data-history]')) { state.modal = { type: 'history' }; triggerRender(); return; }
    if (target.closest('[data-new-account]')) { state.modal = { type: 'new-account' }; triggerRender(); return; }
    const openAccount = target.closest('[data-open-detail]')?.dataset.openDetail; if (openAccount && !target.closest('[data-account-input]') && !target.closest('[data-account-save]') && !target.closest('[data-delete-account]')) { openAccountDetail(openAccount); return; }
    const delAcc = target.closest('[data-delete-account]')?.dataset.deleteAccount; if (delAcc && window.confirm('¿Eliminar esta cuenta y todos sus registros?')) { await deleteAccount(delAcc); return; }
    const editAcc = target.closest('[data-edit-account]')?.dataset.editAccount; if (editAcc) { state.modal = { type: 'edit-account', accountId: editAcc }; triggerRender(); return; }
    const saveAccountCard = target.closest('[data-account-save]')?.dataset.accountSave; if (saveAccountCard) { const input = view.querySelector(`[data-account-input="${saveAccountCard}"]`); await saveSnapshot(saveAccountCard, dayKeyFromTs(Date.now()), input?.value || ''); return; }
    const delDay = target.closest('[data-delete-day]')?.dataset.deleteDay; if (delDay) { const [accountId, day] = delDay.split(':'); if (window.confirm(`¿Eliminar ${day}?`)) await deleteDay(accountId, day); return; }
    const saveDay = target.closest('[data-save-day]')?.dataset.saveDay; if (saveDay) { const [accountId, day] = saveDay.split(':'); const form = view.querySelector(`[data-account-row-form="${saveDay}"]`); const val = form?.querySelector('[name="value"]')?.value; await saveSnapshot(accountId, day, val); return; }
    const budgetMenu = target.closest('[data-budget-menu]')?.dataset.budgetMenu; if (budgetMenu) { state.modal = { type: 'budget', budgetId: budgetMenu }; triggerRender(); return; }
    const budgetDelete = target.closest('[data-budget-delete]')?.dataset.budgetDelete; if (budgetDelete && window.confirm('¿Eliminar presupuesto?')) { const monthKey = getSelectedBalanceMonthKey(); await safeFirebase(() => remove(ref(db, `${state.financePath}/budgets/${monthKey}/${budgetDelete}`))); state.modal = { type: null }; toast('Presupuesto eliminado'); triggerRender(); return; }
    const importApply = target.closest('[data-import-apply]')?.dataset.importApply; if (importApply) { const parsed = state.modal.importPreview; if (!parsed?.validRows?.length) { state.modal = { ...state.modal, importError: 'CSV sin filas válidas.' }; triggerRender(); return; } const imported = await applyImportRows(importApply, parsed); toast(`Importados ${imported} días`); openAccountDetail(importApply); return; }
    const calendarDay = target.closest('[data-calendar-day]')?.dataset.calendarDay; if (calendarDay) { state.modal = { type: 'calendar-day-edit', day: calendarDay }; triggerRender(); return; }
    const openMonth = target.closest('[data-calendar-open-month]')?.dataset.calendarOpenMonth; if (openMonth) {
      state.calendarMonthOffset = monthDiffFromNow(openMonth);
      state.calendarMode = 'day';
      triggerRender();
      return;
    }
    const openYear = target.closest('[data-calendar-open-year]')?.dataset.calendarOpenYear; if (openYear) {
      state.calendarMonthOffset = monthDiffFromNow(`${openYear}-01`);
      state.calendarMode = 'month';
      triggerRender();
      return;
    }
if (target.closest('[data-open-fixed-expense]')) {
  state.fixedExpenseFormState = defaultFixedExpenseFormState();
  state.modal = { type: 'fixed-expense' };
  triggerRender({ preserveUi: false });
  return;
}
const fixedExpenseEditId = target.closest('[data-fixed-expense-edit]')?.dataset.fixedExpenseEdit;
if (fixedExpenseEditId) {
  const recurringId = String(fixedExpenseEditId).trim();
  const recurringData = state.balance?.recurring?.[recurringId];
  if (recurringData) {
    state.fixedExpenseFormState = fixedExpenseFormStateFromRecurring(recurringId, recurringData);
    state.modal = { type: 'fixed-expense' };
    triggerRender({ preserveUi: false });
  }
  return;
}
const fixedExpenseDeleteId = target.closest('[data-delete-fixed-expense]')?.dataset.deleteFixedExpense;
if (fixedExpenseDeleteId && window.confirm('¿Eliminar este gasto fijo?')) {
  const recurringId = String(fixedExpenseDeleteId).trim();
  const path = `${state.financePath}/recurring/${recurringId}`;
  
  await safeFirebase(() => remove(ref(db, path)));
  
  state.fixedExpenseFormState = defaultFixedExpenseFormState();
  state.modal = { type: null };
  clearFinanceDerivedCaches();
  toast('Gasto fijo eliminado');
  triggerRender({ preserveUi: false });
  return;
}

if (target.closest('[data-test-fixed-expense]')) {
  const formState = state.fixedExpenseFormState || defaultFixedExpenseFormState();
  const amount = parseMoney(String(formState.amount || ''));
  const dayOfMonth = Math.max(1, Math.min(31, Number(formState.dayOfMonth || 1)));

  if (!String(formState.name || '').trim()) {
    toast('Pon un nombre');
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Importe inválido');
    return;
  }
  if (!String(formState.accountId || '').trim()) {
    toast('Selecciona una cuenta');
    return;
  }

  const testTxId = `test-fixed-expense-${Date.now()}`;
  const today = dayKeyFromTs(Date.now());
  
  const testPayload = {
    id: testTxId,
    type: formState.type === 'income' ? 'income' : 'expense',
    amount,
    accountId: String(formState.accountId || '').trim(),
    category: String(formState.category || 'Fijos').trim() || 'Fijos',
    note: `[PRUEBA] ${String(formState.name || '').trim()}`,
    date: today,
    dateISO: today,
    monthKey: today.slice(0, 7),
    timestamp: Date.now(),
    _isTestTransaction: true
  };

  state.balance = state.balance || {};
  state.balance.transactions = state.balance.transactions || {};
  state.balance.transactions[testTxId] = testPayload;
  
  clearFinanceDerivedCaches();
  toast(`Prueba registrada: ${String(formState.name || '')} - ${fmtSignedCurrency(formState.type === 'income' ? amount : -amount)}`);
  triggerRender();
  
  setTimeout(() => {
    delete state.balance.transactions[testTxId];
    clearFinanceDerivedCaches();
    toast('Prueba eliminada');
    triggerRender();
  }, 5000);
  return;
}
    const monthShift = target.closest('[data-month-shift]')?.dataset.monthShift; if (monthShift) {
      const step = Number(monthShift);
      if (state.calendarMode === 'month') state.calendarMonthOffset += (step * 12);
      else if (state.calendarMode === 'year') state.calendarMonthOffset += (step * 120);
      else state.calendarMonthOffset += step;
      triggerRender();
      return;
    }
    const bMonth = target.closest('[data-balance-month]')?.dataset.balanceMonth; if (bMonth) { state.balanceMonthOffset += Number(bMonth); state.balanceShowAllTx = false; state.balanceStatsActiveSegment = null; triggerRender(); return; }
    const statsMode = target.closest('[data-finance-stats-mode]')?.dataset.financeStatsMode; if (statsMode) { state.balanceStatsMode = statsMode === 'income' ? 'income' : 'expense'; state.balanceStatsActiveSegment = null; triggerRender(); return; }
    const statsRange = target.closest('[data-finance-stats-range]')?.dataset.financeStatsRange; if (statsRange) { state.balanceStatsRange = statsRange; state.balanceStatsActiveSegment = null; triggerRender(); return; }
    const statsScope = target.closest('[data-finance-stats-scope]')?.dataset.financeStatsScope; if (statsScope) { state.balanceStatsScope = statsScope === 'global' ? 'global' : 'personal'; state.balanceStatsActiveSegment = null; triggerRender(); return; }

    if (target.closest('[data-finance-stats-view-unlined]')) { state.balanceFilterType = 'expense'; state.balanceFilterCategory = 'all'; state.balanceFilterUnlinedOnly = true; state.balanceShowAllTx = true; triggerRender(); return; }
    if (target.closest('[data-balance-filter-unlined-clear]')) { state.balanceFilterUnlinedOnly = false; triggerRender(); return; }
    const manageDelete = target.closest('[data-finance-manage-delete]')?.dataset.financeManageDelete;
    if (manageDelete) {
      const encodedValue = target.closest('[data-finance-manage-value]')?.dataset.financeManageValue || target.dataset.financeManageValue || '';
      const value = String(encodedValue || '').trim();
      if (!value) return;
      if (!window.confirm(`¿Eliminar "${value}"?`)) return;
      await deleteManagedStatItem(manageDelete, value);
      triggerRender();
      return;
    }
    const drilldown = target.closest('[data-balance-drilldown]')?.dataset.balanceDrilldown; if (drilldown) { openBalanceDrilldown(drilldown); return; }
    const aggScope = target.closest('[data-fin-agg-scope]')?.dataset.finAggScope; if (aggScope) { state.balanceAggScope = aggScope === 'total' ? 'total' : 'my'; triggerRender(); return; }
    const drilldownMonth = target.closest('[data-drilldown-month]')?.dataset.drilldownMonth;
    if (drilldownMonth && state.modal.type === 'balance-drilldown') {
      state.modal = { ...state.modal, monthOffset: Number(state.modal.monthOffset || 0) + Number(drilldownMonth) };
      triggerRender();
      return;
    }
    const drilldownAdd = target.closest('[data-drilldown-add]')?.dataset.drilldownAdd;
    if (drilldownAdd && state.modal.type === 'balance-drilldown') {
      const monthKey = offsetMonthKey(getMonthKeyFromDate(), Number(state.modal.monthOffset || 0));
      openCreateMovementModal({ type: drilldownAdd, dateISO: `${monthKey}-01` });
      return;
    }
    if (target.closest('[data-balance-showmore]')) { state.balanceShowAllTx = !state.balanceShowAllTx; triggerRender(); return; }
    const openModal = target.closest('[data-open-modal]')?.dataset.openModal;
    if (openModal) {
      if (openModal === 'tx') {
        openCreateMovementModal();
        return;
      }
      state.modal = { type: openModal, budgetId: null };
      triggerRender();
      return;
    }
    const openGoal = target.closest('[data-open-goal]')?.dataset.openGoal; if (openGoal) { state.modal = { type: 'goal-detail', goalId: openGoal }; triggerRender(); return; }
    const delGoal = target.closest('[data-delete-goal]')?.dataset.deleteGoal; if (delGoal && window.confirm('¿Borrar objetivo?')) { await safeFirebase(() => remove(ref(db, `${state.financePath}/goals/goals/${delGoal}`))); if (state.goals?.goals?.[delGoal]) { const nextGoals = { ...(state.goals.goals || {}) }; delete nextGoals[delGoal]; state.goals = { goals: nextGoals }; } if (state.modal?.goalId === delGoal) state.modal = { type: null }; toast('Objetivo eliminado'); triggerRender(); return; }
 const fixedSummaryView = target.closest('[data-fixed-summary-view]')?.dataset.fixedSummaryView;
if (fixedSummaryView) {
  state.calendarFixedView = ['squares', 'donut', 'line'].includes(fixedSummaryView)
    ? fixedSummaryView
    : 'squares';
  triggerRender();
  return;
}
  });
view.addEventListener('focusin', (event) => {
  if (isActiveTicketInput(event.target)) {
    beginReceiptEditSession(event.target);
  }
  if (event.target.matches('[data-account-input]')) {
    event.target.dataset.prev = event.target.value;
    event.target.value = '';
    return;
  }
  if (event.target.matches('[data-products-receipt-unit], [data-products-receipt-total]')) {
    const fallback = parseProductsReceiptMoney(event.target.dataset.moneyLastValid, 0);
    const nextValue = parseProductsReceiptMoney(event.target.value, fallback);
    event.target.value = formatEditableEuro(nextValue);
    event.target.select?.();
    return;
  }
  if (event.target.matches('[data-products-receipt-qty], [data-products-receipt-add-qty]')) {
    const raw = String(event.target.value || '').trim();
    if (!raw || raw === '1' || raw === '1.00' || raw === '1,00') {
      event.target.select?.();
    }
  }
}, evtOpts);

view.addEventListener('focusout', async (event) => {
  if (event.target.matches('[data-account-input]')) {
    const accountId = event.target.dataset.accountInput;
    const value = event.target.value.trim();
    const prev = String(event.target.dataset.prev || '').trim();
    if (!value) {
      event.target.value = prev;
      return;
    }
    const nextNum = parseEuroNumber(value);
    const prevNum = parseEuroNumber(prev);
    if (!Number.isFinite(nextNum) || (Number.isFinite(prevNum) && Math.abs(nextNum - prevNum) < 0.000001)) {
      event.target.value = prev;
      return;
    }
    const saved = await saveSnapshot(accountId, dayKeyFromTs(Date.now()), nextNum);
  if (saved) {
      event.target.value = String(nextNum.toFixed(2));
      event.target.dataset.prev = event.target.value;
      triggerRender();
    }
  }
  if (event.target.matches('[data-products-receipt-unit], [data-products-receipt-total]')) {
    const fallback = parseProductsReceiptMoney(event.target.dataset.moneyLastValid, 0);
    const nextValue = parseProductsReceiptMoney(event.target.value, fallback, { blankAsNaN: true });
    const finalValue = Number.isFinite(nextValue) ? nextValue : fallback;
    syncProductsMoneyFieldDisplay(event.target, finalValue);
    const lineId = String(event.target.dataset.productsReceiptUnit || event.target.dataset.productsReceiptTotal || '').trim();
    if (lineId) {
      const patch = event.target.matches('[data-products-receipt-unit]')
        ? { estimatedPrice: finalValue }
        : { actualPrice: finalValue };
      await commitReceiptLineEdit(lineId, patch, { root: view });
    } else {
      syncProductsTicketComposerDom(view);
    }
  }
  if (event.target.matches('[data-products-receipt-qty]')) {
    const lineId = String(event.target.dataset.productsReceiptQty || '').trim();
    if (lineId) {
      const qtyValue = Math.max(0.01, Number(event.target.value || 1));
      await commitReceiptLineEdit(lineId, { qty: qtyValue }, { root: view });
    } else {
      syncProductsTicketComposerDom(view);
    }
  }
  if (event.target.matches('[data-products-receipt-add-name], [data-products-receipt-name]')) {
    closeProductsReceiptSuggestionsSoon(view, event.relatedTarget);
  }
  if (isActiveTicketInput(event.target)) {
    window.setTimeout(() => endReceiptEditSession(event.target), 0);
  }
});
  view.addEventListener('keydown', async (event) => {
    if (event.key === 'Escape' && event.target.matches('[data-products-receipt-add-name], [data-products-receipt-name]')) {
      event.preventDefault();
      closeProductsReceiptSuggestions(view);
      event.target.blur();
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-products-receipt-add-name]')) {
      event.preventDefault();
      const first = document.querySelector('[data-products-receipt-add-suggest] [data-products-receipt-pick]');
      if (first) await addProductToActiveProductsListFromReceipt(first.dataset.productsReceiptPick);
      else await createProductFromReceiptRow();
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-products-receipt-name]')) {
      event.preventDefault();
      const lineId = String(event.target.dataset.productsReceiptName || '').trim();
      const first = document.querySelector(`[data-products-receipt-suggest="${lineId}"] [data-products-receipt-pick]`);
      if (first) await changeProductsReceiptLineProduct(lineId, first.dataset.productsReceiptPick);
      else event.target.blur();
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-products-receipt-unit], [data-products-receipt-total]')) {
      event.preventDefault();
      event.target.blur();
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-products-receipt-qty]')) {
      event.preventDefault();
      event.target.blur();
      return;
    }
    if (event.key === 'Enter' && event.target.matches('[data-products-quick-search], [data-products-catalog-search], [data-products-filter="productsQuery"]')) {
      event.preventDefault();
      return;
    }
    if (!event.target.matches('[data-account-input]')) return;
    if (event.key !== 'Enter') return;
    event.preventDefault();
    event.target.blur();
  });
  view.addEventListener('change', async (event) => {
    if (event.target.matches('[data-range]')) { state.rangeMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-compare]')) { state.compareMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-finance-goals-sort]')) { setFinanceGoalsSortMode(event.target.value); triggerRender(); return; }
    if (event.target.matches('[data-calendar-account]')) { state.calendarAccountId = event.target.value; triggerRender(); }
    if (event.target.matches('[data-calendar-mode]')) { state.calendarMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-balance-type]')) { state.balanceFilterType = event.target.value; state.balanceShowAllTx = false; triggerRender(); }
    if (event.target.matches('[data-balance-category]')) { state.balanceFilterCategory = event.target.value; state.balanceShowAllTx = false; triggerRender(); }
    if (event.target.matches('[data-balance-account]')) { state.balanceAccountFilter = event.target.value; state.balanceShowAllTx = false; triggerRender(); }
    if (event.target.matches('[data-balance-trend-mode]')) { state.balanceTrendMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-balance-trend-category]')) { state.balanceTrendCategory = event.target.value; triggerRender(); }
    if (event.target.matches('[data-finance-stats-group]')) { state.balanceStatsGroupBy = event.target.value; state.balanceStatsActiveSegment = null; triggerRender(); }
    if (event.target.matches('[data-products-toggle-select]')) {
      toggleProductsSelection(event.target.dataset.productsToggleSelect, event.target.checked);
      return;
    }
    if (event.target.matches('[data-products-filter]')) {
      const filterKey = String(event.target.dataset.productsFilter || '').trim();
      const nextValue = event.target.type === 'checkbox' ? !!event.target.checked : event.target.value;
      if (filterKey === 'productsQuery') {
        applyProductsCatalogGlobalSearch(event.target);
        return;
      }
      const nextViewState = {
        ...(state.foodProductsView || {}),
        [filterKey]: nextValue,
      };
      if (filterKey === 'range') nextViewState.rangeValue = '';
      state.foodProductsView = nextViewState;
      patchProductsCatalogSubview();
      return;
    }
    if (event.target.matches('[data-food-products-range]')) { state.foodProductsView = { ...state.foodProductsView, range: event.target.value, rangeValue: '' }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-food-products-vendor]')) { state.foodProductsView = { ...state.foodProductsView, vendor: event.target.value }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-food-products-account]')) { state.foodProductsView = { ...state.foodProductsView, account: event.target.value }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-food-products-items-only]')) { state.foodProductsView = { ...state.foodProductsView, onlyWithItems: !!event.target.checked }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-food-products-food-only]')) { state.foodProductsView = { ...state.foodProductsView, onlyFood: !!event.target.checked }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-food-products-custom-start]')) { state.foodProductsView = { ...state.foodProductsView, customStart: event.target.value }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-food-products-custom-end]')) { state.foodProductsView = { ...state.foodProductsView, customEnd: event.target.value }; applyProductsFiltersDirectDom(); }
    if (event.target.matches('[data-products-receipt-select]')) {
      toggleReceiptLineSelection(event.target.dataset.productsReceiptSelect, event.target.checked);
      return;
    }
    if (event.target.matches('[data-products-store-select], [data-products-receipt-date], [data-products-receipt-payment]')) {
      syncProductsTicketComposerDom(view);
      syncProductsDraftListLocal(readProductsListDraftFromDom(view));
      return;
    }
    if (event.target.matches('[data-account-merge-show-resolved]')) {
      const accounts = buildAccountModels();
      state.modal = normalizeAccountMergeModalState({ ...state.modal, showResolved: !!event.target.checked }, accounts);
      syncAccountMergeModal(null, accounts);
      return;
    }
    if (event.target.matches('[data-finance-stats-include-unlined]')) { state.balanceStatsIncludeUnlined = !!event.target.checked; state.balanceStatsActiveSegment = null; triggerRender(); }
    if (event.target.matches('.financeBalanceCategoryToggle')) { const categoryKey = event.target.dataset.categoryKey; if (event.target.checked) { state.balanceCategoryTimelineSelected[categoryKey] = true; } else { delete state.balanceCategoryTimelineSelected[categoryKey]; } triggerRender(); }

    if (event.target.matches('[data-finance-stats-legend-details]')) {
      state.balanceStatsLegendExpanded = !!event.target.open;
    }
    if (event.target.matches('[data-import-file]')) {
      const file = event.target.files?.[0];
      if (!file) return;
      const raw = await file.text();
      const parsed = parseCsvRows(raw);
      state.modal = { ...state.modal, importRaw: raw, importPreview: parsed, importError: parsed.validRows.length ? '' : 'CSV inválido o sin filas válidas.' };
      triggerRender();
    }
    if (event.target.matches('[data-balance-form] select[name="category"]')) {
      const form = event.target.closest('[data-balance-form]');
      await toggleFoodExtras(form);
      maybeToggleCategoryCreate(form);
    }
    if (event.target.matches('[data-new-account-form] input[name="shared"], [data-new-account-form] input[name="isBitcoin"]')) {
      syncNewAccountFormUI(event.target.closest('[data-new-account-form]'));
      return;
    }
    if (event.target.matches('[data-tx-type]')) {
      syncTxTypeFields(event.target.closest('[data-balance-form]'));
    }
    if (event.target.matches('[data-linked-habit-select], [data-allocation-mode]')) {
      const form = event.target.closest('[data-balance-form]');
      syncAllocationFields(form);
      persistBalanceFormState(form);
    }
    if (event.target.closest('[data-food-item-form][data-food-item-mode="detail"]')) {
      updateFoodDetailSaveState(event.target.closest('[data-food-item-form]'));
    }
    if (event.target.closest('[data-fixed-expense-form]')) {
  const formEl = event.target.closest('[data-fixed-expense-form]');
  const fd = new FormData(formEl);

  state.fixedExpenseFormState = {
    ...(state.fixedExpenseFormState || defaultFixedExpenseFormState()),
    id: String(fd.get('id') || ''),
    name: String(fd.get('name') || ''),
    emoji: String(fd.get('emoji') || '💸').trim() || '💸',
    amount: String(fd.get('amount') || ''),
    type: String(fd.get('type') || 'expense') === 'income' ? 'income' : 'expense',
    category: String(fd.get('category') || 'Fijos'),
    accountId: String(fd.get('accountId') || ''),
    dayOfMonth: Math.max(1, Math.min(31, Number(fd.get('dayOfMonth') || 1))),
    startDate: String(fd.get('startDate') || ''),
    endDate: String(fd.get('endDate') || ''),
    active: !!formEl.querySelector('[name="active"]')?.checked,
    autoCreate: !!formEl.querySelector('[name="autoCreate"]')?.checked,
    color: String(fd.get('color') || ''),
    note: String(fd.get('note') || '')
  };
  return;
}
  }, evtOpts);

  view.addEventListener('input', async (event) => {
    if (event.target.matches('[data-card-last4-input]')) {
      const cleaned = String(event.target.value || '').replace(/\D/g, '').slice(0, 4);
      if (event.target.value !== cleaned) event.target.value = cleaned;
    }
    if (event.target.matches('[data-new-account-form] input[name="btcUnits"], [data-new-account-form] input[name="sharedRatio"]')) {
      syncNewAccountFormUI(event.target.closest('[data-new-account-form]'));
    }
    if (event.target.matches('[data-products-catalog-search]')) {
      applyProductsCatalogGroupSearch(event.target);
      return;
    }
    if (event.target.matches('[data-products-quick-search]')) {
      updateProductsQuickSearch(event.target);
      return;
    }
    if (event.target.matches('[data-products-store-select]')) {
      const newStoreInput = event.target.closest('.productsWorkbench__field, .productsWorkbench__receiptMetaGroup')?.querySelector('[data-products-new-store-input]');
      if (event.target.value === '__new__') {
        if (newStoreInput) {
          newStoreInput.hidden = false;
          newStoreInput.focus();
        }
        return;
      }
      if (newStoreInput) {
        newStoreInput.hidden = true;
        newStoreInput.value = '';
      }
      syncProductsTicketComposerDom(view);
      syncProductsDraftListLocal(readProductsListDraftFromDom(view));
      return;
    }
    if (event.target.matches('[data-products-quick-line-qty]')) {
      syncQuickLineQtyToList(event.target);
      return;
    }
    if (event.target.matches('[data-products-receipt-add-name], [data-products-receipt-name]')) {
      closeProductsReceiptSuggestions(view, event.target.closest('.productsWorkbench__receiptNameWrap')?.querySelector('.productsWorkbench__receiptSuggest'));
      updateProductsReceiptSuggestions(event.target);
      if (event.target.matches('[data-products-receipt-name]')) {
        const lineId = String(event.target.dataset.productsReceiptName || '').trim();
        const productIdInput = view.querySelector(`[data-products-line-product-id="${lineId}"]`);
        if (productIdInput) productIdInput.value = '';
        await updateReceiptLine('', lineId, { name: normalizeFoodName(event.target.value || '') }, { root: view, persist: true });
      }
      return;
    }
    if (event.target.matches('[data-products-receipt-add-qty], [data-products-receipt-add-unit]')) {
      syncProductsTicketComposerDom(view);
      return;
    }
    if (event.target.matches('[data-products-receipt-qty], [data-products-receipt-unit], [data-products-receipt-total]')) {
      const lineId = String(event.target.dataset.productsReceiptQty || event.target.dataset.productsReceiptUnit || event.target.dataset.productsReceiptTotal || '').trim();
      const patch = {};
      if (event.target.matches('[data-products-receipt-qty]')) patch.qty = Math.max(0.01, Number(event.target.value || 1));
      if (event.target.matches('[data-products-receipt-unit]')) patch.estimatedPrice = parseProductsReceiptMoney(event.target.value, 0);
      if (event.target.matches('[data-products-receipt-total]')) patch.actualPrice = parseProductsReceiptMoney(event.target.value, 0);
      await updateReceiptLine('', lineId, patch, { root: view, persist: false });
      scheduleReceiptLineCommit(lineId, patch, { root: view });
      return;
    }
    if (event.target.matches('[data-products-new-store-input]')) {
      const value = normalizeFoodName(event.target.value || '');
      const select = event.target.closest('.productsWorkbench__field, .productsWorkbench__receiptMetaGroup')?.querySelector('[data-products-store-select]');
      if (select) {
        let option = Array.from(select.options).find((opt) => opt.value.toLowerCase() === value.toLowerCase());
        if (!option && value) {
          option = new Option(value, value, true, true);
          select.add(option, select.options[Math.max(0, select.options.length - 1)] || null);
        }
        if (value) select.value = value;
      }
      syncProductsTicketComposerDom(view);
      syncProductsDraftListLocal(readProductsListDraftFromDom(view));
      return;
    }
    if (event.target.matches('[data-products-receipt-date], [data-products-receipt-payment]')) {
      syncProductsTicketComposerDom(view);
      syncProductsDraftListLocal(readProductsListDraftFromDom(view));
      return;
    }
    if (event.target.matches('[data-products-filter="productsQuery"]')) {
      applyProductsCatalogGlobalSearch(event.target);
      return;
    }
    if (event.target.closest('[data-products-list-form]')) {
      syncProductsTicketComposerDom(view);
      syncProductsDraftListLocal(readProductsListDraftFromDom(view));
      return;
    }
    if (event.target.matches('[data-balance-form] [data-category-new]')) {
      const form = event.target.closest('[data-balance-form]');
      maybeToggleCategoryCreate(form);
      persistBalanceFormState(form);
      return;
    }

    if (event.target.matches('[data-account-merge-search]')) {
      const accounts = buildAccountModels();
      state.modal = normalizeAccountMergeModalState({ ...state.modal, query: String(event.target.value || '') }, accounts);
      syncAccountMergeModal(null, accounts);
      return;
    }

    if (event.target.matches('[data-food-merge-search]')) {
      const value = String(event.target.value || '');
      state.modal = { ...state.modal, search: value };
      applyMergeSearchFilter(event.target, '[data-food-merge-option]');
      return;
    }

    if (event.target.matches('[data-food-merge-destination-search]')) {
      const value = String(event.target.value || '');
      state.modal = { ...state.modal, destinationSearch: value };
      applyMergeSearchFilter(event.target, '[data-food-merge-destination-option]');
      return;
    }

    if (event.target.matches('[data-food-products-search]')) {
      const value = String(event.target.value || '');
      state.foodProductsView = { ...state.foodProductsView, productsQuery: value };
      applyProductsSearchFilter(event.target);
      return;
    }

    if (event.target.matches('[data-ticket-import-raw]') && state.modal?.type === 'tx') {
      state.modal = {
        ...state.modal,
        ticketImport: {
          ...(state.modal.ticketImport || {}),
          raw: String(event.target.value || '')
        }
      };
      return;
    }
if (event.target.closest('[data-fixed-expense-form]')) {
  const formEl = event.target.closest('[data-fixed-expense-form]');
  const fd = new FormData(formEl);

  state.fixedExpenseFormState = {
    ...(state.fixedExpenseFormState || defaultFixedExpenseFormState()),
    id: String(fd.get('id') || ''),
    name: String(fd.get('name') || ''),
    emoji: String(fd.get('emoji') || '💸').trim() || '💸',
    amount: String(fd.get('amount') || ''),
    type: String(fd.get('type') || 'expense') === 'income' ? 'income' : 'expense',
    category: String(fd.get('category') || 'Fijos'),
    accountId: String(fd.get('accountId') || ''),
    dayOfMonth: Math.max(1, Math.min(31, Number(fd.get('dayOfMonth') || 1))),
    startDate: String(fd.get('startDate') || ''),
    endDate: String(fd.get('endDate') || ''),
    active: !!formEl.querySelector('[name="active"]')?.checked,
    autoCreate: !!formEl.querySelector('[name="autoCreate"]')?.checked,
    color: String(fd.get('color') || ''),
    note: String(fd.get('note') || '')
  };
  return;
}
    if (event.target.closest('[data-balance-form]')) {
      persistBalanceFormState(event.target.closest('[data-balance-form]'));
    }
    if (event.target.matches('[data-balance-form] input[name="amount"]')) {
      state.balanceAmountAuto = false;
    }
    if (event.target.matches('[data-balance-form] select[name="foodMealType"], [data-balance-form] select[name="foodCuisine"], [data-balance-form] select[name="foodPlace"]')) {
      const form = event.target.closest('[data-balance-form]');
      renderFoodItemSearchResults(form);
    }
    if (event.target.matches('[data-food-item-search]')) {
      const form = event.target.closest('[data-balance-form]');
      if (!form) return;
      const refs = getFoodFormRefs(form);
      if (refs.itemValue) refs.itemValue.value = normalizeFoodName(event.target.value);
      if (refs.foodId) refs.foodId.value = '';
      renderFoodItemSearchResults(form);
    }
    if (event.target.closest('[data-food-item-form][data-food-item-mode="detail"]')) {
      updateFoodDetailSaveState(event.target.closest('[data-food-item-form]'));
    }
  });

  view.addEventListener('toggle', (event) => {
    if (event.target.matches('[data-finance-stats-legend-details]')) {
      state.balanceStatsLegendExpanded = !!event.target.open;
    }
    if (event.target.matches('[data-balance-tx-details]')) {
      state.balanceTxDetailsOpen = !!event.target.open;
    }
    if (event.target.matches('[data-products-catalog-workspace]')) {
      state.foodProductsView = {
        ...(state.foodProductsView || {}),
        catalogCollapsed: !event.target.open,
      };
    }
    if (event.target.matches('[data-products-catalog-group]')) {
      const groupKey = String(event.target.dataset.productsCatalogGroup || '').trim();
      if (!groupKey) return;
      state.foodProductsView = {
        ...(state.foodProductsView || {}),
        catalogGroupsOpen: {
          ...((state.foodProductsView?.catalogGroupsOpen && typeof state.foodProductsView.catalogGroupsOpen === 'object')
            ? state.foodProductsView.catalogGroupsOpen
            : {}),
          [groupKey]: !!event.target.open,
        },
      };
    }
  });


  view.addEventListener('focusout', async (event) => {
    if (!event.target.matches('[data-food-display-name]')) return;
    const formEl = event.target.closest('[data-food-item-form][data-food-item-mode="detail"]');
    if (!formEl) return;
    const idInput = formEl.querySelector('input[name="foodId"]');
    const nameInput = formEl.querySelector('input[name="name"]');
    const foodId = String(idInput?.value || '');
    const name = normalizeFoodName(String(nameInput?.value || ''));
    const displayName = String(event.target.value || '').trim() || name;
    if (!foodId || !name || !displayName) return;
    const prevFood = state.food.itemsById?.[foodId] || null;
    if (prevFood && String(prevFood.displayName || '') === displayName) return;
    await upsertFoodItem({
      id: foodId,
      name,
      displayName,
      aliases: Array.isArray(prevFood?.aliases) ? prevFood.aliases : [],
      vendorAliases: prevFood?.vendorAliases && typeof prevFood.vendorAliases === 'object' ? prevFood.vendorAliases : {},
      mealType: prevFood?.mealType || '',
      cuisine: prevFood?.cuisine || prevFood?.healthy || '',
      healthy: prevFood?.cuisine || prevFood?.healthy || '',
      place: prevFood?.place || '',
      defaultPrice: Number(prevFood?.defaultPrice || 0)
    }, false);
    toast('Display name guardado');
  });

  view.addEventListener('submit', async (event) => {
if (event.target.matches('[data-products-editor-form]')) {
  event.preventDefault();
  await persistProductsEditorForm(event.target);
  return;
}
if (event.target.matches('[data-products-batch-form]')) {
  event.preventDefault();
  await applyProductsBatchForm(event.target);
  return;
}
if (event.target.matches('[data-products-quick-edit-form]')) {
  event.preventDefault();
  await persistProductsQuickEditForm(event.target);
  return;
}
if (event.target.matches('[data-fixed-expense-form]')) {
  event.preventDefault();

  const formState = state.fixedExpenseFormState || defaultFixedExpenseFormState();
  const amount = parseMoney(String(formState.amount || ''));
  const dayOfMonth = Math.max(1, Math.min(31, Number(formState.dayOfMonth || 1)));

  if (!String(formState.name || '').trim()) {
    toast('Pon un nombre');
    return;
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    toast('Importe inválido');
    return;
  }
  if (!String(formState.accountId || '').trim()) {
    toast('Selecciona una cuenta');
    return;
  }

  const recurringId = String(formState.id || push(ref(db, `${state.financePath}/recurring`)).key);
  const now = nowTs();
  const isEditMode = !!String(formState.id || '').trim();

  const payload = {
    type: formState.type === 'income' ? 'income' : 'expense',
    amount,
    accountId: String(formState.accountId || '').trim(),
    fromAccountId: '',
    toAccountId: '',
    category: String(formState.category || 'Fijos').trim() || 'Fijos',
    note: String(formState.note || '').trim(),
    disabled: formState.active === false,
    autoCreate: formState.autoCreate !== false,
    schedule: {
      frequency: 'monthly',
      dayOfMonth,
      startDate: toIsoDay(String(formState.startDate || '')) || dayKeyFromTs(Date.now()),
      endDate: toIsoDay(String(formState.endDate || '')) || ''
    },
    extras: {
      fixedEnabled: true,
      fixedKind: 'fixed-expense',
      fixedEmoji: String(formState.emoji || '💸').trim() || '💸',
      fixedName: String(formState.name || '').trim(),
      fixedColor: String(formState.color || '').trim()
    },
    updatedAt: now,
    createdAt: isEditMode ? Number(formState.createdAt || 0) : now
  };

  try {
    await set(ref(db, `${state.financePath}/recurring/${recurringId}`), payload);
  } catch (error) {
    log('firebase error on fixed expense save', error);
    toast('No se pudo guardar el gasto fijo');
    return;
  }

  state.fixedExpenseFormState = defaultFixedExpenseFormState();
  state.modal = { type: null };
  clearFinanceDerivedCaches();
  toast(isEditMode ? 'Gasto fijo actualizado' : 'Gasto fijo guardado');
  triggerRender({ preserveUi: false });
  return;
}
    if (event.target.matches('[data-category-editor-form]')) {
      event.preventDefault();
      const formEl = event.target;
      const inputs = [...formEl.querySelectorAll('[data-category-emoji]')];
      const updatesMap = {};
      inputs.forEach((input) => {
        const name = String(input.dataset.categoryEmoji || '').trim();
        if (!name) return;
        const emoji = String(input.value || '').trim();
        updatesMap[`${state.financePath}/catalog/categories/${name}/emoji`] = emoji || null;
        state.balance.categories[name] = { ...(state.balance.categories[name] || {}), name, emoji: emoji || '' };
      });
      await safeFirebase(() => update(ref(db), updatesMap));
      toast('Categorías guardadas');
      triggerRender();
      return;
    }
    if (event.target.matches('[data-food-item-form]')) {
      event.preventDefault();
      const form = new FormData(event.target);
      const foodId = String(form.get('foodId') || '');
      const name = normalizeFoodName(String(form.get('name') || ''));
      if (!name) { toast('Nombre obligatorio'); return; }
      const mealType = normalizeFoodName(String(form.get('mealTypeNew') || form.get('mealType') || ''));
      const cuisine = normalizeFoodName(String(form.get('cuisineNew') || form.get('cuisine') || ''));
      const place = normalizeFoodName(String(form.get('placeNew') || form.get('place') || ''));
      const displayName = String(form.get('displayName') || name).trim() || name;
      const aliases = String(form.get('aliases') || '').split(',').map((row) => normalizeFoodName(row)).filter(Boolean);
      const vendorAliases = String(form.get('vendorAliases') || '').split(',').reduce((acc, row) => {
        const [rawVendor, rawVals] = String(row || '').split(':');
        const vendor = firebaseSafeKey(rawVendor || '');
        if (!vendor) return acc;
        acc[vendor] = String(rawVals || '').split('|').map((it) => normalizeFoodName(it)).filter(Boolean);
        return acc;
      }, {});
      const defaultPrice = Number(form.get('defaultPrice') || 0);
      const saveMode = String(form.get('saveMode') || '');
      const prevFood = foodId ? (state.food.itemsById?.[foodId] || null) : null;
      const savedFoodId = await upsertFoodItem({ id: foodId, name, displayName, aliases, vendorAliases, mealType, cuisine, healthy: cuisine, place, defaultPrice }, false);
      if (!prevFood && Number.isFinite(defaultPrice) && defaultPrice > 0) {
        await recordFoodPricePoint(savedFoodId, defaultPrice, 'create');
      } else if (saveMode === 'info' && shouldAppendFoodPricePoint(prevFood || {}, defaultPrice)) {
        await recordFoodPricePoint(savedFoodId, defaultPrice, 'sheet');
      }
      if (mealType) await upsertFoodOption('typeOfMeal', mealType, false);
      if (cuisine) await upsertFoodOption('cuisine', cuisine, false);
      if (place) await upsertFoodOption('place', place, false);
      financeDebug('food modal saved', { foodId: foodId || state.food.nameToId?.[name.toLowerCase()] || null, name });
      state.balanceFormState = {
        ...state.balanceFormState,
        foodItem: name,
        foodId: state.food.nameToId?.[name.toLowerCase()] || savedFoodId || foodId,
        foodMealType: mealType,
        foodCuisine: cuisine,
        foodPlace: place,
        foodExtrasOpen: true
      };
      if (state.modal.type === 'food-item' && ['detail', 'info'].includes(state.modal.mode || '')) {
        state.modal = { ...state.modal, foodId: savedFoodId || foodId || state.modal.foodId };
        triggerRender();
      } else {
        state.modal = { type: 'tx', txId: state.modal.txId || '' };
        triggerRender();
      }
      return;
    }
    if (event.target.matches('[data-new-account-form]')) {
      event.preventDefault(); const form = new FormData(event.target); const name = String(form.get('name') || '').trim(); const shared = form.get('shared') === 'on'; const sharedRatio = Number(form.get('sharedRatio') || 50) / 100; const isBitcoin = form.get('isBitcoin') === 'on'; const btcUnits = Number(form.get('btcUnits') || 0); const initialValue = Number(form.get('initialValue') || 0); const cardLast4Raw = String(form.get('cardLast4') || '').trim(); const cardLast4 = normalizeCardLast4(cardLast4Raw); if (cardLast4Raw && !cardLast4) toast('Tarjeta: usa exactamente 4 dígitos o déjalo vacío'); if (name) { const duplicates = getCardLast4Duplicates(cardLast4); if (duplicates.length) toast('last4 duplicado: el import no podrá decidir'); await addAccount({ name, shared, sharedRatio, isBitcoin, btcUnits, cardLast4, initialValue }); } state.modal = { type: null }; triggerRender(); return;
    }
    if (event.target.matches('[data-calendar-day-form]')) {
      event.preventDefault();
      const day = String(event.target.dataset.calendarDayForm || '').trim();
      if (!day) { toast('Fecha inválida'); return; }
      const updatesMap = {};
      const touched = [];
      buildAccountModels().forEach((account) => {
        const raw = event.target.querySelector(`[name="acc_${account.id}"]`)?.value;
        if (raw == null || raw === '') return;
        const parsed = Number(String(raw).replace(',', '.'));
        if (!Number.isFinite(parsed)) return;
        updatesMap[`${state.financePath}/accounts/${account.id}/snapshots/${day}`] = { value: parsed, updatedAt: nowTs() };
        updatesMap[`${state.financePath}/accounts/${account.id}/updatedAt`] = nowTs();
        touched.push(account.id);
      });
      if (!touched.length) { toast('Sin cambios'); return; }
      await safeFirebase(() => update(ref(db), updatesMap));
      for (const accountId of touched) await recomputeAccountEntries(accountId, day);
      state.modal = { type: null };
      toast('Saldos guardados');
      triggerRender();
      return;
    }
    if (event.target.matches('[data-account-entry-form]')) {
      event.preventDefault();
      const accountId = event.target.dataset.accountEntryForm;
      const form = new FormData(event.target);
      const day = String(form.get('day') || '').trim();
      const value = form.get('value');
      if (!day) { toast('Fecha inválida'); return; }
      await saveSnapshot(accountId, day, value);
      openAccountDetail(accountId);
      return;
    }
    if (event.target.matches('[data-edit-account-form]')) {
      event.preventDefault();
      const accountId = event.target.dataset.editAccountForm;
      const form = new FormData(event.target);
      const cardLast4Raw = String(form.get('cardLast4') || '').trim(); const cardLast4 = normalizeCardLast4(cardLast4Raw); if (cardLast4Raw && !cardLast4) toast('Tarjeta: usa exactamente 4 dígitos o déjalo vacío'); const duplicates = getCardLast4Duplicates(cardLast4, accountId); if (duplicates.length) toast('last4 duplicado: el import no podrá decidir'); await updateAccountMeta(accountId, { name: String(form.get('name') || '').trim(), shared: form.get('shared') === 'on', sharedRatio: Number(form.get('sharedRatio') || 0.5), isBitcoin: form.get('isBitcoin') === 'on', btcUnits: Number(form.get('btcUnits') || 0), cardLast4 });
      state.modal = { type: null };
      triggerRender();
      return;
    }
    if (event.target.matches('[data-import-preview-form]')) {
      event.preventDefault();
      const accountId = event.target.dataset.importPreviewForm;
      const textCsv = event.target.querySelector('textarea[name="csvText"]')?.value || '';
      const parsed = parseCsvRows(textCsv);
      state.modal = { ...state.modal, accountId, importRaw: textCsv, importPreview: parsed, importError: parsed.validRows.length ? '' : 'CSV inválido o sin filas válidas.' };
      triggerRender();
      return;
    }
    if (event.target.matches('[data-balance-form]')) {
      event.preventDefault();
      const formEl = event.target;
      persistBalanceFormState(formEl);
      if (getMovementFormMeta().saving) return;
      const form = new FormData(formEl);
      const txId = String(form.get('txId') || '').trim();
      const type = normalizeTxType(String(form.get('type') || 'expense'));
      const amount = parseMoney(String(form.get('amount') || ''));
      const dateISO = toIsoDay(String(form.get('dateISO') || dayKeyFromTs(Date.now()))) || dayKeyFromTs(Date.now());
      const pickedCategory = String(form.get('category') || '').trim();
      const category = type === 'transfer' ? 'transfer' : (pickedCategory || 'Sin categoría');
      const note = String(form.get('note') || '').trim();
      const accountId = String(form.get('accountId') || '');
      const fromAccountId = String(form.get('fromAccountId') || '');
      const toAccountId = String(form.get('toAccountId') || '');
      const personalRatioMode = String(form.get('personalRatioMode') || 'auto');
      const personalRatioPercent = Number(form.get('personalRatioPercent') || 0);
      const linkedHabitId = String(form.get('linkedHabitId') || '').trim() || null;
      const allocationModeRaw = String(form.get('allocationMode') || 'point');
      const allocationAnchorDate = String(form.get('allocationAnchorDate') || dateISO);
      const allocationCustomStart = String(form.get('allocationCustomStart') || '');
      const allocationCustomEnd = String(form.get('allocationCustomEnd') || '');
      if (linkedHabitId && allocationModeRaw === 'custom') {
        if (!allocationCustomStart || !allocationCustomEnd) {
          toast('Completa Desde y Hasta para una distribución personalizada');
          return;
        }
        const startTs = localStartOfDayTs(allocationCustomStart);
        const endTs = localStartOfDayTs(allocationCustomEnd);
        if (!startTs || !endTs || startTs > endTs) {
          toast('Rango personalizado inválido: "Desde" debe ser menor o igual a "Hasta"');
          return;
        }
      }
      const allocation = normalizeTxAllocation(linkedHabitId ? {
        mode: allocationModeRaw === 'point' ? 'point' : 'period',
        period: allocationModeRaw === 'point' ? 'day' : allocationModeRaw,
        anchorDate: allocationAnchorDate,
        customStart: allocationCustomStart,
        customEnd: allocationCustomEnd
      } : { mode: 'point', period: 'day', anchorDate: dateISO }, dateISO);
      if (!Number.isFinite(amount) || amount <= 0) {
        console.warn('[FINANCE][BALANCE] invalid amount', form.get('amount'), amount);
        toast('Cantidad inválida');
        return;
      }
      if ((type === 'income' || type === 'expense') && !accountId) { toast('Selecciona una cuenta'); return; }
      if (type === 'transfer' && (!fromAccountId || !toAccountId || fromAccountId === toAccountId)) { toast('Transferencia inválida'); return; }
      const mealType = normalizeFoodName(String(form.get('foodMealType') || ''));
      const cuisine = normalizeFoodName(String(form.get('foodCuisine') || ''));
      const place = normalizeFoodName(String(form.get('foodPlace') || ''));
      const item = normalizeFoodName(String(form.get('foodItem') || ''));
      const foodIdFromForm = String(form.get('foodId') || '').trim();
      const foodItemsRaw = (() => {
        try { return JSON.parse(String(form.get('foodItems') || '[]')); } catch { return []; }
      })();
      const foodItems = Array.isArray(foodItemsRaw) ? foodItemsRaw.map((row) => {
        const qty = Math.max(1, Number(row?.qty || 1));
        const totalPrice = Number((row?.totalPrice ?? row?.amount ?? row?.price) || 0);
        const unitPrice = Number((row?.unitPrice ?? row?.unit_price) || computeUnitPrice(totalPrice, qty));
        return {
          foodId: String(row?.foodId || foodIdFromForm || ''),
          productKey: String(row?.productKey || ''),
          name: normalizeFoodName(row?.name || row?.item || row?.productName || item),
          qty,
          unit: String(row?.unit || 'ud').trim() || 'ud',
          unitPrice,
          amount: totalPrice,
          totalPrice,
          price: totalPrice,
          mealType: normalizeFoodName(row?.mealType || mealType),
          cuisine: normalizeFoodName(row?.cuisine || cuisine),
          place: normalizeFoodName(row?.place || place),
          healthy: String(row?.healthy || cuisine || '')
        };
      }).filter((row) => row.name) : [];
      const ticketDataFromDraft = state.balanceFormState?.ticketData;
      const ticketScanMetaFromDraft = state.balanceFormState?.ticketScanMeta;
      const requestedRecurringTemplateUpdate = form.get('isRecurring') === 'on';
      const recurringFrequency = String(form.get('recurringFrequency') || 'monthly');
      const recurringDay = Number(form.get('recurringDay') || 1);
      const recurringStart = toIsoDay(String(form.get('recurringStart') || dateISO)) || dateISO;
      const recurringEndRaw = toIsoDay(String(form.get('recurringEnd') || ''));
      const recurringMonthKey = dateISO.slice(0, 7);
      let prev = txId ? balanceTxList().find((row) => row.id === txId) : null;
      let effectiveRecurringId = String(form.get('recurringId') || prev?.recurringId || '').trim();
      if (requestedRecurringTemplateUpdate && !effectiveRecurringId) {
        effectiveRecurringId = push(ref(db, `${state.financePath}/recurring`)).key;
      }
      const linkedRecurringTemplate = effectiveRecurringId
        ? (state.balance?.recurring?.[effectiveRecurringId] || null)
        : null;
      let extras = isFoodCategory(category)
        ? { items: foodItems.length ? foodItems : (item ? [{ foodId: foodIdFromForm || '', productKey: firebaseSafeKey(item), name: item, qty: 1, unit: 'ud', unitPrice: amount, amount, totalPrice: amount, price: amount, mealType, cuisine, place, healthy: cuisine }] : []), filters: { mealType: mealType || '', cuisine: cuisine || '', place: place || '', healthy: cuisine || '' } }
        : undefined;
      if (ticketDataFromDraft?.schema === 'TICKET_V1') {
        extras = {
          ...(extras || {}),
          ticketData: ticketDataFromDraft,
          ticketScanMeta: ticketScanMetaFromDraft || {
            vendor: String(ticketDataFromDraft?.source?.vendor || 'unknown'),
            parsedAt: nowTs(),
          },
        };
      }
      if (effectiveRecurringId) {
        extras = mergeRecurringTemplateExtras(linkedRecurringTemplate?.extras, extras);
      }

      const nextPersonalRatio = (type === 'transfer' || personalRatioMode !== 'custom')
        ? null
        : clamp01(personalRatioPercent / 100, 1);

      if (!txId && effectiveRecurringId) {
        const duplicate = findRecurringInstanceTx(effectiveRecurringId, recurringMonthKey, balanceTxList(), linkedRecurringTemplate);
        if (duplicate) prev = duplicate;
      }
      const saveId = txId || prev?.id || push(ref(db, `${state.financePath}/transactions`)).key;
      const writeTs = nowTs();
      const scheduledRecurringDateISO = effectiveRecurringId
        ? (toIsoDay(String(form.get('recurringDueDateISO') || ''))
          || resolveRecurringScheduledDateISO(linkedRecurringTemplate || { schedule: { dayOfMonth: recurringDay } }, recurringMonthKey)
          || dateISO)
        : '';
      const payload = {
        type,
        amount,
        date: dateISO,
        monthKey: dateISO.slice(0, 7),
        accountId: type === 'transfer' ? '' : accountId,
        fromAccountId: type === 'transfer' ? fromAccountId : '',
        toAccountId: type === 'transfer' ? toAccountId : '',
        category,
        note,
        ...(Number.isFinite(nextPersonalRatio) ? { personalRatio: nextPersonalRatio } : {}),
        linkedHabitId,
        allocation,
        ...(effectiveRecurringId ? {
          recurringId: effectiveRecurringId,
          recurringMonthKey,
          recurringDueDateISO: scheduledRecurringDateISO,
        } : {}),
        extras: extras || null,
        updatedAt: writeTs,
        createdAt: Number(prev?.createdAt || 0) || writeTs
      };
      const canonicalTxPath = `${state.financePath}/transactions/${saveId}`;
      const legacySourcePath = prev?.__path && prev.__path !== canonicalTxPath ? String(prev.__path) : '';
      console.log('[FINANCE][BALANCE] save transaction', canonicalTxPath);
      if (window?.BOOKSHELL_DEV || window?.localStorage?.getItem('bookshell_debug_expense_payload') === '1') {
        console.log('[FINANCE][DEBUG] expense payload', payload);
      }
      if (legacySourcePath) {
        financeDebug('migrating edited legacy transaction', { txId: saveId, from: legacySourcePath, to: canonicalTxPath });
      }
      const recurringPayload = requestedRecurringTemplateUpdate && effectiveRecurringId
        ? {
          ...(linkedRecurringTemplate && typeof linkedRecurringTemplate === 'object' ? linkedRecurringTemplate : {}),
          type,
          amount,
          accountId: type === 'transfer' ? '' : accountId,
          fromAccountId: type === 'transfer' ? fromAccountId : '',
          toAccountId: type === 'transfer' ? toAccountId : '',
          category,
          note,
          ...(Number.isFinite(nextPersonalRatio) ? { personalRatio: nextPersonalRatio } : {}),
          linkedHabitId,
          allocation,
          extras: mergeRecurringTemplateExtras(linkedRecurringTemplate?.extras, extras) || null,
          schedule: { frequency: recurringFrequency, dayOfMonth: recurringDay, startDate: recurringStart, endDate: recurringEndRaw || '' },
          disabled: linkedRecurringTemplate?.disabled === true,
          autoCreate: linkedRecurringTemplate?.autoCreate !== false,
          updatedAt: writeTs,
          createdAt: Number(linkedRecurringTemplate?.createdAt || 0) || writeTs
        }
        : null;
      const rootUpdates = {
        [canonicalTxPath]: payload,
        ...(legacySourcePath ? { [legacySourcePath]: null } : {}),
        ...(type !== 'transfer' ? { [`${state.financePath}/catalog/categories/${category}`]: { name: category, lastUsedAt: writeTs } } : {}),
        ...(recurringPayload && effectiveRecurringId ? { [`${state.financePath}/recurring/${effectiveRecurringId}`]: recurringPayload } : {})
      };
      setMovementFormBusy(formEl, true);
      try {
        await update(ref(db), rootUpdates);
      } catch (error) {
        log('firebase error on movement save', error);
        toast('No se pudo guardar el movimiento');
        setMovementFormBusy(formEl, false);
        return;
      }
      if (extras?.items?.length) {
        try {
          await ensureFoodCatalogLoaded();
          for (const foodItem of extras.items) {
            const savedFoodId = await upsertFoodItem({
              id: foodItem.foodId || '',
              name: foodItem.name,
              mealType: foodItem.mealType || mealType,
              cuisine: foodItem.cuisine || cuisine,
              healthy: foodItem.healthy || foodItem.cuisine || cuisine,
              place: foodItem.place || place,
              defaultPrice: Number(foodItem.unitPrice || computeUnitPrice(foodItem.totalPrice || foodItem.amount || foodItem.price, foodItem.qty || 1) || amount)
            }, true, { lastCategory: category, lastAccountId: accountId, lastNote: note });
            foodItem.foodId = savedFoodId;
            await recordFoodPricePoint(savedFoodId, Number(foodItem.unitPrice || computeUnitPrice(foodItem.totalPrice || foodItem.amount || foodItem.price, foodItem.qty || 1) || amount), 'expense', {
              ts: dateISO ? parseDayKey(dateISO) : nowTs(),
              date: dateISO || dayKeyFromTs(nowTs()),
              vendor: foodItem.place || place || 'unknown',
              unitPrice: Number(foodItem.unitPrice || computeUnitPrice(foodItem.totalPrice || foodItem.amount || foodItem.price, foodItem.qty || 1) || amount),
              qty: Math.max(1, Number(foodItem.qty || 1)),
              unit: String(foodItem.unit || 'ud').trim() || 'ud',
              totalPrice: Number(foodItem.totalPrice || foodItem.amount || foodItem.price || amount),
              linePrice: Number(foodItem.totalPrice || foodItem.amount || foodItem.price || amount),
              expenseId: saveId
            });
            financeDebug('transaction food usage saved', { txId: saveId, foodId: savedFoodId, name: foodItem.name });
            if (foodItem.mealType || mealType) await upsertFoodOption('typeOfMeal', foodItem.mealType || mealType, true);
            if (foodItem.cuisine || cuisine) await upsertFoodOption('cuisine', foodItem.cuisine || cuisine, true);
            if (foodItem.place || place) await upsertFoodOption('place', foodItem.place || place, true);
          }
        } catch (error) {
          log('no se pudo sincronizar el catálogo de comida tras guardar el movimiento', error);
        }
      }
      const touched = new Set([payload.accountId, payload.fromAccountId, payload.toAccountId, prev?.accountId, prev?.fromAccountId, prev?.toAccountId].filter(Boolean));
      const recomputeStart = [dateISO, prev?.date, isoToDay(prev?.dateISO || '')].filter(Boolean).sort()[0] || dateISO;
      try {
        const freshRoot = await loadFinanceRoot();
        await Promise.all(Array.from(touched).map((account) => recomputeAccountEntries(account, recomputeStart, freshRoot)));
        const refreshedRoot = await loadFinanceRoot();
        syncLocalAccountsFromRoot(refreshedRoot);
      } catch (error) {
        log('no se pudieron recomputar cuentas tras guardar movimiento', error);
      }
      state.balance = state.balance || {};
      state.balance.transactions = {
        ...(state.balance.transactions || {}),
        [saveId]: payload
      };
      if (recurringPayload && effectiveRecurringId) {
        state.balance.recurring = {
          ...(state.balance.recurring || {}),
          [effectiveRecurringId]: recurringPayload
        };
      }
      if (type !== 'transfer') {
        state.balance.categories = {
          ...(state.balance.categories || {}),
          [category]: { name: category, lastUsedAt: writeTs }
        };
      }
      pruneLocalLegacyTxRows(saveId);
      clearFinanceDerivedCaches();
      scheduleAggregateRebuild();
      try { localStorage.setItem('bookshell_finance_lastMovementAccountId', accountId || fromAccountId || ''); } catch (_) {}
      state.lastMovementAccountId = accountId || fromAccountId || '';
      toast((txId || prev?.id) ? 'Movimiento actualizado' : 'Movimiento guardado');
      closeMovementModal();
      return;
    }
    if (event.target.matches('[data-budget-form]')) {
      event.preventDefault();
      const form = new FormData(event.target);
      const category = String(form.get('category') || '').trim();
      const limit = Number(form.get('limit') || 0);
      const monthKey = String(form.get('monthKey') || getSelectedBalanceMonthKey());
      if (!category || !monthKey || !Number.isFinite(limit)) { toast('Datos de presupuesto inválidos'); return; }
      const budgetId = state.modal.budgetId || push(ref(db, `${state.financePath}/budgets/${monthKey}`)).key;
      await safeFirebase(() => set(ref(db, `${state.financePath}/budgets/${monthKey}/${budgetId}`), { category, limit, createdAt: nowTs(), updatedAt: nowTs() }));
      state.modal = { type: null }; toast('Presupuesto guardado'); triggerRender(); return;
    }
    if (event.target.matches('[data-goal-form]')) {
      event.preventDefault();
      const form = new FormData(event.target);
      const existingGoalId = String(form.get('goalId') || '').trim();
      const existingGoal = existingGoalId ? (state.goals.goals?.[existingGoalId] || null) : null;
      const goalId = existingGoalId || push(ref(db, `${state.financePath}/goals/goals`)).key;
      const title = String(form.get('title') || '').trim();
      const targetAmount = parseMoney(String(form.get('targetAmount') || ''));
      const dueDate = toIsoDay(String(form.get('dueDateISO') || ''));
      const accountsIncluded = [...new Set(form.getAll('accountsIncluded').map((value) => String(value || '').trim()).filter(Boolean))];
      if (!title || !dueDate || !Number.isFinite(targetAmount) || targetAmount < 0) {
        toast('Datos de objetivo inválidos');
        return;
      }
      const payload = {
        ...(existingGoal && typeof existingGoal === 'object' ? existingGoal : {}),
        title,
        targetAmount,
        dueDateISO: `${dueDate}T00:00:00.000Z`,
        accountsIncluded,
        createdAt: Number(existingGoal?.createdAt || 0) || nowTs(),
        updatedAt: nowTs()
      };
      await safeFirebase(() => set(ref(db, `${state.financePath}/goals/goals/${goalId}`), payload));
      state.goals = {
        goals: {
          ...(state.goals?.goals || {}),
          [goalId]: payload
        }
      };
      state.modal = { type: null };
      toast(existingGoalId ? 'Objetivo actualizado' : 'Objetivo creado');
      triggerRender();
      return;
    }
    const goalAccountsId = event.target.dataset.goalAccountsForm;
    if (goalAccountsId) {
      event.preventDefault(); const ids = [...event.target.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      await safeFirebase(() => update(ref(db, `${state.financePath}/goals/goals/${goalAccountsId}`), { accountsIncluded: ids, updatedAt: nowTs() }));
      if (state.goals?.goals?.[goalAccountsId]) {
        state.goals = {
          goals: {
            ...(state.goals?.goals || {}),
            [goalAccountsId]: { ...state.goals.goals[goalAccountsId], accountsIncluded: ids, updatedAt: nowTs() }
          }
        };
      }
      state.modal = { type: null }; triggerRender();
    }
  }, evtOpts);

  view.addEventListener('search', (event) => {
    if (event.target.matches('[data-products-filter="productsQuery"]')) {
      applyProductsCatalogGlobalSearch(event.target);
      return;
    }
    if (event.target.matches('[data-products-catalog-search]')) {
      applyProductsCatalogGroupSearch(event.target);
    }
  }, evtOpts);

  view.addEventListener('toggle', (event) => {
    const foodDetails = event.target.closest('[data-section="food-extras"]');
    if (foodDetails?.open) {
      const form = foodDetails.closest('[data-balance-form]');
      if (form) void toggleFoodExtras(form);
    }
    const details = event.target.closest('[data-history-account]'); if (!details || !details.open) return;
    const accountId = details.dataset.historyAccount; const host = view.querySelector(`[data-history-rows="${accountId}"]`); if (!host || host.dataset.loaded === '1') return;
    const account = buildAccountModels().find((item) => item.id === accountId); host.dataset.loaded = '1';
    host.innerHTML = account?.daily?.length ? account.daily.slice().reverse().map((row) => `<div class="finance-history-row"><span>${new Date(row.ts).toLocaleDateString('es-ES')}</span><span>${fmtCurrency(row.value)}</span><span class="${toneClass(row.delta)}">${fmtSignedCurrency(row.delta)}</span><span class="${toneClass(row.deltaPct)}">${fmtSignedPercent(row.deltaPct)}</span></div>`).join('') : '<p class="finance-empty">Sin registros.</p>';
  }, { ...evtOpts, capture: true });
}

function financeDomReady() {
  return Boolean(resolveFinanceRoot() || $opt('#view-finance') || $opt('#tab-finance'));
}

async function boot() {
  if (state.booted) return;
  await ensureFinanceLoaded();
  if (!auth?.currentUser) {
    log('boot deferred: auth not ready yet');
    return;
  }
  if (!financeDomReady()) {
    log('boot deferred: finance DOM not ready yet');
    return;
  }
  state.booted = true;
  const financeRoot = resolveFinanceRoot($opt, $req);
  log('dom root resolved', {
    missingFinanceRootId: !$opt('#finance-root'),
    missingDataTabFinance: !$opt('[data-tab="finance"]'),
    missingLegacyContainerSelector: !$opt('#finance, #financeTab, .finance-tab, [data-view="finance"]'),
    resolvedRoot: financeRoot?.id || financeRoot?.className || financeRoot?.tagName || null,
  });
  state.deviceId = getDeviceId();
  console.log('[finance] deviceId', state.deviceId);
  const pathProbe = await probeFinanceRoots();
  financeRootsCache = { newRoot: pathProbe.newRoot, legacyRoot: pathProbe.legacyRoot };
  const rawPath = resolveFinancePath();
  state.financePath = await detectFinancePath(rawPath);
  console.log('[FINANCE] financePath resolved', { rawPath, financePath: state.financePath });
  log('init ok', { financePath: state.financePath });
  bindEvents();
  await loadDataOnce();
  await ensurePersonalRatioMigrationV1();
  subscribe();
  await render();
}

function bootFinance() {
  boot().catch((e) => {
    console.error('[finance] boot crashed', e);
    showFinanceBootError($opt, e);
  });
}


export async function init() {
  const financeStart = performance.now();
  await ensureFinanceLoaded();
  await boot();
  if (!state.booted && auth?.currentUser == null) {
    await new Promise((resolve) => {
      const stop = onUserChange((user) => {
        if (!user) return;
        try { stop?.(); } catch (_) {}
        resolve();
      });
    });
    await boot();
  }
  if (!state.firstInitDone) {
    state.firstInitDone = true;
    console.log('[perf] finance-first-open-ms', Math.round(performance.now() - financeStart));
  }
  console.log('[perf] listeners view-finance', getFinanceListenerCount());
}

export async function onShow() {
  requestAnimationFrame(() => {
    try { financeStatsDonutChart?.resize?.(); } catch (_) {}
  });
}

export function destroy() {
  if (state.unsubscribe) {
    state.unsubscribe();
    state.unsubscribe = null;
  }
  if (unsubscribeLegacyFinance) {
    unsubscribeLegacyFinance();
    unsubscribeLegacyFinance = null;
  }
  if (state.aggregateRebuildTimer) {
    clearTimeout(state.aggregateRebuildTimer);
    state.aggregateRebuildTimer = null;
  }
  if (state.toastTimer) {
    clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
  if (financeRemoteApplyTimer) {
    clearTimeout(financeRemoteApplyTimer);
    financeRemoteApplyTimer = 0;
  }
  if (state.eventsAbortController) {
    state.eventsAbortController.abort();
    state.eventsAbortController = null;
  }
  const view = document.getElementById('view-finance');
  if (view) delete view.dataset.financeBound;
  financeRenderQueued = false;
  financeRenderPromise = null;
  financePendingPreserveUi = true;
  clearFinanceDerivedCaches();
  state.booted = false;
  console.log('[finance] destroy completed');
  console.log('[perf] listeners view-finance', getFinanceListenerCount());
}

function getFinanceListenerCount() {
  let count = 0;
  if (state.unsubscribe) count += 1;
  if (state.eventsAbortController) count += 1;
  if (state.aggregateRebuildTimer) count += 1;
  if (state.toastTimer) count += 1;
  return count;
}
