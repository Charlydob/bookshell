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
const HEATMAP_YEAR_STORAGE = "bookshell-habits-heatmap-year";
const DEFAULT_COLOR = "#7f5dff";

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
let habitToastEl = null;
let habitToastTimeout = null;
let habitDonutChart = null;
let habitDonutRange = "day";
let habitLineRange = "7d";
let habitLineHabit = "total";
let habitDaysRange = "day";
let habitLineTooltip = null;

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

function hexToRgb(hex) {
  if (!hex) return { r: 127, g: 93, b: 255 };
  const clean = hex.replace("#", "");
  if (![3, 6].includes(clean.length)) return { r: 127, g: 93, b: 255 };
  const normalized = clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
  const int = parseInt(normalized, 16);
  return {
    r: (int >> 16) & 255,
    g: (int >> 8) & 255,
    b: int & 255
  };
}

function hexToRgbString(hex) {
  const { r, g, b } = hexToRgb(hex);
  return `${r}, ${g}, ${b}`;
}

function formatMinutes(min) {
  if (!min) return "0m";
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

function getSessionDate(session) {
  if (!session) return null;
  if (session.startTs) return new Date(session.startTs);
  const key = getSessionDateKey(session);
  return parseDateKey(key);
}

function getRangeBounds(range) {
  const now = new Date();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  switch (range) {
    case "week":
      return { start: startOfWeek(now), end };
    case "month":
      return { start: new Date(now.getFullYear(), now.getMonth(), 1), end };
    case "year":
      return { start: new Date(now.getFullYear(), 0, 1), end };
    case "total":
      return { start: new Date(0), end };
    default:
      return { start: new Date(now.getFullYear(), now.getMonth(), now.getDate()), end };
  }
}

function isDateInRange(date, start, end) {
  if (!date) return false;
  return date >= start && date <= end;
}

function resolveHabitColor(habit) {
  return habit?.color || DEFAULT_COLOR;
}

function setHabitColorVars(el, habit) {
  if (!el) return;
  const color = resolveHabitColor(habit);
  el.style.setProperty("--hclr", color);
  el.style.setProperty("--hclr-rgb", hexToRgbString(color));
}

function ensureHabitToast() {
  if (!habitToastEl) {
    habitToastEl = document.createElement("div");
    habitToastEl.className = "habit-toast hidden";
    document.body.appendChild(habitToastEl);
  }
  return habitToastEl;
}

function showHabitToast(text) {
  const toast = ensureHabitToast();
  toast.textContent = text;
  toast.classList.remove("hidden");
  if (habitToastTimeout) clearTimeout(habitToastTimeout);
  habitToastTimeout = setTimeout(() => {
    toast.classList.add("hidden");
  }, 2300);
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

function loadHeatmapYear() {
  try {
    const stored = Number(localStorage.getItem(HEATMAP_YEAR_STORAGE));
    if (stored) {
      heatmapYear = stored;
    }
  } catch (err) {
    console.warn("No se pudo leer año del heatmap", err);
  }
}

function saveHeatmapYear() {
  try {
    localStorage.setItem(HEATMAP_YEAR_STORAGE, String(heatmapYear));
  } catch (err) {
    console.warn("No se pudo guardar año del heatmap", err);
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
  return getHabitDayScore(habit, dateKey).hasActivity;
}

function countCompletedHabitsForDate(dateKey) {
  return activeHabits().reduce((acc, habit) => (isHabitCompletedOnDate(habit, dateKey) ? acc + 1 : acc), 0);
}

function collectHabitActivityDatesSet(habit) {
  const dates = new Set();
  if (!habit || habit.archived) return dates;
  const checks = habitChecks[habit.id] || {};
  Object.keys(checks).forEach((key) => dates.add(key));
  Object.values(habitSessions).forEach((s) => {
    if (!isSessionActive(s) || s.habitId !== habit.id) return;
    const key = getSessionDateKey(s);
    if (key) dates.add(key);
  });
  return dates;
}

function countHabitActivityDays(habit) {
  return collectHabitActivityDatesSet(habit).size;
}

function getHabitDayScore(habit, dateKey) {
  if (!habit || habit.archived) return { score: 0, minutes: 0, checked: false, hasActivity: false };
  const checked = !!(habitChecks[habit.id] && habitChecks[habit.id][dateKey]);
  const minutes = getSessionsForHabitDate(habit.id, dateKey).reduce((acc, s) => acc + minutesFromSession(s), 0);
  const timeScore = Math.min(3, Math.floor(minutes / 30));
  const score = (checked ? 1 : 0) + timeScore;
  return { score, minutes, checked, hasActivity: checked || minutes > 0 };
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

function buildYearCells(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const offset = (start.getDay() + 6) % 7; // lunes = 0
  const cells = [];
  for (let i = 0; i < offset; i++) {
    cells.push({ out: true });
  }
  let cursor = new Date(start);
  while (cursor < end) {
    cells.push({ out: false, key: dateKeyLocal(cursor) });
    cursor = addDays(cursor, 1);
  }
  const remainder = cells.length % 7;
  if (remainder) {
    for (let i = 0; i < 7 - remainder; i++) cells.push({ out: true });
  }
  return cells;
}

function getGlobalDayScore(dateKey) {
  let score = 0;
  let totalMinutes = 0;
  let active = 0;
  activeHabits()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((habit) => {
    const data = getHabitDayScore(habit, dateKey);
    totalMinutes += data.minutes;
    score += data.score;
    if (data.hasActivity) active += 1;
  });
  return { score, totalMinutes, activeHabits: active };
}

function scoreToHeatLevel(score) {
  if (score >= 8) return 4;
  if (score >= 5) return 3;
  if (score >= 2) return 2;
  return score > 0 ? 1 : 0;
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
const $habitKpiMinutesToday = document.getElementById("habit-kpi-minutes-today");
const $habitKpiMinutesWeek = document.getElementById("habit-kpi-minutes-week");
const $habitKpiMinutesMonth = document.getElementById("habit-kpi-minutes-month");
const $habitKpiMinutesYear = document.getElementById("habit-kpi-minutes-year");
const $habitKpiTotalTime = document.getElementById("habit-kpi-total-time");
const $habitKpiActiveDaysYear = document.getElementById("habit-kpi-active-days-year");
const $habitKpiStreak = document.getElementById("habit-kpi-streak");
const $habitKpiStreakLabel = document.getElementById("habit-kpi-streak-label");
const $habitLineCard = document.getElementById("habit-line-card");
const $habitLineChart = document.getElementById("habit-line-chart");
const $habitLineEmpty = document.getElementById("habit-line-empty");
const $habitLineSub = document.getElementById("habit-line-sub");
const $habitEvoSelect = document.getElementById("habit-evo-select");
const $habitEvoRange = document.getElementById("habit-evo-range");
const $habitLineTotal = document.getElementById("habit-line-total");
const $habitLineDays = document.getElementById("habit-line-days");
const $habitGlobalHeatmap = document.getElementById("habit-global-heatmap");
const $habitHeatmapYear = document.getElementById("habit-heatmap-year");
const $habitHeatmapSub = document.getElementById("habit-heatmap-sub");
const $habitHeatmapPrev = document.getElementById("habit-heatmap-prev");
const $habitHeatmapNext = document.getElementById("habit-heatmap-next");
const $habitRankingWeek = document.getElementById("habit-ranking-week");
const $habitRankingMonth = document.getElementById("habit-ranking-month");
const $habitRankingConsistency = document.getElementById("habit-ranking-consistency");
const $habitTotalsList = document.getElementById("habit-totals-list");
const $habitAccWeekMeta = document.getElementById("habit-acc-week-meta");
const $habitAccMonthMeta = document.getElementById("habit-acc-month-meta");
const $habitAccTotalMeta = document.getElementById("habit-acc-total-meta");
const $habitAccConsistencyMeta = document.getElementById("habit-acc-consistency-meta");
const $habitAccDaysMeta = document.getElementById("habit-acc-days-meta");
const $habitDonut = document.getElementById("habit-donut");
const $habitDonutLegend = document.getElementById("habit-donut-legend");
const $habitDonutCenter = document.getElementById("habit-donut-center");
const $habitDonutEmpty = document.getElementById("habit-donut-empty");
const $habitDonutSub = document.getElementById("habit-donut-sub");
const $habitDonutTotal = document.querySelector("#habit-donut-center .habit-donut-total");
const $habitRangeButtons = document.querySelectorAll(".habit-range-btn");
const $habitDaysRangeButtons = document.querySelectorAll(".habit-days-range-btn");
const $habitFab = document.getElementById("habit-session-toggle");
const $habitOverlay = document.getElementById("habit-session-overlay");
const $habitOverlayTime = document.getElementById("habit-session-time");
const $habitOverlayStop = document.getElementById("habit-session-stop");
const $habitDaysList = document.getElementById("habit-days-list");

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
  $habitColor.value = habit && habit.color ? habit.color : DEFAULT_COLOR;
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
  const color = $habitColor.value || DEFAULT_COLOR;
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
  wrap.appendChild(edit);
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
      const streak = computeHabitCurrentStreak(habit);
      const daysDone = countHabitActivityDays(habit);
      const scheduleLabel = habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día";
      const metaText = minutesToday ? `${scheduleLabel} · ${formatMinutes(minutesToday)} hoy` : scheduleLabel;
      const card = document.createElement("div");
      card.className = "habit-card";
      if (hasActivity) card.classList.add("is-done");
      card.setAttribute("role", "button");
      card.tabIndex = 0;
      setHabitColorVars(card, habit);

      const left = document.createElement("div");
      left.className = "habit-card-left";
      left.innerHTML = `
        <div class="habit-emoji">${habit.emoji || "🏷️"}</div>
        <div>
          <div class="habit-name">${habit.name}</div>
          <div class="habit-meta-row">
            <div class="habit-meta">${metaText}</div>
            <div class="habit-streak" title="Racha actual">🔥 ${streak}</div>
          </div>
          <div class="habit-meta habit-days-done">Hecho: ${daysDone} día${daysDone === 1 ? "" : "s"}</div>
        </div>
      `;

      const fireBtn = document.createElement("button");
      fireBtn.className = "habit-fire";
      fireBtn.textContent = "🔥";
      fireBtn.setAttribute("aria-pressed", String(hasActivity));
      fireBtn.setAttribute("aria-label", doneCheck ? "Desmarcar como hecho hoy" : "Marcar como hecho hoy");
      fireBtn.title = doneCheck ? "Quitar hecho hoy" : "Marcar como hecho hoy";
      fireBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        toggleDay(habit.id, today);
      });
      if (hasActivity) fireBtn.classList.add("is-done");

      card.addEventListener("click", () => openHabitModal(habit));
      card.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openHabitModal(habit);
        }
      });

      card.appendChild(left);
      card.appendChild(fireBtn);

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
      const daysDone = countHabitActivityDays(habit);
      const card = document.createElement("div");
      card.className = "habit-week-card";
      setHabitColorVars(card, habit);
      const header = document.createElement("div");
      header.className = "habit-week-header";
      header.innerHTML = `
        <div class="habit-card-left">
          <div class="habit-emoji">${habit.emoji || "🏷️"}</div>
          <div>
            <div class="habit-name">${habit.name}</div>
            <div class="habit-meta">${habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día"}</div>
            <div class="habit-meta habit-days-done">Hecho: ${daysDone} día${daysDone === 1 ? "" : "s"}</div>
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
  const year = heatmapYear;
  const cells = buildYearCells(year);
  activeHabits().forEach((habit) => {
    any = true;
    const daysDone = countHabitActivityDays(habit);
    const card = document.createElement("div");
    card.className = "habit-heatmap-card";
    setHabitColorVars(card, habit);
    card.innerHTML = `
      <div class="habit-heatmap-header">
        <div class="habit-emoji">${habit.emoji || "🏷️"}</div>
        <div>
          <div class="habit-name">${habit.name}</div>
          <div class="habit-meta">Año ${year} · Hecho: ${daysDone} día${daysDone === 1 ? "" : "s"}</div>
        </div>
      </div>
    `;
    card.querySelector(".habit-heatmap-header").appendChild(createHabitActions(habit));
    const grid = document.createElement("div");
    grid.className = "habit-annual-heatmap habit-annual-heatmap--dots";
    cells.forEach((cellData) => {
      const dot = document.createElement("div");
      dot.className = "habit-heatmap-cell";
      setHabitColorVars(dot, habit);
      if (!cellData.key) {
        dot.classList.add("is-out");
      } else {
        const dayData = getHabitDayScore(habit, cellData.key);
        const level = Math.min(4, dayData.score);
        dot.dataset.level = String(level);
        dot.classList.add(`heat-level-${level}`);
        dot.title = `${cellData.key} · ${dayData.checked ? "Check" : "Sin check"} · ${formatMinutes(dayData.minutes)}`;
      }
      grid.appendChild(dot);
    });
    const scroll = document.createElement("div");
    scroll.className = "habit-heatmap-scroll";
    scroll.appendChild(grid);
    card.appendChild(scroll);
    $habitHistoryList.appendChild(card);
  });

  $habitHistoryEmpty.style.display = any ? "none" : "block";
}

function ensureHabitLineTooltip() {
  if (!habitLineTooltip) {
    habitLineTooltip = document.createElement("div");
    habitLineTooltip.className = "habit-line-tooltip hidden";
    $habitLineChart?.parentElement?.appendChild(habitLineTooltip);
  }
  return habitLineTooltip;
}

function formatLineTooltip(point, isTotal) {
  if (!point) return "";
  const parts = [`${formatShortDate(point.dateKey, true)} · ${formatMinutes(point.minutes)}`];
  if (isTotal && point.perHabit?.length) {
    const tops = point.perHabit.slice(0, 2).map((p) => `${p.habit.name} ${formatMinutes(p.minutes)}`).join(" · ");
    if (tops) parts.push(tops);
  }
  return parts.join(" · ");
}

function formatShortDate(dateKey, withYear = false) {
  if (!dateKey) return "";
  const date = parseDateKey(dateKey);
  if (!date) return dateKey;
  const opts = { day: "numeric", month: "short" };
  if (withYear) opts.year = "numeric";
  return date.toLocaleDateString("es-ES", opts).replace(".", "");
}

function buildSmoothPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const smoothing = 0.18;
  const command = (current, previous, next, prevPrev) => {
    const p0 = prevPrev || previous;
    const p1 = previous;
    const p2 = current;
    const p3 = next || current;
    const cp1x = p1.x + (p2.x - p0.x) * smoothing;
    const cp1y = p1.y + (p2.y - p0.y) * smoothing;
    const cp2x = p2.x - (p3.x - p1.x) * smoothing;
    const cp2y = p2.y - (p3.y - p1.y) * smoothing;
    return `C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2.x} ${p2.y}`;
  };
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length; i++) {
    d += ` ${command(points[i], points[i - 1], points[i + 1], points[i - 2])}`;
  }
  return d;
}

function getNeutralLineColor() {
  const style = getComputedStyle(document.documentElement);
  return (style.getPropertyValue("--txt-soft") || "#a5afc7").trim();
}

function renderHabitLineSelector() {
  if (!$habitEvoSelect) return;
  const previous = habitLineHabit || "total";
  const selectedValue = $habitEvoSelect.value || previous;
  $habitEvoSelect.innerHTML = "";

  const addOption = (value, label, color) => {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    if (color) opt.dataset.color = color;
    $habitEvoSelect.appendChild(opt);
  };

  addOption("total", "Total (todos)", getNeutralLineColor());
  const active = activeHabits()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  active.forEach((habit) => addOption(habit.id, `${habit.emoji || "🏷️"} ${habit.name}`, resolveHabitColor(habit)));

  const exists = selectedValue === "total" || active.some((h) => h.id === selectedValue);
  habitLineHabit = exists ? selectedValue : "total";
  $habitEvoSelect.value = habitLineHabit;
}

function renderLineChart() {
  if (!$habitLineChart) return;
  if ($habitEvoRange) $habitEvoRange.value = habitLineRange;
  renderHabitLineSelector();
  const selectedHabit = habitLineHabit === "total" ? null : habits[habitLineHabit];
  if (habitLineHabit !== "total" && (!selectedHabit || selectedHabit.archived)) {
    habitLineHabit = "total";
    if ($habitEvoSelect) $habitEvoSelect.value = "total";
  }
  const { points, maxValue } = buildLineSeries(habitLineHabit, habitLineRange);
  const hasData = points.some((p) => p.minutes > 0 || p.hasActivity);
  const habitLabel = habitLineHabit === "total" ? "Total" : (selectedHabit?.name || "—");
  const rangeLabel = (() => {
    switch (habitLineRange) {
      case "30d": return "Últimos 30 días";
      case "90d": return "Últimos 90 días";
      case "year": return `Año ${heatmapYear}`;
      case "total": return "Total";
      default: return "Últimos 7 días";
    }
  })();
  if ($habitLineSub) $habitLineSub.textContent = `${rangeLabel} · ${habitLabel}`;
  const totalMinutes = points.reduce((acc, p) => acc + p.minutes, 0);
  const activeDays = points.filter((p) => p.hasActivity).length;
  const totalDays = points.length;
  if ($habitLineTotal) $habitLineTotal.textContent = formatMinutes(totalMinutes);
  if ($habitLineDays) {
    if (["7d", "30d", "90d"].includes(habitLineRange)) {
      $habitLineDays.textContent = `${activeDays}/${totalDays} días`;
    } else {
      $habitLineDays.textContent = `${activeDays} día${activeDays === 1 ? "" : "s"}`;
    }
  }
  $habitLineChart.innerHTML = "";
  if ($habitLineEmpty) $habitLineEmpty.style.display = hasData ? "none" : "block";
  if (!points.length || !hasData) return;

  const width = Math.max(260, $habitLineChart.clientWidth || 320);
  const height = 220;
  const padding = 24;
  const usableWidth = width - padding * 2;
  const usableHeight = height - padding * 2;
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0;
  const maxScale = Math.max(maxValue, 10);
  const lineColor = habitLineHabit === "total" ? getNeutralLineColor() : resolveHabitColor(selectedHabit);
  if ($habitLineCard) {
    if (habitLineHabit === "total") {
      const neutral = getNeutralLineColor();
      $habitLineCard.style.setProperty("--hclr", neutral);
      $habitLineCard.style.setProperty("--hclr-rgb", hexToRgbString(neutral));
    } else {
      setHabitColorVars($habitLineCard, selectedHabit);
    }
  }

  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("preserveAspectRatio", "none");
  svg.classList.add("habit-line-svg");

  const plotPoints = points.map((p, idx) => {
    const x = padding + idx * step;
    const y = padding + (1 - (p.minutes / maxScale || 0)) * usableHeight;
    return { ...p, x, y };
  });

  const gradientId = `habit-line-gradient-${habitLineHabit}-${habitLineRange}`;
  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const gradient = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
  gradient.setAttribute("id", gradientId);
  gradient.setAttribute("x1", "0");
  gradient.setAttribute("x2", "0");
  gradient.setAttribute("y1", "0");
  gradient.setAttribute("y2", "1");
  const stop1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stop1.setAttribute("offset", "0%");
  stop1.setAttribute("stop-color", lineColor);
  stop1.setAttribute("stop-opacity", "0.35");
  const stop2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
  stop2.setAttribute("offset", "100%");
  stop2.setAttribute("stop-color", lineColor);
  stop2.setAttribute("stop-opacity", "0");
  gradient.appendChild(stop1);
  gradient.appendChild(stop2);
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "habit-line-glow");
  filter.innerHTML = `<feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="${lineColor}" flood-opacity="0.25" />`;
  defs.appendChild(gradient);
  defs.appendChild(filter);
  svg.appendChild(defs);

  const smoothPath = buildSmoothPath(plotPoints);
  // area
  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  area.setAttribute("d", `${smoothPath} L ${plotPoints[plotPoints.length - 1].x} ${height - padding} L ${plotPoints[0].x} ${height - padding} Z`);
  area.setAttribute("fill", `url(#${gradientId})`);
  area.setAttribute("stroke", "none");
  svg.appendChild(area);

  // line
  const line = document.createElementNS("http://www.w3.org/2000/svg", "path");
  line.setAttribute("d", smoothPath);
  line.setAttribute("fill", "none");
  line.setAttribute("stroke", lineColor);
  line.setAttribute("stroke-width", 3);
  line.setAttribute("stroke-linecap", "round");
  line.setAttribute("stroke-linejoin", "round");
  line.setAttribute("filter", "url(#habit-line-glow)");
  svg.appendChild(line);

  // axis labels
  const labelIndexes = new Set([0, Math.floor(plotPoints.length / 2), plotPoints.length - 1]);
  const labels = Array.from(labelIndexes).map((idx) => plotPoints[idx]).filter(Boolean);
  labels.forEach((p) => {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", p.x);
    text.setAttribute("y", height - padding + 16);
    text.setAttribute("text-anchor", "middle");
    text.classList.add("habit-line-label");
    text.textContent = formatShortDate(p.dateKey);
    svg.appendChild(text);
  });

  const lastPoint = plotPoints[plotPoints.length - 1];
  const lastDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  lastDot.setAttribute("cx", lastPoint.x);
  lastDot.setAttribute("cy", lastPoint.y);
  lastDot.setAttribute("r", 5);
  lastDot.classList.add("habit-line-dot");
  lastDot.setAttribute("fill", lineColor);
  lastDot.setAttribute("stroke", "#fff");
  lastDot.setAttribute("stroke-width", 1.5);
  svg.appendChild(lastDot);

  const cursorDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  cursorDot.setAttribute("r", 6);
  cursorDot.classList.add("habit-line-dot", "habit-line-dot--cursor");
  cursorDot.setAttribute("fill", lineColor);
  cursorDot.setAttribute("stroke", "#fff");
  cursorDot.setAttribute("stroke-width", 2);
  cursorDot.style.opacity = "0";
  svg.appendChild(cursorDot);

  $habitLineChart.appendChild(svg);

  const tooltip = ensureHabitLineTooltip();
  const handlePointer = (evt) => {
    const rect = svg.getBoundingClientRect();
    const x = evt.clientX - rect.left;
    let nearest = plotPoints[0];
    plotPoints.forEach((p) => {
      if (Math.abs(p.x - x) < Math.abs(nearest.x - x)) nearest = p;
    });
    tooltip.textContent = formatLineTooltip(nearest, habitLineHabit === "total");
    const scaleX = rect.width / width;
    const scaleY = rect.height / height;
    const left = nearest.x * scaleX;
    const top = nearest.y * scaleY;
    const clampedLeft = Math.max(10, Math.min(rect.width - 10, left));
    tooltip.style.left = `${clampedLeft}px`;
    tooltip.style.top = `${top - 10}px`;
    tooltip.classList.remove("hidden");
    cursorDot.setAttribute("cx", nearest.x);
    cursorDot.setAttribute("cy", nearest.y);
    cursorDot.style.opacity = "1";
  };
  svg.addEventListener("pointermove", handlePointer);
  svg.addEventListener("pointerdown", handlePointer);
  svg.addEventListener("pointerleave", () => {
    tooltip.classList.add("hidden");
    cursorDot.style.opacity = "0";
  });
}

function getDaysRangeBounds(range) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  switch (range) {
    case "week":
      return { start: addDays(end, -6), end };
    case "month":
      return { start: new Date(today.getFullYear(), today.getMonth(), 1), end };
    case "year":
      return { start: new Date(heatmapYear, 0, 1), end: new Date(heatmapYear, 11, 31, 23, 59, 59, 999) };
    case "total":
      return { start: new Date(0), end };
    default:
      return { start: new Date(today.getFullYear(), today.getMonth(), today.getDate()), end };
  }
}

function daysRangeLabel(range) {
  switch (range) {
    case "week": return "Semana";
    case "month": return "Mes";
    case "year": return "Año";
    case "total": return "Total";
    default: return "Día";
  }
}

function renderDaysAccordion() {
  if (!$habitDaysList) return;
  const { start, end } = getDaysRangeBounds(habitDaysRange);
  const data = activeHabits()
    .map((habit) => ({
      habit,
      days: collectHabitActiveDates(habit, start, end)
    }))
    .sort((a, b) => b.days - a.days);

  $habitDaysList.innerHTML = "";
  if ($habitAccDaysMeta) {
    const totalDays = data.reduce((acc, item) => acc + item.days, 0);
    $habitAccDaysMeta.textContent = `${daysRangeLabel(habitDaysRange)} · ${data.length} hábito${data.length === 1 ? "" : "s"} · ${totalDays} día${totalDays === 1 ? "" : "s"}`;
  }

  if (!data.length) {
    const empty = document.createElement("div");
    empty.className = "habit-ranking-empty";
    empty.textContent = "Crea un hábito para ver datos";
    $habitDaysList.appendChild(empty);
    return;
  }

  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "habit-ranking-item";
    setHabitColorVars(div, item.habit);
    const left = document.createElement("div");
    left.className = "habit-card-left";
    left.innerHTML = `
      <div class="habit-emoji">${item.habit.emoji || "🏷️"}</div>
      <div>
        <div class="habit-name">${item.habit.name}</div>
        <div class="habit-consistency">Hecho: ${item.days} día${item.days === 1 ? "" : "s"}</div>
      </div>
    `;
    const value = document.createElement("div");
    value.className = "habit-kpi-value";
    value.textContent = `${item.days} día${item.days === 1 ? "" : "s"}`;
    const right = document.createElement("div");
    right.className = "habit-card-right";
    right.appendChild(value);
    right.appendChild(createHabitActions(item.habit));
    div.appendChild(left);
    div.appendChild(right);
    $habitDaysList.appendChild(div);
  });
}

function renderGlobalHeatmap() {
  $habitGlobalHeatmap.innerHTML = "";
  const cells = buildYearCells(heatmapYear);
  let activeDays = 0;
  cells.forEach((cellData) => {
    const key = cellData.key;
    const cell = document.createElement("div");
    cell.className = "habit-heatmap-cell";
    if (!key) {
      cell.classList.add("is-out");
    } else {
      const { score, totalMinutes, activeHabits: active } = getGlobalDayScore(key);
      const level = scoreToHeatLevel(score);
      if (level > 0) {
        cell.classList.add(`heat-level-${level}`);
        activeDays += 1;
      }
      cell.title = `${key} · ${active} hábitos con actividad · ${formatMinutes(totalMinutes)}`;
    }
    $habitGlobalHeatmap.appendChild(cell);
  });
  if ($habitHeatmapYear) $habitHeatmapYear.textContent = heatmapYear;
  if ($habitHeatmapSub) $habitHeatmapSub.textContent = `Año ${heatmapYear} · ${activeDays} días con actividad`;
  updateHeatmapYearControls();
  saveHeatmapYear();
}

function updateHeatmapYearControls() {
  if (!$habitHeatmapPrev || !$habitHeatmapNext) return;
  $habitHeatmapPrev.disabled = false;
  $habitHeatmapNext.disabled = false;
}

function changeHeatmapYear(delta) {
  heatmapYear = heatmapYear + delta;
  saveHeatmapYear();
  renderGlobalHeatmap();
  renderHistory();
  renderLineChart();
  renderDaysAccordion();
}

function renderRanking() {
  const weekData = minutesByHabitRange("week");
  const monthData = minutesByHabitRange("month");
  const consistency = consistencyByHabit(30);
  renderRankingList($habitRankingWeek, weekData, "min");
  renderRankingList($habitRankingMonth, monthData, "min");
  renderRankingList($habitRankingConsistency, consistency, "%");
  updateAccordionMeta($habitAccWeekMeta, weekData);
  updateAccordionMeta($habitAccMonthMeta, monthData);
  updateAccordionMeta($habitAccConsistencyMeta, consistency, "consistency");
  renderTotalsList();
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

function minutesByHabitRange(range) {
  const { start, end } = getRangeBounds(range);
  const res = [];
  activeHabits().forEach((habit) => {
    const minutes = minutesForHabitRange(habit, start, end);
    const daysActive = collectHabitActiveDates(habit, start, end);
    res.push({ habit, value: minutes, daysActive });
  });
  const filtered = res.filter((item) => item.value > 0);
  return filtered.sort((a, b) => b.value - a.value).slice(0, 5);
}

function minutesForHabitRange(habit, start, end) {
  let totalMinutes = 0;
  Object.values(habitSessions).forEach((s) => {
    if (!isSessionActive(s) || s.habitId !== habit.id) return;
    const date = getSessionDate(s);
    if (isDateInRange(date, start, end)) totalMinutes += minutesFromSession(s);
  });
  return totalMinutes;
}

function collectHabitActiveDates(habit, start, end) {
  const dates = new Set();
  const checks = habitChecks[habit.id] || {};
  Object.keys(checks).forEach((key) => {
    const parsed = parseDateKey(key);
    if (parsed && isDateInRange(parsed, start, end)) dates.add(key);
  });
  Object.values(habitSessions).forEach((s) => {
    if (!isSessionActive(s) || s.habitId !== habit.id) return;
    const date = getSessionDate(s);
    const key = getSessionDateKey(s);
    if (date && key && isDateInRange(date, start, end)) dates.add(key);
  });
  return dates.size;
}

function minutesForRange(range) {
  const { start, end } = getRangeBounds(range);
  return Object.values(habitSessions).reduce((acc, s) => {
    if (!isSessionActive(s)) return acc;
    const date = getSessionDate(s);
    if (isDateInRange(date, start, end)) return acc + minutesFromSession(s);
    return acc;
  }, 0);
}

function countActiveDaysInYear(year = new Date().getFullYear()) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31, 23, 59, 59, 999);
  const dates = new Set();
  Object.entries(habitChecks).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end)) dates.add(key);
    });
  });
  Object.values(habitSessions).forEach((s) => {
    if (!isSessionActive(s)) return;
    const date = getSessionDate(s);
    const key = getSessionDateKey(s);
    if (date && key && isDateInRange(date, start, end)) dates.add(key);
  });
  return dates.size;
}

function getEarliestActivityDate() {
  const today = new Date();
  let earliest = today;
  Object.entries(habitChecks).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && parsed < earliest) earliest = parsed;
    });
  });
  Object.values(habitSessions).forEach((s) => {
    if (!isSessionActive(s)) return;
    const date = getSessionDate(s);
    if (date && date < earliest) earliest = date;
  });
  return earliest;
}

function getLineRangeBounds(range) {
  const today = new Date();
  const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59, 999);
  switch (range) {
    case "30d":
      return { start: addDays(end, -29), end };
    case "90d":
      return { start: addDays(end, -89), end };
    case "year":
      return { start: new Date(heatmapYear, 0, 1), end: new Date(heatmapYear, 11, 31, 23, 59, 59, 999) };
    case "total": {
      const earliest = getEarliestActivityDate();
      return { start: earliest, end };
    }
    default:
      return { start: addDays(end, -6), end };
  }
}

function buildLineSeries(habitId, range) {
  const { start, end } = getLineRangeBounds(range);
  const today = new Date();
  const cappedEnd = end > today ? today : end;
  const points = [];
  const habitsList = activeHabits();
  for (let d = new Date(start); d <= cappedEnd; d = addDays(d, 1)) {
    const key = dateKeyLocal(d);
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (habitId === "total") {
      const perHabit = habitsList.map((habit) => {
        const minutes = getSessionsForHabitDate(habit.id, key).reduce((acc, s) => acc + minutesFromSession(s), 0);
        return { habit, minutes };
      }).filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
      const minutes = perHabit.reduce((acc, item) => acc + item.minutes, 0);
      const hasActivity = habitsList.some((h) => getHabitDayScore(h, key).hasActivity);
      points.push({ dateKey: key, date, minutes, perHabit, hasActivity });
    } else {
      const habit = habits[habitId];
      const dayScore = habit ? getHabitDayScore(habit, key) : { hasActivity: false, minutes: 0 };
      const minutes = getSessionsForHabitDate(habitId, key).reduce((acc, s) => acc + minutesFromSession(s), 0);
      points.push({ dateKey: key, date, minutes, perHabit: [], hasActivity: dayScore.hasActivity });
    }
  }
  const maxValue = points.reduce((acc, p) => Math.max(acc, p.minutes), 0);
  return { points, maxValue };
}

function timeShareByHabit(range) {
  const { start, end } = getRangeBounds(range);
  return activeHabits()
    .map((habit) => ({
      habit,
      minutes: minutesForHabitRange(habit, start, end)
    }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function rangeLabel(range) {
  switch (range) {
    case "week":
      return "semanal";
    case "month":
      return "mensual";
    case "year":
      return "anual";
    case "total":
      return "total";
    default:
      return "diaria";
  }
}

function totalsByHabit(range) {
  const { start, end } = getRangeBounds(range);
  return activeHabits()
    .map((habit) => {
      const minutes = minutesForHabitRange(habit, start, end);
      const daysActive = collectHabitActiveDates(habit, start, end);
      const streak = computeHabitCurrentStreak(habit);
      return { habit, minutes, daysActive, streak };
    })
    .filter((item) => item.minutes > 0 || item.daysActive > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function updateAccordionMeta(el, items, type = "minutes") {
  if (!el) return;
  if (!items || !items.length) {
    el.textContent = "Sin datos";
    return;
  }
  if (type === "consistency") {
    el.textContent = `${items[0].value}% máx`;
    return;
  }
  const totalMinutes = items.reduce((acc, item) => acc + (item.value || item.minutes || 0), 0);
  el.textContent = `${items.length} hábito${items.length !== 1 ? "s" : ""} · ${formatMinutes(totalMinutes)}`;
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
    setHabitColorVars(div, item.habit);
    const totalDays = countHabitActivityDays(item.habit);
    const left = document.createElement("div");
    left.className = "habit-card-left";
    left.innerHTML = `
      <div class="habit-emoji">${item.habit.emoji || "🏷️"}</div>
      <div>
        <div class="habit-name">${item.habit.name}</div>
        <div class="habit-consistency">${unit === "%" ? "Consistencia" : `Días activos: ${item.daysActive || 0}`}</div>
        <div class="habit-meta habit-days-done">Hecho: ${totalDays} día${totalDays === 1 ? "" : "s"}</div>
      </div>
    `;
    const value = document.createElement("div");
    value.className = "habit-kpi-value";
    value.textContent = unit === "%" ? `${item.value}%` : formatMinutes(item.value);

    const right = document.createElement("div");
    right.className = "habit-card-right";
    right.appendChild(value);
    right.appendChild(createHabitActions(item.habit));

    div.appendChild(left);
    div.appendChild(right);
    container.appendChild(div);
  });
}

function renderTotalsList() {
  if (!$habitTotalsList) return;
  const data = totalsByHabit(habitDonutRange);
  updateAccordionMeta($habitAccTotalMeta, data);
  $habitTotalsList.innerHTML = "";
  if (!data.length) {
    const empty = document.createElement("div");
    empty.className = "habit-ranking-empty";
    empty.textContent = "Sin datos en este rango";
    $habitTotalsList.appendChild(empty);
    return;
  }
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "habit-ranking-item habit-total-item";
    setHabitColorVars(div, item.habit);
    const totalDays = countHabitActivityDays(item.habit);
    const left = document.createElement("div");
    left.className = "habit-card-left";
    left.innerHTML = `
      <div class="habit-emoji">${item.habit.emoji || "🏷️"}</div>
      <div>
        <div class="habit-name">${item.habit.name}</div>
        <div class="habit-consistency">Días hecho: ${item.daysActive}${item.streak ? ` · Racha: ${item.streak}` : ""}</div>
        <div class="habit-meta habit-days-done">Total histórico: ${totalDays} día${totalDays === 1 ? "" : "s"}</div>
      </div>
    `;
    const value = document.createElement("div");
    value.className = "habit-kpi-value";
    value.textContent = formatMinutes(item.minutes);

    const right = document.createElement("div");
    right.className = "habit-card-right";
    right.appendChild(value);
    right.appendChild(createHabitActions(item.habit));

    div.appendChild(left);
    div.appendChild(right);
    $habitTotalsList.appendChild(div);
  });
}

function renderDonut() {
  if (!$habitDonut || typeof echarts === "undefined") return;
  const data = timeShareByHabit(habitDonutRange);
  const totalMinutes = data.reduce((acc, item) => acc + item.minutes, 0);
  const subtitle = `Distribución ${rangeLabel(habitDonutRange)}`;
  if ($habitDonutSub) $habitDonutSub.textContent = subtitle.charAt(0).toUpperCase() + subtitle.slice(1);

  if (!data.length || !totalMinutes) {
    if (habitDonutChart) habitDonutChart.clear();
    $habitDonut.style.display = "none";
    if ($habitDonutCenter) $habitDonutCenter.style.display = "none";
    if ($habitDonutLegend) $habitDonutLegend.innerHTML = "";
    if ($habitDonutEmpty) $habitDonutEmpty.style.display = "block";
    return;
  }

  if ($habitDonutEmpty) $habitDonutEmpty.style.display = "none";
  $habitDonut.style.display = "block";
  if ($habitDonutCenter) $habitDonutCenter.style.display = "flex";
  if (!habitDonutChart) habitDonutChart = echarts.init($habitDonut);
  if ($habitDonutTotal) $habitDonutTotal.textContent = formatMinutes(totalMinutes);

  const option = {
    tooltip: { trigger: "item", formatter: "{b}: {c}m ({d}%)" },
    color: data.map((item) => resolveHabitColor(item.habit)),
    series: [
      {
        type: "pie",
        radius: ["60%", "82%"],
        itemStyle: { borderWidth: 2, borderColor: "rgba(0,0,0,0.2)" },
        label: { show: false },
        data: data.map((item) => ({
          name: item.habit.name,
          value: item.minutes
        }))
      }
    ]
  };
  habitDonutChart.setOption(option);
  habitDonutChart.resize();
  renderDonutLegend(data, totalMinutes);
}

function renderDonutLegend(data, totalMinutes) {
  if (!$habitDonutLegend) return;
  $habitDonutLegend.innerHTML = "";
  data.forEach((item) => {
    const row = document.createElement("div");
    row.className = "habit-donut-legend-item";
    setHabitColorVars(row, item.habit);
    const pct = totalMinutes ? Math.round((item.minutes / totalMinutes) * 100) : 0;
    row.innerHTML = `
      <span class="legend-dot"></span>
      <div class="legend-text">
        <div class="legend-name">${item.habit.name}</div>
        <div class="legend-meta">${pct}% · ${formatMinutes(item.minutes)}</div>
      </div>
    `;
    $habitDonutLegend.appendChild(row);
  });
}

function renderKPIs() {
  const today = todayKey();
  $habitKpiToday.textContent = countCompletedHabitsForDate(today);
  if ($habitKpiMinutesToday) $habitKpiMinutesToday.textContent = formatMinutes(minutesForRange("day"));
  if ($habitKpiMinutesWeek) $habitKpiMinutesWeek.textContent = formatMinutes(minutesForRange("week"));
  if ($habitKpiMinutesMonth) $habitKpiMinutesMonth.textContent = formatMinutes(minutesForRange("month"));
  if ($habitKpiMinutesYear) $habitKpiMinutesYear.textContent = formatMinutes(minutesForRange("year"));
  if ($habitKpiTotalTime) $habitKpiTotalTime.textContent = formatMinutes(minutesForRange("total"));
  if ($habitKpiActiveDaysYear) $habitKpiActiveDaysYear.textContent = countActiveDaysInYear();
  const streakData = computeBestStreak();
  $habitKpiStreak.textContent = streakData.best;
  $habitKpiStreakLabel.textContent = streakData.label ? `${streakData.best} · ${streakData.label}` : "—";
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

function computeHabitCurrentStreak(habit, maxDays = 400) {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    const date = addDays(today, -i);
    const key = dateKeyLocal(date);
    const { hasActivity } = getHabitDayScore(habit, key);
    if (hasActivity) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
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

function renderHabits() {
  renderSubtabs();
  renderToday();
  renderWeek();
  renderHistory();
  renderKPIs();
  renderDonut();
  renderLineChart();
  renderGlobalHeatmap();
  renderRanking();
  renderDaysAccordion();
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
    setHabitColorVars($habitSessionLast, lastHabit);
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
      setHabitColorVars(item, habit);
      item.innerHTML = `
        <div class="habit-card-left">
          <div class="habit-emoji">${habit.emoji || "🏷️"}</div>
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

  $habitRangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      $habitRangeButtons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      habitDonutRange = btn.dataset.range || "day";
      renderDonut();
      renderTotalsList();
    });
  });

  $habitDaysRangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      $habitDaysRangeButtons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      habitDaysRange = btn.dataset.range || "day";
      renderDaysAccordion();
    });
  });

  $habitEvoSelect?.addEventListener("change", (e) => {
    habitLineHabit = e.target.value || "total";
    renderLineChart();
  });

  $habitEvoRange?.addEventListener("change", (e) => {
    habitLineRange = e.target.value || "7d";
    renderLineChart();
  });
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
  loadHeatmapYear();
  bindEvents();
  attachNavHook();
  listenRemote();
  renderHabits();
  if (runningSession) {
    sessionInterval = setInterval(updateSessionUI, 1000);
  }
  window.addEventListener("resize", () => {
    if (habitDonutChart) habitDonutChart.resize();
  });
}

// Autoinit
initHabits();
