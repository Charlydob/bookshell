'use strict';
// Same provider as the native web currency resolver; never use its static fallback rates.
async function quote(currency,date,fetchFn=fetch){
 if(currency==='EUR')return {currency,date,rate:1,source:'EUR',referenceDate:date,approximate:false};
 const url=`https://api.frankfurter.dev/v2/rate/${currency.toLowerCase()}/eur?date=${encodeURIComponent(date)}&providers=ecb`;
 let d;try{const r=await fetchFn(url,{signal:AbortSignal.timeout(5000),redirect:'error'});if(!r.ok)throw new Error('FX');d=await r.json();}catch{throw Object.assign(new Error('EXCHANGE_RATE_UNAVAILABLE'),{status:503});}
 if(d.base!==currency||d.quote!=='EUR'||!(typeof d.rate==='number'&&Number.isFinite(d.rate)&&d.rate>0)||!/^\d{4}-\d{2}-\d{2}$/.test(d.date)||d.date>date||Date.parse(date)-Date.parse(d.date)>7*86400000)throw Object.assign(new Error('EXCHANGE_RATE_UNVERIFIED'),{status:503});
 return {currency,date,rate:d.rate,source:'Frankfurter/ECB',referenceDate:d.date,approximate:true};
}
module.exports={quote};
