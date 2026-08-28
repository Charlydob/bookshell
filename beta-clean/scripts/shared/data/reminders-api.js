import { API_BASE_URL } from "./config.js";

const REMINDERS_ENDPOINT = `${String(API_BASE_URL || "").replace(/\/+$/g, "")}/reminders`;
const SOURCE_TYPES = Object.freeze(["bookshell", "gmail", "telegram", "shortcut", "webhook", "manual", "amazon", "n8n"]);
const REMINDER_TYPES = Object.freeze(["normal", "birthday", "task", "event", "paperwork", "checklist", "custom"]);
const RECURRENCE_TYPES = Object.freeze(["none", "daily", "weekly", "monthly", "yearly", "custom"]);
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

function normalizeIsoTimestamp(value = "", fallback = "") {
  if (value === null || value === undefined || value === "") return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    const date = new Date(numeric);
    return Number.isFinite(date.getTime()) ? date.toISOString() : fallback;
  }
  const safe = String(value || "").trim();
  if (!safe) return fallback;
  const parsed = Date.parse(safe);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
}

function normalizeEnum(value = "", allowed = [], fallback = "") {
  const safe = String(value || "").trim().toLowerCase();
  return allowed.includes(safe) ? safe : fallback;
}

function normalizeReminderType(value = "") {
  const aliases = {
    cumpleaños: "birthday",
    cumpleanos: "birthday",
    tarea: "task",
    evento: "event",
    tramite: "paperwork",
    trámite: "paperwork",
    personalizado: "custom",
  };
  const safe = String(value || "").trim().toLowerCase();
  return normalizeEnum(aliases[safe] || safe, REMINDER_TYPES, "normal");
}

function normalizeReminderStatus(value = "") {
  const aliases = {
    pendiente: "pending",
    completado: "completed",
    vencido: "expired",
    cancelado: "cancelled",
    enviado: "completed",
    sent: "completed",
    fallido: "expired",
    failed: "expired",
  };
  const safe = String(value || "").trim().toLowerCase();
  return normalizeEnum(aliases[safe] || safe, REMINDER_STATUSES, "pending");
}

function legacyAlertToMinutes(alert = {}) {
  const amount = Math.max(0, Math.round(Number(alert?.amount || 0)));
  if (!amount) return 0;
  if (alert?.unit === "days") return amount * 24 * 60;
  if (alert?.unit === "hours") return amount * 60;
  if (alert?.unit === "minutes") return amount;
  return 0;
}

function normalizeReminderSource(source = {}) {
  return {
    type: normalizeEnum(source?.type, SOURCE_TYPES, "bookshell"),
    externalId: String(source?.externalId || source?.external_id || "").trim(),
    metadata: source?.metadata && typeof source.metadata === "object" ? { ...source.metadata } : {},
  };
}

function normalizeReminderAlerts(alerts = []) {
  const source = Array.isArray(alerts) ? alerts : [];
  return source
    .map((alert, index) => {
      const legacyMinutes = legacyAlertToMinutes(alert);
      const hasMinutesBefore = Number.isFinite(Number(alert?.minutesBefore));
      const hasLegacyRelative =
        alert?.amount !== undefined &&
        ["minutes", "hours", "days"].includes(String(alert?.unit || "").trim());
      const mode = normalizeEnum(alert?.mode, ALERT_MODES, hasMinutesBefore || hasLegacyRelative ? "relative" : "absolute");
      const minutesBefore = hasMinutesBefore
        ? Math.max(0, Math.round(Number(alert.minutesBefore)))
        : (hasLegacyRelative ? legacyMinutes : null);
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
    rule: recurrence?.rule && typeof recurrence.rule === "object" ? { ...recurrence.rule } : {},
  };
}

function normalizeLegacyRecurrence(reminder = {}, targetDate = "") {
  const repeat = String(reminder?.repeat || "").trim().toLowerCase();
  const rawType = String(reminder?.recurrence?.type || repeat || "").trim().toLowerCase();
  const startDate = normalizeIsoDate(reminder?.startDate) || normalizeIsoDate(reminder?.recurrence?.startDate) || targetDate;
  const endDate = normalizeIsoDate(reminder?.endDate) || normalizeIsoDate(reminder?.recurrence?.endDate);
  const rawDailyTargetCount = Number(reminder?.dailyTargetCount || reminder?.recurrence?.dailyTargetCount || 1);
  let type = normalizeEnum(rawType, RECURRENCE_TYPES, "");
  if (!type && (reminder?.isBirthday || normalizeReminderType(reminder?.type) === "birthday")) type = "yearly";
  if (!type && startDate && endDate && endDate !== startDate) type = "daily";
  return normalizeReminderRecurrence({
    ...(reminder?.recurrence || {}),
    type: type || "none",
    startDate,
    endDate,
    dailyTargetCount: rawDailyTargetCount,
  }, targetDate);
}

function buildBookshellLegacyMetadata(reminder = {}) {
  return {
    color: String(reminder?.color || "").trim(),
    categories: Array.isArray(reminder?.categories) ? reminder.categories.map((item) => String(item || "").trim()).filter(Boolean) : [],
    remindBefore: Array.isArray(reminder?.remindBefore) ? reminder.remindBefore : [],
    checklistItems: reminder?.checklistItems && typeof reminder.checklistItems === "object" ? { ...reminder.checklistItems } : {},
    completionsByDate: reminder?.completionsByDate && typeof reminder.completionsByDate === "object" ? { ...reminder.completionsByDate } : {},
    repeat: String(reminder?.repeat || "").trim(),
    isBirthday: Boolean(reminder?.isBirthday),
    noteId: String(reminder?.noteId || "").trim(),
    dismissedAlerts: Array.isArray(reminder?.dismissedAlerts) ? reminder.dismissedAlerts.map((item) => String(item || "").trim()).filter(Boolean) : [],
    notifiedAt: Number(reminder?.notifiedAt || 0),
  };
}

export function normalizeCanonicalReminder(reminder = {}) {
  const targetDate = normalizeIsoDate(reminder?.targetDate || reminder?.date);
  const nowIso = new Date().toISOString();
  const legacyMetadata = buildBookshellLegacyMetadata(reminder);
  const source = normalizeReminderSource(reminder?.source);
  return {
    id: String(reminder?.id || "").trim(),
    userId: String(reminder?.userId || "").trim(),
    title: String(reminder?.title || "").trim(),
    description: String(reminder?.description || "").trim(),
    emoji: String(reminder?.emoji || "").trim(),
    type: normalizeReminderType(reminder?.type),
    category: String(reminder?.category || legacyMetadata.categories[0] || "").trim(),
    targetDate,
    targetTime: normalizeTime(reminder?.targetTime),
    timezone: String(reminder?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC").trim(),
    source: {
      ...source,
      metadata: {
        ...(source.metadata || {}),
        bookshellLegacy: legacyMetadata,
      },
    },
    alerts: normalizeReminderAlerts(Array.isArray(reminder?.alerts) && reminder.alerts.length ? reminder.alerts : reminder?.remindBefore),
    recurrence: normalizeLegacyRecurrence(reminder, targetDate),
    status: normalizeReminderStatus(reminder?.status),
    completedAt: normalizeIsoTimestamp(reminder?.completedAt, ""),
    createdAt: normalizeIsoTimestamp(reminder?.createdAt, nowIso),
    updatedAt: normalizeIsoTimestamp(reminder?.updatedAt, nowIso),
    color: legacyMetadata.color,
    categories: legacyMetadata.categories,
    remindBefore: legacyMetadata.remindBefore,
    checklistItems: legacyMetadata.checklistItems,
    completionsByDate: legacyMetadata.completionsByDate,
    repeat: legacyMetadata.repeat,
    isBirthday: legacyMetadata.isBirthday,
    noteId: legacyMetadata.noteId,
    dismissedAlerts: legacyMetadata.dismissedAlerts,
    notifiedAt: legacyMetadata.notifiedAt,
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
    if (String(key || "").toLowerCase() === "userid") return;
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
