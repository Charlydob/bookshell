'use strict';
const REMINDER_RECURRENCE_TYPES=new Set(['none','daily','weekly','monthly','yearly','custom']);
function clampInt(value, fallback, min, max) {
  if (value === null || value === undefined || String(value).trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}
function normalizeDateOnly(value = "") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  const safe = String(value || "").trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(safe) ? safe : "";
}
function normalizeRecurrenceType(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return REMINDER_RECURRENCE_TYPES.has(safe) ? safe : "none";
}
function dateStringFromUtcParts(year, month, day) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}
function addDaysToDateString(dateString, amount) {
  const [year, month, day] = normalizeDateOnly(dateString)
    .split("-")
    .map(Number);

  const date = new Date(Date.UTC(year, month - 1, day + amount));

  return dateStringFromUtcParts(
    date.getUTCFullYear(),
    date.getUTCMonth() + 1,
    date.getUTCDate()
  );
}
function addMonthsClamped(dateString, monthsToAdd) {
  const [year, month, day] = normalizeDateOnly(dateString)
    .split("-")
    .map(Number);

  const targetMonthStart = new Date(
    Date.UTC(year, month - 1 + monthsToAdd, 1)
  );

  const targetYear = targetMonthStart.getUTCFullYear();
  const targetMonth = targetMonthStart.getUTCMonth() + 1;
  const lastDay = new Date(
    Date.UTC(targetYear, targetMonth, 0)
  ).getUTCDate();

  return dateStringFromUtcParts(
    targetYear,
    targetMonth,
    Math.min(day, lastDay)
  );
}
function addYearsClamped(dateString, yearsToAdd) {
  const [year, month, day] = normalizeDateOnly(dateString)
    .split("-")
    .map(Number);

  const targetYear = year + yearsToAdd;
  const lastDay = new Date(
    Date.UTC(targetYear, month, 0)
  ).getUTCDate();

  return dateStringFromUtcParts(
    targetYear,
    month,
    Math.min(day, lastDay)
  );
}
function getNextRecurrenceDate(reminder) {
  const currentDate = normalizeDateOnly(reminder.target_date);
  const recurrenceType = normalizeRecurrenceType(reminder.recurrence_type);
  const rule =
    reminder.recurrence_rule &&
    typeof reminder.recurrence_rule === "object"
      ? reminder.recurrence_rule
      : {};

  if (!currentDate || recurrenceType === "none") return "";

  let nextDate = "";

  if (recurrenceType === "daily") {
    nextDate = addDaysToDateString(
      currentDate,
      clampInt(rule.intervalDays || rule.interval, 1, 1, 3650)
    );
  } else if (recurrenceType === "weekly") {
    nextDate = addDaysToDateString(
      currentDate,
      7 * clampInt(rule.intervalWeeks || rule.interval, 1, 1, 520)
    );
  } else if (recurrenceType === "monthly") {
    nextDate = addMonthsClamped(
      currentDate,
      clampInt(rule.intervalMonths || rule.interval, 1, 1, 120)
    );
  } else if (recurrenceType === "yearly") {
    nextDate = addYearsClamped(
      currentDate,
      clampInt(rule.intervalYears || rule.interval, 1, 1, 20)
    );
  } else if (recurrenceType === "custom") {
    const customDays = clampInt(
      rule.intervalDays || rule.days,
      0,
      0,
      3650
    );

    if (customDays > 0) {
      nextDate = addDaysToDateString(currentDate, customDays);
    }
  }

  const recurrenceEnd = normalizeDateOnly(reminder.recurrence_end_date);

  if (nextDate && recurrenceEnd && nextDate > recurrenceEnd) {
    return "";
  }

  return nextDate;
}
module.exports={getNextRecurrenceDate};
