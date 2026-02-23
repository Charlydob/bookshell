import { get, onValue, push, ref, remove, set, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';

const FIN_PATH = 'finance';
const DAY_MS = 86400000;
const RANGE_LABEL = { total: 'Total', month: 'Mes', week: 'Semana', year: 'Año' };

const state = {
  rangeMode: 'month',
  compareMode: 'month',
  accounts: [],
  legacyEntries: {},
  modal: { type: null, accountId: null },
  toast: '',
  calendarMonthOffset: 0,
  calendarAccountId: 'total',
  calendarMode: 'day',
  unsubscribe: null,
  saveTimers: {},
  error: ''
};

function log(...parts) {
  console.log('[finance]', ...parts);
}

function warnMissing(id) {
  console.warn(`[finance] missing DOM node ${id}`);
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
  return `${sign}${num.toFixed(2)}%`;
}

function toneClass(value) {
  if (value > 0) return 'is-positive';
  if (value < 0) return 'is-negative';
  return 'is-neutral';
}

function dayKeyFromTs(ts) {
  const d = new Date(Number(ts || Date.now()));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDayKey(key) {
  return new Date(`${key}T00:00:00`).getTime();
}

function normalizeDaily(daily = {}) {
  return Object.entries(daily)
    .map(([day, record]) => ({ day, ts: Number(record?.ts || parseDayKey(day)), value: Number(record?.value || 0) }))
    .filter((item) => Number.isFinite(item.value) && item.day)
    .sort((a, b) => a.ts - b.ts);
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

function buildAccountModels() {
  return state.accounts.map((account) => {
    const modernDaily = normalizeDaily(account.daily || {});
    const modernByDay = Object.fromEntries(modernDaily.map((item) => [item.day, { value: item.value, ts: item.ts }]));
    const legacyDaily = normalizeLegacyEntries(state.legacyEntries[account.id] || {});
    Object.entries(legacyDaily).forEach(([day, record]) => {
      if (!modernByDay[day] || modernByDay[day].ts < record.ts) modernByDay[day] = record;
    });
    const daily = Object.entries(modernByDay)
      .map(([day, record]) => ({ day, ts: Number(record.ts || parseDayKey(day)), value: Number(record.value || 0) }))
      .sort((a, b) => a.ts - b.ts)
      .map((point, index, arr) => {
        const prev = arr[index - 1];
        const delta = prev ? point.value - prev.value : 0;
        const deltaPct = prev?.value ? (delta / prev.value) * 100 : 0;
        return { ...point, delta, deltaPct };
      });

    const current = daily.at(-1)?.value ?? 0;
    const range = computeDeltaForRange(daily, state.rangeMode);
    return { ...account, daily, current, range };
  });
}

function getRangeBounds(mode, anchorDate = new Date()) {
  const now = new Date(anchorDate);
  if (mode === 'total') return { start: -Infinity, end: Infinity };
  if (mode === 'week') {
    const day = now.getDay() || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - day + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start: start.getTime(), end: end.getTime() };
  }
  if (mode === 'year') {
    const start = new Date(now.getFullYear(), 0, 1).getTime();
    const end = new Date(now.getFullYear() + 1, 0, 1).getTime();
    return { start, end };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return { start, end };
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

function buildTotalSeries(accounts) {
  const daySet = new Set();
  accounts.forEach((account) => account.daily.forEach((point) => daySet.add(point.day)));
  const days = [...daySet].sort();
  if (!days.length) return [];

  const perAccount = Object.fromEntries(accounts.map((account) => [account.id, Object.fromEntries(account.daily.map((p) => [p.day, p.value]))]));
  const running = Object.fromEntries(accounts.map((account) => [account.id, 0]));

  return days.map((day) => {
    accounts.forEach((account) => {
      if (perAccount[account.id][day] != null) running[account.id] = perAccount[account.id][day];
    });
    return { day, ts: parseDayKey(day), value: Object.values(running).reduce((sum, val) => sum + Number(val || 0), 0) };
  });
}

function filterSeriesByRange(series, mode) {
  if (mode === 'total') return series;
  const { start, end } = getRangeBounds(mode);
  const filtered = series.filter((point) => point.ts >= start && point.ts < end);
  return filtered.length ? filtered : series.slice(-1);
}

function aggregateYear(series) {
  if (!series.length) return [];
  if (series.length <= 45) return series;
  const byMonth = {};
  series.forEach((point) => {
    const d = new Date(point.ts);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    byMonth[key] = point;
  });
  return Object.entries(byMonth).map(([key, point]) => ({ ...point, day: `${key}-01` })).sort((a, b) => a.ts - b.ts);
}

function chartModelForRange(series, mode) {
  let points = filterSeriesByRange(series, mode);
  if (mode === 'year') points = aggregateYear(points);
  const delta = computeDeltaForRange(points.map((point) => ({ ...point, value: point.value })), 'total').delta;
  return { points, tone: toneClass(delta) };
}

function linePath(points, width = 320, height = 120) {
  if (!points.length) return '';
  const vals = points.map((point) => point.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const spread = max - min || 1;
  return points
    .map((point, index) => {
      const x = (index / Math.max(points.length - 1, 1)) * width;
      const y = height - ((point.value - min) / spread) * height;
      return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}

function pointDots(points, width = 300, height = 96) {
  if (!points.length) return '';
  const vals = points.map((point) => point.value);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const spread = max - min || 1;
  return points.map((point, index) => {
    const x = (index / Math.max(points.length - 1, 1)) * width;
    const y = height - ((point.value - min) / spread) * height;
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3" class="${toneClass(point.delta)}"/>`;
  }).join('');
}

function monthLabel(offset = 0) {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return new Intl.DateTimeFormat('es-ES', { month: 'long', year: 'numeric' }).format(d);
}

function calendarData(accounts, totalSeries) {
  const date = new Date();
  date.setMonth(date.getMonth() + state.calendarMonthOffset);

  const year = date.getFullYear();
  const month = date.getMonth();
  const monthStartDate = new Date(year, month, 1);
  const monthStart = monthStartDate.getTime();
  const monthEnd = new Date(year, month + 1, 1).getTime();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const firstWeekdayOffset = (monthStartDate.getDay() + 6) % 7;

  const source = state.calendarAccountId === 'total'
    ? totalSeries.map((point, idx, arr) => ({ ...point, delta: idx ? point.value - arr[idx - 1].value : 0 }))
    : (accounts.find((acc) => acc.id === state.calendarAccountId)?.daily || []);

  const pointsByDay = {};
  source
    .filter((point) => point.ts >= monthStart && point.ts < monthEnd)
    .forEach((point) => {
      const prev = source.filter((i) => i.ts < point.ts).at(-1);
      const delta = prev ? point.value - prev.value : point.delta || 0;
      const deltaPct = prev?.value ? (delta / prev.value) * 100 : 0;
      const dayNumber = new Date(point.ts).getDate();
      pointsByDay[dayNumber] = { ...point, delta, deltaPct, dayNumber };
    });

  const cells = [];
  for (let i = 0; i < firstWeekdayOffset; i += 1) cells.push(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(pointsByDay[day] || { dayNumber: day, delta: 0, deltaPct: 0, isEmpty: true });
  }

  return { cells, daysInMonth };
}

function render() {
  const host = document.getElementById('finance-content');
  if (!host) return warnMissing('finance-content');

  if (state.error) {
    host.innerHTML = `<article class="finance-panel"><h3>Error cargando finanzas</h3><p>${state.error}</p></article>`;
    return;
  }

  const accounts = buildAccountModels();
  const totalSeries = buildTotalSeries(accounts);
  const total = accounts.reduce((sum, account) => sum + account.current, 0);
  const totalRange = computeDeltaForRange(totalSeries, state.rangeMode);
  const chart = chartModelForRange(totalSeries, state.rangeMode);
  const compareBounds = getRangeBounds(state.compareMode);
  const compareCurrent = computeDeltaWithinBounds(totalSeries, compareBounds);
  const previousBounds = {
    start: compareBounds.start - (compareBounds.end - compareBounds.start),
    end: compareBounds.start
  };
  const comparePrev = computeDeltaWithinBounds(totalSeries, previousBounds);

  const calendar = calendarData(accounts, totalSeries);
  const weekdayLabels = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];

  host.innerHTML = `
    <section class="finance-home ${toneClass(totalRange.delta)}">
      <article class="finance__hero">
        <p class="finance__eyebrow">TOTAL</p>
        <h2 id="finance-totalValue" class="finance__total">${fmtCurrency(total)}</h2>
        <p id="finance-totalDelta" class="finance__delta ${toneClass(totalRange.delta)}">${fmtSignedCurrency(totalRange.delta)} · ${fmtSignedPercent(totalRange.deltaPct)}</p>
        <div id="finance-lineChart" class="finance__chart ${chart.tone}">
          ${chart.points.length ? `<svg viewBox="0 0 320 120" preserveAspectRatio="none"><path d="${linePath(chart.points)}"/></svg>` : '<div class="finance-empty">Sin datos para este rango.</div>'}
        </div>
      </article>

      <article class="finance__controls">
        <select id="finance-rangeSelect" class="finance-pill" data-range>
          <option value="total" ${state.rangeMode === 'total' ? 'selected' : ''}>Total</option>
          <option value="month" ${state.rangeMode === 'month' ? 'selected' : ''}>Mes</option>
          <option value="week" ${state.rangeMode === 'week' ? 'selected' : ''}>Semana</option>
          <option value="year" ${state.rangeMode === 'year' ? 'selected' : ''}>Año</option>
        </select>
        <button id="finance-historyBtn" class="finance-pill" data-history>Historial</button>
        <select id="finance-compareSelect" class="finance-pill" data-compare>
          <option value="month" ${state.compareMode === 'month' ? 'selected' : ''}>Mes vs Mes</option>
          <option value="week" ${state.compareMode === 'week' ? 'selected' : ''}>Semana vs Semana</option>
        </select>
        <button id="finance-refreshBtn" class="finance-pill finance-pill--secondary" type="button" aria-hidden="true" tabindex="-1">Actualizar</button>
      </article>

      <article class="finance__compareRow">
        <div id="finance-currentComparePill" class="finance-chip ${toneClass(compareCurrent.delta)}">${state.compareMode === 'week' ? 'Semana' : 'Mes'} actual: ${fmtSignedCurrency(compareCurrent.delta)} (${fmtSignedPercent(compareCurrent.deltaPct)})</div>
        <div id="finance-prevComparePill" class="finance-chip ${toneClass(comparePrev.delta)}">${state.compareMode === 'week' ? 'Semana' : 'Mes'} anterior: ${fmtSignedCurrency(comparePrev.delta)} (${fmtSignedPercent(comparePrev.deltaPct)})</div>
      </article>

      <article class="finance__accounts">
        <div class="finance__sectionHeader"><h2>Cuentas</h2><button id="finance-addAccountBtn" class="finance-pill" data-new-account>+ Cuenta</button></div>
        <div id="finance-accountsList" class="finance-account-list">${accounts.map((account) => `
          <article class="financeAccountCard ${toneClass(account.range.delta)}" data-open-detail="${account.id}">
            <div class="financeAccountCard__main">
              <strong class="financeAccountCard__title">${account.name}</strong>
              <input class="financeAccountCard__balance" data-account-input="${account.id}" value="${account.current.toFixed(2)}" inputmode="decimal" placeholder="0.00" />
            </div>
            <div class="financeAccountCard__side">
              <span class="financeAccountCard__deltaPill finance-chip ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]} ${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span>
              <button class="financeAccountCard__menuBtn" data-delete-account="${account.id}" aria-label="Opciones de ${account.name}">⋯</button>
            </div>
          </article>
        `).join('') || '<p class="finance-empty">Sin cuentas todavía.</p>'}</div>
      </article>

      <article class="finance__calendarPreview">
        <div class="finance__sectionHeader">
          <h3>Calendario</h3>
          <span class="finance-month-label">${monthLabel(state.calendarMonthOffset)}</span>
        </div>
        <div class="finance-calendar-controls">
          <button class="finance-pill" data-month-shift="-1">◀</button>
          <select class="finance-pill" data-calendar-account>
            <option value="total" ${state.calendarAccountId === 'total' ? 'selected' : ''}>Total</option>
            ${accounts.map((account) => `<option value="${account.id}" ${state.calendarAccountId === account.id ? 'selected' : ''}>${account.name}</option>`).join('')}
          </select>
          <select class="finance-pill" data-calendar-mode>
            <option value="day" ${state.calendarMode === 'day' ? 'selected' : ''}>Día</option>
            <option value="month" ${state.calendarMode === 'month' ? 'selected' : ''}>Mes</option>
          </select>
          <button class="finance-pill" data-month-shift="1">▶</button>
        </div>
        <div class="finance-calendar-grid">
          <div class="finance-calendar-weekdays">${weekdayLabels.map((label) => `<span>${label}</span>`).join('')}</div>
          <div class="finance-calendar-days">
            ${calendar.cells.map((point) => {
              if (!point) return '<div class="financeCalCell financeCalCell--blank" aria-hidden="true"></div>';
              const tone = point.isEmpty ? 'is-neutral' : toneClass(point.delta);
              const valueLabel = point.isEmpty ? '—' : fmtSignedCurrency(point.delta);
              const percentLabel = point.isEmpty ? '—' : fmtSignedPercent(point.deltaPct);
              return `<div class="financeCalCell ${tone}"><strong>${point.dayNumber}</strong><span>${valueLabel}</span><span>${percentLabel}</span></div>`;
            }).join('')}
          </div>
        </div>
      </article>
    </section>
  `;

  renderModal(accounts);
  renderToast();
}

function renderModal(accounts) {
  const backdrop = document.getElementById('finance-modalOverlay');
  if (!backdrop) return warnMissing('finance-modalOverlay');

  if (!state.modal.type) {
    backdrop.classList.remove('is-open');
    backdrop.classList.add('hidden');
    backdrop.setAttribute('aria-hidden', 'true');
    backdrop.innerHTML = '';
    document.body.classList.remove('finance-modal-open');
    return;
  }

  backdrop.classList.add('is-open');
  backdrop.classList.remove('hidden');
  backdrop.setAttribute('aria-hidden', 'false');
  document.body.classList.add('finance-modal-open');

  if (state.modal.type === 'history') {
    backdrop.innerHTML = `
      <div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1">
        <header><h3>Historial</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
        <div class="finance-history-list">
          ${accounts.map((account) => `
            <details class="finance-history-item" data-history-account="${account.id}">
              <summary><strong>${account.name}</strong><small>${account.daily.length} registros · ${fmtCurrency(account.current)}</small></summary>
              <div class="finance-history-rows" data-history-rows="${account.id}"><p class="finance-empty">Pulsa para cargar…</p></div>
            </details>
          `).join('') || '<p class="finance-empty">Sin historial.</p>'}
        </div>
      </div>
    `;
    return;
  }

  if (state.modal.type === 'new-account') {
    backdrop.innerHTML = `
      <div id="finance-modal" class="finance-modal" role="dialog" aria-modal="true" tabindex="-1">
        <header><h3>Nueva cuenta</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
        <form class="finance-entry-form" data-new-account-form>
          <input type="text" data-account-name-input placeholder="Nombre de la cuenta" required />
          <button class="finance-pill" type="submit">Crear cuenta</button>
        </form>
      </div>
    `;
    backdrop.querySelector('#finance-modal')?.focus();
    return;
  }

  const account = accounts.find((item) => item.id === state.modal.accountId);
  if (!account) {
    state.modal = { type: null, accountId: null };
    render();
    return;
  }

  const chart = chartModelForRange(account.daily.map((point) => ({ ...point, value: point.value })), state.rangeMode);
  backdrop.innerHTML = `
    <div id="finance-modal" class="finance-modal ${toneClass(account.range.delta)}" role="dialog" aria-modal="true" tabindex="-1">
      <header>
        <h3>${account.name}</h3>
        <div class="finance-modal-actions"><button class="finance-pill" data-close-modal>Cerrar</button><button class="finance-pill" data-delete-account="${account.id}">Eliminar cuenta</button></div>
      </header>
      <p class="finance-delta ${toneClass(account.range.delta)}">${RANGE_LABEL[state.rangeMode]}: ${fmtSignedCurrency(account.range.delta)} · ${fmtSignedPercent(account.range.deltaPct)}</p>
      <div class="finance-chart ${chart.tone}">
        ${chart.points.length ? `<svg viewBox="0 0 300 96"><path d="${linePath(chart.points, 300, 96)}"/>${pointDots(chart.points, 300, 96)}</svg>` : '<div class="finance-empty">Sin datos de cuenta.</div>'}
      </div>
      <div class="finance-modal-actions">
        <button class="finance-pill" data-show-add-day="${account.id}">Añadir registro</button>
      </div>
      <form class="finance-entry-form hidden" data-entry-form="${account.id}">
        <input type="date" data-entry-day value="${dayKeyFromTs(Date.now())}" />
        <input type="number" step="0.01" data-entry-value placeholder="Saldo €" />
        <button class="finance-pill" type="submit">Actualizar</button>
      </form>
      <div class="finance-table-wrap">
        <table><thead><tr><th>Fecha</th><th>Valor</th><th>Δ€</th><th>Δ%</th><th></th></tr></thead><tbody>
          ${account.daily.slice().reverse().map((point) => `
            <tr>
              <td>${new Date(point.ts).toLocaleDateString('es-ES')}</td>
              <td>${fmtCurrency(point.value)}</td>
              <td class="${toneClass(point.delta)}">${fmtSignedCurrency(point.delta)}</td>
              <td class="${toneClass(point.deltaPct)}">${fmtSignedPercent(point.deltaPct)}</td>
              <td><button class="finance-pill finance-pill--mini" data-delete-day="${account.id}:${point.day}">⋯</button></td>
            </tr>
          `).join('') || '<tr><td colspan="5">Sin registros.</td></tr>'}
        </tbody></table>
      </div>
    </div>
  `;
  backdrop.querySelector('#finance-modal')?.focus();
}

function renderToast() {
  let toast = document.getElementById('finance-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'finance-toast';
    toast.className = 'finance-toast hidden';
    document.getElementById('view-finance')?.append(toast);
  }
  if (!state.toast) {
    toast.classList.add('hidden');
    toast.textContent = '';
    return;
  }
  toast.textContent = state.toast;
  toast.classList.remove('hidden');
}

function toast(message) {
  state.toast = message;
  renderToast();
  window.clearTimeout(state.toastTimer);
  state.toastTimer = window.setTimeout(() => {
    state.toast = '';
    renderToast();
  }, 1400);
}

async function migrateLegacy(entriesMap = {}, accounts = []) {
  const updates = {};
  let writes = 0;
  accounts.forEach((account) => {
    const legacyByDay = normalizeLegacyEntries(entriesMap[account.id] || {});
    Object.entries(legacyByDay).forEach(([day, record]) => {
      const current = account.daily?.[day];
      if (!current || Number(current.ts || 0) < Number(record.ts)) {
        updates[`${FIN_PATH}/accounts/${account.id}/daily/${day}`] = { value: record.value, ts: record.ts };
        writes += 1;
      }
    });
  });
  if (writes) {
    await update(ref(db), updates);
    log('legacy normalized daily writes', writes);
  }
}

async function loadDataOnce() {
  const snap = await get(ref(db, FIN_PATH));
  const val = snap.val() || {};
  const accountsMap = val.accounts || {};
  const entriesMap = val.accountsEntries || val.entries || {};
  state.accounts = Object.values(accountsMap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.legacyEntries = entriesMap;
  await migrateLegacy(entriesMap, state.accounts);
  log('loaded accounts:', state.accounts.length);
}

function subscribe() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = onValue(ref(db, FIN_PATH), (snap) => {
    const val = snap.val() || {};
    state.accounts = Object.values(val.accounts || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    state.legacyEntries = val.accountsEntries || val.entries || {};
    render();
  }, (error) => {
    state.error = String(error?.message || error);
    render();
  });
}

async function addAccount(name) {
  const id = push(ref(db, `${FIN_PATH}/accounts`)).key;
  await set(ref(db, `${FIN_PATH}/accounts/${id}`), { id, name, createdAt: Date.now(), updatedAt: Date.now(), daily: {} });
}

async function saveDaily(accountId, day, value, ts = Date.now()) {
  const parsedValue = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsedValue) || !day) return false;
  const account = state.accounts.find((item) => item.id === accountId);
  const existing = Number(account?.daily?.[day]?.value);
  if (Number.isFinite(existing) && Math.abs(existing - parsedValue) < 0.00001) return false;

  await set(ref(db, `${FIN_PATH}/accounts/${accountId}/daily/${day}`), { value: parsedValue, ts: Number(ts) });
  await update(ref(db, `${FIN_PATH}/accounts/${accountId}`), { updatedAt: Date.now(), lastValue: parsedValue });
  log('saved daily', accountId, day, parsedValue);
  toast('Guardado');
  return true;
}

async function deleteDay(accountId, day) {
  await remove(ref(db, `${FIN_PATH}/accounts/${accountId}/daily/${day}`));
}

async function deleteAccount(accountId) {
  await remove(ref(db, `${FIN_PATH}/accounts/${accountId}`));
  await remove(ref(db, `${FIN_PATH}/accountsEntries/${accountId}`));
}

function queueInputSave(accountId, inputEl) {
  const day = dayKeyFromTs(Date.now());
  const key = `${accountId}:${day}`;
  window.clearTimeout(state.saveTimers[key]);
  state.saveTimers[key] = window.setTimeout(async () => {
    await saveDaily(accountId, day, inputEl.value, Date.now());
  }, 220);
}

function bindEvents() {
  const view = document.getElementById('view-finance');
  if (!view) return warnMissing('view-finance');
  if (view.dataset.financeBound === '1') return;
  view.dataset.financeBound = '1';

  view.addEventListener('click', async (event) => {
    const target = event.target;

    if (target.closest('[data-history]')) {
      state.modal = { type: 'history', accountId: null };
      return render();
    }

    if (target.closest('[data-close-modal]') || target.id === 'finance-modalOverlay') {
      state.modal = { type: null, accountId: null };
      return render();
    }

    const openAccount = target.closest('[data-open-detail]')?.dataset.openDetail;
    if (openAccount && !target.closest('[data-account-input]')) {
      state.modal = { type: 'detail', accountId: openAccount };
      log('mount dom ok');
      return render();
    }

    if (target.closest('[data-new-account]')) {
      state.modal = { type: 'new-account', accountId: null };
      render();
      return;
    }

    const deleteDayPayload = target.closest('[data-delete-day]')?.dataset.deleteDay;
    if (deleteDayPayload) {
      const [accountId, day] = deleteDayPayload.split(':');
      if (window.confirm(`¿Eliminar el día ${day}?`)) await deleteDay(accountId, day);
      return;
    }

    const deleteAccountId = target.closest('[data-delete-account]')?.dataset.deleteAccount;
    if (deleteAccountId) {
      if (window.confirm('¿Eliminar esta cuenta y todos sus registros?')) await deleteAccount(deleteAccountId);
      state.modal = { type: null, accountId: null };
      return;
    }

    if (target.closest('[data-show-add-day]')) {
      view.querySelector('[data-entry-form]')?.classList.toggle('hidden');
      return;
    }

    const monthShift = target.closest('[data-month-shift]')?.dataset.monthShift;
    if (monthShift) {
      state.calendarMonthOffset += Number(monthShift);
      render();
    }
  });

  view.addEventListener('change', (event) => {
    if (event.target.matches('[data-range]')) {
      state.rangeMode = event.target.value;
      render();
    }
    if (event.target.matches('[data-compare]')) {
      state.compareMode = event.target.value;
      render();
    }
    if (event.target.matches('[data-calendar-account]')) {
      state.calendarAccountId = event.target.value;
      render();
    }
    if (event.target.matches('[data-calendar-mode]')) {
      state.calendarMode = event.target.value;
      render();
    }
  });

  view.addEventListener('focusin', (event) => {
    if (event.target.matches('[data-account-input]')) {
      event.target.dataset.initialValue = event.target.value;
      event.target.select();
    }
  });

  view.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || !event.target.matches('[data-account-input]')) return;
    event.preventDefault();
    queueInputSave(event.target.dataset.accountInput, event.target);
    event.target.blur();
  });

  view.addEventListener('focusout', async (event) => {
    if (!event.target.matches('[data-account-input]')) return;
    if (event.target.value === event.target.dataset.initialValue) return;
    queueInputSave(event.target.dataset.accountInput, event.target);
  });

  view.addEventListener('submit', async (event) => {
    if (event.target.matches('[data-new-account-form]')) {
      event.preventDefault();
      const name = event.target.querySelector('[data-account-name-input]')?.value?.trim();
      if (name) await addAccount(name);
      state.modal = { type: null, accountId: null };
      render();
      return;
    }

    if (!event.target.matches('[data-entry-form]')) return;
    event.preventDefault();
    const accountId = event.target.dataset.entryForm;
    const day = event.target.querySelector('[data-entry-day]')?.value;
    const value = event.target.querySelector('[data-entry-value]')?.value;
    await saveDaily(accountId, day, value, Date.now());
    event.target.classList.add('hidden');
  });

  view.addEventListener('toggle', (event) => {
    const details = event.target.closest('[data-history-account]');
    if (!details || !details.open) return;
    const accountId = details.dataset.historyAccount;
    const host = view.querySelector(`[data-history-rows="${accountId}"]`);
    if (!host || host.dataset.loaded === '1') return;
    const account = buildAccountModels().find((item) => item.id === accountId);
    host.dataset.loaded = '1';
    host.innerHTML = account?.daily?.length
      ? account.daily.slice().reverse().map((row) => `<div class="finance-history-row"><span>${new Date(row.ts).toLocaleDateString('es-ES')}</span><span>${fmtCurrency(row.value)}</span><span class="${toneClass(row.delta)}">${fmtSignedCurrency(row.delta)}</span><span class="${toneClass(row.deltaPct)}">${fmtSignedPercent(row.deltaPct)}</span></div>`).join('')
      : '<p class="finance-empty">Sin registros.</p>';
  }, true);
}

async function boot() {
  log('init ok');
  bindEvents();
  await loadDataOnce();
  subscribe();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
else boot();
