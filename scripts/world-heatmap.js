// world-heatmap.js
import { getCountryEnglishName } from "./countries.js";

const WORLD_GEO_URLS = [
  "https://echarts.apache.org/examples/data/asset/geo/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@5/map/json/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@3.6.0/map/json/world.json",
];

let worldGeoPromise = null;

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
      } catch (_) {}
    }
    throw new Error("No se pudo cargar ningún GeoJSON del mundo");
  })().catch((err) => {
    console.warn("No se pudo cargar el GeoJSON del mundo", err);
    worldGeoPromise = null;
    return null;
  });

  return worldGeoPromise;
}

// Centros “humanos” (evita ultramar/colonias)
const CENTER_OVERRIDES = {
  FR: [2.2, 46.2],
  US: [-98.0, 39.0],
  GB: [-2.5, 54.5],
  ES: [-3.7, 40.2],
  IT: [12.5, 42.8],
  RU: [90.0, 60.0],
};

const CONTINENT_ANCHORS = {
  "Europa": [15, 54],
  "África": [20, 5],
  "Asia": [95, 35],
  "América del Norte": [-105, 45],
  "América del Sur": [-60, -15],
  "Oceanía": [145, -25],
  "Otros": [0, 0],
};

function continentFromLonLat(lon, lat) {
  // Heurística suficiente para tu caso (y mejor que nada sin dataset completo)
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

  let minX = 999, minY = 999, maxX = -999, maxY = -999;
  const walk = (a) =>
    Array.isArray(a[0])
      ? a.forEach(walk)
      : (() => {
          const x = a[0], y = a[1];
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

  if (typeof host.__geoCleanup === "function") {
    host.__geoCleanup();
    delete host.__geoCleanup;
  }

  if (!entries || entries.length === 0) {
    host.innerHTML = `<div class="geo-empty">${options.emptyLabel || "Aún no hay países"}</div>`;
    return;
  }

  const echartsLib = window?.echarts;
  if (!echartsLib) {
    host.innerHTML = `<div class="geo-empty">No se pudo cargar la librería de mapas.</div>`;
    return;
  }

  host.innerHTML = `<div class="geo-empty">Cargando mapa…</div>`;
  const geo = await loadWorldGeoJson();
  if (!geo) {
    host.innerHTML = `<div class="geo-empty">No se pudo cargar el mapa mundial.</div>`;
    return;
  }

  if (!echartsLib.getMap("world")) echartsLib.registerMap("world", geo);

  const data = (entries || []).map((e) => ({
    name: e.mapName || getCountryEnglishName(e.code) || e.label || e.code,
    value: Number(e.value) || 0,
    label: e.label || e.code,
    rawCode: (e.code || "").toUpperCase(),
  }));

  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);

  const chart = echartsLib.init(host, null, { renderer: "canvas" });

  const option = {
    backgroundColor: "transparent",
    tooltip: { show: false }, // ✅ adiós tooltip al pasar el dedo

    visualMap: {
      min: 0,
      max: maxVal,
      orient: "horizontal",
      left: "center",
      bottom: 0,
      inRange: {
        color: [
          "rgba(245,230,166,0.08)",
          "rgba(226,184,66,0.65)",
          "rgba(209,140,29,0.95)",
        ],
      },
      outOfRange: { color: "rgba(255,255,255,0.04)" },
      text: ["Más", "Menos"],
      textStyle: { color: "var(--txt, #fff)" },
    },

    geo: {
      map: "world",
      roam: true, // ✅ zoom + drag
      scaleLimit: { min: 1, max: 6 },
      itemStyle: {
        areaColor: "rgba(255,255,255,0)",
        borderColor: "rgba(255,255,255,0.18)",
        borderWidth: 0.6,
      },
      emphasis: { itemStyle: { areaColor: "rgba(226,184,66,0.35)" } },
    },

    series: [
      // 0) Mapa
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

      // 1) Línea amarilla
      {
        type: "lines",
        coordinateSystem: "geo",
        silent: true,
        symbol: ["none", "none"],
        lineStyle: { color: "rgba(245,230,166,0.95)", width: 1 },
        data: [],
        z: 10,
      },

      // 2) Etiqueta
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
            const val = Number(r.value) || 0;
            return `${name}\n${val}`;
          },
          color: "rgba(255,247,209,0.95)",
          fontSize: 11,
          fontWeight: 700,
          padding: [4, 7],
          borderRadius: 10,
          backgroundColor: "rgba(10,12,18,0.65)",
        },
        labelLayout: { hideOverlap: true, moveOverlap: "shiftY" },
        data: [],
        z: 11,
      },
    ],
  };

  chart.setOption(option);

  // ✅ arregla el “width 100px” cuando se inicializa oculto
  host.__geoChart = chart;
  requestAnimationFrame(() => chart.resize());

  const ro = new ResizeObserver(() => chart.resize());
  ro.observe(host);

  const onWinResize = () => chart.resize();
  window.addEventListener("resize", onWinResize);

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
        // Modo continentes (agrega y evita solapes)
        const agg = new Map();

        for (const d of data) {
          if (!d.value) continue;
          const center = CENTER_OVERRIDES[d.rawCode] || featureCenterByName(echartsLib, d.name);
          if (!center) continue;
          const cont = continentFromLonLat(center[0], center[1]);
          agg.set(cont, (agg.get(cont) || 0) + d.value);
        }

        for (const [cont, value] of agg.entries()) {
          const fromGeo = CONTINENT_ANCHORS[cont] || CONTINENT_ANCHORS["Otros"];
          const fromPx = chart.convertToPixel({ geoIndex: 0 }, fromGeo);
          if (!fromPx) continue;

          if (
            fromPx[0] < -margin || fromPx[0] > w + margin ||
            fromPx[1] < -margin || fromPx[1] > h + margin
          ) continue;

          const dir = fromPx[0] < w * 0.5 ? 1 : -1;
          const toPx = [fromPx[0] + dir * 44, fromPx[1] - 18];
          const toGeo = chart.convertFromPixel({ geoIndex: 0 }, toPx);
          if (!toGeo) continue;

          lines.push({ coords: [fromGeo, toGeo] });
          points.push({ value: [toGeo[0], toGeo[1], value], raw: { label: cont, value } });
        }
      } else {
        // Modo países (con filtro viewport + línea siempre pegada)
        for (const d of data) {
          if (!d.value) continue;

          const fromGeo = CENTER_OVERRIDES[d.rawCode] || featureCenterByName(echartsLib, d.name);
          if (!fromGeo) continue;

          const fromPx = chart.convertToPixel({ geoIndex: 0 }, fromGeo);
          if (!fromPx) continue;

          // ✅ si el país no está en pantalla: fuera etiqueta (adiós USA fantasma)
          if (
            fromPx[0] < -margin || fromPx[0] > w + margin ||
            fromPx[1] < -margin || fromPx[1] > h + margin
          ) continue;

          const dir = fromPx[0] < w * 0.5 ? 1 : -1;
          const toPx = [fromPx[0] + dir * 44, fromPx[1] - 18];
          const toGeo = chart.convertFromPixel({ geoIndex: 0 }, toPx);
          if (!toGeo) continue;

          lines.push({ coords: [fromGeo, toGeo] });
          points.push({
            value: [toGeo[0], toGeo[1], d.value],
            raw: { name: d.name, label: d.label || d.name, value: d.value },
          });
        }
      }

      chart.setOption({
        series: [
          {},              // map
          { data: lines }, // lines
          { data: points } // labels
        ],
      });
    });
  }

  updateCallouts();
  chart.on("georoam", updateCallouts);

  host.__geoCleanup = () => {
    window.removeEventListener("resize", onWinResize);
    ro.disconnect();
    try { chart.dispose(); } catch (_) {}
    delete host.__geoChart;
  };
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
