const TERMINAL_REMINDER_STATUSES = new Set([
  "completado",
  "completed",
  "cancelado",
  "cancelled",
  "vencido",
  "expired",
]);

const TERMINAL_ALERT_STATUSES = new Set(["sent", "failed", "cancelled"]);

function readScheduleVersion(reminder = {}, alert = {}) {
  return String(
    alert?.scheduleVersion
    || alert?.schedule_version
    || alert?.version
    || reminder?.scheduleVersion
    || reminder?.schedule_version
    || reminder?.recurrence?.scheduleVersion
    || reminder?.source?.metadata?.scheduleVersion
    || ""
  ).trim();
}

export function normalizeReminderRuntimeStatus(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  const aliases = {
    pending: "pendiente",
    completed: "completado",
    expired: "vencido",
    cancelled: "cancelado",
    cancelado: "cancelado",
    sent: "completado",
    enviado: "completado",
    failed: "vencido",
    fallido: "vencido",
  };
  return aliases[safe] || safe;
}

export function isTerminalReminderStatus(value = "") {
  return TERMINAL_REMINDER_STATUSES.has(normalizeReminderRuntimeStatus(value));
}

export function isTerminalReminderAlert(alert = {}) {
  return TERMINAL_ALERT_STATUSES.has(String(alert?.status || "").trim().toLowerCase());
}

export function buildReminderOccurrenceKey(reminder = {}, {
  alert = null,
  targetAt = 0,
  fallback = "",
  kind = "due",
} = {}) {
  const reminderId = String(reminder?.id || reminder?.reminderId || "").trim();
  if (!reminderId) return "";
  const version = readScheduleVersion(reminder, alert || {});
  if (alert) {
    const alertId = String(alert?.id || alert?.alertId || alert?.alert_id || "").trim();
    if (alertId || version) {
      return [reminderId, alertId || "alert", version || String(targetAt || ""), kind].join(":");
    }
  }
  if (version) return [reminderId, kind, version, targetAt || ""].join(":");
  return String(fallback || [reminderId, kind, targetAt || ""].join(":")).trim();
}

export function createReminderNotificationGuard() {
  const queuedOrShownKeys = new Set();
  const deletedReminderIds = new Set();
  const deleteInFlightIds = new Set();
  const deleteRestoreIds = new Set();

  return {
    clear() {
      queuedOrShownKeys.clear();
      deletedReminderIds.clear();
      deleteInFlightIds.clear();
      deleteRestoreIds.clear();
    },
    clearReminder(reminderId = "") {
      const safeId = String(reminderId || "").trim();
      if (!safeId) return;
      for (const key of Array.from(queuedOrShownKeys)) {
        if (key === safeId || key.startsWith(`${safeId}:`)) queuedOrShownKeys.delete(key);
      }
      deleteRestoreIds.delete(safeId);
    },
    markDeleted(reminderId = "") {
      const safeId = String(reminderId || "").trim();
      if (!safeId) return false;
      if (deleteInFlightIds.has(safeId)) return false;
      deletedReminderIds.add(safeId);
      deleteInFlightIds.add(safeId);
      return true;
    },
    markDeleteSettled(reminderId = "", { restore = false } = {}) {
      const safeId = String(reminderId || "").trim();
      if (!safeId) return false;
      deleteInFlightIds.delete(safeId);
      if (!restore) return false;
      deletedReminderIds.delete(safeId);
      if (deleteRestoreIds.has(safeId)) return false;
      deleteRestoreIds.add(safeId);
      return true;
    },
    isDeleted(reminderId = "") {
      return deletedReminderIds.has(String(reminderId || "").trim());
    },
    isDeleteInFlight(reminderId = "") {
      return deleteInFlightIds.has(String(reminderId || "").trim());
    },
    filterDeleted(reminders = []) {
      return (Array.isArray(reminders) ? reminders : []).filter((reminder) => !this.isDeleted(reminder?.id));
    },
    shouldQueue({ reminder = {}, alert = null, key = "" } = {}) {
      const safeKey = String(key || "").trim();
      const reminderId = String(reminder?.id || "").trim();
      if (!safeKey || !reminderId) return false;
      if (this.isDeleted(reminderId)) return false;
      if (isTerminalReminderStatus(reminder?.status)) return false;
      if (alert && isTerminalReminderAlert(alert)) return false;
      if (Array.isArray(reminder?.dismissedAlerts) && reminder.dismissedAlerts.includes(safeKey)) return false;
      if (queuedOrShownKeys.has(safeKey)) return false;
      queuedOrShownKeys.add(safeKey);
      return true;
    },
  };
}
