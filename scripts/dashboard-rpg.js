const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const DAY = 86400000;
const nowTs = () => Date.now();
const entries = (obj) => (obj && typeof obj === 'object' ? Object.entries(obj) : []);
const values = (obj) => (obj && typeof obj === 'object' ? Object.values(obj) : []);

export const ATTRIBUTE_KEYS = [
  'vida',
  'estamina',
  'fuerza',
  'inteligencia',
  'enfoque',
  'creatividad',
  'oro',
  'exploracion',
  'supervivencia',
  'combate'
];

export const ATTRIBUTE_LABELS = {
  vida: 'Vida',
  estamina: 'Estamina',
  fuerza: 'Fuerza',
  inteligencia: 'Inteligencia',
  enfoque: 'Enfoque',
  creatividad: 'Creatividad',
  oro: 'Oro',
  exploracion: 'Exploración',
  supervivencia: 'Cocina / Alquimia / Supervivencia',
  combate: 'Combate / Táctica'
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

function getFinanceRoot(snapshot = {}) {
  return snapshot.finance?.finance || snapshot.finance || {};
}

function getRangeTx(transactions = {}, days = 7) {
  const min = nowTs() - days * DAY;
  return values(transactions).filter((tx) => {
    const t = new Date(String(tx?.dateISO || tx?.date || tx?.createdAt || 0)).getTime();
    return Number.isFinite(t) && t >= min;
  });
}

export function computeCharacterLevelFromBirthdate(birthdate) {
  if (!birthdate) return null;
  const b = new Date(`${birthdate}T00:00:00`);
  if (!Number.isFinite(b.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - b.getFullYear();
  const m = now.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < b.getDate())) age -= 1;
  return age >= 0 ? age : null;
}

export function computeCharacterResources(snapshot = {}) {
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
  const txDay = getRangeTx(transactions, 1);
  const txWeek = getRangeTx(transactions, 7);
  const sumSigned = (arr) => arr.reduce((acc, tx) => {
    const amount = Math.abs(toNum(tx?.amount));
    const type = String(tx?.type || '').toLowerCase();
    return acc + (type === 'income' ? amount : type === 'expense' ? -amount : toNum(tx?.signedAmount));
  }, 0);

  return {
    gold,
    changeToday: sumSigned(txDay),
    changeWeek: sumSigned(txWeek),
    incomeWeek: txWeek.reduce((a, tx) => a + (String(tx?.type || '').toLowerCase() === 'income' ? Math.abs(toNum(tx?.amount)) : 0), 0),
    expenseWeek: txWeek.reduce((a, tx) => a + (String(tx?.type || '').toLowerCase() === 'expense' ? Math.abs(toNum(tx?.amount)) : 0), 0)
  };
}

export function computeCharacterWorldStats(snapshot = {}) {
  const trips = snapshot.trips || {};
  const visits = values(trips.visits || trips.places || trips.entries || {});
  const fallback = (() => {
    try { return JSON.parse(localStorage.getItem('world_visits_v1') || '[]'); } catch (_) { return []; }
  })();
  const rows = visits.length ? visits : fallback;
  const countries = new Set();
  const cities = new Set();
  rows.forEach((v) => {
    if (v?.countryCode) countries.add(String(v.countryCode).toUpperCase());
    if (v?.city || v?.placeName || v?.label) cities.add(String(v.city || v.placeName || v.label));
  });
  return { countries: countries.size, cities: cities.size, visits: rows.length };
}

function computeHabitTotals(snapshot = {}) {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const counts = habitsRoot.habitCounts || {};
  const checks = habitsRoot.habitChecks || {};

  const out = {};
  entries(defs).forEach(([id, def]) => {
    out[id] = {
      id,
      name: habitName(def),
      sessionHoursTotal: 0,
      sessionHoursWeek: 0,
      countTotal: 0,
      countWeek: 0,
      checksWeek: 0,
      todayCount: 0,
      lastDayHours: 0
    };
  });

  entries(sessions).forEach(([habitId, byDay]) => {
    if (!out[habitId]) out[habitId] = { id: habitId, name: habitId, sessionHoursTotal: 0, sessionHoursWeek: 0, countTotal: 0, countWeek: 0, checksWeek: 0, todayCount: 0, lastDayHours: 0 };
    entries(byDay || {}).forEach(([day, sec]) => {
      const hours = toNum(sec) / 3600;
      const ts = parseDay(day);
      out[habitId].sessionHoursTotal += hours;
      if (ts >= nowTs() - 7 * DAY) out[habitId].sessionHoursWeek += hours;
      if (ts >= nowTs() - 2 * DAY) out[habitId].lastDayHours += hours;
    });
  });

  const today = new Date().toISOString().slice(0, 10);
  entries(counts).forEach(([habitId, byDay]) => {
    if (!out[habitId]) out[habitId] = { id: habitId, name: habitId, sessionHoursTotal: 0, sessionHoursWeek: 0, countTotal: 0, countWeek: 0, checksWeek: 0, todayCount: 0, lastDayHours: 0 };
    entries(byDay || {}).forEach(([day, n]) => {
      const value = toNum(n);
      out[habitId].countTotal += value;
      if (day === today) out[habitId].todayCount += value;
      if (parseDay(day) >= nowTs() - 7 * DAY) out[habitId].countWeek += value;
    });
  });

  entries(checks).forEach(([habitId, byDay]) => {
    if (!out[habitId]) out[habitId] = { id: habitId, name: habitId, sessionHoursTotal: 0, sessionHoursWeek: 0, countTotal: 0, countWeek: 0, checksWeek: 0, todayCount: 0, lastDayHours: 0 };
    entries(byDay || {}).forEach(([day, v]) => {
      if (parseDay(day) >= nowTs() - 7 * DAY && (v === true || toNum(v) > 0)) out[habitId].checksWeek += 1;
    });
  });

  return out;
}

export function getHabitAttributeMappings(snapshot = {}, config = {}) {
  const habits = computeHabitTotals(snapshot);
  const confMappings = config?.habitMappings && typeof config.habitMappings === 'object' ? config.habitMappings : {};
  const resolved = {};

  ATTRIBUTE_KEYS.forEach((attr) => { resolved[attr] = {}; });
  ATTRIBUTE_KEYS.forEach((attr) => {
    entries(confMappings[attr] || {}).forEach(([habitId, weight]) => {
      resolved[attr][habitId] = Math.max(0, toNum(weight) || 1);
    });
  });

  entries(habits).forEach(([habitId, info]) => {
    const name = String(info.name || '').toLowerCase();
    DEFAULT_MAPPING_RULES.forEach((rule) => {
      if (!rule.pattern.test(name)) return;
      if (!resolved[rule.attribute][habitId]) resolved[rule.attribute][habitId] = rule.weight;
    });
  });

  return resolved;
}

export function computeCharacterAttributes(snapshot = {}, config = {}) {
  const habitTotals = computeHabitTotals(snapshot);
  const mappings = getHabitAttributeMappings(snapshot, config);

  const books = snapshot.books || {};
  const booksList = values(books.books || books.items || {});
  const readingLog = values(books.readingLog || {});
  const finishedBooks = booksList.filter((b) => /termin|finish|read|done|complet/i.test(String(b?.status || '')) || toNum(b?.progress) >= 100).length;
  const pagesRead = readingLog.reduce((a, row) => a + toNum(row?.pages || row?.pagesRead || row?.amount), 0);

  const gym = snapshot.gym || {};
  const workoutMinutes = values(gym.workouts || {}).reduce((a, row) => a + toNum(row?.durationMin || row?.duration || row?.minutes), 0)
    + values(gym.cardio || {}).reduce((a, row) => a + toNum(row?.durationMin || row?.duration || row?.minutes), 0);

  const videos = snapshot.videos || {};
  const videoWorkLog = values(videos.videoWorkLog || {});
  const videoWorkHours = videoWorkLog.reduce((a, sec) => a + toNum(sec), 0) / 3600;
  const videoList = values(videos.videos || {});

  const recipes = values(snapshot.recipes?.recipes || snapshot.recipes?.items || snapshot.recipes?.list || {});
  const recipesUsed = recipes.reduce((a, r) => a + (Array.isArray(r?.cookedDates) ? r.cookedDates.length : (r?.lastCooked ? 1 : 0)), 0);

  const gamesModes = values(snapshot.games?.games?.modes || {});
  const games = gamesModes.reduce((a, mode) => {
    a.kills += toNum(mode?.kills);
    a.deaths += toNum(mode?.deaths);
    a.wins += toNum(mode?.wins);
    a.losses += toNum(mode?.losses);
    a.hours += toNum(mode?.hours || mode?.playHours);
    return a;
  }, { kills: 0, deaths: 0, wins: 0, losses: 0, hours: 0 });

  const resources = computeCharacterResources(snapshot);
  const exploration = computeCharacterWorldStats(snapshot);

  const attrs = Object.fromEntries(ATTRIBUTE_KEYS.map((k) => [k, 0]));
  ATTRIBUTE_KEYS.forEach((attr) => {
    entries(mappings[attr]).forEach(([habitId, weight]) => {
      const h = habitTotals[habitId];
      if (!h) return;
      const base = h.sessionHoursTotal * 10 + h.countTotal * 2 + h.checksWeek;
      attrs[attr] += base * toNum(weight || 1);
    });
  });

  attrs.inteligencia += finishedBooks * 35 + pagesRead * 0.35;
  attrs.fuerza += workoutMinutes * 0.45;
  attrs.enfoque += videoWorkHours * 8;
  attrs.creatividad += videoWorkHours * 5 + videoList.length * 6;
  attrs.supervivencia += recipes.length * 10 + recipesUsed * 2;
  const winRate = games.wins + games.losses > 0 ? games.wins / (games.wins + games.losses) : 0;
  attrs.combate += games.kills * 1.8 + games.hours * 5 + winRate * 120 - Math.max(0, games.deaths - games.kills) * 1.5;
  attrs.exploracion += exploration.countries * 25 + exploration.cities * 7 + exploration.visits * 2;
  attrs.oro = resources.gold;

  const sleepHabit = values(habitTotals).find((h) => /(dorm|sueñ|sleep)/i.test(String(h.name || '').toLowerCase()));
  const coffeeHabit = values(habitTotals).find((h) => /(caf|coffee)/i.test(String(h.name || '').toLowerCase()));
  const sleepHours = sleepHabit?.lastDayHours || 0;
  const coffeeToday = coffeeHabit?.todayCount || 0;
  const staminaState = sleepHours < 5 ? 'agotado' : sleepHours < 6.5 ? 'bajo' : sleepHours < 8 ? 'estable' : sleepHours < 9.5 ? 'alto' : 'rebosante';
  attrs.estamina = Math.max(0, sleepHours * 22 + Math.min(8, coffeeToday * 1.5));

  attrs.vida += (values(habitTotals).reduce((a, h) => a + h.checksWeek, 0) * 2) + (sleepHours * 6) + (workoutMinutes * 0.08);

  ATTRIBUTE_KEYS.forEach((k) => { attrs[k] = Math.max(0, Math.round(attrs[k])); });
  return {
    attributes: attrs,
    staminaState,
    modules: { resources, exploration, games, recipes: { total: recipes.length, used: recipesUsed }, videos: { total: videoList.length, workHours: videoWorkHours }, books: { finishedBooks, pagesRead }, habits: habitTotals },
    mappings
  };
}

export function computeCharacterRecentDeltas(snapshot = {}) {
  const resources = computeCharacterResources(snapshot);
  return {
    goldToday: resources.changeToday,
    goldWeek: resources.changeWeek,
    incomeWeek: resources.incomeWeek,
    expenseWeek: resources.expenseWeek
  };
}

export function buildCharacterSheetData(snapshot = {}, config = {}) {
  const computed = computeCharacterAttributes(snapshot, config);
  const ageLevel = computeCharacterLevelFromBirthdate(config.birthdate);
  const topAttributes = Object.entries(computed.attributes)
    .filter(([k]) => !['oro', 'estamina'].includes(k))
    .sort((a, b) => b[1] - a[1]);
  const top = topAttributes[0]?.[0] || 'vida';
  const second = topAttributes[1]?.[0] || 'inteligencia';

  const classByAttr = {
    inteligencia: 'Erudito',
    fuerza: 'Forjador',
    combate: 'Estratega',
    creatividad: 'Creador',
    exploracion: 'Viajero',
    supervivencia: 'Alquimista'
  };
  const className = classByAttr[top] || classByAttr[second] || 'Híbrido';

  return {
    name: config.name || 'Aventurero',
    level: ageLevel,
    hasBirthdate: !!config.birthdate,
    className,
    resources: computed.modules.resources,
    deltas: computeCharacterRecentDeltas(snapshot),
    world: computed.modules.exploration,
    attributes: computed.attributes,
    staminaState: computed.staminaState,
    mappings: computed.mappings,
    details: computed.modules,
    explain: {
      nivel: 'El nivel se calcula usando tu fecha de nacimiento (edad real actual).',
      oro: 'Oro = balance total real de cuentas en Finance + deltas por transacciones reales.',
      exploracion: 'Exploración = países/ciudades/visitas reales en World/Trips.',
      atributos: 'Atributos = suma ponderada de hábitos mapeados + módulos reales (books/gym/videos/recipes/games).',
      estamina: 'Estamina = sueño reciente como base + modificador suave por café.'
    }
  };
}
