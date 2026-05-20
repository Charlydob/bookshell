import { auth, db, getCurrentUserDataRootKey } from "../../shared/firebase/index.js";
import { ref, onValue, set } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { trackedOnValue } from "../../shared/firebase/read-debug.js";

let ctx = { root:null, state:null, helpers:{} };
let stays = [];
let unsub = null;

const $ = (sel) => ctx.root?.querySelector(sel);
const flagFromCountryCode = (cc = "") => {
  const s = String(cc || "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(s) ? String.fromCodePoint(...[...s].map((c) => 127397 + c.charCodeAt(0))) : "🌍";
};
const toId = () => `stay_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

function calcDays(start, end, manual) {
  if (start && end) {
    const s = new Date(start);
    const e = new Date(end);
    const diff = Math.round((e - s) / 86400000) + 1;
    return Number.isFinite(diff) && diff > 0 ? diff : null;
  }
  const d = Number(manual);
  return Number.isFinite(d) && d > 0 ? d : null;
}

function getBirthDate() {
  return String(localStorage.getItem("worldBirthDate") || "").trim();
}

function getDaysAlive(birthDate) {
  if (!birthDate) return null;
  const birth = new Date(birthDate);
  const now = new Date();
  const days = Math.floor((now - birth) / 86400000);
  return Number.isFinite(days) && days > 0 ? days : null;
}

function persistBirthDate(date) {
  localStorage.setItem("worldBirthDate", date);
}

async function saveStay(stay) {
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (!uid) return;
  const stayPath = `v2/users/${uid}/world/stays`;
  const payload = Object.fromEntries(stays.map((s) => [s.id, s]));
  await set(ref(db, stayPath), payload);
  console.debug("[world:stays:save]", stay);
}

function renderSummary() {
  const mount = $("[data-world-stays-summary]");
  if (!mount) return;
  mount.innerHTML = getStaysSummary();
}

export function getStaysSummary() {
  if (!stays.length) return "<div>Sin estancias todavía.</div>";
  const grouped = stays.reduce((acc, stay) => {
    const key = stay.country || "Sin país";
    const entry = acc.get(key) || { country: key, code: stay.countryCode || "", days: 0 };
    entry.days += Number(stay.totalDays || 0);
    acc.set(key, entry);
    return acc;
  }, new Map());
  const birthDate = getBirthDate();
  const daysAlive = getDaysAlive(birthDate);
  const rows = Array.from(grouped.values()).sort((a, b) => b.days - a.days).map((g) => {
    const pct = daysAlive ? ` · ${((g.days / daysAlive) * 100).toFixed(1)}% de vida` : "";
    return `<div class="world-rich-item"><div><strong>${flagFromCountryCode(g.code)} ${g.country}</strong><small>${g.days} días${pct}</small></div></div>`;
  }).join("");
  const birthCta = daysAlive ? "" : '<button type="button" data-world-action="set-birthdate">Añadir fecha de nacimiento</button>';
  return `${rows}${birthCta}`;
}

export function renderWorldStays() { renderSummary(); }

export function openWorldStayModal() {
  closeWorldStayModal();
  console.debug("[world:stays:open-modal]");
  const modal = $("[data-world-stay-modal]");
  if (modal) modal.hidden = false;
}

export function closeWorldStayModal() {
  const modal = $("[data-world-stay-modal]");
  if (modal) modal.hidden = true;
}

export function initWorldStays({ root, state, helpers }) {
  ctx = { root, state, helpers: helpers || {} };
  console.debug("[world:stays:init]");
  const uid = getCurrentUserDataRootKey() || auth.currentUser?.uid;
  if (uid && !unsub) {
    const stayPath = `v2/users/${uid}/world/stays`;
    unsub = trackedOnValue(ref(db, stayPath), (snap) => {
      stays = Object.values(snap.val() || {});
      renderSummary();
    }, { key:"world-stays", path:stayPath, module:"world", mode:"onValue", reason:"world-stays", viewId:"view-world" }, onValue);
  }
  root.addEventListener("click", async (e) => {
    const target = e.target.closest("button");
    if (!target) return;
    if (target.dataset.worldStayClose !== undefined) closeWorldStayModal();
    if (target.dataset.worldAction === "set-birthdate") {
      const input = window.prompt("Fecha de nacimiento (YYYY-MM-DD)", getBirthDate());
      if (input) {
        persistBirthDate(input.trim());
        renderSummary();
      }
    }
    if (target.dataset.worldStaySave !== undefined) {
      const start = $("[data-world-stay-start]")?.value || "";
      const end = $("[data-world-stay-end]")?.value || "";
      const manualDays = $("[data-world-stay-total-days]")?.value || "";
      const totalDays = calcDays(start, end, manualDays);
      const country = String($("[data-world-stay-country]")?.value || "").trim();
      if (!country || !totalDays) return;
      const stay = {
        id: toId(),
        place: String($("[data-world-stay-place]")?.value || "").trim(),
        city: String($("[data-world-stay-city]")?.value || "").trim(),
        region: String($("[data-world-stay-region]")?.value || "").trim(),
        country,
        countryCode: String($("[data-world-stay-flag]")?.value || "").trim().toUpperCase(),
        startDate: start || "",
        endDate: end || "",
        totalDays,
        createdAt: Date.now()
      };
      stays.push(stay);
      await saveStay(stay);
      renderSummary();
      closeWorldStayModal();
    }
  });
}
