import assert from "node:assert/strict";
import {
  buildReminderOccurrenceKey,
  createReminderNotificationGuard,
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

await test("recibir el mismo reminder 20 veces genera una sola notificacion", () => {
  const guard = createReminderNotificationGuard();
  const reminder = { id: "rem_107", status: "pendiente", dismissedAlerts: [] };
  const alert = { id: "alert_checkout", status: "pending", minutesBefore: 0 };
  const key = buildReminderOccurrenceKey(reminder, { alert, targetAt: 1787745600000, kind: "alert" });
  let queued = 0;
  for (let index = 0; index < 20; index += 1) {
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
  guard.clear();
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
