import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  __test: {
    buildAutomationReminderSearchQuery,
    searchAutomationReminderRows,
  },
} = require("../deploy-bookshell-api-server.js");

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const rows = [
  {
    id: "rem_laura_1",
    title: "Guardia Laura",
    description: "",
    target_date: "2026-09-02",
    target_time: "09:00",
    status: "completed",
    source_metadata: {
      groupId: "batch_guardia_laura_sep_2026",
      seriesKey: "guardia:laura",
      eventType: "guardia",
      subject: "Laura",
      groupIndex: 1,
      groupSize: 4,
    },
  },
  {
    id: "rem_laura_2",
    title: "Guardia Laura",
    description: "",
    target_date: "2026-09-07",
    target_time: "09:00",
    status: "pending",
    source_metadata: {
      groupId: "batch_guardia_laura_sep_2026",
      seriesKey: "guardia:laura",
      eventType: "guardia",
      subject: "Laura",
      groupIndex: 2,
      groupSize: 4,
    },
  },
  {
    id: "rem_laura_3",
    title: "Guardia Laura",
    description: "",
    target_date: "2026-09-14",
    target_time: "09:00",
    status: "pending",
    source_metadata: {
      groupId: "batch_guardia_laura_sep_2026",
      seriesKey: "guardia:laura",
      eventType: "guardia",
      subject: "Laura",
      groupIndex: 3,
      groupSize: 4,
    },
  },
  {
    id: "rem_laura_4",
    title: "Guardia Laura",
    description: "",
    target_date: "2026-09-28",
    target_time: "09:00",
    status: "pending",
    source_metadata: {
      groupId: "batch_guardia_laura_sep_2026",
      seriesKey: "guardia:laura",
      eventType: "guardia",
      subject: "Laura",
      groupIndex: 4,
      groupSize: 4,
    },
  },
  {
    id: "rem_miguel_1",
    title: "Guardia Miguel",
    description: "",
    target_date: "2026-09-14",
    target_time: "08:00",
    status: "pending",
    source_metadata: {
      groupId: "batch_guardia_miguel_sep_2026",
      seriesKey: "guardia:miguel",
      eventType: "guardia",
      subject: "Miguel",
      groupIndex: 1,
      groupSize: 1,
    },
  },
  {
    id: "rem_laura_cancelled",
    title: "Guardia Laura",
    description: "",
    target_date: "2026-09-01",
    target_time: "09:00",
    status: "cancelled",
    source_metadata: {
      eventType: "guardia",
      subject: "Laura",
    },
  },
  {
    id: "rem_legacy_laura",
    title: "Guardia Laura antigua",
    description: "Turno importado antes de metadata",
    target_date: "2026-08-30",
    target_time: "09:00",
    status: "completed",
    source_metadata: {},
  },
];

await test("search future Guardia Laura", () => {
  const result = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "future",
    status: "pending",
  }, { today: "2026-09-10" });

  assert.deepEqual(result.results.map((row) => row.id), ["rem_laura_3", "rem_laura_4"]);
  assert.equal(result.total, 2);
});

await test("search today Guardia Laura", () => {
  const result = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "today",
  }, { today: "2026-09-07" });

  assert.deepEqual(result.results.map((row) => row.id), ["rem_laura_2"]);
});

await test("search past Guardia Laura incluye legacy fallback y excluye cancelled por defecto", () => {
  const result = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "past",
  }, { today: "2026-09-10" });

  assert.deepEqual(result.results.map((row) => row.id), [
    "rem_legacy_laura",
    "rem_laura_1",
    "rem_laura_2",
  ]);
  assert.equal(result.total, 3);
});

await test("next Guardia Laura es la primera future ordenada", () => {
  const result = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "future",
    status: "pending",
    limit: 1,
  }, { today: "2026-09-10" });

  assert.deepEqual(result.results.map((row) => row.id), ["rem_laura_3"]);
  assert.equal(result.total, 2);
});

await test("count historico excluye cancelled salvo status all explicito", () => {
  const defaultPast = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "past",
  }, { today: "2026-09-10" });
  const explicitAll = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "past",
    status: "all",
  }, { today: "2026-09-10" });

  assert.equal(defaultPast.total, 3);
  assert.equal(explicitAll.total, 4);
});

await test("dos personas con eventType guardia no se mezclan", () => {
  const result = searchAutomationReminderRows(rows, {
    eventType: "guardia",
    subject: "Miguel",
    temporalScope: "future",
  }, { today: "2026-09-10" });

  assert.deepEqual(result.results.map((row) => row.id), ["rem_miguel_1"]);
});

await test("query SQL usa metadata con fallback legacy y limite seguro", () => {
  const query = buildAutomationReminderSearchQuery({
    q: "guardia",
    eventType: "guardia",
    subject: "Laura",
    temporalScope: "past",
    limit: 500,
  }, { today: "2026-09-10" });

  assert.equal(query.filters.limit, 100);
  assert.match(query.rowsQuery, /source_metadata->>'eventType'/);
  assert.match(query.rowsQuery, /source_metadata->>'subject'/);
  assert.match(query.rowsQuery, /status <> 'cancelled'/);
  assert.match(query.rowsQuery, /ORDER BY\s+target_date ASC,/);
});

await test("delivery regressions quedan protegidas en el servidor", () => {
  const source = readFileSync(new URL("../deploy-bookshell-api-server.js", import.meta.url), "utf8");

  assert.match(source, /expired_before_delivery/);
  assert.match(source, /status = 'pending'\s+[\s\S]*const nextDate = getNextRecurrenceDate/);
  assert.match(source, /status IN \('sent', 'failed'\)/);
  assert.match(source, /stale_schedule_version/);
  assert.match(source, /row\.status !== "pending"/);
  assert.match(source, /body\?\.scheduleVersion/);
});
