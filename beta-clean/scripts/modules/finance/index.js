const FINANCE_RUNTIME_VERSION = "2026-06-19-phase2-visible";
let runtimeModule = null;

export async function init() {
  if (runtimeModule) return;
  runtimeModule = await import(`./runtime.js?v=${FINANCE_RUNTIME_VERSION}`);
  if (typeof runtimeModule.init === "function") {
    await runtimeModule.init();
  }
}

export async function onShow() {
  if (typeof runtimeModule?.init === "function") {
    await runtimeModule.init();
  }
  if (typeof runtimeModule?.onShow === "function") {
    await runtimeModule.onShow();
  }
}

export async function onHide() {
  if (typeof runtimeModule?.destroy === "function") {
    runtimeModule.destroy();
  }
}

export function destroy() {
  void onHide();
}
