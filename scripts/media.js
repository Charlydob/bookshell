// Media: Pelis/Series/Anime — ultra ligero
// - Lista virtual (sin tarjetas)
// - Donut por: tipo, género, país, actor, director, año
// - Heatmap por origen
// - Modal: añadir (checkbox) + modal editar (JS)
// - Sync: localStorage + Firebase RTDB (merge anti-pisotón)

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

/* ------------------------- Firebase ------------------------- */
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
const LS_KEY = "bookshell.media.v3";
const ROW_H = 46;

let items = [];
let filtered = [];

let donutChart = null;
let mapChart = null;

/* ------------------------- State ------------------------- */
const state = {
  q: "",
  type: "all",          // all|movie|series|anime
  status: "all",        // all|watched|watchlist
  laura: "all",         // all|with|without
  range: "total",       // day|week|month|year|total  (solo afecta a 'watched')
  chart: "type",        // type|genre|country|actor|director|year
  view: "list"          // list|charts|map
};

function log(...a) { try { console.debug("[media]", ...a); } catch (_) {} }

/* ------------------------- Utils ------------------------- */
function uid() {
  return (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
}
function nowTs() { return Date.now(); }
function norm(s) { return String(s || "").trim(); }
function normKey(s) { return norm(s).toLowerCase(); }
function clamp(n, a, b) { n = Number(n) || 0; return Math.max(a, Math.min(b, n)); }

function parseCSV(s) {
  return norm(s).split(",").map(v => norm(v)).filter(Boolean).slice(0, 40);
}

function startOfDay(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}
function startOfWeek(ts = nowTs()) { // lunes
  const d = new Date(ts);
  const day = (d.getDay() + 6) % 7; // 0=Mon
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - day);
  return d.getTime();
}
function startOfMonth(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  d.setDate(1);
  return d.getTime();
}
function startOfYear(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
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

/* ------------------------- Country index ------------------------- */
let _countryBuilt = false;
const _nameToCode = new Map(); // folded name -> code
const _codeToEn = new Map();   // code -> English
const _codeToEs = new Map();   // code -> Español

function foldKey(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function buildCountryIndex() {
  if (_countryBuilt) return;
  _countryBuilt = true;

  if (!Intl?.DisplayNames) return;

  const dnES = new Intl.DisplayNames(["es"], { type: "region" });
  const dnEN = new Intl.DisplayNames(["en"], { type: "region" });

  let regions = [];
  if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
    try {
      regions = Intl.supportedValuesOf("region") || [];
    } catch (_) {
      regions = [];
    }
  }

  // Fallback (navegadores que implementan supportedValuesOf pero no aceptan "region")
  if (!Array.isArray(regions) || regions.length === 0) {
    regions = [
      "ES","US","GB","FR","DE","IT","PT","NL","BE","CH","AT","IE","DK","SE","NO","FI",
      "PL","CZ","SK","HU","RO","BG","GR","TR","RU","UA","BY","LT","LV","EE","IS",
      "CA","MX","BR","AR","CL","CO","PE","VE","EC","UY","PY","BO","CR","PA","GT","HN","NI","SV","DO","CU","JM","TT",
      "AU","NZ","JP","KR","CN","TW","HK","SG","MY","TH","VN","PH","ID","IN","PK","BD","LK","NP","IL","SA","AE","QA","KW","OM","IR","IQ",
      "EG","MA","DZ","TN","ZA","NG","KE","ET","GH"
    ];
  }
  for (const code of regions) {
    const es = dnES.of(code);
    const en = dnEN.of(code);
    if (!es || !en) continue;

    _codeToEs.set(code, es);
    _codeToEn.set(code, en);

    _nameToCode.set(foldKey(code), code);
    _nameToCode.set(foldKey(es), code);
    _nameToCode.set(foldKey(en), code);
  }

  // alias típicos
  const alias = {
    "usa": "US",
    "eeuu": "US",
    "estados unidos": "US",
    "reino unido": "GB",
    "uk": "GB",
    "inglaterra": "GB",
    "rusia": "RU",
    "corea del sur": "KR",
    "corea": "KR",
    "iran": "IR",
    "siria": "SY",
    "cabo verde": "CV",
    "chequia": "CZ",
    "rep checa": "CZ"
  };
  for (const [k, code] of Object.entries(alias)) _nameToCode.set(foldKey(k), code);
}

function normalizeCountry(raw) {
  buildCountryIndex();
  const v = norm(raw);
  if (!v) return { code: "", en: "", es: "", raw: "" };

  const folded = foldKey(v);

  // ISO-2 directo
  if (/^[A-Za-z]{2}$/.test(v)) {
    const code = v.toUpperCase();
    return { code, en: _codeToEn.get(code) || "", es: _codeToEs.get(code) || "", raw: v };
  }

  const code = _nameToCode.get(folded) || "";
  if (!code) return { code: "", en: v, es: v, raw: v };

  return { code, en: _codeToEn.get(code) || "", es: _codeToEs.get(code) || "", raw: v };
}

function populateCountryDatalist() {
  const dl = document.getElementById("country-options");
  if (!dl) return;

  buildCountryIndex();
  if (dl.dataset.filled === "1") return;
  dl.dataset.filled = "1";

  const codes = Array.from(_codeToEs.keys()).sort((a, b) => (_codeToEs.get(a) || "").localeCompare(_codeToEs.get(b) || "", "es"));
  const frag = document.createDocumentFragment();

  for (const code of codes) {
    const es = _codeToEs.get(code);
    const en = _codeToEn.get(code);
    if (!es || !en) continue;
    const opt = document.createElement("option");
    opt.value = es;
    opt.label = en;
    frag.appendChild(opt);
  }
  dl.appendChild(frag);
}

/* ------------------------- Cache + Firebase merge ------------------------- */
function firebasePath(id = "") {
  return id ? `${MEDIA_PATH}/${id}` : MEDIA_PATH;
}

function loadCache() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    items = (Array.isArray(parsed) ? parsed : []).map(normalizeItem);
  } catch (_) {
    items = [];
  }
}

function saveCache() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(items)); } catch (_) {}
}

function save() {
  saveCache();
  try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
}

const pendingWrites = new Map(); // id -> updatedAt
let firebaseBound = false;

function markPending(id, updatedAt) {
  if (!id) return;
  pendingWrites.set(String(id), Number(updatedAt) || nowTs());
}

function bindFirebaseOnce() {
  if (firebaseBound) return;
  firebaseBound = true;

  try {
    onValue(ref(db, firebasePath()), (snap) => {
      const val = snap.val();

      // remoto vacío => opcional: bootstrap desde cache
      if (!val || typeof val !== "object") {
        if (!window.__mediaBootstrapDone && Array.isArray(items) && items.length) {
          try {
            const obj = {};
            for (const it of items) obj[it.id] = it;
            set(ref(db, firebasePath()), obj);
            window.__mediaBootstrapDone = true;
            log("firebase bootstrap", items.length);
          } catch (e) {
            console.warn("[media] firebase bootstrap failed", e);
          }
        }
        return;
      }

      const remote = Object.entries(val).map(([id, it]) => ({ id, ...(it || {}) }));

      // merge anti-pisotón
      const localById = new Map(items.map(x => [String(x.id), x]));
      const merged = [];

      for (const r of remote) {
        const id = String(r.id);
        const pend = pendingWrites.get(id);
        const local = localById.get(id);

        const rUp = Number(r.updatedAt) || 0;
        const lUp = Number(local?.updatedAt) || 0;

        if (pend && local && rUp < lUp) {
          merged.push(normalizeItem(local));
        } else {
          merged.push(normalizeItem(r));
          if (pend && rUp >= (pendingWrites.get(id) || 0)) pendingWrites.delete(id);
        }
        localById.delete(id);
      }

      for (const [, l] of localById) merged.push(normalizeItem(l));

      merged.sort(byUpdatedDesc);
      items = merged;

      saveCache();
      refresh();
    });
  } catch (e) {
    console.warn("[media] firebase bind failed", e);
  }
}

function pushItemToFirebase(item) {
  try {
    markPending(item?.id, item?.updatedAt);
    set(ref(db, firebasePath(item.id)), item);
  } catch (e) {
    console.warn("[media] firebase set failed", e);
  }
}

function deleteItemFromFirebase(id) {
  try {
    pendingWrites.set(String(id), Number.MAX_SAFE_INTEGER);
    set(ref(db, firebasePath(id)), null);
  } catch (e) {
    console.warn("[media] firebase delete failed", e);
  }
}

/* ------------------------- Model ------------------------- */
function byUpdatedDesc(a, b) {
  return (Number(b?.updatedAt) || 0) - (Number(a?.updatedAt) || 0);
}

function normalizeItem(it) {
  if (!it || typeof it !== "object") return it;

  const out = { ...it };
  out.id = String(out.id || uid());

  out.title = norm(out.title);
  out.type = (out.type === "series" || out.type === "anime") ? out.type : "movie";
  out.genres = Array.isArray(out.genres) ? out.genres.map(norm).filter(Boolean).slice(0, 30) : [];
  out.director = norm(out.director);
  out.cast = Array.isArray(out.cast) ? out.cast.map(norm).filter(Boolean).slice(0, 40) : [];

  out.rating = clamp(out.rating, 0, 5);
  out.withLaura = !!out.withLaura;
  out.watchlist = !!out.watchlist;

  out.year = Number(out.year) || 0;

  // país: guardamos label ES + EN (para mapa)
  const raw = out.countryCode || out.countryEn || out.countryLabel || out.country || "";
  const cc = normalizeCountry(raw);

  out.countryCode = cc.code || "";
  out.countryEn = cc.en || (norm(out.countryEn) || "");
  out.countryLabel = cc.es || (norm(out.countryLabel) || norm(out.country) || "");

  // progreso series/anime
  if (out.type === "series" || out.type === "anime") {
    out.season = Math.max(1, Number(out.season) || 1);
    out.episode = Math.max(1, Number(out.episode) || 1);
  } else {
    out.season = 0;
    out.episode = 0;
  }

  const t = nowTs();
  out.createdAt = Number(out.createdAt) || t;
  out.updatedAt = Number(out.updatedAt) || t;

  // watchedAt solo si visto
  if (!out.watchlist) out.watchedAt = Number(out.watchedAt) || out.updatedAt || t;
  else out.watchedAt = Number(out.watchedAt) || 0;

  return out;
}

/* ------------------------- Filters ------------------------- */
function applyFilters() {
  const q = normKey(state.q);

  filtered = items.filter(it => {
    if (!it || !it.title) return false;

    if (state.type !== "all" && it.type !== state.type) return false;

    if (state.status === "watched" && it.watchlist) return false;
    if (state.status === "watchlist" && !it.watchlist) return false;

    if (state.laura === "with" && !it.withLaura) return false;
    if (state.laura === "without" && it.withLaura) return false;

    // rango: solo vistos
    if (!it.watchlist && !inRangeWatched(it)) return false;

    if (!q) return true;

    const hay = [
      it.title,
      it.type,
      it.year ? String(it.year) : "",
      it.countryLabel,
      it.countryEn,
      it.director,
      ...(it.genres || []),
      ...(it.cast || [])
    ].filter(Boolean).join(" ");

    return normKey(hay).includes(q);
  });

  filtered.sort(byUpdatedDesc);
}

/* ------------------------- DOM ------------------------- */
function qs(id) { return document.getElementById(id); }

const els = {
  view: null,
  viewBtns: [],
  // filters
  search: null,
  typePills: null,
  filtersSlot: null,

  // sections
  listCard: null,
  chartCard: null,
  mapCard: null,

  // list
  list: null,
  spacer: null,
  itemsHost: null,
  count: null,

  // chart/map
  donutHost: null,
  chartSel: null,
  chartSub: null,
  chartEmpty: null,
  legend: null,
  legendMeta: null,
  legendList: null,
  legendMore: null,

  mapHost: null,
  mapHint: null,
  countryList: null,

  // add modal
  addToggle: null,
  addCancel: null,
  addConfirm: null,
  addTitle: null,
  addType: null,
  addRating: null,
  addYear: null,
  addCountry: null,
  addGenres: null,
  addDirector: null,
  addCast: null,
  addWatchlist: null,
  addLaura: null,
  addSeason: null,
  addEpisode: null,
  addSeasonWrap: null
};

function bindDom() {
  els.view = qs("view-media");
  if (!els.view) return false;

  els.viewBtns = Array.from(els.view.querySelectorAll(".media-viewbtn[data-media-view], .media-viewbtn[data-view]"));
  els.search = qs("media-search");
  els.typePills = qs("media-type-pills");
  els.filtersSlot = els.view.querySelector(".media-filters-slot");

  els.listCard = qs("media-list-card");
  els.chartCard = qs("media-chart-card") || qs("media-chart-card") || qs("media-chart-card");
  els.mapCard = qs("media-map-card");

  els.list = qs("media-list");
  els.spacer = qs("media-list-spacer");
  els.itemsHost = qs("media-list-items");
  els.count = qs("media-count");

  els.donutHost = qs("media-donut");
  els.chartSel = qs("media-chart-selector");
  els.chartSub = qs("media-chart-sub");
  els.chartEmpty = qs("media-chart-empty");

  els.legend = qs("media-legend");
  els.legendMeta = qs("media-legend-meta");
  els.legendList = qs("media-donut-legend");
  els.legendMore = qs("media-legend-more");

  els.mapHost = qs("media-world-map");
  els.mapHint = qs("media-map-hint");
  els.countryList = qs("media-country-list");

  els.addToggle = qs("media-add-toggle");
  els.addCancel = qs("media-add-cancel");
  els.addConfirm = qs("media-add-confirm");
  els.addTitle = qs("media-title");
  els.addType = qs("media-type");
  els.addRating = qs("media-rating");
  els.addYear = qs("media-year");
  els.addCountry = qs("media-country");
  els.addGenres = qs("media-genres");
  els.addDirector = qs("media-director");
  els.addCast = qs("media-cast");
  els.addWatchlist = qs("media-watchlist");
  els.addLaura = qs("media-with-laura");
  els.addSeason = qs("media-season");
  els.addEpisode = qs("media-episode");
  els.addSeasonWrap = qs("media-seasonep");

  // country datalist
  populateCountryDatalist();

  // inline filters (si no existen, los inyectamos aquí para no tocar index)
  ensureInlineFilters();

  // bind: search
  els.search?.addEventListener("input", () => {
    state.q = els.search.value || "";
    refresh();
  });

  // bind: type pills
  bindTypePills();

  // bind: views
  els.viewBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      state.view = btn.dataset.mediaView || btn.dataset.view || "list";
      setActiveViewBtns();
      renderViewVisibility();
      refreshChartsMaybe();
      renderVirtual();
    });
  });

  // chart selector
  els.chartSel?.addEventListener("change", () => {
    state.chart = els.chartSel.value || "type";
    renderDonut();
  });

  // legend more
  els.legendMore?.addEventListener("click", () => {
    legendGrow();
    renderDonutLegend();
  });

  // list scroll
  els.list?.addEventListener("scroll", () => renderVirtual());

  // add modal: close
  els.addCancel?.addEventListener("click", () => { if (els.addToggle) els.addToggle.checked = false; });

  // add modal: season/episode visibility
  function syncAddSeasonEp() {
    const t = els.addType?.value || "movie";
    if (!els.addSeasonWrap) return;
    els.addSeasonWrap.style.display = (t === "series" || t === "anime") ? "" : "none";
  }
  els.addType?.addEventListener("change", syncAddSeasonEp);
  syncAddSeasonEp();

  // add modal: save
  els.addConfirm?.addEventListener("click", () => {
    const title = norm(els.addTitle?.value);
    if (!title) return;

    const type = (els.addType?.value || "movie");
    const rating = clamp(els.addRating?.value, 0, 5);
    const year = Number(els.addYear?.value) || 0;

    const genres = parseCSV(els.addGenres?.value);
    const director = norm(els.addDirector?.value);
    const cast = parseCSV(els.addCast?.value);

    const cRaw = norm(els.addCountry?.value);
    const cc = normalizeCountry(cRaw);

    const watchlist = !!els.addWatchlist?.checked;
    const withLaura = !!els.addLaura?.checked;

    const season = Math.max(1, Number(els.addSeason?.value) || 1);
    const episode = Math.max(1, Number(els.addEpisode?.value) || 1);

    addItem({
      title,
      type,
      rating,
      year,
      genres,
      director,
      cast,
      countryCode: cc.code,
      countryEn: cc.en || (cRaw || ""),
      countryLabel: cc.es || (cRaw || ""),
      watchlist,
      withLaura,
      season,
      episode
    });

    // reset (suave)
    if (els.addTitle) els.addTitle.value = "";
    if (els.addGenres) els.addGenres.value = "";
    if (els.addDirector) els.addDirector.value = "";
    if (els.addCast) els.addCast.value = "";
    if (els.addCountry) els.addCountry.value = "";
    if (els.addYear) els.addYear.value = "";
    if (els.addRating) els.addRating.value = "0";
    if (els.addWatchlist) els.addWatchlist.checked = false;
    if (els.addLaura) els.addLaura.checked = false;
    if (els.addSeason) els.addSeason.value = "1";
    if (els.addEpisode) els.addEpisode.value = "1";

    if (els.addToggle) els.addToggle.checked = false;
  });

  // enter to save (en título)
  els.addTitle?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); els.addConfirm?.click(); }
  });

  // row interactions
  bindRowInteractions();

  // resize/repaint cuando la vista se active
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
  if (els.listCard) els.listCard.style.display = (state.view === "list") ? "" : "none";
  if (els.chartCard) els.chartCard.style.display = (state.view === "charts") ? "" : "none";
  if (els.mapCard) els.mapCard.style.display = (state.view === "map") ? "" : "none";
}

function ensureInlineFilters() {
  // Slot dentro de esta pestaña (no tocar el resto del index)
  const host = els.filtersSlot || els.view;
  if (!host) return;

  if (host.querySelector(".media-inline-filters")) return;

  const wrap = document.createElement("div");
  wrap.className = "media-inline-filters";
  wrap.innerHTML = `
    <details class="filters-fold media-inline-filters">
      <summary>
        <span>Filtros</span>
        <span class="chev">▾</span>
      </summary>
      <div class="filters-body">
        <div class="media-inline-row">
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
      </div>
    </details>
  `;
  host.appendChild(wrap);

  const $status = qs("media-filter-status");
  const $laura = qs("media-filter-laura");
  const rangeBtns = Array.from(wrap.querySelectorAll(".media-range-btn"));

  if ($status) $status.addEventListener("change", () => { state.status = $status.value || "all"; refresh(); });
  if ($laura) $laura.addEventListener("change", () => { state.laura = $laura.value || "all"; refresh(); });

  rangeBtns.forEach(b => b.addEventListener("click", () => {
    state.range = b.dataset.range || "total";
    rangeBtns.forEach(x => x.classList.toggle("is-active", x === b));
    refresh();
  }));
}

function bindTypePills() {
  const host = els.typePills;
  if (!host) return;
  const btns = Array.from(host.querySelectorAll(".media-pill[data-type]"));
  if (!btns.length) return;

  function setActive() {
    btns.forEach(b => b.classList.toggle("is-active", (b.dataset.type || "all") === state.type));
  }
  setActive();

  btns.forEach(b => b.addEventListener("click", () => {
    state.type = b.dataset.type || "all";
    setActive();
    refresh();
  }));
}

/* ------------------------- CRUD ------------------------- */
function addItem(patch) {
  const now = nowTs();
  const type = (patch.type === "series" || patch.type === "anime") ? patch.type : "movie";

  const it = normalizeItem({
    id: uid(),
    title: patch.title,
    type,
    rating: clamp(patch.rating, 0, 5),
    year: Number(patch.year) || 0,
    genres: Array.isArray(patch.genres) ? patch.genres : [],
    director: patch.director || "",
    cast: Array.isArray(patch.cast) ? patch.cast : [],
    countryCode: patch.countryCode || "",
    countryEn: patch.countryEn || "",
    countryLabel: patch.countryLabel || "",
    watchlist: !!patch.watchlist,
    withLaura: !!patch.withLaura,
    season: (type === "series" || type === "anime") ? (Number(patch.season) || 1) : 0,
    episode: (type === "series" || type === "anime") ? (Number(patch.episode) || 1) : 0,
    watchedAt: (!!patch.watchlist ? 0 : now),
    createdAt: now,
    updatedAt: now
  });

  items.unshift(it);
  save();
  pushItemToFirebase(it);
  refresh();
}

function findItem(id) {
  return items.find(x => String(x?.id) === String(id)) || null;
}

function updateItem(id, patch) {
  const it = findItem(id);
  if (!it) return;

  Object.assign(it, patch || {});
  it.updatedAt = nowTs();
  const fixed = normalizeItem(it);
  Object.assign(it, fixed);

  save();
  markPending(it.id, it.updatedAt);
  pushItemToFirebase(it);
  refresh();
}

function deleteItem(id) {
  const idx = items.findIndex(x => String(x?.id) === String(id));
  if (idx < 0) return;
  items.splice(idx, 1);
  save();
  deleteItemFromFirebase(id);
  refresh();
}

/* ------------------------- Virtual list ------------------------- */
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
        <div class="media-rating" data-action="rate" tabindex="0" role="slider"
             aria-valuemin="0" aria-valuemax="5" aria-valuenow="0">☆☆☆☆☆</div>
        <button class="media-icon" data-action="laura" title="Laura">L</button>
        <button class="media-icon" data-action="edit" title="Editar">✎</button>
      </div>
    `;
    els.itemsHost?.appendChild(row);
    pool.push(row);
  }
}

function stars(n) {
  const r = clamp(n, 0, 5);
  return "★★★★★☆☆☆☆☆".slice(5 - r, 10 - r);
}

function subline(it) {
  const parts = [];

  if (it.year) parts.push(String(it.year));

  const gs = Array.isArray(it.genres) && it.genres.length ? it.genres.join(" · ") : "";
  if (gs) parts.push(gs);

  if (it.countryLabel) parts.push(it.countryLabel);

  if ((it.type === "series" || it.type === "anime") && (it.season || it.episode)) {
    const s = Number(it.season) || 1;
    const e = Number(it.episode) || 1;
    parts.push(`S${s}E${e}`);
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

  ensurePool(Math.min(need, 120)); // tope de nodos visibles

  const baseTop = start * ROW_H;
  for (let i = 0; i < pool.length; i++) {
    const row = pool[i];
    const idx = start + i;
    if (idx >= end) { row.style.display = "none"; continue; }

    const it = filtered[idx];
    row.style.display = "";
    row.style.transform = `translateY(${(idx * ROW_H)}px)`;
    row.dataset.id = it.id;

    row.classList.toggle("type-movie", it.type === "movie");
    row.classList.toggle("type-series", it.type === "series");
    row.classList.toggle("type-anime", it.type === "anime");
    row.classList.toggle("is-watchlist", !!it.watchlist);

    row.querySelector(".media-row-title").textContent = it.title || "—";
    row.querySelector(".media-row-sub").textContent = subline(it);

    const rEl = row.querySelector(".media-rating");
    rEl.textContent = stars(it.rating);
    rEl.setAttribute("aria-valuenow", String(it.rating || 0));

    const lBtn = row.querySelector("[data-action='laura']");
    lBtn.classList.toggle("is-on", !!it.withLaura);
  }
}

/* ------------------------- Row interactions ------------------------- */
function bindRowInteractions() {
  if (!els.itemsHost) return;

  els.itemsHost.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-action]");
    if (!btn) return;

    const row = e.target?.closest?.(".media-row");
    const id = row?.dataset?.id;
    if (!id) return;

    const act = btn.dataset.action;

    if (act === "laura") {
      const it = findItem(id);
      if (!it) return;
      updateItem(id, { withLaura: !it.withLaura });
      return;
    }

    if (act === "edit") {
      openEditModal(id);
      return;
    }

    if (act === "rate") {
      // handled by pointer logic
      return;
    }
  });

  // rating pointer
  els.itemsHost.addEventListener("pointerdown", (e) => {
    const rEl = e.target?.closest?.(".media-rating[data-action='rate']");
    if (!rEl) return;

    const row = rEl.closest(".media-row");
    const id = row?.dataset?.id;
    if (!id) return;

    rEl.setPointerCapture?.(e.pointerId);

    const setFromX = (clientX) => {
      const rect = rEl.getBoundingClientRect();
      const x = clamp((clientX - rect.left) / Math.max(1, rect.width), 0, 1);
      const val = clamp(Math.round(x * 5), 0, 5);
      updateItem(id, { rating: val });
    };

    setFromX(e.clientX);

    const onMove = (ev) => setFromX(ev.clientX);
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  }, { passive: true });

  // rating keyboard
  els.itemsHost.addEventListener("keydown", (e) => {
    const rEl = e.target?.closest?.(".media-rating[data-action='rate']");
    if (!rEl) return;

    const row = rEl.closest(".media-row");
    const id = row?.dataset?.id;
    if (!id) return;

    const it = findItem(id);
    if (!it) return;

    if (e.key === "ArrowLeft" || e.key === "ArrowDown") {
      e.preventDefault();
      updateItem(id, { rating: clamp((it.rating || 0) - 1, 0, 5) });
    }
    if (e.key === "ArrowRight" || e.key === "ArrowUp") {
      e.preventDefault();
      updateItem(id, { rating: clamp((it.rating || 0) + 1, 0, 5) });
    }
    if (e.key === "Home") { e.preventDefault(); updateItem(id, { rating: 0 }); }
    if (e.key === "End") { e.preventDefault(); updateItem(id, { rating: 5 }); }
  });
}

/* ------------------------- Donut ------------------------- */
let _legendKind = "";
let _legendLimit = 40;
const LEGEND_STEP = 40;

function legendResetIfNeeded(kind){
  if (kind !== _legendKind) {
    _legendKind = kind;
    _legendLimit = 40;
  }
}
function legendGrow(){ _legendLimit = Math.min(2000, _legendLimit + LEGEND_STEP); }

function hashStr(s){
  s = String(s || "");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function colorForLabel(label){
  const h = hashStr(label) % 360;
  return `hsl(${h} 78% 62%)`;
}
function escHtml(s){
  return String(s ?? "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#039;");
}
function fmtPct(p){
  if (!isFinite(p) || p <= 0) return "0%";
  const v = p * 100;
  if (v >= 10) return `${Math.round(v)}%`;
  if (v >= 1) return `${v.toFixed(1)}%`;
  return `${v.toFixed(2)}%`;
}

let _legendRows = [];
let _legendSum = 0;

function renderDonutLegend(){
  if (!els.legendList || !els.legendMeta) return;

  const rows = _legendRows || [];
  const sum = _legendSum || 0;

  els.legendMeta.textContent = String(rows.length || 0);

  if (!rows.length || !sum){
    els.legendList.innerHTML = `<div style="opacity:.65;font-size:12px;padding:10px 12px">Nada que desglosar todavía.</div>`;
    if (els.legendMore) els.legendMore.style.display = "none";
    return;
  }

  const limit = Math.min(rows.length, _legendLimit);
  const slice = rows.slice(0, limit);

  els.legendList.innerHTML = slice.map(r => {
    const name = escHtml(r.label);
    const val = Number(r.value) || 0;
    const pct = fmtPct(val / sum);
    const color = colorForLabel(r.label);
    return `
      <div class="media-legend-row">
        <div class="media-legend-left">
          <span class="media-legend-dot" style="background:${color}"></span>
          <div class="media-legend-name" title="${name}">${name}</div>
        </div>
        <div class="media-legend-right">
          <div class="media-legend-pct">${pct}</div>
          <div class="media-legend-val">${val}</div>
        </div>
      </div>
    `;
  }).join("");

  if (els.legendMore) els.legendMore.style.display = (limit < rows.length) ? "" : "none";
}


function computeCounts(kind) {
  const m = new Map();

  const inc = (k, w = 1) => {
    const key = norm(k);
    if (!key) return;
    m.set(key, (m.get(key) || 0) + w);
  };

  for (const it of filtered) {
    if (!it) continue;

    if (kind === "type") {
      inc(it.type);
      continue;
    }

    if (kind === "genre") {
      for (const g of (it.genres || [])) inc(g);
      continue;
    }

    if (kind === "actor") {
      for (const a of (it.cast || [])) inc(a);
      continue;
    }

    if (kind === "director") {
      inc(it.director);
      continue;
    }

    if (kind === "year") {
      if (it.year) inc(String(it.year));
      continue;
    }

    if (kind === "country") {
      inc(it.countryLabel || it.countryEn || "");
      continue;
    }
  }

  const rows = Array.from(m.entries())
    .map(([label, value]) => ({ label, value }))
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));

  return rows;
}

function renderDonut() {
  if (!els.donutHost) return;

  const kind = state.chart || "type";
  const rows = computeCounts(kind);
  legendResetIfNeeded(kind);

  if (els.chartEmpty) els.chartEmpty.style.display = rows.length ? "none" : "";
  if (els.chartSub) els.chartSub.textContent = rows.length ? "Top 16 (sin “otros”)." : "—";

  if (!rows.length) {
    try { donutChart?.dispose?.(); } catch (_) {}
    donutChart = null;
    els.donutHost.innerHTML = "";
    _legendRows = [];
    _legendSum = 0;
    renderDonutLegend();
    return;
  }

  const top = rows.slice(0, 16);
  const total = filtered.length || 0;
  const sumAll = rows.reduce((acc, r) => acc + (Number(r.value) || 0), 0) || 0;

  _legendRows = rows;
  _legendSum = sumAll;
  renderDonutLegend();

  if (!donutChart) donutChart = echarts.init(els.donutHost);

  donutChart.setOption({
    tooltip: { trigger: "item" },
    series: [{
      type: "pie",
      radius: ["62%", "80%"],
      avoidLabelOverlap: true,
      minAngle: 3,
      itemStyle: { borderRadius: 8, borderWidth: 2, borderColor: "rgba(0,0,0,.25)" },
      label: {
        show: true,
        color: "rgba(255,255,255,.85)",
        fontSize: 11,
        lineHeight: 14,
        formatter: (p) => {
          const v = Number(p?.value) || 0;
          const pct = sumAll ? fmtPct(v / sumAll) : "0%";
          return `${p.name}\n${v} - ${pct}`;
        }
      },
      labelLine: { show: true, length: 10, length2: 10, smooth: 0.2 },
      data: top.map(r => ({
        name: r.label,
        value: r.value,
        itemStyle: { color: colorForLabel(r.label) }
      }))
    }],
    graphic: [{
      type: "text",
      left: "center",
      top: "center",
      style: {
        text: `${total}\nTotal`,
        textAlign: "center",
        fill: "rgba(255,255,255,.85)",
        fontSize: 14,
        fontWeight: 700,
        lineHeight: 18
      }
    }]
  }, { notMerge: true });

  donutChart.resize();
}

/* ------------------------- Map (origen) ------------------------- */
function computeCountryCounts() {
  const map = new Map(); // key (en) -> {en, es, value}

  for (const it of filtered) {
    const cc = it.countryCode || "";
    const en = norm(it.countryEn) || (cc ? (_codeToEn.get(cc) || "") : "") || "";
    const es = norm(it.countryLabel) || (cc ? (_codeToEs.get(cc) || "") : "") || "";

    const key = en || es;
    if (!key) continue;

    const cur = map.get(key) || { en: en || key, es: es || key, value: 0 };
    cur.value += 1;
    map.set(key, cur);
  }

  const rows = Array.from(map.values())
    .sort((a, b) => b.value - a.value || a.es.localeCompare(b.es, "es"));

  return rows;
}

function renderCountryPanelList(rows) {
  if (!els.countryList) return;

  const list = (Array.isArray(rows) ? rows : []).filter(r => (Number(r?.value) || 0) > 0);

  if (!list.length) {
    els.countryList.innerHTML = `<div style="opacity:.65;font-size:12px;padding:10px 12px">Aún no hay títulos con país.</div>`;
    return;
  }

  els.countryList.innerHTML = list.map(r => {
    const name = String(r.es || r.en || "").replace(/</g, "&lt;");
    const v = Number(r.value) || 0;
    return `<div class="geo-item"><div class="geo-name">${name}</div><div class="geo-count">${v}</div></div>`;
  }).join("");
}

function renderMap() {
  if (!els.mapHost) return;

  const rows = computeCountryCounts();
  renderCountryPanelList(rows);

  const total = filtered.length || 0;

  if (!rows.length) {
    if (els.mapHint) {
      els.mapHint.style.display = "";
      els.mapHint.textContent = "Añade país de origen en un título y lo verás aquí.";
    }
  } else if (els.mapHint) {
    els.mapHint.style.display = "none";
  }

  const entries = rows.map(r => ({
    name: r.en || r.es,   // EN para pintar en el mapa (world geojson suele venir en EN)
    value: r.value,
    label: r.es || r.en
  }));

  // Si existe helper global (tu app ya lo usa en libros/recetas), úsalo
  if (typeof window.renderCountryHeatmap === "function") {
    try {
      window.renderCountryHeatmap(els.mapHost, entries, {
        emptyLabel: "Aún no hay títulos con país",
        showCallouts: false
      });
      const chart = els.mapHost.__geoChart;
      if (chart?.setOption) chart.setOption({ title: { show: false } });
      return;
    } catch (e) {
      log("renderCountryHeatmap failed, fallback", e);
    }
  }

  // Fallback ECharts: requiere 'world' ya registrado por tu app
  try {
    if (!mapChart) mapChart = echarts.init(els.mapHost);

    const max = Math.max(1, ...entries.map(e => Number(e.value) || 0));

    mapChart.setOption({
      tooltip: { trigger: "item", formatter: (p) => `${p.name || ""}: ${p.value || 0}` },
      visualMap: {
        min: 0,
        max,
        calculable: false,
        show: false,
        inRange: { color: ["rgba(238, 255, 0, 0.22)", "rgba(255, 238, 0, 0.88)"] }
      },
      series: [{
        type: "map",
        map: "world",
        roam: false,
        nameProperty: "name",
        emphasis: { label: { show: false } },
        select: { disabled: true },
        itemStyle: {
    areaColor: "rgba(255,255,255,.06)",   // países sin dato
    borderColor: "rgba(255,255,255,.12)"
  },
        data: entries.map(e => ({ name: e.name, value: e.value }))
      }]
    }, { notMerge: true });

    mapChart.resize();
  } catch (e) {
    if (els.mapHint) {
      els.mapHint.style.display = "";
      els.mapHint.textContent = "No encuentro el mapa 'world' (geoJSON). Revisa que tu world.js lo registre.";
    }
  }
}

/* ------------------------- Edit modal ------------------------- */
let editModal = null;

function ensureEditModal() {
  if (editModal) return editModal;

  editModal = document.createElement("div");
  editModal.className = "media-modal hidden";
  editModal.innerHTML = `
    <div class="media-modal-backdrop" data-action="close"></div>

    <div class="media-modal-sheet" role="dialog" aria-modal="true" aria-label="Editar título">
      <div class="media-modal-head">
        <div class="media-modal-headtext">
          <div class="media-modal-title">Editar título</div>
          <div class="media-modal-sub">Edita los detalles y guarda.</div>
        </div>
        <button class="media-modal-close" data-action="close" type="button" title="Cerrar" aria-label="Cerrar">✕</button>
      </div>

      <div class="media-modal-body">
        <label class="media-modal-field">
          <span>Título</span>
          <input id="media-edit-title" class="media-input" autocomplete="off" />
        </label>

        <div class="media-modal-grid">
          <label class="media-modal-field">
            <span>Tipo</span>
            <select id="media-edit-type" class="media-input">
              <option value="movie">Peli</option>
              <option value="series">Serie</option>
              <option value="anime">Anime</option>
            </select>
          </label>

          <div class="media-modal-field">
            <span>Rating</span>
            <input id="media-edit-rating" type="hidden" value="0" />
            <div class="media-stars" id="media-edit-stars" tabindex="0" role="slider"
                 aria-label="Rating" aria-valuemin="0" aria-valuemax="5" aria-valuenow="0">
              <button class="media-star" type="button" data-rate="1" aria-label="1 estrella">★</button>
              <button class="media-star" type="button" data-rate="2" aria-label="2 estrellas">★</button>
              <button class="media-star" type="button" data-rate="3" aria-label="3 estrellas">★</button>
              <button class="media-star" type="button" data-rate="4" aria-label="4 estrellas">★</button>
              <button class="media-star" type="button" data-rate="5" aria-label="5 estrellas">★</button>
              <div class="media-stars-meta" id="media-edit-rating-label">0/5</div>
            </div>
          </div>
        </div>

        <div class="media-modal-grid">
          <label class="media-modal-field">
            <span>Año</span>
            <input id="media-edit-year" class="media-input" type="number" inputmode="numeric" placeholder="Ej: 2017" />
          </label>

          <label class="media-modal-field">
            <span>Origen</span>
            <input id="media-edit-country" class="media-input" list="country-options" placeholder="País" autocomplete="off" />
          </label>
        </div>

        <label class="media-modal-field">
          <span>Géneros (coma)</span>
          <input id="media-edit-genres" class="media-input" placeholder="Acción, Drama…" autocomplete="off" />
        </label>

        <label class="media-modal-field">
          <span>Director</span>
          <input id="media-edit-director" class="media-input" placeholder="Nombre" autocomplete="off" />
        </label>

        <label class="media-modal-field">
          <span>Reparto (coma)</span>
          <input id="media-edit-cast" class="media-input" placeholder="Actores…" autocomplete="off" />
        </label>

        <div class="media-modal-toggles">
          <label class="media-toggle">
            <input id="media-edit-watchlist" type="checkbox" />
            <span>Watchlist</span>
          </label>
          <label class="media-toggle">
            <input id="media-edit-laura" type="checkbox" />
            <span>Laura</span>
          </label>
        </div>

        <div class="media-modal-grid" id="media-edit-seasonep">
          <label class="media-modal-field">
            <span>Temporada</span>
            <input id="media-edit-season" class="media-input" type="number" inputmode="numeric" />
          </label>
          <label class="media-modal-field">
            <span>Capítulo</span>
            <input id="media-edit-episode" class="media-input" type="number" inputmode="numeric" />
          </label>
        </div>
      </div>

      <div class="media-modal-foot">
        <button class="btn danger" data-action="delete" type="button">Borrar</button>
        <div style="flex:1"></div>
        <button class="btn ghost" data-action="close" type="button">Cancelar</button>
        <button class="btn primary" data-action="save" type="button">Guardar</button>
      </div>
    </div>
  `;

  document.body.appendChild(editModal);

  // close
  editModal.addEventListener("click", (e) => {
    const act = e.target?.dataset?.action;
    if (act === "close") hideEditModal();
  });

  // esc
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && editModal && !editModal.classList.contains("hidden")) hideEditModal();
  });

  // type -> season/ep
  editModal.querySelector("#media-edit-type")?.addEventListener("change", () => syncEditSeasonEp());

  // rating stars
  const stars = editModal.querySelector("#media-edit-stars");
  stars?.addEventListener("click", (e) => {
    const b = e.target?.closest?.("[data-rate]");
    if (!b) return;
    e.preventDefault();
    setEditRating(Number(b.dataset.rate || 0));
  });
  stars?.addEventListener("keydown", (e) => {
    const cur = clamp(Number(qs("media-edit-rating")?.value || 0), 0, 5);
    if (e.key === "ArrowLeft") { e.preventDefault(); setEditRating(cur - 1); }
    if (e.key === "ArrowRight") { e.preventDefault(); setEditRating(cur + 1); }
    if (e.key === "Home") { e.preventDefault(); setEditRating(0); }
    if (e.key === "End") { e.preventDefault(); setEditRating(5); }
  });

  // delete
  editModal.querySelector("[data-action='delete']")?.addEventListener("click", () => {
    const id = editModal.dataset.id;
    if (!id) return;
    deleteItem(id);
    hideEditModal();
  });

  // save
  editModal.querySelector("[data-action='save']")?.addEventListener("click", () => {
    const id = editModal.dataset.id;
    const it = findItem(id);
    if (!it) return hideEditModal();

    const title = norm(qs("media-edit-title")?.value);
    if (!title) return;

    const type = qs("media-edit-type")?.value || "movie";
    const rating = clamp(Number(qs("media-edit-rating")?.value || 0), 0, 5);
    const year = Number(qs("media-edit-year")?.value) || 0;

    const genres = parseCSV(qs("media-edit-genres")?.value);
    const director = norm(qs("media-edit-director")?.value);
    const cast = parseCSV(qs("media-edit-cast")?.value);

    const cRaw = norm(qs("media-edit-country")?.value);
    const cc = normalizeCountry(cRaw);

    const watchlist = !!qs("media-edit-watchlist")?.checked;
    const withLaura = !!qs("media-edit-laura")?.checked;

    const season = Math.max(1, Number(qs("media-edit-season")?.value) || 1);
    const episode = Math.max(1, Number(qs("media-edit-episode")?.value) || 1);

    updateItem(id, {
      title,
      type,
      rating,
      year,
      genres,
      director,
      cast,
      countryCode: cc.code,
      countryEn: cc.en || cRaw,
      countryLabel: cc.es || cRaw,
      watchlist,
      withLaura,
      season,
      episode,
      watchedAt: (watchlist ? 0 : (it.watchedAt || nowTs()))
    });

    hideEditModal();
  });

  // init rating
  setEditRating(0);

  return editModal;
}

function setEditRating(n) {
  n = clamp(Number(n || 0), 0, 5);
  const h = qs("media-edit-rating");
  if (h) h.value = String(n);

  const stars = editModal?.querySelectorAll?.(".media-star") || [];
  stars.forEach((el) => {
    const v = Number(el.dataset.rate || 0);
    el.classList.toggle("is-on", v <= n);
  });

  const lab = qs("media-edit-rating-label");
  if (lab) lab.textContent = `${n}/5`;

  const wrap = qs("media-edit-stars");
  if (wrap) wrap.setAttribute("aria-valuenow", String(n));
}

function syncEditSeasonEp() {
  const t = qs("media-edit-type")?.value || "movie";
  const wrap = qs("media-edit-seasonep");
  if (!wrap) return;
  wrap.style.display = (t === "series" || t === "anime") ? "" : "none";
}

function openEditModal(id) {
  const it = findItem(id);
  if (!it) return;

  const m = ensureEditModal();
  m.dataset.id = String(id);

  qs("media-edit-title").value = it.title || "";
  qs("media-edit-type").value = it.type || "movie";
  setEditRating(it.rating || 0);

  qs("media-edit-year").value = it.year ? String(it.year) : "";
  qs("media-edit-country").value = it.countryLabel || "";

  qs("media-edit-genres").value = (it.genres || []).join(", ");
  qs("media-edit-director").value = it.director || "";
  qs("media-edit-cast").value = (it.cast || []).join(", ");

  qs("media-edit-watchlist").checked = !!it.watchlist;
  qs("media-edit-laura").checked = !!it.withLaura;

  qs("media-edit-season").value = String(it.season || 1);
  qs("media-edit-episode").value = String(it.episode || 1);

  syncEditSeasonEp();

  m.classList.remove("hidden");
}

function hideEditModal() {
  if (!editModal) return;
  editModal.classList.add("hidden");
  editModal.dataset.id = "";
}
/* ------------------------- Refresh ------------------------- */
function refreshChartsMaybe() {
  if (state.view === "charts") renderDonut();
  if (state.view === "map") renderMap();
}

function refresh() {
  applyFilters();
  renderVirtual();
  refreshChartsMaybe();
}

/* ------------------------- Init ------------------------- */
function initViewDefaults() {
  setActiveViewBtns();
  renderViewVisibility();
}

function init() {
  if (!bindDom()) return;

  loadCache();
  items = (Array.isArray(items) ? items : []).map(normalizeItem).sort(byUpdatedDesc);

  bindFirebaseOnce();

  initViewDefaults();
  refresh();

  log("init ok", items.length);
}

init();
