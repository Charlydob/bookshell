import { auth, db, firebasePaths, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createLeafletMap, DEFAULT_MAP_CENTER_SPAIN, DEFAULT_MAP_ZOOM_SPAIN, destroyLeafletMap, ensureLeaflet, invalidateLeafletMap, MAX_AUTO_ZOOM, setLeafletViewForPoints } from "../../shared/vendors/leaflet.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";
import { getCountryEnglishName } from "./countries.js";

const WORLD_PATH = (uid) => firebasePaths.world(uid);
const $id = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (m) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[m]));
const iso2 = (v) => String(v || "").trim().toUpperCase();
const GEO_KEYWORDS = /(country|state|region|province|city|town|village|municipality|county|district|neighbourhood|suburb|hamlet|administrative)/i;
const PLACE_KEYWORDS = /(restaurant|cafe|bar|burger|hotel|hostel|pharmacy|hospital|shop|store|mall|supermarket|toilet|parking|bank|business|amenity|tourism|leisure)/i;

const state = {
  initialized: false, firebaseUnsub: null, firebaseRef: null,
  visits: [], customPins: [], areaVisits: [],
  mainMap: null, mainLayer: null, miniMap: null, miniLayer: null,
  activeWindow: "map", addMode: "geo", rating: 0,
  selectedGeo: null, selectedPlace: null,
  placeResults: [], geoResults: [], localSearchError: "",
  userCenter: { lat: DEFAULT_MAP_CENTER_SPAIN[0], lon: DEFAULT_MAP_CENTER_SPAIN[1] },
  currentSearchCenter: null,
};

const nowTs = () => Date.now();
const createId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const getAllRecords = () => [...state.visits, ...state.customPins, ...state.areaVisits].map(normalizeRecord);

function logError(context, error) { console.error("[world:error]", context, error); }
function normalizeRecord(v = {}) { return { id: String(v.id || createId()), ts: Number(v.ts) || nowTs(), kind: String(v.kind || (v.rating != null ? "place" : "geo")), type: String(v.type || ""), placeName: String(v.placeName || v.name || "").trim(), countryCode: iso2(v.countryCode || v.country_code || v.country), country: String(v.country || "").trim(), subdivision: String(v.subdivision || v.region || "").trim(), city: String(v.city || v.town || v.village || "").trim(), lat: Number(v.lat), lon: Number(v.lon), rating: Number.isFinite(Number(v.rating)) ? Math.max(0, Math.min(10, Number(v.rating))) : null, note: String(v.note || ""), source: String(v.source || "manual"), osmType: String(v.osmType || v.osm_type || ""), osmClass: String(v.osmClass || v.class || "") }; }

export function isGeographicRecord(record = {}) { const kind = String(record.kind || "").toLowerCase(); const hint = `${record.type || ""} ${record.osmType || ""} ${record.osmClass || ""}`; return kind === "geo" || GEO_KEYWORDS.test(hint) || (!record.rating && !PLACE_KEYWORDS.test(hint) && !!(record.city || record.country || record.subdivision)); }
export function isRatedPlaceRecord(record = {}) { if (!record || isGeographicRecord(record)) return false; const hint = `${record.type || ""} ${record.osmClass || ""}`; return Number.isFinite(Number(record.rating)) || /local|place|poi|business/i.test(hint) || (record.source === "place_search" && PLACE_KEYWORDS.test(hint)); }

function setWindowMode(mode) {
  state.activeWindow = mode;
  console.info(mode === "map" ? "[world:tab:map]" : "[world:tab:locales]");
  document.querySelectorAll("#view-world .world-window-tab").forEach((btn) => btn.classList.toggle("active", btn.dataset.window === mode));
  document.querySelectorAll("#view-world [data-window-panel]").forEach((panel) => panel.classList.toggle("active", panel.dataset.windowPanel === mode));
  if (state.mainMap) invalidateLeafletMap(state.mainMap, 50);
}

function setAddMode(mode) {
  state.addMode = mode;
  const geo = $id("world-geo-mode");
  const place = $id("world-place-mode");
  $id("world-add-mode-geo")?.classList.toggle("active", mode === "geo");
  $id("world-add-mode-place")?.classList.toggle("active", mode === "local");
  if (geo) geo.hidden = mode !== "geo";
  if (place) place.hidden = mode !== "local";
  if (mode === "geo") console.info("[world:add:mode:geo]");
  if (mode === "local") { console.info("[world:add:mode:local]"); initMiniMap(); }
}

async function getCurrentPositionSafe() {
  return new Promise((resolve) => navigator.geolocation?.getCurrentPosition((pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }), () => resolve(null), { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }) || resolve(null));
}

function renderStars() {
  const host = $id("world-rating-stars"); if (!host) return;
  host.innerHTML = Array.from({ length: 10 }, (_, i) => `<button type="button" data-star="${i + 1}" class="${state.rating >= i + 1 ? "active" : ""}">${state.rating >= i + 1 ? "★" : "☆"}</button>`).join("");
}

function markerPopupHtml(r) {
  if (isRatedPlaceRecord(r)) {
    return `<div><strong>${esc(r.placeName || "Local")}</strong><div>${esc(r.city || "")}, ${esc(r.country || r.countryCode || "")}</div><div>${"★".repeat(Math.max(0, Math.round(r.rating || 0)))} ${r.rating ?? "-"}/10</div>${r.note ? `<div>${esc(r.note)}</div>` : ""}<div class="actions"><button type="button" class="btn" data-action="center" data-id="${esc(r.id)}">Centrar</button><button type="button" class="btn" data-action="detail" data-id="${esc(r.id)}">Ver detalle</button><button type="button" class="btn" data-action="delete" data-id="${esc(r.id)}">Borrar</button></div></div>`;
  }
  return `<div><strong>${esc(r.placeName || r.city || "Ubicación")}</strong><div>Tipo: ${esc(r.type || "ciudad")}</div><div>${esc(r.subdivision || "")} ${esc(r.country || r.countryCode || "")}</div>${r.ts ? `<div>${new Date(r.ts).toLocaleDateString()}</div>` : ""}<div class="actions"><button type="button" class="btn" data-action="center" data-id="${esc(r.id)}">Centrar</button><button type="button" class="btn" data-action="edit" data-id="${esc(r.id)}">Editar</button><button type="button" class="btn" data-action="delete" data-id="${esc(r.id)}">Borrar</button></div></div>`;
}

function attachPopupHandlers(marker, record) {
  marker.on("click", () => console.info("[world:marker:click]", record.id));
  marker.on("popupopen", () => console.info("[world:marker:popup]", record.id));
}

function renderMap(records) {
  const host = $id("world-map"); if (!host || !window.L) return;
  if (!state.mainMap) state.mainMap = createLeafletMap(host, { center: [state.userCenter.lat, state.userCenter.lon], zoom: DEFAULT_MAP_ZOOM_SPAIN });
  if (state.mainLayer) state.mainMap.removeLayer(state.mainLayer);
  const L = window.L;
  state.mainLayer = L.layerGroup();
  records.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)).forEach((r) => {
    const marker = L.circleMarker([r.lat, r.lon], { radius: 7, color: "#fff", weight: 1.5, fillColor: isRatedPlaceRecord(r) ? "#ffd166" : "#4fd0ff", fillOpacity: 0.95, bubblingMouseEvents: false });
    marker.bindPopup(markerPopupHtml(r), { closeButton: true });
    attachPopupHandlers(marker, r);
    state.mainLayer.addLayer(marker);
  });
  state.mainMap.addLayer(state.mainLayer);
  const points = records.filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)).map((r) => ({ lat: r.lat, lng: r.lon }));
  setLeafletViewForPoints(state.mainMap, points, { defaultCenter: DEFAULT_MAP_CENTER_SPAIN, defaultZoom: DEFAULT_MAP_ZOOM_SPAIN, maxAutoZoom: MAX_AUTO_ZOOM, singlePointZoom: 12 });
  invalidateLeafletMap(state.mainMap, 50);
}

function renderMapPanel(records) { const host = $id("world-country-list"); const geo = records.filter(isGeographicRecord); const byCountry = new Map(); geo.forEach((r) => { const key = r.countryCode || "??"; if (!byCountry.has(key)) byCountry.set(key, []); byCountry.get(key).push(r); }); host.innerHTML = byCountry.size ? [...byCountry.entries()].map(([cc, rows]) => `<details class="world-country-row"><summary><strong>${esc(getCountryEnglishName(cc) || cc)}</strong> · ${rows.length}</summary>${rows.map((r) => `<div class="world-item"><div><div class="name">${esc(r.city || r.placeName || "Sin ciudad")}</div></div></div>`).join("")}</details>`).join("") : '<div class="geo-empty">Aún no hay geografía guardada.</div>'; $id("world-country-count").textContent = String(geo.length); }
function renderLocalsPanel(records) { const host = $id("world-locals-list"); const rated = records.filter(isRatedPlaceRecord); host.innerHTML = rated.length ? rated.map((r) => `<div class="world-item"><div><div class="name">${esc(r.placeName || "Local")}</div><div class="meta">${esc(r.city || "")}, ${esc(r.country || "")} · ${r.rating ?? "-"}/10</div></div></div>`).join("") : '<div class="geo-empty">Aún no hay locales valorados</div><button class="btn" data-action="open-add-local" type="button">Añadir local</button>'; $id("world-locals-count").textContent = String(rated.length); }

function renderLocalSearchResults() {
  const host = $id("world-place-results"); if (!host) return;
  host.innerHTML = state.localSearchError ? `<div class="geo-empty">${esc(state.localSearchError)}</div>` : state.placeResults.length ? state.placeResults.map((r, i) => `<div class="world-item ${state.selectedPlace?.id === `sr_${i}` ? "selected" : ""}"><div><div class="name">${esc((r.display_name || "").split(",")[0])}</div><div class="meta">${Math.round(r.distance)}m · ${esc(r.display_name || "")}</div></div><button type="button" class="btn" data-action="pick-place" data-index="${i}">Seleccionar</button></div>`).join("") : '<div class="geo-empty">No hay resultados en este radio.</div>';
}

function initMiniMap() {
  const host = $id("world-mini-map"); if (!host || !window.L) return;
  const center = state.currentSearchCenter || state.userCenter;
  if (!state.miniMap) state.miniMap = createLeafletMap(host, { center: [center.lat, center.lon], zoom: 14 });
  if (state.miniLayer) state.miniMap.removeLayer(state.miniLayer);
  const L = window.L;
  state.miniLayer = L.layerGroup();
  L.circleMarker([center.lat, center.lon], { radius: 6, color: "#fff", weight: 1, fillColor: "#6f6bff", fillOpacity: 0.9 }).addTo(state.miniLayer);
  if (state.selectedPlace?.lat && state.selectedPlace?.lon) L.marker([state.selectedPlace.lat, state.selectedPlace.lon]).addTo(state.miniLayer);
  state.miniLayer.addTo(state.miniMap);
  state.miniMap.setView([center.lat, center.lon], 14);
  invalidateLeafletMap(state.miniMap, 70);
}

async function searchPlacesNearby(query, center, radiusMeters) { const dLat = radiusMeters / 111320; const dLng = radiusMeters / (111320 * Math.cos((center.lat * Math.PI) / 180)); const viewbox = `${center.lon - dLng},${center.lat + dLat},${center.lon + dLng},${center.lat - dLat}`; const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", query); u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "30"); u.searchParams.set("bounded", "1"); u.searchParams.set("viewbox", viewbox); const rows = await (await fetch(u.toString())).json(); return rows.map((r) => ({ ...r, distance: distanceMeters(center.lat, center.lon, Number(r.lat), Number(r.lon)) })).filter((r) => Number.isFinite(r.distance) && r.distance <= radiusMeters).sort((a, b) => a.distance - b.distance); }
function distanceMeters(aLat, aLng, bLat, bLng) { const R = 6371000; const dLat = (bLat - aLat) * Math.PI / 180; const dLng = (bLng - aLng) * Math.PI / 180; const aa = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * Math.PI / 180) * Math.cos(bLat * Math.PI / 180) * Math.sin(dLng / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa)); }

async function persist() { if (!state.firebaseRef) return; await update(state.firebaseRef, { visits: state.visits, customPins: state.customPins, areaVisits: state.areaVisits, updatedAt: nowTs() }); }

async function renderAll() {
  const all = getAllRecords();
  renderMap(all); renderMapPanel(all); renderLocalsPanel(all);
  const geo = all.filter(isGeographicRecord);
  const rated = all.filter(isRatedPlaceRecord);
  const avg = rated.length ? rated.reduce((a, b) => a + Number(b.rating || 0), 0) / rated.length : null;
  $id("world-countries").textContent = String(new Set(geo.map((r) => r.countryCode).filter(Boolean)).size);
  $id("world-geo-count").textContent = String(geo.length);
  $id("world-rated-locals").textContent = String(rated.length);
  $id("world-global-average").textContent = avg == null ? "-" : `${avg.toFixed(1)}/10`;
}

function bindUI() {
  const root = $id("view-world");
  root?.addEventListener("click", async (ev) => {
    const btn = ev.target.closest("button,[data-action],label");
    if (!btn) return;
    const action = btn.dataset.action || "";
    if (btn.matches(".world-window-tab")) return setWindowMode(btn.dataset.window || "map");
    if (btn.id === "world-add-mode-geo") return setAddMode("geo");
    if (btn.id === "world-add-mode-place") return setAddMode("local");
    if (action === "open-add-local") {
      const toggle = $id("world-add-toggle"); if (toggle) toggle.checked = true;
      console.info("[world:add:open]");
      setAddMode("local");
      return;
    }
    if (action === "pick-place") {
      const row = state.placeResults[Number(btn.dataset.index)];
      if (!row) return;
      const a = row.address || {};
      state.selectedPlace = normalizeRecord({ id: `sr_${btn.dataset.index}`, kind: "place", type: "local", source: "place_search", placeName: (row.display_name || "").split(",")[0], city: a.city || a.town || a.village || "", subdivision: a.state || "", country: a.country || "", countryCode: iso2(a.country_code), lat: Number(row.lat), lon: Number(row.lon), rating: state.rating, note: $id("world-place-note")?.value || "" });
      initMiniMap(); renderLocalSearchResults();
      return;
    }
  });

  $id("world-add-toggle")?.addEventListener("change", async (e) => {
    if (!e.target.checked) return;
    console.info("[world:add:open]");
    const pos = await getCurrentPositionSafe();
    state.currentSearchCenter = pos || state.currentSearchCenter || state.userCenter;
    if (pos) state.userCenter = pos;
    setAddMode(state.addMode || "geo");
  });

  $id("world-rating-stars")?.addEventListener("click", (ev) => { const b = ev.target.closest("button[data-star]"); if (!b) return; state.rating = Number(b.dataset.star); renderStars(); });

  $id("world-place-q")?.addEventListener("input", async (e) => {
    const q = e.target.value.trim(); if (q.length < 2) return;
    try { const center = state.currentSearchCenter || state.userCenter; const radius = Number($id("world-place-radius")?.value || 1000); state.placeResults = await searchPlacesNearby(q, center, radius); state.localSearchError = ""; renderLocalSearchResults(); }
    catch (error) { state.localSearchError = "Error buscando locales"; logError("search-place", error); renderLocalSearchResults(); }
  });
  $id("world-place-radius")?.addEventListener("change", () => $id("world-place-q")?.dispatchEvent(new Event("input")));

  $id("world-geo-q")?.addEventListener("input", async (e) => {
    const q = e.target.value.trim(); if (q.length < 2) return;
    try { const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", q); u.searchParams.set("format", "json"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8"); state.geoResults = await (await fetch(u.toString())).json(); $id("world-geo-results").innerHTML = state.geoResults.map((r, i) => `<div class="world-item"><div><div class="name">${esc((r.display_name || "").split(",")[0])}</div><div class="meta">${esc(r.display_name || "")}</div></div><button type="button" class="btn" data-action="pick-geo" data-index="${i}">Elegir</button></div>`).join(""); }
    catch (error) { logError("search-geo", error); }
  });

  $id("world-geo-results")?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-action='pick-geo']"); if (!btn) return;
    const row = state.geoResults[Number(btn.dataset.index)]; if (!row) return;
    const a = row.address || {};
    state.selectedGeo = normalizeRecord({ kind: "geo", type: "city", source: "geo_search", placeName: (row.display_name || "").split(",")[0], city: a.city || a.town || a.village || a.municipality || "", subdivision: a.state || "", country: a.country || "", countryCode: iso2(a.country_code), lat: Number(row.lat), lon: Number(row.lon) });
  });

  $id("world-geo-save")?.addEventListener("click", async () => { try { if (!state.selectedGeo) return; state.selectedGeo.note = $id("world-geo-note")?.value || ""; state.visits.push(normalizeRecord(state.selectedGeo)); await persist(); await renderAll(); } catch (error) { logError("save-geo", error); } });
  $id("world-place-save")?.addEventListener("click", async () => { try { if (!state.selectedPlace) return; state.selectedPlace.rating = Math.max(0, Math.min(10, state.rating)); state.selectedPlace.note = $id("world-place-note")?.value || ""; state.visits.push(normalizeRecord(state.selectedPlace)); await persist(); await renderAll(); } catch (error) { logError("save-local", error); } });
}

export async function init() {
  if (state.initialized) return;
  state.initialized = true;
  await ensureLeaflet().catch((err) => logError("leaflet", err));
  bindUI(); renderStars();
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (uid) {
    state.firebaseRef = ref(db, WORLD_PATH(uid));
    state.firebaseUnsub = trackedOnValue(state.firebaseRef, (snapshot) => {
      const v = snapshot.val() || {};
      state.visits = (v.visits || []).map(normalizeRecord);
      state.customPins = (v.customPins || []).map(normalizeRecord);
      state.areaVisits = (v.areaVisits || []).map(normalizeRecord);
      renderAll().catch((err) => logError("renderAll", err));
    }, { key: "world-root", path: WORLD_PATH(uid), module: "world", mode: "onValue", reason: "world-live-sync", viewId: "view-world" }, onValue);
  }
  await renderAll();
}

export function destroy() { if (state.mainMap) { destroyLeafletMap($id("world-map")); state.mainMap = null; } if (state.miniMap) { destroyLeafletMap($id("world-mini-map")); state.miniMap = null; } if (state.firebaseUnsub) state.firebaseUnsub(); state.firebaseUnsub = null; state.initialized = false; }
export function getListenerCount() { return state.firebaseUnsub ? 1 : 0; }
export async function onShow() { if (!state.initialized) await init(); setWindowMode(state.activeWindow || "map"); }
export async function onHide() { destroy(); }
