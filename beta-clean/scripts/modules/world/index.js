import { auth, db, firebasePaths, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createLeafletMap, DEFAULT_MAP_CENTER_SPAIN, destroyLeafletMap, ensureLeaflet, invalidateLeafletMap } from "../../shared/vendors/leaflet.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";
import { getCountryEnglishName } from "./countries.js";

const $id = (id) => document.getElementById(id);
const WORLD_PATH = (uid) => firebasePaths.world(uid);
const id = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const stars10 = (v = 0) => "★".repeat(Math.round(v)).padEnd(10, "☆");
const hav = (a, b, c, d) => { const R = 6371000; const to = (x) => x * Math.PI / 180; const d1 = to(c - a), d2 = to(d - b); const q = Math.sin(d1 / 2) ** 2 + Math.cos(to(a)) * Math.cos(to(c)) * Math.sin(d2 / 2) ** 2; return 2 * R * Math.atan2(Math.sqrt(q), Math.sqrt(1 - q)); };
const countryNameToIso = new Intl.DisplayNames(["en"], { type:"region" });

const state = { initialized:false, unsub:null, rootRef:null, map:null, miniMap:null, miniMarkers:[], markers:new Map(), geography:[], places:[], userCenter:{ lat:DEFAULT_MAP_CENTER_SPAIN[0], lon:DEFAULT_MAP_CENTER_SPAIN[1] }, selectedGeo:null, selectedPlace:null, selectedGeoIndex:-1, selectedPlaceIndex:-1, geoResults:[], placeResults:[], geoRating:0, placeRating:0, activeWindow:"map", addMode:"geo", editing:null, toastTimer:null, mapMarkersIndex:new Map() };

const normalize = (r = {}, kind = "geography") => ({ id:r.id || id(), kind, name:String(r.name || r.placeName || "").trim(), label:String(r.label || r.displayName || r.name || "").trim(), country:String(r.country || "").trim(), countryCode:String(r.countryCode || r.country_code || "").trim().toUpperCase(), city:String(r.city || "").trim(), region:String(r.region || r.subdivision || "").trim(), postalCode:String(r.postalCode || "").trim(), address:String(r.address || "").trim(), category:String(r.category || r.type || "").trim(), emoji:String(r.emoji || (kind === "places" ? "🏪" : "📍")).trim(), note:String(r.note || "").trim(), rating:Number.isFinite(Number(r.rating)) ? Number(r.rating) : null, lat:Number(r.lat), lon:Number(r.lon), createdAt:Number(r.createdAt || Date.now()), updatedAt:Date.now() });
const normalizeLocationAddress = (result = {}) => { const a = result?.address || {}; return { label:String(result?.display_name || result?.label || "").trim(), name:String(result?.name || result?.display_name || "").split(",")[0].trim(), country:String(a.country || "").trim(), countryCode:String(a.country_code || "").trim().toUpperCase(), region:String(a.state || a.region || "").trim(), city:String(a.city || a.town || a.village || a.municipality || "").trim(), municipality:String(a.municipality || "").trim(), postalCode:String(a.postcode || "").trim(), lat:Number(result?.lat), lon:Number(result?.lon ?? result?.lng), address:a }; };
const flag = (cc = "") => { const s = String(cc || "").trim().toUpperCase(); return /^[A-Z]{2}$/.test(s) ? String.fromCodePoint(...[...s].map((c) => 127397 + c.charCodeAt(0))) : "🌍"; };

function showToast(text = "Guardado") { const el = $id("world-feedback"); if (!el) return; el.textContent = text; el.classList.add("show"); clearTimeout(state.toastTimer); state.toastTimer = setTimeout(() => el.classList.remove("show"), 1700); }
function closeAddModal(){ $id("world-add-toggle").checked = false; }
function resetWorldAddModalState(){ state.selectedGeo = null; state.selectedPlace = null; state.selectedGeoIndex = -1; state.selectedPlaceIndex = -1; state.geoResults = []; state.placeResults = []; state.geoRating = 0; state.placeRating = 0; state.editing = null; ["world-geo-q","world-geo-note","world-place-q","world-place-note","world-form-name","world-form-emoji","world-form-category","world-form-country","world-form-region","world-form-city"].forEach((k)=>{ const el=$id(k); if (el) el.value=""; }); $id("world-place-radius").value = "1000"; $id("world-geo-results").innerHTML = ""; $id("world-place-results").innerHTML = ""; renderRatings(); renderPlaceResults(); }
function clearGeoPanelState(){ state.selectedGeo = null; state.selectedGeoIndex = -1; state.geoResults = []; state.geoRating = 0; ["world-geo-q","world-geo-note","world-form-name","world-form-emoji","world-form-category","world-form-country","world-form-region","world-form-city"].forEach((k)=>{ const el = $id(k); if (el) el.value = ""; }); const geoResults = $id("world-geo-results"); if (geoResults) geoResults.innerHTML = ""; }
function clearLocalPanelState(){ state.selectedPlace = null; state.selectedPlaceIndex = -1; state.placeResults = []; state.placeRating = 0; ["world-place-q","world-place-note"].forEach((k)=>{ const el = $id(k); if (el) el.value = ""; }); $id("world-place-radius").value = "1000"; const placeResults = $id("world-place-results"); if (placeResults) placeResults.innerHTML = ""; renderPlaceResults(); }

function normalizeCountryFromAddress(address = {}) {
  const rawCode = String(address?.country_code || "").trim().toUpperCase();
  const rawCountry = String(address?.country || "").trim();
  let countryCode = /^[A-Z]{2}$/.test(rawCode) ? rawCode : "";
  if (!countryCode && rawCountry) {
    const found = ["ES","AR","US","MX","FR","IT","PT","DE"].find((cc) => countryNameToIso.of(cc)?.toLowerCase() === rawCountry.toLowerCase());
    countryCode = found || "";
  }
  return { countryCode, country: rawCountry || (countryCode ? getCountryEnglishName(countryCode) : "") };
}

function renderGeoAddMode(){ $id("world-geo-mode").hidden = false; $id("world-place-mode").hidden = true; }
function renderLocalAddMode(){ $id("world-place-mode").hidden = false; $id("world-geo-mode").hidden = true; initMiniMap(); }
function setAddMode(mode){
  const prev = state.addMode;
  state.addMode = mode;
  $id("world-add-mode-geo").classList.toggle("active", mode === "geo");
  $id("world-add-mode-place").classList.toggle("active", mode === "place");
  if (mode === "geo") { if (prev === "place") clearLocalPanelState(); renderGeoAddMode(); }
  else { if (prev === "geo") clearGeoPanelState(); renderLocalAddMode(); }
  renderRatings();
}

function ratingFromPointer(el, clientX){ const rect = el.getBoundingClientRect(); return Math.max(0, Math.min(10, ((clientX - rect.left) / Math.max(rect.width, 1)) * 10)); }
function renderRating(elId, value){ const el = $id(elId); if(!el) return; el.setAttribute("aria-valuenow", String(value.toFixed(1))); el.innerHTML = `<div class="world-rating-track"><div class="world-rating-fill" style="width:${(value/10)*100}%"></div><div class="world-rating-text">${stars10(value)} ${value.toFixed(1)}/10</div></div>`; }
function renderRatings(){ renderRating("world-geo-rating-stars", state.geoRating); renderRating("world-rating-stars", state.placeRating); }

function renderGeoResults(){ const root = $id("world-geo-results"); root.innerHTML = state.geoResults.map((r, i) => `<button class="world-result-card ${state.selectedGeoIndex===i?"is-selected":""}" data-geo-pick="${i}"><strong>${r.name}</strong><small>${r.label || ""}</small></button>`).join(""); }
function renderPlaceResults(){ const root = $id("world-place-results"); root.innerHTML = state.placeResults.map((r, i) => `<button class="world-result-card ${state.selectedPlaceIndex===i?"is-selected":""}" data-place-pick="${i}"><strong>${r.name}</strong><small>${r.addressLine || r.label || ""}${r.city ? `, ${r.city}` : ""}${Number.isFinite(r.distance) ? ` · ${Math.round(r.distance)} m` : ""}</small></button>`).join(""); renderMiniMapMarkers(); }

function buildPopup(rec){ return `<div class="world-popup"><strong>${rec.emoji || "📍"} ${rec.name || rec.city || "Punto"}</strong><small>${rec.label || ""}</small><small>${flag(rec.countryCode)} ${rec.country || getCountryEnglishName(rec.countryCode) || ""}</small><small>${stars10(rec.rating || 0)} ${(rec.rating ?? 0).toFixed(1)}/10</small><div class="world-popup-actions"><button data-world-center="${rec.id}">Centrar</button><button data-world-edit="${rec.kind}:${rec.id}">Editar</button><button data-world-delete="${rec.kind}:${rec.id}">Eliminar</button>${rec.kind === "places" ? `<button data-world-rate="${rec.kind}:${rec.id}">Rating +1</button>` : ""}</div></div>`; }
function renderMiniMapMarkers(){ if (!state.miniMap || !window.L) return; state.miniMarkers.forEach((m)=>m.remove()); state.miniMarkers = []; const L = window.L; state.placeResults.forEach((r, i) => { if (!Number.isFinite(r.lat) || !Number.isFinite(r.lon)) return; const marker = L.circleMarker([r.lat, r.lon], { radius:7, fillOpacity:0.9, color:"#fff", fillColor:state.selectedPlaceIndex===i?"#ff8a65":"#5ec7ff", weight:2 }).addTo(state.miniMap); marker.on("click", ()=>{ pickPlace(i); state.miniMap.setView([r.lat, r.lon], 17); }); state.miniMarkers.push(marker); }); }
function groupForCurrentZoom(rows = []) {
  if (!state.map || !window.L) return [];
  const zoom = state.map.getZoom();
  const cellSize = zoom <= 4 ? 8 : zoom <= 7 ? 3 : zoom <= 10 ? 1 : 0;
  if (!cellSize) return rows.map((r) => ({ type:"single", rows:[r], lat:r.lat, lon:r.lon }));
  const buckets = new Map();
  rows.forEach((r) => {
    const k = `${Math.floor(Number(r.lat) / cellSize)}:${Math.floor(Number(r.lon) / cellSize)}`;
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(r);
  });
  return [...buckets.values()].map((group) => {
    if (group.length === 1) return { type:"single", rows:group, lat:group[0].lat, lon:group[0].lon };
    const lat = group.reduce((sum, r) => sum + Number(r.lat), 0) / group.length;
    const lon = group.reduce((sum, r) => sum + Number(r.lon), 0) / group.length;
    return { type:"cluster", rows:group, lat, lon };
  });
}

function renderMap(){ if(!window.L) return; const host = $id("world-map"); if(!host) return; if(!state.map) state.map = createLeafletMap(host, { center:[state.userCenter.lat, state.userCenter.lon], zoom:5 }); state.markers.forEach((m)=>m.remove()); state.markers.clear(); state.mapMarkersIndex.clear(); const L = window.L; const grouped = groupForCurrentZoom([...state.geography, ...state.places].filter((r)=>Number.isFinite(r.lat)&&Number.isFinite(r.lon))); grouped.forEach((entry)=>{ if (entry.type === "cluster") { const marker = L.circleMarker([entry.lat, entry.lon], { radius:10, color:"#fff", weight:2, fillColor:"#9b8bff", fillOpacity:0.95 }).addTo(state.map); marker.bindTooltip(String(entry.rows.length), { permanent:true, direction:"center", className:"world-cluster-count" }); marker.on("click", ()=> state.map.setView([entry.lat, entry.lon], Math.min(17, state.map.getZoom() + 2))); return; } const r = entry.rows[0]; const marker = L.circleMarker([r.lat,r.lon], { radius:r.kind==="places"?8:6, color:"#fff", weight:1, fillColor:r.kind==="places"?"#ffc86b":"#61d1ff", fillOpacity:0.95 }).addTo(state.map); marker.bindPopup(buildPopup(r)); state.markers.set(r.id, marker); state.mapMarkersIndex.set(r.id, marker); }); }
function setWindow(mode){ state.activeWindow = mode; document.querySelectorAll("#view-world .world-tab").forEach((b)=>b.classList.toggle("active", b.dataset.window===mode)); document.querySelectorAll("#view-world [data-window-panel]").forEach((p)=>p.classList.toggle("active", p.dataset.windowPanel===mode)); invalidateLeafletMap(state.map, 60); }

function renderGeoList(){
  const groups = state.geography.reduce((acc, r) => { const key = r.countryCode || r.country || "XX"; acc[key] = acc[key] || { country:r.country, countryCode:r.countryCode, rows:[] }; acc[key].rows.push(r); return acc; }, {});
  const html = Object.values(groups).map((g)=>{
    const ratedRows = g.rows.filter((r) => Number.isFinite(Number(r.rating)));
    const countryAvg = ratedRows.length ? ratedRows.reduce((sum, r) => sum + Number(r.rating || 0), 0) / ratedRows.length : 0;
    return `<details><summary><strong>${flag(g.countryCode)} ${g.country || getCountryEnglishName(g.countryCode) || ""}</strong> · ${g.rows.length} · ${stars10(countryAvg)} ${countryAvg.toFixed(1)}/10</summary>${g.rows.map((r)=>`<div class="world-rich-item"><div><strong class="world-geo-title">${r.name || r.city}</strong><small class="world-geo-rating">${stars10(r.rating || 0)} ${(r.rating ?? 0).toFixed(1)}/10</small></div><div class="world-item-actions"><button data-world-center="${r.id}">📍</button><button data-world-edit="geography:${r.id}">✏️</button><button data-world-delete="geography:${r.id}">🗑</button></div></div>`).join("")}</details>`;
  }).join("");
  $id("world-country-list").innerHTML = html || "<div>Sin lugares geográficos.</div>";
}
function renderLocals(){ const rows=state.places; const mode = $id("world-locals-group")?.value || "type"; if (mode !== "country") { $id("world-locals-list").innerHTML = rows.map((r)=>`<div class="world-rich-item"><div><strong>${r.emoji || "🏪"} ${r.name}</strong><div>${stars10(r.rating || 0)} ${(r.rating ?? 0).toFixed(1)}/10</div><small>${r.category || "Local"} · ${r.city || ""}</small></div><div class="world-item-actions"><button data-world-center="${r.id}">📍</button><button data-world-edit="places:${r.id}">✏️</button><button data-world-rate="places:${r.id}">⭐</button><button data-world-delete="places:${r.id}">🗑</button></div></div>`).join("") || "<div>Sin locales.</div>"; return; } const groups = rows.reduce((acc, r)=>{ const key = r.countryCode || r.country || "XX"; (acc[key] ||= { country:r.country, countryCode:r.countryCode, rows:[] }).rows.push(r); return acc; }, {}); $id("world-locals-list").innerHTML = Object.values(groups).map((g)=>`<details open><summary><strong>${flag(g.countryCode)} ${g.country || getCountryEnglishName(g.countryCode) || "Sin país"}</strong></summary>${g.rows.map((r)=>`<div class="world-rich-item"><div><strong>${r.name}</strong><small>${r.city || r.region || ""}</small></div><div class="world-item-actions"><button data-world-center="${r.id}">📍</button><button data-world-edit="places:${r.id}">✏️</button><button data-world-rate="places:${r.id}">⭐</button><button data-world-delete="places:${r.id}">🗑</button></div></div>`).join("")}</details>`).join("") || "<div>Sin locales.</div>"; }
function renderStats(){ $id("world-countries").textContent = String(new Set([...state.geography, ...state.places].map((x)=>x.countryCode).filter(Boolean)).size); $id("world-geo-count").textContent = String(state.geography.length); $id("world-rated-locals").textContent = String(state.places.length); }
function renderAll(){ renderStats(); renderMap(); renderGeoList(); renderLocals(); }

async function persistWorld(){ if(!state.rootRef) return; await set(state.rootRef, { geography:Object.fromEntries(state.geography.map((r)=>[r.id,r])), places:Object.fromEntries(state.places.map((r)=>[r.id,r])), updatedAt:Date.now() }); }

function openEdit(kind, idv){ const rows = kind === "geography" ? state.geography : state.places; const rec = rows.find((x)=>x.id===idv); if (!rec) return; state.editing = { kind, id:idv }; if (kind === "geography") state.geoRating = rec.rating || 0; else state.placeRating = rec.rating || 0; renderRatings(); $id("world-form-name").value = rec.name || ""; $id("world-form-emoji").value = rec.emoji || ""; $id("world-form-category").value = rec.category || ""; $id("world-form-country").value = rec.country || ""; $id("world-form-region").value = rec.region || ""; $id("world-form-city").value = rec.city || ""; (kind === "geography" ? $id("world-geo-note") : $id("world-place-note")).value = rec.note || ""; setAddMode(kind === "geography" ? "geo" : "place"); $id("world-add-toggle").checked = true; }

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
    rows[idx] = normalize({ ...prev, name:$id("world-form-name").value.trim(), emoji:$id("world-form-emoji").value.trim() || prev.emoji, category:$id("world-form-category").value.trim(), country:$id("world-form-country").value.trim(), region:$id("world-form-region").value.trim(), city:$id("world-form-city").value.trim(), note:(state.editing.kind==="geography"?$id("world-geo-note"):$id("world-place-note")).value.trim(), rating:state.editing.kind==="geography"?state.geoRating:state.placeRating }, state.editing.kind);
    await persistWorld();
    console.log("[world:edit:save]", state.editing);
    renderAll(); closeAddModal(); resetWorldAddModalState(); showToast("Cambios guardados");
  } catch (error) { console.log("[world:edit:error]", error); }
}

async function searchGeo(q){ const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", q); u.searchParams.set("format", "jsonv2"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8"); const rows = await (await fetch(u)).json(); state.geoResults = (Array.isArray(rows) ? rows : []).map((r) => normalizeLocationAddress(r)).filter((r) => Number.isFinite(r.lat) && Number.isFinite(r.lon)); renderGeoResults(); }
async function searchPlace(q){ const c=state.userCenter; const radiusRaw=$id("world-place-radius").value||"1000"; const radius=radiusRaw === "none" ? null : Number(radiusRaw); const u=new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q",q); u.searchParams.set("format","jsonv2"); u.searchParams.set("addressdetails","1"); u.searchParams.set("limit","24"); if (radius) { const dLat=radius/111320, dLng=radius/(111320*Math.cos((c.lat*Math.PI)/180)); u.searchParams.set("bounded","1"); u.searchParams.set("viewbox",`${c.lon-dLng},${c.lat+dLat},${c.lon+dLng},${c.lat-dLat}`); } const rows=await (await fetch(u)).json(); state.placeResults=(Array.isArray(rows)?rows:[]).map((raw)=>{ const r=normalizeLocationAddress(raw); const addressLine = [r.address?.road, r.address?.house_number].filter(Boolean).join(" ") || [r.address?.suburb, r.address?.county].filter(Boolean).join(", "); return ({ ...r, distance:radius ? hav(c.lat,c.lon,Number(r.lat),Number(r.lon)) : null, addressLine }); }).filter((r)=>!radius || r.distance<=radius).sort((a,b)=>(a.distance ?? 0)-(b.distance ?? 0)); state.selectedPlace = null; state.selectedPlaceIndex = -1; renderPlaceResults(); }

function pickGeo(i){ const row = state.geoResults[i]; if(!row) return; const normalizedCountry = normalizeCountryFromAddress(row.address); if (!normalizedCountry.countryCode) return showToast("País inválido, selecciona otro resultado"); state.selectedGeoIndex = i; state.selectedGeo = normalize({ id:`geo_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:row.name, label:row.label, city:row.city || row.municipality, region:row.region, category:row.address?.type || "", country:normalizedCountry.country, countryCode:normalizedCountry.countryCode, postalCode:row.postalCode, lat:row.lat, lon:row.lon, note:$id("world-geo-note").value, rating:state.geoRating }, "geography"); console.log("[world:geo:select]", state.selectedGeo); $id("world-form-name").value = state.selectedGeo.name || ""; $id("world-form-country").value = state.selectedGeo.country || ""; $id("world-form-region").value = state.selectedGeo.region || ""; $id("world-form-city").value = state.selectedGeo.city || ""; $id("world-form-category").value = state.selectedGeo.category || ""; $id("world-form-emoji").value = state.selectedGeo.emoji || "📍"; console.log("[world:geo:autofill]", { country:state.selectedGeo.country, region:state.selectedGeo.region, city:state.selectedGeo.city, category:state.selectedGeo.category }); if (state.map && Number.isFinite(state.selectedGeo.lat) && Number.isFinite(state.selectedGeo.lon)) state.map.setView([state.selectedGeo.lat, state.selectedGeo.lon], 9); renderGeoResults(); }
function pickPlace(i){ const row = state.placeResults[i]; if(!row) return; const normalizedCountry = normalizeCountryFromAddress(row.address); state.selectedPlaceIndex = i; state.selectedPlace = normalize({ id:`place_${Date.now()}_${Math.random().toString(36).slice(2,8)}`, name:row.name, label:row.label, city:row.city || row.municipality, country:normalizedCountry.country, countryCode:normalizedCountry.countryCode, region:row.region, postalCode:row.postalCode, category:$id("world-place-q").value, lat:row.lat, lon:row.lon, address:row.addressLine || row.label, rating:state.placeRating, note:$id("world-place-note").value }, "places"); if (state.miniMap) state.miniMap.setView([row.lat, row.lon], 17); renderPlaceResults(); }

function bindUI(){
  const root=$id("view-world");
  root.addEventListener("click", async (e)=>{ const t=e.target.closest("button,label"); if(!t) return; if(t.matches(".world-tab")) return setWindow(t.dataset.window); if(t.id==="world-open-add") { $id("world-add-toggle").checked=true; setAddMode("geo"); resetWorldAddModalState(); }
    if(t.id==="world-add-mode-geo") setAddMode("geo"); if(t.id==="world-add-mode-place") setAddMode("place");
    if(t.dataset.geoPick) pickGeo(Number(t.dataset.geoPick)); if(t.dataset.placePick) pickPlace(Number(t.dataset.placePick));
    if(t.dataset.worldCenter){ const m=state.markers.get(t.dataset.worldCenter); if(m){ state.map.panTo(m.getLatLng()); m.openPopup(); } }
    if(t.dataset.worldDelete){ const [kind,idv]=t.dataset.worldDelete.split(":"); await deleteItem(kind,idv); }
    if(t.dataset.worldEdit){ const [kind,idv]=t.dataset.worldEdit.split(":"); openEdit(kind,idv); }
    if(t.dataset.worldRate){ const [kind,idv]=t.dataset.worldRate.split(":"); const rows = kind === "geography" ? state.geography : state.places; const rec = rows.find((x)=>x.id===idv); if (!rec) return; rec.rating = Math.min(10, (rec.rating || 0) + 1); await persistWorld(); renderAll(); }
  });
  $id("world-geo-q").addEventListener("input", (e)=> e.target.value.trim().length>1 ? searchGeo(e.target.value.trim()) : ($id("world-geo-results").innerHTML = ""));
  $id("world-place-q").addEventListener("input", (e)=> e.target.value.trim().length>1 ? searchPlace(e.target.value.trim()) : ($id("world-place-results").innerHTML = ""));
  $id("world-place-radius").addEventListener("change", ()=> $id("world-place-q").dispatchEvent(new Event("input")));
  $id("world-locals-group").addEventListener("change", ()=> renderLocals());
  $id("world-geo-save").addEventListener("click", async ()=>{ if (state.editing) return saveEdit(); if(!state.selectedGeo) return; state.selectedGeo.note = $id("world-geo-note").value.trim(); state.selectedGeo.rating = state.geoRating; state.geography.push(state.selectedGeo); await persistWorld(); renderAll(); closeAddModal(); resetWorldAddModalState(); showToast("Guardado"); });
  $id("world-place-save").addEventListener("click", async ()=>{ if (state.editing) return saveEdit(); if(!state.selectedPlace) return; state.selectedPlace.rating = state.placeRating; state.selectedPlace.note = $id("world-place-note").value.trim(); state.places.push(state.selectedPlace); await persistWorld(); renderAll(); closeAddModal(); resetWorldAddModalState(); showToast("Guardado"); });
  ["world-rating-stars","world-geo-rating-stars"].forEach((rid)=>{ const rating = $id(rid); rating.addEventListener("pointerdown",(e)=>{ const move=(ev)=>{ const value=ratingFromPointer(rating, ev.clientX); if (rid === "world-geo-rating-stars") state.geoRating=value; else state.placeRating=value; renderRatings(); }; move(e); window.addEventListener("pointermove", move); const up=()=>{ window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointerup", up); }); });
}

function initMiniMap(){ if(!window.L) return; const host=$id("world-mini-map"); if(!host) return; if(!state.miniMap) state.miniMap=createLeafletMap(host, { center:[state.userCenter.lat,state.userCenter.lon], zoom:15 }); state.miniMap.setView([state.userCenter.lat,state.userCenter.lon],15); renderPlaceResults(); }
async function getCurrentPositionSafe(){ if (!(window.isSecureContext && navigator.geolocation)) return null; return new Promise((resolve)=>navigator.geolocation.getCurrentPosition((pos)=>resolve({ lat:Number(pos.coords.latitude), lon:Number(pos.coords.longitude) }), ()=>resolve(null), { enableHighAccuracy:true, maximumAge:60000, timeout:12000 })); }

export async function init(){ if(state.initialized) return; state.initialized=true; await ensureLeaflet(); bindUI(); renderRatings(); const p=await getCurrentPositionSafe(); if(p) state.userCenter=p; const uid=getCurrentUserDataRootKey() || auth.currentUser?.uid; if(!uid) return; state.rootRef=ref(db, WORLD_PATH(uid)); state.unsub=trackedOnValue(state.rootRef, (snap)=>{ const data=snap.val()||{}; state.geography=Object.values(data.geography||{}).map((x)=>normalize(x,"geography")); state.places=Object.values(data.places||{}).map((x)=>normalize(x,"places")); renderAll(); if (state.map && !state._mapClusterBound) { state._mapClusterBound = true; state.map.on("zoomend", ()=>renderMap()); } }, { key:"world-root", path:WORLD_PATH(uid), module:"world", mode:"onValue", reason:"world-sync", viewId:"view-world" }, onValue); }
export function destroy(){ if(state.unsub) state.unsub(); state.unsub=null; if(state.map){ destroyLeafletMap($id("world-map")); state.map=null; } if(state.miniMap){ destroyLeafletMap($id("world-mini-map")); state.miniMap=null; } state.initialized=false; }
export async function onShow(){ if(!state.initialized) await init(); setWindow(state.activeWindow); invalidateLeafletMap(state.map,70); }
export async function onHide(){ destroy(); }
export function getListenerCount(){ return state.unsub?1:0; }
