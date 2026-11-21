'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {quote}=require('../jarvis/finance-fx');
test('FX reference validates pair/date/source and never falls back to constants',async()=>{
 const ok=async()=>({ok:true,json:async()=>({base:'CHF',quote:'EUR',date:'2026-02-02',rate:1.0871})});
 assert.equal((await quote('CHF','2026-02-02',ok)).rate,1.0871);
 for(const d of [{base:'USD',quote:'EUR',date:'2026-02-02',rate:1},{base:'CHF',quote:'EUR',date:'2026-03-01',rate:1},{base:'CHF',quote:'EUR',date:'2026-01-01',rate:1},{base:'CHF',quote:'EUR',date:'2026-02-02',rate:0}])await assert.rejects(quote('CHF','2026-02-02',async()=>({ok:true,json:async()=>d})),/UNVERIFIED/);
 await assert.rejects(quote('CHF','2026-02-02',async()=>{throw Error('offline');}),/UNAVAILABLE/);
 assert.equal((await quote('EUR','2026-02-02',()=>{throw Error('unexpected request');})).rate,1);
});
test('shared web/MCP projector handles decimal expenses, snapshot authority and cross currency destination',()=>{
 const {buildEntries}=require('../scripts/shared/services/finance-business');
 const root={accounts:{a:{entries:{'2026-01-01':{value:10},'2026-02-01':{value:0}},snapshots:{'2026-01-04':{value:20,updatedAt:99}}}}};
 const rows=[{type:'expense',amount:0.1,accountId:'a',date:'2026-01-02'},{type:'transfer',amount:100,destinationAmount:95,toAccountId:'a',date:'2026-01-03'}];
 const result=buildEntries(root,'a','2026-01-02',{rows,now:100,deltaAmount:r=>r.amount});
 assert.equal(result['entries/2026-01-02'].value,9.9);assert.equal(result['entries/2026-01-03'].value,104.9);assert.equal(result['entries/2026-02-01'].value,20);
});

test('legacy copies compare original records, normalize native type aliases, and reject conflicting IDs',()=>{
 const {rows}=require('../jarvis/finance');
 const v={type:'gasto',amount:2,date:'2026-01-01'};
 assert.equal(rows({transactions:{x:v},tx:{x:{...v}}}).length,1);
 assert.equal(rows({transactions:{x:v}})[0].type,'expense');
 assert.throws(()=>rows({transactions:{x:v},tx:{x:{...v,amount:3}}}),/AMBIGUOUS/);
});
