'use strict';
const crypto=require('node:crypto');
const error=message=>Object.assign(new Error(message),{status:400});
const iso=v=>v?new Date(v).toISOString():null;
const taskUnavailable=t=>t.deleted_at?'task_deleted':t.data.archived?'task_archived':t.data.status==='done'?'task_done':null;
function alertDate(task,old,reminder){
 if(reminder.offset_minutes!==null&&reminder.offset_minutes!==undefined)return task.dueAt?iso(new Date(task.dueAt).getTime()-reminder.offset_minutes*60000):null;
 if(old?.dueAt&&task.dueAt&&reminder.data.dueAt&&old.dueAt!==task.dueAt)return iso(new Date(reminder.data.dueAt).getTime()+new Date(task.dueAt).getTime()-new Date(old.dueAt).getTime());
 return reminder.data.dueAt||null;
}
async function cancelRuns(c,taskId,reason){await c.query("UPDATE notification_runs SET status='cancelled',error=$2,updated_at=now() WHERE obligation_id=$1 AND status IN ('pending','retry','sending','no_subscription')",[taskId,reason]);}
async function syncTaskReminders(c,projectId,taskId,oldTask=null,now=new Date()){
 const t=(await c.query('SELECT * FROM project_entries WHERE id=$1 AND project_id=$2',[taskId,projectId])).rows[0];if(!t)return;
 const p=(await c.query('SELECT * FROM project_workspaces WHERE id=$1',[projectId])).rows[0];
 const unavailable=taskUnavailable(t)||(p.data.status==='archived'?'project_archived':p.data.template?'project_template':null);
 const rs=(await c.query("SELECT * FROM project_entries WHERE task_id=$1 AND deleted_at IS NULL AND kind='reminder' ORDER BY id",[taskId])).rows;
 for(const r of rs){const dueAt=alertDate(t.data,oldTask,r);let status=r.data.status,reason=r.suspension_reason;
  if(unavailable){if(status==='pending'){status='cancelled';reason=unavailable;}}
  else if(!dueAt&&r.offset_minutes!==null){if(status==='pending'||reason){status='cancelled';reason='no_due_date';}}
  else if(status==='cancelled'&&['task_done','task_archived','project_archived','project_template','no_due_date','past_on_reopen'].includes(reason)&&r.data.notify){if(dueAt&&new Date(dueAt)>now){status='pending';reason=null;}else reason='past_on_reopen';}
  if(dueAt!==r.data.dueAt||status!==r.data.status||reason!==r.suspension_reason){const data={...r.data,dueAt,status};await c.query('UPDATE project_entries SET data=$2,suspension_reason=$3,version=version+1,updated_at=now() WHERE id=$1',[r.id,JSON.stringify(data),reason]);await c.query("INSERT INTO project_activity(project_id,user_id,action,entity_id,before_data,after_data) VALUES($1,$2,'reminder.synchronized',$3,$4,$5)",[projectId,p.user_id,r.id,JSON.stringify(r.data),JSON.stringify(data)]);}
  if(status!=='pending'||dueAt!==r.data.dueAt)await c.query("UPDATE notification_runs SET status='cancelled',error='schedule_changed',updated_at=now() WHERE source_entry_id=$1 AND status IN ('pending','retry','sending','no_subscription')",[r.id]);
 }
 if(unavailable)await cancelRuns(c,taskId,unavailable);
}
async function configureTaskReminders(c,projectId,taskId,configs,now=new Date()){
 if(configs===undefined)return;
 const task=(await c.query("SELECT * FROM project_entries WHERE id=$1 AND project_id=$2 AND kind='task'",[taskId,projectId])).rows[0];
 const old=(await c.query("SELECT * FROM project_entries WHERE task_id=$1 AND deleted_at IS NULL",[taskId])).rows;
 const kept=new Set(),seen=new Set();
 for(const config of configs){const offset=config.offsetMinutes??null;if(offset!==null&&!task.data.dueAt)throw error('Asigna un vencimiento para usar avisos anticipados.');
  const at=offset!==null?iso(new Date(task.data.dueAt).getTime()-offset*60000):iso(config.at);
  if(!at)throw error('El aviso personalizado necesita fecha y hora.');
  const key=at;if(seen.has(key))throw error('Hay dos avisos programados para el mismo instante.');seen.add(key);
  const prior=config.id?old.find(r=>r.id===config.id):old.find(r=>!kept.has(r.id)&&(offset!==null?r.offset_minutes===offset:r.offset_minutes===null&&r.data.dueAt===at));
  if(config.id&&!prior)throw error('El aviso no pertenece a esta tarea.');
  const id=prior?.id||crypto.randomUUID();kept.add(id);const enabled=config.enabled!==false;
  // Completed user-managed reminders and accepted occurrences are never resurrected just by saving a task.
  const data={...(prior?.data||{}),title:prior?.data.title||task.data.title,description:prior?.data.description||'',tags:prior?.data.tags||[],dueAt:at,notify:enabled,status:enabled?(prior?.data.status==='done'?'done':prior?.suspension_reason==='user_disabled'?'pending':prior?.data.status||'pending'):'cancelled'};
  const reason=enabled?(prior?.suspension_reason==='user_disabled'?null:prior?.suspension_reason||null):'user_disabled';
  if(prior){if(at!==prior.data.dueAt||!enabled)await c.query("UPDATE notification_runs SET status='cancelled',error='schedule_changed',updated_at=now() WHERE source_entry_id=$1 AND status IN ('pending','retry','sending','no_subscription')",[id]);if(JSON.stringify(data)!==JSON.stringify(prior.data)||offset!==prior.offset_minutes||reason!==prior.suspension_reason)await c.query('UPDATE project_entries SET data=$2,offset_minutes=$3,suspension_reason=$4,version=version+1,updated_at=now() WHERE id=$1',[id,JSON.stringify(data),offset,reason]);}
  else await c.query("INSERT INTO project_entries(id,project_id,kind,data,task_id,offset_minutes,suspension_reason) VALUES($1,$2,'reminder',$3,$4,$5,$6)",[id,projectId,JSON.stringify(data),taskId,offset,reason]);
 }
 for(const r of old)if(!kept.has(r.id)&&r.data.notify){await c.query("UPDATE project_entries SET data=jsonb_set(jsonb_set(data,'{notify}','false'),'{status}','\"cancelled\"'),suspension_reason='user_disabled',version=version+1,updated_at=now() WHERE id=$1",[r.id]);await c.query("UPDATE notification_runs SET status='cancelled',error='user_disabled',updated_at=now() WHERE source_entry_id=$1 AND status IN ('pending','retry','sending','no_subscription')",[r.id]);}
 await syncTaskReminders(c,projectId,taskId,null,now);
}
function attachReminders(entries){return entries.map(t=>t.kind!=='task'?t:{...t,reminders:entries.filter(r=>r.kind==='reminder'&&r.taskId===t.id).map(r=>({id:r.id,offsetMinutes:r.offsetMinutes,at:r.dueAt,enabled:r.notify,status:r.status,suspensionReason:r.suspensionReason,delivery:r.delivery||null}))});}
module.exports={syncTaskReminders,configureTaskReminders,attachReminders,alertDate,cancelRuns};
