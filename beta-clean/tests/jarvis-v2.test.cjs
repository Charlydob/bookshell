"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { schemas } = require("../jarvis/contracts");
const { totals, splitInterval } = require("../jarvis/domain");
const { due, achieved } = require("../jarvis/notifications");
const { summarizeRest, personExtension } = require("../jarvis/future-models");
test("strict plan rejects duplicate times, false dates and unknown fields", () => {
  const b = {
    habit: {
      name: "Teeth",
      goal: "count",
      schedule: { type: "daily", days: [] },
      targetsByRange: { day: 3 },
    },
    reminderPlan: {
      enabled: true,
      times: ["08:00", "08:00"],
      timezone: "Europe/Madrid",
      startDate: "2026-10-29",
    },
    idempotencyKey: "unit-key-1",
  };
  assert.equal(schemas.habits_create.safeParse(b).success, false);
  b.reminderPlan.times = ["08:00", "14:00", "21:00"];
  assert.equal(schemas.habits_create.safeParse(b).success, true);
  assert.equal(
    schemas.habits_record.safeParse({
      habitId: "h-a",
      date: "2026-02-30",
      mode: "increment",
      unit: "count",
      value: 1,
      idempotencyKey: "unit-key-2",
    }).success,
    false,
  );
});
test("count targets are counts and duration targets are minutes; scheduled days are explicit", () => {
  const h = {
      id: "h-a",
      goal: "count",
      jarvisTargets: { day: 3 },
      schedule: { type: "days", days: [4] },
    },
    root = { habitCounts: { "h-a": { "2026-10-29": 3 } } };
  assert.equal(achieved(root, h, "2026-10-29"), true);
  const p = { enabled: true, startDate: "2026-10-01" };
  assert.equal(due(h, p, "2026-10-29"), true);
  assert.equal(due(h, p, "2026-10-30"), false);
});
test("elapsed union counts each wall-clock instant once, including touching intervals", () => {
  assert.deepEqual(
    totals([
      [0, 1000],
      [1000, 2000],
      [0, 2000],
    ]),
    { elapsedSec: 2, activitySec: 4, exclusiveSec: 0, overlapSec: 2 },
  );
  assert.deepEqual(totals([]), {
    elapsedSec: 0,
    activitySec: 0,
    exclusiveSec: 0,
    overlapSec: 0,
  });
});
test("DST calendar day boundaries have 23 and 25 hours without losing time", () => {
  for (const [start, end, hours] of [
    ["2026-03-28T23:00:00Z", "2026-03-29T22:00:00Z", 23],
    ["2026-10-24T22:00:00Z", "2026-10-25T23:00:00Z", 25],
  ]) {
    const chunks = splitInterval(
      Date.parse(start),
      Date.parse(end),
      "Europe/Madrid",
    );
    assert.equal(chunks.length, 1);
    assert.equal(chunks[0].end - chunks[0].start, hours * 3600000);
  }
});
test("bedtime is not sleep, missing sleep remains unknown and messages are not a source", () => {
  const bed = {
    kind: "in_bed",
    start: "2026-10-28T23:00:00+01:00",
    end: "2026-10-29T07:00:00+01:00",
    source: "user_declared",
    timezone: "Europe/Madrid",
  };
  assert.equal(summarizeRest([bed]).declaredSleepSec, null);
  assert.equal(summarizeRest([bed]).inBedSec, 8 * 3600);
  assert.throws(() => summarizeRest([{ ...bed, source: "last_chat_message" }]));
});
test("people model requires supplied provenance and distinguishes hypotheses", () => {
  assert.equal(
    personExtension.safeParse({
      aliases: ["David"],
      relationships: [
        {
          targetNoteId: "note-mariana",
          label: "friend",
          status: "hypothesis",
          source: "user",
        },
      ],
    }).success,
    true,
  );
  assert.equal(
    personExtension.safeParse({
      aliases: [],
      relationships: [
        {
          targetNoteId: "note-laura",
          label: "relative",
          status: "confirmed",
          source: "facial_inference",
        },
      ],
    }).success,
    false,
  );
});
