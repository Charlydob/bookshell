"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto"),
  fs = require("node:fs"),
  path = require("node:path"),
  http = require("node:http");
const { Pool } = require("pg");
const {
  createJarvis,
  revision,
  totals,
  splitInterval,
} = require("../jarvis/domain");
const { createProjects } = require("../projects/server");
const { createDomain } = require("../projects/domain");
const { createNotifications } = require("../projects/notifications");
const { createHabitNotices } = require("../jarvis/notifications");
const connectionString = process.env.BOOKSHELL_TEST_DATABASE_URL;
if (!connectionString)
  throw new Error("An isolated bookshell_qa database is required");
const schema = "jarvis_qa_" + crypto.randomBytes(5).toString("hex"),
  admin = new Pool({ connectionString }),
  pool = new Pool({
    connectionString,
    options: `-c search_path=${schema},public`,
    max: 12,
  });
let clock = new Date("2026-10-29T10:00:00Z"),
  service;
const allScopes = [
  "projects:read",
  "projects:write",
  "habits:read",
  "habits:write",
  "time:read",
  "time:write",
  "notifications:write",
];
const key = () => crypto.randomUUID();
test.before(async () => {
  assert.equal(
    (await admin.query("SELECT current_database() AS db")).rows[0].db,
    "bookshell_qa",
    "Never run against the personal Bookshell database",
  );
  await admin.query("CREATE SCHEMA " + schema);
  await pool.query(
    "CREATE TABLE users(id uuid PRIMARY KEY,disabled boolean NOT NULL DEFAULT false);CREATE TABLE firebase_import_raw(id bigserial PRIMARY KEY,user_id uuid REFERENCES users(id),firebase_uid text,data jsonb NOT NULL,imported_at timestamptz DEFAULT now());CREATE TABLE reminders(id uuid PRIMARY KEY,firebase_uid text,title text,status text,target_date date,target_time time,timezone text);CREATE TABLE reminder_notification_deliveries(user_id uuid,delivery_type text,delivery_key text,target_date date,timezone text,target_at timestamptz,created_at timestamptz DEFAULT now(),payload jsonb,status text)",
  );
  for (const f of [
    "20261027_projects.sql",
    "20260827_web_push_base.sql",
    "20261028_task_notifications.sql",
    "20261029_jarvis_v2.sql",
  ])
    await pool.query(
      fs.readFileSync(path.join(__dirname, "../db/migrations", f), "utf8"),
    );
  service = createJarvis({ pool, nowFn: () => new Date(clock) });
});
test.after(async () => {
  await pool.end();
  await admin.query("DROP SCHEMA " + schema + " CASCADE");
  await admin.end();
});
async function fixture() {
  clock = new Date("2026-10-29T10:00:00Z");
  const userId = crypto.randomUUID();
  await pool.query("INSERT INTO users(id) VALUES($1)", [userId]);
  await pool.query(
    "INSERT INTO firebase_import_raw(user_id,data) VALUES($1,$2)",
    [
      userId,
      JSON.stringify({
        books: { books: { keep: { title: "Preserve" } } },
        habits: { habits: {}, habitSessions: {} },
      }),
    ],
  );
  return { userId, scopes: allScopes };
}
const call = (a, n, b = {}) => service.run(a, n, b);
const habit = (a, goal = "count", name = "Cepillado") =>
  call(a, "habits_create", {
    habit: {
      name,
      goal,
      schedule: { type: "daily", days: [] },
      targetsByRange: { day: goal === "time" ? 30 : 3 },
    },
    idempotencyKey: key(),
  });
const record = (a, id, extra = {}) =>
  call(a, "habits_record", {
    habitId: id,
    date: "2026-10-29",
    mode: "increment",
    value: 1,
    unit: "count",
    idempotencyKey: key(),
    ...extra,
  });

test("strict contracts, real dates, independent scopes and disabled users", async () => {
  const a = await fixture();
  await assert.rejects(
    call(a, "habits_list", { userId: a.userId }),
    /Unrecognized/,
  );
  await assert.rejects(
    habit({ ...a, scopes: ["projects:write"] }),
    /INSUFFICIENT_SCOPE/,
  );
  const { habit: h } = await habit(a);
  await assert.rejects(record(a, h.id, { date: "2026-02-30" }));
  await pool.query("UPDATE users SET disabled=true WHERE id=$1", [a.userId]);
  await assert.rejects(call(a, "habits_list"), /USER_DISABLED/);
});
test("canonical habit schema, normalized duplicates, edits, optimistic concurrency and preservation", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a);
  await assert.rejects(habit(a, "count", "  CEPILLADO  "), /ALREADY_EXISTS/);
  const edited = await call(a, "habits_update", {
    habitId: h.id,
    expectedRevision: h.revision,
    patch: { name: "Cepillado dental" },
    idempotencyKey: key(),
  });
  assert.equal(edited.habit.name, "Cepillado dental");
  await assert.rejects(
    call(a, "habits_update", {
      habitId: h.id,
      expectedRevision: h.revision,
      patch: { name: "Stale" },
      idempotencyKey: key(),
    }),
    /REVISION_CONFLICT/,
  );
  const row = (
    await pool.query("SELECT data FROM firebase_import_raw WHERE user_id=$1", [
      a.userId,
    ])
  ).rows[0];
  assert.equal(row.data.books.books.keep.title, "Preserve");
  assert.equal(row.data.habits.habits[h.id].jarvisTargets.day, 3);
});
test("idempotent creation/recording, conflicting payloads and concurrent increments", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a),
    idempotencyKey = key(),
    b = {
      habitId: h.id,
      date: "2026-10-29",
      mode: "increment",
      value: 1,
      unit: "count",
      idempotencyKey,
    };
  await Promise.all([call(a, "habits_record", b), call(a, "habits_record", b)]);
  assert.equal(
    (
      await call(a, "habits_history", {
        habitId: h.id,
        from: b.date,
        to: b.date,
      })
    ).total,
    1,
  );
  await assert.rejects(
    call(a, "habits_record", { ...b, value: 2 }),
    /IDEMPOTENCY_CONFLICT/,
  );
  await Promise.all(Array.from({ length: 5 }, () => record(a, h.id)));
  assert.equal(
    (
      await call(a, "habits_history", {
        habitId: h.id,
        from: b.date,
        to: b.date,
      })
    ).total,
    6,
  );
});
test("set totals needs current revision; decreases need confirmation; type/unit mismatch rejected", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a);
  await record(a, h.id, { value: 3 });
  await assert.rejects(
    record(a, h.id, { mode: "set", value: 1 }),
    /EXPECTED_REVISION_REQUIRED/,
  );
  const hist = await call(a, "habits_history", {
      habitId: h.id,
      from: "2026-10-29",
      to: "2026-10-29",
    }),
    expectedRevision = hist.days[0].revision;
  await assert.rejects(
    record(a, h.id, { mode: "set", value: 1, expectedRevision }),
    /CONFIRM_DECREASE/,
  );
  await record(a, h.id, {
    mode: "set",
    value: 1,
    expectedRevision,
    confirmed: true,
  });
  await assert.rejects(record(a, h.id, { unit: "minutes" }), /UNIT_MISMATCH/);
});
test("time records preserve the old total and do not treat increment as replacement", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a, "time");
  await record(a, h.id, { unit: "minutes", value: 30 });
  await record(a, h.id, { unit: "minutes", value: 15 });
  assert.equal(
    (
      await call(a, "habits_history", {
        habitId: h.id,
        from: "2026-10-29",
        to: "2026-10-29",
      })
    ).total,
    2700,
  );
});
test("belongs to user: habits, sessions and project associations never cross owners", async () => {
  const a = await fixture(),
    b = await fixture(),
    { habit: h } = await habit(a, "time");
  await assert.rejects(record(b, h.id, { unit: "minutes" }), /HABIT_NOT_FOUND/);
  const project = await createDomain(pool).create(a.userId, {
    title: "Private project",
  });
  await assert.rejects(
    call(b, "activity_start", {
      label: "Design",
      projectId: project.id,
      timezone: "Europe/Madrid",
      idempotencyKey: key(),
    }),
    /PROJECT_NOT_FOUND/,
  );
  const s = await call(a, "activity_start", {
    label: "Design",
    habitId: h.id,
    projectId: project.id,
    timezone: "Europe/Madrid",
    idempotencyKey: key(),
  });
  await assert.rejects(
    call(b, "activity_change", {
      sessionId: s.session.id,
      expectedRevision: s.session.revision,
      action: "stop",
      idempotencyKey: key(),
    }),
    /SESSION_NOT_FOUND/,
  );
});
test("simultaneous work + Twitch, pause/resume, stop/replay and atomic habit credits", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a, "time");
  let x = (
    await call(a, "activity_start", {
      label: "Design",
      habitId: h.id,
      timezone: "Europe/Madrid",
      idempotencyKey: key(),
    })
  ).session;
  const y = (
    await call(a, "activity_start", {
      label: "Twitch",
      timezone: "Europe/Madrid",
      idempotencyKey: key(),
    })
  ).session;
  clock = new Date("2026-10-29T10:30:00Z");
  x = (
    await call(a, "activity_change", {
      sessionId: x.id,
      expectedRevision: x.revision,
      action: "pause",
      idempotencyKey: key(),
    })
  ).session;
  clock = new Date("2026-10-29T10:45:00Z");
  x = (
    await call(a, "activity_change", {
      sessionId: x.id,
      expectedRevision: x.revision,
      action: "resume",
      idempotencyKey: key(),
    })
  ).session;
  clock = new Date("2026-10-29T11:00:00Z");
  const stop = {
    sessionId: x.id,
    expectedRevision: x.revision,
    action: "stop",
    idempotencyKey: key(),
  };
  await call(a, "activity_change", stop);
  assert.equal((await call(a, "activity_change", stop)).replayed, true);
  await call(a, "activity_change", {
    sessionId: y.id,
    expectedRevision: y.revision,
    action: "stop",
    idempotencyKey: key(),
  });
  const q = await call(a, "activity_query", {
    from: "2026-10-29T00:00:00Z",
    to: "2026-10-30T00:00:00Z",
    timezone: "Europe/Madrid",
  });
  assert.deepEqual(q.totals, {
    elapsedSec: 3600,
    activitySec: 6300,
    exclusiveSec: 900,
    overlapSec: 2700,
  });
  assert.equal(
    (
      await call(a, "habits_history", {
        habitId: h.id,
        from: "2026-10-29",
        to: "2026-10-29",
      })
    ).total,
    2700,
  );
});
test("manual intervals split correctly across midnight and reject invented future or self-overlap", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a, "time");
  await call(a, "activity_manual", {
    label: "Late design",
    habitId: h.id,
    timezone: "Europe/Madrid",
    intervals: [{ start: "2026-10-28T22:30:00Z", end: "2026-10-28T23:30:00Z" }],
    idempotencyKey: key(),
  });
  const hist = await call(a, "habits_history", {
    habitId: h.id,
    from: "2026-10-28",
    to: "2026-10-29",
  });
  assert.deepEqual(
    hist.days.map((x) => x.value),
    [1800, 1800],
  );
  await assert.rejects(
    call(a, "activity_manual", {
      label: "Future",
      timezone: "Europe/Madrid",
      intervals: [
        { start: "2026-10-30T10:00:00Z", end: "2026-10-30T11:00:00Z" },
      ],
      idempotencyKey: key(),
    }),
    /INVALID_INTERVAL/,
  );
  assert.equal(
    splitInterval(
      Date.parse("2026-10-24T22:00:00Z"),
      Date.parse("2026-10-25T23:00:00Z"),
      "Europe/Madrid",
    ).reduce((n, x) => n + x.end - x.start, 0),
    25 * 3600000,
  );
});
test("reminders use shared engine, explicit times, no duplicates and skip daily target already achieved", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a);
  await pool.query(
    "INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES($1,$2,'test','test')",
    [a.userId, "https://push.invalid/" + a.userId],
  );
  const plan = {
    enabled: true,
    times: ["12:00", "15:00", "21:00"],
    timezone: "Europe/Madrid",
    startDate: "2026-10-29",
  };
  await assert.rejects(
    call({ ...a, scopes: ["habits:write"] }, "habits_reminders", {
      habitId: h.id,
      expectedRevision: h.revision,
      plan,
      idempotencyKey: key(),
    }),
    /INSUFFICIENT_SCOPE/,
  );
  await call(a, "habits_reminders", {
    habitId: h.id,
    expectedRevision: h.revision,
    plan,
    idempotencyKey: key(),
  });
  let calls = 0;
  const notices = createHabitNotices(),
    n = createNotifications({
      pool,
      domain: createDomain(pool),
      ownerId: a.userId,
      sendDevice: async () => {
        calls++;
        return { accepted: true, statusCode: 201 };
      },
      nowFn: () => new Date(clock),
      enqueueAdditional: notices.enqueue,
      validateAdditional: notices.validate,
    });
  clock = new Date("2026-10-29T11:00:00Z");
  await n.tick({ onlyUser: a.userId });
  await n.tick({ onlyUser: a.userId });
  assert.equal(calls, 1);
  await record(a, h.id, { value: 3 });
  clock = new Date("2026-10-29T14:00:00Z");
  await n.tick({ onlyUser: a.userId });
  assert.equal(calls, 1);
});
test("HTTP MCP: actual SDK discovers both generations; old token cannot write habits; new token persists read-back", async () => {
  const a = await fixture(),
    token = crypto.randomBytes(32).toString("base64url"),
    old = crypto.randomBytes(32).toString("base64url");
  for (const [t, scope] of [
    [token, allScopes.join(" ")],
    [old, "projects:read projects:write"],
  ])
    await pool.query(
      "INSERT INTO project_oauth_tokens(token_hash,user_id,client_id,resource,scope,expires_at,refresh_expires_at) VALUES($1,$2,'qa-client','https://mcp-bookshell.charlydob.com/mcp',$3,now()+interval '1 hour','infinity')",
      [crypto.createHash("sha256").update(t).digest("hex"), a.userId, scope],
    );
  const app = createProjects({
    pool,
    ownerId: a.userId,
    jarvisEnabled: true,
    sendNotification: async () => ({ accepted: true }),
    nowFn: () => new Date(clock),
  });
  const server = http.createServer(
    (req, res) =>
      void app
        .handle(req, res, new URL(req.url, "http://localhost"))
        .catch((e) => {
          res.writeHead(500);
          res.end(e.message);
        }),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = new URL("http://127.0.0.1:" + server.address().port + "/mcp"),
    { Client } = require("@modelcontextprotocol/sdk/client/index.js"),
    {
      StreamableHTTPClientTransport,
    } = require("@modelcontextprotocol/sdk/client/streamableHttp.js");
  const clients = [];
  try {
    const client = new Client({ name: "jarvis-qa", version: "1" });
    clients.push(client);
    await client.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: "Bearer " + token } },
      }),
    );
    const list = await client.listTools();
    assert.equal(list.tools.length, 35);
    assert.ok(list.tools.find((t) => t.name === "update_task"));
    const created = await client.callTool({
      name: "habits_create",
      arguments: {
        habit: {
          name: "MCP Habit",
          goal: "count",
          schedule: { type: "daily", days: [] },
        },
        idempotencyKey: key(),
      },
    });
    assert.ok(!created.isError, JSON.stringify(created));
    const read = await client.callTool({
      name: "habits_list",
      arguments: { query: "MCP Habit" },
    });
    assert.equal(read.structuredContent.result.items.length, 1);
    const habitId = read.structuredContent.result.items[0].id;
    const recordArgs = {
      habitId,
      date: "2026-10-29",
      mode: "increment",
      value: 1,
      unit: "count",
      idempotencyKey: key(),
    };
    assert.ok(
      !(await client.callTool({ name: "habits_record", arguments: recordArgs }))
        .isError,
    );
    assert.ok(
      !(await client.callTool({ name: "habits_record", arguments: recordArgs }))
        .isError,
    );
    const persisted = await client.callTool({
      name: "habits_history",
      arguments: { habitId, from: "2026-10-29", to: "2026-10-29" },
    });
    assert.equal(persisted.structuredContent.result.total, 1);
    const legacy = new Client({ name: "legacy-qa", version: "1" });
    clients.push(legacy);
    await legacy.connect(
      new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { Authorization: "Bearer " + old } },
      }),
    );
    assert.equal(
      (await legacy.callTool({ name: "habits_list", arguments: {} })).isError,
      true,
    );
    assert.ok(
      !(await legacy.callTool({ name: "list_projects", arguments: {} }))
        .isError,
    );
  } finally {
    for (const c of clients) await c.close();
    await new Promise((r) => server.close(r));
  }
});

test("wall-clock union differs from summed activities", () => {
  assert.deepEqual(
    totals([
      [0, 3600000],
      [0, 3600000],
    ]),
    { elapsedSec: 3600, activitySec: 7200, exclusiveSec: 0, overlapSec: 3600 },
  );
});

test("habit and explicit reminder plan commit together and cannot bypass notification scope", async () => {
  const a = await fixture(),
    input = {
      habit: {
        name: "Atomic teeth",
        goal: "count",
        schedule: { type: "daily", days: [] },
        targetsByRange: { day: 3 },
      },
      reminderPlan: {
        enabled: true,
        times: ["08:00", "14:00", "21:00"],
        timezone: "Europe/Madrid",
        startDate: "2026-10-29",
      },
      idempotencyKey: key(),
    };
  await assert.rejects(
    call({ ...a, scopes: ["habits:write"] }, "habits_create", input),
    /INSUFFICIENT_SCOPE/,
  );
  assert.equal((await call(a, "habits_list")).items.length, 0);
  const created = await call(a, "habits_create", input);
  assert.deepEqual(created.habit.jarvisReminderPlan.times, [
    "08:00",
    "14:00",
    "21:00",
  ]);
  assert.equal((await call(a, "habits_create", input)).replayed, true);
});

test("minute set compares converted units, and browser edits keep server plans", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a, "time");
  await record(a, h.id, { unit: "minutes", value: 30 });
  const previous = await call(a, "habits_history", {
    habitId: h.id,
    from: "2026-10-29",
    to: "2026-10-29",
  });
  await record(a, h.id, {
    mode: "set",
    unit: "minutes",
    value: 45,
    expectedRevision: previous.days[0].revision,
  });
  assert.equal(
    (
      await call(a, "habits_history", {
        habitId: h.id,
        from: "2026-10-29",
        to: "2026-10-29",
      })
    ).total,
    2700,
  );
  const source = fs.readFileSync(
    path.join(__dirname, "../scripts/modules/habits/runtime.js"),
    "utf8",
  );
  const fn = source.slice(
    source.indexOf("function gatherHabitPayload()"),
    source.indexOf("function persistHabitLegacy"),
  );
  assert.match(fn, /\.\.\.existing/);
});

test("OAuth ordinary pairing cannot escalate scopes; default discovery and old grants stay compatible", async () => {
  const a = await fixture(),
    app = createProjects({
      pool,
      ownerId: a.userId,
      jarvisEnabled: true,
      sendNotification: async () => ({ accepted: true }),
    }),
    server = http.createServer(
      (req, res) =>
        void app.handle(req, res, new URL(req.url, "http://localhost")),
    );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;
  try {
    const metadata = await (
      await fetch(base + "/.well-known/oauth-authorization-server")
    ).json();
    assert.ok(metadata.scopes_supported.includes("habits:write"));
    const clientId = crypto.randomUUID(),
      redirect = "https://chatgpt.com/connector/oauth/test_jarvis2";
    await pool.query(
      "INSERT INTO project_oauth_clients(id,redirect_uris,auth_method) VALUES($1,$2,'none')",
      [clientId, JSON.stringify([redirect])],
    );
    for (const allowed of [
      ["projects:read", "projects:write"],
      ["habits:read", "habits:write"],
    ]) {
      const verifier = crypto.randomBytes(32).toString("base64url"),
        challenge = crypto
          .createHash("sha256")
          .update(verifier)
          .digest("base64url"),
        params = new URLSearchParams({
          client_id: clientId,
          redirect_uri: redirect,
          response_type: "code",
          code_challenge_method: "S256",
          code_challenge: challenge,
          resource: "https://mcp-bookshell.charlydob.com/mcp",
          scope: "habits:read habits:write",
          state: "state-test",
        });
      const page = await fetch(base + "/oauth/authorize?" + params),
        cookie = page.headers.get("set-cookie").split(";")[0],
        html = await page.text(),
        requestId = /name="request_id" value="([^"]+)"/.exec(html)[1],
        ticket = crypto.randomBytes(32).toString("base64url");
      await pool.query(
        "INSERT INTO project_access_tickets(token_hash,user_id,purpose,expires_at,allowed_scopes) VALUES($1,$2,'oauth',now()+interval '10 minutes',$3)",
        [
          crypto.createHash("sha256").update(ticket).digest("hex"),
          a.userId,
          allowed,
        ],
      );
      const consent = await fetch(base + "/oauth/authorize", {
        method: "POST",
        redirect: "manual",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          cookie,
        },
        body: new URLSearchParams({ request_id: requestId, pair_code: ticket }),
      });
      if (!allowed.includes("habits:write")) {
        assert.equal(consent.status, 403);
        continue;
      }
      assert.equal(consent.status, 302);
      const location = new URL(consent.headers.get("location"));
      assert.equal(location.searchParams.get("state"), "state-test");
      const token = await (
        await fetch(base + "/oauth/token", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId,
            redirect_uri: redirect,
            resource: "https://mcp-bookshell.charlydob.com/mcp",
            code: location.searchParams.get("code"),
            code_verifier: verifier,
          }),
        })
      ).json();
      assert.equal(token.scope, "habits:read habits:write");
      await pool.query("UPDATE users SET disabled=true WHERE id=$1", [
        a.userId,
      ]);
      const refresh = await fetch(base + "/oauth/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId,
          resource: "https://mcp-bookshell.charlydob.com/mcp",
          refresh_token: token.refresh_token,
        }),
      });
      assert.equal(refresh.status, 400);
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("retirement migration preserves pending reminders/history and requires explicit gates", async () => {
  const { plan, migrate } = require("../jarvis/telegram-retirement");
  await pool.query(
    "CREATE TABLE reminder_alerts(id uuid PRIMARY KEY,reminder_id uuid REFERENCES reminders(id),channel text,status text,locked_at timestamptz,updated_at timestamptz DEFAULT now())",
  );
  const a = await fixture(),
    r = crypto.randomUUID();
  await pool.query(
    "INSERT INTO reminders(id,firebase_uid,title,status) VALUES($1,'qa','Reminder','pending')",
    [r],
  );
  for (const status of ["pending", "sent", "cancelled"])
    await pool.query(
      "INSERT INTO reminder_alerts(id,reminder_id,channel,status) VALUES($1,$2,'telegram',$3)",
      [crypto.randomUUID(), r, status],
    );
  await pool.query(
    "INSERT INTO push_subscriptions(user_id,endpoint,p256dh,auth) VALUES($1,$2,'qa','qa')",
    [a.userId, "https://push.invalid/retire/" + a.userId],
  );
  await assert.rejects(migrate(pool), /Explicit authorization/);
  assert.equal((await plan(pool)).ready, false);
  await pool.query(
    "UPDATE firebase_import_raw SET firebase_uid='qa' WHERE user_id=$1",
    [a.userId],
  );
  const before = await plan(pool);
  assert.ok(before.ready);
  const result = await migrate(pool, {
    confirmed: true,
    workflowInactive: true,
    pushVerified: true,
  });
  assert.equal(result.changed, 1);
  assert.equal(
    (
      await pool.query(
        "SELECT count(*)::int AS n FROM reminder_alerts WHERE channel='telegram' AND status IN ('sent','cancelled')",
      )
    ).rows[0].n,
    2,
  );
  assert.equal(
    (
      await migrate(pool, {
        confirmed: true,
        workflowInactive: true,
        pushVerified: true,
      })
    ).changed,
    0,
  );
});

test("explicit legacy alert channels cannot consume each other's pending rows", async () => {
  const { __test } = require("../deploy-bookshell-api-server");
  await pool.query(
    `ALTER TABLE reminder_alerts ADD COLUMN mode text,ADD COLUMN minutes_before integer,ADD COLUMN notify_at timestamptz,ADD COLUMN created_at timestamptz DEFAULT now(),ADD COLUMN locked_by text,ADD COLUMN attempt_count integer DEFAULT 0,ADD COLUMN failed_at timestamptz,ADD COLUMN claimed_at timestamptz,ADD COLUMN delivery_lateness_ms bigint,ADD COLUMN error_message text;ALTER TABLE reminders ADD COLUMN description text,ADD COLUMN emoji text,ADD COLUMN source_type text,ADD COLUMN recurrence_type text,ADD COLUMN schedule_version integer`,
  );
  const source = fs.readFileSync(
      path.join(__dirname, "../deploy-bookshell-api-server.js"),
      "utf8",
    ),
    uid = /const LEGACY_FIREBASE_UID = "([^"]+)"/.exec(source)[1],
    reminder = crypto.randomUUID();
  await pool.query(
    "INSERT INTO reminders(id,firebase_uid,title,status,target_date,target_time,timezone,description,emoji,source_type,recurrence_type,schedule_version) VALUES($1,$2,'Channel QA','pending',CURRENT_DATE,'10:00','Europe/Zurich','','clock','manual','none',1)",
    [reminder, uid],
  );
  for (const channel of ["telegram", "webpush"])
    await pool.query(
      "INSERT INTO reminder_alerts(id,reminder_id,channel,status,mode,minutes_before,notify_at) VALUES($1,$2,$3,'pending','relative',0,now()-interval '1 minute')",
      [crypto.randomUUID(), reminder, channel],
    );
  const push = await __test.claimDueReminderAlerts(50, pool, "webpush");
  assert.equal(push.alerts.length, 1);
  const telegram = await __test.claimDueReminderAlerts(50, pool, "telegram");
  assert.equal(telegram.alerts.length, 1);
  assert.notEqual(push.alerts[0].alertId, telegram.alerts[0].alertId);
  const previous = process.env.BOOKSHELL_TELEGRAM_RETIRED;
  process.env.BOOKSHELL_TELEGRAM_RETIRED = "1";
  try {
    assert.ok(
      __test
        .normalizeReminderAlertSet([{ mode: "relative", minutesBefore: 15 }])
        .every((a) => a.channel === "webpush"),
    );
  } finally {
    if (previous === undefined) delete process.env.BOOKSHELL_TELEGRAM_RETIRED;
    else process.env.BOOKSHELL_TELEGRAM_RETIRED = previous;
  }
});

test("native web time reader understands persisted MCP time; timeline corrections are explicit", async () => {
  const a = await fixture(),
    { habit: h } = await habit(a, "time");
  await call(a, "activity_manual", {
    label: "Reading",
    habitId: h.id,
    timezone: "Europe/Madrid",
    intervals: [{ start: "2026-10-29T09:00:00Z", end: "2026-10-29T09:30:00Z" }],
    idempotencyKey: key(),
  });
  const data = (
    await pool.query("SELECT data FROM firebase_import_raw WHERE user_id=$1", [
      a.userId,
    ])
  ).rows[0].data;
  const source = fs.readFileSync(
      path.join(__dirname, "../scripts/modules/habits/runtime.js"),
      "utf8",
    ),
    start = source.indexOf("function getHabitTotalSecForDate("),
    end = source.indexOf("function addHabitTimeSec(", start),
    reader = source.slice(start, end);
  const value = require("node:vm").runInNewContext(
    reader + ";getHabitTotalSecForDate(habitId,date)",
    {
      habitSessions: data.habits.habitSessions,
      habitId: h.id,
      date: "2026-10-29",
    },
  );
  assert.equal(value, 1800);
  const hist = await call(a, "habits_history", {
    habitId: h.id,
    from: "2026-10-29",
    to: "2026-10-29",
  });
  await assert.rejects(
    record(a, h.id, {
      mode: "set",
      unit: "seconds",
      value: 0,
      expectedRevision: hist.days[0].revision,
      confirmed: true,
    }),
    /SESSION_CORRECTION_REQUIRED/,
  );
});
