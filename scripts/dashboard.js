import { auth, db } from './firebase-shared.js';
import { ref, get } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import {
  buildCharacterProfile,
  computeCharacterClass,
  computeCharacterDailyState,
  computeCharacterResources,
  computeCharacterStats,
  computeCharacterTraits
} from './dashboard-rpg.js';

const $viewMain = document.getElementById('view-main');
if (!$viewMain) {
  window.__bookshellDashboard = { render: () => {} };
} else {
  const $hero = document.getElementById('rpg-hero');
  const $stats = document.getElementById('rpg-stats');
  const $resources = document.getElementById('rpg-resources');
  const $delta = document.getElementById('rpg-delta');
  const $traits = document.getElementById('rpg-traits');
  const $ranking = document.getElementById('rpg-ranking');
  const $activity = document.getElementById('rpg-activity');
  const $formulas = document.getElementById('rpg-formulas');
  const $modal = document.getElementById('rpg-stat-modal');
  const $modalContent = document.getElementById('rpg-modal-content');
  const $modalClose = document.getElementById('rpg-modal-close');

  const fmt = (n) => new Intl.NumberFormat('es-ES', { maximumFractionDigits: 0 }).format(Number(n || 0));
  const money = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 }).format(Number(n || 0));
  let lastProfile = null;

  function statIcon(k) {
    return {
      vida: '❤️', estamina: '⚡', fuerza: '💪', inteligencia: '🧠', enfoque: '🎯',
      creatividad: '🎨', oro: '💰', exploracion: '🌍', supervivencia: '🍳', combate: '🎮'
    }[k] || '✨';
  }

  function renderProfile(profile) {
    lastProfile = profile;
    $hero.innerHTML = `
      <div class="rpg-hero-title">Character Sheet</div>
      <div class="rpg-hero-name">${profile.name}</div>
      <div class="rpg-hero-meta">Nivel ${profile.level} · ${profile.className} · Estado: ${profile.dailyState}</div>
      <p class="rpg-hero-lore">${profile.lore}</p>`;

    $stats.innerHTML = Object.entries(profile.stats).map(([k, v]) => `
      <button class="rpg-stat" type="button" data-stat="${k}">
        <div class="rpg-stat-head"><span>${statIcon(k)} ${k}</span><strong>${fmt(v)}</strong></div>
        <div class="rpg-bar"><span style="width:${Math.max(4, v)}%"></span></div>
      </button>`).join('');

    $resources.innerHTML = `
      <div class="rpg-resource"><span>💰 Oro total</span><strong>${money(profile.resources.gold)}</strong><small>Dato real: finance/accounts</small></div>
      <div class="rpg-resource"><span>⛏️ Botín (30d)</span><strong>${money(profile.resources.income)}</strong><small>Dato real: income period</small></div>
      <div class="rpg-resource"><span>🏦 Tesoro</span><strong>${money(profile.resources.treasury)}</strong><small>Dato derivado</small></div>
      <div class="rpg-resource"><span>🧾 Desgaste</span><strong>${money(profile.resources.expense)}</strong><small>Dato real: expenses 30d</small></div>`;

    $delta.innerHTML = profile.deltas.map((d) => `<div class="rpg-delta-item ${d.value >= 0 ? 'up' : 'down'}">${d.value >= 0 ? '+' : ''}${fmt(d.value)} ${d.label}</div>`).join('');
    $traits.innerHTML = profile.traits.map((t) => `<span class="rpg-badge">${t}</span>`).join('');
    $ranking.innerHTML = `
      <div><b>Atributo dominante:</b> ${profile.ranking.dominantAttribute}</div>
      <div><b>Disciplina principal:</b> ${profile.ranking.mainDiscipline}</div>
      <div><b>Recurso más fuerte:</b> ${profile.ranking.strongestResource}</div>
      <div><b>Área descuidada:</b> ${profile.ranking.weakArea}</div>`;
    $activity.innerHTML = `<ul>${profile.activity.map((a) => `<li>${a}</li>`).join('')}</ul>`;
    $formulas.innerHTML = `<ul>${Object.entries(profile.formulas).map(([k, v]) => `<li><b>${k}:</b> ${v}</li>`).join('')}</ul>`;
  }

  function openStatDetail(stat) {
    if (!lastProfile) return;
    const value = lastProfile.stats?.[stat] ?? 0;
    const details = lastProfile.details || {};
    const lines = {
      vida: `Gym sesiones: ${fmt(details.gym?.sessions)} · Checks semanales: ${fmt(details.habits?.checksWeek)}`,
      estamina: `Sueño reciente: ${fmt(details.habits?.sleepHours)}h · Café hoy: ${fmt(details.habits?.coffeeToday)}`,
      fuerza: `Minutos gym: ${fmt(details.gym?.minutes)}`,
      inteligencia: `Libros: ${fmt(details.books?.finished)} · Páginas: ${fmt(details.books?.pages)}`,
      enfoque: `Horas hábitos: ${fmt(details.habits?.sessionHoursWeek)} · Horas vídeo: ${fmt(details.videos?.workHours)}`,
      creatividad: `Vídeos totales: ${fmt(details.videos?.total)} · Publicados: ${fmt(details.videos?.published)}`,
      oro: `Saldo combinado real en cuentas`,
      exploracion: `Países: ${fmt(details.trips?.countries)} · Ciudades: ${fmt(details.trips?.cities)}`,
      supervivencia: `Recetas: ${fmt(details.recipes?.total)} · Variedad: ${fmt(details.recipes?.variety)}`,
      combate: `Kills: ${fmt(details.games?.kills)} · Muertes: ${fmt(details.games?.deaths)} · Horas: ${fmt(details.games?.hours)}`
    };
    $modalContent.innerHTML = `
      <h3>${statIcon(stat)} ${stat}</h3>
      <p><b>Valor actual:</b> ${fmt(value)}/100</p>
      <p><b>Cómo sale:</b> ${lines[stat] || 'Dato derivado de actividad real.'}</p>
      <p><b>Clase actual:</b> ${computeCharacterClass({ stats: lastProfile.stats })} · <b>Estado:</b> ${computeCharacterDailyState({ stats: lastProfile.stats })}</p>
      <p><small>Recurso conectado: ${computeCharacterResources({ finance: {} }).source || 'finance'}</small></p>`;
    try { $modal.showModal(); } catch (_) { $modal.setAttribute('open', 'open'); }
  }

  async function loadProfile() {
    const uid = auth.currentUser?.uid;
    if (!uid) return null;
    const snap = await get(ref(db, `v2/users/${uid}`));
    const data = snap.val() || {};
    const profile = buildCharacterProfile(data, { name: auth.currentUser?.displayName || auth.currentUser?.email?.split('@')[0] || 'Aventurero' });
    return profile;
  }

  async function render() {
    try {
      const profile = await loadProfile();
      if (!profile) return;
      renderProfile(profile);
    } catch (err) {
      console.error('[dashboard-rpg] render failed', err);
    }
  }

  $stats?.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-stat]');
    if (!btn) return;
    openStatDetail(btn.dataset.stat);
  });
  $modalClose?.addEventListener('click', () => $modal.close?.());
  $modal?.addEventListener('click', (e) => {
    if (e.target === $modal) $modal.close?.();
  });

  window.__bookshellDashboard = {
    render,
    buildCharacterProfile,
    computeCharacterStats,
    computeCharacterClass,
    computeCharacterTraits,
    computeCharacterDailyState,
    computeCharacterResources
  };

  render();
}
