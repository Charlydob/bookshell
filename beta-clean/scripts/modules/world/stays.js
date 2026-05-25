import { auth, db, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, update, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";

let ctx = { root:null };
let stays = [];
let unsub = null;
let autoStayInFlight = false;
let lastAutoStayError = null;
const collapsedCountries = new Set();
let globalStayModalHandlerBound = false;
let activeEditStayId = null;
let searchAbortController = null;
let searchDebounceTimer = null;
let searchResults = [];
let memoStats = { key:"", value:null };

const DAY_MS = 86400000;
const toId = () => `stay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const $ = (sel) => ctx.root?.querySelector(sel);
const esc = (v = "") => String(v || "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[m]);
const flagFromCountryCode = (cc = "") => {
  const s = String(cc || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? String.fromCodePoint(...[...s].map((c) => 127397 + c.charCodeAt(0))) : "🌍";
};
const fmtDate = (date = "") => {
  if (!date) return "";
  const [y, m, d] = String(date).split("-");
  return y && m && d ? `${d}/${m}/${y}` : "";
};
const todayIso = () => new Date().toISOString().slice(0, 10);
const addDaysIso = (iso, delta) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
};

function calcInclusiveDays(startDate, endDate, manualDays) {
  if (startDate && endDate) {
    const s = new Date(`${startDate}T00:00:00Z`);
    const e = new Date(`${endDate}T00:00:00Z`);
    const diff = Math.floor((e - s) / DAY_MS) + 1;
    return Number.isFinite(diff) && diff > 0 ? diff : null;
  }
  const manual = Number(manualDays);
  return Number.isFinite(manual) && manual > 0 ? Math.floor(manual) : null;
}

function normalizeStay(raw = {}) {
  const startDate = String(raw.startDate || raw.date || "").trim();
  const endDate = String(raw.endDate || raw.date || startDate || "").trim();
  const daysTotal = calcInclusiveDays(startDate, endDate, raw.daysTotal);
  return {
    id: String(raw.id || toId()),
    country: String(raw.country || "Sin país").trim(),
    city: String(raw.city || "").trim(),
    region: String(raw.region || "").trim(),
    countryCode: String(raw.countryCode || "").trim().toUpperCase(),
    flagEmoji: String(raw.flagEmoji || flagFromCountryCode(raw.countryCode || "")).trim(),
    startDate,
    endDate,
    source: raw.source === "auto-location" ? "auto-location" : "manual",
    autoTracking: Boolean(raw.autoTracking || raw.source === "auto-location"),
    createdAt: Number(raw.createdAt || Date.now()),
    updatedAt: Number(raw.updatedAt || Date.now()),
    daysTotal
  };
}

function computeStaySummaries() {
  const key = JSON.stringify(stays.map((s) => [s.id, s.updatedAt, s.daysTotal, s.startDate, s.endDate, s.country, s.city]));
  if (memoStats.key === key && memoStats.value) return memoStats.value;
  const totalDays = stays.reduce((sum, s) => sum + Number(s.daysTotal || 0), 0);
  const countriesMap = new Map();
  const citiesSet = new Set();
  for (const s of stays) {
    const countryKey = `${s.country || "Sin país"}__${s.countryCode || ""}`;
    const country = countriesMap.get(countryKey) || { key:countryKey, country:s.country || "Sin país", countryCode:s.countryCode || "", days:0, cities:new Map() };
    const stayDays = Number(s.daysTotal || 0);
    country.days += stayDays;
    const cityKey = `${String(s.city || "Sin ciudad").trim().toLowerCase()}__${countryKey}`;
    const city = country.cities.get(cityKey) || { key:cityKey, city:String(s.city || "Sin ciudad").trim(), days:0, stays:[] };
    city.days += stayDays;
    city.stays.push(s);
    country.cities.set(cityKey, city);
    citiesSet.add(cityKey);
    countriesMap.set(countryKey, country);
  }
  const byCountry = Array.from(countriesMap.values()).map((country) => ({
    ...country,
    cities: Array.from(country.cities.values()).map((city) => ({
      ...city,
      stays: [...city.stays].sort((a, b) => String(a.startDate || "").localeCompare(String(b.startDate || "")) || a.createdAt - b.createdAt)
    })).sort((a, b) => b.days - a.days || a.city.localeCompare(b.city, "es"))
  })).sort((a, b) => b.days - a.days || a.country.localeCompare(b.country, "es"));
  memoStats = { key, value:{ totalDays, countriesCount:byCountry.length, citiesCount:citiesSet.size, dominant:byCountry[0] || null, byCountry } };
  return memoStats.value;
}

function getBirthDate() { return String(localStorage.getItem("worldBirthDate") || "").trim(); }
function persistBirthDate(date) { localStorage.setItem("worldBirthDate", date); }
function daysAlive(birthDate) { if (!birthDate) return null; const born = new Date(`${birthDate}T00:00:00Z`); const value = Math.floor((new Date() - born) / DAY_MS) + 1; return Number.isFinite(value) && value > 0 ? value : null; }
function pct(numerator, denominator) { if (!denominator) return 0; const value = (numerator / denominator) * 100; return Number.isFinite(value) ? value : 0; }

function renderDistribution(byCountry = [], totalDays = 0) {
  const segs = byCountry.map((country, idx) => {
    const colorClass = `world-dist-color-${(idx % 8) + 1}`;
    const ratio = totalDays ? pct(country.days, totalDays) : 0;
    return `<span class="world-dist-seg ${colorClass}" style="width:${Math.max(2, ratio).toFixed(2)}%" title="${esc(country.country)} · ${country.days} días"><span aria-hidden="true">${flagFromCountryCode(country.countryCode)}</span></span>`;
  }).join("");
  const legend = byCountry.map((country, idx) => {
    const colorClass = `world-dist-color-${(idx % 8) + 1}`;
    return `<li class="world-dist-legend-item"><span class="world-dot ${colorClass}"></span><span class="world-dist-label">${flagFromCountryCode(country.countryCode)} ${esc(country.country)}</span><span class="world-dist-pct">${pct(country.days, totalDays).toFixed(2)}%</span></li>`;
  }).join("");
  return `<div class="world-dist-wrap"><div class="world-dist-bar" role="img" aria-label="Distribución de estancias por país">${segs || '<span class="world-dist-seg world-dist-color-1" style="width:100%">—</span>'}</div><ul class="world-dist-legend">${legend}</ul></div>`;
}

async function mergeStayRecord(payload) {
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (!uid || !payload?.id) return;
  await update(ref(db, `v2/users/${uid}/world/stays`), { [payload.id]: payload });
}

function render() {
  const mount = $("[data-world-stays-summary]");
  if (!mount) return;
  const stats = computeStaySummaries();
  const born = getBirthDate();
  const alive = daysAlive(born);
  const dominant = stats.dominant;
  const birthLine = born || "No definida";
  const countries = stats.byCountry.map((country) => {
    const isCollapsed = !collapsedCountries.has(country.key);
    const lifePct = alive ? pct(country.days, alive) : 0;
    const cities = country.cities.map((city) => {
      const rows = city.stays.map((stay) => {
        const stayDays = Number(stay.daysTotal || 0);
        const lifeSegment = alive ? ` · ${pct(stayDays, alive).toFixed(2)}% vida` : "";
        console.debug("[world:stay-life-percent]", { stayId:stay.id, days:stayDays, alive, lifePct:alive ? pct(stayDays, alive) : null });
        return `<li class="world-stays-entry"><div class="world-stays-entry-top"><span class="world-stays-entry-main">${esc(stay.city || "Sin ciudad")} · ${stayDays} día${stayDays === 1 ? "" : "s"}${lifeSegment}</span><div class="world-stays-entry-actions"><button type="button" data-world-stay-edit="${esc(stay.id)}" aria-label="Editar">✏️</button><button type="button" data-world-stay-delete="${esc(stay.id)}" aria-label="Eliminar">🗑️</button></div></div><small class="world-stays-entry-dates">${stay.startDate && stay.endDate ? `${fmtDate(stay.startDate)} → ${fmtDate(stay.endDate)}` : "Sin fechas exactas"}</small></li>`;
      }).join("");
      return `<li class="world-stays-city-item"><ul class="world-stays-entry-list">${rows}</ul></li>`;
    }).join("");
    return `<details class="world-stays-country" ${isCollapsed ? "" : "open"} data-country-key="${esc(country.key)}"><summary><span class="world-stays-country-main">${flagFromCountryCode(country.countryCode)} ${esc(country.country)} · ${country.days} día${country.days === 1 ? "" : "s"} · ${lifePct.toFixed(2)}% vida ▾</span></summary><ul class="world-stays-city-list">${cities || "<li class=\"world-stays-city-item\">Sin ciudad registrada.</li>"}</ul></details>`;
  }).join("");
  mount.innerHTML = `<div class="world-stays-head"><h3>Estancias</h3><button type="button" class="world-add-btn" data-world-stay-action="open-modal">+ Añadir estancia</button></div><div class="world-stays-warning" data-world-stays-warning aria-live="polite"></div><div class="world-birth-compact"><span>🎂 Nacimiento: ${esc(birthLine)}</span><button type="button" data-world-set-birthdate>Editar</button></div><div class="world-kpis world-kpis-compact"><div class="world-pill"><span>📅 ${stats.totalDays} día${stats.totalDays === 1 ? "" : "s"}</span></div><div class="world-pill"><span>🌍 ${stats.countriesCount} país${stats.countriesCount === 1 ? "" : "es"}</span></div><div class="world-pill"><span>🏙️ ${stats.citiesCount} ciudad${stats.citiesCount === 1 ? "" : "es"}</span></div><div class="world-pill"><span>👑 ${dominant ? `${flagFromCountryCode(dominant.countryCode)} ${esc(dominant.country)}` : "-"}</span></div></div>${renderDistribution(stats.byCountry, stats.totalDays)}<div class="world-stays-countries">${countries || "<div class=\"world-stays-empty\">Sin estancias todavía.</div>"}</div>`;
  const btn = mount.querySelector("[data-world-stay-action='open-modal']");
  if (btn) btn.onclick = () => openWorldStayModal();
}

function fillStayForm(payload = {}) {
  const setField = (selector, value = "") => { const input = document.querySelector(selector); if (input) input.value = value; };
  setField("[data-world-stay-search]", "");
  setField("[data-world-stay-city]", payload.city || "");
  setField("[data-world-stay-region]", payload.region || "");
  setField("[data-world-stay-country]", payload.country || "");
  setField("[data-world-stay-country-code]", payload.countryCode || "");
  setField("[data-world-stay-flag]", payload.flagEmoji || flagFromCountryCode(payload.countryCode || ""));
  setField("[data-world-stay-start]", payload.startDate || "");
  setField("[data-world-stay-end]", payload.endDate || "");
  setField("[data-world-stay-total-days]", payload.daysTotal || "");
}

function renderSearchResults(items = []) { searchResults = items; const box = document.querySelector("[data-world-stay-search-results]"); if (!box) return; box.hidden = !items.length; box.innerHTML = items.map((r, idx) => `<button type="button" class="world-stay-search-item" data-world-stay-suggest="${idx}">${esc(r.display_name)}</button>`).join(""); }
async function searchPlace(query) { if (searchAbortController) searchAbortController.abort(); searchAbortController = new AbortController(); const u = new URL("https://nominatim.openstreetmap.org/search"); u.searchParams.set("q", query); u.searchParams.set("format", "jsonv2"); u.searchParams.set("addressdetails", "1"); u.searchParams.set("limit", "8"); console.debug("[world:stays:search:start]", { query }); const raw = await (await fetch(u, { signal:searchAbortController.signal })).json(); console.debug("[world:stays:search:results]", { query, total:raw.length }); return raw; }

function openModal(stay = null) {
  activeEditStayId = stay?.id || null;
  if (document.querySelector("[data-world-stay-modal]")) return;
  const modal = document.createElement("div");
  modal.setAttribute("data-world-stay-modal", "");
  modal.className = "world-stay-modal is-open";
  modal.innerHTML = `<div class="world-stay-modal__backdrop" data-world-stay-close></div><section class="world-sheet world-stay-modal__sheet"><div class="world-sheet-header"><h3>${stay ? "Editar estancia" : "Añadir estancia"}</h3><button type="button" class="world-stay-close-x" data-world-stay-close aria-label="Cerrar">✕</button></div><div class="world-stay-block"><input data-world-stay-search placeholder="Buscar ciudad, país o dirección"><button type="button" class="world-optional-location-btn" data-world-use-current>Usar ubicación actual</button><div class="world-stay-search-results" data-world-stay-search-results hidden></div></div><div class="world-inline-2"><input data-world-stay-city placeholder="Ciudad"><input data-world-stay-region placeholder="Región"></div><div class="world-inline-2"><input data-world-stay-country placeholder="País"><input data-world-stay-flag placeholder="Bandera"></div><input data-world-stay-country-code hidden><div class="world-inline-2"><input type="date" data-world-stay-start><input type="date" data-world-stay-end></div><div class="world-inline-2"><input inputmode="numeric" data-world-stay-total-days placeholder="Días totales"></div><button type="button" class="world-save" data-world-stay-save>Guardar</button></section>`;
  document.body.appendChild(modal);
  fillStayForm(stay || {});
}
const closeModal = () => document.querySelector("[data-world-stay-modal]")?.remove();
const openWorldStayModal = (stay = null) => openModal(stay);
function renderAutoStayWarning(message = "") {
  const node = $("[data-world-stays-warning]");
  if (!node) return;
  if (!message) {
    node.textContent = "";
    return;
  }
  node.innerHTML = `<span>${esc(message)}</span> <button type="button" data-world-auto-stay-retry>Reintentar ubicación</button> <button type="button" data-world-force-auto-stay>Registrar ubicación actual</button>`;
}

const showCompactWarning = (message = "") => renderAutoStayWarning(message);
const normalizeText = (value = "") => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
function buildLocationComparisonKey(place = {}) {
  const countryCode = normalizeText(place.countryCode || "");
  const cityLike = normalizeText(place.city || place.region || "");
  return `${countryCode}__${cityLike}`;
}
async function reverseGeocode(lat, lon) {
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("lat", String(lat));
  u.searchParams.set("lon", String(lon));
  u.searchParams.set("format", "jsonv2");
  u.searchParams.set("addressdetails", "1");
  const raw = await (await fetch(u)).json();
  const a = raw?.address || {};
  const city = String(a.city || a.town || a.village || a.municipality || a.county || a.region || "Ubicación actual").trim();
  return { city, region:String(a.state || a.region || a.county || "").trim(), country:String(a.country || "").trim(), countryCode:String(a.country_code || "").trim().toUpperCase() };
}

async function ensureAutoStayToday({ force = false } = {}) {
  if (autoStayInFlight) return;
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (!uid) return;
  const checkPath = `v2/users/${uid}/world/staysMeta/lastAutoLocationCheckDate`;
  const lastCheck = localStorage.getItem(checkPath);
  const today = todayIso();
  if (!force && lastCheck === today) return;
  autoStayInFlight = true;
  console.debug("[world:stays:auto:start]", { force, today, lastCheck });
  try {
    if (!window.isSecureContext || !navigator.geolocation) throw new Error("Geolocalización no disponible");
    const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((pos) => resolve({ lat:Number(pos.coords.latitude), lon:Number(pos.coords.longitude) }), (err) => reject(new Error(err?.message || "permiso denegado")), { enableHighAccuracy:true, maximumAge:60000, timeout:12000 }));
    console.debug("[world:stays:auto:coords]", coords);
    const place = await reverseGeocode(coords.lat, coords.lon);
    console.debug("[world:stays:auto:reverse]", place);
    if (!place.country) throw new Error("No se pudo detectar el país de la ubicación actual");
    const now = Date.now();
    const todayStay = todayIso();
    const autos = stays.filter((s) => s.source === "auto-location").sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0) || String(b.endDate || "").localeCompare(String(a.endDate || "")));
    const last = autos[0] || null;
    console.debug("[world:stays:auto:last]", { stayId:last?.id || null, city:last?.city || "", countryCode:last?.countryCode || "", endDate:last?.endDate || "" });
    if (!last) {
      const payload = normalizeStay({ id:toId(), source:"auto-location", autoTracking:true, city:place.city, region:place.region, country:place.country, countryCode:place.countryCode, flagEmoji:flagFromCountryCode(place.countryCode), startDate:todayStay, endDate:todayStay, createdAt:now, updatedAt:now });
      await mergeStayRecord(payload);
      console.debug("[world:stays:auto:new-location]", { stayId:payload.id, city:payload.city, country:payload.country });
    } else {
      const same = buildLocationComparisonKey(last) === buildLocationComparisonKey(place);
      if (same) {
        if (last.endDate !== todayStay) {
          await mergeStayRecord({ ...last, endDate:todayStay, daysTotal:calcInclusiveDays(last.startDate, todayStay, last.daysTotal), updatedAt:now });
          console.debug("[world:stays:auto:same-location:update]", { stayId:last.id, endDate:todayStay });
        }
      } else {
        const prevEndDate = addDaysIso(todayStay, -1);
        const closedPrev = { ...last, endDate:prevEndDate, daysTotal:calcInclusiveDays(last.startDate, prevEndDate, last.daysTotal), updatedAt:now };
        await mergeStayRecord(closedPrev);
        console.debug("[world:stays:auto:new-location]", { closedStayId:closedPrev.id, endDate:prevEndDate });
        const nextPayload = normalizeStay({ id:toId(), source:"auto-location", autoTracking:true, city:place.city, region:place.region, country:place.country, countryCode:place.countryCode, flagEmoji:flagFromCountryCode(place.countryCode), startDate:todayStay, endDate:todayStay, createdAt:now, updatedAt:now });
        await mergeStayRecord(nextPayload);
        console.debug("[world:stays:auto:new-location]", { stayId:nextPayload.id, city:nextPayload.city, country:nextPayload.country });
      }
    }
    localStorage.setItem(checkPath, today);
    console.debug("[world:stays:auto:save:ok]", { day:today });
    lastAutoStayError = null;
    renderAutoStayWarning("");
  } catch (error) {
    lastAutoStayError = String(error?.message || "error");
    console.warn("[world:stays:auto:error]", lastAutoStayError);
    renderAutoStayWarning(`No se pudo registrar ubicación automática: ${lastAutoStayError}`);
  } finally {
    autoStayInFlight = false;
  }
}

async function registerAutoStayFromCurrentLocation() {
  if (autoStayInFlight) return;
  renderAutoStayWarning("Registrando ubicación…");
  await ensureAutoStayToday({ force:true });
  if (lastAutoStayError) {
    renderAutoStayWarning(`No se pudo registrar ubicación actual: ${lastAutoStayError}`);
    return;
  }
  renderAutoStayWarning("✅ Ubicación actual registrada.");
}

export function renderWorldStays() { render(); }
function initWorldStaysAsync() { Promise.resolve().then(() => ensureAutoStayToday()).catch((error) => console.error("[world:stays:init:error]", error)); }

function handleWorldRootClick(e) {
  const btn = e.target.closest("button");
  if (!btn) return;
  if (btn.dataset.worldStayEdit) { const stay = stays.find((s) => s.id === btn.dataset.worldStayEdit); if (stay) openWorldStayModal(stay); return; }
  if (btn.dataset.worldStayDelete) { const uid2 = getCurrentUserDataRootKey() || auth.currentUser?.uid; if (!uid2 || !window.confirm("¿Eliminar esta estancia?")) return; remove(ref(db, `v2/users/${uid2}/world/stays/${btn.dataset.worldStayDelete}`)); return; }
  if (btn.dataset.worldSetBirthdate !== undefined) { const val = window.prompt("Fecha de nacimiento (YYYY-MM-DD)", getBirthDate()); if (val) { persistBirthDate(val.trim()); render(); } return; }
  if (btn.dataset.worldAutoStayRetry !== undefined) { console.debug("[world:stays:auto:retry]", { lastAutoStayError }); renderAutoStayWarning("Buscando ubicación…"); ensureAutoStayToday({ force:true }); }
  if (btn.dataset.worldForceAutoStay !== undefined) { registerAutoStayFromCurrentLocation(); return; }
}

export function initWorldStays({ root }) {
  ctx = { root };
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (uid && !unsub) {
    const path = `v2/users/${uid}/world/stays`;
    unsub = trackedOnValue(ref(db, path), (snap) => { stays = Object.values(snap.val() || {}).map((x) => normalizeStay(x)); memoStats = { key:"", value:null }; render(); }, { key:"world-stays", path, module:"world", mode:"onValue", reason:"world-stays", viewId:"view-world" }, onValue);
  }
  window.setTimeout(() => initWorldStaysAsync(), 0);

  if (!globalStayModalHandlerBound) {
    globalStayModalHandlerBound = true;
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("button,[data-world-stay-close]");
      if (!btn) return;
      if (btn.dataset.worldStayClose !== undefined) return closeModal();
      if (btn.dataset.worldStaySuggest !== undefined) {
        const selected = searchResults[Number(btn.dataset.worldStaySuggest)];
        if (!selected) return;
        const a = selected.address || {};
        fillStayForm({ city: a.city || a.town || a.village || a.municipality || "", region: a.state || a.region || a.county || "", country: a.country || "", countryCode: String(a.country_code || "").toUpperCase(), flagEmoji: flagFromCountryCode(String(a.country_code || "").toUpperCase()) });
        console.debug("[world:stays:search:select]", { display:selected.display_name });
        renderSearchResults([]);
      }
      if (btn.dataset.worldStaySave !== undefined) {
        const city = String(document.querySelector("[data-world-stay-city]")?.value || "").trim();
        const country = String(document.querySelector("[data-world-stay-country]")?.value || "").trim();
        const countryCode = String(document.querySelector("[data-world-stay-country-code]")?.value || "").trim().toUpperCase();
        const startDate = String(document.querySelector("[data-world-stay-start]")?.value || "").trim();
        const endDate = String(document.querySelector("[data-world-stay-end]")?.value || "").trim();
        const manualDays = String(document.querySelector("[data-world-stay-total-days]")?.value || "").trim();
        const prev = activeEditStayId ? stays.find((s) => s.id === activeEditStayId) : null;
        const now = Date.now();
        const payload = normalizeStay({ id:activeEditStayId || toId(), city, region:String(document.querySelector("[data-world-stay-region]")?.value || "").trim(), country, countryCode, flagEmoji:String(document.querySelector("[data-world-stay-flag]")?.value || "").trim() || flagFromCountryCode(countryCode), startDate, endDate, daysTotal:manualDays, source:prev?.source || "manual", autoTracking:Boolean(prev?.autoTracking), createdAt:prev?.createdAt || now, updatedAt:now });
        if (!payload.country || !payload.daysTotal) return;
        await mergeStayRecord(payload);
        closeModal();
      }
      if (btn.dataset.worldUseCurrent !== undefined) {
        try {
          showCompactWarning("Buscando ubicación…");
          const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((pos) => resolve({ lat:Number(pos.coords.latitude), lon:Number(pos.coords.longitude) }), (err) => reject(new Error(err?.message || "permiso denegado")), { enableHighAccuracy:true, maximumAge:60000, timeout:12000 }));
          const place = await reverseGeocode(coords.lat, coords.lon);
          if (!place.country) throw new Error("No se pudo detectar el país de la ubicación actual");
          fillStayForm({ city:place.city, region:place.region, country:place.country, countryCode:place.countryCode, flagEmoji:flagFromCountryCode(place.countryCode) });
          showCompactWarning("");
        } catch (error) {
          const msg = `No se pudo usar la ubicación actual: ${String(error?.message || "error")}`;
          showCompactWarning(msg);
          console.warn("[world:stays:auto:error]", msg);
        }
      }
    });
    document.addEventListener("input", (e) => {
      const sourceInput = e.target.closest?.("[data-world-stay-search]");
      if (!sourceInput) return;
      const query = String(sourceInput.value || "").trim();
      if (searchDebounceTimer) window.clearTimeout(searchDebounceTimer);
      if (query.length < 3) return renderSearchResults([]);
      searchDebounceTimer = window.setTimeout(async () => { try { renderSearchResults(await searchPlace(query)); } catch { renderSearchResults([]); } }, 280);
    });
  }

  if (!root.dataset.worldStaysHandlersBound) {
    root.dataset.worldStaysHandlersBound = "1";
    root.addEventListener("click", handleWorldRootClick);
    root.addEventListener("toggle", (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.matches(".world-stays-country")) return;
    const key = details.dataset.countryKey || "";
    if (!key) return;
    if (details.open) collapsedCountries.delete(key); else collapsedCountries.add(key);
    });
  }

  render();
}
