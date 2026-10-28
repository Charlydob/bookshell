'use strict';
const crypto=require('node:crypto');
const {syncTaskReminders}=require('./task-alerts');
const explicitPair={task:'Verificar implementación Work: PIN por gancho, QR opcional, CICO y firmware',reminder:'REVISAR WORK · actualización PIN HOOKBOX y Checkout Box'};
const words=s=>new Set(String(s||'').toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]);
async function migrateLinks(pool,{apply=false}={}){
 const c=await pool.connect(),report={apply,linked:[],review:[],untouched:[]};try{await c.query('BEGIN');const ps=(await c.query('SELECT * FROM project_workspaces ORDER BY id FOR UPDATE')).rows;
  for(const p of ps){const es=(await c.query('SELECT * FROM project_entries WHERE project_id=$1 AND deleted_at IS NULL ORDER BY id',[p.id])).rows,ts=es.filter(e=>e.kind==='task');
   for(const r of es.filter(e=>e.kind==='reminder'&&!e.task_id)){
    let matches=[],reason='';const exact=ts.filter(t=>t.data.title===r.data.title&&t.data.dueAt&&t.data.dueAt===r.data.dueAt);const content=ts.filter(t=>String(r.data.description||'').trim().length>=120&&String(t.data.description||'').trim()===r.data.description.trim());const named=r.data.title===explicitPair.reminder?ts.filter(t=>t.data.title===explicitPair.task):[];
    if(named.length===1){matches=named;reason='Correspondencia expresamente identificada por el usuario';}else if(content.length===1){matches=content;reason='Descripción extensa idéntica y única en el proyecto';}else if(exact.length===1){matches=exact;reason='Título y fecha exactos y únicos en el proyecto';}
    if(matches.length===1){const t=matches[0];const offset=t.data.dueAt&&r.data.dueAt?(new Date(t.data.dueAt)-new Date(r.data.dueAt))/60000:null;const minutes=Number.isInteger(offset)&&offset>=0&&offset<=525600?offset:null;report.linked.push({project:p.data.title,taskId:t.id,reminderId:r.id,reason,offsetMinutes:minutes});if(apply){await c.query('UPDATE project_entries SET task_id=$2,offset_minutes=$3,version=version+1,updated_at=now() WHERE id=$1 AND task_id IS NULL',[r.id,t.id,minutes]);await c.query('UPDATE project_entries SET version=version+1,updated_at=now() WHERE id=$1',[t.id]);await c.query("INSERT INTO project_activity(project_id,user_id,action,entity_id,before_data,after_data) VALUES($1,$2,'reminder.linked_migration',$3,$4,$5)",[p.id,p.user_id,r.id,JSON.stringify(r.data),JSON.stringify({...r.data,taskId:t.id,reason})]);await syncTaskReminders(c,p.id,t.id);await c.query("INSERT INTO notification_migration_reviews(reminder_id,candidate_ids,reason,status,resolved_at) VALUES($1,$2,$3,'linked',now()) ON CONFLICT(reminder_id) DO UPDATE SET status='linked',resolved_at=now()",[r.id,[t.id],reason]);}}
    else {const rw=words(r.data.title+' '+r.data.description);const candidates=ts.filter(t=>{const tw=words(t.data.title+' '+t.data.description);return [...rw].filter(w=>tw.has(w)).length/Math.max(1,Math.min(rw.size,tw.size))>=.35;});if(candidates.length){report.review.push({project:p.data.title,reminderId:r.id,candidateIds:candidates.map(t=>t.id),reason:'Posible relación semántica; no se modifica sin vínculo explícito'});if(apply)await c.query("INSERT INTO notification_migration_reviews(reminder_id,candidate_ids,reason) VALUES($1,$2,$3) ON CONFLICT(reminder_id) DO NOTHING",[r.id,candidates.map(t=>t.id),'Revisar relación; títulos/descripciones no inequívocos']);}else report.untouched.push(r.id);}
   }
  }
  await c.query(apply?'COMMIT':'ROLLBACK');return report;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
module.exports={migrateLinks};
if(require.main===module){const{Pool}=require('pg');const pool=new Pool({connectionString:process.env.DATABASE_URL});migrateLinks(pool,{apply:process.argv.includes('--apply')}).then(r=>console.log(JSON.stringify(r,null,2))).catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>pool.end());}
