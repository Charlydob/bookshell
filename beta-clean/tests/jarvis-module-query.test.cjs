'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {runQuery}=require('../jarvis/modules');
const {revision}=require('../jarvis/domain');
const base={limit:30,offset:0};
test('date filters reject unsupported collections and reversed ranges instead of reporting false empty results',()=>{
 assert.throws(()=>runQuery({notes:{notes:{person:{noteKind:'persona'}}}},'people',{...base,collection:'people',from:'2026-10-30'},revision),/DATE_FILTER_UNSUPPORTED/);
 assert.throws(()=>runQuery({},'nutrition',{...base,collection:'dailyLogsByDate',from:'2026-10-31',to:'2026-10-30'},revision),/INVALID_RANGE/);
});
test('finance range filtering uses an existing ISO date rather than comparing localized date strings or UUIDs',()=>{
 const data={finance:{finance:{transactions:{one:{date:'30/10/2026',dateISO:'2026-10-30T12:00:00Z',amount:12,currency:'CHF'},unknown:{date:'Sin fecha'},other:{date:'2026-10-29',amount:2}}}}};
 const q=runQuery(data,'finance',{...base,collection:'transactions',from:'2026-10-30',to:'2026-10-30'},revision);
 assert.equal(q.total,1);assert.equal(q.items[0].id,'one');assert.equal(q.items[0].data.currency,'CHF');
});
