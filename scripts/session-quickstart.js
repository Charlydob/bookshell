function foldKey(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function waitForHabitsApi(timeoutMs = 8000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const tick = () => {
      const api = window.__bookshellHabits;
      if (api && typeof api.startHabitSessionUniversal === "function") {
        resolve(api);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, 120);
    };
    tick();
  });
}

function ensureQuickStartModal() {
  let root = document.getElementById("quickstart-session-modal");
  if (root) return root;
  root = document.createElement("div");
  root.id = "quickstart-session-modal";
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
      const q = foldKey(searchEl.value);
      const filtered = options.filter((opt) => {
        if (!q) return true;
        return foldKey(opt.label).includes(q) || foldKey(opt.name || "") === q;
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
  const selected = await openSelectionModal({
    title: "Media · Elige hábito",
    options: [
      { label: "Pelis", value: "Pelis", name: "Pelis" },
      { label: "Series", value: "Series", name: "Series" },
      { label: "Anime", value: "Anime", name: "Anime" }
    ],
    emptyText: "Elige Pelis, Series o Anime."
  });
  return selected;
}

async function pickHabitId(api, title, search, preferredMatches = []) {
  const all = Array.isArray(api.listActiveHabits?.()) ? api.listActiveHabits() : [];
  const options = all
    .map((habit) => ({
      label: `${habit.emoji || "🏷️"} ${habit.name}`,
      name: habit.name,
      value: habit.id
    }))
    .sort((a, b) => a.label.localeCompare(b.label, "es"));
  const seed = preferredMatches.length
    ? preferredMatches.map((habit) => ({ label: `${habit.emoji || "🏷️"} ${habit.name}`, name: habit.name, value: habit.id }))
    : options;
  return openSelectionModal({
    title,
    options: seed,
    initialSearch: search,
    emptyText: "No hay hábitos que coincidan."
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
      { label: "Cancelar", value: "cancel", name: "Cancelar" }
    ]
  });
  if (!action || action === "cancel") return false;
  if (action === "stop") {
    api.stopHabitSessionUniversal();
    return false;
  }
  api.stopHabitSessionUniversal();
  api.startHabitSessionUniversal(nextHabitId, null);
  return false;
}

async function startFromName({ source, defaultName }) {
  const api = await waitForHabitsApi();
  if (!api) return;

  let resolvedName = defaultName;
  if (source === "media") {
    const chosen = await chooseHabitNameForMedia();
    if (!chosen) return;
    resolvedName = chosen;
  }

  const result = api.resolveHabitIdByName?.(resolvedName);
  let habitId = result?.habitId || null;

  if (result?.status === "multiple") {
    habitId = await pickHabitId(api, `Selecciona hábito (${resolvedName})`, resolvedName, result.matches || []);
  } else if (result?.status !== "single") {
    habitId = await pickHabitId(api, `No existe "${resolvedName}". Elige hábito`, resolvedName, []);
  }
  if (!habitId) return;

  const all = api.listActiveHabits?.() || [];
  const next = all.find((h) => h.id === habitId);
  const shouldContinue = await maybeHandleRunningSession(api, habitId, next?.name || resolvedName);
  if (!shouldContinue) return;

  api.startHabitSessionUniversal(habitId, { source });
}

function bindQuickStartButton(selector, config) {
  const btn = document.querySelector(selector);
  if (!btn) return;
  btn.addEventListener("click", () => {
    startFromName(config);
  });
}

function initQuickSessionButtons() {
  bindQuickStartButton("#videos-start-session", { source: "videos", defaultName: "YouTube" });
  bindQuickStartButton("#books-start-session", { source: "books", defaultName: "Leer" });
  bindQuickStartButton("#media-start-session", { source: "media", defaultName: "Pelis" });
  bindQuickStartButton("#gym-start-session", { source: "gym", defaultName: "Gym" });
  bindQuickStartButton("#recipes-start-session", { source: "recipes", defaultName: "Cooking" });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initQuickSessionButtons, { once: true });
} else {
  initQuickSessionButtons();
}
