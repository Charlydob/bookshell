/* Native finance projection shared by the web editor and MCP. No IO. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BookshellFinance=api;})(globalThis,function(){
'use strict';
function normalizeType(type = '') {
  const safe = String(type || '').trim().toLowerCase();
  if (safe === 'ingreso' || safe === 'ingresos') return 'income';
  if (safe === 'gasto' || safe === 'gastos' || safe === 'egreso' || safe === 'egresos') return 'expense';
  if (safe === 'transferencia' || safe === 'traspaso') return 'transfer';
  if (safe === 'income' || safe === 'expense' || safe === 'transfer') return safe;
  if (safe === 'invest') return 'expense';
  return 'expense';
}
function canonicalMovement(previous,fields){
 const value={...(previous||{}),...fields};
 value.monthKey=String(value.date||'').slice(0,7);
 value.accountId=value.type==='transfer'?'':String(value.accountId||'');
 value.fromAccountId=value.type==='transfer'?String(value.fromAccountId||''):'';
 value.toAccountId=value.type==='transfer'?String(value.toAccountId||''):'';
 return value;
}
function movementDelta(row,accountId){
 if(row.type==='transfer')return (row.toAccountId===accountId?Number(row.destinationAmount??row.amount):0)-(row.fromAccountId===accountId?Number(row.amount):0);
 return row.accountId===accountId?(row.type==='expense'?-1:row.type==='income'?1:0)*Number(row.amount):0;
}
function buildEntries(root, accountId, fromDay, {rows, now, deltaAmount}) {
  if (!accountId) return {};
  const account = root.accounts?.[accountId];
  if (!account) return {};
  const snapshots = Object.entries(account.snapshots || {}).map(([day,s])=>({day,value:Number(s.value),updatedAt:Number(s.updatedAt||0)})).filter(s=>Number.isFinite(s.value)).sort((a,b)=>a.day.localeCompare(b.day));
  const txRows = rows.filter((row) => (
    row.accountId === accountId || row.fromAccountId === accountId || row.toAccountId === accountId
  ));
  const movements = txRows.sort((a, b) => String(a.date||a.dateISO).localeCompare(String(b.date||b.dateISO)) || Number(a.createdAt||0)-Number(b.createdAt||0));
  const daySet = new Set([
    ...Object.keys(account.entries || account.daily || {}),
    ...snapshots.map((row) => row.day),
    ...movements.map((row) => String(row.date || String(row.dateISO||'').slice(0,10)))
  ].filter(Boolean));
  if (fromDay) daySet.add(fromDay);
  const allDays = [...daySet].sort();
  if (!allDays.length) return {};
  const normalizedFromDay = fromDay;
  const startDay = normalizedFromDay || allDays[0];

  const dayEvents = {};
  movements.forEach((row) => {
    const day = String(row.date || String(row.dateISO||'').slice(0,10));
    if (!day) return;
    let delta = 0;
    const accountDeltaAmount = deltaAmount(row, accountId);
    if (row.type === 'income' && row.accountId === accountId) delta = accountDeltaAmount;
    else if (row.type === 'expense' && row.accountId === accountId) delta = -accountDeltaAmount;
    else if (row.type === 'transfer') {
      if (row.fromAccountId === accountId) delta = -Number(row.amount || 0);
      if (row.toAccountId === accountId) delta += Number(row.destinationAmount ?? row.amount ?? 0);
    }
    if (!delta) return;
    if (!dayEvents[day]) dayEvents[day] = [];
    const ts = Number(row.ts || row.timestamp || row.createdAt || row.updatedAt || 0);
    dayEvents[day].push({ kind: 'tx', ts: Number.isFinite(ts) ? ts : 0, delta });
  });
  snapshots.forEach((row) => {
    if (!dayEvents[row.day]) dayEvents[row.day] = [];
    const ts = Number(row.updatedAt || 0);
    dayEvents[row.day].push({ kind: 'snapshot', ts: Number.isFinite(ts) && ts > 0 ? ts : Number.MAX_SAFE_INTEGER, value: row.value });
  });

  const existingEntries = account.entries || account.daily || {};
  let carry = 0;
  const prevDays = Object.keys(existingEntries).filter((day) => day < startDay).sort();
  if (prevDays.length) carry = Number(existingEntries[prevDays.at(-1)]?.value || 0);
  else {
    const prevSnapshot = snapshots.filter((row) => row.day < startDay).at(-1);
    if (prevSnapshot) carry = prevSnapshot.value;
  }

  const updatesMap = {};
  const targetDays = allDays.filter((day) => day >= startDay);
  targetDays.forEach((day) => {
    let value = carry;
    const events = (dayEvents[day] || []).sort((a, b) => {
      if (a.ts !== b.ts) return a.ts - b.ts;
      if (a.kind === b.kind) return 0;
      return a.kind === 'tx' ? -1 : 1;
    });
    if (!events.length) {
      value = carry;
    } else {
      events.forEach((event) => {
        if (event.kind === 'snapshot') value = Number(event.value || 0);
        else value += Number(event.delta || 0);
      });
    }
    value = Number(value.toFixed(8));
    carry = value;
    updatesMap[`entries/${day}`] = {
      dateISO: `${day}T00:00:00.000Z`,
      value,
      updatedAt: now,
      source: events.some((event) => event.kind === 'snapshot') ? 'snapshot' : 'derived'
    };
  });
  updatesMap['updatedAt'] = now;
  return updatesMap;
}

return {buildEntries,movementDelta,canonicalMovement,normalizeType};
});
