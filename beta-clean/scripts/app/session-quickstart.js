const QUICKSTART_MODAL_ID = "quickstart-session-modal";

const QUICKSTART_BUTTONS = {
  "books-start-session": { source: "books", defaultName: "Leer" },
  "videos-start-session": { source: "videos", defaultName: "YouTube" },
  "media-start-session": { source: "media", defaultName: "Pelis" },
  "gym-start-session": { source: "gym", defaultName: "Gym" },
  "recipes-start-session": { source: "recipes", defaultName: "Cooking" },
};

async function waitForHabitsApi(ensureHabitsApi, timeoutMs = 8000) {
  const start = Date.now();
  while (Date.now() - start <= timeoutMs) {
    const api = await ensureHabitsApi();
    if (api && typeof api.startHabitSessionUniversal === "function") {
      console.log("[quick-session] habits api lista");
      return api;
    }
    await new Promise((resolve) => window.setTimeout(resolve, 120));
  }
  console.warn("[quick-session] habits api no disponible tras esperar", { timeoutMs });
  return null;
}

function foldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function ensureQuickStartModal() {
  let root = document.getElementById(QUICKSTART_MODAL_ID);
  if (root) return root;

  root = document.createElement("div");
  root.id = QUICKSTART_MODAL_ID;
  root.style.cssText = "position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:2000;display:none;align-items:center;justify-content:center;padding:16px;";
  root.innerHTML = `
    <div style="width:min(520px,100%);background:#0f1117;border:1px solid rgba(255,255,255,.12);border-radius:14px;padding:14px;display:grid;gap:10px;">
      <div id="quickstart-modal-title" style="font-weight:700;font-size:15px;"></div>
      <input id="quickstart-modal-search" type="search" placeholder="Buscar hábito exacto..." style="width:100%;padding:10px;border-radius:10px;border:1px solid rgba(255,255,255,.18);background:#111522;color:#fff;"/>
      <div id="quickstart-modal-list" style="max-height:280px;overflow:auto;display:grid;gap:6px;"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;">
        <button id="quickstart-modal-cancel" class="btn ghost btn-compact" type="button">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  return root;
}

function openSelectionModal({ title, options, initialSearch = "", emptyText = "Sin resultados." }) {
  const modal = ensureQuickStartModal();
  const titleEl = modal.querySelector("#quickstart-modal-title");
  const searchEl = modal.querySelector("#quickstart-modal-search");
  const listEl = modal.querySelector("#quickstart-modal-list");
  const cancelBtn = modal.querySelector("#quickstart-modal-cancel");
  titleEl.textContent = title;
  searchEl.value = initialSearch;

  return new Promise((resolve) => {
    const close = (value = null) => {
      modal.style.display = "none";
      searchEl.removeEventListener("input", refresh);
      cancelBtn.removeEventListener("click", onCancel);
      modal.removeEventListener("click", onBackdrop);
      resolve(value);
    };

    const renderItems = (items) => {
      listEl.innerHTML = "";
      if (!items.length) {
        const empty = document.createElement("div");
        empty.style.opacity = "0.8";
        empty.textContent = emptyText;
        listEl.appendChild(empty);
        return;
      }

      items.forEach((item) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "btn ghost btn-compact";
        btn.style.textAlign = "left";
        btn.textContent = item.label;
        btn.addEventListener("click", () => close(item.value));
        listEl.appendChild(btn);
      });
    };

    const refresh = () => {
      const query = foldKey(searchEl.value);
      const filtered = options.filter((option) => {
        if (!query) return true;
        return foldKey(option.label).includes(query) || foldKey(option.name || "") === query;
      });
      renderItems(filtered);
    };

    const onCancel = () => close(null);
    const onBackdrop = (event) => {
      if (event.target === modal) close(null);
    };

    searchEl.addEventListener("input", refresh);
    cancelBtn.addEventListener("click", onCancel);
    modal.addEventListener("click", onBackdrop);
    modal.style.display = "flex";
    refresh();
    searchEl.focus();
    searchEl.select();
  });
}

async function chooseHabitNameForMedia() {
  return openSelectionModal({
    title: "Media · Elige hábito",
    options: [
      { label: "Pelis", value: "Pelis", name: "Pelis" },
      { label: "Series", value: "Series", name: "Series" },
      { label: "Anime", value: "Anime", name: "Anime" },
    ],
    emptyText: "Elige Pelis, Series o Anime.",
  });
}

async function pickHabitId(api, title, search, preferredMatches = []) {
  const all = Array.isArray(api.listActiveHabits?.()) ? api.listActiveHabits() : [];
  const options = all
    .map((habit) => ({
      label: `${habit.emoji || "🏷️"} ${habit.name}`,
      name: habit.name,
      value: habit.id,
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const seed = preferredMatches.length
    ? preferredMatches.map((habit) => ({
      label: `${habit.emoji || "🏷️"} ${habit.name}`,
      name: habit.name,
      value: habit.id,
    }))
    : options;

  return openSelectionModal({
    title,
    options: seed,
    initialSearch: search,
    emptyText: "No hay hábitos que coincidan.",
  });
}

async function maybeHandleRunningSession(api, nextHabitId, nextHabitName) {
  const running = api.getRunningHabitSession?.();
  if (!running) return true;

  const action = await openSelectionModal({
    title: `Ya hay una sesión en curso${nextHabitName ? ` · ${nextHabitName}` : ""}`,
    options: [
      { label: "Parar", value: "stop", name: "Parar" },
      { label: "Cambiar", value: "switch", name: "Cambiar" },
      { label: "Cancelar", value: "cancel", name: "Cancelar" },
    ],
  });

  if (!action || action === "cancel") return false;
  if (action === "stop") {
    await api.stopHabitSessionUniversal?.();
    return false;
  }

  await api.stopHabitSessionUniversal?.();
  await api.startHabitSessionUniversal?.(nextHabitId, null);
  return false;
}

async function startFromConfig(config, ensureHabitsApi) {
  console.log("[quick-session] iniciar flujo", { source: config?.source, defaultName: config?.defaultName });
  const api = await waitForHabitsApi(ensureHabitsApi);
  if (!api) {
    console.warn("[quick-session] flujo cancelado: sin api de hábitos");
    return;
  }

  let resolvedName = config.defaultName;
  if (config.source === "media") {
    const selected = await chooseHabitNameForMedia();
    if (!selected) return;
    resolvedName = selected;
  }

  const result = api.resolveHabitIdByName?.(resolvedName);
  console.log("[quick-session] resultado resolveHabitIdByName", { resolvedName, status: result?.status || null });
  let habitId = result?.habitId || null;

  if (result?.status === "multiple") {
    habitId = await pickHabitId(
      api,
      `Selecciona hábito (${resolvedName})`,
      resolvedName,
      result.matches || []
    );
  } else if (result?.status !== "single") {
    habitId = await pickHabitId(
      api,
      `No existe "${resolvedName}". Elige hábito`,
      resolvedName,
      []
    );
  }

  if (!habitId) return;

  const all = Array.isArray(api.listActiveHabits?.()) ? api.listActiveHabits() : [];
  const next = all.find((habit) => habit.id === habitId);
  const shouldContinue = await maybeHandleRunningSession(api, habitId, next?.name || resolvedName);
  if (!shouldContinue) return;

  console.log("[quick-session] iniciando sesión", { habitId, source: config.source });
  await api.startHabitSessionUniversal?.(habitId, { source: config.source });
}

export function initSessionQuickstart({ ensureHabitsApi }) {
  if (typeof ensureHabitsApi !== "function") return;
  if (window.__bookshellQuickstartBound) return;

  document.addEventListener("click", (event) => {
    const button = event.target?.closest?.("button[id]");
    if (!button) return;

    const config = QUICKSTART_BUTTONS[button.id];
    if (!config) return;

    console.log("[quick-session] click quickstart", { buttonId: button.id, source: config.source });
    event.preventDefault();
    if (button.dataset.sessionBusy === "1") return;

    button.dataset.sessionBusy = "1";
    Promise.resolve(startFromConfig(config, ensureHabitsApi))
      .catch((error) => {
        console.warn("[session-quickstart] no se pudo iniciar la sesión", error);
      })
      .finally(() => {
        delete button.dataset.sessionBusy;
      });
  }, true);

  window.__bookshellQuickstartBound = true;
}
