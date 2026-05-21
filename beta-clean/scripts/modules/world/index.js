import { auth, db, firebasePaths, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createLeafletMap, DEFAULT_MAP_CENTER_SPAIN, destroyLeafletMap, ensureLeaflet, invalidateLeafletMap } from "../../shared/vendors/leaflet.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";
import { getCountryEnglishName } from "./countries.js";
import { initWorldStays, renderWorldStays } from "./stays.js";
console.info("[world:index:loaded]");

const $id = (id) => document.getElementById(id);
const id = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const stars10 = (v = 0) => "★".repeat(Math.round(v)).padEnd(10, "☆");
const hav = (a, b, c, d) => { const R = 6371000; const to = (x) => x * Math.PI / 180; const d1 = to(c - a), d2 = to(d - b); const q = Math.sin(d1 / 2) ** 2 + Math.cos(to(a)) * Math.cos(to(c)) * Math.sin(d2 / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q)); };
const countryNameToIso = new Intl.DisplayNames(["en"], { type:"region" });
const WORLD_LOCATION_PERMISSION_KEY = "worldLocationPermissionAccepted";
const LOCAL_CATEGORY_EMOJI_MAP = [
  { emoji:"🍕", keywords:["pizzeria","pizzería","pizza"] },
  { emoji:"☕", keywords:["cafeteria","cafetería","cafe","café","coffee"] },
  { emoji:"🍽️", keywords:["restaurante","restaurant","comida"] },
  { emoji:"🏨", keywords:["hotel","hostel"] },
  { emoji:"🌳", keywords:["parque","park","jardin","jardín"] },
  { emoji:"🍸", keywords:["bar","pub","coctel","cóctel"] },
  { emoji:"🛍️", keywords:["tienda","shop","store"] }
];

const state = { initialized:false, unsubGeography:null, unsubPlaces:null, map:null, miniMap:null, miniMarkers:[], markers:new Map(), worldLayers:null, worldClusterGroup:null, geography:[], places:[], userCenter:{ lat:DEFAULT_MAP_CENTER_SPAIN[0], lon:DEFAULT_MAP_CENTER_SPAIN[1] }, selectedGeo:null, selectedPlace:null, selectedGeoIndex:-1, selectedPlaceIndex:-1, geoResults:[], placeResults:[], geoRating:0, placeRating:0, activeWindow:"map", activeSubtab:"map", addMode:"geo", editing:null, toastTimer:null, mapMarkersIndex:new Map(), showEditLocationSearch:false, placeModalMode:"add", selectedGeoCandidate:null, selectedWorldMapCategoryFilters:new Set() };

function getLocalCategoryEmoji(categoryOrType = "") {
  const normalized = String(categoryOrType || "").trim().toLowerCase();
  if (!normalized) return "📍";
  const match = LOCAL_CATEGORY_EMOJI_MAP.find((entry) => entry.keywords.some((keyword) => normalized.includes(keyword)));
  return match?.emoji || "📍";
}
function getWorldMarkerEmoji(item = {}) {
  const persistedEmoji = String(item?.emoji || "").trim();
  if (persistedEmoji) return persistedEmoji;
  const fallbackTypeEmoji = getLocalCategoryEmoji(item.category || item.type || "");
  return String(fallbackTypeEmoji || "").trim() || "📍";
}
const normalize = (r = {}, kind = "geography") => ({ id:r.id || id(), kind, name:String(r.name || r.placeName || "").trim(), label:String(r.label || r.displayName || r.name || "").trim(), displayName:String(r.displayName || r.label || r.name || "").trim(), country:String(r.country || "").trim(), countryCode:String(r.countryCode || r.country_code || "").trim().toUpperCase(), city:String(r.city || "").trim(), region:String(r.region || r.subdivision || "").trim(), postalCode:String(r.postalCode || "").trim(), address:String(r.address || "").trim(), category:String(r.category || r.type || "").trim(), emoji:String(r.emoji || (kind === "places" ? getLocalCategoryEmoji(r.category || r.type || "") : "📍")).trim(), note:String(r.note || "").trim(), productName:String(r.productName || "").trim(), price:Number.isFinite(Number(r.price)) ? Number(r.price) : null, currency:String(r.currency || "EUR").trim().toUpperCase(), rating:Number.isFinite(Number(r.rating)) ? Number(r.rating) : null, lat:Number(r.lat), lon:Number(r.lon ?? r.lng), lng:Number(r.lng ?? r.lon), googleMapsDirectionsUrl:String(r.googleMapsDirectionsUrl || r.googleMapsUrl || "").trim(), createdAt:Number(r.createdAt || Date.now()), updatedAt:Date.now() });
const toTitleCase = (s = "") => String(s || "").trim().toLowerCase().replace(/\b\p{L}/gu, (m) => m.toUpperCase());
const normalizeChainName = (place = {}) => {
  const raw = String(place.category || place.name || "Local").trim();
  return toTitleCase(raw) || "Local";
};
const parsePrice = (value = "") => {
  const n = Number(String(value || "").trim().replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
};
const normalizeLocationAddress = (result = {}) => { const a = result?.address || {}; return { label:String(result?.display_name || result?.label || "").trim(), name:String(result?.name || result?.display_name || "").split(",")[0].trim(), country:String(a.country || "").trim(), countryCode:String(a.country_code || "").trim().toUpperCase(), region:String(a.state || a.region || "").trim(), city:String(a.city || a.town || a.village || a.municipality || "").trim(), municipality:String(a.municipality || "").trim(), postalCode:String(a.postcode || "").trim(), lat:Number(result?.lat), lon:Number(result?.lon ?? result?.lng), address:a }; };
const flag = (cc = "") => { const s = String(cc || "").trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) ? String.fromCodePoint(...[...s].map((c) => 127397 + c.charCodeAt(0))) : "🌍"; };

function showToast(text = "Guardado") { const el = $id("world-feedback"); if (!el) return; el.textContent = text; el.classList.add("show"); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove("show"), 1700); }
function closeAddModal(){ $id("world-add-toggle").checked = false; }
function resetWorldAddModalState(){ state.selectedGeo = null; state.selectedGeoCandidate = null; state.selectedPlace = null; state.selectedGeoIndex = -1; state.selectedPlaceIndex = -1; state.geoResults = []; state.placeResults = []; state.geoRating = 0; state.placeRating = 0; state.editing = null; ["world-geo-q","world-geo-note","world-place-q","world-place-note","world-form-country","world-form-region","world-form-city","world-place-form-name","world-place-form-emoji","world-place-form-category","world-place-form-country","world-place-form-region","world-place-form-city","world-place-form-product","world-place-form-price","world-place-edit-name","world-place-edit-emoji","world-place-edit-category","world-place-edit-country","world-place-edit-region","world-place-edit-city","world-place-edit-note","world-place-edit-product","world-place-edit-price"].forEach((k)=>{ const el=$id(k); if (el) el.value=""; }); $id("world-place-radius").value = "none"; $id("world-geo-results").innerHTML = ""; $id("world-place-results").innerHTML = ""; renderRatings(); renderPlaceResults(); }
function clearGeoPanelState(){ state.selectedGeo = null; state.selectedGeoCandidate = null; state.selectedGeoIndex = -1; state.geoResults = []; state.geoRating = 0; ["world-geo-q","world-geo-note","world-form-country","world-form-region","world-form-city"].forEach((k)=>{ const el = $id(k); if (el) el.value = ""; }); const geoResults = $id("world-geo-results"); if (geoResults) geoResults.innerHTML = ""; }
function clearLocalPanelState(){ state.selectedPlace = null; state.selectedPlaceIndex = -1; state.placeResults = []; state.placeRating = 0; ["world-place-q","world-place-note"].forEach((k)=>{ const el = $id(k); if (el) el.value = ""; }); $id("world-place-radius").value = "none"; const placeResults = $id("world-place-results"); if (placeResults) placeResults.innerHTML = ""; renderPlaceResults(); }

function normalizeCountryFromAddress(address = {}) {
  const rawCode = String(address?.country_code || "").trim().toUpperCase();
  const rawCountry = String(address?.country || "").trim();
  let countryCode = /^[A-Z]{2}$/.test(rawCode) ? rawCode : "";
  if (!countryCode && rawCountry) {
    const found = [
      "ES","AR","US","MX","FR","IT","PT","DE","GB","IE","NL","BE","CH","AT","SE","NO","DK","FI","PL","CZ","HU","RO","BG","GR","TR","UA","RU","MA","EG","ZA","AE","SA","IN","JP","KR","TH","VN","ID","SG","MY","PH","AU","NZ","CA","BR","CL","CO","PE","UY","PY","BO","EC","CR","PA","DO","CU","GT","HN","NI","SV"
    ].find((cc) => countryNameToIso.of(cc)?.toLowerCase() === rawCountry.toLowerCase());
    countryCode = found || "";
  }
  return { countryCode, country: rawCountry || (countryCode ? getCountryEnglishName(countryCode) : "") };
}

function renderGeoAddMode(){ $id("world-geo-mode").hidden = false; $id("world-place-mode").hidden = true; }
function renderAddLocalMode(){ $id("world-place-mode").hidden = false; $id("world-geo-mode").hidden = true; initMiniMap(); }
function setAddMode(mode){
  const prev = state.addMode;
  state.addMode = mode;
  $id("world-add-mode-geo").classList.toggle("active", mode === "geo");
  $id("world-add-mode-place").classList.toggle("active", mode === "place");
  if (mode === "geo") { if (prev === "place") clearLocalPanelState(); renderGeoAddMode(); }
  else { if (prev === "geo") clearGeoPanelState(); renderAddLocalMode(); }
  renderRatings();
}
function renderPlaceModalMode(){
  const isPlaceMode = state.addMode === "place";
  const isPlaceEdit = isPlaceMode && state.placeModalMode === "edit";
  const addPanel = $id("world-place-add-panel");
  const editPanel = $id("world-place-edit-panel");
  if (addPanel) addPanel.hidden = isPlaceEdit;
  if (editPanel) editPanel.hidden = !isPlaceEdit;
}

function setEditModeUI(){
  const root = $id("view-world");
  const isEditing = Boolean(state.editing);
  root?.classList.toggle("world-edit-only", isEditing);
  $id("world-sheet-title").textContent = isEditing ? "Editar" : "Añadir";
  $id("world-geo-enable-search").hidden = !isEditing || state.addMode !== "geo";
  $id("world-place-enable-search").hidden = !isEditing || state.addMode !== "place";
  $id("world-geo-search-block").style.display = (!isEditing || state.showEditLocationSearch) && state.addMode === "geo" ? "" : "none";
  $id("world-place-search-block").style.display = (!isEditing || state.showEditLocationSearch) && state.addMode === "place" ? "" : "none";
  const mapWrap = $id("world-place-map-wrap");
  const showPlaceSearch = state.addMode === "place" && (state.placeModalMode === "add" || state.showEditLocationSearch);
  $id("world-place-search-block").style.display = showPlaceSearch ? "" : "none";
  if (mapWrap) mapWrap.style.display = showPlaceSearch ? "" : "none";
  renderPlaceModalMode();
}

function ratingFromPointer(el, clientX){ const rect = el.getBoundingClientRect(); return Math.max(0, Math.min(10, ((clientX - rect.left) / Math.max(rect.width, 1)) * 10)); }
function renderRating(elId, value){ const el = $id(elId); if(!el) return; el.setAttribute("aria-valuenow", String(value.toFixed(1))); el.innerHTML = `<div class="world-rating-track"><div class="world-rating-fill" style="width:${(value/10)*100}%"></div><div class="world-rating-text">${stars10(value)} ${value.toFixed(1)}/10</div></div>`; }
function renderRatings(){ renderRating("world-geo-rating-stars", state.geoRating); renderRating("world-rating-stars", state.placeRating); renderRating("world-place-edit-rating-stars", state.placeRating); }

function renderGeoResults(){ const root = $id("world-geo-results"); root.innerHTML = state.geoResults.map((r, i) => `<button class="world-result-card ${state.selectedGeoIndex===i?"is-selected":""}" data-geo-pick="${i}"><strong>${r.name}</strong><small>${r.label || ""}</small></button>`).join(""); }
function renderPlaceResults(){ const root = $id("world-place-results"); root.innerHTML = state.placeResults.map((r, i) => `<button class="world-result-card ${state.selectedPlaceIndex===i?"is-selected":""}" data-place-pick="${i}"><strong>${r.name}</strong><small>${r.addressLine || r.label || ""}${r.city ? `, ${r.city}` : ""}${Number.isFinite(r.distance) ? ` · ${Math.round(r.distance)} m` : ""}</small></button>`).join(""); renderMiniMapMarkers(); }

function buildPopup(rec){
  const subtitle = rec.kind === "places"
    ? (rec.address || rec.displayName || rec.label || "")
    : (rec.label || "");
  if (rec.kind === "places") console.log("[world:local:popup:address]", subtitle || "");
  return `<div class="world-popup"><strong>${rec.emoji || "📍"} ${rec.name || rec.city || "Punto"}</strong><small>${subtitle}</small><small>${flag(rec.countryCode)} ${rec.country || getCountryEnglishName(rec.countryCode) || ""}</small><small>${stars10(rec.rating || 0)} ${(rec.rating ?? 0).toFixed(1)}/10</small><div class="world-popup-actions"><button data-world-center="${rec.id}">Centrar</button><button data-world-edit="${rec.kind}:${rec.id}">Editar</button><button data-world-delete="${rec.kind}:${rec.id}">Eliminar</button>${rec.kind === "places" ? `<button data-world-rate="${rec.kind}:${rec.id}">Rating +1</button>` : ""}${worldGoogleMapsBtn(rec, "🧭 Cómo llegar", "world-popup-link")}</div></div>`;
}
function renderMiniMapMarkers(){ if (!state.miniMap || !window.L) return; state.miniMarkers.forEach((m)=>m.remove()); state.miniMarkers = []; const L = window.L; state.placeResults.forEach((r, i) => { if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return; const marker = L.circleMarker([r.lat, r.lon], { radius:7, fillOpacity:0.9, color:"#fff", fillColor:state.selectedPlaceIndex===i?"#ff8a65":"#5ec7ff", weight:2 }).addTo(state.miniMap); marker.on("click", ()=>{ pickPlace(i); state.miniMap.setView([r.lat, r.lon], 17); }); state.miniMarkers.push(marker); }); }
function createWorldClusterIcon(count = 0) { const L = window.L; const safeCount = Math.max(1, Number(count || 0)); return L.divIcon({ className:"notes-map-cluster-icon", html:`<span class="notes-map-cluster${safeCount >= 10 ? " is-large" : ""}"><span class="notes-map-cluster-count">${safeCount}</span></span>`, iconSize:safeCount >= 10 ? [38,38] : [34,34], iconAnchor:safeCount >= 10 ? [19,19] : [17,17] }); }
function destroyWorldMapLayers(){
  if (!state.map) return;
  if (state.worldClusterGroup) {
    state.worldClusterGroup.clearLayers?.();
    state.map.removeLayer(state.worldClusterGroup);
    console.log("[world:cluster:reset] removed old layers");
  }
  state.worldClusterGroup = null;
  if (state.worldLayers) {
    state.worldLayers.clearLayers?.();
    state.map.removeLayer(state.worldLayers);
    state.worldLayers = null;
  }
  state.markers.clear();
  state.mapMarkersIndex.clear();
}
function createGoogleMapsUrl(lat, lon){
  if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${Number(lat)},${Number(lon)}`;
}
function buildWorldClusters(rows = []) { if (!state.map) return []; const zoom = Number(state.map.getZoom?.() || 5); const cellSize = zoom >= 11 ? 34 : zoom >= 9 ? 42 : 54; const groups = new Map(); rows.forEach((r) => { const projected = state.map.project([r.lat, r.lon], zoom); const key = `${Math.floor(projected.x / cellSize)}:${Math.floor(projected.y / cellSize)}`; const group = groups.get(key) || { rows:[], latSum:0, lonSum:0, coordKeys:new Set() }; group.rows.push(r); group.latSum += Number(r.lat); group.lonSum += Number(r.lon); group.coordKeys.add(`${Number(r.lat).toFixed(6)},${Number(r.lon).toFixed(6)}`); groups.set(key, group); }); return Array.from(groups.values()).map((g) => ({ rows:g.rows, lat:g.latSum / Math.max(1, g.rows.length), lon:g.lonSum / Math.max(1, g.rows.length), coordCount:g.coordKeys.size })); }
function zoomToWorldCluster(cluster = {}) { const L = window.L; const points = (cluster.rows || []).map((item) => [item.lat, item.lon]); if (!points.length) return; const currentZoom = Number(state.map?.getZoom?.() || 0); if ((cluster.coordCount || 0) <= 1 || points.length <= 1) { if (currentZoom >= 14) return; state.map.setView(points[0], Math.min(16, Math.max(currentZoom + 2, 12))); return; } const bounds = L.latLngBounds(points); state.map.fitBounds(bounds, { padding:[40,40], maxZoom:Math.max(currentZoom + 2, 14) }); }

function logWorldClusterZoom(){
  if (!state.map || !state.worldClusterGroup) return;
  const zoom = Number(state.map.getZoom?.() || 0);
  let visibleMarkers = 0;
  let visibleClusters = 0;
  state.worldClusterGroup.eachLayer((layer) => {
    if (!state.map.hasLayer(layer)) return;
    if (typeof layer.getChildCount === "function") visibleClusters += 1;
    else visibleMarkers += 1;
  });
  console.log("[world:cluster:zoom]", zoom, visibleMarkers, visibleClusters);
}

function getItemLatLng(item = {}){
  const latRaw = item.lat ?? item.latitude ?? item.coords?.lat ?? item.location?.lat ?? item.geo?.lat;
  const lngRaw = item.lng ?? item.lon ?? item.longitude ?? item.coords?.lng ?? item.location?.lng ?? item.geo?.lng;
  return { lat:Number(latRaw), lng:Number(lngRaw) };
}
function normalizeCategoryName(value = ""){ return String(value || "").trim().toLowerCase(); }
function getItemCategoryKey(item = {}){
  return String(item.categoryId || item.chainId || item.groupId || "").trim() || normalizeCategoryName(item.categoryName || item.category || item.type || item.name || "");
}
function getWorldLocalCategories(){
  const categories = new Map();
  state.places.forEach((item) => {
    const key = getItemCategoryKey(item);
    if (!key) return;
    if (!categories.has(key)) categories.set(key, { id:key, name:toTitleCase(item.categoryName || item.category || item.type || item.name || "Sin categoría"), emoji:String(item.emoji || getLocalCategoryEmoji(item.category || item.type || "") || "📍").trim() || "📍" });
  });
  const rows = Array.from(categories.values()).sort((a,b)=>a.name.localeCompare(b.name, "es"));
  console.log("[world:map-filter] categories", rows);
  return rows;
}
function getFilteredWorldMapItems(items = []){
  if (!state.selectedWorldMapCategoryFilters.size) return items;
  const selected = state.selectedWorldMapCategoryFilters;
  const filtered = items.filter((item) => {
    const key = getItemCategoryKey(item);
    return key ? selected.has(key) : false;
  });
  console.log("[world:map-filter] selected", Array.from(selected));
  console.log("[world:map-filter] visibleItems", filtered.map((x) => x.id));
  return filtered;
}
function toggleWorldMapCategoryFilter(categoryId = ""){
  const key = String(categoryId || "").trim();
  if (!key) return;
  if (state.selectedWorldMapCategoryFilters.has(key)) state.selectedWorldMapCategoryFilters.delete(key);
  else state.selectedWorldMapCategoryFilters.add(key);
  renderWorldMapCategoryFilter();
  renderWorldMarkers();
}
function clearWorldMapCategoryFilter(categoryId = ""){
  state.selectedWorldMapCategoryFilters.delete(String(categoryId || "").trim());
  renderWorldMapCategoryFilter();
  renderWorldMarkers();
}
function renderWorldMapCategoryFilter(){
  const mount = $id("world-map-category-filter");
  if (!mount) return;
  const categories = getWorldLocalCategories();
  const selected = state.selectedWorldMapCategoryFilters;
  const validKeys = new Set(categories.map((c) => c.id));
  Array.from(selected).forEach((idv) => { if (!validKeys.has(idv)) selected.delete(idv); });
  const options = categories.map((c)=>`<option value="${c.id}">${c.emoji} ${c.name}</option>`).join("");
  const selectedChips = categories.filter((c)=>selected.has(c.id)).map((c)=>`<span class="world-map-filter-chip">${c.emoji} ${c.name}<button type="button" data-world-map-filter-clear="${c.id}" aria-label="Quitar filtro">×</button></span>`).join("");
  mount.innerHTML = `<div class="world-map-filter-row"><select id="world-map-category-filter-select" class="world-map-filter-select"><option value="">Filtrar locales</option>${options}</select></div>${selectedChips ? `<div class="world-map-filter-chips">${selectedChips}</div>` : ""}`;
}

function renderWorldMarkers(){
  if(!window.L || !state.map) return;
  const L = window.L;
  destroyWorldMapLayers();

  const allRows = getFilteredWorldMapItems([...state.geography, ...state.places].filter(Boolean));
  const totalItems = allRows.length;
  let withCoords = 0;
  let skipped = 0;
  let addedMarkers = 0;
  const sampleSkipped = [];

  let fallback = false;
  const canCluster = typeof L.markerClusterGroup === "function";
  try {
    state.worldClusterGroup = canCluster ? L.markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      disableClusteringAtZoom: 17,
      maxClusterRadius: 60,
      iconCreateFunction: (cluster) => createWorldClusterIcon(cluster.getChildCount())
    }) : L.layerGroup();
  } catch (_err) {
    fallback = true;
    state.worldClusterGroup = L.layerGroup();
  }
  if (!canCluster) fallback = true;
  console.log("[world:markers:fallback]", fallback);

  const validRows = allRows.filter((item) => {
    const { lat, lng } = getItemLatLng(item);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      skipped += 1;
      console.warn("[world:marker:skip]", { id:item?.id, reason:"invalid-lat-lng", item });
      if (sampleSkipped.length < 3) sampleSkipped.push({ id:item.id, keys:Object.keys(item || {}) });
      return false;
    }
    withCoords += 1; return true;
  });
  const renderSingleMarker = (item) => {
    const { lat, lng } = getItemLatLng(item);
    const markerEmoji = getWorldMarkerEmoji(item);
    const markerIcon = L.divIcon({ className:"notes-map-emoji-icon", html:`<span class="notes-map-emoji" aria-hidden="true">${markerEmoji}</span>`, iconSize:[24,24], iconAnchor:[12,12] });
    console.debug("[world-map:marker-emoji]", {
      id: item.id,
      name: item.name,
      emoji: item.emoji,
      type: item.type || item.category || ""
    });
    const marker = L.marker([lat, lng], { icon:markerIcon });
    marker.bindPopup(buildPopup(item));
    state.worldClusterGroup.addLayer(marker);
    state.markers.set(item.id, marker);
    state.mapMarkersIndex.set(item.id, marker);
    console.log("[world:marker:add]", { id:item.id, kind:item.kind, lat, lng, emoji:markerEmoji });
    addedMarkers += 1;
  };

  if (!canCluster && Number(state.map.getZoom?.() || 0) < 8) {
    const rowsWithCoords = validRows.map((item) => {
      const { lat, lng } = getItemLatLng(item);
      return { ...item, lat, lon:lng, lng };
    });
    const clusters = buildWorldClusters(rowsWithCoords);
    clusters.forEach((cluster) => {
      if ((cluster.rows || []).length >= 2) {
        const marker = L.marker([cluster.lat, cluster.lon], { icon:createWorldClusterIcon(cluster.rows.length) });
        marker.on("click", () => zoomToWorldCluster(cluster));
        state.worldClusterGroup.addLayer(marker);
        addedMarkers += 1;
        return;
      }
      const single = cluster.rows?.[0];
      if (single) renderSingleMarker(single);
    });
  } else validRows.forEach((item) => renderSingleMarker(item));

  state.worldClusterGroup.addTo(state.map);
  const markerCount = state.worldClusterGroup?.getLayers?.().length ?? addedMarkers;
  console.debug("[world:markers:render]", {
    geographyCount: state.geography?.length,
    placesCount: state.places?.length,
    markerCount
  });
  console.log("[world:markers:source]", totalItems);
  console.log("[world:markers:coords]", withCoords, skipped);
  console.log("[world:markers:added]", addedMarkers);
  if (addedMarkers === 0) console.warn("[world:markers:empty:samples]", sampleSkipped);
  logWorldClusterZoom();
}
function renderMap(){ if(!window.L) return; const host = $id("world-map"); if(!host) return; if(!state.map) state.map = createLeafletMap(host, { center:[state.userCenter.lat, state.userCenter.lon], zoom:5 }); renderWorldMarkers(); }
function setWindow(mode){ state.activeWindow = mode; state.activeSubtab = mode; document.querySelectorAll("#view-world .world-tab").forEach((b)=>b.classList.toggle("active", b.dataset.window===mode)); document.querySelectorAll("#view-world [data-window-panel]").forEach((p)=>p.classList.toggle("active", p.dataset.windowPanel===mode)); invalidateLeafletMap(state.map, 60); }


function renderBars(items = [], total = 0){
  return `<div class="world-bars">${items.map(([label, value])=>`<div class="world-bar-row"><div><div>${label}</div><div class="world-bar-track"><div class="world-bar-fill" style="width:${total?((value/total)*100).toFixed(2):0}%"></div></div></div><span class="world-bar-meta">${value}/${total || value}</span></div>`).join("")}</div>`;
}

function renderMapStats(){
  const mount = $id("world-map-stats"); if (!mount) return;
  const countries = new Map();
  state.geography.forEach((r)=>countries.set(r.country || "Sin país", (countries.get(r.country || "Sin país") || 0) + 1));
  const total = state.geography.length || 0;
  const countryOptions = ["Todo", ...Array.from(countries.keys())];
  const current = state.mapStatsCountry && countryOptions.includes(state.mapStatsCountry) ? state.mapStatsCountry : "Todo";
  state.mapStatsCountry = current;
  const selectedRows = current === "Todo" ? Array.from(countries.entries()) : Array.from(state.geography.filter((x)=> (x.country||"Sin país")===current).reduce((m,r)=>{ const k=r.region || r.city || "Sin región"; m.set(k,(m.get(k)||0)+1); return m;}, new Map()).entries());
  const selectedTotal = current === "Todo" ? total : selectedRows.reduce((a,b)=>a+Number(b[1]||0),0);
  mount.innerHTML = `<details><summary>Estadísticas del mapa ▾</summary><div class="world-inline-2"><select id="world-map-stats-filter">${countryOptions.map((c)=>`<option ${c===current?"selected":""}>${c}</option>`).join("")}</select><div class="world-stat-chip">${current === "Todo" ? `${countries.size} países` : current}</div></div>${renderBars(selectedRows.slice(0,8), selectedTotal)}</details>`;
}
function renderGeoList(){ renderMapStats();
  const groups = state.geography.reduce((acc, r) => { const key = r.countryCode || r.country || "XX"; acc[key] = acc[key] || { country:r.country, countryCode:r.countryCode, rows:[] }; acc[key].rows.push(r); return acc; }, {});
  const html = Object.values(groups).sort((a, b) => b.rows.reduce((s, r) => s + Number(r.daysTotal || 0), 0) - a.rows.reduce((s, r) => s + Number(r.daysTotal || 0), 0)).map((g)=>{
    const ratedRows = g.rows.filter((r) => Number.isFinite(Number(r.rating)));
    const countryAvg = ratedRows.length ? ratedRows.reduce((sum, r) => sum + Number(r.rating || 0), 0) / ratedRows.length : 0;
    return `<details><summary><strong>${flag(g.countryCode)} ${g.country || getCountryEnglishName(g.countryCode) || ""}</strong> · ${g.rows.length} · ${stars10(countryAvg)} ${countryAvg.toFixed(1)}/10</summary>${g.rows.map((r)=>`<div class="world-rich-item"><div><strong class="world-geo-title">${r.name || r.city}</strong><small class="world-geo-rating">${stars10(r.rating || 0)} ${(r.rating ?? 0).toFixed(1)}/10</small></div><div class="world-item-actions"><button data-world-center="${r.id}">📍</button><button data-world-edit="geography:${r.id}">✏️</button><button data-world-delete="geography:${r.id}">🗑</button></div></div>`).join("")}</details>`;
  }).join("");
  $id("world-country-list").innerHTML = html || "<div>Sin lugares geográficos.</div>";
}
function worldGoogleMapsBtn(r = {}, label = "🧭 Cómo llegar", className = "world-maps-link"){
  const hasCoords = Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lon ?? r.lng));
  const url = hasCoords ? createGoogleMapsUrl(r.lat, r.lon ?? r.lng) : (r.googleMapsDirectionsUrl || r.googleMapsUrl || "");
  if (url) console.log("[world:directions:rendered]", r.id || "", hasCoords, url);
  return url ? `<a class="${className}" href="${url}" target="_blank" rel="noopener">${label}</a>` : "";
}

function getMostFrequentGroupEmoji(rows = []){
  const counts = new Map();
  rows.forEach((row) => {
    const emoji = String(row?.emoji || "").trim();
    if (!emoji) return;
    counts.set(emoji, (counts.get(emoji) || 0) + 1);
  });
  if (!counts.size) return "📍";
  return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0] || "📍";
}

function getLocalGroupValue(row = {}){
  const candidates = [row.type, row.category, row.chain, row.placeType, row.name];
  const raw = candidates.find((value) => String(value || "").trim()) || "Sin categoría";
  return String(raw || "").trim();
}
function renderLocals(){ const rows=state.places; const mode = $id("world-locals-group")?.value || "type"; const statsMount = $id("world-locals-stats"); if (statsMount) { const byCountry = new Map(), byCity = new Map(), byCategory = new Map(), byChain = new Map(); const ratings = rows.filter((r)=>Number.isFinite(Number(r.rating))); rows.forEach((r)=>{ byCountry.set(r.country || "Sin país", (byCountry.get(r.country || "Sin país") || 0) + 1); byCity.set(r.city || "Sin ciudad", (byCity.get(r.city || "Sin ciudad") || 0) + 1); byCategory.set(r.category || "Sin categoría", (byCategory.get(r.category || "Sin categoría") || 0) + 1); const chain = normalizeChainName(r); byChain.set(chain, (byChain.get(chain) || 0) + 1); }); const topOne=(m)=>Array.from(m.entries()).sort((a,b)=>b[1]-a[1])[0]||["-",0]; const top=(m)=>Array.from(m.entries()).sort((a,b)=>b[1]-a[1]).slice(0,6); const avgGlobal = ratings.length ? ratings.reduce((s, r) => s + Number(r.rating || 0), 0) / ratings.length : 0; const [topCountry]=topOne(byCountry), [topCity]=topOne(byCity), [topCat]=topOne(byCategory), [topChain]=topOne(byChain); statsMount.innerHTML = `<details class="world-local-stats-box"><summary>Estadísticas de locales ▾</summary><div class="world-compact-grid"><div class="world-stat-chip">Total: ${rows.length}</div><div class="world-stat-chip">Media: ${avgGlobal.toFixed(1)}/10</div><div class="world-stat-chip">País top: ${topCountry}</div><div class="world-stat-chip">Ciudad top: ${topCity}</div><div class="world-stat-chip">Categoría top: ${topCat}</div><div class="world-stat-chip">Cadena top: ${topChain}</div></div>${renderBars(top(byCountry), rows.length)}${renderBars(top(byCity), rows.length)}${renderBars(top(byCategory), rows.length)}${renderBars(top(byChain), rows.length)}</details>`; }
  const sorted = [...rows].sort((a, b) => Number(b.rating || 0) - Number(a.rating || 0));
  if (mode === "all") {
    $id("world-locals-list").innerHTML = sorted.map((r)=>`<div class="world-rich-item"><div class="world-local-card"><div class="world-local-line world-local-line-main"><span>${r.emoji || "🏪"}</span><span class="world-local-name">${toTitleCase(r.name || r.category || "Local")}</span><span class="world-local-dot">·</span><span>${r.city || r.region || "Sin ciudad"}</span></div><div class="world-local-line"><span>${stars10(r.rating || 0)} ${(r.rating ?? 0).toFixed(1)}/10</span></div></div><div class="world-item-actions"><button data-world-center="${r.id}">📍</button><button data-world-edit="places:${r.id}">✏️</button><button data-world-rate="places:${r.id}">⭐</button><button data-world-delete="places:${r.id}">🗑</button></div></div>`).join("") || "<div>Sin locales.</div>";
    return;
  }
  const groups = new Map();
  sorted.forEach((row) => {
    const value = getLocalGroupValue(row);
    const key = value.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, { label:toTitleCase(value), rows:[] });
    groups.get(key).rows.push(row);
  });
  const html = Array.from(groups.values()).sort((a, b) => b.rows.length - a.rows.length).map((group) => {
    const ratedRows = group.rows.filter((r) => Number.isFinite(Number(r.rating)));
    const avg = ratedRows.length ? ratedRows.reduce((sum, r) => sum + Number(r.rating || 0), 0) / ratedRows.length : 0;
    return `<details><summary><strong>${getMostFrequentGroupEmoji(group.rows)} ${group.label}</strong> · ${group.rows.length} visitas · media ${avg.toFixed(1)}/10</summary>${group.rows.map((r)=>`<div class="world-rich-item"><div class="world-local-card"><div class="world-local-line world-local-line-main"><span>${r.emoji || getLocalCategoryEmoji(group.label) || "🏪"}</span><span class="world-local-name">${toTitleCase(r.name || r.address || "Local")}</span><span class="world-local-dot">·</span><span>${r.city || r.region || "Sin ciudad"}</span></div><div class="world-local-line"><span>${stars10(r.rating || 0)} ${(r.rating ?? 0).toFixed(1)}/10</span></div></div><div class="world-item-actions"><button data-world-center="${r.id}">📍</button><button data-world-edit="places:${r.id}">✏️</button><button data-world-rate="places:${r.id}">⭐</button><button data-world-delete="places:${r.id}">🗑</button></div></div>`).join("")}</details>`;
  }).join("");
  $id("world-locals-list").innerHTML = html || "<div>Sin locales.</div>"; }
function renderStats(){ $id("world-countries").textContent = String(new Set([...state.geography, ...state.places].map((x)=>x.countryCode).filter(Boolean)).size); $id("world-geo-count").textContent = String(state.geography.length); $id("world-rated-locals").textContent = String(state.places.length); }
function renderAll(){ renderStats(); renderWorldMapCategoryFilter(); renderMap(); renderGeoList(); renderLocals(); renderWorldStays(); }

async function persistWorld(){ const uid=getCurrentUserDataRootKey() || auth.currentUser?.uid; if(!uid) return; await set(ref(db, firebasePaths.worldGeography(uid)), Object.fromEntries(state.geography.map((r)=>[r.id,r]))); await set(ref(db, firebasePaths.worldPlaces(uid)), Object.fromEntries(state.places.map((r)=>[r.id,r]))); }

function openAddLocalModal(){
  resetWorldAddModalState();
  state.editing = null;
  state.showEditLocationSearch = true;
  state.placeModalMode = "add";
  setAddMode("place");
  renderAddLocalMode();
  setEditModeUI();
  $id("world-add-toggle").checked = true;
}

function openEditPlaceModal(placeId){
  const rec = state.places.find((x)=>x.id===placeId);
  if (!rec) return;
  state.editing = { kind:"places", id:placeId };
  state.showEditLocationSearch = false;
  state.placeModalMode = "edit";
  state.placeRating = rec.rating || 0;
  renderRatings();
  $id("world-place-edit-name").value = rec.name || "";
  $id("world-place-edit-emoji").value = rec.emoji || "";
  $id("world-place-edit-category").value = rec.category || "";
  $id("world-place-edit-country").value = rec.country || "";
  $id("world-place-edit-region").value = rec.region || "";
  $id("world-place-edit-city").value = rec.city || "";
  $id("world-place-edit-note").value = rec.note || "";
  $id("world-place-edit-product").value = rec.productName || "";
  $id("world-place-edit-price").value = Number.isFinite(Number(rec.price)) ? String(rec.price) : "";
  setAddMode("place");
  setEditModeUI();
  $id("world-add-toggle").checked = true;
}

function openEdit(kind, idv){
  if (kind === "places") return openEditPlaceModal(idv);
  const rec = state.geography.find((x)=>x.id===idv);
  if (!rec) return;
  state.editing = { kind, id:idv };
  state.showEditLocationSearch = false;
  state.geoRating = rec.rating || 0;
  renderRatings();
  $id("world-form-country").value = rec.country || ""; $id("world-form-region").value = rec.region || ""; $id("world-form-city").value = rec.city || ""; $id("world-geo-note").value = rec.note || "";
  setAddMode("geo"); setEditModeUI(); $id("world-add-toggle").checked = true;
}

async function deleteItem(kind,idv){
  console.log("[world:delete:start]", { kind, id:idv });
  if (!confirm("¿Eliminar este lugar?")) return;
  try {
    if (kind === "geography") state.geography = state.geography.filter((x)=>x.id!==idv); else state.places = state.places.filter((x)=>x.id!==idv);
    await persistWorld();
    const mk = state.markers.get(idv); if (mk) mk.remove(); state.markers.delete(idv);
    if (state.map) state.map.closePopup();
    renderAll();
    closeAddModal();
    console.log("[world:delete:success]", { kind, id:idv });
    showToast("Eliminado");
  } catch (error) { console.log("[world:delete:error]", error); }
}

async function saveEdit(){
  if (!state.editing) return;
  console.log("[world:edit:start]", state.editing);
  try {
    const rows = state.editing.kind === "geography" ? state.geography : state.places;
    const idx = rows.findIndex((x)=>x.id===state.editing.id); if (idx < 0) return;
    const prev = rows[idx];
    const payload = state.editing.kind === "geography"
      ? { name:prev.name, emoji:prev.emoji, category:prev.category, country:$id("world-form-country").value.trim(), region:$id("world-form-region").value.trim(), city:$id("world-form-city").value.trim(), note:$id("world-geo-note").value.trim(), rating:state.geoRating }
      : { name:$id("world-place-edit-name").value.trim(), emoji:$id("world-place-edit-emoji").value.trim() || prev.emoji, category:$id("world-place-edit-category").value.trim(), country:$id("world-place-edit-country").value.trim(), region:$id("world-place-edit-region").value.trim(), city:$id("world-place-edit-city").value.trim(), note:$id("world-place-edit-note").value.trim(), rating:state.placeRating, productName:$id("world-place-edit-product").value.trim(), price:parsePrice($id("world-place-edit-price").value), currency:"EUR" };
    rows[idx] = normalize({ ...prev, ...payload }, state.editing.kind);
    await persistWorld();
    console.log("[world:edit:save]", state.editing);
    renderAll(); closeAddModal(); resetWorldAddModalState(); state.showEditLocationSearch = false; state.placeModalMode = "add"; setEditModeUI(); showToast("Cambios guardados");
  } catch (error) { console.log("[world:edit:error]", error); }
}

async function searchGeo(q){ const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", q); u.searchParams.set("format", "jsonv2"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8"); const rows = await (await fetch(u)).json(); state.geoResults = (Array.isArray(rows) ? rows : []).map((r) => normalizeLocationAddress(r)).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)); renderGeoResults(); }
function isAddressQuery(query = "") {
  const q = String(query || "").trim();
  return /\d/.test(q) && /,/.test(q) && /\b(?:calle|avenida|av\.?|jr\.?|jiron|street|st\.?|road|rd\.?|per[uú]|miraflores|\d{4,6})\b/i.test(q);
}
function rankAddressResult(row, query = "") {
  const q = String(query || "").toLowerCase();
  const a = row?.address || {};
  const road = String(a.road || a.pedestrian || "").toLowerCase();
  const suburb = String(a.suburb || a.city_district || "").toLowerCase();
  const city = String(a.city || a.town || a.village || "").toLowerCase();
  const country = String(a.country || "").toLowerCase();
  const house = String(a.house_number || "").toLowerCase();
  const queryNumber = (q.match(/\b\d+[a-zA-Z]?\b/) || [])[0] || "";
  let score = 0;
  if (queryNumber && house === queryNumber) score += 100;
  if (road && q.includes(road)) score += 40;
  if ((suburb && q.includes(suburb)) || (city && q.includes(city))) score += 20;
  if (country && q.includes(country)) score += 10;
  return score;
}
async function searchPlace(q){
  const c = state.userCenter;
  const radiusRaw = $id("world-place-radius").value || "1000";
  const radius = radiusRaw === "none" ? null : Number(radiusRaw);
  const mode = isAddressQuery(q) ? "address" : "poi";
  console.debug("[world:local-search:start]", { query:q });
  console.debug("[world:local-search:mode]", { mode });
  const u = new URL("https://nominatim.openstreetmap.org/search");
  u.searchParams.set("q", q);
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  u.searchParams.set("limit", mode === "address" ? "5" : "24");
  if (mode !== "address" && radius) {
    const dLat=radius/111320, dLng=radius/(111320*Math.cos((c.lat*Math.PI)/180));
    u.searchParams.set("bounded","1");
    u.searchParams.set("viewbox",`${c.lon-dLng},${c.lat+dLat},${c.lon+dLng},${c.lat-dLat}`);
  }
  const rows = await (await fetch(u)).json();
  state.placeResults = (Array.isArray(rows) ? rows : []).map((raw) => {
    const r = normalizeLocationAddress(raw);
    const addressLine = [r.address?.road, r.address?.house_number].filter(Boolean).join(" ") || [r.address?.suburb, r.address?.county].filter(Boolean).join(", ");
    return ({ ...r, distance:radius ? hav(c.lat,c.lon,Number(r.lat),Number(r.lon)) : null, addressLine });
  }).filter((r) => mode === "address" ? true : (!radius || r.distance<=radius));
  if (mode === "address") state.placeResults.sort((a,b)=>rankAddressResult(b,q)-rankAddressResult(a,q));
  else state.placeResults.sort((a,b)=>(a.distance ?? 0)-(b.distance ?? 0));
  state.selectedPlace = null;
  state.selectedPlaceIndex = -1;
  renderPlaceResults();
  if (!state.placeResults[0]) return console.warn("[world:local-search:no-results]", { query:q });
  const top = state.placeResults[0];
  console.debug("[world:local-search:result]", { lat:top.lat, lng:top.lon, displayName:top.label || top.name || "", address:top.addressLine || "" });
  if (mode === "address") pickPlace(0, { mode });
}
async function reverseGeocode(lat, lon){
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lon));
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  const raw = await (await fetch(u)).json();
  const normalized = normalizeLocationAddress(raw);
  console.log("[world:geo:reverse:success]", normalized.label || "", normalized.city || normalized.municipality || "", normalized.region || "", normalized.country || "");
  return normalized;
}

function pickGeo(i){
  const row = state.geoResults[i];
  if (!row) return;
  const normalizedCountry = normalizeCountryFromAddress(row.address);
  if (!normalizedCountry.countryCode) return showToast("País inválido, selecciona otro resultado");
  state.selectedGeoIndex = i;
  state.selectedGeoCandidate = row;
  state.selectedGeo = normalize({
    id:`geo_${Date.now()}_${Math.random().toString(36).slice(2,8)}`,
    name:row.name,
    label:row.label,
    city:row.city || row.municipality,
    region:row.region,
    category:row.address?.type || "",
    country:normalizedCountry.country,
    countryCode:normalizedCountry.countryCode,
    postalCode:row.postalCode,
    lat:Number(row.lat),
    lon:Number(row.lon),
    lng:Number(row.lon),
    note:$id("world-geo-note").value,
    rating:state.geoRating
  }, "geography");
  console.log("[world:geo:pick]", { index:i, label:row.label, lat:state.selectedGeo.lat, lon:state.selectedGeo.lon, country:state.selectedGeo.country, region:state.selectedGeo.region, city:state.selectedGeo.city });
  $id("world-form-name").value = state.selectedGeo.name || "";
  $id("world-form-country").value = state.selectedGeo.country || "";
  $id("world-form-region").value = state.selectedGeo.region || "";
  $id("world-form-city").value = state.selectedGeo.city || "";
  if (state.map && Number.isFinite(state.selectedGeo.lat) && Number.isFinite(state.selectedGeo.lon)) state.map.setView([state.selectedGeo.lat, state.selectedGeo.lon], 9);
  renderGeoResults();
}
function pickPlace(i, opts = {}){
  const row = state.placeResults[i]; if(!row) return;
  const mode = opts.mode || (isAddressQuery($id("world-place-q").value) ? "address" : "poi");
  const normalizedCountry = normalizeCountryFromAddress(row.address);
  state.selectedPlaceIndex = i;
  const query = String($id("world-place-q").value || "").trim();
  const addressValue = row.addressLine || row.label || "";
  state.selectedPlace = normalize({ id:`place_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:mode === "address" ? "" : row.name, label:row.label, city:row.city || row.municipality, country:normalizedCountry.country, countryCode:normalizedCountry.countryCode, region:row.region, postalCode:row.postalCode, category:query, lat:row.lat, lon:row.lon, address:addressValue, rating:state.placeRating, note:$id("world-place-note").value }, "places");
  $id("world-place-form-name").value = mode === "address" ? "" : (state.selectedPlace.name || "");
  $id("world-place-form-emoji").value = state.selectedPlace.emoji || "🏪"; $id("world-place-form-category").value = state.selectedPlace.category || ""; $id("world-place-form-country").value = state.selectedPlace.country || ""; $id("world-place-form-region").value = state.selectedPlace.region || ""; $id("world-place-form-city").value = state.selectedPlace.city || ""; if (state.miniMap) state.miniMap.setView([row.lat, row.lon], 17); renderPlaceResults();
}
async function useCurrentLocationForNewPlace(){
  console.log("[world:modal:geo:start]");
  try {
    const pos = await getCurrentPositionSafe({ forceRequest:true });
    if (!pos || !Number.isFinite(pos.lat) || !Number.isFinite(pos.lon)) throw new Error("position-unavailable");
    const reverse = await reverseGeocode(pos.lat, pos.lon);
    const normalizedCountry = normalizeCountryFromAddress(reverse.address);
    state.selectedPlaceIndex = -1;
    state.selectedPlace = normalize({ id:`place_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:$id("world-place-form-name")?.value || "Nuevo local", category:$id("world-place-form-category")?.value || "", lat:pos.lat, lon:pos.lon, lng:pos.lon, rating:state.placeRating, note:$id("world-place-note")?.value || "" }, "places");
    state.selectedPlace.country = state.selectedPlace.country || normalizedCountry.country || "";
    state.selectedPlace.countryCode = state.selectedPlace.countryCode || normalizedCountry.countryCode || "";
    state.selectedPlace.region = state.selectedPlace.region || reverse.region || "";
    state.selectedPlace.city = state.selectedPlace.city || reverse.city || reverse.municipality || "";
    state.selectedPlace.address = state.selectedPlace.address || reverse.label || "";
    const displayName = reverse.label || reverse.name || "";
    state.selectedPlace.displayName = displayName;
    state.selectedPlace.googleMapsDirectionsUrl = createGoogleMapsUrl(pos.lat, pos.lon);
    state.selectedPlace.googleMapsUrl = state.selectedPlace.googleMapsDirectionsUrl;
    if (!String(state.selectedPlace.name || "").trim() || String(state.selectedPlace.name || "").trim() === "Nuevo local") state.selectedPlace.name = reverse.name || "Local";
    const preserveOrSet = (idv, value) => {
      const input = $id(idv);
      if (!input) return;
      if (!String(input.value || "").trim() && String(value || "").trim()) input.value = String(value);
    };
    preserveOrSet("world-place-form-country", state.selectedPlace.country);
    preserveOrSet("world-place-form-region", state.selectedPlace.region);
    preserveOrSet("world-place-form-city", state.selectedPlace.city);
    preserveOrSet("world-place-form-name", reverse.name || state.selectedPlace.name);
    if (state.miniMap) state.miniMap.setView([pos.lat, pos.lon], 17);
    renderPlaceResults();
    console.log("[world:modal:geo:success]", { lat:pos.lat, lon:pos.lon, country:state.selectedPlace.country, region:state.selectedPlace.region, city:state.selectedPlace.city, displayName });
  } catch (error) {
    console.log("[world:modal:geo:error]", error);
    showToast("No se pudo obtener ubicación actual (permiso denegado o GPS no disponible)");
  }
}

function bindUI(){
  const root=$id("view-world");
  root.addEventListener("click", async (e)=>{ const t=e.target.closest("button,label"); if(!t) return; if(t.matches(".world-tab")) return setWindow(t.dataset.window); if(t.id==="world-open-add") { $id("world-add-toggle").checked=true; setAddMode("geo"); resetWorldAddModalState(); state.showEditLocationSearch = true; state.placeModalMode = "add"; setEditModeUI(); }
    if(t.id==="world-open-add-place") { openAddLocalModal(); }
    if(t.id==="world-place-use-current-location") { await useCurrentLocationForNewPlace(); }
    if(t.id==="world-add-mode-geo") setAddMode("geo"); if(t.id==="world-add-mode-place") { if (state.editing) setAddMode("place"); else openAddLocalModal(); invalidateMiniMapSafe(); }
    if(t.dataset.geoPick) pickGeo(Number(t.dataset.geoPick)); if(t.dataset.placePick) pickPlace(Number(t.dataset.placePick));
    if(t.dataset.worldCenter){ const m=state.markers.get(t.dataset.worldCenter); if(m){ state.map.panTo(m.getLatLng()); m.openPopup(); } }
    if(t.dataset.worldDelete){ const [kind,idv]=t.dataset.worldDelete.split(":"); await deleteItem(kind,idv); }
    if(t.dataset.worldEdit){ const [kind,idv]=t.dataset.worldEdit.split(":"); openEdit(kind,idv); }
    if(t.dataset.worldRate){ const [kind,idv]=t.dataset.worldRate.split(":"); const rows = kind === "geography" ? state.geography : state.places; const rec = rows.find((x)=>x.id===idv); if (!rec) return; rec.rating = Math.min(10, (rec.rating || 0) + 1); await persistWorld(); renderAll(); }
    if (t.id === "world-geo-enable-search" || t.id === "world-place-enable-search") { state.showEditLocationSearch = true; setEditModeUI(); }
    if (t.dataset.worldMapFilterClear) clearWorldMapCategoryFilter(t.dataset.worldMapFilterClear);
  });
  $id("world-geo-q").addEventListener("input", (e)=> e.target.value.trim().length>1 ? searchGeo(e.target.value.trim()) : ($id("world-geo-results").innerHTML = ""));
  $id("world-place-q").addEventListener("input", (e)=> e.target.value.trim().length>1 ? searchPlace(e.target.value.trim()) : ($id("world-place-results").innerHTML = ""));
  $id("world-place-radius").addEventListener("change", ()=> $id("world-place-q").dispatchEvent(new Event("input")));
  $id("world-add-toggle").addEventListener("change", (e)=>{ if (e.target.checked && state.addMode === "place") invalidateMiniMapSafe(); });
  $id("world-locals-group").addEventListener("change", ()=> renderLocals());
  root.addEventListener("change", (e)=>{ if(e.target?.id==="world-map-stats-filter"){ state.mapStatsCountry = e.target.value; renderGeoList(); } if (e.target?.id === "world-map-category-filter-select" && e.target.value) { toggleWorldMapCategoryFilter(e.target.value); e.target.value = ""; }});
  $id("world-geo-save").addEventListener("click", async ()=>{ if (state.editing) return saveEdit(); if(!state.selectedGeo) return; const candidate = state.selectedGeoCandidate || {}; state.selectedGeo.note = $id("world-geo-note").value.trim(); state.selectedGeo.rating = state.geoRating; state.selectedGeo.country = $id("world-form-country").value.trim() || state.selectedGeo.country; state.selectedGeo.region = $id("world-form-region").value.trim() || state.selectedGeo.region; state.selectedGeo.city = $id("world-form-city").value.trim() || state.selectedGeo.city; state.selectedGeo.lat = Number(candidate.lat ?? state.selectedGeo.lat); state.selectedGeo.lon = Number(candidate.lon ?? candidate.lng ?? state.selectedGeo.lon); state.selectedGeo.lng = Number(state.selectedGeo.lon); state.selectedGeo.googleMapsDirectionsUrl = createGoogleMapsUrl(state.selectedGeo.lat, state.selectedGeo.lon); state.selectedGeo.googleMapsUrl = state.selectedGeo.googleMapsDirectionsUrl; console.log("[world:geo:save]", { id:state.selectedGeo.id, lat:state.selectedGeo.lat, lon:state.selectedGeo.lon, country:state.selectedGeo.country, region:state.selectedGeo.region, city:state.selectedGeo.city }); state.geography.push(state.selectedGeo); await persistWorld(); renderAll(); closeAddModal(); resetWorldAddModalState(); showToast("Guardado"); });
  $id("world-place-save").addEventListener("click", async ()=>{ if (state.editing) return saveEdit(); if(!state.selectedPlace) return; state.selectedPlace.rating = state.placeRating; state.selectedPlace.note = $id("world-place-note").value.trim(); state.selectedPlace.name = $id("world-place-form-name").value.trim() || state.selectedPlace.name; state.selectedPlace.emoji = $id("world-place-form-emoji").value.trim() || state.selectedPlace.emoji; state.selectedPlace.category = $id("world-place-form-category").value.trim(); state.selectedPlace.country = $id("world-place-form-country").value.trim() || state.selectedPlace.country; state.selectedPlace.region = $id("world-place-form-region").value.trim() || state.selectedPlace.region; state.selectedPlace.city = $id("world-place-form-city").value.trim() || state.selectedPlace.city; state.selectedPlace.productName = $id("world-place-form-product").value.trim(); state.selectedPlace.price = parsePrice($id("world-place-form-price").value); state.selectedPlace.currency = "EUR"; state.selectedPlace.lng = Number(state.selectedPlace.lon); state.selectedPlace.googleMapsDirectionsUrl = createGoogleMapsUrl(state.selectedPlace.lat, state.selectedPlace.lon); state.selectedPlace.googleMapsUrl = state.selectedPlace.googleMapsDirectionsUrl; if ((!String(state.selectedPlace.name || "").trim() || String(state.selectedPlace.name || "").trim() === "Nuevo local") && String(state.selectedPlace.address || "").trim()) state.selectedPlace.name = state.selectedPlace.address; if (!String(state.selectedPlace.label || "").trim() && String(state.selectedPlace.address || "").trim()) state.selectedPlace.label = state.selectedPlace.address; console.debug("[world:save:local:start]", state.selectedPlace); state.places.push(state.selectedPlace); await persistWorld(); console.debug("[world:save:local:stored]", state.selectedPlace); renderAll(); closeAddModal(); resetWorldAddModalState(); showToast("Guardado"); });
  $id("world-place-edit-save").addEventListener("click", async ()=>{ if (!state.editing || state.editing.kind !== "places") return; await saveEdit(); });
  ["world-rating-stars","world-geo-rating-stars","world-place-edit-rating-stars"].forEach((rid)=>{ const rating = $id(rid); rating.addEventListener("pointerdown",(e)=>{ const move=(ev)=>{ const value=ratingFromPointer(rating, ev.clientX); if (rid === "world-geo-rating-stars") state.geoRating=value; else state.placeRating=value; renderRatings(); }; move(e); window.addEventListener("pointermove", move); const up=()=>{ window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointerup", up); }); });
}

function initMiniMap(){ if(!window.L) return; const host=$id("world-mini-map"); if(!host) return; if(!state.miniMap) state.miniMap=createLeafletMap(host, { center:[state.userCenter.lat,state.userCenter.lon], zoom:15 }); state.miniMap.setView([state.userCenter.lat,state.userCenter.lon],15); renderPlaceResults(); }
function invalidateMiniMapSafe(){
  if (!state.miniMap) return;
  requestAnimationFrame(() => {
    state.miniMap.invalidateSize?.();
    setTimeout(() => state.miniMap?.invalidateSize?.(), 90);
  });
}
async function resolveWorldLocationPermissionState(){
  if (!navigator.permissions?.query) return "unknown";
  try {
    const result = await navigator.permissions.query({ name:"geolocation" });
    return String(result?.state || "unknown");
  } catch { return "unknown"; }
}
async function getCurrentPositionSafe({ forceRequest = false } = {}){
  if (!(window.isSecureContext && navigator.geolocation)) return null;
  const cachedAccepted = localStorage.getItem(WORLD_LOCATION_PERMISSION_KEY) === "true";
  if (cachedAccepted && !forceRequest) console.log("[world:location] permission:cached");
  const permissionState = await resolveWorldLocationPermissionState();
  if (!forceRequest && !cachedAccepted) return null;
  if (permissionState === "denied") { localStorage.removeItem(WORLD_LOCATION_PERMISSION_KEY); console.log("[world:location] permission:denied"); return null; }
  console.log("[world:location] permission:request");
  return new Promise((resolve)=>navigator.geolocation.getCurrentPosition((pos)=>{ localStorage.setItem(WORLD_LOCATION_PERMISSION_KEY, "true"); console.log("[world:location] permission:accepted"); resolve({ lat:Number(pos.coords.latitude), lon:Number(pos.coords.longitude) }); }, ()=>{ localStorage.removeItem(WORLD_LOCATION_PERMISSION_KEY); console.log("[world:location] permission:denied"); resolve(null); }, { enableHighAccuracy:true, maximumAge:60000, timeout:12000 }));
}

export async function init(){ if(state.initialized) return; state.initialized=true; await ensureLeaflet(); bindUI(); initWorldStays({ root:$id("view-world"), state, helpers:{ showToast } }); renderRatings(); const uid=getCurrentUserDataRootKey() || auth.currentUser?.uid; if(!uid) return; const geographyPath = firebasePaths.worldGeography(uid); const placesPath = firebasePaths.worldPlaces(uid); const rerender = () => { renderAll(); if (state.map && !state._mapClusterBound) { state._mapClusterBound = true; state.map.on("zoomend moveend", ()=>renderWorldMarkers()); } }; state.unsubGeography=trackedOnValue(ref(db, geographyPath), (snap)=>{ const data=snap.val()||{}; state.geography=Object.values(data).map((x)=>normalize(x,"geography")); rerender(); }, { key:"world-geography", path:geographyPath, module:"world", mode:"onValue", reason:"world-geography", viewId:"view-world" }, onValue); state.unsubPlaces=trackedOnValue(ref(db, placesPath), (snap)=>{ const data=snap.val()||{}; state.places=Object.values(data).map((x)=>normalize({ ...x, lng:x.lng ?? x.lon, googleMapsDirectionsUrl:x.googleMapsDirectionsUrl || x.googleMapsUrl || createGoogleMapsUrl(x.lat, x.lon ?? x.lng), googleMapsUrl:x.googleMapsUrl || x.googleMapsDirectionsUrl || createGoogleMapsUrl(x.lat, x.lon ?? x.lng) },"places")); rerender(); }, { key:"world-places", path:placesPath, module:"world", mode:"onValue", reason:"world-places", viewId:"view-world" }, onValue); }
export function destroy(){ if(state.unsubGeography) state.unsubGeography(); if(state.unsubPlaces) state.unsubPlaces(); state.unsubGeography=null; state.unsubPlaces=null; if(state.map){ destroyWorldMapLayers(); destroyLeafletMap($id("world-map")); state.map=null; } if(state.miniMap){ destroyLeafletMap($id("world-mini-map")); state.miniMap=null; } state.initialized=false; }
export async function onShow(){ if(!state.initialized) await init(); setWindow(state.activeWindow); invalidateLeafletMap(state.map,70); }
export async function onHide(){ destroy(); }
export function getListenerCount(){ return (state.unsubGeography?1:0) + (state.unsubPlaces?1:0); }
