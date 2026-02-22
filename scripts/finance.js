import { ref, onValue, set, update, remove, push } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';
import { formatCurrency, formatSignedCurrency, formatSignedPercent, formatDateEs } from './finance-format.js';
import { buildAccountSeries, calcDelta, calcGoalProgress, dateKey } from './finance-calc.js';

const USER_ID = 'default';
const ROOT = `voxelFinance/${USER_ID}`;
const LS_KEY = 'bookshell.finance.cache.v1';

const state = {
  internalView: 'overview',
  range: 'month',
  granularity: 'day',
  selectedAccountId: 'total',
  selectedMonth: new Date().getMonth(),
  selectedYear: new Date().getFullYear(),
  modal: null,
  data: { accounts: {}, snapshots: {}, goals: {}, settings: {} }
};

function seedIfEmpty(raw) {
  if (raw?.accounts && Object.keys(raw.accounts).length) return raw;
  return {
    ...raw,
    accounts: {
      totalcash: { name: 'Principal', color: '#8b7dff', type: 'cash', includedInTotal: true, order: 1 },
      broker: { name: 'Myinvestor', color: '#47d7ac', type: 'broker', includedInTotal: true, order: 2 },
      debt: { name: 'Deuda Laura', color: '#ff5f76', type: 'debt', includedInTotal: true, order: 3 }
    },
    snapshots: raw?.snapshots || {},
    goals: raw?.goals || {}
  };
}

function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    if (cached) state.data = seedIfEmpty(cached);
  } catch (_) {}
}

function saveCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.data)); } catch (_) {}
}

function bindFirebase() {
  onValue(ref(db, ROOT), snap => {
    const val = seedIfEmpty(snap.val() || {});
    state.data = { ...state.data, ...val };
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

function badgeClass(v) { return v > 0 ? 'is-pos' : v < 0 ? 'is-neg' : 'is-neutral'; }

function renderTopNav() {
  const root = document.getElementById('finance-topnav');
  if (!root) return;
  const items = [
    ['overview', '€'],
    ['goals', '◎'],
    ['calendar', '📅'],
    ['charts', '📈']
  ];
  root.innerHTML = items.map(([id, icon]) => `<button class="finance-mini-btn ${state.internalView === id ? 'active' : ''}" data-fin-view="${id}">${icon}</button>`).join('');
}

function renderOverview() {
  const host = document.getElementById('finance-content');
  const series = getSeries('total');
  const total = calcDelta(series, state.range);
  const chips = calcMonthVsMonth();

  const list = [['total', { name: 'Total (todas)', includedInTotal: true, type: 'cash' }], ...getAccountsOrdered()]
    .map(([id, acc]) => {
      const d = calcDelta(getSeries(id === 'total' ? 'total' : id), state.range);
      return `<button class="finance-account-card" data-account-id="${id}">
        <div><div class="finance-account-name">${acc.name}</div><div class="finance-account-balance">${formatCurrency(d.current)}</div></div>
        <div class="finance-badge ${badgeClass(d.deltaValue)}">${formatSignedCurrency(d.deltaValue)} · ${formatSignedPercent(d.deltaPercent)}</div>
      </button>`;
    }).join('');

  host.innerHTML = `
  <section class="finance-panel">
    <div class="finance-total">${formatCurrency(total.current)}</div>
    <div class="finance-delta ${badgeClass(total.deltaValue)}">${formatSignedCurrency(total.deltaValue)} · ${formatSignedPercent(total.deltaPercent)}</div>
    <div class="finance-spark" id="finance-spark"></div>
    <div class="finance-controls">
      <button class="btn" id="finance-refresh">Actualizar</button>
      <select id="finance-range"><option value="day">Día</option><option value="week">Semana</option><option value="month">Mes</option><option value="year">Año</option><option value="total">Total</option></select>
      <button class="btn" id="finance-history-total">Historial</button>
    </div>
    <div class="finance-chip-row">
      <span class="finance-chip ${badgeClass(chips.current.deltaValue)}">Mes actual: ${formatSignedCurrency(chips.current.deltaValue)} (${formatSignedPercent(chips.current.deltaPercent)})</span>
      <span class="finance-chip ${badgeClass(chips.prev.deltaValue)}">Mes anterior: ${formatSignedCurrency(chips.prev.deltaValue)} (${formatSignedPercent(chips.prev.deltaPercent)})</span>
    </div>
  </section>
  <section class="finance-list">${list}</section>`;

  const rangeSel = document.getElementById('finance-range');
  if (rangeSel) rangeSel.value = state.range;
  drawSpark(series);
}

function calcMonthVsMonth() {
  const series = getSeries('total');
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const prevStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const old = state.range;
  state.range = 'month';
  const current = calcDelta(series.filter(s => new Date(`${s.date}T12:00:00`) >= monthStart), 'month');
  const prev = calcDelta(series.filter(s => {
    const d = new Date(`${s.date}T12:00:00`);
    return d >= prevStart && d < monthStart;
  }), 'month');
  state.range = old;
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
      <div class="finance-goal-header"><button class="btn" id="goal-new">Nuevo objetivo</button><button class="btn" id="goal-source">Cuentas origen</button></div>
      <div class="finance-donut" id="finance-goal-donut"></div>
      <div class="finance-goal-meta">Objetivo total: ${formatCurrency(totalGoal)}</div>
      <div class="finance-goal-meta">Ahorrado: ${formatCurrency(totalSaved)} (${formatSignedPercent(pct)})</div>
      <div class="finance-goal-meta">Disponible: ${formatCurrency(Math.max(totalGoal - totalSaved, 0))}</div>
    </section>
    <section class="finance-list">${goals.map(([id, g]) => renderGoalCard(id, g)).join('') || '<div class="empty-state">Aún no hay objetivos.</div>'}</section>`;
  drawGoalDonut(pct);
}

function renderGoalCard(id, g) {
  const p = calcGoalProgress(g);
  const leftDays = Math.max(0, Math.ceil((new Date(`${g.targetDate || dateKey()}T12:00:00`) - new Date()) / 86400000));
  return `<button class="finance-goal-card" data-goal-id="${id}">
    <span class="finance-goal-ring" style="--pct:${p.pct};--ring:${g.color || '#8b7dff'}">${Math.round(p.pct)}%</span>
    <span><strong>${g.name || 'Objetivo'}</strong><small>${formatCurrency(p.saved)} / ${formatCurrency(p.target)}</small><small>Quedan ${leftDays} días</small></span>
    <span class="finance-dot-menu" data-goal-menu="${id}">⋮</span>
  </button>`;
}

function renderCalendar() {
  const host = document.getElementById('finance-content');
  host.innerHTML = `<section class="finance-panel"><div class="finance-row"><h3>Calendario de variación</h3>
  <select id="fin-gran"><option value="day">Día</option><option value="month">Mes</option><option value="year">Año</option></select></div>
  <div class="finance-row"><input id="fin-year" type="number" value="${state.selectedYear}"><select id="fin-account"><option value="total">Total</option>${getAccountsOrdered().map(([id,a])=>`<option value="${id}">${a.name}</option>`).join('')}</select></div>
  <div class="finance-grid" id="finance-grid"></div></section>`;
  document.getElementById('fin-gran').value = state.granularity;
  document.getElementById('fin-account').value = state.selectedAccountId;
  buildGrid();
}

function buildGrid() {
  const grid = document.getElementById('finance-grid');
  if (!grid) return;
  const series = getSeries(state.selectedAccountId);
  const map = new Map(series.map(s => [s.date, s.value]));
  if (state.granularity === 'day') {
    const days = new Date(state.selectedYear, state.selectedMonth + 1, 0).getDate();
    grid.innerHTML = ['L','M','X','J','V','S','D'].map(d=>`<div class="fin-head">${d}</div>`).join('');
    for (let d=1; d<=days; d++) {
      const key = `${state.selectedYear}-${String(state.selectedMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const cur = map.get(key);
      const prev = findPrevValue(series, key);
      const delta = Number.isFinite(cur) ? cur - prev : null;
      grid.insertAdjacentHTML('beforeend', `<button class="fin-cell ${badgeClass(delta||0)}" data-period="${key}">${Number.isFinite(delta) ? formatSignedCurrency(delta) : '—'}<small>${prev ? formatSignedPercent((delta/prev)*100) : '—'}</small></button>`);
    }
  } else if (state.granularity === 'month') {
    grid.innerHTML = '';
    for (let m=0;m<12;m++) {
      const end = `${state.selectedYear}-${String(m+1).padStart(2,'0')}-31`;
      const cur = findPrevValue(series, end);
      const prev = findPrevValue(series, `${state.selectedYear}-${String(m).padStart(2,'0')}-31`);
      const delta = cur - prev;
      grid.insertAdjacentHTML('beforeend', `<button class="fin-cell ${badgeClass(delta)}" data-period="${state.selectedYear}-${m+1}">${['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'][m]}<small>${formatSignedCurrency(delta)}</small></button>`);
    }
  } else {
    grid.innerHTML = '';
    const years = [...new Set(series.map(s => s.date.slice(0,4)))];
    years.forEach(y=>{
      const cur = findPrevValue(series, `${y}-12-31`);
      const prev = findPrevValue(series, `${Number(y)-1}-12-31`);
      const delta = cur - prev;
      grid.insertAdjacentHTML('beforeend', `<button class="fin-cell ${badgeClass(delta)}" data-period="${y}">${y}<small>${formatSignedCurrency(delta)}</small></button>`);
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
  <div class="finance-modal-actions"><button class="btn" data-close>Cancelar</button><button class="btn primary" id="goal-save">Guardar</button></div></div></div>`;
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
      order: Date.now()
    };
    if (goalId) await update(ref(db, `${ROOT}/goals/${goalId}`), payload);
    else await set(push(ref(db, `${ROOT}/goals`)), payload);
    closeModal();
  });
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
    return `<tr><td>${formatDateEs(row.date)}</td><td>${formatCurrency(row.value)}</td><td class="${badgeClass(d)}">${formatSignedCurrency(d)}</td><td class="${badgeClass(d)}">${formatSignedPercent(pct)}</td></tr>`;
  }).join('')}</tbody></table></div>
  <div class="finance-modal-actions"><button class="btn" data-close>Cerrar</button></div></div></div>`;
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
  if (!el || !window.echarts) return;
  const chart = window.echarts.init(el, null, { renderer: 'canvas' });
  chart.setOption({ grid: { top: 6, bottom: 6, left: 4, right: 4 }, xAxis: { type: 'category', show: false, data: series.map(s=>s.date) }, yAxis: { type: 'value', show: false }, series: [{ type: 'line', smooth: true, data: series.map(s=>s.value), symbol: 'none', lineStyle: { color: '#7b8bff', width: 2 }, areaStyle: { color: 'rgba(123,139,255,.14)' } }] });
}

function drawGoalDonut(pct) {
  const el = document.getElementById('finance-goal-donut');
  if (!el || !window.echarts) return;
  const chart = window.echarts.init(el);
  chart.setOption({ series: [{ type: 'pie', radius: ['68%','88%'], label: { show: true, position: 'center', formatter: `${Math.round(pct)}%`, color: '#fff', fontSize: 20, fontWeight: 700 }, data: [{ value: pct, itemStyle: { color: '#8b7dff' } }, { value: 100-pct, itemStyle: { color: 'rgba(255,255,255,.12)' } }] }] });
}

function drawHistoryChart(series) {
  const el = document.getElementById('finance-history-chart');
  if (!el || !window.echarts) return;
  const data = series.slice(-120);
  const chart = window.echarts.init(el);
  chart.setOption({ tooltip: { trigger: 'axis' }, grid: { top: 22, left: 16, right: 16, bottom: 24 }, xAxis: { type: 'category', data: data.map(s=>s.date), axisLabel: { show: false } }, yAxis: { type: 'value', splitLine: { lineStyle: { color: 'rgba(255,255,255,.08)' } } }, series: [{ type: 'line', data: data.map(s=>s.value), smooth: true, symbolSize: 6, itemStyle: { color: '#58d4a5' }, lineStyle: { color: '#58d4a5' } }] });
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
  const account = e.target.closest('[data-account-id]');
  if (account) return openHistoryModal(account.dataset.accountId);
  const cell = e.target.closest('.fin-cell[data-period]');
  if (cell) return openHistoryModal(state.selectedAccountId, cell.dataset.period);
}

function onRootChange(e) {
  if (e.target.id === 'finance-range') { state.range = e.target.value; renderOverview(); }
  if (e.target.id === 'fin-gran') { state.granularity = e.target.value; renderCalendar(); }
  if (e.target.id === 'fin-account') { state.selectedAccountId = e.target.value; buildGrid(); }
  if (e.target.id === 'fin-year') { state.selectedYear = Number(e.target.value) || new Date().getFullYear(); buildGrid(); }
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
