import { ref, onValue, get, child, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db } from './firebase-shared.js';
import { formatCurrency, formatSignedCurrency, formatSignedPercent } from './finance-format.js';

const LS_CUENTAS = 'mis_cuentas_fase1_cuentas';
const LS_DATA = 'mis_cuentas_fase1_data';
const FIN_PATH = 'vuxel/finance';
const DEFAULT_CUENTAS = ['Principal', 'Ahorro', 'Broker'];
const TODAY = () => new Date().toISOString().slice(0, 10);
const WEEK_DAYS = ['L', 'M', 'X', 'J', 'V', 'S', 'D'];
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

const state = {
  view: 'cuentas',
  cuentas: [],
  registros: [],
  objetivos: [],
  finanzas: { ingreso: 0, inversiones: 0, fijas: [], variables: [], origenVariable: '', origenObjetivos: [], calModo: 'dia', calMes: '', calAnio: new Date().getFullYear() },
  editingInline: null,
  calSelectedDate: TODAY()
};

let isApplyingRemote = false;
let unsubscribeFinance = null;
let financeBootstrapped = false;

function getFinanceScope() {
  return document.getElementById('view-finance');
}

function getFinanceHost(selector, { required = true } = {}) {
  const scope = getFinanceScope();
  const node = scope?.querySelector(selector) || null;
  console.log(`[FIN] host ${node ? 'found' : 'missing'}: ${selector}`);
  if (!node && required) throw new Error(`Finance host missing: ${selector}`);
  return node;
}

function renderFinanceCrash(err) {
  const scope = getFinanceScope();
  if (!scope) return;
  const host = scope.querySelector('#finance-content') || scope;
  host.innerHTML = `<div class="finance-panel"><div style="font-size:18px;font-weight:700;margin-bottom:8px;">Finance crashed</div><pre style="white-space:pre-wrap;opacity:.85">${String(err?.stack || err)}</pre></div>`;
}

function parseNumber(v) { const n = Number(String(v ?? '').replace(/\./g, '').replace(',', '.')); return Number.isFinite(n) ? n : 0; }
function valueToneClass(v) { return v > 0 ? 'tone-pos' : v < 0 ? 'tone-neg' : 'tone-neutral'; }
function sortRegistros() { state.registros.sort((a, b) => String(a.fecha || '').localeCompare(String(b.fecha || ''))); }

function getFallbackSaldos() {
  return Object.fromEntries((state.cuentas.length ? state.cuentas : DEFAULT_CUENTAS).map((n) => [n, 0]));
}

function getLastKnownSaldosBefore(fecha) {
  sortRegistros();
  const acc = getFallbackSaldos();
  for (const row of state.registros) {
    if (row.fecha >= fecha) break;
    const saldos = row.saldos || {};
    state.cuentas.forEach((c) => {
      if (Number.isFinite(Number(saldos[c]))) acc[c] = Number(saldos[c]);
    });
  }
  return acc;
}

function fillSaldosForDate(fecha, current = {}) {
  const base = getLastKnownSaldosBefore(fecha);
  const merged = { ...base, ...(current || {}) };
  state.cuentas.forEach((c) => {
    if (!Number.isFinite(Number(merged[c]))) merged[c] = Number(base[c] || 0);
  });
  return merged;
}

function recalcVariaciones() {
  sortRegistros();
  const known = getFallbackSaldos();
  let prev = 0;
  state.registros.forEach((r) => {
    r.saldos = fillSaldosForDate(r.fecha, r.saldos || {});
    state.cuentas.forEach((c) => { known[c] = Number(r.saldos[c] || known[c] || 0); });
    r.total = state.cuentas.reduce((acc, c) => acc + Number(known[c] || 0), 0);
    r.variacion = Number((r.total - prev).toFixed(2));
    r.varpct = prev ? Number(((r.variacion / prev) * 100).toFixed(2)) : 0;
    prev = r.total;
  });
}

function hasRemotePayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  return ['cuentas', 'registros', 'objetivos', 'gastos', 'finanzas'].some((k) => payload[k] != null);
}

function readLegacyLocalSnapshot() {
  const cuentasRaw = JSON.parse(localStorage.getItem(LS_CUENTAS) || 'null');
  const dataRaw = JSON.parse(localStorage.getItem(LS_DATA) || 'null');
  if (!Array.isArray(cuentasRaw) && !Array.isArray(dataRaw?.registros) && !Array.isArray(dataRaw?.objetivos)) return null;
  return {
    cuentas: Array.isArray(cuentasRaw) && cuentasRaw.length ? cuentasRaw : [...DEFAULT_CUENTAS],
    registros: Array.isArray(dataRaw?.registros) ? dataRaw.registros : [],
    objetivos: Array.isArray(dataRaw?.objetivos) ? dataRaw.objetivos : [],
    gastos: Array.isArray(dataRaw?.finanzas?.variables) ? dataRaw.finanzas.variables : [],
    finanzas: dataRaw?.finanzas || null
  };
}

async function finLoadFromRTDB() {
  console.log('[FIN] finLoadFromRTDB start');
  const rootRef = ref(db);
  const [cuentasSnap, registrosSnap, objetivosSnap, gastosSnap, finanzasSnap] = await Promise.all([
    get(child(rootRef, `${FIN_PATH}/cuentas`)),
    get(child(rootRef, `${FIN_PATH}/registros`)),
    get(child(rootRef, `${FIN_PATH}/objetivos`)),
    get(child(rootRef, `${FIN_PATH}/gastos`)),
    get(child(rootRef, `${FIN_PATH}/finanzas`))
  ]);

  const remote = {
    cuentas: cuentasSnap.val(),
    registros: registrosSnap.val(),
    objetivos: objetivosSnap.val(),
    gastos: gastosSnap.val(),
    finanzas: finanzasSnap.val()
  };

  const legacy = !hasRemotePayload(remote) ? readLegacyLocalSnapshot() : null;
  if (legacy) {
    state.cuentas = legacy.cuentas;
    state.registros = legacy.registros;
    state.objetivos = legacy.objetivos;
    state.finanzas = { ...state.finanzas, ...(legacy.finanzas || {}), variables: legacy.gastos };
    await finSaveToRTDB();
  } else {
    state.cuentas = Array.isArray(remote.cuentas) && remote.cuentas.length ? remote.cuentas : [...DEFAULT_CUENTAS];
    state.registros = Array.isArray(remote.registros) ? remote.registros : [];
    state.objetivos = Array.isArray(remote.objetivos) ? remote.objetivos : [];
    state.finanzas = { ...state.finanzas, ...(remote.finanzas || {}), variables: Array.isArray(remote.gastos) ? remote.gastos : [] };
  }

  if (!state.finanzas.origenVariable) state.finanzas.origenVariable = state.cuentas[0] || '';
  if (!state.finanzas.calMes) state.finanzas.calMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  recalcVariaciones();
  console.log('[FIN] data loaded', {
    cuentas: state.cuentas.length,
    registros: state.registros.length,
    objetivos: state.objetivos.length,
    variables: state.finanzas.variables.length
  });
  render();
  console.log('[FIN] render after load OK');
}

async function finSaveToRTDB() {
  if (isApplyingRemote) return;
  await update(ref(db), {
    [`${FIN_PATH}/cuentas`]: state.cuentas ?? [],
    [`${FIN_PATH}/registros`]: state.registros ?? [],
    [`${FIN_PATH}/objetivos`]: state.objetivos ?? [],
    [`${FIN_PATH}/gastos`]: state.finanzas.variables ?? [],
    [`${FIN_PATH}/finanzas`]: { ...state.finanzas, variables: [] },
    [`${FIN_PATH}/meta/updatedAt`]: Date.now()
  });
}

function finSubscribeRTDB() {
  if (unsubscribeFinance) unsubscribeFinance();
  unsubscribeFinance = onValue(ref(db, FIN_PATH), (snap) => {
    const remote = snap.val() || {};
    isApplyingRemote = true;
    state.cuentas = Array.isArray(remote.cuentas) && remote.cuentas.length ? remote.cuentas : [...DEFAULT_CUENTAS];
    state.registros = Array.isArray(remote.registros) ? remote.registros : [];
    state.objetivos = Array.isArray(remote.objetivos) ? remote.objetivos : [];
    state.finanzas = { ...state.finanzas, ...(remote.finanzas || {}), variables: Array.isArray(remote.gastos) ? remote.gastos : [] };
    recalcVariaciones();
    render();
    isApplyingRemote = false;
  });
}

function persistAndRender() { recalcVariaciones(); void finSaveToRTDB(); render(); }

function upsertRegistroCuenta(cuenta, fecha, valor) {
  if (!state.cuentas.includes(cuenta)) return;
  let row = state.registros.find((r) => r.fecha === fecha);
  if (row) {
    row.saldos = row.saldos || {};
    row.saldos[cuenta] = Number(valor || 0);
    row.saldos = fillSaldosForDate(fecha, row.saldos);
    row.total = state.cuentas.reduce((acc, c) => acc + Number(row.saldos[c] || 0), 0);
  } else {
    const base = getLastKnownSaldosBefore(fecha);
    base[cuenta] = Number(valor || 0);
    row = { fecha, saldos: fillSaldosForDate(fecha, base), total: 0, variacion: 0, varpct: 0 };
    row.total = state.cuentas.reduce((acc, c) => acc + Number(row.saldos[c] || 0), 0);
    state.registros.push(row);
  }
  recalcVariaciones();
  persistAndRender();
}

function getSnapshot() {
  return {
    cuentas: [...state.cuentas],
    registros: state.registros.map((r) => ({ ...r, saldos: { ...(r.saldos || {}) } })),
    objetivos: state.objetivos.map((g) => ({ ...g }))
  };
}

function getRowAtOrBefore(fecha) {
  sortRegistros();
  let found = null;
  for (const row of state.registros) {
    if (row.fecha <= fecha) found = row;
    if (row.fecha > fecha) break;
  }
  return found;
}

function getMetricAtDate(fecha, cuenta = 'Total (todas)') {
  const row = getRowAtOrBefore(fecha);
  if (!row) return null;
  if (cuenta === 'Total (todas)') return Number(row.total || 0);
  return Number(row.saldos?.[cuenta]);
}

function getSaldosActuales() {
  const last = state.registros.at(-1);
  if (!last) return getFallbackSaldos();
  return fillSaldosForDate(last.fecha, last.saldos || {});
}

window.getFinanzasSnapshot = getSnapshot;
window.FIN_GLOBAL = {
  getCuentas: () => [...state.cuentas],
  getRegistros: () => getSnapshot().registros,
  getLastRegistro: () => ({ ...(state.registros.at(-1) || null) }),
  getSaldosActuales,
  upsertRegistroCuenta
};

function loadLocal() {
  state.cuentas = [...DEFAULT_CUENTAS];
  state.registros = [];
  state.objetivos = [];
  if (!state.finanzas.origenVariable) state.finanzas.origenVariable = state.cuentas[0] || '';
  if (!state.finanzas.calMes) state.finanzas.calMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
}

function createModalBase({ title, body, cancel = 'Cancelar', confirm = 'Guardar', danger = false, onConfirm }) {
  const backdrop = getFinanceHost('#finance-modal-backdrop');
  backdrop.classList.remove('hidden');
  backdrop.innerHTML = `<div class="modal finance-modal"><div class="modal-header"><div class="modal-title">${title}</div><button class="icon-btn" data-close>✕</button></div><div class="modal-body">${body}</div><div class="modal-footer sheet-footer"><button class="opal-pill" data-close>${cancel}</button><button class="opal-pill ${danger ? '' : 'opal-pill--primary'}" data-modal-confirm>${confirm}</button></div></div>`;
  const close = () => { backdrop.classList.add('hidden'); backdrop.innerHTML = ''; };
  backdrop.onclick = (e) => { if (e.target === backdrop || e.target.closest('[data-close]')) close(); };
  backdrop.querySelector('[data-modal-confirm]')?.addEventListener('click', () => {
    const shouldClose = onConfirm?.(backdrop.querySelector('.modal'));
    if (shouldClose !== false) close();
  });
}

function renderTopNav() {
  const root = getFinanceHost('#finance-topnav');
  const items = [['cuentas', '💳'], ['gastos', '🧾'], ['objetivos', '◎'], ['calendario', '📅']];
  root.innerHTML = items.map(([id, ic]) => `<button class="finance-mini-btn ${state.view === id ? 'active' : ''}" data-fin-view="${id}">${ic}</button>`).join('');
}

function ensureTodayRow() {
  if (state.registros.some((r) => r.fecha === TODAY())) return;
  state.registros.push({ fecha: TODAY(), saldos: fillSaldosForDate(TODAY(), {}), total: 0, variacion: 0, varpct: 0 });
  recalcVariaciones();
}

function renderSparkline(points) {
  if (!points.length) return '<div class="finance-spark-empty"></div>';
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 1);
  const coords = points.map((v, i) => {
    const x = points.length === 1 ? 0 : (i / (points.length - 1)) * 100;
    const y = 100 - ((v - min) / (max - min || 1)) * 100;
    return `${x},${y}`;
  }).join(' ');
  return `<svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height="92"><polyline fill="none" stroke="#90a7ff" stroke-width="2" points="${coords}"/></svg>`;
}

function renderCuentas() {
  ensureTodayRow();
  const host = getFinanceHost('#finance-content');
  const last = state.registros.at(-1) || { total: 0, variacion: 0, varpct: 0 };
  const pts = state.registros.map((r) => Number(r.total || 0));
  host.innerHTML = `<section class="finance-panel"><div class="finance-overview-hero ${valueToneClass(last.variacion)}"><div class="finance-overview-top"><button class="finance-total">${formatCurrency(last.total || 0)}</button><button class="opal-pill" id="fin-add-account">+ Cuenta</button></div><div class="finance-delta-row"><span class="finance-sign-badge ${valueToneClass(last.variacion)}">${formatSignedCurrency(last.variacion || 0)} · ${formatSignedPercent(last.varpct || 0)}</span></div><div class="finance-spark">${renderSparkline(pts)}</div></div></section><section class="finance-list">${state.cuentas.map((c) => {
    const row = state.registros.at(-1);
    const prev = state.registros.at(-2);
    const cur = Number(row?.saldos?.[c] || 0);
    const pv = Number(prev?.saldos?.[c] || 0);
    const delta = cur - pv;
    return `<article class="finance-account-card ${valueToneClass(delta)}" data-account="${c}"><button class="finance-dot-menu" data-account-menu="${c}">⋮</button><div class="finance-account-main"><div class="finance-account-name">${c}</div><div class="finance-edit-zone"><button class="finance-amount-display ${state.editingInline === c ? 'hidden' : ''}" data-now-display="${c}">${formatCurrency(cur)}</button><input class="finance-inline-input ${state.editingInline === c ? '' : 'hidden'}" data-now-input="${c}" placeholder="${cur}" /></div><small class="${valueToneClass(delta)}">${formatSignedCurrency(delta)}</small></div></article>`;
  }).join('')}</section>`;
}

function getObjetivosCapitalDisponible() {
  const map = getSaldosActuales();
  const origen = Array.isArray(state.finanzas.origenObjetivos) && state.finanzas.origenObjetivos.length ? state.finanzas.origenObjetivos : state.cuentas;
  return origen.reduce((acc, c) => acc + Number(map[c] || 0), 0);
}

function renderObjetivos() {
  const host = getFinanceHost('#finance-content');
  const totalObj = state.objetivos.reduce((a, o) => a + Number(o.objetivo || 0), 0);
  const totalAho = state.objetivos.reduce((a, o) => a + Number(o.ahorrado || 0), 0);
  const origen = Array.isArray(state.finanzas.origenObjetivos) && state.finanzas.origenObjetivos.length ? state.finanzas.origenObjetivos.join(', ') : 'Todas';
  const cap = getObjetivosCapitalDisponible();
  const pct = totalObj ? Math.min(100, (totalAho / totalObj) * 100) : 0;
  host.innerHTML = `<section class="finance-panel"><div class="finance-goal-header"><button class="opal-pill opal-pill--primary" id="goal-new">Nuevo objetivo</button><button class="opal-pill" id="goal-origin">Cuentas origen</button></div><div class="finance-goal-meta">Objetivo ${formatCurrency(totalObj)} · Ahorrado ${formatCurrency(totalAho)}</div><div class="finance-goal-meta">Origen: ${origen}</div><div class="finance-goal-meta">Disponible: ${formatCurrency(cap)}</div><div class="finance-donut"><div class="finance-goal-ring" style="--ring:#8b7dff;--pct:${pct}">${Math.round(pct)}%</div></div></section><section class="finance-list">${state.objetivos.map((o, i) => `<article class="finance-goal-card"><span><strong>${o.nombre}</strong><small>${formatCurrency(o.ahorrado || 0)} / ${formatCurrency(o.objetivo || 0)}</small><small>${o.fecha || 'Sin fecha'}</small></span><button class="finance-dot-menu" data-del-goal="${i}">⋮</button></article>`).join('') || '<div class="empty-state">Sin objetivos</div>'}</section>`;
}

function renderGastos() {
  const host = getFinanceHost('#finance-content');
  const vars = state.finanzas.variables || [];
  host.innerHTML = `<section class="finance-panel"><div class="finance-row"><label class="opal-select-wrap"><span>Cuenta a descontar</span><select class="opal-select" id="fin-origen">${state.cuentas.map((c) => `<option ${state.finanzas.origenVariable === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label><button class="opal-pill" id="fin-new-fixed">Nuevo gasto fijo</button></div><button class="opal-pill opal-pill--primary" id="fin-add-variable">Registrar gasto variable</button></section><section class="finance-list">${vars.map((g, i) => `<article class="finance-account-card tone-neg"><div><b>${formatCurrency(g.importe || 0)}</b><div>${g.categoria || 'General'} · ${g.cuenta} · ${g.fecha}</div>${g.etiqueta ? `<small>${g.etiqueta}</small>` : ''}</div><button class="finance-dot-menu" data-del-var="${i}">⋮</button></article>`).join('') || '<div class="empty-state">Sin gastos variables</div>'}</section>`;
}

function renderCalendario() {
  const host = getFinanceHost('#finance-content');
  const selectedCuenta = state.finanzas.calCuenta || 'Total (todas)';
  const [yRaw, mRaw] = String(state.finanzas.calMes || '').split('-');
  const year = Number(yRaw || state.finanzas.calAnio || new Date().getFullYear());
  const month = Number(mRaw || 1);
  const monthOpts = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
    .map((k, i) => `<option value="${k}" ${k === state.finanzas.calMes ? 'selected' : ''}>${MONTHS[i]} de ${year}</option>`).join('');
  host.innerHTML = `<section class="finance-panel"><div class="finance-row"><select id="cal-modo" class="opal-select"><option value="dia" ${state.finanzas.calModo === 'dia' ? 'selected' : ''}>Día</option><option value="mes" ${state.finanzas.calModo === 'mes' ? 'selected' : ''}>Mes</option><option value="anio" ${state.finanzas.calModo === 'anio' ? 'selected' : ''}>Año</option></select><select id="cal-mes" class="opal-select">${monthOpts}</select></div><div class="finance-row"><input id="cal-anio" class="opal-input" type="number" value="${year}" /><select id="cal-cuenta" class="opal-select"><option ${selectedCuenta === 'Total (todas)' ? 'selected' : ''}>Total (todas)</option>${state.cuentas.map((c) => `<option ${selectedCuenta === c ? 'selected' : ''}>${c}</option>`).join('')}</select></div><div id="cal-grid" class="finance-grid"></div></section>`;
  const grid = host.querySelector('#cal-grid');
  if (state.finanzas.calModo === 'dia') {
    grid.innerHTML = WEEK_DAYS.map((d) => `<div class="fin-head">${d}</div>`).join('');
    const first = new Date(year, month - 1, 1);
    const days = new Date(year, month, 0).getDate();
    const offset = (first.getDay() + 6) % 7;
    for (let i = 0; i < offset; i += 1) grid.innerHTML += '<div class="fin-cell tone-neutral"></div>';
    for (let d = 1; d <= days; d += 1) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const prevDate = new Date(`${date}T00:00:00`); prevDate.setDate(prevDate.getDate() - 1);
      const prevKey = prevDate.toISOString().slice(0, 10);
      const cur = getMetricAtDate(date, selectedCuenta);
      const prev = getMetricAtDate(prevKey, selectedCuenta);
      const has = Number.isFinite(cur);
      const delta = has && Number.isFinite(prev) ? cur - prev : 0;
      const pct = has && Number.isFinite(prev) && prev ? (delta / prev) * 100 : 0;
      grid.innerHTML += `<button class="fin-cell ${has ? valueToneClass(delta) : 'tone-neutral'} ${state.calSelectedDate === date ? 'active' : ''}" data-cal-day="${date}"><b>${d}</b><small>${has ? formatCurrency(cur) : '—'}</small><small>${has ? `${formatSignedCurrency(delta)} · ${formatSignedPercent(pct)}` : ''}</small></button>`;
    }
  } else if (state.finanzas.calModo === 'mes') {
    grid.style.gridTemplateColumns = 'repeat(3,minmax(0,1fr))';
    grid.innerHTML = Array.from({ length: 12 }, (_, i) => {
      const end = new Date(year, i + 1, 0).toISOString().slice(0, 10);
      const prevEnd = new Date(year, i, 0).toISOString().slice(0, 10);
      const cur = getMetricAtDate(end, selectedCuenta);
      const prev = getMetricAtDate(prevEnd, selectedCuenta);
      const delta = Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : 0;
      return `<div class="fin-cell ${valueToneClass(delta)}"><b>${MONTHS[i]}</b><small>${formatSignedCurrency(delta)}</small></div>`;
    }).join('');
  } else {
    const years = [...new Set(state.registros.map((r) => Number(String(r.fecha || '').slice(0, 4))).filter(Boolean))];
    grid.style.gridTemplateColumns = 'repeat(2,minmax(0,1fr))';
    grid.innerHTML = years.map((y) => {
      const cur = getMetricAtDate(`${y}-12-31`, selectedCuenta);
      const prev = getMetricAtDate(`${y - 1}-12-31`, selectedCuenta);
      const delta = Number.isFinite(cur) && Number.isFinite(prev) ? cur - prev : 0;
      return `<div class="fin-cell ${valueToneClass(delta)}"><b>${y}</b><small>${formatSignedCurrency(delta)}</small></div>`;
    }).join('') || '<div class="empty-state">Sin años disponibles</div>';
  }
}

function render() {
  renderTopNav();
  if (state.view === 'cuentas') renderCuentas();
  if (state.view === 'gastos') renderGastos();
  if (state.view === 'objetivos') renderObjetivos();
  if (state.view === 'calendario') renderCalendario();
}

function renameCuenta(oldName, nextName) {
  if (!nextName || oldName === nextName || state.cuentas.includes(nextName)) return;
  state.cuentas = state.cuentas.map((c) => (c === oldName ? nextName : c));
  state.registros.forEach((r) => {
    r.saldos = r.saldos || {};
    r.saldos[nextName] = Number(r.saldos[oldName] || 0);
    delete r.saldos[oldName];
  });
  recalcVariaciones();
  persistAndRender();
}

function deleteCuenta(cuenta) {
  state.cuentas = state.cuentas.filter((c) => c !== cuenta);
  state.registros.forEach((r) => { delete r.saldos?.[cuenta]; });
  state.finanzas.origenVariable = state.cuentas[0] || '';
  state.finanzas.origenObjetivos = (state.finanzas.origenObjetivos || []).filter((c) => c !== cuenta);
  recalcVariaciones();
  persistAndRender();
}

function onRootClick(e) {
  const v = e.target.closest('[data-fin-view]');
  if (v) { state.view = v.dataset.finView; render(); return; }

  if (e.target.id === 'fin-add-account') {
    createModalBase({
      title: 'Nueva cuenta',
      body: '<label class="opal-select-wrap"><span>Nombre</span><input class="opal-input" id="new-account-name" /></label>',
      onConfirm: (node) => {
        const name = node.querySelector('#new-account-name')?.value?.trim();
        if (!name || state.cuentas.includes(name)) return false;
        state.cuentas.push(name);
        state.registros.forEach((r) => { r.saldos = r.saldos || {}; r.saldos[name] = Number(r.saldos[name] || 0); });
        recalcVariaciones();
        persistAndRender();
        return true;
      }
    });
    return;
  }

  const menu = e.target.closest('[data-account-menu]');
  if (menu) {
    const cuenta = menu.dataset.accountMenu;
    createModalBase({
      title: cuenta,
      confirm: 'Guardar',
      body: `<label class="opal-select-wrap"><span>Renombrar</span><input class="opal-input" id="rename-account" value="${cuenta}" /></label><button class="opal-pill" id="delete-account-btn">Eliminar cuenta</button>`,
      onConfirm: (node) => {
        renameCuenta(cuenta, node.querySelector('#rename-account')?.value?.trim());
        return true;
      }
    });
    document.getElementById('delete-account-btn')?.addEventListener('click', () => {
      createModalBase({ title: 'Eliminar cuenta', confirm: 'Eliminar', danger: true, body: `<p>¿Eliminar ${cuenta} y su historial?</p>`, onConfirm: () => { deleteCuenta(cuenta); return true; } });
    });
    return;
  }

  const display = e.target.closest('[data-now-display]');
  if (display) {
    const c = display.dataset.nowDisplay;
    state.editingInline = c;
    render();
    document.querySelector(`[data-now-input="${c}"]`)?.focus();
    return;
  }

  if (e.target.id === 'goal-new') {
    createModalBase({
      title: 'Nuevo objetivo',
      body: `<label class="opal-select-wrap"><span>Nombre</span><input class="opal-input" id="goal-nombre" /></label><label class="opal-select-wrap"><span>Objetivo €</span><input class="opal-input" id="goal-obj" /></label><label class="opal-select-wrap"><span>Ahorrado €</span><input class="opal-input" id="goal-aho" /></label><label class="opal-select-wrap"><span>Fecha objetivo</span><input class="opal-input" id="goal-fecha" type="date" value="${TODAY()}" /></label><label class="opal-select-wrap"><span>Color</span><input class="opal-input" id="goal-color" value="#8b7dff" /></label>`,
      onConfirm: (node) => {
        const nombre = node.querySelector('#goal-nombre')?.value?.trim();
        if (!nombre) return false;
        state.objetivos.push({ nombre, objetivo: parseNumber(node.querySelector('#goal-obj')?.value), ahorrado: parseNumber(node.querySelector('#goal-aho')?.value), fecha: node.querySelector('#goal-fecha')?.value || TODAY(), color: node.querySelector('#goal-color')?.value || '#8b7dff' });
        persistAndRender();
        return true;
      }
    });
    return;
  }

  if (e.target.id === 'goal-origin') {
    createModalBase({
      title: 'Cuentas origen',
      body: state.cuentas.map((c) => `<label class="finance-chip ${state.finanzas.origenObjetivos?.includes(c) ? 'tone-pos' : 'tone-neutral'}"><input type="checkbox" data-origin-c="${c}" ${state.finanzas.origenObjetivos?.includes(c) ? 'checked' : ''}/> ${c}</label>`).join(''),
      onConfirm: (node) => {
        const picks = [...node.querySelectorAll('[data-origin-c]:checked')].map((i) => i.dataset.originC);
        state.finanzas.origenObjetivos = picks;
        persistAndRender();
        return true;
      }
    });
    return;
  }

  const delGoal = e.target.closest('[data-del-goal]');
  if (delGoal) {
    const idx = Number(delGoal.dataset.delGoal);
    createModalBase({ title: 'Eliminar objetivo', confirm: 'Eliminar', danger: true, body: '<p>¿Eliminar objetivo?</p>', onConfirm: () => { state.objetivos.splice(idx, 1); persistAndRender(); return true; } });
  }

  if (e.target.id === 'fin-add-variable') {
    createModalBase({
      title: 'Registrar gasto variable',
      body: `<label class="opal-select-wrap"><span>Importe</span><input class="opal-input" id="gasto-importe" /></label><label class="opal-select-wrap"><span>Categoría</span><input class="opal-input" id="gasto-cat" value="General" /></label><label class="opal-select-wrap"><span>Etiqueta (opcional)</span><input class="opal-input" id="gasto-tag" /></label><label class="opal-select-wrap"><span>Fecha</span><input class="opal-input" id="gasto-fecha" type="date" value="${TODAY()}" /></label><label class="opal-select-wrap"><span>Cuenta a descontar</span><select class="opal-select" id="gasto-cuenta">${state.cuentas.map((c) => `<option ${state.finanzas.origenVariable === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>`,
      onConfirm: (node) => {
        const importe = parseNumber(node.querySelector('#gasto-importe')?.value);
        if (!importe) return false;
        const fecha = node.querySelector('#gasto-fecha')?.value || TODAY();
        const cuenta = node.querySelector('#gasto-cuenta')?.value || state.cuentas[0];
        const saldoPrevio = Number(getMetricAtDate(fecha, cuenta));
        const saldoBase = Number.isFinite(saldoPrevio) ? saldoPrevio : Number(getLastKnownSaldosBefore(fecha)[cuenta] || 0);
        state.finanzas.variables.push({ fecha, importe, categoria: node.querySelector('#gasto-cat')?.value || 'General', etiqueta: node.querySelector('#gasto-tag')?.value || '', cuenta });
        upsertRegistroCuenta(cuenta, fecha, Number((saldoBase - importe).toFixed(2)));
        return true;
      }
    });
    return;
  }

  const delVar = e.target.closest('[data-del-var]');
  if (delVar) {
    const idx = Number(delVar.dataset.delVar);
    createModalBase({ title: 'Eliminar gasto', confirm: 'Eliminar', danger: true, body: '<p>¿Eliminar gasto del historial?</p>', onConfirm: () => { state.finanzas.variables.splice(idx, 1); persistAndRender(); return true; } });
  }

  if (e.target.id === 'fin-new-fixed') {
    createModalBase({
      title: 'Nuevo gasto fijo',
      body: `<label class="opal-select-wrap"><span>Nombre</span><input class="opal-input" id="fijo-nombre" /></label><label class="opal-select-wrap"><span>Importe mensual</span><input class="opal-input" id="fijo-importe" /></label><label class="opal-select-wrap"><span>Categoría</span><input class="opal-input" id="fijo-cat" value="General" /></label><label class="finance-chip tone-neutral"><input type="checkbox" id="fijo-esencial" /> Esencial</label>`,
      onConfirm: (node) => {
        const nombre = node.querySelector('#fijo-nombre')?.value?.trim();
        if (!nombre) return false;
        state.finanzas.fijas.push({ nombre, importe: parseNumber(node.querySelector('#fijo-importe')?.value), categoria: node.querySelector('#fijo-cat')?.value || 'General', esencial: !!node.querySelector('#fijo-esencial')?.checked });
        persistAndRender();
        return true;
      }
    });
    return;
  }

  const calDay = e.target.closest('[data-cal-day]');
  if (calDay) state.calSelectedDate = calDay.dataset.calDay;
}

function onRootChange(e) {
  if (e.target.id === 'fin-origen') { state.finanzas.origenVariable = e.target.value; persistAndRender(); }
  if (e.target.id === 'cal-modo') { state.finanzas.calModo = e.target.value; renderCalendario(); }
  if (e.target.id === 'cal-mes') { state.finanzas.calMes = e.target.value; renderCalendario(); }
  if (e.target.id === 'cal-cuenta') { state.finanzas.calCuenta = e.target.value; renderCalendario(); }
}

function onRootInput(e) {
  if (e.target.id === 'cal-anio') {
    state.finanzas.calAnio = Number(e.target.value || new Date().getFullYear());
    state.finanzas.calMes = `${state.finanzas.calAnio}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
    renderCalendario();
  }
}

function onRootKeydown(e) {
  const input = e.target.closest('[data-now-input]');
  if (!input) return;
  if (e.key === 'Escape') {
    state.editingInline = null;
    render();
  }
  if (e.key === 'Enter') input.blur();
}

function onRootBlur(e) {
  const input = e.target.closest('[data-now-input]');
  if (!input) return;
  const cuenta = input.dataset.nowInput;
  const typed = input.value.trim();
  if (!typed) { state.editingInline = null; render(); return; }
  upsertRegistroCuenta(cuenta, TODAY(), parseNumber(typed));
  state.editingInline = null;
}

function bindInteractions() {
  const root = getFinanceScope();
  root?.addEventListener('click', onRootClick);
  root?.addEventListener('change', onRootChange);
  root?.addEventListener('input', onRootInput);
  root?.addEventListener('keydown', onRootKeydown);
  root?.addEventListener('focusout', onRootBlur);
}

async function maybeBootstrapFinance() {
  if (financeBootstrapped) return;
  const root = getFinanceScope();
  if (!root?.classList.contains('view-active')) return;
  financeBootstrapped = true;
  await finLoadFromRTDB();
  finSubscribeRTDB();
}

async function initFinanceTab() {
  try {
    loadLocal();
    recalcVariaciones();
    bindInteractions();
    render();
    await maybeBootstrapFinance();
    const root = getFinanceScope();
    root?.addEventListener('click', () => { void maybeBootstrapFinance(); });
    const navBtn = document.querySelector('.nav-btn[data-view="view-finance"]');
    navBtn?.addEventListener('click', () => { void maybeBootstrapFinance(); });
  } catch (err) {
    console.error('[FIN] init failed', err);
    renderFinanceCrash(err);
    throw err;
  }
}

async function bootFinance() {
  console.group('[FIN] boot start');
  console.log('[FIN] script loaded', new Date().toISOString());
  try {
    console.log('[FIN] DOM ready state:', document.readyState);

    const root = getFinanceScope();
    console.log('[FIN] view-finance found:', !!root);
    getFinanceHost('#finance-topnav', { required: false });
    getFinanceHost('#finance-content', { required: false });
    getFinanceHost('#finance-modal-backdrop', { required: false });

    await initFinanceTab();
    console.log('[FIN] initFinanceTab OK');
  } catch (err) {
    console.error('[FIN] boot FAILED:', err);
    renderFinanceCrash(err);
  } finally {
    console.groupEnd();
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { void bootFinance(); }, { once: true });
else void bootFinance();
