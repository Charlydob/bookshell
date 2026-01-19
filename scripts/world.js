// scripts/world.js
import { renderCountryHeatmap } from "./world-heatmap.js";
import { getCountryEnglishName, getCountryOptions } from "./countries.js";

const LS_VISITS = "world_visits_v1";
const LS_WATCH = "world_watchlist_v1";

const COUNTRY_NAME_OVERRIDES = {
  US: "United States of America",
  RU: "Russia",
  IR: "Iran",
  SY: "Syria",
  CZ: "Czech Republic",
  GB: "United Kingdom",
  KR: "South Korea",
  KP: "North Korea",
  VN: "Vietnam",
  LA: "Laos",
  CD: "Democratic Republic of the Congo",
  CG: "Republic of the Congo",
  CI: "Ivory Coast",
  BO: "Bolivia",
  VE: "Venezuela",
  TZ: "Tanzania",
};

function $id(id) { return document.getElementById(id); }

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, '&#39;');
}

function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

function parseJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || "") ?? fallback; }
  catch { return fallback; }
}

function saveJson(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function uniq(arr) {
  return [...new Set(arr)];
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function startOfYear(d) {
  return new Date(d.getFullYear(), 0, 1);
}

function filterVisitsByMode(visits, mode) {
  const now = new Date();
  const t0 = (() => {
    if (mode === "day") return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if (mode === "week") return new Date(now.getTime() - 6 * 24 * 3600 * 1000);
    if (mode === "month") return startOfMonth(now);
    if (mode === "year") return startOfYear(now);
    return null; // total
  })();

  if (!t0) return visits.slice();
  const ms0 = t0.getTime();
  return visits.filter(v => (Number(v.ts) || 0) >= ms0);
}

function iso2(code) {
  return String(code || "").trim().toUpperCase();
}

function countryMapNameFromISO2(code) {
  const c = iso2(code);
  return COUNTRY_NAME_OVERRIDES[c] || getCountryEnglishName(c) || c;
}

/* ---- Nominatim ---- */
let nominatimAbort = null;
async function nominatimSearch(q) {
  if (!q || q.trim().length < 2) return [];
  if (nominatimAbort) nominatimAbort.abort();
  nominatimAbort = new AbortController();

  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", "8");
  url.searchParams.set("accept-language", "es");
  url.searchParams.set("q", q.trim());

  try {
    const res = await fetch(url.toString(), {
      signal: nominatimAbort.signal,
      headers: { "Accept": "application/json" },
    });
    if (!res.ok) return [];
    return await res.json();
  } catch (err) {
    // ✅ evitar UnhandledPromiseRejection cuando se aborta al teclear rápido
    if (err?.name === "AbortError") return [];
    console.warn("Nominatim error", err);
    return [];
  }
}

function isPlaceResult(r) {
  const cls = String(r?.class || "");
  const t = String(r?.type || "");
  const a = r?.address || {};

  const hasSubCountry = !!(
    a.city || a.town || a.village || a.hamlet || a.municipality ||
    a.suburb || a.locality || a.county || a.state || a.region ||
    a.province || a.state_district
  );

  // evita meter un país como “ciudad”
  if (t === "country") return false;
  if (!hasSubCountry && cls === "boundary" && t === "administrative") return false;

  if (["city","town","village","hamlet","municipality","suburb","locality","county"].includes(t)) return true;
  if (cls === "boundary" && t === "administrative" && hasSubCountry) return true;

  // algunos resultados vienen como class=place (neighbourhood etc.)
  if (cls === "place") return true;

  return false;
}

function isCountryishResult(r) {
  const cls = String(r?.class || "");
  const t = String(r?.type || "");
  // Nominatim es variable: esto cubre bastante
  return cls === "boundary" || t === "country" || t === "administrative";
}

/* ---- Área relativa desde GeoJSON (aprox, pero consistente) ---- */
let areaCache = null;

function ringAreaWeight(coords) {
  // coords: [[lon,lat],...]
  if (!Array.isArray(coords) || coords.length < 3) return 0;
  let avgLat = 0;
  let n = 0;
  for (const p of coords) {
    const lat = Number(p?.[1]);
    if (!Number.isFinite(lat)) continue;
    avgLat += lat;
    n++;
  }
  if (!n) return 0;
  avgLat /= n;
  const k = Math.cos((avgLat * Math.PI) / 180);

  let sum = 0;
  for (let i = 0; i < coords.length; i++) {
    const a = coords[i];
    const b = coords[(i + 1) % coords.length];
    const ax = (Number(a?.[0]) * Math.PI) / 180 * k;
    const ay = (Number(a?.[1]) * Math.PI) / 180;
    const bx = (Number(b?.[0]) * Math.PI) / 180 * k;
    const by = (Number(b?.[1]) * Math.PI) / 180;
    if (![ax,ay,bx,by].every(Number.isFinite)) continue;
    sum += ax * by - bx * ay;
  }
  return Math.abs(sum) / 2;
}

function polygonAreaWeight(poly) {
  // poly: [ring1, ring2(holes)...]
  if (!Array.isArray(poly) || !poly.length) return 0;
  const outer = ringAreaWeight(poly[0]);
  let holes = 0;
  for (let i = 1; i < poly.length; i++) holes += ringAreaWeight(poly[i]);
  return Math.max(0, outer - holes);
}

function featureAreaWeight(f) {
  const name = String(f?.properties?.name || "");
  if (name === "Antarctica") return 0;

  const g = f?.geometry;
  if (!g) return 0;

  if (g.type === "Polygon") return polygonAreaWeight(g.coordinates);
  if (g.type === "MultiPolygon") {
    let sum = 0;
    for (const p of g.coordinates) sum += polygonAreaWeight(p);
    return sum;
  }
  return 0;
}

function ensureAreaCacheFromECharts() {
  const echartsLib = window?.echarts;
  const geoJson = echartsLib?.getMap?.("world")?.geoJson;
  const feats = geoJson?.features || [];
  if (!feats.length) return null;

  const map = new Map();
  let total = 0;
  for (const f of feats) {
    const name = String(f?.properties?.name || "");
    const w = featureAreaWeight(f);
    if (!w) continue;
    map.set(name, w);
    total += w;
  }
  return { map, total };
}

/* ---- UI ---- */
function renderWatchlist($list, watch) {
  $list.innerHTML = "";
  const items = Object.values(watch || {}).sort((a,b)=> (a.label||"").localeCompare(b.label||""));
  if (!items.length) {
    $list.innerHTML = `<div class="geo-empty">Sin watchlist.</div>`;
    return;
  }
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "world-item";
    row.innerHTML = `
      <div>
        <div class="name">${it.label || it.code}</div>
        <div class="meta">${it.code}</div>
      </div>
      <div class="actions">
        <button class="btn" data-act="remove-watch" data-code="${it.code}">Quitar</button>
      </div>
    `;
    $list.appendChild(row);
  }
}

function groupVisitsByCountry(visits) {
  const m = new Map(); // code -> {code,label,items:[]}
  for (const v of visits) {
    const code = iso2(v.countryCode);
    if (!code) continue;
    if (!m.has(code)) {
      const label = getCountryEnglishName(code) || code;
      m.set(code, { code, label, items: [] });
    }
    m.get(code).items.push(v);
  }
  // sort: countries by most recent visit, items by ts desc
  const groups = Array.from(m.values());
  for (const g of groups) g.items.sort((a,b)=>(b.ts||0)-(a.ts||0));
  groups.sort((a,b)=>(b.items?.[0]?.ts||0)-(a.items?.[0]?.ts||0));
  return groups;
}

function renderVisitsMiniGrouped($list, visits, { limit = 60 } = {}) {
  $list.innerHTML = "";

  const sorted = visits.slice().sort((a,b)=>(b.ts||0)-(a.ts||0));
  const top = sorted.slice(0, limit);

  if (!top.length) {
    $list.innerHTML = `<div class="geo-empty">Aún no hay visitas.</div>`;
    return;
  }

  const groups = groupVisitsByCountry(top);

  for (const g of groups) {
    const last = g.items?.[0];
    const lastLabel = last?.placeName ? last.placeName : countryMapNameFromISO2(g.code);

    const det = document.createElement("details");
    det.className = "world-country";
    const isFirst = (g === groups[0]);
    det.open = isFirst;

    det.innerHTML = `
      <summary class="world-country-summary">
        <div class="world-country-name">${esc(g.label)}</div>
        <div class="world-country-meta">${esc(g.code)} · ${g.items.length} · últ: ${esc(lastLabel)}</div>
      </summary>
      <div class="world-country-body"></div>
    `;

    const renderBody = () => {
      if (!det.open) return;
      const body = det.querySelector(".world-country-body");
      if (!body || body.dataset.ready === "1") return;
      body.dataset.ready = "1";

      const frag = document.createDocumentFragment();
      for (const v of g.items) {
        const label = v.placeName ? v.placeName : countryMapNameFromISO2(g.code);
        const row = document.createElement("div");
        row.className = "world-item";
        row.innerHTML = `
          <div>
            <div class="name">${esc(label)}</div>
            <div class="meta">${esc(g.code)} · ${esc(v.dateKey || "—")}</div>
          </div>
          <div class="actions">
            <button class="btn" data-act="del-visit" data-id="${v.id}">Borrar</button>
          </div>
        `;
        frag.appendChild(row);
      }
      body.appendChild(frag);
    };

    det.addEventListener("toggle", renderBody);
    if (isFirst) renderBody();

    $list.appendChild(det);
  }
}

function aggCountsByCountry(visits) {
  const m = new Map();
  for (const v of visits) {
    const code = iso2(v.countryCode);
    if (!code) continue;
    m.set(code, (m.get(code) || 0) + 1);
  }
  const out = [];
  for (const [code, value] of m.entries()) {
    out.push({
      code,
      value,
      label: getCountryEnglishName(code) || code,
      mapName: countryMapNameFromISO2(code),
    });
  }
  out.sort((a,b)=>b.value-a.value);
  return out;
}

function buildPlacePoints(visits) {
  const pts = [];
  for (const v of visits) {
    const lon = Number(v.lon);
    const lat = Number(v.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    const code = iso2(v.countryCode);
    pts.push({
      name: v.placeName || countryMapNameFromISO2(code),
      value: [lon, lat, 1],
      raw: { code, dateKey: v.dateKey || "", name: v.placeName || "" },
    });
  }
  return pts;
}


// Aproximación razonable: países añadidos como “país” cuentan área del país;
// ciudades/pueblos cuentan un “disco urbano” (evita sumar el país entero por meter una ciudad).
const EARTH_LAND_KM2 = 148_940_000; // ~ superficie terrestre sin océanos (aprox)
const PLACE_RADIUS_KM = {
  city: 15,
  town: 8,
  village: 6,
  hamlet: 5,
  suburb: 6,
  locality: 6,
  default: 6,
};

function round2(n) {
  return Math.round(Number(n) * 100) / 100;
}

function circleKm2(rKm) {
  const r = Number(rKm) || 0;
  return r > 0 ? Math.PI * r * r : 0;
}

function countryAreaKm2(code) {
  if (!areaCache) areaCache = ensureAreaCacheFromECharts();
  if (!areaCache || !areaCache.total) return 0;
  const name = countryMapNameFromISO2(code);
  const w = areaCache.map.get(name);
  if (!w) return 0;
  return (w / areaCache.total) * EARTH_LAND_KM2;
}

function placeKm2FromVisit(v) {
  const kind = String(v?.kind || "").toLowerCase();
  // Nominatim da type en r.type, pero nosotros guardamos el kind del selector.
  const r = (kind === "place") ? PLACE_RADIUS_KM.default : (PLACE_RADIUS_KM[kind] ?? PLACE_RADIUS_KM.default);
  // cap suave por si entra algo raro
  return Math.min(circleKm2(r), 4000);
}

function computeVisitedAreaFromVisits(visits) {
  if (!Array.isArray(visits) || !visits.length) return { km2: 0, pct: 0 };

  // 1) países completos (solo si se guardaron como kind="country")
  const fullCountries = new Set();

  // 2) lugares: dedupe por celda (lat/lon redondeada) para no sumar 50 veces el mismo sitio
  const places = new Set();

  let km2 = 0;
  for (const v of visits) {
    const code = iso2(v.countryCode);
    if (!code) continue;

    if (v.kind === "country") {
      if (fullCountries.has(code)) continue;
      fullCountries.add(code);
      km2 += countryAreaKm2(code);
      continue;
    }

    const lat = Number(v.lat);
    const lon = Number(v.lon);
    const key = `${code}:${v.kind || "place"}:${round2(lat)},${round2(lon)}:${String(v.placeName || "").slice(0, 24)}`;
    if (places.has(key)) continue;
    places.add(key);
    km2 += placeKm2FromVisit(v);
  }

  const pct = EARTH_LAND_KM2 ? (km2 / EARTH_LAND_KM2) * 100 : 0;
  return { km2, pct: Math.max(0, Math.min(100, pct)) };
}

/* ---- Drill-down (país -> provincias/estados/cantones) ---- */
const SUBDIV_GEOJSON_BASE = "https://raw.githubusercontent.com/codeforgermany/click_that_hood/main/public/data/";

function countrySlugFromISO2(code) {
  const nm = (getCountryEnglishName(code) || code || "").toLowerCase();
  return nm
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fetchSubdivGeoJSON(iso2Code) {
  const code = iso2(iso2Code);
  if (!code) return null;

  // atajos “conocidos”
  const known = {
    ES: ["spain-provinces.geojson", "spain-communities.geojson"],
  };

  const slug = countrySlugFromISO2(code);

  const candidates = [
    ...(known[code] || []),
    `${slug}.geojson`,
    `${slug}-provinces.geojson`,
    `${slug}-states.geojson`,
    `${slug}-regions.geojson`,
    `${slug}-departments.geojson`,
    `${slug}-counties.geojson`,
    `${slug}-cantons.geojson`,
  ].filter(Boolean);

  for (const file of candidates) {
    try {
      const url = SUBDIV_GEOJSON_BASE + file;
      const res = await fetch(url, { cache: "force-cache" });
      if (!res.ok) continue;
      const gj = await res.json();
      return normalizeSubdivGeoJSON(gj);
    } catch (_) {}
  }
  return null;
}

function featureNameGuess(f) {
  const p = f?.properties || {};
  return String(
    p.name ??
      p.NAME ??
      p.NOM ??
      p.nom ??
      p.NAME_1 ??
      p.name_1 ??
      p.state ??
      p.province ??
      p.region ??
      p.county ??
      p.COUNTY ??
      ""
  ).trim();
}

function normalizeSubdivGeoJSON(gj) {
  const feats = gj?.features;
  if (!Array.isArray(feats)) return gj;
  for (const f of feats) {
    if (!f.properties) f.properties = {};
    if (!f.properties.name) f.properties.name = featureNameGuess(f) || "—";
  }
  return gj;
}

function bboxFromCoords(coords) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pt of coords) {
    const x = pt?.[0], y = pt?.[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function geometryBBox(geom) {
  if (!geom) return null;
  if (geom.type === "Polygon") return bboxFromCoords(geom.coordinates?.[0] || []);
  if (geom.type === "MultiPolygon") {
    let bb = null;
    for (const poly of geom.coordinates || []) {
      const b = bboxFromCoords(poly?.[0] || []);
      if (!bb) bb = b;
      else {
        bb[0] = Math.min(bb[0], b[0]);
        bb[1] = Math.min(bb[1], b[1]);
        bb[2] = Math.max(bb[2], b[2]);
        bb[3] = Math.max(bb[3], b[3]);
      }
    }
    return bb;
  }
  return null;
}

function pointInRing(pt, ring) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect =
      (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function pointInPolygon(pt, poly) {
  if (!poly?.length) return false;
  if (!pointInRing(pt, poly[0])) return false;
  for (let h = 1; h < poly.length; h++) {
    if (pointInRing(pt, poly[h])) return false; // hole
  }
  return true;
}

function pointInGeometry(pt, geom) {
  if (!geom) return false;
  if (geom.type === "Polygon") return pointInPolygon(pt, geom.coordinates);
  if (geom.type === "MultiPolygon") {
    for (const p of geom.coordinates || []) {
      if (pointInPolygon(pt, p)) return true;
    }
  }
  return false;
}

function computeSubdivisionCounts(geojson, points) {
  const feats = geojson?.features || [];
  const enriched = feats.map((f) => ({
    f,
    name: String(f?.properties?.name || "—"),
    bb: geometryBBox(f?.geometry),
  }));

  const counts = new Map();
  for (const pt of points) {
    const x = pt?.[0], y = pt?.[1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    for (const it of enriched) {
      const bb = it.bb;
      if (!bb) continue;
      if (x < bb[0] || y < bb[1] || x > bb[2] || y > bb[3]) continue;
      if (pointInGeometry([x, y], it.f.geometry)) {
        counts.set(it.name, (counts.get(it.name) || 0) + 1);
        break;
      }
    }
  }
  return counts;
}

async function attachWorldTab() {
  const $view = $id("view-world");
  if (!$view) return;

  const $map = $id("world-map");
  const $pct = $id("world-pct");
  const $countriesDone = $id("world-countries");
  const $countriesTotal = $id("world-countries-total");
  const $placesDone = $id("world-places");
  const $filter = $id("world-filter");
  const $visitsList = $id("world-visits-list");

const $visitsCount = $id("world-visits-count");
const $watchCount = $id("world-watch-count");

const $mapWrap = $map?.closest?.(".world-map-wrap") || $map?.parentElement || null;

const drill = { active: false, code: null, geojson: null, mapKey: null };

let $backBtn = $mapWrap?.querySelector?.(".world-back-btn") || null;
if (!$backBtn && $mapWrap) {
  $backBtn = document.createElement("button");
  $backBtn.type = "button";
  $backBtn.className = "world-back-btn";
  $backBtn.textContent = "🌏";
  $mapWrap.appendChild($backBtn);
}
const showBackBtn = (on) => {
  if (!$backBtn) return;
  $backBtn.style.display = on ? "flex" : "none";
};
if ($backBtn) {
  $backBtn.addEventListener("click", () => {
    drill.active = false;
    drill.code = null;
    drill.geojson = null;
    drill.mapKey = null;
    showBackBtn(false);
    renderAll();
  });
}

  const $watchInput = $id("world-watch-q");
  const $watchList = $id("world-watch-list");
  const $watchAdd = $id("world-watch-add");

  const $addKind = $id("world-kind");
  const $addQuery = $id("world-place-q");
  const $addResults = $id("world-place-results");
  const $addSave = $id("world-place-save");
  const $addToggle = $id("world-add-toggle");

  let visits = parseJson(LS_VISITS, []);
  let watch = parseJson(LS_WATCH, {}); // {ES:{code,label}}

  const TOTAL_COUNTRIES = (() => {
    try { return (getCountryOptions()?.length || 0); } catch (_) { return 0; }
  })();
  if ($countriesTotal) $countriesTotal.textContent = String(TOTAL_COUNTRIES || 0);

  let pendingPick = null;

  function persist() {
    saveJson(LS_VISITS, visits);
    saveJson(LS_WATCH, watch);
  }

function formatPctSmart(pct, sig = 4) {
  const x = Number(pct || 0);
  if (!Number.isFinite(x) || x === 0) return "0.0000%";
  const ax = Math.abs(x);

  if (ax >= 0.01) return `${x.toFixed(2)}%`;

  const zeros = Math.max(0, Math.floor(-Math.log10(ax)) - 1);
  let dec = zeros + sig;
  dec = Math.min(12, Math.max(4, dec));
  return `${x.toFixed(dec)}%`;
}

function setPctValue(p, km2 = 0) {
  if (!$pct) return;
  $pct.textContent = formatPctSmart(p, 4);
  const km2txt = (km2 > 0)
    ? `${Math.round(km2).toLocaleString("es-ES")} km²`
    : "0 km²";
  $pct.title = `Aprox. tierra visitada: ${km2txt}. Países = país completo; ciudades/pueblos = área urbana estimada.`;
}


 
async function renderAll() {
  const mode = $filter.value;
  const filtered = filterVisitsByMode(visits, mode);
  const entries = aggCountsByCountry(filtered);

  // KPIs
  const visitedCountries = uniq(filtered.map((v) => iso2(v.countryCode)).filter(Boolean));
  if ($countriesDone) $countriesDone.textContent = String(visitedCountries.length);

  const placeKeys = new Set();
  for (const v of filtered) {
    if (v.kind === "country") continue;
    const code = iso2(v.countryCode);
    const name = String(v.placeName || "").trim();
    const lat = Number(v.lat), lon = Number(v.lon);
    placeKeys.add(`${code}:${name || "?"}:${round2(lat)},${round2(lon)}`);
  }
  if ($placesDone) $placesDone.textContent = String(placeKeys.size);

  if ($visitsCount) $visitsCount.textContent = String(filtered.length);
  if ($watchCount) $watchCount.textContent = String(Object.keys(watch || {}).length);

  const pad = (n) => Array.from({ length: n }, () => ({}));
  const mapNameToCode = new Map();
  try {
    (getCountryOptions() || []).forEach((o) => {
      if (o?.code) mapNameToCode.set(countryMapNameFromISO2(o.code), iso2(o.code));
    });
  } catch (_) {}

  const echartsLib = window?.echarts;

  const ensureChart = () => {
    if ($map.__geoChart) return $map.__geoChart;
    if (!echartsLib) return null;
    $map.__geoChart = echartsLib.init($map);
    return $map.__geoChart;
  };

  // nada: salimos y limpiamos drill
  if (!entries.length) {
    drill.active = false;
    drill.code = null;
    drill.geojson = null;
    drill.mapKey = null;
    showBackBtn(false);

    setPctValue(0);
    renderVisitsMiniGrouped($visitsList, filtered);

    await renderCountryHeatmap($map, [], {
      emptyLabel: "Aún no hay visitas",
      showCallouts: false,
    });

    const chart = $map.__geoChart;
    if (chart) {
      if (chart.__worldClickHandler) {
        chart.off("click", chart.__worldClickHandler);
        chart.__worldClickHandler = null;
      }
      chart.setOption({ tooltip: { show: false } });

      // overlay watchlist incluso sin visitas
     
    }

  }

  // --- Drill mode ---
  if (drill.active && drill.code) {
    showBackBtn(true);

    const chart = ensureChart();
    if (!chart || !echartsLib) {
      drill.active = false;
      showBackBtn(false);
    } else {
      if (!drill.geojson) drill.geojson = await fetchSubdivGeoJSON(drill.code);

      if (!drill.geojson) {
        drill.active = false;
        drill.code = null;
        showBackBtn(false);
      } else {
        const code = iso2(drill.code);
        const mapKey = `subdiv-${code}`;
        drill.mapKey = mapKey;
        echartsLib.registerMap(mapKey, drill.geojson);

        const pts = filtered
          .filter((v) => iso2(v.countryCode) === code)
          .map((v) => [Number(v.lon), Number(v.lat)])
          .filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));

        const counts = computeSubdivisionCounts(drill.geojson, pts);
        const data = Array.from(counts.entries()).map(([name, value]) => ({
          name,
          value,
        }));
        const max = Math.max(1, ...data.map((d) => d.value || 0));

        chart.clear();

        const hiData = Array.from(counts.entries())
          .filter(([, v]) => (v || 0) > 0)
          .map(([name]) => ({
            name,
            value: 1,
            itemStyle: { areaColor: "rgba(245,230,166,0.98)" },
          }));

        chart.setOption({
          backgroundColor: "transparent",
          tooltip: { show: false },
          visualMap: {
            min: 0,
            max,
            show: false,
            inRange: {
              color: [
                "rgba(255,255,255,0.05)",
                "rgba(255,255,255,0.25)",
              ],
            },
          },
          series: [
            {
              id: "sub-map",
              type: "map",
              map: mapKey,
              roam: true,
              nameProperty: "name",
              label: {
                show: true,
                color: "rgba(255,255,255,0.72)",
                fontSize: 10,
                fontWeight: 700,
              },
              labelLayout: { hideOverlap: true },
              emphasis: { label: { show: true } },
              itemStyle: {
                borderColor: "rgba(255,255,255,0.10)",
                borderWidth: 0.8,
              },
              data,
            },
            {
              id: "sub-hi",
              type: "map",
              map: mapKey,
              roam: true,
              nameProperty: "name",
              silent: true,
              z: 5,
              label: { show: false },
              emphasis: { label: { show: false } },
              itemStyle: {
                borderColor: "rgba(245,230,166,0.55)",
                borderWidth: 1.2,
                areaColor: "rgba(245,230,166,0.98)",
              },
              data: hiData,
            },
          ],
        });

        if (chart.__worldClickHandler) {
          chart.off("click", chart.__worldClickHandler);
          chart.__worldClickHandler = null;
        }
      }
    }
  }

  // --- World mode ---
  if (!drill.active) {
    showBackBtn(false);

    await renderCountryHeatmap($map, entries, {
      emptyLabel: "Aún no hay visitas",
      showCallouts: false,
    });

    const chart = $map.__geoChart;
    if (chart) {
      chart.setOption({ tooltip: { show: false } });

// puntos (ciudad/pueblo) sin texto (independiente del watchlist)
const points = buildPlacePoints(filtered);

const baseLenNoExtra = () =>
  (chart.getOption()?.series || []).filter((s) => !["places"].includes(s?.id)).length;

const placesSeries = {
  id: "places",
  type: "scatter",
  coordinateSystem: "geo",
  z: 20,
  symbolSize: 1.5,
  itemStyle: { color: "rgb(255, 0, 0)" },
  label: { show: false },
  data: points,
  tooltip: { show: false },
  silent: true,
};

chart.setOption({
  series: [...pad(baseLenNoExtra()), placesSeries],
});


      const clickHandler = async (params) => {
        if (drill.active) return;
        if (params?.componentType !== "series") return;
        if (params?.seriesType !== "map") return;
        const code = mapNameToCode.get(params?.name);
        if (!code) return;

        drill.active = true;
        drill.code = code;
        drill.geojson = null;
        drill.mapKey = null;

        showBackBtn(true);
        await renderAll();
      };

      if (chart.__worldClickHandler) chart.off("click", chart.__worldClickHandler);
      chart.__worldClickHandler = clickHandler;
      chart.on("click", clickHandler);
    }
  }

  const { km2, pct } = computeVisitedAreaFromVisits(filtered);
  setPctValue(pct, km2);

  renderVisitsMiniGrouped($visitsList, filtered);
  renderWatchlist($watchList, watch);
}

  // --- Watchlist add (Nominatim) ---
  let watchT = 0;
  async function handleWatchSuggest() {
    clearTimeout(watchT);
    watchT = setTimeout(async () => {
      const q = $watchInput.value.trim();
      if (q.length < 2) return;

      const results = await nominatimSearch(q);
      const countries = results.filter(isCountryishResult).slice(0, 6);

      // pequeño menú inline reutilizando datalist-like
      let html = "";
      for (const r of countries) {
        const code = iso2(r?.address?.country_code || r?.country_code);
        if (!code) continue;
        const label = r?.display_name?.split(",")?.[0]?.trim() || getCountryEnglishName(code) || code;
        html += `<option value="${label}" data-code="${code}"></option>`;
      }
      // crea/actualiza datalist
      let dl = $id("world-watch-dl");
      if (!dl) {
        dl = document.createElement("datalist");
        dl.id = "world-watch-dl";
        document.body.appendChild(dl);
        $watchInput.setAttribute("list", "world-watch-dl");
      }
      dl.innerHTML = html;
    }, 250);
  }

  $watchInput.addEventListener("input", handleWatchSuggest);

  $watchAdd.addEventListener("click", async () => {
    const q = $watchInput.value.trim();
    if (q.length < 2) return;

    const results = await nominatimSearch(q);
    const r = results.find(isCountryishResult);
    if (!r) return;

    const code = iso2(r?.address?.country_code || r?.country_code);
    if (!code) return;

    const label = r?.display_name?.split(",")?.[0]?.trim() || getCountryEnglishName(code) || code;
    watch[code] = { code, label };
    persist();
    $watchInput.value = "";
    renderWatchlist($watchList, watch);
  });

  $watchList.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    const act = btn.dataset.act;
    const code = iso2(btn.dataset.code);
    if (act === "remove-watch" && code && watch[code]) {
      delete watch[code];
      persist();
      renderWatchlist($watchList, watch);
    }
  });

  // --- Modal add visit ---
  let addT = 0;
  $addQuery.addEventListener("input", () => {
    clearTimeout(addT);
    addT = setTimeout(async () => {
      pendingPick = null;
      $addResults.innerHTML = "";

      const q = $addQuery.value.trim();
      if (q.length < 2) return;

      const kind = $addKind.value;
      const res = await nominatimSearch(q);

      const filtered = (kind === "country")
        ? res.filter(isCountryishResult)
        : res.filter(isPlaceResult);

      const items = filtered.slice(0, 8);
      if (!items.length) {
        $addResults.innerHTML = `<div class="geo-empty">Sin resultados.</div>`;
        return;
      }

      for (const r of items) {
        const code = iso2(r?.address?.country_code || r?.country_code);
        if (!code) continue;

        const title = r?.display_name || "—";
        const name = title.split(",")[0].trim();
        const lon = Number(r?.lon);
        const lat = Number(r?.lat);

        const row = document.createElement("div");
        row.className = "world-item";
        row.innerHTML = `
          <div>
            <div class="name">${name}</div>
            <div class="meta">${code} · ${String(r?.type || "")}</div>
          </div>
          <div class="actions">
            <button class="btn" data-act="pick">Elegir</button>
          </div>
        `;
        row.querySelector('button[data-act="pick"]').addEventListener("click", () => {
          pendingPick = { code, name, lon, lat };
          // feedback mínimo
          $addQuery.value = name;
          $addResults.innerHTML = `<div class="geo-empty">Seleccionado: <b>${name}</b> (${code})</div>`;
        });

        $addResults.appendChild(row);
      }
    }, 250);
  });

  $addSave.addEventListener("click", async () => {
    const kind = $addKind.value;
    const dk = todayKey();
    const ts = Date.now();

    let payload = null;

    if (kind === "country") {
      // intenta resolver país desde búsqueda
      const q = $addQuery.value.trim();
      const res = await nominatimSearch(q);
      const r = res.find(isCountryishResult);
      if (!r) return;

      const code = iso2(r?.address?.country_code || r?.country_code);
      if (!code) return;

      const label = r?.display_name?.split(",")?.[0]?.trim() || getCountryEnglishName(code) || code;
      payload = { countryCode: code, placeName: label };
    } else {
      if (!pendingPick) return;
      payload = {
        countryCode: pendingPick.code,
        placeName: pendingPick.name,
        lon: pendingPick.lon,
        lat: pendingPick.lat,
      };
    }

    const v = {
      id: `${ts}_${Math.random().toString(16).slice(2)}`,
      ts,
      dateKey: dk,
      kind,
      ...payload,
    };

    visits.push(v);
    persist();

    // cierra modal
    $addToggle.checked = false;
    pendingPick = null;
    $addQuery.value = "";
    $addResults.innerHTML = "";

    await renderAll();
  });

  // borrar visitas
  $visitsList.addEventListener("click", async (e) => {
    const btn = e.target.closest("button[data-act]");
    if (!btn) return;
    if (btn.dataset.act !== "del-visit") return;
    const id = btn.dataset.id;
    if (!id) return;
    visits = visits.filter(v => v.id !== id);
    persist();
    await renderAll();
  });

  $filter.addEventListener("change", renderAll);

  await renderAll();
}

document.addEventListener("DOMContentLoaded", attachWorldTab);
