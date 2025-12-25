// world-heatmap.js
import { getCountryEnglishName } from "./countries.js";

const WORLD_GEO_URLS = [
  "https://echarts.apache.org/examples/data/asset/geo/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@5/map/json/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@3.6.0/map/json/world.json"
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
      } catch (e) {
        // prueba la siguiente
      }
    }
    throw new Error("No se pudo cargar ningún GeoJSON del mundo");
  })()
    .catch((err) => {
      console.warn("No se pudo cargar el GeoJSON del mundo", err);
      worldGeoPromise = null;
      return null;
    });

  return worldGeoPromise;
}


function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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

  host.innerHTML = "<div class=\"geo-empty\">Cargando mapa…</div>";
  const geo = await loadWorldGeoJson();
  if (!geo) {
    host.innerHTML = `<div class="geo-empty">No se pudo cargar el mapa mundial.</div>`;
    return;
  }

  if (!echartsLib.getMap("world")) {
    echartsLib.registerMap("world", geo);
  }

  const data = (entries || []).map((entry) => ({
    name: entry.mapName || getCountryEnglishName(entry.code) || entry.label || entry.code,
    value: entry.value,
    label: entry.label || entry.code,
  }));

  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);

  const chart = echartsLib.init(host, null, { renderer: "canvas" });
  const option = {
    backgroundColor: "transparent",
    tooltip: {
      trigger: "item",
      formatter: (params) => {
        const label = params?.data?.label || params.name || "País";
        const val = typeof params.value === "number" ? params.value : 0;
        return `${escapeHtml(label)}: ${val}`;
      },
    },
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
    series: [
      {
        type: "map",
        map: "world",
        nameProperty: "name",
        roam: false,
        itemStyle: {
          areaColor: "rgba(255,255,255,0)",
          borderColor: "rgba(255,255,255,0.18)",
          borderWidth: 0.6,
        },
        emphasis: {
          disabled: false,
          label: { show: false },
          itemStyle: { areaColor: "rgba(226,184,66,0.35)" },
        },
        select: { disabled: true },
        data,
      },
    ],
  };

  chart.setOption(option);

  const resize = () => chart.resize();
  window.addEventListener("resize", resize);
  host.__geoCleanup = () => {
    window.removeEventListener("resize", resize);
    chart.dispose();
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
