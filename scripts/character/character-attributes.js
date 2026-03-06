import { computeResources, computeWorldStats } from './character-resources.js';

const DAY = 86400000;
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const entries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

export const ATTRIBUTE_KEYS = ['vida', 'estamina', 'fuerza', 'inteligencia', 'enfoque', 'creatividad', 'oro', 'exploracion', 'supervivencia', 'combate'];

export const ATTRIBUTE_LABELS = {
  vida: 'Vida', estamina: 'Estamina', fuerza: 'Fuerza', inteligencia: 'Inteligencia', enfoque: 'Enfoque', creatividad: 'Creatividad', oro: 'Oro', exploracion: 'Exploración', supervivencia: 'Supervivencia', combate: 'Combate'
};

const DEFAULT_MAPPING_RULES = [
  { pattern: /(dorm|sueñ|sleep)/i, attribute: 'estamina', weight: 6 },
  { pattern: /(medit|mindful|respira)/i, attribute: 'vida', weight: 4 },
  { pattern: /(leer|read|alem|ruso|idioma|estudi)/i, attribute: 'inteligencia', weight: 4 },
  { pattern: /(gym|fuerza|pesas|run|correr|cardio|entren)/i, attribute: 'fuerza', weight: 4 },
  { pattern: /(editar|edit|video|guion|script|write|escrib)/i, attribute: 'creatividad', weight: 3 },
  { pattern: /(editar|edit|video|deep|focus|concentr)/i, attribute: 'enfoque', weight: 3 },
  { pattern: /(caf|coffee)/i, attribute: 'estamina', weight: 1 }
];

function parseDay(dayKey = '') {
  const t = new Date(`${dayKey}T00:00:00`).getTime();
  return Number.isFinite(t) ? t : 0;
}

function habitName(def = {}) {
  return String(def?.name || def?.title || '').trim();
}

function computeHabitTotals(snapshot = {}) {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const counts = habitsRoot.habitCounts || {};
  const checks = habitsRoot.habitChecks || {};
  const out = {};

  entries(defs).forEach(([id, def]) => {
    out[id] = { id, name: habitName(def), sessionHoursTotal: 0, countTotal: 0, checksWeek: 0, todayCount: 0, lastDayHours: 0, raw: def };
  });

  entries(sessions).forEach(([habitId, byDay]) => {
    if (!out[habitId]) out[habitId] = { id: habitId, name: habitId, sessionHoursTotal: 0, countTotal: 0, checksWeek: 0, todayCount: 0, lastDayHours: 0, raw: {} };
    entries(byDay || {}).forEach(([day, sec]) => {
      const hours = toNum(sec) / 3600;
      const ts = parseDay(day);
      out[habitId].sessionHoursTotal += hours;
      if (ts >= Date.now() - 2 * DAY) out[habitId].lastDayHours += hours;
    });
  });

  const today = new Date().toISOString().slice(0, 10);
  entries(counts).forEach(([habitId, byDay]) => {
    if (!out[habitId]) out[habitId] = { id: habitId, name: habitId, sessionHoursTotal: 0, countTotal: 0, checksWeek: 0, todayCount: 0, lastDayHours: 0, raw: {} };
    entries(byDay || {}).forEach(([day, n]) => {
      out[habitId].countTotal += toNum(n);
      if (day === today) out[habitId].todayCount += toNum(n);
    });
  });

  entries(checks).forEach(([habitId, byDay]) => {
    if (!out[habitId]) return;
    entries(byDay || {}).forEach(([day, v]) => {
      if (parseDay(day) >= Date.now() - 7 * DAY && (v === true || toNum(v) > 0)) out[habitId].checksWeek += 1;
    });
  });
  return out;
}

export function getHabitAttributeMappings(snapshot = {}, config = {}) {
  const habits = computeHabitTotals(snapshot);
  const confMappings = config?.attributeMappings && typeof config.attributeMappings === 'object' ? config.attributeMappings : (config?.habitMappings || {});
  const resolved = {};

  ATTRIBUTE_KEYS.concat((config?.customAttributes || []).map((x) => x.id)).forEach((attr) => { resolved[attr] = {}; });
  Object.keys(resolved).forEach((attr) => {
    entries(confMappings[attr] || {}).forEach(([habitId, weight]) => { resolved[attr][habitId] = Math.max(0, toNum(weight) || 1); });
  });

  entries(habits).forEach(([habitId, info]) => {
    const name = String(info.name || '').toLowerCase();
    DEFAULT_MAPPING_RULES.forEach((rule) => {
      if (!resolved[rule.attribute] || !rule.pattern.test(name)) return;
      if (!resolved[rule.attribute][habitId]) resolved[rule.attribute][habitId] = rule.weight;
    });
  });

  return { resolved, habits };
}

export function computeAttribute(snapshot = {}, config = {}, range = 'week') {
  const { resolved: mappings, habits: habitTotals } = getHabitAttributeMappings(snapshot, config);
  const attrs = {};
  Object.keys(mappings).forEach((k) => { attrs[k] = 0; });

  Object.keys(mappings).forEach((attr) => {
    entries(mappings[attr]).forEach(([habitId, weight]) => {
      const h = habitTotals[habitId];
      if (!h) return;
      const base = h.sessionHoursTotal * 10 + h.countTotal * 2 + h.checksWeek;
      attrs[attr] += base * toNum(weight || 1);
    });
  });

  const resources = computeResources(snapshot, range);
  const world = computeWorldStats(snapshot);
  attrs.oro = resources.gold;
  attrs.exploracion = (attrs.exploracion || 0) + world.countries * 25 + world.cities * 7 + world.visits * 2;

  const sleepHabit = values(habitTotals).find((h) => /(dorm|sueñ|sleep)/i.test(String(h.name || '').toLowerCase()));
  const coffeeHabit = values(habitTotals).find((h) => /(caf|coffee)/i.test(String(h.name || '').toLowerCase()));
  const sleepHours = sleepHabit?.lastDayHours || 0;
  const coffeeToday = coffeeHabit?.todayCount || 0;
  attrs.estamina = Math.max(0, sleepHours * 22 + Math.min(8, coffeeToday * 1.5));

  Object.keys(attrs).forEach((k) => { attrs[k] = Math.max(0, Math.round(attrs[k])); });
  return { attributes: attrs, mappings, habits: habitTotals, resources, world };
}
