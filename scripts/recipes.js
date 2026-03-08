// recipes.js
// Pestaña de recetas con estética de estantería y gráficos adaptados

import {
  ensureCountryDatalist,
  getCountryEnglishName,
  normalizeCountryInput
} from "./countries.js";
import { renderCountryHeatmap, renderCountryList } from "./world-heatmap.js";
import { auth, db } from "./firebase-shared.js";
import { resolveFinancePathCandidates } from "./finance/data.js";
import {
  ref,
  onValue,
  get,
  set,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const $viewRecipes = document.getElementById("view-recipes");
if ($viewRecipes) {
  const STORAGE_KEY_LEGACY = "bookshell.recipes.v1";
  const STORAGE_KEY_PREFIX = "bookshell.recipes.v2";
  const RECIPES_NODE_KEY = "recipes";
  let currentUid = null;

  const MEAL_TYPES = ["desayuno", "comida", "cena", "snack"];
  const HEALTH_TYPES = ["sana", "equilibrada", "insana"];
  const palette = ["#f4d35e", "#9ad5ff", "#ff89c6", "#7dffb4", "#c8a4ff"];
  const DEFAULT_INGREDIENT = () => ({ id: generateId(), text: "", done: false });
  const DEFAULT_STEP = () => ({
    id: generateId(),
    title: "",
    description: "",
    done: false,
  });

  const defaultRecipes = [
    {
      id: "r1",
      title: "Shakshuka especiada",
      meal: "comida",
      health: "sana",
      tags: ["rápida", "huevo", "sartén"],
      country: "IL",
      rating: 4.5,
      favorite: true,
      laura: true,
      lastCooked: "2024-06-02",
      cookedDates: ["2024-05-19", "2024-06-02", "2024-06-10"],
      notes: "Sirve con pan crujiente y cilantro.",
      ingredients: [
        { id: "ing-r1-1", text: "1 cebolla morada en juliana", done: false },
        { id: "ing-r1-2", text: "2 dientes de ajo picados", done: false },
        { id: "ing-r1-3", text: "400g tomate triturado", done: false },
        { id: "ing-r1-4", text: "4 huevos camperos", done: false },
      ],
      steps: [
        {
          id: "step-r1-1",
          title: "Sofrito",
          description: "Pocha la cebolla y el ajo con comino y pimentón.",
          done: false,
        },
        {
          id: "step-r1-2",
          title: "Salsa",
          description: "Añade tomate, reduce 12 minutos y corrige de sal.",
          done: false,
        },
        {
          id: "step-r1-3",
          title: "Huevos",
          description: "Haz 4 huecos y cocina los huevos tapados a fuego bajo.",
          done: false,
        },
      ],
    },
    {
      id: "r2",
      title: "Crema fría de calabacín",
      meal: "cena",
      health: "sana",
      tags: ["sopa", "ligera", "verano"],
      country: "ES",
      rating: 4,
      favorite: false,
      laura: false,
      lastCooked: "2024-05-28",
      cookedDates: ["2024-05-05", "2024-05-28"],
      notes: "Queda mejor con topping de semillas de sésamo.",
      ingredients: [
        { id: "ing-r2-1", text: "2 calabacines medianos", done: false },
        { id: "ing-r2-2", text: "1 puerro", done: false },
        { id: "ing-r2-3", text: "Caldo de verduras", done: false },
        { id: "ing-r2-4", text: "Yogur griego o queso crema", done: false },
      ],
      steps: [
        {
          id: "step-r2-1",
          title: "Rehogar",
          description: "Sofríe el puerro y el calabacín 8 minutos.",
          done: false,
        },
        {
          id: "step-r2-2",
          title: "Cocer",
          description: "Cubre con caldo y cocina 12 minutos; enfría.",
          done: false,
        },
        {
          id: "step-r2-3",
          title: "Triturar",
          description: "Bate con yogur, sal y pimienta hasta cremoso.",
          done: false,
        },
      ],
    },
    {
      id: "r3",
      title: "Lasagna cremosa de setas",
      meal: "comida",
      health: "equilibrada",
      tags: ["horno", "pasta", "finde"],
      country: "IT",
      rating: 5,
      favorite: true,
      laura: true,
      lastCooked: "2024-04-14",
      cookedDates: ["2024-03-30", "2024-04-14"],
      notes: "Usar grana padano y bechamel ligera.",
      ingredients: [
        { id: "ing-r3-1", text: "Láminas de lasagna precocidas", done: false },
        { id: "ing-r3-2", text: "500g setas variadas", done: false },
        { id: "ing-r3-3", text: "400ml bechamel ligera", done: false },
        { id: "ing-r3-4", text: "Queso rallado", done: false },
      ],
      steps: [
        {
          id: "step-r3-1",
          title: "Saltear setas",
          description: "Dora las setas con ajo y tomillo hasta dorar.",
          done: false,
        },
        {
          id: "step-r3-2",
          title: "Montar",
          description: "Alterna capas de pasta, setas y bechamel.",
          done: false,
        },
        {
          id: "step-r3-3",
          title: "Hornear",
          description: "180ºC durante 25-30 minutos hasta gratinar.",
          done: false,
        },
      ],
    },
    {
      id: "r4",
      title: "Tostadas francesas de vainilla",
      meal: "desayuno",
      health: "insana",
      tags: ["dulce", "brunch"],
      country: "FR",
      rating: 3.5,
      favorite: false,
      laura: true,
      lastCooked: "2024-06-01",
      cookedDates: ["2024-05-12", "2024-06-01"],
      notes: "Añadir frutos rojos y un toque de ralladura de naranja.",
      ingredients: [
        { id: "ing-r4-1", text: "Pan brioche en rebanadas gruesas", done: false },
        { id: "ing-r4-2", text: "2 huevos", done: false },
        { id: "ing-r4-3", text: "Leche + vainilla", done: false },
        { id: "ing-r4-4", text: "Mantequilla para la sartén", done: false },
      ],
      steps: [
        {
          id: "step-r4-1",
          title: "Mezcla",
          description: "Bate huevos, leche, vainilla y pizca de canela.",
          done: false,
        },
        {
          id: "step-r4-2",
          title: "Remojar",
          description: "Empapa el pan 20-30 segundos por lado.",
          done: false,
        },
        {
          id: "step-r4-3",
          title: "Dorar",
          description: "Cocina en mantequilla a fuego medio hasta dorar.",
          done: false,
        },
      ],
    },
  ];

  const $btnAddRecipe = document.getElementById("btn-add-recipe");
  const $filters = document.getElementById("recipes-filters");
  const $filtersToggle = document.getElementById("recipes-filters-toggle");
  const $filtersBody = document.getElementById("recipes-filters-body");
  const $filtersHeader = document.getElementById("recipes-filters-header");
  const $filterChips = document.getElementById("recipes-filter-chips");
  const $filterSearch = document.getElementById("recipes-filter-search");
  const $filterFavorites = document.getElementById("recipes-filter-favorites");
  const $filterLaura = document.getElementById("recipes-filter-laura");

  const $shelfSearch = document.getElementById("recipes-shelf-search");
  const $shelfResults = document.getElementById("recipes-shelf-results");
  const $shelfEmpty = document.getElementById("recipes-shelf-empty");
  const $shelfList = document.getElementById("recipes-list");
  const $shelfFavorites = document.getElementById("recipes-list-favorites");
  const $shelfFavoritesSection = document.getElementById("recipes-favorites-section");
  const $shelfFavoritesCount = document.getElementById("recipes-favorites-count");

  const RECIPE_SPINE_H = 138;

  const $cardsHost = document.getElementById("recipes-cards");
  const $empty = document.getElementById("recipes-empty");

  const $statTotal = document.getElementById("recipe-stat-total");
  const $statFavorites = document.getElementById("recipe-stat-favorites");
  const $statHealthy = document.getElementById("recipe-stat-healthy");
  const $statRating = document.getElementById("recipe-stat-rating");
  const $statLauraPositive = document.getElementById("recipe-stat-laura-positive");

  const $chartMeal = document.getElementById("recipe-chart-meal");
  const $chartHealth = document.getElementById("recipe-chart-health");
  const $recipesGeoSection = document.getElementById("recipes-geo-section");
  const $recipesWorldMap = document.getElementById("recipes-world-map");
  const $recipesCountryList = document.getElementById("recipes-country-list");

  const $calPrev = document.getElementById("recipe-cal-prev");
  const $calNext = document.getElementById("recipe-cal-next");
  const $calLabel = document.getElementById("recipe-cal-label");
  const $calGrid = document.getElementById("recipe-calendar-grid");
  const $calViewMode = document.getElementById("recipe-cal-view-mode");
  const $calSummary = document.getElementById("recipe-calendar-summary");

  const $modalBackdrop = document.getElementById("recipe-modal-backdrop");
  const $modalClose = document.getElementById("recipe-modal-close");
  const $modalCancel = document.getElementById("recipe-modal-cancel");
  const $modalTitle = document.getElementById("recipe-modal-title");
  const $recipeForm = document.getElementById("recipe-form");
  const $recipeId = document.getElementById("recipe-id");
  const $recipeName = document.getElementById("recipe-name");
  const $recipeMeal = document.getElementById("recipe-meal");
  const $recipeHealth = document.getElementById("recipe-health");
  const $recipeTags = document.getElementById("recipe-tags");
  const $recipeCountry = document.getElementById("recipe-country");
  const $recipeRating = document.getElementById("recipe-rating");
  const $recipeLastCooked = document.getElementById("recipe-last-cooked");
  const $recipeNotes = document.getElementById("recipe-notes");
  const $recipeFavorite = document.getElementById("recipe-favorite");
  const $recipeLaura = document.getElementById("recipe-laura");
  const $recipeIngredientsList = document.getElementById("recipe-ingredients-list");
  const $recipeStepsList = document.getElementById("recipe-steps-list");
  const $recipeAddIngredient = document.getElementById("recipe-add-ingredient");
  const $recipeAddStep = document.getElementById("recipe-add-step");
  const $recipeDelete = document.getElementById("recipe-delete");

  const $recipesSubtabs = document.querySelectorAll(".recipes-subtab");
  const $recipesPanelLibrary = document.getElementById("recipes-panel-library");
  const $recipesPanelMacros = document.getElementById("recipes-panel-macros");
  const $recipesPanelStatistics = document.getElementById("recipes-panel-statistics");
  const $macroDateInput = document.getElementById("macro-date-input");
  const $macroDatePrev = document.getElementById("macro-date-prev");
  const $macroDateNext = document.getElementById("macro-date-next");
  const $macroSummaryGrid = document.getElementById("macro-summary-grid");
  const $macroMeals = document.getElementById("macro-meals");
  const $macroKcalSummary = document.getElementById("macro-kcal-summary");
  const $macroStatsPeriods = document.getElementById("macro-stats-periods");
  const $macroStatsPrev = document.getElementById("macro-stats-prev");
  const $macroStatsNext = document.getElementById("macro-stats-next");
  const $macroStatsAnchor = document.getElementById("macro-stats-anchor");
  const $macroStatsMainMetric = document.getElementById("macro-stats-main-metric");
  const $macroStatsKpis = document.getElementById("macro-stats-kpis");
  const $macroStatsMainChart = document.getElementById("macro-stats-main-chart");
  const $macroStatsMainLabel = document.getElementById("macro-stats-main-label");
  const $macroStatsDonutKcal = document.getElementById("macro-stats-donut-kcal");
  const $macroStatsDonutMacros = document.getElementById("macro-stats-donut-macros");
  const $macroStatsDonutMeals = document.getElementById("macro-stats-donut-meals");
  const $macroStatsTopRecipes = document.getElementById("macro-stats-top-recipes");
  const $macroStatsTopProducts = document.getElementById("macro-stats-top-products");
  const $macroAddModalBackdrop = document.getElementById("macro-add-modal-backdrop");
  const $macroAddModalClose = document.getElementById("macro-add-modal-close");
  const $macroAddSearch = document.getElementById("macro-add-search");
  const $macroAddResults = document.getElementById("macro-add-results");
  const $macroAddChips = document.getElementById("macro-add-chips");
  const $macroScanPanel = document.getElementById("macro-scan-panel");
  const $macroManualPanel = document.getElementById("macro-manual-panel");
  const $macroScanStart = document.getElementById("macro-scan-start");
  const $macroScanStop = document.getElementById("macro-scan-stop");
  const $macroScanManual = document.getElementById("macro-scan-manual");
  const $macroScanManualBtn = document.getElementById("macro-scan-manual-btn");
  const $macroScanStatus = document.getElementById("macro-scan-status");
  const $macroScanVideo = document.getElementById("macro-scan-video");
  const $macroScanAddProduct = document.getElementById("macro-scan-add-product");
  const $macroManualName = document.getElementById("macro-manual-name");
  const $macroManualBrand = document.getElementById("macro-manual-brand");
  const $macroManualBarcode = document.getElementById("macro-manual-barcode");
  const $macroManualBase = document.getElementById("macro-manual-base");
  const $macroManualCarbs = document.getElementById("macro-manual-carbs");
  const $macroManualProtein = document.getElementById("macro-manual-protein");
  const $macroManualFat = document.getElementById("macro-manual-fat");
  const $macroManualKcal = document.getElementById("macro-manual-kcal");
  const $macroManualSave = document.getElementById("macro-manual-save");
  const $macroProductModalBackdrop = document.getElementById("macro-product-modal-backdrop");
  const $macroProductModalClose = document.getElementById("macro-product-modal-close");
  const $macroProductModalTitle = document.getElementById("macro-product-modal-title");
  const $macroProductCancel = document.getElementById("macro-product-cancel");
  const $macroProductAdd = document.getElementById("macro-product-add");
  const $macroProductName = document.getElementById("macro-product-name");
  const $macroProductBrand = document.getElementById("macro-product-brand");
  const $macroProductBarcode = document.getElementById("macro-product-barcode");
  const $macroProductBase = document.getElementById("macro-product-base");
  const $macroProductCarbs = document.getElementById("macro-product-carbs");
  const $macroProductProtein = document.getElementById("macro-product-protein");
  const $macroProductFat = document.getElementById("macro-product-fat");
  const $macroProductKcal = document.getElementById("macro-product-kcal");
  const $macroProductGrams = document.getElementById("macro-product-grams");
  const $macroProductSummary = document.getElementById("macro-product-summary");
  const $macroProductEditToggle = document.getElementById("macro-product-edit-toggle");
  const $macroProductScanBtn = document.getElementById("macro-product-scan-btn");
  const $macroProductFinanceSelect = document.getElementById("macro-product-finance-select");
  const $macroProductFinanceUnlink = document.getElementById("macro-product-finance-unlink");
  const $macroProductFinanceHint = document.getElementById("macro-product-finance-hint");
  const $macroProductHabitSelect = document.getElementById("macro-product-habit-select");
  const $macroProductHabitUnlink = document.getElementById("macro-product-habit-unlink");
  const $macroProductHabitHint = document.getElementById("macro-product-habit-hint");
  const $macroProductKpiCarbs = document.getElementById("macro-product-kpi-carbs");
  const $macroProductKpiProtein = document.getElementById("macro-product-kpi-protein");
  const $macroProductKpiFat = document.getElementById("macro-product-kpi-fat");
  const $macroProductKpiKcal = document.getElementById("macro-product-kpi-kcal");
  const $macroProductDonutCarbs = document.getElementById("macro-product-donut-carbs");
  const $macroProductDonutProtein = document.getElementById("macro-product-donut-protein");
  const $macroProductDonutFat = document.getElementById("macro-product-donut-fat");
  const $macroProductDonutKcal = document.getElementById("macro-product-donut-kcal");
  const $recipeServings = document.getElementById("recipe-servings");
  const $recipeNutriIngredientsList = document.getElementById("recipe-nutri-ingredients-list");
  const $recipeAddNutriIngredient = document.getElementById("recipe-add-nutri-ingredient");

  const $recipeImageFile = document.getElementById("recipe-image-file");
  const $recipeImagePreview = document.getElementById("recipe-image-preview");
  const $recipeImageCamera = document.getElementById("recipe-image-camera");
  const $recipeImageGallery = document.getElementById("recipe-image-gallery");
  const $recipeImageRemove = document.getElementById("recipe-image-remove");
  const $recipeImageStatus = document.getElementById("recipe-image-status");

  const $recipeDetailHero = document.getElementById("recipe-detail-hero");
  const $recipeDetailImage = document.getElementById("recipe-detail-image");
const $recipeImportToggle = document.getElementById("recipe-import-toggle");
const $recipeImportBox = document.getElementById("recipe-import-box");
const $recipeImportText = document.getElementById("recipe-import-text");
const $recipeImportBtn = document.getElementById("recipe-import-btn");
const $recipeImportClear = document.getElementById("recipe-import-clear");
const $recipeImportStatus = document.getElementById("recipe-import-status");

  const $recipeDetailBackdrop = document.getElementById("recipe-detail-backdrop");
  const $recipeDetailClose = document.getElementById("recipe-detail-close");
  const $recipeDetailEdit = document.getElementById("recipe-detail-edit");
  const $recipeDetailDelete = document.getElementById("recipe-detail-delete");
  const $recipeDetailTitle = document.getElementById("recipe-detail-title");
  const $recipeDetailTags = document.getElementById("recipe-detail-tags");
  const $recipeDetailMeal = document.getElementById("recipe-detail-meal");
  const $recipeDetailMeta = document.getElementById("recipe-detail-meta");
  const $recipeDetailGrid = document.getElementById("recipe-detail-grid");
  const $recipeDetailIngredients = document.getElementById("recipe-detail-ingredients");
  const $recipeDetailSteps = document.getElementById("recipe-detail-steps");
  const $recipeDetailNotes = document.getElementById("recipe-detail-notes");
  const $recipeDetailNotesWrapper = document.getElementById("recipe-detail-notes-wrapper");
  const $recipeDetailTabs = document.querySelectorAll(".recipe-tab");
  const $recipeDetailPanels = document.querySelectorAll(".recipe-detail-panel");
  const $recipeDetailCloseBottom = document.getElementById("recipe-detail-close-bottom");
  const $recipeDetailBookmark = document.getElementById("recipe-detail-bookmark");

  let recipes = loadRecipes();
  let detailRecipeId = null;

  const filterState = {
    query: "",
    shelfQuery: "",
    chips: new Set(),
    favoritesOnly: false,
    lauraOnly: false,
  };

  const defaultGoals = { carbs: 180, protein: 140, fat: 65, kcal: 2200 };
  const mealOrder = ["breakfast", "lunch", "dinner", "snacks"];
  const mealLabels = { breakfast: "Desayuno", lunch: "Almuerzo", dinner: "Cena", snacks: "Snacks" };
  let nutritionProducts = [];
  let financeProducts = [];
  let financeProductsLoaded = false;
  let habitSyncQueue = Promise.resolve();
  let dailyLogsByDate = {};
  let nutritionGoals = { ...defaultGoals };
  let selectedMacroDate = toISODate(new Date());
  const macroModalState = { meal: "breakfast", source: "products", query: "" };
  const macroStatsState = { period: "week", anchorDate: selectedMacroDate, metric: "macros" };
  let nutritionSyncMeta = { version: 2, migratedAt: 0, updatedAt: 0 };
  let nutritionUnsubscribe = null;

  ensureCountryDatalist();

  const today = new Date();
  let calYear = today.getFullYear();
  let calMonth = today.getMonth();
  let calViewMode = "month";

  const recipeDonutActiveFill = "#f5e6a6";
  const recipeDonutActiveStroke = "#e3c45a";
  const recipeDonutSliceStroke = "rgba(255,255,255,0.22)";
  const recipeDonutFocusHint = "";
  let recipeDonutActiveType = null;
  let recipeDonutActiveLabel = null;
  let recipeDonutBackupChips = null;

  const RECIPE_PHOTO_PLACEHOLDER = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="720"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1b1622"/><stop offset="1" stop-color="#0b0c14"/></linearGradient></defs><rect width="100%" height="100%" fill="url(#g)"/><text x="50%" y="50%" fill="rgba(255,255,255,0.55)" font-family="system-ui, -apple-system, Segoe UI, Roboto" font-size="42" text-anchor="middle" dominant-baseline="middle">Sin foto</text></svg>'
  )}`;
  let _recipePhotoRemove = false;
  let _recipePhotoObjectUrl = null;


  function recipesRootPath(uid = currentUid) {
    return uid ? `v2/users/${uid}/${RECIPES_NODE_KEY}` : null;
  }

  function getStorageKey(uid = currentUid) {
    return uid ? `${STORAGE_KEY_PREFIX}.${uid}` : STORAGE_KEY_LEGACY;
  }

  function loadRecipes() {
    try {
      const raw = localStorage.getItem(getStorageKey());
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(normalizeRecipeFields);
      }
    } catch (err) {
      console.warn("No se pudo leer recetas almacenadas", err);
    }
    return defaultRecipes.map(normalizeRecipeFields);
  }

  function cacheRecipes() {
    try {
      localStorage.setItem(getStorageKey(), JSON.stringify(recipes));
    } catch (err) {
      console.warn("No se pudo guardar recetas", err);
    }
  }

  function serializeRecipesMap(list = []) {
    return (list || []).reduce((acc, recipe) => {
      if (!recipe || !recipe.id) return acc;
      acc[recipe.id] = normalizeRecipeFields(recipe);
      return acc;
    }, {});
  }

  function extractRemoteRecipes(data) {
    if (!data || typeof data !== "object") return [];
    return Object.entries(data)
      .filter(([key, value]) => key !== "_init" && value && typeof value === "object")
      .map(([, value]) => normalizeRecipeFields(value))
      .filter((r) => r && r.id);
  }

  function persistRecipe(id, data) {
    if (!id || !data) return;
    const root = recipesRootPath();
    try {
      if (root) set(ref(db, `${root}/${id}`), normalizeRecipeFields(data));
    } catch (err) {
      console.warn("No se pudo sincronizar receta", err);
    }
    cacheRecipes();
  }

  function removeRecipeRemote(id) {
    if (!id) return;
    const root = recipesRootPath();
    try {
      if (root) remove(ref(db, `${root}/${id}`));
    } catch (err) {
      console.warn("No se pudo borrar receta remota", err);
    }
    cacheRecipes();
  }

  function listenRemoteRecipes() {
    let unsubscribe = null;
    let bootstrapped = false;

    const attach = (uid) => {
      const root = recipesRootPath(uid);
      if (!root) return;

      unsubscribe = onValue(
        ref(db, root),
        (snapshot) => {
          const data = snapshot.val() || null;
          const remoteList = extractRemoteRecipes(data);
          const hasRemoteRecipes = remoteList.length > 0;

          if (!hasRemoteRecipes && !bootstrapped) {
            bootstrapped = true;
            if (recipes.length) {
              const initFlag =
                data && typeof data === "object" && Object.prototype.hasOwnProperty.call(data, "_init")
                  ? data._init
                  : true;
              set(ref(db, root), { _init: initFlag, ...serializeRecipesMap(recipes) });
            }
            return;
          }

          bootstrapped = true;
          recipes = remoteList;
          cacheRecipes();
          refreshUI();
          if (detailRecipeId) renderRecipeDetail(detailRecipeId);
        },
        (err) => {
          console.warn("No se pudo escuchar recetas remotas", err);
        }
      );
    };

    onAuthStateChanged(auth, (user) => {
      const nextUid = user?.uid || null;
      if (nextUid === currentUid) return;

      currentUid = nextUid;
      bootstrapped = false;
      financeProductsLoaded = false;
      financeProducts = [];

      if (typeof unsubscribe === "function") {
        try { unsubscribe(); } catch (_) {}
        unsubscribe = null;
      }

      if (!currentUid) return;

      try {
        const perUserRaw = localStorage.getItem(getStorageKey(currentUid));
        if (!perUserRaw) {
          const legacyRaw = localStorage.getItem(STORAGE_KEY_LEGACY);
          if (legacyRaw) localStorage.setItem(getStorageKey(currentUid), legacyRaw);
        } else {
          const parsed = JSON.parse(perUserRaw);
          if (Array.isArray(parsed)) {
            recipes = parsed.map(normalizeRecipeFields);
            refreshUI();
            if (detailRecipeId) renderRecipeDetail(detailRecipeId);
          }
        }
      } catch (_) {}

      attach(currentUid);
      loadFinanceProductsCatalog().then(() => {
        renderMacrosView();
        if (detailRecipeId) renderRecipeDetail(detailRecipeId);
      });
    });
  }


  async function subirImagenACloudinarySafe(file) {
    const fn =
      typeof window !== "undefined" && window.subirImagenACloudinary
        ? window.subirImagenACloudinary
        : async (f) => {
            const fd = new FormData();
            fd.append("file", f);
            fd.append("upload_preset", "publico");
            const res = await fetch("https://api.cloudinary.com/v1_1/dgdavibcx/image/upload", {
              method: "POST",
              body: fd,
            });
            const data = await res.json();
            return data.secure_url;
          };

    return fn(file);
  }

  function setRecipePhotoStatus(msg = "") {
    if ($recipeImageStatus) $recipeImageStatus.textContent = msg || "";
  }

  function setRecipePhotoPreview(src) {
    if (!$recipeImagePreview) return;
    $recipeImagePreview.src = src || RECIPE_PHOTO_PLACEHOLDER;
  }

  function clearRecipePhotoObjectUrl() {
    if (_recipePhotoObjectUrl) {
      try {
        URL.revokeObjectURL(_recipePhotoObjectUrl);
      } catch (_) {}
      _recipePhotoObjectUrl = null;
    }
  }

  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "r-" + Date.now().toString(36);
  }

  function normalizeRecipeCountry(value, label = "") {
    const normalized = normalizeCountryInput(label || value);
    if (normalized) {
      const code = normalized.code || null;
      return {
        code,
        label: normalized.name || label || value || code,
        english: getCountryEnglishName(code) || normalized.name || code,
      };
    }
    const fallback = String(label || value || "").trim();
    if (fallback) {
      const rawCode = String(value || "").trim().toUpperCase() || null;
      return { code: rawCode, label: fallback, english: fallback };
    }
    return null;
  }

  function normalizeRecipeFields(recipe) {
    const country = normalizeRecipeCountry(recipe.country, recipe.countryLabel);
    const ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ing) => ({
          id: ing.id || generateId(),
          text: String(ing.text || "").trim(),
          quantity: String(ing.quantity || "").trim(),
          name: String(ing.name || "").trim(),
          productId: String(ing.productId || "").trim(),
          done: !!ing.done,
        }))
      : [];
    const steps = Array.isArray(recipe.steps)
      ? recipe.steps.map((step) => ({
          id: step.id || generateId(),
          title: String(step.title || "").trim(),
          description: String(step.description || "").trim(),
          done: !!step.done,
        }))
      : [];
    return {
      ...recipe,
      country: country?.code || null,
      countryLabel: country?.label || recipe.countryLabel || recipe.country || null,
      imageURL: recipe.imageURL || null,
      ingredients,
      steps,
      servings: Math.max(1, Number(recipe.servings) || 1),
      nutritionIngredients: Array.isArray(recipe.nutritionIngredients) ? recipe.nutritionIngredients.map((it) => ({
        id: it.id || generateId(),
        productId: it.productId || "",
        grams: Math.max(0, Number(it.grams) || 0),
      })) : [],
      nutritionTotals: normalizeMacros(recipe.nutritionTotals),
      nutritionPerServing: normalizeMacros(recipe.nutritionPerServing),
    };
  }

  function splitIngredientText(raw = "") {
    const text = String(raw || "").trim();
    if (!text) return { quantity: "", name: "" };
    const match = text.match(/^([\d.,\/\s]+(?:kg|g|mg|ml|l|cl|ud|uds|cda|cdta|taza|vaso|pieza|piezas|huevo|huevos)?)\s+(.+)$/i);
    if (!match) return { quantity: "", name: text };
    return { quantity: String(match[1] || "").trim(), name: String(match[2] || "").trim() };
  }

  function resolveIngredientDisplay(ing = {}) {
    const parsed = splitIngredientText(ing.text || "");
    const quantity = String(ing.quantity || parsed.quantity || "").trim();
    const fallbackName = String(ing.name || parsed.name || ing.text || "Ingrediente").trim();
    const linked = nutritionProducts.find((p) => p.id === ing.productId)
      || nutritionProducts.find((p) => !ing.productId && p.name && p.name.toLowerCase() === fallbackName.toLowerCase())
      || null;
    return {
      quantity,
      name: linked?.name || fallbackName,
      product: linked,
    };
  }

  function toISODate(d = new Date()) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function normalizeMacros(macros = {}) {
    return {
      carbs: Number(macros.carbs) || 0,
      protein: Number(macros.protein) || 0,
      fat: Number(macros.fat) || 0,
      kcal: Number(macros.kcal) || 0,
    };
  }

  function plusMacros(a, b) {
    const aa = normalizeMacros(a);
    const bb = normalizeMacros(b);
    return {
      carbs: aa.carbs + bb.carbs,
      protein: aa.protein + bb.protein,
      fat: aa.fat + bb.fat,
      kcal: aa.kcal + bb.kcal,
    };
  }

  function calcProductMacros(product, grams = 0) {
    const p = product || {};
    const base = Math.max(1, Number(p.servingBaseGrams) || 100);
    const ratio = Math.max(0, Number(grams) || 0) / base;
    return {
      carbs: (Number(p.macros?.carbs) || 0) * ratio,
      protein: (Number(p.macros?.protein) || 0) * ratio,
      fat: (Number(p.macros?.fat) || 0) * ratio,
      kcal: (Number(p.macros?.kcal) || 0) * ratio,
    };
  }

  function roundMacro(value) {
    return Math.round((Number(value) || 0) * 10) / 10;
  }

  function normalizeDate(dateStr) {
    if (!dateStr) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
    const d = new Date(dateStr);
    if (Number.isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${dd}`;
  }

  function formatRatingStars(rating) {
    const value = Math.max(0, Math.round((Number(rating) || 0) * 2) / 2);
    const text = Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
    return `${text}★`;
  }

  function normalizeLabel(value) {
    return String(value ?? "").trim();
  }
function escapeHtml(s) {
  return String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function escapeAttr(s) {
  // suficiente para href
  return escapeHtml(s).replaceAll("`", "&#96;");
}

function prettyHostLabel(href) {
  try {
    const u = new URL(href);
    let host = (u.hostname || "").toLowerCase();

    // quita www.
    host = host.replace(/^www\./, "");

    // pilla el “centro” típico: tiktok.com -> tiktok, recipes.my.site.es -> site
    const parts = host.split(".").filter(Boolean);
    if (!parts.length) return "Link";

    // si hay 2+ partes, el “nombre” suele ser la penúltima (tiktok.com -> tiktok)
    // pero si hay subdominio (m.youtube.com), sigue siendo youtube
    const base =
      parts.length >= 2 ? parts[parts.length - 2] : parts[0];

    // Title-case suave: "tiktok" -> "TikTok" (heurística simple)
    const cleaned = base.replace(/[-_]+/g, " ").trim();
    if (!cleaned) return "Link";

    // Capitaliza palabras
    const titled = cleaned.replace(/\b\w/g, (c) => c.toUpperCase());

    // “TikTok” y otras marcas con doble mayúscula: mini heurística
    if (titled.toLowerCase() === "tiktok") return "TikTok";
    if (titled.toLowerCase() === "youtube") return "YouTube";
    if (titled.toLowerCase() === "instagram") return "Instagram";
    if (titled.toLowerCase() === "facebook") return "Facebook";
    if (titled.toLowerCase() === "twitter") return "X";
    if (titled.toLowerCase() === "x") return "X";

    return titled;
  } catch {
    return "Link";
  }
}

function linkifyNotesHtml(input) {
  const text = String(input ?? "");
  if (!text) return "";

  const re =
    /\b(?:https?:\/\/|www\.)[^\s<>()]+|\b(?:[a-z0-9-]+\.)+(?:com|es|net|org|io|dev|info|me|co|eu|cat|fr|it|de|ch|uk|us)(?:\/[^\s<>()]*)?/gi;

  let out = "";
  let last = 0;

  text.replace(re, (match, ...rest) => {
    const offset = rest[rest.length - 2];
    out += escapeHtml(text.slice(last, offset));

    // quita puntuación pegada al final
    let raw = match;
    let trailing = "";
    while (/[.,;:!?)\]]$/.test(raw)) {
      trailing = raw.slice(-1) + trailing;
      raw = raw.slice(0, -1);
    }

    let href = raw;
    if (!/^https?:\/\//i.test(href)) href = "https://" + href.replace(/^www\./i, "www.");

    const label = prettyHostLabel(href);

    out += `<a class="note-link" href="${escapeAttr(href)}" target="_blank" rel="noopener noreferrer" title="${escapeAttr(href)}">${escapeHtml(label)}</a>${escapeHtml(trailing)}`;

    last = offset + match.length;
    return match;
  });

  out += escapeHtml(text.slice(last));
  return out.replace(/\n/g, "<br>");
}


  function pickSpinePalette(seed = "") {
    const palettes = [
      ["#f7b500", "#ff6f61"],
      ["#6dd5ed", "#2193b0"],
      ["#8e2de2", "#4a00e0"],
      ["#00b09b", "#96c93d"],
      ["#ff758c", "#ff7eb3"],
      ["#4158d0", "#c850c0"],
      ["#f83600", "#fe8c00"],
      ["#43cea2", "#185a9d"],
      ["#ffd700", "#f37335"],
    ];
    const hash = Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    return palettes[hash % palettes.length];
  }

  function flattenTags() {
    const acc = new Set();
    recipes.forEach((r) => {
      (r.tags || []).forEach((t) => {
        const clean = (t || "").trim();
        if (clean) acc.add(clean);
      });
    });
    return Array.from(acc).sort((a, b) => a.localeCompare(b, "es"));
  }

  function renderChips() {
    if (!$filterChips) return;
    const frag = document.createDocumentFragment();
    const groups = [
      { title: "Tipo de comida", values: MEAL_TYPES, prefix: "meal" },
      { title: "Salud", values: HEALTH_TYPES, prefix: "health" },
      { title: "Etiquetas", values: flattenTags(), prefix: "tag" },
    ];

    groups.forEach((group) => {
      const wrapper = document.createElement("div");
      wrapper.className = "filter-chip-group";
      const title = document.createElement("div");
      title.className = "filter-chip-group-title";
      title.textContent = group.title;
      wrapper.appendChild(title);

      const chipsRow = document.createElement("div");
      chipsRow.className = "filter-chips";

      if (!group.values.length) {
        const empty = document.createElement("div");
        empty.className = "filter-chip-empty";
        empty.textContent = "Sin datos todavía";
        chipsRow.appendChild(empty);
      } else {
        group.values.forEach((value) => {
          const chip = document.createElement("button");
          chip.type = "button";
          chip.className = "filter-chip";
          const key = `${group.prefix}:${value}`;
          chip.dataset.chip = key;
          chip.textContent = value.charAt(0).toUpperCase() + value.slice(1);
          if (filterState.chips.has(key)) chip.classList.add("is-active");
          chipsRow.appendChild(chip);
        });
      }

      wrapper.appendChild(chipsRow);
      frag.appendChild(wrapper);
    });

    $filterChips.innerHTML = "";
    $filterChips.appendChild(frag);
  }

  function matchesChips(recipe) {
    for (const chip of filterState.chips) {
      const [prefix, value] = chip.split(":");
      if (prefix === "meal" && recipe.meal !== value) return false;
      if (prefix === "health" && recipe.health !== value) return false;
      if (prefix === "tag") {
        const tags = recipe.tags || [];
        if (!tags.some((t) => t.toLowerCase() === value.toLowerCase())) return false;
      }
    }
    return true;
  }

  function filterRecipes(base = recipes) {
    const q = (filterState.query || "").trim().toLowerCase();
    return base.filter((r) => {
      if (filterState.favoritesOnly && !r.favorite) return false;
      if (filterState.lauraOnly && !r.laura) return false;
      if (filterState.chips.size && !matchesChips(r)) return false;
      if (q) {
        const haystack = [
          r.title,
          r.meal,
          r.health,
          (r.tags || []).join(" "),
          r.notes || "",
          r.countryLabel || r.country,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });
  }

  function renderShelf() {
    if (!$shelfList) return;
    const shelfQuery = (filterState.shelfQuery || "").trim().toLowerCase();
    const filtered = filterRecipes().filter((r) => {
      if (!shelfQuery) return true;
      const text = [r.title, r.meal, r.health, (r.tags || []).join(" "), r.countryLabel || r.country]
        .join(" ")
        .toLowerCase();
      return text.includes(shelfQuery);
    });

    const favorites = filtered.filter((r) => r.favorite);
    const regular = filtered.filter((r) => !r.favorite);

    const SHELF_SIZE = 9;
    const buildShelfRows = (arr) => {
      const frag = document.createDocumentFragment();
      for (let i = 0; i < arr.length; i += SHELF_SIZE) {
        const row = document.createElement("div");
        row.className = "books-shelf-row";
        row.style.setProperty("--recipes-spine-h", `${RECIPE_SPINE_H}px`);
        arr.slice(i, i + SHELF_SIZE).forEach((recipe) => row.appendChild(buildSpine(recipe)));
        frag.appendChild(row);
      }
      return frag;
    };

    $shelfList.innerHTML = "";
    $shelfList.appendChild(buildShelfRows(regular));

    if (favorites.length) {
      $shelfFavoritesSection.style.display = "block";
      $shelfFavorites.innerHTML = "";
      $shelfFavorites.appendChild(buildShelfRows(favorites));
      if ($shelfFavoritesCount) $shelfFavoritesCount.textContent = String(favorites.length);
    } else {
      $shelfFavoritesSection.style.display = "none";
      $shelfFavorites.innerHTML = "";
      if ($shelfFavoritesCount) $shelfFavoritesCount.textContent = "0";
    }

    if ($shelfResults) {
      $shelfResults.textContent = filtered.length
        ? `Recetas visibles: ${filtered.length}`
        : "Sin coincidencias";
    }
    if ($shelfEmpty) {
      $shelfEmpty.style.display = filtered.length ? "none" : "block";
    }
    if ($empty) {
      $empty.style.display = recipes.length ? "none" : "block";
    }
  }

  function buildSpine(recipe) {
    const spine = document.createElement("div");
    const [c1, c2] = recipe.favorite ? ["#f8e6aa", "#d3a74a"] : pickSpinePalette(recipe.title + recipe.id);
    const height = RECIPE_SPINE_H;
    spine.className = "book-spine recipe-spine";
    spine.style.setProperty("--spine-color-1", c1);
    spine.style.setProperty("--spine-color-2", c2);
    spine.style.setProperty("--spine-height", `${Math.min(170, height)}px`);
    spine.title = `${recipe.title} · ${formatRatingStars(recipe.rating)}`;
    if (recipe.favorite) spine.classList.add("book-spine-favorite", "recipe-spine-favorite");
    if (recipe.laura) spine.classList.add("recipe-spine-laura");

    const title = document.createElement("span");
    title.className = "book-spine-title";
    title.textContent = recipe.title;

    const ratingBadge = document.createElement("span");
    ratingBadge.className = "recipe-spine-rating";
    ratingBadge.textContent = formatRatingStars(recipe.rating);

    if (recipe.laura) {
      const badge = document.createElement("span");
      badge.className = "laura-mark";
      badge.textContent = "L";
      spine.appendChild(badge);
    }
    if (recipe.favorite) {
      const star = document.createElement("span");
      star.className = "book-spine-star";
      star.textContent = "★";
      spine.appendChild(star);
    }

    spine.appendChild(title);
    spine.appendChild(ratingBadge);
    spine.addEventListener("click", () => openRecipeDetail(recipe.id));
    spine.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openRecipeDetail(recipe.id);
      }
    });
    spine.tabIndex = 0;
    return spine;
  }

  function renderCards() {
    if (!$cardsHost) return;
    const filtered = filterRecipes();
    const frag = document.createDocumentFragment();

    filtered.forEach((recipe) => {
      const card = document.createElement("article");
      card.className = "recipe-card is-collapsed";

      const header = document.createElement("div");
      header.className = "recipe-card-header";

      const titleRow = document.createElement("div");
      titleRow.className = "recipe-card-title";
      const title = document.createElement("h3");
      title.textContent = recipe.title;
      titleRow.appendChild(title);
      if (recipe.laura) {
        const mark = document.createElement("span");
        mark.className = "laura-mark";
        mark.textContent = "L";
        titleRow.appendChild(mark);
      }
      if (recipe.favorite) {
        const fav = document.createElement("span");
        fav.className = "book-spine-star";
        fav.textContent = "★";
        titleRow.appendChild(fav);
      }
      header.appendChild(titleRow);

      const rating = document.createElement("div");
      rating.className = "recipe-stars";
      for (let i = 1; i <= 5; i++) {
        const star = document.createElement("span");
        star.className = "recipe-star" + (recipe.rating >= i - 0.25 ? " is-active" : "");
        star.textContent = "★";
        star.addEventListener("click", (e) => {
          e.stopPropagation();
          updateRecipe(recipe.id, { rating: i });
        });
        rating.appendChild(star);
      }
      header.appendChild(rating);
      header.addEventListener("click", () => card.classList.toggle("is-collapsed"));

      const body = document.createElement("div");
      body.className = "recipe-card-body";

      const tags = document.createElement("div");
      tags.className = "recipe-card-tags";
      (recipe.tags || []).forEach((t) => {
        const chip = document.createElement("span");
        chip.className = "recipe-chip";
        chip.textContent = t;
        tags.appendChild(chip);
      });

      const meta = document.createElement("div");
      meta.className = "recipe-meta";
      const countryLabel = recipe.countryLabel || recipe.country || "—";
      meta.innerHTML = `
        <div class="recipe-meta-item"><strong>Tipo</strong><br>${recipe.meal}</div>
        <div class="recipe-meta-item"><strong>Salud</strong><br>${recipe.health}</div>
        <div class="recipe-meta-item"><strong>País</strong><br>${countryLabel}</div>
        <div class="recipe-meta-item"><strong>Última vez</strong><br>${recipe.lastCooked || "—"}</div>
        <div class="recipe-meta-item"><strong>Valoración</strong><br>${recipe.rating ?? 0} ★</div>
        <div class="recipe-meta-item"><strong>Nutrición</strong><br>${roundMacro(recipe.nutritionTotals?.kcal || 0)} kcal</div>
      `;

      const actions = document.createElement("div");
      actions.className = "recipe-actions";

      const lauraToggle = document.createElement("label");
      lauraToggle.className = "laura-check";
      lauraToggle.innerHTML = `
        <input type="checkbox" ${recipe.laura ? "checked" : ""} />
        <span class="laura-check-mark" aria-hidden="true"></span>
        <span>Check de Laura</span>
      `;
      lauraToggle.querySelector("input").addEventListener("change", (e) => {
        e.stopPropagation();
        updateRecipe(recipe.id, { laura: e.target.checked });
      });

      const favToggle = document.createElement("label");
      favToggle.className = "recipe-favorite-toggle";
      favToggle.innerHTML = `
        <input type="checkbox" ${recipe.favorite ? "checked" : ""} />
        <span>Favorita</span>
      `;
      favToggle.querySelector("input").addEventListener("change", (e) => {
        e.stopPropagation();
        updateRecipe(recipe.id, { favorite: e.target.checked });
      });

      const editBtn = document.createElement("button");
      editBtn.className = "btn ghost";
      editBtn.type = "button";
      editBtn.textContent = "Editar";
      editBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openRecipeModal(recipe);
      });

      const openBtn = document.createElement("button");
      openBtn.className = "btn ghost btn-compact";
      openBtn.type = "button";
      openBtn.textContent = "Abrir";
      openBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openRecipeDetail(recipe.id);
      });

      const mealBtn = document.createElement("button");
      mealBtn.className = "btn ghost btn-compact";
      mealBtn.type = "button";
      mealBtn.textContent = "Añadir a comida";
      mealBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        switchRecipesPanel("macros");
        addRecipeToMeal("lunch", recipe, 1);
      });

      actions.appendChild(lauraToggle);
      actions.appendChild(favToggle);
      actions.appendChild(editBtn);
      actions.appendChild(openBtn);
      actions.appendChild(mealBtn);

      if (recipe.notes) {
        const notes = document.createElement("div");
        notes.className = "recipe-meta-item";
notes.innerHTML = `<strong>Notas</strong><br>${linkifyNotesHtml(recipe.notes)}`;
        body.appendChild(notes);
      }

      body.appendChild(meta);
      body.appendChild(tags);
      body.appendChild(actions);

      card.appendChild(header);
      card.appendChild(body);
      frag.appendChild(card);
    });

    $cardsHost.innerHTML = "";
    $cardsHost.appendChild(frag);

    if ($empty) $empty.style.display = filtered.length ? "none" : "block";
  }

  function renderStats() {
    const total = recipes.length;
    const favorites = recipes.filter((r) => r.favorite).length;
    const healthy = recipes.filter((r) => r.health === "sana").length;
    const rating =
      recipes.reduce((acc, r) => acc + (Number(r.rating) || 0), 0) / (total || 1);
    if ($statTotal) $statTotal.textContent = String(total);
    if ($statFavorites) $statFavorites.textContent = String(favorites);
    if ($statHealthy) $statHealthy.textContent = String(healthy);
    if ($statRating) $statRating.textContent = `${rating.toFixed(1)} `;
    const lauraChecksTotal = recipes.filter((r) => r.laura).length;
    const lauraChecksFavorites = recipes.filter((r) => r.laura && r.favorite).length;
    if ($statLauraPositive) {
  $statLauraPositive.textContent = String(lauraChecksTotal);
  $statLauraPositive.title = `Total con check de Laura: ${lauraChecksTotal}.`;
}
  }

  function recipePolar(cx, cy, r, deg) {
    const a = (deg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  }

  function recipeDonutSlicePath(cx, cy, rOuter, rInner, startDeg, endDeg) {
    const sweep = Math.max(0.001, endDeg - startDeg);
    const e = startDeg + Math.min(359.999, sweep);
    const p1 = recipePolar(cx, cy, rOuter, startDeg);
    const p2 = recipePolar(cx, cy, rOuter, e);
    const p3 = recipePolar(cx, cy, rInner, e);
    const p4 = recipePolar(cx, cy, rInner, startDeg);
    const large = e - startDeg > 180 ? 1 : 0;
    return [
      `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
      `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
      `L ${p3.x.toFixed(3)} ${p3.y.toFixed(3)}`,
      `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(3)} ${p4.y.toFixed(3)}`,
      "Z",
    ].join(" ");
  }

  function createRecipeSvgEl(tag, attrs = {}) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    return el;
  }

  function getRecipeDonutGeometry(hostWidth = 360) {
    const baseW = 360;
    const baseH = 240;
    const minW = 260;
    const maxW = 520;
    const width = Math.max(minW, Math.min(maxW, hostWidth || baseW));
    const scale = width / baseW;
    const height = baseH * scale;
    const cx = width / 2;
    const cy = height / 2;
    const rOuter = 92 * scale;
    const rInner = 60 * scale;

    return {
      width,
      height,
      cx,
      cy,
      rOuter,
      rInner,
      strokeWidth: rOuter - rInner,
      calloutInnerGap: 2 * scale,
      calloutOuterGap: 18 * scale,
      labelOffset: 32 * scale,
      centerYOffset: 4 * scale,
      centerSubYOffset: 14 * scale,
      focusYOffset: 32 * scale,
    };
  }

  function topRecipeEntries(entries = [], maxSlices = 6) {
    const arr = (entries || []).filter((e) => e && e.value > 0);
    arr.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
    if (arr.length <= maxSlices) return arr;
    const head = arr.slice(0, maxSlices - 1);
    const tail = arr.slice(maxSlices - 1);
    const others = tail.reduce((acc, e) => acc + e.value, 0);
    head.push({ label: "Otros", value: others });
    return head;
  }

  function renderRecipeDonut(host, title, entries, options = {}) {
    if (!host) return;

    if (typeof host.__recipeDonutCleanup === "function") {
      host.__recipeDonutCleanup();
      delete host.__recipeDonutCleanup;
    }

    const data = topRecipeEntries(entries, 6);
    const total = data.reduce((acc, e) => acc + e.value, 0);
    if (!total) {
      host.innerHTML = `<div class="books-shelf-empty">Sin datos</div>`;
      return;
    }

    let a0 = 0;
    const slicesData = data.map((entry) => {
      const frac = entry.value / total;
      const a1 = a0 + frac * 360;
      const mid = (a0 + a1) / 2;
      const slice = {
        ...entry,
        a0,
        a1,
        mid,
        pct: Math.round(frac * 100),
      };
      a0 = a1;
      return slice;
    });

    const onSliceSelect = typeof options.onSliceSelect === "function" ? options.onSliceSelect : null;
    const activeLabel = normalizeLabel(options.activeLabel || "").toLowerCase();
    let activeIdx = activeLabel
      ? slicesData.findIndex((s) => normalizeLabel(s.label).toLowerCase() === activeLabel)
      : null;
    if (activeIdx != null && activeIdx < 0) activeIdx = null;
    let applyActive = () => {};

    const renderWithWidth = (hostWidth) => {
      const { svg, setActive } = buildDonutSvg(hostWidth);
      applyActive = setActive;
      host.innerHTML = "";
      host.appendChild(svg);
      applyActive(activeIdx);
    };

    const handleSelect = (idx) => {
      activeIdx = idx === activeIdx ? null : idx;
      applyActive(activeIdx);
      if (onSliceSelect) {
        onSliceSelect(activeIdx != null ? slicesData[activeIdx] : null);
      }
    };

    function buildDonutSvg(hostWidth = 360) {
      const {
        width,
        height,
        cx,
        cy,
        rOuter,
        rInner,
        strokeWidth,
        calloutInnerGap,
        calloutOuterGap,
        labelOffset,
        centerYOffset,
        centerSubYOffset,
        focusYOffset,
      } = getRecipeDonutGeometry(hostWidth);

      const svg = createRecipeSvgEl("svg", {
        class: "donut-svg",
        viewBox: `0 0 ${width} ${height}`,
        role: "img",
        "aria-label": title,
      });

      const defs = createRecipeSvgEl("defs");
      const glow = createRecipeSvgEl("filter", {
        id: "donut-glow",
        x: "-50%",
        y: "-50%",
        width: "200%",
        height: "200%",
      });
      glow.appendChild(
        createRecipeSvgEl("feDropShadow", {
          dx: "0",
          dy: "6",
          stdDeviation: "8",
          "flood-color": "rgba(245,230,166,0.45)",
        })
      );
      defs.appendChild(glow);
      svg.appendChild(defs);

      const ring = createRecipeSvgEl("circle", {
        class: "donut-ring-base",
        cx,
        cy,
        r: (rOuter + rInner) / 2,
        "stroke-width": strokeWidth,
      });

      const slicesGroup = createRecipeSvgEl("g", { class: "donut-slices" });
      const calloutsGroup = createRecipeSvgEl("g", { class: "donut-callouts" });
      const centerGroup = createRecipeSvgEl("g", { class: "donut-center-group" });

      const centerMain = createRecipeSvgEl("text", {
        class: "donut-center",
        x: cx,
        y: cy - centerYOffset,
        "text-anchor": "middle",
      });
      centerMain.textContent = title;

      const centerSub = createRecipeSvgEl("text", {
        class: "donut-center-sub",
        x: cx,
        y: cy + centerSubYOffset,
        "text-anchor": "middle",
      });
      centerSub.textContent = `${total} ${options.unitLabel || "recetas"}`;

      const centerFocus = createRecipeSvgEl("text", {
        class: "donut-center-focus",
        x: cx,
        y: cy + focusYOffset,
        "text-anchor": "middle",
      });
      centerFocus.textContent = recipeDonutFocusHint;

      centerGroup.appendChild(centerMain);
      centerGroup.appendChild(centerSub);
      centerGroup.appendChild(centerFocus);

      const slicesEls = [];
      const calloutEls = [];

      slicesData.forEach((s, idx) => {
        const path = createRecipeSvgEl("path", {
          class: "donut-slice",
          d: recipeDonutSlicePath(cx, cy, rOuter, rInner, s.a0, s.a1),
          fill: "transparent",
          stroke: recipeDonutSliceStroke,
          "data-index": String(idx),
          role: "button",
          tabindex: "0",
          "aria-label": `${s.label}: ${s.value} (${s.pct}%)`,
        });
        path.dataset.label = s.label;
        path.dataset.value = String(s.value);
        path.dataset.pct = String(s.pct);
        slicesGroup.appendChild(path);
        slicesEls.push(path);

        const p1 = recipePolar(cx, cy, rOuter + calloutInnerGap, s.mid);
        const p2 = recipePolar(cx, cy, rOuter + calloutOuterGap, s.mid);
        const right = Math.cos((s.mid - 90) * (Math.PI / 180)) >= 0;
        const x3 = right ? p2.x + labelOffset : p2.x - labelOffset;
        const y3 = p2.y;
        const tx = right ? x3 + 3 : x3 - 3;
        const anchor = right ? "start" : "end";

        const callout = createRecipeSvgEl("g", {
          class: "donut-callout",
          "data-index": String(idx),
          role: "button",
          tabindex: "0",
          "aria-label": `${s.label}: ${s.value} (${s.pct}%)`,
        });
        const line = createRecipeSvgEl("polyline", {
          class: "donut-line",
          points: `${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ${x3.toFixed(2)},${y3.toFixed(2)}`,
          fill: "none",
        });
        const label = createRecipeSvgEl("text", {
          class: "donut-label",
          x: tx.toFixed(2),
          y: (y3 - 2).toFixed(2),
          "text-anchor": anchor,
        });
        const t1 = createRecipeSvgEl("tspan", { x: tx.toFixed(2), dy: "0" });
        t1.textContent = s.label;
        const t2 = createRecipeSvgEl("tspan", {
          class: "donut-label-value",
          x: tx.toFixed(2),
          dy: "12",
        });
        t2.textContent = `${s.value} · ${s.pct}%`;
        label.appendChild(t1);
        label.appendChild(t2);

        callout.appendChild(line);
        callout.appendChild(label);
        calloutsGroup.appendChild(callout);
        calloutEls.push(callout);

        const activate = () => handleSelect(idx);
        const handleKey = (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            activate();
          }
        };

        path.addEventListener("click", activate);
        path.addEventListener("keydown", handleKey);
        callout.addEventListener("click", activate);
        callout.addEventListener("keydown", handleKey);
      });

      function setActive(idx = null) {
        slicesEls.forEach((p, i) => {
          const isActive = i === idx;
          p.classList.toggle("active", isActive);
          p.setAttribute("fill", isActive ? recipeDonutActiveFill : "transparent");
          p.setAttribute("stroke", isActive ? recipeDonutActiveStroke : recipeDonutSliceStroke);
          p.setAttribute("filter", isActive ? "url(#donut-glow)" : "");
          p.setAttribute("aria-pressed", isActive ? "true" : "false");
        });
        calloutEls.forEach((c, i) => {
          const isActive = i === idx;
          c.classList.toggle("active", isActive);
          c.setAttribute("aria-pressed", isActive ? "true" : "false");
        });

        if (idx == null) {
          centerFocus.textContent = recipeDonutFocusHint;
        } else {
          const s = slicesData[idx];
          centerFocus.textContent = `${s.label}: ${s.value} (${s.pct}%)`;
        }
      }

      setActive(activeIdx);

      svg.appendChild(slicesGroup);
      svg.appendChild(calloutsGroup);
      svg.appendChild(centerGroup);

      return { svg, setActive };
    }

    const ro = new ResizeObserver((entries) => {
      const width = Math.round(entries?.[0]?.contentRect?.width || host.clientWidth || 360);
      renderWithWidth(width);
    });
    ro.observe(host);
    host.__recipeDonutCleanup = () => ro.disconnect();
    renderWithWidth(host.clientWidth || 360);
  }

  function clearRecipeDonutSelection() {
    recipeDonutActiveType = null;
    recipeDonutActiveLabel = null;
    recipeDonutBackupChips = null;
  }

  function applyRecipeDonutFilter(selection, type) {
    const label = normalizeLabel(selection?.label || "");
    const aggregated = label.toLowerCase() === "otros";
    if (!selection || aggregated) {
      if (recipeDonutBackupChips) {
        filterState.chips = new Set(recipeDonutBackupChips);
      }
      clearRecipeDonutSelection();
      renderChips();
      renderShelf();
      renderCharts();
      return;
    }

    if (recipeDonutActiveType && recipeDonutActiveType !== type) {
      applyRecipeDonutFilter(null, recipeDonutActiveType);
    }

    if (!recipeDonutBackupChips) {
      recipeDonutBackupChips = new Set(filterState.chips);
    }

    recipeDonutActiveType = type;
    recipeDonutActiveLabel = label;

    const next = new Set();
    if (type === "meal") next.add(`meal:${label.toLowerCase()}`);
    if (type === "health") next.add(`health:${label.toLowerCase()}`);
    filterState.chips = next;

    renderChips();
    renderShelf();
    renderCharts();
  }

  function buildRecipeCountryStats() {
    const m = new Map();
    recipes.forEach((r) => {
      const country = normalizeRecipeCountry(r?.country, r?.countryLabel);
      if (!country || !country.label) return;
      const key = country.code || country.label.toLowerCase();
      const current = m.get(key) || { code: country.code, label: country.label, english: country.english, value: 0 };
      current.value += 1;
      m.set(key, current);
    });
    return Array.from(m.values()).sort(
      (a, b) => b.value - a.value || a.label.localeCompare(b.label, "es", { sensitivity: "base" })
    );
  }

  function renderRecipeGeo() {
    if (!$recipesGeoSection) return;
    const stats = buildRecipeCountryStats();
      $recipesGeoSection.style.display = "block";
    if (!stats.length) {
      if ($recipesCountryList) $recipesCountryList.innerHTML = "";
      if ($recipesWorldMap) {
        // mostramos mapa aunque no haya países, con mensaje de ayuda
        renderCountryHeatmap($recipesWorldMap, [], { emptyLabel: "Añade el país de cada receta" });
      }
      requestAnimationFrame(() => $recipesWorldMap?.__geoChart?.resize?.());
      return;
    }
requestAnimationFrame(() => $recipesWorldMap?.__geoChart?.resize?.());

    
    const mapData = stats
      .filter((s) => s.code)
      .map((s) => ({
        code: s.code,
        value: s.value,
        label: s.label,
        mapName: s.english,
      }));
    renderCountryHeatmap($recipesWorldMap, mapData, { emptyLabel: "Añade el país de cada receta" });
    renderCountryList($recipesCountryList, stats, "plato");
  }

  function renderCharts() {
    renderRecipeGeo();
    const mealEntries = MEAL_TYPES.map((m) => ({
      label: m,
      value: recipes.filter((r) => r.meal === m).length,
    })).filter((m) => m.value > 0);

    if (recipeDonutActiveType === "meal") {
      const hasActive = mealEntries.some(
        (m) => normalizeLabel(m.label).toLowerCase() === normalizeLabel(recipeDonutActiveLabel).toLowerCase()
      );
      if (!hasActive) clearRecipeDonutSelection();
    }

    renderRecipeDonut($chartMeal, "Momento del día", mealEntries, {
      unitLabel: "recetas",
      onSliceSelect: (selection) => applyRecipeDonutFilter(selection, "meal"),
      activeLabel: recipeDonutActiveType === "meal" ? recipeDonutActiveLabel : null,
    });

    const healthEntries = HEALTH_TYPES.map((h) => ({
      label: h,
      value: recipes.filter((r) => r.health === h).length,
    })).filter((h) => h.value > 0);

    if (recipeDonutActiveType === "health") {
      const hasActive = healthEntries.some(
        (h) => normalizeLabel(h.label).toLowerCase() === normalizeLabel(recipeDonutActiveLabel).toLowerCase()
      );
      if (!hasActive) clearRecipeDonutSelection();
    }

    renderRecipeDonut($chartHealth, "Salud", healthEntries, {
      unitLabel: "recetas",
      onSliceSelect: (selection) => applyRecipeDonutFilter(selection, "health"),
      activeLabel: recipeDonutActiveType === "health" ? recipeDonutActiveLabel : null,
    });
  }

  function buildActivityMap() {
    const map = {};
    recipes.forEach((r) => {
      const cooked = r.cookedDates || [];
      cooked.forEach((d) => {
        const key = normalizeDate(d);
        if (!key) return;
        if (!map[key]) map[key] = { total: 0, favorites: 0 };
        map[key].total += 1;
        if (r.favorite) map[key].favorites += 1;
      });
    });
    return map;
  }

  function renderCalendar() {
    if (!$calGrid) return;
    const activity = buildActivityMap();
    if (calViewMode === "year") {
      renderCalendarYear(activity);
      return;
    }
    const first = new Date(calYear, calMonth, 1);
    const startOffset = (first.getDay() + 6) % 7; // lunes = 0
    const days = new Date(calYear, calMonth + 1, 0).getDate();
    const fragment = document.createDocumentFragment();

    for (let i = 0; i < startOffset; i++) {
      const empty = document.createElement("div");
      empty.className = "cal-cell cal-cell-empty";
      fragment.appendChild(empty);
    }

    let monthTotal = 0;
    for (let day = 1; day <= days; day++) {
      const key = `${calYear}-${String(calMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const cell = document.createElement("div");
      cell.className = "cal-cell";
      const head = document.createElement("div");
      head.className = "cal-day-number";
      head.textContent = day;
      cell.appendChild(head);

      if (activity[key]) {
        monthTotal += activity[key].total;
        const info = document.createElement("div");
        info.className = "cal-pages";
        info.textContent = `${activity[key].total} receta${activity[key].total > 1 ? "s" : ""}`;
        cell.appendChild(info);
        cell.classList.add("cal-cell-highlight");
      }
      fragment.appendChild(cell);
    }

    $calGrid.classList.remove("calendar-year-grid");
    $calGrid.innerHTML = "";
    $calGrid.appendChild(fragment);
    if ($calLabel) {
      const monthNames = ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"];
      $calLabel.textContent = `${monthNames[calMonth]} ${calYear}`;
    }
    if ($calSummary) {
      $calSummary.textContent = monthTotal
        ? `Cocinaste ${monthTotal} receta${monthTotal > 1 ? "s" : ""} este mes`
        : "Aún no hay cocinadas este mes";
    }
  }

  function renderCalendarYear(activity) {
    const fragment = document.createDocumentFragment();
    let yearTotal = 0;
    for (let month = 0; month < 12; month++) {
      const days = new Date(calYear, month + 1, 0).getDate();
      let count = 0;
      for (let day = 1; day <= days; day++) {
        const key = `${calYear}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        if (activity[key]) count += activity[key].total;
      }
      yearTotal += count;
      const cell = document.createElement("div");
      cell.className = "cal-cell cal-cell-year";
      const name = document.createElement("div");
      name.className = "cal-month-name";
      const monthNames = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
      name.textContent = monthNames[month];
      const metrics = document.createElement("div");
      metrics.className = "cal-month-metrics";
      metrics.textContent = count ? `${count} receta${count > 1 ? "s" : ""}` : "—";
      cell.appendChild(name);
      cell.appendChild(metrics);
      if (count) cell.classList.add("cal-cell-highlight");
      fragment.appendChild(cell);
    }

    $calGrid.classList.add("calendar-year-grid");
    $calGrid.innerHTML = "";
    $calGrid.appendChild(fragment);
    if ($calLabel) $calLabel.textContent = `${calYear}`;
    if ($calSummary) $calSummary.textContent = yearTotal
      ? `Total anual: ${yearTotal} recetas`
      : "Sin registros en el año";
  }

  function openRecipeModal(recipe = null) {
    if (!$modalBackdrop) return;
    closeRecipeDetail();
    // reset import UI
if ($recipeImportBox) $recipeImportBox.classList.add("hidden");
if ($recipeImportText) $recipeImportText.value = "";
if ($recipeImportStatus) $recipeImportStatus.textContent = "";

    $modalBackdrop.classList.remove("hidden");
    $modalBackdrop.focus?.();

    // foto
    _recipePhotoRemove = false;
    clearRecipePhotoObjectUrl();
    if ($recipeImageFile) $recipeImageFile.value = "";
    setRecipePhotoPreview(recipe?.imageURL || null);
    setRecipePhotoStatus("");
    const isEditing = !!recipe;
    if ($recipeDelete) $recipeDelete.style.display = isEditing ? "inline-flex" : "none";
    if (recipe) {
      $recipeId.value = recipe.id;
      $modalTitle.textContent = "Editar receta";
      $recipeName.value = recipe.title || "";
      $recipeMeal.value = recipe.meal || "comida";
      $recipeHealth.value = recipe.health || "sana";
      $recipeTags.value = (recipe.tags || []).join(", ");
      if ($recipeCountry) $recipeCountry.value = recipe.countryLabel || recipe.country || "";
      $recipeRating.value = recipe.rating ?? 0;
      $recipeLastCooked.value = recipe.lastCooked || "";
      $recipeNotes.value = recipe.notes || "";
      $recipeFavorite.checked = !!recipe.favorite;
      $recipeLaura.checked = !!recipe.laura;
      renderIngredientRows(recipe.ingredients && recipe.ingredients.length ? recipe.ingredients : [DEFAULT_INGREDIENT()]);
      renderStepRows(recipe.steps && recipe.steps.length ? recipe.steps : [DEFAULT_STEP()]);
      if ($recipeServings) $recipeServings.value = String(Math.max(1, Number(recipe.servings) || 1));
      renderNutriIngredientRows(recipe.nutritionIngredients && recipe.nutritionIngredients.length ? recipe.nutritionIngredients : []);
    } else {
      $modalTitle.textContent = "Nueva receta";
      $recipeId.value = "";
      $recipeName.value = "";
      $recipeMeal.value = "comida";
      $recipeHealth.value = "sana";
      $recipeTags.value = "";
      if ($recipeCountry) $recipeCountry.value = "";
      $recipeRating.value = "4";
      $recipeLastCooked.value = "";
      $recipeNotes.value = "";
      $recipeFavorite.checked = false;
      $recipeLaura.checked = false;
      renderIngredientRows([DEFAULT_INGREDIENT()]);
      renderStepRows([DEFAULT_STEP()]);
      if ($recipeServings) $recipeServings.value = "1";
      renderNutriIngredientRows([]);
    }
  }

  function closeRecipeModal() {
    clearRecipePhotoObjectUrl();
    if ($modalBackdrop) $modalBackdrop.classList.add("hidden");
  }

  function updateRecipe(id, patch) {
    const ts = Date.now();
    try { localStorage.setItem("bookshell.lastRecipeId", String(id)); localStorage.setItem("bookshell.lastRecipeAt", String(ts)); } catch (_) {}
    const mergedPatch = { ...(patch || {}), updatedAt: ts };
    recipes = recipes.map((r) => (r.id === id ? normalizeRecipeFields({ ...r, ...mergedPatch }) : r));
    const updated = recipes.find((r) => r.id === id);
    if (updated) persistRecipe(id, updated);
    refreshUI();
    if (detailRecipeId === id) renderRecipeDetail(id);
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
  }

  async function upsertRecipeFromForm(evt) {
    evt.preventDefault();
    const $submitBtn = $recipeForm?.querySelector?.("button[type='submit']");
    const prevSubmitText = $submitBtn ? $submitBtn.textContent : "";
    const id = $recipeId.value || generateId();
    const existing = recipes.find((r) => r.id === id);
    const cookedDates = [...(existing?.cookedDates || [])];
    const countryInfo = normalizeRecipeCountry($recipeCountry?.value);
    const payload = {
      id,
      title: ($recipeName.value || "").trim(),
      meal: $recipeMeal.value,
      health: $recipeHealth.value,
      tags: ($recipeTags.value || "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean),
      rating: Number($recipeRating.value) || 0,
      lastCooked: normalizeDate($recipeLastCooked.value),
      notes: ($recipeNotes.value || "").trim(),
      updatedAt: Date.now(),
      tracking: !!existing?.tracking,
      trackingAt: existing?.trackingAt || null,
      favorite: $recipeFavorite.checked,
      laura: $recipeLaura.checked,
      country: countryInfo?.code || null,
      countryLabel: countryInfo?.label || null,
      cookedDates,
      ingredients: collectIngredientRows(),
      steps: collectStepRows(),
      servings: Math.max(1, Number($recipeServings?.value) || 1),
      nutritionIngredients: collectNutriIngredientRows(),
    };

    if (!payload.title) return;
    if (payload.lastCooked && !payload.cookedDates.includes(payload.lastCooked)) {
      payload.cookedDates.push(payload.lastCooked);
    }

    // foto (Cloudinary) — misma lógica que productos
    const file = $recipeImageFile?.files?.[0] || null;
    const previousUrl = existing?.imageURL || null;

    if ($submitBtn) {
      $submitBtn.disabled = true;
      $submitBtn.textContent = file ? "Subiendo foto…" : "Guardando…";
    }

    try {
      let nextUrl = previousUrl;

      if (_recipePhotoRemove) nextUrl = null;

      if (file) {
        setRecipePhotoStatus("Subiendo foto…");
        nextUrl = await subirImagenACloudinarySafe(file);
        setRecipePhotoStatus("Foto subida ✅");
      }

      payload.imageURL = nextUrl;
    } finally {
      if ($submitBtn) {
        $submitBtn.disabled = false;
        $submitBtn.textContent = prevSubmitText || "Guardar";
      }
    }

    let normalizedPayload = normalizeRecipeFields(payload);
    const calculatedNutrition = recalcRecipeNutrition(normalizedPayload);
    normalizedPayload = normalizeRecipeFields({ ...normalizedPayload, nutritionTotals: calculatedNutrition.totals, nutritionPerServing: calculatedNutrition.perServing });

    let nextRecipe = normalizedPayload;
    if (existing) {
      recipes = recipes.map((r) => (r.id === id ? { ...r, ...normalizedPayload } : r));
      nextRecipe = recipes.find((r) => r.id === id) || normalizedPayload;
    } else {
      recipes = [{ ...normalizedPayload }, ...recipes];
    }
    persistRecipe(id, nextRecipe);
    closeRecipeModal();
    refreshUI();
  }

  function refreshUI() {
    renderChips();
    renderShelf();
    renderStats();
    renderCharts();
    renderCalendar();
    renderMacrosView();
    renderStatisticsView();
  }

  function renderIngredientRows(list = []) {
    if (!$recipeIngredientsList) return;
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildIngredientRow(item)));
    $recipeIngredientsList.innerHTML = "";
    $recipeIngredientsList.appendChild(frag);
  }

  function renderStepRows(list = []) {
    if (!$recipeStepsList) return;
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildStepRow(item)));
    $recipeStepsList.innerHTML = "";
    $recipeStepsList.appendChild(frag);
  }

  function buildIngredientRow(item = DEFAULT_INGREDIENT()) {
    const row = document.createElement("div");
    row.className = "builder-row ingredient-row";
    row.dataset.id = item.id || generateId();

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "builder-check";
    checkbox.checked = !!item.done;

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Ingrediente";
    input.value = item.text || "";
    input.className = "builder-input";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn icon-btn-small";
    remove.textContent = "✕";
    remove.addEventListener("click", () => row.remove());

    row.appendChild(checkbox);
    row.appendChild(input);
    row.appendChild(remove);
    return row;
  }

  function buildStepRow(item = DEFAULT_STEP()) {
    const row = document.createElement("div");
    row.className = "builder-row step-row";
    row.dataset.id = item.id || generateId();

    const top = document.createElement("div");
    top.className = "step-row-top";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.className = "builder-check";
    checkbox.checked = !!item.done;

    const title = document.createElement("input");
    title.type = "text";
    title.placeholder = "Título del paso";
    title.value = item.title || "";
    title.className = "builder-input";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn-eliminar-comida";
    remove.textContent = "✕";
    remove.addEventListener("click", () => row.remove());

    top.appendChild(checkbox);
    top.appendChild(title);
    top.appendChild(remove);

    const desc = document.createElement("textarea");
    desc.rows = 2;
    desc.placeholder = "Descripción del paso";
    desc.value = item.description || "";
    desc.className = "builder-textarea";

    row.appendChild(top);
    row.appendChild(desc);
    return row;
  }

  function collectIngredientRows() {
    if (!$recipeIngredientsList) return [];
    return Array.from($recipeIngredientsList.querySelectorAll(".ingredient-row"))
      .map((row) => {
        const text = row.querySelector("input[type='text']")?.value.trim() || "";
        const parsed = splitIngredientText(text);
        return {
          id: row.dataset.id || generateId(),
          text,
          quantity: parsed.quantity,
          name: parsed.name || text,
          productId: String(row.dataset.productId || "").trim(),
          done: row.querySelector("input[type='checkbox']")?.checked || false,
        };
      })
      .filter((ing) => ing.text);
  }

  function collectStepRows() {
    if (!$recipeStepsList) return [];
    return Array.from($recipeStepsList.querySelectorAll(".step-row"))
      .map((row) => ({
        id: row.dataset.id || generateId(),
        title: row.querySelector("input[type='text']")?.value.trim() || "",
        description: row.querySelector("textarea")?.value.trim() || "",
        done: row.querySelector("input[type='checkbox']")?.checked || false,
      }))
      .filter((step) => step.title || step.description);
  }

  function openRecipeDetail(id) {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe || !$recipeDetailBackdrop) return;
    detailRecipeId = id;
    try { localStorage.setItem("bookshell.lastRecipeId", String(id)); } catch (_) {}
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    $recipeDetailBackdrop.classList.remove("hidden");
    renderRecipeDetail(id);
    
  }

  // === API para Dashboard (Inicio) ===
  function __dashGetLastViewedRecipe() {
    try {
      const id = localStorage.getItem("bookshell.lastRecipeId");
      if (!id) return null;
      return (Array.isArray(recipes) ? recipes : []).find((r) => String(r.id) === String(id)) || null;
    } catch (_) {
      return null;
    }
  }

  function __dashGetTrackedRecipe() {
    try {
      const storedId = localStorage.getItem("bookshell.trackedRecipeId");
      const storedAt = Number(localStorage.getItem("bookshell.trackedRecipeAt") || 0) || 0;

      const list = Array.isArray(recipes) ? recipes : [];
      let best = null;
      let bestTs = -1;

      list.forEach((r) => {
        if (!r) return;
        const isTracked = !!r.tracking || (storedId && String(r.id) === String(storedId));
        if (!isTracked) return;
        const ts = Number(r.trackingAt) || (storedId && String(r.id) === String(storedId) ? storedAt : 0) || 0;
        if (ts > bestTs) {
          bestTs = ts;
          best = r;
        }
      });

      if (!best && storedId) return list.find((r) => String(r.id) === String(storedId)) || null;
      return best || null;
    } catch (_) {
      return null;
    }
  }

  function __dashRecipeSortTs(r) {
    if (!r) return 0;
    const n = Number(r.updatedAt);
    if (Number.isFinite(n) && n > 0) return n;
    const t = Number(r.trackingAt);
    if (Number.isFinite(t) && t > 0) return t;

    const s = String(r.lastCooked || "");
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
      const d = new Date(s + "T00:00:00");
      const ms = d.getTime();
      return Number.isFinite(ms) ? ms : 0;
    }
    return 0;
  }

  function __dashGetRecentRecipeFallback() {
    try {
      const list = Array.isArray(recipes) ? [...recipes] : [];
      const withChecks = list.filter((r) =>
        Array.isArray(r?.ingredients) && r.ingredients.some((ing) => !!ing?.done)
      );
      const pickFrom = withChecks.length ? withChecks : list;
      pickFrom.sort((a, b) => __dashRecipeSortTs(b) - __dashRecipeSortTs(a));
      return pickFrom[0] || null;
    } catch (_) {
      return null;
    }
  }

  try {
    window.__bookshellRecipes = {
      getTrackedRecipe: __dashGetTrackedRecipe,
      getLastViewedRecipe: __dashGetLastViewedRecipe,
      getRecentRecipeFallback: __dashGetRecentRecipeFallback,
      openRecipeDetail,
    };
  } catch (_) {}

  try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}


  function renderRecipeDetail(id) {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe || !$recipeDetailBackdrop) return;
    setActiveRecipePanel("ingredients");

    if ($recipeDetailHero && $recipeDetailImage) {
      const url = recipe.imageURL || null;
      if (url) {
        $recipeDetailHero.style.display = "block";
        $recipeDetailImage.src = url;
      } else {
        $recipeDetailHero.style.display = "none";
        $recipeDetailImage.removeAttribute("src");
      }
    }

    if ($recipeDetailTitle) $recipeDetailTitle.textContent = recipe.title || "Receta";
    if ($recipeDetailMeal) $recipeDetailMeal.textContent = recipe.meal || "";
    syncRecipeBookmarkButton(recipe);
    if ($recipeDetailTags) {
      $recipeDetailTags.innerHTML = "";
      (recipe.tags || []).forEach((tag) => {
        const chip = document.createElement("span");
        chip.className = "recipe-detail-chip subtle";
        chip.textContent = tag;
        $recipeDetailTags.appendChild(chip);
      });
    }

    if ($recipeDetailMeta) {
      $recipeDetailMeta.innerHTML = "";
      const items = [
        { label: "Salud", value: recipe.health },
        { label: "Valoración", value: `${recipe.rating ?? 0} ★` },
        { label: "Última vez", value: recipe.lastCooked || "—" },
        { label: "Favorita", value: recipe.favorite ? "Sí" : "No" },
        { label: "Laura", value: recipe.laura ? "Sí" : "No" },
        { label: "Calorías", value: `${roundMacro(recipe.nutritionTotals?.kcal || 0)} kcal` },
      ];
      const cost = computeRecipeEstimatedCost(recipe);
      if (cost.covered > 0) {
        items.push({ label: "Coste estimado", value: `~${roundMacro(cost.total)}€ (${cost.covered}/${cost.totalIngredients || 0} ing.)` });
      }
      items.forEach((item) => {
        const block = document.createElement("div");
        block.className = "spec-item";
        block.innerHTML = `<div class="spec-label">${item.label}</div><div class="spec-value">${item.value}</div>`;
        $recipeDetailMeta.appendChild(block);
      });
    }

    if ($recipeDetailGrid) {
      $recipeDetailGrid.innerHTML = "";
      const gridItems = [
        { label: "Tipo de comida", value: recipe.meal },
        { label: "País / origen", value: recipe.countryLabel || recipe.country || "—" },
        { label: "Etiquetas", value: (recipe.tags || []).join(", ") || "—" },
        { label: "Macros", value: `C ${roundMacro(recipe.nutritionTotals?.carbs || 0)} · P ${roundMacro(recipe.nutritionTotals?.protein || 0)} · G ${roundMacro(recipe.nutritionTotals?.fat || 0)}` },
        { label: "Por ración", value: `${roundMacro(recipe.nutritionPerServing?.kcal || 0)} kcal` },
      ];
      gridItems.forEach((item) => {
        const row = document.createElement("div");
        row.className = "spec-item";
        row.innerHTML = `<div class="spec-label">${item.label}</div><div class="spec-value">${item.value}</div>`;
        $recipeDetailGrid.appendChild(row);
      });

      const notesRow = document.createElement("div");
      notesRow.className = "spec-item spec-item-notes spec-notes";
notesRow.innerHTML = `<div class="spec-label">Notas</div><div class="spec-value">${linkifyNotesHtml(
  recipe.notes || "—"
)}</div>`;
      $recipeDetailGrid.appendChild(notesRow);
    }

    if ($recipeDetailIngredients) {
      $recipeDetailIngredients.innerHTML = "";
      (recipe.ingredients && recipe.ingredients.length ? recipe.ingredients : [DEFAULT_INGREDIENT()]).forEach(
        (ing) => {
          const label = document.createElement("label");
          label.className = "detail-check";
          const display = resolveIngredientDisplay(ing);
          const check = document.createElement("input");
          check.type = "checkbox";
          check.checked = !!ing.done;
          check.addEventListener("change", (e) =>
            toggleChecklistItem(recipe.id, ing.id, e.target.checked, "ingredient")
          );
          const qty = document.createElement("span");
          qty.className = "detail-ing-qty";
          qty.textContent = display.quantity || "—";
          const text = document.createElement("span");
          text.className = "detail-ing-name";
          text.textContent = display.name || "Ingrediente";
          const infoBtn = document.createElement("button");
          infoBtn.type = "button";
          infoBtn.className = "icon-btn icon-btn-small detail-ing-info";
          infoBtn.textContent = "i";
          infoBtn.title = "Abrir ficha del ingrediente";
          infoBtn.addEventListener("click", (ev) => {
            try { ev.preventDefault(); ev.stopPropagation(); } catch (_) {}
            const linked = display.product || nutritionProducts.find((p) => p.id === ing.productId) || null;
            const draft = linked || {
              id: ing.productId || undefined,
              name: display.name || ing.text || "",
              source: "recipe",
              macros: normalizeMacros({}),
              servingBaseGrams: 100,
            };
            openMacroProductModal(draft, "breakfast", 100, null, { ingredientTarget: { recipeId: recipe.id, ingredientId: ing.id } });
          });
          label.appendChild(check);
          label.appendChild(qty);
          label.appendChild(text);
          label.appendChild(infoBtn);
          $recipeDetailIngredients.appendChild(label);
        }
      );
    }

    if ($recipeDetailSteps) {
      $recipeDetailSteps.innerHTML = "";
      (recipe.steps && recipe.steps.length ? recipe.steps : [DEFAULT_STEP()]).forEach((step, idx) => {
        const item = document.createElement("div");
        item.className = "detail-step";
        const header = document.createElement("div");
        header.className = "detail-step-header";
        const check = document.createElement("input");
        check.type = "checkbox";
        check.checked = !!step.done;
        check.addEventListener("change", (e) =>
          toggleChecklistItem(recipe.id, step.id, e.target.checked, "step")
        );
        const title = document.createElement("div");
        title.className = "detail-step-title";
        title.textContent = step.title || `Paso ${idx + 1}`;
        header.appendChild(check);
        header.appendChild(title);
        const desc = document.createElement("div");
        desc.className = "detail-step-desc";
        desc.textContent = step.description || "Describe este paso";
        item.appendChild(header);
        item.appendChild(desc);
        $recipeDetailSteps.appendChild(item);
      });
    }

    if ($recipeDetailNotesWrapper && $recipeDetailNotes) {
      const hasNotes = !!(recipe.notes || "").trim();
      $recipeDetailNotesWrapper.style.display = hasNotes ? "block" : "none";
 $recipeDetailNotes.innerHTML = linkifyNotesHtml(recipe.notes || "");
    }

    if ($recipeDetailDelete) {
      $recipeDetailDelete.dataset.recipeId = recipe.id;
    }
  }


  function closeRecipeDetail() {
    if ($recipeDetailBackdrop) $recipeDetailBackdrop.classList.add("hidden");
    detailRecipeId = null;
  }

  function setActiveRecipePanel(target = "ingredients") {
    $recipeDetailTabs?.forEach((tab) => {
      const isActive = tab.dataset.target === target;
      tab.classList.toggle("is-active", isActive);
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      tab.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    $recipeDetailPanels?.forEach((panel) => {
      const isActive = panel.dataset.panel === target;
      panel.classList.toggle("is-active", isActive);
      panel.setAttribute("aria-hidden", isActive ? "false" : "true");
    });
  }


  function setRecipeTracking(recipeId, shouldTrack) {
    const ts = Date.now();
    const idStr = String(recipeId);
    const changed = [];

    recipes = (Array.isArray(recipes) ? recipes : []).map((r) => {
      if (!r) return r;
      const isTarget = String(r.id) === idStr;
      let next = r;

      // si activamos, quitamos tracking al resto (solo una en seguimiento)
      if (shouldTrack && !isTarget) {
        if (!r.tracking) return r;
        next = normalizeRecipeFields({
          ...r,
          tracking: false,
          trackingAt: r.trackingAt || null,
          updatedAt: ts
        });
        changed.push(next);
        return next;
      }

      if (!isTarget) return r;

      if (shouldTrack) {
        next = normalizeRecipeFields({ ...r, tracking: true, trackingAt: ts, updatedAt: ts });
        changed.push(next);
        return next;
      }
      next = normalizeRecipeFields({ ...r, tracking: false, trackingAt: null, updatedAt: ts });
      changed.push(next);
      return next;
    });

    changed.forEach((recipe) => persistRecipe(recipe.id, recipe));
    refreshUI();

    try {
      if (shouldTrack) {
        localStorage.setItem("bookshell.trackedRecipeId", idStr);
        localStorage.setItem("bookshell.trackedRecipeAt", String(ts));
      } else {
        const cur = localStorage.getItem("bookshell.trackedRecipeId");
        if (cur && String(cur) === idStr) {
          localStorage.removeItem("bookshell.trackedRecipeId");
          localStorage.removeItem("bookshell.trackedRecipeAt");
        }
      }
    } catch (_) {}

    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}

    if (detailRecipeId === recipeId) renderRecipeDetail(recipeId);
  }

  function syncRecipeBookmarkButton(recipe) {
    const btn = document.getElementById("recipe-detail-bookmark");
    if (!btn) return;
    const on = !!recipe?.tracking;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
    btn.title = on ? "En seguimiento" : "Marcar en seguimiento";
  }

function toggleChecklistItem(recipeId, itemId, value, type) {
  const recipe = recipes.find((r) => r.id === recipeId);
  if (!recipe) return;

  const now = Date.now();

  if (type === "ingredient") {
    const ingredients = (recipe.ingredients || []).map((ing) =>
      ing.id === itemId ? { ...ing, done: value } : ing
    );
    updateRecipe(recipeId, { ingredients, updatedAt: now });
  } else {
    const steps = (recipe.steps || []).map((step) =>
      step.id === itemId ? { ...step, done: value } : step
    );
    updateRecipe(recipeId, { steps, updatedAt: now });
  }
}

  function deleteRecipe(id) {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe) return;
    const confirmed = window.confirm(`¿Eliminar la receta \"${recipe.title}\"?`);
    if (!confirmed) return;
    recipes = recipes.filter((r) => r.id !== id);
    removeRecipeRemote(id);
    closeRecipeModal();
    closeRecipeDetail();
    refreshUI();
  }

  // Eventos
  $filtersToggle?.addEventListener("click", () => {
    const collapsed = $filters.classList.toggle("is-collapsed");
    const expanded = !collapsed;
    $filtersToggle.setAttribute("aria-expanded", String(expanded));
    $filtersToggle.querySelector(".filters-toggle-text").textContent = expanded
      ? "Ocultar filtros"
      : "Mostrar filtros";
  });

  $filterSearch?.addEventListener("input", (e) => {
    filterState.query = e.target.value || "";
    renderShelf();
  });

  $shelfSearch?.addEventListener("input", (e) => {
    filterState.shelfQuery = e.target.value || "";
    renderShelf();
  });

  $filterFavorites?.addEventListener("change", (e) => {
    filterState.favoritesOnly = e.target.checked;
    refreshUI();
  });

  $filterLaura?.addEventListener("change", (e) => {
    filterState.lauraOnly = e.target.checked;
    refreshUI();
  });

  $filterChips?.addEventListener("click", (e) => {
    const chip = e.target.closest(".filter-chip");
    if (!chip || !chip.dataset.chip) return;
    const key = chip.dataset.chip;
    if (filterState.chips.has(key)) {
      filterState.chips.delete(key);
      chip.classList.remove("is-active");
    } else {
      filterState.chips.add(key);
      chip.classList.add("is-active");
    }
    renderShelf();
    renderCharts();
  });

  $btnAddRecipe?.addEventListener("click", () => openRecipeModal());
  function setImportStatus(msg){
  if ($recipeImportStatus) $recipeImportStatus.textContent = msg || "";
}

function guessMealFromCategories(cats){
  const s = (cats || []).join(",").toLowerCase();
  if (s.includes("desay")) return "desayuno";
  if (s.includes("cena")) return "cena";
  if (s.includes("snack") || s.includes("merienda")) return "snack";
  return "comida";
}

$recipeImportToggle?.addEventListener("click", () => {
  if (!$recipeImportBox) return;
  $recipeImportBox.classList.toggle("hidden");
  setImportStatus("");
});

$recipeImportClear?.addEventListener("click", () => {
  if ($recipeImportText) $recipeImportText.value = "";
  setImportStatus("");
});

$recipeImportBtn?.addEventListener("click", () => {
  try{
    const raw = ($recipeImportText?.value || "").trim();
    const data = parseRecipeV1(raw);

    if (data.title) $recipeName.value = data.title;

    if ($recipeCountry && data.country) $recipeCountry.value = data.country;

    if (data.categories?.length){
      $recipeTags.value = data.categories.join(", ");
      $recipeMeal.value = guessMealFromCategories(data.categories);
    }

    // Notas: mete “datos” + notas extra
    const meta = [];
    if (data.servings) meta.push(`Raciones: ${data.servings}`);
    if (data.timeMin) meta.push(`Tiempo: ${data.timeMin} min`);
    if (data.difficulty) meta.push(`Dificultad: ${data.difficulty}`);
    const kcal = data.macros?.kcal ? `Kcal: ${data.macros.kcal}` : "";
    const p = data.macros?.p ? `P: ${data.macros.p}g` : "";
    const c = data.macros?.c ? `C: ${data.macros.c}g` : "";
    const f = data.macros?.f ? `G: ${data.macros.f}g` : "";
    const macrosLine = [kcal,p,c,f].filter(Boolean).join(" · ");
    if (macrosLine) meta.push(macrosLine);

    const notesLines = (data.notes || []).filter(Boolean);
    const mergedNotes = [
      meta.length ? meta.join(" | ") : "",
      ...notesLines
    ].filter(Boolean).join("\n");

    if (mergedNotes) $recipeNotes.value = mergedNotes;

    // Ingredientes
    const ingRows = (data.ingredients || []).map((i) => {
      const left = [i.amount, i.unit].map((v) => (v || "").trim()).filter(Boolean).join(" ");
      const name = (i.name || "").trim();
      const note = (i.note || "").trim();
      const txt = [left, name].filter(Boolean).join(" ").trim() + (note ? ` (${note})` : "");
      return { id: generateId(), text: txt, done: false };
    });
    renderIngredientRows(ingRows.length ? ingRows : [DEFAULT_INGREDIENT()]);

    // Pasos
    const stepRows = (data.steps || []).map((s, idx) => ({
      id: generateId(),
      title: `Paso ${idx + 1}`,
      description: s,
      done: false,
    }));
    renderStepRows(stepRows.length ? stepRows : [DEFAULT_STEP()]);

    setImportStatus("Importado. Revisa y guarda ✅");
  }catch(err){
    setImportStatus(`No pude importar: ${err?.message || "formato inválido"}`);
  }
});

  $modalClose?.addEventListener("click", closeRecipeModal);
  $modalCancel?.addEventListener("click", closeRecipeModal);
  $modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === $modalBackdrop) closeRecipeModal();
  });
  $recipeForm?.addEventListener("submit", upsertRecipeFromForm);
  $recipeAddIngredient?.addEventListener("click", () =>
    $recipeIngredientsList?.appendChild(buildIngredientRow())
  );
  $recipeAddStep?.addEventListener("click", () => $recipeStepsList?.appendChild(buildStepRow()));
  $recipeAddNutriIngredient?.addEventListener("click", () => $recipeNutriIngredientsList?.appendChild(buildNutriIngredientRow()));
  $recipeDelete?.addEventListener("click", () => {
    const id = $recipeId.value;
    if (id) deleteRecipe(id);
  });

  // Foto (cámara / galería)
  $recipeImageCamera?.addEventListener("click", () => {
    if (!$recipeImageFile) return;
    _recipePhotoRemove = false;
    try { $recipeImageFile.setAttribute("capture", "environment"); } catch (_) {}
    $recipeImageFile.click();
  });

  $recipeImageGallery?.addEventListener("click", () => {
    if (!$recipeImageFile) return;
    _recipePhotoRemove = false;
    try { $recipeImageFile.removeAttribute("capture"); } catch (_) {}
    $recipeImageFile.click();
  });

  $recipeImageFile?.addEventListener("change", () => {
    const file = $recipeImageFile.files && $recipeImageFile.files[0];
    clearRecipePhotoObjectUrl();
    if (!file) {
      setRecipePhotoPreview(null);
      return;
    }
    _recipePhotoRemove = false;
    _recipePhotoObjectUrl = URL.createObjectURL(file);
    setRecipePhotoPreview(_recipePhotoObjectUrl);
    setRecipePhotoStatus("Lista ✅ (se sube al guardar)");
  });

  $recipeImageRemove?.addEventListener("click", () => {
    _recipePhotoRemove = true;
    clearRecipePhotoObjectUrl();
    if ($recipeImageFile) $recipeImageFile.value = "";
    setRecipePhotoPreview(null);
    setRecipePhotoStatus("Foto quitada (guarda para aplicar) ⚠️");
  });


  $recipeDetailClose?.addEventListener("click", closeRecipeDetail);
  $recipeDetailCloseBottom?.addEventListener("click", closeRecipeDetail);
  $recipeDetailBackdrop?.addEventListener("click", (e) => {
    if (e.target === $recipeDetailBackdrop) closeRecipeDetail();
  });
  $recipeDetailEdit?.addEventListener("click", () => {
    if (!detailRecipeId) return;
    const recipe = recipes.find((r) => r.id === detailRecipeId);
    if (recipe) openRecipeModal(recipe);
  });
  $recipeDetailDelete?.addEventListener("click", () => {
    if (detailRecipeId) deleteRecipe(detailRecipeId);
  });

  // Bookmark / seguimiento (Dashboard) — delegación (por si el botón se crea dinámicamente)
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("#recipe-detail-bookmark");
    if (!btn) return;

    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    if (!detailRecipeId) return;
    const recipe = recipes.find((r) => String(r.id) === String(detailRecipeId));
    if (!recipe) return;

    const now = Date.now();
    const next = !recipe.tracking;

    recipe.tracking = next;
    recipe.trackingAt = next ? now : 0;
    recipe.updatedAt = now; // importante: "reciente" y refrescos

    try {
      const keyId = "bookshell.trackedRecipeId";
      const keyAt = "bookshell.trackedRecipeAt";
      if (next) {
        localStorage.setItem(keyId, String(recipe.id));
        localStorage.setItem(keyAt, String(now));
      } else {
        const storedId = localStorage.getItem(keyId);
        if (storedId && String(storedId) === String(recipe.id)) {
          localStorage.removeItem(keyId);
          localStorage.removeItem(keyAt);
        }
      }
    } catch (_) {}

    persistRecipe(recipe.id, recipe);
    try { syncRecipeBookmarkButton(recipe); } catch (_) {}
    try { console.debug("[recipes] tracking", { id: recipe.id, tracking: recipe.tracking, trackingAt: recipe.trackingAt }); } catch (_) {}
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
  });;

  $recipeDetailTabs?.forEach((tab) => {
    tab.addEventListener("click", () => setActiveRecipePanel(tab.dataset.target || "ingredients"));
  });

  $calPrev?.addEventListener("click", () => {
    if (calViewMode === "year") {
      calYear -= 1;
    } else {
      calMonth -= 1;
      if (calMonth < 0) {
        calMonth = 11;
        calYear -= 1;
      }
    }
    renderCalendar();
    renderMacrosView();
  });

  $calNext?.addEventListener("click", () => {
    if (calViewMode === "year") {
      calYear += 1;
    } else {
      calMonth += 1;
      if (calMonth > 11) {
        calMonth = 0;
        calYear += 1;
      }
    }
    renderCalendar();
    renderMacrosView();
  });

  $calViewMode?.addEventListener("change", (e) => {
    calViewMode = e.target.value;
    renderCalendar();
    renderMacrosView();
  });


  function nutritionRootPath(uid = currentUid) {
    const root = recipesRootPath(uid);
    return root ? `${root}/nutrition` : null;
  }

  function normalizeDailyLogs(rawLogs = {}) {
    const normalized = {};
    if (!rawLogs || typeof rawLogs !== "object") return normalized;
    Object.entries(rawLogs).forEach(([date, log]) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const meals = {};
      mealOrder.forEach((meal) => {
        const entries = Array.isArray(log?.meals?.[meal]?.entries) ? log.meals[meal].entries : [];
        meals[meal] = {
          entries: entries.map((entry) => ({
            type: entry?.type === "recipe" ? "recipe" : "product",
            refId: entry?.refId || "",
            nameSnapshot: String(entry?.nameSnapshot || "").trim(),
            grams: Math.max(0, Number(entry?.grams) || 0),
            servings: Math.max(0, Number(entry?.servings) || 0),
            macrosSnapshot: normalizeMacros(entry?.macrosSnapshot || {}),
            habitSync: {
              habitId: String(entry?.habitSync?.habitId || "").trim(),
              amount: Math.max(0, Number(entry?.habitSync?.amount) || 0),
            },
            createdAt: Number(entry?.createdAt) || Date.now(),
          })),
        };
      });
      normalized[date] = { meals };
    });
    return normalized;
  }

  function normalizeNutritionProductEntry(product = {}) {
    return {
      ...product,
      id: String(product.id || generateId()).trim(),
      name: String(product.name || "").trim(),
      brand: String(product.brand || "").trim(),
      barcode: String(product.barcode || "").trim(),
      servingBaseGrams: Math.max(1, Number(product.servingBaseGrams) || 100),
      macros: normalizeMacros(product.macros),
      financeProductId: String(product.financeProductId || "").trim(),
      linkedHabitId: String(product.linkedHabitId || "").trim(),
    };
  }

  function loadNutritionCache() {
    try {
      const raw = localStorage.getItem(`${getStorageKey()}.nutrition`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      nutritionProducts = Array.isArray(parsed.products) ? parsed.products.map(normalizeNutritionProductEntry).filter((p) => p.name) : [];
      dailyLogsByDate = normalizeDailyLogs(parsed.dailyLogsByDate && typeof parsed.dailyLogsByDate === "object" ? parsed.dailyLogsByDate : {});
      nutritionGoals = { ...defaultGoals, ...(parsed.goals || {}) };
      nutritionSyncMeta = {
        version: Number(parsed?.syncMeta?.version) || 2,
        migratedAt: Number(parsed?.syncMeta?.migratedAt) || 0,
        updatedAt: Number(parsed?.syncMeta?.updatedAt) || 0,
      };
    } catch (_) {}
  }

  function cacheNutrition() {
    try {
      localStorage.setItem(`${getStorageKey()}.nutrition`, JSON.stringify({
        products: nutritionProducts,
        dailyLogsByDate: normalizeDailyLogs(dailyLogsByDate),
        goals: nutritionGoals,
        syncMeta: nutritionSyncMeta,
      }));
    } catch (_) {}
  }

  function listenNutritionRemote() {
    onAuthStateChanged(auth, (user) => {
      const uid = user?.uid;
      if (nutritionUnsubscribe) {
        try { nutritionUnsubscribe(); } catch (_) {}
        nutritionUnsubscribe = null;
      }
      if (!uid) return;
      const root = nutritionRootPath(uid);
      if (!root) return;
      nutritionUnsubscribe = onValue(ref(db, root), (snap) => {
        const data = snap.val() || {};
        const remoteProducts = Array.isArray(data.products) ? data.products.map(normalizeNutritionProductEntry).filter((p) => p.name) : [];
        const remoteLogs = normalizeDailyLogs(data.dailyLogsByDate && typeof data.dailyLogsByDate === "object" ? data.dailyLogsByDate : {});
        const remoteGoals = { ...defaultGoals, ...(data.goals || {}) };
        nutritionSyncMeta = {
          version: Number(data?.syncMeta?.version) || 2,
          migratedAt: Number(data?.syncMeta?.migratedAt) || nutritionSyncMeta.migratedAt || Date.now(),
          updatedAt: Number(data?.syncMeta?.updatedAt) || Number(data?.updatedAt) || Date.now(),
        };

        const hasRemoteData = remoteProducts.length || Object.keys(remoteLogs).length || Object.keys(data?.goals || {}).length;
        if (!hasRemoteData) {
          const hasLocalData = nutritionProducts.length || Object.keys(dailyLogsByDate || {}).length;
          if (hasLocalData) {
            persistNutrition();
            return;
          }
        }

        nutritionProducts = remoteProducts;
        dailyLogsByDate = remoteLogs;
        nutritionGoals = remoteGoals;
        cacheNutrition();
        recalcAllRecipesNutrition();
        refreshUI();
        renderMacrosView();
        renderStatisticsView();
      }, (err) => {
        console.warn("No se pudo escuchar nutrición remota", err);
      });
    });
  }

  function persistNutrition() {
    dailyLogsByDate = normalizeDailyLogs(dailyLogsByDate);
    nutritionSyncMeta = {
      version: 2,
      migratedAt: nutritionSyncMeta.migratedAt || Date.now(),
      updatedAt: Date.now(),
    };
    const payload = {
      products: nutritionProducts,
      dailyLogsByDate,
      goals: nutritionGoals,
      syncMeta: nutritionSyncMeta,
      updatedAt: nutritionSyncMeta.updatedAt,
    };
    const root = nutritionRootPath();
    if (root) {
      try {
        set(ref(db, root), payload);
      } catch (err) { console.warn("No se pudo sincronizar nutrición", err); }
    }
    cacheNutrition();
  }

  function recalcRecipeNutrition(recipe) {
    const list = Array.isArray(recipe?.nutritionIngredients) ? recipe.nutritionIngredients : [];
    const totals = list.reduce((acc, it) => {
      const product = nutritionProducts.find((p) => p.id === it.productId);
      return plusMacros(acc, calcProductMacros(product, it.grams));
    }, normalizeMacros({}));
    const servings = Math.max(1, Number(recipe?.servings) || 1);
    const perServing = {
      carbs: totals.carbs / servings,
      protein: totals.protein / servings,
      fat: totals.fat / servings,
      kcal: totals.kcal / servings,
    };
    return { totals, perServing };
  }

  function recalcAllRecipesNutrition() {
    recipes = recipes.map((r) => {
      const calc = recalcRecipeNutrition(r);
      return normalizeRecipeFields({ ...r, nutritionTotals: calc.totals, nutritionPerServing: calc.perServing });
    });
  }

  function getDailyLog(date = selectedMacroDate) {
    if (!dailyLogsByDate[date]) {
      dailyLogsByDate[date] = { meals: { breakfast: { entries: [] }, lunch: { entries: [] }, dinner: { entries: [] }, snacks: { entries: [] } } };
    }
    mealOrder.forEach((meal) => {
      if (!dailyLogsByDate[date].meals?.[meal]) dailyLogsByDate[date].meals[meal] = { entries: [] };
      if (!Array.isArray(dailyLogsByDate[date].meals[meal].entries)) dailyLogsByDate[date].meals[meal].entries = [];
    });
    return dailyLogsByDate[date];
  }

  function computeMealTotals(entries = []) {
    return entries.reduce((acc, e) => plusMacros(acc, e.macrosSnapshot || {}), normalizeMacros({}));
  }

  function computeDailyTotals(date = selectedMacroDate) {
    const log = getDailyLog(date);
    return mealOrder.reduce((acc, meal) => plusMacros(acc, computeMealTotals(log.meals[meal].entries)), normalizeMacros({}));
  }

  function getPeriodBounds(period, anchorIso) {
    const anchor = new Date(`${anchorIso}T00:00:00`);
    if (Number.isNaN(anchor.getTime())) return { start: anchorIso, end: anchorIso };
    let start = new Date(anchor);
    let end = new Date(anchor);
    if (period === "day") {
      // same day
    } else if (period === "week") {
      const dow = (anchor.getDay() + 6) % 7;
      start.setDate(anchor.getDate() - dow);
      end = new Date(start);
      end.setDate(start.getDate() + 6);
    } else if (period === "month") {
      start = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
      end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    } else if (period === "year") {
      start = new Date(anchor.getFullYear(), 0, 1);
      end = new Date(anchor.getFullYear(), 11, 31);
    }
    return { start: toISODate(start), end: toISODate(end) };
  }

  function listDatesInPeriod(period, anchorIso) {
    const { start, end } = getPeriodBounds(period, anchorIso);
    const out = [];
    const cursor = new Date(`${start}T00:00:00`);
    const endDate = new Date(`${end}T00:00:00`);
    while (cursor <= endDate) {
      out.push(toISODate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return out;
  }

  function summarizeStatistics(period = macroStatsState.period, anchorIso = macroStatsState.anchorDate) {
    const dates = listDatesInPeriod(period, anchorIso);
    const byRecipe = new Map();
    const byProduct = new Map();
    const daySeries = [];
    let totals = normalizeMacros({});
    let mealCount = 0;
    let recipeCount = 0;
    let maxDay = { date: null, kcal: 0 };
    const mealKcal = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };

    dates.forEach((date) => {
      const log = getDailyLog(date);
      const dayTotals = computeDailyTotals(date);
      daySeries.push({ date, totals: dayTotals });
      totals = plusMacros(totals, dayTotals);
      if (dayTotals.kcal > maxDay.kcal) maxDay = { date, kcal: dayTotals.kcal };
      mealOrder.forEach((meal) => {
        const entries = log.meals?.[meal]?.entries || [];
        if (entries.length) mealCount += 1;
        const mt = computeMealTotals(entries);
        mealKcal[meal] += mt.kcal;
        entries.forEach((entry) => {
          const key = entry.refId || entry.nameSnapshot;
          const target = entry.type === "recipe" ? byRecipe : byProduct;
          const prev = target.get(key) || {
            name: entry.nameSnapshot || (entry.type === "recipe" ? "Receta" : "Producto"),
            count: 0,
            grams: 0,
            servings: 0,
            macros: normalizeMacros({}),
          };
          prev.count += 1;
          prev.grams += Number(entry.grams) || 0;
          prev.servings += Number(entry.servings) || 0;
          prev.macros = plusMacros(prev.macros, entry.macrosSnapshot || {});
          target.set(key, prev);
          if (entry.type === "recipe") recipeCount += 1;
        });
      });
    });

    const avg = {
      carbs: totals.carbs / Math.max(1, dates.length),
      protein: totals.protein / Math.max(1, dates.length),
      fat: totals.fat / Math.max(1, dates.length),
      kcal: totals.kcal / Math.max(1, dates.length),
    };

    const topRecipes = Array.from(byRecipe.values()).sort((a, b) => b.count - a.count || b.macros.kcal - a.macros.kcal).slice(0, 8);
    const topProducts = Array.from(byProduct.values()).sort((a, b) => b.count - a.count || b.macros.kcal - a.macros.kcal).slice(0, 8);

    return { dates, daySeries, totals, avg, mealCount, recipeCount, topRecipes, topProducts, maxDay, mealKcal };
  }

  function renderSimpleDonut(host, segments = []) {
    if (!host) return;
    const total = segments.reduce((acc, s) => acc + Math.max(0, Number(s.value) || 0), 0);
    const radius = 44;
    const circumference = 2 * Math.PI * radius;
    if (!total) {
      host.innerHTML = `<circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="14"></circle><text x="60" y="65" text-anchor="middle" fill="rgba(255,255,255,.65)" font-size="10">Sin datos</text>`;
      return;
    }
    let offset = 0;
    const arcs = segments.map((seg) => {
      const ratio = Math.max(0, Number(seg.value) || 0) / total;
      const len = circumference * ratio;
      const arc = `<circle cx="60" cy="60" r="44" fill="none" stroke="${seg.color}" stroke-width="14" stroke-dasharray="${len} ${circumference-len}" stroke-dashoffset="${-offset}" transform="rotate(-90 60 60)"></circle>`;
      offset += len;
      return arc;
    }).join("");
    host.innerHTML = `<circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="14"></circle>${arcs}<text x="60" y="58" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">${roundMacro(total)}</text><text x="60" y="72" text-anchor="middle" fill="rgba(255,255,255,.65)" font-size="9">total</text>`;
  }

  function renderStatisticsView() {
    if (!$recipesPanelStatistics || !$macroStatsKpis) return;
    const summary = summarizeStatistics();
    const metricLabelMap = { macros: "Carbs, proteína y grasas", kcal: "Calorías", carbs: "Carbohidratos", protein: "Proteínas", fat: "Grasas" };

    if ($macroStatsAnchor) $macroStatsAnchor.value = macroStatsState.anchorDate;
    $macroStatsPeriods?.querySelectorAll("[data-stats-period]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.statsPeriod === macroStatsState.period);
    });
    if ($macroStatsMainMetric) $macroStatsMainMetric.value = macroStatsState.metric;
    if ($macroStatsMainLabel) $macroStatsMainLabel.textContent = `${metricLabelMap[macroStatsState.metric] || "Métrica"} · ${summary.dates[0] || "-"} → ${summary.dates[summary.dates.length - 1] || "-"}`;

    $macroStatsKpis.innerHTML = [
      ["Kcal totales", `${roundMacro(summary.totals.kcal)}`],
      ["Media kcal/día", `${roundMacro(summary.avg.kcal)}`],
      ["Carbs totales", `${roundMacro(summary.totals.carbs)}g`],
      ["Proteínas totales", `${roundMacro(summary.totals.protein)}g`],
      ["Grasas totales", `${roundMacro(summary.totals.fat)}g`],
      ["Comidas registradas", `${summary.mealCount}`],
      ["Recetas consumidas", `${summary.recipeCount}`],
      ["Plato más repetido", `${summary.topRecipes[0]?.name || "—"}`],
      ["Día más calórico", `${summary.maxDay.date || "—"} (${roundMacro(summary.maxDay.kcal)} kcal)`],
      ["Media macros/día", `C ${roundMacro(summary.avg.carbs)} · P ${roundMacro(summary.avg.protein)} · G ${roundMacro(summary.avg.fat)}`],
    ].map(([k, v]) => `<article class="macro-stats-kpi"><div class="macro-stats-kpi-label">${k}</div><div class="macro-stats-kpi-value">${v}</div></article>`).join("");

    if ($macroStatsMainChart) {
      const w = 760, h = 260, pad = { l: 42, r: 18, t: 16, b: 30 };
      const points = summary.daySeries;
      const labels = points.map((p) => p.date.slice(5));
      const series = macroStatsState.metric === "macros"
        ? [
            { key: "carbs", color: "#44d492", name: "Carbs" },
            { key: "protein", color: "#66a3ff", name: "Proteínas" },
            { key: "fat", color: "#ffb84d", name: "Grasas" },
          ]
        : [{ key: macroStatsState.metric, color: "#f5e6a6", name: metricLabelMap[macroStatsState.metric] || "Métrica" }];
      const maxVal = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p.totals?.[s.key]) || 0)));
      const xStep = (w - pad.l - pad.r) / Math.max(1, points.length - 1);
      const y = (v) => h - pad.b - (Math.max(0, v) / maxVal) * (h - pad.t - pad.b);
      const lines = series.map((s) => {
        const d = points.map((p, i) => `${i ? "L" : "M"}${pad.l + i * xStep},${y(Number(p.totals?.[s.key]) || 0)}`).join(" ");
        return `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="3" stroke-linecap="round"></path>`;
      }).join("");
      const xTicks = labels.map((lb, i) => `<text x="${pad.l + i * xStep}" y="${h - 8}" text-anchor="middle" fill="rgba(255,255,255,.65)" font-size="9">${lb}</text>`).join("");
      const legend = series.map((s, i) => `<text x="${pad.l + i * 130}" y="12" fill="${s.color}" font-size="10">● ${s.name}</text>`).join("");
      $macroStatsMainChart.innerHTML = `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect><line x1="${pad.l}" y1="${h-pad.b}" x2="${w-pad.r}" y2="${h-pad.b}" stroke="rgba(255,255,255,.15)"></line>${lines}${xTicks}${legend}`;
    }

    renderSimpleDonut($macroStatsDonutMacros, [
      { value: summary.totals.carbs, color: "#44d492" },
      { value: summary.totals.protein, color: "#66a3ff" },
      { value: summary.totals.fat, color: "#ffb84d" },
    ]);
    renderSimpleDonut($macroStatsDonutKcal, [
      { value: summary.totals.carbs * 4, color: "#44d492" },
      { value: summary.totals.protein * 4, color: "#66a3ff" },
      { value: summary.totals.fat * 9, color: "#ffb84d" },
    ]);
    renderSimpleDonut($macroStatsDonutMeals, mealOrder.map((meal, i) => ({ value: summary.mealKcal[meal], color: ["#6fddff", "#b79bff", "#f7b0ff", "#ffd166"][i] })));

    const row = (item) => `<div class="macro-stats-row"><strong>${escapeHtml(item.name)}</strong><span>${item.count} veces</span><span>${roundMacro(item.grams || item.servings)} ${item.grams ? "g" : "rac"}</span><span>${roundMacro(item.macros?.kcal)} kcal</span><span>C ${roundMacro(item.macros?.carbs)} · P ${roundMacro(item.macros?.protein)} · G ${roundMacro(item.macros?.fat)}</span></div>`;
    if ($macroStatsTopRecipes) $macroStatsTopRecipes.innerHTML = summary.topRecipes.map(row).join("") || '<div class="hint">Sin recetas en el periodo.</div>';
    if ($macroStatsTopProducts) $macroStatsTopProducts.innerHTML = summary.topProducts.map(row).join("") || '<div class="hint">Sin productos en el periodo.</div>';
  }

  function switchRecipesPanel(panel = "library") {
    const isLibrary = panel === "library";
    const isMacros = panel === "macros";
    const isStatistics = panel === "statistics";
    $recipesPanelLibrary?.classList.toggle("is-active", isLibrary);
    $recipesPanelMacros?.classList.toggle("is-active", isMacros);
    $recipesPanelStatistics?.classList.toggle("is-active", isStatistics);
    $recipesSubtabs.forEach((btn) => {
      const active = btn.dataset.recipesPanel === panel;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (isMacros) renderMacrosView();
    if (isStatistics) renderStatisticsView();
  }

  function renderMacrosView() {
    if (!$recipesPanelMacros || !$macroSummaryGrid || !$macroMeals) return;
    const log = getDailyLog(selectedMacroDate);
    const totals = computeDailyTotals(selectedMacroDate);
    const items = [
      { key: "carbs", label: "Carb. netos", unit: "g" },
      { key: "protein", label: "Proteínas", unit: "g" },
      { key: "fat", label: "Grasas", unit: "g" },
      { key: "kcal", label: "Calorías", unit: "kcal" },
    ];
    $macroDateInput.value = selectedMacroDate;
    const buildStatHtml = ({ key, label, unit, step }) => {
      const value = roundMacro(totals[key]);
      const goal = roundMacro(nutritionGoals[key] || 0);
      const pct = goal > 0 ? Math.min(140, Math.round((value / goal) * 100)) : 0;
      const excess = goal > 0 && value > goal;
      return `
        <div class="macro-stat macro-stat-${key} ${excess ? "is-excess" : ""}">
          <div class="macro-stat-title">${label}</div>
          <div class="macro-stat-value">
            <span class="macro-consumed">${value}${unit}</span>
            <span class="macro-sep">/</span>
            <input
              class="macro-goal-input-stats"
              type="number"
              min="0"
              step="${step}"
              inputmode="decimal"
              placeholder="${goal}"
              value=""
              data-macro-goal="${key}"
              aria-label="Objetivo ${label}"
            />
            <span class="macro-unit">${unit}</span>
          </div>
          <div class="macro-progress">
          <span style="width:${pct}%"></span>
          </div>
        </div>
      `;
    };

    const macroItems = [
      { key: "carbs", label: "Carb. netos", unit: "g", step: 1 },
      { key: "protein", label: "Proteínas", unit: "g", step: 1 },
      { key: "fat", label: "Grasas", unit: "g", step: 1 },
    ];
    const kcalItems = [{ key: "kcal", label: "Calorías", unit: "kcal", step: 10 }];

    $macroSummaryGrid.innerHTML = `
      <div class="macro-summary-group macro-summary-group-kcal">
        ${kcalItems.map(buildStatHtml).join("")}
      </div>
      <div class="macro-summary-group macro-summary-group-macros">
        ${macroItems.map(buildStatHtml).join("")}
      </div>
      
    `;
    const kcalGoal = Number(nutritionGoals.kcal) || 0;
    const delta = roundMacro(kcalGoal - totals.kcal);
    $macroKcalSummary.textContent = `${roundMacro(totals.kcal)} kcal consumidas · ${delta >= 0 ? `${delta} restantes` : `${Math.abs(delta)} exceso`}`;

    $macroMeals.innerHTML = mealOrder.map((meal) => {
      const entries = log.meals[meal].entries || [];
      const mt = computeMealTotals(entries);
      const entryHtml = entries.map((entry, idx) => `
      <div class="macro-entry">
      <button class="macro-entry-open" data-macro-open="${meal}:${idx}" type="button" aria-label="Abrir ficha de ${entry.nameSnapshot}">
      <div class="contenido-comida-lista">
      <strong>${entry.nameSnapshot}</strong>
      <div class="hint">${entry.type === "recipe" ? `${roundMacro(entry.servings || 1)} rac` : `${roundMacro(entry.grams || 0)}g`}
      </div>
      </div>
      </button>
      <div class="macro-entry-right">
      <div class="kcals-dato">
      ${roundMacro(entry.macrosSnapshot.kcal)} kcal
      </div>
      <button class="icon-btn-eliminar-comida" data-macro-delete="${meal}:${idx}" type="button">✕</button></div></div>`).join("") || '<div class="hint">Sin entradas</div>';
      return `<article class="macro-meal-card">
      <div class="macro-meal-head">
      <h4>${mealLabels[meal]}</h4>
      <div class="hint">${roundMacro(mt.kcal)} kcal · C ${roundMacro(mt.carbs)} · P ${roundMacro(mt.protein)} · G ${roundMacro(mt.fat)}</div></div><div class="macro-meal-entries">${entryHtml}</div><button class="btn ghost btn-compact" data-macro-add="${meal}" type="button">+ Añadir alimento</button></article>`;
    }).join("");
    if ($recipesPanelStatistics?.classList.contains("is-active")) renderStatisticsView();
  }

  function openMacroAddModal(meal) {
    macroModalState.meal = meal;
    macroModalState.query = "";
    macroModalState.source = "products";
    if ($macroAddSearch) $macroAddSearch.value = "";
    $macroAddModalBackdrop?.classList.remove("hidden");
    renderMacroModalResults();
    $macroAddSearch?.focus();
  }

  function closeMacroAddModal() {
    try { stopMacroBarcodeScan(); } catch (_) {}
    $macroAddModalBackdrop?.classList.add("hidden");
  }

  let _macroProductMeal = "breakfast";
  let _macroProductDraft = null;
  let _macroProductEntryTarget = null; // { meal, idx } cuando se edita una entrada consumida
  let _macroProductRecipeIngredientTarget = null; // { recipeId, ingredientId }

  function setMacroProductEditing(editing) {
    $macroProductModalBackdrop?.classList.toggle("is-editing", !!editing);
    if ($macroProductEditToggle) $macroProductEditToggle.textContent = editing ? "Listo" : "Editar";
  }

  function setMacroProductEntryTarget(target) {
    _macroProductEntryTarget = target || null;
    if ($macroProductAdd) $macroProductAdd.textContent = _macroProductEntryTarget ? "Guardar" : "Añadir";
    if ($macroProductModalTitle) $macroProductModalTitle.textContent = _macroProductEntryTarget ? "Producto (consumo)" : "Producto";
  }

  function closeMacroProductModal() {
    $macroProductModalBackdrop?.classList.add("hidden");
    _macroProductDraft = null;
    _macroProductRecipeIngredientTarget = null;
    setMacroProductEntryTarget(null);
    setMacroProductEditing(false);
  }

  function readMacroProductDraftFromForm() {
    const base = Math.max(1, Number($macroProductBase?.value) || 100);
    return {
      id: _macroProductDraft?.id,
      source: _macroProductDraft?.source || "manual",
      createdAt: _macroProductDraft?.createdAt,
      name: $macroProductName?.value,
      brand: $macroProductBrand?.value,
      barcode: $macroProductBarcode?.value,
      financeProductId: $macroProductFinanceSelect?.value || _macroProductDraft?.financeProductId || "",
      linkedHabitId: $macroProductHabitSelect?.value || _macroProductDraft?.linkedHabitId || "",
      servingBaseGrams: base,
      macros: {
        carbs: Number($macroProductCarbs?.value) || 0,
        protein: Number($macroProductProtein?.value) || 0,
        fat: Number($macroProductFat?.value) || 0,
        kcal: Number($macroProductKcal?.value) || 0,
      },
    };
  }

  function renderMacroProductSummary() {
    if (!$macroProductSummary) return;
    const grams = Math.max(0, Number($macroProductGrams?.value) || 0);
    const draft = readMacroProductDraftFromForm();
    const m = calcProductMacros(draft, grams);

    if (grams) {
      $macroProductSummary.textContent = `Para ${roundMacro(grams)}g: ${roundMacro(m.kcal)} kcal · C ${roundMacro(m.carbs)} · P ${roundMacro(m.protein)} · G ${roundMacro(m.fat)}`;
    } else {
      $macroProductSummary.textContent = "Indica una cantidad para ver el resumen.";
    }

    if ($macroProductKpiCarbs) $macroProductKpiCarbs.textContent = `${roundMacro(m.carbs)}g`;
    if ($macroProductKpiProtein) $macroProductKpiProtein.textContent = `${roundMacro(m.protein)}g`;
    if ($macroProductKpiFat) $macroProductKpiFat.textContent = `${roundMacro(m.fat)}g`;
    if ($macroProductKpiKcal) $macroProductKpiKcal.textContent = `${roundMacro(m.kcal)}`;
    if ($macroProductDonutKcal) $macroProductDonutKcal.textContent = `${roundMacro(m.kcal)}`;

    const radius = 38;
    const c = 2 * Math.PI * radius;
    const carbs = Math.max(0, Number(m.carbs) || 0);
    const protein = Math.max(0, Number(m.protein) || 0);
    const fat = Math.max(0, Number(m.fat) || 0);
    const total = carbs + protein + fat;

    const segCarbs = total > 0 ? (carbs / total) * c : 0;
    const segProtein = total > 0 ? (protein / total) * c : 0;
    const segFat = total > 0 ? (fat / total) * c : 0;

    let offset = 0;
    const applySeg = (el, len) => {
      if (!el) return;
      const cleanLen = Math.max(0, Math.min(c, Number(len) || 0));
      el.style.strokeDasharray = `${cleanLen} ${Math.max(0, c - cleanLen)}`;
      el.style.strokeDashoffset = `${-offset}`;
      offset += cleanLen;
    };

    offset = 0;
    applySeg($macroProductDonutCarbs, segCarbs);
    applySeg($macroProductDonutProtein, segProtein);
    applySeg($macroProductDonutFat, segFat);
  }

  async function openMacroProductModal(product, meal, grams = 100, entryTarget = null, options = {}) {
    if (!$macroProductModalBackdrop) return;
    if (!product) return;

    _macroProductMeal = meal || "breakfast";
    _macroProductDraft = product;
    _macroProductRecipeIngredientTarget = options?.ingredientTarget || null;
    setMacroProductEntryTarget(entryTarget);
    setMacroProductEditing(false);

    await loadFinanceProductsCatalog();
    const habits = listHabitsForProductLink();
    if ($macroProductFinanceSelect) {
      const opts = ['<option value="">Sin vincular</option>']
        .concat(financeProducts.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}${row.lastPrice ? ` · ${roundMacro(row.lastPrice)}€` : ""}</option>`));
      $macroProductFinanceSelect.innerHTML = opts.join("");
      $macroProductFinanceSelect.value = String(product.financeProductId || "");
    }
    if ($macroProductFinanceHint) {
      const linkedFin = financeProducts.find((f) => f.id === String(product.financeProductId || ""));
      $macroProductFinanceHint.textContent = linkedFin ? `Vinculado a ${linkedFin.name}${linkedFin.lastPrice ? ` · último ${roundMacro(linkedFin.lastPrice)}€` : ""}` : "Sin producto de Finanzas";
    }

    if ($macroProductHabitSelect) {
      const opts = ['<option value="">Sin vincular</option>']
        .concat(habits.map((h) => `<option value="${escapeHtml(h.id)}">${escapeHtml(`${h.emoji || "🏷️"} ${h.name || h.id}`)}</option>`));
      $macroProductHabitSelect.innerHTML = opts.join("");
      $macroProductHabitSelect.value = String(product.linkedHabitId || "");
    }
    if ($macroProductHabitHint) {
      const linkedHabit = habits.find((h) => h.id === String(product.linkedHabitId || ""));
      $macroProductHabitHint.textContent = linkedHabit ? `Vinculado a ${linkedHabit.emoji || "🏷️"} ${linkedHabit.name}` : "Sin hábito vinculado";
    }

    if ($macroProductName) $macroProductName.value = product.name || "";
    if ($macroProductBrand) $macroProductBrand.value = product.brand || "";
    if ($macroProductBarcode) $macroProductBarcode.value = product.barcode || "";
    if ($macroProductBase) $macroProductBase.value = String(Number(product.servingBaseGrams) || 100);
    if ($macroProductCarbs) $macroProductCarbs.value = String(Number(product.macros?.carbs) || 0);
    if ($macroProductProtein) $macroProductProtein.value = String(Number(product.macros?.protein) || 0);
    if ($macroProductFat) $macroProductFat.value = String(Number(product.macros?.fat) || 0);
    if ($macroProductKcal) $macroProductKcal.value = String(Number(product.macros?.kcal) || 0);
    if ($macroProductGrams) $macroProductGrams.value = String(Number(grams) || 0);

    $macroProductModalBackdrop.classList.remove("hidden");
    renderMacroProductSummary();
    try { $macroProductGrams?.focus(); } catch (_) {}
  }

  function openMacroEntryEditor(meal, idx) {
    const log = getDailyLog(selectedMacroDate);
    const i = Number(idx);
    const entry = log?.meals?.[meal]?.entries?.[i];
    if (!entry) return;

    if (entry.type === "product") {
      const found = nutritionProducts.find((p) => p.id === entry.refId);
      const grams = Math.max(0, Number(entry.grams) || 0);
      const snapshotPer100 = (grams > 0 && entry.macrosSnapshot)
        ? {
          carbs: (Number(entry.macrosSnapshot.carbs) || 0) / grams * 100,
          protein: (Number(entry.macrosSnapshot.protein) || 0) / grams * 100,
          fat: (Number(entry.macrosSnapshot.fat) || 0) / grams * 100,
          kcal: (Number(entry.macrosSnapshot.kcal) || 0) / grams * 100,
        }
        : { carbs: 0, protein: 0, fat: 0, kcal: 0 };
      const fallback = {
        id: entry.refId,
        name: entry.nameSnapshot,
        brand: "",
        barcode: "",
        servingBaseGrams: 100,
        macros: snapshotPer100,
        source: "snapshot",
      };
      openMacroProductModal(found || fallback, meal, grams || 100, { meal, idx: i });
      return;
    }

    if (entry.type === "recipe") {
      const current = Math.max(0.01, Number(entry.servings) || 1);
      const raw = window.prompt(`Raciones para "${entry.nameSnapshot}"`, String(current));
      if (raw == null) return;
      const next = Number(String(raw).trim().replace(",", "."));
      if (!Number.isFinite(next) || next <= 0) return;

      const recipe = recipes.find((r) => r.id === entry.refId);
      if (recipe) {
        const base = normalizeMacros(recipe.nutritionPerServing || recipe.nutritionTotals || {});
        entry.servings = next;
        entry.macrosSnapshot = normalizeMacros({
          carbs: (Number(base.carbs) || 0) * next,
          protein: (Number(base.protein) || 0) * next,
          fat: (Number(base.fat) || 0) * next,
          kcal: (Number(base.kcal) || 0) * next,
        });
      } else {
        const factor = current > 0 ? (next / current) : 1;
        entry.servings = next;
        entry.macrosSnapshot = normalizeMacros({
          carbs: (Number(entry.macrosSnapshot?.carbs) || 0) * factor,
          protein: (Number(entry.macrosSnapshot?.protein) || 0) * factor,
          fat: (Number(entry.macrosSnapshot?.fat) || 0) * factor,
          kcal: (Number(entry.macrosSnapshot?.kcal) || 0) * factor,
        });
      }

      persistNutrition();
      renderMacrosView();
    }
  }

  function renderMacroModalResults() {
    if (!$macroAddResults) return;
    const q = (macroModalState.query || "").toLowerCase();
    const showProducts = macroModalState.source === "products";
    const showRecipes = macroModalState.source === "recipes";
    const showScan = macroModalState.source === "scan";
    $macroScanPanel?.classList.toggle("hidden", macroModalState.source !== "scan");
    $macroManualPanel?.classList.toggle("hidden", macroModalState.source !== "manual");
    $macroAddResults.style.display = (showProducts || showRecipes) ? "block" : "none";
    if (!showScan) {
      try { stopMacroBarcodeScan(); } catch (_) {}
    } else {
      hideMacroScanAddProduct();
    }
    if (showProducts) {
      const list = nutritionProducts.filter((p) => !q || `${p.name} ${p.brand || ""} ${p.barcode || ""}`.toLowerCase().includes(q));
      $macroAddResults.innerHTML = list.map((p) => `<button class="macro-result" data-add-product="${p.id}" type="button"><span>${p.name}</span><span class="hint">${p.brand || ""} · ${p.macros?.kcal || 0} kcal / ${p.servingBaseGrams || 100}g</span></button>`).join("") || '<div class="hint">No hay productos.</div>';
    }
    if (showRecipes) {
      const list = recipes.filter((r) => !q || `${r.title} ${(r.tags || []).join(" ")}`.toLowerCase().includes(q));
      $macroAddResults.innerHTML = list.map((r) => `<button class="macro-result" data-add-recipe="${r.id}" type="button"><span>${r.title}</span><span class="hint">${roundMacro(r.nutritionTotals?.kcal || 0)} kcal total</span></button>`).join("") || '<div class="hint">No hay recetas.</div>';
    }
    $macroAddChips?.querySelectorAll(".macro-chip").forEach((chip) => chip.classList.toggle("is-active", chip.dataset.macroSource === macroModalState.source));
  }

  function addProductToMeal(meal, product, grams = 100) {
    if (!product) return;
    const macrosSnapshot = normalizeMacros(calcProductMacros(product, grams));
    const entry = {
      type: "product",
      refId: product.id,
      nameSnapshot: product.name,
      grams,
      macrosSnapshot,
      habitSync: {
        habitId: String(product.linkedHabitId || "").trim(),
        amount: String(product.linkedHabitId || "").trim() ? 1 : 0,
      },
      createdAt: Date.now(),
    };
    getDailyLog(selectedMacroDate).meals[meal].entries.unshift(entry);
    persistNutrition();
    renderMacrosView();
    applyEntryHabitImpact(entry, selectedMacroDate, 1);
  }

  function addRecipeToMeal(meal, recipe, servings = 1) {
    if (!recipe) return;
    const base = normalizeMacros(recipe.nutritionPerServing || recipe.nutritionTotals || {});
    const macrosSnapshot = {
      carbs: base.carbs * servings,
      protein: base.protein * servings,
      fat: base.fat * servings,
      kcal: base.kcal * servings,
    };
    getDailyLog(selectedMacroDate).meals[meal].entries.unshift({
      type: "recipe",
      refId: recipe.id,
      nameSnapshot: recipe.title,
      servings,
      macrosSnapshot,
      createdAt: Date.now(),
    });
    persistNutrition();
    renderMacrosView();
  }

  function saveProduct(product) {
    const now = Date.now();
    const normalized = {
      id: product.id || generateId(),
      name: String(product.name || "").trim(),
      brand: String(product.brand || "").trim(),
      barcode: String(product.barcode || "").trim(),
      servingBaseGrams: Math.max(1, Number(product.servingBaseGrams) || 100),
      macros: normalizeMacros(product.macros),
      financeProductId: String(product.financeProductId || "").trim(),
      linkedHabitId: String(product.linkedHabitId || "").trim(),
      source: product.source || "manual",
      createdAt: product.createdAt || now,
      updatedAt: now,
    };
    if (!normalized.name) return null;
    const i = nutritionProducts.findIndex((p) => p.id === normalized.id || (normalized.barcode && p.barcode === normalized.barcode));
    if (i >= 0) nutritionProducts[i] = { ...nutritionProducts[i], ...normalized };
    else nutritionProducts.unshift(normalized);
    persistNutrition();
    recalcAllRecipesNutrition();
    refreshUI();
    return normalized;
  }

  async function lookupProductByBarcode(barcode) {
    const clean = String(barcode || "").trim();
    if (!clean) return null;
    const local = nutritionProducts.find((p) => p.barcode && p.barcode === clean);
    if (local) return local;
    return null;
  }

  function listHabitsForProductLink() {
    try {
      return Array.isArray(window.__bookshellHabits?.listActiveHabits?.())
        ? window.__bookshellHabits.listActiveHabits()
        : [];
    } catch (_) {
      return [];
    }
  }

  async function adjustHabitCountForDate(habitId, dateKey, delta = 0) {
    const safeHabitId = String(habitId || "").trim();
    const safeDate = String(dateKey || "").trim();
    const safeDelta = Number(delta) || 0;
    if (!safeHabitId || !safeDate || !safeDelta) return;
    habitSyncQueue = habitSyncQueue.then(async () => {
      try {
        await window.__bookshellHabits?.adjustHabitCountForDate?.(safeHabitId, safeDate, safeDelta);
      } catch (_) {}
    });
    return habitSyncQueue;
  }

  async function applyEntryHabitImpact(entry, dateKey, direction = 1) {
    const habitId = String(entry?.habitSync?.habitId || "").trim();
    if (!habitId) return;
    const amount = Math.max(0, Number(entry?.habitSync?.amount) || 0);
    const delta = Math.round(amount * direction);
    if (!delta) return;
    await adjustHabitCountForDate(habitId, dateKey, delta);
  }

  async function loadFinanceProductsCatalog(force = false) {
    if (!currentUid || (financeProductsLoaded && !force)) return financeProducts;
    financeProductsLoaded = true;
    let chosen = [];
    try {
      const [primary, legacy] = resolveFinancePathCandidates(currentUid);
      const candidates = [primary, legacy].filter(Boolean);
      for (const root of candidates) {
        try {
          const snap = await get(ref(db, `${root}/foodItems`));
          const val = snap?.val();
          if (val && typeof val === "object" && Object.keys(val).length) {
            chosen = Object.entries(val).map(([id, row]) => {
              const priceHistory = row?.priceHistory && typeof row.priceHistory === "object" ? row.priceHistory : {};
              const latest = Object.values(priceHistory).flatMap((vendorRows) => Object.values(vendorRows || {})).reduce((best, it) => {
                const ts = Number(it?.ts) || 0;
                if (!best || ts > best.ts) return { ts, price: Number(it?.unitPrice || it?.price || 0), vendor: String(it?.vendor || "").trim() };
                return best;
              }, null);
              return {
                id,
                name: String(row?.displayName || row?.name || id || "").trim(),
                lastPrice: latest?.price || Number(row?.defaultPrice || 0) || 0,
                lastPriceTs: latest?.ts || 0,
                lastVendor: latest?.vendor || "",
              };
            }).filter((it) => it.name);
            break;
          }
        } catch (_) {}
      }
    } catch (_) {}
    financeProducts = chosen;
    return financeProducts;
  }

  function computeRecipeEstimatedCost(recipe) {
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    let covered = 0;
    let total = 0;
    ingredients.forEach((ing) => {
      const linked = nutritionProducts.find((p) => p.id === ing.productId);
      if (!linked?.financeProductId) return;
      const fin = financeProducts.find((f) => f.id === linked.financeProductId);
      const price = Number(fin?.lastPrice) || 0;
      if (!price) return;
      covered += 1;
      total += price;
    });
    return { total, covered, totalIngredients: ingredients.length };
  }

  let _macroScanStream = null;
  let _macroScanRunning = false;
  let _macroScanDetector = null;
  let _macroScanLastValue = "";
  let _macroScanLastAt = 0;
  let _macroScanTimer = null;
  let _macroScanPendingProduct = null;
  let _macroScanSupportsAutoDetection = false;

  function logMacroScan(event, meta) {
    try {
      if (meta !== undefined) {
        console.info(`[MacroScan] ${event}`, meta);
      } else {
        console.info(`[MacroScan] ${event}`);
      }
    } catch (_) {}
  }

  function getBarcodeDetectorCtor() {
    return globalThis?.BarcodeDetector || null;
  }

  async function buildMacroScanDetector() {
    const Detector = getBarcodeDetectorCtor();
    if (!Detector) return null;

    if (Detector?.getSupportedFormats) {
      try {
        const formats = await Detector.getSupportedFormats();
        if (Array.isArray(formats) && formats.length) {
          return new Detector({ formats });
        }
      } catch (err) {
        logMacroScan("getSupportedFormats falló", err?.name || err?.message || err);
      }
    }

    return new Detector();
  }

  function setMacroScanStatus(msg) {
    if ($macroScanStatus) $macroScanStatus.textContent = msg || "";
  }

  function hideMacroScanAddProduct() {
    if (!$macroScanAddProduct) return;
    $macroScanAddProduct.classList.add("hidden");
    delete $macroScanAddProduct.dataset.barcode;
    delete $macroScanAddProduct.dataset.mode;
    _macroScanPendingProduct = null;
  }

  function showMacroScanAddProduct({ barcode, mode, label }) {
    if (!$macroScanAddProduct) return;
    $macroScanAddProduct.dataset.barcode = String(barcode || "").trim();
    $macroScanAddProduct.dataset.mode = mode || "manual";
    if (label) $macroScanAddProduct.textContent = label;
    $macroScanAddProduct.classList.remove("hidden");
  }

  function offToNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async function lookupOpenFoodFactsByBarcode(barcode) {
    const clean = String(barcode || "").trim();
    if (!clean) return null;

    const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(clean)}.json?lc=es&fields=code,product_name,product_name_es,brands,nutriments,status`;

    try {
      const res = await fetch(url, { method: "GET" });
      if (!res.ok) return null;
      const data = await res.json();
      if (data?.status !== 1) return null;
      const product = data?.product;
      if (!product) return null;

      const name = String(product.product_name_es || product.product_name || "").trim();
      if (!name) return null;

      const brand = String(product.brands || "").split(",")[0]?.trim() || "";
      const n = product.nutriments || {};
      const carbs = offToNumber(n.carbohydrates_100g ?? n.carbohydrates);
      const protein = offToNumber(n.proteins_100g ?? n.proteins);
      const fat = offToNumber(n.fat_100g ?? n.fat);
      const kcalRaw = n["energy-kcal_100g"] ?? n["energy-kcal"] ?? null;
      const kjRaw = n["energy-kj_100g"] ?? n["energy-kj"] ?? n.energy_100g ?? n.energy ?? null;
      const kcal = kcalRaw != null ? offToNumber(kcalRaw) : (kjRaw != null ? offToNumber(kjRaw) / 4.184 : 0);

      return {
        name,
        brand,
        barcode: clean,
        servingBaseGrams: 100,
        macros: { carbs, protein, fat, kcal },
        source: "openfoodfacts",
      };
    } catch (_) {
      return null;
    }
  }

  async function stopMacroBarcodeScan() {
    _macroScanRunning = false;
    _macroScanSupportsAutoDetection = false;
    hideMacroScanAddProduct();

    if (_macroScanTimer) {
      try { clearTimeout(_macroScanTimer); } catch (_) {}
      _macroScanTimer = null;
    }

    if (_macroScanStream) {
      try { _macroScanStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _macroScanStream = null;
    }

    if ($macroScanVideo) {
      try { $macroScanVideo.pause(); } catch (_) {}
      try { $macroScanVideo.srcObject = null; } catch (_) {}
      try { $macroScanVideo.removeAttribute("src"); } catch (_) {}
    }
  }

  async function handleBarcodeFound(barcode) {
    const clean = String(barcode || "").trim();
    if (!clean) return;

    const found = await lookupProductByBarcode(clean);
    if (found) {
      closeMacroAddModal();
      openMacroProductModal(found, macroModalState.meal, 100);
      setMacroScanStatus("Producto encontrado. Ajusta cantidad y añade.");
      return;
    }

    setMacroScanStatus("Buscando en OpenFoodFacts…");
    const off = await lookupOpenFoodFactsByBarcode(clean);
    if (off) {
      _macroScanPendingProduct = off;
      setMacroScanStatus(`Encontrado: ${off.name}${off.brand ? ` · ${off.brand}` : ""}. Pulsa “Abrir ficha”.`);
      showMacroScanAddProduct({ barcode: clean, mode: "off", label: "Abrir ficha" });
      if ($macroManualBarcode) $macroManualBarcode.value = clean;
      if ($macroManualName) $macroManualName.value = off.name;
      if ($macroManualBrand) $macroManualBrand.value = off.brand || "";
      if ($macroManualCarbs) $macroManualCarbs.value = String(off.macros?.carbs ?? 0);
      if ($macroManualProtein) $macroManualProtein.value = String(off.macros?.protein ?? 0);
      if ($macroManualFat) $macroManualFat.value = String(off.macros?.fat ?? 0);
      if ($macroManualKcal) $macroManualKcal.value = String(off.macros?.kcal ?? 0);
      if ($macroManualBase) $macroManualBase.value = "100";
      return;
    }

    setMacroScanStatus("No encontrado. Pulsa “Crear producto manual”.");
    showMacroScanAddProduct({ barcode: clean, mode: "manual", label: "Crear producto manual" });
    if ($macroManualBarcode) $macroManualBarcode.value = clean;
  }

  async function startMacroBarcodeScan() {
    hideMacroScanAddProduct();
    logMacroScan("Inicio de escaneo solicitado", {
      secure: window.isSecureContext,
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      hasBarcodeDetector: Boolean(getBarcodeDetectorCtor()),
      standalone: window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone || false,
    });

    if (!$macroScanVideo) {
      setMacroScanStatus("No hay vista de cámara disponible.");
      return;
    }

    if (!window.isSecureContext) {
      setMacroScanStatus("La cámara requiere HTTPS o localhost.");
      return;
    }

    if (false && !("BarcodeDetector" in window)) {
      setMacroScanStatus("BarcodeDetector no disponible en este navegador. Usa entrada manual o “Crear manual”.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setMacroScanStatus("getUserMedia no disponible. Usa entrada manual.");
      return;
    }

    await stopMacroBarcodeScan();

    _macroScanDetector = null;
    try {
      _macroScanDetector = await buildMacroScanDetector();
    } catch (err) {
      logMacroScan("No se pudo inicializar BarcodeDetector", err?.name || err?.message || err);
      _macroScanDetector = null;
    }
    _macroScanSupportsAutoDetection = Boolean(_macroScanDetector);
    logMacroScan("Detector preparado", { autoDetection: _macroScanSupportsAutoDetection });

    try {
      _macroScanStream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false,
      });
      logMacroScan("Cámara abierta", {
        tracks: _macroScanStream?.getVideoTracks?.().map((track) => ({
          label: track.label,
          readyState: track.readyState,
          muted: track.muted,
        })) || [],
      });
      $macroScanVideo.srcObject = _macroScanStream;
      await $macroScanVideo.play();
      logMacroScan("Vídeo reproduciendo", {
        readyState: $macroScanVideo.readyState,
        width: $macroScanVideo.videoWidth,
        height: $macroScanVideo.videoHeight,
      });
      if (!_macroScanSupportsAutoDetection) {
        _macroScanRunning = false;
        setMacroScanStatus("Cámara abierta, pero este navegador no soporta detección automática. Escribe el código y pulsa Buscar.");
        logMacroScan("Fallback manual por falta real de detector");
        return;
      }
    } catch (err) {
      logMacroScan("Error al abrir cámara", err?.name || err?.message || err);
      setMacroScanStatus(`No pude abrir la cámara: ${err?.name || err?.message || "error"}`);
      await stopMacroBarcodeScan();
      return;
    }

    setMacroScanStatus("Escaneando… apunta al código de barras.");
    _macroScanRunning = true;
    _macroScanLastValue = "";
    _macroScanLastAt = 0;

    const tick = async () => {
      if (!_macroScanRunning) return;
      if (!_macroScanDetector) {
        _macroScanSupportsAutoDetection = false;
        setMacroScanStatus("No pude iniciar la detección automática. Usa entrada manual.");
        logMacroScan("Detector no disponible durante tick");
        return;
      }
      if ($macroScanVideo.readyState < 2) {
        _macroScanTimer = setTimeout(tick, 220);
        return;
      }
      try {
        const codes = await _macroScanDetector.detect($macroScanVideo);
        const first = codes && codes[0] ? String(codes[0].rawValue || "") : "";
        const now = Date.now();
        const clean = first.trim();
        if (clean) {
          const isSame = clean === _macroScanLastValue && (now - _macroScanLastAt) < 2000;
          if (!isSame) {
            _macroScanLastValue = clean;
            _macroScanLastAt = now;
            setMacroScanStatus(`Detectado: ${clean}`);
            logMacroScan("Código detectado", clean);
            await stopMacroBarcodeScan();
            await handleBarcodeFound(clean);
            return;
          }
        }
      } catch (err) {
        logMacroScan("Fallo en detect()", err?.name || err?.message || err);
      }

      _macroScanTimer = setTimeout(tick, 220);
    };

    _macroScanTimer = setTimeout(tick, 220);
  }

  function upsertBarcodeMapping(barcode, productId) {
    const root = nutritionRootPath();
    if (!root || !barcode || !productId) return;
    try { set(ref(db, `${root}/barcodeMap/${barcode}`), productId); } catch (_) {}
  }

  function buildNutriIngredientRow(item = { id: generateId(), productId: "", grams: 100 }) {
    const row = document.createElement("div");
    row.className = "builder-row ingredient-row";
    row.dataset.id = item.id || generateId();
    const select = document.createElement("select");
    select.className = "builder-input";
    select.innerHTML = `<option value="">Selecciona producto</option>` + nutritionProducts.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
    select.value = item.productId || "";
    const grams = document.createElement("input");
    grams.type = "number";
    grams.className = "builder-input";
    grams.min = "0";
    grams.step = "1";
    grams.value = String(item.grams || 100);
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "icon-btn icon-btn-small";
    remove.textContent = "✕";
    remove.addEventListener("click", () => row.remove());
    row.appendChild(select);
    row.appendChild(grams);
    row.appendChild(remove);
    return row;
  }

  function renderNutriIngredientRows(list = []) {
    if (!$recipeNutriIngredientsList) return;
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildNutriIngredientRow(item)));
    $recipeNutriIngredientsList.innerHTML = "";
    $recipeNutriIngredientsList.appendChild(frag);
  }

  function collectNutriIngredientRows() {
    if (!$recipeNutriIngredientsList) return [];
    return Array.from($recipeNutriIngredientsList.querySelectorAll(".ingredient-row")).map((row) => ({
      id: row.dataset.id || generateId(),
      productId: row.querySelector("select")?.value || "",
      grams: Math.max(0, Number(row.querySelector("input[type='number']")?.value) || 0),
    })).filter((it) => it.productId);
  }

  $recipesSubtabs.forEach((btn) => btn.addEventListener("click", () => switchRecipesPanel(btn.dataset.recipesPanel || "library")));
  $macroDateInput?.addEventListener("change", (e) => { selectedMacroDate = e.target.value || toISODate(new Date()); macroStatsState.anchorDate = selectedMacroDate; renderMacrosView(); });
  $macroStatsPeriods?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-stats-period]");
    if (!btn) return;
    macroStatsState.period = btn.dataset.statsPeriod || "week";
    renderStatisticsView();
  });
  $macroStatsAnchor?.addEventListener("change", (e) => {
    macroStatsState.anchorDate = e.target.value || toISODate(new Date());
    renderStatisticsView();
  });
  $macroStatsMainMetric?.addEventListener("change", (e) => {
    macroStatsState.metric = e.target.value || "macros";
    renderStatisticsView();
  });
  $macroStatsPrev?.addEventListener("click", () => {
    const d = new Date(`${macroStatsState.anchorDate}T00:00:00`);
    if (macroStatsState.period === "day") d.setDate(d.getDate() - 1);
    else if (macroStatsState.period === "week") d.setDate(d.getDate() - 7);
    else if (macroStatsState.period === "month") d.setMonth(d.getMonth() - 1);
    else d.setFullYear(d.getFullYear() - 1);
    macroStatsState.anchorDate = toISODate(d);
    renderStatisticsView();
  });
  $macroStatsNext?.addEventListener("click", () => {
    const d = new Date(`${macroStatsState.anchorDate}T00:00:00`);
    if (macroStatsState.period === "day") d.setDate(d.getDate() + 1);
    else if (macroStatsState.period === "week") d.setDate(d.getDate() + 7);
    else if (macroStatsState.period === "month") d.setMonth(d.getMonth() + 1);
    else d.setFullYear(d.getFullYear() + 1);
    macroStatsState.anchorDate = toISODate(d);
    renderStatisticsView();
  });
  $macroDatePrev?.addEventListener("click", () => { const d = new Date(`${selectedMacroDate}T00:00:00`); d.setDate(d.getDate() - 1); selectedMacroDate = toISODate(d); macroStatsState.anchorDate = selectedMacroDate; renderMacrosView(); });
  $macroDateNext?.addEventListener("click", () => { const d = new Date(`${selectedMacroDate}T00:00:00`); d.setDate(d.getDate() + 1); selectedMacroDate = toISODate(d); macroStatsState.anchorDate = selectedMacroDate; renderMacrosView(); });
  $macroSummaryGrid?.addEventListener("focusin", (e) => {
    const input = e.target?.closest?.("input[data-macro-goal]");
    if (!input) return;
    if (input.dataset.cleared === "1") return;
    input.dataset.cleared = "1";
    try {
      input.value = "";
      input.select?.();
    } catch (_) {}
  });
  $macroSummaryGrid?.addEventListener("focusout", (e) => {
    const input = e.target?.closest?.("input[data-macro-goal]");
    if (!input) return;
    input.dataset.cleared = "0";
  });
  $macroSummaryGrid?.addEventListener("keydown", (e) => {
    const input = e.target?.closest?.("input[data-macro-goal]");
    if (!input) return;
    if (e.key === "Enter") {
      try { e.preventDefault(); } catch (_) {}
      input.blur();
    }
  });
  $macroSummaryGrid?.addEventListener("change", (e) => {
    const input = e.target?.closest?.("input[data-macro-goal]");
    if (!input) return;
    const key = input.dataset.macroGoal;
    if (!key) return;
    const raw = String(input.value || "").trim();
    if (!raw) {
      renderMacrosView();
      return;
    }
    const nextNum = Number(raw);
    if (!Number.isFinite(nextNum)) {
      renderMacrosView();
      return;
    }
    nutritionGoals[key] = Math.max(0, nextNum);
    persistNutrition();
    renderMacrosView();
  });
  $macroMeals?.addEventListener("click", (e) => {
    const addBtn = e.target.closest("[data-macro-add]");
    if (addBtn) return openMacroAddModal(addBtn.dataset.macroAdd);
    const delBtn = e.target.closest("[data-macro-delete]");
    if (delBtn) {
      const [meal, idx] = String(delBtn.dataset.macroDelete || "").split(":");
      const log = getDailyLog(selectedMacroDate);
      const i = Number(idx);
      if (log.meals?.[meal]?.entries?.[i]) {
        const removed = log.meals[meal].entries.splice(i, 1)[0];
        persistNutrition();
        renderMacrosView();
        applyEntryHabitImpact(removed, selectedMacroDate, -1);
      }
      return;
    }

    const openBtn = e.target.closest("[data-macro-open]");
    if (openBtn) {
      const [meal, idx] = String(openBtn.dataset.macroOpen || "").split(":");
      openMacroEntryEditor(meal, idx);
    }
  });

  $macroAddModalClose?.addEventListener("click", closeMacroAddModal);
  $macroAddModalBackdrop?.addEventListener("click", (e) => { if (e.target === $macroAddModalBackdrop) closeMacroAddModal(); });
  $macroAddSearch?.addEventListener("input", (e) => { macroModalState.query = e.target.value || ""; renderMacroModalResults(); });
  $macroAddChips?.addEventListener("click", (e) => {
    const chip = e.target.closest("[data-macro-source]");
    if (!chip) return;
    macroModalState.source = chip.dataset.macroSource;
    renderMacroModalResults();
    if (macroModalState.source === "scan") {
      startMacroBarcodeScan();
    }
  });
  $macroAddResults?.addEventListener("click", (e) => {
    const pBtn = e.target.closest("[data-add-product]");
    if (pBtn) {
      const p = nutritionProducts.find((x) => x.id === pBtn.dataset.addProduct);
      closeMacroAddModal();
      openMacroProductModal(p, macroModalState.meal, 100);
      return;
    }
    const rBtn = e.target.closest("[data-add-recipe]");
    if (rBtn) {
      const r = recipes.find((x) => x.id === rBtn.dataset.addRecipe);
      addRecipeToMeal(macroModalState.meal, r, 1);
      return closeMacroAddModal();
    }
  });

  $macroManualSave?.addEventListener("click", () => {
    const pdt = saveProduct({
      name: $macroManualName?.value,
      brand: $macroManualBrand?.value,
      barcode: $macroManualBarcode?.value,
      servingBaseGrams: Number($macroManualBase?.value) || 100,
      macros: { carbs: Number($macroManualCarbs?.value) || 0, protein: Number($macroManualProtein?.value) || 0, fat: Number($macroManualFat?.value) || 0, kcal: Number($macroManualKcal?.value) || 0 },
      source: "manual",
    });
    if (pdt) {
      upsertBarcodeMapping(pdt.barcode, pdt.id);
      closeMacroAddModal();
      openMacroProductModal(pdt, macroModalState.meal, 100);
    }
  });

  const _macroProductInputs = [
    $macroProductName,
    $macroProductBrand,
    $macroProductBarcode,
    $macroProductBase,
    $macroProductCarbs,
    $macroProductProtein,
    $macroProductFat,
    $macroProductKcal,
    $macroProductGrams,
  ].filter(Boolean);
  _macroProductInputs.forEach((el) => el.addEventListener("input", renderMacroProductSummary));
  $macroProductEditToggle?.addEventListener("click", () => {
    const next = !$macroProductModalBackdrop?.classList.contains("is-editing");
    setMacroProductEditing(next);
    if (next) {
      try { ($macroProductBarcode || $macroProductBase || $macroProductCarbs)?.focus(); } catch (_) {}
    }
  });
  $macroProductGrams?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      try { e.preventDefault(); } catch (_) {}
      $macroProductAdd?.click();
    }
  });
  $macroProductScanBtn?.addEventListener("click", async () => {
    const raw = window.prompt("Escanear / pegar código de barras", String($macroProductBarcode?.value || "").trim());
    if (raw == null) return;
    const code = String(raw || "").trim();
    if (!code) return;
    if ($macroProductBarcode) $macroProductBarcode.value = code;
    const local = await lookupProductByBarcode(code);
    const off = local || (await lookupOpenFoodFactsByBarcode(code));
    if (!off) {
      if ($macroProductSummary) $macroProductSummary.textContent = "Código guardado. Sin coincidencias nutricionales automáticas.";
      return;
    }
    if ($macroProductName && !$macroProductName.value.trim()) $macroProductName.value = off.name || "";
    if ($macroProductBrand && !$macroProductBrand.value.trim()) $macroProductBrand.value = off.brand || "";
    if ($macroProductBase) $macroProductBase.value = String(Number(off.servingBaseGrams) || 100);
    if ($macroProductCarbs) $macroProductCarbs.value = String(Number(off.macros?.carbs) || 0);
    if ($macroProductProtein) $macroProductProtein.value = String(Number(off.macros?.protein) || 0);
    if ($macroProductFat) $macroProductFat.value = String(Number(off.macros?.fat) || 0);
    if ($macroProductKcal) $macroProductKcal.value = String(Number(off.macros?.kcal) || 0);
    renderMacroProductSummary();
  });
  $macroProductFinanceSelect?.addEventListener("change", () => {
    const row = financeProducts.find((f) => f.id === String($macroProductFinanceSelect.value || ""));
    if ($macroProductFinanceHint) $macroProductFinanceHint.textContent = row ? `Vinculado a ${row.name}${row.lastPrice ? ` · último ${roundMacro(row.lastPrice)}€` : ""}` : "Sin producto de Finanzas";
  });
  $macroProductFinanceUnlink?.addEventListener("click", () => {
    if ($macroProductFinanceSelect) $macroProductFinanceSelect.value = "";
    if ($macroProductFinanceHint) $macroProductFinanceHint.textContent = "Sin producto de Finanzas";
  });
  $macroProductHabitSelect?.addEventListener("change", () => {
    const habits = listHabitsForProductLink();
    const row = habits.find((h) => h.id === String($macroProductHabitSelect.value || ""));
    if ($macroProductHabitHint) $macroProductHabitHint.textContent = row ? `Vinculado a ${row.emoji || "🏷️"} ${row.name}` : "Sin hábito vinculado";
  });
  $macroProductHabitUnlink?.addEventListener("click", () => {
    if ($macroProductHabitSelect) $macroProductHabitSelect.value = "";
    if ($macroProductHabitHint) $macroProductHabitHint.textContent = "Sin hábito vinculado";
  });
  $macroProductModalClose?.addEventListener("click", closeMacroProductModal);
  $macroProductCancel?.addEventListener("click", closeMacroProductModal);
  $macroProductModalBackdrop?.addEventListener("click", (e) => { if (e.target === $macroProductModalBackdrop) closeMacroProductModal(); });
  $macroProductAdd?.addEventListener("click", () => {
    const grams = Math.max(0, Number($macroProductGrams?.value) || 0);
    if (!grams) {
      if ($macroProductSummary) $macroProductSummary.textContent = "Indica una cantidad mayor que 0g.";
      try { $macroProductGrams?.focus(); } catch (_) {}
      return;
    }

    const draft = readMacroProductDraftFromForm();
    const saved = saveProduct(draft);
    if (!saved) {
      if ($macroProductSummary) $macroProductSummary.textContent = "Pon un nombre para guardar el producto.";
      try { $macroProductName?.focus(); } catch (_) {}
      return;
    }

    if (saved.barcode) upsertBarcodeMapping(saved.barcode, saved.id);
    if (_macroProductRecipeIngredientTarget?.recipeId && _macroProductRecipeIngredientTarget?.ingredientId) {
      const targetRecipe = recipes.find((r) => r.id === _macroProductRecipeIngredientTarget.recipeId);
      if (targetRecipe) {
        const ingredients = (targetRecipe.ingredients || []).map((ing) => {
          if (ing.id !== _macroProductRecipeIngredientTarget.ingredientId) return ing;
          const parsed = splitIngredientText(ing.text || "");
          return {
            ...ing,
            productId: saved.id,
            name: saved.name || parsed.name || ing.name || ing.text,
            quantity: ing.quantity || parsed.quantity || "",
          };
        });
        updateRecipe(targetRecipe.id, { ingredients, updatedAt: Date.now() });
      }
    }
    if (_macroProductEntryTarget) {
      const { meal, idx } = _macroProductEntryTarget;
      const log = getDailyLog(selectedMacroDate);
      const entry = log?.meals?.[meal]?.entries?.[Number(idx)];
      if (entry) {
        const prevHabit = { ...entry.habitSync };
        entry.type = "product";
        entry.refId = saved.id;
        entry.nameSnapshot = saved.name;
        entry.grams = grams;
        entry.macrosSnapshot = normalizeMacros(calcProductMacros(saved, grams));
        entry.habitSync = {
          habitId: String(saved.linkedHabitId || "").trim(),
          amount: String(saved.linkedHabitId || "").trim() ? 1 : 0,
        };
        persistNutrition();
        renderMacrosView();
        applyEntryHabitImpact({ habitSync: prevHabit }, selectedMacroDate, -1).then(() => applyEntryHabitImpact(entry, selectedMacroDate, 1));
      }
    } else {
      addProductToMeal(_macroProductMeal || macroModalState.meal || "breakfast", saved, grams);
    }
    closeMacroProductModal();
  });

  $macroScanStart?.addEventListener("click", async () => {
    await startMacroBarcodeScan();
    return;
    if ("BarcodeDetector" in window) {
      $macroScanStatus.textContent = "Detector disponible. Usa entrada manual para confirmar en esta versión.";
    } else {
      $macroScanStatus.textContent = "BarcodeDetector no disponible. Fallback manual activo (preparado para ZXing).";
    }
  });
  $macroScanManualBtn?.addEventListener("click", async () => {
    hideMacroScanAddProduct();
    const barcodeInput = String($macroScanManual?.value || "").trim();
    if (!barcodeInput) {
      setMacroScanStatus("Introduce un codigo de barras.");
      return;
      setMacroScanStatus("Introduce un cÃƒÂ³digo de barras.");
      return;
    }
    setMacroScanStatus("Buscando...");
    await handleBarcodeFound(barcodeInput);
    return;
    const barcode = $macroScanManual?.value || "";
    const found = await lookupProductByBarcode(barcode);
    if (found) {
      addProductToMeal(macroModalState.meal, found, 100);
      closeMacroAddModal();
      $macroScanStatus.textContent = "Producto local encontrado y añadido.";
    } else {
      $macroScanStatus.textContent = "Sin valores asociados. Completa Crear manual.";
      if ($macroManualBarcode) $macroManualBarcode.value = barcode;
    }
  });

  $macroScanStop?.addEventListener("click", async () => {
    await stopMacroBarcodeScan();
    setMacroScanStatus("Escaneo detenido.");
  });
  $macroScanManual?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      try { e.preventDefault(); } catch (_) {}
      $macroScanManualBtn?.click();
    }
  });
  $macroScanAddProduct?.addEventListener("click", () => {
    const mode = String($macroScanAddProduct?.dataset?.mode || "manual");
    const barcode = String($macroScanAddProduct?.dataset?.barcode || $macroManualBarcode?.value || "").trim();
    if (barcode && $macroManualBarcode) $macroManualBarcode.value = barcode;

    if (mode === "off" && _macroScanPendingProduct) {
      closeMacroAddModal();
      openMacroProductModal(_macroScanPendingProduct, macroModalState.meal, 100);
      return;
      const saved = saveProduct(_macroScanPendingProduct);
      if (saved) {
        addProductToMeal(macroModalState.meal, saved, 100);
        setMacroScanStatus("Producto añadido y guardado.");
        closeMacroAddModal();
      } else {
        setMacroScanStatus("No pude guardar el producto. Revisa “Crear manual”.");
      }
      return;
    }

    macroModalState.source = "manual";
    renderMacroModalResults();
    try { $macroManualName?.focus(); } catch (_) {}
  });

  // Inicial
  loadNutritionCache();
  macroStatsState.anchorDate = selectedMacroDate;
  recalcAllRecipesNutrition();
  refreshUI();
  renderStatisticsView();
  listenRemoteRecipes();
  listenNutritionRemote();
  switchRecipesPanel("library");
}
function parseRecipeV1(raw){
  const lines = String(raw || "").replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => l.trim().toUpperCase() === "RECETA_V1");
  const end = lines.findIndex((l, idx) => idx > start && l.trim().toUpperCase() === "FIN_RECETA");
  if (start === -1 || end === -1 || end <= start) throw new Error("Formato inválido");

  const collapseSpaces = (value = "") => value.replace(/\s+/g, " ").trim();
  const scoped = lines.slice(start + 1, end);
  const normalized = [];
  scoped.forEach((rawLine) => {
    const line = rawLine.trim();
    const prev = normalized[normalized.length - 1];
    if (!line && prev === "") return; // colapsa saltos múltiples
    normalized.push(line);
  });
  while (normalized[0] === "") normalized.shift();
  while (normalized[normalized.length - 1] === "") normalized.pop();

  const headerRegex = /^\s*(TITULO|PAIS|CATEGORIAS|RACIONES|TIEMPO_MIN|DIFICULTAD|CALORIAS_KCAL|PROTEINA_G|CARBOHIDRATOS_G|GRASA_G|INGREDIENTES|PASOS|NOTAS)\s*:\s*(.*)$/i;
  const sections = {};
  let current = null;

  normalized.forEach((line) => {
    const headerMatch = line.match(headerRegex);
    if (headerMatch) {
      current = headerMatch[1].toUpperCase();
      const inlineValue = headerMatch[2].trim();
      sections[current] = sections[current] || [];
      if (inlineValue) sections[current].push(inlineValue);
      return;
    }
    if (current) {
      sections[current].push(line);
    }
  });

  const readScalar = (key) => (sections[key] || []).map(collapseSpaces).find(Boolean) || "";
  const readBlock = (key) => (sections[key] || []).map((l) => l.trim()).filter((l) => l !== "");

  const parseIngredientLine = (line) => {
    const withoutBullet = line.replace(/^-+\s*/, "");
    const cleanLine = collapseSpaces(withoutBullet);
    if (!cleanLine) return null;
    const parts = cleanLine.split("|").slice(0, 4).map(collapseSpaces);
    if (cleanLine.includes("|") && parts.length >= 3 && parts[2]) {
      const [amount = "", unit = "", name = "", note = ""] = [...parts, "", "", "", ""].slice(0, 4);
      return { amount, unit, name, note };
    }
    return { amount: "", unit: "", name: cleanLine, note: "" };
  };

  const ingredients = readBlock("INGREDIENTES")
    .map(parseIngredientLine)
    .filter((ing) => ing && ing.name);

  const steps = readBlock("PASOS")
    .map((line) => collapseSpaces(line.replace(/^-+\s*/, "")))
    .map((line) => line.replace(/^\d+\s*[\.\)]\s*/, ""))
    .filter(Boolean);

  const notes = readBlock("NOTAS")
    .map((line) => collapseSpaces(line.replace(/^-+\s*/, "")))
    .filter(Boolean);

  const categoriesText = (sections.CATEGORIAS || []).join(" ");

  return {
    title: readScalar("TITULO"),
    servings: readScalar("RACIONES"),
    timeMin: readScalar("TIEMPO_MIN"),
    difficulty: readScalar("DIFICULTAD"),
    country: readScalar("PAIS"),
    categories: categoriesText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    macros: {
      kcal: readScalar("CALORIAS_KCAL"),
      p: readScalar("PROTEINA_G"),
      c: readScalar("CARBOHIDRATOS_G"),
      f: readScalar("GRASA_G"),
    },
    ingredients,
    steps,
    notes,
  };
}
