import assert from "node:assert/strict";
import {
  buildReminderOccurrenceKey,
  createGenerationGate,
  createReminderNotificationGuard,
  createSingleTimerController,
  isTerminalReminderStatus,
  normalizeReminderRuntimeStatus,
} from "../scripts/modules/notes/reminders-runtime-guards.js";

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test("recibir el mismo reminder 100 veces, una por segundo, genera una sola notificacion", () => {
  const guard = createReminderNotificationGuard();
  const reminder = { id: "rem_107", status: "pendiente", dismissedAlerts: [] };
  const alert = { id: "alert_checkout", status: "pending", minutesBefore: 0 };
  const key = buildReminderOccurrenceKey(reminder, { alert, targetAt: 1787745600000, kind: "alert" });
  let queued = 0;
  for (let index = 0; index < 100; index += 1) {
    if (guard.shouldQueue({ reminder, alert, key })) queued += 1;
  }
  assert.equal(queued, 1);
});

await test("borrar mientras hay polling no reintroduce el reminder", () => {
  const guard = createReminderNotificationGuard();
  const reminder = { id: "rem_delete", status: "pendiente" };
  assert.equal(guard.markDeleted(reminder.id), true);
  assert.deepEqual(guard.filterDeleted([reminder]), []);
  assert.equal(
    guard.shouldQueue({ reminder, key: buildReminderOccurrenceKey(reminder, { targetAt: 1787745600000 }) }),
    false,
  );
});

await test("dos ticks simultaneos no duplican la misma ocurrencia", () => {
  const guard = createReminderNotificationGuard();
  const reminder = { id: "rem_tick", status: "pendiente" };
  const key = buildReminderOccurrenceKey(reminder, { targetAt: 1787745600000 });
  const results = [
    guard.shouldQueue({ reminder, key }),
    guard.shouldQueue({ reminder, key }),
  ];
  assert.deepEqual(results, [true, false]);
});

await test("reminder solo usa estados terminales canonicos; alertas sent/cancelled/failed no se muestran", () => {
  const guard = createReminderNotificationGuard();
  for (const status of ["cancelled", "completed", "expired", "cancelado", "completado", "vencido"]) {
    const reminder = { id: `rem_${status}`, status };
    const key = buildReminderOccurrenceKey(reminder, { targetAt: 1787745600000 });
    assert.equal(guard.shouldQueue({ reminder, key }), false);
  }
  assert.equal(normalizeReminderRuntimeStatus("sent"), "completado");
  assert.equal(normalizeReminderRuntimeStatus("failed"), "vencido");
  assert.equal(isTerminalReminderStatus("sent"), true);
  assert.equal(isTerminalReminderStatus("failed"), true);
  const reminder = { id: "rem_alert_terminal", status: "pendiente" };
  for (const status of ["sent", "cancelled", "failed"]) {
    const alert = { id: `alert_${status}`, status };
    const key = buildReminderOccurrenceKey(reminder, { alert, targetAt: 1787745600000, kind: "alert" });
    assert.equal(guard.shouldQueue({ reminder, alert, key }), false);
  }
});

await test("delete lento mantiene un solo request en vuelo", () => {
  const guard = createReminderNotificationGuard();
  const reminderId = "rem_slow_delete";
  let requests = 0;
  const sendDelete = () => {
    if (guard.isDeleteInFlight(reminderId)) return false;
    if (!guard.markDeleted(reminderId)) return false;
    requests += 1;
    return true;
  };
  assert.equal(sendDelete(), true);
  assert.equal(sendDelete(), false);
  assert.equal(sendDelete(), false);
  assert.equal(requests, 1);
});

await test("delete fallido restaura sin reencolar la ocurrencia anterior", () => {
  const guard = createReminderNotificationGuard();
  const reminder = { id: "rem_restore", status: "pendiente" };
  const key = buildReminderOccurrenceKey(reminder, { targetAt: 1787745600000 });
  assert.equal(guard.shouldQueue({ reminder, key }), true);
  assert.equal(guard.markDeleted(reminder.id), true);
  assert.equal(guard.markDeleteSettled(reminder.id, { restore: true }), true);
  assert.equal(guard.markDeleteSettled(reminder.id, { restore: true }), false);
  assert.equal(guard.shouldQueue({ reminder, key }), false);
});

await test("cambio de usuario limpia colas, tombstones y dedupe", () => {
  const guard = createReminderNotificationGuard();
  const reminder = { id: "rem_user_switch", status: "pendiente" };
  const key = buildReminderOccurrenceKey(reminder, { targetAt: 1787745600000 });
  assert.equal(guard.shouldQueue({ reminder, key }), true);
  assert.equal(guard.markDeleted(reminder.id), true);
  guard.clear({ occurrences: true });
  assert.equal(guard.isDeleted(reminder.id), false);
  assert.equal(guard.isDeleteInFlight(reminder.id), false);
  assert.equal(guard.shouldQueue({ reminder, key }), true);
});

await test("deduplica por reminderId mas alertId o scheduleVersion", () => {
  const reminder = { id: "rem_versioned", status: "pendiente", scheduleVersion: "v4" };
  const key = buildReminderOccurrenceKey(reminder, {
    alert: { id: "alert_1", status: "pending" },
    targetAt: 1787745600000,
    kind: "alert",
  });
  assert.equal(key, "rem_versioned:alert_1:v4:alert");
});

await test("una ocurrencia sobrevive a reinicializacion mediante sessionStorage", () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) || null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const reminder = { id: "rem_reload", status: "pendiente", scheduleVersion: "s1" };
  const alert = { id: "alert_reload", status: "pending" };
  const key = buildReminderOccurrenceKey(reminder, { alert, targetAt: 1, kind: "alert" });
  assert.equal(createReminderNotificationGuard({ storage }).shouldQueue({ reminder, alert, key }), true);
  assert.equal(createReminderNotificationGuard({ storage }).shouldQueue({ reminder, alert, key }), false);
});

await test("el registro persistente tiene TTL y limite", () => {
  let current = 1_000;
  const values = new Map();
  const storage = { getItem: (key) => values.get(key), setItem: (key, value) => values.set(key, value) };
  const guard = createReminderNotificationGuard({ storage, now: () => current, ttlMs: 100, limit: 2 });
  for (const id of ["a", "b", "c"]) {
    const reminder = { id, status: "pendiente" };
    guard.shouldQueue({ reminder, key: `${id}:due:1` });
    current += 1;
  }
  assert.equal(JSON.parse(values.values().next().value).length, 2);
  current += 200;
  assert.equal(guard.hasSeen("c:due:1"), false);
});

await test("solo arranca un reminderCheckTimer y stop permite reiniciarlo", () => {
  let starts = 0;
  let stops = 0;
  const timer = createSingleTimerController({
    setIntervalFn: () => { starts += 1; return starts; },
    clearIntervalFn: () => { stops += 1; },
  });
  timer.start(() => {}, 1000);
  timer.start(() => {}, 1000);
  assert.equal(starts, 1);
  timer.stop();
  assert.equal(stops, 1);
  timer.start(() => {}, 1000);
  assert.equal(starts, 2);
});

await test("respuesta de subscription vieja se ignora tras una nueva generation", () => {
  const gate = createGenerationGate();
  const oldGeneration = gate.next();
  const newGeneration = gate.next();
  assert.equal(gate.accepts(oldGeneration), false);
  assert.equal(gate.accepts(newGeneration), true);
});

await test("un re-render no toca el guard ni reencola toast", () => {
  const guard = createReminderNotificationGuard({ storage: null });
  const reminder = { id: "rem_render", status: "pendiente" };
  const key = buildReminderOccurrenceKey(reminder, { targetAt: 50 });
  assert.equal(guard.shouldQueue({ reminder, key }), true);
  const pureRender = (row) => `<button>${row.id}</button>`;
  for (let index = 0; index < 100; index += 1) pureRender(reminder);
  assert.equal(guard.shouldQueue({ reminder, key }), false);
});
