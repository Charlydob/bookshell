console.info("[finance/index] parsed ok");

const FINANCE_RUNTIME_VERSION = "2026-06-20-finance-syntax-fix";
const FINANCE_RUNTIME_URL = "./runtime.js?v=" + FINANCE_RUNTIME_VERSION;
let runtimeModule = null;

async function importFinanceModule(modulePath) {
  console.info("[finance import start]", modulePath);
  try {
    const moduleNamespace = await import(modulePath);
    console.info("[finance import ok]", modulePath);
    return moduleNamespace;
  } catch (error) {
    console.error("[finance import failed]", modulePath, error);
    throw error;
  }
}

export async function init() {
  if (runtimeModule) return;
  runtimeModule = await importFinanceModule(FINANCE_RUNTIME_URL);
  if (runtimeModule && typeof runtimeModule.init === "function") {
    await runtimeModule.init();
  }
}

export async function onShow() {
  if (runtimeModule && typeof runtimeModule.init === "function") {
    await runtimeModule.init();
  }
  if (runtimeModule && typeof runtimeModule.onShow === "function") {
    await runtimeModule.onShow();
  }
}

export async function onHide() {
  if (runtimeModule && typeof runtimeModule.destroy === "function") {
    runtimeModule.destroy();
  }
}

export function destroy() {
  void onHide();
}
