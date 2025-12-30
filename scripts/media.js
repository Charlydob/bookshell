// Media: Pelis/Series/Anime (lista virtual + donut + mapa) — ultra ligero
// - Lista virtual (no tarjetas)
// - Colores por tipo (sin pills)
// - Rating 0–5 con “estrellas deslizables”
// - Watchlist + Laura check + progreso S/E
// - Filtros: búsqueda, tipo, estado, Laura, rango (día/semana/mes/año/total)
// - Donut: por tipo o por género (respeta filtros)
// - Mapa/heatmap: por origen (respeta filtros)

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyC1oqRk7GpYX854RfcGrYHt6iRun5TfuYE",
  authDomain: "bookshell-59703.firebaseapp.com",
  databaseURL: "https://bookshell-59703-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bookshell-59703",
  storageBucket: "bookshell-59703.appspot.com",
  messagingSenderId: "554557230752",
  appId: "1:554557230752:web:37c24e287210433cf883c5"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);
const MEDIA_PATH = "media";

const LS_KEY = "bookshell.media.v2";
const ROW_H = 46; // alto fijo para virtualización

let items = [];
let filtered = [];
let donutChart = null;
let mapChart = null;

const state = {
  q: "",
  type: "all",        // all|movie|series|anime
  status: "all",      // all|watched|watchlist
  laura: "all",       // all|with|without
  range: "total",     // day|week|month|year|total  (solo afecta a 'watched')
  chart: "type",      // type|genre
  view: "list"        // list|charts|map
};

function log(msg, ...rest) { try { console.debug("[media]", msg, ...rest); } catch (_) {} }

function uid() {
  return (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
}

function norm(s) { return String(s || "").trim(); }
function normKey(s) { return norm(s).toLowerCase(); }

function parseCSV(s) {
  return norm(s).split(",").map(v => norm(v)).filter(Boolean).slice(0, 30);
}


function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    items = Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    items = [];
  }
}

function saveCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (_) {}
}

function firebasePath(id = "") {
  return id ? `${MEDIA_PATH}/${id}` : MEDIA_PATH;
}

let firebaseBound = false;

function bindFirebaseOnce() {
  if (firebaseBound) return;
  firebaseBound = true;

  try {
    onValue(ref(db, firebasePath()), (snap) => {
      const val = snap.val();

      // si no hay nada aún en remoto, mantenemos cache local
      if (!val || typeof val !== "object") {
        // remoto vacío: si tienes cache local, la subimos 1 vez
        if (!window.__mediaBootstrapDone && Array.isArray(items) && items.length) {
          try {
            const obj = {};
            for (const it of items) obj[it.id] = it;
            set(ref(db, firebasePath()), obj);
            window.__mediaBootstrapDone = true;
            R("firebase bootstrap", items.length);
          } catch (e) {
            console.warn("[media] firebase bootstrap failed", e);
          }
        }
        return;
      }

      items = Object.entries(val).map(([id, it]) => ({ id, ...(it || {}) }))
        .sort(byUpdatedDesc);

      saveCache();
      refresh();
      R("firebase sync", items.length);
    });
    R("firebase bound ok");
  } catch (e) {
    console.warn("[media] firebase bind failed", e);
  }
}

function pushItemToFirebase(item) {
  try { set(ref(db, firebasePath(item.id)), item); } catch (e) { console.warn("[media] firebase set failed", e); }
}

function deleteItemFromFirebase(id) {
  try { set(ref(db, firebasePath(id)), null); } catch (e) { console.warn("[media] firebase delete failed", e); }
}

function load() {
  loadCache();
  bindFirebaseOnce();
}

function save() {
  saveCache();
  try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
}


function byUpdatedDesc(a, b) {
  return (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
}

function nowTs() { return Date.now(); }

function startOfDay(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ts = nowTs()) { // lunes
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7; // 0=Mon
  d.setHours(0,0,0,0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}
function startOfMonth(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  d.setDate(1);
  return d.getTime();
}
function startOfYear(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(0,0,0,0);
  d.setMonth(0, 1);
  return d.getTime();
}
function rangeStartTs() {
  const t = nowTs();
  if (state.range === "day") return startOfDay(t);
  if (state.range === "week") return startOfWeek(t);
  if (state.range === "month") return startOfMonth(t);
  if (state.range === "year") return startOfYear(t);
  return 0;
}

function inRangeWatched(it) {
  if (state.range === "total") return true;
  const t0 = rangeStartTs();
  const w = Number(it?.watchedAt) || 0;
  return w >= t0;
}

function isWatched(it) {
  return !it?.watchlist;
}

function applyFilters() {
  const q = normKey(state.q);
  const type = state.type;

  filtered = items.filter(it => {
    if (!it) return false;

    // tipo
    if (type !== "all" && it.type !== type) return false;

    // estado
    if (state.status === "watched" && it.watchlist) return false;
    if (state.status === "watchlist" && !it.watchlist) return false;

    // laura
    if (state.laura === "with" && !it.withLaura) return false;
    if (state.laura === "without" && it.withLaura) return false;

    // rango (solo para vistos)
    if (!it.watchlist && !inRangeWatched(it)) return false;

    // búsqueda
    if (!q) return true;
    const hay = [it.title, it.type, ...(it.genres || []), it.country].filter(Boolean).join(" ");
    return normKey(hay).includes(q);
  });

  filtered.sort(byUpdatedDesc);
}

function qs(id) { return document.getElementById(id); }

// ---- DOM refs (tolerante a ids/attrs distintos) ----
const els = {
  view: null,

  // composer
  titleInput: null,
  typeSelect: null,
  genresInput: null,
  countryInput: null,
  addBtn: null,

  // filters
  search: null,
  filtersHost: null,

  // view buttons
  viewBtns: [],

  // selector donut
  chartSelector: null,

  // sections
  listSection: null,
  chartSection: null,
  mapSection: null,

  // list
  list: null,
  spacer: null,
  itemsHost: null,
  count: null,

  // chart/map
  donutHost: null,
  mapHost: null,
  mapHint: null
};

// Filtros que insertamos si no existen en tu HTML
function ensureInlineFilters() {
  if (!els.filtersHost) return;

  // si ya existe nuestro bloque, no duplicar
  if (els.filtersHost.querySelector(".media-inline-filters")) return;

  const wrap = document.createElement("div");
  wrap.className = "media-inline-filters";
  wrap.innerHTML = `
    <div class="media-inline-row">
      <label class="media-mini">
        <span>Tipo</span>
        <select id="media-filter-type">
          <option value="all">Todo</option>
          <option value="movie">Peli</option>
          <option value="series">Serie</option>
          <option value="anime">Anime</option>
        </select>
      </label>

      <label class="media-mini">
        <span>Estado</span>
        <select id="media-filter-status">
          <option value="all">Todo</option>
          <option value="watched">Visto</option>
          <option value="watchlist">Watchlist</option>
        </select>
      </label>

      <label class="media-mini">
        <span>Laura</span>
        <select id="media-filter-laura">
          <option value="all">Todo</option>
          <option value="with">Con Laura</option>
          <option value="without">Sin Laura</option>
        </select>
      </label>

      <div class="media-range" role="group" aria-label="Rango">
        <button class="media-range-btn" data-range="day" type="button">Día</button>
        <button class="media-range-btn" data-range="week" type="button">Sem</button>
        <button class="media-range-btn" data-range="month" type="button">Mes</button>
        <button class="media-range-btn" data-range="year" type="button">Año</button>
        <button class="media-range-btn is-active" data-range="total" type="button">Total</button>
      </div>
    </div>
  `;
  els.filtersHost.appendChild(wrap);

  // bind
  const $type = qs("media-filter-type");
  const $status = qs("media-filter-status");
  const $laura = qs("media-filter-laura");
  const rangeBtns = Array.from(wrap.querySelectorAll(".media-range-btn"));

  if ($type) $type.addEventListener("change", () => { state.type = $type.value || "all"; refresh(); });
  if ($status) $status.addEventListener("change", () => { state.status = $status.value || "all"; refresh(); });
  if ($laura) $laura.addEventListener("change", () => { state.laura = $laura.value || "all"; refresh(); });

  rangeBtns.forEach(b => b.addEventListener("click", () => {
    state.range = b.dataset.range || "total";
    rangeBtns.forEach(x => x.classList.toggle("is-active", x === b));
    refresh();
  }));
}

function bindDom() {
  els.view = qs("view-media");
  if (!els.view) return false;

  // composer
  els.titleInput = qs("media-title");
  els.typeSelect = qs("media-type");
  els.genresInput = qs("media-genres");
  els.countryInput = qs("media-country");
  els.addBtn = qs("media-add");

  // filters
  els.search = qs("media-search");
  els.filtersHost = els.view.querySelector(".media-filters") || els.view;

  // view buttons: soporta data-media-view o data-view
  els.viewBtns = Array.from(els.view.querySelectorAll(".media-viewbtn[data-media-view], .media-viewbtn[data-view]"));

  // donut selector
  els.chartSelector = qs("media-chart-selector");

  // sections (ids variables según tu HTML)
  els.listSection = qs("media-list-card") || qs("media-list")?.closest?.("section") || qs("media-list-card");
  els.chartSection = qs("media-charts") || qs("media-chart-card");
  els.mapSection = qs("media-map") || qs("media-map-card");

  // list
  els.list = qs("media-list");
  els.spacer = qs("media-list-spacer");
  els.itemsHost = qs("media-list-items");
  els.count = qs("media-count") || qs("media-list-meta");

  // chart/map hosts
  els.donutHost = qs("media-donut");
  els.mapHost = qs("media-world-map");
  els.mapHint = qs("media-map-hint");

  ensureInlineFilters();

  // --- composer ---
  if (els.addBtn) {
    els.addBtn.addEventListener("click", () => {
      const title = norm(els.titleInput?.value);
      const type = norm(els.typeSelect?.value) || "movie";
      const genres = parseCSV(els.genresInput?.value);
      const countryRaw = (els.countryInput?.value || "").trim();
      const cc = normalizeCountryKey(countryRaw);
      const country = String(cc.key || "").trim();
      const countryLabel = String(cc.label || "").trim();

      if (!title) return els.titleInput?.focus();

      addItem({ title, type, genres, country, countryLabel });

      if (els.titleInput) els.titleInput.value = "";
      if (els.genresInput) els.genresInput.value = "";
      els.titleInput?.focus();
    });
  }
  els.titleInput?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); els.addBtn?.click(); }
  });

  // búsqueda
  els.search?.addEventListener("input", () => {
    state.q = els.search.value;
    refresh();
  });

  // views
  els.viewBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const v = btn.dataset.mediaView || btn.dataset.view || "list";
      state.view = v;
      setActiveViewBtns();
      renderViewVisibility();
      refreshChartsMaybe();
      Rz();
      Rv();
      R(`view->${v}`);
    });
  });

  // donut selector
  els.chartSelector?.addEventListener("change", () => {
    state.chart = els.chartSelector.value || "type";
    renderDonut();
  });

  // virtual list scroll
  els.list?.addEventListener("scroll", () => renderVirtual());

  // interactions: botones + rating
  bindRowInteractions();

  // cuando la sección se haga visible, resize & repaint
  const mo = new MutationObserver(() => {
    if (!isActiveView()) return;
    requestAnimationFrame(() => {
      donutChart?.resize?.();
      mapChart?.resize?.();
      renderVirtual();
      refreshChartsMaybe();
    });
  });
  mo.observe(els.view, { attributes: true, attributeFilter: ["class", "style"] });

  return true;
}

function isActiveView() {
  return els.view?.classList?.contains("view-active");
}

function setActiveViewBtns() {
  els.viewBtns.forEach(b => {
    const v = b.dataset.mediaView || b.dataset.view || "list";
    b.classList.toggle("is-active", v === state.view);
  });
}

function renderViewVisibility() {
  if (els.listSection) els.listSection.style.display = (state.view === "list") ? "" : "none";
  if (els.chartSection) els.chartSection.style.display = (state.view === "charts") ? "" : "none";
  if (els.mapSection) els.mapSection.style.display = (state.view === "map") ? "" : "none";
}

function addItem({ title, type, genres, country, countryLabel }) {
  const now = nowTs();
  const t = (type === "series" || type === "anime") ? type : "movie";
  const it = {
    id: uid(),
    title,
    type: t,
    genres: Array.isArray(genres) ? genres : [],
    country: (country || ""),
    countryLabel: (countryLabel || country || ""),
    rating: 0,
    withLaura: false,
    watchlist: false,   // false = visto
    watchedAt: now,
    season: (t === "series" || t === "anime") ? 1 : 0,
    episode: (t === "series" || t === "anime") ? 1 : 0,
    createdAt: now,
    updatedAt: now
  };
  items.unshift(it);
  save();
  pushItemToFirebase(it);
  refresh();
}

function findItem(id) {
  return items.find(it => it?.id === id) || null;
}

function updateItem(id, patch) {
  const it = findItem(id);
  if (!it) return;
  Object.assign(it, patch || {});
  it.updatedAt = nowTs();
  save();
}

function deleteItem(id) {
  const idx = items.findIndex(it => it?.id === id);
  if (idx < 0) return;
  items.splice(idx, 1);
  save();
  deleteItemFromFirebase(id);
  refresh();
}

// --- Virtual list ---
let pool = [];

function ensurePool(n) {
  while (pool.length < n) {
    const row = document.createElement("div");
    row.className = "media-row";
    row.innerHTML = `
      <div class="media-row-main">
        <div class="media-row-title"></div>
        <div class="media-row-sub"></div>
      </div>
      <div class="media-row-tools">
        <div class="media-rating" data-action="rate" tabindex="0" role="slider" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0">☆☆☆☆☆</div>
        <button class="media-icon" data-action="laura" title="Laura">L</button>
        <button class="media-icon" data-action="watch" title="Watchlist">⌛</button>
        <button class="media-icon" data-action="prog" title="Progreso">S</button>
        <button class="media-icon" data-action="edit" title="Editar">✎</button>
        <button class="media-icon danger" data-action="del" title="Borrar">🗑</button>
      </div>
    `;
    els.itemsHost?.appendChild(row);
    pool.push(row);
  }
}

function stars(n) {
  const r = Math.max(0, Math.min(5, Number(n) || 0));
  return "★★★★★☆☆☆☆☆".slice(5 - r, 10 - r); // truco: rellenas + vacías
}

function subline(it) {
  const parts = [];
  const gs = Array.isArray(it?.genres) && it.genres.length ? it.genres.join(" · ") : "";
  if (gs) parts.push(gs);
  if (it?.country) parts.push(it.countryLabel || it.country);

  if ((it.type === "series" || it.type === "anime") && (it.season || it.episode)) {
    const s = Number(it.season) || 0;
    const e = Number(it.episode) || 0;
    if (s || e) parts.push(`S${s || 1}E${e || 1}`);
  }

  if (it.watchlist) parts.push("Watchlist");
  if (it.withLaura) parts.push("Laura");

  return parts.length ? parts.join(" · ") : "—";
}

function renderVirtual() {
  if (!els.list || !els.spacer || !els.itemsHost) return;

  const total = filtered.length;
  if (els.count) {
    const labelRange = (state.status === "watchlist")
      ? "watchlist"
      : (state.range === "total" ? "total" : state.range);
    els.count.textContent = total ? `${total.toLocaleString()} · ${labelRange}` : "—";
  }

  els.spacer.style.height = `${total * ROW_H}px`;

  const scrollTop = els.list.scrollTop || 0;
  const viewH = els.list.clientHeight || 0;
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - 8);
  const end = Math.min(total, Math.ceil((scrollTop + viewH) / ROW_H) + 8);
  const need = Math.max(0, end - start);

  ensurePool(need);

  for (let i = 0; i < pool.length; i++) {
    const row = pool[i];
    const idx = start + i;
    if (idx >= end) { row.style.display = "none"; continue; }

    const it = filtered[idx];
    row.style.display = "flex";
    row.style.transform = `translateY(${idx * ROW_H}px)`;

    row.classList.toggle("type-movie", it.type === "movie");
    row.classList.toggle("type-series", it.type === "series");
    row.classList.toggle("type-anime", it.type === "anime");
    row.classList.toggle("is-watchlist", !!it.watchlist);

    const titleEl = row.querySelector(".media-row-title");
    const subEl = row.querySelector(".media-row-sub");
    const rateEl = row.querySelector(".media-rating");

    if (titleEl) titleEl.textContent = it?.title || "—";
    if (subEl) subEl.textContent = subline(it);

    if (rateEl) {
      const r = Number(it?.rating) || 0;
      rateEl.textContent = stars(r);
      rateEl.dataset.id = it.id;
      rateEl.setAttribute("aria-valuenow", String(r));
    }

    // botones: id + estados visuales
    row.querySelectorAll("button[data-action]").forEach(btn => {
      btn.dataset.id = it.id;
      const a = btn.dataset.action;
      if (a === "laura") btn.classList.toggle("is-on", !!it.withLaura);
      if (a === "watch") btn.classList.toggle("is-on", !!it.watchlist);
      if (a === "prog") btn.style.display = (it.type === "series" || it.type === "anime") ? "" : "none";
    });
  }
}

// --- Row interactions ---
let ratingDrag = { active: false, id: "", pointerId: -1 };

function ratingFromPointer(el, clientX) {
  const r = el.getBoundingClientRect();
  const x = Math.max(0, Math.min(r.width, clientX - r.left));
  const v = Math.round((x / Math.max(1, r.width)) * 5);
  return Math.max(0, Math.min(5, v));
}

function bindRowInteractions() {
  if (!els.itemsHost) return;

  // clicks
  els.itemsHost.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("button[data-action]");
    if (!btn) return;
    const id = btn.dataset.id;
    const action = btn.dataset.action;
    if (!id) return;

    if (action === "del") return deleteItem(id);
    if (action === "laura") {
      const it = findItem(id); if (!it) return;
      updateItem(id, { withLaura: !it.withLaura });
      refreshSoft();
      return;
    }
    if (action === "watch") {
      const it = findItem(id); if (!it) return;
      const next = !it.watchlist;
      updateItem(id, {
        watchlist: next,
        watchedAt: next ? 0 : (Number(it.watchedAt) || nowTs() || 0)
      });
      refresh();
      return;
    }
    if (action === "prog") {
      const it = findItem(id); if (!it) return;
      openProgressModal(it);
      return;
    }
    if (action === "edit") {
      const it = findItem(id); if (!it) return;
      openEditModal(it);
      return;
    }
  });

  // rating drag (pointer)
  els.itemsHost.addEventListener("pointerdown", (e) => {
    const el = e.target?.closest?.(".media-rating[data-action='rate']");
    if (!el) return;
    const id = el.dataset.id;
    if (!id) return;

    ratingDrag = { active: true, id, pointerId: e.pointerId };
    try { el.setPointerCapture(e.pointerId); } catch (_) {}

    const v = ratingFromPointer(el, e.clientX);
    updateItem(id, { rating: v });
    // actualizar texto sin recomputar todo
    el.textContent = stars(v);
    el.setAttribute("aria-valuenow", String(v));
  });

  els.itemsHost.addEventListener("pointermove", (e) => {
    if (!ratingDrag.active || e.pointerId !== ratingDrag.pointerId) return;
    const el = e.target?.closest?.(".media-rating[data-action='rate']");
    if (!el) return;
    const v = ratingFromPointer(el, e.clientX);
    updateItem(ratingDrag.id, { rating: v });
    el.textContent = stars(v);
    el.setAttribute("aria-valuenow", String(v));
  });

  els.itemsHost.addEventListener("pointerup", (e) => {
    if (e.pointerId !== ratingDrag.pointerId) return;
    ratingDrag = { active: false, id: "", pointerId: -1 };
    refreshChartsMaybe(); // por si estás en charts
  });

  // rating keyboard
  els.itemsHost.addEventListener("keydown", (e) => {
    const el = e.target?.closest?.(".media-rating[data-action='rate']");
    if (!el) return;
    const id = el.dataset.id;
    if (!id) return;
    const it = findItem(id);
    if (!it) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      const v = Math.max(0, (Number(it.rating) || 0) - 1);
      updateItem(id, { rating: v });
      el.textContent = stars(v);
      el.setAttribute("aria-valuenow", String(v));
      refreshChartsMaybe();
    }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      const v = Math.min(5, (Number(it.rating) || 0) + 1);
      updateItem(id, { rating: v });
      el.textContent = stars(v);
      el.setAttribute("aria-valuenow", String(v));
      refreshChartsMaybe();
    }
  });
}

// --- Donut ---
function ensureDonut() {
  if (!els.donutHost) return;
  const ech = window.echarts;
  if (!ech) { R("echarts no está cargado"); return; }
  if (!donutChart) donutChart = ech.init(els.donutHost);
}

function computeDonutData() {
  if (state.chart === "type") {
    let m = 0, s = 0, a = 0;
    for (const it of filtered) {
      if (!it) continue;
      if (it.type === "series") s++;
      else if (it.type === "anime") a++;
      else m++;
    }
    return [
      { name: "Peli", value: m },
      { name: "Serie", value: s },
      { name: "Anime", value: a }
    ].filter(x => x.value > 0);
  }

  // genre
  const map = new Map();
  for (const it of filtered) {
    const gs = Array.isArray(it?.genres) ? it.genres : [];
    if (!gs.length) {
      map.set("(sin género)", (map.get("(sin género)") || 0) + 1);
      continue;
    }
    for (const g of gs) {
      const k = norm(g) || "(sin género)";
      map.set(k, (map.get(k) || 0) + 1);
    }
  }
  const arr = Array.from(map.entries()).map(([name, value]) => ({ name, value }));
  arr.sort((a, b) => b.value - a.value);
  return arr.slice(0, 12);
}

function renderDonut() {
  ensureDonut();
  if (!donutChart) return;

  const data = computeDonutData() || [];
  const total = data.reduce((s, d) => s + (Number(d?.value) || 0), 0);

  donutChart.setOption(
    {
      title: [
        {
          text: total.toLocaleString(),
          subtext: "Total",
          left: "center",
          top: "center",
          textStyle: { fontSize: 22, fontWeight: 700, color: "#e8e8ea" },
          subtextStyle: { fontSize: 12, color: "rgba(232,232,234,0.75)" },
        },
      ],
      tooltip: { trigger: "item" },
      series: [
        {
          type: "pie",
          radius: ["58%", "80%"],
          avoidLabelOverlap: true,
          label: {
            show: true,
            formatter: (p) =>
              `${p.name}\n${(Number(p.value) || 0).toLocaleString()} · ${Math.round(
                Number(p.percent) || 0
              )}%`,
            color: "rgba(232,232,234,0.9)",
            fontSize: 11,
          },
          labelLine: { show: true, length: 10, length2: 8 },
          data,
        },
      ],
    },
    true
  );
}

// --- Mapa / origen ---
function ensureMap() {
  if (!els.mapHost) return;
  const ech = window.echarts;
  if (!ech) { R("echarts no está cargado"); return; }
  if (!mapChart) mapChart = ech.init(els.mapHost);
}

function computeCountryCounts() {
  const m = new Map();
  for (const it of filtered) {
    const c = String(it?.country || "").trim();
    if (!c) continue;
    m.set(c, (m.get(c) || 0) + 1);
  }
  const arr = Array.from(m.entries()).map(([name, value]) => ({ name, value }));
  arr.sort((a, b) => b.value - a.value);
  return arr;
}

function renderMap() {
  if (!els.mapHost) return;
  const data = computeCountryCounts();
  const total = filtered.length;

  // Si tu app ya tiene helper global (libros), úsalo
  if (typeof window.renderCountryHeatmap === "function") {
    try {
      window.renderCountryHeatmap(els.mapHost, data, { title: "Origen", subtitle: `${total.toLocaleString()} títulos` });
      if (els.mapHint) els.mapHint.style.display = "none";
      return;
    } catch (_) {}
  }

  // fallback echarts: requiere 'world' registrado
  const ech = window.echarts;
  if (!ech?.getMap?.("world")) {
    if (els.mapHint) {
      els.mapHint.style.display = "block";
      els.mapHint.textContent = "Mapa no disponible: falta registrar 'world'.";
    }
    return;
  }

  ensureMap();
  if (!mapChart) return;
  if (els.mapHint) els.mapHint.style.display = "none";

  mapChart.setOption({
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      formatter: (p) => {
        const v = Number(p?.value) || 0;
        return v ? `${p.name}: ${v.toLocaleString()}` : p.name;
      }
    },
    visualMap: {
      min: 0,
      max: Math.max(1, ...data.map(d => d.value)),
      orient: "horizontal",
      left: "center",
      bottom: 10,
      itemWidth: 14,
      itemHeight: 120,
      text: ["", ""],
      textStyle: { color: "rgba(232,232,234,0.75)" },
      inRange: { color: ["#1a1f29", "#3b3a2a", "#8a6a1b", "#d2a128"] },
      calculable: true
    },
    series: [{
      type: "map",
      map: "world",
      roam: true,
      zoom: 1,
      nameProperty: "name",
      itemStyle: {
        areaColor: "#0f131a",
        borderColor: "rgba(255,255,255,0.10)",
        borderWidth: 0.8
      },
      emphasis: {
        itemStyle: {
          areaColor: "#1f2632",
          borderColor: "rgba(255,255,255,0.22)",
          borderWidth: 1.2
        },
        label: { show: false }
      },
      label: { show: false },
      data
    }]
  }, true);;
}

function refreshChartsMaybe() {
  if (state.view === "charts") renderDonut();
  if (state.view === "map") renderMap();
}

function refreshSoft() {
  // para toggles que no afectan filtros, evitamos recomputar todo lo bestia
  renderVirtual();
  refreshChartsMaybe();
}

function refresh() {
  applyFilters();
  renderVirtual();
  refreshChartsMaybe();
}

function initViewDefaults() {
  setActiveViewBtns();
  renderViewVisibility();
}

// --- Modales (edit + progreso) ---
let modal = null;
function ensureModal() {
  if (modal) return modal;

  modal = document.createElement("div");
  modal.className = "media-modal hidden";
  modal.id = "media-modal";
  modal.innerHTML = `
    <div class="media-modal-backdrop" data-action="close"></div>
    <div class="media-modal-sheet" role="dialog" aria-modal="true">
      <div class="media-modal-head">
        <div class="media-modal-title" id="media-modal-title">Editar</div>
        <button class="media-icon" data-action="close" title="Cerrar">✕</button>
      </div>

      <div class="media-modal-body">
        <label class="media-modal-field">
          <span>Título</span>
          <input id="media-edit-title" />
        </label>

        <div class="media-modal-grid">
          <label class="media-modal-field">
            <span>Tipo</span>
            <select id="media-edit-type">
              <option value="movie">Peli</option>
              <option value="series">Serie</option>
              <option value="anime">Anime</option>
            </select>
          </label>

          <label class="media-modal-field">
            <span>Rating</span>
            <select id="media-edit-rating">
              <option value="0">0</option><option value="1">1</option><option value="2">2</option>
              <option value="3">3</option><option value="4">4</option><option value="5">5</option>
            </select>
          </label>
        </div>

        <label class="media-modal-field">
          <span>Géneros (coma)</span>
          <input id="media-edit-genres" />
        </label>

        <label class="media-modal-field">
          <span>Origen</span>
          <input id="media-edit-country" />
        </label>

        <div class="media-modal-grid">
          <label class="media-check">
            <input type="checkbox" id="media-edit-watchlist" />
            <span>Watchlist</span>
          </label>
          <label class="media-check">
            <input type="checkbox" id="media-edit-laura" />
            <span>Laura</span>
          </label>
        </div>

        <div class="media-modal-grid" id="media-edit-progress-row">
          <label class="media-modal-field">
            <span>Temporada</span>
            <input id="media-edit-season" inputmode="numeric" />
          </label>
          <label class="media-modal-field">
            <span>Capítulo</span>
            <input id="media-edit-episode" inputmode="numeric" />
          </label>
        </div>
      </div>

      <div class="media-modal-foot">
        <button class="btn ghost" data-action="close" type="button">Cancelar</button>
        <button class="btn primary" data-action="save" type="button">Guardar</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  // close
  modal.addEventListener("click", (e) => {
    const a = e.target?.closest?.("[data-action]")?.dataset?.action;
    if (a === "close") hideModal();
  });

  // save
  modal.querySelector("[data-action='save']")?.addEventListener("click", () => {
    const id = modal.dataset.id;
    const it = findItem(id);
    if (!it) return hideModal();

    const title = norm(qs("media-edit-title")?.value);
    const type = qs("media-edit-type")?.value || it.type;
    const rating = Number(qs("media-edit-rating")?.value) || 0;
    const genres = parseCSV(qs("media-edit-genres")?.value);
    const countryRaw = (qs("media-edit-country")?.value || "").trim();
    const cc = normalizeCountryKey(countryRaw);
    const country = String(cc.key || "").trim();
    const countryLabel = String(cc.label || "").trim();
    const watchlist = !!qs("media-edit-watchlist")?.checked;
    const withLaura = !!qs("media-edit-laura")?.checked;

    const patch = { title: title || it.title, type, rating, genres, country, countryLabel: (countryLabel || country || ""), watchlist, withLaura };

    if (type === "series" || type === "anime") {
      const s = Number(qs("media-edit-season")?.value) || 1;
      const e = Number(qs("media-edit-episode")?.value) || 1;
      patch.season = s; patch.episode = e;
    } else {
      patch.season = 0; patch.episode = 0;
    }

    // watchedAt coherente con watchlist
    if (watchlist) patch.watchedAt = 0;
    else patch.watchedAt = Number(it.watchedAt) || nowTs();

    updateItem(id, patch);
    hideModal();
    refresh();
  });

  return modal;
}

function showModalForItem(it, titleText) {
  ensureModal();
  modal.dataset.id = it.id;
  qs("media-modal-title").textContent = titleText || "Editar";

  qs("media-edit-title").value = it.title || "";
  qs("media-edit-type").value = it.type || "movie";
  qs("media-edit-rating").value = String(Number(it.rating) || 0);
  qs("media-edit-genres").value = Array.isArray(it.genres) ? it.genres.join(", ") : "";
  qs("media-edit-country").value = it.country || "";
  qs("media-edit-watchlist").checked = !!it.watchlist;
  qs("media-edit-laura").checked = !!it.withLaura;

  const progRow = qs("media-edit-progress-row");
  const isSE = (it.type === "series" || it.type === "anime");
  if (progRow) progRow.style.display = isSE ? "" : "none";
  if (isSE) {
    qs("media-edit-season").value = String(Number(it.season) || 1);
    qs("media-edit-episode").value = String(Number(it.episode) || 1);
  }

  modal.classList.remove("hidden");
}

function hideModal() {
  if (!modal) return;
  modal.classList.add("hidden");
}

function openEditModal(it) {
  showModalForItem(it, "Editar título");
}

function openProgressModal(it) {
  showModalForItem(it, "Progreso");
}

// --- utils for tiny logs ---
function R(msg) { try { console.debug("[media]", msg); } catch (_) {} }
function Rz() { try { donutChart?.resize?.(); mapChart?.resize?.(); } catch (_) {} }
function Rv() { try { if (state.view === "list") renderVirtual(); } catch (_) {} }

// --- init ---
function init() {
  load();

  if (!bindDom()) return;

  initViewDefaults();

  // primer render
  refresh();

  // log de salud
  R("init ok");
  R("viewBtns", els.viewBtns.length);
  R("sections", { list: !!els.listSection, charts: !!els.chartSection, map: !!els.mapSection });
}

// API pública
window.__bookshellMedia = {
  getItems: () => [...items],
  addItem,
  deleteItem,
  updateItem
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", init);
} else {
  init();
}
const COUNTRY_ES_TO_EN = {
  "españa": "Spain",
  "estados unidos": "United States",
  "eeuu": "United States",
  "reino unido": "United Kingdom",
  "inglaterra": "United Kingdom",
  "corea del sur": "South Korea",
  "corea del norte": "North Korea",
  "japón": "Japan",
  "alemania": "Germany",
  "francia": "France",
  "italia": "Italy",
  "países bajos": "Netherlands",
  "holanda": "Netherlands",
  "méxico": "Mexico",
  "brasil": "Brazil",
  "canadá": "Canada",
  "suiza": "Switzerland",
  "australia": "Australia"
};

function normalizeCountryKey(input) {
  const raw = (input || "").trim();
  const low = norm(raw);
  if (!low) return { key: "", label: "" };

  // si existe tu helper global de países, úsalo
  try {
    if (typeof window.normalizeCountryInput === "function") {
      const normed = window.normalizeCountryInput(raw);
      const en = (typeof window.getCountryEnglishName === "function")
        ? window.getCountryEnglishName(normed)
        : normed;
      return { key: String(en || normed || raw), label: raw };
    }
  } catch (_) {}

  const mapped = COUNTRY_ES_TO_EN[low] || raw;
  return { key: mapped, label: raw };
}


