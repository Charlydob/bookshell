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
  const signed = (n) => `${Number(n || 0) >= 0 ? '+' : '-'}${money(Math.abs(Number(n || 0)))}`;

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
    modal.innerHTML = '<div class="rpg-sheet-card"><button class="icon-btn rpg-sheet-close" type="button">✕</button><div id="rpg-sheet-content"></div></div>';
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.closest('.rpg-sheet-close')) modal.classList.add('hidden');
    });
    document.body.appendChild(modal);
    return modal;
  }

  function closeModal() {
    ensureSheetModal().classList.add('hidden');
  }

  function openSheet(html, onBind) {
    const modal = ensureSheetModal();
    modal.querySelector('#rpg-sheet-content').innerHTML = html;
    modal.classList.remove('hidden');
    if (typeof onBind === 'function') onBind(modal.querySelector('#rpg-sheet-content'));
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

  function renderHero(sheet) {
    const id = sheet.identity;
    const level = id.hasBirthdate ? `Nivel ${id.level}` : 'Nivel pendiente';
    const nameLabel = id.alias ? `${id.name} · ${id.alias}` : id.name;
    const headerFinance = sheet.headerFinance || { gold: 0, dayDelta: 0, monthDelta: 0 };
    $hero.innerHTML = `
      <div class="rpg-hero-top">
        <button type="button" class="rpg-hero-identity" id="rpg-open-identity">🧾 ${nameLabel}</button>
        <button type="button" class="rpg-add-btn" id="rpg-open-add">+ Añadir</button>
      </div>
      <div class="rpg-hero-meta">${level}</div>
      <div class="rpg-hero-money">
        <div class="rpg-money-main">
          <small>Oro total</small>
          <strong>${money(headerFinance.gold)}</strong>
        </div>
        <div class="rpg-money-deltas">
          <div><small>Hoy</small><span class="${headerFinance.dayDelta >= 0 ? 'is-up' : 'is-down'}">${signed(headerFinance.dayDelta)}</span></div>
          <div><small>Mes actual</small><span class="${headerFinance.monthDelta >= 0 ? 'is-up' : 'is-down'}">${signed(headerFinance.monthDelta)}</span></div>
        </div>
      </div>`;

    $hero.querySelector('#rpg-open-identity')?.addEventListener('click', () => {
      const identity = sheet.identity;
      openSheet(`
        <h3>CharacterIdentityModal</h3>
        <form id="rpg-identity-form" class="rpg-modal-form">
          <label>Nombre<input name="name" value="${identity.name || ''}" required /></label>
          <label>Alias opcional<input name="alias" value="${identity.alias || ''}" /></label>
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
        <h3>CharacterAddEntryModal</h3>
        <div class="rpg-modal-actions">
          <button class="btn" data-add-type="attribute">Añadir aptitud</button>
          <button class="btn" data-add-type="language">Añadir idioma</button>
          <button class="btn" data-add-type="skill">Añadir habilidad/CV</button>
          <button class="btn" data-add-type="popularidad">Añadir Popularidad</button>
          <button class="btn" data-close-modal="1">Cancelar</button>
        </div>
      `, (root) => {
        root.querySelectorAll('[data-add-type]').forEach((btn) => btn.addEventListener('click', async () => {
          const type = btn.dataset.addType;
          const defaults = type === 'popularidad'
            ? { type: 'attribute', name: 'Popularidad', icon: '📣', description: 'Seguidores y visitas manuales.', sourceMode: 'manual', manualValue: 0, extraFields: { followers: 0, views: 0 }, rankConfig: { enabled: true, basePoints: 200, growth: 20 } }
            : defaultEntryByType(type);
          await persistAndRender((next) => {
            const idBase = slug(defaults.name || type) || type;
            const id = `${idBase}-${Date.now()}`;
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
        root.querySelector('[data-close-modal]')?.addEventListener('click', closeModal);
      });
    });
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

  function renderStats(sheet) {
    $stats.innerHTML = sheet.entries.map((entry) => `
      <article class="rpg-stat" data-entry="${entry.id}">
        <button type="button" class="rpg-stat-open" data-entry-open="${entry.id}">${entry.icon || statIcon(entry.type, entry.name)} ${entry.name}</button>
        <div class="rpg-stat-head"><span>${entry.type === 'language' ? 'Nivel' : 'Valor total'}</span><strong>${entry.type === 'language' ? (entry.manualLevel || '—') : fmt(entry.value)}</strong></div>
        ${renderRank(entry)}
        <small>${entry.description || 'Sin descripción'}</small>
      </article>
    `).join('');

    $stats.querySelectorAll('[data-entry-open]').forEach((btn) => btn.addEventListener('click', () => {
      const entry = sheet.entries.find((row) => row.id === btn.dataset.entryOpen);
      if (!entry) return;
      const habitOptions = sheet.sourceCatalog.habits.map((h) => `<option value="${h.id}">${h.name || h.id}</option>`).join('');
      const counterOptions = sheet.sourceCatalog.counters.map((c) => `<option value="${c.id}">${c.name || c.id}</option>`).join('');
      const sourceRows = entry.sourceRows?.map((src) => `<li>${src.sourceType}:${src.sourceId} · ${src.sign === 'subtract' ? '-' : '+'}${fmt(src.weight)} · ${src.unitMode || 'count'} · aporte ${fmt(src.contribution)}</li>`).join('') || '<li>Sin fuentes asociadas</li>';
      const moduleData = entry.moduleData || {};
      const extraInfo = entry.id === 'module-strength'
        ? `<p><b>Gym real:</b> ${fmt(moduleData.workoutSessions)} sesiones fuerza · ${fmt(moduleData.cardioSessions)} cardio · ${fmt(moduleData.workoutMinutes)} min · volumen ${fmt(moduleData.volume)} kg</p>`
        : entry.id === 'module-exploration'
          ? `<p><b>World real:</b> ${fmt(moduleData.countries)} países · ${fmt(moduleData.cities)} ciudades · ${fmt(moduleData.places || 0)} lugares · ${fmt(moduleData.visits)} visitas</p>`
          : '';

      openSheet(`
        <h3>CharacterEntryDetailModal(${entry.name})</h3>
        <p><b>Valor actual:</b> ${entry.name === 'Oro' ? money(entry.value) : fmt(entry.value)}</p>
        ${extraInfo}
        <form id="rpg-entry-form" class="rpg-modal-form">
          <label>Nombre<input name="name" value="${entry.name || ''}" required ${entry.type === 'moduleDerived' ? 'disabled' : ''} /></label>
          <label>Icono<input name="icon" value="${entry.icon || ''}" ${entry.type === 'moduleDerived' ? 'disabled' : ''} /></label>
          <label>Descripción<textarea name="description" ${entry.type === 'moduleDerived' ? 'disabled' : ''}>${entry.description || ''}</textarea></label>
          <label>Valor manual<input type="number" step="0.1" name="manualValue" value="${entry.manualValue || 0}" ${entry.type === 'moduleDerived' ? 'disabled' : ''} /></label>
          ${entry.type === 'language' ? `<label>Nivel manual<input name="manualLevel" value="${entry.manualLevel || ''}" placeholder="A1, B2, C1..." /></label>` : ''}
          ${entryDetailExtraFields(entry)}
          <label><input type="checkbox" name="rankEnabled" ${entry.rankProgress?.enabled ? 'checked' : ''} ${entry.type === 'moduleDerived' ? 'disabled' : ''}/> Usar sistema de rangos</label>
          <label>Puntos base por rango<input type="number" step="1" name="rankBase" value="${entry.rankConfig?.basePoints || 120}" ${entry.type === 'moduleDerived' ? 'disabled' : ''}/></label>
          <label>Crecimiento por rango<input type="number" step="1" name="rankGrowth" value="${entry.rankConfig?.growth || 8}" ${entry.type === 'moduleDerived' ? 'disabled' : ''}/></label>
          ${entry.type === 'moduleDerived' ? '' : '<button class="btn primary" type="submit">Guardar cambios</button>'}
          ${entry.type === 'moduleDerived' ? '' : '<button class="btn danger" type="button" id="rpg-entry-delete">Eliminar</button>'}
        </form>
        ${entry.type === 'moduleDerived' ? '' : `<hr/>
        <h4>Fuentes asociadas</h4>
        <ul>${sourceRows}</ul>
        <form id="rpg-source-form" class="rpg-modal-form">
          <label>Tipo de fuente
            <select name="sourceType">
              <option value="habit">Hábito</option>
              <option value="counter">Contador</option>
              <option value="manual">Manual</option>
              <option value="moduleMetric">Métrica de módulo</option>
            </select>
          </label>
          <label>Hábito<select name="habitId"><option value="">—</option>${habitOptions}</select></label>
          <label>Contador<select name="counterId"><option value="">—</option>${counterOptions}</select></label>
          <label>Módulo<select name="moduleMetricId"><option value="">—</option><option value="gym:strength">Gym · Fuerza</option><option value="world:exploration">World · Exploración</option><option value="finance:gold">Finance · Oro</option></select></label>
          <label>Unidad
            <select name="unitMode">
              <option value="minute">por minuto</option>
              <option value="hour">por hora</option>
              <option value="session">por sesión</option>
              <option value="count">por unidad</option>
            </select>
          </label>
          <label>Peso<input type="number" step="0.1" name="weight" value="1" /></label>
          <label>Signo
            <select name="sign">
              <option value="add">Suma</option>
              <option value="subtract">Resta</option>
            </select>
          </label>
          <label>Valor manual fuente<input type="number" step="0.1" name="manualSourceValue" value="0" /></label>
          <button class="btn" type="submit">Añadir fuente</button>
        </form>`}
      `, (root) => {
        root.querySelector('#rpg-entry-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
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

        root.querySelector('#rpg-source-form')?.addEventListener('submit', async (e) => {
          e.preventDefault();
          const fd = new FormData(e.target);
          const sourceType = String(fd.get('sourceType') || 'habit');
          const sourceId = sourceType === 'habit'
            ? String(fd.get('habitId') || '').trim()
            : sourceType === 'counter'
              ? String(fd.get('counterId') || '').trim()
              : sourceType === 'moduleMetric'
                ? String(fd.get('moduleMetricId') || '').trim()
                : `manual-${Date.now()}`;
          if (!sourceId) return;
          await persistAndRender((next) => {
            next.entrySources.push({
              id: `src-${Date.now()}`,
              entryId: entry.id,
              sourceType,
              sourceId,
              unitMode: String(fd.get('unitMode') || 'minute'),
              weight: Number(fd.get('weight') || 1),
              sign: String(fd.get('sign') || 'add'),
              enabled: true,
              manualValue: Number(fd.get('manualSourceValue') || 0)
            });
          });
          closeModal();
        });
      });
    }));
  }

  function renderResources(sheet) {
    $resources.innerHTML = `
      <div class="rpg-resource rpg-resource-money">
        <div class="rpg-resource-header">
          <span>💰 Dinero / Finance</span>
          ${renderRangeSelector(selectedRange)}
        </div>
        <div class="rpg-resource-grid">
          <div><small>Balance</small><strong>${money(sheet.resources.gold)}</strong></div>
          <div><small>Ingresos</small><strong>${money(sheet.resources.income)}</strong></div>
          <div><small>Gastos</small><strong>${money(sheet.resources.expense)}</strong></div>
          <div><small>Delta neto</small><strong class="${sheet.resources.delta >= 0 ? 'is-up' : 'is-down'}">${signed(sheet.resources.delta)}</strong></div>
        </div>
      </div>`;

    $resources.querySelectorAll('[data-range]').forEach((btn) => btn.addEventListener('click', async () => {
      selectedRange = btn.dataset.range;
      await render();
    }));
  }

  function renderPanels(sheet) {
    $delta.innerHTML = '<div class="rpg-delta-item">✅ Identidad + oro arriba, detalle financiero abajo y rangos por entrada.</div>';
    $ranking.innerHTML = `
      <div><b>Exploración real:</b> ${fmt(sheet.world.countries)} países · ${fmt(sheet.world.cities)} ciudades · ${fmt(sheet.world.places || 0)} lugares · ${fmt(sheet.world.visits)} visitas.</div>
      <div><b>Entradas visibles:</b> ${sheet.entries.length}</div>`;

    const languages = sheet.entries.filter((entry) => entry.type === 'language');
    const skills = sheet.entries.filter((entry) => entry.type === 'skill' || entry.type === 'attribute');
    $activity.innerHTML = `
      <div class="rpg-section-title">Aptitudes / Habilidades / CV</div>
      <ul>${skills.map((entry) => `<li>${entry.icon || '✨'} <b>${entry.name}</b> · ${fmt(entry.value)} ${entry.rankProgress?.enabled ? `· R${entry.rankProgress.rank}` : ''}</li>`).join('') || '<li>Sin entradas manuales todavía</li>'}</ul>
      <div class="rpg-section-title">Idiomas</div>
      <ul>${languages.map((entry) => `<li>${entry.icon || '🗣️'} <b>${entry.name}</b> · ${entry.manualLevel || 'sin nivel'} · ${fmt(entry.value)}h</li>`).join('') || '<li>Sin idiomas manuales todavía</li>'}</ul>`;

    $formulas.innerHTML = '<ul><li>Valor final = valor manual + suma/resta de fuentes configuradas por peso.</li><li>Si activas rangos: progreso abierto sin tope global, con puntos base + crecimiento por rango.</li></ul>';
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
    return buildCharacterSheet(lastSnapshot, lastConfig, selectedRange);
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
