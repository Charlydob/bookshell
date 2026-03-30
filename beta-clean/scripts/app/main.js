import {
  auth,
  db,
  onUserChange,
  signInWithEmail,
  signOutCurrentUser,
  signUpWithEmail,
} from "../shared/firebase/index.js";
import {
  get,
  ref,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const LAST_VIEW_KEY = "bookshell:lastView";
const DEFAULT_VIEW_ID = "view-books";
const SHELL_STATE_KEY = "__bookshellCleanShellState";
const APP_BOOT_TS = performance.now();
const loadedStyles = new Set();
const viewModules = {
  "view-books": {
    htmlUrl: "../../views/books.html",
    cssUrl: "./styles/modules/books.css",
    moduleLoader: () => import("../modules/books/index.js"),
  },
  "view-videos-hub": {
    htmlUrl: "../../views/videos-hub.html",
    cssUrl: "./styles/modules/videos-hub.css",
    moduleLoader: () => import("../modules/videos-hub/index.js"),
  },
  "view-world": {
    htmlUrl: "../../views/world.html",
    cssUrl: "./styles/modules/world.css",
    moduleLoader: () => import("../modules/world/index.js"),
  },
  "view-media": {
    htmlUrl: "../../views/media.html",
    cssUrl: "./styles/modules/media.css",
    moduleLoader: () => import("../modules/media/index.js"),
  },
  "view-recipes": {
    htmlUrl: "../../views/recipes.html",
    cssUrl: "./styles/modules/recipes.css",
    moduleLoader: () => import("../modules/recipes/index.js"),
  },
  "view-habits": {
    htmlUrl: "../../views/habits.html",
    cssUrl: "./styles/modules/habits.css",
    moduleLoader: () => import("../modules/habits/index.js"),
  },
  "view-games": {
    htmlUrl: "../../views/games.html",
    cssUrl: "./styles/modules/games.css",
    moduleLoader: () => import("../modules/games/index.js"),
  },
  "view-finance": {
    htmlUrl: "../../views/finance.html",
    cssUrl: "./styles/modules/finance.css",
    moduleLoader: () => import("../modules/finance/index.js"),
  },
  "view-gym": {
    htmlUrl: "../../views/gym.html",
    cssUrl: "./styles/modules/gym.css",
    moduleLoader: () => import("../modules/gym/index.js"),
  },
};

function getShellState() {
  if (!window[SHELL_STATE_KEY]) {
    window[SHELL_STATE_KEY] = {
      booted: false,
      currentViewId: null,
      navBound: false,
      authBound: false,
    };
  }

  return window[SHELL_STATE_KEY];
}

function getViews() {
  return Array.from(document.querySelectorAll(".view[id]"));
}

async function loadHtmlInto(root, htmlUrl) {
  const absoluteUrl = new URL(htmlUrl, import.meta.url);
  const response = await fetch(absoluteUrl);
  if (!response.ok) {
    throw new Error(`[shell] no se pudo cargar ${absoluteUrl.pathname}`);
  }

  root.innerHTML = await response.text();
}

function loadStyleOnce(href) {
  const absoluteUrl = new URL(href, window.location.href).href;
  if (loadedStyles.has(absoluteUrl)) return;

  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = absoluteUrl;
  document.head.appendChild(link);
  loadedStyles.add(absoluteUrl);
}

async function ensureViewModule(viewId) {
  const state = getShellState();
  const config = viewModules[viewId];
  if (!config) return null;

  if (!state.moduleStates) {
    state.moduleStates = {};
  }

  if (!state.moduleStates[viewId]) {
    state.moduleStates[viewId] = {
      htmlLoaded: false,
      initialized: false,
      module: null,
    };
  }

  const moduleState = state.moduleStates[viewId];
  const root = document.getElementById(viewId);
  if (!root) return null;

  if (config.cssUrl) {
    loadStyleOnce(config.cssUrl);
  }

  if (!moduleState.htmlLoaded) {
    await loadHtmlInto(root, config.htmlUrl);
    moduleState.htmlLoaded = true;
  }

  if (!moduleState.module) {
    moduleState.module = await config.moduleLoader();
  }

  if (!moduleState.initialized && typeof moduleState.module.init === "function") {
    await moduleState.module.init({ root, viewId });
    moduleState.initialized = true;
  }

  if (typeof moduleState.module.onShow === "function") {
    await moduleState.module.onShow({ root, viewId });
  }

  return moduleState.module;
}

function isValidView(viewId) {
  return Boolean(viewId && document.getElementById(viewId)?.classList.contains("view"));
}

function getInitialView() {
  const hashViewId = (window.location.hash || "").replace(/^#/, "");
  if (isValidView(hashViewId)) return hashViewId;

  const storedViewId = window.localStorage.getItem(LAST_VIEW_KEY);
  if (isValidView(storedViewId)) return storedViewId;

  return DEFAULT_VIEW_ID;
}

function syncNav(viewId) {
  document.querySelectorAll(".bottom-nav .nav-btn[data-view]").forEach((button) => {
    const isActive = button.dataset.view === viewId;
    button.classList.toggle("nav-btn-active", isActive);

    if (isActive) {
      button.setAttribute("aria-current", "page");
    } else {
      button.removeAttribute("aria-current");
    }
  });
}

function syncViews(viewId) {
  getViews().forEach((view) => {
    const isActive = view.id === viewId;
    view.classList.toggle("view-active", isActive);
    view.setAttribute("aria-hidden", String(!isActive));

    if (!isActive) {
      view.scrollTop = 0;
    }
  });
}

async function setView(viewId, { pushHash = true } = {}) {
  if (!isValidView(viewId)) return;

  const state = getShellState();
  if (state.currentViewId === viewId) {
    syncNav(viewId);
    syncViews(viewId);
    await ensureViewModule(viewId);
    return;
  }

  syncViews(viewId);
  syncNav(viewId);
  await ensureViewModule(viewId);

  state.currentViewId = viewId;
  window.localStorage.setItem(LAST_VIEW_KEY, viewId);

  if (pushHash) {
    const nextHash = `#${viewId}`;
    if (window.location.hash !== nextHash) {
      try {
        window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${nextHash}`);
      } catch (_) {
        window.location.hash = nextHash;
      }
    }
  }
}

function bindNav() {
  const state = getShellState();
  if (state.navBound) return;

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.(".bottom-nav .nav-btn[data-view]");
    if (!button) return;

    const nextViewId = button.dataset.view;
    if (!isValidView(nextViewId)) return;

    event.preventDefault();
    void setView(nextViewId);
  }, true);

  window.addEventListener("hashchange", () => {
    void setView(getInitialView(), { pushHash: false });
  });

  state.navBound = true;
}

function getBootSplash() {
  return window.__bookshellBootSplash || null;
}

function setBootPhase(text, progressHint) {
  try {
    getBootSplash()?.setPhase?.(text, progressHint);
  } catch (_) {}
}

function finishBootSplash() {
  try {
    getBootSplash()?.done?.();
  } catch (_) {}
}

function ensureLoginUI() {
  if (document.getElementById("loginBox")) return;

  const box = document.createElement("div");
  box.id = "loginBox";
  box.style.cssText = `
    position: fixed; inset: 0; z-index: 99999;
    display: grid; place-items: center;
    background: rgba(0,0,0,.55); backdrop-filter: blur(10px);
  `;

  box.innerHTML = `
    <div style="width:min(420px,92vw); padding:16px; border-radius:16px;
      background: rgba(12,20,44,.88); border:1px solid rgba(160,220,255,.25);
      box-shadow: 0 20px 60px rgba(0,0,0,.45); display:grid; gap:10px;">
      <div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">
        <div style="font-weight:700">Bookshell · Login</div>
        <button id="btnLogout" title="Cerrar sesión"
          style="padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);
          background:rgba(255,255,255,.08);color:#fff; display:none;">Salir</button>
      </div>

      <input id="loginEmail" placeholder="Email"
        style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.06);color:#fff;">

      <input id="loginPass" type="password" placeholder="Password"
        style="padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.15);
        background:rgba(255,255,255,.06);color:#fff;">

      <div style="display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap;">
        <button id="btnSignup"
          style="padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,.18);
          background:rgba(255,255,255,.08);color:#fff;">Crear cuenta</button>

        <button id="btnLogin"
          style="padding:10px 12px;border-radius:10px;border:1px solid rgba(160,220,255,.35);
          background:rgba(160,220,255,.12);color:#fff;">Entrar</button>
      </div>

      <small id="loginErr" style="opacity:.85; color:#ffd1d1;"></small>
    </div>
  `;
  document.body.appendChild(box);

  const err = box.querySelector("#loginErr");
  box.querySelector("#btnLogin").onclick = async () => {
    err.textContent = "";
    const email = box.querySelector("#loginEmail").value.trim();
    const pass = box.querySelector("#loginPass").value;
    try { await signInWithEmail(email, pass); }
    catch (e) { err.textContent = e?.message || String(e); }
  };

  box.querySelector("#btnSignup").onclick = async () => {
    err.textContent = "";
    const email = box.querySelector("#loginEmail").value.trim();
    const pass = box.querySelector("#loginPass").value;
    try { await signUpWithEmail(email, pass); }
    catch (e) { err.textContent = e?.message || String(e); }
  };

  box.querySelector("#btnLogout").onclick = async () => {
    err.textContent = "";
    try { await signOutCurrentUser(); }
    catch (e) { err.textContent = e?.message || String(e); }
  };
}

async function ensureUserSchema(uid) {
  const root = `v2/users/${uid}`;
  const snap = await get(ref(db, root));
  if (snap.exists()) return;

  const now = Date.now();
  await update(ref(db, root), {
    meta: { schemaVersion: 2, createdAt: now },
    books: { _init: true },
    videos: { _init: true },
    videosHub: { _init: true },
    recipes: { _init: true },
    habits: { _init: true },
    games: { _init: true },
    movies: { _init: true },
    trips: { _init: true },
    finance: { _init: true },
    gym: { _init: true },
  });
}

function bootShell() {
  const state = getShellState();
  if (state.booted) return;

  bindNav();
  void setView(getInitialView(), { pushHash: true });
  state.booted = true;
}

function bindAuthGate() {
  const state = getShellState();
  if (state.authBound) return;

  setBootPhase("Inicializando…", 12);

  onUserChange(async (user) => {
    if (!user) {
      setBootPhase("Conectando…", 32);
      ensureLoginUI();
      finishBootSplash();
      return;
    }

    setBootPhase("Conectando…", 38);

    try {
      await ensureUserSchema(user.uid);
    } catch (e) {
      console.warn("[schema] seed failed", e);
    }

    document.getElementById("loginBox")?.remove();

    bootShell();
    setBootPhase("Cargando datos…", 62);

    const viewId = getInitialView();
    try {
      await setView(viewId, { pushHash: true });
      setBootPhase("Preparando interfaz…", 78);
    } finally {
      requestAnimationFrame(() => finishBootSplash());
    }

    console.log("[auth] uid", user.uid);
    console.log("[perf] app-initial-load-ms", Math.round(performance.now() - APP_BOOT_TS));
  });

  state.authBound = true;
}

bindAuthGate();
