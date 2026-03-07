import { auth, db } from './firebase-shared.js';
import { ref, get, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { buildCharacterSheet } from './character/character-engine.js';
import { renderRangeSelector } from './character/character-ui.js';
import { initIndexedDBSafe } from './indexeddb-safe.js';

const $viewMain = document.getElementById('view-main');
if (!$viewMain) {
  window.__bookshellDashboard = { render: () => {} };
} else {
  const $hero = document.getElementById('rpg-hero');
  const $stats = document.getElementById('rpg-stats');
  const $resources = document.getElementById('rpg-resources');
  const $delta = document.getElementById('rpg-delta');
  const $ranking = document.getElementById('rpg-ranking');
  const $activity = document.getElementById('rpg-activity');
  const $formulas = document.getElementById('rpg-formulas');
  const $config = document.getElementById('rpg-config');

  const fmt = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1 }).format(Number(n || 0));
  const money = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
  const formatCurrencyDelta = (n) => `${Number(n || 0) >= 0 ? '+' : '-'}${money(Math.abs(Number(n || 0)))}`;
  const formatPointsDelta = (n) => `${Number(n || 0) >= 0 ? '+' : '-'}${fmt(Math.abs(Number(n || 0)))} pts`;

  const cache = initIndexedDBSafe({
    dbName: 'bookshell-dashboard',
    storeName: 'characterConfig',
    onWarning(message) {
      showWarning(message);
    }
  });

  let lastSnapshot = {};
  let lastConfig = {};
  let selectedRange = 'week';
  let selectedScope = 'my';
  const FINANCE_TOTALS_CACHE_KEY = 'bookshell:finance:totals:v1';
  let cachedFinanceTotals = null;

  function readFinanceTotalsCache() {
    if (cachedFinanceTotals) return cachedFinanceTotals;
    try {
      const raw = localStorage.getItem(FINANCE_TOTALS_CACHE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') return null;
      cachedFinanceTotals = parsed;
      return parsed;
    } catch (_) {
      return null;
    }
  }

  window.addEventListener?.('bookshell:finance-totals', (event) => {
    cachedFinanceTotals = event?.detail || null;
  });

  function showWarning(message) {
    const id = 'rpg-warning';
    let node = document.getElementById(id);
    if (!node) {
      node = document.createElement('div');
      node.id = id;
      node.className = 'rpg-warning';
      document.body.appendChild(node);
    }
    node.textContent = `⚠️ ${message}`;
    clearTimeout(node.__timer);
    node.__timer = setTimeout(() => node.remove(), 4500);
  }

  function statIcon(type, name = '') {
    if (type === 'language') return '🗣️';
    if (type === 'skill') return '🧠';
    if (type === 'moduleDerived') return name.includes('Oro') ? '💰' : name.includes('Fuerza') ? '💪' : '🌍';
    return '✨';
  }

  function slug(value = '') {
    return String(value).toLowerCase().trim().replace(/\s+/g, '-').replace(/[^a-z0-9áéíóúüñ-]/gi, '').slice(0, 42);
  }

  function escapeHtml(value = '') {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function parseEurCurrencyText(raw = '') {
    const value = String(raw || '').trim();
    if (!value) return NaN;
    const cleaned = value
      .replace(/\s/g, '')
      .replace('€', '')
      .replace(/[^\d,.\-]/g, '');
    if (!cleaned) return NaN;
    const normalized = cleaned.includes(',')
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned;
    const n = Number.parseFloat(normalized);
    return Number.isFinite(n) ? n : NaN;
  }

  function defaultEntryByType(type = 'attribute') {
    if (type === 'language') {
      return { type, name: '', icon: '🗣️', manualLevel: 'A1', description: '', sourceMode: 'manual', manualValue: 0, rankConfig: { enabled: false, basePoints: 120, growth: 8 } };
    }
    if (type === 'skill') {
      return { type, name: '', icon: '🧩', manualLevel: '', description: '', sourceMode: 'manual', manualValue: 0, rankConfig: { enabled: false, basePoints: 120, growth: 8 } };
    }
    return { type: 'attribute', name: '', icon: '✨', manualLevel: '', description: '', sourceMode: 'manual', manualValue: 0, rankConfig: { enabled: true, basePoints: 120, growth: 8 } };
  }

  async function getCharacterConfig(uid) {
    const snap = await get(ref(db, `v2/users/${uid}/dashboardRpg`));
    const raw = snap.val() || {};
    const characterConfig = raw.characterConfig || {};
    const base = {
      characterIdentity: {
        name: characterConfig.characterIdentity?.name || raw.name || characterConfig.name || '',
        alias: characterConfig.characterIdentity?.alias || characterConfig.alias || '',
        birthdate: characterConfig.characterIdentity?.birthdate || raw.birthdate || characterConfig.birthdate || ''
      },
      characterEntries: Array.isArray(characterConfig.characterEntries) ? characterConfig.characterEntries : [],
      entrySources: Array.isArray(characterConfig.entrySources) ? characterConfig.entrySources : []
    };
    await cache.setItem(uid, base);
    return base;
  }

  async function saveCharacterConfig(uid, config) {
    const payload = {
      name: config.characterIdentity?.name || '',
      birthdate: config.characterIdentity?.birthdate || '',
      characterConfig: config
    };
    await update(ref(db, `v2/users/${uid}/dashboardRpg`), payload);
    await cache.setItem(uid, config);
  }

  function ensureSheetModal() {
    let modal = document.getElementById('rpg-sheet-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'rpg-sheet-modal';
    modal.className = 'rpg-sheet-modal hidden';
    modal.innerHTML = '<div class="rpg-sheet-card"><div id="rpg-sheet-content"></div></div>';
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close-modal]')) modal.classList.add('hidden');
    });
    document.body.appendChild(modal);
    return modal;
  }

  function ensureSourceEditorModal() {
    let modal = document.getElementById('rpg-source-editor-modal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'rpg-source-editor-modal';
    modal.className = 'rpg-sheet-modal hidden rpg-sheet-modal-sub';
    modal.innerHTML = '<div class="rpg-sheet-card rpg-sheet-card-sub"><div id="rpg-source-editor-content"></div></div>';
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('[data-close-source-modal]')) modal.classList.add('hidden');
    });
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    ensureSheetModal().classList.add('hidden');
  }

  function closeSourceEditorModal() {
    ensureSourceEditorModal().classList.add('hidden');
  }

  function openSheet(html, onBind) {
    const modal = ensureSheetModal();
    modal.querySelector('#rpg-sheet-content').innerHTML = html;
    modal.classList.remove('hidden');
    if (typeof onBind === 'function') onBind(modal.querySelector('#rpg-sheet-content'));
  }

  function openSourceSheet(html, onBind) {
    const modal = ensureSourceEditorModal();
    modal.querySelector('#rpg-source-editor-content').innerHTML = html;
    modal.classList.remove('hidden');
    if (typeof onBind === 'function') onBind(modal.querySelector('#rpg-source-editor-content'));
  }

  async function persistAndRender(mutator) {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const next = structuredClone(lastConfig || {});
    next.characterIdentity = next.characterIdentity || {};
    next.characterEntries = Array.isArray(next.characterEntries) ? next.characterEntries : [];
    next.entrySources = Array.isArray(next.entrySources) ? next.entrySources : [];
    mutator(next);
    await saveCharacterConfig(uid, next);
    await render();
  }

  function sourceLabel(src = {}, sheet = {}) {
    if (src.sourceType === 'habit') return sheet.sourceCatalog.habits.find((h) => h.id === src.sourceId)?.name || src.sourceId;
    if (src.sourceType === 'counter') return sheet.sourceCatalog.counters.find((h) => h.id === src.sourceId)?.name || src.sourceId;
    if (src.sourceType === 'moduleMetric') return sheet.sourceCatalog.moduleMetrics.find((m) => m.id === src.sourceId)?.label || src.sourceId;
    return 'Manual';
  }

  function renderEntrySourceList(entry, sheet) {
    const rows = (entry.sourceRows || []).map((src) => `
      <article class="rpg-source-card" data-source-id="${src.id || ''}">
        <div class="rpg-source-card-head">
          <span class="rpg-source-type">${escapeHtml(src.sourceType || 'manual')}</span>
          <label class="rpg-source-switch">
            <input type="checkbox" data-toggle-source="${src.id || ''}" ${src.enabled !== false ? 'checked' : ''}/>
            <span>${src.enabled !== false ? 'Activo' : 'Inactivo'}</span>
          </label>
        </div>
        <div><b>${escapeHtml(sourceLabel(src, sheet))}</b></div>
        <small>${escapeHtml(src.unitMode || 'count')} · peso ${fmt(src.weight)} · ${src.sign === 'subtract' ? '−' : '+'} · aporte ${fmt(src.contribution)}</small>
        <div class="rpg-source-card-actions">
          <button class="btn ghost" type="button" data-edit-source="${src.id || ''}">Editar</button>
          <button class="btn ghost danger" type="button" data-delete-source="${src.id || ''}">Eliminar</button>
        </div>
      </article>
    `).join('');
    return rows || '<div class="rpg-empty">Sin fuentes asociadas</div>';
  }

  async function saveEntrySource(entry, payload, sourceId = '') {
    await persistAndRender((next) => {
      if (sourceId) {
        const idx = next.entrySources.findIndex((src) => src.id === sourceId && src.entryId === entry.id);
        if (idx >= 0) next.entrySources[idx] = { ...next.entrySources[idx], ...payload };
        return;
      }
      next.entrySources.push({
        id: `src-${Date.now()}`,
        entryId: entry.id,
        enabled: true,
        ...payload
      });
    });
  }

  async function deleteEntrySource(entry, sourceId = '') {
    if (!sourceId) return;
    await persistAndRender((next) => {
      next.entrySources = next.entrySources.filter((src) => !(src.id === sourceId && src.entryId === entry.id));
    });
  }

  function renderEntrySourceEditorModal(entry, sheet, sourceId = '') {
    const current = (lastConfig.entrySources || []).find((src) => src.id === sourceId && src.entryId === entry.id) || {};
    const sourceType = current.sourceType || 'habit';
    const timeWindow = current.timeWindow === 'monthToDate'
      ? 'monthToDate'
      : current.timeWindow === 'day'
        ? 'day'
        : 'total';
    const habitOptions = sheet.sourceCatalog.habits.map((h) => `<option value="${h.id}" ${h.id === current.sourceId ? 'selected' : ''}>${escapeHtml(h.name || h.id)}</option>`).join('');
    const counterOptions = sheet.sourceCatalog.counters.map((c) => `<option value="${c.id}" ${c.id === current.sourceId ? 'selected' : ''}>${escapeHtml(c.name || c.id)}</option>`).join('');

    openSourceSheet(`
      <div class="rpg-submodal-header">
        <div>
          <h4>${sourceId ? 'Editar fuente' : 'Añadir fuente'}</h4>
          <small>${escapeHtml(entry.icon || '✨')} ${escapeHtml(entry.name || 'Aptitud')}</small>
        </div>
        <button class="icon-btn" type="button" data-close-source-modal="1">✕</button>
      </div>
      <form id="rpg-source-editor-form" class="rpg-modal-form">
        <div class="rpg-form-grid-2">
          <label>Tipo de fuente
            <select name="sourceType">
              <option value="habit" ${sourceType === 'habit' ? 'selected' : ''}>Hábito</option>
              <option value="counter" ${sourceType === 'counter' ? 'selected' : ''}>Contador</option>
              <option value="manual" ${sourceType === 'manual' ? 'selected' : ''}>Manual</option>
              <option value="moduleMetric" ${sourceType === 'moduleMetric' ? 'selected' : ''}>Métrica de módulo</option>
            </select>
          </label>
          <label>Unidad
            <select name="unitMode">
              <option value="minute" ${current.unitMode === 'minute' ? 'selected' : ''}>por minuto</option>
              <option value="hour" ${current.unitMode === 'hour' ? 'selected' : ''}>por hora</option>
              <option value="session" ${current.unitMode === 'session' ? 'selected' : ''}>por sesión</option>
              <option value="count" ${(current.unitMode || 'count') === 'count' ? 'selected' : ''}>por unidad</option>
            </select>
          </label>
          <label>Hábito
            <select name="habitId"><option value="">—</option>${habitOptions}</select>
          </label>
          <label>Contador
            <select name="counterId"><option value="">—</option>${counterOptions}</select>
          </label>
          <label>Módulo
            <select name="moduleMetricId">
              <option value="">—</option>
              <option value="gym:strength" ${current.sourceId === 'gym:strength' ? 'selected' : ''}>Gym · Fuerza</option>
              <option value="world:exploration" ${current.sourceId === 'world:exploration' ? 'selected' : ''}>World · Exploración</option>
              <option value="finance:gold" ${current.sourceId === 'finance:gold' ? 'selected' : ''}>Finance · Oro</option>
            </select>
          </label>
          <label>Rango temporal
            <select name="timeWindow">
              <option value="total" ${timeWindow === 'total' ? 'selected' : ''}>Total</option>
              <option value="day" ${timeWindow === 'day' ? 'selected' : ''}>Hoy (24h)</option>
              <option value="monthToDate" ${timeWindow === 'monthToDate' ? 'selected' : ''}>Mes actual (hasta hoy)</option>
            </select>
          </label>
          <label>Peso<input type="number" step="0.1" name="weight" value="${Number(current.weight ?? 1)}" /></label>
          <label>Signo
            <select name="sign">
              <option value="add" ${(current.sign || 'add') === 'add' ? 'selected' : ''}>Suma</option>
              <option value="subtract" ${current.sign === 'subtract' ? 'selected' : ''}>Resta</option>
            </select>
          </label>
          <label>Valor manual<input type="number" step="0.1" name="manualValue" value="${Number(current.manualValue || 0)}" /></label>
        </div>
        <div class="rpg-modal-footer-actions">
          <button class="btn ghost" type="button" data-close-source-modal="1">Cancelar</button>
          <button class="btn primary" type="submit">${sourceId ? 'Guardar fuente' : 'Añadir fuente'}</button>
        </div>
      </form>
    `, (root) => {
      root.querySelector('#rpg-source-editor-form')?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const selectedType = String(fd.get('sourceType') || 'habit');
        const selectedSourceId = selectedType === 'habit'
          ? String(fd.get('habitId') || '').trim()
          : selectedType === 'counter'
            ? String(fd.get('counterId') || '').trim()
            : selectedType === 'moduleMetric'
              ? String(fd.get('moduleMetricId') || '').trim()
              : `manual-${Date.now()}`;
        if (!selectedSourceId) return;

        await saveEntrySource(entry, {
          sourceType: selectedType,
          sourceId: selectedSourceId,
          unitMode: String(fd.get('unitMode') || 'minute'),
          timeWindow: String(fd.get('timeWindow') || 'total'),
          weight: Number(fd.get('weight') || 1),
          sign: String(fd.get('sign') || 'add'),
          manualValue: Number(fd.get('manualValue') || 0),
          enabled: true
        }, sourceId);
        closeSourceEditorModal();
        const refreshed = buildCharacterSheet(lastSnapshot, { ...lastConfig, financeScope: selectedScope }, selectedRange);
        const freshEntry = refreshed.entries.find((row) => row.id === entry.id);
        if (freshEntry) renderCharacterEntryDetailModal(freshEntry, refreshed);
      });
    });
  }

  function openEntrySourceEditorModal(entry, sheet, sourceId = '') {
    renderEntrySourceEditorModal(entry, sheet, sourceId);
  }

  function renderRank(entry) {
    const rp = entry.rankProgress || { enabled: false };
    if (!rp.enabled) return '<div class="rpg-rank rpg-rank-off">Sin rango</div>';
    return `<div class="rpg-rank"><span>Rango ${rp.rank}</span><span>${fmt(rp.current)}/${fmt(rp.required)}</span></div><div class="rpg-progress"><i style="width:${Math.round(rp.progress * 100)}%"></i></div>`;
  }

  function entryDetailExtraFields(entry) {
    if (String(entry.name || '').toLowerCase() !== 'popularidad') return '';
    const extra = entry.extraFields || {};
    return `
      <label>Seguidores<input type="number" name="followers" value="${Number(extra.followers || 0)}" /></label>
      <label>Visitas<input type="number" name="views" value="${Number(extra.views || 0)}" /></label>`;
  }

  function renderCharacterEntryDetailModal(entry, sheet) {
    const moduleData = entry.moduleData || {};
    const extraInfo = entry.id === 'module-strength'
      ? `<p><b>Gym real:</b> ${fmt(moduleData.workoutSessions)} sesiones fuerza · ${fmt(moduleData.cardioSessions)} cardio · ${fmt(moduleData.workoutMinutes)} min · volumen ${fmt(moduleData.volume)} kg</p>`
      : entry.id === 'module-exploration'
        ? `<p><b>World real:</b> ${fmt(moduleData.countries)} países · ${fmt(moduleData.cities)} ciudades · ${fmt(moduleData.places || 0)} lugares · ${fmt(moduleData.visits)} visitas</p>`
        : '';

    openSheet(`
      <div class="rpg-detail-header rpg-detail-header-new">
        <div class="rpg-detail-title">
          <span class="rpg-detail-icon rpg-detail-icon-big">${entry.icon || statIcon(entry.type, entry.name)}</span>
          <div>
            <h3>${escapeHtml(entry.name || 'Entrada')}</h3>
            <small>${escapeHtml(entry.description || 'Sin descripción')}</small>
          </div>
        </div>
        <button class="icon-btn" type="button" data-close-modal="1">✕</button>
      </div>

      <div class="rpg-detail-kpi rpg-detail-kpi-new">
        <div><small>Valor actual</small><strong>${entry.name === 'Oro' ? money(entry.value) : fmt(entry.value)}</strong></div>
        <div><small>Rango actual</small><strong>${entry.rankProgress?.enabled ? `R${entry.rankProgress.rank}` : 'Sin rango'}</strong></div>
      </div>
      <div class="rpg-detail-progress">${renderRank(entry)}</div>
      ${extraInfo}

      <form id="rpg-entry-form" class="rpg-entry-form-layout ${entry.type === 'moduleDerived' ? 'is-derived' : ''}">
        <section class="rpg-detail-column">
          <label>Nombre<input name="name" value="${escapeHtml(entry.name || '')}" required ${entry.type === 'moduleDerived' ? 'disabled' : ''} /></label>
          <label>Icono<input name="icon" value="${escapeHtml(entry.icon || '')}" ${entry.type === 'moduleDerived' ? 'disabled' : ''} /></label>
          <label>Descripción<textarea name="description" ${entry.type === 'moduleDerived' ? 'disabled' : ''}>${escapeHtml(entry.description || '')}</textarea></label>
          <label>Valor manual<input type="number" step="0.1" name="manualValue" value="${entry.manualValue || 0}" ${entry.type === 'moduleDerived' ? 'disabled' : ''} /></label>
          ${entry.type === 'language' ? `<label>Nivel manual<input name="manualLevel" value="${escapeHtml(entry.manualLevel || '')}" placeholder="A1, B2, C1..." /></label>` : ''}
          ${entryDetailExtraFields(entry)}
        </section>

        <section class="rpg-detail-column">
          <label><input type="checkbox" name="rankEnabled" ${entry.rankProgress?.enabled ? 'checked' : ''} ${entry.type === 'moduleDerived' ? 'disabled' : ''}/> Usar sistema de rangos</label>
          <label>Puntos base por rango<input type="number" step="1" name="rankBase" value="${entry.rankConfig?.basePoints || 120}" ${entry.type === 'moduleDerived' ? 'disabled' : ''}/></label>
          <label>Crecimiento por rango<input type="number" step="1" name="rankGrowth" value="${entry.rankConfig?.growth || 8}" ${entry.type === 'moduleDerived' ? 'disabled' : ''}/></label>
          <div class="rpg-rank-preview">${renderRank(entry)}</div>
        </section>
      </form>

      ${entry.type === 'moduleDerived' ? '' : `
      <section class="rpg-source-section">
        <div class="rpg-source-section-head">
          <h4>Fuentes asociadas</h4>
          <div class="rpg-source-section-actions">
            <button class="btn ghost" type="button" data-manage-sources="1">Gestionar fuentes</button>
            <button class="btn" type="button" data-add-source="1">Añadir fuente</button>
          </div>
        </div>
        <div class="rpg-source-list">${renderEntrySourceList(entry, sheet)}</div>
      </section>`}

      <div class="rpg-modal-footer-actions">
        ${entry.type === 'moduleDerived' ? '' : '<button class="btn primary" type="button" id="rpg-entry-save">Guardar cambios</button>'}
        ${entry.type === 'moduleDerived' ? '' : '<button class="btn ghost danger" type="button" id="rpg-entry-delete">Eliminar aptitud</button>'}
        <button class="btn ghost" type="button" data-close-modal="1">Cancelar</button>
      </div>
    `, (root) => {
      root.querySelector('#rpg-entry-save')?.addEventListener('click', async () => {
        const form = root.querySelector('#rpg-entry-form');
        const fd = new FormData(form);
        await persistAndRender((next) => {
          const row = next.characterEntries.find((r) => r.id === entry.id);
          if (!row) return;
          row.name = String(fd.get('name') || '').trim();
          row.icon = String(fd.get('icon') || '').trim() || row.icon;
          row.description = String(fd.get('description') || '').trim();
          row.manualValue = Number(fd.get('manualValue') || 0);
          row.manualLevel = String(fd.get('manualLevel') || '').trim();
          row.rankConfig = {
            enabled: fd.get('rankEnabled') === 'on',
            basePoints: Number(fd.get('rankBase') || 120),
            growth: Number(fd.get('rankGrowth') || 8)
          };
          if (String(entry.name || '').toLowerCase() === 'popularidad') {
            row.extraFields = {
              ...(row.extraFields || {}),
              followers: Number(fd.get('followers') || 0),
              views: Number(fd.get('views') || 0)
            };
          }
        });
        closeModal();
      });

      root.querySelector('#rpg-entry-delete')?.addEventListener('click', async () => {
        await persistAndRender((next) => {
          next.characterEntries = next.characterEntries.filter((row) => row.id !== entry.id);
          next.entrySources = next.entrySources.filter((src) => src.entryId !== entry.id);
        });
        closeModal();
      });

      root.querySelector('[data-manage-sources]')?.addEventListener('click', () => openEntrySourceEditorModal(entry, sheet));
      root.querySelector('[data-add-source]')?.addEventListener('click', () => openEntrySourceEditorModal(entry, sheet));

      root.querySelectorAll('[data-edit-source]').forEach((node) => node.addEventListener('click', () => {
        openEntrySourceEditorModal(entry, sheet, node.dataset.editSource || '');
      }));

      root.querySelectorAll('[data-delete-source]').forEach((node) => node.addEventListener('click', async () => {
        await deleteEntrySource(entry, node.dataset.deleteSource || '');
        const refreshed = buildCharacterSheet(lastSnapshot, { ...lastConfig, financeScope: selectedScope }, selectedRange);
        const freshEntry = refreshed.entries.find((row) => row.id === entry.id);
        if (freshEntry) renderCharacterEntryDetailModal(freshEntry, refreshed);
      }));

      root.querySelectorAll('[data-toggle-source]').forEach((node) => node.addEventListener('change', async () => {
        const sourceId = node.dataset.toggleSource;
        await persistAndRender((next) => {
          const src = next.entrySources.find((row) => row.id === sourceId && row.entryId === entry.id);
          if (src) src.enabled = !!node.checked;
        });
        const refreshed = buildCharacterSheet(lastSnapshot, { ...lastConfig, financeScope: selectedScope }, selectedRange);
        const freshEntry = refreshed.entries.find((row) => row.id === entry.id);
        if (freshEntry) renderCharacterEntryDetailModal(freshEntry, refreshed);
      }));
    });
  }

  function renderHero(sheet) {
    const id = sheet.identity;
    const level = id.hasBirthdate ? `Nivel ${id.level}` : 'Nivel pendiente';
    const nameLabel = id.alias ? `${id.name} · ${id.alias}` : id.name;
    const headerFinance = sheet.headerFinance || { gold: 0, dayDelta: 0, monthDelta: 0 };
    const financeCache = readFinanceTotalsCache();
    const cachedGold = selectedScope === 'total' ? Number(financeCache?.totalReal) : Number(financeCache?.myTotal);
    if (selectedScope !== 'total') {
      const node = document.getElementById('finance-totalValue');
      const fromDom = parseEurCurrencyText(node?.textContent || '');
      if (Number.isFinite(fromDom)) headerFinance.gold = fromDom;
      else if (Number.isFinite(cachedGold)) headerFinance.gold = cachedGold;
    } else if (Number.isFinite(cachedGold)) {
      headerFinance.gold = cachedGold;
    }
    const powerLevel = Number(sheet.powerLevel || 0);
    const health = sheet.health || { value: 0, max: 100, progress: 0, todayDelta: 0 };
    const stamina = sheet.stamina || { value: 0, max: 100, progress: 0, todayDelta: 0 };
    const games = sheet.gamesSummary || { wins: 0, losses: 0, kills: 0, deaths: 0 };

    const staminaMaxUi = 1000;
    const staminaValue = Math.max(0, Number(stamina.value || 0));
    const staminaDelta = Number(stamina.todayDelta || 0);
    const staminaProgressUi = Math.max(0, Math.min(1, staminaValue / staminaMaxUi));
    const staminaOvercharged = staminaValue > staminaMaxUi;
    const staminaSpent = staminaDelta < 0 ? Math.abs(staminaDelta) : 0;
    const staminaBeforeSpend = staminaSpent > 0 ? staminaValue + staminaSpent : staminaValue;
    const staminaDeltaLabel = staminaSpent > 0
      ? `-${fmt(staminaSpent)} pts (${fmt(staminaBeforeSpend)} â†’ ${fmt(staminaValue)})`
      : formatPointsDelta(staminaDelta);
    const staminaDeltaLabelUi = staminaSpent > 0
      ? `-${fmt(staminaSpent)} pts (${fmt(staminaBeforeSpend)} -> ${fmt(staminaValue)})`
      : formatPointsDelta(staminaDelta);

    const topBadges = (sheet.entries || [])
      .filter((entry) => entry.type !== 'language' && entry.id !== 'module-gold' && !['salud', 'estamina'].includes(String(entry.name || '').toLowerCase()))
      .sort((a, b) => (b.rankProgress?.rank || 0) - (a.rankProgress?.rank || 0))
      .slice(0, 6)
      .map((entry) => `<span class="rpg-mini-badge">${entry.icon || statIcon(entry.type, entry.name)} R${entry.rankProgress?.rank || 1}</span>`)
      .join('');

    $hero.innerHTML = `
      <div class="rpg-hero-actions">
        <button type="button" class="rpg-hero-identity" id="rpg-open-identity">✏️ Editar</button>
        <button type="button" class="rpg-add-btn" id="rpg-open-add">+ Añadir</button>
      </div>
      <div class="rpg-hero-gold-corner">
        <div class="rpg-gold-main">💰 ${money(headerFinance.gold)}</div>
        <small>Hoy <span class="${headerFinance.dayDelta >= 0 ? 'is-up' : 'is-down'}">${formatCurrencyDelta(headerFinance.dayDelta)}</span></small>
        <small>Mes <span class="${headerFinance.monthDelta >= 0 ? 'is-up' : 'is-down'}">${formatCurrencyDelta(headerFinance.monthDelta)}</span></small>
      </div>
      <div class="rpg-hero-main">
        <div class="rpg-hero-name">${escapeHtml(nameLabel)}</div>
        <div class="rpg-hero-levels">
          <span>${level}</span>
          <span>Poder total ${fmt(powerLevel)}</span>
        </div>
      </div>
      <div class="rpg-health-block">
        <div class="rpg-health-head"><span>❤️ Salud</span><b>${fmt(health.value)} / ${fmt(health.max)}</b><small class="${health.todayDelta >= 0 ? 'is-up' : 'is-down'}">${formatPointsDelta(health.todayDelta)}</small></div>
        <div class="rpg-health-bar"><i style="width:${Math.round((health.progress || 0) * 100)}%"></i></div>
      </div>
      <div class="rpg-health-block rpg-stamina-block ${staminaOvercharged ? 'is-overcharged' : ''}">
        <div class="rpg-health-head"><span>⚡ Estamina</span><b>${fmt(stamina.value)} / ${fmt(stamina.max)}</b><small class="${stamina.todayDelta >= 0 ? 'is-up' : 'is-down'}">${formatPointsDelta(stamina.todayDelta)}</small></div>
        <div class="rpg-health-bar rpg-stamina-bar"><i style="width:${Math.round((stamina.progress || 0) * 100)}%"></i></div>
      </div>
      <div class="rpg-hero-summary-grid">
        <div class="rpg-mini-summary"><span>🏆 Victorias</span><b>${fmt(games.wins)}</b></div>
        <div class="rpg-mini-summary"><span>💀 Derrotas</span><b>${fmt(games.losses)}</b></div>
        <div class="rpg-mini-summary"><span>🎯 Kills</span><b>${fmt(games.kills)}</b></div>
        <div class="rpg-mini-summary"><span>☠️ Deaths</span><b>${fmt(games.deaths)}</b></div>
      </div>
      <div class="rpg-hero-badges">${topBadges || '<span class="rpg-mini-badge">Añade aptitudes para ver rangos</span>'}</div>`;

    const $staminaBlock = $hero.querySelector('.rpg-stamina-block');
    if ($staminaBlock) {
      $staminaBlock.classList.toggle('is-overcharged', staminaOvercharged);
      const $staminaHead = $staminaBlock.querySelector('.rpg-health-head');
      const $staminaValueNode = $staminaHead?.querySelector('b');
      if ($staminaValueNode) $staminaValueNode.textContent = `${fmt(staminaValue)} / ${fmt(staminaMaxUi)}`;

      const $deltaNode = $staminaHead?.querySelector('small');
      if ($deltaNode) {
        $deltaNode.classList.toggle('is-up', staminaDelta >= 0);
        $deltaNode.classList.toggle('is-down', staminaDelta < 0);
        $deltaNode.textContent = staminaDeltaLabelUi;
      }

      const $bar = $staminaBlock.querySelector('.rpg-stamina-bar');
      if ($bar) {
        $bar.classList.toggle('is-overcharged', staminaOvercharged);
        const $fill = $bar.querySelector('i');
        if ($fill) $fill.style.width = `${Math.round(staminaProgressUi * 100)}%`;
      }
    }

    $hero.querySelector('#rpg-open-identity')?.addEventListener('click', () => {
      const identity = sheet.identity;
      openSheet(`
        <div class="rpg-modal-only-head"><h3>Identidad del personaje</h3><button class="icon-btn" type="button" data-close-modal="1">✕</button></div>
        <form id="rpg-identity-form" class="rpg-modal-form">
          <label>Nombre<input name="name" value="${escapeHtml(identity.name || '')}" required /></label>
          <label>Alias opcional<input name="alias" value="${escapeHtml(identity.alias || '')}" /></label>
          <label>Fecha de nacimiento<input type="date" name="birthdate" value="${identity.birthdate || ''}" /></label>
          <button class="btn primary" type="submit">Guardar</button>
        </form>
      `, (root) => {
        root.querySelector('#rpg-identity-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          await persistAndRender((next) => {
            next.characterIdentity.name = String(fd.get('name') || '').trim();
            next.characterIdentity.alias = String(fd.get('alias') || '').trim();
            next.characterIdentity.birthdate = String(fd.get('birthdate') || '').trim();
          });
          closeModal();
        });
      });
    });

    $hero.querySelector('#rpg-open-add')?.addEventListener('click', () => {
      openSheet(`
        <div class="rpg-modal-only-head"><h3>Añadir entrada</h3><button class="icon-btn" type="button" data-close-modal="1">✕</button></div>
        <div class="rpg-modal-actions">
          <button class="btn" data-add-type="attribute">Añadir aptitud</button>
          <button class="btn" data-add-type="language">Añadir idioma</button>
          <button class="btn" data-add-type="skill">Añadir habilidad/CV</button>
          <button class="btn" data-add-type="popularidad">Añadir Popularidad</button>
          <button class="btn" data-add-type="health">Añadir/activar Salud</button>
          <button class="btn" data-add-type="stamina">Añadir/activar Estamina</button>
          <button class="btn" data-close-modal="1">Cancelar</button>
        </div>
      `, (root) => {
        root.querySelectorAll('[data-add-type]').forEach((btn) => btn.addEventListener('click', async () => {
          const type = btn.dataset.addType;
          const defaults = type === 'popularidad'
            ? { type: 'attribute', name: 'Popularidad', icon: '📣', description: 'Seguidores y visitas manuales.', sourceMode: 'manual', manualValue: 0, extraFields: { followers: 0, views: 0 }, rankConfig: { enabled: true, basePoints: 200, growth: 20 } }
            : type === 'health'
              ? { id: 'entry-health', type: 'attribute', name: 'Salud', icon: '❤️', description: 'Estado de salud asociado a hábitos sanos/insanos.', sourceMode: 'manual', manualValue: 70, rankConfig: { enabled: false, basePoints: 100, growth: 5 } }
              : type === 'stamina'
                ? { id: 'entry-stamina', type: 'attribute', name: 'Estamina', icon: '⚡', description: 'Estado de energía diaria asociado a hábitos de descanso/activación.', sourceMode: 'manual', manualValue: 0, rankConfig: { enabled: false, basePoints: 100, growth: 5 } }
                : defaultEntryByType(type);
          await persistAndRender((next) => {
            if (type === 'health' || type === 'stamina') {
              const wanted = type === 'health' ? 'entry-health' : 'entry-stamina';
              const wantedName = type === 'health' ? 'salud' : 'estamina';
              const existing = next.characterEntries.find((x) => x.id === wanted || String(x.name || '').toLowerCase() === wantedName);
              if (existing) {
                existing.visible = true;
                return;
              }
            }
            const idBase = slug(defaults.name || type) || type;
            const id = defaults.id || `${idBase}-${Date.now()}`;
            next.characterEntries.push({
              id,
              ...defaults,
              name: defaults.name || (type === 'language' ? 'Nuevo idioma' : type === 'skill' ? 'Nueva habilidad' : 'Nueva aptitud'),
              visible: true,
              order: next.characterEntries.length + 1
            });
          });
          closeModal();
        }));
      });
    });
  }

  function renderStats(sheet) {
    $stats.innerHTML = sheet.entries.map((entry) => `
      <article class="rpg-stat" data-entry="${entry.id}">
        <button type="button" class="rpg-stat-open" data-entry-open="${entry.id}">${entry.icon || statIcon(entry.type, entry.name)} ${escapeHtml(entry.name)}</button>
        <div class="rpg-stat-head"><span>${entry.type === 'language' ? 'Nivel' : 'Valor total'}</span><strong>${entry.type === 'language' ? (entry.manualLevel || '—') : fmt(entry.value)}</strong></div>
        ${renderRank(entry)}
        <small>${escapeHtml(entry.description || 'Sin descripción')}</small>
      </article>
    `).join('');

    $stats.querySelectorAll('[data-entry-open]').forEach((btn) => btn.addEventListener('click', () => {
      const entry = sheet.entries.find((row) => row.id === btn.dataset.entryOpen);
      if (!entry) return;
      renderCharacterEntryDetailModal(entry, sheet);
    }));
  }

  function renderResources(sheet) {
    const scopeLabel = selectedScope === 'total' ? 'Total' : 'Mi parte';
    $resources.innerHTML = `
      <div class="rpg-resource rpg-resource-money">
        <div class="rpg-resource-header">
          <span>💰 Recursos reales · ${scopeLabel}</span>
          <div class="rpg-resource-controls">
            <div class="rpg-scope-toggle">
              <button type="button" class="rpg-range-btn ${selectedScope === 'my' ? 'active' : ''}" data-scope="my">Mi parte</button>
              <button type="button" class="rpg-range-btn ${selectedScope === 'total' ? 'active' : ''}" data-scope="total">Total</button>
            </div>
            ${renderRangeSelector(selectedRange)}
          </div>
        </div>
        <div class="rpg-resource-grid">
          <div><small>Balance</small><strong>${money(sheet.resources.gold)}</strong></div>
          <div><small>Ingresos</small><strong>${money(sheet.resources.income)}</strong></div>
          <div><small>Gastos</small><strong>${money(sheet.resources.expense)}</strong></div>
          <div><small>Delta neto</small><strong class="${sheet.resources.delta >= 0 ? 'is-up' : 'is-down'}">${formatCurrencyDelta(sheet.resources.delta)}</strong></div>
        </div>
      </div>`;

    $resources.querySelectorAll('[data-range]').forEach((btn) => btn.addEventListener('click', async () => {
      selectedRange = btn.dataset.range;
      await render();
    }));
    $resources.querySelectorAll('[data-scope]').forEach((btn) => btn.addEventListener('click', async () => {
      selectedScope = btn.dataset.scope === 'total' ? 'total' : 'my';
      await render();
    }));
  }

  function renderPanels(sheet) {
    $delta.innerHTML = '<div class="rpg-delta-item">✅ Layout limpio: modal principal + submodal de fuentes + una única superficie de scroll por vista.</div>';
    $ranking.innerHTML = `
      <div><b>Exploración real:</b> ${fmt(sheet.world.countries)} países · ${fmt(sheet.world.cities)} ciudades · ${fmt(sheet.world.places || 0)} lugares · ${fmt(sheet.world.visits)} visitas.</div>
      <div><b>Games:</b> ${fmt(sheet.gamesSummary?.wins)}W · ${fmt(sheet.gamesSummary?.losses)}L · ${fmt(sheet.gamesSummary?.kills)}K · ${fmt(sheet.gamesSummary?.deaths)}D</div>
      <div><b>Entradas visibles:</b> ${sheet.entries.length}</div>`;

    const languages = sheet.entries.filter((entry) => entry.type === 'language');
    const skills = sheet.entries.filter((entry) => entry.type === 'skill' || entry.type === 'attribute');
    $activity.innerHTML = `
      <div class="rpg-section-title">Aptitudes / Habilidades / CV</div>
      <ul>${skills.map((entry) => `<li>${entry.icon || '✨'} <b>${escapeHtml(entry.name)}</b> · ${fmt(entry.value)} ${entry.rankProgress?.enabled ? `· R${entry.rankProgress.rank}` : ''}</li>`).join('') || '<li>Sin entradas manuales todavía</li>'}</ul>
      <div class="rpg-section-title">Idiomas</div>
      <ul>${languages.map((entry) => `<li>${entry.icon || '🗣️'} <b>${escapeHtml(entry.name)}</b> · ${escapeHtml(entry.manualLevel || 'sin nivel')} · ${fmt(entry.value)}xp</li>`).join('') || '<li>Sin idiomas manuales todavía</li>'}</ul>`;

    $formulas.innerHTML = '<ul><li>Valor final = valor manual + suma/resta de fuentes configuradas por peso.</li><li>Salud y Estamina calculan delta diario por fuentes del día.</li><li>Resumen de Games agrega victorias, derrotas, kills y deaths reales.</li></ul>';
    $activity.innerHTML = $activity.innerHTML.replaceAll('xp</li>', 'h</li>');
    $config.innerHTML = '';
  }

  async function loadProfile() {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    const snap = await get(ref(db, `v2/users/${uid}`));
    lastSnapshot = snap.val() || {};
    try {
      lastConfig = await getCharacterConfig(uid);
    } catch (_) {
      lastConfig = (await cache.getItem(uid)) || { characterIdentity: {}, characterEntries: [], entrySources: [] };
      showWarning('Usando configuración local temporal por fallo de persistencia.');
    }
    return buildCharacterSheet(lastSnapshot, { ...lastConfig, financeScope: selectedScope }, selectedRange);
  }

  async function render() {
    try {
      const profile = await loadProfile();
      if (!profile) return;
      renderHero(profile);
      renderStats(profile);
      renderResources(profile);
      renderPanels(profile);
    } catch (err) {
      console.error('[dashboard-rpg] render failed', err);
    }
  }

  window.__bookshellDashboard = { render, buildCharacterSheet, getCharacterConfig, saveCharacterConfig };
  render();
}

export async function onShow() {
  try {
    await window.__bookshellDashboard?.render?.();
  } catch (_) {}
}
