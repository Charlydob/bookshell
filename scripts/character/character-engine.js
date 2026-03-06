import { computeResources, computeWorldStats } from './character-resources.js';

const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const entries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

export function computeLevelFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const b = new Date(`${birthdate}T00:00:00`);
  if (!Number.isFinite(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

function normalizeUnitFactor(unitMode = 'unit') {
  return {
    minute: 1,
    hour: 60,
    session: 1,
    count: 1,
    unit: 1
  }[unitMode] || 1;
}

function buildHabitMetrics(snapshot = {}) {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const counts = habitsRoot.habitCounts || {};
  const checks = habitsRoot.habitChecks || {};
  const map = {};

  entries(defs).forEach(([id, def]) => {
    map[id] = {
      id,
      name: String(def?.name || def?.title || id).trim(),
      minutes: 0,
      hours: 0,
      sessions: 0,
      count: 0
    };
  });

  entries(sessions).forEach(([habitId, byDay]) => {
    if (!map[habitId]) map[habitId] = { id: habitId, name: habitId, minutes: 0, hours: 0, sessions: 0, count: 0 };
    entries(byDay || {}).forEach(([, sec]) => {
      const mins = toNum(sec) / 60;
      map[habitId].minutes += mins;
      map[habitId].hours += mins / 60;
      if (mins > 0) map[habitId].sessions += 1;
    });
  });

  entries(counts).forEach(([habitId, byDay]) => {
    if (!map[habitId]) map[habitId] = { id: habitId, name: habitId, minutes: 0, hours: 0, sessions: 0, count: 0 };
    entries(byDay || {}).forEach(([, n]) => { map[habitId].count += toNum(n); });
  });

  entries(checks).forEach(([habitId, byDay]) => {
    if (!map[habitId]) map[habitId] = { id: habitId, name: habitId, minutes: 0, hours: 0, sessions: 0, count: 0 };
    entries(byDay || {}).forEach(([, v]) => {
      if (v === true || toNum(v) > 0) map[habitId].sessions += 1;
    });
  });

  return map;
}

function buildCounterMetrics(snapshot = {}) {
  const counters = {};
  const habitsRoot = snapshot.habits || {};
  entries(habitsRoot.habitCounts || {}).forEach(([habitId, byDay]) => {
    counters[habitId] = entries(byDay || {}).reduce((sum, [, n]) => sum + toNum(n), 0);
  });
  return counters;
}

function computeGymStrength(snapshot = {}) {
  const gym = snapshot.gym || {};
  const workouts = values(gym.workouts || {});
  const cardio = values(gym.cardio || {});
  const workoutMinutes = workouts.reduce((sum, row) => sum + toNum(row?.durationMin || row?.duration || row?.minutes), 0);
  const cardioMinutes = cardio.reduce((sum, row) => sum + toNum(row?.durationMin || row?.duration || row?.minutes), 0);
  return Math.round(workoutMinutes * 0.45 + cardioMinutes * 0.2);
}

function deriveModuleEntries(snapshot = {}, range = 'week') {
  const resources = computeResources(snapshot, range);
  const world = computeWorldStats(snapshot);
  const strength = computeGymStrength(snapshot);

  return [
    {
      id: 'module-gold',
      type: 'moduleDerived',
      name: 'Oro',
      icon: '💰',
      description: 'Balance real desde Finance.',
      visible: true,
      sourceMode: 'derived',
      manualValue: 0,
      manualLevel: '',
      derivedConfig: { module: 'finance', metric: 'gold', range },
      order: -100,
      computedValue: resources.gold,
      moduleData: resources
    },
    {
      id: 'module-strength',
      type: 'moduleDerived',
      name: 'Fuerza',
      icon: '💪',
      description: 'Derivada de actividad real en Gym.',
      visible: true,
      sourceMode: 'derived',
      manualValue: 0,
      manualLevel: '',
      derivedConfig: { module: 'gym', metric: 'strength' },
      order: -90,
      computedValue: strength
    },
    {
      id: 'module-exploration',
      type: 'moduleDerived',
      name: 'Exploración',
      icon: '🌍',
      description: 'Países, ciudades y visitas reales en World/Trips.',
      visible: true,
      sourceMode: 'derived',
      manualValue: 0,
      manualLevel: '',
      derivedConfig: { module: 'world', metric: 'exploration' },
      order: -80,
      computedValue: world.countries * 25 + world.cities * 7 + world.visits * 2,
      moduleData: world
    }
  ];
}

function mapMetricByUnit(metric = {}, unitMode = 'unit') {
  if (unitMode === 'hour') return toNum(metric.hours);
  if (unitMode === 'minute') return toNum(metric.minutes);
  if (unitMode === 'session') return toNum(metric.sessions);
  return toNum(metric.count);
}

function computeEntryValue(entry = {}, entrySources = [], sourceData = {}) {
  const base = toNum(entry?.manualValue);
  const signMap = { add: 1, subtract: -1 };
  const sourceRows = (entrySources || [])
    .filter((src) => src && src.entryId === entry.id && src.enabled !== false)
    .map((src) => {
      let unitValue = 0;
      if (src.sourceType === 'habit') {
        const metric = sourceData.habits[src.sourceId] || {};
        unitValue = mapMetricByUnit(metric, src.unitMode || 'minute');
      } else if (src.sourceType === 'counter') {
        unitValue = toNum(sourceData.counters[src.sourceId]);
      } else if (src.sourceType === 'moduleMetric') {
        unitValue = toNum(sourceData.moduleMetrics[src.sourceId]);
      } else if (src.sourceType === 'manual') {
        unitValue = toNum(src.manualValue);
      }

      const sign = signMap[src.sign] || (toNum(src.sign) < 0 ? -1 : 1);
      const weight = toNum(src.weight || 1);
      const factor = normalizeUnitFactor(src.unitMode);
      const contribution = sign * unitValue * weight / factor;
      return { ...src, unitValue, contribution };
    });

  const derivedValue = sourceRows.reduce((sum, src) => sum + toNum(src.contribution), 0);
  return {
    value: Math.round((base + derivedValue) * 100) / 100,
    derivedValue: Math.round(derivedValue * 100) / 100,
    sourceRows
  };
}

function normalizeEntry(raw = {}, idx = 0) {
  return {
    id: raw.id || `entry-${Date.now()}-${idx}`,
    type: raw.type || 'attribute',
    name: raw.name || 'Entrada',
    icon: raw.icon || '✨',
    description: raw.description || '',
    visible: raw.visible !== false,
    sourceMode: raw.sourceMode || 'manual',
    manualValue: toNum(raw.manualValue),
    manualLevel: raw.manualLevel || '',
    derivedConfig: raw.derivedConfig || {},
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : idx
  };
}

export function buildCharacterSheet(snapshot = {}, config = {}, range = 'week') {
  const legacyIdentity = {
    name: config.name,
    alias: config.alias,
    birthdate: config.birthdate
  };
  const characterIdentity = {
    name: config.characterIdentity?.name || legacyIdentity.name || 'Aventurero',
    alias: config.characterIdentity?.alias || legacyIdentity.alias || '',
    birthdate: config.characterIdentity?.birthdate || legacyIdentity.birthdate || ''
  };

  const level = computeLevelFromBirthdate(characterIdentity.birthdate);
  const habits = buildHabitMetrics(snapshot);
  const counters = buildCounterMetrics(snapshot);

  const userEntries = Array.isArray(config.characterEntries)
    ? config.characterEntries.map(normalizeEntry)
    : [];
  const moduleEntries = deriveModuleEntries(snapshot, range);
  const allEntries = moduleEntries.concat(userEntries).sort((a, b) => a.order - b.order);

  const sourceData = {
    habits,
    counters,
    moduleMetrics: {
      'finance:gold': moduleEntries.find((x) => x.id === 'module-gold')?.computedValue || 0,
      'gym:strength': moduleEntries.find((x) => x.id === 'module-strength')?.computedValue || 0,
      'world:exploration': moduleEntries.find((x) => x.id === 'module-exploration')?.computedValue || 0
    }
  };

  const entrySources = Array.isArray(config.entrySources) ? config.entrySources : [];

  const computedEntries = allEntries.map((entry) => {
    if (entry.type === 'moduleDerived') {
      return {
        ...entry,
        value: Math.round(toNum(entry.computedValue) * 100) / 100,
        derivedValue: Math.round(toNum(entry.computedValue) * 100) / 100,
        sourceRows: []
      };
    }
    const computed = computeEntryValue(entry, entrySources, sourceData);
    return { ...entry, ...computed };
  }).filter((entry) => entry.visible !== false);

  return {
    identity: {
      ...characterIdentity,
      level,
      hasBirthdate: !!characterIdentity.birthdate
    },
    range,
    resources: moduleEntries.find((x) => x.id === 'module-gold')?.moduleData || computeResources(snapshot, range),
    world: moduleEntries.find((x) => x.id === 'module-exploration')?.moduleData || computeWorldStats(snapshot),
    entries: computedEntries,
    sourceCatalog: {
      habits: values(habits),
      counters: Object.keys(counters).map((id) => ({ id, name: habits[id]?.name || id, count: counters[id] })),
      moduleMetrics: [
        { id: 'finance:gold', label: 'Finance · Oro' },
        { id: 'gym:strength', label: 'Gym · Fuerza' },
        { id: 'world:exploration', label: 'World · Exploración' }
      ]
    },
    config: {
      characterIdentity,
      characterEntries: userEntries,
      entrySources
    }
  };
}
