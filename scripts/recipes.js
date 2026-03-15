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
import { FOODREPO_API_BASE, FOODREPO_API_TOKEN } from "../config/foodrepo.js";
import { getMetCategoryById } from "./met-catalog.js";
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
  const STRUCTURED_INGREDIENT_UNITS = ["g", "kg", "ml", "l", "unit"];
  const DEFAULT_INGREDIENT = () => ({ id: generateId(), text: "", label: "", qty: "", unit: "", notes: "", productId: "", done: false });
  const isBlankIngredientRow = (ing = {}) => {
    const hasText = !!String(ing?.text || "").trim();
    const hasLabel = !!String(ing?.label || "").trim();
    const hasQty = Number(ing?.qty) > 0;
    const hasUnit = !!String(ing?.unit || "").trim();
    const hasProduct = !!String(ing?.productId || "").trim();
    return !(hasText || hasLabel || hasQty || hasUnit || hasProduct);
  };
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
  const $recipesViewToggle = document.getElementById("recipes-view-toggle");
  const $recipesViewButtons = document.querySelectorAll("[data-recipes-view]");
  const $shelfResults = document.getElementById("recipes-shelf-results");
  const $shelfEmpty = document.getElementById("recipes-shelf-empty");
  const $shelfList = document.getElementById("recipes-list");
  const $recipesListPreview = document.getElementById("recipes-list-preview");
  const $shelfFavorites = document.getElementById("recipes-list-favorites");
  const $shelfFavoritesSection = document.getElementById("recipes-favorites-section");
  const $shelfFavoritesCount = document.getElementById("recipes-favorites-count");

  const RECIPE_SPINE_H = 138;

  const $cardsHost = document.getElementById("recipes-cards");
  const $empty = document.getElementById("recipes-empty");

  const $statTotal = document.getElementById("recipe-stat-total");
  const $statProducts = document.getElementById("recipe-stat-products");
  const $statCost = document.getElementById("recipe-stat-cost");
  const $statKcal = document.getElementById("recipe-stat-kcal");
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
  const $recipeIngredientPicker = document.getElementById("recipe-ingredient-picker");
  const $recipeIngredientProduct = document.getElementById("recipe-ingredient-product");
  const $recipeIngredientGrams = document.getElementById("recipe-ingredient-grams");
  const $recipeIngredientAddProduct = document.getElementById("recipe-ingredient-add-product");
  const $recipeCalcSummary = document.getElementById("recipe-calc-summary");

  const $recipesSubtabs = document.querySelectorAll(".recipes-subtab");
  const $recipesPanelLibrary = document.getElementById("recipes-panel-library");
  const $recipesPanelMacros = document.getElementById("recipes-panel-macros");
  const $recipesPanelStatistics = document.getElementById("recipes-panel-statistics");
  const $recipesPanelShopping = document.getElementById("recipes-panel-shopping");
  const $macroDateInput = document.getElementById("macro-date-input");
  const $macroDatePrev = document.getElementById("macro-date-prev");
  const $macroDateNext = document.getElementById("macro-date-next");
  const $macroSummaryGrid = document.getElementById("macro-summary-grid");
  const $macroMeals = document.getElementById("macro-meals");
  const $macroKcalSummary = document.getElementById("macro-kcal-summary");
  const $macroIntegrationOpen = document.getElementById("macro-integration-open");
  const $macroIntegrationModalBackdrop = document.getElementById("macro-integration-modal-backdrop");
  const $macroIntegrationModalClose = document.getElementById("macro-integration-modal-close");
  const $macroBodyweightKg = document.getElementById("macro-bodyweight-kg");
  const $macroWorkKcal = document.getElementById("macro-work-kcal");
  const $macroWorkHabits = document.getElementById("macro-work-habits");
  const $macroStatsPeriods = document.getElementById("macro-stats-periods");
  const $macroStatsPrev = document.getElementById("macro-stats-prev");
  const $macroStatsNext = document.getElementById("macro-stats-next");
  const $macroStatsAnchor = document.getElementById("macro-stats-anchor");
  const $macroStatsMainMetric = document.getElementById("macro-stats-main-metric");
  const $macroStatsKpis = document.getElementById("macro-stats-kpis");
  const $macroStatsMainChart = document.getElementById("macro-stats-main-chart");
  const $macroStatsMainTooltip = document.getElementById("macro-stats-main-tooltip");
  const $macroStatsMainLabel = document.getElementById("macro-stats-main-label");
  const $macroStatsDonutMain = document.getElementById("macro-stats-donut-main");
  const $macroStatsDonutTitle = document.getElementById("macro-stats-donut-title");
  const $macroStatsDonutLegend = document.getElementById("macro-stats-donut-legend");
  const $macroStatsDonutMode = document.getElementById("macro-stats-donut-mode");
  const $macroTargetEditor = document.getElementById("macro-target-editor");
  const $macroShoppingGroups = document.getElementById("macro-shopping-groups");
  const $macroStatsTopRecipes = document.getElementById("macro-stats-top-recipes");
  const $macroStatsTopProducts = document.getElementById("macro-stats-top-products");
  const $macroAddModalBackdrop = document.getElementById("macro-add-modal-backdrop");
  const $macroAddModalClose = document.getElementById("macro-add-modal-close");
  const $macroAddSearch = document.getElementById("macro-add-search");
  const $macroAddResults = document.getElementById("macro-add-results");
  const $macroAddChips = document.getElementById("macro-add-chips");
  const $macroScanPanel = document.getElementById("macro-scan-panel");
  const $macroManualPanel = document.getElementById("macro-manual-panel");
  const $macroScanEngineHtml5 = document.getElementById("macro-scan-engine-html5");
  const $macroScanCapture = document.getElementById("macro-scan-capture");
  const $macroScanRetry = document.getElementById("macro-scan-retry");
  const $macroScanStop = document.getElementById("macro-scan-stop");
  const $macroScanManual = document.getElementById("macro-scan-manual");
  const $macroScanManualBtn = document.getElementById("macro-scan-manual-btn");
  const $macroScanEngineStatus = document.getElementById("macro-scan-engine-status");
  const $macroScanStatus = document.getElementById("macro-scan-status");
  const $macroScanPlacementHint = document.getElementById("macro-scan-placement-hint");
  const $macroScanVideo = document.getElementById("macro-scan-video");
  const $macroScanHtml5Host = document.getElementById("macro-scan-html5-host");
  const $macroScanFrozen = document.getElementById("macro-scan-frozen");
  const $macroScanVideoWrap = document.querySelector(".macro-scan-video-wrap");
  const $macroScanOverlay = document.querySelector(".macro-scan-overlay");
  const $macroScanAddProduct = document.getElementById("macro-scan-add-product");
  const $macroScanLogPanel = document.getElementById("macro-scan-log-panel");
  const $macroScanOcrDebug = document.getElementById("macro-scan-ocr-debug");
  const $macroScanOcrSource = document.getElementById("macro-scan-ocr-source");
  const $macroScanOcrCrop = document.getElementById("macro-scan-ocr-crop");
  const $macroScanOcrFinal = document.getElementById("macro-scan-ocr-final");
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
  const $macroProductBaseUnit = document.getElementById("macro-product-base-unit");
  const $macroProductCarbs = document.getElementById("macro-product-carbs");
  const $macroProductProtein = document.getElementById("macro-product-protein");
  const $macroProductFat = document.getElementById("macro-product-fat");
  const $macroProductKcal = document.getElementById("macro-product-kcal");
  const $macroProductGrams = document.getElementById("macro-product-grams");
  const $macroProductGramsUnit = document.getElementById("macro-product-grams-unit");
  const $macroProductSummary = document.getElementById("macro-product-summary");
  const $macroProductPriceUsed = document.getElementById("macro-product-price-used");
  const $macroProductWeightStart = document.getElementById("macro-product-weight-start");
  const $macroProductWeightEnd = document.getElementById("macro-product-weight-end");
  const $macroProductWeightStartUnit = document.getElementById("macro-product-weight-start-unit");
  const $macroProductWeightEndUnit = document.getElementById("macro-product-weight-end-unit");
  const $macroProductPackWeight = document.getElementById("macro-product-pack-weight");
  const $macroProductPackUnits = document.getElementById("macro-product-pack-units");
  const $macroProductPackConsumed = document.getElementById("macro-product-pack-consumed");
  const $macroProductWeightDiffHint = document.getElementById("macro-product-weight-diff-hint");
  const $macroProductEditToggle = document.getElementById("macro-product-edit-toggle");
  const $macroProductScanBtn = document.getElementById("macro-product-scan-btn");
  const $macroProductFinanceSelect = document.getElementById("macro-product-finance-select");
  const $macroProductFinanceUnlink = document.getElementById("macro-product-finance-unlink");
  const $macroProductFinanceHint = document.getElementById("macro-product-finance-hint");
  const $macroProductPrice = document.getElementById("macro-product-price");
  const $macroProductPackageAmount = document.getElementById("macro-product-package-amount");
  const $macroProductPackageUnit = document.getElementById("macro-product-package-unit");
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
  const RECIPE_VIEW_MODE_STORAGE_KEY = `${getStorageKey()}.ui.viewMode`;
  const allowedRecipeViews = new Set(["shelf", "cards"]);
  let recipesViewMode = "shelf";

  const defaultMacroTargets = {
    kcalTarget: 2200,
    carbs_g: 180,
    protein_g: 140,
    fat_g: 65,
    carbs_pct: 0.33,
    protein_pct: 0.26,
    fat_pct: 0.41,
  };
  const defaultIntegrationConfig = { linkedWorkHabitIds: [], workCaloriesPerMatchedDay: 700, bodyWeightKg: null };
  const mealOrder = ["breakfast", "lunch", "dinner", "snacks"];
  const mealLabels = { breakfast: "Desayuno", lunch: "Almuerzo", dinner: "Cena", snacks: "Snacks" };
  let nutritionProducts = [];
  let financeProducts = [];
  let financeProductsLoaded = false;
  let habitSyncQueue = Promise.resolve();
  let dailyLogsByDate = {};
  let macroTargets = normalizeMacroTargets(defaultMacroTargets);
  let nutritionIntegrationConfig = { ...defaultIntegrationConfig };
  let selectedMacroDate = toISODate(new Date());
  const macroModalState = { meal: "breakfast", source: "products", query: "" };
  const macroStatsState = { period: "week", anchorDate: selectedMacroDate, metric: "macros", donutMode: "kcal-macros" };
  const macroSelectionState = { meal: null, selectedIds: new Set() };
  const macroExpandedRecipes = new Set();
  const macroLongPressState = { timer: null, meal: null, entryId: null, pointerId: null, startX: 0, startY: 0, active: false };
  const macroPalette = {
    carbs: "#ff4bd1",
    protein: "#5aa4ff",
    fat: "#ffc247",
    kcal: "#f5e6a6",
    cost: "#79f3b2",
    burned: "#ff6b6b",
    net: "#9be27a",
    excess: "#ff6666",
  };
  let nutritionSyncMeta = { version: 2, migratedAt: 0, updatedAt: 0 };
  recipesViewMode = getRecipeViewModePreference();
  let nutritionUnsubscribe = null;
  const MACRO_USAGE_KEY_PREFIX = "bookshell.macro.usage.v1";
  const getMacroUsageKey = (uid = currentUid) => uid ? `${MACRO_USAGE_KEY_PREFIX}.${uid}` : MACRO_USAGE_KEY_PREFIX;
  const clampUsageValue = (value, fallback = 0) => {
    const n = Number(value);
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  };
  const loadMacroUsage = () => {
    try {
      const raw = localStorage.getItem(getMacroUsageKey());
      const parsed = raw ? JSON.parse(raw) : null;
      if (!parsed || typeof parsed !== "object") throw new Error("usage_invalid");
      const products = parsed.products && typeof parsed.products === "object" ? parsed.products : {};
      const recipes = parsed.recipes && typeof parsed.recipes === "object" ? parsed.recipes : {};
      return { products, recipes };
    } catch (_) {
      return { products: {}, recipes: {} };
    }
  };
  const saveMacroUsage = () => {
    try {
      localStorage.setItem(getMacroUsageKey(), JSON.stringify(macroUsage));
    } catch (_) {}
  };
  const bumpMacroUsage = (kind, id) => {
    const key = String(id || "").trim();
    if (!key) return;
    const bucket = kind === "recipes" ? macroUsage.recipes : macroUsage.products;
    const prev = bucket[key] && typeof bucket[key] === "object" ? bucket[key] : {};
    bucket[key] = {
      count: clampUsageValue(prev.count, 0) + 1,
      lastAt: Date.now(),
    };
    saveMacroUsage();
  };
  let macroUsage = loadMacroUsage();

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
      macroUsage = loadMacroUsage();
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
    let ingredients = Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ing) => ({
           id: ing.id || generateId(),
           text: String(ing.text || "").trim(),
           label: String(ing.label || "").trim(),
           qty: ing.qty == null || ing.qty === "" ? "" : Math.max(0, Number(ing.qty) || 0),
          unit: normalizeCostUnit(ing.unit || ""),
          notes: String(ing.notes || "").trim(),
          quantity: String(ing.quantity || "").trim(),
          name: String(ing.name || "").trim(),
          productId: String(ing.productId || "").trim(),
          linkedFinanceProductId: String(ing.linkedFinanceProductId || "").trim(),
          linkedHabitId: String(ing.linkedHabitId || "").trim(),
          priceSource: ing.priceSource || null,
          nutritionSnapshot: ing.nutritionSnapshot && typeof ing.nutritionSnapshot === "object"
            ? {
              productId: String(ing.nutritionSnapshot.productId || "").trim(),
              servingBaseQty: Math.max(1, Number(ing.nutritionSnapshot.servingBaseQty) || 100),
              servingBaseUnit: normalizeCostUnit(ing.nutritionSnapshot.servingBaseUnit || "g") || "g",
              macrosPerBase: normalizeMacros(ing.nutritionSnapshot.macrosPerBase || {}),
            }
            : null,
          pricingSnapshot: ing.pricingSnapshot && typeof ing.pricingSnapshot === "object"
            ? {
              productId: String(ing.pricingSnapshot.productId || "").trim(),
              linkedFinanceProductId: String(ing.pricingSnapshot.linkedFinanceProductId || "").trim(),
              priceSource: ing.pricingSnapshot.priceSource || null,
              price: Number(ing.pricingSnapshot.price) > 0 ? Number(ing.pricingSnapshot.price) : null,
              baseQty: Number(ing.pricingSnapshot.baseQty) > 0 ? Number(ing.pricingSnapshot.baseQty) : null,
              baseUnit: normalizeCostUnit(ing.pricingSnapshot.baseUnit || ""),
            }
            : null,
          computedCost: Number(ing.computedCost) || 0,
          computedKcal: Number(ing.computedKcal) || 0,
          computedCarbs: Number(ing.computedCarbs) || 0,
          computedProtein: Number(ing.computedProtein) || 0,
          computedFat: Number(ing.computedFat) || 0,
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

    const legacyNutritionIngredients = Array.isArray(recipe.nutritionIngredients)
      ? recipe.nutritionIngredients.map((it) => ({
        id: it.id || generateId(),
        productId: String(it.productId || "").trim(),
        grams: Math.max(0, Number(it.grams) || 0),
      })).filter((it) => it.productId && it.grams >= 0)
      : [];

    const shouldMigrateLegacyNutrition = legacyNutritionIngredients.length
      && (ingredients.length === 0 || (ingredients.length === 1 && isBlankIngredientRow(ingredients[0])));

    if (shouldMigrateLegacyNutrition) {
      ingredients = legacyNutritionIngredients.map((it) => {
        const linked = nutritionProducts.find((p) => p.id === it.productId) || null;
        const name = String(linked?.name || "").trim();
        const label = name || "Producto";
        return {
          id: it.id || generateId(),
          text: label,
          label,
          qty: Math.max(0, Number(it.grams) || 0),
          unit: "g",
          notes: "",
          quantity: "",
          name: label,
          productId: it.productId,
          linkedFinanceProductId: "",
          linkedHabitId: "",
          priceSource: null,
          nutritionSnapshot: null,
          pricingSnapshot: null,
          computedCost: 0,
          computedKcal: 0,
          computedCarbs: 0,
          computedProtein: 0,
          computedFat: 0,
          done: false,
        };
      });
    }
    return {
      ...recipe,
      country: country?.code || null,
      countryLabel: country?.label || recipe.countryLabel || recipe.country || null,
      imageURL: recipe.imageURL || null,
      ingredients,
      steps,
      servings: Math.max(1, Number(recipe.servings) || 1),
      usageCount: Math.max(0, Number(recipe.usageCount) || 0),
      lastUsedAt: Number(recipe.lastUsedAt) > 0 ? Number(recipe.lastUsedAt) : 0,
      nutritionIngredients: shouldMigrateLegacyNutrition ? [] : legacyNutritionIngredients,
      nutritionTotals: normalizeMacros(recipe.nutritionTotals),
      nutritionPerServing: normalizeMacros(recipe.nutritionPerServing),
    };
  }

  function normalizeIngredientQty(value) {
    const qty = Number(value);
    if (!Number.isFinite(qty) || qty <= 0) return null;
    return qty;
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
    const qty = normalizeIngredientQty(ing.qty);
    const unit = normalizeCostUnit(ing.unit || "");
    const quantity = qty && unit ? `${qty} ${unit}` : String(ing.quantity || parsed.quantity || "").trim();
    const fallbackName = String(ing.label || ing.name || parsed.name || ing.text || "Ingrediente").trim();
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

  function formatCurrency(value) {
    const safe = Number(value);
    if (!Number.isFinite(safe)) return "—";
    return `${safe.toFixed(2)} €`;
  }

  function sortByVisibleNameEs(list = [], getLabel = (row) => row?.name || "") {
    return (Array.isArray(list) ? list.slice() : []).sort((a, b) =>
      String(getLabel(a) || "").localeCompare(String(getLabel(b) || ""), "es", { sensitivity: "base" })
    );
  }

  function normalizeEntityName(value = "") {
    return String(value || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  function levenshteinDistance(a = "", b = "") {
    const aa = String(a);
    const bb = String(b);
    if (aa === bb) return 0;
    if (!aa.length) return bb.length;
    if (!bb.length) return aa.length;
    const matrix = Array.from({ length: aa.length + 1 }, () => Array(bb.length + 1).fill(0));
    for (let i = 0; i <= aa.length; i++) matrix[i][0] = i;
    for (let j = 0; j <= bb.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= aa.length; i++) {
      for (let j = 1; j <= bb.length; j++) {
        const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + cost
        );
      }
    }
    return matrix[aa.length][bb.length];
  }

  function fuzzyMatchByName(targetName = "", list = [], getName = (row) => row?.name || "") {
    const normalizedTarget = normalizeEntityName(targetName);
    if (!normalizedTarget) return null;
    let best = null;
    let bestScore = -1;
    list.forEach((row) => {
      const candidateName = normalizeEntityName(getName(row));
      if (!candidateName) return;
      let score = 0;
      if (candidateName === normalizedTarget) score = 1;
      else if (candidateName.includes(normalizedTarget) || normalizedTarget.includes(candidateName)) score = 0.9;
      else {
        const dist = levenshteinDistance(normalizedTarget, candidateName);
        const maxLen = Math.max(normalizedTarget.length, candidateName.length, 1);
        score = 1 - (dist / maxLen);
      }
      if (score > bestScore) {
        bestScore = score;
        best = row;
      }
    });
    return bestScore >= 0.72 ? best : null;
  }

  function normalizeCostUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    if (["g", "gram", "grams", "gr"].includes(clean)) return "g";
    if (["kg", "kilo", "kilogram", "kilograms"].includes(clean)) return "kg";
    if (["ml", "milliliter", "milliliters"].includes(clean)) return "ml";
    if (["l", "lt", "liter", "liters"].includes(clean)) return "l";
    if (["unit", "units", "ud", "uds", "unidad", "unidades"].includes(clean)) return "unit";
    return "";
  }

  function normalizeUnit(unit) {
    return normalizeCostUnit(unit);
  }

  function resolveProductPackageSpec(product) {
    const directAmount = Number(product?.packageAmount);
    const directUnit = normalizeCostUnit(product?.packageUnit);
    if (directAmount > 0 && directUnit) return { amount: directAmount, unit: directUnit };

    const legacyAmount = Number(product?.priceBaseQty);
    const legacyUnit = normalizeCostUnit(product?.priceBaseUnit);
    if (legacyAmount > 0 && legacyUnit) return { amount: legacyAmount, unit: legacyUnit };

    return { amount: null, unit: "" };
  }

  function formatAmountWithUnit(value, unit) {
    const qty = Number(value);
    const safeUnit = normalizeUnit(unit);
    if (!Number.isFinite(qty) || qty < 0 || !safeUnit) return "—";
    const label = safeUnit === "unit" ? "ud" : safeUnit;
    return `${roundMacro(qty)} ${label}`;
  }

  function convertAmount(value, fromUnit, toUnit) {
    return normalizeQtyByUnit(value, fromUnit, toUnit);
  }

  function getDisplayUnitForProduct(product) {
    return normalizeUnit(product?.baseUnit || product?.servingBaseUnit || product?.packageUnit || "g") || "g";
  }

  function getDisplayAmountForStats(entry) {
    const unit = normalizeUnit(entry?.amountUnit || entry?.unit || "");
    const amount = Number(entry?.amount);
    if (Number.isFinite(amount) && amount > 0 && unit) return formatAmountWithUnit(amount, unit);
    if ((Number(entry?.grams) || 0) > 0) return formatAmountWithUnit(entry.grams, "g");
    if ((Number(entry?.servings) || 0) > 0) return `${roundMacro(entry.servings)} rac`;
    return "—";
  }

  function normalizeEntryServingsCount(value) {
    const raw = String(value ?? "").trim();
    if (!raw) return 1;
    const parsed = Number(raw.replace(",", "."));
    if (!Number.isFinite(parsed)) return 1;
    const rounded = Math.round(parsed * 100) / 100;
    return Math.max(0.01, rounded);
  }

  function getEntryServingsCount(entry) {
    return normalizeEntryServingsCount(entry?.servingsCount);
  }

  function ensureMacroEntryId(entry = {}) {
    const raw = String(entry?.entryId || entry?.id || "").trim();
    if (raw) return raw;
    return generateId();
  }

  function getRecipeSnapshotFromEntry(entry = {}) {
    if (entry.type !== "recipe") return null;
    const fromEntry = entry.recipeSnapshot && typeof entry.recipeSnapshot === "object" ? entry.recipeSnapshot : null;
    if (fromEntry) return fromEntry;
    const linked = recipes.find((r) => r.id === entry.refId) || null;
    if (linked) return linked;
    return {
      id: String(entry.refId || "").trim(),
      title: String(entry.nameSnapshot || "Receta").trim(),
      ingredients: Array.isArray(entry.ingredientsSnapshot) ? entry.ingredientsSnapshot : [],
      nutritionTotals: normalizeMacros(entry.macrosSnapshot || {}),
      nutritionPerServing: normalizeMacros(entry.macrosSnapshot || {}),
      servings: Math.max(1, Number(entry.servings) || 1),
      totalCost: Number(entry.computedCost) || 0,
    };
  }

  function getRecipeIngredientsFromEntry(entry = {}) {
    if (Array.isArray(entry.ingredientsSnapshot) && entry.ingredientsSnapshot.length) return entry.ingredientsSnapshot;
    const recipe = getRecipeSnapshotFromEntry(entry);
    return Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
  }

  function getEntryMacrosTotal(entry) {
    const base = normalizeMacros(entry?.macrosSnapshot || {});
    const count = getEntryServingsCount(entry);
    return normalizeMacros({
      carbs: (Number(base.carbs) || 0) * count,
      protein: (Number(base.protein) || 0) * count,
      fat: (Number(base.fat) || 0) * count,
      kcal: (Number(base.kcal) || 0) * count,
    });
  }

  function normalizeQtyByUnit(quantity, fromUnit, toUnit) {
    const qty = Number(quantity);
    const from = normalizeCostUnit(fromUnit);
    const to = normalizeCostUnit(toUnit);
    if (!Number.isFinite(qty) || qty < 0 || !from || !to) return null;
    if (from === to) return qty;
    if (from === "kg" && to === "g") return qty * 1000;
    if (from === "g" && to === "kg") return qty / 1000;
    if (from === "l" && to === "ml") return qty * 1000;
    if (from === "ml" && to === "l") return qty / 1000;
    return null;
  }

  function findLinkedFinanceProduct(product) {
    const financeProductId = String(product?.financeProductId || "").trim();
    if (!financeProductId) return null;
    return financeProducts.find((row) => row.id === financeProductId) || null;
  }

  function getEffectiveProductPrice(product) {
    const linked = findLinkedFinanceProduct(product);
    const financePrice = Number(linked?.lastPrice);
    if (financePrice > 0) return financePrice;
    const manualPrice = Number(product?.price);
    if (manualPrice > 0) return manualPrice;
    return null;
  }

  function getEffectiveProductPriceSource(product) {
    const linked = findLinkedFinanceProduct(product);
    const financePrice = Number(linked?.lastPrice);
    if (financePrice > 0) return "finance-linked-last-price";
    const manualPrice = Number(product?.price);
    if (manualPrice > 0) return "manual-price";
    return null;
  }

  function resolveProductPriceBase(product) {
    const pkg = resolveProductPackageSpec(product);
    if (pkg.amount > 0 && pkg.unit) return { qty: pkg.amount, unit: pkg.unit };
    const baseQty = Number(product?.baseQuantity || product?.servingBaseGrams);
    const baseUnit = normalizeUnit(product?.baseUnit || product?.servingBaseUnit || "");
    if (baseQty > 0 && baseUnit) {
      return { qty: baseQty, unit: baseUnit };
    }
    const legacyBaseGrams = Number(product?.servingBaseGrams);
    if (legacyBaseGrams > 0) {
      return { qty: legacyBaseGrams, unit: "g" };
    }
    return null;
  }

  function buildNutritionSnapshot(product) {
    if (!product) return null;
    return {
      productId: String(product.id || "").trim(),
      servingBaseQty: Math.max(1, Number(product.baseQuantity || product.servingBaseGrams) || 100),
      servingBaseUnit: normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g",
      macrosPerBase: normalizeMacros(product.macros || {}),
    };
  }

  function buildPricingSnapshot(product) {
    if (!product) return null;
    const base = resolveProductPriceBase(product);
    const effectivePrice = getEffectiveProductPrice(product);
    if (!base && !(effectivePrice > 0)) return null;
    return {
      productId: String(product.id || "").trim(),
      linkedFinanceProductId: String(product.financeProductId || "").trim(),
      priceSource: getEffectiveProductPriceSource(product),
      price: effectivePrice,
      baseQty: Number(base?.qty) > 0 ? Number(base.qty) : null,
      baseUnit: normalizeCostUnit(base?.unit || ""),
    };
  }

  function getIngredientLinkedProduct(ingredient) {
    const productId = String(ingredient?.productId || "").trim();
    if (!productId) return null;
    return nutritionProducts.find((p) => p.id === productId) || null;
  }

  function computeIngredientNutrition(ingredient, product = null) {
    const qty = normalizeIngredientQty(ingredient?.qty);
    const unit = normalizeCostUnit(ingredient?.unit);
    if (!qty || !unit) return { calculable: false, totals: normalizeMacros({}) };
    const nutritionSnapshot = ingredient?.nutritionSnapshot || buildNutritionSnapshot(product);
    const macrosPerBase = normalizeMacros(nutritionSnapshot?.macrosPerBase || {});
    const baseQty = Number(nutritionSnapshot?.servingBaseQty) > 0 ? Number(nutritionSnapshot.servingBaseQty) : 100;
    const baseUnit = normalizeCostUnit(nutritionSnapshot?.servingBaseUnit || "g");
    const normalizedQty = normalizeQtyByUnit(qty, unit, baseUnit);
    if (!(normalizedQty >= 0) || !(baseQty > 0)) return { calculable: false, totals: normalizeMacros({}) };
    const ratio = normalizedQty / baseQty;
    return {
      calculable: true,
      totals: normalizeMacros({
        carbs: macrosPerBase.carbs * ratio,
        protein: macrosPerBase.protein * ratio,
        fat: macrosPerBase.fat * ratio,
        kcal: macrosPerBase.kcal * ratio,
      }),
    };
  }

  function computeIngredientCost(ingredient, product = null) {
    const qty = normalizeIngredientQty(ingredient?.qty);
    const unit = normalizeCostUnit(ingredient?.unit);
    if (!qty || !unit) return { calculable: false, value: null };
    const pricingSnapshot = ingredient?.pricingSnapshot || buildPricingSnapshot(product);
    const price = Number(pricingSnapshot?.price);
    const baseQty = Number(pricingSnapshot?.baseQty);
    const baseUnit = normalizeCostUnit(pricingSnapshot?.baseUnit || "");
    if (!(price > 0) || !(baseQty > 0) || !baseUnit) return { calculable: false, value: null };
    const normalizedBaseQty = normalizeQtyByUnit(baseQty, baseUnit, unit);
    if (!(normalizedBaseQty > 0)) return { calculable: false, value: null };
    return { calculable: true, value: (qty / normalizedBaseQty) * price };
  }

  function buildRecipeIngredientFromProduct(product, draft = {}) {
    const qty = normalizeIngredientQty(draft.qty);
    const fallbackUnit = normalizeUnit(product?.baseUnit || "g") || "g";
    const unit = normalizeCostUnit(draft.unit || "") || fallbackUnit;
    const parsed = splitIngredientText(draft.text || "");
    const baseIngredient = {
      ...draft,
      id: draft.id || generateId(),
      productId: String(product?.id || draft.productId || "").trim(),
      label: String(draft.label || product?.name || parsed.name || draft.name || draft.text || "").trim(),
      name: String(draft.name || product?.name || parsed.name || draft.label || draft.text || "").trim(),
      qty: qty == null ? "" : qty,
      unit,
      linkedFinanceProductId: String(product?.financeProductId || draft.linkedFinanceProductId || "").trim(),
      linkedHabitId: String(product?.linkedHabitId || draft.linkedHabitId || "").trim(),
      nutritionSnapshot: buildNutritionSnapshot(product) || draft.nutritionSnapshot || null,
      pricingSnapshot: buildPricingSnapshot(product) || draft.pricingSnapshot || null,
      priceSource: getEffectiveProductPriceSource(product) || draft.priceSource || null,
    };
    const nutrition = computeIngredientNutrition(baseIngredient, product);
    const cost = computeIngredientCost(baseIngredient, product);
    return {
      ...baseIngredient,
      computedKcal: nutrition.calculable ? nutrition.totals.kcal : 0,
      computedCarbs: nutrition.calculable ? nutrition.totals.carbs : 0,
      computedProtein: nutrition.calculable ? nutrition.totals.protein : 0,
      computedFat: nutrition.calculable ? nutrition.totals.fat : 0,
      computedCost: cost.calculable ? Number(cost.value) || 0 : 0,
    };
  }

  function autoLinkIngredientFacets(ingredient = {}) {
    const baseName = String(ingredient?.name || ingredient?.label || ingredient?.text || "").trim();
    const matchedMacro = ingredient.productId
      ? nutritionProducts.find((p) => p.id === ingredient.productId) || null
      : fuzzyMatchByName(baseName, nutritionProducts, (p) => p?.name || "");
    const matchedFinance = ingredient.linkedFinanceProductId
      ? financeProducts.find((f) => f.id === ingredient.linkedFinanceProductId) || null
      : fuzzyMatchByName(baseName, financeProducts, (f) => f?.name || "");
    return {
      ...ingredient,
      productId: String(matchedMacro?.id || ingredient.productId || "").trim(),
      linkedFinanceProductId: String(matchedFinance?.id || ingredient.linkedFinanceProductId || "").trim(),
    };
  }



  function refreshRecipeLinkDatalists() {
    const macroList = document.getElementById("recipe-macro-products-list");
    if (macroList) {
      macroList.innerHTML = sortByVisibleNameEs(nutritionProducts, (p) => p?.name || "")
        .map((p) => `<option value="${escapeHtml(p.name)}" data-id="${escapeHtml(p.id)}"></option>`)
        .join("");
    }
    const financeList = document.getElementById("recipe-finance-products-list");
    if (financeList) {
      financeList.innerHTML = sortByVisibleNameEs(financeProducts, (f) => f?.name || "")
        .map((f) => `<option value="${escapeHtml(f.name)}" data-id="${escapeHtml(f.id)}"></option>`)
        .join("");
    }
  }
  function recalculateRecipeDerivedData(recipe) {
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    let totals = normalizeMacros({});
    let totalCost = 0;
    let calculableNutrition = 0;
    let calculableCost = 0;
    const normalizedIngredients = ingredients.map((ing) => {
      const product = getIngredientLinkedProduct(ing);
      const normalized = buildRecipeIngredientFromProduct(product, ing);
      const nutrition = computeIngredientNutrition(normalized, product);
      const cost = computeIngredientCost(normalized, product);
      if (nutrition.calculable) {
        totals = plusMacros(totals, nutrition.totals);
        calculableNutrition += 1;
      }
      if (cost.calculable) {
        totalCost += Number(cost.value) || 0;
        calculableCost += 1;
      }
      return normalized;
    });
    const servings = resolveRecipeServings(recipe);
    const perServing = {
      carbs: servings > 0 ? totals.carbs / servings : 0,
      protein: servings > 0 ? totals.protein / servings : 0,
      fat: servings > 0 ? totals.fat / servings : 0,
      kcal: servings > 0 ? totals.kcal / servings : 0,
    };
    return {
      ...recipe,
      ingredients: normalizedIngredients,
      nutritionTotals: normalizeMacros(totals),
      nutritionPerServing: normalizeMacros(perServing),
      totalCost: Number(totalCost) || 0,
      calculableNutrition,
      calculableCost,
    };
  }

  function calculateProductConsumedCost(product, consumedQty, consumedUnit) {
    const effectivePrice = getEffectiveProductPrice(product);
    const intakeUnit = normalizeCostUnit(consumedUnit);
    const intakeQty = Number(consumedQty);
    const base = resolveProductPriceBase(product);
    if (!(effectivePrice > 0) || !base || !(intakeQty >= 0) || !intakeUnit) return null;
    const normalizedBaseQty = normalizeQtyByUnit(base.qty, base.unit, intakeUnit);
    if (!(normalizedBaseQty > 0)) return null;
    return (intakeQty / normalizedBaseQty) * effectivePrice;
  }

  function calculateStructuredIngredientNutrition(ingredient, product) {
    const computed = computeIngredientNutrition(ingredient, product);
    return computed.calculable ? computed.totals : null;
  }

  function calculateStructuredIngredientCost(ingredient, product) {
    const computed = computeIngredientCost(ingredient, product);
    return computed.calculable ? computed.value : null;
  }

  function getRecipePerServingValues(recipe, totals) {
    const servings = resolveRecipeServings(recipe);
    return {
      kcal: servings > 0 ? (Number(totals?.kcal) || 0) / servings : 0,
      cost: servings > 0 ? (Number(totals?.cost) || 0) / servings : 0,
      servings,
    };
  }

  function calculateRecipeTotals(recipe) {
    const recalculated = recalculateRecipeDerivedData(recipe || {});
    const ingredients = Array.isArray(recalculated.ingredients) ? recalculated.ingredients : [];
    const perServing = getRecipePerServingValues(recalculated, { kcal: recalculated.nutritionTotals?.kcal || 0, cost: recalculated.totalCost || 0 });
    return {
      totals: normalizeMacros(recalculated.nutritionTotals || {}),
      totalCost: Number(recalculated.totalCost) || 0,
      calculableNutrition: Number(recalculated.calculableNutrition) || 0,
      calculableCost: Number(recalculated.calculableCost) || 0,
      ingredientsTotal: ingredients.length,
      missingNutrition: Math.max(0, ingredients.length - (Number(recalculated.calculableNutrition) || 0)),
      missingCost: Math.max(0, ingredients.length - (Number(recalculated.calculableCost) || 0)),
      perServing,
    };
  }

  function getRecipeNutritionSummary(recipe) {
    const structured = calculateRecipeTotals(recipe);
    const hasStructured = structured.calculableNutrition > 0;
    if (hasStructured) {
      return {
        totals: normalizeMacros(structured.totals),
        hasData: true,
      };
    }
    const fallback = normalizeMacros(recipe?.nutritionTotals || recipe?.nutritionPerServing || {});
    const hasFallback = fallback.kcal > 0 || fallback.carbs > 0 || fallback.protein > 0 || fallback.fat > 0;
    return {
      totals: fallback,
      hasData: hasFallback,
    };
  }

  function getRecipeCostSummary(recipe) {
    const cost = calculateRecipeCost(recipe, resolveRecipeServings(recipe));
    const perServing = Number(cost?.perServing);
    const total = Number(cost?.total);
    return {
      total: Number.isFinite(total) ? total : 0,
      perServing: Number.isFinite(perServing) ? perServing : null,
      hasData: Number(cost?.covered) > 0 && Number.isFinite(perServing),
    };
  }

  function formatMetricValue(value, suffix = "") {
    const n = Number(value);
    if (!Number.isFinite(n) || n <= 0) return "—";
    return `${roundMacro(n)}${suffix}`;
  }

  function getRecipeViewModePreference() {
    try {
      const raw = String(localStorage.getItem(RECIPE_VIEW_MODE_STORAGE_KEY) || "").trim();
      return allowedRecipeViews.has(raw) ? raw : "shelf";
    } catch (_) {
      return "shelf";
    }
  }

  function persistRecipeViewMode(mode) {
    if (!allowedRecipeViews.has(mode)) return;
    try { localStorage.setItem(RECIPE_VIEW_MODE_STORAGE_KEY, mode); } catch (_) {}
  }

  function renderRecipesViewToggle() {
    $recipesViewButtons.forEach((btn) => {
      const active = btn.dataset.recipesView === recipesViewMode;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
  }

  function buildRecipeKpiChip(type, text, muted = false) {
    const mutedClass = muted ? " is-muted" : "";
    return `<span class="recipe-kpi-chip recipe-kpi-chip-${type}${mutedClass}">${escapeHtml(text)}</span>`;
  }

  function renderRecipeCardRow(recipe) {
    const nutrition = getRecipeNutritionSummary(recipe);
    const cost = getRecipeCostSummary(recipe);
    const metadata = [recipe.meal, recipe.health, ...(Array.isArray(recipe.tags) ? recipe.tags : [])].filter(Boolean).join(" · ");
    const hasImage = Boolean(String(recipe.imageURL || "").trim());
    const imageMarkup = hasImage
      ? `<div class="recipe-row-media">
          <img class="recipe-row-media-bleed" src="${escapeAttr(recipe.imageURL)}" alt="" aria-hidden="true" loading="lazy" decoding="async"/>
          <img class="recipe-row-media-img" src="${escapeAttr(recipe.imageURL)}" alt="${escapeAttr(recipe.title || "Receta")}" loading="lazy" decoding="async"/>
        </div>`
      : "";
    return `
      <article class="recipe-row-card${hasImage ? " has-image" : ""}" data-open-recipe="${escapeAttr(recipe.id)}">
        ${imageMarkup}
        <div class="recipe-row-body">
          <div class="recipe-row-title-wrap">
            <h4 class="recipe-row-title">${escapeHtml(recipe.title || "Receta")}</h4>
            <button class="recipe-row-favorite-toggle" type="button" data-toggle-recipe-favorite="${escapeAttr(recipe.id)}" aria-label="${recipe.favorite ? "Quitar de favoritas" : "Añadir a favoritas"}">${recipe.favorite ? "★" : "☆"}</button>
          </div>
          ${metadata ? `<p class="recipe-row-meta">${escapeHtml(metadata)}</p>` : ""}
          <div class="recipe-row-metrics">
            ${buildRecipeKpiChip("kcal", nutrition.hasData ? `${formatMetricValue(nutrition.totals.kcal, " kcal")}` : "— kcal", !nutrition.hasData)}
            ${buildRecipeKpiChip("carbs", nutrition.hasData ? `C ${formatMetricValue(nutrition.totals.carbs, "g")}` : "C —", !nutrition.hasData)}
            ${buildRecipeKpiChip("protein", nutrition.hasData ? `P ${formatMetricValue(nutrition.totals.protein, "g")}` : "P —", !nutrition.hasData)}
            ${buildRecipeKpiChip("fat", nutrition.hasData ? `G ${formatMetricValue(nutrition.totals.fat, "g")}` : "G —", !nutrition.hasData)}
            ${buildRecipeKpiChip("cost", cost.hasData ? formatCurrency(cost.perServing) : "—", !cost.hasData)}
          </div>
        </div>
      </article>
    `;
  }

  function sortRecipesForGlobalView(list = []) {
    const favorites = list
      .filter((r) => r?.favorite)
      .sort((a, b) => {
        const usageDelta = (Number(a?.usageCount) || 0) - (Number(b?.usageCount) || 0);
        if (usageDelta !== 0) return usageDelta;
        const lastUsedDelta = (Number(a?.lastUsedAt) || 0) - (Number(b?.lastUsedAt) || 0);
        if (lastUsedDelta !== 0) return lastUsedDelta;
        return String(a?.title || "").localeCompare(String(b?.title || ""), "es", { sensitivity: "base" });
      });
    const regular = list
      .filter((r) => !r?.favorite)
      .sort((a, b) => String(a?.title || "").localeCompare(String(b?.title || ""), "es", { sensitivity: "base" }));
    return { favorites, regular, merged: [...favorites, ...regular] };
  }

  function renderRecipeCardsView(list = []) {
    if (!$recipesListPreview) return;
    const grouped = sortRecipesForGlobalView(list);
    if (!grouped.merged.length) {
      $recipesListPreview.innerHTML = '<div class="recipe-row-empty">No hay recetas que coincidan</div>';
      return;
    }
    const sections = [];
    if (grouped.favorites.length) {
      sections.push(`<div class="recipe-row-group-title">Favoritas (${grouped.favorites.length})</div>`);
      sections.push(grouped.favorites.map((recipe) => renderRecipeCardRow(recipe)).join(""));
    }
    if (grouped.regular.length) {
      sections.push(`<div class="recipe-row-group-title">Todas (${grouped.regular.length})</div>`);
      sections.push(grouped.regular.map((recipe) => renderRecipeCardRow(recipe)).join(""));
    }
    $recipesListPreview.innerHTML = sections.join("");
    $recipesListPreview.querySelectorAll("[data-open-recipe]").forEach((node) => {
      node.addEventListener("click", (event) => {
        if (event.target.closest("[data-toggle-recipe-favorite]")) return;
        openRecipeDetail(node.getAttribute("data-open-recipe"));
      });
    });
    $recipesListPreview.querySelectorAll("[data-toggle-recipe-favorite]").forEach((btn) => {
      btn.addEventListener("click", (event) => {
        try { event.stopPropagation(); } catch (_) {}
        const recipeId = btn.getAttribute("data-toggle-recipe-favorite");
        const recipe = recipes.find((item) => item.id === recipeId);
        if (!recipe) return;
        updateRecipe(recipeId, { favorite: !recipe.favorite });
      });
    });
  }

  function renderRecipeListPreview(list = []) {
    renderRecipeCardsView(list);
  }

  function resolveRecipeServings(recipe) {
    return Math.max(1, Number(recipe?.servings || recipe?.yield || recipe?.portions) || 1);
  }

  function calculateRecipeCost(recipe, servings = 1) {
    const structured = calculateRecipeTotals(recipe);
    if (structured.calculableCost > 0) {
      const recipeServings = resolveRecipeServings(recipe);
      const multiplier = Math.max(0, Number(servings) || 0) / recipeServings;
      const total = structured.totalCost * multiplier;
      return {
        total,
        perServing: structured.perServing.cost,
        missing: structured.missingCost,
        covered: structured.calculableCost,
        ingredientsTotal: structured.ingredientsTotal,
      };
    }
    const ingredients = Array.isArray(recipe?.nutritionIngredients) ? recipe.nutritionIngredients : [];
    const recipeServings = resolveRecipeServings(recipe);
    const multiplier = Math.max(0, Number(servings) || 0) / recipeServings;
    let total = 0;
    let missing = 0;
    let covered = 0;
    ingredients.forEach((it) => {
      const product = nutritionProducts.find((p) => p.id === it?.productId);
      const grams = Math.max(0, Number(it?.grams) || 0);
      const itemCost = calculateProductConsumedCost(product, grams * multiplier, "g");
      if (itemCost == null) missing += 1;
      else {
        covered += 1;
        total += itemCost;
      }
    });
    const fullRecipeTotal = multiplier > 0 ? total / multiplier : 0;
    const perServing = recipeServings > 0 ? fullRecipeTotal / recipeServings : null;
    return { total, perServing, missing, covered, ingredientsTotal: ingredients.length };
  }

  function calculateEntryFoodCost(entry) {
    if (!entry) return { cost: null, missing: 1 };
    const servingsCount = getEntryServingsCount(entry);
    if (Number.isFinite(Number(entry?.computedCost)) && Number(entry.computedCost) >= 0) {
      return { cost: Number(entry.computedCost) * servingsCount, missing: 0 };
    }
    if (entry.type === "product") {
      const p = nutritionProducts.find((x) => x.id === entry.refId);
      const amount = Math.max(0, Number(entry.amount) || Number(entry.grams) || 0);
      const unit = normalizeUnit(entry.unit || "g") || "g";
      const cost = calculateProductConsumedCost(p, amount, unit);
      return { cost: cost == null ? null : Number(cost) * servingsCount, missing: cost == null ? 1 : 0 };
    }
    if (entry.type === "recipe") {
      const recipe = recipes.find((x) => x.id === entry.refId);
      const servings = Math.max(0, Number(entry.servings) || 0);
      const rc = calculateRecipeCost(recipe, servings);
      return { cost: rc.covered ? (Number(rc.total) || 0) * servingsCount : null, missing: rc.missing || 0 };
    }
    return { cost: null, missing: 0 };
  }

  function computeConsumptionEntryCost(product, amount, unit) {
    const cost = calculateProductConsumedCost(product, amount, unit);
    if (!(Number.isFinite(Number(cost)) && Number(cost) >= 0)) {
      return { computedCost: null, costSource: null, pricingSnapshot: buildPricingSnapshot(product) || null };
    }
    const costSource = getEffectiveProductPriceSource(product) || "snapshot";
    return {
      computedCost: Number(cost),
      costSource,
      pricingSnapshot: {
        ...(buildPricingSnapshot(product) || {}),
        computedCost: Number(cost),
      },
    };
  }

  function buildConsumptionEntryFromEditor({ product, amount, unit, meal }) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    const safeUnit = normalizeUnit(unit || product?.baseUnit || "g") || "g";
    const safeMeal = mealOrder.includes(meal) ? meal : "breakfast";
    const baseUnit = normalizeUnit(product?.baseUnit || product?.servingBaseUnit || "g") || "g";
    const normalizedAmount = convertAmount(safeAmount, safeUnit, baseUnit);
    const macrosSnapshot = normalizedAmount == null
      ? normalizeMacros({})
      : normalizeMacros(calcProductMacros({ ...product, servingBaseGrams: Number(product?.baseQuantity || product?.servingBaseGrams) || 100 }, normalizedAmount));
    const cost = computeConsumptionEntryCost(product, safeAmount, safeUnit);
    const linkedHabitId = String(product?.linkedHabitId || "").trim();
    return {
      entryId: generateId(),
      type: "product",
      mealSlot: safeMeal,
      refId: String(product?.id || "").trim(),
      productId: String(product?.id || "").trim(),
      productName: String(product?.name || "").trim(),
      nameSnapshot: String(product?.name || "").trim(),
      grams: convertAmount(safeAmount, safeUnit, "g") ?? 0,
      amount: safeAmount,
      unit: safeUnit,
      amountUnit: safeUnit,
      detectedUnitType: product?.detectedUnitType || (["ml", "l"].includes(baseUnit) ? "volume" : "mass"),
      linkedFinanceProductId: String(product?.financeProductId || "").trim(),
      linkedHabitId,
      habitSync: {
        habitId: linkedHabitId,
        amount: linkedHabitId ? 1 : 0,
      },
      nutritionSnapshot: buildNutritionSnapshot(product) || null,
      pricingSnapshot: cost.pricingSnapshot,
      priceSource: getEffectiveProductPriceSource(product) || null,
      costSource: cost.costSource,
      computedCost: Number.isFinite(Number(cost.computedCost)) ? Number(cost.computedCost) : null,
      macrosSnapshot,
      servingsCount: 1,
      sideEffects: {
        habits: linkedHabitId ? [{ habitId: linkedHabitId, amount: 1 }] : [],
        financeCost: Number.isFinite(Number(cost.computedCost)) ? Number(cost.computedCost) : 0,
        productsResolved: 1,
        productsTotal: 1,
      },
      createdAt: Date.now(),
    };
  }

  function persistConsumptionEntry(entry, { meal, entryTarget = null, date = selectedMacroDate } = {}) {
    const log = getDailyLog(date);
    const safeMeal = mealOrder.includes(meal || entry?.mealSlot) ? (meal || entry.mealSlot) : "breakfast";
    if (entryTarget && Number.isFinite(Number(entryTarget.idx))) {
      const idx = Number(entryTarget.idx);
      if (log?.meals?.[safeMeal]?.entries?.[idx]) {
        log.meals[safeMeal].entries[idx] = { ...log.meals[safeMeal].entries[idx], ...entry, mealSlot: safeMeal };
      }
    } else {
      log.meals[safeMeal].entries.unshift({ ...entry, mealSlot: safeMeal });
    }
    persistNutrition();
    renderMacrosView();
    return { meal: safeMeal };
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

  function renderRecipeShelf() {
    if (!$shelfList) return;
    const shelfQuery = (filterState.shelfQuery || "").trim().toLowerCase();
    const filtered = filterRecipes().filter((r) => {
      if (!shelfQuery) return true;
      const text = [r.title, r.meal, r.health, (r.tags || []).join(" "), r.countryLabel || r.country]
        .join(" ")
        .toLowerCase();
      return text.includes(shelfQuery);
    });

    const grouped = sortRecipesForGlobalView(filtered);
    const favorites = grouped.favorites;
    const regular = grouped.regular;

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
    if (recipesViewMode === "cards") renderRecipeCardsView(filtered);
    else renderRecipeListPreview(filtered);
    if ($empty) {
      $empty.style.display = recipes.length ? "none" : "block";
    }
  }

  function renderRecipeLibraryViews() {
    renderRecipesViewToggle();
    renderRecipeShelf();
    const showCards = recipesViewMode === "cards";
    if ($shelfList) $shelfList.style.display = showCards ? "none" : "";
    if ($shelfFavoritesSection && showCards) $shelfFavoritesSection.style.display = "none";
    if ($recipesListPreview) {
      const panel = $recipesListPreview.closest(".recipes-list-panel");
      if (panel) panel.style.display = showCards ? "" : "none";
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
    const totalRecipes = recipes.length;
    const totalProducts = nutritionProducts.length;
    const summary = summarizeStatistics();
    const totalCost = Number(summary?.totalCost) || 0;
    const totalKcal = Number(summary?.totals?.kcal) || 0;

    if ($statTotal) $statTotal.textContent = String(totalRecipes);
    if ($statProducts) $statProducts.textContent = String(totalProducts);
    if ($statCost) {
      $statCost.textContent = formatCurrency(totalCost);
      $statCost.title = `Gasto total (segun la estadistica): ${formatCurrency(totalCost)}.`;
    }
    if ($statKcal) {
      $statKcal.textContent = String(roundMacro(totalKcal));
      $statKcal.title = `Kcal ingeridas (segun la estadistica): ${roundMacro(totalKcal)} kcal.`;
    }

    const lauraChecksTotal = recipes.filter((r) => r.laura).length;
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
      renderRecipeLibraryViews();
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
    renderRecipeLibraryViews();
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
    loadFinanceProductsCatalog().then(() => refreshRecipeLinkDatalists()).catch(() => {});
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
    }
    renderRecipeIngredientProductPicker();
    updateRecipeCalcSummary();
  }

  function closeRecipeModal() {
    clearRecipePhotoObjectUrl();
    if ($modalBackdrop) $modalBackdrop.classList.add("hidden");
  }

  function updateRecipe(id, patch) {
    const ts = Date.now();
    try { localStorage.setItem("bookshell.lastRecipeId", String(id)); localStorage.setItem("bookshell.lastRecipeAt", String(ts)); } catch (_) {}
    const mergedPatch = { ...(patch || {}), updatedAt: ts };
    recipes = recipes.map((r) => {
      if (r.id !== id) return r;
      const merged = normalizeRecipeFields({ ...r, ...mergedPatch });
      return normalizeRecipeFields({ ...recalculateRecipeDerivedData(merged), updatedAt: ts });
    });
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
    normalizedPayload = normalizeRecipeFields(recalculateRecipeDerivedData(normalizedPayload));

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
    renderRecipeLibraryViews();
    renderStats();
    renderCharts();
    renderCalendar();
    renderMacrosView();
    renderStatisticsView();
    renderShoppingView();
  }

  function renderIngredientRows(list = []) {
    if (!$recipeIngredientsList) return;
    refreshRecipeLinkDatalists();
    const frag = document.createDocumentFragment();
    list.forEach((item) => frag.appendChild(buildIngredientRow(autoLinkIngredientFacets(item))));
    $recipeIngredientsList.innerHTML = "";
    $recipeIngredientsList.appendChild(frag);
    updateRecipeCalcSummary();
  }

  function updateRecipeCalcSummary() {
    if (!$recipeCalcSummary) return;
    const draft = { ingredients: collectIngredientRows(), servings: Math.max(1, Number($recipeServings?.value) || 1) };
    const totals = calculateRecipeTotals(draft);
    const perServing = totals.perServing;
    $recipeCalcSummary.textContent = `${roundMacro(totals.totals.kcal)} kcal · ${formatCurrency(totals.totalCost)} · calc kcal ${totals.calculableNutrition}/${totals.ingredientsTotal || 0} · calc coste ${totals.calculableCost}/${totals.ingredientsTotal || 0} · ${roundMacro(perServing.kcal)} kcal/rac · ${formatCurrency(perServing.cost)}/rac`;
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
  row.dataset.productId = String(item.productId || "").trim();
  row.dataset.financeProductId = String(item.linkedFinanceProductId || "").trim();

  const macroLinked = nutritionProducts.find((p) => p.id === row.dataset.productId);
  const financeLinked = financeProducts.find((f) => f.id === row.dataset.financeProductId);

  row.innerHTML = `
    <div class="ingredient-main-row">
      <input
        type="number"
        class="builder-input ingredient-qty"
        placeholder="Cant."
        min="0"
        step="0.01"
        value="${item.qty == null || item.qty === "" ? "" : String(item.qty)}"
      />
      <input
        type="text"
        class="builder-input ingredient-unit"
        placeholder="Unidad"
        value="${escapeHtml(item.unit || "")}"
      />
      <input
        type="text"
        class="builder-input ingredient-label"
        placeholder="Ingrediente"
        value="${escapeHtml(item.label || item.name || item.text || "")}"
      />
      <button
        type="button"
        class="icon-btn icon-btn-small ingredient-remove"
        aria-label="Eliminar ingrediente"
      >✕</button>
    </div>

    <div class="ingredient-links-row">
      <input
        type="select"
        class="builder-input ingredient-link-search ingredient-link-macro"
        placeholder="Vincular macro…"
        list="recipe-macro-products-list"
        value="${escapeHtml(macroLinked?.name || "")}"
      />
      <input
        type="select"
        class="builder-input ingredient-link-search ingredient-link-finance"
        placeholder="Vincular finanzas…"
        list="recipe-finance-products-list"
        value="${escapeHtml(financeLinked?.name || "")}"
      />
      
    </div>
<button
        type="button"
        class="btn ghost btn-compact ingredient-create-product"
      >Crear macro</button>
    <div class="ingredient-link-status"></div>
  `;

  const qty = row.querySelector(".ingredient-qty");
  const unit = row.querySelector(".ingredient-unit");
  const label = row.querySelector(".ingredient-label");
  const notes = row.querySelector(".ingredient-notes");
  const macroInput = row.querySelector(".ingredient-link-macro");
  const financeInput = row.querySelector(".ingredient-link-finance");
  const remove = row.querySelector(".ingredient-remove");
  const createMacroBtn = row.querySelector(".ingredient-create-product");
  const status = row.querySelector(".ingredient-link-status");

  const renderIngredientLinkState = () => {
    const chips = [];
    if (!String(row.dataset.productId || "").trim()) {
      chips.push('<span class="ingredient-link-chip">Sin macro</span>');
    }
    if (!String(row.dataset.financeProductId || "").trim()) {
      chips.push('<span class="ingredient-link-chip">Sin finanzas</span>');
    }
    status.innerHTML = chips.join("");
  };

  qty.addEventListener("input", updateRecipeCalcSummary);
  unit.addEventListener("input", updateRecipeCalcSummary);
  label.addEventListener("input", updateRecipeCalcSummary);

  remove.addEventListener("click", () => {
    row.remove();
    updateRecipeCalcSummary();
  });

  macroInput.addEventListener("change", () => {
    const found = fuzzyMatchByName(macroInput.value || "", nutritionProducts, (p) => p?.name || "");
    row.dataset.productId = found?.id ? String(found.id) : "";
    updateRecipeCalcSummary();
    renderIngredientLinkState();
  });

  financeInput.addEventListener("change", () => {
    const found = fuzzyMatchByName(financeInput.value || "", financeProducts, (f) => f?.name || "");
    row.dataset.financeProductId = found?.id ? String(found.id) : "";
    renderIngredientLinkState();
  });

  createMacroBtn.addEventListener("click", () => {
    const draft = {
      id: generateId(),
      name: String(label.value || item.name || "").trim() || "Nuevo producto",
      baseQuantity: Math.max(1, Number(qty.value) || 100),
      baseUnit: normalizeUnit(unit.value || "g") || "g",
      servingBaseGrams: Math.max(1, Number(qty.value) || 100),
      servingBaseUnit: normalizeUnit(unit.value || "g") || "g",
      macros: { carbs: 0, protein: 0, fat: 0, kcal: 0 },
      source: "manual",
    };

    openMacroProductModal(
      draft,
      macroModalState.meal || "breakfast",
      Number(qty.value) || 100,
      null,
      {
        ingredientTarget: {
          recipeId: String($recipeId?.value || ""),
          ingredientId: row.dataset.id,
        },
      }
    );
  });

  renderIngredientLinkState();
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
        const label = row.querySelector(".ingredient-label")?.value.trim() || "";
        const notes = row.querySelector(".ingredient-notes")?.value.trim() || "";
        const qtyRaw = row.querySelector(".ingredient-qty")?.value;
        const unit = row.querySelector(".ingredient-unit")?.value || "";
        const qty = normalizeIngredientQty(qtyRaw);
        const text = [qty ? String(qty) : "", unit, label].filter(Boolean).join(" ").trim() || label;
        const parsed = splitIngredientText(text);
        const productId = String(row.dataset.productId || "").trim();
        const product = nutritionProducts.find((p) => p.id === productId) || fuzzyMatchByName(label, nutritionProducts, (p) => p?.name || "") || null;
        const financeMatch = String(row.dataset.financeProductId || "").trim() || String(fuzzyMatchByName(label, financeProducts, (f) => f?.name || "")?.id || "");
        const baseIngredient = {
          id: row.dataset.id || generateId(),
          text,
          label,
          qty: qty == null ? "" : qty,
          unit: normalizeCostUnit(unit) || String(unit || "").trim(),
          notes,
          quantity: parsed.quantity,
          name: label || parsed.name || text,
          productId,
          linkedFinanceProductId: financeMatch,
          done: false,
        };
        return autoLinkIngredientFacets(buildRecipeIngredientFromProduct(product, baseIngredient));
      })
      .filter((ing) => ing.text || ing.productId || ing.linkedFinanceProductId);
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

    const structuredTotals = calculateRecipeTotals(recipe);
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
        const perServing = cost.perServing == null ? "" : ` · ${formatCurrency(cost.perServing)}/ración`;
        items.push({ label: "Coste estimado", value: `~${formatCurrency(cost.total)}${perServing} (${cost.covered}/${cost.totalIngredients || 0} ing.)` });
      }
      if (structuredTotals.ingredientsTotal > 0) {
        items.push({ label: "Calculables", value: `kcal ${structuredTotals.calculableNutrition}/${structuredTotals.ingredientsTotal} · coste ${structuredTotals.calculableCost}/${structuredTotals.ingredientsTotal}` });
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
        { label: "Por ración", value: `${roundMacro(recipe.nutritionPerServing?.kcal || 0)} kcal · ${formatCurrency(structuredTotals.perServing.cost)}` },
        { label: "Coste total", value: formatCurrency(structuredTotals.totalCost) },
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
            const ingredientQty = normalizeIngredientQty(ing.qty);
            const ingredientUnit = normalizeCostUnit(ing.unit || "");
            const grams = ingredientQty && ingredientUnit ? (normalizeQtyByUnit(ingredientQty, ingredientUnit, "g") ?? ingredientQty) : 100;
            openMacroProductModal(draft, "breakfast", grams, null, { ingredientTarget: { recipeId: recipe.id, ingredientId: ing.id } });
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
    renderRecipeLibraryViews();
  });

  $shelfSearch?.addEventListener("input", (e) => {
    filterState.shelfQuery = e.target.value || "";
    renderRecipeLibraryViews();
  });

  $recipesViewToggle?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-recipes-view]");
    if (!btn) return;
    const mode = String(btn.dataset.recipesView || "");
    if (!allowedRecipeViews.has(mode) || mode === recipesViewMode) return;
    recipesViewMode = mode;
    persistRecipeViewMode(mode);
    renderRecipeLibraryViews();
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
    renderRecipeLibraryViews();
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
      const name = String(i.name || "").trim();
      const unitToken = String(i.unit || "").trim();
      const qtyToken = String(i.amount || "").trim();
      const qty = normalizeIngredientQty(qtyToken);
      const candidate = autoLinkIngredientFacets({
        id: generateId(),
        name,
        label: name,
        qty: qty == null ? "" : qty,
        unit: qty == null ? unitToken : normalizeCostUnit(unitToken) || unitToken,
        notes: String(i.note || "").trim(),
        text: [qtyToken, unitToken, name].filter(Boolean).join(" ").trim(),
      });
      return candidate;
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
  $recipeAddIngredient?.addEventListener("click", () => {
    $recipeIngredientsList?.appendChild(buildIngredientRow());
    updateRecipeCalcSummary();
  });
  $recipeAddStep?.addEventListener("click", () => $recipeStepsList?.appendChild(buildStepRow()));
  $recipeIngredientAddProduct?.addEventListener("click", () => {
    const productId = String($recipeIngredientProduct?.value || "").trim();
    if (!productId) return;
    const product = nutritionProducts.find((p) => p.id === productId);
    if (!product) return;
    const grams = Math.max(0, Number($recipeIngredientGrams?.value) || 0) || 100;
    const label = `${product.name}${product.brand ? ` (${product.brand})` : ""} ${Math.round(grams)}g`;
    const recipeIngredient = buildRecipeIngredientFromProduct(product, { id: generateId(), text: label, label: product.name || label, qty: grams, unit: "g", productId, done: false });
    $recipeIngredientsList?.appendChild(buildIngredientRow(recipeIngredient));

    if ($recipeIngredientProduct) $recipeIngredientProduct.value = "";
    if ($recipeIngredientGrams) $recipeIngredientGrams.value = "100";
    updateRecipeCalcSummary();
  });
  $recipeServings?.addEventListener("input", updateRecipeCalcSummary);
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
            entryId: ensureMacroEntryId(entry),
            type: entry?.type === "recipe" ? "recipe" : "product",
            mealSlot: meal,
            refId: entry?.refId || "",
            productId: String(entry?.productId || entry?.refId || "").trim(),
            productName: String(entry?.productName || entry?.nameSnapshot || "").trim(),
            nameSnapshot: String(entry?.nameSnapshot || "").trim(),
            grams: Math.max(0, Number(entry?.grams) || 0),
            amount: Math.max(0, Number(entry?.amount) || Number(entry?.grams) || 0),
            unit: normalizeUnit(entry?.unit || "g") || "g",
            amountUnit: normalizeUnit(entry?.amountUnit || entry?.unit || "g") || "g",
            servings: Math.max(0, Number(entry?.servings) || 0),
            servingsCount: normalizeEntryServingsCount(entry?.servingsCount),
            macrosSnapshot: normalizeMacros(entry?.macrosSnapshot || {}),
            nutritionSnapshot: entry?.nutritionSnapshot && typeof entry.nutritionSnapshot === "object"
              ? {
                productId: String(entry.nutritionSnapshot.productId || entry?.refId || "").trim(),
                servingBaseQty: Math.max(1, Number(entry.nutritionSnapshot.servingBaseQty) || 100),
                servingBaseUnit: normalizeUnit(entry.nutritionSnapshot.servingBaseUnit || "g") || "g",
                macrosPerBase: normalizeMacros(entry.nutritionSnapshot.macrosPerBase || {}),
              }
              : null,
            pricingSnapshot: entry?.pricingSnapshot && typeof entry.pricingSnapshot === "object"
              ? {
                productId: String(entry.pricingSnapshot.productId || entry?.refId || "").trim(),
                linkedFinanceProductId: String(entry.pricingSnapshot.linkedFinanceProductId || "").trim(),
                priceSource: entry.pricingSnapshot.priceSource || null,
                price: Number(entry.pricingSnapshot.price) > 0 ? Number(entry.pricingSnapshot.price) : null,
                baseQty: Number(entry.pricingSnapshot.baseQty) > 0 ? Number(entry.pricingSnapshot.baseQty) : null,
                baseUnit: normalizeCostUnit(entry.pricingSnapshot.baseUnit || ""),
                computedCost: Number(entry.pricingSnapshot.computedCost) >= 0 ? Number(entry.pricingSnapshot.computedCost) : null,
              }
              : null,
            linkedFinanceProductId: String(entry?.linkedFinanceProductId || entry?.pricingSnapshot?.linkedFinanceProductId || "").trim(),
            linkedHabitId: String(entry?.linkedHabitId || entry?.habitSync?.habitId || "").trim(),
            priceSource: entry?.priceSource || entry?.pricingSnapshot?.priceSource || null,
            costSource: entry?.costSource || null,
            computedCost: Number(entry?.computedCost) >= 0 ? Number(entry.computedCost) : null,
            detectedUnitType: String(entry?.detectedUnitType || "").trim() || null,
            habitSync: {
              habitId: String(entry?.habitSync?.habitId || "").trim(),
              amount: Math.max(0, Number(entry?.habitSync?.amount) || 0),
            },
            recipeSnapshot: entry?.recipeSnapshot && typeof entry.recipeSnapshot === "object"
              ? normalizeRecipeFields(entry.recipeSnapshot)
              : null,
            ingredientsSnapshot: Array.isArray(entry?.ingredientsSnapshot)
              ? entry.ingredientsSnapshot.map((ing) => buildRecipeIngredientFromProduct(getIngredientLinkedProduct(ing), ing))
              : [],
            expanded: !!entry?.expanded,
            sideEffects: {
              habits: Array.isArray(entry?.sideEffects?.habits) ? entry.sideEffects.habits.map((h) => ({
                habitId: String(h?.habitId || "").trim(),
                amount: Math.max(0, Number(h?.amount) || 0),
              })).filter((h) => h.habitId && h.amount) : [],
              financeCost: Math.max(0, Number(entry?.sideEffects?.financeCost ?? entry?.computedCost) || 0),
              productsResolved: Math.max(0, Number(entry?.sideEffects?.productsResolved) || 0),
              productsTotal: Math.max(0, Number(entry?.sideEffects?.productsTotal) || 0),
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
    const normalizedBaseUnit = normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g";
    const normalizedBaseQuantity = Math.max(1, Number(product.baseQuantity || product.servingBaseGrams) || 100);
    const pkg = resolveProductPackageSpec(product);
    return {
      ...product,
      id: String(product.id || generateId()).trim(),
      name: String(product.name || "").trim(),
      brand: String(product.brand || "").trim(),
      barcode: String(product.barcode || "").trim(),
      baseQuantity: normalizedBaseQuantity,
      baseUnit: normalizedBaseUnit,
      servingBaseGrams: normalizedBaseQuantity,
      servingBaseUnit: normalizedBaseUnit,
      macros: normalizeMacros(product.macros),
      financeProductId: String(product.financeProductId || "").trim(),
      linkedHabitId: String(product.linkedHabitId || "").trim(),
      packageAmount: pkg.amount,
      packageUnit: pkg.unit,
      price: Number(product.price) > 0 ? Number(product.price) : null,
      priceBaseQty: pkg.amount,
      priceBaseUnit: pkg.unit,
    };
  }


  function normalizeIntegrationConfig(raw = {}) {
    const linkedWorkHabitIds = Array.isArray(raw?.linkedWorkHabitIds)
      ? raw.linkedWorkHabitIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    const workCaloriesPerMatchedDay = Math.max(0, Number(raw?.workCaloriesPerMatchedDay) || defaultIntegrationConfig.workCaloriesPerMatchedDay);
    const bodyWeightKg = Number(raw?.bodyWeightKg);
    return {
      linkedWorkHabitIds: Array.from(new Set(linkedWorkHabitIds)),
      workCaloriesPerMatchedDay,
      bodyWeightKg: Number.isFinite(bodyWeightKg) && bodyWeightKg > 0 ? bodyWeightKg : null,
    };
  }

  function clamp01(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    if (n <= 0) return 0;
    if (n >= 1) return 1;
    return n;
  }

  function normalizeMacroTargets(raw = {}) {
    const kcalTarget = Math.max(0, Number(raw?.kcalTarget ?? raw?.kcal) || defaultMacroTargets.kcalTarget);
    let carbs_g = Math.max(0, Number(raw?.carbs_g ?? raw?.carbs) || 0);
    let protein_g = Math.max(0, Number(raw?.protein_g ?? raw?.protein) || 0);
    let fat_g = Math.max(0, Number(raw?.fat_g ?? raw?.fat) || 0);

    let carbs_pct = Number(raw?.carbs_pct);
    let protein_pct = Number(raw?.protein_pct);
    let fat_pct = Number(raw?.fat_pct);
    const pctDefined = Number.isFinite(carbs_pct) && Number.isFinite(protein_pct) && Number.isFinite(fat_pct);

    if (pctDefined) {
      const total = carbs_pct + protein_pct + fat_pct;
      if (total > 0) {
        carbs_pct = carbs_pct / total;
        protein_pct = protein_pct / total;
        fat_pct = fat_pct / total;
      } else {
        carbs_pct = 0;
        protein_pct = 0;
        fat_pct = 0;
      }
      carbs_g = kcalTarget > 0 ? (kcalTarget * carbs_pct) / 4 : 0;
      protein_g = kcalTarget > 0 ? (kcalTarget * protein_pct) / 4 : 0;
      fat_g = kcalTarget > 0 ? (kcalTarget * fat_pct) / 9 : 0;
    } else {
      const carbsKcal = carbs_g * 4;
      const proteinKcal = protein_g * 4;
      const fatKcal = fat_g * 9;
      if (kcalTarget > 0) {
        carbs_pct = carbsKcal / kcalTarget;
        protein_pct = proteinKcal / kcalTarget;
        fat_pct = fatKcal / kcalTarget;
      } else {
        carbs_pct = 0;
        protein_pct = 0;
        fat_pct = 0;
      }
      const pctTotal = carbs_pct + protein_pct + fat_pct;
      if (pctTotal > 0) {
        carbs_pct /= pctTotal;
        protein_pct /= pctTotal;
        fat_pct /= pctTotal;
      }
    }

    return {
      kcalTarget,
      carbs_g,
      protein_g,
      fat_g,
      carbs_pct: clamp01(carbs_pct),
      protein_pct: clamp01(protein_pct),
      fat_pct: clamp01(fat_pct),
    };
  }

  function setMacroTargetsFromPercentages(patch = {}) {
    const merged = {
      ...macroTargets,
      carbs_pct: patch.carbs_pct ?? macroTargets.carbs_pct,
      protein_pct: patch.protein_pct ?? macroTargets.protein_pct,
      fat_pct: patch.fat_pct ?? macroTargets.fat_pct,
      kcalTarget: patch.kcalTarget ?? macroTargets.kcalTarget,
    };
    macroTargets = normalizeMacroTargets(merged);
  }

  function setMacroTargetsFromGrams(patch = {}) {
    const merged = {
      ...macroTargets,
      carbs_g: patch.carbs_g ?? macroTargets.carbs_g,
      protein_g: patch.protein_g ?? macroTargets.protein_g,
      fat_g: patch.fat_g ?? macroTargets.fat_g,
      kcalTarget: patch.kcalTarget ?? macroTargets.kcalTarget,
    };
    macroTargets = normalizeMacroTargets(merged);
  }

  function loadNutritionCache() {
    try {
      const raw = localStorage.getItem(`${getStorageKey()}.nutrition`);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      nutritionProducts = Array.isArray(parsed.products) ? parsed.products.map(normalizeNutritionProductEntry).filter((p) => p.name) : [];
      dailyLogsByDate = normalizeDailyLogs(parsed.dailyLogsByDate && typeof parsed.dailyLogsByDate === "object" ? parsed.dailyLogsByDate : {});
      macroTargets = normalizeMacroTargets(parsed.macroTargets || parsed.goals || {});
      nutritionIntegrationConfig = normalizeIntegrationConfig(parsed.integrationConfig || {});
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
        macroTargets,
        integrationConfig: nutritionIntegrationConfig,
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
        const remoteMacroTargets = normalizeMacroTargets(data.macroTargets || data.goals || {});
        const remoteIntegrationConfig = normalizeIntegrationConfig(data.integrationConfig || {});
        nutritionSyncMeta = {
          version: Number(data?.syncMeta?.version) || 2,
          migratedAt: Number(data?.syncMeta?.migratedAt) || nutritionSyncMeta.migratedAt || Date.now(),
          updatedAt: Number(data?.syncMeta?.updatedAt) || Number(data?.updatedAt) || Date.now(),
        };

        const hasRemoteData = remoteProducts.length || Object.keys(remoteLogs).length || Object.keys(data?.macroTargets || data?.goals || {}).length;
        if (!hasRemoteData) {
          const hasLocalData = nutritionProducts.length || Object.keys(dailyLogsByDate || {}).length;
          if (hasLocalData) {
            persistNutrition();
            return;
          }
        }

        nutritionProducts = remoteProducts;
        dailyLogsByDate = remoteLogs;
        macroTargets = remoteMacroTargets;
        nutritionIntegrationConfig = remoteIntegrationConfig;
        cacheNutrition();
        recalcAllRecipesNutrition();
        refreshUI();
        if ($modalBackdrop && !$modalBackdrop.classList.contains("hidden")) renderRecipeIngredientProductPicker();
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
      macroTargets,
      integrationConfig: nutritionIntegrationConfig,
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
    if ($recipesPanelShopping?.classList.contains("is-active")) renderShoppingView();
  }

  function recalcRecipeNutrition(recipe) {
    const recalculated = recalculateRecipeDerivedData(recipe || {});
    return {
      totals: normalizeMacros(recalculated.nutritionTotals || {}),
      perServing: normalizeMacros(recalculated.nutritionPerServing || {}),
    };
  }

  function recalcAllRecipesNutrition() {
    recipes = recipes.map((r) => normalizeRecipeFields(recalculateRecipeDerivedData(r)));
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
    return entries.reduce((acc, e) => plusMacros(acc, getEntryMacrosTotal(e)), normalizeMacros({}));
  }

  function computeMealCostSummary(entries = []) {
    return entries.reduce((acc, entry) => {
      const res = calculateEntryFoodCost(entry);
      if (res.cost == null) acc.missing += Number(res.missing) || 0;
      else acc.total += Number(res.cost) || 0;
      return acc;
    }, { total: 0, missing: 0 });
  }

  function computeDailyCostSummary(date = selectedMacroDate) {
    const log = getDailyLog(date);
    return mealOrder.reduce((acc, meal) => {
      const sum = computeMealCostSummary(log?.meals?.[meal]?.entries || []);
      acc.total += sum.total;
      acc.missing += sum.missing;
      return acc;
    }, { total: 0, missing: 0 });
  }

  function computeDailyTotals(date = selectedMacroDate) {
    const log = getDailyLog(date);
    return mealOrder.reduce((acc, meal) => plusMacros(acc, computeMealTotals(log.meals[meal].entries)), normalizeMacros({}));
  }


  function getExerciseMetValue(exerciseLog = {}, exerciseDef = null) {
    const explicit = getMetCategoryById(exerciseLog?.metCategoryIdSnapshot || exerciseLog?.metCategoryId || exerciseDef?.metCategoryId);
    return Number(explicit?.metValue) > 0 ? Number(explicit.metValue) : null;
  }

  function getExerciseDurationMs(exerciseLog = {}) {
    const sets = Array.isArray(exerciseLog?.sets) ? exerciseLog.sets : [];
    const stamps = sets
      .map((set) => Number(set?.updatedAt || set?.createdAt || 0))
      .filter((ts) => Number.isFinite(ts) && ts > 0)
      .sort((a, b) => a - b);
    if (stamps.length < 2) return 0;
    return Math.max(0, stamps[stamps.length - 1] - stamps[0]);
  }

  function calculateExerciseCaloriesBurned(exerciseLog, metValue, bodyWeightKg) {
    const met = Number(metValue);
    const weight = Number(bodyWeightKg);
    if (!(met > 0) || !(weight > 0)) return 0;
    const durationMs = getExerciseDurationMs(exerciseLog);
    if (!(durationMs > 0)) return 0;
    const durationHours = durationMs / (1000 * 60 * 60);
    return met * weight * durationHours;
  }

  function getWorkCaloriesBurnedForDate(dateKey) {
    const linkedIds = Array.isArray(nutritionIntegrationConfig?.linkedWorkHabitIds)
      ? nutritionIntegrationConfig.linkedWorkHabitIds
      : [];
    if (!linkedIds.length) return 0;
    const matched = linkedIds.some((habitId) => !!window.__bookshellHabits?.isHabitCompletedOnDateById?.(habitId, dateKey));
    if (!matched) return 0;
    return Math.max(0, Number(nutritionIntegrationConfig?.workCaloriesPerMatchedDay) || 0);
  }

  function getBodyWeightForDate(dateKey) {
    const byGym = Number(window.__bookshellGym?.getBodyWeightKgForDate?.(dateKey));
    if (Number.isFinite(byGym) && byGym > 0) return byGym;
    const configured = Number(nutritionIntegrationConfig?.bodyWeightKg);
    if (Number.isFinite(configured) && configured > 0) return configured;
    const latestGym = Number(window.__bookshellGym?.getLatestBodyWeightKg?.());
    if (Number.isFinite(latestGym) && latestGym > 0) return latestGym;
    return null;
  }

  function getGymCaloriesBurnedForDate(dateKey) {
    const bodyWeightKg = getBodyWeightForDate(dateKey);
    if (!(bodyWeightKg > 0)) return 0;
    const workoutsByDate = window.__bookshellGym?.getWorkoutsByDate?.() || {};
    const exercisesCatalog = window.__bookshellGym?.getExercisesCatalog?.() || {};
    const workouts = Object.values(workoutsByDate?.[dateKey] || {});
    return workouts.reduce((dayAcc, workout) => {
      const exerciseEntries = Object.entries(workout?.exercises || {});
      const workoutBurned = exerciseEntries.reduce((acc, [exerciseId, exerciseLog]) => {
        const metValue = getExerciseMetValue(exerciseLog, exercisesCatalog?.[exerciseId] || null);
        if (!(metValue > 0)) return acc;
        return acc + calculateExerciseCaloriesBurned(exerciseLog, metValue, bodyWeightKg);
      }, 0);
      return dayAcc + workoutBurned;
    }, 0);
  }

  function getTotalCaloriesBurnedForDate(dateKey) {
    return getWorkCaloriesBurnedForDate(dateKey) + getGymCaloriesBurnedForDate(dateKey);
  }

  function getNetCaloriesForDate(dateKey) {
    const consumed = Number(computeDailyTotals(dateKey).kcal) || 0;
    return consumed - getTotalCaloriesBurnedForDate(dateKey);
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
    let maxCostDay = { date: null, cost: 0 };
    let maxBurnedDay = { date: null, kcal: 0 };
    let totalCost = 0;
    let totalBurned = 0;
    let totalWorkBurned = 0;
    let totalGymBurned = 0;
    let totalMissingPrice = 0;
    const mealKcal = { breakfast: 0, lunch: 0, dinner: 0, snacks: 0 };

    dates.forEach((date) => {
      const log = getDailyLog(date);
      const dayTotals = computeDailyTotals(date);
      const dayCost = computeDailyCostSummary(date);
      const workBurned = getWorkCaloriesBurnedForDate(date);
      const gymBurned = getGymCaloriesBurnedForDate(date);
      const burned = workBurned + gymBurned;
      const netKcal = dayTotals.kcal - burned;
      daySeries.push({ date, totals: dayTotals, cost: Number(dayCost.total) || 0, missingPrice: Number(dayCost.missing) || 0, burned, netKcal, workBurned, gymBurned });
      totals = plusMacros(totals, dayTotals);
      totalCost += Number(dayCost.total) || 0;
      totalBurned += burned;
      totalWorkBurned += workBurned;
      totalGymBurned += gymBurned;
      totalMissingPrice += Number(dayCost.missing) || 0;
      if (dayTotals.kcal > maxDay.kcal) maxDay = { date, kcal: dayTotals.kcal };
      if ((Number(dayCost.total) || 0) > maxCostDay.cost) maxCostDay = { date, cost: Number(dayCost.total) || 0 };
      if (burned > maxBurnedDay.kcal) maxBurnedDay = { date, kcal: burned };
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
            amount: 0,
            amountUnit: "",
            macros: normalizeMacros({}),
          };
          const servingsCount = getEntryServingsCount(entry);
          prev.count += servingsCount;
          prev.grams += (Number(entry.grams) || 0) * servingsCount;
          prev.servings += (Number(entry.servings) || 0) * servingsCount;
          if ((Number(entry.amount) || 0) > 0 && normalizeUnit(entry.unit)) {
            if (!prev.amountUnit) prev.amountUnit = normalizeUnit(entry.unit);
            if (prev.amountUnit === normalizeUnit(entry.unit)) prev.amount += (Number(entry.amount) || 0) * servingsCount;
          } else if ((Number(entry.grams) || 0) > 0) {
            if (!prev.amountUnit) prev.amountUnit = "g";
            if (prev.amountUnit === "g") prev.amount += (Number(entry.grams) || 0) * servingsCount;
          }
          prev.macros = plusMacros(prev.macros, getEntryMacrosTotal(entry));
          target.set(key, prev);
          if (entry.type === "recipe") recipeCount += servingsCount;
        });
      });
    });

    const avg = {
      carbs: totals.carbs / Math.max(1, dates.length),
      protein: totals.protein / Math.max(1, dates.length),
      fat: totals.fat / Math.max(1, dates.length),
      kcal: totals.kcal / Math.max(1, dates.length),
      cost: totalCost / Math.max(1, dates.length),
      burned: totalBurned / Math.max(1, dates.length),
      netKcal: (totals.kcal - totalBurned) / Math.max(1, dates.length),
    };

    const topRecipes = Array.from(byRecipe.values()).sort((a, b) => b.count - a.count || b.macros.kcal - a.macros.kcal).slice(0, 8);
    const topProducts = Array.from(byProduct.values()).sort((a, b) => b.count - a.count || b.macros.kcal - a.macros.kcal).slice(0, 8);

    return { dates, daySeries, totals, avg, mealCount, recipeCount, topRecipes, topProducts, maxDay, maxCostDay, maxBurnedDay, mealKcal, totalCost, totalBurned, totalWorkBurned, totalGymBurned, totalMissingPrice };
  }

  function renderSimpleDonut(host, segments = [], options = {}) {
    if (!host) return;
    const total = segments.reduce((acc, s) => acc + Math.max(0, Number(s.value) || 0), 0);
    const valueFormatter = options.valueFormatter || ((value) => roundMacro(value));
    const subtitle = options.subtitle || "total";
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
    const centerValue = valueFormatter(total);
    host.innerHTML = `<circle cx="60" cy="60" r="44" fill="none" stroke="rgba(255,255,255,.12)" stroke-width="14"></circle>${arcs}<text x="60" y="58" text-anchor="middle" fill="#fff" font-size="14" font-weight="700">${centerValue}</text><text x="60" y="72" text-anchor="middle" fill="rgba(255,255,255,.65)" font-size="9">${subtitle}</text>`;
  }

  function renderStatisticsView() {
    if (!$recipesPanelStatistics || !$macroStatsKpis) return;
    const summary = summarizeStatistics();
    const metricLabelMap = { macros: "Macros", kcal: "Calorías", cost: "Coste", burned: "Quemadas", net: "Netas", carbs: "Carbohidratos", protein: "Proteínas", fat: "Grasas" };

    if ($macroStatsAnchor) $macroStatsAnchor.value = macroStatsState.anchorDate;
    $macroStatsPeriods?.querySelectorAll("[data-stats-period]").forEach((btn) => {
      btn.classList.toggle("is-active", btn.dataset.statsPeriod === macroStatsState.period);
    });
    if ($macroStatsMainMetric) $macroStatsMainMetric.value = macroStatsState.metric;
    if ($macroStatsMainLabel) $macroStatsMainLabel.textContent = `${metricLabelMap[macroStatsState.metric] || "Métrica"} · ${summary.dates[0] || "-"} → ${summary.dates[summary.dates.length - 1] || "-"}`;

    const primaryKpis = [
      ["Gasto total", formatCurrency(summary.totalCost), "primary"],
      ["Media €/día", formatCurrency(summary.avg.cost), "primary"],
      ["Día de mayor gasto", summary.maxCostDay.date ? `${summary.maxCostDay.date} · ${formatCurrency(summary.maxCostDay.cost)}` : "—", "primary"],
      ["Elementos sin precio", `${summary.totalMissingPrice}`, "primary"],
    ];
    const secondaryKpis = [
      ["Kcal ingeridas", `${roundMacro(summary.totals.kcal)} kcal`],
      ["Kcal quemadas", `${roundMacro(summary.totalBurned)} kcal`],
      ["Media neta/día", `${roundMacro(summary.avg.netKcal)} kcal`],
      ["Trabajo (total)", `${roundMacro(summary.totalWorkBurned)} kcal`],
      ["Gym (total)", `${roundMacro(summary.totalGymBurned)} kcal`],
      ["Día mayor gasto", `${summary.maxBurnedDay.date || "—"} (${roundMacro(summary.maxBurnedDay.kcal)} kcal)`],
    ];
    $macroStatsKpis.innerHTML = `
      <div class="macro-stats-kpi-primary-wrap">${primaryKpis.map(([k, v, cls]) => `<article class="macro-stats-kpi ${cls || ""}"><div class="macro-stats-kpi-label">${k}</div><div class="macro-stats-kpi-value">${v}</div></article>`).join("")}</div>
      <div class="macro-stats-kpi-chips">${secondaryKpis.map(([k, v]) => `<article class="macro-stats-kpi-chip"><span>${k}</span><strong>${v}</strong></article>`).join("")}</div>
    `;

    if ($macroStatsMainChart) {
      const w = 760, h = 260, pad = { l: 20, r: 20, t: 18, b: 18 };
      const points = summary.daySeries;
      const getPointValue = (point, key) => {
        if (key === "cost") return Number(point.cost) || 0;
        if (key === "burned") return Number(point.burned) || 0;
        if (key === "net") return Number(point.netKcal) || 0;
        return Number(point.totals?.[key]) || 0;
      };
      const series = macroStatsState.metric === "macros"
        ? [
            { key: "carbs", color: macroPalette.carbs, name: "Carbs", formatter: (v) => `${roundMacro(v)} g` },
            { key: "protein", color: macroPalette.protein, name: "Proteínas", formatter: (v) => `${roundMacro(v)} g` },
            { key: "fat", color: macroPalette.fat, name: "Grasas", formatter: (v) => `${roundMacro(v)} g` },
          ]
        : [{ key: macroStatsState.metric, color: macroPalette[macroStatsState.metric] || "#f5e6a6", name: metricLabelMap[macroStatsState.metric] || "Métrica", formatter: macroStatsState.metric === "cost" ? (v) => formatCurrency(v) : (v) => `${roundMacro(v)}${["kcal","burned","net"].includes(macroStatsState.metric) ? " kcal" : " g"}` }];

      const maxVal = Math.max(1, ...points.flatMap((p) => series.map((seriesItem) => getPointValue(p, seriesItem.key))));
      const xStep = (w - pad.l - pad.r) / Math.max(1, points.length - 1);
      const yPos = (v) => h - pad.b - (Math.max(0, v) / maxVal) * (h - pad.t - pad.b);
      const toPoint = (idx, val) => ({ x: pad.l + idx * xStep, y: yPos(val) });
      const smoothPath = (pts) => {
        if (pts.length < 2) return "";
        return pts.map((p, i) => {
          if (i === 0) return `M${p.x},${p.y}`;
          const prev = pts[i - 1];
          const cpx = (prev.x + p.x) / 2;
          return `C${cpx},${prev.y} ${cpx},${p.y} ${p.x},${p.y}`;
        }).join(" ");
      };

      const lines = series.map((s, idx) => {
        const pts = points.map((p, i) => toPoint(i, getPointValue(p, s.key)));
        const path = smoothPath(pts);
        return `<g data-series-index="${idx}"><path d="${path}" fill="none" stroke="${s.color}" stroke-width="6" opacity=".18" stroke-linecap="round"></path><path d="${path}" fill="none" stroke="${s.color}" stroke-width="2.8" stroke-linecap="round"></path><circle class="macro-stats-active-dot hidden" data-series-dot="${idx}" cx="0" cy="0" r="5" fill="${s.color}" stroke="rgba(11,12,20,.95)" stroke-width="2.2"></circle></g>`;
      }).join("");

      const grid = [0.25, 0.5, 0.75].map((r) => {
        const y = h - pad.b - (h - pad.t - pad.b) * r;
        return `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="rgba(255,255,255,.06)" />`;
      }).join("");
      const legend = series.map((s, i) => `<button class="macro-stats-legend-chip" type="button" data-macro-series="${i}"><i style="background:${s.color}"></i>${s.name}</button>`).join("");
      $macroStatsMainChart.innerHTML = `<rect x="0" y="0" width="${w}" height="${h}" fill="transparent"></rect>${grid}${lines}`;
      if ($macroStatsDonutMode) {
        const legendHost = $macroStatsMainChart.closest('.macro-stats-main-chart-card')?.querySelector('.macro-stats-chart-legend');
        if (legendHost) legendHost.innerHTML = legend;
      }

      const activatePoint = (idx) => {
        if (!Number.isFinite(idx)) return;
        const point = points[Math.max(0, Math.min(points.length - 1, idx))];
        if (!point) return;
        series.forEach((s, sIdx) => {
          const dot = $macroStatsMainChart.querySelector(`[data-series-dot="${sIdx}"]`);
          if (!dot) return;
          const pos = toPoint(Math.max(0, Math.min(points.length - 1, idx)), getPointValue(point, s.key));
          dot.setAttribute("cx", String(pos.x));
          dot.setAttribute("cy", String(pos.y));
          dot.classList.remove("hidden");
        });
        const rows = series.map((s) => {
          const raw = getPointValue(point, s.key);
          return `<div><span style="color:${s.color}">●</span> ${s.name}: <strong>${s.formatter(raw)}</strong></div>`;
        }).join("");
        $macroStatsMainTooltip.innerHTML = `<div class="macro-stats-tooltip-date">${point.date}</div>${rows}`;
        $macroStatsMainTooltip.classList.remove('hidden');
      };

      const resolveSvgX = (clientX, clientY) => {
        const svg = $macroStatsMainChart;
        if (!svg) return null;
        const ctm = svg.getScreenCTM?.();
        if (!ctm) return null;
        const point = svg.createSVGPoint();
        point.x = Number(clientX) || 0;
        point.y = Number(clientY) || 0;
        const local = point.matrixTransform(ctm.inverse());
        return Number(local.x);
      };
      const activateFromPointer = (clientX, clientY) => {
        if (!$macroStatsMainTooltip || !points.length) return;
        const x = resolveSvgX(clientX, clientY);
        if (!Number.isFinite(x)) return;
        const relX = x - pad.l;
        const idx = Math.max(0, Math.min(points.length - 1, Math.round(relX / Math.max(1, xStep))));
        activatePoint(idx);
      };

      $macroStatsMainChart.onpointerdown = (evt) => {
        activateFromPointer(evt.clientX, evt.clientY);
      };
      $macroStatsMainChart.onpointermove = (evt) => {
        activateFromPointer(evt.clientX, evt.clientY);
      };
      $macroStatsMainChart.ontouchstart = (evt) => {
        const touch = evt.touches?.[0];
        if (!touch) return;
        activateFromPointer(touch.clientX, touch.clientY);
      };
      $macroStatsMainChart.onmouseleave = () => {
        $macroStatsMainTooltip?.classList.add('hidden');
        $macroStatsMainChart.querySelectorAll('[data-series-dot]').forEach((dot) => dot.classList.add('hidden'));
      };
    }

    const donutConfigs = {
      "kcal-macros": {
        title: "Calorías por macro",
        subtitle: "kcal",
        valueFormatter: (v) => roundMacro(v),
        segments: [
          { label: "Carbohidratos", value: summary.totals.carbs * 4, color: macroPalette.carbs },
          { label: "Proteínas", value: summary.totals.protein * 4, color: macroPalette.protein },
          { label: "Grasas", value: summary.totals.fat * 9, color: macroPalette.fat },
        ],
      },
      "grams-macros": {
        title: "Gramos por macro",
        subtitle: "g",
        valueFormatter: (v) => roundMacro(v),
        segments: [
          { label: "Carbohidratos", value: summary.totals.carbs, color: macroPalette.carbs },
          { label: "Proteínas", value: summary.totals.protein, color: macroPalette.protein },
          { label: "Grasas", value: summary.totals.fat, color: macroPalette.fat },
        ],
      },
      "cost-meal": {
        title: "Coste por comida",
        subtitle: "€",
        valueFormatter: (v) => Number(v).toFixed(2),
        segments: mealOrder.map((meal, i) => ({ label: mealLabels[meal], value: summary.daySeries.reduce((acc, day) => {
          const log = getDailyLog(day.date);
          const mealCost = computeMealCostSummary(log?.meals?.[meal]?.entries || []);
          return acc + (Number(mealCost.total) || 0);
        }, 0), color: ["#6fddff", "#b79bff", "#f7b0ff", "#ffd166"][i] })),
      },
    };

    if (!donutConfigs[macroStatsState.donutMode] || donutConfigs[macroStatsState.donutMode].segments.every((s) => !(Number(s.value) > 0))) {
      macroStatsState.donutMode = "kcal-macros";
    }
    const donutCfg = donutConfigs[macroStatsState.donutMode];
    if ($macroStatsDonutTitle) $macroStatsDonutTitle.textContent = donutCfg.title;
    renderSimpleDonut($macroStatsDonutMain, donutCfg.segments, { valueFormatter: donutCfg.valueFormatter, subtitle: donutCfg.subtitle });
    const donutTotal = donutCfg.segments.reduce((acc, s) => acc + (Number(s.value) || 0), 0);
    if ($macroStatsDonutLegend) {
      $macroStatsDonutLegend.innerHTML = donutCfg.segments.filter((seg) => Number(seg.value) > 0).map((seg) => {
        const pct = donutTotal > 0 ? ((Number(seg.value) || 0) / donutTotal) * 100 : 0;
        return `<button class="macro-stats-donut-row" type="button"><i style="background:${seg.color}"></i><span>${seg.label}</span><strong>${donutCfg.valueFormatter(seg.value)}</strong><em>${roundMacro(pct)}%</em></button>`;
      }).join("") || '<div class="hint">Sin datos en este modo.</div>';
    }

    if ($macroStatsDonutMode) {
      const modes = [
        { key: "kcal-macros", label: "Calorías por macro" },
        { key: "grams-macros", label: "Gramos por macro" },
        { key: "cost-meal", label: "Coste por comida" },
      ];
      $macroStatsDonutMode.innerHTML = modes.map((mode) => {
        const disabled = donutConfigs[mode.key].segments.every((s) => !(Number(s.value) > 0));
        return `<button type="button" class="macro-stats-period ${macroStatsState.donutMode === mode.key ? "is-active" : ""}" data-donut-mode="${mode.key}" ${disabled ? "disabled" : ""}>${mode.label}</button>`;
      }).join("");
    }

    renderMacroTargetEditor();

    const row = (item) => `<div class="macro-stats-row"><strong class="macro-stats-row-name">${escapeHtml(item.name)}</strong><span class="macro-stats-row-summary">${item.count} ${item.count === 1 ? "vez" : "veces"} · ${getDisplayAmountForStats(item)} · ${roundMacro(item.macros?.kcal)} kcal · C ${roundMacro(item.macros?.carbs)} · P ${roundMacro(item.macros?.protein)} · G ${roundMacro(item.macros?.fat)}</span></div>`;
    if ($macroStatsTopRecipes) $macroStatsTopRecipes.innerHTML = summary.topRecipes.map(row).join("") || '<div class="hint">Sin recetas en el periodo.</div>';
    if ($macroStatsTopProducts) $macroStatsTopProducts.innerHTML = summary.topProducts.map(row).join("") || '<div class="hint">Sin productos en el periodo.</div>';
  }

  function buildMacroTargetDonutSegments() {
    return [
      { key: "carbs_pct", label: "Carbohidratos", color: macroPalette.carbs },
      { key: "protein_pct", label: "Proteínas", color: macroPalette.protein },
      { key: "fat_pct", label: "Grasas", color: macroPalette.fat },
    ].map((row) => ({ ...row, value: Math.max(0, Number(macroTargets[row.key]) || 0) * 100 }));
  }

  function renderMacroTargetEditor() {
    if (!$macroTargetEditor) return;
    const segments = buildMacroTargetDonutSegments();
    const totalPct = segments.reduce((acc, s) => acc + s.value, 0) || 1;
    const donutSvg = '<svg id="macro-target-donut" viewBox="0 0 120 120" class="macro-stats-donut"></svg>';
    const sliders = segments.map((seg) => {
      const pct = (Number(macroTargets[seg.key]) || 0) * 100;
      const gramsKey = seg.key.replace('_pct', '_g');
      const grams = Number(macroTargets[gramsKey]) || 0;
      return `<label class="macro-target-row" data-macro-pct-key="${seg.key}"><div class="macro-target-row-head"><strong style="color:${seg.color}">${seg.label}</strong><span>${roundMacro(pct)}% · ${roundMacro(grams)}g</span></div><input type="range" min="0" max="100" step="0.1" value="${pct}" data-macro-pct-input="${seg.key}" /></label>`;
    }).join('');
    $macroTargetEditor.innerHTML = `<div class="macro-target-editor-grid"><div class="macro-target-donut-wrap">${donutSvg}<div class="macro-target-kcal">${roundMacro(macroTargets.kcalTarget)} kcal</div></div><div class="macro-target-sliders">${sliders}</div></div>`;
    const donutHost = document.getElementById('macro-target-donut');
    renderSimpleDonut(donutHost, segments.map((s) => ({ label: s.label, value: s.value, color: s.color })), { valueFormatter: (v) => `${roundMacro(v)}%`, subtitle: 'reparto' });
    const inputs = $macroTargetEditor.querySelectorAll('input[data-macro-pct-input]');
    inputs.forEach((input) => {
      input.addEventListener('input', () => {
        const key = input.dataset.macroPctInput;
        const next = Math.max(0, Number(input.value) || 0) / 100;
        const draft = {
          carbs_pct: key === 'carbs_pct' ? next : macroTargets.carbs_pct,
          protein_pct: key === 'protein_pct' ? next : macroTargets.protein_pct,
          fat_pct: key === 'fat_pct' ? next : macroTargets.fat_pct,
        };
        const rest = Math.max(0, 1 - next);
        if (key === 'carbs_pct') {
          const other = Math.max(0, macroTargets.protein_pct) + Math.max(0, macroTargets.fat_pct);
          draft.protein_pct = other > 0 ? (macroTargets.protein_pct / other) * rest : rest / 2;
          draft.fat_pct = Math.max(0, rest - draft.protein_pct);
        } else if (key === 'protein_pct') {
          const other = Math.max(0, macroTargets.carbs_pct) + Math.max(0, macroTargets.fat_pct);
          draft.carbs_pct = other > 0 ? (macroTargets.carbs_pct / other) * rest : rest / 2;
          draft.fat_pct = Math.max(0, rest - draft.carbs_pct);
        } else {
          const other = Math.max(0, macroTargets.carbs_pct) + Math.max(0, macroTargets.protein_pct);
          draft.carbs_pct = other > 0 ? (macroTargets.carbs_pct / other) * rest : rest / 2;
          draft.protein_pct = Math.max(0, rest - draft.carbs_pct);
        }
        setMacroTargetsFromPercentages(draft);
        persistNutrition();
        renderMacroTargetEditor();
        renderMacrosView();
      });
    });
  }

  function buildProductConsumptionSeries(product, now = new Date()) {
    const packageAmount = Number(product?.packageAmount);
    const packageUnit = normalizeUnit(product?.packageUnit || '');
    if (!(packageAmount > 0) || !packageUnit) return null;
    const dates = [];
    for (let i = 29; i >= 0; i -= 1) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      dates.push(toISODate(d));
    }
    const byDate = new Map(dates.map((d) => [d, 0]));
    dates.forEach((date) => {
      const log = dailyLogsByDate?.[date];
      if (!log?.meals) return;
      mealOrder.forEach((meal) => {
        const entries = log.meals?.[meal]?.entries || [];
        entries.forEach((entry) => {
          if (entry.type === 'product' && String(entry.refId || '') === String(product.id || '')) {
            const qty = Number(entry.amount) || Number(entry.grams) || 0;
            const unit = normalizeUnit(entry.unit || entry.amountUnit || product.baseUnit || '');
            const converted = normalizeQtyByUnit(qty, unit, packageUnit);
            if (converted != null) byDate.set(date, (byDate.get(date) || 0) + Math.max(0, converted));
          }
          if (entry.type === 'recipe') {
            const ingredients = getRecipeIngredientsFromEntry(entry);
            const servings = Math.max(0, Number(entry.servings) || 0);
            ingredients.forEach((ing) => {
              if (String(ing?.productId || '') !== String(product.id || '')) return;
              const qty = Number(ing?.qty) || 0;
              const unit = normalizeUnit(ing?.unit || '');
              if (!(qty > 0) || !unit) return;
              const consumedIngredientQty = qty * servings;
              const converted = normalizeQtyByUnit(consumedIngredientQty, unit, packageUnit);
              if (converted != null) byDate.set(date, (byDate.get(date) || 0) + Math.max(0, converted));
            });
          }
        });
      });
    });
    const series = dates.map((date) => ({ date, amount: byDate.get(date) || 0 }));
    return { packageAmount, packageUnit, series };
  }

  function estimateProductShopping(product) {
    const built = buildProductConsumptionSeries(product);
    if (!built) return { status: 'insufficient', reason: 'package', product };
    const { packageAmount, packageUnit, series } = built;
    const totalConsumed30 = series.reduce((acc, row) => acc + row.amount, 0);
    const activeDays = series.filter((row) => row.amount > 0).length;
    const dailyMeanWindow = totalConsumed30 / 30;
    const dailyMeanActive = activeDays > 0 ? totalConsumed30 / activeDays : 0;
    let estimatedDailyUse = 0;
    let weak = false;
    if (activeDays >= 8) estimatedDailyUse = dailyMeanWindow * 0.7 + dailyMeanActive * 0.3;
    else if (activeDays >= 3) estimatedDailyUse = dailyMeanWindow * 0.85 + dailyMeanActive * 0.15;
    else {
      estimatedDailyUse = totalConsumed30 / 30;
      weak = true;
    }
    const last7 = series.slice(-7);
    const mean30 = dailyMeanWindow;
    const mean7 = last7.reduce((acc, row) => acc + row.amount, 0) / 7;
    const finalDailyUse = (mean30 > 0 && mean7 > 0) ? (mean30 * 0.7 + mean7 * 0.3) : estimatedDailyUse;
    if (!(finalDailyUse > 0)) return { status: 'insufficient', reason: 'history', product, packageAmount, packageUnit, activeDays, totalConsumed30 };
    const daysPerPackage = packageAmount / finalDailyUse;
    const nextRestockDays = Math.max(0, daysPerPackage - 1);
    return { status: weak ? 'weak' : 'ok', product, packageAmount, packageUnit, activeDays, totalConsumed30, dailyUse: finalDailyUse, daysPerPackage, nextRestockDays };
  }

  function getShoppingBucket(daysPerPackage, status) {
    if (status === 'insufficient') return 'Datos insuficientes';
    if (daysPerPackage <= 3) return 'Muy frecuente';
    if (daysPerPackage <= 10) return 'Semanal';
    if (daysPerPackage <= 20) return 'Quincenal';
    if (daysPerPackage <= 45) return 'Mensual';
    return 'Ocasional';
  }

  function renderShoppingView() {
    if (!$macroShoppingGroups) return;
    const estimates = nutritionProducts.map((product) => estimateProductShopping(product));
    const groups = new Map([
      ['Muy frecuente', []],
      ['Semanal', []],
      ['Quincenal', []],
      ['Mensual', []],
      ['Ocasional', []],
      ['Datos insuficientes', []],
    ]);
    estimates.forEach((est) => {
      const bucket = getShoppingBucket(est.daysPerPackage, est.status);
      groups.get(bucket)?.push(est);
    });
    const renderCard = (est) => {
      if (est.status === 'insufficient') {
        return `<article class="macro-shopping-card"><h5>${escapeHtml(est.product?.name || 'Producto')}</h5><p class="hint">Sin datos suficientes de paquete o consumo.</p></article>`;
      }
      return `<article class="macro-shopping-card"><h5>${escapeHtml(est.product?.name || 'Producto')}</h5><div class="macro-shopping-meta">${roundMacro(est.dailyUse)} ${est.packageUnit}/día · pack ${roundMacro(est.packageAmount)} ${est.packageUnit}</div><div class="macro-shopping-meta">Dura ~${roundMacro(est.daysPerPackage)} días · próxima reposición ~${roundMacro(est.nextRestockDays)} días${est.status === 'weak' ? ' · estimación débil' : ''}</div></article>`;
    };
    const order = ['Muy frecuente','Semanal','Quincenal','Mensual','Ocasional','Datos insuficientes'];
    $macroShoppingGroups.innerHTML = order.map((name) => {
      const rows = (groups.get(name) || []).sort((a,b) => (Number(a.daysPerPackage)||9999) - (Number(b.daysPerPackage)||9999));
      return `<section class="macro-shopping-group"><h5>${name}</h5><div class="macro-shopping-list">${rows.map(renderCard).join('') || '<div class="hint">Sin productos</div>'}</div></section>`;
    }).join('');
  }

  function switchRecipesPanel(panel = "library") {
    const isLibrary = panel === "library";
    const isMacros = panel === "macros";
    const isStatistics = panel === "statistics";
    const isShopping = panel === "shopping";
    $recipesPanelLibrary?.classList.toggle("is-active", isLibrary);
    $recipesPanelMacros?.classList.toggle("is-active", isMacros);
    $recipesPanelStatistics?.classList.toggle("is-active", isStatistics);
    $recipesPanelShopping?.classList.toggle("is-active", isShopping);
    $recipesSubtabs.forEach((btn) => {
      const active = btn.dataset.recipesPanel === panel;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    if (isMacros) renderMacrosView();
    if (isStatistics) renderStatisticsView();
    if (isShopping) renderShoppingView();
  }

  function renderMacrosView() {
    if (!$recipesPanelMacros || !$macroSummaryGrid || !$macroMeals) return;
    const log = getDailyLog(selectedMacroDate);
    if (macroSelectionState.meal) {
      const mealEntries = log?.meals?.[macroSelectionState.meal]?.entries || [];
      const validIds = new Set(mealEntries.map((entry) => ensureMacroEntryId(entry)));
      macroSelectionState.selectedIds = new Set(Array.from(macroSelectionState.selectedIds).filter((id) => validIds.has(id)));
      if (!macroSelectionState.selectedIds.size) clearMacroSelection(macroSelectionState.meal);
    }
    const totals = computeDailyTotals(selectedMacroDate);
    const dayCost = computeDailyCostSummary(selectedMacroDate);
    const workBurned = getWorkCaloriesBurnedForDate(selectedMacroDate);
    const gymBurned = getGymCaloriesBurnedForDate(selectedMacroDate);
    const totalBurned = workBurned + gymBurned;
    const netKcal = totals.kcal - totalBurned;
    $macroDateInput.value = selectedMacroDate;
    const buildStatHtml = ({ key, label, unit, step }) => {
      const value = roundMacro(totals[key]);
      const goalKey = key === "kcal" ? "kcalTarget" : `${key}_g`;
      const goal = roundMacro(macroTargets[goalKey] || 0);
      const pct = goal > 0 ? Math.min(140, Math.round((value / goal) * 100)) : 0;
      const excess = goal > 0 && value > goal;
      if (key === "kcal") {
        const ingestedRatio = goal > 0 ? Math.max(0, Math.min(1, totals.kcal / goal)) : 0;
        const burnedWithinIngestedRatio = goal > 0 ? Math.max(0, Math.min(ingestedRatio, totalBurned / goal)) : 0;
        const ingestedPct = Math.min(140, Math.round(ingestedRatio * 100));
        const burnedStartPct = Math.max(0, (ingestedRatio - burnedWithinIngestedRatio) * 100);
        const burnedWidthPct = Math.max(0, burnedWithinIngestedRatio * 100);
        const remaining = goal > 0 ? roundMacro(goal - totals.kcal) : null;
        const remainingLabel = remaining == null
          ? ""
          : (remaining >= 0 ? `${remaining} restantes` : `${Math.abs(remaining)} exceso`);
        const burnParts = [
          `-${roundMacro(totalBurned)} quemadas`,
          (workBurned || gymBurned) ? `(${roundMacro(workBurned)} trabajo + ${roundMacro(gymBurned)} gym)` : "",
          remainingLabel
        ].filter(Boolean).join(" · ");
        return `
          <div class="macro-stat macro-stat-${key} ${excess ? "is-excess" : ""}">
            <div class="macro-stat-title">${label}</div>
            <div class="macro-stat-value">
              <span class="macro-consumed ${excess ? "is-excess" : ""}">${roundMacro(totals.kcal)}${unit}</span>
              <span class="macro-sep">/</span>
              <input class="macro-goal-input-stats" type="number" min="0" step="${step}" inputmode="decimal" placeholder="${goal}" value="" data-macro-goal="${key}" aria-label="Objetivo ${label}" />
              <span class="macro-unit">${unit}</span>
            </div>
            <div class="hint">${burnParts || `-${roundMacro(totalBurned)} quemadas`}</div>
            <div class="macro-progress macro-progress-kcal">
              <span style="width:${ingestedPct}%"></span>
              <i class="macro-progress-burn" style="left:${burnedStartPct}%; width:${burnedWidthPct}%"></i>
            </div>
          </div>
        `;
      }
      const initial = key === "carbs" ? "C" : (key === "protein" ? "P" : "G");
      return `
        <div class="macro-stat macro-stat-${key} ${excess ? "is-excess" : ""}">
          <div class="macro-stat-initial">${initial}</div>
          <div class="macro-stat-value">
            <span class="macro-consumed ${excess ? "is-excess" : ""}">${value}${unit}</span>
            <span class="macro-sep">/</span>
            <input class="macro-goal-input-stats" type="number" min="0" step="${step}" inputmode="decimal" placeholder="${goal}" value="" data-macro-goal="${key}" aria-label="Objetivo ${label}" />
            <span class="macro-unit">${unit}</span>
          </div>
          <div class="macro-progress"><span style="width:${pct}%"></span></div>
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
      <div class="macro-summary-group macro-summary-group-cost">
        <div class="macro-stat macro-stat-cost">
          <div class="macro-stat-title">Gasto comida (estimado)</div>
          <div class="macro-stat-value" id="gasto-diario-comida"><span class="macro-consumed" id="gasto-diario-comida">${formatCurrency(dayCost.total)}</span></div>
          <div class="hint ${dayCost.missing ? "macro-cost-warning" : ""}">${dayCost.missing ? `${dayCost.missing} elementos sin precio` : ""}</div>
        </div>
      </div>
    `;
    const kcalGoal = Number(macroTargets.kcalTarget) || 0;
    if ($macroKcalSummary) {
      $macroKcalSummary.textContent = kcalGoal > 0
        ? `${Number(totals.kcal).toFixed(2)} kcal / ${Number(kcalGoal).toFixed(2)} kcal`
        : `${Number(totals.kcal).toFixed(2)} kcal`;
    }

    renderMacroIntegrationSettings();

    $macroMeals.innerHTML = mealOrder.map((meal) => {
      const entries = log.meals[meal].entries || [];
      const mt = computeMealTotals(entries);
      const mealCost = computeMealCostSummary(entries);
      const isSelectionMode = macroSelectionState.meal === meal;
      const entryHtml = entries.map((entry, idx) => {
        const entryId = ensureMacroEntryId(entry);
        const isSelected = isSelectionMode && macroSelectionState.selectedIds.has(entryId);
        const isRecipe = entry.type === "recipe";
        const quantityLabel = isRecipe
          ? `${roundMacro(entry.servings || 1)} rac`
          : formatAmountWithUnit(Number(entry.amount) || Number(entry.grams) || 0, entry.unit || "g");
        const servingsCount = getEntryServingsCount(entry);
        const entryCost = calculateEntryFoodCost(entry);
        const entryMacros = getEntryMacrosTotal(entry);
        const isExpanded = isRecipe && (macroExpandedRecipes.has(entryId) || entry.expanded);
        const ingredients = isRecipe ? getRecipeIngredientsFromEntry(entry) : [];
        const ingredientsHtml = isRecipe && isExpanded
          ? `<div class="macro-recipe-ingredients"><div class="macro-recipe-expanded-title">${escapeHtml(entry.nameSnapshot || "Receta")}</div>${ingredients.map((ing, ingIdx) => {
            const product = getIngredientLinkedProduct(ing);
            const nutrition = computeIngredientNutrition(ing, product);
            const cost = computeIngredientCost(ing, product);
            const qty = normalizeIngredientQty(ing?.qty);
            const unit = normalizeCostUnit(ing?.unit || "");
            const qtyLabel = qty && unit ? `${roundMacro(qty)} ${unit}` : (resolveIngredientDisplay(ing).quantity || "—");
            const unitOptions = STRUCTURED_INGREDIENT_UNITS.map((opt) => `<option value="${opt}" ${unit === opt ? "selected" : ""}>${opt}</option>`).join("");
            return `<div class="macro-recipe-ingredient-row" data-macro-recipe-ingredient="${meal}:${idx}:${ingIdx}"><div class="macro-recipe-ingredient-main"><strong>${escapeHtml(String(ing?.label || ing?.name || "Ingrediente"))}</strong><span>${roundMacro(nutrition.totals.kcal)} kcal · C ${roundMacro(nutrition.totals.carbs)} · P ${roundMacro(nutrition.totals.protein)} · G ${roundMacro(nutrition.totals.fat)} · ${cost.calculable ? formatCurrency(cost.value) : "Coste n/d"}</span></div><div class="macro-recipe-ingredient-controls"><input class="macro-recipe-ingredient-qty" type="number" min="0" step="0.1" inputmode="decimal" value="${qty == null ? "" : qty}" data-macro-ingredient-qty="${meal}:${idx}:${ingIdx}" aria-label="Cantidad ingrediente"/><select class="macro-recipe-ingredient-unit" data-macro-ingredient-unit="${meal}:${idx}:${ingIdx}" aria-label="Unidad ingrediente">${unitOptions}</select><span class="hint">${escapeHtml(qtyLabel)}</span></div></div>`;
          }).join("") || '<div class="hint">Sin ingredientes</div>'}</div>`
          : "";
        return `
      <div class="macro-entry ${isSelected ? "is-selected" : ""} ${isRecipe ? "macro-entry-recipe" : ""} ${isExpanded ? "is-expanded" : ""}">
      <input class="macro-entry-count-input" type="number" min="0.01" step="0.01" inputmode="decimal" value="${servingsCount}" data-macro-count="${meal}:${idx}" aria-label="Unidades de ${escapeHtml(entry.nameSnapshot)}" />
      ${isSelectionMode && !isRecipe ? `<button class="macro-entry-select-toggle" data-macro-select-toggle="${meal}:${idx}" type="button" aria-label="Seleccionar ${escapeHtml(entry.nameSnapshot)}">${isSelected ? "✓" : "○"}</button>` : ""}
      <button class="macro-entry-open" data-macro-open="${meal}:${idx}" data-macro-entry-id="${entryId}" type="button" aria-label="Abrir ficha de ${escapeHtml(entry.nameSnapshot)}">
      <div class="contenido-comida-lista">
      <strong>${escapeHtml(entry.nameSnapshot)}</strong>
      <div class="hint" id="cantidad-comida">${quantityLabel}</div>
      <div class="hint macro-recipe-inline-kpis">C ${roundMacro(entryMacros.carbs)} · P ${roundMacro(entryMacros.protein)} · G ${roundMacro(entryMacros.fat)} · ${entryCost.cost == null ? "Coste n/d" : formatCurrency(entryCost.cost)}</div>
      </div>
      </button>
      <div class="macro-entry-right">
      <div class="kcals-dato">${roundMacro(entryMacros.kcal)} kcal</div>
      <div class="hint macro-entry-cost">${entryCost.cost == null ? "Coste n/d" : `~${formatCurrency(entryCost.cost)}`}</div>
      <button class="icon-btn-eliminar-comida" data-macro-delete="${meal}:${idx}" type="button">✕</button></div>
      ${ingredientsHtml}
      </div>`;
      }).join("") || '<div class="hint">Sin entradas</div>';
      const selectedCount = isSelectionMode ? getMacroSelectionEntries().length : 0;
      const selectionBar = isSelectionMode
        ? `<div class="macro-selection-bar"><span>${selectedCount} seleccionados</span><div class="macro-selection-actions"><button class="btn ghost btn-compact" data-macro-selection-cancel="${meal}" type="button">Cancelar</button><button class="btn btn-compact" data-macro-selection-create="${meal}" type="button" ${selectedCount ? "" : "disabled"}>Crear receta</button></div></div>`
        : "";
      return `<article class="macro-meal-card">
      <div class="macro-meal-head">
      <h4>${mealLabels[meal]}</h4>
      <div class="hint macro-meal-kpis">
        <span class="macro-meal-kpi macro-meal-kpi-kcal"><span class="macro-meal-kpi-label">Kcal</span><strong class="macro-meal-kpi-value">${roundMacro(mt.kcal)}</strong></span>
        <span class="macro-meal-kpi macro-meal-kpi-carbs"><span class="macro-meal-kpi-label">C</span><strong class="macro-meal-kpi-value">${roundMacro(mt.carbs)}</strong></span>
        <span class="macro-meal-kpi macro-meal-kpi-protein"><span class="macro-meal-kpi-label">P</span><strong class="macro-meal-kpi-value">${roundMacro(mt.protein)}</strong></span>
        <span class="macro-meal-kpi macro-meal-kpi-fat"><span class="macro-meal-kpi-label">G</span><strong class="macro-meal-kpi-value">${roundMacro(mt.fat)}</strong></span>
        <span class="macro-meal-kpi macro-meal-kpi-cost"><span class="macro-meal-kpi-label">Coste</span><strong class="macro-meal-kpi-value">${formatCurrency(mealCost.total)}</strong></span>
        ${mealCost.missing ? `<span class="macro-meal-kpi macro-meal-kpi-missing"><strong class="macro-meal-kpi-value">${mealCost.missing}</strong><span class="macro-meal-kpi-label">s/p</span></span>` : ""}
      </div></div><div class="macro-meal-entries">${entryHtml}</div>${selectionBar}<button class="btn ghost btn-compact" data-macro-add="${meal}" type="button">+ Añadir alimento</button></article>`;
    }).join("");
    if ($recipesPanelStatistics?.classList.contains("is-active")) renderStatisticsView();
  }


  function openMacroIntegrationModal() {
    renderMacroIntegrationSettings();
    $macroIntegrationModalBackdrop?.classList.remove("hidden");
  }

  function closeMacroIntegrationModal() {
    $macroIntegrationModalBackdrop?.classList.add("hidden");
  }


  function renderMacroIntegrationSettings() {
    const habits = sortByVisibleNameEs(listHabitsForProductLink(), (h) => `${h?.emoji || ""} ${h?.name || h?.id || ""}`);
    if ($macroWorkHabits) {
      const current = new Set(nutritionIntegrationConfig.linkedWorkHabitIds || []);
      $macroWorkHabits.innerHTML = habits.map((h) => `<option value="${escapeHtml(h.id)}" ${current.has(h.id) ? "selected" : ""}>${escapeHtml(`${h.emoji || "🏷️"} ${h.name || h.id}`)}</option>`).join("");
    }
    if ($macroWorkKcal) $macroWorkKcal.value = String(Math.max(0, Number(nutritionIntegrationConfig.workCaloriesPerMatchedDay) || defaultIntegrationConfig.workCaloriesPerMatchedDay));
    if ($macroBodyweightKg) $macroBodyweightKg.value = nutritionIntegrationConfig.bodyWeightKg == null ? "" : String(nutritionIntegrationConfig.bodyWeightKg);
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
    const baseUnit = normalizeUnit($macroProductBaseUnit?.value || "g") || "g";
    const hasFinanceSelection = !!$macroProductFinanceSelect;
    const hasHabitSelection = !!$macroProductHabitSelect;
    const packageAmount = Number($macroProductPackageAmount?.value) > 0 ? Number($macroProductPackageAmount.value) : null;
    const packageUnit = normalizeUnit($macroProductPackageUnit?.value || "");
    return {
      id: _macroProductDraft?.id,
      source: _macroProductDraft?.source || "manual",
      createdAt: _macroProductDraft?.createdAt,
      name: $macroProductName?.value,
      brand: $macroProductBrand?.value,
      barcode: $macroProductBarcode?.value,
      financeProductId: hasFinanceSelection ? String($macroProductFinanceSelect?.value || "") : (_macroProductDraft?.financeProductId || ""),
      linkedHabitId: hasHabitSelection ? String($macroProductHabitSelect?.value || "") : (_macroProductDraft?.linkedHabitId || ""),
      packageAmount,
      packageUnit,
      price: Number($macroProductPrice?.value) > 0 ? Number($macroProductPrice.value) : null,
      priceBaseQty: packageAmount,
      priceBaseUnit: packageUnit,
      baseQuantity: base,
      baseUnit,
      servingBaseUnit: baseUnit,
      servingBaseGrams: base,
      macros: {
        carbs: Number($macroProductCarbs?.value) || 0,
        protein: Number($macroProductProtein?.value) || 0,
        fat: Number($macroProductFat?.value) || 0,
        kcal: Number($macroProductKcal?.value) || 0,
      },
    };
  }

  function parseLoosePositiveNumber(raw) {
    if (raw == null) return null;
    const clean = String(raw)
      .trim()
      .replace(/\s+/g, "")
      .replace(/,/g, ".")
      .replace(/[^\d.\-]/g, "");
    if (!clean || clean === "." || clean === "-" || clean === "-." ) return null;
    const normalized = clean.replace(/(\..*)\./g, "$1");
    const num = Number(normalized);
    if (!Number.isFinite(num) || num < 0) return null;
    return num;
  }

  function roundAmountForInput(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n < 0) return "";
    return String(Math.round(n * 1000) / 1000);
  }

  function updateWeightDiffUnitLabels() {
    const activeUnit = normalizeUnit($macroProductGramsUnit?.value || "g") || "g";
    const unitLabel = activeUnit === "unit" ? "ud" : activeUnit;
    if ($macroProductWeightStartUnit) $macroProductWeightStartUnit.textContent = `(${unitLabel})`;
    if ($macroProductWeightEndUnit) $macroProductWeightEndUnit.textContent = `(${unitLabel})`;
  }

  function syncAmountFromAutoCalculation() {
    const start = parseLoosePositiveNumber($macroProductWeightStart?.value);
    const end = parseLoosePositiveNumber($macroProductWeightEnd?.value);
    const packageWeight = parseLoosePositiveNumber($macroProductPackWeight?.value);
    const packageUnits = parseLoosePositiveNumber($macroProductPackUnits?.value);
    const consumedUnits = parseLoosePositiveNumber($macroProductPackConsumed?.value);

    if ($macroProductWeightStart) $macroProductWeightStart.classList.remove("is-invalid");
    if ($macroProductWeightEnd) $macroProductWeightEnd.classList.remove("is-invalid");

    if (!$macroProductWeightDiffHint) return;
    $macroProductWeightDiffHint.textContent = "";

    if (start != null && end != null) {
      const diff = start - end;
      if (!Number.isFinite(diff) || diff < 0) {
        if ($macroProductWeightStart) $macroProductWeightStart.classList.add("is-invalid");
        if ($macroProductWeightEnd) $macroProductWeightEnd.classList.add("is-invalid");
        $macroProductWeightDiffHint.textContent = "Peso final no puede ser mayor que peso inicial.";
        return;
      }
      if ($macroProductGrams) $macroProductGrams.value = roundAmountForInput(diff);
      const unit = normalizeUnit($macroProductGramsUnit?.value || "g") || "g";
      $macroProductWeightDiffHint.textContent = `Cantidad deducida automáticamente: ${formatAmountWithUnit(diff, unit)}.`;
      return;
    }

    if (packageWeight != null && packageUnits != null && consumedUnits != null && packageUnits > 0) {
      const perUnitGrams = packageWeight / packageUnits;
      const totalGrams = perUnitGrams * consumedUnits;
      const targetUnit = normalizeUnit($macroProductGramsUnit?.value || "g") || "g";
      const converted = convertAmount(totalGrams, "g", targetUnit);
      const calculatedAmount = converted == null ? totalGrams : converted;
      if ($macroProductGrams) $macroProductGrams.value = roundAmountForInput(calculatedAmount);
      $macroProductWeightDiffHint.textContent = `Cantidad deducida automáticamente por paquete: ${formatAmountWithUnit(calculatedAmount, targetUnit)}.`;
    }
  }

  function renderMacroProductSummary() {
    if (!$macroProductSummary) return;
    const amount = Math.max(0, Number($macroProductGrams?.value) || 0);
    const amountUnit = normalizeUnit($macroProductGramsUnit?.value || "g") || "g";
    const draft = readMacroProductDraftFromForm();
    const baseUnit = normalizeUnit(draft.baseUnit || "g") || "g";
    const convertedAmount = convertAmount(amount, amountUnit, baseUnit);
    const m = convertedAmount == null ? normalizeMacros({}) : calcProductMacros({ ...draft, servingBaseGrams: draft.baseQuantity }, convertedAmount);
    const effectivePrice = getEffectiveProductPrice(draft);
    const priceSource = getEffectiveProductPriceSource(draft);

    if ($macroProductPriceUsed) {
      if (effectivePrice == null) $macroProductPriceUsed.textContent = "Sin precio disponible";
      else if (priceSource === "finance-linked-last-price") $macroProductPriceUsed.textContent = `Precio usado: ${formatCurrency(effectivePrice)} (Finanzas)`;
      else $macroProductPriceUsed.textContent = `Precio usado: ${formatCurrency(effectivePrice)} (Manual)`;
    }

    if (amount) {
      const cost = calculateProductConsumedCost(draft, amount, amountUnit);
      const costLabel = cost == null ? " · Coste n/d" : ` · ~${formatCurrency(cost)}`;
      if (convertedAmount == null) {
        $macroProductSummary.textContent = `Para ${formatAmountWithUnit(amount, amountUnit)}: no calculable con la unidad base (${baseUnit}).${costLabel}`;
      } else {
        $macroProductSummary.textContent = `Para ${formatAmountWithUnit(amount, amountUnit)}: ${roundMacro(m.kcal)} kcal · C ${roundMacro(m.carbs)} · P ${roundMacro(m.protein)} · G ${roundMacro(m.fat)}${costLabel}`;
      }
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

    if (_macroProductRecipeIngredientTarget?.recipeId && _macroProductRecipeIngredientTarget?.ingredientId && !entryTarget) {
      if ($macroProductAdd) $macroProductAdd.textContent = "Añadir a receta";
      if ($macroProductModalTitle) $macroProductModalTitle.textContent = "Producto (receta)";
    }

    await loadFinanceProductsCatalog();
    const habits = sortByVisibleNameEs(listHabitsForProductLink(), (h) => `${h?.emoji || ""} ${h?.name || h?.id || ""}`);
    const sortedFinanceProducts = sortByVisibleNameEs(financeProducts, (row) => row?.name || "");
    if ($macroProductFinanceSelect) {
      const opts = ['<option value="">Sin vincular</option>']
        .concat(sortedFinanceProducts.map((row) => `<option value="${escapeHtml(row.id)}">${escapeHtml(row.name)}${row.lastPrice ? ` · ${formatCurrency(row.lastPrice)}` : ""}</option>`));
      $macroProductFinanceSelect.innerHTML = opts.join("");
      $macroProductFinanceSelect.value = String(product.financeProductId || "");
    }
    if ($macroProductFinanceHint) {
      const linkedFin = financeProducts.find((f) => f.id === String(product.financeProductId || ""));
      $macroProductFinanceHint.textContent = linkedFin ? `Vinculado a ${linkedFin.name}${linkedFin.lastPrice ? ` · último ${formatCurrency(linkedFin.lastPrice)}` : ""}` : "Sin producto de Finanzas";
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
    if ($macroProductBase) $macroProductBase.value = String(Number(product.baseQuantity || product.servingBaseGrams) || 100);
    if ($macroProductBaseUnit) $macroProductBaseUnit.value = normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g";
    if ($macroProductCarbs) {
      const v = Number(product.macros?.carbs);
      $macroProductCarbs.value = Number.isFinite(v) && v > 0 ? String(v) : "";
    }
    if ($macroProductProtein) {
      const v = Number(product.macros?.protein);
      $macroProductProtein.value = Number.isFinite(v) && v > 0 ? String(v) : "";
    }
    if ($macroProductFat) {
      const v = Number(product.macros?.fat);
      $macroProductFat.value = Number.isFinite(v) && v > 0 ? String(v) : "";
    }
    if ($macroProductKcal) {
      const v = Number(product.macros?.kcal);
      $macroProductKcal.value = Number.isFinite(v) && v > 0 ? String(v) : "";
    }
    const pkg = resolveProductPackageSpec(product);
    if ($macroProductPackageAmount) $macroProductPackageAmount.value = pkg.amount == null ? "" : String(Number(pkg.amount) || 0);
    if ($macroProductPackageUnit) $macroProductPackageUnit.value = pkg.unit || "";
    if ($macroProductPrice) $macroProductPrice.value = product.price == null ? "" : String(Number(product.price) || 0);
    if ($macroProductGrams) $macroProductGrams.value = String(Number(grams) || 0);
    if ($macroProductGramsUnit) $macroProductGramsUnit.value = normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g";
    if ($macroProductWeightStart) {
      $macroProductWeightStart.value = "";
      $macroProductWeightStart.classList.remove("is-invalid");
    }
    if ($macroProductWeightEnd) {
      $macroProductWeightEnd.value = "";
      $macroProductWeightEnd.classList.remove("is-invalid");
    }
    if ($macroProductWeightDiffHint) $macroProductWeightDiffHint.textContent = "";
    if ($macroProductPackWeight) $macroProductPackWeight.value = "";
    if ($macroProductPackUnits) $macroProductPackUnits.value = "";
    if ($macroProductPackConsumed) $macroProductPackConsumed.value = "";
    updateWeightDiffUnitLabels();

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
      const consumedAmount = Math.max(0, Number(entry.amount) || Number(entry.grams) || 0);
      const consumedUnit = normalizeUnit(entry.unit || "g") || "g";
      const normalizedForPer100 = convertAmount(consumedAmount, consumedUnit, "g");
      const snapshotPer100 = (normalizedForPer100 > 0 && entry.macrosSnapshot)
        ? {
          carbs: (Number(entry.macrosSnapshot.carbs) || 0) / normalizedForPer100 * 100,
          protein: (Number(entry.macrosSnapshot.protein) || 0) / normalizedForPer100 * 100,
          fat: (Number(entry.macrosSnapshot.fat) || 0) / normalizedForPer100 * 100,
          kcal: (Number(entry.macrosSnapshot.kcal) || 0) / normalizedForPer100 * 100,
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
      openMacroProductModal(found || fallback, meal, consumedAmount || 100, { meal, idx: i });
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
        const prevEffects = entry?.sideEffects || buildRecipeSideEffects(recipe, current);
        entry.servings = next;
        entry.macrosSnapshot = normalizeMacros({
          carbs: (Number(base.carbs) || 0) * next,
          protein: (Number(base.protein) || 0) * next,
          fat: (Number(base.fat) || 0) * next,
          kcal: (Number(base.kcal) || 0) * next,
        });
        entry.sideEffects = buildRecipeSideEffects(recipe, next);
        applyRecipeSideEffects(prevEffects, selectedMacroDate, -1, "recipe_servings_old");
        applyRecipeSideEffects(entry.sideEffects, selectedMacroDate, 1, "recipe_servings_new");
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
      const list = nutritionProducts
        .filter((p) => !q || `${p.name} ${p.brand || ""} ${p.barcode || ""}`.toLowerCase().includes(q))
        .slice()
        .sort((a, b) => {
          const aHay = `${a.name} ${a.brand || ""} ${a.barcode || ""}`.toLowerCase();
          const bHay = `${b.name} ${b.brand || ""} ${b.barcode || ""}`.toLowerCase();
          const aIdx = q ? aHay.indexOf(q) : 0;
          const bIdx = q ? bHay.indexOf(q) : 0;
          if (q && aIdx !== bIdx) return aIdx - bIdx;

          const au = macroUsage.products?.[a.id] || null;
          const bu = macroUsage.products?.[b.id] || null;
          const aCount = clampUsageValue(au?.count, 0);
          const bCount = clampUsageValue(bu?.count, 0);
          if (aCount !== bCount) return bCount - aCount;
          const aLast = clampUsageValue(au?.lastAt, 0);
          const bLast = clampUsageValue(bu?.lastAt, 0);
          if (aLast !== bLast) return bLast - aLast;
          return String(a.name || "").localeCompare(String(b.name || ""));
        });
      $macroAddResults.innerHTML = list.map((p) => `<button class="macro-result" data-add-product="${p.id}" type="button"><span>${p.name}</span><span class="hint">${p.brand || ""} · ${p.macros?.kcal || 0} kcal / ${formatAmountWithUnit(Number(p.baseQuantity || p.servingBaseGrams) || 100, p.baseUnit || p.servingBaseUnit || "g")}</span></button>`).join("") || '<div class="hint">No hay productos.</div>';
    }
    if (showRecipes) {
      const list = recipes
        .filter((r) => !q || `${r.title} ${(r.tags || []).join(" ")}`.toLowerCase().includes(q))
        .slice()
        .sort((a, b) => {
          const aHay = `${a.title} ${(a.tags || []).join(" ")}`.toLowerCase();
          const bHay = `${b.title} ${(b.tags || []).join(" ")}`.toLowerCase();
          const aIdx = q ? aHay.indexOf(q) : 0;
          const bIdx = q ? bHay.indexOf(q) : 0;
          if (q && aIdx !== bIdx) return aIdx - bIdx;

          const au = macroUsage.recipes?.[a.id] || null;
          const bu = macroUsage.recipes?.[b.id] || null;
          const aCount = clampUsageValue(au?.count, 0);
          const bCount = clampUsageValue(bu?.count, 0);
          if (aCount !== bCount) return bCount - aCount;
          const aLast = clampUsageValue(au?.lastAt, 0);
          const bLast = clampUsageValue(bu?.lastAt, 0);
          if (aLast !== bLast) return bLast - aLast;
          return String(a.title || "").localeCompare(String(b.title || ""));
        });
      $macroAddResults.innerHTML = list.map((r) => { const t = calculateRecipeTotals(r); return `<button class="macro-result" data-add-recipe="${r.id}" type="button"><span>${r.title}</span><span class="hint">${roundMacro(r.nutritionPerServing?.kcal || r.nutritionTotals?.kcal || 0)} kcal/rac · ${formatCurrency(t.perServing.cost)}/rac</span></button>`; }).join("") || '<div class="hint">No hay recetas.</div>';
    }
    $macroAddChips?.querySelectorAll(".macro-chip").forEach((chip) => chip.classList.toggle("is-active", chip.dataset.macroSource === macroModalState.source));
  }

  function renderRecipeIngredientProductPicker() {
    if ($recipeIngredientPicker) {
      $recipeIngredientPicker.style.display = nutritionProducts.length ? "grid" : "none";
    }
    if (!$recipeIngredientProduct) return;
    const options = nutritionProducts
      .slice()
      .sort((a, b) => {
        const au = macroUsage.products?.[a.id] || null;
        const bu = macroUsage.products?.[b.id] || null;
        const aCount = clampUsageValue(au?.count, 0);
        const bCount = clampUsageValue(bu?.count, 0);
        if (aCount !== bCount) return bCount - aCount;
        const aLast = clampUsageValue(au?.lastAt, 0);
        const bLast = clampUsageValue(bu?.lastAt, 0);
        if (aLast !== bLast) return bLast - aLast;
        return String(a.name || "").localeCompare(String(b.name || ""));
      })
      .map((p) => {
        const label = `${p.name}${p.brand ? ` (${p.brand})` : ""}`;
        return `<option value="${escapeHtml(p.id)}">${escapeHtml(label)}</option>`;
      })
      .join("");
    $recipeIngredientProduct.innerHTML = `<option value="">Añadir desde productosâ€¦</option>${options}`;
    if ($recipeIngredientGrams && !$recipeIngredientGrams.value) $recipeIngredientGrams.value = "100";
  }

  function clearMacroSelection(meal = null) {
    if (meal && macroSelectionState.meal && macroSelectionState.meal !== meal) return;
    macroSelectionState.meal = null;
    macroSelectionState.selectedIds = new Set();
  }

  function getMacroSelectionEntries() {
    if (!macroSelectionState.meal) return [];
    const log = getDailyLog(selectedMacroDate);
    const entries = log?.meals?.[macroSelectionState.meal]?.entries || [];
    return entries.filter((entry) => macroSelectionState.selectedIds.has(ensureMacroEntryId(entry)));
  }

  function createRecipeFromMealSelection(meal) {
    const log = getDailyLog(selectedMacroDate);
    const entries = log?.meals?.[meal]?.entries || [];
    const selected = entries.filter((entry) => entry.type === "product" && macroSelectionState.selectedIds.has(ensureMacroEntryId(entry)));
    if (!selected.length) return;
    const rawName = window.prompt("Nombre de la receta");
    const title = String(rawName || "").trim();
    if (!title) return;
    const now = Date.now();
    const ingredients = selected.map((entry) => {
      const linked = nutritionProducts.find((p) => p.id === entry.refId) || null;
      const amount = Math.max(0, Number(entry.amount) || Number(entry.grams) || 0);
      const unit = normalizeUnit(entry.unit || "g") || "g";
      return buildRecipeIngredientFromProduct(linked, {
        productId: String(entry.refId || "").trim(),
        label: String(entry.nameSnapshot || entry.productName || "Producto").trim(),
        name: String(entry.nameSnapshot || entry.productName || "Producto").trim(),
        qty: amount,
        unit,
        linkedFinanceProductId: String(entry.linkedFinanceProductId || "").trim(),
        linkedHabitId: String(entry.linkedHabitId || "").trim(),
        nutritionSnapshot: entry.nutritionSnapshot || null,
        pricingSnapshot: entry.pricingSnapshot || null,
        computedKcal: Number(entry.macrosSnapshot?.kcal) || 0,
        computedCarbs: Number(entry.macrosSnapshot?.carbs) || 0,
        computedProtein: Number(entry.macrosSnapshot?.protein) || 0,
        computedFat: Number(entry.macrosSnapshot?.fat) || 0,
        computedCost: Number(entry.computedCost) || 0,
      });
    });
    const draftRecipe = normalizeRecipeFields(recalculateRecipeDerivedData({
      id: generateId(),
      title,
      meal: mealLabels[meal] || "",
      tags: ["Macros"],
      servings: 1,
      ingredients,
      steps: [],
      notes: "",
      createdAt: now,
      updatedAt: now,
    }));
    recipes.unshift(draftRecipe);
    persistRecipe(draftRecipe.id, draftRecipe);

    const sideEffects = selected.reduce((acc, entry) => {
      const fx = entry?.sideEffects || { habits: [], financeCost: Number(entry.computedCost) || 0, productsResolved: 0, productsTotal: 0 };
      acc.financeCost += Number(fx.financeCost) || 0;
      acc.productsResolved += Number(fx.productsResolved) || 0;
      acc.productsTotal += Number(fx.productsTotal) || 0;
      (Array.isArray(fx.habits) ? fx.habits : []).forEach((h) => {
        if (!h?.habitId) return;
        acc.habits.push({ habitId: String(h.habitId), amount: Number(h.amount) || 0 });
      });
      return acc;
    }, { habits: [], financeCost: 0, productsResolved: 0, productsTotal: 0 });

    const recipeEntry = {
      entryId: generateId(),
      type: "recipe",
      mealSlot: meal,
      refId: draftRecipe.id,
      nameSnapshot: draftRecipe.title,
      servings: 1,
      servingsCount: 1,
      macrosSnapshot: normalizeMacros(draftRecipe.nutritionTotals || {}),
      computedCost: Number(draftRecipe.totalCost) || null,
      sideEffects,
      recipeSnapshot: draftRecipe,
      ingredientsSnapshot: draftRecipe.ingredients || [],
      expanded: true,
      createdAt: now,
    };

    const selectedIds = new Set(selected.map((entry) => ensureMacroEntryId(entry)));
    const nextEntries = [];
    let inserted = false;
    entries.forEach((entry) => {
      const id = ensureMacroEntryId(entry);
      if (!selectedIds.has(id)) {
        nextEntries.push(entry);
        return;
      }
      if (!inserted) {
        nextEntries.push(recipeEntry);
        inserted = true;
      }
    });
    log.meals[meal].entries = nextEntries;
    macroExpandedRecipes.add(recipeEntry.entryId);
    clearMacroSelection(meal);
    persistNutrition();
    renderMacrosView();
    refreshUI();
  }

  function buildProductSideEffects(product, quantityFactor = 1) {
    const safeFactor = Math.max(0, Number(quantityFactor) || 0);
    const habitId = String(product?.linkedHabitId || "").trim();
    const habits = habitId ? [{ habitId, amount: safeFactor }] : [];
    let financeCost = 0;
    if (String(product?.financeProductId || "").trim()) {
      const fin = financeProducts.find((f) => f.id === String(product.financeProductId || "").trim());
      const price = Number(fin?.lastPrice) || 0;
      financeCost = price > 0 ? price * safeFactor : 0;
    }
    return { habits, financeCost };
  }

  function buildRecipeSideEffects(recipe, servings = 1) {
    const safeServings = Math.max(0, Number(servings) || 0);
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const summary = { habits: [], financeCost: 0, productsResolved: 0, productsTotal: ingredients.length };
    ingredients.forEach((ing) => {
      const linked = nutritionProducts.find((p) => p.id === ing?.productId);
      if (!linked) return;
      summary.productsResolved += 1;
      const productFx = buildProductSideEffects(linked, safeServings);
      summary.financeCost += Number(productFx.financeCost) || 0;
      productFx.habits.forEach((h) => summary.habits.push({ ...h }));
    });
    return summary;
  }

  function applyRecipeSideEffects(sideEffects, dateKey, direction = 1, context = "recipe") {
    const sign = direction >= 0 ? 1 : -1;
    const habits = Array.isArray(sideEffects?.habits) ? sideEffects.habits : [];
    habits.forEach((h) => {
      const delta = Math.round((Number(h?.amount) || 0) * sign);
      if (!delta || !h?.habitId) return;
      logMacroEvent(["recipe", "habit"], "aplicando impacto de hábito", { context, habitId: h.habitId, delta, dateKey }, "info");
      adjustHabitCountForDate(String(h.habitId || "").trim(), dateKey, delta);
    });

    const financeDelta = (Number(sideEffects?.financeCost) || 0) * sign;
    if (financeDelta) {
      const payload = {
        dateKey,
        context,
        delta: financeDelta,
        ts: Date.now(),
      };
      try {
        window.__bookshellRecipeFinanceImpact = window.__bookshellRecipeFinanceImpact || [];
        window.__bookshellRecipeFinanceImpact.push(payload);
      } catch (_) {}
      try {
        const key = `${getStorageKey()}.recipeFinanceImpact`;
        const list = JSON.parse(localStorage.getItem(key) || "[]");
        list.push(payload);
        localStorage.setItem(key, JSON.stringify(list.slice(-200)));
      } catch (_) {}
      logMacroEvent(["recipe", "finance"], "aplicando impacto financiero", { context, dateKey, delta: roundMacro(financeDelta) }, "info");
    }
  }

  function addProductToMeal(meal, product, grams = 100) {
    if (!product) return;
    const baseUnit = normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g";
    const entry = buildConsumptionEntryFromEditor({ product, amount: grams, unit: baseUnit, meal });
    const sideEffects = entry.sideEffects || buildProductSideEffects(product, 1);
    persistConsumptionEntry(entry, { meal });
    bumpMacroUsage("products", product.id);
    applyRecipeSideEffects(sideEffects, selectedMacroDate, 1, "product");
  }

  function addRecipeToMeal(meal, recipe, servings = 1) {
    if (!recipe) return;
    const recipeCost = calculateRecipeCost(recipe, servings);
    const computedCost = Number.isFinite(Number(recipeCost?.total)) && Number(recipeCost.total) >= 0
      ? Number(recipeCost.total)
      : null;
    const base = normalizeMacros(recipe.nutritionPerServing || recipe.nutritionTotals || {});
    const macrosSnapshot = {
      carbs: base.carbs * servings,
      protein: base.protein * servings,
      fat: base.fat * servings,
      kcal: base.kcal * servings,
    };
    const sideEffects = buildRecipeSideEffects(recipe, servings);
    const entry = {
      entryId: generateId(),
      type: "recipe",
      mealSlot: meal,
      refId: recipe.id,
      nameSnapshot: recipe.title,
      servings,
      servingsCount: 1,
      macrosSnapshot,
      computedCost,
      sideEffects,
      recipeSnapshot: recipe,
      ingredientsSnapshot: Array.isArray(recipe.ingredients) ? recipe.ingredients : [],
      expanded: false,
      createdAt: Date.now(),
    };
    getDailyLog(selectedMacroDate).meals[meal].entries.unshift(entry);
    updateRecipe(recipe.id, {
      usageCount: (Number(recipe.usageCount) || 0) + 1,
      lastUsedAt: Date.now(),
    });
    bumpMacroUsage("recipes", recipe.id);
    persistNutrition();
    renderMacrosView();
    logMacroEvent(["recipe"], "receta añadida con side effects", { recipeId: recipe.id, servings, productsResolved: sideEffects.productsResolved, productsTotal: sideEffects.productsTotal }, "info");
    applyRecipeSideEffects(sideEffects, selectedMacroDate, 1, "recipe");
  }

  function updateRecipeEntryFromIngredients(entry, ingredients) {
    if (!entry || entry.type !== "recipe") return;
    const baseRecipe = normalizeRecipeFields(getRecipeSnapshotFromEntry(entry) || {});
    const nextRecipe = recalculateRecipeDerivedData({
      ...baseRecipe,
      ingredients: Array.isArray(ingredients) ? ingredients : [],
      updatedAt: Date.now(),
    });
    const servings = Math.max(0, Number(entry.servings) || 0);
    const perServing = normalizeMacros(nextRecipe.nutritionPerServing || nextRecipe.nutritionTotals || {});
    entry.recipeSnapshot = nextRecipe;
    entry.ingredientsSnapshot = Array.isArray(nextRecipe.ingredients) ? nextRecipe.ingredients : [];
    entry.nameSnapshot = nextRecipe.title || entry.nameSnapshot;
    entry.macrosSnapshot = normalizeMacros({
      carbs: perServing.carbs * servings,
      protein: perServing.protein * servings,
      fat: perServing.fat * servings,
      kcal: perServing.kcal * servings,
    });
    entry.computedCost = Number.isFinite(Number(nextRecipe.totalCost)) ? Number(nextRecipe.totalCost) : null;
    entry.sideEffects = buildRecipeSideEffects(nextRecipe, servings);
    if (nextRecipe.id) {
      const idx = recipes.findIndex((row) => row.id === nextRecipe.id);
      if (idx >= 0) {
        recipes[idx] = { ...recipes[idx], ...nextRecipe, updatedAt: Date.now() };
        persistRecipe(nextRecipe.id, recipes[idx]);
      }
    }
  }

  function updateMacroRecipeIngredient(meal, idx, ingredientIndex, patch = {}) {
    const log = getDailyLog(selectedMacroDate);
    const entry = log?.meals?.[meal]?.entries?.[Number(idx)];
    if (!entry || entry.type !== "recipe") return;
    const ingredients = getRecipeIngredientsFromEntry(entry).map((ing) => ({ ...ing }));
    const targetIdx = Number(ingredientIndex);
    if (!Number.isInteger(targetIdx) || !ingredients[targetIdx]) return;
    const current = ingredients[targetIdx];
    const nextQtyRaw = patch.qty;
    let nextQty = current.qty;
    if (nextQtyRaw !== undefined) {
      const parsed = Number(nextQtyRaw);
      nextQty = Number.isFinite(parsed) && parsed >= 0 ? parsed : "";
    }
    const nextUnit = patch.unit !== undefined
      ? (normalizeCostUnit(patch.unit) || normalizeCostUnit(current.unit) || "g")
      : (normalizeCostUnit(current.unit) || "g");
    const updated = buildRecipeIngredientFromProduct(getIngredientLinkedProduct(current), {
      ...current,
      qty: nextQty,
      unit: nextUnit,
    });
    ingredients[targetIdx] = updated;
    updateRecipeEntryFromIngredients(entry, ingredients);
    persistNutrition();
    renderMacrosView();
  }

  function saveProduct(product) {
    const now = Date.now();
    const pkg = resolveProductPackageSpec(product);
    const normalized = {
      id: product.id || generateId(),
      name: String(product.name || "").trim(),
      brand: String(product.brand || "").trim(),
      barcode: String(product.barcode || "").trim(),
      baseQuantity: Math.max(1, Number(product.baseQuantity || product.servingBaseGrams) || 100),
      baseUnit: normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g",
      servingBaseGrams: Math.max(1, Number(product.baseQuantity || product.servingBaseGrams) || 100),
      servingBaseUnit: normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g",
      macros: normalizeMacros(product.macros),
      financeProductId: String(product.financeProductId || "").trim(),
      linkedHabitId: String(product.linkedHabitId || "").trim(),
      packageAmount: pkg.amount,
      packageUnit: pkg.unit,
      price: Number(product.price) > 0 ? Number(product.price) : null,
      priceBaseQty: pkg.amount,
      priceBaseUnit: pkg.unit,
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
    const habits = Array.isArray(entry?.sideEffects?.habits) && entry.sideEffects.habits.length
      ? entry.sideEffects.habits
      : [{ habitId: String(entry?.habitSync?.habitId || "").trim(), amount: Math.max(0, Number(entry?.habitSync?.amount) || 0) }];
    await Promise.all(habits.map(async (row) => {
      const habitId = String(row?.habitId || "").trim();
      if (!habitId) return;
      const amount = Math.max(0, Number(row?.amount) || 0);
      const delta = Math.round(amount * direction);
      if (!delta) return;
      await adjustHabitCountForDate(habitId, dateKey, delta);
    }));
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
    const servings = resolveRecipeServings(recipe);
    const cost = calculateRecipeCost(recipe, servings);
    return { total: cost.total, covered: cost.covered, totalIngredients: cost.ingredientsTotal, perServing: cost.perServing, missing: cost.missing };
  }

  let _macroScanStream = null;
  let _macroScanRunning = false;
  let _macroScanEngine = "none";
  let _macroScanHtml5Module = null;
  let _macroScanZxingModule = null;
  let _macroScanHtml5Instance = null;
  let _macroScanLastValue = "";
  let _macroScanLastAt = 0;
  let _macroScanTimer = null;
  let _macroScanPendingProduct = null;
  let _macroScanStartedAt = 0;
  let _macroScanFrameCanvas = null;
  let _macroScanCameraTrack = null;
  let _macroScanCameraProfile = null;
  let _macroScanOcrModule = null;
  let _macroScanOcrInFlight = false;
  let _macroScanDecodeInFlight = false;
  let _macroScanSessionId = 0;
  let _macroScanPendingLookup = null;
  let _macroScanEngineRunId = 0;
  let _macroScanUiLogs = [];
  let _macroScanUiRenderScheduled = false;
  const _macroScanNoResultLastAt = { html5: 0 };
  let _macroScanViewfinderPx = null; // { width, height }
  let _macroScanQrBoxPx = null; // { left, top, width, height, lineTop }
  let _macroScanLayoutLastAt = 0;
  let _macroScanResizeListenerBound = false;
  let _macroScanResizeRestartTimer = null;
  let _macroScanLastHostPx = null; // { width, height }
  let _macroScanLookupSeq = 0;
  let _macroScanLookupTimer = null;
  let _macroScanOcrDebugState = { source: null, crop: null, final: null };
  let _macroScanNativeBarcodeSupport = null;
  let _macroScanLookupQueued = null; // { barcode, options }
  let _macroScanLastLookupCode = "";
  let _macroScanLastLookupAt = 0;
  let _macroScanParseFailLastAt = 0;
  let _macroScanCapturedFrame = null;
  let _macroScanCapturedAt = 0;
  const _macroScanLookupInFlight = new Map(); // barcode -> Promise

  const MACRO_SCAN_NO_RESULT_LOG_EVERY_MS = 6000;
  const MACRO_SCAN_LAYOUT_LOG_EVERY_MS = 1600;
  // No bloqueamos lecturas "repetidas" durante segundos: solo una ventana pequeÃ±a para evitar spam por frame.
  const MACRO_SCAN_REPEAT_BLOCK_MS = 220;
  const MACRO_SCAN_LOOKUP_COOLDOWN_MS = 1800; // obligatorio: anti-duplicados (mismo código ~2s)
  const MACRO_SCAN_LOOKUP_TIMEOUT_MS = 6500;
  const MACRO_SCAN_ZXING_MAX_ATTEMPTS = 3;
  const OFF_PRODUCT_ENDPOINT = "https://world.openfoodfacts.org/api/v2/product";
  const MACRO_SCAN_DEBUG = (() => {
    try {
      return Boolean(window?.__MACRO_SCAN_DEBUG || window?.localStorage?.getItem("bookshell.macroScanDebug") === "1");
    } catch (_) {
      return false;
    }
  })();

  function ensureMacroScanLogPanel() {
    updateMacroScanOcrDebugCanvases();
    return $macroScanLogPanel || null;
  }

  function scheduleMacroScanUiLogsRender() {
    if (_macroScanUiRenderScheduled) return;
    _macroScanUiRenderScheduled = true;
    const run = () => {
      _macroScanUiRenderScheduled = false;
      renderMacroScanUiLogs();
    };
    try {
      if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") window.requestAnimationFrame(run);
      else setTimeout(run, 0);
    } catch (_) {
      try { setTimeout(run, 0); } catch (_) {}
    }
  }

  function renderMacroScanUiLogs() {
    const panel = ensureMacroScanLogPanel();
    if (!panel) return;
    panel.innerHTML = _macroScanUiLogs.map((line) => `<div class="macro-scan-log-row">${line}</div>`).join("");
    panel.scrollTop = panel.scrollHeight;
  }

  function clearMacroScanUiLogs() {
    _macroScanUiLogs = [];
    renderMacroScanUiLogs();
  }

  function setMacroScanOverlayBox(box = null) {
    if (!$macroScanOverlay) return;
    if (!box) {
      try {
        $macroScanOverlay.style.removeProperty("--scan-left");
        $macroScanOverlay.style.removeProperty("--scan-top");
        $macroScanOverlay.style.removeProperty("--scan-width");
        $macroScanOverlay.style.removeProperty("--scan-height");
        $macroScanOverlay.style.removeProperty("--scan-line-top");
      } catch (_) {}
      return;
    }
    try {
      $macroScanOverlay.style.setProperty("--scan-left", `${Math.max(0, Math.round(box.left || 0))}px`);
      $macroScanOverlay.style.setProperty("--scan-top", `${Math.max(0, Math.round(box.top || 0))}px`);
      $macroScanOverlay.style.setProperty("--scan-width", `${Math.max(0, Math.round(box.width || 0))}px`);
      $macroScanOverlay.style.setProperty("--scan-height", `${Math.max(0, Math.round(box.height || 0))}px`);
      $macroScanOverlay.style.setProperty("--scan-line-top", `${Math.max(0, Math.round(box.lineTop || 0))}px`);
    } catch (_) {}
  }

  function rectToShort(rect) {
    if (!rect) return null;
    return {
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    };
  }

  function elementBoxSnapshot(el) {
    if (!el) return null;
    const rect = el.getBoundingClientRect?.() || null;
    let cs = null;
    try {
      cs = window.getComputedStyle?.(el) || null;
    } catch (_) {
      cs = null;
    }
    const tag = String(el.tagName || "").toLowerCase();
    return {
      tag,
      id: el.id || "",
      class: typeof el.className === "string" ? el.className : "",
      rect: rectToShort(rect),
      box: {
        client: { w: el.clientWidth || 0, h: el.clientHeight || 0 },
        offset: { w: el.offsetWidth || 0, h: el.offsetHeight || 0 },
        scroll: { w: el.scrollWidth || 0, h: el.scrollHeight || 0 },
      },
      style: cs
        ? {
            display: cs.display,
            position: cs.position,
            top: cs.top,
            right: cs.right,
            bottom: cs.bottom,
            left: cs.left,
            width: cs.width,
            height: cs.height,
            maxWidth: cs.maxWidth,
            maxHeight: cs.maxHeight,
            overflow: cs.overflow,
            overflowX: cs.overflowX,
            overflowY: cs.overflowY,
            transform: cs.transform,
            objectFit: cs.objectFit,
            objectPosition: cs.objectPosition,
            borderRadius: cs.borderRadius,
            padding: cs.padding,
          }
        : null,
    };
  }

  function overlayVarsSnapshot() {
    if (!$macroScanOverlay) return null;
    try {
      const cs = window.getComputedStyle($macroScanOverlay);
      return {
        left: cs.getPropertyValue("--scan-left").trim(),
        top: cs.getPropertyValue("--scan-top").trim(),
        width: cs.getPropertyValue("--scan-width").trim(),
        height: cs.getPropertyValue("--scan-height").trim(),
        lineTop: cs.getPropertyValue("--scan-line-top").trim(),
      };
    } catch (_) {
      return null;
    }
  }

  function logMacroScanLayout(reason = "layout") {
    const now = Date.now();
    if (now - _macroScanLayoutLastAt < MACRO_SCAN_LAYOUT_LOG_EVERY_MS) return;
    _macroScanLayoutLastAt = now;
    const hostRect = $macroScanHtml5Host?.getBoundingClientRect?.() || null;
    const wrapRect = $macroScanVideoWrap?.getBoundingClientRect?.() || null;
    const videoEl = $macroScanHtml5Host?.querySelector?.("video") || $macroScanVideo || null;
    const videoRect = videoEl?.getBoundingClientRect?.() || null;
    logMacroScan("layout", {
      reason,
      viewfinder: _macroScanViewfinderPx,
      qrbox: _macroScanQrBoxPx,
      rects: {
        wrap: rectToShort(wrapRect),
        host: rectToShort(hostRect),
        video: rectToShort(videoRect),
      },
      dpr: Number(window.devicePixelRatio || 1),
    });
  }

  function logMacroScanLayoutDeep(reason = "layout_deep") {
    if (!MACRO_SCAN_DEBUG) return;
    const videoEl = $macroScanHtml5Host?.querySelector?.("video") || $macroScanVideo || null;
    const track = _macroScanStream?.getVideoTracks?.()?.[0] || null;
    const trackSettings = track?.getSettings?.() || null;
    const trackConstraints = track?.getConstraints?.() || null;
    logMacroScan("layout+", {
      reason,
      overlayVars: overlayVarsSnapshot(),
      wrap: elementBoxSnapshot($macroScanVideoWrap),
      host: elementBoxSnapshot($macroScanHtml5Host),
      overlay: elementBoxSnapshot($macroScanOverlay),
      video: elementBoxSnapshot(videoEl),
      videoIntrinsic: videoEl
        ? {
            readyState: videoEl.readyState || 0,
            w: videoEl.videoWidth || 0,
            h: videoEl.videoHeight || 0,
          }
        : null,
      viewfinder: _macroScanViewfinderPx,
      qrbox: _macroScanQrBoxPx,
      trackSettings,
      trackConstraints,
      dpr: Number(window.devicePixelRatio || 1),
    });
  }

  function readMacroScanHostPx() {
    const rect = $macroScanHtml5Host?.getBoundingClientRect?.() || null;
    if (!rect) return null;
    return { width: Math.round(rect.width), height: Math.round(rect.height) };
  }

  function hasMeaningfulMacroScanHostResize(prev, next) {
    if (!prev || !next) return true;
    const dw = Math.abs(Number(next.width) - Number(prev.width));
    const dh = Math.abs(Number(next.height) - Number(prev.height));
    return dw >= 24 || dh >= 24;
  }

  async function restartHtml5ScanInPlace(reason = "resize") {
    if (!_macroScanRunning || _macroScanEngine !== "html5") return;
    const prevRun = _macroScanEngineRunId;
    _macroScanEngineRunId += 1;
    const runId = _macroScanEngineRunId;
    logMacroScan("reinicio motor (layout)", { engine: "html5", reason, prevRun, runId });

    if (_macroScanHtml5Instance) {
      try { await _macroScanHtml5Instance.stop(); } catch (_) {}
      try { await _macroScanHtml5Instance.clear(); } catch (_) {}
      _macroScanHtml5Instance = null;
    }
    if ($macroScanHtml5Host) {
      try { $macroScanHtml5Host.innerHTML = ""; } catch (_) {}
      try { $macroScanHtml5Host.classList.remove("hidden"); } catch (_) {}
    }

    // Mantiene el flujo y logs; solo recalcula viewfinder/qrbox al reiniciar.
    try {
      await startHtml5Scan(runId);
      if ($macroScanPlacementHint) $macroScanPlacementHint.classList.remove("is-warning");
      setMacroScanStatus("Buscando codigo... Acerca el producto para que el número se vea grande y nítido.");
    } catch (err) {
      logScannerError("falló el reinicio del motor", { engine: "html5", error: err?.name || err?.message || err });
      setMacroScanStatus(`Error en html5: ${err?.name || err?.message || "fallo"}`);
      await stopMacroBarcodeScan({ keepStatus: true, keepPendingProduct: true });
    }
  }

  function hideHtml5QrcodeInternalOverlay() {
    if (!$macroScanHtml5Host) return;
    const videoEl = $macroScanHtml5Host?.querySelector?.("video") || null;
    if (!videoEl) return;
    let hidden = 0;
    try {
      const all = Array.from($macroScanHtml5Host.querySelectorAll("*"));
      all.forEach((el) => {
        if (!el || el === videoEl) return;
        if (typeof el.contains === "function" && el.contains(videoEl)) return;
        if (String(el.tagName || "").toUpperCase() === "CANVAS") {
          el.style.display = "none";
          hidden += 1;
          return;
        }
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
        el.style.userSelect = "none";
        hidden += 1;
      });
    } catch (_) {}
    if (hidden) logMacroScan("overlay interno oculto", { engine: "html5", hidden });
  }

  function isMacroScanNoReadMessage(message = "") {
    const msg = String(message || "");
    if (!msg) return false;
    return (
      /no multiformat readers/i.test(msg) ||
      /qr code parse error/i.test(msg) ||
      /notfoundexception/i.test(msg) ||
      /no code found/i.test(msg)
    );
  }

  function logMacroScanNoResult(engine, detail = "") {
    const key = String(engine || "").trim();
    if (!key) return;
    const now = Date.now();
    const prev = Number(_macroScanNoResultLastAt[key]) || 0;
    if (now - prev < MACRO_SCAN_NO_RESULT_LOG_EVERY_MS) return;
    _macroScanNoResultLastAt[key] = now;
    if (_macroScanRunning && _macroScanEngine === key) setMacroScanStatus("Buscando codigo...");
    // No es un error: es simplemente "sin lectura" en este frame.
    // Para evitar spam visual, solo lo mostramos en el panel si estÃ¡ activado el debug.
    const short = String(detail || "").slice(0, 120);
    if (!MACRO_SCAN_DEBUG) {
      try { console.info("[scanner] sin lectura (frame)", { engine: key }); } catch (_) {}
      return;
    }
    logMacroEvent(["scanner"], "sin lectura (frame)", { engine: key, detail: short }, "info");
  }

  function fmtMacroMeta(meta) {
    if (!meta || typeof meta !== "object") return "";
    const pairs = Object.entries(meta)
      .filter(([, val]) => val !== undefined && val !== null && val !== "")
      .map(([key, val]) => `${key}: ${typeof val === "object" ? JSON.stringify(val) : String(val)}`);
    return pairs.length ? ` · ${pairs.join(" · ")}` : "";
  }

  function logMacroEvent(tags = ["scanner"], message = "", meta, level = "info") {
    const safeTags = Array.isArray(tags) ? tags.filter(Boolean).map((t) => String(t).trim()).filter(Boolean) : ["scanner"];
    const prefix = safeTags.length ? safeTags.map((t) => `[${t}]`).join("") : "[log]";
    const line = `${prefix} ${String(message || "").trim()}`.trim();
    try {
      const fn = level === "error" ? console.error : (level === "warn" ? console.warn : console.info);
      if (meta !== undefined) fn(line, meta);
      else fn(line);
    } catch (_) {}
    try {
      _macroScanUiLogs.push(`<strong>${prefix}</strong> ${String(message || "").trim()}${fmtMacroMeta(meta)}`);
      if (_macroScanUiLogs.length > 60) _macroScanUiLogs = _macroScanUiLogs.slice(-60);
      scheduleMacroScanUiLogsRender();
    } catch (_) {}
  }

  function logScanner(message, meta) { logMacroEvent(["scanner"], message, meta, "info"); }
  function logScannerSuccess(message, meta) { logMacroEvent(["scanner", "success"], message, meta, "info"); }
  function logScannerWarn(message, meta) { logMacroEvent(["scanner", "warn"], message, meta, "warn"); }
  function logScannerError(message, meta) { logMacroEvent(["scanner", "error"], message, meta, "error"); }

  function logLookup(message, meta) { logMacroEvent(["lookup"], message, meta, "info"); }
  function logLookupSuccess(message, meta) { logMacroEvent(["lookup", "success"], message, meta, "info"); }
  function logLookupWarn(message, meta) { logMacroEvent(["lookup", "warn"], message, meta, "warn"); }
  function logLookupError(message, meta) { logMacroEvent(["lookup", "error"], message, meta, "error"); }

  function logLookupOff(message, meta, level = "info") {
    logMacroEvent(level === "error" ? ["lookup", "openfoodfacts", "error"] : ["lookup", "openfoodfacts"], message, meta, level);
  }
  function logLookupFoodRepo(message, meta, level = "info") {
    logMacroEvent(level === "error" ? ["lookup", "foodrepo", "error"] : ["lookup", "foodrepo"], message, meta, level);
  }

  // Compat: si queda algún logMacroScan antiguo, lo tratamos como scanner.
  function logMacroScan(event, meta) { logScanner(String(event || ""), meta); }

  function beginMacroScanLogSession(reason = "scan") {
    _macroScanSessionId += 1;
    clearMacroScanUiLogs();
    clearCapturedFrame();
    const ua = String(navigator.userAgent || "");
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    const standalone = Boolean(window.matchMedia?.("(display-mode: standalone)")?.matches || navigator.standalone);
    try {
      console.groupCollapsed(`[scanner] sesión #${_macroScanSessionId} · ${reason}`);
      console.info("Entorno", {
        ua,
        secure: window.isSecureContext,
        visibility: document.visibilityState,
        hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
        hostname: window.location.hostname,
        path: window.location.pathname,
        isIOS,
        standalone,
      });
      console.groupEnd();
    } catch (_) {}
    logScanner("entorno", {
      selectedEngine: _macroScanEngine,
      ua: ua.slice(0, 120),
      isIOS,
      standalone,
    });
  }

  function setMacroScanStatus(message = "") {
    if ($macroScanStatus) $macroScanStatus.textContent = String(message || "");
  }

  function setMacroScanEngineStatus(engine = "none") {
    _macroScanEngine = engine || "none";
    if ($macroScanEngineStatus) {
      const labels = { none: "ninguno", html5: "html5-qrcode" };
      $macroScanEngineStatus.textContent = `Motor activo: ${labels[_macroScanEngine] || _macroScanEngine}`;
    }
    const map = [
      [$macroScanEngineHtml5, "html5"],
    ];
    map.forEach(([btn, value]) => btn?.classList.toggle("primary", _macroScanEngine === value));
  }

  function hideMacroScanAddProduct() {
    _macroScanPendingLookup = null;
    if (!$macroScanAddProduct) return;
    $macroScanAddProduct.classList.add("hidden");
    $macroScanAddProduct.dataset.mode = "";
    $macroScanAddProduct.dataset.barcode = "";
    $macroScanAddProduct.dataset.pendingLookupId = "";
    $macroScanAddProduct.textContent = "Abrir ficha";
  }

  function showMacroScanAddProduct({ barcode = "", mode = "manual", label = "Crear producto manual", pendingProduct = null } = {}) {
    if (!$macroScanAddProduct) return;
    const lookupId = (pendingProduct && mode === "off") ? `${Date.now()}_${Math.random().toString(36).slice(2, 8)}` : "";
    _macroScanPendingLookup = lookupId
      ? { id: lookupId, product: { ...pendingProduct } }
      : null;
    $macroScanAddProduct.dataset.mode = String(mode || "manual");
    $macroScanAddProduct.dataset.barcode = String(barcode || "").trim();
    $macroScanAddProduct.dataset.pendingLookupId = lookupId;
    $macroScanAddProduct.textContent = label || (mode === "off" ? "Abrir ficha" : "Crear producto manual");
    $macroScanAddProduct.classList.remove("hidden");
  }

  function computeModulo10CheckDigit(body = "") {
    const digits = String(body || "").replace(/\D/g, "");
    if (!digits) return null;
    const sum = digits
      .split("")
      .reverse()
      .reduce((acc, ch, idx) => {
        const n = Number(ch) || 0;
        return acc + n * (idx % 2 === 0 ? 3 : 1);
      }, 0);
    return (10 - (sum % 10)) % 10;
  }

  function validateBarcodeByType(digits = "") {
    const code = String(digits || "").replace(/\D/g, "");
    if (!code) return { valid: false, type: "", reason: "empty" };
    const len = code.length;
    const type = len === 13 ? "ean13" : (len === 8 ? "ean8" : (len === 12 ? "upca" : ""));
    if (!type) return { valid: false, type: "", reason: `unsupported_length_${len}` };
    const body = code.slice(0, -1);
    const check = Number(code.slice(-1));
    if (!Number.isFinite(check)) return { valid: false, type, reason: "invalid_check_digit" };
    const expected = computeModulo10CheckDigit(body);
    const valid = Number(expected) === check;
    return {
      valid,
      type,
      reason: valid ? "ok" : "checksum_mismatch",
      expected,
      actual: check,
      digits: code,
    };
  }

  function isValidBarcodeChecksum(digits = "") {
    return validateBarcodeByType(digits).valid;
  }

  function normalizeBarcodeText(value, { strict = true } = {}) {
    const raw = String(value || "").trim();
    if (!raw) return "";
    const digits = raw.replace(/\D/g, "");
    const check = validateBarcodeByType(digits);
    if (!check.type) return "";
    if (strict && !check.valid) return "";
    return digits;
  }

  function normalizeDetectedBarcode(value) {
    return normalizeBarcodeText(value, { strict: true }) || normalizeBarcodeText(value, { strict: false }) || "";
  }

  function extractOcrDigitCandidates(rawText = "") {
    const raw = String(rawText || "");
    const blocks = raw.match(/[0-9OolI|\s\-_.:,;]{6,40}/g) || [];
    const expanded = blocks.length ? blocks : [raw];
    const fromTokens = [];
    expanded.forEach((block) => {
      const normalizedBlock = String(block || "").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1");
      const tokens = normalizedBlock.split(/\s+/).filter(Boolean);
      if (tokens.length > 1) {
        for (let i = 0; i < tokens.length; i += 1) {
          for (let j = i + 1; j <= tokens.length; j += 1) {
            fromTokens.push(tokens.slice(i, j).join(""));
          }
        }
      }
      fromTokens.push(normalizedBlock);
    });
    const all = [...expanded, ...fromTokens]
      .map((part) => String(part || "").replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^\d]/g, ""))
      .filter((v) => v.length >= 7);
    const uniq = [...new Set(all)];
    const candidates = [];
    uniq.forEach((digits) => {
      [13, 12, 8].forEach((len) => {
        if (digits.length < len) return;
        for (let i = 0; i <= digits.length - len; i += 1) {
          candidates.push(digits.slice(i, i + len));
        }
      });
    });
    return [...new Set(candidates)];
  }

  function ensureCanvasFromSource(source) {
    if (!source) return null;
    if (source instanceof HTMLCanvasElement) return source;
    if (!(source instanceof HTMLVideoElement) && !(source instanceof HTMLImageElement)) return null;
    const w = Number(source.videoWidth || source.naturalWidth || source.width) || 0;
    const h = Number(source.videoHeight || source.naturalHeight || source.height) || 0;
    if (!w || !h) return null;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(source, 0, 0, w, h);
    return canvas;
  }

  function updateMacroScanOcrDebugCanvases() {
    if (!$macroScanOcrDebug || !$macroScanOcrSource || !$macroScanOcrCrop || !$macroScanOcrFinal) return;
    $macroScanOcrDebug.classList.toggle("hidden", !MACRO_SCAN_DEBUG);
    if (!MACRO_SCAN_DEBUG) return;
    const draw = (target, source) => {
      if (!target) return;
      const ctx = target.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const srcCanvas = ensureCanvasFromSource(source);
      ctx.clearRect(0, 0, target.width, target.height);
      if (!srcCanvas) return;
      ctx.drawImage(srcCanvas, 0, 0, srcCanvas.width, srcCanvas.height, 0, 0, target.width, target.height);
    };
    draw($macroScanOcrSource, _macroScanOcrDebugState.source);
    draw($macroScanOcrCrop, _macroScanOcrDebugState.crop);
    draw($macroScanOcrFinal, _macroScanOcrDebugState.final);
  }

  function pickMacroScanRearCamera(devices = []) {
    const list = Array.isArray(devices) ? devices.filter((d) => d?.kind === "videoinput") : [];
    if (!list.length) return null;
    const scoreLabel = (label = "") => {
      const low = String(label || "").toLowerCase();
      let score = 0;
      if (/back|rear|environment|trase|trasera/.test(low)) score += 90;
      if (/wide|ultra|macro|tele|zoom|focus/.test(low)) score += 12;
      if (/front|user|facetime|selfie/.test(low)) score -= 120;
      return score;
    };
    const sorted = [...list].sort((a, b) => scoreLabel(b?.label) - scoreLabel(a?.label));
    return sorted[0] || null;
  }

  function getMacroScanActiveVideoTrack() {
    const hostVideo = $macroScanHtml5Host?.querySelector?.("video") || null;
    const hostStream = hostVideo?.srcObject || null;
    const hostTrack = hostStream?.getVideoTracks?.()?.[0] || null;
    const ownTrack = _macroScanStream?.getVideoTracks?.()?.[0] || null;
    return hostTrack || ownTrack || _macroScanCameraTrack || null;
  }

  function logMacroScanTrackDiagnostics(track, source = "track") {
    if (!track) {
      logMacroEvent(["scanner", "camera", "warn"], "sin track de vídeo activo", { source }, "warn");
      return;
    }
    const capabilities = typeof track.getCapabilities === "function" ? (track.getCapabilities() || {}) : {};
    const settings = typeof track.getSettings === "function" ? (track.getSettings() || {}) : {};
    logMacroEvent(["scanner", "camera", "capabilities"], "capabilities del track", {
      source,
      zoom: capabilities.zoom || null,
      focusMode: capabilities.focusMode || null,
      torch: capabilities.torch || null,
      width: capabilities.width || null,
      height: capabilities.height || null,
    }, "info");
    logMacroEvent(["scanner", "camera", "settings"], "settings del track", {
      source,
      zoom: settings.zoom ?? null,
      focusMode: settings.focusMode || null,
      torch: settings.torch ?? null,
      width: settings.width || null,
      height: settings.height || null,
      frameRate: settings.frameRate || null,
      deviceId: settings.deviceId || null,
      facingMode: settings.facingMode || null,
    }, "info");
  }

  async function applyMacroScanTrackConstraint(track, advancedConstraint = {}, tag = "camera") {
    if (!track || typeof track.applyConstraints !== "function") return false;
    try {
      await track.applyConstraints({ advanced: [advancedConstraint] });
      logMacroEvent(["scanner", "camera", tag], "constraint aplicada", { advanced: advancedConstraint }, "info");
      return true;
    } catch (err) {
      logMacroEvent(["scanner", "camera", tag, "warn"], "no se pudo aplicar constraint", {
        advanced: advancedConstraint,
        error: err?.name || err?.message || err,
      }, "warn");
      return false;
    }
  }

  async function configureMacroScanTrack(track) {
    if (!track) return;
    _macroScanCameraTrack = track;
    const capabilities = typeof track.getCapabilities === "function" ? (track.getCapabilities() || {}) : {};

    await applyMacroScanTrackConstraint(track, { width: 1920, height: 1080, aspectRatio: 16 / 9 }, "resolution");
    await applyMacroScanTrackConstraint(track, { width: 1280, height: 720 }, "resolution");

    const focusModes = Array.isArray(capabilities.focusMode) ? capabilities.focusMode : [];
    if (focusModes.length) {
      const preferred = focusModes.includes("continuous")
        ? "continuous"
        : (focusModes.includes("single-shot") ? "single-shot" : focusModes[0]);
      if (preferred) {
        await applyMacroScanTrackConstraint(track, { focusMode: preferred }, "focus");
      }
    } else {
      logMacroEvent(["scanner", "camera", "focus"], "focusMode no soportado por el dispositivo", {}, "info");
    }

    const zoomCaps = capabilities.zoom;
    if (zoomCaps && Number.isFinite(Number(zoomCaps.max))) {
      const min = Number.isFinite(Number(zoomCaps.min)) ? Number(zoomCaps.min) : 1;
      const max = Number(zoomCaps.max);
      const step = Number.isFinite(Number(zoomCaps.step)) ? Number(zoomCaps.step) : 0;
      const targetBase = max >= 2 ? 2 : max;
      let target = Math.max(min, Math.min(max, targetBase));
      if (step > 0) {
        const n = Math.round((target - min) / step);
        target = min + n * step;
      }
      await applyMacroScanTrackConstraint(track, { zoom: target }, "zoom");
      logMacroEvent(["scanner", "camera", "zoom"], "zoom inicial evaluado", { min, max, step, requested: targetBase, applied: target }, "info");
    } else {
      logMacroEvent(["scanner", "camera", "zoom"], "zoom no soportado por el dispositivo", {}, "info");
    }

    const settings = typeof track.getSettings === "function" ? (track.getSettings() || {}) : {};
    _macroScanCameraProfile = { capabilities, settings };
    logMacroScanTrackDiagnostics(track, "configured");
  }

  async function setMacroScanZoom(targetZoom) {
    const track = getMacroScanActiveVideoTrack();
    if (!track) return { ok: false, reason: "no-track" };
    const caps = typeof track.getCapabilities === "function" ? (track.getCapabilities() || {}) : {};
    if (!caps.zoom || !Number.isFinite(Number(caps.zoom.max))) {
      logMacroEvent(["scanner", "camera", "zoom"], "set zoom omitido: no soportado", { requested: targetZoom }, "info");
      return { ok: false, reason: "no-zoom-capability" };
    }
    const min = Number.isFinite(Number(caps.zoom.min)) ? Number(caps.zoom.min) : 1;
    const max = Number(caps.zoom.max);
    const requested = Number.isFinite(Number(targetZoom)) ? Number(targetZoom) : max;
    const zoom = Math.max(min, Math.min(max, requested));
    const ok = await applyMacroScanTrackConstraint(track, { zoom }, "zoom");
    const current = track.getSettings?.()?.zoom;
    logMacroEvent(["scanner", "camera", "zoom"], ok ? "zoom aplicado programáticamente" : "zoom no aplicado", { requested, applied: current ?? zoom, min, max }, ok ? "info" : "warn");
    return { ok, zoom: current ?? zoom, min, max };
  }

  function parseCssLengthToPx(value, basePx = 0) {
    const raw = String(value || "").trim();
    if (!raw) return 0;
    if (raw.endsWith("%")) {
      const pct = Number.parseFloat(raw.slice(0, -1));
      return Number.isFinite(pct) ? (basePx * pct) / 100 : 0;
    }
    const px = Number.parseFloat(raw);
    return Number.isFinite(px) ? px : 0;
  }

  function getScannerGuideRect(wrapperRect) {
    if (!$macroScanOverlay || !wrapperRect?.width || !wrapperRect?.height) return null;
    const styles = window.getComputedStyle($macroScanOverlay);
    const hidden = styles.display === "none" || styles.visibility === "hidden" || Number(styles.opacity || 1) === 0;
    if (hidden) return null;
    const left = parseCssLengthToPx(styles.getPropertyValue("--scan-left"), wrapperRect.width);
    const top = parseCssLengthToPx(styles.getPropertyValue("--scan-top"), wrapperRect.height);
    const width = parseCssLengthToPx(styles.getPropertyValue("--scan-width"), wrapperRect.width);
    const height = parseCssLengthToPx(styles.getPropertyValue("--scan-height"), wrapperRect.height);
    if (width < 2 || height < 2) return null;
    return {
      left: Math.max(0, Math.min(wrapperRect.width, left)),
      top: Math.max(0, Math.min(wrapperRect.height, top)),
      width: Math.max(1, Math.min(wrapperRect.width, width)),
      height: Math.max(1, Math.min(wrapperRect.height, height)),
    };
  }

  function captureVisibleScannerFrame({ useGuide = true } = {}) {
    const srcVideo = ($macroScanVideo && $macroScanVideo.videoWidth && $macroScanVideo.videoHeight)
      ? $macroScanVideo
      : ($macroScanHtml5Host?.querySelector?.("video") || null);
    if (!srcVideo || !srcVideo.videoWidth || !srcVideo.videoHeight) return null;
    const wrapper = $macroScanVideoWrap || srcVideo.parentElement || null;
    const wrapperRect = wrapper?.getBoundingClientRect?.();
    const videoRect = srcVideo.getBoundingClientRect?.();
    if (!wrapperRect?.width || !wrapperRect?.height || !videoRect?.width || !videoRect?.height) return ensureCanvasFromSource(srcVideo);

    const srcW = srcVideo.videoWidth;
    const srcH = srcVideo.videoHeight;
    const fit = String(window.getComputedStyle(srcVideo).objectFit || "contain").trim().toLowerCase();
    const normFit = ["cover", "contain", "fill", "none", "scale-down"].includes(fit) ? fit : "contain";
    const scaleContain = Math.min(wrapperRect.width / srcW, wrapperRect.height / srcH);
    const scaleCover = Math.max(wrapperRect.width / srcW, wrapperRect.height / srcH);
    let renderScale = normFit === "cover" ? scaleCover : scaleContain;
    if (normFit === "fill") {
      renderScale = null;
    } else if (normFit === "none") {
      renderScale = 1;
    } else if (normFit === "scale-down") {
      renderScale = Math.min(1, scaleContain);
    }

    const renderedW = normFit === "fill" ? wrapperRect.width : srcW * (renderScale || 1);
    const renderedH = normFit === "fill" ? wrapperRect.height : srcH * (renderScale || 1);
    const renderedLeft = (wrapperRect.width - renderedW) / 2;
    const renderedTop = (wrapperRect.height - renderedH) / 2;

    logMacroEvent(["scanner", "capture", "geometry"], "geometría de captura calculada", {
      source: `${srcW}x${srcH}`,
      wrap: `${Math.round(wrapperRect.width)}x${Math.round(wrapperRect.height)}`,
      rendered: `${Math.round(renderedW)}x${Math.round(renderedH)}`,
      fit: normFit,
    }, "info");

    const visibleRect = {
      left: 0,
      top: 0,
      width: wrapperRect.width,
      height: wrapperRect.height,
    };
    const guideRect = useGuide ? getScannerGuideRect(wrapperRect) : null;
    const targetRect = guideRect || visibleRect;

    const clipLeft = Math.max(targetRect.left, renderedLeft);
    const clipTop = Math.max(targetRect.top, renderedTop);
    const clipRight = Math.min(targetRect.left + targetRect.width, renderedLeft + renderedW);
    const clipBottom = Math.min(targetRect.top + targetRect.height, renderedTop + renderedH);
    const clipW = Math.max(1, clipRight - clipLeft);
    const clipH = Math.max(1, clipBottom - clipTop);

    const toSourceX = srcW / renderedW;
    const toSourceY = srcH / renderedH;
    const sx = Math.max(0, Math.min(srcW - 1, (clipLeft - renderedLeft) * toSourceX));
    const sy = Math.max(0, Math.min(srcH - 1, (clipTop - renderedTop) * toSourceY));
    const sWidth = Math.max(1, Math.min(srcW - sx, clipW * toSourceX));
    const sHeight = Math.max(1, Math.min(srcH - sy, clipH * toSourceY));

    if (!_macroScanFrameCanvas) _macroScanFrameCanvas = document.createElement("canvas");
    _macroScanFrameCanvas.width = Math.round(sWidth);
    _macroScanFrameCanvas.height = Math.round(sHeight);
    const ctx = _macroScanFrameCanvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(
      srcVideo,
      sx,
      sy,
      sWidth,
      sHeight,
      0,
      0,
      _macroScanFrameCanvas.width,
      _macroScanFrameCanvas.height,
    );
    logMacroEvent(["scanner", "capture", "crop"], "crop visible aplicado", {
      sx: Math.round(sx),
      sy: Math.round(sy),
      sWidth: Math.round(sWidth),
      sHeight: Math.round(sHeight),
      guide: guideRect ? `${Math.round(guideRect.width)}x${Math.round(guideRect.height)}` : "off",
    }, "info");
    logMacroEvent(["scanner", "capture", "success"], "captura visible lista para análisis", {
      output: `${_macroScanFrameCanvas.width}x${_macroScanFrameCanvas.height}`,
    }, "info");
    _macroScanOcrDebugState.source = _macroScanFrameCanvas;
    updateMacroScanOcrDebugCanvases();
    return _macroScanFrameCanvas;
  }

  function captureMacroScanFrame() {
    return captureVisibleScannerFrame({ useGuide: true });
  }



  function clearCapturedFrame() {
    _macroScanCapturedFrame = null;
    _macroScanCapturedAt = 0;
    if ($macroScanRetry) $macroScanRetry.classList.add("hidden");
    if ($macroScanFrozen) {
      const ctx = $macroScanFrozen.getContext("2d");
      if (ctx) ctx.clearRect(0, 0, $macroScanFrozen.width || 0, $macroScanFrozen.height || 0);
      $macroScanFrozen.classList.add("hidden");
    }
  }

  function freezeScannerPreview(imageSource) {
    if (!imageSource || !$macroScanFrozen) return;
    $macroScanFrozen.width = imageSource.width;
    $macroScanFrozen.height = imageSource.height;
    const ctx = $macroScanFrozen.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(imageSource, 0, 0, imageSource.width, imageSource.height);
    $macroScanFrozen.classList.remove("hidden");
    logMacroEvent(["scanner", "freeze"], "preview congelada con foto en memoria", {
      source: `${imageSource.width}x${imageSource.height}`,
      canvas: `${$macroScanFrozen.width}x${$macroScanFrozen.height}`,
      streamActiveBeforeStop: Boolean(_macroScanStream?.active),
    }, "info");
  }

  async function captureScannerFrame(reason = "capture_button") {
    logMacroEvent(["scanner", "capture"], "capturando frame estático", { reason }, "info");
    const frame = getScannerAnalysisFrame();
    if (!frame) {
      logMacroEvent(["scanner", "capture", "error"], "no se pudo capturar frame", { reason }, "error");
      return null;
    }
    _macroScanCapturedFrame = ensureCanvasFromSource(frame);
    _macroScanCapturedAt = Date.now();
    freezeScannerPreview(_macroScanCapturedFrame);
    await stopMacroBarcodeScan({ keepStatus: true, keepPendingProduct: true, keepFrozenFrame: true });
    logMacroEvent(["scanner", "capture", "success"], "captura completada", {
      reason,
      resolution: `${_macroScanCapturedFrame?.width || 0}x${_macroScanCapturedFrame?.height || 0}`,
      streamStopped: !_macroScanStream,
    }, "info");
    return _macroScanCapturedFrame;
  }

  async function resumeScannerPreview() {
    logMacroEvent(["scanner", "resume"], "reabriendo cámara para reintento", {}, "info");
    clearCapturedFrame();
    if ($macroScanRetry) $macroScanRetry.classList.add("hidden");
    await startScannerPreview();
  }

  function getScannerAnalysisFrame() {
    if (_macroScanCapturedFrame) return _macroScanCapturedFrame;
    return captureMacroScanFrame();
  }

  async function analyzeCapturedFrame(reason = "capture_flow") {
    const frame = getScannerAnalysisFrame();
    logMacroEvent(["scanner", "analyze"], "iniciando análisis sobre imagen estática", {
      reason,
      hasCaptured: Boolean(_macroScanCapturedFrame),
      source: frame ? `${frame.width}x${frame.height}` : "0x0",
    }, "info");
    if (!frame) return "";
    const zxingCode = await runMacroScanZxingBarcodePass(`captured:${reason}`);
    logMacroEvent(["scanner", "analyze", "barcode"], zxingCode ? "barcode detectado" : "barcode no detectado", {
      engine: "zxing",
      fallbackToOcr: !zxingCode,
      source: `${frame.width}x${frame.height}`,
    }, zxingCode ? "info" : "warn");
    if (zxingCode) return zxingCode;
    const ocrCode = await runMacroScanOcrPass(`captured:${reason}`);
    logMacroEvent(["scanner", "analyze", "ocr"], ocrCode ? "OCR detectó código" : "OCR sin resultado", {
      fallback: true,
      source: `${frame.width}x${frame.height}`,
    }, ocrCode ? "info" : "warn");
    return ocrCode || "";
  }

  function createMacroScanCenterCrop(sourceCanvas, cfg = { name: "center_band", xPct: 0.14, yPct: 0.36, wPct: 0.72, hPct: 0.28 }) {
    const w = Math.max(1, Number(sourceCanvas?.width) || 0);
    const h = Math.max(1, Number(sourceCanvas?.height) || 0);
    if (!w || !h) return null;
    const crop = {
      name: String(cfg?.name || "center_band"),
      x: Math.max(0, Math.round(w * (Number(cfg?.xPct) || 0))),
      y: Math.max(0, Math.round(h * (Number(cfg?.yPct) || 0))),
      width: Math.max(80, Math.round(w * (Number(cfg?.wPct) || 0.72))),
      height: Math.max(56, Math.round(h * (Number(cfg?.hPct) || 0.28))),
    };
    if (crop.x + crop.width > w) crop.width = Math.max(1, w - crop.x);
    if (crop.y + crop.height > h) crop.height = Math.max(1, h - crop.y);
    const canvas = document.createElement("canvas");
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
    return { crop, canvas };
  }

  async function getMacroScanNativeBarcodeSupport() {
    if (_macroScanNativeBarcodeSupport) return _macroScanNativeBarcodeSupport;
    const preferred = ["ean_8", "ean_13", "upc_a", "upc_e"];
    const hasDetector = typeof window !== "undefined" && typeof window.BarcodeDetector === "function";
    logMacroEvent(["scanner", "barcode", "native"], "disponibilidad BarcodeDetector evaluada", { available: hasDetector }, "info");
    if (!hasDetector) {
      _macroScanNativeBarcodeSupport = { available: false, supportedFormats: [], preferredFormats: preferred };
      return _macroScanNativeBarcodeSupport;
    }
    let supportedFormats = [];
    try {
      if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
        supportedFormats = await window.BarcodeDetector.getSupportedFormats();
      }
    } catch (err) {
      logMacroEvent(["scanner", "barcode", "native", "warn"], "error leyendo formatos soportados", { error: err?.name || err?.message || err }, "warn");
    }
    const list = Array.isArray(supportedFormats) ? supportedFormats.map((f) => String(f || "").toLowerCase()).filter(Boolean) : [];
    const prioritized = preferred.filter((fmt) => list.includes(fmt));
    logMacroEvent(["scanner", "barcode", "native"], "formatos soportados leídos", {
      supportedFormats: list,
      prioritizedFormats: prioritized,
      preferred,
    }, "info");
    _macroScanNativeBarcodeSupport = { available: true, supportedFormats: list, preferredFormats: prioritized };
    return _macroScanNativeBarcodeSupport;
  }

  function pickValidBarcodeFromDetections(detections = [], stage = "native") {
    for (const item of (Array.isArray(detections) ? detections : [])) {
      const raw = String(item?.rawValue || item?.raw || "").trim();
      const clean = normalizeDetectedBarcode(raw);
      if (!clean) {
        logMacroEvent(["scanner", "barcode", stage, "warn"], "detección descartada por parse", { raw }, "warn");
        continue;
      }
      const validation = validateBarcodeByType(clean);
      if (!validation.valid) {
        logMacroEvent(["scanner", "barcode", stage, "warn"], "detección descartada por checksum", {
          raw,
          clean,
          type: validation.type || "unknown",
          reason: validation.reason,
          expected: validation.expected,
          actual: validation.actual,
        }, "warn");
        continue;
      }
      return { code: clean, raw };
    }
    return null;
  }

  async function runMacroScanNativeBarcodePass(reason = "manual_button") {
    logMacroEvent(["scanner", "barcode", "native"], "inicio detección nativa", { reason }, "info");
    const support = await getMacroScanNativeBarcodeSupport();
    if (!support.available) {
      logMacroEvent(["scanner", "barcode", "native", "warn"], "BarcodeDetector no compatible", { reason }, "warn");
      return "";
    }
    if (!support.preferredFormats.length) {
      logMacroEvent(["scanner", "barcode", "native", "warn"], "sin formatos EAN/UPC soportados por navegador", { supportedFormats: support.supportedFormats }, "warn");
      return "";
    }
    const frame = captureMacroScanFrame();
    if (!frame) {
      logMacroEvent(["scanner", "barcode", "native", "error"], "sin frame congelado", { reason }, "error");
      return "";
    }
    _macroScanOcrDebugState.source = frame;
    const detector = new window.BarcodeDetector({ formats: support.preferredFormats });
    const attempts = [{ label: "full_frame", canvas: frame }];
    const centerCrop = createMacroScanCenterCrop(frame);
    if (centerCrop?.canvas) attempts.push({ label: centerCrop.crop.name, canvas: centerCrop.canvas, crop: centerCrop.crop });

    for (const attempt of attempts) {
      try {
        if (attempt.canvas !== frame) _macroScanOcrDebugState.crop = attempt.canvas;
        updateMacroScanOcrDebugCanvases();
        logMacroEvent(["scanner", "barcode", "native"], "intentando detección", {
          reason,
          attempt: attempt.label,
          frame: `${attempt.canvas.width}x${attempt.canvas.height}`,
          crop: attempt.crop ? `${attempt.crop.x},${attempt.crop.y},${attempt.crop.width},${attempt.crop.height}` : "none",
        }, "info");
        const detections = await detector.detect(attempt.canvas);
        const winner = pickValidBarcodeFromDetections(detections, "native");
        if (winner?.code) {
          logMacroEvent(["scanner", "barcode", "native", "success"], "barcode detectado con detector nativo", {
            code: winner.code,
            rawValue: winner.raw,
            attempt: attempt.label,
          }, "info");
          return winner.code;
        }
        logMacroEvent(["scanner", "barcode", "native", "warn"], "sin lectura válida en intento", { attempt: attempt.label, detections: detections?.length || 0 }, "warn");
      } catch (err) {
        logMacroEvent(["scanner", "barcode", "native", "error"], "fallo detectando en frame congelado", {
          attempt: attempt.label,
          error: err?.name || err?.message || err,
        }, "error");
      }
    }
    return "";
  }

  async function runMacroScanImageDecodePass(reason = "manual_button") {
    logMacroEvent(["scanner", "barcode", "image"], "inicio decode sobre imagen fija", { reason }, "info");
    const frame = captureMacroScanFrame();
    if (!frame) {
      logMacroEvent(["scanner", "barcode", "image", "error"], "sin frame congelado", { reason }, "error");
      return "";
    }
    const mod = await loadMacroScanHtml5Module();
    const Html5Qrcode = mod?.Html5Qrcode || mod?.default?.Html5Qrcode || mod?.default;
    if (!Html5Qrcode?.scanFileV2) {
      logMacroEvent(["scanner", "barcode", "image", "warn"], "html5-qrcode scanFileV2 no disponible", { reason }, "warn");
      return "";
    }
    const attempts = [{ label: "full_frame", canvas: frame }];
    const centerCrop = createMacroScanCenterCrop(frame, { name: "center_band_image", xPct: 0.16, yPct: 0.34, wPct: 0.68, hPct: 0.30 });
    if (centerCrop?.canvas) attempts.push({ label: centerCrop.crop.name, canvas: centerCrop.canvas, crop: centerCrop.crop });
    for (const attempt of attempts) {
      try {
        _macroScanOcrDebugState.crop = attempt.canvas;
        updateMacroScanOcrDebugCanvases();
        logMacroEvent(["scanner", "barcode", "image"], "intentando decode de imagen", {
          attempt: attempt.label,
          frame: `${attempt.canvas.width}x${attempt.canvas.height}`,
          crop: attempt.crop ? `${attempt.crop.x},${attempt.crop.y},${attempt.crop.width},${attempt.crop.height}` : "none",
        }, "info");
        const scanRes = await Html5Qrcode.scanFileV2(attempt.canvas.toDataURL("image/jpeg", 0.95), true);
        const raw = String(scanRes?.getText?.() || "");
        const winner = pickValidBarcodeFromDetections([{ rawValue: raw }], "image");
        if (winner?.code) {
          logMacroEvent(["scanner", "barcode", "image", "success"], "barcode detectado por decode de imagen", {
            code: winner.code,
            rawValue: winner.raw,
            attempt: attempt.label,
          }, "info");
          return winner.code;
        }
        logMacroEvent(["scanner", "barcode", "image", "warn"], "decode devolvió valor inválido", { attempt: attempt.label, rawValue: raw }, "warn");
      } catch (err) {
        logMacroEvent(["scanner", "barcode", "image", "warn"], "decode sobre imagen sin lectura", {
          attempt: attempt.label,
          error: err?.name || err?.message || err,
        }, "warn");
      }
    }
    return "";
  }

  function rotateCanvas90(sourceCanvas) {
    const srcW = Math.max(1, Number(sourceCanvas?.width) || 0);
    const srcH = Math.max(1, Number(sourceCanvas?.height) || 0);
    if (!srcW || !srcH) return null;
    const rotated = document.createElement("canvas");
    rotated.width = srcH;
    rotated.height = srcW;
    const ctx = rotated.getContext("2d", { willReadFrequently: true });
    if (!ctx) return null;
    ctx.translate(rotated.width / 2, rotated.height / 2);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(sourceCanvas, -srcW / 2, -srcH / 2, srcW, srcH);
    return rotated;
  }

  async function runMacroScanZxingBarcodePass(reason = "manual_button") {
    logMacroEvent(["scanner", "barcode", "zxing"], "inicio decode de barras sobre frame congelado", { reason }, "info");
    const frame = getScannerAnalysisFrame();
    if (!frame) {
      logMacroEvent(["scanner", "barcode", "zxing", "error"], "sin frame congelado", { reason }, "error");
      return "";
    }
    let mod = null;
    try {
      mod = await loadMacroScanZxingModule();
    } catch (err) {
      logMacroEvent(["scanner", "barcode", "zxing", "error"], "no se pudo cargar ZXing", { error: err?.name || err?.message || err }, "error");
      return "";
    }
    const BrowserMultiFormatReader = mod?.BrowserMultiFormatReader || mod?.default?.BrowserMultiFormatReader;
    const DecodeHintType = mod?.DecodeHintType || mod?.default?.DecodeHintType;
    const BarcodeFormat = mod?.BarcodeFormat || mod?.default?.BarcodeFormat;
    if (!BrowserMultiFormatReader) {
      logMacroEvent(["scanner", "barcode", "zxing", "error"], "módulo ZXing inválido", { hasReader: false }, "error");
      return "";
    }

    const hints = new Map();
    if (DecodeHintType?.POSSIBLE_FORMATS && BarcodeFormat) {
      const possibleFormats = [
        BarcodeFormat.EAN_8,
        BarcodeFormat.EAN_13,
        BarcodeFormat.UPC_A,
        BarcodeFormat.UPC_E,
      ].filter((v) => typeof v !== "undefined");
      if (possibleFormats.length) hints.set(DecodeHintType.POSSIBLE_FORMATS, possibleFormats);
    }
    const reader = new BrowserMultiFormatReader(hints, 500);

    const attempts = [{ label: "full_frame", mode: "full", canvas: frame, rotated: false }];
    const centerCrop = createMacroScanCenterCrop(frame, { name: "center_band", xPct: 0.14, yPct: 0.36, wPct: 0.72, hPct: 0.28 });
    if (centerCrop?.canvas) attempts.push({ label: centerCrop.crop.name, mode: "crop_center", canvas: centerCrop.canvas, crop: centerCrop.crop, rotated: false });
    const lowerCrop = createMacroScanCenterCrop(frame, { name: "lower_band", xPct: 0.10, yPct: 0.62, wPct: 0.80, hPct: 0.28 });
    if (lowerCrop?.canvas) {
      const rotatedLower = rotateCanvas90(lowerCrop.canvas);
      attempts.push({
        label: "lower_band_rot90",
        mode: "crop_lower",
        canvas: rotatedLower || lowerCrop.canvas,
        crop: lowerCrop.crop,
        rotated: Boolean(rotatedLower),
      });
    }
    const attemptsToRun = attempts.slice(0, MACRO_SCAN_ZXING_MAX_ATTEMPTS);

    for (const attempt of attemptsToRun) {
      try {
        _macroScanOcrDebugState.crop = attempt.canvas;
        updateMacroScanOcrDebugCanvases();
        logMacroEvent(["scanner", "barcode", "zxing", "image"], "intentando decode", {
          reason,
          mode: attempt.mode,
          attempt: attempt.label,
          rotated90: attempt.rotated,
          frame: `${attempt.canvas.width}x${attempt.canvas.height}`,
          sourceFrame: `${frame.width}x${frame.height}`,
          crop: attempt.crop ? `${attempt.crop.x},${attempt.crop.y},${attempt.crop.width},${attempt.crop.height}` : "none",
        }, "info");

        let result = null;
        if (typeof reader.decodeFromCanvas === "function") {
          result = await reader.decodeFromCanvas(attempt.canvas);
        } else if (typeof reader.decodeFromImageElement === "function") {
          const img = new Image();
          img.src = attempt.canvas.toDataURL("image/jpeg", 0.95);
          await new Promise((resolve, reject) => {
            img.onload = () => resolve();
            img.onerror = (err) => reject(err || new Error("image_load_error"));
          });
          result = await reader.decodeFromImageElement(img);
        } else {
          throw new Error("zxing_reader_no_image_decode_api");
        }

        const raw = String(result?.getText?.() || "").trim();
        const clean = normalizeDetectedBarcode(raw);
        const validation = validateBarcodeByType(clean || raw);
        if (clean && validation.valid) {
          logMacroEvent(["scanner", "barcode", "success"], "barcode detectado por ZXing", {
            engine: "zxing",
            mode: attempt.mode,
            attempt: attempt.label,
            rotated90: attempt.rotated,
            raw,
            clean,
            checksum: validation.valid,
            type: validation.type || "unknown",
            sourceFrame: `${frame.width}x${frame.height}`,
          }, "info");
          return clean;
        }
        logMacroEvent(["scanner", "barcode", "warn"], "ZXing devolvió código inválido", {
          engine: "zxing",
          mode: attempt.mode,
          attempt: attempt.label,
          rotated90: attempt.rotated,
          raw,
          clean,
          checksum: validation.valid,
          type: validation.type || "unknown",
          reason: validation.reason,
        }, "warn");
      } catch (err) {
        logMacroEvent(["scanner", "barcode", "zxing", "warn"], "sin lectura válida en intento", {
          mode: attempt.mode,
          attempt: attempt.label,
          rotated90: attempt.rotated,
          error: err?.name || err?.message || err,
        }, "warn");
      }
    }
    logMacroEvent(["scanner", "barcode", "error"], "ZXing no encontró EAN válido en frame congelado", {
      engine: "zxing",
      reason,
      attempts: attemptsToRun.map((a) => `${a.label}:${a.mode}:rot90=${a.rotated ? "1" : "0"}`).join(","),
      sourceFrame: `${frame.width}x${frame.height}`,
    }, "error");
    return "";
  }


  async function loadMacroScanHtml5Module() {
    if (_macroScanHtml5Module) return _macroScanHtml5Module;
    _macroScanHtml5Module = await import("https://cdn.jsdelivr.net/npm/html5-qrcode@2.3.8/+esm");
    logMacroScan("dependencia del motor cargada", { engine: "html5", ok: Boolean(_macroScanHtml5Module) });
    return _macroScanHtml5Module;
  }

  async function loadMacroScanZxingModule() {
    if (_macroScanZxingModule) return _macroScanZxingModule;
    _macroScanZxingModule = await import("https://cdn.jsdelivr.net/npm/@zxing/library@latest/+esm");
    logMacroEvent(["scanner", "barcode", "zxing"], "dependencia ZXing cargada", { ok: Boolean(_macroScanZxingModule) }, "info");
    return _macroScanZxingModule;
  }

  async function loadMacroScanOcrModule() {
    if (_macroScanOcrModule) return _macroScanOcrModule;
    _macroScanOcrModule = await import("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.0/dist/tesseract.esm.min.js");
    logMacroEvent(["scanner", "ocr"], "dependencia OCR cargada", { ok: Boolean(_macroScanOcrModule) }, "info");
    return _macroScanOcrModule;
  }

  function isMacroScanCropTooSmall(crop = {}, frame = {}) {
    const cropW = Number(crop?.width) || 0;
    const cropH = Number(crop?.height) || 0;
    const frameW = Number(frame?.width) || 0;
    const frameH = Number(frame?.height) || 0;
    if (!cropW || !cropH || !frameW || !frameH) return true;
    const areaRatio = (cropW * cropH) / Math.max(1, frameW * frameH);
    return cropW < 220 || cropH < 72 || areaRatio < 0.045;
  }

  function createBarcodeNumberCropVariants(sourceCanvas) {
    const w = Math.max(1, Number(sourceCanvas?.width) || 0);
    const h = Math.max(1, Number(sourceCanvas?.height) || 0);
    if (!w || !h) return [];
    const defs = [
      { name: "lower_band", xPct: 0.08, yPct: 0.66, wPct: 0.84, hPct: 0.22 },
      { name: "center_lower_band", xPct: 0.12, yPct: 0.58, wPct: 0.76, hPct: 0.20 },
      { name: "lower_wide_band", xPct: 0.03, yPct: 0.60, wPct: 0.94, hPct: 0.30 },
    ];
    return defs.map((cfg) => {
      const crop = {
        name: cfg.name,
        x: Math.max(0, Math.round(w * cfg.xPct)),
        y: Math.max(0, Math.round(h * cfg.yPct)),
        width: Math.max(40, Math.round(w * cfg.wPct)),
        height: Math.max(32, Math.round(h * cfg.hPct)),
      };
      if (crop.x + crop.width > w) crop.width = Math.max(1, w - crop.x);
      if (crop.y + crop.height > h) crop.height = Math.max(1, h - crop.y);
      const canvas = document.createElement("canvas");
      canvas.width = crop.width;
      canvas.height = crop.height;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (ctx) ctx.drawImage(sourceCanvas, crop.x, crop.y, crop.width, crop.height, 0, 0, crop.width, crop.height);
      return { crop, canvas };
    });
  }

  function preprocessCropVariants(cropCanvas) {
    const out = [];
    const base = ensureCanvasFromSource(cropCanvas);
    if (!base) return out;
    const makeVariant = (name, threshold = 138, upscale = 1, invert = false) => {
      const src = ensureCanvasFromSource(base);
      if (!src) return;
      const ctx = src.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      const img = ctx.getImageData(0, 0, src.width, src.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = Math.round(d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114);
        let boosted = Math.max(0, Math.min(255, (gray - 128) * 1.8 + 128));
        const bin = boosted > threshold ? 255 : 0;
        const val = invert ? (255 - bin) : bin;
        d[i] = val;
        d[i + 1] = val;
        d[i + 2] = val;
        d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      if (upscale <= 1) {
        out.push({ name, canvas: src });
        return;
      }
      const up = document.createElement("canvas");
      up.width = Math.max(1, Math.round(src.width * upscale));
      up.height = Math.max(1, Math.round(src.height * upscale));
      const upCtx = up.getContext("2d", { willReadFrequently: true });
      if (!upCtx) return;
      upCtx.imageSmoothingEnabled = false;
      upCtx.drawImage(src, 0, 0, src.width, src.height, 0, 0, up.width, up.height);
      out.push({ name, canvas: up });
    };

    out.push({ name: "original_crop", canvas: base });
    makeVariant("grayscale_threshold", 130, 1, false);
    makeVariant("threshold_high_contrast", 156, 1, false);
    makeVariant("threshold_upscale_2x", 148, 2, false);
    makeVariant("threshold_upscale_3x", 150, 3, false);
    makeVariant("threshold_inverted_2x", 148, 2, true);
    return out;
  }


  async function waitForMacroScanVideoReady(videoEl) {
    if (!videoEl) throw new Error("Elemento de vídeo no disponible.");
    if (videoEl.videoWidth > 0 && videoEl.videoHeight > 0) return;
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup();
        reject(new Error("El vídeo no recibió dimensiones válidas."));
      }, 1800);
      const onReady = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        clearTimeout(timeout);
        videoEl.removeEventListener("loadedmetadata", onReady);
        videoEl.removeEventListener("canplay", onReady);
      };
      videoEl.addEventListener("loadedmetadata", onReady, { once: true });
      videoEl.addEventListener("canplay", onReady, { once: true });
    });
  }

  async function openMacroScanCamera() {
    logMacroScan("apertura de cámara iniciada", {
      hasVideoElement: Boolean($macroScanVideo),
      hasGetUserMedia: Boolean(navigator.mediaDevices?.getUserMedia),
      secureContext: window.isSecureContext,
    });
    if (!$macroScanVideo) throw new Error("No existe el elemento de vídeo para escaneo.");
    if (!window.isSecureContext) throw new Error("La cámara requiere HTTPS o localhost.");
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("La cámara no está disponible.");
    logMacroScan("cámara solicitada", { facingMode: "environment" });
    _macroScanStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    $macroScanVideo.classList.remove("hidden");
    $macroScanVideo.muted = true;
    $macroScanVideo.setAttribute("playsinline", "");
    $macroScanVideo.setAttribute("autoplay", "");
    $macroScanVideo.srcObject = _macroScanStream;
    await $macroScanVideo.play();
    await waitForMacroScanVideoReady($macroScanVideo);
    const track = _macroScanStream.getVideoTracks?.()[0] || null;
    logMacroScan("cámara abierta", {
      ok: true,
      streamOpen: true,
      streamActive: Boolean(_macroScanStream?.active),
      tracksActivas: Boolean(_macroScanStream?.getTracks?.().some((tr) => tr.readyState === "live")),
      videoReady: Boolean(($macroScanVideo?.readyState || 0) >= 2),
      videoSize: `${$macroScanVideo?.videoWidth || 0}x${$macroScanVideo?.videoHeight || 0}` ,
      trackSettings: track?.getSettings?.() || null,
    });
  }

  async function stopMacroBarcodeScan(options = {}) {
    const { keepStatus = false, keepPendingProduct = false, keepFrozenFrame = false } = options || {};
    _macroScanRunning = false;
    _macroScanEngineRunId += 1;
    const stoppingEngine = _macroScanEngine;

    if (!keepPendingProduct) hideMacroScanAddProduct();
    if (_macroScanTimer) {
      try { clearTimeout(_macroScanTimer); } catch (_) {}
      _macroScanTimer = null;
    }
    if (_macroScanResizeRestartTimer) {
      try { clearTimeout(_macroScanResizeRestartTimer); } catch (_) {}
      _macroScanResizeRestartTimer = null;
    }


    if (_macroScanHtml5Instance) {
      try { await _macroScanHtml5Instance.stop(); } catch (_) {}
      try { await _macroScanHtml5Instance.clear(); } catch (_) {}
      _macroScanHtml5Instance = null;
    }


    if (_macroScanStream) {
      try { _macroScanStream.getTracks().forEach((t) => t.stop()); } catch (_) {}
      _macroScanStream = null;
    }

    if ($macroScanVideo) {
      try { $macroScanVideo.pause(); } catch (_) {}
      try { $macroScanVideo.srcObject = null; } catch (_) {}
    }
    if ($macroScanHtml5Host) {
      $macroScanHtml5Host.classList.add("hidden");
      $macroScanHtml5Host.innerHTML = "";
    }
    if (!keepFrozenFrame) clearCapturedFrame();

    _macroScanStartedAt = 0;
    _macroScanDecodeInFlight = false;
    _macroScanViewfinderPx = null;
    _macroScanQrBoxPx = null;
    _macroScanLastHostPx = null;
    setMacroScanOverlayBox(null);
    setMacroScanEngineStatus("none");
    if (!keepStatus) setMacroScanStatus("");
    if ($macroScanPlacementHint) $macroScanPlacementHint.classList.remove("is-warning");
    logMacroScan("limpieza", { motorDetenido: stoppingEngine || "none", streamDetenido: true, timersListenersLimpiados: true, streamActive: Boolean(_macroScanStream?.active) });
  }

  async function onMacroEngineDetected(rawCode, engine, runId) {
    if (!_macroScanRunning || _macroScanEngine !== engine || runId !== _macroScanEngineRunId) return;
    const raw = String(rawCode || "").trim();
    const clean = normalizeDetectedBarcode(raw);
    if (!clean) {
      // Caso B: el motor devuelve algo pero no es EAN/UPC válido.
      const now = Date.now();
      if (raw && (now - (_macroScanParseFailLastAt || 0)) > 4000) {
        _macroScanParseFailLastAt = now;
        logScannerWarn("código detectado pero inválido (parse falló)", { engine, raw: raw.slice(0, 40), rawLen: raw.length });
      }
      return;
    }
    const now = Date.now();
    if (clean === _macroScanLastValue && (now - _macroScanLastAt) < MACRO_SCAN_REPEAT_BLOCK_MS) {
      logScanner("código ignorado por repetición", { engine, code: clean, windowMs: MACRO_SCAN_REPEAT_BLOCK_MS });
      return;
    }
    _macroScanLastValue = clean;
    _macroScanLastAt = now;
    logMacroEvent(["scanner", "decode"], "código detectado", { engine, code: clean }, "info");
    if ($macroScanManual) $macroScanManual.value = clean;
    setMacroScanStatus(`CÃ³digo detectado: ${clean}`);

    // La detecciÃ³n debe ser rÃ¡pida: hacemos la bÃºsqueda en segundo plano y no detenemos el escÃ¡ner.
    try {
      _macroScanLookupQueued = { barcode: clean, options: { fromManual: false, sourceEngine: engine } };
      if (_macroScanLookupTimer) {
        try { clearTimeout(_macroScanLookupTimer); } catch (_) {}
      }
      _macroScanLookupTimer = setTimeout(() => {
        _macroScanLookupTimer = null;
        const queued = _macroScanLookupQueued;
        _macroScanLookupQueued = null;
        if (!queued?.barcode) return;
        handleBarcodeFound(queued.barcode, queued.options).catch((err) => {
          logLookupError("búsqueda en segundo plano falló", { error: err?.name || err?.message || err });
        });
      }, 80);
    } catch (_) {}
  }


  async function startHtml5Scan(runId) {
    if (!$macroScanHtml5Host) throw new Error("Contenedor html5-qrcode no disponible.");
    $macroScanVideo?.classList.add("hidden");
    $macroScanHtml5Host.classList.remove("hidden");
    logMacroScanLayoutDeep("host_visible");
    logMacroEvent(["scanner", "decode"], "inicio motor", { engine: "html5", instanceCreated: false }, "info");
    const mod = await loadMacroScanHtml5Module();
    const Html5Qrcode = mod?.Html5Qrcode || mod?.default?.Html5Qrcode || mod?.default;
    if (!Html5Qrcode) throw new Error("html5-qrcode no disponible.");
    _macroScanHtml5Instance = new Html5Qrcode("macro-scan-html5-host");
    logMacroEvent(["scanner", "decode"], "inicialización del motor", { engine: "html5", libreriaCargada: true, instanceCreated: Boolean(_macroScanHtml5Instance) }, "info");
    logMacroEvent(["scanner", "decode"], "loop de detección arrancado", { engine: "html5", ok: true }, "info");
    const startConfig = {
      fps: 18,
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const vfW = Math.max(0, Math.round(Number(viewfinderWidth) || 0));
        const vfH = Math.max(0, Math.round(Number(viewfinderHeight) || 0));
        _macroScanViewfinderPx = { width: vfW, height: vfH };

        // Banda horizontal (retail) para EAN/UPC: muy ancha, poco alta.
        // Evitamos clamps agresivos para que overlay y regiÃ³n real no diverjan en pantallas grandes/pequeÃ±as.
        const width = Math.max(260, Math.min(Math.round(vfW * 0.92), vfW));
        const height = Math.max(84, Math.min(Math.round(vfH * 0.22), 160));
        const left = Math.max(0, Math.round((vfW - width) / 2));
        const top = Math.max(0, Math.round((vfH - height) / 2));
        const box = { left, top, width, height, lineTop: top + Math.round(height / 2) };
        _macroScanQrBoxPx = box;
        setMacroScanOverlayBox(box);
        logMacroScanLayout("qrbox");
        logMacroScanLayoutDeep("qrbox");
        return { width, height };
      },
      aspectRatio: 1.777,
      disableFlip: true,
      formatsToSupport: [mod.Html5QrcodeSupportedFormats.EAN_13, mod.Html5QrcodeSupportedFormats.EAN_8, mod.Html5QrcodeSupportedFormats.UPC_A, mod.Html5QrcodeSupportedFormats.UPC_E],
    };
    const onDecoded = (decodedText) => {
      onMacroEngineDetected(decodedText, "html5", runId);
    };
    const onDecodeError = (errorMessage) => {
      const msg = String(errorMessage || "");
      if (/not found/i.test(msg) || isMacroScanNoReadMessage(msg)) {
        logMacroScanNoResult("html5", msg);
        return;
      }
      logMacroEvent(["scanner", "decode", "error"], "error motor", { engine: "html5", error: msg }, "error");
    };

    // html5-qrcode exige que el "cameraIdOrConfig" (si es objeto) tenga exactamente 1 clave.
    // Priorizamos cámara trasera por deviceId (si existe) y, si no, usamos facingMode environment.
    let selectedCameraId = "";
    const getCameras = Html5Qrcode?.getCameras || mod?.Html5Qrcode?.getCameras;
    if (typeof getCameras === "function") {
      const cameras = await getCameras();
      const preferred = pickMacroScanRearCamera(cameras);
      selectedCameraId = String(preferred?.id || "");
      logMacroEvent(["scanner", "camera"], "enumerateDevices completado", {
        total: cameras.length,
        selected: selectedCameraId || "facingMode:environment",
        labels: cameras.map((c) => c?.label || "(sin etiqueta)").slice(0, 6),
      }, "info");
    }
    try {
      if (selectedCameraId) await _macroScanHtml5Instance.start(selectedCameraId, startConfig, onDecoded, onDecodeError);
      else await _macroScanHtml5Instance.start({ facingMode: "environment" }, startConfig, onDecoded, onDecodeError);
    } catch (err) {
      logMacroEvent(["scanner", "camera", "warn"], "fallo al abrir cámara preferida, fallback", {
        engine: "html5",
        selectedCameraId,
        error: err?.name || err?.message || err,
      }, "warn");
      await _macroScanHtml5Instance.start({ facingMode: "environment" }, startConfig, onDecoded, onDecodeError);
    }
    logMacroScanLayout("post_start");
    logMacroScanLayoutDeep("post_start");
    _macroScanLastHostPx = readMacroScanHostPx();
    try {
      setTimeout(() => {
        if (!(_macroScanRunning && _macroScanEngine === "html5" && runId === _macroScanEngineRunId)) return;
        logMacroScanLayout("post_start_delay");
        hideHtml5QrcodeInternalOverlay();
        logMacroScanLayoutDeep("post_start_delay");
        _macroScanLastHostPx = readMacroScanHostPx();
      }, 450);
    } catch (_) {}
    const activeTrack = getMacroScanActiveVideoTrack();
    await configureMacroScanTrack(activeTrack);
    logMacroEvent(["scanner", "camera"], "cámara abierta", {
      ok: true,
      engine: "html5",
      streamActive: true,
      videoDimsOk: true,
      finalVideoSize: `${$macroScanHtml5Host?.querySelector?.("video")?.videoWidth || 0}x${$macroScanHtml5Host?.querySelector?.("video")?.videoHeight || 0}`,
      zoomSupported: Boolean(activeTrack?.getCapabilities?.()?.zoom),
      focusModeSupported: Boolean((activeTrack?.getCapabilities?.()?.focusMode || []).length),
      zoomApplied: activeTrack?.getSettings?.()?.zoom ?? null,
    }, "info");
  }


  async function startMacroBarcodeScan(engine = "html5") {
    const selectedEngine = "html5";
    if (engine !== "html5") logScannerWarn("motor no disponible, se usa html5-qrcode", { requestedEngine: engine });
    beginMacroScanLogSession(`inicio_${selectedEngine}`);
    logScanner("startScanner llamado", {
      engine: selectedEngine,
      argsLength: arguments.length,
      dom: {
        panel: Boolean($macroScanPanel),
        video: Boolean($macroScanVideo),
        html5Host: Boolean($macroScanHtml5Host),
        manualInput: Boolean($macroScanManual),
        addProductButton: Boolean($macroScanAddProduct),
      },
    });
    try {
      await getMacroScanNativeBarcodeSupport();
    } catch (_) {}
    hideMacroScanAddProduct();
    await stopMacroBarcodeScan({ keepStatus: true, keepPendingProduct: true });
    _macroScanRunning = true;
    _macroScanStartedAt = Date.now();
    _macroScanLastValue = "";
    _macroScanLastAt = 0;
    _macroScanEngineRunId += 1;
    const runId = _macroScanEngineRunId;
    setMacroScanEngineStatus(selectedEngine);
    logScanner("motor seleccionado", { engine: selectedEngine });
    logScanner("arranque de detección/búsqueda", { engine: selectedEngine, runId });

    setMacroScanStatus("Inicializando camara...");
    logMacroScanLayout("pre_start");

    if (!_macroScanResizeListenerBound) {
      _macroScanResizeListenerBound = true;
      try {
        window.addEventListener("resize", () => {
          if (!_macroScanRunning) return;
          logMacroScanLayout("resize");
          logMacroScanLayoutDeep("resize");
          if (_macroScanEngine !== "html5") return;
          if ((Date.now() - (_macroScanStartedAt || 0)) < 900) return;
          const next = readMacroScanHostPx();
          if (!hasMeaningfulMacroScanHostResize(_macroScanLastHostPx, next)) return;
          _macroScanLastHostPx = next;
          if (_macroScanResizeRestartTimer) {
            try { clearTimeout(_macroScanResizeRestartTimer); } catch (_) {}
          }
          _macroScanResizeRestartTimer = setTimeout(() => {
            _macroScanResizeRestartTimer = null;
            restartHtml5ScanInPlace("resize");
          }, 240);
        }, { passive: true });
        window.addEventListener("orientationchange", () => {
          if (!_macroScanRunning) return;
          logMacroScanLayout("orientationchange");
          logMacroScanLayoutDeep("orientationchange");
          if (_macroScanEngine !== "html5") return;
          if ((Date.now() - (_macroScanStartedAt || 0)) < 900) return;
          const next = readMacroScanHostPx();
          if (!hasMeaningfulMacroScanHostResize(_macroScanLastHostPx, next)) return;
          _macroScanLastHostPx = next;
          if (_macroScanResizeRestartTimer) {
            try { clearTimeout(_macroScanResizeRestartTimer); } catch (_) {}
          }
          _macroScanResizeRestartTimer = setTimeout(() => {
            _macroScanResizeRestartTimer = null;
            restartHtml5ScanInPlace("orientationchange");
          }, 240);
        }, { passive: true });
      } catch (_) {}
    }

    try {
      await startHtml5Scan(runId);
      if ($macroScanPlacementHint) $macroScanPlacementHint.classList.remove("is-warning");
      setMacroScanStatus("Buscando codigo... Acerca el producto para que el número se vea grande y nítido.");
      logScannerSuccess("detección iniciada", { engine: selectedEngine, ok: true, phase: "buscando" });
    } catch (err) {
      logScannerError("falló la inicialización del escáner", { engine: selectedEngine, error: err?.name || err?.message || err });
      setMacroScanStatus(`Error en ${selectedEngine}: ${err?.name || err?.message || "falló"}`);
      await stopMacroBarcodeScan({ keepStatus: true, keepPendingProduct: true });
    }
  }

  // Alias pedidos (arquitectura): no rompe rutas existentes.
  async function startScannerPreview() { return startMacroBarcodeScan("html5"); }
  async function startScanner() { return startScannerPreview(); }
  async function stopScanner() { return stopMacroBarcodeScan(); }

  function getFoodRepoToken() {
    const fromConst = String(FOODREPO_API_TOKEN || "").trim();
    if (fromConst) return fromConst;
    try {
      const fromWindow = String(window?.__FOODREPO_API_TOKEN || "").trim();
      if (fromWindow) return fromWindow;
    } catch (_) {}
    try {
      const fromStorage = String(window?.localStorage?.getItem?.("bookshell.foodrepoToken") || "").trim();
      if (fromStorage) return fromStorage;
    } catch (_) {}
    return "";
  }

  async function fetchJsonWithTimeout(url, options = {}, timeoutMs = MACRO_SCAN_LOOKUP_TIMEOUT_MS) {
    const controller = new AbortController();
    const startedAt = Date.now();
    const timer = setTimeout(() => {
      try { controller.abort(); } catch (_) {}
    }, Math.max(500, Number(timeoutMs) || MACRO_SCAN_LOOKUP_TIMEOUT_MS));
    try {
      const res = await fetch(url, { ...options, signal: controller.signal });
      let json = null;
      try {
        json = await res.json();
      } catch (err) {
        return { ok: false, res, json: null, ms: Date.now() - startedAt, error: err, stage: "parse_json" };
      }
      return { ok: true, res, json, ms: Date.now() - startedAt, error: null, stage: "ok" };
    } catch (err) {
      const isAbort = String(err?.name || "") === "AbortError";
      return { ok: false, res: null, json: null, ms: Date.now() - startedAt, error: err, stage: isAbort ? "timeout_or_abort" : "request" };
    } finally {
      try { clearTimeout(timer); } catch (_) {}
    }
  }

  function normalizeProductData(raw, source, barcode = "") {
    const cleanBarcode = normalizeDetectedBarcode(barcode) || String(barcode || "").trim() || "";
    const src = String(source || "").trim();

    if (src === "openfoodfacts") {
      const product = raw?.product && typeof raw.product === "object" ? raw.product : null;
      if (!product) return null;
      const name = String(product.product_name_es || product.product_name || "").trim();
      if (!name) return null;
      return {
        barcode: String(product.code || cleanBarcode || "").trim(),
        name,
        brand: String(product.brands || "").split(",")[0]?.trim() || "",
        image: String(product.image_front_url || product.image_url || "").trim() || null,
        quantity: String(product.quantity || "").trim() || null,
        servingSize: String(product.serving_size || "").trim() || null,
        nutritionDataPer: String(product.nutrition_data_per || product.nutriment_data_per || "").trim() || null,
        nutriments: (product.nutriments && typeof product.nutriments === "object") ? product.nutriments : null,
        source: "openfoodfacts",
      };
    }

    if (src === "foodrepo") {
      const item = Array.isArray(raw?.data) ? raw.data[0] : (raw?.data && typeof raw.data === "object" ? raw.data : null);
      const attrs = item?.attributes && typeof item.attributes === "object" ? item.attributes : (item && typeof item === "object" ? item : null);
      if (!attrs) return null;
      const nameTranslations = attrs?.name_translations && typeof attrs.name_translations === "object" ? attrs.name_translations : null;
      const name = String(nameTranslations?.es || nameTranslations?.en || nameTranslations?.fr || attrs?.name || "").trim();
      if (!name) return null;
      const brand = String(attrs?.brand || attrs?.brands || "").trim();
      const image = String(attrs?.image_url || attrs?.image || attrs?.front_image_url || "").trim() || null;
      const quantity = String(attrs?.quantity || attrs?.package_size || attrs?.weight || "").trim() || null;
      const servingSize = String(attrs?.serving_size || attrs?.servingSize || "").trim() || null;
      const nutritionDataPer = String(attrs?.nutrition_data_per || attrs?.nutriment_data_per || "").trim() || null;
      const nutriments = (attrs?.nutrients && typeof attrs.nutrients === "object") ? attrs.nutrients : (attrs?.nutriments && typeof attrs.nutriments === "object" ? attrs.nutriments : null);
      return {
        barcode: String(attrs?.barcode || attrs?.code || cleanBarcode || "").trim(),
        name,
        brand,
        image,
        quantity,
        servingSize,
        nutritionDataPer,
        nutriments,
        source: "foodrepo",
      };
    }

    return null;
  }

  function extractMacrosFromNutriments(nutriments) {
    const n = nutriments && typeof nutriments === "object" ? nutriments : null;
    const num = (v) => {
      const x = Number(v);
      return Number.isFinite(x) ? x : null;
    };
    const carbs = num(n?.carbohydrates_100ml ?? n?.carbohydrates_100g ?? n?.carbohydrates);
    const protein = num(n?.proteins_100ml ?? n?.proteins_100g ?? n?.proteins);
    const fat = num(n?.fat_100ml ?? n?.fat_100g ?? n?.fat);
    const kcal = num(n?.["energy-kcal_100ml"] ?? n?.energy_kcal_100ml ?? n?.["energy-kcal_100g"] ?? n?.energy_kcal_100g ?? n?.["energy-kcal"] ?? n?.kcal);
    return { carbs: carbs ?? 0, protein: protein ?? 0, fat: fat ?? 0, kcal: kcal ?? 0 };
  }

  function parseNumberAndUnit(raw = "") {
    const text = String(raw || "").trim().toLowerCase();
    if (!text) return null;
    const match = text.match(/(\d+(?:[\.,]\d+)?)\s*(kg|g|gr|gram(?:s)?|l|lt|liter(?:s)?|litre(?:s)?|ml|milliliter(?:s)?|millilitre(?:s)?|cl)\b/i);
    if (!match) return null;
    const qty = Number(String(match[1] || "").replace(",", "."));
    if (!Number.isFinite(qty) || qty <= 0) return null;
    const unitRaw = String(match[2] || "").toLowerCase();
    if (unitRaw === "cl") return { qty: qty * 10, unit: "ml" };
    const unit = normalizeCostUnit(unitRaw);
    if (!unit) return null;
    return { qty, unit };
  }

  function inferExternalBaseFromNutritionData(external = {}) {
    const n = external?.nutriments && typeof external.nutriments === "object" ? external.nutriments : {};
    const nutritionDataPer = String(external?.nutritionDataPer || n?.nutrition_data_per || n?.nutriment_data_per || "").trim().toLowerCase();
    if (nutritionDataPer.includes("100ml") || nutritionDataPer === "ml") return { qty: 100, unit: "ml", source: "nutrition_data_per" };
    if (nutritionDataPer.includes("100g") || nutritionDataPer === "g") return { qty: 100, unit: "g", source: "nutrition_data_per" };

    if (Number.isFinite(Number(n?.carbohydrates_100ml)) || Number.isFinite(Number(n?.proteins_100ml)) || Number.isFinite(Number(n?.fat_100ml)) || Number.isFinite(Number(n?.["energy-kcal_100ml"] ?? n?.energy_kcal_100ml))) {
      return { qty: 100, unit: "ml", source: "nutriments_100ml" };
    }
    if (Number.isFinite(Number(n?.carbohydrates_100g)) || Number.isFinite(Number(n?.proteins_100g)) || Number.isFinite(Number(n?.fat_100g)) || Number.isFinite(Number(n?.["energy-kcal_100g"] ?? n?.energy_kcal_100g))) {
      return { qty: 100, unit: "g", source: "nutriments_100g" };
    }
    return null;
  }

  function inferExternalBaseMeasurement(external = {}) {
    const quantityCandidate = parseNumberAndUnit(external?.quantity || external?.productQuantity || "");
    if (quantityCandidate && ["ml", "l"].includes(quantityCandidate.unit)) {
      return { ...quantityCandidate, source: "quantity" };
    }
    if (quantityCandidate && ["g", "kg"].includes(quantityCandidate.unit)) {
      return { ...quantityCandidate, source: "quantity" };
    }

    const servingCandidate = parseNumberAndUnit(external?.servingSize || external?.serving_size || "");
    if (servingCandidate && ["ml", "l", "g", "kg"].includes(servingCandidate.unit)) {
      return { ...servingCandidate, source: "serving_size" };
    }

    return inferExternalBaseFromNutritionData(external);
  }

  function externalToMacroProduct(external) {
    if (!external) return null;
    const barcode = String(external.barcode || "").trim();
    const name = String(external.name || "").trim();
    if (!name) return null;
    const inferred = inferExternalBaseMeasurement(external) || { qty: 100, unit: "g", source: "fallback" };
    return {
      id: barcode || generateId(),
      source: external.source || "manual",
      name,
      brand: String(external.brand || "").trim(),
      barcode,
      image: external.image || null,
      quantity: external.quantity || null,
      servingSize: external.servingSize || null,
      nutritionDataPer: external.nutritionDataPer || null,
      nutriments: external.nutriments || null,
      servingBaseGrams: inferred.qty,
      servingBaseUnit: inferred.unit,
      baseQuantity: inferred.qty,
      baseUnit: inferred.unit,
      baseUnitSource: inferred.source,
      detectedUnitType: ["ml", "l"].includes(inferred.unit) ? "volume" : "mass",
      macros: extractMacrosFromNutriments(external.nutriments),
    };
  }

  async function lookupOpenFoodFacts(barcode) {
    const clean = normalizeDetectedBarcode(barcode) || String(barcode || "").trim();
    if (!clean) {
      logLookupOff("descartado (barcode inválido)", { barcode: String(barcode || ""), reason: "invalid_barcode" }, "warn");
      return { ok: false, reason: "invalid_barcode", product: null };
    }
    const endpoint = `${OFF_PRODUCT_ENDPOINT}/${encodeURIComponent(clean)}.json`;
    logLookupOff("request", { barcode: clean, endpoint });
    const { ok, res, json, ms, error, stage } = await fetchJsonWithTimeout(endpoint, {
      method: "GET",
      headers: { Accept: "application/json" },
      mode: "cors",
      cache: "no-store",
    }, MACRO_SCAN_LOOKUP_TIMEOUT_MS);

    if (!ok) {
      const reason = stage === "timeout_or_abort" ? "timeout" : (stage === "parse_json" ? "invalid_json" : "network");
      logLookupOff("error", { barcode: clean, endpoint, reason, ms, error: error?.name || error?.message || error }, "error");
      return { ok: false, reason, product: null };
    }

    logLookupOff("response", { barcode: clean, status: res.status, ok: res.ok, ms });
    if (!res.ok) {
      const reason = res.status === 429 ? "rate_limit" : (res.status === 404 ? "not_found" : `http_${res.status}`);
      const level = (res.status >= 500 || res.status === 429) ? "error" : "warn";
      logLookupOff("http_not_ok", { barcode: clean, status: res.status, reason, ms }, level);
      return { ok: false, reason, product: null, status: res.status };
    }

    const status = Number(json?.status);
    if (status !== 1 || !json?.product) {
      logLookupOff("not_found", { barcode: clean, reason: json?.status_verbose || json?.status || "not_found" }, "warn");
      return { ok: false, reason: "not_found", product: null };
    }

    const external = normalizeProductData(json, "openfoodfacts", clean);
    const product = externalToMacroProduct(external);
    if (!product) {
      logLookupOff("invalid_payload", { barcode: clean, reason: "normalize_failed" }, "error");
      return { ok: false, reason: "invalid_payload", product: null };
    }
    logLookupOff("success", { barcode: clean, name: product.name });
    return { ok: true, reason: "ok", product };
  }

  async function lookupFoodRepo(barcode) {
    const clean = normalizeDetectedBarcode(barcode) || String(barcode || "").trim();
    if (!clean) {
      logLookupFoodRepo("descartado (barcode inválido)", { barcode: String(barcode || ""), reason: "invalid_barcode" }, "warn");
      return { ok: false, reason: "invalid_barcode", product: null };
    }

    const token = getFoodRepoToken();
    if (!token) {
      logLookupFoodRepo("sin token; fallback deshabilitado", { barcode: clean, reason: "missing_token" }, "error");
      return { ok: false, reason: "missing_token", product: null };
    }

    const base = String(FOODREPO_API_BASE || "https://www.foodrepo.org/api/v3").replace(/\\/+$/g, "");
    const endpoint = `${base}/products?barcodes=${encodeURIComponent(clean)}`;
    const authValue = /^Token\\s+/i.test(token) ? token : `Token token=${token}`;
    logLookupFoodRepo("request", { barcode: clean, endpoint });

    const { ok, res, json, ms, error, stage } = await fetchJsonWithTimeout(endpoint, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authValue },
      mode: "cors",
      cache: "no-store",
    }, MACRO_SCAN_LOOKUP_TIMEOUT_MS);

    if (!ok) {
      const reason = stage === "timeout_or_abort" ? "timeout" : (stage === "parse_json" ? "invalid_json" : "network");
      logLookupFoodRepo("error", { barcode: clean, endpoint, reason, ms, error: error?.name || error?.message || error }, "error");
      return { ok: false, reason, product: null };
    }

    logLookupFoodRepo("response", { barcode: clean, status: res.status, ok: res.ok, ms });
    if (!res.ok) {
      const reason = (res.status === 401 || res.status === 403) ? "unauthorized" : (res.status === 429 ? "rate_limit" : `http_${res.status}`);
      logLookupFoodRepo("http_not_ok", { barcode: clean, status: res.status, reason, ms }, "error");
      return { ok: false, reason, product: null, status: res.status };
    }

    const external = normalizeProductData(json, "foodrepo", clean);
    const product = externalToMacroProduct(external);
    if (!product) {
      logLookupFoodRepo("not_found", { barcode: clean, reason: "empty_or_unparseable" }, "warn");
      return { ok: false, reason: "not_found", product: null };
    }

    logLookupFoodRepo("success", { barcode: clean, name: product.name });
    return { ok: true, reason: "ok", product };
  }

  async function lookupProduct(barcode) {
    const clean = normalizeDetectedBarcode(barcode) || String(barcode || "").trim();
    if (!clean) return { ok: false, reason: "invalid_barcode", product: null };

    // Local primero (sin red); no cuenta como API.
    const local = await lookupProductByBarcode(clean);
    if (local) {
      logLookupSuccess("local_hit", { barcode: clean, productId: local.id || "" });
      return { ok: true, reason: "local", product: local, source: "local" };
    }

    const off = await lookupOpenFoodFacts(clean);
    if (off.ok && off.product) return { ok: true, reason: "openfoodfacts", product: off.product, source: "openfoodfacts" };

    // Caso F: fallback FoodRepo
    logLookupWarn("fallback -> FoodRepo", { barcode: clean, offReason: off.reason || "" });
    const fr = await lookupFoodRepo(clean);
    if (fr.ok && fr.product) return { ok: true, reason: "foodrepo", product: fr.product, source: "foodrepo" };

    return { ok: false, reason: `openfoodfacts:${off.reason || "fail"}; foodrepo:${fr.reason || "fail"}`, product: null };
  }

  function applyLookupResultToUi(product, barcode, { fromManual = false, sourceEngine = "manual", source = "" } = {}) {
    if (!product) return;
    _macroScanPendingProduct = product;
    const src = String(source || product.source || "").trim();
    logMacroEvent(["ui"], "producto listo para UI", { barcode, source: src, name: product.name, fromManual, sourceEngine }, "info");
    setMacroScanStatus(`Producto encontrado (${src || "ok"}): ${product.name}${product.brand ? ` · ${product.brand}` : ""}. Pulsa “Abrir ficha”.`);
    showMacroScanAddProduct({ barcode, mode: "off", label: "Abrir ficha", pendingProduct: product });

    if ($macroManualBarcode) $macroManualBarcode.value = barcode;
    if ($macroManualName) $macroManualName.value = product.name || "";
    if ($macroManualBrand) $macroManualBrand.value = product.brand || "";
    if ($macroManualCarbs) $macroManualCarbs.value = String(product.macros?.carbs ?? 0);
    if ($macroManualProtein) $macroManualProtein.value = String(product.macros?.protein ?? 0);
    if ($macroManualFat) $macroManualFat.value = String(product.macros?.fat ?? 0);
    if ($macroManualKcal) $macroManualKcal.value = String(product.macros?.kcal ?? 0);
    if ($macroManualBase) $macroManualBase.value = "100";
  }

  function applyProductToUI(product, barcode, options = {}) {
    return applyLookupResultToUi(product, barcode, options);
  }

  async function handleBarcodeFound(barcode, options = {}) {
    const { fromManual = false, sourceEngine = "manual", triedOcrFallback = false } = options || {};
    const raw = String(barcode || "").trim();
    const clean = normalizeDetectedBarcode(raw);
    if (!clean) {
      // Caso B: detectado pero inválido.
      if (raw) logLookupWarn("barcode inválido (parse)", { raw: raw.slice(0, 40), rawLen: raw.length, fromManual, sourceEngine });
      return;
    }

    logLookup("handleDetectedBarcode", { barcode: clean, fromManual, sourceEngine });

    // Evita repetir la misma bÃºsqueda en bucle mientras apuntas al mismo cÃ³digo.
    const now = Date.now();
    if (!fromManual && clean === _macroScanLastLookupCode && (now - (_macroScanLastLookupAt || 0)) < MACRO_SCAN_LOOKUP_COOLDOWN_MS) {
      logLookup("ignorado por cooldown", { barcode: clean, cooldownMs: MACRO_SCAN_LOOKUP_COOLDOWN_MS });
      return;
    }
    _macroScanLastLookupCode = clean;
    _macroScanLastLookupAt = now;

    // Obligatorio: si el lookup de ese barcode sigue en curso, no repetir petición.
    if (_macroScanLookupInFlight.has(clean)) {
      logLookup("ignorado (lookup en curso)", { barcode: clean, fromManual, sourceEngine });
      return;
    }

    const lookupSeq = (_macroScanLookupSeq += 1);

    logLookup("búsqueda lanzada", { barcode: clean, sourceEngine, fromManual, lookupSeq });
    setMacroScanStatus("Buscando producto...");

    const p = (async () => lookupProduct(clean))();
    _macroScanLookupInFlight.set(clean, p);
    const result = await p.finally(() => {
      try { _macroScanLookupInFlight.delete(clean); } catch (_) {}
    });

    if (lookupSeq !== _macroScanLookupSeq) return;

    if (result?.ok && result?.product) {
      logLookupSuccess("producto encontrado", { barcode: clean, source: result.source || result.reason || "" });
      applyLookupResultToUi(result.product, clean, { fromManual, sourceEngine, source: result.source || "" });
      return;
    }

    logLookupError("producto no encontrado / lookup falló", { barcode: clean, reason: result?.reason || "unknown" });

    if (!fromManual && sourceEngine === "html5" && !triedOcrFallback) {
      logMacroEvent(["scanner", "ocr"], "fallback OCR tras fallo de lookup html5", { barcode: clean }, "info");
      setMacroScanStatus("No encontrado por escaneo. Intentando lectura OCR del número...");
      const ocrCode = await tryOcrBarcodeNumber("fallback_after_html5_lookup_fail");
      if (ocrCode && ocrCode !== clean) {
        if ($macroScanManual) $macroScanManual.value = ocrCode;
        logMacroEvent(["scanner", "ocr"], "fallback OCR encontró nuevo código", { from: clean, to: ocrCode }, "info");
        return handleBarcodeFound(ocrCode, { fromManual: false, sourceEngine: "ocr", triedOcrFallback: true });
      }
      logMacroEvent(["scanner", "ocr", "warn"], "fallback OCR no mejoró resultado", { barcode: clean, ocrCode: ocrCode || "" }, "warn");
    }

    setMacroScanStatus("Producto no encontrado. Pulsa “Crear producto manual”.");
    showMacroScanAddProduct({ barcode: clean, mode: "manual", label: "Crear producto manual" });
    if ($macroManualBarcode) $macroManualBarcode.value = clean;
  }

  // Alias pedido (arquitectura): handler único para barcode detectado.
  async function handleDetectedBarcode(barcode, options = {}) {
    return handleBarcodeFound(barcode, options);
  }

  async function runMacroScanOcrPass(reason = "ocr") {
    if (_macroScanOcrInFlight) {
      logMacroEvent(["scanner", "ocr", "warn"], "OCR ya en curso", { reason }, "warn");
      return "";
    }
    _macroScanOcrInFlight = true;
    try {
      logMacroEvent(["scanner", "ocr"], "inicio OCR", { reason }, "info");
      const frame = getScannerAnalysisFrame();
      if (!frame) {
        logMacroEvent(["scanner", "ocr", "error"], "sin frame de cámara para OCR", { reason }, "error");
        return "";
      }
      if (Math.min(frame.width, frame.height) < 540) {
        logMacroEvent(["scanner", "ocr", "warn"], "frame base de OCR con baja resolución", { source: `${frame.width}x${frame.height}` }, "warn");
      }
      logMacroEvent(["scanner", "ocr", "crop"], "dimensiones de fuente", { source: `${frame.width}x${frame.height}` }, "info");

      const crops = createBarcodeNumberCropVariants(frame);
      const ocrMod = await loadMacroScanOcrModule();
      const recognize = ocrMod?.recognize || ocrMod?.default?.recognize;
      if (typeof recognize !== "function") {
        logMacroEvent(["scanner", "ocr", "error"], "módulo OCR inválido", { hasRecognize: false }, "error");
        return "";
      }

      for (const { crop, canvas } of crops) {
        if (isMacroScanCropTooSmall(crop, frame)) {
          setMacroScanStatus("Acerca más el producto: el código se ve demasiado pequeño.");
          if ($macroScanPlacementHint) $macroScanPlacementHint.classList.add("is-warning");
          logMacroEvent(["scanner", "ocr", "warn"], "crop demasiado pequeño para OCR fiable", {
            crop: `${crop.width}x${crop.height}`,
            frame: `${frame.width}x${frame.height}`,
            name: crop.name,
          }, "warn");
          continue;
        }
        if ($macroScanPlacementHint) $macroScanPlacementHint.classList.remove("is-warning");
        logMacroEvent(["scanner", "ocr", "crop"], "crop generado", {
          name: crop.name,
          source: `${frame.width}x${frame.height}`,
          crop: `${crop.width}x${crop.height}`,
          origin: `${crop.x},${crop.y}`,
        }, "info");
        _macroScanOcrDebugState.crop = canvas;
        const variants = preprocessCropVariants(canvas);
        logMacroEvent(["scanner", "ocr", "preprocess"], "variantes preparadas", { crop: crop.name, variants: variants.map((v) => v.name).join(",") }, "info");

        for (const variant of variants) {
          _macroScanOcrDebugState.final = variant.canvas;
          updateMacroScanOcrDebugCanvases();
          logMacroEvent(["scanner", "ocr", "preprocess"], "variant", {
            crop: crop.name,
            variant: variant.name,
            size: `${variant.canvas.width}x${variant.canvas.height}`,
          }, "info");
          const ocrRes = await recognize(variant.canvas, "eng", {
            logger: (m) => {
              if (m?.status === "recognizing text" && Number(m?.progress) > 0.98) {
                logMacroEvent(["scanner", "ocr"], "OCR casi completado", { progress: Number(m.progress || 0).toFixed(2), crop: crop.name, variant: variant.name }, "info");
              }
            },
            tessedit_pageseg_mode: "7",
            tessedit_char_whitelist: "0123456789",
          });
          const rawText = String(ocrRes?.data?.text || "");
          const candidates = extractOcrDigitCandidates(rawText);
          if (!candidates.length) {
            logMacroEvent(["scanner", "ocr", "candidate", "warn"], "sin candidatos numéricos", { crop: crop.name, variant: variant.name, raw: rawText.slice(0, 90) }, "warn");
            continue;
          }

          const evaluated = candidates.map((digits) => {
            const check = validateBarcodeByType(digits);
            return { digits, ...check };
          });

          evaluated.forEach((item) => {
            const status = item.valid ? "valid" : "invalid";
            logMacroEvent(["scanner", "ocr", "candidate"], "evaluación", {
              crop: crop.name,
              variant: variant.name,
              raw: rawText.slice(0, 90),
              digits: item.digits,
              type: item.type || "unknown",
              status,
              reason: item.reason,
              expected: item.expected,
              actual: item.actual,
            }, item.valid ? "info" : "warn");
          });

          const valid = evaluated
            .filter((c) => c.valid)
            .sort((a, b) => (b.digits.length - a.digits.length) || a.digits.localeCompare(b.digits));
          if (valid.length) {
            const winner = valid[0];
            logMacroEvent(["scanner", "ocr", "success"], "barcode detectado por OCR", {
              code: winner.digits,
              type: winner.type,
              crop: crop.name,
              variant: variant.name,
            }, "info");
            return winner.digits;
          }
        }
      }

      logMacroEvent(["scanner", "ocr", "warn"], "OCR sin número válido", { reason, triedCrops: crops.length }, "warn");
      return "";
    } catch (err) {
      logMacroEvent(["scanner", "ocr", "error"], "OCR falló", { reason, error: err?.name || err?.message || err }, "error");
      return "";
    } finally {
      _macroScanOcrInFlight = false;
      updateMacroScanOcrDebugCanvases();
    }
  }


  async function tryOcrBarcodeNumber(reason = "ocr") {
    return runMacroScanOcrPass(reason);
  }



  function normalizeOffProductPayload(payload = {}, barcode = "") {
    const product = payload?.product && typeof payload.product === "object" ? payload.product : null;
    if (!product) return null;
    const productName = String(product.product_name_es || product.product_name || "").trim();
    if (!productName) return null;
    const carbs = Number(product.nutriments?.carbohydrates_100g);
    const protein = Number(product.nutriments?.proteins_100g);
    const fat = Number(product.nutriments?.fat_100g);
    const kcal = Number(product.nutriments?.["energy-kcal_100g"] ?? product.nutriments?.energy_kcal_100g ?? product.nutriments?.["energy-kcal"]);
    return {
      id: product.code || String(barcode || "").trim() || generateId(),
      source: "openfoodfacts",
      name: productName,
      brand: String(product.brands || "").split(",")[0]?.trim() || "",
      barcode: String(product.code || barcode || "").trim(),
      servingBaseGrams: 100,
      macros: {
        carbs: Number.isFinite(carbs) ? carbs : 0,
        protein: Number.isFinite(protein) ? protein : 0,
        fat: Number.isFinite(fat) ? fat : 0,
        kcal: Number.isFinite(kcal) ? kcal : 0,
      },
    };
  }

  async function lookupOpenFoodFactsByBarcode(barcode) {
    const res = await lookupOpenFoodFacts(barcode);
    return res?.ok && res?.product ? res.product : null;
  }

  function upsertBarcodeMapping(barcode, productId) {
    const root = nutritionRootPath();
    if (!root || !barcode || !productId) return;
    try { set(ref(db, `${root}/barcodeMap/${barcode}`), productId); } catch (_) {}
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
  $macroStatsDonutMode?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-donut-mode]");
    if (!btn || btn.hasAttribute("disabled")) return;
    macroStatsState.donutMode = btn.dataset.donutMode || "kcal-macros";
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
    if (key === "kcal") setMacroTargetsFromGrams({ kcalTarget: Math.max(0, nextNum) });
    else setMacroTargetsFromGrams({ [`${key}_g`]: Math.max(0, nextNum) });
    persistNutrition();
    renderMacrosView();
    renderStatisticsView();
  });
  $macroIntegrationOpen?.addEventListener("click", openMacroIntegrationModal);
  $macroIntegrationModalClose?.addEventListener("click", closeMacroIntegrationModal);
  $macroIntegrationModalBackdrop?.addEventListener("click", (e) => {
    if (e.target === $macroIntegrationModalBackdrop) closeMacroIntegrationModal();
  });
  $macroWorkKcal?.addEventListener("change", (e) => {
    nutritionIntegrationConfig.workCaloriesPerMatchedDay = Math.max(0, Number(e.target.value) || 0);
    persistNutrition();
    renderMacrosView();
  });
  $macroBodyweightKg?.addEventListener("change", (e) => {
    const n = Number(e.target.value);
    nutritionIntegrationConfig.bodyWeightKg = Number.isFinite(n) && n > 0 ? n : null;
    persistNutrition();
    renderMacrosView();
  });
  $macroWorkHabits?.addEventListener("change", () => {
    const selected = Array.from($macroWorkHabits.selectedOptions || []).map((opt) => String(opt.value || "").trim()).filter(Boolean);
    nutritionIntegrationConfig.linkedWorkHabitIds = Array.from(new Set(selected));
    persistNutrition();
    renderMacrosView();
  });

  let _macroExternalRefreshTimer = null;
  function scheduleMacroExternalRefresh() {
    if (_macroExternalRefreshTimer) window.clearTimeout(_macroExternalRefreshTimer);
    _macroExternalRefreshTimer = window.setTimeout(() => {
      _macroExternalRefreshTimer = null;
      if ($recipesPanelMacros?.classList.contains("is-active")) {
        renderMacrosView();
        return;
      }
      if ($recipesPanelStatistics?.classList.contains("is-active")) {
        renderStatisticsView();
      }
      if ($recipesPanelShopping?.classList.contains("is-active")) {
        renderShoppingView();
      }
    }, 120);
  }
  try {
    window.addEventListener("bookshell:data", scheduleMacroExternalRefresh);
  } catch (_) {}

  $macroMeals?.addEventListener("change", (e) => {
    const countInput = e.target.closest("input[data-macro-count]");
    if (!countInput) return;
    const [meal, idx] = String(countInput.dataset.macroCount || "").split(":");
    const log = getDailyLog(selectedMacroDate);
    const i = Number(idx);
    const entry = log?.meals?.[meal]?.entries?.[i];
    if (!entry) return;
    entry.servingsCount = normalizeEntryServingsCount(countInput.value);
    persistNutrition();
    renderMacrosView();
    return;
  });

  $macroMeals?.addEventListener("change", (e) => {
    const qtyInput = e.target.closest("[data-macro-ingredient-qty]");
    if (qtyInput) {
      const [meal, idx, ingIdx] = String(qtyInput.dataset.macroIngredientQty || "").split(":");
      updateMacroRecipeIngredient(meal, Number(idx), Number(ingIdx), { qty: qtyInput.value });
      return;
    }
    const unitSelect = e.target.closest("[data-macro-ingredient-unit]");
    if (unitSelect) {
      const [meal, idx, ingIdx] = String(unitSelect.dataset.macroIngredientUnit || "").split(":");
      updateMacroRecipeIngredient(meal, Number(idx), Number(ingIdx), { unit: unitSelect.value });
    }
  });

  $macroMeals?.addEventListener("pointerdown", (e) => {
    const openBtn = e.target.closest("[data-macro-open]");
    if (!openBtn) return;
    const meal = String(openBtn.dataset.macroOpen || "").split(":")[0];
    const idx = Number(String(openBtn.dataset.macroOpen || "").split(":")[1]);
    const log = getDailyLog(selectedMacroDate);
    const entry = log?.meals?.[meal]?.entries?.[idx];
    if (!entry || entry.type !== "product") return;
    if (macroLongPressState.timer) clearTimeout(macroLongPressState.timer);
    macroLongPressState.active = false;
    macroLongPressState.meal = meal;
    macroLongPressState.entryId = ensureMacroEntryId(entry);
    macroLongPressState.pointerId = e.pointerId;
    macroLongPressState.startX = Number(e.clientX) || 0;
    macroLongPressState.startY = Number(e.clientY) || 0;
    macroLongPressState.timer = setTimeout(() => {
      macroLongPressState.active = true;
      macroSelectionState.meal = meal;
      macroSelectionState.selectedIds = new Set([macroLongPressState.entryId]);
      renderMacrosView();
    }, 450);
  });

  $macroMeals?.addEventListener("pointermove", (e) => {
    if (!macroLongPressState.timer) return;
    const dx = Math.abs((Number(e.clientX) || 0) - macroLongPressState.startX);
    const dy = Math.abs((Number(e.clientY) || 0) - macroLongPressState.startY);
    if (dx > 10 || dy > 10) {
      clearTimeout(macroLongPressState.timer);
      macroLongPressState.timer = null;
    }
  });

  const cancelMacroLongPress = () => {
    if (macroLongPressState.timer) clearTimeout(macroLongPressState.timer);
    macroLongPressState.timer = null;
    macroLongPressState.pointerId = null;
  };
  $macroMeals?.addEventListener("pointerup", cancelMacroLongPress);
  $macroMeals?.addEventListener("pointercancel", cancelMacroLongPress);
  $macroMeals?.addEventListener("contextmenu", (e) => {
    if (e.target.closest("[data-macro-open]")) {
      try { e.preventDefault(); } catch (_) {}
    }
  });

  $macroMeals?.addEventListener("click", (e) => {
    const cancelSelBtn = e.target.closest("[data-macro-selection-cancel]");
    if (cancelSelBtn) {
      clearMacroSelection(cancelSelBtn.dataset.macroSelectionCancel);
      renderMacrosView();
      return;
    }
    const createSelBtn = e.target.closest("[data-macro-selection-create]");
    if (createSelBtn) {
      createRecipeFromMealSelection(createSelBtn.dataset.macroSelectionCreate);
      return;
    }
    const selectToggleBtn = e.target.closest("[data-macro-select-toggle]");
    if (selectToggleBtn) {
      const [meal, idx] = String(selectToggleBtn.dataset.macroSelectToggle || "").split(":");
      const entry = getDailyLog(selectedMacroDate)?.meals?.[meal]?.entries?.[Number(idx)];
      if (!entry) return;
      const entryId = ensureMacroEntryId(entry);
      if (macroSelectionState.meal !== meal) {
        macroSelectionState.meal = meal;
        macroSelectionState.selectedIds = new Set();
      }
      if (macroSelectionState.selectedIds.has(entryId)) macroSelectionState.selectedIds.delete(entryId);
      else macroSelectionState.selectedIds.add(entryId);
      if (!macroSelectionState.selectedIds.size) clearMacroSelection(meal);
      renderMacrosView();
      return;
    }

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
        if (removed?.sideEffects) applyRecipeSideEffects(removed.sideEffects, selectedMacroDate, -1, removed.type || "entry");
        else applyEntryHabitImpact(removed, selectedMacroDate, -1);
      }
      return;
    }

    const openBtn = e.target.closest("[data-macro-open]");
    if (openBtn) {
      const [meal, idx] = String(openBtn.dataset.macroOpen || "").split(":");
      const entry = getDailyLog(selectedMacroDate)?.meals?.[meal]?.entries?.[Number(idx)];
      if (!entry) return;
      if (macroLongPressState.active || macroSelectionState.meal === meal) {
        if (entry.type === "product") {
          const entryId = ensureMacroEntryId(entry);
          if (macroSelectionState.meal !== meal) {
            macroSelectionState.meal = meal;
            macroSelectionState.selectedIds = new Set();
          }
          if (macroSelectionState.selectedIds.has(entryId)) macroSelectionState.selectedIds.delete(entryId);
          else macroSelectionState.selectedIds.add(entryId);
          if (!macroSelectionState.selectedIds.size) clearMacroSelection(meal);
          renderMacrosView();
        }
        macroLongPressState.active = false;
        return;
      }
      if (entry.type === "recipe") {
        const entryId = ensureMacroEntryId(entry);
        if (macroExpandedRecipes.has(entryId)) macroExpandedRecipes.delete(entryId);
        else macroExpandedRecipes.add(entryId);
        entry.expanded = macroExpandedRecipes.has(entryId);
        persistNutrition();
        renderMacrosView();
        return;
      }
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
      setMacroScanEngineStatus("none");
      setMacroScanStatus("Escáner listo. Pulsa “Capturar” para analizar foto fija.");
      startScannerPreview().catch(() => {});
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
      price: null,
      packageAmount: null,
      packageUnit: "",
      priceBaseQty: null,
      priceBaseUnit: "",
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
    $macroProductBaseUnit,
    $macroProductCarbs,
    $macroProductProtein,
    $macroProductFat,
    $macroProductKcal,
    $macroProductPackageAmount,
    $macroProductPackageUnit,
    $macroProductPrice,
    $macroProductGrams,
    $macroProductGramsUnit,
  ].filter(Boolean);
  _macroProductInputs.forEach((el) => el.addEventListener("input", renderMacroProductSummary));
  $macroProductGramsUnit?.addEventListener("change", () => {
    updateWeightDiffUnitLabels();
    syncAmountFromAutoCalculation();
    renderMacroProductSummary();
  });
  [$macroProductWeightStart, $macroProductWeightEnd, $macroProductPackWeight, $macroProductPackUnits, $macroProductPackConsumed].filter(Boolean).forEach((el) => {
    el.addEventListener("input", () => {
      syncAmountFromAutoCalculation();
      renderMacroProductSummary();
    });
  });
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
    const normalized = normalizeDetectedBarcode(code) || code;
    if ($macroProductBarcode) $macroProductBarcode.value = normalized;
    logLookup("lookup desde modal producto", { barcode: normalized, sourceEngine: "prompt" });
    const result = await lookupProduct(normalized);
    const pdt = result?.ok ? result.product : null;
    if (!pdt) {
      if ($macroProductSummary) $macroProductSummary.textContent = "Código guardado. Sin coincidencias nutricionales automáticas.";
      return;
    }
    logLookupSuccess("modal producto: datos recibidos", { barcode: normalized, source: result?.source || "" });
    if ($macroProductName && !$macroProductName.value.trim()) $macroProductName.value = pdt.name || "";
    if ($macroProductBrand && !$macroProductBrand.value.trim()) $macroProductBrand.value = pdt.brand || "";
    if ($macroProductBase) $macroProductBase.value = String(Number(pdt.servingBaseGrams) || 100);
    if ($macroProductCarbs) $macroProductCarbs.value = String(Number(pdt.macros?.carbs) || 0);
    if ($macroProductProtein) $macroProductProtein.value = String(Number(pdt.macros?.protein) || 0);
    if ($macroProductFat) $macroProductFat.value = String(Number(pdt.macros?.fat) || 0);
    if ($macroProductKcal) $macroProductKcal.value = String(Number(pdt.macros?.kcal) || 0);
    renderMacroProductSummary();
  });
  $macroProductFinanceSelect?.addEventListener("change", () => {
    const row = financeProducts.find((f) => f.id === String($macroProductFinanceSelect.value || ""));
    if ($macroProductFinanceHint) $macroProductFinanceHint.textContent = row ? `Vinculado a ${row.name}${row.lastPrice ? ` · último ${formatCurrency(row.lastPrice)}` : ""}` : "Sin producto de Finanzas";
    renderMacroProductSummary();
  });
  $macroProductFinanceUnlink?.addEventListener("click", () => {
    if ($macroProductFinanceSelect) $macroProductFinanceSelect.value = "";
    if ($macroProductFinanceHint) $macroProductFinanceHint.textContent = "Sin producto de Finanzas";
    renderMacroProductSummary();
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
    const gramsUnit = normalizeUnit($macroProductGramsUnit?.value || "g") || "g";
    if (!grams) {
      if ($macroProductSummary) $macroProductSummary.textContent = "Indica una cantidad mayor que 0.";
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
      if (!targetRecipe) {
        if ($macroProductSummary) $macroProductSummary.textContent = "No se encuentra la receta destino para este ingrediente.";
        return;
      }
      const ingredients = (targetRecipe.ingredients || []).map((ing) => {
        if (ing.id !== _macroProductRecipeIngredientTarget.ingredientId) return ing;
        const parsed = splitIngredientText(ing.text || "");
        return buildRecipeIngredientFromProduct(saved, {
          ...ing,
          productId: saved.id,
          label: saved.name || parsed.name || ing.label || ing.name || ing.text,
          name: saved.name || parsed.name || ing.name || ing.text,
          quantity: formatAmountWithUnit(grams, gramsUnit),
          qty: grams,
          unit: gramsUnit,
        });
      });
      updateRecipe(targetRecipe.id, { ingredients, updatedAt: Date.now() });
      closeMacroProductModal();
      return;
    }
    if (_macroProductEntryTarget) {
      const { meal, idx } = _macroProductEntryTarget;
      const log = getDailyLog(selectedMacroDate);
      const entry = log?.meals?.[meal]?.entries?.[Number(idx)];
      if (entry) {
        const prevEffects = {
          habits: Array.isArray(entry?.sideEffects?.habits) ? entry.sideEffects.habits : [{ habitId: String(entry?.habitSync?.habitId || "").trim(), amount: Math.max(0, Number(entry?.habitSync?.amount) || 0) }],
          financeCost: Math.max(0, Number(entry?.sideEffects?.financeCost) || 0),
        };
        const rebuiltEntry = buildConsumptionEntryFromEditor({ product: saved, amount: grams, unit: gramsUnit, meal });
        persistConsumptionEntry(rebuiltEntry, { meal, entryTarget: { idx: Number(idx) } });
        applyRecipeSideEffects(prevEffects, selectedMacroDate, -1, "entry_edit_old");
        applyRecipeSideEffects(rebuiltEntry.sideEffects || buildProductSideEffects(saved, 1), selectedMacroDate, 1, "entry_edit_new");
      }
    } else {
      const baseUnit = normalizeUnit(saved.baseUnit || saved.servingBaseUnit || "g") || "g";
      const amountInBaseUnit = convertAmount(grams, gramsUnit, baseUnit);
      if (amountInBaseUnit == null) {
        if ($macroProductSummary) $macroProductSummary.textContent = `No se puede convertir ${gramsUnit} a ${baseUnit} para este producto.`;
        return;
      }
      addProductToMeal(_macroProductMeal || macroModalState.meal || "breakfast", saved, amountInBaseUnit);
    }
    closeMacroProductModal();
  });

  $macroScanEngineHtml5?.addEventListener("click", async () => {
    await startScannerPreview();
  });

  function updateManualBarcodeValidationHint() {
    const raw = String($macroScanManual?.value || "").trim();
    if (!raw) return;
    const digits = raw.replace(/\D/g, "");
    const validation = validateBarcodeByType(digits);
    if (!validation.type) {
      setMacroScanStatus("Código manual: usa EAN-8, UPC-A o EAN-13.");
      return;
    }
    if (validation.valid) {
      setMacroScanStatus(`Código manual válido (${validation.type.toUpperCase()}).`);
      return;
    }
    setMacroScanStatus(`Código manual inválido: checksum no cuadra para ${validation.type.toUpperCase()}.`);
  }

  $macroScanManual?.addEventListener("input", () => {
    updateManualBarcodeValidationHint();
  });

  $macroScanManualBtn?.addEventListener("click", async () => {
    hideMacroScanAddProduct();
    const barcodeInput = String($macroScanManual?.value || "").trim();
    const normalized = normalizeDetectedBarcode(barcodeInput);
    const validation = validateBarcodeByType(normalized || barcodeInput.replace(/\D/g, ""));
    logMacroEvent(["scanner", "manual"], "intento manual", {
      raw: barcodeInput,
      normalized,
      type: validation.type || "unknown",
      valid: validation.valid,
    }, "info");
    logLookup("ruta manual", { barcode: barcodeInput || "", lookupRequested: Boolean(barcodeInput) });
    if (!barcodeInput) {
      setMacroScanStatus("Introduce un código de barras.");
      return;
    }
    if (!validation.valid) {
      logMacroEvent(["scanner", "manual"], "código manual inválido por checksum", {
        raw: barcodeInput,
        normalized,
        type: validation.type || "unknown",
        expected: validation.expected,
        actual: validation.actual,
      }, "warn");
      setMacroScanStatus("Código manual inválido. Revisa checksum o escribe otro.");
      return;
    }
    setMacroScanStatus("Buscando...");
    await handleBarcodeFound(normalized || barcodeInput, { fromManual: true, sourceEngine: "manual" });
  });

  $macroScanStop?.addEventListener("click", async () => {
    await stopMacroBarcodeScan({ keepPendingProduct: true });
    setMacroScanStatus("Escaneo detenido.");
  });
  $macroScanManual?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      try { e.preventDefault(); } catch (_) {}
      $macroScanManualBtn?.click();
    }
  });
  $macroScanCapture?.addEventListener("click", async () => {
    if (!_macroScanRunning) {
      setMacroScanStatus("Primero abre la cámara para capturar la foto.");
      return;
    }
    hideMacroScanAddProduct();
    setMacroScanStatus("Analizando foto...");
    const captured = await captureScannerFrame("capture_button");
    if (!captured) {
      setMacroScanStatus("No se pudo capturar la foto. Reintenta.");
      return;
    }
    const code = await analyzeCapturedFrame("capture_button");
    if (!code) {
      logMacroEvent(["scanner", "manual"], "barcode no detectado: solicitar entrada manual", { reason: "static_photo_zxing+ocr_fail" }, "warn");
      if ($macroScanRetry) $macroScanRetry.classList.remove("hidden");
      setMacroScanStatus("No se detectó código en la foto. Pulsa Reintentar o escribe manualmente.");
      return;
    }
    if ($macroScanManual) $macroScanManual.value = code;
    setMacroScanStatus(`Código detectado: ${code}`);
    await handleBarcodeFound(code, { fromManual: false, sourceEngine: "captured_static" });
  });

  $macroScanRetry?.addEventListener("click", async () => {
    setMacroScanStatus("Reabriendo cámara...");
    await resumeScannerPreview();
    setMacroScanStatus("Cámara activa. Encuadra y pulsa Capturar.");
  });
  $macroScanAddProduct?.addEventListener("click", () => {
    const mode = String($macroScanAddProduct?.dataset?.mode || "manual");
    const barcode = String($macroScanAddProduct?.dataset?.barcode || $macroManualBarcode?.value || "").trim();
    const pendingLookupId = String($macroScanAddProduct?.dataset?.pendingLookupId || "").trim();
    if (barcode && $macroManualBarcode) $macroManualBarcode.value = barcode;

    if (mode === "off") {
      const pendingProduct = (pendingLookupId && _macroScanPendingLookup?.id === pendingLookupId && _macroScanPendingLookup?.product)
        ? { ..._macroScanPendingLookup.product }
        : (_macroScanPendingProduct ? { ..._macroScanPendingProduct } : null);
      if (!pendingProduct) {
        logMacroEvent(["ui"], "Abrir ficha (sin producto en memoria)", { clickReceived: true, pendingProductExists: false, openCalled: false, mode, barcode, pendingLookupId }, "warn");
        setMacroScanStatus("No tengo el producto en memoria. Repite la búsqueda o crea manualmente.");
        macroModalState.source = "manual";
        renderMacroModalResults();
        return;
      }
      logMacroEvent(["ui"], "Abrir ficha", { clickReceived: true, pendingProductExists: Boolean(pendingProduct), openCalled: true, barcode, name: pendingProduct?.name || "" }, "info");
      closeMacroAddModal();
      openMacroProductModal(pendingProduct, macroModalState.meal, 100);
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
    const parts = cleanLine.split("|").map(collapseSpaces);
    if (parts.length >= 2) {
      const left = String(parts[0] || "").trim();
      const name = String(parts[1] || "").trim();
      const note = String(parts.slice(2).join(" | ") || "").trim();
      let amount = "";
      let unit = "";
      const leftMatch = left.match(/^([0-9]+(?:[.,][0-9]+)?)\s*(.*)$/);
      if (leftMatch) {
        amount = String(leftMatch[1] || "").replace(",", ".").trim();
        unit = String(leftMatch[2] || "").trim();
      } else {
        unit = left;
      }
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
