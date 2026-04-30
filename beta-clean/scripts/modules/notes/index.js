let runtimeModule = null;
let runtimePromise = null;
const NOTES_RUNTIME_VERSION = "2026-04-28-v2";

async function ensureRuntime() {
  if (runtimeModule) return runtimeModule;
  if (!runtimePromise) {
    runtimePromise = import(`./runtime.js?v=${NOTES_RUNTIME_VERSION}`)
      .then((mod) => {
        runtimeModule = mod;
        return mod;
      })
      .catch((error) => {
        runtimePromise = null;
        throw error;
      });
  }
  return runtimePromise;
}

export async function init() {
  await ensureRuntime();
}

export async function onShow() {
  const mod = await ensureRuntime();
  await mod.onShow?.();
}

export function onHide() {
  runtimeModule?.destroy?.();
}

export function destroy() {
  onHide();
}
