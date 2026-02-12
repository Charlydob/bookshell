import { db } from "./firebase-shared.js";
import { ref, onValue, set, update, push, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const GROUPS_PATH = "gameGroups";
const MODES_PATH = "gameModes";
const HABITS_PATH = "habits";
const CACHE_KEY = "bookshell-games-cache:v1";
const HABIT_RUNNING_KEY = "bookshell-habit-running-session";

let groups = {};
let modes = {};
let habits = {};
const openGroups = new Set();
let sessionTick = null;

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

let editingModeId = null;

function nowTs() { return Date.now(); }
const clamp = (n, min = 0) => Math.max(min, n);

function saveCache() {
  localStorage.setItem(CACHE_KEY, JSON.stringify({ groups, modes }));
}

function loadCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    groups = parsed.groups || {};
    modes = parsed.modes || {};
  } catch (_) {}
}

function ensurePctPair(wins, losses) {
  const total = wins + losses;
  if (!total) return { winPct: 0, lossPct: 0 };
  const lossPct = Math.round((losses / total) * 100);
  const winPct = 100 - lossPct;
  return { winPct, lossPct };
}

function getRunningSessionState() {
  try {
    const raw = localStorage.getItem(HABIT_RUNNING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.startTs) return null;
    return parsed;
  } catch (_) {
    return null;
  }
}

function formatDuration(sec) {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h ${String(rm).padStart(2, "0")}m`;
}

function triggerHaptic() {
  try { navigator.vibrate?.(10); } catch (_) {}
}

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
    return acc;
  }, { wins: 0, losses: 0 });
}

function buildModeCard(mode, groupEmoji) {
  const wins = clamp(Number(mode.wins || 0));
  const losses = clamp(Number(mode.losses || 0));
  const { winPct, lossPct } = ensurePctPair(wins, losses);
  const dominant = winPct >= lossPct ? "win" : "loss";
  const emoji = (mode.modeEmoji || "").trim() || groupEmoji || "🎮";
  return `
  <article class="game-card" data-mode-id="${mode.id}" data-dominant="${dominant}">
    <div class="game-split-bg">
      <div class="game-split-loss" style="width:${lossPct}%"></div>
      <div class="game-split-win" style="width:${winPct}%"></div>
    </div>
    <div class="game-divider"></div>
    <div class="game-card-content">
      <div class="game-side left">
        <div class="game-side-stat">${losses} · ${lossPct}%</div>
        <button class="game-side-btn game-btn-loss" data-action="loss">👎</button>
      </div>
      <div class="game-center">
        <div class="game-mode-name">${mode.modeName || "Modo"}</div>
        <div class="game-mode-emoji">${emoji}</div>
      </div>
      <div class="game-side right">
        <div class="game-side-stat">${wins} · ${winPct}%</div>
        <button class="game-side-btn game-btn-win" data-action="win">👍</button>
      </div>
    </div>
    <div class="game-menu">
      <button class="game-mode-btn" data-action="edit-mode">Editar</button>
      <button class="game-mode-btn" data-action="reset-mode">Reset</button>
      <button class="game-mode-btn" data-action="delete-mode">Eliminar</button>
    </div>
  </article>`;
}

function render() {
  if (!$groupsList) return;
  const groupRows = Object.values(groups || {}).filter((g) => g?.id).sort((a, b) => (a.name || "").localeCompare(b.name || "es"));
  $groupsList.innerHTML = "";
  $empty.style.display = groupRows.length ? "none" : "block";
  const running = getRunningSessionState();
  groupRows.forEach((g) => {
    const groupedModes = groupModes(g.id);
    const { wins, losses } = groupTotals(g.id);
    const { winPct, lossPct } = ensurePctPair(wins, losses);
    const hasRunning = !!(running && g.linkedHabitId && running.targetHabitId === g.linkedHabitId);
    const elapsed = hasRunning ? formatDuration((Date.now() - Number(running.startTs || Date.now())) / 1000) : "";
    const detail = document.createElement("details");
    detail.className = "game-group";
    if (openGroups.has(g.id)) detail.open = true;
    detail.dataset.groupId = g.id;
    detail.innerHTML = `
      <summary>
        <div class="game-group-main">
          <div class="game-group-name">${g.emoji || "🎮"} ${g.name || "Grupo"}</div>
          <div class="game-group-meta">${losses}L / ${wins}W · ${lossPct}% - ${winPct}%</div>
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
    });
    $groupsList.appendChild(detail);
  });
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

function closeModeModal() {
  $modeModal.classList.add("hidden");
  editingModeId = null;
}

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
  const modeName = $modeName.value.trim();
  if (!modeName) return;
  const modeEmoji = $modeEmoji.value.trim();
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
  const base = {
    groupId: groupIdValue,
    modeName,
    modeEmoji,
    updatedAt: nowTs()
  };
  if (editingModeId && modes[editingModeId]) {
    const next = { ...modes[editingModeId], ...base };
    modes[editingModeId] = next;
    await update(ref(db, `${MODES_PATH}/${editingModeId}`), base);
  } else {
    const modeIdRef = push(ref(db, MODES_PATH));
    const payload = {
      id: modeIdRef.key,
      wins: 0,
      losses: 0,
      createdAt: nowTs(),
      ...base
    };
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
  const next = clamp(Number(mode[key] || 0) + delta);
  mode[key] = next;
  mode.updatedAt = nowTs();
  render();
  triggerHaptic();
  await update(ref(db, `${MODES_PATH}/${modeId}`), { [key]: next, updatedAt: mode.updatedAt });
  saveCache();
}

async function resetMode(modeId) {
  if (!confirm("¿Resetear este modo?")) return;
  const mode = modes[modeId];
  if (!mode) return;
  mode.wins = 0;
  mode.losses = 0;
  mode.updatedAt = nowTs();
  render();
  await update(ref(db, `${MODES_PATH}/${modeId}`), { wins: 0, losses: 0, updatedAt: mode.updatedAt });
}

async function deleteMode(modeId) {
  if (!confirm("¿Eliminar modo?")) return;
  delete modes[modeId];
  render();
  await remove(ref(db, `${MODES_PATH}/${modeId}`));
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
      m.wins = 0; m.losses = 0; m.updatedAt = nowTs();
      updates[`${m.id}/wins`] = 0;
      updates[`${m.id}/losses`] = 0;
      updates[`${m.id}/updatedAt`] = m.updatedAt;
    });
    render();
    return update(ref(db, MODES_PATH), updates);
  }
  if (cmd === "delete") {
    if (!confirm("Eliminar grupo y todos sus modos?")) return;
    const jobs = [remove(ref(db, `${GROUPS_PATH}/${groupIdValue}`))];
    groupModes(groupIdValue).forEach((m) => {
      delete modes[m.id];
      jobs.push(remove(ref(db, `${MODES_PATH}/${m.id}`)));
    });
    delete groups[groupIdValue];
    render();
    return Promise.all(jobs);
  }
}

function toggleGroupSession(groupIdValue) {
  const group = groups[groupIdValue];
  if (!group?.linkedHabitId) {
    alert("Vincula un hábito al grupo para usar sesiones.");
    return;
  }
  const api = window.__bookshellHabits;
  if (!api) return;
  const running = getRunningSessionState();
  if (running) {
    if (running.targetHabitId !== group.linkedHabitId) {
      alert("Ya hay una sesión activa");
      return;
    }
    api.stopSession(group.linkedHabitId, true);
    return;
  }
  api.startSession(group.linkedHabitId);
}

async function onListClick(e) {
  const btn = e.target.closest("button[data-action]");
  if (!btn) return;
  const action = btn.dataset.action;
  const modeId = btn.closest(".game-card")?.dataset.modeId;
  const groupIdValue = btn.closest(".game-group")?.dataset.groupId;
  if (action === "loss" && modeId) return patchModeCounter(modeId, "losses", 1);
  if (action === "win" && modeId) return patchModeCounter(modeId, "wins", 1);
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
}

function listenRemote() {
  onValue(ref(db, GROUPS_PATH), (snap) => {
    groups = snap.val() || {};
    saveCache();
    render();
  });
  onValue(ref(db, MODES_PATH), (snap) => {
    modes = snap.val() || {};
    saveCache();
    render();
  });
  onValue(ref(db, HABITS_PATH), (snap) => {
    habits = snap.val() || {};
    $groupHabit.innerHTML = habitOptionsHtml();
    $groupEditHabit.innerHTML = habitOptionsHtml();
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
