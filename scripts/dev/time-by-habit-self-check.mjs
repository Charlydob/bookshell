import { debugComputeTimeByHabit } from "../time-by-habit.js";

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
if (result.pass) {
  console.log("PASS time-by-habit self-check");
  process.exit(0);
}

console.error("FAIL time-by-habit self-check", JSON.stringify(result.mismatches, null, 2));
process.exit(1);
