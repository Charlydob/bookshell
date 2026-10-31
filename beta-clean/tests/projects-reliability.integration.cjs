'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let f,mcp;const key=()=>crypto.randomUUID();
async function call(name,args,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function reject(name,args,pattern,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(r.isError);assert.match(JSON.stringify(r),pattern);}
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();mcp=(await f.mcp()).client;});
test.after(async()=>{await f?.close();});
test('concurrent legacy creates replay exactly once; payload conflicts, stale changes and foreign ownership cannot overwrite',async()=>{
 const p=await call('create_project',{project:{title:'Reliability QA'},idempotencyKey:key()});
 for(const [name,data] of [['task',{title:'Components'}],['purchase',{title:'Jacks'}],['reminder',{title:'Call Laura',dueAt:'2026-11-03T10:00:00Z'}]]){
  const input={projectId:p.id,data,idempotencyKey:key()};
  const results=await Promise.all([call('create_'+name,input),call('create_'+name,input)]);
  assert.equal(results[0].id,results[1].id);
  assert.equal((await f.pool.query('SELECT count(*)::int AS n FROM project_entries WHERE project_id=$1 AND kind=$2',[p.id,name])).rows[0].n,1);
  await reject('create_'+name,{...input,data:{...data,title:'Changed intent'}},/IDEMPOTENCY_CONFLICT/);
  const old=results[0],update={projectId:p.id,entryId:old.id,version:old.version,patch:{title:'Updated '+name},idempotencyKey:key()};
  const changed=await call('update_'+name,update);assert.equal((await call('update_'+name,update)).replayed,true);
  assert.equal((await f.pool.query('SELECT version FROM project_entries WHERE id=$1',[old.id])).rows[0].version,changed.version);
  await reject('update_'+name,{...update,idempotencyKey:key()},/cambiado/);
 }
 const other=(await f.mcp(f.scopes,f.other)).client;
 await reject('create_task',{projectId:p.id,data:{title:'Intrusion'},idempotencyKey:key()},/no encontrado/,other);
});
test('ledger failure rolls back entry, reminders and history together; same intent can recover',async()=>{
 const p=await call('create_project',{project:{title:'Atomic QA'},idempotencyKey:key()}),intent=key();
 await f.pool.query("CREATE FUNCTION fail_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected ledger failure'; END $$;CREATE TRIGGER fail_ledger BEFORE INSERT ON jarvis_operations FOR EACH ROW EXECUTE FUNCTION fail_ledger()");
 const input={projectId:p.id,data:{title:'Atomic task',dueAt:'2026-11-04T10:00:00Z',reminders:[{offsetMinutes:30}]},idempotencyKey:intent};
 await reject('create_task',input,/INTERNAL_ERROR/);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM project_entries WHERE project_id=$1',[p.id])).rows[0].n,0);
 assert.equal((await f.pool.query("SELECT count(*)::int n FROM project_activity WHERE project_id=$1 AND action='task.created'",[p.id])).rows[0].n,0);
 await f.pool.query('DROP TRIGGER fail_ledger ON jarvis_operations;DROP FUNCTION fail_ledger()');
 await call('create_task',input);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM project_entries WHERE project_id=$1',[p.id])).rows[0].n,2);
});
test('reschedule CAS, civil days and idempotent retries prevent repeated shifts across DST',async()=>{
 const p=await call('create_project',{project:{title:'DST shift QA'},idempotencyKey:key()});
 const t=await call('create_task',{projectId:p.id,data:{title:'DST task',dueAt:'2026-10-24T10:00:12.345+02:00'},idempotencyKey:key()});
 const input={projectId:p.id,taskId:t.id,days:1,expectedRevision:t.version,dayMode:'civil',timezone:'Europe/Zurich',idempotencyKey:key()};
 const result=await call('reschedule_dependencies',input);assert.equal(result.updated[0].dueAt,'2026-10-25T09:00:12.345Z');
 assert.equal((await call('reschedule_dependencies',input)).replayed,true);
 await reject('reschedule_dependencies',{...input,idempotencyKey:key()},/REVISION_CONFLICT/);
 assert.equal((await f.pool.query('SELECT data FROM project_entries WHERE id=$1',[t.id])).rows[0].data.dueAt,'2026-10-25T09:00:12.345Z');
});
test('MCP history and pending counts preserve late duties and suppress linked reminders without writes or notifications',async()=>{
 const p=await call('create_project',{project:{title:'Attention QA'},idempotencyKey:key()});
 const task=await call('create_task',{projectId:p.id,data:{title:'Components still not bought',dueAt:'2020-09-01T10:00:00Z'},idempotencyKey:key()});
 await call('create_reminder',{projectId:p.id,data:{title:'Duplicate task reminder',taskId:task.id,dueAt:'2020-09-01T10:00:00Z'},idempotencyKey:key()});
 const event=await call('create_reminder',{projectId:p.id,data:{title:'Past shift',obligationKind:'event',dueAt:'2020-09-02T10:00:00Z'},idempotencyKey:key()});
 const before=await f.pool.query('SELECT id,data,version FROM project_entries WHERE project_id=$1 ORDER BY id',[p.id]);
 const pending=await call('get_reminder_overview',{view:'pending'}),history=await call('get_reminder_overview',{view:'history'});
 assert.ok(pending.items.some(e=>e.id===task.id&&e.attention.overdue));assert.ok(!pending.items.some(e=>e.id===event.id));
 assert.ok(history.items.some(e=>e.id===event.id));assert.ok(pending.counts.duplicates>=1);
 assert.deepEqual((await f.pool.query('SELECT id,data,version FROM project_entries WHERE project_id=$1 ORDER BY id',[p.id])).rows,before.rows);
 assert.equal((await f.pool.query('SELECT count(*)::int n FROM notification_runs')).rows[0].n,0);
});
