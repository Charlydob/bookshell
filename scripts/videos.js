// videos.js
// Lógica pestaña "Vídeos YouTube": stats, calendario, tarjetas y log diario

import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  push,
  set,
  remove,
  update,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

// === Firebase shared app ===
const firebaseConfig = {
  apiKey: "AIzaSyC1oqRk7GpYX854RfcGrYHt6iRun5TfuYE",
  authDomain: "bookshell-59703.firebaseapp.com",
  databaseURL: "https://bookshell-59703-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bookshell-59703",
  storageBucket: "bookshell-59703.appspot.com",
  messagingSenderId: "554557230752",
  appId: "1:554557230752:web:37c24e287210433cf883c5"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);

// Rutas
const VIDEOS_PATH = "videos";
const VIDEO_LOG_PATH = "videoLog";
const VIDEO_WORK_PATH = "videoWorkLog";
const LINKS_PATH = "links";

// Estado
let videos = {};
let videoLog = {}; // { "YYYY-MM-DD": { videoId: { w, s } } }
let videoWorkLog = {}; // { "YYYY-MM-DD": seconds }
let videoCalYear;
let videoCalMonth;
let videoCalViewMode = "month";
let activeScriptVideoId = null;
let activeVideoDayKey = null;
let quill = null;
let scriptDirty = false;
let scriptSaveTimer = null;
let wordCountTimer = null;
let currentCountSettings = null;
let currentScriptTarget = 0;
let currentScriptWords = 0;
let currentScriptTitle = "";
let annotationRange = null;
let annotationEditingId = null;
let annotationSelectionText = "";
let teleprompterTimer = null;
let teleprompterPlaying = false;
let teleprompterSentences = [];
let teleprompterActiveIndex = -1;
let links = {};
let linkPickerMode = "script";
let linkPickerSelectHandler = null;

const SCRIPT_SAVE_DEBOUNCE = 1000;
const WORD_COUNT_DEBOUNCE = 200;
const SCRIPT_PPM_KEY = "bookshell_video_script_ppm_v1";
const TELEPROMPTER_PPM_KEY = "bookshell_video_teleprompter_ppm_v1";

const DEFAULT_COUNT_SETTINGS = {
  countHeadings: false,
  countHashtags: true,
  countLinks: true,
  countUrls: false,
  countLists: true,
  excludeAnnotations: true,
  ignoreTags: true
};

const STATE_STORAGE_KEY = "bookshell_video_state_v1";
const state = {
  ideas: [],
  links: [],
  scripts: [],
  records: []
};

function loadState() {
  try {
    const raw = localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.ideas = Array.isArray(parsed?.ideas) ? parsed.ideas : [];
    state.links = Array.isArray(parsed?.links) ? parsed.links : [];
    state.scripts = Array.isArray(parsed?.scripts) ? parsed.scripts : [];
    state.records = Array.isArray(parsed?.records) ? parsed.records : [];
  } catch (err) {
    console.warn("No se pudo cargar el estado local", err);
  }
}

function saveState() {
  try {
    localStorage.setItem(STATE_STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn("No se pudo guardar el estado local", err);
  }
}

function rebuildState() {
  const allVideos = Object.entries(videos || {}).map(([id, item]) => ({ id, ...(item || {}) }));
  state.ideas = allVideos.filter((item) => item.type === "idea" || item.status === "idea");
  state.scripts = allVideos.filter((item) => item.type !== "idea" && item.status !== "idea");
  state.links = Object.entries(links || {}).map(([id, item]) => ({ id, ...(item || {}) }));

  const records = [];
  Object.entries(videoLog || {}).forEach(([day, perVideo]) => {
    Object.entries(perVideo || {}).forEach(([videoId, log]) => {
      const words = Math.max(0, Number(log?.w) || 0);
      const seconds = Math.max(0, Number(log?.s) || 0);
      if (words === 0 && seconds === 0) return;
      records.push({
        id: `${day}:${videoId}`,
        day,
        videoId,
        words,
        seconds
      });
    });
  });
  state.records = records;
  saveState();
}

loadState();

function normalizeUrl(raw) {
  if (!raw) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("www.")) return `https://${trimmed}`;
  return `https://${trimmed}`;
}

function tagsInputToArray(raw) {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((tag) => tag.replace(/^#+/, "").trim())
    .filter(Boolean);
}

function formatTagsForStorage(raw) {
  const tags = tagsInputToArray(raw);
  if (!tags.length) return "";
  return tags.map((tag) => `#${tag}`).join(" ");
}

function tagsToCsv(raw) {
  if (!raw) return "";
  if (Array.isArray(raw)) return raw.join(", ");
  const cleaned = String(raw)
    .replace(/#/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";
  return cleaned.split(" ").filter(Boolean).join(", ");
}

function formatTagsForDisplay(raw) {
  if (!raw) return "";
  if (Array.isArray(raw)) {
    return raw.map((tag) => (tag.startsWith("#") ? tag : `#${tag}`)).join(" ");
  }
  const str = String(raw).trim();
  if (!str) return "";
  if (str.includes("#")) return str;
  return formatTagsForStorage(str);
}

function getItem(entityType, id) {
  if (!id) return null;
  if (entityType === "link") return links?.[id] ? { id, ...(links[id] || {}) } : null;
  if (entityType === "idea" || entityType === "script") {
    return videos?.[id] ? { id, ...(videos[id] || {}) } : null;
  }
  if (entityType === "record") {
    return state.records.find((record) => record.id === id) || null;
  }
  return null;
}

async function updateItem(entityType, id, patch = {}) {
  if (!id) return;
  const now = Date.now();
  if (entityType === "link") {
    links[id] = { ...(links[id] || {}), ...patch, updatedAt: now };
    rebuildState();
    renderLinksList();
    renderLinkPickerList();
    await update(ref(db, `${LINKS_PATH}/${id}`), { ...patch, updatedAt: now });
    return;
  }
  if (entityType === "idea" || entityType === "script") {
    videos[id] = { ...(videos[id] || {}), ...patch, updatedAt: now };
    rebuildState();
    renderVideos();
    renderVideoStats();
    renderVideoCalendar();
    await update(ref(db, `${VIDEOS_PATH}/${id}`), { ...patch, updatedAt: now });
    return;
  }
  if (entityType === "record") {
    const record = getItem("record", id);
    if (!record) return;
    const safeWords = Math.max(0, Number(patch.words ?? record.words) || 0);
    const safeSeconds = Math.max(0, Number(patch.seconds ?? record.seconds) || 0);
    if (!videoLog[record.day]) videoLog[record.day] = {};
    videoLog[record.day][record.videoId] = { w: safeWords, s: safeSeconds };
    rebuildState();
    renderVideoStats();
    renderVideoCalendar();
    if (activeVideoDayKey === record.day) openVideoDayView(record.day);
    await update(ref(db, `${VIDEO_LOG_PATH}/${record.day}/${record.videoId}`), {
      w: safeWords,
      s: safeSeconds
    });
  }
}

async function deleteItem(entityType, id) {
  if (!id) return;
  if (entityType === "link") {
    delete links[id];
    rebuildState();
    renderLinksList();
    renderLinkPickerList();
    await remove(ref(db, `${LINKS_PATH}/${id}`));
    return;
  }
  if (entityType === "idea" || entityType === "script") {
    const updates = {};
    Object.entries(videoLog || {}).forEach(([day, perVideo]) => {
      if (perVideo?.[id]) {
        updates[`${day}/${id}`] = null;
      }
    });
    delete videos[id];
    if (videoLog && typeof videoLog === "object") {
      Object.keys(videoLog).forEach((day) => {
        if (videoLog?.[day]?.[id]) {
          delete videoLog[day][id];
        }
      });
    }
    rebuildState();
    renderVideos();
    renderVideoStats();
    renderVideoCalendar();
    if (Object.keys(updates).length) {
      await update(ref(db, VIDEO_LOG_PATH), updates);
    }
    await remove(ref(db, `${VIDEOS_PATH}/${id}`));
    return;
  }
  if (entityType === "record") {
    const record = getItem("record", id);
    if (!record) return;
    if (videoLog?.[record.day]) {
      delete videoLog[record.day][record.videoId];
      if (!Object.keys(videoLog[record.day]).length) delete videoLog[record.day];
    }
    rebuildState();
    renderVideoStats();
    renderVideoCalendar();
    if (activeVideoDayKey === record.day) openVideoDayView(record.day);
    await remove(ref(db, `${VIDEO_LOG_PATH}/${record.day}/${record.videoId}`));
  }
}

// Utils fecha
function todayKey() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`; // YYYY-MM-DD local
}

function normalizeDateKey(dateStr) {
  if (!dateStr) return "";
  // Si ya viene como YYYY-MM-DD, úsalo tal cual
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
  // Intento best-effort (por si algún día guardas ISO completo)
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return String(dateStr);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


function formatMonthLabel(year, month) {
  const names = [
    "enero","febrero","marzo","abril","mayo","junio",
    "julio","agosto","septiembre","octubre","noviembre","diciembre"
  ];
  return `${names[month]} ${year}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}


// Utils tiempo edición
function toSeconds(min, sec) {
  return (Number(min) || 0) * 60 + (Number(sec) || 0);
}

function splitSeconds(total) {
  const s = Math.max(0, Number(total) || 0);
  const min = Math.floor(s / 60);
  const sec = s % 60;
  return { min, sec };
}

function formatWorkTime(totalSeconds) {
  const s = Math.max(0, Number(totalSeconds) || 0);
  if (s < 3600) {
    const m = Math.round(s / 60);
    return m <= 1 ? `${m} min` : `${m} min`;
  }
  if (s < 86400) {
    const h = (s / 3600).toFixed(1);
    return `${h} h`;
  }
  const d = (s / 86400).toFixed(1);
  return `${d} d`;
}

function formatHHMMSS(totalSeconds) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function dateToKey(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function normalizeNumberField(el, max = null) {
  if (!el) return;
  el.addEventListener("input", () => {
    let v = (el.value || "").replace(/\D+/g, "");
    if (v === "") v = "0";
    let num = Number(v);
    if (max != null && num > max) num = max;
    el.value = String(num);
  });
}

function setActiveView(viewId) {
  if (!viewId) return;
  if (typeof window.__bookshellSetView === "function") {
    if (window.__bookshellDebugDeepLink) {
      console.log("[NAV] setActiveView -> __bookshellSetView", { viewId }, new Error().stack);
    }
    window.__bookshellSetView(viewId);
    return;
  }
  if (window.__bookshellDebugDeepLink) {
    console.log("[NAV] setActiveView", { viewId }, new Error().stack);
  }
  document.querySelectorAll(".view").forEach((v) => v.classList.remove("view-active"));
  const target = document.getElementById(viewId);
  if (target) target.classList.add("view-active");
}

// === DOM refs (solo si existe la pestaña) ===
const $viewVideos = document.getElementById("view-videos");
if ($viewVideos) {
  const $videosWrapper = $viewVideos.querySelector(".videos-wrapper");
  const $videosList = document.getElementById("videos-list");
  const $videosEmpty = document.getElementById("videos-empty");
  const $btnAddVideo = document.getElementById("btn-add-video");

  const $videoStatCount = document.getElementById("video-stat-count");
  const $videoStatStreak = document.getElementById("video-stat-streak");
  const $videoStatWords = document.getElementById("video-stat-words");
  const $videoStatTime = document.getElementById("video-stat-time");

  const $videoCalPrev = document.getElementById("video-cal-prev");
  const $videoCalNext = document.getElementById("video-cal-next");
  const $videoCalLabel = document.getElementById("video-cal-label");
  const $videoCalGrid = document.getElementById("video-calendar-grid");
  const $videoCalViewMode = document.getElementById("video-cal-view-mode");
  const $videoCalendarSummary = document.getElementById("video-calendar-summary");

  const $btnAddIdea = document.getElementById("btn-add-idea");

  const $viewVideoScript = document.getElementById("view-video-script");
  const $videoScriptBack = document.getElementById("video-script-back");
  const $videoScriptTitle = document.getElementById("video-script-title");
  const $videoScriptSubtitle = document.getElementById("video-script-subtitle");
  const $videoScriptToolbar = document.getElementById("video-script-toolbar");
  const $videoScriptEditor = document.getElementById("video-script-editor");
  const $videoScriptWordcount = document.getElementById("video-script-wordcount");
  const $videoScriptProgress = document.getElementById("video-script-progress");
  const $videoScriptDuration = document.getElementById("video-script-duration");
  const $videoScriptPpm = document.getElementById("video-script-ppm");
  const $videoScriptCountBadge = document.getElementById("video-script-count-badge");
  const $videoScriptCountToggle = document.getElementById("video-script-count-toggle");
  const $videoScriptCountToggles = document.getElementById("video-script-count-toggles");
  const $videoScriptCountSummary = document.getElementById("video-script-count-summary");
  const $videoScriptTeleprompter = document.getElementById("video-script-teleprompter");
  const $videoScriptInsertLink = document.getElementById("video-script-insert-link");
  const $videoCountSheetBackdrop = document.getElementById("video-count-sheet-backdrop");
  const $videoCountSheet = document.getElementById("video-count-sheet");
  const $videoCountSheetClose = document.getElementById("video-count-sheet-close");
  const $videoLinkPickerBackdrop = document.getElementById("video-link-picker-backdrop");
  const $videoLinkPicker = document.getElementById("video-link-picker");
  const $videoLinkPickerClose = document.getElementById("video-link-picker-close");
  const $videoLinkSearch = document.getElementById("video-link-search");
  const $videoLinkPickerList = document.getElementById("video-link-picker-list");
  const $videoToolbarAnnotate = document.getElementById("video-toolbar-annotate");
  const $videoToolbarMoreToggle = document.getElementById("video-toolbar-more-toggle");
  const $videoToolbarMoreMenu = document.getElementById("video-toolbar-more-menu");

  const $annotationPopup = document.getElementById("video-annotation-popup");
  const $annotationTitle = document.getElementById("video-annotation-title");
  const $annotationSelection = document.getElementById("video-annotation-selection");
  const $annotationText = document.getElementById("video-annotation-text");
  const $annotationCancel = document.getElementById("video-annotation-cancel");
  const $annotationDelete = document.getElementById("video-annotation-delete");
  const $annotationSave = document.getElementById("video-annotation-save");
  const $annotationFab = document.getElementById("video-annotate-fab");

  const $viewTeleprompter = document.getElementById("view-video-teleprompter");
  const $teleprompterBack = document.getElementById("video-teleprompter-back");
  const $teleprompterTitle = document.getElementById("video-teleprompter-title");
  const $teleprompterPlay = document.getElementById("video-teleprompter-play");
  const $teleprompterSpeed = document.getElementById("video-teleprompter-speed");
  const $teleprompterSize = document.getElementById("video-teleprompter-size");
  const $teleprompterHighlight = document.getElementById("video-teleprompter-highlight");
  const $teleprompterBody = document.getElementById("video-teleprompter-body");
  const $teleprompterContent = document.getElementById("video-teleprompter-content");

  const $viewVideoDay = document.getElementById("view-video-day");
  const $videoDayBack = document.getElementById("video-day-back");
  const $videoDayTitle = document.getElementById("video-day-title");
  const $videoDaySummary = document.getElementById("video-day-summary");
  const $videoDayList = document.getElementById("video-day-list");

  const $btnOpenLinks = document.getElementById("btn-open-links");
  const $viewLinks = document.getElementById("view-links");
  const $videoLinksBack = document.getElementById("video-links-back");
  const $videoLinksNew = document.getElementById("video-links-new");
  const $videoLinksList = document.getElementById("video-links-list");
  const $videoLinksEmpty = document.getElementById("video-links-empty");
  const $viewLinksNew = document.getElementById("view-links-new");
  const $videoLinksNewBack = document.getElementById("video-links-new-back");
  const $videoLinksForm = document.getElementById("video-links-form");
  const $videoLinksCancel = document.getElementById("video-links-cancel");
  const $videoLinksSearch = document.getElementById("video-links-search");
  const $videoLinksNewTitle = document.getElementById("video-links-new-title");
  const $videoLinksSave = document.getElementById("video-links-save");
  const $videoLinkId = document.getElementById("video-link-id");
  const $videoLinkUrl = document.getElementById("video-link-url");
  const $videoLinkTitle = document.getElementById("video-link-title");
  const $videoLinkCategory = document.getElementById("video-link-category");
  const $videoLinkNote = document.getElementById("video-link-note");
  const $videoLinkError = document.getElementById("video-link-error");

  // Modal idea
  const $ideaModalBackdrop = document.getElementById("idea-modal-backdrop");
  const $ideaModalTitle = document.getElementById("idea-modal-title");
  const $ideaModalClose = document.getElementById("idea-modal-close");
  const $ideaModalCancel = document.getElementById("idea-modal-cancel");
  const $ideaForm = document.getElementById("idea-form");
  const $ideaId = document.getElementById("idea-id");
  const $ideaTitle = document.getElementById("idea-title");
  const $ideaNotes = document.getElementById("idea-notes");
  const $ideaTags = document.getElementById("idea-tags");
  const $ideaLink = document.getElementById("idea-link");
  const $ideaAddResource = document.getElementById("idea-add-resource");
  const $ideaFormError = document.getElementById("idea-form-error");
  const $ideaFormSave = document.getElementById("idea-form-save");

  // Modal vídeo
  const $videoModalBackdrop = document.getElementById("video-modal-backdrop");
  const $videoModalTitle = document.getElementById("video-modal-title");
  const $videoModalClose = document.getElementById("video-modal-close");
  const $videoModalCancel = document.getElementById("video-modal-cancel");
  const $videoForm = document.getElementById("video-form");
  const $videoFormSave = document.getElementById("video-form-save");
  const $videoId = document.getElementById("video-id");
  const $videoTitle = document.getElementById("video-title");
  const $videoScriptWords = document.getElementById("video-script-words");
  const $videoDurationMin = document.getElementById("video-duration-min");
  const $videoDurationSec = document.getElementById("video-duration-sec");
  const $videoEditedMin = document.getElementById("video-edited-min");
  const $videoEditedSec = document.getElementById("video-edited-sec");
  normalizeNumberField($videoDurationMin);
  normalizeNumberField($videoDurationSec, 59);
  normalizeNumberField($videoEditedMin);
  normalizeNumberField($videoEditedSec, 59);

  const $videoPublishDate = document.getElementById("video-publish-date");
  const $videoStatus = document.getElementById("video-status");

  // Modal registro
  const $recordModalBackdrop = document.getElementById("record-modal-backdrop");
  const $recordModalTitle = document.getElementById("record-modal-title");
  const $recordModalClose = document.getElementById("record-modal-close");
  const $recordModalCancel = document.getElementById("record-modal-cancel");
  const $recordForm = document.getElementById("record-form");
  const $recordId = document.getElementById("record-id");
  const $recordDay = document.getElementById("record-day");
  const $recordVideoId = document.getElementById("record-video-id");
  const $recordWords = document.getElementById("record-words");
  const $recordTimeMin = document.getElementById("record-time-min");
  const $recordTimeSec = document.getElementById("record-time-sec");
  const $recordFormSave = document.getElementById("record-form-save");

  normalizeNumberField($recordWords);
  normalizeNumberField($recordTimeMin);
  normalizeNumberField($recordTimeSec, 59);

  // Modal eliminar
  const $confirmDeleteBackdrop = document.getElementById("confirm-delete-backdrop");
  const $confirmDeleteTitle = document.getElementById("confirm-delete-title");
  const $confirmDeleteText = document.getElementById("confirm-delete-text");
  const $confirmDeleteClose = document.getElementById("confirm-delete-close");
  const $confirmDeleteCancel = document.getElementById("confirm-delete-cancel");
  const $confirmDeleteConfirm = document.getElementById("confirm-delete-confirm");

  let lastFocusedElement = null;
  let activeActionMenu = null;
  let deleteTarget = null;
  let videoToastEl = null;
  let videoToastTimeout = null;

  // === Modal helpers ===
  function ensureVideoToast() {
    if (!videoToastEl) {
      videoToastEl = document.createElement("div");
      videoToastEl.className = "video-toast hidden";
      document.body.appendChild(videoToastEl);
    }
    return videoToastEl;
  }

  function showVideoToast(text) {
    const toast = ensureVideoToast();
    toast.textContent = text;
    toast.classList.remove("hidden");
    if (videoToastTimeout) clearTimeout(videoToastTimeout);
    videoToastTimeout = setTimeout(() => {
      toast.classList.add("hidden");
    }, 2200);
  }

  function closeActiveActionMenu() {
    if (!activeActionMenu) return;
    activeActionMenu.classList.remove("is-open");
    const toggle = activeActionMenu.querySelector(".video-action-menu-toggle");
    if (toggle) toggle.setAttribute("aria-expanded", "false");
    activeActionMenu = null;
  }

  function createActionMenu({ onEdit, onDelete, label }) {
    const actions = document.createElement("div");
    actions.className = "video-action-menu-wrap";

    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "video-trash-btn";
    trash.textContent = "🗑️";
    trash.setAttribute("aria-label", `Eliminar ${label}`);
    trash.addEventListener("click", (event) => {
      event.stopPropagation();
      onDelete?.();
    });

    const menu = document.createElement("div");
    menu.className = "video-action-menu";

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "video-action-menu-toggle";
    toggle.textContent = "⋯";
    toggle.setAttribute("aria-label", `Más acciones de ${label}`);
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      if (activeActionMenu && activeActionMenu !== menu) {
        closeActiveActionMenu();
      }
      const isOpen = menu.classList.toggle("is-open");
      activeActionMenu = isOpen ? menu : null;
      toggle.setAttribute("aria-expanded", String(isOpen));
    });

    const panel = document.createElement("div");
    panel.className = "video-action-menu-panel";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "btn ghost";
    editBtn.textContent = "Editar";
    editBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeActiveActionMenu();
      onEdit?.();
    });

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn ghost danger";
    delBtn.textContent = "Eliminar";
    delBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      closeActiveActionMenu();
      onDelete?.();
    });

    panel.appendChild(editBtn);
    panel.appendChild(delBtn);
    menu.appendChild(toggle);
    menu.appendChild(panel);

    actions.appendChild(trash);
    actions.appendChild(menu);
    actions.openMenu = () => {
      if (activeActionMenu && activeActionMenu !== menu) {
        closeActiveActionMenu();
      }
      menu.classList.add("is-open");
      activeActionMenu = menu;
      toggle.setAttribute("aria-expanded", "true");
    };
    return actions;
  }

  function attachSwipeToMenu(target, onOpenMenu) {
    if (!target) return;
    let startX = 0;
    let startY = 0;
    target.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      startX = touch.clientX;
      startY = touch.clientY;
    }, { passive: true });
    target.addEventListener("touchend", (event) => {
      const touch = event.changedTouches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = Math.abs(touch.clientY - startY);
      if (dx < -60 && dy < 40) {
        onOpenMenu?.();
      }
    });
  }

  function openDeleteModal({ entityType, id, label }) {
    if (!$confirmDeleteBackdrop) return;
    lastFocusedElement = document.activeElement;
    deleteTarget = { entityType, id };
    if ($confirmDeleteTitle) $confirmDeleteTitle.textContent = "Eliminar definitivamente";
    if ($confirmDeleteText) {
      $confirmDeleteText.textContent = `¿Eliminar definitivamente \"${label}\"?`;
    }
    $confirmDeleteBackdrop.classList.remove("hidden");
    $confirmDeleteBackdrop.setAttribute("aria-hidden", "false");
    $confirmDeleteCancel?.focus();
  }

  function closeDeleteModal() {
    if (!$confirmDeleteBackdrop) return;
    $confirmDeleteBackdrop.classList.add("hidden");
    $confirmDeleteBackdrop.setAttribute("aria-hidden", "true");
    deleteTarget = null;
    if (lastFocusedElement?.focus) lastFocusedElement.focus();
  }

  function openRecordModal(record) {
    if (!$recordModalBackdrop || !record) return;
    lastFocusedElement = document.activeElement;
    $recordModalTitle.textContent = "Editar registro";
    $recordId.value = record.id;
    $recordDay.value = record.day;
    $recordVideoId.value = record.videoId;
    $recordWords.value = record.words || 0;
    const split = splitSeconds(record.seconds || 0);
    $recordTimeMin.value = split.min;
    $recordTimeSec.value = split.sec;
    if ($recordFormSave) $recordFormSave.textContent = "Guardar cambios";
    $recordModalBackdrop.classList.remove("hidden");
    $recordModalBackdrop.setAttribute("aria-hidden", "false");
    $recordWords?.focus();
  }

  function closeRecordModal() {
    if (!$recordModalBackdrop) return;
    $recordModalBackdrop.classList.add("hidden");
    $recordModalBackdrop.setAttribute("aria-hidden", "true");
    if (lastFocusedElement?.focus) lastFocusedElement.focus();
  }

  function openVideoModal(id = null) {
    if (id && videos[id]) {
      const v = videos[id];
      $videoModalTitle.textContent = "Editar vídeo";
      $videoId.value = id;
      if ($videoFormSave) $videoFormSave.textContent = "Guardar cambios";
      $videoTitle.value = v.title || "";
$videoScriptWords.value = v.script?.wordCount ?? v.scriptWords ?? 0;

      const dur = splitSeconds(v.durationSeconds || 0);
      $videoDurationMin.value = dur.min;
      $videoDurationSec.value = dur.sec;

      const ed = splitSeconds(v.editedSeconds || 0);
      $videoEditedMin.value = ed.min;
      $videoEditedSec.value = ed.sec;

      $videoPublishDate.value = v.publishDate || "";
      $videoStatus.value = v.status || "script";
    } else {
      $videoModalTitle.textContent = "Nuevo vídeo";
      $videoId.value = "";
      $videoForm.reset();
      if ($videoFormSave) $videoFormSave.textContent = "Guardar";
      $videoScriptWords.value = 0;
      $videoDurationMin.value = 0;
      $videoDurationSec.value = 0;
      $videoEditedMin.value = 0;
      $videoEditedSec.value = 0;
      $videoStatus.value = "script";
    }

    $videoModalBackdrop.classList.remove("hidden");
  }

  function closeVideoModal() {
    $videoModalBackdrop.classList.add("hidden");
  }

  function openIdeaModal(id = null) {
    if (!$ideaModalBackdrop) return;
    if (id && videos[id]) {
      const v = videos[id];
      $ideaModalTitle.textContent = "Editar idea";
      $ideaId.value = id;
      if ($ideaFormSave) $ideaFormSave.textContent = "Guardar cambios";
      $ideaTitle.value = v.title || "";
      $ideaNotes.value = v.ideaNotes || v.notes || "";
      $ideaTags.value = tagsToCsv(v.tags || "");
      $ideaLink.value = v.inspirationUrl || "";
    } else {
      $ideaModalTitle.textContent = "Nueva idea";
      $ideaId.value = "";
      if ($ideaFormSave) $ideaFormSave.textContent = "Guardar";
      $ideaTitle.value = "";
      $ideaNotes.value = "";
      $ideaTags.value = "";
      $ideaLink.value = "";
    }
    if ($ideaFormError) $ideaFormError.textContent = "";
    $ideaModalBackdrop.classList.remove("hidden");
  }

  function closeIdeaModal() {
    if ($ideaModalBackdrop) $ideaModalBackdrop.classList.add("hidden");
  }

  if ($btnAddVideo) {
    $btnAddVideo.addEventListener("click", () => openVideoModal());
  }
  if ($btnAddIdea) {
    $btnAddIdea.addEventListener("click", () => openIdeaModal());
  }

  function loadStoredPpm(key, fallback = 150) {
    const raw = Number(localStorage.getItem(key) || 0);
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return raw;
  }

  function saveStoredPpm(key, value) {
    const v = Math.max(60, Number(value) || 0);
    localStorage.setItem(key, String(v));
  }

  function getVideoCountSettings(video) {
    return {
      ...DEFAULT_COUNT_SETTINGS,
      ...(video?.script?.countSettings || {})
    };
  }

  function getCountSummary(settings) {
    const counting = [];
    const excluding = [];
    if (settings.countHeadings) counting.push("headings"); else excluding.push("headings");
    if (settings.countHashtags) counting.push("hashtags"); else excluding.push("hashtags");
    if (settings.countLinks) counting.push("links"); else excluding.push("links");
    if (settings.countUrls) counting.push("URLs"); else excluding.push("URLs");
    if (settings.countLists) counting.push("listas"); else excluding.push("listas");
    if (settings.excludeAnnotations) excluding.push("anotaciones"); else counting.push("anotaciones");
    if (settings.ignoreTags) excluding.push("tags [PAUSA]"); else counting.push("tags [PAUSA]");
    return `Contando: ${counting.join(", ") || "texto"} · Excluyendo: ${excluding.join(", ") || "nada"}`;
  }

  function getWordTokens(text) {
    if (!text) return [];
    const cleaned = text.normalize("NFKC");
    return cleaned.match(/[\p{L}\p{N}#@]+(?:['’\-][\p{L}\p{N}]+)*/gu) || [];
  }

  function isUrlToken(token) {
    return /^(https?:\/\/|www\.)/i.test(token) || /\.[a-z]{2,}$/i.test(token);
  }

  function computeWordCount(content, settings) {
    const delta = content?.ops ? content : { ops: [] };
    const lines = [];
    let currentLine = { parts: [], attrs: {} };

    delta.ops.forEach((op) => {
      if (typeof op.insert !== "string") return;
      const pieces = op.insert.split("\n");
      pieces.forEach((piece, idx) => {
        if (piece) {
          currentLine.parts.push({ text: piece, attrs: op.attributes || {} });
        }
        if (idx < pieces.length - 1) {
          currentLine.attrs = op.attributes || {};
          lines.push(currentLine);
          currentLine = { parts: [], attrs: {} };
        }
      });
    });
    if (currentLine.parts.length) lines.push(currentLine);

    let count = 0;

    lines.forEach((line) => {
      const isHeading = !!line.attrs?.header;
      const isList = !!line.attrs?.list;
      if (isHeading && !settings.countHeadings) return;
      if (isList && !settings.countLists) return;

      line.parts.forEach((part) => {
        if (settings.excludeAnnotations && part.attrs?.annotation) return;
        if (part.attrs?.resource) return;
        if (part.attrs?.link && !settings.countLinks) return;

        let text = part.text || "";
        if (settings.ignoreTags) {
          text = text.replace(/\[[^\]]+\]/g, " ");
        }

        const tokens = getWordTokens(text);
        tokens.forEach((token) => {
          if (!settings.countHashtags && token.startsWith("#")) return;
          if (!settings.countUrls && isUrlToken(token)) return;
          count += 1;
        });
      });
    });

    return count;
  }

  function updateScriptStats(wordCount) {
    currentScriptWords = wordCount;
    const pct = currentScriptTarget > 0 ? Math.min(100, Math.round((wordCount / currentScriptTarget) * 100)) : 0;
    if ($videoScriptWordcount) $videoScriptWordcount.textContent = wordCount.toLocaleString("es-ES");
    if ($videoScriptProgress) $videoScriptProgress.textContent = `${pct}%`;
    if ($videoScriptCountBadge) {
      $videoScriptCountBadge.textContent = `Palabras: ${wordCount.toLocaleString("es-ES")} · Progreso: ${pct}%`;
    }

    const ppm = Math.max(60, Number($videoScriptPpm?.value) || loadStoredPpm(SCRIPT_PPM_KEY, 150));
    const minutes = wordCount > 0 ? Math.max(1, Math.round(wordCount / ppm)) : 0;
    if ($videoScriptDuration) $videoScriptDuration.textContent = minutes ? `${minutes} min` : "0 min";
  }

  function renderCountToggles(settings) {
    if (!$videoScriptCountToggles) return;
    const items = [
      { key: "countHeadings", label: "Contar headings" },
      { key: "countHashtags", label: "Contar hashtags" },
      { key: "countLinks", label: "Contar links" },
      { key: "countUrls", label: "Contar URLs" },
      { key: "countLists", label: "Contar listas" },
      { key: "excludeAnnotations", label: "Excluir anotaciones" },
      { key: "ignoreTags", label: "Ignorar tags [PAUSA]" }
    ];

    $videoScriptCountToggles.innerHTML = "";
    items.forEach((item) => {
      const label = document.createElement("label");
      label.className = "toggle-pill";
      const input = document.createElement("input");
      input.type = "checkbox";
      input.checked = !!settings[item.key];
      input.addEventListener("change", () => {
        settings[item.key] = input.checked;
        currentCountSettings = { ...settings };
        if ($videoScriptCountSummary) $videoScriptCountSummary.textContent = getCountSummary(settings);
        scriptDirty = true;
        scheduleWordCountUpdate();
        scheduleScriptSave(false);
        saveScriptSettings();
      });
      const span = document.createElement("span");
      span.textContent = item.label;
      label.appendChild(input);
      label.appendChild(span);
      $videoScriptCountToggles.appendChild(label);
    });
    if ($videoScriptCountSummary) $videoScriptCountSummary.textContent = getCountSummary(settings);
  }

  function buildAnnotationBlot() {
    if (!window.Quill) return;
    const Inline = window.Quill.import("blots/inline");
    class AnnotationBlot extends Inline {
      static create(value) {
        const node = super.create();
        node.setAttribute("data-annotation", value);
        node.classList.add("video-annotation");
        return node;
      }
      static formats(node) {
        return node.getAttribute("data-annotation");
      }
    }
    AnnotationBlot.blotName = "annotation";
    AnnotationBlot.tagName = "span";
    window.Quill.register(AnnotationBlot, true);
  }

  function buildResourceBlot() {
    if (!window.Quill) return;
    const Inline = window.Quill.import("blots/inline");
    class ResourceBlot extends Inline {
      static create(value) {
        const node = super.create();
        node.setAttribute("data-resource", value || "1");
        node.classList.add("video-script-resource");
        return node;
      }
      static formats(node) {
        return node.getAttribute("data-resource");
      }
    }
    ResourceBlot.blotName = "resource";
    ResourceBlot.tagName = "span";
    window.Quill.register(ResourceBlot, true);
  }

  function initQuill() {
    if (quill || !$videoScriptEditor) return;
    if (!window.Quill) return;
    buildAnnotationBlot();
    buildResourceBlot();
    const toolbarContainer = $videoScriptToolbar || false;

    quill = new window.Quill($videoScriptEditor, {
      theme: "snow",
      modules: {
        toolbar: toolbarContainer
      },
      placeholder: "Escribe el guion aquí..."
    });

    quill.on("selection-change", (range) => {
      if (range && range.length > 0) {
        annotationRange = range;
        annotationSelectionText = getSelectionText(range);
        updateAnnotationSelection(annotationSelectionText);
        showAnnotationFab(range);
      } else {
        annotationRange = null;
        annotationSelectionText = "";
        updateAnnotationSelection("");
        hideAnnotationFab();
      }
    });

    quill.on("text-change", (delta, old, source) => {
      if (source === "user") {
        scriptDirty = true;
        scheduleWordCountUpdate();
        scheduleScriptSave(false);
      }
    });

    quill.root.addEventListener("click", (event) => {
      const target = event.target?.closest?.(".video-annotation");
      if (!target) return;
      const id = target.getAttribute("data-annotation");
      if (!id) return;
      const blot = window.Quill.find(target);
      const index = quill.getIndex(blot);
      const length = blot.length();
      annotationRange = { index, length };
      const ann = videos?.[activeScriptVideoId]?.script?.annotations?.[id];
      openAnnotationPopup({
        id,
        text: ann?.text || "",
        existing: true,
        selectedText: ann?.selectedText || getSelectionText(annotationRange)
      });
    });
  }

  function getSelectionText(range) {
    if (!quill || !range || range.length <= 0) return "";
    return quill.getText(range.index, range.length).trim();
  }

  function getSelectionContext(range) {
    if (!quill || !range || range.length <= 0) return "";
    const start = Math.max(0, range.index - 30);
    const end = range.index + range.length + 30;
    return quill.getText(start, end - start).trim();
  }

  function updateAnnotationSelection(text) {
    if (!$annotationSelection) return;
    $annotationSelection.textContent = text || "—";
  }

  function showAnnotationFab(range) {
    if (!$annotationFab || !$videoScriptEditor || !quill || !$viewVideoScript) return;
    const bounds = quill.getBounds(range.index, range.length);
    const shellRect = $viewVideoScript.getBoundingClientRect();
    const editorRect = $videoScriptEditor.getBoundingClientRect();
    if (!shellRect || !editorRect) return;
    const top = editorRect.top - shellRect.top + bounds.top - 44;
    const left = editorRect.left - shellRect.left + bounds.left;
    const maxLeft = shellRect.width - $annotationFab.offsetWidth - 16;
    const safeLeft = Math.max(12, Math.min(left, maxLeft));
    $annotationFab.style.top = `${Math.max(12, top)}px`;
    $annotationFab.style.left = `${safeLeft}px`;
    $annotationFab.classList.remove("hidden");
  }

  function hideAnnotationFab() {
    $annotationFab?.classList.add("hidden");
  }

  function getScriptContent() {
    if (!quill) return { ops: [] };
    return quill.getContents();
  }

  function scheduleWordCountUpdate() {
    if (!quill || !currentCountSettings) return;
    if (wordCountTimer) clearTimeout(wordCountTimer);
    wordCountTimer = setTimeout(() => {
      const wordCount = computeWordCount(getScriptContent(), currentCountSettings);
      updateScriptStats(wordCount);
    }, WORD_COUNT_DEBOUNCE);
  }

  function scheduleScriptSave(immediate) {
    if (scriptSaveTimer) clearTimeout(scriptSaveTimer);
    if (immediate) {
      saveScript();
      return;
    }
    scriptSaveTimer = setTimeout(() => {
      saveScript();
    }, SCRIPT_SAVE_DEBOUNCE);
  }

  async function saveScriptSettings() {
    if (!activeScriptVideoId || !currentCountSettings) return;
    try {
      await update(ref(db, `${VIDEOS_PATH}/${activeScriptVideoId}/script`), {
        countSettings: currentCountSettings
      });
    } catch (err) {
      console.error("Error guardando settings de conteo", err);
    }
  }

  async function updateWordLogForScript(videoId, diffWords) {
    if (!videoId || !diffWords) return;
    const day = todayKey();
    const logRef = ref(db, `${VIDEO_LOG_PATH}/${day}/${videoId}`);
    await runTransaction(logRef, (current) => {
      const prev = current || { w: 0, s: 0 };
      let w = (Number(prev.w) || 0) + diffWords;
      let s = Number(prev.s) || 0;
      if (w < 0) w = 0;
      return { w, s };
    });
  }

  async function saveScript() {
    if (!activeScriptVideoId || !quill) return;
    if (!scriptDirty) return;
    const content = getScriptContent();
    const wordCount = computeWordCount(content, currentCountSettings || DEFAULT_COUNT_SETTINGS);
    const now = Date.now();
    const prevWords = Number(videos?.[activeScriptVideoId]?.script?.wordCount || videos?.[activeScriptVideoId]?.scriptWords || 0);
    const diffWords = wordCount - prevWords;

    try {
      await update(ref(db, `${VIDEOS_PATH}/${activeScriptVideoId}`), {
        scriptWords: wordCount,
        updatedAt: now,
        "script/content": content,
        "script/updatedAt": now,
        "script/wordCount": wordCount,
        "script/countSettings": currentCountSettings || DEFAULT_COUNT_SETTINGS
      });
      if (diffWords !== 0) await updateWordLogForScript(activeScriptVideoId, diffWords);
      scriptDirty = false;
    } catch (err) {
      console.error("Error guardando guion", err);
    }
  }

  function openAnnotationPopup({ id = null, text = "", existing = false, selectedText = "" }) {
    annotationEditingId = id;
    if ($annotationTitle) {
      $annotationTitle.textContent = existing ? "Editar anotación" : "Nueva anotación";
    }
    updateAnnotationSelection(selectedText || annotationSelectionText || "");
    if ($annotationText) $annotationText.value = text || "";
    if ($annotationDelete) $annotationDelete.style.display = existing ? "inline-flex" : "none";
    $annotationPopup?.classList.remove("hidden");
  }

  function closeAnnotationPopup() {
    annotationEditingId = null;
    annotationRange = null;
    annotationSelectionText = "";
    updateAnnotationSelection("");
    if ($annotationText) $annotationText.value = "";
    $annotationPopup?.classList.add("hidden");
  }

  async function saveAnnotation() {
    if (!activeScriptVideoId || !quill) return;
    if (!annotationRange || annotationRange.length <= 0) return;
    const text = ($annotationText?.value || "").trim();
    if (!text) return;
    const selectedText = getSelectionText(annotationRange);
    const contextText = getSelectionContext(annotationRange);
    const now = Date.now();
    let id = annotationEditingId;
    if (!id) {
      const annRef = push(ref(db, `${VIDEOS_PATH}/${activeScriptVideoId}/script/annotations`));
      id = annRef.key;
      quill.formatText(annotationRange.index, annotationRange.length, "annotation", id, "user");
      await set(annRef, {
        id,
        text,
        createdAt: now,
        updatedAt: now,
        range: annotationRange,
        selectedText,
        context: contextText
      });
    } else {
      await update(ref(db, `${VIDEOS_PATH}/${activeScriptVideoId}/script/annotations/${id}`), {
        text,
        updatedAt: now,
        range: annotationRange,
        selectedText,
        context: contextText
      });
    }
    closeAnnotationPopup();
    scriptDirty = true;
    scheduleWordCountUpdate();
    scheduleScriptSave(false);
  }

  async function deleteAnnotation() {
    if (!activeScriptVideoId || !quill || !annotationEditingId || !annotationRange) return;
    const id = annotationEditingId;
    quill.formatText(annotationRange.index, annotationRange.length, "annotation", false, "user");
    try {
      await update(ref(db, `${VIDEOS_PATH}/${activeScriptVideoId}/script/annotations`), {
        [id]: null
      });
    } catch (err) {
      console.error("Error borrando anotación", err);
    }
    closeAnnotationPopup();
    scriptDirty = true;
    scheduleWordCountUpdate();
    scheduleScriptSave(false);
  }

  function loadScriptIntoEditor(videoId) {
    const v = videos?.[videoId];
    if (!v) return;
    currentScriptTitle = v.title || "Guion";
    currentScriptTarget = v.scriptTarget || 2000;
    if ($videoScriptTitle) $videoScriptTitle.textContent = currentScriptTitle;
    if ($videoScriptSubtitle) $videoScriptSubtitle.textContent = "Guion";

    currentCountSettings = getVideoCountSettings(v);
    renderCountToggles(currentCountSettings);

    const ppm = loadStoredPpm(SCRIPT_PPM_KEY, 150);
    if ($videoScriptPpm) $videoScriptPpm.value = ppm;

    const scriptContent = v.script?.content;
    if (scriptContent?.ops) {
      quill.setContents(scriptContent);
    } else if (typeof scriptContent === "string") {
      quill.clipboard.dangerouslyPasteHTML(scriptContent);
    } else {
      quill.setText("");
    }

    const wordCount = computeWordCount(getScriptContent(), currentCountSettings);
    updateScriptStats(wordCount);
  }

  function openScriptView(videoId) {
    if (!videoId) return;
    if (!window.Quill) {
      console.error("Quill no cargado");
      return;
    }
    initQuill();
    activeScriptVideoId = videoId;
    scriptDirty = false;
    closeAnnotationPopup();
    loadScriptIntoEditor(videoId);
    setActiveView("view-video-script");
  }

  function closeScriptView() {
    if (scriptDirty) saveScript();
    closeCountSheet();
    closeLinkPicker();
    if ($videoToolbarMoreMenu) {
      $videoToolbarMoreMenu.classList.remove("is-open");
      $videoToolbarMoreMenu.setAttribute("aria-hidden", "true");
    }
    activeScriptVideoId = null;
    setActiveView("view-videos");
  }

  function openCountSheet() {
    if (!$videoCountSheetBackdrop) return;
    $videoCountSheetBackdrop.classList.add("is-open");
    $videoCountSheetBackdrop.setAttribute("aria-hidden", "false");
  }

  function closeCountSheet() {
    if (!$videoCountSheetBackdrop) return;
    $videoCountSheetBackdrop.classList.remove("is-open");
    $videoCountSheetBackdrop.setAttribute("aria-hidden", "true");
  }

  function openLinkPicker({ mode = "script", onSelect } = {}) {
    if (!$videoLinkPickerBackdrop) return;
    linkPickerMode = mode;
    linkPickerSelectHandler = typeof onSelect === "function" ? onSelect : null;
    renderLinkPickerList();
    $videoLinkPickerBackdrop.classList.add("is-open");
    $videoLinkPickerBackdrop.setAttribute("aria-hidden", "false");
    if ($videoLinkSearch) $videoLinkSearch.focus();
  }

  function closeLinkPicker() {
    if (!$videoLinkPickerBackdrop) return;
    $videoLinkPickerBackdrop.classList.remove("is-open");
    $videoLinkPickerBackdrop.setAttribute("aria-hidden", "true");
    linkPickerMode = "script";
    linkPickerSelectHandler = null;
  }

  function addSheetSwipeToClose(sheetEl, closeFn) {
    if (!sheetEl) return;
    let startY = 0;
    let currentY = 0;
    let dragging = false;
    sheetEl.addEventListener("touchstart", (event) => {
      const touch = event.touches[0];
      if (!touch) return;
      startY = touch.clientY;
      currentY = startY;
      dragging = true;
    }, { passive: true });
    sheetEl.addEventListener("touchmove", (event) => {
      if (!dragging) return;
      const touch = event.touches[0];
      if (!touch) return;
      currentY = touch.clientY;
      const delta = Math.max(0, currentY - startY);
      if (delta > 0) sheetEl.style.transform = `translateY(${delta}px)`;
    }, { passive: true });
    sheetEl.addEventListener("touchend", () => {
      if (!dragging) return;
      const delta = Math.max(0, currentY - startY);
      sheetEl.style.transform = "";
      dragging = false;
      if (delta > 80) closeFn();
    });
  }

  const LINK_CATEGORY_LABELS = {
    cancion: "Canción",
    visual: "Recurso visual",
    tema: "Tema",
    otro: "Otro"
  };

  function formatLinkDate(ts) {
    const date = new Date(Number(ts) || 0);
    if (Number.isNaN(date.getTime())) return "";
    return `${date.toLocaleDateString("es-ES")} · ${date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}`;
  }

  function getLinksArray() {
    return state.links || [];
  }

  function renderLinksList() {
    if (!$videoLinksList || !$videoLinksEmpty) return;
    const search = ($videoLinksSearch?.value || "").trim().toLowerCase();
    const items = getLinksArray()
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))
      .filter((item) => {
        if (!search) return true;
        const hay = `${item.title || ""} ${item.note || ""} ${item.category || ""} ${item.url || ""}`.toLowerCase();
        return hay.includes(search);
      });
    if (!items.length) {
      $videoLinksList.innerHTML = "";
      $videoLinksEmpty.textContent = search ? "No hay links que coincidan." : "Aún no has guardado links.";
      $videoLinksEmpty.style.display = "block";
      return;
    }
    $videoLinksEmpty.style.display = "none";
    const frag = document.createDocumentFragment();
    const order = ["cancion", "visual", "tema", "otro"];
    order.forEach((category) => {
      const grouped = items.filter((item) => (item.category || "otro") === category);
      if (!grouped.length) return;
      const details = document.createElement("details");
      details.className = "video-links-section";
      details.open = true;
      const summary = document.createElement("summary");
      const label = LINK_CATEGORY_LABELS[category] || "Otro";
      summary.innerHTML = `
        <span>${label}</span>
        <span class="video-finished-count">${grouped.length}</span>
      `;
      const body = document.createElement("div");
      body.className = "video-links-section-body";
      grouped.forEach((item) => {
        const card = document.createElement("div");
        card.className = "video-link-card";
        const header = document.createElement("div");
        header.className = "video-link-card-header";
        const title = document.createElement("div");
        title.className = "video-link-card-title";
        if (item.url) {
          const anchor = document.createElement("a");
          anchor.href = normalizeUrl(item.url);
          anchor.target = "_blank";
          anchor.rel = "noopener noreferrer";
          anchor.textContent = item.title || "Recurso guardado";
          title.appendChild(anchor);
        } else {
          title.textContent = item.title || "Recurso guardado";
        }
        const actionMenu = createActionMenu({
          onEdit: () => openLinksNewView(item),
          onDelete: () => {
            openDeleteModal({
              entityType: "link",
              id: item.id,
              label: item.title || item.url || "Link"
            });
          },
          label: item.title || "link"
        });
        header.appendChild(title);
        header.appendChild(actionMenu);
        const meta = document.createElement("div");
        meta.className = "video-link-card-meta";
        const dateLabel = formatLinkDate(item.createdAt);
        const note = item.note ? ` · ${item.note}` : "";
        meta.textContent = `${label}${note}${dateLabel ? ` · ${dateLabel}` : ""}`;
        card.appendChild(header);
        card.appendChild(meta);
        body.appendChild(card);
        attachSwipeToMenu(card, () => actionMenu.openMenu?.());
      });
      details.appendChild(summary);
      details.appendChild(body);
      frag.appendChild(details);
    });
    $videoLinksList.innerHTML = "";
    $videoLinksList.appendChild(frag);
  }

  function renderLinkPickerList() {
    if (!$videoLinkPickerList) return;
    const search = ($videoLinkSearch?.value || "").trim().toLowerCase();
    const items = getLinksArray().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    const filtered = items.filter((item) => {
      if (!search) return true;
      const hay = `${item.title || ""} ${item.url || ""} ${item.note || ""}`.toLowerCase();
      return hay.includes(search);
    });
    const frag = document.createDocumentFragment();
    if (!filtered.length) {
      const empty = document.createElement("div");
      empty.className = "video-link-card";
      empty.textContent = "No hay links que coincidan.";
      frag.appendChild(empty);
    } else {
      filtered.forEach((item) => {
        const card = document.createElement("div");
        card.className = "video-link-card";
        const title = document.createElement("div");
        title.className = "video-link-card-title";
        title.textContent = item.title || "Recurso guardado";
        const url = document.createElement("div");
        url.className = "video-link-card-url";
        url.textContent = item.url || "";
        const meta = document.createElement("div");
        meta.className = "video-link-card-meta";
        meta.textContent = `${LINK_CATEGORY_LABELS[item.category] || "Otro"}${item.note ? ` · ${item.note}` : ""}`;
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = linkPickerMode === "script" ? "Insertar" : "Usar";
        btn.addEventListener("click", () => {
          if (linkPickerMode === "script") {
            insertLinkResource(item);
          } else if (linkPickerSelectHandler) {
            linkPickerSelectHandler(item);
          }
          closeLinkPicker();
        });
        card.appendChild(title);
        card.appendChild(url);
        card.appendChild(meta);
        card.appendChild(btn);
        frag.appendChild(card);
      });
    }
    $videoLinkPickerList.innerHTML = "";
    $videoLinkPickerList.appendChild(frag);
  }

  function insertLinkResource(item) {
    if (!quill || !item) return;
    const range = quill.getSelection(true);
    const url = item.url ? normalizeUrl(item.url) : "";
    if (!url) return;
    if (range && range.length > 0) {
      quill.formatText(range.index, range.length, "link", url, "user");
      return;
    }
    const title = item.title || "Recurso";
    const note = item.note ? ` — ${item.note}` : "";
    const headerText = `\n🔗 ${title}\n`;
    const urlText = `${url}${note}\n`;
    const insertIndex = range ? range.index : quill.getLength();
    quill.insertText(insertIndex, headerText, { resource: "1" }, "user");
    quill.insertText(insertIndex + headerText.length, urlText, { resource: "1", link: url }, "user");
    quill.setSelection(insertIndex + headerText.length + urlText.length, 0, "user");
  }

  function openLinksView() {
    renderLinksList();
    setActiveView("view-links");
  }

  function openLinksNewView(prefill = {}) {
    const editingId = prefill.id || "";
    if ($videoLinkId) $videoLinkId.value = editingId;
    if ($videoLinksNewTitle) {
      $videoLinksNewTitle.textContent = editingId ? "Editar link" : "Nuevo link";
    }
    if ($videoLinksSave) {
      $videoLinksSave.textContent = editingId ? "Guardar cambios" : "Guardar";
    }
    if ($videoLinkUrl) $videoLinkUrl.value = prefill.url || "";
    if ($videoLinkTitle) $videoLinkTitle.value = prefill.title || "";

    const cat = (prefill.category || "otro").toLowerCase();
    if ($videoLinkCategory) {
      // si no existe esa option, cae a "otro"
      const has = Array.from($videoLinkCategory.options || []).some(o => o.value === cat);
      $videoLinkCategory.value = has ? cat : "otro";
    }

    if ($videoLinkNote) $videoLinkNote.value = prefill.note || "";
    if ($videoLinkError) $videoLinkError.textContent = "";
    setActiveView("view-links-new");

    // UX: foco al título si no hay, si no al note
    setTimeout(() => {
      if (($videoLinkTitle?.value || "").trim() === "") $videoLinkTitle?.focus();
      else $videoLinkNote?.focus();
    }, 50);
  }

  const deepLinkDebug =
    new URLSearchParams(window.location.search).has("debugDeepLink") ||
    window.__bookshellDebugDeepLink;
  const logDeepLink = (...args) => {
    if (deepLinkDebug) console.log("[Videos][DeepLink]", ...args);
  };

  function runWhenRouterReady(run, timeoutMs = 1200) {
    const start = performance.now();
    const tick = () => {
      const ready = typeof window.__bookshellSetView === "function";
      if (ready || performance.now() - start > timeoutMs) {
        run(ready);
        return;
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  function ensureHash(viewId) {
    if (!viewId) return;
    try {
      const url = new URL(window.location.href);
      const nextHash = `#${viewId}`;
      if (url.hash !== nextHash) {
        if (deepLinkDebug) {
          console.log("[NAV] replaceState ensureHash", { to: nextHash }, new Error().stack);
        }
        history.replaceState(null, "", `${url.pathname}${url.search}${nextHash}`);
      }
    } catch (_) {}
  }

  function clearLinkParams() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("addLink");
      url.searchParams.delete("url");
      url.searchParams.delete("cat");
      url.searchParams.delete("note");
      url.searchParams.delete("title");
      if (deepLinkDebug) {
        console.log("[NAV] replaceState clearLinkParams", {
          search: url.searchParams.toString(),
          hash: url.hash
        }, new Error().stack);
      }
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function handleDeepLinkParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("addLink") !== "1") return;

      const safeDec = (value) => {
        if (value == null) return "";
        const str = String(value);
        if (!/%[0-9A-Fa-f]{2}/.test(str)) return str;
        try { return decodeURIComponent(str); } catch { return str; }
      };

      const url = safeDec(params.get("url")).trim();
      if (!url) return; // si no hay URL, no hacemos nada

      const normalizeCategory = (raw) => {
        let category = safeDec(raw).trim().toLowerCase();
        if (!category) return "otro";
        if (/https?:\/\//i.test(category) || category.includes("instagram.com")) return "otro";
        const map = {
          "canción": "cancion",
          "cancion": "cancion",
          "song": "cancion",
          "visual": "visual",
          "recurso visual": "visual",
          "tema": "tema",
          "topic": "tema",
          "otro": "otro",
          "other": "otro"
        };
        category = map[category] || category;
        if (!["cancion", "visual", "tema", "otro"].includes(category)) return "otro";
        return category;
      };

      const category = normalizeCategory(params.get("cat"));
      const note = safeDec(params.get("note")).trim();
      const title = safeDec(params.get("title")).trim();

      runWhenRouterReady((routerReady) => {
        logDeepLink("handleDeepLinkParams", { routerReady, url, category, note, title });
        ensureHash("view-links-new");
        openLinksNewView({ url, category, note, title });
        logDeepLink("active view", document.querySelector(".view.view-active")?.id || "");
        clearLinkParams();
      });
    } catch (err) {
      console.error("[DeepLink] error", err);
    }
  }



  function renderTeleprompterContent() {
    if (!$teleprompterContent || !quill) return;
    const text = quill.getText().trim();
    if (!text) {
      $teleprompterContent.textContent = "Sin guion.";
      teleprompterSentences = [];
      return;
    }
    const parts = text.split(/[.!?¿¡]\s+/);
    teleprompterSentences = parts.map((sentence) => sentence.trim()).filter(Boolean);
    $teleprompterContent.innerHTML = teleprompterSentences
      .map((sentence) => `<span class="video-teleprompter-sentence">${sentence}</span>`)
      .join(" ");
  }

  function setTeleprompterSize(value) {
    if (!$teleprompterContent) return;
    $teleprompterContent.style.setProperty("--teleprompter-size", `${value}px`);
  }

  function updateTeleprompterHighlight() {
    if (!$teleprompterBody || !teleprompterSentences.length) return;
    if (!$teleprompterHighlight?.checked) return;
    const sentenceEls = $teleprompterContent.querySelectorAll(".video-teleprompter-sentence");
    if (!sentenceEls.length) return;
    const top = $teleprompterBody.scrollTop;
    let active = 0;
    sentenceEls.forEach((el, idx) => {
      const offset = el.offsetTop;
      if (offset <= top + 20) active = idx;
    });
    if (active !== teleprompterActiveIndex) {
      sentenceEls.forEach((el, idx) => {
        el.classList.toggle("is-active", idx === active);
      });
      teleprompterActiveIndex = active;
    }
  }

  function stopTeleprompter() {
    teleprompterPlaying = false;
    if (teleprompterTimer) clearInterval(teleprompterTimer);
    teleprompterTimer = null;
    if ($teleprompterPlay) $teleprompterPlay.textContent = "Play";
  }

  function startTeleprompter() {
    if (!$teleprompterBody || !$teleprompterContent) return;
    const ppm = Math.max(60, Number($teleprompterSpeed?.value) || 150);
    saveStoredPpm(TELEPROMPTER_PPM_KEY, ppm);
    const wordCount = computeWordCount(getScriptContent(), currentCountSettings || DEFAULT_COUNT_SETTINGS);
    const durationSec = Math.max(10, Math.round((wordCount / ppm) * 60));
    const scrollMax = Math.max(0, $teleprompterBody.scrollHeight - $teleprompterBody.clientHeight);
    const pxPerSec = scrollMax > 0 ? scrollMax / durationSec : 0;
    if (teleprompterTimer) clearInterval(teleprompterTimer);
    teleprompterPlaying = true;
    if ($teleprompterPlay) $teleprompterPlay.textContent = "Pause";
    teleprompterTimer = setInterval(() => {
      if (!teleprompterPlaying) return;
      $teleprompterBody.scrollTop = Math.min(scrollMax, $teleprompterBody.scrollTop + pxPerSec / 10);
      updateTeleprompterHighlight();
      if ($teleprompterBody.scrollTop >= scrollMax) stopTeleprompter();
    }, 100);
  }

  function openTeleprompterView() {
    if (!activeScriptVideoId) return;
    renderTeleprompterContent();
    if ($teleprompterTitle) $teleprompterTitle.textContent = currentScriptTitle || "Teleprompter";
    const stored = loadStoredPpm(TELEPROMPTER_PPM_KEY, loadStoredPpm(SCRIPT_PPM_KEY, 150));
    if ($teleprompterSpeed) $teleprompterSpeed.value = stored;
    if ($teleprompterSize) setTeleprompterSize($teleprompterSize.value);
    if ($teleprompterBody) $teleprompterBody.scrollTop = 0;
    stopTeleprompter();
    setActiveView("view-video-teleprompter");
  }

  function closeTeleprompterView() {
    stopTeleprompter();
    setActiveView("view-video-script");
  }
  if ($videoModalClose) $videoModalClose.addEventListener("click", closeVideoModal);
  if ($videoModalCancel) $videoModalCancel.addEventListener("click", closeVideoModal);
  if ($videoModalBackdrop) {
    $videoModalBackdrop.addEventListener("click", (e) => {
      if (e.target === $videoModalBackdrop) closeVideoModal();
    });
  }
  if ($ideaModalClose) $ideaModalClose.addEventListener("click", closeIdeaModal);
  if ($ideaModalCancel) $ideaModalCancel.addEventListener("click", closeIdeaModal);
  if ($ideaModalBackdrop) {
    $ideaModalBackdrop.addEventListener("click", (e) => {
      if (e.target === $ideaModalBackdrop) closeIdeaModal();
    });
  }
  if ($recordModalClose) $recordModalClose.addEventListener("click", closeRecordModal);
  if ($recordModalCancel) $recordModalCancel.addEventListener("click", closeRecordModal);
  if ($recordModalBackdrop) {
    $recordModalBackdrop.addEventListener("click", (event) => {
      if (event.target === $recordModalBackdrop) closeRecordModal();
    });
  }
  if ($recordModalBackdrop) {
    $recordModalBackdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRecordModal();
      }
    });
  }
  if ($recordForm) {
    $recordForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $recordId?.value || "";
      if (!id) return;
      const words = Math.max(0, Number($recordWords?.value) || 0);
      const min = Math.max(0, Number($recordTimeMin?.value) || 0);
      const sec = Math.max(0, Number($recordTimeSec?.value) || 0);
      const seconds = toSeconds(min, Math.min(59, sec));
      await updateItem("record", id, { words, seconds });
      showVideoToast("Cambios guardados");
      closeRecordModal();
    });
  }
  if ($confirmDeleteClose) $confirmDeleteClose.addEventListener("click", closeDeleteModal);
  if ($confirmDeleteCancel) $confirmDeleteCancel.addEventListener("click", closeDeleteModal);
  if ($confirmDeleteBackdrop) {
    $confirmDeleteBackdrop.addEventListener("click", (event) => {
      if (event.target === $confirmDeleteBackdrop) closeDeleteModal();
    });
    $confirmDeleteBackdrop.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeDeleteModal();
      }
      if (event.key === "Enter") {
        event.preventDefault();
      }
    });
  }
  if ($confirmDeleteConfirm) {
    $confirmDeleteConfirm.addEventListener("click", async () => {
      if (!deleteTarget) return;
      const { entityType, id } = deleteTarget;
      await deleteItem(entityType, id);
      showVideoToast("Eliminado");
      closeDeleteModal();
    });
  }
  if ($ideaAddResource) {
    $ideaAddResource.addEventListener("click", () => {
      openLinkPicker({
        mode: "idea",
        onSelect: (item) => {
          const safeUrl = item?.url ? normalizeUrl(item.url) : "";
          if ($ideaLink && safeUrl) $ideaLink.value = safeUrl;
          if ($ideaNotes && item) {
            const title = item.title || "Recurso";
            const line = `🔗 ${title} — ${safeUrl}${item.note ? ` (${item.note})` : ""}\n`;
            const start = $ideaNotes.selectionStart ?? $ideaNotes.value.length;
            const end = $ideaNotes.selectionEnd ?? $ideaNotes.value.length;
            const before = $ideaNotes.value.slice(0, start);
            const after = $ideaNotes.value.slice(end);
            $ideaNotes.value = `${before}${line}${after}`;
          }
        }
      });
    });
  }
  if ($ideaForm) {
    $ideaForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const id = $ideaId?.value || null;
      const title = ($ideaTitle?.value || "").trim();
      if (!title) {
        if ($ideaFormError) $ideaFormError.textContent = "El título es obligatorio.";
        return;
      }
      const notes = ($ideaNotes?.value || "").trim();
      const tags = formatTagsForStorage($ideaTags?.value || "");
      const rawLink = ($ideaLink?.value || "").trim();
      const inspirationUrl = rawLink ? normalizeUrl(rawLink) : "";
      if (inspirationUrl) {
        try {
          new URL(inspirationUrl);
        } catch {
          if ($ideaFormError) $ideaFormError.textContent = "El link de inspiración no es válido.";
          return;
        }
      }
      if ($ideaFormError) $ideaFormError.textContent = "";
      const now = Date.now();
      const payload = {
        title,
        tags: tags || null,
        ideaNotes: notes || null,
        inspirationUrl: inspirationUrl || null,
        type: "idea",
        status: "idea",
        scriptTarget: 2000,
        scriptWords: 0,
        updatedAt: now
      };
      try {
        if (id) {
          await updateItem("idea", id, payload);
          showVideoToast("Cambios guardados");
        } else {
          const newRef = push(ref(db, VIDEOS_PATH));
          await set(newRef, {
            ...payload,
            createdAt: now
          });
        }
        closeIdeaModal();
      } catch (err) {
        console.error("Error guardando idea", err);
        if ($ideaFormError) $ideaFormError.textContent = "No se pudo guardar la idea. Intenta otra vez.";
      }
    });
  }

  if ($videoScriptBack) $videoScriptBack.addEventListener("click", closeScriptView);
  if ($videoScriptTeleprompter) $videoScriptTeleprompter.addEventListener("click", openTeleprompterView);
  if ($videoToolbarAnnotate) {
    $videoToolbarAnnotate.addEventListener("click", () => {
      const range = quill?.getSelection();
      if (!range || range.length <= 0) return;
      annotationRange = range;
      annotationSelectionText = getSelectionText(range);
      openAnnotationPopup({ existing: false, selectedText: annotationSelectionText });
    });
  }
  if ($annotationFab) {
    $annotationFab.addEventListener("click", () => {
      const range = quill?.getSelection();
      if (!range || range.length <= 0) return;
      annotationRange = range;
      annotationSelectionText = getSelectionText(range);
      openAnnotationPopup({ existing: false, selectedText: annotationSelectionText });
      hideAnnotationFab();
    });
  }
  if ($annotationCancel) $annotationCancel.addEventListener("click", closeAnnotationPopup);
  if ($annotationSave) $annotationSave.addEventListener("click", saveAnnotation);
  if ($annotationDelete) $annotationDelete.addEventListener("click", deleteAnnotation);

  if ($videoScriptPpm) {
    $videoScriptPpm.addEventListener("change", () => {
      saveStoredPpm(SCRIPT_PPM_KEY, $videoScriptPpm.value);
      updateScriptStats(currentScriptWords);
    });
  }

  if ($teleprompterBack) $teleprompterBack.addEventListener("click", closeTeleprompterView);
  if ($teleprompterPlay) {
    $teleprompterPlay.addEventListener("click", () => {
      if (teleprompterPlaying) {
        stopTeleprompter();
      } else {
        startTeleprompter();
      }
    });
  }
  if ($teleprompterSpeed) {
    $teleprompterSpeed.addEventListener("change", () => {
      if (teleprompterPlaying) startTeleprompter();
    });
  }
  if ($teleprompterSize) {
    $teleprompterSize.addEventListener("input", () => setTeleprompterSize($teleprompterSize.value));
  }
  if ($teleprompterBody) {
    $teleprompterBody.addEventListener("scroll", () => {
      if ($teleprompterHighlight?.checked) updateTeleprompterHighlight();
    });
  }
  if ($teleprompterHighlight) {
    $teleprompterHighlight.addEventListener("change", () => {
      updateTeleprompterHighlight();
    });
  }
  window.addEventListener("pagehide", () => {
    if (scriptDirty) saveScript();
  });

  if ($videoScriptCountToggle) {
    $videoScriptCountToggle.addEventListener("click", openCountSheet);
  }
  if ($videoCountSheetClose) {
    $videoCountSheetClose.addEventListener("click", closeCountSheet);
  }
  if ($videoCountSheetBackdrop) {
    $videoCountSheetBackdrop.addEventListener("click", (event) => {
      if (event.target === $videoCountSheetBackdrop) closeCountSheet();
    });
  }
  addSheetSwipeToClose($videoCountSheet, closeCountSheet);

  if ($videoScriptInsertLink) {
    $videoScriptInsertLink.addEventListener("click", () => openLinkPicker({ mode: "script" }));
  }
  if ($videoLinkPickerClose) {
    $videoLinkPickerClose.addEventListener("click", closeLinkPicker);
  }
  if ($videoLinkPickerBackdrop) {
    $videoLinkPickerBackdrop.addEventListener("click", (event) => {
      if (event.target === $videoLinkPickerBackdrop) closeLinkPicker();
    });
  }
  addSheetSwipeToClose($videoLinkPicker, closeLinkPicker);
  if ($videoLinkSearch) {
    $videoLinkSearch.addEventListener("input", () => {
      renderLinkPickerList();
    });
  }
  if ($videoLinksSearch) {
    $videoLinksSearch.addEventListener("input", () => {
      renderLinksList();
    });
  }

  if ($videoToolbarMoreToggle && $videoToolbarMoreMenu) {
    $videoToolbarMoreToggle.addEventListener("click", () => {
      const isOpen = $videoToolbarMoreMenu.classList.toggle("is-open");
      $videoToolbarMoreMenu.setAttribute("aria-hidden", String(!isOpen));
    });
  }
  if ($videoToolbarMoreMenu) {
    document.addEventListener("click", (event) => {
      if (!$videoToolbarMoreMenu.classList.contains("is-open")) return;
      const isToolbar = event.target.closest("#video-script-toolbar");
      if (!isToolbar) {
        $videoToolbarMoreMenu.classList.remove("is-open");
        $videoToolbarMoreMenu.setAttribute("aria-hidden", "true");
      }
    });
  }
  document.addEventListener("click", (event) => {
    if (!activeActionMenu) return;
    const isMenu = event.target.closest(".video-action-menu");
    if (!isMenu) closeActiveActionMenu();
  });
  document.addEventListener("keydown", (event) => {
    const deleteOpen = $confirmDeleteBackdrop && !$confirmDeleteBackdrop.classList.contains("hidden");
    const recordOpen = $recordModalBackdrop && !$recordModalBackdrop.classList.contains("hidden");
    if (deleteOpen && event.key === "Enter") {
      event.preventDefault();
      return;
    }
    if (event.key !== "Escape") return;
    if (deleteOpen) {
      event.preventDefault();
      closeDeleteModal();
    }
    if (recordOpen) {
      event.preventDefault();
      closeRecordModal();
    }
  });

  if ($videoDayBack) {
    $videoDayBack.addEventListener("click", () => {
      activeVideoDayKey = null;
      setActiveView("view-videos");
    });
  }

  if ($btnOpenLinks) {
    $btnOpenLinks.addEventListener("click", openLinksView);
  }
  if ($videoLinksBack) {
    $videoLinksBack.addEventListener("click", () => setActiveView("view-videos"));
  }
  if ($videoLinksNew) {
    $videoLinksNew.addEventListener("click", () => openLinksNewView());
  }
  if ($videoLinksNewBack) {
    $videoLinksNewBack.addEventListener("click", () => {
      clearLinkParams();
      if ($videoLinkId) $videoLinkId.value = "";
      if ($videoLinksNewTitle) $videoLinksNewTitle.textContent = "Nuevo link";
      if ($videoLinksSave) $videoLinksSave.textContent = "Guardar";
      openLinksView();
    });
  }
  if ($videoLinksCancel) {
    $videoLinksCancel.addEventListener("click", () => {
      clearLinkParams();
      if ($videoLinkId) $videoLinkId.value = "";
      if ($videoLinksNewTitle) $videoLinksNewTitle.textContent = "Nuevo link";
      if ($videoLinksSave) $videoLinksSave.textContent = "Guardar";
      openLinksView();
    });
  }
  if ($videoLinksForm) {
    $videoLinksForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const rawUrl = ($videoLinkUrl?.value || "").trim();
      if (!rawUrl) {
        if ($videoLinkError) $videoLinkError.textContent = "La URL es obligatoria.";
        return;
      }
      const url = normalizeUrl(rawUrl);
      try {
        new URL(url);
      } catch {
        if ($videoLinkError) $videoLinkError.textContent = "La URL no es válida.";
        return;
      }
      if ($videoLinkUrl) $videoLinkUrl.value = url;
      const title = ($videoLinkTitle?.value || "").trim();
      const category = $videoLinkCategory?.value || "otro";
      const note = ($videoLinkNote?.value || "").trim();
      const id = ($videoLinkId?.value || "").trim();
      const now = Date.now();
      try {
        if (id) {
          await updateItem("link", id, {
            url,
            title: title || null,
            category,
            note
          });
          showVideoToast("Cambios guardados");
        } else {
          const newRef = push(ref(db, LINKS_PATH));
          await set(newRef, {
            url,
            title: title || null,
            category,
            note,
            createdAt: now,
            updatedAt: now
          });
        }
        if ($videoLinksForm) $videoLinksForm.reset();
        if ($videoLinkCategory) $videoLinkCategory.value = "otro";
        if ($videoLinkId) $videoLinkId.value = "";
        if ($videoLinksNewTitle) $videoLinksNewTitle.textContent = "Nuevo link";
        if ($videoLinksSave) $videoLinksSave.textContent = "Guardar";
        if ($videoLinkError) $videoLinkError.textContent = "";
        clearLinkParams();
        openLinksView();
      } catch (err) {
        console.error("Error guardando link", err);
        if ($videoLinkError) $videoLinkError.textContent = "No se pudo guardar el link. Intenta otra vez.";
      }
    });
  }

  // Guardar vídeo
  if ($videoForm) {
    $videoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $videoId.value || null;
      const title = ($videoTitle.value || "").trim();
      if (!title) return;

      const scriptWords = Math.max(0, Number($videoScriptWords.value) || 0);
    let durationSec = toSeconds($videoDurationMin.value, $videoDurationSec.value);
let editedSec   = toSeconds($videoEditedMin.value, $videoEditedSec.value);

if (editedSec > durationSec) durationSec = editedSec; // <- clave: no capar

      const publishDate = $videoPublishDate.value || null;
      const status = $videoStatus.value || "in_progress";

      const data = {
        title,
        type: id ? (videos?.[id]?.type || "video") : "video",
        scriptWords,
        scriptTarget: 2000,
        durationSeconds: durationSec,
        editedSeconds: editedSec,
        publishDate,
        status,
        updatedAt: Date.now()
      };

      try {
        if (id) {
          await updateItem("script", id, data);
          showVideoToast("Cambios guardados");
        } else {
          const newRef = push(ref(db, VIDEOS_PATH));
          await set(newRef, {
            ...data,
            createdAt: Date.now()
          });
        }
      } catch (err) {
        console.error("Error guardando vídeo", err);
      }

      closeVideoModal();
    });
  }

  // === Firebase listeners ===
  onValue(ref(db, VIDEOS_PATH), (snap) => {
    videos = snap.val() || {};
    rebuildState();
    renderScripts();
    renderVideoStats();
    renderVideoCalendar();
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    try { window.__bookshellDashboard?.render?.(); } catch (_) {}
  });

  onValue(ref(db, VIDEO_LOG_PATH), (snap) => {
    videoLog = snap.val() || {};
    rebuildState();
    renderVideoStats();
    renderVideoCalendar();
  });

  onValue(ref(db, VIDEO_WORK_PATH), (snap) => {
    videoWorkLog = snap.val() || {};
    renderVideoStats();
    renderVideoCalendar();
  });

  onValue(ref(db, LINKS_PATH), (snap) => {
    links = snap.val() || {};
    rebuildState();
    renderLinksList();
    renderLinkPickerList();
  });

  // === Render tarjetas ===
  const STATUS_LABELS = {
    idea: "Idea",
    script: "Guion",
    in_progress: "Guion",
    planned: "Planificado",
    recording: "Grabación",
    editing: "Edición",
    scheduled: "Programado",
    published: "Publicado"
  };

  function getSectionKey(video) {
    if (!video) return "script";
    if (video.type === "idea" || video.status === "idea") return "idea";
    if (video.status === "published") return "published";
    if (video.status === "recording") return "recording";
    if (video.status === "editing") return "editing";
    if (video.status === "scheduled" || video.status === "planned") return "scheduled";
    return "script";
  }

  function getStatusLabel(status, type) {
    if (type === "idea") return STATUS_LABELS.idea;
    return STATUS_LABELS[status] || "Guion";
  }

function renderVideos() {
  if (!$videosList) return;

  const idsAll = [...state.scripts, ...state.ideas].map((item) => item.id);
  if (!idsAll.length) {
    $videosList.innerHTML = "";
    if ($videosEmpty) $videosEmpty.style.display = "block";
    return;
  }
  if ($videosEmpty) $videosEmpty.style.display = "none";

  const sections = [
    { key: "script", title: "Guion", storage: "bookshell_videos_section_script_v1", empty: "Aún no hay guiones." },
    { key: "recording", title: "Grabación", storage: "bookshell_videos_section_recording_v1", empty: "Nada en grabación." },
    { key: "editing", title: "Edición", storage: "bookshell_videos_section_editing_v1", empty: "Nada en edición." },
    { key: "scheduled", title: "Programado/Publicar", storage: "bookshell_videos_section_scheduled_v1", empty: "Nada programado." },
    { key: "idea", title: "Ideas", storage: "bookshell_videos_section_idea_v1", empty: "Aún no hay ideas." },
    { key: "published", title: "Publicados", storage: "bookshell_videos_section_published_v1", empty: "Aún no hay vídeos publicados." }
  ];

  const grouped = {
    idea: [],
    script: [],
    recording: [],
    editing: [],
    scheduled: [],
    published: []
  };

  idsAll.forEach((id) => {
    const v = videos[id] || {};
    const key = getSectionKey(v);
    grouped[key] = grouped[key] || [];
    grouped[key].push(id);
  });

  grouped.idea.sort((a, b) => (videos[b].createdAt || 0) - (videos[a].createdAt || 0));
  grouped.script.sort((a, b) => (videos[b].updatedAt || 0) - (videos[a].updatedAt || 0));
  grouped.recording.sort((a, b) => (videos[b].updatedAt || 0) - (videos[a].updatedAt || 0));
  grouped.editing.sort((a, b) => (videos[b].updatedAt || 0) - (videos[a].updatedAt || 0));
  grouped.scheduled.sort((a, b) => {
    const va = videos[a] || {};
    const vb = videos[b] || {};
    const da = va.publishDate ? parseDateKey(va.publishDate).getTime() : (va.updatedAt || 0);
    const db = vb.publishDate ? parseDateKey(vb.publishDate).getTime() : (vb.updatedAt || 0);
    return db - da;
  });
  grouped.published.sort((a, b) => {
    const va = videos[a] || {};
    const vb = videos[b] || {};
    const da = va.publishDate ? parseDateKey(va.publishDate).getTime() : (va.updatedAt || 0);
    const db = vb.publishDate ? parseDateKey(vb.publishDate).getTime() : (vb.updatedAt || 0);
    return db - da;
  });

  // helper: crea una tarjeta (es TU código tal cual, metido en función)
function createVideoCard(id) {
  const v = videos[id];
  const isPublished = (v && v.status === "published");
  const isIdea = v?.type === "idea" || v?.status === "idea";
  if (!v) return document.createElement("div");

  const scriptTarget = v.scriptTarget || 2000;
  const scriptWords = Math.max(0, Number(v.script?.wordCount ?? v.scriptWords) || 0);
  const scriptPct = scriptTarget > 0 ? Math.min(100, Math.round((scriptWords / scriptTarget) * 100)) : 0;

  const durationTotal = Number(v.durationSeconds) || 0;
  const editedSec = Math.max(0, Number(v.editedSeconds) || 0); // <- ya NO capamos
  const editPct = durationTotal > 0 ? Math.min(100, Math.round((Math.min(editedSec, durationTotal) / durationTotal) * 100)) : 0;

  const totalPct = Math.round((scriptPct + editPct) / 2);

  const worked = Number(v.workedSec) || 0;
  const workedEl = document.createElement("div");
  workedEl.className = "video-worked";
  workedEl.textContent = `Trabajo: ${formatWorkTime(worked)}`;

  let daysRemainingText = "Sin fecha";
  if (v.publishDate) {
    const pub = parseDateKey(v.publishDate);
    const today = parseDateKey(todayKey());
    const diff = Math.round((pub - today) / (1000 * 60 * 60 * 24));
    if (diff > 1) daysRemainingText = `${diff} días para publicar`;
    else if (diff === 1) daysRemainingText = "Mañana";
    else if (diff === 0) daysRemainingText = "Hoy";
    else daysRemainingText = `${Math.abs(diff)} días desde publicación`;
  }

  const card = document.createElement("article");
  card.className = "video-card";
  card.dataset.id = id;
  card.style.setProperty("--p", totalPct); // para el “relleno” estilo libros
  card.classList.add("is-collapsed");

  const prog = document.createElement("div");
  prog.className = "video-progress";
  prog.innerHTML = `
    <div class="video-progress-ring" style="--p:${totalPct}">
      <div class="video-progress-inner">${totalPct}%</div>
    </div>
  `;

  const main = document.createElement("div");
  main.className = "video-main";

  const titleRow = document.createElement("div");
  titleRow.className = "video-title-row";

  const title = document.createElement("div");
  title.className = "video-title";
  title.textContent = v.title || "Sin título";
  title.classList.add("card-toggle");
  title.setAttribute("role", "button");
  title.tabIndex = 0;

  const status = document.createElement("span");
  status.className = "video-status-pill";
  status.textContent = getStatusLabel(v.status, v.type);

  const actionMenu = createActionMenu({
    onEdit: () => {
      if (isIdea) openIdeaModal(id);
      else openVideoModal(id);
    },
    onDelete: () => {
      openDeleteModal({
        entityType: isIdea ? "idea" : "script",
        id,
        label: v.title || "Sin título"
      });
    },
    label: v.title || "elemento"
  });

  const titleActions = document.createElement("div");
  titleActions.className = "video-item-actions";
  titleActions.appendChild(status);
  titleActions.appendChild(actionMenu);

  titleRow.appendChild(title);
  titleRow.appendChild(titleActions);

  const progLine = document.createElement("div");
  progLine.className = "video-progress-line";
  progLine.innerHTML = `
    <span class="video-progress-value">${totalPct}%</span>
    <div class="video-progress-bar">
      <div class="video-progress-fill" style="width:${totalPct}%"></div>
    </div>
    <span class="video-progress-right">G ${scriptPct}% · E ${editPct}%</span>
  `;

  const meta = document.createElement("div");
  meta.className = "video-meta";

  const metaBits = [];
  if (v.publishDate) metaBits.push(`📅 ${v.publishDate}`);
  const tagsDisplay = isIdea ? formatTagsForDisplay(v.tags) : "";
  if (tagsDisplay) metaBits.push(`🏷 ${tagsDisplay}`);
  const durSplit = splitSeconds(durationTotal);
  if (durationTotal > 0) metaBits.push(`🎬 ${durSplit.min}m ${durSplit.sec}s`);
  meta.innerHTML = metaBits.map((m) => `<span>${m}</span>`).join("");

  const bars = document.createElement("div");
  bars.className = "video-bars";

  const barScript = document.createElement("div");
  barScript.className = "video-bar-line";
  barScript.innerHTML = `
    <span>Guion</span>
    <span>${scriptWords}/${scriptTarget} palabras · ${scriptPct}%</span>
  `;

  const barEdit = document.createElement("div");
  barEdit.className = "video-bar-line";
  const edSplit = splitSeconds(editedSec);
  const durTotalSplit = splitSeconds(durationTotal);
  barEdit.innerHTML = `
    <span>Edición</span>
    <span>${edSplit.min}m ${edSplit.sec}s / ${durTotalSplit.min}m ${durTotalSplit.sec}s · ${editPct}%</span>
  `;

  bars.appendChild(barScript);
  bars.appendChild(barEdit);

  const remaining = document.createElement("div");
  remaining.className = "video-remaining";
  remaining.textContent = daysRemainingText;

  const actions = document.createElement("div");
  actions.className = "video-actions";

  let inputGroup = null;

  // ✅ baseline mutable (evita valores “congelados”)
  let currWords = scriptWords;
  let currEdited = editedSec;

  if (!isPublished && !isIdea) {
    const ig = document.createElement("div");
    ig.className = "video-input-group";
    ig.innerHTML = `
      <div class="video-input-row">
        <span>Palabras</span>
        <input type="number" min="0" inputmode="numeric" value="${scriptWords}">
      </div>
      <div class="video-input-row">
        <span>Min</span>
        <input type="number" min="0" inputmode="numeric" value="${edSplit.min}">
        <span>Seg</span>
        <input type="number" min="0" max="59" inputmode="numeric" value="${edSplit.sec}">
      </div>
    `;

    const upd = document.createElement("details");
    upd.className = "video-update";
    upd.innerHTML = `<summary>Actualizar progreso</summary>`;
    upd.appendChild(ig);

    const [inputWords, inputMin, inputSec] = ig.querySelectorAll("input");
    normalizeNumberField(inputMin);
    normalizeNumberField(inputSec, 59);

    inputWords.addEventListener("change", async () => {
      const newWords = Math.max(0, Number(inputWords.value) || 0);
      inputWords.value = newWords;

      await updateVideoProgress(id, newWords, currEdited);
      currWords = newWords; // ✅ actualiza baseline
    });

    const handleTimeChange = async () => {
      let newMin = Math.max(0, Number(inputMin.value) || 0);
      let newSec = Math.max(0, Number(inputSec.value) || 0);
      if (newSec > 59) newSec = 59;
      inputMin.value = newMin;
      inputSec.value = newSec;

      const newEdited = toSeconds(newMin, newSec); // <- NO capar

      await updateVideoProgress(id, currWords, newEdited);
      currEdited = newEdited; // ✅ actualiza baseline
    };

    inputMin.addEventListener("change", handleTimeChange);
    inputSec.addEventListener("change", handleTimeChange);

    inputGroup = upd;
  }

  const buttons = document.createElement("div");
  buttons.className = "video-card-buttons";

  const btnEdit = document.createElement("button");
  btnEdit.className = "btn";
  btnEdit.textContent = "Editar";
  btnEdit.addEventListener("click", () => {
    if (isIdea) openIdeaModal(id);
    else openVideoModal(id);
  });

  const btnScript = document.createElement("button");
  btnScript.className = "btn";
  btnScript.textContent = "Guion";
  btnScript.addEventListener("click", () => openScriptView(id));

  const btnConvert = document.createElement("button");
  btnConvert.className = "btn";
  btnConvert.textContent = "Convertir a vídeo";
  btnConvert.addEventListener("click", async () => {
    try {
      await update(ref(db, `${VIDEOS_PATH}/${id}`), {
        type: "video",
        status: "script",
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error("Error convirtiendo idea", err);
    }
  });

  const btnPublish = document.createElement("button");
  btnPublish.className = "btn";
  btnPublish.textContent = "Publicado";
  btnPublish.addEventListener("click", () => markVideoPublished(id));

  btnEdit.classList.add("btn-secondary-action");
  btnPublish.classList.add("btn-primary-action");

  if (v.status === "published") {
    btnPublish.disabled = true;
    btnPublish.style.opacity = "0.7";
    btnPublish.style.pointerEvents = "none";
  }

  buttons.appendChild(btnEdit);
  buttons.appendChild(btnScript);
  if (isIdea) buttons.appendChild(btnConvert);
  if (!isPublished && !isIdea) buttons.appendChild(btnPublish);

  if (!isPublished) actions.appendChild(inputGroup);
  actions.appendChild(buttons);

  main.appendChild(titleRow);
  main.appendChild(progLine);
  main.appendChild(meta);
  main.appendChild(bars);
  main.appendChild(workedEl);
  main.appendChild(remaining);
  main.appendChild(actions);

  card.appendChild(prog);
  card.appendChild(main);

  const toggle = () => card.classList.toggle("is-collapsed");
  title.addEventListener("click", toggle);
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      toggle();
    }
  });

  attachSwipeToMenu(card, () => actionMenu.openMenu?.());

  return card;
}

  const frag = document.createDocumentFragment();

  sections.forEach((section) => {
    const ids = grouped[section.key] || [];
    const details = document.createElement("details");
    details.className = "video-finished";
    const storedOpen = localStorage.getItem(section.storage);
    const defaultOpen = section.key !== "published" && section.key !== "idea";
    details.open = storedOpen ? storedOpen === "1" : defaultOpen;
    details.addEventListener("toggle", () => {
      localStorage.setItem(section.storage, details.open ? "1" : "0");
    });

    const summary = document.createElement("summary");
    summary.className = "video-finished-summary";
    summary.innerHTML = `
      <span>${section.title}</span>
      <span class="video-finished-count">${ids.length}</span>
    `;

    const box = document.createElement("div");
    box.className = "video-finished-list";

    if (!ids.length) {
      const empty = document.createElement("div");
      empty.className = "video-finished-empty";
      empty.textContent = section.empty;
      box.appendChild(empty);
    } else {
      ids.forEach((id) => {
        const c = createVideoCard(id);
        if (section.key === "published") c.classList.add("video-card-finished");
        box.appendChild(c);
      });
    }

    details.appendChild(summary);
    details.appendChild(box);
    frag.appendChild(details);
  });

  $videosList.innerHTML = "";
  $videosList.appendChild(frag);

  if ($videosEmpty) {
    $videosEmpty.style.display = idsAll.length ? "none" : "block";
  }
}

  function renderIdeas() {
    renderVideos();
  }

  function renderScripts() {
    renderVideos();
  }

  function renderRecords(dayKey) {
    if (dayKey) openVideoDayView(dayKey);
  }


  // Actualizar progreso + log diario
  async function updateVideoProgress(videoId, newWords, newEditedSeconds) {
    let diffWords = 0;
    let diffSeconds = 0;

    try {
      const videoRef = ref(db, `${VIDEOS_PATH}/${videoId}`);
      const res = await runTransaction(videoRef, (video) => {
        if (!video) return; // aborta si no existe

        let durationTotal = Number(video.durationSeconds) || 0;

        const safeNewEditedRaw = Math.max(0, Number(newEditedSeconds) || 0);
        const safeNewEdited = safeNewEditedRaw;
        if (safeNewEditedRaw > durationTotal) durationTotal = safeNewEditedRaw;

        const safeNewWords = Math.max(0, Number(newWords) || 0);

        const prevWords = Math.max(0, Number(video.script?.wordCount ?? video.scriptWords) || 0);
        const prevEdited = Math.max(0, Number(video.editedSeconds) || 0);

        const safeOldEdited = Math.min(durationTotal, prevEdited);

        diffWords = safeNewWords - prevWords;
        diffSeconds = safeNewEdited - safeOldEdited;

        return {
          ...video,
          scriptWords: safeNewWords,
          script: {
            ...(video.script || {}),
            wordCount: safeNewWords,
            updatedAt: Date.now()
          },
          durationSeconds: durationTotal,
          editedSeconds: safeNewEdited,
          updatedAt: Date.now()
        };
      });

      // Aplicar también las RESTAS al registro diario (no solo las sumas)
      if (res?.committed && (diffWords !== 0 || diffSeconds !== 0)) {
        const day   = todayKey();
        const logRef = ref(db, `${VIDEO_LOG_PATH}/${day}/${videoId}`);

        await runTransaction(logRef, (current) => {
          const prev = current || { w: 0, s: 0 };
          let w = (Number(prev.w) || 0) + diffWords;
          let s = (Number(prev.s) || 0) + diffSeconds;

          // Nunca valores negativos en el log
          if (w < 0) w = 0;
          if (s < 0) s = 0;

          // Si queda todo a 0, podemos devolver 0 para limpiar el nodo
          if (w === 0 && s === 0) return { w: 0, s: 0 };
          return { w, s };
        });
      }
    } catch (err) {
      console.error("Error actualizando vídeo", err);
    }
  }


  async function markVideoPublished(videoId) {
    const v = videos[videoId];
    if (!v) return;
    try {
      await update(ref(db, `${VIDEOS_PATH}/${videoId}`), {
        status: "published",
        updatedAt: Date.now()
      });
    } catch (err) {
      console.error("Error marcando publicado", err);
    }
  }

  // === Stats / streak ===
  function computeVideoDayTotals() {
    const totals = {}; // {date: {words, seconds, ideas}}
    Object.entries(videoLog || {}).forEach(([day, perVideo]) => {
      let w = 0;
      let s = 0;
      Object.values(perVideo || {}).forEach((val) => {
        w += Number(val.w || 0);
        s += Number(val.s || 0);
      });
      totals[day] = { words: w, seconds: s, ideas: 0 };
    });

    Object.entries(videos || {}).forEach(([, v]) => {
      if (v?.type !== "idea" && v?.status !== "idea") return;
      const day = v.createdAt ? dateToKey(new Date(v.createdAt)) : null;
      if (!day) return;
      if (!totals[day]) totals[day] = { words: 0, seconds: 0, ideas: 0 };
      totals[day].ideas += 1;
    });

    return totals;
  }

  function mergeTotalsForStreak(totals) {
    const merged = {};
    const keys = new Set([
      ...Object.keys(totals || {}),
      ...Object.keys(videoWorkLog || {})
    ]);
    keys.forEach((k) => {
      const t = totals?.[k] || { words: 0, seconds: 0, ideas: 0 };
      const extra = Math.max(0, Number(videoWorkLog?.[k]) || 0);
      merged[k] = { words: t.words || 0, seconds: (t.seconds || 0) + extra, ideas: t.ideas || 0 };
    });
    return merged;
  }

  function computeVideoStreak(totals) {
    const days = Object.keys(totals).filter(
      (d) => (totals[d].words || 0) > 0 || (totals[d].seconds || 0) > 0
    );
    if (!days.length) return { current: 0, best: 0, streakDays: [] };
    days.sort();

    let best = 1;
    let current = 1;
    let bestRun = [days[0]];
    let currentRun = [days[0]];

    for (let i = 1; i < days.length; i++) {
      const prev = parseDateKey(days[i - 1]);
      const currDate = parseDateKey(days[i]);
      const diff = (currDate - prev) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        current += 1;
        currentRun.push(days[i]);
      } else {
        if (currentRun.length > bestRun.length) bestRun = currentRun.slice();
        current = 1;
        currentRun = [days[i]];
      }
      if (current > best) best = current;
    }
    if (currentRun.length > bestRun.length) bestRun = currentRun.slice();

    const latestDay = days[days.length - 1];
    const today = todayKey();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey =
      `${yesterday.getFullYear()}-` +
      String(yesterday.getMonth() + 1).padStart(2, "0") + "-" +
      String(yesterday.getDate()).padStart(2, "0");

    let currentStreak = current;
    let activeRun = currentRun.slice();

    if (latestDay !== today && latestDay !== yKey) {
      currentStreak = 0;
      activeRun = [];
    }

    const streakDays = (activeRun.length ? activeRun : bestRun).slice();
    return { current: currentStreak, best, streakDays };
  }

  function renderVideoStats() {
    const totals = computeVideoDayTotals();
    const totalsForStreak = mergeTotalsForStreak(totals);

    let totalWords = 0;
    Object.values(videos || {}).forEach((v) => {
totalWords += Number(v?.script?.wordCount ?? v?.scriptWords ?? 0);
    });

    const { current } = computeVideoStreak(totalsForStreak);

    // "Publicado" = vídeo cuya fecha de publicación aparece en verde (ese día está "done")
    const publishInfo = computePublishInfo();
    const videosPublished = Object.values(videos || {}).filter(
      (v) => v.publishDate && publishInfo[normalizeDateKey(v.publishDate)]?.done
    ).length;
    const ideasCreated = Object.values(videos || {}).filter(
      (v) => v?.type === "idea" || v?.status === "idea"
    ).length;

    if ($videoStatCount) $videoStatCount.textContent = videosPublished;
    if ($videoStatStreak) $videoStatStreak.textContent = current;
    if ($videoStatWords) $videoStatWords.textContent = totalWords;
    if ($videoStatTime) $videoStatTime.textContent = ideasCreated;
  }
  function isVideoFullyDone(v) {
    const scriptTarget = v.scriptTarget || 2000;
    const scriptWords = Math.max(0, Number(v.scriptWords) || 0);
    const durationSec = v.durationSeconds || 0;
    const editedSec = Math.max(0, Number(v.editedSeconds) || 0);

    const scriptPct =
      scriptTarget > 0 ? Math.min(100, Math.round((scriptWords / scriptTarget) * 100)) : 0;
    const editPct =
      durationSec > 0 ? Math.min(100, Math.round((editedSec / durationSec) * 100)) : 0;

    const totalPct = Math.round((scriptPct + editPct) / 2);

    return totalPct >= 100 || v.status === "published";
  }

  function computePublishInfo() {
    // mapa: YYYY-MM-DD -> { any: true, done: boolean }
    const publishInfo = {};
    Object.values(videos || {}).forEach((v) => {
      if (!v.publishDate) return;
      const date = normalizeDateKey(v.publishDate);
      const done = isVideoFullyDone(v);
      if (!publishInfo[date]) {
        publishInfo[date] = { any: true, done };
      } else {
        // el día solo se considera "done" si TODOS los vídeos de esa fecha lo están
        publishInfo[date].done = publishInfo[date].done && done;
      }
    });
    return publishInfo;
  }


  // === Calendario ===
  function renderVideoCalendar() {
    if (!$videoCalGrid) return;
    const now = new Date();
    if (videoCalYear == null) {
      videoCalYear = now.getFullYear();
      videoCalMonth = now.getMonth();
    }

    const totals = computeVideoDayTotals();
    const totalsForStreak = mergeTotalsForStreak(totals);
    const publishInfo = computePublishInfo();

    if ($videoCalViewMode) {
      videoCalViewMode = $videoCalViewMode.value || "month";
    }

    renderVideoCalendarSummary(totalsForStreak, publishInfo);

    if (videoCalViewMode === "year") {
      if ($videoCalLabel) $videoCalLabel.textContent = `Año ${videoCalYear}`;
      renderVideoCalendarYearGrid(totalsForStreak, publishInfo);
      return;
    }

    $videoCalGrid.classList.remove("video-calendar-year-grid");
    if ($videoCalLabel) {
      $videoCalLabel.textContent = formatMonthLabel(videoCalYear, videoCalMonth);
    }

    const streakInfo = computeVideoStreak(totalsForStreak);
    const streakSet = new Set(streakInfo.streakDays || []);

    // info de publicación por fecha: { any: bool, done: bool (todos los vídeos de ese día al 100%) }

    const firstDay = new Date(videoCalYear, videoCalMonth, 1).getDay();
    const offset = (firstDay + 6) % 7; // lunes = 0
    const daysInMonth = getDaysInMonth(videoCalYear, videoCalMonth);

    const frag = document.createDocumentFragment();
    const totalCells = offset + daysInMonth;

    for (let i = 0; i < totalCells; i++) {
      const cell = document.createElement("div");

      if (i < offset) {
        cell.className = "video-cal-cell video-cal-cell-empty";
      } else {
        const dayNum = i - offset + 1;
        const key =
          `${videoCalYear}-` +
          String(videoCalMonth + 1).padStart(2, "0") + "-" +
          String(dayNum).padStart(2, "0");

        const t = totals[key] || { words: 0, seconds: 0, ideas: 0 };
        const mergedSeconds = Math.max(0, (totalsForStreak[key]?.seconds || 0));
        const workedSec = Math.max(0, Number(videoWorkLog?.[key]) || 0);
        const hasWork = (t.words || 0) > 0 || mergedSeconds > 0 || (t.ideas || 0) > 0;

        const pub = publishInfo[key];
        const isPublish = !!(pub && pub.any);
        const publishDone = !!(pub && pub.done);
        const isStreak = streakSet.has(key);

        cell.className = "video-cal-cell";

        if (key === todayKey()) cell.classList.add("video-cal-today");

        // PRIORIDAD: publicación > racha > trabajo
        if (isPublish) {
          if (publishDone) {
            cell.classList.add("video-cal-publish-done");
          } else {
            cell.classList.add("video-cal-publish");
          }
        } else {
          if (hasWork) cell.classList.add("video-cal-has-work");
          if (isStreak) cell.classList.add("video-cal-streak");
        }

        const num = document.createElement("div");
        num.className = "video-cal-day-number";
        num.textContent = String(dayNum);

        const metrics = document.createElement("div");
        metrics.className = "video-cal-metrics";

        const bits = [];
        if ((t.ideas || 0) > 0) bits.push(`💡 ${t.ideas}`);
        if ((t.words || 0) > 0) bits.push(`${t.words || 0} w`);
        if (workedSec > 0) bits.push(`⏱ ${formatWorkTime(workedSec)}`);
        if (workedSec <= 0 && (t.seconds || 0) > 0) bits.push(`🎞 ${formatWorkTime(t.seconds)}`);

        if (isPublish) {
          metrics.textContent = bits.length ? `📤 subida · ${bits.join(" · ")}` : "📤 subida";
        } else {
          metrics.textContent = bits.join(" · ");
        }

        cell.appendChild(num);
        cell.appendChild(metrics);
        cell.dataset.date = key;
        cell.addEventListener("click", () => openVideoDayView(key));
      }

      frag.appendChild(cell);
    }

    $videoCalGrid.innerHTML = "";
    $videoCalGrid.appendChild(frag);
  }

  function openVideoDayView(dayKey) {
    if (!$viewVideoDay || !$videoDaySummary || !$videoDayList) return;
    activeVideoDayKey = dayKey;
    const totals = computeVideoDayTotals();
    const dayTotals = totals[dayKey] || { words: 0, seconds: 0, ideas: 0 };
    const scheduled = Object.entries(videos || {}).filter(([, v]) => normalizeDateKey(v.publishDate) === dayKey);
    const published = scheduled.filter(([, v]) => v.status === "published");
    const worked = Math.max(0, Number(videoWorkLog?.[dayKey]) || 0) + (dayTotals.seconds || 0);

    $videoDayTitle.textContent = `Resumen ${dayKey}`;
    $videoDaySummary.textContent =
      `Ideas: ${dayTotals.ideas || 0} · Palabras: ${dayTotals.words || 0} · Trabajo: ${formatWorkTime(worked)} · Publicaciones: ${published.length}/${scheduled.length}`;

    const itemsMap = new Map();
    Object.entries(videos || {}).forEach(([id, v]) => {
      const createdDay = v.createdAt ? dateToKey(new Date(v.createdAt)) : "";
      if ((v.type === "idea" || v.status === "idea") && createdDay === dayKey) {
        itemsMap.set(id, {
          id,
          title: v.title || "Idea",
          meta: ["Idea creada", v.tags ? `Tags: ${v.tags}` : ""].filter(Boolean),
          isIdea: true,
          type: "idea"
        });
      }
      if (normalizeDateKey(v.publishDate) === dayKey) {
        const existing = itemsMap.get(id) || { id, title: v.title || "Vídeo", meta: [] };
        const label = v.status === "published" ? "Publicado" : "Programado";
        existing.meta.push(label);
        existing.type = existing.type || "script";
        itemsMap.set(id, existing);
      }
    });

    const dayRecords = state.records.filter((record) => record.day === dayKey);
    const recordItems = dayRecords.map((record) => {
      const title = videos?.[record.videoId]?.title || "Vídeo";
      const time = formatWorkTime(record.seconds || 0);
      return {
        id: record.id,
        recordId: record.id,
        videoId: record.videoId,
        title: `Registro · ${title}`,
        meta: [
          `${record.words || 0} palabras`,
          record.seconds ? `⏱ ${time}` : ""
        ].filter(Boolean),
        type: "record"
      };
    });

    const frag = document.createDocumentFragment();
    const items = [...itemsMap.values(), ...recordItems];
    if (!items.length) {
      const empty = document.createElement("div");
      empty.className = "video-finished-empty";
      empty.textContent = "Sin entradas ese día.";
      frag.appendChild(empty);
    } else {
      items.forEach((item) => {
        const card = document.createElement("div");
        card.className = "video-day-item";
        const header = document.createElement("div");
        header.className = "video-day-item-header";
        const title = document.createElement("div");
        title.className = "video-day-item-title";
        title.textContent = item.title;
        const meta = document.createElement("div");
        meta.className = "video-day-item-meta";
        meta.textContent = item.meta.join(" · ");
        header.appendChild(title);
        if (item.type === "record") {
          const actionMenu = createActionMenu({
            onEdit: () => {
              const record = getItem("record", item.recordId);
              if (record) openRecordModal(record);
            },
            onDelete: () => {
              openDeleteModal({
                entityType: "record",
                id: item.recordId,
                label: item.title
              });
            },
            label: "registro"
          });
          header.appendChild(actionMenu);
          attachSwipeToMenu(card, () => actionMenu.openMenu?.());
        }
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "Abrir guion";
        btn.addEventListener("click", () => openScriptView(item.videoId || item.id));
        card.appendChild(header);
        card.appendChild(meta);
        card.appendChild(btn);
        frag.appendChild(card);
      });
    }

    $videoDayList.innerHTML = "";
    $videoDayList.appendChild(frag);
    setActiveView("view-video-day");
  }

  function renderVideoCalendarYearGrid(totalsForStreak, publishInfo) {
    $videoCalGrid.classList.add("video-calendar-year-grid");
    const months = Array.from({ length: 12 }, () => ({
      words: 0,
      seconds: 0,
      ideas: 0,
      publish: 0,
      publishDone: 0
    }));

    Object.entries(totalsForStreak || {}).forEach(([day, val]) => {
      const [year, month] = day.split("-");
      if (Number(year) === videoCalYear) {
        const idx = Number(month) - 1;
        months[idx].words += Number(val?.words) || 0;
        months[idx].seconds += Number(val?.seconds) || 0;
        months[idx].ideas += Number(val?.ideas) || 0;
      }
    });

    Object.entries(publishInfo || {}).forEach(([day, info]) => {
      const [year, month] = day.split("-");
      if (Number(year) === videoCalYear) {
        const idx = Number(month) - 1;
        if (info?.any) months[idx].publish += 1;
        if (info?.done) months[idx].publishDone += 1;
      }
    });

    const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const frag = document.createDocumentFragment();

    months.forEach((info, idx) => {
      const cell = document.createElement("div");
      cell.className = "video-cal-cell video-cal-cell-year";

      const name = document.createElement("div");
      name.className = "video-cal-month-name";
      name.textContent = monthNames[idx];

      const metrics = document.createElement("div");
      metrics.className = "video-cal-month-metrics";
      const publishLabel = info.publish ? ` · ${info.publish} publicaciones` : "";
      const ideaLabel = info.ideas ? ` · ${info.ideas} ideas` : "";
      metrics.textContent = `${info.words || 0} w · ${formatWorkTime(info.seconds)}${ideaLabel}${publishLabel}`;

      cell.appendChild(name);
      cell.appendChild(metrics);
      frag.appendChild(cell);
    });

    $videoCalGrid.innerHTML = "";
    $videoCalGrid.appendChild(frag);
  }

  function renderVideoCalendarSummary(totalsForStreak, publishInfo) {
    if (!$videoCalendarSummary) return;
    const prefix =
      videoCalViewMode === "year"
        ? `${videoCalYear}-`
        : `${videoCalYear}-${String(videoCalMonth + 1).padStart(2, "0")}-`;

    let totalWords = 0;
    let totalSeconds = 0;
    let totalIdeas = 0;
    Object.entries(totalsForStreak || {}).forEach(([day, val]) => {
      if (!day.startsWith(prefix)) return;
      totalWords += Number(val?.words) || 0;
      totalSeconds += Number(val?.seconds) || 0;
      totalIdeas += Number(val?.ideas) || 0;
    });
    let publishCount = 0;
    Object.entries(publishInfo || {}).forEach(([day, info]) => {
      if (day.startsWith(prefix) && info?.any) publishCount += 1;
    });

    const scopeLabel = videoCalViewMode === "year" ? "año" : "mes";
    $videoCalendarSummary.textContent =
      `Resumen del ${scopeLabel}: ${totalIdeas} ideas · ${totalWords.toLocaleString("es-ES")} palabras · ${formatWorkTime(totalSeconds)} · ${publishCount} días con publicación`;
  }

  // Nav calendario
  if ($videoCalPrev) {
    $videoCalPrev.addEventListener("click", () => {
      if (videoCalViewMode === "year") {
        videoCalYear -= 1;
      } else if (videoCalMonth === 0) {
        videoCalMonth = 11;
        videoCalYear -= 1;
      } else {
        videoCalMonth -= 1;
      }
      renderVideoCalendar();
    });
  }

  if ($videoCalNext) {
    $videoCalNext.addEventListener("click", () => {
      if (videoCalViewMode === "year") {
        videoCalYear += 1;
      } else if (videoCalMonth === 11) {
        videoCalMonth = 0;
        videoCalYear += 1;
      } else {
        videoCalMonth += 1;
      }
      renderVideoCalendar();
    });
  }

  if ($videoCalViewMode) {
    $videoCalViewMode.addEventListener("change", () => {
      videoCalViewMode = $videoCalViewMode.value || "month";
      renderVideoCalendar();
    });
  }

  // === API para Dashboard (Inicio) ===
  function getRecentVideo() {
    try {
      const list = Object.entries(videos || {}).map(([id, v]) => ({ id, ...(v || {}) }));
      list.sort((a, b) => (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0));
      const top = list[0] || null;
      if (!top) return null;
      const statusLabel = top.status || top.stage || top.state || "";
      return { ...top, statusLabel };
    } catch (_) {
      return null;
    }
  }

  handleDeepLinkParams();

  window.__bookshellVideos = {
    getRecentVideo,
    openVideoModal
  };
}
