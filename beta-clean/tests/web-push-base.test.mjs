import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { __test } = require("../deploy-bookshell-api-server.js");

async function test(name, fn) {
  try { await fn(); console.log(`ok - ${name}`); }
  catch (error) { console.error(`not ok - ${name}`); throw error; }
}

const subscription = { endpoint: "https://push.example/sub-1", keys: { p256dh: "public-key", auth: "auth-secret" } };

await test("subscription UPSERT is keyed by endpoint and re-enables the installation", async () => {
  const calls = [];
  const db = { query: async (sql, params) => { calls.push({ sql, params }); return { rows: [{ id: "push-1" }] }; } };
  await __test.upsertPushSubscription(db, subscription, "Test Agent");
  assert.match(calls[0].sql, /ON CONFLICT \(endpoint\) DO UPDATE/);
  assert.match(calls[0].sql, /disabled_at = NULL/);
  assert.deepEqual(calls[0].params.slice(1, 4), [subscription.endpoint, "public-key", "auth-secret"]);
});

await test("test push serializes JSON and records provider acceptance", async () => {
  const calls = [];
  const db = { query: async (sql) => {
    calls.push(sql);
    if (/SELECT id/.test(sql)) return { rows: [{ id: "push-1", ...subscription, p256dh: "public-key", auth: "auth-secret" }] };
    return { rows: [], rowCount: 1 };
  } };
  const provider = { sendNotification: async (_sub, payload) => { assert.equal(JSON.parse(payload).type, "test"); return { statusCode: 201 }; } };
  const result = await __test.sendPushToEndpoint(db, provider, subscription.endpoint, { title: "Bookshell", type: "test" });
  assert.equal(result.accepted, true);
  assert.ok(calls.some((sql) => /last_success_at/.test(sql)));
});

for (const statusCode of [404, 410]) {
  await test(`${statusCode} disables an expired subscription without throwing`, async () => {
    let failureUpdate = "";
    const db = { query: async (sql) => {
      if (/SELECT id/.test(sql)) return { rows: [{ id: "push-1", endpoint: subscription.endpoint, p256dh: "key", auth: "auth" }] };
      failureUpdate = sql; return { rows: [] };
    } };
    const provider = { sendNotification: async () => { throw Object.assign(new Error("gone"), { statusCode, body: "provider gone" }); } };
    const result = await __test.sendPushToEndpoint(db, provider, subscription.endpoint, { type: "test" });
    assert.equal(result.accepted, false);
    assert.equal(result.statusCode, statusCode);
    assert.match(failureUpdate, /disabled_at = CASE/);
    assert.match(failureUpdate, /failure_count = failure_count \+ 1/);
  });
}

await test("provider errors become results and do not escape to crash the API", async () => {
  const db = { query: async (sql) => /SELECT id/.test(sql)
    ? { rows: [{ id: "push-1", endpoint: subscription.endpoint, p256dh: "key", auth: "auth" }] } : { rows: [] } };
  const result = await __test.sendPushToEndpoint(db, { sendNotification: async () => { throw new Error("network down"); } }, subscription.endpoint, { type: "test" });
  assert.deepEqual({ accepted: result.accepted, statusCode: result.statusCode, reason: result.reason }, { accepted: false, statusCode: 502, reason: "network down" });
});

await test("public test config never exports the VAPID private key", () => {
  assert.deepEqual(Object.keys(__test.pushConfig).sort(), ["configured", "publicKey"]);
  const source = readFileSync(new URL("../deploy-bookshell-api-server.js", import.meta.url), "utf8");
  assert.doesNotMatch(source, /vapidPrivateKey\s*:/);
});
