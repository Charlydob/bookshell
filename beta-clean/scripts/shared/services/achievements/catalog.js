import { MODULE_META } from "./metrics.js";

const SCALE_EXTENDED = [1, 5, 10, 25, 50, 100, 250, 500, 1000];
const SCALE_TRACKING_DAYS = [3, 7, 14, 30, 100, 365];
const SCALE_STREAK_DAYS = [3, 7, 14, 30, 100, 365];
const SCALE_HABIT_DAYS = [7, 30, 100, 365];
const SCALE_HABIT_COUNTS = [10, 50, 100, 500, 1000];
const SCALE_HABIT_HOURS = [10, 25, 50, 100, 250, 500, 1000];
const SCALE_PAGES = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000];
const SCALE_VOLUME = [1000, 5000, 10000, 25000, 50000, 100000];

function sanitizeAchievementKeyPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[.#$/\[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function normalizeThresholds(thresholds = []) {
  return Array.from(
    new Set(
      (Array.isArray(thresholds) ? thresholds : [])
        .map((value) => Number(value))
        .filter((value) => Number.isFinite(value) && value > 0),
    ),
  ).sort((a, b) => a - b);
}

function createThresholdAchievements({
  familyId,
  module,
  icon,
  title,
  description,
  criterion,
  thresholds = [],
  hidden = false,
  getCurrentValue,
  unitLabel = "",
  groupKey = "",
  groupLabel = "",
  entityId = "",
  entityLabel = "",
  valueFormatter = null,
}) {
  const safeThresholds = normalizeThresholds(thresholds);
  return safeThresholds.map((targetValue, index) => ({
    id: `${familyId}_${targetValue}`,
    familyId,
    module,
    icon,
    hidden,
    title: typeof title === "function" ? title(targetValue, index) : String(title || "").trim(),
    description: typeof description === "function" ? description(targetValue, index) : String(description || "").trim(),
    criterion: typeof criterion === "function" ? criterion(targetValue, index) : String(criterion || "").trim(),
    targetValue: Number(targetValue) || 0,
    tierIndex: index,
    thresholds: [...safeThresholds],
    getCurrentValue,
    unitLabel,
    groupKey: String(groupKey || "").trim(),
    groupLabel: String(groupLabel || "").trim(),
    entityId: String(entityId || "").trim(),
    entityLabel: String(entityLabel || "").trim(),
    scopeLabel: String(entityLabel || groupLabel || "").trim(),
    formatValue: typeof valueFormatter === "function" ? valueFormatter : null,
  }));
}

function formatHoursValue(value) {
  const numeric = Math.max(0, Number(value) || 0);
  return `${numeric.toLocaleString("es-ES", {
    minimumFractionDigits: numeric > 0 && numeric < 10 ? 1 : 0,
    maximumFractionDigits: numeric > 0 && numeric < 10 ? 2 : 1,
  })} h`;
}

function getHabitEntityMetrics(context = {}, habitId = "") {
  const safeId = String(habitId || "").trim();
  if (!safeId) return null;
  return context?.modules?.habits?.habitEntities?.[safeId] || null;
}

function createHabitEntityAchievements({ context = {}, habitId = "" } = {}) {
  const entity = getHabitEntityMetrics(context, habitId);
  if (!entity) return [];

  const habitName = String(entity.name || entity.label || "Hábito").trim() || "Hábito";
  const habitIcon = String(entity.emoji || "").trim() || (entity.goalType === "time" ? "⏱️" : entity.goalType === "count" ? "🔢" : "✅");
  const familyRoot = `habit_${sanitizeAchievementKeyPart(habitId)}`;
  const baseConfig = {
    module: "habits",
    groupKey: `habit:${sanitizeAchievementKeyPart(habitId)}`,
    groupLabel: habitName,
    entityId: habitId,
    entityLabel: habitName,
  };

  const shared = [
    ...createThresholdAchievements({
      familyId: `${familyRoot}_days`,
      icon: habitIcon,
      title: (target) => `${habitName} ${target} días`,
      description: (target) => `Completa "${habitName}" durante ${target} días.`,
      criterion: (target) => `Días con "${habitName}": ${target}`,
      thresholds: SCALE_HABIT_DAYS,
      getCurrentValue: (ctx) => getHabitEntityMetrics(ctx, habitId)?.completedDays || 0,
      unitLabel: "días",
      ...baseConfig,
    }),
    ...createThresholdAchievements({
      familyId: `${familyRoot}_streak`,
      icon: "🔥",
      title: (target) => `Racha ${target} · ${habitName}`,
      description: (target) => `Mantén "${habitName}" ${target} días seguidos.`,
      criterion: (target) => `Racha en "${habitName}": ${target} días`,
      thresholds: SCALE_HABIT_DAYS,
      getCurrentValue: (ctx) => {
        const metrics = getHabitEntityMetrics(ctx, habitId);
        return Math.max(metrics?.streakCurrent || 0, metrics?.streakBest || 0);
      },
      unitLabel: "días",
      ...baseConfig,
    }),
  ];

  if (entity.goalType === "time") {
    return [
      ...shared,
      ...createThresholdAchievements({
        familyId: `${familyRoot}_hours`,
        icon: "⏱️",
        title: (target) => `${habitName} ${target}h`,
        description: (target) => `Acumula ${target} horas en "${habitName}".`,
        criterion: (target) => `Horas en "${habitName}": ${target}`,
        thresholds: SCALE_HABIT_HOURS,
        getCurrentValue: (ctx) => getHabitEntityMetrics(ctx, habitId)?.totalHours || 0,
        unitLabel: "horas",
        valueFormatter: formatHoursValue,
        ...baseConfig,
      }),
    ];
  }

  if (entity.goalType === "count") {
    return [
      ...shared,
      ...createThresholdAchievements({
        familyId: `${familyRoot}_count`,
        icon: "🔢",
        title: (target) => `${habitName} ×${target}`,
        description: (target) => `Registra ${target} repeticiones en "${habitName}".`,
        criterion: (target) => `Conteo en "${habitName}": ${target}`,
        thresholds: SCALE_HABIT_COUNTS,
        getCurrentValue: (ctx) => getHabitEntityMetrics(ctx, habitId)?.totalCount || 0,
        unitLabel: "repeticiones",
        ...baseConfig,
      }),
    ];
  }

  return shared;
}

const BASE_CATALOG = [
  ...createThresholdAchievements({
    familyId: "books_finished",
    module: "books",
    icon: "📚",
    title: (target) => `Lector ${target}`,
    description: (target) => `Termina ${target} libro${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Libros terminados: ${target}`,
    thresholds: [1, 5, 10, 25, 50, 100, 250],
    getCurrentValue: (ctx) => ctx.modules.books.finishedBooks,
    unitLabel: "libros",
  }),
  ...createThresholdAchievements({
    familyId: "books_pages",
    module: "books",
    icon: "📖",
    title: (target) => `Páginas ${target}`,
    description: (target) => `Acumula ${target} páginas registradas.`,
    criterion: (target) => `Páginas leídas: ${target}`,
    thresholds: SCALE_PAGES,
    getCurrentValue: (ctx) => ctx.modules.books.pagesRead,
    unitLabel: "páginas",
  }),
  ...createThresholdAchievements({
    familyId: "books_streak",
    module: "books",
    icon: "🔥",
    title: (target) => `Racha lectora ${target}`,
    description: (target) => `Lee ${target} días seguidos.`,
    criterion: (target) => `Racha de lectura: ${target} días`,
    thresholds: SCALE_STREAK_DAYS,
    getCurrentValue: (ctx) => Math.max(ctx.modules.books.readingStreakCurrent, ctx.modules.books.readingStreakBest),
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "books_genres",
    module: "books",
    icon: "🧭",
    title: (target) => `Explorador ${target}`,
    description: (target) => `Completa ${target} géneros distintos.`,
    criterion: (target) => `Géneros terminados: ${target}`,
    thresholds: [3, 5, 8, 12, 20],
    getCurrentValue: (ctx) => ctx.modules.books.distinctGenres,
    unitLabel: "géneros",
  }),

  ...createThresholdAchievements({
    familyId: "recipes_created",
    module: "recipes",
    icon: "🍽️",
    title: (target) => `Recetario ${target}`,
    description: (target) => `Guarda ${target} receta${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Recetas creadas: ${target}`,
    thresholds: [1, 5, 10, 25, 50, 100],
    getCurrentValue: (ctx) => ctx.modules.recipes.totalRecipes,
    unitLabel: "recetas",
  }),
  ...createThresholdAchievements({
    familyId: "recipes_logs",
    module: "recipes",
    icon: "🥗",
    title: (target) => `Diario de cocina ${target}`,
    description: (target) => `Registra comida ${target} días.`,
    criterion: (target) => `Días con registros: ${target}`,
    thresholds: SCALE_TRACKING_DAYS,
    getCurrentValue: (ctx) => ctx.modules.recipes.foodLogDays,
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "recipes_consumptions",
    module: "recipes",
    icon: "🍴",
    title: (target) => `Buen apetito ${target}`,
    description: (target) => `Suma ${target} consumos registrados.`,
    criterion: (target) => `Consumos registrados: ${target}`,
    thresholds: [10, 25, 50, 100, 250, 500, 1000],
    getCurrentValue: (ctx) => ctx.modules.recipes.totalConsumptions,
    unitLabel: "registros",
  }),
  ...createThresholdAchievements({
    familyId: "recipes_cooks",
    module: "recipes",
    icon: "👨‍🍳",
    title: (target) => `Fogón ${target}`,
    description: (target) => `Cocina o marca ${target} preparaciones.`,
    criterion: (target) => `Cocciones registradas: ${target}`,
    thresholds: [3, 10, 25, 50, 100, 250],
    getCurrentValue: (ctx) => ctx.modules.recipes.totalRecipeCooks,
    unitLabel: "preparaciones",
  }),
  ...createThresholdAchievements({
    familyId: "recipes_rice",
    module: "recipes",
    icon: "🍚",
    hidden: true,
    title: (target) => (target >= 25 ? "Culto al arroz" : "Fan del arroz"),
    description: (target) => `Registra ${target} consumos relacionados con arroz.`,
    criterion: (target) => `Consumos de arroz: ${target}`,
    thresholds: [5, 10, 25],
    getCurrentValue: (ctx) => ctx.modules.recipes.keywordCounts.rice,
    unitLabel: "registros",
  }),
  ...createThresholdAchievements({
    familyId: "recipes_coffee",
    module: "recipes",
    icon: "☕",
    hidden: true,
    title: (target) => (target >= 30 ? "Café Club" : "Pausa café"),
    description: (target) => `Registra ${target} cafés o bebidas afines.`,
    criterion: (target) => `Consumos de café: ${target}`,
    thresholds: [5, 15, 30],
    getCurrentValue: (ctx) => ctx.modules.recipes.keywordCounts.coffee,
    unitLabel: "registros",
  }),

  ...createThresholdAchievements({
    familyId: "gym_workouts",
    module: "gym",
    icon: "🏋️",
    title: (target) => `Constancia ${target}`,
    description: (target) => `Completa ${target} entrenamiento${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Entrenamientos: ${target}`,
    thresholds: SCALE_EXTENDED,
    getCurrentValue: (ctx) => ctx.modules.gym.totalWorkouts,
    unitLabel: "entrenamientos",
  }),
  ...createThresholdAchievements({
    familyId: "gym_days",
    module: "gym",
    icon: "📅",
    title: (target) => `Semana activa ${target}`,
    description: (target) => `Suma ${target} días de actividad gym/cardio.`,
    criterion: (target) => `Días activos de gym: ${target}`,
    thresholds: SCALE_TRACKING_DAYS,
    getCurrentValue: (ctx) => ctx.modules.gym.totalActiveDays,
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "gym_streak",
    module: "gym",
    icon: "🔥",
    title: (target) => `Racha gym ${target}`,
    description: (target) => `Mantén ${target} días seguidos de entrenamiento.`,
    criterion: (target) => `Racha gym: ${target} días`,
    thresholds: SCALE_STREAK_DAYS,
    getCurrentValue: (ctx) => Math.max(ctx.modules.gym.activeStreakCurrent, ctx.modules.gym.activeStreakBest),
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "gym_volume",
    module: "gym",
    icon: "💪",
    title: (target) => `Volumen ${target}`,
    description: (target) => `Acumula ${target} kg de volumen estimado.`,
    criterion: (target) => `Volumen acumulado: ${target} kg`,
    thresholds: SCALE_VOLUME,
    getCurrentValue: (ctx) => ctx.modules.gym.totalVolume,
    unitLabel: "kg",
  }),

  ...createThresholdAchievements({
    familyId: "habits_completions",
    module: "habits",
    icon: "✅",
    title: (target) => `Hábitos ${target}`,
    description: (target) => `Suma ${target} completados de hábitos.`,
    criterion: (target) => `Completados de hábitos: ${target}`,
    thresholds: SCALE_EXTENDED,
    getCurrentValue: (ctx) => ctx.modules.habits.totalCompletions,
    unitLabel: "completados",
  }),
  ...createThresholdAchievements({
    familyId: "habits_streak",
    module: "habits",
    icon: "🔥",
    title: (target) => `Ritual ${target}`,
    description: (target) => `Alcanza una racha de ${target} días en un hábito.`,
    criterion: (target) => `Mejor racha de hábito: ${target} días`,
    thresholds: SCALE_STREAK_DAYS,
    getCurrentValue: (ctx) => ctx.modules.habits.bestHabitStreak,
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "habits_all",
    module: "habits",
    icon: "🌞",
    title: (target) => `Día perfecto ${target}`,
    description: (target) => `Completa todos los hábitos activos ${target} veces.`,
    criterion: (target) => `Días con todos los hábitos hechos: ${target}`,
    thresholds: [1, 5, 10, 25, 50, 100, 250],
    getCurrentValue: (ctx) => ctx.modules.habits.allHabitsDays,
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "habits_tracking",
    module: "habits",
    icon: "📈",
    title: (target) => `Seguimiento ${target}`,
    description: (target) => `Registra hábitos durante ${target} días.`,
    criterion: (target) => `Días con actividad de hábitos: ${target}`,
    thresholds: SCALE_TRACKING_DAYS,
    getCurrentValue: (ctx) => ctx.modules.habits.trackingDays,
    unitLabel: "días",
  }),

  ...createThresholdAchievements({
    familyId: "finance_transactions",
    module: "finance",
    icon: "💳",
    title: (target) => `Control ${target}`,
    description: (target) => `Registra ${target} movimiento${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Movimientos registrados: ${target}`,
    thresholds: SCALE_EXTENDED,
    getCurrentValue: (ctx) => ctx.modules.finance.transactionCount,
    unitLabel: "movimientos",
  }),
  ...createThresholdAchievements({
    familyId: "finance_days",
    module: "finance",
    icon: "🗓️",
    title: (target) => `Seguimiento ${target}`,
    description: (target) => `Mantén finanzas registradas ${target} días.`,
    criterion: (target) => `Días con seguimiento financiero: ${target}`,
    thresholds: SCALE_TRACKING_DAYS,
    getCurrentValue: (ctx) => ctx.modules.finance.trackingDays,
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "finance_budgets",
    module: "finance",
    icon: "🎯",
    title: (target) => `Presupuesto ${target}`,
    description: (target) => `Crea ${target} presupuesto${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Presupuestos: ${target}`,
    thresholds: [1, 3, 6, 12, 24],
    getCurrentValue: (ctx) => ctx.modules.finance.budgetCount,
    unitLabel: "presupuestos",
  }),
  ...createThresholdAchievements({
    familyId: "finance_goals",
    module: "finance",
    icon: "🏁",
    title: (target) => `Objetivos ${target}`,
    description: (target) => `Define ${target} objetivo${target === 1 ? "" : "s"} financiero${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Objetivos financieros: ${target}`,
    thresholds: [1, 3, 5, 10],
    getCurrentValue: (ctx) => ctx.modules.finance.goalCount,
    unitLabel: "objetivos",
  }),

  ...createThresholdAchievements({
    familyId: "notes_items",
    module: "notes",
    icon: "📝",
    title: (target) => `Archivista ${target}`,
    description: (target) => `Crea ${target} nota${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Notas creadas: ${target}`,
    thresholds: [1, 5, 10, 25, 50, 100, 250],
    getCurrentValue: (ctx) => ctx.modules.notes.noteCount,
    unitLabel: "notas",
  }),
  ...createThresholdAchievements({
    familyId: "notes_folders",
    module: "notes",
    icon: "📁",
    title: (target) => `Orden mental ${target}`,
    description: (target) => `Organiza ${target} carpeta${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Carpetas creadas: ${target}`,
    thresholds: [1, 3, 5, 10, 25],
    getCurrentValue: (ctx) => ctx.modules.notes.folderCount,
    unitLabel: "carpetas",
  }),

  ...createThresholdAchievements({
    familyId: "videos_items",
    module: "videos",
    icon: "🎬",
    title: (target) => `Creador ${target}`,
    description: (target) => `Abre ${target} proyecto${target === 1 ? "" : "s"} de vídeo.`,
    criterion: (target) => `Proyectos de vídeo: ${target}`,
    thresholds: [1, 3, 5, 10, 25, 50],
    getCurrentValue: (ctx) => ctx.modules.videos.videoCount,
    unitLabel: "vídeos",
  }),
  ...createThresholdAchievements({
    familyId: "videos_words",
    module: "videos",
    icon: "⌨️",
    title: (target) => `Guion ${target}`,
    description: (target) => `Escribe ${target} palabras en tus vídeos.`,
    criterion: (target) => `Palabras escritas: ${target}`,
    thresholds: [500, 1000, 5000, 10000, 25000, 50000],
    getCurrentValue: (ctx) => ctx.modules.videos.totalWords,
    unitLabel: "palabras",
  }),
  ...createThresholdAchievements({
    familyId: "videos_published",
    module: "videos",
    icon: "🚀",
    title: (target) => `Publicado ${target}`,
    description: (target) => `Marca ${target} vídeo${target === 1 ? "" : "s"} como publicado${target === 1 ? "" : "s"}.`,
    criterion: (target) => `Vídeos publicados: ${target}`,
    thresholds: [1, 3, 5, 10, 25, 50],
    getCurrentValue: (ctx) => ctx.modules.videos.publishedCount,
    unitLabel: "publicados",
  }),

  ...createThresholdAchievements({
    familyId: "media_items",
    module: "media",
    icon: "🎞️",
    title: (target) => `Pantalla ${target}`,
    description: (target) => `Añade ${target} título${target === 1 ? "" : "s"} a media.`,
    criterion: (target) => `Entradas de media: ${target}`,
    thresholds: [1, 5, 10, 25, 50, 100, 250, 500],
    getCurrentValue: (ctx) => ctx.modules.media.mediaCount,
    unitLabel: "entradas",
  }),
  ...createThresholdAchievements({
    familyId: "media_days",
    module: "media",
    icon: "📺",
    title: (target) => `Sesión ${target}`,
    description: (target) => `Registra media en ${target} días distintos.`,
    criterion: (target) => `Días con actividad en media: ${target}`,
    thresholds: SCALE_TRACKING_DAYS,
    getCurrentValue: (ctx) => ctx.modules.media.watchDays,
    unitLabel: "días",
  }),

  ...createThresholdAchievements({
    familyId: "general_sessions",
    module: "general",
    icon: "👋",
    title: (target) => `Vuelta ${target}`,
    description: (target) => `Entra ${target} veces en la app.`,
    criterion: (target) => `Sesiones abiertas: ${target}`,
    thresholds: SCALE_EXTENDED,
    getCurrentValue: (ctx) => ctx.general.sessions,
    unitLabel: "sesiones",
  }),
  ...createThresholdAchievements({
    familyId: "general_days",
    module: "general",
    icon: "🗓️",
    title: (target) => `Presencia ${target}`,
    description: (target) => `Usa la app durante ${target} días.`,
    criterion: (target) => `Días de uso: ${target}`,
    thresholds: SCALE_TRACKING_DAYS,
    getCurrentValue: (ctx) => ctx.general.activeDays,
    unitLabel: "días",
  }),
  ...createThresholdAchievements({
    familyId: "general_modules",
    module: "general",
    icon: "🧩",
    title: (target) => `Multitarea ${target}`,
    description: (target) => `Activa ${target} módulos distintos.`,
    criterion: (target) => `Módulos con actividad: ${target}`,
    thresholds: [3, 5, 7, 9],
    getCurrentValue: (ctx) => ctx.general.modulesWithData,
    unitLabel: "módulos",
  }),
  ...createThresholdAchievements({
    familyId: "general_actions",
    module: "general",
    icon: "⚡",
    title: (target) => `Impulso ${target}`,
    description: (target) => `Acumula ${target} acciones globales entre módulos.`,
    criterion: (target) => `Acciones globales: ${target}`,
    thresholds: [10, 25, 50, 100, 250, 500, 1000],
    getCurrentValue: (ctx) => ctx.general.combinedActions,
    unitLabel: "acciones",
  }),
];

let cachedCatalogKey = "";
let cachedCatalog = BASE_CATALOG;

function buildDynamicCatalogKey(context = {}) {
  const habitEntities = context?.modules?.habits?.habitEntities || {};
  const parts = Object.values(habitEntities)
    .filter((entity) => entity && (!entity.archived || entity.hasData))
    .sort((a, b) => String(a.name || a.id || "").localeCompare(String(b.name || b.id || ""), "es"))
    .map((entity) => [
      sanitizeAchievementKeyPart(entity.id),
      sanitizeAchievementKeyPart(entity.name || ""),
      sanitizeAchievementKeyPart(entity.goalType || "check"),
      entity.archived ? "1" : "0",
      entity.hasData ? "1" : "0",
    ].join(":"));
  return parts.join("|");
}

function buildDynamicCatalog(context = {}) {
  const habitEntities = context?.modules?.habits?.habitEntities || {};
  return Object.values(habitEntities)
    .filter((entity) => entity && entity.id && (!entity.archived || entity.hasData))
    .sort((a, b) => String(a.name || a.id || "").localeCompare(String(b.name || b.id || ""), "es"))
    .flatMap((entity) => createHabitEntityAchievements({ context, habitId: entity.id }));
}

export function getAchievementCatalog(context = null) {
  const cacheKey = buildDynamicCatalogKey(context || {});
  if (!cacheKey) return BASE_CATALOG;
  if (cacheKey === cachedCatalogKey) return cachedCatalog;
  cachedCatalogKey = cacheKey;
  cachedCatalog = [...BASE_CATALOG, ...buildDynamicCatalog(context || {})];
  return cachedCatalog;
}

export function getAchievementById(achievementId = "", context = null) {
  return getAchievementCatalog(context).find((achievement) => achievement.id === achievementId) || null;
}

export function getAchievementModuleMeta(moduleKey = "") {
  return MODULE_META[moduleKey] || MODULE_META.general;
}
