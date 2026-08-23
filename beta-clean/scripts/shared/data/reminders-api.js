import { API_BASE_URL } from "./config.js";

const REMINDERS_ENDPOINT = `${String(API_BASE_URL || "").replace(/\/+$/g, "")}/reminders`;
const SOURCE_TYPES = Object.freeze(["bookshell", "gmail", "telegram", "shortcut", "webhook", "manual", "amazon", "n8n"]);
const REMINDER_TYPES = Object.freeze(["normal", "birthday", "task", "event", "paperwork", "checklist", "custom"]);
const RECURRENCE_TYPES = Object.freeze(["none", "yearly", "daily", "custom"]);
const REMINDER_STATUSES = Object.freeze(["pending", "completed", "expired", "cancelled"]);
const ALERT_MODES = Object.freeze(["absolute", "relative"]);
const ALERT_CHANNELS = Object.freeze(["telegram"]);
const ALERT_STATUSES = Object.freeze(["pending", "sent", "failed", "cancelled"]);

function normalizeIsoDate(value = "") {
  const safe = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(safe) ? safe : "";
}

function normalizeTime(value = "") {
  const safe = String(value || "").trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(safe) ? safe : "";
}

function normalizeEnum(value = "", allowed = [], fallback = "") {
  const safe = String(value || "").trim().toLowerCase();
  return allowed.includes(safe) ? safe : fallback;
}

function normalizeReminderSource(source = {}) {
  return {
    type: normalizeEnum(source?.type, SOURCE_TYPES, "bookshell"),
    externalId: String(source?.externalId || "").trim(),
    metadata: source?.metadata && typeof source.metadata === "object" ? { ...source.metadata } : {},
  };
}

function normalizeReminderAlerts(alerts = []) {
  return (Array.isArray(alerts) ? alerts : [])
    .map((alert, index) => {
      const mode = normalizeEnum(alert?.mode, ALERT_MODES, Number.isFinite(Number(alert?.minutesBefore)) ? "relative" : "absolute");
      const minutesBefore = Number.isFinite(Number(alert?.minutesBefore))
        ? Math.max(0, Math.round(Number(alert.minutesBefore)))
        : null;
      const notifyAt = String(alert?.notifyAt || "").trim();
      if (mode === "relative" && minutesBefore === null) return null;
      if (mode === "absolute" && !notifyAt) return null;
      return {
        id: String(alert?.id || `alert_${index + 1}`).trim(),
        mode,
        minutesBefore,
        notifyAt,
        channel: normalizeEnum(alert?.channel, ALERT_CHANNELS, "telegram"),
        status: normalizeEnum(alert?.status, ALERT_STATUSES, "pending"),
      };
    })
    .filter(Boolean);
}

function normalizeReminderRecurrence(recurrence = {}, fallbackTargetDate = "") {
  const type = normalizeEnum(recurrence?.type, RECURRENCE_TYPES, "none");
  const rawDailyTargetCount = Number(recurrence?.dailyTargetCount || 1);
  return {
    type,
    startDate: normalizeIsoDate(recurrence?.startDate) || fallbackTargetDate,
    endDate: normalizeIsoDate(recurrence?.endDate),
    dailyTargetCount: Number.isFinite(rawDailyTargetCount)
      ? Math.max(1, Math.min(12, Math.round(rawDailyTargetCount)))
      : 1,
  };
}

export function normalizeCanonicalReminder(reminder = {}) {
  const targetDate = normalizeIsoDate(reminder?.targetDate);
  const nowIso = new Date().toISOString();
  return {
    id: String(reminder?.id || "").trim(),
    userId: String(reminder?.userId || "").trim(),
    title: String(reminder?.title || "").trim(),
    description: String(reminder?.description || "").trim(),
    emoji: String(reminder?.emoji || "").trim(),
    type: normalizeEnum(reminder?.type, REMINDER_TYPES, "normal"),
    category: String(reminder?.category || "").trim(),
    targetDate,
    targetTime: normalizeTime(reminder?.targetTime),
    timezone: String(reminder?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC").trim(),
    source: normalizeReminderSource(reminder?.source),
    alerts: normalizeReminderAlerts(reminder?.alerts),
    recurrence: normalizeReminderRecurrence(reminder?.recurrence, targetDate),
    status: normalizeEnum(reminder?.status, REMINDER_STATUSES, "pending"),
    completedAt: String(reminder?.completedAt || "").trim(),
    createdAt: String(reminder?.createdAt || nowIso).trim(),
    updatedAt: String(reminder?.updatedAt || nowIso).trim(),
  };
}

async function requestJson(path = "", { method = "GET", body = null, signal = null } = {}) {
  const response = await fetch(`${REMINDERS_ENDPOINT}${path}`, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : null,
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    throw new Error(`[reminders-api] ${method} ${path || "/"} failed: ${response.status}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export function createReminder(reminder = {}, options = {}) {
  return requestJson("", {
    method: "POST",
    body: normalizeCanonicalReminder(reminder),
    signal: options?.signal,
  });
}

export function listReminders(params = {}, options = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  });
  return requestJson(query.toString() ? `?${query}` : "", { signal: options?.signal });
}

export function getReminder(reminderId = "", options = {}) {
  return requestJson(`/${encodeURIComponent(String(reminderId || "").trim())}`, { signal: options?.signal });
}

export function updateReminder(reminderId = "", patch = {}, options = {}) {
  return requestJson(`/${encodeURIComponent(String(reminderId || "").trim())}`, {
    method: "PATCH",
    body: patch,
    signal: options?.signal,
  });
}

export function deleteReminder(reminderId = "", options = {}) {
  return requestJson(`/${encodeURIComponent(String(reminderId || "").trim())}`, {
    method: "DELETE",
    signal: options?.signal,
  });
}

export function completeReminder(reminderId = "", payload = {}, options = {}) {
  return requestJson(`/${encodeURIComponent(String(reminderId || "").trim())}/complete`, {
    method: "POST",
    body: payload || {},
    signal: options?.signal,
  });
}

export function listDueReminderAlerts(untilIso = "", options = {}) {
  const query = new URLSearchParams();
  if (untilIso) query.set("until", String(untilIso));
  return requestJson(`/due${query.toString() ? `?${query}` : ""}`, { signal: options?.signal });
}
