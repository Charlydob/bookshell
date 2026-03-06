// scripts/app.js
import { auth, db } from "./firebase-shared.js";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

import {
  ref,
  get,
  update
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

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
    const pass  = box.querySelector("#loginPass").value;
    try { await signInWithEmailAndPassword(auth, email, pass); }
    catch (e) { err.textContent = e?.message || String(e); }
  };

  box.querySelector("#btnSignup").onclick = async () => {
    err.textContent = "";
    const email = box.querySelector("#loginEmail").value.trim();
    const pass  = box.querySelector("#loginPass").value;
    try { await createUserWithEmailAndPassword(auth, email, pass); }
    catch (e) { err.textContent = e?.message || String(e); }
  };

  box.querySelector("#btnLogout").onclick = async () => {
    err.textContent = "";
    try { await signOut(auth); }
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

    books:   { _init: true },
    videos:  { _init: true },
    recipes: { _init: true },
    habits:  { _init: true },
    games:   { _init: true },
    movies:  { _init: true },
    trips:   { _init: true },
    finance: { _init: true },
    gym:     { _init: true },
  });
}

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


function syncViewportHeightVar() {
  const viewportHeight = window.visualViewport?.height || window.innerHeight;
  const px = Math.max(1, Math.round(viewportHeight * 100) / 100);
  document.documentElement.style.setProperty('--app-dvh', `${px}px`);
}


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
  syncViewportHeightVar();
  window.addEventListener('resize', syncViewportHeightVar, { passive: true });
  window.visualViewport?.addEventListener('resize', syncViewportHeightVar, { passive: true });


  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      ensureLoginUI();
      return;
    }

    // seed esquema v2 si hace falta
    try { await ensureUserSchema(user.uid); }
    catch (e) { console.warn("[schema] seed failed", e); }

    // quita login y arranca
    document.getElementById("loginBox")?.remove();

    const viewId = getInitialView();
    setView(viewId, { pushHash: true });
    loadAndInit(viewId);

    console.log("[auth] uid", user.uid);
    console.log("[perf] app-initial-load-ms", Math.round(performance.now() - APP_BOOT_TS));
  });
})();