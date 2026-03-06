import { auth, db } from './firebase-shared.js';
import { ref, get, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  ATTRIBUTE_KEYS,
  ATTRIBUTE_LABELS,
  buildCharacterSheetData,
  getHabitAttributeMappings
} from './dashboard-rpg.js';

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

  const fmt = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(n || 0));
  const money = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
  const pct = (n) => `${n >= 0 ? '+' : ''}${fmt(n)}`;

  let lastSnapshot = {};
  let lastConfig = {};
  let lastSheet = null;

  function statIcon(k) {
    return {
      vida: '❤️', estamina: '⚡', fuerza: '💪', inteligencia: '🧠', enfoque: '🎯',
      creatividad: '🎨', oro: '💰', exploracion: '🌍', supervivencia: '🍳', combate: '🎮'
    }[k] || '✨';
  }

  async function getCharacterConfig(uid) {
    const snap = await get(ref(db, `v2/users/${uid}/dashboardRpg`));
    return snap.val() || {};
  }

  async function saveCharacterConfig(uid, config) {
    await update(ref(db, `v2/users/${uid}/dashboardRpg`), config);
  }

  function makeRange(value = 0) {
    const normalized = Math.max(0, Number(value || 0));
    const rank = Math.floor(normalized / 120) + 1;
    const local = normalized % 120;
    return { rank, local, cap: 120 };
  }

  function renderHero(sheet) {
    const level = sheet.hasBirthdate ? `Nivel ${sheet.level}` : 'Nivel pendiente';
    const subtitle = sheet.hasBirthdate ? `${level} · ${sheet.className}` : 'Configura tu fecha de nacimiento para calcular nivel';
    $hero.innerHTML = `
      <div class="rpg-hero-topline">Character Sheet</div>
      <div class="rpg-hero-name">${sheet.name}</div>
      <div class="rpg-hero-meta">${subtitle}</div>
      <div class="rpg-hero-resource">
        <div class="rpg-hero-resource-main">💰 ${money(sheet.resources.gold)}</div>
        <div class="rpg-hero-resource-delta ${sheet.deltas.goldWeek >= 0 ? 'up' : 'down'}">${pct(sheet.deltas.goldWeek)} esta semana</div>
        <div class="rpg-hero-resource-delta ${sheet.deltas.goldToday >= 0 ? 'up' : 'down'}">${pct(sheet.deltas.goldToday)} hoy</div>
      </div>`;
  }

  function renderStats(sheet) {
    $stats.innerHTML = ATTRIBUTE_KEYS.map((k) => {
      const value = sheet.attributes[k] || 0;
      const range = makeRange(value);
      return `
      <article class="rpg-stat" data-stat="${k}">
        <div class="rpg-stat-head"><span>${statIcon(k)} ${ATTRIBUTE_LABELS[k]}</span><strong>${fmt(value)}</strong></div>
        <div class="rpg-bar"><span style="width:${(range.local / range.cap) * 100}%"></span></div>
        <small>Rango ${range.rank} · ${fmt(range.local)}/${range.cap} hacia el siguiente</small>
      </article>`;
    }).join('');
  }

  function renderResources(sheet) {
    $resources.innerHTML = `
      <div class="rpg-resource"><span>💰 Oro real</span><strong>${money(sheet.resources.gold)}</strong><small>Finance/accounts</small></div>
      <div class="rpg-resource"><span>📈 Ingresos semana</span><strong>${money(sheet.deltas.incomeWeek)}</strong><small>Finance/transactions</small></div>
      <div class="rpg-resource"><span>📉 Gastos semana</span><strong>${money(sheet.deltas.expenseWeek)}</strong><small>Finance/transactions</small></div>
      <div class="rpg-resource"><span>🌍 Reinos / ciudades</span><strong>${fmt(sheet.world.countries)} / ${fmt(sheet.world.cities)}</strong><small>World/Trips real</small></div>`;
  }

  function renderPanels(sheet) {
    $delta.innerHTML = `
      <div class="rpg-delta-item ${sheet.deltas.goldWeek >= 0 ? 'up' : 'down'}">${pct(sheet.deltas.goldWeek)} oro semanal</div>
      <div class="rpg-delta-item ${sheet.deltas.goldToday >= 0 ? 'up' : 'down'}">${pct(sheet.deltas.goldToday)} oro hoy</div>
      <div class="rpg-delta-item">⚡ Estado estamina: ${sheet.staminaState}</div>`;

    const ranked = Object.entries(sheet.attributes).sort((a, b) => b[1] - a[1]);
    $ranking.innerHTML = `
      <div><b>Atributo dominante:</b> ${ATTRIBUTE_LABELS[ranked[0]?.[0] || 'vida']}</div>
      <div><b>Segunda disciplina:</b> ${ATTRIBUTE_LABELS[ranked[1]?.[0] || 'inteligencia']}</div>
      <div><b>Clase:</b> ${sheet.className}</div>
      <div><b>Estamina:</b> ${sheet.staminaState}</div>`;

    $activity.innerHTML = `<ul>
      <li>📚 ${fmt(sheet.details.books.finishedBooks)} libros terminados · ${fmt(sheet.details.books.pagesRead)} páginas.</li>
      <li>🎬 ${fmt(sheet.details.videos.total)} vídeos · ${fmt(sheet.details.videos.workHours)}h trabajadas.</li>
      <li>🍳 ${fmt(sheet.details.recipes.total)} recetas · ${fmt(sheet.details.recipes.used)} usos.</li>
      <li>🎮 ${fmt(sheet.details.games.kills)} kills · ${fmt(sheet.details.games.deaths)} deaths · ${fmt(sheet.details.games.hours)}h.</li>
      <li>🌍 ${fmt(sheet.world.countries)} países · ${fmt(sheet.world.cities)} ciudades · ${fmt(sheet.world.visits)} visitas.</li>
    </ul>`;

    $formulas.innerHTML = `<ul>${Object.entries(sheet.explain).map(([k, v]) => `<li><b>${k}:</b> ${v}</li>`).join('')}</ul>`;
  }

  function renderConfigEditor(snapshot, config) {
    const habits = snapshot?.habits?.habits || {};
    const defaultMappings = getHabitAttributeMappings(snapshot, config);

    const habitRows = Object.entries(habits).map(([id, habit]) => {
      const checks = ATTRIBUTE_KEYS.map((attr) => {
        const checked = defaultMappings[attr]?.[id] ? 'checked' : '';
        const weight = defaultMappings[attr]?.[id] || 1;
        return `<label class="rpg-map-chip"><input type="checkbox" data-role="map-check" data-habit="${id}" data-attr="${attr}" ${checked}/> ${ATTRIBUTE_LABELS[attr]} <input type="number" min="0.2" step="0.2" data-role="map-weight" data-habit="${id}" data-attr="${attr}" value="${weight}" ${checked ? '' : 'disabled'}/></label>`;
      }).join('');
      return `<details class="rpg-map-item"><summary>${habit.name || id}</summary><div class="rpg-map-grid">${checks}</div></details>`;
    }).join('') || '<div class="rpg-empty">No hay hábitos para mapear todavía.</div>';

    $config.innerHTML = `
      <form id="rpg-config-form" class="rpg-config-form">
        <label>Nombre del personaje <input name="name" value="${config.name || ''}" placeholder="Aventurero"/></label>
        <label>Fecha de nacimiento <input type="date" name="birthdate" value="${config.birthdate || ''}"/></label>
        <div class="rpg-config-help">El nivel usa tu edad real actual. Si no hay fecha de nacimiento, se muestra CTA.</div>
        <div class="rpg-config-title">Asignación de atributos</div>
        <div class="rpg-map-list">${habitRows}</div>
        <button class="btn primary" type="submit">Guardar configuración</button>
      </form>`;

    $config.querySelectorAll('[data-role="map-check"]').forEach((input) => {
      input.addEventListener('change', () => {
        const w = $config.querySelector(`[data-role="map-weight"][data-habit="${input.dataset.habit}"][data-attr="${input.dataset.attr}"]`);
        if (w) w.disabled = !input.checked;
      });
    });

    $config.querySelector('#rpg-config-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const fd = new FormData(e.target);
      const next = {
        name: String(fd.get('name') || '').trim(),
        birthdate: String(fd.get('birthdate') || '').trim(),
        habitMappings: {}
      };
      ATTRIBUTE_KEYS.forEach((attr) => { next.habitMappings[attr] = {}; });
      $config.querySelectorAll('[data-role="map-check"]').forEach((check) => {
        if (!check.checked) return;
        const attr = check.dataset.attr;
        const habit = check.dataset.habit;
        const w = Number($config.querySelector(`[data-role="map-weight"][data-habit="${habit}"][data-attr="${attr}"]`)?.value || 1);
        next.habitMappings[attr][habit] = Math.max(0.2, w);
      });
      await saveCharacterConfig(uid, next);
      await render();
    });
  }

  async function loadProfile() {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    const [snap, conf] = await Promise.all([
      get(ref(db, `v2/users/${uid}`)),
      getCharacterConfig(uid)
    ]);
    lastSnapshot = snap.val() || {};
    lastConfig = conf || {};
    lastSheet = buildCharacterSheetData(lastSnapshot, lastConfig);
    return lastSheet;
  }

  async function render() {
    try {
      const profile = await loadProfile();
      if (!profile) return;
      renderHero(profile);
      renderStats(profile);
      renderResources(profile);
      renderPanels(profile);
      renderConfigEditor(lastSnapshot, lastConfig);
    } catch (err) {
      console.error('[dashboard-rpg] render failed', err);
    }
  }

  window.__bookshellDashboard = { render, buildCharacterSheetData, getCharacterConfig, saveCharacterConfig };
  render();
}
