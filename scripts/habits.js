// habits.js
// Nueva pestaña de hábitos con check-ins, sesiones cronometradas y reportes

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1oqRk7GpYX854RfcGrYHt6iRun5TfuYE",
  authDomain: "bookshell-59703.firebaseapp.com",
  databaseURL: "https://bookshell-59703-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bookshell-59703",
  storageBucket: "bookshell-59703.appspot.com",
  messagingSenderId: "554557230752",
  appId: "1:554557230752:web:37c24e287210433cf883c5"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

// Rutas
const HABITS_PATH = "habits";
const HABIT_CHECKS_PATH = "habitChecks";
const HABIT_SESSIONS_PATH = "habitSessions";

// Storage keys
const STORAGE_KEY = "bookshell-habits-cache";
const RUNNING_KEY = "bookshell-habit-running-session";
const LAST_HABIT_KEY = "bookshell-habits-last-used";

// Estado
let habits = {}; // {id: habit}
let habitChecks = {}; // { habitId: { dateKey: true } }
let habitSessions = {}; // { sessionId: {...} }
let activeTab = "today";
let runningSession = null; // { startTs }
let sessionInterval = null;
let pendingSessionDuration = 0;
let heatmapYear = new Date().getFullYear();
let habitDeleteTarget = null;

// Utilidades fecha
function dateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return dateKeyLocal(new Date());
}

function startOfWeek(d = new Date()) {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day; // lunes como inicio
  date.setDate(date.getDate() + diff);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(base, delta) {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

function parseDateKey(key) {
  if (!key) return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatMinutes(min) {
  if (!min) return "0";
  if (min >= 60) {
    const hours = Math.floor(min / 60);
    const rest = min % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${min}m`;
}

function getSessionDateKey(session) {
  if (!session) return null;
  if (session.dateKey) return session.dateKey;
  if (session.startTs) return dateKeyLocal(new Date(session.startTs));
  return null;
}

function isSessionActive(session) {
  if (!session) return false;
  const habit = habits[session.habitId];
  return habit && !habit.archived;
}

function minutesFromSession(session) {
  return Math.round((session?.durationSec || 0) / 60);
}

function readCache() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      habits = parsed.habits || {};
      habitChecks = parsed.habitChecks || {};
      habitSessions = parsed.habitSessions || {};
    }
  } catch (err) {
    console.warn("No se pudo leer cache de hábitos", err);
  }
}

function saveCache() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ habits, habitChecks, habitSessions })
    );
  } catch (err) {
    console.warn("No se pudo guardar cache de hábitos", err);
  }
}

function saveRunningSession() {
  if (!runningSession) {
    localStorage.removeItem(RUNNING_KEY);
    return;
  }
  try {
    localStorage.setItem(RUNNING_KEY, JSON.stringify(runningSession));
  } catch (err) {
    console.warn("No se pudo guardar sesión activa", err);
  }
}

function loadRunningSession() {
  try {
    const raw = localStorage.getItem(RUNNING_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.startTs) {
        runningSession = parsed;
      }
    }
  } catch (err) {
    console.warn("No se pudo leer sesión activa", err);
  }
}

function activeHabits() {
  return Object.values(habits).filter((h) => !h.archived);
}

function getSessionsForDate(dateKey) {
  return Object.values(habitSessions).filter((s) => isSessionActive(s) && getSessionDateKey(s) === dateKey);
}

function getSessionsForHabitDate(habitId, dateKey) {
  return Object.values(habitSessions).filter(
    (s) => isSessionActive(s) && s.habitId === habitId && getSessionDateKey(s) === dateKey
  );
}

function hasSessionForHabitDate(habitId, dateKey) {
  return getSessionsForHabitDate(habitId, dateKey).length > 0;
}

function isHabitCompletedOnDate(habit, dateKey) {
  if (!habit || habit.archived) return false;
  const checked = !!(habitChecks[habit.id] && habitChecks[habit.id][dateKey]);
  if (checked) return true;
  return hasSessionForHabitDate(habit.id, dateKey);
}

function countCompletedHabitsForDate(dateKey) {
  return activeHabits().reduce((acc, habit) => (isHabitCompletedOnDate(habit, dateKey) ? acc + 1 : acc), 0);
}

function getAvailableYears() {
  const years = new Set([new Date().getFullYear()]);
  Object.entries(habitChecks).forEach(([habitId, dates]) => {
    if (habits[habitId]?.archived) return;
    Object.keys(dates || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed) years.add(parsed.getFullYear());
    });
  });
  Object.values(habitSessions).forEach((s) => {
    if (!isSessionActive(s)) return;
    const key = getSessionDateKey(s);
    const parsed = parseDateKey(key);
    if (parsed) years.add(parsed.getFullYear());
  });
  return Array.from(years).sort((a, b) => b - a);
}

function getDayScore(dateKey) {
  const totalMinutes = getSessionsForDate(dateKey).reduce((acc, s) => acc + minutesFromSession(s), 0);
  const completedHabits = countCompletedHabitsForDate(dateKey);
  const sessionActivity = totalMinutes > 0 ? 1 : 0;
  const intensityBonus = Math.min(3, Math.floor(totalMinutes / 30));
  return {
    score: completedHabits + sessionActivity + intensityBonus,
    completedHabits,
    totalMinutes
  };
}

// UI refs
const $tabs = document.querySelectorAll(".habit-subtab");
const $panels = document.querySelectorAll(".habits-panel");
const $btnAddHabit = document.getElementById("habit-add-btn");
const $btnAddTime = document.getElementById("habit-add-time");
const $habitTodayPending = document.getElementById("habits-today-pending");
const $habitTodayDone = document.getElementById("habits-today-done");
const $habitTodayEmpty = document.getElementById("habits-today-empty");
const $habitTodayDoneEmpty = document.getElementById("habits-today-done-empty");
const $habitWeekList = document.getElementById("habits-week-list");
const $habitWeekEmpty = document.getElementById("habits-week-empty");
const $habitHistoryList = document.getElementById("habits-history-list");
const $habitHistoryEmpty = document.getElementById("habits-history-empty");
const $habitKpiToday = document.getElementById("habit-kpi-today");
const $habitKpiStreak = document.getElementById("habit-kpi-streak");
const $habitKpiStreakLabel = document.getElementById("habit-kpi-streak-label");
const $habitKpiMinutes = document.getElementById("habit-kpi-minutes");
const $habitMinutesBars = document.getElementById("habit-minutes-bars");
const $habitGlobalHeatmap = document.getElementById("habit-global-heatmap");
const $habitHeatmapYear = document.getElementById("habit-heatmap-year");
const $habitHeatmapSub = document.getElementById("habit-heatmap-sub");
const $habitHeatmapPrev = document.getElementById("habit-heatmap-prev");
const $habitHeatmapNext = document.getElementById("habit-heatmap-next");
const $habitRankingWeek = document.getElementById("habit-ranking-week");
const $habitRankingMonth = document.getElementById("habit-ranking-month");
const $habitRankingConsistency = document.getElementById("habit-ranking-consistency");
const $habitFab = document.getElementById("habit-session-toggle");
const $habitOverlay = document.getElementById("habit-session-overlay");
const $habitOverlayTime = document.getElementById("habit-session-time");
const $habitOverlayStop = document.getElementById("habit-session-stop");

// Modal refs
const $habitModal = document.getElementById("habit-modal-backdrop");
const $habitModalTitle = document.getElementById("habit-modal-title");
const $habitModalClose = document.getElementById("habit-modal-close");
const $habitModalCancel = document.getElementById("habit-modal-cancel");
const $habitDelete = document.getElementById("habit-delete");
const $habitForm = document.getElementById("habit-form");
const $habitId = document.getElementById("habit-id");
const $habitName = document.getElementById("habit-name");
const $habitEmoji = document.getElementById("habit-emoji");
const $habitColor = document.getElementById("habit-color");
const $habitTargetMinutes = document.getElementById("habit-target-minutes");
const $habitDaysSelector = document.getElementById("habit-days-selector");

// Sesión modal
const $habitSessionModal = document.getElementById("habit-session-modal");
const $habitSessionClose = document.getElementById("habit-session-close");
const $habitSessionCancel = document.getElementById("habit-session-cancel");
const $habitSessionSearch = document.getElementById("habit-session-search");
const $habitSessionList = document.getElementById("habit-session-list");
const $habitSessionLast = document.getElementById("habit-session-last");

// Manual time modal
const $habitManualModal = document.getElementById("habit-manual-modal");
const $habitManualForm = document.getElementById("habit-manual-form");
const $habitManualHabit = document.getElementById("habit-manual-habit");
const $habitManualMinutes = document.getElementById("habit-manual-minutes");
const $habitManualDate = document.getElementById("habit-manual-date");
const $habitManualClose = document.getElementById("habit-manual-close");
const $habitManualCancel = document.getElementById("habit-manual-cancel");

// Delete confirm modal
const $habitDeleteConfirm = document.getElementById("habit-delete-confirm");
const $habitDeleteName = document.getElementById("habit-delete-name");
const $habitDeleteClose = document.getElementById("habit-delete-close");
const $habitDeleteCancel = document.getElementById("habit-delete-cancel");
const $habitDeleteConfirmBtn = document.getElementById("habit-delete-confirm-btn");

function isHabitScheduledForDate(habit, date) {
  if (!habit || habit.archived) return false;
  if (!habit.schedule || habit.schedule.type === "daily") return true;
  const day = date.getDay();
  return Array.isArray(habit.schedule.days) && habit.schedule.days.includes(day);
}

function getHabitChecksForDate(dateKey) {
  let total = 0;
  activeHabits().forEach((h) => {
    if (habitChecks[h.id] && habitChecks[h.id][dateKey]) total += 1;
  });
  return total;
}

function toggleDay(habitId, dateKey) {
  if (!habitId || !dateKey) return;
  const habit = habits[habitId];
  if (!habit || habit.archived) return;
  if (!habitChecks[habitId]) habitChecks[habitId] = {};
  if (habitChecks[habitId][dateKey]) {
    delete habitChecks[habitId][dateKey];
  } else {
    habitChecks[habitId][dateKey] = true;
  }
  saveCache();
  persistHabitCheck(habitId, dateKey, !!habitChecks[habitId][dateKey]);
  renderHabits();
}

function persistHabitCheck(habitId, dateKey, value) {
  try {
    const path = `${HABIT_CHECKS_PATH}/${habitId}/${dateKey}`;
    if (value) {
      set(ref(db, path), true);
    } else {
      set(ref(db, path), null);
    }
  } catch (err) {
    console.warn("No se pudo sincronizar check de hábito", err);
  }
}

function openHabitModal(habit = null) {
  $habitModal.classList.remove("hidden");
  $habitId.value = habit ? habit.id : "";
  $habitModalTitle.textContent = habit ? "Editar hábito" : "Nuevo hábito";
  $habitName.value = habit ? habit.name || "" : "";
  $habitEmoji.value = habit ? habit.emoji || "" : "";
  $habitColor.value = habit && habit.color ? habit.color : "#7f5dff";
  $habitTargetMinutes.value = habit && habit.targetMinutes ? habit.targetMinutes : "";
  const goal = habit && habit.goal === "time" ? "time" : "check";
  $habitForm.querySelector(`input[name=\"habit-goal\"][value=\"${goal}\"]`).checked = true;
  const scheduleType = habit && habit.schedule && habit.schedule.type === "days" ? "days" : "daily";
  $habitForm.querySelector(`input[name=\"habit-schedule\"][value=\"${scheduleType}\"]`).checked = true;
  Array.from($habitDaysSelector.querySelectorAll("button")).forEach((btn) => {
    const day = Number(btn.dataset.day);
    const active = scheduleType === "days" && habit && Array.isArray(habit.schedule?.days) && habit.schedule.days.includes(day);
    btn.classList.toggle("is-active", active);
  });
  $habitDelete.style.display = habit ? "inline-flex" : "none";
}

function closeHabitModal() {
  $habitModal.classList.add("hidden");
}

function gatherHabitPayload() {
  const name = ($habitName.value || "").trim();
  if (!name) return null;
  const id = $habitId.value || `h-${Date.now().toString(36)}`;
  const existing = habits[id];
  const emoji = ($habitEmoji.value || "").trim() || "🏷️";
  const color = $habitColor.value || "#7f5dff";
  const goal = $habitForm.querySelector("input[name=\"habit-goal\"]:checked")?.value || "check";
  const scheduleType = $habitForm.querySelector("input[name=\"habit-schedule\"]:checked")?.value || "daily";
  const days = Array.from($habitDaysSelector.querySelectorAll("button.is-active")).map((b) => Number(b.dataset.day));
  const targetMinutes = $habitTargetMinutes.value ? Number($habitTargetMinutes.value) : null;
  return {
    id,
    name,
    emoji,
    color,
    goal,
    targetMinutes: Number.isFinite(targetMinutes) && targetMinutes > 0 ? targetMinutes : null,
    schedule: scheduleType === "days" ? { type: "days", days } : { type: "daily", days: [] },
    createdAt: existing?.createdAt || Date.now(),
    archived: existing?.archived || false
  };
}

function persistHabit(habit) {
  try {
    set(ref(db, `${HABITS_PATH}/${habit.id}`), habit);
  } catch (err) {
    console.warn("No se pudo guardar hábito en remoto", err);
  }
}

function removeHabitRemote(habitId) {
  try {
    set(ref(db, `${HABITS_PATH}/${habitId}`), null);
  } catch (err) {
    console.warn("No se pudo borrar hábito remoto", err);
  }
}

function createHabitActions(habit) {
  const wrap = document.createElement("div");
  wrap.className = "habit-actions";
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "icon-btn";
  edit.title = "Editar";
  edit.textContent = "✎";
  edit.addEventListener("click", (e) => {
    e.stopPropagation();
    openHabitModal(habit);
  });
  const del = document.createElement("button");
  del.type = "button";
  del.className = "icon-btn";
  del.title = "Eliminar";
  del.textContent = "⋯";
  del.addEventListener("click", (e) => {
    e.stopPropagation();
    openDeleteConfirm(habit.id);
  });
  wrap.appendChild(edit);
  wrap.appendChild(del);
  return wrap;
}

function openDeleteConfirm(habitId) {
  if (!habitId) return;
  habitDeleteTarget = habitId;
  if ($habitDeleteName) {
    $habitDeleteName.textContent = habits[habitId]?.name || "este hábito";
  }
  $habitDeleteConfirm?.classList.remove("hidden");
}

function closeDeleteConfirm() {
  habitDeleteTarget = null;
  $habitDeleteConfirm?.classList.add("hidden");
}

function archiveHabit() {
  if (!habitDeleteTarget) return;
  const habit = habits[habitDeleteTarget];
  if (habit) {
    habit.archived = true;
    persistHabit(habit);
  }
  delete habitChecks[habitDeleteTarget];
  saveCache();
  closeDeleteConfirm();
  closeHabitModal();
  renderHabits();
}

function renderSubtabs() {
  $tabs.forEach((tab) => {
    const isActive = tab.dataset.tab === activeTab;
    tab.classList.toggle("is-active", isActive);
    tab.setAttribute("aria-selected", String(isActive));
  });
  $panels.forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.panel === activeTab);
  });
}

function renderToday() {
  const today = todayKey();
  $habitTodayPending.innerHTML = "";
  $habitTodayDone.innerHTML = "";
  let pendingCount = 0;
  let doneCount = 0;
  activeHabits()
    .filter((h) => isHabitScheduledForDate(h, new Date()))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((habit) => {
      const doneCheck = !!(habitChecks[habit.id] && habitChecks[habit.id][today]);
      const sessionsToday = getSessionsForHabitDate(habit.id, today);
      const minutesToday = sessionsToday.reduce((acc, s) => acc + minutesFromSession(s), 0);
      const hasActivity = doneCheck || minutesToday > 0;
      const metaParts = [habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día"];
      if (habit.targetMinutes) metaParts.push(`Obj: ${habit.targetMinutes}m`);
      if (minutesToday) metaParts.push(`${minutesToday}m hoy`);
      const card = document.createElement("div");
      card.className = "habit-card";

      const left = document.createElement("div");
      left.className = "habit-card-left";
      left.innerHTML = `
        <div class="habit-emoji" style="background:${habit.color || "var(--glass)"}22">${habit.emoji || "🏷️"}</div>
        <div>
          <div class="habit-name">${habit.name}</div>
          <div class="habit-meta">${metaParts.join(" · ")}</div>
        </div>
      `;

      const toggleBtn = document.createElement("button");
      toggleBtn.className = "habit-toggle";
      toggleBtn.textContent = doneCheck ? "Hecho" : minutesToday ? "Check" : "Marcar";
      toggleBtn.addEventListener("click", () => toggleDay(habit.id, today));

      const right = document.createElement("div");
      right.className = "habit-card-right";
      right.appendChild(createHabitActions(habit));
      right.appendChild(toggleBtn);

      card.appendChild(left);
      card.appendChild(right);

      if (hasActivity) {
        doneCount += 1;
        $habitTodayDone.appendChild(card);
      } else {
        pendingCount += 1;
        $habitTodayPending.appendChild(card);
      }
    });

  $habitTodayEmpty.style.display = pendingCount ? "none" : "block";
  $habitTodayDoneEmpty.style.display = doneCount ? "none" : "block";
}

function formatDaysLabel(days = []) {
  if (!days || days.length === 0) return "Cada día";
  const map = ["D", "L", "M", "X", "J", "V", "S"];
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => map[d]).join(", ");
}

function renderWeek() {
  $habitWeekList.innerHTML = "";
  const start = startOfWeek(new Date());
  let any = false;
  activeHabits()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((habit) => {
      any = true;
      const card = document.createElement("div");
      card.className = "habit-week-card";
      const header = document.createElement("div");
      header.className = "habit-week-header";
      header.innerHTML = `
        <div class="habit-card-left">
          <div class="habit-emoji" style="background:${habit.color || "var(--glass)"}22">${habit.emoji || "🏷️"}</div>
          <div>
            <div class="habit-name">${habit.name}</div>
            <div class="habit-meta">${habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día"}</div>
          </div>
        </div>
      `;
      header.appendChild(createHabitActions(habit));
      const daysRow = document.createElement("div");
      daysRow.className = "habit-week-days";
      for (let i = 0; i < 7; i++) {
        const date = addDays(start, i);
        const dateKey = dateKeyLocal(date);
        const label = ["L", "M", "X", "J", "V", "S", "D"][i];
        const btn = document.createElement("button");
        btn.className = "habit-day-btn";
        const active = isHabitCompletedOnDate(habit, dateKey);
        btn.classList.toggle("is-active", active);
        btn.textContent = label;
        btn.title = dateKey;
        btn.disabled = !isHabitScheduledForDate(habit, date);
        btn.addEventListener("click", () => toggleDay(habit.id, dateKey));
        daysRow.appendChild(btn);
      }
      card.appendChild(header);
      card.appendChild(daysRow);
      $habitWeekList.appendChild(card);
    });

  $habitWeekEmpty.style.display = any ? "none" : "block";
}

function renderHistory() {
  $habitHistoryList.innerHTML = "";
  let any = false;
  const days = 30;
  const today = new Date();
  activeHabits()
    .forEach((habit) => {
      any = true;
      const card = document.createElement("div");
      card.className = "habit-heatmap-card";
      card.innerHTML = `
        <div class="habit-heatmap-header">
          <div class="habit-emoji" style="background:${habit.color || "var(--glass)"}22">${habit.emoji || "🏷️"}</div>
          <div>
            <div class="habit-name">${habit.name}</div>
            <div class="habit-meta">Últimos ${days} días</div>
          </div>
        </div>
      `;
      card.querySelector(".habit-heatmap-header").appendChild(createHabitActions(habit));
      const grid = document.createElement("div");
      grid.className = "habit-heatmap-grid";
      for (let i = days - 1; i >= 0; i--) {
        const date = addDays(today, -i);
        const dateKey = dateKeyLocal(date);
        const dot = document.createElement("div");
        dot.className = "habit-heatmap-dot";
        if (isHabitCompletedOnDate(habit, dateKey)) {
          dot.classList.add("on");
        }
        grid.appendChild(dot);
      }
      card.appendChild(grid);
      $habitHistoryList.appendChild(card);
    });

  $habitHistoryEmpty.style.display = any ? "none" : "block";
}

function renderBars() {
  if (!$habitMinutesBars) return;
  $habitMinutesBars.innerHTML = "";
  const today = new Date();
  for (let i = 6; i >= 0; i--) {
    const date = addDays(today, -i);
    const dateKey = dateKeyLocal(date);
    const totalSec = Object.values(habitSessions).reduce((acc, session) => {
      if (!isSessionActive(session)) return acc;
      if (getSessionDateKey(session) === dateKey) return acc + (session.durationSec || 0);
      return acc;
    }, 0);
    const minutes = Math.round(totalSec / 60);
    const bar = document.createElement("div");
    bar.className = "habit-bar";
    bar.dataset.label = ["L", "M", "X", "J", "V", "S", "D"][date.getDay()];
    const height = Math.min(120, minutes * 2);
    bar.style.height = `${height}px`;
    bar.title = `${minutes} min`;
    $habitMinutesBars.appendChild(bar);
  }
}

function renderGlobalHeatmap() {
  $habitGlobalHeatmap.innerHTML = "";
  const years = getAvailableYears();
  if (!years.includes(heatmapYear) && years.length) {
    heatmapYear = years[0];
  }
  const yearStart = new Date(heatmapYear, 0, 1);
  let cursor = new Date(yearStart);
  let activeDays = 0;
  while (cursor.getFullYear() === heatmapYear) {
    const key = dateKeyLocal(cursor);
    const { score, completedHabits, totalMinutes } = getDayScore(key);
    const cell = document.createElement("div");
    cell.className = "habit-heatmap-cell";
    const level = Math.min(4, score);
    if (level > 0) {
      cell.classList.add(`heat-level-${level}`);
      activeDays += 1;
    }
    cell.title = `${key} · ${completedHabits} hábitos · ${totalMinutes}m`;
    $habitGlobalHeatmap.appendChild(cell);
    cursor = addDays(cursor, 1);
  }
  if ($habitHeatmapYear) $habitHeatmapYear.textContent = heatmapYear;
  if ($habitHeatmapSub) $habitHeatmapSub.textContent = `Año ${heatmapYear} · ${activeDays} días con actividad`;
  updateHeatmapYearControls(years);
}

function updateHeatmapYearControls(years = getAvailableYears()) {
  if (!$habitHeatmapPrev || !$habitHeatmapNext) return;
  if (!years.length) return;
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  $habitHeatmapPrev.disabled = heatmapYear <= minYear;
  $habitHeatmapNext.disabled = heatmapYear >= maxYear;
}

function changeHeatmapYear(delta) {
  const years = getAvailableYears();
  if (!years.length) return;
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);
  const nextYear = heatmapYear + delta;
  if (nextYear < minYear || nextYear > maxYear) return;
  heatmapYear = nextYear;
  renderGlobalHeatmap();
}

function renderRanking() {
  renderRankingList($habitRankingWeek, minutesByHabit(7), "min");
  renderRankingList($habitRankingMonth, minutesByHabit(30), "min");
  renderRankingList($habitRankingConsistency, consistencyByHabit(30), "%");
}

function minutesByHabit(daysRange) {
  const cutoff = addDays(new Date(), -daysRange + 1);
  const res = [];
  activeHabits().forEach((habit) => {
    let total = 0;
    Object.values(habitSessions).forEach((s) => {
      if (!isSessionActive(s) || s.habitId !== habit.id) return;
      const dateKey = getSessionDateKey(s);
      const parsed = parseDateKey(dateKey);
      if (parsed && parsed >= cutoff) total += s.durationSec || 0;
    });
    res.push({ habit, value: Math.round(total / 60) });
  });
  const pool = res.filter((item) => item.value > 0);
  const base = pool.length ? pool : res;
  return base.sort((a, b) => b.value - a.value).slice(0, 5);
}

function consistencyByHabit(daysRange) {
  const today = new Date();
  const start = addDays(today, -daysRange + 1);
  const res = [];
  activeHabits().forEach((habit) => {
    let scheduled = 0;
    let completed = 0;
    for (let i = 0; i < daysRange; i++) {
      const date = addDays(start, i);
      const key = dateKeyLocal(date);
      if (isHabitScheduledForDate(habit, date)) {
        scheduled += 1;
        if (isHabitCompletedOnDate(habit, key)) completed += 1;
      }
    }
    const ratio = scheduled ? Math.round((completed / scheduled) * 100) : 0;
    res.push({ habit, value: ratio });
  });
  return res.sort((a, b) => b.value - a.value).slice(0, 5);
}

function renderRankingList(container, items, unit) {
  if (!container) return;
  container.innerHTML = "";
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "habit-ranking-empty";
    empty.textContent = "Sin datos todavía";
    container.appendChild(empty);
    return;
  }
  items.forEach((item) => {
    const div = document.createElement("div");
    div.className = "habit-ranking-item";
    const left = document.createElement("div");
    left.className = "habit-card-left";
    left.innerHTML = `
      <div class="habit-emoji" style="background:${item.habit.color || "var(--glass)"}22">${item.habit.emoji || "🏷️"}</div>
      <div>
        <div class="habit-name">${item.habit.name}</div>
        <div class="habit-consistency">${unit === "%" ? "Consistencia" : "Minutos"}</div>
      </div>
    `;
    const value = document.createElement("div");
    value.className = "habit-kpi-value";
    value.textContent = `${item.value}${unit === "%" ? "%" : "m"}`;

    const right = document.createElement("div");
    right.className = "habit-card-right";
    right.appendChild(value);
    right.appendChild(createHabitActions(item.habit));

    div.appendChild(left);
    div.appendChild(right);
    container.appendChild(div);
  });
}

function renderKPIs() {
  const today = todayKey();
  $habitKpiToday.textContent = countCompletedHabitsForDate(today);

  const streakData = computeBestStreak();
  $habitKpiStreak.textContent = streakData.best;
  $habitKpiStreakLabel.textContent = streakData.label || "—";

  const minutesWeek = minutesByRange(7);
  $habitKpiMinutes.textContent = formatMinutes(minutesWeek);
}

function computeBestStreak() {
  let best = 0;
  let label = "";
  activeHabits().forEach((habit) => {
    const streak = computeHabitStreak(habit, 60).best;
    if (streak > best) {
      best = streak;
      label = habit.name;
    }
  });
  const total = computeTotalStreak();
  if (total.best > best) {
    best = total.best;
    label = "Total";
  }
  return { best, label };
}

function computeHabitStreak(habit, daysRange = 60) {
  const today = new Date();
  let best = 0;
  let current = 0;
  for (let i = daysRange - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const key = dateKeyLocal(date);
    const scheduled = isHabitScheduledForDate(habit, date);
    const done = isHabitCompletedOnDate(habit, key);
    if (scheduled && done) {
      current += 1;
      best = Math.max(best, current);
    } else if (scheduled) {
      current = 0;
    }
  }
  return { best };
}

function computeTotalStreak(daysRange = 60) {
  const today = new Date();
  let best = 0;
  let current = 0;
  for (let i = daysRange - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const key = dateKeyLocal(date);
    const scheduledAny = activeHabits().some((h) => isHabitScheduledForDate(h, date));
    const doneAny = activeHabits().some((h) => isHabitCompletedOnDate(h, key));
    if (scheduledAny && doneAny) {
      current += 1;
      best = Math.max(best, current);
    } else if (scheduledAny) {
      current = 0;
    }
  }
  return { best };
}

function minutesByRange(daysRange) {
  const cutoff = addDays(new Date(), -daysRange + 1);
  const totalSec = Object.values(habitSessions).reduce((acc, s) => {
    if (!isSessionActive(s)) return acc;
    const parsed = parseDateKey(getSessionDateKey(s));
    if (parsed && parsed >= cutoff) return acc + (s.durationSec || 0);
    return acc;
  }, 0);
  return Math.round(totalSec / 60);
}

function renderHabits() {
  renderSubtabs();
  renderToday();
  renderWeek();
  renderHistory();
  renderKPIs();
  renderBars();
  renderGlobalHeatmap();
  renderRanking();
  updateSessionUI();
}

function handleHabitSubmit(e) {
  e.preventDefault();
  const payload = gatherHabitPayload();
  if (!payload) return;
  habits[payload.id] = payload;
  saveCache();
  persistHabit(payload);
  closeHabitModal();
  renderHabits();
}

function deleteHabit() {
  const id = $habitId.value;
  if (!id) return;
  openDeleteConfirm(id);
}

// Cronómetro
function startSession() {
  if (runningSession) return;
  runningSession = { startTs: Date.now() };
  saveRunningSession();
  updateSessionUI();
  sessionInterval = setInterval(updateSessionUI, 1000);
}

function stopSession() {
  if (!runningSession) return;
  const duration = Math.max(1, Math.round((Date.now() - runningSession.startTs) / 1000));
  pendingSessionDuration = duration;
  runningSession = null;
  saveRunningSession();
  if (sessionInterval) clearInterval(sessionInterval);
  updateSessionUI();
  openSessionModal();
}

function updateSessionUI() {
  const isRunning = !!runningSession;
  const habitsVisible = document.getElementById("view-habits")?.classList.contains("view-active");
  if (isRunning) {
    const elapsed = Math.max(0, Math.round((Date.now() - runningSession.startTs) / 1000));
    $habitOverlayTime.textContent = formatTimer(elapsed);
  }
  $habitOverlay.classList.toggle("hidden", !isRunning || !habitsVisible);
  $habitFab.textContent = isRunning ? "⏹ Parar sesión" : "▶︎ Empezar sesión";
}

function formatTimer(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function openSessionModal() {
  renderSessionList();
  $habitSessionModal.classList.remove("hidden");
  $habitSessionSearch.value = "";
  $habitSessionSearch.focus();
}

function closeSessionModal() {
  $habitSessionModal.classList.add("hidden");
  pendingSessionDuration = 0;
}

function renderSessionList() {
  $habitSessionList.innerHTML = "";
  const habitsList = Object.values(habits).filter((h) => !h.archived);
  const lastHabitId = localStorage.getItem(LAST_HABIT_KEY);
  const lastHabit = lastHabitId ? habits[lastHabitId] : null;
  if (lastHabit) {
    $habitSessionLast.style.display = "block";
    $habitSessionLast.textContent = `Asignar al último: ${lastHabit.emoji || "🏷️"} ${lastHabit.name}`;
    $habitSessionLast.onclick = () => assignSession(lastHabit.id);
  } else {
    $habitSessionLast.style.display = "none";
  }

  const query = ($habitSessionSearch.value || "").toLowerCase();
  habitsList
    .filter((h) => h.name.toLowerCase().includes(query))
    .forEach((habit) => {
      const item = document.createElement("div");
      item.className = "habit-session-item";
      item.innerHTML = `
        <div class="habit-card-left">
          <div class="habit-emoji" style="background:${habit.color || "var(--glass)"}22">${habit.emoji || "🏷️"}</div>
          <div>
            <div class="habit-name">${habit.name}</div>
            <div class="habit-meta">${habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día"}</div>
          </div>
        </div>
        <div class="habit-kpi-value">${Math.round(pendingSessionDuration / 60)}m</div>
      `;
      item.addEventListener("click", () => assignSession(habit.id));
      $habitSessionList.appendChild(item);
    });
}

function assignSession(habitId) {
  if (!habitId || !pendingSessionDuration) {
    closeSessionModal();
    return;
  }
  const startTs = Date.now() - pendingSessionDuration * 1000;
  const endTs = Date.now();
  const dateKey = dateKeyLocal(new Date(startTs));
  const sessionId = `s-${Date.now().toString(36)}`;
  const payload = {
    habitId,
    startTs,
    endTs,
    durationSec: pendingSessionDuration,
    dateKey,
    source: "timer"
  };
  habitSessions[sessionId] = payload;
  localStorage.setItem(LAST_HABIT_KEY, habitId);
  saveCache();
  try {
    set(ref(db, `${HABIT_SESSIONS_PATH}/${sessionId}`), payload);
  } catch (err) {
    console.warn("No se pudo guardar sesión en remoto", err);
  }
  pendingSessionDuration = 0;
  closeSessionModal();
  renderHabits();
}

function openManualTimeModal(dateKey = todayKey()) {
  if (!$habitManualModal) return;
  $habitManualHabit.innerHTML = "";
  const list = activeHabits();
  list.forEach((habit) => {
    const option = document.createElement("option");
    option.value = habit.id;
    option.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
    $habitManualHabit.appendChild(option);
  });
  if (!list.length) {
    const option = document.createElement("option");
    option.textContent = "Crea un hábito para añadir tiempo";
    option.disabled = true;
    option.selected = true;
    $habitManualHabit.appendChild(option);
  }
  const lastHabitId = localStorage.getItem(LAST_HABIT_KEY);
  if (lastHabitId) {
    $habitManualHabit.value = lastHabitId;
  }
  $habitManualMinutes.value = "";
  $habitManualDate.value = dateKey;
  $habitManualModal.classList.remove("hidden");
}

function closeManualTimeModal() {
  $habitManualModal?.classList.add("hidden");
}

function handleManualSubmit(e) {
  e.preventDefault();
  const habitId = $habitManualHabit.value;
  const minutes = Number($habitManualMinutes.value);
  const dateKey = $habitManualDate.value || todayKey();
  if (!habitId || !Number.isFinite(minutes) || minutes <= 0) return;
  const sessionId = `s-${Date.now().toString(36)}`;
  const payload = {
    habitId,
    durationSec: Math.round(minutes * 60),
    dateKey,
    startTs: null,
    endTs: null,
    source: "manual"
  };
  habitSessions[sessionId] = payload;
  localStorage.setItem(LAST_HABIT_KEY, habitId);
  saveCache();
  try {
    set(ref(db, `${HABIT_SESSIONS_PATH}/${sessionId}`), payload);
  } catch (err) {
    console.warn("No se pudo guardar sesión manual", err);
  }
  closeManualTimeModal();
  renderHabits();
}

// Eventos
function bindEvents() {
  $tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      renderHabits();
    });
  });

  $btnAddHabit.addEventListener("click", () => openHabitModal());
  $btnAddTime?.addEventListener("click", () => openManualTimeModal());
  $habitModalClose.addEventListener("click", closeHabitModal);
  $habitModalCancel.addEventListener("click", closeHabitModal);
  $habitForm.addEventListener("submit", handleHabitSubmit);
  $habitDelete.addEventListener("click", deleteHabit);
  $habitHeatmapPrev?.addEventListener("click", () => changeHeatmapYear(-1));
  $habitHeatmapNext?.addEventListener("click", () => changeHeatmapYear(1));

  $habitDaysSelector.querySelectorAll("button").forEach((btn) => {
    btn.addEventListener("click", () => {
      btn.classList.toggle("is-active");
    });
  });

  $habitFab.addEventListener("click", () => {
    if (runningSession) {
      stopSession();
    } else {
      startSession();
    }
  });
  $habitOverlayStop.addEventListener("click", stopSession);

  $habitSessionClose.addEventListener("click", closeSessionModal);
  $habitSessionCancel.addEventListener("click", closeSessionModal);
  $habitSessionSearch.addEventListener("input", renderSessionList);

  $habitManualClose?.addEventListener("click", closeManualTimeModal);
  $habitManualCancel?.addEventListener("click", closeManualTimeModal);
  $habitManualForm?.addEventListener("submit", handleManualSubmit);

  $habitDeleteClose?.addEventListener("click", closeDeleteConfirm);
  $habitDeleteCancel?.addEventListener("click", closeDeleteConfirm);
  $habitDeleteConfirmBtn?.addEventListener("click", archiveHabit);
}

function attachNavHook() {
  document.querySelectorAll(".nav-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.view === "view-habits") {
        renderHabits();
      }
    });
  });
}

// Firebase listeners
function listenRemote() {
  onValue(ref(db, HABITS_PATH), (snap) => {
    const val = snap.val() || {};
    habits = val;
    saveCache();
    renderHabits();
  });

  onValue(ref(db, HABIT_CHECKS_PATH), (snap) => {
    habitChecks = snap.val() || {};
    saveCache();
    renderHabits();
  });

  onValue(ref(db, HABIT_SESSIONS_PATH), (snap) => {
    habitSessions = snap.val() || {};
    saveCache();
    renderHabits();
  });
}

export function initHabits() {
  readCache();
  loadRunningSession();
  bindEvents();
  attachNavHook();
  listenRemote();
  renderHabits();
  if (runningSession) {
    sessionInterval = setInterval(updateSessionUI, 1000);
  }
}

// Autoinit
initHabits();
