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

export function computeResources(snapshot = {}, range = 'week') {
  const finance = getFinanceRoot(snapshot);
  const accounts = finance.accounts || {};
  const accountList = Array.isArray(accounts) ? accounts : values(accounts);
  const gold = accountList.reduce((sum, acc) => {
    if (Number.isFinite(Number(acc?.balance))) return sum + toNum(acc.balance);
    const snaps = values(acc?.snapshots || {});
    const last = snaps.sort((a, b) => toNum(a?.ts || a?.createdAt) - toNum(b?.ts || b?.createdAt)).at(-1);
    if (last) return sum + toNum(last?.value || last?.balance);
    return sum;
  }, 0);

  const transactions = finance.balance?.transactions || finance.transactions || finance.balance?.tx || {};
  const bounds = getRangeBounds(range);
  const txList = values(transactions).filter((tx) => {
    const t = toDateTs(tx?.ts || tx?.dateISO || tx?.date || tx?.createdAt || tx?.updatedAt || 0);
    return Number.isFinite(t) && t >= bounds.startMs && t <= bounds.endMs;
  });

  const signed = (tx) => {
    const amount = Math.abs(toNum(tx?.amount));
    const type = String(tx?.type || '').toLowerCase();
    return type === 'income' ? amount : type === 'expense' ? -amount : toNum(tx?.signedAmount);
  };

  return {
    gold,
    range,
    delta: txList.reduce((acc, tx) => acc + signed(tx), 0),
    income: txList.reduce((acc, tx) => acc + (String(tx?.type || '').toLowerCase() === 'income' ? Math.abs(toNum(tx?.amount)) : 0), 0),
    expense: txList.reduce((acc, tx) => acc + (String(tx?.type || '').toLowerCase() === 'expense' ? Math.abs(toNum(tx?.amount)) : 0), 0)
  };
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
