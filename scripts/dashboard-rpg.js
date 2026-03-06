const clamp = (n, min = 0, max = 100) => Math.min(max, Math.max(min, n));
const toNum = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const nowTs = () => Date.now();
const DAY = 86400000;

function entries(obj) { return obj && typeof obj === 'object' ? Object.entries(obj) : []; }
function values(obj) { return obj && typeof obj === 'object' ? Object.values(obj) : []; }
function dateToTs(v) {
  if (typeof v === 'number') return v;
  if (!v) return 0;
  const t = new Date(String(v)).getTime();
  return Number.isFinite(t) ? t : 0;
}

function countByRange(dayMap = {}, days = 7) {
  const min = nowTs() - days * DAY;
  return entries(dayMap).reduce((acc, [k, val]) => {
    const ts = dateToTs(k + 'T00:00:00');
    return ts >= min ? acc + toNum(val) : acc;
  }, 0);
}

function safeName(s = '') { return String(s || '').trim(); }

export function computeCharacterResources(snapshot = {}) {
  const finance = snapshot.finance || {};
  const accounts = finance.accounts || {};
  const tx = finance.transactions || {};
  const accountValues = values(accounts).map((acc) => {
    const snaps = values(acc?.snapshots || {}).map((r) => toNum(r?.value));
    const entriesVals = values(acc?.entries || acc?.daily || {}).map((r) => toNum(r?.value));
    return toNum(snaps.at(-1)) || toNum(entriesVals.at(-1)) || 0;
  });
  const gold = accountValues.reduce((a, b) => a + b, 0);
  let income = 0;
  let expense = 0;
  const min = nowTs() - 30 * DAY;
  values(tx).forEach((row) => {
    const ts = dateToTs(row?.dateISO || row?.date);
    if (ts && ts < min) return;
    const amount = Math.abs(toNum(row?.amount));
    if ((row?.type || '').toLowerCase() === 'income') income += amount;
    if ((row?.type || '').toLowerCase() === 'expense') expense += amount;
  });
  return {
    gold,
    income,
    expense,
    treasury: Math.max(0, gold - expense * 0.35),
    source: 'finance'
  };
}

function computeHabits(snapshot = {}) {
  const habitsRoot = snapshot.habits || {};
  const defs = habitsRoot.habits || {};
  const sessions = habitsRoot.habitSessions || {};
  const counts = habitsRoot.habitCounts || {};
  const checks = habitsRoot.habitChecks || {};
  const names = Object.fromEntries(entries(defs).map(([id, h]) => [id, safeName(h?.name).toLowerCase()]));
  const totals = { sleepHours: 0, coffeeToday: 0, sessionHoursWeek: 0, checksWeek: 0 };
  entries(sessions).forEach(([hid, byDay]) => {
    const habitName = names[hid] || '';
    entries(byDay || {}).forEach(([day, sec]) => {
      const hours = toNum(sec) / 3600;
      const ts = dateToTs(day + 'T00:00:00');
      if (ts >= nowTs() - 7 * DAY) totals.sessionHoursWeek += hours;
      if (/sueñ|dorm|sleep/.test(habitName) && ts >= nowTs() - DAY * 2) totals.sleepHours += hours;
    });
  });
  entries(counts).forEach(([hid, byDay]) => {
    const habitName = names[hid] || '';
    const today = new Date().toISOString().slice(0, 10);
    totals.checksWeek += countByRange(byDay, 7);
    if (/caf|coffee/.test(habitName)) totals.coffeeToday += toNum(byDay?.[today]);
  });
  entries(checks).forEach(([, byDay]) => { totals.checksWeek += countByRange(byDay, 7); });
  return totals;
}

function computeBooks(snapshot = {}) {
  const root = snapshot.books || {};
  const books = root.books || {};
  const readingLog = root.readingLog || {};
  const list = values(books);
  const finished = list.filter((b) => /termin|finish|read|done|complet/i.test(String(b?.status || '')) || toNum(b?.progress) >= 100).length;
  const pages = values(readingLog).reduce((acc, row) => acc + toNum(row?.pages || row?.pagesRead || row?.amount), 0);
  return { finished, pages, totalBooks: list.length };
}

function computeGym(snapshot = {}) {
  const gym = snapshot.gym || {};
  const workouts = gym.workouts || {};
  const cardio = gym.cardio || {};
  let sessions = values(workouts).length + values(cardio).length;
  let minutes = 0;
  values(workouts).forEach((w) => { minutes += toNum(w?.durationMin || w?.duration || w?.minutes); });
  values(cardio).forEach((c) => { minutes += toNum(c?.minutes || c?.durationMin || c?.duration); });
  return { sessions, minutes };
}

function computeVideos(snapshot = {}) {
  const v = snapshot.videos || {};
  const videos = values(v.videos || {});
  const work = values(v.videoWorkLog || {}).reduce((a, b) => a + toNum(b), 0);
  const published = videos.filter((x) => /publish|publicad|done|complet/i.test(String(x?.status || x?.stage || ''))).length;
  return { total: videos.length, published, workHours: work / 3600 };
}

function computeGames(snapshot = {}) {
  const g = snapshot.games || {};
  const modes = values(g.games?.modes || {});
  const agg = modes.reduce((a, m) => {
    a.wins += toNum(m?.wins); a.losses += toNum(m?.losses);
    a.kills += toNum(m?.kills); a.deaths += toNum(m?.deaths);
    a.hours += toNum(m?.hours || m?.playHours || 0);
    return a;
  }, { wins: 0, losses: 0, kills: 0, deaths: 0, hours: 0 });
  return agg;
}

function computeTrips(snapshot = {}) {
  const trips = snapshot.trips || {};
  const visits = values(trips.visits || trips.places || trips.entries || {});
  const countries = new Set();
  const cities = new Set();
  visits.forEach((v) => {
    if (v?.countryCode) countries.add(String(v.countryCode).toUpperCase());
    if (v?.city || v?.placeName) cities.add(String(v.city || v.placeName));
  });
  return { countries: countries.size, cities: cities.size, visits: visits.length };
}

function computeRecipes(snapshot = {}) {
  const recipesRoot = snapshot.recipes || {};
  const recipes = values(recipesRoot.recipes || recipesRoot.items || recipesRoot.list || {});
  const categories = new Set();
  recipes.forEach((r) => { if (r?.meal) categories.add(r.meal); if (r?.health) categories.add(r.health); });
  return { total: recipes.length, variety: categories.size };
}

export function computeCharacterStats(snapshot = {}) {
  const habits = computeHabits(snapshot);
  const books = computeBooks(snapshot);
  const gym = computeGym(snapshot);
  const videos = computeVideos(snapshot);
  const games = computeGames(snapshot);
  const trips = computeTrips(snapshot);
  const recipes = computeRecipes(snapshot);
  const resources = computeCharacterResources(snapshot);

  const staminaBase = habits.sleepHours < 5 ? 25 : habits.sleepHours < 6.5 ? 45 : habits.sleepHours < 8 ? 75 : 88;
  const stamina = clamp(staminaBase + Math.min(8, habits.coffeeToday * 2));

  const stats = {
    vida: clamp(35 + gym.sessions * 3 + Math.min(20, habits.checksWeek)),
    estamina: stamina,
    fuerza: clamp(20 + gym.minutes / 12),
    inteligencia: clamp(20 + books.finished * 12 + books.pages / 40),
    enfoque: clamp(15 + videos.workHours * 2 + habits.sessionHoursWeek * 1.5),
    creatividad: clamp(10 + videos.total * 4 + videos.published * 8),
    oro: clamp(resources.gold / 120),
    exploracion: clamp(trips.countries * 12 + trips.cities * 2),
    supervivencia: clamp(recipes.total * 4 + recipes.variety * 7),
    combate: clamp(games.kills * 1.8 + games.hours * 2 - Math.max(0, games.deaths - games.kills) * 0.8)
  };

  return { stats, inputs: { habits, books, gym, videos, games, trips, recipes, resources } };
}

export function computeCharacterClass(computed = {}) {
  const s = computed.stats || {};
  const map = {
    Erudito: (s.inteligencia || 0) + (s.enfoque || 0) * 0.4,
    Forjador: (s.fuerza || 0) + (s.vida || 0) * 0.5,
    Estratega: (s.combate || 0) + (s.enfoque || 0) * 0.6,
    Creador: (s.creatividad || 0) + (s.inteligencia || 0) * 0.3,
    Viajero: (s.exploracion || 0),
    Alquimista: (s.supervivencia || 0) + (s.creatividad || 0) * 0.2
  };
  const ranked = Object.entries(map).sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] - (ranked[1]?.[1] || 0) < 8) return 'Híbrido';
  return ranked[0][0];
}

export function computeCharacterDailyState(computed = {}) {
  const stamina = computed.stats?.estamina || 0;
  if (stamina < 35) return 'Fatigado';
  if (stamina < 60) return 'Funcional';
  if (stamina < 80) return 'En forma';
  return 'Imparable';
}

export function computeCharacterTraits(computed = {}) {
  const i = computed.inputs || {};
  const traits = [];
  if ((i.books?.finished || 0) >= 3) traits.push('Ratón de biblioteca');
  if ((i.gym?.sessions || 0) >= 4) traits.push('Forjador constante');
  if ((i.trips?.countries || 0) >= 2) traits.push('Viajero del mapa');
  if ((i.resources?.income || 0) > 0) traits.push('Minero disciplinado');
  if ((i.recipes?.total || 0) >= 8) traits.push('Alquimista doméstico');
  if ((i.games?.wins || 0) > (i.games?.losses || 0)) traits.push('Cazador competitivo');
  if ((i.videos?.published || 0) >= 2) traits.push('Director obsesivo');
  return traits.slice(0, 6);
}

export function buildCharacterProfile(snapshot = {}, meta = {}) {
  const computed = computeCharacterStats(snapshot);
  const className = computeCharacterClass(computed);
  const dailyState = computeCharacterDailyState(computed);
  const traits = computeCharacterTraits(computed);
  const resources = computeCharacterResources(snapshot);
  const statVals = Object.values(computed.stats);
  const level = Math.max(1, Math.round(statVals.reduce((a, b) => a + b, 0) / statVals.length / 4));
  return {
    name: meta.name || 'Aventurero',
    className,
    level,
    dailyState,
    lore: `Has dejado huella en ${computed.inputs?.trips?.countries || 0} reinos y forjado ${computed.inputs?.books?.finished || 0} tomos completados.`,
    stats: computed.stats,
    traits,
    resources,
    ranking: {
      dominantAttribute: Object.entries(computed.stats).sort((a, b) => b[1] - a[1])[0]?.[0] || 'vida',
      weakArea: Object.entries(computed.stats).sort((a, b) => a[1] - b[1])[0]?.[0] || 'vida',
      mainDiscipline: className,
      strongestResource: resources.gold >= resources.treasury ? 'Oro líquido' : 'Tesoro'
    },
    deltas: [
      { label: 'Fuerza', value: Math.round(computed.inputs.gym.minutes / 10) },
      { label: 'Inteligencia', value: Math.round(computed.inputs.books.pages / 50 + computed.inputs.books.finished * 2) },
      { label: 'Creatividad', value: Math.round(computed.inputs.videos.workHours * 1.5) },
      { label: 'Oro', value: Math.round(resources.income / 20) },
      { label: 'Estamina', value: -Math.max(0, Math.round((6.5 - computed.inputs.habits.sleepHours) * 8)) }
    ],
    activity: [
      `📚 ${computed.inputs.books.finished} libros terminados / ${Math.round(computed.inputs.books.pages)} páginas registradas`,
      `🏋️ ${computed.inputs.gym.sessions} sesiones de gym y ${Math.round(computed.inputs.gym.minutes)} min activos`,
      `🎬 ${computed.inputs.videos.published}/${computed.inputs.videos.total} vídeos en estado final`,
      `🌍 ${computed.inputs.trips.countries} países y ${computed.inputs.trips.cities} ciudades descubiertas`,
      `🎮 ${computed.inputs.games.kills} kills, ${computed.inputs.games.deaths} muertes, ${computed.inputs.games.wins} victorias`
    ],
    formulas: {
      estamina: 'Se basa en horas de sueño recientes (<5h muy baja, 5-6.5h baja, 6.5-8h buena, >8h alta) y un boost limitado por café diario.',
      inteligencia: 'Combina libros completados (peso alto) y páginas leídas (peso moderado).',
      fuerza: 'Deriva de minutos y sesiones de gym registradas.',
      combate: 'Combina kills + horas jugadas y penaliza exceso de muertes frente a kills.',
      recursos: 'Oro y botín vienen de finance/accounts + transactions del periodo reciente.'
    },
    details: computed.inputs
  };
}
