'use strict';
const { z } = require('zod/v3');
const crypto = require('node:crypto');
const text = z.string().trim().max(300);
const date = z.string().datetime({offset:true}).nullable().default(null).transform(v=>v?new Date(v).toISOString():null);
const uid = z.string().uuid();
const scheduleType=z.enum(['estimated','confirmed']).default('estimated');
const projectBase = z.object({
  title: text.min(1), description:z.string().max(12000).default(''),
  status:z.enum(['active','paused','archived']).default('active'),
  template:z.boolean().default(false), physicalProgress:z.number().min(0).max(100).nullable().default(null),
  physicalEvidence:z.string().max(4000).default(''), color:z.enum(['green','blue','amber','violet']).default('green'),
  dueAt:date, dueAtType:scheduleType, tags:z.array(text).max(20).default([])
}).strict();
const projectSchema = projectBase.superRefine((v,c)=>{if(v.physicalProgress!==null&&!v.physicalEvidence.trim())c.addIssue({code:'custom',message:'El avance físico requiere evidencia',path:['physicalEvidence']});});
const projectPatchSchema=projectBase.partial();
const base = {title:text.min(1), description:z.string().max(100000).default(''), tags:z.array(text).max(20).default([])};
const schemas = {
  task:z.object({...base,status:z.enum(['todo','doing','done']).default('todo'),priority:z.enum(['low','medium','high','urgent']).default('medium'),assignee:text.default(''),startAt:date,dueAt:date,scheduleType,parentId:uid.nullable().default(null),dependsOn:z.array(uid).max(100).default([]),milestone:z.boolean().default(false),estimatedMinutes:z.number().int().min(0).max(525600).nullable().default(null),completedAt:date,attachments:z.array(z.object({title:text.min(1),url:z.string().url()}).strict()).max(20).default([])}).strict(),
  note:z.object({...base,category:text.default('General')}).strict(),
  document:z.object({...base,category:text.default('Técnica')}).strict(),
  event:z.object({...base,startAt:date,endAt:date,location:text.default(''),status:z.enum(['scheduled','done','cancelled']).default('scheduled')}).strict(),
  reminder:z.object({...base,dueAt:date,status:z.enum(['pending','done','cancelled']).default('pending'),notify:z.boolean().default(true)}).strict(),
  purchase:z.object({...base,quantity:z.number().positive().max(1e9).default(1),unitCost:z.number().min(0).max(1e9).default(0),currency:z.enum(['EUR','CHF','USD']).default('EUR'),status:z.enum(['planned','ordered','received']).default('planned'),supplier:text.default(''),dueAt:date}).strict(),
  inventory:z.object({...base,quantity:z.number().min(0).max(1e9).default(0),unit:text.default('uds'),location:text.default(''),minimum:z.number().min(0).default(0)}).strict()
};
function fail(message,status=400){const e=new Error(message);e.status=status;throw e;}
function validateGraph(entries){
  const tasks=new Map(entries.filter(e=>e.kind==='task').map(e=>[e.id,e]));
  for(const t of tasks.values()) {
    for(const id of [...t.dependsOn,...(t.parentId?[t.parentId]:[])])if(!tasks.has(id))fail('La dependencia o subtarea debe pertenecer al mismo proyecto');
    if(t.dependsOn.includes(t.id)||t.parentId===t.id)fail('Una tarea no puede depender de sí misma');
    if(t.startAt&&t.dueAt&&t.startAt>t.dueAt)fail('La fecha de inicio debe ser anterior al vencimiento');
  }
  function check(edges){const active=new Set(),visited=new Set();function walk(id){if(active.has(id))fail('Dependencia circular');if(visited.has(id))return;active.add(id);for(const next of edges(tasks.get(id)))walk(next);active.delete(id);visited.add(id);}for(const id of tasks.keys())walk(id);}
  check(t=>t.dependsOn);check(t=>t.parentId?[t.parentId]:[]);
  check(t=>[...t.dependsOn,...[...tasks.values()].filter(child=>child.parentId===t.id).map(child=>child.id)]);
  // Parent completion and dependency completion are explicit, never inferred physical progress.
  for(const t of tasks.values())if(t.status==='done'){
    if(t.dependsOn.some(id=>tasks.get(id).status!=='done'))fail('Completa primero las dependencias');
    if([...tasks.values()].some(x=>x.parentId===t.id&&x.status!=='done'))fail('Completa primero las subtareas');
  }
}
function summarize(project,entries,now=new Date()){
  const tasks=entries.filter(e=>e.kind==='task'); const map=new Map(tasks.map(t=>[t.id,t]));
  const enriched=tasks.map(t=>({...t,blockedBy:t.dependsOn.filter(id=>map.get(id)?.status!=='done')}));
  const done=tasks.filter(t=>t.status==='done').length;
  const byStatus=Object.fromEntries(['todo','doing','done'].map(s=>[s,tasks.filter(t=>t.status===s).length]));
  const spending={};for(const e of entries.filter(e=>e.kind==='purchase')){spending[e.currency]??={planned:0,ordered:0,received:0};spending[e.currency][e.status]+=e.quantity*e.unitCost;}
  return {...project,entries:entries.map(e=>e.kind==='task'?enriched.find(t=>t.id===e.id):e),stats:{total:tasks.length,done,taskProgress:tasks.length?Math.round(done/tasks.length*100):0,physicalProgress:project.physicalProgress,blocked:enriched.filter(t=>t.status!=='done'&&t.blockedBy.length).length,overdue:tasks.filter(t=>t.status!=='done'&&t.dueAt&&new Date(t.dueAt)<now).length,byStatus,spending,lowStock:entries.filter(e=>e.kind==='inventory'&&e.quantity<e.minimum).length}};
}
function row(r){const data={...r.data};if(!r.kind)data.dueAtType??='estimated';if(r.kind==='task'){data.scheduleType??='estimated';data.estimatedMinutes??=null;data.completedAt??=null;data.attachments??=[];}return {...data,id:r.id,version:r.version,createdAt:r.created_at,updatedAt:r.updated_at,...(r.kind?{kind:r.kind,projectId:r.project_id}:{})};}
function createDomain(pool){
  async function transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const r=await fn(c);await c.query('COMMIT');return r;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
  async function owned(c,user,id,lock=false){if(!uid.safeParse(id).success)fail('Identificador inválido');const r=await c.query(`SELECT * FROM project_workspaces WHERE id=$1 AND user_id=$2 ${lock?'FOR UPDATE':''}`,[id,user]);if(!r.rows[0])fail('Proyecto no encontrado',404);return row(r.rows[0]);}
  async function entries(c,id){return (await c.query('SELECT * FROM project_entries WHERE project_id=$1 AND deleted_at IS NULL ORDER BY created_at,id',[id])).rows.map(row);}
  async function activity(c,user,project,action,id,before,after){await c.query('INSERT INTO project_activity(project_id,user_id,action,entity_id,before_data,after_data) VALUES($1,$2,$3,$4,$5,$6)',[project,user,action,id,before?JSON.stringify(before):null,after?JSON.stringify(after):null]);}
  async function get(user,id){return transaction(async c=>{const p=await owned(c,user,id);return summarize(p,await entries(c,id));});}
  async function list(user){const ps=(await pool.query('SELECT * FROM project_workspaces WHERE user_id=$1 ORDER BY updated_at DESC',[user])).rows;return Promise.all(ps.map(r=>get(user,r.id)));}
  async function create(user,input,templateId){const data=projectSchema.parse(input);return transaction(async c=>{const id=crypto.randomUUID();await c.query('INSERT INTO project_workspaces(id,user_id,data) VALUES($1,$2,$3)',[id,user,JSON.stringify(data)]);if(templateId){const source=await owned(c,user,templateId);if(!source.template)fail('El proyecto de origen no es una plantilla');const es=await entries(c,templateId);const ids=new Map(es.map(e=>[e.id,crypto.randomUUID()]));for(const e of es){const {id:old,version,createdAt,updatedAt,kind,projectId,...d}=e;if(kind==='task'){d.status='todo';d.startAt=null;d.dueAt=null;d.parentId=ids.get(d.parentId)||null;d.dependsOn=d.dependsOn.map(x=>ids.get(x));}if(kind==='reminder'){d.status='pending';d.dueAt=null;}if(kind==='event'){d.status='scheduled';d.startAt=null;d.endAt=null;}if(kind==='purchase')d.status='planned';if(kind==='inventory')d.quantity=0;await c.query('INSERT INTO project_entries(id,project_id,kind,data) VALUES($1,$2,$3,$4)',[ids.get(old),id,kind,JSON.stringify(d)]);}}await activity(c,user,id,'project.created',id,null,data);return {id,...data,version:1};});}
  async function update(user,id,input,version){return transaction(async c=>{const p=await owned(c,user,id,true);if(p.version!==version)fail('Los datos han cambiado. Actualiza la vista antes de guardar.',409);const {id:_,version:v,createdAt,updatedAt,...old}=p;const data=projectSchema.parse({...old,...input});await c.query('UPDATE project_workspaces SET data=$1,version=version+1,updated_at=now() WHERE id=$2',[JSON.stringify(data),id]);await activity(c,user,id,'project.updated',id,old,data);return {...data,id,version:version+1};});}
  async function writeEntry(user,projectId,kind,input,id=null,version=null,remove=false){if(!schemas[kind])fail('Tipo de registro inválido');return transaction(async c=>{await owned(c,user,projectId,true);let es=await entries(c,projectId);const old=id?es.find(e=>e.id===id&&e.kind===kind):null;if(id&&!old)fail('Registro no encontrado',404);if(old&&old.version!==version)fail('Los datos han cambiado. Actualiza la vista.',409);const clean=old?Object.fromEntries(Object.entries(old).filter(([k])=>!['id','version','createdAt','updatedAt','kind','projectId','blockedBy'].includes(k))):{};let data=remove?clean:schemas[kind].parse({...clean,...input});if(kind==='task'){if(data.status==='done')data.completedAt=old?.status==='done'&&old.completedAt?old.completedAt:new Date().toISOString();else data.completedAt=null;}if(kind==='event'&&data.startAt&&data.endAt&&data.startAt>data.endAt)fail('Fin anterior al inicio');if(['note','document'].includes(kind)&&data.description.includes('\u0000'))fail('Contenido inválido');id??=crypto.randomUUID();es=es.filter(e=>e.id!==id);if(!remove)es.push({id,kind,...data});validateGraph(es);if(remove)await c.query('UPDATE project_entries SET deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1',[id]);else if(old)await c.query('UPDATE project_entries SET data=$1,version=version+1,updated_at=now() WHERE id=$2',[JSON.stringify(data),id]);else await c.query('INSERT INTO project_entries(id,project_id,kind,data) VALUES($1,$2,$3,$4)',[id,projectId,kind,JSON.stringify(data)]);await c.query('UPDATE project_workspaces SET updated_at=now() WHERE id=$1',[projectId]);await activity(c,user,projectId,`${kind}.${remove?'deleted':old?'updated':'created'}`,id,old,remove?null:data);return {id,kind,...data,version:old?old.version+1:1};});}
  async function history(user,id){await owned(pool,user,id);return (await pool.query('SELECT seq,action,entity_id,created_at,before_data,after_data FROM project_activity WHERE project_id=$1 ORDER BY seq DESC LIMIT 100',[id])).rows;}
  async function agenda(user,{from,to}={}){const ps=await list(user);return ps.filter(p=>!p.template&&p.status!=='archived').flatMap(p=>p.entries.filter(e=>['task','event','reminder'].includes(e.kind)).map(e=>({...e,projectTitle:p.title}))).filter(e=>{const date=e.dueAt||e.startAt;return !from&&!to||date&&(!from||date>=from)&&(!to||date<=to);}).sort((a,b)=>(a.dueAt||a.startAt||'9999').localeCompare(b.dueAt||b.startAt||'9999'));}
  async function reschedule(user,projectId,taskId,days){return transaction(async c=>{await owned(c,user,projectId,true);const es=await entries(c,projectId);const tasks=es.filter(e=>e.kind==='task');if(!tasks.some(t=>t.id===taskId))fail('Tarea no encontrada',404);const affected=new Set([taskId]);let changed=true;while(changed){changed=false;for(const t of tasks)if(!affected.has(t.id)&&t.dependsOn.some(x=>affected.has(x))){affected.add(t.id);changed=true;}}const updates=[];for(const t of tasks.filter(t=>affected.has(t.id)&&t.status!=='done')){const {id,kind,version,createdAt,updatedAt,projectId:p,...data}=t;for(const k of ['startAt','dueAt'])if(data[k])data[k]=new Date(new Date(data[k]).getTime()+days*86400000).toISOString();await c.query('UPDATE project_entries SET data=$1,version=version+1,updated_at=now() WHERE id=$2',[JSON.stringify(data),id]);await activity(c,user,projectId,'task.rescheduled',id,t,data);updates.push({id,...data});}return {updated:updates};});}
  return {get,list,create,update,writeEntry,history,agenda,reschedule};
}
module.exports={projectSchema,projectPatchSchema,schemas,validateGraph,summarize,createDomain,fail};
