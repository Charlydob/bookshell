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
    world: {
      geography: {
        geo_1: {
          id: "geo_1",
          kind: "geography",
          name: "Interlaken",
          category: "city",
          emoji: "\ud83d\udccd",
          lat: 46.686,
          lon: 7.861,
          lng: 7.861,
          country: "Switzerland",
          region: "Bern",
          city: "Interlaken",
          rating: 8.5,
          createdAt: 1787890000000,
          updatedAt: 1787890000000,
        },
      },
      places: {
        local_1: {
          id: "local_1",
          kind: "places",
          name: "Cafe Central",
          category: "Cafeteria",
          emoji: "\u2615",
          lat: 46.686,
          lon: 7.861,
          lng: 7.861,
          country: "Switzerland",
          region: "Bern",
          city: "Interlaken",
          rating: 9.25,
          createdAt: 1787890000000,
          updatedAt: 1787890000000,
        },
      },
      saved: {},
      categoryEmojis: {
        cafeteria: { key: "cafeteria", category: "Cafeteria", emoji: "\u2615" },
      },
    },
  };
}

function makeDb(data = makeData(), options = {}) {
  const idempotency = new Map();
  const tokens = [];
  const calls = [];
  const pushSubscriptions = (options.pushSubscriptions || []).map((subscription, index) => ({
    id: subscription.id || `push-${index + 1}`,
    endpoint: subscription.endpoint,
    p256dh: subscription.p256dh || subscription.keys?.p256dh || "public-key",
    auth: subscription.auth || subscription.keys?.auth || "auth-secret",
    disabled_at: subscription.disabled_at || null,
    failure_count: Number(subscription.failure_count || 0),
  }));

  const handleQuery = async (sql, params = []) => {
    calls.push({ sql, params });
    if (/BEGIN|COMMIT|ROLLBACK/.test(sql)) return { rows: [], rowCount: 0 };
    if (/CREATE TABLE IF NOT EXISTS shortcut_api_tokens/.test(sql)) return { rows: [], rowCount: 0 };
    if (/CREATE TABLE IF NOT EXISTS push_subscriptions/.test(sql)) return { rows: [], rowCount: 0 };

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

    if (/SELECT\s+endpoint\s+FROM push_subscriptions/.test(sql)) {
      const rows = pushSubscriptions
        .filter((subscription) => !subscription.disabled_at)
        .map((subscription) => ({ endpoint: subscription.endpoint }));
      return { rows, rowCount: rows.length };
    }
    if (/SELECT id, endpoint, p256dh, auth FROM push_subscriptions/.test(sql)) {
      const row = pushSubscriptions.find((subscription) => (
        subscription.endpoint === params[1] && !subscription.disabled_at
      ));
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE push_subscriptions SET last_success_at/.test(sql)) {
      const row = pushSubscriptions.find((subscription) => subscription.id === params[0]);
      if (row) row.failure_count = 0;
      return { rows: [], rowCount: row ? 1 : 0 };
    }
    if (/UPDATE push_subscriptions SET last_failure_at/.test(sql)) {
      const row = pushSubscriptions.find((subscription) => subscription.id === params[0]);
      if (row) {
        row.failure_count += 1;
        if ([404, 410].includes(Number(params[1]))) row.disabled_at = "2026-08-28T10:00:00.000Z";
      }
      return { rows: [], rowCount: row ? 1 : 0 };
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
  return { db, data, idempotency, tokens, calls, pushSubscriptions };
}

function financeRoot(data) {
  return data.finance.finance;
}

function worldRoot(data) {
  return data.world;
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

await test("categoria existente por nombre se reutiliza sin duplicar", async () => {
  const { root } = await createMovementAndRoot({
    amount: 4,
    currency: "EUR",
    accountId: "acc_eur",
    type: "expense",
    category: "Comida",
    date: "2026-08-28",
  });
  assert.equal(__test.listShortcutCategoriesFromRoot(root).filter((category) => category.name === "Comida").length, 1);
  assert.equal(__test.listShortcutTransactions(root)[0].category, "Comida");
});

await test("categoria nueva se crea en el catalogo canonico y se usa al instante", async () => {
  const { result, root } = await createMovementAndRoot({
    amount: 42,
    currency: "EUR",
    accountId: "acc_eur",
    type: "expense",
    category: "Dentista",
    date: "2026-08-28",
  });
  assert.equal(result.statusCode, 201);
  assert.equal(root.catalog.categories.dentista.name, "Dentista");
  assert.equal(__test.listShortcutTransactions(root)[0].category, "Dentista");
});

await test("categoria con distinta capitalizacion y espacios resuelve a la existente", async () => {
  const { root } = await createMovementAndRoot({
    amount: 5,
    currency: "EUR",
    accountId: "acc_eur",
    type: "expense",
    category: "  comida  ",
    date: "2026-08-28",
  });
  assert.equal(Object.values(root.catalog.categories).filter((category) => category.name.toLowerCase() === "comida").length, 1);
  assert.equal(__test.listShortcutTransactions(root)[0].category, "Comida");
});

await test("categoria equivalente con acentos no duplica", async () => {
  const fixture = makeDb();
  financeRoot(fixture.data).catalog.categories.Cafe = { id: "cat_cafe", name: "Café" };
  await __test.createShortcutFinanceMovement({
    amount: 3,
    currency: "EUR",
    accountId: "acc_eur",
    type: "expense",
    category: "cafe",
    date: "2026-08-28",
  }, { db: fixture.db });
  const categories = __test.listShortcutCategoriesFromRoot(financeRoot(fixture.data));
  assert.equal(categories.filter((category) => category.name === "Café").length, 1);
  assert.equal(__test.listShortcutTransactions(financeRoot(fixture.data))[0].category, "Café");
});

await test("idempotencia de categoria nueva no duplica categoria ni movimiento", async () => {
  const { db, data } = makeDb();
  const body = { amount: 7, currency: "EUR", accountId: "acc_eur", type: "expense", category: "Dentista", date: "2026-08-28" };
  await __test.createShortcutFinanceMovement(body, { db, idempotencyKey: "new-category" });
  const replay = await __test.createShortcutFinanceMovement(body, { db, idempotencyKey: "new-category" });
  const root = financeRoot(data);
  assert.equal(replay.replay, true);
  assert.equal(Object.keys(root.transactions).length, 1);
  assert.equal(Object.values(root.catalog.categories).filter((category) => category.name === "Dentista").length, 1);
});

await test("transferencia no crea categoria enviada por Atajos", async () => {
  const { root } = await createMovementAndRoot({
    amount: 5,
    currency: "EUR",
    fromAccountId: "acc_eur",
    toAccountId: "acc_cash",
    type: "transfer",
    category: "Dentista",
    date: "2026-08-28",
  });
  assert.equal(Boolean(root.catalog.categories.dentista), false);
  assert.equal(__test.listShortcutTransactions(root)[0].category, "transfer");
});

await test("gasto por Atajos envia un push despues del commit", async () => {
  const { db, calls } = makeDb();
  const pushes = [];
  const pushSender = async (_db, _provider, payload, options) => {
    assert.equal(calls.some((call) => call.sql === "COMMIT"), true);
    pushes.push({ payload, options });
    return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [] };
  };

  await __test.createShortcutFinanceMovement({
    amount: 12.5,
    currency: "CHF",
    accountId: "acc_eur",
    type: "expense",
    categoryId: "Comida",
    description: "Migros",
    date: "2026-08-28",
  }, { db, pushSender });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].payload.title, "💸 Nuevo gasto");
  assert.equal(pushes[0].payload.body, "12.5 CHF · Comida · Migros");
  assert.equal(pushes[0].options.ttl, 7200);
});

await test("ingreso por Atajos envia un push sin separadores sobrantes", async () => {
  const { db } = makeDb();
  const pushes = [];
  const pushSender = async (_db, _provider, payload) => {
    pushes.push(payload);
    return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [] };
  };

  await __test.createShortcutFinanceMovement({
    amount: 20,
    currency: "EUR",
    accountId: "acc_eur",
    type: "income",
    categoryId: "Nomina",
    date: "2026-08-28",
  }, { db, pushSender });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].title, "💰 Nuevo ingreso");
  assert.equal(pushes[0].body, "20 EUR · Nomina");
});

await test("transferencia por Atajos envia un push con cuentas origen y destino", async () => {
  const { db } = makeDb();
  const pushes = [];
  const pushSender = async (_db, _provider, payload) => {
    pushes.push(payload);
    return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [] };
  };

  await __test.createShortcutFinanceMovement({
    amount: 5,
    currency: "EUR",
    fromAccountId: "acc_eur",
    toAccountId: "acc_cash",
    type: "transfer",
    description: "Ahorro",
    date: "2026-08-28",
  }, { db, pushSender });

  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].title, "🔁 Nueva transferencia");
  assert.equal(pushes[0].body, "5 EUR · Revolut → Cash · Ahorro");
});

await test("fallo de movimiento por Atajos no envia push", async () => {
  const { db } = makeDb();
  const pushes = [];
  const pushSender = async (_db, _provider, payload) => {
    pushes.push(payload);
    return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [] };
  };

  await assert.rejects(
    () => __test.createShortcutFinanceMovement({
      amount: 1,
      currency: "EUR",
      accountId: "missing",
      type: "expense",
      categoryId: "Comida",
      date: "2026-08-28",
    }, { db, pushSender }),
    /ACCOUNT_NOT_FOUND/,
  );
  assert.equal(pushes.length, 0);
});

await test("replay del mismo Idempotency-Key no envia pushes adicionales", async () => {
  const { db, data } = makeDb();
  const pushes = [];
  const pushSender = async (_db, _provider, payload) => {
    pushes.push(payload);
    return { accepted: true, acceptedCount: 1, attemptedCount: 1, results: [] };
  };
  const body = {
    amount: 7,
    currency: "EUR",
    accountId: "acc_eur",
    type: "expense",
    categoryId: "Comida",
    date: "2026-08-28",
  };

  await __test.createShortcutFinanceMovement(body, { db, idempotencyKey: "same-push-key", pushSender });
  const replay = await __test.createShortcutFinanceMovement(body, { db, idempotencyKey: "same-push-key", pushSender });

  assert.equal(replay.replay, true);
  assert.equal(pushes.length, 1);
  assert.equal(Object.keys(financeRoot(data).transactions).length, 1);
});

await test("fallo del proveedor Web Push no impide guardar el movimiento", async () => {
  const { db, data, pushSubscriptions } = makeDb(makeData(), {
    pushSubscriptions: [{ endpoint: "https://push.example/sub-1", p256dh: "key", auth: "auth" }],
  });
  let providerCalls = 0;
  const pushProvider = {
    sendNotification: async () => {
      providerCalls += 1;
      throw Object.assign(new Error("provider down"), { statusCode: 502 });
    },
  };

  const result = await __test.createShortcutFinanceMovement({
    amount: 9,
    currency: "EUR",
    accountId: "acc_eur",
    type: "expense",
    categoryId: "Comida",
    date: "2026-08-28",
  }, { db, pushProvider });

  assert.equal(result.statusCode, 201);
  assert.equal(providerCalls, 1);
  assert.equal(pushSubscriptions[0].failure_count, 1);
  assert.equal(Object.keys(financeRoot(data).transactions).length, 1);
});

await test("POST /shortcuts/world/places guarda rapido en world/saved", async () => {
  const { db, data } = makeDb();
  const result = await __test.createShortcutWorldPlace({
    latitude: 46.686,
    longitude: 7.861,
    type: "saved",
    country: "Switzerland",
    region: "Bern",
    city: "Interlaken",
    capturedAt: "2026-08-28T10:00:00.000Z",
  }, { db, idempotencyKey: "world-saved-1" });
  assert.equal(result.statusCode, 201);
  assert.match(result.body.worldPath, /^world\/saved\//);
  assert.equal(Object.keys(worldRoot(data).saved).length, 1);
  assert.equal(Object.values(worldRoot(data).saved)[0].lat, 46.686);
});

await test("POST /shortcuts/world/places acepta coordenadas numericas validas", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: 46.686123,
    longitude: 7.861456,
    type: "saved",
  }, { db });
  const item = Object.values(worldRoot(data).saved)[0];
  assert.equal(item.lat, 46.686123);
  assert.equal(item.lon, 7.861456);
});

await test("POST /shortcuts/world/places acepta coordenadas string con punto", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: "46.686123",
    longitude: "7.861456",
    type: "saved",
  }, { db });
  const item = Object.values(worldRoot(data).saved)[0];
  assert.equal(item.lat, 46.686123);
  assert.equal(item.lon, 7.861456);
});

await test("POST /shortcuts/world/places acepta coma decimal localizada de Apple Shortcuts", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: "46,686123",
    longitude: "7,861456",
    type: "saved",
  }, { db });
  const item = Object.values(worldRoot(data).saved)[0];
  assert.equal(item.lat, 46.686123);
  assert.equal(item.lon, 7.861456);
});

await test("POST /shortcuts/world/places acepta grados, signo unicode y puntos cardinales", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: "46,686123° N",
    longitude: "7.861456 E",
    type: "saved",
  }, { db, idempotencyKey: "world-cardinal-positive" });
  await __test.createShortcutWorldPlace({
    latitude: "−15,6492308 S",
    longitude: "71.6015465 W",
    type: "saved",
  }, { db, idempotencyKey: "world-cardinal-negative" });
  const saved = Object.values(worldRoot(data).saved);
  assert.equal(saved.some((item) => item.lat === 46.686123 && item.lon === 7.861456), true);
  assert.equal(saved.some((item) => item.lat === -15.6492308 && item.lon === -71.6015465), true);
});

await test("POST /shortcuts/world/places acepta limites exactos de latitud y longitud", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: "-90",
    longitude: "-180",
    type: "saved",
  }, { db, idempotencyKey: "world-limit-negative" });
  await __test.createShortcutWorldPlace({
    latitude: 90,
    longitude: 180,
    type: "saved",
  }, { db, idempotencyKey: "world-limit-positive" });
  const saved = Object.values(worldRoot(data).saved);
  assert.equal(saved.some((item) => item.lat === -90 && item.lon === -180), true);
  assert.equal(saved.some((item) => item.lat === 90 && item.lon === 180), true);
});

await test("POST /shortcuts/world/places tipo place escribe en world/geography", async () => {
  const { db, data } = makeDb();
  const result = await __test.createShortcutWorldPlace({
    latitude: 46.68612345,
    longitude: 7.86198765,
    type: "place",
    rating: 8.75,
    country: "Switzerland",
    region: "Bern",
    city: "Interlaken",
  }, { db });
  assert.match(result.body.worldPath, /^world\/geography\//);
  const item = Object.values(worldRoot(data).geography).find((place) => place.id === result.body.itemId);
  assert.equal(item.kind, "geography");
  assert.equal(item.lon, 7.86198765);
  assert.equal(item.rating, 8.75);
});

await test("POST /shortcuts/world/places tipo local escribe en world/places", async () => {
  const { db, data } = makeDb();
  const result = await __test.createShortcutWorldPlace({
    latitude: 46.686,
    longitude: 7.861,
    type: "local",
    name: "Mirador Harder Kulm",
    category: "Mirador",
    rating: 9.5,
    country: "Switzerland",
    region: "Bern",
    city: "Interlaken",
  }, { db });
  assert.match(result.body.worldPath, /^world\/places\//);
  const item = Object.values(worldRoot(data).places).find((place) => place.name === "Mirador Harder Kulm");
  assert.equal(item.category, "Mirador");
  assert.equal(item.rating, 9.5);
});

await test("local con categoria existente de Mundo reutiliza categoryEmojis", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: 46.687,
    longitude: 7.862,
    type: "local",
    name: "Cafe Nuevo",
    category: " cafeteria ",
  }, { db });
  const root = worldRoot(data);
  assert.equal(Object.values(root.categoryEmojis).filter((entry) => entry.category === "Cafeteria").length, 1);
  assert.equal(Object.values(root.places).find((place) => place.name === "Cafe Nuevo").category, "Cafeteria");
});

await test("local con categoria nueva de Mundo crea categoryEmojis canonico", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: 46.688,
    longitude: 7.863,
    type: "local",
    name: "Tienda Alpina",
    category: "Tienda",
  }, { db });
  assert.equal(worldRoot(data).categoryEmojis.tienda.category, "Tienda");
});

await test("categoria de Mundo equivalente con mayusculas y acentos no duplica", async () => {
  const { db, data } = makeDb();
  worldRoot(data).categoryEmojis.cafe = { key: "cafe", category: "Café", emoji: "\u2615" };
  await __test.createShortcutWorldPlace({
    latitude: 46.689,
    longitude: 7.864,
    type: "local",
    name: "Cafe Lago",
    category: "  CAFE  ",
  }, { db });
  const categories = __test.listShortcutWorldCategoriesFromRoot(worldRoot(data));
  assert.equal(categories.filter((entry) => entry.key === "cafe").length, 1);
  assert.equal(Object.values(worldRoot(data).places).find((place) => place.name === "Cafe Lago").category, "Café");
});

await test("POST /shortcuts/world/places rechaza coordenadas invalidas", async () => {
  const { db } = makeDb();
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: 120, longitude: 7.861, type: "saved" }, { db }),
    /INVALID_LATITUDE/,
  );
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: 46.686, longitude: -220, type: "saved" }, { db }),
    /INVALID_LONGITUDE/,
  );
});

await test("POST /shortcuts/world/places rechaza valor no convertible y coordenadas parciales", async () => {
  const { db } = makeDb();
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: { value: 46.686 }, longitude: 7.861, type: "saved" }, { db }),
    /INVALID_LATITUDE/,
  );
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: "46.686 norte", longitude: 7.861, type: "saved" }, { db }),
    /INVALID_LATITUDE/,
  );
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: 46.686, longitude: null, type: "saved" }, { db }),
    /INVALID_LONGITUDE/,
  );
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: 46.686, longitude: ["7.861"], type: "saved" }, { db }),
    /INVALID_LONGITUDE/,
  );
});

await test("contrato de Mundo documenta numeros, strings con punto y coma decimal", () => {
  const docs = readFileSync(new URL("../docs/backend-api-contract.md", import.meta.url), "utf8");
  assert.match(docs, /JSON numbers or as strings/);
  assert.match(docs, /"46\.686123"/);
  assert.match(docs, /"46,686123"/);
  assert.match(docs, /complete numeric values/);
});

await test("POST /shortcuts/world/places valida rating opcional 0 a 10 con decimales", async () => {
  const { db, data } = makeDb();
  await __test.createShortcutWorldPlace({
    latitude: 46.686,
    longitude: 7.861,
    type: "saved",
    rating: 7.25,
  }, { db });
  assert.equal(Object.values(worldRoot(data).saved)[0].rating, 7.25);
  await assert.rejects(
    () => __test.createShortcutWorldPlace({ latitude: 46.686, longitude: 7.861, type: "local", rating: 10.5 }, { db }),
    /INVALID_RATING/,
  );
});

await test("POST /shortcuts/world/places soporta idempotencia", async () => {
  const { db, data } = makeDb();
  const body = { latitude: 46.686, longitude: 7.861, type: "saved" };
  await __test.createShortcutWorldPlace(body, { db, idempotencyKey: "same-world-key" });
  const replay = await __test.createShortcutWorldPlace(body, { db, idempotencyKey: "same-world-key" });
  assert.equal(replay.body.idempotent, true);
  assert.equal(Object.keys(worldRoot(data).saved).length, 1);
});

await test("GET /shortcuts/world/options expone tipos y categorias de Mundo", async () => {
  const { db } = makeDb();
  const options = await __test.getShortcutWorldOptions(db);
  assert.deepEqual(options.types, ["saved", "place", "local"]);
  assert.equal(options.placeTypes.includes("city"), true);
  assert.equal(options.localCategories.some((category) => category.name === "Cafeteria" && category.emoji === "\u2615"), true);
});

await test("POST /shortcuts/world/places conserva geography, places, ratings, categorias y emojis existentes", async () => {
  const { db, data } = makeDb();
  const beforeGeo = JSON.stringify(worldRoot(data).geography.geo_1);
  const beforeLocal = JSON.stringify(worldRoot(data).places.local_1);
  const beforeEmoji = JSON.stringify(worldRoot(data).categoryEmojis.cafeteria);
  await __test.createShortcutWorldPlace({
    latitude: 46.7,
    longitude: 7.9,
    type: "local",
    name: "Restaurante Nuevo",
    category: "Restaurante",
    rating: 6.5,
  }, { db });
  assert.equal(JSON.stringify(worldRoot(data).geography.geo_1), beforeGeo);
  assert.equal(JSON.stringify(worldRoot(data).places.local_1), beforeLocal);
  assert.equal(JSON.stringify(worldRoot(data).categoryEmojis.cafeteria), beforeEmoji);
  assert.equal(worldRoot(data).geography.geo_1.rating, 8.5);
  assert.equal(worldRoot(data).places.local_1.rating, 9.25);
  assert.equal(worldRoot(data).places.local_1.category, "Cafeteria");
  assert.equal(worldRoot(data).places.local_1.emoji, "\u2615");
});

await test("Guardados queda visible en la estructura canonica y la UI convierte sin duplicar", () => {
  const worldSource = readFileSync(new URL("../scripts/modules/world/index.js", import.meta.url), "utf8");
  const pathsSource = readFileSync(new URL("../scripts/shared/data/paths.js", import.meta.url), "utf8");
  const viewSource = readFileSync(new URL("../views/world.html", import.meta.url), "utf8");
  assert.match(pathsSource, /worldSaved/);
  assert.match(viewSource, /world-saved-list/);
  assert.match(worldSource, /state\.saved=Object\.values\(data\)/);
  assert.match(worldSource, /function convertSaved/);
  assert.match(worldSource, /state\.saved\.splice\(idx, 1\)/);
  assert.match(worldSource, /state\.places\.push\(converted\)/);
  assert.match(worldSource, /state\.geography\.push\(converted\)/);
});

await test("rechazar token invalido usa Authorization Bearer", () => {
  assert.match(serverSource, /Authorization/);
  assert.match(serverSource, /Bearer\\s\+/);
  assert.match(serverSource, /INVALID_SHORTCUT_TOKEN/);
  assert.match(serverSource, /url\.pathname\.startsWith\("\/shortcuts\/world\/"\)/);
});

await test("rechaza cuenta inexistente", async () => {
  const { db } = makeDb();
  await assert.rejects(
    () => __test.createShortcutFinanceMovement({ amount: 1, currency: "EUR", accountId: "missing", type: "expense", categoryId: "Comida", date: "2026-08-28" }, { db }),
    /ACCOUNT_NOT_FOUND/,
  );
});

await test("rechaza categoria vacia en gasto", async () => {
  const { db } = makeDb();
  await assert.rejects(
    () => __test.createShortcutFinanceMovement({ amount: 1, currency: "EUR", accountId: "acc_eur", type: "expense", categoryId: "", date: "2026-08-28" }, { db }),
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
