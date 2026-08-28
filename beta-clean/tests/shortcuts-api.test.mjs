import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { __test } = require("../deploy-bookshell-api-server.js");
const serverSource = readFileSync(new URL("../deploy-bookshell-api-server.js", import.meta.url), "utf8");
const mainSource = readFileSync(new URL("../scripts/app/main.js", import.meta.url), "utf8");
const financeRuntimeSource = readFileSync(new URL("../scripts/modules/finance/runtime.js", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../db/migrations/20260828_shortcuts_api.sql", import.meta.url), "utf8");

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    throw error;
  }
}

function makeData() {
  return {
    finance: {
      finance: {
        accounts: {
          acc_chf: { id: "acc_chf", name: "PostFinance", currency: "CHF", snapshots: { "2026-08-27": { value: 100, updatedAt: 1 } } },
          acc_eur: { id: "acc_eur", name: "Revolut", currency: "EUR", snapshots: { "2026-08-27": { value: 50, updatedAt: 1 } } },
          acc_cash: { id: "acc_cash", name: "Cash", currency: "EUR", snapshots: { "2026-08-27": { value: 200, updatedAt: 1 } } },
        },
        catalog: {
          categories: {
            Comida: { id: "cat_food", name: "Comida" },
            Nomina: { id: "cat_income", name: "Nomina", type: "income" },
          },
        },
        transactions: {},
      },
    },
  };
}

function makeDb(data = makeData()) {
  const idempotency = new Map();
  const tokens = [];
  const calls = [];

  const handleQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [], rowCount: 0 };
    if (/CREATE TABLE IF NOT EXISTS shortcut_api_tokens/.test(sql)) return { rows: [], rowCount: 0 };

    if (/FROM shortcut_idempotency_keys/.test(sql)) {
      const row = idempotency.get(`${params[1]}:${params[2]}`);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/INSERT INTO shortcut_idempotency_keys/.test(sql)) {
      idempotency.set(`${params[1]}:${params[2]}`, {
        request_hash: params[3],
        status_code: params[4],
        response_body: JSON.parse(params[5]),
      });
      return { rows: [], rowCount: 1 };
    }

    if (/UPDATE shortcut_api_tokens\s+SET revoked_at/.test(sql)) {
      let count = 0;
      tokens.forEach((token) => {
        if (!token.revoked_at) {
          token.revoked_at = new Date().toISOString();
          token.updated_at = token.revoked_at;
          count += 1;
        }
      });
      return { rows: [], rowCount: count };
    }
    if (/INSERT INTO shortcut_api_tokens/.test(sql)) {
      const row = {
        id: `tok-${tokens.length + 1}`,
        user_id: params[0],
        name: params[1],
        token_hash: params[2],
        token_prefix: params[3],
        token_last_four: params[4],
        created_at: "2026-08-28T10:00:00.000Z",
        updated_at: "2026-08-28T10:00:00.000Z",
        last_used_at: null,
        revoked_at: null,
      };
      tokens.push(row);
      return { rows: [row], rowCount: 1 };
    }
    if (/SELECT id, name, token_prefix, token_last_four/.test(sql)) {
      const active = tokens.filter((token) => !token.revoked_at).slice(-1).reverse();
      return { rows: active, rowCount: active.length };
    }
    if (/SELECT id, token_hash/.test(sql)) {
      const active = tokens.filter((token) => !token.revoked_at).slice().reverse();
      return { rows: active.map(({ id, token_hash }) => ({ id, token_hash })), rowCount: active.length };
    }
    if (/UPDATE shortcut_api_tokens\s+SET last_used_at/.test(sql)) {
      const token = tokens.find((row) => row.id === params[0]);
      if (token) token.last_used_at = "2026-08-28T10:05:00.000Z";
      return { rows: [], rowCount: token ? 1 : 0 };
    }

    if (/FROM firebase_import_raw/.test(sql)) return { rows: [{ id: "raw-1", data }], rowCount: 1 };
    if (/UPDATE firebase_import_raw/.test(sql)) {
      Object.keys(data).forEach((key) => delete data[key]);
      Object.assign(data, JSON.parse(params[0]));
      return { rows: [], rowCount: 1 };
    }
    return { rows: [], rowCount: 0 };
  };

  const client = { query: handleQuery, release() {} };
  const db = { query: handleQuery, connect: async () => client };
  return { db, data, idempotency, tokens, calls };
}

function financeRoot(data) {
  return data.finance.finance;
}

function authReq(token = "") {
  return { headers: { authorization: `Bearer ${token}` } };
}

async function createMovementAndRoot(body, options = {}) {
  const fixture = makeDb();
  const result = await __test.createShortcutFinanceMovement(body, { db: fixture.db, ...options });
  return { ...fixture, result, root: financeRoot(fixture.data) };
}

await test("la migracion esta en la carpeta activa, no en beta-clean duplicado", () => {
  assert.equal(existsSync(new URL("../db/migrations/20260828_shortcuts_api.sql", import.meta.url)), true);
  assert.equal(existsSync(new URL("../beta-clean/db/migrations/20260828_shortcuts_api.sql", import.meta.url)), false);
});

await test("el arranque ejecuta la migracion de shortcuts como source of truth", async () => {
  const { db, calls } = makeDb();
  await __test.ensureShortcutSchema(db);
  assert.equal(calls[0].sql, migrationSource);
  assert.match(serverSource, /ensureMigrationBackedSchema\(db, MIGRATION_FILES\.shortcuts/);
  assert.doesNotMatch(serverSource, /CREATE TABLE IF NOT EXISTS shortcut_api_tokens \(/);
});

await test("obtener cuentas devuelve solo cuentas reales del usuario", async () => {
  const { db } = makeDb();
  const options = await __test.getShortcutFinanceOptions("", db);
  assert.deepEqual(options.accounts.map((account) => account.name), ["Cash", "PostFinance", "Revolut"]);
  assert.equal(options.accounts.find((account) => account.id === "acc_chf").currency, "CHF");
});

await test("la API de cuentas no acepta userId enviado por el cliente", () => {
  assert.match(serverSource, /WHERE user_id = \$1/);
  assert.doesNotMatch(serverSource, /url\.searchParams\.get\("userId"\)/);
});

await test("obtener categorias permite filtrar por tipo", async () => {
  const { db } = makeDb();
  const options = await __test.getShortcutFinanceOptions("income", db);
  assert.deepEqual(options.categories.map((category) => category.name), ["Comida", "Nomina"]);
});

await test("POST /shortcuts/finance/movements escribe en transactions canonical igual que Finanzas web", () => {
  assert.match(serverSource, /root\.transactions\[txId\] = payload/);
  assert.match(financeRuntimeSource, /const canonicalTxPath = `\$\{state\.financePath\}\/transactions\/\$\{saveId\}`/);
  const canonicalPathIndex = financeRuntimeSource.indexOf("const canonicalTxPath");
  const webPayloadSource = financeRuntimeSource.slice(
    financeRuntimeSource.lastIndexOf("const payload = {", canonicalPathIndex),
    canonicalPathIndex
  );
  const shortcutPayloadSource = serverSource.slice(
    serverSource.indexOf("function buildShortcutMovementPayload"),
    serverSource.indexOf("async function withShortcutIdempotency")
  );
  for (const field of [
    "id", "type", "amount", "originalAmount", "originalCurrency",
    "inputCurrency", "accountCurrency", "accountAmount", "convertedAmountEUR",
    "totalEUR", "currency", "date", "monthKey", "accountId",
    "fromAccountId", "toAccountId", "category", "categoryId",
    "allocation", "extras", "status", "pending", "draft",
    "disabled", "excluded", "deleted", "confirmed", "updatedAt", "createdAt",
  ]) {
    assert.match(webPayloadSource, new RegExp(`${field}\\s*[:,]`));
    assert.match(shortcutPayloadSource, new RegExp(`${field}\\s*[:,]`));
  }
});

await test("gasto por Atajos aparece en listado, balance, cuenta y categorias", async () => {
  const { result, root } = await createMovementAndRoot({
    amount: 12.5,
    currency: "CHF",
    accountId: "acc_chf",
    type: "expense",
    categoryId: "cat_food",
    description: "Migros",
    date: "2026-08-28T10:00:00+02:00",
  }, { idempotencyKey: "expense-1" });

  assert.equal(result.statusCode, 201);
  const rows = __test.listShortcutTransactions(root);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, result.body.movementId);
  assert.equal(rows[0].type, "expense");
  assert.equal(rows[0].category, "Comida");
  assert.equal(root.transactions[result.body.movementId].note, "Migros");
  assert.equal(root.accounts.acc_chf.entries["2026-08-28"].value, 87.5);
  assert.equal(result.body.balance.expensesEUR, 12.875);
  assert.equal(root.catalog.categories.Comida.name, "Comida");
});

await test("balance y estadisticas web se alimentan de balanceTxList sobre transactions", () => {
  assert.match(financeRuntimeSource, /const fromNew = Object\.entries\(balance\?\.transactions \|\| \{\}\)/);
  assert.match(financeRuntimeSource, /const txRows = balanceTxList\(\)/);
  assert.match(financeRuntimeSource, /const monthAgg = calcAggForBucket\(monthActualTx, accountsById\)/);
  assert.match(financeRuntimeSource, /const statsMonth = buildBalanceStats\(monthActualTx, accountsById\)/);
  assert.match(financeRuntimeSource, /const donutPayload = computeFinanceStatsDonutPayload\(rangeRows, accountsById/);
  assert.match(financeRuntimeSource, /const txByDay = groupTxByDay\(tx, accountsById, statsScope\)/);
});

await test("crear ingreso incrementa la cuenta y los ingresos", async () => {
  const { result, root } = await createMovementAndRoot({
    amount: 20,
    currency: "EUR",
    accountId: "acc_eur",
    type: "income",
    categoryId: "Nomina",
    date: "2026-08-28",
  });
  assert.equal(root.accounts.acc_eur.entries["2026-08-28"].value, 70);
  assert.equal(result.body.balance.incomeEUR, 20);
  assert.equal(result.body.balance.netEUR, 20);
  assert.equal(__test.listShortcutTransactions(root)[0].type, "income");
});

await test("transferencia mueve saldo sin contar gasto ni ingreso", async () => {
  const { result, root } = await createMovementAndRoot({
    amount: 5,
    currency: "EUR",
    fromAccountId: "acc_eur",
    toAccountId: "acc_cash",
    type: "transfer",
    date: "2026-08-28",
  });
  assert.equal(result.body.balance.expensesEUR, 0);
  assert.equal(result.body.balance.incomeEUR, 0);
  assert.equal(root.accounts.acc_eur.entries["2026-08-28"].value, 45);
  assert.equal(root.accounts.acc_cash.entries["2026-08-28"].value, 205);
  assert.equal(__test.listShortcutCategoriesFromRoot(root, "transfer").some((category) => category.name === "transfer"), true);
});

await test("rechazar token invalido usa Authorization Bearer", () => {
  assert.match(serverSource, /Authorization/);
  assert.match(serverSource, /Bearer\\s\+/);
  assert.match(serverSource, /INVALID_SHORTCUT_TOKEN/);
});

await test("rechaza cuenta inexistente", async () => {
  const { db } = makeDb();
  await assert.rejects(
    () => __test.createShortcutFinanceMovement({ amount: 1, currency: "EUR", accountId: "missing", type: "expense", categoryId: "Comida", date: "2026-08-28" }, { db }),
    /ACCOUNT_NOT_FOUND/,
  );
});

await test("rechaza categoria invalida", async () => {
  const { db } = makeDb();
  await assert.rejects(
    () => __test.createShortcutFinanceMovement({ amount: 1, currency: "EUR", accountId: "acc_eur", type: "expense", categoryId: "missing", date: "2026-08-28" }, { db }),
    /CATEGORY_NOT_FOUND/,
  );
});

await test("Idempotency-Key evita duplicados", async () => {
  const { db, data } = makeDb();
  const body = { amount: 7, currency: "EUR", accountId: "acc_eur", type: "expense", categoryId: "Comida", date: "2026-08-28" };
  await __test.createShortcutFinanceMovement(body, { db, idempotencyKey: "same-key" });
  const replay = await __test.createShortcutFinanceMovement(body, { db, idempotencyKey: "same-key" });
  assert.equal(replay.body.idempotent, true);
  assert.equal(Object.keys(financeRoot(data).transactions).length, 1);
});

await test("Idempotency-Key detecta conflicto si cambia el body", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutFinanceMovement(
    { amount: 7, currency: "EUR", accountId: "acc_eur", type: "expense", categoryId: "Comida", date: "2026-08-28" },
    { db, idempotencyKey: "same-key" },
  );
  await assert.rejects(
    () => __test.createShortcutFinanceMovement(
      { amount: 8, currency: "EUR", accountId: "acc_eur", type: "expense", categoryId: "Comida", date: "2026-08-28" },
      { db, idempotencyKey: "same-key" },
    ),
    /IDEMPOTENCY_CONFLICT/,
  );
  assert.equal(Object.keys(financeRoot(data).transactions).length, 1);
});

await test("token de Atajos funciona recien generado, rota/revoca y no se guarda en texto plano", async () => {
  const { db, tokens, calls } = makeDb();
  const first = await __test.rotateShortcutToken(db);
  assert.equal(first.enabled, true);
  assert.match(first.tokenValue, /^bsh_/);
  assert.equal(tokens.length, 1);
  assert.notEqual(tokens[0].token_hash, first.tokenValue);
  assert.equal(tokens[0].token_prefix, first.tokenValue.slice(0, 8));
  assert.equal(tokens[0].token_last_four, first.tokenValue.slice(-4));
  assert.equal(JSON.stringify(calls.map((call) => call.params)).includes(first.tokenValue), false);

  assert.equal((await __test.authenticateShortcutRequest(authReq(first.tokenValue), db))?.id, "b403663c-3675-48fb-a82e-b921d78404b0");
  const second = await __test.rotateShortcutToken(db);
  assert.equal(await __test.authenticateShortcutRequest(authReq(first.tokenValue), db), null);
  assert.equal((await __test.authenticateShortcutRequest(authReq(second.tokenValue), db))?.id, "b403663c-3675-48fb-a82e-b921d78404b0");
  await __test.revokeShortcutTokens(db);
  assert.equal(await __test.authenticateShortcutRequest(authReq(second.tokenValue), db), null);
});

await test("Pendiente de hoy acepta timezone explicito y documenta Europe/Zurich", () => {
  assert.match(serverSource, /DEFAULT_REMINDER_TIMEZONE = "Europe\/Zurich"/);
  assert.match(serverSource, /timeZone: body\?\.timezone \|\| req\.headers\["x-bookshell-timezone"\] \|\| DEFAULT_REMINDER_TIMEZONE/);
  assert.match(serverSource, /listDailySummaryReminders\(targetDate, safeTimezone\)/);
  assert.match(serverSource, /buildDailySummaryPayload\(\{ targetDate, timezone: safeTimezone, reminders \}\)/);
  assert.match(readFileSync(new URL("../docs/backend-api-contract.md", import.meta.url), "utf8"), /"timezone": "Europe\/Zurich"/);
});

await test("la accion de prueba dispara Web Push sin modificar recordatorios", () => {
  const fnSource = serverSource.slice(
    serverSource.indexOf("async function sendTodayPendingPush"),
    serverSource.indexOf("// --------------------------------------------------\n// REMINDERS")
  );
  assert.match(fnSource, /sendPushToActiveSubscriptions/);
  assert.doesNotMatch(fnSource, /INSERT INTO reminders/);
  assert.doesNotMatch(fnSource, /UPDATE reminders/);
});

await test("Ajustes expone Pendiente de hoy y gestion de token", () => {
  assert.match(mainSource, /data-reminders-today-push/);
  assert.match(mainSource, /data-shortcuts-generate-token/);
  assert.match(mainSource, /data-shortcuts-revoke-token/);
  assert.match(mainSource, /settingsShortcutTokenValue/);
});

await test("migracion crea tokens e idempotencia persistente", () => {
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS shortcut_api_tokens/);
  assert.match(migrationSource, /CREATE TABLE IF NOT EXISTS shortcut_idempotency_keys/);
  assert.match(migrationSource, /UNIQUE \(user_id, scope, idempotency_key\)/);
  assert.doesNotMatch(migrationSource, /token_value|token_plain|plain_token/);
});
