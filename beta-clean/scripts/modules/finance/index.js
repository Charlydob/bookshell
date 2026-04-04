let runtimeModule = null;

export async function init() {
  if (runtimeModule) return;
  runtimeModule = await import("./runtime.js");
  if (typeof runtimeModule.init === "function") {
    await runtimeModule.init();
  }
}

export async function onShow() {
  if (typeof runtimeModule?.onShow === "function") {
    await runtimeModule.onShow();
  }
}

export function destroy() {}
