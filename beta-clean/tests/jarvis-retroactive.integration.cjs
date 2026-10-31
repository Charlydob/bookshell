'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let f,client,habit;
const key=()=>crypto.randomUUID();
async function call(name,args,c=client){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function denied(name,args,pattern,c=client){const r=await c.callTool({name,arguments:args});assert.ok(r.isError,JSON.stringify(r));assert.match(JSON.stringify(r),pattern);}
async function stored(){return (await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;}
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();client=(await f.mcp([...f.scopes,...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())])).client;habit=(await call('habits_create',{habit:{name:'Retroactive QA',goal:'time',schedule:{type:'daily',days:[]}},idempotencyKey:key()})).habit;});
test.after(async()=>{await f?.close();});
test('published MCP contract includes optional offset-aware start, correction and end',async()=>{
 const {tools}=await client.listTools();
 assert.ok(tools.find(t=>t.name==='activity_start').inputSchema.properties.startedAt);
 assert.ok(tools.find(t=>t.name==='activity_update').inputSchema.properties.patch.properties.startedAt);
 assert.ok(tools.find(t=>t.name==='activity_change').inputSchema.properties.endedAt);
});
test('retroactive start, concurrent correction, historic close, credits, replay and post-close correction persist once',async()=>{
 const now=Date.now(),start=new Date(now-3600000).toISOString(),corrected=new Date(now-7200000).toISOString(),end=new Date(now-1200000).toISOString();
 const input={label:'Working since two hours ago',habitId:habit.id,timezone:'Europe/Zurich',startedAt:start,idempotencyKey:key()};
 let s=(await call('activity_start',input)).session;
 assert.equal((await call('activity_start',input)).session.id,s.id);
 assert.equal((await stored()).habits.activitySessions[s.id].openAt,Date.parse(start));
 assert.equal((await stored()).habits.habitSessions?.[habit.id],undefined);
 const updates=[0,1].map(()=>({sessionId:s.id,expectedRevision:s.revision,patch:{startedAt:corrected},idempotencyKey:key()}));
 const results=await Promise.all(updates.map(args=>client.callTool({name:'activity_update',arguments:args})));
 assert.equal(results.filter(r=>!r.isError).length,1);
 assert.match(JSON.stringify(results.find(r=>r.isError)),/REVISION_CONFLICT/);
 s=results.find(r=>!r.isError).structuredContent.result.session;
 assert.equal(s.id,(await stored()).habits.activitySessions[s.id].id);assert.equal(s.habitId,habit.id);assert.equal(s.status,'running');
 assert.equal((await stored()).habits.habitSessions?.[habit.id],undefined);
 const stop={sessionId:s.id,expectedRevision:s.revision,action:'stop',endedAt:end,idempotencyKey:key()};
 s=(await call('activity_change',stop)).session;await call('activity_change',stop);
 let root=(await stored()).habits;
 const total=()=>Object.values(root.habitSessions[habit.id]).reduce((n,d)=>n+d.totalSec,0);
 assert.equal(total(),(Date.parse(end)-Date.parse(corrected))/1000);
 const correction={sessionId:s.id,expectedRevision:s.revision,patch:{startedAt:start},idempotencyKey:key()};
 s=(await call('activity_update',correction)).session;await call('activity_update',correction);root=(await stored()).habits;
 assert.equal(total(),(Date.parse(end)-Date.parse(start))/1000);
 const q=await call('activity_query',{sessionId:s.id,from:new Date(now-86400000).toISOString(),to:new Date(now+86400000).toISOString(),timezone:'Europe/Zurich'});
 assert.equal(q.sessions[0].durationSec,total());assert.equal(q.sessions.length,1);
 const source=require('node:fs').readFileSync(require('node:path').join(__dirname,'../scripts/modules/habits/schedule-credits.js'),'utf8');
 const {computeDayCreditsAndScores}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const scores=computeDayCreditsAndScores({targets:[{habitId:habit.id,value:10,done:total()/60,info:{metric:'time'}}]});
 assert.equal(scores.creditsEarned,Math.round(Math.max(0,total()/60-10)));
 const other=(await f.mcp(f.scopes,f.other)).client;
 await denied('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{label:'Intrusion'},idempotencyKey:key()},/SESSION_NOT_FOUND/,other);
});
test('retroactive DST fallback uses explicit offsets and splits persisted credits by local day',async()=>{
 const h=(await call('habits_create',{habit:{name:'DST QA',goal:'time',schedule:{type:'daily',days:[]}},idempotencyKey:key()})).habit;
 let s=(await call('activity_start',{label:'Repeated clock hour',habitId:h.id,timezone:'Europe/Zurich',startedAt:'2026-10-25T02:30:00+02:00',idempotencyKey:key()})).session;
 const concurrent=(await call('activity_start',{label:'Simultaneous',timezone:'Europe/Zurich',startedAt:'2026-10-25T02:30:00+02:00',idempotencyKey:key()})).session;
 s=(await call('activity_change',{sessionId:s.id,expectedRevision:s.revision,action:'stop',endedAt:'2026-10-25T02:30:00+01:00',idempotencyKey:key()})).session;
 await call('activity_change',{sessionId:concurrent.id,expectedRevision:concurrent.revision,action:'stop',endedAt:'2026-10-25T02:30:00+01:00',idempotencyKey:key()});
 assert.equal((await stored()).habits.habitSessions[h.id]['2026-10-25'].totalSec,3600);
 const q=await call('activity_query',{from:'2026-10-25T00:00:00+02:00',to:'2026-10-26T00:00:00+01:00',timezone:'Europe/Zurich'});
 assert.equal(q.totals.elapsedSec,3600);assert.equal(q.totals.activitySec,7200);assert.equal(q.totals.overlapSec,3600);
});
test('invalid timestamps, missing permissions and idempotency conflicts leave persisted state unchanged',async()=>{
 const input={label:'Validation',habitId:habit.id,timezone:'Europe/Zurich',idempotencyKey:key()};
 await denied('activity_start',{...input,startedAt:'2026-10-31T08:00:00'},/INVALID_ARGUMENT|offset|Invalid/);
 await denied('activity_start',{...input,startedAt:new Date(Date.now()+3600000).toISOString()},/INVALID_STARTED_AT/);
 const readOnly=(await f.mcp(['time:read'])).client;
 await denied('activity_start',input,/insufficient_scope/,readOnly);
 let s=(await call('activity_start',input)).session;
 await denied('activity_start',{...input,label:'Changed retry'},/IDEMPOTENCY_CONFLICT/);
 const before=await stored();
 await denied('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{startedAt:new Date(Date.now()+3600000).toISOString()},idempotencyKey:key()},/INVALID_STARTED_AT/);
 assert.deepEqual(await stored(),before);
 const timeOnly=(await f.mcp(['time:write'])).client;
 await denied('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{startedAt:new Date(Date.now()-10000).toISOString()},idempotencyKey:key()},/INSUFFICIENT_SCOPE/,timeOnly);
 await denied('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{durationSec:1},idempotencyKey:key()},/STOP_SESSION_BEFORE_INTERVAL_CORRECTION/);
 await call('activity_change',{sessionId:s.id,expectedRevision:s.revision,action:'stop',idempotencyKey:key()});
});
test('paused and resumed sessions preserve gaps, accept start correction and prevent self overlap',async()=>{
 const now=Date.now(),start=new Date(now-7200000).toISOString(),pause=new Date(now-3600000).toISOString();
 let s=(await call('activity_start',{label:'Pauses',timezone:'Europe/Zurich',startedAt:start,idempotencyKey:key()})).session;
 s=(await call('activity_change',{sessionId:s.id,expectedRevision:s.revision,action:'pause',endedAt:pause,idempotencyKey:key()})).session;
 s=(await call('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{startedAt:new Date(now-10800000).toISOString()},idempotencyKey:key()})).session;
 assert.equal(s.intervals[0][1],Date.parse(pause));assert.equal(s.status,'paused');
 await denied('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{startedAt:new Date(now-1800000).toISOString()},idempotencyKey:key()},/INVALID_INTERVAL/);
 s=(await call('activity_change',{sessionId:s.id,expectedRevision:s.revision,action:'resume',idempotencyKey:key()})).session;
 const open=s.openAt;
 s=(await call('activity_update',{sessionId:s.id,expectedRevision:s.revision,patch:{label:'Same pauses'},idempotencyKey:key()})).session;
 assert.equal(s.openAt,open);assert.equal(s.intervals.length,1);
 await call('activity_change',{sessionId:s.id,expectedRevision:s.revision,action:'stop',idempotencyKey:key()});
});
