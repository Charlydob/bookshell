import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

const releaseSource = readFileSync(new URL("../scripts/shared/config/release.js", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../scripts/app/main.js", import.meta.url), "utf8");
const serviceWorkerSource = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
const worldViewSource = readFileSync(new URL("../views/world.html", import.meta.url), "utf8");
const worldSource = readFileSync(new URL("../scripts/modules/world/index.js", import.meta.url), "utf8");

await test("release unico alimenta HTML main y service worker", () => {
  assert.match(releaseSource, /__BOOKSHELL_RELEASE__/);
  assert.match(indexSource, /scripts\/shared\/config\/release\.js/);
  assert.match(indexSource, /main\.js\?v=/);
  assert.match(mainSource, /globalThis\.__BOOKSHELL_RELEASE__/);
  assert.match(serviceWorkerSource, /importScripts\("\.\/scripts\/shared\/config\/release\.js"\)/);
  assert.doesNotMatch(indexSource, /2026-08-28-reminder-delete-push-update-v1/);
  assert.doesNotMatch(mainSource, /2026-08-28-reminder-delete-push-update-v1/);
  assert.doesNotMatch(serviceWorkerSource, /2026-08-29-data-export-latlon-v1/);
});

await test("service worker activa releases nuevas y limpia caches antiguas sin borrar storage local", () => {
  assert.match(serviceWorkerSource, /self\.skipWaiting\(\)/);
  assert.match(serviceWorkerSource, /self\.clients\.claim\(\)/);
  assert.match(serviceWorkerSource, /purgeBookshellCaches\("activate-stale-cache-cleanup"\)/);
  assert.match(serviceWorkerSource, /BOOKSHELL_SKIP_WAITING/);
  assert.doesNotMatch(serviceWorkerSource, /indexedDB\.deleteDatabase|localStorage\.clear|caches\.delete\([^)]*localStorage/);
});

await test("frontend comprueba updates al volver a primer plano y recarga una sola vez", () => {
  assert.match(mainSource, /registration\.update\(\)/);
  assert.match(mainSource, /visibilitychange/);
  assert.match(mainSource, /pageshow/);
  assert.match(mainSource, /focus/);
  assert.match(mainSource, /SW_UPDATE_CHECK_MIN_INTERVAL_MS/);
  assert.match(mainSource, /consumeServiceWorkerReloadPending/);
  assert.match(mainSource, /controllerchange/);
});

await test("assets dinamicos usan release query y HTML de vistas se pide no-store", () => {
  assert.match(mainSource, /function resolveVersionedAppUrl/);
  assert.match(mainSource, /url\.searchParams\.set\("v", SERVICE_WORKER_VERSION\)/);
  assert.match(mainSource, /fetch\(absoluteUrl,\s*\{\s*cache: "no-store"/s);
  assert.match(mainSource, /importDynamicModule\("\.\.\/modules\/world\/index\.js"/);
  assert.match(mainSource, /htmlUrl: "\.\.\/\.\.\/views\/world\.html"/);
});

await test("Mundo expone world saved como Guardados rapidos plegado y con contador", () => {
  assert.match(worldViewSource, /<details class="world-saved-section"/);
  assert.doesNotMatch(worldViewSource, /<details class="world-saved-section"[^>]*open/);
  assert.match(worldViewSource, /Guardados rápidos/);
  assert.match(worldViewSource, /world-saved-count/);
  assert.match(worldSource, /state\.unsubSaved=trackedOnValue/);
  assert.match(worldSource, /count\.textContent = String\(rows\.length\)/);
});
