import { auth, db, firebasePaths, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createLeafletMap, DEFAULT_MAP_CENTER_SPAIN, DEFAULT_MAP_ZOOM_SPAIN, destroyLeafletMap, ensureLeaflet, invalidateLeafletMap, MAX_AUTO_ZOOM, setLeafletViewForPoints } from "../../shared/vendors/leaflet.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";
import { getCountryEnglishName } from "./countries.js";

const WORLD_PATH = (uid) => firebasePaths.world(uid);
const $id = (id) => document.getElementById(id);
const iso2 = (v) => String(v || "").trim().toUpperCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const state = {
  initialized: false, firebaseUnsub: null, firebaseRef: null,
  visits: [], customPins: [], areaVisits: [],
  mainMap: null, miniMap: null, mapLayer: null,
  activeWindow: "map", addMode: "geo", rating: 0,
  selectedGeo: null, selectedPlace: null,
  placeResults: [], geoResults: [],
  userCenter: { lat: DEFAULT_MAP_CENTER_SPAIN[0], lon: DEFAULT_MAP_CENTER_SPAIN[1] },
};

const createId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const nowTs = () => Date.now();

function normalizeRecord(v = {}) {
  return {
    id: String(v.id || createId()),
    ts: Number(v.ts) || nowTs(),
    kind: String(v.kind || (v.rating != null ? "place" : "geo")),
    placeName: String(v.placeName || v.name || "").trim(),
    countryCode: iso2(v.countryCode || v.country || v.country_code),
    country: String(v.country || "").trim(),
    subdivision: String(v.subdivision || v.region || "").trim(),
    city: String(v.city || v.town || v.municipality || "").trim(),
    lat: Number.isFinite(Number(v.lat)) ? Number(v.lat) : null,
    lon: Number.isFinite(Number(v.lon)) ? Number(v.lon) : null,
    rating: Number.isFinite(Number(v.rating)) ? Math.max(0, Math.min(10, Number(v.rating))) : null,
    note: String(v.note || ""),
    folder: String(v.folder || v.category || "").trim(),
    source: String(v.source || v.origin || "manual"),
  };
}

export function classifyWorldPlace(record = {}) {
  const n = `${record.placeName || ""} ${record.folder || ""}`.toLowerCase();
  if (n.includes("burger king")) return "Burger King";
  if (n.includes("mcdonald")) return "McDonald’s";
  if (n.includes("kfc")) return "KFC";
  if (/(farmacia|pharmacy)/.test(n)) return "Farmacias";
  if (/(baño|wc|toilet)/.test(n)) return "Baños";
  if (/(supermercado|supermarket)/.test(n)) return "Supermercados";
  if (/(mall|centro comercial)/.test(n)) return "Centros comerciales";
  if (n.includes("hotel")) return "Hoteles";
  if (/(caf[eé]|cafeter[ií]a)/.test(n)) return "Cafeterías";
  if (/(restaurante|bar|restaurant)/.test(n)) return "Restauración";
  return "Otros";
}

export function isGeographicRecord(record = {}) {
  if (!record) return false;
  return record.kind === "geo" || (record.rating == null && !record.placeName) || (record.rating == null && ["current_location", "geo_search"].includes(record.source));
}

export function isRatedPlaceRecord(record = {}) {
  if (!record) return false;
  return !isGeographicRecord(record) && Number.isFinite(Number(record.rating));
}

export function getTerritoryAverage(records = [], level = "country") {
  const list = records.filter(isRatedPlaceRecord).filter((r) => {
    if (level === "country") return !!r.countryCode;
    if (level === "region") return !!r.subdivision;
    if (level === "city") return !!r.city;
    return true;
  });
  if (!list.length) return { average: 0, count: 0 };
  const total = list.reduce((acc, r) => acc + Number(r.rating || 0), 0);
  return { average: total / list.length, count: list.length };
}

function getAllRecords() {
  return [...state.visits, ...state.customPins, ...state.areaVisits].map(normalizeRecord);
}

async function reverseGeocode(lat, lon) {
  try {
    const u = new URL("https://nominatim.openstreetmap.org/reverse");
    u.searchParams.set("format", "json"); u.searchParams.set("lat", String(lat)); u.searchParams.set("lon", String(lon)); u.searchParams.set("addressdetails", "1");
    const r = await fetch(u.toString());
    const d = await r.json();
    const a = d.address || {};
    return { countryCode: iso2(a.country_code), country: a.country || "", subdivision: a.state || a.region || "", city: a.city || a.town || a.village || a.municipality || "" };
  } catch (error) {
    console.warn("[world:reverse:error]", error);
    return { countryCode: "", country: "", subdivision: "", city: "" };
  }
}

async function searchGeo(q) {
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q); u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8");
  const r = await fetch(u.toString());
  return r.json();
}

async function searchNearbyPlaces(q, radius) {
  const [lat, lon] = [state.userCenter.lat, state.userCenter.lon];
  const d = radius / 111320;
  const left = lon - d; const right = lon + d; const top = lat + d; const bottom = lat - d;
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q); u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "20");
  u.searchParams.set("bounded", "1");
  u.searchParams.set("viewbox", `${left},${top},${right},${bottom}`);
  const r = await fetch(u.toString());
  const rows = await r.json();
  return rows.filter((row) => {
    const la = Number(row.lat); const lo = Number(row.lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo)) return false;
    const dist = Math.hypot((la - lat) * 111320, (lo - lon) * 111320);
    return dist <= radius;
  });
}

function persist() {
  if (!state.firebaseRef) return;
  update(state.firebaseRef, { visits: state.visits, customPins: state.customPins, areaVisits: state.areaVisits, updatedAt: nowTs() }).catch((e) => console.error("[world:persist:error]", e));
}

function renderStars() {
  const host = $id("world-rating-stars");
  if (!host) return;
  host.innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" data-star="${i + 1}" class="${state.rating >= i + 1 ? "active" : ""}">★</button>`).join("");
  const buttons = host.querySelectorAll("button");
  buttons.forEach((btn) => {
    btn.addEventListener("click", () => { state.rating = Number(btn.dataset.star || 0); renderStars(); });
    btn.addEventListener("pointermove", (ev) => { if (ev.buttons !== 1) return; state.rating = Number(btn.dataset.star || 0); renderStars(); });
  });
}

function renderMapPanel(records) {
  const host = $id("world-country-list");
  const countries = new Map();
  records.filter(isGeographicRecord).forEach((r) => {
    const key = r.countryCode || "??";
    if (!countries.has(key)) countries.set(key, []);
    countries.get(key).push(r);
  });
  const html = [...countries.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([code, rows]) => {
    const byCity = new Map();
    rows.forEach((r) => {
      const city = r.city || "Sin ciudad";
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push(r);
    });
    return `<details class="world-country-row"><summary><strong>${esc(getCountryEnglishName(code) || code)}</strong> · ${rows.length} ubicaciones</summary>${[...byCity.entries()].map(([city, cityRows]) => `<div class="world-item"><div><div class="name">${esc(city)}</div><div class="meta">${cityRows.length} registros</div></div></div>`).join("")}</details>`;
  }).join("");
  host.innerHTML = html || '<div class="geo-empty">Aún no hay geografía guardada.</div>';
  $id("world-country-count").textContent = String(records.filter(isGeographicRecord).length);
}

function renderLocalsPanel(records) {
  const host = $id("world-locals-list");
  const groupBy = $id("world-locals-group")?.value || "type";
  const rated = records.filter(isRatedPlaceRecord);
  let html = "";
  if (groupBy === "top") {
    html = rated.sort((a, b) => (b.rating || 0) - (a.rating || 0)).map((r) => `<div class="world-item"><div><div class="name">${esc(r.placeName || "Local")}</div><div class="meta">${esc(classifyWorldPlace(r))} · ${r.rating}/10</div></div></div>`).join("");
  } else if (groupBy === "recent") {
    html = rated.sort((a, b) => b.ts - a.ts).map((r) => `<div class="world-item"><div><div class="name">${esc(r.placeName || "Local")}</div><div class="meta">${esc(r.city)} · ${r.rating}/10</div></div></div>`).join("");
  } else {
    const map = new Map();
    rated.forEach((r) => {
      const key = groupBy === "country" ? (getCountryEnglishName(r.countryCode) || r.countryCode || "Sin país") : groupBy === "region" ? (r.subdivision || "Sin región") : groupBy === "city" ? (r.city || "Sin ciudad") : classifyWorldPlace(r);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(r);
    });
    html = [...map.entries()].map(([key, rows]) => {
      const avg = groupBy === "country" ? getTerritoryAverage(rows, "country") : groupBy === "region" ? getTerritoryAverage(rows, "region") : groupBy === "city" ? getTerritoryAverage(rows, "city") : { average: 0, count: rows.length };
      return `<details class="world-country-row"><summary><strong>${esc(key)}</strong>${["country", "region", "city"].includes(groupBy) ? ` · ★${avg.average.toFixed(1)}/10 · ${avg.count} locales` : ` · ${rows.length} locales`}</summary>${rows.map((r) => `<div class="world-item"><div><div class="name">${esc(r.placeName || "Local")}</div><div class="meta">${r.rating}/10 · ${esc(r.city || "")}</div></div></div>`).join("")}</details>`;
    }).join("");
  }
  host.innerHTML = html || '<div class="geo-empty">Sin locales valorados.</div>';
  $id("world-locals-count").textContent = String(rated.length);
}

async function renderMap(records) {
  try {
    if (!state.mainMap) {
      state.mainMap = createLeafletMap($id("world-map"), { center: [state.userCenter.lat, state.userCenter.lon], zoom: DEFAULT_MAP_ZOOM_SPAIN });
    }
    if (state.mapLayer) state.mainMap.removeLayer(state.mapLayer);
    const L = window.L;
    if (!L) throw new Error("Leaflet no disponible");
    const withCoords = records.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon));
    state.mapLayer = L.layerGroup();
    withCoords.forEach((r) => {
      const color = isRatedPlaceRecord(r) ? "#ffd166" : "#4fd0ff";
      state.mapLayer.addLayer(L.circleMarker([r.lat, r.lon], { radius: 4, color: "#fff", weight: 1, fillColor: color, fillOpacity: 0.9 }).bindTooltip(`${esc(r.placeName || r.city || "Punto")}`));
    });
    state.mainMap.addLayer(state.mapLayer);
    setLeafletViewForPoints(state.mainMap, withCoords.map((r) => ({ lat: r.lat, lng: r.lon })), { defaultCenter: DEFAULT_MAP_CENTER_SPAIN, defaultZoom: DEFAULT_MAP_ZOOM_SPAIN, maxAutoZoom: MAX_AUTO_ZOOM, singlePointZoom: 12 });
    invalidateLeafletMap(state.mainMap, 40);
  } catch (error) {
    console.error("[world:render:error]", error);
    const mapHost = $id("world-map");
    if (mapHost) mapHost.innerHTML = '<div class="geo-empty">Mapa no disponible. La lista sigue operativa.</div>';
  }
}

async function renderAll() {
  const all = getAllRecords();
  await renderMap(all);
  renderMapPanel(all);
  renderLocalsPanel(all);
  const rated = all.filter(isRatedPlaceRecord);
  const avg = rated.length ? (rated.reduce((acc, r) => acc + Number(r.rating || 0), 0) / rated.length) : 0;
  $id("world-countries").textContent = String(new Set(all.filter(isGeographicRecord).map((r) => r.countryCode).filter(Boolean)).size);
  $id("world-geo-count").textContent = String(all.filter(isGeographicRecord).length);
  $id("world-rated-locals").textContent = String(rated.length);
  $id("world-global-average").textContent = rated.length ? `${avg.toFixed(1)}/10` : "-";
}

function bindUI() {
  document.getElementById("view-world")?.addEventListener("click", (e) => {
    const tab = e.target.closest("[data-window]");
    if (tab) {
      state.activeWindow = tab.dataset.window;
      document.querySelectorAll("#view-world .world-window-tab").forEach((el) => el.classList.toggle("active", el.dataset.window === state.activeWindow));
      document.querySelectorAll("#view-world [data-window-panel]").forEach((el) => el.classList.toggle("active", el.dataset.windowPanel === state.activeWindow));
    }
  });

  $id("world-locals-group")?.addEventListener("change", () => renderLocalsPanel(getAllRecords()));

  $id("world-add-mode-geo")?.addEventListener("click", () => { state.addMode = "geo"; $id("world-geo-mode").hidden = false; $id("world-place-mode").hidden = true; });
  $id("world-add-mode-place")?.addEventListener("click", () => { state.addMode = "place"; $id("world-geo-mode").hidden = true; $id("world-place-mode").hidden = false; });

  $id("world-mark-current")?.addEventListener("click", () => navigator.geolocation?.getCurrentPosition(async (pos) => {
    state.userCenter = { lat: pos.coords.latitude, lon: pos.coords.longitude };
    const geo = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
    state.selectedGeo = { lat: pos.coords.latitude, lon: pos.coords.longitude, ...geo, placeName: geo.city || "Ubicación actual", source: "current_location" };
  }));

  $id("world-geo-q")?.addEventListener("input", async (e) => {
    const q = e.target.value.trim();
    if (q.length < 2) return;
    try {
      state.geoResults = await searchGeo(q);
      const host = $id("world-geo-results");
      host.innerHTML = state.geoResults.map((r, i) => `<div class="world-item"><div><div class="name">${esc((r.display_name || "").split(",")[0])}</div><div class="meta">${esc(r.display_name || "")}</div></div><button class="btn" data-geo-pick="${i}">Elegir</button></div>`).join("");
      host.querySelectorAll("[data-geo-pick]").forEach((btn) => btn.addEventListener("click", () => {
        const row = state.geoResults[Number(btn.dataset.geoPick)];
        const a = row.address || {};
        state.selectedGeo = { lat: Number(row.lat), lon: Number(row.lon), countryCode: iso2(a.country_code), country: a.country || "", subdivision: a.state || "", city: a.city || a.town || a.village || a.municipality || "", placeName: (row.display_name || "").split(",")[0], source: "geo_search" };
      }));
    } catch (error) {
      console.warn("[world:geo:search:error]", error);
    }
  });

  $id("world-geo-save")?.addEventListener("click", () => {
    if (!state.selectedGeo) return;
    state.visits.push(normalizeRecord({ ...state.selectedGeo, kind: "geo", rating: null, note: $id("world-geo-note")?.value || "" }));
    persist(); renderAll();
  });

  $id("world-place-q")?.addEventListener("input", async (e) => {
    const q = e.target.value.trim(); if (q.length < 2) return;
    try {
      const radius = Number($id("world-place-radius")?.value || 1000);
      state.placeResults = await searchNearbyPlaces(q, radius);
      const host = $id("world-place-results");
      host.innerHTML = state.placeResults.map((r, i) => `<div class="world-item"><div><div class="name">${esc((r.display_name || "").split(",")[0])}</div><div class="meta">${esc(r.display_name || "")}</div></div><button class="btn" data-place-pick="${i}">Seleccionar</button></div>`).join("");
      host.querySelectorAll("[data-place-pick]").forEach((btn) => btn.addEventListener("click", async () => {
        const row = state.placeResults[Number(btn.dataset.placePick)];
        const a = row.address || {};
        state.selectedPlace = normalizeRecord({ placeName: (row.display_name || "").split(",")[0], lat: Number(row.lat), lon: Number(row.lon), countryCode: iso2(a.country_code), country: a.country || "", subdivision: a.state || "", city: a.city || a.town || a.village || a.municipality || "", folder: classifyWorldPlace({ placeName: (row.display_name || "").split(",")[0] }), kind: "place", rating: state.rating });
      }));
    } catch (error) {
      console.warn("[world:place:search:error]", error);
    }
  });

  $id("world-place-save")?.addEventListener("click", () => {
    if (!state.selectedPlace) return;
    state.selectedPlace.rating = state.rating;
    state.selectedPlace.note = $id("world-place-note")?.value || "";
    state.visits.push(normalizeRecord(state.selectedPlace));
    persist(); renderAll();
  });
}

export async function init() {
  if (state.initialized) return;
  console.info("[world:init:start]");
  try {
    state.initialized = true;
    await ensureLeaflet().catch((e) => console.warn("[world:leaflet:fallback]", e));
    const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
    if (uid) {
      state.firebaseRef = ref(db, WORLD_PATH(uid));
      state.firebaseUnsub = trackedOnValue(state.firebaseRef, (snapshot) => {
        const v = snapshot.val() || {};
        state.visits = (v.visits || []).map(normalizeRecord);
        state.customPins = (v.customPins || []).map(normalizeRecord);
        state.areaVisits = (v.areaVisits || []).map(normalizeRecord);
        renderAll().catch((err) => console.error("[world:render:error]", err));
      }, { key: "world-root", path: WORLD_PATH(uid), module: "world", mode: "onValue", reason: "world-live-sync", viewId: "view-world" }, onValue);
    }
    bindUI();
    renderStars();
    await renderAll();
    console.info("[world:module:ready]");
  } catch (error) {
    console.error("[world:init:error]", error);
    state.initialized = false;
  }
}

export function destroy() {
  if (state.mainMap) { destroyLeafletMap($id("world-map")); state.mainMap = null; }
  if (state.firebaseUnsub) state.firebaseUnsub();
  state.firebaseUnsub = null;
  state.initialized = false;
}

export function getListenerCount() { return state.firebaseUnsub ? 1 : 0; }
export async function onShow() { if (!state.initialized) await init(); }
export async function onHide() { destroy(); }
