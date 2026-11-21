"use strict";
const crypto = require('node:crypto');
const bad = (code, status=409) => { throw Object.assign(new Error(code), {status}); };
function validate(s, now) {
  s.intervals.sort((a,b)=>a[0]-b[0]);
  if ((s.status !== 'running' && !s.intervals.length) || s.intervals.some(([a,b],i)=>!Number.isFinite(a)||!Number.isFinite(b)||b<=a||b>now||b-a>366*86400000||i&&a<s.intervals[i-1][1])) bad('INVALID_INTERVAL',400);
  if (s.status === 'running' && (!Number.isFinite(s.openAt) || s.openAt > now || now-s.openAt > 366*86400000 || s.intervals.some(([,end])=>end>s.openAt))) bad('INVALID_STARTED_AT',400);
}
function contribution(s, splitInterval) {
  return s.status==='stopped'&&!s.deletedAt&&s.habitId ? s.intervals.flatMap(([a,b])=>splitInterval(a,b,s.timezone)) : [];
}
function debit(root, s, splitInterval) {
  if (!s.habitId || s.status!=='stopped' || s.deletedAt) return;
  const expected = new Map();
  for(const ch of contribution(s,splitInterval)) expected.set(ch.date,(expected.get(ch.date)||0)+(ch.end-ch.start)/1000);
  // Refuse ambiguous legacy projections rather than overwriting a daily total.
  for(const [date,seconds] of expected) {
    const day=root.habitSessions?.[s.habitId]?.[date];
    const entries=day?.sessions?.filter(e=>e.sessionId===s.id)||[];
    if(!entries.length || Math.abs(entries.reduce((n,e)=>n+e.durationSec,0)-seconds)>0.001 || !Number.isFinite(day.totalSec) || day.totalSec+0.001<seconds) bad('SESSION_PROJECTION_CONFLICT');
    day.sessions=day.sessions.filter(e=>e.sessionId!==s.id);
    day.totalSec=Math.max(0,day.totalSec-seconds);
  }
}
function correct({root,b,name,now,actor,revision,splitInterval,credit}) {
  const s=root.activitySessions?.[b.sessionId];
  if(!s) bad('SESSION_NOT_FOUND',404);
  if(revision(s)!==b.expectedRevision) bad('REVISION_CONFLICT');
  if(s.status!=='stopped' && name!=='activity_update') bad('STOP_SESSION_BEFORE_CORRECTION');
  if(s.status!=='stopped' && (b.patch?.intervals!==undefined || b.patch?.durationSec!==undefined)) bad('STOP_SESSION_BEFORE_INTERVAL_CORRECTION');
  if(b.patch?.startedAt!==undefined && (b.patch.intervals!==undefined || b.patch.durationSec!==undefined)) bad('AMBIGUOUS_INTERVAL_CORRECTION',400);
  if(name==='activity_restore'?!s.deletedAt:!!s.deletedAt) bad(name==='activity_restore'?'SESSION_NOT_DELETED':'SESSION_DELETED');
  if((s.habitId||b.habitId||b.parts?.some(p=>p.habitId))&&!actor.scopes.includes('habits:write')) bad('INSUFFICIENT_SCOPE',403);
  const before=structuredClone(s), snapshot=({...x})=>x;
  const history=[...(s.corrections||[]),{operation:name,at:now.getTime(),previousRevision:revision(s),before:snapshot((({corrections,...v})=>v)(before))}];
  debit(root,s,splitInterval);
  if(name==='activity_reassign') s.habitId=b.habitId;
  if(name==='activity_update') {
    for(const k of ['label','timezone','projectId']) if(b.patch[k]!==undefined) s[k]=b.patch[k];
    if(b.patch.startedAt!==undefined) {
      const start=Date.parse(b.patch.startedAt);
      if(!Number.isFinite(start)||start>now.getTime()||now.getTime()-start>366*86400000) bad('INVALID_STARTED_AT',400);
      if(s.intervals.length) s.intervals[0][0]=start;
      else if(s.status==='running') s.openAt=start;
      else bad('INVALID_STARTED_AT',400);
    }
    if(b.patch.intervals) s.intervals=b.patch.intervals.map(i=>[Date.parse(i.start),Date.parse(i.end)]);
    if(b.patch.durationSec!==undefined){
      if(b.patch.intervals||s.intervals.length!==1) bad('DURATION_REQUIRES_SINGLE_INTERVAL',400);
      s.intervals[0][1]=s.intervals[0][0]+b.patch.durationSec*1000;
    }
  }
  if(name==='activity_delete') s.deletedAt=now.getTime();
  if(name==='activity_restore') delete s.deletedAt;
  const result=[s];
  if(name==='activity_split') {
    const ranges=b.parts.flatMap(p=>p.intervals.map(i=>[Date.parse(i.start),Date.parse(i.end)]));
    const merge = arr => { const out=[];for(const x of arr.sort((a,b)=>a[0]-b[0])){const last=out.at(-1);if(last&&x[0]<last[1])bad('SPLIT_OVERLAP');if(last&&x[0]===last[1])last[1]=x[1];else out.push([...x]);}return out;};
    if(JSON.stringify(merge(ranges))!==JSON.stringify(merge(structuredClone(s.intervals))))bad('SPLIT_MUST_PRESERVE_INTERVALS');
    result.length=0;
    for(const [i,p] of b.parts.entries()){
      const child={...structuredClone(before),id:i?crypto.randomUUID():s.id,habitId:p.habitId,label:p.label||s.label,intervals:p.intervals.map(x=>[Date.parse(x.start),Date.parse(x.end)]),splitFrom:s.id};
      delete child.corrections;
      root.activitySessions[child.id]=child;result.push(child);
    }
  }
  for(const item of result){
    validate(item,now.getTime());
    item.updatedAt=now.getTime();item.corrections=history;
    if(!item.deletedAt && item.status==='stopped')credit(root,item);
  }
  return {session:{...result[0],revision:revision(result[0])},...(name==='activity_split'?{sessions:result.map(v=>({...v,revision:revision(v)}))}:{})};
}
module.exports={correct,debit,validate};
