const ECHARTS_MODULE_SRC = "https://cdn.jsdelivr.net/npm/echarts@5/dist/echarts.esm.min.js";
const ECHARTS_PRELOAD_SELECTOR = 'link[data-bookshell-vendor="echarts"]';

let echartsModulePromise = null;

function scheduleIdleTask(task, timeout = 2400) {
  if (typeof window === "undefined") return null;
  if (typeof window.requestIdleCallback === "function") {
    return window.requestIdleCallback(task, { timeout });
  }
  return window.setTimeout(() => {
    task({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, Math.min(timeout, 900));
}

function injectModulePreload() {
  if (typeof document === "undefined") return null;
  let link = document.querySelector(ECHARTS_PRELOAD_SELECTOR);
  if (link) return link;

  link = document.createElement("link");
  link.rel = "modulepreload";
  link.href = ECHARTS_MODULE_SRC;
  link.crossOrigin = "anonymous";
  link.dataset.bookshellVendor = "echarts";
  document.head.appendChild(link);
  return link;
}

function resolveEchartsNamespace(moduleNamespace) {
  if (moduleNamespace?.init) {
    return moduleNamespace;
  }
  if (moduleNamespace?.default?.init) {
    return moduleNamespace.default;
  }
  return moduleNamespace;
}

function cacheInWindow(echartsLib) {
  if (typeof window !== "undefined" && echartsLib?.init) {
    window.echarts = echartsLib;
  }
  return echartsLib;
}

export function isEchartsReady() {
  return typeof window !== "undefined" && !!window.echarts?.init;
}

export function getEcharts() {
  if (isEchartsReady()) {
    return Promise.resolve(window.echarts);
  }

  if (echartsModulePromise) {
    return echartsModulePromise;
  }

  injectModulePreload();
  echartsModulePromise = import(ECHARTS_MODULE_SRC)
    .then((moduleNamespace) => {
      const echartsLib = resolveEchartsNamespace(moduleNamespace);
      if (!echartsLib?.init) {
        throw new Error("[vendor] ECharts no expuso una API valida");
      }
      return cacheInWindow(echartsLib);
    })
    .catch((error) => {
      echartsModulePromise = null;
      throw error;
    });

  return echartsModulePromise;
}

export function ensureEcharts() {
  return getEcharts();
}

export function warmEcharts({ idle = true } = {}) {
  if (!idle) {
    return getEcharts();
  }

  scheduleIdleTask(() => {
    void getEcharts().catch((error) => {
      console.warn("[vendor] no se pudo precargar ECharts", error);
    });
  });

  return echartsModulePromise;
}

export { ECHARTS_MODULE_SRC };
