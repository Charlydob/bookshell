const http = require("http");
const crypto = require("crypto");
let Pool = null;
let webPush = null;

try {
  ({ Pool } = require("pg"));
} catch (_) {
  Pool = null;
}

try {
  webPush = require("web-push");
} catch (_) {
  webPush = null;
}

function createMissingPgPool() {
  const throwMissingPg = async () => {
    throw new Error("pg_dependency_missing");
  };

  return {
    query: throwMissingPg,
    connect: throwMissingPg,
  };
}

const pool = Pool
  ? new Pool({
      connectionString: process.env.DATABASE_URL,
    })
  : createMissingPgPool();

const PORT = 3002;

const SINGLE_USER_ID = "b403663c-3675-48fb-a82e-b921d78404b0";
const SINGLE_USER_EMAIL = "charlydob99@gmail.com";
const SINGLE_USER_NAME = "Charly";
const LEGACY_FIREBASE_UID = "QkNDa4fsQdcaRJOGK54xZUetWEU2";

const VAPID_PUBLIC_KEY = String(process.env.VAPID_PUBLIC_KEY || "").trim();
const VAPID_PRIVATE_KEY = String(process.env.VAPID_PRIVATE_KEY || "").trim();
const VAPID_SUBJECT = String(process.env.VAPID_SUBJECT || "https://bookshell.charlydob.com").trim();
const isPushConfigured = Boolean(webPush && VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY && /^(https:\/\/|mailto:)/.test(VAPID_SUBJECT));
if (isPushConfigured) webPush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);

const PROD_ORIGINS = new Set([
  "https://bookshell.charlydob.com",
  "https://charlydob.github.io",
]);

const ALLOWED_OPERATIONS = new Set([
  "READ",
  "LISTEN",
  "CREATE",
  "WRITE",
  "UPDATE",
  "DELETE",
  "TRANSACTION",
]);

const FORBIDDEN_PATH_PARTS = new Set([
  "__proto__",
  "prototype",
  "constructor",
]);

// --------------------------------------------------
// CORS
// --------------------------------------------------

function isAllowedOrigin(origin = "") {
  if (!origin) return false;

  if (PROD_ORIGINS.has(origin)) {
    return true;
  }

  return /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin);
}

function corsHeaders(req) {
  const origin = String(req.headers.origin || "").trim();

  return {
    ...(isAllowedOrigin(origin)
      ? { "Access-Control-Allow-Origin": origin }
      : {}),
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bookshell-Automation-Secret",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Credentials": "true",
    "Vary": "Origin",
  };
}

function sendJson(req, res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    ...corsHeaders(req),
    ...extraHeaders,
  });

  res.end(JSON.stringify(body));
}

// --------------------------------------------------
// BODY
// --------------------------------------------------

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";

    req.on("data", (chunk) => {
      body += chunk;

      if (body.length > 15_000_000) {
        reject(new Error("Body too large"));
        req.destroy();
      }
    });

    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : null);
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

// --------------------------------------------------
// SINGLE USER
// --------------------------------------------------

function getSingleUser() {
  return {
    id: SINGLE_USER_ID,
    email: SINGLE_USER_EMAIL,
    displayName: SINGLE_USER_NAME,
    display_name: SINGLE_USER_NAME,
    legacyFirebaseUid: LEGACY_FIREBASE_UID,
    legacy_firebase_uid: LEGACY_FIREBASE_UID,
    provider: "api",
    uid: LEGACY_FIREBASE_UID,
    userDataRootKey: LEGACY_FIREBASE_UID,
  };
}

// --------------------------------------------------
// WEB PUSH (single-user, multiple installations)
// --------------------------------------------------

function normalizePushSubscription(value) {
  const endpoint = String(value?.endpoint || "").trim();
  const p256dh = String(value?.keys?.p256dh || "").trim();
  const auth = String(value?.keys?.auth || "").trim();
  if (!endpoint.startsWith("https://") || !p256dh || !auth) return null;
  return { endpoint, keys: { p256dh, auth } };
}

const pushSchemaReadyByDb = new WeakMap();

function ensurePushSubscriptionsSchema(db = pool) {
  if (!db || typeof db.query !== "function") {
    throw new Error("database_unavailable");
  }
  let ready = pushSchemaReadyByDb.get(db);
  if (!ready) {
    ready = db.query(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        endpoint text NOT NULL UNIQUE,
        p256dh text NOT NULL,
        auth text NOT NULL,
        user_agent text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        last_success_at timestamptz,
        last_failure_at timestamptz,
        failure_count integer NOT NULL DEFAULT 0,
        disabled_at timestamptz
      );

      CREATE INDEX IF NOT EXISTS push_subscriptions_active_user_idx
        ON push_subscriptions (user_id) WHERE disabled_at IS NULL;
    `);
    pushSchemaReadyByDb.set(db, ready);
  }
  return ready;
}

async function upsertPushSubscription(db, subscription, userAgent = null) {
  const result = await db.query(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (endpoint) DO UPDATE SET
      user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh,
      auth = EXCLUDED.auth, user_agent = EXCLUDED.user_agent,
      updated_at = now(), disabled_at = NULL, failure_count = 0
    RETURNING id, endpoint, created_at, updated_at, disabled_at
  `, [SINGLE_USER_ID, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, userAgent]);
  return result.rows[0];
}

async function sendPushToEndpoint(db, provider, endpoint, payload, options = {}) {
  const found = await db.query(`
    SELECT id, endpoint, p256dh, auth FROM push_subscriptions
    WHERE user_id = $1 AND endpoint = $2 AND disabled_at IS NULL LIMIT 1
  `, [SINGLE_USER_ID, endpoint]);
  if (!found.rows.length) return { accepted: false, statusCode: 404, reason: "subscription_not_found" };
  const row = found.rows[0];
  try {
    const response = await provider.sendNotification({
      endpoint: row.endpoint,
      keys: { p256dh: row.p256dh, auth: row.auth },
    }, JSON.stringify(payload), { TTL: clampInt(options?.ttl, 60, 1, 86400) });
    await db.query(`UPDATE push_subscriptions SET last_success_at = now(), failure_count = 0, updated_at = now() WHERE id = $1`, [row.id]);
    return { accepted: true, statusCode: response?.statusCode || 201, reason: null };
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 502;
    await db.query(`UPDATE push_subscriptions SET last_failure_at = now(), failure_count = failure_count + 1,
      updated_at = now(), disabled_at = CASE WHEN $2 = ANY(ARRAY[404, 410]) THEN now() ELSE disabled_at END WHERE id = $1`, [row.id, statusCode]);
    return { accepted: false, statusCode, reason: String(error?.body || error?.message || "push_provider_error").slice(0, 500) };
  }
}

async function sendPushToActiveSubscriptions(db, provider, payload, options = {}) {
  if (!isPushConfigured || !provider) {
    return {
      accepted: false,
      acceptedCount: 0,
      attemptedCount: 0,
      results: [],
      reason: "push_not_configured",
    };
  }

  await ensurePushSubscriptionsSchema(db);

  const subscriptions = await db.query(
    `
      SELECT endpoint
      FROM push_subscriptions
      WHERE user_id = $1
        AND disabled_at IS NULL
      ORDER BY updated_at DESC
    `,
    [SINGLE_USER_ID]
  );

  if (!subscriptions.rows.length) {
    return {
      accepted: false,
      acceptedCount: 0,
      attemptedCount: 0,
      results: [],
      reason: "no_active_subscriptions",
    };
  }

  const results = [];
  for (const row of subscriptions.rows) {
    results.push(
      await sendPushToEndpoint(
        db,
        provider,
        row.endpoint,
        payload,
        options
      )
    );
  }

  const acceptedCount = results.filter((result) => result.accepted).length;
  return {
    accepted: acceptedCount > 0,
    acceptedCount,
    attemptedCount: subscriptions.rows.length,
    results,
    reason: acceptedCount > 0
      ? null
      : (results[0]?.reason || "push_delivery_failed"),
  };
}

// --------------------------------------------------
// DATA HELPERS
// --------------------------------------------------

function getDataPath(urlPath = "", prefix = "/data") {
  let clean = String(urlPath || "");

  if (clean.startsWith(prefix)) {
    clean = clean.slice(prefix.length);
  }

  clean = clean.replace(/^\/+|\/+$/g, "");

  if (!clean) return [];

  return clean
    .split("/")
    .map((part) => decodeURIComponent(part))
    .filter(Boolean);
}

function validatePath(path) {
  if (!Array.isArray(path)) return false;
  if (path.length > 100) return false;

  return path.every((part) => {
    if (!part) return false;
    if (part.length > 500) return false;
    if (FORBIDDEN_PATH_PARTS.has(part)) return false;

    return true;
  });
}

function getAtPath(root, path) {
  let current = root;

  for (const key of path) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object" ||
      !(key in current)
    ) {
      return null;
    }

    current = current[key];
  }

  return current;
}

function ensureParent(root, path) {
  let current = root;

  for (const key of path) {
    if (
      !current[key] ||
      typeof current[key] !== "object" ||
      Array.isArray(current[key])
    ) {
      current[key] = {};
    }

    current = current[key];
  }

  return current;
}

function setAtPath(root, path, value) {
  if (!path.length) {
    return value;
  }

  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];

  const parent = ensureParent(root, parentPath);
  parent[key] = value;

  return root;
}

function deleteAtPath(root, path) {
  if (!path.length) {
    return {};
  }

  const parentPath = path.slice(0, -1);
  const key = path[path.length - 1];

  const parent = getAtPath(root, parentPath);

  if (parent && typeof parent === "object") {
    delete parent[key];
  }

  return root;
}

function patchAtPath(root, basePath, patch) {
  if (
    !patch ||
    typeof patch !== "object" ||
    Array.isArray(patch)
  ) {
    throw new Error("Invalid patch");
  }

  for (const [relativePath, value] of Object.entries(patch)) {
    const extraPath = String(relativePath)
      .split("/")
      .map((part) => decodeURIComponent(part))
      .filter(Boolean);

    const fullPath = [...basePath, ...extraPath];

    if (!validatePath(fullPath)) {
      throw new Error("Invalid patch path");
    }

    if (value === null) {
      deleteAtPath(root, fullPath);
    } else {
      root = setAtPath(root, fullPath, value);
    }
  }

  return root;
}

function valuesEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

async function getUserData() {
  const result = await pool.query(
    `
    SELECT id, data
    FROM firebase_import_raw
    WHERE user_id = $1
    ORDER BY imported_at DESC
    LIMIT 1
    `,
    [SINGLE_USER_ID]
  );

  return result.rows[0] || null;
}

async function mutateUserData(mutator) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const result = await client.query(
      `
      SELECT id, data
      FROM firebase_import_raw
      WHERE user_id = $1
      ORDER BY imported_at DESC
      LIMIT 1
      FOR UPDATE
      `,
      [SINGLE_USER_ID]
    );

    if (!result.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const row = result.rows[0];
    const nextData = await mutator(row.data);

    await client.query(
      `
      UPDATE firebase_import_raw
      SET data = $1::jsonb
      WHERE id = $2
      `,
      [
        JSON.stringify(nextData),
        row.id,
      ]
    );

    await client.query("COMMIT");

    return nextData;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// --------------------------------------------------
// REMINDERS
// --------------------------------------------------

const BOOKSHELL_AUTOMATION_SECRET = String(
  process.env.BOOKSHELL_AUTOMATION_SECRET || ""
).trim();

const DEFAULT_REMINDER_TIMEZONE = "Europe/Zurich";
const REMINDER_SCHEDULER_ENABLED = String(
  process.env.BOOKSHELL_REMINDER_SCHEDULER ?? "1"
).trim() !== "0";
const REMINDER_SCHEDULER_INTERVAL_MS = Math.max(
  10_000,
  Math.round(Number(process.env.BOOKSHELL_REMINDER_SCHEDULER_INTERVAL_MS || 60_000))
);
const REMINDER_RECURRENCE_TYPES = new Set([
  "none",
  "daily",
  "weekly",
  "monthly",
  "yearly",
  "custom",
]);
const REMINDER_STATUSES = new Set([
  "pending",
  "completed",
  "expired",
  "cancelled",
]);
const REMINDER_ALERT_TERMINAL_STATUSES = new Set([
  "sent",
  "failed",
  "cancelled",
]);
const REMINDER_SOURCE_TYPES = new Set([
  "bookshell",
  "gmail",
  "telegram",
  "shortcut",
  "webhook",
  "manual",
  "amazon",
  "n8n",
]);
const REMINDER_ALERT_MODES = new Set(["absolute", "relative"]);

function clampInt(value, fallback, min, max) {
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

function normalizeTimeOnly(value = "") {
  const safe = String(value || "").trim();
  const match = safe.match(/^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?/);
  return match ? `${match[1]}:${match[2]}` : "";
}

function normalizeTimezone(value = "") {
  const safe = String(value || "").trim() || DEFAULT_REMINDER_TIMEZONE;

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: safe }).format(new Date());
    return safe;
  } catch {
    return DEFAULT_REMINDER_TIMEZONE;
  }
}

function normalizeSourceType(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return REMINDER_SOURCE_TYPES.has(safe) ? safe : "bookshell";
}

function normalizeReminderStatus(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return REMINDER_STATUSES.has(safe) ? safe : "pending";
}

function normalizeRecurrenceType(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return REMINDER_RECURRENCE_TYPES.has(safe) ? safe : "none";
}

function zonedParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== "literal") {
      result[part.type] = Number(part.value);
    }
  }

  return result;
}

function timezoneOffsetMs(date, timeZone) {
  const parts = zonedParts(date, timeZone);
  const representedAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return representedAsUtc - date.getTime();
}

function localDateTimeToUtc(dateString, timeString, timeZone) {
  const safeDate = normalizeDateOnly(dateString);
  const safeTime = normalizeTimeOnly(timeString) || "09:00";
  const safeTimezone = normalizeTimezone(timeZone);

  if (!safeDate) {
    throw new Error("invalid_target_date");
  }

  const [year, month, day] = safeDate.split("-").map(Number);
  const [hour, minute] = safeTime.split(":").map(Number);

  const wallClockUtc = Date.UTC(year, month - 1, day, hour, minute, 0);
  let probe = new Date(wallClockUtc);
  let offset = timezoneOffsetMs(probe, safeTimezone);
  let result = new Date(wallClockUtc - offset);

  const secondOffset = timezoneOffsetMs(result, safeTimezone);
  if (secondOffset !== offset) {
    result = new Date(wallClockUtc - secondOffset);
  }

  return result;
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

function resolveAlertNotifyAt(alert, reminder) {
  const mode = String(alert?.mode || "").trim().toLowerCase();

  if (!REMINDER_ALERT_MODES.has(mode)) {
    throw new Error("invalid_alert_mode");
  }

  if (mode === "absolute") {
    const notifyAt = new Date(String(alert?.notifyAt || alert?.notify_at || ""));

    if (Number.isNaN(notifyAt.getTime())) {
      throw new Error("invalid_alert_notify_at");
    }

    return notifyAt;
  }

  const minutesBefore = clampInt(
    alert?.minutesBefore ?? alert?.minutes_before,
    -1,
    0,
    525600
  );

  if (minutesBefore < 0) {
    throw new Error("invalid_alert_minutes");
  }

  const targetInstant = localDateTimeToUtc(
    reminder.target_date,
    reminder.target_time,
    reminder.timezone
  );

  return new Date(targetInstant.getTime() - minutesBefore * 60 * 1000);
}

function normalizeReminderAlert(alert = {}) {
  const legacyAmount = Math.max(0, Math.round(Number(alert?.amount || 0)));
  const legacyUnit = String(alert?.unit || "").trim().toLowerCase();
  const legacyMinutes =
    legacyUnit === "days"
      ? legacyAmount * 1440
      : (
          legacyUnit === "hours"
            ? legacyAmount * 60
            : (
                legacyUnit === "minutes"
                  ? legacyAmount
                  : null
              )
        );
  const inferredMode =
    alert?.mode ||
    (
      alert?.minutesBefore !== undefined ||
      alert?.minutes_before !== undefined ||
      legacyMinutes !== null
        ? "relative"
        : "absolute"
    );

  const mode = String(inferredMode || "").trim().toLowerCase();

  if (!REMINDER_ALERT_MODES.has(mode)) {
    throw new Error("invalid_alert_mode");
  }

  const minutesBefore =
    mode === "relative"
      ? clampInt(
          alert?.minutesBefore ?? alert?.minutes_before ?? legacyMinutes,
          -1,
          0,
          525600
        )
      : null;

  if (mode === "relative" && minutesBefore < 0) {
    throw new Error("invalid_alert_minutes");
  }

  return {
    mode,
    minutesBefore,
    notifyAt: String(alert?.notifyAt || alert?.notify_at || "").trim(),
    channel: "telegram",
  };
}

function normalizeReminderAlertSet(alerts = []) {
  const normalizedAlerts = (Array.isArray(alerts) ? alerts : [])
    .map(normalizeReminderAlert);
  const withExactAlert = normalizedAlerts.some((alert) =>
    alert.mode === "relative" && Number(alert.minutesBefore) === 0
  )
    ? normalizedAlerts
    : [
        ...normalizedAlerts,
        {
          mode: "relative",
          minutesBefore: 0,
          notifyAt: "",
          channel: "telegram",
        },
      ];
  const seen = new Set();

  return withExactAlert.filter((alert) => {
    const key = alert.mode === "relative"
      ? `relative:${Number(alert.minutesBefore)}`
      : `absolute:${alert.notifyAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizeReminderInput(body = {}, existing = null) {
  const current = existing || {};

  const targetDate =
    normalizeDateOnly(body?.targetDate ?? body?.target_date) ||
    normalizeDateOnly(current.target_date);

  if (!targetDate) {
    throw new Error("invalid_target_date");
  }

  const targetTimeRaw =
    body?.targetTime !== undefined
      ? body.targetTime
      : (
          body?.target_time !== undefined
            ? body.target_time
            : current.target_time
        );

  const targetTime = normalizeTimeOnly(targetTimeRaw);

  const recurrenceBody =
    body?.recurrence &&
    typeof body.recurrence === "object"
      ? body.recurrence
      : {};

  const existingRule =
    current.recurrence_rule &&
    typeof current.recurrence_rule === "object"
      ? current.recurrence_rule
      : {};

  const recurrenceRule =
    recurrenceBody?.rule &&
    typeof recurrenceBody.rule === "object"
      ? recurrenceBody.rule
      : (
          body?.recurrenceRule &&
          typeof body.recurrenceRule === "object"
            ? body.recurrenceRule
            : existingRule
        );

  const sourceBody =
    body?.source &&
    typeof body.source === "object"
      ? body.source
      : {};

  const currentSourceMetadata =
    current.source_metadata &&
    typeof current.source_metadata === "object"
      ? current.source_metadata
      : {};

  const sourceMetadata =
    sourceBody?.metadata &&
    typeof sourceBody.metadata === "object"
      ? sourceBody.metadata
      : (
          body?.source_metadata &&
          typeof body.source_metadata === "object"
            ? body.source_metadata
            : currentSourceMetadata
        );

  return {
    title:
      String(body?.title ?? current.title ?? "").trim() || "Recordatorio",
    description:
      String(
        body?.description ??
        body?.message ??
        current.description ??
        ""
      ).trim(),
    emoji:
      String(body?.emoji ?? current.emoji ?? "⏰").trim() || "⏰",
    type:
      String(body?.type ?? current.type ?? "normal").trim() || "normal",
    category:
      String(body?.category ?? current.category ?? "").trim() || null,
    target_date: targetDate,
    target_time: targetTime || null,
    timezone: normalizeTimezone(body?.timezone ?? current.timezone),
    source_type: normalizeSourceType(
      sourceBody?.type ??
      body?.sourceType ??
      body?.source_type ??
      current.source_type
    ),
    source_external_id:
      String(
        sourceBody?.externalId ??
        body?.sourceExternalId ??
        body?.source_external_id ??
        current.source_external_id ??
        ""
      ).trim() || null,
    source_metadata: sourceMetadata,
    recurrence_type: normalizeRecurrenceType(
      recurrenceBody?.type ??
      body?.recurrenceType ??
      body?.recurrence_type ??
      current.recurrence_type
    ),
    recurrence_start_date:
      normalizeDateOnly(
        recurrenceBody?.startDate ??
        body?.recurrenceStartDate ??
        body?.recurrence_start_date ??
        current.recurrence_start_date
      ) || targetDate,
    recurrence_end_date:
      normalizeDateOnly(
        recurrenceBody?.endDate ??
        body?.recurrenceEndDate ??
        body?.recurrence_end_date ??
        current.recurrence_end_date
      ) || null,
    recurrence_daily_target_count: clampInt(
      recurrenceBody?.dailyTargetCount ??
      body?.recurrenceDailyTargetCount ??
      body?.recurrence_daily_target_count ??
      current.recurrence_daily_target_count,
      1,
      1,
      12
    ),
    recurrence_rule: recurrenceRule || {},
    status: normalizeReminderStatus(body?.status ?? current.status),
    completed_at:
      body?.completedAt !== undefined
        ? (
            body.completedAt
              ? new Date(body.completedAt)
              : null
          )
        : current.completed_at || null,
  };
}

function isAutomationAuthorized(req) {
  const supplied = String(
    req.headers["x-bookshell-automation-secret"] || ""
  ).trim();

  if (!BOOKSHELL_AUTOMATION_SECRET || !supplied) {
    return false;
  }

  const expectedBuffer = Buffer.from(BOOKSHELL_AUTOMATION_SECRET);
  const suppliedBuffer = Buffer.from(supplied);

  return (
    expectedBuffer.length === suppliedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  );
}

const reminderNotificationSchemaReadyByDb = new WeakMap();

function ensureReminderNotificationSchema(db = pool) {
  if (!db || typeof db.query !== "function") {
    throw new Error("database_unavailable");
  }
  let ready = reminderNotificationSchemaReadyByDb.get(db);
  if (!ready) {
    ready = db.query(`
      CREATE TABLE IF NOT EXISTS reminder_notification_deliveries (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        delivery_type text NOT NULL,
        delivery_key text NOT NULL,
        timezone text NOT NULL DEFAULT 'Europe/Zurich',
        target_date date,
        target_at timestamptz,
        reminder_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
        payload jsonb NOT NULL DEFAULT '{}'::jsonb,
        status text NOT NULL DEFAULT 'sending',
        attempt_count integer NOT NULL DEFAULT 0,
        locked_at timestamptz,
        locked_by text,
        sent_at timestamptz,
        failed_at timestamptz,
        error_message text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT reminder_notification_deliveries_status_check
          CHECK (status IN ('sending', 'sent', 'failed', 'skipped')),
        CONSTRAINT reminder_notification_deliveries_type_key_unique
          UNIQUE (user_id, delivery_type, delivery_key)
      );

      CREATE INDEX IF NOT EXISTS reminder_notification_deliveries_lookup_idx
        ON reminder_notification_deliveries (user_id, delivery_type, target_date, status);

      INSERT INTO reminder_alerts (
        reminder_id,
        mode,
        minutes_before,
        notify_at,
        channel,
        status,
        created_at,
        updated_at
      )
      SELECT
        r.id,
        'relative',
        0,
        ((r.target_date::date + COALESCE(r.target_time::time, TIME '09:00')) AT TIME ZONE COALESCE(NULLIF(r.timezone, ''), 'Europe/Zurich')),
        'telegram',
        'pending',
        now(),
        now()
      FROM reminders r
      WHERE r.status = 'pending'
        AND r.target_date IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM reminder_alerts a
          WHERE a.reminder_id = r.id
            AND a.mode = 'relative'
            AND COALESCE(a.minutes_before, -1) = 0
            AND a.status <> 'cancelled'
        );
    `);
    reminderNotificationSchemaReadyByDb.set(db, ready);
  }
  return ready;
}

async function getReminderAlerts(client, reminderId) {
  const result = await client.query(
    `
      SELECT *
      FROM reminder_alerts
      WHERE reminder_id = $1
      ORDER BY created_at ASC, id ASC
    `,
    [reminderId]
  );

  return result.rows;
}

function serializeReminder(row, alerts = []) {
  return {
    id: row.id,
    userId: LEGACY_FIREBASE_UID,
    title: row.title,
    description: row.description || "",
    emoji: row.emoji || "⏰",
    type: row.type || "normal",
    category: row.category || "",
    targetDate: normalizeDateOnly(row.target_date),
    targetTime: normalizeTimeOnly(row.target_time),
    timezone: normalizeTimezone(row.timezone),
    source: {
      type: normalizeSourceType(row.source_type),
      externalId: row.source_external_id || "",
      metadata: row.source_metadata || {},
    },
    alerts: alerts.map((alert) => ({
      id: alert.id,
      mode: alert.mode,
      minutesBefore:
        alert.minutes_before === null
          ? null
          : Number(alert.minutes_before),
      notifyAt:
        alert.notify_at
          ? new Date(alert.notify_at).toISOString()
          : "",
      channel: alert.channel || "telegram",
      status: alert.status,
      sentAt:
        alert.sent_at
          ? new Date(alert.sent_at).toISOString()
          : "",
      failedAt:
        alert.failed_at
          ? new Date(alert.failed_at).toISOString()
          : "",
      errorMessage: alert.error_message || "",
    })),
    recurrence: {
      type: normalizeRecurrenceType(row.recurrence_type),
      startDate:
        normalizeDateOnly(row.recurrence_start_date) ||
        normalizeDateOnly(row.target_date),
      endDate: normalizeDateOnly(row.recurrence_end_date),
      dailyTargetCount: Number(row.recurrence_daily_target_count || 1),
      rule: row.recurrence_rule || {},
    },
    status: row.status,
    completedAt:
      row.completed_at
        ? new Date(row.completed_at).toISOString()
        : "",
    scheduleVersion: Number(row.schedule_version || 1),
    createdAt:
      row.created_at
        ? new Date(row.created_at).toISOString()
        : "",
    updatedAt:
      row.updated_at
        ? new Date(row.updated_at).toISOString()
        : "",
  };
}

async function getReminderById(reminderId, client = pool) {
  const result = await client.query(
    `
      SELECT *
      FROM reminders
      WHERE id = $1
        AND firebase_uid = $2
      LIMIT 1
    `,
    [reminderId, LEGACY_FIREBASE_UID]
  );

  if (!result.rows.length) return null;

  const alerts = await getReminderAlerts(client, reminderId);
  return serializeReminder(result.rows[0], alerts);
}

async function insertReminderAlerts(client, reminderRow, alerts = []) {
  const normalizedAlerts = normalizeReminderAlertSet(alerts);
  const seenNotifyAt = new Set();

  for (const alert of normalizedAlerts) {
    const notifyAt = resolveAlertNotifyAt(alert, reminderRow);
    const notifyKey = notifyAt.toISOString();
    if (seenNotifyAt.has(notifyKey)) continue;
    seenNotifyAt.add(notifyKey);

    await client.query(
      `
        INSERT INTO reminder_alerts (
          reminder_id,
          mode,
          minutes_before,
          notify_at,
          channel,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          $2,
          $3,
          $4,
          'telegram',
          'pending',
          NOW(),
          NOW()
        )
      `,
      [
        reminderRow.id,
        alert.mode,
        alert.minutesBefore,
        notifyAt,
      ]
    );
  }
}

async function createReminderRecord(body = {}, sourceTypeOverride = "") {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const normalized = normalizeReminderInput(
      sourceTypeOverride
        ? {
            ...body,
            source: {
              ...(body?.source || {}),
              type: sourceTypeOverride,
            },
          }
        : body
    );

    if (normalized.source_external_id) {
      const existing = await client.query(
        `
          SELECT id
          FROM reminders
          WHERE firebase_uid = $1
            AND source_type = $2
            AND source_external_id = $3
          LIMIT 1
        `,
        [
          LEGACY_FIREBASE_UID,
          normalized.source_type,
          normalized.source_external_id,
        ]
      );

      if (existing.rows.length) {
        const reminder = await getReminderById(
          existing.rows[0].id,
          client
        );

        await client.query("COMMIT");

        return {
          reminder,
          created: false,
        };
      }
    }

    const inserted = await client.query(
      `
        INSERT INTO reminders (
          firebase_uid,
          title,
          description,
          emoji,
          type,
          category,
          target_date,
          target_time,
          timezone,
          source_type,
          source_external_id,
          source_metadata,
          recurrence_type,
          recurrence_start_date,
          recurrence_end_date,
          recurrence_daily_target_count,
          recurrence_rule,
          status,
          completed_at,
          schedule_version,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, $5, $6, $7, $8, $9,
          $10, $11, $12::jsonb, $13, $14, $15, $16,
          $17::jsonb, $18, $19, 1, NOW(), NOW()
        )
        RETURNING *
      `,
      [
        LEGACY_FIREBASE_UID,
        normalized.title,
        normalized.description,
        normalized.emoji,
        normalized.type,
        normalized.category,
        normalized.target_date,
        normalized.target_time,
        normalized.timezone,
        normalized.source_type,
        normalized.source_external_id,
        JSON.stringify(normalized.source_metadata || {}),
        normalized.recurrence_type,
        normalized.recurrence_start_date,
        normalized.recurrence_end_date,
        normalized.recurrence_daily_target_count,
        JSON.stringify(normalized.recurrence_rule || {}),
        normalized.status,
        normalized.completed_at,
      ]
    );

    const reminderRow = inserted.rows[0];

    await insertReminderAlerts(
      client,
      reminderRow,
      body?.alerts || []
    );

    const reminder = await getReminderById(
      reminderRow.id,
      client
    );

    await client.query("COMMIT");

    return {
      reminder,
      created: true,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    if (error?.code === "23505") {
      const sourceType = normalizeSourceType(
        body?.source?.type ||
        body?.sourceType ||
        sourceTypeOverride
      );

      const externalId = String(
        body?.source?.externalId ||
        body?.sourceExternalId ||
        ""
      ).trim();

      if (externalId) {
        const existing = await pool.query(
          `
            SELECT id
            FROM reminders
            WHERE firebase_uid = $1
              AND source_type = $2
              AND source_external_id = $3
            LIMIT 1
          `,
          [LEGACY_FIREBASE_UID, sourceType, externalId]
        );

        if (existing.rows.length) {
          return {
            reminder: await getReminderById(existing.rows[0].id),
            created: false,
          };
        }
      }
    }

    throw error;
  } finally {
    client.release();
  }
}

async function patchReminderRecord(reminderId, patch = {}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
        SELECT *
        FROM reminders
        WHERE id = $1
          AND firebase_uid = $2
        FOR UPDATE
      `,
      [reminderId, LEGACY_FIREBASE_UID]
    );

    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const existing = existingResult.rows[0];
    const normalized = normalizeReminderInput(patch, existing);

    const scheduleKeys = new Set([
      "targetDate",
      "target_date",
      "targetTime",
      "target_time",
      "timezone",
      "recurrence",
      "recurrenceType",
      "recurrence_type",
      "recurrenceRule",
      "alerts",
    ]);

    const scheduleChanged = Object.keys(patch || {})
      .some((key) => scheduleKeys.has(key));

    const scheduleVersion =
      Number(existing.schedule_version || 1) +
      (scheduleChanged ? 1 : 0);

    const updatedResult = await client.query(
      `
        UPDATE reminders
        SET
          title = $3,
          description = $4,
          emoji = $5,
          type = $6,
          category = $7,
          target_date = $8,
          target_time = $9,
          timezone = $10,
          source_type = $11,
          source_external_id = $12,
          source_metadata = $13::jsonb,
          recurrence_type = $14,
          recurrence_start_date = $15,
          recurrence_end_date = $16,
          recurrence_daily_target_count = $17,
          recurrence_rule = $18::jsonb,
          status = $19,
          completed_at = $20,
          schedule_version = $21,
          updated_at = NOW()
        WHERE id = $1
          AND firebase_uid = $2
        RETURNING *
      `,
      [
        reminderId,
        LEGACY_FIREBASE_UID,
        normalized.title,
        normalized.description,
        normalized.emoji,
        normalized.type,
        normalized.category,
        normalized.target_date,
        normalized.target_time,
        normalized.timezone,
        normalized.source_type,
        normalized.source_external_id,
        JSON.stringify(normalized.source_metadata || {}),
        normalized.recurrence_type,
        normalized.recurrence_start_date,
        normalized.recurrence_end_date,
        normalized.recurrence_daily_target_count,
        JSON.stringify(normalized.recurrence_rule || {}),
        normalized.status,
        normalized.completed_at,
        scheduleVersion,
      ]
    );

    const updated = updatedResult.rows[0];

    if (Array.isArray(patch?.alerts)) {
      await client.query(
        "DELETE FROM reminder_alerts WHERE reminder_id = $1",
        [reminderId]
      );

      await insertReminderAlerts(
        client,
        updated,
        patch.alerts
      );
    } else if (scheduleChanged) {
      const pendingAlerts = await client.query(
        `
          SELECT *
          FROM reminder_alerts
          WHERE reminder_id = $1
            AND status = 'pending'
        `,
        [reminderId]
      );

      for (const alert of pendingAlerts.rows) {
        let notifyAt = alert.notify_at;

        if (alert.mode === "relative") {
          notifyAt = resolveAlertNotifyAt(alert, updated);
        }

        await client.query(
          `
            UPDATE reminder_alerts
            SET
              notify_at = $2,
              locked_at = NULL,
              locked_by = NULL,
              updated_at = NOW()
            WHERE id = $1
          `,
          [alert.id, notifyAt]
        );
      }
    }

    if (normalized.status === "cancelled") {
      await client.query(
        `
          UPDATE reminder_alerts
          SET
            status = CASE
              WHEN status = 'pending' THEN 'cancelled'
              ELSE status
            END,
            locked_at = NULL,
            locked_by = NULL,
            updated_at = NOW()
          WHERE reminder_id = $1
        `,
        [reminderId]
      );
    }

    const reminder = await getReminderById(
      reminderId,
      client
    );

    await client.query("COMMIT");
    return reminder;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function appendReminderAlert(reminderId, alertBody = {}) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reminderResult = await client.query(
      `
        SELECT *
        FROM reminders
        WHERE id = $1
          AND firebase_uid = $2
        FOR UPDATE
      `,
      [reminderId, LEGACY_FIREBASE_UID]
    );

    if (!reminderResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const reminder = reminderResult.rows[0];
    const alert = normalizeReminderAlert(alertBody);
    const notifyAt = resolveAlertNotifyAt(alert, reminder);

    await client.query(
      `
        INSERT INTO reminder_alerts (
          reminder_id,
          mode,
          minutes_before,
          notify_at,
          channel,
          status,
          created_at,
          updated_at
        )
        VALUES (
          $1, $2, $3, $4, 'telegram', 'pending', NOW(), NOW()
        )
      `,
      [
        reminderId,
        alert.mode,
        alert.minutesBefore,
        notifyAt,
      ]
    );

    await client.query(
      `
        UPDATE reminders
        SET
          schedule_version = schedule_version + 1,
          updated_at = NOW()
        WHERE id = $1
      `,
      [reminderId]
    );

    const result = await getReminderById(
      reminderId,
      client
    );

    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function listReminderRecords({
  status = "",
  sourceType = "",
  from = "",
  until = "",
  limit = 50,
  includeCancelled = false,
} = {}) {
  const where = ["firebase_uid = $1"];
  const values = [LEGACY_FIREBASE_UID];
  const statusFilter = String(status || "").trim().toLowerCase();

  if (statusFilter && statusFilter !== "all") {
    values.push(normalizeReminderStatus(status));
    where.push(`status = $${values.length}`);
  } else if (!includeCancelled && statusFilter !== "all") {
    where.push("status <> 'cancelled'");
  }

  if (sourceType) {
    values.push(normalizeSourceType(sourceType));
    where.push(`source_type = $${values.length}`);
  }

  if (normalizeDateOnly(from)) {
    values.push(normalizeDateOnly(from));
    where.push(`target_date >= $${values.length}`);
  }

  if (normalizeDateOnly(until)) {
    values.push(normalizeDateOnly(until));
    where.push(`target_date <= $${values.length}`);
  }

  const safeLimit = clampInt(limit, 50, 1, 100);
  values.push(safeLimit);

  const result = await pool.query(
    `
      SELECT *
      FROM reminders
      WHERE ${where.join(" AND ")}
      ORDER BY
        target_date ASC,
        target_time ASC NULLS FIRST,
        created_at ASC
      LIMIT $${values.length}
    `,
    values
  );

  const reminders = [];

  for (const row of result.rows) {
    reminders.push(
      serializeReminder(
        row,
        await getReminderAlerts(pool, row.id)
      )
    );
  }

  return reminders;
}

async function cancelReminderRecord(reminderId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const existingResult = await client.query(
      `
        SELECT *
        FROM reminders
        WHERE id = $1
          AND firebase_uid = $2
        FOR UPDATE
      `,
      [reminderId, LEGACY_FIREBASE_UID]
    );

    if (!existingResult.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    await client.query(
      `
        UPDATE reminders
        SET
          status = 'cancelled',
          completed_at = NULL,
          schedule_version = schedule_version + 1,
          updated_at = NOW()
        WHERE id = $1
          AND firebase_uid = $2
      `,
      [reminderId, LEGACY_FIREBASE_UID]
    );

    await client.query(
      `
        UPDATE reminder_alerts
        SET
          status = CASE
            WHEN status = 'pending' THEN 'cancelled'
            ELSE status
          END,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
        WHERE reminder_id = $1
      `,
      [reminderId]
    );

    const reminder = await getReminderById(reminderId, client);

    await client.query("COMMIT");
    return reminder;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

function todayDateStringInZone(timeZone = DEFAULT_REMINDER_TIMEZONE) {
  const parts = zonedParts(new Date(), normalizeTimezone(timeZone));
  return dateStringFromUtcParts(parts.year, parts.month, parts.day);
}

function getRangeBounds(range = "all") {
  const today = todayDateStringInZone(DEFAULT_REMINDER_TIMEZONE);

  if (range === "today") {
    return { from: today, until: today };
  }

  if (range === "tomorrow") {
    const tomorrow = addDaysToDateString(today, 1);
    return { from: tomorrow, until: tomorrow };
  }

  const [year, month, day] = today.split("-").map(Number);
  const weekday = new Date(
    Date.UTC(year, month - 1, day)
  ).getUTCDay();

  const daysFromMonday = (weekday + 6) % 7;
  const monday = addDaysToDateString(today, -daysFromMonday);

  if (range === "this_week") {
    return {
      from: monday,
      until: addDaysToDateString(monday, 6),
    };
  }

  if (range === "next_week") {
    const nextMonday = addDaysToDateString(monday, 7);

    return {
      from: nextMonday,
      until: addDaysToDateString(nextMonday, 6),
    };
  }

  return { from: "", until: "" };
}

function readSearchParam(params = {}, key = "") {
  if (params && typeof params.get === "function") {
    return params.get(key);
  }

  return params?.[key];
}

function normalizeSearchText(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeTemporalScope(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["today", "future", "past", "all"].includes(safe)
    ? safe
    : "all";
}

function normalizeAutomationSearchStatus(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  if (safe === "all") return "all";
  return REMINDER_STATUSES.has(safe) ? safe : "all";
}

function normalizeAutomationReminderSearchParams(params = {}, options = {}) {
  const now = options?.now instanceof Date && !Number.isNaN(options.now.getTime())
    ? options.now
    : new Date();
  const todayParts = zonedParts(now, DEFAULT_REMINDER_TIMEZONE);
  const today = options?.today || dateStringFromUtcParts(
    todayParts.year,
    todayParts.month,
    todayParts.day
  );
  const rawStatus = normalizeSearchText(readSearchParam(params, "status"));
  const temporalScope = normalizeTemporalScope(
    readSearchParam(params, "temporalScope")
  );

  return {
    q: normalizeSearchText(readSearchParam(params, "q")),
    eventType: normalizeSearchText(readSearchParam(params, "eventType")),
    subject: normalizeSearchText(readSearchParam(params, "subject")),
    from: normalizeDateOnly(readSearchParam(params, "from")),
    until: normalizeDateOnly(readSearchParam(params, "until")),
    temporalScope,
    status: normalizeAutomationSearchStatus(rawStatus),
    statusExplicit: Boolean(rawStatus),
    limit: clampInt(readSearchParam(params, "limit"), 50, 1, 100),
    today,
  };
}

function lowerIncludes(haystack = "", needle = "") {
  return String(haystack || "")
    .toLowerCase()
    .includes(String(needle || "").toLowerCase());
}

function rowSearchText(row = {}) {
  return [
    row.title,
    row.description,
    row.source_external_id,
    JSON.stringify(row.source_metadata || {}),
  ].join(" ");
}

function matchesMetadataOrLegacyText(row = {}, field = "", value = "") {
  const safeValue = normalizeSearchText(value);
  if (!safeValue) return true;

  const metadata = row.source_metadata && typeof row.source_metadata === "object"
    ? row.source_metadata
    : {};
  const metadataValue = normalizeSearchText(metadata?.[field]);

  if (metadataValue) {
    return metadataValue.toLowerCase() === safeValue.toLowerCase();
  }

  return lowerIncludes(`${row.title || ""} ${row.description || ""}`, safeValue);
}

function matchesAutomationReminderSearch(row = {}, filters = {}) {
  const targetDate = normalizeDateOnly(row.target_date || row.targetDate);
  const status = normalizeReminderStatus(row.status);

  if (filters.q && !lowerIncludes(rowSearchText(row), filters.q)) return false;
  if (!matchesMetadataOrLegacyText(row, "eventType", filters.eventType)) return false;
  if (!matchesMetadataOrLegacyText(row, "subject", filters.subject)) return false;
  if (filters.from && targetDate < filters.from) return false;
  if (filters.until && targetDate > filters.until) return false;
  if (filters.temporalScope === "today" && targetDate !== filters.today) return false;
  if (filters.temporalScope === "future" && targetDate < filters.today) return false;
  if (filters.temporalScope === "past" && targetDate >= filters.today) return false;
  if (filters.status !== "all" && status !== filters.status) return false;
  if (
    filters.temporalScope === "past" &&
    !filters.statusExplicit &&
    status === "cancelled"
  ) {
    return false;
  }

  return true;
}

function compareAutomationReminderRows(a = {}, b = {}) {
  const aDate = normalizeDateOnly(a.target_date || a.targetDate);
  const bDate = normalizeDateOnly(b.target_date || b.targetDate);
  if (aDate !== bDate) return aDate.localeCompare(bDate);

  const aTime = normalizeTimeOnly(a.target_time || a.targetTime);
  const bTime = normalizeTimeOnly(b.target_time || b.targetTime);
  if (aTime !== bTime) return aTime.localeCompare(bTime);

  return String(a.created_at || a.createdAt || a.id || "")
    .localeCompare(String(b.created_at || b.createdAt || b.id || ""));
}

function searchAutomationReminderRows(rows = [], params = {}, options = {}) {
  const filters = normalizeAutomationReminderSearchParams(params, options);
  const matched = (Array.isArray(rows) ? rows : [])
    .filter((row) => matchesAutomationReminderSearch(row, filters))
    .sort(compareAutomationReminderRows);

  return {
    filters,
    total: matched.length,
    results: matched.slice(0, filters.limit),
  };
}

function buildAutomationReminderSearchQuery(params = {}, options = {}) {
  const filters = normalizeAutomationReminderSearchParams(params, options);
  const where = ["firebase_uid = $1"];
  const values = [LEGACY_FIREBASE_UID];
  const likeValue = (value) => `%${String(value || "").replace(/[%_\\]/g, "\\$&")}%`;

  if (filters.q) {
    values.push(likeValue(filters.q));
    where.push(`(
      title ILIKE $${values.length} ESCAPE '\\'
      OR description ILIKE $${values.length} ESCAPE '\\'
      OR source_external_id ILIKE $${values.length} ESCAPE '\\'
      OR source_metadata::text ILIKE $${values.length} ESCAPE '\\'
    )`);
  }

  for (const [field, value] of [
    ["eventType", filters.eventType],
    ["subject", filters.subject],
  ]) {
    if (!value) continue;
    values.push(value);
    const exactIndex = values.length;
    values.push(likeValue(value));
    const likeIndex = values.length;
    where.push(`(
      LOWER(COALESCE(source_metadata->>'${field}', '')) = LOWER($${exactIndex})
      OR (
        COALESCE(source_metadata->>'${field}', '') = ''
        AND (
          title ILIKE $${likeIndex} ESCAPE '\\'
          OR description ILIKE $${likeIndex} ESCAPE '\\'
        )
      )
    )`);
  }

  if (filters.from) {
    values.push(filters.from);
    where.push(`target_date >= $${values.length}`);
  }

  if (filters.until) {
    values.push(filters.until);
    where.push(`target_date <= $${values.length}`);
  }

  if (filters.temporalScope === "today") {
    values.push(filters.today);
    where.push(`target_date = $${values.length}`);
  } else if (filters.temporalScope === "future") {
    values.push(filters.today);
    where.push(`target_date >= $${values.length}`);
  } else if (filters.temporalScope === "past") {
    values.push(filters.today);
    where.push(`target_date < $${values.length}`);
  }

  if (filters.status !== "all") {
    values.push(filters.status);
    where.push(`status = $${values.length}`);
  } else if (filters.temporalScope === "past" && !filters.statusExplicit) {
    where.push("status <> 'cancelled'");
  }

  const whereSql = where.join(" AND ");
  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM reminders
    WHERE ${whereSql}
  `;
  const rowValues = [...values, filters.limit];
  const rowsQuery = `
    SELECT *
    FROM reminders
    WHERE ${whereSql}
    ORDER BY
      target_date ASC,
      target_time ASC NULLS FIRST,
      created_at ASC
    LIMIT $${rowValues.length}
  `;

  return {
    filters,
    countQuery,
    countValues: values,
    rowsQuery,
    rowValues,
  };
}

async function searchAutomationReminders(params = {}) {
  const query = buildAutomationReminderSearchQuery(params);
  const countResult = await pool.query(
    query.countQuery,
    query.countValues
  );
  const rows = await pool.query(
    query.rowsQuery,
    query.rowValues
  );
  const results = [];

  for (const row of rows.rows) {
    results.push(
      serializeReminder(
        row,
        await getReminderAlerts(pool, row.id)
      )
    );
  }

  return {
    total: Number(countResult.rows[0]?.total || 0),
    limit: query.filters.limit,
    filters: {
      q: query.filters.q,
      eventType: query.filters.eventType,
      subject: query.filters.subject,
      from: query.filters.from,
      until: query.filters.until,
      temporalScope: query.filters.temporalScope,
      status: query.filters.status,
    },
    results,
  };
}

async function listAutomationReminders(range = "all", limit = 20) {
  const allowedRanges = new Set([
    "today",
    "tomorrow",
    "this_week",
    "next_week",
    "all",
  ]);

  const safeRange = allowedRanges.has(range) ? range : "all";
  const bounds = getRangeBounds(safeRange);
  const safeLimit = clampInt(limit, 20, 1, 20);

  const where = [
    "firebase_uid = $1",
    "status = 'pending'",
  ];
  const values = [LEGACY_FIREBASE_UID];

  if (bounds.from) {
    values.push(bounds.from);
    where.push(`target_date >= $${values.length}`);
  }

  if (bounds.until) {
    values.push(bounds.until);
    where.push(`target_date <= $${values.length}`);
  }

  const countResult = await pool.query(
    `
      SELECT COUNT(*)::int AS total
      FROM reminders
      WHERE ${where.join(" AND ")}
    `,
    values
  );

  const queryValues = [...values, safeLimit];

  const rows = await pool.query(
    `
      SELECT *
      FROM reminders
      WHERE ${where.join(" AND ")}
      ORDER BY
        target_date ASC,
        target_time ASC NULLS FIRST,
        created_at ASC
      LIMIT $${queryValues.length}
    `,
    queryValues
  );

  const reminders = rows.rows.map((row) =>
    serializeReminder(row, [])
  );

  return {
    range: safeRange,
    total: Number(countResult.rows[0]?.total || 0),
    limit: safeLimit,
    reminders,
  };
}

async function claimDueReminderAlerts(limit = 50) {
  const client = await pool.connect();
  const workerId = `n8n-${crypto.randomUUID()}`;
  let staleReminderIds = [];

  try {
    await client.query("BEGIN");

    const staleResult = await client.query(
      `
        UPDATE reminder_alerts a
        SET
          status = 'failed',
          failed_at = NOW(),
          error_message = 'expired_before_delivery',
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
        FROM reminders r
        WHERE r.id = a.reminder_id
          AND a.status = 'pending'
          AND a.notify_at IS NOT NULL
          AND a.notify_at < NOW() - INTERVAL '30 minutes'
          AND r.firebase_uid = $1
        RETURNING a.reminder_id
      `,
      [LEGACY_FIREBASE_UID]
    );

    staleReminderIds = Array.from(new Set(
      staleResult.rows.map((row) => row.reminder_id).filter(Boolean)
    ));

    const picked = await client.query(
      `
        SELECT a.id
        FROM reminder_alerts a
        INNER JOIN reminders r
          ON r.id = a.reminder_id
        WHERE a.status = 'pending'
          AND a.notify_at IS NOT NULL
          AND a.notify_at <= NOW()
          AND r.status = 'pending'
          AND r.firebase_uid = $1
          AND (
            a.locked_at IS NULL
            OR a.locked_at < NOW() - INTERVAL '5 minutes'
          )
        ORDER BY a.notify_at ASC, a.created_at ASC
        FOR UPDATE OF a SKIP LOCKED
        LIMIT $2
      `,
      [
        LEGACY_FIREBASE_UID,
        clampInt(limit, 50, 1, 100),
      ]
    );

    const ids = picked.rows.map((row) => row.id);

    if (!ids.length) {
      await client.query("COMMIT");

      for (const reminderId of staleReminderIds) {
        await advanceRecurringReminderIfFinished(reminderId);
      }

      return {
        workerId,
        alerts: [],
      };
    }

    await client.query(
      `
        UPDATE reminder_alerts
        SET
          locked_at = NOW(),
          locked_by = $2,
          attempt_count = attempt_count + 1,
          updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `,
      [ids, workerId]
    );

    const result = await client.query(
      `
        SELECT
          a.id AS alert_id,
          a.reminder_id,
          a.mode,
          a.minutes_before,
          a.notify_at,
          a.attempt_count,
          r.title,
          r.description,
          r.emoji,
          r.target_date,
          r.target_time,
          r.timezone,
          r.source_type,
          r.recurrence_type,
          r.schedule_version
        FROM reminder_alerts a
        INNER JOIN reminders r
          ON r.id = a.reminder_id
        WHERE a.id = ANY($1::uuid[])
        ORDER BY a.notify_at ASC, a.created_at ASC
      `,
      [ids]
    );

    await client.query("COMMIT");

    for (const reminderId of staleReminderIds) {
      await advanceRecurringReminderIfFinished(reminderId);
    }

    return {
      workerId,
      alerts: result.rows.map((row) => ({
        alertId: row.alert_id,
        reminderId: row.reminder_id,
        title: row.title,
        description: row.description || "",
        emoji: row.emoji || "⏰",
        targetDate: normalizeDateOnly(row.target_date),
        targetTime: normalizeTimeOnly(row.target_time),
        timezone: normalizeTimezone(row.timezone),
        mode: row.mode,
        minutesBefore:
          row.minutes_before === null
            ? null
            : Number(row.minutes_before),
        notifyAt: new Date(row.notify_at).toISOString(),
        attemptCount: Number(row.attempt_count || 0),
        sourceType: row.source_type,
        recurrenceType: row.recurrence_type,
        scheduleVersion: Number(row.schedule_version || 1),
      })),
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function advanceRecurringReminderIfFinished(reminderId) {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const reminderResult = await client.query(
      `
        SELECT *
        FROM reminders
        WHERE id = $1
          AND firebase_uid = $2
        FOR UPDATE
      `,
      [reminderId, LEGACY_FIREBASE_UID]
    );

    if (!reminderResult.rows.length) {
      await client.query("ROLLBACK");
      return;
    }

    const reminder = reminderResult.rows[0];

    if (
      normalizeRecurrenceType(reminder.recurrence_type) === "none" ||
      reminder.status !== "pending"
    ) {
      await client.query("COMMIT");
      return;
    }

    const unfinished = await client.query(
      `
        SELECT COUNT(*)::int AS count
        FROM reminder_alerts
        WHERE reminder_id = $1
          AND status = 'pending'
      `,
      [reminderId]
    );

    if (Number(unfinished.rows[0]?.count || 0) > 0) {
      await client.query("COMMIT");
      return;
    }

    const nextDate = getNextRecurrenceDate(reminder);

    if (!nextDate) {
      await client.query(
        `
          UPDATE reminders
          SET
            status = 'completed',
            completed_at = NOW(),
            updated_at = NOW()
          WHERE id = $1
        `,
        [reminderId]
      );

      await client.query("COMMIT");
      return;
    }

    const oldTargetInstant = localDateTimeToUtc(
      reminder.target_date,
      reminder.target_time,
      reminder.timezone
    );

    const nextReminder = {
      ...reminder,
      target_date: nextDate,
    };

    const nextTargetInstant = localDateTimeToUtc(
      nextDate,
      reminder.target_time,
      reminder.timezone
    );

    const terminalAlerts = await client.query(
      `
        SELECT *
        FROM reminder_alerts
        WHERE reminder_id = $1
          AND status IN ('sent', 'failed')
        FOR UPDATE
      `,
      [reminderId]
    );

    await client.query(
      `
        UPDATE reminders
        SET
          target_date = $2,
          schedule_version = schedule_version + 1,
          completed_at = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [reminderId, nextDate]
    );

    for (const alert of terminalAlerts.rows) {
      let nextNotifyAt;

      if (alert.mode === "relative") {
        nextNotifyAt = resolveAlertNotifyAt(
          alert,
          nextReminder
        );
      } else {
        const oldNotifyAt = new Date(alert.notify_at);
        const delta =
          oldNotifyAt.getTime() - oldTargetInstant.getTime();

        nextNotifyAt = new Date(
          nextTargetInstant.getTime() + delta
        );
      }

      await client.query(
        `
          UPDATE reminder_alerts
          SET
            status = 'pending',
            notify_at = $2,
            sent_at = NULL,
            failed_at = NULL,
            error_message = NULL,
            locked_at = NULL,
            locked_by = NULL,
            attempt_count = 0,
            updated_at = NOW()
          WHERE id = $1
        `,
        [alert.id, nextNotifyAt]
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function markReminderAlertSent(alertId, scheduleVersion = null) {
  const client = await pool.connect();
  let reminderId = "";
  let shouldAdvance = false;

  try {
    await client.query("BEGIN");

    const current = await client.query(
      `
        SELECT
          a.id,
          a.status,
          a.reminder_id,
          r.schedule_version
        FROM reminder_alerts a
        INNER JOIN reminders r
          ON r.id = a.reminder_id
        WHERE a.id = $1
          AND r.firebase_uid = $2
        FOR UPDATE OF a, r
      `,
      [alertId, LEGACY_FIREBASE_UID]
    );

    if (!current.rows.length) {
      await client.query("ROLLBACK");
      return null;
    }

    const row = current.rows[0];
    reminderId = row.reminder_id;
    const currentScheduleVersion = Number(row.schedule_version || 1);
    const suppliedScheduleVersion = Number(scheduleVersion);
    const hasScheduleVersion = Number.isFinite(suppliedScheduleVersion);

    if (
      hasScheduleVersion &&
      suppliedScheduleVersion !== currentScheduleVersion
    ) {
      await client.query("COMMIT");
      return {
        alertId,
        reminderId,
        status: row.status,
        scheduleVersion: currentScheduleVersion,
        ignored: true,
        reason: "stale_schedule_version",
      };
    }

    if (row.status !== "pending") {
      await client.query("COMMIT");
      return {
        alertId,
        reminderId,
        status: row.status,
        scheduleVersion: currentScheduleVersion,
        ignored: true,
        reason: REMINDER_ALERT_TERMINAL_STATUSES.has(row.status)
          ? "terminal_alert"
          : "not_pending",
      };
    }

    await client.query(
      `
        UPDATE reminder_alerts
        SET
          status = 'sent',
          sent_at = NOW(),
          failed_at = NULL,
          error_message = NULL,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
        WHERE id = $1
      `,
      [alertId]
    );

    shouldAdvance = true;

    await client.query("COMMIT");

    if (shouldAdvance) {
      await advanceRecurringReminderIfFinished(reminderId);
    }

    return {
      alertId,
      reminderId,
      status: "sent",
      scheduleVersion: currentScheduleVersion,
      ignored: false,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function markReminderAlertFailed(alertId, errorMessage = "", scheduleVersion = null) {
  const current = await pool.query(
    `
      SELECT
        a.attempt_count,
        a.reminder_id,
        r.schedule_version
      FROM reminder_alerts a
      INNER JOIN reminders r
        ON r.id = a.reminder_id
      WHERE a.id = $1
        AND r.firebase_uid = $2
      LIMIT 1
    `,
    [alertId, LEGACY_FIREBASE_UID]
  );

  if (!current.rows.length) return null;

  const currentScheduleVersion = Number(current.rows[0].schedule_version || 1);
  const suppliedScheduleVersion = Number(scheduleVersion);

  if (
    Number.isFinite(suppliedScheduleVersion) &&
    suppliedScheduleVersion !== currentScheduleVersion
  ) {
    return {
      alertId,
      reminderId: current.rows[0].reminder_id,
      status: "ignored",
      scheduleVersion: currentScheduleVersion,
      retrying: false,
      ignored: true,
      reason: "stale_schedule_version",
    };
  }

  const attemptCount = Number(
    current.rows[0].attempt_count || 0
  );

  const shouldRetry = attemptCount < 3;

  const result = await pool.query(
    `
      UPDATE reminder_alerts
      SET
        status = $2,
        notify_at = CASE
          WHEN $3::boolean
            THEN NOW() + INTERVAL '5 minutes'
          ELSE notify_at
        END,
        failed_at = NOW(),
        error_message = $4,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING reminder_id
    `,
    [
      alertId,
      shouldRetry ? "pending" : "failed",
      shouldRetry,
      String(errorMessage || "").slice(0, 2000),
    ]
  );

  const reminderId = result.rows[0]?.reminder_id;

  if (!shouldRetry && reminderId) {
    await advanceRecurringReminderIfFinished(reminderId);
  }

  return {
    alertId,
    reminderId,
    status: shouldRetry ? "pending" : "failed",
    scheduleVersion: currentScheduleVersion,
    retrying: shouldRetry,
  };
}

async function completeReminderRecord(reminderId, payload = {}) {
  const reminderResult = await pool.query(
    `
      SELECT *
      FROM reminders
      WHERE id = $1
        AND firebase_uid = $2
      LIMIT 1
    `,
    [reminderId, LEGACY_FIREBASE_UID]
  );

  if (!reminderResult.rows.length) return null;

  const reminder = reminderResult.rows[0];

  if (normalizeRecurrenceType(reminder.recurrence_type) === "none") {
    await pool.query(
      `
        UPDATE reminders
        SET
          status = 'completed',
          completed_at = COALESCE($3::timestamptz, NOW()),
          updated_at = NOW()
        WHERE id = $1
          AND firebase_uid = $2
      `,
      [
        reminderId,
        LEGACY_FIREBASE_UID,
        payload?.completedAt || null,
      ]
    );

    await pool.query(
      `
        UPDATE reminder_alerts
        SET
          status = CASE
            WHEN status = 'pending' THEN 'cancelled'
            ELSE status
          END,
          locked_at = NULL,
          locked_by = NULL,
          updated_at = NOW()
        WHERE reminder_id = $1
      `,
      [reminderId]
    );

    return getReminderById(reminderId);
  }

  const nextDate = getNextRecurrenceDate(reminder);

  if (!nextDate) {
    return patchReminderRecord(reminderId, {
      status: "completed",
      completedAt:
        payload?.completedAt || new Date().toISOString(),
    });
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const nextReminder = {
      ...reminder,
      target_date: nextDate,
    };

    const oldTargetInstant = localDateTimeToUtc(
      reminder.target_date,
      reminder.target_time,
      reminder.timezone
    );

    const nextTargetInstant = localDateTimeToUtc(
      nextDate,
      reminder.target_time,
      reminder.timezone
    );

    const alerts = await client.query(
      `
        SELECT *
        FROM reminder_alerts
        WHERE reminder_id = $1
        FOR UPDATE
      `,
      [reminderId]
    );

    await client.query(
      `
        UPDATE reminders
        SET
          target_date = $2,
          schedule_version = schedule_version + 1,
          completed_at = NULL,
          status = 'pending',
          updated_at = NOW()
        WHERE id = $1
      `,
      [reminderId, nextDate]
    );

    for (const alert of alerts.rows) {
      if (alert.status === "cancelled") continue;

      let notifyAt;

      if (alert.mode === "relative") {
        notifyAt = resolveAlertNotifyAt(alert, nextReminder);
      } else {
        const oldNotifyAt = new Date(alert.notify_at);
        const delta =
          oldNotifyAt.getTime() - oldTargetInstant.getTime();

        notifyAt = new Date(
          nextTargetInstant.getTime() + delta
        );
      }

      await client.query(
        `
          UPDATE reminder_alerts
          SET
            status = 'pending',
            notify_at = $2,
            sent_at = NULL,
            failed_at = NULL,
            error_message = NULL,
            locked_at = NULL,
            locked_by = NULL,
            attempt_count = 0,
            updated_at = NOW()
          WHERE id = $1
        `,
        [alert.id, notifyAt]
      );
    }

    const result = await getReminderById(
      reminderId,
      client
    );

    await client.query("COMMIT");
    return result;
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

function formatMinutesBeforeLabel(minutesBefore = 0) {
  const minutes = Math.max(0, Math.round(Number(minutesBefore || 0)));
  if (minutes === 0) return "";
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${days === 1 ? "dia" : "dias"}`;
  }
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hora" : "horas"}`;
  }
  return `${minutes} min`;
}

function buildReminderUrl(reminderId = "") {
  const safeId = String(reminderId || "").trim();
  const query = safeId
    ? `?reminderId=${encodeURIComponent(safeId)}`
    : "";
  return `/${query}#view-notes`;
}

function buildReminderAlertPushPayload(alert = {}) {
  const title = String(alert?.title || "Recordatorio").trim() || "Recordatorio";
  const minutesBefore = Math.max(0, Math.round(Number(alert?.minutesBefore || 0)));
  const label = formatMinutesBeforeLabel(minutesBefore);
  return {
    title: minutesBefore > 0
      ? `\u23f0 En ${label}: ${title}`
      : `\u23f0 ${title}`,
    body: String(alert?.targetTime || "").trim() || "Ahora",
    url: buildReminderUrl(alert?.reminderId),
    type: "reminder",
    tag: `reminder:${alert?.reminderId || ""}:${alert?.alertId || ""}:${alert?.scheduleVersion || 1}`,
    reminderId: alert?.reminderId || "",
    alertId: alert?.alertId || "",
    scheduleVersion: Number(alert?.scheduleVersion || 1),
  };
}

function buildDailySummaryPayload(summary = {}) {
  const reminders = Array.isArray(summary?.reminders) ? summary.reminders : [];
  const visible = reminders.slice(0, 10);
  const overflow = reminders.length - visible.length;
  const rows = visible.map((reminder) => {
    const time = String(reminder?.targetTime || "--:--").trim() || "--:--";
    const title = String(reminder?.title || "Recordatorio").trim() || "Recordatorio";
    return `\u2022 ${time} - ${title}`;
  });
  if (overflow > 0) rows.push(`\u2022 Y ${overflow} mas`);

  return {
    title: "\ud83d\udcc5 Hoy tienes pendiente",
    body: rows.join("\n"),
    url: "/#view-notes",
    type: "reminder-daily-summary",
    tag: `reminder-daily-summary:${summary?.timezone || DEFAULT_REMINDER_TIMEZONE}:${summary?.targetDate || ""}`,
    targetDate: summary?.targetDate || "",
    timezone: summary?.timezone || DEFAULT_REMINDER_TIMEZONE,
  };
}

function resolveReminderTestPushPayload(kind = "reminder", reminder = null, dailyReminders = []) {
  const safeKind = ["advance", "reminder", "daily-summary"].includes(String(kind || "").trim())
    ? String(kind || "").trim()
    : "reminder";
  const reminderId = String(reminder?.id || "").trim();

  if (safeKind === "daily-summary") {
    const timezone = normalizeTimezone(reminder?.timezone);
    const targetDate = todayDateStringInZone(timezone);
    return buildDailySummaryPayload({
      targetDate,
      timezone,
      reminders: Array.isArray(dailyReminders) ? dailyReminders : [],
    });
  }

  return buildReminderAlertPushPayload({
    alertId: `test-${safeKind}-${crypto.randomUUID()}`,
    reminderId,
    title: reminder?.title || "Recordatorio",
    targetTime: normalizeTimeOnly(reminder?.targetTime),
    minutesBefore: safeKind === "advance" ? 120 : 0,
    scheduleVersion: reminder?.scheduleVersion || 1,
  });
}

async function sendReminderTestPush(reminderId, body = {}) {
  if (!isPushConfigured) {
    return { ok: false, accepted: false, statusCode: 503, error: "push_not_configured" };
  }

  await ensurePushSubscriptionsSchema(pool);

  const endpoint = String(body?.endpoint || "").trim();
  if (!endpoint) {
    const error = new Error("endpoint_required");
    error.statusCode = 400;
    throw error;
  }

  const reminder = await getReminderById(reminderId);
  if (!reminder) return null;

  const kind = String(body?.kind || "reminder").trim();
  const dailyReminders = kind === "daily-summary"
    ? await listDailySummaryReminders(
        todayDateStringInZone(reminder.timezone),
        reminder.timezone
      )
    : [];
  const payload = resolveReminderTestPushPayload(kind, reminder, dailyReminders);
  const delivery = await sendPushToEndpoint(pool, webPush, endpoint, payload, { ttl: 600 });

  return {
    ok: delivery.accepted,
    accepted: delivery.accepted,
    kind: ["advance", "reminder", "daily-summary"].includes(kind) ? kind : "reminder",
    payload,
    ...delivery,
  };
}

async function runDueReminderAlertPushCycle({ limit = 50 } = {}) {
  if (!isPushConfigured) {
    return {
      ok: false,
      reason: "push_not_configured",
      claimed: 0,
      sent: 0,
      failed: 0,
    };
  }

  const claimed = await claimDueReminderAlerts(limit);
  let sent = 0;
  let failed = 0;
  const results = [];

  for (const alert of claimed.alerts) {
    const payload = buildReminderAlertPushPayload(alert);
    const delivery = await sendPushToActiveSubscriptions(
      pool,
      webPush,
      payload,
      { ttl: 3600 }
    );

    if (delivery.accepted) {
      sent += 1;
      results.push(
        await markReminderAlertSent(
          alert.alertId,
          alert.scheduleVersion
        )
      );
    } else {
      failed += 1;
      results.push(
        await markReminderAlertFailed(
          alert.alertId,
          delivery.reason || "push_delivery_failed",
          alert.scheduleVersion
        )
      );
    }
  }

  return {
    ok: true,
    workerId: claimed.workerId,
    claimed: claimed.alerts.length,
    sent,
    failed,
    results,
  };
}

async function listDailySummaryReminders(targetDate, timeZone = DEFAULT_REMINDER_TIMEZONE) {
  const result = await pool.query(
    `
      SELECT
        id,
        title,
        description,
        target_date,
        target_time,
        timezone,
        recurrence_type,
        schedule_version
      FROM reminders
      WHERE firebase_uid = $1
        AND status = 'pending'
        AND target_date = $2::date
        AND COALESCE(NULLIF(timezone, ''), $3) = $3
      ORDER BY target_time ASC NULLS LAST, created_at ASC
    `,
    [LEGACY_FIREBASE_UID, targetDate, normalizeTimezone(timeZone)]
  );

  return result.rows.map((row) => ({
    reminderId: row.id,
    title: row.title,
    description: row.description || "",
    targetDate: normalizeDateOnly(row.target_date),
    targetTime: normalizeTimeOnly(row.target_time),
    timezone: normalizeTimezone(row.timezone),
    recurrenceType: normalizeRecurrenceType(row.recurrence_type),
    scheduleVersion: Number(row.schedule_version || 1),
  }));
}

async function claimDailySummaryDelivery({ now = new Date(), timeZone = DEFAULT_REMINDER_TIMEZONE } = {}) {
  const safeTimezone = normalizeTimezone(timeZone);
  const localParts = zonedParts(now, safeTimezone);
  const targetDate = dateStringFromUtcParts(
    localParts.year,
    localParts.month,
    localParts.day
  );

  if (localParts.hour !== 8) {
    return {
      claimed: false,
      reason: "outside_summary_window",
      targetDate,
      timezone: safeTimezone,
    };
  }

  await ensureReminderNotificationSchema(pool);

  const reminders = await listDailySummaryReminders(targetDate, safeTimezone);
  const deliveryKey = `daily:${safeTimezone}:${targetDate}`;
  const workerId = `summary-${crypto.randomUUID()}`;
  const payload = buildDailySummaryPayload({
    targetDate,
    timezone: safeTimezone,
    reminders,
  });
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const inserted = await client.query(
      `
        INSERT INTO reminder_notification_deliveries (
          user_id,
          delivery_type,
          delivery_key,
          timezone,
          target_date,
          target_at,
          reminder_ids,
          payload,
          status,
          attempt_count,
          locked_at,
          locked_by,
          created_at,
          updated_at
        )
        VALUES (
          $1,
          'daily_summary',
          $2,
          $3,
          $4::date,
          $5,
          $6::uuid[],
          $7::jsonb,
          $8,
          1,
          NOW(),
          $9,
          NOW(),
          NOW()
        )
        ON CONFLICT (user_id, delivery_type, delivery_key) DO NOTHING
        RETURNING id, status
      `,
      [
        SINGLE_USER_ID,
        deliveryKey,
        safeTimezone,
        targetDate,
        localDateTimeToUtc(targetDate, "08:00", safeTimezone),
        reminders.map((reminder) => reminder.reminderId),
        JSON.stringify(payload),
        reminders.length ? "sending" : "skipped",
        workerId,
      ]
    );

    await client.query("COMMIT");

    if (!inserted.rows.length) {
      return {
        claimed: false,
        reason: "already_claimed",
        targetDate,
        timezone: safeTimezone,
      };
    }

    return {
      claimed: reminders.length > 0,
      skipped: reminders.length === 0,
      deliveryId: inserted.rows[0].id,
      workerId,
      targetDate,
      timezone: safeTimezone,
      reminders,
      payload,
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    client.release();
  }
}

async function updateDailySummaryDelivery(deliveryId, patch = {}) {
  const status = ["sent", "failed", "skipped"].includes(String(patch?.status || ""))
    ? String(patch.status)
    : "failed";
  const result = await pool.query(
    `
      UPDATE reminder_notification_deliveries
      SET
        status = $2,
        sent_at = CASE WHEN $2 = 'sent' THEN NOW() ELSE sent_at END,
        failed_at = CASE WHEN $2 = 'failed' THEN NOW() ELSE failed_at END,
        error_message = CASE WHEN $2 = 'failed' THEN $3 ELSE NULL END,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = NOW()
      WHERE id = $1
      RETURNING id, status
    `,
    [
      deliveryId,
      status,
      String(patch?.errorMessage || "").slice(0, 2000),
    ]
  );

  return result.rows[0] || null;
}

async function runDailySummaryPushCycle({ now = new Date(), timeZone = DEFAULT_REMINDER_TIMEZONE } = {}) {
  if (!isPushConfigured) {
    return {
      ok: false,
      reason: "push_not_configured",
      claimed: false,
      sent: false,
    };
  }

  const claimed = await claimDailySummaryDelivery({ now, timeZone });
  if (!claimed.claimed) {
    return {
      ok: true,
      ...claimed,
      sent: false,
    };
  }

  const delivery = await sendPushToActiveSubscriptions(
    pool,
    webPush,
    claimed.payload,
    { ttl: 7200 }
  );

  await updateDailySummaryDelivery(
    claimed.deliveryId,
    delivery.accepted
      ? { status: "sent" }
      : {
          status: "failed",
          errorMessage: delivery.reason || "push_delivery_failed",
        }
  );

  return {
    ok: true,
    ...claimed,
    sent: delivery.accepted,
    acceptedCount: delivery.acceptedCount,
    attemptedCount: delivery.attemptedCount,
  };
}

let reminderSchedulerTimer = null;
let reminderSchedulerTickInFlight = false;

async function runReminderSchedulerTick(options = {}) {
  if (reminderSchedulerTickInFlight) {
    return { ok: true, skipped: true, reason: "tick_in_flight" };
  }

  reminderSchedulerTickInFlight = true;
  try {
    await ensurePushSubscriptionsSchema(pool);
    await ensureReminderNotificationSchema(pool);
    const [alerts, dailySummary] = await Promise.all([
      runDueReminderAlertPushCycle({ limit: options?.limit || 50 }),
      runDailySummaryPushCycle({
        now: options?.now || new Date(),
        timeZone: options?.timeZone || DEFAULT_REMINDER_TIMEZONE,
      }),
    ]);

    return {
      ok: true,
      alerts,
      dailySummary,
    };
  } finally {
    reminderSchedulerTickInFlight = false;
  }
}

function startReminderScheduler() {
  if (reminderSchedulerTimer || !REMINDER_SCHEDULER_ENABLED) {
    return reminderSchedulerTimer;
  }

  const tick = () => {
    runReminderSchedulerTick().catch((error) => {
      console.error("[reminders:scheduler]", error);
    });
  };

  reminderSchedulerTimer = setInterval(tick, REMINDER_SCHEDULER_INTERVAL_MS);
  reminderSchedulerTimer.unref?.();
  tick();
  return reminderSchedulerTimer;
}

function stopReminderScheduler() {
  if (!reminderSchedulerTimer) return false;
  clearInterval(reminderSchedulerTimer);
  reminderSchedulerTimer = null;
  return true;
}

function reminderErrorStatus(error) {
  const knownBadRequest = new Set([
    "invalid_target_date",
    "invalid_alert_mode",
    "invalid_alert_notify_at",
    "invalid_alert_minutes",
  ]);

  return knownBadRequest.has(error?.message) ? 400 : 500;
}

// --------------------------------------------------
// SERVER
// --------------------------------------------------

const server = http.createServer(async (req, res) => {
  const url = new URL(
    req.url,
    `http://${req.headers.host || "localhost"}`
  );

  // ------------------------------------------------
  // CORS
  // ------------------------------------------------

  if (req.method === "OPTIONS") {
    const origin = String(req.headers.origin || "").trim();

    if (origin && !isAllowedOrigin(origin)) {
      return sendJson(req, res, 403, {
        ok: false,
        error: "origin_not_allowed",
      });
    }

    res.writeHead(204, corsHeaders(req));
    return res.end();
  }

  // ------------------------------------------------
  // HEALTH
  // ------------------------------------------------

  if (
    req.method === "GET" &&
    url.pathname === "/health"
  ) {
    try {
      const result = await pool.query(
        "SELECT NOW() AS now"
      );

      return sendJson(req, res, 200, {
        ok: true,
        service: "bookshell-api",
        database: "connected",
        auth: "disabled-single-user",
        userId: SINGLE_USER_ID,
        time: result.rows[0].now,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        database: "error",
      });
    }
  }

  // ------------------------------------------------
  // AUTH DISABLED
  //
  // Siempre devolvemos el único usuario.
  // ------------------------------------------------

  if (
    req.method === "GET" &&
    url.pathname === "/auth/me"
  ) {
    return sendJson(req, res, 200, {
      ok: true,
      user: getSingleUser(),
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/auth/login"
  ) {
    return sendJson(req, res, 200, {
      ok: true,
      user: getSingleUser(),
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/auth/logout"
  ) {
    return sendJson(req, res, 200, {
      ok: true,
      user: getSingleUser(),
    });
  }

  if (
    req.method === "POST" &&
    url.pathname === "/auth/register"
  ) {
    return sendJson(req, res, 403, {
      ok: false,
      error: "registration_disabled",
    });
  }

  // ------------------------------------------------
  // WEB PUSH DIAGNOSTICS
  // ------------------------------------------------

  if (req.method === "GET" && url.pathname === "/push/status") {
    try {
      await ensurePushSubscriptionsSchema(pool);
      const result = await pool.query(`SELECT id, endpoint, created_at, updated_at, last_success_at,
        last_failure_at, failure_count FROM push_subscriptions
        WHERE user_id = $1 AND disabled_at IS NULL ORDER BY updated_at DESC`, [SINGLE_USER_ID]);
      return sendJson(req, res, 200, {
        ok: true,
        configured: isPushConfigured,
        vapidPublicKey: isPushConfigured ? VAPID_PUBLIC_KEY : null,
        subscriptions: result.rows.map(({ endpoint, ...row }) => ({
          ...row,
          endpointHash: crypto.createHash("sha256").update(endpoint).digest("hex").slice(0, 16),
        })),
      });
    } catch (error) {
      console.error("[push:status]", error);
      return sendJson(req, res, 500, { ok: false, error: "push_status_failed" });
    }
  }

  if (req.method === "POST" && url.pathname === "/push/subscribe") {
    try {
      if (!isPushConfigured) return sendJson(req, res, 503, { ok: false, error: "push_not_configured" });
      await ensurePushSubscriptionsSchema(pool);
      const subscription = normalizePushSubscription(await readJson(req));
      if (!subscription) return sendJson(req, res, 400, { ok: false, error: "invalid_subscription" });
      const row = await upsertPushSubscription(pool, subscription, String(req.headers["user-agent"] || "").slice(0, 1000) || null);
      return sendJson(req, res, 200, { ok: true, subscription: { id: row.id, createdAt: row.created_at, updatedAt: row.updated_at } });
    } catch (error) {
      console.error("[push:subscribe]", error);
      return sendJson(req, res, 500, { ok: false, error: "push_subscribe_failed" });
    }
  }

  if (req.method === "POST" && url.pathname === "/push/unsubscribe") {
    try {
      await ensurePushSubscriptionsSchema(pool);
      const endpoint = String((await readJson(req))?.endpoint || "").trim();
      if (!endpoint) return sendJson(req, res, 400, { ok: false, error: "endpoint_required" });
      const result = await pool.query(`UPDATE push_subscriptions SET disabled_at = now(), updated_at = now()
        WHERE user_id = $1 AND endpoint = $2 AND disabled_at IS NULL RETURNING id`, [SINGLE_USER_ID, endpoint]);
      return sendJson(req, res, 200, { ok: true, disabled: result.rowCount > 0 });
    } catch (error) {
      console.error("[push:unsubscribe]", error);
      return sendJson(req, res, 500, { ok: false, error: "push_unsubscribe_failed" });
    }
  }

  if (req.method === "POST" && url.pathname === "/push/test") {
    try {
      if (!isPushConfigured) return sendJson(req, res, 503, { ok: false, accepted: false, error: "push_not_configured" });
      await ensurePushSubscriptionsSchema(pool);
      const endpoint = String((await readJson(req))?.endpoint || "").trim();
      if (!endpoint) return sendJson(req, res, 400, { ok: false, accepted: false, error: "endpoint_required" });
      const result = await sendPushToEndpoint(pool, webPush, endpoint, { title: "Bookshell", body: "Web Push funciona correctamente.", url: "/", type: "test" });
      return sendJson(req, res, result.accepted ? 200 : result.statusCode, { ok: result.accepted, ...result });
    } catch (error) {
      console.error("[push:test]", error);
      return sendJson(req, res, 500, { ok: false, accepted: false, error: "push_test_failed" });
    }
  }

  // ------------------------------------------------
  // REMINDERS
  // ------------------------------------------------

  if (
    req.method === "GET" &&
    url.pathname === "/reminders/due"
  ) {
    try {
      const untilRaw = String(
        url.searchParams.get("until") || ""
      ).trim();

      const until = untilRaw
        ? new Date(untilRaw)
        : new Date();

      if (Number.isNaN(until.getTime())) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_until",
        });
      }

      const result = await pool.query(
        `
          SELECT
            a.*,
            r.title,
            r.description,
            r.target_date,
            r.target_time,
            r.timezone,
            r.source_type
          FROM reminder_alerts a
          INNER JOIN reminders r
            ON r.id = a.reminder_id
          WHERE r.firebase_uid = $1
            AND r.status = 'pending'
            AND a.status = 'pending'
            AND a.notify_at IS NOT NULL
            AND a.notify_at <= $2
          ORDER BY a.notify_at ASC
          LIMIT 100
        `,
        [LEGACY_FIREBASE_UID, until]
      );

      return sendJson(req, res, 200, {
        ok: true,
        alerts: result.rows.map((row) => ({
          alertId: row.id,
          reminderId: row.reminder_id,
          title: row.title,
          description: row.description || "",
          targetDate: normalizeDateOnly(row.target_date),
          targetTime: normalizeTimeOnly(row.target_time),
          timezone: normalizeTimezone(row.timezone),
          mode: row.mode,
          minutesBefore:
            row.minutes_before === null
              ? null
              : Number(row.minutes_before),
          notifyAt: new Date(row.notify_at).toISOString(),
          sourceType: row.source_type,
        })),
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname === "/reminders"
  ) {
    try {
      const reminders = await listReminderRecords({
        status: url.searchParams.get("status") || "",
        sourceType: url.searchParams.get("sourceType") || "",
        from: url.searchParams.get("from") || "",
        until: url.searchParams.get("until") || "",
        limit: url.searchParams.get("limit") || 50,
        includeCancelled: url.searchParams.get("includeCancelled") === "1",
      });

      return sendJson(req, res, 200, {
        ok: true,
        reminders,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/reminders"
  ) {
    try {
      const body = await readJson(req);
      const result = await createReminderRecord(body || {});

      return sendJson(
        req,
        res,
        result.created ? 201 : 200,
        {
          ok: true,
          created: result.created,
          reminder: result.reminder,
        }
      );
    } catch (error) {
      console.error(error);

      return sendJson(
        req,
        res,
        reminderErrorStatus(error),
        {
          ok: false,
          error: error?.message || "internal_error",
        }
      );
    }
  }

  const reminderCompleteMatch = url.pathname.match(
    /^\/reminders\/([0-9a-f-]{36})\/complete$/i
  );

  if (
    req.method === "POST" &&
    reminderCompleteMatch
  ) {
    try {
      const body = await readJson(req);
      const reminder = await completeReminderRecord(
        reminderCompleteMatch[1],
        body || {}
      );

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  const reminderTestPushMatch = url.pathname.match(
    /^\/reminders\/([0-9a-f-]{36})\/test-push$/i
  );

  if (
    req.method === "POST" &&
    reminderTestPushMatch
  ) {
    try {
      const result = await sendReminderTestPush(
        reminderTestPushMatch[1],
        await readJson(req) || {}
      );

      if (!result) {
        return sendJson(req, res, 404, {
          ok: false,
          accepted: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(
        req,
        res,
        result.accepted ? 200 : result.statusCode,
        result
      );
    } catch (error) {
      console.error("[reminders:test-push]", error);

      return sendJson(req, res, error?.statusCode || 500, {
        ok: false,
        accepted: false,
        error: error?.message || "reminder_test_push_failed",
      });
    }
  }

  const reminderMatch = url.pathname.match(
    /^\/reminders\/([0-9a-f-]{36})$/i
  );

  if (
    req.method === "GET" &&
    reminderMatch
  ) {
    try {
      const reminder = await getReminderById(
        reminderMatch[1]
      );

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "PATCH" &&
    reminderMatch
  ) {
    try {
      const body = await readJson(req);
      const reminder = await patchReminderRecord(
        reminderMatch[1],
        body || {}
      );

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(
        req,
        res,
        reminderErrorStatus(error),
        {
          ok: false,
          error: error?.message || "internal_error",
        }
      );
    }
  }

  if (
    req.method === "DELETE" &&
    reminderMatch
  ) {
    try {
      const reminder = await cancelReminderRecord(reminderMatch[1]);

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // AUTOMATION API
  // ------------------------------------------------

  if (url.pathname.startsWith("/automation/")) {
    if (!isAutomationAuthorized(req)) {
      return sendJson(req, res, 401, {
        ok: false,
        error: "invalid_automation_secret",
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname === "/automation/reminders/due"
  ) {
    try {
      const result = await claimDueReminderAlerts(
        url.searchParams.get("limit") || 50
      );

      return sendJson(req, res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname === "/automation/reminders"
  ) {
    try {
      const result = await listAutomationReminders(
        String(
          url.searchParams.get("range") || "all"
        ).trim(),
        url.searchParams.get("limit") || 20
      );

      return sendJson(req, res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "GET" &&
    url.pathname === "/automation/reminders/search"
  ) {
    try {
      const result = await searchAutomationReminders(url.searchParams);

      return sendJson(req, res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "POST" &&
    url.pathname === "/automation/reminders"
  ) {
    try {
      const body = await readJson(req);
      const sourceType = normalizeSourceType(
        body?.source?.type || "telegram"
      );

      const result = await createReminderRecord(
        body || {},
        sourceType
      );

      return sendJson(
        req,
        res,
        result.created ? 201 : 200,
        {
          ok: true,
          created: result.created,
          reminder: result.reminder,
        }
      );
    } catch (error) {
      console.error(error);

      return sendJson(
        req,
        res,
        reminderErrorStatus(error),
        {
          ok: false,
          error: error?.message || "internal_error",
        }
      );
    }
  }

  const automationReminderAlertMatch = url.pathname.match(
    /^\/automation\/reminders\/([0-9a-f-]{36})\/alerts$/i
  );

  if (
    req.method === "POST" &&
    automationReminderAlertMatch
  ) {
    try {
      const body = await readJson(req);
      const reminder = await appendReminderAlert(
        automationReminderAlertMatch[1],
        body || {}
      );

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 201, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(
        req,
        res,
        reminderErrorStatus(error),
        {
          ok: false,
          error: error?.message || "internal_error",
        }
      );
    }
  }

  const automationReminderMatch = url.pathname.match(
    /^\/automation\/reminders\/([0-9a-f-]{36})$/i
  );

  if (
    req.method === "GET" &&
    automationReminderMatch
  ) {
    try {
      const reminder = await getReminderById(
        automationReminderMatch[1]
      );

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  if (
    req.method === "PATCH" &&
    automationReminderMatch
  ) {
    try {
      const body = await readJson(req);
      const reminder = await patchReminderRecord(
        automationReminderMatch[1],
        body || {}
      );

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(
        req,
        res,
        reminderErrorStatus(error),
        {
          ok: false,
          error: error?.message || "internal_error",
        }
      );
    }
  }

  if (
    req.method === "DELETE" &&
    automationReminderMatch
  ) {
    try {
      const reminder = await cancelReminderRecord(automationReminderMatch[1]);

      if (!reminder) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "reminder_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        reminder,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  const alertSentMatch = url.pathname.match(
    /^\/automation\/reminder-alerts\/([0-9a-f-]{36})\/sent$/i
  );

  if (
    req.method === "POST" &&
    alertSentMatch
  ) {
    try {
      const body = await readJson(req);
      const result = await markReminderAlertSent(
        alertSentMatch[1],
        body?.scheduleVersion
      );

      if (!result) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "alert_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  const alertFailedMatch = url.pathname.match(
    /^\/automation\/reminder-alerts\/([0-9a-f-]{36})\/failed$/i
  );

  if (
    req.method === "POST" &&
    alertFailedMatch
  ) {
    try {
      const body = await readJson(req);
      const result = await markReminderAlertFailed(
        alertFailedMatch[1],
        body?.error || body?.message || "",
        body?.scheduleVersion
      );

      if (!result) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "alert_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        ...result,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // DATA USAGE
  // ------------------------------------------------

  if (
    req.method === "POST" &&
    url.pathname === "/data-usage"
  ) {
    try {
      const body = await readJson(req);

      const path = String(body?.path || "").trim();

      const operation = String(
        body?.operation || ""
      )
        .trim()
        .toUpperCase();

      if (!path || path.length > 640) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      if (!ALLOWED_OPERATIONS.has(operation)) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_operation",
        });
      }

      await pool.query(
        `
        INSERT INTO data_usage_log (
          user_id,
          path,
          operation
        )
        VALUES ($1, $2, $3)
        `,
        [
          SINGLE_USER_ID,
          path,
          operation,
        ]
      );

      return sendJson(req, res, 201, {
        ok: true,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // GET DATA
  // ------------------------------------------------

  if (
    req.method === "GET" &&
    (
      url.pathname === "/data" ||
      url.pathname.startsWith("/data/")
    )
  ) {
    try {
      const path = getDataPath(url.pathname);

      if (!validatePath(path)) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      const row = await getUserData();

      if (!row) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "data_not_found",
        });
      }

      const value = path.length
        ? getAtPath(row.data, path)
        : row.data;

      return sendJson(req, res, 200, {
        ok: true,
        path: path.join("/"),
        data: value,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // PUT DATA
  // ------------------------------------------------

  if (
    req.method === "PUT" &&
    (
      url.pathname === "/data" ||
      url.pathname.startsWith("/data/")
    )
  ) {
    try {
      const path = getDataPath(url.pathname);

      if (!validatePath(path)) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      const body = await readJson(req);

      const result = await mutateUserData(
        async (data) =>
          setAtPath(data, path, body)
      );

      if (result === null) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "data_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        path: path.join("/"),
        data: body,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // PATCH DATA
  // ------------------------------------------------

  if (
    req.method === "PATCH" &&
    (
      url.pathname === "/data" ||
      url.pathname.startsWith("/data/")
    )
  ) {
    try {
      const path = getDataPath(url.pathname);

      if (!validatePath(path)) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      const patch = await readJson(req);

      if (
        !patch ||
        typeof patch !== "object" ||
        Array.isArray(patch)
      ) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_patch",
        });
      }

      const result = await mutateUserData(
        async (data) =>
          patchAtPath(data, path, patch)
      );

      if (result === null) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "data_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        path: path.join("/"),
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error:
          error.message === "Invalid patch path"
            ? "invalid_patch_path"
            : "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // DELETE DATA
  // ------------------------------------------------

  if (
    req.method === "DELETE" &&
    url.pathname.startsWith("/data/")
  ) {
    try {
      const path = getDataPath(url.pathname);

      if (
        !path.length ||
        !validatePath(path)
      ) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      const result = await mutateUserData(
        async (data) =>
          deleteAtPath(data, path)
      );

      if (result === null) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "data_not_found",
        });
      }

      return sendJson(req, res, 200, {
        ok: true,
        path: path.join("/"),
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // PUSH DATA
  // ------------------------------------------------

  if (
    req.method === "POST" &&
    (
      url.pathname === "/data/push" ||
      url.pathname.startsWith("/data/push/")
    )
  ) {
    try {
      const path = getDataPath(
        url.pathname,
        "/data/push"
      );

      if (!validatePath(path)) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      const body = await readJson(req);

      const id = crypto.randomUUID();
      const fullPath = [...path, id];

      const result = await mutateUserData(
        async (data) =>
          setAtPath(
            data,
            fullPath,
            body
          )
      );

      if (result === null) {
        return sendJson(req, res, 404, {
          ok: false,
          error: "data_not_found",
        });
      }

      return sendJson(req, res, 201, {
        ok: true,
        id,
        key: id,
        path: fullPath.join("/"),
        data: body,
      });
    } catch (error) {
      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    }
  }

  // ------------------------------------------------
  // TRANSACTION
  // ------------------------------------------------

  if (
    req.method === "POST" &&
    (
      url.pathname === "/data/transaction" ||
      url.pathname.startsWith("/data/transaction/")
    )
  ) {
    const client = await pool.connect();

    try {
      const path = getDataPath(
        url.pathname,
        "/data/transaction"
      );

      if (!validatePath(path)) {
        return sendJson(req, res, 400, {
          ok: false,
          error: "invalid_path",
        });
      }

      const body = await readJson(req);

      await client.query("BEGIN");

      const result = await client.query(
        `
        SELECT id, data
        FROM firebase_import_raw
        WHERE user_id = $1
        ORDER BY imported_at DESC
        LIMIT 1
        FOR UPDATE
        `,
        [SINGLE_USER_ID]
      );

      if (!result.rows.length) {
        await client.query("ROLLBACK");

        return sendJson(req, res, 404, {
          ok: false,
          error: "data_not_found",
        });
      }

      const row = result.rows[0];

      const currentServerValue = path.length
        ? getAtPath(row.data, path)
        : row.data;

      if (
        !valuesEqual(
          currentServerValue,
          body?.currentValue
        )
      ) {
        await client.query("ROLLBACK");

        return sendJson(req, res, 409, {
          ok: false,
          error: "transaction_conflict",
          currentValue: currentServerValue,
        });
      }

      const nextData = setAtPath(
        row.data,
        path,
        body?.nextValue
      );

      await client.query(
        `
        UPDATE firebase_import_raw
        SET data = $1::jsonb
        WHERE id = $2
        `,
        [
          JSON.stringify(nextData),
          row.id,
        ]
      );

      await client.query("COMMIT");

      return sendJson(req, res, 200, {
        ok: true,
        data: body?.nextValue,
      });
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {}

      console.error(error);

      return sendJson(req, res, 500, {
        ok: false,
        error: "internal_error",
      });
    } finally {
      client.release();
    }
  }

  // ------------------------------------------------
  // 404
  // ------------------------------------------------

  return sendJson(req, res, 404, {
    ok: false,
    error: "not_found",
  });
});

if (require.main === module) {
  if (!Pool) {
    throw new Error("pg_dependency_missing");
  }

  void Promise.all([
    ensurePushSubscriptionsSchema(pool),
    ensureReminderNotificationSchema(pool),
  ]).then(() => {
    console.log("[push:schema] push subscriptions and reminder notifications ready");
  }).catch((error) => {
    console.warn("[push:schema] setup failed", String(error?.message || error));
  });

  server.listen(PORT, "0.0.0.0", () => {
    console.log(
      `Bookshell API listening on port ${PORT} - AUTH DISABLED`
    );
    startReminderScheduler();
  });
}

module.exports = {
  __test: {
    buildAutomationReminderSearchQuery,
    matchesAutomationReminderSearch,
    normalizeAutomationReminderSearchParams,
    searchAutomationReminderRows,
    serializeReminder,
    normalizePushSubscription,
    ensurePushSubscriptionsSchema,
    ensureReminderNotificationSchema,
    sendPushToEndpoint,
    sendPushToActiveSubscriptions,
    upsertPushSubscription,
    listReminderRecords,
    cancelReminderRecord,
    normalizeReminderAlertSet,
    localDateTimeToUtc,
    getNextRecurrenceDate,
    formatMinutesBeforeLabel,
    buildReminderAlertPushPayload,
    buildDailySummaryPayload,
    resolveReminderTestPushPayload,
    sendReminderTestPush,
    claimDailySummaryDelivery,
    runDailySummaryPushCycle,
    runDueReminderAlertPushCycle,
    runReminderSchedulerTick,
    startReminderScheduler,
    stopReminderScheduler,
    pushConfig: { configured: isPushConfigured, publicKey: VAPID_PUBLIC_KEY },
  },
};
