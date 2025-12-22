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

// Estado
let videos = {};
let videoLog = {}; // { "YYYY-MM-DD": { videoId: { w, s } } }
let videoWorkLog = {}; // { "YYYY-MM-DD": seconds }
let videoCalYear;
let videoCalMonth;

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
    .filter(([, v]) => (v?.status || "in_progress") === "in_progress")
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
      $videoScriptWords.value = v.scriptWords || 0;

      const dur = splitSeconds(v.durationSeconds || 0);
      $videoDurationMin.value = dur.min;
      $videoDurationSec.value = dur.sec;

      const ed = splitSeconds(v.editedSeconds || 0);
      $videoEditedMin.value = ed.min;
      $videoEditedSec.value = ed.sec;

      $videoPublishDate.value = v.publishDate || "";
      $videoStatus.value = v.status || "in_progress";
    } else {
      $videoModalTitle.textContent = "Nuevo vídeo";
      $videoId.value = "";
      $videoForm.reset();
      $videoScriptWords.value = 0;
      $videoDurationMin.value = 0;
      $videoDurationSec.value = 0;
      $videoEditedMin.value = 0;
      $videoEditedSec.value = 0;
      $videoStatus.value = "in_progress";
    }

    $videoModalBackdrop.classList.remove("hidden");
  }

  function closeVideoModal() {
    $videoModalBackdrop.classList.add("hidden");
  }

  if ($btnAddVideo) {
    $btnAddVideo.addEventListener("click", () => openVideoModal());
  }
  if ($videoModalClose) $videoModalClose.addEventListener("click", closeVideoModal);
  if ($videoModalCancel) $videoModalCancel.addEventListener("click", closeVideoModal);
  if ($videoModalBackdrop) {
    $videoModalBackdrop.addEventListener("click", (e) => {
      if (e.target === $videoModalBackdrop) closeVideoModal();
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

  // === Render tarjetas ===
function renderVideos() {
  if (!$videosList) return;

  const idsAll = Object.keys(videos || {});
  if (!idsAll.length) {
    $videosList.innerHTML = "";
    if ($videosEmpty) $videosEmpty.style.display = "block";
    return;
  }
  if ($videosEmpty) $videosEmpty.style.display = "none";

  const publishedIds = [];
  const activeIds = [];

  idsAll.forEach((id) => {
    const v = videos[id] || {};
    // Publicado = status published (simple y estable)
    if (v.status === "published") publishedIds.push(id);
    else activeIds.push(id);
  });

  // orden
  activeIds.sort((a, b) => (videos[b].updatedAt || 0) - (videos[a].updatedAt || 0));
  publishedIds.sort((a, b) => {
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
  if (!v) return document.createElement("div");

  const scriptTarget = v.scriptTarget || 2000;
  const scriptWords = Math.max(0, Number(v.scriptWords) || 0);
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
  status.textContent =
    v.status === "published"
      ? "Publicado"
      : v.status === "in_progress"
      ? "Curso"
      : "Planificado";

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

  if (!isPublished) {
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

      await updateVideoProgress(id, newWords, currEdited, currWords, currEdited);
      currWords = newWords; // ✅ actualiza baseline
    });

    const handleTimeChange = async () => {
      let newMin = Math.max(0, Number(inputMin.value) || 0);
      let newSec = Math.max(0, Number(inputSec.value) || 0);
      if (newSec > 59) newSec = 59;
      inputMin.value = newMin;
      inputSec.value = newSec;

      const newEdited = toSeconds(newMin, newSec); // <- NO capar

      await updateVideoProgress(id, currWords, newEdited, currWords, currEdited);
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
  if (!isPublished) buttons.appendChild(btnPublish);

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

  // Activos arriba
  activeIds.forEach((id) => frag.appendChild(createVideoCard(id)));

  // Desplegable publicados al final
  const FIN_KEY = "bookshell_videos_published_open_v1";
  const details = document.createElement("details");
  details.className = "video-finished";
  details.open = localStorage.getItem(FIN_KEY) === "1";

  details.addEventListener("toggle", () => {
    localStorage.setItem(FIN_KEY, details.open ? "1" : "0");
  });

  const summary = document.createElement("summary");
  summary.className = "video-finished-summary";
  summary.innerHTML = `
    <span>Publicados</span>
    <span class="video-finished-count">${publishedIds.length}</span>
  `;

  const box = document.createElement("div");
  box.className = "video-finished-list";

  if (!publishedIds.length) {
    const empty = document.createElement("div");
    empty.className = "video-finished-empty";
    empty.textContent = "Aún no hay vídeos publicados.";
    box.appendChild(empty);
  } else {
    publishedIds.forEach((id) => {
      const c = createVideoCard(id);
      c.classList.add("video-card-finished");
      box.appendChild(c);
    });
  }

  details.appendChild(summary);
  details.appendChild(box);

  frag.appendChild(details);

  $videosList.innerHTML = "";
  $videosList.appendChild(frag);

  // si no hay activos pero sí publicados, no mostramos “vacío”
  if ($videosEmpty) {
    $videosEmpty.style.display = (!activeIds.length && !publishedIds.length) ? "block" : "none";
  }
}


  // Actualizar progreso + log diario
  async function updateVideoProgress(videoId, newWords, newEditedSeconds, oldWords, oldEditedSeconds) {
    const v = videos[videoId];
    if (!v) return;

let durationTotal = Number(v.durationSeconds) || 0;

const safeNewEditedRaw = Math.max(0, Number(newEditedSeconds) || 0);
const safeOldEditedRaw = Math.max(0, Number(oldEditedSeconds) || 0);

// si editado supera duración, ampliamos duración (para que no se “resetee”)
if (safeNewEditedRaw > durationTotal) durationTotal = safeNewEditedRaw;

const safeNewEdited = safeNewEditedRaw;
const safeOldEdited = Math.min(durationTotal, safeOldEditedRaw);


    const safeNewWords  = Math.max(0, Number(newWords) || 0);
    const safeOldWords  = Math.max(0, Number(oldWords) || 0);


    const diffWords   = safeNewWords  - safeOldWords;
    const diffSeconds = safeNewEdited - safeOldEdited;

    const updates = {
  scriptWords: safeNewWords,
  durationSeconds: durationTotal,
  editedSeconds: safeNewEdited,
  updatedAt: Date.now()
};


    try {
      await update(ref(db, `${VIDEOS_PATH}/${videoId}`), updates);

      // Aplicar también las RESTAS al registro diario (no solo las sumas)
      if (diffWords !== 0 || diffSeconds !== 0) {
        const day   = todayKey();
        const logRef = ref(db, `${VIDEO_LOG_PATH}/${day}/${videoId}`);

        await runTransaction(logRef, (current) => {
          const prev = current || { w: 0, s: 0 };
          let w = (prev.w || 0) + diffWords;
          let s = (prev.s || 0) + diffSeconds;

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
    const totals = {}; // {date: {words, seconds}}
    Object.entries(videoLog || {}).forEach(([day, perVideo]) => {
      let w = 0;
      let s = 0;
      Object.values(perVideo || {}).forEach((val) => {
        w += Number(val.w || 0);
        s += Number(val.s || 0);
      });
      totals[day] = { words: w, seconds: s };
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
      const t = totals?.[k] || { words: 0, seconds: 0 };
      const extra = Math.max(0, Number(videoWorkLog?.[k]) || 0);
      merged[k] = { words: t.words || 0, seconds: (t.seconds || 0) + extra };
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
    Object.values(totals).forEach((t) => {
      totalWords += t.words || 0;
    });

    const { current } = computeVideoStreak(totalsForStreak);

    const workedSeconds = getTotalWorkedSecondsLive();

    // "Publicado" = vídeo cuya fecha de publicación aparece en verde (ese día está "done")
    const publishInfo = computePublishInfo();
    const videosPublished = Object.values(videos || {}).filter(
      (v) => v.publishDate && publishInfo[normalizeDateKey(v.publishDate)]?.done
    ).length;

    if ($videoStatCount) $videoStatCount.textContent = videosPublished;
    if ($videoStatStreak) $videoStatStreak.textContent = current;
    if ($videoStatWords) $videoStatWords.textContent = totalWords;
    if ($videoStatTime) $videoStatTime.textContent = formatWorkTime(workedSeconds);
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

    if ($videoCalLabel) {
      $videoCalLabel.textContent = formatMonthLabel(videoCalYear, videoCalMonth);
    }

    const totals = computeVideoDayTotals();
    const totalsForStreak = mergeTotalsForStreak(totals);
    const streakInfo = computeVideoStreak(totalsForStreak);
    const streakSet = new Set(streakInfo.streakDays || []);

    // info de publicación por fecha: { any: bool, done: bool (todos los vídeos de ese día al 100%) }
    const publishInfo = computePublishInfo();

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

        const t = totals[key] || { words: 0, seconds: 0 };
        const workedSec = Math.max(0, Number(videoWorkLog?.[key]) || 0) + (timerRunning && key === todayKey() ? getUnflushedSecondsToday() : 0);
        const hasWork = (t.words || 0) > 0 || (t.seconds || 0) > 0 || workedSec > 0;

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
      }

      frag.appendChild(cell);
    }

    $videoCalGrid.innerHTML = "";
    $videoCalGrid.appendChild(frag);
  }

  // Nav calendario
  if ($videoCalPrev) {
    $videoCalPrev.addEventListener("click", () => {
      if (videoCalMonth === 0) {
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
      if (videoCalMonth === 11) {
        videoCalMonth = 0;
        videoCalYear += 1;
      } else {
        videoCalMonth += 1;
      }
      renderVideoCalendar();
    });
  }
}