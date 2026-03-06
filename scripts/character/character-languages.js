const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const entries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

const DEFAULT_LEVEL = 'Básico';

export function computeLanguageXP(snapshot = {}, config = {}) {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const list = new Map();

  const ensure = (name, seed = {}) => {
    const key = String(name || '').trim();
    if (!key) return null;
    if (!list.has(key)) list.set(key, { name: key, level: seed.level || DEFAULT_LEVEL, xpHours: 0, sources: [] });
    return list.get(key);
  };

  entries(defs).forEach(([habitId, habit]) => {
    const lang = String(habit?.languageTag || '').trim();
    if (!lang) return;
    const row = ensure(lang);
    const h = values(sessions[habitId] || {}).reduce((acc, sec) => acc + toNum(sec) / 3600, 0);
    row.xpHours += h;
    row.sources.push(`hábito:${habit?.name || habitId}`);
  });

  (config?.languages || []).forEach((lang) => {
    const row = ensure(lang.name, lang);
    if (!row) return;
    row.level = lang.level || row.level;
    row.xpHours += toNum(lang.manualHours);
    if (lang.manualHours) row.sources.push('manual');
  });

  return Array.from(list.values()).map((row) => ({
    ...row,
    xpHours: Math.round(row.xpHours * 10) / 10
  })).sort((a, b) => b.xpHours - a.xpHours);
}
