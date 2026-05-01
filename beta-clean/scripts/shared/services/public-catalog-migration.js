import { db } from "../firebase/index.js";
import { get, ref, set, push } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { normalizeCatalogName } from "./public-catalog.js";

const PUBLIC_PATHS = {
  foodItems: "v2/public/products",
  financeProducts: "v2/public/products",
  gymExercises: "v2/public/exercises",
};

const PRIVATE_KEYS = new Set(["ticketId", "accountId", "movementId", "userId", "priceHistory", "purchaseDate", "lastPurchaseAt", "preferredStore", "privateNotes", "notes", "recipeId", "workoutId", "ticket", "tickets"]);

function sanitizeCatalogItem(raw = {}, type = "food", uid = "") {
  const clean = { ...raw };
  Object.keys(clean).forEach((k) => { if (PRIVATE_KEYS.has(k)) delete clean[k]; });
  const name = String(clean.name || clean.title || "").trim();
  const normalizedName = normalizeCatalogName(clean.normalizedName || name);
  if (!name || !normalizedName) return null;
  const now = Date.now();
  const base = {
    id: String(clean.id || "").trim(),
    name,
    normalizedName,
    brand: String(clean.brand || "").trim(),
    barcode: String(clean.barcode || "").trim(),
    category: String(clean.category || clean.muscle || clean.group || "").trim(),
    baseUnit: String(clean.baseUnit || clean.unit || "").trim(),
    unit: String(clean.unit || clean.baseUnit || "").trim(),
    macros: clean.macros && typeof clean.macros === "object" ? clean.macros : undefined,
    createdByUid: String(clean.createdByUid || uid || "").trim(),
    migratedFromUid: uid,
    migratedAt: now,
    updatedAt: now,
    source: "migration",
    usageCount: Number(clean.usageCount) || 0,
    exerciseType: type === "gym" ? String(clean.type || "strength").trim() : undefined,
    unilateral: type === "gym" ? !!clean.unilateral : undefined,
  };
  Object.keys(base).forEach((k) => (base[k] == null || base[k] === "") && delete base[k]);
  return base;
}

function dedupeKey(item = {}) {
  if (item.barcode) return `barcode:${item.barcode}`;
  if (item.normalizedName && item.brand) return `name-brand:${item.normalizedName}|${normalizeCatalogName(item.brand)}`;
  return `name-cat:${item.normalizedName}|${normalizeCatalogName(item.category || "")}`;
}

async function upsertByDedupe(catalogPath, item, seenMap) {
  const key = dedupeKey(item);
  if (!key || seenMap.has(key)) return { skipped: true };
  seenMap.set(key, true);
  const entryRef = push(ref(db, catalogPath));
  const payload = { ...item, id: entryRef.key };
  await set(entryRef, payload);
  return { migrated: true, id: entryRef.key };
}

export async function migrateUserCatalogsToPublicCatalog() {
  const stats = { usersRead: 0, foodFound: 0, financeFound: 0, gymFound: 0, migrated: 0, duplicatesSkipped: 0, errors: 0, paths: [] };
  const [usersSnap, publicFoodSnap, publicFinanceSnap, publicGymSnap] = await Promise.all([
    get(ref(db, "v2/users")),
    get(ref(db, PUBLIC_PATHS.foodItems)),
    get(ref(db, PUBLIC_PATHS.financeProducts)),
    get(ref(db, PUBLIC_PATHS.gymExercises)),
  ]);
  const users = usersSnap.val() || {};
  const foodSeen = new Map();
  const finSeen = new Map();
  const gymSeen = new Map();
  Object.values(publicFoodSnap.val() || {}).forEach((it) => foodSeen.set(dedupeKey(it), true));
  Object.values(publicFinanceSnap.val() || {}).forEach((it) => finSeen.set(dedupeKey(it), true));
  Object.values(publicGymSnap.val() || {}).forEach((it) => gymSeen.set(dedupeKey(it), true));

  for (const [uid, userData] of Object.entries(users)) {
    stats.usersRead += 1;
    try {
      const nutritionProducts = Array.isArray(userData?.recipes?.recipes?.nutrition?.products) ? userData.recipes.recipes.nutrition.products : [];
      const financeItemsMap = userData?.finance?.finance?.foodItems && typeof userData.finance.finance.foodItems === "object" ? userData.finance.finance.foodItems : {};
      const gymExercisesMap = userData?.gym?.gym?.exercises && typeof userData.gym.gym.exercises === "object" ? userData.gym.gym.exercises : {};

      stats.foodFound += nutritionProducts.length;
      stats.financeFound += Object.keys(financeItemsMap).length;
      stats.gymFound += Object.keys(gymExercisesMap).length;

      for (const row of nutritionProducts) {
        const item = sanitizeCatalogItem(row, "food", uid);
        if (!item) continue;
        const res = await upsertByDedupe(PUBLIC_PATHS.foodItems, item, foodSeen);
        if (res.migrated) stats.migrated += 1; else stats.duplicatesSkipped += 1;
      }
      for (const row of Object.values(financeItemsMap)) {
        const item = sanitizeCatalogItem(row, "finance", uid);
        if (!item) continue;
        const res = await upsertByDedupe(PUBLIC_PATHS.financeProducts, item, finSeen);
        if (res.migrated) stats.migrated += 1; else stats.duplicatesSkipped += 1;
      }
      for (const row of Object.values(gymExercisesMap)) {
        const item = sanitizeCatalogItem(row, "gym", uid);
        if (!item) continue;
        const res = await upsertByDedupe(PUBLIC_PATHS.gymExercises, item, gymSeen);
        if (res.migrated) stats.migrated += 1; else stats.duplicatesSkipped += 1;
      }
    } catch (error) {
      stats.errors += 1;
      console.error("[public-catalog/migration] user migration failed", uid, error);
    }
  }
  console.info("[public-catalog/migration] done", stats);
  return stats;
}

export function registerPublicCatalogMigrationDebugApi() {
  if (typeof window === "undefined") return;
  window.__bookshellDebug = window.__bookshellDebug || {};
  window.__bookshellDebug.migratePublicCatalogs = async () => {
    const stats = await migrateUserCatalogsToPublicCatalog();
    console.table(stats);
    return stats;
  };
}
