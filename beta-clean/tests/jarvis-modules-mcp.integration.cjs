'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let f,mcp;
const key=()=>crypto.randomUUID();
async function call(name,args,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function reject(name,args,pattern,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(r.isError);assert.match(JSON.stringify(r),pattern);}
async function data(){return (await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;}
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();mcp=(await f.mcp([...f.scopes,...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())])).client;});
test.after(async()=>{await f?.close();});
test('every advertised operation is discoverable; every native collection can be queried over MCP',async()=>{
 const caps=await call('jarvis_capabilities',{}),catalog=(await mcp.listTools()).tools;
 assert.deepEqual(caps.operations.map(x=>x.name).sort(),catalog.map(x=>x.name).sort());
 for(const [module,collections] of Object.entries(require('../jarvis/module-contracts').collections))for(const collection of collections){
  const r=await call(module+'_query',{collection,limit:1});assert.ok(Array.isArray(r.items));assert.ok(Number.isInteger(r.total));
 }
});
test('recipes full lifecycle and person native relations persist through the actual MCP SDK',async()=>{
 const recipe={title:'MCP isolated recipe',ingredients:[{name:'Rice',qty:100,unit:'g'}],steps:[],servings:2};
 const create={data:recipe,idempotencyKey:key()};let r=(await call('recipes_create',create)).item;
 assert.equal((await call('recipes_create',create)).item.id,r.id);
 assert.deepEqual((await data()).recipes.items[r.id],r.data);
 await reject('recipes_create',{data:recipe,idempotencyKey:key()},/ENTITY_ALREADY_EXISTS/);
 const scaled=(await call('recipes_scale',{id:r.id,servings:4})).item;
 assert.equal(scaled.data.ingredients[0].qty,200);assert.equal((await data()).recipes.items[r.id].ingredients[0].qty,100);
 r=(await call('recipes_update',{id:r.id,expectedRevision:r.revision,patch:{ingredients:[...r.data.ingredients.map(({text,label,done,...i})=>i),{name:'Salt',qty:1,unit:'g'}]},idempotencyKey:key()})).item;
 assert.equal((await data()).recipes.items[r.id].ingredients.length,2);
 const before=await data();
 await reject('recipes_update',{id:r.id,expectedRevision:r.revision,patch:{ingredients:[{name:'Missing',qty:1,unit:'g',productId:'missing'}]},idempotencyKey:key()},/FOOD_PRODUCT_NOT_FOUND/);
 assert.deepEqual(await data(),before);
 const other=(await f.mcp(['recipes:read','recipes:write'],f.other)).client;
 assert.equal((await call('recipes_query',{id:r.id},other)).total,0);
 await reject('recipes_update',{id:r.id,expectedRevision:r.revision,patch:{title:'Intrusion'},idempotencyKey:key()},/ENTITY_NOT_FOUND/,other);
 const del=await call('recipes_delete',{id:r.id,expectedRevision:r.revision,confirmed:true,idempotencyKey:key()});
 assert.equal((await data()).recipes.items[r.id],undefined);
 r=(await call('recipes_restore',{deletionKey:del.deletionKey,idempotencyKey:key()})).item;assert.deepEqual((await data()).recipes.items[r.id],r.data);
 let p=(await call('people_create',{data:{firstName:'MCP Alice',birthday:'1990-10-31'},idempotencyKey:key()})).item;
 const friend=(await call('people_create',{data:{firstName:'MCP Bob'},idempotencyKey:key()})).item;
 p=(await call('people_link',{id:p.id,targetId:friend.id,label:'Friend',expectedRevision:p.revision,idempotencyKey:key()})).item;
 p=(await call('people_add_note',{id:p.id,text:'Synthetic QA note',expectedRevision:p.revision,idempotencyKey:key()})).item;
 const old=p.revision;
 p=(await call('people_update',{id:p.id,expectedRevision:p.revision,patch:{phone:'+410000000'},idempotencyKey:key()})).item;
 await reject('people_update',{id:p.id,expectedRevision:old,patch:{lastName:'Stale'},idempotencyKey:key()},/REVISION_CONFLICT/);
 assert.deepEqual((await data()).notes.notes[p.id],p.data);assert.equal((await data()).people,undefined);
 assert.equal((await call('people_query',{query:'Synthetic QA note'})).items[0].id,p.id);
 p=(await call('people_link',{id:p.id,targetId:friend.id,label:'Friend',remove:true,expectedRevision:p.revision,idempotencyKey:key()})).item;
 assert.equal((await data()).notes.notes[p.id].linkRefs.length,0);
});
test('tasks retain explicit historical completion, reopen and reschedule without duplicating task reminders',async()=>{
 const p=await call('create_project',{project:{title:'Historical project QA'}});
 let t=await call('create_task',{projectId:p.id,data:{title:'Call person QA',dueAt:'2026-11-03T10:00:00+01:00',reminders:[{offsetMinutes:30}]}});
 const date=new Date(Date.now()-86400000).toISOString();
 t=await call('update_task',{projectId:p.id,entryId:t.id,version:t.version,patch:{status:'done',completedAt:date}});
 assert.equal(t.completedAt,date);
 assert.equal((await f.pool.query('SELECT data FROM project_entries WHERE id=$1',[t.id])).rows[0].data.completedAt,date);
 t=await call('update_task',{projectId:p.id,entryId:t.id,version:t.version,patch:{status:'todo'}});
 assert.equal(t.completedAt,null);
 t=await call('update_task',{projectId:p.id,entryId:t.id,version:t.version,patch:{dueAt:'2026-11-06T10:00:00+01:00'}});
 const rows=await f.pool.query("SELECT * FROM project_entries WHERE task_id=$1 AND kind='reminder' AND deleted_at IS NULL",[t.id]);
 assert.equal(rows.rowCount,1);assert.equal(rows.rows[0].data.dueAt,'2026-11-06T08:30:00.000Z');
 await reject('update_task',{projectId:p.id,entryId:t.id,version:t.version,patch:{status:'done',completedAt:new Date(Date.now()+86400000).toISOString()}},/futura/);
 assert.equal((await f.pool.query('SELECT data FROM project_entries WHERE id=$1',[t.id])).rows[0].data.status,'todo');
});
