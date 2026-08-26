import assert from "node:assert/strict";
import {
  createReminder,
  deleteReminder,
  listDueReminderAlerts,
  listReminders,
  normalizeCanonicalReminder,
} from "../scripts/shared/data/reminders-api.js";
import { mapReminderFromDb } from "../scripts/modules/notes/persist/notes-mapper.js";

const calls = [];

globalThis.fetch = async (url, options = {}) => {
  calls.push({ url: String(url), options });
  return {
    ok: true,
    status: 200,
    json: async () => ({ id: "rem_test_1" }),
  };
};

function lastCall() {
  return calls[calls.length - 1];
}

function parseLastBody() {
  return JSON.parse(lastCall().options.body);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

await test("creation maps legacy fields to canonical reminder payload", async () => {
  await createReminder({
    title: "Comprar pan",
    date: "2026-08-26",
    type: "tarea",
    status: "pendiente",
    categories: ["Casa"],
    remindBefore: [{ amount: 15, unit: "minutes" }],
    source: { type: "telegram", externalId: "tg-42" },
  });
  const body = parseLastBody();
  assert.equal(lastCall().url, "https://api-bookshell.charlydob.com/reminders");
  assert.equal(lastCall().options.method, "POST");
  assert.equal(lastCall().options.credentials, "include");
  assert.equal(body.targetDate, "2026-08-26");
  assert.equal(body.type, "task");
  assert.equal(body.status, "pending");
  assert.equal(body.category, "Casa");
  assert.equal(body.alerts[0].minutesBefore, 15);
  assert.equal(body.source.externalId, "tg-42");
});

await test("listing sends range filters without user id", async () => {
  await listReminders({ status: "pending", from: "2026-08-25", until: "2026-08-31", limit: 50, userId: "frontend-must-not-send-this" });
  assert.equal(lastCall().url, "https://api-bookshell.charlydob.com/reminders?status=pending&from=2026-08-25&until=2026-08-31&limit=50");
  assert.equal(lastCall().options.credentials, "include");
});

await test("cancellation calls DELETE on the canonical endpoint", async () => {
  await deleteReminder("rem_test_1");
  assert.equal(lastCall().url, "https://api-bookshell.charlydob.com/reminders/rem_test_1");
  assert.equal(lastCall().options.method, "DELETE");
});

await test("several alerts are preserved and converted", () => {
  const reminder = normalizeCanonicalReminder({
    targetDate: "2026-08-26",
    remindBefore: [
      { amount: 5, unit: "minutes" },
      { amount: 2, unit: "hours" },
      { amount: 1, unit: "days" },
    ],
  });
  assert.deepEqual(reminder.alerts.map((alert) => alert.minutesBefore), [5, 120, 1440]);
});

await test("annual recurrence is normalized", () => {
  const reminder = normalizeCanonicalReminder({
    targetDate: "2026-08-26",
    recurrence: { type: "yearly" },
  });
  assert.equal(reminder.recurrence.type, "yearly");
});

await test("weekly recurrence is normalized", () => {
  const reminder = normalizeCanonicalReminder({
    targetDate: "2026-08-26",
    recurrence: { type: "weekly" },
  });
  assert.equal(reminder.recurrence.type, "weekly");
});

await test("monthly recurrence is normalized", () => {
  const reminder = normalizeCanonicalReminder({
    targetDate: "2026-08-26",
    recurrence: { type: "monthly" },
  });
  assert.equal(reminder.recurrence.type, "monthly");
});

await test("due alerts use the reminder alerts endpoint", async () => {
  await listDueReminderAlerts("2026-08-26T08:00:00Z");
  assert.equal(lastCall().url, "https://api-bookshell.charlydob.com/reminders/due?until=2026-08-26T08%3A00%3A00Z");
  assert.equal(lastCall().options.credentials, "include");
});

await test("canonical response maps back to legacy UI fields", () => {
  const reminder = mapReminderFromDb("rem_test_1", {
    id: "rem_test_1",
    title: "Pagar seguro",
    type: "task",
    status: "cancelled",
    targetDate: "2026-08-26",
    recurrence: { type: "weekly", startDate: "2026-08-26" },
    alerts: [{ id: "a1", mode: "relative", minutesBefore: 60, channel: "telegram", status: "pending" }],
    source: {
      type: "bookshell",
      metadata: {
        bookshellLegacy: {
          categories: ["Coche"],
          color: "#63d6ff",
          checklistItems: { one: { id: "one", text: "Revisar recibo" } },
        },
      },
    },
  });
  assert.equal(reminder.type, "tarea");
  assert.equal(reminder.status, "cancelado");
  assert.equal(reminder.repeat, "weekly");
  assert.deepEqual(reminder.categories, ["Coche"]);
  assert.equal(reminder.remindBefore[0].amount, 1);
  assert.equal(reminder.remindBefore[0].unit, "hours");
});

await test("source external id survives for idempotency", () => {
  const reminder = normalizeCanonicalReminder({
    targetDate: "2026-08-26",
    source: { type: "gmail", externalId: "message-123" },
  });
  assert.equal(reminder.source.type, "gmail");
  assert.equal(reminder.source.externalId, "message-123");
});
