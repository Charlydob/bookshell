import { auth, db, onUserChange } from "../../shared/firebase/index.js";
import {
  onValue,
  push,
  ref,
  remove,
  set,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const STATUS_LABELS = {
  idea: "Idea",
  drafting: "Borrador",
  editing: "Edición",
  published: "Publicado",
};

const state = {
  initialized: false,
  root: null,
  uid: "",
  path: "",
  videos: {},
  selectedVideoId: "",
  viewTab: "list",
  filters: { search: "", status: "all", category: "all", sort: "recent" },
  statsFilters: { range: 30, status: "all", category: "all" },
  listeners: [],
  authUnsub: null,
  saveTimer: null,
  statusTimer: null,
  htmlMounted: false,
  eventsBound: false,
};

const els = {};

function emitVideosHubData(reason = "") {
  try {
    window.dispatchEvent(new CustomEvent("bookshell:data", { detail: { source: "videos", reason } }));
    return;
  } catch (_) {}
  try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
}

function getTodayKey() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function countWords(text) {
  const cleaned = String(text || "").trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).filter(Boolean).length;
}

function formatDate(ts) {
  if (!ts) return "—";
  const dt = new Date(Number(ts));
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" });
}

function fmtNumber(n) {
  return Number(n || 0).toLocaleString("es-ES");
}

function toDateInputValue(ts) {
  if (!ts) return "";
  const dt = new Date(Number(ts));
  if (Number.isNaN(dt.getTime())) return "";
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const d = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateInputToTs(value) {
  if (!value) return null;
  const parsed = new Date(`${value}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getTime();
}

function getVideosArray() {
  return Object.entries(state.videos || {}).map(([id, video]) => ({ id, ...(video || {}) }));
}

function getVideoProgress(video) {
  const target = Math.max(0, Number(video?.targetWords) || 0);
  const words = Math.max(0, Number(video?.wordCount) || 0);
  if (!target) return words ? Math.min(100, Math.round(words / 12)) : 0;
  return Math.max(0, Math.min(100, Math.round((words / target) * 100)));
}

function getActiveVideo() {
  if (!state.selectedVideoId) return null;
  const video = state.videos[state.selectedVideoId];
  if (!video) return null;
  return { id: state.selectedVideoId, ...video };
}

function setAutoSaveStatus(text) {
  if (!els.autosave) return;
  els.autosave.textContent = text;
  clearTimeout(state.statusTimer);
  state.statusTimer = window.setTimeout(() => {
    if (els.autosave) els.autosave.textContent = "Guardado automático";
  }, 1200);
}

function setUnauthenticatedState() {
  state.videos = {};
  state.selectedVideoId = "";
  state.path = "";
  state.viewTab = "list";

  if (els.list) {
    els.list.innerHTML = '<div class="glassCard videosHub__empty">Inicia sesión para usar Vídeos Hub.</div>';
  }

  if (els.metrics) {
    els.metrics.innerHTML = '<div class="videosHub__metric"><small>Sin sesión</small><strong>Conecta tu cuenta</strong></div>';
  }

  if (els.kpis) els.kpis.innerHTML = "";
  if (els.chartLine) els.chartLine.innerHTML = "";
  if (els.chartBars) els.chartBars.innerHTML = "";
  if (els.chartDonut) els.chartDonut.innerHTML = "";
  if (els.videoCompare) els.videoCompare.innerHTML = "";

  [els.title, els.status, els.category, els.target, els.date, els.script, els.deleteBtn].forEach((el) => {
    if (el) el.disabled = true;
  });
}

function renderTabs() {
  state.root?.querySelectorAll(".videosHub__tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.hubTab === state.viewTab);
  });

  state.root?.querySelectorAll(".videosHub__panel").forEach((panel) => {
    panel.classList.toggle("is-active", panel.dataset.hubPanel === state.viewTab);
  });
}

function applyVideoFilters(videos) {
  const query = state.filters.search.trim().toLowerCase();
  const statusFilter = state.filters.status;
  const categoryFilter = state.filters.category;

  const filtered = videos.filter((video) => {
    if (statusFilter !== "all" && (video.status || "idea") !== statusFilter) return false;
    if (categoryFilter !== "all" && (video.category || "Sin categoría") !== categoryFilter) return false;
    if (!query) return true;
    const haystack = `${video.title || ""} ${video.script || ""} ${video.category || ""}`.toLowerCase();
    return haystack.includes(query);
  });

  if (state.filters.sort === "words") {
    filtered.sort((a, b) => (Number(b.wordCount) || 0) - (Number(a.wordCount) || 0));
  } else if (state.filters.sort === "progress") {
    filtered.sort((a, b) => getVideoProgress(b) - getVideoProgress(a));
  } else {
    filtered.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
  }

  return filtered;
}

function renderList() {
  const videos = applyVideoFilters(getVideosArray());
  if (!els.list) return;

  if (!videos.length) {
    els.list.innerHTML = '<div class="glassCard videosHub__empty">No hay vídeos con esos filtros.</div>';
    return;
  }

  els.list.innerHTML = videos.map((video) => {
    const progress = getVideoProgress(video);
    const isActive = video.id === state.selectedVideoId;
    const todayWords = Number(video?.dailyWordHistory?.[getTodayKey()] || 0);

    return `
      <article class="glassCard videosHub__card ${isActive ? "is-active" : ""}" data-open-video="${video.id}">
        <div class="videosHub__cardHead">
          <h3>${video.title || "Sin título"}</h3>
          <span class="videosHub__status videosHub__status--${video.status || "idea"}">${STATUS_LABELS[video.status || "idea"] || "Idea"}</span>
        </div>
        <div class="videosHub__meta">
          <span>${video.category || "Sin categoría"}</span>
          <span>${fmtNumber(video.wordCount)} palabras · +${fmtNumber(todayWords)} hoy</span>
        </div>
        <div class="videosHub__progressTrack"><i style="width:${progress}%"></i></div>
      </article>
    `;
  }).join("");
}

function renderDetail() {
  const video = getActiveVideo();
  const disabled = !video;

  [els.title, els.status, els.category, els.target, els.date, els.script, els.deleteBtn].forEach((el) => {
    if (el) el.disabled = disabled;
  });

  if (!video) {
    if (els.title) els.title.value = "";
    if (els.status) els.status.value = "";
    if (els.category) els.category.value = "";
    if (els.target) els.target.value = "";
    if (els.date) els.date.value = "";
    if (els.script) els.script.value = "";
    if (els.wordCount) els.wordCount.textContent = "0 palabras";
    if (els.metrics) {
      els.metrics.innerHTML = '<div class="videosHub__metric"><small>Sin vídeo activo</small><strong>Crea o selecciona uno</strong></div>';
    }
    return;
  }

  if (document.activeElement !== els.title) els.title.value = video.title || "";
  if (document.activeElement !== els.status) els.status.value = video.status || "";
  if (document.activeElement !== els.category) els.category.value = video.category || "";
  if (document.activeElement !== els.target) els.target.value = Number(video.targetWords) > 0 ? String(video.targetWords) : "";
  if (document.activeElement !== els.date) els.date.value = toDateInputValue(video.createdAt);
  if (document.activeElement !== els.script) els.script.value = video.script || "";

  const todayWords = Number(video?.dailyWordHistory?.[getTodayKey()] || 0);
  const words = Number(video.wordCount) || 0;
  const totalDays = Object.keys(video.dailyWordHistory || {}).length;
  const pace = totalDays ? Math.round(words / totalDays) : words;

  if (els.wordCount) els.wordCount.textContent = `${fmtNumber(words)} palabras`;
  if (els.metrics) {
    els.metrics.innerHTML = `
      <div class="videosHub__metric"><small>Palabras totales</small><strong>${fmtNumber(words)}</strong></div>
      <div class="videosHub__metric"><small>Palabras hoy</small><strong>${fmtNumber(todayWords)}</strong></div>
      <div class="videosHub__metric"><small>Última edición</small><strong>${formatDate(video.updatedAt)}</strong></div>
      <div class="videosHub__metric"><small>Ritmo</small><strong>${fmtNumber(pace)} /día</strong></div>
    `;
  }
}

function buildStatsSeries(videos, days) {
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const dayKeys = [];
  const daily = [];

  for (let i = days - 1; i >= 0; i -= 1) {
    const dt = new Date(end);
    dt.setDate(end.getDate() - i);
    const key = dt.toISOString().slice(0, 10);
    dayKeys.push(key);

    let total = 0;
    videos.forEach((video) => {
      total += Number(video?.dailyWordHistory?.[key] || 0);
    });
    daily.push(Math.max(0, total));
  }

  return { dayKeys, daily };
}

function renderLineChart(dayKeys, values) {
  if (!els.chartLine) return;
  const width = 360;
  const height = 160;
  const pad = 18;
  const max = Math.max(1, ...values);
  const xStep = values.length > 1 ? (width - pad * 2) / (values.length - 1) : 0;
  const points = values.map((value, i) => {
    const x = pad + i * xStep;
    const y = height - pad - ((value / max) * (height - pad * 2));
    return [x, y];
  });
  const polyline = points.map(([x, y]) => `${x},${y}`).join(" ");
  const labels = dayKeys.filter((_, i) => i % Math.max(1, Math.floor(dayKeys.length / 5)) === 0);

  els.chartLine.innerHTML = `
    <defs>
      <linearGradient id="vh-line" x1="0" x2="1" y1="0" y2="0">
        <stop offset="0%" stop-color="#7aa8ff"></stop>
        <stop offset="100%" stop-color="#57e5c6"></stop>
      </linearGradient>
    </defs>
    <polyline points="${polyline}" fill="none" stroke="url(#vh-line)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"></polyline>
    ${points.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.5" fill="#9bc3ff"></circle>`).join("")}
    <text x="${pad}" y="${height - 2}" fill="rgba(230,238,255,.72)" font-size="9">${labels[0] || ""}</text>
    <text x="${width - pad}" y="${height - 2}" text-anchor="end" fill="rgba(230,238,255,.72)" font-size="9">${labels[labels.length - 1] || ""}</text>
  `;
}

function renderBarChart(values, dayKeys) {
  if (!els.chartBars) return;
  const groups = {};

  dayKeys.forEach((key, idx) => {
    const month = key.slice(0, 7);
    groups[month] = (groups[month] || 0) + values[idx];
  });

  const entries = Object.entries(groups);
  const max = Math.max(1, ...entries.map(([, val]) => val));
  els.chartBars.innerHTML = entries.map(([bucket, val]) => {
    const pct = Math.round((val / max) * 100);
    return `
      <div class="videosHub__barRow">
        <span>${bucket}</span>
        <div class="videosHub__barTrack"><i style="width:${pct}%"></i></div>
        <strong>${fmtNumber(val)}</strong>
      </div>
    `;
  }).join("");
}

function renderDonut(videos) {
  if (!els.chartDonut) return;
  const totals = {};

  videos.forEach((video) => {
    const category = video.category || "Sin categoría";
    totals[category] = (totals[category] || 0) + (Number(video.wordCount) || 0);
  });

  const entries = Object.entries(totals);
  if (!entries.length) {
    els.chartDonut.innerHTML = '<p class="videosHub__emptyInline">Sin datos.</p>';
    return;
  }

  const grandTotal = entries.reduce((acc, [, value]) => acc + value, 0);
  let cursor = 0;
  const colors = ["#8ab8ff", "#6be4c8", "#f9b970", "#bd9dff", "#7ce0ff", "#ffa6c8"];
  const segments = entries.map(([, value], idx) => {
    const from = Math.round((cursor / grandTotal) * 360);
    cursor += value;
    const to = Math.round((cursor / grandTotal) * 360);
    return `${colors[idx % colors.length]} ${from}deg ${to}deg`;
  }).join(", ");

  els.chartDonut.innerHTML = `
    <div class="videosHub__donutChart" style="background:conic-gradient(${segments})"></div>
    <ul class="videosHub__legend">
      ${entries.map(([category, value], idx) => `<li><i style="background:${colors[idx % colors.length]}"></i><span>${category}</span><strong>${fmtNumber(value)}</strong></li>`).join("")}
    </ul>
  `;
}

function renderVideoCompare(videos, days) {
  if (!els.videoCompare) return;
  const top = videos.map((video) => {
    const recent = buildStatsSeries([video], days).daily.reduce((acc, val) => acc + val, 0);
    return { title: video.title || "Sin título", recent, total: Number(video.wordCount) || 0 };
  }).sort((a, b) => b.recent - a.recent).slice(0, 5);

  if (!top.length) {
    els.videoCompare.innerHTML = '<p class="videosHub__emptyInline">Sin vídeos para comparar.</p>';
    return;
  }

  const max = Math.max(1, ...top.map((item) => item.recent));
  els.videoCompare.innerHTML = top.map((item) => {
    const pct = Math.round((item.recent / max) * 100);
    return `
      <div class="videosHub__compareRow">
        <p>${item.title}</p>
        <div class="videosHub__barTrack"><i style="width:${pct}%"></i></div>
        <small>${fmtNumber(item.recent)} (${fmtNumber(item.total)} total)</small>
      </div>
    `;
  }).join("");
}

function renderKpis(videos, values, days) {
  if (!els.kpis) return;
  const totalWords = videos.reduce((acc, video) => acc + (Number(video.wordCount) || 0), 0);
  const recentTotal = values.reduce((acc, value) => acc + value, 0);
  const avgDaily = Math.round(recentTotal / Math.max(1, days));
  const activeVideos = videos.filter((video) => ["drafting", "editing"].includes(video.status)).length;
  const completedVideos = videos.filter((video) => video.status === "published").length;

  const categoryCounter = {};
  videos.forEach((video) => {
    const category = video.category || "Sin categoría";
    categoryCounter[category] = (categoryCounter[category] || 0) + (Number(video.wordCount) || 0);
  });

  const topCategory = Object.entries(categoryCounter).sort((a, b) => b[1] - a[1])[0]?.[0] || "—";
  els.kpis.innerHTML = `
    <article class="glassCard videosHub__kpi"><small>Total palabras</small><strong>${fmtNumber(totalWords)}</strong></article>
    <article class="glassCard videosHub__kpi"><small>Media diaria</small><strong>${fmtNumber(avgDaily)}</strong></article>
    <article class="glassCard videosHub__kpi"><small>Vídeos activos</small><strong>${fmtNumber(activeVideos)}</strong></article>
    <article class="glassCard videosHub__kpi"><small>Terminados</small><strong>${fmtNumber(completedVideos)}</strong></article>
    <article class="glassCard videosHub__kpi videosHub__kpi--wide"><small>Categoría más trabajada</small><strong>${topCategory}</strong></article>
  `;
}

function renderStats() {
  const all = getVideosArray();
  const byStatus = state.statsFilters.status === "all"
    ? all
    : all.filter((video) => (video.status || "idea") === state.statsFilters.status);
  const byCategory = state.statsFilters.category === "all"
    ? byStatus
    : byStatus.filter((video) => (video.category || "Sin categoría") === state.statsFilters.category);

  const days = Number(state.statsFilters.range) || 30;
  const { dayKeys, daily } = buildStatsSeries(byCategory, days);
  renderKpis(byCategory, daily, days);
  renderLineChart(dayKeys, daily);
  renderBarChart(daily, dayKeys);
  renderDonut(byCategory);
  renderVideoCompare(byCategory, days);
}

function fillCategorySelects() {
  const categories = Array.from(new Set(getVideosArray().map((video) => video.category || "Sin categoría"))).sort((a, b) => a.localeCompare(b, "es"));
  const options = ['<option value="all">Todas categorías</option>', ...categories.map((cat) => `<option value="${cat}">${cat}</option>`)];

  if (els.filterCategory) {
    const prev = els.filterCategory.value;
    els.filterCategory.innerHTML = options.join("");
    els.filterCategory.value = categories.includes(prev) ? prev : "all";
    state.filters.category = els.filterCategory.value;
  }

  if (els.statsCategory) {
    const prev = els.statsCategory.value;
    els.statsCategory.innerHTML = options.join("");
    els.statsCategory.value = categories.includes(prev) ? prev : "all";
    state.statsFilters.category = els.statsCategory.value;
  }
}

function renderAll() {
  if (!state.root) return;
  fillCategorySelects();
  renderTabs();
  renderList();
  renderDetail();
  if (state.viewTab === "stats") {
    renderStats();
  }
}

function scheduleScriptSave() {
  const video = getActiveVideo();
  if (!video) return;

  clearTimeout(state.saveTimer);
  setAutoSaveStatus("Guardando…");

  state.saveTimer = window.setTimeout(async () => {
    const script = els.script?.value || "";
    const newWords = countWords(script);
    const oldWords = Number(video.wordCount) || 0;
    const delta = newWords - oldWords;
    const today = getTodayKey();
    const prevToday = Number(video?.dailyWordHistory?.[today] || 0);
    const patch = {
      script,
      wordCount: newWords,
      updatedAt: Date.now(),
      [`dailyWordHistory/${today}`]: prevToday + delta,
    };

    try {
      await update(ref(db, `${state.path}/videos/${video.id}`), patch);
      setAutoSaveStatus("Guardado");
    } catch (err) {
      console.error("[videos-hub] error guardando", err);
      setAutoSaveStatus("Error al guardar");
    }
  }, 700);
}

async function updateVideoMeta(patch) {
  const video = getActiveVideo();
  if (!video) return;

  try {
    await update(ref(db, `${state.path}/videos/${video.id}`), {
      ...patch,
      updatedAt: Date.now(),
    });
  } catch (err) {
    console.error("[videos-hub] error actualizando metadatos", err);
  }
}

async function createVideo() {
  if (!state.path) return;

  const now = Date.now();
  const newRef = push(ref(db, `${state.path}/videos`));
  const record = {
    title: "",
    status: "",
    category: "",
    script: "",
    notes: "",
    wordCount: 0,
    targetWords: 0,
    dailyWordHistory: {},
    createdAt: now,
    updatedAt: now,
    lastEditedAt: now,
  };

  await set(newRef, record);
  state.selectedVideoId = newRef.key;
  state.viewTab = "detail";
  renderAll();
  els.script?.focus();
}

async function deleteActiveVideo() {
  const video = getActiveVideo();
  if (!video) return;

  const title = video.title?.trim() || "este vídeo";
  const shouldDelete = window.confirm(`¿Eliminar ${title}?`);
  if (!shouldDelete) return;

  try {
    await remove(ref(db, `${state.path}/videos/${video.id}`));
    state.selectedVideoId = "";
    state.viewTab = "list";
    renderAll();
  } catch (err) {
    console.error("[videos-hub] error eliminando vídeo", err);
  }
}

function bindEvents() {
  if (state.eventsBound || !state.root) return;

  els.createBtn?.addEventListener("click", () => {
    void createVideo();
  });

  state.root.querySelectorAll(".videosHub__tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.viewTab = btn.dataset.hubTab || "list";
      renderTabs();
      if (state.viewTab === "stats") renderStats();
    });
  });

  els.list?.addEventListener("click", (event) => {
    const card = event.target?.closest?.("[data-open-video]");
    if (!card) return;
    state.selectedVideoId = card.dataset.openVideo || "";
    state.viewTab = "detail";
    renderAll();
  });

  els.search?.addEventListener("input", () => {
    state.filters.search = els.search.value || "";
    renderList();
  });
  els.filterStatus?.addEventListener("change", () => {
    state.filters.status = els.filterStatus.value || "all";
    renderList();
  });
  els.filterCategory?.addEventListener("change", () => {
    state.filters.category = els.filterCategory.value || "all";
    renderList();
  });
  els.sort?.addEventListener("change", () => {
    state.filters.sort = els.sort.value || "recent";
    renderList();
  });

  els.backBtn?.addEventListener("click", () => {
    state.viewTab = "list";
    renderTabs();
  });
  els.deleteBtn?.addEventListener("click", () => {
    void deleteActiveVideo();
  });

  els.title?.addEventListener("change", () => updateVideoMeta({ title: els.title.value.trim() }));
  els.status?.addEventListener("change", () => updateVideoMeta({ status: els.status.value || "" }));
  els.category?.addEventListener("change", () => updateVideoMeta({ category: els.category.value.trim() }));
  els.target?.addEventListener("change", () => updateVideoMeta({ targetWords: Math.max(0, Number(els.target.value) || 0) }));
  els.date?.addEventListener("change", () => {
    const manualDate = dateInputToTs(els.date.value || "");
    if (!manualDate) return;
    updateVideoMeta({ createdAt: manualDate });
  });
  els.script?.addEventListener("input", () => {
    const words = countWords(els.script.value || "");
    if (els.wordCount) els.wordCount.textContent = `${fmtNumber(words)} palabras`;
    scheduleScriptSave();
  });

  els.statsRange?.addEventListener("change", () => {
    state.statsFilters.range = Number(els.statsRange.value) || 30;
    renderStats();
  });
  els.statsStatus?.addEventListener("change", () => {
    state.statsFilters.status = els.statsStatus.value || "all";
    renderStats();
  });
  els.statsCategory?.addEventListener("change", () => {
    state.statsFilters.category = els.statsCategory.value || "all";
    renderStats();
  });

  state.eventsBound = true;
}

function stopDataSubscriptions() {
  state.listeners.forEach((off) => off?.());
  state.listeners = [];
}

function subscribeData() {
  if (!state.path) return;
  stopDataSubscriptions();

  const stop = onValue(ref(db, `${state.path}/videos`), (snap) => {
    state.videos = snap.val() || {};
    const hasSelected = state.selectedVideoId && state.videos[state.selectedVideoId];
    if (!hasSelected) {
      const first = Object.entries(state.videos)
        .sort((a, b) => (Number(b[1]?.updatedAt) || 0) - (Number(a[1]?.updatedAt) || 0))[0];
      state.selectedVideoId = first?.[0] || "";
    }
    renderAll();
    emitVideosHubData("remote:videos");
  });

  state.listeners.push(stop);
}

function cacheElements(root) {
  state.root = root;
  els.createBtn = root.querySelector("#videos-hub-create-btn");
  els.list = root.querySelector("#videos-hub-list");
  els.search = root.querySelector("#videos-hub-search");
  els.filterStatus = root.querySelector("#videos-hub-filter-status");
  els.filterCategory = root.querySelector("#videos-hub-filter-category");
  els.sort = root.querySelector("#videos-hub-sort");
  els.backBtn = root.querySelector("#videos-hub-back-btn");
  els.deleteBtn = root.querySelector("#videos-hub-delete-btn");
  els.title = root.querySelector("#videos-hub-title");
  els.status = root.querySelector("#videos-hub-status");
  els.category = root.querySelector("#videos-hub-category");
  els.target = root.querySelector("#videos-hub-target");
  els.date = root.querySelector("#videos-hub-date");
  els.script = root.querySelector("#videos-hub-script");
  els.wordCount = root.querySelector("#videos-hub-word-count");
  els.autosave = root.querySelector("#videos-hub-autosave");
  els.metrics = root.querySelector("#videos-hub-metrics");
  els.statsRange = root.querySelector("#videos-hub-stats-range");
  els.statsStatus = root.querySelector("#videos-hub-stats-status");
  els.statsCategory = root.querySelector("#videos-hub-stats-category");
  els.kpis = root.querySelector("#videos-hub-kpis");
  els.chartLine = root.querySelector("#videos-hub-chart-line");
  els.chartBars = root.querySelector("#videos-hub-chart-bars");
  els.chartDonut = root.querySelector("#videos-hub-chart-donut");
  els.videoCompare = root.querySelector("#videos-hub-video-compare");
}

function handleAuthUser(user) {
  clearTimeout(state.saveTimer);
  stopDataSubscriptions();

  if (!user?.uid) {
    state.uid = "";
    setUnauthenticatedState();
    renderTabs();
    return;
  }

  state.uid = user.uid;
  state.path = `v2/users/${user.uid}/videosHub`;
  subscribeData();
}

export async function init({ root }) {
  if (!root) return;

  cacheElements(root);
  bindEvents();

  if (!state.authUnsub) {
    state.authUnsub = onUserChange((user) => {
      handleAuthUser(user || auth.currentUser || null);
    });
  }

  handleAuthUser(auth.currentUser || null);
  renderAll();
  state.initialized = true;
  window.__bookshellVideosHub = {
    getAchievementsSnapshot: () => ({ ...(state.videos || {}) }),
  };
}

export async function onShow() {
  if (state.uid && state.path && !state.listeners.length) {
    subscribeData();
  }
  renderAll();
}

export async function onHide() {
  clearTimeout(state.saveTimer);
  clearTimeout(state.statusTimer);
  stopDataSubscriptions();
}

export function destroy() {
  void onHide();
}
