import { auth, db, firebasePaths, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createLeafletMap, DEFAULT_MAP_CENTER_SPAIN, DEFAULT_MAP_ZOOM_SPAIN, destroyLeafletMap, ensureLeaflet, invalidateLeafletMap, MAX_AUTO_ZOOM, setLeafletViewForPoints } from "../../shared/vendors/leaflet.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";
import { getCountryEnglishName } from "./countries.js";

const WORLD_PATH = (uid) => firebasePaths.world(uid);
const $id = (id) => document.getElementById(id);
const iso2 = (v) => String(v || "").trim().toUpperCase();
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));

const GEO_KEYWORDS = /(country|state|region|province|city|town|village|municipality|county|district|neighbourhood|suburb|hamlet|administrative)/i;
const PLACE_KEYWORDS = /(restaurant|cafe|bar|burger|hotel|hostel|pharmacy|hospital|shop|store|mall|supermarket|toilet|parking|bank|business|amenity|tourism|leisure)/i;

const state = {
  initialized: false, firebaseUnsub: null, firebaseRef: null,
  visits: [], customPins: [], areaVisits: [],
  mainMap: null, miniMap: null, mapLayer: null, miniLayer: null,
  activeWindow: "map", addMode: "geo", rating: 0,
  selectedGeo: null, selectedPlace: null,
  placeResults: [], geoResults: [], localSearchError: "",
  userCenter: { lat: DEFAULT_MAP_CENTER_SPAIN[0], lon: DEFAULT_MAP_CENTER_SPAIN[1] },
  currentSearchCenter: null,
};
const createId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const nowTs = () => Date.now();
const placeTypeHint = (v = {}) => String(v.kind || v.type || v.class || v.category || v.folder || "").toLowerCase();

function normalizeRecord(v = {}) {
  return {
    id: String(v.id || createId()), ts: Number(v.ts) || nowTs(),
    kind: String(v.kind || (v.rating != null ? "place" : "geo")),
    type: String(v.type || ""),
    placeName: String(v.placeName || v.name || "").trim(),
    countryCode: iso2(v.countryCode || v.country || v.country_code), country: String(v.country || "").trim(),
    subdivision: String(v.subdivision || v.region || "").trim(), city: String(v.city || v.town || v.municipality || "").trim(),
    lat: Number.isFinite(Number(v.lat)) ? Number(v.lat) : null, lon: Number.isFinite(Number(v.lon)) ? Number(v.lon) : null,
    rating: Number.isFinite(Number(v.rating)) ? Math.max(0, Math.min(10, Number(v.rating))) : null,
    note: String(v.note || ""), folder: String(v.folder || v.category || "").trim(), source: String(v.source || v.origin || "manual"),
    osmType: String(v.osmType || v.osm_type || ""), osmClass: String(v.osmClass || v.class || ""),
  };
}

export function isGeographicRecord(record = {}) {
  if (!record) return false;
  const kind = String(record.kind || "").toLowerCase();
  const hint = `${placeTypeHint(record)} ${record.osmType || ""} ${record.osmClass || ""}`;
  return kind === "geo" || GEO_KEYWORDS.test(hint) || (!record.rating && !PLACE_KEYWORDS.test(hint) && !!(record.city || record.country || record.subdivision));
}
export function isRatedPlaceRecord(record = {}) {
  if (!record || isGeographicRecord(record)) return false;
  const hint = placeTypeHint(record);
  const hasExplicitPlaceType = ["local", "place", "poi", "business"].includes(hint);
  const hasRating = Number.isFinite(Number(record.rating));
  const selectedPlaceLike = ["place_search", "osm_place"].includes(String(record.source || "")) && PLACE_KEYWORDS.test(`${hint} ${record.osmClass || ""}`);
  return hasExplicitPlaceType || hasRating || selectedPlaceLike;
}

export function classifyWorldPlace(record = {}) { const n = `${record.placeName || ""} ${record.folder || ""}`.toLowerCase(); if (n.includes("burger king")) return "Burger King"; if (n.includes("mcdonald")) return "McDonald’s"; if (n.includes("kfc")) return "KFC"; if (/(farmacia|pharmacy)/.test(n)) return "Farmacias"; if (/(baño|wc|toilet)/.test(n)) return "Baños"; if (/(supermercado|supermarket)/.test(n)) return "Supermercados"; if (/(mall|centro comercial)/.test(n)) return "Centros comerciales"; if (n.includes("hotel")) return "Hoteles"; if (/(caf[eé]|cafeter[ií]a)/.test(n)) return "Cafeterías"; if (/(restaurante|bar|restaurant)/.test(n)) return "Restauración"; return "Otros"; }

const getAllRecords = () => [...state.visits, ...state.customPins, ...state.areaVisits].map(normalizeRecord);
const distanceMeters = (aLat, aLng, bLat, bLng) => { const R = 6371000; const dLat = (bLat - aLat) * Math.PI / 180; const dLng = (bLng - aLng) * Math.PI / 180; const aa = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)); };
const buildViewboxFromCenterRadius = (lat, lng, radiusMeters) => { const dLat = radiusMeters / 111320; const dLng = radiusMeters / (111320 * Math.cos((lat * Math.PI) / 180)); return { left: lng - dLng, right: lng + dLng, top: lat + dLat, bottom: lat - dLat }; };

async function getCurrentPositionSafe() { console.info("[world:local:position:start]"); return new Promise((resolve) => navigator.geolocation?.getCurrentPosition((pos) => { const center = { lat: pos.coords.latitude, lon: pos.coords.longitude }; console.info("[world:local:position:success]", center); resolve(center); }, (error) => { console.warn("[world:local:position:error]", error); resolve(null); }, { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }) || resolve(null)); }

async function searchPlacesNearby(query, center, radiusMeters) {
  console.info("[world:local:search:center]", center); console.info("[world:local:search:radius]", radiusMeters);
  const vb = buildViewboxFromCenterRadius(center.lat, center.lon, radiusMeters); console.info("[world:local:search:viewbox]", vb);
  const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", query); u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "30"); u.searchParams.set("bounded", "1"); u.searchParams.set("viewbox", `${vb.left},${vb.top},${vb.right},${vb.bottom}`);
  const rows = await (await fetch(u.toString())).json(); console.info("[world:local:search:raw-results]", rows.length);
  const filtered = rows.map((row) => ({ ...row, distance: distanceMeters(center.lat, center.lon, Number(row.lat), Number(row.lon)) })).filter((r) => Number.isFinite(r.distance) && r.distance <= radiusMeters).sort((a, b) => a.distance - b.distance);
  console.info("[world:local:search:filtered-results]", filtered.length);
  return filtered;
}

function persist() { if (!state.firebaseRef) return Promise.resolve(); return update(state.firebaseRef, { visits: state.visits, customPins: state.customPins, areaVisits: state.areaVisits, updatedAt: nowTs() }); }
function renderStars() { const host = $id("world-rating-stars"); if (!host) return; host.innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" data-star="${i + 1}" class="${state.rating >= i + 1 ? "active" : ""}">${state.rating >= i + 1 ? "★" : "☆"}</button>`).join(""); host.querySelectorAll("button").forEach((btn) => { btn.addEventListener("click", () => { state.rating = Number(btn.dataset.star || 0); renderStars(); }); btn.addEventListener("pointermove", (ev) => { if (ev.buttons !== 1) return; state.rating = Number(btn.dataset.star || 0); renderStars(); }); }); }

function renderMapPanel(records) { const host = $id("world-country-list"); const countries = new Map(); records.filter(isGeographicRecord).forEach((r) => { const key = r.countryCode || "??"; if (!countries.has(key)) countries.set(key, []); countries.get(key).push(r); }); host.innerHTML = [...countries.entries()].map(([code, rows]) => `<details class="world-country-row"><summary><strong>${esc(getCountryEnglishName(code) || code)}</strong> · ${rows.length} ubicaciones</summary>${[...new Map(rows.map((r) => [r.city || r.placeName || "Sin ciudad", true])).keys()].map((city) => `<div class="world-item"><div><div class="name">${esc(city)}</div></div></div>`).join("")}</details>`).join("") || '<div class="geo-empty">Aún no hay geografía guardada.</div>'; $id("world-country-count").textContent = String(records.filter(isGeographicRecord).length); }
function renderLocalsPanel(records) { const host = $id("world-locals-list"); const rated = records.filter(isRatedPlaceRecord); host.innerHTML = rated.map((r) => `<div class="world-item"><div><div class="name">${esc(r.placeName || "Local")}</div><div class="meta">${esc(r.city || "")} · ${r.rating ?? "-"}/10</div></div></div>`).join("") || '<div class="geo-empty">Sin locales valorados.</div>'; $id("world-locals-count").textContent = String(rated.length); }
async function renderMap(records) { if (!state.mainMap) state.mainMap = createLeafletMap($id("world-map"), { center: [state.userCenter.lat, state.userCenter.lon], zoom: DEFAULT_MAP_ZOOM_SPAIN }); if (state.mapLayer) state.mainMap.removeLayer(state.mapLayer); const L = window.L; state.mapLayer = L.layerGroup(); records.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)).forEach((r) => state.mapLayer.addLayer(L.circleMarker([r.lat, r.lon], { radius: 4, color: "#fff", weight: 1, fillColor: isRatedPlaceRecord(r) ? "#ffd166" : "#4fd0ff", fillOpacity: 0.9 }))); state.mainMap.addLayer(state.mapLayer); setLeafletViewForPoints(state.mainMap, records.filter((r) => Number.isFinite(r.lat)).map((r) => ({ lat: r.lat, lng: r.lon })), { defaultCenter: DEFAULT_MAP_CENTER_SPAIN, defaultZoom: DEFAULT_MAP_ZOOM_SPAIN, maxAutoZoom: MAX_AUTO_ZOOM, singlePointZoom: 12 }); invalidateLeafletMap(state.mainMap, 40); }
async function renderAll() { const all = getAllRecords(); await renderMap(all); renderMapPanel(all); renderLocalsPanel(all); const geo = all.filter(isGeographicRecord); const rated = all.filter(isRatedPlaceRecord); const avg = rated.length ? rated.reduce((a, r) => a + Number(r.rating || 0), 0) / rated.length : 0; $id("world-countries").textContent = String(new Set(geo.map((r) => r.countryCode).filter(Boolean)).size); $id("world-geo-count").textContent = String(geo.length); $id("world-rated-locals").textContent = String(rated.length); $id("world-global-average").textContent = rated.length ? `${avg.toFixed(1)}/10` : "-"; }

function renderLocalSearchMap() { const host = $id("world-mini-map"); if (!host || !window.L) return; if (!state.miniMap) state.miniMap = createLeafletMap(host, { center: [state.currentSearchCenter?.lat || state.userCenter.lat, state.currentSearchCenter?.lon || state.userCenter.lon], zoom: 14 }); invalidateLeafletMap(state.miniMap, 60); }
function renderLocalSearchResults() { const host = $id("world-place-results"); host.innerHTML = state.localSearchError ? `<div class="geo-empty">${esc(state.localSearchError)}</div>` : (state.placeResults.length ? state.placeResults.map((r, i) => `<div class="world-item"><div><div class="name">${esc((r.display_name || "").split(",")[0])}</div><div class="meta">${Math.round(r.distance)}m</div></div><button class="btn" data-place-pick="${i}">Seleccionar</button></div>`).join("") : '<div class="geo-empty">No hay resultados en este radio.</div>'); host.querySelectorAll("[data-place-pick]").forEach((btn) => btn.addEventListener("click", () => { const row = state.placeResults[Number(btn.dataset.placePick)]; const a = row.address || {}; state.selectedPlace = normalizeRecord({ kind: "place", type: "place", source: "place_search", osmClass: row.class, placeName: (row.display_name || "").split(",")[0], lat: Number(row.lat), lon: Number(row.lon), countryCode: iso2(a.country_code), country: a.country || "", subdivision: a.state || "", city: a.city || a.town || a.village || a.municipality || "", rating: state.rating }); })); }

function bindUI() {
  $id("world-add-toggle")?.addEventListener("change", async (e) => { if (!e.target.checked) return; const pos = await getCurrentPositionSafe(); if (pos) { state.userCenter = pos; state.currentSearchCenter = pos; } else state.localSearchError = "No se pudo obtener ubicación actual"; renderLocalSearchMap(); });
  $id("world-geo-save")?.addEventListener("click", async () => { try { console.info("[world:geo:save:start]"); console.info("[world:geo:selected]", state.selectedGeo); if (!state.selectedGeo) return; console.info("[world:geo:save:path]", state.firebaseRef?.toString?.() || "world"); const payload = normalizeRecord({ ...state.selectedGeo, kind: "geo", type: "geo", rating: null, note: $id("world-geo-note")?.value || "" }); console.info("[world:geo:save:payload]", payload); state.visits.push(payload); await persist(); await renderAll(); console.info("[world:geo:save:success]", payload.id); } catch (error) { console.error("[world:geo:save:error]", error); } });
  $id("world-geo-q")?.addEventListener("input", async (e) => { const q = e.target.value.trim(); if (q.length < 2) return; const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", q); u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8"); state.geoResults = await (await fetch(u.toString())).json(); $id("world-geo-results").innerHTML = state.geoResults.map((r, i) => `<div class="world-item"><div><div class="name">${esc((r.display_name || "").split(",")[0])}</div><div class="meta">${esc(r.display_name || "")}</div></div><button class="btn" data-geo-pick="${i}">Elegir</button></div>`).join(""); document.querySelectorAll("[data-geo-pick]").forEach((btn) => btn.addEventListener("click", () => { const row = state.geoResults[Number(btn.dataset.geoPick)]; const a = row.address || {}; state.selectedGeo = { lat: Number(row.lat), lon: Number(row.lon), countryCode: iso2(a.country_code), country: a.country || "", subdivision: a.state || "", city: a.city || a.town || a.village || a.municipality || "", placeName: (row.display_name || "").split(",")[0], kind: "geo", type: "city", source: "geo_search" }; console.info("[world:geo:selected]", state.selectedGeo); })); });
  $id("world-place-q")?.addEventListener("input", async (e) => { const q = e.target.value.trim(); if (q.length < 2) return; const radius = Number($id("world-place-radius")?.value || 1000); const center = state.currentSearchCenter || state.userCenter; state.placeResults = await searchPlacesNearby(q, center, radius); state.localSearchError = ""; renderLocalSearchResults(); });
  $id("world-place-radius")?.addEventListener("change", () => $id("world-place-q")?.dispatchEvent(new Event("input")));
  $id("world-place-save")?.addEventListener("click", async () => { if (!state.selectedPlace) return; state.selectedPlace.rating = Math.max(0, Math.min(10, state.rating)); state.selectedPlace.note = $id("world-place-note")?.value || ""; state.visits.push(normalizeRecord(state.selectedPlace)); await persist(); await renderAll(); });
}

export async function init() { if (state.initialized) return; state.initialized = true; await ensureLeaflet().catch(() => {}); const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid; if (uid) { state.firebaseRef = ref(db, WORLD_PATH(uid)); state.firebaseUnsub = trackedOnValue(state.firebaseRef, (snapshot) => { const v = snapshot.val() || {}; state.visits = (v.visits || []).map(normalizeRecord); state.customPins = (v.customPins || []).map(normalizeRecord); state.areaVisits = (v.areaVisits || []).map(normalizeRecord); renderAll(); }, { key: "world-root", path: WORLD_PATH(uid), module: "world", mode: "onValue", reason: "world-live-sync", viewId: "view-world" }, onValue); } bindUI(); renderStars(); await renderAll(); }
export function destroy() { if (state.mainMap) { destroyLeafletMap($id("world-map")); state.mainMap = null; } if (state.miniMap) { destroyLeafletMap($id("world-mini-map")); state.miniMap = null; } if (state.firebaseUnsub) state.firebaseUnsub(); state.firebaseUnsub = null; state.initialized = false; }
export function getListenerCount() { return state.firebaseUnsub ? 1 : 0; }
export async function onShow() { if (!state.initialized) await init(); }
export async function onHide() { destroy(); }
