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

function flattenByDateRows(node = {}) {
  return entries(node).flatMap(([, byId]) => values(byId || {}));
}

function computeGymSourceMetrics(snapshot = {}) {
  const gymRoot = snapshot.gym?.gym || snapshot.gym || {};
  const workouts = flattenByDateRows(gymRoot.workouts || {});
  const cardio = flattenByDateRows(gymRoot.cardio || {});

  const workoutMinutes = workouts.reduce((sum, row) => sum + toNum(row?.durationMin || row?.duration || row?.minutes), 0);
  const cardioMinutes = cardio.reduce((sum, row) => sum + toNum(row?.durationMin || row?.duration || row?.minutes || row?.durationSec / 60), 0);
  const workoutSessions = workouts.length;
  const cardioSessions = cardio.length;
  const volume = workouts.reduce((sum, row) => sum + toNum(row?.totalVolume || row?.volumeKg || row?.kg), 0);

  const strength = Math.round(workoutMinutes * 0.45 + cardioMinutes * 0.2 + workoutSessions * 12 + cardioSessions * 6 + volume * 0.02);
  return { strength, workoutMinutes, cardioMinutes, workoutSessions, cardioSessions, volume };
}

function getPopularidadDefault() {
  return {
    followers: 0,
    views: 0,
    likes: 0,
    primaryField: 'followers',
    followersWeight: 1,
    viewsWeight: 0.1,
    likesWeight: 0.2
  };
}

function computePopularidad(entry = {}) {
  const extra = { ...getPopularidadDefault(), ...(entry.extraFields || {}) };
  const followers = toNum(extra.followers);
  const views = toNum(extra.views);
  const likes = toNum(extra.likes);
  const value = followers * toNum(extra.followersWeight || 1)
    + views * toNum(extra.viewsWeight || 0.1)
    + likes * toNum(extra.likesWeight || 0.2);
  return {
    extraFields: { ...extra, followers, views, likes },
    computedPrimary: extra.primaryField === 'views' ? views : extra.primaryField === 'likes' ? likes : followers,
    value: Math.round(value * 100) / 100
  };
}

function computeEntryRankProgress(value = 0, rankConfig = {}) {
  const cfg = {
    enabled: false,
    basePoints: 120,
    growth: 8,
    ...rankConfig
  };
  if (!cfg.enabled) {
    return { enabled: false, rank: null, current: 0, required: 0, progress: 0 };
  }
  const base = Math.max(1, toNum(cfg.basePoints) || 120);
  const growth = Math.max(0, toNum(cfg.growth) || 0);
  let total = Math.max(0, toNum(value));
  let rank = 1;
  let need = base;
  while (total >= need) {
    total -= need;
    rank += 1;
    need = Math.max(1, Math.round(base + growth * (rank - 1)));
    if (rank > 100000) break;
  }
  return {
    enabled: true,
    rank,
    current: Math.round(total * 100) / 100,
    required: need,
    progress: Math.max(0, Math.min(1, total / need))
  };
}

function deriveModuleEntries(snapshot = {}, range = 'week', scope = 'my') {
  const resources = computeResources(snapshot, range, scope);
  const resourcesToday = computeResources(snapshot, 'day', scope);
  const resourcesMonth = computeResources(snapshot, 'month', scope);
  const world = computeWorldStats(snapshot);
  const gym = computeGymSourceMetrics(snapshot);

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
      rankConfig: { enabled: true, basePoints: 200, growth: 25 },
      derivedConfig: { module: 'finance', metric: 'gold', range },
      order: -100,
      computedValue: resources.gold,
      moduleData: { ...resources, dayDelta: resourcesToday.delta, monthDelta: resourcesMonth.delta }
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
      rankConfig: { enabled: true, basePoints: 100, growth: 10 },
      derivedConfig: { module: 'gym', metric: 'strength' },
      order: -90,
      computedValue: gym.strength,
      moduleData: gym
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
      extraFields: { countryWeight: 100, cityWeight: 20, placeWeight: 5 },
      rankConfig: { enabled: true, basePoints: 140, growth: 14 },
      derivedConfig: { module: 'world', metric: 'exploration' },
      order: -80,
      computedValue: world.countries * 100 + world.cities * 20 + (world.places || world.visits) * 5,
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
    extraFields: raw.extraFields || {},
    rankConfig: {
      enabled: raw.rankConfig?.enabled === true,
      basePoints: toNum(raw.rankConfig?.basePoints) || 120,
      growth: toNum(raw.rankConfig?.growth) || 8
    },
    derivedConfig: raw.derivedConfig || {},
    order: Number.isFinite(Number(raw.order)) ? Number(raw.order) : idx
  };
}



function normalizeHealthEntry(entry = {}, idx = 0) {
  if (entry) {
    return normalizeEntry({
      id: 'entry-health',
      type: 'attribute',
      name: 'Salud',
      icon: '❤️',
      description: 'Estado de salud asociado a hábitos sanos/insanos.',
      sourceMode: 'manual',
      manualValue: 70,
      rankConfig: { enabled: false, basePoints: 100, growth: 5 },
      order: -70,
      ...entry
    }, idx);
  }
  return normalizeEntry({
    id: 'entry-health',
    type: 'attribute',
    name: 'Salud',
    icon: '❤️',
    description: 'Estado de salud asociado a hábitos sanos/insanos.',
    sourceMode: 'manual',
    manualValue: 70,
    rankConfig: { enabled: false, basePoints: 100, growth: 5 },
    order: -70
  }, idx);
}

function normalizeStaminaEntry(entry = {}, idx = 0) {
  if (entry) {
    return normalizeEntry({
      id: 'entry-stamina',
      type: 'attribute',
      name: 'Estamina',
      icon: '⚡',
      description: 'Estado de energía diaria asociado a hábitos de descanso/activación.',
      sourceMode: 'manual',
      manualValue: 65,
      rankConfig: { enabled: false, basePoints: 100, growth: 5 },
      order: -69,
      ...entry
    }, idx);
  }
  return normalizeEntry({
    id: 'entry-stamina',
    type: 'attribute',
    name: 'Estamina',
    icon: '⚡',
    description: 'Estado de energía diaria asociado a hábitos de descanso/activación.',
    sourceMode: 'manual',
    manualValue: 65,
    rankConfig: { enabled: false, basePoints: 100, growth: 5 },
    order: -69
  }, idx);
}

function isComparableEntry(entry = {}) {
  if (entry.visible === false) return false;
  if (entry.type === 'language') return false;
  if (String(entry.name || '').toLowerCase() === 'oro') return false;
  if (String(entry.id || '').toLowerCase() === 'module-gold') return false;
  return true;
}

export function computeCharacterPowerLevel(entries = []) {
  return entries
    .filter(isComparableEntry)
    .reduce((sum, entry) => {
      if (entry.rankProgress?.enabled) return sum + toNum(entry.rankProgress.rank || 0);
      const v = Math.max(0, toNum(entry.value));
      return sum + Math.floor(v / 100);
    }, 0);
}

function getDateRangeBounds(range = 'day') {
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (range === 'day') return { startMs: dayStart.getTime(), endMs: dayStart.getTime() + 86400000 - 1 };
  return { startMs: Number.NEGATIVE_INFINITY, endMs: Number.POSITIVE_INFINITY };
}

function buildHabitMetricsForRange(snapshot = {}, range = 'day') {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const counts = habitsRoot.habitCounts || {};
  const checks = habitsRoot.habitChecks || {};
  const map = {};
  const bounds = getDateRangeBounds(range);

  entries(defs).forEach(([id, def]) => {
    map[id] = { id, name: String(def?.name || def?.title || id).trim(), minutes: 0, hours: 0, sessions: 0, count: 0 };
  });

  entries(sessions).forEach(([habitId, byDay]) => {
    if (!map[habitId]) map[habitId] = { id: habitId, name: habitId, minutes: 0, hours: 0, sessions: 0, count: 0 };
    entries(byDay || {}).forEach(([day, sec]) => {
      const ts = new Date(`${day}T00:00:00`).getTime();
      if (!Number.isFinite(ts) || ts < bounds.startMs || ts > bounds.endMs) return;
      const mins = toNum(sec) / 60;
      map[habitId].minutes += mins;
      map[habitId].hours += mins / 60;
      if (mins > 0) map[habitId].sessions += 1;
    });
  });

  entries(counts).forEach(([habitId, byDay]) => {
    if (!map[habitId]) map[habitId] = { id: habitId, name: habitId, minutes: 0, hours: 0, sessions: 0, count: 0 };
    entries(byDay || {}).forEach(([day, n]) => {
      const ts = new Date(`${day}T00:00:00`).getTime();
      if (!Number.isFinite(ts) || ts < bounds.startMs || ts > bounds.endMs) return;
      map[habitId].count += toNum(n);
    });
  });

  entries(checks).forEach(([habitId, byDay]) => {
    if (!map[habitId]) map[habitId] = { id: habitId, name: habitId, minutes: 0, hours: 0, sessions: 0, count: 0 };
    entries(byDay || {}).forEach(([day, v]) => {
      const ts = new Date(`${day}T00:00:00`).getTime();
      if (!Number.isFinite(ts) || ts < bounds.startMs || ts > bounds.endMs) return;
      if (v === true || toNum(v) > 0) map[habitId].sessions += 1;
    });
  });

  return map;
}

export function computeHealthDeltaToday(sheet = {}, snapshot = {}) {
  return computeCharacterHealth(sheet, snapshot).todayDelta || 0;
}

export function computeCharacterHealth(sheet = {}, snapshot = {}) {
  const healthEntry = (sheet.entries || []).find((entry) => String(entry.name || '').toLowerCase() === 'salud' || String(entry.id || '') === 'entry-health');
  if (!healthEntry) return { value: 0, progress: 0, max: 100, todayDelta: 0 };

  const todaySourceData = {
    habits: buildHabitMetricsForRange(snapshot, 'day'),
    counters: buildCounterMetrics(snapshot),
    moduleMetrics: {
      'finance:gold': sheet.resources?.gold || 0,
      'gym:strength': (sheet.entries || []).find((x) => x.id === 'module-strength')?.value || 0,
      'world:exploration': (sheet.entries || []).find((x) => x.id === 'module-exploration')?.value || 0
    }
  };
  const entrySources = Array.isArray(sheet.config?.entrySources) ? sheet.config.entrySources : [];
  const todayComputed = computeEntryValue({ ...healthEntry, manualValue: 0 }, entrySources, todaySourceData);
  const max = Math.max(100, Math.round(Math.max(healthEntry.value || 0, 100)));
  const value = Math.max(0, toNum(healthEntry.value));
  return {
    value,
    max,
    progress: Math.max(0, Math.min(1, value / max)),
    todayDelta: Math.round((todayComputed.derivedValue || 0) * 100) / 100
  };
}

export function computeCharacterStaminaToday(sheet = {}, snapshot = {}) {
  const staminaEntry = (sheet.entries || []).find((entry) => String(entry.name || '').toLowerCase() === 'estamina' || String(entry.id || '') === 'entry-stamina');
  if (!staminaEntry) return { value: 0, progress: 0, max: 100, todayDelta: 0 };

  const todaySourceData = {
    habits: buildHabitMetricsForRange(snapshot, 'day'),
    counters: buildCounterMetrics(snapshot),
    moduleMetrics: {
      'finance:gold': sheet.resources?.gold || 0,
      'gym:strength': (sheet.entries || []).find((x) => x.id === 'module-strength')?.value || 0,
      'world:exploration': (sheet.entries || []).find((x) => x.id === 'module-exploration')?.value || 0
    }
  };
  const entrySources = Array.isArray(sheet.config?.entrySources) ? sheet.config.entrySources : [];
  const todayComputed = computeEntryValue({ ...staminaEntry, manualValue: 0 }, entrySources, todaySourceData);
  const max = Math.max(100, Math.round(Math.max(staminaEntry.value || 0, 100)));
  const value = Math.max(0, toNum(staminaEntry.value));
  return {
    value,
    max,
    progress: Math.max(0, Math.min(1, value / max)),
    todayDelta: Math.round((todayComputed.derivedValue || 0) * 100) / 100
  };
}

export function computeGamesProfileSummary(snapshot = {}) {
  const gamesRoot = snapshot.games || {};
  const groups = gamesRoot.games?.groups || {};
  const legacyModes = gamesRoot.games?.modes || {};
  const counters = gamesRoot.counters || {};

  const acc = { wins: 0, losses: 0, kills: 0, deaths: 0 };
  const addRow = (row = {}) => {
    acc.wins += toNum(row.wins);
    acc.losses += toNum(row.losses);
    acc.kills += toNum(row.kills ?? row.k);
    acc.deaths += toNum(row.deaths ?? row.d);
  };

  values(legacyModes).forEach(addRow);
  values(counters).forEach((dayMap) => values(dayMap || {}).forEach(addRow));
  values(groups).forEach((group) => values(group?.modes || {}).forEach((mode) => {
    addRow(mode?.base || mode);
    values(mode?.daily || {}).forEach(addRow);
  }));

  Object.keys(acc).forEach((key) => { acc[key] = Math.round(acc[key]); });
  return acc;
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

  const hasPopularidad = userEntries.some((entry) => String(entry.name || '').toLowerCase() === 'popularidad');
  if (!hasPopularidad) {
    userEntries.push(normalizeEntry({
      id: 'entry-popularidad',
      type: 'attribute',
      name: 'Popularidad',
      icon: '📣',
      description: 'Seguidores y visitas cargadas manualmente.',
      sourceMode: 'manual',
      manualValue: 0,
      extraFields: getPopularidadDefault(),
      rankConfig: { enabled: true, basePoints: 200, growth: 20 },
      order: 999
    }, userEntries.length));
  }

  const healthIndex = userEntries.findIndex((entry) => String(entry.name || '').toLowerCase() === 'salud' || String(entry.id || '') === 'entry-health');
  if (healthIndex === -1) {
    userEntries.push(normalizeHealthEntry(null, userEntries.length));
  } else {
    userEntries[healthIndex] = normalizeHealthEntry(userEntries[healthIndex], healthIndex);
  }

  const staminaIndex = userEntries.findIndex((entry) => String(entry.name || '').toLowerCase() === 'estamina' || String(entry.id || '') === 'entry-stamina');
  if (staminaIndex === -1) {
    userEntries.push(normalizeStaminaEntry(null, userEntries.length));
  } else {
    userEntries[staminaIndex] = normalizeStaminaEntry(userEntries[staminaIndex], staminaIndex);
  }

  const financeScope = config.financeScope === 'total' ? 'total' : 'my';
  const moduleEntries = deriveModuleEntries(snapshot, range, financeScope);
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
      const value = Math.round(toNum(entry.computedValue) * 100) / 100;
      return {
        ...entry,
        value,
        derivedValue: value,
        sourceRows: [],
        rankProgress: computeEntryRankProgress(value, entry.rankConfig)
      };
    }
    const computed = computeEntryValue(entry, entrySources, sourceData);
    let next = { ...entry, ...computed };
    if (String(entry.name || '').toLowerCase() === 'popularidad') {
      const p = computePopularidad(entry);
      next = {
        ...next,
        extraFields: p.extraFields,
        manualValue: p.value,
        value: Math.round((p.value + toNum(next.derivedValue)) * 100) / 100,
        computedPrimary: p.computedPrimary
      };
    }
    return {
      ...next,
      rankProgress: computeEntryRankProgress(next.value, entry.rankConfig)
    };
  }).filter((entry) => entry.visible !== false);

  const resources = moduleEntries.find((x) => x.id === 'module-gold')?.moduleData || computeResources(snapshot, range, financeScope);
  const powerLevel = computeCharacterPowerLevel(computedEntries);

  const baseSheet = {
    identity: {
      ...characterIdentity,
      level,
      hasBirthdate: !!characterIdentity.birthdate
    },
    range,
    resources,
    headerFinance: {
      gold: resources.gold,
      dayDelta: resources.dayDelta ?? computeResources(snapshot, 'day', financeScope).delta,
      monthDelta: resources.monthDelta ?? computeResources(snapshot, 'month', financeScope).delta
    },
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

  const health = computeCharacterHealth(baseSheet, snapshot);
  const stamina = computeCharacterStaminaToday(baseSheet, snapshot);
  const gamesSummary = computeGamesProfileSummary(snapshot);
  return { ...baseSheet, powerLevel, health, stamina, gamesSummary };
}

export { computeEntryRankProgress };
