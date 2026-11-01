'use strict';
const crypto=require('node:crypto'),business=require('../scripts/shared/services/nutrition-business');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
const meals=['breakfast','lunch','dinner','snacks'];
const rows=v=>Array.isArray(v)?v.filter(Boolean):Object.entries(v||{}).filter(([k,v])=>k!=='_init'&&v&&typeof v==='object').map(([id,v])=>({...v,id:v.id||id}));
function enumerate(root){return Object.entries(root.dailyLogsByDate||{}).flatMap(([date,day])=>Object.entries(day.meals||{}).flatMap(([meal,m])=>(m.entries||[]).map(entry=>({date,meal,entry}))));}
function item(id,v,revision){return {id,data:v,revision:revision(v)};}
function dateValid(date,timezone,now){const today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);if(date>today)fail('FUTURE_CONSUMPTION_USE_PLAN',400);}
function baseOf(p){const qty=Number(p.baseQuantity||p.servingBaseGrams),unit=business.normalizeUnit(p.baseUnit||p.servingBaseUnit);return {qty:Number.isFinite(qty)&&qty>0?qty:null,unit:unit||null};}
function productSnapshot(p,ctx){const base=baseOf(p);return {...ctx.nutritionSnapshot(p),servingBaseQty:base.qty,servingBaseUnit:base.unit,macrosPerBase:business.knownMacros(p.macros)};}
function recipeSnapshot(recipe,products,ctx){
 const r=structuredClone(recipe);r.ingredients=rows(r.ingredients).map(ing=>{const p=products.find(p=>p.id===ing.productId);return {...ing,...(!ing.nutritionSnapshot&&p?{nutritionSnapshot:productSnapshot(p,ctx)}:{})};});return r;
}
function recipeMacros(r,servings){
 const derivedComplete=r.calculableNutrition===undefined||r.calculableNutrition>0&&r.calculableNutrition>=r.ingredients?.length;
 if(r.nutritionPerServing&&derivedComplete)return business.knownMacros(r.nutritionPerServing,servings);
 const yieldCount=Number(r.servings||r.yield||r.portions);
 if(r.nutritionTotals&&yieldCount>0&&derivedComplete)return business.knownMacros(r.nutritionTotals,servings/yieldCount);
 if(!(yieldCount>0)||!r.ingredients?.length)return business.knownMacros({});
 const total={carbs:0,protein:0,fat:0,kcal:0};
 for(const ing of r.ingredients){
  const n=ing.nutritionSnapshot,raw=ing.qty,qty=raw!==null&&raw!==''&&raw!==undefined?Number(raw):NaN;
  const unit=business.normalizeUnit(ing.unit),baseUnit=n?.servingBaseUnit;
  const normalized=unit&&baseUnit?business.convertAmountWithProduct(n,qty,unit,baseUnit):null;
  const known=normalized!==null&&n?.servingBaseQty>0?business.knownMacros(n.macrosPerBase,normalized/n.servingBaseQty):business.knownMacros({});
  for(const k of Object.keys(total))total[k]=total[k]===null||known[k]===null?null:total[k]+known[k];
 }
 return business.knownMacros(total,servings/yieldCount);
}
async function applyEffects({data,old,next,actor,c}){
 const plans=new Map();
 for(const [v,sign] of [[old,-1],[next,1]])if(v)for(const h of business.habitDeltas(v.entry,sign)){
  const key=h.habitId+'|'+v.date;const p=plans.get(key)||{habitId:h.habitId,date:v.date,delta:0};p.delta+=h.delta;plans.set(key,p);
 }
 for(const {habitId,date,delta} of plans.values()){
  if(!delta)continue;
  if(!actor.scopes.includes('habits:write'))fail('LINKED_HABIT_SCOPE_REQUIRED',403);
  const root=data.habits,h=root?.habits?.[habitId];if(!h||h.archived&&delta>0)fail('LINKED_HABIT_NOT_FOUND',404);if(h.system)fail('SYSTEM_HABIT_READ_ONLY',403);if(h.goal!=='count')fail('LINKED_HABIT_MUST_BE_COUNT',400);
  root.habitCounts??={};root.habitCounts[habitId]??={};
  const current=Number(root.habitCounts[habitId][date]||0),value=current+delta;if(!Number.isFinite(value)||value<0||value>1e8)fail('LINKED_HABIT_BALANCE_CONFLICT');
  root.habitCounts[habitId][date]=value;
  const minutes=Number(h.countUnitMinutes||0);
  if(minutes>0){root.habitSessions??={};root.habitSessions[habitId]??={};const previous=root.habitSessions[habitId][date];const total=typeof previous==='number'?previous:Number(previous?.totalSec||0),nextSec=total+delta*Math.round(minutes)*60;if(nextSec<0)fail('LINKED_HABIT_TIME_CONFLICT');root.habitSessions[habitId][date]={...(typeof previous==='object'?previous:{}),totalSec:nextSec};}
  const target=h.jarvisTargets?.day;
  if(target&&value>=target)await c.query("UPDATE notification_runs SET status='cancelled',error='habit_goal_completed',updated_at=now() WHERE user_id=$1 AND kind='habit-reminder' AND payload->>'habitId'=$2 AND payload->>'date'=$3 AND status IN ('pending','retry','no_subscription')",[actor.userId,habitId,date]);
 }
}
async function run({data,b,name,now,revision,c,actor}){
 data.recipes??={};data.recipes.nutrition??={};const root=data.recipes.nutrition;
 if(name==='nutrition_product_create'||name==='nutrition_product_update'){
  const entries=root.products??={};
  const old=b.id?rows(entries).find(p=>p.id===b.id):null;
  if(b.id&&!old)fail('PRODUCT_NOT_FOUND',404);
  // Queries expose the stored record revision, including object-keyed legacy products.
  const stored=Array.isArray(entries)?entries.find(p=>p?.id===b.id):entries[b.id];
  if(old&&revision(stored)!==b.expectedRevision)fail('REVISION_CONFLICT');
  const input=b.data||b.patch,id=b.id||crypto.randomUUID();
  const fold=v=>String(v||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s+/g,' ').trim();
  const v={...(old||{}),...input,id,macros:business.knownMacros({...old?.macros,...input.macros}),source:old?.source||'manual',createdAt:old?.createdAt||now.getTime(),updatedAt:now.getTime()};
  if(rows(entries).some(p=>p.id!==id&&fold(p.name)===fold(v.name)&&fold(p.brand)===fold(v.brand)))fail('PRODUCT_ALREADY_EXISTS');
  if(!!v.unitWeightQty!==!!v.unitWeightUnit)fail('UNIT_WEIGHT_PAIR_REQUIRED',400);
  v.servingBaseGrams=v.baseQuantity;v.servingBaseUnit=v.baseUnit;
  if(Array.isArray(entries)){const index=entries.findIndex(p=>p?.id===id);if(index<0)entries.push(v);else entries[index]=v;}else entries[id]=v;
  return {item:item(id,v,revision),warnings:Object.values(v.macros).includes(null)?['NUTRIENTS_INCOMPLETE: no se han inventado nutrientes ausentes.']:[]};
 }
 if(name==='nutrition_entries_query'){
  if(b.from&&b.to&&b.from>b.to)fail('INVALID_RANGE',400);
  const list=enumerate(root).filter(v=>(!b.id||v.entry.entryId===b.id)&&(!b.from||v.date>=b.from)&&(!b.to||v.date<=b.to)&&(!b.query||JSON.stringify(v).toLocaleLowerCase().includes(b.query.toLocaleLowerCase()))).sort((a,b)=>b.date.localeCompare(a.date)||String(a.entry.entryId).localeCompare(String(b.entry.entryId)));
  return {items:list.slice(b.offset,b.offset+b.limit).map(v=>item(v.entry.entryId,v,revision)),total:list.length,nextOffset:b.offset+b.limit<list.length?b.offset+b.limit:null};
 }
 let old;
 if(b.id){const list=enumerate(root).filter(v=>v.entry.entryId===b.id);if(list.length!==1)fail(list.length?'AMBIGUOUS_ENTRY_ID':'ENTITY_NOT_FOUND',list.length?409:404);old=list[0];if(revision(old)!==b.expectedRevision)fail('REVISION_CONFLICT');}
 let next,id=b.id||crypto.randomUUID();
 if(name==='nutrition_entry_restore'){
  const op=(await c.query('SELECT * FROM jarvis_operations WHERE user_id=$1 AND idempotency_key=$2',[actor.userId,b.deletionKey])).rows[0];if(!op||op.operation!=='nutrition_entry_delete')fail('DELETION_NOT_FOUND',404);
  next=structuredClone(op.result.item.data);id=next.entry.entryId;if(enumerate(root).some(v=>v.entry.entryId===id))fail('RESTORE_TARGET_EXISTS');
 }else if(name!=='nutrition_entry_delete'){
  const p=b.data||b.patch,kind=old?.entry.type||p.kind,date=p.date||old?.date,meal=p.meal||old?.meal;
  dateValid(date,b.timezone,now);
  const products=rows(root.products),financeRoot=data.finance?.finance||data.finance||{},financeProducts=rows(financeRoot.foodItems),ctx=business.context(products,financeProducts,()=>id,now.getTime());
  let entry;
  if(kind==='product'){
   if(p.recipeId!==undefined||p.servings!==undefined)fail('ENTRY_KIND_MISMATCH',400);
   const productId=p.productId||old?.entry.refId||old?.entry.productId,product=products.find(x=>x.id===productId);if(!product)fail('PRODUCT_NOT_FOUND',404);
   const same=old?.entry.type==='product'&&old.entry.refId===productId;
   const snap=same&&old.entry.nutritionSnapshot?old.entry.nutritionSnapshot:productSnapshot(product,ctx);
   const effective={...product,baseQuantity:snap.servingBaseQty,servingBaseGrams:snap.servingBaseQty,baseUnit:snap.servingBaseUnit,servingBaseUnit:snap.servingBaseUnit,macros:snap.macrosPerBase,unitWeightQty:snap.unitWeightQty,unitWeightUnit:snap.unitWeightUnit};
   const amount=p.amount??old?.entry.amount??old?.entry.grams,unit=p.unit||old?.entry.unit||(typeof old?.entry.grams==='number'?'g':null),base=baseOf(effective);
   if(!(amount>0)||!business.normalizeUnit(unit))fail('LEGACY_CONSUMPTION_AMOUNT_UNKNOWN',400);
   const normalized=base.unit?business.convertAmountWithProduct(effective,amount,unit,base.unit):null;
   if(base.unit&&normalized===null)fail('UNIT_CONVERSION_UNAVAILABLE',400);
   entry=ctx.productEntry({product:effective,amount,unit,meal});entry.nutritionSnapshot=structuredClone(snap);
   entry.macrosSnapshot=base.qty&&normalized!==null?business.knownMacros(snap.macrosPerBase,normalized/base.qty):business.knownMacros({});
   entry.grams=business.convertAmountWithProduct(effective,amount,unit,'g');
   if(!(entry.pricingSnapshot?.price>0))entry.computedCost=null;
   if(same){entry.nameSnapshot=old.entry.nameSnapshot;entry.productName=old.entry.productName||old.entry.nameSnapshot;
    if(old.entry.pricingSnapshot){const ps=old.entry.pricingSnapshot,consumed=business.convertAmountWithProduct(ps,amount,unit,ps.baseUnit);entry.pricingSnapshot=structuredClone(ps);entry.computedCost=ps.price>0&&ps.baseQty>0&&consumed!==null?consumed/ps.baseQty*ps.price:null;}
    entry.sideEffects={...entry.sideEffects,habits:structuredClone(old.entry.sideEffects?.habits||[])};
   }
  }else{
   if(p.productId!==undefined||p.amount!==undefined||p.unit!==undefined)fail('ENTRY_KIND_MISMATCH',400);
   const rid=p.recipeId||old?.entry.refId,same=old?.entry.type==='recipe'&&old.entry.refId===rid;
   const recipe=same&&old.entry.recipeSnapshot?old.entry.recipeSnapshot:data.recipes.items?.[rid]||data.recipes[rid];if(!recipe)fail('RECIPE_NOT_FOUND',404);
   const snap=same&&old.entry.recipeSnapshot?structuredClone(recipe):recipeSnapshot({...recipe,id:rid},products,ctx),servings=p.servings??old?.entry.servings;
   if(same&&!(old.entry.servings>0))fail('LEGACY_RECIPE_SERVINGS_UNKNOWN',400);
   const sideEffects=same&&old.entry.sideEffects?{...old.entry.sideEffects,habits:(old.entry.sideEffects.habits||[]).map(h=>({...h,amount:h.amount/old.entry.servings*servings}))}:ctx.recipeEffects(snap,servings);
   entry=business.recipeEntry(snap,servings,meal,{id,now:now.getTime(),computedCost:null,sideEffects});entry.macrosSnapshot=recipeMacros(snap,servings);
  }
  entry.entryId=id;entry.source={kind:'jarvis'};entry.servingsCount=old?.entry.servingsCount||1;entry.createdAt=old?.entry.createdAt||now.getTime();entry.updatedAt=now.getTime();entry.notes=p.notes??old?.entry.notes??'';
  entry.missingMacros=Object.entries(entry.macrosSnapshot).filter(([,v])=>v===null).map(([k])=>k);
  next={date,meal,entry};
 }
 await applyEffects({data,old,next,actor,c});
 if(old){const entries=root.dailyLogsByDate[old.date].meals[old.meal].entries;entries.splice(entries.findIndex(e=>e.entryId===id),1);}
 if(next){root.dailyLogsByDate??={};root.dailyLogsByDate[next.date]??={meals:{}};const day=root.dailyLogsByDate[next.date];for(const meal of meals)day.meals[meal]??={entries:[]};day.meals[next.meal].entries.unshift(next.entry);}
 if(name==='nutrition_entry_delete')return {item:item(id,old,revision),deletionKey:b.idempotencyKey};
 return {item:item(id,next,revision),warnings:next.entry.missingMacros?.length?['NUTRIENTS_INCOMPLETE: no se han inventado nutrientes ausentes.']:[]};
}
module.exports={run,enumerate};
