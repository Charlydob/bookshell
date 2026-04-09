import { get, ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { readModuleSnapshot } from "../../shared/storage/offline-snapshots.js";
import { getOfflineQueueSummary } from "../../shared/storage/offline-queue.js";

const PERF_STORE_KEY = "__bookshellPerfMetrics";
const PERF_HISTORY_KEY = "__bookshellPerfHistory";

// Pesos estables y legibles para el score global.
const CATEGORY_WEIGHTS = Object.freeze({
  load: 0.25,
  interaction: 0.2,
  render: 0.2,
  data: 0.2,
  stability: 0.15,
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function round(value, digits = 0) {
  const factor = 10 ** Math.max(0, digits);
  return Math.round((Number(value) || 0) * factor) / factor;
}

function average(values = []) {
  const safe = values.filter((value) => Number.isFinite(value));
  if (!safe.length) return null;
  return safe.reduce((sum, value) => sum + value, 0) / safe.length;
}

function lowerIsBetterScore(value, good, poor) {
  if (!Number.isFinite(value)) return null;
  if (value <= good) return 100;
  if (value >= poor) return 0;
  const progress = (value - good) / (poor - good);
  return clamp(Math.round(100 - (progress * 100)), 0, 100);
}

function countScore(value, good, poor) {
  return lowerIsBetterScore(Number(value) || 0, good, poor);
}

function formatMs(value) {
  if (!Number.isFinite(value)) return "--";
  return `${round(value)} ms`;
}

function formatKb(value) {
  if (!Number.isFinite(value)) return "--";
  return `${round(value)} KB`;
}

function getPerfStore() {
  return window[PERF_STORE_KEY] && typeof window[PERF_STORE_KEY] === "object"
    ? window[PERF_STORE_KEY]
    : { boot: {}, views: {} };
}

function getNavigationEntry() {
  const entries = performance.getEntriesByType("navigation");
  return entries?.[0] || null;
}

function getPaintEntries() {
  const map = new Map();
  performance.getEntriesByType("paint").forEach((entry) => {
    map.set(entry.name, entry.startTime);
  });
  return map;
}

function getResourceMetrics() {
  const resources = performance
    .getEntriesByType("resource")
    .filter((entry) => entry && typeof entry.name === "string");

  const relevant = resources.filter((entry) => {
    try {
      const url = new URL(entry.name, window.location.href);
      return url.origin === window.location.origin
        || url.host === "www.gstatic.com"
        || url.host === "cdn.jsdelivr.net"
        || url.host === "echarts.apache.org";
    } catch (_) {
      return false;
    }
  });

  const transferSize = relevant.reduce((sum, entry) => {
    const size = Number(entry.transferSize || entry.encodedBodySize || entry.decodedBodySize || 0);
    return sum + Math.max(0, size);
  }, 0);

  return {
    count: relevant.length,
    transferKb: round(transferSize / 1024, 1),
  };
}

function createLongTaskCollector() {
  if (typeof PerformanceObserver !== "function") {
    return {
      stop: () => ({ count: 0, totalMs: 0, maxMs: 0 }),
    };
  }

  const supportsLongTask = PerformanceObserver.supportedEntryTypes?.includes("longtask");
  if (!supportsLongTask) {
    return {
      stop: () => ({ count: 0, totalMs: 0, maxMs: 0 }),
    };
  }

  let count = 0;
  let totalMs = 0;
  let maxMs = 0;
  let stopped = false;
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => {
      const duration = Math.max(0, Number(entry.duration) || 0);
      count += 1;
      totalMs += duration;
      maxMs = Math.max(maxMs, duration);
    });
  });

  observer.observe({ entryTypes: ["longtask"] });
  return {
    stop: () => {
      if (stopped) {
        return {
          count,
          totalMs: round(totalMs),
          maxMs: round(maxMs),
        };
      }
      stopped = true;
      observer.disconnect();
      return {
        count,
        totalMs: round(totalMs),
        maxMs: round(maxMs),
      };
    },
  };
}

async function sampleMetric(fn, iterations = 2) {
  if (typeof fn !== "function") return null;
  const values = [];
  for (let index = 0; index < iterations; index += 1) {
    const value = Number(await fn());
    if (Number.isFinite(value) && value >= 0) {
      values.push(value);
    }
  }
  const value = average(values);
  return Number.isFinite(value) ? round(value) : null;
}

async function measureAsync(label, fn) {
  const startedAt = performance.now();
  const value = await fn();
  return {
    label,
    value,
    durationMs: round(performance.now() - startedAt),
  };
}

async function measureRemoteRead(db, uid) {
  if (!db || !uid || navigator.onLine === false) {
    return { latencyMs: null, available: false };
  }

  try {
    const startedAt = performance.now();
    await get(ref(db, `v2/users/${uid}/meta/ui/navLayout`));
    return {
      latencyMs: round(performance.now() - startedAt),
      available: true,
    };
  } catch (_) {
    return {
      latencyMs: null,
      available: false,
    };
  }
}

function buildLoadCategory(metrics) {
  const score = average([
    lowerIsBetterScore(metrics.initialLoadMs, 1400, 4200),
    lowerIsBetterScore(metrics.firstContentfulPaintMs, 1000, 3000),
    lowerIsBetterScore(metrics.currentShellLoadMs, 120, 420),
    lowerIsBetterScore(metrics.resourceTransferKb, 350, 1300),
  ]);

  return {
    key: "load",
    label: "Carga inicial",
    score: round(score ?? 0),
    summary: `Boot ${formatMs(metrics.initialLoadMs)} - FCP ${formatMs(metrics.firstContentfulPaintMs)} - recursos ${formatKb(metrics.resourceTransferKb)}`,
  };
}

function buildInteractionCategory(metrics) {
  const score = average([
    lowerIsBetterScore(metrics.modalOpenMs, 90, 260),
    lowerIsBetterScore(metrics.currentViewShowMs, 140, 480),
    lowerIsBetterScore(metrics.inputDelayHintMs, 50, 180),
  ]);

  return {
    key: "interaction",
    label: "Interaccion",
    score: round(score ?? 0),
    summary: `Modal ${formatMs(metrics.modalOpenMs)} - cambio de vista ${formatMs(metrics.currentViewShowMs)}`,
  };
}

function buildRenderCategory(metrics) {
  const score = average([
    lowerIsBetterScore(metrics.mainRenderMs, 60, 220),
    lowerIsBetterScore(metrics.statsRenderMs, 120, 420),
    lowerIsBetterScore(metrics.currentModuleInitMs, 160, 650),
  ]);

  return {
    key: "render",
    label: "Render/UI",
    score: round(score ?? 0),
    summary: `Lista ${formatMs(metrics.mainRenderMs)} - panel stats ${formatMs(metrics.statsRenderMs)} - init ${formatMs(metrics.currentModuleInitMs)}`,
  };
}

function buildDataCategory(metrics) {
  const score = average([
    lowerIsBetterScore(metrics.snapshotReadMs, 12, 90),
    lowerIsBetterScore(metrics.queueReadMs, 8, 45),
    lowerIsBetterScore(metrics.remoteReadMs, 140, 750),
  ]);

  return {
    key: "data",
    label: "Datos",
    score: round(score ?? 0),
    summary: `Snapshot ${formatMs(metrics.snapshotReadMs)} - cola ${formatMs(metrics.queueReadMs)} - RTDB ${formatMs(metrics.remoteReadMs)}`,
  };
}

function buildStabilityCategory(metrics) {
  const score = average([
    countScore(metrics.longTaskCount, 0, 4),
    lowerIsBetterScore(metrics.longTaskTotalMs, 20, 260),
    lowerIsBetterScore(metrics.maxLongTaskMs, 60, 260),
  ]);

  return {
    key: "stability",
    label: "Estabilidad",
    score: round(score ?? 0),
    summary: `${metrics.longTaskCount || 0} long tasks - total ${formatMs(metrics.longTaskTotalMs)} - max ${formatMs(metrics.maxLongTaskMs)}`,
  };
}

function computeOverallScore(categories) {
  const weighted = categories.reduce((sum, category) => {
    const weight = CATEGORY_WEIGHTS[category.key] || 0;
    return sum + ((Number(category.score) || 0) * weight);
  }, 0);
  return clamp(Math.round(weighted), 0, 100);
}

function buildSummaryText(overallScore) {
  if (overallScore >= 85) return "Respuesta agil y sin cuellos visibles en esta pasada.";
  if (overallScore >= 70) return "Base solida, con margen puntual en carga o render.";
  if (overallScore >= 55) return "Uso correcto, pero ya aparecen esperas perceptibles.";
  if (overallScore >= 40) return "La app sigue siendo usable, aunque hay trabajo claro en UI o datos.";
  return "Hay varios cuellos de botella y conviene revisar esta vista antes de ampliar mas carga.";
}

function buildFindings(metrics) {
  const findings = [];

  if (Number(metrics.longTaskCount) > 0) {
    findings.push({
      tone: "amber",
      title: "Tareas largas detectadas",
      message: `Se capturaron ${metrics.longTaskCount} long task(s), con un maximo de ${formatMs(metrics.maxLongTaskMs)}. Revisa trabajo JS concentrado y renders grandes.`,
    });
  }

  if (Number(metrics.mainRenderMs) >= 140 || Number(metrics.statsRenderMs) >= 260) {
    findings.push({
      tone: "blue",
      title: "Render de vistas con margen",
      message: `La lista tarda ${formatMs(metrics.mainRenderMs)} y el panel estadistico ${formatMs(metrics.statsRenderMs)}. Conviene dividir trabajo pesado y evitar recalculos completos.`,
    });
  }

  if (Number(metrics.modalOpenMs) >= 160) {
    findings.push({
      tone: "blue",
      title: "Apertura de modal lenta",
      message: `La apertura medida ronda ${formatMs(metrics.modalOpenMs)}. Revisa el trabajo previo a pintar el editor y el contenido que se rellena al abrir.`,
    });
  }

  if (Number(metrics.initialLoadMs) >= 2600 || Number(metrics.firstContentfulPaintMs) >= 1900) {
    findings.push({
      tone: "rose",
      title: "Carga inicial alta",
      message: `El boot tarda ${formatMs(metrics.initialLoadMs)} y el primer pintado util ${formatMs(metrics.firstContentfulPaintMs)}. Ayuda precargar menos y diferir modulos no criticos.`,
    });
  }

  if (Number(metrics.resourceCount) >= 45 || Number(metrics.resourceTransferKb) >= 900) {
    findings.push({
      tone: "amber",
      title: "Demasiados recursos acumulados",
      message: `${metrics.resourceCount || 0} recursos relevantes y ${formatKb(metrics.resourceTransferKb)} transferidos en la sesion. Revisa imports perezosos y assets que no hagan falta al arrancar.`,
    });
  }

  if (Number(metrics.remoteReadMs) >= 350) {
    findings.push({
      tone: "blue",
      title: "Latencia de datos remotos apreciable",
      message: `La lectura RTDB de muestra tardo ${formatMs(metrics.remoteReadMs)}. Conviene seguir apoyandose en snapshot local y agrupar lecturas secundarias.`,
    });
  }

  return findings.slice(0, 5);
}

export async function runBookshellPerformanceAudit({
  auth,
  db,
  itemCount = 0,
  currentViewId = "",
  onStageChange = () => {},
  measureListRender,
  measureStatsRender,
  measureModalOpen,
} = {}) {
  const perfStore = getPerfStore();
  const boot = perfStore.boot || {};
  const currentView = perfStore.views?.[currentViewId] || {};
  const paint = getPaintEntries();
  const navigation = getNavigationEntry();
  const resources = getResourceMetrics();
  const uid = auth?.currentUser?.uid || "";
  const longTaskCollector = createLongTaskCollector();

  try {
    onStageChange("preparing", "Preparando muestras del navegador...");

    onStageChange("measuring", "Midiendo render y respuesta de UI...");
    const mainRenderMs = await sampleMetric(measureListRender, 2);
    const statsRenderMs = await sampleMetric(measureStatsRender, 1);
    const modalOpenMs = await sampleMetric(measureModalOpen, 1);

    onStageChange("measuring", "Midiendo capa de datos local y remota...");
    const snapshotResult = await measureAsync("snapshot", async () => {
      await readModuleSnapshot({ moduleName: "habits", uid });
      return true;
    });
    const queueResult = await measureAsync("queue", async () => {
      await getOfflineQueueSummary(uid);
      return true;
    });
    const remoteRead = await measureRemoteRead(db, uid);

    onStageChange("calculating", "Calculando score y hallazgos...");
    const longTasks = longTaskCollector.stop();

    const metrics = {
      initialLoadMs: Number(boot.initialLoadMs) || Number(navigation?.loadEventEnd) || null,
      firstContentfulPaintMs: Number(paint.get("first-contentful-paint")) || null,
      currentShellLoadMs: Number(currentView.shellLoadMs) || null,
      currentModuleInitMs: Number(currentView.moduleInitMs) || null,
      currentViewShowMs: Number(currentView.lastShowMs) || null,
      inputDelayHintMs: Number(navigation?.domInteractive) && Number(navigation?.responseStart)
        ? Math.max(0, Number(navigation.domInteractive) - Number(navigation.responseStart))
        : null,
      mainRenderMs,
      statsRenderMs,
      modalOpenMs,
      snapshotReadMs: snapshotResult.durationMs,
      queueReadMs: queueResult.durationMs,
      remoteReadMs: remoteRead.latencyMs,
      remoteReadAvailable: remoteRead.available,
      resourceCount: Number(resources.count) || 0,
      resourceTransferKb: Number(resources.transferKb) || 0,
      longTaskCount: Number(longTasks.count) || 0,
      longTaskTotalMs: Number(longTasks.totalMs) || 0,
      maxLongTaskMs: Number(longTasks.maxMs) || 0,
    };

    const categories = [
      buildLoadCategory(metrics),
      buildInteractionCategory(metrics),
      buildRenderCategory(metrics),
      buildDataCategory(metrics),
      buildStabilityCategory(metrics),
    ];

    const overallScore = computeOverallScore(categories);
    const findings = buildFindings(metrics);

    return {
      executedAt: Date.now(),
      overallScore,
      summaryText: buildSummaryText(overallScore),
      sampleText: `${itemCount || 0} fix(es) revisados - ${metrics.resourceCount || 0} recursos observados - vista ${currentViewId || "actual"}`,
      longTaskCount: metrics.longTaskCount,
      longTaskText: metrics.longTaskCount
        ? `${metrics.longTaskCount} tarea(s) larga(s), total ${formatMs(metrics.longTaskTotalMs)}`
        : "Sin tareas largas en esta pasada.",
      categories,
      findings,
      metrics,
    };
  } finally {
    if (longTaskCollector?.stop) {
      try {
        longTaskCollector.stop();
      } catch (_) {}
    }
  }
}

// ============================================================================
// HISTORIA DE RENDIMIENTO Y VISUALIZACION
// ============================================================================

function getPerfHistory() {
  try {
    const stored = localStorage.getItem(PERF_HISTORY_KEY);
    return Array.isArray(JSON.parse(stored)) ? JSON.parse(stored) : [];
  } catch (_) {
    return [];
  }
}

function savePerfHistory(entries) {
  try {
    localStorage.setItem(PERF_HISTORY_KEY, JSON.stringify(entries || []));
  } catch (_) {
    console.warn("[perf-audit] no se pudo guardar historia en localStorage");
  }
}

export function saveAuditResult(auditResult = {}) {
  if (!auditResult || !auditResult.executedAt) return;

  const history = getPerfHistory();
  const entry = {
    ts: auditResult.executedAt,
    date: new Date(auditResult.executedAt).toISOString().slice(0, 10),
    score: auditResult.overallScore || 0,
    load: auditResult.categories?.find((c) => c.key === "load")?.score || 0,
    interaction: auditResult.categories?.find((c) => c.key === "interaction")?.score || 0,
    render: auditResult.categories?.find((c) => c.key === "render")?.score || 0,
    data: auditResult.categories?.find((c) => c.key === "data")?.score || 0,
    stability: auditResult.categories?.find((c) => c.key === "stability")?.score || 0,
  };

  // Mantener ultimo mes de historia + entrada actual
  const maxAge = Date.now() - (30 * 24 * 60 * 60 * 1000);
  const filtered = history.filter((h) => (h.ts || 0) >= maxAge);
  
  // Evitar duplicados en el mismo dia
  const withoutToday = filtered.filter((h) => h.date !== entry.date);
  const updated = [...withoutToday, entry].sort((a, b) => (a.ts || 0) - (b.ts || 0));
  
  savePerfHistory(updated);
  return entry;
}

export function getPerformanceHistory() {
  const history = getPerfHistory();
  return history && history.length > 0 ? history : null;
}

export async function renderPerformanceHistoryChart(container, history = null) {
  if (!container) return;

  const data = history || getPerformanceHistory();
  if (!data || !Array.isArray(data) || data.length === 0) {
    container.innerHTML = '<div class="improvements__perfEmpty">Aun no hay historico de ejecuciones. Ejecuta una auditoria primero.</div>';
    return;
  }

  // Garantizar echarts
  if (!window.echarts?.init) {
    container.innerHTML = '<div class="improvements__perfEmpty">ECharts no esta disponible.</div>';
    return;
  }

  const ec = window.echarts;
  let chart = container.dataset.echartsInstance
    ? ec.getInstanceByDom(container)
    : null;

  if (!chart) {
    chart = ec.init(container, null, { renderer: "canvas" });
    container.dataset.echartsInstance = "1";
  }

  // Preparar datos para las series (5 ultimas mediciones como limite visual)
  const maxPoints = Math.min(data.length, 20);
  const displayData = data.slice(-maxPoints);
  const dates = displayData.map((d) => {
    const dateObj = new Date(d.date || d.ts);
    return dateObj.toLocaleDateString("es-ES", { month: "short", day: "numeric" });
  });

  const option = {
    responsive: true,
    maintainAspectRatio: false,
    animation: true,
    animationDuration: 400,
    grid: {
      left: "52px",
      right: "20px",
      top: "24px",
      bottom: "30px",
      containLabel: false,
    },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(15, 20, 35, 0.94)",
      borderColor: "rgba(115, 184, 255, 0.28)",
      textStyle: {
        color: "#e3f2ff",
        fontSize: 12,
      },
      axisPointer: {
        type: "line",
        lineStyle: {
          color: "rgba(115, 184, 255, 0.32)",
          type: "dashed",
        },
      },
      formatter: (params) => {
        if (!Array.isArray(params) || !params.length) return "";
        const date = params[0]?.axisValue || "";
        const lines = params.map((p) => {
          const marker = `<span style="display:inline-block;margin-right:8px;width:8px;height:8px;border-radius:50%;background:${p.color};"></span>`;
          return `${marker}${p.seriesName}: <strong>${p.value}</strong>`;
        });
        return `<div style="line-height:1.6;">${date}<br/>${lines.join("<br/>")}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: dates,
      boundaryGap: false,
      axisLabel: {
        color: "rgba(197, 211, 236, 0.64)",
        fontSize: 11,
        margin: 8,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(140, 170, 214, 0.12)",
        },
      },
      splitLine: {
        show: false,
      },
    },
    yAxis: {
      type: "value",
      min: 0,
      max: 100,
      axisLabel: {
        color: "rgba(197, 211, 236, 0.64)",
        fontSize: 11,
        margin: 8,
      },
      axisLine: {
        lineStyle: {
          color: "rgba(140, 170, 214, 0.12)",
        },
      },
      splitLine: {
        lineStyle: {
          color: "rgba(140, 170, 214, 0.08)",
          type: "dashed",
        },
      },
    },
    series: [
      {
        name: "Score global",
        type: "line",
        data: displayData.map((d) => d.score || 0),
        smooth: true,
        lineStyle: {
          color: "#73b8ff",
          width: 2,
        },
        itemStyle: {
          borderColor: "#73b8ff",
          borderWidth: 1,
        },
        areaStyle: {
          color: "rgba(115, 184, 255, 0.1)",
        },
        emphasis: {
          itemStyle: {
            borderWidth: 2,
            shadowBlur: 8,
            shadowColor: "rgba(115, 184, 255, 0.4)",
          },
        },
        symbolSize: 6,
      },
      {
        name: "Carga",
        type: "line",
        data: displayData.map((d) => d.load || 0),
        smooth: true,
        lineStyle: {
          color: "#ff89c6",
          width: 1.5,
        },
        itemStyle: {
          borderColor: "#ff89c6",
          borderWidth: 0.5,
        },
        areaStyle: null,
        emphasis: {
          itemStyle: {
            borderWidth: 1.5,
          },
        },
        symbolSize: 4,
      },
      {
        name: "Render",
        type: "line",
        data: displayData.map((d) => d.render || 0),
        smooth: true,
        lineStyle: {
          color: "#7dffb4",
          width: 1.5,
        },
        itemStyle: {
          borderColor: "#7dffb4",
          borderWidth: 0.5,
        },
        areaStyle: null,
        emphasis: {
          itemStyle: {
            borderWidth: 1.5,
          },
        },
        symbolSize: 4,
      },
      {
        name: "Datos",
        type: "line",
        data: displayData.map((d) => d.data || 0),
        smooth: true,
        lineStyle: {
          color: "#ffb05c",
          width: 1.5,
        },
        itemStyle: {
          borderColor: "#ffb05c",
          borderWidth: 0.5,
        },
        areaStyle: null,
        emphasis: {
          itemStyle: {
            borderWidth: 1.5,
          },
        },
        symbolSize: 4,
      },
    ],
    textStyle: {
      fontFamily: "system-ui, -apple-system, sans-serif",
    },
  };

  chart.setOption(option);

  // Observar cambios de tamaño del contenedor
  if (typeof ResizeObserver === "function") {
    // Limpiar observer anterior si existe
    const prevObserverKey = "__bookshellPerfChartObserver";
    const existingObserver = container[prevObserverKey];
    if (existingObserver && typeof existingObserver.disconnect === "function") {
      try {
        existingObserver.disconnect();
      } catch (_) {}
    }

    const observer = new ResizeObserver(() => {
      if (chart && typeof chart.resize === "function") {
        chart.resize();
      }
    });
    observer.observe(container);
    container[prevObserverKey] = observer;
  }

  return chart;
}
