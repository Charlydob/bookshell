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

// Estado
let videos = {};
let videoLog = {}; // { "YYYY-MM-DD": { videoId: { w, s } } }
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

  // Guardar vídeo
  if ($videoForm) {
    $videoForm.addEventListener("submit", async (e) => {
      e.preventDefault();
      const id = $videoId.value || null;
      const title = ($videoTitle.value || "").trim();
      if (!title) return;

      const scriptWords = Math.max(0, Number($videoScriptWords.value) || 0);
      const durationSec = toSeconds($videoDurationMin.value, $videoDurationSec.value);
      const editedSec = Math.min(durationSec, toSeconds($videoEditedMin.value, $videoEditedSec.value));
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

  // === Render tarjetas ===
  function renderVideos() {
    if (!$videosList) return;
    const ids = Object.keys(videos || {});
    if (!ids.length) {
      $videosList.innerHTML = "";
      if ($videosEmpty) $videosEmpty.style.display = "block";
      return;
    }
    if ($videosEmpty) $videosEmpty.style.display = "none";

    ids.sort((a, b) => {
      const ta = videos[a].updatedAt || 0;
      const tb = videos[b].updatedAt || 0;
      return tb - ta;
    });

    const frag = document.createDocumentFragment();

    ids.forEach((id) => {
      const v = videos[id];
      const scriptTarget = v.scriptTarget || 2000;
      const scriptWords = Math.max(0, Number(v.scriptWords) || 0);
      const scriptPct = scriptTarget > 0 ? Math.min(100, Math.round((scriptWords / scriptTarget) * 100)) : 0;

      const durationTotal = v.durationSeconds || 0;
      const editedSec = Math.min(durationTotal, v.editedSeconds || 0);
      const editPct = durationTotal > 0 ? Math.min(100, Math.round((editedSec / durationTotal) * 100)) : 0;

      const totalPct = Math.round((scriptPct + editPct) / 2);

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

      const status = document.createElement("span");
      status.className = "video-status-pill";
      status.textContent =
        v.status === "published"
          ? "Publicado"
          : v.status === "in_progress"
          ? "En curso"
          : "Planificado";

      titleRow.appendChild(title);
      titleRow.appendChild(status);

      const meta = document.createElement("div");
      meta.className = "video-meta";

      const metaBits = [];
      if (v.publishDate) metaBits.push(`📅 ${v.publishDate}`);
      const durSplit = splitSeconds(durationTotal);
      if (durationTotal > 0) {
        metaBits.push(`🎬 ${durSplit.min}m ${durSplit.sec}s`);
      }
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

      const inputGroup = document.createElement("div");
      inputGroup.className = "video-input-group";
      inputGroup.innerHTML = `
        <div>Actualizar progreso</div>
        <div class="video-input-row">
          <span>Palabras</span>
          <input type="number" min="0" inputmode="numeric" value="${scriptWords}">
        </div>
        <div class="video-input-row">
          <span>Min</span>
          <input type="number" min="0" inputmode="numeric" value="${splitSeconds(editedSec).min}">
          <span>Seg</span>
          <input type="number" min="0" max="59" inputmode="numeric" value="${splitSeconds(editedSec).sec}">
        </div>
      `;

      const [inputWords, inputMin, inputSec] = inputGroup.querySelectorAll("input");
normalizeNumberField(inputMin);
normalizeNumberField(inputSec, 59);

      inputWords.addEventListener("change", () => {
        const newWords = Math.max(0, Number(inputWords.value) || 0);
        inputWords.value = newWords;
        updateVideoProgress(id, newWords, editedSec, scriptWords, editedSec);
      });

      const handleTimeChange = () => {
        let newMin = Math.max(0, Number(inputMin.value) || 0);
        let newSec = Math.max(0, Number(inputSec.value) || 0);
        if (newSec > 59) newSec = 59;
        inputMin.value = newMin;
        inputSec.value = newSec;
        const newEdited = Math.min(durationTotal, toSeconds(newMin, newSec));
        updateVideoProgress(id, scriptWords, newEdited, scriptWords, editedSec);
      };

      inputMin.addEventListener("change", handleTimeChange);
      inputSec.addEventListener("change", handleTimeChange);

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

      buttons.appendChild(btnEdit);
      buttons.appendChild(btnPublish);

      actions.appendChild(inputGroup);
      actions.appendChild(buttons);

      main.appendChild(titleRow);
      main.appendChild(meta);
      main.appendChild(bars);
      main.appendChild(remaining);
      main.appendChild(actions);

      card.appendChild(prog);
      card.appendChild(main);

      frag.appendChild(card);
    });

    $videosList.innerHTML = "";
    $videosList.appendChild(frag);
  }

  // Actualizar progreso + log diario
async function updateVideoProgress(videoId, newWords, newEditedSeconds, oldWords, oldEditedSeconds) {
  const v = videos[videoId];
  if (!v) return;

  const durationTotal = v.durationSeconds || 0;

  const safeNewWords  = Math.max(0, Number(newWords) || 0);
  const safeOldWords  = Math.max(0, Number(oldWords) || 0);

  const safeNewEdited = Math.max(0, Math.min(durationTotal, Number(newEditedSeconds) || 0));
  const safeOldEdited = Math.max(0, Math.min(durationTotal, Number(oldEditedSeconds) || 0));

  const diffWords   = safeNewWords  - safeOldWords;
  const diffSeconds = safeNewEdited - safeOldEdited;

  const updates = {
    scriptWords:  safeNewWords,
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
    let totalWords = 0;
    let totalSeconds = 0;

    Object.values(totals).forEach((t) => {
      totalWords += t.words || 0;
      totalSeconds += t.seconds || 0;
    });

    const { current } = computeVideoStreak(totals);
    const videosDone = Object.values(videos || {}).filter(
      (v) => v.status === "published"
    ).length;

    if ($videoStatCount) $videoStatCount.textContent = videosDone;
    if ($videoStatStreak) $videoStatStreak.textContent = current;
    if ($videoStatWords) $videoStatWords.textContent = totalWords;
    if ($videoStatTime) $videoStatTime.textContent = formatWorkTime(totalSeconds);
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
  const streakInfo = computeVideoStreak(totals);
  const streakSet = new Set(streakInfo.streakDays || []);

  // Fechas de publicación desde los datos de vídeo (YYYY-MM-DD)
  const publishSet = new Set();
  Object.values(videos || {}).forEach((v) => {
    if (v.publishDate) publishSet.add(v.publishDate);
  });

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
      const hasWork = (t.words || 0) > 0 || (t.seconds || 0) > 0;
      const isPublish = publishSet.has(key);
      const isStreak = streakSet.has(key);

      cell.className = "video-cal-cell";

      // PRIORIDAD: publicación > racha > trabajo
      if (isPublish) {
        cell.classList.add("video-cal-publish");
      } else {
        if (hasWork) cell.classList.add("video-cal-has-work");
        if (isStreak) cell.classList.add("video-cal-streak");
      }

      const num = document.createElement("div");
      num.className = "video-cal-day-number";
      num.textContent = String(dayNum);

      const metrics = document.createElement("div");
      metrics.className = "video-cal-metrics";

      if (isPublish && hasWork) {
        const timeStr = t.seconds ? formatWorkTime(t.seconds) : "";
        metrics.textContent =
          `📤 subida · ${t.words || 0} w` +
          (timeStr ? " · " + timeStr : "");
      } else if (isPublish) {
        metrics.textContent = "📤 subida";
      } else if (hasWork) {
        const timeStr = t.seconds ? formatWorkTime(t.seconds) : "";
        metrics.textContent =
          `${t.words || 0} w` +
          (timeStr ? " · " + timeStr : "");
      } else {
        metrics.textContent = "";
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