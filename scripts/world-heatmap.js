// world-heatmap.js
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";
import { getCountryEnglishName } from "./countries.js";

const WORLD_GEO_URLS = [
  "https://echarts.apache.org/examples/data/asset/geo/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@5/map/json/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@3.6.0/map/json/world.json",
];

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 520;
const MIN_HOST_WIDTH = 220;
const MIN_HOST_HEIGHT = 240;
const LABEL_FONT = "12px 'Inter', 'Inter var', system-ui, -apple-system, sans-serif";
const LABEL_LIMIT_BASE = 12;
const LABEL_LIMIT_MID = 25;
const ZOOM_THRESHOLD_MID = 1.7;
const ZOOM_THRESHOLD_HIGH = 3;

let worldGeoPromise = null;
const measureCanvas = document.createElement("canvas");
const measureCtx = measureCanvas.getContext("2d");
if (measureCtx) measureCtx.font = LABEL_FONT;

async function fetchJson(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`GeoJSON status ${res.status} @ ${url}`);
  return res.json();
}

function loadWorldGeoJson() {
  if (worldGeoPromise) return worldGeoPromise;

  worldGeoPromise = (async () => {
    for (const url of WORLD_GEO_URLS) {
      try {
        return await fetchJson(url);
      } catch (e) {
        // prueba la siguiente
      }
    }
    throw new Error("No se pudo cargar ningún GeoJSON del mundo");
  })().catch((err) => {
    console.warn("No se pudo cargar el GeoJSON del mundo", err);
    worldGeoPromise = null;
    return null;
  });

  return worldGeoPromise;
}

function waitForHostSize(host, token, minW = MIN_HOST_WIDTH, minH = MIN_HOST_HEIGHT) {
  return new Promise((resolve) => {
    let attempts = 0;
    const check = () => {
      if (!host || host.__geoRenderToken !== token) {
        resolve(null);
        return;
      }
      const rect = host.getBoundingClientRect();
      if (rect.width >= minW && rect.height >= minH) {
        resolve(rect);
        return;
      }
      attempts += 1;
      const delay = attempts > 60 ? 140 : 80;
      setTimeout(() => {
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(check);
        } else {
          check();
        }
      }, delay);
    };
    check();
  });
}

function preventScrollOutside(host) {
  const wheelHandler = (e) => {
    e.preventDefault();
  };
  const touchHandler = (e) => {
    if (e.touches && e.touches.length > 1) {
      e.preventDefault();
    }
  };
  host.addEventListener("wheel", wheelHandler, { passive: false });
  host.addEventListener("touchmove", touchHandler, { passive: false });
  return () => {
    host.removeEventListener("wheel", wheelHandler);
    host.removeEventListener("touchmove", touchHandler);
  };
}

function normalizeName(str) {
  return String(str || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function sanitizeEntries(entries = []) {
  return (entries || []).map((entry) => ({
    code: entry.code,
    value: Number(entry.value) || 0,
    label: entry.label || entry.code,
    mapName: entry.mapName || getCountryEnglishName(entry.code) || entry.label || entry.code,
  }));
}

function featureKeys(feature) {
  const props = feature?.properties || {};
  return [
    feature?.id,
    props.name,
    props.NAME,
    props.NAME_EN,
    props.NAME_LONG,
    props.ADMIN,
  ]
    .map(normalizeName)
    .filter(Boolean);
}

function buildFeatureIndex(geo) {
  const byName = new Map();
  (geo?.features || []).forEach((f) => {
    featureKeys(f).forEach((key) => {
      if (key && !byName.has(key)) byName.set(key, f);
    });
  });
  return { byName };
}

function buildEntryLookup(entries) {
  const byName = new Map();
  entries.forEach((entry) => {
    const names = [
      entry.mapName,
      entry.label,
      entry.code,
      getCountryEnglishName(entry.code),
    ];
    names.map(normalizeName).filter(Boolean).forEach((n) => byName.set(n, entry));
  });
  return byName;
}

function findFeatureForEntry(entry, featureIndex) {
  const names = [entry.mapName, entry.label, entry.code];
  for (const name of names) {
    const feature = featureIndex.byName.get(normalizeName(name));
    if (feature) return feature;
  }
  return null;
}

function findEntryForFeature(feature, entryLookup) {
  for (const key of featureKeys(feature)) {
    const match = entryLookup.get(key);
    if (match) return match;
  }
  return null;
}

function estimateTextSize(text) {
  if (!measureCtx) {
    return { width: text.length * 7 + 12, height: 14 };
  }
  const metrics = measureCtx.measureText(text);
  const height = Math.max(metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent, 14);
  return { width: metrics.width + 10, height };
}

function getLabelLimit(k) {
  if (k > ZOOM_THRESHOLD_HIGH) return Infinity;
  if (k > ZOOM_THRESHOLD_MID) return LABEL_LIMIT_MID;
  return LABEL_LIMIT_BASE;
}

function lerpColor(a, b, t) {
  const mix = (ca, cb) => Math.round(ca + (cb - ca) * t);
  return {
    r: mix(a.r, b.r),
    g: mix(a.g, b.g),
    b: mix(a.b, b.b),
    a: a.a + (b.a - a.a) * t,
  };
}

function parseRgba(str) {
  const match = /rgba?\(([^)]+)\)/i.exec(str);
  if (!match) return { r: 0, g: 0, b: 0, a: 1 };
  const parts = match[1].split(",").map((p) => Number(p.trim()));
  return {
    r: parts[0] || 0,
    g: parts[1] || 0,
    b: parts[2] || 0,
    a: parts[3] ?? 1,
  };
}

const COLOR_STOPS = ["rgba(245,230,166,0.08)", "rgba(226,184,66,0.65)", "rgba(209,140,29,0.95)"].map(
  parseRgba,
);

function colorForValue(val, maxVal) {
  const clamped = Math.max(0, Math.min(1, (maxVal ? val / maxVal : 0) || 0));
  if (clamped === 0) return "rgba(255,255,255,0.03)";
  const segment = clamped < 0.5 ? [COLOR_STOPS[0], COLOR_STOPS[1], clamped * 2] : [COLOR_STOPS[1], COLOR_STOPS[2], (clamped - 0.5) * 2];
  const mixed = lerpColor(segment[0], segment[1], segment[2]);
  return `rgba(${mixed.r},${mixed.g},${mixed.b},${mixed.a.toFixed(2)})`;
}

function createLabelNodes(entries, featureIndex, path, transform) {
  const limit = getLabelLimit(transform?.k || 1);
  const sorted = entries
    .filter((e) => e.value > 0)
    .sort((a, b) => b.value - a.value || (a.label || "").localeCompare(b.label || "", "es", { sensitivity: "base" }))
    .slice(0, limit);

  const nodes = [];
  sorted.forEach((entry, idx) => {
    const feature = findFeatureForEntry(entry, featureIndex);
    if (!feature) return;
    const centroid = path.centroid(feature);
    if (!Number.isFinite(centroid[0]) || !Number.isFinite(centroid[1])) return;
    const text = `${entry.label || entry.code || entry.mapName} — ${entry.value}`;
    const size = estimateTextSize(text);
    const anchorScreen = {
      x: transform.applyX(centroid[0]),
      y: transform.applyY(centroid[1]),
    };
    nodes.push({
      key: entry.code || entry.mapName || `${entry.label}-${idx}`,
      entry,
      feature,
      text,
      anchor: { x: centroid[0], y: centroid[1] },
      anchorScreen,
      width: size.width,
      height: size.height,
      radius: Math.max(size.width / 2 + 6, 14),
      x: anchorScreen.x,
      y: anchorScreen.y,
    });
  });
  return nodes;
}

function runLabelSimulation(nodes, transform) {
  if (!nodes.length) return [];
  const bounds = {
    minX: transform.applyX(12),
    maxX: transform.applyX(VIEWBOX_WIDTH - 12),
    minY: transform.applyY(12),
    maxY: transform.applyY(VIEWBOX_HEIGHT - 12),
  };

  const forceBounds = () => {
    nodes.forEach((n) => {
      n.x = Math.max(bounds.minX, Math.min(bounds.maxX, n.x));
      n.y = Math.max(bounds.minY, Math.min(bounds.maxY, n.y));
    });
  };

  const sim = d3
    .forceSimulation(nodes)
    .force("x", d3.forceX((d) => d.anchorScreen.x).strength(0.14))
    .force("y", d3.forceY((d) => d.anchorScreen.y).strength(0.14))
    .force("collide", d3.forceCollide((d) => d.radius).iterations(2))
    .force("bounds", () => forceBounds())
    .alphaDecay(0.09)
    .stop();

  for (let i = 0; i < 120; i += 1) sim.tick();
  forceBounds();

  return nodes.map((n) => ({
    ...n,
    mapX: transform.invertX(n.x),
    mapY: transform.invertY(n.y),
  }));
}

function cleanupState(host) {
  const state = host.__geoState;
  if (!state) return;
  if (state.resizeObserver) state.resizeObserver.disconnect();
  if (typeof state.removeScrollGuards === "function") state.removeScrollGuards();
  if (state.svg) state.svg.remove();
  delete host.__geoState;
  delete host.__geoRenderToken;
  delete host.__geoCleanup;
}

function applyZoomState(state) {
  const t = state.transform || d3.zoomIdentity;
  state.root.attr("transform", `translate(${t.x},${t.y}) scale(${t.k})`);
  state.lineLayer.selectAll("line").attr("stroke-width", 1.3 / Math.max(t.k, 1));
  state.labelLayer.selectAll("text").style("font-size", `${12 / Math.max(t.k, 1)}px`);
}

function refreshLabels(state) {
  const transform = state.transform || d3.zoomIdentity;
  const nodes = runLabelSimulation(
    createLabelNodes(state.entries, state.featureIndex, state.path, transform),
    transform,
  );

  const lines = state.lineLayer.selectAll("line").data(nodes, (d) => d.key);
  lines
    .enter()
    .append("line")
    .attr("class", "geo-label-line")
    .merge(lines)
    .attr("x1", (d) => d.anchor.x)
    .attr("y1", (d) => d.anchor.y)
    .attr("x2", (d) => d.mapX)
    .attr("y2", (d) => d.mapY);
  lines.exit().remove();

  const labels = state.labelLayer.selectAll("g.geo-label").data(nodes, (d) => d.key);
  const labelsEnter = labels.enter().append("g").attr("class", "geo-label");
  labelsEnter.append("text");

  labels
    .merge(labelsEnter)
    .attr("transform", (d) => `translate(${d.mapX},${d.mapY})`)
    .each(function updateLabel(d) {
      const isLeft = d.anchor.x <= VIEWBOX_WIDTH / 2;
      const text = d3.select(this).select("text");
      text
        .attr("text-anchor", isLeft ? "start" : "end")
        .attr("dominant-baseline", "central")
        .attr("x", isLeft ? 6 : -6)
        .text(d.text);
    });
  labels.exit().remove();
}

function refreshMap(state) {
  const features = state.geo?.features || [];
  const entryLookup = buildEntryLookup(state.entries);
  state.entryLookup = entryLookup;
  const maxVal = Math.max(...state.entries.map((e) => e.value || 0), 0);

  const paths = state.countryLayer.selectAll("path").data(
    features,
    (f) => f?.id || normalizeName(f?.properties?.name) || normalizeName(f?.properties?.ADMIN),
  );

  paths
    .enter()
    .append("path")
    .attr("class", "geo-country")
    .attr("vector-effect", "non-scaling-stroke")
    .attr("d", state.path)
    .merge(paths)
    .attr("d", state.path)
    .attr("fill", (f) => {
      const match = findEntryForFeature(f, entryLookup);
      const value = Math.max(0, Number(match?.value) || 0);
      return colorForValue(value, maxVal || 1);
    })
    .attr("stroke", "rgba(255,255,255,0.18)")
    .attr("stroke-width", 0.6);

  paths.exit().remove();
  refreshLabels(state);
}

function initializeMap(host, state, geo) {
  const svg = d3
    .create("svg")
    .attr("viewBox", `0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`)
    .attr("preserveAspectRatio", "xMidYMid meet");

  const root = svg.append("g").attr("class", "geo-root");
  const countryLayer = root.append("g").attr("class", "geo-countries");
  const lineLayer = root.append("g").attr("class", "geo-lines");
  const labelLayer = root.append("g").attr("class", "geo-labels");

  const projection = d3.geoMercator().fitSize([VIEWBOX_WIDTH, VIEWBOX_HEIGHT], geo);
  const path = d3.geoPath(projection);
  const featureIndex = buildFeatureIndex(geo);

  const zoom = d3
    .zoom()
    .scaleExtent([1, 6])
    .on("zoom", (event) => {
      state.transform = event.transform;
      applyZoomState(state);
      refreshLabels(state);
    });

  svg.call(zoom);

  const resizeObserver = new ResizeObserver(() => {
    if (host.__geoRenderToken !== state.renderToken) return;
    requestAnimationFrame(() => refreshLabels(state));
  });
  resizeObserver.observe(host);

  const removeScrollGuards = preventScrollOutside(host);

  state.svg = svg;
  state.root = root;
  state.countryLayer = countryLayer;
  state.lineLayer = lineLayer;
  state.labelLayer = labelLayer;
  state.projection = projection;
  state.path = path;
  state.featureIndex = featureIndex;
  state.zoom = zoom;
  state.transform = d3.zoomIdentity;
  state.resizeObserver = resizeObserver;
  state.removeScrollGuards = removeScrollGuards;

  host.appendChild(svg.node());
  host.__geoCleanup = () => cleanupState(host);
  applyZoomState(state);
}

export async function renderCountryHeatmap(host, entries = [], options = {}) {
  if (!host) return;

  const sanitized = sanitizeEntries(entries);
  if (!sanitized.length) {
    cleanupState(host);
    host.innerHTML = `<div class="geo-empty">${options.emptyLabel || "Aún no hay países"}</div>`;
    return;
  }

  const renderToken = Symbol("geo-render");
  host.__geoRenderToken = renderToken;

  let state = host.__geoState;
  if (!state) {
    state = {};
    host.__geoState = state;
  }
  state.renderToken = renderToken;
  state.entries = sanitized;

  if (!state.ready && !host.querySelector(".geo-empty")) {
    host.innerHTML = `<div class="geo-empty">Cargando mapa…</div>`;
  }

  const geo = await loadWorldGeoJson();
  if (host.__geoRenderToken !== renderToken) return;
  if (!geo) {
    host.innerHTML = `<div class="geo-empty">No se pudo cargar el mapa mundial.</div>`;
    cleanupState(host);
    return;
  }

  const hostSize = await waitForHostSize(host, renderToken, MIN_HOST_WIDTH, MIN_HOST_HEIGHT);
  if (!hostSize || host.__geoRenderToken !== renderToken) return;

  if (!state.ready) {
    host.innerHTML = "";
    initializeMap(host, state, geo);
    state.ready = true;
  }
  state.geo = geo;
  refreshMap(state);
}

export function renderCountryList(container, stats = [], noun = "elemento") {
  if (!container) return;
  container.innerHTML = "";
  if (!stats.length) {
    container.innerHTML = `<div class="geo-empty">Sin datos todavía.</div>`;
    return;
  }
  stats.forEach((item) => {
    const row = document.createElement("div");
    row.className = "geo-list-row";
    const name = document.createElement("span");
    name.className = "geo-list-name";
    name.textContent = item.label || item.code || "País";
    const value = document.createElement("span");
    value.className = "geo-list-value";
    const count = Number(item.value) || 0;
    value.textContent = `${count} ${noun}${count === 1 ? "" : "s"}`;
    row.appendChild(name);
    row.appendChild(value);
    container.appendChild(row);
  });
}
