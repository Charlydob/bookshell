'use strict';
const {parts}=require('./notification-time');
const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
const day=v=>v instanceof Date?v.toISOString().slice(0,10):String(v||'').slice(0,10);
// A view, never an update of status, dates or notification schedules.
function classify(e,now=new Date(),zone='Europe/Zurich'){
 const m=e.source_metadata||e.sourceMetadata||{},date=day(e.target_date||e.targetDate)||(e.dueAt||e.startAt?parts(e.dueAt||e.startAt,e.timezone||zone).date:'');
 const today=parts(now,e.timezone||zone).date,status=e.status||'pending';
 const explicit=e.obligationKind||m.obligationKind;
 const eventType=fold(m.eventType),scheduled=!!(m.eventLabel&&m.endTime);
 const event=explicit==='event'||e.kind==='event'||(!explicit&&(['guardia','meeting','appointment','cita','reunion','birthday'].includes(eventType)||scheduled||eventType==='multi_date'&&/tiene libre/.test(fold(m.subject))));
 const recurring=(e.recurrence_type||e.recurrenceType||'none')!=='none';
 const terminal=['completed','done','cancelled','expired','received'].includes(status)||e.archived;
 const ended=day(e.recurrence_end_date||e.recurrenceEndDate);
 const historical=!!(event&&!recurring&&date&&date<today)||!!(recurring&&ended&&ended<today);
 const linked=!!(e.taskId||e.task_id);
 const review=!event&&!explicit&&date&&date<today&&/guardia|reuni[oó]n|qued[eé] con|clase de|clases de/.test(fold(e.title));
 let nextOccurrence=date,recurrenceNeedsReview=false;
 if(recurring&&date&&date<today&&!historical&&!terminal){
  const next=require('./recurrence').getNextRecurrenceDate;
  for(let i=0;nextOccurrence&&nextOccurrence<today&&i<40000;i++){
   const candidate=next({...e,target_date:nextOccurrence});if(!candidate||candidate<=nextOccurrence){nextOccurrence=null;recurrenceNeedsReview=true;break;}nextOccurrence=candidate;
  }
  if(nextOccurrence&&nextOccurrence<today){nextOccurrence=null;recurrenceNeedsReview=true;}
 }
 return {classification:terminal?'completed':historical?'historical':recurring?'recurring':date&&date>today?'future':'responsibility',obligationKind:event?'event':'responsibility',pending:!terminal&&!historical&&!linked,overdue:!terminal&&!historical&&!event&&!recurring&&!!date&&date<today,priority:e.priority||m.priority||'medium',duplicateOf:linked?(e.taskId||e.task_id):null,needsReview:!!review||recurrenceNeedsReview,date,nextOccurrence:recurring?nextOccurrence:null,reason:terminal?'terminal_status':historical?'past_one_off_event_or_ended_series':linked?'task_link':event?'event_evidence':recurring?'recurrence_rule':'preserve_uncompleted_responsibility'};
}
function view(items,{view='pending',now=new Date(),timezone='Europe/Zurich'}={}){
 const tasks=new Map(items.filter(e=>e.kind==='task').map(e=>[e.id,e]));
 const classified=items.map(e=>{
  const m=e.source_metadata||{},link=e.taskId||e.task_id||m.taskId||m.projectTaskId;
  const resolved=link&&tasks.has(link)?{...e,taskId:link}:{...e,taskId:null,task_id:null};
  return {...e,attention:classify(resolved,now,timezone)};
 });
 const counts={pending:classified.filter(e=>e.attention.pending).length,historical:classified.filter(e=>e.attention.classification==='historical').length,completed:classified.filter(e=>e.attention.classification==='completed').length,duplicates:classified.filter(e=>e.attention.duplicateOf).length,needsReview:classified.filter(e=>e.attention.needsReview).length};
 const selected=classified.filter(e=>view==='all'||view==='pending'&&e.attention.pending||view==='history'&&['historical','completed'].includes(e.attention.classification));
 return {items:selected,counts};
}
module.exports={classify,view};
