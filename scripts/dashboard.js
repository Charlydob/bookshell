import { auth, db } from './firebase-shared.js';
import { ref, get, update } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { ATTRIBUTE_KEYS, ATTRIBUTE_LABELS } from './character/character-attributes.js';
import { buildCharacterSheet } from './character/character-engine.js';
import { renderRangeSelector, renderList } from './character/character-ui.js';
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

  const fmt = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(n || 0));
  const money = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
  const cache = initIndexedDBSafe({
    dbName: 'bookshell-dashboard',
    storeName: 'characterConfig',
    onWarning(message) {
      showWarning(message);
    }
  });

  let lastSnapshot = {};
  let lastConfig = {};
  let lastSheet = null;
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

  function statIcon(k) {
    return {
      vida: '❤️', estamina: '⚡', fuerza: '💪', inteligencia: '🧠', enfoque: '🎯', creatividad: '🎨', oro: '💰', exploracion: '🌍', supervivencia: '🍳', combate: '🎮'
    }[k] || '✨';
  }

  async function getCharacterConfig(uid) {
    const snap = await get(ref(db, `v2/users/${uid}/dashboardRpg`));
    const raw = snap.val() || {};
    const characterConfig = raw.characterConfig || {};
    const base = {
      name: raw.name || characterConfig.name || '',
      alias: characterConfig.alias || '',
      birthdate: raw.birthdate || characterConfig.birthdate || '',
      attributeMappings: characterConfig.attributeMappings || raw.habitMappings || {},
      customAttributes: characterConfig.customAttributes || [],
      skills: characterConfig.skills || [],
      languages: characterConfig.languages || []
    };
    await cache.setItem(uid, base);
    return base;
  }

  async function saveCharacterConfig(uid, config) {
    const payload = {
      name: config.name || '',
      birthdate: config.birthdate || '',
      habitMappings: config.attributeMappings || {},
      characterConfig: config
    };
    await update(ref(db, `v2/users/${uid}/dashboardRpg`), payload);
    await cache.setItem(uid, config);
  }

  function makeRange(value = 0) {
    const normalized = Math.max(0, Number(value || 0));
    const rank = Math.floor(normalized / 120) + 1;
    const local = normalized % 120;
    return { rank, local, cap: 120 };
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

  function openSheet(html) {
    const modal = ensureSheetModal();
    modal.querySelector('#rpg-sheet-content').innerHTML = html;
    modal.classList.remove('hidden');
  }

  function renderHero(sheet) {
    const level = sheet.identity.hasBirthdate ? `Nivel ${sheet.identity.level}` : 'Nivel pendiente';
    const nameLabel = sheet.identity.alias ? `${sheet.identity.name} · ${sheet.identity.alias}` : sheet.identity.name;
    $hero.innerHTML = `
      <button type="button" class="rpg-hero-identity" id="rpg-open-identity">🧾 Character Identity</button>
      <div class="rpg-hero-name">${nameLabel}</div>
      <div class="rpg-hero-meta">${level} · Perfil RPG + CV dinámico</div>
      <div class="rpg-hero-resource">
        <div class="rpg-hero-resource-main">💰 ${money(sheet.resources.gold)}</div>
        ${renderRangeSelector(selectedRange)}
      </div>`;

    $hero.querySelector('#rpg-open-identity')?.addEventListener('click', () => {
      openSheet(`<h3>CharacterIdentitySheet</h3>
      <p><b>Nombre:</b> ${sheet.identity.name}</p>
      <p><b>Alias:</b> ${sheet.identity.alias || '—'}</p>
      <p><b>Nacimiento:</b> ${sheet.identity.birthdate || '—'}</p>
      <p><b>Nivel:</b> ${sheet.identity.level ?? 'pendiente'}</p>
      <p>Edítalo en Configuración de personaje.</p>`);
    });

    $hero.querySelectorAll('[data-range]').forEach((btn) => btn.addEventListener('click', async () => {
      selectedRange = btn.dataset.range;
      await render();
    }));
  }

  function renderStats(sheet) {
    const customKeys = sheet.customAttributes.map((x) => x.id);
    const keys = ATTRIBUTE_KEYS.concat(customKeys);
    $stats.innerHTML = keys.map((k) => {
      const value = sheet.attributes[k] || 0;
      const range = makeRange(value);
      const label = ATTRIBUTE_LABELS[k] || sheet.customAttributes.find((a) => a.id === k)?.name || k;
      return `<article class="rpg-stat" data-stat="${k}">
        <button type="button" class="rpg-stat-open" data-attribute="${k}">${statIcon(k)} ${label}</button>
        <div class="rpg-stat-head"><span>Valor</span><strong>${fmt(value)}</strong></div>
        <div class="rpg-bar"><span style="width:${(range.local / range.cap) * 100}%"></span></div>
        <small>Rango ${range.rank} · ${fmt(range.local)}/${range.cap}</small>
      </article>`;
    }).join('');

    $stats.querySelectorAll('[data-attribute]').forEach((btn) => btn.addEventListener('click', () => {
      const attr = btn.dataset.attribute;
      const sources = Object.entries(sheet.attributeMappings[attr] || {}).map(([habitId, w]) => `<li>${habitId} (peso ${w})</li>`).join('') || '<li>Sin fuentes mapeadas</li>';
      openSheet(`<h3>AttributeDetailSheet(${attr})</h3><p>Valor actual: <b>${fmt(sheet.attributes[attr] || 0)}</b></p><p>Fuentes:</p><ul>${sources}</ul><p>Para editar asociaciones usa la sección de configuración.</p>`);
    }));
  }

  function renderResources(sheet) {
    $resources.innerHTML = `
      <div class="rpg-resource"><span>💰 Oro (balance real)</span><strong>${money(sheet.resources.gold)}</strong></div>
      <div class="rpg-resource"><span>📈 Ingresos (${sheet.range})</span><strong>${money(sheet.resources.income)}</strong></div>
      <div class="rpg-resource"><span>📉 Gastos (${sheet.range})</span><strong>${money(sheet.resources.expense)}</strong></div>
      <div class="rpg-resource"><span>Δ Neto (${sheet.range})</span><strong>${money(sheet.resources.delta)}</strong></div>`;
  }

  function renderSkillAndLanguagePanels(sheet) {
    const skillsHtml = renderList(sheet.skills.map((skill) => `<li><b>${skill.icon} ${skill.name}</b> · ${skill.mastery} · ${fmt(skill.xpHours)}h<br/><small>${skill.description || 'Sin descripción'} · fuentes: ${skill.sources.join(', ') || '—'}</small></li>`), 'Sin habilidades todavía');
    const langsHtml = renderList(sheet.languages.map((lang) => `<li><b>${lang.name}</b> · ${lang.level} · ${fmt(lang.xpHours)}h<br/><small>fuentes: ${lang.sources.join(', ') || 'manual'}</small></li>`), 'Sin idiomas todavía');
    $activity.innerHTML = `<div class="rpg-section-title">Habilidades / Especialidades</div>${skillsHtml}<div class="rpg-section-title">Idiomas</div>${langsHtml}`;
  }

  function renderPanels(sheet) {
    $delta.innerHTML = `<div class="rpg-delta-item">⚡ Estamina derivada de sueño + café</div>`;
    $ranking.innerHTML = `<div><b>Exploración:</b> ${fmt(sheet.world.countries)} reinos · ${fmt(sheet.world.cities)} ciudades.</div>`;
    renderSkillAndLanguagePanels(sheet);
    $formulas.innerHTML = '<ul><li><b>computeLevelFromBirthdate:</b> nivel = edad actual.</li><li><b>computeSkillXP:</b> horas de hábitos + entradas manuales.</li><li><b>computeLanguageXP:</b> hábitos languageTag + manual.</li><li><b>computeResources:</b> finanzas reales por rango.</li></ul>';
  }

  function renderConfigEditor(snapshot, config) {
    const habits = snapshot?.habits?.habits || {};
    const habitRows = Object.entries(habits).map(([id, habit]) => `<option value="${id}">${habit.name || id}</option>`).join('');
    const mapRows = Object.entries(config.attributeMappings || {}).map(([attr, rows]) => `<li><b>${attr}</b>: ${Object.entries(rows || {}).map(([h, w]) => `${h}(${w})`).join(', ') || '—'}</li>`).join('');

    $config.innerHTML = `
      <form id="rpg-config-form" class="rpg-config-form">
        <label>Nombre <input name="name" value="${config.name || ''}" /></label>
        <label>Alias opcional <input name="alias" value="${config.alias || ''}" /></label>
        <label>Fecha de nacimiento <input type="date" name="birthdate" value="${config.birthdate || ''}" /></label>
        <label>Nueva habilidad manual (nombre) <input name="skillName" placeholder="Programación" /></label>
        <label>Horas habilidad manual <input name="skillHours" type="number" step="0.5" value="0" /></label>
        <label>Nuevo idioma manual (nombre) <input name="languageName" placeholder="Alemán" /></label>
        <label>Nivel idioma <input name="languageLevel" placeholder="B1" /></label>
        <label>Horas idioma manual <input name="languageHours" type="number" step="0.5" value="0" /></label>
        <label>Nuevo atributo personalizado <input name="customAttributeName" placeholder="Liderazgo" /></label>
        <label>Ícono atributo <input name="customAttributeIcon" placeholder="🛡️" /></label>
        <label>Descripción atributo <input name="customAttributeDescription" placeholder="Capacidad de coordinar equipos" /></label>
        <label>Mapear hábito a atributo <select name="mapHabit"><option value="">—</option>${habitRows}</select></label>
        <label>Atributo destino (id) <input name="mapAttr" placeholder="inteligencia o liderazgo" /></label>
        <label>Peso <input name="mapWeight" type="number" step="0.2" value="1" /></label>
        <button class="btn primary" type="submit">Guardar configuración</button>
      </form>
      <div class="rpg-config-help">Mapeos actuales:</div><ul>${mapRows || '<li>Sin mapeos</li>'}</ul>`;

    $config.querySelector('#rpg-config-form')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const uid = auth.currentUser?.uid;
      if (!uid) return;
      const fd = new FormData(e.target);
      const next = structuredClone(config);
      next.name = String(fd.get('name') || '').trim();
      next.alias = String(fd.get('alias') || '').trim();
      next.birthdate = String(fd.get('birthdate') || '').trim();
      next.skills = Array.isArray(next.skills) ? next.skills : [];
      next.languages = Array.isArray(next.languages) ? next.languages : [];
      next.customAttributes = Array.isArray(next.customAttributes) ? next.customAttributes : [];
      next.attributeMappings = next.attributeMappings || {};

      const skillName = String(fd.get('skillName') || '').trim();
      if (skillName) next.skills.push({ name: skillName, icon: '🧩', description: 'Añadida manualmente', manualHours: Number(fd.get('skillHours') || 0) });

      const languageName = String(fd.get('languageName') || '').trim();
      if (languageName) next.languages.push({ name: languageName, level: String(fd.get('languageLevel') || 'Básico').trim(), manualHours: Number(fd.get('languageHours') || 0) });

      const customName = String(fd.get('customAttributeName') || '').trim();
      if (customName) {
        const id = customName.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
        next.customAttributes.push({ id, name: customName, icon: String(fd.get('customAttributeIcon') || '✨').trim(), description: String(fd.get('customAttributeDescription') || '').trim() });
      }

      const mapHabit = String(fd.get('mapHabit') || '').trim();
      const mapAttr = String(fd.get('mapAttr') || '').trim();
      if (mapHabit && mapAttr) {
        if (!next.attributeMappings[mapAttr]) next.attributeMappings[mapAttr] = {};
        next.attributeMappings[mapAttr][mapHabit] = Math.max(0.2, Number(fd.get('mapWeight') || 1));
      }

      await saveCharacterConfig(uid, next);
      await render();
    });
  }

  async function loadProfile() {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    const snap = await get(ref(db, `v2/users/${uid}`));
    lastSnapshot = snap.val() || {};
    try {
      lastConfig = await getCharacterConfig(uid);
    } catch (_) {
      lastConfig = (await cache.getItem(uid)) || {};
      showWarning('Usando configuración local temporal por fallo de persistencia.');
    }
    lastSheet = buildCharacterSheet(lastSnapshot, lastConfig, selectedRange);
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

  window.__bookshellDashboard = { render, buildCharacterSheet, getCharacterConfig, saveCharacterConfig };
  render();
}
