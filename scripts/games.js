import { db } from "./firebase-shared.js";
import { ref, onValue, set, update, push, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const GROUPS_PATH = "gameGroups";
const MODES_PATH = "gameModes";
const DAILY_PATH = "gameModeDaily";
const HABITS_PATH = "habits";
const CACHE_KEY = "bookshell-games-cache:v2";
const OPEN_KEY = "bookshell-games-open-groups";
const HABIT_RUNNING_KEY = "bookshell-habit-running-session";

let groups = {};
let modes = {};
let habits = {};
let dailyByMode = {};
const openGroups = new Set();
let sessionTick = null;
let currentModeId = null;
let detailMonth = { year: new Date().getFullYear(), month: new Date().getMonth() };
let detailRange = "total";
let selectedDonutKey = "wins";

const $groupsList = document.getElementById("games-groups-list");
const $empty = document.getElementById("games-empty");
const $addMode = document.getElementById("game-add-mode");
const $modeModal = document.getElementById("game-mode-modal");
const $modeForm = document.getElementById("game-mode-form");
const $modeTitle = document.getElementById("game-mode-modal-title");
const $modeClose = document.getElementById("game-mode-close");
const $modeCancel = document.getElementById("game-mode-cancel");
const $groupChoice = document.getElementById("game-group-choice");
const $existingWrap = document.getElementById("game-group-existing-wrap");
const $existingGroup = document.getElementById("game-existing-group");
const $newWrap = document.getElementById("game-group-new-wrap");
const $groupName = document.getElementById("game-group-name");
const $groupEmoji = document.getElementById("game-group-emoji");
const $groupHabit = document.getElementById("game-group-linked-habit");
const $groupHabitWrap = document.getElementById("game-group-habit-wrap");
const $modeName = document.getElementById("game-mode-name");
const $modeEmoji = document.getElementById("game-mode-emoji");

const $groupModal = document.getElementById("game-group-modal");
const $groupForm = document.getElementById("game-group-form");
const $groupClose = document.getElementById("game-group-close");
const $groupCancel = document.getElementById("game-group-cancel");
const $groupId = document.getElementById("game-group-id");
const $groupEditName = document.getElementById("game-group-edit-name");
const $groupEditEmoji = document.getElementById("game-group-edit-emoji");
const $groupEditHabit = document.getElementById("game-group-edit-habit");

const $detailModal = document.getElementById("game-detail-modal");
const $detailBody = document.getElementById("game-detail-body");
const $detailTitle = document.getElementById("game-detail-title");
const $detailClose = document.getElementById("game-detail-close");
const $detailCancel = document.getElementById("game-detail-cancel");

const $statsFilter = document.getElementById("game-stats-group-filter");
const $statsTotals = document.getElementById("game-stats-totals");
const $statsDonut = document.getElementById("game-stats-donut");
const $statsLine = document.getElementById("game-stats-line");
const $statsSub = document.getElementById("game-stats-sub");

let editingModeId = null;

function nowTs() { return Date.now(); }
const clamp = (n, min = 0) => Math.max(min, n);
function dateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
function todayKey() { return dateKeyLocal(new Date()); }

function saveCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ groups, modes, dailyByMode }));
  localStorage.setItem(OPEN_KEY, JSON.stringify(Array.from(openGroups)));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      groups = parsed.groups || {};
      modes = parsed.modes || {};
      dailyByMode = parsed.dailyByMode || {};
    }
    const openRaw = localStorage.getItem(OPEN_KEY);
    if (openRaw) JSON.parse(openRaw).forEach((id) => openGroups.add(id));
  } catch (_) {}
}

function ensurePct(wins, losses, ties = 0) {
  const total = wins + losses + ties;
  if (!total) return { winPct: 0, lossPct: 0, tiePct: 0, total: 0 };
  return {
    total,
    winPct: Math.round((wins / total) * 100),
    lossPct: Math.round((losses / total) * 100),
    tiePct: Math.round((ties / total) * 100)
  };
}

function getRunningSessionState() {
  try {
    const raw = localStorage.getItem(HABIT_RUNNING_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed?.startTs) return null;
    return parsed;
  } catch (_) { return null; }
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  if (m < 60) return `${String(m).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
function triggerHaptic() { try { navigator.vibrate?.(10); } catch (_) {} }

function habitOptionsHtml() {
  const rows = Object.values(habits || {}).filter((h) => h && h.id && !h.archived).sort((a, b) => (a.name || "").localeCompare(b.name || "es"));
  const opt = ['<option value="">Ninguno</option>'];
  rows.forEach((h) => opt.push(`<option value="${h.id}">${h.emoji || "✅"} ${h.name || h.id}</option>`));
  return opt.join("");
}

function groupModes(groupId) {
  return Object.values(modes || {}).filter((m) => m?.groupId === groupId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}
function groupTotals(groupId) {
  return groupModes(groupId).reduce((acc, m) => {
    acc.wins += Number(m.wins || 0);
    acc.losses += Number(m.losses || 0);
    acc.ties += Number(m.ties || 0);
    return acc;
  }, { wins: 0, losses: 0, ties: 0 });
}

function readDayMinutes(rawValue) {
  if (rawValue == null) return 0;
  if (typeof rawValue === "number") return Math.round(Math.max(0, rawValue) / 60);
  if (typeof rawValue === "object") {
    const minRaw = Number(rawValue.min);
    const secRaw = Number(rawValue.totalSec);
    if (Number.isFinite(minRaw) && minRaw > 0) return Math.round(minRaw);
    if (Number.isFinite(secRaw) && secRaw > 0) return Math.round(secRaw / 60);
  }
  return 0;
}

function getModePlayedMinutes(mode) {
  const group = groups[mode.groupId];
  const habit = group?.linkedHabitId ? habits[group.linkedHabitId] : null;
  if (!habit?.log) return 0;
  return Object.values(habit.log).reduce((acc, val) => acc + readDayMinutes(val), 0);
}

function buildModeCard(mode, groupEmoji) {
  const wins = clamp(Number(mode.wins || 0));
  const losses = clamp(Number(mode.losses || 0));
  const ties = clamp(Number(mode.ties || 0));
  const { winPct, lossPct, tiePct, total } = ensurePct(wins, losses, ties);
  const emoji = (mode.modeEmoji || "").trim() || groupEmoji || "🎮";
  const tieWidth = Math.min(40, Math.max(6, tiePct || 0));
  return `
  <article class="game-card" data-mode-id="${mode.id}" role="button" tabindex="0">
    <div class="game-split-bg">
      <div class="game-split-loss" style="width:${Math.max(10, lossPct)}%"></div>
      <div class="game-split-win" style="width:${Math.max(10, winPct)}%"></div>
      <div class="game-split-tie" style="width:${tieWidth}%"></div>
    </div>
    <div class="game-card-total">${total} TOTAL</div>
    <div class="game-card-content">
      <div class="game-side left">
        <div class="game-side-stat">${losses} • ${lossPct}%</div>
      </div>
      <div class="game-center">
        <div class="game-mode-name">${mode.modeName || "Modo"}</div>
        <button class="game-mode-emoji game-mode-emoji-btn" data-action="tie" title="Empate">${emoji}</button>
      </div>
      <div class="game-side right">
        <div class="game-side-stat">${winPct}% • ${wins}</div>
      </div>
    </div>
    <div class="game-bottom-tie">${ties} • ${tiePct}%</div>
  </article>`;
}

function renderStatsFilter() {
  if (!$statsFilter) return;
  const options = ['<option value="all">Global</option>'];
  Object.values(groups || {}).forEach((g) => options.push(`<option value="${g.id}">${g.emoji || "🎮"} ${g.name || "Grupo"}</option>`));
  const current = $statsFilter.value || "all";
  $statsFilter.innerHTML = options.join("");
  $statsFilter.value = options.some((o) => o.includes(`value=\"${current}\"`)) ? current : "all";
}

function linePointsFromDaily(modeIds) {
  const dayMap = new Map();
  modeIds.forEach((modeId) => {
    const rows = dailyByMode[modeId] || {};
    Object.entries(rows).forEach(([day, rec]) => {
      const prev = dayMap.get(day) || { wins: 0, losses: 0, ties: 0 };
      prev.wins += Number(rec?.wins || 0);
      prev.losses += Number(rec?.losses || 0);
      prev.ties += Number(rec?.ties || 0);
      dayMap.set(day, prev);
    });
  });
  return Array.from(dayMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
}

function renderLineChart($el, points) {
  if (!$el) return;
  if (!points.length) {
    $el.innerHTML = "<div class='games-subtitle'>Sin datos diarios todavía.</div>";
    return;
  }
  const width = 360;
  const height = 120;
  const pad = 10;
  const maxVal = Math.max(1, ...points.map(([, v]) => Math.max(v.wins, v.losses, v.ties)));
  const make = (key) => points.map(([, v], i) => {
    const x = pad + (i * (width - pad * 2)) / Math.max(1, points.length - 1);
    const y = height - pad - ((v[key] || 0) / maxVal) * (height - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  $el.innerHTML = `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
    <polyline fill="none" stroke="rgba(255,90,110,.9)" stroke-width="2" points="${make("losses")}" />
    <polyline fill="none" stroke="rgba(64,235,151,.95)" stroke-width="2" points="${make("wins")}" />
    <polyline fill="none" stroke="rgba(177,190,210,.85)" stroke-width="2" points="${make("ties")}" />
  </svg>`;
}

function renderDonut($el, vals, selectable = false) {
  if (!$el) return;
  const total = vals.wins + vals.losses + vals.ties;
  const safe = total || 1;
  const a = (vals.losses / safe) * 360;
  const b = (vals.ties / safe) * 360;
  const grad = `conic-gradient(rgba(255,90,110,.92) 0deg ${a}deg, rgba(177,190,210,.9) ${a}deg ${a + b}deg, rgba(64,235,151,.95) ${a + b}deg 360deg)`;
  const labels = { wins: "Victorias", losses: "Derrotas", ties: "Empates" };
  const activeVal = vals[selectedDonutKey] || 0;
  const activePct = total ? Math.round((activeVal / total) * 100) : 0;
  const buttons = selectable ? `
    <div class="game-ranges">
      <button class="game-range-btn ${selectedDonutKey === "losses" ? "is-active" : ""}" data-donut="losses">L</button>
      <button class="game-range-btn ${selectedDonutKey === "ties" ? "is-active" : ""}" data-donut="ties">T</button>
      <button class="game-range-btn ${selectedDonutKey === "wins" ? "is-active" : ""}" data-donut="wins">W</button>
    </div>` : "";
  $el.innerHTML = `<div class="games-donut-ring" style="background:${grad};">
      <div class="games-donut-center">
        <div class="games-donut-total">${total}</div>
        <div>${labels[selectedDonutKey]} ${activeVal} (${activePct}%)</div>
      </div>
    </div>${buttons}`;
}

function renderGlobalStats() {
  renderStatsFilter();
  const selected = $statsFilter?.value || "all";
  const modeRows = Object.values(modes || {}).filter((m) => m && (selected === "all" || m.groupId === selected));
  const totals = modeRows.reduce((acc, m) => {
    acc.wins += Number(m.wins || 0);
    acc.losses += Number(m.losses || 0);
    acc.ties += Number(m.ties || 0);
    return acc;
  }, { wins: 0, losses: 0, ties: 0 });
  const pct = ensurePct(totals.wins, totals.losses, totals.ties);
  if ($statsTotals) $statsTotals.textContent = `${pct.total} partidas · ${totals.wins}W / ${totals.losses}L / ${totals.ties}T · ${pct.winPct}%W`;
  if ($statsSub) $statsSub.textContent = selected === "all" ? "Global" : (groups[selected]?.name || "Grupo");
  renderDonut($statsDonut, totals, false);
  renderLineChart($statsLine, linePointsFromDaily(modeRows.map((m) => m.id)));
}

function render() {
  if (!$groupsList) return;
  const groupRows = Object.values(groups || {}).filter((g) => g?.id).sort((a, b) => (a.name || "").localeCompare(b.name || "es"));
  $groupsList.innerHTML = "";
  $empty.style.display = groupRows.length ? "none" : "block";
  const running = getRunningSessionState();

  groupRows.forEach((g) => {
    const groupedModes = groupModes(g.id);
    const { wins, losses, ties } = groupTotals(g.id);
    const { winPct, lossPct } = ensurePct(wins, losses, ties);
    const hasRunning = !!(running && g.linkedHabitId && running.targetHabitId === g.linkedHabitId);
    const elapsed = hasRunning ? formatDuration((Date.now() - Number(running.startTs || Date.now())) / 1000) : "";
    if (!openGroups.size) openGroups.add(g.id);
    const detail = document.createElement("details");
    detail.className = "game-group";
    detail.open = openGroups.has(g.id);
    detail.dataset.groupId = g.id;
    detail.innerHTML = `
      <summary>
        <div class="game-group-main">
          <div class="game-group-name">${g.emoji || "🎮"} ${g.name || "Grupo"}</div>
          <div class="game-group-meta">${losses}L / ${wins}W / ${ties}T · ${lossPct}% - ${winPct}%</div>
        </div>
        <div class="game-group-actions">
          <button class="game-session-btn" data-action="toggle-session">${hasRunning ? `■ ${elapsed}` : "▶ Iniciar"}</button>
          <button class="game-menu-btn" data-action="group-menu">…</button>
        </div>
      </summary>
      <div class="game-group-body">${groupedModes.map((m) => buildModeCard(m, g.emoji)).join("")}</div>
    `;
    detail.addEventListener("toggle", () => {
      if (detail.open) openGroups.add(g.id);
      else openGroups.delete(g.id);
      saveCache();
    });
    $groupsList.appendChild(detail);
  });
  renderGlobalStats();
}

function openModeModal(mode = null) {
  editingModeId = mode?.id || null;
  $modeTitle.textContent = editingModeId ? "Editar modo" : "Nuevo modo";
  $groupChoice.value = "existing";
  $groupName.value = "";
  $groupEmoji.value = "🎮";
  $modeName.value = mode?.modeName || "";
  $modeEmoji.value = mode?.modeEmoji || "";
  $existingGroup.innerHTML = Object.values(groups).map((g) => `<option value="${g.id}">${g.emoji || "🎮"} ${g.name}</option>`).join("");
  if (mode?.groupId) $existingGroup.value = mode.groupId;
  $groupHabit.innerHTML = habitOptionsHtml();
  $groupHabit.value = "";
  toggleGroupChoice();
  $modeModal.classList.remove("hidden");
}

function closeModeModal() { $modeModal.classList.add("hidden"); editingModeId = null; }

function openGroupModal(groupIdValue) {
  const g = groups[groupIdValue];
  if (!g) return;
  $groupId.value = g.id;
  $groupEditName.value = g.name || "";
  $groupEditEmoji.value = g.emoji || "🎮";
  $groupEditHabit.innerHTML = habitOptionsHtml();
  $groupEditHabit.value = g.linkedHabitId || "";
  $groupModal.classList.remove("hidden");
}
function closeGroupModal() { $groupModal.classList.add("hidden"); }

function toggleGroupChoice() {
  const isNew = $groupChoice.value === "new";
  $newWrap.style.display = isNew ? "grid" : "none";
  $groupHabitWrap.style.display = isNew ? "block" : "none";
  $existingWrap.style.display = isNew ? "none" : "block";
}

async function createOrUpdateMode() {
  const modeNameValue = $modeName.value.trim();
  if (!modeNameValue) return;
  const modeEmojiValue = $modeEmoji.value.trim();
  let groupIdValue = $existingGroup.value;
  if ($groupChoice.value === "new") {
    const name = $groupName.value.trim();
    if (!name) return;
    const groupIdRef = push(ref(db, GROUPS_PATH));
    const groupPayload = {
      id: groupIdRef.key,
      name,
      emoji: ($groupEmoji.value || "🎮").trim() || "🎮",
      linkedHabitId: $groupHabit.value || null,
      createdAt: nowTs(),
      updatedAt: nowTs()
    };
    groupIdValue = groupPayload.id;
    groups[groupPayload.id] = groupPayload;
    await set(groupIdRef, groupPayload);
  }
  if (!groupIdValue) return;
  const base = { groupId: groupIdValue, modeName: modeNameValue, modeEmoji: modeEmojiValue, updatedAt: nowTs() };
  if (editingModeId && modes[editingModeId]) {
    modes[editingModeId] = { ...modes[editingModeId], ...base };
    await update(ref(db, `${MODES_PATH}/${editingModeId}`), base);
  } else {
    const modeIdRef = push(ref(db, MODES_PATH));
    const payload = { id: modeIdRef.key, wins: 0, losses: 0, ties: 0, createdAt: nowTs(), ...base };
    modes[payload.id] = payload;
    await set(modeIdRef, payload);
  }
  saveCache();
  closeModeModal();
  render();
}

async function patchModeCounter(modeId, key, delta) {
  const mode = modes[modeId];
  if (!mode) return;
  const prevTotal = clamp(Number(mode[key] || 0));
  if (delta < 0 && prevTotal <= 0) return;
  const next = clamp(prevTotal + delta);
  mode[key] = next;
  mode.updatedAt = nowTs();

  const day = todayKey();
  dailyByMode[modeId] = dailyByMode[modeId] || {};
  const dayPrev = dailyByMode[modeId][day] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
  const dayValue = clamp(Number(dayPrev[key] || 0) + delta);
  dailyByMode[modeId][day] = { ...dayPrev, [key]: dayValue };

  render();
  if (currentModeId === modeId) renderModeDetail();
  triggerHaptic();

  const updates = {
    [`${MODES_PATH}/${modeId}/${key}`]: next,
    [`${MODES_PATH}/${modeId}/updatedAt`]: mode.updatedAt,
    [`${DAILY_PATH}/${modeId}/${day}/${key}`]: dayValue
  };
  await update(ref(db), updates);
  saveCache();
}

async function resetMode(modeId) {
  if (!confirm("¿Resetear este modo?")) return;
  const mode = modes[modeId];
  if (!mode) return;
  mode.wins = 0; mode.losses = 0; mode.ties = 0; mode.updatedAt = nowTs();
  dailyByMode[modeId] = {};
  render();
  if (currentModeId === modeId) renderModeDetail();
  await update(ref(db), {
    [`${MODES_PATH}/${modeId}/wins`]: 0,
    [`${MODES_PATH}/${modeId}/losses`]: 0,
    [`${MODES_PATH}/${modeId}/ties`]: 0,
    [`${MODES_PATH}/${modeId}/updatedAt`]: mode.updatedAt,
    [`${DAILY_PATH}/${modeId}`]: null
  });
}

async function deleteMode(modeId) {
  if (!confirm("¿Eliminar modo?")) return;
  delete modes[modeId];
  delete dailyByMode[modeId];
  if (currentModeId === modeId) closeModeDetail();
  render();
  await Promise.all([remove(ref(db, `${MODES_PATH}/${modeId}`)), remove(ref(db, `${DAILY_PATH}/${modeId}`))]);
}

async function handleGroupMenu(groupIdValue) {
  const action = prompt("Acción de grupo: editar | add | reset | delete");
  if (!action) return;
  const cmd = action.trim().toLowerCase();
  if (cmd === "editar" || cmd === "edit") return openGroupModal(groupIdValue);
  if (cmd === "add") return openModeModal({ groupId: groupIdValue });
  if (cmd === "reset") {
    if (!confirm("Resetear todos los modos del grupo?")) return;
    const updates = {};
    groupModes(groupIdValue).forEach((m) => {
      m.wins = 0; m.losses = 0; m.ties = 0; m.updatedAt = nowTs();
      updates[`${MODES_PATH}/${m.id}/wins`] = 0;
      updates[`${MODES_PATH}/${m.id}/losses`] = 0;
      updates[`${MODES_PATH}/${m.id}/ties`] = 0;
      updates[`${MODES_PATH}/${m.id}/updatedAt`] = m.updatedAt;
      updates[`${DAILY_PATH}/${m.id}`] = null;
      dailyByMode[m.id] = {};
    });
    render();
    return update(ref(db), updates);
  }
  if (cmd === "delete") {
    if (!confirm("Eliminar grupo y todos sus modos?")) return;
    const jobs = [remove(ref(db, `${GROUPS_PATH}/${groupIdValue}`))];
    groupModes(groupIdValue).forEach((m) => {
      delete modes[m.id];
      delete dailyByMode[m.id];
      jobs.push(remove(ref(db, `${MODES_PATH}/${m.id}`)));
      jobs.push(remove(ref(db, `${DAILY_PATH}/${m.id}`)));
    });
    delete groups[groupIdValue];
    render();
    return Promise.all(jobs);
  }
}

function toggleGroupSession(groupIdValue) {
  const group = groups[groupIdValue];
  if (!group?.linkedHabitId) return alert("Vincula un hábito al grupo para usar sesiones.");
  const api = window.__bookshellHabits;
  if (!api) return;
  const running = getRunningSessionState();
  if (running) {
    if (running.targetHabitId !== group.linkedHabitId) return alert("Ya hay una sesión activa");
    api.stopSession(group.linkedHabitId, true);
    return;
  }
  api.startSession(group.linkedHabitId);
}

function modeRangeTotals(modeId, range = "total") {
  const mode = modes[modeId];
  if (!mode) return { wins: 0, losses: 0, ties: 0 };
  if (range === "total") return { wins: Number(mode.wins || 0), losses: Number(mode.losses || 0), ties: Number(mode.ties || 0) };
  const days = Number(range.replace("d", "")) || 30;
  const minDate = new Date();
  minDate.setDate(minDate.getDate() - days + 1);
  const minKey = dateKeyLocal(minDate);
  return Object.entries(dailyByMode[modeId] || {}).reduce((acc, [day, row]) => {
    if (day < minKey) return acc;
    acc.wins += Number(row?.wins || 0);
    acc.losses += Number(row?.losses || 0);
    acc.ties += Number(row?.ties || 0);
    return acc;
  }, { wins: 0, losses: 0, ties: 0 });
}

function monthGrid(year, month) {
  const first = new Date(year, month, 1);
  const start = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const out = [];
  for (let i = 0; i < start; i += 1) out.push(null);
  for (let d = 1; d <= days; d += 1) out.push(new Date(year, month, d));
  while (out.length % 7) out.push(null);
  return out;
}

function renderModeDetail() {
  if (!currentModeId || !$detailBody) return;
  const mode = modes[currentModeId];
  if (!mode) return;
  const group = groups[mode.groupId] || {};
  const totals = modeRangeTotals(mode.id, detailRange);
  const pct = ensurePct(totals.wins, totals.losses, totals.ties);
  const minutes = getModePlayedMinutes(mode);
  const hoursText = `${(minutes / 60).toFixed(1)}h`;
  const points = linePointsFromDaily([mode.id]);
  const modeDaily = dailyByMode[mode.id] || {};

  const rows = monthGrid(detailMonth.year, detailMonth.month).map((dayDate) => {
    if (!dayDate) return '<div class="game-day" aria-hidden="true"></div>';
    const key = dateKeyLocal(dayDate);
    const rec = modeDaily[key] || {};
    const min = Number(rec.minutes || 0);
    const todayCls = key === todayKey() ? "today" : "";
    return `<button type="button" class="game-day ${todayCls}" data-day="${key}">
      <div class="game-day-num">${dayDate.getDate()}</div>
      <div class="game-day-min">${min ? `${min}m` : ""}</div>
      <div class="game-day-wlt">${Number(rec.wins || 0)}-${Number(rec.losses || 0)}-${Number(rec.ties || 0)}</div>
    </button>`;
  }).join("");

  $detailTitle.textContent = `${group.name || "Grupo"} — ${mode.modeName || "Modo"}`;
  $detailBody.innerHTML = `
    <section class="game-detail-head">
      <div class="game-detail-top">
        <div>
          <div class="game-detail-name">${mode.modeEmoji || group.emoji || "🎮"} ${group.name || "Grupo"} — ${mode.modeName || "Modo"}</div>
          <div class="game-detail-sub">${pct.total} partidas · ${pct.winPct}%W / ${pct.lossPct}%L / ${pct.tiePct}%T</div>
        </div>
        <div class="game-detail-actions">
          <button class="game-menu-btn" data-action="edit-mode">Editar</button>
          <button class="game-menu-btn" data-action="reset-mode">Reset</button>
          <button class="game-menu-btn" data-action="delete-mode">Eliminar</button>
        </div>
      </div>
      <div class="game-detail-summary">
        <div>W/L/T: ${totals.wins}/${totals.losses}/${totals.ties}</div>
        <div>Horas jugadas (hábito grupo): ${hoursText}</div>
      </div>
    </section>

    <section class="game-detail-section">
      <strong>Controles</strong>
      <div class="game-controls-grid">
        <div class="game-control-col loss">
          <div>Derrotas</div><div class="game-control-value">${Number(mode.losses || 0)}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="loss">+1</button><button class="game-ctrl-btn" data-action="loss-minus">-1</button></div>
        </div>
        <div class="game-control-col tie">
          <div>Empates</div><div class="game-control-value">${Number(mode.ties || 0)}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="tie">+1</button><button class="game-ctrl-btn" data-action="tie-minus">-1</button></div>
        </div>
        <div class="game-control-col win">
          <div>Victorias</div><div class="game-control-value">${Number(mode.wins || 0)}</div>
          <div class="game-control-actions"><button class="game-ctrl-btn" data-action="win">+1</button><button class="game-ctrl-btn" data-action="win-minus">-1</button></div>
        </div>
      </div>
    </section>

    <section class="game-detail-section">
      <strong>Rango</strong>
      <div class="game-ranges">
        <button class="game-range-btn ${detailRange === "1d" ? "is-active" : ""}" data-range="1d">Día</button>
        <button class="game-range-btn ${detailRange === "7d" ? "is-active" : ""}" data-range="7d">Semana</button>
        <button class="game-range-btn ${detailRange === "30d" ? "is-active" : ""}" data-range="30d">Mes</button>
        <button class="game-range-btn ${detailRange === "365d" ? "is-active" : ""}" data-range="365d">Año</button>
        <button class="game-range-btn ${detailRange === "total" ? "is-active" : ""}" data-range="total">Total</button>
      </div>
      <div class="games-stats-grid">
        <div class="games-donut" id="game-detail-donut"></div>
        <div class="games-line" id="game-detail-line"></div>
      </div>
    </section>

    <section class="game-detail-section">
      <div class="game-calendar-head">
        <strong>Calendario mensual</strong>
        <div>
          <button class="game-menu-btn" data-cal-nav="-1">←</button>
          <span>${new Date(detailMonth.year, detailMonth.month, 1).toLocaleDateString("es-ES", { month: "long", year: "numeric" })}</span>
          <button class="game-menu-btn" data-cal-nav="1">→</button>
        </div>
      </div>
      <div class="game-calendar-grid">${rows}</div>
    </section>`;

  renderDonut(document.getElementById("game-detail-donut"), totals, true);
  renderLineChart(document.getElementById("game-detail-line"), points);
}

function openModeDetail(modeId) {
  if (!modes[modeId]) return;
  currentModeId = modeId;
  detailMonth = { year: new Date().getFullYear(), month: new Date().getMonth() };
  detailRange = "total";
  selectedDonutKey = "wins";
  renderModeDetail();
  $detailModal.classList.remove("hidden");
}

function closeModeDetail() {
  $detailModal.classList.add("hidden");
  currentModeId = null;
}

async function onListClick(e) {
  const btn = e.target.closest("button[data-action]");
  const card = e.target.closest(".game-card");
  if (card && !btn) {
    openModeDetail(card.dataset.modeId);
    return;
  }
  if (!btn) return;
  const action = btn.dataset.action;
  const modeId = btn.closest(".game-card")?.dataset.modeId || currentModeId;
  const groupIdValue = btn.closest(".game-group")?.dataset.groupId;
  if (action === "loss" && modeId) return patchModeCounter(modeId, "losses", 1);
  if (action === "win" && modeId) return patchModeCounter(modeId, "wins", 1);
  if (action === "tie" && modeId) return patchModeCounter(modeId, "ties", 1);
  if (action === "loss-minus" && modeId) return patchModeCounter(modeId, "losses", -1);
  if (action === "win-minus" && modeId) return patchModeCounter(modeId, "wins", -1);
  if (action === "tie-minus" && modeId) return patchModeCounter(modeId, "ties", -1);
  if (action === "edit-mode" && modeId) return openModeModal(modes[modeId]);
  if (action === "reset-mode" && modeId) return resetMode(modeId);
  if (action === "delete-mode" && modeId) return deleteMode(modeId);
  if (action === "group-menu" && groupIdValue) return handleGroupMenu(groupIdValue);
  if (action === "toggle-session" && groupIdValue) return toggleGroupSession(groupIdValue);
}

function bind() {
  $addMode?.addEventListener("click", () => openModeModal());
  $groupChoice?.addEventListener("change", toggleGroupChoice);
  $modeClose?.addEventListener("click", closeModeModal);
  $modeCancel?.addEventListener("click", closeModeModal);
  $modeModal?.addEventListener("click", (e) => { if (e.target === $modeModal) closeModeModal(); });
  $groupClose?.addEventListener("click", closeGroupModal);
  $groupCancel?.addEventListener("click", closeGroupModal);
  $groupModal?.addEventListener("click", (e) => { if (e.target === $groupModal) closeGroupModal(); });
  $detailClose?.addEventListener("click", closeModeDetail);
  $detailCancel?.addEventListener("click", closeModeDetail);
  $detailModal?.addEventListener("click", (e) => { if (e.target === $detailModal) closeModeDetail(); });

  $modeForm?.addEventListener("submit", async (e) => { e.preventDefault(); await createOrUpdateMode(); });
  $groupForm?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const id = $groupId.value;
    const group = groups[id];
    if (!group) return;
    const payload = {
      name: $groupEditName.value.trim(),
      emoji: ($groupEditEmoji.value || "🎮").trim() || "🎮",
      linkedHabitId: $groupEditHabit.value || null,
      updatedAt: nowTs()
    };
    groups[id] = { ...group, ...payload };
    render();
    await update(ref(db, `${GROUPS_PATH}/${id}`), payload);
    closeGroupModal();
    saveCache();
  });

  $groupsList?.addEventListener("click", onListClick);
  $statsFilter?.addEventListener("change", renderGlobalStats);

  $detailBody?.addEventListener("click", async (e) => {
    const rangeBtn = e.target.closest("[data-range]");
    if (rangeBtn) {
      detailRange = rangeBtn.dataset.range;
      renderModeDetail();
      return;
    }
    const dBtn = e.target.closest("[data-donut]");
    if (dBtn) {
      selectedDonutKey = dBtn.dataset.donut;
      renderModeDetail();
      return;
    }
    const calBtn = e.target.closest("[data-cal-nav]");
    if (calBtn) {
      detailMonth.month += Number(calBtn.dataset.calNav);
      if (detailMonth.month < 0) { detailMonth.month = 11; detailMonth.year -= 1; }
      if (detailMonth.month > 11) { detailMonth.month = 0; detailMonth.year += 1; }
      renderModeDetail();
      return;
    }
    const day = e.target.closest("[data-day]")?.dataset.day;
    if (day && currentModeId) {
      const rec = dailyByMode[currentModeId]?.[day] || { wins: 0, losses: 0, ties: 0, minutes: 0 };
      alert(`${day}\nW/L/T: ${rec.wins || 0}/${rec.losses || 0}/${rec.ties || 0}\nMinutos: ${rec.minutes || 0}`);
      return;
    }
    if (e.target.closest("button[data-action]")) onListClick(e);
  });
}

function listenRemote() {
  onValue(ref(db, GROUPS_PATH), (snap) => {
    groups = snap.val() || {};
    if (!localStorage.getItem(OPEN_KEY)) Object.keys(groups).forEach((id) => openGroups.add(id));
    saveCache();
    render();
  });
  onValue(ref(db, MODES_PATH), (snap) => {
    modes = snap.val() || {};
    saveCache();
    render();
    if (currentModeId) renderModeDetail();
  });
  onValue(ref(db, DAILY_PATH), (snap) => {
    dailyByMode = snap.val() || {};
    saveCache();
    renderGlobalStats();
    if (currentModeId) renderModeDetail();
  });
  onValue(ref(db, HABITS_PATH), (snap) => {
    habits = snap.val() || {};
    $groupHabit.innerHTML = habitOptionsHtml();
    $groupEditHabit.innerHTML = habitOptionsHtml();
    if (currentModeId) renderModeDetail();
  });
}

function init() {
  if (!$groupsList) return;
  loadCache();
  bind();
  listenRemote();
  render();
  if (sessionTick) clearInterval(sessionTick);
  sessionTick = setInterval(() => {
    if (document.getElementById("view-games")?.classList.contains("view-active")) render();
  }, 1000);
}

init();
