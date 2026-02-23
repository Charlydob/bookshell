import { get, onValue, push, ref, remove, set, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';

const LEGACY_PATH = 'finance';
const DEVICE_KEY = 'finance_deviceId';
const RANGE_LABEL = { total: 'Total', month: 'Mes', week: 'Semana', year: 'Año' };

const state = {
  deviceId: '',
  financePath: '',
  rangeMode: 'month',
  compareMode: 'month',
  activeView: 'home',
  accounts: [],
  legacyEntries: {},
  balance: { tx: {}, movements: {}, transactions: {}, categories: {}, budgets: {}, snapshots: {}, defaultAccountId: '', lastSeenMonthKey: '' },
  goals: { goals: {} },
  modal: { type: null, accountId: null, goalId: null, budgetId: null, importRaw: '', importPreview: null, importError: '' },
  balanceFormState: {},
  toast: '',
  calendarMonthOffset: 0,
  calendarAccountId: 'total',
  calendarMode: 'day',
  balanceMonthOffset: 0,
  balanceFilterType: 'all',
  balanceFilterCategory: 'all',
  balanceAccountFilter: 'all',
  lastMovementAccountId: localStorage.getItem('bookshell_finance_lastMovementAccountId') || '',
  unsubscribe: null,
  saveTimers: {},
  food: {
    loaded: false,
    loading: false,
    options: { typeOfMeal: {}, cuisine: {}, place: {} },
    items: {}
  },
  hydratedFromRemote: false,
  error: '',
  booted: false
};

function log(...parts) { console.log('[finance]', ...parts); }
function warnMissing(id) { console.warn(`[finance] missing DOM node ${id}`); }
function $req(sel, ctx = document) {
  const el = ctx.querySelector(sel);
  if (!el) throw new Error(`[finance] Missing element: ${sel}`);
  return el;
}
function $opt(sel, ctx = document) { return ctx.querySelector(sel); }

function resolveFinanceRoot() {
  return $opt('#finance-root')
    || $opt('[data-tab="finance"]')
    || $opt('#finance, #financeTab, .finance-tab, [data-view="finance"]')
    || $opt('#tab-finance')
    || $opt('#view-finance');
}

function ensureFinanceHost() {
  const current = $opt('#finance-content');
  if (current) return current;
  const root = resolveFinanceRoot() || $req('#tab-finance, #view-finance');
  const host = document.createElement('div');
  host.id = 'finance-content';
  const mountTarget = $opt('#finance-main', root) || root;
  mountTarget.append(host);
  console.warn('[finance] #finance-content not found, created fallback container inside finance root');
  return host;
}

function showFinanceBootError(err) {
  const message = String(err?.message || err || 'Error desconocido');
  const host = $opt('#finance-content');
  if (host) host.innerHTML = `<article class="finance-panel"><h3>Error JS (BOOT)</h3><p>${escapeHtml(message)}</p></article>`;
  const overlay = $opt('#finance-modalOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    overlay.classList.add('is-open');
    overlay.setAttribute('aria-hidden', 'false');
    overlay.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true"><header><h3>Error JS (BOOT)</h3></header><p>${escapeHtml(message)}</p></div>`;
  }
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
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, (s) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[s])); }
function fmtCurrency(value) { return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value || 0)); }
function fmtSignedCurrency(value) { const num = Number(value || 0); return `${num > 0 ? '+' : ''}${fmtCurrency(num)}`; }
function fmtSignedPercent(value) { const num = Number(value || 0); return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`; }
function toneClass(value) { if (value > 0) return 'is-positive'; if (value < 0) return 'is-negative'; return 'is-neutral'; }
function dayKeyFromTs(ts) { const d = new Date(Number(ts || Date.now())); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function parseDayKey(key) { return new Date(`${key}T00:00:00`).getTime(); }
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
function clampRatio(value, fallback = 1) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return fallback;
  return Math.min(1, Math.max(0.1, ratio));
}
function normalizeAccountShare(account = {}) {
  const shared = Boolean(account.shared);
  const sharedRatio = shared ? clampRatio(account.sharedRatio, 0.5) : 1;
  return { shared, sharedRatio };
}
function movementSign(type) { return type === 'income' ? 1 : -1; }
function txSortTs(row) {
  return new Date(row?.date || row?.dateISO || 0).getTime() || 0;
}
function normalizeTxType(type = '') {
  const safe = String(type || '').trim().toLowerCase();
  if (safe === 'income' || safe === 'expense' || safe === 'transfer') return safe;
  if (safe === 'invest') return 'expense';
  return 'expense';
}
function isFoodCategory(category = '') {
  const normalized = String(category || '').trim().toLowerCase();
  return normalized === 'comida' || normalized === 'food';
}
function normalizeFoodName(value = '') {
  return String(value || '').trim().replace(/\s+/g, ' ');
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
      lastExtras: payload?.lastExtras || {}
    };
  });
  return out;
}
function foodOptionList(kind) {
  return Object.keys(state.food.options?.[kind] || {}).sort((a, b) => a.localeCompare(b, 'es', { sensitivity: 'base' }));
}
function foodItemsList() {
  return Object.entries(state.food.items || {}).map(([name, meta]) => ({
    name,
    count: Number(meta?.count || 0),
    lastUsedAt: Number(meta?.lastUsedAt || 0)
  }));
}
function topFoodItems(limit = 6) {
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
    state.food.loaded = true;
  } finally {
    state.food.loading = false;
  }
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
  const name = normalizeFoodName(value);
  if (!name) return '';
  const prev = state.food.items[name] || {};
  const payload = {
    createdAt: Number(prev.createdAt || 0) || nowTs(),
    count: Number(prev.count || 0) + (incrementCount ? 1 : 0),
    lastUsedAt: incrementCount ? nowTs() : Number(prev.lastUsedAt || 0),
    lastPrice: Number(patch.lastPrice ?? prev.lastPrice ?? 0),
    lastCategory: String(patch.lastCategory ?? prev.lastCategory ?? ''),
    lastExtras: patch.lastExtras || prev.lastExtras || {}
  };
  state.food.items[name] = payload;
  await safeFirebase(() => update(ref(db, `${state.financePath}/catalog/foodItems/${name}`), payload));
  return name;
}

function renderFoodOptionField(kind, label, selectName) {
  const options = foodOptionList(kind);
  return `<div class="food-extra-field" data-food-kind="${kind}"><label>${label}</label><div class="food-extra-row"><select name="${selectName}" data-food-select="${kind}"><option value="">Seleccionar (opcional)</option>${options.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('')}</select><button type="button" class="finance-pill finance-pill--mini" data-food-add="${kind}">+ añadir</button></div></div>`;
}

function renderFoodExtrasSection() {
  const topItems = topFoodItems(6);
  return `<section class="food-extra" data-food-extra hidden>
    <h4>Extras de comida</h4>
    ${renderFoodOptionField('typeOfMeal', 'Tipo de comida', 'foodMealType')}
    ${renderFoodOptionField('cuisine', 'Cocina', 'foodCuisine')}
    ${renderFoodOptionField('place', 'Lugar', 'foodPlace')}
    <div class="food-extra-field">
      <label>Producto / Plato</label>
      <div class="food-top-items" data-food-top>${topItems.map((item) => `<button type="button" class="finance-chip" data-food-top-item="${escapeHtml(item.name)}">${escapeHtml(item.name)} <small>×${item.count}</small></button>`).join('') || '<small class="finance-empty">Sin habituales aún.</small>'}</div>
      <input type="search" data-food-item-search placeholder="Buscar plato (ej: pollo)" autocomplete="off" />
      <div class="food-search-list" data-food-item-results></div>
      <input type="hidden" name="foodItem" data-food-item-value />
    </div>
  </section>`;
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
async function recomputeAccountEntries(accountId, fromDay) {
  if (!accountId) return;
  const snap = await safeFirebase(() => get(ref(db, `${state.financePath}`)));
  const root = snap?.val() || {};
  const account = root.accounts?.[accountId] || state.accounts.find((item) => item.id === accountId);
  if (!account) return;
  const snapshots = normalizeSnapshots(account.snapshots || {});
  const txRows = balanceTxList().filter((row) => (
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
  console.log('[FINANCE][BALANCE] recompute balances', { accountId, fromDay: startDay, txCount: movements.length });
  const dayMovementNet = {};
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
    dayMovementNet[day] = (dayMovementNet[day] || 0) + delta;
  });
  const snapshotByDay = Object.fromEntries(snapshots.map((row) => [row.day, row]));
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
    let source = 'derived';
    if (snapshotByDay[day]) {
      value = snapshotByDay[day].value;
      source = 'snapshot';
    } else {
      // Consolidación diaria: sin snapshot manual, el cierre deriva del día previo + neto de movimientos.
      value = carry + Number(dayMovementNet[day] || 0);
    }
    carry = value;
    updatesMap[`${state.financePath}/accounts/${accountId}/entries/${day}`] = { dateISO: `${day}T00:00:00.000Z`, value, updatedAt: nowTs(), source };
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

function buildAccountModels() {
  return state.accounts.map((account) => {
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
    const daily = dailyReal.map((point, index, arr) => {
      const prev = arr[index - 1];
      const myValue = point.value * share.sharedRatio;
      const prevValue = prev ? prev.value * share.sharedRatio : 0;
      const delta = prev ? myValue - prevValue : 0;
      const deltaPct = prevValue ? (delta / prevValue) * 100 : 0;
      return { ...point, value: myValue, realValue: point.value, delta, deltaPct };
    });
    const currentReal = dailyReal.at(-1)?.value ?? 0;
    const current = currentReal * share.sharedRatio;
    const range = computeDeltaForRange(daily, state.rangeMode);
    if (share.shared) log(`account sharedRatio=${share.sharedRatio} applied`, { accountId: account.id });
    return { ...account, ...share, daily, dailyReal, current, currentReal, range };
  });
}
function buildTotalSeries(accounts) {
  const daySet = new Set();
  accounts.forEach((account) => account.daily.forEach((point) => daySet.add(point.day)));
  const days = [...daySet].sort();
  if (!days.length) return [];
  const perAccount = Object.fromEntries(accounts.map((account) => [account.id, Object.fromEntries(account.daily.map((p) => [p.day, p.value]))]));
  const running = Object.fromEntries(accounts.map((account) => [account.id, 0]));
  return days.map((day) => {
    accounts.forEach((account) => { if (perAccount[account.id][day] != null) running[account.id] = perAccount[account.id][day]; });
    return { day, ts: parseDayKey(day), value: Object.values(running).reduce((sum, val) => sum + Number(val || 0), 0) };
  });
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
function linePath(points, width = 320, height = 120) {
  if (!points.length) return '';
  const vals = points.map((point) => point.value); const min = Math.min(...vals); const max = Math.max(...vals); const spread = max - min || 1;
  return points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width;
    const y = height - ((point.value - min) / spread) * height;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
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
  const fromNew = Object.entries(state.balance.transactions || {}).map(([id, row]) => ({
    id,
    ...row,
    amount: Number(row?.amount || 0),
    type: normalizeTxType(row?.type),
    date: String(row?.date || isoToDay(row?.dateISO || '') || ''),
    monthKey: String(row?.monthKey || String(row?.date || isoToDay(row?.dateISO || '') || '').slice(0, 7))
  }));
  const fromLegacy = [];
  Object.entries(state.balance.movements || {}).forEach(([monthKey, rows]) => {
    Object.entries(rows || {}).forEach(([id, row]) => {
      fromLegacy.push({
        id,
        ...row,
        type: normalizeTxType(row?.type),
        date: String(isoToDay(row?.dateISO || row?.date || '')),
        monthKey: row?.monthKey || monthKey,
        amount: Number(row?.amount || 0),
        accountId: String(row?.accountId || '')
      });
    });
  });
  const legacyTx = Object.entries(state.balance.tx || {}).map(([id, row]) => ({
    id,
    ...row,
    type: normalizeTxType(row?.type),
    date: String(row?.date || isoToDay(row?.dateISO || '')),
    monthKey: String(row?.monthKey || String(row?.date || isoToDay(row?.dateISO || '') || '').slice(0, 7)),
    amount: Number(row?.amount || 0)
  }));
  return [...fromNew, ...fromLegacy, ...legacyTx]
    .filter((row) => Number.isFinite(row.amount) && row.monthKey)
    .sort((a, b) => (txSortTs(b) - txSortTs(a)) || (Number(b.createdAt || 0) - Number(a.createdAt || 0)));
}
function getSelectedBalanceMonthKey() {
  return offsetMonthKey(getMonthKeyFromDate(), state.balanceMonthOffset);
}
function summaryForMonth(monthKey) {
  const rows = balanceTxList().filter((tx) => tx.monthKey === monthKey);
  const income = rows.filter((tx) => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0);
  const expense = rows.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0);
  return { income, expense, invest: 0, net: income - expense };
}

function monthlyNetRows() {
  const byMonth = {};
  balanceTxList().forEach((tx) => {
    if (!tx.monthKey) return;
    byMonth[tx.monthKey] = (byMonth[tx.monthKey] || 0) + (tx.type === 'income' ? tx.amount : -tx.amount);
  });
  return Object.entries(byMonth).map(([month, net]) => ({ month, net })).sort((a, b) => b.month.localeCompare(a.month));
}
function categoriesList() {
  const dynamic = Object.values(state.balance.categories || {}).map((row) => String(row?.name || '')).filter(Boolean);
  const fromTx = [...new Set(balanceTxList().map((tx) => tx.category).filter(Boolean))];
  return [...new Set([...dynamic, ...fromTx])].sort((a, b) => a.localeCompare(b, 'es'));
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
  const items = [['home', 'Principal'], ['balance', 'Balance'], ['goals', 'Objetivos'], ['calendar', 'Calendario']];
  nav.innerHTML = `<div class="financeInnerNav">${items.map(([id, label]) => `<button class="finance-pill ${state.activeView === id ? 'is-active' : ''}" data-finance-view="${id}">${label}</button>`).join('')}</div>`;
}

function renderFinanceHome(accounts, totalSeries) {
  console.group('[finance] renderFinanceHome');
  console.log('state:', JSON.stringify(state));
  console.log('root candidates:', {
    financeRoot: document.getElementById('finance-root'),
    tab: document.querySelector('[data-tab="finance"]'),
    container: document.querySelector('#finance, #financeTab, .finance-tab, [data-view="finance"]'),
  });
  console.groupEnd();

  const root = resolveFinanceRoot();
  if (!root) throw new Error('[finance] finance root not available before renderFinanceHome');
  if (!$opt('#finance-content')) ensureFinanceHost();

  const total = accounts.reduce((sum, account) => sum + account.current, 0);
  const totalReal = accounts.reduce((sum, account) => sum + Number(account.currentReal || 0), 0);
  const totalRange = computeDeltaForRange(totalSeries, state.rangeMode);
  const chart = chartModelForRange(totalSeries, state.rangeMode);
  const compareBounds = getRangeBounds(state.compareMode);
  const compareCurrent = computeDeltaWithinBounds(totalSeries, compareBounds);
  const previousBounds = { start: compareBounds.start - (compareBounds.end - compareBounds.start), end: compareBounds.start };
  const comparePrev = computeDeltaWithinBounds(totalSeries, previousBounds);
  return `
    <section class="finance-home ${toneClass(totalRange.delta)}">
      <article class="finance__hero"><p class="finance__eyebrow">TOTAL</p><h2 id="finance-totalValue">${fmtCurrency(total)}</h2>
        <p id="finance-totalDelta" class="${toneClass(totalRange.delta)}">${fmtSignedCurrency(totalRange.delta)} · ${fmtSignedPercent(totalRange.deltaPct)}</p>
        <p>Saldo real: <strong>${fmtCurrency(totalReal)}</strong> · Mi parte: <strong>${fmtCurrency(total)}</strong></p><div id="finance-lineChart" class="${chart.tone}">${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos para este rango.</div>'}</div></article>
      <article class="finance__controls">
        <select class="finance-pill" data-range><option value="total" ${state.rangeMode === 'total' ? 'selected' : ''}>Total</option><option value="month" ${state.rangeMode === 'month' ? 'selected' : ''}>Mes</option><option value="week" ${state.rangeMode === 'week' ? 'selected' : ''}>Semana</option><option value="year" ${state.rangeMode === 'year' ? 'selected' : ''}>Año</option></select>
        <button class="finance-pill" data-history>Historial</button>
        <select class="finance-pill" data-compare><option value="month" ${state.compareMode === 'month' ? 'selected' : ''}>Mes vs Mes</option><option value="week" ${state.compareMode === 'week' ? 'selected' : ''}>Semana vs Semana</option></select></article>
      <article class="finance__compareRow"><div class="finance-chip ${toneClass(compareCurrent.delta)}">Actual: ${fmtSignedCurrency(compareCurrent.delta)} (${fmtSignedPercent(compareCurrent.deltaPct)})</div><div class="finance-chip ${toneClass(comparePrev.delta)}">Anterior: ${fmtSignedCurrency(comparePrev.delta)} (${fmtSignedPercent(comparePrev.deltaPct)})</div></article>
      <article class="finance__accounts"><div class="finance__sectionHeader"><h2>Cuentas</h2><button class="finance-pill" data-new-account>+ Cuenta</button></div>
      <div id="finance-accountsList">${accounts.map((account) => `<article class="financeAccountCard ${toneClass(account.range.delta)}" data-open-detail="${account.id}"><div><strong>${escapeHtml(account.name)}</strong><div class="financeAccountCard__balanceWrap"><span class="financeAccountCard__balanceLabel">Mi saldo</span><input class="financeAccountCard__balance" data-account-input="${account.id}" value="${account.current.toFixed(2)}" inputmode="decimal" placeholder="" /><button class="finance-pill finance-pill--mini" data-account-save="${account.id}">Guardar</button></div>${account.shared ? `<small class="finance-shared-chip">Compartida ${(account.sharedRatio * 100).toFixed(0)}%</small>` : ''}</div><div class="financeAccountCard__side"><span class="financeAccountCard__deltaPill finance-chip ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]} ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span><button class="financeAccountCard__menuBtn" data-delete-account="${account.id}">⋯</button></div></article>`).join('') || '<p class="finance-empty">Sin cuentas todavía.</p>'}</div></article>
    </section>`;
}

function renderFinanceCalendar(accounts, totalSeries) {
  const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const dayCalendar = calendarData(accounts, totalSeries);
  const monthCalendar = calendarMonthData(accounts, totalSeries);
  const yearCalendar = calendarYearData(accounts, totalSeries);
  const modeLabel = state.calendarMode === 'month'
    ? `${monthCalendar.year}`
    : (state.calendarMode === 'year' ? 'Años' : monthLabelByKey(offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset)));
  let content = '';
  if (state.calendarMode === 'month') {
    content = `<div class="finance-calendar-months">${monthCalendar.months.map((point) => {
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-open-month="${point.monthKey}"><strong>${escapeHtml(point.label)}</strong><span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span><span>${point.isEmpty ? '—' : fmtSignedPercent(point.deltaPct)}</span></button>`;
    }).join('')}</div>`;
  } else if (state.calendarMode === 'year') {
    content = `<div class="finance-calendar-years">${yearCalendar.map((point) => {
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-open-year="${point.year}"><strong>${point.year}</strong><span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span></button>`;
    }).join('')}</div>`;
  } else {
    content = `<div class="finance-calendar-grid"><div class="finance-calendar-weekdays">${weekdayLabels.map((l) => `<span>${l}</span>`).join('')}</div><div class="finance-calendar-days">${dayCalendar.cells.map((point) => {
      if (!point) return '<div class="financeCalCell financeCalCell--blank"></div>';
      const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
      return `<button class="financeCalCell ${tone}" data-calendar-day="${point.dayKey}"><strong>${point.dayNumber}</strong><span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span><span>${point.isEmpty ? '—' : fmtSignedPercent(point.deltaPct)}</span></button>`;
    }).join('')}</div></div>`;
  }
  return `<section class="finance-home"><article class="finance__calendarPreview"><div class="finance__sectionHeader"><h2>Calendario</h2><span class="finance-month-label">${modeLabel}</span></div>
  <div class="finance-calendar-controls"><button class="finance-pill" data-month-shift="-1">◀</button><select class="finance-pill" data-calendar-account><option value="total" ${state.calendarAccountId === 'total' ? 'selected' : ''}>Total</option>${accounts.map((a) => `<option value="${a.id}" ${state.calendarAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select><select class="finance-pill" data-calendar-mode><option value="day" ${state.calendarMode === 'day' ? 'selected' : ''}>Día</option><option value="month" ${state.calendarMode === 'month' ? 'selected' : ''}>Mes</option><option value="year" ${state.calendarMode === 'year' ? 'selected' : ''}>Año</option></select><button class="finance-pill" data-month-shift="1">▶</button></div>
  ${content}</article></section>`;
}

function renderFinanceBalance() {
  const monthKey = getSelectedBalanceMonthKey();
  const categories = categoriesList();
  const accounts = buildAccountModels();
  const tx = balanceTxList().filter((row) => row.monthKey === monthKey)
    .filter((row) => state.balanceFilterType === 'all' || row.type === state.balanceFilterType)
    .filter((row) => state.balanceFilterCategory === 'all' || row.category === state.balanceFilterCategory)
    .filter((row) => {
      if (state.balanceAccountFilter === 'all') return true;
      return row.accountId === state.balanceAccountFilter || row.fromAccountId === state.balanceAccountFilter || row.toAccountId === state.balanceAccountFilter;
    });
  const monthSummary = summaryForMonth(monthKey);
  const prevSummary = summaryForMonth(offsetMonthKey(monthKey, -1));
  const spentByCategory = {};
  balanceTxList().filter((row) => row.monthKey === monthKey && row.type === 'expense').forEach((row) => { spentByCategory[row.category || 'Sin categoría'] = (spentByCategory[row.category || 'Sin categoría'] || 0) + row.amount; });
  const totalSpent = Object.values(spentByCategory).reduce((sum, value) => sum + value, 0);
  const budgetItems = getBudgetItems(monthKey);
  const monthNetList = monthlyNetRows();
  const bestMonth = monthNetList.reduce((best, row) => (!best || row.net > best.net ? row : best), null);
  const worstMonth = monthNetList.reduce((worst, row) => (!worst || row.net < worst.net ? row : worst), null);
  const avgNet = monthNetList.length ? monthNetList.reduce((sum, row) => sum + row.net, 0) / monthNetList.length : 0;
  const accountName = (id) => escapeHtml(accounts.find((a) => a.id === id)?.name || 'Sin cuenta');
  return `<section class="financeBalanceView"><header class="financeViewHeader"><h2>Balance</h2><button class="finance-pill" data-open-modal="tx">+ Añadir</button></header>
  <article class="financeGlassCard"><div class="finance-row"><button class="finance-pill" data-balance-month="-1">◀</button><strong>${monthLabelByKey(monthKey)}</strong><button class="finance-pill" data-balance-month="1">▶</button></div>
  <div class="financeSummaryGrid"><div><small>Ingresos</small><strong class="is-positive">${fmtCurrency(monthSummary.income)}</strong></div><div><small>Gastos</small><strong class="is-negative">${fmtCurrency(monthSummary.expense)}</strong></div><div><small>Neto</small><strong class="${toneClass(monthSummary.net)}">${fmtCurrency(monthSummary.net)}</strong></div><div><small>Mes anterior</small><strong class="${toneClass(prevSummary.net)}">${fmtCurrency(prevSummary.net)}</strong></div></div>
  <div class="finance-chip ${toneClass(prevSummary.net)}">Mes anterior: ${fmtSignedCurrency(prevSummary.net)}</div></article>
  <article class="financeGlassCard">
  <div class="finance-row"><h3>Transacciones</h3><div class="finance-row"><select class="finance-pill" data-balance-type><option value="all">Todos</option><option value="expense" ${state.balanceFilterType === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${state.balanceFilterType === 'income' ? 'selected' : ''}>Ingreso</option><option value="transfer" ${state.balanceFilterType === 'transfer' ? 'selected' : ''}>Transferencia</option></select><select class="finance-pill" data-balance-category><option value="all">Todas</option>${categories.map((c) => `<option ${state.balanceFilterCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select><select class="finance-pill" data-balance-account><option value="all">Todas las cuentas</option>${accounts.map((a) => `<option value="${a.id}" ${state.balanceAccountFilter === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div></div>
  <div class="financeTxList financeTxList--scroll" style="max-height:260px;overflow-y:auto;">${tx.slice(0, 5).map((row) => {
    const accountText = row.type === 'transfer'
      ? `${accountName(row.fromAccountId)} → ${accountName(row.toAccountId)}`
      : accountName(row.accountId);
    return `<div class="financeTxRow"><span>${new Date(row.date || row.dateISO).toLocaleDateString('es-ES')}</span><span>${escapeHtml(row.note || row.category || '—')} · ${accountText}</span><strong class="${row.type === 'income' ? 'is-positive' : 'is-negative'}">${row.type === 'transfer' ? fmtCurrency(row.amount) : fmtCurrency(row.amount)}</strong><span class="finance-row"><button class="finance-pill finance-pill--mini" data-tx-edit="${row.id}">✏️</button><button class="finance-pill finance-pill--mini" data-tx-delete="${row.id}">❌</button></span></div>`;
  }).join('') || '<p class="finance-empty">Sin movimientos en este mes.</p>'}${tx.length > 5 ? tx.slice(5).map((row) => {
    const accountText = row.type === 'transfer' ? `${accountName(row.fromAccountId)} → ${accountName(row.toAccountId)}` : accountName(row.accountId);
    return `<div class="financeTxRow"><span>${new Date(row.date || row.dateISO).toLocaleDateString('es-ES')}</span><span>${escapeHtml(row.note || row.category || '—')} · ${accountText}</span><strong class="${row.type === 'income' ? 'is-positive' : 'is-negative'}">${fmtCurrency(row.amount)}</strong><span class="finance-row"><button class="finance-pill finance-pill--mini" data-tx-edit="${row.id}">✏️</button><button class="finance-pill finance-pill--mini" data-tx-delete="${row.id}">❌</button></span></div>`;
  }).join('') : ''}</div></article>
  <article class="financeGlassCard"><div class="finance-row"><h3>Presupuestos</h3><button class="finance-pill" data-open-modal="budget">+ Presupuesto</button></div>
  <div class="financeBudgetList">${budgetItems.length ? budgetItems.map((budget) => {
    const spent = budget.category.toLowerCase() === 'total' ? totalSpent : Number(spentByCategory[budget.category] || 0);
    const limit = Number(budget.limit || 0);
    const pct = limit ? (spent / limit) * 100 : 0;
    return `<div class="financeBudgetRow"><div class="finance-row"><span>${escapeHtml(budget.category)}</span><div class="finance-row"><button class="finance-pill finance-pill--mini" data-budget-menu="${budget.id}">✏️</button><button class="finance-pill finance-pill--mini" data-budget-delete="${budget.id}">❌</button></div></div><small>${fmtCurrency(spent)} / ${fmtCurrency(limit)} (${pct.toFixed(0)}%)</small></div>`;
  }).join('') : '<p class="finance-empty">Sin presupuestos.</p>'}</div></article>
  <article class="financeGlassCard"><h3>Balance neto por mes</h3><div class="financeSummaryGrid"><div><small>Mejor mes</small><strong class="is-positive">${bestMonth ? `${bestMonth.month} · ${fmtCurrency(bestMonth.net)}` : '—'}</strong></div><div><small>Peor mes</small><strong class="is-negative">${worstMonth ? `${worstMonth.month} · ${fmtCurrency(worstMonth.net)}` : '—'}</strong></div><div><small>Media mensual</small><strong class="${toneClass(avgNet)}">${monthNetList.length ? fmtCurrency(avgNet) : '—'}</strong></div></div><div class="financeTxList" style="max-height:220px;overflow-y:auto;">${monthNetList.map((row) => `<div class="financeTxRow"><span>${row.month}</span><strong class="${toneClass(row.net)}">${fmtSignedCurrency(row.net)}</strong></div>`).join('') || '<p class="finance-empty">Sin meses con movimientos.</p>'}</div></article></section>`;
}

function renderModal() {
  const backdrop = document.getElementById('finance-modalOverlay');
  if (!backdrop) return;
  const categories = categoriesList();
  const accounts = buildAccountModels();
  if (!state.modal.type) {
    backdrop.classList.remove('is-open'); backdrop.classList.add('hidden'); backdrop.setAttribute('aria-hidden', 'true'); backdrop.innerHTML = ''; document.body.classList.remove('finance-modal-open'); return;
  }
  backdrop.classList.add('is-open'); backdrop.classList.remove('hidden'); backdrop.setAttribute('aria-hidden', 'false'); document.body.classList.add('finance-modal-open');
  if (state.modal.type === 'account-detail') {
    const account = accounts.find((item) => item.id === state.modal.accountId);
    if (!account) { state.modal = { type: null }; triggerRender(); return; }
    const chart = chartModelForRange(account.daily, 'total');
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
if (state.modal.type === 'tx') {
  const accountsById = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const txEdit = state.modal.txId ? balanceTxList().find((row) => row.id === state.modal.txId) : null;
  const defaultAccountId = txEdit?.accountId || state.lastMovementAccountId || state.balance.defaultAccountId || accounts[0]?.id || '';
  const defaultType = txEdit?.type || state.balanceFormState.type || 'expense';
  const defaultCategory = txEdit?.category || state.balanceFormState.category || '';
  const defaultDate = txEdit?.date || isoToDay(txEdit?.dateISO || '') || dayKeyFromTs(Date.now());
  const defaultAmount = txEdit?.amount || state.balanceFormState.amount || '';
  const defaultNote = txEdit?.note || state.balanceFormState.note || '';
  const defaultFrom = txEdit?.fromAccountId || state.balanceFormState.fromAccountId || defaultAccountId;
  const defaultTo = txEdit?.toAccountId || state.balanceFormState.toAccountId || accounts[1]?.id || accounts[0]?.id || '';
  const accountOptions = accounts.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`).join('');
  const categories = categoriesList();
  backdrop.innerHTML = `<div id="finance-modal" class="finance-modal fm-modal" role="dialog" aria-modal="true" tabindex="-1">
    <header class="fm-modal__header"><h3 class="fm-modal__title">${txEdit ? 'Editar movimiento' : 'Añadir movimiento'}</h3><button class="finance-pill fm-modal__close" type="button" data-close-modal>Cerrar</button></header>
    <form class="finance-entry-form finance-tx-form fm-form" data-balance-form>
      <input type="hidden" name="txId" value="${escapeHtml(txEdit?.id || '')}" />
      <div class="fm-grid fm-grid--top">
        <div class="fm-field fm-field--type"><label class="fm-label" for="fm-tx-type">Tipo</label><select id="fm-tx-type" name="type" class="finance-pill fm-control fm-control--select" data-tx-type><option value="expense" ${defaultType === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${defaultType === 'income' ? 'selected' : ''}>Ingreso</option><option value="transfer" ${defaultType === 'transfer' ? 'selected' : ''}>Transferencia</option></select></div>
        <div class="fm-field fm-field--amount"><label class="fm-label" for="fm-tx-amount">Cantidad</label><input id="fm-tx-amount" class="fm-control fm-control--amount" required name="amount" type="number" step="0.01" placeholder="Cantidad €" value="${escapeHtml(defaultAmount)}"/></div>
        <div class="fm-field fm-field--date"><label class="fm-label" for="fm-tx-date">Fecha</label><input id="fm-tx-date" class="fm-control fm-control--date" name="dateISO" type="date" value="${defaultDate}"/></div>
        <div class="fm-field fm-field--account" data-tx-account-single><label class="fm-label" for="fm-tx-account">Cuenta</label><select id="fm-tx-account" class="fm-control fm-control--account fm-control--select" name="accountId"><option value="">Selecciona cuenta</option>${accountOptions}</select></div>
        <div class="fm-field fm-field--account" data-tx-account-from hidden><label class="fm-label" for="fm-tx-account-from">Cuenta origen</label><select id="fm-tx-account-from" class="fm-control fm-control--account fm-control--select" name="fromAccountId"><option value="">Selecciona cuenta</option>${accountOptions}</select></div>
        <div class="fm-field fm-field--account" data-tx-account-to hidden><label class="fm-label" for="fm-tx-account-to">Cuenta destino</label><select id="fm-tx-account-to" class="fm-control fm-control--account fm-control--select" name="toAccountId"><option value="">Selecciona cuenta</option>${accountOptions}</select></div>
      </div>
      <div class="fm-grid fm-grid--meta">
        <div class="fm-field fm-field--category"><label class="fm-label" for="fm-tx-category">Categoría</label><input id="fm-tx-category" class="fm-control fm-control--category" name="category" list="fm-tx-cat-list" placeholder="Categoría" autocomplete="off" value="${escapeHtml(defaultCategory)}"/><datalist id="fm-tx-cat-list">${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist><button type="button" class="finance-pill finance-pill--mini" data-category-create hidden>+ crear</button></div>
        <div class="fm-field fm-field--note"><label class="fm-label" for="fm-tx-note">Nota</label><input id="fm-tx-note" class="fm-control fm-control--note" name="note" type="text" placeholder="Nota (opcional)" value="${escapeHtml(defaultNote)}"/></div>
      </div>
      <details class="fm-details fm-details--extras" data-section="food-extras"><summary class="fm-details__summary"><span class="fm-details__title">Extras</span><span class="fm-details__hint">Opcional</span><span class="fm-details__chev" aria-hidden="true">⌄</span></summary><div class="fm-details__body">${renderFoodExtrasSection()}</div></details>
      <div class="fm-actions"><button class="finance-pill fm-action fm-action--submit" type="submit">${txEdit ? 'Guardar cambios' : 'Añadir movimiento'}</button></div>
    </form>
  </div>`;
  const form = backdrop.querySelector('[data-balance-form]');
  if (form) {
    form.querySelector('select[name="accountId"]').value = defaultAccountId;
    form.querySelector('select[name="fromAccountId"]').value = defaultFrom;
    form.querySelector('select[name="toAccountId"]').value = defaultTo;
    if (txEdit?.extras || txEdit?.food) {
      const extras = txEdit.extras || txEdit.food;
      const refs = getFoodFormRefs(form);
      if (refs.mealType) refs.mealType.value = extras.mealType || extras.foodType || '';
      if (refs.cuisine) refs.cuisine.value = extras.cuisine || '';
      if (refs.place) refs.place.value = extras.place || '';
      if (refs.itemSearch) refs.itemSearch.value = extras.item || extras.productName || '';
      if (refs.itemValue) refs.itemValue.value = extras.item || extras.productName || '';
    }
    syncTxTypeFields(form);
    toggleFoodExtras(form);
    maybeToggleCategoryCreate(form);
  }
  return;
}
  if (state.modal.type === 'calendar-day-edit') {
    const day = String(state.modal.day || '').trim();
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Editar saldos · ${escapeHtml(day)}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <form data-calendar-day-form="${escapeHtml(day)}">${accounts.map((account) => `<label>${escapeHtml(account.name)}<input name="acc_${account.id}" type="number" step="0.01" value="${accountValueForDay(account, day)}" /></label>`).join('') || '<p class="finance-empty">No hay cuentas.</p>'}<button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'budget') {
    const monthKey = getSelectedBalanceMonthKey();
    const budget = state.modal.budgetId ? getBudgetItems(monthKey).find((item) => item.id === state.modal.budgetId) : null;
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>${budget ? 'Editar' : 'Nuevo'} presupuesto (${monthKey})</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <form class="finance-budget-form" data-budget-form><input name="category" list="finance-cat-list" value="${escapeHtml(budget?.category || '')}" placeholder="Categoría o Total" required /><datalist id="finance-cat-list"><option value="Total"></option>${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist><input name="limit" type="number" step="0.01" value="${Number(budget?.limit || 0)}" placeholder="Límite €" required /><input name="monthKey" type="month" value="${monthKey}" required /><button class="finance-pill" type="submit">Guardar</button>${budget ? `<button class="finance-pill" type="button" data-budget-delete="${budget.id}">Eliminar</button>` : ''}</form></div>`;
    return;
  }
  if (state.modal.type === 'goal') {
    const accountsOptions = accounts.map((a) => `<label><input type="checkbox" name="accountsIncluded" value="${a.id}" /> ${escapeHtml(a.name)}</label>`).join('');
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Nuevo objetivo</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
    <form class="finance-goal-form" data-goal-form><input name="title" required placeholder="Título" /><input name="targetAmount" required type="number" step="0.01" placeholder="Cantidad objetivo"/><input name="dueDateISO" required type="date" /><fieldset><legend>Cuentas incluidas</legend>${accountsOptions || '<p class="finance-empty">No hay cuentas.</p>'}</fieldset><button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'goal-detail') {
    const goal = state.goals.goals?.[state.modal.goalId]; if (!goal) { state.modal = { type: null }; triggerRender(); return; }
    const selected = new Set(goal.accountsIncluded || []);
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>${escapeHtml(goal.title)}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <p>Meta ${fmtCurrency(goal.targetAmount)} · vence ${new Date(goal.dueDateISO).toLocaleDateString('es-ES')}</p><p>Prioridad por (dinero / días).</p>
      <form data-goal-accounts-form="${state.modal.goalId}">${accounts.map((a) => `<label><input type="checkbox" value="${a.id}" ${selected.has(a.id) ? 'checked' : ''}/> ${escapeHtml(a.name)}</label>`).join('')}<button class="finance-pill" type="submit">Actualizar cuentas</button></form></div>`;
    return;
  }

  if (state.modal.type === 'history') {
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Historial</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><div class="finance-history-list">${accounts.map((account) => `<details class="finance-history-item" data-history-account="${account.id}"><summary><strong>${escapeHtml(account.name)}</strong><small>${account.daily.length} registros · ${fmtCurrency(account.current)}</small></summary><div class="finance-history-rows" data-history-rows="${account.id}"><p class="finance-empty">Pulsa para cargar…</p></div></details>`).join('') || '<p class="finance-empty">Sin historial.</p>'}</div></div>`;
    return;
  }
  if (state.modal.type === 'edit-account') {
    const account = accounts.find((item) => item.id === state.modal.accountId);
    if (!account) { state.modal = { type: null }; triggerRender(); return; }
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Editar cuenta</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><form class="finance-entry-form" data-edit-account-form="${account.id}"><input type="text" name="name" value="${escapeHtml(account.name)}" required /><label><input type="checkbox" name="shared" ${account.shared ? 'checked' : ''} /> Cuenta compartida</label><select name="sharedRatio"><option value="0.5" ${(account.sharedRatio === 0.5) ? 'selected' : ''}>50%</option><option value="1" ${(account.sharedRatio === 1) ? 'selected' : ''}>100%</option></select><button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'new-account') {
    backdrop.innerHTML = 
    `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header>
    <h3>Nueva cuenta</h3>
    <button class="finance-pill" data-close-modal>❌</button></header>
    <form class="finance-entry-form" id="modal-cuenta-nueva" data-new-account-form><input type="text" name="name" data-account-name-input placeholder="Nombre de la cuenta" required /><label><input type="checkbox" name="shared" /> 🫂</label><select name="sharedRatio"><option value="0.5">50%</option><option value="1">100%</option></select><button class="finance-pill" type="submit">Crear</button></form></div>`;
    return;
  }
}

function getFoodFormRefs(form) {
  if (!form) return {};
  return {
    extra: form.querySelector('[data-food-extra]'),
    category: form.querySelector('input[name="category"]'),
    mealType: form.querySelector('select[name="foodMealType"]'),
    cuisine: form.querySelector('select[name="foodCuisine"]'),
    place: form.querySelector('select[name="foodPlace"]'),
    itemSearch: form.querySelector('[data-food-item-search]'),
    itemValue: form.querySelector('[data-food-item-value]'),
    itemResults: form.querySelector('[data-food-item-results]')
  };
}

function clearFoodFormState(form) {
  const refs = getFoodFormRefs(form);
  if (refs.mealType) refs.mealType.value = '';
  if (refs.cuisine) refs.cuisine.value = '';
  if (refs.place) refs.place.value = '';
  if (refs.itemSearch) refs.itemSearch.value = '';
  if (refs.itemValue) refs.itemValue.value = '';
  if (refs.itemResults) refs.itemResults.innerHTML = '';
}

function renderFoodItemSearchResults(form) {
  const refs = getFoodFormRefs(form);
  if (!refs.itemResults) return;
  const query = normalizeFoodName(refs.itemSearch?.value || '').toLowerCase();
  const all = foodItemsList();
  const filtered = query ? all.filter((row) => row.name.toLowerCase().includes(query)) : all;
  const rows = filtered.slice(0, 8).map((row) => `<button type="button" class="food-result" data-food-item-select="${escapeHtml(row.name)}">${escapeHtml(row.name)} <small>×${row.count}</small></button>`);
  const canCreate = query && !all.some((row) => row.name.toLowerCase() === query);
  if (canCreate) rows.push(`<button type="button" class="food-result food-result--create" data-food-item-create="${escapeHtml(refs.itemSearch?.value || '')}">Crear “${escapeHtml(refs.itemSearch?.value || '')}”</button>`);
  refs.itemResults.innerHTML = rows.join('') || '<small class="finance-empty">Sin resultados.</small>';
}

function refreshFoodTopItems(form) {
  const host = form?.querySelector('[data-food-top]');
  if (!host) return;
  const topItems = topFoodItems(6);
  host.innerHTML = topItems.map((item) => `<button type="button" class="finance-chip" data-food-top-item="${escapeHtml(item.name)}">${escapeHtml(item.name)} <small>×${item.count}</small></button>`).join('') || '<small class="finance-empty">Sin habituales aún.</small>';
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

async function toggleFoodExtras(form) {
  const refs = getFoodFormRefs(form);
  if (!refs.extra || !refs.category) return;
  const isFood = isFoodCategory(refs.category.value);
  refs.extra.hidden = !isFood;
  if (!isFood) {
    clearFoodFormState(form);
    return;
  }
  await loadFoodCatalog();
  await syncFoodOptionsInForm(form);
}


function syncTxTypeFields(form) {
  if (!form) return;
  const type = form.querySelector('[data-tx-type]')?.value || 'expense';
  const single = form.querySelector('[data-tx-account-single]');
  const from = form.querySelector('[data-tx-account-from]');
  const to = form.querySelector('[data-tx-account-to]');
  if (single) single.hidden = type === 'transfer';
  if (from) from.hidden = type !== 'transfer';
  if (to) to.hidden = type !== 'transfer';
}

function maybeToggleCategoryCreate(form) {
  const input = form?.querySelector('input[name="category"]');
  const btn = form?.querySelector('[data-category-create]');
  if (!input || !btn) return;
  const value = String(input.value || '').trim();
  const exists = categoriesList().some((row) => row.toLowerCase() === value.toLowerCase());
  btn.hidden = !value || exists;
  btn.textContent = `+ crear "${value}"`;
}

function persistBalanceFormState(form) {
  if (!form) return;
  const fd = new FormData(form);
  state.balanceFormState = {
    type: String(fd.get('type') || ''),
    amount: String(fd.get('amount') || ''),
    dateISO: String(fd.get('dateISO') || ''),
    accountId: String(fd.get('accountId') || ''),
    fromAccountId: String(fd.get('fromAccountId') || ''),
    toAccountId: String(fd.get('toAccountId') || ''),
    category: String(fd.get('category') || ''),
    note: String(fd.get('note') || ''),
    foodMealType: String(fd.get('foodMealType') || ''),
    foodCuisine: String(fd.get('foodCuisine') || ''),
    foodPlace: String(fd.get('foodPlace') || ''),
    foodItem: String(fd.get('foodItem') || '')
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

function applyRemoteData(val = {}, replace = false) {
  const root = val && typeof val === 'object' ? val : {};
  const accountsMap = root.accounts || (replace ? {} : Object.fromEntries(state.accounts.map((acc) => [acc.id, acc])));
  const fallbackEntries = replace ? {} : state.legacyEntries;
  state.accounts = Object.values(accountsMap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.legacyEntries = root.accountsEntries || root.entries || fallbackEntries;
  state.balance = {
    tx: root.balance?.tx || (replace ? {} : state.balance.tx),
    movements: root.movements || (replace ? {} : state.balance.movements),
    transactions: root.transactions || (replace ? {} : state.balance.transactions),
    categories: root.catalog?.categories || root.balance?.categories || (replace ? {} : state.balance.categories),
    budgets: root.budgets || root.balance?.budgets || (replace ? {} : state.balance.budgets),
    snapshots: root.balance?.snapshots || (replace ? {} : state.balance.snapshots),
    defaultAccountId: root.balance?.defaultAccountId || (replace ? '' : state.balance.defaultAccountId),
    lastSeenMonthKey: root.balance?.lastSeenMonthKey || (replace ? '' : state.balance.lastSeenMonthKey)
  };
  state.goals = { goals: root.goals?.goals || (replace ? {} : state.goals.goals) };
}

async function loadDataOnce() {
  console.log('[FINANCE][BALANCE] load from firebase', state.financePath);
  const snap = await safeFirebase(() => get(ref(db, state.financePath)));
  const val = snap?.val();
  if (val && typeof val === 'object') applyRemoteData(val, true);
  else applyRemoteData({}, true);
  const legacySnap = await safeFirebase(() => get(ref(db, LEGACY_PATH)));
  if (!state.accounts.length && legacySnap?.exists()) {
    const fallback = legacySnap.val() || {};
    const fallbackAccounts = Object.values(fallback.accounts || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    if (fallbackAccounts.length) {
      state.accounts = fallbackAccounts;
      state.legacyEntries = fallback.accountsEntries || fallback.entries || {};
    }
  }
  state.hydratedFromRemote = true;
  log('loaded accounts:', state.accounts.length);
}

function subscribe() {
  if (state.unsubscribe) state.unsubscribe();
  console.log('[FINANCE][BALANCE] subscribe firebase', state.financePath);
  state.unsubscribe = onValue(ref(db, state.financePath), (snap) => {
    const val = snap.val();
    if (!val && state.hydratedFromRemote) {
      triggerRender();
      return;
    }
    applyRemoteData(val || {}, false);
    state.hydratedFromRemote = true;
    triggerRender();
  }, (error) => { state.error = String(error?.message || error); triggerRender(); });
}

async function addAccount({ name, shared = false, sharedRatio = 0.5 }) {
  const id = push(ref(db, `${state.financePath}/accounts`)).key;
  const ratio = shared ? clampRatio(sharedRatio, 0.5) : 1;
  await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${id}`), { id, name, shared, sharedRatio: ratio, createdAt: nowTs(), updatedAt: nowTs(), entries: {}, snapshots: {} }));
}
async function updateAccountMeta(accountId, payload = {}) {
  const shared = Boolean(payload.shared);
  const sharedRatio = shared ? clampRatio(payload.sharedRatio, 0.5) : 1;
  await safeFirebase(() => update(ref(db, `${state.financePath}/accounts/${accountId}`), { ...payload, shared, sharedRatio, updatedAt: nowTs() }));
}
async function saveSnapshot(accountId, day, value) {
  const parsedValue = Number(String(value).replace(',', '.'));
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

function triggerRender() {
  render().catch((e) => {
    console.error('[finance] render top-level', e);
    showFinanceBootError(e);
  });
}

async function render() {
  try {
    const host = ensureFinanceHost();
    renderFinanceNav();
    if (state.error) { host.innerHTML = `<article class=\"finance-panel\"><h3>Error cargando finanzas</h3><p>${state.error}</p></article>`; return; }
    const accounts = buildAccountModels(); const totalSeries = buildTotalSeries(accounts);
    if (state.activeView === 'balance') { host.innerHTML = renderFinanceBalance(); await maybeRolloverSnapshot(); }
    else if (state.activeView === 'goals') host.innerHTML = renderFinanceGoals();
    else if (state.activeView === 'calendar') host.innerHTML = renderFinanceCalendar(accounts, totalSeries);
    else host.innerHTML = renderFinanceHome(accounts, totalSeries);
    renderModal();
    renderToast();
  } catch (err) {
    console.error('[finance] render crashed', err);
    showFinanceBootError(err);
  }
}

function bindEvents() {
  const view = document.getElementById('view-finance'); if (!view || view.dataset.financeBound === '1') return; view.dataset.financeBound = '1';
  view.addEventListener('click', async (event) => {
    const target = event.target;
    const foodAdd = target.closest('[data-food-add]')?.dataset.foodAdd;
    if (foodAdd) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const typed = window.prompt('Nuevo valor');
      const name = normalizeFoodName(typed || '');
      if (!name) return;
      await loadFoodCatalog();
      await upsertFoodOption(foodAdd, name, false);
      await syncFoodOptionsInForm(form);
      const select = form.querySelector(`[data-food-select="${foodAdd}"]`);
      if (select) select.value = name;
      return;
    }
    const topItem = target.closest('[data-food-top-item]')?.dataset.foodTopItem;
    if (topItem) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const refs = getFoodFormRefs(form);
      if (refs.itemSearch) refs.itemSearch.value = topItem;
      if (refs.itemValue) refs.itemValue.value = topItem;
      renderFoodItemSearchResults(form);
      return;
    }
    const selectedItem = target.closest('[data-food-item-select]')?.dataset.foodItemSelect;
    if (selectedItem) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const refs = getFoodFormRefs(form);
      if (refs.itemSearch) refs.itemSearch.value = selectedItem;
      if (refs.itemValue) refs.itemValue.value = selectedItem;
      renderFoodItemSearchResults(form);
      return;
    }
    const createItem = target.closest('[data-food-item-create]')?.dataset.foodItemCreate;
    if (createItem != null) {
      const form = target.closest('[data-balance-form]');
      if (!form) return;
      const name = normalizeFoodName(createItem);
      if (!name) return;
      await loadFoodCatalog();
      await upsertFoodItem(name, false);
      const refs = getFoodFormRefs(form);
      if (refs.itemSearch) refs.itemSearch.value = name;
      if (refs.itemValue) refs.itemValue.value = name;
      const preset = state.food.items?.[name] || {};
      const amountInput = form.querySelector('input[name="amount"]');
      if (amountInput && Number(preset.lastPrice || 0) > 0) amountInput.value = String(preset.lastPrice);
      if (preset.lastCategory) {
        const catInput = form.querySelector('input[name="category"]');
        if (catInput) catInput.value = preset.lastCategory;
      }
      if (preset.lastExtras) {
        if (refs.mealType) refs.mealType.value = preset.lastExtras.mealType || '';
        if (refs.cuisine) refs.cuisine.value = preset.lastExtras.cuisine || '';
        if (refs.place) refs.place.value = preset.lastExtras.place || '';
      }
      renderFoodItemSearchResults(form);
      refreshFoodTopItems(form);
      maybeToggleCategoryCreate(form);
      return;
    }
    const txEdit = target.closest('[data-tx-edit]')?.dataset.txEdit;
    if (txEdit) { state.modal = { type: 'tx', txId: txEdit }; triggerRender(); return; }
    const txDelete = target.closest('[data-tx-delete]')?.dataset.txDelete;
    if (txDelete && window.confirm('¿Eliminar movimiento?')) {
      const existing = balanceTxList().find((row) => row.id === txDelete);
      if (!existing) return;
      console.log('[FINANCE][BALANCE] delete transaction', `${state.financePath}/transactions/${txDelete}`);
      await safeFirebase(() => remove(ref(db, `${state.financePath}/transactions/${txDelete}`)));
      const touched = [existing.accountId, existing.fromAccountId, existing.toAccountId].filter(Boolean);
      for (const accountId of [...new Set(touched)]) await recomputeAccountEntries(accountId, existing.date || isoToDay(existing.dateISO || ''));
      toast('Movimiento eliminado');
      return;
    }
    const createCategory = target.closest('[data-category-create]');
    if (createCategory) {
      const form = target.closest('[data-balance-form]');
      const category = String(form?.querySelector('input[name="category"]')?.value || '').trim();
      if (!category) return;
      await safeFirebase(() => set(ref(db, `${state.financePath}/catalog/categories/${category}`), { name: category, lastUsedAt: nowTs() }));
      state.balance.categories[category] = { name: category, lastUsedAt: nowTs() };
      maybeToggleCategoryCreate(form);
      return;
    }
    const nextView = target.closest('[data-finance-view]')?.dataset.financeView; if (nextView) { state.activeView = nextView; triggerRender(); return; }
    if (target.closest('[data-close-modal]') || target.id === 'finance-modalOverlay') { state.modal = { type: null }; triggerRender(); return; }
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
    const monthShift = target.closest('[data-month-shift]')?.dataset.monthShift; if (monthShift) {
      const step = Number(monthShift);
      if (state.calendarMode === 'month') state.calendarMonthOffset += (step * 12);
      else if (state.calendarMode === 'year') state.calendarMonthOffset += (step * 120);
      else state.calendarMonthOffset += step;
      triggerRender();
      return;
    }
    const bMonth = target.closest('[data-balance-month]')?.dataset.balanceMonth; if (bMonth) { state.balanceMonthOffset += Number(bMonth); triggerRender(); return; }
    const openModal = target.closest('[data-open-modal]')?.dataset.openModal; if (openModal) { state.modal = { type: openModal, budgetId: null }; triggerRender(); return; }
    const openGoal = target.closest('[data-open-goal]')?.dataset.openGoal; if (openGoal) { state.modal = { type: 'goal-detail', goalId: openGoal }; triggerRender(); return; }
    const delGoal = target.closest('[data-delete-goal]')?.dataset.deleteGoal; if (delGoal && window.confirm('¿Borrar objetivo?')) { await safeFirebase(() => remove(ref(db, `${state.financePath}/goals/goals/${delGoal}`))); return; }
  });
view.addEventListener('focusin', (event) => {
  if (event.target.matches('[data-account-input]')) {
    event.target.dataset.prev = event.target.value;
    event.target.value = '';
  }
});

view.addEventListener('focusout', async (event) => {
  if (event.target.matches('[data-account-input]')) {
    const accountId = event.target.dataset.accountInput;
    const value = event.target.value.trim();

    if (!value) {
      event.target.value = event.target.dataset.prev || '';
      return;
    }

    await saveSnapshot(accountId, dayKeyFromTs(Date.now()), value);
  }
});
  view.addEventListener('change', async (event) => {
    if (event.target.matches('[data-range]')) { state.rangeMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-compare]')) { state.compareMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-calendar-account]')) { state.calendarAccountId = event.target.value; triggerRender(); }
    if (event.target.matches('[data-calendar-mode]')) { state.calendarMode = event.target.value; triggerRender(); }
    if (event.target.matches('[data-balance-type]')) { state.balanceFilterType = event.target.value; triggerRender(); }
    if (event.target.matches('[data-balance-category]')) { state.balanceFilterCategory = event.target.value; triggerRender(); }
    if (event.target.matches('[data-balance-account]')) { state.balanceAccountFilter = event.target.value; triggerRender(); }
    if (event.target.matches('[data-import-file]')) {
      const file = event.target.files?.[0];
      if (!file) return;
      const raw = await file.text();
      const parsed = parseCsvRows(raw);
      state.modal = { ...state.modal, importRaw: raw, importPreview: parsed, importError: parsed.validRows.length ? '' : 'CSV inválido o sin filas válidas.' };
      triggerRender();
    }
    if (event.target.matches('[data-balance-form] input[name="category"]')) {
      const form = event.target.closest('[data-balance-form]');
      await toggleFoodExtras(form);
      maybeToggleCategoryCreate(form);
    }
    if (event.target.matches('[data-tx-type]')) {
      syncTxTypeFields(event.target.closest('[data-balance-form]'));
    }
  });

  view.addEventListener('input', async (event) => {
    if (event.target.matches('[data-balance-form] input[name="category"]')) {
      const form = event.target.closest('[data-balance-form]');
      await toggleFoodExtras(form);
      maybeToggleCategoryCreate(form);
      persistBalanceFormState(form);
      return;
    }

    if (event.target.closest('[data-balance-form]')) {
      persistBalanceFormState(event.target.closest('[data-balance-form]'));
    }
    if (event.target.matches('[data-food-item-search]')) {
      const form = event.target.closest('[data-balance-form]');
      if (!form) return;
      const refs = getFoodFormRefs(form);
      if (refs.itemValue) refs.itemValue.value = normalizeFoodName(event.target.value);
      renderFoodItemSearchResults(form);
    }
  });


  view.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-new-account-form]')) {
      event.preventDefault(); const form = new FormData(event.target); const name = String(form.get('name') || '').trim(); const shared = form.get('shared') === 'on'; const sharedRatio = Number(form.get('sharedRatio') || 0.5); if (name) await addAccount({ name, shared, sharedRatio }); state.modal = { type: null }; triggerRender(); return;
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
      await updateAccountMeta(accountId, { name: String(form.get('name') || '').trim(), shared: form.get('shared') === 'on', sharedRatio: Number(form.get('sharedRatio') || 0.5) });
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
      const form = new FormData(event.target);
      const txId = String(form.get('txId') || '').trim();
      const type = normalizeTxType(String(form.get('type') || 'expense'));
      const amount = Number(form.get('amount') || 0);
      const dateISO = String(form.get('dateISO') || dayKeyFromTs(Date.now()));
      const category = String(form.get('category') || 'Sin categoría').trim() || 'Sin categoría';
      const note = String(form.get('note') || '').trim();
      const accountId = String(form.get('accountId') || '');
      const fromAccountId = String(form.get('fromAccountId') || '');
      const toAccountId = String(form.get('toAccountId') || '');
      if (!Number.isFinite(amount) || amount <= 0) { toast('Cantidad inválida'); return; }
      if ((type === 'income' || type === 'expense') && !accountId) { toast('Selecciona una cuenta'); return; }
      if (type === 'transfer' && (!fromAccountId || !toAccountId || fromAccountId === toAccountId)) { toast('Transferencia inválida'); return; }
      const mealType = normalizeFoodName(String(form.get('foodMealType') || ''));
      const cuisine = normalizeFoodName(String(form.get('foodCuisine') || ''));
      const place = normalizeFoodName(String(form.get('foodPlace') || ''));
      const item = normalizeFoodName(String(form.get('foodItem') || ''));
      const extras = isFoodCategory(category) ? { mealType: mealType || '', cuisine: cuisine || '', place: place || '', item: item || '' } : undefined;
      const saveId = txId || push(ref(db, `${state.financePath}/transactions`)).key;
      const prev = txId ? balanceTxList().find((row) => row.id === txId) : null;
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
        extras: extras || null,
        updatedAt: nowTs(),
        createdAt: Number(prev?.createdAt || 0) || nowTs()
      };
      console.log('[FINANCE][BALANCE] save transaction', `${state.financePath}/transactions/${saveId}`);
      await safeFirebase(() => set(ref(db, `${state.financePath}/transactions/${saveId}`), payload));
      if (!state.balance.categories?.[category]) await safeFirebase(() => set(ref(db, `${state.financePath}/catalog/categories/${category}`), { name: category, lastUsedAt: nowTs() }));
      await safeFirebase(() => update(ref(db, `${state.financePath}/catalog/categories/${category}`), { name: category, lastUsedAt: nowTs() }));
      if (extras?.item) {
        await loadFoodCatalog();
        await upsertFoodItem(extras.item, true, { lastPrice: amount, lastCategory: category, lastExtras: extras });
        if (extras.mealType) await upsertFoodOption('typeOfMeal', extras.mealType, true);
        if (extras.cuisine) await upsertFoodOption('cuisine', extras.cuisine, true);
        if (extras.place) await upsertFoodOption('place', extras.place, true);
      }
      const touched = new Set([payload.accountId, payload.fromAccountId, payload.toAccountId, prev?.accountId, prev?.fromAccountId, prev?.toAccountId].filter(Boolean));
      for (const account of touched) await recomputeAccountEntries(account, dateISO);
      localStorage.setItem('bookshell_finance_lastMovementAccountId', accountId || fromAccountId || '');
      state.lastMovementAccountId = accountId || fromAccountId || '';
      state.balanceFormState = {};
      state.modal = { type: null };
      toast(txId ? 'Movimiento actualizado' : 'Movimiento guardado');
      triggerRender();
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
      event.preventDefault(); const form = new FormData(event.target); const goalId = push(ref(db, `${state.financePath}/goals/goals`)).key;
      const payload = { title: String(form.get('title') || '').trim(), targetAmount: Number(form.get('targetAmount') || 0), dueDateISO: `${form.get('dueDateISO')}T00:00:00.000Z`, accountsIncluded: form.getAll('accountsIncluded'), createdAt: nowTs(), updatedAt: nowTs() };
      await safeFirebase(() => set(ref(db, `${state.financePath}/goals/goals/${goalId}`), payload)); state.modal = { type: null }; toast('Objetivo creado'); triggerRender(); return;
    }
    const goalAccountsId = event.target.dataset.goalAccountsForm;
    if (goalAccountsId) {
      event.preventDefault(); const ids = [...event.target.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      await safeFirebase(() => update(ref(db, `${state.financePath}/goals/goals/${goalAccountsId}`), { accountsIncluded: ids, updatedAt: nowTs() }));
      state.modal = { type: null }; triggerRender();
    }
  });

  view.addEventListener('toggle', (event) => {
    const details = event.target.closest('[data-history-account]'); if (!details || !details.open) return;
    const accountId = details.dataset.historyAccount; const host = view.querySelector(`[data-history-rows="${accountId}"]`); if (!host || host.dataset.loaded === '1') return;
    const account = buildAccountModels().find((item) => item.id === accountId); host.dataset.loaded = '1';
    host.innerHTML = account?.daily?.length ? account.daily.slice().reverse().map((row) => `<div class="finance-history-row"><span>${new Date(row.ts).toLocaleDateString('es-ES')}</span><span>${fmtCurrency(row.value)}</span><span class="${toneClass(row.delta)}">${fmtSignedCurrency(row.delta)}</span><span class="${toneClass(row.deltaPct)}">${fmtSignedPercent(row.deltaPct)}</span></div>`).join('') : '<p class="finance-empty">Sin registros.</p>';
  }, true);
}

function financeDomReady() {
  return Boolean(resolveFinanceRoot() || $opt('#view-finance') || $opt('#tab-finance'));
}

async function boot() {
  if (state.booted) return;
  if (!financeDomReady()) {
    log('boot deferred: finance DOM not ready yet');
    return;
  }
  state.booted = true;
  const financeRoot = resolveFinanceRoot();
  log('dom root resolved', {
    missingFinanceRootId: !$opt('#finance-root'),
    missingDataTabFinance: !$opt('[data-tab="finance"]'),
    missingLegacyContainerSelector: !$opt('#finance, #financeTab, .finance-tab, [data-view="finance"]'),
    resolvedRoot: financeRoot?.id || financeRoot?.className || financeRoot?.tagName || null,
  });
  state.deviceId = getDeviceId();
  console.log('[finance] deviceId', state.deviceId);
  state.financePath = 'Finance';
  log('init ok', { financePath: state.financePath });
  bindEvents();
  await loadDataOnce();
  subscribe();
  await render();
}

function bootFinance() {
  boot().catch((e) => {
    console.error('[finance] boot crashed', e);
    showFinanceBootError(e);
  });
}

if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', () => bootFinance(), { once: true });
else bootFinance();

window.addEventListener('click', (event) => {
  if (event.target.closest?.('[data-view="view-finance"]')) bootFinance();
});

const financeDomObserver = new MutationObserver(() => {
  if (!state.booted && financeDomReady()) {
    bootFinance();
    financeDomObserver.disconnect();
  }
});
if (!state.booted) financeDomObserver.observe(document.documentElement, { childList: true, subtree: true });
