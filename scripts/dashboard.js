// Dashboard (Inicio) — v3.1 (fix colores + shelf + selector unidad)
const $viewMain = document.getElementById("view-main");
const $appShell = document.querySelector(".app-shell");
function syncAppShellVisibility() {
  if (!$appShell) return;
  const navActive = document.querySelector(".nav-btn.nav-btn-active")?.dataset?.view || "";
  const mainActive = ($viewMain && $viewMain.classList.contains("is-active")) || navActive === "view-main";
  $appShell.style.display = mainActive ? "" : "none";
}
document.addEventListener("click", (e) => {
  if (e.target?.closest?.(".bottom-nav .nav-btn")) queueMicrotask(syncAppShellVisibility);
});
if ($viewMain) {
  try {
    const obs = new MutationObserver(() => syncAppShellVisibility());
    obs.observe($viewMain, { attributes: true, attributeFilter: ["class"] });
  } catch (_) {}
}
syncAppShellVisibility();

if ($viewMain) {
  const $rangeRow = document.getElementById("dash-range");
  const $donutEl = document.getElementById("dash-donut");
  const $legendEl = document.getElementById("dash-legend");
  const $unitHost = document.getElementById("dash-unit");

  const $btnHabitSession = document.getElementById("dash-habit-session");
  const $btnHabitOpen = document.getElementById("dash-habit-open");

  const $shelfBook = document.getElementById("dash-shelf-book");
  const $shelfRecipe = document.getElementById("dash-shelf-recipe");
  const $btnShelfBooks = document.getElementById("dash-shelf-open-books");
  const $btnShelfRecipes = document.getElementById("dash-shelf-open-recipes");

  const $videoTitle = document.getElementById("dash-video-title");
  const $videoMeta = document.getElementById("dash-video-meta");
  const $btnVideoTimer = document.getElementById("dash-video-timer");
  const $btnVideoOpen = document.getElementById("dash-video-open");

  let activeRange = "day"; // day|week|month|year|total
  let activeUnit = loadTimeUnit(); // h|m|s|d|w|mo
  let chart = null;

  // --- Dashboard: Última receta revisada (tracking robusto) ---
  const LS_LAST_RECIPE = "bookshell:lastRecipeViewed:v1";
  function loadLastRecipeViewed() {
    try {
      const raw = localStorage.getItem(LS_LAST_RECIPE);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return null;
      return obj;
    } catch (_) {
      return null;
    }
  }
  function saveLastRecipeViewed(patch) {
    try {
      const prev = loadLastRecipeViewed() || {};
      const next = { ...prev, ...patch, ts: Date.now() };
      localStorage.setItem(LS_LAST_RECIPE, JSON.stringify(next));
    } catch (_) {}
  }
  function patchRecipesApiForLastViewed() {
    const api = window.__bookshellRecipes;
    if (!api || api.__dashLastViewedPatched) return;
    api.__dashLastViewedPatched = true;

    const origOpen = api.openRecipeDetail;
    if (typeof origOpen === "function") {
      api.openRecipeDetail = function (id) {
        if (id !== undefined && id !== null) {
          saveLastRecipeViewed({ id: String(id) });
          queueMicrotask(() => {
            try {
              const rec =
                api.getRecipeById?.(id) ||
                api.getRecipe?.(id) ||
                api.getById?.(id) ||
                null;
              const t = rec?.title || rec?.name;
              if (t) saveLastRecipeViewed({ title: String(t) });
            } catch (_) {}
          });
          setTimeout(() => {
            const t = document.getElementById("recipe-detail-title")?.textContent?.trim();
            if (t) saveLastRecipeViewed({ title: t });
          }, 250);
        }
        return origOpen.apply(this, arguments);
      };
    }
  }
  function getBestRecipeForShelf() {
    const api = window.__bookshellRecipes;
    const direct =
      api?.getTrackedRecipe?.() ||
      api?.getLastViewedRecipe?.() ||
      api?.getRecentRecipeFallback?.() ||
      null;
    if (direct) return direct;

    const last = loadLastRecipeViewed();
    if (!last) return null;

    const id = last.id ?? last.recipeId ?? null;
    const title = last.title ?? last.name ?? null;

    if (id && api) {
      try {
        const full =
          api.getRecipeById?.(id) ||
          api.getRecipe?.(id) ||
          api.getById?.(id) ||
          null;
        if (full) return full;
      } catch (_) {}
      return { id, title: title || "Receta" };
    }
    if (title) return { title };
    return null;
  }

  // --- Dashboard: mapa con selector (porta mapas existentes al Inicio) ---
  const LS_DASH_MAP = "bookshell:dashMap:v1";
  const $dashMapSelect = document.getElementById("dash-map-select");
  const $dashMapHost = document.getElementById("dash-map-host");
  const $dashMapEmpty = document.getElementById("dash-map-empty");

  const DASH_MAPS = {
    media: { id: "media-world-map", label: "Pantalla", view: "view-media", section: "media-map-card" },
    books: { id: "books-world-map", label: "Libros", view: "view-books", section: "books-geo-section" },
    recipes: { id: "recipes-world-map", label: "Recetas", view: "view-recipes", section: "recipes-geo-section" },
    world: { id: "world-map", label: "Mundo", view: "view-world", section: null },
  };

  let _dashMountedMapKey = null;
  const _dashMapPortals = Object.create(null); // key -> { el, parent, placeholder }

  let _dashMapPriming = false;

  function _dashActiveViewId() {
    const b = document.querySelector(".bottom-nav .nav-btn.nav-btn-active");
    return b?.dataset?.view || null;
  }
  function _dashClickNav(viewId) {
    const btn = document.querySelector(`.bottom-nav .nav-btn[data-view="${viewId}"]`);
    if (btn) btn.click();
  }
  function _dashNextFrame() {
    return new Promise((res) => requestAnimationFrame(() => res()));
  }
  function _dashIsRendered(el) {
    if (!el) return false;
    if (el.__geoChart) return true;
    try { if (window.echarts?.getInstanceByDom?.(el)) return true; } catch (_) {}
    return false;
  }

  async function primeDashMap(key) {
    const conf = DASH_MAPS[key];
    const el = conf ? document.getElementById(conf.id) : null;
    if (!conf || !el) return false;
    if (_dashIsRendered(el)) return true;

    // hacemos visible temporalmente la sección del mapa (si existe)
    let sec = null;
    let prevDisplay = null;
    if (conf.section) {
      sec = document.getElementById(conf.section);
      if (sec) {
        prevDisplay = sec.style.display;
        sec.style.display = "block";
      }
    }

    const prevView = _dashActiveViewId() || "view-main";

    // ir a la vista del mapa para que su JS lo inicialice
    if (conf.view && prevView !== conf.view) {
      _dashClickNav(conf.view);
      await _dashNextFrame();
      await _dashNextFrame();
    } else {
      await _dashNextFrame();
    }

    // darle una oportunidad extra a echarts a medir tamaños
    try { window.dispatchEvent(new Event("resize")); } catch (_) {}
    await _dashNextFrame();

    // volver a Inicio
    if (prevView !== "view-main") {
      _dashClickNav(prevView);
      await _dashNextFrame();
    } else if (conf.view && conf.view !== "view-main") {
      _dashClickNav("view-main");
      await _dashNextFrame();
    }

    // restaurar visibilidad de la sección
    if (sec) sec.style.display = prevDisplay;

    return _dashIsRendered(el);
  }

  async function ensureDashMapReadyAndMount(key) {
    if (!isDashboardActive()) return;
    const conf = DASH_MAPS[key];
    const el = conf ? document.getElementById(conf.id) : null;
    if (!conf || !el) {
      if ($dashMapEmpty) {
        $dashMapEmpty.textContent = "No hay mapa aún. Abre esa pestaña una vez para inicializarlo.";
        $dashMapEmpty.style.display = "";
      }
      return;
    }

    if (_dashIsRendered(el)) {
      mountDashMapNow(key);
      return;
    }

    if (_dashMapPriming) return;
    _dashMapPriming = true;

    if ($dashMapEmpty) {
      $dashMapEmpty.textContent = "Cargando mapa…";
      $dashMapEmpty.style.display = "";
    }

    const ok = await primeDashMap(key);

    _dashMapPriming = false;

    if (!isDashboardActive()) return;
    if (!ok) {
      if ($dashMapEmpty) {
        $dashMapEmpty.textContent = "No he podido inicializar ese mapa todavía. Entra una vez en esa pestaña y vuelve.";
        $dashMapEmpty.style.display = "";
      }
      return;
    }

    mountDashMapNow(key);
  }


  function loadDashMapKey() {
    const k = localStorage.getItem(LS_DASH_MAP);
    return (k && DASH_MAPS[k]) ? k : "world";
  }
  function saveDashMapKey(k) {
    try { localStorage.setItem(LS_DASH_MAP, k); } catch (_) {}
  }
  function isDashboardActive() {
    const navActive = document.querySelector(".nav-btn.nav-btn-active")?.dataset?.view || "";
    const mainActive = ($viewMain && $viewMain.classList.contains("view-active")) || navActive === "view-main";
    return mainActive;
  }
  function resizeMaybe(el) {
    try {
      const inst = el.__geoChart || window.echarts?.getInstanceByDom?.(el) || null;
      inst?.resize?.();
    } catch (_) {}
  }
  function restoreAllDashMaps() {
    Object.values(_dashMapPortals).forEach((p) => {
      if (!p?.el || !p?.parent || !p?.placeholder) return;
      if (p.el.parentElement === $dashMapHost) {
        p.parent.insertBefore(p.el, p.placeholder);
      }
    });
    _dashMountedMapKey = null;
  }
  function mountDashMapNow(key) {
    if (!$dashMapHost) return;
    const conf = DASH_MAPS[key];
    if (!conf) return;

    // si no estamos en Inicio, no tocamos nada
    if (!isDashboardActive()) return;

    // ya montado
    if (_dashMountedMapKey === key && document.getElementById(conf.id)?.parentElement === $dashMapHost) {
      resizeMaybe(document.getElementById(conf.id));
      return;
    }

    restoreAllDashMaps();
    _dashMountedMapKey = key;

    const el = document.getElementById(conf.id);
    if (!el || !el.parentElement) {
      if ($dashMapEmpty) {
        $dashMapEmpty.textContent = "No hay mapa aún. Abre esa pestaña una vez para inicializarlo.";
        $dashMapEmpty.style.display = "";
      }
      return;
    }

    if ($dashMapEmpty) $dashMapEmpty.style.display = "none";

    let portal = _dashMapPortals[key];
    if (!portal) {
      const placeholder = document.createElement("div");
      placeholder.setAttribute("data-dash-map-placeholder", conf.id);
      placeholder.style.display = "none";
      el.parentElement.insertBefore(placeholder, el.nextSibling);
      portal = _dashMapPortals[key] = { el, parent: el.parentElement, placeholder };
    }

    $dashMapHost.appendChild(el);
    el.classList.add("dash-map-ported");

    // resize (echarts) inmediato + un pelín después
    resizeMaybe(el);
    setTimeout(() => resizeMaybe(el), 120);
  }

  function mountDashMap(key) {
    // wrapper: asegura init incluso si no has entrado antes a la pestaña
    void ensureDashMapReadyAndMount(key);
  }


  function initDashMapPortal() {
    if (!$dashMapSelect || !$dashMapHost) return;

    const k = loadDashMapKey();
    $dashMapSelect.value = k;
    // asegura opciones (por si el HTML no se actualizó)
    if ($dashMapSelect && !Array.from($dashMapSelect.options || []).some(o => o.value === "books")) {
      const opt = document.createElement("option");
      opt.value = "books";
      opt.textContent = "Libros";
      const before = Array.from($dashMapSelect.options || []).find(o => o.value === "recipes") || null;
      $dashMapSelect.insertBefore(opt, before);
    }


    $dashMapSelect.addEventListener("change", () => {
      const key = $dashMapSelect.value;
      saveDashMapKey(key);
      mountDashMap(key);
    });

    // nav clicks
    document.addEventListener(
      "click",
      (e) => {
        const btn = e.target?.closest?.(".bottom-nav .nav-btn");
        if (!btn) return;
        const view = btn.dataset.view;
        if (view === "view-main") { if (!_dashMapPriming) queueMicrotask(() => mountDashMap($dashMapSelect.value || loadDashMapKey())); }
        
        else restoreAllDashMaps();
      },
      true
    );

    // si existe showView, lo parchamos para restaurar/montar
    if (typeof window.showView === "function" && !window.__dashShowViewMapPatched) {
      window.__dashShowViewMapPatched = true;
      const orig = window.showView;
      window.showView = function (viewId) {
        if (viewId !== "view-main") restoreAllDashMaps();
        const r = orig.apply(this, arguments);
        if (viewId === "view-main") { if (!_dashMapPriming) queueMicrotask(() => mountDashMap($dashMapSelect.value || loadDashMapKey())); }
        return r;
      };
    }

    // primer mount
    mountDashMap(k);
  }


  const TIME_UNITS = [
    { key: "h", label: "Horas" },
    { key: "m", label: "Minutos" },
    { key: "s", label: "Segundos" },
    { key: "d", label: "Días" },
    { key: "w", label: "Semanas" },
    { key: "mo", label: "Meses" }
  ];

  function loadTimeUnit() {
    try { return localStorage.getItem("bookshell.timeUnit") || "h"; }
    catch (_) { return "h"; }
  }
  function setTimeUnit(unit) {
    activeUnit = unit;
    try { localStorage.setItem("bookshell.timeUnit", unit); } catch (_) {}
    renderUnitSelect();
    renderDonut();
  }

  const resolveHabitColor = (h) => (h?.color || h?.accent || h?.hex || "#7f5dff");

  function fmtHM(minutes) {
    const m = Math.max(0, Math.round(Number(minutes) || 0));
    const h = Math.floor(m / 60);
    const r = m % 60;
    return h > 0 ? `${h}h ${String(r).padStart(2, "0")}m` : `${r}m`;
  }

  function fmtByUnit(minutes) {
    const m = Math.max(0, Number(minutes) || 0);
    if (activeUnit === "h") return fmtHM(m);
    if (activeUnit === "m") return `${Math.round(m)}m`;
    if (activeUnit === "s") return `${Math.round(m * 60)}s`;
    if (activeUnit === "d") return `${(m / (60 * 24)).toFixed(m >= 60 * 24 * 10 ? 0 : 1)}d`;
    if (activeUnit === "w") return `${(m / (60 * 24 * 7)).toFixed(m >= 60 * 24 * 7 * 10 ? 0 : 1)}sem`;
    return `${(m / (60 * 24 * 30.437)).toFixed(m >= 60 * 24 * 30.437 * 10 ? 0 : 1)}mes`;
  }

  function clampText(s, max = 26) {
    const t = String(s || "").trim();
    return t.length <= max ? t : t.slice(0, max - 1) + "…";
  }

  function hash32(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  const RECIPE_PALETTES = [
    ["#7f5dff", "#4ec5ff"],
    ["#ff4d6d", "#ffb86b"],
    ["#2fdc8f", "#6d7cff"],
    ["#ffd166", "#ef476f"],
    ["#06d6a0", "#118ab2"],
    ["#c77dff", "#80ffdb"],
    ["#f72585", "#7209b7"],
    ["#ff9f1c", "#2ec4b6"]
  ];
  function pickRecipePalette(seed) {
    const i = hash32(String(seed || "")) % RECIPE_PALETTES.length;
    return RECIPE_PALETTES[i];
  }

  function clickNav(viewId) {
    // main.js tiene el router; si existe, lo usamos. Si no, intentamos click a nav.
    if (typeof window.showView === "function") return window.showView(viewId);
    const btn = document.querySelector(`.nav-btn[data-view="${viewId}"]`);
    btn?.click?.();
  }

  function createRecipeSpine(recipe) {
    const el = document.createElement("div");
    el.className = "recipe-spine";
    if (!recipe) el.classList.add("placeholder");

    const title = recipe?.title || "Sin receta";
    const [c1, c2] = pickRecipePalette(title + (recipe?.id || ""));
    el.style.setProperty("--spine-color-1", c1);
    el.style.setProperty("--spine-color-2", c2);

    const t = document.createElement("span");
    t.className = "recipe-spine-title";
    t.textContent = clampText(title, 28);
    el.appendChild(t);

    if (recipe?.tracking) el.classList.add("tracking");

    if (recipe?.id) {
      el.title = title;
      el.onclick = () => {
        clickNav("view-recipes");
        window.__bookshellRecipes?.openRecipeDetail?.(recipe.id);
      };
    } else if (recipe) {
      el.title = title;
      el.classList.add("nolink");
    }
    return el;
  }

  function renderUnitSelect() {
    if (!$unitHost) return;
    $unitHost.innerHTML = "";
    const sel = document.createElement("select");
    sel.className = "dash-unit-select";
    sel.setAttribute("aria-label", "Unidad de tiempo");
    TIME_UNITS.forEach((u) => {
      const opt = document.createElement("option");
      opt.value = u.key;
      opt.textContent = u.label;
      if (u.key === activeUnit) opt.selected = true;
      sel.appendChild(opt);
    });
    sel.onchange = () => setTimeUnit(sel.value || "h");
    $unitHost.appendChild(sel);
  }

  function renderRangeRow() {
    if (!$rangeRow) return;
    $rangeRow.innerHTML = "";
    const ranges = [
      { key: "day", label: "Día" },
      { key: "week", label: "Semana" },
      { key: "month", label: "Mes" },
      { key: "year", label: "Año" },
      { key: "total", label: "Total" }
    ];
    ranges.forEach((r) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dash-chip" + (activeRange === r.key ? " is-active" : "");
      b.textContent = r.label;
      b.onclick = () => {
        activeRange = r.key;
        renderRangeRow();
        renderDonut();
      };
      $rangeRow.appendChild(b);
    });
  }

  function renderDonut() {
    if (!$donutEl || typeof echarts === "undefined") return;

    const api = window.__bookshellHabits;
    const rows = api?.getTimeShareByHabit?.(activeRange) || [];
    const totalMinutes = rows.reduce((a, it) => a + (it.minutes || 0), 0);

    if (!chart) chart = echarts.init($donutEl);

    const subtitle = api?.rangeLabel?.(activeRange) || "Distribución";

    chart.setOption({
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        formatter: (p) => {
          const m = Number(p.value || 0);
          return `${p.name}: ${fmtByUnit(m)} (${p.percent}%)`;
        }
      },
      title: [
        { text: "Tiempo", left: "center", top: "44%", textStyle: { color: "#a5afc7", fontSize: 12, fontWeight: 700 } },
        { text: fmtByUnit(totalMinutes), left: "center", top: "52%", textStyle: { color: "#f5f7ff", fontSize: 20, fontWeight: 900 } },
        { text: subtitle, left: "center", top: "64%", textStyle: { color: "rgba(245,247,255,0.55)", fontSize: 11, fontWeight: 700 } }
      ],
      series: [
        {
          type: "pie",
          radius: ["62%", "84%"],
          avoidLabelOverlap: true,
          itemStyle: { borderWidth: 2, borderColor: "rgba(0,0,0,0.22)" },
          label: { show: false },
          data: rows.map((it) => ({
            name: `${it.habit?.emoji || "🏷️"} ${it.habit?.name || "Hábito"}`,
            value: it.minutes || 0
          })),
          color: rows.map((it) => resolveHabitColor(it.habit))
        }
      ]
    }, true);

    try { chart.resize(); } catch (_) {}
    renderLegend(rows, totalMinutes);
  }

  function renderLegend(rows, totalMinutes) {
    if (!$legendEl) return;
    $legendEl.innerHTML = "";

    const sorted = [...rows].sort((a, b) => (b.minutes || 0) - (a.minutes || 0));
    sorted.forEach((it) => {
      const minutes = Math.round(it.minutes || 0);
      const pct = totalMinutes > 0 ? Math.round((minutes / totalMinutes) * 100) : 0;
      const color = resolveHabitColor(it.habit);

      const row = document.createElement("div");
      row.className = "dash-legend-item";
      row.style.setProperty("--habit-color", color);

      row.innerHTML = `
        <div class="dash-legend-left">
          <span class="dash-dot"></span>
          <div class="dash-legend-name">${it.habit?.name || "Hábito"}</div>
        </div>
        <div class="dash-legend-meta">${pct}% · ${fmtByUnit(minutes)}</div>
      `;
      $legendEl.appendChild(row);
    });

    if (!sorted.length) {
      const empty = document.createElement("div");
      empty.className = "dash-legend-item";
      empty.textContent = "Hoy está vacío. Eso también cuenta.";
      $legendEl.appendChild(empty);
    }
  }

  function renderShelf() {
    // Libro (spine real)
    if ($shelfBook) {
      $shelfBook.innerHTML = "";
      const b = window.__bookshellBooks?.getRecentBook?.();
      if (b && typeof window.buildReadingSpine === "function") {
        const spine = window.buildReadingSpine(b.id);
        spine.style.setProperty("--spine-width", "56px");
        $shelfBook.appendChild(spine);
      } else {
        const ph = document.createElement("div");
        ph.className = "recipe-spine placeholder";
        ph.innerHTML = `<span class="recipe-spine-title">Sin libro</span>`;
        $shelfBook.appendChild(ph);
      }
    }

    // Receta
    if ($shelfRecipe) {
      $shelfRecipe.innerHTML = "";
      patchRecipesApiForLastViewed();
      const r = getBestRecipeForShelf();
      $shelfRecipe.appendChild(createRecipeSpine(r));
    }
  }

  function renderVideo() {
    const api = window.__bookshellVideos;
    const v = api?.getRecentVideo?.();
    if (!$videoTitle || !$videoMeta) return;

    if (!v) {
      $videoTitle.textContent = "Sin vídeo reciente";
      $videoMeta.textContent = "Abre Vídeos y actualiza uno.";
      if ($btnVideoTimer) $btnVideoTimer.disabled = true;
      return;
    }

    $videoTitle.textContent = v.title || "Vídeo";
    $videoMeta.textContent = v.statusLabel || "";

    if ($btnVideoTimer) {
      $btnVideoTimer.disabled = false;
      $btnVideoTimer.textContent = api?.isTimerRunning?.() ? "Parar cronómetro" : "Empezar cronómetro";
      $btnVideoTimer.onclick = async () => {
        if (api?.isTimerRunning?.()) await api?.stopVideoTimer?.();
        else api?.startVideoTimer?.();
        renderVideo();
      };
    }

    if ($btnVideoOpen) {
      $btnVideoOpen.onclick = () => {
        clickNav("view-videos");
        api?.openVideoModal?.(v.id);
      };
    }
  }

  function bindButtons() {
    if ($btnHabitOpen) $btnHabitOpen.onclick = () => clickNav("view-habits");
    if ($btnHabitSession) $btnHabitSession.onclick = () => {
      // Sin sorpresas: abre hábitos y lanza toggle
      clickNav("view-habits");
      window.__bookshellHabits?.toggleSession?.();
    };

    if ($btnShelfBooks) $btnShelfBooks.onclick = () => clickNav("view-books");
    if ($btnShelfRecipes) $btnShelfRecipes.onclick = () => clickNav("view-recipes");
  }

  function render() {
    if (!$viewMain.classList.contains("view-active")) return;
    renderRangeRow();
    renderUnitSelect();
    renderDonut();
    renderShelf();
    renderVideo();
  }

  window.__bookshellDashboard = { render };

  bindButtons();
  initDashMapPortal();
  patchRecipesApiForLastViewed();
  window.addEventListener("resize", () => { try { chart?.resize(); } catch(_) {} });

  // Re-render cuando llegan datos
  window.addEventListener("bookshell:data", () => { try { render(); } catch(_) {} });

  queueMicrotask(render);
}
