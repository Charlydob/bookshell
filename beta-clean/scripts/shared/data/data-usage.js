import { API_BASE_URL } from "./config.js";

const DATA_USAGE_ENDPOINT = `${String(API_BASE_URL || "").replace(/\/+$/g, "")}/data-usage`;
const ALLOWED_OPERATIONS = Object.freeze([
  "READ",
  "LISTEN",
  "CREATE",
  "WRITE",
  "UPDATE",
  "DELETE",
  "TRANSACTION",
]);
const MAX_QUEUE_SIZE = 120;
const MAX_FIELD_LENGTHS = Object.freeze({
  userId: 180,
  path: 640,
  operation: 32,
});
const DATA_USAGE_DEBUG = true;
const DATA_USAGE_USE_FETCH_FIRST = true;

let flushTimer = 0;
const queue = [];

function truncate(value = "", maxLength = 0) {
  const safe = String(value || "").trim();
  return maxLength > 0 && safe.length > maxLength ? safe.slice(0, maxLength) : safe;
}

function normalizeOperation(operation = "") {
  const safe = String(operation || "").trim().toUpperCase();
  return ALLOWED_OPERATIONS.includes(safe) ? safe : "";
}

function normalizePayload(payload = {}) {
  const operation = normalizeOperation(payload?.operation);
  const path = truncate(payload?.path, MAX_FIELD_LENGTHS.path).replace(/^\/+|\/+$/g, "");
  if (!operation || !path) return null;
  return {
    userId: truncate(payload?.userId, MAX_FIELD_LENGTHS.userId),
    path,
    operation,
    createdAt: payload?.createdAt || payload?.timestamp || new Date().toISOString(),
  };
}

function sendDataUsage(payload) {
  if (!DATA_USAGE_ENDPOINT || !payload) return;
  const body = JSON.stringify(payload);
  if (DATA_USAGE_USE_FETCH_FIRST) {
    try {
      fetch(DATA_USAGE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
        credentials: "include",
      }).catch((error) => {
        if (typeof console !== "undefined" && typeof console.debug === "function") {
          console.debug("[data-usage] telemetry ignored", error);
        }
      });
      return;
    } catch (error) {
      if (typeof console !== "undefined" && typeof console.debug === "function") {
        console.debug("[data-usage] telemetry ignored", error);
      }
    }
  }

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });
      if (navigator.sendBeacon(DATA_USAGE_ENDPOINT, blob)) return;
    }
  } catch (_) {}

  try {
    fetch(DATA_USAGE_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
      credentials: "include",
    }).catch((error) => {
      if (typeof console !== "undefined" && typeof console.debug === "function") {
        console.debug("[data-usage] telemetry ignored", error);
      }
    });
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug("[data-usage] telemetry ignored", error);
    }
  }
}

function flushQueue() {
  flushTimer = 0;
  const items = queue.splice(0, queue.length);
  items.forEach((payload) => sendDataUsage(payload));
}

function scheduleFlush() {
  if (flushTimer) return;
  const scheduler = typeof window !== "undefined" && typeof window.requestIdleCallback === "function"
    ? window.requestIdleCallback
    : null;
  if (scheduler) {
    flushTimer = scheduler(flushQueue, { timeout: 1500 });
    return;
  }
  flushTimer = setTimeout(flushQueue, 750);
}

export function logDataUsage(payload = {}) {
  const normalized = normalizePayload(payload);
  if (!normalized) return;
  try {
    if (DATA_USAGE_DEBUG && typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug("[data-usage]", normalized);
    }
    queue.push(normalized);
    while (queue.length > MAX_QUEUE_SIZE) queue.shift();
    scheduleFlush();
  } catch (error) {
    if (typeof console !== "undefined" && typeof console.debug === "function") {
      console.debug("[data-usage] telemetry ignored", error);
    }
  }
}

export { ALLOWED_OPERATIONS as DATA_USAGE_OPERATIONS };
