import { ref, onValue, set, update, remove, push, off } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';
import { formatCurrency, formatSignedCurrency, formatSignedPercent } from './finance-format.js';

const LS_CUENTAS = 'mis_cuentas_fase1_cuentas';
const LS_DATA = 'mis_cuentas_fase1_data';
const LS_UID = 'mis_cuentas_uid';
const DEFAULT_CUENTAS = ['Principal', 'Ahorro', 'Broker'];
const TODAY = () => new Date().toISOString().slice(0, 10);

const state = {
  uid: String(window.__bookshellUid || localStorage.getItem('bookshell.uid') || localStorage.getItem(LS_UID) || 'default'),
  view: 'cuentas',
  cuentas: [],
  registros: [],
  objetivos: [],
  finanzas: { ingreso: 0, inversiones: 0, fijas: [], variables: [], origenVariable: '' },
  selectedCuenta: '',
  editingKey: null,
  cloudUnsubs: []
};

function emitLogin() { window.dispatchEvent(new CustomEvent('finanzas-login', { detail: { uid: state.uid } })); }
function parseNumber(v) { const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function valueToneClass(v) { return v > 0 ? 'tone-pos' : v < 0 ? 'tone-neg' : 'tone-neutral'; }

function getFallbackSaldos() {
  return Object.fromEntries((state.cuentas.length ? state.cuentas : DEFAULT_CUENTAS).map((n) => [n, 0]));
}

function loadLocal() {
  const cuentasRaw = JSON.parse(localStorage.getItem(LS_CUENTAS) || 'null');
  const dataRaw = JSON.parse(localStorage.getItem(LS_DATA) || 'null');
  state.cuentas = Array.isArray(cuentasRaw) && cuentasRaw.length ? cuentasRaw : [...DEFAULT_CUENTAS];
  state.registros = Array.isArray(dataRaw?.registros) ? dataRaw.registros : [];
  state.objetivos = Array.isArray(dataRaw?.objetivos) ? dataRaw.objetivos : [];
  state.finanzas = { ...state.finanzas, ...(dataRaw?.finanzas || {}) };
  if (!state.finanzas.origenVariable) state.finanzas.origenVariable = state.cuentas[0] || '';
}

function persistLocal() {
  localStorage.setItem(LS_UID, state.uid);
  localStorage.setItem(LS_CUENTAS, JSON.stringify(state.cuentas));
  localStorage.setItem(LS_DATA, JSON.stringify({ registros: state.registros, objetivos: state.objetivos, finanzas: state.finanzas }));
}

function sortRegistros() { state.registros.sort((a, b) => a.fecha.localeCompare(b.fecha)); }
function getLastKnownSaldosBefore(fecha) {
  sortRegistros();
  const prev = [...state.registros].reverse().find((r) => r.fecha < fecha);
  return prev ? { ...prev.saldos } : getFallbackSaldos();
}
function fillSaldosForDate(registro) {
  const base = getLastKnownSaldosBefore(registro.fecha);
  registro.saldos = { ...base, ...(registro.saldos || {}) };
  state.cuentas.forEach((c) => { if (!Number.isFinite(registro.saldos[c])) registro.saldos[c] = 0; });
}
function recalcVariaciones() {
  sortRegistros();
  let prev = 0;
  state.registros.forEach((r) => {
    r.total = state.cuentas.reduce((acc, c) => acc + Number(r.saldos?.[c] || 0), 0);
    r.variacion = r.total - prev;
    r.varpct = prev ? (r.variacion / prev) * 100 : 0;
    prev = r.total;
  });
}

function upsertRegistroCuenta(cuenta, fecha, valor) {
  if (!state.cuentas.includes(cuenta)) return;
  let row = state.registros.find((r) => r.fecha === fecha);
  if (row) {
    row.saldos = row.saldos || {};
    row.saldos[cuenta] = valor;
    fillSaldosForDate(row);
  } else {
    const base = getLastKnownSaldosBefore(fecha);
    base[cuenta] = valor;
    row = { fecha, saldos: base, total: 0, variacion: 0, varpct: 0 };
    state.registros.push(row);
  }
  recalcVariaciones();
  persistLocal();
  syncCloud();
  render();
}

function ensureTodayRow() {
  if (state.registros.some((r) => r.fecha === TODAY())) return;
  state.registros.push({ fecha: TODAY(), saldos: getLastKnownSaldosBefore(TODAY()), total: 0, variacion: 0, varpct: 0 });
  recalcVariaciones();
}

function addCuenta() {
  const name = prompt('Nombre de la cuenta');
  if (!name) return;
  const trimmed = name.trim();
  if (!trimmed || state.cuentas.includes(trimmed)) return alert('Nombre inválido o repetido.');
  state.cuentas.push(trimmed);
  state.registros.forEach((r) => { r.saldos = r.saldos || {}; r.saldos[trimmed] = Number(r.saldos[trimmed] || 0); });
  if (!state.finanzas.origenVariable) state.finanzas.origenVariable = trimmed;
  recalcVariaciones(); persistLocal(); syncCloud(); render();
}

function deleteCuenta(cuenta) {
  if (!state.cuentas.includes(cuenta)) return;
  if (!confirm(`Eliminar ${cuenta} y su historial?`)) return;
  state.cuentas = state.cuentas.filter((c) => c !== cuenta);
  state.registros.forEach((r) => delete r.saldos?.[cuenta]);
  if (state.finanzas.origenVariable === cuenta) state.finanzas.origenVariable = state.cuentas[0] || '';
  recalcVariaciones(); persistLocal(); syncCloud(); render();
}

function getCuentaActual(cuenta) {
  sortRegistros();
  const last = [...state.registros].reverse().find((r) => Number.isFinite(r.saldos?.[cuenta]));
  const prev = [...state.registros].reverse().find((r) => r !== last && Number.isFinite(r.saldos?.[cuenta]));
  const cur = Number(last?.saldos?.[cuenta] || 0);
  const pv = Number(prev?.saldos?.[cuenta] || 0);
  const delta = cur - pv;
  return { cur, delta, pct: pv ? (delta / pv) * 100 : 0 };
}

function renderTopNav() {
  const root = document.getElementById('finance-topnav');
  if (!root) return;
  const items = [['cuentas', '💳'], ['gastos', '🧾'], ['objetivos', '◎'], ['calendario', '📅']];
  root.innerHTML = items.map(([id, ic]) => `<button class="finance-mini-btn ${state.view === id ? 'active' : ''}" data-fin-view="${id}">${ic}</button>`).join('');
}

function renderCuentas() {
  ensureTodayRow();
  const host = document.getElementById('finance-content');
  const last = state.registros[state.registros.length - 1] || { total: 0, variacion: 0, varpct: 0 };
  host.innerHTML = `<section class="finance-panel finance-overview-hero ${valueToneClass(last.variacion)}">
    <div class="finance-overview-top"><button class="opal-pill" id="fin-refresh">Actualizar</button><button class="opal-pill opal-pill--primary" id="fin-add-account">Nueva cuenta</button></div>
    <div class="finance-total">${formatCurrency(last.total || 0)}</div>
    <div class="finance-delta-row"><span class="finance-sign-badge ${valueToneClass(last.variacion)}">${formatSignedCurrency(last.variacion)} · ${formatSignedPercent(last.varpct)}</span></div>
    <div class="finance-controls"><button class="opal-pill" id="fin-history-total">Historial</button><select class="opal-select" id="periodo"><option>Mes</option><option>Año</option></select><select class="opal-select" id="comparar"><option>Comparativa</option><option>Mes vs mes</option></select></div>
  </section>
  <section class="finance-list">${state.cuentas.map((c) => {
    const m = getCuentaActual(c);
    return `<article class="finance-account-card ${valueToneClass(m.delta)}" data-account="${c}"><button class="finance-dot-menu" data-del-account="${c}">⋮</button><div class="finance-account-main"><div class="finance-account-name">${c}</div>
      <div class="finance-edit-zone"><button class="finance-amount-display" data-now-display="${c}">${formatCurrency(m.cur)}</button><input class="finance-inline-input hidden" data-now-input="${c}" placeholder="${formatCurrency(m.cur)}" inputmode="decimal"></div></div>
      <div class="finance-account-right"><span class="finance-sign-badge ${valueToneClass(m.delta)}">${formatSignedCurrency(m.delta)} · ${formatSignedPercent(m.pct)}</span></div></article>`;
  }).join('')}</section>`;
}

function renderGastos() {
  const host = document.getElementById('finance-content');
  const f = state.finanzas;
  const comprometido = (Number(f.inversiones || 0)) + f.fijas.reduce((a, g) => a + Number(g.importe || 0), 0);
  const esencial = f.fijas.filter((g) => g.esencial).reduce((a, g) => a + Number(g.importe || 0), 0);
  host.innerHTML = `<section class="finance-panel"><div class="finance-row"><label class="opal-select-wrap"><span>Ingreso mensual</span><input class="opal-input" id="fin-ingreso" value="${f.ingreso || 0}"></label><label class="opal-select-wrap"><span>Inversiones</span><input class="opal-input" id="fin-inv" value="${f.inversiones || 0}"></label></div>
  <div class="finance-chip-row"><span class="finance-chip tone-neutral">Comprometido ${formatCurrency(comprometido)}</span><span class="finance-chip tone-neg">Esencial ${formatCurrency(esencial)}</span></div>
  <div class="finance-row"><label class="opal-select-wrap"><span>Origen de cuenta</span><select class="opal-select" id="fin-origen">${state.cuentas.map((c) => `<option ${f.origenVariable===c?'selected':''}>${c}</option>`).join('')}</select></label><button class="opal-pill" id="fin-new-fixed">Nuevo gasto fijo</button></div>
  </section>
  <section class="finance-list">${f.fijas.map((g, i) => `<article class="finance-account-card ${g.esencial ? 'tone-neg' : 'tone-neutral'}"><div><b>${g.nombre}</b><div>${g.categoria || 'General'}</div></div><div>${formatCurrency(g.importe)}</div><button class="finance-dot-menu" data-del-fixed="${i}">⋮</button></article>`).join('') || '<div class="empty-state">Sin gastos fijos</div>'}
  <button class="opal-pill opal-pill--primary" id="fin-add-variable">Registrar gasto variable</button></section>`;
}

function renderObjetivos() {
  const host = document.getElementById('finance-content');
  const totalObj = state.objetivos.reduce((a, o) => a + Number(o.objetivo || 0), 0);
  const totalAho = state.objetivos.reduce((a, o) => a + Number(o.ahorrado || 0), 0);
  host.innerHTML = `<section class="finance-panel"><div class="finance-goal-header"><button class="opal-pill opal-pill--primary" id="goal-new">Nuevo objetivo</button></div>
  <div class="finance-goal-meta">${formatCurrency(totalAho)} / ${formatCurrency(totalObj)} · Disponible ${formatCurrency((state.registros.at(-1)?.total || 0) - totalAho)}</div></section>
  <section class="finance-list">${state.objetivos.map((o, i) => {
    const pct = o.objetivo ? Math.max(0, Math.min(100, (o.ahorrado / o.objetivo) * 100)) : 0;
    const days = o.fecha ? Math.ceil((new Date(`${o.fecha}T00:00:00`) - new Date()) / 86400000) : null;
    return `<article class="finance-goal-card"><span><strong>${o.nombre}</strong><small>${Math.round(pct)}%</small><small>${days == null ? 'Sin fecha' : `quedan ${days} días`}</small></span><div class="finance-goal-ring" style="--ring:#8b7dff;--pct:${pct}">${Math.round(pct)}%</div><button class="finance-dot-menu" data-del-goal="${i}">⋮</button></article>`;
  }).join('') || '<div class="empty-state">Sin objetivos</div>'}</section>`;
}

function renderCalendario() {
  const host = document.getElementById('finance-content');
  host.innerHTML = `<section class="finance-panel"><div class="finance-grid">${state.registros.map((r) => `<button class="fin-cell ${valueToneClass(r.variacion)}" data-history-day="${r.fecha}"><b>${r.fecha}</b><small>${formatSignedCurrency(r.variacion)}</small></button>`).join('')}</div></section>`;
}

function render() {
  renderTopNav();
  if (state.view === 'cuentas') renderCuentas();
  if (state.view === 'gastos') renderGastos();
  if (state.view === 'objetivos') renderObjetivos();
  if (state.view === 'calendario') renderCalendario();
}

function openCuentaDetalle(cuenta) {
  const rows = state.registros.map((r, i) => ({ x: i, y: Number(r.saldos?.[cuenta] || 0), fecha: r.fecha }));
  const modal = document.getElementById('finance-modal-backdrop');
  modal.classList.remove('hidden');
  modal.innerHTML = `<div class="modal finance-modal"><div class="modal-header"><div class="modal-title">${cuenta}</div><button class="icon-btn" data-close>✕</button></div><div class="modal-body"><canvas id="cuenta-chart" width="300" height="130" style="width:100%;height:130px"></canvas><div id="chart-tip" class="finance-chip tone-neutral">—</div><div class="finance-history-table-wrap"><table class="finance-history-table"><tr><th>Fecha</th><th>Saldo</th><th>⋮</th></tr>${rows.map((r) => `<tr><td>${r.fecha}</td><td>${formatCurrency(r.y)}</td><td><button class="opal-pill" data-edit-day="${cuenta}|${r.fecha}">Editar</button> <button class="opal-pill" data-del-day="${cuenta}|${r.fecha}">Eliminar</button></td></tr>`).join('')}</table></div></div></div>`;
  const cv = document.getElementById('cuenta-chart'); const ctx = cv.getContext('2d');
  const min = Math.min(...rows.map((r) => r.y), 0); const max = Math.max(...rows.map((r) => r.y), 1);
  ctx.strokeStyle = '#7da1ff'; ctx.lineWidth = 2; ctx.beginPath();
  rows.forEach((r, i) => { const x = (i / Math.max(1, rows.length - 1)) * cv.width; const y = cv.height - ((r.y - min) / (max - min || 1)) * cv.height; if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); }); ctx.stroke();
  cv.addEventListener('pointermove', (e) => {
    const idx = Math.round(((e.offsetX / cv.clientWidth) * (rows.length - 1)));
    const row = rows[Math.max(0, Math.min(rows.length - 1, idx))];
    document.getElementById('chart-tip').textContent = `${row.fecha} · ${formatCurrency(row.y)}`;
  });
}

function applyUid(nextUid) {
  const uid = String(nextUid || 'default');
  if (uid === state.uid) return;
  state.uid = uid;
  persistLocal();
  bindCloud();
  emitLogin();
}

function cloudPath(base) { return `users/${state.uid}/finanzas/${base}`; }
function syncCloud() {
  if (!state.uid) return;
  set(ref(db, cloudPath('cuentas')), state.cuentas);
  set(ref(db, cloudPath('data')), { registros: state.registros, objetivos: state.objetivos, finanzas: state.finanzas });
}
function bindCloud() {
  state.cloudUnsubs.forEach((u) => u());
  state.cloudUnsubs = [];
  const cuentasRef = ref(db, cloudPath('cuentas'));
  const dataRef = ref(db, cloudPath('data'));
  const onCuentas = onValue(cuentasRef, (snap) => {
    const remote = snap.val();
    if (Array.isArray(remote) && remote.length) { state.cuentas = remote; persistLocal(); render(); }
  });
  const onData = onValue(dataRef, (snap) => {
    const remote = snap.val() || {};
    if (Array.isArray(remote.registros)) state.registros = remote.registros;
    if (Array.isArray(remote.objetivos)) state.objetivos = remote.objetivos;
    if (remote.finanzas) state.finanzas = { ...state.finanzas, ...remote.finanzas };
    recalcVariaciones(); persistLocal(); render();
  });
  state.cloudUnsubs.push(() => off(cuentasRef, 'value', onCuentas));
  state.cloudUnsubs.push(() => off(dataRef, 'value', onData));
}

function onRootClick(e) {
  const v = e.target.closest('[data-fin-view]'); if (v) { state.view = v.dataset.finView; render(); return; }
  if (e.target.id === 'fin-refresh') { recalcVariaciones(); render(); return; }
  if (e.target.id === 'fin-add-account') return addCuenta();
  const delAccount = e.target.closest('[data-del-account]');
  if (delAccount) {
    const c = delAccount.dataset.delAccount;
    const action = prompt('editar/eliminar');
    if (action === 'eliminar') deleteCuenta(c);
    if (action === 'editar') {
      const n = prompt('Nuevo nombre', c)?.trim();
      if (n && !state.cuentas.includes(n)) {
        state.cuentas = state.cuentas.map((x) => (x === c ? n : x));
        state.registros.forEach((r) => { r.saldos[n] = r.saldos[c]; delete r.saldos[c]; });
        persistLocal(); syncCloud(); render();
      }
    }
    return;
  }
  const display = e.target.closest('[data-now-display]');
  if (display) {
    const c = display.dataset.nowDisplay;
    const zone = display.closest('.finance-edit-zone');
    const input = zone.querySelector(`[data-now-input="${c}"]`);
    display.classList.add('hidden'); input.classList.remove('hidden'); input.value = ''; input.focus();
    return;
  }
  const card = e.target.closest('[data-account]');
  if (card && !e.target.closest('[data-now-display]') && !e.target.closest('[data-del-account]')) openCuentaDetalle(card.dataset.account);

  if (e.target.id === 'fin-new-fixed') {
    const nombre = prompt('Nombre gasto fijo'); if (!nombre) return;
    const importe = parseNumber(prompt('Importe mensual') || '0');
    const categoria = prompt('Categoría', 'General') || 'General';
    const esencial = confirm('¿Es esencial?');
    state.finanzas.fijas.push({ nombre, importe, categoria, esencial }); persistLocal(); syncCloud(); render(); return;
  }
  const delFixed = e.target.closest('[data-del-fixed]');
  if (delFixed) { if (confirm('Eliminar gasto fijo?')) { state.finanzas.fijas.splice(Number(delFixed.dataset.delFixed), 1); persistLocal(); syncCloud(); render(); } return; }
  if (e.target.id === 'fin-add-variable') {
    const importe = parseNumber(prompt('Importe gasto variable') || '0');
    if (!importe) return;
    const categoria = prompt('Categoría', 'General') || 'General';
    const cuenta = state.finanzas.origenVariable || state.cuentas[0];
    const actual = getCuentaActual(cuenta).cur;
    state.finanzas.variables.push({ fecha: TODAY(), importe, categoria, cuenta });
    upsertRegistroCuenta(cuenta, TODAY(), Number((actual - importe).toFixed(2)));
    persistLocal(); syncCloud(); render();
  }

  if (e.target.id === 'goal-new') {
    const nombre = prompt('Nombre del objetivo'); if (!nombre) return;
    const objetivo = parseNumber(prompt('Objetivo') || '0');
    const ahorrado = parseNumber(prompt('Ahorrado') || '0');
    const fecha = prompt('Fecha YYYY-MM-DD', TODAY()) || TODAY();
    state.objetivos.push({ nombre, objetivo, ahorrado, fecha }); persistLocal(); syncCloud(); render();
  }
  const delGoal = e.target.closest('[data-del-goal]');
  if (delGoal) { if (confirm('Eliminar objetivo?')) { state.objetivos.splice(Number(delGoal.dataset.delGoal), 1); persistLocal(); syncCloud(); render(); } }

  if (e.target.closest('[data-close]') || e.target.id === 'finance-modal-backdrop') {
    document.getElementById('finance-modal-backdrop').classList.add('hidden');
    document.getElementById('finance-modal-backdrop').innerHTML = '';
  }

  const editDay = e.target.closest('[data-edit-day]');
  if (editDay) {
    const [cuenta, fecha] = editDay.dataset.editDay.split('|');
    const value = parseNumber(prompt('Nuevo saldo') || '0');
    upsertRegistroCuenta(cuenta, fecha, value);
  }
  const delDay = e.target.closest('[data-del-day]');
  if (delDay) {
    const [cuenta, fecha] = delDay.dataset.delDay.split('|');
    const row = state.registros.find((r) => r.fecha === fecha);
    if (row && confirm('Eliminar registro de cuenta para esa fecha?')) { delete row.saldos[cuenta]; fillSaldosForDate(row); recalcVariaciones(); persistLocal(); syncCloud(); render(); }
  }
}

function onRootChange(e) {
  if (e.target.id === 'fin-origen') { state.finanzas.origenVariable = e.target.value; persistLocal(); syncCloud(); }
  if (e.target.id === 'fin-ingreso') { state.finanzas.ingreso = parseNumber(e.target.value); persistLocal(); syncCloud(); }
  if (e.target.id === 'fin-inv') { state.finanzas.inversiones = parseNumber(e.target.value); persistLocal(); syncCloud(); }
}

function onRootKeydown(e) {
  const input = e.target.closest('[data-now-input]');
  if (!input) return;
  if (e.key === 'Enter') input.blur();
}

function onRootBlur(e) {
  const input = e.target.closest('[data-now-input]');
  if (!input) return;
  const cuenta = input.dataset.nowInput;
  const typed = input.value.trim();
  const v = typed ? parseNumber(typed) : parseNumber(input.placeholder);
  upsertRegistroCuenta(cuenta, TODAY(), v);
}

function bindInteractions() {
  const root = document.getElementById('view-finance');
  root?.addEventListener('click', onRootClick);
  root?.addEventListener('change', onRootChange);
  root?.addEventListener('keydown', onRootKeydown);
  root?.addEventListener('focusout', onRootBlur);
  window.addEventListener('finanzas-login', (e) => applyUid(e.detail?.uid));
}

window.getFinanzasSnapshot = () => ({ uid: state.uid, cuentas: [...state.cuentas], registros: [...state.registros] });

function init() {
  loadLocal();
  recalcVariaciones();
  bindCloud();
  bindInteractions();
  emitLogin();
  render();
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
else init();
