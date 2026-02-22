import { get, onValue, push, ref, remove, set, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';

const FIN_PATH = 'finance';
const UI_KEY = 'financeTab.ui.v1';
const RANGE_DAYS = { week: 7, month: 30, year: 365, total: Infinity };

const initialUi = (() => {
  try {
    return JSON.parse(localStorage.getItem(UI_KEY) || '{}');
  } catch {
    return {};
  }
})();

const state = {
  subview: 'inicio',
  rangeMode: initialUi.rangeMode || 'total',
  compareMode: initialUi.compareMode || 'month',
  accounts: [],
  entriesByAccount: {},
  modal: { type: null, accountId: null },
  entryForm: { open: false, entryId: null, tsInput: '', valueInput: '' },
  error: '',
  unsubscribe: null
};

function persistUi() {
  localStorage.setItem(UI_KEY, JSON.stringify({ rangeMode: state.rangeMode, compareMode: state.compareMode }));
}

function log(...parts) {
  console.log('Finance:', ...parts);
}

function warnMissing(id) {
  console.warn(`Finance: missing DOM node ${id}`);
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

function toDateTimeLocal(ts = Date.now()) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function accountEntries(accountId) {
  return [...(state.entriesByAccount[accountId] || [])]
    .map((e) => ({ ...e, ts: Number(e.ts || 0), value: Number(e.value || 0) }))
    .sort((a, b) => a.ts - b.ts)
    .map((entry, index, arr) => {
      const prev = arr[index - 1];
      const delta = prev ? entry.value - prev.value : 0;
      const deltaPct = prev?.value ? (delta / prev.value) * 100 : 0;
      return { ...entry, delta, deltaPct, dateKey: toDateKey(entry.ts) };
    });
}

function computeRangeDelta(points, rangeMode, nowTs = Date.now()) {
  if (!points.length) return { delta: 0, deltaPct: 0 };
  const days = RANGE_DAYS[rangeMode] ?? Infinity;
  const startTs = days === Infinity ? -Infinity : nowTs - days * 86400000;
  const inRange = points.filter((p) => p.ts >= startTs);
  const first = (inRange[0] || points[0]).value;
  const last = (inRange.at(-1) || points.at(-1)).value;
  const delta = last - first;
  const deltaPct = first ? (delta / first) * 100 : 0;
  return { delta, deltaPct };
}

function buildAccountModel() {
  return state.accounts.map((acc) => {
    const entries = accountEntries(acc.id);
    const current = entries.at(-1)?.value ?? 0;
    return { ...acc, entries, current, range: computeRangeDelta(entries, state.rangeMode) };
  });
}

function buildGlobalSeries(accounts) {
  const events = [];
  for (const account of accounts) {
    for (const entry of account.entries) events.push({ accountId: account.id, ...entry });
  }
  events.sort((a, b) => a.ts - b.ts);
  const values = Object.fromEntries(accounts.map((acc) => [acc.id, 0]));
  const series = [];
  for (const ev of events) {
    values[ev.accountId] = ev.value;
    series.push({ ts: ev.ts, total: Object.values(values).reduce((sum, val) => sum + Number(val || 0), 0), dateKey: toDateKey(ev.ts) });
  }
  return series;
}

function periodWindow(mode, now = new Date()) {
  if (mode === 'week') {
    const d = now.getDay() || 7;
    const start = new Date(now);
    start.setDate(now.getDate() - d + 1);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(start.getDate() + 7);
    return { start: start.getTime(), end: end.getTime(), label: 'Semana' };
  }
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
  return { start, end, label: 'Mes' };
}

function periodFromRange(rangeMode, now = new Date()) {
  if (rangeMode === 'week') return periodWindow('week', now);
  if (rangeMode === 'year') {
    const y = now.getFullYear();
    return { start: new Date(y, 0, 1).getTime(), end: new Date(y + 1, 0, 1).getTime(), label: 'Año' };
  }
  if (rangeMode === 'total') return { start: -Infinity, end: Infinity, label: 'Total' };
  return periodWindow('month', now);
}

function previousPeriod(period) {
  if (!Number.isFinite(period.start) || !Number.isFinite(period.end)) return period;
  const size = period.end - period.start;
  return { ...period, start: period.start - size, end: period.start };
}

function periodDelta(series, period) {
  if (!series.length) return { delta: 0, deltaPct: 0, start: 0, end: 0 };
  const startPoint = series.find((p) => p.ts >= period.start) || series[0];
  const endPoint = series.filter((p) => p.ts < period.end).at(-1) || series.at(-1);
  const delta = endPoint.total - startPoint.total;
  return { delta, deltaPct: startPoint.total ? (delta / startPoint.total) * 100 : 0, start: startPoint.total, end: endPoint.total };
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

function render() {
  const host = document.getElementById('finance-content');
  if (!host) {
    warnMissing('finance-content');
    return;
  }

  console.log('Finance render', state.subview, state.rangeMode);
  if (state.error) {
    host.innerHTML = `<article class="finance-tab__panel"><h3>Error cargando finanzas</h3><p>${state.error}</p></article>`;
    return;
  }

  const accounts = buildAccountModel();
  const series = buildGlobalSeries(accounts);
  const total = accounts.reduce((sum, acc) => sum + acc.current, 0);
  const change = periodDelta(series, periodFromRange(state.rangeMode));
  const comparePeriod = periodWindow(state.compareMode);
  const compare = periodDelta(series, comparePeriod);
  const comparePrev = periodDelta(series, previousPeriod(comparePeriod));

  host.innerHTML = `
    <section class="finance-tab ${toneClass(change.delta)}">
      <article class="finance-tab__panel" id="finance-overview">
        <p class="finance-tab__eyebrow">TOTAL</p>
        <h2 class="finance-tab__total">${fmtCurrency(total)}</h2>
        <p class="finance-tab__delta ${toneClass(change.delta)}">${fmtSignedCurrency(change.delta)} · ${fmtSignedPercent(change.deltaPct)}</p>
        <div class="finance-tab__chart"><svg viewBox="0 0 320 110" preserveAspectRatio="none">${series.length ? `<path d="${sparklinePath(series.map((s) => s.total))}"/>` : ''}</svg></div>
      </article>
      <article class="finance-tab__controls">
        <button class="finance-pill" data-refresh>Actualizar</button>
        <select class="finance-pill" data-range>
          <option value="total" ${state.rangeMode === 'total' ? 'selected' : ''}>Total</option>
          <option value="month" ${state.rangeMode === 'month' ? 'selected' : ''}>Mes</option>
          <option value="week" ${state.rangeMode === 'week' ? 'selected' : ''}>Semana</option>
          <option value="year" ${state.rangeMode === 'year' ? 'selected' : ''}>Año</option>
        </select>
        <button class="finance-pill" data-history>Historial</button>
        <select class="finance-pill" data-compare>
          <option value="month" ${state.compareMode === 'month' ? 'selected' : ''}>Mes vs Mes</option>
          <option value="week" ${state.compareMode === 'week' ? 'selected' : ''}>Semana vs Semana</option>
        </select>
      </article>
      <article class="finance-tab__compare-row">
        <div class="finance-tab__chip ${toneClass(compare.delta)}">${comparePeriod.label} actual: ${fmtSignedCurrency(compare.delta)} (${fmtSignedPercent(compare.deltaPct)})</div>
        <div class="finance-tab__chip ${toneClass(comparePrev.delta)}">${comparePeriod.label} anterior: ${fmtSignedCurrency(comparePrev.delta)} (${fmtSignedPercent(comparePrev.deltaPct)})</div>
      </article>
      <article class="finance-tab__panel">
        <div class="finance-tab__panel-head"><h3>Cuentas</h3><button class="finance-pill" data-new-account>+ Cuenta</button></div>
        <div class="finance-tab__accounts">${accounts.map((account) => `
          <button class="finance-tab__account ${toneClass(account.range.delta)}" data-open-detail="${account.id}">
            <div class="finance-tab__account-main">
              <span>${account.name}</span>
              <input class="finance-tab__balance-input" data-account-input="${account.id}" value="${Number(account.current).toFixed(2)}" inputmode="decimal" />
            </div>
            <span class="finance-tab__chip ${toneClass(account.range.delta)}">${fmtSignedPercent(account.range.deltaPct)} · ${fmtSignedCurrency(account.range.delta)}</span>
          </button>
        `).join('') || '<p class="finance-tab__empty">Sin cuentas todavía.</p>'}</div>
      </article>
    </section>`;

  renderModal(accounts);
}

function renderModal(accounts) {
  const backdrop = document.getElementById('finance-modal-backdrop');
  if (!backdrop) {
    warnMissing('finance-modal-backdrop');
    return;
  }

  if (!state.modal.type) {
    backdrop.classList.add('hidden');
    backdrop.innerHTML = '';
    return;
  }

  backdrop.classList.remove('hidden');

  if (state.modal.type === 'history') {
    backdrop.innerHTML = `<div class="finance-modal" role="dialog" aria-modal="true">
      <header><h3>Historial</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
      <div class="finance-tab__table-wrap finance-history-list">${accounts.map((account) => {
        const entries = account.entries;
        return `<button class="finance-history-item" data-open-detail="${account.id}"><strong>${account.name}</strong><small>${entries.length} registros · ${fmtCurrency(account.current)}</small></button>`;
      }).join('') || '<p class="finance-tab__empty">Sin registros.</p>'}</div>
    </div>`;
    return;
  }

  const account = accounts.find((acc) => acc.id === state.modal.accountId);
  if (!account) {
    state.modal = { type: null, accountId: null };
    render();
    return;
  }
  const points = account.entries;
  const path = sparklinePath(points.map((p) => p.value), 300, 100);
  backdrop.innerHTML = `<div class="finance-modal" role="dialog" aria-modal="true">
    <header><h3>${account.name}</h3><button class="finance-pill" data-close-modal>Cerrar</button></header>
    <div class="finance-modal__actions"><button class="finance-pill" data-add-entry="${account.id}">Añadir registro</button><button class="finance-pill" data-refresh>Actualizar</button></div>
    <div class="finance-tab__chart"><svg viewBox="0 0 300 100">${path ? `<path d="${path}"/>` : ''}</svg></div>
    <div class="finance-tab__table-wrap"><table><thead><tr><th>Fecha</th><th>Valor</th><th>Δ€</th><th>Δ%</th><th></th></tr></thead><tbody>
      ${points.slice().reverse().map((p) => `<tr><td>${new Date(p.ts).toLocaleString('es-ES')}</td><td>${fmtCurrency(p.value)}</td><td class="${toneClass(p.delta)}">${fmtSignedCurrency(p.delta)}</td><td class="${toneClass(p.deltaPct)}">${fmtSignedPercent(p.deltaPct)}</td><td><button class="finance-pill finance-pill--mini" data-edit-entry="${account.id}:${p.id}">Editar</button><button class="finance-pill finance-pill--mini" data-delete-entry="${account.id}:${p.id}">🗑</button></td></tr>`).join('') || '<tr><td colspan="5">Sin registros</td></tr>'}
    </tbody></table></div>
    ${state.entryForm.open ? `<div class="finance-entry-form"><h4>${state.entryForm.entryId ? 'Editar registro' : 'Añadir registro'}</h4><input type="datetime-local" data-entry-ts value="${state.entryForm.tsInput}" /><input type="number" step="0.01" data-entry-value value="${state.entryForm.valueInput}" placeholder="Valor €" /><div class="finance-modal__actions"><button class="finance-pill" data-save-entry="${account.id}">Guardar</button><button class="finance-pill" data-cancel-entry>Cancelar</button></div></div>` : ''}
  </div>`;
}

async function loadDataOnce() {
  console.log('Finance load start');
  const snap = await get(ref(db, FIN_PATH));
  const val = snap.val() || {};
  const accountsMap = val.accounts || {};
  const entriesMap = val.accountsEntries || val.entries || {};
  state.accounts = Object.values(accountsMap).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.entriesByAccount = Object.fromEntries(Object.entries(entriesMap).map(([accId, map]) => [accId, Object.entries(map || {}).map(([id, entry]) => ({ id, ...entry }))]));
  const entriesCount = Object.values(state.entriesByAccount).reduce((sum, list) => sum + list.length, 0);
  console.log('Finance load ok', state.accounts.length, entriesCount);
}

function subscribe() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = onValue(ref(db, FIN_PATH), (snap) => {
    const val = snap.val() || {};
    state.accounts = Object.values(val.accounts || {}).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
    const entriesMap = val.accountsEntries || val.entries || {};
    state.entriesByAccount = Object.fromEntries(Object.entries(entriesMap).map(([accId, map]) => [accId, Object.entries(map || {}).map(([id, entry]) => ({ id, ...entry }))]));
    render();
  }, (error) => {
    console.error('Finance load error', error);
    state.error = String(error?.message || error);
    render();
  });
}

async function addAccount(name) {
  const id = push(ref(db, `${FIN_PATH}/accounts`)).key;
  await set(ref(db, `${FIN_PATH}/accounts/${id}`), { id, name, createdAt: Date.now(), updatedAt: Date.now() });
}

async function saveEntry(accountId, value, ts = Date.now(), entryId = null) {
  const parsedValue = Number(String(value).replace(',', '.'));
  if (!Number.isFinite(parsedValue)) return;
  const payload = { ts: Number(ts), value: parsedValue };
  if (entryId) await update(ref(db, `${FIN_PATH}/accountsEntries/${accountId}/${entryId}`), payload);
  else await set(push(ref(db, `${FIN_PATH}/accountsEntries/${accountId}`)), payload);
  await update(ref(db, `${FIN_PATH}/accounts/${accountId}`), { updatedAt: Date.now(), lastValue: parsedValue });
}

async function deleteEntry(accountId, entryId) {
  await remove(ref(db, `${FIN_PATH}/accountsEntries/${accountId}/${entryId}`));
  await update(ref(db, `${FIN_PATH}/accounts/${accountId}`), { updatedAt: Date.now() });
}

function bindEvents() {
  const financeView = document.getElementById('view-finance');
  if (!financeView) {
    warnMissing('view-finance');
    return;
  }
  if (financeView.dataset.financeBound === '1') return;
  financeView.dataset.financeBound = '1';

  financeView.addEventListener('click', async (event) => {
    if (event.target.closest('[data-refresh]')) {
      console.log('Finance: refresh requested');
      await loadDataOnce();
      render();
      return;
    }
    if (event.target.closest('[data-history]')) {
      console.log('Finance: history open');
      state.modal = { type: 'history', accountId: null };
      render();
      return;
    }
    if (event.target.closest('[data-close-modal]') || event.target.id === 'finance-modal-backdrop') {
      console.log('Finance: modal close');
      state.modal = { type: null, accountId: null };
      state.entryForm = { open: false, entryId: null, tsInput: '', valueInput: '' };
      render();
      return;
    }
    if (event.target.closest('[data-open-detail]') && !event.target.closest('[data-account-input]')) {
      const accountId = event.target.closest('[data-open-detail]').dataset.openDetail;
      console.log('Finance: open detail', accountId);
      state.modal = { type: 'detail', accountId };
      render();
      return;
    }
    if (event.target.closest('[data-new-account]')) {
      const name = window.prompt('Nombre de la cuenta');
      if (name?.trim()) await addAccount(name.trim());
      return;
    }
    if (event.target.closest('[data-add-entry]')) {
      console.log('Finance: open add entry');
      state.entryForm = { open: true, entryId: null, tsInput: toDateTimeLocal(Date.now()), valueInput: '' };
      render();
      return;
    }
    if (event.target.closest('[data-cancel-entry]')) {
      state.entryForm = { open: false, entryId: null, tsInput: '', valueInput: '' };
      render();
      return;
    }
    if (event.target.closest('[data-save-entry]')) {
      const accountId = event.target.closest('[data-save-entry]').dataset.saveEntry;
      const tsInput = financeView.querySelector('[data-entry-ts]')?.value;
      const valueInput = financeView.querySelector('[data-entry-value]')?.value;
      const ts = tsInput ? new Date(tsInput).getTime() : Date.now();
      console.log('Finance: save entry', accountId, ts);
      await saveEntry(accountId, valueInput, ts, state.entryForm.entryId);
      state.entryForm = { open: false, entryId: null, tsInput: '', valueInput: '' };
      return;
    }
    if (event.target.closest('[data-delete-entry]')) {
      const [accountId, entryId] = event.target.closest('[data-delete-entry]').dataset.deleteEntry.split(':');
      if (window.confirm('¿Eliminar este registro?')) {
        console.log('Finance: delete entry', accountId, entryId);
        await deleteEntry(accountId, entryId);
      }
      return;
    }
    if (event.target.closest('[data-edit-entry]')) {
      const [accountId, entryId] = event.target.closest('[data-edit-entry]').dataset.editEntry.split(':');
      const entry = accountEntries(accountId).find((item) => item.id === entryId);
      state.entryForm = { open: true, entryId, tsInput: toDateTimeLocal(entry?.ts || Date.now()), valueInput: entry?.value ?? '' };
      console.log('Finance: edit entry', accountId, entryId);
      render();
    }
  });

  financeView.addEventListener('change', (event) => {
    if (event.target.matches('[data-range]')) {
      state.rangeMode = event.target.value;
      persistUi();
      console.log('Finance: range change', state.rangeMode);
      render();
    }
    if (event.target.matches('[data-compare]')) {
      state.compareMode = event.target.value;
      persistUi();
      console.log('Finance: compare change', state.compareMode);
      render();
    }
  });

  financeView.addEventListener('focusin', (event) => {
    if (event.target.matches('[data-account-input]')) event.target.select();
  });

  financeView.addEventListener('keydown', async (event) => {
    if (event.key !== 'Enter' || !event.target.matches('[data-account-input]')) return;
    event.preventDefault();
    await saveEntry(event.target.dataset.accountInput, event.target.value, Date.now());
    event.target.blur();
  });

  financeView.addEventListener('focusout', async (event) => {
    if (!event.target.matches('[data-account-input]')) return;
    await saveEntry(event.target.dataset.accountInput, event.target.value, Date.now());
  });
}

async function boot() {
  bindEvents();
  await loadDataOnce();
  subscribe();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { boot(); }, { once: true });
else boot();
