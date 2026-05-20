import { auth, db, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";

let ctx = { root:null };
let stays = [];
let unsub = null;

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
  const countries = new Map();
  const cities = new Set();
  stays.forEach((s) => {
    const key = `${s.country || ""}__${s.countryCode || ""}`;
    const item = countries.get(key) || { country:s.country || "Sin país", countryCode:s.countryCode || "", days:0 };
    item.days += Number(s.daysTotal || 0);
    countries.set(key, item);
    if (s.city) cities.add(`${s.city}__${s.country || ""}`);
  });
  const byCountry = Array.from(countries.values()).sort((a, b) => b.days - a.days);
  return { totalDays, countriesCount:byCountry.length, citiesCount:cities.size, dominant:byCountry[0] || null, byCountry };
}

function render() {
  const mount = $("[data-world-stays-summary]");
  if (!mount) return;
  const stats = computeStats();
  const born = getBirthDate();
  const alive = daysAlive(born);
  const bars = stats.byCountry.slice(0, 8).map((row) => {
    const pct = stats.totalDays ? (row.days / stats.totalDays) * 100 : 0;
    const lifePct = alive ? ` · ${(row.days / alive * 100).toFixed(2)}% vida` : "";
    return `<div class="world-rich-item"><div><strong>${flagFromCountryCode(row.countryCode)} ${esc(row.country)}</strong><small>${row.days} días · ${pct.toFixed(1)}%${lifePct}</small><div style="height:8px;background:rgba(255,255,255,.08);border-radius:999px;overflow:hidden;margin-top:6px"><div style="height:100%;width:${Math.max(2, pct).toFixed(1)}%;background:linear-gradient(90deg,#5ec7ff,#8cf6c6)"></div></div></div></div>`;
  }).join("");
  const list = stays.slice().sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0)).map((s) => `<div class="world-rich-item"><div><strong>${flagFromCountryCode(s.countryCode)} ${esc(s.country || "Sin país")} · ${Number(s.daysTotal || 0)} día${Number(s.daysTotal || 0) === 1 ? "" : "s"}</strong><small>${esc(s.city || "")} ${s.region ? `· ${esc(s.region)}` : ""}${s.startDate ? ` · ${s.startDate}` : ""}${s.endDate ? ` → ${s.endDate}` : ""}</small></div></div>`).join("");
  mount.innerHTML = `
    <div class="world-stays-head" style="display:flex;justify-content:space-between;gap:10px;align-items:center;margin-bottom:12px;">
      <h3 style="margin:0;">Estancias</h3>
      <button type="button" class="world-add-btn" data-world-stay-open>+ Añadir estancia</button>
    </div>
    <div class="world-kpis" style="margin-bottom:12px;">
      <div class="world-pill"><span>📆 Días registrados</span><strong>${stats.totalDays}</strong></div>
      <div class="world-pill"><span>🌍 Países</span><strong>${stats.countriesCount}</strong></div>
      <div class="world-pill"><span>🏙️ Ciudades</span><strong>${stats.citiesCount}</strong></div>
      <div class="world-pill"><span>👑 País dominante</span><strong>${stats.dominant ? `${flagFromCountryCode(stats.dominant.countryCode)} ${esc(stats.dominant.country)} (${stats.dominant.days})` : "-"}</strong></div>
    </div>
    <div class="world-rich-list">${bars || "<div>Sin estancias todavía.</div>"}</div>
    <div class="world-rich-list" style="margin-top:10px;">${list || ""}</div>
    <div class="world-rich-item" style="margin-top:10px;"><div><strong>Fecha de nacimiento (opcional)</strong><small>${born || "No definida"}</small></div><button type="button" data-world-set-birthdate>Editar</button></div>
    <div class="world-modal" data-world-stay-modal hidden>
      <div class="world-backdrop" data-world-stay-close></div>
      <div class="world-sheet">
        <div class="world-sheet-header"><h3>Nueva estancia</h3><button type="button" data-world-stay-close>Cerrar</button></div>
        <div class="world-edit-grid">
          <input data-world-stay-source placeholder="Origen (auto/manual)">
          <input data-world-stay-city placeholder="Ciudad">
          <input data-world-stay-region placeholder="Región/provincia">
          <input data-world-stay-country placeholder="País">
          <input data-world-stay-country-code placeholder="Código país (ej: PE)">
          <input data-world-stay-flag placeholder="Bandera emoji (opcional)">
          <input type="date" data-world-stay-start>
          <input type="date" data-world-stay-end>
          <input inputmode="numeric" data-world-stay-total-days placeholder="Días manuales">
        </div>
        <button type="button" class="world-save" data-world-stay-save>Guardar estancia</button>
      </div>
    </div>`;
}

function openModal() { const modal = $("[data-world-stay-modal]"); if (modal) modal.hidden = false; }
function closeModal() { const modal = $("[data-world-stay-modal]"); if (modal) modal.hidden = true; }

export function renderWorldStays() { render(); }
export function openWorldStayModal() { openModal(); }
export function closeWorldStayModal() { closeModal(); }

export function initWorldStays({ root }) {
  ctx = { root };
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (uid && !unsub) {
    const path = `v2/users/${uid}/world/stays`;
    unsub = trackedOnValue(ref(db, path), (snap) => { stays = Object.values(snap.val() || {}); render(); }, { key:"world-stays", path, module:"world", mode:"onValue", reason:"world-stays", viewId:"view-world" }, onValue);
  }

  root.addEventListener("click", async (e) => {
    const btn = e.target.closest("button,[data-world-stay-close]");
    if (!btn) return;
    if (btn.dataset.worldStayOpen !== undefined) openModal();
    if (btn.dataset.worldStayClose !== undefined) closeModal();
    if (btn.dataset.worldSetBirthdate !== undefined) {
      const val = window.prompt("Fecha de nacimiento (YYYY-MM-DD)", getBirthDate());
      if (val) { persistBirthDate(val.trim()); render(); }
    }
    if (btn.dataset.worldStaySave !== undefined) {
      const city = String($("[data-world-stay-city]")?.value || "").trim();
      const country = String($("[data-world-stay-country]")?.value || "").trim();
      const countryCode = String($("[data-world-stay-country-code]")?.value || "").trim().toUpperCase();
      const startDate = String($("[data-world-stay-start]")?.value || "").trim();
      const endDate = String($("[data-world-stay-end]")?.value || "").trim();
      const manualDays = String($("[data-world-stay-total-days]")?.value || "").trim();
      const computed = calcInclusiveDays(startDate, endDate, manualDays);
      const finalDays = computed || (String($("[data-world-stay-source]")?.value || "").trim().toLowerCase() === "auto" ? 1 : null);
      if (!country || !finalDays) return;
      const dup = stays.some((s) => String(s.startDate || "") === startDate && String(s.city || "").toLowerCase() === city.toLowerCase() && String(s.country || "").toLowerCase() === country.toLowerCase());
      if (dup) return;
      const now = Date.now();
      stays.push({ id:toId(), source:String($("[data-world-stay-source]")?.value || "manual").trim() || "manual", city, region:String($("[data-world-stay-region]")?.value || "").trim(), country, countryCode, flagEmoji:String($("[data-world-stay-flag]")?.value || "").trim() || flagFromCountryCode(countryCode), startDate, endDate, daysTotal:finalDays, createdAt:now, updatedAt:now });
      await persistStays();
      closeModal();
      render();
    }
  });

  render();
}
