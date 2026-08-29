let runtimeModule = null;

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
  console.debug("[view:init]", "view-habits");
  if (runtimeModule) {
    logHabitsModule("runtime:reuse");
    return;
  }
  logHabitsModule("runtime:import:start", {
    runtimeUrl: "./runtime.js",
  });
  try {
    runtimeModule = await import("./runtime.js");
    logHabitsModule("runtime:import:ready", {
      runtimeUrl: "./runtime.js",
      exports: Object.keys(runtimeModule || {}),
    });
  } catch (error) {
    console.error("[habits:init:error]", error);
    console.error("[view:error]", { viewId: "view-habits", error });
    logHabitsModule("runtime:import:error", {
      runtimeUrl: "./runtime.js",
      message: error?.message || String(error || ""),
      stack: error?.stack || "",
    }, "error");
    throw error;
  }
}

export async function onShow() {
  console.debug("[view:onShow]", "view-habits");
  try {
    await runtimeModule?.onShow?.();
    try {
      window.dispatchEvent(new Event("resize"));
    } catch (_) {}
  } catch (error) {
    console.error("[habits:onShow:error]", error);
    console.error("[view:error]", { viewId: "view-habits", error });
  }
}

export async function onHide() {
  await runtimeModule?.onHide?.();
}

export function destroy() {}
