import assert from "node:assert/strict";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { __test } = require("../deploy-bookshell-api-server.js");
const source = readFileSync(new URL("../deploy-bookshell-api-server.js", import.meta.url), "utf8");

async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}

function fixture(initialData = {}) {
  let data = structuredClone(initialData);
  const token = "jrv_fixture_secret";
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const calls = [];
  const query = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/CREATE TABLE IF NOT EXISTS jarvis_api_tokens/.test(sql)) return { rows: [], rowCount: 0 };
    if (/SELECT id, token_hash, scopes\s+FROM jarvis_api_tokens/.test(sql)) {
      return { rows: [{ id: "token-1", token_hash: tokenHash, scopes: ["books:read", "books:write", "gym:write", "habits:write"] }], rowCount: 1 };
    }
    if (/UPDATE jarvis_api_tokens/.test(sql)) return { rows: [], rowCount: 1 };
    if (/SELECT id, data\s+FROM firebase_import_raw/.test(sql)) return { rows: [{ id: "raw-1", data }], rowCount: 1 };
    if (/UPDATE firebase_import_raw SET data/.test(sql)) {
      data = JSON.parse(params[0]);
      return { rows: [], rowCount: 1 };
    }
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 0 };
  };
  const client = { query, release() {} };
  return { token, calls, db: { query, connect: async () => client }, data: () => data };
}

await test("JARVIS bearer is independent and scope-based", async () => {
  const fx = fixture();
  const authenticated = await __test.authenticateJarvisRequest({ headers: { authorization: `Bearer ${fx.token}` } }, fx.db);
  const rejected = await __test.authenticateJarvisRequest({ headers: { authorization: "Bearer wrong" } }, fx.db);
  assert.equal(__test.jarvisScopeAllowed(authenticated, "books", "write"), true);
  assert.equal(__test.jarvisScopeAllowed(authenticated, "finance", "write"), false);
  assert.equal(rejected, null);
});

await test("book progress updates page, reading log, timestamps and read-back", async () => {
  const fx = fixture({ books: { books: { musashi: { title: "Musashi", pages: 500, currentPage: 221, status: "reading", updatedAt: 1 } }, readingLog: {} } });
  const now = new Date("2026-09-19T10:00:00.000Z");
  const result = await __test.updateJarvisBookProgress({ title: "Musashi", page: 222 }, fx.db, now);
  assert.equal(result.updated, true);
  assert.equal(result.verified, true);
  assert.equal(result.previousPage, 221);
  assert.equal(result.book.currentPage, 222);
  assert.equal(fx.data().books.readingLog["2026-09-19"].musashi, 1);
  const readback = await __test.queryJarvisBooks({ mode: "current", title: "Musashi" }, fx.db);
  assert.equal(readback.book.currentPage, 222);
  assert.equal(readback.book.lastReadingDate, "2026-09-19");
});

await test("book progress without an id resolves the same current reading book as GET", async () => {
  const fx = fixture({ books: { books: {
    finished: { title: "Anterior", pages: 100, currentPage: 100, status: "finished", updatedAt: 500 },
    musashi: { title: "Musashi", pages: 575, currentPage: 221, status: "reading", updatedAt: 100 },
  }, readingLog: {} } });
  const current = await __test.queryJarvisBooks({ mode: "current" }, fx.db);
  const result = await __test.updateJarvisBookProgress({ page: 222 }, fx.db, new Date("2026-09-19T10:00:00Z"));
  assert.equal(current.book.id, "musashi");
  assert.equal(result.book.id, current.book.id);
  assert.equal(fx.data().books.books.musashi.currentPage, 222);
  assert.equal(fx.data().books.books.finished.currentPage, 100);
});

await test("habit mark writes canonical store atomically", async () => {
  const fx = fixture({ habits: { habits: { german: { name: "Alemán", goal: "count", schedule: { type: "daily" } } }, habitCounts: {} } });
  const result = await __test.markJarvisHabit({ name: "Aleman", date: "2026-09-19", value: 2 }, fx.db);
  assert.equal(result.verified, true);
  assert.equal(fx.data().habits.habitCounts.german["2026-09-19"], 2);
});

await test("gym session computes totals, updates template and is idempotent", async () => {
  const fx = fixture({ gym: { gym: { workouts: {}, templates: {} } } });
  const input = {
    date: "2026-09-19", name: "Torso", idempotencyKey: "turn-42",
    exercises: { press: { sets: [{ reps: 10, kg: 20, done: true }, { reps: 5, kg: 20, done: true }] } },
  };
  const created = await __test.createJarvisGymSession(input, fx.db, new Date("2026-09-19T10:00:00Z"));
  const repeated = await __test.createJarvisGymSession(input, fx.db, new Date("2026-09-19T10:01:00Z"));
  assert.equal(created.created, true);
  assert.equal(created.workout.totalReps, 15);
  assert.equal(created.workout.totalVolumeKg, 300);
  assert.equal(repeated.created, false);
  assert.equal(repeated.workout.id, created.workout.id);
  assert.equal(Object.keys(fx.data().gym.gym.workouts["2026-09-19"]).length, 1);
  assert.deepEqual(fx.data().gym.gym.templates.torso.exerciseIds, ["press"]);
});

await test("server exposes protected domain routes and never accepts frontend token", () => {
  assert.match(source, /url\.pathname === "\/jarvis\/capabilities"/);
  assert.match(source, /url\.pathname === "\/jarvis\/books\/progress"/);
  assert.match(source, /url\.pathname === "\/jarvis\/reminders"/);
  assert.match(source, /url\.pathname === "\/jarvis\/finance\/movements"/);
  assert.match(source, /url\.pathname === "\/jarvis\/gym\/sessions"/);
  assert.match(source, /INVALID_JARVIS_TOKEN/);
  assert.doesNotMatch(source, /VITE_.*JARVIS.*TOKEN/);
});
