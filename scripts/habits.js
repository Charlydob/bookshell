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
const HABIT_COUNTS_PATH = "habitCounts";
const HABIT_GROUPS_PATH = "habitGroups";
const HABIT_PREFS_PATH = "habitPrefs";

// Storage keys
const STORAGE_KEY = "bookshell-habits-cache";
const RUNNING_KEY = "bookshell-habit-running-session";
const LAST_HABIT_KEY = "bookshell-habits-last-used";
const HEATMAP_YEAR_STORAGE = "bookshell-habits-heatmap-year";
const HISTORY_RANGE_STORAGE = "bookshell-habits-history-range:v1";
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
let habitCounts = {}; // { habitId: { dateKey: number } }
let habitGroups = {}; // { groupId: { id, name, createdAt } }
let habitPrefs = { pinCount: "", pinTime: "" };
let activeTab = "today";
let runningSession = null; // { startTs }
let sessionInterval = null;
let pendingSessionDuration = 0;
let heatmapYear = new Date().getFullYear();
let habitHistoryRange = "week";
let habitHistoryMetric = "time";
let habitHistoryGroupMode = { kind: "habit", cat: null };
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
const habitDetailRecordsPageSize = 10;

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


function foldKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
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

function formatHoursTotal(minutes) {
  const total = Math.round(Number(minutes) || 0);
  if (!total) return "0h";
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (!hours) return `0h ${rest}m`;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
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
// === Sesiones v2 (ahorro de storage) ===
// Antes (v1): habitSessions = { sessionId: {habitId, dateKey, durationSec, ...} }
// Ahora  (v2): habitSessions = { habitId: { dateKey: totalSec } }
// Migración automática: v1 -> v2 (sobrescribe nodo remoto para borrar sesiones antiguas)
function normalizeSessionsStore(raw, persistRemote = false) {
  const totals = {};
  let changed = false;

  const add = (habitId, dateKey, sec) => {
    if (!habitId || !dateKey) return;
    const n = Number(sec) || 0;
    if (n <= 0) return;
    if (!totals[habitId]) totals[habitId] = {};
    totals[habitId][dateKey] = (Number(totals[habitId][dateKey]) || 0) + n;
  };

  Object.entries(raw || {}).forEach(([k, v]) => {
    if (!v || typeof v !== "object") return;

    // v1: cada key es sessionId y el value tiene habitId/durationSec
    if (typeof v.habitId === "string" && (v.durationSec != null)) {
      changed = true;
      const dateKey = v.dateKey || (v.startTs ? dateKeyLocal(new Date(v.startTs)) : null);
      add(v.habitId, dateKey, v.durationSec);
      return;
    }

    // v2: key = habitId y value = {dateKey: totalSec}
    const habitId = k;
    Object.entries(v).forEach(([dateKey, val]) => {
      if (!dateKey) return;
      if (typeof val === "number") {
        if (val > 0) add(habitId, dateKey, val);
        if (val <= 0) changed = true;
        return;
      }
      if (val && typeof val === "object") {
        const sec = Number(val.totalSec) || 0;
        if (sec > 0) add(habitId, dateKey, sec);
        changed = true;
      } else {
        changed = true;
      }
    });
  });

  // Si no había nada, devolvemos objeto vacío estable
  const normalized = totals;

  if (persistRemote && changed) {
    try {
      set(ref(db, HABIT_SESSIONS_PATH), normalized);
    } catch (err) {
      console.warn("No se pudo migrar/normalizar sesiones en remoto", err);
    }
  }

  return { normalized, changed };
}

function getHabitTotalSecForDate(habitId, dateKey) {
  if (!habitId || !dateKey) return 0;

  // Desconocido se calcula dinámicamente: 24h - tiempo asignado
  if (habitId === UNKNOWN_HABIT_ID) {
    ensureUnknownHabit(false);
    const computed = computeUnknownSecForDate(dateKey);

    // cache en memoria (sin machacar remoto)
    if (!habitSessions[UNKNOWN_HABIT_ID] || typeof habitSessions[UNKNOWN_HABIT_ID] !== "object") {
      habitSessions[UNKNOWN_HABIT_ID] = {};
    }
    habitSessions[UNKNOWN_HABIT_ID][dateKey] = computed;
    return computed;
  }

  const byDate = habitSessions?.[habitId];
  if (!byDate || typeof byDate !== "object") return 0;
  const sec = Number(byDate[dateKey]) || 0;
  return sec > 0 ? sec : 0;
}

function addHabitTimeSec(habitId, dateKey, secToAdd) {
  if (!habitId || !dateKey) return 0;
  const habit = habits[habitId];
  if (!habit || habit.archived) return 0;
  const addSec = Math.max(0, Math.round(Number(secToAdd) || 0));
  if (!addSec) return getHabitTotalSecForDate(habitId, dateKey);
  if (!habitSessions[habitId] || typeof habitSessions[habitId] !== "object") habitSessions[habitId] = {};
  const next = (Number(habitSessions[habitId][dateKey]) || 0) + addSec;
  habitSessions[habitId][dateKey] = next;
  saveCache();
  try {
    set(ref(db, `${HABIT_SESSIONS_PATH}/${habitId}/${dateKey}`), next);
  } catch (err) {
    console.warn("No se pudo guardar tiempo en remoto", err);
  }

  // recalcular Desconocido del día
  if (habitId !== UNKNOWN_HABIT_ID) {
    try { recomputeUnknownForDate(dateKey, true); } catch (_) {}
  }

  return next;
}

function setHabitTimeSec(habitId, dateKey, totalSec) {
  if (!habitId || !dateKey) return;
  const habit = habits[habitId];
  if (!habit || habit.archived) return;
  const sec = Math.max(0, Math.round(Number(totalSec) || 0));
  if (!habitSessions[habitId] || typeof habitSessions[habitId] !== "object") habitSessions[habitId] = {};
  if (sec > 0) habitSessions[habitId][dateKey] = sec;
  else delete habitSessions[habitId][dateKey];
  saveCache();
  try {
    set(ref(db, `${HABIT_SESSIONS_PATH}/${habitId}/${dateKey}`), sec > 0 ? sec : null);
  } catch (err) {
    console.warn("No se pudo actualizar tiempo en remoto", err);
  }

  // recalcular Desconocido del día
  if (habitId !== UNKNOWN_HABIT_ID) {
    try { recomputeUnknownForDate(dateKey, true); } catch (_) {}
  }
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
      habits = parsed.habits || {};
      habitChecks = parsed.habitChecks || {};
      habitSessions = parsed.habitSessions || {};
      habitCounts = parsed.habitCounts || {};
      habitGroups = parsed.habitGroups || {};
      habitPrefs = parsed.habitPrefs || { pinCount: "", pinTime: "" };
      const norm = normalizeSessionsStore(habitSessions, false);
      habitSessions = norm.normalized;
      if (norm.changed) saveCache();
    }
  } catch (err) {
    console.warn("No se pudo leer cache de hábitos", err);
  }
}

function saveCache() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ habits, habitChecks, habitSessions, habitCounts, habitGroups, habitPrefs })
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

function isSystemHabit(habit) {
  return !!habit?.system;
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
    countUnitMinutes: null,
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

  // suma de TODO el tiempo registrado (excepto Desconocido)
  let assigned = 0;
  Object.entries(habitSessions || {}).forEach(([hid, byDate]) => {
    if (hid === UNKNOWN_HABIT_ID) return;
    const h = habits?.[hid];
    if (!h || h.archived) return;
    const sec = Number(byDate?.[dateKey]) || 0;
    if (sec > 0) assigned += sec;
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
    const sec = Number(byDate[dateKey]) || 0;
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
    Object.entries(byDate).forEach(([key, sec]) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && (Number(sec) || 0) > 0) dates.add(key);
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
      if ((Number(byDate[key]) || 0) > 0) dates.add(key);
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
  const minutes = getSessionsForHabitDate(habit.id, dateKey).reduce((acc, s) => acc + minutesFromSession(s), 0);
  const timeScore = Math.min(3, Math.floor(minutes / 30));
  const score = (checked ? 1 : 0) + timeScore;
  return { score, minutes, checked, count: 0, hasActivity: checked || minutes > 0 };
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
const $habitDetailRecordsSub = document.getElementById("habit-detail-records-sub");
const $habitDetailRecords = document.getElementById("habit-detail-records");
const $habitDetailRecordsWrap = document.getElementById("habit-detail-records-wrap");
const $habitDetailRecordsMore = document.getElementById("habit-detail-records-more");
const $habitDetailInsightsSub = document.getElementById("habit-detail-insights-sub");
const $habitDetailInsights = document.getElementById("habit-detail-insights");

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
const $habitTargetMinutesWrap = document.getElementById("habit-target-minutes-wrap");
const $habitCountUnitMinutes = document.getElementById("habit-count-unit-minutes");
const $habitCountUnitMinutesWrap = document.getElementById("habit-count-unit-minutes-wrap");
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
  renderHabits();
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
  syncHabitGroupSelect(habit?.groupId || "");
  if ($habitGroupPrivate) $habitGroupPrivate.checked = !!(habit && habit.groupPrivate);
  if ($habitGroupLowUse) $habitGroupLowUse.checked = !!(habit && habit.groupLowUse);
  $habitTargetMinutes.value = habit && habit.targetMinutes ? habit.targetMinutes : "";
  if ($habitCountUnitMinutes) $habitCountUnitMinutes.value = habit && habit.countUnitMinutes ? habit.countUnitMinutes : "";
  const qas = habit && Array.isArray(habit.quickAdds) ? habit.quickAdds : [];
  if ($habitQuick1Label) $habitQuick1Label.value = qas[0]?.label || "";
  if ($habitQuick1Minutes) $habitQuick1Minutes.value = qas[0]?.minutes ? String(qas[0].minutes) : "";
  if ($habitQuick2Label) $habitQuick2Label.value = qas[1]?.label || "";
  if ($habitQuick2Minutes) $habitQuick2Minutes.value = qas[1]?.minutes ? String(qas[1].minutes) : "";
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

  const qa1m = $habitQuick1Minutes?.value ? Number($habitQuick1Minutes.value) : 0;
  const qa2m = $habitQuick2Minutes?.value ? Number($habitQuick2Minutes.value) : 0;
  const quickAdds = goal === "time"
    ? [
        ...(Number.isFinite(qa1m) && qa1m > 0 ? [{ label: ($habitQuick1Label?.value || "").trim(), minutes: Math.round(qa1m) }] : []),
        ...(Number.isFinite(qa2m) && qa2m > 0 ? [{ label: ($habitQuick2Label?.value || "").trim(), minutes: Math.round(qa2m) }] : []),
      ]
    : [];
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
    countUnitMinutes: Number.isFinite(safeUnit) && safeUnit > 0 ? Math.round(safeUnit) : null,
    quickAdds,
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

function renderWeekTimeline() {
  if (!$habitWeekTimeline) return;
  const baseDate = parseDateKey(selectedDateKey) || new Date();
  const start = startOfWeek(baseDate);
  const today = todayKey();
  const labels = ["L", "M", "X", "J", "V", "S", "D"];
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
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habit-week-day";
    btn.style.setProperty("--day-progress", String(percent));
    const isToday = dateKey === today;
    const isActive = dateKey === selectedDateKey;
    if (isToday) btn.classList.add("is-today");
    if (isActive) btn.classList.add("is-active");
    btn.innerHTML = `
      <div class="day-label">${labels[i]}</div>
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
    input.type = "number";
    input.min = "1";
    input.inputMode = "numeric";
    input.placeholder = "+min";
    const addBtn = buildHabitDetailActionButton("Añadir", {
      onClick: () => {
        const n = Number(input.value);
        if (!Number.isFinite(n) || n <= 0) return;
        addHabitTimeSec(habit.id, dateKey, Math.round(n * 60));
        input.value = "";
        renderHabits();
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
  const days = getHabitDetailRangeDays(rangeKey);
  const today = new Date();
  $habitDetailHeatmap.innerHTML = "";
  const columns = Math.max(7, Math.ceil(days / 7));
  $habitDetailHeatmap.style.setProperty("--heatmap-cols", String(columns));

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const key = dateKeyLocal(date);
    const data = getHabitDayScore(habit, key);
    const level = scoreToHeatLevel(data.score);
    const cell = document.createElement("div");
    cell.className = `habit-heatmap-cell heat-level-${level}`;
    cell.title = `${key} · ${data.hasActivity ? "activo" : "sin actividad"}`;
    $habitDetailHeatmap.appendChild(cell);
  }

  if ($habitDetailHeatmapSub) {
    $habitDetailHeatmapSub.textContent = `Últimos ${days} días`;
  }
}

function renderHabitDetailChart(habit, rangeKey) {
  if (!$habitDetailChart) return;
  const goal = habit.goal || "check";
  const days = getHabitDetailChartDays(rangeKey);
  const today = new Date();
  const values = [];
  let total = 0;

  for (let i = days - 1; i >= 0; i -= 1) {
    const date = addDays(today, -i);
    const key = dateKeyLocal(date);
    const value = getHabitValueForDate(habit, key);
    values.push({ key, value });
    total += value;
  }

  let maxValue = Math.max(0, ...values.map((item) => item.value));
  if (maxValue <= 0) maxValue = 1;
  const scaleMax = maxValue * 1.08;
  $habitDetailChart.innerHTML = "";
  const formatTick = (value) => {
    if (goal === "time") return formatMinutes(Math.round(value));
    if (goal === "count") return `${Math.round(value)}×`;
    return String(Math.round(value));
  };

  const axis = document.createElement("div");
  axis.className = "habit-detail-chart-axis";
  const half = scaleMax / 2;
  const ticks = [scaleMax, half, 0];
  ticks.forEach((tick) => {
    const tickEl = document.createElement("span");
    tickEl.textContent = formatTick(tick);
    axis.appendChild(tickEl);
  });

  const barsWrap = document.createElement("div");
  barsWrap.className = "habit-detail-chart-bars";
  const clearActiveBars = () => {
    barsWrap.querySelectorAll(".habit-detail-bar.is-active").forEach((bar) => {
      bar.classList.remove("is-active");
    });
  };

  values.forEach((item) => {
    const barItem = document.createElement("div");
    barItem.className = "habit-detail-bar-item";
    const bar = document.createElement("button");
    bar.type = "button";
    const heightPct = scaleMax ? (item.value / scaleMax) * 100 : 0;
    bar.className = `habit-detail-bar${item.value ? "" : " is-empty"}`;
    bar.style.setProperty("--h", Math.max(0, heightPct).toFixed(2));
    const formattedValue = formatTick(item.value);
    const labelValue = goal === "check"
      ? (item.value ? "✓" : "—")
      : formattedValue;
    bar.title = `${item.key} · ${labelValue}`;
    bar.setAttribute("aria-label", `${item.key} · ${labelValue}`);
    bar.addEventListener("click", () => {
      clearActiveBars();
      bar.classList.add("is-active");
    });
    const tooltip = document.createElement("div");
    tooltip.className = "habit-detail-bar-tooltip";
    tooltip.textContent = labelValue;
    bar.appendChild(tooltip);
    const label = document.createElement("div");
    label.className = "habit-detail-bar-label";
    const labelDate = parseDateKey(item.key);
    label.textContent = labelDate ? String(labelDate.getDate()) : "—";
    barItem.appendChild(bar);
    barItem.appendChild(label);
    barsWrap.appendChild(barItem);
  });

  if (values.length) {
    const samplePct = scaleMax ? (values[0].value / scaleMax) * 100 : 0;
    console.debug("[habit-detail chart]", {
      values: values.map((item) => item.value),
      maxVal: maxValue,
      scaleMax,
      sampleH: `${Math.max(0, samplePct).toFixed(2)}%`
    });
  }

  $habitDetailChart.appendChild(axis);
  $habitDetailChart.appendChild(barsWrap);

  if ($habitDetailChartSub) {
    $habitDetailChartSub.textContent = `Últimos ${days} días`;
  }

  if ($habitDetailChartMeta) {
    const weekStart = addDays(today, -6);
    const weekTotal = getHabitMetricForRange(habit, weekStart, endOfDay(today), goal === "time" ? "time" : "count");
    const avgWeeks = days / 7;
    const avgLabel = goal === "time"
      ? `Promedio semanal: ${formatMinutes(Math.round(total / avgWeeks))}`
      : `Promedio semanal: ${(total / avgWeeks).toFixed(1)}×`;
    const { start, end } = getHabitDetailRangeBounds(rangeKey);
    const totalRangeValue = getHabitMetricForRange(habit, start, end, goal === "time" ? "time" : "count");
    const totalLabel = goal === "time"
      ? `Total rango: ${formatMinutes(Math.round(totalRangeValue))}`
      : `Total rango: ${Math.round(totalRangeValue)}×`;
    const weekLabel = goal === "time" ? `Total semanal: ${formatMinutes(Math.round(weekTotal))}` : `Total semanal: ${Math.round(weekTotal)}×`;
    $habitDetailChartMeta.innerHTML = `
      <span>${avgLabel}</span>
      <span>${weekLabel}</span>
      <span>${totalLabel}</span>
    `;
  }
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
  todaySearchSnapshot = Array.from(panel.querySelectorAll("details")).map((detail) => ({
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
      const details = panel.querySelectorAll("details");
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

  const resetGroup = (wrap, list) => {
    if (list) list.innerHTML = "";
    if (wrap) {
      wrap.open = false; // siempre cerrado por defecto
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
    wrap.open = false; // forzar siempre plegado
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

  if ($habitTodaySearchInput?.value.trim()) {
    applyTodaySearch($habitTodaySearchInput.value);
  }
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
      return `Semana ${week} (${startDay}–${endDay} ${monthLabel} ${end.getFullYear()})`;
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

function getHabitMetricForDate(habit, dateKey, metric) {
  if (!habit || habit.archived) return 0;
  if (metric === "time") {
    return getSessionsForHabitDate(habit.id, dateKey).reduce((acc, s) => acc + minutesFromSession(s), 0);
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
        return parsed && isDateInRange(parsed, start, end) && (Number(byDate[key]) || 0) > 0;
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
  if (!hasData) return;

  const insights = document.createElement("div");
  insights.className = "habits-history-insights";

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
  qas.slice(0, 2).forEach((qa) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "habit-quick-add habit-time-btn";
    btn.style.width = "100%";
    btn.textContent = qa.label || `+${qa.minutes} min`;
    btn.title = "Añadir tiempo";
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const m = Math.round(Number(qa.minutes) || 0);
      if (m > 0) addHabitTimeSec(habit.id, today, m * 60);
      renderHabits();
    });
    col.appendChild(btn);
  });

  // 2) Input + botón “＋” en una fila (pero dentro de la columna)
  const inline = document.createElement("div");
  inline.className = "habit-quick-inline";
  inline.style.display = "flex";
  inline.style.gap = "1px";
  inline.style.alignItems = "center";

  const inp = document.createElement("input");
  inp.type = "number";
  inp.min = "1";
  inp.inputMode = "numeric";
  inp.placeholder = "+min";
  inp.className = "habit-quick-input";
  inp.style.flex = "1";
  inp.addEventListener("click", (e) => e.stopPropagation());

  const go = document.createElement("button");
  go.type = "button";
  go.className = "habit-quick-go habit-time-btn";
  go.textContent = "＋";
  go.title = "Sumar minutos";
  go.style.flex = "0 0 auto";
  go.addEventListener("click", (e) => {
    e.stopPropagation();
    const n = Number(inp.value);
    if (!Number.isFinite(n) || n <= 0) return;
    addHabitTimeSec(habit.id, today, Math.round(n * 60));
    inp.value = "";
    renderHabits();
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

  Object.entries(byDate).forEach(([dateKey, sec]) => {
    const parsed = parseDateKey(dateKey);
    if (parsed && isDateInRange(parsed, start, end)) {
      totalMinutes += Math.round((Number(sec) || 0) / 60);
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
    Object.entries(byDate).forEach(([key, sec]) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && (Number(sec) || 0) > 0) dates.add(key);
    });
  }

  return dates.size;
}


function minutesForRange(range) {
  const { start, end } = getRangeBounds(range);
  let total = 0;
  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.entries(byDate).forEach(([dateKey, sec]) => {
      const parsed = parseDateKey(dateKey);
      if (parsed && isDateInRange(parsed, start, end)) {
        total += Math.round((Number(sec) || 0) / 60);
      }
    });
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
    Object.entries(byDate).forEach(([key, sec]) => {
      const parsed = parseDateKey(key);
      if (parsed && isDateInRange(parsed, start, end) && (Number(sec) || 0) > 0) dates.add(key);
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
    Object.entries(byDate).forEach(([key, sec]) => {
      if ((Number(sec) || 0) > 0) dates.add(key);
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

  Object.entries(habitCounts).forEach(([habitId, entries]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    Object.keys(entries || {}).forEach((key) => {
      const parsed = parseDateKey(key);
      if (parsed && Number(entries[key]) > 0 && parsed < earliest) earliest = parsed;
    });
  });

  Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
    const habit = habits[habitId];
    if (!habit || habit.archived) return;
    if (!byDate || typeof byDate !== "object") return;
    Object.keys(byDate).forEach((key) => {
      const sec = Number(byDate[key]) || 0;
      if (sec <= 0) return;
      const parsed = parseDateKey(key);
      if (parsed && parsed < earliest) earliest = parsed;
    });
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
  const entries = buildTimeEntries(range);
  return aggregateEntries(entries, "habit")
    .map((item) => ({
      habit: item.habit,
      minutes: Math.round(item.totalSec / 60)
    }))
    .filter((item) => item.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes);
}

function buildTimeEntries(range) {
  const { start, end } = getRangeBounds(range);
  return activeHabitsWithSystem()
    .map((habit) => {
      const minutes = minutesForHabitRange(habit, start, end);
      return { habit, totalSec: Math.round(minutes * 60) };
    })
    .filter((item) => item.totalSec > 0);
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
    const pct = totalSec ? ((item.totalSec / totalSec) * 100) : 0;
    row.innerHTML = `
<span class="legend-dot">${idx + 1}º</span>
      <div class="legend-text">
        <div class="legend-name">${item.label}</div>
<div class="legend-meta">${pct.toFixed(2)}% · ${formatMinutes(Math.round(item.totalSec / 60))}</div>
      </div>
    `;
    $habitDonutLegend.appendChild(row);
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
        <span class="habit-kpi-value-line">Rango: ${rangeCount}</span>
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
      ? "Días contabilizados total"
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
        $habitPinTimeRange.textContent = `Rango: ${formatMinutes(rangeMinutes)} · ${rangeLabelTitle(habitDonutRange)}`;
      }
    } else {
      if ($habitPinTimeToday) {
        $habitPinTimeToday.textContent = `Rango: ${formatMinutes(rangeMinutes)} · ${rangeLabelTitle(habitDonutRange)}`;
      }
      if ($habitPinTimeRange) $habitPinTimeRange.textContent = `Hoy: ${formatMinutes(todayMinutes)}`;
    }
  } else {
    if ($habitPinTimeToday) $habitPinTimeToday.textContent = "—";
    if ($habitPinTimeRange) $habitPinTimeRange.textContent = "Selecciona un hábito de tiempo";
  }
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

function renderHabits() {
  renderSubtabs();
  renderToday();
  renderWeek();
  renderHistory();
  renderKPIs();
  renderPins();
  renderRecordsCard();
  renderDonutGroupOptions();
  renderDonut();
  renderLineChart();
  renderGlobalHeatmap();
  renderRanking();
  renderDaysAccordion();
  updateSessionUI();
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
  closeHabitModal();
  renderHabits();
}

function deleteHabit() {
  const id = $habitId.value;
  if (!id) return;
  openDeleteConfirm(id);
}

// Cronómetro
function startSession(habitId = null) {
  if (runningSession) return;

  const targetHabitId = (typeof habitId === "string" && habits?.[habitId] && !habits[habitId]?.archived)
    ? habitId
    : null;

  runningSession = { startTs: Date.now(), targetHabitId };
  saveRunningSession();
  updateSessionUI();
  sessionInterval = setInterval(updateSessionUI, 1000);
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
  const dateKey = dateKeyLocal(new Date(startTs));

  pendingSessionDuration = duration;
  runningSession = null;
  saveRunningSession();
  if (sessionInterval) clearInterval(sessionInterval);
  updateSessionUI();

  // Auto-asignación (Shortcuts / enlace)
  if (target && habits?.[target] && !habits[target]?.archived) {
    addHabitTimeSec(target, dateKey, duration);
    localStorage.setItem(LAST_HABIT_KEY, target);
    pendingSessionDuration = 0;
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
  const startTs = Date.now() - pendingSessionDuration * 1000;
  const dateKey = dateKeyLocal(new Date(startTs));
  addHabitTimeSec(habitId, dateKey, pendingSessionDuration);

  localStorage.setItem(LAST_HABIT_KEY, habitId);
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

  addHabitTimeSec(habitId, dateKey, Math.round(minutes * 60));
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
function bindEvents() {
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

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && $habitDetailOverlay && !$habitDetailOverlay.classList.contains("hidden")) {
      closeHabitDetail();
    }
  });

  $habitFabAdd?.addEventListener("click", () => openHabitModal());
  $habitForm?.querySelectorAll('input[name="habit-goal"]').forEach((r) => {
    r.addEventListener("change", updateHabitGoalUI);
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
  onValue(ref(db, HABITS_PATH), (snap) => {
    const val = snap.val() || {};
    habits = val;
    ensureUnknownHabit(true);
    if (_pendingShortcutCmd) {
      try {
        const ok = executeShortcutCmd(_pendingShortcutCmd, { silent: true });
        if (ok) _pendingShortcutCmd = null;
      } catch (_) {}
    }
    saveCache();
    renderHabits();
  });

  onValue(ref(db, HABIT_GROUPS_PATH), (snap) => {
    habitGroups = snap.val() || {};
    saveCache();
    renderHabits();
  });

  onValue(ref(db, HABIT_PREFS_PATH), (snap) => {
    habitPrefs = snap.val() || { pinCount: "", pinTime: "" };
    saveCache();
    renderPins();
  });

  onValue(ref(db, HABIT_CHECKS_PATH), (snap) => {
    habitChecks = snap.val() || {};
    saveCache();
    renderHabits();
  });

  onValue(ref(db, HABIT_COUNTS_PATH), (snap) => {
    habitCounts = snap.val() || {};
    saveCache();
    renderHabits();
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    try { window.__bookshellDashboard?.render?.(); } catch (_) {}
  });

  onValue(ref(db, HABIT_SESSIONS_PATH), (snap) => {
    const raw = snap.val() || {};
    const norm = normalizeSessionsStore(raw, true);
    habitSessions = norm.normalized;
    saveCache();
    renderHabits();
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    try { window.__bookshellDashboard?.render?.(); } catch (_) {}
  });
}

function goHabitSubtab(tab) {
  const allowed = new Set(["today", "week", "history", "reports"]);
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
  toggleSession,
  isRunning: () => !!runningSession
,
  getTimeShareByHabit: (range) => timeShareByHabit(range),
  rangeLabel
};
export function initHabits() {
  readCache();
  loadRunningSession();
  loadHeatmapYear();
  loadHistoryRange();
  ensureUnknownHabit(true);
  ensureSessionOverlayInBody();
  handleShortcutUrlOnce();
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
