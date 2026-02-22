import { onValue, push, ref, set, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';

const FIN_PATH = 'vuxel/financeTab';
const RANGE_DAYS = { week: 7, month: 30, year: 365, total: Infinity };

const state = {
  subview: 'inicio',
  range: 'total',
  compareMode: 'month',
  showHistory: false,
  accounts: [],
  snapshotsByAccount: {},
  modalAccountId: null,
  calendarMonth: new Date(),
  error: ''
};

function log(...parts) {
  console.log('[Finance]', ...parts);
}

function fmtCurrency(value) {
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 2 }).format(Number(value || 0));
}

function fmtSignedCurrency(value) {
  const num = Number(value || 0);
  const sign = num > 0 ? '+' : '';
  return `${sign}${fmtCurrency(num)}`;
}

function fmtSignedPercent(value) {
  const num = Number(value || 0);
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)} %`;
}

function toneClass(value) {
  if (value > 0) return 'is-pos';
  if (value < 0) return 'is-neg';
  return 'is-neutral';
}

function toDateKey(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

function startOfDayMs(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function buildAccountModel() {
  const now = Date.now();
  const accounts = state.accounts.map((acc) => {
    const list = [...(state.snapshotsByAccount[acc.id] || [])].sort((a, b) => a.ts - b.ts);
    const current = list.at(-1)?.value ?? 0;
    const points = list.map((p) => ({ ...p, ts: Number(p.ts || 0), value: Number(p.value || 0), delta: Number(p.delta || 0), deltaPct: Number(p.deltaPct || 0) }));
    const range = computeRangeDelta(points, state.range, now);
    return { ...acc, snapshots: points, current, range };
  });
  return accounts;
}

function computeRangeDelta(points, range, nowTs) {
  if (!points.length) return { delta: 0, deltaPct: 0 };
  const days = RANGE_DAYS[range] ?? Infinity;
  const startTs = days === Infinity ? -Infinity : nowTs - days * 86400000;
  const inRange = points.filter((p) => p.ts >= startTs);
  const first = (inRange[0] || points[0]).value;
  const last = (inRange.at(-1) || points.at(-1)).value;
  const delta = last - first;
  const deltaPct = first ? (delta / first) * 100 : 0;
  return { delta, deltaPct };
}

function buildGlobalSeries(accounts) {
  const events = [];
  for (const account of accounts) {
    for (const snap of account.snapshots) events.push({ accountId: account.id, ...snap });
  }
  events.sort((a, b) => a.ts - b.ts);
  const values = Object.fromEntries(accounts.map((acc) => [acc.id, 0]));
  const series = [];
  for (const ev of events) {
    values[ev.accountId] = ev.value;
    const total = Object.values(values).reduce((sum, val) => sum + Number(val || 0), 0);
    series.push({ ts: ev.ts, total, dateKey: toDateKey(ev.ts) });
  }
  return series;
}

function periodFromRange(range, now = new Date()) {
  if (range === 'week') {
    const day = now.getDay() || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start: start.getTime(), end: end.getTime(), label: 'Semana' };
  }
  if (range === 'year') {
    const y = now.getFullYear();
    return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime(), label: 'Año' };
  }
  if (range === 'total') {
    return { start: -Infinity, end: Infinity, label: 'Total' };
  }
  return { start: new Date(now.getFullYear(), now.getMonth(), 1).getTime(), end: new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime(), label: 'Mes' };
}

function periodDelta(series, period) {
  if (!series.length) return { delta: 0, deltaPct: 0, start: 0, end: 0 };
  const startPoint = series.find((p) => p.ts >= period.start) || series[0];
  const endCandidates = series.filter((p) => p.ts < period.end);
  const endPoint = endCandidates.at(-1) || series.at(-1);
  const delta = endPoint.total - startPoint.total;
  const deltaPct = startPoint.total ? (delta / startPoint.total) * 100 : 0;
  return { delta, deltaPct, start: startPoint.total, end: endPoint.total };
}

function previousPeriod(period) {
  if (!Number.isFinite(period.start) || !Number.isFinite(period.end)) return period;
  const size = period.end - period.start;
  return { ...period, start: period.start - size, end: period.start };
}

function sparklinePath(values, width = 320, height = 110) {
  if (!values.length) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const spread = max - min || 1;
  return values.map((v, i) => {
    const x = (i / Math.max(values.length - 1, 1)) * width;
    const y = height - ((v - min) / spread) * height;
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function monthGrid(date, daily) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const first = new Date(y, m, 1);
  const start = new Date(first);
  start.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    const key = d.toISOString().slice(0, 10);
    cells.push({ date: d, inMonth: d.getMonth() === m, key, info: daily[key] || null });
  }
  return cells;
}

function deriveDailyGlobal(series) {
  const byDay = {};
  let prev = 0;
  const lastPerDay = {};
  for (const point of series) lastPerDay[point.dateKey] = point.total;
  const keys = Object.keys(lastPerDay).sort();
  for (const k of keys) {
    const total = lastPerDay[k];
    const delta = total - prev;
    byDay[k] = { delta, pct: prev ? (delta / prev) * 100 : 0, total };
    prev = total;
  }
  return byDay;
}

function render() {
  log('render start');
  const host = document.getElementById('finance-content');
  if (!host) return;
  if (state.error) {
    host.innerHTML = `<article class="finance-tab__panel"><h3>Error cargando finanzas</h3><p>${state.error}</p></article>`;
    return;
  }
  const accounts = buildAccountModel();
  const series = buildGlobalSeries(accounts);
  const total = accounts.reduce((sum, acc) => sum + acc.current, 0);
  const period = periodFromRange(state.range);
  const change = periodDelta(series, period);
  const compare = periodDelta(series, previousPeriod(period));
  const variationCls = toneClass(change.delta);
  const line = sparklinePath(series.map((s) => s.total));

  host.innerHTML = `
    <section class="finance-tab ${variationCls}">
      ${renderTopNav()}
      <div class="finance-tab__view ${state.subview === 'inicio' ? '' : 'is-hidden'}">${renderInicio(accounts, total, change, compare, line, period.label)}</div>
      <div class="finance-tab__view ${state.subview === 'objetivos' ? '' : 'is-hidden'}">${renderPlaceholder('Objetivos', 'Preparado para la siguiente iteración.')}</div>
      <div class="finance-tab__view ${state.subview === 'balance' ? '' : 'is-hidden'}">${renderPlaceholder('Balance', 'Resumen de gastos e ingresos próximamente.')}</div>
      <div class="finance-tab__view ${state.subview === 'calendario' ? '' : 'is-hidden'}">${renderCalendar(deriveDailyGlobal(series))}</div>
      <div class="finance-tab__view ${state.subview === 'extra' ? '' : 'is-hidden'}">${renderPlaceholder('Vista 5', 'Espacio reservado para futuras funciones.')}</div>
    </section>`;

  if (state.modalAccountId) renderModal(accounts.find((a) => a.id === state.modalAccountId));
  else hideModal();
  log('render end');
}

function renderTopNav() {
  const items = [
    ['inicio', '🏠', 'Inicio'], ['objetivos', '🎯', 'Objetivos'], ['balance', '📊', 'Balance'], ['calendario', '🗓️', 'Calendario'], ['extra', '✨', 'Vista 5']
  ];
  return `<nav class="finance-tab__mini-nav">${items.map(([id, icon, label]) => `<button class="finance-tab__mini-btn ${state.subview === id ? 'is-active' : ''}" data-subview="${id}" aria-label="${label}">${icon}</button>`).join('')}</nav>`;
}

function renderInicio(accounts, total, change, compare, line, periodLabel) {
  return `
    <article class="finance-tab__panel">
      <p class="finance-tab__eyebrow">TOTAL</p>
      <h2 class="finance-tab__total">${fmtCurrency(total)}</h2>
      <p class="finance-tab__delta ${toneClass(change.delta)}">${fmtSignedCurrency(change.delta)} · ${fmtSignedPercent(change.deltaPct)}</p>
      <div class="finance-tab__chart"><svg viewBox="0 0 320 110" preserveAspectRatio="none">${line ? `<path d="${line}"/>` : ''}</svg></div>
    </article>
    <article class="finance-tab__controls">
      <button class="finance-pill" data-refresh>Actualizar</button>
      <select class="finance-pill" data-range>
        <option value="month" ${state.range === 'month' ? 'selected' : ''}>Mes</option>
        <option value="week" ${state.range === 'week' ? 'selected' : ''}>Semana</option>
        <option value="year" ${state.range === 'year' ? 'selected' : ''}>Año</option>
        <option value="total" ${state.range === 'total' ? 'selected' : ''}>Total</option>
      </select>
      <button class="finance-pill" data-history>Historial</button>
      <select class="finance-pill" data-compare ${state.range === 'total' ? 'disabled' : ''}>
        <option value="month">Mes vs Mes</option>
        <option value="week">Semana vs Semana</option>
      </select>
    </article>
    <article class="finance-tab__compare-row">
      <div class="finance-tab__chip ${toneClass(change.delta)}">${periodLabel}: ${fmtSignedCurrency(change.delta)} (${fmtSignedPercent(change.deltaPct)})</div>
      <div class="finance-tab__chip ${toneClass(compare.delta)}">Anterior: ${fmtCurrency(compare.start)} → ${fmtCurrency(compare.end)}</div>
    </article>
    <article class="finance-tab__panel">
      <div class="finance-tab__panel-head"><h3>Cuentas</h3><button class="finance-pill" data-new-account>+ Cuenta</button></div>
      <div class="finance-tab__accounts">${accounts.map(renderAccountCard).join('') || '<p class="finance-tab__empty">Sin cuentas todavía.</p>'}</div>
    </article>`;
}

function renderAccountCard(account) {
  return `<button class="finance-tab__account ${toneClass(account.range.delta)}" data-open-modal="${account.id}">
      <div class="finance-tab__account-main">
        <span>${account.name}</span>
        <input class="finance-tab__balance-input" data-account-input="${account.id}" value="${Number(account.current).toFixed(2)}" inputmode="decimal" />
      </div>
      <span class="finance-tab__chip ${toneClass(account.range.delta)}">Mes ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span>
    </button>`;
}

function renderPlaceholder(title, description) {
  return `<article class="finance-tab__panel finance-tab__placeholder"><h3>${title}</h3><p>${description}</p></article>`;
}

function renderCalendar(daily) {
  const grid = monthGrid(state.calendarMonth, daily);
  return `<article class="finance-tab__panel">
    <div class="finance-tab__panel-head"><h3>Calendario</h3></div>
    <div class="finance-tab__calendar-controls"><select class="finance-pill"><option>Día</option><option>Mes</option><option>Año</option></select><select class="finance-pill"><option>${state.calendarMonth.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })}</option></select><select class="finance-pill"><option>Todas las cuentas</option></select></div>
    <div class="finance-tab__calendar-grid">${grid.map((cell) => {
      const info = cell.info;
      return `<div class="finance-tab__day ${cell.inMonth ? '' : 'is-out'} ${info ? toneClass(info.delta) : ''}"><strong>${cell.date.getDate()}</strong>${info ? `<small>${fmtSignedCurrency(info.delta)}</small><small>${fmtSignedPercent(info.pct)}</small>` : ''}</div>`;
    }).join('')}</div>
  </article>`;
}

function renderModal(account) {
  const backdrop = document.getElementById('finance-modal-backdrop');
  if (!backdrop || !account) return;
  const points = account.snapshots;
  const path = sparklinePath(points.map((p) => p.value), 300, 100);
  backdrop.classList.remove('hidden');
  backdrop.innerHTML = `<div class="finance-modal" role="dialog" aria-modal="true"><header><h3>${account.name}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header><button class="finance-pill" data-modal-update="${account.id}">Actualizar</button><div class="finance-tab__chart"><svg viewBox="0 0 300 100">${path ? `<path d="${path}"/>` : ''}${points.map((p, i) => `<circle cx="${(i / Math.max(points.length - 1, 1)) * 300}" cy="${100 - ((p.value - Math.min(...points.map((r) => r.value))) / ((Math.max(...points.map((r) => r.value)) - Math.min(...points.map((r) => r.value))) || 1)) * 100}" r="3" class="${toneClass(p.delta)}"></circle>`).join('')}</svg></div><div class="finance-tab__table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Δ€</th><th>Δ%</th></tr></thead><tbody>${points.slice().reverse().map((p) => `<tr><td>${new Date(p.ts).toLocaleString('es-ES')}</td><td>${fmtCurrency(p.value)}</td><td class="${toneClass(p.delta)}">${fmtSignedCurrency(p.delta)}</td><td class="${toneClass(p.deltaPct)}">${fmtSignedPercent(p.deltaPct)}</td></tr>`).join('') || '<tr><td colspan="4">Sin registros</td></tr>'}</tbody></table></div></div>`;
  log(`open modal ${account.id}`);
}

function hideModal() {
  const backdrop = document.getElementById('finance-modal-backdrop');
  if (!backdrop) return;
  backdrop.classList.add('hidden');
  backdrop.innerHTML = '';
}

async function addAccount(name) {
  const id = push(ref(db, `${FIN_PATH}/accounts`)).key;
  await set(ref(db, `${FIN_PATH}/accounts/${id}`), { id, name, createdAt: Date.now(), updatedAt: Date.now() });
}

async function saveSnapshot(accountId, rawValue) {
  const value = Number(String(rawValue).replace(',', '.'));
  if (!Number.isFinite(value)) return;
  const now = Date.now();
  const list = [...(state.snapshotsByAccount[accountId] || [])].sort((a, b) => a.ts - b.ts);
  const prev = Number(list.at(-1)?.value || 0);
  const delta = value - prev;
  const deltaPct = prev ? (delta / prev) * 100 : 0;
  const payload = { ts: now, dateKey: toDateKey(now), value, delta, deltaPct };
  await set(push(ref(db, `${FIN_PATH}/snapshots/${accountId}`)), payload);
  await update(ref(db, `${FIN_PATH}/accounts/${accountId}`), { updatedAt: now, lastValue: value });
  log(`save snapshot ${value}`);
}

function bindEvents() {
  const financeView = document.getElementById('view-finance');
  if (!financeView || financeView.dataset.financeBound === '1') return;
  financeView.dataset.financeBound = '1';

  financeView.addEventListener('click', async (event) => {
    const sub = event.target.closest('[data-subview]');
    if (sub) { state.subview = sub.dataset.subview; render(); return; }
    if (event.target.closest('[data-refresh]')) { render(); return; }
    if (event.target.closest('[data-history]')) { state.showHistory = !state.showHistory; return; }
    if (event.target.closest('[data-new-account]')) {
      const name = window.prompt('Nombre de la cuenta');
      if (name) await addAccount(name.trim());
      return;
    }
    const open = event.target.closest('[data-open-modal]');
    if (open && !event.target.closest('[data-account-input]')) { state.modalAccountId = open.dataset.openModal; render(); return; }
    if (event.target.closest('[data-close-modal]') || event.target.id === 'finance-modal-backdrop') { state.modalAccountId = null; render(); }
  });

  financeView.addEventListener('change', (event) => {
    if (event.target.matches('[data-range]')) { state.range = event.target.value; render(); }
    if (event.target.matches('[data-compare]')) { state.compareMode = event.target.value; render(); }
  });

  financeView.addEventListener('focusin', (event) => {
    if (event.target.matches('[data-account-input]')) event.target.select();
  });

  financeView.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || !event.target.matches('[data-account-input]')) return;
    event.preventDefault();
    await saveSnapshot(event.target.dataset.accountInput, event.target.value);
    event.target.blur();
  });

  financeView.addEventListener('focusout', async (event) => {
    if (!event.target.matches('[data-account-input]')) return;
    await saveSnapshot(event.target.dataset.accountInput, event.target.value);
  });
}

function subscribe() {
  onValue(ref(db, FIN_PATH), (snap) => {
    const val = snap.val() || {};
    const accountsMap = val.accounts || {};
    const snapshotsMap = val.snapshots || {};
    state.accounts = Object.values(accountsMap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    state.snapshotsByAccount = Object.fromEntries(Object.entries(snapshotsMap).map(([accId, list]) => [accId, Object.values(list || {})]));
    log('loaded accounts', state.accounts.length);
    render();
  }, (error) => {
    console.error('Finance load error', error);
    state.error = String(error?.message || error);
    render();
  });
}

function boot() {
  log('boot');
  bindEvents();
  subscribe();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
