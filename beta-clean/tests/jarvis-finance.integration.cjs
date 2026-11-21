'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let f,mcp;const key=()=>crypto.randomUUID();
async function call(name,args,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function reject(name,args,pattern,c=mcp){const r=await c.callTool({name,arguments:args});assert.ok(r.isError,JSON.stringify(r));assert.match(JSON.stringify(r),pattern);}
async function stored(){return (await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;}
async function reset(extra={}){const d=await stored();d.finance={finance:{accounts:{eur:{name:'QA Euros',currency:'EUR',entries:{'2026-01-01':{value:1000}}},chf:{name:'QA Francs',currency:'CHF',entries:{'2026-01-01':{value:500}}}},catalog:{categories:{food:{name:'Supermercado'}}},transactions:{},...extra}};await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);}
const expense=(over={})=>({type:'expense',amount:12,currency:'EUR',date:'2026-02-01',title:'QA Supermercado',categoryId:'food',...over});
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();mcp=(await f.mcp([...f.scopes,...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())])).client;});
test.after(async()=>{await f?.close();});
test.beforeEach(async()=>reset());
test('read, create, correct and void native movement; revisions, balances, concurrent retry and archived history persist',async()=>{
 assert.equal((await call('finance_quote',{currency:'EUR',date:'2026-02-01'})).rate,1);
 const pref=await call('finance_preferences',{});assert.equal(pref.accounts.length,2);
 const input={data:expense(),idempotencyKey:key()};const [r,retry]=await Promise.all([call('finance_create',input),call('finance_create',input)]);let v=r.item;assert.equal(v.id,retry.item.id);
 let root=(await stored()).finance.finance;assert.equal(Object.keys(root.transactions).length,1);assert.equal(root.accounts.eur.entries['2026-02-01'].value,988);
 const stale=v.revision;
 v=(await call('finance_update',{id:v.id,expectedRevision:v.revision,patch:{amount:20,date:'2026-01-15'},idempotencyKey:key()})).item;
 root=(await stored()).finance.finance;assert.equal(root.accounts.eur.entries['2026-02-01'].value,980);assert.equal(root.accounts.eur.entries['2026-01-15'].value,980);
 await reject('finance_update',{id:v.id,expectedRevision:stale,patch:{amount:3},idempotencyKey:key()},/REVISION_CONFLICT/);
 const q=await call('finance_query',{collection:'transactions',from:'2026-01-01',to:'2026-01-31'});assert.equal(q.items[0].id,v.id);assert.equal(q.items[0].revision,v.revision);
 await reject('finance_void',{id:v.id,expectedRevision:v.revision,idempotencyKey:key()},/confirmed/);
 await call('finance_void',{id:v.id,expectedRevision:v.revision,confirmed:true,idempotencyKey:key()});
 root=(await stored()).finance.finance;assert.equal(root.transactions[v.id],undefined);assert.equal(root.accounts.eur.entries['2026-02-01'].value,1000);assert.equal(root.voidedTransactions[v.id].status,'void');
 assert.equal((await call('finance_query',{collection:'voidedTransactions'})).items.length,1);
});
test('ambiguous accounts, explicit authorized rule, default account and income do not invent entities',async()=>{
 await reset({accounts:{a:{name:'A',currency:'EUR'},b:{name:'B',currency:'EUR'}}});
 await reject('finance_create',{data:expense(),idempotencyKey:key()},/ACCOUNT_REQUIRED/);
 await call('finance_rule_set',{id:'groceries',match:'supermercado',accountId:'b',categoryId:'food',confirmed:true,idempotencyKey:key()});
 const pref=await call('finance_preferences',{});assert.match(pref.rules.groceries.revision,/^[a-f0-9]{64}$/);
 const v=(await call('finance_create',{data:expense(),idempotencyKey:key()})).item;assert.equal(v.data.accountId,'b');assert.equal(v.data.category,'food');
 await reject('finance_rule_set',{id:'groceries',match:'market',accountId:'a',confirmed:true,idempotencyKey:key()},/REVISION_CONFLICT/);
 await reset({balance:{defaultAccountId:'eur'}});
 const income=(await call('finance_create',{data:expense({type:'income',amount:100,title:'QA Income'}),idempotencyKey:key()})).item;assert.equal(income.data.accountId,'eur');assert.equal((await stored()).finance.finance.accounts.eur.entries['2026-02-01'].value,1100);
});
test('cross currency transfer records both amounts and reverses both sides; missing rates fail atomically',async()=>{
 const transfer={type:'transfer',amount:100,currency:'EUR',fromAccountId:'eur',toAccountId:'chf',destinationAmount:95,date:'2026-02-01',title:'QA Exchange'};
 let v=(await call('finance_transfer',{data:transfer,confirmed:true,idempotencyKey:key()})).item;
 let root=(await stored()).finance.finance;assert.equal(root.accounts.eur.entries['2026-02-01'].value,900);assert.equal(root.accounts.chf.entries['2026-02-01'].value,595);
 v=(await call('finance_transfer_update',{id:v.id,expectedRevision:v.revision,patch:{amount:200,destinationAmount:190},confirmed:true,idempotencyKey:key()})).item;
 root=(await stored()).finance.finance;assert.equal(root.accounts.eur.entries['2026-02-01'].value,800);assert.equal(root.accounts.chf.entries['2026-02-01'].value,690);
 await call('finance_void',{id:v.id,expectedRevision:v.revision,confirmed:true,idempotencyKey:key()});root=(await stored()).finance.finance;assert.equal(root.accounts.chf.entries['2026-02-01'].value,500);
 const before=await stored();
 await reject('finance_transfer',{data:{...transfer,destinationAmount:undefined},confirmed:true,idempotencyKey:key()},/DESTINATION_AMOUNT_REQUIRED/);
 await reject('finance_create',{data:expense({currency:'CHF',accountId:'chf'}),idempotencyKey:key()},/EXCHANGE_RATE_TO_EUR_REQUIRED/);
 assert.deepEqual(await stored(),before);
 const chf=(await call('finance_create',{data:expense({currency:'CHF',exchangeRateToEUR:1.05}),idempotencyKey:key()})).item;assert.equal(chf.data.accountId,'chf');assert.equal(chf.data.originalAmount,12);assert.equal(chf.data.totalEUR,12.6);
});
test('scope, ownership, idempotency conflict, future dates and unknown categories reject without writes',async()=>{
 const read=(await f.mcp(['finance:read'])).client,other=(await f.mcp(['finance:read','finance:write'],f.other)).client;
 const input={data:expense(),idempotencyKey:key()};
 await reject('finance_create',input,/insufficient_scope/i,read);
 let v=(await call('finance_create',input)).item;
 await reject('finance_create',{...input,data:expense({amount:13})},/IDEMPOTENCY_CONFLICT/);
 await reject('finance_update',{id:v.id,expectedRevision:v.revision,patch:{amount:2},idempotencyKey:key()},/ENTITY_NOT_FOUND/,other);
 const before=await stored();
 for(const data of [expense({date:'2999-01-01'}),expense({categoryId:'missing'}),expense({accountId:'missing'}),expense({date:'2026-02-30'})])await reject('finance_create',{data,idempotencyKey:key()},/FUTURE_MOVEMENT|CATEGORY_NOT_FOUND|ACCOUNT_NOT_FOUND|Invalid input|custom/);
 assert.deepEqual(await stored(),before);
});
test('legacy correction migrates canonical row, preserves baseline and refuses linked side effects',async()=>{
 const old={id:'old',...expense({accountId:'eur'}),createdAt:1};
 await reset({balance:{movements:{'2026-02':{old}}}});
 let v=(await call('finance_query',{collection:'transactions',id:'old'})).items[0];
 v=(await call('finance_update',{id:'old',expectedRevision:v.revision,patch:{amount:8},idempotencyKey:key()})).item;
 const root=(await stored()).finance.finance;assert.equal(root.balance.movements['2026-02'].old,undefined);assert.equal(root.transactions.old.amount,8);
 await reset({transactions:{old:{...old,linkedHabitId:'synthetic'}}});v=(await call('finance_query',{collection:'transactions',id:'old'})).items[0];
 await reject('finance_update',{id:'old',expectedRevision:v.revision,patch:{amount:4},idempotencyKey:key()},/LINKED_MOVEMENT_REQUIRES_NATIVE_WORKFLOW/);
});
test('ledger persistence failure rolls back movement and both account projections',async()=>{
 await f.pool.query("CREATE FUNCTION reject_finance_ledger() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.operation='finance_create' THEN RAISE EXCEPTION 'injected finance ledger failure'; END IF; RETURN NEW; END $$; CREATE TRIGGER reject_finance_ledger BEFORE INSERT ON jarvis_operations FOR EACH ROW EXECUTE FUNCTION reject_finance_ledger()");
 const before=await stored();
 await reject('finance_create',{data:expense(),idempotencyKey:key()},/Internal|injected|error/i);
 assert.deepEqual(await stored(),before);
 await f.pool.query('DROP TRIGGER reject_finance_ledger ON jarvis_operations');
});

test('foreign currency expense preserves original and charged amounts through correction and void',async()=>{
 const data=expense({currency:'CHF',accountId:'eur',amount:12,accountAmount:12.6,exchangeRateToEUR:1.05,exchangeRateSource:'QA explicit',exchangeRateDate:'2026-02-01'});
 let v=(await call('finance_create',{data,idempotencyKey:key()})).item;
 assert.equal(v.data.originalCurrency,'CHF');assert.equal(v.data.currency,'EUR');assert.equal(v.data.originalAmount,12);assert.equal(v.data.amount,12.6);
 assert.equal((await stored()).finance.finance.accounts.eur.entries['2026-02-01'].value,987.4);
 await reject('finance_update',{id:v.id,expectedRevision:v.revision,patch:{amount:20},idempotencyKey:key()},/ACCOUNT_AMOUNT_REQUIRED/);
 v=(await call('finance_update',{id:v.id,expectedRevision:v.revision,patch:{amount:20,accountAmount:21},idempotencyKey:key()})).item;
 assert.equal(v.data.originalAmount,20);assert.equal(v.data.amount,21);assert.equal((await stored()).finance.finance.accounts.eur.entries['2026-02-01'].value,979);
 await call('finance_void',{id:v.id,expectedRevision:v.revision,confirmed:true,idempotencyKey:key()});assert.equal((await stored()).finance.finance.accounts.eur.entries['2026-02-01'].value,1000);
});
