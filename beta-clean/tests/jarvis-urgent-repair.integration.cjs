const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
let f,mcp;const key=()=>crypto.randomUUID();
async function call(name,args){const r=await mcp.callTool({name,arguments:args});assert.ok(!r.isError,JSON.stringify(r));return r.structuredContent.result;}
async function reject(name,args,pattern){const r=await mcp.callTool({name,arguments:args});assert.ok(r.isError);assert.match(JSON.stringify(r),pattern);}
test.before(async()=>{f=await require('./qa-phase2-fixture.cjs').createFixture();mcp=(await f.mcp([...f.scopes,...new Set(Object.values(require('../jarvis/module-contracts').scopes).flat())])).client;});
test.after(async()=>{await f?.close();});
test('create missing strawberry yogurt, consume exact 90g, retain unknown carbs and immutable history',async()=>{
 const p={name:'QA Yogur de fresa',baseQuantity:90,baseUnit:'g',macros:{kcal:78.3,fat:2.52,protein:2.7,carbs:null},notes:'Usuario: valores aportados para 90 g, marca desconocida'};
 assert.equal((await call('nutrition_query',{collection:'products',query:p.name})).total,0);
 const input={data:p,idempotencyKey:key()},[a,b]=await Promise.all([call('nutrition_product_create',input),call('nutrition_product_create',input)]);
 assert.equal(a.item.id,b.item.id);assert.equal(a.item.data.macros.carbs,null);assert.equal(a.item.data.brand,undefined);
 await reject('nutrition_product_create',{data:{...p,name:'QA YOGUR DE FRESA'},idempotencyKey:key()},/PRODUCT_ALREADY_EXISTS/);
 const product=a.item,consume={data:{kind:'product',productId:product.id,amount:90,unit:'g',date:'2026-02-01',meal:'breakfast'},idempotencyKey:key()};
 const e=(await call('nutrition_entry_create',consume)).item;assert.equal((await call('nutrition_entry_create',consume)).item.id,e.id);
 assert.deepEqual(e.data.entry.macrosSnapshot,{carbs:null,protein:2.7,fat:2.52,kcal:78.3});
 const edited=(await call('nutrition_product_update',{id:product.id,expectedRevision:product.revision,patch:{macros:{protein:3,carbs:0}},idempotencyKey:key()})).item;
 assert.equal(edited.data.macros.kcal,78.3);assert.equal(edited.data.macros.carbs,0);
 await reject('nutrition_product_update',{id:product.id,expectedRevision:product.revision,patch:{name:'stale'},idempotencyKey:key()},/REVISION_CONFLICT/);
 const corrected=(await call('nutrition_entry_update',{id:e.id,expectedRevision:e.revision,patch:{amount:180},idempotencyKey:key()})).item;
 assert.equal(corrected.data.entry.macrosSnapshot.kcal,156.6);assert.equal(corrected.data.entry.macrosSnapshot.protein,5.4);assert.equal(corrected.data.entry.macrosSnapshot.carbs,null);
 const summary=(await call('nutrition_query',{collection:'dailyLogsByDate',from:'2026-02-01',to:'2026-02-01'})).summary;
 assert.equal(summary.knownMacros.kcal,156.6);assert.equal(summary.complete,false);
});
test('synthetic Migros CHF with legacy accounts and snapshots creates once and preserves balances',async()=>{
 const d=(await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;
 d.finance={finance:{accounts:{post:{name:'QA PostFinance',currency:'CHF',entries:{'2026-02-01':{value:6773.25,source:'snapshot'}},snapshots:{'2026-02-01':{value:6773.25,updatedAt:1}}}},catalog:{categories:{Comida:{name:'Comida'}}},balance:{movements:{'2026-01':{legacy:{type:'gasto',amount:2,accountId:'post',date:'2026-01-31'}}}}}};
 await f.pool.query('UPDATE firebase_import_raw SET data=$1 WHERE user_id=$2',[d,f.owner]);
 assert.equal((await call('finance_preferences',{})).accounts[0].currency,'CHF');
 const input={data:{type:'expense',amount:11.35,currency:'CHF',date:'2026-02-02',accountId:'post',categoryId:'Comida',title:'QA compra en Migros',note:'Coca-Cola 1,5 L, Monster, pizza y mandarinas',exchangeRateToEUR:1.05,exchangeRateSource:'synthetic QA'},idempotencyKey:key()};
 const v=(await call('finance_create',input)).item;assert.equal((await call('finance_create',input)).item.id,v.id);
 const q=await call('finance_query',{collection:'transactions',query:'QA compra en Migros'});assert.equal(q.total,1);assert.equal(q.items[0].data.originalAmount,11.35);
 const stored=(await f.pool.query('SELECT data FROM firebase_import_raw WHERE user_id=$1',[f.owner])).rows[0].data;
 assert.equal(stored.finance.finance.accounts.post.entries['2026-02-02'].value,6761.9);assert.equal(stored.finance.finance.accounts.post.entries['2026-02-01'].value,6773.25);
});
