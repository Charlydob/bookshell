import { renderCountryHeatmap } from "./world-heatmap.js";
import { getCountryEnglishName, getCountryOptions, normalizeCountryInput } from "./countries.js";
import { db, auth } from "./firebase-shared.js";
import { ref, get, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const LS_VISITS = "world_visits_v1";
const LS_WATCH = "world_watchlist_v1";
const WORLD_PATH = (uid) => `v2/users/${uid}/world`;
const LEGACY_WORLD_PATHS = (uid) => [`v2/users/${uid}/trips`];
const SUBDIV_GEOJSON_BASE = "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/";

const worldState = {
  initialized: false,
  abortController: null,
  searchCache: new Map(),
  firebaseUnsub: null,
  firebaseRef: null,
  remoteWriteTimer: 0,
  hasResolvedFirstRemoteSnapshot: false,
  firebaseUid: null,
  editId: null,
  countrySubdivCache: new Map(),
  nestedSubdivCache: new Map(),
  currentWindow: "main",
  mapLongPressTimer: 0,
  longPressSelection: null,
};

function $id(id) { return document.getElementById(id); }
const iso2 = (v) => String(v || "").trim().toUpperCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const todayKey = () => new Date().toISOString().slice(0, 10);
const parseJson = (k, f) => { try { return JSON.parse(localStorage.getItem(k) || "") ?? f; } catch { return f; } };
const saveJson = (k, v) => localStorage.setItem(k, JSON.stringify(v));
const uid = () => auth.currentUser?.uid || worldState.firebaseUid;
const statusLabel = (s) => ({ visited: "Visitado", lived: "Vivido", wishlist: "Wishlist", other: "Otro" })[s] || "Visitado";
const statusPriority = { lived: 4, visited: 3, wishlist: 2, other: 1 };
const cleanGeo = (v) => String(v || "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-+|-+$/g, "");
const subdivisionKey = (countryCode, subdivision) => `${iso2(countryCode)}:${cleanGeo(subdivision)}`;

function normalizeRecord(v) {
  const countryCode = iso2(v?.countryCode || v?.country || v?.country_code);
  const subdivision = String(v?.subdivision || v?.admin1 || "").trim();
  const placeName = String(v?.placeName || v?.name || v?.city || "").trim();
  return {
    id: String(v?.id || `${Number(v?.ts) || Date.now()}_${Math.random().toString(16).slice(2)}`),
    ts: Number(v?.ts) || Date.now(),
    dateKey: String(v?.dateKey || v?.startDate || ""),
    startDate: String(v?.startDate || v?.dateKey || ""),
    endDate: String(v?.endDate || ""),
    note: String(v?.note || v?.notes || ""),
    status: ["visited", "lived", "wishlist", "other"].includes(v?.status) ? v.status : "visited",
    kind: String(v?.kind || "place"),
    countryCode,
    subdivision,
    subdivisionKey: String(v?.subdivisionKey || (subdivision ? subdivisionKey(countryCode, subdivision) : "")),
    subdivisionType: String(v?.subdivisionType || "subdivision"),
    city: String(v?.city || ""),
    placeName,
    placeKey: cleanGeo(placeName),
    lat: Number.isFinite(Number(v?.lat)) ? Number(v.lat) : null,
    lon: Number.isFinite(Number(v?.lon)) ? Number(v.lon) : null,
    emoji: String(v?.emoji || ""),
    folder: String(v?.folder || ""),
    source: String(v?.source || "record"),
    displayName: String(v?.displayName || ""),
  };
}

function normalizeWorldPayload(raw) {
  const visitsRaw = Array.isArray(raw?.visits) ? raw.visits : [];
  const customPinsRaw = Array.isArray(raw?.customPins) ? raw.customPins : [];
  const areaVisitsRaw = Array.isArray(raw?.areaVisits) ? raw.areaVisits : [];
  const timelineRaw = Array.isArray(raw?.timelineEntries) ? raw.timelineEntries : [];
  const watchRaw = raw?.watch && typeof raw.watch === "object" ? raw.watch : {};
  const visits = visitsRaw.filter(Boolean).map(normalizeRecord).filter((v) => v.countryCode);
  const customPins = customPinsRaw.filter(Boolean).map((v) => normalizeRecord({ ...v, kind: "pin", source: "pin" })).filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon));
  const areaVisits = areaVisitsRaw.filter(Boolean).map((v) => normalizeRecord({ ...v, kind: "subdivision", source: "area" })).filter((v) => v.countryCode && v.subdivision);
  const timelineEntries = timelineRaw.filter(Boolean).map((v) => normalizeRecord({ ...v, source: "timeline" }));
  const watch = {};
  for (const [k, val] of Object.entries(watchRaw)) {
    const code = iso2(k || val?.code);
    if (code) watch[code] = { code, label: String(val?.label || getCountryEnglishName(code) || code) };
  }
  return { visits, watch, customPins, areaVisits, timelineEntries };
}

function mergeById(...lists) {
  const m = new Map();
  lists.flat().forEach((v) => { if (v?.id) m.set(v.id, { ...(m.get(v.id) || {}), ...normalizeRecord(v) }); });
  return [...m.values()].sort((a, b) => (b.ts || 0) - (a.ts || 0));
}
const mergeWatch = (local, remote) => ({ ...(remote || {}), ...(local || {}) });
const worldPatchPayload = (data) => ({
  visits: Array.isArray(data.visits) ? data.visits : [],
  watch: data.watch && typeof data.watch === "object" ? data.watch : {},
  customPins: Array.isArray(data.customPins) ? data.customPins : [],
  areaVisits: Array.isArray(data.areaVisits) ? data.areaVisits : [],
  timelineEntries: Array.isArray(data.timelineEntries) ? data.timelineEntries : [],
  updatedAt: Date.now(),
});

async function readLegacyWorldPayload(userId) {
  for (const path of LEGACY_WORLD_PATHS(userId)) {
    try { const snap = await get(ref(db, path)); if (snap.exists()) return normalizeWorldPayload(snap.val()); } catch {}
  }
  return null;
}

function countrySlugFromISO2(code) {
  return (getCountryEnglishName(code) || code || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

async function fetchGeoJsonCandidate(files, cacheKey) {
  if (worldState.countrySubdivCache.has(cacheKey)) return worldState.countrySubdivCache.get(cacheKey);
  for (const file of files) {
    try {
      const r = await fetch(`${SUBDIV_GEOJSON_BASE}${file}`, { cache: "force-cache" });
      if (!r.ok) continue;
      const j = await r.json();
      (j.features || []).forEach((f) => {
        if (!f.properties) f.properties = {};
        f.properties.name = String(f.properties.name || f.properties.NAME || f.properties.NAME_1 || f.properties.region || f.properties.state || f.properties.province || "—");
      });
      worldState.countrySubdivCache.set(cacheKey, j);
      return j;
    } catch {}
  }
  worldState.countrySubdivCache.set(cacheKey, null);
  return null;
}

async function fetchSubdivGeoJSON(code) {
  const c = iso2(code); if (!c) return null;
  const known = { ES: ["spain-provinces.geojson", "spain-communities.geojson"] };
  const slug = countrySlugFromISO2(c);
  const candidates = [...(known[c] || []), `${slug}.geojson`, `${slug}-provinces.geojson`, `${slug}-states.geojson`, `${slug}-regions.geojson`];
  return fetchGeoJsonCandidate(candidates, `country:${c}`);
}

async function fetchNestedGeoJSON(countryCode, subdivisionName) {
  const key = `${iso2(countryCode)}:${cleanGeo(subdivisionName)}`;
  if (worldState.nestedSubdivCache.has(key)) return worldState.nestedSubdivCache.get(key);
  const country = countrySlugFromISO2(countryCode);
  const sub = cleanGeo(subdivisionName);
  const files = [`${country}-${sub}.geojson`, `${country}-${sub}-districts.geojson`, `${country}-${sub}-municipalities.geojson`, `${sub}.geojson`];
  for (const file of files) {
    try {
      const r = await fetch(`${SUBDIV_GEOJSON_BASE}${file}`, { cache: "force-cache" });
      if (!r.ok) continue;
      const j = await r.json();
      worldState.nestedSubdivCache.set(key, j);
      return j;
    } catch {}
  }
  worldState.nestedSubdivCache.set(key, null);
  return null;
}

function formatDateRange(v) { const s = v.startDate || v.dateKey || ""; const e = v.endDate || ""; if (!s && !e) return "sin fecha"; if (s && !e) return s; if (!s && e) return `— ${e}`; return `${s} — ${e}`; }
function filterByTime(rows, mode) { if (mode === "total") return rows.slice(); const now = new Date(); const start = mode === "day" ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : mode === "week" ? new Date(now.getTime() - 6 * 86400000) : mode === "month" ? new Date(now.getFullYear(), now.getMonth(), 1) : new Date(now.getFullYear(), 0, 1); return rows.filter((v) => (Number(v.ts) || 0) >= start.getTime()); }
function filterByStatus(rows, status) { return status === "all" ? rows : rows.filter((v) => String(v.status || "visited") === status); }

let nominatimAbort = null;
async function nominatimSearch(q) {
  const normalized = String(q || "").trim().toLowerCase(); if (normalized.length < 2) return [];
  if (worldState.searchCache.has(`nom:${normalized}`)) return worldState.searchCache.get(`nom:${normalized}`);
  if (nominatimAbort) nominatimAbort.abort(); nominatimAbort = new AbortController();
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8"); u.searchParams.set("accept-language", "es"); u.searchParams.set("q", normalized);
  try { const r = await fetch(u.toString(), { signal: nominatimAbort.signal, headers: { Accept: "application/json" } }); if (!r.ok) return []; const d = await r.json(); worldState.searchCache.set(`nom:${normalized}`, d); return d; } catch (e) { if (e?.name === "AbortError") return []; return []; }
}

async function openMeteoSearch(q) {
  const normalized = String(q || "").trim().toLowerCase(); if (normalized.length < 2) return [];
  if (worldState.searchCache.has(`om:${normalized}`)) return worldState.searchCache.get(`om:${normalized}`);
  try {
    const u = new URL("https://geocoding-api.open-meteo.com/v1/search");
    u.searchParams.set("name", normalized); u.searchParams.set("count", "8"); u.searchParams.set("language", "es");
    const r = await fetch(u.toString(), { headers: { Accept: "application/json" } });
    if (!r.ok) return [];
    const d = await r.json();
    const out = (d.results || []).map((x) => ({
      display_name: [x.name, x.admin1, x.country].filter(Boolean).join(", "),
      country_code: String(x.country_code || "").toLowerCase(),
      type: x.feature_code || "place",
      lon: x.longitude,
      lat: x.latitude,
      source: "open-meteo",
      address: { country_code: String(x.country_code || "").toLowerCase() },
    }));
    worldState.searchCache.set(`om:${normalized}`, out);
    return out;
  } catch { return []; }
}

const isCountryishResult = (r) => String(r?.class || "") === "boundary" || ["country", "administrative"].includes(String(r?.type || ""));
const isPlaceResult = (r) => !isCountryishResult(r);
const normalizeName = (v) => cleanGeo(v).replace(/\b(the|republic|kingdom|state|states|federation)\b/g, "").replace(/-+/g, "-").replace(/^-|-$/g, "");

function countryCodeFromMapName(name) {
  const n = normalizeName(name);
  const aliases = {
    "united-states-of-america": "US", "russia": "RU", "czech-republic": "CZ", "south-korea": "KR", "north-korea": "KP",
    "ivory-coast": "CI", "democratic-republic-of-the-congo": "CD", "republic-of-the-congo": "CG", "laos": "LA", "vietnam": "VN",
  };
  if (aliases[n]) return aliases[n];
  const direct = normalizeCountryInput(name);
  if (direct?.code) return direct.code;
  return (getCountryOptions() || []).find((o) => normalizeName(getCountryEnglishName(o.code) || o.name) === n || normalizeName(o.name) === n)?.code || "";
}

export async function init() {
  if (worldState.initialized) return;
  worldState.initialized = true;
  worldState.abortController = new AbortController();
  const evtOpts = { signal: worldState.abortController.signal };

  const $map = $id("world-map");
  const $pct = $id("world-pct"), $countries = $id("world-countries"), $countriesTotal = $id("world-countries-total"), $places = $id("world-places"), $subs = $id("world-subdivisions"), $subsTotal = $id("world-subdivisions-total");
  const $filter = $id("world-filter"), $statusFilter = $id("world-status-filter"), $visitsList = $id("world-visits-list"), $watchList = $id("world-watch-list"), $watchInput = $id("world-watch-q"), $watchAdd = $id("world-watch-add");
  const $visitsCount = $id("world-visits-count"), $watchCount = $id("world-watch-count"), $timelineList = $id("world-timeline-list"), $timelineCount = $id("world-timeline-count"), $pinsList = $id("world-pins-list"), $pinsCount = $id("world-pins-count"), $pinFolderFilter = $id("world-pin-folder-filter");
  const $countryTitle = $id("world-country-title"), $countryGrid = $id("world-country-detail-grid"), $subdivisionList = $id("world-subdivision-list");
  const $addKind = $id("world-kind"), $addQuery = $id("world-place-q"), $addSubdiv = $id("world-place-subdivision"), $addCity = $id("world-place-city"), $addStart = $id("world-date-start"), $addEnd = $id("world-date-end"), $addNote = $id("world-note"), $addStatus = $id("world-record-status"), $addEmoji = $id("world-pin-emoji"), $addFolder = $id("world-pin-folder"), $addResults = $id("world-place-results"), $addSave = $id("world-place-save"), $addDelete = $id("world-place-delete"), $addToggle = $id("world-add-toggle"), $markCurrent = $id("world-mark-current");
  const $scope = $id("world-view-scope");
  const $tabs = [...document.querySelectorAll("#view-world .world-window-tab")];
  const $panels = [...document.querySelectorAll("#view-world .world-window-panel")];
  const $sheet = $id("world-map-sheet"), $sheetTitle = $id("world-map-sheet-title"), $sheetState = $id("world-map-sheet-state"), $sheetActions = $id("world-map-sheet-actions"), $sheetClose = $id("world-map-sheet-close");

  let state = { visits: parseJson(LS_VISITS, []), watch: parseJson(LS_WATCH, {}), customPins: [], areaVisits: [], timelineEntries: [] };
  let pendingPick = null;
  const nav = { stack: [{ type: "world" }] };

  const currentView = () => nav.stack[nav.stack.length - 1];
  const pushView = (view) => { nav.stack.push(view); renderAll(); };
  const popView = () => { if (nav.stack.length > 1) nav.stack.pop(); renderAll(); };

  const setWindow = (next) => {
    worldState.currentWindow = ["main", "records", "timeline"].includes(next) ? next : "main";
    $tabs.forEach((btn) => { const on = btn.dataset.window === worldState.currentWindow; btn.classList.toggle("active", on); btn.setAttribute("aria-selected", on ? "true" : "false"); });
    $panels.forEach((panel) => panel.classList.toggle("active", panel.dataset.windowPanel === worldState.currentWindow));
  };
  setWindow(worldState.currentWindow);

  function persistLocal() { saveJson(LS_VISITS, state.visits); saveJson(LS_WATCH, state.watch); }
  async function persistRemoteNow() { if (!uid() || !worldState.firebaseRef) return; try { await update(worldState.firebaseRef, worldPatchPayload(state)); } catch (e) { console.warn("[world] remote save failed", e); } }
  function scheduleRemote() { clearTimeout(worldState.remoteWriteTimer); worldState.remoteWriteTimer = setTimeout(() => persistRemoteNow(), 260); }
  function persist() { persistLocal(); scheduleRemote(); }

  async function initFirebaseSync() {
    if (!uid()) return;
    worldState.firebaseUid = uid();
    worldState.firebaseRef = ref(db, WORLD_PATH(uid()));
    const legacy = await readLegacyWorldPayload(uid());
    worldState.firebaseUnsub = onValue(worldState.firebaseRef, (snap) => {
      const remote = snap.exists() ? normalizeWorldPayload(snap.val()) : { visits: [], watch: {}, customPins: [], areaVisits: [], timelineEntries: [] };
      if (!worldState.hasResolvedFirstRemoteSnapshot) {
        worldState.hasResolvedFirstRemoteSnapshot = true;
        state = {
          visits: mergeById(state.visits, remote.visits, legacy?.visits || []),
          watch: mergeWatch(state.watch, remote.watch),
          customPins: mergeById(state.customPins, remote.customPins, legacy?.customPins || []),
          areaVisits: mergeById(state.areaVisits, remote.areaVisits, legacy?.areaVisits || []),
          timelineEntries: mergeById(state.timelineEntries, remote.timelineEntries, legacy?.timelineEntries || []),
        };
        persistLocal(); renderAll(); persistRemoteNow(); return;
      }
      state.visits = mergeById(state.visits, remote.visits);
      state.watch = mergeWatch(state.watch, remote.watch);
      state.customPins = mergeById(state.customPins, remote.customPins);
      state.areaVisits = mergeById(state.areaVisits, remote.areaVisits);
      state.timelineEntries = mergeById(state.timelineEntries, remote.timelineEntries);
      persistLocal(); renderAll();
    });
  }

  const allRecords = () => mergeById(state.visits, state.areaVisits);
  const bestStatus = (rows) => rows.slice().sort((a, b) => (statusPriority[b.status] - statusPriority[a.status]) || ((b.ts || 0) - (a.ts || 0)))[0]?.status || "";

  function groupTree() {
    const tree = new Map();
    for (const r of allRecords()) {
      const c = iso2(r.countryCode); if (!c) continue;
      if (!tree.has(c)) tree.set(c, { countryCode: c, subdivisions: new Map(), records: [] });
      const cNode = tree.get(c); cNode.records.push(r);
      if (r.subdivision) {
        const sk = subdivisionKey(c, r.subdivision);
        if (!cNode.subdivisions.has(sk)) cNode.subdivisions.set(sk, { key: sk, name: r.subdivision, records: [] });
        cNode.subdivisions.get(sk).records.push(r);
      }
    }
    return tree;
  }

  function findExistingForSelection(sel) {
    const code = iso2(sel.countryCode);
    const areaName = String(sel.subdivision || sel.placeName || "").trim();
    const key = subdivisionKey(code, areaName);
    const area = state.areaVisits.find((v) => subdivisionKey(v.countryCode, v.subdivision) === key);
    if (area) return area;
    const placeKey = cleanGeo(sel.placeName || sel.subdivision || "");
    return state.visits.find((v) => iso2(v.countryCode) === code && (v.placeKey === placeKey || subdivisionKey(v.countryCode, v.subdivision) === key));
  }

  function openSheet(sel) {
    if (!$sheet || !$sheetActions) return;
    worldState.longPressSelection = sel;
    const existing = findExistingForSelection(sel);
    $sheet.hidden = false;
    $sheetTitle.textContent = `Acciones · ${sel.label || sel.placeName || "Selección"}`;
    $sheetState.innerHTML = existing ? `Ya registrado: <span class="badge ${esc(existing.status)}">${esc(statusLabel(existing.status))}</span> · ${esc(formatDateRange(existing))}` : "Sin registro previo.";
    const make = (act, txt, primary = false) => `<button class="btn${primary ? " primary" : ""}" data-sheet-act="${act}">${txt}</button>`;
    $sheetActions.innerHTML = [
      make("add-visited", existing ? "Actualizar como visitado" : "Añadir como visitado", true),
      make("add-lived", existing ? "Actualizar como vivido" : "Añadir como vivido"),
      make("add-wishlist", existing ? "Actualizar wishlist" : "Añadir wishlist"),
      make("open", "Abrir vista detalle"),
      existing ? make("edit", "Editar registro") : "",
    ].filter(Boolean).join("");
  }
  function closeSheet() { if ($sheet) $sheet.hidden = true; }

  function prefillModalFromSelection(sel, forcedStatus = "visited") {
    $addKind.value = sel.level === "country" ? "country" : sel.level === "subdivision" ? "subdivision" : "city";
    $addStatus.value = forcedStatus;
    $addQuery.value = sel.placeName || sel.countryName || "";
    $addSubdiv.value = sel.subdivision || "";
    $addCity.value = sel.level === "place" ? (sel.placeName || "") : "";
    pendingPick = { code: iso2(sel.countryCode), name: sel.placeName || sel.countryName || "", lat: sel.lat ?? null, lon: sel.lon ?? null };
    $addToggle.checked = true;
  }

  function bindMapLongPress(chart, getSelection) {
    const start = (params) => {
      clearTimeout(worldState.mapLongPressTimer);
      worldState.mapLongPressTimer = setTimeout(() => {
        const selection = getSelection(params);
        if (selection?.countryCode) openSheet(selection);
      }, 480);
    };
    const cancel = () => clearTimeout(worldState.mapLongPressTimer);
    chart.on("mousedown", start); chart.on("touchstart", start);
    chart.on("mouseup", cancel); chart.on("touchend", cancel); chart.on("globalout", cancel);
  }

  function renderWatchlist() {
    const items = Object.values(state.watch || {}).sort((a, b) => (a.label || "").localeCompare(b.label || ""));
    $watchList.innerHTML = items.length ? items.map((it) => `<div class="world-item"><div><div class="name">${esc(it.label)}</div><div class="meta">${esc(it.code)}</div></div><div class="actions"><button class="btn" data-act="remove-watch" data-code="${it.code}">Quitar</button></div></div>`).join("") : '<div class="geo-empty">Sin watchlist.</div>';
    $watchCount.textContent = String(items.length);
  }

  function renderTimeline(rows) {
    const merged = mergeById(rows, state.timelineEntries, state.areaVisits, state.customPins);
    const byYear = new Map();
    merged.forEach((v) => { const y = (v.startDate || v.dateKey || "sin-fecha").slice(0, 4) || "sin-fecha"; if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(v); });
    const years = [...byYear.keys()].sort((a, b) => String(b).localeCompare(String(a)));
    $timelineList.innerHTML = "";
    years.forEach((y) => {
      $timelineList.insertAdjacentHTML("beforeend", `<div class="world-timeline-year">${esc(y)}</div>`);
      byYear.get(y).sort((a, b) => (b.ts || 0) - (a.ts || 0)).forEach((v) => {
        const country = getCountryEnglishName(v.countryCode) || v.countryCode;
        const hierarchy = [country, v.subdivision, v.city || v.placeName].filter(Boolean);
        $timelineList.insertAdjacentHTML("beforeend", `<div class="world-item timeline-item"><div><div class="name">${esc(hierarchy.join(" › ") || "—")}</div><div class="meta">${esc(formatDateRange(v))} · <span class="badge ${esc(v.status)}">${esc(statusLabel(v.status))}</span></div></div></div>`);
      });
    });
    $timelineCount.textContent = String(merged.length);
  }

  function renderPins() {
    const folderQ = String($pinFolderFilter?.value || "").toLowerCase().trim();
    const pins = state.customPins.filter((p) => !folderQ || String(p.folder || "").toLowerCase().includes(folderQ));
    $pinsList.innerHTML = pins.length ? pins.map((p) => `<div class="world-item"><div><div class="name">${esc((p.emoji || "📍") + " " + (p.placeName || "Pin"))}</div><div class="meta">${esc((p.folder || "sin carpeta") + " · " + formatDateRange(p))}</div></div><div class="actions"><button class="btn" data-act="edit-record" data-id="${p.id}" data-source="pin">Editar</button><button class="btn" data-act="del-record" data-id="${p.id}" data-source="pin">Borrar</button></div></div>`).join("") : '<div class="geo-empty">Sin pins.</div>';
    $pinsCount.textContent = String(pins.length);
  }

  async function renderGeoPanel(geoJson, onFeatureClick, onSelection) {
    if (!window.echarts || !geoJson?.features?.length) return false;
    if (typeof $map.__geoCleanup === "function") $map.__geoCleanup();
    $map.innerHTML = "";
    const mapId = `world-sub-${Date.now()}`;
    window.echarts.registerMap(mapId, geoJson);
    const chart = window.echarts.init($map, null, { renderer: "canvas" });
    chart.setOption({
      backgroundColor: "transparent",
      tooltip: { show: false },
      series: [{ type: "map", map: mapId, roam: true, data: (geoJson.features || []).map((f) => ({ name: String(f.properties?.name || "—"), value: 1 })), itemStyle: { areaColor: "rgba(255,255,255,.06)", borderColor: "rgba(255,255,255,.22)", borderWidth: 1 }, emphasis: { itemStyle: { areaColor: "rgba(111,107,255,.48)" }, label: { show: true, color: "#eef0ff" } } }],
    });
    const ro = new ResizeObserver(() => chart.resize()); ro.observe($map);
    chart.on("click", (p) => onFeatureClick?.(String(p?.name || "").trim(), p));
    if (onSelection) bindMapLongPress(chart, (params) => onSelection(String(params?.name || "").trim(), params));
    $map.__geoChart = chart;
    $map.__geoCleanup = () => { try { ro.disconnect(); chart.dispose(); } catch {} };
    return true;
  }

  async function renderCountryView(view, tree) {
    const code = iso2(view.countryCode);
    const node = tree.get(code);
    const countryName = getCountryEnglishName(code) || code;
    const geo = await fetchSubdivGeoJSON(code);
    const records = node?.records || [];
    const status = bestStatus(records) || "visited";
    const totalSub = geo?.features?.length || 0;
    const markedSub = node?.subdivisions?.size || 0;
    $countryTitle.textContent = `País · ${countryName} (${code})`;
    $countryGrid.innerHTML = `<div class="world-item"><div><div class="name">Estado dominante</div><div class="meta"><span class="badge ${esc(status)}">${esc(statusLabel(status))}</span></div></div></div><div class="world-item"><div><div class="name">Subdivisiones</div><div class="meta">${markedSub} / ${totalSub || "—"}</div></div></div><div class="world-item"><div><div class="name">Fuente mapa</div><div class="meta">Click-that-hood</div></div></div><div class="world-item"><div><div class="name">Fallback lookup</div><div class="meta">Open-Meteo geocoding</div></div></div>`;

    const bySubStatus = new Map();
    for (const r of records.filter((x) => x.subdivision)) {
      const key = subdivisionKey(code, r.subdivision);
      const prev = bySubStatus.get(key);
      if (!prev || statusPriority[r.status] >= statusPriority[prev.status]) bySubStatus.set(key, { name: r.subdivision, status: r.status, record: r });
    }

    if (!geo?.features?.length) {
      $subdivisionList.innerHTML = '<div class="geo-empty">Sin subdivisiones homogéneas en esta fuente. Se mantiene fallback por registros y lookup.</div>';
      await renderCountryHeatmap($map, [{ code, value: records.length, label: countryName }], { emptyLabel: "Sin datos" });
      return;
    }

    await renderGeoPanel(geo, (name) => pushView({ type: "subdivision", countryCode: code, subdivision: name }), (name) => ({ level: "subdivision", countryCode: code, countryName, subdivision: name, placeName: name, label: `${countryName} · ${name}` }));
    const names = geo.features.map((f) => String(f.properties?.name || "—")).filter(Boolean);
    $subdivisionList.innerHTML = names.map((name) => {
      const key = subdivisionKey(code, name);
      const existing = bySubStatus.get(key);
      const statusTxt = existing ? `<span class="badge ${esc(existing.status)}">${esc(statusLabel(existing.status))}</span>` : "Sin registrar";
      return `<div class="world-item"><div><div class="name">${esc(name)}</div><div class="meta">${statusTxt}</div></div><div class="actions"><button class="btn" data-act="open-subdivision" data-country="${code}" data-name="${esc(name)}">Abrir mapa</button><button class="btn" data-act="mark-subdivision" data-country="${code}" data-name="${esc(name)}">${existing ? "Editar" : "Marcar"}</button></div></div>`;
    }).join("");
  }

  async function renderSubdivisionView(view, tree) {
    const code = iso2(view.countryCode);
    const subName = String(view.subdivision || "");
    const cNode = tree.get(code);
    const subRows = (cNode?.records || []).filter((r) => r.subdivision && subdivisionKey(code, r.subdivision) === subdivisionKey(code, subName));
    const status = bestStatus(subRows);
    $countryTitle.textContent = `Subdivisión · ${subName} (${getCountryEnglishName(code) || code})`;
    const nested = await fetchNestedGeoJSON(code, subName);

    $countryGrid.innerHTML = `<div class="world-item"><div><div class="name">Estado actual</div><div class="meta">${status ? `<span class="badge ${esc(status)}">${esc(statusLabel(status))}</span>` : "Sin registrar"}</div></div></div><div class="world-item"><div><div class="name">Registros</div><div class="meta">${subRows.length}</div></div></div><div class="world-item"><div><div class="name">Detalle geográfico</div><div class="meta">${nested?.features?.length ? "Mapa inferior disponible" : "Fallback por búsqueda"}</div></div></div><div class="world-item"><div><div class="name">Acciones</div><div class="meta">Mantener pulsado para acción rápida</div></div></div>`;

    if (nested?.features?.length) {
      await renderGeoPanel(nested, (name) => {}, (name) => ({ level: "place", countryCode: code, countryName: getCountryEnglishName(code) || code, subdivision: subName, placeName: name, label: `${subName} · ${name}` }));
      $subdivisionList.innerHTML = nested.features.slice(0, 150).map((f) => {
        const name = String(f.properties?.name || "—");
        return `<div class="world-item"><div><div class="name">${esc(name)}</div><div class="meta">Nivel inferior detectado</div></div><div class="actions"><button class="btn" data-act="prefill-place" data-country="${code}" data-subdivision="${esc(subName)}" data-place="${esc(name)}">Marcar zona</button></div></div>`;
      }).join("");
    } else {
      await renderCountryHeatmap($map, [{ code, value: subRows.length || 1, label: getCountryEnglishName(code) || code }], { emptyLabel: "Sin mapa" });
      $subdivisionList.innerHTML = `<div class="geo-empty">No existe un mapa inferior en la fuente principal para “${esc(subName)}”. Usa búsqueda con fallback Open‑Meteo para ciudad/municipio/comarca.</div>`;
    }
  }

  function openEdit(rec) {
    worldState.editId = rec?.id || null;
    $addKind.value = rec?.kind || "city";
    $addQuery.value = rec?.placeName || "";
    $addSubdiv.value = rec?.subdivision || "";
    $addCity.value = rec?.city || "";
    $addStart.value = rec?.startDate || "";
    $addEnd.value = rec?.endDate || "";
    $addNote.value = rec?.note || "";
    $addStatus.value = rec?.status || "visited";
    $addEmoji.value = rec?.emoji || "";
    $addFolder.value = rec?.folder || "";
    pendingPick = rec ? { code: rec.countryCode, name: rec.placeName, lon: rec.lon, lat: rec.lat } : null;
    $addDelete.style.display = "inline-flex";
    $addToggle.checked = true;
  }

  async function renderAll() {
    const mode = $filter.value || "total";
    const stat = $statusFilter.value || "all";
    const filtered = filterByStatus(filterByTime(state.visits, mode), stat);
    const tree = groupTree();
    const active = currentView();

    const byCountry = new Map();
    filtered.forEach((r) => byCountry.set(iso2(r.countryCode), (byCountry.get(iso2(r.countryCode)) || 0) + 1));
    const entries = [...byCountry.entries()].map(([code, value]) => ({ code, value, label: getCountryEnglishName(code) || code }));

    $countriesTotal.textContent = String(getCountryOptions()?.length || 0);
    $countries.textContent = String(new Set(filtered.map((v) => iso2(v.countryCode)).filter(Boolean)).size);
    $places.textContent = String(new Set(filtered.filter((v) => v.kind !== "country").map((v) => `${v.countryCode}:${v.subdivisionKey}:${v.placeKey}`)).size);
    const visitedSubdivisions = new Set(state.areaVisits.map((v) => v.subdivisionKey || subdivisionKey(v.countryCode, v.subdivision)).filter(Boolean));
    $subs.textContent = String(visitedSubdivisions.size);
    $subsTotal.textContent = active.type === "country" ? String((await fetchSubdivGeoJSON(active.countryCode))?.features?.length || 0) : "0";
    $visitsCount.textContent = String(filtered.length);
    $pct.textContent = `${((new Set(filtered.map((v) => v.countryCode)).size) / Math.max(1, (getCountryOptions()?.length || 1)) * 100).toFixed(2)}%`;

    if ($scope) {
      const crumbs = nav.stack.map((v) => v.type === "world" ? "Mundo" : v.type === "country" ? (getCountryEnglishName(v.countryCode) || v.countryCode) : v.subdivision).join(" › ");
      $scope.innerHTML = `${crumbs}${nav.stack.length > 1 ? ' <button class="btn" id="world-go-back" type="button">← Volver</button>' : ""}`;
      const back = $id("world-go-back");
      if (back) back.addEventListener("click", () => popView(), { once: true });
    }

    if (active.type === "world") {
      await renderCountryHeatmap($map, entries, { emptyLabel: "Aún no hay visitas", showCallouts: false });
      $countryTitle.textContent = "Vista mundo";
      $countryGrid.innerHTML = '<div class="world-item"><div><div class="name">Resumen</div><div class="meta">Clic para detalle y mantener pulsado para acciones rápidas.</div></div></div>';
      $subdivisionList.innerHTML = entries.sort((a, b) => b.value - a.value).map((e) => `<div class="world-item"><div><div class="name">${esc(getCountryEnglishName(e.code) || e.code)}</div><div class="meta">${e.value} registros</div></div><div class="actions"><button class="btn" data-act="open-country" data-country="${e.code}">Abrir país</button></div></div>`).join("") || '<div class="geo-empty">Sin países aún.</div>';
      if ($map.__geoChart && !$map.__worldClickBound) {
        $map.__worldClickBound = true;
        $map.__geoChart.on("click", (params) => {
          const code = countryCodeFromMapName(params?.name);
          if (code) pushView({ type: "country", countryCode: code });
        });
        bindMapLongPress($map.__geoChart, (params) => {
          const code = countryCodeFromMapName(params?.name);
          if (!code) return null;
          const countryName = getCountryEnglishName(code) || code;
          return { level: "country", countryCode: code, countryName, placeName: countryName, label: countryName };
        });
      }
    } else if (active.type === "country") {
      await renderCountryView(active, tree);
    } else if (active.type === "subdivision") {
      await renderSubdivisionView(active, tree);
    }

    const grouped = new Map();
    filtered.forEach((v) => {
      const code = iso2(v.countryCode);
      if (!grouped.has(code)) grouped.set(code, new Map());
      const sub = v.subdivision || "—";
      if (!grouped.get(code).has(sub)) grouped.get(code).set(sub, []);
      grouped.get(code).get(sub).push(v);
    });
    $visitsList.innerHTML = [...grouped.entries()].map(([code, subMap]) => `<details class="world-country" open><summary class="world-country-summary"><div><div class="world-country-name">${esc(getCountryEnglishName(code) || code)}</div><div class="world-country-meta">${[...subMap.values()].flat().length} registros</div></div></summary><div class="world-country-body">${[...subMap.entries()].map(([sub, rows]) => `<div class="world-item"><div><div class="name">${esc(sub)}</div><div class="meta">${rows.length} · ${esc(statusLabel(bestStatus(rows) || "visited"))}</div></div></div>${rows.sort((a,b)=>(b.ts||0)-(a.ts||0)).map((v) => `<div class="world-item"><div><div class="name">${esc(v.placeName || v.city || getCountryEnglishName(v.countryCode) || v.countryCode)}</div><div class="meta">${esc(formatDateRange(v))} · <span class="badge ${esc(v.status)}">${esc(statusLabel(v.status))}</span></div></div><div class="actions"><button class="btn" data-act="edit-record" data-id="${v.id}">Editar</button><button class="btn" data-act="del-record" data-id="${v.id}">Borrar</button></div></div>`).join("")}`).join("")}</div></details>`).join("") || '<div class="geo-empty">Aún no hay visitas.</div>';

    renderWatchlist();
    renderTimeline(filtered);
    renderPins();
  }

  $tabs.forEach((btn) => btn.addEventListener("click", () => setWindow(btn.dataset.window), evtOpts));
  $sheetClose?.addEventListener("click", closeSheet, evtOpts);
  $sheet?.querySelector(".world-map-sheet-backdrop")?.addEventListener("click", closeSheet, evtOpts);
  $sheetActions?.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-sheet-act]"); if (!btn) return;
    const sel = worldState.longPressSelection; if (!sel) return;
    const existing = findExistingForSelection(sel);
    const act = btn.dataset.sheetAct;
    if (act === "open") {
      if (sel.level === "country") pushView({ type: "country", countryCode: sel.countryCode });
      if (sel.level === "subdivision") pushView({ type: "subdivision", countryCode: sel.countryCode, subdivision: sel.subdivision || sel.placeName });
      closeSheet();
      return;
    }
    if (act === "edit" && existing) { openEdit(existing); closeSheet(); return; }
    if (["add-visited", "add-lived", "add-wishlist"].includes(act)) {
      const st = act.replace("add-", "");
      if (existing) { existing.status = st; existing.ts = Date.now(); existing.dateKey = existing.dateKey || todayKey(); }
      else prefillModalFromSelection(sel, st);
      persist(); renderAll(); closeSheet();
    }
  }, evtOpts);

  $watchInput.addEventListener("input", async () => {
    const q = $watchInput.value.trim(); if (q.length < 2) return;
    const rs = (await nominatimSearch(q)).filter(isCountryishResult).slice(0, 8);
    let dl = $id("world-watch-dl");
    if (!dl) { dl = document.createElement("datalist"); dl.id = "world-watch-dl"; document.body.appendChild(dl); $watchInput.setAttribute("list", "world-watch-dl"); }
    dl.innerHTML = rs.map((r) => `<option value="${esc(r.display_name?.split(",")?.[0] || "")}"></option>`).join("");
  }, evtOpts);

  $watchAdd.addEventListener("click", async () => {
    const q = $watchInput.value.trim();
    const r = (await nominatimSearch(q)).find(isCountryishResult);
    const code = iso2(r?.address?.country_code || r?.country_code);
    if (!code) return;
    state.watch[code] = { code, label: r?.display_name?.split(",")?.[0] || getCountryEnglishName(code) || code };
    persist();
    $watchInput.value = "";
    renderAll();
  }, evtOpts);

  $watchList.addEventListener("click", (e) => {
    const b = e.target.closest('button[data-act="remove-watch"]'); if (!b) return;
    delete state.watch[iso2(b.dataset.code)]; persist(); renderAll();
  }, evtOpts);

  $addQuery.addEventListener("input", async () => {
    pendingPick = null; $addResults.innerHTML = "";
    const q = $addQuery.value.trim(); if (q.length < 2) return;
    const kind = $addKind.value;
    const nom = await nominatimSearch(q);
    const itemsRaw = nom.length ? nom : await openMeteoSearch(q);
    const items = (kind === "country" ? itemsRaw.filter(isCountryishResult) : itemsRaw.filter(isPlaceResult)).slice(0, 8);
    $addResults.innerHTML = items.map((r, i) => `<div class="world-item"><div><div class="name">${esc((r.display_name || "—").split(",")[0])}</div><div class="meta">${esc((r.address?.country_code || r.country_code || "").toUpperCase())} · ${esc(r.type || "")}${r.source ? ` · ${esc(r.source)}` : ""}</div></div><div class="actions"><button class="btn" data-pick="${i}">Elegir</button></div></div>`).join("") || '<div class="geo-empty">Sin resultados.</div>';
    $addResults.querySelectorAll("button[data-pick]").forEach((btn) => btn.addEventListener("click", () => {
      const r = items[Number(btn.dataset.pick) || 0];
      pendingPick = { code: iso2(r?.address?.country_code || r?.country_code), name: (r.display_name || "—").split(",")[0], lon: Number(r.lon), lat: Number(r.lat) };
      $addQuery.value = pendingPick.name;
    }, { once: true }));
  }, evtOpts);

  $addSave.addEventListener("click", async () => {
    const kind = $addKind.value;
    const now = Date.now();
    const rec = normalizeRecord({
      id: worldState.editId || `${now}_${Math.random().toString(16).slice(2)}`,
      ts: now,
      dateKey: $addStart.value || todayKey(),
      startDate: $addStart.value || "",
      endDate: $addEnd.value || "",
      note: $addNote.value.trim(),
      status: $addStatus.value || "visited",
      kind,
      countryCode: iso2(pendingPick?.code || normalizeCountryInput($addQuery.value)?.code),
      subdivision: $addSubdiv.value.trim(),
      city: $addCity.value.trim(),
      placeName: $addQuery.value.trim(),
      lat: Number.isFinite(Number(pendingPick?.lat)) ? Number(pendingPick.lat) : null,
      lon: Number.isFinite(Number(pendingPick?.lon)) ? Number(pendingPick.lon) : null,
      emoji: $addEmoji.value.trim(),
      folder: $addFolder.value.trim(),
    });
    if (!rec.countryCode && kind !== "pin") return;

    const upsert = (arr) => { const i = arr.findIndex((v) => v.id === rec.id); if (i >= 0) arr[i] = { ...arr[i], ...rec }; else arr.push(rec); };
    if (kind === "pin") upsert(state.customPins);
    else if (kind === "subdivision") { upsert(state.areaVisits); upsert(state.timelineEntries); }
    else { upsert(state.visits); upsert(state.timelineEntries); }

    persist();
    worldState.editId = null;
    $addDelete.style.display = "none";
    $addToggle.checked = false;
    await renderAll();
  }, evtOpts);

  $addDelete.addEventListener("click", async () => {
    const id = worldState.editId; if (!id) return;
    state.visits = state.visits.filter((v) => v.id !== id);
    state.customPins = state.customPins.filter((v) => v.id !== id);
    state.areaVisits = state.areaVisits.filter((v) => v.id !== id);
    state.timelineEntries = state.timelineEntries.filter((v) => v.id !== id);
    persist();
    worldState.editId = null;
    $addDelete.style.display = "none";
    $addToggle.checked = false;
    await renderAll();
  }, evtOpts);

  $visitsList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const id = btn.dataset.id;
    const rec = state.visits.find((v) => v.id === id) || state.areaVisits.find((v) => v.id === id);
    if (!rec) return;
    if (btn.dataset.act === "del-record") { state.visits = state.visits.filter((v) => v.id !== id); state.areaVisits = state.areaVisits.filter((v) => v.id !== id); state.timelineEntries = state.timelineEntries.filter((v) => v.id !== id); persist(); renderAll(); return; }
    if (btn.dataset.act === "edit-record") openEdit(rec);
  }, evtOpts);

  $pinsList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]"); if (!btn) return;
    const id = btn.dataset.id;
    const rec = state.customPins.find((v) => v.id === id);
    if (!rec) return;
    if (btn.dataset.act === "del-record") { state.customPins = state.customPins.filter((v) => v.id !== id); state.timelineEntries = state.timelineEntries.filter((v) => v.id !== id); persist(); renderAll(); return; }
    if (btn.dataset.act === "edit-record") openEdit(rec);
  }, evtOpts);

  $subdivisionList.addEventListener("click", (e) => {
    const countryBtn = e.target.closest('button[data-act="open-country"]');
    if (countryBtn) { pushView({ type: "country", countryCode: countryBtn.dataset.country }); return; }
    const openBtn = e.target.closest('button[data-act="open-subdivision"]');
    if (openBtn) { pushView({ type: "subdivision", countryCode: openBtn.dataset.country, subdivision: openBtn.dataset.name }); return; }
    const markBtn = e.target.closest('button[data-act="mark-subdivision"]');
    if (markBtn) {
      const code = iso2(markBtn.dataset.country);
      const name = String(markBtn.dataset.name || "");
      const existing = state.areaVisits.find((v) => subdivisionKey(v.countryCode, v.subdivision) === subdivisionKey(code, name));
      if (existing) openEdit(existing);
      else prefillModalFromSelection({ level: "subdivision", countryCode: code, countryName: getCountryEnglishName(code) || code, subdivision: name, placeName: name }, "visited");
      return;
    }
    const placeBtn = e.target.closest('button[data-act="prefill-place"]');
    if (placeBtn) prefillModalFromSelection({ level: "place", countryCode: iso2(placeBtn.dataset.country), subdivision: placeBtn.dataset.subdivision || "", placeName: placeBtn.dataset.place || "" }, "visited");
  }, evtOpts);

  $markCurrent?.addEventListener("click", () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition((pos) => {
      $addKind.value = "pin";
      pendingPick = { code: "", name: "Ubicación actual", lat: pos.coords.latitude, lon: pos.coords.longitude };
      $addQuery.value = "Ubicación actual";
      $addToggle.checked = true;
    }, () => {});
  }, evtOpts);

  $filter.addEventListener("change", renderAll, evtOpts);
  $statusFilter.addEventListener("change", renderAll, evtOpts);
  $pinFolderFilter.addEventListener("input", renderAll, evtOpts);

  await initFirebaseSync();
  await renderAll();
}

export function destroy() {
  if (worldState.abortController) { worldState.abortController.abort(); worldState.abortController = null; }
  if (worldState.firebaseUnsub) { worldState.firebaseUnsub(); worldState.firebaseUnsub = null; }
  if (worldState.remoteWriteTimer) { clearTimeout(worldState.remoteWriteTimer); worldState.remoteWriteTimer = 0; }
  if (nominatimAbort) { nominatimAbort.abort(); nominatimAbort = null; }
  worldState.hasResolvedFirstRemoteSnapshot = false;
  worldState.initialized = false;
}

export function getListenerCount() {
  let count = 0;
  if (worldState.abortController) count++;
  if (worldState.firebaseUnsub) count++;
  if (worldState.remoteWriteTimer) count++;
  return count;
}
