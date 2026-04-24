const THEME_STORAGE_KEY = "bookshell:theme:v1";
const DEFAULT_THEME_ID = "dark-opal";
const THEME_CONTROL_ID = "app-theme-switcher";
const THEME_PANEL_ID = "app-theme-panel";

const THEME_OPTIONS = Object.freeze([
  { id: "dark-opal", label: "Dark Opal" },
  { id: "light-clean", label: "Light Clean" },
  { id: "midnight-blue", label: "Midnight Blue" },
  { id: "forest", label: "Forest" },
  { id: "sand", label: "Sand" },
]);

const VALID_THEME_IDS = new Set(THEME_OPTIONS.map((theme) => theme.id));

const state = {
  initialized: false,
  currentTheme: DEFAULT_THEME_ID,
  controlOpen: false,
};

function resolveThemeId(themeId = "") {
  const safeThemeId = String(themeId || "").trim();
  return VALID_THEME_IDS.has(safeThemeId) ? safeThemeId : DEFAULT_THEME_ID;
}

function getThemeLabel(themeId = "") {
  return THEME_OPTIONS.find((theme) => theme.id === themeId)?.label || "Dark Opal";
}

function readStoredTheme() {
  try {
    return resolveThemeId(window.localStorage.getItem(THEME_STORAGE_KEY) || "");
  } catch (_) {
    return DEFAULT_THEME_ID;
  }
}

function readBootTheme() {
  return resolveThemeId(document.documentElement?.dataset?.theme || readStoredTheme());
}

function persistTheme(themeId = "") {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, resolveThemeId(themeId));
  } catch (_) {}
}

function syncThemeControls() {
  document.querySelectorAll("[data-app-theme-current]").forEach((node) => {
    node.textContent = getThemeLabel(state.currentTheme);
  });

  document.querySelectorAll("[data-app-theme-option]").forEach((button) => {
    if (!(button instanceof HTMLButtonElement)) return;
    const themeId = button.dataset.appThemeOption || "";
    const isActive = themeId === state.currentTheme;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  const trigger = document.getElementById(THEME_CONTROL_ID);
  if (trigger instanceof HTMLElement) {
    trigger.classList.toggle("is-open", state.controlOpen);
    trigger.setAttribute("aria-expanded", String(state.controlOpen));
  }

  const panel = document.getElementById(THEME_PANEL_ID);
  if (panel instanceof HTMLElement) {
    panel.classList.toggle("hidden", !state.controlOpen);
    panel.classList.toggle("is-open", state.controlOpen);
  }

  const backdrop = document.getElementById(`${THEME_PANEL_ID}-backdrop`);
  if (backdrop instanceof HTMLElement) {
    backdrop.classList.toggle("hidden", !state.controlOpen);
    backdrop.classList.toggle("is-open", state.controlOpen);
  }
}

function updateThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;

  requestAnimationFrame(() => {
    const themeColor = getComputedStyle(document.documentElement)
      .getPropertyValue("--app-theme-color")
      .trim();

    if (themeColor) {
      meta.setAttribute("content", themeColor);
    }
  });
}

export function applyTheme(themeId = "", { persist = true, dispatch = true } = {}) {
  const safeThemeId = resolveThemeId(themeId || readStoredTheme());
  const root = document.documentElement;
  if (!root) return safeThemeId;

  root.dataset.theme = safeThemeId;
  state.currentTheme = safeThemeId;

  if (persist) {
    persistTheme(safeThemeId);
  }

  syncThemeControls();
  updateThemeColorMeta();

  if (dispatch) {
    window.dispatchEvent(new CustomEvent("bookshell:theme-change", {
      detail: {
        themeId: safeThemeId,
        themeLabel: getThemeLabel(safeThemeId),
      },
    }));
  }

  return safeThemeId;
}

function buildThemeOptionsMarkup() {
  return THEME_OPTIONS.map((theme) => `
    <button
      class="app-theme-switcher__option"
      type="button"
      data-app-theme-option="${theme.id}"
      aria-pressed="false"
    >
      ${theme.label}
    </button>
  `).join("");
}

function stopIndicatorToggle(event) {
  event.stopPropagation();
}

function setThemeControlOpen(isOpen = false) {
  state.controlOpen = Boolean(isOpen);
  syncThemeControls();
}

export function ensureThemeControl() {
const existing = document.getElementById(THEME_CONTROL_ID);
if (existing) {
  bindThemeControlEvents(existing);
  syncThemeControls();
  return existing;
}

  const indicator = document.querySelector(".app-sync-indicator");
  if (!(indicator instanceof HTMLElement)) return null;

  let actions = indicator.querySelector(".app-sync-indicator__actions");
  if (!(actions instanceof HTMLElement)) {
    actions = document.createElement("span");
    actions.className = "app-sync-indicator__actions";
    indicator.append(actions);
  }

  // Crear solo el trigger aquí
  const trigger = document.createElement("button");
  trigger.className = "app-theme-switcher__trigger";
  trigger.type = "button";
  trigger.id = THEME_CONTROL_ID;
  trigger.setAttribute("data-app-theme-trigger", "");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", THEME_PANEL_ID);
  trigger.innerHTML = `
    <span class="app-theme-switcher__label">Tema</span>
    <span class="app-theme-switcher__value" data-app-theme-current>${getThemeLabel(state.currentTheme)}</span>
  `;

  ["click", "pointerdown", "mousedown"].forEach((eventName) => {
    trigger.addEventListener(eventName, stopIndicatorToggle);
  });

  actions.prepend(trigger);

  // Crear backdrop para el modal
  const backdrop = document.createElement("div");
  backdrop.id = `${THEME_PANEL_ID}-backdrop`;
  backdrop.className = "app-theme-switcher__backdrop hidden";
  backdrop.setAttribute("data-app-theme-backdrop", "");
  backdrop.addEventListener("click", () => setThemeControlOpen(false));
  document.body.append(backdrop);

  // Crear el panel en el body como elemento modal separado
  const panel = document.createElement("div");
  panel.className = "app-theme-switcher__panel hidden";
  panel.id = THEME_PANEL_ID;
  panel.setAttribute("data-app-theme-panel", "");
  panel.innerHTML = buildThemeOptionsMarkup();
  document.body.append(panel);

  syncThemeControls();
  bindThemeControlEvents(trigger);
  return trigger;
}

export function getCurrentTheme() {
  return state.currentTheme;
}

export function getAvailableThemes() {
  return THEME_OPTIONS.map((theme) => ({ ...theme }));
}

export function initThemeService() {
  state.currentTheme = readBootTheme();
  applyTheme(state.currentTheme, { persist: false, dispatch: false });

  const boot = () => {
    ensureThemeControl();
    syncThemeControls();
    updateThemeColorMeta();
  };

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }

  if (state.initialized) return;
  state.initialized = true;

  window.addEventListener("load", updateThemeColorMeta, { once: true });

  document.addEventListener("click", () => {
    if (!state.controlOpen) return;
    setThemeControlOpen(false);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !state.controlOpen) return;
    setThemeControlOpen(false);
  });

  window.__bookshellTheme = {
    getCurrentTheme,
    getAvailableThemes,
    setTheme: (themeId) => applyTheme(themeId),
    ensureControl: ensureThemeControl,
  };
}
function bindThemeControlEvents(trigger) {
  if (!(trigger instanceof HTMLElement)) return;

  if (trigger.dataset.themeBound === "true") return;
  trigger.dataset.themeBound = "true";

  // Eventos del trigger
  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    setThemeControlOpen(!state.controlOpen);
  });

  ["pointerdown", "mousedown"].forEach((eventName) => {
    trigger.addEventListener(eventName, stopIndicatorToggle);
  });

  // Eventos del panel
  const panel = document.getElementById(THEME_PANEL_ID);
  if (panel instanceof HTMLElement) {
    panel.addEventListener("click", (event) => {
      event.stopPropagation();

      const option = event.target.closest("[data-app-theme-option]");
      if (option instanceof HTMLButtonElement) {
        applyTheme(option.dataset.appThemeOption || "");
        setThemeControlOpen(false);
      }
    });

    ["pointerdown", "mousedown"].forEach((eventName) => {
      panel.addEventListener(eventName, stopIndicatorToggle);
    });
  }
}