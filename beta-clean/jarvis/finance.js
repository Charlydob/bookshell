'use strict';
const crypto=require('node:crypto');
const business=require('../scripts/shared/services/finance-business');
const fail=(code,status=409)=>{throw Object.assign(new Error(code),{status});};
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o||{},k);
const safeRows=o=>Object.entries(o||{}).filter(([k,v])=>k!=='_init'&&v&&typeof v==='object');
function rootOf(data){return data.finance?.finance||data.finance||{};}
function locations(root){return [root.balance?.tx,root.tx,...Object.values(root.balance?.movements||{}),...Object.values(root.movements||{}),root.balance?.transactions,root.transactions].filter(Boolean);}
function rows(root){
 const raw=new Map();
 for(const c of locations(root))for(const [id,v] of safeRows(c)){
  if(raw.has(id)&&!require('node:util').isDeepStrictEqual(raw.get(id),v))fail('AMBIGUOUS_LEGACY_TRANSACTION');
  raw.set(id,v);
 }
 return [...raw].map(([id,v])=>({...v,id,type:business.normalizeType(v.type??v.extras?.type),date:String(v.date||v.dateISO||'').slice(0,10)}));
}
function categories(root){return root.catalog?.categories||root.balance?.categories||{};}
function currency(a){const c=a.currency||a.accountCurrency;if(!/^[A-Z]{3}$/.test(c||''))fail('ACCOUNT_CURRENCY_UNKNOWN',400);return c;}
function category(root,value){if(!value)return '';const match=safeRows(categories(root)).find(([id,v])=>id===value||v.name===value||v.label===value);if(!match)fail('CATEGORY_NOT_FOUND',404);return match[0];}
function linked(v){return !!(v.linkedHabitId||v.recurringId||v.extras?.items?.length||v.extras?.ticketData||v.ticketId||v.receiptId||v.food||v.source==='shortcut');}
function validateDate(date,zone,now){const today=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(now);if(date>today)fail('FUTURE_MOVEMENT_USE_PLAN',400);}
async function run({data,b,name,now,revision}){
 if(name==='finance_quote')return require('./finance-fx').quote(b.currency,b.date);
 const root=rootOf(data),accounts=root.accounts||{}, item=(id,v)=>({id,data:v,revision:revision(v)});
 if(name==='finance_preferences')return {accounts:safeRows(accounts).map(([id,v])=>({id,name:v.name||id,currency:v.currency||null})),defaultAccountId:root.balance?.defaultAccountId||null,categories:safeRows(categories(root)).map(([id,v])=>({id,name:v.name||v.label||id})),rules:Object.fromEntries(safeRows(root.jarvisRules).map(([id,v])=>[id,item(id,v)])),timezone:'Europe/Zurich'};
 if(name==='finance_rule_set'){
  if(!accounts[b.accountId])fail('ACCOUNT_NOT_FOUND',404);currency(accounts[b.accountId]);if(b.categoryId)category(root,b.categoryId);
  root.jarvisRules??={};const old=root.jarvisRules[b.id];if(old&&revision(old)!==b.expectedRevision)fail('REVISION_CONFLICT');if(!old&&b.expectedRevision)fail('ENTITY_NOT_FOUND',404);
  const v={match:b.match,accountId:b.accountId,categoryId:b.categoryId||'',updatedAt:now.getTime()};root.jarvisRules[b.id]=v;return {item:item(b.id,v)};
 }
 const before=rows(root);let old;
 if(b.id){old=before.find(x=>x.id===b.id);if(!old)fail('ENTITY_NOT_FOUND',404);const stored=locations(root).find(c=>own(c,b.id))[b.id];if(revision(stored)!==b.expectedRevision)fail('REVISION_CONFLICT');if(old.type==='transfer'&&!b.confirmed)fail('TRANSFER_CONFIRMATION_REQUIRED',400);if(linked(old))fail('LINKED_MOVEMENT_REQUIRES_NATIVE_WORKFLOW');}
 let v,id=b.id||crypto.randomUUID();
 if(name==='finance_void'){
  root.voidedTransactions??={};v={...old,status:'void',voidedAt:now.getTime()};root.voidedTransactions[id]=v;
 }else{
  const input={...(old||{}),...(old?{amount:old.originalAmount??old.amount,currency:old.originalCurrency??old.currency}:{}),...(b.data||b.patch)},type=input.type;
  if(old&&b.patch?.currency&&b.patch.currency!==(old.originalCurrency??old.currency)&&!b.patch.exchangeRateToEUR)delete input.exchangeRateToEUR;
  validateDate(input.date,b.timezone,now);
  let accountId=input.accountId,fromAccountId=input.fromAccountId,toAccountId=input.toAccountId;
  let cat=input.categoryId||input.category||'';
  if(type!=='transfer'&&!accountId){
   const matching=safeRows(root.jarvisRules).map(([,r])=>r).filter(r=>String(input.title||'').toLocaleLowerCase().includes(r.match.toLocaleLowerCase()));
   if(matching.length===1){accountId=matching[0].accountId;cat=cat||matching[0].categoryId;}
   const configured=root.balance?.defaultAccountId;
   if(!accountId&&configured&&accounts[configured]&&currency(accounts[configured])===input.currency)accountId=configured;
   if(!accountId){const candidates=safeRows(accounts).filter(([,a])=>a.currency===input.currency&&a.disabled!==true&&a.archived!==true);if(candidates.length===1)accountId=candidates[0][0];else fail(candidates.length?'ACCOUNT_REQUIRED':'NO_COMPATIBLE_ACCOUNT',400);}
  }
  const account=accounts[type==='transfer'?fromAccountId:accountId];
  if(!account||account.disabled||account.archived)fail('ACCOUNT_NOT_FOUND',404);
  const sourceCurrency=currency(account);
  const crossCurrency=sourceCurrency!==input.currency;
  if(crossCurrency&&(!(input.accountAmount>0)||old&&b.patch?.amount!==undefined&&b.patch.accountAmount===undefined))fail('ACCOUNT_AMOUNT_REQUIRED',400);
  if(!crossCurrency&&b.data?.accountAmount!==undefined&&b.data.accountAmount!==input.amount)fail('ACCOUNT_AMOUNT_MISMATCH',400);
  const chargedAmount=crossCurrency?input.accountAmount:input.amount;
  if(type==='transfer'){
   if(crossCurrency)fail('TRANSFER_CURRENCY_MUST_MATCH_SOURCE',400);
   const dest=accounts[toAccountId];if(!dest||dest.disabled||dest.archived||fromAccountId===toAccountId)fail('INVALID_TRANSFER',400);
   const targetCurrency=currency(dest);
   if(targetCurrency!==sourceCurrency&&old&&b.patch?.amount!==undefined&&b.patch.destinationAmount===undefined)fail('DESTINATION_AMOUNT_REQUIRED',400);
   if(targetCurrency!==sourceCurrency&&!(input.destinationAmount>0))fail('DESTINATION_AMOUNT_REQUIRED',400);
   if(targetCurrency===sourceCurrency&&input.destinationAmount!==undefined&&input.destinationAmount!==input.amount)fail('SAME_CURRENCY_TRANSFER_AMOUNT_MISMATCH',400);
   input.destinationAmount=targetCurrency===sourceCurrency?input.amount:input.destinationAmount;
   input.destinationCurrency=targetCurrency;
  }else if(input.destinationAmount!==undefined||fromAccountId||toAccountId)fail('INVALID_MOVEMENT_FIELDS',400);
  cat=type==='transfer'?'':category(root,cat);
  const rate=input.currency==='EUR'?1:input.exchangeRateToEUR;
  if(!(rate>0))fail('EXCHANGE_RATE_TO_EUR_REQUIRED',400);
  v={...(old||{}),id,type,amount:chargedAmount,originalAmount:input.amount,originalCurrency:input.currency,inputCurrency:input.currency,currency:sourceCurrency,accountCurrency:sourceCurrency,accountAmount:chargedAmount,exchangeRateToEUR:rate,exchangeRateSource:input.currency==='EUR'?'EUR':input.exchangeRateSource||'user-supplied',exchangeRateDate:input.exchangeRateDate||input.date,convertedAmountEUR:Number((input.amount*rate).toFixed(2)),totalEUR:Number((input.amount*rate).toFixed(2)),date:input.date,dateISO:input.date,monthKey:input.date.slice(0,7),title:input.title||'',note:input.note||'',category:cat,categoryId:cat,accountId:type==='transfer'?'':accountId,fromAccountId:type==='transfer'?fromAccountId:'',toAccountId:type==='transfer'?toAccountId:'',allocation:{mode:'point',period:'day',anchorDate:input.date},createdAt:old?.createdAt||now.getTime(),updatedAt:now.getTime(),source:'jarvis'};
  v=business.canonicalMovement(old,v);
  if(type==='transfer'){v.destinationAmount=input.destinationAmount;v.destinationCurrency=input.destinationCurrency;}
  else{delete v.destinationAmount;delete v.destinationCurrency;}
 }
 // Canonicalize the edited record and remove every legacy copy atomically.
 for(const c of locations(root))delete c[id];
 if(name!=='finance_void'){root.transactions??={};root.transactions[id]=v;}
 const affected=new Set([old?.accountId,old?.fromAccountId,old?.toAccountId,v.accountId,v.fromAccountId,v.toAccountId].filter(Boolean));
 const from=[old?.date,v.date].filter(Boolean).sort()[0];
 for(const aid of affected){
  const a=accounts[aid];if(!a)fail('ACCOUNT_NOT_FOUND',404);
  for(const r of rows(root).filter(r=>[r.accountId,r.fromAccountId,r.toAccountId].includes(aid))){
   if(!['income','expense','transfer'].includes(r.type)||!Number.isFinite(Number(r.amount))||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))fail('UNSUPPORTED_LEGACY_MOVEMENT_REQUIRES_NATIVE_WORKFLOW');
   if(!r.source&&r.accountAmount!==undefined&&Number(r.accountAmount)!==Number(r.amount))fail('IMPORTED_MOVEMENT_REQUIRES_NATIVE_WORKFLOW');
  }
  const changes=business.buildEntries(root,aid,from,{rows:rows(root),now:now.getTime(),deltaAmount:r=>Number(r.amount??0)});
  a.entries??={};for(const [path,value] of Object.entries(changes)){if(path.startsWith('entries/'))a.entries[path.slice(8)]=value;else a[path]=value;}
 }
 return {item:item(id,v),warnings:!v.category&&v.type!=='transfer'?['Movimiento sin categoría; no se ha inventado una.']:[]};
}
module.exports={run,rows,rootOf};
