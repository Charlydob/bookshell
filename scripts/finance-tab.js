import { get, onValue, push, ref, remove, set, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';

const LEGACY_PATH = 'finance';
const DEVICE_KEY = 'bookshell_deviceId';
const RANGE_LABEL = { total: 'Total', month: 'Mes', week: 'Semana', year: 'Año' };

const state = {
  deviceId: '',
  financePath: '',
  rangeMode: 'month',
  compareMode: 'month',
  activeView: 'home',
  accounts: [],
  legacyEntries: {},
  balance: { tx: {}, movements: {}, categories: {}, budgets: {}, snapshots: {}, defaultAccountId: '', lastSeenMonthKey: '' },
  goals: { goals: {} },
  modal: { type: null, accountId: null, goalId: null, budgetId: null, importRaw: '', importPreview: null, importError: '' },
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
function isoToDay(dateISO = '') { return String(dateISO).slice(0, 10); }

function getDeviceId() {
  const existing = localStorage.getItem(DEVICE_KEY);
  if (existing) return existing;
  const generated = window.crypto?.randomUUID?.() || `dev-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  localStorage.setItem(DEVICE_KEY, generated);
  return generated;
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
  const movementRows = [];
  Object.entries(root.movements || {}).forEach(([monthKey, rows]) => {
    Object.entries(rows || {}).forEach(([id, row]) => {
      if (row?.accountId === accountId) movementRows.push({ id, ...row, monthKey: row?.monthKey || monthKey, amount: Number(row?.amount || 0) });
    });
  });
  const movements = movementRows.sort((a, b) => new Date(a.dateISO || 0) - new Date(b.dateISO || 0));
  const daySet = new Set([
    ...snapshots.map((row) => row.day),
    ...movements.map((row) => isoToDay(row.dateISO || ''))
  ].filter(Boolean));
  if (fromDay) daySet.add(fromDay);
  const allDays = [...daySet].sort();
  if (!allDays.length) return;
  const startDay = fromDay || allDays[0];
  log(`recompute from ${startDay} for accountId=${accountId}`);
  const dayMovementNet = {};
  movements.forEach((row) => {
    const day = isoToDay(row.dateISO || '');
    if (!day) return;
    dayMovementNet[day] = (dayMovementNet[day] || 0) + movementSign(row.type) * Number(row.amount || 0);
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
    } else value = carry + Number(dayMovementNet[day] || 0);
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
  const date = new Date(); date.setMonth(date.getMonth() + state.calendarMonthOffset);
  const year = date.getFullYear(); const month = date.getMonth();
  const monthStartDate = new Date(year, month, 1); const monthStart = monthStartDate.getTime(); const monthEnd = new Date(year, month + 1, 1).getTime();
  const daysInMonth = new Date(year, month + 1, 0).getDate(); const firstWeekdayOffset = (monthStartDate.getDay() + 6) % 7;
  const source = state.calendarAccountId === 'total' ? totalSeries.map((point, idx, arr) => ({ ...point, delta: idx ? point.value - arr[idx - 1].value : 0 })) : (accounts.find((acc) => acc.id === state.calendarAccountId)?.daily || []);
  const pointsByDay = {};
  source.filter((point) => point.ts >= monthStart && point.ts < monthEnd).forEach((point) => {
    const prev = source.filter((i) => i.ts < point.ts).at(-1); const delta = prev ? point.value - prev.value : point.delta || 0; const deltaPct = prev?.value ? (delta / prev.value) * 100 : 0;
    pointsByDay[new Date(point.ts).getDate()] = { ...point, delta, deltaPct };
  });
  const cells = []; for (let i = 0; i < firstWeekdayOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) cells.push(pointsByDay[day] ? { ...pointsByDay[day], dayNumber: day } : { dayNumber: day, delta: 0, deltaPct: 0, isEmpty: true });
  return { cells };
}

function balanceTxList() {
  const flat = [];
  Object.entries(state.balance.movements || {}).forEach(([monthKey, rows]) => {
    Object.entries(rows || {}).forEach(([id, row]) => {
      flat.push({ id, ...row, monthKey: row?.monthKey || monthKey, amount: Number(row?.amount || 0) });
    });
  });
  const legacy = Object.entries(state.balance.tx || {}).map(([id, row]) => ({ id, ...row, amount: Number(row.amount || 0) }));
  return [...flat, ...legacy]
    .filter((row) => Number.isFinite(row.amount) && row.monthKey)
    .sort((a, b) => new Date(b.dateISO || 0) - new Date(a.dateISO || 0));
}
function getSelectedBalanceMonthKey() {
  return offsetMonthKey(getMonthKeyFromDate(), state.balanceMonthOffset);
}
function summaryForMonth(monthKey) {
  const rows = balanceTxList().filter((tx) => tx.monthKey === monthKey);
  const income = rows.filter((tx) => tx.type === 'income').reduce((s, tx) => s + tx.amount, 0);
  const expense = rows.filter((tx) => tx.type === 'expense').reduce((s, tx) => s + tx.amount, 0);
  const invest = rows.filter((tx) => tx.type === 'invest').reduce((s, tx) => s + tx.amount, 0);
  return { income, expense, invest, net: income - expense - invest };
}
function categoriesList() {
  const dynamic = Object.keys(state.balance.categories || {});
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
        <select class="finance-pill" data-compare><option value="month" ${state.compareMode === 'month' ? 'selected' : ''}>Mes vs Mes</option><option value="week" ${state.compareMode === 'week' ? 'selected' : ''}>Semana vs Semana</option></select><button class="finance-pill finance-pill--secondary" type="button">Actualizar</button></article>
      <article class="finance__compareRow"><div class="finance-chip ${toneClass(compareCurrent.delta)}">Actual: ${fmtSignedCurrency(compareCurrent.delta)} (${fmtSignedPercent(compareCurrent.deltaPct)})</div><div class="finance-chip ${toneClass(comparePrev.delta)}">Anterior: ${fmtSignedCurrency(comparePrev.delta)} (${fmtSignedPercent(comparePrev.deltaPct)})</div></article>
      <article class="finance__accounts"><div class="finance__sectionHeader"><h2>Cuentas</h2><button class="finance-pill" data-new-account>+ Cuenta</button></div>
      <div id="finance-accountsList">${accounts.map((account) => `<article class="financeAccountCard ${toneClass(account.range.delta)}" data-open-detail="${account.id}"><div><strong>${escapeHtml(account.name)}</strong><div class="financeAccountCard__balanceWrap"><span class="financeAccountCard__balanceLabel">Mi saldo</span><input class="financeAccountCard__balance" data-account-input="${account.id}" value="${account.current.toFixed(2)}" inputmode="decimal" placeholder="Snapshot hoy" /><button class="finance-pill finance-pill--mini" data-account-save="${account.id}">Guardar</button></div>${account.shared ? `<small class="finance-shared-chip">Compartida ${(account.sharedRatio * 100).toFixed(0)}%</small>` : ''}</div><div class="financeAccountCard__side"><span class="financeAccountCard__deltaPill finance-chip ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]} ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span><button class="financeAccountCard__menuBtn" data-delete-account="${account.id}">⋯</button></div></article>`).join('') || '<p class="finance-empty">Sin cuentas todavía.</p>'}</div></article>
    </section>`;
}

function renderFinanceCalendar(accounts, totalSeries) {
  const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
  const calendar = calendarData(accounts, totalSeries);
  return `<section class="finance-home"><article class="finance__calendarPreview"><div class="finance__sectionHeader"><h2>Calendario</h2><span class="finance-month-label">${monthLabelByKey(offsetMonthKey(getMonthKeyFromDate(), state.calendarMonthOffset))}</span></div>
  <div class="finance-calendar-controls"><button class="finance-pill" data-month-shift="-1">◀</button><select class="finance-pill" data-calendar-account><option value="total" ${state.calendarAccountId === 'total' ? 'selected' : ''}>Total</option>${accounts.map((a) => `<option value="${a.id}" ${state.calendarAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select><select class="finance-pill" data-calendar-mode><option value="day" ${state.calendarMode === 'day' ? 'selected' : ''}>Día</option><option value="month" ${state.calendarMode === 'month' ? 'selected' : ''}>Mes</option></select><button class="finance-pill" data-month-shift="1">▶</button></div>
  <div class="finance-calendar-grid"><div class="finance-calendar-weekdays">${weekdayLabels.map((l) => `<span>${l}</span>`).join('')}</div><div class="finance-calendar-days">${calendar.cells.map((point) => {
    if (!point) return '<div class="financeCalCell financeCalCell--blank"></div>';
    const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
    return `<div class="financeCalCell ${tone}"><strong>${point.dayNumber}</strong><span>${point.isEmpty ? '—' : fmtSignedCurrency(point.delta)}</span><span>${point.isEmpty ? '—' : fmtSignedPercent(point.deltaPct)}</span></div>`;
  }).join('')}</div></div></article></section>`;
}

function renderFinanceBalance() {
  const monthKey = getSelectedBalanceMonthKey();
  const tx = balanceTxList().filter((row) => row.monthKey === monthKey)
    .filter((row) => state.balanceFilterType === 'all' || row.type === state.balanceFilterType)
    .filter((row) => state.balanceFilterCategory === 'all' || row.category === state.balanceFilterCategory)
    .filter((row) => state.balanceAccountFilter === 'all' || row.accountId === state.balanceAccountFilter);
  const categories = categoriesList();
  const accounts = buildAccountModels();
  const monthSummary = summaryForMonth(monthKey);
  const prevSummary = summaryForMonth(offsetMonthKey(monthKey, -1));
  const deltaNet = monthSummary.net - prevSummary.net;
  const deltaPct = prevSummary.net ? (deltaNet / Math.abs(prevSummary.net)) * 100 : 0;
  const spentByCategory = {};
  balanceTxList().filter((row) => row.monthKey === monthKey && row.type === 'expense').forEach((row) => { spentByCategory[row.category || 'Sin categoría'] = (spentByCategory[row.category || 'Sin categoría'] || 0) + row.amount; });
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const budgetItems = getBudgetItems(monthKey);
  return `<section class="financeBalanceView"><header class="financeViewHeader"><h2>Balance</h2><button class="finance-pill" data-open-modal="tx">+ Añadir</button></header>
  <article class="financeGlassCard"><div class="finance-row"><button class="finance-pill" data-balance-month="-1">◀</button><strong>${monthLabelByKey(monthKey)}</strong><button class="finance-pill" data-balance-month="1">▶</button></div>
  <div class="financeSummaryGrid"><div><small>Ingresos</small><strong class="is-positive">${fmtCurrency(monthSummary.income)}</strong></div><div><small>Gastos</small><strong class="is-negative">${fmtCurrency(monthSummary.expense)}</strong></div><div><small>Inversión</small><strong class="is-neutral">${fmtCurrency(monthSummary.invest)}</strong></div><div><small>Neto</small><strong class="${toneClass(monthSummary.net)}">${fmtCurrency(monthSummary.net)}</strong></div></div>
  <div class="finance-chip ${toneClass(deltaNet)}">Mes anterior: ${fmtSignedCurrency(deltaNet)} (${fmtSignedPercent(deltaPct)})</div></article>
  <article class="financeGlassCard"><div class="finance-row"><h3>Transacciones</h3><div class="finance-row"><select class="finance-pill" data-balance-type><option value="all">Todos</option><option value="expense" ${state.balanceFilterType === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${state.balanceFilterType === 'income' ? 'selected' : ''}>Ingreso</option></select><select class="finance-pill" data-balance-category><option value="all">Todas</option>${categories.map((c) => `<option ${state.balanceFilterCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select><select class="finance-pill" data-balance-account><option value="all">Todas las cuentas</option>${accounts.map((a) => `<option value="${a.id}" ${state.balanceAccountFilter === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select></div></div>
  <div class="financeTxList">${tx.map((row) => `<div class="financeTxRow"><span>${new Date(row.dateISO).toLocaleDateString('es-ES')}</span><span>${escapeHtml(row.note || row.category || '—')} · ${escapeHtml(accounts.find((a) => a.id === row.accountId)?.name || 'Sin cuenta')}</span><strong class="${row.type === 'income' ? 'is-positive' : 'is-negative'}">${fmtCurrency(row.amount)}</strong></div>`).join('') || '<p class="finance-empty">Sin movimientos en este mes.</p>'}</div></article>
  <article class="financeGlassCard"><div class="finance-row"><h3>Presupuestos</h3><button class="finance-pill" data-open-modal="budget">+ Presupuesto</button></div>
  <div class="financeBudgetList">${budgetItems.length ? budgetItems.map((budget) => {
    const spent = budget.category.toLowerCase() === 'total' ? totalSpent : Number(spentByCategory[budget.category] || 0);
    const limit = Number(budget.limit || 0);
    const pct = limit ? (spent / limit) * 100 : 0;
    return `<div class="financeBudgetRow"><div class="finance-row"><span>${escapeHtml(budget.category)}</span><div class="finance-row"><small>${fmtCurrency(spent)} / ${limit ? fmtCurrency(limit) : '—'}</small><button class="finance-pill finance-pill--mini" data-budget-menu="${budget.id}">⋯</button></div></div><div class="financeProgress"><i style="width:${Math.min(100, pct)}%" class="${pct > 100 ? 'is-negative' : ''}"></i></div>${pct > 100 ? '<small class="is-negative">over</small>' : ''}</div>`;
  }).join('') : '<p class="finance-empty">No hay presupuestos aún.</p>'}</div></article></section>`;
}

function goalScore(goal) {
  const due = new Date(goal.dueDateISO || Date.now()).getTime();
  const daysLeft = Math.max(1, Math.ceil((due - Date.now()) / 86400000));
  const weight = Number(goal.targetAmount || 0);
  const score = weight / daysLeft;
  return Number.isFinite(score) ? score : 0;
}
function accountCurrentMap() { return Object.fromEntries(buildAccountModels().map((a) => [a.id, a.current])); }
function renderFinanceGoals() {
  log('goals init', { total: Object.keys(state.goals.goals || {}).length });
  const goals = Object.entries(state.goals.goals || {}).map(([id, g]) => ({ id, ...g })).sort((a, b) => goalScore(b) - goalScore(a));
  const balances = accountCurrentMap();
  const totals = goals.map((g) => {
    const available = (g.accountsIncluded || []).reduce((sum, id) => sum + Number(balances[id] || 0), 0);
    const progress = Math.min(available, Number(g.targetAmount || 0));
    const pct = g.targetAmount ? (progress / g.targetAmount) * 100 : 0;
    const daysLeft = Math.ceil((new Date(g.dueDateISO || Date.now()).getTime() - Date.now()) / 86400000);
    return { ...g, available, progress, pct, daysLeft, score: goalScore(g) };
  });
  const pool = Object.values(balances).reduce((s, v) => s + v, 0);
  const scoreSum = totals.reduce((s, g) => s + g.score, 0) || 1;
  const targetTotal = totals.reduce((s, g) => s + Number(g.targetAmount || 0), 0);
  const progressTotal = totals.reduce((s, g) => s + g.progress, 0);
  return `<section class="financeGoalsView"><header class="financeViewHeader"><h2>Objetivos</h2><button class="finance-pill" data-open-modal="goal">+ Objetivo</button></header>
  <article class="financeGlassCard"><h3>Objetivo total</h3><p>${fmtCurrency(progressTotal)} / ${fmtCurrency(targetTotal)} (${targetTotal ? ((progressTotal / targetTotal) * 100).toFixed(1) : '0'}%)</p><div class="financeProgress"><i style="width:${targetTotal ? Math.min(100, (progressTotal / targetTotal) * 100) : 0}%"></i></div></article>
  <div class="financeGoalsList">${totals.map((g) => {
    const allocationShare = g.score / scoreSum;
    const allocated = Math.min(Number(g.targetAmount || 0), pool * allocationShare);
    const statusClass = g.daysLeft < 0 ? 'is-negative' : (g.daysLeft < 14 && g.pct < 70 ? 'is-warn' : 'is-positive');
    return `<article class="financeGlassCard"><div class="finance-row"><strong>${escapeHtml(g.title || 'Objetivo')}</strong><div><button class="finance-pill finance-pill--mini" data-open-goal="${g.id}">⋯</button><button class="finance-pill finance-pill--mini" data-delete-goal="${g.id}">✕</button></div></div>
      <p>${fmtCurrency(g.progress)} / ${fmtCurrency(g.targetAmount)} (${g.pct.toFixed(1)}%)</p><div class="financeProgress"><i style="width:${Math.min(100, g.pct)}%"></i></div>
      <p class="${statusClass}">Prioridad ${(g.score).toFixed(2)} · vence ${new Date(g.dueDateISO).toLocaleDateString('es-ES')}</p><small>Asignación sugerida: ${fmtCurrency(allocated)} (${(allocationShare * 100).toFixed(1)}% del pool, dinero / días)</small></article>`;
  }).join('') || '<p class="finance-empty">Sin objetivos aún.</p>'}</div></section>`;
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
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Detalle de cuenta · ${escapeHtml(account.name)}</h3><div class="finance-row"><button class="finance-pill finance-pill--mini" data-edit-account="${account.id}">Editar cuenta</button><button class="finance-pill" data-close-modal>Cerrar</button></div></header>
      <p>Saldo real: <strong>${fmtCurrency(account.currentReal)}</strong>${account.shared ? ` · Mi parte: <strong>${fmtCurrency(account.current)}</strong>` : ''}</p><div id="finance-lineChart" class="${chart.tone}">${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos.</div>'}</div>
      <form class="finance-entry-form" data-account-entry-form="${account.id}"><input name="day" type="date" value="${dayKeyFromTs(Date.now())}" required /><input name="value" type="number" step="0.01" placeholder="Valor real" required /><button class="finance-pill" type="submit">Guardar snapshot</button></form>
      <div class="finance-table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Δ</th><th>Δ%</th><th></th></tr></thead><tbody>${account.daily.slice().reverse().map((row) => `<tr><td>${new Date(row.ts).toLocaleDateString('es-ES')}</td><td><form data-account-row-form="${account.id}:${row.day}"><input name="value" type="number" step="0.01" value="${Number(row.realValue || row.value || 0)}"/></form></td><td class="${toneClass(row.delta)}">${fmtSignedCurrency(row.delta)}</td><td class="${toneClass(row.deltaPct)}">${fmtSignedPercent(row.deltaPct)}</td><td><button class="finance-pill finance-pill--mini" data-save-day="${account.id}:${row.day}">Editar</button><button class="finance-pill finance-pill--mini" data-delete-day="${account.id}:${row.day}">Borrar</button></td></tr>`).join('') || '<tr><td colspan="5">Sin registros.</td></tr>'}</tbody></table></div>
      <section class="financeImportBox"><h4>Importar CSV</h4><form class="finance-budget-form" data-import-preview-form="${account.id}"><input type="file" accept=".csv,text/csv" data-import-file="${account.id}" /><textarea name="csvText" placeholder="date,value
2026-01-01,1200.50">${escapeHtml(state.modal.importRaw || '')}</textarea><button class="finance-pill" type="submit">Previsualizar</button></form>
      ${state.modal.importError ? `<p class="is-negative">${escapeHtml(state.modal.importError)}</p>` : ''}
      ${preview ? `<p>${preview.validRows.length} filas válidas / ${preview.totalRows}</p><div class="finance-table-wrap"><table><thead><tr><th>#</th><th>Fecha</th><th>Valor</th></tr></thead><tbody>${preview.validRows.slice(0, 10).map((row) => `<tr><td>${row.lineNumber}</td><td>${row.dateISO}</td><td>${fmtCurrency(row.value)}</td></tr>`).join('') || '<tr><td colspan="3">Sin filas válidas.</td></tr>'}</tbody></table></div><button class="finance-pill" data-import-apply="${account.id}">Importar ahora</button>` : ''}
      </section></div>`;
    return;
  }
  if (state.modal.type === 'tx') {
    const defaultAccountId = state.lastMovementAccountId || state.balance.defaultAccountId || accounts[0]?.id || '';
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Añadir movimiento</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <form class="finance-entry-form finance-tx-form" data-balance-form>
      <select name="type" class="finance-pill"><option value="expense">Gasto</option><option value="income">Ingreso</option></select>
      <input required name="amount" type="number" step="0.01" placeholder="Cantidad €" />
      <input name="dateISO" type="date" value="${dayKeyFromTs(Date.now())}" />
      <select name="accountId" required><option value="">Selecciona cuenta</option>${accounts.map((a) => `<option value="${a.id}" ${defaultAccountId === a.id ? 'selected' : ''}>${escapeHtml(a.name)}</option>`).join('')}</select>
      <input name="category" list="finance-cat-list" placeholder="Categoría" />
      <datalist id="finance-cat-list">${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      <input name="note" type="text" placeholder="Nota (opcional)" />
      <button class="finance-pill" type="submit">Añadir movimiento</button></form></div>`;
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
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Nueva cuenta</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><form class="finance-entry-form" data-new-account-form><input type="text" name="name" data-account-name-input placeholder="Nombre de la cuenta" required /><label><input type="checkbox" name="shared" /> Cuenta compartida</label><select name="sharedRatio"><option value="0.5">50%</option><option value="1">100%</option></select><button class="finance-pill" type="submit">Crear cuenta</button></form></div>`;
    return;
  }
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

async function loadDataOnce() {
  const snap = await safeFirebase(() => get(ref(db, state.financePath)));
  const legacySnap = await safeFirebase(() => get(ref(db, LEGACY_PATH)));
  const val = snap?.val() || {};
  const fallback = legacySnap?.val() || {};
  const accountsMap = Object.keys(val.accounts || {}).length ? val.accounts : (fallback.accounts || {});
  const entriesMap = val.accountsEntries || val.entries || fallback.accountsEntries || fallback.entries || {};
  state.accounts = Object.values(accountsMap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.legacyEntries = entriesMap;
  state.balance = { tx: val.balance?.tx || {}, movements: val.movements || {}, categories: val.balance?.categories || {}, budgets: val.balance?.budgets || {}, snapshots: val.balance?.snapshots || {}, defaultAccountId: val.balance?.defaultAccountId || '', lastSeenMonthKey: val.balance?.lastSeenMonthKey || '' };
  state.goals = { goals: val.goals?.goals || {} };
  await migrateLegacy(entriesMap, state.accounts);
  log('loaded accounts:', state.accounts.length);
}

function subscribe() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = onValue(ref(db, state.financePath), (snap) => {
    const val = snap.val() || {};
    state.accounts = Object.values(val.accounts || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    state.legacyEntries = val.accountsEntries || val.entries || state.legacyEntries;
    state.balance = { tx: val.balance?.tx || {}, movements: val.movements || {}, categories: val.balance?.categories || {}, budgets: val.balance?.budgets || {}, snapshots: val.balance?.snapshots || {}, defaultAccountId: val.balance?.defaultAccountId || '', lastSeenMonthKey: val.balance?.lastSeenMonthKey || '' };
    state.goals = { goals: val.goals?.goals || {} };
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
    const budgetDelete = target.closest('[data-budget-delete]')?.dataset.budgetDelete; if (budgetDelete && window.confirm('¿Eliminar presupuesto?')) { const monthKey = getSelectedBalanceMonthKey(); await safeFirebase(() => remove(ref(db, `${state.financePath}/balance/budgets/${monthKey}/${budgetDelete}`))); state.modal = { type: null }; toast('Presupuesto eliminado'); triggerRender(); return; }
    const importApply = target.closest('[data-import-apply]')?.dataset.importApply; if (importApply) { const parsed = state.modal.importPreview; if (!parsed?.validRows?.length) { state.modal = { ...state.modal, importError: 'CSV sin filas válidas.' }; triggerRender(); return; } const imported = await applyImportRows(importApply, parsed); toast(`Importados ${imported} días`); openAccountDetail(importApply); return; }
    const monthShift = target.closest('[data-month-shift]')?.dataset.monthShift; if (monthShift) { state.calendarMonthOffset += Number(monthShift); triggerRender(); return; }
    const bMonth = target.closest('[data-balance-month]')?.dataset.balanceMonth; if (bMonth) { state.balanceMonthOffset += Number(bMonth); triggerRender(); return; }
    const openModal = target.closest('[data-open-modal]')?.dataset.openModal; if (openModal) { state.modal = { type: openModal, budgetId: null }; triggerRender(); return; }
    const openGoal = target.closest('[data-open-goal]')?.dataset.openGoal; if (openGoal) { state.modal = { type: 'goal-detail', goalId: openGoal }; triggerRender(); return; }
    const delGoal = target.closest('[data-delete-goal]')?.dataset.deleteGoal; if (delGoal && window.confirm('¿Borrar objetivo?')) { await safeFirebase(() => remove(ref(db, `${state.financePath}/goals/goals/${delGoal}`))); return; }
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
  });


  view.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-new-account-form]')) {
      event.preventDefault(); const form = new FormData(event.target); const name = String(form.get('name') || '').trim(); const shared = form.get('shared') === 'on'; const sharedRatio = Number(form.get('sharedRatio') || 0.5); if (name) await addAccount({ name, shared, sharedRatio }); state.modal = { type: null }; triggerRender(); return;
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
      const type = String(form.get('type') || 'expense'); const amount = Number(form.get('amount') || 0); const dateISO = String(form.get('dateISO') || dayKeyFromTs(Date.now()));
      const category = String(form.get('category') || 'Sin categoría').trim() || 'Sin categoría'; const note = String(form.get('note') || '').trim(); const accountId = String(form.get('accountId') || '');
      if (!accountId) { toast('Selecciona una cuenta'); return; }
      const monthKey = dateISO.slice(0, 7); const movementId = push(ref(db, `${state.financePath}/movements/${monthKey}`)).key;
      const payload = { amount, category, note, dateISO: `${dateISO}T12:00:00.000Z`, monthKey, type, accountId, createdAt: nowTs() };
      await safeFirebase(() => set(ref(db, `${state.financePath}/movements/${monthKey}/${movementId}`), payload));
      localStorage.setItem('bookshell_finance_lastMovementAccountId', accountId);
      state.lastMovementAccountId = accountId;
      log('movement:add', { accountId, date: dateISO, amount, type });
      await recomputeAccountEntries(accountId, dateISO);
      if (!state.balance.categories?.[category]) await safeFirebase(() => set(ref(db, `${state.financePath}/balance/categories/${category}`), { createdAt: nowTs() }));
      state.modal = { type: null }; toast('Movimiento guardado'); triggerRender(); return;
    }
    if (event.target.matches('[data-budget-form]')) {
      event.preventDefault();
      const form = new FormData(event.target);
      const category = String(form.get('category') || '').trim();
      const limit = Number(form.get('limit') || 0);
      const monthKey = String(form.get('monthKey') || getSelectedBalanceMonthKey());
      if (!category || !monthKey || !Number.isFinite(limit)) { toast('Datos de presupuesto inválidos'); return; }
      const budgetId = state.modal.budgetId || push(ref(db, `${state.financePath}/balance/budgets/${monthKey}`)).key;
      await safeFirebase(() => set(ref(db, `${state.financePath}/balance/budgets/${monthKey}/${budgetId}`), { category, limit, createdAt: nowTs(), updatedAt: nowTs() }));
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
  state.financePath = `bookshell/finance/${state.deviceId}`;
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
