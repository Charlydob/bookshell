// world-heatmap.js
import { getCountryEnglishName } from "./countries.js";
import { ensureEcharts } from "../../shared/vendors/echarts.js";

const LOCAL_WORLD_GEO_URL = new URL("../../../assets/geo/world.json", import.meta.url);

export const REGIONAL_MAP_ASSETS = {
  ES: new URL("../../../assets/geo/regions/ES.json", import.meta.url).href,
  CH: new URL("../../../assets/geo/regions/CH.json", import.meta.url).href,
  BR: new URL("../../../assets/geo/regions/BR.json", import.meta.url).href,
  US: new URL("../../../assets/geo/regions/US.json", import.meta.url).href,
};

let worldGeoPromise = null;
const regionalGeoPromises = new Map();

async function fetchJson(url) {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`GeoJSON status ${res.status} @ ${url}`);
  return res.json();
}

function loadWorldGeoJson() {
  if (worldGeoPromise) return worldGeoPromise;

  worldGeoPromise = fetchJson(LOCAL_WORLD_GEO_URL).catch((err) => {
    console.warn("No se pudo cargar el GeoJSON local del mundo", err);
    worldGeoPromise = null;
    return null;
  });

  return worldGeoPromise;
}

function loadRegionalGeoJson(countryCode) {
  const code = String(countryCode || "").trim().toUpperCase();
  const url = REGIONAL_MAP_ASSETS[code];
  if (!url) return Promise.resolve(null);
  if (regionalGeoPromises.has(code)) return regionalGeoPromises.get(code);
  const promise = fetchJson(url).catch((err) => {
    console.info(`Mapa regional no disponible para ${code}`, err);
    regionalGeoPromises.delete(code);
    return null;
  });
  regionalGeoPromises.set(code, promise);
  return promise;
}

function featureRegionId(feature = {}) {
  const p = feature.properties || {};
  return String(p.id || p.ID || p.iso_3166_2 || p["ISO3166-2"] || p.ISO_3166_2 || p.HASC_1 || p.code || p.CODE || p.name || p.NAME || "").trim();
}

function featureRegionName(feature = {}) {
  const p = feature.properties || {};
  return String(p.name || p.NAME || p.Name || p.nom || p.NOM || p.region || p.REGION || featureRegionId(feature)).trim();
}

const CENTER_OVERRIDES = {
  FR: [2.2, 46.2],
  US: [-98.0, 39.0],
  GB: [-2.5, 54.5],
  ES: [-3.7, 40.2],
  IT: [12.5, 42.8],
  RU: [90.0, 60.0],
};

const CONTINENT_ANCHORS = {
  Europa: [15, 54],
  África: [20, 5],
  Asia: [95, 35],
  "América del Norte": [-105, 45],
  "América del Sur": [-60, -15],
  Oceanía: [145, -25],
  Otros: [0, 0],
};

function continentFromLonLat(lon, lat) {
  if (lat < -10 && lon >= -90 && lon <= -30) return "América del Sur";
  if (lat >= -10 && lat <= 70 && lon >= -170 && lon <= -30) return "América del Norte";
  if (lat >= 35 && lon >= -25 && lon <= 60) return "Europa";
  if (lat >= -40 && lat < 35 && lon >= -20 && lon <= 60) return "África";
  if (lat >= 0 && lon > 60 && lon <= 180) return "Asia";
  if (lat < 0 && lon > 110 && lon <= 180) return "Oceanía";
  return "Otros";
}

function featureCenterByName(echartsLib, name) {
  const geoJson = echartsLib.getMap("world")?.geoJson;
  const f = geoJson?.features?.find((x) => x?.properties?.name === name);
  if (!f) return null;

  const cp = f?.properties?.cp;
  if (Array.isArray(cp) && cp.length === 2) return cp;

  const coords = f?.geometry?.coordinates;
  if (!coords) return null;

  let minX = 999;
  let minY = 999;
  let maxX = -999;
  let maxY = -999;
  const walk = (a) =>
    Array.isArray(a[0])
      ? a.forEach(walk)
      : (() => {
          const x = a[0];
          const y = a[1];
          if (typeof x !== "number" || typeof y !== "number") return;
          minX = Math.min(minX, x);
          maxX = Math.max(maxX, x);
          minY = Math.min(minY, y);
          maxY = Math.max(maxY, y);
        })();
  walk(coords);

  if (minX === 999) return null;
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

export async function renderCountryHeatmap(host, entries = [], options = {}) {
  if (!host) return;

  if (!entries || entries.length === 0) {
    if (typeof host.__geoCleanup === "function") {
      host.__geoCleanup();
      delete host.__geoCleanup;
    }
    host.innerHTML = `<div class="geo-empty">${options.emptyLabel || "Aún no hay países"}</div>`;
    return;
  }

  const echartsLib = await ensureEcharts();
  if (!echartsLib) {
    if (typeof host.__geoCleanup === "function") {
      host.__geoCleanup();
      delete host.__geoCleanup;
    }
    host.innerHTML = `<div class="geo-empty">No se pudo cargar la librería de mapas.</div>`;
    return;
  }

  if (!host.__geoChart) {
    host.innerHTML = `<div class="geo-empty">Cargando mapa…</div>`;
  }

  const geo = await loadWorldGeoJson();
  if (!geo) {
    if (typeof host.__geoCleanup === "function") {
      host.__geoCleanup();
      delete host.__geoCleanup;
    }
    host.innerHTML = `<div class="geo-empty">No se pudo cargar el mapa mundial.</div>`;
    return;
  }

  if (!echartsLib.getMap("world")) echartsLib.registerMap("world", geo);

  const data = (entries || []).map((e) => ({
    name: e.mapName || getCountryEnglishName(e.code) || e.label || e.code,
    value: Number(e.value) || 0,
    label: e.label || e.code,
    rawCode: (e.code || "").toUpperCase(),
    rawValue: Number(e.rawValue ?? e.days ?? e.value) || 0,
  }));
  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);
  const showTooltip = options.showTooltip !== false;
  const tooltipNoun = String(options.tooltipNoun || "elementos").trim() || "elementos";

  let chart = host.__geoChart;
  if (!chart || chart.isDisposed?.()) {
    host.innerHTML = "";
    chart = echartsLib.getInstanceByDom(host) || echartsLib.init(host, null, { renderer: "canvas" });
  }

  const option = {
    backgroundColor: "transparent",
    tooltip: showTooltip ? {
      trigger: "item",
      confine: true,
      appendToBody: false,
      backgroundColor: "rgba(8, 12, 20, 0.94)",
      borderColor: "rgba(255,255,255,0.12)",
      borderWidth: 1,
      textStyle: {
        color: "#f6f9ff",
        fontSize: 12,
      },
      formatter: (params = {}) => {
        const raw = params?.data || {};
        const label = raw.label || params?.name || "País";
        const value = Number(raw.rawValue ?? raw.value ?? 0);
        const suffix = value === 1 ? tooltipNoun.replace(/s$/u, "") : tooltipNoun;
        return `${label}<br/>${value} ${suffix}`;
      },
    } : { show: false },
    visualMap: {
      min: 0,
      max: maxVal,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      seriesIndex: [0],
      inRange: {
        color: options.palette || [
          "rgba(56,147,255,0.42)",
          "rgba(80,196,255,0.72)",
          "rgba(255,229,92,0.96)",
        ],
      },
      outOfRange: { color: "rgba(255,255,255,0.04)" },
      text: ["Más", "Menos"],
      textStyle: { color: "var(--txt, #fff)" },
    },
    geo: {
      map: "world",
      roam: true,
      scaleLimit: { min: 1, max: 6 },
      itemStyle: {
        areaColor: "rgba(255,255,255,0)",
        borderColor: "rgba(255,255,255,0.18)",
        borderWidth: 0.6,
      },
      emphasis: { itemStyle: { areaColor: "rgba(226,184,66,0.35)" } },
    },
    series: [
      {
        type: "map",
        map: "world",
        geoIndex: 0,
        roam: false,
        nameProperty: "name",
        emphasis: { label: { show: false } },
        select: { disabled: true },
        data,
      },
      {
        type: "lines",
        coordinateSystem: "geo",
        silent: true,
        symbol: ["none", "none"],
        lineStyle: { color: "rgba(245,230,166,0.34)", width: 0.6 },
        data: [],
        z: 10,
      },
      {
        type: "scatter",
        coordinateSystem: "geo",
        silent: true,
        symbolSize: 2,
        itemStyle: { color: "rgba(245,230,166,0.95)" },
        label: {
          show: true,
          formatter: (p) => {
            const r = p?.data?.raw || {};
            const name = r.label || r.name || "—";
            const val = Number(r.rawValue ?? r.value) || 0;
            return `${name}\n${val}`;
          },
          color: "rgba(255,247,209,0.95)",
          fontSize: 7,
          fontWeight: 600,
          padding: [2, 4],
          borderRadius: 10,
          backgroundColor: "rgba(10, 12, 18, 0.10)",
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
        data: [],
        z: 11,
      },
    ],
  };

  chart.setOption(option);
  if (showTooltip === false) chart.dispatchAction?.({ type:"hideTip" });
  host.__geoChart = chart;

  if (host.__geoClickHandler) chart.off("click", host.__geoClickHandler);
  host.__geoClickHandler = null;
  if (typeof options.onCountryClick === "function") {
    host.__geoClickHandler = (params = {}) => {
      const raw = params?.data || {};
      if (!raw.rawCode && !raw.label) return;
      options.onCountryClick({ code: raw.rawCode || "", label: raw.label || params.name || "", value: raw.rawValue ?? raw.value ?? 0, name: params.name || raw.name || "" });
    };
    chart.on("click", host.__geoClickHandler);
  }
  requestAnimationFrame(() => chart.resize());

  if (!host.__geoResizeObserver) {
    const ro = new ResizeObserver(() => host.__geoChart?.resize?.());
    ro.observe(host);
    host.__geoResizeObserver = ro;
  }

  if (!host.__geoWindowResize) {
    host.__geoWindowResize = () => host.__geoChart?.resize?.();
    window.addEventListener("resize", host.__geoWindowResize);
  }

  let raf = 0;
  function updateCallouts() {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const zoom = chart.getOption()?.geo?.[0]?.zoom || 1;
      const countryMode = zoom >= 1.6;
      const w = chart.getWidth();
      const h = chart.getHeight();
      const margin = 20;
      const lines = [];
      const points = [];

      if (!countryMode) {
        const agg = new Map();

        for (const d of data) {
          if (!d.value) continue;
          const center = CENTER_OVERRIDES[d.rawCode] || featureCenterByName(echartsLib, d.name);
          if (!center) continue;
          const cont = continentFromLonLat(center[0], center[1]);
          agg.set(cont, (agg.get(cont) || 0) + (Number(d.rawValue ?? d.value) || 0));
        }

        for (const [cont, value] of agg.entries()) {
          const fromGeo = CONTINENT_ANCHORS[cont] || CONTINENT_ANCHORS.Otros;
          const fromPx = chart.convertToPixel({ geoIndex: 0 }, fromGeo);
          if (!fromPx) continue;
          if (
            fromPx[0] < -margin || fromPx[0] > w + margin ||
            fromPx[1] < -margin || fromPx[1] > h + margin
          ) continue;

          const dir = fromPx[0] < w * 0.5 ? 1 : -1;
          const toPx = [fromPx[0] + dir * 24, fromPx[1] - 14];
          const toGeo = chart.convertFromPixel({ geoIndex: 0 }, toPx);
          if (!toGeo) continue;

          lines.push({ coords: [fromGeo, toGeo] });
          points.push({ value: [toGeo[0], toGeo[1], value], raw: { label: cont, value } });
        }
      } else {
        for (const d of data) {
          if (!d.value) continue;

          const fromGeo = CENTER_OVERRIDES[d.rawCode] || featureCenterByName(echartsLib, d.name);
          if (!fromGeo) continue;

          const fromPx = chart.convertToPixel({ geoIndex: 0 }, fromGeo);
          if (!fromPx) continue;
          if (
            fromPx[0] < -margin || fromPx[0] > w + margin ||
            fromPx[1] < -margin || fromPx[1] > h + margin
          ) continue;

          const dir = fromPx[0] < w * 0.5 ? 1 : -1;
          const toPx = [fromPx[0] + dir * 24, fromPx[1] - 14];
          const toGeo = chart.convertFromPixel({ geoIndex: 0 }, toPx);
          if (!toGeo) continue;

          lines.push({ coords: [fromGeo, toGeo] });
          points.push({
            value: [toGeo[0], toGeo[1], d.value],
            raw: { name: d.name, label: d.label || d.name, value: d.value, rawValue: d.rawValue },
          });
        }
      }

      chart.setOption({
        series: [{}, { data: lines }, { data: points }],
      });
    });
  }

  if (host.__geoUpdateCallouts) {
    chart.off("georoam", host.__geoUpdateCallouts);
  }
  if (options.showCallouts === true) {
    updateCallouts();
    host.__geoUpdateCallouts = updateCallouts;
    chart.on("georoam", updateCallouts);
  } else {
    chart.setOption({ series: [{}, { data: [] }, { data: [] }] });
  }

  host.__geoCleanup = () => {
    if (host.__geoWindowResize) {
      window.removeEventListener("resize", host.__geoWindowResize);
      delete host.__geoWindowResize;
    }
    if (host.__geoResizeObserver) {
      host.__geoResizeObserver.disconnect();
      delete host.__geoResizeObserver;
    }
    if (host.__geoUpdateCallouts) {
      chart.off("georoam", host.__geoUpdateCallouts);
      delete host.__geoUpdateCallouts;
    }
    if (host.__geoClickHandler) {
      chart.off("click", host.__geoClickHandler);
      delete host.__geoClickHandler;
    }
    try { chart.dispose(); } catch (_) {}
    delete host.__geoChart;
  };
}

export async function renderRegionHeatmap(host, countryCode, entries = [], options = {}) {
  if (!host) return false;
  const code = String(countryCode || "").trim().toUpperCase();
  const echartsLib = await ensureEcharts();
  const geo = echartsLib ? await loadRegionalGeoJson(code) : null;
  if (!echartsLib || !geo?.features?.length) {
    if (typeof host.__geoCleanup === "function") {
      host.__geoCleanup();
      delete host.__geoCleanup;
    }
    host.innerHTML = `<div class="world-stay-regional-fallback"><p>Mapa regional no disponible para este país</p></div>`;
    return false;
  }

  const mapName = `regions-${code}`;
  if (!echartsLib.getMap(mapName)) echartsLib.registerMap(mapName, geo);
  const byId = new Map((entries || []).map((e) => [String(e.code || e.key || "").toUpperCase(), e]));
  const byName = new Map((entries || []).map((e) => [String(e.label || e.region || "").toLocaleLowerCase("es"), e]));
  const data = geo.features.map((feature) => {
    const id = featureRegionId(feature);
    const name = featureRegionName(feature);
    const entry = byId.get(id.toUpperCase()) || byName.get(name.toLocaleLowerCase("es")) || {};
    return { name, value:Number(entry.value) || 0, rawValue:Number(entry.rawValue ?? entry.days ?? 0) || 0, label:entry.label || name };
  });
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  let chart = host.__geoChart;
  if (!chart || chart.isDisposed?.()) {
    host.innerHTML = "";
    chart = echartsLib.getInstanceByDom(host) || echartsLib.init(host, null, { renderer:"canvas" });
  }
  chart.setOption({
    backgroundColor:"transparent",
    tooltip:{ show:false },
    visualMap:{ min:0, max:maxVal, show:false, inRange:{ color:options.palette || ["rgba(56,147,255,0.42)", "rgba(80,196,255,0.72)", "rgba(255,229,92,0.96)"] }, outOfRange:{ color:"rgba(255,255,255,0.05)" } },
    series:[{ type:"map", map:mapName, roam:true, nameProperty:"name", selectedMode:false, select:{ disabled:true }, emphasis:{ label:{ show:false }, itemStyle:{ areaColor:"rgba(226,184,66,0.32)" } }, itemStyle:{ borderColor:"rgba(255,255,255,0.22)", borderWidth:.7 }, data }]
  }, true);
  chart.dispatchAction?.({ type:"hideTip" });
  host.__geoChart = chart;
  requestAnimationFrame(() => chart.resize());
  if (!host.__geoResizeObserver) {
    const ro = new ResizeObserver(() => host.__geoChart?.resize?.());
    ro.observe(host);
    host.__geoResizeObserver = ro;
  }
  host.__geoCleanup = () => { host.__geoResizeObserver?.disconnect?.(); chart.dispose?.(); delete host.__geoChart; delete host.__geoResizeObserver; };
  return true;
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
