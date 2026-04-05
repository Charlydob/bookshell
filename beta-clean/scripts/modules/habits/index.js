let runtimeModule = null;
const HABITS_RUNTIME_VERSION = "2026-04-05-v7";

function logHabitsModule(phase, extra = {}, level = "info") {
  const payload = {
    phase,
    online: navigator.onLine,
    serviceWorkerControlled: !!navigator.serviceWorker?.controller,
    at: new Date().toISOString(),
    ...extra,
  };
  const logger = typeof console[level] === "function" ? console[level] : console.log;
  logger.call(console, `[habits:module] ${phase}`, payload);
}

export async function init() {
  if (runtimeModule) {
    logHabitsModule("runtime:reuse");
    return;
  }
  logHabitsModule("runtime:import:start", {
    runtimeVersion: HABITS_RUNTIME_VERSION,
  });
  try {
    runtimeModule = await import(`./runtime.js?v=${HABITS_RUNTIME_VERSION}`);
    logHabitsModule("runtime:import:ready", {
      runtimeVersion: HABITS_RUNTIME_VERSION,
      exports: Object.keys(runtimeModule || {}),
    });
  } catch (error) {
    logHabitsModule("runtime:import:error", {
      runtimeVersion: HABITS_RUNTIME_VERSION,
      message: error?.message || String(error || ""),
      stack: error?.stack || "",
    }, "error");
    throw error;
  }
}

export async function onShow() {
  await runtimeModule?.onShow?.();
  try {
    window.dispatchEvent(new Event("resize"));
  } catch (_) {}
}

export async function onHide() {
  await runtimeModule?.onHide?.();
}

export function destroy() {}
