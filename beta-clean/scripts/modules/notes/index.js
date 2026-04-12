let runtimeModule = null;
let runtimePromise = null;

async function ensureRuntime() {
  if (runtimeModule) return runtimeModule;
  if (!runtimePromise) {
    runtimePromise = import("./runtime.js")
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

export function destroy() {
  runtimeModule?.destroy?.();
}
