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

const SCRIPT_SAVE_DEBOUNCE = 1000;
const WORD_COUNT_DEBOUNCE = 200;
const SCRIPT_PPM_KEY = "bookshell_video_script_ppm_v1";
const TELEPROMPTER_PPM_KEY = "bookshell_video_teleprompter_ppm_v1";

const DEFAULT_COUNT_SETTINGS = {
  countHeadings: false,
  countHashtags: false,
  countLinks: true,
  countUrls: false,
  countLists: true,
  excludeAnnotations: true,
  ignoreTags: true
};

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
    window.__bookshellSetView(viewId);
    return;
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

  // Cronómetro
  const $videoTimerToggle  = document.getElementById("video-timer-toggle");
  const $videoTimerDisplay = document.getElementById("video-timer-display");
  const $videoTimerToday   = document.getElementById("video-timer-today");
  const $videoTimerHint    = document.getElementById("video-timer-hint");

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
  const $videoLinkUrl = document.getElementById("video-link-url");
  const $videoLinkTitle = document.getElementById("video-link-title");
  const $videoLinkCategory = document.getElementById("video-link-category");
  const $videoLinkNote = document.getElementById("video-link-note");

  // Modal vídeo
  const $videoModalBackdrop = document.getElementById("video-modal-backdrop");
  const $videoModalTitle = document.getElementById("video-modal-title");
  const $videoModalClose = document.getElementById("video-modal-close");
  const $videoModalCancel = document.getElementById("video-modal-cancel");
  const $videoForm = document.getElementById("video-form");
// Modal asignar tiempo a vídeo
const $assignWorkBackdrop = document.getElementById("assign-work-backdrop");
const $assignWorkClose    = document.getElementById("assign-work-close");
const $assignWorkSelect   = document.getElementById("assign-work-select");
const $assignWorkSummary  = document.getElementById("assign-work-summary");
const $assignWorkSkip     = document.getElementById("assign-work-skip");
const $assignWorkSave     = document.getElementById("assign-work-save");

let assignWorkResolve = null;

function getInProgressVideos() {
  const arr = Object.entries(videos || {})
    .filter(([, v]) => {
      const status = v?.status || "script";
      return ["script", "in_progress", "recording", "editing", "scheduled"].includes(status);
    })
    .map(([id, v]) => ({ id, title: v.title || "Sin título" }));

  // orden: alfabético (cámbialo si prefieres por fecha)
  arr.sort((a,b) => a.title.localeCompare(b.title, "es"));
  return arr;
}

function closeAssignWorkModal(resultId = null) {
  if ($assignWorkBackdrop) $assignWorkBackdrop.classList.add("hidden");
  const r = assignWorkResolve;
  assignWorkResolve = null;
  if (r) r(resultId);
}

function openAssignWorkModal(seconds) {
  return new Promise((resolve) => {
    if (!$assignWorkBackdrop || !$assignWorkSelect) return resolve(null);

    const list = getInProgressVideos();
    if (list.length === 0) return resolve(null);

    $assignWorkSelect.innerHTML = "";
    list.forEach(({id, title}) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = title;
      $assignWorkSelect.appendChild(opt);
    });

    if ($assignWorkSummary) $assignWorkSummary.textContent = `Tiempo: ${formatHHMMSS(seconds)}`;
    assignWorkResolve = resolve;
    $assignWorkBackdrop.classList.remove("hidden");
  });
}

async function addWorkedSecondsToVideo(videoId, seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!videoId || s <= 0) return;

  const r = ref(db, `${VIDEOS_PATH}/${videoId}/workedSec`);
  const res = await runTransaction(r, (curr) => (Number(curr) || 0) + s);

  if (!res?.committed) return; // ✅ no toques el estado si no se aplicó

  const finalVal = Number(res.snapshot.val()) || 0;
  if (videos && videos[videoId]) videos[videoId].workedSec = finalVal;
}



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

  // === Modal helpers ===
  function openVideoModal(id = null) {
    if (id && videos[id]) {
      const v = videos[id];
      $videoModalTitle.textContent = "Editar vídeo";
      $videoId.value = id;
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

  if ($btnAddVideo) {
    $btnAddVideo.addEventListener("click", () => openVideoModal());
  }
  if ($btnAddIdea) {
    $btnAddIdea.addEventListener("click", async () => {
      const title = (window.prompt("Título de la idea") || "").trim();
      if (!title) return;
      const tags = (window.prompt("Tags/hashtags (opcional)") || "").trim();
      try {
        const newRef = push(ref(db, VIDEOS_PATH));
        await set(newRef, {
          title,
          tags,
          type: "idea",
          status: "idea",
          scriptTarget: 2000,
          scriptWords: 0,
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      } catch (err) {
        console.error("Error creando idea", err);
      }
    });
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
    if (settings.countUrls) counting.push("urls"); else excluding.push("urls");
    if (settings.countLists) counting.push("listas"); else excluding.push("listas");
    if (settings.excludeAnnotations) excluding.push("anotaciones"); else counting.push("anotaciones");
    if (settings.ignoreTags) excluding.push("tags especiales"); else counting.push("tags especiales");
    return `Contando: ${counting.join(", ") || "cuerpo"} · Excluyendo: ${excluding.join(", ") || "nada"}`;
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
      { key: "countHeadings", label: "Headings" },
      { key: "countHashtags", label: "Hashtags" },
      { key: "countLinks", label: "Links" },
      { key: "countUrls", label: "URLs" },
      { key: "countLists", label: "Listas" },
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

  function initQuill() {
    if (quill || !$videoScriptEditor) return;
    if (!window.Quill) return;
    buildAnnotationBlot();
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
    if ($videoScriptTitle) $videoScriptTitle.textContent = "Guion";
    if ($videoScriptSubtitle) $videoScriptSubtitle.textContent = currentScriptTitle;

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

  function openLinkPicker() {
    if (!$videoLinkPickerBackdrop) return;
    renderLinkPickerList();
    $videoLinkPickerBackdrop.classList.add("is-open");
    $videoLinkPickerBackdrop.setAttribute("aria-hidden", "false");
    if ($videoLinkSearch) $videoLinkSearch.focus();
  }

  function closeLinkPicker() {
    if (!$videoLinkPickerBackdrop) return;
    $videoLinkPickerBackdrop.classList.remove("is-open");
    $videoLinkPickerBackdrop.setAttribute("aria-hidden", "true");
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
    return Object.entries(links || {}).map(([id, item]) => ({ id, ...(item || {}) }));
  }

  function renderLinksList() {
    if (!$videoLinksList || !$videoLinksEmpty) return;
    const items = getLinksArray().sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
    if (!items.length) {
      $videoLinksList.innerHTML = "";
      $videoLinksEmpty.style.display = "block";
      return;
    }
    $videoLinksEmpty.style.display = "none";
    const frag = document.createDocumentFragment();
    items.forEach((item) => {
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
      const categoryLabel = LINK_CATEGORY_LABELS[item.category] || "Otro";
      const dateLabel = formatLinkDate(item.createdAt);
      const note = item.note ? ` · ${item.note}` : "";
      meta.textContent = `${categoryLabel}${note}${dateLabel ? ` · ${dateLabel}` : ""}`;
      card.appendChild(title);
      card.appendChild(url);
      card.appendChild(meta);
      frag.appendChild(card);
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
        btn.textContent = "Insertar";
        btn.addEventListener("click", () => {
          insertLinkResource(item);
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
    const url = item.url || "";
    if (!url) return;
    if (range && range.length > 0) {
      quill.formatText(range.index, range.length, "link", url, "user");
      return;
    }
    const title = item.title || "Recurso";
    const note = item.note ? ` — ${item.note}` : "";
    const insertText = `\n🔗 ${title}\n${url}${note}\n`;
    const insertIndex = range ? range.index : quill.getLength();
    quill.insertText(insertIndex, insertText, "user");
    const urlIndex = insertIndex + `\n🔗 ${title}\n`.length;
    quill.formatText(urlIndex, url.length, "link", url, "user");
    quill.setSelection(urlIndex + url.length + note.length + 1, 0, "user");
  }

  function openLinksView() {
    renderLinksList();
    setActiveView("view-links");
  }

  function openLinksNewView(prefill = {}) {
    if ($videoLinkUrl) $videoLinkUrl.value = prefill.url || "";
    if ($videoLinkTitle) $videoLinkTitle.value = prefill.title || "";
    if ($videoLinkCategory) $videoLinkCategory.value = prefill.category || "otro";
    if ($videoLinkNote) $videoLinkNote.value = prefill.note || "";
    setActiveView("view-links-new");
  }

  function clearLinkParams() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("addLink");
      url.searchParams.delete("url");
      url.searchParams.delete("cat");
      url.searchParams.delete("note");
      url.searchParams.delete("title");
      history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    } catch (_) {}
  }

  function handleDeepLinkParams() {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("addLink") !== "1") return;
      const url = params.get("url") || "";
      const category = params.get("cat") || "otro";
      const note = params.get("note") || "";
      const title = params.get("title") || "";
      openLinksNewView({ url, category, note, title });
    } catch (_) {}
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
    $videoScriptInsertLink.addEventListener("click", openLinkPicker);
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

  if ($videoDayBack) {
    $videoDayBack.addEventListener("click", () => setActiveView("view-videos"));
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
      openLinksView();
    });
  }
  if ($videoLinksCancel) {
    $videoLinksCancel.addEventListener("click", () => {
      clearLinkParams();
      openLinksView();
    });
  }
  if ($videoLinksForm) {
    $videoLinksForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const url = ($videoLinkUrl?.value || "").trim();
      if (!url) return;
      const title = ($videoLinkTitle?.value || "").trim();
      const category = $videoLinkCategory?.value || "otro";
      const note = ($videoLinkNote?.value || "").trim();
      const now = Date.now();
      try {
        const newRef = push(ref(db, LINKS_PATH));
        await set(newRef, {
          url,
          title: title || null,
          category,
          note,
          createdAt: now,
          updatedAt: now
        });
        if ($videoLinksForm) $videoLinksForm.reset();
        if ($videoLinkCategory) $videoLinkCategory.value = "otro";
        clearLinkParams();
        openLinksView();
      } catch (err) {
        console.error("Error guardando link", err);
      }
    });
  }

// === Cronómetro (tiempo real trabajado) ===
const TIMER_STATE_KEY = "bookshell_video_timer_state_v2";
const AUTO_FLUSH_MS = 15000;

let timerRunning = false;
let timerStartMs = 0;      // NO se reinicia nunca mientras esté corriendo
let timerLastFlushMs = 0;  // para volcar a Firebase por “deltas”
let timerInterval = null;

function loadTimerState() {
  try {
    const raw = localStorage.getItem(TIMER_STATE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_) { return null; }
}

function saveTimerState() {
  try {
    const payload = timerRunning
      ? { running: true, startMs: timerStartMs, lastFlushMs: timerLastFlushMs }
      : { running: false };
    localStorage.setItem(TIMER_STATE_KEY, JSON.stringify(payload));
  } catch (_) {}
}

async function addWorkSeconds(dayKey, seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!dayKey || s <= 0) return;
  const r = ref(db, `${VIDEO_WORK_PATH}/${dayKey}`);
  await runTransaction(r, (curr) => (Number(curr) || 0) + s);
}

async function setWorkSeconds(dayKey, seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  if (!dayKey) return;
  const r = ref(db, `${VIDEO_WORK_PATH}/${dayKey}`);
  await runTransaction(r, () => s);
}

function dayStartMsFromKey(key) {
  const d = parseDateKey(key);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function dayKeyFromMs(ms) {
  return dateToKey(new Date(ms));
}

function nextDayStartMs(ms) {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
}

function getSessionSeconds() {
  if (!timerRunning || !timerStartMs) return 0;
  return Math.max(0, Math.floor((Date.now() - timerStartMs) / 1000));
}

function getUnflushedSecondsTotal() {
  if (!timerRunning || !timerLastFlushMs) return 0;
  return Math.max(0, Math.floor((Date.now() - timerLastFlushMs) / 1000));
}

function getUnflushedSecondsToday() {
  if (!timerRunning || !timerLastFlushMs) return 0;
  const now = Date.now();
  const todayStart = dayStartMsFromKey(todayKey());
  const from = Math.max(timerLastFlushMs, todayStart);
  if (now <= from) return 0;
  return Math.max(0, Math.floor((now - from) / 1000));
}

async function flushBetweenMs(fromMs, toMs) {
  let a = Math.max(0, Number(fromMs) || 0);
  const b = Math.max(0, Number(toMs) || 0);
  if (b <= a) return;

  while (a < b) {
    const dayKey = dayKeyFromMs(a);
    const end = Math.min(nextDayStartMs(a), b);
    const sec = Math.floor((end - a) / 1000);
    if (sec > 0) await addWorkSeconds(dayKey, sec);
    a = end;
  }
}

// vuelca a Firebase lo que falta desde el último flush
async function flushIfNeeded(force = false) {
  if (!timerRunning || !timerLastFlushMs) return;

  const now = Date.now();
  const elapsedMs = now - timerLastFlushMs;

  if (!force && elapsedMs < AUTO_FLUSH_MS) return;

  await flushBetweenMs(timerLastFlushMs, now);

  timerLastFlushMs = now;
  saveTimerState();
}

function getTodayWorkedSecondsLive() {
  const base = Math.max(0, Number(videoWorkLog?.[todayKey()]) || 0);
  return base + getUnflushedSecondsToday();
}

function getTotalWorkedSecondsLive() {
  return Object.values(videos || {}).reduce((acc, v) => {
    return acc + Math.max(0, Number(v?.workedSec) || 0);
  }, 0);
}

function renderVideoTimerUI() {
  if (!$videoTimerDisplay || !$videoTimerToggle || !$videoTimerToday) return;

  $videoTimerDisplay.textContent = timerRunning ? formatHHMMSS(getSessionSeconds()) : "00:00:00";
  $videoTimerToday.textContent = formatWorkTime(getTodayWorkedSecondsLive());

  $videoTimerToggle.textContent = timerRunning ? "Parar" : "Empezar";
  if ($videoTimerHint) $videoTimerHint.textContent = timerRunning ? "🎧 en marcha" : "";
}

function startVideoTimer() {
  if (timerRunning) return;

  const now = Date.now();
  timerRunning = true;
  timerStartMs = now;
  timerLastFlushMs = now;
  saveTimerState();

  if (timerInterval) clearInterval(timerInterval);
  timerInterval = setInterval(async () => {
    await flushIfNeeded(false);
    renderVideoTimerUI();
    renderVideoStats();
    renderVideoCalendar();
  }, 1000);

  renderVideoTimerUI();
  renderVideoStats();
  renderVideoCalendar();
}

async function stopVideoTimer() {
  if (!timerRunning) return;
 const sessionSeconds = getSessionSeconds();
  await flushIfNeeded(true);

  timerRunning = false;
  timerStartMs = 0;
  timerLastFlushMs = 0;
  saveTimerState();

  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  renderVideoTimerUI();
  renderVideoStats();
  renderVideoCalendar();

   if (sessionSeconds >= 20) { // umbral anti-pesadez
    const vid = await openAssignWorkModal(sessionSeconds);
    if (vid) {
      await addWorkedSecondsToVideo(vid, sessionSeconds);
      renderVideos(); // refresca tarjetas para mostrar "Trabajo"
    }
  }
}

// Botón start/stop
if ($videoTimerToggle) {
  $videoTimerToggle.addEventListener("click", async () => {
    if (timerRunning) await stopVideoTimer();
    else startVideoTimer();
  });
}

// EDITAR TIEMPO “HOY” aunque NO esté cronometrando
// Toca “Hoy: …” -> +15 / -10 / =120 (fija total) / 0 (pone a 0)
if ($videoTimerToday) {
  $videoTimerToday.style.cursor = "pointer";
  $videoTimerToday.title = "Toca para ajustar tiempo (ej: +15, -10, =120, 0)";
  $videoTimerToday.addEventListener("click", async () => {
    const raw = prompt("Ajusta minutos: +15 / -10 / =120 (fijar total) / 0");
    if (raw == null) return;

    const s = String(raw).trim().replace(",", ".");
    const key = todayKey();

    // fijar total: "=120"
    if (s.startsWith("=")) {
      const mins = Number(s.slice(1));
      if (!Number.isFinite(mins)) return;
      await setWorkSeconds(key, mins * 60);
    } else {
      const mins = Number(s);
      if (!Number.isFinite(mins)) return;
      if (mins === 0) await setWorkSeconds(key, 0);
      else await addWorkSeconds(key, mins * 60);
    }

    renderVideoTimerUI();
    renderVideoStats();
    renderVideoCalendar();
  });
}

// Restaurar al abrir (NO reinicia startMs)
(async () => {
  const st = loadTimerState();
  if (st?.running && st.startMs && st.lastFlushMs) {
    timerRunning = true;
    timerStartMs = Number(st.startMs) || Date.now();
    timerLastFlushMs = Number(st.lastFlushMs) || timerStartMs;

    // al abrir, volcamos lo acumulado mientras la app estuvo muerta
    await flushIfNeeded(true);

    if (timerInterval) clearInterval(timerInterval);
    timerInterval = setInterval(async () => {
      await flushIfNeeded(false);
      renderVideoTimerUI();
      renderVideoStats();
      renderVideoCalendar();
    }, 1000);
  }
  renderVideoTimerUI();
})();

// Eventos de vida: al ocultar, volcamos fuerte
document.addEventListener("visibilitychange", () => {
  if (!timerRunning) return;
  if (document.hidden) flushIfNeeded(true);
});

window.addEventListener("focus", () => {
  if (!timerRunning) return;
  renderVideoTimerUI();
  renderVideoStats();
  renderVideoCalendar();
});

window.addEventListener("pagehide", () => {
  if (scriptDirty) saveScript();
  if (!timerRunning) return;
  flushIfNeeded(true);
});

if ($assignWorkClose) $assignWorkClose.addEventListener("click", () => closeAssignWorkModal(null));
if ($assignWorkSkip)  $assignWorkSkip.addEventListener("click",  () => closeAssignWorkModal(null));
if ($assignWorkSave)  $assignWorkSave.addEventListener("click",  () => closeAssignWorkModal($assignWorkSelect?.value || null));

// click fuera para cerrar
if ($assignWorkBackdrop) {
  $assignWorkBackdrop.addEventListener("click", (e) => {
    if (e.target === $assignWorkBackdrop) closeAssignWorkModal(null);
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
          await update(ref(db, `${VIDEOS_PATH}/${id}`), data);
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
    renderVideos();
    renderVideoStats();
    renderVideoCalendar();
    try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
    try { window.__bookshellDashboard?.render?.(); } catch (_) {}
  });

  onValue(ref(db, VIDEO_LOG_PATH), (snap) => {
    videoLog = snap.val() || {};
    renderVideoStats();
    renderVideoCalendar();
  });

  onValue(ref(db, VIDEO_WORK_PATH), (snap) => {
    videoWorkLog = snap.val() || {};
    renderVideoStats();
    renderVideoCalendar();
    renderVideoTimerUI();
  });

  onValue(ref(db, LINKS_PATH), (snap) => {
    links = snap.val() || {};
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

  const idsAll = Object.keys(videos || {});
  if (!idsAll.length) {
    $videosList.innerHTML = "";
    if ($videosEmpty) $videosEmpty.style.display = "block";
    return;
  }
  if ($videosEmpty) $videosEmpty.style.display = "none";

  const sections = [
    { key: "idea", title: "Ideas", storage: "bookshell_videos_section_idea_v1", empty: "Aún no hay ideas." },
    { key: "script", title: "Guion", storage: "bookshell_videos_section_script_v1", empty: "Aún no hay guiones." },
    { key: "recording", title: "Grabación", storage: "bookshell_videos_section_recording_v1", empty: "Nada en grabación." },
    { key: "editing", title: "Edición", storage: "bookshell_videos_section_editing_v1", empty: "Nada en edición." },
    { key: "scheduled", title: "Programado/Publicar", storage: "bookshell_videos_section_scheduled_v1", empty: "Nada programado." },
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

  titleRow.appendChild(title);
  titleRow.appendChild(status);

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
  if (isIdea && v.tags) metaBits.push(`🏷 ${v.tags}`);
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
  btnEdit.addEventListener("click", () => openVideoModal(id));

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

  return card;
}


  const frag = document.createDocumentFragment();

  sections.forEach((section) => {
    const ids = grouped[section.key] || [];
    const details = document.createElement("details");
    details.className = "video-finished";
    const storedOpen = localStorage.getItem(section.storage);
    details.open = storedOpen ? storedOpen === "1" : section.key !== "published";
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
        const mergedSeconds =
          Math.max(0, (totalsForStreak[key]?.seconds || 0)) +
          (timerRunning && key === todayKey() ? getUnflushedSecondsToday() : 0);
        const workedSec = Math.max(0, Number(videoWorkLog?.[key]) || 0) +
          (timerRunning && key === todayKey() ? getUnflushedSecondsToday() : 0);
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
          isIdea: true
        });
      }
      if (normalizeDateKey(v.publishDate) === dayKey) {
        const existing = itemsMap.get(id) || { id, title: v.title || "Vídeo", meta: [] };
        const label = v.status === "published" ? "Publicado" : "Programado";
        existing.meta.push(label);
        itemsMap.set(id, existing);
      }
    });

    const dayLog = videoLog?.[dayKey] || {};
    Object.entries(dayLog).forEach(([id, log]) => {
      const words = Number(log?.w) || 0;
      if (!words) return;
      const existing = itemsMap.get(id) || { id, title: videos?.[id]?.title || "Vídeo", meta: [] };
      existing.meta.push(`${words} palabras`);
      itemsMap.set(id, existing);
    });

    const frag = document.createDocumentFragment();
    if (!itemsMap.size) {
      const empty = document.createElement("div");
      empty.className = "video-finished-empty";
      empty.textContent = "Sin entradas ese día.";
      frag.appendChild(empty);
    } else {
      Array.from(itemsMap.values()).forEach((item) => {
        const card = document.createElement("div");
        card.className = "video-day-item";
        const title = document.createElement("div");
        title.className = "video-day-item-title";
        title.textContent = item.title;
        const meta = document.createElement("div");
        meta.className = "video-day-item-meta";
        meta.textContent = item.meta.join(" · ");
        const btn = document.createElement("button");
        btn.className = "btn";
        btn.textContent = "Abrir guion";
        btn.addEventListener("click", () => openScriptView(item.id));
        card.appendChild(title);
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
    if (timerRunning && todayKey().startsWith(prefix)) {
      totalSeconds += getUnflushedSecondsToday();
    }

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
    openVideoModal,
    startVideoTimer,
    stopVideoTimer,
    isTimerRunning: () => !!timerRunning
  };
}
