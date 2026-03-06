const DAY = 86400000;
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

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
  const days = { day: 1, week: 7, month: 31, year: 365, total: Number.MAX_SAFE_INTEGER }[range] || 7;
  const min = Date.now() - days * DAY;
  const txList = values(transactions).filter((tx) => {
    const t = new Date(String(tx?.dateISO || tx?.date || tx?.createdAt || 0)).getTime();
    return Number.isFinite(t) && (range === 'total' || t >= min);
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
  const visits = values(snapshot.trips?.visits || snapshot.trips?.places || snapshot.trips?.entries || {});
  const countries = new Set();
  const cities = new Set();
  visits.forEach((v) => {
    if (v?.countryCode) countries.add(String(v.countryCode).toUpperCase());
    if (v?.city || v?.placeName || v?.label) cities.add(String(v.city || v.placeName || v.label));
  });
  return { countries: countries.size, cities: cities.size, visits: visits.length };
}
