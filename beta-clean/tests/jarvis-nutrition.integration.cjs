'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');let f,mcp;
const key=()=>crypto.randomUUID();
async function call(name,args,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function reject(name,args,pattern,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(r.isError,JSON.stringify(r));assert.match(JSON.stringify(r),pattern);}
async function stored(){return (await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;}
async function reset(){const d=await stored();d.recipes={items:{chicken:{id:'chicken',title:'QA Chicken Rice',servings:2,ingredients:[{productId:'rice',name:'Rice',qty:100,unit:'g'},{productId:'chicken',name:'Chicken',qty:200,unit:'g'}]}},nutrition:{products:[{id:'rice',name:'QA Rice',baseQuantity:100,baseUnit:'g',macros:{kcal:350,protein:7,carbs:78,fat:1},linkedHabitId:'food',price:2,packageAmount:1000,packageUnit:'g'},{id:'chicken',name:'QA Chicken',baseQuantity:100,baseUnit:'g',macros:{kcal:120,protein:24,carbs:0,fat:2},linkedHabitId:'protein'},{id:'egg',name:'QA Egg',baseQuantity:100,baseUnit:'g',unitWeightQty:60,unitWeightUnit:'g',macros:{kcal:150,protein:12,carbs:1,fat:10}},{id:'coffee',name:'QA Coffee',baseQuantity:100,baseUnit:'ml',macros:{kcal:2}}],dailyLogsByDate:{},macroTargets:{kcalTarget:2000}}};d.habits={habits:{food:{id:'food',name:'QA Food',goal:'count',countUnitMinutes:2},protein:{id:'protein',name:'QA Protein',goal:'count'}},habitCounts:{},habitSessions:{}};d.finance={finance:{foodItems:{purchase:{name:'QA Purchase',usualQty:1000,purchaseHistory:{synthetic:{qty:1000}}}}}};await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);}
const product=(over={})=>({kind:'product',productId:'rice',amount:150,unit:'g',date:'2026-02-01',meal:'lunch',...over});
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();mcp=(await f.mcp([...f.scopes,...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())])).client;});test.after(async()=>{await f?.close();});test.beforeEach(reset);
test('native product snapshots, macros, linked counts/time, historical corrections and concurrent replay persist exactly once',async()=>{
 const before=await stored(),input={data:product(),idempotencyKey:key()},[a,b]=await Promise.all([call('nutrition_entry_create',input),call('nutrition_entry_create',input)]);let v=a.item;assert.equal(v.id,b.item.id);assert.equal(v.data.entry.macrosSnapshot.kcal,525);assert.equal(v.data.entry.computedCost,0.3);
 let d=await stored();assert.equal(d.habits.habitCounts.food['2026-02-01'],1);assert.equal(d.habits.habitSessions.food['2026-02-01'].totalSec,120);assert.deepEqual(d.finance,before.finance);
 const stale=v.revision;
 // A catalogue change cannot silently rewrite the historical consumption snapshot.
 d.recipes.nutrition.products[0].macros.kcal=999;await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);
 v=(await call('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{amount:200,date:'2026-01-31',meal:'dinner'},idempotencyKey:key()})).item;assert.equal(v.data.entry.macrosSnapshot.kcal,700);
 d=await stored();assert.equal(d.habits.habitCounts.food['2026-02-01'],0);assert.equal(d.habits.habitCounts.food['2026-01-31'],1);assert.equal(d.habits.habitSessions.food['2026-02-01'].totalSec,0);assert.equal(d.habits.habitSessions.food['2026-01-31'].totalSec,120);
 await reject('nutrition_entry_update',{id:v.id,expectedRevision:stale,patch:{amount:20},idempotencyKey:key()},/REVISION_CONFLICT/);
 const q=await call('nutrition_entries_query',{from:'2026-01-31',to:'2026-01-31'});assert.equal(q.items.length,1);assert.equal(q.items[0].revision,v.revision);
 const summary=await call('nutrition_query',{collection:'dailyLogsByDate',from:'2026-01-31',to:'2026-01-31'});assert.equal(summary.summary.knownMacros.kcal,700);assert.equal(summary.summary.complete,true);
});
test('unit conversion, product replacement and unknown nutrients never invent density or missing macros',async()=>{
 let v=(await call('nutrition_entry_create',{data:product({productId:'egg',amount:2,unit:'unit',meal:'breakfast'}),idempotencyKey:key()})).item;assert.equal(v.data.entry.grams,120);assert.equal(v.data.entry.macrosSnapshot.kcal,180);
 v=(await call('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{productId:'coffee',amount:200,unit:'ml'},idempotencyKey:key()})).item;assert.equal(v.data.entry.macrosSnapshot.kcal,4);assert.equal(v.data.entry.macrosSnapshot.protein,null);assert.ok(v.data.entry.missingMacros.includes('protein'));
 const q=await call('nutrition_query',{collection:'dailyLogsByDate'});assert.equal(q.summary.complete,false);assert.equal(q.summary.missingValues,3);
 const before=await stored();await reject('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{unit:'g'},idempotencyKey:key()},/UNIT_CONVERSION_UNAVAILABLE/);assert.deepEqual(await stored(),before);
 const kg=(await call('nutrition_entry_create',{data:product({amount:0.15,unit:'kg'}),idempotencyKey:key()})).item;assert.equal(kg.data.entry.macrosSnapshot.kcal,525);
});
test('recipe rations compute from ingredient snapshots; correction, recoverable delete/restore and habit reversal are atomic',async()=>{
 let v=(await call('nutrition_entry_create',{data:{kind:'recipe',recipeId:'chicken',servings:2,date:'2026-01-31',meal:'dinner'},idempotencyKey:key()})).item;
 assert.equal(v.data.entry.macrosSnapshot.kcal,590);assert.equal(v.data.entry.ingredientsSnapshot.length,2);assert.equal((await stored()).habits.habitCounts.food['2026-01-31'],2);
 v=(await call('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{servings:1},idempotencyKey:key()})).item;assert.equal(v.data.entry.macrosSnapshot.kcal,295);assert.equal((await stored()).habits.habitCounts.food['2026-01-31'],1);
 await reject('nutrition_entry_delete',{id:v.id,expectedRevision:v.revision,idempotencyKey:key()},/confirmed/);
 const del=await call('nutrition_entry_delete',{id:v.id,expectedRevision:v.revision,confirmed:true,idempotencyKey:key()});assert.equal((await call('nutrition_entries_query',{})).total,0);assert.equal((await stored()).habits.habitCounts.food['2026-01-31'],0);
 const restore={deletionKey:del.deletionKey,idempotencyKey:key()};v=(await call('nutrition_entry_restore',restore)).item;assert.equal((await call('nutrition_entry_restore',restore)).item.id,v.id);assert.equal((await stored()).habits.habitCounts.food['2026-01-31'],1);
 await reject('nutrition_entry_restore',{deletionKey:del.deletionKey,idempotencyKey:key()},/RESTORE_TARGET_EXISTS/);
 const other=(await f.mcp(['nutrition:write','habits:write'],f.other)).client;await reject('nutrition_entry_restore',{deletionKey:del.deletionKey,idempotencyKey:key()},/DELETION_NOT_FOUND/,other);
});
test('scope, owner isolation, conversion/type/date validation and conflicting keys reject without personal writes',async()=>{
 const read=(await f.mcp(['nutrition:read'])).client,noHabit=(await f.mcp(['nutrition:read','nutrition:write'])).client,other=(await f.mcp(['nutrition:read','nutrition:write','habits:write'],f.other)).client;
 const before=await stored(),input={data:product(),idempotencyKey:key()};await reject('nutrition_entry_create',input,/insufficient_scope/i,read);await reject('nutrition_entry_create',input,/LINKED_HABIT_SCOPE_REQUIRED/,noHabit);assert.deepEqual(await stored(),before);
 let v=(await call('nutrition_entry_create',input)).item;await reject('nutrition_entry_create',{...input,data:product({amount:200})},/IDEMPOTENCY_CONFLICT/);await reject('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{amount:3},idempotencyKey:key()},/ENTITY_NOT_FOUND/,other);
 const after=await stored();for(const data of [product({date:'2999-01-01'}),product({date:'2026-02-30'}),product({productId:'missing'}),product({unit:'lb'}),product({amount:0}),{kind:'recipe',recipeId:'missing',servings:1,date:'2026-01-01',meal:'dinner'}])await reject('nutrition_entry_create',{data,idempotencyKey:key()},/FUTURE_CONSUMPTION|PRODUCT_NOT_FOUND|RECIPE_NOT_FOUND|Invalid input|Invalid enum|greater/);
 await reject('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{recipeId:'chicken'},idempotencyKey:key()},/ENTRY_KIND_MISMATCH/);assert.deepEqual(await stored(),after);
});
test('ledger failure rolls back consumption and linked habit counters/time',async()=>{
 await f.pool.query("CREATE FUNCTION reject_nutrition_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='nutrition_entry_create' THEN RAISE EXCEPTION 'injected nutrition ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_nutrition_ledger BEFORE INSERT ON jarvis_operations FOR EACH ROW EXECUTE FUNCTION reject_nutrition_ledger()");const before=await stored();await reject('nutrition_entry_create',{data:product(),idempotencyKey:key()},/Internal|error/i);assert.deepEqual(await stored(),before);await f.pool.query('DROP TRIGGER reject_nutrition_ledger ON jarvis_operations');
});
test('partial linked-habit failure rolls back earlier effects, and conflicting manual counter changes cannot be erased',async()=>{
 let d=await stored();d.habits.habits.protein.goal='time';await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);const before=await stored();await reject('nutrition_entry_create',{data:{kind:'recipe',recipeId:'chicken',servings:1,date:'2026-01-31',meal:'dinner'},idempotencyKey:key()},/LINKED_HABIT_MUST_BE_COUNT/);assert.deepEqual(await stored(),before);
 const v=(await call('nutrition_entry_create',{data:product(),idempotencyKey:key()})).item;d=await stored();d.habits.habitCounts.food['2026-02-01']=0;await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);const conflict=await stored();await reject('nutrition_entry_delete',{id:v.id,expectedRevision:v.revision,confirmed:true,idempotencyKey:key()},/LINKED_HABIT_BALANCE_CONFLICT/);assert.deepEqual(await stored(),conflict);
});

test('legacy gram entries use declared quantity and require no fabricated amount; linked permission returns OAuth challenge',async()=>{
 let d=await stored();d.recipes.nutrition.dailyLogsByDate={'2026-02-01':{meals:{lunch:{entries:[{entryId:'legacy',type:'product',productId:'egg',grams:120,nameSnapshot:'QA Egg',macrosSnapshot:{kcal:180,protein:14.4,carbs:1.2,fat:12},servingsCount:1}]}}}};await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);
 let v=(await call('nutrition_entries_query',{id:'legacy'})).items[0];v=(await call('nutrition_entry_update',{id:v.id,expectedRevision:v.revision,patch:{amount:60},idempotencyKey:key()})).item;assert.equal(v.data.entry.macrosSnapshot.kcal,90);assert.equal(v.data.entry.unit,'g');
 const noHabit=(await f.mcp(['nutrition:write'])).client;const denied=await noHabit.callTool({name:'nutrition_entry_create',arguments:{data:product(),idempotencyKey:key()}});assert.equal(denied.isError,true);assert.match(JSON.stringify(denied._meta),/habits:write/);
});

test('fractional recipe servings reverse the rounded native habit credit exactly',async()=>{
 const v=(await call('nutrition_entry_create',{data:{kind:'recipe',recipeId:'chicken',servings:0.5,date:'2026-02-01',meal:'dinner'},idempotencyKey:key()})).item;
 assert.equal((await stored()).habits.habitCounts.food['2026-02-01'],1);
 await call('nutrition_entry_delete',{id:v.id,expectedRevision:v.revision,confirmed:true,idempotencyKey:key()});assert.equal((await stored()).habits.habitCounts.food['2026-02-01'],0);assert.equal((await stored()).habits.habitCounts.protein['2026-02-01'],0);
});
