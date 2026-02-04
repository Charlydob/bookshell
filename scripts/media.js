// Media: Pelis/Series/Anime — ultra ligero
// - Lista virtual (sin tarjetas)
// - Donut por: tipo, género, país, actor, director, año
// - Heatmap por origen
// - Modal: añadir (checkbox) + modal editar (JS)
// - Sync: localStorage + Firebase RTDB (merge anti-pisotón)

import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { TMDB_API_KEY, TMDB_READ_TOKEN } from "../config/tmdb.js";

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
const TMDB_CACHE_KEY = "bookshell.media.tmdb.v1";
const PERSON_CACHE_KEY = "bookshell.media.person.v1";
const PERSON_CREDITS_CACHE_KEY = "bookshell.media.personCredits.v1";
const COUNTRY_DISCOVER_CACHE_KEY = "bookshell.media.countryDiscover.v1";
const ROW_H = 46;
const PERSON_CACHE_TTL = 1000 * 60 * 60 * 24 * 7;

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
  view: "list",         // list|charts|map
  actorGender: "all",   // all|male|female (solo en actor)
  breakdownQuery: "",
  rewatchOnly: false,
  rewatchMin: 0,
  watchedFrom: "",
  watchedTo: "",
  meta: "all"           // all|complete|incomplete|missing-director|missing-cast
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
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

function parseCSV(s) {
  return norm(s).split(",").map(v => norm(v)).filter(Boolean).slice(0, 40);
}

function normalizeGender(v) {
  const g = Number(v);
  return (g === 1 || g === 2) ? g : 0;
}

function normalizeCastEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "string") {
    const name = norm(entry);
    if (!name) return null;
    return { name, gender: 0, tmdbId: 0 };
  }
  if (typeof entry === "object") {
    const name = norm(entry.name || entry.label || entry.title);
    if (!name) return null;
    return {
      name,
      gender: normalizeGender(entry.gender),
      tmdbId: Number(entry.tmdbId || entry.id) || 0
    };
  }
  return null;
}

function normalizeCastList(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of raw) {
    const normalized = normalizeCastEntry(entry);
    if (!normalized?.name) continue;
    const key = normKey(normalized.name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
    if (out.length >= 40) break;
  }
  return out;
}

function castNames(list) {
  if (!Array.isArray(list)) return [];
  return list.map(entry => (typeof entry === "string" ? norm(entry) : norm(entry?.name)))
    .filter(Boolean);
}

function castHasEntries(list) {
  return castNames(list).length > 0;
}

function mergeCastMeta(names, metaCast) {
  const meta = Array.isArray(metaCast) ? metaCast : [];
  const metaByName = new Map(meta.map(m => [normKey(m?.name || ""), m]));
  const out = [];
  for (const name of names) {
    const key = normKey(name);
    if (!key) continue;
    const match = metaByName.get(key);
    out.push(normalizeCastEntry({
      name,
      gender: match?.gender,
      tmdbId: match?.tmdbId || match?.id
    }));
  }
  return out.filter(Boolean);
}

function mergeDirectorMeta(name, directorData) {
  const n = norm(name);
  if (!n) return null;
  if (directorData && normKey(directorData.name) === normKey(n)) {
    return {
      name: n,
      gender: normalizeGender(directorData.gender),
      tmdbId: Number(directorData.tmdbId || directorData.id) || 0
    };
  }
  return null;
}

function normalizeSeasons(raw) {
  if (!Array.isArray(raw)) return [];
  const mapped = raw.map(s => ({
    seasonNumber: Number(s?.seasonNumber ?? s?.season) || 0,
    episodeCount: Number(s?.episodeCount ?? s?.episodes) || 0
  })).filter(s => s.seasonNumber > 0 && s.episodeCount > 0);
  mapped.sort((a, b) => a.seasonNumber - b.seasonNumber);
  return mapped;
}

function clampSeasonEpisode(seasons, season, episode) {
  const s = Math.max(1, Number(season) || 1);
  const e = Math.max(1, Number(episode) || 1);
  const list = normalizeSeasons(seasons);
  if (!list.length) return { season: s, episode: e };

  const first = list[0];
  const last = list[list.length - 1];
  let target = list.find(x => x.seasonNumber === s);
  if (!target) {
    if (s <= first.seasonNumber) target = first;
    else if (s >= last.seasonNumber) target = last;
  }
  const nextSeason = target?.seasonNumber || first.seasonNumber;
  const maxEp = target?.episodeCount || 1;
  return { season: nextSeason, episode: clamp(e, 1, maxEp) };
}

function getProgress(it) {
  const season = Number(it?.currentSeason ?? it?.season) || 1;
  const episode = Number(it?.currentEpisode ?? it?.episode) || 1;
  return clampSeasonEpisode(it?.seasons, season, episode);
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
function endOfDay(ts = nowTs()) {
  const d = new Date(ts);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}
function isoDay(ts = nowTs()) {
  return new Date(startOfDay(ts)).toISOString().slice(0, 10);
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

/* ------------------------- TMDb ------------------------- */
const TMDB_BASE = "https://api.themoviedb.org/3";
let tmdbCache = loadTmdbCache();
let personCache = loadPersonCache();
let personCreditsCache = loadPersonCreditsCache();
let countryDiscoverCache = loadCountryDiscoverCache();
const personCreditsPending = new Map();
const personGenderPending = new Map();

function loadTmdbCache() {
  try {
    const raw = localStorage.getItem(TMDB_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveTmdbCache() {
  try {
    localStorage.setItem(TMDB_CACHE_KEY, JSON.stringify(tmdbCache || {}));
  } catch (_) {}
}

function loadPersonCache() {
  try {
    const raw = localStorage.getItem(PERSON_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function savePersonCache() {
  try {
    localStorage.setItem(PERSON_CACHE_KEY, JSON.stringify(personCache || {}));
  } catch (_) {}
}

function loadPersonCreditsCache() {
  try {
    const raw = localStorage.getItem(PERSON_CREDITS_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function savePersonCreditsCache() {
  try {
    localStorage.setItem(PERSON_CREDITS_CACHE_KEY, JSON.stringify(personCreditsCache || {}));
  } catch (_) {}
}

function loadCountryDiscoverCache() {
  try {
    const raw = localStorage.getItem(COUNTRY_DISCOVER_CACHE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_) {
    return {};
  }
}

function saveCountryDiscoverCache() {
  try {
    localStorage.setItem(COUNTRY_DISCOVER_CACHE_KEY, JSON.stringify(countryDiscoverCache || {}));
  } catch (_) {}
}

function tmdbKey(title, year, type) {
  return `${normKey(title)}|${Number(year) || 0}|${type || "movie"}`;
}

function tmdbType(type) {
  return (type === "series" || type === "anime") ? "tv" : "movie";
}

function tmdbEnabled() {
  return !!TMDB_API_KEY || !!TMDB_READ_TOKEN;
}

function isFresh(entry) {
  return entry && (nowTs() - Number(entry.ts || 0) < PERSON_CACHE_TTL);
}

function getCachedPersonGender(id) {
  const entry = personCache?.[id];
  if (!isFresh(entry)) return 0;
  return normalizeGender(entry?.gender);
}

function setCachedPersonGender(id, gender) {
  if (!id) return;
  personCache[id] = { ts: nowTs(), gender: normalizeGender(gender) };
  savePersonCache();
}

function getCachedPersonCredits(id) {
  const entry = personCreditsCache?.[id];
  if (!isFresh(entry)) return null;
  return entry?.data || null;
}

function setCachedPersonCredits(id, data) {
  if (!id) return;
  personCreditsCache[id] = { ts: nowTs(), data };
  savePersonCreditsCache();
}

function getCachedCountryDiscover(code) {
  const entry = countryDiscoverCache?.[code];
  if (!isFresh(entry)) return null;
  return entry?.data || null;
}

function setCachedCountryDiscover(code, data) {
  if (!code) return;
  countryDiscoverCache[code] = { ts: nowTs(), data };
  saveCountryDiscoverCache();
}

async function tmdbFetch(path, params = {}) {
  const useKey = !!TMDB_API_KEY;
  const url = new URL(`${TMDB_BASE}${path}`);
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  });
  if (useKey) url.searchParams.set("api_key", TMDB_API_KEY);

  const res = await fetch(url.toString(), {
    headers: (!useKey && TMDB_READ_TOKEN) ? { Authorization: `Bearer ${TMDB_READ_TOKEN}` } : {}
  });

  if ((res.status === 401 || res.status === 403) && useKey && TMDB_READ_TOKEN) {
    const retry = new URL(`${TMDB_BASE}${path}`);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") retry.searchParams.set(k, String(v));
    });
    const res2 = await fetch(retry.toString(), {
      headers: { Authorization: `Bearer ${TMDB_READ_TOKEN}` }
    });
    if (!res2.ok) throw new Error(`TMDB ${res2.status}`);
    return res2.json();
  }

  if (!res.ok) throw new Error(`TMDB ${res.status}`);
  return res.json();
}

async function tmdbSearch(title, year, type) {
  const endpoint = tmdbType(type) === "tv" ? "/search/tv" : "/search/movie";
  const params = {
    query: title,
    language: "es-ES"
  };
  if (year) {
    if (endpoint === "/search/movie") params.year = year;
    else params.first_air_date_year = year;
  }
  const data = await tmdbFetch(endpoint, params);
  const results = Array.isArray(data?.results) ? data.results : [];
  return results.slice(0, 10).map(r => ({
    id: r.id,
    title: r.title || r.name || "",
    year: Number(String(r.release_date || r.first_air_date || "").slice(0, 4)) || 0
  }));
}

async function tmdbFetchDetails(id, type) {
  const kind = tmdbType(type);
  const [detail, credits] = await Promise.all([
    tmdbFetch(`/${kind}/${id}`, { language: "es-ES" }),
    tmdbFetch(`/${kind}/${id}/credits`, { language: "es-ES" })
  ]);

  const genres = Array.isArray(detail?.genres) ? detail.genres.map(g => g?.name).filter(Boolean) : [];
  const crew = Array.isArray(credits?.crew) ? credits.crew : [];
  const cast = Array.isArray(credits?.cast) ? credits.cast : [];

  const directorEntry = crew.find(c => c?.job === "Director") || null;
  const director = directorEntry?.name || "";
  const directorData = directorEntry ? {
    name: directorEntry?.name || "",
    gender: normalizeGender(directorEntry?.gender),
    tmdbId: Number(directorEntry?.id) || 0
  } : null;

  const castTop = cast
    .slice()
    .sort((a, b) => (a?.order ?? 999) - (b?.order ?? 999))
    .slice(0, 10)
    .map(c => ({
      name: c?.name || "",
      gender: normalizeGender(c?.gender),
      tmdbId: Number(c?.id) || 0
    }))
    .filter(c => norm(c?.name));

  let country = "";
  if (kind === "movie") {
    country = detail?.production_countries?.[0]?.iso_3166_1 || "";
  } else {
    country = detail?.origin_country?.[0] || "";
  }

  const seasons = (kind === "tv" && Array.isArray(detail?.seasons))
    ? detail.seasons
      .map(s => ({
        seasonNumber: Number(s?.season_number) || 0,
        episodeCount: Number(s?.episode_count) || 0
      }))
      .filter(s => s.seasonNumber > 0 && s.episodeCount > 0)
    : [];

  return {
    tmdbId: Number(id) || 0,
    tmdbType: kind,
    title: detail?.title || detail?.name || "",
    year: Number(String(detail?.release_date || detail?.first_air_date || "").slice(0, 4)) || 0,
    director,
    directorData,
    cast: castTop,
    genres,
    country,
    seasons
  };
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

function normalizeWatchDates(raw, watchedAt) {
  let dates = Array.isArray(raw) ? raw.map(v => String(v || "")).filter(Boolean) : [];
  if (!dates.length && watchedAt) dates = [isoDay(watchedAt)];
  return dates;
}

function normalizeItem(it) {
  if (!it || typeof it !== "object") return it;

  const out = { ...it };
  out.id = String(out.id || uid());

  out.title = norm(out.title);
  out.type = (out.type === "series" || out.type === "anime") ? out.type : "movie";
  out.genres = Array.isArray(out.genres) ? out.genres.map(norm).filter(Boolean).slice(0, 30) : [];
  out.director = norm(out.director);
  const rawCast = Array.isArray(out.cast) ? out.cast : (typeof out.cast === "string" ? parseCSV(out.cast) : []);
  out.cast = normalizeCastList(rawCast);
  if (out.directorData && typeof out.directorData === "object") {
    const name = norm(out.directorData.name || out.director);
    out.directorData = name ? {
      name,
      gender: normalizeGender(out.directorData.gender),
      tmdbId: Number(out.directorData.tmdbId || out.directorData.id) || 0
    } : null;
  } else {
    out.directorData = null;
  }
  if (out.directorData?.name) out.director = out.directorData.name;
  out.tmdbId = Number(out.tmdbId) || 0;
  out.tmdbType = (out.tmdbType === "tv" || out.tmdbType === "movie") ? out.tmdbType : "";

  out.rating = clamp(out.rating, 0, 5);
  out.withLaura = !!out.withLaura;
  out.watchlist = !!out.watchlist;

  out.year = Number(out.year) || 0;

  out.watchDates = normalizeWatchDates(out.watchDates, out.watchedAt);

  // país: guardamos label ES + EN (para mapa)
  const raw = out.countryCode || out.countryEn || out.countryLabel || out.country || "";
  const cc = normalizeCountry(raw);

  out.countryCode = cc.code || "";
  out.countryEn = cc.en || (norm(out.countryEn) || "");
  out.countryLabel = cc.es || (norm(out.countryLabel) || norm(out.country) || "");

  // progreso series/anime
  if (out.type === "series" || out.type === "anime") {
    out.seasons = normalizeSeasons(out.seasons);
    const progress = clampSeasonEpisode(out.seasons, out.currentSeason ?? out.season, out.currentEpisode ?? out.episode);
    out.currentSeason = progress.season;
    out.currentEpisode = progress.episode;
    out.season = out.currentSeason;
    out.episode = out.currentEpisode;
  } else {
    out.seasons = [];
    out.currentSeason = 0;
    out.currentEpisode = 0;
    out.season = 0;
    out.episode = 0;
  }

  const t = nowTs();
  out.createdAt = Number(out.createdAt) || t;
  out.updatedAt = Number(out.updatedAt) || t;

  // watchedAt solo si visto
  const parsedDates = out.watchDates.map(d => Date.parse(d)).filter(n => Number.isFinite(n));
  const lastTs = parsedDates.length ? Math.max(...parsedDates) : 0;
  out.lastWatchedTs = lastTs || 0;
  out.lastWatched = lastTs ? isoDay(lastTs) : "";
  out.rewatchCount = Math.max(0, out.watchDates.length - 1);

  if (out.watchDates.length && out.watchlist) out.watchlist = false;

  if (!out.watchlist) out.watchedAt = lastTs || Number(out.watchedAt) || out.updatedAt || t;
  else out.watchedAt = 0;

  return out;
}

/* ------------------------- Filters ------------------------- */
function hasDirector(it) {
  return norm(it?.director).length > 0;
}

function hasCast(it) {
  if (Array.isArray(it?.cast)) return castHasEntries(it.cast);
  return norm(it?.cast).length > 0;
}

function isMetaComplete(it) {
  return hasDirector(it) && hasCast(it);
}

function metaLabel(value) {
  switch (value) {
    case "complete":
      return "completos";
    case "incomplete":
      return "incompletos";
    case "missing-director":
      return "director falta";
    case "missing-cast":
      return "reparto falta";
    default:
      return "todos";
  }
}

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

    if (state.rewatchOnly && (Number(it.rewatchCount) || 0) < 1) return false;
    if (state.rewatchMin && (Number(it.rewatchCount) || 0) < Number(state.rewatchMin || 0)) return false;

    if (state.meta !== "all") {
      const complete = isMetaComplete(it);
      if (state.meta === "complete" && !complete) return false;
      if (state.meta === "incomplete" && complete) return false;
      if (state.meta === "missing-director" && hasDirector(it)) return false;
      if (state.meta === "missing-cast" && hasCast(it)) return false;
    }

    if (state.watchedFrom || state.watchedTo) {
      const lastTs = Number(it.lastWatchedTs) || 0;
      if (!lastTs) return false;
      if (state.watchedFrom) {
        const fTs = Date.parse(state.watchedFrom);
        if (Number.isFinite(fTs) && lastTs < startOfDay(fTs)) return false;
      }
      if (state.watchedTo) {
        const tTs = Date.parse(state.watchedTo);
        if (Number.isFinite(tTs) && lastTs > endOfDay(tTs)) return false;
      }
    }

    if (!q) return true;

    const hay = [
      it.title,
      it.type,
      it.year ? String(it.year) : "",
      it.countryLabel,
      it.countryEn,
      it.director,
      ...(it.genres || []),
      ...(Array.isArray(it.cast) ? castNames(it.cast) : [it.cast])
    ].filter(Boolean).join(" ");

    return normKey(hay).includes(q);
  });

  filtered.sort(byUpdatedDesc);
}

function getActiveFilterChips() {
  const chips = [];

  if (state.q) chips.push(`Texto: ${state.q}`);

  if (state.type !== "all") {
    const typeLabel = state.type === "movie" ? "Pelis" : (state.type === "series" ? "Series" : "Anime");
    chips.push(`Tipo: ${typeLabel}`);
  }

  if (state.status !== "all") {
    chips.push(`Estado: ${state.status === "watched" ? "Visto" : "Watchlist"}`);
  }

  if (state.laura !== "all") {
    chips.push(`Laura: ${state.laura === "with" ? "Con" : "Sin"}`);
  }

  if (state.range !== "total") {
    const rangeLabel = state.range === "day" ? "Día" : (state.range === "week" ? "Semana" : (state.range === "month" ? "Mes" : "Año"));
    chips.push(`Rango: ${rangeLabel}`);
  }

  if (state.rewatchOnly) chips.push("Rewatches: solo");
  if (state.rewatchMin) chips.push(`Rewatch ≥ ${state.rewatchMin}`);

  if (state.watchedFrom) chips.push(`Visto desde ${state.watchedFrom}`);
  if (state.watchedTo) chips.push(`Visto hasta ${state.watchedTo}`);

  if (state.meta !== "all") chips.push(`Metadatos: ${metaLabel(state.meta)}`);

  return chips;
}

function renderFilterChips() {
  if (!els.filterChips || !els.filterCount) return;

  const chips = getActiveFilterChips();
  els.filterCount.textContent = String(chips.length);
  els.filterCount.style.display = chips.length ? "" : "none";

  if (!chips.length) {
    els.filterChips.innerHTML = `<span class="media-filter-chip is-empty">Sin filtros activos</span>`;
    return;
  }

  els.filterChips.innerHTML = chips.map(label => `<span class="media-filter-chip">${escHtml(label)}</span>`).join("");
}

function updateBulkAutofillUI() {
  if (!els.bulkAutofillWrap || !els.bulkAutofillBtn) return;
  const show = state.meta === "incomplete";
  els.bulkAutofillWrap.style.display = show ? "" : "none";
  els.bulkAutofillBtn.disabled = bulkAutofillBusy;
  els.bulkAutofillBtn.textContent = bulkAutofillBusy ? "Autocompletando..." : "Autocompletar todos (en lote)";
}

function getCachedTmdbDetails(key) {
  const entry = tmdbCache[key];
  if (entry?.selectedId && entry.details?.[entry.selectedId]) return entry.details[entry.selectedId];
  return null;
}

async function fetchTmdbDetailsForItem(it, key) {
  const entry = tmdbCache[key] || { results: [], details: {}, selectedId: null };

  if (entry.selectedId && entry.details?.[entry.selectedId]) {
    return entry.details[entry.selectedId];
  }

  let results = entry.results || [];
  if (!results.length) {
    results = await tmdbSearch(it.title, it.year, it.type);
    entry.results = results;
  }

  if (!results.length) {
    tmdbCache[key] = entry;
    saveTmdbCache();
    return null;
  }

  const preferred = results.find(r => r.year && it.year && r.year === it.year) || results[0];
  if (!preferred?.id) return null;

  if (entry.details?.[preferred.id]) {
    entry.selectedId = preferred.id;
    tmdbCache[key] = entry;
    saveTmdbCache();
    return entry.details[preferred.id];
  }

  const details = await tmdbFetchDetails(preferred.id, it.type);
  entry.details = entry.details || {};
  entry.details[preferred.id] = details;
  entry.selectedId = preferred.id;
  tmdbCache[key] = entry;
  saveTmdbCache();
  return details;
}

function buildAutofillPatch(it, details) {
  if (!details) return null;
  const patch = {};

  if (!hasDirector(it) && norm(details.director)) patch.director = details.director;
  if (!hasCast(it) && Array.isArray(details.cast) && details.cast.length) patch.cast = details.cast;
  if (!it.tmdbId && details.tmdbId) {
    patch.tmdbId = details.tmdbId;
    patch.tmdbType = details.tmdbType || tmdbType(it.type);
  }
  if (!it.directorData && details.directorData) patch.directorData = details.directorData;

  if (!Array.isArray(it.genres) || it.genres.length === 0) {
    if (Array.isArray(details.genres) && details.genres.length) patch.genres = details.genres;
  }

  if (!it.countryCode && !it.countryLabel && norm(details.country)) {
    const cc = normalizeCountry(details.country || "");
    patch.countryCode = cc.code || "";
    patch.countryEn = cc.en || details.country || "";
    patch.countryLabel = cc.es || details.country || "";
  }

  if ((it.type === "series" || it.type === "anime") && (!Array.isArray(it.seasons) || !it.seasons.length)) {
    if (Array.isArray(details.seasons) && details.seasons.length) patch.seasons = details.seasons;
  }

  return Object.keys(patch).length ? patch : null;
}

async function runBulkAutofill() {
  if (bulkAutofillBusy || state.meta !== "incomplete") return;
  if (!tmdbEnabled()) {
    setMediaSub("TMDb no disponible", 2400);
    return;
  }

  const candidates = filtered.filter(it => isMetaComplete(it) === false);
  if (!candidates.length) {
    setMediaSub("No hay títulos incompletos", 2000);
    return;
  }

  if (!window.confirm(`Autocompletar ${candidates.length} títulos incompletos?`)) return;

  bulkAutofillBusy = true;
  updateBulkAutofillUI();

  let updated = 0;
  let skipped = 0;

  for (const it of candidates) {
    if (!it || isMetaComplete(it)) { skipped++; continue; }
    const key = tmdbKey(it.title, it.year, it.type);
    const cached = getCachedTmdbDetails(key);
    if (!cached && bulkAutofillSeen.has(key)) { skipped++; continue; }

    try {
      const details = cached || await fetchTmdbDetailsForItem(it, key);
      const patch = buildAutofillPatch(it, details);
      if (patch) {
        updateItem(it.id, patch);
        updated++;
      } else {
        skipped++;
      }
    } catch (err) {
      console.warn("[media] bulk tmdb autofill failed", err);
      skipped++;
    } finally {
      bulkAutofillSeen.add(key);
      await sleep(350);
    }
  }

  bulkAutofillBusy = false;
  updateBulkAutofillUI();
  setMediaSub(`Autocompletado: ${updated} · Omitidos: ${skipped}`, 3200);
}

/* ------------------------- DOM ------------------------- */
function qs(id) { return document.getElementById(id); }

let addWatchDates = [];
let addAutofillBusy = false;
let addAutofillSeasons = [];
let addAutofillMeta = null;
let editAutofillBusy = false;
let editAutofillSeasons = [];
let editAutofillMeta = null;
let updateEditAutofillButton = null;
let bulkAutofillBusy = false;
const bulkAutofillSeen = new Set();

function updateChipPreview(inputEl, previewEl) {
  if (!inputEl || !previewEl) return;
  const items = parseCSV(inputEl.value);
  previewEl.innerHTML = items.map(v => `<span class="media-chip">${escHtml(v)}</span>`).join("");
}

function updateAddWatchMeta() {
  if (!els.addWatchMeta) return;
  if (els.addWatchlist?.checked) {
    els.addWatchMeta.textContent = "Se guardará en watchlist.";
    return;
  }
  const count = addWatchDates.length;
  if (!count) {
    els.addWatchMeta.textContent = "Se guardará como visto hoy.";
    return;
  }
  const last = addWatchDates[addWatchDates.length - 1];
  const rewatches = Math.max(0, count - 1);
  els.addWatchMeta.textContent = `Vistas: ${count} · Rewatches: ${rewatches} · Último: ${last}`;
}

function updateEditWatchMeta(it) {
  const meta = qs("media-edit-watch-meta");
  if (!meta) return;
  if (it?.watchlist) {
    meta.textContent = "En watchlist.";
    return;
  }
  const dates = Array.isArray(it?.watchDates) ? it.watchDates : [];
  const count = dates.length;
  if (!count) {
    meta.textContent = "Sin registros.";
    return;
  }
  const last = dates[dates.length - 1];
  const rewatches = Math.max(0, count - 1);
  meta.textContent = `Vistas: ${count} · Rewatches: ${rewatches} · Último: ${last}`;
}

function resetAddModalState() {
  addWatchDates = [];
  addAutofillBusy = false;
  addAutofillSeasons = [];
  addAutofillMeta = null;
  if (els.addAutofillResults) els.addAutofillResults.innerHTML = "";
  ["media-genres", "media-director", "media-cast", "media-country"].forEach(id => {
    const el = qs(id);
    if (el) delete el.dataset.userEdited;
  });
  updateAddWatchMeta();
  updateChipPreview(els.addGenres, els.addGenresPreview);
  updateChipPreview(els.addCast, els.addCastPreview);
}

const els = {
  view: null,
  viewBtns: [],
  // filters
  search: null,
  typePills: null,
  filtersSlot: null,
  filterCount: null,
  filterChips: null,
  metaFilter: null,
  bulkAutofillWrap: null,
  bulkAutofillBtn: null,

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
  actorGender: null,
  actorGenderWrap: null,
  chartSub: null,
  chartEmpty: null,
  legend: null,
  legendMeta: null,
  legendList: null,
  legendMore: null,
  legendSearch: null,

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
  addSeasonWrap: null,
  addAutofillBtn: null,
  addAutofillResults: null,
  addWatchToday: null,
  addWatchMeta: null,
  addGenresPreview: null,
  addCastPreview: null
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
  els.actorGender = qs("media-actor-filter-select");
  els.actorGenderWrap = qs("media-actor-filter");
  els.chartSub = qs("media-chart-sub");
  els.chartEmpty = qs("media-chart-empty");

  els.legend = qs("media-legend");
  els.legendMeta = qs("media-legend-meta");
  els.legendList = qs("media-donut-legend");
  els.legendMore = qs("media-legend-more");
  els.legendSearch = qs("media-legend-search");

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
  els.addAutofillBtn = qs("media-autofill-btn");
  els.addAutofillResults = qs("media-autofill-results");
  els.addWatchToday = qs("media-add-watchtoday");
  els.addWatchMeta = qs("media-add-watch-meta");
  els.addGenresPreview = qs("media-add-genres-preview");
  els.addCastPreview = qs("media-add-cast-preview");

  // country datalist
  populateCountryDatalist();

  // inline filters (si no existen, los inyectamos aquí para no tocar index)
  ensureInlineFilters();
  bindCsvImport();
  els.filterCount = qs("media-filter-count");
  els.filterChips = qs("media-filter-chips");
  els.metaFilter = qs("media-filter-meta");

  els.bulkAutofillWrap = qs("media-list-actions");
  els.bulkAutofillBtn = qs("media-bulk-autofill");

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
    updateActorFilterVisibility();
    renderDonut();
  });

  els.actorGender?.addEventListener("change", () => {
    state.actorGender = els.actorGender.value || "all";
    renderDonut();
  });

  els.legendSearch?.addEventListener("input", () => {
    state.breakdownQuery = els.legendSearch.value || "";
    renderDonutLegend();
  });

  // legend more
  els.legendMore?.addEventListener("click", () => {
    legendGrow();
    renderDonutLegend();
  });

  els.legendList?.addEventListener("click", (e) => {
    const row = e.target?.closest?.(".media-legend-row[data-action]");
    if (!row) return;
    const action = row.dataset?.action || "";
    if (action === "country") {
      const code = row.dataset?.code || "";
      const label = row.dataset?.label || "";
      openCountryModal({ code, label });
      return;
    }
    if (action === "entity") {
      const name = row.dataset?.label || "";
      const kind = row.dataset?.kind || "";
      if (!name || (kind !== "actor" && kind !== "director")) return;
      openEntityModal({ name, kind });
    }
  });

  els.legendList?.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const row = e.target?.closest?.(".media-legend-row[data-action]");
    if (!row) return;
    e.preventDefault();
    const action = row.dataset?.action || "";
    if (action === "country") {
      const code = row.dataset?.code || "";
      const label = row.dataset?.label || "";
      openCountryModal({ code, label });
      return;
    }
    if (action === "entity") {
      const name = row.dataset?.label || "";
      const kind = row.dataset?.kind || "";
      if (!name || (kind !== "actor" && kind !== "director")) return;
      openEntityModal({ name, kind });
    }
  });

  // list scroll
  els.list?.addEventListener("scroll", () => renderVirtual());

  els.countryList?.addEventListener("click", (e) => {
    const row = e.target?.closest?.("[data-action='country']");
    if (!row) return;
    const code = row.dataset?.code || "";
    const label = row.dataset?.label || "";
    openCountryModal({ code, label });
  });

  // bulk autofill
  els.bulkAutofillBtn?.addEventListener("click", () => {
    runBulkAutofill();
  });

  // add modal: close
  els.addCancel?.addEventListener("click", () => { if (els.addToggle) els.addToggle.checked = false; });

  // add modal: season/episode visibility
  function syncAddSeasonEp() {
    const t = els.addType?.value || "movie";
    if (!els.addSeasonWrap) return;
    const show = (t === "series" || t === "anime");
    els.addSeasonWrap.style.display = show ? "" : "none";
    const section = qs("media-add-progress-section");
    if (section) section.style.display = show ? "" : "none";
    if (!show) addAutofillSeasons = [];
  }
  els.addType?.addEventListener("change", syncAddSeasonEp);
  syncAddSeasonEp();

  const addEditFields = [els.addGenres, els.addDirector, els.addCast, els.addCountry];
  addEditFields.forEach((el) => {
    el?.addEventListener("input", () => {
      if (addAutofillBusy) return;
      if (el) el.dataset.userEdited = "1";
    });
  });
  els.addGenres?.addEventListener("input", () => updateChipPreview(els.addGenres, els.addGenresPreview));
  els.addCast?.addEventListener("input", () => updateChipPreview(els.addCast, els.addCastPreview));

  function updateAutofillButton() {
    const ok = !!norm(els.addTitle?.value) && !!Number(els.addYear?.value) && !!(els.addType?.value || "");
    if (els.addAutofillBtn) els.addAutofillBtn.disabled = !ok;
    if (els.addAutofillResults) els.addAutofillResults.innerHTML = "";
  }
  ["input", "change"].forEach(evt => {
    els.addTitle?.addEventListener(evt, updateAutofillButton);
    els.addYear?.addEventListener(evt, updateAutofillButton);
    els.addType?.addEventListener(evt, updateAutofillButton);
  });

  els.addToggle?.addEventListener("change", () => {
    if (els.addToggle?.checked) resetAddModalState();
  });

  els.addWatchlist?.addEventListener("change", () => {
    updateAddWatchMeta();
  });

  els.addWatchToday?.addEventListener("click", () => {
    if (els.addWatchlist?.checked) els.addWatchlist.checked = false;
    addWatchDates.push(isoDay());
    updateAddWatchMeta();
  });

  els.addAutofillBtn?.addEventListener("click", async () => {
    const title = norm(els.addTitle?.value);
    const year = Number(els.addYear?.value) || 0;
    const type = els.addType?.value || "movie";
    if (!title || !year || !tmdbEnabled()) {
      setMediaSub("No se pudo autocompletar", 2400);
      return;
    }
    try {
      addAutofillBusy = true;
      await runTmdbAutofill({
        title,
        year,
        type,
        resultsEl: els.addAutofillResults,
        apply: (details) => applyAutofillData(details, "add")
      });
    } catch (e) {
      console.warn("[media] tmdb autocomplete failed", e);
      setMediaSub("No se pudo autocompletar", 2400);
    } finally {
      addAutofillBusy = false;
    }
  });

  els.addAutofillResults?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-action='autofill-select']");
    if (!btn) return;
    const id = Number(btn.dataset.id) || 0;
    const key = els.addAutofillResults?.dataset?.key;
    const type = els.addAutofillResults?.dataset?.type || "movie";
    if (!id || !key) return;
    try {
      addAutofillBusy = true;
      await selectTmdbResult(key, id, type, (details) => applyAutofillData(details, "add"), els.addAutofillResults);
    } catch (err) {
      console.warn("[media] tmdb select failed", err);
      setMediaSub("No se pudo autocompletar", 2400);
    } finally {
      addAutofillBusy = false;
    }
  });
  updateAutofillButton();

  // add modal: save
  els.addConfirm?.addEventListener("click", () => {
    const title = norm(els.addTitle?.value);
    if (!title) return;

    const type = (els.addType?.value || "movie");
    const rating = clamp(els.addRating?.value, 0, 5);
    const year = Number(els.addYear?.value) || 0;

    const genres = parseCSV(els.addGenres?.value);
    const director = norm(els.addDirector?.value);
    const castNamesList = parseCSV(els.addCast?.value);
    const cast = mergeCastMeta(castNamesList, addAutofillMeta?.cast);
    const directorData = mergeDirectorMeta(director, addAutofillMeta?.directorData);
    const tmdbId = Number(addAutofillMeta?.tmdbId) || 0;
    const tmdbTypeValue = addAutofillMeta?.tmdbType || "";

    const cRaw = norm(els.addCountry?.value);
    const cc = normalizeCountry(cRaw);

    const watchlist = !!els.addWatchlist?.checked;
    const withLaura = !!els.addLaura?.checked;

    const season = Math.max(1, Number(els.addSeason?.value) || 1);
    const episode = Math.max(1, Number(els.addEpisode?.value) || 1);
    const seasons = (type === "series" || type === "anime") ? addAutofillSeasons : [];
    const watchDates = watchlist ? [] : (addWatchDates.length ? addWatchDates.slice() : [isoDay()]);

    addItem({
      title,
      type,
      rating,
      year,
      genres,
      director,
      cast,
      directorData,
      tmdbId,
      tmdbType: tmdbTypeValue,
      countryCode: cc.code,
      countryEn: cc.en || (cRaw || ""),
      countryLabel: cc.es || (cRaw || ""),
      watchlist,
      withLaura,
      season,
      episode,
      seasons,
      currentSeason: season,
      currentEpisode: episode,
      watchDates
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
    if (els.addAutofillResults) els.addAutofillResults.innerHTML = "";
    resetAddModalState();

    if (els.addToggle) els.addToggle.checked = false;
  });

  // enter to save (en título)
  els.addTitle?.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); els.addConfirm?.click(); }
  });

  // row interactions
  bindRowInteractions();

  const fab = qs("media-fab-add");
  fab?.addEventListener("pointerdown", (e) => e.stopPropagation());
  fab?.addEventListener("click", (e) => e.stopPropagation());

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

  updateActorFilterVisibility();
  if (els.actorGender) els.actorGender.value = state.actorGender || "all";
  if (els.legendSearch) els.legendSearch.value = state.breakdownQuery || "";

  return true;
}

async function runTmdbAutofill({ title, year, type, resultsEl, apply }) {
  if (!resultsEl) return;
  const key = tmdbKey(title, year, type);
  const entry = tmdbCache[key] || { results: [], details: {}, selectedId: null };

  if (entry.selectedId && entry.details?.[entry.selectedId]) {
    apply(entry.details[entry.selectedId]);
    return;
  }

  let results = entry.results || [];
  if (!results.length) {
    results = await tmdbSearch(title, year, type);
    entry.results = results;
    tmdbCache[key] = entry;
    saveTmdbCache();
  }

  if (!results.length) {
    setMediaSub("No se pudo autocompletar", 2400);
    return;
  }

  if (results.length === 1) {
    await selectTmdbResult(key, results[0].id, type, apply, resultsEl);
    return;
  }

  renderAutofillResults(key, type, results.slice(0, 5), resultsEl);
}

function renderAutofillResults(key, type, results, resultsEl) {
  if (!resultsEl) return;
  resultsEl.dataset.key = key;
  resultsEl.dataset.type = type;
  resultsEl.innerHTML = `
    <div class="media-autocomplete-card">
      <div class="media-autocomplete-title">Selecciona un resultado</div>
      <div class="media-autocomplete-actions">
        ${results.map(r => `
          <button class="btn ghost btn-compact" data-action="autofill-select" data-id="${r.id}">
            ${escHtml(r.title || "—")}${r.year ? ` (${r.year})` : ""}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

async function selectTmdbResult(key, id, type, apply, resultsEl) {
  const entry = tmdbCache[key] || { results: [], details: {}, selectedId: null };
  if (entry.details?.[id]) {
    entry.selectedId = id;
    tmdbCache[key] = entry;
    saveTmdbCache();
    apply(entry.details[id]);
    if (resultsEl) resultsEl.innerHTML = "";
    return;
  }

  const details = await tmdbFetchDetails(id, type);
  entry.details = entry.details || {};
  entry.details[id] = details;
  entry.selectedId = id;
  tmdbCache[key] = entry;
  saveTmdbCache();
  apply(details);
  if (resultsEl) resultsEl.innerHTML = "";
}

function storeAutofillMeta(details, mode) {
  const meta = details ? {
    tmdbId: Number(details.tmdbId) || 0,
    tmdbType: details.tmdbType || "",
    cast: Array.isArray(details.cast) ? details.cast : [],
    directorData: details.directorData || null
  } : null;
  if (mode === "edit") editAutofillMeta = meta;
  else addAutofillMeta = meta;
}

function applyAutofillData(details, mode) {
  if (!details) return;
  const isEdit = mode === "edit";
  const genresEl = isEdit ? qs("media-edit-genres") : els.addGenres;
  const directorEl = isEdit ? qs("media-edit-director") : els.addDirector;
  const castEl = isEdit ? qs("media-edit-cast") : els.addCast;
  const countryEl = isEdit ? qs("media-edit-country") : els.addCountry;

  if (genresEl) genresEl.value = (details.genres || []).join(", ");
  if (directorEl) directorEl.value = details.director || "";
  if (castEl) castEl.value = castNames(details.cast || []).join(", ");
  if (countryEl) {
    const cc = normalizeCountry(details.country || "");
    countryEl.value = cc.es || details.country || "";
  }

  const seasons = normalizeSeasons(details.seasons);
  if (isEdit) editAutofillSeasons = seasons;
  else addAutofillSeasons = seasons;
  storeAutofillMeta(details, mode);

  const typeEl = isEdit ? qs("media-edit-type") : els.addType;
  const seasonEl = isEdit ? qs("media-edit-season") : els.addSeason;
  const episodeEl = isEdit ? qs("media-edit-episode") : els.addEpisode;
  if (typeEl && (typeEl.value === "series" || typeEl.value === "anime") && seasonEl && episodeEl) {
    const progress = clampSeasonEpisode(seasons, seasonEl.value, episodeEl.value);
    seasonEl.value = String(progress.season);
    episodeEl.value = String(progress.episode);
  }

  updateChipPreview(genresEl, qs(isEdit ? "media-edit-genres-preview" : "media-add-genres-preview"));
  updateChipPreview(castEl, qs(isEdit ? "media-edit-cast-preview" : "media-add-cast-preview"));
  setMediaSub("Datos actualizados desde TMDb", 2200);
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

function updateActorFilterVisibility() {
  const show = state.chart === "actor";
  if (els.actorGenderWrap) els.actorGenderWrap.style.display = show ? "" : "none";
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
        <span class="media-inline-summary-left">
          <span>Filtros</span>
          <span class="media-filter-badge" id="media-filter-count">0</span>
        </span>
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

        <div class="media-inline-row">
          <label class="media-mini">
            <span>Rewatches</span>
            <select id="media-filter-rewatch">
              <option value="all">Todos</option>
              <option value="only">Solo rewatches</option>
            </select>
          </label>

          <label class="media-mini">
            <span>Rewatch ≥</span>
            <input id="media-filter-rewatch-min" type="number" min="0" placeholder="0" />
          </label>

          <label class="media-mini">
            <span>Visto desde</span>
            <input id="media-filter-watched-from" type="date" />
          </label>

          <label class="media-mini">
            <span>Visto hasta</span>
            <input id="media-filter-watched-to" type="date" />
          </label>
        </div>

        <div class="media-inline-row">
          <label class="media-mini">
            <span>Metadatos</span>
            <select id="media-filter-meta">
              <option value="all">Todo</option>
              <option value="complete">✅ Solo completos</option>
              <option value="incomplete">⚠️ Solo incompletos</option>
              <option value="missing-director">Director falta</option>
              <option value="missing-cast">Reparto falta</option>
            </select>
          </label>
        </div>

        <div class="media-filter-chiprow">
          <div class="media-filter-chip-title">Activos</div>
          <div class="media-filter-chips" id="media-filter-chips" aria-live="polite"></div>
        </div>


        <div class="media-inline-row media-import-row">
          <button class="btn ghost btn-compact" id="media-import-csv-btn" type="button">Importar CSV (Letterboxd)</button>
          <input id="media-import-csv" type="file" accept=".csv,text/csv" hidden />
          <div class="media-import-hint">Date, Name, Year, link.</div>
        </div>
      </div>
    </details>
  `;
  host.appendChild(wrap);

  const $status = qs("media-filter-status");
  const $laura = qs("media-filter-laura");
  const $rewatch = qs("media-filter-rewatch");
  const $rewatchMin = qs("media-filter-rewatch-min");
  const $from = qs("media-filter-watched-from");
  const $to = qs("media-filter-watched-to");
  const $meta = qs("media-filter-meta");
  const rangeBtns = Array.from(wrap.querySelectorAll(".media-range-btn"));

  if ($status) $status.addEventListener("change", () => { state.status = $status.value || "all"; refresh(); });
  if ($laura) $laura.addEventListener("change", () => { state.laura = $laura.value || "all"; refresh(); });
  if ($rewatch) $rewatch.addEventListener("change", () => { state.rewatchOnly = ($rewatch.value === "only"); refresh(); });
  if ($rewatchMin) $rewatchMin.addEventListener("input", () => {
    state.rewatchMin = Number($rewatchMin.value) || 0;
    refresh();
  });
  if ($from) $from.addEventListener("change", () => { state.watchedFrom = $from.value || ""; refresh(); });
  if ($to) $to.addEventListener("change", () => { state.watchedTo = $to.value || ""; refresh(); });
  if ($meta) $meta.addEventListener("change", () => { state.meta = $meta.value || "all"; refresh(); });

  rangeBtns.forEach(b => b.addEventListener("click", () => {
    state.range = b.dataset.range || "total";
    rangeBtns.forEach(x => x.classList.toggle("is-active", x === b));
    refresh();
  }));
}

/* ------------------------- CSV import (Letterboxd) ------------------------- */
let _mediaSubTimer = 0;
function setMediaSub(msg, ms = 2500) {
  const el = els.view?.querySelector?.(".media-sub");
  if (!el) return;
  if (_mediaSubTimer) { clearTimeout(_mediaSubTimer); _mediaSubTimer = 0; }
  el.textContent = String(msg || "");
  if (ms && ms > 0) {
    _mediaSubTimer = setTimeout(() => { el.textContent = ""; _mediaSubTimer = 0; }, ms);
  }
}

function parseCSVTable(text) {
  text = String(text || "").replace(/^\uFEFF/, "");
  const rows = [];
  let row = [];
  let cur = "";
  let inQ = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cur += '"'; i++; }
        else inQ = false;
      } else cur += ch;
      continue;
    }

    if (ch === '"') { inQ = true; continue; }
    if (ch === ",") { row.push(cur); cur = ""; continue; }
    if (ch === "\r") continue;
    if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; continue; }
    cur += ch;
  }
  if (cur.length || row.length) { row.push(cur); rows.push(row); }

  return rows.map(r => r.map(v => norm(v)));
}

function findHeaderIdx(headers, keys) {
  const h = (headers || []).map(x => foldKey(x));
  for (let i = 0; i < h.length; i++) if (keys.includes(h[i])) return i;
  return -1;
}

function parseLetterboxdCSV(text) {
  const table = parseCSVTable(text);
  if (!table.length) return [];

  const head = table[0] || [];
  const hasHeader = head.some(x => /name|title|year|date|letterboxd/i.test(String(x || "")));

  const iDate = hasHeader ? findHeaderIdx(head, ["date", "watched date", "diary date"]) : 0;
  const iTitle = hasHeader ? (findHeaderIdx(head, ["name", "title", "film", "film name"]) ) : 1;
  const iYear = hasHeader ? findHeaderIdx(head, ["year"]) : 2;

  const start = hasHeader ? 1 : 0;

  const out = [];
  for (let r = start; r < table.length; r++) {
    const row = table[r] || [];
    const title = norm(row[iTitle >= 0 ? iTitle : 1]);
    if (!title) continue;

    const year = Number.parseInt(row[iYear >= 0 ? iYear : 2], 10) || 0;

    const dRaw = norm(row[iDate >= 0 ? iDate : 0]);
    const dTs = dRaw ? (new Date(dRaw)).getTime() : 0;
    const watchedAt = Number.isFinite(dTs) && dTs > 0 ? startOfDay(dTs) : 0;

    out.push({ title, year, watchedAt });
  }
  return out;
}

function pushItemsQueue(arr) {
  const q = Array.isArray(arr) ? arr.slice() : [];
  const total = q.length;
  if (!total) return;

  let done = 0;
  const step = () => {
    const n = Math.min(60, q.length);
    for (let i = 0; i < n; i++) {
      const it = q.shift();
      if (it) pushItemToFirebase(it);
      done++;
    }
    if (q.length) {
      setMediaSub(`Subiendo a Firebase… ${done}/${total}`, 0);
      setTimeout(step, 0);
    } else {
      setMediaSub(`CSV listo · ${total.toLocaleString()} subidos`, 2200);
    }
  };
  step();
}

function importLetterboxdRows(rows) {
  const baseNow = nowTs();

  // índice de existentes por (título|año)
  const byKey = new Map();
  for (const it of items) {
    const k = `${foldKey(it.title)}|${Number(it.year) || 0}`;
    byKey.set(k, it);
  }

  let added = 0, updated = 0, dup = 0, bad = 0;
  const toAdd = [];
  const toPush = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const title = norm(r?.title);
    if (!title) { bad++; continue; }

    const year = Number(r?.year) || 0;
    const watchedAt = Number(r?.watchedAt) || 0;

    const k = `${foldKey(title)}|${year}`;
    if (byKey.has(k)) { dup++; continue; }

    // si existe sin año y el CSV trae año => actualiza en vez de duplicar
    if (year > 0) {
      const k0 = `${foldKey(title)}|0`;
      const ex0 = byKey.get(k0);
      if (ex0 && !Number(ex0.year)) {
        ex0.year = year;
        ex0.updatedAt = baseNow + i;
        if (watchedAt && !ex0.watchlist) {
          ex0.watchDates = normalizeWatchDates(ex0.watchDates, watchedAt);
          ex0.watchedAt = watchedAt;
        }
        Object.assign(ex0, normalizeItem(ex0));
        byKey.delete(k0);
        byKey.set(k, ex0);
        updated++;
        toPush.push(ex0);
        continue;
      }
    }

    const it = normalizeItem({
      id: uid(),
      title,
      type: "movie",
      rating: 0,
      year,
      genres: [],
      director: "",
      cast: [],
      countryCode: "",
      countryEn: "",
      countryLabel: "",
      watchlist: false,
      withLaura: false,
      season: 0,
      episode: 0,
      watchDates: normalizeWatchDates([], watchedAt || baseNow),
      watchedAt: watchedAt || baseNow,
      createdAt: baseNow + i,
      updatedAt: baseNow + i
    });

    toAdd.push(it);
    toPush.push(it);
    byKey.set(k, it);
    added++;
  }

  if (!added && !updated) {
    setMediaSub(`CSV: nada nuevo · dup ${dup.toLocaleString()} · inválidas ${bad.toLocaleString()}`, 4200);
    return;
  }

  // añade de golpe
  if (toAdd.length) items = toAdd.concat(items);

  save();
  refresh();

  if (toPush.length) pushItemsQueue(toPush);

  const msg = `CSV: +${added.toLocaleString()}${updated ? ` · año+${updated.toLocaleString()}` : ""}${dup ? ` · dup ${dup.toLocaleString()}` : ""}`;
  setMediaSub(msg, 5200);
}

async function importLetterboxdCSVFile(file) {
  try {
    if (!file) return;
    setMediaSub("Leyendo CSV…", 0);

    const text = await file.text();
    const rows = parseLetterboxdCSV(text);

    if (!rows.length) {
      setMediaSub("CSV vacío o no reconocido", 3200);
      return;
    }

    setMediaSub(`Procesando… ${rows.length.toLocaleString()} filas`, 0);
    importLetterboxdRows(rows);
  } catch (e) {
    console.warn("[media] csv import failed", e);
    setMediaSub("CSV: error al importar", 3200);
  }
}

function bindCsvImport() {
  const btn = qs("media-import-csv-btn");
  const inp = qs("media-import-csv");
  if (!btn || !inp) return;

  btn.addEventListener("click", () => inp.click());
  inp.addEventListener("change", async () => {
    const file = inp.files && inp.files[0];
    inp.value = "";
    if (!file) return;
    await importLetterboxdCSVFile(file);
  });
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
  const watchlist = !!patch.watchlist;
  const watchDates = watchlist ? [] : normalizeWatchDates(patch.watchDates, now);
  const seasons = (type === "series" || type === "anime") ? normalizeSeasons(patch.seasons) : [];
  const progress = (type === "series" || type === "anime")
    ? clampSeasonEpisode(seasons, patch.currentSeason ?? patch.season, patch.currentEpisode ?? patch.episode)
    : { season: 0, episode: 0 };

  const it = normalizeItem({
    id: uid(),
    title: patch.title,
    type,
    rating: clamp(patch.rating, 0, 5),
    year: Number(patch.year) || 0,
    genres: Array.isArray(patch.genres) ? patch.genres : [],
    director: patch.director || "",
    cast: Array.isArray(patch.cast) ? patch.cast : [],
    directorData: patch.directorData || null,
    tmdbId: Number(patch.tmdbId) || 0,
    tmdbType: patch.tmdbType || "",
    countryCode: patch.countryCode || "",
    countryEn: patch.countryEn || "",
    countryLabel: patch.countryLabel || "",
    watchlist,
    withLaura: !!patch.withLaura,
    seasons,
    currentSeason: progress.season,
    currentEpisode: progress.episode,
    season: progress.season,
    episode: progress.episode,
    watchDates,
    watchedAt: (watchlist ? 0 : now),
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

  const next = { ...(patch || {}) };
  if (next.watchlist) {
    next.watchDates = [];
    next.watchedAt = 0;
  }
  if (next.type === "movie") {
    next.seasons = [];
    next.currentSeason = 0;
    next.currentEpisode = 0;
  }
  if (next.seasons) next.seasons = normalizeSeasons(next.seasons);
  Object.assign(it, next);
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
let openProgressId = null;

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
        <div class="media-row-progress">
          <button class="media-progress-chip" data-action="progress" type="button">1x01</button>
          <div class="media-progress-stepper" data-role="progress-stepper">
            <button class="media-progress-btn" data-action="progress-dec" type="button">−</button>
            <div class="media-progress-label">S <span data-role="progress-season">1</span> · E <span data-role="progress-ep">1</span></div>
            <button class="media-progress-btn" data-action="progress-inc" type="button">+</button>
            <button class="btn ghost btn-compact media-progress-plus" data-action="progress-plus" type="button">+1</button>
          </div>
        </div>
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

  if (it.watchlist) parts.push("Watchlist");
  if (it.withLaura) parts.push("Laura");

  return parts.length ? parts.join(" · ") : "—";
}

function formatProgress(it) {
  const { season, episode } = getProgress(it);
  return `S${season} · E${episode}`;
}

function stepProgress(it, delta) {
  const seasons = normalizeSeasons(it?.seasons);
  const { season, episode } = getProgress(it);
  if (!seasons.length) {
    return { season, episode: Math.max(1, episode + delta) };
  }

  const idx = seasons.findIndex(s => s.seasonNumber === season);
  const cur = idx >= 0 ? seasons[idx] : seasons[0];
  if (delta > 0) {
    if (episode < cur.episodeCount) return { season: cur.seasonNumber, episode: episode + 1 };
    const next = seasons[idx + 1];
    if (next) return { season: next.seasonNumber, episode: 1 };
    return { season: cur.seasonNumber, episode: cur.episodeCount };
  }

  if (episode > 1) return { season: cur.seasonNumber, episode: episode - 1 };
  const prev = seasons[idx - 1];
  if (prev) return { season: prev.seasonNumber, episode: prev.episodeCount };
  return { season: cur.seasonNumber, episode: 1 };
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

    const progressWrap = row.querySelector(".media-row-progress");
    if (progressWrap) {
      const showProgress = (it.type === "series" || it.type === "anime");
      progressWrap.style.display = showProgress ? "" : "none";
      row.classList.toggle("is-progress-open", showProgress && String(it.id) === String(openProgressId));
      if (showProgress) {
        const chip = progressWrap.querySelector(".media-progress-chip");
        const epLabel = progressWrap.querySelector("[data-role='progress-ep']");
        const seasonLabel = progressWrap.querySelector("[data-role='progress-season']");
        const progress = getProgress(it);
        if (chip) chip.textContent = formatProgress(it);
        if (epLabel) epLabel.textContent = String(progress.episode);
        if (seasonLabel) seasonLabel.textContent = String(progress.season);
      }
    }

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

    if (act === "progress") {
      const it = findItem(id);
      if (!it || (it.type !== "series" && it.type !== "anime")) return;
      openProgressId = (String(openProgressId) === String(id)) ? null : String(id);
      renderVirtual();
      return;
    }

    if (act === "progress-inc" || act === "progress-dec" || act === "progress-plus") {
      const it = findItem(id);
      if (!it || (it.type !== "series" && it.type !== "anime")) return;
      const delta = (act === "progress-dec") ? -1 : 1;
      const next = stepProgress(it, delta);
      updateItem(id, {
        currentSeason: next.season,
        currentEpisode: next.episode,
        season: next.season,
        episode: next.episode
      });
      if (act === "progress-plus") setMediaSub(`+1 episodio · ${formatProgress({ ...it, ...next })}`, 1600);
      return;
    }
  });

  els.itemsHost.addEventListener("click", (e) => {
    if (e.target?.closest?.("[data-action]")) return;
    const row = e.target?.closest?.(".media-row");
    const id = row?.dataset?.id;
    if (!id) return;
    openTitleModal(id);
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
    state.breakdownQuery = "";
    if (els.legendSearch) els.legendSearch.value = "";
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
  const kind = state.chart || "type";
  const query = normKey(state.breakdownQuery);
  const filteredRows = query
    ? rows.filter(r => normKey(r.label).includes(query))
    : rows;

  els.legendMeta.textContent = String(filteredRows.length || 0);

  if (!filteredRows.length || !sum){
    const msg = rows.length ? "Sin resultados." : "Nada que desglosar todavía.";
    els.legendList.innerHTML = `<div style="opacity:.65;font-size:12px;padding:10px 12px">${msg}</div>`;
    if (els.legendMore) els.legendMore.style.display = "none";
    return;
  }

  const limit = Math.min(filteredRows.length, _legendLimit);
  const slice = filteredRows.slice(0, limit);
  if (kind === "year" || kind === "country") scheduleApproxTotals(kind, slice);

  els.legendList.innerHTML = slice.map(r => {
    const name = escHtml(r.label);
    const val = Number(r.value) || 0;
    const pct = fmtPct(val / sum);
    const color = colorForLabel(r.label);
    const canOpen = (kind === "actor" || kind === "director" || kind === "country");
    const rowClasses = `media-legend-row${canOpen ? " is-action" : ""}`;
    let sub = "";
    if (kind === "year" || kind === "country") {
      const watched = Number(r.watchedValue) || 0;
      const type = tmdbTypeForState();
      const value = r.meta || (kind === "year" ? Number(r.label) : "");
      const key = value ? approxTotalsKey(kind, value, type) : "";
      const total = key ? approxTotalsCache.get(key) : null;
      const totalLabel = (total || total === 0) ? total.toLocaleString() : "—";
      const progress = (total || total === 0) ? `${watched.toLocaleString()}/${totalLabel}` : `${watched.toLocaleString()}/—`;
      sub = `<div class="media-legend-sub">Aprox TMDb: ${totalLabel} · Progreso: ${progress}</div>`;
    }
    const action = kind === "country" ? "country" : "entity";
    const codeAttr = kind === "country" ? `data-code="${escHtml(String(r.meta || ""))}"` : "";
    return `
      <div class="${rowClasses}" ${canOpen ? `role="button" tabindex="0" data-action="${action}" data-kind="${kind}" data-label="${name}" ${codeAttr}` : ""}>
        <div class="media-legend-left">
          <span class="media-legend-dot" style="background:${color}"></span>
          <div>
            <div class="media-legend-name" title="${name}">${name}</div>
            ${sub}
          </div>
        </div>
        <div class="media-legend-right">
          <div class="media-legend-pct">${pct}</div>
          <div class="media-legend-val">${val}</div>
        </div>
      </div>
    `;
  }).join("");

  if (els.legendMore) els.legendMore.style.display = (limit < filteredRows.length) ? "" : "none";
}


function computeCounts(kind) {
  const m = new Map();

  const inc = (k, { watched = false, meta = null } = {}) => {
    const key = norm(k);
    if (!key) return;
    const cur = m.get(key) || { label: key, value: 0, watchedValue: 0, meta: null };
    cur.value += 1;
    if (watched) cur.watchedValue += 1;
    if (meta && !cur.meta) cur.meta = meta;
    m.set(key, cur);
  };

  const genderFilter = state.actorGender || "all";

  for (const it of filtered) {
    if (!it) continue;
    const watched = !it.watchlist;

    if (kind === "type") {
      inc(it.type, { watched });
      continue;
    }

    if (kind === "genre") {
      for (const g of (it.genres || [])) inc(g, { watched });
      continue;
    }

    if (kind === "actor") {
      const list = Array.isArray(it.cast) ? it.cast : [];
      for (const entry of list) {
        const normalized = normalizeCastEntry(entry);
        if (!normalized) continue;
        const gender = normalizeGender(normalized.gender);
        if (genderFilter === "male" && gender !== 2) continue;
        if (genderFilter === "female" && gender !== 1) continue;
        if (genderFilter !== "all" && !gender) continue;
        inc(normalized.name, { watched });
      }
      continue;
    }

    if (kind === "director") {
      inc(it.director, { watched });
      continue;
    }

    if (kind === "year") {
      if (it.year) inc(String(it.year), { watched, meta: Number(it.year) || 0 });
      continue;
    }

    if (kind === "country") {
      const label = it.countryLabel || it.countryEn || "";
      if (label) inc(label, { watched, meta: it.countryCode || "" });
      continue;
    }
  }

  const rows = Array.from(m.values())
    .filter(r => r.value > 0)
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));

  return rows;
}

const approxTotalsCache = new Map();
const approxTotalsPending = new Set();

function approxTotalsKey(kind, value, type) {
  return `${kind}|${value}|${type || "all"}`;
}

function tmdbTypeForState() {
  if (state.type === "series" || state.type === "anime") return "tv";
  if (state.type === "movie") return "movie";
  return "all";
}

async function tmdbDiscoverTotal({ kind, value, type }) {
  if (!tmdbEnabled()) return null;
  if (!value) return null;
  const types = type === "all" ? ["movie", "tv"] : [type];

  const results = await Promise.all(types.map(async (t) => {
    const params = { include_adult: false };
    if (kind === "year") {
      if (t === "movie") params.primary_release_year = value;
      else params.first_air_date_year = value;
    } else if (kind === "country") {
      params.with_origin_country = value;
    }
    const endpoint = t === "movie" ? "/discover/movie" : "/discover/tv";
    const data = await tmdbFetch(endpoint, params);
    return Number(data?.total_results) || 0;
  }));
  return results.reduce((acc, n) => acc + n, 0);
}

function scheduleApproxTotals(kind, rows) {
  if (!tmdbEnabled()) return;
  const type = tmdbTypeForState();
  const targetRows = rows.slice(0, 6);
  targetRows.forEach((row) => {
    const value = row.meta || (kind === "year" ? Number(row.label) : "");
    if (!value) return;
    const key = approxTotalsKey(kind, value, type);
    if (approxTotalsCache.has(key) || approxTotalsPending.has(key)) return;
    approxTotalsPending.add(key);
    tmdbDiscoverTotal({ kind, value, type }).then((total) => {
      approxTotalsCache.set(key, Number(total) || 0);
      approxTotalsPending.delete(key);
      renderDonutLegend();
    }).catch(() => {
      approxTotalsCache.set(key, null);
      approxTotalsPending.delete(key);
    });
  });
}

function renderDonut() {
  if (!els.donutHost) return;

  updateActorFilterVisibility();

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
  const map = new Map(); // key (en) -> {en, es, code, value}

  for (const it of filtered) {
    const cc = it.countryCode || "";
    const en = norm(it.countryEn) || (cc ? (_codeToEn.get(cc) || "") : "") || "";
    const es = norm(it.countryLabel) || (cc ? (_codeToEs.get(cc) || "") : "") || "";
    const code = cc || normalizeCountry(es || en || "").code || "";

    const key = en || es;
    if (!key) continue;

    const cur = map.get(key) || { en: en || key, es: es || key, code, value: 0 };
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
    const name = escHtml(String(r.es || r.en || ""));
    const v = Number(r.value) || 0;
    const code = String(r.code || "");
    return `<button class="geo-item" data-action="country" data-code="${code}" data-label="${name}" type="button"><div class="geo-name">${name}</div><div class="geo-count">${v}</div></button>`;
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
        <section class="media-modal-section">
          <div class="media-modal-section-title">Meta</div>
          <label class="media-modal-field">
            <span>Título</span>
            <div class="media-title-row">
              <input id="media-edit-title" class="media-input" autocomplete="off" />
              <button class="btn ghost btn-compact" id="media-edit-autofill-btn" type="button" disabled>Autocompletar</button>
            </div>
          </label>
          <div class="media-autocomplete-results" id="media-edit-autofill-results" aria-live="polite"></div>

          <div class="media-modal-grid media-modal-grid--meta">
            <label class="media-modal-field">
              <span>Tipo</span>
              <select id="media-edit-type" class="media-input">
                <option value="movie">Peli</option>
                <option value="series">Serie</option>
                <option value="anime">Anime</option>
              </select>
            </label>

            <label class="media-modal-field">
              <span>Año</span>
              <input id="media-edit-year" class="media-input" type="number" inputmode="numeric" placeholder="Ej: 2017" />
            </label>

            <label class="media-modal-field">
              <span>Origen</span>
              <input id="media-edit-country" class="media-input" list="country-options" placeholder="País" autocomplete="off" />
            </label>
          </div>
        </section>

        <section class="media-modal-section">
          <div class="media-modal-section-title">Detalles</div>

          <details class="media-modal-accordion" open>
            <summary>Géneros</summary>
            <div class="media-modal-accordion-body">
              <input id="media-edit-genres" class="media-input" placeholder="Acción, Drama…" autocomplete="off" />
              <div class="media-chip-preview" id="media-edit-genres-preview"></div>
            </div>
          </details>

          <details class="media-modal-accordion">
            <summary>Director</summary>
            <div class="media-modal-accordion-body">
              <input id="media-edit-director" class="media-input" placeholder="Nombre" autocomplete="off" />
            </div>
          </details>

          <details class="media-modal-accordion">
            <summary>Reparto</summary>
            <div class="media-modal-accordion-body">
              <input id="media-edit-cast" class="media-input" placeholder="Actores…" autocomplete="off" />
              <div class="media-chip-preview" id="media-edit-cast-preview"></div>
            </div>
          </details>
        </section>

        <section class="media-modal-section" id="media-edit-progress-section">
          <div class="media-modal-section-title">Progreso</div>
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
        </section>

        <section class="media-modal-section">
          <div class="media-modal-section-title">Vistas</div>
          <div class="media-modal-toggles">
            <label class="media-check">
              <input id="media-edit-watchlist" type="checkbox" />
              <span>Watchlist</span>
            </label>
            <label class="media-check">
              <input id="media-edit-laura" type="checkbox" />
              <span>Laura</span>
            </label>
          </div>

          <div class="media-stars-wrap">
            <span class="media-stars-title">Rating</span>
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

          <div class="media-watch-row">
            <button class="btn ghost btn-compact" id="media-edit-watchtoday" type="button">Visto hoy</button>
            <div class="media-watch-meta" id="media-edit-watch-meta">—</div>
          </div>
        </section>
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
  editModal.querySelector("#media-edit-type")?.addEventListener("change", () => {
    const show = ["series", "anime"].includes(qs("media-edit-type")?.value);
    if (!show) editAutofillSeasons = [];
  });

  const editAutofillBtn = editModal.querySelector("#media-edit-autofill-btn");
  const editAutofillResults = editModal.querySelector("#media-edit-autofill-results");
  updateEditAutofillButton = () => {
    const ok = !!norm(qs("media-edit-title")?.value)
      && !!Number(qs("media-edit-year")?.value)
      && !!(qs("media-edit-type")?.value || "");
    if (editAutofillBtn) editAutofillBtn.disabled = !ok;
    if (editAutofillResults) editAutofillResults.innerHTML = "";
  };
  ["input", "change"].forEach(evt => {
    editModal.querySelector("#media-edit-title")?.addEventListener(evt, updateEditAutofillButton);
    editModal.querySelector("#media-edit-year")?.addEventListener(evt, updateEditAutofillButton);
    editModal.querySelector("#media-edit-type")?.addEventListener(evt, updateEditAutofillButton);
  });

  editAutofillBtn?.addEventListener("click", async () => {
    const title = norm(qs("media-edit-title")?.value);
    const year = Number(qs("media-edit-year")?.value) || 0;
    const type = qs("media-edit-type")?.value || "movie";
    if (!title || !year || !tmdbEnabled()) {
      setMediaSub("No se pudo autocompletar", 2400);
      return;
    }
    try {
      editAutofillBusy = true;
      await runTmdbAutofill({
        title,
        year,
        type,
        resultsEl: editAutofillResults,
        apply: (details) => applyAutofillData(details, "edit")
      });
    } catch (e) {
      console.warn("[media] tmdb autocomplete failed", e);
      setMediaSub("No se pudo autocompletar", 2400);
    } finally {
      editAutofillBusy = false;
    }
  });

  editAutofillResults?.addEventListener("click", async (e) => {
    const btn = e.target?.closest?.("[data-action='autofill-select']");
    if (!btn) return;
    const id = Number(btn.dataset.id) || 0;
    const key = editAutofillResults?.dataset?.key;
    const type = editAutofillResults?.dataset?.type || "movie";
    if (!id || !key) return;
    try {
      editAutofillBusy = true;
      await selectTmdbResult(key, id, type, (details) => applyAutofillData(details, "edit"), editAutofillResults);
    } catch (err) {
      console.warn("[media] tmdb select failed", err);
      setMediaSub("No se pudo autocompletar", 2400);
    } finally {
      editAutofillBusy = false;
    }
  });

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

  editModal.querySelector("#media-edit-genres")?.addEventListener("input", () => {
    updateChipPreview(qs("media-edit-genres"), qs("media-edit-genres-preview"));
  });
  editModal.querySelector("#media-edit-cast")?.addEventListener("input", () => {
    updateChipPreview(qs("media-edit-cast"), qs("media-edit-cast-preview"));
  });

  editModal.querySelector("#media-edit-watchlist")?.addEventListener("change", () => {
    const id = editModal.dataset.id;
    const it = findItem(id);
    if (!it) return;
    updateEditWatchMeta({ ...it, watchlist: !!qs("media-edit-watchlist")?.checked });
  });

  editModal.querySelector("#media-edit-watchtoday")?.addEventListener("click", () => {
    const id = editModal.dataset.id;
    const it = findItem(id);
    if (!it) return;
    const watchDates = Array.isArray(it.watchDates) ? it.watchDates.slice() : [];
    watchDates.push(isoDay());
    updateItem(id, { watchlist: false, watchDates });
    const updated = findItem(id);
    updateEditWatchMeta(updated);
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
    const castNamesList = parseCSV(qs("media-edit-cast")?.value);
    const cast = mergeCastMeta(castNamesList, editAutofillMeta?.cast || it.cast);
    const directorData = mergeDirectorMeta(director, editAutofillMeta?.directorData || it.directorData);
    const tmdbId = Number(editAutofillMeta?.tmdbId || it.tmdbId) || 0;
    const tmdbTypeValue = editAutofillMeta?.tmdbType || it.tmdbType || "";

    const cRaw = norm(qs("media-edit-country")?.value);
    const cc = normalizeCountry(cRaw);

    const watchlist = !!qs("media-edit-watchlist")?.checked;
    const withLaura = !!qs("media-edit-laura")?.checked;

    const season = Math.max(1, Number(qs("media-edit-season")?.value) || 1);
    const episode = Math.max(1, Number(qs("media-edit-episode")?.value) || 1);
    const seasons = (type === "series" || type === "anime") ? editAutofillSeasons : [];

    updateItem(id, {
      title,
      type,
      rating,
      year,
      genres,
      director,
      cast,
      directorData,
      tmdbId,
      tmdbType: tmdbTypeValue,
      countryCode: cc.code,
      countryEn: cc.en || cRaw,
      countryLabel: cc.es || cRaw,
      watchlist,
      withLaura,
      seasons,
      currentSeason: season,
      currentEpisode: episode,
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
  const show = (t === "series" || t === "anime");
  wrap.style.display = show ? "" : "none";
  const section = qs("media-edit-progress-section");
  if (section) section.style.display = show ? "" : "none";
}

function openEditModal(id) {
  const it = findItem(id);
  if (!it) return;

  const m = ensureEditModal();
  m.dataset.id = String(id);

  qs("media-edit-title").value = it.title || "";
  qs("media-edit-title").placeholder = it.title || "Título";
  qs("media-edit-type").value = it.type || "movie";
  setEditRating(it.rating || 0);

  qs("media-edit-year").value = it.year ? String(it.year) : "";
  qs("media-edit-year").placeholder = it.year ? String(it.year) : "Ej: 2017";
  qs("media-edit-country").value = it.countryLabel || "";
  qs("media-edit-country").placeholder = it.countryLabel || "País";

  qs("media-edit-genres").value = (it.genres || []).join(", ");
  qs("media-edit-genres").placeholder = (it.genres || []).join(", ") || "Acción, Drama…";
  qs("media-edit-director").value = it.director || "";
  qs("media-edit-director").placeholder = it.director || "Nombre";
  qs("media-edit-cast").value = castNames(it.cast || []).join(", ");
  qs("media-edit-cast").placeholder = castNames(it.cast || []).join(", ") || "Actores…";

  updateChipPreview(qs("media-edit-genres"), qs("media-edit-genres-preview"));
  updateChipPreview(qs("media-edit-cast"), qs("media-edit-cast-preview"));

  qs("media-edit-watchlist").checked = !!it.watchlist;
  qs("media-edit-laura").checked = !!it.withLaura;

  const progress = getProgress(it);
  qs("media-edit-season").value = String(progress.season || 1);
  qs("media-edit-season").placeholder = String(progress.season || 1);
  qs("media-edit-episode").value = String(progress.episode || 1);
  qs("media-edit-episode").placeholder = String(progress.episode || 1);
  editAutofillSeasons = normalizeSeasons(it.seasons);
  editAutofillMeta = {
    tmdbId: Number(it.tmdbId) || 0,
    tmdbType: it.tmdbType || "",
    cast: Array.isArray(it.cast) ? it.cast : [],
    directorData: it.directorData || null
  };

  const editResults = qs("media-edit-autofill-results");
  if (editResults) editResults.innerHTML = "";
  updateEditAutofillButton?.();

  updateEditWatchMeta(it);

  syncEditSeasonEp();

  m.classList.remove("hidden");
}

function hideEditModal() {
  if (!editModal) return;
  editModal.classList.add("hidden");
  editModal.dataset.id = "";
}

/* ------------------------- Entity modal (actor/director) ------------------------- */
let entityModal = null;
const ENTITY_PAGE_SIZE = 24;
const entityState = {
  name: "",
  kind: "actor",
  tmdbId: 0,
  gender: 0,
  credits: [],
  localItems: [],
  unseenCredits: [],
  page: 1,
  collabMode: "actors",
  search: ""
};

function entityStorageKey() {
  const base = entityState.tmdbId ? `tmdb:${entityState.tmdbId}` : `name:${normKey(entityState.name)}`;
  return `mediaEntity:${entityState.kind}:${base}`;
}

function readEntityAccordionState() {
  try {
    const raw = localStorage.getItem(entityStorageKey());
    if (!raw) return { seen: true, unseen: false };
    const parsed = JSON.parse(raw);
    return {
      seen: typeof parsed?.seen === "boolean" ? parsed.seen : true,
      unseen: typeof parsed?.unseen === "boolean" ? parsed.unseen : false
    };
  } catch (e) {
    return { seen: true, unseen: false };
  }
}

function countryStorageKey() {
  const base = countryState.code || normKey(countryState.label || "");
  return `mediaCountry:${base || "unknown"}`;
}

function readCountryAccordionState() {
  try {
    const raw = localStorage.getItem(countryStorageKey());
    if (!raw) return { seen: true, suggest: false };
    const parsed = JSON.parse(raw);
    return {
      seen: typeof parsed?.seen === "boolean" ? parsed.seen : true,
      suggest: typeof parsed?.suggest === "boolean" ? parsed.suggest : false
    };
  } catch (e) {
    return { seen: true, suggest: false };
  }
}

function writeCountryAccordionState(state) {
  try {
    localStorage.setItem(countryStorageKey(), JSON.stringify(state));
  } catch (e) {
    /* noop */
  }
}

function writeEntityAccordionState(state) {
  try {
    localStorage.setItem(entityStorageKey(), JSON.stringify(state));
  } catch (e) {
    /* noop */
  }
}

function ensureEntityModal() {
  if (entityModal) return entityModal;

  entityModal = document.createElement("div");
  entityModal.className = "media-modal hidden";
  entityModal.innerHTML = `
    <div class="media-modal-backdrop" data-action="close"></div>
    <div class="media-modal-sheet" role="dialog" aria-modal="true" aria-label="Ficha de entidad">
      <div class="media-modal-head">
        <div class="media-modal-headtext">
          <div class="media-modal-title" id="media-entity-title">—</div>
          <div class="media-modal-sub" id="media-entity-sub">—</div>
        </div>
        <button class="media-modal-close" data-action="close" type="button" title="Cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="media-modal-body">
        <section class="media-modal-section">
          <div class="media-entity-progress">
            <div class="media-entity-progress-row">
              <span>Progreso</span>
              <div class="media-entity-item-sub media-entity-progress-label" id="media-entity-progress-label">—</div>
            </div>
            <div class="media-entity-bar"><div class="media-entity-bar-fill" id="media-entity-progress-bar"></div></div>
          </div>
        </section>
        <div class="media-entity-search">
          <button class="btn ghost btn-compact" id="media-entity-search-toggle" type="button">Buscar en esta ficha…</button>
          <input class="media-input" id="media-entity-search-input" type="search" placeholder="Buscar en vistos y no vistos" autocomplete="off" />
        </div>
        <details class="media-modal-section media-entity-accordion" id="media-entity-seen-section" open>
          <summary class="media-entity-accordion-summary">
            <span>Vistos</span>
            <span class="media-entity-accordion-count" id="media-entity-seen-count">0</span>
          </summary>
          <div class="media-entity-list" id="media-entity-seen"></div>
        </details>
        <details class="media-modal-section media-entity-accordion" id="media-entity-unseen-section">
          <summary class="media-entity-accordion-summary">
            <span>No vistos</span>
            <span class="media-entity-accordion-count" id="media-entity-unseen-count">0</span>
          </summary>
          <div class="media-entity-list" id="media-entity-unseen"></div>
          <button class="btn ghost btn-compact" id="media-entity-more" type="button" style="display:none">Cargar más</button>
        </details>
        <section class="media-modal-section">
          <div class="media-modal-section-title">Colabora más con…</div>
          <div class="media-entity-toggle" id="media-entity-collab-toggle" style="display:none">
            <button class="btn ghost btn-compact" data-mode="actors" type="button">Actores</button>
            <button class="btn ghost btn-compact" data-mode="directors" type="button">Directores</button>
          </div>
          <div class="media-entity-collab-list" id="media-entity-collab-list"></div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(entityModal);

  entityModal.addEventListener("click", (e) => {
    const act = e.target?.dataset?.action;
    if (act === "close") hideEntityModal();
    if (act === "add") {
      const id = Number(e.target?.dataset?.tmdbId) || 0;
      const mediaType = e.target?.dataset?.mediaType || "";
      const key = e.target?.dataset?.key || "";
      if (!id || !mediaType || !key) return;
      const credit = entityState.unseenCredits.find(c => c.key === key);
      if (credit) addItemFromCredit(credit);
    }
    if (act === "open-title") {
      const id = e.target?.dataset?.id || e.target?.closest?.("[data-id]")?.dataset?.id;
      if (id) openTitleModal(id);
    }
  });

  entityModal.querySelector("#media-entity-search-toggle")?.addEventListener("click", () => {
    const input = entityModal.querySelector("#media-entity-search-input");
    if (!input) return;
    input.classList.toggle("is-visible");
    if (input.classList.contains("is-visible")) {
      input.focus();
    } else {
      entityState.search = "";
      input.value = "";
      renderEntityLists();
    }
  });

  entityModal.querySelector("#media-entity-search-input")?.addEventListener("input", (e) => {
    entityState.search = e.target?.value || "";
    renderEntityLists();
  });

  ["media-entity-seen-section", "media-entity-unseen-section"].forEach(id => {
    entityModal.querySelector(`#${id}`)?.addEventListener("toggle", () => {
      const seenOpen = !!entityModal.querySelector("#media-entity-seen-section")?.open;
      const unseenOpen = !!entityModal.querySelector("#media-entity-unseen-section")?.open;
      writeEntityAccordionState({ seen: seenOpen, unseen: unseenOpen });
    });
  });

  entityModal.querySelector("#media-entity-more")?.addEventListener("click", () => {
    entityState.page += 1;
    renderEntityLists();
  });

  entityModal.querySelector("#media-entity-collab-toggle")?.addEventListener("click", (e) => {
    const btn = e.target?.closest?.("[data-mode]");
    if (!btn) return;
    entityState.collabMode = btn.dataset.mode || "actors";
    renderEntityCollabs();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && entityModal && !entityModal.classList.contains("hidden")) hideEntityModal();
  });

  return entityModal;
}

function hideEntityModal() {
  if (!entityModal) return;
  entityModal.classList.add("hidden");
}

function entityRoleLabel(kind, gender) {
  if (kind === "director") return "Director";
  if (gender === 1) return "Actriz";
  if (gender === 2) return "Actor";
  return "Actor/Actriz";
}

function typeLabelForItem(it) {
  if (it.type === "series") return "Serie";
  if (it.type === "anime") return "Anime";
  return "Peli";
}

function findEntityMetaFromItems(name, kind) {
  const key = normKey(name);
  let gender = 0;
  let tmdbId = 0;
  for (const it of filtered) {
    if (!it) continue;
    if (kind === "actor") {
      const list = Array.isArray(it.cast) ? it.cast : [];
      for (const entry of list) {
        const normalized = normalizeCastEntry(entry);
        if (!normalized) continue;
        if (normKey(normalized.name) !== key) continue;
        if (!tmdbId && normalized.tmdbId) tmdbId = normalized.tmdbId;
        if (!gender && normalized.gender) gender = normalized.gender;
      }
    } else if (kind === "director") {
      if (normKey(it.director) !== key) continue;
      if (!tmdbId && it.directorData?.tmdbId) tmdbId = it.directorData.tmdbId;
      if (!gender && it.directorData?.gender) gender = it.directorData.gender;
    }
  }
  return { gender, tmdbId };
}

function getEntityLocalItems(name, kind, tmdbId = 0) {
  const key = normKey(name);
  return items.filter(it => {
    if (!it) return false;
    if (kind === "actor") {
      const list = Array.isArray(it.cast) ? it.cast : [];
      return list.some(entry => {
        const normalized = normalizeCastEntry(entry);
        if (!normalized) return false;
        if (tmdbId && normalized.tmdbId === tmdbId) return true;
        return normKey(normalized.name) === key;
      });
    }
    if (kind === "director") {
      if (tmdbId && it.directorData?.tmdbId === tmdbId) return true;
      return normKey(it.director) === key;
    }
    return false;
  });
}

function getSeenMovieIds() {
  const seen = new Set();
  items.forEach(it => {
    if (!it || it.watchlist) return;
    if (!it.tmdbId) return;
    const isMovie = it.tmdbType === "movie" || it.type === "movie";
    if (!isMovie) return;
    seen.add(Number(it.tmdbId));
  });
  return seen;
}

function updateItemsWithPersonGender(tmdbId, gender) {
  const g = normalizeGender(gender);
  if (!tmdbId || !g) return;
  const updates = [];
  items.forEach(it => {
    if (!it) return;
    let changed = false;
    let cast = Array.isArray(it.cast) ? it.cast : [];
    if (cast.length) {
      const nextCast = cast.map(entry => {
        const normalized = normalizeCastEntry(entry);
        if (!normalized) return entry;
        if (normalized.tmdbId === tmdbId && !normalizeGender(normalized.gender)) {
          changed = true;
          return { ...normalized, gender: g };
        }
        return entry;
      });
      if (changed) cast = nextCast;
    }
    let directorData = it.directorData || null;
    if (directorData?.tmdbId === tmdbId && !normalizeGender(directorData.gender)) {
      directorData = { ...directorData, gender: g };
      changed = true;
    }
    if (changed) updates.push({ id: it.id, cast, directorData });
  });
  updates.forEach(u => updateItem(u.id, { cast: u.cast, directorData: u.directorData }));
}

async function tmdbSearchPerson(name) {
  if (!tmdbEnabled()) return null;
  const data = await tmdbFetch("/search/person", { query: name, language: "es-ES" });
  const first = Array.isArray(data?.results) ? data.results[0] : null;
  if (!first?.id) return null;
  const gender = normalizeGender(first.gender);
  if (gender) setCachedPersonGender(Number(first.id) || 0, gender);
  return {
    tmdbId: Number(first.id) || 0,
    gender
  };
}

async function tmdbFetchPersonCredits(id) {
  if (!tmdbEnabled()) return { credits: [], gender: 0 };
  const cached = getCachedPersonCredits(id);
  if (cached) return cached;
  if (personCreditsPending.has(id)) return personCreditsPending.get(id);

  const promise = Promise.all([
    tmdbFetch(`/person/${id}`, { language: "es-ES" }),
    tmdbFetch(`/person/${id}/movie_credits`, { language: "es-ES" })
  ]).then(([person, credits]) => {
    const payload = { credits, gender: normalizeGender(person?.gender) };
    setCachedPersonCredits(id, payload);
    if (payload.gender) setCachedPersonGender(id, payload.gender);
    personCreditsPending.delete(id);
    return payload;
  }).catch((e) => {
    personCreditsPending.delete(id);
    throw e;
  });

  personCreditsPending.set(id, promise);
  return promise;
}

async function tmdbFetchPersonGender(id) {
  if (!tmdbEnabled() || !id) return 0;
  const cached = getCachedPersonGender(id);
  if (cached) return cached;
  if (personGenderPending.has(id)) return personGenderPending.get(id);

  const promise = tmdbFetch(`/person/${id}`, { language: "es-ES" })
    .then((person) => {
      const gender = normalizeGender(person?.gender);
      if (gender) setCachedPersonGender(id, gender);
      personGenderPending.delete(id);
      return gender;
    }).catch(() => {
      personGenderPending.delete(id);
      return 0;
    });

  personGenderPending.set(id, promise);
  return promise;
}

function normalizeCredits(raw, kind) {
  const list = kind === "director"
    ? (Array.isArray(raw?.crew) ? raw.crew.filter(c => c?.job === "Director") : [])
    : (Array.isArray(raw?.cast) ? raw.cast : []);
  const map = new Map();
  for (const c of list) {
    if (c?.adult === true || c?.video === true) continue;
    const id = Number(c?.id) || 0;
    const title = c?.title || c?.name || "";
    if (!id || !title) continue;
    const year = Number(String(c?.release_date || "").slice(0, 4)) || 0;
    const key = `movie|${id}`;
    if (map.has(key)) continue;
    map.set(key, {
      key,
      tmdbId: id,
      mediaType: "movie",
      title,
      year
    });
  }
  return Array.from(map.values()).sort((a, b) => (b.year - a.year) || a.title.localeCompare(b.title, "es"));
}

async function openEntityModal({ name, kind }) {
  const modal = ensureEntityModal();
  entityState.name = name;
  entityState.kind = kind;
  entityState.page = 1;
  entityState.credits = [];
  entityState.localItems = [];
  entityState.unseenCredits = [];
  entityState.collabMode = "actors";
  entityState.search = "";

  const meta = findEntityMetaFromItems(name, kind);
  entityState.gender = meta.gender;
  entityState.tmdbId = meta.tmdbId;
  if (!entityState.gender && entityState.tmdbId) {
    const cachedGender = getCachedPersonGender(entityState.tmdbId);
    if (cachedGender) entityState.gender = cachedGender;
  }

  const titleEl = modal.querySelector("#media-entity-title");
  const subEl = modal.querySelector("#media-entity-sub");
  if (titleEl) titleEl.textContent = name || "—";
  if (subEl) subEl.textContent = entityRoleLabel(kind, meta.gender);

  const searchInput = modal.querySelector("#media-entity-search-input");
  if (searchInput) {
    searchInput.value = "";
    searchInput.classList.remove("is-visible");
  }

  modal.classList.remove("hidden");

  renderEntityLoading();

  let tmdbId = meta.tmdbId;
  try {
    if (!tmdbId && tmdbEnabled()) {
      const search = await tmdbSearchPerson(name);
      tmdbId = search?.tmdbId || 0;
      if (!entityState.gender && search?.gender) entityState.gender = search.gender;
    }

    if (tmdbId) {
      entityState.tmdbId = tmdbId;
      const fetched = await tmdbFetchPersonCredits(tmdbId);
      if (!entityState.gender && fetched.gender) entityState.gender = fetched.gender;
      entityState.credits = normalizeCredits(fetched.credits, kind);
      if (fetched.gender) updateItemsWithPersonGender(tmdbId, fetched.gender);
    }
  } catch (e) {
    console.warn("[media] entity fetch failed", e);
  }

  if (tmdbId && !entityState.gender && tmdbEnabled()) {
    const gender = await tmdbFetchPersonGender(tmdbId);
    if (gender) {
      entityState.gender = gender;
      updateItemsWithPersonGender(tmdbId, gender);
    }
  }

  entityState.localItems = getEntityLocalItems(name, kind, entityState.tmdbId);
  const seenSet = getSeenMovieIds();
  entityState.unseenCredits = entityState.credits.filter(c => !seenSet.has(c.tmdbId));

  const accordions = readEntityAccordionState();
  const seenSection = modal.querySelector("#media-entity-seen-section");
  const unseenSection = modal.querySelector("#media-entity-unseen-section");
  if (seenSection) seenSection.open = accordions.seen;
  if (unseenSection) unseenSection.open = accordions.unseen;

  renderEntityModal();
}

function renderEntityLoading() {
  const progressEl = entityModal?.querySelector("#media-entity-progress-label");
  const barEl = entityModal?.querySelector("#media-entity-progress-bar");
  if (progressEl) progressEl.textContent = "Cargando…";
  if (barEl) barEl.style.width = "0%";
}

function renderEntityModal() {
  const modal = entityModal;
  if (!modal) return;
  const titleEl = modal.querySelector("#media-entity-title");
  const subEl = modal.querySelector("#media-entity-sub");
  if (titleEl) titleEl.textContent = entityState.name || "—";
  if (subEl) subEl.textContent = entityRoleLabel(entityState.kind, entityState.gender);

  const seenItems = entityState.localItems.filter(it => !it.watchlist);
  const total = entityState.credits.length;
  const progressEl = modal.querySelector("#media-entity-progress-label");
  const barEl = modal.querySelector("#media-entity-progress-bar");
  if (progressEl) {
    if (!tmdbEnabled()) {
      progressEl.textContent = "TMDb no disponible";
    } else if (total) {
      const pct = Math.min(100, Math.round((seenItems.length / total) * 100));
      progressEl.textContent = `${seenItems.length.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`;
    } else {
      progressEl.textContent = "0 / 0 (0%)";
    }
  }
  if (barEl) barEl.style.width = (total && tmdbEnabled())
    ? `${Math.min(100, Math.round((seenItems.length / total) * 100))}%`
    : "0%";

  renderEntityLists();
  renderEntityCollabs();
}

function renderEntityLists() {
  const modal = entityModal;
  if (!modal) return;
  const seenEl = modal.querySelector("#media-entity-seen");
  const unseenEl = modal.querySelector("#media-entity-unseen");
  const moreBtn = modal.querySelector("#media-entity-more");
  const seenCountEl = modal.querySelector("#media-entity-seen-count");
  const unseenCountEl = modal.querySelector("#media-entity-unseen-count");

  const query = normKey(entityState.search || "");
  const matchesQuery = (title = "") => (query ? normKey(title).includes(query) : true);
  const seenItems = entityState.localItems.filter(it => !it.watchlist);
  const filteredSeen = seenItems.filter(it => matchesQuery(it.title || ""));
  if (seenCountEl) seenCountEl.textContent = String(seenItems.length);
  if (unseenCountEl) unseenCountEl.textContent = tmdbEnabled() ? String(entityState.unseenCredits.length) : "—";

  if (seenEl) {
    if (!filteredSeen.length) {
      seenEl.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">${query ? "Sin resultados." : "Aún no hay vistos."}</div>`;
    } else {
      seenEl.innerHTML = filteredSeen.map(it => `
        <button class="media-entity-item" data-action="open-title" data-id="${it.id}" type="button">
          <div class="media-entity-item-main">
            <div class="media-entity-item-title">${escHtml(it.title || "—")}</div>
            <div class="media-entity-item-sub">${it.year || "—"} · ${typeLabelForItem(it)}</div>
          </div>
        </button>
      `).join("");
    }
  }

  if (unseenEl) {
    if (!tmdbEnabled()) {
      unseenEl.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">TMDb no disponible.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      return;
    }
    if (!entityState.unseenCredits.length) {
      unseenEl.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">No hay más títulos en TMDb.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      return;
    }
    const unseenFiltered = entityState.unseenCredits.filter(c => matchesQuery(c.title || ""));
    if (!unseenFiltered.length) {
      unseenEl.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">Sin resultados.</div>`;
      if (moreBtn) moreBtn.style.display = "none";
      return;
    }
    const slice = unseenFiltered.slice(0, entityState.page * ENTITY_PAGE_SIZE);
    unseenEl.innerHTML = slice.map(c => `
      <div class="media-entity-item">
        <div class="media-entity-item-main">
          <div class="media-entity-item-title">${escHtml(c.title)}</div>
          <div class="media-entity-item-sub">${c.year || "—"} · ${c.mediaType === "tv" ? "Serie" : "Peli"}</div>
        </div>
        <button class="btn ghost btn-compact" data-action="add" data-key="${c.key}" data-tmdb-id="${c.tmdbId}" data-media-type="${c.mediaType}" type="button">Añadir</button>
      </div>
    `).join("");
    if (moreBtn) moreBtn.style.display = (slice.length < unseenFiltered.length) ? "" : "none";
  }
}

function computeCollaborations() {
  const seenItems = entityState.localItems.filter(it => !it.watchlist);
  const total = seenItems.length || 0;
  const counts = new Map();
  const isActor = entityState.kind === "actor";

  if (!total) return { total: 0, rows: [] };

  seenItems.forEach(it => {
    if (isActor) {
      const castList = Array.isArray(it.cast) ? it.cast : [];
      castList.forEach(entry => {
        const normalized = normalizeCastEntry(entry);
        if (!normalized?.name) return;
        if (normKey(normalized.name) === normKey(entityState.name)) return;
        const key = `actor|${normalized.name}`;
        const cur = counts.get(key) || { name: normalized.name, role: "actor", count: 0 };
        cur.count += 1;
        counts.set(key, cur);
      });
      if (it.director) {
        const key = `director|${it.director}`;
        const cur = counts.get(key) || { name: it.director, role: "director", count: 0 };
        cur.count += 1;
        counts.set(key, cur);
      }
    } else {
      const castList = Array.isArray(it.cast) ? it.cast : [];
      castList.forEach(entry => {
        const normalized = normalizeCastEntry(entry);
        if (!normalized?.name) return;
        const key = `actor|${normalized.name}`;
        const cur = counts.get(key) || { name: normalized.name, role: "actor", count: 0 };
        cur.count += 1;
        counts.set(key, cur);
      });
    }
  });

  const rows = Array.from(counts.values())
    .filter(r => r.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es"));

  return { total, rows };
}

function renderEntityCollabs() {
  const modal = entityModal;
  if (!modal) return;
  const listEl = modal.querySelector("#media-entity-collab-list");
  const toggleEl = modal.querySelector("#media-entity-collab-toggle");

  const { total, rows } = computeCollaborations();
  if (toggleEl) {
    toggleEl.style.display = (entityState.kind === "actor") ? "" : "none";
    if (entityState.kind === "actor") {
      toggleEl.querySelectorAll("button").forEach(btn => {
        btn.classList.toggle("primary", btn.dataset.mode === entityState.collabMode);
      });
    }
  }

  if (!listEl) return;
  if (!total || !rows.length) {
    listEl.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">Sin datos aún.</div>`;
    return;
  }

  const filteredRows = entityState.kind === "actor"
    ? rows.filter(r => (entityState.collabMode === "directors" ? r.role === "director" : r.role === "actor"))
    : rows;

  const top = filteredRows.slice(0, 8);
  if (!top.length) {
    listEl.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">Sin coincidencias.</div>`;
    return;
  }
  listEl.innerHTML = top.map(r => {
    const pct = fmtPct(r.count / total);
    return `
      <div class="media-entity-collab">
        <div>${escHtml(r.name)}</div>
        <span>${pct} (${r.count} de ${total})</span>
      </div>
    `;
  }).join("");
}

async function addItemFromCredit(credit) {
  if (!credit || !tmdbEnabled()) return;
  try {
    const type = credit.mediaType === "tv" ? "series" : "movie";
    const details = await tmdbFetchDetails(credit.tmdbId, type);
    const cc = normalizeCountry(details.country || "");
    const seasons = normalizeSeasons(details.seasons);
    addItem({
      title: credit.title,
      type,
      rating: 0,
      year: credit.year || 0,
      genres: details.genres || [],
      director: details.director || "",
      directorData: details.directorData || null,
      cast: Array.isArray(details.cast) ? details.cast : [],
      tmdbId: details.tmdbId || credit.tmdbId,
      tmdbType: details.tmdbType || credit.mediaType,
      countryCode: cc.code,
      countryEn: cc.en || "",
      countryLabel: cc.es || "",
      watchlist: true,
      withLaura: false,
      seasons,
      season: 1,
      episode: 1,
      currentSeason: 1,
      currentEpisode: 1,
      watchDates: []
    });
    entityState.unseenCredits = entityState.unseenCredits.filter(c => c.key !== credit.key);
    renderEntityModal();
  } catch (e) {
    console.warn("[media] add from credit failed", e);
    setMediaSub("No se pudo crear la ficha", 2400);
  }
}

/* ------------------------- Title modal ------------------------- */
let titleModal = null;
const titleState = {
  id: "",
  item: null
};

function ensureTitleModal() {
  if (titleModal) return titleModal;

  titleModal = document.createElement("div");
  titleModal.className = "media-modal hidden";
  titleModal.innerHTML = `
    <div class="media-modal-backdrop" data-action="close"></div>
    <div class="media-modal-sheet" role="dialog" aria-modal="true" aria-label="Ficha de título">
      <div class="media-modal-head">
        <div class="media-modal-headtext">
          <div class="media-modal-title" id="media-title-name">—</div>
          <div class="media-modal-sub" id="media-title-sub">—</div>
        </div>
        <button class="media-modal-close" data-action="close" type="button" title="Cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="media-modal-body">
        <section class="media-modal-section media-title-kpis">
          <div class="media-title-kpi">
            <span>Rating</span>
            <strong id="media-title-rating">—</strong>
          </div>
          <div class="media-title-kpi">
            <span>Watchlist</span>
            <strong id="media-title-watchlist">—</strong>
          </div>
          <div class="media-title-kpi">
            <span>Laura</span>
            <strong id="media-title-laura">—</strong>
          </div>
          <button class="btn ghost btn-compact media-title-edit" data-action="edit" type="button">Editar</button>
        </section>
        <section class="media-modal-section">
          <div class="media-modal-section-title">País</div>
          <div class="media-chip-row" id="media-title-country"></div>
        </section>
        <section class="media-modal-section">
          <div class="media-modal-section-title">Géneros</div>
          <div class="media-chip-row" id="media-title-genres"></div>
        </section>
        <section class="media-modal-section">
          <div class="media-modal-section-title">Director</div>
          <div class="media-chip-row" id="media-title-director"></div>
        </section>
        <section class="media-modal-section">
          <div class="media-modal-section-title">Reparto</div>
          <div class="media-chip-row" id="media-title-cast"></div>
        </section>
      </div>
    </div>
  `;

  document.body.appendChild(titleModal);

  titleModal.addEventListener("click", (e) => {
    const act = e.target?.dataset?.action;
    if (act === "close") hideTitleModal();
    if (act === "edit" && titleState.id) {
      hideTitleModal();
      openEditModal(titleState.id);
    }
    if (act === "entity") {
      const name = e.target?.dataset?.name || "";
      const kind = e.target?.dataset?.kind || "";
      if (!name || (kind !== "actor" && kind !== "director")) return;
      hideTitleModal();
      openEntityModal({ name, kind });
    }
    if (act === "country") {
      const code = e.target?.dataset?.code || "";
      const label = e.target?.dataset?.label || "";
      hideTitleModal();
      openCountryModal({ code, label });
    }
    if (act === "genre") {
      const genre = e.target?.dataset?.label || "";
      if (!genre) return;
      hideTitleModal();
      applyQuickFilter(genre);
    }
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && titleModal && !titleModal.classList.contains("hidden")) hideTitleModal();
  });

  return titleModal;
}

function hideTitleModal() {
  if (!titleModal) return;
  titleModal.classList.add("hidden");
}

function applyQuickFilter(text) {
  const q = norm(text);
  state.q = q;
  if (els.search) els.search.value = q;
  state.view = "list";
  setActiveViewBtns();
  renderViewVisibility();
  refresh();
}

function renderTitleModal() {
  if (!titleModal || !titleState.item) return;
  const it = titleState.item;
  const typeLabel = typeLabelForItem(it);
  const titleEl = titleModal.querySelector("#media-title-name");
  const subEl = titleModal.querySelector("#media-title-sub");
  if (titleEl) titleEl.textContent = it.title || "—";
  if (subEl) subEl.textContent = [it.year || "—", typeLabel].join(" · ");

  const ratingEl = titleModal.querySelector("#media-title-rating");
  const watchlistEl = titleModal.querySelector("#media-title-watchlist");
  const lauraEl = titleModal.querySelector("#media-title-laura");
  if (ratingEl) ratingEl.textContent = it.rating ? `${it.rating}/5` : "—";
  if (watchlistEl) watchlistEl.textContent = it.watchlist ? "Sí" : "No";
  if (lauraEl) lauraEl.textContent = it.withLaura ? "Sí" : "No";

  const countryWrap = titleModal.querySelector("#media-title-country");
  const genresWrap = titleModal.querySelector("#media-title-genres");
  const directorWrap = titleModal.querySelector("#media-title-director");
  const castWrap = titleModal.querySelector("#media-title-cast");

  if (countryWrap) {
    const label = it.countryLabel || it.countryEn || "";
    const code = it.countryCode || normalizeCountry(label).code || "";
    countryWrap.innerHTML = label
      ? `<button class="media-chip" data-action="country" data-code="${escHtml(code)}" data-label="${escHtml(label)}" type="button">${escHtml(label)}</button>`
      : `<span class="media-chip is-muted">—</span>`;
  }

  if (genresWrap) {
    const genres = Array.isArray(it.genres) ? it.genres : [];
    genresWrap.innerHTML = genres.length
      ? genres.map(g => `<button class="media-chip" data-action="genre" data-label="${escHtml(g)}" type="button">${escHtml(g)}</button>`).join("")
      : `<span class="media-chip is-muted">—</span>`;
  }

  if (directorWrap) {
    const name = norm(it.director);
    directorWrap.innerHTML = name
      ? `<button class="media-chip" data-action="entity" data-kind="director" data-name="${escHtml(name)}" type="button">${escHtml(name)}</button>`
      : `<span class="media-chip is-muted">—</span>`;
  }

  if (castWrap) {
    const cast = Array.isArray(it.cast) ? it.cast : [];
    const names = cast.map(entry => normalizeCastEntry(entry)).filter(Boolean).map(entry => entry.name);
    castWrap.innerHTML = names.length
      ? names.map(name => `<button class="media-chip" data-action="entity" data-kind="actor" data-name="${escHtml(name)}" type="button">${escHtml(name)}</button>`).join("")
      : `<span class="media-chip is-muted">—</span>`;
  }
}

function openTitleModal(id) {
  const it = findItem(id);
  if (!it) return;
  const modal = ensureTitleModal();
  titleState.id = String(it.id);
  titleState.item = it;
  renderTitleModal();
  modal.classList.remove("hidden");
}

/* ------------------------- Country modal ------------------------- */
let countryModal = null;
const countryState = {
  code: "",
  label: "",
  total: null,
  suggestions: [],
  page: 1,
  totalPages: 0,
  loading: false
};

function ensureCountryModal() {
  if (countryModal) return countryModal;

  countryModal = document.createElement("div");
  countryModal.className = "media-modal hidden";
  countryModal.innerHTML = `
    <div class="media-modal-backdrop" data-action="close"></div>
    <div class="media-modal-sheet" role="dialog" aria-modal="true" aria-label="Ficha de país">
      <div class="media-modal-head">
        <div class="media-modal-headtext">
          <div class="media-modal-title" id="media-country-title">—</div>
          <div class="media-modal-sub">Ficha de país</div>
        </div>
        <button class="media-modal-close" data-action="close" type="button" title="Cerrar" aria-label="Cerrar">✕</button>
      </div>
      <div class="media-modal-body">
        <section class="media-modal-section">
          <div class="media-entity-progress media-country-progress">
            <div class="media-entity-progress-row">
              <span>Progreso</span>
              <div class="media-entity-item-sub media-entity-progress-label" id="media-country-progress-label">—</div>
            </div>
            <div class="media-entity-bar"><div class="media-entity-bar-fill" id="media-country-progress-bar"></div></div>
          </div>
        </section>
        <details class="media-modal-section media-entity-accordion" id="media-country-seen-section" open>
          <summary class="media-entity-accordion-summary">
            <span>Vistas</span>
            <span class="media-entity-accordion-count" id="media-country-seen-count">0</span>
          </summary>
          <div class="media-entity-list" id="media-country-seen"></div>
        </details>
        <details class="media-modal-section media-entity-accordion" id="media-country-suggest-section">
          <summary class="media-entity-accordion-summary">
            <span>Sugerencias</span>
            <span class="media-entity-accordion-count" id="media-country-suggest-count">0</span>
          </summary>
          <div class="media-entity-list" id="media-country-suggest"></div>
          <button class="btn ghost btn-compact" id="media-country-more" type="button" style="display:none">Cargar más</button>
        </details>
      </div>
    </div>
  `;

  document.body.appendChild(countryModal);

  countryModal.addEventListener("click", (e) => {
    const act = e.target?.dataset?.action;
    if (act === "close") hideCountryModal();
    if (act === "add") {
      const id = Number(e.target?.dataset?.tmdbId) || 0;
      if (!id) return;
      addItemFromTmdbMovie(id);
    }
    if (act === "open-title") {
      const id = e.target?.dataset?.id || "";
      if (id) openTitleModal(id);
    }
  });

  countryModal.querySelector("#media-country-more")?.addEventListener("click", () => {
    if (countryState.loading) return;
    countryState.page += 1;
    fetchCountrySuggestions();
  });

  ["media-country-seen-section", "media-country-suggest-section"].forEach(id => {
    countryModal.querySelector(`#${id}`)?.addEventListener("toggle", () => {
      const seenOpen = !!countryModal.querySelector("#media-country-seen-section")?.open;
      const suggestOpen = !!countryModal.querySelector("#media-country-suggest-section")?.open;
      writeCountryAccordionState({ seen: seenOpen, suggest: suggestOpen });
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && countryModal && !countryModal.classList.contains("hidden")) hideCountryModal();
  });

  return countryModal;
}

function hideCountryModal() {
  if (!countryModal) return;
  countryModal.classList.add("hidden");
}

function countryLabelFromCode(code, fallback = "") {
  if (!code) return fallback || "—";
  return _codeToEs.get(code) || _codeToEn.get(code) || fallback || code;
}

function renderCountryModal() {
  if (!countryModal) return;
  const titleEl = countryModal.querySelector("#media-country-title");
  if (titleEl) titleEl.textContent = countryState.label || "—";

  const progressEl = countryModal.querySelector("#media-country-progress-label");
  const barEl = countryModal.querySelector("#media-country-progress-bar");
  const seenList = countryModal.querySelector("#media-country-seen");
  const seenCount = countryModal.querySelector("#media-country-seen-count");
  const suggestList = countryModal.querySelector("#media-country-suggest");
  const suggestCount = countryModal.querySelector("#media-country-suggest-count");
  const moreBtn = countryModal.querySelector("#media-country-more");

  const seenItems = items.filter(it => !it.watchlist && it.countryCode === countryState.code);
  const total = (countryState.total || countryState.total === 0) ? Number(countryState.total) : 0;
  if (progressEl) {
    if (!tmdbEnabled()) {
      progressEl.textContent = "TMDb no disponible";
    } else if (total) {
      const pct = Math.min(100, Math.round((seenItems.length / total) * 100));
      progressEl.textContent = `${seenItems.length.toLocaleString()} / ${total.toLocaleString()} (${pct}%)`;
    } else {
      progressEl.textContent = "0 / 0 (0%)";
    }
  }
  if (barEl) barEl.style.width = (total && tmdbEnabled())
    ? `${Math.min(100, Math.round((seenItems.length / total) * 100))}%`
    : "0%";
  if (seenCount) seenCount.textContent = String(seenItems.length);

  if (seenList) {
    seenList.innerHTML = seenItems.length
      ? seenItems.map(it => `
          <button class="media-entity-item" data-action="open-title" data-id="${it.id}" type="button">
            <div class="media-entity-item-main">
              <div class="media-entity-item-title">${escHtml(it.title || "—")}</div>
              <div class="media-entity-item-sub">${it.year || "—"} · ${typeLabelForItem(it)}</div>
            </div>
          </button>
        `).join("")
      : `<div style="opacity:.65;font-size:12px;padding:4px 2px">Aún no hay vistos.</div>`;
  }

  if (!tmdbEnabled()) {
    if (suggestList) suggestList.innerHTML = `<div style="opacity:.65;font-size:12px;padding:4px 2px">TMDb no disponible.</div>`;
    if (suggestCount) suggestCount.textContent = "—";
    if (moreBtn) moreBtn.style.display = "none";
    return;
  }

  if (suggestCount) suggestCount.textContent = String(countryState.suggestions.length);
  if (suggestList) {
    suggestList.innerHTML = countryState.suggestions.length
      ? countryState.suggestions.map(c => `
          <div class="media-entity-item">
            <div class="media-entity-item-main">
              <div class="media-entity-item-title">${escHtml(c.title || "—")}</div>
              <div class="media-entity-item-sub">${c.year || "—"} · Peli</div>
            </div>
            <button class="btn ghost btn-compact" data-action="add" data-tmdb-id="${c.tmdbId}" type="button">Añadir</button>
          </div>
        `).join("")
      : `<div style="opacity:.65;font-size:12px;padding:4px 2px">Sin sugerencias.</div>`;
  }
  if (moreBtn) moreBtn.style.display = (countryState.page < countryState.totalPages) ? "" : "none";
}

async function fetchCountryTotal() {
  if (!tmdbEnabled() || !countryState.code) return;
  const cached = getCachedCountryDiscover(countryState.code);
  if (cached?.total !== undefined) {
    countryState.total = cached.total;
    renderCountryModal();
    return;
  }
  try {
    const data = await tmdbFetch("/discover/movie", {
      include_adult: false,
      with_origin_country: countryState.code
    });
    const total = Number(data?.total_results) || 0;
    const next = { ...(cached || {}), total };
    setCachedCountryDiscover(countryState.code, next);
    countryState.total = total;
    renderCountryModal();
  } catch (e) {
    console.warn("[media] country total failed", e);
  }
}

async function fetchCountrySuggestions() {
  if (!tmdbEnabled() || !countryState.code) return;
  const cached = getCachedCountryDiscover(countryState.code) || {};
  const page = Math.max(1, countryState.page || 1);
  if (cached.pages?.[page]) {
    const payload = cached.pages[page];
    countryState.totalPages = payload.totalPages || countryState.totalPages;
    countryState.suggestions = dedupeSuggestions(countryState.suggestions.concat(payload.results || []));
    renderCountryModal();
    return;
  }

  countryState.loading = true;
  try {
    const data = await tmdbFetch("/discover/movie", {
      include_adult: false,
      with_origin_country: countryState.code,
      page,
      sort_by: "popularity.desc"
    });
    const results = Array.isArray(data?.results) ? data.results : [];
    const seenSet = getSeenMovieIds();
    const existingSet = new Set(items.filter(it => it.tmdbId && (it.tmdbType === "movie" || it.type === "movie")).map(it => Number(it.tmdbId)));
    const mapped = results
      .filter(r => !r?.adult && !r?.video)
      .map(r => ({
        tmdbId: Number(r?.id) || 0,
        title: r?.title || "",
        year: Number(String(r?.release_date || "").slice(0, 4)) || 0
      }))
      .filter(r => r.tmdbId && !seenSet.has(r.tmdbId) && !existingSet.has(r.tmdbId));

    countryState.totalPages = Number(data?.total_pages) || 0;
    countryState.suggestions = dedupeSuggestions(countryState.suggestions.concat(mapped));

    const next = {
      ...(cached || {}),
      pages: {
        ...(cached.pages || {}),
        [page]: {
          results: mapped,
          totalPages: countryState.totalPages
        }
      }
    };
    setCachedCountryDiscover(countryState.code, next);
  } catch (e) {
    console.warn("[media] country discover failed", e);
  } finally {
    countryState.loading = false;
    renderCountryModal();
  }
}

function dedupeSuggestions(list) {
  const map = new Map();
  (list || []).forEach(c => {
    if (!c?.tmdbId) return;
    if (map.has(c.tmdbId)) return;
    map.set(c.tmdbId, c);
  });
  return Array.from(map.values());
}

async function addItemFromTmdbMovie(id) {
  if (!id || !tmdbEnabled()) return;
  try {
    const details = await tmdbFetchDetails(id, "movie");
    const cc = normalizeCountry(details.country || "");
    addItem({
      title: details?.title || "",
      type: "movie",
      rating: 0,
      year: details?.year || 0,
      genres: details.genres || [],
      director: details.director || "",
      directorData: details.directorData || null,
      cast: Array.isArray(details.cast) ? details.cast : [],
      tmdbId: details.tmdbId || id,
      tmdbType: details.tmdbType || "movie",
      countryCode: cc.code,
      countryEn: cc.en || "",
      countryLabel: cc.es || "",
      watchlist: true,
      withLaura: false,
      seasons: [],
      season: 0,
      episode: 0,
      currentSeason: 0,
      currentEpisode: 0,
      watchDates: []
    });
    countryState.suggestions = countryState.suggestions.filter(c => c.tmdbId !== id);
    renderCountryModal();
    fetchCountrySuggestions();
  } catch (e) {
    console.warn("[media] add country suggestion failed", e);
    setMediaSub("No se pudo crear la ficha", 2400);
  }
}

function openCountryModal({ code, label }) {
  const modal = ensureCountryModal();
  const normalized = normalizeCountry(code || label || "");
  countryState.code = normalized.code || code || "";
  countryState.label = countryLabelFromCode(countryState.code, normalized.es || normalized.en || label || "");
  countryState.total = null;
  countryState.suggestions = [];
  countryState.page = 1;
  countryState.totalPages = 0;
  const accordions = readCountryAccordionState();
  const seenSection = modal.querySelector("#media-country-seen-section");
  const suggestSection = modal.querySelector("#media-country-suggest-section");
  if (seenSection) seenSection.open = accordions.seen;
  if (suggestSection) suggestSection.open = accordions.suggest;
  renderCountryModal();
  modal.classList.remove("hidden");
  fetchCountryTotal();
  fetchCountrySuggestions();
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
  renderFilterChips();
  updateBulkAutofillUI();
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
