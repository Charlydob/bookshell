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

    if (recipe) {
      el.title = title;
      el.onclick = () => {
        clickNav("view-recipes");
        window.__bookshellRecipes?.openRecipeDetail?.(recipe.id);
      };
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
      const api = window.__bookshellRecipes;
      const r = api?.getTrackedRecipe?.() || api?.getLastViewedRecipe?.() || api?.getRecentRecipeFallback?.() || null;
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
  window.addEventListener("resize", () => { try { chart?.resize(); } catch(_) {} });

  // Re-render cuando llegan datos
  window.addEventListener("bookshell:data", () => { try { render(); } catch(_) {} });

  queueMicrotask(render);
}
