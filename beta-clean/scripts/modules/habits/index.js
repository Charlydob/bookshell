let runtimeModule = null;

export async function init() {
  if (runtimeModule) return;
  runtimeModule = await import("./runtime.js");
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
