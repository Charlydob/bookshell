'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let f,mcp;const key=()=>crypto.randomUUID();
async function call(name,args,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function reject(name,args,pattern,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(r.isError,JSON.stringify(r));assert.match(JSON.stringify(r),pattern);}
async function stored(){return (await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;}
async function reset(){const d=await stored();d.gym={gym:{exercises:{bench:{name:'QA Bench',type:'strength',strengthType:'reps',muscleGroups:['Chest']},uni:{name:'QA Unilateral',type:'reps',unilateral:true},hold:{name:'QA Hold',type:'time'},run:{name:'QA Run',type:'cardio'},bw:{name:'QA Bodyweight',type:'reps',useBodyweight:true}},body:{'2026-01-01':{weightKg:70}},workouts:{},templates:{}}};await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);}
const sets=()=>[1,2,3].map(()=>({reps:8,kg:60,done:true}));
const workout=()=>({name:'QA Chest',date:'2026-02-01',exercises:[{exerciseId:'bench',sets:sets()}]});
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();mcp=(await f.mcp([...f.scopes,...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())])).client;});
test.after(async()=>{await f?.close();});test.beforeEach(reset);
test('native snapshots and totals persist; concurrent retries, last set correction and date relocation preserve all exercises',async()=>{
 const input={data:workout(),idempotencyKey:key()},[a,b]=await Promise.all([call('gym_workout_create',input),call('gym_workout_create',input)]);let v=a.item;assert.equal(v.id,b.item.id);
 assert.equal(v.data.totalReps,24);assert.equal(v.data.totalVolumeKg,1440);assert.equal(v.data.exercises.bench.nameSnapshot,'QA Bench');assert.equal(v.data.startedAt,null);assert.equal(v.data.recorded,true);assert.equal(v.data.timingKnown,false);
 const old=v.revision;const corrected=sets();corrected[2].kg=65;
 v=(await call('gym_exercise_set',{id:v.id,expectedRevision:v.revision,exerciseId:'bench',sets:corrected,idempotencyKey:key()})).item;assert.equal(v.data.totalVolumeKg,1480);
 await reject('gym_exercise_set',{id:v.id,expectedRevision:old,exerciseId:'bench',sets:[],idempotencyKey:key()},/REVISION_CONFLICT/);
 v=(await call('gym_exercise_set',{id:v.id,expectedRevision:v.revision,exerciseId:'uni',sets:[{repsR:5,repsL:4,kgR:10,kgL:12,done:true}],idempotencyKey:key()})).item;
 assert.equal(v.data.totalReps,33);assert.equal(v.data.totalVolumeKg,1578);
 v=(await call('gym_workout_update',{id:v.id,expectedRevision:v.revision,patch:{date:'2026-01-31',name:'QA Corrected'},idempotencyKey:key()})).item;
 const root=(await stored()).gym.gym;assert.equal(root.workouts['2026-02-01'][v.id],undefined);assert.deepEqual(root.workouts['2026-01-31'][v.id],v.data);
 const history=await call('gym_query',{collection:'workouts',from:'2026-01-31',to:'2026-01-31'});assert.equal(history.items[0].revision,v.revision);assert.equal(history.total,1);
});
test('partial session and recorded time do not invent sets; unknown bodyweight explicitly warns',async()=>{
 let v=(await call('gym_workout_create',{data:{name:'QA Partial',date:'2026-02-01'},idempotencyKey:key()})).item;assert.equal(v.data.partial,true);assert.deepEqual(v.data.exercises,{});
 v=(await call('gym_workout_update',{id:v.id,expectedRevision:v.revision,patch:{startedAt:'2026-02-01T08:00:00+01:00',finishedAt:'2026-02-01T09:00:00+01:00'},idempotencyKey:key()})).item;assert.equal(v.data.durationSec,3600);assert.equal(v.data.timingKnown,true);
 const d=await stored();d.gym.gym.body={};await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);
 const r=await call('gym_workout_create',{data:{name:'QA Unknown bodyweight',date:'2026-02-01',exercises:[{exerciseId:'bw',sets:[{reps:10,done:true}]}]},idempotencyKey:key()});assert.ok(r.warnings.some(w=>w.includes('BODYWEIGHT_UNKNOWN')));assert.equal(r.item.data.partial,true);
});
test('time, cardio and bodyweight reuse native total rules and ignore uncompleted sets',async()=>{
 const v=(await call('gym_workout_create',{data:{name:'QA Mixed',date:'2026-02-01',exercises:[{exerciseId:'hold',sets:[{timeSec:30,kg:10,done:true}]},{exerciseId:'run',sets:[{timeSec:600,distanceKm:2,notes:'Descanso 60 s declarado',done:true}]},{exerciseId:'bw',sets:[{reps:10,kg:5,done:true}]},{exerciseId:'bench',sets:[{reps:8,kg:100,done:false}]}]},idempotencyKey:key()})).item;
 assert.equal(v.data.totalVolumeKg,1050);assert.equal(v.data.totalReps,10);assert.equal(v.data.exercises.run.sets[0].distanceKm,2);
});
test('existing template save/update, template-based session and immutable historical snapshots',async()=>{
 let t=(await call('gym_template_save',{data:{name:'QA Routine',exerciseIds:['bench']},idempotencyKey:key()})).item;
 t=(await call('gym_template_save',{id:t.id,expectedRevision:t.revision,data:{name:'QA Routine',exerciseIds:['bench','uni']},idempotencyKey:key()})).item;
 let v=(await call('gym_workout_create',{data:{name:'QA Template',date:'2026-02-01',templateId:t.id},idempotencyKey:key()})).item;
 assert.equal(Object.keys(v.data.exercises).length,2);assert.equal(v.data.exercises.bench.sets.length,0);
 const d=await stored();d.gym.gym.exercises.bench.name='QA Renamed';await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);
 v=(await call('gym_exercise_set',{id:v.id,expectedRevision:v.revision,exerciseId:'bench',sets:sets(),idempotencyKey:key()})).item;assert.equal(v.data.exercises.bench.nameSnapshot,'QA Bench');
 await reject('gym_template_save',{id:t.id,expectedRevision:'a'.repeat(64),data:{name:'QA Stale',exerciseIds:[]},idempotencyKey:key()},/REVISION_CONFLICT/);
});
test('scope, foreign ownership, date/unit/type validation and idempotency conflicts are atomic',async()=>{
 const read=(await f.mcp(['gym:read'])).client,other=(await f.mcp(['gym:read','gym:write'],f.other)).client;
 const input={data:workout(),idempotencyKey:key()};await reject('gym_workout_create',input,/insufficient_scope/i,read);const v=(await call('gym_workout_create',input)).item;
 await reject('gym_workout_update',{id:v.id,expectedRevision:v.revision,patch:{name:'Intrusion'},idempotencyKey:key()},/ENTITY_NOT_FOUND/,other);
 await reject('gym_workout_create',{...input,data:{...workout(),name:'Changed'}},/IDEMPOTENCY_CONFLICT/);
 const before=await stored();
 for(const data of [{...workout(),date:'2999-01-01'},{...workout(),date:'2026-02-30'},{...workout(),exercises:[{exerciseId:'missing',sets:[]}]},{...workout(),exercises:[{exerciseId:'bench',sets:[{kg:-1,done:true}]}]},{...workout(),exercises:[{exerciseId:'run',sets:[{kg:20,done:true}]}]},{...workout(),exercises:[{exerciseId:'bench',sets:[{kg:2,unit:'lb',done:true}]}]}])await reject('gym_workout_create',{data,idempotencyKey:key()},/FUTURE_WORKOUT|EXERCISE_NOT_FOUND|GYM_SET|custom|Invalid input|Unrecognized|too_small|greater/);
 assert.deepEqual(await stored(),before);
});
test('injected ledger failure rolls back workout, snapshots and totals',async()=>{
 await f.pool.query("CREATE FUNCTION reject_gym_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='gym_workout_create' THEN RAISE EXCEPTION 'injected gym ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_gym_ledger BEFORE INSERT ON jarvis_operations FOR EACH ROW EXECUTE FUNCTION reject_gym_ledger()");
 const before=await stored();await reject('gym_workout_create',{data:workout(),idempotencyKey:key()},/Internal|error/i);assert.deepEqual(await stored(),before);await f.pool.query('DROP TRIGGER reject_gym_ledger ON jarvis_operations');
});
