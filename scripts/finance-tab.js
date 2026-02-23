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
  balance: { tx: {}, categories: {}, budgets: {}, snapshots: {}, lastSeenMonthKey: '' },
  goals: { goals: {} },
  modal: { type: null, accountId: null, goalId: null },
  toast: '',
  calendarMonthOffset: 0,
  calendarAccountId: 'total',
  calendarMode: 'day',
  balanceMonthOffset: 0,
  balanceFilterType: 'all',
  balanceFilterCategory: 'all',
  unsubscribe: null,
  saveTimers: {},
  error: ''
};

function log(...parts) { console.log('[finance]', ...parts); }
function warnMissing(id) { console.warn(`[finance] missing DOM node ${id}`); }
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
    const modernDaily = normalizeDaily(account.daily || {});
    const modernByDay = Object.fromEntries(modernDaily.map((item) => [item.day, { value: item.value, ts: item.ts }]));
    const legacyDaily = normalizeLegacyEntries(state.legacyEntries[account.id] || {});
    Object.entries(legacyDaily).forEach(([day, record]) => {
      if (!modernByDay[day] || modernByDay[day].ts < record.ts) modernByDay[day] = record;
    });
    const daily = Object.entries(modernByDay).map(([day, record]) => ({ day, ts: Number(record.ts || parseDayKey(day)), value: Number(record.value || 0) }))
      .sort((a, b) => a.ts - b.ts).map((point, index, arr) => {
        const prev = arr[index - 1]; const delta = prev ? point.value - prev.value : 0; const deltaPct = prev?.value ? (delta / prev.value) * 100 : 0;
        return { ...point, delta, deltaPct };
      });
    const current = daily.at(-1)?.value ?? 0;
    const range = computeDeltaForRange(daily, state.rangeMode);
    return { ...account, daily, current, range };
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
  return Object.entries(state.balance.tx || {}).map(([id, row]) => ({ id, ...row, amount: Number(row.amount || 0) }))
    .filter((row) => Number.isFinite(row.amount) && row.monthKey).sort((a, b) => new Date(b.dateISO || 0) - new Date(a.dateISO || 0));
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
  return [...new Set(['Comida', ...dynamic, ...fromTx])].sort((a, b) => a.localeCompare(b, 'es'));
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
  const total = accounts.reduce((sum, account) => sum + account.current, 0);
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
        <div id="finance-lineChart" class="${chart.tone}">${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos para este rango.</div>'}</div></article>
      <article class="finance__controls">
        <select class="finance-pill" data-range><option value="total" ${state.rangeMode === 'total' ? 'selected' : ''}>Total</option><option value="month" ${state.rangeMode === 'month' ? 'selected' : ''}>Mes</option><option value="week" ${state.rangeMode === 'week' ? 'selected' : ''}>Semana</option><option value="year" ${state.rangeMode === 'year' ? 'selected' : ''}>Año</option></select>
        <button class="finance-pill" data-history>Historial</button>
        <select class="finance-pill" data-compare><option value="month" ${state.compareMode === 'month' ? 'selected' : ''}>Mes vs Mes</option><option value="week" ${state.compareMode === 'week' ? 'selected' : ''}>Semana vs Semana</option></select><button class="finance-pill finance-pill--secondary" type="button">Actualizar</button></article>
      <article class="finance__compareRow"><div class="finance-chip ${toneClass(compareCurrent.delta)}">Actual: ${fmtSignedCurrency(compareCurrent.delta)} (${fmtSignedPercent(compareCurrent.deltaPct)})</div><div class="finance-chip ${toneClass(comparePrev.delta)}">Anterior: ${fmtSignedCurrency(comparePrev.delta)} (${fmtSignedPercent(comparePrev.deltaPct)})</div></article>
      <article class="finance__accounts"><div class="finance__sectionHeader"><h2>Cuentas</h2><button class="finance-pill" data-new-account>+ Cuenta</button></div>
      <div id="finance-accountsList">${accounts.map((account) => `<article class="financeAccountCard ${toneClass(account.range.delta)}" data-open-detail="${account.id}"><div><strong>${escapeHtml(account.name)}</strong><input class="financeAccountCard__balance" data-account-input="${account.id}" value="${account.current.toFixed(2)}" inputmode="decimal" /></div><div class="financeAccountCard__side"><span class="financeAccountCard__deltaPill finance-chip ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]} ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span><button class="financeAccountCard__menuBtn" data-delete-account="${account.id}">⋯</button></div></article>`).join('') || '<p class="finance-empty">Sin cuentas todavía.</p>'}</div></article>
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
    .filter((row) => state.balanceFilterCategory === 'all' || row.category === state.balanceFilterCategory);
  const categories = categoriesList();
  const monthSummary = summaryForMonth(monthKey);
  const prevSummary = summaryForMonth(offsetMonthKey(monthKey, -1));
  const deltaNet = monthSummary.net - prevSummary.net;
  const deltaPct = prevSummary.net ? (deltaNet / Math.abs(prevSummary.net)) * 100 : 0;
  const budgets = state.balance.budgets?.[monthKey] || {};
  const spentByCategory = {};
  balanceTxList().filter((row) => row.monthKey === monthKey && row.type === 'expense').forEach((row) => { spentByCategory[row.category || 'Sin categoría'] = (spentByCategory[row.category || 'Sin categoría'] || 0) + row.amount; });
  const categoriesWithBudget = Object.keys(budgets).filter((cat) => cat !== '_total');
  const totalSpent = Object.values(spentByCategory).reduce((s, v) => s + v, 0);
  const totalLimit = Number(budgets._total?.limit || categoriesWithBudget.reduce((sumLimits, cat) => sumLimits + Number(budgets[cat]?.limit || 0), 0));
  return `<section class="financeBalanceView"><header class="financeViewHeader"><h2>Balance</h2><button class="finance-pill" data-open-modal="tx">+ Añadir</button></header>
  <article class="financeGlassCard"><div class="finance-row"><button class="finance-pill" data-balance-month="-1">◀</button><strong>${monthLabelByKey(monthKey)}</strong><button class="finance-pill" data-balance-month="1">▶</button></div>
  <div class="financeSummaryGrid"><div><small>Ingresos</small><strong class="is-positive">${fmtCurrency(monthSummary.income)}</strong></div><div><small>Gastos</small><strong class="is-negative">${fmtCurrency(monthSummary.expense)}</strong></div><div><small>Inversión</small><strong class="is-neutral">${fmtCurrency(monthSummary.invest)}</strong></div><div><small>Neto</small><strong class="${toneClass(monthSummary.net)}">${fmtCurrency(monthSummary.net)}</strong></div></div>
  <div class="finance-chip ${toneClass(deltaNet)}">Mes anterior: ${fmtSignedCurrency(deltaNet)} (${fmtSignedPercent(deltaPct)})</div></article>
  <article class="financeGlassCard"><div class="finance-row"><h3>Transacciones</h3><div class="finance-row"><select class="finance-pill" data-balance-type><option value="all">Todos</option><option value="expense" ${state.balanceFilterType === 'expense' ? 'selected' : ''}>Gasto</option><option value="income" ${state.balanceFilterType === 'income' ? 'selected' : ''}>Ingreso</option><option value="invest" ${state.balanceFilterType === 'invest' ? 'selected' : ''}>Inversión</option></select><select class="finance-pill" data-balance-category><option value="all">Todas</option>${categories.map((c) => `<option ${state.balanceFilterCategory === c ? 'selected' : ''}>${escapeHtml(c)}</option>`).join('')}</select></div></div>
  <div class="financeTxList">${tx.map((row) => `<div class="financeTxRow"><span>${new Date(row.dateISO).toLocaleDateString('es-ES')}</span><span>${escapeHtml(row.note || row.category || '—')}</span><strong class="${row.type === 'income' ? 'is-positive' : row.type === 'expense' ? 'is-negative' : 'is-neutral'}">${fmtCurrency(row.amount)}</strong></div>`).join('') || '<p class="finance-empty">Sin movimientos en este mes.</p>'}</div></article>
  <article class="financeGlassCard"><div class="finance-row"><h3>Presupuestos</h3><button class="finance-pill" data-open-modal="budget">Editar presupuestos</button></div>
  <div class="financeBudgetList">${categories.map((cat) => {
    const spent = Number(spentByCategory[cat] || 0); const limit = Number(budgets[cat]?.limit || 0); const pct = limit ? (spent / limit) * 100 : 0;
    return `<div><div class="finance-row"><span>${escapeHtml(cat)}</span><small>${fmtCurrency(spent)} / ${limit ? fmtCurrency(limit) : '—'}</small></div><div class="financeProgress"><i style="width:${Math.min(100, pct)}%" class="${pct > 100 ? 'is-negative' : ''}"></i></div>${pct > 100 ? '<small class="is-negative">over</small>' : ''}</div>`;
  }).join('')}<div><div class="finance-row"><strong>Total</strong><small>${fmtCurrency(totalSpent)} / ${totalLimit ? fmtCurrency(totalLimit) : '—'}</small></div><div class="financeProgress"><i style="width:${totalLimit ? Math.min(100, (totalSpent / totalLimit) * 100) : 0}%" class="${totalLimit && totalSpent > totalLimit ? 'is-negative' : ''}"></i></div></div></div></article></section>`;
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

function renderModal(accounts) {
  const backdrop = document.getElementById('finance-modalOverlay');
  if (!backdrop) return;
  const categories = categoriesList();
  if (!state.modal.type) {
    backdrop.classList.remove('is-open'); backdrop.classList.add('hidden'); backdrop.setAttribute('aria-hidden', 'true'); backdrop.innerHTML = ''; document.body.classList.remove('finance-modal-open'); return;
  }
  backdrop.classList.add('is-open'); backdrop.classList.remove('hidden'); backdrop.setAttribute('aria-hidden', 'false'); document.body.classList.add('finance-modal-open');
  if (state.modal.type === 'tx') {
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Añadir transacción</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <form class="finance-entry-form finance-tx-form" data-balance-form>
      <select name="type" class="finance-pill"><option value="expense">Gasto</option><option value="income">Ingreso</option><option value="invest">Inversión</option></select>
      <input required name="amount" type="number" step="0.01" placeholder="Cantidad €" />
      <input name="dateISO" type="date" value="${dayKeyFromTs(Date.now())}" />
      <input name="category" list="finance-cat-list" value="Comida" placeholder="Categoría" />
      <datalist id="finance-cat-list">${categories.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('')}</datalist>
      <input name="note" type="text" placeholder="Nota (opcional)" />
      <button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'budget') {
    const monthKey = getSelectedBalanceMonthKey(); const budgets = state.balance.budgets?.[monthKey] || {};
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Editar presupuestos (${monthKey})</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <form class="finance-budget-form" data-budget-form>${categories.map((c) => `<label>${escapeHtml(c)}<input data-budget-cat="${escapeHtml(c)}" type="number" step="0.01" value="${Number(budgets[c]?.limit || 0)}" /></label>`).join('')}<label>Total<input data-budget-total type="number" step="0.01" value="${Number(budgets._total?.limit || 0)}"/></label><button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'goal') {
    const accountsOptions = accounts.map((a) => `<label><input type="checkbox" name="accountsIncluded" value="${a.id}" /> ${escapeHtml(a.name)}</label>`).join('');
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Nuevo objetivo</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
    <form class="finance-goal-form" data-goal-form><input name="title" required placeholder="Título" /><input name="targetAmount" required type="number" step="0.01" placeholder="Cantidad objetivo"/><input name="dueDateISO" required type="date" /><fieldset><legend>Cuentas incluidas</legend>${accountsOptions || '<p class="finance-empty">No hay cuentas.</p>'}</fieldset><button class="finance-pill" type="submit">Guardar</button></form></div>`;
    return;
  }
  if (state.modal.type === 'goal-detail') {
    const goal = state.goals.goals?.[state.modal.goalId]; if (!goal) { state.modal = { type: null }; render(); return; }
    const selected = new Set(goal.accountsIncluded || []);
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>${escapeHtml(goal.title)}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <p>Meta ${fmtCurrency(goal.targetAmount)} · vence ${new Date(goal.dueDateISO).toLocaleDateString('es-ES')}</p><p>Prioridad por (dinero / días).</p>
      <form data-goal-accounts-form="${state.modal.goalId}">${accounts.map((a) => `<label><input type="checkbox" value="${a.id}" ${selected.has(a.id) ? 'checked' : ''}/> ${escapeHtml(a.name)}</label>`).join('')}<button class="finance-pill" type="submit">Actualizar cuentas</button></form></div>`;
    return;
  }

  // legacy modals
  if (state.modal.type === 'history') {
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Historial</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><div class="finance-history-list">${accounts.map((account) => `<details class="finance-history-item" data-history-account="${account.id}"><summary><strong>${escapeHtml(account.name)}</strong><small>${account.daily.length} registros · ${fmtCurrency(account.current)}</small></summary><div class="finance-history-rows" data-history-rows="${account.id}"><p class="finance-empty">Pulsa para cargar…</p></div></details>`).join('') || '<p class="finance-empty">Sin historial.</p>'}</div></div>`;
    return;
  }
  if (state.modal.type === 'new-account') {
    backdrop.innerHTML = `<div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1"><header><h3>Nueva cuenta</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><form class="finance-entry-form" data-new-account-form><input type="text" data-account-name-input placeholder="Nombre de la cuenta" required /><button class="finance-pill" type="submit">Crear cuenta</button></form></div>`;
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
      if (!current || Number(current.ts || 0) < Number(record.ts)) { updatesMap[`${state.financePath}/accounts/${account.id}/daily/${day}`] = { value: record.value, ts: record.ts }; writes += 1; }
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
  state.balance = { tx: val.balance?.tx || {}, categories: val.balance?.categories || {}, budgets: val.balance?.budgets || {}, snapshots: val.balance?.snapshots || {}, lastSeenMonthKey: val.balance?.lastSeenMonthKey || '' };
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
    state.balance = { tx: val.balance?.tx || {}, categories: val.balance?.categories || {}, budgets: val.balance?.budgets || {}, snapshots: val.balance?.snapshots || {}, lastSeenMonthKey: val.balance?.lastSeenMonthKey || '' };
    state.goals = { goals: val.goals?.goals || {} };
    render();
  }, (error) => { state.error = String(error?.message || error); render(); });
}

async function addAccount(name) {
  const id = push(ref(db, `${state.financePath}/accounts`)).key;
  await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${id}`), { id, name, createdAt: nowTs(), updatedAt: nowTs(), daily: {} }));
}
async function saveDaily(accountId, day, value, ts = nowTs()) {
  const parsedValue = Number(String(value).replace(',', '.')); if (!Number.isFinite(parsedValue) || !day) return false;
  await safeFirebase(() => set(ref(db, `${state.financePath}/accounts/${accountId}/daily/${day}`), { value: parsedValue, ts: Number(ts) }));
  await safeFirebase(() => update(ref(db, `${state.financePath}/accounts/${accountId}`), { updatedAt: nowTs(), lastValue: parsedValue }));
  toast('Guardado'); return true;
}
async function deleteDay(accountId, day) { await safeFirebase(() => remove(ref(db, `${state.financePath}/accounts/${accountId}/daily/${day}`))); }
async function deleteAccount(accountId) { await safeFirebase(() => remove(ref(db, `${state.financePath}/accounts/${accountId}`))); }

function render() {
  const host = document.getElementById('finance-content'); if (!host) return;
  renderFinanceNav();
  if (state.error) { host.innerHTML = `<article class="finance-panel"><h3>Error cargando finanzas</h3><p>${state.error}</p></article>`; return; }
  const accounts = buildAccountModels(); const totalSeries = buildTotalSeries(accounts);
  if (state.activeView === 'balance') { host.innerHTML = renderFinanceBalance(); maybeRolloverSnapshot(); }
  else if (state.activeView === 'goals') host.innerHTML = renderFinanceGoals();
  else if (state.activeView === 'calendar') host.innerHTML = renderFinanceCalendar(accounts, totalSeries);
  else host.innerHTML = renderFinanceHome(accounts, totalSeries);
  renderModal(accounts);
  renderToast();
}

function bindEvents() {
  const view = document.getElementById('view-finance'); if (!view || view.dataset.financeBound === '1') return; view.dataset.financeBound = '1';
  view.addEventListener('click', async (event) => {
    const target = event.target;
    const nextView = target.closest('[data-finance-view]')?.dataset.financeView; if (nextView) { state.activeView = nextView; render(); return; }
    if (target.closest('[data-close-modal]') || target.id === 'finance-modalOverlay') { state.modal = { type: null }; render(); return; }
    if (target.closest('[data-history]')) { state.modal = { type: 'history' }; render(); return; }
    if (target.closest('[data-new-account]')) { state.modal = { type: 'new-account' }; render(); return; }
    const openAccount = target.closest('[data-open-detail]')?.dataset.openDetail; if (openAccount && !target.closest('[data-account-input]')) { state.modal = { type: 'history' }; render(); return; }
    const delAcc = target.closest('[data-delete-account]')?.dataset.deleteAccount; if (delAcc && window.confirm('¿Eliminar esta cuenta y todos sus registros?')) { await deleteAccount(delAcc); return; }
    const delDay = target.closest('[data-delete-day]')?.dataset.deleteDay; if (delDay) { const [accountId, day] = delDay.split(':'); if (window.confirm(`¿Eliminar ${day}?`)) await deleteDay(accountId, day); return; }
    const monthShift = target.closest('[data-month-shift]')?.dataset.monthShift; if (monthShift) { state.calendarMonthOffset += Number(monthShift); render(); return; }
    const bMonth = target.closest('[data-balance-month]')?.dataset.balanceMonth; if (bMonth) { state.balanceMonthOffset += Number(bMonth); render(); return; }
    const openModal = target.closest('[data-open-modal]')?.dataset.openModal; if (openModal) { state.modal = { type: openModal }; render(); return; }
    const openGoal = target.closest('[data-open-goal]')?.dataset.openGoal; if (openGoal) { state.modal = { type: 'goal-detail', goalId: openGoal }; render(); return; }
    const delGoal = target.closest('[data-delete-goal]')?.dataset.deleteGoal; if (delGoal && window.confirm('¿Borrar objetivo?')) { await safeFirebase(() => remove(ref(db, `${state.financePath}/goals/goals/${delGoal}`))); return; }
  });

  view.addEventListener('change', (event) => {
    if (event.target.matches('[data-range]')) { state.rangeMode = event.target.value; render(); }
    if (event.target.matches('[data-compare]')) { state.compareMode = event.target.value; render(); }
    if (event.target.matches('[data-calendar-account]')) { state.calendarAccountId = event.target.value; render(); }
    if (event.target.matches('[data-calendar-mode]')) { state.calendarMode = event.target.value; render(); }
    if (event.target.matches('[data-balance-type]')) { state.balanceFilterType = event.target.value; render(); }
    if (event.target.matches('[data-balance-category]')) { state.balanceFilterCategory = event.target.value; render(); }
  });

  view.addEventListener('focusout', (event) => {
    if (!event.target.matches('[data-account-input]')) return;
    const day = dayKeyFromTs(Date.now()); const accountId = event.target.dataset.accountInput; clearTimeout(state.saveTimers[accountId]);
    state.saveTimers[accountId] = setTimeout(() => saveDaily(accountId, day, event.target.value, Date.now()), 220);
  });

  view.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-new-account-form]')) {
      event.preventDefault(); const name = event.target.querySelector('[data-account-name-input]')?.value?.trim(); if (name) await addAccount(name); state.modal = { type: null }; render(); return;
    }
    if (event.target.matches('[data-balance-form]')) {
      event.preventDefault();
      const form = new FormData(event.target);
      const type = String(form.get('type') || 'expense'); const amount = Number(form.get('amount') || 0); const dateISO = String(form.get('dateISO') || dayKeyFromTs(Date.now()));
      const category = String(form.get('category') || 'Comida').trim() || 'Comida'; const note = String(form.get('note') || '').trim();
      const monthKey = dateISO.slice(0, 7); const txId = push(ref(db, `${state.financePath}/balance/tx`)).key;
      await safeFirebase(() => set(ref(db, `${state.financePath}/balance/tx/${txId}`), { amount, category, note, dateISO: `${dateISO}T12:00:00.000Z`, monthKey, type }));
      if (!state.balance.categories?.[category]) await safeFirebase(() => set(ref(db, `${state.financePath}/balance/categories/${category}`), { createdAt: nowTs() }));
      state.modal = { type: null }; toast('Transacción guardada'); render(); return;
    }
    if (event.target.matches('[data-budget-form]')) {
      event.preventDefault(); const monthKey = getSelectedBalanceMonthKey(); const updatesMap = {};
      event.target.querySelectorAll('[data-budget-cat]').forEach((input) => {
        const cat = input.dataset.budgetCat; const limit = Number(input.value || 0); updatesMap[`${state.financePath}/balance/budgets/${monthKey}/${cat}/limit`] = limit;
      });
      updatesMap[`${state.financePath}/balance/budgets/${monthKey}/_total/limit`] = Number(event.target.querySelector('[data-budget-total]')?.value || 0);
      await safeFirebase(() => update(ref(db), updatesMap)); state.modal = { type: null }; toast('Presupuestos guardados'); render(); return;
    }
    if (event.target.matches('[data-goal-form]')) {
      event.preventDefault(); const form = new FormData(event.target); const goalId = push(ref(db, `${state.financePath}/goals/goals`)).key;
      const payload = { title: String(form.get('title') || '').trim(), targetAmount: Number(form.get('targetAmount') || 0), dueDateISO: `${form.get('dueDateISO')}T00:00:00.000Z`, accountsIncluded: form.getAll('accountsIncluded'), createdAt: nowTs(), updatedAt: nowTs() };
      await safeFirebase(() => set(ref(db, `${state.financePath}/goals/goals/${goalId}`), payload)); state.modal = { type: null }; toast('Objetivo creado'); render(); return;
    }
    const goalAccountsId = event.target.dataset.goalAccountsForm;
    if (goalAccountsId) {
      event.preventDefault(); const ids = [...event.target.querySelectorAll('input[type="checkbox"]:checked')].map((el) => el.value);
      await safeFirebase(() => update(ref(db, `${state.financePath}/goals/goals/${goalAccountsId}`), { accountsIncluded: ids, updatedAt: nowTs() }));
      state.modal = { type: null }; render();
    }
  });

  view.addEventListener('toggle', (event) => {
    const details = event.target.closest('[data-history-account]'); if (!details || !details.open) return;
    const accountId = details.dataset.historyAccount; const host = view.querySelector(`[data-history-rows="${accountId}"]`); if (!host || host.dataset.loaded === '1') return;
    const account = buildAccountModels().find((item) => item.id === accountId); host.dataset.loaded = '1';
    host.innerHTML = account?.daily?.length ? account.daily.slice().reverse().map((row) => `<div class="finance-history-row"><span>${new Date(row.ts).toLocaleDateString('es-ES')}</span><span>${fmtCurrency(row.value)}</span><span class="${toneClass(row.delta)}">${fmtSignedCurrency(row.delta)}</span><span class="${toneClass(row.deltaPct)}">${fmtSignedPercent(row.deltaPct)}</span></div>`).join('') : '<p class="finance-empty">Sin registros.</p>';
  }, true);
}

async function boot() {
  state.deviceId = getDeviceId();
  state.financePath = `bookshell/finance/${state.deviceId}`;
  log('init ok', { financePath: state.financePath });
  bindEvents();
  await loadDataOnce();
  subscribe();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
