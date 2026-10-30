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
const moduleScopes=[...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())];
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

test('YouTube correction preserves 18–20 Zurich, legacy credit, other sessions, and idempotency',async()=>{
 const a=await fixture();clock=new Date('2026-10-31T10:00:00Z');
 const source=(await habit(a,'time','YouTube')).habit,target=(await habit(a,'time','Ver YouTube')).habit;
 await call(a,'habits_record',{habitId:source.id,date:'2026-10-30',mode:'increment',unit:'seconds',value:600,idempotencyKey:key()});
 const intervals=[{start:'2026-10-30T18:00:00+01:00',end:'2026-10-30T20:00:00+01:00'}];
 const session=(await call(a,'activity_manual',{label:'Ver YouTube',habitId:source.id,timezone:'Europe/Zurich',intervals,idempotencyKey:key()})).session;
 const other=(await call(a,'activity_manual',{label:'Simultaneous',habitId:source.id,timezone:'Europe/Zurich',intervals:[{start:'2026-10-30T18:00:00+01:00',end:'2026-10-30T18:30:00+01:00'}],idempotencyKey:key()})).session;
 const input={sessionId:session.id,habitId:target.id,expectedRevision:session.revision,idempotencyKey:key()};
 const changed=await call(a,'activity_reassign',input);
 assert.equal(changed.session.habitId,target.id);assert.deepEqual(changed.session.intervals,session.intervals);
 assert.equal((await call(a,'activity_reassign',input)).replayed,true);
 const history=h=>call(a,'habits_history',{habitId:h.id,from:'2026-10-30',to:'2026-10-30'});
 assert.equal((await history(source)).total,2400);assert.equal((await history(target)).total,7200);
 const q={from:'2026-10-30T00:00:00+01:00',to:'2026-10-31T00:00:00+01:00',timezone:'Europe/Zurich'};
 let result=await call(a,'activity_query',q);assert.equal(result.totals.elapsedSec,7200);assert.equal(result.totals.activitySec,9000);
 assert.equal(result.sessions.find(s=>s.id===other.id).revision,other.revision);
 await assert.rejects(call({...a,scopes:['time:write']},'activity_update',{sessionId:session.id,expectedRevision:changed.session.revision,patch:{durationSec:3600},idempotencyKey:key()}),/INSUFFICIENT_SCOPE/);
 await assert.rejects(call(a,'activity_reassign',{...input,idempotencyKey:key()}),/REVISION_CONFLICT/);
 const short=(await call(a,'activity_update',{sessionId:session.id,expectedRevision:changed.session.revision,patch:{durationSec:3600},idempotencyKey:key()})).session;
 assert.equal((await history(target)).total,3600);
 const del=(await call(a,'activity_delete',{sessionId:session.id,expectedRevision:short.revision,confirmed:true,idempotencyKey:key()})).session;
 assert.equal((await history(target)).total,0);assert.equal((await call(a,'activity_query',q)).sessions.length,1);
 const restored=(await call(a,'activity_restore',{sessionId:session.id,expectedRevision:del.revision,idempotencyKey:key()})).session;
 assert.equal((await history(target)).total,3600);assert.equal(restored.corrections.length,4);
 await assert.rejects(call(a,'activity_restore',{sessionId:session.id,expectedRevision:restored.revision,idempotencyKey:key()}),/NOT_DELETED/);
 const parts=[{habitId:source.id,intervals:[{start:intervals[0].start,end:'2026-10-30T18:30:00+01:00'}]},{habitId:target.id,intervals:[{start:'2026-10-30T18:30:00+01:00',end:'2026-10-30T19:00:00+01:00'}]}];
 const split=await call(a,'activity_split',{sessionId:session.id,expectedRevision:restored.revision,idempotencyKey:key(),parts});
 assert.equal(split.sessions.length,2);assert.equal((await history(source)).total,4200);assert.equal((await history(target)).total,1800);
 assert.equal((await call(a,'activity_query',{...q,sessionId:other.id})).sessions.length,1);
 assert.equal((await call(a,'activity_query',{...q,from:'2025-10-30T00:00:00Z',to:'2025-10-31T00:00:00Z'})).sessions.length,0);
 const foreign=await fixture();await assert.rejects(call(foreign,'activity_reassign',{sessionId:other.id,habitId:target.id,expectedRevision:other.revision,idempotencyKey:key()}),/NOT_FOUND/);
});

test('failed split rolls back aggregate subtraction and original revision',async()=>{
 const a=await fixture(),h=(await habit(a,'time','Modelado')).habit;
 const s=(await call(a,'activity_manual',{label:'Modelado',habitId:h.id,timezone:'Europe/Zurich',intervals:[{start:'2026-10-28T18:00:00+01:00',end:'2026-10-28T20:00:00+01:00'}],idempotencyKey:key()})).session;
 await assert.rejects(call(a,'activity_split',{sessionId:s.id,expectedRevision:s.revision,idempotencyKey:key(),parts:[{habitId:h.id,intervals:[{start:'2026-10-28T18:00:00+01:00',end:'2026-10-28T19:00:00+01:00'}]},{habitId:h.id,intervals:[{start:'2026-10-28T18:30:00+01:00',end:'2026-10-28T20:00:00+01:00'}]}]}),/SPLIT_OVERLAP/);
 assert.equal((await call(a,'habits_history',{habitId:h.id,from:'2026-10-28',to:'2026-10-28'})).total,7200);
});

test('native recipes CRUD, scaling, duplicate prevention, revisions, recoverability and ownership',async()=>{
 const a=await fixture();a.scopes=[...a.scopes,...moduleScopes];
 const input={data:{title:'Pollo QA',servings:2,ingredients:[{name:'Pollo',qty:200,unit:'g'}],steps:[{description:'Cocinar'}],tags:['pollo']},idempotencyKey:key()};
 const created=await call(a,'recipes_create',input);assert.equal((await call(a,'recipes_create',input)).replayed,true);
 await assert.rejects(call(a,'recipes_create',{...input,idempotencyKey:key()}),/ALREADY_EXISTS/);
 const scaled=await call(a,'recipes_scale',{id:created.item.id,servings:4});assert.equal(scaled.item.data.ingredients[0].qty,400);
 const q=await call(a,'recipes_query',{query:'pollo'});assert.equal(q.items.length,1);assert.equal(q.items[0].data.servings,2);
 const changed=await call(a,'recipes_update',{id:created.item.id,expectedRevision:created.item.revision,patch:{title:'Pollo corregido'},idempotencyKey:key()});
 await assert.rejects(call(a,'recipes_update',{id:created.item.id,expectedRevision:created.item.revision,patch:{title:'Obsoleto'},idempotencyKey:key()}),/REVISION_CONFLICT/);
 await assert.rejects(call({...a,scopes:['recipes:read']},'recipes_delete',{id:changed.item.id,expectedRevision:changed.item.revision,confirmed:true,idempotencyKey:key()}),/INSUFFICIENT_SCOPE/);
 const deleted=await call(a,'recipes_delete',{id:changed.item.id,expectedRevision:changed.item.revision,confirmed:true,idempotencyKey:key()});assert.equal((await call(a,'recipes_query',{})).total,0);
 const other=await fixture();other.scopes=[...other.scopes,...moduleScopes];await assert.rejects(call(other,'recipes_restore',{deletionKey:deleted.deletionKey,idempotencyKey:key()}),/NOT_FOUND/);
 const restored=await call(a,'recipes_restore',{deletionKey:deleted.deletionKey,idempotencyKey:key()});assert.equal(restored.item.data.title,'Pollo corregido');
 await assert.rejects(call(a,'recipes_restore',{deletionKey:deleted.deletionKey,idempotencyKey:key()}),/TARGET_EXISTS/);
});

test('people use native note identities, notesEntries, birthdays and linkRefs without duplicate entities',async()=>{
 const a=await fixture();a.scopes=[...a.scopes,...moduleScopes];
 const p=await call(a,'people_create',{data:{firstName:'Laura',lastName:'QA',birthday:'1990-10-01'},idempotencyKey:key()});assert.equal(p.item.data.noteKind,'persona');assert.ok(p.warnings.length);
 await assert.rejects(call(a,'people_create',{data:{firstName:'LAURA',lastName:'QA'},idempotencyKey:key()}),/ALREADY_EXISTS/);
 const friend=await call(a,'people_create',{data:{firstName:'Amiga'},idempotencyKey:key()});
 const linked=await call(a,'people_link',{id:p.item.id,targetId:friend.item.id,label:'Amiga',expectedRevision:p.item.revision,idempotencyKey:key()});assert.equal(linked.item.data.linkRefs[0].targetId,friend.item.id);
 const noted=await call(a,'people_add_note',{id:p.item.id,text:'Le gusta el pollo',expectedRevision:linked.item.revision,idempotencyKey:key()});assert.equal(noted.item.data.person.notesEntries[0].text,'Le gusta el pollo');
 const changed=await call(a,'people_update',{id:p.item.id,patch:{phone:'+41 123'},expectedRevision:noted.item.revision,idempotencyKey:key()});assert.equal(changed.item.data.person.birthday,'1990-10-01');assert.equal(changed.item.data.person.notesEntries.length,1);
 const all=await call(a,'people_query',{query:'pollo'});assert.equal(all.items[0].id,p.item.id);
 const native=(await pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[a.userId])).rows[0].data;assert.equal(Object.keys(native.notes.notes).length,2);assert.equal(native.people,undefined);
});

test('notes preserve titles/folders and native writes, folder cycles rejected, delete/restore works',async()=>{
 const a=await fixture();a.scopes=[...a.scopes,...moduleScopes];
 const folder=await call(a,'folders_create',{data:{name:'Carpeta QA'},idempotencyKey:key()});
 const note=await call(a,'notes_create',{data:{title:'Título QA',content:'Contenido',folderId:folder.item.id},idempotencyKey:key()});
 const changed=await call(a,'notes_update',{id:note.item.id,expectedRevision:note.item.revision,patch:{title:'Título corregido',folderId:''},idempotencyKey:key()});
 assert.equal(changed.item.data.name,'Título corregido');assert.equal(changed.item.data.content,'Contenido');
 await assert.rejects(call(a,'folders_update',{id:folder.item.id,expectedRevision:folder.item.revision,patch:{parentId:folder.item.id},idempotencyKey:key()}),/FOLDER_CYCLE/);
 const deleted=await call(a,'notes_delete',{id:note.item.id,expectedRevision:changed.item.revision,confirmed:true,idempotencyKey:key()});assert.equal((await call(a,'notes_query',{})).total,0);
 assert.equal((await call(a,'notes_restore',{deletionKey:deleted.deletionKey,idempotencyKey:key()})).item.data.title,'Título corregido');
});

test('books progress and daily reading log update atomically; query-only modules expose stored values',async()=>{
 const a=await fixture();a.scopes=[...a.scopes,...moduleScopes];
 const book=await call(a,'books_create',{data:{title:'Libro QA',pages:100},idempotencyKey:key()});assert.equal(book.item.data.status,'planned');
 const progress=await call(a,'books_progress',{id:book.item.id,expectedRevision:book.item.revision,currentPage:100,date:'2026-10-29',timezone:'Europe/Zurich',idempotencyKey:key()});assert.equal(progress.item.data.status,'finished');
 const corrected=await call(a,'books_progress',{id:book.item.id,expectedRevision:progress.item.revision,currentPage:90,date:'2026-10-29',timezone:'Europe/Zurich',idempotencyKey:key()});assert.equal(corrected.item.data.status,'reading');
 const native=(await pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[a.userId])).rows[0].data;assert.equal(native.books.readingLog['2026-10-29'][book.item.id],90);
 for(const module of ['nutrition','gym','finance','world'])assert.equal((await call(a,module+'_query',{})).total,0);
 const caps=await call(a,'jarvis_capabilities',{});assert.ok(caps.operations.some(x=>x.name==='recipes_create'&&x.authorized));assert.ok(caps.limitations.some(x=>x.includes('queries only')));
 await assert.rejects(call({...a,scopes:['projects:read']},'finance_query',{}),/INSUFFICIENT_SCOPE/);
});

test('read adapters preserve nutrition unknowns and native currencies and deduplicate legacy finance ids',async()=>{
 const a=await fixture();a.scopes=[...a.scopes,...moduleScopes];
 await pool.query("UPDATE firebase_import_raw SET data=data || $1::jsonb WHERE user_id=$2",[JSON.stringify({recipes:{nutrition:{macroTargets:{protein:120},dailyLogsByDate:{'2026-10-28':{meals:{breakfast:{entries:[{macrosSnapshot:{protein:12,kcal:140}},{nameSnapshot:'Sin macros'}]}}}}}},finance:{finance:{transactions:{one:{amount:12,currency:'CHF',date:'2026-10-28'}},tx:{one:{amount:100,currency:'EUR'}},catalog:{categories:{food:{name:'Comida'}}}}},gym:{gym:{workouts:{'2026-10-28':{workout:{name:'Entreno',exercises:{}}}}}}}),a.userId]);
 const nutrition=await call(a,'nutrition_query',{collection:'dailyLogsByDate',from:'2026-10-28',to:'2026-10-28'});assert.equal(nutrition.summary.knownMacros.protein,12);assert.equal(nutrition.summary.complete,false);
 assert.equal((await call(a,'nutrition_query',{collection:'macroTargets'})).summary.protein,120);
 const finance=await call(a,'finance_query',{collection:'transactions'});assert.equal(finance.items.length,1);assert.equal(finance.items[0].data.currency,'CHF');assert.equal(finance.items[0].data.amount,12);
 assert.equal((await call(a,'finance_query',{collection:'categories'})).items[0].data.name,'Comida');
 assert.equal((await call(a,'gym_query',{collection:'workouts'})).items[0].data.date,'2026-10-28');
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
    assert.equal(list.tools.length, 23 + Object.keys(require('../jarvis/contracts').schemas).length);
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
