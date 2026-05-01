const APP_DATA_VERSION = "v2";
const USERS_SEGMENT = "users";
const PUBLIC_SEGMENT = "public";
const CATALOG_SEGMENT = "catalog";
const RTDB_FORBIDDEN_KEY_RE = /[.#$/\[\]]/g;
const RTDB_EXTRA_SANITIZE_RE = /[^a-z0-9_-]+/g;

function trimSlashes(value = "") {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function joinPath(...parts) {
  return parts
    .map((part) => trimSlashes(part))
    .filter(Boolean)
    .join("/");
}

function normalizeUserKeySeed(value = "") {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[@.]/g, "_")
    .replace(RTDB_FORBIDDEN_KEY_RE, "_")
    .replace(RTDB_EXTRA_SANITIZE_RE, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function sanitizeRtdbKeyPart(value = "") {
  return normalizeUserKeySeed(value);
}

export function getUserDataKey(user = null) {
  const rawEmail = typeof user === "object" && user
    ? String(user.email || "").trim()
    : "";
  const rawString = typeof user === "string" ? String(user || "").trim() : "";
  const rawUid = typeof user === "object" && user
    ? String(user.uid || "").trim()
    : "";

  const preferredSeed = rawEmail || rawString;
  const emailKey = preferredSeed ? normalizeUserKeySeed(preferredSeed) : "";
  if (emailKey) return emailKey;
  if (rawUid) return rawUid;
  return rawString || "";
}

export function buildUserDataContext(user = null) {
  const uid = typeof user === "object" && user
    ? String(user.uid || "").trim()
    : "";
  const userKey = getUserDataKey(user);
  return {
    uid,
    userKey,
    userRoot: userKey ? userRoot(userKey) : "",
    legacyUserRoot: uid ? legacyUserRoot(uid) : "",
  };
}

export function usersRoot() {
  return joinPath(APP_DATA_VERSION, USERS_SEGMENT);
}

// User root and shared meta live under v2/users/{userKey}.
export function userRoot(userKey = "") {
  return joinPath(usersRoot(), String(userKey || "").trim());
}

export function legacyUserRoot(uid = "") {
  return joinPath(usersRoot(), String(uid || "").trim());
}

export function userMeta(userKey = "") {
  return joinPath(userRoot(userKey), "meta");
}

export function userMetaSchemaVersion(userKey = "") {
  return joinPath(userMeta(userKey), "schemaVersion");
}

export function navLayout(userKey = "") {
  return joinPath(userMeta(userKey), "ui", "navLayout");
}

export function achievementsRoot(userKey = "") {
  return joinPath(userMeta(userKey), "achievements");
}

export function generalCenterRoot(userKey = "") {
  return joinPath(userMeta(userKey), "general");
}

// Books module branches.
export function booksRoot(userKey = "") {
  return joinPath(userRoot(userKey), "books");
}

export function booksLibrary(userKey = "") {
  return joinPath(booksRoot(userKey), "books");
}

export function booksReadingLog(userKey = "") {
  return joinPath(booksRoot(userKey), "readingLog");
}

export function booksLinks(userKey = "") {
  return joinPath(booksRoot(userKey), "links");
}

export function booksMetaGenres(userKey = "") {
  return joinPath(booksRoot(userKey), "meta", "genres");
}

// Habits module branches.
export function habitsRoot(userKey = "") {
  return joinPath(userRoot(userKey), "habits");
}

export function habits(userKey = "") {
  return joinPath(habitsRoot(userKey), "habits");
}

export function activeHabitSessions(userKey = "") {
  return joinPath(habits(userKey), "activeSessions");
}

export function habitChecks(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitChecks");
}

export function habitSessions(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitSessions");
}

export function habitCounts(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitCounts");
}

export function habitGroups(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitGroups");
}

export function habitPrefs(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitPrefs");
}

export function habitsCompareSettings(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitsCompareSettings");
}

export function habitsSchedule(userKey = "") {
  return joinPath(habitsRoot(userKey), "habitsSchedule");
}

export function habitsScheduleDayCredits(userKey = "") {
  return joinPath(habitsSchedule(userKey), "dayCredits");
}

export function habitUi(userKey = "") {
  return joinPath(habits(userKey), "ui");
}

export function habitUiQuickCounters(userKey = "") {
  return joinPath(habitUi(userKey), "quickCounters");
}

export function habitWorkSchedules(userKey = "") {
  return joinPath(habitsRoot(userKey), "workSchedules");
}

// Finance keeps a primary root plus a legacy fallback root for compatibility.
export function financeRoot(userKey = "") {
  return joinPath(userRoot(userKey), "finance", "finance");
}

export function legacyFinanceRoot(userKey = "") {
  return joinPath(userRoot(userKey), "finance");
}

export function financeTransactions(userKey = "") {
  return joinPath(financeRoot(userKey), "transactions");
}

export function financeAccounts(userKey = "") {
  return joinPath(financeRoot(userKey), "accounts");
}

export function financeFoodItems(userKey = "") {
  return joinPath(financeRoot(userKey), "foodItems");
}

export function financeCatalog(userKey = "") {
  return joinPath(financeRoot(userKey), "catalog");
}

export function financeCategories(userKey = "") {
  return joinPath(financeCatalog(userKey), "categories");
}

// Gym module branches.
export function gymRoot(userKey = "") {
  return joinPath(userRoot(userKey), "gym", "gym");
}

export function gymExercises(userKey = "") {
  return joinPath(gymRoot(userKey), "exercises");
}

export function gymTemplates(userKey = "") {
  return joinPath(gymRoot(userKey), "templates");
}

export function gymWorkouts(userKey = "") {
  return joinPath(gymRoot(userKey), "workouts");
}

export function gymBody(userKey = "") {
  return joinPath(gymRoot(userKey), "body");
}

export function gymCardio(userKey = "") {
  return joinPath(gymRoot(userKey), "cardio");
}

// Recipes keeps a root node and an items sub-collection for current data.
export function recipesRoot(userKey = "") {
  return joinPath(userRoot(userKey), "recipes");
}

export function recipesItems(userKey = "") {
  return joinPath(recipesRoot(userKey), "items");
}

export function recipesFoodItems(userKey = "") {
  return joinPath(recipesRoot(userKey), "foodItems");
}

export function recipesNutrition(userKey = "") {
  return joinPath(recipesRoot(userKey), "nutrition");
}

// World keeps a legacy trips branch alongside the current world branch.
export function world(userKey = "") {
  return joinPath(userRoot(userKey), "world");
}

export function worldWatch(userKey = "") {
  return joinPath(world(userKey), "watch");
}

export function legacyWorldTrips(userKey = "") {
  return joinPath(userRoot(userKey), "trips");
}

// Notes and reminders live under the notes root.
export function notes(userKey = "") {
  return joinPath(userRoot(userKey), "notes");
}

export function notesFolders(userKey = "") {
  return joinPath(notes(userKey), "folders");
}

export function notesEntries(userKey = "") {
  return joinPath(notes(userKey), "notes");
}

export function reminders(userKey = "") {
  return joinPath(notes(userKey), "reminders");
}

export function reminderCategories(userKey = "") {
  return joinPath(notes(userKey), "reminderCategories");
}

export function reminderPreferences(userKey = "") {
  return joinPath(notes(userKey), "reminderPreferences");
}

export function videos(userKey = "") {
  return joinPath(userRoot(userKey), "videos");
}

export function videosHub(userKey = "") {
  return joinPath(userRoot(userKey), "videosHub");
}

export function videosHubVideos(userKey = "") {
  return joinPath(videosHub(userKey), "videos");
}

export function improvements(userKey = "") {
  return joinPath(userRoot(userKey), "improvements");
}

export function media(userKey = "") {
  return joinPath(userRoot(userKey), "movies", "media");
}

export function gamesRoot(userKey = "") {
  return joinPath(userRoot(userKey), "games");
}

export function publicRoot() {
  return joinPath(APP_DATA_VERSION, PUBLIC_SEGMENT);
}

// Shared public catalogs are intentionally outside user roots.
export function publicCatalog() {
  return joinPath(publicRoot(), CATALOG_SEGMENT);
}

export function publicCatalogFoodItems() {
  return joinPath(publicCatalog(), "foodItems");
}

export function publicCatalogFinanceProducts() {
  return joinPath(publicCatalog(), "financeProducts");
}

export function publicCatalogGymExercises() {
  return joinPath(publicCatalog(), "gymExercises");
}

export const PUBLIC_PATHS = Object.freeze({
  root: publicRoot(),
  catalog: publicCatalog(),
  foodItems: publicCatalogFoodItems(),
  financeProducts: publicCatalogFinanceProducts(),
  gymExercises: publicCatalogGymExercises(),
});

export const firebasePaths = Object.freeze({
  usersRoot,
  userRoot,
  legacyUserRoot,
  userMeta,
  userMetaSchemaVersion,
  navLayout,
  achievementsRoot,
  generalCenterRoot,
  booksRoot,
  booksLibrary,
  booksReadingLog,
  booksLinks,
  booksMetaGenres,
  habitsRoot,
  habits,
  activeHabitSessions,
  habitChecks,
  habitSessions,
  habitCounts,
  habitGroups,
  habitPrefs,
  habitsCompareSettings,
  habitsSchedule,
  habitsScheduleDayCredits,
  habitUi,
  habitUiQuickCounters,
  habitWorkSchedules,
  financeRoot,
  legacyFinanceRoot,
  financeTransactions,
  financeAccounts,
  financeFoodItems,
  financeCatalog,
  financeCategories,
  gymRoot,
  gymExercises,
  gymTemplates,
  gymWorkouts,
  gymBody,
  gymCardio,
  recipesRoot,
  recipesItems,
  recipesFoodItems,
  recipesNutrition,
  world,
  worldWatch,
  legacyWorldTrips,
  notes,
  notesFolders,
  notesEntries,
  reminders,
  reminderCategories,
  reminderPreferences,
  videos,
  videosHub,
  videosHubVideos,
  improvements,
  media,
  gamesRoot,
  publicRoot,
  publicCatalog,
  publicCatalogFoodItems,
  publicCatalogFinanceProducts,
  publicCatalogGymExercises,
});
