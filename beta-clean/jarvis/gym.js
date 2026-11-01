'use strict';
const crypto=require('node:crypto'),business=require('../scripts/shared/services/gym-business');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
function calendarDay(value,timezone){return new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(value);}
function run({data,b,name,now,revision}){
 data.gym??={};const root=data.gym.gym||data.gym;root.workouts??={};root.templates??={};
 const item=(id,v)=>({id,data:v,revision:revision(v)}),ctx=business.context(root.exercises||{},root.body||{});
 if(name==='gym_template_save'){
  for(const id of b.data.exerciseIds)if(!root.exercises?.[id])fail('EXERCISE_NOT_FOUND',404);
  const id=b.id||crypto.randomUUID(),old=root.templates[id];if(b.id&&!old)fail('ENTITY_NOT_FOUND',404);if(old&&revision(old)!==b.expectedRevision)fail('REVISION_CONFLICT');
  const v={...(old||{}),...business.template(id,b.data.name,b.data.exerciseIds,b.data.emoji,now.getTime())};root.templates[id]=v;return {item:item(id,v)};
 }
 let old,oldDate;
 if(b.id){const matches=Object.entries(root.workouts).flatMap(([d,day])=>day?.[b.id]?[{d,v:day[b.id]}]:[]);if(matches.length!==1)fail(matches.length?'AMBIGUOUS_WORKOUT_ID':'ENTITY_NOT_FOUND',matches.length?409:404);oldDate=matches[0].d;old={...matches[0].v,date:matches[0].v.date||oldDate};if(revision(old)!==b.expectedRevision)fail('REVISION_CONFLICT');}
 const id=b.id||crypto.randomUUID(),v=old?structuredClone(old):{id,date:b.data.date,name:b.data.name,startedAt:null,finishedAt:null,durationSec:0,exercises:{},recorded:true,source:{kind:'jarvis'},createdAt:now.getTime()};
 v.startedAt??=null;v.finishedAt??=null;
 const patch=b.data||b.patch||{};
 for(const k of ['date','name','notes'])if(patch[k]!==undefined)v[k]=patch[k];
 if(v.date>calendarDay(now,b.timezone))fail('FUTURE_WORKOUT_USE_PLAN',400);
 for(const k of ['startedAt','finishedAt'])if(patch[k]!==undefined)v[k]=patch[k]===null?null:Date.parse(patch[k]);
 if(v.startedAt!==null&&v.startedAt>now.getTime()||v.finishedAt!==null&&v.finishedAt>now.getTime())fail('FUTURE_WORKOUT_USE_PLAN',400);
 if(v.finishedAt!==null&&(v.startedAt===null||v.finishedAt<v.startedAt))fail('INVALID_WORKOUT_INTERVAL',400);
 if(v.startedAt!==null&&calendarDay(new Date(v.startedAt),b.timezone)!==v.date)fail('WORKOUT_DATE_START_MISMATCH',400);
 let entries=patch.exercises||[];
 if(new Set(entries.map(e=>e.exerciseId)).size!==entries.length)fail('DUPLICATE_EXERCISE_ID',400);
 if(!old&&patch.templateId){const t=root.templates[patch.templateId];if(!t)fail('TEMPLATE_NOT_FOUND',404);entries=[...t.exerciseIds.map(exerciseId=>({exerciseId,sets:[]})),...entries];}
 if(name==='gym_exercise_set')entries=[{exerciseId:b.exerciseId,sets:b.sets}];
 for(const e of entries){
  if(!root.exercises?.[e.exerciseId])fail('EXERCISE_NOT_FOUND',404);
  const previous=v.exercises[e.exerciseId];
  v.exercises[e.exerciseId]=previous?{...previous,sets:e.sets}:ctx.snapshot(e.exerciseId,e.sets,Object.keys(v.exercises).length);
 }
 const warnings=[];let partial=!Object.keys(v.exercises).length;
 for(const [eid,ex] of Object.entries(v.exercises)){
  const type=ctx.type(ex,eid),uni=ctx.unilateral(ex,eid),body=ctx.useBodyweight(ex,eid);
  if(!ex.sets?.length)partial=true;
  for(const s of ex.sets||[]){
   if(type==='time'&&[s.reps,s.repsR,s.repsL].some(x=>x!=null)||type==='reps'&&s.timeSec!=null)fail('GYM_SET_FIELDS_DO_NOT_MATCH_TYPE',400);
   if(type==='cardio'&&(s.reps!=null||s.kg!=null||s.repsR!=null||s.kgR!=null))fail('GYM_SET_FIELDS_DO_NOT_MATCH_TYPE',400);
   if(type!=='cardio'&&(s.distanceKm!=null||s.incline!=null))fail('GYM_SET_FIELDS_DO_NOT_MATCH_TYPE',400);
   if(!uni&&[s.repsR,s.repsL,s.kgR,s.kgL].some(x=>x!=null))fail('GYM_SET_NOT_UNILATERAL',400);
   if(!s.done)partial=true;
   if(s.done&&(type==='cardio'||type==='time'?s.timeSec==null:uni?s.repsR==null&&s.repsL==null&&s.reps==null:s.reps==null))partial=true;
   if(s.done&&type!=='cardio'&&!body&&(uni?s.kg==null&&s.kgR==null&&s.kgL==null:s.kg==null))partial=true;
  }
  if(body&&ctx.bodyweight(v.date)==null){partial=true;warnings.push('BODYWEIGHT_UNKNOWN: el volumen excluye peso corporal desconocido.');}
 }
 v.timingKnown=v.startedAt!==null&&v.finishedAt!==null;
 v.durationSec=v.timingKnown?Math.floor((v.finishedAt-v.startedAt)/1000):0;
 if(!v.timingKnown)warnings.push('TIMING_UNKNOWN: no se han inventado horas ni duración.');
 v.partial=partial;Object.assign(v,ctx.totals(v));v.updatedAt=now.getTime();
 if(partial)warnings.push('PARTIAL_WORKOUT: los totales incluyen solo datos/series completadas conocidos.');
 if(oldDate&&oldDate!==v.date)delete root.workouts[oldDate][id];
 root.workouts[v.date]??={};root.workouts[v.date][id]=v;
 return {item:item(id,v),warnings};
}
module.exports={run};
