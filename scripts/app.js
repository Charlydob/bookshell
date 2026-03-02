// scripts/app.js
const LAST_VIEW_KEY = "bookshell:lastView";
const APP_BOOT_TS = performance.now();

const VIEW_MODULE = {
  "view-main":   () => import("./dashboard.js"),
  "view-books":  () => import("./books.js"),
  "view-videos": () => import("./videos.js"),
  "view-recipes":() => import("./recipes.js"),
  "view-habits": () => import("./habits.js"),
  "view-games":  () => import("./games.js"),
  "view-media":  () => import("./media.js"),
  "view-world":  () => import("./world.js"),
  "view-gym":    () => import("./gym.js"),
  "view-finance":() => import("./finance-tab.js"),
};

const loaded = new Map();
let currentViewId = null;

function isValidView(viewId) {
  return !!(viewId && document.getElementById(viewId) && VIEW_MODULE[viewId]);
}

function setView(viewId, { pushHash = true } = {}) {
  if (typeof window.__bookshellSetView === "function") {
    window.__bookshellSetView(viewId);
  } else {
    document.querySelectorAll(".view").forEach(v =>
      v.classList.toggle("view-active", v.id === viewId)
    );
    document.querySelectorAll(".bottom-nav .nav-btn").forEach(b => {
      const active = b.dataset.view === viewId;
      b.classList.toggle("nav-btn-active", active);
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  }

  localStorage.setItem(LAST_VIEW_KEY, viewId);

  if (pushHash) {
    const next = `#${viewId}`;
    if (location.hash !== next) {
      try { history.replaceState(null, "", `${location.pathname}${location.search}${next}`); }
      catch { location.hash = next; }
    }
  }
}

function getInitialView() {
  const hash = (location.hash || "").replace("#", "");
  if (isValidView(hash)) return hash;

  const saved = localStorage.getItem(LAST_VIEW_KEY);
  if (isValidView(saved)) return saved;

  return "view-main";
}

async function getModule(viewId) {
  let mod = loaded.get(viewId);
  if (!mod) {
    mod = await VIEW_MODULE[viewId]();
    loaded.set(viewId, mod);
  }
  return mod;
}

async function destroyCurrentView(nextViewId) {
  if (!currentViewId || currentViewId === nextViewId) return;
  const currentMod = loaded.get(currentViewId);
  if (typeof currentMod?.destroy === "function") {
    await currentMod.destroy();
  }
  console.log("[perf] listeners", currentViewId, countTabListeners(currentMod));
}

function countTabListeners(mod) {
  if (!mod || typeof mod.getListenerCount !== "function") return "n/a";
  return mod.getListenerCount();
}

async function loadAndInit(viewId) {
  if (!VIEW_MODULE[viewId]) return;

  await destroyCurrentView(viewId);

  const mod = await getModule(viewId);

  if (typeof mod.init === "function") {
    await mod.init({ viewId, setView, loadScriptOnce, loadStyleOnce });
  }

  if (typeof mod.onShow === "function") {
    await mod.onShow({ viewId, setView });
  }

  currentViewId = viewId;
  console.log("[perf] listeners", viewId, countTabListeners(mod));
}

function bindNav() {
  document.addEventListener("click", (e) => {
    const btn = e.target?.closest?.(".bottom-nav .nav-btn[data-view]");
    if (!btn) return;
    e.preventDefault();
    const viewId = btn.dataset.view;
    if (!isValidView(viewId)) return;

    setView(viewId);
    loadAndInit(viewId);
  }, true);

  window.addEventListener("hashchange", () => {
    const viewId = getInitialView();
    setView(viewId, { pushHash: false });
    loadAndInit(viewId);
  });
}

const _scriptOnce = new Map();
function loadScriptOnce(src) {
  if (_scriptOnce.has(src)) return _scriptOnce.get(src);
  const p = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`Failed script: ${src}`));
    document.head.appendChild(s);
  });
  _scriptOnce.set(src, p);
  return p;
}

const _styleOnce = new Map();
function loadStyleOnce(href) {
  if (_styleOnce.has(href)) return _styleOnce.get(href);
  const p = new Promise((resolve, reject) => {
    const l = document.createElement("link");
    l.rel = "stylesheet";
    l.href = href;
    l.onload = () => resolve();
    l.onerror = () => reject(new Error(`Failed css: ${href}`));
    document.head.appendChild(l);
  });
  _styleOnce.set(href, p);
  return p;
}

(function boot() {
  bindNav();
  const viewId = getInitialView();
  setView(viewId, { pushHash: true });
  loadAndInit(viewId);
  console.log("[perf] app-initial-load-ms", Math.round(performance.now() - APP_BOOT_TS));
})();
