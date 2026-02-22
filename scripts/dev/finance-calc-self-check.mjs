import { buildAccountSeries, calcDelta } from '../finance-calc.js';

const accounts = {
  a: { includedInTotal: true, type: 'cash' },
  b: { includedInTotal: true, type: 'debt' }
};
const snapshots = {
  a: { '2026-01-01': { value: 100 }, '2026-01-31': { value: 150 } },
  b: { '2026-01-01': { value: 20 }, '2026-01-31': { value: 10 } }
};

const totalSeries = buildAccountSeries(accounts, snapshots, 'total');
if (!totalSeries.length) throw new Error('Series vacía');
const d = calcDelta(totalSeries, 'month');
if (d.current !== 140) throw new Error(`Current esperado 140, recibido ${d.current}`);
console.log('finance-calc self-check OK');
