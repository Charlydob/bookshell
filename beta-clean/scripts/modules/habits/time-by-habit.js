const DEFAULT_DAY_SEC = 24 * 60 * 60;

function dateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseDateKey(key) {
  if (!key || typeof key !== "string") return null;
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function isValidTs(ts) {
  return Number.isFinite(ts) && ts > 0;
}

function minTs(current, next) {
  if (!isValidTs(next)) return current;
  if (!isValidTs(current)) return next;
  return Math.min(current, next);
}

function minTsFromSessionStore(habitSessions) {
  let earliestTs = null;
  Object.values(habitSessions || {}).forEach((byDate) => {
    if (!byDate || typeof byDate !== "object") return;
    Object.entries(byDate).forEach(([dateKey, rawValue]) => {
      if (!rawValue || (typeof rawValue !== "number" && typeof rawValue !== "object")) return;
      const sec = readSessionSec(rawValue);
      if (sec <= 0) return;

      if (rawValue && typeof rawValue === "object" && isValidTs(rawValue.startTs)) {
        earliestTs = minTs(earliestTs, Number(rawValue.startTs));
        return;
      }

      const parsed = parseDateKey(dateKey);
      if (parsed) earliestTs = minTs(earliestTs, parsed.getTime());
    });
  });
  return earliestTs;
}

function minTsFromHistoryStore(stores) {
  let earliestTs = null;
  (stores || []).forEach((store) => {
    Object.values(store || {}).forEach((byDate) => {
      if (!byDate || typeof byDate !== "object") return;
      Object.entries(byDate).forEach(([dateKey, value]) => {
        const n = Number(value) || 0;
        if (n <= 0) return;
        const parsed = parseDateKey(dateKey);
        if (parsed) earliestTs = minTs(earliestTs, parsed.getTime());
      });
    });
  });
  return earliestTs;
}

export function resolveFirstRecordTs({
  habitSessions,
  habitChecks,
  habitCounts,
  appCreatedAt,
  nowTs = Date.now()
} = {}) {
  const sessionsTs = minTsFromSessionStore(habitSessions);
  if (isValidTs(sessionsTs)) return sessionsTs;

  const historyTs = minTsFromHistoryStore([habitChecks, habitCounts]);
  if (isValidTs(historyTs)) return historyTs;

  if (isValidTs(appCreatedAt)) return Number(appCreatedAt);
  return Number(nowTs) || Date.now();
}

function readSessionSec(rawValue) {
  if (typeof rawValue === "number") return Math.max(0, Math.round(rawValue));
  if (rawValue && typeof rawValue === "object") {
    if (Number.isFinite(rawValue.totalSec)) return Math.max(0, Math.round(rawValue.totalSec));
    if (Number.isFinite(rawValue.min)) return Math.max(0, Math.round(rawValue.min * 60));
  }
  return 0;
}

function eachDay(start, end, visit) {
  const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
  const finish = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  while (cursor <= finish) {
    visit(dateKeyLocal(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
}

export function computeTimeByHabitDataset({
  habitsById,
  habitSessions,
  rangeStart,
  rangeEnd,
  unknownHabitId = "h-unknown",
  unknownHabitName = "Desconocido",
  unknownHabitEmoji = "❓",
  unknownHabitColor = "#8b93a6",
  daySec = DEFAULT_DAY_SEC
}) {
  const knownHabits = new Map();
  Object.values(habitsById || {}).forEach((habit) => {
    if (!habit || habit.archived) return;
    knownHabits.set(habit.id, habit);
  });

  const totalsByHabitId = new Map();
  let unknownTotalSec = 0;

  eachDay(rangeStart, rangeEnd, (dateKey) => {
    let knownAssignedSec = 0;

    Object.entries(habitSessions || {}).forEach(([habitId, byDate]) => {
      if (!byDate || typeof byDate !== "object") return;
      if (habitId === unknownHabitId) return;
      const sec = readSessionSec(byDate[dateKey]);
      if (sec <= 0) return;

      if (knownHabits.has(habitId)) {
        totalsByHabitId.set(habitId, (totalsByHabitId.get(habitId) || 0) + sec);
        knownAssignedSec += sec;
      }
    });

    const boundedAssigned = Math.min(daySec, Math.max(0, Math.round(knownAssignedSec)));
    unknownTotalSec += Math.max(0, daySec - boundedAssigned);
  });

  const entries = Array.from(totalsByHabitId.entries())
    .map(([habitId, totalSec]) => ({ habitId, habit: knownHabits.get(habitId) || null, totalSec }))
    .filter((item) => item.totalSec > 0);

  if (unknownTotalSec > 0) {
    const unknownHabit = knownHabits.get(unknownHabitId) || {
      id: unknownHabitId,
      name: unknownHabitName,
      emoji: unknownHabitEmoji,
      color: unknownHabitColor,
      system: true,
      goal: "time"
    };
    entries.push({ habitId: unknownHabitId, habit: unknownHabit, totalSec: unknownTotalSec });
  }

  return entries.sort((a, b) => b.totalSec - a.totalSec);
}

export function debugComputeTimeByHabit(sampleData) {
  const result = computeTimeByHabitDataset(sampleData);
  const byId = new Map(result.map((item) => [item.habitId, item.totalSec]));
  const expected = sampleData.expected || {};
  const mismatches = [];
  Object.entries(expected).forEach(([habitId, expectedSec]) => {
    const gotSec = byId.get(habitId) || 0;
    if (gotSec !== expectedSec) mismatches.push({ habitId, expectedSec, gotSec });
  });
  return {
    pass: mismatches.length === 0,
    result,
    mismatches
  };
}
