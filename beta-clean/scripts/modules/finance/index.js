let runtimeModule = null;

export async function init() {
  if (runtimeModule) return;
  runtimeModule = await import("./runtime.js");
  if (typeof runtimeModule.init === "function") {
    await runtimeModule.init();
  }
}

export async function onShow() {
  try {
    window.dispatchEvent(new Event("resize"));
  } catch (_) {}
}

export function destroy() {}
