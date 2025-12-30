// recipes.js
// Pestaña de recetas con estética de estantería y gráficos adaptados

import {
  ensureCountryDatalist,
  getCountryEnglishName,
  normalizeCountryInput
} from "./countries.js";
import { renderCountryHeatmap, renderCountryList } from "./world-heatmap.js";

const $viewRecipes = document.getElementById("view-recipes");
if ($viewRecipes) {
  const STORAGE_KEY = "bookshell.recipes.v1";

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

  function loadRecipes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map(normalizeRecipeFields);
      }
    } catch (err) {
      console.warn("No se pudo leer recetas almacenadas", err);
    }
    return defaultRecipes.map(normalizeRecipeFields);
  }

  function saveRecipes() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(recipes));
    } catch (err) {
      console.warn("No se pudo guardar recetas", err);
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
      ingredients,
      steps,
    };
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
    const height = 138;
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

      actions.appendChild(lauraToggle);
      actions.appendChild(favToggle);
      actions.appendChild(editBtn);
      actions.appendChild(openBtn);

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
    if (!stats.length) {
      $recipesGeoSection.style.display = "none";
      if ($recipesWorldMap) {
        if (typeof $recipesWorldMap.__geoCleanup === "function") $recipesWorldMap.__geoCleanup();
        $recipesWorldMap.innerHTML = "";
      }
      if ($recipesCountryList) $recipesCountryList.innerHTML = "";
      return;
    }
    $recipesGeoSection.style.display = "block";
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
    }
  }

  function closeRecipeModal() {
    if ($modalBackdrop) $modalBackdrop.classList.add("hidden");
  }

  function updateRecipe(id, patch) {
    const ts = Date.now();
    const mergedPatch = { ...(patch || {}), updatedAt: ts };
    recipes = recipes.map((r) => (r.id === id ? normalizeRecipeFields({ ...r, ...mergedPatch }) : r));
    saveRecipes();
    refreshUI();
    if (detailRecipeId === id) renderRecipeDetail(id);
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
  }

  function upsertRecipeFromForm(evt) {
    evt.preventDefault();
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
    };

    if (!payload.title) return;
    if (payload.lastCooked && !payload.cookedDates.includes(payload.lastCooked)) {
      payload.cookedDates.push(payload.lastCooked);
    }

    const normalizedPayload = normalizeRecipeFields(payload);

    if (existing) {
      recipes = recipes.map((r) => (r.id === id ? { ...r, ...normalizedPayload } : r));
    } else {
      recipes = [{ ...normalizedPayload }, ...recipes];
    }
    saveRecipes();
    closeRecipeModal();
    refreshUI();
  }

  function refreshUI() {
    renderChips();
    renderShelf();
    renderStats();
    renderCharts();
    renderCalendar();
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
    remove.className = "icon-btn icon-btn-small";
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
      .map((row) => ({
        id: row.dataset.id || generateId(),
        text: row.querySelector("input[type='text']")?.value.trim() || "",
        done: row.querySelector("input[type='checkbox']")?.checked || false,
      }))
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

  function renderRecipeDetail(id) {
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe || !$recipeDetailBackdrop) return;
    setActiveRecipePanel("ingredients");

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
      ];
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
          const check = document.createElement("input");
          check.type = "checkbox";
          check.checked = !!ing.done;
          check.addEventListener("change", (e) =>
            toggleChecklistItem(recipe.id, ing.id, e.target.checked, "ingredient")
          );
          const text = document.createElement("span");
          text.textContent = ing.text || "Ingrediente";
          label.appendChild(check);
          label.appendChild(text);
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

    recipes = (Array.isArray(recipes) ? recipes : []).map((r) => {
      if (!r) return r;
      const isTarget = String(r.id) === idStr;

      // si activamos, quitamos tracking al resto (solo una en seguimiento)
      if (shouldTrack && !isTarget) {
        if (!r.tracking) return r;
        return normalizeRecipeFields({ ...r, tracking: false, trackingAt: r.trackingAt || null, updatedAt: ts });
      }

      if (!isTarget) return r;

      if (shouldTrack) {
        return normalizeRecipeFields({ ...r, tracking: true, trackingAt: ts, updatedAt: ts });
      }
      return normalizeRecipeFields({ ...r, tracking: false, trackingAt: null, updatedAt: ts });
    });

    saveRecipes();
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
    saveRecipes();
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
  $recipeDelete?.addEventListener("click", () => {
    const id = $recipeId.value;
    if (id) deleteRecipe(id);
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

    saveRecipes();
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
  });

  $calViewMode?.addEventListener("change", (e) => {
    calViewMode = e.target.value;
    renderCalendar();
  });

  // Inicial
  refreshUI();
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

// === API para Dashboard (Inicio) ===
function getLastViewedRecipe() {
  try {
    const id = localStorage.getItem("bookshell.lastRecipeId");
    if (!id) return null;
    return (Array.isArray(recipes) ? recipes : []).find((r) => String(r.id) === String(id)) || null;
  } catch (_) {
    return null;
  }
}

function getTrackedRecipe() {
  try {
    // Prefer la última receta marcada "en seguimiento" (bookmark)
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

    // si hay id almacenado pero no trackingAt, devolvemos por id
    if (!best && storedId) return list.find((r) => String(r.id) === String(storedId)) || null;

    return best || null;
  } catch (_) {
    return null;
  }
}

function recipeSortTs(r) {
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

function getRecentRecipeFallback() {
  try {
    const list = Array.isArray(recipes) ? [...recipes] : [];

    const withIngredientChecks = list.filter((r) =>
      Array.isArray(r?.ingredients) && r.ingredients.some((ing) => !!ing?.done)
    );

    const pickFrom = withIngredientChecks.length ? withIngredientChecks : list;

    pickFrom.sort((a, b) => {
      const ta = Number(a?.updatedAt) || 0;
      const tb = Number(b?.updatedAt) || 0;
      return tb - ta;
    });

    return pickFrom[0] || null;
  } catch (_) {
    return null;
  }
}


try {
  window.__bookshellRecipes = {
    getTrackedRecipe,
    getLastViewedRecipe,
    getRecentRecipeFallback,
    openRecipeDetail
  };
} catch (_) {}

try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
