"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict"),
  crypto = require("node:crypto");
const { revision } = require("../jarvis/domain");
let f, cookie, mcp;
test.before(async () => {
  f = await require("./qa-phase2-fixture.cjs").createFixture();
  cookie = await f.login();
  mcp = (await f.mcp()).client;
});
test.after(async () => {
  await f?.close();
});
async function web(
  path,
  body,
  {
    auth = true,
    origin = "https://bookshell.charlydob.com",
    method = body === undefined ? "GET" : "POST",
  } = {},
) {
  const r = await fetch(f.base + path, {
    method,
    headers: {
      ...(auth ? { Cookie: cookie } : {}),
      Origin: origin,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: r.status, headers: r.headers, body: await r.json() };
}
async function tool(name, args) {
  const r = await mcp.callTool({ name, arguments: args });
  assert.ok(!r.isError, JSON.stringify(r));
  return r.structuredContent.result;
}
const key = () => crypto.randomUUID();

test('authenticated native pairing can grant current module scopes; anonymous callers cannot',async()=>{
 const issued=await web('/projects/access-code',{});assert.equal(issued.status,201);
 const hash=require('node:crypto').createHash('sha256').update(issued.body.ticket).digest('hex');
 const grant=(await f.pool.query('SELECT user_id,allowed_scopes FROM project_access_tickets WHERE token_hash=$1',[hash])).rows[0];
 assert.equal(grant.user_id,f.owner);assert.ok(grant.allowed_scopes.includes('recipes:write'));assert.ok(grant.allowed_scopes.includes('finance:read'));
 assert.equal((await web('/projects/access-code',{}, {auth:false})).status,401);
});
test("real web boundary: data/export/projects/pairing settings reject anonymous and forged origin; health/MCP discovery remain available", async () => {
  for (const p of [
    "/data/habits",
    "/export",
    "/projects",
    "/projects/access",
    "/push/status",
  ])
    assert.equal((await web(p, undefined, { auth: false })).status, 401, p);
  assert.equal(
    (await web("/projects/access-code", {}, { auth: false })).status,
    401,
  );
  assert.equal(
    (
      await web(
        "/web/jarvis/habits_list",
        {},
        { origin: "https://evil.invalid" },
      )
    ).status,
    403,
  );
  assert.equal((await web("/health", undefined, { auth: false })).status, 200);
  assert.equal(
    (
      await web("/.well-known/oauth-protected-resource", undefined, {
        auth: false,
      })
    ).status,
    200,
  );
  assert.equal((await web("/data/habits", {}, { method: "PUT" })).status, 428);
});
test("device codes are single-use, password login verifies credentials, secure cookies and revoked sessions", async () => {
  const code = await f.app.__test.webSecurity.issueDeviceCode(f.owner);
  const paired = await web("/auth/device", { code }, { auth: false });
  assert.equal(paired.status, 200);
  assert.match(paired.headers.get("set-cookie"), /HttpOnly/);
  assert.match(paired.headers.get("set-cookie"), /Secure/);
  assert.match(paired.headers.get("set-cookie"), /SameSite=Lax/);
  assert.equal(
    (await web("/auth/device", { code }, { auth: false })).status,
    401,
  );
  assert.equal(
    (
      await web(
        "/auth/login",
        { email: "qa@example.invalid", password: "wrong" },
        { auth: false },
      )
    ).status,
    401,
  );
  assert.equal(
    (
      await web(
        "/auth/login",
        { email: "qa@example.invalid", password: f.password },
        { auth: false },
      )
    ).status,
    200,
  );
  const previous = cookie;
  cookie = paired.headers.get("set-cookie").split(";")[0];
  assert.equal((await web("/auth/logout", {})).status, 200);
  assert.equal((await web("/data/habits")).status, 401);
  cookie = previous;
});
let h;
test("A+B+D: MCP creates 30-minute reading with 21:00 reminder; web reads/records 40 minutes; retry is idempotent; change to 22:00 invalidates old notices", async () => {
  const today = new Date().toISOString().slice(0, 10);
  h = (
    await tool("habits_create", {
      habit: {
        name: "Reading QA",
        goal: "time",
        schedule: { type: "daily", days: [] },
        targetsByRange: { day: 30 },
      },
      reminderPlan: {
        enabled: true,
        times: ["21:00"],
        timezone: "Europe/Madrid",
        startDate: today,
      },
      idempotencyKey: key(),
    })
  ).habit;
  const raw = await web("/data/habits/habits/" + h.id);
  assert.equal(raw.body.data.goalsByRange.day, 30);
  const input = {
    habitId: h.id,
    date: today,
    mode: "increment",
    value: 40,
    unit: "minutes",
    idempotencyKey: key(),
  };
  assert.equal((await web("/web/jarvis/habits_record", input)).status, 200);
  assert.equal(
    (await web("/web/jarvis/habits_record", input)).body.replayed,
    true,
  );
  assert.equal(
    (await tool("habits_history", { habitId: h.id, from: today, to: today }))
      .total,
    2400,
  );
  await f.pool.query(
    "INSERT INTO notification_runs(user_id,kind,schedule_key,scheduled_at,deadline_at,payload) VALUES($1,'habit-reminder',$2,now(),now()+interval '15 minutes',$3)",
    [f.owner, key(), JSON.stringify({ habitId: h.id })],
  );
  h = (
    await tool("habits_reminders", {
      habitId: h.id,
      expectedRevision: h.revision,
      plan: {
        enabled: true,
        times: ["22:00"],
        timezone: "Europe/Madrid",
        startDate: today,
      },
      idempotencyKey: key(),
    })
  ).habit;
  assert.equal(
    (
      await f.pool.query(
        "SELECT count(*)::int AS n FROM notification_runs WHERE user_id=$1 AND kind='habit-reminder' AND status='pending'",
        [f.owner],
      )
    ).rows[0].n,
    0,
  );
});
test("F: web commits before stale MCP update; reverse ordering and web retry never silently overwrite", async () => {
  let raw = (await web("/data/habits/habits/" + h.id)).body.data;
  const old = h.revision,
    input = {
      method: "PUT",
      path: "habits/habits/" + h.id,
      body: { ...raw, name: "Reading web" },
      expected: { ["habits/habits/" + h.id]: revision(raw) },
      idempotencyKey: key(),
    };
  assert.equal((await web("/web/data", input)).status, 200);
  assert.equal((await web("/web/data", input)).body.replayed, true);
  assert.equal(
    (
      await mcp.callTool({
        name: "habits_update",
        arguments: {
          habitId: h.id,
          expectedRevision: old,
          patch: { name: "Stale MCP" },
          idempotencyKey: key(),
        },
      })
    ).isError,
    true,
  );
  h = (await tool("habits_list", { query: "Reading web" })).items[0];
  await tool("habits_update", {
    habitId: h.id,
    expectedRevision: h.revision,
    patch: { name: "Reading MCP" },
    idempotencyKey: key(),
  });
  assert.equal(
    (
      await web("/web/data", {
        ...input,
        idempotencyKey: key(),
        body: { ...raw, name: "Stale web" },
      })
    ).status,
    409,
  );
  assert.equal(
    (await web("/data/habits/habits/" + h.id)).body.data.name,
    "Reading MCP",
  );
});
test("C: activities are controlled through web and MCP, projects owned, overlap and exclusive time are correct", async () => {
  const p = await tool("create_project", { project: { title: "PetBowl QA" } }),
    now = Date.now(),
    stamp = (n) => new Date(now + n * 1000).toISOString();
  await tool("activity_manual", {
    label: "Design QA",
    projectId: p.id,
    timezone: "Europe/Madrid",
    intervals: [{ start: stamp(-3600), end: stamp(-1) }],
    idempotencyKey: key(),
  });
  assert.equal(
    (
      await web("/web/jarvis/activity_manual", {
        label: "Twitch QA",
        timezone: "Europe/Madrid",
        intervals: [{ start: stamp(-2700), end: stamp(-900) }],
        idempotencyKey: key(),
      })
    ).status,
    200,
  );
  const q = await tool("activity_query", {
    from: stamp(-4000),
    to: stamp(1),
    timezone: "Europe/Madrid",
  });
  assert.equal(q.totals.elapsedSec, 3599);
  assert.equal(q.totals.overlapSec, 1800);
  assert.equal(q.sessions.find((s) => s.label === "Design QA").projectId, p.id);
  let s = (
    await tool("activity_start", {
      label: "Live QA",
      timezone: "Europe/Madrid",
      idempotencyKey: key(),
    })
  ).session;
  let changed = await web("/web/jarvis/activity_change", {
    sessionId: s.id,
    expectedRevision: s.revision,
    action: "pause",
    idempotencyKey: key(),
  });
  assert.equal(changed.status, 200);
  s = (
    await tool("activity_change", {
      sessionId: s.id,
      expectedRevision: changed.body.session.revision,
      action: "resume",
      idempotencyKey: key(),
    })
  ).session;
  assert.equal(
    (
      await web("/web/jarvis/activity_change", {
        sessionId: s.id,
        expectedRevision: s.revision,
        action: "stop",
        idempotencyKey: key(),
      })
    ).status,
    200,
  );
});
test("E: project-only/read-only tokens cannot write habits; separate identities and revoked/expired tokens reject access", async () => {
  for (const grants of [["projects:read", "projects:write"], ["habits:read"]]) {
    const { client } = await f.mcp(grants);
    assert.equal(
      (
        await client.callTool({
          name: "habits_create",
          arguments: {
            habit: {
              name: "Denied",
              goal: "check",
              schedule: { type: "daily", days: [] },
            },
            idempotencyKey: key(),
          },
        })
      ).isError,
      true,
    );
  }
  const { client } = await f.mcp(f.scopes, f.other);
  assert.equal(
    (
      await client.callTool({
        name: "habits_history",
        arguments: { habitId: h.id, from: "2026-10-29", to: "2026-10-29" },
      })
    ).isError,
    true,
  );
  const t = await f.token();
  await f.pool.query(
    "UPDATE project_oauth_tokens SET revoked_at=now() WHERE token_hash=$1",
    [crypto.createHash("sha256").update(t).digest("hex")],
  );
  const r = await fetch(f.base + "/mcp", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + t,
      "Content-Type": "application/json",
    },
    body: "{}",
  });
  assert.equal(r.status, 401);
  assert.equal((await mcp.listTools()).tools.length, 23 + Object.keys(require('../jarvis/contracts').schemas).length);
});
test("web CAS rejects missing bases, overlapping patches, prototype paths and cross-system session manipulation", async () => {
  assert.equal(
    (
      await web("/web/data", {
        method: "PUT",
        path: "habits/habitCounts/new/date",
        body: 1,
        expected: {},
        idempotencyKey: key(),
      })
    ).status,
    428,
  );
  assert.equal(
    (
      await web("/web/data", {
        method: "PUT",
        path: "__proto__/x",
        body: 1,
        expected: {},
        idempotencyKey: key(),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await web("/web/data", {
        method: "PUT",
        path: "habits/activitySessions",
        body: {},
        expected: { "habits/activitySessions": revision(null) },
        idempotencyKey: key(),
      })
    ).status,
    409,
  );
});
test("delivery receipts use their narrowly scoped capability, including after the web session expires", async () => {
  const subscription = crypto.randomUUID(),
    run = crypto.randomUUID(),
    receipt = crypto.randomBytes(32).toString("base64url");
  await f.pool.query(
    "INSERT INTO push_subscriptions(id,user_id,endpoint,p256dh,auth) VALUES($1,$2,$3,'qa','qa')",
    [subscription, f.owner, "https://push.invalid/" + subscription],
  );
  await f.pool.query(
    "INSERT INTO notification_runs(id,user_id,kind,schedule_key,scheduled_at,deadline_at) VALUES($1,$2,'test',$3,now(),now()+interval '15 minutes')",
    [run, f.owner, key()],
  );
  await f.pool.query(
    "INSERT INTO notification_device_deliveries(run_id,subscription_id,receipt_hash) VALUES($1,$2,$3)",
    [
      run,
      subscription,
      crypto.createHash("sha256").update(receipt).digest("hex"),
    ],
  );
  assert.equal(
    (
      await web(
        "/projects/notifications/receipts",
        {
          notificationId: run,
          subscriptionId: subscription,
          receiptToken: "not-the-proof",
          event: "opened",
        },
        { auth: false },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await web(
        "/projects/notifications/receipts",
        {
          notificationId: run,
          subscriptionId: subscription,
          receiptToken: receipt,
          event: "opened",
        },
        { auth: false },
      )
    ).status,
    200,
  );
});
test("expired device codes and OAuth tokens are rejected without extending permissions", async () => {
  const code = await f.app.__test.webSecurity.issueDeviceCode(f.owner);
  await f.pool.query(
    "UPDATE project_access_tickets SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [crypto.createHash("sha256").update(code).digest("hex")],
  );
  assert.equal(
    (await web("/auth/device", { code }, { auth: false })).status,
    401,
  );
  const t = await f.token();
  await f.pool.query(
    "UPDATE project_oauth_tokens SET expires_at=now()-interval '1 second' WHERE token_hash=$1",
    [crypto.createHash("sha256").update(t).digest("hex")],
  );
  assert.equal(
    (
      await fetch(f.base + "/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + t,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    401,
  );
});

test('native web invariants: active sessions block archive; completing a check cancels pending reminders',async()=>{
 const habit=(await tool('habits_create',{habit:{name:'Web invariants QA',goal:'time',schedule:{type:'daily',days:[]}},idempotencyKey:key()})).habit;
 const session=(await tool('activity_start',{label:'Archive guard',habitId:habit.id,timezone:'Europe/Madrid',idempotencyKey:key()})).session;
 const path='habits/habits/'+habit.id,raw=(await web('/data/'+path)).body.data;
 assert.equal((await web('/web/data',{method:'PUT',path,body:{...raw,archived:true},expected:{[path]:revision(raw)},idempotencyKey:key()})).status,409);
 await tool('activity_change',{sessionId:session.id,expectedRevision:session.revision,action:'stop',idempotencyKey:key()});
 const dateKey=new Date().toISOString().slice(0,10),timePath='habits/habitSessions/'+habit.id+'/'+dateKey;
 const day=(await web('/data/'+timePath)).body.data;
 if(day?.sessions?.length){
  const increased={...day,totalSec:day.totalSec+60};
  assert.equal((await web('/web/data',{method:'PUT',path:timePath,body:increased,expected:{[timePath]:revision(day)},idempotencyKey:key()})).status,200);
  assert.equal((await web('/web/data',{method:'PUT',path:timePath,body:{...increased,sessions:[]},expected:{[timePath]:revision(increased)},idempotencyKey:key()})).status,409);
 }
 const check=(await tool('habits_create',{habit:{name:'Check reminder QA',goal:'check',schedule:{type:'daily',days:[]}},idempotencyKey:key()})).habit,date='2026-10-29',schedule=key();
 await f.pool.query("INSERT INTO notification_runs(user_id,kind,schedule_key,scheduled_at,deadline_at,payload) VALUES($1,'habit-reminder',$2,now(),now()+interval '15 minutes',$3)",[f.owner,schedule,JSON.stringify({habitId:check.id,date})]);
 const daily='habits/habitChecks/'+check.id+'/'+date;
 assert.equal((await web('/web/data',{method:'PUT',path:daily,body:true,expected:{[daily]:revision(null)},idempotencyKey:key()})).status,200);
 assert.equal((await f.pool.query('SELECT status FROM notification_runs WHERE schedule_key=$1',[schedule])).rows[0].status,'cancelled');
});

test('Published MCP metadata and permission challenges support ChatGPT reauthorization',async()=>{
 const {client}=await f.mcp(['projects:read','projects:write']);
 const catalog=await client.listTools();assert.equal(catalog.tools.length,23 + Object.keys(require('../jarvis/contracts').schemas).length);
 assert.deepEqual(catalog.tools.find(t=>t.name==='habits_create')._meta.securitySchemes,[{type:'oauth2',scopes:['habits:write']}]);
 const denied=await client.callTool({name:'habits_create',arguments:{habit:{name:'Denied without grant',goal:'check',schedule:{type:'daily',days:[]}},idempotencyKey:key()}});
 assert.equal(denied.isError,true);const challenge=denied._meta['mcp/www_authenticate'][0];assert.match(challenge,/error="insufficient_scope"/);assert.match(challenge,/error_description=/);assert.match(challenge,/habits:write/);
 const partial=(await f.mcp(['habits:write'])).client;
 const reminder=await partial.callTool({name:'habits_create',arguments:{habit:{name:'Denied reminder grant',goal:'check',schedule:{type:'daily',days:[]}},reminderPlan:{enabled:true,times:['21:00'],timezone:'Europe/Madrid',startDate:'2026-10-30'},idempotencyKey:key()}});
 assert.equal(reminder.isError,true);assert.match(reminder._meta['mcp/www_authenticate'][0],/notifications:write/);
});
