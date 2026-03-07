const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

function toDateTs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const t = new Date(String(value || '')).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function startOfDay(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function getCurrentDayRange(now = new Date()) {
  const start = startOfDay(now);
  const end = new Date(start.getTime() + 86400000 - 1);
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

export function getCurrentWeekRange(now = new Date()) {
  const dayStart = startOfDay(now);
  const day = dayStart.getDay();
  const diffToMonday = day === 0 ? 6 : day - 1;
  const start = new Date(dayStart.getTime() - diffToMonday * 86400000);
  const end = new Date(dayStart.getTime() + (6 - diffToMonday) * 86400000 + 86400000 - 1);
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

export function getCurrentMonthRange(now = new Date()) {
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

export function getCurrentYearRange(now = new Date()) {
  const start = new Date(now.getFullYear(), 0, 1);
  const end = new Date(now.getFullYear(), 11, 31, 23, 59, 59, 999);
  return { start, end, startMs: start.getTime(), endMs: end.getTime() };
}

function getRangeBounds(range = 'week', now = new Date()) {
  if (range === 'day') return getCurrentDayRange(now);
  if (range === 'week') return getCurrentWeekRange(now);
  if (range === 'month') return getCurrentMonthRange(now);
  if (range === 'year') return getCurrentYearRange(now);
  return { start: null, end: null, startMs: Number.NEGATIVE_INFINITY, endMs: Number.POSITIVE_INFINITY };
}

function getFinanceRoot(snapshot = {}) {
  return snapshot.finance?.finance || snapshot.finance || {};
}

function clampRatio(value, fallback = 1) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return fallback;
  return Math.min(1, Math.max(0.1, ratio));
}

function clamp01(value, fallback = 1) {
  const ratio = Number(value);
  if (!Number.isFinite(ratio)) return fallback;
  return Math.min(1, Math.max(0, ratio));
}

function parseDayKey(key = '') {
  const safe = String(key || '').slice(0, 10);
  const t = new Date(`${safe}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : NaN;
}

function closePointBefore(series, tsExclusive) {
  for (let i = series.length - 1; i >= 0; i -= 1) {
    if (series[i].ts < tsExclusive) return series[i];
  }
  return null;
}

function balanceDeltaByBounds(series, startTs, endTsExclusive) {
  const prev = closePointBefore(series, startTs);
  const end = closePointBefore(series, endTsExclusive);
  if (!prev && !end) return 0;
  const startValue = Number(prev?.value ?? end?.value ?? 0);
  const endValue = Number(end?.value ?? startValue);
  return endValue - startValue;
}

function accountShareRatio(acc = {}, scope = 'my') {
  if (scope === 'total') return 1;
  if (acc?.shared) return clampRatio(acc?.sharedRatio, 0.5);
  return 1;
}

function buildAccountDayMap(acc = {}) {
  const entriesNode = acc?.entries && typeof acc.entries === 'object' ? acc.entries : null;
  const snapshotsNode = acc?.snapshots && typeof acc.snapshots === 'object' ? acc.snapshots : null;
  const source = (entriesNode && Object.keys(entriesNode).length)
    ? entriesNode
    : (snapshotsNode && Object.keys(snapshotsNode).length ? snapshotsNode : null);
  if (!source) return {};

  const map = {};
  Object.entries(source).forEach(([dayKey, row]) => {
    const day = String(dayKey || '').slice(0, 10);
    const value = toNum(row?.value ?? row?.balance);
    if (!day || !Number.isFinite(value)) return;
    map[day] = value;
  });
  return map;
}

function buildTotalBalanceSeries(snapshot = {}, scope = 'my') {
  const finance = getFinanceRoot(snapshot);
  const accounts = finance.accounts || {};
  const accountList = Array.isArray(accounts) ? accounts : values(accounts);
  const perAcc = accountList.map((acc) => {
    return { id: acc?.id || '', ratio: accountShareRatio(acc, scope), byDay: buildAccountDayMap(acc) };
  }).filter((row) => row.id && row.byDay && Object.keys(row.byDay).length);

  const daySet = new Set();
  perAcc.forEach((row) => Object.keys(row.byDay).forEach((d) => daySet.add(d)));
  const days = [...daySet].sort();
  if (!days.length) return [];

  const running = Object.fromEntries(perAcc.map((row) => [row.id, 0]));
  return days.map((day) => {
    perAcc.forEach((row) => {
      const v = row.byDay[day];
      if (v != null) running[row.id] = toNum(v) * row.ratio;
    });
    const total = perAcc.reduce((sum, row) => sum + toNum(running[row.id]), 0);
    return { day, ts: parseDayKey(day), value: total };
  }).filter((p) => Number.isFinite(p.ts));
}

function normalizeTxType(type = '') {
  const safe = String(type || '').trim().toLowerCase();
  if (safe === 'ingreso' || safe === 'ingresos') return 'income';
  if (safe === 'gasto' || safe === 'gastos' || safe === 'egreso' || safe === 'egresos' || safe === 'invest') return 'expense';
  if (safe === 'transferencia' || safe === 'traspaso') return 'transfer';
  if (safe === 'income' || safe === 'expense' || safe === 'transfer') return safe;
  return 'expense';
}

function personalRatioForTx(tx = {}, accountsById = {}) {
  if (tx?.personalRatio !== null && tx?.personalRatio !== undefined && String(tx.personalRatio).trim() !== '' && Number.isFinite(Number(tx.personalRatio))) {
    return clamp01(tx.personalRatio, 1);
  }
  const account = accountsById?.[tx?.accountId];
  if (!account?.shared) return 1;
  const type = normalizeTxType(tx?.type);
  if (type === 'expense') return clampRatio(account?.sharedRatio, 0.5);
  if (type === 'income') return 0;
  return 0;
}

export function computeResources(snapshot = {}, range = 'week', scope = 'my') {
  const finance = getFinanceRoot(snapshot);
  const accounts = finance.accounts || {};
  const accountList = Array.isArray(accounts) ? accounts : values(accounts);
  const accountsById = Object.fromEntries(accountList.map((acc) => [acc?.id, acc]));

  const accountBalanceByScope = (acc = {}) => {
    const baseBalance = Number.isFinite(Number(acc?.balance))
      ? toNum(acc.balance)
      : (() => {
          const snaps = Object.entries(acc?.snapshots || {}).map(([day, row]) => {
            const ts = toDateTs(row?.ts || row?.createdAt || row?.updatedAt || day);
            return { ts, value: toNum(row?.value ?? row?.balance) };
          }).filter((row) => Number.isFinite(row.ts));
          const last = snaps.sort((a, b) => a.ts - b.ts).at(-1);
          return last ? toNum(last.value) : 0;
        })();
    if (scope === 'total') return baseBalance;
    if (acc?.shared) return baseBalance * clampRatio(acc?.sharedRatio, 0.5);
    return baseBalance;
  };

  const gold = accountList.reduce((sum, acc) => {
    return sum + accountBalanceByScope(acc);
  }, 0);

  const transactions = finance.balance?.transactions || finance.transactions || finance.balance?.tx || {};
  const bounds = getRangeBounds(range);
  const txList = values(transactions).filter((tx) => {
    const t = toDateTs(tx?.ts || tx?.dateISO || tx?.date || tx?.createdAt || tx?.updatedAt || 0);
    return Number.isFinite(t) && t >= bounds.startMs && t <= bounds.endMs;
  });

  const signed = (tx) => {
    const amount = Math.abs(toNum(tx?.amount));
    const type = normalizeTxType(tx?.type);
    if (scope === 'total') return type === 'income' ? amount : type === 'expense' ? -amount : toNum(tx?.signedAmount);
    const ratio = personalRatioForTx(tx, accountsById);
    if (type === 'income') return ratio > 0.99 ? amount : 0;
    if (type === 'expense') return -amount * ratio;
    return 0;
  };

  const income = txList.reduce((acc, tx) => {
    const type = normalizeTxType(tx?.type);
    if (type !== 'income') return acc;
    const amount = Math.abs(toNum(tx?.amount));
    if (scope === 'total') return acc + amount;
    const ratio = personalRatioForTx(tx, accountsById);
    return acc + (ratio > 0.99 ? amount : 0);
  }, 0);

  const expense = txList.reduce((acc, tx) => {
    const type = normalizeTxType(tx?.type);
    if (type !== 'expense') return acc;
    const amount = Math.abs(toNum(tx?.amount));
    if (scope === 'total') return acc + amount;
    return acc + amount * personalRatioForTx(tx, accountsById);
  }, 0);

  return {
    gold,
    range,
    scope,
    delta: txList.reduce((acc, tx) => acc + signed(tx), 0),
    income,
    expense
  };
}

export function computeFinanceBalanceDelta(snapshot = {}, range = 'day', scope = 'my') {
  if (range !== 'day') return 0;
  const series = buildTotalBalanceSeries(snapshot, scope);
  if (!series.length) return 0;
  const bounds = getCurrentDayRange(new Date());
  const endExclusive = (Number(bounds.endMs) || 0) + 1;
  return balanceDeltaByBounds(series, Number(bounds.startMs) || 0, endExclusive);
}

export function computeWorldStats(snapshot = {}) {
  const tripVisits = values(snapshot.trips?.visits || snapshot.trips?.places || snapshot.trips?.entries || {});
  const worldVisits = values(snapshot.world?.visits || snapshot.world?.places || {});
  let localVisits = [];
  try { localVisits = JSON.parse(localStorage.getItem('world_visits_v1') || '[]') || []; } catch (_) { localVisits = []; }
  const visits = tripVisits.length ? tripVisits : (worldVisits.length ? worldVisits : localVisits);
  const countries = new Set();
  const cities = new Set();
  const places = new Set();
  visits.forEach((v) => {
    if (v?.countryCode || v?.country || v?.code) countries.add(String(v.countryCode || v.country || v.code).toUpperCase());
    if (v?.city || v?.town || v?.municipality) cities.add(String(v.city || v.town || v.municipality));
    if (v?.placeName || v?.label || v?.name) places.add(String(v.placeName || v.label || v.name));
  });
  return { countries: countries.size, cities: cities.size, places: places.size, visits: visits.length };
}
