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

function makeReminderSchedulerDb(now) {
  const state = {
    now,
    alert: {
      id: "00000000-0000-4000-8000-0000000000a1",
      reminder_id: "00000000-0000-4000-8000-0000000000b1",
      mode: "relative",
      minutes_before: 0,
      notify_at: new Date("2026-01-15T08:00:00.000Z"),
      status: "pending",
      attempt_count: 0,
      created_at: new Date("2026-01-15T07:00:00.000Z"),
      locked_at: null,
      claimed_at: null,
      sent_at: null,
      provider_accepted_at: null,
      delivery_lateness_ms: null,
    },
    reminder: {
      id: "00000000-0000-4000-8000-0000000000b1",
      title: "Zurich 09",
      description: "",
      emoji: "\u23f0",
      target_date: "2026-01-15",
      target_time: "09:00",
      timezone: "Europe/Zurich",
      source_type: "bookshell",
      recurrence_type: "none",
      schedule_version: 1,
      status: "pending",
    },
  };

  const query = async (sql, params = []) => {
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(String(sql).trim())) return { rows: [], rowCount: 0 };
    if (/UPDATE reminder_alerts a\s+SET\s+status = 'failed'/.test(sql)) {
      const cutoff = state.now.getTime() - 30 * 60 * 1000;
      if (state.alert.status === "pending" && state.alert.notify_at.getTime() < cutoff) {
        state.alert.status = "failed";
        state.alert.failed_at = state.now;
        state.alert.claimed_at = state.now;
        state.alert.delivery_lateness_ms = state.now.getTime() - state.alert.notify_at.getTime();
        return { rows: [{ alert_id: state.alert.id, reminder_id: state.alert.reminder_id, notify_at: state.alert.notify_at, failed_at: state.alert.failed_at }], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (/SELECT\s+a\.id\s+FROM reminder_alerts/.test(sql)) {
      const due = state.alert.status === "pending" && state.alert.notify_at.getTime() <= state.now.getTime();
      const unlocked = !state.alert.locked_at || state.alert.locked_at.getTime() < state.now.getTime() - 5 * 60 * 1000;
      return due && unlocked && state.reminder.status === "pending"
        ? { rows: [{ id: state.alert.id }], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/UPDATE reminder_alerts\s+SET\s+locked_at = NOW\(\)/.test(sql)) {
      state.alert.locked_at = state.now;
      state.alert.claimed_at = state.now;
      state.alert.locked_by = params[1];
      state.alert.attempt_count += 1;
      return { rows: [], rowCount: 1 };
    }
    if (/SELECT\s+a\.id AS alert_id/.test(sql)) {
      return { rows: [{
        alert_id: state.alert.id,
        reminder_id: state.alert.reminder_id,
        mode: state.alert.mode,
        minutes_before: state.alert.minutes_before,
        notify_at: state.alert.notify_at,
        claimed_at: state.alert.claimed_at,
        locked_at: state.alert.locked_at,
        attempt_count: state.alert.attempt_count,
        title: state.reminder.title,
        description: state.reminder.description,
        emoji: state.reminder.emoji,
        target_date: state.reminder.target_date,
        target_time: state.reminder.target_time,
        timezone: state.reminder.timezone,
        source_type: state.reminder.source_type,
        recurrence_type: state.reminder.recurrence_type,
        schedule_version: state.reminder.schedule_version,
      }], rowCount: 1 };
    }
    if (/SELECT\s+a\.id,\s+a\.status,\s+a\.reminder_id/.test(sql)) {
      return { rows: [{
        id: state.alert.id,
        status: state.alert.status,
        reminder_id: state.alert.reminder_id,
        schedule_version: state.reminder.schedule_version,
      }], rowCount: 1 };
    }
    if (/UPDATE reminder_alerts\s+SET\s+status = 'sent'/.test(sql)) {
      state.alert.status = "sent";
      state.alert.sent_at = new Date(params[1]);
      state.alert.provider_accepted_at = new Date(params[1]);
      state.alert.delivery_lateness_ms = params[2];
      state.alert.locked_at = null;
      return { rows: [{ sent_at: state.alert.sent_at, provider_accepted_at: state.alert.provider_accepted_at }], rowCount: 1 };
    }
    if (/SELECT\s+\*\s+FROM reminders/.test(sql)) {
      return { rows: [state.reminder], rowCount: 1 };
    }
    if (/SELECT COUNT\(\*\)::int AS count\s+FROM push_subscriptions/.test(sql)) {
      return { rows: [{ count: 1 }], rowCount: 1 };
    }
    if (/CREATE TABLE IF NOT EXISTS push_subscriptions/.test(sql)) {
      return { rows: [], rowCount: 0 };
    }
    throw new Error(`Unhandled SQL in fake scheduler db: ${String(sql).slice(0, 120)}`);
  };

  return {
    state,
    query,
    connect: async () => ({ query, release: () => {} }),
  };
}

function makeReminderMaterializationDb(now = new Date("2026-08-25T22:49:05.343Z")) {
  const state = {
    now,
    reminder: null,
    alerts: [],
    alertInsertCount: 0,
    alertUpdateCount: 0,
    alertCancelCount: 0,
    reminderUpdateCount: 0,
  };
  const reminderId = "00000000-0000-4000-8000-000000000925";

  const normalizeParamsDate = (value) => (
    value instanceof Date ? value : (value ? new Date(value) : null)
  );

  const query = async (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, " ").trim();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(compact)) return { rows: [], rowCount: 0 };
    if (/SELECT id FROM reminders WHERE firebase_uid/.test(compact)) {
      return { rows: [], rowCount: 0 };
    }
    if (/INSERT INTO reminders/.test(compact)) {
      state.reminder = {
        id: reminderId,
        firebase_uid: params[0],
        title: params[1],
        description: params[2],
        emoji: params[3],
        type: params[4],
        category: params[5],
        target_date: params[6],
        target_time: params[7],
        timezone: params[8],
        source_type: params[9],
        source_external_id: params[10],
        source_metadata: JSON.parse(params[11] || "{}"),
        recurrence_type: params[12],
        recurrence_start_date: params[13],
        recurrence_end_date: params[14],
        recurrence_daily_target_count: params[15],
        recurrence_rule: JSON.parse(params[16] || "{}"),
        status: params[17],
        completed_at: normalizeParamsDate(params[18]),
        schedule_version: 1,
        created_at: state.now,
        updated_at: state.now,
      };
      return { rows: [state.reminder], rowCount: 1 };
    }
    if (/SELECT \* FROM reminders WHERE id = \$1/.test(compact)) {
      return state.reminder && state.reminder.id === params[0]
        ? { rows: [state.reminder], rowCount: 1 }
        : { rows: [], rowCount: 0 };
    }
    if (/SELECT \* FROM reminders WHERE firebase_uid/.test(compact)) {
      return { rows: state.reminder ? [state.reminder] : [], rowCount: state.reminder ? 1 : 0 };
    }
    if (/SELECT \* FROM reminder_alerts WHERE reminder_id = \$1 FOR UPDATE/.test(compact)) {
      return { rows: state.alerts.filter((alert) => alert.reminder_id === params[0]), rowCount: state.alerts.length };
    }
    if (/SELECT \* FROM reminder_alerts WHERE reminder_id = \$1 ORDER BY/.test(compact)) {
      const rows = state.alerts.filter((alert) => alert.reminder_id === params[0]);
      return { rows, rowCount: rows.length };
    }
    if (/INSERT INTO reminder_alerts/.test(compact)) {
      const alert = {
        id: `alert-${state.alerts.length + 1}`,
        reminder_id: params[0],
        mode: params[1],
        minutes_before: params[2],
        notify_at: params[3],
        channel: "telegram",
        status: "pending",
        created_at: state.now,
        updated_at: state.now,
        sent_at: null,
        failed_at: null,
        claimed_at: null,
        provider_accepted_at: null,
        delivery_lateness_ms: null,
      };
      state.alerts.push(alert);
      state.alertInsertCount += 1;
      return { rows: [{ id: alert.id, created_at: alert.created_at }], rowCount: 1 };
    }
    if (/UPDATE reminders SET/.test(compact)) {
      state.reminder = {
        ...state.reminder,
        title: params[2],
        description: params[3],
        emoji: params[4],
        type: params[5],
        category: params[6],
        target_date: params[7],
        target_time: params[8],
        timezone: params[9],
        source_type: params[10],
        source_external_id: params[11],
        source_metadata: JSON.parse(params[12] || "{}"),
        recurrence_type: params[13],
        recurrence_start_date: params[14],
        recurrence_end_date: params[15],
        recurrence_daily_target_count: params[16],
        recurrence_rule: JSON.parse(params[17] || "{}"),
        status: params[18],
        completed_at: normalizeParamsDate(params[19]),
        schedule_version: params[20],
        updated_at: state.now,
      };
      state.reminderUpdateCount += 1;
      return { rows: [state.reminder], rowCount: 1 };
    }
    if (/UPDATE reminder_alerts SET notify_at = \$2/.test(compact)) {
      const alert = state.alerts.find((row) => row.id === params[0] && row.status === "pending");
      if (alert) {
        alert.notify_at = params[1];
        alert.updated_at = state.now;
        state.alertUpdateCount += 1;
      }
      return { rows: [], rowCount: alert ? 1 : 0 };
    }
    if (/UPDATE reminder_alerts SET status = 'cancelled'/.test(compact)) {
      const alert = state.alerts.find((row) => row.id === params[0] && row.status === "pending");
      if (alert) {
        alert.status = "cancelled";
        alert.updated_at = state.now;
        state.alertCancelCount += 1;
      }
      return { rows: [], rowCount: alert ? 1 : 0 };
    }
    if (/UPDATE reminder_alerts SET status = CASE/.test(compact)) {
      for (const alert of state.alerts.filter((row) => row.reminder_id === params[0] && row.status === "pending")) {
        alert.status = "cancelled";
        state.alertCancelCount += 1;
      }
      return { rows: [], rowCount: state.alertCancelCount };
    }
    throw new Error(`Unhandled SQL in fake materialization db: ${compact.slice(0, 180)}`);
  };

  return {
    state,
    query,
    connect: async () => ({ query, release: () => {} }),
  };
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
  assert.match(serverSource, /async function cancelReminderRecord\(reminderId\)/);
  assert.match(serverSource, /status = 'cancelled'/);
  assert.match(serverSource, /WHEN status = 'pending' THEN 'cancelled'/);
  assert.match(serverSource, /schedule_version = schedule_version \+ 1/);
});

await test("listado publico de reminders excluye cancelados por defecto", () => {
  assert.match(serverSource, /includeCancelled = false/);
  assert.match(serverSource, /status <> 'cancelled'/);
  assert.match(serverSource, /includeCancelled: url\.searchParams\.get\("includeCancelled"\) === "1"/);
});

await test("Bookshell y Telegram usan la misma cancelacion persistente", () => {
  assert.match(serverSource, /const reminder = await cancelReminderRecord\(reminderMatch\[1\]\)/);
  assert.match(serverSource, /const reminder = await cancelReminderRecord\(automationReminderMatch\[1\]\)/);
});

await test("payload de prueba de recordatorio usa Web Push sin marcar alertas reales", () => {
  const payload = __test.resolveReminderTestPushPayload("reminder", {
    id: "rem-test",
    title: "Clase de aleman",
    targetTime: "18:30",
    scheduleVersion: 7,
  });
  assert.equal(payload.title, "\u23f0 Clase de aleman");
  assert.equal(payload.body, "18:30");
  assert.equal(payload.reminderId, "rem-test");
  const fnSource = serverSource.slice(
    serverSource.indexOf("async function sendReminderTestPush"),
    serverSource.indexOf("function reminderAlertPushOptions")
  );
  assert.doesNotMatch(fnSource, /markReminderAlertSent/);
  assert.doesNotMatch(fnSource, /claimDueReminderAlerts/);
  assert.doesNotMatch(fnSource, /claimDailySummaryDelivery/);
});

await test("payload de prueba de resumen diario se genera desde recordatorios del dia", () => {
  const payload = __test.resolveReminderTestPushPayload("daily-summary", {
    id: "rem-test",
    timezone: "Europe/Zurich",
  }, [
    { title: "Comprar comida", targetTime: "10:00" },
    { title: "Clase de aleman", targetTime: "18:30" },
  ]);
  assert.equal(payload.title, "\ud83d\udcc5 Hoy tienes pendiente");
  assert.match(payload.body, /10:00 - Comprar comida/);
  assert.match(payload.body, /18:30 - Clase de aleman/);
});

await test("timezone Europe Zurich calcula UTC sin usar hora ingenua del servidor", () => {
  assert.equal(
    __test.localDateTimeToUtc("2026-08-28", "08:00", "Europe/Zurich").toISOString(),
    "2026-08-28T06:00:00.000Z",
  );
});

await test("timezone Europe Zurich distingue CET y CEST para target_date mas target_time", () => {
  assert.equal(
    __test.localDateTimeToUtc("2026-01-15", "09:00", "Europe/Zurich").toISOString(),
    "2026-01-15T08:00:00.000Z",
  );
  assert.equal(
    __test.localDateTimeToUtc("2026-07-15", "09:00", "Europe/Zurich").toISOString(),
    "2026-07-15T07:00:00.000Z",
  );
});

await test("timezone Europe Zurich mantiene la hora local alrededor de cambios DST", () => {
  assert.equal(
    __test.localDateTimeToUtc("2026-03-29", "09:00", "Europe/Zurich").toISOString(),
    "2026-03-29T07:00:00.000Z",
  );
  assert.equal(
    __test.localDateTimeToUtc("2026-10-25", "09:00", "Europe/Zurich").toISOString(),
    "2026-10-25T08:00:00.000Z",
  );
});

await test("alerts relativas y exactas calculan notify_at sin caer en Europe/Madrid", () => {
  const reminder = { target_date: "2026-07-15", target_time: "09:00", timezone: "Europe/Zurich" };
  assert.equal(
    __test.resolveAlertNotifyAt({ mode: "relative", minutesBefore: 120 }, reminder).toISOString(),
    "2026-07-15T05:00:00.000Z",
  );
  assert.equal(
    __test.resolveAlertNotifyAt({ mode: "absolute", notifyAt: "2026-07-15T06:30:00.000Z" }, reminder).toISOString(),
    "2026-07-15T06:30:00.000Z",
  );
});

await test("POST reminder materializa inmediatamente el caso 25 agosto a 29 agosto 09 Zurich", async () => {
  const db = makeReminderMaterializationDb(new Date("2026-08-25T22:49:05.343Z"));
  const result = await __test.createReminderRecord({
    title: "Clase",
    targetDate: "2026-08-29",
    targetTime: "09:00",
    timezone: "Europe/Zurich",
    alerts: [
      { mode: "relative", minutesBefore: 120 },
      { mode: "relative", minutesBefore: 0 },
    ],
    recurrence: { type: "none", startDate: "2026-08-29", endDate: "2026-08-29", dailyTargetCount: 1, rule: {} },
  }, "", db);

  assert.equal(result.created, true);
  assert.equal(db.state.alerts.length, 2);
  assert.deepEqual(
    db.state.alerts.map((alert) => new Date(alert.notify_at).toISOString()).sort(),
    ["2026-08-29T05:00:00.000Z", "2026-08-29T07:00:00.000Z"],
  );
  assert.deepEqual(
    result.reminder.alerts.map((alert) => alert.notifyAt).sort(),
    ["2026-08-29T05:00:00.000Z", "2026-08-29T07:00:00.000Z"],
  );
});

await test("GET/list no materializa alerts ni cambia updated_at", () => {
  const listSource = serverSource.slice(
    serverSource.indexOf("async function listReminderRecords({"),
    serverSource.indexOf("async function cancelReminderRecord"),
  );
  const getSource = serverSource.slice(
    serverSource.indexOf("async function getReminderById"),
    serverSource.indexOf("function reminderAlertRowToInput"),
  );
  assert.doesNotMatch(listSource, /UPDATE reminders|INSERT INTO reminder_alerts|ensureReminderAlerts/);
  assert.doesNotMatch(getSource, /UPDATE reminders|INSERT INTO reminder_alerts|ensureReminderAlerts/);
});

await test("PATCH title con payload completo no borra, recrea ni versiona alerts", async () => {
  const db = makeReminderMaterializationDb(new Date("2026-08-25T22:49:05.343Z"));
  const created = await __test.createReminderRecord({
    title: "Clase",
    description: "Original",
    category: "Deutsch",
    emoji: "\u23f0",
    targetDate: "2026-08-29",
    targetTime: "09:00",
    timezone: "Europe/Zurich",
    alerts: [
      { mode: "relative", minutesBefore: 120 },
      { mode: "relative", minutesBefore: 0 },
    ],
    recurrence: { type: "none", startDate: "2026-08-29", endDate: "2026-08-29", dailyTargetCount: 1, rule: {} },
  }, "", db);
  db.state.alertInsertCount = 0;
  db.state.alertUpdateCount = 0;
  db.state.alertCancelCount = 0;

  await __test.patchReminderRecord(created.reminder.id, {
    ...created.reminder,
    title: "Clase B2",
  }, db);

  assert.equal(db.state.reminder.schedule_version, 1);
  assert.equal(db.state.alertInsertCount, 0);
  assert.equal(db.state.alertUpdateCount, 0);
  assert.equal(db.state.alertCancelCount, 0);
  assert.deepEqual(
    db.state.alerts.map((alert) => new Date(alert.notify_at).toISOString()).sort(),
    ["2026-08-29T05:00:00.000Z", "2026-08-29T07:00:00.000Z"],
  );
});

await test("PATCH description category y emoji tampoco tocan schedule", async () => {
  const db = makeReminderMaterializationDb();
  const created = await __test.createReminderRecord({
    title: "Pago",
    description: "Original",
    category: "Casa",
    emoji: "\u23f0",
    targetDate: "2026-08-29",
    targetTime: "09:00",
    timezone: "Europe/Zurich",
    alerts: [{ mode: "relative", minutesBefore: 0 }],
    recurrence: { type: "none", startDate: "2026-08-29", endDate: "2026-08-29", dailyTargetCount: 1, rule: {} },
  }, "", db);
  db.state.alertInsertCount = 0;
  db.state.alertUpdateCount = 0;
  db.state.alertCancelCount = 0;

  await __test.patchReminderRecord(created.reminder.id, {
    ...created.reminder,
    description: "Nueva",
    category: "Admin",
    emoji: "\ud83d\udccc",
  }, db);

  assert.equal(db.state.reminder.schedule_version, 1);
  assert.equal(db.state.alertInsertCount + db.state.alertUpdateCount + db.state.alertCancelCount, 0);
});

await test("cambio de hora recalcula pendientes sin borrar historial", async () => {
  const db = makeReminderMaterializationDb();
  const created = await __test.createReminderRecord({
    title: "Clase",
    targetDate: "2026-08-29",
    targetTime: "09:00",
    timezone: "Europe/Zurich",
    alerts: [{ mode: "relative", minutesBefore: 120 }, { mode: "relative", minutesBefore: 0 }],
    recurrence: { type: "none", startDate: "2026-08-29", endDate: "2026-08-29", dailyTargetCount: 1, rule: {} },
  }, "", db);
  db.state.alertInsertCount = 0;
  db.state.alertUpdateCount = 0;

  await __test.patchReminderRecord(created.reminder.id, {
    ...created.reminder,
    targetTime: "10:00",
  }, db);

  assert.equal(db.state.reminder.schedule_version, 2);
  assert.equal(db.state.alertInsertCount, 0);
  assert.equal(db.state.alertUpdateCount, 2);
  assert.deepEqual(
    db.state.alerts.map((alert) => new Date(alert.notify_at).toISOString()).sort(),
    ["2026-08-29T06:00:00.000Z", "2026-08-29T08:00:00.000Z"],
  );
});

await test("cambio real de alerts cancela obsoletas e inserta faltantes sin DELETE", async () => {
  const db = makeReminderMaterializationDb();
  const created = await __test.createReminderRecord({
    title: "Clase",
    targetDate: "2026-08-29",
    targetTime: "09:00",
    timezone: "Europe/Zurich",
    alerts: [{ mode: "relative", minutesBefore: 120 }, { mode: "relative", minutesBefore: 0 }],
    recurrence: { type: "none", startDate: "2026-08-29", endDate: "2026-08-29", dailyTargetCount: 1, rule: {} },
  }, "", db);
  db.state.alertInsertCount = 0;
  db.state.alertCancelCount = 0;

  await __test.patchReminderRecord(created.reminder.id, {
    ...created.reminder,
    alerts: [{ mode: "relative", minutesBefore: 10 }, { mode: "relative", minutesBefore: 0 }],
  }, db);

  assert.equal(db.state.reminder.schedule_version, 2);
  assert.equal(db.state.alertInsertCount, 1);
  assert.equal(db.state.alertCancelCount, 1);
  assert.equal(db.state.alerts.find((alert) => alert.minutes_before === 120).status, "cancelled");
  assert.equal(db.state.alerts.find((alert) => alert.minutes_before === 10).status, "pending");
  assert.doesNotMatch(serverSource, /DELETE FROM reminder_alerts/);
});

await test("reminder antiguo sin alerts se reconcilia una vez y no duplica", async () => {
  const db = makeReminderMaterializationDb(new Date("2026-08-29T07:26:20.985Z"));
  db.state.reminder = {
    id: "00000000-0000-4000-8000-000000000925",
    firebase_uid: "legacy",
    title: "Clase",
    description: "",
    emoji: "\u23f0",
    type: "normal",
    category: null,
    target_date: "2026-08-29",
    target_time: "09:00",
    timezone: "Europe/Zurich",
    source_type: "bookshell",
    source_external_id: null,
    source_metadata: { bookshellLegacy: { remindBefore: [{ amount: 2, unit: "hours" }] } },
    recurrence_type: "none",
    recurrence_start_date: "2026-08-29",
    recurrence_end_date: null,
    recurrence_daily_target_count: 1,
    recurrence_rule: {},
    status: "pending",
    completed_at: null,
    schedule_version: 1,
    created_at: new Date("2026-08-25T22:49:05.343Z"),
    updated_at: new Date("2026-08-25T22:49:05.343Z"),
  };

  const first = await __test.reconcilePendingReminderAlerts({ db });
  const second = await __test.reconcilePendingReminderAlerts({ db });

  assert.equal(first.alertsCreated, 2);
  assert.equal(second.alertsCreated, 0);
  assert.equal(db.state.alerts.length, 2);
  assert.deepEqual(
    db.state.alerts.map((alert) => new Date(alert.notify_at).toISOString()).sort(),
    ["2026-08-29T05:00:00.000Z", "2026-08-29T07:00:00.000Z"],
  );
  assert.equal(db.state.reminder.updated_at.toISOString(), "2026-08-25T22:49:05.343Z");
});

await test("reconciliacion no revive sent ni cancelled", async () => {
  const db = makeReminderMaterializationDb();
  db.state.reminder = {
    id: "00000000-0000-4000-8000-000000000925",
    firebase_uid: "legacy",
    title: "Clase",
    target_date: "2026-08-29",
    target_time: "09:00",
    timezone: "Europe/Zurich",
    source_metadata: { bookshellLegacy: { remindBefore: [{ amount: 2, unit: "hours" }] } },
    recurrence_type: "none",
    recurrence_start_date: "2026-08-29",
    recurrence_daily_target_count: 1,
    recurrence_rule: {},
    status: "pending",
    schedule_version: 1,
    created_at: db.state.now,
    updated_at: db.state.now,
  };
  db.state.alerts = [
    {
      id: "sent-main",
      reminder_id: db.state.reminder.id,
      mode: "relative",
      minutes_before: 0,
      notify_at: new Date("2026-08-29T07:00:00.000Z"),
      status: "sent",
      channel: "telegram",
      created_at: db.state.now,
      updated_at: db.state.now,
    },
    {
      id: "cancelled-advance",
      reminder_id: db.state.reminder.id,
      mode: "relative",
      minutes_before: 120,
      notify_at: new Date("2026-08-29T05:00:00.000Z"),
      status: "cancelled",
      channel: "telegram",
      created_at: db.state.now,
      updated_at: db.state.now,
    },
  ];

  const result = await __test.reconcilePendingReminderAlerts({ db });

  assert.equal(result.alertsCreated, 0);
  assert.equal(db.state.alerts.find((alert) => alert.id === "sent-main").status, "sent");
  assert.equal(db.state.alerts.find((alert) => alert.id === "cancelled-advance").status, "cancelled");
});

await test("scheduler server-side reclama 09:00 en el siguiente tick sin frontend y no duplica", async () => {
  const now = new Date("2026-01-15T08:00:30.000Z");
  const db = makeReminderSchedulerDb(now);
  const pushes = [];
  const pushSender = async (_db, _provider, payload, options) => {
    pushes.push({ payload, options });
    return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [{ accepted: true }] };
  };
  const tick = () => __test.runReminderSchedulerTick({
    ensureSchemas: false,
    now,
    nowFn: () => now,
    dueReminderAlertPushCycle: (options) => __test.runDueReminderAlertPushCycle({
      ...options,
      db,
      provider: {},
      pushConfigured: true,
      pushSender,
      nowFn: () => now,
    }),
    dailySummaryPushCycle: async () => ({ ok: true, claimed: false, sent: false }),
  });

  await tick();
  await tick();

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.type, "reminder");
  assert.equal(pushes[0].payload.notifyAt, "2026-01-15T08:00:00.000Z");
  assert.equal(pushes[0].payload.claimedAt, "2026-01-15T08:00:30.000Z");
  assert.equal(pushes[0].payload.latenessMs, 30000);
  assert.equal(pushes[0].payload.catchUp, false);
  assert.deepEqual(pushes[0].options, { ttl: 300, urgency: "high" });
  assert.equal(db.state.alert.status, "sent");
  assert.equal(db.state.alert.sent_at.toISOString(), "2026-01-15T08:00:30.000Z");
  assert.equal(db.state.alert.provider_accepted_at.toISOString(), "2026-01-15T08:00:30.000Z");
  assert.equal(db.state.alert.delivery_lateness_ms, 30000);
});

await test("catch-up tras downtime queda trazado como late pero se envia una sola vez si no expiro", async () => {
  const now = new Date("2026-01-15T08:27:00.000Z");
  const db = makeReminderSchedulerDb(now);
  const pushes = [];
  await __test.runDueReminderAlertPushCycle({
    db,
    provider: {},
    pushConfigured: true,
    nowFn: () => now,
    pushSender: async (_db, _provider, payload, options) => {
      pushes.push({ payload, options });
      return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [{ accepted: true }] };
    },
  });
  await __test.runDueReminderAlertPushCycle({
    db,
    provider: {},
    pushConfigured: true,
    nowFn: () => now,
    pushSender: async () => {
      throw new Error("duplicate_push");
    },
  });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.latenessMs, 27 * 60 * 1000);
  assert.equal(pushes[0].payload.catchUp, true);
  assert.equal(db.state.alert.delivery_lateness_ms, 27 * 60 * 1000);
});

await test("envio server-side no depende de visibilitychange focus ni timers del navegador", () => {
  const deliverySource = String(__test.deliverClaimedReminderAlerts);
  assert.doesNotMatch(deliverySource, /window|document|visibilitychange|focus|setInterval|setTimeout|Notification/);
  assert.match(serverSource, /startReminderScheduler\(\)/);
  assert.match(serverSource, /const tick = \(\) =>/);
  assert.match(serverSource, /tick\(\);\s+return reminderSchedulerTimer/);
});

await test("un tick lento no lanza un segundo procesamiento concurrente", async () => {
  let releaseTick = null;
  let calls = 0;
  const slowTick = __test.runReminderSchedulerTick({
    ensureSchemas: false,
    now: new Date("2026-01-15T08:00:00.000Z"),
    dueReminderAlertPushCycle: async () => {
      calls += 1;
      await new Promise((resolve) => { releaseTick = resolve; });
      return { ok: true, claimed: 0, sent: 0, failed: 0 };
    },
    dailySummaryPushCycle: async () => ({ ok: true, claimed: false, sent: false }),
  });
  await Promise.resolve();
  const skipped = await __test.runReminderSchedulerTick({ ensureSchemas: false });
  assert.deepEqual(skipped, { ok: true, skipped: true, reason: "tick_in_flight" });
  assert.equal(calls, 1);
  releaseTick();
  await slowTick;
});

await test("diagnostico autenticado del scheduler expone estado efectivo sin secretos", async () => {
  const db = makeReminderSchedulerDb(new Date("2026-01-15T08:00:30.000Z"));
  const diagnostics = await __test.getReminderSchedulerDiagnostics({ db });
  assert.equal(diagnostics.enabled, __test.schedulerConfig.enabled);
  assert.equal(diagnostics.intervalMs, __test.schedulerConfig.intervalMs);
  assert.equal(diagnostics.pushConfigured, __test.pushConfig.configured);
  assert.equal(diagnostics.activePushSubscriptions, 1);
  assert.equal(diagnostics.defaults.BOOKSHELL_REMINDER_SCHEDULER, "1");
  assert.equal(diagnostics.defaults.BOOKSHELL_REMINDER_SCHEDULER_INTERVAL_MS, 60000);
  assert.equal(JSON.stringify(diagnostics).includes("VAPID_PRIVATE_KEY"), false);
  assert.match(serverSource, /url\.pathname === "\/automation\/reminder-scheduler\/status"/);
  assert.match(serverSource, /isAutomationAuthorized\(req\)/);
});

await test("migracion conserva diagnostico persistente de alertas", () => {
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS claimed_at/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS provider_accepted_at/);
  assert.match(migrationSource, /ADD COLUMN IF NOT EXISTS delivery_lateness_ms/);
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
