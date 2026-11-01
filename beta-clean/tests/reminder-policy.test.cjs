'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classify,view}=require('../projects/reminder-policy'),{shiftDays}=require('../projects/shift-days');
const now=new Date('2026-10-31T12:00:00Z');
test('past appointments are historical but overdue responsibilities never disappear with time',()=>{
 const event={id:'event',title:'Laura',status:'pending',target_date:'2026-09-02',source_metadata:{eventType:'guardia'}};
 const duty={id:'duty',title:'Comprar componentes',status:'pending',target_date:'2026-09-02'};
 assert.equal(classify(event,now).classification,'historical');assert.equal(classify(duty,now).overdue,true);
 assert.equal(classify(duty,new Date('2035-01-01')).pending,true);
 assert.deepEqual(view([event,duty],{now}).items.map(e=>e.id),['duty']);
 assert.deepEqual(view([event,duty],{now,view:'history'}).items.map(e=>e.id),['event']);
 assert.equal(classify({...event,source_metadata:{obligationKind:'responsibility',eventType:'guardia'}},now).pending,true);
 assert.equal(classify({...duty,title:'Reunión mal transcrita'},now).needsReview,true);
});
test('linked reminders are duplicates only when the task exists; completed records do not count',()=>{
 const task={id:'task',kind:'task',title:'Buy',status:'todo'},reminder={id:'r',taskId:'task',status:'pending'};
 assert.equal(view([task,reminder],{now}).counts.pending,1);
 assert.equal(view([reminder],{now}).counts.pending,1);
 assert.equal(view([{...task,status:'done'},reminder],{now}).counts.pending,0);
});
test('recurrence shows one relevant occurrence without altering stored historical dates',()=>{
 const e={id:'r',status:'pending',target_date:'2026-09-01',recurrence_type:'weekly',recurrence_rule:{interval:1}};
 const before=structuredClone(e),p=classify(e,now);
 assert.equal(p.classification,'recurring');assert.equal(p.nextOccurrence,'2026-11-03');assert.deepEqual(e,before);
 assert.equal(classify({...e,recurrence_end_date:'2026-09-30'},now).pending,false);
});
test('civil days preserve local clock, legacy elapsed days preserve 24h including DST and sub-minute time',()=>{
 const value='2026-10-24T10:00:12.345+02:00';
 assert.equal(shiftDays(value,1,{dayMode:'civil',timezone:'Europe/Zurich'}),'2026-10-25T09:00:12.345Z');
 assert.equal(shiftDays(value,1),'2026-10-25T08:00:12.345Z');
 assert.equal(shiftDays('2026-03-28T10:00:00+01:00',1,{dayMode:'civil',timezone:'Europe/Zurich'}),'2026-03-29T08:00:00.000Z');
});
