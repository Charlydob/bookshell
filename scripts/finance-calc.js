export const RANGE_PRESETS = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
  total: null
};

export function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toTs(key) {
  return new Date(`${key}T12:00:00`).getTime();
}

function sortedSnapshotKeys(snapshotsByDate = {}) {
  return Object.keys(snapshotsByDate).sort((a, b) => toTs(a) - toTs(b));
}

export function findSnapshotAtOrBefore(snapshotsByDate = {}, targetDateKey) {
  const keys = sortedSnapshotKeys(snapshotsByDate);
  const target = toTs(targetDateKey);
  let best = null;
  for (const key of keys) {
    const ts = toTs(key);
    if (ts <= target) best = { date: key, value: Number(snapshotsByDate[key]?.value ?? snapshotsByDate[key] ?? 0) };
    if (ts > target) break;
  }
  return best;
}

export function rangeBounds(range, allDates = []) {
  const dates = [...allDates].sort((a, b) => toTs(a) - toTs(b));
  const end = dates[dates.length - 1] || dateKey();
  if (range === 'total') return { start: dates[0] || end, end };
  const days = RANGE_PRESETS[range] || 30;
  const endDate = new Date(`${end}T12:00:00`);
  const startDate = new Date(endDate);
  startDate.setDate(endDate.getDate() - (days - 1));
  return { start: dateKey(startDate), end };
}

export function buildAccountSeries(accounts, snapshots, accountId = 'total') {
  const dateSet = new Set();
  Object.values(snapshots || {}).forEach(byDate => Object.keys(byDate || {}).forEach(d => dateSet.add(d)));
  const dates = [...dateSet].sort((a, b) => toTs(a) - toTs(b));

  if (accountId !== 'total') {
    return dates.map(d => ({ date: d, value: Number(findSnapshotAtOrBefore(snapshots[accountId] || {}, d)?.value ?? 0) }));
  }

  return dates.map(d => {
    let total = 0;
    Object.entries(accounts || {}).forEach(([id, acc]) => {
      if (!acc?.includedInTotal) return;
      const v = Number(findSnapshotAtOrBefore(snapshots[id] || {}, d)?.value ?? 0);
      if (acc?.type === 'debt') total -= Math.abs(v);
      else total += v;
    });
    return { date: d, value: total };
  });
}

export function calcDelta(series, range = 'month') {
  if (!series?.length) return { current: 0, previous: 0, deltaValue: 0, deltaPercent: null, start: null, end: null };
  const allDates = series.map(s => s.date);
  const { start, end } = rangeBounds(range, allDates);
  const endPoint = findSnapshotAtOrBefore(Object.fromEntries(series.map(s => [s.date, { value: s.value }])), end);
  const prevDate = new Date(`${start}T12:00:00`);
  prevDate.setDate(prevDate.getDate() - 1);
  const previousPoint = findSnapshotAtOrBefore(Object.fromEntries(series.map(s => [s.date, { value: s.value }])), dateKey(prevDate));
  const current = Number(endPoint?.value ?? 0);
  const previous = Number(previousPoint?.value ?? 0);
  const deltaValue = current - previous;
  const deltaPercent = previous === 0 ? null : (deltaValue / previous) * 100;
  return { current, previous, deltaValue, deltaPercent, start, end };
}

export function calcGoalProgress(goal) {
  const target = Number(goal?.target || 0);
  const saved = Number(goal?.saved || 0);
  const pct = target <= 0 ? 0 : Math.max(0, Math.min(100, (saved / target) * 100));
  return { target, saved, pct };
}
