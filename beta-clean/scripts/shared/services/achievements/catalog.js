import { MODULE_META } from "./metrics.js";

const MEDAL_TIERS = Object.freeze([
  { key: "none", label: "Sin medalla", shortLabel: "Sin", icon: "○" },
  { key: "bronze", label: "Bronce", shortLabel: "Bronce", icon: "🥉" },
  { key: "silver", label: "Plata", shortLabel: "Plata", icon: "🥈" },
  { key: "gold", label: "Oro", shortLabel: "Oro", icon: "🥇" },
  { key: "platinum", label: "Platino", shortLabel: "Platino", icon: "⬡" },
  { key: "emerald", label: "Esmeralda", shortLabel: "Esmeralda", icon: "✦" },
  { key: "ruby", label: "Rubí", shortLabel: "Rubí", icon: "◆" },
  { key: "obsidian", label: "Obsidiana", shortLabel: "Obsidiana", icon: "⬣" },
]);

function sanitizeKeyPart(value = "") {
  return String(value || "")
    .trim()
    .replace(/[.#$/\[\]]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function clampPositive(value) {
  return Math.max(0, toNumber(value));
}

function formatInteger(value) {
  return clampPositive(value).toLocaleString("es-ES", {
    maximumFractionDigits: 0,
  });
}

function formatHours(value) {
  const numeric = clampPositive(value);
  const hasFraction = Math.abs(numeric % 1) > 0.001;
  return `${numeric.toLocaleString("es-ES", {
    minimumFractionDigits: hasFraction && numeric < 10 ? 1 : 0,
    maximumFractionDigits: hasFraction ? 2 : 1,
  })} h`;
}

function formatKg(value) {
  return `${formatInteger(value)} kg`;
}

function formatWords(value) {
  return formatInteger(value);
}

function createMetricDefinition({
  id,
  module,
  title,
  icon,
  metricLabel,
  description,
  getValue,
  formatValue = formatInteger,
  tiers = [],
  extend = null,
  entityId = "",
  entityLabel = "",
  entityType = "metric",
  priority = 100,
}) {
  return {
    id: String(id || "").trim(),
    module: String(module || "general").trim(),
    title: String(title || "").trim(),
    icon: String(icon || "🏆").trim() || "🏆",
    metricLabel: String(metricLabel || "").trim(),
    description: String(description || "").trim(),
    getValue,
    formatValue,
    tiers: Array.from(
      new Set(
        (Array.isArray(tiers) ? tiers : [])
          .map((value) => Number(value))
          .filter((value) => Number.isFinite(value) && value > 0),
      ),
    ).sort((a, b) => a - b),
    extend: extend || { mode: "multiply", factor: 2, roundTo: 1 },
    entityId: String(entityId || "").trim(),
    entityLabel: String(entityLabel || title || "").trim(),
    entityType: String(entityType || "metric").trim(),
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 100,
  };
}

function getModuleMeta(moduleKey = "") {
  return MODULE_META[moduleKey] || MODULE_META.general;
}

function extendThreshold(previous = 0, strategy = {}) {
  const mode = String(strategy?.mode || "multiply").trim().toLowerCase();
  if (mode === "linear") {
    const step = Math.max(1, toNumber(strategy?.step || 1));
    return previous + step;
  }

  if (mode === "stepped") {
    const steps = Array.isArray(strategy?.steps) ? strategy.steps : [];
    const index = Math.max(0, toNumber(strategy?.index || 0));
    const step = Math.max(1, toNumber(steps[index] || steps[steps.length - 1] || 1));
    strategy.index = index + 1;
    return previous + step;
  }

  const factor = Math.max(1.05, toNumber(strategy?.factor || 2));
  const roundTo = Math.max(1, toNumber(strategy?.roundTo || 1));
  return Math.ceil((previous * factor) / roundTo) * roundTo;
}

function buildDynamicThresholds(definition, currentValue = 0, persistedLevelIndex = 0) {
  const base = Array.isArray(definition?.tiers) ? [...definition.tiers] : [];
  if (!base.length) return [];

  const targetLevel = Math.max(0, Number(persistedLevelIndex || 0)) + 2;
  const thresholds = [...base];
  const strategy = definition?.extend ? { ...definition.extend } : { mode: "multiply", factor: 2, roundTo: 1 };

  while (
    thresholds.length < targetLevel
    || clampPositive(currentValue) >= thresholds[thresholds.length - 1]
  ) {
    const previous = thresholds[thresholds.length - 1] || 1;
    const next = extendThreshold(previous, strategy);
    if (next <= previous) {
      thresholds.push(previous + 1);
    } else {
      thresholds.push(next);
    }
  }

  return thresholds;
}

function buildStaticDefinitions(context = {}) {
  const modules = context?.modules || {};
  const general = context?.general || {};

  return [
    createMetricDefinition({
      id: "general_sessions",
      module: "general",
      title: "Sesiones abiertas",
      icon: "👋",
      metricLabel: "sesiones",
      description: "Uso global acumulado de la app.",
      getValue: () => general.sessions || 0,
      tiers: [3, 10, 25, 60],
      extend: { mode: "multiply", factor: 1.8, roundTo: 5 },
      priority: 20,
    }),
    createMetricDefinition({
      id: "general_days",
      module: "general",
      title: "Días de uso",
      icon: "🗓",
      metricLabel: "días",
      description: "Constancia total en días distintos.",
      getValue: () => general.activeDays || 0,
      tiers: [3, 7, 14, 30, 60, 120],
      extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
      priority: 10,
    }),
    createMetricDefinition({
      id: "general_modules",
      module: "general",
      title: "Módulos activos",
      icon: "🧩",
      metricLabel: "módulos",
      description: "Variedad real de uso dentro de Bookshell.",
      getValue: () => general.modulesWithData || 0,
      tiers: [2, 4, 6, 8],
      extend: { mode: "linear", step: 1 },
      priority: 30,
    }),
    createMetricDefinition({
      id: "general_actions",
      module: "general",
      title: "Acciones registradas",
      icon: "⚡",
      metricLabel: "acciones",
      description: "Actividad total combinada entre módulos.",
      getValue: () => general.combinedActions || 0,
      tiers: [10, 50, 150, 400],
      extend: { mode: "multiply", factor: 1.8, roundTo: 25 },
      priority: 40,
    }),

    createMetricDefinition({
      id: "books_finished",
      module: "books",
      title: "Libros terminados",
      icon: "📚",
      metricLabel: "libros",
      description: "La progresión principal de lectura.",
      getValue: () => modules.books?.finishedBooks || 0,
      tiers: [1, 3, 8, 15, 30, 50, 75, 100],
      extend: { mode: "multiply", factor: 1.5, roundTo: 5 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "books_pages",
      module: "books",
      title: "Páginas leídas",
      icon: "📖",
      metricLabel: "páginas",
      description: "Volumen acumulado de lectura.",
      getValue: () => modules.books?.pagesRead || 0,
      tiers: [250, 1000, 2500, 5000, 10000, 20000],
      extend: { mode: "multiply", factor: 1.8, roundTo: 500 },
      priority: 15,
    }),
    createMetricDefinition({
      id: "books_streak",
      module: "books",
      title: "Racha lectora",
      icon: "🔥",
      metricLabel: "días",
      description: "Mejor racha de lectura.",
      getValue: () => Math.max(modules.books?.readingStreakCurrent || 0, modules.books?.readingStreakBest || 0),
      tiers: [3, 7, 14, 30, 60, 100],
      extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
      priority: 25,
    }),
    createMetricDefinition({
      id: "books_genres",
      module: "books",
      title: "Géneros explorados",
      icon: "🧠",
      metricLabel: "géneros",
      description: "Variedad lectora real.",
      getValue: () => modules.books?.distinctGenres || 0,
      tiers: [2, 4, 6, 10, 15, 20],
      extend: { mode: "linear", step: 5 },
      priority: 35,
    }),

    createMetricDefinition({
      id: "recipes_saved",
      module: "recipes",
      title: "Recetas guardadas",
      icon: "🍳",
      metricLabel: "recetas",
      description: "Tamaño de tu recetario.",
      getValue: () => modules.recipes?.totalRecipes || 0,
      tiers: [3, 10, 25, 50, 100],
      extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
      priority: 10,
    }),
    createMetricDefinition({
      id: "recipes_cooked",
      module: "recipes",
      title: "Preparaciones hechas",
      icon: "🥘",
      metricLabel: "preparaciones",
      description: "Veces que realmente cocinaste.",
      getValue: () => modules.recipes?.totalRecipeCooks || 0,
      tiers: [3, 10, 25, 60, 120],
      extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "recipes_logs",
      module: "recipes",
      title: "Días con registros",
      icon: "🗒",
      metricLabel: "días",
      description: "Seguimiento real de comida.",
      getValue: () => modules.recipes?.foodLogDays || 0,
      tiers: [3, 7, 14, 30, 60, 120],
      extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
      priority: 15,
    }),

    createMetricDefinition({
      id: "gym_workouts",
      module: "gym",
      title: "Entrenamientos",
      icon: "🏋️",
      metricLabel: "sesiones",
      description: "Volumen total de entrenos.",
      getValue: () => modules.gym?.totalWorkouts || 0,
      tiers: [5, 15, 35, 75, 150],
      extend: { mode: "multiply", factor: 1.75, roundTo: 5 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "gym_days",
      module: "gym",
      title: "Días activos",
      icon: "📆",
      metricLabel: "días",
      description: "Constancia global en gym.",
      getValue: () => modules.gym?.totalActiveDays || 0,
      tiers: [3, 10, 25, 50, 100, 180],
      extend: { mode: "multiply", factor: 1.6, roundTo: 5 },
      priority: 15,
    }),
    createMetricDefinition({
      id: "gym_volume",
      module: "gym",
      title: "Volumen movido",
      icon: "🏋",
      metricLabel: "kg",
      description: "Carga total acumulada.",
      getValue: () => modules.gym?.totalVolume || 0,
      formatValue: formatKg,
      tiers: [1000, 5000, 15000, 40000, 100000],
      extend: { mode: "multiply", factor: 1.9, roundTo: 1000 },
      priority: 25,
    }),

    createMetricDefinition({
      id: "habits_active",
      module: "habits",
      title: "Hábitos activos",
      icon: "✅",
      metricLabel: "hábitos",
      description: "Cantidad de hábitos vivos con seguimiento.",
      getValue: () => modules.habits?.activeHabitsCount || 0,
      tiers: [1, 3, 5, 8, 12],
      extend: { mode: "linear", step: 2 },
      priority: 30,
    }),
    createMetricDefinition({
      id: "habits_tracking",
      module: "habits",
      title: "Días con seguimiento",
      icon: "📈",
      metricLabel: "días",
      description: "Presencia acumulada del módulo de hábitos.",
      getValue: () => modules.habits?.trackingDays || 0,
      tiers: [3, 10, 25, 50, 100, 180],
      extend: { mode: "multiply", factor: 1.6, roundTo: 5 },
      priority: 20,
    }),
    createMetricDefinition({
      id: "habits_best_streak",
      module: "habits",
      title: "Mejor racha",
      icon: "🔥",
      metricLabel: "días",
      description: "La mejor racha lograda en cualquier hábito.",
      getValue: () => modules.habits?.bestHabitStreak || 0,
      tiers: [3, 7, 14, 30, 60, 100],
      extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
      priority: 25,
    }),

    createMetricDefinition({
      id: "finance_transactions",
      module: "finance",
      title: "Movimientos",
      icon: "💳",
      metricLabel: "movimientos",
      description: "Registros financieros acumulados.",
      getValue: () => modules.finance?.transactionCount || 0,
      tiers: [10, 50, 150, 400, 1000],
      extend: { mode: "multiply", factor: 1.8, roundTo: 25 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "finance_days",
      module: "finance",
      title: "Días de seguimiento",
      icon: "🗓",
      metricLabel: "días",
      description: "Constancia al registrar finanzas.",
      getValue: () => modules.finance?.trackingDays || 0,
      tiers: [3, 10, 25, 50, 100, 180],
      extend: { mode: "multiply", factor: 1.6, roundTo: 5 },
      priority: 15,
    }),
    createMetricDefinition({
      id: "finance_budgets",
      module: "finance",
      title: "Presupuestos",
      icon: "🎯",
      metricLabel: "presupuestos",
      description: "Estructura financiera creada.",
      getValue: () => modules.finance?.budgetCount || 0,
      tiers: [1, 3, 6, 12, 24],
      extend: { mode: "multiply", factor: 1.6, roundTo: 1 },
      priority: 25,
    }),
    createMetricDefinition({
      id: "finance_goals",
      module: "finance",
      title: "Objetivos financieros",
      icon: "🏁",
      metricLabel: "objetivos",
      description: "Metas definidas dentro del módulo.",
      getValue: () => modules.finance?.goalCount || 0,
      tiers: [1, 3, 5, 10, 20],
      extend: { mode: "linear", step: 5 },
      priority: 35,
    }),

    createMetricDefinition({
      id: "notes_items",
      module: "notes",
      title: "Notas creadas",
      icon: "📝",
      metricLabel: "notas",
      description: "Volumen total de notas.",
      getValue: () => modules.notes?.noteCount || 0,
      tiers: [3, 10, 25, 60, 150],
      extend: { mode: "multiply", factor: 1.8, roundTo: 5 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "notes_folders",
      module: "notes",
      title: "Carpetas creadas",
      icon: "📁",
      metricLabel: "carpetas",
      description: "Organización acumulada.",
      getValue: () => modules.notes?.folderCount || 0,
      tiers: [1, 3, 5, 10, 20],
      extend: { mode: "linear", step: 5 },
      priority: 15,
    }),
    createMetricDefinition({
      id: "notes_days",
      module: "notes",
      title: "Días activos",
      icon: "📆",
      metricLabel: "días",
      description: "Constancia en notas.",
      getValue: () => modules.notes?.activeDays || 0,
      tiers: [3, 10, 25, 50, 100],
      extend: { mode: "multiply", factor: 1.6, roundTo: 5 },
      priority: 25,
    }),

    createMetricDefinition({
      id: "videos_projects",
      module: "videos",
      title: "Proyectos de vídeo",
      icon: "🎬",
      metricLabel: "proyectos",
      description: "Volumen total de piezas abiertas.",
      getValue: () => modules.videos?.videoCount || 0,
      tiers: [1, 3, 8, 20, 40],
      extend: { mode: "multiply", factor: 1.7, roundTo: 1 },
      priority: 15,
    }),
    createMetricDefinition({
      id: "videos_published",
      module: "videos",
      title: "Vídeos publicados",
      icon: "🚀",
      metricLabel: "publicados",
      description: "Output real publicado.",
      getValue: () => modules.videos?.publishedCount || 0,
      tiers: [1, 3, 8, 20, 40, 80],
      extend: { mode: "multiply", factor: 1.7, roundTo: 1 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "videos_words",
      module: "videos",
      title: "Palabras escritas",
      icon: "⌨️",
      metricLabel: "palabras",
      description: "Producción de guión acumulada.",
      getValue: () => modules.videos?.totalWords || 0,
      formatValue: formatWords,
      tiers: [1000, 5000, 15000, 40000, 100000],
      extend: { mode: "multiply", factor: 1.9, roundTo: 1000 },
      priority: 25,
    }),

    createMetricDefinition({
      id: "media_watched",
      module: "media",
      title: "Títulos vistos",
      icon: "🎞",
      metricLabel: "títulos",
      description: "Escala alta para consumo audiovisual.",
      getValue: () => modules.media?.mediaCount || 0,
      tiers: [10, 30, 75, 150, 300, 500, 800, 1200],
      extend: { mode: "multiply", factor: 1.45, roundTo: 25 },
      priority: 5,
    }),
    createMetricDefinition({
      id: "media_rewatch",
      module: "media",
      title: "Rewatch",
      icon: "🔁",
      metricLabel: "rewatches",
      description: "Títulos revisitados más de una vez.",
      getValue: () => modules.media?.rewatchCount || 0,
      tiers: [1, 5, 15, 35, 75, 150],
      extend: { mode: "multiply", factor: 1.6, roundTo: 5 },
      priority: 15,
    }),
    createMetricDefinition({
      id: "media_days",
      module: "media",
      title: "Días con actividad",
      icon: "📺",
      metricLabel: "días",
      description: "Constancia de visionado.",
      getValue: () => modules.media?.watchDays || 0,
      tiers: [3, 10, 25, 50, 100, 180],
      extend: { mode: "multiply", factor: 1.6, roundTo: 5 },
      priority: 25,
    }),
  ];
}

function getHabitMetricConfig(entity = {}) {
  const goalType = String(entity?.goalType || "check").trim().toLowerCase();
  if (goalType === "time") {
    return {
      suffix: "time",
      metricLabel: "horas",
      description: "Horas acumuladas en este hábito.",
      formatValue: formatHours,
      getValue: () => clampPositive(entity.totalHours || 0),
      tiers: [5, 15, 40, 100, 250, 500],
      extend: { mode: "multiply", factor: 1.8, roundTo: 5 },
    };
  }

  if (goalType === "count") {
    return {
      suffix: "count",
      metricLabel: "veces",
      description: "Repeticiones acumuladas en este hábito.",
      formatValue: formatInteger,
      getValue: () => clampPositive(entity.totalCount || 0),
      tiers: [10, 50, 150, 400, 800, 1500],
      extend: { mode: "multiply", factor: 1.7, roundTo: 10 },
    };
  }

  return {
    suffix: "days",
    metricLabel: "días",
    description: "Días completados en este hábito.",
    formatValue: formatInteger,
    getValue: () => clampPositive(entity.completedDays || 0),
    tiers: [3, 7, 14, 30, 60, 120],
    extend: { mode: "multiply", factor: 1.7, roundTo: 5 },
  };
}

function buildHabitDefinitions(context = {}) {
  const entities = context?.modules?.habits?.habitEntities || {};
  return Object.values(entities)
    .filter((entity) => entity && entity.id && entity.hasData)
    .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "es"))
    .map((entity, index) => {
      const metric = getHabitMetricConfig(entity);
      const name = String(entity?.name || entity?.label || "Hábito").trim() || "Hábito";
      return createMetricDefinition({
        id: `habit_${sanitizeKeyPart(entity.id)}_${metric.suffix}`,
        module: "habits",
        title: name,
        icon: String(entity?.emoji || "").trim() || "✅",
        metricLabel: metric.metricLabel,
        description: metric.description,
        getValue: metric.getValue,
        formatValue: metric.formatValue,
        tiers: metric.tiers,
        extend: metric.extend,
        entityId: String(entity.id || "").trim(),
        entityLabel: name,
        entityType: "habit",
        priority: 100 + index,
      });
    });
}

export function getAchievementMedalTiers() {
  return MEDAL_TIERS;
}

export function getAchievementModuleMeta(moduleKey = "") {
  return getModuleMeta(moduleKey);
}

export function buildAchievementDefinitions(context = {}, persistedPanels = {}) {
  const definitions = [
    ...buildStaticDefinitions(context),
    ...buildHabitDefinitions(context),
  ];

  return definitions.map((definition) => {
    const persistedLevelIndex = Math.max(0, toNumber(persistedPanels?.[definition.id]?.levelIndex || 0));
    const currentValue = clampPositive(definition.getValue?.(context) || 0);
    return {
      ...definition,
      thresholds: buildDynamicThresholds(definition, currentValue, persistedLevelIndex),
    };
  });
}
