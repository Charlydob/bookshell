import { debugComputeTimeByHabit, resolveFirstRecordTs } from "../time-by-habit.js";

const DAY_MS = 24 * 60 * 60 * 1000;

const sampleData = {
  habitsById: {
    hWork: { id: "hWork", name: "Trabajo", goal: "time", archived: false },
    hSleep: { id: "hSleep", name: "Dormir", goal: "time", archived: false }
  },
  habitSessions: {
    hWork: {
      "2026-01-10": { min: 120 },
      "2026-01-11": 0
    },
    hSleep: {
      "2026-01-10": 8 * 60 * 60
    }
  },
  rangeStart: new Date(2026, 0, 10),
  rangeEnd: new Date(2026, 0, 10),
  daySec: 24 * 60 * 60,
  unknownHabitId: "h-unknown",
  expected: {
    hWork: 2 * 60 * 60,
    hSleep: 8 * 60 * 60,
    "h-unknown": 14 * 60 * 60
  }
};

const result = debugComputeTimeByHabit(sampleData);
if (!result.pass) {
  console.error("FAIL time-by-habit self-check", JSON.stringify(result.mismatches, null, 2));
  process.exit(1);
}

const nowTs = Date.now();
const tenDaysAgo = nowTs - (10 * DAY_MS);
const twoDaysMs = 2 * DAY_MS;

const firstRecordTs = resolveFirstRecordTs({
  habitSessions: {
    hWork: {
      [new Date(tenDaysAgo).toISOString().slice(0, 10)]: { totalSec: Math.round(twoDaysMs / 1000), startTs: tenDaysAgo }
    }
  },
  nowTs
});

const totalRangeMs = nowTs - firstRecordTs;
const knownMs = twoDaysMs;
const unknownMs = Math.max(0, totalRangeMs - knownMs);

if (Math.abs(totalRangeMs - (10 * DAY_MS)) > 1000) {
  console.error("FAIL total range must be 10 days", { totalRangeMs, expectedMs: 10 * DAY_MS });
  process.exit(1);
}
if (Math.abs(unknownMs - (8 * DAY_MS)) > 1000) {
  console.error("FAIL unknown must be 8 days", { unknownMs, expectedMs: 8 * DAY_MS });
  process.exit(1);
}
if (knownMs > totalRangeMs || unknownMs > totalRangeMs) {
  console.error("FAIL known/unknown exceed total range", { knownMs, unknownMs, totalRangeMs });
  process.exit(1);
}

console.log("PASS time-by-habit self-check");
