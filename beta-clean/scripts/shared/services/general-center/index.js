import { auth, db, firebasePaths, getUserDataKey, onUserChange } from "../../firebase/index.js";
import {
  get,
  onValue,
  ref,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { resolveFinancePathCandidates } from "../../../modules/finance/finance/data.js";
import { createOfflinePushId, writeRtdbWithOfflineQueue } from "../../firebase/offline-rtdb.js";
import { applyQueuedWritesToPath } from "../../storage/offline-queue.js";
import { readModuleSnapshot, writeModuleSnapshot } from "../../storage/offline-snapshots.js";

const GENERAL_ROOT_SEGMENT = "meta/general";
const GENERAL_MODULE_SNAPSHOT = "general";
const GENERAL_BTN_ID = "app-general-btn";
const GENERAL_BACKDROP_ID = "app-general-backdrop";
const GENERAL_BODY_ID = "app-general-body";
const MODULE_CACHE_MAX_AGE_MS = 90 * 1000;
const EVALUATE_DEBOUNCE_MS = 220;
const SNAPSHOT_DEBOUNCE_MS = 140;

const MISSION_STATUS = Object.freeze({
  ACTIVE: "active",
  COMPLETED: "completed",
  ARCHIVED: "archived",
});

const TODO_FILTERS = Object.freeze([
  { key: "pending", label: "Pendientes" },
  { key: "completed", label: "Hechas" },
  { key: "all", label: "Todas" },
]);

const MISSION_FILTERS = Object.freeze([
  { key: "active", label: "Activas" },
  { key: "completed", label: "Completadas" },
  { key: "archived", label: "Archivadas" },
  { key: "all", label: "Todas" },
]);

const MISSION_CATEGORY_OPTIONS = Object.freeze([
  { key: "general", label: "General" },
  { key: "habits", label: "Hábitos" },
  { key: "recipes", label: "Recetas" },
  { key: "finance", label: "Finanzas" },
  { key: "videos", label: "Vídeos" },
  { key: "todo", label: "Tareas" },
]);

const PERIODICITY_OPTIONS = Object.freeze([
  { key: "once", label: "Largo plazo" },
  { key: "daily", label: "Diaria" },
  { key: "weekly", label: "Semanal" },
]);

const PRIORITY_OPTIONS = Object.freeze([
  { key: "low", label: "Baja" },
  { key: "medium", label: "Media" },
  { key: "high", label: "Alta" },
]);

const state = {
  initialized: false,
  uid: "",
  authUnsub: null,
  remoteUnsub: null,
  remoteHydrated: false,
  evaluateTimer: 0,
  snapshotTimer: 0,
  boundEvents: false,
  generalRoot: "",
  data: {
    missions: {},
    todos: {},
  },
  moduleSnapshots: {},
  autoMissionState: {},
  ui: {
    centerOpen: false,
    missionFilter: "active",
    composerOpen: false,
    composerMode: "automatic",
    missionDraft: null,
    editingMissionId: "",
  },
};

const AUTO_MISSION_DEFINITIONS = Object.freeze({
  habits_completed: {
    key: "habits_completed",
    category: "habits",
    label: "Hábitos completados",
    description: "Cuenta hábitos con actividad real.",
    periods: ["once", "daily", "weekly"],
    requiresEntity: false,
  },
  habit_hours: {
    key: "habit_hours",
    category: "habits",
    label: "Horas en un hábito",
    description: "Tiempo acumulado en un hábito concreto.",
    periods: ["once", "daily", "weekly"],
    requiresEntity: true,
    entityKind: "habit_time",
  },
  habit_count: {
    key: "habit_count",
    category: "habits",
    label: "Repeticiones de un hábito",
    description: "Conteo acumulado en un hábito de tipo contador.",
    periods: ["once", "daily", "weekly"],
    requiresEntity: true,
    entityKind: "habit_count",
  },
  recipes_cooks: {
    key: "recipes_cooks",
    category: "recipes",
    label: "Recetas cocinadas",
    description: "Preparaciones marcadas como cocinadas.",
    periods: ["once", "weekly"],
    requiresEntity: false,
  },
  finance_transactions: {
    key: "finance_transactions",
    category: "finance",
    label: "Gastos registrados",
    description: "Movimientos guardados en finanzas.",
    periods: ["once", "weekly"],
    requiresEntity: false,
  },
  videos_published: {
    key: "videos_published",
    category: "videos",
    label: "Vídeos publicados",
    description: "Vídeos marcados como publicados.",
    periods: ["once"],
    requiresEntity: false,
  },
  todo_completed: {
    key: "todo_completed",
    category: "todo",
    label: "Tareas completadas",
    description: "Tareas cerradas en la lista integrada.",
    periods: ["once", "daily", "weekly"],
    requiresEntity: false,
  },
  todo_pending_zero: {
    key: "todo_pending_zero",
    category: "todo",
    label: "Bandeja sin pendientes",
    description: "Mantener 0 tareas pendientes.",
    periods: ["once", "daily", "weekly"],
    requiresEntity: false,
    targetDefault: 1,
  },
});

function escapeHtml(value) {
  return String(value || "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "\"":
        return "&quot;";
      case "'":
        return "&#39;";
      default:
        return char;
    }
  });
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function formatDate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "—";
  try {
    return new Date(numeric).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch (_) {
    return "—";
  }
}

function formatShortDate(value) {
  const safeValue = String(value || "").trim();
  if (!safeValue) return "—";
  try {
    const date = /^\d{4}-\d{2}-\d{2}$/.test(safeValue)
      ? new Date(`${safeValue}T00:00:00`)
      : new Date(safeValue);
    if (Number.isNaN(date.getTime())) return safeValue;
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short",
    });
  } catch (_) {
    return safeValue;
  }
}

function formatNumber(value, { maxFractionDigits = 0 } = {}) {
  return Number(value || 0).toLocaleString("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxFractionDigits,
  });
}

function formatHours(value) {
  const numeric = Math.max(0, Number(value) || 0);
  return `${formatNumber(numeric, { maxFractionDigits: numeric < 10 ? 2 : 1 })} h`;
}

function getCurrentTimestamp() {
  return Date.now();
}

function dateToDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function getTodayDayKey() {
  return dateToDayKey(new Date());
}

function parseDayKey(value) {
  const safeValue = String(value || "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(safeValue);
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeDayKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return dateToDayKey(new Date(numeric));
}

function getStartOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

function getEndOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
}

function getStartOfWeek(date = new Date()) {
  const safeDate = getStartOfDay(date);
  const day = (safeDate.getDay() + 6) % 7;
  safeDate.setDate(safeDate.getDate() - day);
  return safeDate;
}

function getEndOfWeek(date = new Date()) {
  const start = getStartOfWeek(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
}

function isDayKeyWithinRange(dayKey, start, end) {
  const parsed = parseDayKey(dayKey);
  if (!parsed) return false;
  const ts = parsed.getTime();
  return ts >= start.getTime() && ts <= end.getTime();
}

function getPeriodBounds(periodicity = "once") {
  if (periodicity === "daily") {
    const today = new Date();
    return {
      start: getStartOfDay(today),
      end: getEndOfDay(today),
      cycleKey: getTodayDayKey(),
    };
  }

  if (periodicity === "weekly") {
    const now = new Date();
    const start = getStartOfWeek(now);
    const end = getEndOfWeek(now);
    return {
      start,
      end,
      cycleKey: `${dateToDayKey(start)}::${dateToDayKey(end)}`,
    };
  }

  return {
    start: null,
    end: null,
    cycleKey: "once",
  };
}

function getVisibleModalCount() {
  return document.querySelectorAll(
    ".modal-backdrop:not(.hidden), .nav-manage-backdrop:not(.hidden), .nav-compose-backdrop:not(.hidden)",
  ).length;
}

function syncBodyModalLock() {
  document.body.classList.toggle("has-open-modal", getVisibleModalCount() > 0);
}

function buildDefaultMissionDraft() {
  return {
    origin: "automatic",
    title: "",
    description: "",
    target: "3",
    periodicity: "daily",
    metricKey: "habits_completed",
    category: "general",
    entityId: "",
  };
}

function resolveGeneralAuthUid(value = state.uid) {
  const explicitAuthUid = String(value || "").trim();
  const currentUid = String(auth.currentUser?.uid || "").trim();
  if (explicitAuthUid && explicitAuthUid !== currentUid) return explicitAuthUid;
  return getUserDataKey(auth.currentUser) || explicitAuthUid;
}

function getGeneralRoot(uid = state.uid) {
  const authUid = resolveGeneralAuthUid(uid);
  return authUid ? firebasePaths.generalCenterRoot(authUid) : "";
}

function getMissionsRoot() {
  return `${state.generalRoot}/missions`;
}

function getTodosRoot() {
  return `${state.generalRoot}/todos`;
}

function getMissionPath(missionId = "") {
  const safeId = String(missionId || "").trim();
  return safeId ? `${getMissionsRoot()}/${safeId}` : "";
}

function getTodoPath(todoId = "") {
  const safeId = String(todoId || "").trim();
  return safeId ? `${getTodosRoot()}/${safeId}` : "";
}

function createEntityId(path) {
  return createOfflinePushId(path) || `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeMission(raw = {}, missionId = "") {
  const safeId = String(raw.id || missionId || "").trim();
  if (!safeId) return null;
  const target = Math.max(1, Math.round(toNumber(raw.target) || 1));
  const origin = raw.origin === "automatic" ? "automatic" : "manual";
  const periodicity = ["once", "daily", "weekly"].includes(raw.periodicity) ? raw.periodicity : "once";
  const status = Object.values(MISSION_STATUS).includes(raw.status) ? raw.status : MISSION_STATUS.ACTIVE;
  return {
    id: safeId,
    title: String(raw.title || "").trim(),
    description: String(raw.description || "").trim(),
    category: String(raw.category || "general").trim() || "general",
    target,
    progress: Math.max(0, Math.round(toNumber(raw.progress) || 0)),
    status,
    createdAt: Number(raw.createdAt) || getCurrentTimestamp(),
    updatedAt: Number(raw.updatedAt) || 0,
    completedAt: Number(raw.completedAt) || 0,
    archivedAt: Number(raw.archivedAt) || 0,
    periodicity,
    origin,
    metricKey: String(raw.metricKey || "").trim(),
    entityId: String(raw.entityId || "").trim(),
    entityName: String(raw.entityName || "").trim(),
    baselineValue: Math.max(0, toNumber(raw.baselineValue)),
    completedCycleKey: String(raw.completedCycleKey || "").trim(),
    order: Math.max(0, Math.round(toNumber(raw.order) || 0)),
  };
}

function normalizeTodo(raw = {}, todoId = "", fallbackOrder = 0) {
  const safeId = String(raw.id || todoId || "").trim();
  if (!safeId) return null;
  return {
    id: safeId,
    title: String(raw.title || raw.text || "").trim(),
    completed: Boolean(raw.completed),
    createdAt: Number(raw.createdAt) || getCurrentTimestamp(),
    updatedAt: Number(raw.updatedAt) || 0,
    completedAt: Number(raw.completedAt) || 0,
    order: Math.max(0, Math.round(toNumber(raw.order) || fallbackOrder)),
    category: String(raw.category || raw.list || raw.project || "").trim(),
    dueDate: String(raw.dueDate || raw.targetDate || "").trim(),
    priority: ["low", "medium", "high"].includes(raw.priority) ? raw.priority : "medium",
  };
}

function normalizeGeneralPayload(payload = {}) {
  const rawMissions = payload?.missions && typeof payload.missions === "object" ? payload.missions : {};
  const rawTodos = payload?.todos && typeof payload.todos === "object" ? payload.todos : {};
  const missions = {};
  const todos = {};

  Object.entries(rawMissions).forEach(([missionId, rawMission], index) => {
    const mission = normalizeMission(rawMission, missionId);
    if (!mission) return;
    mission.order = Math.max(0, mission.order || index);
    missions[mission.id] = mission;
  });

  Object.entries(rawTodos).forEach(([todoId, rawTodo], index) => {
    const todo = normalizeTodo(rawTodo, todoId, index);
    if (!todo || !todo.title) return;
    todos[todo.id] = todo;
  });

  return { missions, todos };
}

function cloneData() {
  return {
    missions: { ...state.data.missions },
    todos: { ...state.data.todos },
  };
}

function scheduleOfflineSnapshotPersist() {
  if (!state.uid || typeof window === "undefined") return;
  window.clearTimeout(state.snapshotTimer);
  state.snapshotTimer = window.setTimeout(() => {
    void writeModuleSnapshot({
      moduleName: GENERAL_MODULE_SNAPSHOT,
      uid: state.uid,
      data: cloneData(),
      updatedAt: Date.now(),
      metadata: {
        missionCount: Object.keys(state.data.missions || {}).length,
        todoCount: Object.keys(state.data.todos || {}).length,
      },
    }).catch((error) => {
      console.warn("[general] no se pudo persistir snapshot offline", error);
    });
  }, SNAPSHOT_DEBOUNCE_MS);
}

async function hydrateGeneralFromOfflineSnapshot(uid = state.uid) {
  if (!uid) return false;
  try {
    const snapshot = await readModuleSnapshot({ moduleName: GENERAL_MODULE_SNAPSHOT, uid });
    if (!snapshot?.data) return false;
    state.data = normalizeGeneralPayload(snapshot.data);
    return true;
  } catch (error) {
    console.warn("[general] no se pudo rehidratar snapshot offline", error);
    return false;
  }
}

function upsertLocalMission(mission) {
  if (!mission?.id) return null;
  state.data.missions = {
    ...state.data.missions,
    [mission.id]: normalizeMission(mission, mission.id),
  };
  scheduleOfflineSnapshotPersist();
  renderGeneralButton();
  renderGeneralCenter();
  scheduleAutomaticMissionEvaluation();
  return state.data.missions[mission.id];
}

function removeLocalMission(missionId = "") {
  const safeId = String(missionId || "").trim();
  if (!safeId || !state.data.missions[safeId]) return;
  const next = { ...state.data.missions };
  delete next[safeId];
  state.data.missions = next;
  delete state.autoMissionState[safeId];
  scheduleOfflineSnapshotPersist();
  renderGeneralButton();
  renderGeneralCenter();
}

function upsertLocalTodo(todo) {
  if (!todo?.id) return null;
  state.data.todos = {
    ...state.data.todos,
    [todo.id]: normalizeTodo(todo, todo.id, Object.keys(state.data.todos).length),
  };
  scheduleOfflineSnapshotPersist();
  renderGeneralButton();
  renderGeneralCenter();
  scheduleAutomaticMissionEvaluation();
  return state.data.todos[todo.id];
}

function removeLocalTodo(todoId = "") {
  const safeId = String(todoId || "").trim();
  if (!safeId || !state.data.todos[safeId]) return;
  const next = { ...state.data.todos };
  delete next[safeId];
  state.data.todos = next;
  scheduleOfflineSnapshotPersist();
  renderGeneralButton();
  renderGeneralCenter();
  scheduleAutomaticMissionEvaluation();
}

async function persistMission(mission) {
  if (!state.uid || !mission?.id) return;
  await writeRtdbWithOfflineQueue({
    uid: state.uid,
    module: "general",
    entityType: "mission",
    actionType: "upsert-mission",
    firebasePath: getMissionPath(mission.id),
    payload: mission,
    writeType: "set",
    dedupeKey: `general-mission:${mission.id}`,
    metadata: { missionId: mission.id },
  });
}

async function deleteMissionRemote(missionId = "") {
  if (!state.uid || !missionId) return;
  await writeRtdbWithOfflineQueue({
    uid: state.uid,
    module: "general",
    entityType: "mission",
    actionType: "delete-mission",
    firebasePath: getMissionPath(missionId),
    payload: null,
    writeType: "set",
    dedupeKey: `general-mission:${missionId}`,
    metadata: { missionId },
  });
}

async function persistTodo(todo) {
  if (!state.uid || !todo?.id) return;
  await writeRtdbWithOfflineQueue({
    uid: state.uid,
    module: "general",
    entityType: "todo",
    actionType: "upsert-todo",
    firebasePath: getTodoPath(todo.id),
    payload: todo,
    writeType: "set",
    dedupeKey: `general-todo:${todo.id}`,
    metadata: { todoId: todo.id },
  });
}

async function deleteTodoRemote(todoId = "") {
  if (!state.uid || !todoId) return;
  await writeRtdbWithOfflineQueue({
    uid: state.uid,
    module: "general",
    entityType: "todo",
    actionType: "delete-todo",
    firebasePath: getTodoPath(todoId),
    payload: null,
    writeType: "set",
    dedupeKey: `general-todo:${todoId}`,
    metadata: { todoId },
  });
}

function getLiveModuleSnapshot(moduleKey = "") {
  switch (moduleKey) {
    case "habits":
      return window.__bookshellHabits?.getAchievementsSnapshot?.() || null;
    case "recipes":
      return window.__bookshellRecipes?.getAchievementsSnapshot?.() || null;
    case "finance":
      return window.__bookshellFinance?.getAchievementsSnapshot?.() || null;
    case "videos":
      return window.__bookshellVideosHub?.getAchievementsSnapshot?.() || null;
    default:
      return null;
  }
}

async function fetchRemoteModuleSnapshot(moduleKey = "") {
  const authUid = resolveGeneralAuthUid();
  if (!authUid) return null;
  switch (moduleKey) {
    case "habits": {
      const snapshot = await get(ref(db, firebasePaths.habitsRoot(authUid)));
      return snapshot.val() || {};
    }
    case "recipes": {
      const snapshot = await get(ref(db, firebasePaths.recipesRoot(authUid)));
      return snapshot.val() || {};
    }
    case "finance": {
      const [primaryPath, legacyPath] = resolveFinancePathCandidates(authUid);
      const [primarySnap, legacySnap] = await Promise.all([
        get(ref(db, primaryPath)),
        primaryPath === legacyPath ? Promise.resolve({ val: () => ({}) }) : get(ref(db, legacyPath)),
      ]);
      const primary = primarySnap.val() || {};
      const legacy = legacySnap.val() || {};
      return {
        accounts: {
          ...((legacy.accounts && typeof legacy.accounts === "object") ? legacy.accounts : {}),
          ...((primary.accounts && typeof primary.accounts === "object") ? primary.accounts : {}),
        },
        transactions: {
          ...(((legacy.balance && (legacy.balance.transactions || legacy.balance.tx2)) || legacy.transactions || {})),
          ...(((primary.balance && (primary.balance.transactions || primary.balance.tx2)) || primary.transactions || {})),
        },
      };
    }
    case "videos": {
      const snapshot = await get(ref(db, firebasePaths.videosHubVideos(authUid)));
      return snapshot.val() || {};
    }
    default:
      return null;
  }
}

function writeCachedModuleSnapshot(moduleKey = "", snapshot = null, source = "live") {
  const safeModule = String(moduleKey || "").trim();
  if (!safeModule) return null;
  state.moduleSnapshots[safeModule] = {
    snapshot: snapshot || {},
    source,
    updatedAt: Date.now(),
  };
  return state.moduleSnapshots[safeModule].snapshot;
}

async function ensureModuleSnapshot(moduleKey = "", { forceRemote = false } = {}) {
  const safeModule = String(moduleKey || "").trim();
  if (!safeModule) return null;
  const cached = state.moduleSnapshots[safeModule];
  if (!forceRemote && cached && (Date.now() - Number(cached.updatedAt || 0)) < MODULE_CACHE_MAX_AGE_MS) {
    return cached.snapshot;
  }

  if (!forceRemote) {
    const liveSnapshot = getLiveModuleSnapshot(safeModule);
    if (liveSnapshot) {
      return writeCachedModuleSnapshot(safeModule, liveSnapshot, "live");
    }
  }

  try {
    const remoteSnapshot = await fetchRemoteModuleSnapshot(safeModule);
    return writeCachedModuleSnapshot(safeModule, remoteSnapshot, "remote");
  } catch (error) {
    console.warn(`[general] no se pudo cargar ${safeModule}`, error);
    return cached?.snapshot || null;
  }
}

function getHabitGoalType(habit = {}) {
  const goal = String(habit?.goal || "check").trim().toLowerCase();
  if (goal === "time" || goal === "count") return goal;
  return "check";
}

function isTrackableHabit(habit = {}) {
  return Boolean(habit) && !habit.system;
}

function getHabitSessionSeconds(value) {
  if (typeof value === "number") return Math.max(0, Math.round(value));
  if (!value || typeof value !== "object") return 0;
  const totalSec = Math.max(0, Math.round(toNumber(value.totalSec)));
  if (totalSec > 0) return totalSec;
  const minutes = Math.max(0, toNumber(value.min));
  if (minutes > 0) return Math.round(minutes * 60);
  const durationSec = Math.max(0, Math.round(toNumber(value.durationSec)));
  return durationSec;
}

function getHabitsSnapshotParts(snapshot = {}) {
  return {
    habits: snapshot?.habits && typeof snapshot.habits === "object" ? snapshot.habits : {},
    habitChecks: snapshot?.habitChecks && typeof snapshot.habitChecks === "object" ? snapshot.habitChecks : {},
    habitCounts: snapshot?.habitCounts && typeof snapshot.habitCounts === "object" ? snapshot.habitCounts : {},
    habitSessions: snapshot?.habitSessions && typeof snapshot.habitSessions === "object" ? snapshot.habitSessions : {},
  };
}

function hasHabitActivityOnDay(snapshot = {}, habitId = "", dayKey = "") {
  const { habitChecks, habitCounts, habitSessions } = getHabitsSnapshotParts(snapshot);
  if ((habitChecks?.[habitId] || {})[dayKey]) return true;
  if (toNumber((habitCounts?.[habitId] || {})[dayKey]) > 0) return true;
  return getHabitSessionSeconds((habitSessions?.[habitId] || {})[dayKey]) > 0;
}

function countHabitCompletions(snapshot = {}, { periodicity = "once" } = {}) {
  const { habits, habitChecks, habitCounts, habitSessions } = getHabitsSnapshotParts(snapshot);
  const bounds = getPeriodBounds(periodicity);
  const trackableIds = Object.entries(habits)
    .filter(([, habit]) => isTrackableHabit(habit) && !habit.archived)
    .map(([habitId]) => habitId);

  if (periodicity === "daily") {
    return trackableIds.reduce((sum, habitId) => sum + (hasHabitActivityOnDay(snapshot, habitId, bounds.cycleKey) ? 1 : 0), 0);
  }

  let total = 0;
  trackableIds.forEach((habitId) => {
    const dayKeys = new Set();
    Object.entries(habitChecks?.[habitId] || {}).forEach(([dayKey, value]) => {
      if (!value) return;
      if (periodicity === "weekly" && !isDayKeyWithinRange(dayKey, bounds.start, bounds.end)) return;
      dayKeys.add(dayKey);
    });
    Object.entries(habitCounts?.[habitId] || {}).forEach(([dayKey, value]) => {
      if (toNumber(value) <= 0) return;
      if (periodicity === "weekly" && !isDayKeyWithinRange(dayKey, bounds.start, bounds.end)) return;
      dayKeys.add(dayKey);
    });
    Object.entries(habitSessions?.[habitId] || {}).forEach(([dayKey, value]) => {
      if (getHabitSessionSeconds(value) <= 0) return;
      if (periodicity === "weekly" && !isDayKeyWithinRange(dayKey, bounds.start, bounds.end)) return;
      dayKeys.add(dayKey);
    });
    total += dayKeys.size;
  });

  return total;
}

function sumHabitHours(snapshot = {}, habitId = "", { periodicity = "once" } = {}) {
  if (!habitId) return 0;
  const { habitSessions } = getHabitsSnapshotParts(snapshot);
  const bounds = getPeriodBounds(periodicity);
  let totalSeconds = 0;
  Object.entries(habitSessions?.[habitId] || {}).forEach(([dayKey, value]) => {
    if (periodicity !== "once" && !isDayKeyWithinRange(dayKey, bounds.start, bounds.end)) return;
    totalSeconds += getHabitSessionSeconds(value);
  });
  return Number((totalSeconds / 3600).toFixed(4));
}

function sumHabitCounts(snapshot = {}, habitId = "", { periodicity = "once" } = {}) {
  if (!habitId) return 0;
  const { habitCounts } = getHabitsSnapshotParts(snapshot);
  const bounds = getPeriodBounds(periodicity);
  let total = 0;
  Object.entries(habitCounts?.[habitId] || {}).forEach(([dayKey, value]) => {
    if (periodicity !== "once" && !isDayKeyWithinRange(dayKey, bounds.start, bounds.end)) return;
    total += Math.max(0, toNumber(value));
  });
  return Math.round(total);
}

function collectRecipeCookEntries(snapshot = {}) {
  const recipesRoot = snapshot?.recipes && typeof snapshot.recipes === "object" ? snapshot.recipes : snapshot;
  const entries = [];
  Object.values(recipesRoot || {}).forEach((recipe) => {
    if (!recipe || typeof recipe !== "object") return;
    const id = String(recipe.id || recipe.title || "").trim();
    (Array.isArray(recipe.cookedDates) ? recipe.cookedDates : []).forEach((dayKey) => {
      const safeDay = normalizeDayKey(dayKey);
      if (safeDay) entries.push(`${id}::${safeDay}`);
    });
    const lastCooked = normalizeDayKey(recipe.lastCooked);
    if (lastCooked) entries.push(`${id}::${lastCooked}`);
  });
  return Array.from(new Set(entries));
}

function countRecipeCooks(snapshot = {}, { periodicity = "once" } = {}) {
  const bounds = getPeriodBounds(periodicity);
  return collectRecipeCookEntries(snapshot).filter((entry) => {
    if (periodicity === "once") return true;
    const [, dayKey] = entry.split("::");
    return isDayKeyWithinRange(dayKey, bounds.start, bounds.end);
  }).length;
}

function getFinanceTrackingKey(row = {}) {
  return [
    row?.day,
    row?.date,
    row?.monthDay,
    row?.createdAt,
    row?.updatedAt,
    row?.ts,
  ].map(normalizeDayKey).find(Boolean) || "";
}

function countFinanceTransactions(snapshot = {}, { periodicity = "once" } = {}) {
  const transactions = snapshot?.transactions && typeof snapshot.transactions === "object" ? snapshot.transactions : {};
  const bounds = getPeriodBounds(periodicity);
  return Object.values(transactions).filter((row) => {
    if (periodicity === "once") return true;
    const dayKey = getFinanceTrackingKey(row);
    return dayKey ? isDayKeyWithinRange(dayKey, bounds.start, bounds.end) : false;
  }).length;
}

function countPublishedVideos(snapshot = {}) {
  const videos = snapshot && typeof snapshot === "object" ? Object.values(snapshot) : [];
  return videos.filter((video) => String(video?.status || "").trim().toLowerCase() === "published").length;
}

function countCompletedTodos({ periodicity = "once", createdAt = 0 } = {}) {
  const todos = Object.values(state.data.todos || {});
  const bounds = getPeriodBounds(periodicity);
  return todos.filter((todo) => {
    if (!todo.completed || !todo.completedAt) return false;
    if (periodicity === "daily") {
      return normalizeDayKey(todo.completedAt) === bounds.cycleKey;
    }
    if (periodicity === "weekly") {
      return isDayKeyWithinRange(normalizeDayKey(todo.completedAt), bounds.start, bounds.end);
    }
    return Number(todo.completedAt || 0) >= Number(createdAt || 0);
  }).length;
}

function computePendingTodoZero() {
  const pending = Object.values(state.data.todos || {}).filter((todo) => !todo.completed).length;
  return pending === 0 ? 1 : 0;
}

function getAutoMissionDefinition(metricKey = "") {
  return AUTO_MISSION_DEFINITIONS[String(metricKey || "").trim()] || null;
}

async function resolveAutomaticMissionAbsoluteValue(mission) {
  const definition = getAutoMissionDefinition(mission.metricKey);
  if (!definition) return 0;

  switch (mission.metricKey) {
    case "habits_completed": {
      const snapshot = await ensureModuleSnapshot("habits");
      return countHabitCompletions(snapshot || {}, { periodicity: mission.periodicity });
    }
    case "habit_hours": {
      const snapshot = await ensureModuleSnapshot("habits");
      return sumHabitHours(snapshot || {}, mission.entityId, { periodicity: mission.periodicity });
    }
    case "habit_count": {
      const snapshot = await ensureModuleSnapshot("habits");
      return sumHabitCounts(snapshot || {}, mission.entityId, { periodicity: mission.periodicity });
    }
    case "recipes_cooks": {
      const snapshot = await ensureModuleSnapshot("recipes");
      return countRecipeCooks(snapshot || {}, { periodicity: mission.periodicity });
    }
    case "finance_transactions": {
      const snapshot = await ensureModuleSnapshot("finance");
      return countFinanceTransactions(snapshot || {}, { periodicity: mission.periodicity });
    }
    case "videos_published": {
      const snapshot = await ensureModuleSnapshot("videos");
      return countPublishedVideos(snapshot || {});
    }
    case "todo_completed":
      return countCompletedTodos({ periodicity: mission.periodicity, createdAt: mission.createdAt });
    case "todo_pending_zero":
      return computePendingTodoZero();
    default:
      return 0;
  }
}

function deriveAutomaticMissionProgress(mission, absoluteValue) {
  if (mission.metricKey === "todo_pending_zero") {
    return absoluteValue > 0 ? 1 : 0;
  }
  if (mission.periodicity === "once") {
    return Math.max(0, absoluteValue - Math.max(0, toNumber(mission.baselineValue)));
  }
  return Math.max(0, absoluteValue);
}

function getMissionPeriodLabel(periodicity = "once") {
  if (periodicity === "daily") return "hoy";
  if (periodicity === "weekly") return "esta semana";
  return "a largo plazo";
}

function getMissionCategoryLabel(category = "") {
  return MISSION_CATEGORY_OPTIONS.find((option) => option.key === category)?.label || "General";
}

async function evaluateAutomaticMission(mission) {
  const absoluteValue = await resolveAutomaticMissionAbsoluteValue(mission);
  const progress = deriveAutomaticMissionProgress(mission, absoluteValue);
  const bounds = getPeriodBounds(mission.periodicity);
  const status = progress >= mission.target ? MISSION_STATUS.COMPLETED : MISSION_STATUS.ACTIVE;
  return {
    absoluteValue,
    progress,
    progressPct: mission.target > 0 ? Math.max(0, Math.min(100, Math.round((progress / mission.target) * 100))) : 0,
    status,
    cycleKey: bounds.cycleKey,
  };
}

async function syncAutomaticMissionCompletion(mission, autoState) {
  if (!mission || mission.origin !== "automatic" || !autoState) return;

  const shouldMarkCompleted = autoState.status === MISSION_STATUS.COMPLETED
    && (
      mission.periodicity === "once"
        ? !mission.completedAt
        : mission.completedCycleKey !== autoState.cycleKey
    );

  if (!shouldMarkCompleted) return;

  const nextMission = normalizeMission({
    ...mission,
    status: MISSION_STATUS.COMPLETED,
    completedAt: Date.now(),
    completedCycleKey: autoState.cycleKey,
    updatedAt: Date.now(),
  }, mission.id);
  upsertLocalMission(nextMission);
  try {
    await persistMission(nextMission);
  } catch (error) {
    console.warn("[general] no se pudo guardar el completado automático", error);
  }
}

async function evaluateAutomaticMissions({ forceFetch = false } = {}) {
  const missions = Object.values(state.data.missions || {})
    .filter((mission) => mission.origin === "automatic" && mission.status !== MISSION_STATUS.ARCHIVED);

  if (!missions.length) {
    state.autoMissionState = {};
    renderGeneralButton();
    renderGeneralCenter();
    return;
  }

  if (forceFetch) {
    const neededModules = Array.from(new Set(
      missions
        .map((mission) => getAutoMissionDefinition(mission.metricKey)?.category)
        .map((category) => (category === "todo" ? "" : category))
        .filter(Boolean),
    ));
    await Promise.all(neededModules.map((moduleKey) => ensureModuleSnapshot(moduleKey, { forceRemote: true })));
  }

  const entries = await Promise.all(missions.map(async (mission) => {
    const evaluated = await evaluateAutomaticMission(mission);
    return [mission.id, evaluated];
  }));

  state.autoMissionState = Object.fromEntries(entries);
  renderGeneralButton();
  renderGeneralCenter();

  await Promise.all(missions.map((mission) => syncAutomaticMissionCompletion(mission, state.autoMissionState[mission.id])));
}

function scheduleAutomaticMissionEvaluation({ forceFetch = false } = {}) {
  window.clearTimeout(state.evaluateTimer);
  state.evaluateTimer = window.setTimeout(() => {
    void evaluateAutomaticMissions({ forceFetch });
  }, EVALUATE_DEBOUNCE_MS);
}

function syncDraftsFromDom() {
  if (!state.ui.centerOpen) return;

  const missionForm = document.querySelector("[data-general-mission-form]");
  if (missionForm) {
    state.ui.missionDraft = {
      origin: missionForm.querySelector("[name=\"mission-origin\"]")?.value || state.ui.missionDraft?.origin || "automatic",
      title: missionForm.querySelector("[name=\"mission-title\"]")?.value || "",
      description: missionForm.querySelector("[name=\"mission-description\"]")?.value || "",
      target: missionForm.querySelector("[name=\"mission-target\"]")?.value || "",
      periodicity: missionForm.querySelector("[name=\"mission-periodicity\"]")?.value || "once",
      metricKey: missionForm.querySelector("[name=\"mission-metric\"]")?.value || "",
      category: missionForm.querySelector("[name=\"mission-category\"]")?.value || "general",
      entityId: missionForm.querySelector("[name=\"mission-entity\"]")?.value || "",
    };
  }

  const todoForm = document.querySelector("[data-general-todo-form]");
  if (todoForm) {
    state.ui.todoDraft = {
      title: todoForm.querySelector("[name=\"todo-title\"]")?.value || "",
      category: todoForm.querySelector("[name=\"todo-category\"]")?.value || "",
      dueDate: todoForm.querySelector("[name=\"todo-due-date\"]")?.value || "",
      priority: todoForm.querySelector("[name=\"todo-priority\"]")?.value || "medium",
    };
  }
}

function getDerivedMissionState(mission) {
  if (!mission) return null;
  if (mission.status === MISSION_STATUS.ARCHIVED || mission.archivedAt) {
    return {
      ...mission,
      progress: mission.origin === "automatic" ? (state.autoMissionState[mission.id]?.progress || 0) : mission.progress,
      progressPct: mission.target > 0
        ? Math.max(0, Math.min(100, Math.round(((mission.origin === "automatic" ? (state.autoMissionState[mission.id]?.progress || 0) : mission.progress) / mission.target) * 100)))
        : 0,
      displayStatus: MISSION_STATUS.ARCHIVED,
    };
  }

  if (mission.origin === "automatic") {
    const autoState = state.autoMissionState[mission.id] || {
      progress: 0,
      progressPct: 0,
      status: mission.status,
      cycleKey: getPeriodBounds(mission.periodicity).cycleKey,
    };
    let displayStatus = autoState.status;
    if (mission.periodicity !== "once" && autoState.status === MISSION_STATUS.COMPLETED && mission.completedCycleKey !== autoState.cycleKey) {
      displayStatus = MISSION_STATUS.ACTIVE;
    }
    return {
      ...mission,
      progress: autoState.progress,
      progressPct: autoState.progressPct,
      displayStatus,
    };
  }

  const progress = Math.max(0, mission.progress || 0);
  const displayStatus = mission.status === MISSION_STATUS.COMPLETED || progress >= mission.target
    ? MISSION_STATUS.COMPLETED
    : MISSION_STATUS.ACTIVE;
  return {
    ...mission,
    progress,
    progressPct: mission.target > 0 ? Math.max(0, Math.min(100, Math.round((progress / mission.target) * 100))) : 0,
    displayStatus,
  };
}

function getVisibleMissions() {
  return Object.values(state.data.missions || {})
    .map((mission) => getDerivedMissionState(mission))
    .filter(Boolean)
    .filter((mission) => {
      if (state.ui.missionFilter === "all") return true;
      return mission.displayStatus === state.ui.missionFilter;
    })
    .sort((a, b) => {
      const statusOrder = {
        [MISSION_STATUS.ACTIVE]: 0,
        [MISSION_STATUS.COMPLETED]: 1,
        [MISSION_STATUS.ARCHIVED]: 2,
      };
      if (statusOrder[a.displayStatus] !== statusOrder[b.displayStatus]) {
        return statusOrder[a.displayStatus] - statusOrder[b.displayStatus];
      }
      if (a.order !== b.order) return a.order - b.order;
      return b.createdAt - a.createdAt;
    });
}

function buildSummary() {
  const missions = Object.values(state.data.missions || {}).map((mission) => getDerivedMissionState(mission)).filter(Boolean);
  return {
    activeMissionCount: missions.filter((mission) => mission.displayStatus === MISSION_STATUS.ACTIVE).length,
    completedMissionCount: missions.filter((mission) => mission.displayStatus === MISSION_STATUS.COMPLETED).length,
    archivedMissionCount: missions.filter((mission) => mission.displayStatus === MISSION_STATUS.ARCHIVED).length,
  };
}

function ensureGeneralButton() {
  let button = document.getElementById(GENERAL_BTN_ID);
  if (button) return button;

  const indicator = document.querySelector(".app-sync-indicator");
  if (!indicator) return null;
  let actions = indicator.querySelector(".app-sync-indicator__actions");
  if (!actions) {
    actions = document.createElement("span");
    actions.className = "app-sync-indicator__actions";
    indicator.append(actions);
  }

  button = document.createElement("button");
  button.id = GENERAL_BTN_ID;
  button.className = "app-general-btn hidden";
  button.type = "button";
  button.setAttribute("aria-label", "Abrir centro general");
  button.setAttribute("title", "General");
  button.innerHTML = `
    <span class="app-general-btn__icon" aria-hidden="true">✦</span>
    <span class="app-general-btn__text">General</span>
  `;

  actions.appendChild(button);
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (state.ui.centerOpen) closeGeneralCenter();
    else openGeneralCenter();
  });
  return button;
}

function ensureGeneralModal() {
  let backdrop = document.getElementById(GENERAL_BACKDROP_ID);
  if (backdrop) return backdrop;

  backdrop = document.createElement("div");
  backdrop.id = GENERAL_BACKDROP_ID;
  backdrop.className = "modal-backdrop app-general-backdrop hidden";
  backdrop.setAttribute("aria-hidden", "true");
  backdrop.innerHTML = `
    <section class="modal app-general-modal" role="dialog" aria-modal="true" aria-labelledby="app-general-title">
      <header class="modal-header app-general-modal__header">
        <div>
          <div class="app-general-modal__eyebrow">General</div>
          <div class="modal-title" id="app-general-title">Misiones y tareas</div>
        </div>
        <button class="btn-x app-general-modal__close" type="button" aria-label="Cerrar general" data-general-close>✕</button>
      </header>
      <div class="modal-body app-general-modal__body" id="${GENERAL_BODY_ID}"></div>
    </section>
  `;

  document.body.appendChild(backdrop);
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop || event.target?.closest?.("[data-general-close]")) {
      closeGeneralCenter();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.ui.centerOpen) {
      closeGeneralCenter();
    }
  });

  return backdrop;
}

function openGeneralCenter() {
  const backdrop = ensureGeneralModal();
  if (!backdrop) return;
  state.ui.centerOpen = true;
  backdrop.classList.remove("hidden");
  backdrop.setAttribute("aria-hidden", "false");
  syncBodyModalLock();
  renderGeneralCenter();
  scheduleAutomaticMissionEvaluation({ forceFetch: true });
}

function closeGeneralCenter() {
  syncDraftsFromDom();
  const backdrop = document.getElementById(GENERAL_BACKDROP_ID);
  state.ui.centerOpen = false;
  if (backdrop) {
    backdrop.classList.add("hidden");
    backdrop.setAttribute("aria-hidden", "true");
  }
  syncBodyModalLock();
}

function renderFilterGroup(options = [], activeKey = "", datasetKey = "") {
  return `
    <div class="app-general-filters">
      ${options.map((option) => `
        <button
          class="app-general-filter${option.key === activeKey ? " is-active" : ""}"
          type="button"
          data-${datasetKey}="${escapeHtml(option.key)}"
        >${escapeHtml(option.label)}</button>
      `).join("")}
    </div>
  `;
}

function getMetricDefinitionsList() {
  return Object.values(AUTO_MISSION_DEFINITIONS);
}

function getHabitsForMetric(metricKey = "") {
  const habitsSnapshot = state.moduleSnapshots.habits?.snapshot || getLiveModuleSnapshot("habits") || {};
  const habits = habitsSnapshot?.habits && typeof habitsSnapshot.habits === "object" ? habitsSnapshot.habits : {};
  const safeMetricKey = String(metricKey || "").trim();
  return Object.entries(habits)
    .filter(([, habit]) => isTrackableHabit(habit) && !habit.archived)
    .filter(([, habit]) => {
      if (safeMetricKey === "habit_hours") return getHabitGoalType(habit) === "time";
      if (safeMetricKey === "habit_count") return getHabitGoalType(habit) === "count";
      return true;
    })
    .map(([habitId, habit]) => ({
      id: habitId,
      label: `${String(habit?.emoji || "").trim() || "🏷️"} ${String(habit?.name || "Hábito").trim() || "Hábito"}`,
      name: String(habit?.name || "Hábito").trim() || "Hábito",
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
}

function buildAutomaticMissionTitle(draft) {
  const definition = getAutoMissionDefinition(draft.metricKey);
  if (!definition) return "Misión automática";

  const target = Math.max(1, Math.round(toNumber(draft.target) || definition.targetDefault || 1));
  const periodLabel = getMissionPeriodLabel(draft.periodicity);
  if (draft.metricKey === "habits_completed") {
    return `Completa ${target} hábito${target === 1 ? "" : "s"} ${periodLabel}`;
  }
  if (draft.metricKey === "habit_hours") {
    const habit = getHabitsForMetric("habit_hours").find((entry) => entry.id === draft.entityId);
    const name = habit?.name || draft.entityName || "el hábito";
    return `Suma ${target} h en ${name} ${periodLabel}`;
  }
  if (draft.metricKey === "habit_count") {
    const habit = getHabitsForMetric("habit_count").find((entry) => entry.id === draft.entityId);
    const name = habit?.name || draft.entityName || "el hábito";
    return `Registra ${target} repeticiones en ${name} ${periodLabel}`;
  }
  if (draft.metricKey === "recipes_cooks") {
    return `Cocina ${target} receta${target === 1 ? "" : "s"} ${periodLabel}`;
  }
  if (draft.metricKey === "finance_transactions") {
    return `Registra ${target} gasto${target === 1 ? "" : "s"} ${periodLabel}`;
  }
  if (draft.metricKey === "videos_published") {
    return `Publica ${target} vídeo${target === 1 ? "" : "s"}`;
  }
  if (draft.metricKey === "todo_completed") {
    return `Completa ${target} tarea${target === 1 ? "" : "s"} ${periodLabel}`;
  }
  if (draft.metricKey === "todo_pending_zero") {
    return periodLabel === "a largo plazo"
      ? "Mantén la bandeja sin pendientes"
      : `Mantén 0 pendientes ${periodLabel}`;
  }
  return definition.label;
}

function renderMissionComposer() {
  const draft = state.ui.missionDraft || buildDefaultMissionDraft();
  const definition = getAutoMissionDefinition(draft.metricKey);
  const metricOptions = getMetricDefinitionsList();
  const entityOptions = definition?.requiresEntity ? getHabitsForMetric(draft.metricKey) : [];
  const safeTarget = String(draft.target || definition?.targetDefault || 1);

  return `
    <section class="sheet-section app-general-composer-section" id="app-general-composer-wrapper">
      <form class="app-general-composer" data-general-mission-form id="app-general-mission-form">
        <div class="app-general-composer__group">
          <label class="field field--compact" id="app-general-field-origin">
            <span>Tipo</span>
            <select name="mission-origin" id="app-general-input-origin">
              <option value="automatic"${draft.origin === "automatic" ? " selected" : ""}>Automática</option>
              <option value="manual"${draft.origin === "manual" ? " selected" : ""}>Manual</option>
            </select>
          </label>

          <label class="field field--compact" id="app-general-field-periodicity">
            <span>Periodo</span>
            <select name="mission-periodicity" id="app-general-input-periodicity">
              ${PERIODICITY_OPTIONS
                .filter((option) => draft.origin === "manual" || !definition || definition.periods.includes(option.key))
                .map((option) => `<option value="${escapeHtml(option.key)}"${option.key === draft.periodicity ? " selected" : ""}>${escapeHtml(option.label)}</option>`)
                .join("")}
            </select>
          </label>
        </div>

        ${draft.origin === "automatic" ? `
          <div class="app-general-composer__group">
            <label class="field field--compact" id="app-general-field-metric">
              <span>Métrica</span>
              <select name="mission-metric" id="app-general-input-metric">
                ${metricOptions.map((option) => `
                  <option value="${escapeHtml(option.key)}"${option.key === draft.metricKey ? " selected" : ""}>${escapeHtml(option.label)}</option>
                `).join("")}
              </select>
            </label>

            ${definition?.requiresEntity ? `
              <label class="field field--compact" id="app-general-field-entity">
                <span>Hábito</span>
                <select name="mission-entity" id="app-general-input-entity">
                  <option value="">Selecciona</option>
                  ${entityOptions.map((option) => `
                    <option value="${escapeHtml(option.id)}"${option.id === draft.entityId ? " selected" : ""}>${escapeHtml(option.label)}</option>
                  `).join("")}
                </select>
              </label>
            ` : ""}
          </div>
        ` : `
          <label class="field field--compact" id="app-general-field-category">
            <span>Categoría</span>
            <select name="mission-category" id="app-general-input-category">
              ${MISSION_CATEGORY_OPTIONS.map((option) => `
                <option value="${escapeHtml(option.key)}"${option.key === draft.category ? " selected" : ""}>${escapeHtml(option.label)}</option>
              `).join("")}
            </select>
          </label>
        `}

        <div class="app-general-composer__group">
          <label class="field" id="app-general-field-title">
            <span>Título</span>
            <input
              name="mission-title"
              type="text"
              id="app-general-input-title"
              maxlength="120"
              value="${escapeHtml(draft.title || "")}"
              placeholder="${escapeHtml(draft.origin === "automatic" ? buildAutomaticMissionTitle(draft) : "Ej: Cerrar backlog")}"
            />
          </label>

          <label class="field" id="app-general-field-target">
            <span>Objetivo</span>
            <input 
              name="mission-target" 
              type="number" 
              id="app-general-input-target"
              min="1" 
              step="1" 
              value="${escapeHtml(safeTarget)}" 
            />
          </label>
        </div>

        <label class="field" id="app-general-field-description">
          <span>Descripción (opcional)</span>
          <textarea 
            name="mission-description" 
            id="app-general-input-description"
            rows="2" 
            maxlength="220" 
            placeholder="Contexto adicional..."
          >${escapeHtml(draft.description || "")}</textarea>
        </label>

        <div class="app-general-composer__actions">
          <button class="btn primary btn-compact" type="submit" id="app-general-btn-submit">Guardar</button>
          <button class="btn neutral btn-compact" type="button" data-general-mission-reset id="app-general-btn-reset">Limpiar</button>
        </div>
      </form>
    </section>
  `;
}

function renderMissionCard(mission) {
  const isTask = mission.category === "todo";
  const originLabel = mission.origin === "automatic" ? "Auto" : "Manual";
  const categoryLabel = getMissionCategoryLabel(mission.category || getAutoMissionDefinition(mission.metricKey)?.category || "general");
  const statusLabel = mission.displayStatus === MISSION_STATUS.ACTIVE
    ? "Activa"
    : mission.displayStatus === MISSION_STATUS.COMPLETED
      ? "Hecha"
      : "Archivada";
  const targetLabel = mission.metricKey === "habit_hours"
    ? formatHours(mission.target)
    : `${formatNumber(mission.target)}${mission.metricKey === "todo_pending_zero" ? "" : ""}`;
  const progressLabel = mission.metricKey === "habit_hours"
    ? formatHours(mission.progress)
    : formatNumber(mission.progress, { maxFractionDigits: 0 });

  const cardId = `app-general-mission-${escapeHtml(mission.id)}`;

  return `
    <article class="app-general-mission-card${isTask ? " app-general-mission-card--task" : ""}" data-state="${escapeHtml(mission.displayStatus)}" id="${cardId}">
      <div class="app-general-mission-card__main">
        <div class="app-general-mission-card__info">
          <strong>${escapeHtml(mission.title || buildAutomaticMissionTitle(mission))}</strong>
                <div class="app-general-mission-card__actions">

                  <div class="controles-mision">
                    ${mission.displayStatus !== MISSION_STATUS.ARCHIVED ? `
                      <button class="app-mission-action" type="button" data-general-mission-edit="${escapeHtml(mission.id)}" title="Editar">✏️</button>
                    ` : ""}
                    ${mission.displayStatus !== MISSION_STATUS.ARCHIVED ? `
                      <button class="app-mission-action app-mission-action--delete" type="button" data-general-mission-archive="${escapeHtml(mission.id)}" title="Guardar">✓</button>
                    ` : ""}
                    ${mission.displayStatus === MISSION_STATUS.ARCHIVED ? `
                      <button class="app-mission-action app-mission-action--delete" type="button" data-general-mission-delete="${escapeHtml(mission.id)}" title="Borrar">✕</button>
                    ` : `
                      <button class="app-mission-action app-mission-action--delete" type="button" data-general-mission-archive="${escapeHtml(mission.id)}" title="Archivar">✕</button>
                    `}
                  </div>

                  <div class="mas-menos">
                    ${mission.origin === "manual" && mission.displayStatus !== MISSION_STATUS.ARCHIVED ? `
                      <button class="app-mission-action" type="button" data-general-mission-minus="${escapeHtml(mission.id)}" title="–1">–</button>
                      <button class="app-mission-action" type="button" data-general-mission-plus="${escapeHtml(mission.id)}" title="+1">+</button>
                    ` : ""}
                  </div>

                  

                </div>
          <small>${escapeHtml(isTask ? categoryLabel : `${categoryLabel}`)}</small>
        </div>
        
        <div class="app-general-mission-card__progress">
          <span class="app-general-mission-card__counter">${progressLabel}/${targetLabel}</span>
          <div class="app-achievements-progress app-achievements-progress--compact">
            <i style="width:${Math.max(0, Math.min(100, mission.progressPct))}%"></i>
          </div>
        </div>
      </div>


    </article>
  `;
}

function renderMissionsList() {
  const missions = getVisibleMissions();
  if (!missions.length) {
    return `
      <section class="sheet-section app-general-section" id="lista-misiones">
        <p class="app-general-empty">No hay misiones en esta vista todavía.</p>
      </section>
    `;
  }

  return `
    <section class="sheet-section app-general-section" id="lista-misiones">
      <div class="app-general-list">
        ${missions.map((mission) => renderMissionCard(mission)).join("")}
      </div>
    </section>
  `;
}

function renderGeneralButton() {
  const button = ensureGeneralButton();
  if (!button) return;
  const summary = buildSummary();
  const indicator = document.getElementById("app-sync-indicator");
  const count = button.querySelector("[data-general-count]");
  if (count) count.textContent = String(summary.activeMissionCount);
  button.classList.toggle("hidden", !state.uid);
  if (indicator) {
    indicator.dataset.missionState = summary.activeMissionCount > 0 ? "pending" : "clear";
  }
  button.setAttribute(
    "aria-label",
    `Abrir centro general. ${summary.activeMissionCount} misiones activas.`,
  );
}

function renderGeneralCenter() {
  const body = document.getElementById(GENERAL_BODY_ID);
  if (!body || !state.ui.centerOpen) {
    renderGeneralButton();
    return;
  }

  syncDraftsFromDom();
  const summary = buildSummary();
  
  body.innerHTML = `
    <section class="sheet-section app-general-summary" id="app-general-summary">
      <div class="app-general-summary__stats">
        <button class="app-general-stat${state.ui.missionFilter === "active" ? " is-active" : ""}" id="app-general-stat-active" data-general-mission-filter="active" type="button">
          <small>Activas</small>
          <strong>${summary.activeMissionCount}</strong>
        </button>
        <button class="app-general-stat${state.ui.missionFilter === "completed" ? " is-active" : ""}" id="app-general-stat-completed" data-general-mission-filter="completed" type="button">
          <small>Completadas</small>
          <strong>${summary.completedMissionCount}</strong>
        </button>
        <button class="app-general-stat${state.ui.missionFilter === "archived" ? " is-active" : ""}" id="app-general-stat-archived" data-general-mission-filter="archived" type="button">
          <small>Archivadas</small>
          <strong>${summary.archivedMissionCount}</strong>
        </button>
      </div>
    </section>

    <div class="app-general-toolbar" id="app-general-toolbar-main">
      <button class="app-general-btn-add" type="button" id="app-general-btn-add-composer" data-toggle-composer>
        ${state.ui.composerOpen ? "Cerrar" : "✎ Nueva"}
      </button>
    </div>

    ${state.ui.composerOpen ? renderMissionComposer() : ""}
    ${renderMissionsList()}
  `;

  renderGeneralButton();
}

function resetMissionDraft() {
  state.ui.missionDraft = buildDefaultMissionDraft();
  state.ui.editingMissionId = "";
  state.ui.composerOpen = false;
  renderGeneralCenter();
}

function editMission(missionId = "") {
  const mission = state.data.missions[String(missionId || "").trim()];
  if (!mission) return;
  state.ui.editingMissionId = mission.id;
  state.ui.missionDraft = {
    origin: mission.origin,
    title: mission.title,
    description: mission.description,
    target: String(mission.target),
    periodicity: mission.periodicity,
    metricKey: mission.metricKey,
    category: mission.category,
    entityId: mission.entityId,
  };
  state.ui.composerOpen = true;
  renderGeneralCenter();
}

async function handleMissionSubmit(form) {
  const isEditing = Boolean(state.ui.editingMissionId);
  const origin = form.querySelector("[name=\"mission-origin\"]")?.value === "manual" ? "manual" : "automatic";
  const titleInput = String(form.querySelector("[name=\"mission-title\"]")?.value || "").trim();
  const description = String(form.querySelector("[name=\"mission-description\"]")?.value || "").trim();
  const rawMetricKey = String(form.querySelector("[name=\"mission-metric\"]")?.value || "").trim();
  const autoDefinition = origin === "automatic" ? getAutoMissionDefinition(rawMetricKey) : null;
  const target = origin === "automatic" && rawMetricKey === "todo_pending_zero"
    ? 1
    : Math.max(1, Math.round(toNumber(form.querySelector("[name=\"mission-target\"]")?.value) || autoDefinition?.targetDefault || 1));
  const periodicity = ["once", "daily", "weekly"].includes(form.querySelector("[name=\"mission-periodicity\"]")?.value)
    ? form.querySelector("[name=\"mission-periodicity\"]")?.value
    : "once";
  const category = origin === "manual"
    ? (form.querySelector("[name=\"mission-category\"]")?.value || "general")
    : (autoDefinition?.category || "general");
  const metricKey = origin === "automatic" ? rawMetricKey : "";
  const entityId = origin === "automatic" ? String(form.querySelector("[name=\"mission-entity\"]")?.value || "").trim() : "";

  if (origin === "automatic" && !autoDefinition) return;
  if (origin === "automatic" && autoDefinition?.requiresEntity && !entityId) return;

  const entityName = origin === "automatic"
    ? (getHabitsForMetric(metricKey).find((option) => option.id === entityId)?.name || "")
    : "";

  const missionId = isEditing ? state.ui.editingMissionId : createEntityId(getMissionsRoot());
  const existingMission = state.data.missions[missionId];
  let baselineValue = existingMission?.baselineValue || 0;
  
  if (!isEditing && origin === "automatic" && periodicity === "once" && metricKey !== "todo_pending_zero") {
    baselineValue = await resolveAutomaticMissionAbsoluteValue({
      metricKey,
      periodicity,
      entityId,
      createdAt: Date.now(),
    });
  }

  const mission = normalizeMission({
    id: missionId,
    title: titleInput || (origin === "automatic"
      ? buildAutomaticMissionTitle({
        origin,
        metricKey,
        periodicity,
        target,
        entityId,
        entityName,
      })
      : "Misión manual"),
    description,
    category,
    target,
    progress: isEditing ? Math.max(0, existingMission?.progress || 0) : 0,
    status: isEditing ? existingMission?.status : MISSION_STATUS.ACTIVE,
    createdAt: isEditing ? existingMission?.createdAt : Date.now(),
    updatedAt: Date.now(),
    periodicity,
    origin,
    metricKey,
    entityId,
    entityName,
    baselineValue,
    order: isEditing ? existingMission?.order : Object.keys(state.data.missions || {}).length,
  }, missionId);

  upsertLocalMission(mission);
  resetMissionDraft();
  try {
    await persistMission(mission);
  } catch (error) {
    console.warn("[general] no se pudo guardar la misión", error);
  }
}

async function archiveMission(missionId = "", archived = true) {
  const mission = state.data.missions[String(missionId || "").trim()];
  if (!mission) return;
  const nextMission = normalizeMission({
    ...mission,
    status: archived ? MISSION_STATUS.ARCHIVED : MISSION_STATUS.ACTIVE,
    archivedAt: archived ? Date.now() : 0,
    updatedAt: Date.now(),
  }, mission.id);
  upsertLocalMission(nextMission);
  try {
    await persistMission(nextMission);
  } catch (error) {
    console.warn("[general] no se pudo archivar la misión", error);
  }
}

async function setManualMissionProgress(missionId = "", delta = 0) {
  const mission = state.data.missions[String(missionId || "").trim()];
  if (!mission || mission.origin !== "manual" || mission.status === MISSION_STATUS.ARCHIVED) return;
  const progress = Math.max(0, mission.progress + Math.round(toNumber(delta)));
  const completed = progress >= mission.target;
  const nextMission = normalizeMission({
    ...mission,
    progress,
    status: completed ? MISSION_STATUS.COMPLETED : MISSION_STATUS.ACTIVE,
    completedAt: completed ? (mission.completedAt || Date.now()) : 0,
    updatedAt: Date.now(),
  }, mission.id);
  upsertLocalMission(nextMission);
  try {
    await persistMission(nextMission);
  } catch (error) {
    console.warn("[general] no se pudo actualizar la misión manual", error);
  }
}

async function setMissionCompletion(missionId = "", completed = true) {
  const mission = state.data.missions[String(missionId || "").trim()];
  if (!mission || mission.status === MISSION_STATUS.ARCHIVED) return;
  const nextMission = normalizeMission({
    ...mission,
    status: completed ? MISSION_STATUS.COMPLETED : MISSION_STATUS.ACTIVE,
    progress: mission.origin === "manual"
      ? (completed ? Math.max(mission.progress, mission.target) : Math.min(mission.progress, Math.max(0, mission.target - 1)))
      : mission.progress,
    completedAt: completed ? (mission.completedAt || Date.now()) : 0,
    updatedAt: Date.now(),
  }, mission.id);
  upsertLocalMission(nextMission);
  try {
    await persistMission(nextMission);
  } catch (error) {
    console.warn("[general] no se pudo actualizar el estado de la misión", error);
  }
}

async function deleteMission(missionId = "") {
  removeLocalMission(missionId);
  try {
    await deleteMissionRemote(missionId);
  } catch (error) {
    console.warn("[general] no se pudo borrar la misión", error);
  }
}

function handleRemoteSnapshot(payload = {}) {
  const overlaid = state.generalRoot
    ? applyQueuedWritesToPath(state.generalRoot, payload || {}, { uid: state.uid }) || {}
    : (payload || {});
  state.data = normalizeGeneralPayload(overlaid);
  state.remoteHydrated = true;
  scheduleOfflineSnapshotPersist();
  renderGeneralButton();
  renderGeneralCenter();
  scheduleAutomaticMissionEvaluation();
}

function stopRemoteListener() {
  if (typeof state.remoteUnsub === "function") {
    try {
      state.remoteUnsub();
    } catch (_) {}
  }
  state.remoteUnsub = null;
}

function bindRemoteListener(uid = "") {
  stopRemoteListener();
  state.generalRoot = getGeneralRoot(uid);
  if (!state.generalRoot) return;
  state.remoteUnsub = onValue(ref(db, state.generalRoot), (snapshot) => {
    handleRemoteSnapshot(snapshot.val() || {});
  }, (error) => {
    console.warn("[general] error escuchando estado remoto", error);
  });
}

function handleBookshellDataEvent(event) {
  const moduleKey = String(event?.detail?.source || "").trim();
  if (!moduleKey) return;
  const liveSnapshot = getLiveModuleSnapshot(moduleKey);
  if (!liveSnapshot) return;
  writeCachedModuleSnapshot(moduleKey, liveSnapshot, "live");
  scheduleAutomaticMissionEvaluation();
}

function bindDataEvents() {
  if (state.boundEvents) return;

  window.addEventListener("bookshell:data", handleBookshellDataEvent);
  document.addEventListener("submit", (event) => {
    if (!(event.target instanceof HTMLFormElement)) return;
    if (event.target.matches("[data-general-mission-form]")) {
      event.preventDefault();
      void handleMissionSubmit(event.target);
      return;
    }
  });

  document.addEventListener("input", (event) => {
    if (event.target?.closest?.("[data-general-mission-form]")) {
      syncDraftsFromDom();
    }
  });

  document.addEventListener("change", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest("[data-general-mission-form]")) {
      syncDraftsFromDom();
      const name = target.getAttribute("name");
      if (name === "mission-origin") {
        const nextOrigin = target.value === "manual" ? "manual" : "automatic";
        state.ui.missionDraft = {
          ...(state.ui.missionDraft || buildDefaultMissionDraft()),
          origin: nextOrigin,
          metricKey: nextOrigin === "automatic" ? (state.ui.missionDraft?.metricKey || "habits_completed") : "",
          periodicity: nextOrigin === "automatic" ? (state.ui.missionDraft?.periodicity || "daily") : "once",
          category: nextOrigin === "manual" ? (state.ui.missionDraft?.category || "general") : "general",
          entityId: "",
        };
        renderGeneralCenter();
      }
      if (name === "mission-metric") {
        const definition = getAutoMissionDefinition(target.value);
        state.ui.missionDraft = {
          ...(state.ui.missionDraft || buildDefaultMissionDraft()),
          metricKey: target.value,
          periodicity: definition?.periods?.includes(state.ui.missionDraft?.periodicity)
            ? state.ui.missionDraft?.periodicity
            : (definition?.periods?.[0] || "once"),
          target: String(definition?.targetDefault || state.ui.missionDraft?.target || 1),
          entityId: "",
        };
        renderGeneralCenter();
      }
    }
  });

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.closest("[data-toggle-composer]")) {
      state.ui.composerOpen = !state.ui.composerOpen;
      if (!state.ui.composerOpen) {
        resetMissionDraft();
      }
      renderGeneralCenter();
      return;
    }

    const missionFilter = target.closest("[data-general-mission-filter]");
    if (missionFilter) {
      state.ui.missionFilter = missionFilter.getAttribute("data-general-mission-filter") || "active";
      renderGeneralCenter();
      return;
    }

    if (target.closest("[data-general-mission-reset]")) {
      resetMissionDraft();
      return;
    }

    const missionEdit = target.closest("[data-general-mission-edit]");
    if (missionEdit) {
      void editMission(missionEdit.getAttribute("data-general-mission-edit"));
      return;
    }

    const missionMinus = target.closest("[data-general-mission-minus]");
    if (missionMinus) {
      void setManualMissionProgress(missionMinus.getAttribute("data-general-mission-minus"), -1);
      return;
    }

    const missionPlus = target.closest("[data-general-mission-plus]");
    if (missionPlus) {
      void setManualMissionProgress(missionPlus.getAttribute("data-general-mission-plus"), 1);
      return;
    }

    const missionArchive = target.closest("[data-general-mission-archive]");
    if (missionArchive) {
      void archiveMission(missionArchive.getAttribute("data-general-mission-archive"), true);
      return;
    }

    const missionDelete = target.closest("[data-general-mission-delete]");
    if (missionDelete) {
      void deleteMission(missionDelete.getAttribute("data-general-mission-delete"));
      return;
    }
  });

  state.boundEvents = true;
}

function resetStateForLogout() {
  stopRemoteListener();
  window.clearTimeout(state.evaluateTimer);
  window.clearTimeout(state.snapshotTimer);
  state.uid = "";
  state.generalRoot = "";
  state.remoteHydrated = false;
  state.data = { missions: {}, todos: {} };
  state.moduleSnapshots = {};
  state.autoMissionState = {};
  state.ui.missionDraft = buildDefaultMissionDraft();
  state.ui.composerOpen = false;
  closeGeneralCenter();
  renderGeneralButton();
  renderGeneralCenter();
}

async function handleAuthUser(user) {
  const nextUid = String(user?.uid || "").trim();
  if (!nextUid) {
    resetStateForLogout();
    return;
  }
  if (state.uid === nextUid) return;

  state.uid = nextUid;
  state.ui.missionDraft = buildDefaultMissionDraft();
  state.ui.composerOpen = false;

  await hydrateGeneralFromOfflineSnapshot(nextUid);
  ensureGeneralButton();
  ensureGeneralModal();
  renderGeneralButton();
  renderGeneralCenter();
  bindRemoteListener(nextUid);
  scheduleAutomaticMissionEvaluation({ forceFetch: true });
}

export function initGeneralCenterService() {
  if (state.initialized) return;
  state.initialized = true;
  state.ui.missionDraft = buildDefaultMissionDraft();
  ensureGeneralButton();
  ensureGeneralModal();
  bindDataEvents();
  state.authUnsub = onUserChange((user) => {
    void handleAuthUser(user || auth.currentUser || null);
  });
  void handleAuthUser(auth.currentUser || null);

  window.__bookshellGeneral = {
    openCenter: openGeneralCenter,
    closeCenter: closeGeneralCenter,
    getState: () => ({
      data: cloneData(),
      summary: buildSummary(),
      autoMissionState: { ...state.autoMissionState },
    }),
  };
}
