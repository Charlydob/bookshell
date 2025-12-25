// recipes.js
// Pestaña de recetas con estética de estantería y gráficos adaptados

const $viewRecipes = document.getElementById("view-recipes");
if ($viewRecipes) {
  const STORAGE_KEY = "bookshell.recipes.v1";

  const MEAL_TYPES = ["desayuno", "comida", "cena", "snack"];
  const HEALTH_TYPES = ["sana", "equilibrada", "insana"];
  const palette = ["#f4d35e", "#9ad5ff", "#ff89c6", "#7dffb4", "#c8a4ff"];

  const defaultRecipes = [
    {
      id: "r1",
      title: "Shakshuka especiada",
      meal: "comida",
      health: "sana",
      tags: ["rápida", "huevo", "sartén"],
      rating: 4.5,
      favorite: true,
      laura: true,
      lastCooked: "2024-06-02",
      cookedDates: ["2024-05-19", "2024-06-02", "2024-06-10"],
      notes: "Sirve con pan crujiente y cilantro.",
    },
    {
      id: "r2",
      title: "Crema fría de calabacín",
      meal: "cena",
      health: "sana",
      tags: ["sopa", "ligera", "verano"],
      rating: 4,
      favorite: false,
      laura: false,
      lastCooked: "2024-05-28",
      cookedDates: ["2024-05-05", "2024-05-28"],
      notes: "Queda mejor con topping de semillas de sésamo.",
    },
    {
      id: "r3",
      title: "Lasagna cremosa de setas",
      meal: "comida",
      health: "equilibrada",
      tags: ["horno", "pasta", "finde"],
      rating: 5,
      favorite: true,
      laura: true,
      lastCooked: "2024-04-14",
      cookedDates: ["2024-03-30", "2024-04-14"],
      notes: "Usar grana padano y bechamel ligera.",
    },
    {
      id: "r4",
      title: "Tostadas francesas de vainilla",
      meal: "desayuno",
      health: "insana",
      tags: ["dulce", "brunch"],
      rating: 3.5,
      favorite: false,
      laura: true,
      lastCooked: "2024-06-01",
      cookedDates: ["2024-05-12", "2024-06-01"],
      notes: "Añadir frutos rojos y un toque de ralladura de naranja.",
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

  const $chartMeal = document.getElementById("recipe-chart-meal");
  const $chartHealth = document.getElementById("recipe-chart-health");

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
  const $recipeRating = document.getElementById("recipe-rating");
  const $recipeLastCooked = document.getElementById("recipe-last-cooked");
  const $recipeNotes = document.getElementById("recipe-notes");
  const $recipeFavorite = document.getElementById("recipe-favorite");
  const $recipeLaura = document.getElementById("recipe-laura");

  let recipes = loadRecipes();

  const filterState = {
    query: "",
    shelfQuery: "",
    chips: new Set(),
    favoritesOnly: false,
    lauraOnly: false,
  };

  const today = new Date();
  let calYear = today.getFullYear();
  let calMonth = today.getMonth();
  let calViewMode = "month";

  function loadRecipes() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (err) {
      console.warn("No se pudo leer recetas almacenadas", err);
    }
    return defaultRecipes;
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
      const text = [r.title, r.meal, r.health, (r.tags || []).join(" ")].join(" ").toLowerCase();
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
  }

  function buildSpine(recipe) {
    const spine = document.createElement("div");
    const [c1, c2] = recipe.favorite ? ["#f8e6aa", "#d3a74a"] : pickSpinePalette(recipe.title + recipe.id);
    const height = 110 + (recipe.tags?.length || 0) * 6;
    spine.className = "book-spine recipe-spine";
    spine.style.setProperty("--spine-color-1", c1);
    spine.style.setProperty("--spine-color-2", c2);
    spine.style.setProperty("--spine-height", `${Math.min(170, height)}px`);
    spine.title = `${recipe.title} · ${recipe.meal}`;
    if (recipe.favorite) spine.classList.add("book-spine-favorite", "recipe-spine-favorite");
    if (recipe.laura) spine.classList.add("recipe-spine-laura");

    const title = document.createElement("span");
    title.className = "book-spine-title";
    title.textContent = recipe.title;

    const meta = document.createElement("span");
    meta.className = "book-spine-meta";
    meta.textContent = `${recipe.meal} · ${recipe.health}`;

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
    spine.appendChild(meta);
    spine.addEventListener("click", () => openRecipeModal(recipe));
    spine.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openRecipeModal(recipe);
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
      meta.innerHTML = `
        <div class="recipe-meta-item"><strong>Tipo</strong><br>${recipe.meal}</div>
        <div class="recipe-meta-item"><strong>Salud</strong><br>${recipe.health}</div>
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

      actions.appendChild(lauraToggle);
      actions.appendChild(favToggle);
      actions.appendChild(editBtn);

      if (recipe.notes) {
        const notes = document.createElement("div");
        notes.className = "recipe-meta-item";
        notes.innerHTML = `<strong>Notas</strong><br>${recipe.notes}`;
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
    if ($statRating) $statRating.textContent = `${rating.toFixed(1)} ★`;
  }

  function renderDonut(host, title, entries) {
    if (!host) return;
    host.innerHTML = "";
    const total = entries.reduce((acc, e) => acc + e.value, 0);
    if (!total) {
      host.innerHTML = `<div class="books-shelf-empty">Sin datos</div>`;
      return;
    }

    const donut = document.createElement("div");
    donut.className = "recipes-donut";
    const ring = document.createElement("div");
    ring.className = "recipes-donut-ring";
    const hole = document.createElement("div");
    hole.className = "recipes-donut-hole";
    hole.innerHTML = `<strong>${title}</strong><span>${total} total</span>`;
    donut.appendChild(ring);
    donut.appendChild(hole);

    let offset = 0;
    const stops = entries.map((entry, idx) => {
      const pct = (entry.value / total) * 100;
      const start = offset;
      const end = offset + pct;
      offset = end;
      return { ...entry, start, end, color: palette[idx % palette.length] };
    });

    const gradient = stops
      .map((s) => `${s.color} ${s.start.toFixed(2)}% ${s.end.toFixed(2)}%`)
      .join(", ");
    ring.style.background = `conic-gradient(${gradient})`;

    const legend = document.createElement("div");
    legend.className = "recipes-donut-legend";
    stops.forEach((s) => {
      const row = document.createElement("div");
      row.className = "recipes-donut-legend-row";
      row.innerHTML = `
        <span class="recipes-donut-color" style="background:${s.color}"></span>
        <span>${s.label} · ${Math.round((s.value / total) * 100)}%</span>
      `;
      legend.appendChild(row);
    });

    host.appendChild(donut);
    host.appendChild(legend);
  }

  function renderCharts() {
    const mealMap = [];
    MEAL_TYPES.forEach((m) => {
      const count = recipes.filter((r) => r.meal === m).length;
      mealMap.push({ label: m, value: count });
    });
    renderDonut($chartMeal, "Momento del día", mealMap.filter((m) => m.value > 0));

    const healthMap = [];
    HEALTH_TYPES.forEach((h) => {
      const count = recipes.filter((r) => r.health === h).length;
      healthMap.push({ label: h, value: count });
    });
    renderDonut($chartHealth, "Salud", healthMap.filter((h) => h.value > 0));
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
    $modalBackdrop.classList.remove("hidden");
    $modalBackdrop.focus?.();
    if (recipe) {
      $recipeId.value = recipe.id;
      $modalTitle.textContent = "Editar receta";
      $recipeName.value = recipe.title || "";
      $recipeMeal.value = recipe.meal || "comida";
      $recipeHealth.value = recipe.health || "sana";
      $recipeTags.value = (recipe.tags || []).join(", ");
      $recipeRating.value = recipe.rating ?? 0;
      $recipeLastCooked.value = recipe.lastCooked || "";
      $recipeNotes.value = recipe.notes || "";
      $recipeFavorite.checked = !!recipe.favorite;
      $recipeLaura.checked = !!recipe.laura;
    } else {
      $modalTitle.textContent = "Nueva receta";
      $recipeId.value = "";
      $recipeName.value = "";
      $recipeMeal.value = "comida";
      $recipeHealth.value = "sana";
      $recipeTags.value = "";
      $recipeRating.value = "4";
      $recipeLastCooked.value = "";
      $recipeNotes.value = "";
      $recipeFavorite.checked = false;
      $recipeLaura.checked = false;
    }
  }

  function closeRecipeModal() {
    if ($modalBackdrop) $modalBackdrop.classList.add("hidden");
  }

  function updateRecipe(id, patch) {
    recipes = recipes.map((r) => (r.id === id ? { ...r, ...patch } : r));
    saveRecipes();
    refreshUI();
  }

  function upsertRecipeFromForm(evt) {
    evt.preventDefault();
    const id = $recipeId.value || generateId();
    const existing = recipes.find((r) => r.id === id);
    const cookedDates = [...(existing?.cookedDates || [])];
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
      favorite: $recipeFavorite.checked,
      laura: $recipeLaura.checked,
      cookedDates,
    };

    if (!payload.title) return;
    if (payload.lastCooked && !payload.cookedDates.includes(payload.lastCooked)) {
      payload.cookedDates.push(payload.lastCooked);
    }

    if (existing) {
      recipes = recipes.map((r) => (r.id === id ? { ...r, ...payload } : r));
    } else {
      recipes = [{ ...payload }, ...recipes];
    }
    saveRecipes();
    closeRecipeModal();
    refreshUI();
  }

  function refreshUI() {
    renderChips();
    renderShelf();
    renderCards();
    renderStats();
    renderCharts();
    renderCalendar();
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
    renderCards();
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
    renderCards();
    renderCharts();
  });

  $btnAddRecipe?.addEventListener("click", () => openRecipeModal());
  $modalClose?.addEventListener("click", closeRecipeModal);
  $modalCancel?.addEventListener("click", closeRecipeModal);
  $modalBackdrop?.addEventListener("click", (e) => {
    if (e.target === $modalBackdrop) closeRecipeModal();
  });
  $recipeForm?.addEventListener("submit", upsertRecipeFromForm);

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
