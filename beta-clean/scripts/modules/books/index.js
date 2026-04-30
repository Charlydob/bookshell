let runtimeModule = null;
let runtimePromise = null;
let runtimeLoadScheduled = false;

function markBooksShellLoading() {
  document.getElementById("books-list")?.setAttribute("data-loading", "1");
  document.getElementById("calendar-summary")?.setAttribute("data-loading", "1");
  document.getElementById("calendar-grid")?.setAttribute("data-loading", "1");
}

function scheduleRuntimeLoad() {
  if (runtimeModule || runtimePromise || runtimeLoadScheduled) return;

  runtimeLoadScheduled = true;
  requestAnimationFrame(() => {
    window.setTimeout(() => {
      runtimeLoadScheduled = false;
      void loadRuntime().catch((error) => {
        console.warn("[books] no se pudo cargar el runtime", error);
      });
    }, 60);
  });
}

async function loadRuntime() {
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
  markBooksShellLoading();
  scheduleRuntimeLoad();
}

export async function onShow() {
  if (!runtimeModule) {
    markBooksShellLoading();
  }
  scheduleRuntimeLoad();

  if (typeof runtimeModule?.onShow === "function") {
    await runtimeModule.onShow();
  }

  try {
    window.dispatchEvent(new Event("resize"));
  } catch (_) {}
}

export function onHide() {
  runtimeModule?.onHide?.();
}

export function destroy() {
  runtimeModule?.destroy?.();
}
