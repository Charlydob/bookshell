// world-heatmap.js
import { getCountryEnglishName } from "./countries.js";

const WORLD_GEO_URLS = [
  "https://echarts.apache.org/examples/data/asset/geo/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@5/map/json/world.json",
  "https://cdn.jsdelivr.net/npm/echarts@3.6.0/map/json/world.json"
];

let worldGeoPromise = null;
const MIN_HOST_WIDTH = 200;
const MIN_HOST_HEIGHT = 200;

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

  const renderToken = Symbol("geo-render");
  host.__geoRenderToken = renderToken;
  host.innerHTML = "<div class=\"geo-empty\">Cargando mapa…</div>";
  const geo = await loadWorldGeoJson();
  if (!geo) {
    host.innerHTML = `<div class="geo-empty">No se pudo cargar el mapa mundial.</div>`;
    delete host.__geoRenderToken;
    return;
  }
  if (host.__geoRenderToken !== renderToken) return;

  if (!echartsLib.getMap("world")) {
    echartsLib.registerMap("world", geo);
  }

  const data = (entries || []).map((entry) => ({
    name: entry.mapName || getCountryEnglishName(entry.code) || entry.label || entry.code,
    value: entry.value,
    label: entry.label || entry.code,
  }));

  const maxVal = Math.max(...data.map((d) => Number(d.value) || 0), 1);

  const hostSize = await waitForHostSize(host, renderToken);
  if (!hostSize || host.__geoRenderToken !== renderToken) {
    delete host.__geoRenderToken;
    return;
  }

  const chart = echartsLib.init(host, null, { renderer: "svg" });
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
        roam: true,
        scaleLimit: { min: 1, max: 6 },
        left: 0,
        right: 0,
        top: 0,
        bottom: 0,
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
  chart.resize({ width: hostSize.width, height: hostSize.height });

  const resize = () => {
    if (host.__geoRenderToken !== renderToken) return;
    const rect = host.getBoundingClientRect();
    if (rect.width >= 40 && rect.height >= 40) {
      chart.resize();
    }
  };
  let resizeObserver = null;
  if (typeof ResizeObserver === "function") {
    resizeObserver = new ResizeObserver(() => requestAnimationFrame(resize));
    resizeObserver.observe(host);
  }
  window.addEventListener("resize", resize);
  const removeScrollGuards = preventScrollOutside(host);
  host.__geoCleanup = () => {
    window.removeEventListener("resize", resize);
    if (resizeObserver) resizeObserver.disconnect();
    removeScrollGuards();
    chart.dispose();
    if (host.__geoRenderToken === renderToken) delete host.__geoRenderToken;
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
