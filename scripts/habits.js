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
  set,
  update,
  get,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { computeTimeByHabitDataset, debugComputeTimeByHabit, resolveFirstRecordTs } from "./time-by-habit.js";
import { buildCsv, downloadZip, sanitizeFileToken, triggerDownload } from "./export-utils.js";
import { computeDayCreditsAndScores } from "./schedule-credits.js";

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
const HABIT_COUNTS_PATH = "habitCounts";
const HABIT_GROUPS_PATH = "habitGroups";
const HABIT_PREFS_PATH = "habitPrefs";
const HABIT_COMPARE_SETTINGS_PATH = "habitsCompareSettings";
const HABITS_SCHEDULE_PATH = "habitsSchedule";
const HABIT_UI_UID = String(window.__bookshellUid || localStorage.getItem("bookshell.uid") || "default");
const HABIT_UI_PATH = `users/${HABIT_UI_UID}/ui`;
const HABIT_UI_QUICK_COUNTERS_PATH = `${HABIT_UI_PATH}/quickCounters`;

// Storage keys
const STORAGE_KEY = "bookshell-habits-cache";
const RUNNING_KEY = "bookshell-habit-running-session";
const LAST_HABIT_KEY = "bookshell-habits-last-used";
const HEATMAP_YEAR_STORAGE = "bookshell-habits-heatmap-year";
const HISTORY_RANGE_STORAGE = "bookshell-habits-history-range:v1";
const COMPARE_SETTINGS_STORAGE = "bookshell-habits-compare-settings:v1";
const HABITS_SCHEDULE_STORAGE = "bookshell-habits-schedule-cache:v1";
const HABITS_SCHEDULE_VIEW_MODE_STORAGE = "scheduleViewMode";
const HABITS_SCHEDULE_SCORE_MODE_STORAGE = "scheduleScoreMode";
const DEFAULT_COLOR = "#7f5dff";
const PARAM_EMPTY_LABEL = "Sin parámetro";
const PARAM_COLOR_PALETTE = [
  "#7f5dff",
  "#56b9ff",
  "#f59e0b",
  "#10b981",
  "#ef4444",
  "#c084fc",
  "#f97316",
  "#22d3ee",
  "#a3e635",
  "#f472b6"
];

// Sistema: tiempo no asignado (24h - tiempo registrado)
const DAY_SEC = 24 * 60 * 60;
const UNKNOWN_HABIT_ID = "h-unknown";
const UNKNOWN_HABIT_NAME = "Desconocido";
const UNKNOWN_HABIT_EMOJI = "❓";
const UNKNOWN_HABIT_COLOR = "#8b93a6"; // neutro
let _pendingShortcutCmd = null;


// Estado
let habits = {}; // {id: habit}
let habitChecks = {}; // { habitId: { dateKey: true } }
let habitSessions = {}; // { habitId: { dateKey: totalSec } }
let habitSessionTimeline = {}; // { habitId: [{startTs,endTs,durationSec,dateKey,source}] }
let habitSessionTimelineCoverage = {}; // { habitId: Set<dateKey> } days already backed by timestamped sessions
let habitCounts = {}; // { habitId: { dateKey: number } }
let habitGroups = {}; // { groupId: { id, name, createdAt } }
let habitPrefs = { pinCount: "", pinTime: "", quickSessions: [] };
let habitUI = { quickCounters: [] };
let activeTab = "today";
let runningSession = null; // { startTs }
let sessionInterval = null;
let pendingSessionDuration = 0;
let heatmapYear = new Date().getFullYear();
let habitHistoryRange = "week";
let habitHistoryMetric = "time";
let habitHistoryGroupMode = { kind: "habit", cat: null };
let historyCalYear = null;
let historyCalMonth = null;
let habitDeleteTarget = null;
let habitToastEl = null;
let habitToastTimeout = null;
let habitDonutChart = null;
let habitDonutRange = "total";
let habitDonutGroupMode = { kind: "habit" };
let habitLineRange = "7d";
let habitLineHabit = "total";
let habitDaysRange = "day";
let habitLineTooltip = null;
let habitEditingParams = [];
let selectedDateKey = todayKey();
let habitRecordsRange = "month";
let habitDetailId = null;
let habitDetailRange = "month";
let habitDetailDateKey = todayKey();
let habitDetailRecordsEntries = [];
let habitDetailRecordsPage = 1;
let habitDetailChartMode = "bar";
let habitDetailChartRange = "30d";
let habitDetailMonthCursor = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
let dayDominantCache = new Map();
let habitCompareMode = "day";
let habitCompareSort = "delta";
let habitCompareView = "detail";
let habitCompareScaleMode = "relative";
let habitCompareSelectionA = null;
let habitCompareSelectionB = null;
let habitCompareSectionsOpen = { orderView: false, scale: false, filters: false };
let habitCompareMarked = {};
let habitCompareHidden = {};
let habitCompareFilters = { type: "all", delta: "all", marked: "all" };
let habitStatsView = "MEAN";
let habitStatsGranularity = "day";
let habitStatsBaseMode = "CALENDAR";
let habitStatsSort = "desc";
const habitCompareAggregateCache = new Map();
const habitCompareAverageCache = new Map();
const habitStatsSeriesCache = new Map();
const habitStatsResultCache = new Map();
let dayDetailDateKey = todayKey();
let dayDetailFocusHabitId = null;
let scheduleState = createDefaultHabitSchedule();
let draftState = null;
let isEditingTemplates = false;
let scheduleEditorSelection = { type: "M", day: "base" };
let scheduleCalYear = null;
let scheduleCalMonth = null;
let scheduleTickInterval = null;
let scheduleAutoCloseInterval = null;
let scheduleConfigOpen = false;
let scheduleViewMode = loadScheduleViewMode();
let scheduleScoreMode = loadScheduleScoreMode();
let habitDetailScheduleSelection = { types: ["Libre"], dows: [] };
const habitDetailRecordsPageSize = 10;
let hasRenderedTodayOnce = false;
const DEBUG_HABITS_SYNC = (() => {
  try {
    return !!(window.__bookshellDebugHabitsSync || localStorage.getItem("bookshell.debug.habitsSync") === "1");
  } catch (_) {
    return !!window.__bookshellDebugHabitsSync;
  }
})();
const DEBUG_WORK_SHIFT = (() => {
  try {
    return !!(window.__bookshellDebugWorkShift || localStorage.getItem("bookshell.debug.workShift") === "1");
  } catch (_) {
    return !!window.__bookshellDebugWorkShift;
  }
})();
const DEBUG_COMPARE = (() => {
  try {
    return !!(window.__bookshellDebugCompare || localStorage.getItem("bookshell.debug.compare") === "1");
  } catch (_) {
    return !!window.__bookshellDebugCompare;
  }
})();

const pendingSessionWrites = new Map();
let habitHistoryDataVersion = 0;
let habitHistoryUpdatedAt = Date.now();
let compareLiveTick = 0;
let compareLiveInterval = null;
let compareRefreshRaf = null;
const reportDebugLastByRange = new Map();

function debugCompare(...args) {
  if (!DEBUG_COMPARE) return;
  console.log("[COMPARE]", ...args);
}

function debugReport(...args) {
  if (!DEBUG_COMPARE) return;
  console.log("[REPORT]", ...args);
}

function markHistoryDataChanged(reason = "unknown", details = null) {
  habitHistoryDataVersion += 1;
  habitHistoryUpdatedAt = Date.now();
  invalidateCompareCache();
  scheduleCompareRefresh(reason, details);
  debugCompare("history version bump", { reason, dataVersion: habitHistoryDataVersion, updatedAt: habitHistoryUpdatedAt, details });
}

function scheduleCompareRefresh(reason = "unknown", details = null) {
  if (compareRefreshRaf != null) return;
  compareRefreshRaf = window.requestAnimationFrame(() => {
    compareRefreshRaf = null;
    const habitsViewVisible = document.getElementById("view-habits")?.classList.contains("view-active");
    if (!habitsViewVisible) return;
    renderHistory();
    debugCompare("refresh", {
      reason,
      dataVersion: habitHistoryDataVersion,
      updatedAt: habitHistoryUpdatedAt,
      activeTab,
      details
    });
  });
}

function debugHabitsSync(...args) {
  if (!DEBUG_HABITS_SYNC) return;
  console.log("[habits:sync]", ...args);
}

function debugWorkShift(...args) {
  if (!DEBUG_WORK_SHIFT) return;
  console.log(...args);
}

function loadScheduleViewMode() {
  try {
    const saved = (localStorage.getItem(HABITS_SCHEDULE_VIEW_MODE_STORAGE) || "percent").trim();
    return saved === "time" ? "time" : "percent";
  } catch (_) {
    return "percent";
  }
}

function loadScheduleScoreMode() {
  try {
    const saved = (localStorage.getItem(HABITS_SCHEDULE_SCORE_MODE_STORAGE) || "").trim();
    return saved === "credits" ? "credits" : "plan";
  } catch (_) {
    return "plan";
  }
}

function persistScheduleScoreMode() {
  try {
    localStorage.setItem(HABITS_SCHEDULE_SCORE_MODE_STORAGE, scheduleScoreMode === "credits" ? "credits" : "plan");
  } catch (_) {
    // noop
  }
}

function ensureScheduleScoreModeDefault() {
  let hasSaved = false;
  try {
    hasSaved = !!localStorage.getItem(HABITS_SCHEDULE_SCORE_MODE_STORAGE);
  } catch (_) {
    hasSaved = true;
  }
  if (hasSaved) return;
  const mode = scheduleState?.settings?.scoreModeDefault === "credits" ? "credits" : "plan";
  scheduleScoreMode = mode;
  persistScheduleScoreMode();
}

function toggleScheduleScoreMode() {
  scheduleScoreMode = scheduleScoreMode === "plan" ? "credits" : "plan";
  persistScheduleScoreMode();
  return scheduleScoreMode;
}

function persistScheduleViewMode() {
  try {
    localStorage.setItem(HABITS_SCHEDULE_VIEW_MODE_STORAGE, scheduleViewMode === "time" ? "time" : "percent");
  } catch (_) {
    // noop: prefer in-memory session state when localStorage is unavailable
  }
}

function toggleScheduleViewMode() {
  scheduleViewMode = scheduleViewMode === "percent" ? "time" : "percent";
  persistScheduleViewMode();
  return scheduleViewMode;
}

function buildScheduleRowDetailLabel(row) {
  const metricIsCount = row?.info?.metric === "count";
  const done = Math.max(0, Math.round(Number(row?.done) || 0));
  const target = Math.max(0, Math.round(Number(row?.value) || 0));
  const exceeded = Math.max(0, Math.round(Number(row?.exceeded) || 0));
  const kind = row?.info?.kind || "goal";

  if (kind === "neutral") {
    return metricIsCount ? `${done}` : `${done}m`;
  }
  if (kind === "limit") {
    if (exceeded > 0) return metricIsCount ? `+${exceeded}` : `+${exceeded}m`;
    return metricIsCount ? `${done} / ${target}` : `${done}m / ${target}m`;
  }
  return metricIsCount ? `${done} / ${target}` : `${done}m / ${target}m`;
}

function updateScheduleRightSlots() {
  if (!$habitScheduleView) return;
  const view = scheduleViewMode === "time" ? "time" : "percent";
  $habitScheduleView.querySelectorAll('[data-role="schedule-right-slot"]').forEach((slot) => {
    const percentLabel = slot.getAttribute("data-label-percent") || "0%";
    const timeLabel = slot.getAttribute("data-label-time") || "—";
    const exceeded = slot.getAttribute("data-is-exceeded") === "1";
    slot.textContent = view === "time" ? timeLabel : percentLabel;
    slot.classList.toggle("is-danger", view === "time" && exceeded);
  });
  const toggleBtn = $habitScheduleView.querySelector('[data-role="schedule-view-toggle"]');
  if (toggleBtn) {
    const isTime = view === "time";
    toggleBtn.textContent = "% / tiempo";
    toggleBtn.setAttribute("aria-pressed", isTime ? "true" : "false");
    toggleBtn.setAttribute("data-mode", view);
  }
}

function buildWorkDayPayload(minutes, shift) {
  const payload = { min: Math.max(0, Math.round(Number(minutes) || 0)) };
  payload.totalSec = payload.min * 60;
  const normalizedShift = normalizeShiftValue(shift);
  if (normalizedShift) payload.shift = normalizedShift;
  return payload;
}

function sessionWriteKey(habitId, dateKey) {
  return `${habitId || ""}::${dateKey || ""}`;
}

function queuePendingSessionWrite(habitId, dateKey, value) {
  const key = sessionWriteKey(habitId, dateKey);
  pendingSessionWrites.set(key, { habitId, dateKey, value, ts: Date.now() });
}

function applyPendingSessionWrites(snapshotValue) {
  const now = Date.now();
  pendingSessionWrites.forEach((entry, key) => {
    if (!entry?.habitId || !entry?.dateKey) {
      pendingSessionWrites.delete(key);
      return;
    }
    if (now - entry.ts > 15000) {
      debugHabitsSync("pending write expired", entry);
      pendingSessionWrites.delete(key);
      return;
    }
    const current = snapshotValue?.[entry.habitId]?.[entry.dateKey];
    const currentJson = JSON.stringify(current ?? null);
    const pendingJson = JSON.stringify(entry.value ?? null);
    if (currentJson === pendingJson) {
      pendingSessionWrites.delete(key);
      return;
    }
    if (!snapshotValue[entry.habitId] || typeof snapshotValue[entry.habitId] !== "object") snapshotValue[entry.habitId] = {};
    snapshotValue[entry.habitId][entry.dateKey] = entry.value;
    debugHabitsSync("applied pending overlay", entry);
  });
}

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


function createDefaultHabitSchedule() {
  const emptyWeek = { mon: {}, tue: {}, wed: {}, thu: {}, fri: {}, sat: {}, sun: {} };
  return {
    schedules: {
      base: { M: {}, T: {}, Libre: {} },
      overrides: {
        M: { ...emptyWeek },
        T: { ...emptyWeek },
        Libre: { ...emptyWeek }
      }
    },
    settings: {
      dayCloseTime: "00:00",
      successThreshold: 70,
      creditRate: 1,
      creditAllocationOrder: ["goals", "limits"],
      scoreModeDefault: "plan",
      allowCreditsOutsideTemplate: false,
      netScoreEnabled: false
    },
    summaries: {}
  };
}

function normalizeHabitSchedule(raw) {
  const defaults = createDefaultHabitSchedule();
  const out = {
    schedules: {
      base: { ...defaults.schedules.base },
      overrides: {
        M: { ...defaults.schedules.overrides.M },
        T: { ...defaults.schedules.overrides.T },
        Libre: { ...defaults.schedules.overrides.Libre }
      }
    },
    settings: { ...defaults.settings },
    summaries: {}
  };
  if (!raw || typeof raw !== "object") return out;

  const normalizeEntry = (entry) => {
    if (entry == null) return null;
    if (typeof entry === "number") {
      const n = Math.max(0, Math.round(Number(entry) || 0));
      return n > 0 ? { mode: "targetMin", value: n } : null;
    }
    if (typeof entry !== "object") return null;
    const mode = String(entry.mode || "neutral");
    if (!["targetMin", "targetCount", "limitMin", "limitCount", "neutral"].includes(mode)) return null;
    const value = Math.max(0, Math.round(Number(entry.value) || 0));
    if (mode === "neutral") return { mode, value: 0 };
    return value > 0 ? { mode, value } : null;
  };

  const normalizeTemplateMap = (src) => {
    const normalized = {};
    Object.entries(src || {}).forEach(([habitId, rawEntry]) => {
      const entry = normalizeEntry(rawEntry);
      if (habitId && entry) normalized[habitId] = entry;
    });
    return normalized;
  };

  const inBase = raw.schedules?.base || {};
  ["M", "T", "Libre"].forEach((type) => {
    out.schedules.base[type] = normalizeTemplateMap(inBase?.[type]);
  });

  const inOverrides = raw.schedules?.overrides || {};
  ["M", "T", "Libre"].forEach((type) => {
    const dayMap = inOverrides?.[type] || {};
    ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].forEach((dayKey) => {
      out.schedules.overrides[type][dayKey] = normalizeTemplateMap(dayMap?.[dayKey]);
    });
  });

  const closeTime = String(raw.settings?.dayCloseTime || defaults.settings.dayCloseTime);
  out.settings.dayCloseTime = /^\d{2}:\d{2}$/.test(closeTime) ? closeTime : defaults.settings.dayCloseTime;
  const threshold = Number(raw.settings?.successThreshold);
  out.settings.successThreshold = Number.isFinite(threshold) ? Math.max(1, Math.min(100, Math.round(threshold))) : defaults.settings.successThreshold;
  const creditRate = Number(raw.settings?.creditRate);
  out.settings.creditRate = Number.isFinite(creditRate) && creditRate >= 0 ? creditRate : defaults.settings.creditRate;
  const orderRaw = Array.isArray(raw.settings?.creditAllocationOrder) ? raw.settings.creditAllocationOrder : defaults.settings.creditAllocationOrder;
  const normalizedOrder = orderRaw
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item === "goals" || item === "limits");
  out.settings.creditAllocationOrder = Array.from(new Set(normalizedOrder.concat(["goals", "limits"]))).slice(0, 2);
  out.settings.scoreModeDefault = raw.settings?.scoreModeDefault === "credits" ? "credits" : defaults.settings.scoreModeDefault;
  out.settings.allowCreditsOutsideTemplate = !!raw.settings?.allowCreditsOutsideTemplate;
  out.settings.netScoreEnabled = !!raw.settings?.netScoreEnabled;

  if (raw.summaries && typeof raw.summaries === "object") {
    out.summaries = raw.summaries;
  }

  return out;
}

function scheduleWeekdayKey(date = new Date()) {
  const idx = (date.getDay() + 6) % 7;
  return ["mon", "tue", "wed", "thu", "fri", "sat", "sun"][idx];
}

function scheduleShiftTypeForDate(dateKey = todayKey()) {
  const shift = getShiftForDate(dateKey)?.shift;
  if (shift === "M" || shift === "T") return shift;
  return "Libre";
}

function scheduleTemplateForDate(dateKey = todayKey()) {
  const type = scheduleShiftTypeForDate(dateKey);
  const date = parseDateKey(dateKey) || new Date();
  const dayKey = scheduleWeekdayKey(date);
  const override = scheduleState?.schedules?.overrides?.[type]?.[dayKey] || {};
  const base = scheduleState?.schedules?.base?.[type] || {};
  const hasOverride = Object.keys(override).length > 0;
  return { type, dayKey, template: hasOverride ? override : base, usingOverride: hasOverride };
}

function scheduleLabelForScore(score = 0) {
  if (score < 40) return "día en fuga";
  if (score < 70) return "en marcha";
  if (score < 90) return "bien jugado";
  return "día exprimido";
}


const SCHEDULE_AUTOCLOSE_MARKER_STORAGE = "bookshell-habits-schedule-autoclose:v1";
const SCHEDULE_MODES = {
  targetMin: { label: "Objetivo tiempo", unit: "min", kind: "goal", metric: "time" },
  targetCount: { label: "Objetivo contable", unit: "count", kind: "goal", metric: "count" },
  limitMin: { label: "Límite tiempo", unit: "min", kind: "limit", metric: "time" },
  limitCount: { label: "Límite contable", unit: "count", kind: "limit", metric: "count" },
  neutral: { label: "Neutral", unit: "none", kind: "neutral", metric: "none" }
};

function scheduleModeInfo(mode) {
  return SCHEDULE_MODES[mode] || SCHEDULE_MODES.neutral;
}

function clampScheduleThreshold(value, fallback = 70) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return Math.max(1, Math.min(100, Math.round(Number(fallback) || 70)));
  return Math.max(1, Math.min(100, Math.round(numeric)));
}

function scheduleThresholdForContext({ type = "Libre", dayKey = "mon", template = {}, usingOverride = false } = {}) {
  const settings = scheduleState?.settings || {};
  const globalThreshold = clampScheduleThreshold(settings?.successThreshold, 70);
  const templateThreshold = clampScheduleThreshold(template?.__meta?.successThreshold, globalThreshold);
  const typeThreshold = clampScheduleThreshold(settings?.thresholdByType?.[type], templateThreshold);
  if (usingOverride) {
    return clampScheduleThreshold(settings?.thresholdByTypeAndDay?.[type]?.[dayKey], typeThreshold);
  }
  return typeThreshold;
}

function scheduleDayKeyFromTs(ts, dayCloseTime = "00:00") {
  const closeMin = parseCloseTimeToMinutes(dayCloseTime);
  const shifted = Number(ts) - closeMin * 60000;
  return dateKeyLocal(new Date(shifted));
}

function splitSpanByDay(startTs, endTs, dayCloseTime = "00:00") {
  const out = [];
  const start = Number(startTs);
  const end = Number(endTs);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return out;
  const closeMin = parseCloseTimeToMinutes(dayCloseTime);
  const closeMs = closeMin * 60000;
  let cursor = start;
  while (cursor < end) {
    const shifted = new Date(cursor - closeMs);
    const nextBoundary = new Date(shifted.getFullYear(), shifted.getMonth(), shifted.getDate() + 1, 0, 0, 0, 0).getTime() + closeMs;
    const chunkEnd = Math.min(end, nextBoundary);
    const minutes = (chunkEnd - cursor) / 60000;
    if (minutes > 0) out.push({ dayKey: scheduleDayKeyFromTs(cursor, dayCloseTime), minutes });
    cursor = chunkEnd;
  }
  return out;
}

function collectDoneByDayForHabit(habitId, dayCloseTime = "00:00") {
  const out = new Map();

  // Fuente base: totales persistidos por día (siempre actualizados por +X min y stop session).
  Object.keys(habitSessions?.[habitId] || {}).forEach((storedDayKey) => {
    const min = Math.max(0, getHabitTotalSecForDate(habitId, storedDayKey) / 60);
    if (min > 0) out.set(storedDayKey, (out.get(storedDayKey) || 0) + min);
  });

  // Si el cierre del día no es medianoche, recalculamos con sesiones detalladas cuando existan.
  if (dayCloseTime !== "00:00") {
    const detailed = Array.isArray(habitSessionTimeline?.[habitId]) ? habitSessionTimeline[habitId] : [];
    if (detailed.length) {
      const fromTimeline = new Map();
      detailed.forEach((session) => {
        const bounds = parseSessionBounds(session);
        if (!bounds) return;
        splitSpanByDay(bounds.startTs, bounds.endTs, dayCloseTime).forEach((chunk) => {
          fromTimeline.set(chunk.dayKey, (fromTimeline.get(chunk.dayKey) || 0) + chunk.minutes);
        });
      });
      fromTimeline.forEach((minutes, key) => {
        out.set(key, Math.max(out.get(key) || 0, minutes));
      });
    }
  }

  return out;
}

function computeHabitDayTotals(habitId, dayKey, dayCloseTime = "00:00", options = {}) {
  const includeRunning = options?.includeRunning !== false;
  const doneCount = Math.max(0, Number(getHabitCount(habitId, dayKey) || 0));
  const byDay = collectDoneByDayForHabit(habitId, dayCloseTime);
  let doneMin = Math.max(0, Math.round(byDay.get(dayKey) || 0));

  if (includeRunning && runningSession?.targetHabitId === habitId) {
    splitSpanByDay(runningSession.startTs, Date.now(), dayCloseTime).forEach((chunk) => {
      if (chunk.dayKey !== dayKey) return;
      doneMin = Math.max(0, Math.round(doneMin + chunk.minutes));
    });
  }

  const totals = { doneMin, doneCount };
  console.warn("[TOTALS]", habitId, dayKey, totals, { source: "shared" });
  return totals;
}

function buildScheduleDayData(dateKey = scheduleDayKeyFromTs(Date.now(), scheduleState?.settings?.dayCloseTime || "00:00")) {
  const closeTime = scheduleState?.settings?.dayCloseTime || "00:00";
  const { type, dayKey, template, usingOverride } = scheduleTemplateForDate(dateKey);
  const allHabits = activeHabits();
  const doneTotalsMap = {};

  allHabits.forEach((habit) => {
    doneTotalsMap[habit.id] = computeHabitDayTotals(habit.id, dateKey, closeTime, { includeRunning: true });
  });

  const entries = Object.entries(template || {}).map(([habitId, config]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return null;
    const mode = String(config?.mode || "neutral");
    const value = Math.max(0, Math.round(Number(config?.value) || 0));
    const info = scheduleModeInfo(mode);
    const totals = doneTotalsMap[habitId] || { doneMin: 0, doneCount: 0 };
    const done = info.metric === "count" ? totals.doneCount : totals.doneMin;
    const ratio = value > 0 ? (done / value) : 0;
    const progress = Math.max(0, Math.min(1, ratio));
    const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
    const remaining = Math.max(0, value - done);
    const exceeded = Math.max(0, done - value);
    return { habitId, habit, mode, info, value, done, progress, percent, remaining, exceeded, completed: info.kind === "goal" && done >= value };
  }).filter(Boolean);

  const goalRows = entries.filter((row) => row.info.kind === "goal");
  const limitRows = entries.filter((row) => row.info.kind === "limit");
  const neutralRows = entries.filter((row) => row.info.kind === "neutral" && row.done > 0);

  goalRows.sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1;
    if (!a.completed && !b.completed && b.remaining !== a.remaining) return b.remaining - a.remaining;
    return (a.habit?.name || "").localeCompare(b.habit?.name || "", "es");
  });

  const runningId = runningSession?.targetHabitId || null;
  if (runningId) {
    const idx = goalRows.findIndex((row) => row.habitId === runningId);
    if (idx > 0) goalRows.unshift(goalRows.splice(idx, 1)[0]);
  }

  const totalWeight = goalRows.reduce((acc, row) => acc + Math.max(1, row.value), 0);
  const score = totalWeight > 0
    ? Math.round((goalRows.reduce((acc, row) => acc + (row.progress * Math.max(1, row.value)), 0) / totalWeight) * 100)
    : 0;

  const totalTargetMin = goalRows.filter((row) => row.info.metric === "time").reduce((acc, row) => acc + row.value, 0);
  const totalDoneMin = goalRows.filter((row) => row.info.metric === "time").reduce((acc, row) => acc + row.done, 0);
  const totalTargetCount = goalRows.filter((row) => row.info.metric === "count").reduce((acc, row) => acc + row.value, 0);
  const totalDoneCount = goalRows.filter((row) => row.info.metric === "count").reduce((acc, row) => acc + row.done, 0);
  const wastedExcessMin = limitRows.filter((row) => row.info.metric === "time").reduce((acc, row) => acc + row.exceeded, 0);
  const wastedExcessCount = limitRows.filter((row) => row.info.metric === "count").reduce((acc, row) => acc + row.exceeded, 0);
  const wastedTotalMin = limitRows.filter((row) => row.info.metric === "time").reduce((acc, row) => acc + row.done, 0);
  const wastedTotalCount = limitRows.filter((row) => row.info.metric === "count").reduce((acc, row) => acc + row.done, 0);

  const thresholdUsed = scheduleThresholdForContext({ type, dayKey, template, usingOverride });

  const credits = computeDayCreditsAndScores({
    targets: goalRows,
    limits: limitRows,
    neutrals: neutralRows,
    doneMap: doneTotalsMap,
    settings: scheduleState?.settings || {},
    habitMeta: habits
  });
  credits.scorePlan = score;

  return {
    dateKey,
    type,
    dayKey,
    usingOverride,
    closeTime,
    rows: goalRows,
    limits: limitRows,
    neutrals: neutralRows,
    score,
    label: scheduleLabelForScore(score),
    runningId,
    totalTargetMin,
    totalDoneMin,
    totalTargetCount,
    totalDoneCount,
    wastedExcessMin,
    wastedExcessCount,
    wastedTotalMin,
    wastedTotalCount,
    thresholdUsed,
    templateVariantUsed: usingOverride ? dayKey : "base",
    ...credits,
    scorePlan: score,
    scoreCred: scheduleState?.settings?.netScoreEnabled ? credits.scoreNet : credits.scoreCred
  };
}

function closeScheduleDay(dateKey = todayKey(), source = "manual") {
  const data = buildScheduleDayData(dateKey);
  const perHabit = {};
  [...data.rows, ...data.limits, ...data.neutrals].forEach((row) => {
    perHabit[row.habitId] = {
      mode: row.mode,
      target: row.value,
      done: row.done,
      percent: row.percent,
      remaining: row.remaining,
      exceeded: row.exceeded
    };
  });
  const payload = {
    type: data.type,
    score: data.score,
    label: data.label,
    totalTargetMin: data.totalTargetMin,
    totalDoneMin: data.totalDoneMin,
    totalTargetCount: data.totalTargetCount,
    totalDoneCount: data.totalDoneCount,
    wastedExcessMin: data.wastedExcessMin,
    wastedExcessCount: data.wastedExcessCount,
    wastedTotalMin: data.wastedTotalMin,
    wastedTotalCount: data.wastedTotalCount,
    scorePlan: data.scorePlan,
    scoreCred: data.scoreCred,
    budgetMin: data.budgetMin,
    creditsEarned: data.creditsEarned,
    creditsToGoals: data.creditsToGoals,
    creditsToLimits: data.creditsToLimits,
    missingMin: data.missingMin,
    missingAfter: data.missingAfter,
    wasteAfter: data.wasteAfter,
    productiveMin: data.productiveMin,
    productiveMinAdjusted: data.productiveMinAdjusted,
    perHabit,
    thresholdUsed: data.thresholdUsed,
    templateTypeUsed: data.type,
    templateVariantUsed: data.templateVariantUsed,
    successThreshold: scheduleState?.settings?.successThreshold || 70,
    closedAtTs: Date.now(),
    closeSource: source
  };
  if (!scheduleState.summaries || typeof scheduleState.summaries !== "object") scheduleState.summaries = {};
  scheduleState.summaries[dateKey] = payload;
  persistHabitScheduleLocal();
  auditScheduleWrite(`${HABITS_SCHEDULE_PATH}/summaries/${dateKey}`, payload);
  update(ref(db, `${HABITS_SCHEDULE_PATH}/summaries`), { [dateKey]: payload }).catch((err) => {
    console.warn("No se pudo guardar resumen de horario", err);
  });
  renderSchedule("manual");
}

function openScheduleSummaryModal(dateKey) {
  const summary = scheduleState?.summaries?.[dateKey];
  if (!summary || !$habitScheduleSummaryModal || !$habitScheduleSummaryContent) return;
  if ($habitScheduleSummaryTitle) $habitScheduleSummaryTitle.textContent = `Resumen · ${dateKey}`;
  const topDone = Object.entries(summary.perHabit || {})
    .map(([habitId, row]) => ({ habit: habits[habitId], ...row }))
    .filter((row) => row.habit)
    .sort((a, b) => (b.percent - a.percent) || ((b.done || 0) - (a.done || 0)))
    .slice(0, 3);
  const topMiss = Object.entries(summary.perHabit || {})
    .map(([habitId, row]) => ({ habit: habits[habitId], ...row, remaining: Math.max(0, (row.remaining || 0)) }))
    .filter((row) => row.habit)
    .sort((a, b) => b.remaining - a.remaining)
    .slice(0, 3);
  const exceededLimits = Object.entries(summary.perHabit || {})
    .map(([habitId, row]) => ({ habit: habits[habitId], ...row }))
    .filter((row) => row.habit && (row.mode === "limitMin" || row.mode === "limitCount") && (row.exceeded || 0) > 0)
    .slice(0, 5);
  const neutralWithActivity = Object.entries(summary.perHabit || {})
    .map(([habitId, row]) => ({ habit: habits[habitId], ...row }))
    .filter((row) => row.habit && row.mode === "neutral" && (row.done || 0) > 0)
    .slice(0, 5);
  const renderList = (rows, empty) => rows.length
    ? `<ul>${rows.map((row) => `<li>${row.habit.emoji || "🏷️"} ${row.habit.name} · ${row.percent || 0}%</li>`).join("")}</ul>`
    : `<div class="hint">${empty}</div>`;
$habitScheduleSummaryContent.innerHTML = `
  <div class="habit-schedule-summary-score">
    ${(summary.scoreCred ?? summary.score ?? 0)}%
    <small>${summary.label || scheduleLabelForScore((summary.scoreCred ?? summary.score ?? 0))}</small>
  </div>

  <div class="habit-schedule-summary-meta">
    Aprovechado ${formatMinutes(summary.productiveMinAdjusted ?? summary.totalDoneMin ?? 0)}
    · Desperdiciado ${formatMinutes(summary.wasteAfter ?? summary.wastedExcessMin ?? 0)}
    <small>(bruto ${formatMinutes(summary.wastedExcessMin ?? 0)})</small>
  </div>

  <div class="hint">
    🪙 Ganadas ${formatMinutes(summary.creditsEarned ?? 0)}
    · Objetivos ${formatMinutes(summary.creditsToGoals ?? 0)}
    · Límites ${formatMinutes(summary.creditsToLimits ?? 0)}
  </div>

  <div class="hint">
    Pendiente ${formatMinutes(summary.missingMin ?? 0)} → ${formatMinutes(summary.missingAfter ?? 0)}
  </div>

  <div class="sheet-section-title">Top cumplidos</div>
  ${renderList(topDone, "Sin hábitos cumplidos")}

  <div class="sheet-section-title">Top pendientes</div>
  ${renderList(topMiss, "Nada pendiente")}

  <div class="sheet-section-title">Límites excedidos</div>
  ${
    exceededLimits.length
      ? `<ul>${exceededLimits
          .map(
            (row) =>
              `<li>${row.habit.emoji || "🏷️"} ${row.habit.name} · +${row.exceeded}${
                row.mode === "limitCount" ? "x" : "m"
              }</li>`
          )
          .join("")}</ul>`
      : '<div class="hint">Sin excesos</div>'
  }

  <div class="sheet-section-title">Neutrales con actividad</div>
  ${
    neutralWithActivity.length
      ? `<ul>${neutralWithActivity
          .map(
            (row) =>
              `<li>${row.habit.emoji || "🏷️"} ${row.habit.name} · ${row.done}${
                row.mode === "limitCount" || row.mode === "targetCount" ? "x" : "m"
              }</li>`
          )
          .join("")}</ul>`
      : '<div class="hint">Sin actividad neutral</div>'
  }
`;
$habitScheduleSummaryModal.classList.remove("hidden");

function closeScheduleSummaryModal() {
  $habitScheduleSummaryModal?.classList.add("hidden");
}

function renderScheduleMonthGrid(year, month, grid) {
  if (!grid) return;
  grid.innerHTML = "";
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const offset = (start.getDay() + 6) % 7;
  for (let i = 0; i < offset; i += 1) {
    const empty = document.createElement("div");
    empty.className = "history-month-cell is-out";
    grid.appendChild(empty);
  }
  for (let d = 1; d <= end.getDate(); d += 1) {
    const key = dateKeyLocal(new Date(year, month, d));
    const summary = scheduleState?.summaries?.[key];
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "history-month-cell habit-schedule-cell";
    const thresholdUsed = clampScheduleThreshold(summary?.thresholdUsed ?? summary?.successThreshold, scheduleState?.settings?.successThreshold || 70);
    const dayScore = Math.max(0, Math.min(100, Math.round(Number(summary?.score) || 0)));
    const scoreLabel = summary ? `${dayScore}%` : "";
    if (summary) cell.classList.add(dayScore >= thresholdUsed ? "is-good" : "is-bad");
    cell.innerHTML = `<span class="month-day-num">${d}</span><span class="month-day-emoji">${scoreLabel}</span>`;
    if (summary) cell.addEventListener("click", () => openScheduleSummaryModal(key));
    grid.appendChild(cell);
  }
  while (grid.children.length < 42) {
    const empty = document.createElement("div");
    empty.className = "history-month-cell is-out";
    grid.appendChild(empty);
  }
}

function parseCloseTimeToMinutes(value = "00:00") {
  const [h, m] = String(value).split(":").map((n) => Number(n));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.min(23, h)) * 60 + Math.max(0, Math.min(59, m));
}

function maybeAutoCloseScheduleDay() {
  const closeTime = scheduleState?.settings?.dayCloseTime || "00:00";
  const closeMin = parseCloseTimeToMinutes(closeTime);
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes();
  if (nowMin < closeMin) return;
  const marker = `${dateKeyLocal(now)}@${closeTime}`;
  const last = localStorage.getItem(SCHEDULE_AUTOCLOSE_MARKER_STORAGE);
  if (last === marker) return;
  const targetDate = scheduleDayKeyFromTs(now.getTime() - 600000, closeTime);
  if (!scheduleState?.summaries?.[targetDate]) closeScheduleDay(targetDate, "auto");
  try { localStorage.setItem(SCHEDULE_AUTOCLOSE_MARKER_STORAGE, marker); } catch (_) {}
}

function updateScheduleLiveInterval() {
  const shouldRun = !!runningSession && activeTab === "schedule";
  if (shouldRun && !scheduleTickInterval) {
    scheduleTickInterval = window.setInterval(() => {
      renderSchedule("tick:session");
    }, 15000);
  }
  if (!shouldRun && scheduleTickInterval) {
    window.clearInterval(scheduleTickInterval);
    scheduleTickInterval = null;
  }
}

function deepCloneScheduleState(value) {
  return JSON.parse(JSON.stringify(value || {}));
}

function readScheduleTemplateFromState(type = "M", day = "base", source = scheduleState) {
  if (day === "base") return deepCloneScheduleState(source?.schedules?.base?.[type] || {});
  return deepCloneScheduleState(source?.schedules?.overrides?.[type]?.[day] || {});
}

const SCHEDULE_DOWS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
const SCHEDULE_DOW_LABELS = { mon: "L", tue: "M", wed: "X", thu: "J", fri: "V", sat: "S", sun: "D" };
const SCHEDULE_TYPES = ["Libre", "M", "T"];
const SCHEDULE_TYPE_LABELS = { Libre: "L", M: "M", T: "T" };
const SCHEDULE_TYPE_COLORS = { Libre: "#22c55e", M: "#facc15", T: "#ef4444" };

function sanitizeScheduleTypes(types = []) {
  return Array.from(new Set((Array.isArray(types) ? types : []).filter((type) => SCHEDULE_TYPES.includes(type))));
}

function sanitizeScheduleDows(dows = []) {
  return Array.from(new Set((Array.isArray(dows) ? dows : []).filter((dow) => SCHEDULE_DOWS.includes(dow))));
}

function getHabitScheduleEntryForSelection(habitId, type = "Libre", day = "base", source = scheduleState) {
  if (!habitId) return null;
  const node = day === "base"
    ? source?.schedules?.base?.[type]?.[habitId]
    : source?.schedules?.overrides?.[type]?.[day]?.[habitId];
  if (!node || typeof node !== "object") return null;
  return {
    mode: String(node.mode || "neutral"),
    value: Math.max(0, Math.round(Number(node.value) || 0))
  };
}

function updateLocalScheduleHabitEntry(habitId, type = "Libre", day = "base", entry = null) {
  if (!habitId) return;
  if (!scheduleState?.schedules?.base || !scheduleState?.schedules?.overrides) {
    scheduleState = normalizeHabitSchedule(scheduleState || createDefaultHabitSchedule());
  }
  if (day === "base") {
    if (!scheduleState.schedules.base[type]) scheduleState.schedules.base[type] = {};
    if (!entry) delete scheduleState.schedules.base[type][habitId];
    else scheduleState.schedules.base[type][habitId] = entry;
    persistHabitScheduleLocal();
    return;
  }
  if (!scheduleState.schedules.overrides[type]) scheduleState.schedules.overrides[type] = {};
  if (!scheduleState.schedules.overrides[type][day]) scheduleState.schedules.overrides[type][day] = {};
  if (!entry) delete scheduleState.schedules.overrides[type][day][habitId];
  else scheduleState.schedules.overrides[type][day][habitId] = entry;
  persistHabitScheduleLocal();
}

function computeHabitChipRings(habitId) {
  const configured = {};
  const configuredBase = {};
  SCHEDULE_DOWS.forEach((dow) => {
    configured[dow] = { Libre: false, M: false, T: false };
  });
  SCHEDULE_TYPES.forEach((type) => {
    configuredBase[type] = !!scheduleState?.schedules?.base?.[type]?.[habitId];
    SCHEDULE_DOWS.forEach((dow) => {
      configured[dow][type] = !!scheduleState?.schedules?.overrides?.[type]?.[dow]?.[habitId];
    });
  });

  const rings = {};
  SCHEDULE_DOWS.forEach((dow) => {
    const parts = SCHEDULE_TYPES.filter((type) => configured[dow][type]);
    if (!parts.length) {
      rings[dow] = "linear-gradient(transparent, transparent)";
      return;
    }
    const slice = 360 / parts.length;
    const segments = parts.map((type, index) => {
      const from = Math.round(slice * index * 100) / 100;
      const to = Math.round(slice * (index + 1) * 100) / 100;
      return `${SCHEDULE_TYPE_COLORS[type]} ${from}deg ${to}deg`;
    });
    rings[dow] = `conic-gradient(${segments.join(", ")})`;
  });

  return { configured, configuredBase, rings };
}

function inferBulkEntryFromSelection(habitId, selectedTypes = [], selectedDows = []) {
  const types = sanitizeScheduleTypes(selectedTypes);
  if (!types.length || !habitId) return null;
  const dows = sanitizeScheduleDows(selectedDows);
  const type = types[0];
  if (!dows.length) return getHabitScheduleEntryForSelection(habitId, type, "base");
  return getHabitScheduleEntryForSelection(habitId, type, dows[0]);
}

async function applyHabitScheduleBulk(habitId, selectedDows = [], selectedTypes = [], mode = "neutral", value = 0) {
  if (!habitId) return false;
  const safeTypes = sanitizeScheduleTypes(selectedTypes);
  if (!safeTypes.length) throw new Error("missing-type");
  const safeDows = sanitizeScheduleDows(selectedDows);
  const safeMode = SCHEDULE_MODES[mode] ? mode : "neutral";
  const safeValue = safeMode === "neutral" ? 0 : Math.max(0, Math.round(Number(value) || 0));

  const payload = {};
  const localOps = [];
  safeTypes.forEach((type) => {
    if (!safeDows.length) {
      const key = `schedules/base/${type}/${habitId}`;
      payload[key] = { mode: safeMode, value: safeValue };
      localOps.push({ type, day: "base", entry: { mode: safeMode, value: safeValue } });
      return;
    }
    safeDows.forEach((dow) => {
      const key = `schedules/overrides/${type}/${dow}/${habitId}`;
      payload[key] = { mode: safeMode, value: safeValue };
      localOps.push({ type, day: dow, entry: { mode: safeMode, value: safeValue } });
    });
  });

  auditScheduleWrite(`${HABITS_SCHEDULE_PATH}`, payload);
  await update(ref(db, HABITS_SCHEDULE_PATH), payload);
  localOps.forEach((op) => updateLocalScheduleHabitEntry(habitId, op.type, op.day, op.entry));
  return true;
}

async function removeHabitScheduleBulk(habitId, selectedDows = [], selectedTypes = []) {
  if (!habitId) return false;
  const safeTypes = sanitizeScheduleTypes(selectedTypes);
  if (!safeTypes.length) throw new Error("missing-type");
  const safeDows = sanitizeScheduleDows(selectedDows);
  const payload = {};
  const localOps = [];

  safeTypes.forEach((type) => {
    if (!safeDows.length) {
      const key = `schedules/base/${type}/${habitId}`;
      payload[key] = null;
      localOps.push({ type, day: "base" });
      return;
    }
    safeDows.forEach((dow) => {
      const key = `schedules/overrides/${type}/${dow}/${habitId}`;
      payload[key] = null;
      localOps.push({ type, day: dow });
    });
  });

  auditScheduleWrite(`${HABITS_SCHEDULE_PATH}`, payload);
  await update(ref(db, HABITS_SCHEDULE_PATH), payload);
  localOps.forEach((op) => updateLocalScheduleHabitEntry(habitId, op.type, op.day, null));
  return true;
}

function beginScheduleTemplateEditing(type = "M", day = "base") {
  const normalizedType = type || "M";
  const normalizedDay = day || "base";
  scheduleEditorSelection = { type: normalizedType, day: normalizedDay };
  draftState = {
    type: normalizedType,
    day: normalizedDay,
    templateMap: readScheduleTemplateFromState(normalizedType, normalizedDay),
    closeTime: scheduleState?.settings?.dayCloseTime || "00:00",
    successThreshold: Math.max(1, Math.min(100, Math.round(Number(scheduleState?.settings?.successThreshold || 70)))),
    creditRate: Number(scheduleState?.settings?.creditRate ?? 1),
    creditAllocationOrder: Array.isArray(scheduleState?.settings?.creditAllocationOrder) ? [...scheduleState.settings.creditAllocationOrder] : ["goals", "limits"],
    scoreModeDefault: scheduleState?.settings?.scoreModeDefault === "credits" ? "credits" : "plan",
    allowCreditsOutsideTemplate: !!scheduleState?.settings?.allowCreditsOutsideTemplate,
    netScoreEnabled: !!scheduleState?.settings?.netScoreEnabled
  };
  isEditingTemplates = true;
  scheduleConfigOpen = true;
  console.warn("EDITOR RENDER", "open-editor");
}

function stopScheduleTemplateEditing() {
  isEditingTemplates = false;
  draftState = null;
}

function shouldSkipScheduleRender(reason = "unknown") {
  if (!isEditingTemplates) return false;
  const allowedReasons = new Set([
    "editor:open",
    "editor:select-type",
    "editor:select-day",
    "editor:save-confirm",
    "editor:cancel",
    "editor:close",
    "editor:toggle",
    "manual"
  ]);
  if (allowedReasons.has(reason)) return false;
  console.warn("EDITOR RENDER", `blocked:${reason}`);
  return true;
}

function renderSchedule(reason = "manual") {
  if (!$habitScheduleView) return;
  if (activeTab !== "schedule") {
    updateScheduleLiveInterval();
    return;
  }
  if (shouldSkipScheduleRender(reason)) {
    updateScheduleLiveInterval();
    return;
  }
  console.warn("EDITOR RENDER", reason);
  const currentDateKey = scheduleDayKeyFromTs(Date.now(), scheduleState?.settings?.dayCloseTime || "00:00");
  const data = buildScheduleDayData(currentDateKey);
  const threshold = scheduleState?.settings?.successThreshold || 70;
  if (!Number.isInteger(scheduleCalYear) || !Number.isInteger(scheduleCalMonth)) {
    scheduleCalYear = new Date().getFullYear();
    scheduleCalMonth = new Date().getMonth();
  }

  const allHabits = activeHabits();
  const selectedType = isEditingTemplates
    ? (scheduleEditorSelection.type || "M")
    : ($habitScheduleView.querySelector('[data-role="schedule-type"]')?.value || data.type);
  const selectedDay = isEditingTemplates
    ? (scheduleEditorSelection.day || "base")
    : ($habitScheduleView.querySelector('[data-role="schedule-day"]')?.value || "base");
  const sourceObj = isEditingTemplates
    ? (draftState?.templateMap || {})
    : readScheduleTemplateFromState(selectedType, selectedDay);
  const closeTimeValue = isEditingTemplates
    ? (draftState?.closeTime || "00:00")
    : (scheduleState?.settings?.dayCloseTime || "00:00");
  const thresholdValue = isEditingTemplates
    ? Math.max(1, Math.min(100, Math.round(Number(draftState?.successThreshold || threshold))))
    : threshold;
  ensureScheduleScoreModeDefault();
  const scoreMain = scheduleScoreMode === "credits" ? (data.scoreCred || 0) : (data.scorePlan || data.score || 0);
  const scoreGood = scoreMain >= threshold;
  const wastedLabel = formatMinutes(data.wasteAfter ?? data.wastedExcessMin);
  const usedLabel = data.totalDoneCount > 0
    ? `${formatMinutes(data.totalDoneMin)} +${data.totalDoneCount}x`
    : formatMinutes(data.totalDoneMin);
  const creditsLine = data.creditsEarned > 0
    ? `🪙 +${formatMinutes(data.creditsEarned)} · usados O:${formatMinutes(data.creditsToGoals)} L:${formatMinutes(data.creditsToLimits)}`
    : "🪙 +0m";
  const creditRateValue = isEditingTemplates
    ? Number(draftState?.creditRate ?? scheduleState?.settings?.creditRate ?? 1)
    : Number(scheduleState?.settings?.creditRate ?? 1);
  const allocationOrder = (isEditingTemplates
    ? (Array.isArray(draftState?.creditAllocationOrder) ? draftState.creditAllocationOrder : ["goals", "limits"])
    : (Array.isArray(scheduleState?.settings?.creditAllocationOrder) ? scheduleState.settings.creditAllocationOrder : ["goals", "limits"]))
    .join(",") === "limits,goals" ? "limits-first" : "goals-first";
  const allowOutsideCredits = isEditingTemplates
    ? !!draftState?.allowCreditsOutsideTemplate
    : !!scheduleState?.settings?.allowCreditsOutsideTemplate;
  const scoreModeDefault = isEditingTemplates
    ? (draftState?.scoreModeDefault === "credits" ? "credits" : "plan")
    : (scheduleState?.settings?.scoreModeDefault === "credits" ? "credits" : "plan");
  const netScoreEnabled = isEditingTemplates
    ? !!draftState?.netScoreEnabled
    : !!scheduleState?.settings?.netScoreEnabled;

  $habitScheduleView.innerHTML = `
    <section class="habits-history-section habit-schedule-score-wrap ${scoreGood ? "is-good" : "is-bad"}">
      <div class="habit-schedule-head-side is-left"><span>Aprovechado</span><strong>${usedLabel}</strong><small>${data.creditsEarned > 0 ? `+🪙 ${formatMinutes(data.creditsEarned)}` : ""}</small></div>
      <div>
      <div class="habit-schedule-score">${scoreMain}%</div>
      <div class="habit-schedule-score-label">${scheduleScoreMode === "credits" ? "aprovechado" : data.label}</div>
      <div class="habit-schedule-score-sub">Plantilla ${data.type}${data.usingOverride ? ` · override ${data.dayKey.toUpperCase()}` : ""} · ${creditsLine}</div>
      </div>
      <div class="habit-schedule-head-side is-right"><span>Desperdiciado</span><strong>${wastedLabel}</strong></div>
    </section>
    <section class="habits-history-section habit-schedule-controls">
      <button class="btn ghost btn-compact" type="button" data-role="schedule-score-toggle">${scheduleScoreMode === "credits" ? "Aprovechado" : "Plan"}</button>
      <button class="btn ghost btn-compact" type="button" data-role="schedule-open-editor">Editar plantillas</button>
      <button class="btn ghost btn-compact" type="button" data-role="schedule-view-toggle" aria-pressed="${scheduleViewMode === "time" ? "true" : "false"}">% / tiempo</button>
      <button class="btn ghost btn-compact" type="button" data-role="schedule-close-day">Cerrar día</button>
    </section>
    <section class="habits-history-section habit-schedule-config ${scheduleConfigOpen ? "" : "is-hidden"}">
      <div class="habits-history-section-header">
        <button class="habits-history-section-title habit-schedule-config-toggle" type="button" data-role="schedule-config-toggle" aria-expanded="${scheduleConfigOpen ? "true" : "false"}">Plantillas</button>
      </div>
      <div class="habit-schedule-config-row habit-schedule-config-row-top">
        <select class="habits-history-select" data-role="schedule-type">
          <option value="M" ${selectedType === "M" ? "selected" : ""}>M</option>
          <option value="T" ${selectedType === "T" ? "selected" : ""}>T</option>
          <option value="Libre" ${selectedType === "Libre" ? "selected" : ""}>Libre</option>
        </select>
        <select class="habits-history-select" data-role="schedule-day">
          <option value="base" ${selectedDay === "base" ? "selected" : ""}>Base</option>
          <option value="mon" ${selectedDay === "mon" ? "selected" : ""}>Lunes</option>
          <option value="tue" ${selectedDay === "tue" ? "selected" : ""}>Martes</option>
          <option value="wed" ${selectedDay === "wed" ? "selected" : ""}>Miércoles</option>
          <option value="thu" ${selectedDay === "thu" ? "selected" : ""}>Jueves</option>
          <option value="fri" ${selectedDay === "fri" ? "selected" : ""}>Viernes</option>
          <option value="sat" ${selectedDay === "sat" ? "selected" : ""}>Sábado</option>
          <option value="sun" ${selectedDay === "sun" ? "selected" : ""}>Domingo</option>
        </select>
        <input class="habits-history-input" data-role="close-time" type="time" value="${closeTimeValue}"/>
        <input class="habits-history-input" data-role="success-threshold" type="number" min="1" max="100" value="${thresholdValue}"/>
        <input class="habits-history-input" data-role="credit-rate" type="number" min="0" step="0.1" value="${creditRateValue}"/>
      </div>
      <div class="habit-schedule-config-row">
        <select class="habits-history-select" data-role="credit-order">
          <option value="goals-first" ${allocationOrder === "goals-first" ? "selected" : ""}>Créditos: objetivos → límites</option>
          <option value="limits-first" ${allocationOrder === "limits-first" ? "selected" : ""}>Créditos: límites → objetivos</option>
        </select>
        <select class="habits-history-select" data-role="score-default">
          <option value="plan" ${scoreModeDefault === "plan" ? "selected" : ""}>Score default: Plan</option>
          <option value="credits" ${scoreModeDefault === "credits" ? "selected" : ""}>Score default: Aprovechado</option>
        </select>
        <label class="toggle-pill"><input type="checkbox" data-role="allow-outside" ${allowOutsideCredits ? "checked" : ""}/><span>Permitir fuera de plantilla</span></label>
        <label class="toggle-pill"><input type="checkbox" data-role="net-score" ${netScoreEnabled ? "checked" : ""}/><span>Score neto</span></label>
      </div>
      <div class="habit-schedule-targets" data-role="schedule-targets"></div>
      <div class="habit-schedule-actions">
        <button class="btn ghost btn-compact" type="button" data-role="schedule-save-config">Guardar plantilla</button>
        <button class="btn ghost btn-compact" type="button" data-role="schedule-cancel-editor">Cerrar</button>
      </div>
    </section>
    <section class="habits-history-section">
      <div class="habit-schedule-list" data-role="schedule-progress-list"></div>
      <details class="habit-accordion habit-schedule-extras" data-role="schedule-limits">
        <summary><div class="habit-accordion-title">Límites</div></summary>
        <div class="habit-accordion-body" data-role="schedule-limits-list"></div>
      </details>
      <details class="habit-accordion habit-schedule-extras" data-role="schedule-neutrals">
        <summary><div class="habit-accordion-title">Neutrales con actividad</div></summary>
        <div class="habit-accordion-body" data-role="schedule-neutrals-list"></div>
      </details>
    </section>
    <section class="habits-history-section">
      <div class="habits-history-section-header">
        <div class="habits-history-section-title">Calendario de resultados</div>
        <div class="habits-history-month-nav">
          <button class="habits-history-month-nav-btn" type="button" data-role="schedule-cal-prev">←</button>
          <div class="habits-history-month-label">${formatHistoryMonthLabel(scheduleCalYear, scheduleCalMonth)}</div>
          <button class="habits-history-month-nav-btn" type="button" data-role="schedule-cal-next">→</button>
        </div>
      </div>
      <div class="habit-month-weekdays"><span>L</span><span>M</span><span>X</span><span>J</span><span>V</span><span>S</span><span>D</span></div>
      <div class="history-month-grid" data-role="schedule-month-grid"></div>
    </section>
  `;

  const targetsWrap = $habitScheduleView.querySelector('[data-role="schedule-targets"]');
  if (targetsWrap) {
    targetsWrap.innerHTML = allHabits.map((habit) => {
      const cfg = sourceObj[habit.id] || { mode: "neutral", value: 0 };
      const mode = cfg.mode || "neutral";
      const val = Math.max(0, Math.round(Number(cfg.value) || 0));
      return `<div class="habit-schedule-target-row">
        <span>${habit.emoji || "🏷️"} ${habit.name}</span>
        <select data-role="schedule-mode" data-habit-id="${habit.id}">
          <option value="targetMin" ${mode === "targetMin" ? "selected" : ""}>Objetivo tiempo</option>
          <option value="targetCount" ${mode === "targetCount" ? "selected" : ""}>Objetivo contable</option>
          <option value="limitMin" ${mode === "limitMin" ? "selected" : ""}>Límite tiempo</option>
          <option value="limitCount" ${mode === "limitCount" ? "selected" : ""}>Límite contable</option>
          <option value="neutral" ${mode === "neutral" ? "selected" : ""}>Neutral</option>
        </select>
        <input type="number" min="0" step="1" data-role="schedule-value" data-habit-id="${habit.id}" value="${val}" ${mode === "neutral" ? "disabled" : ""}/>
      </div>`;
    }).join("");
  }


  const list = $habitScheduleView.querySelector('[data-role="schedule-progress-list"]');
  const makeRow = (row, rowGroup = "goals") => {
    const isFocused = runningSession?.targetHabitId === row.habitId;
    const percentLabel = `${row.percent}%`;
    const timeLabel = buildScheduleRowDetailLabel(row);
    const slotLabel = scheduleViewMode === "time" ? timeLabel : percentLabel;
    const isDone = String(row.mode || "").startsWith("target") && row.progress >= 1;
    const isOver = String(row.mode || "").startsWith("limit") && row.done > row.value;
    return `<div class="habit-schedule-row ${row.completed ? "is-complete" : ""} ${isFocused ? "is-focused" : ""} ${isOver ? "is-over-limit" : ""} ${isDone ? "schedule-row--done" : ""} ${isOver ? "schedule-row--over" : ""}">
      <div class="habit-schedule-name">${row.habit?.emoji || "🏷️"} ${row.habit?.name || "—"}${isDone ? ' <span class="habit-schedule-badge">Hecho</span>' : ""}</div>
      <div class="habit-schedule-bar"><span style="width:${Math.max(0, Math.min(100, row.percent || 0))}%"></span></div>
      <div class="habit-schedule-pct ${scheduleViewMode === "time" && isOver ? "is-danger" : ""}" data-role="schedule-right-slot" data-label-percent="${percentLabel}" data-label-time="${timeLabel}" data-is-exceeded="${isOver ? "1" : "0"}">${slotLabel}</div>
    </div>`;
  };
  if (list) list.innerHTML = data.rows.map((row) => makeRow(row, "goals")).join("") || '<div class="hint">Define objetivos para ver progreso.</div>';

  const limitsList = $habitScheduleView.querySelector('[data-role="schedule-limits-list"]');
  const limitsWrap = $habitScheduleView.querySelector('[data-role="schedule-limits"]');
  if (limitsList) limitsList.innerHTML = data.limits.map((row) => makeRow(row, "limits")).join("") || '<div class="hint">Sin límites configurados.</div>';
  if (limitsWrap) limitsWrap.style.display = data.limits.length ? "block" : "none";

  const neutralList = $habitScheduleView.querySelector('[data-role="schedule-neutrals-list"]');
  const neutralWrap = $habitScheduleView.querySelector('[data-role="schedule-neutrals"]');
  if (neutralList) neutralList.innerHTML = data.neutrals.map((row) => makeRow({ ...row, percent: 100 }, "neutrals")).join("") || '<div class="hint">Sin actividad neutral.</div>';
  if (neutralWrap) neutralWrap.style.display = data.neutrals.length ? "block" : "none";

  const monthGrid = $habitScheduleView.querySelector('[data-role="schedule-month-grid"]');
  renderScheduleMonthGrid(scheduleCalYear, scheduleCalMonth, monthGrid);

  $habitScheduleView.querySelector('[data-role="schedule-type"]')?.addEventListener("change", (event) => {
    const nextType = event.target?.value || "M";
    if (isEditingTemplates) {
      scheduleEditorSelection.type = nextType;
      if (draftState) {
        draftState.type = nextType;
        draftState.templateMap = readScheduleTemplateFromState(nextType, scheduleEditorSelection.day || "base");
      }
    }
    renderSchedule("editor:select-type");
  });
  $habitScheduleView.querySelector('[data-role="schedule-day"]')?.addEventListener("change", (event) => {
    const nextDay = event.target?.value || "base";
    if (isEditingTemplates) {
      scheduleEditorSelection.day = nextDay;
      if (draftState) {
        draftState.day = nextDay;
        draftState.templateMap = readScheduleTemplateFromState(scheduleEditorSelection.type || "M", nextDay);
      }
    }
    renderSchedule("editor:select-day");
  });
  $habitScheduleView.querySelector('[data-role="schedule-cal-prev"]')?.addEventListener("click", () => {
    const next = new Date(scheduleCalYear, scheduleCalMonth - 1, 1);
    scheduleCalYear = next.getFullYear();
    scheduleCalMonth = next.getMonth();
    renderSchedule("manual");
  });
  $habitScheduleView.querySelector('[data-role="schedule-cal-next"]')?.addEventListener("click", () => {
    const next = new Date(scheduleCalYear, scheduleCalMonth + 1, 1);
    scheduleCalYear = next.getFullYear();
    scheduleCalMonth = next.getMonth();
    renderSchedule("manual");
  });
  $habitScheduleView.querySelector('[data-role="schedule-close-day"]')?.addEventListener("click", () => {
    closeScheduleDay(currentDateKey, "manual");
  });
  $habitScheduleView.querySelector('[data-role="schedule-open-editor"]')?.addEventListener("click", () => {
    beginScheduleTemplateEditing(selectedType, selectedDay);
    renderSchedule("editor:open");
  });
  $habitScheduleView.querySelector('[data-role="schedule-config-toggle"]')?.addEventListener("click", () => {
    if (scheduleConfigOpen) {
      stopScheduleTemplateEditing();
      scheduleConfigOpen = false;
      renderSchedule("editor:toggle");
      return;
    }
    beginScheduleTemplateEditing(selectedType, selectedDay);
    renderSchedule("editor:toggle");
  });
  $habitScheduleView.querySelector('[data-role="schedule-cancel-editor"]')?.addEventListener("click", () => {
    stopScheduleTemplateEditing();
    scheduleConfigOpen = false;
    renderSchedule("editor:cancel");
  });
  $habitScheduleView.querySelector('[data-role="schedule-view-toggle"]')?.addEventListener("click", () => {
    toggleScheduleViewMode();
    updateScheduleRightSlots();
  });
  $habitScheduleView.querySelector('[data-role="schedule-score-toggle"]')?.addEventListener("click", () => {
    toggleScheduleScoreMode();
    renderSchedule("manual");
  });
  $habitScheduleView.querySelectorAll('[data-role="schedule-mode"]').forEach((select) => {
    select.addEventListener("change", () => {
      const habitId = select.getAttribute("data-habit-id");
      const input = $habitScheduleView.querySelector(`[data-role=\"schedule-value\"][data-habit-id=\"${habitId}\"]`);
      if (input) input.disabled = select.value === "neutral";
      if (!isEditingTemplates || !draftState || !habitId) return;
      const mode = select.value || "neutral";
      const currentValue = Math.max(0, Math.round(Number(input?.value) || 0));
      if (mode === "neutral") draftState.templateMap[habitId] = { mode: "neutral", value: 0 };
      else draftState.templateMap[habitId] = { mode, value: currentValue };
    });
  });
  $habitScheduleView.querySelectorAll('[data-role="schedule-value"]').forEach((input) => {
    input.addEventListener("input", () => {
      const habitId = input.getAttribute("data-habit-id");
      if (!isEditingTemplates || !draftState || !habitId) return;
      const modeSelect = $habitScheduleView.querySelector(`[data-role=\"schedule-mode\"][data-habit-id=\"${habitId}\"]`);
      const mode = modeSelect?.value || "neutral";
      const value = Math.max(0, Math.round(Number(input.value) || 0));
      if (mode === "neutral") draftState.templateMap[habitId] = { mode: "neutral", value: 0 };
      else draftState.templateMap[habitId] = { mode, value };
    });
  });
  $habitScheduleView.querySelector('[data-role="close-time"]')?.addEventListener("input", (event) => {
    if (!isEditingTemplates || !draftState) return;
    draftState.closeTime = event.target?.value || "00:00";
  });
  $habitScheduleView.querySelector('[data-role="success-threshold"]')?.addEventListener("input", (event) => {
    if (!isEditingTemplates || !draftState) return;
    const value = Math.max(1, Math.min(100, Math.round(Number(event.target?.value || 70))));
    draftState.successThreshold = value;
  });
  $habitScheduleView.querySelector('[data-role="credit-rate"]')?.addEventListener("input", (event) => {
    if (!isEditingTemplates || !draftState) return;
    const value = Number(event.target?.value);
    draftState.creditRate = Number.isFinite(value) && value >= 0 ? value : 1;
  });
  $habitScheduleView.querySelector('[data-role="credit-order"]')?.addEventListener("change", (event) => {
    if (!isEditingTemplates || !draftState) return;
    draftState.creditAllocationOrder = event.target?.value === "limits-first" ? ["limits", "goals"] : ["goals", "limits"];
  });
  $habitScheduleView.querySelector('[data-role="score-default"]')?.addEventListener("change", (event) => {
    if (!isEditingTemplates || !draftState) return;
    draftState.scoreModeDefault = event.target?.value === "credits" ? "credits" : "plan";
  });
  $habitScheduleView.querySelector('[data-role="allow-outside"]')?.addEventListener("change", (event) => {
    if (!isEditingTemplates || !draftState) return;
    draftState.allowCreditsOutsideTemplate = !!event.target?.checked;
  });
  $habitScheduleView.querySelector('[data-role="net-score"]')?.addEventListener("change", (event) => {
    if (!isEditingTemplates || !draftState) return;
    draftState.netScoreEnabled = !!event.target?.checked;
  });
  $habitScheduleView.querySelector('[data-role="schedule-save-config"]')?.addEventListener("click", () => {
    if (!isEditingTemplates || !draftState) return;
    const type = $habitScheduleView.querySelector('[data-role="schedule-type"]')?.value || "M";
    const day = $habitScheduleView.querySelector('[data-role="schedule-day"]')?.value || "base";
    const previousMap = day === "base"
      ? { ...(scheduleState?.schedules?.base?.[type] || {}) }
      : { ...(scheduleState?.schedules?.overrides?.[type]?.[day] || {}) };
    const nextMap = {};
    $habitScheduleView.querySelectorAll('.habit-schedule-target-row [data-role="schedule-mode"]').forEach((select) => {
      const id = select.getAttribute("data-habit-id") || "";
      const input = $habitScheduleView.querySelector(`[data-role=\"schedule-value\"][data-habit-id=\"${id}\"]`);
      const mode = select.value || "neutral";
      const val = Math.max(0, Math.round(Number(input?.value) || 0));
      if (!id) return;
      if (mode === "neutral") nextMap[id] = { mode: "neutral", value: 0 };
      else if (val > 0) nextMap[id] = { mode, value: val };
    });
    draftState.templateMap = deepCloneScheduleState(nextMap);
    const closeTime = $habitScheduleView.querySelector('[data-role="close-time"]')?.value || "00:00";
    const successThreshold = Math.max(1, Math.min(100, Math.round(Number($habitScheduleView.querySelector('[data-role="success-threshold"]')?.value || 70))));
    const creditRate = Math.max(0, Number($habitScheduleView.querySelector('[data-role="credit-rate"]')?.value || 1));
    const creditAllocationOrder = $habitScheduleView.querySelector('[data-role="credit-order"]')?.value === "limits-first" ? ["limits", "goals"] : ["goals", "limits"];
    const scoreModeDefaultNext = $habitScheduleView.querySelector('[data-role="score-default"]')?.value === "credits" ? "credits" : "plan";
    const allowCreditsOutsideTemplate = !!$habitScheduleView.querySelector('[data-role="allow-outside"]')?.checked;
    const netScoreEnabled = !!$habitScheduleView.querySelector('[data-role="net-score"]')?.checked;
    draftState.closeTime = closeTime;
    draftState.successThreshold = successThreshold;
    draftState.creditRate = creditRate;
    draftState.creditAllocationOrder = creditAllocationOrder;
    draftState.scoreModeDefault = scoreModeDefaultNext;
    draftState.allowCreditsOutsideTemplate = allowCreditsOutsideTemplate;
    draftState.netScoreEnabled = netScoreEnabled;
    const templatePath = day === "base"
      ? `${HABITS_SCHEDULE_PATH}/schedules/base/${type}`
      : `${HABITS_SCHEDULE_PATH}/schedules/overrides/${type}/${day}`;
    const templatePatch = {};
    Object.keys(previousMap).forEach((habitId) => {
      if (!Object.prototype.hasOwnProperty.call(nextMap, habitId)) templatePatch[habitId] = null;
    });
    Object.entries(nextMap).forEach(([habitId, entry]) => {
      templatePatch[habitId] = entry;
    });
    auditScheduleWrite(templatePath, templatePatch);
    const settingsPath = `${HABITS_SCHEDULE_PATH}/settings`;
    const settingsPayload = { dayCloseTime: closeTime, successThreshold, creditRate, creditAllocationOrder, scoreModeDefault: scoreModeDefaultNext, allowCreditsOutsideTemplate, netScoreEnabled };
    auditScheduleWrite(settingsPath, settingsPayload);
    Promise.all([
      update(ref(db, templatePath), templatePatch),
      update(ref(db, settingsPath), settingsPayload)
    ]).then(() => {
      if (!scheduleState.schedules?.base) scheduleState.schedules = createDefaultHabitSchedule().schedules;
      if (day === "base") scheduleState.schedules.base[type] = deepCloneScheduleState(nextMap);
      else scheduleState.schedules.overrides[type][day] = deepCloneScheduleState(nextMap);
      scheduleState.settings.dayCloseTime = closeTime;
      scheduleState.settings.successThreshold = successThreshold;
      scheduleState.settings.creditRate = creditRate;
      scheduleState.settings.creditAllocationOrder = creditAllocationOrder;
      scheduleState.settings.scoreModeDefault = scoreModeDefaultNext;
      scheduleState.settings.allowCreditsOutsideTemplate = allowCreditsOutsideTemplate;
      scheduleState.settings.netScoreEnabled = netScoreEnabled;
      persistHabitScheduleLocal();
      stopScheduleTemplateEditing();
      scheduleConfigOpen = false;
      renderSchedule("editor:save-confirm");
    }).catch((err) => {
      console.warn("No se pudo guardar plantilla/ajustes de horario en remoto", err);
    });
  });

  updateScheduleRightSlots();

  updateScheduleLiveInterval();
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


function foldKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function isWorkHabit(habit) {
  if (!habit || habit.archived) return false;
  return foldKey(habit.name) === "trabajo";
}

function normalizeShiftValue(value) {
  return value === "M" || value === "T" ? value : null;
}

function readDayMinutesAndShift(rawValue, isWork = false) {
  if (rawValue == null) return { minutes: 0, shift: null, hasEntry: false };

  if (typeof rawValue === "number") {
    if (!isWork) return { minutes: Math.round(Math.max(0, rawValue) / 60), shift: null, hasEntry: rawValue > 0 };
    const raw = Math.max(0, Number(rawValue) || 0);
    const minutes = raw > 1440 ? Math.round(raw / 60) : Math.round(raw);
    return { minutes, shift: null, hasEntry: raw > 0 };
  }

  if (typeof rawValue === "object") {
    const shift = normalizeShiftValue(rawValue.shift);
    const minRaw = Number(rawValue.min);
    const secRaw = Number(rawValue.totalSec);
    const minutes = Number.isFinite(minRaw) && minRaw > 0
      ? Math.round(minRaw)
      : (Number.isFinite(secRaw) && secRaw > 0 ? Math.round(secRaw / 60) : 0);
    return {
      minutes,
      shift,
      hasEntry: minutes > 0 || !!shift
    };
  }

  return { minutes: 0, shift: null, hasEntry: false };
}

function resolveHabitIdFromToken(token) {
  const raw = String(token || "").trim();
  if (!raw) return null;

  // 1) id directo
  if (habits && habits[raw] && !habits[raw].archived) return raw;

  // 2) nombre exacto (normalizado)
  const fk = foldKey(raw);
  const found = Object.values(habits || {}).find((h) => {
    if (!h || h.archived) return false;
    return foldKey(h.name) === fk;
  });
  return found?.id || null;
}

function resolveHabitIdByName(name) {
  const raw = String(name || "").trim();
  if (!raw) return { status: "none", habitId: null, matches: [], query: "" };
  const fk = foldKey(raw);
  const matches = Object.values(habits || {})
    .filter((h) => h && !h.archived && foldKey(h.name) === fk)
    .map((h) => ({ id: h.id, name: h.name, emoji: h.emoji || "🏷️" }));
  if (matches.length === 1) return { status: "single", habitId: matches[0].id, matches, query: raw };
  if (matches.length > 1) return { status: "multiple", habitId: null, matches, query: raw };
  return { status: "none", habitId: null, matches: [], query: raw };
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
  const safeMin = Math.max(0, Math.round(Number(min) || 0));
  if (!safeMin) return "0m";
  if (safeMin >= 60) {
    const hours = Math.floor(safeMin / 60);
    const rest = safeMin % 60;
    return rest ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${safeMin}m`;
}

function formatHoursTotal(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (!total) return "0h";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `0h ${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}

function formatCompactDayValue(goal, value) {
  if (goal === "time") {
    const minutes = Math.max(0, Math.round(Number(value) || 0));
    if (!minutes) return "";
    if (minutes >= 60) {
      const hours = minutes / 60;
      const rounded = Math.round(hours * 10) / 10;
      const display = Number.isInteger(rounded) ? String(Math.round(rounded)) : String(rounded.toFixed(1));
      return `${display}h`;
    }
    return `${minutes}m`;
  }
  if (goal === "count") {
    const count = Math.max(0, Math.round(Number(value) || 0));
    return count > 0 ? `×${count}` : "";
  }
  return value > 0 ? "✓" : "";
}

function parseTimeToMinutes(v) {
  const s = String(v || "").trim();
  if (!s) return 0;
  const [hh, mm] = s.split(":");
  const h = Number(hh), m = Number(mm);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return Math.max(0, Math.round(h * 60 + m));
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

function localStartOfDayTs(ts) {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0).getTime();
}

function localStartOfNextDayTs(ts) {
  const date = new Date(ts);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0).getTime();
}

// Repartimos sesiones por día local para que una sesión 23:30→00:30 compute 30m+30m.
// Si no hay timestamps reales (legacy), el fallback se mantiene sin inventar reparto.
function splitSessionByDay(startTs, endTs) {
  const out = new Map();
  splitSpanByDay(startTs, endTs, "00:00").forEach((chunk) => {
    out.set(chunk.dayKey, (out.get(chunk.dayKey) || 0) + chunk.minutes);
  });
  return out;
}

function parseSessionBounds(rawSession) {
  if (!rawSession || typeof rawSession !== "object") return null;
  const startTs = Number(rawSession.startTs);
  let endTs = Number(rawSession.endTs);
  const durationSec = Math.max(0, Number(rawSession.durationSec) || 0);
  if (!Number.isFinite(startTs) || startTs <= 0) return null;
  if (!Number.isFinite(endTs) || endTs <= startTs) {
    if (rawSession.active || rawSession.isRunning) endTs = Date.now();
    else if (durationSec > 0) endTs = startTs + (durationSec * 1000);
  }
  if (!Number.isFinite(endTs) || endTs <= startTs) return null;
  return { startTs, endTs };
}

function isDevEnv() {
  const host = window.location?.hostname || "";
  return host === "localhost" || host === "127.0.0.1";
}

function runSplitSessionSelfChecks() {
  if (!isDevEnv()) return;
  const mkTs = (y, m, d, hh, mm) => new Date(y, m - 1, d, hh, mm, 0, 0).getTime();
  const approx = (a, b) => Math.abs(a - b) < 1e-6;
  const c1 = splitSessionByDay(mkTs(2026, 2, 10, 23, 30), mkTs(2026, 2, 11, 0, 30));
  console.assert(approx(c1.get("2026-02-10") || 0, 30) && approx(c1.get("2026-02-11") || 0, 30), "[Habits split] 23:30→00:30 should be 30/30");
  const c2 = splitSessionByDay(mkTs(2026, 2, 10, 22, 0), mkTs(2026, 2, 11, 1, 0));
  console.assert(approx(c2.get("2026-02-10") || 0, 120) && approx(c2.get("2026-02-11") || 0, 60), "[Habits split] 22:00→01:00 should be 120/60");
  const c3 = splitSessionByDay(mkTs(2026, 2, 10, 10, 0), mkTs(2026, 2, 10, 10, 45));
  console.assert(approx(c3.get("2026-02-10") || 0, 45), "[Habits split] 10:00→10:45 should be 45");
  const c4 = splitSessionByDay(mkTs(2026, 2, 10, 23, 0), mkTs(2026, 2, 12, 1, 0));
  console.assert(approx(c4.get("2026-02-10") || 0, 60) && approx(c4.get("2026-02-11") || 0, 1440) && approx(c4.get("2026-02-12") || 0, 60), "[Habits split] multi-day should split across all boundaries");
}
runSplitSessionSelfChecks();

function dbgSimulateSessionSplit() {
  const start = new Date(2026, 1, 11, 23, 50, 0, 0).getTime();
  const end = new Date(2026, 1, 12, 0, 10, 0, 0).getTime();
  const split = splitSessionByDay(start, end);
  const rounded = {};
  split.forEach((minutes, dayKey) => {
    rounded[dayKey] = Math.round(minutes);
  });
  const expected = { "2026-02-11": 10, "2026-02-12": 10 };
  console.log("[HABIT] dbgSimulateSessionSplit", { expected, obtained: rounded, startTs: start, endTs: end });
  return rounded;
}
window.dbgSimulateSessionSplit = dbgSimulateSessionSplit;

// === Sesiones v2 (ahorro de storage) ===
// Antes (v1): habitSessions = { sessionId: {habitId, dateKey, durationSec, ...} }
// Ahora  (v2): habitSessions = { habitId: { dateKey: totalSec } }
// Migración automática: v1 -> v2 (sobrescribe nodo remoto para borrar sesiones antiguas)
function normalizeSessionsStore(raw, persistRemote = false) {
  const totals = {};
  const timeline = {};
  const coverage = {};
  let changed = false;

  const add = (habitId, dateKey, sec) => {
    if (!habitId || !dateKey) return;
    const n = Number(sec) || 0;
    if (n <= 0) return;
    if (!totals[habitId]) totals[habitId] = {};
    totals[habitId][dateKey] = (Number(totals[habitId][dateKey]) || 0) + n;
  };

  const pushTimeline = (habitId, session, dayKeyHint = null) => {
    const bounds = parseSessionBounds(session);
    if (!bounds || !habitId) return;
    if (!timeline[habitId]) timeline[habitId] = [];
    timeline[habitId].push({
      habitId,
      startTs: bounds.startTs,
      endTs: bounds.endTs,
      durationSec: Math.max(1, Math.round((bounds.endTs - bounds.startTs) / 1000)),
      dateKey: dayKeyHint || session.dateKey || dateKeyLocal(new Date(bounds.startTs)),
      source: session.source || "ts"
    });
    if (dayKeyHint) {
      if (!coverage[habitId]) coverage[habitId] = new Set();
      coverage[habitId].add(dayKeyHint);
    }
  };

  Object.entries(raw || {}).forEach(([k, v]) => {
    if (!v || typeof v !== "object") return;

    // v1: cada key es sessionId y el value tiene habitId/durationSec
    if (typeof v.habitId === "string" && (v.durationSec != null)) {
      changed = true;
      const dateKey = v.dateKey || (v.startTs ? dateKeyLocal(new Date(v.startTs)) : null);
      add(v.habitId, dateKey, v.durationSec);
      pushTimeline(v.habitId, v, dateKey);
      return;
    }

    // v2: key = habitId y value = {dateKey: totalSec | {min,totalSec,shift}}
    const habitId = k;
    const habit = habits?.[habitId];
    const habitIsWork = habit ? isWorkHabit(habit) : false;

    Object.entries(v).forEach(([dateKey, val]) => {
      if (!dateKey) return;

      // ✅ Trabajo: si llega como número, lo normalizamos a objeto (para permitir shift)
      if (typeof val === "number") {
        if (val > 0) {
          if (habitIsWork) {
            if (!totals[habitId]) totals[habitId] = {};
            totals[habitId][dateKey] = { min: Math.round(val / 60) };
            changed = true; // antes se guardaba como número, ahora como objeto
          } else {
            add(habitId, dateKey, val);
          }
        } else {
          changed = true;
        }
        return;
      }

      if (val && typeof val === "object") {
        if (Array.isArray(val.sessions)) {
          val.sessions.forEach((session) => pushTimeline(habitId, session, dateKey));
        }
        const shift = normalizeShiftValue(val.shift);
        const min = Number(val.min);

        // ✅ preservar shift incluso con min=0 (turno M/T sin tiempo)
        if (Number.isFinite(min) && min >= 0) {
          if (!totals[habitId]) totals[habitId] = {};
          const roundedMin = Math.round(min);

          // ✅ Trabajo: SIEMPRE objeto; No-trabajo: objeto solo si hay min>0 o shift
          if (habitIsWork) {
            totals[habitId][dateKey] = shift ? { min: roundedMin, shift } : { min: roundedMin };
          } else if (roundedMin > 0 || shift) {
            totals[habitId][dateKey] = shift ? { min: roundedMin, shift } : { min: roundedMin };
          } else {
            changed = true;
          }
          return;
        }

        const sec = Number(val.totalSec) || 0;
        if (sec > 0) {
          if (!totals[habitId]) totals[habitId] = {};
          const roundedMin = Math.round(sec / 60);

          // ✅ Trabajo: objeto; No-trabajo: conserva tu comportamiento (sec si no hay shift)
          totals[habitId][dateKey] = habitIsWork
            ? (shift ? { min: roundedMin, shift } : { min: roundedMin })
            : (shift ? { min: roundedMin, shift } : sec);

          // si venía como objeto con totalSec sin min, lo “arreglamos” a min (más estable)
          changed = true;
          return;
        }

        changed = true;
      } else {
        changed = true;
      }
    });
  });

  const normalized = totals;

  if (persistRemote && changed) {
    debugHabitsSync("normalizeSessionsStore persistRemote skipped root overwrite", {
      reason: "avoid replacing full history tree",
      normalized
    });
  }

  if (changed) debugHabitsSync("normalizeSessionsStore changed", { raw, normalized });
  return { normalized, changed, timeline, coverage };
}


function getHabitTotalSecForDate(habitId, dateKey) {
  const byDate = habitSessions?.[habitId];
  if (!byDate) return 0;

  const v = byDate[dateKey];

  // caso antiguo: número en segundos
  if (typeof v === "number") return Math.max(0, v);

  // caso nuevo Trabajo: objeto {min, shift}
  if (v && typeof v === "object") {
    if (Number.isFinite(v.totalSec)) return Math.max(0, v.totalSec);
    if (Number.isFinite(v.min)) return Math.max(0, v.min * 60);
  }

  return 0;
}


function addHabitTimeSec(habitId, dateKey, secToAdd, options = {}) {
  if (!habitId || !dateKey) return 0;
  const habit = habits[habitId];
  if (!habit || habit.archived) return 0;
  const addSec = Math.max(0, Math.round(Number(secToAdd) || 0));
  if (!addSec) return getHabitTotalSecForDate(habitId, dateKey);
  if (!habitSessions[habitId] || typeof habitSessions[habitId] !== "object") habitSessions[habitId] = {};

  const isWork = isWorkHabit(habit);
  const dayRaw = habitSessions[habitId][dateKey];
  const day = readDayMinutesAndShift(dayRaw, isWork);
  const nextMinutes = day.minutes + Math.round(addSec / 60);
  const nextSec = Math.max(0, Math.round(nextMinutes * 60));
  const shift = normalizeShiftValue(options?.shift) || day.shift;

  const bounds = parseSessionBounds({
    startTs: options?.startTs,
    endTs: options?.endTs,
    durationSec: addSec,
    active: options?.active
  });

  if (isWork) {
    const payload = buildWorkDayPayload(nextMinutes, shift);
    habitSessions[habitId][dateKey] = payload;
    queuePendingSessionWrite(habitId, dateKey, payload);
    debugHabitsSync("write:add work", { habitId, dateKey, payload, dayRaw });
    saveCache();
    try {
      set(ref(db, `${HABIT_SESSIONS_PATH}/${habitId}/${dateKey}`), payload)
        .then(() => debugHabitsSync("write:add work ok", { habitId, dateKey, payload }))
        .catch((err) => {
          debugHabitsSync("write:add work fail", { habitId, dateKey, err: String(err) });
          console.warn("No se pudo guardar tiempo en remoto", err);
        });
    } catch (err) {
      console.warn("No se pudo guardar tiempo en remoto", err);
    }
  } else {
    const prevRaw = habitSessions[habitId][dateKey];
    const prevSessions = Array.isArray(prevRaw?.sessions) ? prevRaw.sessions.slice() : [];
    if (bounds) {
      prevSessions.push({
        startTs: bounds.startTs,
        endTs: bounds.endTs,
        durationSec: Math.max(1, Math.round((bounds.endTs - bounds.startTs) / 1000))
      });
      if (!habitSessionTimeline[habitId]) habitSessionTimeline[habitId] = [];
      habitSessionTimeline[habitId].push({ habitId, ...prevSessions[prevSessions.length - 1], dateKey, source: "live" });
      if (!habitSessionTimelineCoverage[habitId]) habitSessionTimelineCoverage[habitId] = new Set();
      habitSessionTimelineCoverage[habitId].add(dateKey);
    }
    const payload = prevSessions.length
      ? { totalSec: nextSec, sessions: prevSessions }
      : nextSec;
    habitSessions[habitId][dateKey] = payload;
    queuePendingSessionWrite(habitId, dateKey, payload);
    debugHabitsSync("write:add", { habitId, dateKey, nextSec, dayRaw, hasTimeline: !!prevSessions.length });
    saveCache();
    try {
      set(ref(db, `${HABIT_SESSIONS_PATH}/${habitId}/${dateKey}`), payload)
        .then(() => debugHabitsSync("write:add ok", { habitId, dateKey, payload }))
        .catch((err) => {
          debugHabitsSync("write:add fail", { habitId, dateKey, err: String(err) });
          console.warn("No se pudo guardar tiempo en remoto", err);
        });
    } catch (err) {
      console.warn("No se pudo guardar tiempo en remoto", err);
    }
  }

  // recalcular Desconocido del día
  if (habitId !== UNKNOWN_HABIT_ID) {
    try { recomputeUnknownForDate(dateKey, true); } catch (_) {}
  }
  invalidateDominantCache(dateKey);
  markHistoryDataChanged("addHabitTimeSec", { habitId, dateKey, addSec });

  return nextSec;
}

function setHabitDailyMinutes(habitId, dateKey, minutes, options = {}) {
  const min = Math.max(0, Math.round(Number(minutes) || 0));
  setHabitTimeSec(habitId, dateKey, min * 60, options);
}

function setHabitTimeSec(habitId, dateKey, totalSec, options = {}) {
  if (!habitId || !dateKey) return;
  const habit = habits[habitId];
  if (!habit || habit.archived) return;

  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  if (!habitSessions[habitId] || typeof habitSessions[habitId] !== "object") habitSessions[habitId] = {};

  const isWork = isWorkHabit(habit);
  const existing = readDayMinutesAndShift(habitSessions[habitId][dateKey], isWork);

  // ✅ solo “override” si viene shift real (M/T o "")
  const shiftOpt = (options && options.shift != null)
    ? normalizeShiftValue(options.shift)
    : existing.shift;

  let payloadToWrite = null;

  if (isWork) {
    const minutes = Math.max(0, Math.round(sec / 60));
    // ✅ permitir guardar turno aunque minutes=0
    if (minutes > 0 || shiftOpt) {
      payloadToWrite = buildWorkDayPayload(minutes, shiftOpt);
      habitSessions[habitId][dateKey] = payloadToWrite;
    } else {
      delete habitSessions[habitId][dateKey];
    }
  } else {
    payloadToWrite = sec > 0 ? sec : null;
    if (sec > 0) habitSessions[habitId][dateKey] = sec;
    else delete habitSessions[habitId][dateKey];
  }

  queuePendingSessionWrite(habitId, dateKey, payloadToWrite);
  saveCache();
  try { set(ref(db, `${HABIT_SESSIONS_PATH}/${habitId}/${dateKey}`), payloadToWrite); } catch (_) {}
  if (habitId !== UNKNOWN_HABIT_ID) { try { recomputeUnknownForDate(dateKey, true); } catch (_) {} }
  invalidateDominantCache(dateKey);
  markHistoryDataChanged("setHabitTimeSec", { habitId, dateKey, totalSec: sec });
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
    case "total": {
      const firstRecordTs = resolveFirstRecordTs({
        habitSessions,
        habitChecks,
        habitCounts,
        nowTs: Date.now()
      });
      return { start: new Date(firstRecordTs), end: new Date() };
    }
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

function resolveSeriesColor(item, idx = 0) {
  if (item?.habit) return resolveHabitColor(item.habit);
  if (item?.color) return item.color;
  return PARAM_COLOR_PALETTE[idx % PARAM_COLOR_PALETTE.length];
}

function resolveParamKeyColor(value) {
  const clean = normalizeParamKey(value);
  if (!clean) return "transparent";
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) {
    hash = ((hash << 5) - hash + clean.charCodeAt(i)) | 0;
  }
  const idx = Math.abs(hash) % PARAM_COLOR_PALETTE.length;
  return PARAM_COLOR_PALETTE[idx];
}

function setSeriesColorVars(el, item, idx = 0) {
  if (!el) return;
  const color = resolveSeriesColor(item, idx);
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
      habits = normalizeHabitsStore(parsed.habits || {});
      habitChecks = parsed.habitChecks || {};
      habitSessions = parsed.habitSessions || {};
      habitCounts = parsed.habitCounts || {};
      habitGroups = parsed.habitGroups || {};
      habitPrefs = parsed.habitPrefs || { pinCount: "", pinTime: "", quickSessions: [] };
      if (!Array.isArray(habitPrefs.quickSessions)) habitPrefs.quickSessions = [];
      habitUI = normalizeHabitUI(parsed.habitUI || {});
      scheduleState = normalizeHabitSchedule(parsed.scheduleState || parsed.habitSchedule || createDefaultHabitSchedule());
      const norm = normalizeSessionsStore(habitSessions, false);
      habitSessions = norm.normalized;
      habitSessionTimeline = norm.timeline || {};
      habitSessionTimelineCoverage = norm.coverage || {};
      if (norm.changed) saveCache();
    }
  } catch (err) {
    console.warn("No se pudo leer cache de hábitos", err);
  }
}

function saveCache() {
  invalidateCompareCache();
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ habits, habitChecks, habitSessions, habitCounts, habitGroups, habitPrefs, habitUI, scheduleState })
    );
    localStorage.setItem(HABITS_SCHEDULE_STORAGE, JSON.stringify(scheduleState));
  } catch (err) {
    console.warn("No se pudo guardar cache de hábitos", err);
  }
}


function auditScheduleWrite(path, payload) {
  console.warn("SCHEDULE WRITE", path, payload, new Error().stack);
}

function persistHabitScheduleLocal() {
  const normalized = normalizeHabitSchedule(scheduleState);
  scheduleState = normalized;
  try { localStorage.setItem(HABITS_SCHEDULE_STORAGE, JSON.stringify(normalized)); } catch (_) {}
  saveCache();
}

async function loadScheduleFromRemote() {
  try {
    console.warn("SCHEDULE UPDATE", "firebase:get:init");
    const snap = await get(ref(db, HABITS_SCHEDULE_PATH));
    const raw = snap.val();
    scheduleState = raw && typeof raw === "object"
      ? normalizeHabitSchedule(raw)
      : createDefaultHabitSchedule();
    saveCache();
  } catch (err) {
    console.warn("No se pudo leer horario remoto", err);
    scheduleState = createDefaultHabitSchedule();
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

function sortedHabitGroups() {
  return Object.values(habitGroups || {})
    .filter((group) => group && group.id && group.name)
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
}

function persistHabitGroup(group) {
  if (!group?.id) return;
  try {
    set(ref(db, `${HABIT_GROUPS_PATH}/${group.id}`), group);
  } catch (err) {
    console.warn("No se pudo guardar grupo de hábitos", err);
  }
}

function removeHabitGroupRemote(groupId) {
  if (!groupId) return;
  try {
    set(ref(db, `${HABIT_GROUPS_PATH}/${groupId}`), null);
  } catch (err) {
    console.warn("No se pudo borrar grupo de hábitos", err);
  }
}

function persistHabitPrefs() {
  saveCache();
  try {
    set(ref(db, HABIT_PREFS_PATH), habitPrefs || {});
  } catch (err) {
    console.warn("No se pudo guardar preferencias de hábitos", err);
  }
}

function normalizeHabitUI(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const quickCounters = Array.isArray(source.quickCounters)
    ? source.quickCounters.filter((id) => typeof id === "string")
    : [];
  return { quickCounters };
}

function saveUI(partial = {}) {
  const merged = normalizeHabitUI({ ...habitUI, ...(partial || {}) });
  habitUI = merged;
  saveCache();
  try {
    set(ref(db, HABIT_UI_QUICK_COUNTERS_PATH), merged.quickCounters || []);
  } catch (err) {
    console.warn("No se pudo guardar UI de hábitos", err);
  }
  renderQuickCounters();
}

function setQuickCounterPinned(habitId, enabled) {
  if (!habitId) return;
  let arr = Array.isArray(habitUI?.quickCounters) ? [...habitUI.quickCounters] : [];

  if (enabled && !arr.includes(habitId)) arr.push(habitId);
  if (!enabled) arr = arr.filter((x) => x !== habitId);

  saveUI({ quickCounters: arr });
}

function moveQuickCounter(habitId, dir) {
  if (!habitId || !Number.isFinite(dir)) return;
  const arr = Array.isArray(habitUI?.quickCounters) ? [...habitUI.quickCounters] : [];
  const i = arr.indexOf(habitId);
  if (i < 0) return;

  const j = i + dir;
  if (j < 0 || j >= arr.length) return;

  [arr[i], arr[j]] = [arr[j], arr[i]];
  saveUI({ quickCounters: arr });
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

function loadHistoryRange() {
  try {
    const stored = String(localStorage.getItem(HISTORY_RANGE_STORAGE) || "");
    const allowed = new Set(["week", "month", "year", "total"]);
    if (allowed.has(stored)) habitHistoryRange = stored;
  } catch (err) {
    console.warn("No se pudo leer rango de historial", err);
  }
}

function saveHistoryRange() {
  try {
    localStorage.setItem(HISTORY_RANGE_STORAGE, habitHistoryRange);
  } catch (err) {
    console.warn("No se pudo guardar rango de historial", err);
  }
}

function normalizeHabitCompareSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const scaleMode = source.scaleMode === "global" ? "global" : "relative";
  const marked = source.marked && typeof source.marked === "object" ? source.marked : {};
  const hidden = source.hidden && typeof source.hidden === "object" ? source.hidden : {};
  const filtersRaw = source.filters && typeof source.filters === "object" ? source.filters : {};
  const filters = {
    type: ["all", "time", "counter"].includes(filtersRaw.type) ? filtersRaw.type : "all",
    delta: ["all", "up", "down", "flat"].includes(filtersRaw.delta) ? filtersRaw.delta : "all",
    marked: ["all", "only", "hide"].includes(filtersRaw.marked) ? filtersRaw.marked : "all"
  };
  const sort = ["delta", "a", "b", "positive", "negative"].includes(source.sort) ? source.sort : "delta";
  return { scaleMode, marked, hidden, filters, sort };
}

function getHabitCompareSettingsPayload() {
  return {
    scaleMode: habitCompareScaleMode,
    marked: habitCompareMarked,
    hidden: habitCompareHidden,
    filters: habitCompareFilters,
    sort: habitCompareSort
  };
}

function applyHabitCompareSettings(raw) {
  const normalized = normalizeHabitCompareSettings(raw);
  habitCompareScaleMode = normalized.scaleMode;
  habitCompareMarked = normalized.marked;
  habitCompareHidden = normalized.hidden;
  habitCompareFilters = normalized.filters;
  habitCompareSort = normalized.sort;
}

function saveHabitCompareSettingsLocal() {
  try {
    localStorage.setItem(COMPARE_SETTINGS_STORAGE, JSON.stringify(getHabitCompareSettingsPayload()));
  } catch (err) {
    console.warn("No se pudo guardar ajustes de comparativa", err);
  }
}

function loadHabitCompareSettingsLocal() {
  try {
    const raw = localStorage.getItem(COMPARE_SETTINGS_STORAGE);
    if (!raw) return;
    applyHabitCompareSettings(JSON.parse(raw));
  } catch (err) {
    console.warn("No se pudo leer ajustes de comparativa", err);
  }
}

function persistHabitCompareSettings() {
  saveHabitCompareSettingsLocal();
  try {
    set(ref(db, HABIT_COMPARE_SETTINGS_PATH), getHabitCompareSettingsPayload());
  } catch (err) {
    console.warn("No se pudo guardar ajustes de comparativa en remoto", err);
  }
}

function isSystemHabit(habit) {
  return !!habit?.system;
}

function normalizeHabitModel(raw) {
  if (!raw || typeof raw !== "object") return null;
  const countMinuteValue = Math.max(1, Math.round(Number(raw.countMinuteValue ?? raw.countUnitMinutes) || 1));
  return {
    ...raw,
    excludeFromDominant: !!raw.excludeFromDominant,
    habitScheduleCreditEligible: !!raw.habitScheduleCreditEligible,
    countMinuteValue,
    countUnitMinutes: Number.isFinite(Number(raw.countUnitMinutes)) && Number(raw.countUnitMinutes) > 0
      ? Math.round(Number(raw.countUnitMinutes))
      : countMinuteValue
  };
}

function normalizeHabitsStore(raw) {
  const next = {};
  Object.entries(raw || {}).forEach(([id, habit]) => {
    const normalized = normalizeHabitModel(habit);
    if (normalized) next[id] = normalized;
  });
  return next;
}

function activeHabits() {
  // Hábitos "del usuario" (excluye sistema, como Desconocido)
  return Object.values(habits).filter((h) => h && !h.archived && !isSystemHabit(h));
}

function activeHabitsWithSystem() {
  // Incluye sistema (p.ej. Desconocido) para métricas de tiempo
  return Object.values(habits).filter((h) => h && !h.archived);
}

function normalizeParamLabel(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeParamKey(value) {
  return normalizeParamLabel(value).toLowerCase();
}

function normalizeDonutGroupKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function parseParam(value) {
  const raw = normalizeParamLabel(value);
  if (!raw) return null;
  const idx = raw.indexOf(":");
  if (idx <= 0) return null;
  const cat = normalizeParamKey(raw.slice(0, idx));
  const val = normalizeParamKey(raw.slice(idx + 1));
  if (!cat || !val) return null;
  return { cat, val };
}

function resolveHabitCategoryValue(habit, catName) {
  if (!habit || !catName) return null;
  const target = normalizeParamKey(catName);
  if (!target) return null;
  const values = new Set(
    getHabitParams(habit)
      .map(parseParam)
      .filter((parsed) => parsed && parsed.cat === target)
      .map((parsed) => parsed.val)
  );
  if (!values.size) return null;
  if (values.size > 1) return "mixto";
  return Array.from(values)[0];
}

function getHabitParams(habit) {
  if (!habit || !Array.isArray(habit.params)) return [];
  return habit.params.map(normalizeParamLabel).filter(Boolean);
}

function collectCategories(habitsList) {
  const set = new Set();
  (habitsList || []).forEach((habit) => {
    getHabitParams(habit).forEach((param) => {
      const parsed = parseParam(param);
      if (parsed?.cat) set.add(parsed.cat);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

function collectValuesForCategory(habitsList, catName) {
  const target = normalizeParamKey(catName);
  const set = new Set();
  (habitsList || []).forEach((habit) => {
    getHabitParams(habit).forEach((param) => {
      const parsed = parseParam(param);
      if (parsed && parsed.cat === target && parsed.val) set.add(parsed.val);
    });
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

function getAllHabitParams() {
  const set = new Set();
  activeHabits().forEach((habit) => {
    getHabitParams(habit).forEach((param) => set.add(param));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

function ensureUnknownHabit(persistRemote = true) {
  const existing = habits?.[UNKNOWN_HABIT_ID];
  if (existing && !existing.archived) return existing;

  const payload = {
    id: UNKNOWN_HABIT_ID,
    name: UNKNOWN_HABIT_NAME,
    emoji: UNKNOWN_HABIT_EMOJI,
    color: UNKNOWN_HABIT_COLOR,
    goal: "time",
    groupId: "",
    groupPrivate: false,
    groupLowUse: true,
    targetMinutes: null,
    countMinuteValue: 1,
    countUnitMinutes: null,
    habitScheduleCreditEligible: false,
    quickAdds: [],
    params: [],
    schedule: { type: "daily", days: [] },
    createdAt: existing?.createdAt || 0,
    archived: false,
    system: true
  };

  habits[UNKNOWN_HABIT_ID] = payload;
  saveCache();
  if (persistRemote) {
    try { persistHabit(payload); } catch (_) {}
  }
  return payload;
}

function computeUnknownSecForDate(dateKey) {
  if (!dateKey) return 0;

  let assigned = 0;
  Object.keys(habitSessions || {}).forEach((hid) => {
    if (hid === UNKNOWN_HABIT_ID) return;
    const h = habits?.[hid];
    if (!h || h.archived) return;

    assigned += getHabitTotalSecForDate(hid, dateKey); // ✅ Trabajo entra aquí
  });

  assigned = Math.min(DAY_SEC, Math.max(0, Math.round(assigned)));
  return Math.max(0, DAY_SEC - assigned);
}



function recomputeUnknownForDate(dateKey, persistRemote = false) {
  if (!dateKey) return 0;
  ensureUnknownHabit(false);

  const next = computeUnknownSecForDate(dateKey);
  const cur = Number(habitSessions?.[UNKNOWN_HABIT_ID]?.[dateKey]) || 0;

  if (Math.abs((cur || 0) - next) < 1) return cur || 0;

  if (!habitSessions[UNKNOWN_HABIT_ID] || typeof habitSessions[UNKNOWN_HABIT_ID] !== "object") {
    habitSessions[UNKNOWN_HABIT_ID] = {};
  }
  if (next > 0) habitSessions[UNKNOWN_HABIT_ID][dateKey] = next;
  else delete habitSessions[UNKNOWN_HABIT_ID][dateKey];

  saveCache();

  if (persistRemote) {
    try {
      set(ref(db, `${HABIT_SESSIONS_PATH}/${UNKNOWN_HABIT_ID}/${dateKey}`), next > 0 ? next : null);
    } catch (err) {
      console.warn("No se pudo guardar tiempo Desconocido en remoto", err);
    }
  }

  return next;
}


function getSessionsForDate(dateKey) {
  const out = [];
  if (!dateKey) return out;
  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    const sec = getHabitTotalSecForDate(habitId, dateKey);
    if (sec > 0) out.push({ habitId, dateKey, durationSec: sec, source: "total" });
  });
  return out;
}


function getSessionsForHabitDate(habitId, dateKey) {
  const sec = getHabitTotalSecForDate(habitId, dateKey);
  return sec > 0 ? [{ habitId, dateKey, durationSec: sec, startTs: null, endTs: null, source: "total" }] : [];
}


function hasSessionForHabitDate(habitId, dateKey) {
  return getHabitTotalSecForDate(habitId, dateKey) > 0;
}

function isHabitCompletedOnDate(habit, dateKey) {
  return getHabitDayScore(habit, dateKey).hasActivity;
}

function countCompletedHabitsForDate(dateKey) {
  return activeHabits().reduce((acc, habit) => (isHabitCompletedOnDate(habit, dateKey) ? acc + 1 : acc), 0);
}

function collectDateKeysInRange(start, end) {
  const keys = new Set();
  Object.entries(habitChecks).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end)) keys.add(key);
    });
  });

  Object.entries(habitCounts).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end)) keys.add(key);
    });
  });

  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.keys(byDate).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end)) keys.add(key);
    });
  });

  return keys;
}

function countCompletedHabitsForRange(start, end) {
  const keys = collectDateKeysInRange(start, end);
  let total = 0;
  keys.forEach((key) => {
    total += countCompletedHabitsForDate(key);
  });
  return total;
}

function countActiveDaysInRange(start, end) {
  const dates = new Set();

  Object.entries(habitChecks).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end)) dates.add(key);
    });
  });

  Object.entries(habitCounts).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && Number(entries[key]) > 0) dates.add(key);
    });
  });

  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.keys(byDate).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && getHabitTotalSecForDate(habit.id, key) > 0) dates.add(key);
    });
  });

  return dates.size;
}


function collectHabitActivityDatesSet(habit) {
  const dates = new Set();
  if (!habit || habit.archived) return dates;

  const checks = habitChecks[habit.id] || {};
  Object.keys(checks).forEach((key) => dates.add(key));

  const counts = habitCounts[habit.id] || {};
  Object.keys(counts).forEach((key) => {
    if (Number(counts[key]) > 0) dates.add(key);
  });

  const byDate = habitSessions?.[habit.id];
  if (byDate && typeof byDate === "object") {
    Object.keys(byDate).forEach((key) => {
      if (getHabitTotalSecForDate(habit.id, key) > 0) dates.add(key);
    });
  }

  return dates;
}

function countHabitActivityDays(habit) {
  return collectHabitActivityDatesSet(habit).size;
}

function getHabitDayScore(habit, dateKey) {
  if (!habit || habit.archived) return { score: 0, minutes: 0, checked: false, count: 0, hasActivity: false };
  const goal = habit.goal || "check";
  if (goal === "count") {
    const count = getHabitCount(habit.id, dateKey);
    const hasActivity = count > 0;
    return { score: hasActivity ? 1 : 0, minutes: 0, checked: false, count, hasActivity };
  }
  const checked = !!(habitChecks[habit.id] && habitChecks[habit.id][dateKey]);
  const { doneMin: minutes } = computeHabitDayTotals(habit.id, dateKey, "00:00", { includeRunning: false });
  const timeScore = Math.min(3, Math.floor(minutes / 30));
  const score = (checked ? 1 : 0) + timeScore;
  return { score, minutes, checked, count: 0, hasActivity: checked || minutes > 0 };
}

function invalidateCompareCache() {
  habitCompareAggregateCache.clear();
  habitCompareAverageCache.clear();
  habitStatsSeriesCache.clear();
  habitStatsResultCache.clear();
  debugCompare("cache invalidated", { dataVersion: habitHistoryDataVersion, updatedAt: habitHistoryUpdatedAt });
}

function invalidateDominantCache(dateKey = null) {
  if (!dateKey) {
    dayDominantCache.clear();
    return;
  }
  dayDominantCache.delete(dateKey);
}

function getHabitDominantValue(habit, dateKey) {
  if (!habit || habit.archived) return { value: 0, minutes: 0 };
  const goal = habit.goal || "check";
  if (goal === "time") {
    const minutes = getHabitValueForDate(habit, dateKey);
    return { value: minutes, minutes };
  }
  if (goal === "count") {
    const count = getHabitValueForDate(habit, dateKey);
    return { value: count, minutes: 0 };
  }
  const check = getHabitValueForDate(habit, dateKey) > 0 ? 1 : 0;
  return { value: check, minutes: 0 };
}

function getDayDominantHabit(dateKey) {
  if (!dateKey) return null;
  if (dayDominantCache.has(dateKey)) return dayDominantCache.get(dateKey);
  const ranked = activeHabits()
    .filter((habit) => !habit.excludeFromDominant)
    .map((habit) => {
      const { value, minutes } = getHabitDominantValue(habit, dateKey);
      return { habit, value, minutes };
    })
    .filter((item) => item.value > 0)
    .sort((a, b) => {
      if (b.value !== a.value) return b.value - a.value;
      if (b.minutes !== a.minutes) return b.minutes - a.minutes;
      const byName = (a.habit.name || "").localeCompare(b.habit.name || "", "es");
      if (byName !== 0) return byName;
      return String(a.habit.id || "").localeCompare(String(b.habit.id || ""), "es");
    });
  const winner = ranked[0] || null;
  dayDominantCache.set(dateKey, winner);
  return winner;
}

function getWorkHabitEntry(dateKey) {
  const work = activeHabits().find((h) => isWorkHabit(h));
  if (!work) return { shift: null, hasEntry: false };
  const pending = pendingSessionWrites.get(sessionWriteKey(work.id, dateKey));
  if (pending && Object.prototype.hasOwnProperty.call(pending, "value")) {
    return readDayMinutesAndShift(pending.value, true);
  }
  return readDayMinutesAndShift(habitSessions?.[work.id]?.[dateKey], true);
}

function getShiftForDate(dateKey) {
  return getWorkHabitEntry(dateKey);
}

function getShiftClassForDate(dateKey) {
  const entry = getShiftForDate(dateKey);
  if (entry.shift === "M") return "is-work-morning";
  if (entry.shift === "T") return "is-work-evening";
  if (entry.hasEntry) return "is-work-unknown";
  return "is-work-free";
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

  Object.entries(habitCounts).forEach(([habitId, dates]) => {
    if (habits[habitId]?.archived) return;
    Object.keys(dates || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed) years.add(parsed.getFullYear());
    });
  });

  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    if (habits[habitId]?.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.keys(byDate).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed) years.add(parsed.getFullYear());
    });
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
const $btnAddTime = document.getElementById("habit-add-time");
const $habitWeekTimeline = document.getElementById("habit-week-timeline");
const $habitFabAdd = document.getElementById("habit-fab-add");
const $habitCustomGroups = document.getElementById("habit-custom-groups");

// Hoy (agrupado)
const $habitTodayCountPending = document.getElementById("habits-today-count-pending");
const $habitTodayCountDone = document.getElementById("habits-today-count-done");
const $habitTodayCountEmpty = document.getElementById("habits-today-count-empty");
const $habitTodayCountDoneEmpty = document.getElementById("habits-today-count-done-empty");
const $habitTodayTimePending = document.getElementById("habits-today-time-pending");
const $habitTodayTimeDone = document.getElementById("habits-today-time-done");
const $habitTodayTimeEmpty = document.getElementById("habits-today-time-empty");
const $habitTodayTimeDoneEmpty = document.getElementById("habits-today-time-done-empty");
const $habitTodayCountMeta = document.getElementById("habits-today-count-meta");
const $habitTodayTimeMeta = document.getElementById("habits-today-time-meta");
const $habitTodayCountPreview = document.getElementById("habits-today-count-preview");
const $habitTodayTimePreview = document.getElementById("habits-today-time-preview");
const $habitTodaySearchInput = document.getElementById("habit-today-search-input");
const $habitTodaySearchClear = document.getElementById("habit-today-search-clear");
const $habitTodaySearchEmpty = document.getElementById("habit-today-search-empty");
const $habitTodaySearchReset = document.getElementById("habit-today-search-reset");
const $habitQuickSessionsWrap = document.getElementById("habit-quick-sessions");
const $habitQuickSessionsMeta = document.getElementById("habit-quick-sessions-meta");
const $habitQuickSessionsPreview = document.getElementById("habit-quick-sessions-preview");
const $habitQuickSessionsSelect = document.getElementById("habit-quick-sessions-select");
const $habitQuickSessionsAdd = document.getElementById("habit-quick-sessions-add");
const $habitQuickSessionsRow = document.getElementById("habit-quick-sessions-row");
const $habitQuickSessionsEmpty = document.getElementById("habit-quick-sessions-empty");
const $quickCountersWrap = document.querySelector(".quick-counters-wrap");
const $quickCountersBody = document.getElementById("quick-counters-body");
const $quickCountersGrid = document.getElementById("quick-counters-grid");
const $quickCounterCount = document.getElementById("quick-counter-count");

// Hoy (grupos plegables)
const $todayCountPendingPrivateWrap = document.getElementById("habits-today-count-pending-private-wrap");
const $todayCountPendingPrivate = document.getElementById("habits-today-count-pending-private");
const $todayCountPendingLowWrap = document.getElementById("habits-today-count-pending-low-wrap");
const $todayCountPendingLow = document.getElementById("habits-today-count-pending-low");

const $todayCountDonePrivateWrap = document.getElementById("habits-today-count-done-private-wrap");
const $todayCountDonePrivate = document.getElementById("habits-today-count-done-private");
const $todayCountDoneLowWrap = document.getElementById("habits-today-count-done-low-wrap");
const $todayCountDoneLow = document.getElementById("habits-today-count-done-low");

const $todayTimePendingPrivateWrap = document.getElementById("habits-today-time-pending-private-wrap");
const $todayTimePendingPrivate = document.getElementById("habits-today-time-pending-private");
const $todayTimePendingLowWrap = document.getElementById("habits-today-time-pending-low-wrap");
const $todayTimePendingLow = document.getElementById("habits-today-time-pending-low");

const $todayTimeDonePrivateWrap = document.getElementById("habits-today-time-done-private-wrap");
const $todayTimeDonePrivate = document.getElementById("habits-today-time-done-private");
const $todayTimeDoneLowWrap = document.getElementById("habits-today-time-done-low-wrap");
const $todayTimeDoneLow = document.getElementById("habits-today-time-done-low");
const $habitWeekList = document.getElementById("habits-week-list");
const $habitWeekEmpty = document.getElementById("habits-week-empty");
const $habitHistoryList = document.getElementById("habits-history-list");
const $habitHistoryEmpty = document.getElementById("habits-history-empty");
const $habitExportBtn = document.getElementById("habits-export-btn");
const $habitKpiToday = document.getElementById("habit-kpi-today");
const $habitKpiTotalHours = document.getElementById("habit-kpi-total-hours");
const $habitKpiTotalHoursRange = document.getElementById("habit-kpi-total-hours-range");
const $habitKpiActiveDaysTotal = document.getElementById("habit-kpi-active-days-total");
const $habitKpiTodayLabel = document.getElementById("habit-kpi-today-label");
const $habitKpiActiveDaysLabel = document.getElementById("habit-kpi-active-days-label");
const $habitKpiStreakLabel = document.getElementById("habit-kpi-streak-label");
const $habitKpiStreakTotal = document.getElementById("habit-kpi-streak-total");
const $habitKpiStreakTotalSub = document.getElementById("habit-kpi-streak-total-sub");
const $habitPinCountToday = document.getElementById("habit-pin-count-today");
const $habitPinCountRange = document.getElementById("habit-pin-count-range");
const $habitPinCountSelect = document.getElementById("habit-pin-count-select");
const $habitPinTimeToday = document.getElementById("habit-pin-time-today");
const $habitPinTimeRange = document.getElementById("habit-pin-time-range");
const $habitPinTimeSelect = document.getElementById("habit-pin-time-select");
const $habitRecordsSub = document.getElementById("habit-records-sub");
const $habitRecordsCurrentStreak = document.getElementById("habit-records-current-streak");
const $habitRecordsBestStreak = document.getElementById("habit-records-best-streak");
const $habitRecordsCompleted = document.getElementById("habit-records-completed");
const $habitRecordsCompletedSub = document.getElementById("habit-records-completed-sub");
const $habitRecordsSuccess = document.getElementById("habit-records-success");
const $habitRecordsRangeButtons = document.querySelectorAll(".habit-records-range-btn");
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
const $habitAccCounts = document.getElementById("habit-acc-counts");
const $habitAccCountsMeta = document.getElementById("habit-acc-counts-meta");
const $habitCountsList = document.getElementById("habit-counts-list");
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
const $habitDonutTitle = document.getElementById("habit-donut-title");
const $habitDonutGroup = document.getElementById("habit-donut-group");
const $habitRangeButtons = document.querySelectorAll(".habit-donut-card .habit-range-btn");
const $habitDaysRangeButtons = document.querySelectorAll(".habit-days-range-btn");
const $habitFab = document.getElementById("habit-session-toggle");
const $habitOverlay = document.getElementById("habit-session-overlay");
const $habitOverlayTime = document.getElementById("habit-session-time");
const $habitOverlayStop = document.getElementById("habit-session-stop");
const $habitDaysList = document.getElementById("habit-days-list");
const $habitDetailOverlay = document.getElementById("habit-detail-overlay");
const $habitDetailClose = document.getElementById("habit-detail-close");
const $habitDetailEmoji = document.getElementById("habit-detail-emoji");
const $habitDetailEdit = document.getElementById("habit-detail-edit");
const $habitDetailTitle = document.getElementById("habit-detail-title");
const $habitDetailMeta = document.getElementById("habit-detail-meta");
const $habitDetailTotal = document.getElementById("habit-detail-total");
const $habitDetailStatus = document.getElementById("habit-detail-status");
const $habitDetailStreak = document.getElementById("habit-detail-streak");
const $habitDetailGoal = document.getElementById("habit-detail-goal");
const $habitDetailActions = document.getElementById("habit-detail-actions");
const $habitDetailRangeButtons = document.querySelectorAll(".habit-detail-range .habit-range-btn");
const $habitDetailHeatmapSub = document.getElementById("habit-detail-heatmap-sub");
const $habitDetailHeatmap = document.getElementById("habit-detail-heatmap");
const $habitDetailChart = document.getElementById("habit-detail-chart");
const $habitDetailChartSub = document.getElementById("habit-detail-chart-sub");
const $habitDetailChartMeta = document.getElementById("habit-detail-chart-meta");
const $habitDetailChartMode = document.getElementById("habit-detail-chart-mode");
const $habitDetailChartRange = document.getElementById("habit-detail-chart-range");
const $habitDetailRecordsSub = document.getElementById("habit-detail-records-sub");
const $habitDetailRecords = document.getElementById("habit-detail-records");
const $habitDetailRecordsWrap = document.getElementById("habit-detail-records-wrap");
const $habitDetailRecordsMore = document.getElementById("habit-detail-records-more");
const $habitDetailInsightsSub = document.getElementById("habit-detail-insights-sub");
const $habitDetailInsights = document.getElementById("habit-detail-insights");
const $habitDetailScheduleStatus = document.getElementById("habit-detail-schedule-status");
const $habitDetailScheduleDayChips = document.getElementById("habit-detail-schedule-day-chips");
const $habitDetailScheduleTypeChips = document.getElementById("habit-detail-schedule-type-chips");
const $habitDetailScheduleDaysAll = document.getElementById("habit-detail-schedule-days-all");
const $habitDetailScheduleDaysWork = document.getElementById("habit-detail-schedule-days-work");
const $habitDetailScheduleDaysWeekend = document.getElementById("habit-detail-schedule-days-weekend");
const $habitDetailScheduleDaysClear = document.getElementById("habit-detail-schedule-days-clear");
const $habitDetailScheduleMode = document.getElementById("habit-detail-schedule-mode");
const $habitDetailScheduleValue = document.getElementById("habit-detail-schedule-value");
const $habitDetailScheduleSave = document.getElementById("habit-detail-schedule-save");
const $habitDetailScheduleRemove = document.getElementById("habit-detail-schedule-remove");


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
const $habitExcludeDominant = document.getElementById("habit-exclude-dominant");
const $habitTargetMinutes = document.getElementById("habit-target-minutes");
const $habitTargetMinutesWrap = document.getElementById("habit-target-minutes-wrap");
const $habitCountUnitMinutes = document.getElementById("habit-count-unit-minutes");
const $habitCountUnitMinutesWrap = document.getElementById("habit-count-unit-minutes-wrap");
const $habitCreditEligible = document.getElementById("habit-credit-eligible");
const $habitQuickCounterPinnedWrap = document.getElementById("habit-quick-counter-pinned-wrap");
const $habitQuickCounterPinned = document.getElementById("habit-quick-counter-pinned");
const $habitQuickCounterOrderWrap = document.getElementById("habit-quick-counter-order-wrap");
const $habitQuickCounterUp = document.getElementById("habit-quick-counter-up");
const $habitQuickCounterDown = document.getElementById("habit-quick-counter-down");
const $habitQuickAddsWrap = document.getElementById("habit-quick-adds-wrap");
const $habitQuick1Label = document.getElementById("habit-quick1-label");
const $habitQuick1Minutes = document.getElementById("habit-quick1-minutes");
const $habitQuick2Label = document.getElementById("habit-quick2-label");
const $habitQuick2Minutes = document.getElementById("habit-quick2-minutes");
const $habitDaysSelector = document.getElementById("habit-days-selector");
const $habitGroupPrivate = document.getElementById("habit-group-private");
const $habitGroupLowUse = document.getElementById("habit-group-lowuse");
const $habitGroupSelect = document.getElementById("habit-group-select");
const $habitGroupNew = document.getElementById("habit-group-new");
const $habitGroupCreate = document.getElementById("habit-group-create");
const $habitGroupRename = document.getElementById("habit-group-rename");
const $habitGroupRenameBtn = document.getElementById("habit-group-rename-btn");
const $habitGroupDeleteBtn = document.getElementById("habit-group-delete-btn");
const $habitParamSelect = document.getElementById("habit-param-select");
const $habitParamAdd = document.getElementById("habit-param-add");
const $habitParamList = document.getElementById("habit-param-list");
const $habitParamNewWrap = document.getElementById("habit-param-new-wrap");
const $habitParamNew = document.getElementById("habit-param-new");
const $habitParamCreate = document.getElementById("habit-param-create");

// Sesión modal
const $habitSessionModal = document.getElementById("habit-session-modal");
const $habitSessionClose = document.getElementById("habit-session-close");
const $habitSessionCancel = document.getElementById("habit-session-cancel");
const $habitSessionSearch = document.getElementById("habit-session-search");
const $habitSessionList = document.getElementById("habit-session-list");
const $habitSessionLast = document.getElementById("habit-session-last");
const $habitSessionScroll = $habitSessionModal?.querySelector(".modal-scroll");
const $habitSessionSheet = $habitSessionModal?.querySelector(".modal");

// Manual time modal
const $habitManualModal = document.getElementById("habit-manual-modal");
const $habitManualForm = document.getElementById("habit-manual-form");
const $habitManualHabit = document.getElementById("habit-manual-habit");
const $habitManualMinutes = document.getElementById("habit-manual-minutes");
const $habitManualDate = document.getElementById("habit-manual-date");

// Entry edit modal
const $habitEntryModal = document.getElementById("habit-entry-modal-backdrop");
const $habitEntryClose = document.getElementById("habit-entry-close");
const $habitEntryCancel = document.getElementById("habit-entry-cancel");
const $habitEntryForm = document.getElementById("habit-entry-form");
const $habitEntryHabit = document.getElementById("habit-entry-habit");
const $habitEntryDate = document.getElementById("habit-entry-date");
const $habitEntryCheckWrap = document.getElementById("habit-entry-check-wrap");
const $habitEntryCheck = document.getElementById("habit-entry-check");
const $habitEntryCountWrap = document.getElementById("habit-entry-count-wrap");
const $habitEntryCount = document.getElementById("habit-entry-count");
const $habitEntryCountMinus = document.getElementById("habit-entry-count-minus");
const $habitEntryCountPlus = document.getElementById("habit-entry-count-plus");
const $habitEntrySessions = document.getElementById("habit-entry-sessions");

const $habitDayDetailModal = document.getElementById("habit-day-detail-modal");
const $habitDayDetailTitle = document.getElementById("habit-day-detail-title");
const $habitDayDetailDate = document.getElementById("habit-day-detail-date");
const $habitDayDetailList = document.getElementById("habit-day-detail-list");
const $habitDayDetailClose = document.getElementById("habit-day-detail-close");
const $habitDayDetailCancel = document.getElementById("habit-day-detail-cancel");
const $habitDayDetailSave = document.getElementById("habit-day-detail-save");
const $habitScheduleView = document.getElementById("habit-schedule-view");
const $habitScheduleSummaryModal = document.getElementById("habit-schedule-summary-modal");
const $habitScheduleSummaryTitle = document.getElementById("habit-schedule-summary-title");
const $habitScheduleSummaryContent = document.getElementById("habit-schedule-summary-content");
const $habitScheduleSummaryClose = document.getElementById("habit-schedule-summary-close");
const $habitScheduleSummaryCancel = document.getElementById("habit-schedule-summary-cancel");
const $habitManualClose = document.getElementById("habit-manual-close");
const $habitManualCancel = document.getElementById("habit-manual-cancel");

const DEFAULT_TIME_INPUT_VALUE = "00:00";

function bindTimeInputDefault(input) {
  if (!input) return;
  const setDefaultIfEmpty = () => {
    if (!input.value) input.value = DEFAULT_TIME_INPUT_VALUE;
  };
  ["pointerdown", "mousedown", "touchstart", "focus"].forEach((eventName) => {
    input.addEventListener(eventName, setDefaultIfEmpty, { capture: true });
  });
}

bindTimeInputDefault($habitManualMinutes);

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
  invalidateDominantCache(dateKey);
  renderHabitsPreservingTodayUI();
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
function getHabitCount(habitId, dateKey) {
  const raw = habitCounts?.[habitId]?.[dateKey];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function setHabitCount(habitId, dateKey, value) {
  if (!habitId || !dateKey) return;
  const habit = habits[habitId];
  if (!habit || habit.archived) return;

  const prev = getHabitCount(habitId, dateKey);

  const n = Number(value);
  const safe = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;

  if (!habitCounts[habitId]) habitCounts[habitId] = {};
  if (safe > 0) habitCounts[habitId][dateKey] = safe;
  else delete habitCounts[habitId][dateKey];

  // Si el contador tiene "minutos por vez", lo volcamos a tiempo total del día
  const per = Math.round(Number(habit.countUnitMinutes) || 0);
  if ((habit.goal || "check") === "count" && per > 0) {
    const curTotal = getHabitTotalSecForDate(habitId, dateKey);
    const prevSec = Math.round(prev * per * 60);
    const baseSec = Math.max(0, curTotal - prevSec);
    const nextSec = baseSec + Math.round(safe * per * 60);
    setHabitTimeSec(habitId, dateKey, nextSec); // incluye save + remoto
  } else {
    saveCache();
  }

  persistHabitCount(habitId, dateKey, safe > 0 ? safe : null);
  invalidateDominantCache(dateKey);
  renderHabitsPreservingTodayUI();
}

function adjustHabitCount(habitId, dateKey, delta) {
  const current = getHabitCount(habitId, dateKey);
  setHabitCount(habitId, dateKey, current + Number(delta || 0));
}

function persistHabitCount(habitId, dateKey, value) {
  if (!habitId || !dateKey) return;
  try {
    const path = `${HABIT_COUNTS_PATH}/${habitId}/${dateKey}`;
    set(ref(db, path), value);
  } catch (err) {
    console.warn("No se pudo guardar conteo en remoto", err);
  }
}

function renderHabitParamChips() {
  if (!$habitParamList) return;
  $habitParamList.innerHTML = "";
  habitEditingParams.forEach((param) => {
    const chip = document.createElement("div");
    chip.className = "habit-param-chip";
    const label = document.createElement("span");
    label.textContent = param;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "habit-param-remove";
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      habitEditingParams = habitEditingParams.filter((item) => item !== param);
      renderHabitParamChips();
    });
    chip.appendChild(label);
    chip.appendChild(remove);
    $habitParamList.appendChild(chip);
  });
}

function syncHabitParamSelectOptions() {
  if (!$habitParamSelect) return;
  const currentValues = new Set(Array.from($habitParamSelect.options).map((opt) => opt.value));
  const dynamicValues = [...getAllHabitParams(), ...habitEditingParams]
    .map(normalizeParamLabel)
    .filter(Boolean);
  const uniqueValues = Array.from(new Set(dynamicValues)).filter((value) => !currentValues.has(value));
  const newMarker = Array.from($habitParamSelect.options).find((opt) => opt.value === "__new__") || null;
  uniqueValues.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    $habitParamSelect.insertBefore(option, newMarker);
  });
}

function addHabitParam(value) {
  const clean = normalizeParamLabel(value);
  if (!clean) return;
  if (habitEditingParams.includes(clean)) return;
  habitEditingParams = [...habitEditingParams, clean];
  renderHabitParamChips();
  syncHabitParamSelectOptions();
}

function toggleParamNewInput(show) {
  if (!$habitParamNewWrap) return;
  $habitParamNewWrap.classList.toggle("hidden", !show);
  if (!show && $habitParamNew) $habitParamNew.value = "";
}

function syncHabitGroupSelect(selectedId = "") {
  if (!$habitGroupSelect) return;
  $habitGroupSelect.innerHTML = "";
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "Sin grupo";
  $habitGroupSelect.appendChild(noneOpt);
  sortedHabitGroups().forEach((group) => {
    const opt = document.createElement("option");
    opt.value = group.id;
    opt.textContent = group.name;
    $habitGroupSelect.appendChild(opt);
  });
  $habitGroupSelect.value = selectedId || "";
  if ($habitGroupRename) {
    const current = habitGroups?.[selectedId];
    $habitGroupRename.value = current?.name || "";
  }
}

function createHabitGroup(name) {
  const clean = String(name || "").trim();
  if (!clean) return null;
  const id = `g-${Date.now().toString(36)}`;
  const group = { id, name: clean, createdAt: Date.now() };
  habitGroups[id] = group;
  saveCache();
  persistHabitGroup(group);
  return group;
}

function renameHabitGroup(groupId, nextName) {
  const group = habitGroups?.[groupId];
  const clean = String(nextName || "").trim();
  if (!group || !clean) return false;
  habitGroups[groupId] = { ...group, name: clean };
  saveCache();
  persistHabitGroup(habitGroups[groupId]);
  return true;
}

function deleteHabitGroup(groupId) {
  const group = habitGroups?.[groupId];
  if (!group) return;
  delete habitGroups[groupId];
  Object.values(habits || {}).forEach((habit) => {
    if (habit?.groupId === groupId) {
      habit.groupId = "";
      persistHabit(habit);
    }
  });
  saveCache();
  removeHabitGroupRemote(groupId);
}


function openHabitModal(habit = null) {
  $habitModal.classList.remove("hidden");
  $habitId.value = habit ? habit.id : "";
  $habitModalTitle.textContent = habit ? "Editar hábito" : "Nuevo hábito";
  $habitName.value = habit ? habit.name || "" : "";
  $habitEmoji.value = habit ? habit.emoji || "" : "";
  $habitColor.value = habit && habit.color ? habit.color : DEFAULT_COLOR;
  if ($habitExcludeDominant) $habitExcludeDominant.checked = !!(habit && habit.excludeFromDominant);
  syncHabitGroupSelect(habit?.groupId || "");
  if ($habitGroupPrivate) $habitGroupPrivate.checked = !!(habit && habit.groupPrivate);
  if ($habitGroupLowUse) $habitGroupLowUse.checked = !!(habit && habit.groupLowUse);
  $habitTargetMinutes.value = habit && habit.targetMinutes ? habit.targetMinutes : "";
  if ($habitCountUnitMinutes) $habitCountUnitMinutes.value = habit && (habit.countMinuteValue || habit.countUnitMinutes) ? (habit.countMinuteValue || habit.countUnitMinutes) : "";
  if ($habitCreditEligible) $habitCreditEligible.checked = !!(habit && habit.habitScheduleCreditEligible);
  if ($habitQuickCounterPinned) {
    const quickIds = Array.isArray(habitUI?.quickCounters) ? habitUI.quickCounters : [];
    $habitQuickCounterPinned.checked = !!(habit?.id && quickIds.includes(habit.id));
  }
  const qas = habit && Array.isArray(habit.quickAdds) ? habit.quickAdds : [];
  const workDefaults = isWorkHabit(habit) ? [{ label: "M", minutes: 480 }, { label: "T", minutes: 480 }] : null;
  if ($habitQuick1Label) $habitQuick1Label.value = qas[0]?.label || workDefaults?.[0]?.label || "";
  if ($habitQuick1Minutes) $habitQuick1Minutes.value = qas[0]?.minutes ? String(qas[0].minutes) : (workDefaults?.[0]?.minutes ? String(workDefaults[0].minutes) : "");
  if ($habitQuick2Label) $habitQuick2Label.value = qas[1]?.label || workDefaults?.[1]?.label || "";
  if ($habitQuick2Minutes) $habitQuick2Minutes.value = qas[1]?.minutes ? String(qas[1].minutes) : (workDefaults?.[1]?.minutes ? String(workDefaults[1].minutes) : "");
  habitEditingParams = getHabitParams(habit);
  renderHabitParamChips();
  syncHabitParamSelectOptions();
  if ($habitParamSelect) $habitParamSelect.value = "";
  toggleParamNewInput(false);
  const goal = habit && (habit.goal === "time" || habit.goal === "count") ? habit.goal : "check";
  $habitForm.querySelector(`input[name=\"habit-goal\"][value=\"${goal}\"]`).checked = true;
  const scheduleType = habit && habit.schedule && habit.schedule.type === "days" ? "days" : "daily";
  $habitForm.querySelector(`input[name=\"habit-schedule\"][value=\"${scheduleType}\"]`).checked = true;
  Array.from($habitDaysSelector.querySelectorAll("button")).forEach((btn) => {
    const day = Number(btn.dataset.day);
    const active = scheduleType === "days" && habit && Array.isArray(habit.schedule?.days) && habit.schedule.days.includes(day);
    btn.classList.toggle("is-active", active);
  });
  $habitDelete.style.display = habit ? "inline-flex" : "none";
  updateHabitGoalUI();
}

function updateHabitGoalUI() {
  const goal = $habitForm?.querySelector('input[name="habit-goal"]:checked')?.value || "check";

  if ($habitTargetMinutesWrap) {
    $habitTargetMinutesWrap.style.display = goal === "time" ? "block" : "none";
  }
  if ($habitCountUnitMinutesWrap) {
    $habitCountUnitMinutesWrap.style.display = goal === "count" ? "block" : "none";
  }
  if ($habitQuickCounterPinnedWrap) {
    $habitQuickCounterPinnedWrap.style.display = goal === "count" ? "block" : "none";
  }
  if ($habitQuickCounterOrderWrap) {
    $habitQuickCounterOrderWrap.style.display = goal === "count" ? "flex" : "none";
  }
  if ($habitQuickAddsWrap) {
    $habitQuickAddsWrap.style.display = goal === "time" ? "block" : "none";
  }
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

  const groupPrivate = !!$habitGroupPrivate?.checked;
  const groupLowUse = !!$habitGroupLowUse?.checked;
  const groupId = $habitGroupSelect?.value || "";
  const safeGroupId = habitGroups?.[groupId] ? groupId : "";

  const goal = $habitForm.querySelector("input[name=\"habit-goal\"]:checked")?.value || "check";
  const scheduleType = $habitForm.querySelector("input[name=\"habit-schedule\"]:checked")?.value || "daily";
  const days = Array.from($habitDaysSelector.querySelectorAll("button.is-active")).map((b) => Number(b.dataset.day));

  const targetMinutes = $habitTargetMinutes?.value ? Number($habitTargetMinutes.value) : null;
  const safeTargetMinutes = goal === "time" ? targetMinutes : null;

  const unit = $habitCountUnitMinutes?.value ? Number($habitCountUnitMinutes.value) : null;
  const safeUnit = goal === "count" ? unit : null;
  const habitScheduleCreditEligible = !!$habitCreditEligible?.checked;

  const qa1m = $habitQuick1Minutes?.value ? Number($habitQuick1Minutes.value) : 0;
  const qa2m = $habitQuick2Minutes?.value ? Number($habitQuick2Minutes.value) : 0;
  let quickAdds = goal === "time"
    ? [
        ...(Number.isFinite(qa1m) && qa1m > 0 ? [{ label: ($habitQuick1Label?.value || "").trim(), minutes: Math.round(qa1m) }] : []),
        ...(Number.isFinite(qa2m) && qa2m > 0 ? [{ label: ($habitQuick2Label?.value || "").trim(), minutes: Math.round(qa2m) }] : []),
      ]
    : [];
  if (goal === "time" && foldKey(name) === "trabajo") {
    quickAdds = [
      { label: "M", minutes: 480 },
      { label: "T", minutes: 480 }
    ];
  }
  const params = Array.from(new Set(habitEditingParams.map(normalizeParamLabel).filter(Boolean)));

  return {
    id,
    name,
    emoji,
    color,
    goal,
    groupId: safeGroupId,
    groupPrivate,
    groupLowUse,
    params,
    targetMinutes: Number.isFinite(safeTargetMinutes) && safeTargetMinutes > 0 ? safeTargetMinutes : null,
    countMinuteValue: Number.isFinite(safeUnit) && safeUnit > 0 ? Math.round(safeUnit) : null,
    countUnitMinutes: Number.isFinite(safeUnit) && safeUnit > 0 ? Math.round(safeUnit) : null,
    habitScheduleCreditEligible,
    quickAdds,
    excludeFromDominant: !!$habitExcludeDominant?.checked,
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
    setQuickCounterPinned(habit.id, false);
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

function renderWeekTimeline() {
  if (!$habitWeekTimeline) return;
  const baseDate = parseDateKey(selectedDateKey) || new Date();
  const start = startOfWeek(baseDate);
  const today = todayKey();
  const labels = ["L", "M", "X", "J", "V", "S", "D"];
  const actives = activeHabits();
  const workHabit = actives.find((h) => isWorkHabit(h));
  $habitWeekTimeline.innerHTML = "";
  for (let i = 0; i < 7; i++) {
    const date = addDays(start, i);
    const dateKey = dateKeyLocal(date);
    let scheduled = 0;
    let completed = 0;
    activeHabits().forEach((habit) => {
      if (!isHabitScheduledForDate(habit, date)) return;
      scheduled += 1;
      if (isHabitCompletedOnDate(habit, dateKey)) completed += 1;
    });
    const percent = scheduled ? Math.round((completed / scheduled) * 100) : 0;
    const workEntry = workHabit ? getShiftForDate(dateKey) : { shift: null, hasEntry: false };
    const computedClass = workEntry.shift === "M"
      ? "is-work-morning"
      : (workEntry.shift === "T" ? "is-work-evening" : (workEntry.hasEntry ? "is-work-unknown" : "is-work-free"));
    debugWorkShift("[WORK] paint", { dateKey, computedShift: workEntry.shift, computedClass });
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habit-week-day";
    btn.style.setProperty("--day-progress", String(percent));
    const isToday = dateKey === today;
    const isActive = dateKey === selectedDateKey;
    if (isToday) btn.classList.add("is-today");
    if (isActive) btn.classList.add("is-active");
    btn.classList.add(computedClass);
    const dominant = getDayDominantHabit(dateKey);
    if (dominant?.habit?.color) {
      btn.style.setProperty("--dom-rgb", hexToRgbString(dominant.habit.color));
      btn.classList.add("has-dominant");
    }
    const dominantMark = dominant?.habit?.emoji || (dominant?.habit?.name?.[0] || "•");
    btn.innerHTML = `
      <div class="day-label">${labels[i]}</div>
      <div class="day-dominant" title="${dominant?.habit?.name || "Sin dominante"}">${dominant ? dominantMark : ""}</div>
      <div class="day-number"><span>${date.getDate()}</span></div>
      <div class="day-meta">${isToday ? "Hoy" : ""}</div>
    `;
    btn.addEventListener("click", () => {
      selectedDateKey = dateKey;
      renderToday();
    });
    $habitWeekTimeline.appendChild(btn);
  }
}

function isHabitCardInteractiveTarget(target) {
  if (!target || !(target instanceof HTMLElement)) return false;
  return !!target.closest("button, input, select, textarea, .habit-card-tools, .habit-actions, .habit-week-days, .habit-day-btn, .habit-quick-inline, .habit-quick-input");
}

function attachHabitIconEditHandler(container, habit) {
  const icon = container.querySelector(".habit-icon");
  if (!icon) return;
  icon.addEventListener("click", (event) => {
    event.stopPropagation();
    openHabitModal(habit);
  });
  icon.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      openHabitModal(habit);
    }
  });
}

function getHabitDetailRangeDays(range) {
  switch (range) {
    case "week":
      return 7;
    case "month":
      return 30;
    case "year":
    case "total":
      return 90;
    default:
      return 30;
  }
}

function getHabitDetailChartDays(range) {
  switch (range) {
    case "week":
      return 14;
    case "month":
    case "year":
    case "total":
      return 30;
    default:
      return 30;
  }
}

function getHabitDetailRangeBounds(range) {
  const today = new Date();
  const end = endOfDay(today);
  if (range === "week") return { start: addDays(end, -6), end };
  if (range === "month") return { start: addDays(end, -29), end };
  if (range === "year") return { start: new Date(today.getFullYear(), 0, 1), end };
  if (range === "total") {
    const earliest = getEarliestActivityDate();
    return { start: earliest, end };
  }
  return { start: addDays(end, -29), end };
}

function getHabitValueForDate(habit, dateKey) {
  if (!habit || habit.archived) return 0;
  const goal = habit.goal || "check";
  if (goal === "time") {
    return getSessionsForHabitDate(habit.id, dateKey).reduce((acc, s) => acc + minutesFromSession(s), 0);
  }
  if (goal === "count") {
    return getHabitCount(habit.id, dateKey);
  }
  return isHabitCompletedOnDate(habit, dateKey) ? 1 : 0;
}

function openHabitDetail(habitId, dateKeyContext = todayKey()) {
  const habit = habits[habitId];
  if (!habit || habit.archived || !$habitDetailOverlay) return;
  habitDetailId = habitId;
  habitDetailDateKey = dateKeyContext || todayKey();
  const scheduleContext = scheduleTemplateForDate(habitDetailDateKey);
  habitDetailScheduleSelection = {
    types: [scheduleContext?.type || "Libre"],
    dows: scheduleContext?.usingOverride ? [scheduleContext?.dayKey || "mon"] : []
  };
  $habitDetailOverlay.classList.remove("hidden");
  $habitDetailOverlay.setAttribute("aria-hidden", "false");
  renderHabitDetail(habitId, habitDetailRange);
}

function closeHabitDetail() {
  habitDetailId = null;
  if ($habitDetailOverlay) {
    $habitDetailOverlay.classList.add("hidden");
    $habitDetailOverlay.setAttribute("aria-hidden", "true");
  }
}

function openHabitEditFromDetail() {
  if (habitDetailId && habits[habitDetailId]) {
    const habit = habits[habitDetailId];
    closeHabitDetail();
    openHabitModal(habit);
  }
}

function buildHabitDetailActionButton(label, opts = {}) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = `habit-detail-btn${opts.secondary ? " secondary" : ""}`;
  btn.textContent = label;
  if (opts.title) btn.title = opts.title;
  if (opts.onClick) btn.addEventListener("click", opts.onClick);
  return btn;
}

function renderHabitDetailActions(habit, dateKey) {
  if (!$habitDetailActions) return;
  $habitDetailActions.innerHTML = "";
  const goal = habit.goal || "check";

  if (goal !== "count") {
    const done = !!(habitChecks?.[habit.id]?.[dateKey]);
    const toggleLabel = done ? "↺ Desmarcar hoy" : "✅ Marcar hoy";
    $habitDetailActions.appendChild(buildHabitDetailActionButton(toggleLabel, {
      secondary: done,
      onClick: () => toggleDay(habit.id, dateKey)
    }));
  }

  if (goal === "count") {
    const current = getHabitCount(habit.id, dateKey);
    const minus = buildHabitDetailActionButton("−1", {
      secondary: true,
      onClick: () => adjustHabitCount(habit.id, dateKey, -1)
    });
    minus.disabled = current <= 0;
    const plus = buildHabitDetailActionButton("+1", {
      onClick: () => adjustHabitCount(habit.id, dateKey, +1)
    });
    $habitDetailActions.appendChild(minus);
    $habitDetailActions.appendChild(plus);
  }

  if (goal === "time") {
    const quickWrap = document.createElement("div");
    quickWrap.className = "habit-detail-action-inline";
    const input = document.createElement("input");
    input.type = "time";
    input.step = "60";
    input.min = "00:00";
    input.placeholder = "00:12";
    bindTimeInputDefault(input);
    const addBtn = buildHabitDetailActionButton("Añadir", {
      onClick: () => {
        const minutes = parseTimeToMinutes(input.value);
        if (minutes <= 0) return;
        addHabitTimeSec(habit.id, dateKey, minutes * 60);
        input.value = "00:00";
        renderHabitsPreservingTodayUI();
      }
    });
    quickWrap.appendChild(input);
    quickWrap.appendChild(addBtn);
    $habitDetailActions.appendChild(quickWrap);

    $habitDetailActions.appendChild(buildHabitDetailActionButton("▶︎ Iniciar sesión", {
      secondary: true,
      onClick: () => startSession(habit.id)
    }));
  }
}

function renderHabitDetailHeatmap(habit, rangeKey) {
  if (!$habitDetailHeatmap) return;
  $habitDetailHeatmap.innerHTML = "";
  const cursor = new Date(habitDetailMonthCursor.getFullYear(), habitDetailMonthCursor.getMonth(), 1);
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const offset = (monthStart.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < offset; i += 1) cells.push(null);
  for (let d = 1; d <= monthEnd.getDate(); d += 1) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
  while (cells.length < 42) cells.push(null);

  const nav = document.createElement("div");
  nav.className = "habit-detail-chart-controls";
  const prev = document.createElement("button");
  prev.type = "button"; prev.className = "habit-range-btn"; prev.textContent = "←";
  const next = document.createElement("button");
  next.type = "button"; next.className = "habit-range-btn"; next.textContent = "→";
  const lbl = document.createElement("div");
  lbl.className = "habit-detail-section-sub";
  lbl.textContent = monthStart.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  prev.addEventListener("click", () => { habitDetailMonthCursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1); renderHabitDetail(habit.id, rangeKey); });
  next.addEventListener("click", () => { habitDetailMonthCursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1); renderHabitDetail(habit.id, rangeKey); });
  nav.appendChild(prev); nav.appendChild(lbl); nav.appendChild(next);
  $habitDetailHeatmap.appendChild(nav);

  const grid = document.createElement("div");
  grid.className = "habit-month-grid";
  cells.forEach((date) => {
    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = "habit-heatmap-cell";
    if (!date) {
      cell.classList.add("is-out");
      cell.disabled = true;
      grid.appendChild(cell);
      return;
    }
    const key = dateKeyLocal(date);
    const dayValue = getHabitValueForDate(habit, key);
    const score = getHabitDayScore(habit, key).score;
    const level = scoreToHeatLevel(score);
    cell.classList.add(`heat-level-${level}`);
    cell.innerHTML = `
      <span class="month-day-num">${date.getDate()}</span>
      <span class="month-day-value">${formatCompactDayValue(habit.goal || "check", dayValue)}</span>
    `;
    cell.addEventListener("click", () => openDayDetailModal(key, habit.id));
    grid.appendChild(cell);
  });
  $habitDetailHeatmap.appendChild(grid);

  if ($habitDetailHeatmapSub) {
    $habitDetailHeatmapSub.textContent = "Calendario mensual";
  }
}

function buildChartPoints(habit) {
  const goal = habit.goal || "check";
  const today = new Date();
  const earliest = getEarliestActivityDate();
  let start = addDays(today, -29);
  if (habitDetailChartRange === "90d") start = addDays(today, -89);
  if (habitDetailChartRange === "total") start = earliest;
  if (!start) start = addDays(today, -29);
  const points = [];
  for (let d = new Date(start); d <= today; d = addDays(d, 1)) {
    const key = dateKeyLocal(d);
    points.push({ key, value: getHabitValueForDate(habit, key) });
  }
  if (habitDetailChartRange === "total" && points.length > 180) {
    const packed = [];
    for (let i = 0; i < points.length; i += 7) {
      const chunk = points.slice(i, i + 7);
      packed.push({ key: chunk[chunk.length - 1].key, value: chunk.reduce((a, b) => a + b.value, 0) });
    }
    return { points: packed, packed: true, goal };
  }
  return { points, packed: false, goal };
}

function renderHabitDetailChart(habit, rangeKey) {
  if (!$habitDetailChart) return;
  const { points, packed, goal } = buildChartPoints(habit);
  let maxValue = Math.max(1, ...points.map((p) => p.value));
  const scaleMax = maxValue * 1.08;
  const formatTick = (value) => goal === "time" ? formatMinutes(Math.round(value)) : (goal === "count" ? `${Math.round(value)}×` : String(Math.round(value)));

  $habitDetailChart.innerHTML = "";
  const axis = document.createElement("div"); axis.className = "habit-detail-chart-axis";
  [scaleMax, scaleMax / 2, 0].forEach((tick) => { const t = document.createElement("span"); t.textContent = formatTick(tick); axis.appendChild(t); });
  const barsWrap = document.createElement("div"); barsWrap.className = "habit-detail-chart-bars";

  if (habitDetailChartMode === "line") {
    const lineChart = document.createElement("div");
    lineChart.className = "habit-detail-line-chart";
    const width = Math.max(320, points.length * 18);
    const height = 180;
    const paddingX = 8;
    const paddingY = 8;
    const spanX = Math.max(1, width - paddingX * 2);
    const spanY = Math.max(1, height - paddingY * 2);
    const toX = (idx) => points.length <= 1
      ? width / 2
      : paddingX + (idx / (points.length - 1)) * spanX;
    const toY = (value) => {
      const normalized = Math.max(0, Math.min(1, value / scaleMax));
      return paddingY + (1 - normalized) * spanY;
    };
    const polylinePoints = points
      .map((item, idx) => `${toX(idx).toFixed(2)},${toY(item.value).toFixed(2)}`)
      .join(" ");

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.classList.add("habit-detail-line-svg");
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.setAttribute("preserveAspectRatio", "none");

    const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    polyline.setAttribute("points", polylinePoints);
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", "rgba(var(--hclr-rgb, 127, 93, 255), 0.95)");
    polyline.setAttribute("stroke-width", "3");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    svg.appendChild(polyline);

    if (points.length) {
      const lastIdx = points.length - 1;
      const last = points[lastIdx];
      const lastDot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      lastDot.setAttribute("cx", toX(lastIdx).toFixed(2));
      lastDot.setAttribute("cy", toY(last.value).toFixed(2));
      lastDot.setAttribute("r", "4.5");
      lastDot.setAttribute("fill", "rgba(var(--hclr-rgb, 127, 93, 255), 0.98)");
      svg.appendChild(lastDot);
    }

    lineChart.appendChild(svg);
    points.forEach((item, idx) => {
      const hit = document.createElement("button");
      hit.type = "button";
      hit.className = "habit-detail-line-hit";
      hit.style.left = `${(toX(idx) / width) * 100}%`;
      hit.title = `${item.key} · ${formatTick(item.value)}`;
      hit.addEventListener("click", () => openDayDetailModal(item.key, habit.id));
      lineChart.appendChild(hit);
    });
    barsWrap.appendChild(lineChart);
  } else {
    points.forEach((item) => {
      const barItem = document.createElement("div"); barItem.className = "habit-detail-bar-item";
      const plot = document.createElement("div"); plot.className = "habit-detail-bar-plot";
      const bar = document.createElement("button");
      bar.type = "button";
      bar.className = `habit-detail-bar${item.value ? "" : " is-empty"}`;
      bar.style.setProperty("--h", Math.max(0, (item.value / scaleMax) * 100).toFixed(2));
      bar.title = `${item.key} · ${formatTick(item.value)}`;
      bar.addEventListener("click", () => openDayDetailModal(item.key, habit.id));
      plot.appendChild(bar);
      const label = document.createElement("div"); label.className = "habit-detail-bar-label";
      label.textContent = parseDateKey(item.key)?.getDate?.() ? String(parseDateKey(item.key).getDate()) : "—";
      barItem.appendChild(plot); barItem.appendChild(label); barsWrap.appendChild(barItem);
    });
  }

  $habitDetailChart.appendChild(axis);
  $habitDetailChart.appendChild(barsWrap);
  barsWrap.scrollLeft = barsWrap.scrollWidth;

  if ($habitDetailChartSub) $habitDetailChartSub.textContent = `Rango ${habitDetailChartRange.toUpperCase()}`;
  if ($habitDetailChartMeta) $habitDetailChartMeta.textContent = packed ? "Total agrupado por semanas para rendimiento" : "";
}

function clearHabitEntry(habit, dateKey) {
  if (!habit || !dateKey) return;
  const goal = habit.goal || "check";
  if (goal === "count") {
    setHabitCount(habit.id, dateKey, 0);
  } else {
    if (habitChecks?.[habit.id]) {
      delete habitChecks[habit.id][dateKey];
      persistHabitCheck(habit.id, dateKey, null);
    }
    setHabitTimeSec(habit.id, dateKey, 0);
  }
  saveCache();
  renderHabits();
}

function collectHabitDetailRecords(habit, rangeKey) {
  const { start, end } = getHabitDetailRangeBounds(rangeKey);
  const cappedEnd = endOfDay(end);
  const entries = [];
  for (let date = new Date(cappedEnd); date >= start; date = addDays(date, -1)) {
    const key = dateKeyLocal(date);
    const value = getHabitValueForDate(habit, key);
    if (value > 0) {
      entries.push({ key, value });
    }
  }
  return entries;
}

function updateHabitDetailRecordsSummary(habit, rangeKey) {
  if (!$habitDetailRecordsSub) return;
  habitDetailRecordsEntries = collectHabitDetailRecords(habit, rangeKey);
  habitDetailRecordsPage = 1;
  const label = habitDetailRecordsEntries.length
    ? `Últimos registros (${habitDetailRecordsEntries.length})`
    : "Ver registros";
  $habitDetailRecordsSub.textContent = label;
}

function renderHabitDetailRecordsPage(habit) {
  if (!$habitDetailRecords) return;
  $habitDetailRecords.innerHTML = "";
  const entries = habitDetailRecordsEntries;
  const visible = entries.slice(0, habitDetailRecordsPage * habitDetailRecordsPageSize);

  if (!entries.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state small";
    empty.textContent = "Sin registros en este rango.";
    $habitDetailRecords.appendChild(empty);
  } else {
    visible.forEach((entry) => {
      const row = document.createElement("div");
      row.className = "habit-detail-record-row";
      const info = document.createElement("div");
      info.className = "habit-detail-record-info";
      const title = document.createElement("div");
      title.className = "habit-detail-record-title";
      const goal = habit.goal || "check";
      const valueLabel = goal === "time"
        ? `${entry.value} min`
        : (goal === "count" ? `${entry.value}×` : "Hecho");
      title.textContent = `${formatShortDate(entry.key)} · ${valueLabel}`;
      const meta = document.createElement("div");
      meta.className = "habit-detail-record-meta";
      const origin = goal === "time" ? "sesión" : "manual";
      meta.textContent = `Origen: ${origin} · ${entry.key}`;
      info.appendChild(title);
      info.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "habit-detail-record-actions";
      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "icon-btn";
      edit.textContent = "✎";
      edit.title = "Editar registro";
      edit.addEventListener("click", () => openEntryModal(habit.id, entry.key));
      const del = document.createElement("button");
      del.type = "button";
      del.className = "icon-btn";
      del.textContent = "🗑";
      del.title = "Borrar registro";
      del.addEventListener("click", () => clearHabitEntry(habit, entry.key));
      actions.appendChild(edit);
      actions.appendChild(del);
      row.appendChild(info);
      row.appendChild(actions);
      $habitDetailRecords.appendChild(row);
    });
  }

  if ($habitDetailRecordsMore) {
    $habitDetailRecordsMore.classList.toggle("hidden", visible.length >= entries.length || !entries.length);
  }
}

function renderHabitDetailInsights(habit, rangeKey) {
  if (!$habitDetailInsights) return;
  const { start, end } = getHabitDetailRangeBounds(rangeKey);
  const today = new Date();
  const cappedEnd = end > today ? today : end;
  const dayTotals = new Array(7).fill(0);
  let scheduled = 0;
  let completed = 0;
  const weekTotals = new Map();
  let total = 0;
  let daysCount = 0;

  for (let date = new Date(start); date <= cappedEnd; date = addDays(date, 1)) {
    const key = dateKeyLocal(date);
    const value = getHabitValueForDate(habit, key);
    const goal = habit.goal || "check";
    total += value;
    daysCount += 1;
    dayTotals[date.getDay()] += value;
    if (isHabitScheduledForDate(habit, date)) {
      scheduled += 1;
      if (value > 0) completed += 1;
    }
    const weekKey = `${date.getFullYear()}-${getISOWeekNumber(date)}`;
    weekTotals.set(weekKey, (weekTotals.get(weekKey) || 0) + value);
  }

  const bestDayIndex = dayTotals.reduce((bestIdx, val, idx) => (val > dayTotals[bestIdx] ? idx : bestIdx), 0);
  const dayNames = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
  const successRate = scheduled ? Math.round((completed / scheduled) * 100) : 0;

  const half = Math.floor(daysCount / 2) || 1;
  const prevRangeStart = addDays(cappedEnd, -daysCount + 1);
  let prevTotal = 0;
  let lastTotal = 0;
  let idx = 0;
  for (let date = new Date(prevRangeStart); date <= cappedEnd; date = addDays(date, 1)) {
    const key = dateKeyLocal(date);
    const value = getHabitValueForDate(habit, key);
    if (idx < half) prevTotal += value;
    else lastTotal += value;
    idx += 1;
  }
  const trendDelta = lastTotal - prevTotal;
  const trendLabel = trendDelta === 0 ? "estable" : (trendDelta > 0 ? "sube" : "baja");

  let topWeek = { key: "—", value: 0 };
  weekTotals.forEach((value, key) => {
    if (value > topWeek.value) topWeek = { key, value };
  });

  $habitDetailInsights.innerHTML = "";
  const addInsight = (label, value) => {
    const card = document.createElement("div");
    card.className = "habit-detail-insight-card";
    const lab = document.createElement("div");
    lab.className = "habit-detail-insight-label";
    lab.textContent = label;
    const val = document.createElement("div");
    val.className = "habit-detail-insight-value";
    val.textContent = value;
    card.appendChild(lab);
    card.appendChild(val);
    $habitDetailInsights.appendChild(card);
  };

  addInsight("Mejor día", dayNames[bestDayIndex] || "—");
  addInsight("% éxito", `${successRate}%`);
  addInsight("Tendencia", trendLabel);
  if (topWeek.key !== "—") {
    const topValue = habit.goal === "time"
      ? formatMinutes(Math.round(topWeek.value))
      : `${Math.round(topWeek.value)}×`;
    addInsight("Top semana", `${topWeek.key} · ${topValue}`);
  } else {
    addInsight("Top semana", "—");
  }

  if ($habitDetailInsightsSub) {
    $habitDetailInsightsSub.textContent = rangeLabelTitle(rangeKey);
  }
}

function renderHabitDetailSchedulePanel(habit) {
  if (!habit || !$habitDetailScheduleMode || !$habitDetailScheduleValue) return;
  const selectedTypes = sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []);
  const selectedDows = sanitizeScheduleDows(habitDetailScheduleSelection?.dows || []);
  habitDetailScheduleSelection = {
    types: selectedTypes.length ? selectedTypes : [scheduleShiftTypeForDate(todayKey()) || "Libre"],
    dows: selectedDows
  };

  const ringInfo = computeHabitChipRings(habit.id);

  if ($habitDetailScheduleDayChips) {
    $habitDetailScheduleDayChips.innerHTML = "";
    SCHEDULE_DOWS.forEach((dow) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "habit-detail-schedule-chip";
      if (habitDetailScheduleSelection.dows.includes(dow)) chip.classList.add("is-selected");
      chip.style.setProperty("--ring-gradient", ringInfo.rings[dow] || "linear-gradient(transparent, transparent)");
      chip.dataset.dow = dow;
      chip.title = `Configurado: ${SCHEDULE_TYPES.filter((type) => ringInfo.configured[dow][type]).join(", ") || "sin datos"}`;
      chip.innerHTML = `<span>${SCHEDULE_DOW_LABELS[dow]}</span>`;
      $habitDetailScheduleDayChips.appendChild(chip);
    });
  }

  if ($habitDetailScheduleTypeChips) {
    $habitDetailScheduleTypeChips.innerHTML = "";
    SCHEDULE_TYPES.forEach((type) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "habit-detail-schedule-chip is-type";
      chip.style.color = SCHEDULE_TYPE_COLORS[type];
      if (habitDetailScheduleSelection.types.includes(type)) chip.classList.add("is-selected");
      chip.dataset.type = type;
      chip.innerHTML = `<span>${SCHEDULE_TYPE_LABELS[type]}</span>${ringInfo.configuredBase[type] ? '<span class="habit-detail-schedule-chip-dot"></span>' : ""}`;
      chip.title = ringInfo.configuredBase[type] ? `${type} tiene base` : `${type} sin base`;
      $habitDetailScheduleTypeChips.appendChild(chip);
    });
  }

  const preview = inferBulkEntryFromSelection(habit.id, habitDetailScheduleSelection.types, habitDetailScheduleSelection.dows);
  if (preview) {
    $habitDetailScheduleMode.value = preview.mode;
    $habitDetailScheduleValue.value = String(preview.value || 0);
    $habitDetailScheduleValue.disabled = preview.mode === "neutral";
  } else {
    $habitDetailScheduleMode.value = "neutral";
    $habitDetailScheduleValue.value = "";
    $habitDetailScheduleValue.disabled = true;
  }

  if ($habitDetailScheduleStatus) {
    const scope = habitDetailScheduleSelection.dows.length
      ? `${habitDetailScheduleSelection.dows.length} día(s)`
      : "Base";
    const hasAny = preview || habitDetailScheduleSelection.types.some((type) => ringInfo.configuredBase[type]);
    $habitDetailScheduleStatus.textContent = hasAny
      ? `${scope} · ${habitDetailScheduleSelection.types.join("+")}`
      : "No configurado";
  }
}

function renderHabitDetail(habitId, rangeKey = habitDetailRange) {
  const habit = habits[habitId];
  if (!habit || habit.archived) return;
  habitDetailRange = rangeKey;
  const today = todayKey();
  const streak = computeHabitCurrentStreak(habit);
  const scheduleLabel = habit.schedule?.type === "days"
    ? `Frecuencia: ${formatDaysLabel(habit.schedule.days)}`
    : "Frecuencia: diaria";
  const goal = habit.goal || "check";
  const goalLabel = goal === "time"
    ? `Objetivo: ${habit.targetMinutes ? formatMinutes(habit.targetMinutes) : "sin meta"}`
    : (goal === "count"
      ? `Objetivo: ${habit.countUnitMinutes ? `${habit.countUnitMinutes} min/vez` : "contador"}`
      : "Objetivo: check");
  const doneToday = isHabitCompletedOnDate(habit, today);

  if ($habitDetailOverlay) setHabitColorVars($habitDetailOverlay, habit);
  if ($habitDetailEmoji) $habitDetailEmoji.textContent = habit.emoji || "🏷️";
  if ($habitDetailTitle) $habitDetailTitle.textContent = habit.name || "Hábito";
  if ($habitDetailMeta) $habitDetailMeta.textContent = `${scheduleLabel} · ${goalLabel}`;
  if ($habitDetailTotal) {
    const { start, end } = getHabitDetailRangeBounds(rangeKey);
    const totalValue = getHabitMetricForRange(habit, start, end, goal === "time" ? "time" : "count");
    const totalLabel = goal === "time"
      ? `Horas totales: ${formatHoursTotal(totalValue)}`
      : (goal === "count" ? `Total: ${Math.round(totalValue)}×` : `Total: ${Math.round(totalValue)} días`);
    $habitDetailTotal.textContent = totalLabel;
  }
  if ($habitDetailStatus) $habitDetailStatus.textContent = doneToday ? "Hecho hoy" : "Pendiente hoy";
  if ($habitDetailStreak) $habitDetailStreak.textContent = `🔥 ${streak}`;
  if ($habitDetailGoal) $habitDetailGoal.textContent = goal === "time" ? "Tiempo" : (goal === "count" ? "Contador" : "Check");

  renderHabitDetailActions(habit, habitDetailDateKey || today);
  renderHabitDetailSchedulePanel(habit);
  renderHabitDetailHeatmap(habit, rangeKey);
  renderHabitDetailChart(habit, rangeKey);
  updateHabitDetailRecordsSummary(habit, rangeKey);
  if ($habitDetailRecordsWrap?.open) {
    renderHabitDetailRecordsPage(habit);
  } else if ($habitDetailRecords) {
    $habitDetailRecords.innerHTML = "";
  }
  renderHabitDetailInsights(habit, rangeKey);

  $habitDetailRangeButtons?.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.range === rangeKey);
  });
}

function buildTodayCard(habit, dateKey, dayData, metaText, streak, daysDone) {
  const isCount = (habit.goal || "check") === "count";
  const card = document.createElement("div");
  card.className = "habit-card";
  if (dayData.hasActivity) card.classList.add("is-done");
  card.setAttribute("role", "button");
  card.tabIndex = 0;
  setHabitColorVars(card, habit);
  const habitName = habit.name || "Hábito";
  card.dataset.habitName = habitName;
  card.dataset.habitEmoji = habit.emoji || "";

  const left = document.createElement("div");
  left.className = "habit-card-left";
  left.innerHTML = `
        <button type="button" class="habit-emoji habit-icon" aria-label="Editar hábito">${habit.emoji || "🏷️"}</button>
        <div>
          <div class="habit-name">${habitName}</div>
          <div class="habit-meta-row">
            <div class="habit-meta">${metaText}</div>
            <div class="habit-streak" title="Racha actual">🔥 ${streak}</div>
          </div>
          <div class="habit-meta habit-days-done">Hecho: ${daysDone} día${daysDone === 1 ? "" : "s"}</div>
        </div>
      `;

  const tools = document.createElement("div");
  tools.className = "habit-card-tools";

  if (isCount) {
    const minus = document.createElement("button");
    minus.className = "icon-btn-add";
    minus.type = "button";
    minus.textContent = "−";
    minus.title = "Restar";
    minus.disabled = !dayData.count;
    minus.addEventListener("click", (e) => {
      e.stopPropagation();
      adjustHabitCount(habit.id, dateKey, -1);
    });

    const val = document.createElement("div");
    val.className = "habit-count-value";
    val.textContent = String(dayData.count || 0);

    const plus = document.createElement("button");
    plus.className = "icon-btn-add";
    plus.type = "button";
    plus.textContent = "+";
    plus.title = "Sumar";
    plus.addEventListener("click", (e) => {
      e.stopPropagation();
      adjustHabitCount(habit.id, dateKey, +1);
    });

    tools.appendChild(minus);
    tools.appendChild(val);
    tools.appendChild(plus);
  } else {
    const doneCheck = !!(habitChecks[habit.id] && habitChecks[habit.id][dateKey]);
    const fireBtn = document.createElement("button");
    fireBtn.className = "habit-fire";
    fireBtn.textContent = "🔥";
    fireBtn.setAttribute("aria-pressed", String(dayData.hasActivity));
    fireBtn.setAttribute("aria-label", doneCheck ? "Desmarcar como hecho" : "Marcar como hecho");
    fireBtn.title = doneCheck ? "Quitar hecho" : "Marcar como hecho";
    fireBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleDay(habit.id, dateKey);
    });
    if (dayData.hasActivity) fireBtn.classList.add("is-done");
    tools.appendChild(fireBtn);
    if ((habit.goal || "check") === "time") {
      appendTimeQuickControls(tools, habit, dateKey);
    }
  }

  const editBtn = document.createElement("button");
  editBtn.className = "icon-btn";
  if ((habit.goal || "check") === "time") editBtn.classList.add("habit-time-btn");
  editBtn.type = "button";
  editBtn.textContent = "⋯";
  editBtn.title = "Editar registros";
  editBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    openEntryModal(habit.id, dateKey);
  });
  tools.appendChild(editBtn);

  card.appendChild(left);
  card.appendChild(tools);

  attachHabitIconEditHandler(card, habit);
  card.addEventListener("click", (event) => {
    if (isHabitCardInteractiveTarget(event.target)) return;
    openHabitDetail(habit.id, dateKey);
  });
  card.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openHabitDetail(habit.id, dateKey);
    }
  });

  return card;
}

let todaySearchTimer = null;
let todaySearchSnapshot = null;

function normalizeSearchTerm(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildNormalizedMap(value) {
  const raw = String(value || "");
  let normalized = "";
  const map = [];
  for (let i = 0; i < raw.length; i += 1) {
    const chunk = raw[i].normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    if (!chunk) continue;
    for (let j = 0; j < chunk.length; j += 1) {
      normalized += chunk[j].toLowerCase();
      map.push(i);
    }
  }
  return { normalized, map };
}

function findNormalizedMatchRange(text, query) {
  if (!query) return null;
  const { normalized, map } = buildNormalizedMap(text);
  const idx = normalized.indexOf(query);
  if (idx === -1) return null;
  const start = map[idx];
  const end = map[idx + query.length - 1] + 1;
  return { start, end };
}

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;"
  }[char]));
}

function applyHabitHighlight(card, query) {
  const nameEl = card.querySelector(".habit-name");
  if (!nameEl) return;
  const original = card.dataset.habitName || nameEl.textContent || "";
  if (!query) {
    nameEl.textContent = original;
    return;
  }
  const match = findNormalizedMatchRange(original, query);
  if (!match) {
    nameEl.textContent = original;
    return;
  }
  const { start, end } = match;
  nameEl.innerHTML = `${escapeHtml(original.slice(0, start))}<span class="habit-highlight">${escapeHtml(original.slice(start, end))}</span>${escapeHtml(original.slice(end))}`;
}

function updateTodaySummaryMeta(countPending, countDone, timePending, timeDone, isFiltered = false) {
  const countTotal = countPending + countDone;
  const timeTotal = timePending + timeDone;
  const countText = countTotal ? `Pend: ${countPending} · Hechos: ${countDone}` : "—";
  const timeText = timeTotal ? `Pend: ${timePending} · Hechos: ${timeDone}` : "—";
  const countPreview = countTotal ? countText : "0 hábitos";
  const timePreview = timeTotal ? timeText : "0 hábitos";

  if ($habitTodayCountMeta) {
    $habitTodayCountMeta.textContent = countText;
    if (!isFiltered) $habitTodayCountMeta.dataset.full = countText;
  }
  if ($habitTodayTimeMeta) {
    $habitTodayTimeMeta.textContent = timeText;
    if (!isFiltered) $habitTodayTimeMeta.dataset.full = timeText;
  }
  if ($habitTodayCountPreview) {
    $habitTodayCountPreview.textContent = countPreview;
    if (!isFiltered) $habitTodayCountPreview.dataset.full = countPreview;
  }
  if ($habitTodayTimePreview) {
    $habitTodayTimePreview.textContent = timePreview;
    if (!isFiltered) $habitTodayTimePreview.dataset.full = timePreview;
  }
}

function restoreTodaySummaryMeta() {
  if ($habitTodayCountMeta?.dataset.full) $habitTodayCountMeta.textContent = $habitTodayCountMeta.dataset.full;
  if ($habitTodayTimeMeta?.dataset.full) $habitTodayTimeMeta.textContent = $habitTodayTimeMeta.dataset.full;
  if ($habitTodayCountPreview?.dataset.full) $habitTodayCountPreview.textContent = $habitTodayCountPreview.dataset.full;
  if ($habitTodayTimePreview?.dataset.full) $habitTodayTimePreview.textContent = $habitTodayTimePreview.dataset.full;
}

function captureTodayDetailsSnapshot(panel) {
  todaySearchSnapshot = Array.from(panel.querySelectorAll('details:not([data-search-ignore="true"])')).map((detail) => ({
    detail,
    open: detail.open,
    display: detail.style.display
  }));
}

function restoreTodayDetailsSnapshot() {
  if (!todaySearchSnapshot) return;
  todaySearchSnapshot.forEach(({ detail, open, display }) => {
    detail.open = open;
    detail.style.display = display;
  });
  todaySearchSnapshot = null;
}

function applyTodaySearch(value) {
  const panel = document.querySelector('.habits-panel[data-panel="today"]');
  if (!panel) return;
  const raw = String(value || "").trim();
  const normalizedQuery = normalizeSearchTerm(raw);
  const hasQuery = raw.length > 0;

  if (hasQuery && !todaySearchSnapshot) captureTodayDetailsSnapshot(panel);
  if (!hasQuery) restoreTodayDetailsSnapshot();

  if ($habitTodaySearchClear) {
    $habitTodaySearchClear.classList.toggle("is-visible", hasQuery);
  }

  requestAnimationFrame(() => {
    const cards = panel.querySelectorAll(".habit-card");
    let visibleCount = 0;
    cards.forEach((card) => {
      const name = card.dataset.habitName || "";
      const emoji = card.dataset.habitEmoji || "";
      const matchesName = normalizedQuery && normalizeSearchTerm(name).includes(normalizedQuery);
      const matchesEmoji = raw && emoji && emoji.includes(raw);
      const matches = !hasQuery || matchesName || matchesEmoji;
      card.style.display = matches ? "" : "none";
      if (matches) visibleCount += 1;
      applyHabitHighlight(card, matchesName ? normalizedQuery : "");
    });

    if (hasQuery) {
      const details = panel.querySelectorAll('details:not([data-search-ignore="true"])');
      details.forEach((detail) => {
        const hasVisible = Array.from(detail.querySelectorAll(".habit-card")).some((card) => card.style.display !== "none");
        detail.style.display = hasVisible ? "" : "none";
        detail.open = hasVisible;
      });
    } else {
      restoreTodaySummaryMeta();
    }

    if (hasQuery) {
      const countPending = Array.from($habitTodayCountPending?.querySelectorAll(".habit-card") || []).filter((card) => card.style.display !== "none").length;
      const countDone = Array.from($habitTodayCountDone?.querySelectorAll(".habit-card") || []).filter((card) => card.style.display !== "none").length;
      const timePending = Array.from($habitTodayTimePending?.querySelectorAll(".habit-card") || []).filter((card) => card.style.display !== "none").length;
      const timeDone = Array.from($habitTodayTimeDone?.querySelectorAll(".habit-card") || []).filter((card) => card.style.display !== "none").length;
      updateTodaySummaryMeta(countPending, countDone, timePending, timeDone, true);
    }

    if ($habitTodaySearchEmpty) {
      $habitTodaySearchEmpty.style.display = hasQuery && !visibleCount ? "flex" : "none";
    }
  });
}

function renderToday() {
  if (!parseDateKey(selectedDateKey)) {
    selectedDateKey = todayKey();
  }
  renderWeekTimeline();
  const selectedDate = parseDateKey(selectedDateKey) || new Date();
  const dateKey = selectedDateKey || todayKey();

  // clear
  $habitTodayCountPending.innerHTML = "";
  $habitTodayCountDone.innerHTML = "";
  $habitTodayTimePending.innerHTML = "";
  $habitTodayTimeDone.innerHTML = "";
  if ($habitCustomGroups) $habitCustomGroups.innerHTML = "";

  const shouldCollapseDefaults = !hasRenderedTodayOnce;
  const resetGroup = (wrap, list) => {
    if (list) list.innerHTML = "";
    if (wrap) {
      if (shouldCollapseDefaults) wrap.open = false; // cerrado solo en primer render
      wrap.style.display = "none";
    }
  };

  resetGroup($todayCountPendingPrivateWrap, $todayCountPendingPrivate);
  resetGroup($todayCountPendingLowWrap, $todayCountPendingLow);
  resetGroup($todayCountDonePrivateWrap, $todayCountDonePrivate);
  resetGroup($todayCountDoneLowWrap, $todayCountDoneLow);

  resetGroup($todayTimePendingPrivateWrap, $todayTimePendingPrivate);
  resetGroup($todayTimePendingLowWrap, $todayTimePendingLow);
  resetGroup($todayTimeDonePrivateWrap, $todayTimeDonePrivate);
  resetGroup($todayTimeDoneLowWrap, $todayTimeDoneLow);

  let countTotal = 0;
  let countDone = 0;
  let timeTotal = 0;
  let timeDone = 0;
  const groupedBuckets = new Map();

  activeHabits()
    .filter((h) => isHabitScheduledForDate(h, selectedDate))
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .forEach((habit) => {
      const dayData = getHabitDayScore(habit, dateKey);
      const isCount = (habit.goal || "check") === "count";

      if (isCount) {
        countTotal += 1;
        if (dayData.hasActivity) countDone += 1;
      } else {
        timeTotal += 1;
        if (dayData.hasActivity) timeDone += 1;
      }

      const streak = computeHabitCurrentStreak(habit);
      const daysDone = countHabitActivityDays(habit);
      const scheduleLabel = habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día";
      const metaText = isCount
        ? (dayData.count ? `${scheduleLabel} · ${dayData.count} hoy` : scheduleLabel)
        : (dayData.minutes ? `${scheduleLabel} · ${formatMinutes(dayData.minutes)} hoy` : scheduleLabel);
      console.warn("[RENDER] minicard", habit.id, isCount ? dayData.count : dayData.minutes);

      const card = buildTodayCard(habit, dateKey, dayData, metaText, streak, daysDone);
      const groupId = habit?.groupId || "";
      const group = groupId ? habitGroups?.[groupId] : null;
      if (group) {
        if (!groupedBuckets.has(groupId)) {
          groupedBuckets.set(groupId, { group, pending: [], done: [] });
        }
        const bucket = groupedBuckets.get(groupId);
        if (dayData.hasActivity) bucket.done.push(card);
        else bucket.pending.push(card);
        return;
      }

      const groupKey = habit?.groupPrivate ? "private" : (habit?.groupLowUse ? "low" : "main");

      const pick = (main, priv, low) => (groupKey === "private" ? priv : (groupKey === "low" ? low : main));

      const targetList = isCount
        ? (dayData.hasActivity
            ? pick($habitTodayCountDone, $todayCountDonePrivate, $todayCountDoneLow)
            : pick($habitTodayCountPending, $todayCountPendingPrivate, $todayCountPendingLow))
        : (dayData.hasActivity
            ? pick($habitTodayTimeDone, $todayTimeDonePrivate, $todayTimeDoneLow)
            : pick($habitTodayTimePending, $todayTimePendingPrivate, $todayTimePendingLow));

      targetList.appendChild(card);
    });

  if ($habitCustomGroups) {
    const groupsWithHabits = sortedHabitGroups().filter((group) => groupedBuckets.has(group.id));
    if (!groupsWithHabits.length) {
      $habitCustomGroups.style.display = "none";
    } else {
      $habitCustomGroups.style.display = "";
      groupsWithHabits.forEach((group) => {
        const bucket = groupedBuckets.get(group.id);
        if (!bucket) return;
        const details = document.createElement("details");
        details.className = "habit-custom-group habit-accordion";
        details.dataset.groupId = group.id;
        const pendingCount = bucket.pending.length;
        const doneCount = bucket.done.length;
        details.innerHTML = `
          <summary>
            <div class="habit-accordion-title">${group.name}</div>
            <div class="habit-accordion-meta">Pend: ${pendingCount} · Hechos: ${doneCount}</div>
          </summary>
        `;
        const body = document.createElement("div");
        body.className = "habit-accordion-body";
        if (pendingCount) {
          const title = document.createElement("div");
          title.className = "habits-subgroup-title";
          title.textContent = "Pendientes";
          const list = document.createElement("div");
          list.className = "habit-card-list";
          bucket.pending.forEach((card) => list.appendChild(card));
          body.appendChild(title);
          body.appendChild(list);
        }
        if (doneCount) {
          const title = document.createElement("div");
          title.className = "habits-subgroup-title";
          title.textContent = "Hechos";
          const list = document.createElement("div");
          list.className = "habit-card-list";
          bucket.done.forEach((card) => list.appendChild(card));
          body.appendChild(title);
          body.appendChild(list);
        }
        details.appendChild(body);
        $habitCustomGroups.appendChild(details);
      });
    }
  }

  // empties
  const countPending = countTotal - countDone;
  const timePending = timeTotal - timeDone;

  $habitTodayCountEmpty.style.display = countPending ? "none" : "block";
  $habitTodayCountDoneEmpty.style.display = countDone ? "none" : "block";
  $habitTodayTimeEmpty.style.display = timePending ? "none" : "block";
  $habitTodayTimeDoneEmpty.style.display = timeDone ? "none" : "block";

  updateTodaySummaryMeta(countPending, countDone, timePending, timeDone);

  const showGroup = (wrap, list) => {
    if (!wrap || !list) return;
    const has = list.childElementCount > 0;
    wrap.style.display = has ? "" : "none";
    if (shouldCollapseDefaults && has) wrap.open = false; // solo en primer render
  };

  const updateGroupMeta = (wrap, list) => {
    const meta = wrap?.querySelector(".habit-accordion-meta");
    if (!meta) return;
    const count = list?.childElementCount || 0;
    meta.textContent = count ? String(count) : "—";
  };

  showGroup($todayCountPendingPrivateWrap, $todayCountPendingPrivate);
  showGroup($todayCountPendingLowWrap, $todayCountPendingLow);
  showGroup($todayCountDonePrivateWrap, $todayCountDonePrivate);
  showGroup($todayCountDoneLowWrap, $todayCountDoneLow);

  showGroup($todayTimePendingPrivateWrap, $todayTimePendingPrivate);
  showGroup($todayTimePendingLowWrap, $todayTimePendingLow);
  showGroup($todayTimeDonePrivateWrap, $todayTimeDonePrivate);
  showGroup($todayTimeDoneLowWrap, $todayTimeDoneLow);

  updateGroupMeta($todayCountPendingPrivateWrap, $todayCountPendingPrivate);
  updateGroupMeta($todayCountPendingLowWrap, $todayCountPendingLow);
  updateGroupMeta($todayCountDonePrivateWrap, $todayCountDonePrivate);
  updateGroupMeta($todayCountDoneLowWrap, $todayCountDoneLow);
  updateGroupMeta($todayTimePendingPrivateWrap, $todayTimePendingPrivate);
  updateGroupMeta($todayTimePendingLowWrap, $todayTimePendingLow);
  updateGroupMeta($todayTimeDonePrivateWrap, $todayTimeDonePrivate);
  updateGroupMeta($todayTimeDoneLowWrap, $todayTimeDoneLow);

  renderQuickSessions();
  renderQuickCounters();

  if ($habitTodaySearchInput?.value.trim()) {
    applyTodaySearch($habitTodaySearchInput.value);
  }
  if (!hasRenderedTodayOnce) hasRenderedTodayOnce = true;
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
          <button type="button" class="habit-emoji habit-icon" aria-label="Editar hábito">${habit.emoji || "🏷️"}</button>
          <div>
            <div class="habit-name">${habit.name}</div>
            <div class="habit-meta">${habit.schedule?.type === "days" ? formatDaysLabel(habit.schedule.days) : "Cada día"}</div>
            <div class="habit-meta habit-days-done">Hecho: ${daysDone} día${daysDone === 1 ? "" : "s"}</div>
          </div>
        </div>
      `;
      header.appendChild(createHabitActions(habit));
      attachHabitIconEditHandler(header, habit);
      header.addEventListener("click", (event) => {
        if (isHabitCardInteractiveTarget(event.target)) return;
        openHabitDetail(habit.id, todayKey());
      });
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
        btn.addEventListener("click", () => {
          if ((habit.goal || "check") === "count") {
            const cur = getHabitCount(habit.id, dateKey);
            setHabitCount(habit.id, dateKey, cur ? 0 : 1);
          } else {
            toggleDay(habit.id, dateKey);
          }
        });
        daysRow.appendChild(btn);
      }
      card.appendChild(header);
      card.appendChild(daysRow);
      $habitWeekList.appendChild(card);
    });

  $habitWeekEmpty.style.display = any ? "none" : "block";
}

function getISOWeekNumber(date) {
  const utc = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil((((utc - yearStart) / 86400000) + 1) / 7);
}

function isLeapYear(year) {
  return new Date(year, 1, 29).getDate() === 29;
}

function formatHistoryRangeLabel(range) {
  const today = new Date();
  switch (range) {
    case "week": {
      const { start, end } = getDaysRangeBounds("week");
      const week = getISOWeekNumber(end);
      const startDay = String(start.getDate()).padStart(2, "0");
      const endDay = String(end.getDate()).padStart(2, "0");
      const monthLabel = end.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
      return `S. ${week} (${startDay}–${endDay} ${monthLabel} ${end.getFullYear()})`;
    }
    case "month": {
      const { end } = getDaysRangeBounds("month");
      const monthLabel = end.toLocaleDateString("es-ES", { month: "short" }).replace(".", "");
      const totalDays = new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate();
      return `Mes ${monthLabel} ${end.getFullYear()} (${end.getDate()}/${totalDays})`;
    }
    case "year": {
      const year = heatmapYear;
      const start = new Date(year, 0, 1);
      const end = new Date(year, 11, 31, 23, 59, 59, 999);
      const cappedEnd = year === today.getFullYear() && end > today ? today : end;
      const elapsed = Math.floor((cappedEnd - start) / 86400000) + 1;
      const totalDays = isLeapYear(year) ? 366 : 365;
      return `Año ${year} (${Math.min(elapsed, totalDays)}/${totalDays})`;
    }
    case "total": {
      const hasAny = hasAnyHistoryDataInRange(new Date(0), today);
      if (!hasAny) return "Total (sin datos)";
      const earliest = getEarliestActivityDate();
      return `Total (desde primer registro: ${dateKeyLocal(earliest)})`;
    }
    default:
      return "Día";
  }
}

function endOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function getHistoryRangeBounds(range) {
  const today = new Date();
  let { start, end } = getDaysRangeBounds(range);
  if (range === "total") {
    start = getEarliestActivityDate();
  }
  if (range === "year") {
    start = new Date(heatmapYear, 0, 1);
    end = new Date(heatmapYear, 11, 31, 23, 59, 59, 999);
  }
  if (end > today) end = endOfDay(today);
  return { start, end };
}

function getISOWeekYearAndNumber(date) {
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = (target.getDay() + 6) % 7;
  target.setDate(target.getDate() - day + 3);
  const isoYear = target.getFullYear();
  const firstThursday = new Date(isoYear, 0, 4);
  const firstDay = (firstThursday.getDay() + 6) % 7;
  firstThursday.setDate(firstThursday.getDate() - firstDay + 3);
  const week = 1 + Math.round((target - firstThursday) / 604800000);
  return { year: isoYear, week };
}

function isoWeekStart(isoYear, isoWeek) {
  const jan4 = new Date(isoYear, 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(isoYear, 0, 4 - jan4Day);
  return addDays(week1Monday, (isoWeek - 1) * 7);
}

function formatCompareToken(mode, token) {
  if (!token) return "";
  if (mode === "day") {
    const date = parseDateKey(token);
    if (!date) return token;
    return date.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" }).replace('.', '');
  }
  if (mode === "week") {
    const [yRaw, wRaw] = String(token).split("-W");
    const year = Number(yRaw);
    const week = Number(wRaw);
    if (!year || !week) return token;
    const start = isoWeekStart(year, week);
    const end = addDays(start, 6);
    const startLabel = start.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }).replace('.', '');
    const endLabel = end.toLocaleDateString("es-ES", { day: "2-digit", month: "short" }).replace('.', '');
    return `S. ${String(week).padStart(2, "0")} (${startLabel}–${endLabel})`;
  }
  if (mode === "month") {
    const [yRaw, mRaw] = String(token).split("-");
    const year = Number(yRaw);
    const month = Number(mRaw);
    if (!year || !month) return token;
    const date = new Date(year, month - 1, 1);
    const name = date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  const year = Number(token);
  if (!year) return token;
  return `Año ${year}`;
}

function getCompareStatLabel(statKey, mode) {
  const unitMap = { day: "diaria", week: "semanal", month: "mensual", year: "anual" };
  const unit = unitMap[mode] || "diaria";
  const map = {
    MEAN: `Media ${unit}`,
    MEDIAN: `Mediana ${unit}`,
    MODE: `Moda ${unit}`,
    P25: `P25 ${unit}`,
    P50: `P50 ${unit}`,
    P75: `P75 ${unit}`,
    P90: `P90 ${unit}`,
    MAX: `Máx ${unit}`,
    TOTAL_TYPICAL: `Total típico ${unit}`
  };
  return map[statKey] || `Referencia ${unit}`;
}

function formatCompareSelection(mode, selection) {
  if (!selection) return "—";
  if (selection.kind === "ref") return getCompareStatLabel(selection.statKey, mode);
  return formatCompareToken(mode, selection.token);
}

function getCompareDefaultSelections(mode) {
  const today = new Date();
  if (mode === "day") {
    return {
      a: { kind: "real", token: dateKeyLocal(today) },
      b: { kind: "ref", statKey: "MEAN" }
    };
  }
  if (mode === "week") {
    const cur = getISOWeekYearAndNumber(today);
    return {
      a: { kind: "real", token: `${cur.year}-W${String(cur.week).padStart(2, "0")}` },
      b: { kind: "ref", statKey: "MEAN" }
    };
  }
  if (mode === "month") {
    const cur = new Date(today.getFullYear(), today.getMonth(), 1);
    return {
      a: { kind: "real", token: `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}` },
      b: { kind: "ref", statKey: "MEAN" }
    };
  }
  return {
    a: { kind: "real", token: String(today.getFullYear()) },
    b: { kind: "ref", statKey: "MEAN" }
  };
}

function getCompareSubtitle(mode, selectionA, selectionB) {
  const defaults = getCompareDefaultSelections(mode);
  const isTodayVsYesterday = mode === "day"
    && selectionA?.kind === "real"
    && selectionB?.kind === "real"
    && selectionA.token === defaults.a.token
    && selectionB.token === dateKeyLocal(addDays(new Date(), -1));
  if (isTodayVsYesterday) return "Hoy vs Ayer";
  return `${formatCompareSelection(mode, selectionA)} vs ${formatCompareSelection(mode, selectionB)}`;
}

function getCompareOptions(mode, count = 16) {
  const options = [];
  const now = new Date();
  if (mode === "day") {
    for (let i = 0; i < count; i += 1) {
      const date = addDays(now, -i);
      const token = dateKeyLocal(date);
      options.push({ token, label: formatCompareToken("day", token) });
    }
    return options;
  }
  if (mode === "week") {
    for (let i = 0; i < count; i += 1) {
      const date = addDays(now, -7 * i);
      const meta = getISOWeekYearAndNumber(date);
      const token = `${meta.year}-W${String(meta.week).padStart(2, "0")}`;
      if (!options.some((it) => it.token === token)) {
        options.push({ token, label: formatCompareToken("week", token) });
      }
    }
    return options;
  }
  if (mode === "month") {
    for (let i = 0; i < count; i += 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const token = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
      options.push({ token, label: formatCompareToken("month", token) });
    }
    return options;
  }
  for (let i = 0; i < count; i += 1) {
    const token = String(now.getFullYear() - i);
    options.push({ token, label: formatCompareToken("year", token) });
  }
  return options;
}

function ensureCompareSelections(mode, options = []) {
  const defaults = getCompareDefaultSelections(mode);
  const allTokens = new Set(options.map((it) => it.token));
  if (defaults.a.kind === "real" && !allTokens.has(defaults.a.token)) {
    options.unshift({ token: defaults.a.token, label: formatCompareToken(mode, defaults.a.token) });
  }

  if (!habitCompareSelectionA || (habitCompareSelectionA.kind === "real" && !options.some((it) => it.token === habitCompareSelectionA.token))) {
    habitCompareSelectionA = { ...defaults.a };
  }
  if (!habitCompareSelectionB || (habitCompareSelectionB.kind === "real" && !options.some((it) => it.token === habitCompareSelectionB.token))) {
    habitCompareSelectionB = { ...defaults.b };
  }

  if (
    habitCompareSelectionA.kind === "real"
    && habitCompareSelectionB.kind === "real"
    && habitCompareSelectionA.token === habitCompareSelectionB.token
  ) {
    const fallback = options.find((it) => it.token !== habitCompareSelectionA.token);
    if (fallback) habitCompareSelectionB = { kind: "real", token: fallback.token };
  }
}

function getRangeForCompare(mode, token) {
  if (mode === "day") {
    const day = parseDateKey(token) || new Date();
    return {
      start: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0),
      end: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999)
    };
  }
  if (mode === "week") {
    const [yRaw, wRaw] = String(token).split("-W");
    const year = Number(yRaw);
    const week = Number(wRaw);
    const start = isoWeekStart(year, week);
    return { start, end: new Date(addDays(start, 6).setHours(23, 59, 59, 999)) };
  }
  if (mode === "month") {
    const [yRaw, mRaw] = String(token).split("-");
    const year = Number(yRaw);
    const month = Number(mRaw);
    const start = new Date(year, month - 1, 1);
    const end = new Date(year, month, 0, 23, 59, 59, 999);
    return { start, end };
  }
  const year = Number(token);
  return {
    start: new Date(year, 0, 1, 0, 0, 0, 0),
    end: new Date(year, 11, 31, 23, 59, 59, 999)
  };
}

function resolveCompareType(habit) {
  if (!habit || habit.archived) return "check";
  if (habit.goal === "time") return "duration";
  if (habit.goal === "count") return "count";
  return "check";
}

function aggregateHabitValue(habit, range) {
  if (!habit || habit.archived || !range) return 0;
  const type = resolveCompareType(habit);
  if (type === "duration") return getHabitMetricForRange(habit, range.start, range.end, "time");
  return getHabitMetricForRange(habit, range.start, range.end, "count");
}

function getInProgressContributionForRange(habit, range) {
  if (!habit || habit.archived || !range || !runningSession) return 0;
  if (resolveCompareType(habit) !== "duration") return 0;
  const targetHabitId = runningSession?.targetHabitId || null;
  if (!targetHabitId || targetHabitId !== habit.id) return 0;

  const startTs = Number(runningSession.startTs);
  const endTs = Date.now();
  if (!Number.isFinite(startTs) || endTs <= startTs) return 0;

  const split = splitSessionByDay(startTs, endTs);
  let extraMinutes = 0;
  split.forEach((minutes, dayKey) => {
    const day = parseDateKey(dayKey);
    if (!day) return;
    const inRange = day >= range.start && day <= range.end;
    if (!inRange) return;
    extraMinutes += Number(minutes) || 0;
  });
  return extraMinutes;
}

function getHistoryStatsRange() {
  const start = getEarliestActivityDate();
  const end = endOfDay(new Date());
  return { start, end };
}

function formatStatToken(granularity, date) {
  if (granularity === "day") return dateKeyLocal(date);
  if (granularity === "week") {
    const meta = getISOWeekYearAndNumber(date);
    return `${meta.year}-W${String(meta.week).padStart(2, "0")}`;
  }
  if (granularity === "month") return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return `${date.getFullYear()}`;
}

function nextTokenDate(granularity, date) {
  if (granularity === "day") return addDays(date, 1);
  if (granularity === "week") return addDays(date, 7);
  if (granularity === "month") return new Date(date.getFullYear(), date.getMonth() + 1, 1);
  return new Date(date.getFullYear() + 1, 0, 1);
}

function floorTokenDate(granularity, date) {
  if (granularity === "day") return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  if (granularity === "week") return startOfWeek(date);
  if (granularity === "month") return new Date(date.getFullYear(), date.getMonth(), 1);
  return new Date(date.getFullYear(), 0, 1);
}

function buildSeries(habit, granularity, baseMode, rangeStart, rangeEnd) {
  if (!habit || !rangeStart || !rangeEnd || rangeEnd < rangeStart) return [];
  const cacheKey = `${habit.id}::${granularity}::${baseMode}::${dateKeyLocal(rangeStart)}::${dateKeyLocal(rangeEnd)}::v${habitHistoryDataVersion}`;
  if (habitStatsSeriesCache.has(cacheKey)) return habitStatsSeriesCache.get(cacheKey);
  const vals = [];
  for (let cursor = floorTokenDate(granularity, rangeStart); cursor <= rangeEnd; cursor = nextTokenDate(granularity, cursor)) {
    const token = formatStatToken(granularity, cursor);
    const value = Number(aggregateHabitValue(habit, getRangeForCompare(granularity, token)) || 0);
    if (baseMode === "RECORDED_ONLY" && value === 0) continue;
    vals.push(value);
  }
  habitStatsSeriesCache.set(cacheKey, vals);
  return vals;
}

function getPercentile(vals, p) {
  if (!vals.length) return 0;
  const sorted = [...vals].sort((a, b) => a - b);
  const i = p * (sorted.length - 1);
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  const weight = i - lo;
  return sorted[lo] + (sorted[hi] - sorted[lo]) * weight;
}

function getModeMeta(vals) {
  if (!vals.length) return { value: 0, multi: false };
  const freq = new Map();
  vals.forEach((v) => {
    const k = Number(v || 0);
    freq.set(k, (freq.get(k) || 0) + 1);
  });
  let maxFreq = 0;
  freq.forEach((count) => {
    if (count > maxFreq) maxFreq = count;
  });
  const modes = [...freq.entries()]
    .filter(([, count]) => count === maxFreq)
    .map(([value]) => Number(value))
    .sort((a, b) => a - b);
  return { value: modes[0] || 0, multi: modes.length > 1 };
}

function summarizeSeries(vals, activeRateVals = vals) {
  if (!vals.length) {
    return { total: 0, mean: 0, median: 0, mode: 0, modeMulti: false, p25: 0, p50: 0, p75: 0, p90: 0, max: 0, activeRate: 0 };
  }
  const total = vals.reduce((acc, v) => acc + (Number(v) || 0), 0);
  const modeMeta = getModeMeta(vals);
  const activeBase = activeRateVals.length ? activeRateVals : vals;
  return {
    total,
    mean: total / vals.length,
    median: getPercentile(vals, 0.5),
    mode: modeMeta.value,
    modeMulti: modeMeta.multi,
    p25: getPercentile(vals, 0.25),
    p50: getPercentile(vals, 0.5),
    p75: getPercentile(vals, 0.75),
    p90: getPercentile(vals, 0.9),
    max: Math.max(...vals),
    activeRate: activeBase.length ? (activeBase.filter((v) => Number(v) > 0).length / activeBase.length) * 100 : 0
  };
}

function getSeriesStat(habit, granularity, baseMode) {
  const { start, end } = getHistoryStatsRange();
  const cacheKey = `${habit.id}::${granularity}::${baseMode}::${dateKeyLocal(start)}::${dateKeyLocal(end)}::v${habitHistoryDataVersion}`;
  if (habitStatsResultCache.has(cacheKey)) return habitStatsResultCache.get(cacheKey);
  const vals = buildSeries(habit, granularity, baseMode, start, end);
  const calVals = buildSeries(habit, granularity, "CALENDAR", start, end);
  const stat = summarizeSeries(vals, calVals);
  habitStatsResultCache.set(cacheKey, stat);
  return stat;
}

function getStatValueForKey(stat, key) {
  const map = {
    MEAN: stat.mean,
    TOTAL: stat.total,
    MEDIAN: stat.median,
    MODE: stat.mode,
    P25: stat.p25,
    P50: stat.p50,
    P75: stat.p75,
    P90: stat.p90,
    MAX: stat.max,
    ACTIVE_RATE: stat.activeRate,
    TOTAL_TYPICAL: stat.median
  };
  return Number(map[key] || 0);
}

function getCompareAggregate(selection, mode) {
  const selectionToken = selection?.kind === "real" ? selection?.token : null;
  const range = selection?.kind === "real" ? getRangeForCompare(mode, selectionToken) : null;
  const includesToday = !!(range && range.start <= new Date() && range.end >= new Date());
  const selectionKey = selection?.kind === "ref"
    ? `ref::${mode}::${habitStatsBaseMode}::${selection.statKey}::v${habitHistoryDataVersion}`
    : `real::${mode}::${selection?.token}::v${habitHistoryDataVersion}`;

  if (selection?.kind === "ref") {
    const cacheHit = habitCompareAverageCache.has(selectionKey);
    debugCompare("aggregate", {
      mode,
      kind: "ref",
      dataset: "history-stats",
      cache: cacheHit ? "HIT" : "MISS",
      cacheKey: selectionKey,
      rangeKey: `${mode}:${selection?.statKey || "MEAN"}`,
      lastDataVersion: habitHistoryDataVersion,
      lastHistoryUpdatedAt: habitHistoryUpdatedAt
    });
    if (cacheHit) return habitCompareAverageCache.get(selectionKey);
    const values = {};
    activeHabits().forEach((habit) => {
      const stat = getSeriesStat(habit, mode, habitStatsBaseMode);
      values[habit.id] = getStatValueForKey(stat, selection.statKey || "MEAN");
    });
    const entry = { kind: "ref", values, statKey: selection.statKey || "MEAN" };
    habitCompareAverageCache.set(selectionKey, entry);
    return entry;
  }

  const cacheHit = habitCompareAggregateCache.has(selectionKey);
  debugCompare("aggregate", {
    mode,
    kind: "real",
    dataset: "habitSessions+checks+counts",
    cache: cacheHit ? "HIT" : "MISS",
    cacheKey: selectionKey,
    rangeKey: `${mode}:${selection?.token || "-"}`,
    includesToday,
    runningSession: !!runningSession,
    lastDataVersion: habitHistoryDataVersion,
    lastHistoryUpdatedAt: habitHistoryUpdatedAt
  });
  let baseEntry = null;
  if (cacheHit) {
    baseEntry = habitCompareAggregateCache.get(selectionKey);
  } else {
    const baseValues = {};
    activeHabits().forEach((habit) => {
      baseValues[habit.id] = aggregateHabitValue(habit, range);
    });
    baseEntry = { kind: "real", range, baseValues };
    habitCompareAggregateCache.set(selectionKey, baseEntry);
  }

  if (!(runningSession && includesToday)) {
    return { kind: "real", range, values: { ...(baseEntry.baseValues || {}) } };
  }

  const valuesWithLive = { ...(baseEntry.baseValues || {}) };
  activeHabits().forEach((habit) => {
    const base = Number(baseEntry.baseValues?.[habit.id] || 0);
    const extra = getInProgressContributionForRange(habit, range);
    valuesWithLive[habit.id] = base + extra;
  });
  return { kind: "real", range, values: valuesWithLive };
}

function formatValueByType(value, type, withDecimals = false) {
  if (type === "duration") return formatMinutes(Math.round(value || 0));
  const safe = Number(value) || 0;
  if (withDecimals) {
    const rounded = Math.round(safe * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded.toFixed(0)}` : `${rounded.toFixed(1)}`;
  }
  return `${Math.round(safe)}`;
}

function computeCompareDeltaMeta(a, b, type) {
  const safeA = Number(a) || 0;
  const safeB = Number(b) || 0;
  const diff = safeA - safeB;
  const abs = Math.abs(diff);
  const value = type === "duration" ? formatMinutes(Math.round(abs)) : formatValueByType(abs, type, true);
  const sign = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  let pct = "—";
  if (!safeA && !safeB) {
    pct = "—";
  } else if (!safeB && safeA > 0) {
    pct = "nuevo";
  } else {
    const ratio = ((safeA - safeB) / Math.max(Math.abs(safeB), 1e-9)) * 100;
    pct = `${ratio >= 0 ? "+" : ""}${Math.round(ratio)}%`;
  }
  const delta = sign === "flat" ? "—" : `${sign === "up" ? "↑" : "↓"} ${diff > 0 ? "+" : "-"}${value}`;
  return { sign, delta, pct };
}

function runCompareDeltaSelfChecks() {
  const t1 = computeCompareDeltaMeta(0, 8 * 60, "duration");
  console.assert(t1.sign === "down", "[Habits compare] A=0, B=8h should be down");
  console.assert(t1.delta.includes("↓ -8h"), "[Habits compare] A=0, B=8h should show -8h");

  const t2 = computeCompareDeltaMeta(8 * 60, 0, "duration");
  console.assert(t2.sign === "up", "[Habits compare] A=8h, B=0 should be up");
  console.assert(t2.delta.includes("↑ +8h"), "[Habits compare] A=8h, B=0 should show +8h");

  const t3 = computeCompareDeltaMeta(4 * 60, 8 * 60, "duration");
  console.assert(t3.sign === "down", "[Habits compare] A=4h, B=8h should be down");
  console.assert(t3.delta.includes("↓ -4h"), "[Habits compare] A=4h, B=8h should show -4h");
}
runCompareDeltaSelfChecks();

function buildCompareRows(habitsList, mode, selectionA, selectionB, sortMode) {
  debugCompare("recompute A/B", {
    mode,
    rangeKeyA: selectionA?.kind === "real" ? `${mode}:${selectionA?.token}` : `ref:${selectionA?.statKey || "MEAN"}`,
    rangeKeyB: selectionB?.kind === "real" ? `${mode}:${selectionB?.token}` : `ref:${selectionB?.statKey || "MEAN"}`,
    lastDataVersion: habitHistoryDataVersion,
    lastHistoryUpdatedAt: habitHistoryUpdatedAt
  });
  const aggA = getCompareAggregate(selectionA, mode);
  const aggB = getCompareAggregate(selectionB, mode);
  const useDecimals = selectionA?.kind === "ref" || selectionB?.kind === "ref";
  const rowsRaw = habitsList.map((habit) => {
    const type = resolveCompareType(habit);
    const a = Number(aggA.values[habit.id] || 0);
    const b = Number(aggB.values[habit.id] || 0);
    return {
      habit,
      type,
      a,
      b,
      delta: a - b,
      absDelta: Math.abs(a - b),
      color: resolveHabitColor(habit),
      emoji: habit?.emoji || "✨",
      useDecimals,
      marked: !!habitCompareMarked?.[habit.id],
      deltaMeta: computeCompareDeltaMeta(a, b, type)
    };
  });

  const visibleRows = rowsRaw.filter((row) => {
    if (habitCompareHidden?.[row.habit.id]) return false;
    if (habitCompareFilters.type === "time" && row.type !== "duration") return false;
    if (habitCompareFilters.type === "counter" && row.type === "duration") return false;
    if (habitCompareFilters.delta === "up" && row.delta <= 0) return false;
    if (habitCompareFilters.delta === "down" && row.delta >= 0) return false;
    if (habitCompareFilters.delta === "flat" && row.delta !== 0) return false;
    if (habitCompareFilters.marked === "only" && !row.marked) return false;
    if (habitCompareFilters.marked === "hide" && row.marked) return false;
    return true;
  });

  const globalScaleMax = visibleRows.reduce((max, row) => Math.max(max, row.a, row.b), 0) || 1;
  visibleRows.forEach((row) => {
    const rowScaleMax = (Math.max(row.a, row.b) * 1.05) || 1;
    const scaleMax = habitCompareScaleMode === "relative" ? rowScaleMax : globalScaleMax;
    row.aPct = (row.a / scaleMax) * 100;
    row.bPct = (row.b / scaleMax) * 100;
  });

  visibleRows.sort((left, right) => {
    if (sortMode === "a") return right.a - left.a || right.absDelta - left.absDelta;
    if (sortMode === "b") return right.b - left.b || right.absDelta - left.absDelta;
    if (sortMode === "positive") {
      const leftPos = left.delta > 0 ? 1 : 0;
      const rightPos = right.delta > 0 ? 1 : 0;
      return rightPos - leftPos || right.delta - left.delta || right.absDelta - left.absDelta;
    }
    if (sortMode === "negative") {
      const leftNeg = left.delta < 0 ? 1 : 0;
      const rightNeg = right.delta < 0 ? 1 : 0;
      return rightNeg - leftNeg || left.delta - right.delta || right.absDelta - left.absDelta;
    }
    return right.absDelta - left.absDelta || right.a - left.a;
  });

  const hiddenCount = Object.keys(habitCompareHidden || {}).filter((id) => habitCompareHidden[id]).length;
  const activeFilterCount = [
    habitCompareFilters.type !== "all",
    habitCompareFilters.delta !== "all",
    habitCompareFilters.marked !== "all",
    hiddenCount > 0
  ].filter(Boolean).length;

  return { rows: visibleRows, total: rowsRaw.length, shown: visibleRows.length, activeFilterCount };
}


function compareSelectionIncludesToday(mode, selection) {
  if (!selection || selection.kind !== "real") return false;
  const range = getRangeForCompare(mode, selection.token);
  const now = new Date();
  return !!(range && range.start <= now && range.end >= now);
}

function updateCompareLiveInterval() {
  const shouldTick = !!(
    activeTab === "history"
    && runningSession
    && (
      compareSelectionIncludesToday(habitCompareMode, habitCompareSelectionA)
      || compareSelectionIncludesToday(habitCompareMode, habitCompareSelectionB)
    )
  );

  if (!shouldTick) {
    if (compareLiveInterval) {
      clearInterval(compareLiveInterval);
      compareLiveInterval = null;
      debugCompare("live tick stopped");
    }
    return;
  }

  if (compareLiveInterval) return;
  compareLiveInterval = setInterval(() => {
    compareLiveTick += 1;
    invalidateCompareCache();
    debugCompare("live tick", { compareLiveTick, mode: habitCompareMode });
    if (activeTab === "history") renderHistory();
  }, 10000);
  debugCompare("live tick started", { mode: habitCompareMode });
}

function renderHistoryCompareCard(habitsList) {
  const card = document.createElement("section");
  card.className = "habits-history-section habit-compare-card";

  const header = document.createElement("div");
  header.className = "habits-history-section-header";
  const titleWrap = document.createElement("div");
  const title = document.createElement("div");
  title.className = "habits-history-section-title";
  title.textContent = "Comparativa";
  const sub = document.createElement("div");
  sub.className = "habits-history-list-meta";
  sub.textContent = getCompareSubtitle(habitCompareMode, habitCompareSelectionA, habitCompareSelectionB);
  titleWrap.appendChild(title);
  titleWrap.appendChild(sub);
  header.appendChild(titleWrap);

  const controls = document.createElement("div");
  controls.className = "habits-history-section-controls habit-compare-controls";

  const primaryLabel = document.createElement("div");
  primaryLabel.className = "habit-compare-primary-title";
  primaryLabel.textContent = "Comparación";
  controls.appendChild(primaryLabel);

  const createCompareSelect = (label, value, entries, onChange) => {
    const wrap = document.createElement("label");
    wrap.className = "habit-compare-field";
    const txt = document.createElement("span");
    txt.className = "habit-compare-field-label";
    txt.textContent = label;
    const select = document.createElement("select");
    select.className = "habits-history-select habit-compare-select";
    entries.forEach(([key, name]) => {
      const opt = document.createElement("option");
      opt.value = key;
      opt.textContent = name;
      select.appendChild(opt);
    });
    select.value = value;
    select.addEventListener("change", (e) => onChange(e.target.value));
    wrap.appendChild(txt);
    wrap.appendChild(select);
    return wrap;
  };

  const createCompareSection = (id, titleText, summaryText, renderBody) => {
    const details = document.createElement("details");
    details.className = "habit-compare-section";
    if (habitCompareSectionsOpen[id]) details.open = true;
    details.addEventListener("toggle", () => {
      habitCompareSectionsOpen = { ...habitCompareSectionsOpen, [id]: details.open };
    });

    const summary = document.createElement("summary");
    summary.className = "habit-compare-section-summary";
    const heading = document.createElement("span");
    heading.className = "habit-compare-section-title";
    heading.textContent = titleText;
    const meta = document.createElement("span");
    meta.className = "habit-compare-section-meta";
    meta.textContent = summaryText;
    summary.appendChild(heading);
    summary.appendChild(meta);
    details.appendChild(summary);

    const bodyWrap = document.createElement("div");
    bodyWrap.className = "habit-compare-section-body";
    renderBody(bodyWrap);
    details.appendChild(bodyWrap);
    return details;
  };

  const compactRow = document.createElement("div");
  compactRow.className = "habit-compare-compact-row";

  const modeToggle = document.createElement("div");
  modeToggle.className = "habits-history-toggle";
  [["day", "Día"], ["week", "Semana"], ["month", "Mes"], ["year", "Año"]].forEach(([key, label]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habits-history-toggle-btn";
    btn.textContent = label;
    btn.setAttribute("aria-pressed", habitCompareMode === key ? "true" : "false");
    if (habitCompareMode === key) btn.classList.add("is-active");
    btn.addEventListener("click", () => {
      habitCompareMode = key;
      const options = getCompareOptions(habitCompareMode);
      habitCompareSelectionA = null;
      habitCompareSelectionB = null;
      ensureCompareSelections(habitCompareMode, options);
      renderHistory();
    });
    modeToggle.appendChild(btn);
  });
  compactRow.appendChild(modeToggle);

  const options = getCompareOptions(habitCompareMode);
  ensureCompareSelections(habitCompareMode, options);
  updateCompareLiveInterval();

  const refTypeChoices = [
    ["MEAN", "Media"],
    ["MEDIAN", "Mediana"],
    ["MODE", "Moda"],
    ["P25", "P25"],
    ["P50", "P50"],
    ["P75", "P75"],
    ["P90", "P90"],
    ["MAX", "Máx"],
    ["TOTAL_TYPICAL", "Total típico"]
  ];

  const makeSelectionBlock = (tagName, selection, onChange) => {
    const row = document.createElement("div");
    row.className = "compare-row";

    const typeField = document.createElement("label");
    typeField.className = "compare-field habit-compare-field";
    const typeLabel = document.createElement("span");
    typeLabel.className = "habit-compare-field-label";
    typeLabel.textContent = `${tagName} tipo`;
    const typeSelect = document.createElement("select");
    typeSelect.className = "habits-history-select habit-compare-select";
    const realOpt = document.createElement("option");
    realOpt.value = "real";
    realOpt.textContent = `${habitCompareMode === "day" ? "Día" : habitCompareMode === "week" ? "Semana" : habitCompareMode === "month" ? "Mes" : "Año"} real`;
    const avgOpt = document.createElement("option");
    avgOpt.value = "ref";
    avgOpt.textContent = "Referencia";
    typeSelect.appendChild(realOpt);
    typeSelect.appendChild(avgOpt);
    typeSelect.value = selection?.kind || "real";
    typeField.appendChild(typeLabel);
    typeField.appendChild(typeSelect);

    const valueField = document.createElement("div");
    valueField.className = "compare-field habit-compare-field";
    const valueLabel = document.createElement("span");
    valueLabel.className = "habit-compare-field-label";
    valueLabel.textContent = `${tagName} valor`;
    const valueWrap = document.createElement("div");
    valueWrap.className = "habit-compare-select-value";
    valueField.appendChild(valueLabel);
    valueField.appendChild(valueWrap);

    const renderValueControl = () => {
      valueWrap.innerHTML = "";
      if (typeSelect.value === "real") {
        const select = document.createElement("select");
        select.className = "habits-history-select habit-compare-select";
        options.forEach((opt) => {
          const o = document.createElement("option");
          o.value = opt.token;
          o.textContent = opt.label;
          select.appendChild(o);
        });
        const selectedToken = selection?.kind === "real"
          ? selection.token
          : getCompareDefaultSelections(habitCompareMode).a.token;
        if (options.some((it) => it.token === selectedToken)) select.value = selectedToken;
        select.addEventListener("change", (e) => onChange({ kind: "real", token: e.target.value }));
        valueWrap.appendChild(select);
        onChange({ kind: "real", token: select.value }, true);
      } else {
        const select = document.createElement("select");
        select.className = "habits-history-select habit-compare-select";
        refTypeChoices.forEach(([statKey, label]) => {
          const o = document.createElement("option");
          o.value = statKey;
          o.textContent = label;
          select.appendChild(o);
        });
        const selectedType = selection?.kind === "ref" ? selection.statKey : getCompareDefaultSelections(habitCompareMode).b.statKey;
        select.value = selectedType;
        select.addEventListener("change", (e) => onChange({ kind: "ref", statKey: e.target.value }));

        const hint = document.createElement("div");
        hint.className = "habit-compare-avg-hint";
        hint.textContent = `${getCompareStatLabel(select.value, habitCompareMode)} (histórico · ${habitStatsBaseMode === "CALENDAR" ? "calendario" : "con registro"})`;
        select.addEventListener("change", () => {
          hint.textContent = `${getCompareStatLabel(select.value, habitCompareMode)} (histórico · ${habitStatsBaseMode === "CALENDAR" ? "calendario" : "con registro"})`;
        });
        valueWrap.appendChild(select);
        valueWrap.appendChild(hint);
        onChange({ kind: "ref", statKey: select.value }, true);
      }
    };

    typeSelect.addEventListener("change", () => {
      renderValueControl();
      renderHistory();
    });
    renderValueControl();

    row.appendChild(typeField);
    row.appendChild(valueField);
    return row;
  };

  const selectors = document.createElement("div");
  selectors.className = "habit-compare-selectors";
  selectors.appendChild(makeSelectionBlock("A", habitCompareSelectionA, (next, silent = false) => {
    habitCompareSelectionA = next;
    if (
      habitCompareSelectionA?.kind === "real"
      && habitCompareSelectionB?.kind === "real"
      && habitCompareSelectionA.token === habitCompareSelectionB.token
    ) {
      const fallback = options.find((it) => it.token !== habitCompareSelectionA.token);
      if (fallback) habitCompareSelectionB = { kind: "real", token: fallback.token };
    }
    if (!silent) renderHistory();
  }));
  selectors.appendChild(makeSelectionBlock("B", habitCompareSelectionB, (next, silent = false) => {
    habitCompareSelectionB = next;
    if (
      habitCompareSelectionA?.kind === "real"
      && habitCompareSelectionB?.kind === "real"
      && habitCompareSelectionA.token === habitCompareSelectionB.token
    ) {
      const fallback = options.find((it) => it.token !== habitCompareSelectionB.token);
      if (fallback) habitCompareSelectionA = { kind: "real", token: fallback.token };
    }
    if (!silent) renderHistory();
  }));
  compactRow.appendChild(selectors);
  controls.appendChild(compactRow);

  const presetsRow = document.createElement("div");
  presetsRow.className = "habit-compare-presets";
  const presetMap = {
    day: [
      { label: "Hoy vs Media", a: { kind: "real", token: dateKeyLocal(new Date()) }, b: { kind: "ref", statKey: "MEAN" } },
      { label: "Hoy vs Ayer", a: { kind: "real", token: dateKeyLocal(new Date()) }, b: { kind: "real", token: dateKeyLocal(addDays(new Date(), -1)) } }
    ],
    week: [{ label: "Semana vs Media", a: getCompareDefaultSelections("week").a, b: { kind: "ref", statKey: "MEAN" } }],
    month: [{ label: "Mes vs Media", a: getCompareDefaultSelections("month").a, b: { kind: "ref", statKey: "MEAN" } }],
    year: [{ label: "Año vs Media", a: getCompareDefaultSelections("year").a, b: { kind: "ref", statKey: "MEAN" } }]
  };
  (presetMap[habitCompareMode] || []).forEach((preset) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habits-history-toggle-btn";
    btn.textContent = preset.label;
    btn.addEventListener("click", () => {
      habitCompareSelectionA = { ...preset.a };
      habitCompareSelectionB = { ...preset.b };
      renderHistory();
    });
    presetsRow.appendChild(btn);
  });
  controls.appendChild(presetsRow);

  const deltaSummary = habitCompareFilters.delta === "up"
    ? "Solo positivos"
    : habitCompareFilters.delta === "down"
      ? "Solo negativos"
      : habitCompareFilters.delta === "flat"
        ? "Solo 0"
        : habitCompareSort === "positive"
          ? "Positivos primero"
          : habitCompareSort === "negative"
            ? "Negativos primero"
            : "Todos";
  const orderSummary = `${habitCompareSort === "delta" ? "Más cambio" : habitCompareSort === "a" ? "A mayor" : habitCompareSort === "b" ? "B mayor" : habitCompareSort === "positive" ? "Positivos" : "Negativos"} · ${habitCompareView === "summary" ? "Resumen" : "Detalle"} · ${deltaSummary}`;
  controls.appendChild(createCompareSection("orderView", "Orden y vista", orderSummary, (bodyWrap) => {
    const row = document.createElement("div");
    row.className = "habit-compare-filter-row";
    row.appendChild(createCompareSelect("Orden", habitCompareSort, [["delta", "Más cambio"], ["a", "A mayor"], ["b", "B mayor"]], (next) => {
      habitCompareSort = next;
      persistHabitCompareSettings();
      renderHistory();
    }));
    const deltaSelectValue = habitCompareFilters.delta === "up"
      ? "up"
      : habitCompareFilters.delta === "down"
        ? "down"
        : habitCompareFilters.delta === "flat"
          ? "flat"
          : habitCompareSort === "positive"
            ? "positive"
            : habitCompareSort === "negative"
              ? "negative"
              : "all";
    row.appendChild(createCompareSelect("Positivos/Negativos", deltaSelectValue, [["all", "Todos"], ["positive", "Positivos primero"], ["negative", "Negativos primero"], ["up", "Solo positivos"], ["down", "Solo negativos"], ["flat", "Solo 0"]], (next) => {
      if (next === "positive" || next === "negative") {
        habitCompareSort = next;
        habitCompareFilters = { ...habitCompareFilters, delta: "all" };
      } else {
        habitCompareFilters = { ...habitCompareFilters, delta: next };
      }
      persistHabitCompareSettings();
      renderHistory();
    }));
    row.appendChild(createCompareSelect("Vista", habitCompareView, [["summary", "Resumen"], ["detail", "Detalle"]], (next) => {
      habitCompareView = next;
      renderHistory();
    }));
    bodyWrap.appendChild(row);
  }));

  controls.appendChild(createCompareSection("scale", "Escala", habitCompareScaleMode === "relative" ? "Relativa" : "Global", (bodyWrap) => {
    const scaleToggle = document.createElement("div");
    scaleToggle.className = "habits-history-toggle";
    [["relative", "Relativa"], ["global", "Global"]].forEach(([key, label]) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "habits-history-toggle-btn";
      if (habitCompareScaleMode === key) btn.classList.add("is-active");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        habitCompareScaleMode = key;
        persistHabitCompareSettings();
        renderHistory();
      });
      scaleToggle.appendChild(btn);
    });
    bodyWrap.appendChild(scaleToggle);
  }));

  const filterSummary = `${habitCompareFilters.type === "all" ? "Todos" : habitCompareFilters.type === "time" ? "Tiempo" : "Contador"} · ${habitCompareFilters.marked === "all" ? "Todos" : habitCompareFilters.marked === "only" ? "Solo marcados" : "Ocultar marcados"}`;
  controls.appendChild(createCompareSection("filters", "Filtros", filterSummary, (bodyWrap) => {
    const filterRow = document.createElement("div");
    filterRow.className = "habit-compare-filter-row";
    filterRow.appendChild(createCompareSelect("Tipo", habitCompareFilters.type, [["all", "Todos"], ["time", "Tiempo"], ["counter", "Contador"]], (next) => {
      habitCompareFilters = { ...habitCompareFilters, type: next };
      persistHabitCompareSettings();
      renderHistory();
    }));
    filterRow.appendChild(createCompareSelect("Marcados", habitCompareFilters.marked, [["all", "Todos"], ["only", "Solo marcados"], ["hide", "Ocultar marcados"]], (next) => {
      habitCompareFilters = { ...habitCompareFilters, marked: next };
      persistHabitCompareSettings();
      renderHistory();
    }));
    bodyWrap.appendChild(filterRow);

    const hiddenList = document.createElement("div");
    hiddenList.className = "habit-compare-hidden-list";
    habitsList.forEach((habit) => {
      const label = document.createElement("label");
      label.className = "habit-compare-hidden-item";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!habitCompareHidden?.[habit.id];
      input.addEventListener("change", () => {
        habitCompareHidden = { ...habitCompareHidden, [habit.id]: input.checked };
        persistHabitCompareSettings();
        renderHistory();
      });
      const text = document.createElement("span");
      text.textContent = `${habit.emoji || "✨"} ${habit.name}`;
      label.appendChild(input);
      label.appendChild(text);
      hiddenList.appendChild(label);
    });
    bodyWrap.appendChild(hiddenList);
  }));

  header.appendChild(controls);
  card.appendChild(header);

  const body = document.createElement("div");
  body.className = "habits-history-section-body";
  const globalLabels = document.createElement("div");
  globalLabels.className = "habit-compare-global-labels";
  const labelA = document.createElement("span");
  const labelB = document.createElement("span");
  labelA.textContent = `A · ${formatCompareSelection(habitCompareMode, habitCompareSelectionA)}`;
  labelB.textContent = `B · ${formatCompareSelection(habitCompareMode, habitCompareSelectionB)}`;
  globalLabels.appendChild(labelA);
  globalLabels.appendChild(labelB);
  body.appendChild(globalLabels);

  const rowsData = buildCompareRows(habitsList, habitCompareMode, habitCompareSelectionA, habitCompareSelectionB, habitCompareSort);

  const activeFiltersMeta = document.createElement("div");
  activeFiltersMeta.className = "habits-history-list-meta";
  activeFiltersMeta.textContent = `Mostrando ${rowsData.shown} de ${rowsData.total}${rowsData.activeFilterCount ? ` · ${rowsData.activeFilterCount} filtros activos` : ""}`;
  body.appendChild(activeFiltersMeta);

  const list = document.createElement("div");
  list.className = "habit-compare-list";
  list.classList.toggle("is-summary", habitCompareView === "summary");

  rowsData.rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "habit-compare-row";
    rowEl.style.setProperty("--hclr", row.color || DEFAULT_COLOR);
    rowEl.style.setProperty("--hclr-rgb", hexToRgbString(row.color || DEFAULT_COLOR));
    rowEl.tabIndex = 0;
    rowEl.addEventListener("click", () => openHabitDetail(row.habit.id, todayKey()));
    rowEl.addEventListener("keydown", (evt) => {
      if (evt.key === "Enter" || evt.key === " ") {
        evt.preventDefault();
        openHabitDetail(row.habit.id, todayKey());
      }
    });

    const markBtn = document.createElement("button");
    markBtn.type = "button";
    markBtn.className = `habit-compare-mark-btn${row.marked ? " is-active" : ""}`;
    markBtn.textContent = row.marked ? "⭐" : "☆";
    markBtn.addEventListener("click", (evt) => {
      evt.stopPropagation();
      habitCompareMarked = { ...habitCompareMarked, [row.habit.id]: !row.marked };
      persistHabitCompareSettings();
      renderHistory();
    });

    if (habitCompareView === "summary") {
      rowEl.classList.add("is-summary");
      const summary = document.createElement("div");
      summary.className = "habit-compare-summary";
      const leftChunk = document.createElement("div");
      leftChunk.className = "habit-compare-summary-main";
      leftChunk.textContent = `${row.emoji} ${row.habit.name}`;
      const delta = document.createElement("span");
      delta.className = `habit-compare-delta is-${row.deltaMeta.sign}`;
      delta.textContent = row.deltaMeta.delta;
      const pct = document.createElement("span");
      pct.className = "habit-compare-pct";
      pct.textContent = row.deltaMeta.pct;
      summary.appendChild(leftChunk);
      summary.appendChild(delta);
      summary.appendChild(pct);
      summary.appendChild(markBtn);
      rowEl.appendChild(summary);
    } else {
      const head = document.createElement("div");
      head.className = "habit-compare-row-head";
      const name = document.createElement("div");
      name.className = "habits-history-list-title";
      name.textContent = row.habit.name;
      const delta = document.createElement("div");
      delta.className = `habit-compare-delta is-${row.deltaMeta.sign}`;
      delta.textContent = `${row.deltaMeta.delta} · ${row.deltaMeta.pct}`;
      head.appendChild(name);
      head.appendChild(delta);
      head.appendChild(markBtn);

      const bars = document.createElement("div");
      bars.className = "habit-compare-bars";
      const left = document.createElement("div");
      left.className = "habit-compare-side is-left";
      const right = document.createElement("div");
      right.className = "habit-compare-side is-right";
      const center = document.createElement("div");
      center.className = "habit-compare-center";
      center.textContent = row.emoji;
      const aBar = document.createElement("span");
      aBar.className = "habit-compare-fill";
      aBar.style.width = `${row.aPct}%`;
      const bBar = document.createElement("span");
      bBar.className = "habit-compare-fill";
      bBar.style.width = `${row.bPct}%`;
      left.appendChild(aBar);
      right.appendChild(bBar);
      bars.appendChild(left);
      bars.appendChild(center);
      bars.appendChild(right);

      const labels = document.createElement("div");
      labels.className = "habit-compare-values";
      const la = document.createElement("span");
      la.textContent = formatValueByType(row.a, row.type, row.useDecimals);
      const lb = document.createElement("span");
      lb.textContent = formatValueByType(row.b, row.type, row.useDecimals);
      labels.appendChild(la);
      labels.appendChild(lb);

      rowEl.appendChild(head);
      rowEl.appendChild(bars);
      rowEl.appendChild(labels);
    }
    list.appendChild(rowEl);
  });
  body.appendChild(list);
  card.appendChild(body);

  return card;
}

function getStatGranularityLabel(granularity) {
  return granularity === "day" ? "día" : granularity === "week" ? "semana" : granularity === "month" ? "mes" : "año";
}

function getStatUnitSuffix(view, granularity) {
  if (view === "TOTAL" || view === "ACTIVE_RATE") return "";
  return `/${getStatGranularityLabel(granularity)}`;
}

function getStatExplanation(view, granularity, baseMode) {
  const unidad = getStatGranularityLabel(granularity);
  const unidades = `${unidad}${unidad === "mes" ? "es" : "s"}`;
  const baseText = baseMode === "CALENDAR"
    ? "Calendario cuenta también las unidades sin registro como 0."
    : "Con registro solo usa unidades con actividad (>0).";
  const map = {
    MEAN: { title: "Media", lines: [`Promedio por ${unidad}: total dividido entre número de ${unidades}.`, baseText] },
    TOTAL: { title: "Total", lines: [`Suma histórica completa de ese hábito en todo el periodo guardado.`, `No es un promedio: es acumulado puro.`] },
    MEDIAN: { title: "Mediana", lines: [`Valor del medio: la mitad de ${unidades} queda por debajo y la otra mitad por encima.`, "Resiste mejor días extremos que la media."] },
    MODE: { title: "Moda", lines: [`Valor que más se repite por ${unidad}.`, "Si hay empate de modas mostramos la menor y marcamos “multi”."] },
    P25: { title: "P25", lines: [`Nivel bajo típico: 25% de ${unidades} está por debajo.`, baseText] },
    P50: { title: "P50", lines: ["P50 es exactamente la mediana.", baseText] },
    P75: { title: "P75", lines: [`En el 75% de ${unidades} haces como mucho ese valor; el 25% mejor queda por encima.`, baseText] },
    P90: { title: "P90", lines: [`Tu nivel alto típico: solo el 10% de ${unidades} lo supera.`, baseText] },
    MAX: { title: "Máximo", lines: [`Tu récord en una sola ${unidad} dentro del histórico.`, "Útil para ver picos, no la rutina normal."] },
    ACTIVE_RATE: { title: "Activos%", lines: [`Porcentaje de ${unidades} con actividad (>0).`, "Siempre se calcula sobre Calendario para medir constancia real."] }
  };
  return map[view] || map.MEAN;
}

function renderHistoryStatsCard(habitsList) {
  const section = createHistorySection("Estadísticas");
  const controls = document.createElement("div");
  controls.className = "habits-history-section-controls habit-stats-controls";

  const makeStatsSelect = (label, value, entries, onChange) => {
    const wrap = document.createElement("label");
    wrap.className = "habit-compare-field";
    const txt = document.createElement("span");
    txt.className = "habit-compare-field-label";
    txt.textContent = label;
    const select = document.createElement("select");
    select.className = "habits-history-select habit-compare-select";
    entries.forEach(([key, name]) => {
      const option = document.createElement("option");
      option.value = key;
      option.textContent = name;
      select.appendChild(option);
    });
    select.value = value;
    select.addEventListener("change", (e) => onChange(e.target.value));
    wrap.appendChild(txt);
    wrap.appendChild(select);
    return wrap;
  };

  controls.appendChild(makeStatsSelect("Métrica", habitStatsView, [
    ["MEAN", "Media"], ["TOTAL", "Total"], ["MEDIAN", "Mediana"], ["MODE", "Moda"],
    ["P25", "P25"], ["P50", "P50"], ["P75", "P75"], ["P90", "P90"], ["MAX", "Máx"], ["ACTIVE_RATE", "Activos%"]
  ], (next) => {
    habitStatsView = next;
    renderHistory();
  }));
  controls.appendChild(makeStatsSelect("Unidad", habitStatsGranularity, [["day", "Día"], ["week", "Semana"], ["month", "Mes"], ["year", "Año"]], (next) => {
    habitStatsGranularity = next;
    renderHistory();
  }));
  controls.appendChild(makeStatsSelect("Base", habitStatsBaseMode, [["CALENDAR", "Calendario"], ["RECORDED_ONLY", "Con registro"]], (next) => {
    habitStatsBaseMode = next;
    invalidateCompareCache();
    renderHistory();
  }));
  section.header.appendChild(controls);

  const rows = habitsList.map((habit) => {
    const type = resolveCompareType(habit);
    const stat = getSeriesStat(habit, habitStatsGranularity, habitStatsBaseMode);
    return { habit, type, stat, value: getStatValueForKey(stat, habitStatsView), color: resolveHabitColor(habit), emoji: habit?.emoji || "🏷️" };
  }).sort((a, b) => habitStatsSort === "asc" ? a.value - b.value : b.value - a.value);

  const list = document.createElement("div");
  list.className = "habits-history-list";
  rows.forEach((row) => {
    const rowEl = document.createElement("div");
    rowEl.className = "habits-history-list-row";
    rowEl.style.setProperty("--hclr", row.color || DEFAULT_COLOR);
    rowEl.style.setProperty("--hclr-rgb", hexToRgbString(row.color || DEFAULT_COLOR));
    const left = document.createElement("div");
    const title = document.createElement("div");
    title.className = "habits-history-list-title";
    title.textContent = `${row.emoji} ${row.habit.name}`;
    left.appendChild(title);

    if (habitStatsView === "MODE" && row.stat.modeMulti) {
      const meta = document.createElement("div");
      meta.className = "habits-history-list-meta";
      meta.textContent = "multi";
      left.appendChild(meta);
    }

    const value = document.createElement("div");
    value.className = "habits-history-list-value";
    if (habitStatsView === "ACTIVE_RATE") {
      value.textContent = `${Math.round(row.value)}%`;
    } else {
      const useDecimals = row.type !== "duration" && habitStatsView !== "TOTAL";
      value.textContent = `${formatValueByType(row.value, row.type, useDecimals)}${getStatUnitSuffix(habitStatsView, habitStatsGranularity)}`;
    }
    rowEl.appendChild(left);
    rowEl.appendChild(value);
    list.appendChild(rowEl);
  });
  section.body.appendChild(list);

  const explanation = getStatExplanation(habitStatsView, habitStatsGranularity, habitStatsBaseMode);
  const box = document.createElement("div");
  box.className = "habit-stats-explainer";
  const title = document.createElement("div");
  title.className = "habit-stats-explainer-title";
  title.textContent = explanation.title;
  box.appendChild(title);
  explanation.lines.slice(0, 3).forEach((line) => {
    const p = document.createElement("div");
    p.className = "habit-stats-explainer-line";
    p.textContent = line;
    box.appendChild(p);
  });
  section.body.appendChild(box);

  return section.section;
}

function formatHistoryValue(value, metric) {
  const safe = Math.round(Number(value) || 0);
  if (metric === "time") return formatMinutes(safe);
  return `${safe}×`;
}

function getHabitQuantityForDate(habit, dateKey) {
  if (!habit || habit.archived) return 0;
  if ((habit.goal || "check") === "count") {
    return getHabitCount(habit.id, dateKey);
  }
  const dayData = getHabitDayScore(habit, dateKey);
  return dayData.hasActivity ? 1 : 0;
}

function getLiveRunningMinutesForHabitDate(habitId, dateKey) {
  if (!runningSession || !habitId || !dateKey) return 0;
  const targetId = runningSession?.targetHabitId || null;
  if (!targetId || targetId !== habitId) return 0;
  const nowTs = Date.now();
  const startTs = Number(runningSession.startTs) || nowTs;
  const startDateKey = dateKeyLocal(new Date(startTs));
  if (startDateKey !== dateKey) return 0;
  const sec = Math.max(0, Math.round((nowTs - startTs) / 1000));
  return Math.round(sec / 60);
}

function getHabitMetricForDate(habit, dateKey, metric) {
  if (!habit || habit.archived) return 0;
  if (metric === "time") {
    const recorded = getSessionsForHabitDate(habit.id, dateKey).reduce((acc, s) => acc + minutesFromSession(s), 0);
    const live = getLiveRunningMinutesForHabitDate(habit.id, dateKey);
    return recorded + live;
  }
  return getHabitQuantityForDate(habit, dateKey);
}

function countForHabitRange(habit, start, end) {
  let total = 0;
  if (!habit || habit.archived) return 0;
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = dateKeyLocal(d);
    total += getHabitQuantityForDate(habit, key);
  }
  return total;
}

function getHabitMetricForRange(habit, start, end, metric) {
  if (metric === "time") return minutesForHabitRange(habit, start, end);
  return countForHabitRange(habit, start, end);
}

function hasAnyHistoryDataInRange(start, end) {
  return activeHabits().some((habit) => {
    const checks = habitChecks[habit.id] || {};
    if (Object.keys(checks).some((key) => {
      const parsed = parseDateKey(key);
      return parsed && isDateInRange(parsed, start, end);
    })) return true;
    const counts = habitCounts[habit.id] || {};
    if (Object.keys(counts).some((key) => {
      const parsed = parseDateKey(key);
      return parsed && isDateInRange(parsed, start, end) && Number(counts[key]) > 0;
    })) return true;
    const byDate = habitSessions?.[habit.id];
    if (byDate && typeof byDate === "object") {
      if (Object.keys(byDate).some((key) => {
        const parsed = parseDateKey(key);
        return parsed && isDateInRange(parsed, start, end) && getHabitTotalSecForDate(habit.id, key) > 0;
      })) return true;
    }
    return false;
  });
}

function createHistorySection(title) {
  const section = document.createElement("section");
  section.className = "habits-history-section";
  const header = document.createElement("div");
  header.className = "habits-history-section-header";
  const titleEl = document.createElement("div");
  titleEl.className = "habits-history-section-title";
  titleEl.textContent = title;
  header.appendChild(titleEl);
  const body = document.createElement("div");
  body.className = "habits-history-section-body";
  section.appendChild(header);
  section.appendChild(body);
  return { section, header, body };
}

function buildMonthlyTrendSeries(habitsList, metric, groupMode) {
  const today = new Date();
  const months = [];
  for (let i = 11; i >= 0; i -= 1) {
    const date = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const label = date.toLocaleDateString("es-ES", { month: "short", year: "2-digit" }).replace(".", "");
    months.push({
      year: date.getFullYear(),
      month: date.getMonth(),
      label
    });
  }

  const groups = new Map();
  const resolveGroup = (habit) => {
    if (groupMode?.kind === "param") {
      const cat = groupMode.cat;
      if (!cat) return null;
      const value = resolveHabitCategoryValue(habit, cat);
      const label = value === "mixto" ? "mixto" : (value || PARAM_EMPTY_LABEL);
      const key = normalizeParamKey(label) || PARAM_EMPTY_LABEL.toLowerCase();
      return { key, label, color: resolveParamKeyColor(label) };
    }
    return { key: habit.id, label: habit.name, color: resolveHabitColor(habit) };
  };

  months.forEach((month, idx) => {
    const start = new Date(month.year, month.month, 1);
    const end = new Date(month.year, month.month + 1, 0, 23, 59, 59, 999);
    habitsList.forEach((habit) => {
      const group = resolveGroup(habit);
      if (!group) return;
      const value = getHabitMetricForRange(habit, start, end, metric);
      if (!groups.has(group.key)) {
        groups.set(group.key, {
          key: group.key,
          label: group.label,
          color: group.color,
          values: Array(months.length).fill(0),
          total: 0
        });
      }
      const target = groups.get(group.key);
      target.values[idx] += value;
      target.total += value;
    });
  });

  const sorted = Array.from(groups.values()).filter((g) => g.total > 0).sort((a, b) => b.total - a.total);
  const topGroups = sorted.slice(0, 8);
  const otherGroups = sorted.slice(8);
  const series = topGroups.map((g) => ({ key: g.key, label: g.label, color: g.color }));
  if (otherGroups.length) {
    series.push({ key: "__other__", label: "Otros", color: getNeutralLineColor() });
  }

  const rows = months.map((month, idx) => {
    const values = {};
    let total = 0;
    sorted.forEach((g) => {
      total += g.values[idx] || 0;
    });
    topGroups.forEach((g) => {
      if (g.values[idx]) values[g.key] = g.values[idx];
    });
    if (otherGroups.length) {
      const otherValue = otherGroups.reduce((acc, g) => acc + (g.values[idx] || 0), 0);
      if (otherValue) values.__other__ = otherValue;
    }
    return { label: month.label, values, total };
  });

  return { rows, series };
}

function buildWeekComparison(habitsList, metric) {
  const today = new Date();
  const currentStart = startOfWeek(today);
  const currentEnd = endOfDay(addDays(currentStart, 6));
  const previousEnd = endOfDay(addDays(currentStart, -1));
  const previousStart = startOfWeek(previousEnd);

  const perHabit = habitsList.map((habit) => {
    const current = getHabitMetricForRange(habit, currentStart, currentEnd, metric);
    const previous = getHabitMetricForRange(habit, previousStart, previousEnd, metric);
    return { habit, current, previous, delta: current - previous };
  });
  const currentTotal = perHabit.reduce((acc, item) => acc + item.current, 0);
  const previousTotal = perHabit.reduce((acc, item) => acc + item.previous, 0);
  const delta = currentTotal - previousTotal;
  const deltaPercentLabel = previousTotal
    ? `${Math.round((delta / previousTotal) * 100)}%`
    : "—";
  const topUp = perHabit.filter((item) => item.delta > 0).sort((a, b) => b.delta - a.delta).slice(0, 3);
  const topDown = perHabit.filter((item) => item.delta < 0).sort((a, b) => a.delta - b.delta).slice(0, 3);
  return { currentTotal, previousTotal, delta, deltaPercentLabel, topUp, topDown };
}

function buildWeekMoveList(title, items, metric) {
  const wrapper = document.createElement("div");
  wrapper.className = "habits-history-week-list";
  const heading = document.createElement("div");
  heading.className = "habits-history-week-list-title";
  heading.textContent = title;
  wrapper.appendChild(heading);
  if (!items.length) {
    const empty = document.createElement("div");
    empty.className = "habits-history-empty";
    empty.textContent = "Sin cambios destacados.";
    wrapper.appendChild(empty);
    return wrapper;
  }
  const list = document.createElement("div");
  list.className = "habits-history-list";
  items.forEach((item) => {
    const row = document.createElement("div");
    row.className = "habits-history-list-row";
    setHabitColorVars(row, item.habit);
    const label = document.createElement("div");
    label.className = "habits-history-list-title";
    label.textContent = item.habit.name;
    const value = document.createElement("div");
    value.className = "habits-history-list-value";
    const delta = item.delta;
    value.textContent = `${delta >= 0 ? "+" : ""}${formatHistoryValue(Math.abs(delta), metric)}`;
    row.appendChild(label);
    row.appendChild(value);
    list.appendChild(row);
  });
  wrapper.appendChild(list);
  return wrapper;
}

function buildTopDays(habitsList, start, end, metric) {
  const rows = [];
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = dateKeyLocal(d);
    const perHabit = [];
    let total = 0;
    habitsList.forEach((habit) => {
      const value = getHabitMetricForDate(habit, key, metric);
      if (value > 0) {
        perHabit.push({ habit, value });
        total += value;
      }
    });
    if (total > 0) {
      perHabit.sort((a, b) => b.value - a.value);
      rows.push({
        dateKey: key,
        total,
        topHabits: perHabit.slice(0, 2)
      });
    }
  }
  return rows.sort((a, b) => b.total - a.total).slice(0, 10);
}

function buildWeekdayDistribution(habitsList, start, end, metric) {
  const labels = ["L", "M", "X", "J", "V", "S", "D"];
  const totals = Array(7).fill(0);
  for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
    const key = dateKeyLocal(d);
    const total = habitsList.reduce((acc, habit) => acc + getHabitMetricForDate(habit, key, metric), 0);
    if (total <= 0) continue;
    const idx = (d.getDay() + 6) % 7;
    totals[idx] += total;
  }
  const sum = totals.reduce((acc, v) => acc + v, 0);
  const items = totals.map((total, idx) => ({
    label: labels[idx],
    total,
    percent: sum ? Math.round((total / sum) * 100) : 0
  }));
  return { total: sum, items };
}

function buildBudgetSelect(options, selected) {
  const labels = {
    day: "Día",
    week: "Semana",
    month: "Mes",
    time: "Tiempo",
    count: "Cantidad"
  };
  const select = document.createElement("select");
  select.className = "habits-history-select";
  options.forEach((optValue) => {
    const opt = document.createElement("option");
    opt.value = optValue;
    opt.textContent = labels[optValue] || optValue;
    select.appendChild(opt);
  });
  select.value = selected;
  return select;
}

function getBudgetPeriodBounds(period) {
  const today = new Date();
  switch (period) {
    case "day": {
      const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return { start, end: endOfDay(today) };
    }
    case "month": {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      const end = new Date(today.getFullYear(), today.getMonth() + 1, 0, 23, 59, 59, 999);
      return { start, end };
    }
    case "week":
    default: {
      const start = startOfWeek(today);
      const end = endOfDay(addDays(start, 6));
      return { start, end };
    }
  }
}

function buildBudgetProgress(habit) {
  const budget = habit?.budget;
  if (!budget) return { value: 0, target: 0, percent: 0, periodLabel: "—", metric: "time" };
  const { start, end } = getBudgetPeriodBounds(budget.period || "week");
  const metric = budget.metric || "time";
  const value = getHabitMetricForRange(habit, start, end, metric);
  const target = Number(budget.value) || 0;
  const percent = target ? Math.round((value / target) * 100) : 0;
  const periodLabel = budget.period === "day"
    ? "Hoy"
    : (budget.period === "month" ? "Mes actual" : "Semana actual");
  return { value, target, percent, periodLabel, metric };
}

function isHabitBudgetCompleted(habit) {
  if (!habit?.budget) return false;
  const progress = buildBudgetProgress(habit);
  return progress.target > 0 && progress.value >= progress.target;
}

function formatHistoryMonthLabel(year, month) {
  const date = new Date(year, month, 1);
  return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
}

function normalizeHistoryMonthState(anchorDate = new Date()) {
  if (Number.isInteger(historyCalYear) && Number.isInteger(historyCalMonth)) return;
  historyCalYear = anchorDate.getFullYear();
  historyCalMonth = anchorDate.getMonth();
}

function shiftHistoryMonth(delta) {
  const next = new Date(historyCalYear, historyCalMonth + delta, 1);
  historyCalYear = next.getFullYear();
  historyCalMonth = next.getMonth();
}

function renderHistoryMonthGrid(year, month, grid) {
  if (!grid) return;
  grid.innerHTML = "";
  const start = new Date(year, month, 1);
  const end = new Date(year, month + 1, 0);
  const offset = (start.getDay() + 6) % 7;

  for (let i = 0; i < offset; i += 1) {
    const empty = document.createElement("div");
    empty.className = "history-month-cell is-out";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= end.getDate(); d += 1) {
    const date = new Date(year, month, d);
    const key = dateKeyLocal(date);
    const shiftClass = getShiftClassForDate(key);
    const dominant = getDayDominantHabit(key);

    const cell = document.createElement("button");
    cell.type = "button";
    cell.className = `history-month-cell ${shiftClass}`;

    if (dominant?.habit?.color) {
      cell.style.setProperty("--dom-rgb", hexToRgbString(dominant.habit.color));
      cell.classList.add("has-dominant");
    }

    cell.innerHTML =
      `<span class="month-day-num">${d}</span>` +
      `<span class="month-day-emoji">${dominant?.habit?.emoji || ""}</span>`;

    cell.addEventListener("click", () => openDayDetailModal(key));
    grid.appendChild(cell);
  }

  while (grid.children.length < 42) {
    const empty = document.createElement("div");
    empty.className = "history-month-cell is-out";
    grid.appendChild(empty);
  }
}


function buildHistoryMonthCalendar(anchorDate = new Date()) {
  normalizeHistoryMonthState(anchorDate);
  const wrap = document.createElement("section");
  wrap.className = "habits-history-section";
  const header = document.createElement("div");
  header.className = "habits-history-section-header";
  header.innerHTML = '<div class="habits-history-section-title">Calendario mensual</div>';
  const nav = document.createElement("div");
  nav.className = "habits-history-month-nav";
  const prevBtn = document.createElement("button");
  prevBtn.type = "button";
  prevBtn.className = "habits-history-month-nav-btn";
  prevBtn.textContent = "←";
  prevBtn.setAttribute("aria-label", "Mes anterior");
  const monthLabel = document.createElement("div");
  monthLabel.className = "habits-history-month-label";
  const nextBtn = document.createElement("button");
  nextBtn.type = "button";
  nextBtn.className = "habits-history-month-nav-btn";
  nextBtn.textContent = "→";
  nextBtn.setAttribute("aria-label", "Mes siguiente");
  nav.appendChild(prevBtn);
  nav.appendChild(monthLabel);
  nav.appendChild(nextBtn);
  header.appendChild(nav);
  const body = document.createElement("div");
  body.className = "habits-history-section-body";
  const weekdayHeader = document.createElement("div");
  weekdayHeader.className = "habit-month-weekdays";
  ["L", "M", "X", "J", "V", "S", "D"].forEach((label) => {
    const day = document.createElement("span");
    day.textContent = label;
    weekdayHeader.appendChild(day);
  });
  body.appendChild(weekdayHeader);
  const grid = document.createElement("div");
  grid.className = "history-month-grid";

  const updateCalendar = () => {
    monthLabel.textContent = formatHistoryMonthLabel(historyCalYear, historyCalMonth);
    renderHistoryMonthGrid(historyCalYear, historyCalMonth, grid);
  };

  prevBtn.addEventListener("click", () => {
    shiftHistoryMonth(-1);
    updateCalendar();
  });
  nextBtn.addEventListener("click", () => {
    shiftHistoryMonth(1);
    updateCalendar();
  });

  updateCalendar();
  body.appendChild(grid);
  wrap.appendChild(header);
  wrap.appendChild(body);
  return wrap;
}

function renderHistory() {
  $habitHistoryList.innerHTML = "";

  const habitsList = activeHabits();
  const historyHeader = document.createElement("div");
  historyHeader.className = "habits-history-header";
  const controls = document.createElement("div");
  controls.className = "habits-history-controls";
  const ranges = [
    { key: "week", label: "Semana" },
    { key: "month", label: "Mes" },
    { key: "year", label: "Año" },
    { key: "total", label: "Total" }
  ];
  ranges.forEach((range) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habits-history-range-btn";
    if (habitHistoryRange === range.key) btn.classList.add("is-active");
    btn.textContent = range.label;
    btn.addEventListener("click", () => {
      habitHistoryRange = range.key;
      saveHistoryRange();
      renderHistory();
    });
    controls.appendChild(btn);
  });
  const rangeLabel = document.createElement("div");
  rangeLabel.className = "habits-history-range-label";
  rangeLabel.textContent = formatHistoryRangeLabel(habitHistoryRange);
  historyHeader.appendChild(controls);
  historyHeader.appendChild(rangeLabel);
  $habitHistoryList.appendChild(historyHeader);

  const { start, end } = getHistoryRangeBounds(habitHistoryRange);
  const hasHabits = habitsList.length > 0;
  const hasData = hasHabits && hasAnyHistoryDataInRange(start, end);
  if ($habitHistoryEmpty) {
    $habitHistoryEmpty.textContent = hasHabits
      ? "No hay datos en este rango todavía."
      : "Crea un hábito para ver insights.";
    $habitHistoryEmpty.style.display = hasData ? "none" : "block";
  }

  const insights = document.createElement("div");
  insights.className = "habits-history-insights";
  insights.appendChild(buildHistoryMonthCalendar());
  if (hasHabits) insights.appendChild(renderHistoryCompareCard(habitsList));
  if (!hasData) {
    $habitHistoryList.appendChild(insights);
    return;
  }

  const trendSection = createHistorySection("Tendencia mensual");
  const trendControls = document.createElement("div");
  trendControls.className = "habits-history-section-controls";

  const metricToggle = document.createElement("div");
  metricToggle.className = "habits-history-toggle";
  ["time", "count"].forEach((metric) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habits-history-toggle-btn";
    if (habitHistoryMetric === metric) btn.classList.add("is-active");
    btn.textContent = metric === "time" ? "Tiempo" : "Cantidad";
    btn.addEventListener("click", () => {
      habitHistoryMetric = metric;
      renderHistory();
    });
    metricToggle.appendChild(btn);
  });
  const groupToggleWrap = document.createElement("div");
  groupToggleWrap.className = "habits-history-toggle";
  const groupToggleBtn = document.createElement("button");
  groupToggleBtn.type = "button";
  groupToggleBtn.className = "habits-history-toggle-btn";
  if (habitHistoryGroupMode.kind === "param") groupToggleBtn.classList.add("is-active");
  groupToggleBtn.textContent = "Agrupar por parámetro";
  groupToggleBtn.addEventListener("click", () => {
    habitHistoryGroupMode = habitHistoryGroupMode.kind === "param"
      ? { kind: "habit", cat: null }
      : { kind: "param", cat: habitHistoryGroupMode.cat };
    renderHistory();
  });
  groupToggleWrap.appendChild(groupToggleBtn);

  const categorySelect = document.createElement("select");
  categorySelect.className = "habits-history-select";
  const categories = collectCategories(habitsList);
  if (!categories.length && habitHistoryGroupMode.kind === "param") {
    habitHistoryGroupMode = { kind: "habit", cat: null };
  }
  if (habitHistoryGroupMode.kind === "param" && categories.length && !habitHistoryGroupMode.cat) {
    habitHistoryGroupMode = { kind: "param", cat: categories[0] };
  }
  if (!categories.length) {
    const opt = document.createElement("option");
    opt.textContent = "Sin parámetros";
    opt.disabled = true;
    opt.selected = true;
    categorySelect.appendChild(opt);
  } else {
    categories.forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      categorySelect.appendChild(opt);
    });
    if (habitHistoryGroupMode.kind === "param" && habitHistoryGroupMode.cat) {
      categorySelect.value = habitHistoryGroupMode.cat;
    }
  }
  groupToggleBtn.disabled = !categories.length;
  categorySelect.style.display = habitHistoryGroupMode.kind === "param" ? "" : "none";
  categorySelect.addEventListener("change", (e) => {
    const value = e.target.value || null;
    habitHistoryGroupMode = { kind: "param", cat: value };
    renderHistory();
  });

  trendControls.appendChild(metricToggle);
  trendControls.appendChild(groupToggleWrap);
  trendControls.appendChild(categorySelect);
  trendSection.header.appendChild(trendControls);

  const trendBody = document.createElement("div");
  trendBody.className = "habits-history-trend";
  const trendData = buildMonthlyTrendSeries(habitsList, habitHistoryMetric, habitHistoryGroupMode);
  if (!trendData.rows.length || !trendData.series.length) {
    const empty = document.createElement("div");
    empty.className = "habits-history-empty";
    empty.textContent = "No hay datos suficientes para mostrar tendencia.";
    trendBody.appendChild(empty);
  } else {
    const legend = document.createElement("div");
    legend.className = "habits-history-legend";
    trendData.series.forEach((series) => {
      const item = document.createElement("div");
      item.className = "habits-history-legend-item";
      const dot = document.createElement("span");
      dot.className = "habits-history-legend-dot";
      dot.style.background = series.color;
      const label = document.createElement("span");
      label.textContent = series.label;
      item.appendChild(dot);
      item.appendChild(label);
      legend.appendChild(item);
    });
    trendBody.appendChild(legend);

    trendData.rows.forEach((row) => {
      const rowEl = document.createElement("div");
      rowEl.className = "habits-history-trend-row";
      const label = document.createElement("div");
      label.className = "habits-history-trend-label";
      label.textContent = row.label;
      const bar = document.createElement("div");
      bar.className = "habits-history-trend-bar";
      const total = row.total || 0;
      trendData.series.forEach((series) => {
        const value = row.values[series.key] || 0;
        if (!value) return;
        const segment = document.createElement("div");
        segment.className = "habits-history-trend-segment";
        segment.style.background = series.color;
        const pct = total ? (value / total) * 100 : 0;
        segment.style.width = `${pct}%`;
        segment.title = `${series.label}: ${formatHistoryValue(value, habitHistoryMetric)}`;
        bar.appendChild(segment);
      });
      const totalLabel = document.createElement("div");
      totalLabel.className = "habits-history-trend-total";
      totalLabel.textContent = formatHistoryValue(total, habitHistoryMetric);
      rowEl.appendChild(label);
      rowEl.appendChild(bar);
      rowEl.appendChild(totalLabel);
      trendBody.appendChild(rowEl);
    });
  }
  trendSection.body.appendChild(trendBody);
  insights.appendChild(trendSection.section);

  const weekSection = createHistorySection("Semana vs Semana");
  const weekBody = document.createElement("div");
  weekBody.className = "habits-history-week-compare";
  const weekComparison = buildWeekComparison(habitsList, habitHistoryMetric);

  const weekSummary = document.createElement("div");
  weekSummary.className = "habits-history-week-summary";
  weekSummary.innerHTML = `
    <div>
      <div class="habits-history-kpi-label">Semana actual</div>
      <div class="habits-history-kpi-value">${formatHistoryValue(weekComparison.currentTotal, habitHistoryMetric)}</div>
    </div>
    <div>
      <div class="habits-history-kpi-label">Semana anterior</div>
      <div class="habits-history-kpi-value">${formatHistoryValue(weekComparison.previousTotal, habitHistoryMetric)}</div>
    </div>
    <div>
      <div class="habits-history-kpi-label">Delta</div>
      <div class="habits-history-kpi-value ${weekComparison.delta > 0 ? "is-up" : (weekComparison.delta < 0 ? "is-down" : "")}">
        ${weekComparison.delta >= 0 ? "+" : ""}${formatHistoryValue(Math.abs(weekComparison.delta), habitHistoryMetric)}
        <span class="habits-history-kpi-sub">${weekComparison.deltaPercentLabel}</span>
      </div>
    </div>
  `;
  weekBody.appendChild(weekSummary);

  const weekMoves = document.createElement("div");
  weekMoves.className = "habits-history-week-moves";
  weekMoves.appendChild(buildWeekMoveList("Suben", weekComparison.topUp, habitHistoryMetric));
  weekMoves.appendChild(buildWeekMoveList("Bajan", weekComparison.topDown, habitHistoryMetric));
  weekBody.appendChild(weekMoves);
  weekSection.body.appendChild(weekBody);
  insights.appendChild(weekSection.section);

  const topDaysSection = createHistorySection("Top días");
  const topDaysBody = document.createElement("div");
  topDaysBody.className = "habits-history-top-days";
  const topDays = buildTopDays(habitsList, start, end, habitHistoryMetric);
  if (!topDays.length) {
    const empty = document.createElement("div");
    empty.className = "habits-history-empty";
    empty.textContent = "No hay días con actividad en este rango.";
    topDaysBody.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "habits-history-list";
    topDays.forEach((item) => {
      const row = document.createElement("div");
      row.className = "habits-history-list-row";
      const label = document.createElement("div");
      label.className = "habits-history-list-title";
      label.textContent = formatShortDate(item.dateKey, true);
      const meta = document.createElement("div");
      meta.className = "habits-history-list-meta";
      if (item.topHabits.length) {
        const topNames = item.topHabits.map((h) => `${h.habit.name} ${formatHistoryValue(h.value, habitHistoryMetric)}`).join(" · ");
        meta.textContent = topNames;
      } else {
        meta.textContent = "—";
      }
      const value = document.createElement("div");
      value.className = "habits-history-list-value";
      value.textContent = formatHistoryValue(item.total, habitHistoryMetric);
      const left = document.createElement("div");
      left.appendChild(label);
      left.appendChild(meta);
      row.appendChild(left);
      row.appendChild(value);
      list.appendChild(row);
    });
    topDaysBody.appendChild(list);
  }
  topDaysSection.body.appendChild(topDaysBody);
  insights.appendChild(topDaysSection.section);

  const distributionSection = createHistorySection("Distribución");
  const distributionBody = document.createElement("div");
  distributionBody.className = "habits-history-distribution";
  const distribution = buildWeekdayDistribution(habitsList, start, end, habitHistoryMetric);
  if (!distribution.total) {
    const empty = document.createElement("div");
    empty.className = "habits-history-empty";
    empty.textContent = "No hay datos para distribuir.";
    distributionBody.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "habits-history-list";
    distribution.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "habits-history-list-row";
      const label = document.createElement("div");
      label.className = "habits-history-list-title";
      label.textContent = item.label;
      const meta = document.createElement("div");
      meta.className = "habits-history-list-meta";
      meta.textContent = `${item.percent}%`;
      const value = document.createElement("div");
      value.className = "habits-history-list-value";
      value.textContent = formatHistoryValue(item.total, habitHistoryMetric);
      const left = document.createElement("div");
      left.appendChild(label);
      left.appendChild(meta);
      row.appendChild(left);
      row.appendChild(value);
      list.appendChild(row);
    });
    distributionBody.appendChild(list);
  }
  distributionSection.body.appendChild(distributionBody);
  insights.appendChild(distributionSection.section);

  const budgetSection = createHistorySection("Presupuestos");
  const budgetBody = document.createElement("div");
  budgetBody.className = "habits-history-budget";
  const closeBudgetEdits = (keepEl = null) => {
    budgetBody
      .querySelectorAll(".habits-history-budget-item.is-open, .habits-history-budget-add.is-open")
      .forEach((el) => {
        if (el !== keepEl) el.classList.remove("is-open");
      });
  };

  const budgetedHabits = habitsList.filter((habit) => habit?.budget && Number(habit.budget.value) > 0);
  const completedCount = budgetedHabits.filter((habit) => isHabitBudgetCompleted(habit)).length;
  const summary = document.createElement("div");
  summary.className = "habits-history-budget-summary";
  summary.textContent = `Objetivos completados: ${completedCount}/${budgetedHabits.length || 0}`;
  budgetBody.appendChild(summary);

  const unbudgeted = habitsList.filter((habit) => !habit?.budget);
  if (unbudgeted.length) {
    const addRow = document.createElement("div");
    addRow.className = "habits-history-budget-add";
    const addTitle = document.createElement("button");
    addTitle.type = "button";
    addTitle.className = "habits-history-budget-title";
    addTitle.textContent = "Añadir presupuesto";
    addTitle.addEventListener("click", () => {
      const next = !addRow.classList.contains("is-open");
      closeBudgetEdits(next ? addRow : null);
      addRow.classList.toggle("is-open", next);
    });
    const addControls = document.createElement("div");
    addControls.className = "habits-history-budget-controls";
    const habitSelect = document.createElement("select");
    habitSelect.className = "habits-history-select";
    unbudgeted.forEach((habit) => {
      const opt = document.createElement("option");
      opt.value = habit.id;
      opt.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
      habitSelect.appendChild(opt);
    });
    const periodSelect = buildBudgetSelect(["day", "week", "month"], "week");
    const metricSelect = buildBudgetSelect(["time", "count"], "time");
    const valueInput = document.createElement("input");
    valueInput.type = "number";
    valueInput.min = "1";
    valueInput.inputMode = "numeric";
    valueInput.value = "60";
    valueInput.className = "habits-history-input";
    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "habits-history-action-btn";
    addBtn.textContent = "Crear";
    addBtn.addEventListener("click", () => {
      const habit = habits[habitSelect.value];
      if (!habit) return;
      const value = Number(valueInput.value);
      if (!Number.isFinite(value) || value <= 0) return;
      habit.budget = {
        period: periodSelect.value || "week",
        metric: metricSelect.value || "time",
        value
      };
      saveCache();
      persistHabit(habit);
      renderHistory();
    });
    addControls.appendChild(habitSelect);
    addControls.appendChild(periodSelect);
    addControls.appendChild(metricSelect);
    addControls.appendChild(valueInput);
    addControls.appendChild(addBtn);
    const addEditWrap = document.createElement("div");
    addEditWrap.className = "habits-history-budget-edit";
    addEditWrap.appendChild(addControls);
    addRow.appendChild(addTitle);
    addRow.appendChild(addEditWrap);
    budgetBody.appendChild(addRow);
  }

  if (!budgetedHabits.length) {
    const empty = document.createElement("div");
    empty.className = "habits-history-empty";
    empty.textContent = "No hay presupuestos todavía.";
    budgetBody.appendChild(empty);
  } else {
    const list = document.createElement("div");
    list.className = "habits-history-budget-list";
    budgetedHabits.forEach((habit) => {
      const item = document.createElement("div");
      item.className = "habits-history-budget-item";
      setHabitColorVars(item, habit);
      const title = document.createElement("button");
      title.type = "button";
      title.className = "habits-history-budget-title";
      title.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
      title.addEventListener("click", () => {
        const next = !item.classList.contains("is-open");
        closeBudgetEdits(next ? item : null);
        item.classList.toggle("is-open", next);
      });
      const controls = document.createElement("div");
      controls.className = "habits-history-budget-controls";
      const periodSelect = buildBudgetSelect(["day", "week", "month"], habit.budget?.period || "week");
      const metricSelect = buildBudgetSelect(["time", "count"], habit.budget?.metric || "time");
      const valueInput = document.createElement("input");
      valueInput.type = "number";
      valueInput.min = "1";
      valueInput.inputMode = "numeric";
      valueInput.value = String(habit.budget?.value || 0);
      valueInput.className = "habits-history-input";
      const saveBtn = document.createElement("button");
      saveBtn.type = "button";
      saveBtn.className = "habits-history-action-btn";
      saveBtn.textContent = "Guardar";
      saveBtn.addEventListener("click", () => {
        const value = Number(valueInput.value);
        if (!Number.isFinite(value) || value <= 0) return;
        habit.budget = {
          period: periodSelect.value || "week",
          metric: metricSelect.value || "time",
          value
        };
        saveCache();
        persistHabit(habit);
        renderHistory();
      });
      controls.appendChild(periodSelect);
      controls.appendChild(metricSelect);
      controls.appendChild(valueInput);
      controls.appendChild(saveBtn);
      const editWrap = document.createElement("div");
      editWrap.className = "habits-history-budget-edit";
      editWrap.appendChild(controls);

      const progress = document.createElement("div");
      progress.className = "habits-history-budget-progress";
      const progressData = buildBudgetProgress(habit);
      const progressLabel = document.createElement("div");
      progressLabel.className = "habits-history-budget-progress-label";
      progressLabel.textContent = `${formatHistoryValue(progressData.value, progressData.metric)}/${formatHistoryValue(progressData.target, progressData.metric)} (${progressData.percent}%) · ${progressData.periodLabel}`;
      const bar = document.createElement("div");
      bar.className = "habits-history-budget-bar";
      const fill = document.createElement("div");
      fill.className = "habits-history-budget-bar-fill";
      fill.style.width = `${Math.min(100, progressData.percent)}%`;
      bar.appendChild(fill);
      progress.appendChild(progressLabel);
      progress.appendChild(bar);

      item.appendChild(title);
      item.appendChild(editWrap);
      item.appendChild(progress);
      list.appendChild(item);
    });
    budgetBody.appendChild(list);
  }
  budgetSection.body.appendChild(budgetBody);
  insights.appendChild(budgetSection.section);

  const statsSection = renderHistoryStatsCard(habitsList);
  insights.appendChild(statsSection);

  const sectionMap = {
    trend: trendSection.section,
    week: weekSection.section,
    topDays: topDaysSection.section,
    distribution: distributionSection.section,
    budget: budgetSection.section,
    stats: statsSection,
  };

  const order = ["trend", "budget", "stats"];
  Object.values(sectionMap).forEach((el) => el.remove());
  order.forEach((k) => insights.appendChild(sectionMap[k]));

  $habitHistoryList.appendChild(insights);
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

function buildLinearPath(points) {
  if (!points.length) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  const coords = points.map((p) => `${p.x} ${p.y}`);
  return `M ${coords.join(" L ")}`;
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
  const active = activeHabitsWithSystem()
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
    const clampedValue = Math.max(0, p.minutes);
    const y = padding + (1 - (clampedValue / maxScale || 0)) * usableHeight;
    return { ...p, x, y, minutes: clampedValue };
  });

  const defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
  const filter = document.createElementNS("http://www.w3.org/2000/svg", "filter");
  filter.setAttribute("id", "habit-line-glow");
  filter.innerHTML = `<feDropShadow dx="0" dy="8" stdDeviation="8" flood-color="${lineColor}" flood-opacity="0.25" />`;
  defs.appendChild(filter);
  svg.appendChild(defs);

  const smoothPath = buildLinearPath(plotPoints);

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
  if (habitLineRange !== "total" && plotPoints.length > 1) {
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
  }

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
    case "total": {
      const firstRecordTs = resolveFirstRecordTs({
        habitSessions,
        habitChecks,
        habitCounts,
        nowTs: Date.now()
      });
      return { start: new Date(firstRecordTs), end: new Date() };
    }
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
function appendTimeQuickControls(tools, habit, today) {
  // Columna a la derecha del 🔥 (no se solapa)
  const col = document.createElement("div");
  col.className = "habit-quick-col";
  col.style.display = "flex";
  col.style.flexDirection = "column";
  col.style.gap = "2px";
  col.style.alignItems = "stretch";
  col.style.minWidth = "90px";   // ajusta si quieres
  col.style.maxWidth = "90px";

  // 1) Botones predefinidos (stack)
  const qas = Array.isArray(habit.quickAdds) ? habit.quickAdds : [];
  qas.slice(0, 2).forEach((qa, idx) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habit-quick-add habit-time-btn";
    btn.style.width = "100%";
    btn.textContent = qa.label || `+${qa.minutes} min`;
    btn.title = "Añadir tiempo";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = Math.round(Number(qa.minutes) || 0);
      if (m > 0) {
        if (isWorkHabit(habit)) {
          const inferredShift = normalizeShiftValue((qa.label || "").trim().toUpperCase()) || (idx === 0 ? "M" : "T");
          const fixedMinutes = 480;
          debugWorkShift("[WORK] click", { dateKey: today, shift: inferredShift });
          debugHabitsSync("quick shift click", { habitId: habit.id, dateKey: today, shift: inferredShift, fixedMinutes });
          setHabitTimeSec(habit.id, today, fixedMinutes * 60, { shift: inferredShift });
        } else {
          addHabitTimeSec(habit.id, today, m * 60);
        }
      }
      renderHabitsPreservingTodayUI();
    });
    col.appendChild(btn);
  });

  // 2) Input + botón “＋” en una fila (pero dentro de la columna)
  const inline = document.createElement("div");
  if (isWorkHabit(habit)) {
    tools.appendChild(col);
    return;
  }
  inline.className = "habit-quick-inline";
  inline.style.display = "flex";
  inline.style.gap = "1px";
  inline.style.alignItems = "center";

  const inp = document.createElement("input");
  inp.type = "time";
  inp.step = "60";
  inp.min = "00:00";
  inp.placeholder = "00:12";
  inp.className = "habit-quick-input";
  inp.style.flex = "1";
  inp.addEventListener("click", (e) => e.stopPropagation());
  bindTimeInputDefault(inp);

  const go = document.createElement("button");
  go.type = "button";
  go.className = "habit-quick-go habit-time-btn";
  go.textContent = "＋";
  go.title = "Sumar minutos";
  go.style.flex = "0 0 auto";
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    const minutes = parseTimeToMinutes(inp.value);
    if (minutes <= 0) return;
    addHabitTimeSec(habit.id, today, minutes * 60);
    inp.value = "00:00";
    renderHabitsPreservingTodayUI();
  });

  inp.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      go.click();
    }
  });

  inline.appendChild(inp);
  inline.appendChild(go);
  col.appendChild(inline);

  tools.appendChild(col);
}

function renderGlobalHeatmap() {
  if (!$habitGlobalHeatmap) return;
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
      cell.classList.add(`heat-level-${level}`);
      if (level > 0) activeDays += 1;
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
  renderCountsList();
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
  if (!habit || habit.archived) return 0;
  const byDate = habitSessions?.[habit.id];
  if (!byDate || typeof byDate !== "object") return 0;

  const startTs = new Date(start.getFullYear(), start.getMonth(), start.getDate(), 0, 0, 0, 0).getTime();
  const endTs = new Date(end.getFullYear(), end.getMonth(), end.getDate(), 23, 59, 59, 999).getTime();
  const detailed = Array.isArray(habitSessionTimeline?.[habit.id]) ? habitSessionTimeline[habit.id] : [];
  const coverage = habitSessionTimelineCoverage?.[habit.id] || new Set();

  detailed.forEach((session) => {
    const bounds = parseSessionBounds(session);
    if (!bounds) return;
    const clippedStart = Math.max(bounds.startTs, startTs);
    const clippedEnd = Math.min(bounds.endTs, endTs);
    if (clippedEnd <= clippedStart) return;
    const split = splitSessionByDay(clippedStart, clippedEnd);
    split.forEach((mins) => {
      totalMinutes += mins;
    });
  });

  // Fallback legacy: mantener comportamiento previo para días sin timestamps reales.
  Object.keys(byDate).forEach((dateKey) => {
    if (coverage.has(dateKey)) return;
    const parsed = parseDateKey(dateKey);
    if (parsed && isDateInRange(parsed, start, end)) {
      totalMinutes += Math.round(getHabitTotalSecForDate(habit.id, dateKey) / 60);
    }
  });

  return totalMinutes;
}

function countsForHabitRange(habit, start, end) {
  let total = 0;
  if (!habit || habit.archived) return 0;
  const byDate = habitCounts?.[habit.id];
  if (!byDate || typeof byDate !== "object") return 0;
  Object.entries(byDate).forEach(([dateKey, count]) => {
    const parsed = parseDateKey(dateKey);
    if (parsed && isDateInRange(parsed, start, end)) {
      total += Number(count) || 0;
    }
  });
  return total;
}


function collectHabitActiveDates(habit, start, end) {
  const dates = new Set();
  if (!habit || habit.archived) return 0;

  const checks = habitChecks[habit.id] || {};
  Object.keys(checks).forEach((key) => {
    const parsed = parseDateKey(key);
    if (parsed && isDateInRange(parsed, start, end)) dates.add(key);
  });

  const counts = habitCounts[habit.id] || {};
  Object.keys(counts).forEach((key) => {
    const parsed = parseDateKey(key);
    if (parsed && isDateInRange(parsed, start, end) && Number(counts[key]) > 0) dates.add(key);
  });

  const byDate = habitSessions?.[habit.id];
  if (byDate && typeof byDate === "object") {
    Object.keys(byDate).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && getHabitTotalSecForDate(habit.id, key) > 0) dates.add(key);
    });
  }

  return dates.size;
}


function minutesForRange(range) {
  const { start, end } = getRangeBounds(range);
  let total = 0;
  activeHabits().forEach((habit) => {
    total += minutesForHabitRange(habit, start, end);
  });
  return total;
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

  Object.entries(habitCounts).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && Number(entries[key]) > 0) dates.add(key);
    });
  });

  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.keys(byDate).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && getHabitTotalSecForDate(habit.id, key) > 0) dates.add(key);
    });
  });

  return dates.size;
}

function countActiveDaysTotal() {
  const dates = new Set();

  Object.entries(habitChecks).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => dates.add(key));
  });

  Object.entries(habitCounts).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      if (Number(entries[key]) > 0) dates.add(key);
    });
  });

  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.keys(byDate).forEach((key) => {
      if (getHabitTotalSecForDate(habitId, key) > 0) dates.add(key);
    });
  });

  return dates.size;
}

function computeTotalStreakInRange(start, end) {
  let best = 0;
  let current = 0;
  for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
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

function computeCurrentStreakInRange(start, end) {
  let streak = 0;
  for (let date = new Date(end); date >= start; date = addDays(date, -1)) {
    const key = dateKeyLocal(date);
    const scheduledAny = activeHabits().some((h) => isHabitScheduledForDate(h, date));
    if (!scheduledAny) continue;
    const doneAny = activeHabits().some((h) => isHabitCompletedOnDate(h, key));
    if (doneAny) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}


function getEarliestActivityDate() {
  const firstRecordTs = resolveFirstRecordTs({
    habitSessions,
    habitChecks,
    habitCounts,
    nowTs: Date.now()
  });
  return new Date(firstRecordTs);
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
  const habitsList = activeHabitsWithSystem();
  const habitsUserList = activeHabits();
  for (let d = new Date(start); d <= cappedEnd; d = addDays(d, 1)) {
    const key = dateKeyLocal(d);
    const date = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (habitId === "total") {
      const perHabit = habitsList.map((habit) => {
        const minutes = getSessionsForHabitDate(habit.id, key).reduce((acc, s) => acc + minutesFromSession(s), 0);
        return { habit, minutes };
      }).filter((item) => item.minutes > 0).sort((a, b) => b.minutes - a.minutes);
      const minutes = perHabit.reduce((acc, item) => acc + item.minutes, 0);
      const hasActivity = habitsUserList.some((h) => getHabitDayScore(h, key).hasActivity);
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
  const entries = buildTimeEntries(range, "timeShareByHabit");
  return aggregateEntries(entries, "habit")
    .map((item) => ({
      habit: item.habit,
      minutes: Math.round(item.totalSec / 60)
    }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function buildTimeEntries(range, reason = "recompute") {
  const { start, end } = getRangeBounds(range);
  const dataset = computeTimeByHabitDataset({
    habitsById: habits,
    habitSessions,
    rangeStart: start,
    rangeEnd: end,
    unknownHabitId: UNKNOWN_HABIT_ID,
    unknownHabitName: UNKNOWN_HABIT_NAME,
    unknownHabitEmoji: UNKNOWN_HABIT_EMOJI,
    unknownHabitColor: UNKNOWN_HABIT_COLOR,
    daySec: DAY_SEC
  });
  if (DEBUG_COMPARE) {
    const key = String(range || "today");
    const nextKeys = dataset.map((item) => item?.habit?.id || item?.habitId || "unknown").filter(Boolean).sort();
    const prevKeys = reportDebugLastByRange.get(key) || [];
    const changed = [];
    const maxLen = Math.max(prevKeys.length, nextKeys.length);
    for (let i = 0; i < maxLen; i += 1) {
      if (prevKeys[i] !== nextKeys[i]) {
        if (prevKeys[i]) changed.push(`-${prevKeys[i]}`);
        if (nextKeys[i]) changed.push(`+${nextKeys[i]}`);
      }
    }
    reportDebugLastByRange.set(key, nextKeys);
    debugReport("recompute", {
      reason,
      range: key,
      lastUpdateTs: habitHistoryUpdatedAt,
      keysChanged: changed.slice(0, 20),
      dataVersion: habitHistoryDataVersion
    });
  }
  return dataset;
}

function aggregateEntries(entries, mode = "habit") {
  const buckets = new Map();
  const totalSec = entries.reduce((acc, item) => acc + (item.totalSec || 0), 0);
  entries.forEach((entry) => {
    const habit = entry.habit;
    const sec = Number(entry.totalSec) || 0;
    if (sec <= 0) return;
    const key = habit?.id || "unknown";
    if (!buckets.has(key)) {
      buckets.set(key, { key, label: habit?.name || UNKNOWN_HABIT_NAME, totalSec: 0, count: 0, habit });
    }
    const bucket = buckets.get(key);
    bucket.totalSec += sec;
    bucket.count += 1;
  });
  const list = Array.from(buckets.values())
    .map((item) => ({
      ...item,
      percent: totalSec ? (item.totalSec / totalSec) * 100 : 0
    }))
    .sort((a, b) => b.totalSec - a.totalSec);
  return list;
}

function aggregateForCategory(entries, catName) {
  return buildParamDonutModel(entries, habits, catName).slices;
}

function buildGroupedHabitDonutModel(entries, catName) {
  const buckets = new Map();

  entries.forEach((entry) => {
    const habit = entry.habit || habits?.[entry.habitId];
    const sec = Number(entry.totalSec) || 0;
    if (!habit || sec <= 0) return;
    const value = resolveHabitCategoryValue(habit, catName);
    if (!value) return;
    if (!buckets.has(value)) {
      buckets.set(value, { value, totalSec: 0, habits: [] });
    }
    const bucket = buckets.get(value);
    bucket.totalSec += sec;
    bucket.habits.push({
      habit,
      habitId: habit.id || "unknown",
      label: habit?.name || UNKNOWN_HABIT_NAME,
      totalSec: sec
    });
  });

  const totalSec = Array.from(buckets.values()).reduce((acc, item) => acc + (item.totalSec || 0), 0);
  const valuesOrder = collectValuesForCategory(activeHabits(), catName);
  const orderedValues = valuesOrder.filter((value) => buckets.has(value));
  Array.from(buckets.keys()).forEach((value) => {
    if (!orderedValues.includes(value)) orderedValues.push(value);
  });
  const mixedIndex = orderedValues.indexOf("mixto");
  if (mixedIndex !== -1) {
    orderedValues.splice(mixedIndex, 1);
    orderedValues.push("mixto");
  }

  const habits = [];
  const groups = [];
  orderedValues.forEach((value) => {
    const bucket = buckets.get(value);
    if (!bucket) return;
    bucket.habits.sort((a, b) => b.totalSec - a.totalSec);
    habits.push(...bucket.habits);
    groups.push({ value, totalSec: bucket.totalSec });
  });

  return { totalSec, habits, groups };
}

function buildParamDonutModel(entries, habitsById, catName) {
  const target = normalizeParamKey(catName);
  const buckets = new Map();

  entries.forEach((entry) => {
    const habit = entry.habit || habitsById?.[entry.habitId];
    const sec = Number(entry.totalSec) || 0;
    if (!habit || sec <= 0) return;
    const values = new Set(
      getHabitParams(habit)
        .map(parseParam)
        .filter((parsed) => parsed && parsed.cat === target)
        .map((parsed) => parsed.val)
    );
    if (!values.size) return;
    // Regla A: si hay varios valores para la misma categoría, el tiempo va a "mixto".
    const valueList = values.size > 1 ? ["mixto"] : Array.from(values);
    valueList.forEach((val) => {
      if (!buckets.has(val)) {
        buckets.set(val, { value: val, totalSec: 0, habits: new Map() });
      }
      const bucket = buckets.get(val);
      bucket.totalSec += sec;
      const habitId = habit?.id || "unknown";
      const habitEntry = bucket.habits.get(habitId) || {
        habitId,
        habitName: habit?.name || UNKNOWN_HABIT_NAME,
        sec: 0
      };
      habitEntry.sec += sec;
      bucket.habits.set(habitId, habitEntry);
    });
  });

  const totalSec = Array.from(buckets.values()).reduce((acc, item) => acc + (item.totalSec || 0), 0);
  const slices = Array.from(buckets.values())
    .map((item) => ({
      label: item.value,
      totalSec: item.totalSec,
      percent: totalSec ? (item.totalSec / totalSec) * 100 : 0
    }))
    .sort((a, b) => b.totalSec - a.totalSec);
  const groups = slices.map((slice) => {
    const bucket = buckets.get(slice.label);
    const habitsList = Array.from(bucket?.habits?.values() || [])
      .sort((a, b) => b.sec - a.sec)
      .map((habitItem) => ({
        habitId: habitItem.habitId,
        habitName: habitItem.habitName,
        sec: habitItem.sec,
        percentWithinValue: bucket?.totalSec ? (habitItem.sec / bucket.totalSec) * 100 : 0
      }));
    return {
      value: slice.label,
      totalSec: bucket?.totalSec || 0,
      percent: slice.percent,
      habits: habitsList
    };
  });
  return { slices, groups };
}

function renderDonutGroupOptions() {
  if (!$habitDonutGroup) return;
  const categories = collectCategories(activeHabits());
  const current = habitDonutGroupMode.kind === "cat"
    ? habitDonutGroupMode.cat
    : null;
  const hasCurrent = current && categories.includes(current);
  if (habitDonutGroupMode.kind === "cat" && !hasCurrent) {
    habitDonutGroupMode = { kind: "habit" };
  }
  $habitDonutGroup.innerHTML = "";
  const habitOption = document.createElement("option");
  habitOption.value = "habit";
  habitOption.textContent = "Hábitos";
  $habitDonutGroup.appendChild(habitOption);
  categories.forEach((cat) => {
    const option = document.createElement("option");
    option.value = `cat:${cat}`;
    option.textContent = cat;
    $habitDonutGroup.appendChild(option);
  });
  if (habitDonutGroupMode.kind === "cat" && hasCurrent) {
    $habitDonutGroup.value = `cat:${habitDonutGroupMode.cat}`;
  } else {
    $habitDonutGroup.value = "habit";
  }
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

function rangeLabelTitle(range) {
  switch (range) {
    case "week":
      return "Semana";
    case "month":
      return "Mes";
    case "year":
      return "Año";
    case "total":
      return "Total";
    default:
      return "Día";
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
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function countForHabitRangeV2(habit, start, end) {
  const startKey = dateKeyLocal(start);
  const endKey = dateKeyLocal(end);
  const store = habitCounts[habit.id] || {};
  let total = 0;
  Object.keys(store).forEach((key) => {
    if (key >= startKey && key <= endKey) total += Number(store[key]) || 0;
  });
  return total;
}

function countsByHabit(range) {
  const { start, end } = getRangeBounds(range);
  return activeHabits()
    .filter((h) => (h.goal || "check") === "count")
    .map((habit) => {
      const count = countForHabitRangeV2(habit, start, end);
      const daysActive = collectHabitActiveDates(habit, start, end);
      const streak = computeHabitCurrentStreak(habit);
      return { habit, count, daysActive, streak, value: count };
    })
    .filter((item) => item.count > 0 || item.daysActive > 0)
    .sort((a, b) => b.count - a.count);
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
  if (type === "count") {
    const totalCount = items.reduce((acc, item) => acc + (item.value || item.count || 0), 0);
    el.textContent = `${items.length} hábito${items.length !== 1 ? "s" : ""} · ${totalCount}×`;
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
      <button type="button" class="habit-emoji habit-icon" aria-label="Editar hábito">${item.habit.emoji || "🏷️"}</button>
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
    attachHabitIconEditHandler(div, item.habit);
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
      <button type="button" class="habit-emoji habit-icon" aria-label="Editar hábito">${item.habit.emoji || "🏷️"}</button>
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
    attachHabitIconEditHandler(div, item.habit);
    $habitTotalsList.appendChild(div);
  });
}


function renderCountsList() {
  if (!$habitCountsList || !$habitAccCounts) return;
  const data = countsByHabit(habitDonutRange);

  // Mostrar/ocultar acordeón si no hay contadores
  if (!data.length) {
    $habitAccCounts.style.display = "none";
    $habitCountsList.innerHTML = "";
    return;
  }
  $habitAccCounts.style.display = "";
  updateAccordionMeta($habitAccCountsMeta, data, "count");

  $habitCountsList.innerHTML = "";
  data.forEach((item) => {
    const div = document.createElement("div");
    div.className = "habit-ranking-item habit-count-item";
    setHabitColorVars(div, item.habit);

    const left = document.createElement("div");
    left.className = "habit-ranking-left";
    left.innerHTML = `
      <button type="button" class="habit-emoji habit-icon" aria-label="Editar hábito">${item.habit.emoji || "🏷️"}</button>
      <div>
        <div class="habit-name">${item.habit.name}</div>
        <div class="habit-meta-row">
          <div class="habit-meta">${item.daysActive} día${item.daysActive === 1 ? "" : "s"} · 🔥 ${item.streak}</div>
        </div>
      </div>
    `;

    const right = document.createElement("div");
    right.className = "habit-ranking-right";
    right.innerHTML = `<div class="habit-total-value">${item.count}×</div>`;
    right.appendChild(createHabitActions(item.habit));

    div.appendChild(left);
    div.appendChild(right);
    attachHabitIconEditHandler(div, item.habit);
    $habitCountsList.appendChild(div);
  });
}

function buildDonutOuterRuns(habitData, catName, groupColorByKey = new Map()) {
  const runs = [];
  let current = null;
  habitData.forEach((item) => {
    const value = Math.round(item.totalSec / 60);
    if (value <= 0) return;
    const key = resolveHabitCategoryValue(item.habit, catName);
    if (current && current.key === key) {
      current.value += value;
      return;
    }
    if (current) runs.push(current);
    current = { key, value };
  });
  if (current) runs.push(current);
  return runs.map((run) => {
    const normalizedKey = normalizeDonutGroupKey(run.key);
    const color = run.key
      ? groupColorByKey.get(normalizedKey) || "rgba(255,255,255,0.35)"
      : "transparent";
    const borderWidth = run.key ? 6 : 0;
    const shadowBlur = run.key ? 14 : 0;
    return {
      name: run.key || "",
      value: run.value,
      itemStyle: {
        color: "rgba(0,0,0,0)",
        borderWidth,
        borderColor: color,
        shadowBlur,
        shadowColor: color,
        borderJoin: "round"
      },
      emphasis: { disabled: true }
    };
  });
}


function renderDonut() {
  if (!$habitDonut || typeof echarts === "undefined") return;
  const entries = buildTimeEntries(habitDonutRange);
  const isGrouped = habitDonutGroupMode.kind === "cat" && habitDonutGroupMode.cat;
  const paramModel = isGrouped
    ? buildParamDonutModel(entries, habits, habitDonutGroupMode.cat)
    : null;
  const groupedModel = isGrouped
    ? buildGroupedHabitDonutModel(entries, habitDonutGroupMode.cat)
    : null;
  const data = isGrouped ? groupedModel.habits : aggregateEntries(entries, "habit");
  const totalSec = isGrouped
    ? groupedModel.totalSec
    : data.reduce((acc, item) => acc + item.totalSec, 0);
  const totalMinutes = Math.round(totalSec / 60);
  const subtitle = `Distribución ${rangeLabel(habitDonutRange)}`;
  if ($habitDonutSub) $habitDonutSub.textContent = subtitle.charAt(0).toUpperCase() + subtitle.slice(1);
  if ($habitDonutTitle) {
    $habitDonutTitle.textContent = habitDonutGroupMode.kind === "cat"
      ? `Tiempo por ${habitDonutGroupMode.cat}`
      : "Tiempo por hábito";
  }

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

  const baseSeriesData = data.map((item, idx) => ({
    name: item.label,
    value: Math.round(item.totalSec / 60),
    itemStyle: {
      color: resolveSeriesColor(item, idx)
    }
  }));
  const startAngle = 90;
  const clockwise = true;
  const padAngle = 0;
  const innerRadius = isGrouped ? ["58%", "74%"] : ["60%", "82%"];
  const groupColorByKey = new Map();
  if (isGrouped && paramModel?.slices?.length) {
    paramModel.slices.forEach((group, idx) => {
      const normalized = normalizeDonutGroupKey(group.label || group.value);
      if (!normalized) return;
      if (!groupColorByKey.has(normalized)) {
        const color = PARAM_COLOR_PALETTE[idx % PARAM_COLOR_PALETTE.length];
        groupColorByKey.set(normalized, color);
      }
    });
  }

  const option = {
    tooltip: { trigger: "item", formatter: "{b}: {c}m ({d}%)" },
    series: [
      {
        type: "pie",
        radius: innerRadius,
        startAngle,
        clockwise,
        padAngle,
        roseType: false,
        itemStyle: { borderWidth: 2, borderColor: "rgba(0,0,0,0.2)" },
        label: { show: false },
        data: baseSeriesData
      }
    ]
  };
  if (isGrouped) {
    const outerData = buildDonutOuterRuns(data, habitDonutGroupMode.cat, groupColorByKey);
    option.series.push({
      type: "pie",
      radius: ["74%", "82%"],
      startAngle,
      clockwise,
      padAngle,
      roseType: false,
      silent: true,
      tooltip: { show: false },
      label: { show: false },
      labelLine: { show: false },
      emphasis: { disabled: true },
      data: outerData
    });
  }
  habitDonutChart.setOption(option);
  habitDonutChart.resize();
  const legendData = paramModel?.slices || data;
  const legendGroups = paramModel?.groups || null;
  renderDonutLegend(legendData, totalSec, legendGroups, groupColorByKey);
}

function renderDonutLegend(data, totalSec, groups = null, groupColorByKey = null) {
  if (!$habitDonutLegend) return;
  $habitDonutLegend.innerHTML = "";
  const hasGroups = Array.isArray(groups) && groups.length > 0;
  $habitDonutLegend.classList.toggle("param-groups", hasGroups);

  if (hasGroups) {
    groups.forEach((group, idx) => {
      const groupWrap = document.createElement("div");
      groupWrap.className = "param-group";
      groupWrap.dataset.value = group.value;
      const colorKey = normalizeDonutGroupKey(group.value);
      const color = groupColorByKey?.get(colorKey) || "rgba(255,255,255,0.35)";
      groupWrap.style.setProperty("--hclr", color);
      groupWrap.style.setProperty("--hclr-rgb", hexToRgbString(color));
      groupWrap.style.setProperty("--group-color", color);
      groupWrap.style.setProperty("--group-color-rgb", hexToRgbString(color));

      const head = document.createElement("div");
      head.className = "param-group-head";
      head.innerHTML = `
<span class="legend-dot">${idx + 1}º</span>
        <div class="legend-text">
          <div class="legend-name">${group.value}</div>
          <div class="legend-meta">${group.percent.toFixed(2)}% · ${formatMinutes(Math.round(group.totalSec / 60))}</div>
        </div>
      `;

      const body = document.createElement("div");
      body.className = "param-group-body";
      group.habits.forEach((habitItem) => {
        const row = document.createElement("div");
        row.className = "param-habit-row param-habit-glow";
        row.dataset.habitId = habitItem.habitId;
        row.innerHTML = `
          <div class="habit-name">${habitItem.habitName}</div>
          <div class="legend-meta">${formatMinutes(Math.round(habitItem.sec / 60))} · ${habitItem.percentWithinValue.toFixed(2)}%</div>
        `;
        const habitTarget = habits?.[habitItem.habitId];
        if (habitTarget) {
          row.setAttribute("role", "button");
          row.setAttribute("tabindex", "0");
          row.addEventListener("click", () => openHabitModal(habitTarget));
          row.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              openHabitModal(habitTarget);
            }
          });
        }
        body.appendChild(row);
      });

      groupWrap.appendChild(head);
      groupWrap.appendChild(body);
      $habitDonutLegend.appendChild(groupWrap);
    });
    return;
  }

data.forEach((item, idx) => {
  const row = document.createElement("div");
  row.className = "habit-donut-legend-item";
  setSeriesColorVars(row, item, idx);

  const pct = totalSec ? (item.totalSec / totalSec) * 100 : 0;

  row.innerHTML = `
    <span class="legend-dot">${idx + 1}º</span>
    <div class="legend-text">
      <div class="legend-name">${item.label}</div>
      <div class="legend-meta">
        ${pct.toFixed(2)}% · ${formatMinutes(Math.round(item.totalSec / 60))}
      </div>
    </div>
  `;

  document.querySelector(".habit-donut-legend").appendChild(row);
});

}

function renderKPIs() {
  const today = todayKey();
  const { start, end } = getRangeBounds(habitDonutRange);
  const isDayRange = habitDonutRange === "day";
  const todayCount = countCompletedHabitsForDate(today);
  const rangeCount = isDayRange ? todayCount : countCompletedHabitsForRange(start, end);
  if ($habitKpiTodayLabel) {
    $habitKpiTodayLabel.textContent = isDayRange ? "Hechos hoy" : "Hechos (rango)";
  }
  if ($habitKpiToday) {
    if (isDayRange) {
      $habitKpiToday.classList.remove("is-stacked");
      $habitKpiToday.textContent = todayCount;
    } else {
      $habitKpiToday.classList.add("is-stacked");
      $habitKpiToday.innerHTML = `
        <span class="habit-kpi-value-line is-primary">Hoy: ${todayCount}</span>
        <span class="habit-kpi-value-line-rango">Total: ${rangeCount}</span>
      `;
    }
  }
  if ($habitKpiTotalHours) {
    $habitKpiTotalHours.textContent = formatHoursTotal(minutesForRange(habitDonutRange));
  }
  if ($habitKpiTotalHoursRange) {
    $habitKpiTotalHoursRange.textContent = `Rango ${rangeLabelTitle(habitDonutRange)}`;
  }
  if ($habitKpiActiveDaysTotal) {
    $habitKpiActiveDaysTotal.textContent = habitDonutRange === "total"
      ? countActiveDaysTotal()
      : countActiveDaysInRange(start, end);
  }
  if ($habitKpiActiveDaysLabel) {
    $habitKpiActiveDaysLabel.textContent = habitDonutRange === "total"
      ? "Días  total"
      : "Días contabilizados (rango)";
  }
  if ($habitKpiStreakTotal) {
    if (habitDonutRange === "total") {
      const current = computeTotalCurrentStreak();
      const best = computeTotalStreak(365).best;
      $habitKpiStreakTotal.textContent = current;
      if ($habitKpiStreakTotalSub) {
        $habitKpiStreakTotalSub.textContent = best ? `Mejor: ${best}` : "—";
      }
      if ($habitKpiStreakLabel) $habitKpiStreakLabel.textContent = "Racha total";
    } else {
      const bestRange = computeTotalStreakInRange(start, end).best;
      const currentRange = computeCurrentStreakInRange(start, end);
      $habitKpiStreakTotal.textContent = bestRange;
      if ($habitKpiStreakTotalSub) {
        $habitKpiStreakTotalSub.textContent = currentRange ? `Actual: ${currentRange}` : "—";
      }
      if ($habitKpiStreakLabel) $habitKpiStreakLabel.textContent = "Racha (rango)";
    }
  }
}

function renderPins() {
  const countHabits = activeHabits().filter((habit) => (habit.goal || "check") === "count");
  const timeHabits = activeHabits().filter((habit) => (habit.goal || "check") === "time");
  const fillSelect = (select, list, currentId) => {
    if (!select) return;
    select.innerHTML = "";
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "Sin pin";
    select.appendChild(none);
    list.forEach((habit) => {
      const opt = document.createElement("option");
      opt.value = habit.id;
      opt.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
      select.appendChild(opt);
    });
    select.value = currentId && list.some((h) => h.id === currentId) ? currentId : "";
  };

  fillSelect($habitPinCountSelect, countHabits, habitPrefs?.pinCount);
  fillSelect($habitPinTimeSelect, timeHabits, habitPrefs?.pinTime);

  const dateKey = todayKey();
  const { start, end } = getRangeBounds(habitDonutRange);

  const countHabit = habitPrefs?.pinCount ? habits?.[habitPrefs.pinCount] : null;
  if (countHabit && (countHabit.goal || "check") === "count") {
    const todayValue = getHabitCount(countHabit.id, dateKey);
    const rangeValue = countsForHabitRange(countHabit, start, end);
    if (habitDonutRange === "day") {
      if ($habitPinCountToday) $habitPinCountToday.textContent = `Hoy: ${todayValue}`;
      if ($habitPinCountRange) {
        $habitPinCountRange.textContent = ` ${rangeValue} · ${rangeLabelTitle(habitDonutRange)}`;
      }
    } else {
      if ($habitPinCountToday) {
        $habitPinCountToday.textContent = ` ${rangeValue} · ${rangeLabelTitle(habitDonutRange)}`;
      }
      if ($habitPinCountRange) $habitPinCountRange.textContent = `Hoy: ${todayValue}`;
    }
  } else {
    if ($habitPinCountToday) $habitPinCountToday.textContent = "—";
    if ($habitPinCountRange) $habitPinCountRange.textContent = "Selecciona un contador";
  }

  const timeHabit = habitPrefs?.pinTime ? habits?.[habitPrefs.pinTime] : null;
  if (timeHabit && (timeHabit.goal || "check") === "time") {
    const todayMinutes = getHabitDayScore(timeHabit, dateKey).minutes || 0;
    const rangeMinutes = minutesForHabitRange(timeHabit, start, end);
    if (habitDonutRange === "day") {
      if ($habitPinTimeToday) $habitPinTimeToday.textContent = `Hoy: ${formatMinutes(todayMinutes)}`;
      if ($habitPinTimeRange) {
        $habitPinTimeRange.textContent = ` ${formatMinutes(rangeMinutes)} · ${rangeLabelTitle(habitDonutRange)}`;
      }
    } else {
      if ($habitPinTimeToday) {
        $habitPinTimeToday.textContent = ` ${formatMinutes(rangeMinutes)} · ${rangeLabelTitle(habitDonutRange)}`;
      }
      if ($habitPinTimeRange) $habitPinTimeRange.textContent = `Hoy: ${formatMinutes(todayMinutes)}`;
    }
  } else {
    if ($habitPinTimeToday) $habitPinTimeToday.textContent = "—";
    if ($habitPinTimeRange) $habitPinTimeRange.textContent = "Selecciona un hábito de tiempo";
  }
}

function renderQuickSessions() {
  if (!$habitQuickSessionsWrap) return;
  const timeHabits = activeHabits().filter((habit) => (habit.goal || "check") === "time");
  const sortedTimeHabits = [...timeHabits].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  const timeHabitIds = new Set(sortedTimeHabits.map((habit) => habit.id));
  const originalIds = Array.isArray(habitPrefs?.quickSessions)
    ? habitPrefs.quickSessions.filter((id) => typeof id === "string")
    : [];

  const normalizedIds = [];
  const seen = new Set();
  originalIds.forEach((id) => {
    if (!timeHabitIds.has(id) || seen.has(id)) return;
    seen.add(id);
    normalizedIds.push(id);
  });

  const normalizedChanged = normalizedIds.length !== originalIds.length
    || normalizedIds.some((id, index) => id !== originalIds[index]);

  if (normalizedChanged) {
    habitPrefs = { ...habitPrefs, quickSessions: normalizedIds };
    persistHabitPrefs();
  }

  if ($habitQuickSessionsSelect) {
    $habitQuickSessionsSelect.innerHTML = "";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Selecciona hábito…";
    $habitQuickSessionsSelect.appendChild(placeholder);
    sortedTimeHabits.forEach((habit) => {
      const opt = document.createElement("option");
      opt.value = habit.id;
      opt.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
      $habitQuickSessionsSelect.appendChild(opt);
    });
    $habitQuickSessionsSelect.value = "";
    $habitQuickSessionsSelect.disabled = sortedTimeHabits.length === 0;
  }

  if ($habitQuickSessionsAdd) {
    $habitQuickSessionsAdd.disabled = sortedTimeHabits.length === 0;
  }

  if ($habitQuickSessionsRow) {
    $habitQuickSessionsRow.innerHTML = "";
    normalizedIds.forEach((id) => {
      const habit = habits?.[id];
      if (!habit) return;
      const pill = document.createElement("button");
      pill.type = "button";
      pill.className = "habit-quick-pill";
      setHabitColorVars(pill, habit);
      const label = document.createElement("span");
      label.className = "habit-quick-pill-label";
      label.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "habit-quick-pill-remove";
      remove.textContent = "✕";
      remove.addEventListener("click", (event) => {
        event.stopPropagation();
        habitPrefs = { ...habitPrefs, quickSessions: normalizedIds.filter((item) => item !== habit.id) };
        persistHabitPrefs();
        renderQuickSessions();
      });
      pill.appendChild(label);
      pill.appendChild(remove);
      pill.addEventListener("click", () => {
        if (runningSession) {
          showHabitToast("Ya hay una sesión en curso");
          return;
        }
        startSession(habit.id);
        showHabitToast(`▶︎ Sesión: ${habit.name || "—"}`);
      });
      $habitQuickSessionsRow.appendChild(pill);
    });
  }

  const totalPills = normalizedIds.length;
  if ($habitQuickSessionsMeta) {
    $habitQuickSessionsMeta.textContent = totalPills ? String(totalPills) : "—";
  }
  if ($habitQuickSessionsPreview) {
    $habitQuickSessionsPreview.textContent = totalPills
      ? `${totalPills} fijada${totalPills === 1 ? "" : "s"}`
      : "Toca para añadir";
  }
  if ($habitQuickSessionsEmpty) {
    $habitQuickSessionsEmpty.style.display = (!totalPills && !sortedTimeHabits.length) ? "block" : "none";
  }
}

function renderQuickCounters() {
  if (!$quickCountersGrid || !$quickCountersBody) return;

  $quickCountersGrid.innerHTML = "";

  const counterMap = new Map(
    activeHabits()
      .filter((habit) => habit.type === "counter" || (habit.goal || "check") === "count")
      .map((habit) => [habit.id, habit])
  );

  const sourceIds = Array.isArray(habitUI?.quickCounters) ? habitUI.quickCounters : [];
  const quickIds = [];
  const seen = new Set();
  sourceIds.forEach((id) => {
    if (!counterMap.has(id) || seen.has(id)) return;
    seen.add(id);
    quickIds.push(id);
  });

  if (quickIds.length !== sourceIds.length || quickIds.some((id, index) => id !== sourceIds[index])) {
    habitUI = { ...habitUI, quickCounters: quickIds };
    saveUI({ quickCounters: quickIds });
  }

  if ($quickCounterCount) {
    $quickCounterCount.textContent = `(${quickIds.length} fijado${quickIds.length === 1 ? "" : "s"})`;
  }

  quickIds.forEach((id) => {
    const habit = counterMap.get(id);
    if (!habit) return;
    const btn = document.createElement("div");
    btn.className = "quick-counter-btn";

    btn.style.background = `
      radial-gradient(circle at top,
        color-mix(in srgb, ${habit.color || DEFAULT_COLOR} 35%, transparent),
        rgba(255,255,255,0.02)
      )
    `;

    btn.innerHTML = `
      <div class="quick-counter-emoji">${habit.emoji || "🏷️"}</div>
      <div class="quick-counter-name">${habit.name || "Contador"}</div>
    `;

    btn.onclick = () => incrementCounterHabit(habit.id);

    $quickCountersGrid.appendChild(btn);
  });

  if (!quickIds.length) {
    $quickCountersBody.classList.remove("open");
    $quickCountersWrap?.classList.remove("is-open");
  }
}

function toggleQuickCounters() {
  if (!$quickCountersBody) return;
  $quickCountersBody.classList.toggle("open");
  $quickCountersWrap?.classList.toggle("is-open", $quickCountersBody.classList.contains("open"));
}
window.toggleQuickCounters = toggleQuickCounters;

function incrementCounterHabit(habitId) {
  if (!habitId) return;

  const habit = habits[habitId];
  if (!habit || habit.archived) return;

  const dateKey = todayKey();
  const current = getHabitCount(habitId, dateKey);
  const next = current + 1;

  if (!habitCounts[habitId]) habitCounts[habitId] = {};
  habitCounts[habitId][dateKey] = next;
  saveCache();

  const per = Math.round(Number(habit.countUnitMinutes) || 0);
  if ((habit.goal || "check") === "count" && per > 0) {
    const curTotal = getHabitTotalSecForDate(habitId, dateKey);
    const prevSec = Math.round(current * per * 60);
    const baseSec = Math.max(0, curTotal - prevSec);
    const nextSec = baseSec + Math.round(next * per * 60);
    setHabitTimeSec(habitId, dateKey, nextSec);
  }

  invalidateDominantCache(dateKey);
  renderHabitsPreservingTodayUI();

  const path = `${HABIT_COUNTS_PATH}/${habitId}/${dateKey}`;
  runTransaction(ref(db, path), (val) => {
    const n = Number(val);
    const base = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
    return base + 1;
  }).catch((err) => {
    console.warn("No se pudo incrementar contador", err);
  });

  globalThis.playClickSound?.();
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

function computeTotalCurrentStreak(maxDays = 365) {
  const today = new Date();
  let streak = 0;
  for (let i = 0; i < maxDays; i++) {
    const date = addDays(today, -i);
    const key = dateKeyLocal(date);
    const scheduledAny = activeHabits().some((h) => isHabitScheduledForDate(h, date));
    if (!scheduledAny) continue;
    const doneAny = activeHabits().some((h) => isHabitCompletedOnDate(h, key));
    if (doneAny) {
      streak += 1;
    } else {
      break;
    }
  }
  return streak;
}

function computeSuccessStatsForRange(range) {
  let { start, end } = getRangeBounds(range);
  if (range === "total") {
    const earliest = getEarliestActivityDate();
    if (earliest) start = earliest;
  }
  let scheduled = 0;
  let completed = 0;
  for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
    const key = dateKeyLocal(date);
    activeHabits().forEach((habit) => {
      if (isHabitScheduledForDate(habit, date)) {
        scheduled += 1;
        if (isHabitCompletedOnDate(habit, key)) completed += 1;
      }
    });
  }
  const successRatePct = scheduled ? Math.round((completed / scheduled) * 100) : 0;
  return { scheduled, completed, successRatePct, start, end };
}


function computeWorkShiftStats(range) {
  const { start, end } = getDaysRangeBounds(range);
  const work = activeHabits().find((h) => isWorkHabit(h));
  const counters = { morning: 0, evening: 0, free: 0, unknown: 0 };
  if (!work) return counters;
  for (let date = new Date(start); date <= end; date = addDays(date, 1)) {
    const key = dateKeyLocal(date);
    const entry = readDayMinutesAndShift(habitSessions?.[work.id]?.[key], true);
    if (!entry.hasEntry) counters.free += 1;
    else if (entry.shift === "M") counters.morning += 1;
    else if (entry.shift === "T") counters.evening += 1;
    else counters.unknown += 1;
  }
  return counters;
}

function renderWorkShiftReport() {
  const morning = document.getElementById("habit-shifts-morning");
  const evening = document.getElementById("habit-shifts-evening");
  const free = document.getElementById("habit-shifts-free");
  const unknown = document.getElementById("habit-shifts-unknown");
  const meta = document.getElementById("habit-shifts-range-meta");
  if (!morning || !evening || !free) return;
  const range = habitDonutRange === "day" ? "week" : habitDonutRange;
  const stats = computeWorkShiftStats(range);
  morning.textContent = String(stats.morning);
  evening.textContent = String(stats.evening);
  free.textContent = String(stats.free);
  if (unknown) unknown.textContent = String(stats.unknown);
  if (meta) meta.textContent = `Rango ${rangeLabelTitle(range)}`;
}

function renderRecordsCard() {
  if (!$habitRecordsCurrentStreak) return;
  const stats = computeSuccessStatsForRange(habitRecordsRange);
  const bestStreak = computeTotalStreakInRange(stats.start, stats.end).best;
  const currentStreak = computeTotalCurrentStreak();
  if ($habitRecordsSub) $habitRecordsSub.textContent = rangeLabelTitle(habitRecordsRange);
  $habitRecordsCurrentStreak.textContent = currentStreak;
  $habitRecordsBestStreak.textContent = bestStreak;
  $habitRecordsCompleted.textContent = stats.completed;
  if ($habitRecordsCompletedSub) {
    $habitRecordsCompletedSub.textContent = stats.scheduled ? `${stats.completed}/${stats.scheduled}` : "—";
  }
  $habitRecordsSuccess.textContent = `${stats.successRatePct}%`;
}

function getTodayPanelScrollContainer(panel) {
  if (!panel) return document.scrollingElement;
  const candidates = Array.from(panel.querySelectorAll("*"));
  const scrollable = candidates.find((el) => el.scrollHeight > el.clientHeight);
  return scrollable || document.scrollingElement;
}

function captureTodayUIState() {
  const panel = document.querySelector('.habits-panel[data-panel="today"]');
  const openIds = panel
    ? Array.from(panel.querySelectorAll("details[open]")).map((detail) => detail.id || detail.dataset.groupId || "").filter(Boolean)
    : [];
  const scrollContainer = getTodayPanelScrollContainer(panel);
  const scrollTop = scrollContainer ? scrollContainer.scrollTop : null;
  return { openIds, scrollTop };
}

function restoreTodayUIState(state) {
  if (!state) return;
  const panel = document.querySelector('.habits-panel[data-panel="today"]');
  if (panel) {
    state.openIds.forEach((id) => {
      const safeId = (window.CSS && CSS.escape) ? CSS.escape(id) : id;
      const byId = panel.querySelector(`#${safeId}`);
      const byGroup = panel.querySelector(`[data-group-id="${safeId}"]`);
      const detail = byId || byGroup;
      if (detail) detail.open = true;
    });
  }
  const scrollContainer = getTodayPanelScrollContainer(panel);
  if (scrollContainer && state.scrollTop != null) {
    scrollContainer.scrollTop = state.scrollTop;
  }
}

function renderHabitsPreservingTodayUI() {
  const state = captureTodayUIState();
  renderHabits();
  restoreTodayUIState(state);
}

function renderHabitsPreservingUI() {
  const getActivePanel = () =>
    document.querySelector(`.habits-panel[data-panel="${activeTab}"]`)
    || document.querySelector(".habits-panel.is-active");
  const panel = getActivePanel();
  const openIds = panel
    ? Array.from(panel.querySelectorAll("details[open]"))
      .map((detail) => detail.id)
      .filter(Boolean)
    : [];
  const scrollTop = panel ? panel.scrollTop : null;
  renderHabits();
  const nextPanel = getActivePanel();
  if (nextPanel) {
    openIds.forEach((id) => {
      const selector = (window.CSS && CSS.escape) ? `#${CSS.escape(id)}` : `#${id}`;
      const detail = nextPanel.querySelector(selector);
      if (detail) detail.open = true;
    });
    if (scrollTop != null) nextPanel.scrollTop = scrollTop;
  }
}

function invalidateHabitRenderCaches() {
  // dayTotalsCache/renderedSnapshots pueden existir en builds previos o flags de depuración.
  if (window.dayTotalsCache && typeof window.dayTotalsCache.clear === "function") window.dayTotalsCache.clear();
  if (window.renderedSnapshots && typeof window.renderedSnapshots.clear === "function") window.renderedSnapshots.clear();
}

function renderHabits() {
  renderSubtabs();
  renderToday();
  renderWeek();
  renderHistory();
  renderSchedule("manual");
  renderKPIs();
  renderPins();
  renderRecordsCard();
  renderDonutGroupOptions();
  renderDonut();
  renderWorkShiftReport();
  renderLineChart();
  renderGlobalHeatmap();
  renderRanking();
  renderDaysAccordion();
  updateSessionUI();
  updateCompareLiveInterval();
  if (habitDetailId && $habitDetailOverlay && !$habitDetailOverlay.classList.contains("hidden")) {
    renderHabitDetail(habitDetailId, habitDetailRange);
  }
}

function handleHabitSubmit(e) {
  e.preventDefault();
  const payload = gatherHabitPayload();
  if (!payload) return;
  habits[payload.id] = payload;
  saveCache();
  persistHabit(payload);
  if (payload.goal === "count") {
    setQuickCounterPinned(payload.id, !!$habitQuickCounterPinned?.checked);
  } else {
    setQuickCounterPinned(payload.id, false);
  }
  closeHabitModal();
  renderHabits();
}

function deleteHabit() {
  const id = $habitId.value;
  if (!id) return;
  openDeleteConfirm(id);
}

// Cronómetro
function startSession(habitId = null, meta = null) {
  if (runningSession) return;

  const targetHabitId = (typeof habitId === "string" && habits?.[habitId] && !habits[habitId]?.archived)
    ? habitId
    : null;

  runningSession = {
    startTs: Date.now(),
    targetHabitId,
    meta: meta && typeof meta === "object" ? { ...meta } : null
  };
  saveRunningSession();
  updateSessionUI();
  updateCompareLiveInterval();
  scheduleCompareRefresh("session:start", { targetHabitId: targetHabitId || null });
  sessionInterval = setInterval(updateSessionUI, 1000);
}

function getRunningHabitSession() {
  return runningSession ? { ...runningSession } : null;
}

function startHabitSessionUniversal(habitId, meta = null) {
  return startSession(habitId, meta);
}

function stopHabitSessionUniversal() {
  return stopSession(null, true);
}

function stopSession(assignHabitId = null, silent = false) {
  // si viene como handler de click, el primer arg será un Event
  if (assignHabitId && typeof assignHabitId === "object" && assignHabitId.type) {
    assignHabitId = null;
    silent = false;
  }

  if (!runningSession) return;

  const duration = Math.max(1, Math.round((Date.now() - runningSession.startTs) / 1000));
  const target = (typeof assignHabitId === "string" && assignHabitId)
    ? assignHabitId
    : (runningSession?.targetHabitId || null);

  const startTs = runningSession.startTs;
  const endTs = Date.now();
  const dateKey = dateKeyLocal(new Date(startTs));

  pendingSessionDuration = duration;
  runningSession = null;
  saveRunningSession();
  if (sessionInterval) clearInterval(sessionInterval);
  updateSessionUI();
  updateCompareLiveInterval();
  scheduleCompareRefresh("session:stop", { dateKey, durationSec: duration });

  // Auto-asignación (Shortcuts / enlace)
  if (target && habits?.[target] && !habits[target]?.archived) {
    const splitByDay = splitSessionByDay(startTs, endTs);
    const splitSummary = {};
    if (splitByDay.size > 1) {
      splitByDay.forEach((minutes, day) => {
        splitSummary[day] = Math.round(minutes);
      });
      console.log("[HABIT] split across days", splitSummary);
    }
    splitByDay.forEach((minutes, day) => {
      const sec = Math.max(0, Math.round(minutes * 60));
      if (sec > 0) addHabitTimeSec(target, day, sec, { startTs, endTs });
    });
    const savedPayload = { targetHabitId: target, startTs, endTs, durationSec: duration, splitByDay: splitSummary };
    console.warn("[STOP] saved session", savedPayload);
    console.log("[HABIT] session stop", { startTs, endTs, splitByDay: splitSummary });
    localStorage.setItem(LAST_HABIT_KEY, target);
    pendingSessionDuration = 0;
    invalidateHabitRenderCaches();
    if (!silent) showHabitToast(`Asignado: ${habits[target]?.name || "hábito"} · ${Math.round(duration / 60)}m`);
    closeSessionModal?.();
    renderHabits();
    return;
  }

  // flujo normal: abrir selector
  openSessionModal();
}

function ensureSessionOverlayInBody() {
  if ($habitOverlay && $habitOverlay.parentElement !== document.body) {
    document.body.appendChild($habitOverlay);
  }
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
  updateScheduleLiveInterval();
}

function formatTimer(sec) {
  const m = Math.floor(sec / 60).toString().padStart(2, "0");
  const s = Math.floor(sec % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

function updateSessionModalViewportPadding() {
  if (!$habitSessionModal || !$habitSessionScroll) return;
  if ($habitSessionModal.classList.contains("hidden")) return;
  const viewport = window.visualViewport;
  const viewportHeight = viewport?.height || window.innerHeight;
  const keyboardOffset = Math.max(0, window.innerHeight - viewportHeight);
  const basePadding = 16;
  const padding = keyboardOffset ? keyboardOffset + basePadding : basePadding;
  $habitSessionScroll.style.paddingBottom = `${padding}px`;
  if ($habitSessionSheet) {
    $habitSessionSheet.style.paddingBottom = keyboardOffset ? `${keyboardOffset}px` : "";
  }
}

function resetSessionModalViewportPadding() {
  if ($habitSessionScroll) $habitSessionScroll.style.paddingBottom = "";
  if ($habitSessionSheet) $habitSessionSheet.style.paddingBottom = "";
}

function handleSessionModalFocus(event) {
  const target = event.target;
  if (!target || !(target instanceof HTMLElement)) return;
  if (!["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName)) return;
  updateSessionModalViewportPadding();
  target.scrollIntoView({ block: "center", behavior: "smooth" });
}

function openSessionModal() {
  renderSessionList();
  $habitSessionModal.classList.remove("hidden");
  $habitSessionSearch.value = "";
  $habitSessionSearch.focus();
  updateSessionModalViewportPadding();
}

function closeSessionModal() {
  $habitSessionModal.classList.add("hidden");
  pendingSessionDuration = 0;
  resetSessionModalViewportPadding();
}

function renderSessionList() {
  $habitSessionList.innerHTML = "";
  const habitsList = activeHabits();
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
  const endTs = Date.now();
  const startTs = endTs - pendingSessionDuration * 1000;
  const splitByDay = splitSessionByDay(startTs, endTs);
  const splitSummary = {};
  splitByDay.forEach((minutes, day) => {
    splitSummary[day] = Math.round(minutes);
    const sec = Math.max(0, Math.round(minutes * 60));
    if (sec > 0) addHabitTimeSec(habitId, day, sec, { startTs, endTs });
  });
  const savedPayload = { targetHabitId: habitId, startTs, endTs, durationSec: pendingSessionDuration, splitByDay: splitSummary };
  console.warn("[STOP] saved session", savedPayload);
  console.log("[HABIT] session stop", { startTs, endTs, splitByDay: splitSummary });
  if (splitByDay.size > 1) console.log("[HABIT] split across days", splitSummary);

  localStorage.setItem(LAST_HABIT_KEY, habitId);
  pendingSessionDuration = 0;
  invalidateHabitRenderCaches();
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
  const minutes = parseTimeToMinutes($habitManualMinutes.value);
  const dateKey = $habitManualDate.value || todayKey();
  if (!habitId || minutes <= 0) return;

  addHabitTimeSec(habitId, dateKey, minutes * 60);
  localStorage.setItem(LAST_HABIT_KEY, habitId);

  closeManualTimeModal();
  renderHabits();
}

function populateEntryHabitSelect(selectedHabitId) {
  if (!$habitEntryHabit) return;
  $habitEntryHabit.innerHTML = "";
  const list = activeHabits().sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  list.forEach((habit) => {
    const opt = document.createElement("option");
    opt.value = habit.id;
    opt.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
    $habitEntryHabit.appendChild(opt);
  });
  if (selectedHabitId && habits[selectedHabitId]) {
    $habitEntryHabit.value = selectedHabitId;
  } else if (list.length) {
    $habitEntryHabit.value = list[0].id;
  }
}

function openEntryModal(habitId, dateKey = todayKey()) {
  if (!$habitEntryModal) return;
  populateEntryHabitSelect(habitId);
  if ($habitEntryDate) $habitEntryDate.value = dateKey || todayKey();
  refreshEntryModal();
  $habitEntryModal.classList.remove("hidden");
}

function closeEntryModal() {
  $habitEntryModal?.classList.add("hidden");
}

function refreshEntryModal() {
  if (!$habitEntryModal || !$habitEntryHabit || !$habitEntryDate) return;
  const habitId = $habitEntryHabit.value;
  const habit = habits[habitId];
  const dateKey = $habitEntryDate.value || todayKey();
  const goal = habit?.goal || "check";

  if ($habitEntryCheckWrap) $habitEntryCheckWrap.style.display = goal === "count" ? "none" : "block";
  if ($habitEntryCountWrap) $habitEntryCountWrap.style.display = goal === "count" ? "block" : "none";

  if ($habitEntryCheck) {
    $habitEntryCheck.checked = !!(habitChecks?.[habitId]?.[dateKey]);
  }

  if ($habitEntryCount) {
    $habitEntryCount.value = String(getHabitCount(habitId, dateKey) || 0);
  }

  renderEntrySessions(habitId, dateKey);
}


function renderEntrySessions(habitId, dateKey) {
  if (!$habitEntrySessions) return;
  $habitEntrySessions.innerHTML = "";

  const totalSec = getHabitTotalSecForDate(habitId, dateKey);
  const minutes = Math.round(totalSec / 60);

  if (!minutes) {
    const empty = document.createElement("div");
    empty.className = "empty-state small";
    empty.textContent = "No hay tiempo registrado este día.";
    $habitEntrySessions.appendChild(empty);
    return;
  }

  const row = document.createElement("div");
  row.className = "habit-entry-session-row";

  const label = document.createElement("div");
  label.className = "habit-entry-session-label";
  label.textContent = `${formatShortDate(dateKey)} · total`;

  const minutesInput = document.createElement("input");
  minutesInput.type = "number";
  minutesInput.min = "1";
  minutesInput.inputMode = "numeric";
  minutesInput.value = String(minutes);
  minutesInput.className = "habit-entry-minutes";

  const saveBtn = document.createElement("button");
  saveBtn.type = "button";
  saveBtn.className = "icon-btn";
  saveBtn.textContent = "✓";
  saveBtn.title = "Guardar minutos del día";
  saveBtn.addEventListener("click", () => {
    const n = Number(minutesInput.value);
    if (!Number.isFinite(n) || n <= 0) return;
    setHabitTimeSec(habitId, dateKey, Math.round(n * 60));
    refreshEntryModal();
    renderHabits();
  });

  const delBtn = document.createElement("button");
  delBtn.type = "button";
  delBtn.className = "icon-btn";
  delBtn.textContent = "🗑";
  delBtn.title = "Borrar tiempo del día";
  delBtn.addEventListener("click", () => {
    setHabitTimeSec(habitId, dateKey, 0);
    refreshEntryModal();
    renderHabits();
  });

  row.appendChild(label);
  row.appendChild(minutesInput);
  row.appendChild(saveBtn);
  row.appendChild(delBtn);
  $habitEntrySessions.appendChild(row);
}

function openDayDetailModal(dateKey = todayKey(), focusHabitId = null) {
  if (!$habitDayDetailModal) return;
  dayDetailDateKey = dateKey || todayKey();
  dayDetailFocusHabitId = focusHabitId || null;
  if ($habitDayDetailTitle) $habitDayDetailTitle.textContent = "Detalle del día";
  if ($habitDayDetailDate) $habitDayDetailDate.textContent = formatShortDate(dayDetailDateKey, true);
  renderDayDetailModal();
  $habitDayDetailModal.classList.remove("hidden");
}

function closeDayDetailModal() {
  $habitDayDetailModal?.classList.add("hidden");
}

function computeDayDetailBreakdown(dateKey, list) {
  const rows = [];
  let totalTimeMinutes = 0;
  list.forEach((habit) => {
    const goal = habit.goal || "check";
    if (goal === "time") {
      const minutes = Math.round(getHabitTotalSecForDate(habit.id, dateKey) / 60);
      if (minutes > 0) {
        totalTimeMinutes += minutes;
        rows.push({ habit, kind: "time", minutes, valueLabel: formatMinutes(minutes), weight: minutes });
      }
      return;
    }
    if (goal === "count") {
      const count = Math.max(0, Number(getHabitCount(habit.id, dateKey) || 0));
      if (count > 0) rows.push({ habit, kind: "count", valueLabel: `${count}`, weight: count * 10 });
      return;
    }
    const checked = !!(habitChecks?.[habit.id]?.[dateKey]);
    if (checked) rows.push({ habit, kind: "check", valueLabel: "✔", weight: 5 });
  });
  rows.sort((a, b) => b.weight - a.weight);
  return { rows, totalTimeMinutes };
}

function buildDayDetailDonut(dateKey, list) {
  const card = document.createElement("section");
  card.className = "habit-day-detail-card";
  const title = document.createElement("div");
  title.className = "sheet-section-title";
  title.textContent = "Distribución diaria";
  card.appendChild(title);

  const { rows, totalTimeMinutes } = computeDayDetailBreakdown(dateKey, list);
  const timeRows = rows.filter((row) => row.kind === "time");
  const total = timeRows.reduce((acc, row) => acc + row.minutes, 0);

  const donutWrap = document.createElement("div");
  donutWrap.className = "habit-day-detail-donut-wrap";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 120 120");
  svg.classList.add("habit-day-detail-donut");
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const bg = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  bg.setAttribute("cx", "60");
  bg.setAttribute("cy", "60");
  bg.setAttribute("r", String(radius));
  bg.setAttribute("fill", "none");
  bg.setAttribute("stroke", "rgba(255,255,255,.12)");
  bg.setAttribute("stroke-width", "16");
  svg.appendChild(bg);

  let offset = 0;
  timeRows.forEach((row) => {
    const pct = total > 0 ? row.minutes / total : 0;
    const slice = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    slice.setAttribute("cx", "60");
    slice.setAttribute("cy", "60");
    slice.setAttribute("r", String(radius));
    slice.setAttribute("fill", "none");
    slice.setAttribute("stroke", row.habit.color || "#8e86ff");
    slice.setAttribute("stroke-width", "16");
    slice.setAttribute("stroke-dasharray", `${Math.max(0, pct * circumference)} ${circumference}`);
    slice.setAttribute("stroke-dashoffset", String(-offset));
    slice.setAttribute("transform", "rotate(-90 60 60)");
    offset += pct * circumference;
    svg.appendChild(slice);
  });

  const center = document.createElement("div");
  center.className = "habit-day-detail-donut-center";
  center.innerHTML = `<strong>${totalTimeMinutes ? formatMinutes(totalTimeMinutes) : "Total"}</strong><span>${formatShortDate(dateKey, true)}</span>`;
  donutWrap.appendChild(svg);
  donutWrap.appendChild(center);
  card.appendChild(donutWrap);

  const rank = document.createElement("div");
  rank.className = "habit-day-detail-ranking";
  if (!rows.length) {
    rank.innerHTML = '<div class="empty-state small">Sin actividad registrada.</div>';
  } else {
    const maxRows = 5;
    rows.slice(0, maxRows).forEach((row, idx) => {
      const item = document.createElement("div");
      item.className = "habit-day-detail-rank-item";
      item.innerHTML = `<span class="rank-order">${idx + 1}º</span><span class="rank-name">${row.habit.emoji || "🏷️"} ${row.habit.name}</span><span class="rank-value">${row.valueLabel}</span>`;
      rank.appendChild(item);
    });
    if (rows.length > maxRows) {
      const extra = document.createElement("div");
      extra.className = "habit-day-detail-rank-item";
      extra.innerHTML = `<span class="rank-order">·</span><span class="rank-name">Otros</span><span class="rank-value">${rows.length - maxRows}</span>`;
      rank.appendChild(extra);
    }
  }
  card.appendChild(rank);
  return card;
}

function buildDayDetailEditAccordion(list) {
  const details = document.createElement("details");
  details.className = "habit-day-detail-edit-wrap";
  const summary = document.createElement("summary");
  summary.textContent = "Editar registros";
  details.appendChild(summary);
  const body = document.createElement("div");
  body.className = "habit-day-detail-edit-body";

  list.forEach((habit) => {
    const row = document.createElement("div");
    row.className = "habit-day-detail-edit-row";
    const label = document.createElement("div");
    label.className = "habit-entry-session-label";
    label.textContent = `${habit.emoji || "🏷️"} ${habit.name}`;
    row.appendChild(label);
    const goal = habit.goal || "check";

    if (goal === "time") {
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "icon-btn";
      minus.textContent = "−";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.className = "habit-entry-minutes";
      input.value = String(Math.round(getHabitTotalSecForDate(habit.id, dayDetailDateKey) / 60) || 0);
      input.dataset.habitId = habit.id;
      input.dataset.kind = "time";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "icon-btn";
      plus.textContent = "+";
      minus.addEventListener("click", () => {
        input.value = String(Math.max(0, Number(input.value || 0) - 15));
      });
      plus.addEventListener("click", () => {
        input.value = String(Math.max(0, Number(input.value || 0) + 15));
      });
      row.appendChild(minus);
      row.appendChild(input);
      row.appendChild(plus);
      if (isWorkHabit(habit)) {
        const shift = document.createElement("select");
        shift.className = "habits-history-select";
        shift.dataset.habitId = habit.id;
        shift.dataset.kind = "shift";
        const currentShift = normalizeShiftValue(readDayMinutesAndShift(habitSessions?.[habit.id]?.[dayDetailDateKey], true).shift) || "";
        shift.innerHTML = '<option value="">Sin shift</option><option value="M">M</option><option value="T">T</option>';
        shift.value = currentShift;
        row.appendChild(shift);
      }
    } else if (goal === "count") {
      const minus = document.createElement("button");
      minus.type = "button";
      minus.className = "icon-btn";
      minus.textContent = "−";
      const input = document.createElement("input");
      input.type = "number";
      input.min = "0";
      input.className = "habit-entry-minutes";
      input.value = String(getHabitCount(habit.id, dayDetailDateKey) || 0);
      input.dataset.habitId = habit.id;
      input.dataset.kind = "count";
      const plus = document.createElement("button");
      plus.type = "button";
      plus.className = "icon-btn";
      plus.textContent = "+";
      minus.addEventListener("click", () => {
        input.value = String(Math.max(0, Number(input.value || 0) - 1));
      });
      plus.addEventListener("click", () => {
        input.value = String(Math.max(0, Number(input.value || 0) + 1));
      });
      row.appendChild(minus);
      row.appendChild(input);
      row.appendChild(plus);
    } else {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!(habitChecks?.[habit.id]?.[dayDetailDateKey]);
      check.dataset.habitId = habit.id;
      check.dataset.kind = "check";
      row.appendChild(check);
    }

    body.appendChild(row);
  });

  details.appendChild(body);
  return details;
}

function renderDayDetailModal() {
  if (!$habitDayDetailList) return;
  $habitDayDetailList.innerHTML = "";
  const list = activeHabits()
    .slice()
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .filter((h) => !dayDetailFocusHabitId || h.id === dayDetailFocusHabitId);
  $habitDayDetailList.appendChild(buildDayDetailDonut(dayDetailDateKey, list));
  $habitDayDetailList.appendChild(buildDayDetailEditAccordion(list));
}

function saveDayDetailModal() {
  if (!$habitDayDetailList) return;
  const rows = Array.from($habitDayDetailList.querySelectorAll("[data-habit-id]"));
  const grouped = new Map();
  rows.forEach((el) => {
    const id = el.dataset.habitId;
    if (!grouped.has(id)) grouped.set(id, []);
    grouped.get(id).push(el);
  });

  grouped.forEach((controls, habitId) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;

    const goal = habit.goal || "check";
    if (goal === "time") {
      const input = controls.find((el) => el.dataset.kind === "time");
      const shiftEl = controls.find((el) => el.dataset.kind === "shift");
      const minutes = Math.max(0, Number(input?.value || 0));
      const shift = shiftEl ? normalizeShiftValue(shiftEl.value) : null;

      const opts = shift ? { shift } : {}; // ✅ clave
      setHabitTimeSec(habitId, dayDetailDateKey, Math.round(minutes * 60), opts);
      return;
    }

    if (goal === "count") {
      const input = controls.find((el) => el.dataset.kind === "count");
      setHabitCount(habitId, dayDetailDateKey, Math.max(0, Number(input?.value || 0)));
      return;
    }

    const check = controls.find((el) => el.dataset.kind === "check");
    const checked = !!check?.checked;
    if (!habitChecks[habitId]) habitChecks[habitId] = {};
    if (checked) habitChecks[habitId][dayDetailDateKey] = true;
    else delete habitChecks[habitId][dayDetailDateKey];
    saveCache();
    persistHabitCheck(habitId, dayDetailDateKey, checked ? true : null);
    invalidateDominantCache(dayDetailDateKey);
  });

  closeDayDetailModal();
  renderHabitsPreservingTodayUI();
}



function handleEntrySubmit(e) {
  e.preventDefault();
  if (!$habitEntryHabit || !$habitEntryDate) return;
  const habitId = $habitEntryHabit.value;
  const dateKey = $habitEntryDate.value || todayKey();
  const habit = habits[habitId];
  if (!habit || habit.archived) return;

  const goal = habit.goal || "check";

  if (goal === "count") {
    const n = Number($habitEntryCount?.value || 0);
    setHabitCount(habitId, dateKey, n);
  } else {
    const checked = !!$habitEntryCheck?.checked;
    if (!habitChecks[habitId]) habitChecks[habitId] = {};
    if (checked) habitChecks[habitId][dateKey] = true;
    else delete habitChecks[habitId][dateKey];
    saveCache();
    persistHabitCheck(habitId, dateKey, checked ? true : null);
    renderHabits();
  }

  closeEntryModal();
}


// Eventos

function habitType(habit) {
  const goal = habit?.goal || "check";
  if (goal === "time") return "time";
  if (goal === "count") return "count";
  return "bool";
}

function habitDateKeys(habitId) {
  const keys = new Set();
  Object.keys(habits[habitId]?.log || {}).forEach((k) => keys.add(k));
  Object.keys(habitChecks[habitId] || {}).forEach((k) => keys.add(k));
  Object.keys(habitCounts[habitId] || {}).forEach((k) => keys.add(k));
  return Array.from(keys).sort((a, b) => a.localeCompare(b));
}

function habitDailyRow(habit, date) {
  const rawLog = habit?.log?.[date];
  const type = habitType(habit);
  const count = Number(habitCounts[habit.id]?.[date] || 0);
  const done = habitChecks[habit.id]?.[date] ? 1 : 0;
  const minutes = type === "time"
    ? Math.max(0, Math.round(typeof rawLog === "number" ? rawLog / 60 : Number(rawLog?.min || rawLog?.totalSec / 60 || 0)))
    : (type === "count" ? Math.max(0, Math.round((habit.countUnitMinutes || 0) * count)) : 0);
  const notes = typeof rawLog === "object" ? (rawLog.notes || "") : "";
  const source = typeof rawLog === "object" ? (rawLog.source || "") : "";
  return {
    date,
    habitId: habit.id,
    habitName: habit.name || "",
    type,
    minutes,
    hours: (minutes / 60).toFixed(2),
    count: type === "count" ? count : "",
    done: type === "bool" ? done : (done || minutes > 0 || count > 0 ? 1 : 0),
    notes,
    source,
    range: ""
  };
}

function exportHabitsCsvSingle() {
  const rows = Object.values(habits || {}).filter((h) => h?.id && !h.archived).flatMap((habit) => {
    return habitDateKeys(habit.id).map((date) => habitDailyRow(habit, date)).filter((row) => row.minutes || row.count || row.done);
  }).sort((a, b) => a.date.localeCompare(b.date));
  const headers = ["date", "habitId", "habitName", "type", "minutes", "hours", "count", "done", "notes", "source", "range"];
  triggerDownload(buildCsv(rows, headers), "bookshell-habits-export.csv");
}

async function exportHabitsZip() {
  const files = {};
  const summary = Object.values(habits || {}).filter((h) => h?.id && !h.archived).map((habit) => ({
    habitId: habit.id,
    habitName: habit.name || "",
    type: habitType(habit),
    emoji: habit.emoji || "",
    createdAt: habit.createdAt || ""
  }));
  files["habits__summary.csv"] = buildCsv(summary, ["habitId", "habitName", "type", "emoji", "createdAt"]);
  Object.values(habits || {}).filter((h) => h?.id && !h.archived).forEach((habit) => {
    const rows = habitDateKeys(habit.id).map((date) => habitDailyRow(habit, date)).filter((row) => row.minutes || row.count || row.done)
      .map((row) => ({ date: row.date, minutes: row.minutes, hours: row.hours, count: row.count, done: row.done, notes: row.notes }));
    const filename = `habit__${sanitizeFileToken(habit.name)}__${sanitizeFileToken(habit.id)}.csv`;
    files[filename] = buildCsv(rows, ["date", "minutes", "hours", "count", "done", "notes"]);
  });
  await downloadZip(files, "bookshell-habits-export.zip");
}

async function onHabitsExportClick() {
  const choice = prompt(
    "Exportar Hábitos:\n1) CSV único\n2) ZIP (por hábito)",
    "1"
  );

  if (!choice) return;
  if (choice.trim() === "2") await exportHabitsZip();
  else exportHabitsCsvSingle();
}


function bindEvents() {
  $habitExportBtn?.addEventListener("click", onHabitsExportClick);
  $tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeTab = tab.dataset.tab;
      renderHabits();
    });
  });

  $habitDetailClose?.addEventListener("click", closeHabitDetail);
  $habitDetailOverlay?.addEventListener("click", (event) => {
    if (event.target === $habitDetailOverlay) closeHabitDetail();
  });
  $habitDetailEdit?.addEventListener("click", () => {
    openHabitEditFromDetail();
  });
  $habitDetailEmoji?.addEventListener("click", (event) => {
    event.stopPropagation();
    openHabitEditFromDetail();
  });
  $habitDetailRecordsWrap?.addEventListener("toggle", () => {
    if (!$habitDetailRecordsWrap?.open) {
      if ($habitDetailRecords) $habitDetailRecords.innerHTML = "";
      if ($habitDetailRecordsMore) $habitDetailRecordsMore.classList.add("hidden");
      return;
    }
    if (!habitDetailId || !habits[habitDetailId]) return;
    habitDetailRecordsPage = 1;
    updateHabitDetailRecordsSummary(habits[habitDetailId], habitDetailRange);
    renderHabitDetailRecordsPage(habits[habitDetailId]);
  });
  $habitDetailRecordsMore?.addEventListener("click", () => {
    if (!habitDetailId || !habits[habitDetailId]) return;
    habitDetailRecordsPage += 1;
    renderHabitDetailRecordsPage(habits[habitDetailId]);
  });
  $habitDetailRangeButtons?.forEach((btn) => {
    btn.addEventListener("click", () => {
      const range = btn.dataset.range;
      if (!range) return;
      habitDetailRange = range;
      if (habitDetailId) renderHabitDetail(habitDetailId, range);
    });
  });
  $habitDetailChartMode?.querySelectorAll("[data-mode]")?.forEach((btn) => {
    btn.addEventListener("click", () => {
      habitDetailChartMode = btn.dataset.mode || "bar";
      $habitDetailChartMode.querySelectorAll("[data-mode]").forEach((b) => b.classList.toggle("is-active", b === btn));
      if (habitDetailId) renderHabitDetail(habitDetailId, habitDetailRange);
    });
  });
  $habitDetailChartRange?.querySelectorAll("[data-chart-range]")?.forEach((btn) => {
    btn.addEventListener("click", () => {
      habitDetailChartRange = btn.dataset.chartRange || "30d";
      $habitDetailChartRange.querySelectorAll("[data-chart-range]").forEach((b) => b.classList.toggle("is-active", b === btn));
      if (habitDetailId) renderHabitDetail(habitDetailId, habitDetailRange);
    });
  });

  $habitDetailScheduleDayChips?.addEventListener("click", (event) => {
    const chip = event.target?.closest?.("button[data-dow]");
    if (!chip) return;
    const dow = chip.dataset.dow;
    if (!SCHEDULE_DOWS.includes(dow)) return;
    const current = new Set(habitDetailScheduleSelection?.dows || []);
    if (current.has(dow)) current.delete(dow);
    else current.add(dow);
    habitDetailScheduleSelection = {
      types: sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []),
      dows: sanitizeScheduleDows(Array.from(current))
    };
    if (!habitDetailId || !habits[habitDetailId]) return;
    renderHabitDetailSchedulePanel(habits[habitDetailId]);
  });
  $habitDetailScheduleTypeChips?.addEventListener("click", (event) => {
    const chip = event.target?.closest?.("button[data-type]");
    if (!chip) return;
    const type = chip.dataset.type;
    if (!SCHEDULE_TYPES.includes(type)) return;
    const current = new Set(habitDetailScheduleSelection?.types || []);
    if (current.has(type)) current.delete(type);
    else current.add(type);
    habitDetailScheduleSelection = {
      types: sanitizeScheduleTypes(Array.from(current)),
      dows: sanitizeScheduleDows(habitDetailScheduleSelection?.dows || [])
    };
    if (!habitDetailId || !habits[habitDetailId]) return;
    renderHabitDetailSchedulePanel(habits[habitDetailId]);
  });
  $habitDetailScheduleDaysAll?.addEventListener("click", () => {
    habitDetailScheduleSelection = {
      types: sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []),
      dows: [...SCHEDULE_DOWS]
    };
    if (habitDetailId && habits[habitDetailId]) renderHabitDetailSchedulePanel(habits[habitDetailId]);
  });
  $habitDetailScheduleDaysWork?.addEventListener("click", () => {
    habitDetailScheduleSelection = {
      types: sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []),
      dows: ["mon", "tue", "wed", "thu", "fri"]
    };
    if (habitDetailId && habits[habitDetailId]) renderHabitDetailSchedulePanel(habits[habitDetailId]);
  });
  $habitDetailScheduleDaysWeekend?.addEventListener("click", () => {
    habitDetailScheduleSelection = {
      types: sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []),
      dows: ["sat", "sun"]
    };
    if (habitDetailId && habits[habitDetailId]) renderHabitDetailSchedulePanel(habits[habitDetailId]);
  });
  $habitDetailScheduleDaysClear?.addEventListener("click", () => {
    habitDetailScheduleSelection = {
      types: sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []),
      dows: []
    };
    if (habitDetailId && habits[habitDetailId]) renderHabitDetailSchedulePanel(habits[habitDetailId]);
  });
  $habitDetailScheduleMode?.addEventListener("change", () => {
    if (!$habitDetailScheduleValue) return;
    $habitDetailScheduleValue.disabled = $habitDetailScheduleMode.value === "neutral";
    if ($habitDetailScheduleMode.value === "neutral") $habitDetailScheduleValue.value = "0";
  });
  $habitDetailScheduleSave?.addEventListener("click", async () => {
    if (!habitDetailId || !habits[habitDetailId]) return;
    const types = sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []);
    const dows = sanitizeScheduleDows(habitDetailScheduleSelection?.dows || []);
    if (!types.length) {
      showHabitToast("Selecciona al menos un tipo de jornada");
      return;
    }
    const mode = $habitDetailScheduleMode?.value || "neutral";
    const value = Math.max(0, Math.round(Number($habitDetailScheduleValue?.value || 0)));
    if (mode !== "neutral" && value <= 0) {
      showHabitToast("El valor debe ser mayor a 0");
      return;
    }
    try {
      await applyHabitScheduleBulk(habitDetailId, dows, types, mode, value);
      renderHabitDetailSchedulePanel(habits[habitDetailId]);
      if (activeTab === "schedule") renderSchedule("detail:habit-save");
      showHabitToast("Aplicado");
    } catch (err) {
      console.warn("No se pudo aplicar horario del hábito", err);
      showHabitToast("No se pudo aplicar");
    }
  });
  $habitDetailScheduleRemove?.addEventListener("click", async () => {
    if (!habitDetailId || !habits[habitDetailId]) return;
    const types = sanitizeScheduleTypes(habitDetailScheduleSelection?.types || []);
    const dows = sanitizeScheduleDows(habitDetailScheduleSelection?.dows || []);
    if (!types.length) {
      showHabitToast("Selecciona al menos un tipo de jornada");
      return;
    }
    try {
      await removeHabitScheduleBulk(habitDetailId, dows, types);
      renderHabitDetailSchedulePanel(habits[habitDetailId]);
      if (activeTab === "schedule") renderSchedule("detail:habit-remove");
      showHabitToast("Quitado");
    } catch (err) {
      console.warn("No se pudo eliminar horario del hábito", err);
      showHabitToast("No se pudo quitar");
    }
  });
  $habitDayDetailClose?.addEventListener("click", closeDayDetailModal);
  $habitDayDetailCancel?.addEventListener("click", closeDayDetailModal);
  $habitDayDetailSave?.addEventListener("click", saveDayDetailModal);
  $habitDayDetailModal?.addEventListener("click", (event) => {
    if (event.target === $habitDayDetailModal) closeDayDetailModal();
  });
  $habitScheduleSummaryClose?.addEventListener("click", closeScheduleSummaryModal);
  $habitScheduleSummaryCancel?.addEventListener("click", closeScheduleSummaryModal);
  $habitScheduleSummaryModal?.addEventListener("click", (event) => {
    if (event.target === $habitScheduleSummaryModal) closeScheduleSummaryModal();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $habitDetailOverlay && !$habitDetailOverlay.classList.contains("hidden")) {
      closeHabitDetail();
    }
  });

  $habitFabAdd?.addEventListener("click", () => openHabitModal());
  $habitForm?.querySelectorAll('input[name="habit-goal"]').forEach((r) => {
    r.addEventListener("change", updateHabitGoalUI);
  });
  $habitQuickCounterPinned?.addEventListener("change", (event) => {
    const habitId = $habitId?.value || "";
    if (!habitId) return;
    setQuickCounterPinned(habitId, !!event.target?.checked);
  });
  $habitQuickCounterUp?.addEventListener("click", () => {
    const habitId = $habitId?.value || "";
    if (!habitId) return;
    moveQuickCounter(habitId, -1);
  });
  $habitQuickCounterDown?.addEventListener("click", () => {
    const habitId = $habitId?.value || "";
    if (!habitId) return;
    moveQuickCounter(habitId, 1);
  });
  $habitParamSelect?.addEventListener("change", (e) => {
    toggleParamNewInput(e.target.value === "__new__");
  });
  $habitParamAdd?.addEventListener("click", () => {
    const value = $habitParamSelect?.value || "";
    if (value === "__new__") {
      toggleParamNewInput(true);
      $habitParamNew?.focus();
      return;
    }
    addHabitParam(value);
    if ($habitParamSelect) $habitParamSelect.value = "";
  });
  $habitParamCreate?.addEventListener("click", () => {
    const value = $habitParamNew?.value || "";
    addHabitParam(value);
    toggleParamNewInput(false);
    if ($habitParamSelect) $habitParamSelect.value = "";
  });
  $habitGroupSelect?.addEventListener("change", (e) => {
    if ($habitGroupRename) {
      const group = habitGroups?.[e.target.value];
      $habitGroupRename.value = group?.name || "";
    }
  });
  $habitGroupCreate?.addEventListener("click", () => {
    const group = createHabitGroup($habitGroupNew?.value || "");
    if (!group) return;
    if ($habitGroupNew) $habitGroupNew.value = "";
    syncHabitGroupSelect(group.id);
    renderToday();
  });
  $habitGroupRenameBtn?.addEventListener("click", () => {
    const groupId = $habitGroupSelect?.value || "";
    if (!groupId) return;
    const ok = renameHabitGroup(groupId, $habitGroupRename?.value || "");
    if (!ok) return;
    syncHabitGroupSelect(groupId);
    renderToday();
  });
  $habitGroupDeleteBtn?.addEventListener("click", () => {
    const groupId = $habitGroupSelect?.value || "";
    if (!groupId) return;
    deleteHabitGroup(groupId);
    syncHabitGroupSelect("");
    renderToday();
  });
  $btnAddTime?.addEventListener("click", () => openManualTimeModal(selectedDateKey));
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
  $habitSessionModal?.addEventListener("focusin", handleSessionModalFocus);
  window.visualViewport?.addEventListener("resize", updateSessionModalViewportPadding);
  window.visualViewport?.addEventListener("scroll", updateSessionModalViewportPadding);

  const clearTodaySearch = () => {
    if (!$habitTodaySearchInput) return;
    $habitTodaySearchInput.value = "";
    applyTodaySearch("");
    $habitTodaySearchInput.focus();
  };

  $habitTodaySearchInput?.addEventListener("input", () => {
    if (todaySearchTimer) window.clearTimeout(todaySearchTimer);
    todaySearchTimer = window.setTimeout(() => {
      applyTodaySearch($habitTodaySearchInput?.value || "");
    }, 150);
  });
  $habitTodaySearchInput?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      clearTodaySearch();
    }
  });
  $habitTodaySearchClear?.addEventListener("click", clearTodaySearch);
  $habitTodaySearchReset?.addEventListener("click", clearTodaySearch);

  $habitQuickSessionsAdd?.addEventListener("click", () => {
    const habitId = $habitQuickSessionsSelect?.value || "";
    if (!habitId) return;
    const current = Array.isArray(habitPrefs?.quickSessions) ? habitPrefs.quickSessions : [];
    if (current.includes(habitId)) {
      $habitQuickSessionsSelect.value = "";
      return;
    }
    habitPrefs = { ...habitPrefs, quickSessions: [...current, habitId] };
    persistHabitPrefs();
    renderQuickSessions();
  });

  $habitManualClose?.addEventListener("click", closeManualTimeModal);
  $habitManualCancel?.addEventListener("click", closeManualTimeModal);
  $habitManualForm?.addEventListener("submit", handleManualSubmit);


  $habitEntryClose?.addEventListener("click", closeEntryModal);
  $habitEntryCancel?.addEventListener("click", closeEntryModal);
  $habitEntryForm?.addEventListener("submit", handleEntrySubmit);
  $habitEntryHabit?.addEventListener("change", refreshEntryModal);
  $habitEntryDate?.addEventListener("change", refreshEntryModal);
  $habitEntryCountMinus?.addEventListener("click", (e) => {
    e.preventDefault();
    const habitId = $habitEntryHabit?.value;
    const dateKey = $habitEntryDate?.value || todayKey();
    if (habitId) adjustHabitCount(habitId, dateKey, -1);
    refreshEntryModal();
  });
  $habitEntryCountPlus?.addEventListener("click", (e) => {
    e.preventDefault();
    const habitId = $habitEntryHabit?.value;
    const dateKey = $habitEntryDate?.value || todayKey();
    if (habitId) adjustHabitCount(habitId, dateKey, +1);
    refreshEntryModal();
  });

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
      renderCountsList();
      renderKPIs();
      renderPins();
    });
  });
  $habitPinCountSelect?.addEventListener("change", (e) => {
    habitPrefs = { ...habitPrefs, pinCount: e.target.value || "" };
    persistHabitPrefs();
    renderPins();
  });
  $habitPinTimeSelect?.addEventListener("change", (e) => {
    habitPrefs = { ...habitPrefs, pinTime: e.target.value || "" };
    persistHabitPrefs();
    renderPins();
  });
  $habitDonutGroup?.addEventListener("change", (e) => {
    const value = e.target.value || "habit";
    if (value.startsWith("cat:")) {
      habitDonutGroupMode = { kind: "cat", cat: value.slice(4) };
    } else {
      habitDonutGroupMode = { kind: "habit" };
    }
    renderDonut();
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

  $habitRecordsRangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      $habitRecordsRangeButtons.forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      habitRecordsRange = btn.dataset.range || "month";
      renderRecordsCard();
    });
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
  const rerender = () => renderHabitsPreservingUI();

  onValue(ref(db, HABITS_PATH), (snap) => {
    habits = normalizeHabitsStore(snap.val() || {});
    invalidateDominantCache();
    markHistoryDataChanged("remote:habits");
    ensureUnknownHabit(true);
    if (_pendingShortcutCmd) {
      try {
        const ok = executeShortcutCmd(_pendingShortcutCmd, { silent: true });
        if (ok) _pendingShortcutCmd = null;
      } catch (_) {}
    }
    saveCache();
    rerender();
  });

  onValue(ref(db, HABIT_GROUPS_PATH), (snap) => {
    habitGroups = snap.val() || {};
    saveCache();
    rerender();
  });

  onValue(ref(db, HABIT_PREFS_PATH), (snap) => {
    habitPrefs = snap.val() || { pinCount: "", pinTime: "", quickSessions: [] };
    if (!Array.isArray(habitPrefs.quickSessions)) habitPrefs.quickSessions = [];
    saveCache();
    renderPins();
    renderQuickSessions();
  });

  onValue(ref(db, HABIT_UI_QUICK_COUNTERS_PATH), (snap) => {
    habitUI = normalizeHabitUI({ ...habitUI, quickCounters: snap.val() || [] });
    saveCache();
    renderQuickCounters();
  });

  onValue(ref(db, HABITS_SCHEDULE_PATH), (snap) => {
    console.warn("SCHEDULE UPDATE", "firebase:onValue");
    const raw = snap.val();
    scheduleState = raw && typeof raw === "object"
      ? normalizeHabitSchedule(raw)
      : createDefaultHabitSchedule();
    saveCache();
    if (activeTab === "schedule") renderSchedule("remote:onValue");
  });

  onValue(ref(db, HABIT_COMPARE_SETTINGS_PATH), (snap) => {    const remote = snap.val();
    if (!remote) return;
    applyHabitCompareSettings(remote);
    saveHabitCompareSettingsLocal();
    rerender();
  });

  onValue(ref(db, HABIT_CHECKS_PATH), (snap) => {
    habitChecks = snap.val() || {};
    invalidateDominantCache();
    markHistoryDataChanged("remote:checks");
    saveCache();
    rerender();
  });

  onValue(ref(db, HABIT_COUNTS_PATH), (snap) => {
    habitCounts = snap.val() || {};
    invalidateDominantCache();
    markHistoryDataChanged("remote:counts");
    saveCache();
    rerender();
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    try { window.__bookshellDashboard?.render?.(); } catch (_) {}
  });

  onValue(ref(db, HABIT_SESSIONS_PATH), (snap) => {
    const raw = snap.val() || {};
    debugHabitsSync("onValue:habitSessions raw", raw);
    const work = activeHabits().find((h) => isWorkHabit(h));
    if (work) {
      debugWorkShift("[WORK] onValue workShifts", null);
      debugWorkShift("[WORK] onValue habitSessions(work)", {
        dateKey: selectedDateKey,
        value: raw?.[work.id]?.[selectedDateKey] ?? null
      });
    }
    applyPendingSessionWrites(raw);
    const norm = normalizeSessionsStore(raw, true);
    habitSessions = norm.normalized;
    habitSessionTimeline = norm.timeline || {};
    habitSessionTimelineCoverage = norm.coverage || {};
    debugHabitsSync("onValue:habitSessions normalized", habitSessions);
    invalidateDominantCache();
    markHistoryDataChanged("remote:sessions");
    saveCache();
    rerender();
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    try { window.__bookshellDashboard?.render?.(); } catch (_) {}
  });
}



function goHabitSubtab(tab) {
  const allowed = new Set(["today", "week", "history", "schedule", "reports"]);
  activeTab = allowed.has(tab) ? tab : "today";
  renderHabits();
}

function toggleSession() {
  if (runningSession) stopSession();
  else startSession();
}



function readShortcutCmdFromUrl() {
  try {
    const url = new URL(window.location.href);

    // params normales
    const params = new URLSearchParams(url.search);

    // params en hash tipo #view-habits?...
    const hash = String(url.hash || "");
    const qIdx = hash.indexOf("?");
    if (qIdx >= 0) {
      const hp = new URLSearchParams(hash.slice(qIdx + 1));
      hp.forEach((v, k) => { if (!params.has(k)) params.set(k, v); });
    }

    const actionRaw = (params.get("hact") || params.get("action") || params.get("do") || "").trim();
    const habitToken = (params.get("habit") || params.get("h") || params.get("habitName") || params.get("habitId") || "").trim();
    const tab = (params.get("tab") || "").trim();
    let view = (params.get("view") || "").trim();
    if (!view && hash) {
      const hashPath = hash.replace(/^#/, "").split("?")[0];
      if (hashPath.includes("habits")) view = "habits";
    }

    const action = actionRaw.toLowerCase().replace(/[_\s-]/g, "");
    const normalizedAction = action === "startsession" ? "start"
      : (action === "stopsession" ? "stop" : action);

    if (!normalizedAction && !tab && !view) return null;

    return {
      action: normalizedAction || "",
      habitToken,
      tab: tab ? tab.toLowerCase() : "",
      view: view ? view.toLowerCase() : "",
      _keys: ["hact","action","do","habit","h","habitName","habitId","tab","view","hb","habits","src"]
    };
  } catch (_) {
    return null;
  }
}

function clearShortcutCmdFromUrl(cmd) {
  try {
    const url = new URL(window.location.href);
    (cmd?._keys || []).forEach((k) => url.searchParams.delete(k));
    if (url.hash && url.hash.includes("?")) url.hash = url.hash.split("?")[0];
    if (window.__bookshellDebugDeepLink) {
      console.log("[NAV] replaceState clearShortcutCmdFromUrl", {
        search: url.searchParams.toString(),
        hash: url.hash
      }, new Error().stack);
    }
    history.replaceState({}, document.title, url.toString());
  } catch (_) {}
}

function executeShortcutCmd(cmd, { silent = true } = {}) {
  if (!cmd) return false;

  if (cmd.view === "habits" || cmd.tab || cmd.action) {
    const btn = document.querySelector('.nav-btn[data-view="view-habits"]');
    btn?.click();
  }

  // tab
  if (cmd.tab) goHabitSubtab(cmd.tab);

  // action
  const action = cmd.action;
  if (!action) return true;

  const habitId = resolveHabitIdFromToken(cmd.habitToken);

  if (action === "start" || action === "begin" || action === "on") {
    // si viene por nombre y aún no está en cache/remoto, esperamos
    if (cmd.habitToken && !habitId) return false;

    if (habitId) startSession(habitId);
    else startSession();

    if (!silent) showHabitToast(habitId ? `▶︎ Sesión: ${habits[habitId]?.name || "—"}` : "▶︎ Sesión iniciada");
    return true;
  }

  if (action === "stop" || action === "end" || action === "off") {
    // si viene por nombre y aún no está en cache/remoto, esperamos
    if (cmd.habitToken && !habitId) return false;

    if (habitId) stopSession(habitId, true);
    else stopSession(null, true);

    return true;
  }

  if (action === "toggle") {
    if (habitId) {
      if (runningSession) stopSession(habitId, true);
      else startSession(habitId);
    } else {
      toggleSession();
    }
    return true;
  }

  return false;
}

function handleShortcutUrlOnce() {
  const cmd = readShortcutCmdFromUrl();
  if (!cmd) return;

  // intentamos ya (con cache). Si viene por nombre y no existe aún, quedará pendiente.
  _pendingShortcutCmd = cmd;
  const okNow = executeShortcutCmd(cmd, { silent: true });

  // evitamos re-ejecución al recargar
  clearShortcutCmdFromUrl(cmd);

  if (!okNow) return; // esperamos a que llegue remoto (HABITS_PATH)

  _pendingShortcutCmd = null;
}

// API para Atajos (Shortcut -> URL params)
window.__bookshellHabits = {
  goHabitSubtab,
  startSession,
  stopSession,
  startHabitSessionUniversal,
  stopHabitSessionUniversal,
  getRunningHabitSession,
  resolveHabitIdByName,
  listActiveHabits: () => activeHabits().map((habit) => ({
    id: habit.id,
    name: habit.name,
    emoji: habit.emoji || "🏷️"
  })),
  toggleSession,
  setDailyMinutes: setHabitDailyMinutes,
  isRunning: () => !!runningSession,
  getTimeShareByHabit: (range) => timeShareByHabit(range),
  rangeLabel,
  debugComputeTimeByHabit
};
export async function initHabits() {
  readCache();
  loadRunningSession();
  loadHeatmapYear();
  loadHistoryRange();
  loadHabitCompareSettingsLocal();
  ensureUnknownHabit(true);
  ensureSessionOverlayInBody();
  handleShortcutUrlOnce();
  bindEvents();
  attachNavHook();
  await loadScheduleFromRemote();
  listenRemote();
  renderHabits();
  maybeAutoCloseScheduleDay();
  scheduleAutoCloseInterval = window.setInterval(maybeAutoCloseScheduleDay, 600000);
  if (runningSession) {
    sessionInterval = setInterval(updateSessionUI, 1000);
  }
  window.addEventListener("resize", () => {
    if (habitDonutChart) habitDonutChart.resize();
  });
}

// Autoinit
initHabits();
