import { ref, onValue, set, update, remove, push } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';
import { formatCurrency, formatSignedCurrency, formatSignedPercent, formatDateEs } from './finance-format.js';
import { buildAccountSeries, calcDelta, calcGoalProgress, dateKey } from './finance-calc.js';

const USER_ID = 'default';
const ROOT = `voxelFinance/${USER_ID}`;
const LS_KEY = 'bookshell.finance.cache.v1';
const ACCOUNT_TYPES = [
  ['cash', 'Efectivo'],
  ['broker', 'Broker'],
  ['crypto', 'Crypto'],
  ['debt', 'Deuda'],
  ['other', 'Otra']
];

const state = {
  internalView: 'overview',
  range: 'month',
  granularity: 'day',
  selectedAccountId: 'total',
  selectedMonth: new Date().getMonth(),
  selectedYear: new Date().getFullYear(),
  editingValueTarget: null,
  data: { accounts: {}, snapshots: {}, goals: {}, settings: {} }
};

function normalizeData(raw = {}) {
  return {
    accounts: raw.accounts || {},
    snapshots: raw.snapshots || {},
    goals: raw.goals || {},
    settings: raw.settings || {}
  };
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (cached) state.data = normalizeData(cached);
  } catch (_) {}
}

function saveCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.data)); } catch (_) {}
}

function bindFirebase() {
  onValue(ref(db, ROOT), snap => {
    state.data = { ...state.data, ...normalizeData(snap.val() || {}) };
    saveCache();
    render();
  });
}

function getAccountsOrdered() {
  return Object.entries(state.data.accounts || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
}

function getSeries(accountId = 'total') {
  return buildAccountSeries(state.data.accounts || {}, state.data.snapshots || {}, accountId);
}

function valueToneClass(v) { return v > 0 ? 'tone-pos' : v < 0 ? 'tone-neg' : 'tone-neutral'; }

function deltaBadge(deltaValue, deltaPercent, prefix = '') {
  const tone = valueToneClass(deltaValue);
  return `<span class="finance-sign-badge ${tone}">${prefix}${formatSignedCurrency(deltaValue)} · ${formatSignedPercent(deltaPercent)}</span>`;
}

function renderTopNav() {
  const root = document.getElementById('finance-topnav');
  if (!root) return;
  const items = [['overview', '€'], ['goals', '◎'], ['calendar', '📅'], ['charts', '📈']];
  root.innerHTML = items.map(([id, icon]) => `<button class="finance-mini-btn ${state.internalView === id ? 'active' : ''}" data-fin-view="${id}">${icon}</button>`).join('');
}

function renderOverview() {
  const host = document.getElementById('finance-content');
  const orderedAccounts = getAccountsOrdered();

  if (!orderedAccounts.length) {
    host.innerHTML = `<section class="finance-panel finance-panel-empty">
      <div class="finance-total">$ / Cuentas</div>
      <p class="empty-state">No hay cuentas todavía.</p>
      <button class="opal-pill opal-pill--primary" id="finance-account-create-empty">Nueva cuenta</button>
    </section>`;
    return;
  }

  const totalSeries = getSeries('total');
  const total = calcDelta(totalSeries, state.range);
  const chips = calcMonthVsMonth();
  const spark = totalSeries.length ? '' : '<div class="finance-spark-empty"></div>';

  const accountsList = orderedAccounts.map(([id, acc]) => {
    const d = calcDelta(getSeries(id), state.range);
    const accent = acc.color || '#6f79b8';
    return `<article class="finance-account-card" style="--acc-color:${accent}" data-account-id="${id}">
      <button class="finance-dot-menu" data-account-menu="${id}" aria-label="Menú cuenta">⋮</button>
      <div class="finance-account-main">
        <div class="finance-account-name">${acc.name || 'Cuenta'}</div>
        <button class="finance-amount-display" data-inline-edit="${id}" data-inline-current="${d.current}">${formatCurrency(d.current)}</button>
      </div>
      <div class="finance-account-right">${deltaBadge(d.deltaValue, d.deltaPercent, 'Mes ')}</div>
    </article>`;
  }).join('');

  host.innerHTML = `<section class="finance-panel finance-overview-hero">
    <div class="finance-overview-top">
      <button class="opal-pill" id="finance-refresh">Actualizar</button>
      <button class="opal-pill opal-pill--primary" id="finance-account-create">Nueva cuenta</button>
    </div>
    <button class="finance-total" data-inline-edit="total" data-inline-current="${total.current}">${formatCurrency(total.current)}</button>
    <div class="finance-delta-row">${deltaBadge(total.deltaValue, total.deltaPercent)}</div>
    <div class="finance-spark" id="finance-spark">${spark}</div>
    <div class="finance-controls">
      <label class="opal-select-wrap"><span>Rango</span><select class="opal-select" id="finance-range"><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option><option value="year">Año</option><option value="total">Total</option></select></label>
      <button class="opal-pill" id="finance-history-total">Historial</button>
      <button class="opal-pill" id="finance-month-vs">Mes vs Mes</button>
    </div>
    <div class="finance-chip-row">
      <span class="finance-chip ${valueToneClass(chips.current.deltaValue)}">Mes actual: ${formatSignedCurrency(chips.current.deltaValue)} (${formatSignedPercent(chips.current.deltaPercent)})</span>
      <span class="finance-chip ${valueToneClass(chips.prev.deltaValue)}">Mes anterior: ${formatSignedCurrency(chips.prev.deltaValue)} (${formatSignedPercent(chips.prev.deltaPercent)})</span>
    </div>
  </section>
  <section class="finance-list">${accountsList}</section>`;

  const rangeSel = document.getElementById('finance-range');
  if (rangeSel) rangeSel.value = state.range;
  drawSpark(totalSeries);
}

function calcMonthVsMonth() {
  const series = getSeries('total');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const current = calcDelta(series.filter(s => new Date(`${s.date}T12:00:00`) >= monthStart), 'month');
  const prev = calcDelta(series.filter(s => {
    const d = new Date(`${s.date}T12:00:00`);
    return d >= prevStart && d < monthStart;
  }), 'month');
  return { current, prev };
}

function renderGoals() {
  const host = document.getElementById('finance-content');
  const goals = Object.entries(state.data.goals || {}).sort((a, b) => (a[1].order || 0) - (b[1].order || 0));
  const totalGoal = goals.reduce((acc, [, g]) => acc + Number(g.target || 0), 0);
  const totalSaved = goals.reduce((acc, [, g]) => acc + Number(g.saved || 0), 0);
  const pct = totalGoal ? (totalSaved / totalGoal) * 100 : 0;
  host.innerHTML = `
    <section class="finance-panel">
      <div class="finance-goal-header"><button class="opal-pill opal-pill--primary" id="goal-new">Nuevo objetivo</button></div>
      <div class="finance-donut" id="finance-goal-donut"></div>
      <div class="finance-goal-meta">${formatCurrency(totalSaved)} / ${formatCurrency(totalGoal)}</div>
    </section>
    <section class="finance-list">${goals.map(([id, g]) => {
      const p = calcGoalProgress(g);
      return `<button class="finance-goal-card" data-goal-id="${id}" style="--ring:${g.color || '#8b7dff'};--pct:${p.pct}">
        <span><strong>${g.name}</strong><small>${formatCurrency(p.saved)} / ${formatCurrency(p.target)}</small><small>${g.targetDate ? formatDateEs(g.targetDate) : 'Sin fecha'}</small></span>
        <div class="finance-goal-ring">${Math.round(p.pct)}%</div><button class="finance-dot-menu" data-goal-menu="${id}">⋮</button>
      </button>`;
    }).join('') || '<div class="empty-state">Sin objetivos todavía.</div>'}</section>`;
  drawGoalDonut(pct);
}

function renderCalendar() {
  const host = document.getElementById('finance-content');
  host.innerHTML = `<section class="finance-panel">
  <div class="finance-row"><h3>Calendario de variación</h3><label class="opal-select-wrap"><select class="opal-select" id="fin-gran"><option value="day">Día</option><option value="month">Mes</option><option value="year">Año</option></select></label></div>
  <div class="finance-row"><label class="opal-select-wrap"><span>Mes</span><select class="opal-select" id="fin-month">${Array.from({ length: 12 }, (_, i) => `<option value="${i}">${new Date(2000, i, 1).toLocaleString('es-ES', { month: 'long' })}</option>`).join('')}</select></label><label class="opal-select-wrap"><span>Cuenta</span><select class="opal-select" id="fin-account"><option value="total">Total (todas)</option>${getAccountsOrdered().map(([id, a]) => `<option value="${id}">${a.name}</option>`).join('')}</select></label></div>
  <div class="finance-row"><label class="opal-select-wrap"><span>Año</span><input class="opal-input" id="fin-year" type="number" value="${state.selectedYear}"></label></div>
  <div class="finance-grid" id="finance-grid"></div></section>`;
  document.getElementById('fin-gran').value = state.granularity;
  document.getElementById('fin-account').value = state.selectedAccountId;
  document.getElementById('fin-month').value = String(state.selectedMonth);
  buildGrid();
}

function buildGrid() {
  const grid = document.getElementById('finance-grid');
  if (!grid) return;
  const series = getSeries(state.selectedAccountId);
  const map = new Map(series.map(s => [s.date, s.value]));
  if (state.granularity === 'day') {
    const days = new Date(state.selectedYear, state.selectedMonth + 1, 0).getDate();
    grid.innerHTML = ['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => `<div class="fin-head">${d}</div>`).join('');
    for (let d = 1; d <= days; d++) {
      const key = `${state.selectedYear}-${String(state.selectedMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const cur = map.get(key);
      const prev = findPrevValue(series, key);
      const delta = Number.isFinite(cur) ? cur - prev : null;
      const tone = valueToneClass(delta ?? 0);
      grid.insertAdjacentHTML('beforeend', `<button class="fin-cell ${tone}" data-period="${key}">${Number.isFinite(delta) ? formatSignedCurrency(delta) : '—'}<small>${prev ? formatSignedPercent((delta / prev) * 100) : '—'}</small></button>`);
    }
  } else if (state.granularity === 'month') {
    grid.innerHTML = '';
    for (let m = 0; m < 12; m++) {
      const end = `${state.selectedYear}-${String(m + 1).padStart(2, '0')}-31`;
      const cur = findPrevValue(series, end);
      const prev = findPrevValue(series, `${state.selectedYear}-${String(m).padStart(2, '0')}-31`);
      const delta = cur - prev;
      grid.insertAdjacentHTML('beforeend', `<button class="fin-cell ${valueToneClass(delta)}" data-period="${state.selectedYear}-${m + 1}">${['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'][m]}<small>${formatSignedCurrency(delta)}</small></button>`);
    }
  } else {
    grid.innerHTML = '';
    const years = [...new Set(series.map(s => s.date.slice(0, 4)))];
    years.forEach(y => {
      const cur = findPrevValue(series, `${y}-12-31`);
      const prev = findPrevValue(series, `${Number(y) - 1}-12-31`);
      const delta = cur - prev;
      grid.insertAdjacentHTML('beforeend', `<button class="fin-cell ${valueToneClass(delta)}" data-period="${y}">${y}<small>${formatSignedCurrency(delta)}</small></button>`);
    });
  }
}

function findPrevValue(series, key) {
  let prev = 0;
  for (const s of series) {
    if (s.date <= key) prev = s.value;
    else break;
  }
  return prev;
}

function renderCharts() {
  const host = document.getElementById('finance-content');
  host.innerHTML = '<section class="finance-panel"><div class="empty-state">Gráficos avanzados integrados en Historial de cuenta.</div></section>';
}

function openGoalModal(goalId = null) {
  const g = goalId ? state.data.goals[goalId] : { name: '', target: 0, saved: 0, targetDate: dateKey(), color: '#8b7dff' };
  const modal = document.getElementById('finance-modal-backdrop');
  modal.classList.remove('hidden');
  document.body.classList.add('has-open-modal');
  modal.innerHTML = `<div class="modal finance-modal"><div class="modal-header"><div class="modal-title">${goalId ? 'Editar objetivo' : 'Nuevo objetivo'}</div><button class="icon-btn" data-close>✕</button></div>
  <div class="modal-body"><label class="field"><span>Nombre</span><input id="goal-name" value="${g.name || ''}"></label>
  <label class="field"><span>Objetivo €</span><input id="goal-target" inputmode="decimal" value="${g.target || 0}"></label>
  <label class="field"><span>Ahorrado €</span><input id="goal-saved" inputmode="decimal" value="${g.saved || 0}"></label>
  <label class="field"><span>Fecha objetivo</span><input id="goal-date" type="date" value="${g.targetDate || dateKey()}"></label>
  <label class="field"><span>Color</span><input id="goal-color" type="color" value="${g.color || '#8b7dff'}"></label>
  <div class="finance-modal-actions"><button class="opal-pill" data-close>Cancelar</button><button class="opal-pill opal-pill--primary" id="goal-save">Guardar</button></div></div></div>`;
  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  }, { once: true });
  document.getElementById('goal-save')?.addEventListener('click', async () => {
    const payload = {
      name: document.getElementById('goal-name').value.trim(),
      target: Number(document.getElementById('goal-target').value || 0),
      saved: Number(document.getElementById('goal-saved').value || 0),
      targetDate: document.getElementById('goal-date').value || dateKey(),
      color: document.getElementById('goal-color').value,
      order: goalId ? state.data.goals[goalId]?.order || Date.now() : Date.now()
    };
    if (goalId) await update(ref(db, `${ROOT}/goals/${goalId}`), payload);
    else await set(push(ref(db, `${ROOT}/goals`)), payload);
    closeModal();
  });
}

function openAccountModal(accountId = null) {
  const account = accountId ? state.data.accounts[accountId] : {
    name: '', type: 'cash', color: '#6d7dff', includedInTotal: true, order: Date.now()
  };
  const modal = document.getElementById('finance-modal-backdrop');
  modal.classList.remove('hidden');
  document.body.classList.add('has-open-modal');
  modal.innerHTML = `<div class="modal finance-modal"><div class="modal-header"><div class="modal-title">${accountId ? 'Editar cuenta' : 'Nueva cuenta'}</div><button class="icon-btn" data-close>✕</button></div>
    <div class="modal-body">
      <label class="field"><span>Nombre</span><input id="account-name" value="${account.name || ''}" placeholder="Ej. Principal"></label>
      <label class="field"><span>Tipo</span><select id="account-type" class="opal-select">${ACCOUNT_TYPES.map(([v, t]) => `<option value="${v}" ${account.type === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field"><span>Color</span><input id="account-color" type="color" value="${account.color || '#6d7dff'}"></label>
      <label class="field field-inline"><span>Incluir en total</span><input id="account-in-total" type="checkbox" ${account.includedInTotal !== false ? 'checked' : ''}></label>
      <div class="finance-modal-actions"><button class="opal-pill" data-close>Cancelar</button><button class="opal-pill opal-pill--primary" id="account-save">Guardar</button></div>
    </div>
  </div>`;

  modal.addEventListener('click', (e) => {
    if (e.target === modal || e.target.closest('[data-close]')) closeModal();
  }, { once: true });

  document.getElementById('account-save')?.addEventListener('click', async () => {
    const name = document.getElementById('account-name').value.trim();
    if (!name) return;
    const payload = {
      id: accountId || undefined,
      name,
      type: document.getElementById('account-type').value,
      color: document.getElementById('account-color').value,
      includedInTotal: document.getElementById('account-in-total').checked,
      order: account.order || Date.now()
    };
    if (accountId) await update(ref(db, `${ROOT}/accounts/${accountId}`), payload);
    else {
      const newRef = push(ref(db, `${ROOT}/accounts`));
      payload.id = newRef.key;
      await set(newRef, payload);
    }
    closeModal();
  });
}

async function deleteAccount(accountId) {
  if (!accountId || !state.data.accounts?.[accountId]) return;
  const deleteSnapshots = confirm('¿Eliminar también snapshots de esta cuenta? (recomendado)');
  if (!confirm('Eliminar cuenta de forma definitiva. ¿Continuar?')) return;
  await remove(ref(db, `${ROOT}/accounts/${accountId}`));
  if (deleteSnapshots) await remove(ref(db, `${ROOT}/snapshots/${accountId}`));
}

function openHistoryModal(accountId = 'total', period = '') {
  const modal = document.getElementById('finance-modal-backdrop');
  const accName = accountId === 'total' ? 'Total (todas)' : state.data.accounts?.[accountId]?.name || 'Cuenta';
  const series = getSeries(accountId);
  modal.classList.remove('hidden');
  document.body.classList.add('has-open-modal');
  modal.innerHTML = `<div class="modal finance-modal"><div class="modal-header"><div class="modal-title">Historial · ${accName}</div><button class="icon-btn" data-close>✕</button></div>
  <div class="modal-body"><div class="finance-history-chart" id="finance-history-chart"></div>
  <div class="finance-history-table-wrap"><table class="finance-history-table"><thead><tr><th>Fecha</th><th>Valor</th><th>Δ€</th><th>Δ%</th></tr></thead><tbody>
  ${series.slice(-90).reverse().map((row, i, arr) => {
    const prev = arr[i + 1]?.value ?? row.value;
    const d = row.value - prev;
    const pct = prev === 0 ? null : (d / prev) * 100;
    return `<tr><td>${formatDateEs(row.date)}</td><td>${formatCurrency(row.value)}</td><td class="${valueToneClass(d)}">${formatSignedCurrency(d)}</td><td class="${valueToneClass(d)}">${formatSignedPercent(pct)}</td></tr>`;
  }).join('')}</tbody></table></div>
  <div class="finance-modal-actions"><button class="opal-pill" data-close>Cerrar</button></div></div></div>`;
  drawHistoryChart(series, period);
  modal.addEventListener('click', (e) => { if (e.target === modal || e.target.closest('[data-close]')) closeModal(); }, { once: true });
}

function closeModal() {
  const modal = document.getElementById('finance-modal-backdrop');
  modal.classList.add('hidden');
  modal.innerHTML = '';
  document.body.classList.remove('has-open-modal');
}

function drawSpark(series) {
  const el = document.getElementById('finance-spark');
  if (!el || !window.echarts || !series.length) return;
  const chart = window.echarts.init(el, null, { renderer: 'canvas' });
  chart.setOption({
    grid: { top: 8, bottom: 8, left: 4, right: 4 },
    xAxis: { type: 'category', show: false, data: series.map(s => s.date) },
    yAxis: { type: 'value', show: false },
    series: [{ type: 'line', smooth: true, data: series.map(s => s.value), symbol: 'none', lineStyle: { color: '#42db7f', width: 2.5 }, areaStyle: { color: 'rgba(66,219,127,.14)' } }]
  });
}

function drawGoalDonut(pct) {
  const el = document.getElementById('finance-goal-donut');
  if (!el || !window.echarts) return;
  const chart = window.echarts.init(el);
  chart.setOption({ series: [{ type: 'pie', radius: ['68%', '88%'], label: { show: true, position: 'center', formatter: `${Math.round(pct)}%`, color: '#fff', fontSize: 20, fontWeight: 700 }, data: [{ value: pct, itemStyle: { color: '#8b7dff' } }, { value: 100 - pct, itemStyle: { color: 'rgba(255,255,255,.12)' } }] }] });
}

function drawHistoryChart(series) {
  const el = document.getElementById('finance-history-chart');
  if (!el || !window.echarts) return;
  const data = series.slice(-120);
  const chart = window.echarts.init(el);
  chart.setOption({ tooltip: { trigger: 'axis' }, grid: { top: 22, left: 16, right: 16, bottom: 24 }, xAxis: { type: 'category', data: data.map(s => s.date), axisLabel: { show: false } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,.08)' } } }, series: [{ type: 'line', data: data.map(s => s.value), smooth: true, symbolSize: 6, itemStyle: { color: '#58d4a5' }, lineStyle: { color: '#58d4a5' } }] });
}

function parseMoneyInput(value) {
  const cleaned = String(value || '').replace(/[€\s]/g, '').replace(/\./g, '').replace(',', '.');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

function setInlineEditor(container, accountId, currentValue) {
  if (!container || state.editingValueTarget) return;
  state.editingValueTarget = accountId;
  const prevHtml = container.innerHTML;
  const initial = Number(currentValue || 0).toFixed(2).replace('.', ',');
  container.innerHTML = `<div class="finance-inline-edit-wrap">
    <input class="finance-inline-input" inputmode="decimal" placeholder="0,00 €" value="${initial}">
    <button class="opal-pill finance-inline-save">✓</button>
    <button class="opal-pill finance-inline-cancel">✕</button>
  </div>`;
  document.body.classList.add('finance-inline-editing');
  const blocker = document.getElementById('finance-inline-blocker') || createInlineBlocker();
  blocker.classList.remove('hidden');

  const input = container.querySelector('.finance-inline-input');
  input?.focus();
  input?.select();

  const closeInline = () => {
    state.editingValueTarget = null;
    container.innerHTML = prevHtml;
    document.body.classList.remove('finance-inline-editing');
    blocker.classList.add('hidden');
  };

  const saveInline = async () => {
    const value = parseMoneyInput(input?.value);
    await saveSnapshotForTarget(accountId, value);
    closeInline();
  };

  container.querySelector('.finance-inline-save')?.addEventListener('click', saveInline, { once: true });
  container.querySelector('.finance-inline-cancel')?.addEventListener('click', closeInline, { once: true });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); saveInline(); }
    if (e.key === 'Escape') { e.preventDefault(); closeInline(); }
  });
  input?.addEventListener('blur', () => { if (state.editingValueTarget === accountId) saveInline(); });
}

function createInlineBlocker() {
  const blocker = document.createElement('div');
  blocker.id = 'finance-inline-blocker';
  blocker.className = 'finance-inline-blocker';
  document.body.appendChild(blocker);
  blocker.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
  return blocker;
}

async function saveSnapshotForTarget(accountId, value) {
  const today = dateKey();
  if (accountId !== 'total') {
    await set(ref(db, `${ROOT}/snapshots/${accountId}/${today}`), { value });
    return;
  }

  const included = getAccountsOrdered().filter(([, acc]) => acc.includedInTotal !== false);
  if (!included.length) return;

  const currentSeries = getSeries('total');
  const current = currentSeries.length ? currentSeries[currentSeries.length - 1].value : 0;
  const delta = value - current;
  const step = delta / included.length;
  const payload = {};

  included.forEach(([id], index) => {
    const accountSeries = getSeries(id);
    const currentValue = accountSeries.length ? accountSeries[accountSeries.length - 1].value : 0;
    const corrected = index === included.length - 1 ? value - (current + (step * (included.length - 1))) + currentValue : currentValue + step;
    payload[id] = { [today]: { value: Number(corrected.toFixed(2)) } };
  });

  await update(ref(db, `${ROOT}/snapshots`), payload);
}

function render() {
  renderTopNav();
  if (state.internalView === 'overview') renderOverview();
  if (state.internalView === 'goals') renderGoals();
  if (state.internalView === 'calendar') renderCalendar();
  if (state.internalView === 'charts') renderCharts();
}

function onRootClick(e) {
  const vBtn = e.target.closest('[data-fin-view]');
  if (vBtn) { state.internalView = vBtn.dataset.finView; render(); return; }

  if (e.target.id === 'goal-new') return openGoalModal();
  const gCard = e.target.closest('[data-goal-id]');
  if (gCard) return openGoalModal(gCard.dataset.goalId);
  const gMenu = e.target.closest('[data-goal-menu]');
  if (gMenu) {
    const id = gMenu.dataset.goalMenu;
    if (confirm('¿Eliminar objetivo?')) remove(ref(db, `${ROOT}/goals/${id}`));
    return;
  }

  if (e.target.id === 'finance-account-create-empty' || e.target.id === 'finance-account-create') return openAccountModal();

  const accountMenu = e.target.closest('[data-account-menu]');
  if (accountMenu) {
    const id = accountMenu.dataset.accountMenu;
    const action = prompt('Cuenta: escribe "editar" o "eliminar"');
    if (action === 'editar') openAccountModal(id);
    if (action === 'eliminar') deleteAccount(id);
    return;
  }

  if (e.target.id === 'finance-history-total') return openHistoryModal('total');

  const account = e.target.closest('[data-account-id]');
  if (account && !e.target.closest('[data-inline-edit]')) return openHistoryModal(account.dataset.accountId);

  const inline = e.target.closest('[data-inline-edit]');
  if (inline) return setInlineEditor(inline, inline.dataset.inlineEdit, Number(inline.dataset.inlineCurrent || 0));

  const cell = e.target.closest('.fin-cell[data-period]');
  if (cell) return openHistoryModal(state.selectedAccountId, cell.dataset.period);
}

function onRootChange(e) {
  if (e.target.id === 'finance-range') { state.range = e.target.value; renderOverview(); }
  if (e.target.id === 'fin-gran') { state.granularity = e.target.value; renderCalendar(); }
  if (e.target.id === 'fin-account') { state.selectedAccountId = e.target.value; buildGrid(); }
  if (e.target.id === 'fin-year') { state.selectedYear = Number(e.target.value) || new Date().getFullYear(); buildGrid(); }
  if (e.target.id === 'fin-month') { state.selectedMonth = Number(e.target.value) || 0; buildGrid(); }
}

function bindInteractions() {
  const root = document.getElementById('view-finance');
  root?.addEventListener('click', onRootClick);
  root?.addEventListener('change', onRootChange);
}

function init() {
  loadCache();
  bindFirebase();
  bindInteractions();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
