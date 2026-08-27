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

await test("push schema migration is idempotent and creates table plus active index", async () => {
  const calls = [];
  const db = { query: async (sql) => { calls.push(sql); return { rows: [] }; } };
  await __test.ensurePushSubscriptionsSchema(db);
  await __test.ensurePushSubscriptionsSchema(db);
  assert.equal(calls.length, 1);
  assert.match(calls[0], /CREATE TABLE IF NOT EXISTS push_subscriptions/);
  assert.match(calls[0], /CREATE INDEX IF NOT EXISTS push_subscriptions_active_user_idx/);
});

await test("iOS manifest uses the deployed root-relative app identity", () => {
  const manifest = JSON.parse(readFileSync(new URL("../manifest.webmanifest", import.meta.url), "utf8"));
  assert.equal(manifest.start_url, ".");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.id, undefined);
  assert.equal(manifest.scope, undefined);
  assert.doesNotMatch(JSON.stringify(manifest), /\/beta-clean\//);
});

await test("iOS push support is detected from the service worker registration", () => {
  const source = readFileSync(new URL("../scripts/shared/push/web-push.js", import.meta.url), "utf8");
  assert.match(source, /registrationPushManagerAvailable = Boolean\(registration\?\.pushManager\)/);
  assert.match(source, /supported: serviceWorkerAvailable && registrationPushManagerAvailable && notificationAvailable/);
  assert.doesNotMatch(source, /supported:\s*[^\n]*"PushManager" in window/);
});

await test("temporary diagnostics expose each iOS Web Push prerequisite", () => {
  const source = readFileSync(new URL("../scripts/app/main.js", import.meta.url), "utf8");
  for (const label of [
    "URL actual", "display-mode standalone", "navigator.standalone", "serviceWorker disponible",
    "Service worker registration activa", "PushManager global disponible",
    "registration.pushManager disponible", "Notification disponible", "Notification.permission",
  ]) assert.match(source, new RegExp(label.replace(".", "\\.")));
});

await test("PWA boot cleanup cannot unregister workers or force a reload", () => {
  const mainSource = readFileSync(new URL("../scripts/app/main.js", import.meta.url), "utf8");
  const inlineBootSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.doesNotMatch(mainSource, /cache-purge:runtime:unregister-old-sw/);
  assert.doesNotMatch(mainSource, /BOOKSHELL_CACHE_PURGE_RELOAD_KEY/);
  assert.doesNotMatch(mainSource, /location\.replace\(buildCachePurgeReloadUrl/);
  assert.doesNotMatch(inlineBootSource, /purgeBookshellCachesAtBoot\("startup-version-check"\)/);
});

await test("service worker keeps active caches during activation", () => {
  const source = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  assert.match(source, /!ACTIVE_CACHE_NAMES\.includes\(key\)/);
  assert.match(source, /await precacheLocalAssets\(\);\s+const purgedKeys = await purgeBookshellCaches\("activate-stale-cache-cleanup"\)/);
  assert.doesNotMatch(source, /activate-force-purge/);
});
