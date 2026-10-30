'use strict';
const crypto=require('node:crypto');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
const objectRows=v=>Array.isArray(v)?v.map((data,i)=>[String(data?.id||i),data]):Object.entries(v||{}).filter(([id])=>id!=='_init');
function container(data,module){
 if(module==='people'||module==='folders')module='notes';
 if(module==='nutrition')return data.recipes?.nutrition||{};
 if(module==='gym'||module==='finance')return data[module]?.[module]||data[module]||{};
 return data[module]||{};
}
function runQuery(data,module,b,revision){
 let raw=container(data,module)[b.collection];
 if(module==='people')raw=container(data,module).notes;
 if(module==='recipes'&&b.collection==='items')raw={...Object.fromEntries(Object.entries(container(data,module)).filter(([id,v])=>v?.title&&id!=='items')),...(raw||{})};
 if(module==='finance'){
  const root=container(data,module);
  if(b.collection==='categories')raw=root.catalog?.categories||root.balance?.categories||{};
  if(b.collection==='snapshots')raw=root.balance?.snapshots||{};
  if(['budgets','recurring'].includes(b.collection))raw=root[b.collection]||root.balance?.[b.collection]||{};
  if(b.collection==='transactions'){
   const legacyMovements=Object.fromEntries(Object.values(root.movements||root.balance?.movements||{}).flatMap(objectRows));
   raw={...(root.balance?.tx||{}),...(root.tx||{}),...legacyMovements,...(root.balance?.transactions||{}),...(root.transactions||{})};
  }
 }
 let rows=objectRows(raw);
 if(module==='people')rows=rows.filter(([,v])=>v?.noteKind==='persona');
 if(module==='gym'&&b.collection==='workouts')rows=rows.flatMap(([date,day])=>objectRows(day).map(([id,v])=>[id,{...v,date:v.date||date}]));
 rows=rows.filter(([id,v])=>v&&typeof v==='object'&&(!b.id||id===b.id)&&(!b.query||fold(JSON.stringify(v)).includes(fold(b.query)))&&(!b.from||(v.date||v.dateISO?.slice(0,10)||id)>=b.from)&&(!b.to||(v.date||v.dateISO?.slice(0,10)||id)<=b.to));
 rows.sort(([a],[b])=>a.localeCompare(b));
 const items=rows.slice(b.offset,b.offset+b.limit).map(([id,v])=>({id,data:v,revision:revision(v)}));
 const result={items,total:rows.length,nextOffset:b.offset+b.limit<rows.length?b.offset+b.limit:null};
 if(module==='nutrition'&&b.collection==='macroTargets'){
   const targets=container(data,module).macroTargets||container(data,module).goals;
   result.summary=targets||null;result.items=[];result.total=targets?1:0;result.nextOffset=null;
 }
 if(module==='nutrition'&&b.collection==='dailyLogsByDate'){
   const macros={kcal:0,protein:0,carbs:0,fat:0};let missing=0,entries=0;
   for(const [,day] of rows)for(const meal of Object.values(day.meals||{}))for(const e of meal.entries||[]){entries++;for(const k of Object.keys(macros)){if(typeof e.macrosSnapshot?.[k]==='number')macros[k]+=e.macrosSnapshot[k];else missing++;}}
   result.summary={entries,knownMacros:macros,complete:missing===0,missingValues:missing};
 }
 return result;
}
async function run({data,b,name,c,actor,now,revision}){
 const [module,action]=name.split('_');
 const item=(id,v)=>({id,data:v,revision:revision(v)});
 if(action==='query')return runQuery(data,module,b,revision);
 const actual=module==='people'||module==='folders'?'notes':module;
 data[actual]??={};const root=data[actual],collection=module==='folders'?'folders':module==='people'?'notes':module==='recipes'?'items':module;
 root[collection]??={};const entries=root[collection];
 if(module==='recipes')for(const [id,v] of Object.entries(root))if(id!=='items'&&v?.title&&!entries[id])entries[id]=structuredClone(v);
 const get=id=>{const v=entries[id];if(!v||module==='people'&&v.noteKind!=='persona')fail('ENTITY_NOT_FOUND',404);return v;};
 const check=v=>{if(revision(v)!==b.expectedRevision)fail('REVISION_CONFLICT');};
 const duplicate=(v,except)=>Object.entries(entries).some(([id,x])=>id!==except&&x&&((module==='people'?fold(x.person?.firstName+' '+(x.person?.lastName||'')):fold(x.title||x.name))===(module==='people'?fold(v.person.firstName+' '+(v.person.lastName||'')):fold(v.title||v.name))||module==='books'&&v.isbn&&x.isbn===v.isbn||module==='people'&&v.person.phone&&String(x.person?.phone||'').replace(/\D/g,'')===v.person.phone.replace(/\D/g,'')));
 const validateFolder=v=>{if(v.folderId&&!root.folders?.[v.folderId])fail('FOLDER_NOT_FOUND',404);};
 const validateParent=(v,id)=>{let parent=v.parentId;const seen=new Set([id]);while(parent){if(seen.has(parent))fail('FOLDER_CYCLE');seen.add(parent);const p=root.folders?.[parent];if(!p)fail('FOLDER_NOT_FOUND',404);parent=p.parentId;}};
 if(action==='scale'){
  const old=get(b.id),factor=b.servings/(old.servings||1),v=structuredClone(old);
  v.servings=b.servings;v.ingredients=objectRows(v.ingredients).map(([id,i])=>{if(typeof i.qty!=='number')fail('INGREDIENT_QUANTITY_UNKNOWN',400);return {...i,id:i.id||id,qty:i.qty*factor};});
  return {item:item(b.id,v),warnings:['Preview only; the stored recipe was not changed.']};
 }
 if(action==='restore'){
  const ledger=(await c.query('SELECT * FROM jarvis_operations WHERE user_id=$1 AND idempotency_key=$2',[actor.userId,b.deletionKey])).rows[0];
  if(!ledger||ledger.operation!==module+'_delete')fail('DELETION_NOT_FOUND',404);
  const old=ledger.result.item;if(entries[old.id])fail('RESTORE_TARGET_EXISTS');
  if(module==='notes')validateFolder(old.data);
  if(duplicate(old.data))fail('ENTITY_ALREADY_EXISTS');
  entries[old.id]=old.data;return {item:item(old.id,old.data)};
 }
 if(action==='create'||action==='update'){
  const id=b.id||crypto.randomUUID(),old=action==='update'?get(id):null;
  if(old)check(old);
  let v={...(old||{}),...(b.data||b.patch),updatedAt:now.getTime()};if(!old)v.createdAt=now.getTime();
  if(module==='people'){
   const person={...(old?.person||{}),...(b.data||b.patch)};
   v={...(old||{}),title:[person.firstName,person.lastName].filter(Boolean).join(' '),person,noteKind:'persona',type:'note',content:old?.content||'',folderId:old?.folderId||'',createdAt:old?.createdAt||now.getTime(),updatedAt:now.getTime()};
  }
  if(module==='notes'){v.type='note';v.noteKind=old?.noteKind||'text';v.name=v.title;validateFolder(v);}
  if(module==='folders')validateParent(v,id);
  if(module==='recipes'){
   v.id=id;
   if(b.data?.ingredients||b.patch?.ingredients){
    v.ingredients=v.ingredients.map(i=>{if(i.productId&&!objectRows(data.recipes?.nutrition?.products).some(([id,p])=>id===i.productId||p.id===i.productId))fail('FOOD_PRODUCT_NOT_FOUND',404);return {...i,id:i.id||crypto.randomUUID(),text:i.name,label:i.name,done:false};});
    // Derived fields are invalidated instead of reporting stale nutrition/cost as current.
    for(const k of ['nutritionTotals','nutritionPerServing','totalCost','calculableNutrition','calculableCost'])delete v[k];
   }
   if(b.data?.steps||b.patch?.steps)v.steps=v.steps.map(s=>({...s,id:s.id||crypto.randomUUID(),done:!!s.done}));
   if(old&&b.patch?.servings&&!b.patch.ingredients&&v.nutritionTotals)v.nutritionPerServing=Object.fromEntries(Object.entries(v.nutritionTotals).map(([k,n])=>[k,n/v.servings]));
  }
  if(module==='books'){
   if(old&&(b.patch.pages!==undefined||b.patch.status!==undefined))fail('USE_BOOKS_PROGRESS_FOR_READING_STATE');
   if(!old){if(v.status==='finished')fail('CREATE_BOOK_THEN_RECORD_PROGRESS');v.currentPage=0;v.status=v.status||'planned';}
  }
  if(duplicate(v,id))fail('ENTITY_ALREADY_EXISTS');
  entries[id]=v;
  return {item:item(id,v),...(module==='people'&&v.person.birthday!==old?.person?.birthday?{warnings:['Birthday saved in the person card; automatic reminder synchronization is not implemented by this operation.']}:{})};
 }
 const v=get(b.id);check(v);
 if(action==='delete'){
  if(module==='notes'&&v.noteKind==='persona')fail('PERSON_DELETE_REQUIRES_REMINDER_RECONCILIATION');
  if(module==='notes'&&Object.values(root.notes||{}).some(n=>n.linkRefs?.some(l=>l.targetId===b.id)))fail('NOTE_HAS_INCOMING_LINKS');
  delete entries[b.id];if(module==='recipes'&&root[b.id]?.title)delete root[b.id];return {item:item(b.id,v),deletionKey:b.idempotencyKey};
 }
 if(name==='people_add_note'){
  v.person??={};v.person.notesEntries??=[];v.person.notesEntries.push({id:crypto.randomUUID(),text:b.text,createdAt:now.getTime(),updatedAt:now.getTime()});
 }
 if(name==='people_link'){
  const target=get(b.targetId);if(b.targetId===b.id)fail('SELF_RELATION_NOT_ALLOWED',400);
  v.linkRefs=(v.linkRefs||[]).filter(l=>l.targetId!==b.targetId);
  if(!b.remove)v.linkRefs.push({targetId:b.targetId,label:b.label});
 }
 if(name==='books_progress'){
  if(b.currentPage>(v.pages||Infinity))fail('PAGE_OUT_OF_RANGE',400);
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:b.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  if(b.date>today)fail('FUTURE_READING_NOT_ALLOWED',400);
  const delta=b.currentPage-(v.currentPage||0);root.readingLog??={};root.readingLog[b.date]??={};
  const count=Number(root.readingLog[b.date][b.id]||0)+delta;if(count<0)fail('READING_CORRECTION_DATE_REQUIRED');
  root.readingLog[b.date][b.id]=count;v.currentPage=b.currentPage;
  if(v.pages&&b.currentPage===v.pages){v.status='finished';v.finishedOn=b.date;v.finishedAt=now.getTime();v.finishedPast=false;}
  else{v.status='reading';v.finishedOn=null;v.finishedAt=null;v.finishedPast=false;}
 }
 v.updatedAt=now.getTime();return {item:item(b.id,v)};
}
module.exports={run,runQuery};
