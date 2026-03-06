const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const entries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

export function computeSkillXP(snapshot = {}, config = {}) {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const modules = config?.skills || [];

  const map = new Map();
  const ensure = (name, seed = {}) => {
    if (!name) return null;
    const key = String(name).trim();
    if (!key) return null;
    if (!map.has(key)) {
      map.set(key, {
        name: key,
        icon: seed.icon || '🧩',
        description: seed.description || '',
        xpHours: 0,
        sources: []
      });
    }
    return map.get(key);
  };

  entries(defs).forEach(([habitId, habit]) => {
    const skillTag = String(habit?.skillTag || '').trim();
    if (!skillTag) return;
    const skill = ensure(skillTag);
    const byDay = sessions[habitId] || {};
    const habitHours = values(byDay).reduce((acc, sec) => acc + toNum(sec) / 3600, 0);
    skill.xpHours += habitHours;
    skill.sources.push(`hábito:${habit?.name || habitId}`);
  });

  modules.forEach((skill) => {
    const row = ensure(skill.name, skill);
    if (!row) return;
    row.xpHours += toNum(skill.manualHours);
    if (skill.manualHours) row.sources.push('manual');
  });

  return Array.from(map.values()).map((skill) => {
    const mastery = skill.xpHours < 20 ? 'Inicial' : skill.xpHours < 80 ? 'Intermedio' : skill.xpHours < 250 ? 'Avanzado' : 'Experto';
    return { ...skill, xpHours: Math.round(skill.xpHours * 10) / 10, mastery };
  }).sort((a, b) => b.xpHours - a.xpHours);
}
