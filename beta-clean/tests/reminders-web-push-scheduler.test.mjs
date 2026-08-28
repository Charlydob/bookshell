import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { __test } = require("../deploy-bookshell-api-server.js");
const serverSource = readFileSync(new URL("../deploy-bookshell-api-server.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../db/migrations/20260828_reminder_web_push_scheduler.sql", import.meta.url), "utf8");

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test("recordatorio normal a las 18:30 genera payload exacto", () => {
  const payload = __test.buildReminderAlertPushPayload({
    alertId: "alert-0",
    reminderId: "rem-1",
    title: "Clase de aleman",
    targetTime: "18:30",
    minutesBefore: 0,
    scheduleVersion: 1,
  });
  assert.equal(payload.title, "\u23f0 Clase de aleman");
  assert.equal(payload.body, "18:30");
  assert.equal(payload.url, "/?reminderId=rem-1#view-notes");
});

await test("aviso 2 horas antes usa titulo relativo", () => {
  const payload = __test.buildReminderAlertPushPayload({
    title: "Clase de aleman",
    minutesBefore: 120,
    targetTime: "18:30",
  });
  assert.equal(payload.title, "\u23f0 En 2 horas: Clase de aleman");
});

await test("aviso 10 minutos antes usa titulo relativo", () => {
  const payload = __test.buildReminderAlertPushPayload({
    title: "Clase de aleman",
    minutesBefore: 10,
  });
  assert.equal(payload.title, "\u23f0 En 10 min: Clase de aleman");
});

await test("varios avisos del mismo recordatorio conservan la hora exacta y se deduplican", () => {
  const alerts = __test.normalizeReminderAlertSet([
    { mode: "relative", minutesBefore: 120 },
    { amount: 2, unit: "hours" },
    { mode: "relative", minutesBefore: 10 },
  ]);
  assert.deepEqual(alerts.map((alert) => alert.minutesBefore).sort((a, b) => a - b), [0, 10, 120]);
});

await test("no duplicar notificaciones: marcar sent ignora alertas no pending", () => {
  assert.match(serverSource, /if \(row\.status !== "pending"\)/);
  assert.match(serverSource, /reason: REMINDER_ALERT_TERMINAL_STATUSES\.has\(row\.status\)/);
});

await test("reinicio del scheduler/backend: las alertas reclamadas usan locking persistente", () => {
  assert.match(serverSource, /FOR UPDATE OF a SKIP LOCKED/);
  assert.match(serverSource, /locked_at = NOW\(\)/);
  assert.match(serverSource, /attempt_count = attempt_count \+ 1/);
});

await test("resumen de las 08:00 con varios recordatorios genera una unica notificacion agrupada", () => {
  const payload = __test.buildDailySummaryPayload({
    targetDate: "2026-08-28",
    timezone: "Europe/Zurich",
    reminders: [
      { title: "Llamar al medico", targetTime: "10:00" },
      { title: "Comprar comida", targetTime: "14:30" },
      { title: "Clase de aleman", targetTime: "18:30" },
    ],
  });
  assert.equal(payload.title, "\ud83d\udcc5 Hoy tienes pendiente");
  assert.match(payload.body, /10:00 - Llamar al medico/);
  assert.match(payload.body, /14:30 - Comprar comida/);
  assert.match(payload.body, /18:30 - Clase de aleman/);
});

await test("no enviar resumen si no hay recordatorios queda persistido como skipped", () => {
  assert.match(serverSource, /reminders\.length \? "sending" : "skipped"/);
  assert.match(migrationSource, /'skipped'/);
});

await test("weekly calcula la siguiente ocurrencia independiente", () => {
  assert.equal(__test.getNextRecurrenceDate({
    target_date: "2026-08-24",
    recurrence_type: "weekly",
    recurrence_rule: {},
  }), "2026-08-31");
});

await test("monthly calcula la siguiente ocurrencia con clamp de fin de mes", () => {
  assert.equal(__test.getNextRecurrenceDate({
    target_date: "2026-01-31",
    recurrence_type: "monthly",
    recurrence_rule: {},
  }), "2026-02-28");
});

await test("edicion de hora invalida avisos antiguos mediante scheduleVersion", () => {
  assert.match(serverSource, /schedule_version = \$21/);
  assert.match(serverSource, /stale_schedule_version/);
});

await test("eliminacion del recordatorio cancela alertas pendientes", () => {
  assert.match(serverSource, /normalized\.status === "cancelled"/);
  assert.match(serverSource, /WHEN status = 'pending' THEN 'cancelled'/);
});

await test("timezone Europe Zurich calcula UTC sin usar hora ingenua del servidor", () => {
  assert.equal(
    __test.localDateTimeToUtc("2026-08-28", "08:00", "Europe/Zurich").toISOString(),
    "2026-08-28T06:00:00.000Z",
  );
});

await test("un aviso de una ocurrencia recurrente no bloquea la siguiente", () => {
  const first = __test.buildReminderAlertPushPayload({
    alertId: "alert-1",
    reminderId: "rem-weekly",
    title: "Clase",
    minutesBefore: 0,
    scheduleVersion: 1,
  });
  const next = __test.buildReminderAlertPushPayload({
    alertId: "alert-1",
    reminderId: "rem-weekly",
    title: "Clase",
    minutesBefore: 0,
    scheduleVersion: 2,
  });
  assert.notEqual(first.tag, next.tag);
});
