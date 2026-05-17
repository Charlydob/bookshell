import { auth, db, firebasePaths, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, set, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createLeafletMap, DEFAULT_MAP_CENTER_SPAIN, destroyLeafletMap, ensureLeaflet, invalidateLeafletMap } from "../../shared/vendors/leaflet.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";
import { getCountryEnglishName } from "./countries.js";

const $id = (id) => document.getElementById(id);
const WORLD_PATH = (uid) => firebasePaths.world(uid);
const state = { initialized:false, unsub:null, rootRef:null, map:null, miniMap:null, markers:new Map(), geography:[], places:[], userCenter:{ lat:DEFAULT_MAP_CENTER_SPAIN[0], lon:DEFAULT_MAP_CENTER_SPAIN[1] }, selectedGeo:null, selectedPlace:null, geoResults:[], placeResults:[], rating:0, activeWindow:"map", addMode:"geo", longPressTimer:null };

const log = (tag, ...args) => console.info(tag, ...args);
const id = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;
const normalize = (r = {}, kind = "geography") => ({ id:r.id || id(), kind, name:String(r.name || r.placeName || "").trim(), country:String(r.country || "").trim(), countryCode:String(r.countryCode || r.country_code || "").trim().toUpperCase(), city:String(r.city || "").trim(), region:String(r.region || r.subdivision || "").trim(), category:String(r.category || r.type || "").trim(), emoji:String(r.emoji || "📍").trim(), note:String(r.note || "").trim(), rating:Number.isFinite(Number(r.rating)) ? Number(r.rating) : null, lat:Number(r.lat), lon:Number(r.lon), createdAt:Number(r.createdAt || Date.now()), updatedAt:Date.now() });
const stars10 = (v) => "★".repeat(Math.round(v)).padEnd(10, "☆");
const hav = (a,b,c,d)=>{const R=6371000,to=(x)=>x*Math.PI/180,d1=to(c-a),d2=to(d-b),q=Math.sin(d1/2)**2+Math.cos(to(a))*Math.cos(to(c))*Math.sin(d2/2)**2;return 2*R*Math.atan2(Math.sqrt(q),Math.sqrt(1-q));};

async function getCurrentPositionSafe(){
  log("[world:geo]", "request");
  if (!(window.isSecureContext && navigator.geolocation)) return null;
  return new Promise((resolve)=>navigator.geolocation.getCurrentPosition((pos)=>resolve({ lat:Number(pos.coords.latitude), lon:Number(pos.coords.longitude) }), ()=>resolve(null), { enableHighAccuracy:true, maximumAge:60000, timeout:12000 }));
}

function ratingFromPointer(el, clientX){ const rect=el.getBoundingClientRect(); return Math.max(0, Math.min(10, ((clientX - rect.left) / Math.max(rect.width,1))*10)); }
function renderRating(){ const el=$id("world-rating-stars"); if(!el) return; const value=state.rating; el.setAttribute("aria-valuenow", String(value.toFixed(1))); el.innerHTML=`<div class="world-rating-track"><div class="world-rating-fill" style="width:${(value/10)*100}%"></div><div class="world-rating-text">${stars10(value)} ${value.toFixed(1)}/10</div></div>`; }
function bindRating(){ const el=$id("world-rating-stars"); if(!el) return; el.addEventListener("pointerdown",(e)=>{ const move=(ev)=>{ state.rating=ratingFromPointer(el, ev.clientX); renderRating(); }; move(e); window.addEventListener("pointermove", move); const up=()=>{ window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); }; window.addEventListener("pointerup", up); }); }

function setWindow(mode){ state.activeWindow=mode; document.querySelectorAll("#view-world .world-tab").forEach((b)=>b.classList.toggle("active", b.dataset.window===mode)); document.querySelectorAll("#view-world [data-window-panel]").forEach((p)=>p.classList.toggle("active", p.dataset.windowPanel===mode)); invalidateLeafletMap(state.map, 60); }
function setAddMode(mode){ state.addMode=mode; $id("world-geo-mode").hidden=mode!=="geo"; $id("world-place-mode").hidden=mode!=="place"; $id("world-add-mode-geo").classList.toggle("active", mode==="geo"); $id("world-add-mode-place").classList.toggle("active", mode==="place"); if(mode==="place") initMiniMap(); }

function renderMap(){ if(!window.L) return; const host=$id("world-map"); if(!host) return; if(!state.map) state.map=createLeafletMap(host, { center:[state.userCenter.lat, state.userCenter.lon], zoom:13 });
  state.markers.forEach((m)=>m.remove()); state.markers.clear(); const L=window.L;
  [...state.geography, ...state.places].forEach((r)=>{ if(!Number.isFinite(r.lat)||!Number.isFinite(r.lon)) return; const marker=L.circleMarker([r.lat,r.lon], { radius:r.kind==="places"?8:6, color:"#fff", weight:1, fillColor:r.kind==="places"?"#ffc86b":"#61d1ff", fillOpacity:0.95 }).addTo(state.map); marker.on("click", ()=>log("[world:marker:click]", r.id)); marker.bindPopup(`<b>${r.name || r.city || "Punto"}</b><br>${r.city || ""} ${r.countryCode ? "🇦🇬".replace("AG", r.countryCode) : ""}<br><button data-world-center="${r.id}">Centrar</button> <button data-world-delete="${r.kind}:${r.id}">Borrar</button>`); state.markers.set(r.id, marker); });
  state.map.setView([state.userCenter.lat, state.userCenter.lon], 12); bindMapLongPress(); }

function bindMapLongPress(){ if(!state.map || state.map.__worldLongPress) return; state.map.__worldLongPress = true; state.map.on("mousedown", (e)=>{ state.longPressTimer = setTimeout(()=>{ log("[world:map:longpress]", e.latlng); const p = window.L.marker(e.latlng).addTo(state.map).bindPopup('<button id="world-add-here">Añadir lugar aquí</button>').openPopup(); p.on("popupopen", ()=>{ document.getElementById("world-add-here")?.addEventListener("click", ()=>{ $id("world-add-toggle").checked=true; state.selectedGeo=normalize({ lat:e.latlng.lat, lon:e.latlng.lng, name:"Punto manual" }, "geography"); }); }); }, 500); }); state.map.on("mouseup", ()=> clearTimeout(state.longPressTimer)); }

function renderGeoList(){ const filter = $id("world-country-filter")?.value || "all"; const list = state.geography.filter((g)=>filter==="all" || g.countryCode===filter); const by = new Map(); list.forEach((g)=>{ const k=g.countryCode||"??"; if(!by.has(k)) by.set(k,[]); by.get(k).push(g); }); $id("world-country-list").innerHTML = [...by.entries()].map(([cc, rows])=>`<details open><summary>${cc} ${getCountryEnglishName(cc)||cc}</summary>${rows.map((r)=>`<button class="world-geo-item" data-geo-center="${r.id}">${r.city || r.name}</button>`).join("")}</details>`).join("") || "<div>Sin lugares geográficos.</div>";
  $id("world-country-filter").innerHTML = `<option value="all">Todos los países</option>${[...new Set(state.geography.map((g)=>g.countryCode).filter(Boolean))].map((cc)=>`<option value="${cc}">${cc} ${getCountryEnglishName(cc)||cc}</option>`).join("")}`;
}
function renderLocals(){ const mode=$id("world-locals-group")?.value || "type"; let groups={}; if(mode==="top"){ groups={"⭐ Top valorados": [...state.places].sort((a,b)=>(b.rating||0)-(a.rating||0)).slice(0,30)}; } else { state.places.forEach((p)=>{ const k = mode==="country" ? (p.countryCode||"??") : mode==="city" ? (p.city||"Sin ciudad") : (p.category||p.name||"Otros"); (groups[k] ||= []).push(p);}); }
  $id("world-locals-list").innerHTML = Object.entries(groups).map(([k,rows])=>{ const avg=rows.reduce((a,b)=>a+(b.rating||0),0)/Math.max(rows.length,1); const emo=rows[0]?.emoji || "🏷️"; return `<details open><summary>${emo} ${k} · ${rows.length} · ${avg.toFixed(1)}/10</summary>${rows.map((r)=>`<div>${r.name} - ${r.city} ${r.countryCode} ${stars10(r.rating||0)}</div>`).join("")}</details>`; }).join("") || "<div>Sin locales.</div>"; }

async function persistWorld(){ if(!state.rootRef) return; await set(state.rootRef, { geography:Object.fromEntries(state.geography.map((r)=>[r.id,r])), places:Object.fromEntries(state.places.map((r)=>[r.id,r])), updatedAt:Date.now() }); }
async function removeItem(kind,idv){ const p=ref(db, `${state.rootRef.toString().replace(/https:\/\/[^/]+\//,'')}/${kind}/${idv}`); await remove(p); }

async function searchGeo(q){ const u=new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q",q); u.searchParams.set("format","json"); u.searchParams.set("addressdetails","1"); u.searchParams.set("limit","10"); const rows=await (await fetch(u)).json(); state.geoResults=rows; $id("world-geo-results").innerHTML=rows.map((r,i)=>`<button data-geo-pick="${i}">${(r.display_name||"").split(",")[0]}</button>`).join(""); }
async function searchPlace(q){ log("[world:place:search]", q); const c=state.userCenter; const radius=Number($id("world-place-radius").value||1000); const dLat=radius/111320,dLng=radius/(111320*Math.cos((c.lat*Math.PI)/180)); const u=new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q",q); u.searchParams.set("format","json"); u.searchParams.set("addressdetails","1"); u.searchParams.set("limit","30"); u.searchParams.set("bounded","1"); u.searchParams.set("viewbox",`${c.lon-dLng},${c.lat+dLat},${c.lon+dLng},${c.lat-dLat}`); const rows=await (await fetch(u)).json(); state.placeResults=rows.map((r)=>({...r,distance:hav(c.lat,c.lon,Number(r.lat),Number(r.lon))})).filter((r)=>r.distance<=radius).sort((a,b)=>a.distance-b.distance); $id("world-place-results").innerHTML=state.placeResults.map((r,i)=>`<button data-place-pick="${i}">${(r.display_name||"").split(",")[0]} · ${Math.round(r.distance)}m</button>`).join(""); }

function renderStats(){ $id("world-countries").textContent=String(new Set(state.geography.map((x)=>x.countryCode).filter(Boolean)).size); $id("world-geo-count").textContent=String(state.geography.length); $id("world-rated-locals").textContent=String(state.places.length); }
function renderAll(){ renderStats(); renderMap(); renderGeoList(); renderLocals(); }

function bindUI(){ const root=$id("view-world"); root.addEventListener("click", async (e)=>{ const t=e.target.closest("button,label"); if(!t) return; if(t.matches(".world-tab")) return setWindow(t.dataset.window); if(t.id==="world-open-add") $id("world-add-toggle").checked=true; if(t.id==="world-add-mode-geo") setAddMode("geo"); if(t.id==="world-add-mode-place") setAddMode("place"); if(t.dataset.geoPick){ const row=state.geoResults[Number(t.dataset.geoPick)]; const a=row?.address||{}; state.selectedGeo=normalize({name:(row.display_name||"").split(",")[0], city:a.city||a.town||a.village||"", region:a.state||"", country:a.country||"", countryCode:a.country_code||"", lat:Number(row.lat), lon:Number(row.lon), note:$id("world-geo-note").value}, "geography"); }
    if(t.dataset.placePick){ const row=state.placeResults[Number(t.dataset.placePick)]; const a=row?.address||{}; state.selectedPlace=normalize({name:(row.display_name||"").split(",")[0], city:a.city||a.town||a.village||"", country:a.country||"", countryCode:a.country_code||"", category:$id("world-place-q").value, lat:Number(row.lat), lon:Number(row.lon), rating:state.rating, emoji:"🏪", note:$id("world-place-note").value}, "places"); log("[world:place]", state.selectedPlace); initMiniMap(); }
    if(t.dataset.geoCenter){ const m=state.markers.get(t.dataset.geoCenter); if(m){ state.map.panTo(m.getLatLng()); m.openPopup(); log("[world:map:center]", t.dataset.geoCenter);} }
    if(t.dataset.worldCenter){ const m=state.markers.get(t.dataset.worldCenter); if(m){ state.map.panTo(m.getLatLng()); m.openPopup(); } }
    if(t.dataset.worldDelete){ const [kind,idv]=t.dataset.worldDelete.split(":"); await removeItem(kind,idv); }
  });
  $id("world-country-filter").addEventListener("change", renderGeoList); $id("world-locals-group").addEventListener("change", renderLocals);
  $id("world-geo-q").addEventListener("input", (e)=> e.target.value.trim().length>1 && searchGeo(e.target.value.trim()));
  $id("world-place-q").addEventListener("input", (e)=> e.target.value.trim().length>1 && searchPlace(e.target.value.trim()));
  $id("world-place-radius").addEventListener("change", ()=> $id("world-place-q").dispatchEvent(new Event("input")));
  $id("world-geo-save").addEventListener("click", async ()=>{ if(!state.selectedGeo) return; state.geography.push(state.selectedGeo); log("[world:geo:save]", state.selectedGeo); await persistWorld(); });
  $id("world-place-save").addEventListener("click", async ()=>{ if(!state.selectedPlace) return; state.selectedPlace.rating=state.rating; state.places.push(state.selectedPlace); log("[world:place:save]", state.selectedPlace); await persistWorld(); });
  $id("world-add-toggle").addEventListener("change", ()=>{ if($id("world-add-toggle").checked) initMiniMap(); });
  bindRating();
}

function initMiniMap(){ if(!window.L) return; const host=$id("world-mini-map"); if(!host) return; if(!state.miniMap) state.miniMap=createLeafletMap(host, { center:[state.userCenter.lat,state.userCenter.lon], zoom:15 }); state.miniMap.setView([state.userCenter.lat,state.userCenter.lon],15); }

export async function init(){ if(state.initialized) return; state.initialized=true; log("[world:init]"); await ensureLeaflet(); bindUI(); renderRating(); const p=await getCurrentPositionSafe(); if(p){ state.userCenter=p; log("[world:geo]", p); }
  const uid=getCurrentUserDataRootKey() || auth.currentUser?.uid; if(!uid) return; state.rootRef=ref(db, WORLD_PATH(uid)); state.unsub=trackedOnValue(state.rootRef, (snap)=>{ const data=snap.val()||{}; state.geography=Object.values(data.geography||{}).map((x)=>normalize(x,"geography")); state.places=Object.values(data.places||{}).map((x)=>normalize(x,"places")); renderAll(); }, { key:"world-root", path:WORLD_PATH(uid), module:"world", mode:"onValue", reason:"world-sync", viewId:"view-world" }, onValue); }
export function destroy(){ if(state.unsub) state.unsub(); state.unsub=null; if(state.map){ destroyLeafletMap($id("world-map")); state.map=null; } if(state.miniMap){ destroyLeafletMap($id("world-mini-map")); state.miniMap=null; } state.initialized=false; }
export async function onShow(){ if(!state.initialized) await init(); setWindow(state.activeWindow); invalidateLeafletMap(state.map,70); }
export async function onHide(){ destroy(); }
export function getListenerCount(){ return state.unsub?1:0; }
