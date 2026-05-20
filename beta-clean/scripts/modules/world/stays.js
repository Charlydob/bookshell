import { auth, db, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, set, update } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";

let ctx = { root:null };
let stays = [];
let unsub = null;
let autoStayTried = false;
const collapsedCountries = new Set();
let globalStayModalHandlerBound = false;

const DAY_MS = 86400000;
const toId = () => `stay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const $ = (sel) => ctx.root?.querySelector(sel);
const esc = (v = "") => String(v || "").replace(/[&<>"']/g, (m) => ({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"})[m]);
const flagFromCountryCode = (cc = "") => {
  const s = String(cc || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? String.fromCodePoint(...[...s].map((c) => 127397 + c.charCodeAt(0))) : "🌍";
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

function getBirthDate() { return String(localStorage.getItem("worldBirthDate") || "").trim(); }
function persistBirthDate(date) { localStorage.setItem("worldBirthDate", date); }
function daysAlive(birthDate) {
  if (!birthDate) return null;
  const born = new Date(`${birthDate}T00:00:00Z`);
  const now = new Date();
  const value = Math.floor((now - born) / DAY_MS) + 1;
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function persistStays() {
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (!uid) return;
  const path = `v2/users/${uid}/world/stays`;
  await set(ref(db, path), Object.fromEntries(stays.map((s) => [s.id, s])));
}

function computeStats() {
  const totalDays = stays.reduce((sum, s) => sum + Number(s.daysTotal || 0), 0);
  const countriesMap = new Map();
  const citiesSet = new Set();
  for (const s of stays) {
    const key = `${s.country || "Sin país"}__${s.countryCode || ""}`;
    const row = countriesMap.get(key) || { key, country:s.country || "Sin país", countryCode:s.countryCode || "", days:0, cities:new Map() };
    const stayDays = Number(s.daysTotal || 0);
    row.days += stayDays;
    if (s.city) {
      const cityKey = `${s.city}`.trim().toLowerCase();
      const city = row.cities.get(cityKey) || { city:s.city, days:0 };
      city.days += stayDays;
      row.cities.set(cityKey, city);
      citiesSet.add(`${cityKey}__${key}`);
    }
    countriesMap.set(key, row);
  }

  const byCountry = Array.from(countriesMap.values()).map((country) => ({
    ...country,
    cities:Array.from(country.cities.values()).sort((a, b) => b.days - a.days || a.city.localeCompare(b.city, "es"))
  })).sort((a, b) => b.days - a.days || a.country.localeCompare(b.country, "es"));

  return {
    totalDays,
    countriesCount:byCountry.length,
    citiesCount:citiesSet.size,
    dominant:byCountry[0] || null,
    byCountry
  };
}

function pct(numerator, denominator) {
  if (!denominator) return 0;
  const value = (numerator / denominator) * 100;
  return Number.isFinite(value) ? value : 0;
}

function renderDistribution(byCountry, totalDays) {
  if (!byCountry.length || !totalDays) return "<div class=\"world-stays-empty\">Sin estancias todavía.</div>";
  const segs = byCountry.slice(0, 8).map((country, idx) => {
    const percent = pct(country.days, totalDays);
    return `<div class="world-dist-seg world-dist-color-${(idx % 8) + 1}" style="width:${Math.max(1, percent).toFixed(2)}%"><span>${flagFromCountryCode(country.countryCode)}</span></div>`;
  }).join("");

  const legend = byCountry.slice(0, 8).map((country, idx) => {
    const percent = pct(country.days, totalDays);
    return `<li class="world-dist-legend-item"><span class="world-dot world-dist-color-${(idx % 8) + 1}"></span><span class="world-dist-label">${flagFromCountryCode(country.countryCode)} ${esc(country.country)}</span><span class="world-dist-pct">${percent.toFixed(1)}%</span></li>`;
  }).join("");

  return `<div class="world-dist-wrap"><div class="world-dist-bar" role="img" aria-label="Distribución de estancias por país">${segs}</div><ul class="world-dist-legend">${legend}</ul></div>`;
}

function render() {
  const mount = $("[data-world-stays-summary]");
  if (!mount) return;
  const stats = computeStats();
  const born = getBirthDate();
  const alive = daysAlive(born);
  const birthLine = born || "No definida";

  const countries = stats.byCountry.map((country) => {
    const isCollapsed = !collapsedCountries.has(country.key);
    const countryPct = pct(country.days, stats.totalDays);
    const lifePct = alive ? pct(country.days, alive) : null;
    const cities = country.cities.map((city) => {
      const cityOfCountry = pct(city.days, country.days);
      const cityLife = alive ? pct(city.days, alive) : null;
      return `<li class="world-stays-city-item"><span class="world-stays-city-main">${esc(city.city)} · ${city.days} día${city.days === 1 ? "" : "s"}</span><span class="world-stays-city-meta">${cityOfCountry.toFixed(1)}% de ${esc(country.country)}${cityLife !== null ? ` · ${cityLife.toFixed(2)}% vida` : ""}</span></li>`;
    }).join("");
    return `<details class="world-stays-country" ${isCollapsed ? "" : "open"} data-country-key="${esc(country.key)}"><summary><span class="world-stays-country-main">${flagFromCountryCode(country.countryCode)} ${esc(country.country)} · ${country.days} día${country.days === 1 ? "" : "s"}</span><span class="world-stays-country-meta">${countryPct.toFixed(1)}% registros${lifePct !== null ? ` · ${lifePct.toFixed(2)}% vida` : ""}</span></summary><ul class="world-stays-city-list">${cities || "<li class=\"world-stays-city-item\">Sin ciudad registrada.</li>"}</ul></details>`;
  }).join("");

  mount.innerHTML = `
    <div class="world-stays-head">
      <h3>Estancias</h3>
      <button type="button" class="world-add-btn" data-world-stay-action="open-modal">+ Añadir estancia</button>
    </div>
    <div class="world-stays-warning" data-world-stays-warning aria-live="polite"></div>

    <div class="world-birth-compact"><span>🎂 Nacimiento: ${esc(birthLine)}</span><button type="button" data-world-set-birthdate>Editar</button></div>

    <div class="world-kpis world-kpis-compact">
      <div class="world-pill"><span>📅 ${stats.totalDays} día${stats.totalDays === 1 ? "" : "s"}</span></div>
      <div class="world-pill"><span>🌍 ${stats.countriesCount} país${stats.countriesCount === 1 ? "" : "es"}</span></div>
      <div class="world-pill"><span>🏙️ ${stats.citiesCount} ciudad${stats.citiesCount === 1 ? "" : "es"}</span></div>
      <div class="world-pill"><span>👑 ${stats.dominant ? `${flagFromCountryCode(stats.dominant.countryCode)} ${esc(stats.dominant.country)}` : "-"}</span></div>
    </div>

    ${renderDistribution(stats.byCountry, stats.totalDays)}

    <div class="world-stays-countries">${countries || "<div class=\"world-stays-empty\">Sin estancias todavía.</div>"}</div>`;
  bindStaysUI(ctx.root);
}

function bindStaysUI(root) {
  const btn = root?.querySelector("[data-world-stay-action='open-modal']");
  if (!btn) {
    console.warn("[world:stays:add-button:missing]");
    return;
  }

  btn.onclick = (event) => {
    event.preventDefault();
    event.stopPropagation();
    console.debug("[world:stays:add-click]");
    openWorldStayModal();
  };

  console.debug("[world:stays:add-button:bound]");
}

function openModal() {
  console.debug("[world:stays:modal-open]");
  if (document.querySelector("[data-world-stay-modal]")) return;
  const modal = document.createElement("div");
  modal.setAttribute("data-world-stay-modal", "");
  modal.className = "world-stay-modal is-open";
  modal.innerHTML = `<div class="world-stay-modal__backdrop" data-world-stay-close></div>
    <section class="world-sheet world-stay-modal__sheet">
      <div class="world-sheet-header"><h3>Añadir estancia</h3><button type="button" data-world-stay-close aria-label="Cerrar">Cerrar</button></div>
      <div class="world-edit-grid">
        <input data-world-stay-source placeholder="Buscador lugar">
        <input data-world-stay-city placeholder="Ciudad">
        <input data-world-stay-region placeholder="Región/provincia">
        <input data-world-stay-country placeholder="País">
        <input data-world-stay-country-code placeholder="Código país (ej: PE)">
        <input data-world-stay-flag placeholder="Bandera">
        <input type="date" data-world-stay-start>
        <input type="date" data-world-stay-end>
        <input inputmode="numeric" data-world-stay-total-days placeholder="Días totales">
      </div>
      <button type="button" class="world-save" data-world-stay-save>Guardar</button>
    </section>`;
  if (!modal.innerHTML.trim()) {
    console.error("[world:stays:modal-empty]");
    return;
  }
  document.body.appendChild(modal);
  const sheet = modal.querySelector(".world-stay-modal__sheet");
  const exists = !!document.querySelector("[data-world-stay-modal]");
  console.debug("[world:stays:modal-dom]", {
    exists,
    innerHTMLLength: modal.innerHTML.length,
    rect: modal.getBoundingClientRect(),
    sheetRect: sheet?.getBoundingClientRect()
  });
}
function closeModal() { const modal = document.querySelector("[data-world-stay-modal]"); if (modal) modal.remove(); }
function openWorldStayModal() { openModal(); }
function showCompactWarning(message = "") { const node = $("[data-world-stays-warning]"); if (node) node.textContent = message; }
function normalizeCityId(value = "") { return String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "unknown-city"; }
async function reverseGeocode(lat, lon) {
  const u = new URL("https://nominatim.openstreetmap.org/reverse");
  u.searchParams.set("lat", String(lat)); u.searchParams.set("lon", String(lon)); u.searchParams.set("format", "jsonv2"); u.searchParams.set("addressdetails", "1");
  const raw = await (await fetch(u)).json();
  const a = raw?.address || {};
  return { city:String(a.city || a.town || a.village || a.municipality || "").trim(), region:String(a.state || a.region || "").trim(), country:String(a.country || "").trim(), countryCode:String(a.country_code || "").trim().toUpperCase() };
}
async function ensureAutoStayToday() {
  if (autoStayTried) return;
  autoStayTried = true;
  console.debug("[world:stays:auto:start]");
  try {
    if (!window.isSecureContext || !navigator.geolocation) throw new Error("permiso denegado");
    const permission = navigator.permissions?.query ? await navigator.permissions.query({ name:"geolocation" }) : null;
    if (permission?.state === "denied") throw new Error("permiso denegado");
    const coords = await new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition((pos) => resolve({ lat:Number(pos.coords.latitude), lon:Number(pos.coords.longitude) }), () => reject(new Error("permiso denegado")), { enableHighAccuracy:true, maximumAge:60000, timeout:12000 }));
    console.debug("[world:stays:auto:location]", coords);
    const place = await reverseGeocode(coords.lat, coords.lon);
    console.debug("[world:stays:auto:resolved]", place);
    if (!place.countryCode || !place.country) throw new Error("geocoder falló");
    if (!place.city) throw new Error("sin ciudad");
    const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
    if (!uid) throw new Error("Firebase error");
    const today = new Date().toISOString().slice(0, 10);
    const key = `auto_${today}_${place.countryCode}_${normalizeCityId(place.city)}`;
    if (stays.some((st) => st.id === key)) return console.warn("[world:stays:auto:skip]", "exists");
    const now = Date.now();
    const stay = { id:key, source:"auto-location", date:today, city:place.city, region:place.region, country:place.country, countryCode:place.countryCode, flagEmoji:flagFromCountryCode(place.countryCode), daysTotal:1, createdAt:now, updatedAt:now };
    await update(ref(db, `v2/users/${uid}/world/stays`), { [key]: stay });
    console.debug("[world:stays:auto:saved]", stay);
  } catch (error) {
    const reason = String(error?.message || "Firebase error");
    console.warn("[world:stays:auto:skip]", reason);
    showCompactWarning(`No se pudo registrar ubicación automática (${reason})`);
  }
}


export function renderWorldStays() { render(); }

function initWorldStaysAsync() {
  Promise.resolve()
    .then(() => ensureAutoStayToday())
    .catch((error) => {
      console.error("[world:stays:init:error]", error);
    });
}

export function initWorldStays({ root }) {
  ctx = { root };
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (uid && !unsub) {
    const path = `v2/users/${uid}/world/stays`;
    unsub = trackedOnValue(ref(db, path), (snap) => { stays = Object.values(snap.val() || {}); render(); }, { key:"world-stays", path, module:"world", mode:"onValue", reason:"world-stays", viewId:"view-world" }, onValue);
  }
  window.setTimeout(() => initWorldStaysAsync(), 0);

  if (!globalStayModalHandlerBound) {
    globalStayModalHandlerBound = true;
    document.addEventListener("click", async (e) => {
      const btn = e.target.closest("button,[data-world-stay-close]");
      if (!btn) return;
      if (btn.dataset.worldStayClose === undefined && btn.dataset.worldStaySave === undefined) return;
      e.preventDefault();
      e.stopPropagation();
      if (btn.dataset.worldStayClose !== undefined) closeModal();
      if (btn.dataset.worldStaySave !== undefined) {
        const city = String(document.querySelector("[data-world-stay-city]")?.value || "").trim();
        const country = String(document.querySelector("[data-world-stay-country]")?.value || "").trim();
        const countryCode = String(document.querySelector("[data-world-stay-country-code]")?.value || "").trim().toUpperCase();
        const startDate = String(document.querySelector("[data-world-stay-start]")?.value || "").trim();
        const endDate = String(document.querySelector("[data-world-stay-end]")?.value || "").trim();
        const manualDays = String(document.querySelector("[data-world-stay-total-days]")?.value || "").trim();
        const computed = calcInclusiveDays(startDate, endDate, manualDays);
        const finalDays = computed || (String(document.querySelector("[data-world-stay-source]")?.value || "").trim().toLowerCase() === "auto" ? 1 : null);
        if (!country || !finalDays) return;
        const dup = stays.some((s) => String(s.startDate || "") === startDate && String(s.city || "").toLowerCase() === city.toLowerCase() && String(s.country || "").toLowerCase() === country.toLowerCase());
        if (dup) return;
        const now = Date.now();
        stays.push({ id:toId(), source:String(document.querySelector("[data-world-stay-source]")?.value || "manual").trim() || "manual", city, region:String(document.querySelector("[data-world-stay-region]")?.value || "").trim(), country, countryCode, flagEmoji:String(document.querySelector("[data-world-stay-flag]")?.value || "").trim() || flagFromCountryCode(countryCode), startDate, endDate, daysTotal:finalDays, createdAt:now, updatedAt:now });
        await persistStays();
        closeModal();
        render();
      }
    });
  }

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("button,[data-world-stay-close]");
    if (!btn) return;

    if (btn.dataset.worldSetBirthdate !== undefined) {
      const val = window.prompt("Fecha de nacimiento (YYYY-MM-DD)", getBirthDate());
      if (val) { persistBirthDate(val.trim()); render(); }
    }
  });

  root.addEventListener("toggle", (e) => {
    const details = e.target;
    if (!(details instanceof HTMLDetailsElement) || !details.matches(".world-stays-country")) return;
    const key = details.dataset.countryKey || "";
    if (!key) return;
    if (details.open) collapsedCountries.delete(key);
    else collapsedCountries.add(key);
  });

  render();
}
