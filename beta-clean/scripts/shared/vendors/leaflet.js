const LEAFLET_CSS_ID = "bookshell-leaflet-css";
const LEAFLET_SCRIPT_ID = "bookshell-leaflet-script";
const LEAFLET_CSS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS_URL = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

export const DEFAULT_MAP_CENTER_SPAIN = Object.freeze([40.4168, -3.7038]);
export const DEFAULT_MAP_ZOOM_SPAIN = 5;
export const MAX_AUTO_ZOOM = 8;
export const SINGLE_POINT_AUTO_ZOOM = 9;

let leafletPromise = null;

function ensureLeafletCss() {
  if (document.getElementById(LEAFLET_CSS_ID)) return;
  const css = document.createElement("link");
  css.id = LEAFLET_CSS_ID;
  css.rel = "stylesheet";
  css.href = LEAFLET_CSS_URL;
  document.head.appendChild(css);
}

function normalizeCenter(center = DEFAULT_MAP_CENTER_SPAIN) {
  if (!Array.isArray(center) || center.length < 2) {
    return [...DEFAULT_MAP_CENTER_SPAIN];
  }
  const lat = Number(center[0]);
  const lng = Number(center[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return [...DEFAULT_MAP_CENTER_SPAIN];
  }
  return [lat, lng];
}

export function normalizeLeafletPoints(points = []) {
  return (Array.isArray(points) ? points : [])
    .map((point) => {
      const lat = Number(point?.lat ?? point?.coords?.lat ?? point?.[0]);
      const lng = Number(point?.lng ?? point?.lon ?? point?.coords?.lng ?? point?.[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { ...point, lat, lng };
    })
    .filter(Boolean);
}

export async function ensureLeaflet() {
  if (window.L?.map) return window.L;
  if (!leafletPromise) {
    leafletPromise = new Promise((resolve, reject) => {
      ensureLeafletCss();
      const existingScript = document.getElementById(LEAFLET_SCRIPT_ID);
      if (existingScript) {
        existingScript.addEventListener("load", () => resolve(window.L), { once: true });
        existingScript.addEventListener("error", () => reject(new Error("No se pudo cargar Leaflet.")), { once: true });
        return;
      }

      const script = document.createElement("script");
      script.id = LEAFLET_SCRIPT_ID;
      script.src = LEAFLET_JS_URL;
      script.onload = () => resolve(window.L);
      script.onerror = () => {
        leafletPromise = null;
        reject(new Error("No se pudo cargar Leaflet."));
      };
      document.body.appendChild(script);
    });
  }
  return leafletPromise;
}

export function destroyLeafletMap(host) {
  if (!host) return;
  const map = host.__leafletMap;
  if (map?.remove) {
    try {
      map.off();
      map.remove();
    } catch (_) {}
  }
  delete host.__leafletMap;
  delete host.__leafletLayer;
}

export function createLeafletMap(host, {
  center = DEFAULT_MAP_CENTER_SPAIN,
  zoom = DEFAULT_MAP_ZOOM_SPAIN,
  maxZoom = 19,
  tileLayerOptions = {},
} = {}) {
  if (!host || !window.L?.map) return null;
  destroyLeafletMap(host);
  host.innerHTML = "";

  const map = window.L.map(host, {
    zoomControl: true,
    worldCopyJump: true,
  });

  const layer = window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom,
    attribution: "&copy; OpenStreetMap",
    ...tileLayerOptions,
  });
  layer.addTo(map);

  host.__leafletMap = map;
  host.__leafletLayer = layer;
  map.setView(normalizeCenter(center), Number(zoom) || DEFAULT_MAP_ZOOM_SPAIN);
  return map;
}

export function setLeafletViewForPoints(map, points = [], {
  defaultCenter = DEFAULT_MAP_CENTER_SPAIN,
  defaultZoom = DEFAULT_MAP_ZOOM_SPAIN,
  maxAutoZoom = MAX_AUTO_ZOOM,
  singlePointZoom = SINGLE_POINT_AUTO_ZOOM,
  padding = [24, 24],
} = {}) {
  if (!map?.setView) return { mode: "none", points: 0 };

  const safePoints = normalizeLeafletPoints(points);
  if (!safePoints.length) {
    map.setView(normalizeCenter(defaultCenter), Number(defaultZoom) || DEFAULT_MAP_ZOOM_SPAIN);
    return { mode: "default", points: 0 };
  }

  if (safePoints.length === 1) {
    map.setView(
      [safePoints[0].lat, safePoints[0].lng],
      Math.min(Number(singlePointZoom) || SINGLE_POINT_AUTO_ZOOM, Number(maxAutoZoom) || MAX_AUTO_ZOOM),
    );
    return { mode: "single", points: 1 };
  }

  const bounds = window.L.latLngBounds(safePoints.map((point) => [point.lat, point.lng]));
  map.fitBounds(bounds, { padding });
  const safeMaxZoom = Number(maxAutoZoom) || MAX_AUTO_ZOOM;
  if (map.getZoom() > safeMaxZoom) {
    map.setZoom(safeMaxZoom);
  }
  return { mode: "bounds", points: safePoints.length };
}

export function invalidateLeafletMap(map, delay = 50) {
  if (!map?.invalidateSize) return;
  window.setTimeout(() => {
    try {
      map.invalidateSize();
    } catch (_) {}
  }, Math.max(0, Number(delay) || 0));
}
