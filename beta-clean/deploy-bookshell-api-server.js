const http = require("http");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
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

const MIGRATIONS_DIR = path.join(__dirname, "db", "migrations");
const MIGRATION_FILES = Object.freeze({
  pushSubscriptions: "20260827_web_push_base.sql",
  reminderNotifications: "20260828_reminder_web_push_scheduler.sql",
  shortcuts: "20260828_shortcuts_api.sql",
});

function readMigrationSql(name) {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, name), "utf8");
}

async function ensureMigrationBackedSchema(db, migrationFile, requiredRelations = []) {
  const migrationPath = path.join(MIGRATIONS_DIR, migrationFile);
  if (fs.existsSync(migrationPath)) {
    return db.query(readMigrationSql(migrationFile));
  }

  const missing = [];
  for (const relation of requiredRelations) {
    const result = await db.query("SELECT to_regclass($1) AS relation_name", [relation]);
    if (!result.rows[0]?.relation_name) missing.push(relation);
  }
  if (missing.length) {
    throw new Error(`migration_file_missing:${migrationFile}:${missing.join(",")}`);
  }
  return { rows: [], rowCount: 0 };
}

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
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Bookshell-Automation-Secret, Idempotency-Key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Expose-Headers": "Content-Disposition",
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
    ready = ensureMigrationBackedSchema(db, MIGRATION_FILES.pushSubscriptions, [
      "public.push_subscriptions",
    ]);
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
  const providerReady = Boolean(provider && (provider !== webPush || isPushConfigured));
  if (!providerReady) {
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

async function getUserDataForExport(db = pool) {
  const result = await db.query(
    `
    SELECT id, data, imported_at
    FROM firebase_import_raw
    WHERE user_id = $1
    ORDER BY imported_at DESC
    LIMIT 1
    `,
    [SINGLE_USER_ID]
  );

  return result.rows[0] || null;
}

async function listReminderRecordsForExport(db = pool) {
  const result = await db.query(
    `
      SELECT *
      FROM reminders
      WHERE firebase_uid = $1
      ORDER BY
        target_date ASC,
        target_time ASC NULLS FIRST,
        created_at ASC,
        id ASC
    `,
    [LEGACY_FIREBASE_UID]
  );

  const reminders = [];

  for (const row of result.rows) {
    reminders.push(
      serializeReminder(
        row,
        await getReminderAlerts(db, row.id)
      )
    );
  }

  return reminders;
}

function authenticateWebSessionRequest() {
  return getSingleUser();
}

function formatExportFilename(exportedAt = new Date().toISOString()) {
  const day = String(exportedAt || "").slice(0, 10) || new Date().toISOString().slice(0, 10);
  return `bookshell-backup-${day}.json`;
}

async function buildBookshellExport({
  db = pool,
  user = getSingleUser(),
  now = new Date(),
} = {}) {
  const exportedAt = now instanceof Date && !Number.isNaN(now.getTime())
    ? now.toISOString()
    : new Date().toISOString();
  const dataRow = await getUserDataForExport(db);
  const reminders = await listReminderRecordsForExport(db);

  return {
    schemaVersion: 1,
    exportedAt,
    app: "Bookshell",
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      legacyFirebaseUid: user.legacyFirebaseUid,
    },
    data: dataRow?.data || {},
    reminders,
    otherPersistentData: {
      sources: {
        dataTree: {
          table: "firebase_import_raw",
          importedAt: dataRow?.imported_at ? new Date(dataRow.imported_at).toISOString() : "",
        },
        reminders: {
          tables: ["reminders", "reminder_alerts"],
          count: reminders.length,
        },
      },
      excludedSources: {
        shortcutApiTokens: "operational bearer token hashes",
        shortcutIdempotencyKeys: "technical deduplication cache",
        pushSubscriptions: "device subscription secrets and ephemeral delivery state",
        reminderNotificationDeliveries: "technical Web Push delivery log",
        dataUsageLog: "telemetry",
        environment: "process secrets such as DATABASE_URL and VAPID_PRIVATE_KEY",
      },
    },
  };
}

async function sendBookshellExport(req, res, {
  db = pool,
  authenticate = authenticateWebSessionRequest,
  now = new Date(),
} = {}) {
  const user = await authenticate(req, db);
  if (!user) {
    return sendJson(req, res, 401, {
      ok: false,
      error: "AUTH_REQUIRED",
    });
  }

  const payload = await buildBookshellExport({ db, user, now });
  return sendJson(req, res, 200, payload, {
    "Content-Type": "application/json",
    "Content-Disposition": `attachment; filename="${formatExportFilename(payload.exportedAt)}"`,
    "Cache-Control": "no-store",
  });
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
// SHORTCUTS / FINANCE DOMAIN
// --------------------------------------------------

const API_PUBLIC_BASE_URL = String(
  process.env.BOOKSHELL_API_PUBLIC_URL || "https://api-bookshell.charlydob.com"
).trim().replace(/\/+$/g, "");
const APP_PUBLIC_BASE_URL = String(
  process.env.BOOKSHELL_PUBLIC_URL || "https://bookshell.charlydob.com"
).trim().replace(/\/+$/g, "");
const SHORTCUT_TOKEN_PREFIX = "bsh_";
const SHORTCUT_TOKEN_BYTES = 32;
const SHORTCUT_TOKEN_NAME = "iPhone Shortcuts";
const SHORTCUT_FINANCE_ROOT_PATH = "finance/finance";
const SHORTCUT_FINANCE_LEGACY_ROOT_PATH = "finance";
const SHORTCUT_WORLD_ROOT_PATH = "world";
const SHORTCUT_WORLD_SAVED_PATH = `${SHORTCUT_WORLD_ROOT_PATH}/saved`;
const SHORTCUT_WORLD_GEOGRAPHY_PATH = `${SHORTCUT_WORLD_ROOT_PATH}/geography`;
const SHORTCUT_WORLD_PLACES_PATH = `${SHORTCUT_WORLD_ROOT_PATH}/places`;
const SHORTCUT_WORLD_CATEGORY_EMOJIS_PATH = `${SHORTCUT_WORLD_ROOT_PATH}/categoryEmojis`;
const SHORTCUT_ALLOWED_TYPES = new Set(["expense", "income", "transfer"]);
const SHORTCUT_WORLD_ALLOWED_TYPES = new Set(["saved", "place", "local"]);
const SHORTCUT_SUPPORTED_CURRENCIES = Object.freeze([
  "EUR", "PEN", "BTC", "USD", "GBP", "CHF", "JPY", "CNY", "MXN",
  "COP", "ARS", "BRL", "CLP", "CAD", "AUD", "NOK", "SEK", "DKK",
]);

const SHORTCUT_FX_TO_EUR = Object.freeze({
  EUR: 1,
  PEN: 0.247,
  BTC: 1,
  USD: 0.92,
  GBP: 1.17,
  CHF: 1.03,
  JPY: 0.0059,
  CNY: 0.127,
  MXN: 0.051,
  COP: 0.00022,
  ARS: 0.001,
  BRL: 0.17,
  CLP: 0.001,
  CAD: 0.67,
  AUD: 0.61,
  NOK: 0.086,
  SEK: 0.087,
  DKK: 0.134,
});

const shortcutSchemaReadyByDb = new WeakMap();

function ensureShortcutSchema(db = pool) {
  if (!db || typeof db.query !== "function") {
    throw new Error("database_unavailable");
  }
  let ready = shortcutSchemaReadyByDb.get(db);
  if (!ready) {
    ready = ensureMigrationBackedSchema(db, MIGRATION_FILES.shortcuts, [
      "public.shortcut_api_tokens",
      "public.shortcut_idempotency_keys",
    ]);
    shortcutSchemaReadyByDb.set(db, ready);
  }
  return ready;
}

function sha256(value = "") {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function stableJson(value) {
  if (!value || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
}

function tokenHash(token = "") {
  return sha256(token);
}

function makeShortcutToken() {
  return `${SHORTCUT_TOKEN_PREFIX}${crypto.randomBytes(SHORTCUT_TOKEN_BYTES).toString("base64url")}`;
}

function safeTimingEqualHex(left = "", right = "") {
  const leftBuffer = Buffer.from(String(left || ""), "hex");
  const rightBuffer = Buffer.from(String(right || ""), "hex");
  return (
    leftBuffer.length === rightBuffer.length &&
    leftBuffer.length > 0 &&
    crypto.timingSafeEqual(leftBuffer, rightBuffer)
  );
}

function getBearerToken(req) {
  const header = String(req.headers.authorization || "").trim();
  const match = header.match(/^Bearer\s+(.+)$/i);
  return String(match?.[1] || "").trim();
}

async function getShortcutStatus(db = pool) {
  await ensureShortcutSchema(db);
  const result = await db.query(
    `
      SELECT id, name, token_prefix, token_last_four, created_at, updated_at, last_used_at
      FROM shortcut_api_tokens
      WHERE user_id = $1
        AND revoked_at IS NULL
      ORDER BY created_at DESC
      LIMIT 1
    `,
    [SINGLE_USER_ID]
  );
  const row = result.rows[0] || null;
  return {
    enabled: Boolean(row),
    token: row
      ? {
          id: row.id,
          name: row.name,
          prefix: row.token_prefix,
          lastFour: row.token_last_four,
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : "",
          updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : "",
          lastUsedAt: row.last_used_at ? new Date(row.last_used_at).toISOString() : "",
        }
      : null,
    endpoints: buildShortcutEndpointMap(),
  };
}

async function rotateShortcutToken(db = pool) {
  await ensureShortcutSchema(db);
  const token = makeShortcutToken();
  const hash = tokenHash(token);
  await db.query(
    `
      UPDATE shortcut_api_tokens
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [SINGLE_USER_ID]
  );
  const inserted = await db.query(
    `
      INSERT INTO shortcut_api_tokens (
        user_id,
        name,
        token_hash,
        token_prefix,
        token_last_four
      )
      VALUES ($1, $2, $3, $4, $5)
      RETURNING id, name, token_prefix, token_last_four, created_at, updated_at
    `,
    [
      SINGLE_USER_ID,
      SHORTCUT_TOKEN_NAME,
      hash,
      token.slice(0, SHORTCUT_TOKEN_PREFIX.length + 4),
      token.slice(-4),
    ]
  );
  return {
    ...(await getShortcutStatus(db)),
    tokenValue: token,
    tokenId: inserted.rows[0]?.id || "",
  };
}

async function revokeShortcutTokens(db = pool) {
  await ensureShortcutSchema(db);
  const result = await db.query(
    `
      UPDATE shortcut_api_tokens
      SET revoked_at = NOW(), updated_at = NOW()
      WHERE user_id = $1
        AND revoked_at IS NULL
    `,
    [SINGLE_USER_ID]
  );
  return { revoked: result.rowCount || 0 };
}

async function authenticateShortcutRequest(req, db = pool) {
  const supplied = getBearerToken(req);
  if (!supplied) return null;
  await ensureShortcutSchema(db);
  const suppliedHash = tokenHash(supplied);
  const result = await db.query(
    `
      SELECT id, token_hash
      FROM shortcut_api_tokens
      WHERE user_id = $1
        AND revoked_at IS NULL
      ORDER BY created_at DESC
    `,
    [SINGLE_USER_ID]
  );
  const match = result.rows.find((row) => safeTimingEqualHex(row.token_hash, suppliedHash));
  if (!match) return null;
  await db.query(
    `
      UPDATE shortcut_api_tokens
      SET last_used_at = NOW(), updated_at = NOW()
      WHERE id = $1
    `,
    [match.id]
  );
  return getSingleUser();
}

function buildShortcutEndpointMap() {
  return {
    financeOptions: `${API_PUBLIC_BASE_URL}/shortcuts/finance/options`,
    financeAccounts: `${API_PUBLIC_BASE_URL}/shortcuts/finance/accounts`,
    financeCategories: `${API_PUBLIC_BASE_URL}/shortcuts/finance/categories`,
    financeMovements: `${API_PUBLIC_BASE_URL}/shortcuts/finance/movements`,
    worldOptions: `${API_PUBLIC_BASE_URL}/shortcuts/world/options`,
    worldPlaces: `${API_PUBLIC_BASE_URL}/shortcuts/world/places`,
    remindersToday: `${API_PUBLIC_BASE_URL}/shortcuts/reminders/today`,
  };
}

function normalizeShortcutCurrency(value = "") {
  const code = String(value || "EUR").trim().toUpperCase();
  return SHORTCUT_SUPPORTED_CURRENCIES.includes(code) ? code : "";
}

function shortcutCurrencyToEUR(amount = 0, currency = "EUR") {
  const value = Number(amount || 0);
  const code = normalizeShortcutCurrency(currency);
  if (!Number.isFinite(value)) return Number.NaN;
  if (!code) return Number.NaN;
  return value * Number(SHORTCUT_FX_TO_EUR[code] || 1);
}

function shortcutConvertCurrency(amount = 0, from = "EUR", to = "EUR") {
  const value = Number(amount || 0);
  const fromCode = normalizeShortcutCurrency(from);
  const toCode = normalizeShortcutCurrency(to);
  if (!Number.isFinite(value) || !fromCode || !toCode) return Number.NaN;
  if (fromCode === toCode) return value;
  const fromToEUR = Number(SHORTCUT_FX_TO_EUR[fromCode] || 0);
  const toToEUR = Number(SHORTCUT_FX_TO_EUR[toCode] || 0);
  if (!(fromToEUR > 0) || !(toToEUR > 0)) return Number.NaN;
  return (value * fromToEUR) / toToEUR;
}

function normalizeShortcutType(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  if (safe === "gasto" || safe === "egreso") return "expense";
  if (safe === "ingreso") return "income";
  if (safe === "transferencia" || safe === "traspaso") return "transfer";
  return SHORTCUT_ALLOWED_TYPES.has(safe) ? safe : "";
}

function normalizeShortcutDay(value = "", now = new Date()) {
  const raw = String(value || "").trim();
  const direct = normalizeDateOnly(raw);
  if (direct) return direct;
  const date = raw ? new Date(raw) : now;
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function normalizeShortcutText(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeShortcutComparableText(value = "") {
  return normalizeShortcutText(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function normalizeShortcutCategoryName(value = "") {
  const safe = normalizeShortcutText(value);
  return safe || "";
}

function shortcutSafeKey(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[.#$/[\]]/g, "_")
    .replace(/[^a-z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function getFinanceRootAtPath(data = {}, path = SHORTCUT_FINANCE_ROOT_PATH) {
  return getAtPath(data, path.split("/").filter(Boolean)) || {};
}

function financeRootHasData(root = {}) {
  return Boolean(
    root &&
    typeof root === "object" &&
    (
      Object.keys(root.accounts || {}).length ||
      Object.keys(root.transactions || {}).length ||
      Object.keys(root.movements || {}).length ||
      Object.keys(root.tx || {}).length
    )
  );
}

function resolveFinanceRootPath(data = {}) {
  const current = getFinanceRootAtPath(data, SHORTCUT_FINANCE_ROOT_PATH);
  const legacy = getFinanceRootAtPath(data, SHORTCUT_FINANCE_LEGACY_ROOT_PATH);
  if (financeRootHasData(current)) return SHORTCUT_FINANCE_ROOT_PATH;
  if (financeRootHasData(legacy)) return SHORTCUT_FINANCE_LEGACY_ROOT_PATH;
  return SHORTCUT_FINANCE_ROOT_PATH;
}

function ensureFinanceRoot(data = {}, path = SHORTCUT_FINANCE_ROOT_PATH) {
  const parts = path.split("/").filter(Boolean);
  return ensureParent(data, parts);
}

async function readCurrentUserData(db = pool) {
  const result = await db.query(
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

function normalizeShortcutAccount(id = "", account = {}) {
  const safeId = String(account?.id || id || "").trim();
  const name = normalizeShortcutText(account?.name || account?.title || safeId);
  const assetType = String(account?.assetType || "").trim().toLowerCase() || (
    account?.isBitcoin === true || String(account?.currency || "").toUpperCase() === "BTC"
      ? "crypto"
      : "cash"
  );
  const currency = assetType === "crypto"
    ? "BTC"
    : (normalizeShortcutCurrency(account?.currency) || "EUR");
  return {
    ...account,
    id: safeId,
    name,
    currency,
    assetType,
    active: account?.active !== false && account?.disabled !== true && account?.deleted !== true,
  };
}

function listShortcutAccountsFromRoot(root = {}) {
  return Object.entries(root?.accounts || {})
    .map(([id, account]) => normalizeShortcutAccount(id, account))
    .filter((account) => account.id && account.active)
    .sort((left, right) => {
      const leftOrder = Number(left.displayOrder);
      const rightOrder = Number(right.displayOrder);
      if (Number.isFinite(leftOrder) || Number.isFinite(rightOrder)) {
        if (!Number.isFinite(leftOrder)) return 1;
        if (!Number.isFinite(rightOrder)) return -1;
        if (leftOrder !== rightOrder) return leftOrder - rightOrder;
      }
      return left.name.localeCompare(right.name, "es");
    });
}

function normalizeShortcutCategory(id = "", category = {}) {
  const source = category && typeof category === "object" ? category : {};
  const name = normalizeShortcutCategoryName(source.name || id);
  if (!name) return null;
  return {
    ...source,
    id: String(source.id || id || shortcutSafeKey(name) || name).trim(),
    name,
    type: String(source.type || source.movementType || "").trim().toLowerCase(),
  };
}

function listShortcutCategoriesFromRoot(root = {}, type = "") {
  const categories = new Map();
  Object.entries(root?.catalog?.categories || {}).forEach(([id, value]) => {
    const normalized = normalizeShortcutCategory(id, value);
    if (!normalized) return;
    const key = normalizeShortcutComparableText(normalized.name);
    if (key && !categories.has(key)) categories.set(key, normalized);
  });
  Object.values(root?.transactions || {}).forEach((tx) => {
    const name = normalizeShortcutCategoryName(tx?.category);
    const key = normalizeShortcutComparableText(name);
    if (key && !categories.has(key)) {
      categories.set(key, { id: tx?.categoryId || shortcutSafeKey(name) || name, name, type: normalizeShortcutType(tx?.type) });
    }
  });
  const safeType = normalizeShortcutType(type);
  return [...categories.values()]
    .filter((category) => {
      if (!safeType || safeType === "transfer") return true;
      return !category.type || category.type === safeType;
    })
    .sort((left, right) => left.name.localeCompare(right.name, "es"));
}

function resolveShortcutAccount(root = {}, accountId = "") {
  const safeId = String(accountId || "").trim();
  if (!safeId || !root?.accounts?.[safeId]) return null;
  const account = normalizeShortcutAccount(safeId, root.accounts[safeId]);
  return account.id && account.active ? account : null;
}

function resolveShortcutCategory(root = {}, categoryIdOrName = "", type = "") {
  if (normalizeShortcutType(type) === "transfer") return { id: "transfer", name: "transfer" };
  const safe = normalizeShortcutText(categoryIdOrName);
  const comparable = normalizeShortcutComparableText(safe);
  if (!safe) return null;
  const categories = listShortcutCategoriesFromRoot(root, type);
  return categories.find((category) => (
    String(category.id || "") === safe ||
    normalizeShortcutComparableText(category.name) === comparable ||
    shortcutSafeKey(category.name) === shortcutSafeKey(safe)
  )) || null;
}

function parseShortcutMovementInput(body = {}) {
  const type = normalizeShortcutType(body?.type || body?.movementType);
  const amount = Number(body?.amount);
  const currency = normalizeShortcutCurrency(body?.currency || body?.inputCurrency || "EUR");
  const date = normalizeShortcutDay(body?.date || body?.dateISO || "");
  return {
    amount,
    currency,
    type,
    date,
    accountId: normalizeShortcutText(body?.accountId),
    fromAccountId: normalizeShortcutText(body?.fromAccountId || body?.sourceAccountId),
    toAccountId: normalizeShortcutText(body?.toAccountId || body?.targetAccountId),
    categoryId: normalizeShortcutText(body?.categoryId || body?.category),
    description: normalizeShortcutText(body?.description || body?.note || body?.title),
    title: normalizeShortcutText(body?.title),
  };
}

function buildShortcutCategoryCatalogPayload(name = "", previous = {}, nowMs = Date.now(), type = "") {
  const safeName = normalizeShortcutCategoryName(name);
  if (!safeName) return null;
  return {
    ...(previous && typeof previous === "object" ? previous : {}),
    id: String(previous?.id || shortcutSafeKey(safeName) || safeName).trim(),
    name: safeName,
    emoji: String(previous?.emoji || "").trim(),
    color: String(previous?.color || "").trim(),
    icon: String(previous?.icon || "").trim(),
    lastUsedAt: nowMs,
    updatedAt: nowMs,
    createdAt: Number(previous?.createdAt || 0) || nowMs,
  };
}

function findShortcutCategoryCatalogKey(root = {}, category = {}) {
  const categoryId = String(category?.id || "").trim();
  const categoryName = normalizeShortcutCategoryName(category?.name);
  const comparableName = normalizeShortcutComparableText(categoryName);
  return Object.entries(root?.catalog?.categories || {}).find(([key, value]) => {
    const normalized = normalizeShortcutCategory(key, value);
    if (!normalized) return false;
    return (
      (categoryId && String(normalized.id || "") === categoryId) ||
      (comparableName && normalizeShortcutComparableText(normalized.name) === comparableName)
    );
  })?.[0] || "";
}

function resolveOrCreateShortcutCategory(root = {}, categoryIdOrName = "", type = "", nowMs = Date.now()) {
  const safeType = normalizeShortcutType(type);
  if (safeType === "transfer") return { id: "transfer", name: "transfer", created: false };
  const name = normalizeShortcutCategoryName(categoryIdOrName);
  if (!name) return null;
  const existing = resolveShortcutCategory(root, name, safeType);
  if (existing) return { ...existing, created: false };

  root.catalog = root.catalog || {};
  root.catalog.categories = root.catalog.categories || {};
  const key = shortcutSafeKey(name) || name;
  const payload = buildShortcutCategoryCatalogPayload(name, root.catalog.categories[key], nowMs, safeType);
  if (!payload) return null;
  root.catalog.categories[key] = payload;
  return { ...payload, created: true };
}

function normalizeShortcutSnapshots(snapshots = {}) {
  return Object.entries(snapshots || {})
    .map(([day, row]) => ({
      day: normalizeDateOnly(day) || String(day || "").slice(0, 10),
      value: Number(row?.value),
      updatedAt: Number(row?.updatedAt || 0),
    }))
    .filter((row) => row.day && Number.isFinite(row.value))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function normalizeShortcutEntries(entries = {}) {
  return Object.entries(entries || {})
    .map(([day, row]) => ({
      day: normalizeDateOnly(day) || String(day || "").slice(0, 10),
      value: Number(row?.value),
      updatedAt: Number(row?.updatedAt || row?.ts || 0),
    }))
    .filter((row) => row.day && Number.isFinite(row.value))
    .sort((left, right) => left.day.localeCompare(right.day));
}

function listShortcutTransactions(root = {}) {
  return Object.entries(root?.transactions || {})
    .map(([id, row]) => ({
      ...(row && typeof row === "object" ? row : {}),
      id: String(row?.id || id || "").trim(),
      type: normalizeShortcutType(row?.type),
      amount: Number(row?.amount || 0),
      date: normalizeShortcutDay(row?.date || row?.dateISO || ""),
      accountId: String(row?.accountId || "").trim(),
      fromAccountId: String(row?.fromAccountId || "").trim(),
      toAccountId: String(row?.toAccountId || "").trim(),
      category: normalizeShortcutCategoryName(row?.category),
    }))
    .filter((row) => row.id && SHORTCUT_ALLOWED_TYPES.has(row.type) && row.date && Number.isFinite(row.amount));
}

function buildShortcutAccountEntries(root = {}, accountId = "", fromDay = "", nowMs = Date.now()) {
  const safeAccountId = String(accountId || "").trim();
  const account = root?.accounts?.[safeAccountId];
  if (!safeAccountId || !account) return {};
  const snapshots = normalizeShortcutSnapshots(account.snapshots || {});
  const entries = normalizeShortcutEntries(account.entries || account.daily || {});
  const transactions = listShortcutTransactions(root).filter((tx) => (
    tx.accountId === safeAccountId ||
    tx.fromAccountId === safeAccountId ||
    tx.toAccountId === safeAccountId
  ));
  const days = new Set([
    ...snapshots.map((row) => row.day),
    ...transactions.map((tx) => tx.date),
    normalizeDateOnly(fromDay),
  ].filter(Boolean));
  const allDays = [...days].sort();
  const startDay = normalizeDateOnly(fromDay) || allDays[0] || "";
  if (!startDay) return {};
  let carry = 0;
  const previousEntry = entries.filter((entry) => entry.day < startDay).at(-1);
  const previousSnapshot = snapshots.filter((snapshot) => snapshot.day < startDay).at(-1);
  if (previousEntry) carry = Number(previousEntry.value || 0);
  else if (previousSnapshot) carry = Number(previousSnapshot.value || 0);

  const updates = {};
  for (const day of allDays.filter((item) => item >= startDay)) {
    const snapshot = snapshots.find((row) => row.day === day);
    let value = snapshot ? Number(snapshot.value || 0) : carry;
    for (const tx of transactions.filter((row) => row.date === day)) {
      if (tx.type === "income" && tx.accountId === safeAccountId) value += Number(tx.accountAmount ?? tx.amount ?? 0);
      if (tx.type === "expense" && tx.accountId === safeAccountId) value -= Number(tx.accountAmount ?? tx.amount ?? 0);
      if (tx.type === "transfer" && tx.fromAccountId === safeAccountId) value -= Number(tx.amount || 0);
      if (tx.type === "transfer" && tx.toAccountId === safeAccountId) value += Number(tx.amount || 0);
    }
    carry = value;
    updates[day] = {
      dateISO: `${day}T00:00:00.000Z`,
      value,
      updatedAt: nowMs,
      source: snapshot ? "snapshot" : "derived",
    };
  }
  return updates;
}

function buildShortcutFinanceSummary(root = {}, targetCurrency = "EUR") {
  const safeTarget = normalizeShortcutCurrency(targetCurrency) || "EUR";
  const accounts = listShortcutAccountsFromRoot(root);
  const accountBalances = accounts.map((account) => {
    const entries = normalizeShortcutEntries(account.entries || account.daily || {});
    const value = Number(entries.at(-1)?.value ?? 0);
    const converted = shortcutConvertCurrency(value, account.currency, safeTarget);
    return { accountId: account.id, currency: account.currency, value, converted };
  });
  const txRows = listShortcutTransactions(root);
  const totals = txRows.reduce((acc, tx) => {
    const amount = shortcutCurrencyToEUR(Number(tx.totalEUR || tx.convertedAmountEUR || tx.amount || 0), tx.totalEUR || tx.convertedAmountEUR ? "EUR" : (tx.originalCurrency || tx.currency || "EUR"));
    if (tx.type === "expense") acc.expensesEUR += Number.isFinite(amount) ? Math.abs(amount) : 0;
    if (tx.type === "income") acc.incomeEUR += Number.isFinite(amount) ? Math.abs(amount) : 0;
    return acc;
  }, { expensesEUR: 0, incomeEUR: 0 });
  const accountTotal = accountBalances.reduce((sum, row) => sum + (Number.isFinite(row.converted) ? row.converted : 0), 0);
  return {
    currency: safeTarget,
    accountTotal,
    expensesEUR: totals.expensesEUR,
    incomeEUR: totals.incomeEUR,
    netEUR: totals.incomeEUR - totals.expensesEUR,
    accounts: accountBalances,
    movementCount: txRows.length,
  };
}

function buildShortcutMovementPayload(input = {}, root = {}, nowMs = Date.now(), txId = crypto.randomUUID(), resolvedCategory = null) {
  const type = normalizeShortcutType(input.type);
  const currency = normalizeShortcutCurrency(input.currency);
  if (!type) throw Object.assign(new Error("INVALID_TYPE"), { statusCode: 400 });
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw Object.assign(new Error("INVALID_AMOUNT"), { statusCode: 400 });
  }
  if (!currency) throw Object.assign(new Error("INVALID_CURRENCY"), { statusCode: 400 });
  if (!normalizeDateOnly(input.date)) throw Object.assign(new Error("INVALID_DATE"), { statusCode: 400 });

  let account = null;
  let fromAccount = null;
  let toAccount = null;
  if (type === "transfer") {
    fromAccount = resolveShortcutAccount(root, input.fromAccountId);
    toAccount = resolveShortcutAccount(root, input.toAccountId);
    if (!fromAccount) throw Object.assign(new Error("FROM_ACCOUNT_NOT_FOUND"), { statusCode: 404 });
    if (!toAccount) throw Object.assign(new Error("TO_ACCOUNT_NOT_FOUND"), { statusCode: 404 });
    if (fromAccount.id === toAccount.id) throw Object.assign(new Error("INVALID_TRANSFER_ACCOUNTS"), { statusCode: 400 });
  } else {
    account = resolveShortcutAccount(root, input.accountId);
    if (!account) throw Object.assign(new Error("ACCOUNT_NOT_FOUND"), { statusCode: 404 });
  }

  const category = resolvedCategory || resolveShortcutCategory(root, input.categoryId, type);
  if (type !== "transfer" && !category) {
    throw Object.assign(new Error("CATEGORY_NOT_FOUND"), { statusCode: 404 });
  }

  const accountCurrency = account ? account.currency : currency;
  const accountAmount = account ? shortcutConvertCurrency(input.amount, currency, accountCurrency) : input.amount;
  if (!Number.isFinite(accountAmount) || accountAmount <= 0) {
    throw Object.assign(new Error("CURRENCY_CONVERSION_UNAVAILABLE"), { statusCode: 400 });
  }
  const convertedAmountEUR = shortcutCurrencyToEUR(input.amount, currency);
  if (!Number.isFinite(convertedAmountEUR) || convertedAmountEUR <= 0) {
    throw Object.assign(new Error("CURRENCY_CONVERSION_UNAVAILABLE"), { statusCode: 400 });
  }
  const note = input.description || input.title || "";
  return {
    id: txId,
    type,
    amount: type === "transfer" ? Number(input.amount) : Number(accountAmount),
    originalAmount: Number(input.amount),
    originalCurrency: currency,
    inputCurrency: currency,
    accountCurrency,
    accountAmount: type === "transfer" ? Number(input.amount) : Number(accountAmount),
    exchangeRateToEUR: currency === "EUR" ? 1 : Number(SHORTCUT_FX_TO_EUR[currency] || 1),
    convertedAmountEUR,
    totalEUR: convertedAmountEUR,
    currency: type === "transfer" ? currency : accountCurrency,
    date: input.date,
    dateISO: `${input.date}T00:00:00`,
    monthKey: input.date.slice(0, 7),
    accountId: type === "transfer" ? "" : account.id,
    fromAccountId: type === "transfer" ? fromAccount.id : "",
    toAccountId: type === "transfer" ? toAccount.id : "",
    category: type === "transfer" ? "transfer" : category.name,
    categoryId: type === "transfer" ? "transfer" : String(category.id || category.name),
    title: input.title || "",
    note,
    allocation: {
      mode: "point",
      period: "day",
      anchorDate: input.date,
      customStart: "",
      customEnd: "",
    },
    extras: null,
    source: "shortcut-api",
    shortcut: true,
    status: "synced",
    pending: false,
    draft: false,
    disabled: false,
    excluded: false,
    deleted: false,
    confirmed: true,
    updatedAt: nowMs,
    createdAt: nowMs,
  };
}

function formatShortcutNotificationAmount(value = 0) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "";
  if (Number.isInteger(amount)) return String(amount);
  return amount.toFixed(8).replace(/(?:\.0+|(\.\d*?)0+)$/, "$1");
}

function joinShortcutNotificationBodyParts(parts = []) {
  return parts
    .map((part) => normalizeShortcutText(part))
    .filter(Boolean)
    .join(" \u00b7 ");
}

function buildShortcutFinanceMovementPushPayload(movement = {}, root = {}) {
  const type = normalizeShortcutType(movement?.type);
  const amount = formatShortcutNotificationAmount(movement?.originalAmount ?? movement?.amount);
  const currency = normalizeShortcutCurrency(
    movement?.originalCurrency || movement?.inputCurrency || movement?.currency || "EUR"
  ) || "EUR";
  const amountLabel = [amount, currency].filter(Boolean).join(" ");
  const note = normalizeShortcutText(movement?.note || movement?.description || movement?.title);

  if (type === "transfer") {
    const fromAccount = resolveShortcutAccount(root, movement?.fromAccountId);
    const toAccount = resolveShortcutAccount(root, movement?.toAccountId);
    const accountLabel = [
      normalizeShortcutText(fromAccount?.name || movement?.fromAccountName || movement?.fromAccountId),
      normalizeShortcutText(toAccount?.name || movement?.toAccountName || movement?.toAccountId),
    ].filter(Boolean).join(" \u2192 ");
    return {
      title: "\ud83d\udd01 Nueva transferencia",
      body: joinShortcutNotificationBodyParts([amountLabel, accountLabel, note]),
      url: "/#view-finance",
      type: "shortcut-finance-movement",
      tag: `shortcut-finance:${movement?.id || ""}`,
      movementId: movement?.id || "",
      movementType: type,
    };
  }

  const title = type === "income"
    ? "\ud83d\udcb0 Nuevo ingreso"
    : "\ud83d\udcb8 Nuevo gasto";
  const category = normalizeShortcutCategoryName(movement?.category);
  return {
    title,
    body: joinShortcutNotificationBodyParts([amountLabel, category, note]),
    url: "/#view-finance",
    type: "shortcut-finance-movement",
    tag: `shortcut-finance:${movement?.id || ""}`,
    movementId: movement?.id || "",
    movementType: type || "expense",
  };
}

async function sendShortcutFinanceMovementPush(payload, {
  db = pool,
  provider = webPush,
  pushSender = sendPushToActiveSubscriptions,
} = {}) {
  if (!payload || typeof pushSender !== "function") {
    return {
      accepted: false,
      acceptedCount: 0,
      attemptedCount: 0,
      results: [],
      reason: "push_payload_unavailable",
    };
  }
  return pushSender(db, provider, payload, { ttl: 7200 });
}

async function withShortcutIdempotency(client, scope = "", key = "", requestHash = "", producer) {
  const safeKey = String(key || "").trim();
  if (!safeKey) return producer();
  if (safeKey.length > 200) {
    throw Object.assign(new Error("INVALID_IDEMPOTENCY_KEY"), { statusCode: 400 });
  }
  const existing = await client.query(
    `
      SELECT request_hash, status_code, response_body
      FROM shortcut_idempotency_keys
      WHERE user_id = $1
        AND scope = $2
        AND idempotency_key = $3
      LIMIT 1
    `,
    [SINGLE_USER_ID, scope, safeKey]
  );
  if (existing.rows.length) {
    const row = existing.rows[0];
    if (row.request_hash !== requestHash) {
      throw Object.assign(new Error("IDEMPOTENCY_CONFLICT"), { statusCode: 409 });
    }
    return {
      statusCode: Number(row.status_code || 200),
      body: { ...(row.response_body || {}), idempotent: true },
      replay: true,
    };
  }
  const result = await producer();
  await client.query(
    `
      INSERT INTO shortcut_idempotency_keys (
        user_id,
        scope,
        idempotency_key,
        request_hash,
        status_code,
        response_body
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb)
    `,
    [
      SINGLE_USER_ID,
      scope,
      safeKey,
      requestHash,
      result.statusCode,
      JSON.stringify(result.body || {}),
    ]
  );
  return result;
}

async function createShortcutFinanceMovement(body = {}, {
  idempotencyKey = "",
  db = pool,
  pushProvider = webPush,
  pushSender = sendPushToActiveSubscriptions,
  notifyPush = true,
} = {}) {
  await ensureShortcutSchema(db);
  const input = parseShortcutMovementInput(body);
  const requestHash = sha256(stableJson(input));
  const client = await db.connect();
  let result = null;
  try {
    await client.query("BEGIN");
    result = await withShortcutIdempotency(
      client,
      "finance:movements",
      idempotencyKey,
      requestHash,
      async () => {
        const dataResult = await client.query(
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
        if (!dataResult.rows.length) {
          throw Object.assign(new Error("DATA_NOT_FOUND"), { statusCode: 404 });
        }
        const row = dataResult.rows[0];
        const data = row.data || {};
        const financePath = resolveFinanceRootPath(data);
        const root = ensureFinanceRoot(data, financePath);
        root.accounts = root.accounts || {};
        root.transactions = root.transactions || {};
        root.catalog = root.catalog || {};
        root.catalog.categories = root.catalog.categories || {};

        const txId = crypto.randomUUID();
        const nowMs = Date.now();
        const category = resolveOrCreateShortcutCategory(root, input.categoryId, input.type, nowMs);
        const payload = buildShortcutMovementPayload(input, root, nowMs, txId, category);
        root.transactions[txId] = payload;
        if (payload.type !== "transfer") {
          const categoryKey = findShortcutCategoryCatalogKey(root, category) || payload.category;
          root.catalog.categories[categoryKey] = buildShortcutCategoryCatalogPayload(
            payload.category,
            root.catalog.categories[categoryKey],
            payload.updatedAt,
            payload.type
          );
        }

        const touchedAccounts = payload.type === "transfer"
          ? [payload.fromAccountId, payload.toAccountId]
          : [payload.accountId];
        for (const accountId of touchedAccounts.filter(Boolean)) {
          const account = root.accounts[accountId];
          if (!account) continue;
          account.entries = {
            ...(account.entries || {}),
            ...buildShortcutAccountEntries(root, accountId, payload.date, payload.updatedAt),
          };
          account.updatedAt = payload.updatedAt;
        }

        await client.query(
          `
            UPDATE firebase_import_raw
            SET data = $1::jsonb
            WHERE id = $2
          `,
          [JSON.stringify(data), row.id]
        );

        return {
          statusCode: 201,
          body: {
            ok: true,
            movement: payload,
            movementId: txId,
            financePath,
            balance: buildShortcutFinanceSummary(root, "EUR"),
          },
          pushPayload: buildShortcutFinanceMovementPushPayload(payload, root),
        };
      }
    );
    await client.query("COMMIT");
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw error;
  } finally {
    client.release();
  }
  if (notifyPush && result?.pushPayload && !result?.replay) {
    try {
      await sendShortcutFinanceMovementPush(result.pushPayload, {
        db,
        provider: pushProvider,
        pushSender,
      });
    } catch (error) {
      console.warn("[shortcuts:finance:movements:push]", error?.message || error);
    }
  }
  return result;
}

async function getShortcutFinanceOptions(type = "", db = pool) {
  const row = await readCurrentUserData(db);
  if (!row) return null;
  const financePath = resolveFinanceRootPath(row.data || {});
  const root = getFinanceRootAtPath(row.data || {}, financePath);
  return {
    financePath,
    accounts: listShortcutAccountsFromRoot(root).map((account) => ({
      id: account.id,
      name: account.name,
      currency: account.currency,
      assetType: account.assetType,
    })),
    categories: listShortcutCategoriesFromRoot(root, type).map((category) => ({
      id: category.id,
      name: category.name,
      ...(category.type ? { type: category.type } : {}),
    })),
    currencies: SHORTCUT_SUPPORTED_CURRENCIES,
    movementTypes: ["expense", "income", "transfer"],
  };
}

function getShortcutWorldRoot(data = {}) {
  return getAtPath(data, SHORTCUT_WORLD_ROOT_PATH.split("/").filter(Boolean)) || {};
}

function ensureShortcutWorldRoot(data = {}) {
  return ensureParent(data, SHORTCUT_WORLD_ROOT_PATH.split("/").filter(Boolean));
}

function normalizeShortcutWorldType(value = "") {
  const safe = String(value || "saved").trim().toLowerCase();
  if (!safe || safe === "quick" || safe === "guardado") return "saved";
  if (safe === "lugar" || safe === "geography" || safe === "geo") return "place";
  if (safe === "local" || safe === "place") return safe === "place" ? "place" : "local";
  return SHORTCUT_WORLD_ALLOWED_TYPES.has(safe) ? safe : "";
}

function limitShortcutWorldString(value = "", max = 240, errorCode = "INVALID_STRING") {
  const safe = normalizeShortcutText(value);
  if (safe.length > max) throw Object.assign(new Error(errorCode), { statusCode: 400 });
  return safe;
}

function parseShortcutWorldCapturedAt(value = "", nowMs = Date.now()) {
  const raw = String(value || "").trim();
  if (!raw) return new Date(nowMs);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw Object.assign(new Error("INVALID_CAPTURED_AT"), { statusCode: 400 });
  }
  return parsed;
}

function parseShortcutWorldRating(value = null) {
  if (value === null || value === undefined || String(value).trim() === "") return null;
  const rating = Number(value);
  if (!Number.isFinite(rating) || rating < 0 || rating > 10) {
    throw Object.assign(new Error("INVALID_RATING"), { statusCode: 400 });
  }
  return rating;
}

function parseShortcutCoordinate(value, { min, max, errorCode }) {
  let coordinate = NaN;

  if (typeof value === "number") {
    coordinate = value;
  } else if (typeof value === "string") {
    let safe = value
      .normalize("NFKC")
      .replace(/[\u2212\u2012\u2013\u2014]/g, "-")
      .trim();
    const directionMatch = safe.match(/^\s*([NSEW])\s*(.+)$/i) || safe.match(/^(.+?)\s*([NSEW])\s*$/i);
    const direction = directionMatch
      ? String(directionMatch[1].length === 1 ? directionMatch[1] : directionMatch[2]).toUpperCase()
      : "";
    if (directionMatch) {
      safe = String(directionMatch[1].length === 1 ? directionMatch[2] : directionMatch[1]).trim();
    }
    safe = safe.replace(/[°º]/g, "").replace(/\s+/g, "");
    if (/^[+-]?\d+(?:[.,]\d+)?$/.test(safe)) {
      coordinate = Number(safe.replace(",", "."));
      if (direction === "S" || direction === "W") coordinate = -Math.abs(coordinate);
      if (direction === "N" || direction === "E") coordinate = Math.abs(coordinate);
    }
  }

  if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
    throw Object.assign(new Error(errorCode), { statusCode: 400 });
  }

  return coordinate;
}

function parseShortcutWorldPlaceInput(body = {}, nowMs = Date.now()) {
  const type = normalizeShortcutWorldType(body?.type);
  if (!type) throw Object.assign(new Error("INVALID_WORLD_TYPE"), { statusCode: 400 });
  const latitude = parseShortcutCoordinate(body?.latitude ?? body?.lat, {
    min: -90,
    max: 90,
    errorCode: "INVALID_LATITUDE",
  });
  const longitude = parseShortcutCoordinate(body?.longitude ?? body?.lon ?? body?.lng, {
    min: -180,
    max: 180,
    errorCode: "INVALID_LONGITUDE",
  });
  const capturedDate = parseShortcutWorldCapturedAt(body?.capturedAt || body?.captured_at, nowMs);
  return {
    type,
    latitude,
    longitude,
    name: limitShortcutWorldString(body?.name || body?.title || "", 180, "INVALID_NAME"),
    category: limitShortcutWorldString(body?.category || "", 120, "INVALID_CATEGORY"),
    note: limitShortcutWorldString(body?.note || body?.description || "", 1200, "INVALID_NOTE"),
    rating: parseShortcutWorldRating(body?.rating),
    country: limitShortcutWorldString(body?.country || "", 160, "INVALID_COUNTRY"),
    countryCode: limitShortcutWorldString(body?.countryCode || body?.country_code || "", 8, "INVALID_COUNTRY_CODE").toUpperCase(),
    region: limitShortcutWorldString(body?.region || body?.state || body?.province || "", 180, "INVALID_REGION"),
    city: limitShortcutWorldString(body?.city || "", 180, "INVALID_CITY"),
    locality: limitShortcutWorldString(body?.locality || body?.town || body?.village || "", 180, "INVALID_LOCALITY"),
    address: limitShortcutWorldString(body?.address || body?.formattedAddress || "", 500, "INVALID_ADDRESS"),
    postalCode: limitShortcutWorldString(body?.postalCode || body?.postal_code || "", 40, "INVALID_POSTAL_CODE"),
    capturedAt: capturedDate.toISOString(),
    capturedAtMs: capturedDate.getTime(),
  };
}

function shortcutWorldCategoryKey(value = "") {
  return normalizeShortcutComparableText(value);
}

function inferShortcutWorldCategoryEmoji(category = "") {
  const key = shortcutWorldCategoryKey(category);
  if (!key) return "\ud83d\udccd";
  const matches = [
    ["montana", "\ud83c\udfd4\ufe0f"],
    ["mountain", "\ud83c\udfd4\ufe0f"],
    ["restaurante", "\ud83c\udf7d\ufe0f"],
    ["restaurant", "\ud83c\udf7d\ufe0f"],
    ["cafeteria", "\u2615"],
    ["cafe", "\u2615"],
    ["mirador", "\ud83d\udccd"],
    ["turistico", "\ud83d\udccd"],
    ["tienda", "\ud83d\uded2"],
    ["shop", "\ud83d\uded2"],
    ["bar", "\ud83c\udf78"],
    ["hotel", "\ud83c\udfe8"],
  ];
  return matches.find(([needle]) => key.includes(needle))?.[1] || "\ud83d\udccd";
}

function normalizeShortcutWorldCategoryEntry(entry = {}) {
  const category = normalizeShortcutText(entry?.category || entry?.name || "");
  const key = shortcutWorldCategoryKey(entry?.key || category);
  if (!key || !category) return null;
  return {
    ...(entry && typeof entry === "object" ? entry : {}),
    key,
    category,
    emoji: normalizeShortcutText(entry?.emoji || inferShortcutWorldCategoryEmoji(category)),
  };
}

function listShortcutWorldCategoriesFromRoot(root = {}) {
  const categories = new Map();
  Object.values(root?.categoryEmojis || {}).forEach((entry) => {
    const normalized = normalizeShortcutWorldCategoryEntry(entry);
    if (normalized && !categories.has(normalized.key)) categories.set(normalized.key, normalized);
  });
  Object.values(root?.places || {}).forEach((place) => {
    const category = normalizeShortcutText(place?.category || place?.type || "");
    const key = shortcutWorldCategoryKey(category);
    if (key && !categories.has(key)) {
      categories.set(key, {
        key,
        category,
        emoji: normalizeShortcutText(place?.emoji || inferShortcutWorldCategoryEmoji(category)),
      });
    }
  });
  return [...categories.values()].sort((left, right) => left.category.localeCompare(right.category, "es"));
}

function listShortcutWorldPlaceTypesFromRoot(root = {}) {
  const placeTypes = new Map();
  Object.values(root?.geography || {}).forEach((place) => {
    const name = normalizeShortcutText(place?.category || place?.type || "");
    const key = normalizeShortcutComparableText(name);
    if (key && !placeTypes.has(key)) placeTypes.set(key, name);
  });
  return [...placeTypes.values()].sort((left, right) => left.localeCompare(right, "es"));
}

function resolveOrCreateShortcutWorldCategory(root = {}, category = "", nowMs = Date.now()) {
  const safeCategory = normalizeShortcutText(category);
  if (!safeCategory) return null;
  root.categoryEmojis = root.categoryEmojis || {};
  const key = shortcutWorldCategoryKey(safeCategory);
  const existing = listShortcutWorldCategoriesFromRoot(root).find((entry) => entry.key === key);
  if (existing) return { ...existing, created: false };
  const payload = {
    key,
    category: safeCategory,
    emoji: inferShortcutWorldCategoryEmoji(safeCategory),
    createdAt: nowMs,
    updatedAt: nowMs,
  };
  root.categoryEmojis[key] = payload;
  return { ...payload, created: true };
}

function buildShortcutWorldMapsUrl(lat, lon) {
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lon)}`;
}

function buildShortcutWorldLabel(input = {}) {
  return [
    input.address,
    input.locality || input.city,
    input.region,
    input.country,
  ].filter(Boolean).join(", ");
}

function buildShortcutWorldItem(input = {}, root = {}, nowMs = Date.now(), itemId = crypto.randomUUID()) {
  const type = normalizeShortcutWorldType(input.type);
  const label = buildShortcutWorldLabel(input);
  const locationName = input.name || input.locality || input.city || input.region || input.country || "Ubicacion guardada";
  const common = {
    id: itemId,
    name: locationName,
    label,
    displayName: label || locationName,
    country: input.country,
    countryCode: input.countryCode,
    city: input.city || input.locality,
    locality: input.locality,
    region: input.region,
    postalCode: input.postalCode,
    address: input.address,
    note: input.note,
    lat: Number(input.latitude),
    lon: Number(input.longitude),
    lng: Number(input.longitude),
    googleMapsDirectionsUrl: buildShortcutWorldMapsUrl(input.latitude, input.longitude),
    googleMapsUrl: buildShortcutWorldMapsUrl(input.latitude, input.longitude),
    capturedAt: input.capturedAt,
    capturedAtMs: input.capturedAtMs,
    source: "shortcut-api",
    shortcut: true,
    rating: input.rating,
    createdAt: nowMs,
    updatedAt: nowMs,
  };

  if (type === "local") {
    const category = resolveOrCreateShortcutWorldCategory(root, input.category, nowMs);
    const categoryName = category?.category || input.category || "";
    return {
      ...common,
      kind: "places",
      type: categoryName,
      category: categoryName,
      emoji: category?.emoji || inferShortcutWorldCategoryEmoji(categoryName),
      productName: "",
      price: null,
      currency: "EUR",
    };
  }

  if (type === "place") {
    return {
      ...common,
      kind: "geography",
      category: input.category,
      emoji: "\ud83d\udccd",
    };
  }

  return {
    ...common,
    kind: "saved",
    type: "saved",
    status: "unclassified",
    category: "",
    emoji: "\ud83d\udccd",
  };
}

function shortcutWorldCollectionForType(type = "") {
  if (type === "place") return { key: "geography", path: SHORTCUT_WORLD_GEOGRAPHY_PATH };
  if (type === "local") return { key: "places", path: SHORTCUT_WORLD_PLACES_PATH };
  return { key: "saved", path: SHORTCUT_WORLD_SAVED_PATH };
}

async function createShortcutWorldPlace(body = {}, {
  idempotencyKey = "",
  db = pool,
} = {}) {
  await ensureShortcutSchema(db);
  const nowMs = Date.now();
  const input = parseShortcutWorldPlaceInput(body, nowMs);
  const capturedAtProvided = Boolean(String(body?.capturedAt || body?.captured_at || "").trim());
  const requestHash = sha256(stableJson({
    ...input,
    capturedAt: capturedAtProvided ? input.capturedAt : "",
    capturedAtMs: capturedAtProvided ? input.capturedAtMs : 0,
  }));
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await withShortcutIdempotency(
      client,
      "world:places",
      idempotencyKey,
      requestHash,
      async () => {
        const dataResult = await client.query(
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
        if (!dataResult.rows.length) {
          throw Object.assign(new Error("DATA_NOT_FOUND"), { statusCode: 404 });
        }
        const row = dataResult.rows[0];
        const data = row.data || {};
        const root = ensureShortcutWorldRoot(data);
        root.saved = root.saved || {};
        root.geography = root.geography || {};
        root.places = root.places || {};
        root.categoryEmojis = root.categoryEmojis || {};

        const itemId = crypto.randomUUID();
        const item = buildShortcutWorldItem(input, root, nowMs, itemId);
        const collection = shortcutWorldCollectionForType(input.type);
        root[collection.key][itemId] = item;

        await client.query(
          `
            UPDATE firebase_import_raw
            SET data = $1::jsonb
            WHERE id = $2
          `,
          [JSON.stringify(data), row.id]
        );

        return {
          statusCode: 201,
          body: {
            ok: true,
            item,
            itemId,
            type: input.type,
            worldPath: `${collection.path}/${itemId}`,
            openUrl: `${APP_PUBLIC_BASE_URL}/#view-world`,
          },
        };
      }
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

async function getShortcutWorldOptions(db = pool) {
  const row = await readCurrentUserData(db);
  if (!row) return null;
  const root = getShortcutWorldRoot(row.data || {});
  return {
    worldPath: SHORTCUT_WORLD_ROOT_PATH,
    types: ["saved", "place", "local"],
    placeTypes: listShortcutWorldPlaceTypesFromRoot(root),
    localCategories: listShortcutWorldCategoriesFromRoot(root).map((entry) => ({
      key: entry.key,
      name: entry.category,
      emoji: entry.emoji,
    })),
  };
}

async function sendTodayPendingPush({ timeZone = DEFAULT_REMINDER_TIMEZONE } = {}) {
  if (!isPushConfigured) {
    return { ok: false, accepted: false, statusCode: 503, error: "push_not_configured" };
  }
  await ensurePushSubscriptionsSchema(pool);
  const safeTimezone = normalizeTimezone(timeZone);
  const targetDate = todayDateStringInZone(safeTimezone);
  const reminders = await listDailySummaryReminders(targetDate, safeTimezone);
  if (!reminders.length) {
    return {
      ok: true,
      accepted: false,
      skipped: true,
      reason: "no_pending_reminders_today",
      count: 0,
      targetDate,
      timezone: safeTimezone,
    };
  }
  const payload = buildDailySummaryPayload({ targetDate, timezone: safeTimezone, reminders });
  const delivery = await sendPushToActiveSubscriptions(pool, webPush, payload, { ttl: 7200 });
  return {
    ok: delivery.accepted,
    accepted: delivery.accepted,
    count: reminders.length,
    targetDate,
    timezone: safeTimezone,
    payload,
    ...delivery,
  };
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
    ready = ensureMigrationBackedSchema(db, MIGRATION_FILES.reminderNotifications, [
      "public.reminder_notification_deliveries",
      "public.reminder_alerts",
    ]);
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
  // SHORTCUTS SETTINGS (web session)
  // ------------------------------------------------

  if (req.method === "GET" && url.pathname === "/shortcuts/status") {
    try {
      return sendJson(req, res, 200, {
        ok: true,
        ...(await getShortcutStatus(pool)),
      });
    } catch (error) {
      console.error("[shortcuts:status]", error);
      return sendJson(req, res, 500, { ok: false, error: "SHORTCUT_STATUS_FAILED" });
    }
  }

  if (req.method === "POST" && url.pathname === "/shortcuts/token") {
    try {
      return sendJson(req, res, 201, {
        ok: true,
        ...(await rotateShortcutToken(pool)),
      });
    } catch (error) {
      console.error("[shortcuts:token]", error);
      return sendJson(req, res, 500, { ok: false, error: "SHORTCUT_TOKEN_FAILED" });
    }
  }

  if (req.method === "DELETE" && url.pathname === "/shortcuts/token") {
    try {
      const result = await revokeShortcutTokens(pool);
      return sendJson(req, res, 200, { ok: true, ...result, ...(await getShortcutStatus(pool)) });
    } catch (error) {
      console.error("[shortcuts:revoke]", error);
      return sendJson(req, res, 500, { ok: false, error: "SHORTCUT_REVOKE_FAILED" });
    }
  }

  if (req.method === "POST" && url.pathname === "/reminders/today/push") {
    try {
      const body = await readJson(req);
      const result = await sendTodayPendingPush({
        timeZone: body?.timezone || req.headers["x-bookshell-timezone"] || DEFAULT_REMINDER_TIMEZONE,
      });
      return sendJson(
        req,
        res,
        result.ok ? 200 : (result.statusCode || 500),
        result
      );
    } catch (error) {
      console.error("[reminders:today-push]", error);
      return sendJson(req, res, error?.statusCode || 500, {
        ok: false,
        accepted: false,
        error: error?.message || "TODAY_PENDING_PUSH_FAILED",
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/export") {
    try {
      return await sendBookshellExport(req, res);
    } catch (error) {
      console.error("[export]", error);
      return sendJson(req, res, error?.statusCode || 500, {
        ok: false,
        error: error?.message || "EXPORT_FAILED",
      });
    }
  }

  // ------------------------------------------------
  // SHORTCUTS API (Bearer token)
  // ------------------------------------------------

  if (url.pathname.startsWith("/shortcuts/finance/") || url.pathname.startsWith("/shortcuts/world/") || url.pathname === "/shortcuts/reminders/today") {
    let user = null;
    try {
      user = await authenticateShortcutRequest(req, pool);
    } catch (error) {
      console.error("[shortcuts:auth]", error);
      return sendJson(req, res, 500, {
        ok: false,
        error: "SHORTCUT_AUTH_FAILED",
      });
    }
    if (!user) {
      return sendJson(req, res, 401, {
        ok: false,
        error: "INVALID_SHORTCUT_TOKEN",
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/shortcuts/finance/options") {
    try {
      const options = await getShortcutFinanceOptions(url.searchParams.get("type") || "", pool);
      if (!options) return sendJson(req, res, 404, { ok: false, error: "DATA_NOT_FOUND" });
      return sendJson(req, res, 200, { ok: true, ...options });
    } catch (error) {
      console.error("[shortcuts:finance:options]", error);
      return sendJson(req, res, 500, { ok: false, error: "FINANCE_OPTIONS_FAILED" });
    }
  }

  if (req.method === "GET" && url.pathname === "/shortcuts/finance/accounts") {
    try {
      const options = await getShortcutFinanceOptions("", pool);
      if (!options) return sendJson(req, res, 404, { ok: false, error: "DATA_NOT_FOUND" });
      return sendJson(req, res, 200, { ok: true, accounts: options.accounts });
    } catch (error) {
      console.error("[shortcuts:finance:accounts]", error);
      return sendJson(req, res, 500, { ok: false, error: "FINANCE_ACCOUNTS_FAILED" });
    }
  }

  if (req.method === "GET" && url.pathname === "/shortcuts/finance/categories") {
    try {
      const options = await getShortcutFinanceOptions(url.searchParams.get("type") || "", pool);
      if (!options) return sendJson(req, res, 404, { ok: false, error: "DATA_NOT_FOUND" });
      return sendJson(req, res, 200, { ok: true, categories: options.categories });
    } catch (error) {
      console.error("[shortcuts:finance:categories]", error);
      return sendJson(req, res, 500, { ok: false, error: "FINANCE_CATEGORIES_FAILED" });
    }
  }

  if (req.method === "POST" && url.pathname === "/shortcuts/finance/movements") {
    try {
      const body = await readJson(req);
      const result = await createShortcutFinanceMovement(body || {}, {
        idempotencyKey: req.headers["idempotency-key"] || body?.idempotencyKey || "",
      });
      return sendJson(req, res, result.statusCode || 201, result.body);
    } catch (error) {
      console.error("[shortcuts:finance:movements]", error?.message || error);
      return sendJson(req, res, error?.statusCode || 500, {
        ok: false,
        error: error?.message || "FINANCE_MOVEMENT_FAILED",
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/shortcuts/world/options") {
    try {
      const options = await getShortcutWorldOptions(pool);
      if (!options) return sendJson(req, res, 404, { ok: false, error: "DATA_NOT_FOUND" });
      return sendJson(req, res, 200, { ok: true, ...options });
    } catch (error) {
      console.error("[shortcuts:world:options]", error);
      return sendJson(req, res, 500, { ok: false, error: "WORLD_OPTIONS_FAILED" });
    }
  }

  if (req.method === "POST" && url.pathname === "/shortcuts/world/places") {
    try {
      const body = await readJson(req);
      const result = await createShortcutWorldPlace(body || {}, {
        idempotencyKey: req.headers["idempotency-key"] || body?.idempotencyKey || "",
      });
      return sendJson(req, res, result.statusCode || 201, result.body);
    } catch (error) {
      console.error("[shortcuts:world:places]", error?.message || error);
      return sendJson(req, res, error?.statusCode || 500, {
        ok: false,
        error: error?.message || "WORLD_PLACE_FAILED",
      });
    }
  }

  if (req.method === "POST" && url.pathname === "/shortcuts/reminders/today") {
    try {
      const body = await readJson(req);
      const result = await sendTodayPendingPush({
        timeZone: body?.timezone || req.headers["x-bookshell-timezone"] || DEFAULT_REMINDER_TIMEZONE,
      });
      return sendJson(
        req,
        res,
        result.ok ? 200 : (result.statusCode || 500),
        result
      );
    } catch (error) {
      console.error("[shortcuts:reminders:today]", error);
      return sendJson(req, res, error?.statusCode || 500, {
        ok: false,
        accepted: false,
        error: error?.message || "TODAY_PENDING_PUSH_FAILED",
      });
    }
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
    ensureShortcutSchema(pool),
  ]).then(() => {
    console.log("[schema] push, reminders and shortcuts ready");
  }).catch((error) => {
    console.warn("[schema] setup failed", String(error?.message || error));
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
    sendShortcutFinanceMovementPush,
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
    sendTodayPendingPush,
    buildBookshellExport,
    sendBookshellExport,
    formatExportFilename,
    authenticateWebSessionRequest,
    ensureShortcutSchema,
    getShortcutStatus,
    rotateShortcutToken,
    revokeShortcutTokens,
    authenticateShortcutRequest,
    buildShortcutEndpointMap,
    getShortcutFinanceOptions,
    createShortcutFinanceMovement,
    parseShortcutMovementInput,
    buildShortcutMovementPayload,
    buildShortcutFinanceMovementPushPayload,
    buildShortcutAccountEntries,
    buildShortcutFinanceSummary,
    getShortcutWorldOptions,
    createShortcutWorldPlace,
    parseShortcutCoordinate,
    parseShortcutWorldPlaceInput,
    buildShortcutWorldItem,
    listShortcutWorldCategoriesFromRoot,
    listShortcutWorldPlaceTypesFromRoot,
    resolveOrCreateShortcutWorldCategory,
    listShortcutTransactions,
    listShortcutAccountsFromRoot,
    listShortcutCategoriesFromRoot,
    resolveShortcutAccount,
    resolveShortcutCategory,
    resolveOrCreateShortcutCategory,
    claimDailySummaryDelivery,
    runDailySummaryPushCycle,
    runDueReminderAlertPushCycle,
    runReminderSchedulerTick,
    startReminderScheduler,
    stopReminderScheduler,
    pushConfig: { configured: isPushConfigured, publicKey: VAPID_PUBLIC_KEY },
  },
};
