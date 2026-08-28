import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { __test } = require("../deploy-bookshell-api-server.js");
const serverSource = readFileSync(new URL("../deploy-bookshell-api-server.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../scripts/app/main.js", import.meta.url), "utf8");
const pushSource = readFileSync(new URL("../scripts/shared/push/web-push.js", import.meta.url), "utf8");
const docsSource = readFileSync(new URL("../docs/backend-api-contract.md", import.meta.url), "utf8");

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function makeExportData() {
  return {
    meta: {
      schemaVersion: 2,
      ui: {
        navLayout: { version: 4, order: ["view-notes", "view-world"] },
      },
    },
    books: {
      books: { book_1: { id: "book_1", title: "Solaris" } },
      readingLog: { log_1: { id: "log_1", bookId: "book_1", pages: 12 } },
    },
    notes: {
      folders: { folder_1: { id: "folder_1", name: "Ideas" } },
      notes: { note_1: { id: "note_1", title: "V2", content: "Portable backup" } },
      reminderPreferences: { view: "calendar" },
    },
    finance: {
      finance: {
        accounts: { acc_1: { id: "acc_1", name: "Revolut", currency: "EUR" } },
        transactions: { tx_1: { id: "tx_1", amount: 12, category: "Comida" } },
        recurring: { rec_1: { id: "rec_1", amount: 9.99 } },
        preferences: { accountOrder: { acc_1: 1 } },
      },
    },
    world: {
      geography: { geo_1: { id: "geo_1", name: "Interlaken" } },
      places: { place_1: { id: "place_1", name: "Cafe Central" } },
      saved: { saved_1: { id: "saved_1", lat: 46.686, lon: 7.861 } },
      stays: { stay_1: { id: "stay_1", country: "Switzerland" } },
      categoryEmojis: { cafeteria: { key: "cafeteria", category: "Cafeteria" } },
      watch: { ch: true },
    },
    habits: {
      habits: { habit_1: { id: "habit_1", name: "Leer" } },
      habitSessions: { habit_1: { "2026-08-29": { totalSec: 1800 } } },
      habitPrefs: { quickCounters: ["habit_1"] },
    },
    recipes: {
      items: { recipe_1: { id: "recipe_1", title: "Pasta" } },
      nutrition: { products: [{ name: "Tomate" }] },
    },
    gym: {
      gym: {
        exercises: { ex_1: { id: "ex_1", name: "Squat" } },
        workouts: { wo_1: { id: "wo_1", date: "2026-08-29" } },
      },
    },
  };
}

function makeDb({
  data = makeExportData(),
  reminders = [
    {
      id: "11111111-1111-4111-8111-111111111111",
      title: "Pagar seguro",
      description: "Antes del lunes",
      emoji: "clock",
      type: "task",
      category: "Coche",
      target_date: "2026-08-29",
      target_time: "09:30:00",
      timezone: "Europe/Madrid",
      source_type: "bookshell",
      source_external_id: "local-rem-1",
      source_metadata: { groupId: "batch_1" },
      recurrence_type: "weekly",
      recurrence_start_date: "2026-08-29",
      recurrence_end_date: "2026-12-31",
      recurrence_daily_target_count: 1,
      recurrence_rule: { weekdays: [6] },
      status: "pending",
      completed_at: null,
      schedule_version: 3,
      created_at: "2026-08-29T07:00:00.000Z",
      updated_at: "2026-08-29T07:30:00.000Z",
    },
  ],
  alerts = [
    {
      id: "alert-1",
      reminder_id: "11111111-1111-4111-8111-111111111111",
      mode: "relative",
      minutes_before: 60,
      notify_at: "2026-08-29T06:30:00.000Z",
      channel: "telegram",
      status: "pending",
      sent_at: null,
      failed_at: null,
      error_message: "",
    },
  ],
} = {}) {
  const calls = [];
  const forbidden = [
    "shortcut_api_tokens",
    "shortcut_idempotency_keys",
    "push_subscriptions",
    "reminder_notification_deliveries",
    "data_usage_log",
  ];

  const db = {
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      const compact = String(sql).toLowerCase();
      for (const table of forbidden) {
        if (compact.includes(table)) throw new Error(`forbidden_export_source:${table}`);
      }
      if (compact.includes("from firebase_import_raw")) {
        return {
          rows: [{ id: "raw-1", data, imported_at: "2026-08-28T20:00:00.000Z" }],
          rowCount: 1,
        };
      }
      if (compact.includes("from reminders")) {
        return { rows: reminders, rowCount: reminders.length };
      }
      if (compact.includes("from reminder_alerts")) {
        const rows = alerts.filter((alert) => alert.reminder_id === params[0]);
        return { rows, rowCount: rows.length };
      }
      return { rows: [], rowCount: 0 };
    },
  };
  return { db, calls, data, reminders, alerts };
}

function makeHttpPair() {
  const req = { headers: {} };
  const res = {
    status: 0,
    headers: null,
    body: "",
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
    },
    end(body = "") {
      this.body = String(body || "");
    },
  };
  return { req, res };
}

await test("GET /export requiere autenticacion antes de construir la copia", async () => {
  const { req, res } = makeHttpPair();
  const { db, calls } = makeDb();
  await __test.sendBookshellExport(req, res, {
    db,
    authenticate: async () => null,
  });
  assert.equal(res.status, 401);
  assert.equal(JSON.parse(res.body).error, "AUTH_REQUIRED");
  assert.equal(calls.length, 0);
  assert.match(serverSource, /url\.pathname === "\/export"/);
  assert.doesNotMatch(serverSource, /searchParams\.get\("userId"\)/);
});

await test("exportacion construye JSON versionado con arbol principal y recordatorios externos", async () => {
  const { db, data } = makeDb();
  const exported = await __test.buildBookshellExport({
    db,
    now: new Date("2026-08-29T00:00:00.000Z"),
  });

  assert.equal(exported.schemaVersion, 1);
  assert.equal(exported.exportedAt, "2026-08-29T00:00:00.000Z");
  assert.equal(exported.app, "Bookshell");
  assert.equal(exported.user.id, "b403663c-3675-48fb-a82e-b921d78404b0");
  assert.deepEqual(exported.data, data);
  assert.equal(exported.reminders.length, 1);
  assert.equal(exported.reminders[0].title, "Pagar seguro");
  assert.equal(exported.reminders[0].recurrence.type, "weekly");
  assert.deepEqual(exported.reminders[0].recurrence.rule, { weekdays: [6] });
  assert.equal(exported.reminders[0].alerts[0].minutesBefore, 60);
  assert.equal(exported.otherPersistentData.sources.reminders.count, 1);
});

await test("exportacion preserva Mundo Finanzas Notas Libros Habitos Recetas Gym y preferencias persistentes", async () => {
  const { db } = makeDb();
  const exported = await __test.buildBookshellExport({ db });
  assert.equal(exported.data.world.saved.saved_1.lat, 46.686);
  assert.equal(exported.data.world.places.place_1.name, "Cafe Central");
  assert.equal(exported.data.finance.finance.accounts.acc_1.currency, "EUR");
  assert.equal(exported.data.finance.finance.recurring.rec_1.amount, 9.99);
  assert.equal(exported.data.notes.notes.note_1.title, "V2");
  assert.equal(exported.data.notes.reminderPreferences.view, "calendar");
  assert.equal(exported.data.books.books.book_1.title, "Solaris");
  assert.equal(exported.data.habits.habitPrefs.quickCounters[0], "habit_1");
  assert.equal(exported.data.recipes.items.recipe_1.title, "Pasta");
  assert.equal(exported.data.gym.gym.exercises.ex_1.name, "Squat");
  assert.deepEqual(exported.data.meta.ui.navLayout.order, ["view-notes", "view-world"]);
});

await test("exportacion no consulta ni serializa secretos operativos o datos tecnicos efimeros", async () => {
  const { db, calls } = makeDb();
  const exported = await __test.buildBookshellExport({ db });
  const queriedSql = calls.map((call) => call.sql).join("\n").toLowerCase();
  assert.doesNotMatch(queriedSql, /shortcut_api_tokens|shortcut_idempotency_keys|push_subscriptions|reminder_notification_deliveries|data_usage_log/);
  const json = JSON.stringify(exported);
  assert.doesNotMatch(json, /token_hash|super-secret-hash|p256dh|auth-secret|postgres:\/\/|vapid_private_value/);
  assert.equal(exported.otherPersistentData.excludedSources.shortcutApiTokens.includes("hash"), true);
});

await test("handler devuelve JSON descargable con filename por fecha", async () => {
  const { req, res } = makeHttpPair();
  const { db } = makeDb();
  await __test.sendBookshellExport(req, res, {
    db,
    now: new Date("2026-08-29T12:34:56.000Z"),
  });
  assert.equal(res.status, 200);
  assert.equal(res.headers["Content-Type"], "application/json");
  assert.equal(res.headers["Content-Disposition"], 'attachment; filename="bookshell-backup-2026-08-29.json"');
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.equal(JSON.parse(res.body).exportedAt, "2026-08-29T12:34:56.000Z");
  assert.equal(__test.formatExportFilename("2026-08-29T12:34:56.000Z"), "bookshell-backup-2026-08-29.json");
});

await test("exportacion es JSON serializable", async () => {
  const { db } = makeDb();
  const exported = await __test.buildBookshellExport({ db });
  const roundTrip = JSON.parse(JSON.stringify(exported));
  assert.equal(roundTrip.schemaVersion, 1);
  assert.equal(roundTrip.reminders[0].alerts[0].notifyAt, "2026-08-29T06:30:00.000Z");
});

await test("Ajustes descarga el backup desde backend y no desde el estado frontend", () => {
  assert.match(mainSource, /Datos y copias de seguridad/);
  assert.match(mainSource, /Exportar todos mis datos \(\.json\)/);
  assert.match(mainSource, /data-export-bookshell/);
  assert.match(mainSource, /downloadBookshellExport\(\)/);
  assert.match(pushSource, /fetch\(`\$\{API_BASE_URL\}\/export`/);
  assert.match(pushSource, /credentials: "include"/);
  assert.match(pushSource, /response\.blob\(\)/);
  assert.doesNotMatch(pushSource, /firebasePaths|readValue|window\.__bookshellCleanShellState/);
});

await test("contrato documenta fuentes incluidas y fuentes excluidas", () => {
  assert.match(docsSource, /GET \/export/);
  assert.match(docsSource, /firebase_import_raw/);
  assert.match(docsSource, /reminders/);
  assert.match(docsSource, /reminder_alerts/);
  assert.match(docsSource, /Shortcut token hashes/);
  assert.match(docsSource, /Web Push subscriptions/);
  assert.match(docsSource, /VAPID private key/);
});
