import { mapSnapshotToDomain } from "../../../modules/notes/persist/notes-mapper.js";

export const MODULE_META = Object.freeze({
  general: { key: "general", label: "General", emoji: "✨", viewId: "" },
  books: { key: "books", label: "Libros", emoji: "📚", viewId: "view-books" },
  recipes: { key: "recipes", label: "Recetas", emoji: "🍳", viewId: "view-recipes" },
  gym: { key: "gym", label: "Gym", emoji: "🏋️", viewId: "view-gym" },
  habits: { key: "habits", label: "Hábitos", emoji: "✅", viewId: "view-habits" },
  finance: { key: "finance", label: "Finanzas", emoji: "💸", viewId: "view-finance" },
  notes: { key: "notes", label: "Notas", emoji: "🗒️", viewId: "view-notes" },
  videos: { key: "videos", label: "Vídeos", emoji: "🎬", viewId: "view-videos-hub" },
  media: { key: "media", label: "Media", emoji: "🎞️", viewId: "view-media" },
});

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MODULE_KEYS = Object.keys(MODULE_META).filter((key) => key !== "general");

function formatDatePart(value) {
  return String(value).padStart(2, "0");
}

function dateToKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${formatDatePart(date.getMonth() + 1)}-${formatDatePart(date.getDate())}`;
}

function parseDateKey(key) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key || "").trim());
  if (!match) return null;
  const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function timestampToKey(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())) {
    return value.trim();
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return "";
  return dateToKey(new Date(numeric));
}

function normalizeDayKey(value) {
  return timestampToKey(value);
}

function normalizeKeywordText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function countObjectKeys(value) {
  return value && typeof value === "object" ? Object.keys(value).length : 0;
}

function getTodayKey() {
  return dateToKey(new Date());
}

function getYesterdayKey() {
  return dateToKey(new Date(Date.now() - ONE_DAY_MS));
}

function buildStreakStats(dayKeys = []) {
  const ordered = Array.from(
    new Set(
      (dayKeys || [])
        .map((key) => String(key || "").trim())
        .filter((key) => /^\d{4}-\d{2}-\d{2}$/.test(key)),
    ),
  ).sort();

  let best = 0;
  let rolling = 0;
  let previousTs = 0;

  ordered.forEach((key) => {
    const parsed = parseDateKey(key);
    if (!parsed) return;
    const ts = parsed.getTime();
    if (previousTs && Math.round((ts - previousTs) / ONE_DAY_MS) === 1) {
      rolling += 1;
    } else {
      rolling = 1;
    }
    previousTs = ts;
    if (rolling > best) best = rolling;
  });

  let current = 0;
  const latestKey = ordered[ordered.length - 1] || "";
  if (latestKey) {
    const latestDate = parseDateKey(latestKey);
    const today = parseDateKey(getTodayKey());
    const yesterday = parseDateKey(getYesterdayKey());
    if (
      latestDate
      && (
        latestKey === getTodayKey()
        || latestKey === getYesterdayKey()
        || (
          today
          && yesterday
          && latestDate.getTime() >= yesterday.getTime()
          && latestDate.getTime() <= today.getTime()
        )
      )
    ) {
      current = 1;
      for (let index = ordered.length - 2; index >= 0; index -= 1) {
        const currentDate = parseDateKey(ordered[index]);
        const nextDate = parseDateKey(ordered[index + 1]);
        if (!currentDate || !nextDate) break;
        if (Math.round((nextDate.getTime() - currentDate.getTime()) / ONE_DAY_MS) !== 1) break;
        current += 1;
      }
    }
  }

  return {
    current,
    best,
    totalDays: ordered.length,
    latestKey,
    ordered,
  };
}

function createModuleMetrics(key, extra = {}) {
  const defaults = getModuleMetricDefaults(key);
  return {
    key,
    label: MODULE_META[key]?.label || key,
    emoji: MODULE_META[key]?.emoji || "•",
    hasData: false,
    activityScore: 0,
    milestoneCount: 0,
    ...defaults,
    ...extra,
    ...(defaults.keywordCounts || extra.keywordCounts
      ? {
        keywordCounts: {
          ...(defaults.keywordCounts || {}),
          ...(extra.keywordCounts || {}),
        },
      }
      : {}),
  };
}

function getModuleMetricDefaults(key = "") {
  switch (key) {
    case "books":
      return {
        totalBooks: 0,
        finishedBooks: 0,
        pagesRead: 0,
        readingDays: 0,
        readingStreakCurrent: 0,
        readingStreakBest: 0,
        distinctGenres: 0,
      };
    case "recipes":
      return {
        totalRecipes: 0,
        totalRecipeCooks: 0,
        foodLogDays: 0,
        foodLogStreakCurrent: 0,
        foodLogStreakBest: 0,
        totalConsumptions: 0,
        trackedProducts: 0,
        keywordCounts: {
          rice: 0,
          coffee: 0,
          chicken: 0,
        },
      };
    case "gym":
      return {
        totalWorkouts: 0,
        totalCardioSessions: 0,
        totalActiveDays: 0,
        workoutStreakCurrent: 0,
        workoutStreakBest: 0,
        activeStreakCurrent: 0,
        activeStreakBest: 0,
        totalVolume: 0,
      };
    case "habits":
      return {
        activeHabitsCount: 0,
        totalCompletions: 0,
        trackingDays: 0,
        trackingStreakCurrent: 0,
        trackingStreakBest: 0,
        bestHabitStreak: 0,
        allHabitsDays: 0,
        allHabitsStreakCurrent: 0,
        allHabitsStreakBest: 0,
      };
    case "finance":
      return {
        accountCount: 0,
        transactionCount: 0,
        budgetCount: 0,
        goalCount: 0,
        trackingDays: 0,
        trackingStreakCurrent: 0,
        trackingStreakBest: 0,
      };
    case "notes":
      return {
        noteCount: 0,
        folderCount: 0,
        activeDays: 0,
        activeStreakCurrent: 0,
        activeStreakBest: 0,
      };
    case "videos":
      return {
        videoCount: 0,
        publishedCount: 0,
        totalWords: 0,
        activeDays: 0,
        activeStreakCurrent: 0,
        activeStreakBest: 0,
      };
    case "media":
      return {
        mediaCount: 0,
        rewatchCount: 0,
        watchDays: 0,
        watchStreakCurrent: 0,
        watchStreakBest: 0,
      };
    default:
      return {};
  }
}

function isFinishedBook(book = {}) {
  const pages = Math.max(0, toNumber(book.pages));
  const currentPage = Math.max(0, toNumber(book.currentPage));
  return book.status === "finished" || (pages > 0 && currentPage >= pages);
}

export function deriveBooksMetrics(snapshot = {}) {
  const booksMap = snapshot?.books && typeof snapshot.books === "object" ? snapshot.books : {};
  const readingLog = snapshot?.readingLog && typeof snapshot.readingLog === "object" ? snapshot.readingLog : {};
  const books = Object.values(booksMap || {});
  const finishedBooks = books.filter((book) => isFinishedBook(book));
  const pagesRead = Object.values(readingLog || {}).reduce((sum, perDay) => {
    const total = Object.values(perDay || {}).reduce((daySum, value) => daySum + Math.max(0, toNumber(value)), 0);
    return sum + total;
  }, 0);
  const readingDays = Object.entries(readingLog || {})
    .filter(([, perDay]) => Object.values(perDay || {}).some((value) => toNumber(value) > 0))
    .map(([dayKey]) => dayKey);
  const streaks = buildStreakStats(readingDays);
  const distinctGenres = new Set(
    finishedBooks
      .map((book) => String(book?.genre || "").trim())
      .filter(Boolean)
      .map((genre) => genre.toLowerCase()),
  ).size;

  return createModuleMetrics("books", {
    totalBooks: books.length,
    finishedBooks: finishedBooks.length,
    pagesRead,
    readingDays: readingDays.length,
    readingStreakCurrent: streaks.current,
    readingStreakBest: streaks.best,
    distinctGenres,
    hasData: books.length > 0 || pagesRead > 0,
    activityScore: finishedBooks.length + Math.min(readingDays.length, 50),
    milestoneCount: finishedBooks.length,
  });
}

function getRecipeList(snapshot = {}) {
  const recipesRoot = snapshot?.recipes && typeof snapshot.recipes === "object" ? snapshot.recipes : snapshot;
  return Object.entries(recipesRoot || {})
    .filter(([key, value]) => {
      if (key === "_init" || key === "nutrition" || key === "meta") return false;
      if (!value || typeof value !== "object") return false;
      return Boolean(value.id || value.title || value.meal || value.ingredients || value.steps);
    })
    .map(([id, value]) => ({ id, ...(value || {}) }));
}

function collectRecipeCookDates(recipe = {}) {
  const dates = new Set();
  (Array.isArray(recipe.cookedDates) ? recipe.cookedDates : []).forEach((dateKey) => {
    const safeDate = normalizeDayKey(dateKey);
    if (safeDate) dates.add(safeDate);
  });
  const lastCooked = normalizeDayKey(recipe.lastCooked);
  if (lastCooked) dates.add(lastCooked);
  const updatedAtKey = normalizeDayKey(recipe.updatedAt);
  if (dates.size === 0 && updatedAtKey) dates.add(updatedAtKey);
  return dates;
}

function getKeywordMatchers() {
  return {
    rice: /\b(arroz|rice|risotto|paella)\b/i,
    coffee: /\b(cafe|coffee|latte|espresso|capuccino|capuchino)\b/i,
    chicken: /\b(pollo|chicken|pavo|turkey)\b/i,
  };
}

function getRecipeEntryName(entry = {}, productsById = {}) {
  const direct = String(
    entry.productName
    || entry.nameSnapshot
    || entry.title
    || entry.recipeSnapshot?.title
    || entry.refId
    || "",
  ).trim();
  if (direct) return direct;
  const linkedProduct = productsById[String(entry.productId || entry.refId || "").trim()];
  return String(linkedProduct?.name || "").trim();
}

export function deriveRecipesMetrics(snapshot = {}) {
  const recipes = getRecipeList(snapshot?.recipes || snapshot);
  const nutrition = snapshot?.nutrition && typeof snapshot.nutrition === "object" ? snapshot.nutrition : {};
  const dailyLogsByDate = nutrition?.dailyLogsByDate && typeof nutrition.dailyLogsByDate === "object"
    ? nutrition.dailyLogsByDate
    : {};
  const products = Array.isArray(nutrition?.products) ? nutrition.products : [];
  const productsById = Object.fromEntries(
    products
      .filter((product) => product && typeof product === "object")
      .map((product) => [String(product.id || "").trim(), product]),
  );
  const cookDates = new Set();
  recipes.forEach((recipe) => {
    collectRecipeCookDates(recipe).forEach((dateKey) => cookDates.add(dateKey));
  });

  const logDays = [];
  let totalConsumptions = 0;
  const keywordCounts = { rice: 0, coffee: 0, chicken: 0 };
  const keywordMatchers = getKeywordMatchers();

  Object.entries(dailyLogsByDate || {}).forEach(([dateKey, log]) => {
    const meals = log?.meals && typeof log.meals === "object" ? log.meals : {};
    let hasEntries = false;
    ["breakfast", "lunch", "dinner", "snacks"].forEach((mealKey) => {
      const entries = Array.isArray(meals?.[mealKey]?.entries) ? meals[mealKey].entries : [];
      if (entries.length > 0) hasEntries = true;
      totalConsumptions += entries.length;
      entries.forEach((entry) => {
        const normalized = normalizeKeywordText(getRecipeEntryName(entry, productsById));
        if (!normalized) return;
        Object.entries(keywordMatchers).forEach(([keywordKey, matcher]) => {
          if (matcher.test(normalized)) keywordCounts[keywordKey] += 1;
        });
      });
    });
    if (hasEntries) logDays.push(dateKey);
  });

  const logStreak = buildStreakStats(logDays);

  return createModuleMetrics("recipes", {
    totalRecipes: recipes.length,
    totalRecipeCooks: cookDates.size,
    foodLogDays: logDays.length,
    foodLogStreakCurrent: logStreak.current,
    foodLogStreakBest: logStreak.best,
    totalConsumptions,
    trackedProducts: products.length,
    keywordCounts,
    hasData: recipes.length > 0 || logDays.length > 0 || products.length > 0,
    activityScore: totalConsumptions + recipes.length,
    milestoneCount: totalConsumptions,
  });
}

function getWorkoutDaysSet(workoutsByDate = {}) {
  const days = new Set();
  Object.entries(workoutsByDate || {}).forEach(([dateKey, dayWorkouts]) => {
    const count = countObjectKeys(dayWorkouts);
    if (count > 0) days.add(dateKey);
  });
  return days;
}

function getCardioDaysSet(cardioByDate = {}) {
  const days = new Set();
  Object.entries(cardioByDate || {}).forEach(([dateKey, value]) => {
    if (countObjectKeys(value) > 0) days.add(dateKey);
  });
  return days;
}

function estimateWorkoutVolume(workoutsByDate = {}) {
  let total = 0;
  Object.values(workoutsByDate || {}).forEach((dayWorkouts) => {
    Object.values(dayWorkouts || {}).forEach((workout) => {
      Object.values(workout?.exercises || {}).forEach((exercise) => {
        (Array.isArray(exercise?.sets) ? exercise.sets : []).forEach((set) => {
          const reps = Math.max(0, toNumber(set?.reps ?? set?.rep ?? set?.count));
          const kg = Math.max(
            0,
            toNumber(set?.kgEff ?? set?.effectiveKg ?? set?.weightKg ?? set?.kg ?? set?.extraKg),
          );
          total += kg * (reps || 1);
        });
      });
    });
  });
  return Math.round(total);
}

export function deriveGymMetrics(snapshot = {}) {
  const workoutsByDate = snapshot?.workoutsByDate && typeof snapshot.workoutsByDate === "object"
    ? snapshot.workoutsByDate
    : snapshot?.workouts && typeof snapshot.workouts === "object"
      ? snapshot.workouts
      : {};
  const cardioByDate = snapshot?.cardioByDate && typeof snapshot.cardioByDate === "object"
    ? snapshot.cardioByDate
    : snapshot?.cardio && typeof snapshot.cardio === "object"
      ? snapshot.cardio
      : {};
  const workoutDays = getWorkoutDaysSet(workoutsByDate);
  const cardioDays = getCardioDaysSet(cardioByDate);
  const activeDays = new Set([...workoutDays, ...cardioDays]);
  const workoutStreak = buildStreakStats(Array.from(workoutDays));
  const activeStreak = buildStreakStats(Array.from(activeDays));
  const totalWorkouts = Object.values(workoutsByDate || {}).reduce((sum, dayWorkouts) => sum + countObjectKeys(dayWorkouts), 0);
  const totalCardioSessions = Object.values(cardioByDate || {}).reduce((sum, value) => sum + countObjectKeys(value), 0);
  const totalVolume = estimateWorkoutVolume(workoutsByDate);

  return createModuleMetrics("gym", {
    totalWorkouts,
    totalCardioSessions,
    totalActiveDays: activeDays.size,
    workoutStreakCurrent: workoutStreak.current,
    workoutStreakBest: workoutStreak.best,
    activeStreakCurrent: activeStreak.current,
    activeStreakBest: activeStreak.best,
    totalVolume,
    hasData: totalWorkouts > 0 || totalCardioSessions > 0,
    activityScore: totalWorkouts + totalCardioSessions,
    milestoneCount: totalWorkouts,
  });
}

function isHabitSystem(habit = {}) {
  return Boolean(habit?.system);
}

function isHabitActive(habit = {}) {
  return habit && !habit.archived && !isHabitSystem(habit);
}

function collectHabitActivityDays(snapshot = {}) {
  const habits = snapshot?.habits && typeof snapshot.habits === "object" ? snapshot.habits : {};
  const habitChecks = snapshot?.habitChecks && typeof snapshot.habitChecks === "object" ? snapshot.habitChecks : {};
  const habitCounts = snapshot?.habitCounts && typeof snapshot.habitCounts === "object" ? snapshot.habitCounts : {};
  const habitSessions = snapshot?.habitSessions && typeof snapshot.habitSessions === "object" ? snapshot.habitSessions : {};
  const activeHabits = Object.entries(habits || {})
    .filter(([, habit]) => isHabitActive(habit))
    .map(([habitId]) => habitId);

  const activityByHabit = new Map();
  activeHabits.forEach((habitId) => {
    activityByHabit.set(habitId, new Set());
  });

  activeHabits.forEach((habitId) => {
    Object.entries(habitChecks?.[habitId] || {}).forEach(([dateKey, value]) => {
      if (value) activityByHabit.get(habitId)?.add(dateKey);
    });
    Object.entries(habitCounts?.[habitId] || {}).forEach(([dateKey, value]) => {
      if (toNumber(value) > 0) activityByHabit.get(habitId)?.add(dateKey);
    });
    Object.entries(habitSessions?.[habitId] || {}).forEach(([dateKey, value]) => {
      if (toNumber(value) > 0 || countObjectKeys(value) > 0) activityByHabit.get(habitId)?.add(dateKey);
    });
  });

  const allDays = new Set();
  let totalCompletions = 0;
  let bestStreak = 0;

  activityByHabit.forEach((days) => {
    const ordered = Array.from(days);
    ordered.forEach((dayKey) => allDays.add(dayKey));
    totalCompletions += ordered.length;
    bestStreak = Math.max(bestStreak, buildStreakStats(ordered).best);
  });

  const orderedActiveDays = Array.from(allDays).sort();
  const allHabitsDays = orderedActiveDays.filter((dateKey) => {
    if (!activeHabits.length) return false;
    return activeHabits.every((habitId) => activityByHabit.get(habitId)?.has(dateKey));
  });

  return {
    activeHabitsCount: activeHabits.length,
    totalCompletions,
    allDays: orderedActiveDays,
    bestStreak,
    allHabitsDays,
  };
}

export function deriveHabitsMetrics(snapshot = {}) {
  const activity = collectHabitActivityDays(snapshot);
  const trackingStreak = buildStreakStats(activity.allDays);
  const allHabitsStreak = buildStreakStats(activity.allHabitsDays);

  return createModuleMetrics("habits", {
    activeHabitsCount: activity.activeHabitsCount,
    totalCompletions: activity.totalCompletions,
    trackingDays: activity.allDays.length,
    trackingStreakCurrent: trackingStreak.current,
    trackingStreakBest: trackingStreak.best,
    bestHabitStreak: activity.bestStreak,
    allHabitsDays: activity.allHabitsDays.length,
    allHabitsStreakCurrent: allHabitsStreak.current,
    allHabitsStreakBest: allHabitsStreak.best,
    hasData: activity.activeHabitsCount > 0 || activity.totalCompletions > 0,
    activityScore: activity.totalCompletions,
    milestoneCount: activity.totalCompletions,
  });
}

export function mergeFinanceSnapshot(primary = {}, legacy = {}) {
  const rootA = primary && typeof primary === "object" ? primary : {};
  const rootB = legacy && typeof legacy === "object" ? legacy : {};
  const primaryBalance = rootA.balance && typeof rootA.balance === "object" ? rootA.balance : {};
  const legacyBalance = rootB.balance && typeof rootB.balance === "object" ? rootB.balance : {};
  return {
    accounts: {
      ...(rootB.accounts || {}),
      ...(rootA.accounts || {}),
    },
    transactions: {
      ...(legacyBalance.transactions || legacyBalance.tx2 || rootB.transactions || {}),
      ...(primaryBalance.transactions || primaryBalance.tx2 || rootA.transactions || {}),
    },
    budgets: {
      ...(legacyBalance.budgets || rootB.budgets || {}),
      ...(primaryBalance.budgets || rootA.budgets || {}),
    },
    goals: {
      goals: {
        ...((rootB.goals && rootB.goals.goals) || {}),
        ...((rootA.goals && rootA.goals.goals) || {}),
      },
    },
    snapshots: {
      ...(legacyBalance.snapshots || rootB.snapshots || {}),
      ...(primaryBalance.snapshots || rootA.snapshots || {}),
    },
  };
}

export function deriveFinanceMetrics(snapshot = {}) {
  const accounts = snapshot?.accounts && typeof snapshot.accounts === "object" ? snapshot.accounts : {};
  const transactions = snapshot?.transactions && typeof snapshot.transactions === "object" ? snapshot.transactions : {};
  const budgets = snapshot?.budgets && typeof snapshot.budgets === "object" ? snapshot.budgets : {};
  const goals = snapshot?.goals?.goals && typeof snapshot.goals.goals === "object" ? snapshot.goals.goals : {};
  const trackingDays = new Set();

  Object.values(transactions || {}).forEach((row) => {
    const candidates = [
      row?.day,
      row?.date,
      row?.monthDay,
      row?.createdAt,
      row?.updatedAt,
      row?.ts,
    ];
    const key = candidates.map(normalizeDayKey).find(Boolean);
    if (key) trackingDays.add(key);
  });

  Object.values(accounts || {}).forEach((account) => {
    Object.keys(account?.snapshots || {}).forEach((dayKey) => {
      const key = normalizeDayKey(dayKey);
      if (key) trackingDays.add(key);
    });
  });

  const trackingStreak = buildStreakStats(Array.from(trackingDays));
  const budgetCount = Object.values(budgets || {}).reduce((sum, monthBudgets) => sum + countObjectKeys(monthBudgets), 0);

  return createModuleMetrics("finance", {
    accountCount: countObjectKeys(accounts),
    transactionCount: countObjectKeys(transactions),
    budgetCount,
    goalCount: countObjectKeys(goals),
    trackingDays: trackingDays.size,
    trackingStreakCurrent: trackingStreak.current,
    trackingStreakBest: trackingStreak.best,
    hasData: countObjectKeys(accounts) > 0 || countObjectKeys(transactions) > 0,
    activityScore: countObjectKeys(transactions),
    milestoneCount: countObjectKeys(transactions),
  });
}

export function deriveNotesMetrics(snapshot = {}) {
  const domain = mapSnapshotToDomain(snapshot || {});
  const activeDays = new Set();
  domain.notes.forEach((note) => {
    const updated = normalizeDayKey(note.updatedAt || note.createdAt);
    if (updated) activeDays.add(updated);
  });
  const streak = buildStreakStats(Array.from(activeDays));

  return createModuleMetrics("notes", {
    noteCount: domain.notes.length,
    folderCount: domain.folders.length,
    activeDays: activeDays.size,
    activeStreakCurrent: streak.current,
    activeStreakBest: streak.best,
    hasData: domain.notes.length > 0 || domain.folders.length > 0,
    activityScore: domain.notes.length,
    milestoneCount: domain.notes.length,
  });
}

export function deriveVideosMetrics(snapshot = {}) {
  const videos = snapshot && typeof snapshot === "object" ? Object.values(snapshot) : [];
  const activeDays = new Set();
  let totalWords = 0;
  let publishedCount = 0;

  videos.forEach((video) => {
    totalWords += Math.max(0, toNumber(video?.wordCount));
    if (String(video?.status || "").trim().toLowerCase() === "published") {
      publishedCount += 1;
    }
    Object.keys(video?.dailyWordHistory || {}).forEach((dateKey) => {
      if (toNumber(video?.dailyWordHistory?.[dateKey]) > 0) activeDays.add(dateKey);
    });
    const fallbackKey = normalizeDayKey(video?.updatedAt || video?.createdAt);
    if (fallbackKey) activeDays.add(fallbackKey);
  });

  const streak = buildStreakStats(Array.from(activeDays));
  return createModuleMetrics("videos", {
    videoCount: videos.length,
    publishedCount,
    totalWords,
    activeDays: activeDays.size,
    activeStreakCurrent: streak.current,
    activeStreakBest: streak.best,
    hasData: videos.length > 0 || totalWords > 0,
    activityScore: videos.length + Math.floor(totalWords / 1000),
    milestoneCount: videos.length,
  });
}

export function deriveMediaMetrics(snapshot = {}) {
  const items = snapshot && typeof snapshot === "object" ? Object.values(snapshot) : [];
  const watchDays = new Set();
  items.forEach((item) => {
    (Array.isArray(item?.watchDates) ? item.watchDates : []).forEach((dateKey) => {
      const safe = normalizeDayKey(dateKey);
      if (safe) watchDays.add(safe);
    });
    const fallback = normalizeDayKey(item?.watchedAt || item?.updatedAt || item?.createdAt);
    if (fallback) watchDays.add(fallback);
  });
  const streak = buildStreakStats(Array.from(watchDays));

  return createModuleMetrics("media", {
    mediaCount: items.length,
    rewatchCount: items.filter((item) => toNumber(item?.seenCount) > 1).length,
    watchDays: watchDays.size,
    watchStreakCurrent: streak.current,
    watchStreakBest: streak.best,
    hasData: items.length > 0,
    activityScore: items.length,
    milestoneCount: items.length,
  });
}

export function computeModuleMetrics(moduleKey, snapshot) {
  switch (moduleKey) {
    case "books":
      return deriveBooksMetrics(snapshot);
    case "recipes":
      return deriveRecipesMetrics(snapshot);
    case "gym":
      return deriveGymMetrics(snapshot);
    case "habits":
      return deriveHabitsMetrics(snapshot);
    case "finance":
      return deriveFinanceMetrics(snapshot);
    case "notes":
      return deriveNotesMetrics(snapshot);
    case "videos":
      return deriveVideosMetrics(snapshot);
    case "media":
      return deriveMediaMetrics(snapshot);
    default:
      return createModuleMetrics(moduleKey);
  }
}

export function buildAchievementsContext(moduleMetrics = {}, usage = {}) {
  const modules = {};
  let modulesWithData = 0;
  let combinedActions = 0;

  MODULE_KEYS.forEach((moduleKey) => {
    const metrics = createModuleMetrics(moduleKey, moduleMetrics?.[moduleKey] || {});
    modules[moduleKey] = metrics;
    if (metrics.hasData) modulesWithData += 1;
    combinedActions += Math.max(0, toNumber(metrics.milestoneCount));
  });

  const sessions = Math.max(0, toNumber(usage?.sessions));
  const activeDays = countObjectKeys(usage?.activeDays || {});

  return {
    usage: {
      sessions,
      activeDays,
      raw: usage || {},
    },
    modules,
    general: {
      sessions,
      activeDays,
      modulesWithData,
      combinedActions,
    },
  };
}

export function getModuleKeys() {
  return [...MODULE_KEYS];
}
