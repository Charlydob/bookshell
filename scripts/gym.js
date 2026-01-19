// gym.js
import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  set,
  update,
  push,
  remove
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const $viewGym = document.getElementById("view-gym");
if ($viewGym) {
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

  const DEVICE_ID_KEY = "bookshell:gym:deviceId:v1";
  const GYM_CACHE_KEY = "bookshell:gym:cache:v1";
  const GYM_OUTBOX_KEY = "bookshell:gym:outbox:v1";
  const GYM_LAST_SCREEN_KEY = "bookshell:gym:lastScreen";
  const GYM_LAST_WORKOUT_KEY = "bookshell:gym:lastWorkout";

  const MUSCLE_GROUPS = [
    "All",
    "Recent",
    "Shoulders",
    "Back",
    "Chest",
    "Biceps",
    "Triceps",
    "Forearms",
    "Core",
    "Quads",
    "Hamstrings",
    "Glutes",
    "Calves",
    "Cardio",
    "Other"
  ];

  const $gymHome = document.getElementById("gym-home");
  const $gymWorkout = document.getElementById("gym-workout");
  const $gymStats = document.getElementById("gym-stats");
  const $gymStartWorkout = document.getElementById("gym-start-workout");
  const $gymOpenStats = document.getElementById("gym-open-stats");
  const $gymHistoryList = document.getElementById("gym-history-list");
  const $gymHistoryEmpty = document.getElementById("gym-history-empty");
  const $gymCalPrev = document.getElementById("gym-cal-prev");
  const $gymCalNext = document.getElementById("gym-cal-next");
  const $gymCalLabel = document.getElementById("gym-cal-label");
  const $gymCalGrid = document.getElementById("gym-calendar-grid");
  const $gymWorkoutName = document.getElementById("gym-workout-name");
  const $gymWorkoutDate = document.getElementById("gym-workout-date");
  const $gymFinishWorkout = document.getElementById("gym-finish-workout");
  const $gymDiscardWorkout = document.getElementById("gym-discard-workout");
  const $gymAddExercise = document.getElementById("gym-add-exercise");
  const $gymBack = document.getElementById("gym-back");
  const $gymWorkoutEmoji = document.getElementById("gym-workout-emoji");
  const $gymMetricDuration = document.getElementById("gym-metric-duration");
  const $gymMetricVolume = document.getElementById("gym-metric-volume");
  const $gymMetricExercises = document.getElementById("gym-metric-exercises");
  const $gymWorkoutExercises = document.getElementById("gym-workout-exercises");
  const $gymStatsBack = document.getElementById("gym-stats-back");
  const $gymStatsKind = document.getElementById("gym-stats-kind");
  const $gymStatsControls = document.getElementById("gym-stats-controls");
  const $gymStatsChartHost = document.getElementById("gym-stats-chart");
  const $gymStatsEmpty = document.getElementById("gym-stats-empty");
  const $gymExDetailModal = document.getElementById("gym-exercise-detail-modal");
  const $gymExDetailEmoji = document.getElementById("gym-exdetail-emoji");
  const $gymExDetailTitle = document.getElementById("gym-exdetail-title");
  const $gymExDetailSub = document.getElementById("gym-exdetail-sub");
  const $gymExDetailEdit = document.getElementById("gym-exdetail-edit");
  const $gymExDetailClose = document.getElementById("gym-exdetail-close");
  const $gymExDetailKpis = document.getElementById("gym-exdetail-kpis");
  const $gymExDetailControls = document.getElementById("gym-exdetail-controls");
  const $gymExDetailChartHost = document.getElementById("gym-exdetail-chart");
  const $gymExDetailEmpty = document.getElementById("gym-exdetail-empty");
  const $gymExDetailDelete = document.getElementById("gym-exdetail-delete");

  const $gymBodyDate = document.getElementById("gym-body-date");
  const $gymBodyWeight = document.getElementById("gym-body-weight");
  const $gymBodyHeight = document.getElementById("gym-body-height");
  const $gymBodyMeta = document.getElementById("gym-body-meta");

  const $gymCardioNew = document.getElementById("gym-cardio-new");
  const $gymCardioList = document.getElementById("gym-cardio-list");
  const $gymCardioEmpty = document.getElementById("gym-cardio-empty");

  const $gymExerciseModal = document.getElementById("gym-exercise-modal");
  const $gymExerciseClose = document.getElementById("gym-exercise-close");
  const $gymExerciseSearch = document.getElementById("gym-exercise-search");
  const $gymMuscleChips = document.getElementById("gym-muscle-chips");
  const $gymExerciseList = document.getElementById("gym-exercise-list");
  const $gymExerciseEmpty = document.getElementById("gym-exercise-empty");
  const $gymCreateCta = document.getElementById("gym-create-cta");
  const $gymCreateCtaText = document.getElementById("gym-create-cta-text");
  const $gymCreateToggle = document.getElementById("gym-create-toggle");
  const $gymCreateModal = document.getElementById("gym-create-modal");
  const $gymCreateClose = document.getElementById("gym-create-close");
  const $gymCreateName = document.getElementById("gym-create-name");
  const $gymCreateMuscleChips = document.getElementById("gym-create-muscle-chips");
  const $gymCreateExercise = document.getElementById("gym-create-exercise");
  const $gymCreateUnilateral = document.getElementById("gym-create-unilateral");
  const $gymCreateType = document.getElementById("gym-create-type");
  const $gymCreateTitle = $gymCreateModal?.querySelector(".modal-title");

  const $gymTemplateModal = document.getElementById("gym-template-modal");
  const $gymTemplateClose = document.getElementById("gym-template-close");
  const $gymTemplateName = document.getElementById("gym-template-name");
  const $gymCreateEmpty = document.getElementById("gym-create-empty");
  const $gymTemplateList = document.getElementById("gym-template-list");
  const $gymTemplateEmpty = document.getElementById("gym-template-empty");

  const $gymCardioModal = document.getElementById("gym-cardio-modal");
  const $gymCardioClose = document.getElementById("gym-cardio-close");
  const $gymCardioName = document.getElementById("gym-cardio-name");
  const $gymCardioDate = document.getElementById("gym-cardio-date");
  const $gymCardioTarget = document.getElementById("gym-cardio-target");
  const $gymCardioDistance = document.getElementById("gym-cardio-distance");
  const $gymCardioTime = document.getElementById("gym-cardio-time");
  const $gymCardioStart = document.getElementById("gym-cardio-start");
  const $gymCardioPause = document.getElementById("gym-cardio-pause");
  const $gymCardioResume = document.getElementById("gym-cardio-resume");
  const $gymCardioFinish = document.getElementById("gym-cardio-finish");
  const $gymCardioSummary = document.getElementById("gym-cardio-summary");
  const $gymCardioProgress = document.getElementById("gym-cardio-progress");

  const deviceId = getDeviceId();
  const basePath = `gym/${deviceId}`;
  const exercisesRef = ref(db, `${basePath}/exercises`);
  const templatesRef = ref(db, `${basePath}/templates`);
  const workoutsRef = ref(db, `${basePath}/workouts`);
  const bodyweightRef = ref(db, `${basePath}/body`);
  const cardioRef = ref(db, `${basePath}/cardio`);

  let exercises = {};
  let templates = {};
  let workoutsByDate = {};
  let bodyweightByDate = {};
  let cardioByDate = {};
  let currentWorkout = null;
  let workoutDraft = null;
  let currentMonth = new Date();
  let saveTimer = null;
  let durationTimer = null;
  let bodyweightSaveTimer = null;
  let cardioDraft = null;
  let cardioTimer = null;
  let cardioSaveTimer = null;
  let cardioRunning = false;
  let cardioResumeAt = null;
  let selectedMuscle = "All";
  let createMuscles = new Set(["Chest"]);
  let pendingHomeRerender = false;
  let gymStatsChart = null;
  let gymExDetailChart = null;
  let gymStatsSelection = {
    kind: "body",
    cardioName: "",
    cardioMetric: "distanceKm",
    exerciseId: "",
    exerciseMetric: "maxKgEff"
  };
  let gymExDetailSelection = {
    exerciseId: "",
    metric: "maxKgEff"
  };
  let gymStatsReturnTo = "home";
  let currentGymScreen = "home";
  let editingExerciseId = null;
  let pendingResumeWorkout = null;

  init();

  function init() {
    loadGymCache();
    renderMuscleChips();
    renderCreateMuscleChips();
    bindEvents();
    restoreGymScreen();
    subscribeData();
    initBodyweightForm();
    window.addEventListener("online", () => {
      drainGymOutbox();
    });
    if (navigator.onLine) {
      drainGymOutbox();
    }
  }

  function bindEvents() {
    $gymStartWorkout.addEventListener("click", () => {
      openTemplateModal();
    });

    $gymOpenStats?.addEventListener("click", () => {
      openStatsScreen({ kind: gymStatsSelection.kind || "body" });
    });

    $gymBack.addEventListener("click", () => {
      showScreen("home");
    });

    $gymStatsBack?.addEventListener("click", () => {
      showScreen(gymStatsReturnTo);
    });

    $gymStatsKind?.addEventListener("change", () => {
      gymStatsSelection.kind = $gymStatsKind.value;
      renderStatsControls();
      renderStatsChart();
    });

    $gymStatsControls?.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.id === "gym-stats-cardio-name") {
        gymStatsSelection.cardioName = target.value;
      }
      if (target.id === "gym-stats-cardio-metric") {
        gymStatsSelection.cardioMetric = target.value;
      }
      if (target.id === "gym-stats-exercise-id") {
        gymStatsSelection.exerciseId = target.value;
      }
      if (target.id === "gym-stats-exercise-metric") {
        gymStatsSelection.exerciseMetric = target.value;
      }
      renderStatsChart();
    });

    $gymExDetailControls?.addEventListener("change", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLSelectElement)) return;
      if (target.id === "gym-exdetail-metric") {
        gymExDetailSelection.metric = target.value;
        renderExerciseDetailChart();
      }
    });

    $gymExDetailClose?.addEventListener("click", () => {
      closeExerciseDetailModal();
    });

    $gymExDetailEdit?.addEventListener("click", () => {
      if (!gymExDetailSelection.exerciseId) return;
      openEditExerciseModal(gymExDetailSelection.exerciseId);
    });

    $gymExDetailDelete?.addEventListener("click", () => {
      if (!gymExDetailSelection.exerciseId) return;
      deleteExercise(gymExDetailSelection.exerciseId);
    });

    $gymAddExercise.addEventListener("click", () => {
      openExerciseModal();
    });

    $gymExerciseClose.addEventListener("click", () => {
      closeExerciseModal();
    });

    $gymTemplateClose.addEventListener("click", () => {
      closeTemplateModal();
    });

    $gymCreateEmpty.addEventListener("click", () => {
      const name = ($gymTemplateName.value || "").trim() || "Entrenamiento";
      startWorkout({ name, templateId: null });
      closeTemplateModal();
    });

    $gymCreateExercise.addEventListener("click", () => {
      const name = ($gymCreateName.value || "").trim();
      if (!name) return;
      const now = Date.now();
      const muscleGroups = normalizeMuscleGroups(Array.from(createMuscles));
      const payload = {
        name,
        muscleGroups,
        type: $gymCreateType?.value || "reps",
        unilateral: Boolean($gymCreateUnilateral?.checked),
        updatedAt: now
      };
      if (editingExerciseId) {
        const exerciseId = editingExerciseId;
        const path = `${basePath}/exercises/${exerciseId}`;
        exercises[exerciseId] = {
          ...(exercises[exerciseId] || {}),
          id: exerciseId,
          ...payload
        };
        writeGymUpdate(path, payload);
        editingExerciseId = null;
      } else {
        const newRef = push(exercisesRef);
        const exercise = {
          id: newRef.key,
          createdAt: now,
          ...payload
        };
        exercises[newRef.key] = exercise;
        writeGymSet(`${basePath}/exercises/${newRef.key}`, exercise);
      }
      $gymCreateName.value = "";
      $gymCreateUnilateral.checked = false;
      closeCreateExerciseModal();
      renderExerciseList();
      refreshExerciseDetailIfOpen();
    });

    $gymExerciseSearch.addEventListener("input", () => {
      renderExerciseList();
    });

    $gymCreateToggle.addEventListener("click", () => {
      openCreateExerciseModal();
    });

    $gymCreateClose.addEventListener("click", () => {
      closeCreateExerciseModal();
    });

    $gymCreateCta.addEventListener("click", () => {
      const query = ($gymExerciseSearch.value || "").trim();
      openCreateExerciseModal(query);
    });

    $gymWorkoutName.addEventListener("input", () => {
      const workout = ensureWorkoutDraft();
      if (!workout) return;
      workout.name = $gymWorkoutName.value;
      scheduleWorkoutSave();
    });

    $gymWorkoutName.addEventListener("blur", () => {
      flushWorkoutSave();
    });

    $gymWorkoutDate.addEventListener("change", () => {
      const workout = ensureWorkoutDraft();
      if (!workout) return;
      const nextDate = $gymWorkoutDate.value;
      if (nextDate && nextDate !== workout.date) {
        moveWorkoutDate(nextDate);
      }
    });

    if ($gymWorkoutEmoji) {
      $gymWorkoutEmoji.addEventListener("click", () => {
        const workout = ensureWorkoutDraft();
        if (!workout) return;
        const nextEmoji = promptForEmoji(workout.emojiSnapshot);
        if (nextEmoji === workout.emojiSnapshot) return;
        workout.emojiSnapshot = nextEmoji;
        scheduleWorkoutSave();
        renderWorkoutEmoji(workout);
        upsertTemplateFromWorkout(workout, { emoji: nextEmoji });
      });
    }

    $gymFinishWorkout.addEventListener("click", () => {
      finishWorkout();
    });

    $gymDiscardWorkout.addEventListener("click", () => {
      discardWorkout();
    });

    $gymWorkoutExercises.addEventListener("input", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const card = target.closest(".gym-exercise-card");
      const row = target.closest(".gym-sets-row");
      if (!card) return;
      const exerciseId = card.dataset.exerciseId;
      if (!exerciseId) return;
      const field = target.dataset.field;
      if (!field) return;
      const workout = ensureWorkoutDraft();
      const exercise = workout?.exercises?.[exerciseId];
      if (!exercise) return;
      if (field === "useBodyweight") {
        exercise.useBodyweight = target.checked;
        scheduleWorkoutSave();
        renderWorkoutEditor();
        renderMetrics();
        return;
      }
      if (!row) return;
      const setIndex = Number(row.dataset.setIndex);
      if (!exercise.sets || !exercise.sets[setIndex]) return;
      if (field === "done") {
        exercise.sets[setIndex].done = target.checked;
      } else if (field === "timeText") {
        const { sec, text } = parseMmSsFromDigits(target.value);
        target.value = text;
        exercise.sets[setIndex].timeSec = sec;
      } else {
        const value = parseSetInput(field, target.value);
        exercise.sets[setIndex][field] = value;
      }
      scheduleWorkoutSave();
      renderMetrics();
    });

    $gymWorkoutExercises.addEventListener("blur", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      if (!target.closest(".gym-sets-row")) return;
      flushWorkoutSave();
    }, true);

    $gymWorkoutExercises.addEventListener("click", (event) => {
      const removeSetBtn = event.target.closest("[data-action='remove-set']");
      const addBtn = event.target.closest("[data-action='add-set']");
      const statsBtn = event.target.closest("[data-action='exercise-stats']");
      const removeBtn = event.target.closest("[data-action='exercise-remove']");
      const btn = removeSetBtn || addBtn || statsBtn || removeBtn;
      if (!btn) return;
      const card = btn.closest(".gym-exercise-card");
      if (!card) return;
      const exerciseId = card.dataset.exerciseId;
      if (removeSetBtn) {
        const row = removeSetBtn.closest(".gym-sets-row");
        if (!row) return;
        const setIndex = Number(row.dataset.setIndex);
        removeSetFromExercise(exerciseId, setIndex);
        return;
      }
      if (removeBtn) {
        removeExerciseFromWorkout(exerciseId);
        return;
      }
      if (statsBtn) {
        openExerciseDetailModal(exerciseId);
        return;
      }
      addSetToExercise(exerciseId);
    });

    $gymCalPrev.addEventListener("click", () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() - 1, 1);
      renderCalendar();
    });

    $gymCalNext.addEventListener("click", () => {
      currentMonth = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
      renderCalendar();
    });

    $gymBodyDate.addEventListener("change", () => {
      renderBodyweightForm();
    });

    [$gymBodyWeight, $gymBodyHeight].forEach((input) => {
      input.addEventListener("input", () => {
        scheduleBodyweightSave();
      });
      input.addEventListener("blur", () => {
        flushBodyweightSave();
      });
    });

    $gymCardioNew.addEventListener("click", () => {
      const cardio = createCardioSession();
      openCardioModal(cardio);
    });

    $gymCardioClose.addEventListener("click", () => {
      closeCardioModal();
    });

    $gymCardioName.addEventListener("input", () => {
      if (!cardioDraft) return;
      cardioDraft.name = $gymCardioName.value;
      scheduleCardioSave();
      renderCardioList();
    });

    $gymCardioDate.addEventListener("change", () => {
      if (!cardioDraft) return;
      const nextDate = $gymCardioDate.value;
      if (nextDate && nextDate !== cardioDraft.date) {
        moveCardioDate(nextDate);
      }
    });

    $gymCardioTarget.addEventListener("input", () => {
      if (!cardioDraft) return;
      cardioDraft.targetDistanceKm = parseDecimalInput($gymCardioTarget.value);
      scheduleCardioSave();
      renderCardioSummary();
    });

    $gymCardioDistance.addEventListener("input", () => {
      if (!cardioDraft) return;
      cardioDraft.distanceKm = parseDecimalInput($gymCardioDistance.value);
      scheduleCardioSave();
      renderCardioSummary();
    });

    $gymCardioStart.addEventListener("click", () => {
      startCardioTimer();
    });

    $gymCardioPause.addEventListener("click", () => {
      pauseCardioTimer();
    });

    $gymCardioResume.addEventListener("click", () => {
      resumeCardioTimer();
    });

    $gymCardioFinish.addEventListener("click", () => {
      finishCardioSession();
    });
  }

  function subscribeData() {
    onValue(exercisesRef, (snap) => {
      exercises = snap.val() || {};
      renderExerciseList();
      renderWorkoutEditor();
      refreshStatsIfActive({ includeControls: gymStatsSelection.kind === "exercise" });
      persistGymCache();
      refreshExerciseDetailIfOpen();
    });

    onValue(templatesRef, (snap) => {
      templates = snap.val() || {};
      renderTemplates();
      persistGymCache();
    });

    onValue(workoutsRef, (snap) => {
      workoutsByDate = snap.val() || {};
      syncCurrentWorkout();
      attemptResumeWorkout();
      if (isHomeActive()) {
        renderHistory();
        renderCalendar();
        pendingHomeRerender = false;
      } else {
        pendingHomeRerender = true;
      }
      if (!workoutDraft) {
        renderWorkoutEditor();
      }
      refreshStatsIfActive({ includeControls: gymStatsSelection.kind === "exercise" });
      persistGymCache();
    });

    onValue(bodyweightRef, (snap) => {
      bodyweightByDate = snap.val() || {};
      renderBodyweightForm();
      renderWorkoutEditor();
      refreshStatsIfActive();
      persistGymCache();
    });

    onValue(cardioRef, (snap) => {
      cardioByDate = snap.val() || {};
      renderCardioList();
      if (cardioDraft && !cardioRunning) {
        syncCardioDraft();
      }
      refreshStatsIfActive({ includeControls: gymStatsSelection.kind === "cardio" });
      persistGymCache();
    });
  }

  function getDeviceId() {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  function loadGymCache() {
    const raw = localStorage.getItem(GYM_CACHE_KEY);
    if (!raw) return;
    try {
      const cached = JSON.parse(raw);
      exercises = cached.exercises || exercises || {};
      templates = cached.templates || templates || {};
      workoutsByDate = cached.workoutsByDate || workoutsByDate || {};
      bodyweightByDate = cached.bodyweightByDate || bodyweightByDate || {};
      cardioByDate = cached.cardioByDate || cardioByDate || {};
      renderExerciseList();
      renderTemplates();
      renderHistory();
      renderCalendar();
      renderCardioList();
      renderBodyweightForm();
      renderWorkoutEditor();
      refreshExerciseDetailIfOpen();
    } catch (_) {}
  }

  function persistGymCache() {
    const payload = {
      exercises,
      templates,
      workoutsByDate,
      bodyweightByDate,
      cardioByDate,
      ts: Date.now()
    };
    try {
      localStorage.setItem(GYM_CACHE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }

  function getGymOutbox() {
    const raw = localStorage.getItem(GYM_OUTBOX_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_) {
      return [];
    }
  }

  function setGymOutbox(list) {
    try {
      localStorage.setItem(GYM_OUTBOX_KEY, JSON.stringify(list));
    } catch (_) {}
  }

  function enqueueGymOutbox(entry) {
    const outbox = getGymOutbox();
    outbox.push(entry);
    setGymOutbox(outbox);
  }

  function writeGymSet(path, payload) {
    return queueGymWrite("set", path, payload);
  }

  function writeGymUpdate(path, payload) {
    return queueGymWrite("update", path, payload);
  }

  function writeGymRemove(path) {
    return queueGymWrite("remove", path);
  }

  function queueGymWrite(op, path, payload) {
    if (!path) return Promise.resolve();
    if (!navigator.onLine) {
      enqueueGymOutbox({ op, path, payload });
      persistGymCache();
      return Promise.resolve();
    }
    const action = op === "set"
      ? set(ref(db, path), payload)
      : op === "update"
        ? update(ref(db, path), payload)
        : remove(ref(db, path));
    return action.catch(() => {
      enqueueGymOutbox({ op, path, payload });
      persistGymCache();
    });
  }

  async function drainGymOutbox() {
    if (!navigator.onLine) return;
    const outbox = getGymOutbox();
    if (!outbox.length) return;
    const remaining = [];
    for (const entry of outbox) {
      try {
        if (entry.op === "set") {
          await set(ref(db, entry.path), entry.payload);
        } else if (entry.op === "update") {
          await update(ref(db, entry.path), entry.payload);
        } else if (entry.op === "remove") {
          await remove(ref(db, entry.path));
        }
      } catch (_) {
        remaining.push(entry);
        break;
      }
    }
    setGymOutbox(remaining);
  }

  function persistGymScreen(name) {
    if (!name || (name !== "home" && name !== "workout")) return;
    localStorage.setItem(GYM_LAST_SCREEN_KEY, name);
    if (name === "workout") {
      const workout = workoutDraft || currentWorkout;
      if (workout?.id && workout?.date) {
        localStorage.setItem(GYM_LAST_WORKOUT_KEY, JSON.stringify({
          id: workout.id,
          date: workout.date
        }));
      }
      return;
    }
    localStorage.removeItem(GYM_LAST_WORKOUT_KEY);
  }

  function restoreGymScreen() {
    const lastScreen = localStorage.getItem(GYM_LAST_SCREEN_KEY);
    const workoutRaw = localStorage.getItem(GYM_LAST_WORKOUT_KEY);
    if (lastScreen === "workout" && workoutRaw) {
      try {
        pendingResumeWorkout = JSON.parse(workoutRaw);
      } catch (_) {
        pendingResumeWorkout = null;
      }
      showScreen("workout");
      return;
    }
    showScreen("home");
  }

  function attemptResumeWorkout() {
    if (!pendingResumeWorkout) return;
    const { id, date } = pendingResumeWorkout || {};
    const workout = workoutsByDate?.[date]?.[id];
    if (workout) {
      pendingResumeWorkout = null;
      openWorkout(workout.id);
      return;
    }
    if (Object.keys(workoutsByDate || {}).length) {
      pendingResumeWorkout = null;
      if (!currentWorkout) {
        showScreen("home");
      }
    }
  }

  function slugify(value) {
    return value
      .toLowerCase()
      .trim()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function dateKeyLocal(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  function formatDateLabel(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("es-ES", {
      day: "numeric",
      month: "short",
      year: "numeric"
    });
  }

  function formatChartDate(dateStr) {
    if (!dateStr) return "";
    const [y, m, d] = dateStr.split("-").map(Number);
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "short"
    });
  }

  function formatMonthLabel(date) {
    return date.toLocaleDateString("es-ES", { month: "long", year: "numeric" });
  }

  function formatDuration(seconds) {
    if (!seconds || seconds <= 0) return "0m";
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    if (hrs > 0) return `${hrs}h ${mins}m`;
    return `${mins}m`;
  }

  function formatTimer(seconds) {
    const total = Math.max(0, Math.floor(seconds || 0));
    const hrs = Math.floor(total / 3600);
    const mins = Math.floor((total % 3600) / 60);
    const secs = total % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    }
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function flattenWorkouts() {
    const list = [];
    Object.entries(workoutsByDate).forEach(([date, dayWorkouts]) => {
      Object.values(dayWorkouts || {}).forEach((workout) => {
        list.push({ ...workout, date });
      });
    });
    return list.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  function upsertWorkoutLocal(workout) {
    if (!workout?.id || !workout?.date) return;
    if (!workoutsByDate[workout.date]) {
      workoutsByDate[workout.date] = {};
    }
    workoutsByDate[workout.date][workout.id] = workout;
  }

  function removeWorkoutLocal(date, workoutId) {
    if (!date || !workoutId || !workoutsByDate[date]) return;
    delete workoutsByDate[date][workoutId];
    if (!Object.keys(workoutsByDate[date]).length) {
      delete workoutsByDate[date];
    }
  }

  function upsertCardioLocal(session) {
    if (!session?.id || !session?.date) return;
    if (!cardioByDate[session.date]) {
      cardioByDate[session.date] = {};
    }
    cardioByDate[session.date][session.id] = session;
  }

  function removeCardioLocal(date, sessionId) {
    if (!date || !sessionId || !cardioByDate[date]) return;
    delete cardioByDate[date][sessionId];
    if (!Object.keys(cardioByDate[date]).length) {
      delete cardioByDate[date];
    }
  }

  function upsertTemplateLocal(template) {
    if (!template?.id) return;
    templates[template.id] = template;
  }

  function initBodyweightForm() {
    if (!$gymBodyDate) return;
    if (!$gymBodyDate.value) {
      $gymBodyDate.value = dateKeyLocal(new Date());
    }
    renderBodyweightForm();
  }

  function renderBodyweightForm() {
    if (!$gymBodyDate) return;
    const dateKey = $gymBodyDate.value || dateKeyLocal(new Date());
    const entry = bodyweightByDate?.[dateKey] || null;
    $gymBodyWeight.value = entry?.weightKg ?? "";
    $gymBodyHeight.value = entry?.heightCm ?? "";
    if (entry?.updatedAt) {
      $gymBodyMeta.textContent = `Actualizado ${new Date(entry.updatedAt).toLocaleString("es-ES")}`;
      return;
    }
    const fallback = getLatestBodyweightEntry(dateKey);
    if (fallback?.entry) {
      const weightLabel = fallback.entry.weightKg ? `${fallback.entry.weightKg} kg` : "—";
      const heightLabel = fallback.entry.heightCm ? `${fallback.entry.heightCm} cm` : "—";
      $gymBodyMeta.textContent = `Último registro: ${weightLabel} · ${heightLabel} (${formatDateLabel(fallback.date)})`;
      return;
    }
    $gymBodyMeta.textContent = "Registra tu peso y altura para usarlo en los sets.";
  }

  function getLatestBodyweightEntry(dateKey) {
    const dates = Object.keys(bodyweightByDate || {}).filter((date) => date <= dateKey).sort();
    if (!dates.length) return null;
    const latest = dates[dates.length - 1];
    return { date: latest, entry: bodyweightByDate[latest] };
  }

  function getBodyweightForDate(dateKey) {
    return getLatestBodyweightEntry(dateKey)?.entry?.weightKg ?? null;
  }

  function buildExerciseStatsMap(excludeId) {
    const stats = {};
    flattenWorkouts().forEach((workout) => {
      if (workout.id === excludeId) return;
      if (!workout.exercises) return;
      Object.entries(workout.exercises).forEach(([exerciseId, data]) => {
        if (!stats[exerciseId]) {
          stats[exerciseId] = {
            maxSet: null,
            maxKgEff: null,
            lastSet: null,
            lastDoneSet: null
          };
        }
        if (!stats[exerciseId].lastSet && data?.sets?.length) {
          stats[exerciseId].lastSet = data.sets[data.sets.length - 1];
        }
        if (!stats[exerciseId].lastDoneSet && data?.sets?.length) {
          for (let idx = data.sets.length - 1; idx >= 0; idx -= 1) {
            if (data.sets[idx]?.done) {
              stats[exerciseId].lastDoneSet = data.sets[idx];
              break;
            }
          }
        }
        const useBodyweight = getExerciseUseBodyweight(data);
        (data?.sets || []).forEach((set) => {
          const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight);
          if (kgEff === null) return;
          if (stats[exerciseId].maxKgEff === null || kgEff > stats[exerciseId].maxKgEff) {
            stats[exerciseId].maxKgEff = kgEff;
            stats[exerciseId].maxSet = set;
          }
        });
      });
    });
    return stats;
  }

  function getLastExerciseSets(exerciseId, excludeId) {
    const workouts = flattenWorkouts();
    for (const workout of workouts) {
      if (workout.id === excludeId) continue;
      const sets = workout.exercises?.[exerciseId]?.sets;
      if (sets?.length) return sets;
    }
    return null;
  }

  function buildSetsFromHistory(exerciseId, excludeId, exerciseType = "reps") {
    const lastSets = getLastExerciseSets(exerciseId, excludeId);
    if (!lastSets || !lastSets.length) {
      return [createEmptySet(exerciseType)];
    }
    return lastSets.map(() => createEmptySet(exerciseType));
  }

  function createEmptySet(exerciseType) {
    if (exerciseType === "time") {
      return { timeSec: null, kg: null, extraKg: null, rpe: null, done: false };
    }
    return { reps: null, kg: null, extraKg: null, rpe: null, done: false };
  }

  function showScreen(name) {
    $gymHome.classList.toggle("gym-screen-active", name === "home");
    $gymWorkout.classList.toggle("gym-screen-active", name === "workout");
    $gymStats?.classList.toggle("gym-screen-active", name === "stats");
    currentGymScreen = name;
    persistGymScreen(name);
    if (name === "workout") {
      startDurationTicker();
    } else {
      stopDurationTicker();
    }
    if (name === "stats") {
      requestAnimationFrame(() => {
        gymStatsChart?.resize();
      });
    }
    if (name === "home" && pendingHomeRerender) {
      renderHistory();
      renderCalendar();
      pendingHomeRerender = false;
    }
  }

  function isHomeActive() {
    return $gymHome.classList.contains("gym-screen-active");
  }

  function isStatsActive() {
    return Boolean($gymStats?.classList.contains("gym-screen-active"));
  }

  function refreshStatsIfActive({ includeControls = false } = {}) {
    if (!isStatsActive()) return;
    if (includeControls) {
      renderStatsControls();
    }
    renderStatsChart();
  }

  function openStatsScreen({ kind = "body", exerciseId = "", returnTo } = {}) {
    gymStatsSelection.kind = kind || gymStatsSelection.kind || "body";
    if (exerciseId) {
      gymStatsSelection.exerciseId = exerciseId;
    }
    gymStatsReturnTo = returnTo || currentGymScreen;
    showScreen("stats");
    initGymStatsChart();
    renderStatsControls();
    renderStatsChart();
  }

  function initGymStatsChart() {
    if (gymStatsChart || !$gymStatsChartHost) return;
    gymStatsChart = echarts.init($gymStatsChartHost);
  }

  function renderStatsControls() {
    if (!$gymStatsControls || !$gymStatsKind) return;
    const kind = gymStatsSelection.kind || "body";
    $gymStatsKind.value = kind;
    $gymStatsControls.innerHTML = "";
    if (kind === "cardio") {
      const names = getCardioNameOptions();
      if (names.length && !names.includes(gymStatsSelection.cardioName)) {
        gymStatsSelection.cardioName = names[0];
      }
      if (!gymStatsSelection.cardioName) {
        gymStatsSelection.cardioName = names[0] || "";
      }
      const metrics = [
        { value: "distanceKm", label: "Distancia (km)" },
        { value: "durationSec", label: "Duración (min)" },
        { value: "avgPaceSecPerKm", label: "Ritmo (min/km)" },
        { value: "avgSpeedKmh", label: "Velocidad (km/h)" }
      ];
      if (!gymStatsSelection.cardioMetric) {
        gymStatsSelection.cardioMetric = "distanceKm";
      }
      const row = document.createElement("div");
      row.className = "gym-stats-row";
      row.appendChild(buildSelectField({
        id: "gym-stats-cardio-name",
        label: "Actividad",
        options: names.map((name) => ({ value: name, label: name })),
        value: gymStatsSelection.cardioName,
        disabled: !names.length,
        emptyLabel: "Sin datos"
      }));
      row.appendChild(buildSelectField({
        id: "gym-stats-cardio-metric",
        label: "Métrica",
        options: metrics,
        value: gymStatsSelection.cardioMetric
      }));
      $gymStatsControls.appendChild(row);
      return;
    }
    if (kind === "exercise") {
      const exerciseOptions = getExerciseOptions();
      const exerciseIds = exerciseOptions.map((option) => option.value);
      if (exerciseIds.length && !exerciseIds.includes(gymStatsSelection.exerciseId)) {
        gymStatsSelection.exerciseId = exerciseIds[0];
      }
      if (!gymStatsSelection.exerciseId) {
        gymStatsSelection.exerciseId = exerciseIds[0] || "";
      }
      const exerciseType = getExerciseTypeFromCatalog(gymStatsSelection.exerciseId);
      const metrics = exerciseType === "time"
        ? [
          { value: "maxKgEff", label: "Máximo (kg)" },
          { value: "loadTime", label: "Carga-tiempo" },
          { value: "timeSec", label: "Tiempo (min)" }
        ]
        : [
          { value: "maxKgEff", label: "Máximo (kg)" },
          { value: "volumeKg", label: "Volumen (kg)" },
          { value: "reps", label: "Repeticiones" }
        ];
      if (!metrics.some((metric) => metric.value === gymStatsSelection.exerciseMetric)) {
        gymStatsSelection.exerciseMetric = "maxKgEff";
      }
      const row = document.createElement("div");
      row.className = "gym-stats-row";
      row.appendChild(buildSelectField({
        id: "gym-stats-exercise-id",
        label: "Ejercicio",
        options: exerciseOptions,
        value: gymStatsSelection.exerciseId,
        disabled: !exerciseOptions.length,
        emptyLabel: "Sin ejercicios"
      }));
      row.appendChild(buildSelectField({
        id: "gym-stats-exercise-metric",
        label: "Métrica",
        options: metrics,
        value: gymStatsSelection.exerciseMetric
      }));
      $gymStatsControls.appendChild(row);
    }
  }

  function buildSelectField({ id, label, options, value, disabled = false, emptyLabel = "" }) {
    const field = document.createElement("label");
    field.className = "gym-field";
    const span = document.createElement("span");
    span.textContent = label;
    const select = document.createElement("select");
    select.className = "gym-select";
    select.id = id;
    if (!options.length && emptyLabel) {
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = emptyLabel;
      select.appendChild(emptyOption);
    } else {
      options.forEach((option) => {
        const opt = document.createElement("option");
        opt.value = option.value;
        opt.textContent = option.label;
        select.appendChild(opt);
      });
    }
    if (value !== undefined) {
      select.value = value;
    }
    if (disabled) {
      select.disabled = true;
    }
    field.appendChild(span);
    field.appendChild(select);
    return field;
  }

  function getExerciseOptions() {
    return Object.values(exercises || {})
      .sort((a, b) => (a.name || "").localeCompare(b.name || "", "es"))
      .map((exercise) => ({
        value: exercise.id,
        label: exercise.name || "Sin nombre"
      }));
  }

  function getExerciseTypeFromCatalog(exerciseId) {
    return exercises?.[exerciseId]?.type || "reps";
  }

  function getCardioNameOptions() {
    const names = new Set();
    flattenCardioSessions().forEach((session) => {
      if (session?.name) {
        names.add(session.name);
      }
    });
    return Array.from(names).sort((a, b) => a.localeCompare(b, "es"));
  }

  function renderStatsChart() {
    if (!$gymStatsChartHost || !$gymStatsEmpty) return;
    initGymStatsChart();
    const { labels, values, yLabel } = buildStatsSeries();
    const hasData = labels.length && values.length;
    $gymStatsEmpty.classList.toggle("hidden", hasData);
    $gymStatsChartHost.classList.toggle("hidden", !hasData);
    if (!hasData) {
      gymStatsChart?.clear();
      return;
    }
    gymStatsChart.setOption({
      grid: { left: 44, right: 18, top: 16, bottom: 32 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { color: "#9aa4b2" },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        name: yLabel,
        axisLabel: { color: "#9aa4b2" },
        splitLine: { show: false }
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: values,
          lineStyle: { width: 2 },
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color: "#f7b541" }
        }
      ]
    });
  }

  function buildStatsSeries() {
    const kind = gymStatsSelection.kind || "body";
    if (kind === "cardio") {
      return buildCardioSeries();
    }
    if (kind === "exercise") {
      return buildExerciseSeries();
    }
    return buildBodyweightSeries();
  }

  function buildBodyweightSeries() {
    const entries = Object.entries(bodyweightByDate || {})
      .filter(([, entry]) => entry?.weightKg != null)
      .sort(([a], [b]) => a.localeCompare(b));
    const labels = [];
    const values = [];
    entries.forEach(([date, entry]) => {
      labels.push(formatChartDate(date));
      values.push(entry.weightKg);
    });
    return { labels, values, yLabel: "Peso (kg)" };
  }

  function buildCardioSeries() {
    const metric = gymStatsSelection.cardioMetric || "distanceKm";
    const selectedName = gymStatsSelection.cardioName;
    const sessions = flattenCardioSessions()
      .filter((session) => !selectedName || session.name === selectedName)
      .map((session) => {
        const value = getCardioMetricValue(session, metric);
        return {
          date: session.date,
          value,
          ts: session.startedAt || session.updatedAt || 0
        };
      })
      .filter((entry) => entry.value != null);
    sessions.sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const labels = [];
    const values = [];
    sessions.forEach((session) => {
      labels.push(formatChartDate(session.date));
      values.push(session.value);
    });
    const labelMap = {
      distanceKm: "Distancia (km)",
      durationSec: "Duración (min)",
      avgPaceSecPerKm: "Ritmo (min/km)",
      avgSpeedKmh: "Velocidad (km/h)"
    };
    return { labels, values, yLabel: labelMap[metric] || "" };
  }

  function getCardioMetricValue(session, metric) {
    if (!session) return null;
    if (metric === "durationSec") {
      return session.durationSec != null ? session.durationSec / 60 : null;
    }
    if (metric === "avgPaceSecPerKm") {
      return session.avgPaceSecPerKm != null ? session.avgPaceSecPerKm / 60 : null;
    }
    return session[metric] ?? null;
  }

  function buildExerciseSeries() {
    const exerciseId = gymStatsSelection.exerciseId;
    const metric = gymStatsSelection.exerciseMetric || "maxKgEff";
    return buildExerciseSeriesFor(exerciseId, metric);
  }

  function buildExerciseSeriesFor(exerciseId, metric) {
    if (!exerciseId) {
      return { labels: [], values: [], yLabel: "" };
    }
    const entries = [];
    flattenWorkouts().forEach((workout) => {
      const exerciseData = workout.exercises?.[exerciseId];
      if (!exerciseData?.sets?.length) return;
      const exerciseType = getExerciseType(exerciseData, exerciseId);
      const unilateral = getExerciseUnilateral(exerciseData, exerciseId);
      const useBodyweight = getExerciseUseBodyweight(exerciseData);
      let maxKgEff = null;
      let volumeKg = 0;
      let reps = 0;
      let loadTime = 0;
      let timeSecTotal = 0;
      let hasDone = false;
      exerciseData.sets.forEach((set) => {
        if (!set?.done) return;
        if (exerciseType === "time") {
          const timeSec = Number(set.timeSec) || 0;
          if (timeSec <= 0) return;
          const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight);
          timeSecTotal += timeSec;
          if (kgEff != null) {
            maxKgEff = maxKgEff === null ? kgEff : Math.max(maxKgEff, kgEff);
            loadTime += kgEff * timeSec;
          }
          hasDone = true;
          return;
        }
        const repsValue = Number(set.reps) || 0;
        const repsEff = unilateral ? repsValue * 2 : repsValue;
        const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight);
        reps += repsEff;
        if (kgEff != null) {
          maxKgEff = maxKgEff === null ? kgEff : Math.max(maxKgEff, kgEff);
          volumeKg += repsEff * kgEff;
        }
        hasDone = true;
      });
      if (!hasDone) return;
      let value = null;
      if (metric === "maxKgEff") value = maxKgEff;
      if (metric === "volumeKg") value = volumeKg;
      if (metric === "reps") value = reps;
      if (metric === "loadTime") value = loadTime;
      if (metric === "timeSec") value = timeSecTotal / 60;
      if (value == null) return;
      entries.push({
        date: workout.date,
        value,
        ts: workout.startedAt || 0
      });
    });
    entries.sort((a, b) => a.date.localeCompare(b.date) || a.ts - b.ts);
    const labels = [];
    const values = [];
    entries.forEach((entry) => {
      labels.push(formatChartDate(entry.date));
      values.push(entry.value);
    });
    const labelMap = {
      maxKgEff: "Máximo (kg)",
      volumeKg: "Volumen (kg)",
      reps: "Repeticiones",
      loadTime: "Carga-tiempo",
      timeSec: "Tiempo (min)"
    };
    return { labels, values, yLabel: labelMap[metric] || "" };
  }

  function initGymExDetailChart() {
    if (gymExDetailChart || !$gymExDetailChartHost) return;
    gymExDetailChart = echarts.init($gymExDetailChartHost);
  }

  function openExerciseDetailModal(exerciseId) {
    const exercise = exercises?.[exerciseId];
    if (!exercise || !$gymExDetailModal) return;
    gymExDetailSelection.exerciseId = exerciseId;
    const exerciseType = exercise.type || "reps";
    const metricOptions = exerciseType === "time"
      ? [
        { value: "maxKgEff", label: "Máximo (kg)" },
        { value: "loadTime", label: "Carga-tiempo" },
        { value: "timeSec", label: "Tiempo (min)" }
      ]
      : [
        { value: "maxKgEff", label: "Máximo (kg)" },
        { value: "volumeKg", label: "Volumen (kg)" },
        { value: "reps", label: "Repeticiones" }
      ];
    if (!metricOptions.some((metric) => metric.value === gymExDetailSelection.metric)) {
      gymExDetailSelection.metric = metricOptions[0]?.value || "maxKgEff";
    }
    renderExerciseDetailHeader(exercise);
    renderExerciseDetailKpis(exerciseId);
    renderExerciseDetailControls(metricOptions);
    renderExerciseDetailChart();
    $gymExDetailModal.classList.remove("hidden");
    requestAnimationFrame(() => {
      gymExDetailChart?.resize();
    });
  }

  function closeExerciseDetailModal() {
    if (!$gymExDetailModal) return;
    $gymExDetailModal.classList.add("hidden");
  }

  function renderExerciseDetailHeader(exercise) {
    if (!exercise) return;
    if ($gymExDetailEmoji) {
      $gymExDetailEmoji.textContent = exercise.emoji || "💪";
    }
    if ($gymExDetailTitle) {
      $gymExDetailTitle.textContent = exercise.name || "Ejercicio";
    }
    if ($gymExDetailSub) {
      const muscleLabel = formatMuscleGroupsLabel(getExerciseMuscleGroups(exercise));
      $gymExDetailSub.textContent = muscleLabel;
    }
  }

  function renderExerciseDetailControls(metricOptions) {
    if (!$gymExDetailControls) return;
    $gymExDetailControls.innerHTML = "";
    $gymExDetailControls.appendChild(buildSelectField({
      id: "gym-exdetail-metric",
      label: "Métrica",
      options: metricOptions,
      value: gymExDetailSelection.metric
    }));
  }

  function renderExerciseDetailKpis(exerciseId) {
    if (!$gymExDetailKpis) return;
    const summary = buildExerciseDetailSummary(exerciseId);
    if (!summary) {
      $gymExDetailKpis.innerHTML = "";
      return;
    }
    const timeLabel = summary.timeSecTotal ? formatTimer(summary.timeSecTotal) : "—";
    const repsLabel = summary.repsTotal ? String(summary.repsTotal) : "0";
    const volumeLabel = summary.volumeTotalKg ? `${Math.round(summary.volumeTotalKg)} kg` : "0 kg";
    const maxKgLabel = summary.maxKgEff != null ? `${formatKgValue(summary.maxKgEff)} kg` : "—";
    const avgKgLabel = summary.avgKgEff != null ? `${formatKgValue(summary.avgKgEff)} kg` : "—";
    const activityLabel = summary.exerciseType === "time" ? timeLabel : repsLabel;
    const activityTitle = summary.exerciseType === "time" ? "Tiempo total" : "Reps totales";
    const kpis = [
      { label: "Sets totales", value: String(summary.setsCount) },
      { label: activityTitle, value: activityLabel },
      { label: "Volumen total", value: volumeLabel },
      { label: "Peso máximo", value: maxKgLabel },
      { label: "Peso medio", value: avgKgLabel }
    ];
    $gymExDetailKpis.innerHTML = kpis.map((kpi) => `
      <div class="gym-card gym-kpi-card">
        <div class="gym-kpi-label">${kpi.label}</div>
        <div class="gym-kpi-value">${kpi.value}</div>
      </div>
    `).join("");
  }

  function renderExerciseDetailChart() {
    if (!$gymExDetailChartHost || !$gymExDetailEmpty) return;
    initGymExDetailChart();
    const { labels, values, yLabel } = buildExerciseSeriesFor(
      gymExDetailSelection.exerciseId,
      gymExDetailSelection.metric
    );
    const hasData = labels.length && values.length;
    $gymExDetailEmpty.classList.toggle("hidden", hasData);
    $gymExDetailChartHost.classList.toggle("hidden", !hasData);
    if (!hasData) {
      gymExDetailChart?.clear();
      return;
    }
    gymExDetailChart.setOption({
      grid: { left: 44, right: 18, top: 16, bottom: 32 },
      tooltip: { trigger: "axis" },
      xAxis: {
        type: "category",
        data: labels,
        boundaryGap: false,
        axisLabel: { color: "#9aa4b2" },
        splitLine: { show: false }
      },
      yAxis: {
        type: "value",
        name: yLabel,
        axisLabel: { color: "#9aa4b2" },
        splitLine: { show: false }
      },
      series: [
        {
          type: "line",
          smooth: true,
          data: values,
          lineStyle: { width: 2 },
          symbol: "circle",
          symbolSize: 6,
          itemStyle: { color: "#f7b541" }
        }
      ]
    });
  }

  function buildExerciseDetailSummary(exerciseId) {
    const exercise = exercises?.[exerciseId];
    if (!exercise) return null;
    const exerciseType = exercise.type || "reps";
    let setsCount = 0;
    let repsTotal = 0;
    let timeSecTotal = 0;
    let volumeTotalKg = 0;
    let maxKgEff = null;
    let sumKgEff = 0;
    let kgEffCount = 0;
    flattenWorkouts().forEach((workout) => {
      const exerciseData = workout.exercises?.[exerciseId];
      if (!exerciseData?.sets?.length) return;
      const type = getExerciseType(exerciseData, exerciseId);
      const unilateral = getExerciseUnilateral(exerciseData, exerciseId);
      const useBodyweight = getExerciseUseBodyweight(exerciseData);
      exerciseData.sets.forEach((set) => {
        if (!set?.done) return;
        setsCount += 1;
        const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight);
        if (kgEff != null) {
          maxKgEff = maxKgEff === null ? kgEff : Math.max(maxKgEff, kgEff);
          sumKgEff += kgEff;
          kgEffCount += 1;
        }
        if (type === "time") {
          const timeSec = Number(set.timeSec) || 0;
          timeSecTotal += timeSec;
          if (kgEff != null) {
            volumeTotalKg += timeSec * kgEff;
          }
          return;
        }
        const repsValue = Number(set.reps) || 0;
        const repsEff = unilateral ? repsValue * 2 : repsValue;
        repsTotal += repsEff;
        if (kgEff != null) {
          volumeTotalKg += repsEff * kgEff;
        }
      });
    });
    const avgKgEff = kgEffCount ? (sumKgEff / kgEffCount) : null;
    return {
      exerciseType,
      setsCount,
      repsTotal,
      timeSecTotal,
      volumeTotalKg,
      maxKgEff,
      avgKgEff
    };
  }

  function refreshExerciseDetailIfOpen() {
    if (!$gymExDetailModal || $gymExDetailModal.classList.contains("hidden")) return;
    const exerciseId = gymExDetailSelection.exerciseId;
    const exercise = exercises?.[exerciseId];
    if (!exercise) {
      closeExerciseDetailModal();
      return;
    }
    const metricOptions = exercise.type === "time"
      ? [
        { value: "maxKgEff", label: "Máximo (kg)" },
        { value: "loadTime", label: "Carga-tiempo" },
        { value: "timeSec", label: "Tiempo (min)" }
      ]
      : [
        { value: "maxKgEff", label: "Máximo (kg)" },
        { value: "volumeKg", label: "Volumen (kg)" },
        { value: "reps", label: "Repeticiones" }
      ];
    if (!metricOptions.some((metric) => metric.value === gymExDetailSelection.metric)) {
      gymExDetailSelection.metric = metricOptions[0]?.value || "maxKgEff";
    }
    renderExerciseDetailHeader(exercise);
    renderExerciseDetailKpis(exerciseId);
    renderExerciseDetailControls(metricOptions);
    renderExerciseDetailChart();
  }

  function openEditExerciseModal(exerciseId) {
    const exercise = exercises?.[exerciseId];
    if (!exercise) return;
    editingExerciseId = exerciseId;
    createMuscles = new Set(getExerciseMuscleGroups(exercise));
    $gymCreateName.value = exercise.name || "";
    $gymCreateType.value = exercise.type || "reps";
    $gymCreateUnilateral.checked = Boolean(exercise.unilateral);
    updateActiveChipsMulti($gymCreateMuscleChips, createMuscles);
    if ($gymCreateTitle) {
      $gymCreateTitle.textContent = "Editar ejercicio";
    }
    $gymCreateExercise.textContent = "Guardar";
    $gymCreateModal.classList.remove("hidden");
  }

  function deleteExercise(exerciseId) {
    const exercise = exercises?.[exerciseId];
    if (!exercise) return;
    const confirmed = window.confirm(`¿Eliminar "${exercise.name}"?`);
    if (!confirmed) return;
    delete exercises[exerciseId];
    writeGymRemove(`${basePath}/exercises/${exerciseId}`);
    Object.values(templates || {}).forEach((template) => {
      const nextIds = (template.exerciseIds || []).filter((id) => id !== exerciseId);
      if (nextIds.length === (template.exerciseIds || []).length) return;
      const payload = {
        exerciseIds: nextIds,
        updatedAt: Date.now()
      };
      templates[template.id] = { ...template, ...payload };
      writeGymUpdate(`${basePath}/templates/${template.id}`, payload);
    });
    persistGymCache();
    renderExerciseList();
    renderTemplates();
    closeExerciseDetailModal();
  }

  function openExerciseModal() {
    $gymExerciseModal.classList.remove("hidden");
    $gymExerciseSearch.value = "";
    renderExerciseList();
  }

  function closeExerciseModal() {
    $gymExerciseModal.classList.add("hidden");
  }

  function openCreateExerciseModal(prefillName = "") {
    editingExerciseId = null;
    $gymCreateModal.classList.remove("hidden");
    $gymCreateName.value = prefillName;
    if ($gymCreateType) {
      $gymCreateType.value = "reps";
    }
    if ($gymCreateTitle) {
      $gymCreateTitle.textContent = "Crear ejercicio";
    }
    $gymCreateExercise.textContent = "Crear";
    $gymCreateName.focus();
  }

  function closeCreateExerciseModal() {
    $gymCreateModal.classList.add("hidden");
    $gymCreateName.value = "";
    $gymCreateUnilateral.checked = false;
    if ($gymCreateType) {
      $gymCreateType.value = "reps";
    }
    if ($gymCreateTitle) {
      $gymCreateTitle.textContent = "Crear ejercicio";
    }
    $gymCreateExercise.textContent = "Crear";
    editingExerciseId = null;
  }

  function openTemplateModal() {
    $gymTemplateModal.classList.remove("hidden");
    renderTemplates();
  }

  function closeTemplateModal() {
    $gymTemplateModal.classList.add("hidden");
  }

  function renderTemplates() {
    const list = Object.values(templates || {});
    $gymTemplateList.innerHTML = "";
    if (!list.length) {
      $gymTemplateEmpty.classList.remove("hidden");
      return;
    }
    $gymTemplateEmpty.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    list
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .forEach((template) => {
        const row = document.createElement("div");
        row.className = "gym-template-row";
        row.innerHTML = `
          <div class="gym-template-name">${template.name}</div>
          <button class="gym-btn gym-btn-ghost" type="button">Usar</button>
        `;
        const btn = row.querySelector("button");
        btn.addEventListener("click", () => {
          const name = ($gymTemplateName.value || "").trim() || template.name;
          startWorkout({ name, templateId: template.id });
          closeTemplateModal();
        });
        fragment.appendChild(row);
      });
    $gymTemplateList.appendChild(fragment);
  }

  function startWorkout({ name, templateId }) {
    const date = dateKeyLocal(new Date());
    const workoutId = push(ref(db, `${basePath}/workouts/${date}`)).key;
    const now = Date.now();
    const exercisesData = {};
    const template = templateId ? templates[templateId] : null;
    const exerciseIds = template?.exerciseIds || [];
    exerciseIds.forEach((exerciseId) => {
      const exercise = exercises[exerciseId];
      if (!exercise) return;
      const muscleGroups = getExerciseMuscleGroups(exercise);
      const exerciseType = exercise.type || "reps";
      const sets = buildSetsFromHistory(exerciseId, null, exerciseType);
      exercisesData[exerciseId] = {
        nameSnapshot: exercise.name,
        muscleGroupsSnapshot: muscleGroups,
        unilateralSnapshot: Boolean(exercise.unilateral),
        typeSnapshot: exerciseType,
        useBodyweight: false,
        sets
      };
    });
    const workout = {
      id: workoutId,
      date,
      name,
      startedAt: now,
      finishedAt: null,
      durationSec: 0,
      emojiSnapshot: template?.emoji || null,
      exercises: exercisesData,
      totalReps: 0,
      totalVolumeKg: 0
    };
    upsertWorkoutLocal(workout);
    writeGymSet(`${basePath}/workouts/${date}/${workoutId}`, workout);
    persistGymCache();
    currentWorkout = workout;
    workoutDraft = cloneWorkout(workout);
    showScreen("workout");
    renderWorkoutEditor();
  }

  function renderHistory() {
    const workouts = flattenWorkouts();
    $gymHistoryList.innerHTML = "";
    if (!workouts.length) {
      $gymHistoryEmpty.classList.remove("hidden");
      return;
    }
    $gymHistoryEmpty.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    workouts.forEach((workout) => {
      const exerciseNames = Object.values(workout.exercises || {}).map((ex) => ex.nameSnapshot);
      const chipList = exerciseNames.slice(0, 2);
      const card = document.createElement("div");
      card.className = "gym-card gym-history-card";
      card.dataset.workoutId = workout.id;
      card.innerHTML = `
        <div class="gym-history-header">
          <div>
            <div class="gym-history-title">${workout.name || "Entrenamiento"}</div>
            <div class="gym-history-date">${formatDateLabel(workout.date)}</div>
          </div>
          <div class="gym-history-metrics">
            <div>Volumen ${Math.round(workout.totalVolumeKg || 0)} kg</div>
            <div>Reps ${Math.round(workout.totalReps || 0)}</div>
          </div>
        </div>
        <div class="gym-chip-row">
          ${chipList.map((name) => `<span class="gym-chip">${name}</span>`).join("")}
        </div>
      `;
      card.addEventListener("click", () => {
        openWorkout(workout.id);
      });
      fragment.appendChild(card);
    });
    $gymHistoryList.appendChild(fragment);
  }

  function flattenCardioSessions() {
    const list = [];
    Object.entries(cardioByDate || {}).forEach(([date, daySessions]) => {
      Object.values(daySessions || {}).forEach((session) => {
        list.push({ ...session, date });
      });
    });
    return list.sort((a, b) => (b.updatedAt || b.startedAt || 0) - (a.updatedAt || a.startedAt || 0));
  }

  function renderCardioList() {
    if (!$gymCardioList) return;
    const sessions = flattenCardioSessions();
    $gymCardioList.innerHTML = "";
    if (!sessions.length) {
      $gymCardioEmpty.classList.remove("hidden");
      return;
    }
    $gymCardioEmpty.classList.add("hidden");
    const fragment = document.createDocumentFragment();
    sessions.forEach((session) => {
      const durationLabel = formatTimer(session.durationSec || 0);
      const distanceLabel = session.distanceKm ? `${formatKgValue(session.distanceKm)} km` : "Sin distancia";
      const card = document.createElement("div");
      card.className = "gym-cardio-row";
      card.innerHTML = `
        <div>
          <div class="gym-cardio-title">${session.name || "Cardio"}</div>
          <div class="gym-cardio-meta">${formatDateLabel(session.date)} · ${distanceLabel}</div>
        </div>
        <div class="gym-cardio-meta">${durationLabel}</div>
      `;
      card.addEventListener("click", () => {
        openCardioModal(session);
      });
      fragment.appendChild(card);
    });
    $gymCardioList.appendChild(fragment);
  }

  function openCardioModal(session) {
    cardioDraft = cloneCardioSession(session);
    cardioRunning = false;
    cardioResumeAt = null;
    $gymCardioModal.classList.remove("hidden");
    $gymCardioName.value = cardioDraft.name || "";
    $gymCardioDate.value = cardioDraft.date || dateKeyLocal(new Date());
    $gymCardioTarget.value = cardioDraft.targetDistanceKm ?? "";
    $gymCardioDistance.value = cardioDraft.distanceKm ?? "";
    $gymCardioTime.textContent = formatTimer(cardioDraft.durationSec || 0);
    renderCardioSummary();
    renderCardioControls();
  }

  function closeCardioModal() {
    if (cardioRunning) {
      pauseCardioTimer();
    }
    $gymCardioModal.classList.add("hidden");
    cardioDraft = null;
  }

  function syncCardioDraft() {
    if (!cardioDraft) return;
    const latest = findCardioById(cardioDraft.id);
    if (!latest) return;
    cardioDraft = cloneCardioSession(latest);
    $gymCardioName.value = cardioDraft.name || "";
    $gymCardioDate.value = cardioDraft.date || dateKeyLocal(new Date());
    $gymCardioTarget.value = cardioDraft.targetDistanceKm ?? "";
    $gymCardioDistance.value = cardioDraft.distanceKm ?? "";
    $gymCardioTime.textContent = formatTimer(cardioDraft.durationSec || 0);
    renderCardioSummary();
    renderCardioControls();
  }

  function findCardioById(cardioId) {
    return flattenCardioSessions().find((session) => session.id === cardioId) || null;
  }

  function createCardioSession() {
    const date = dateKeyLocal(new Date());
    const id = push(ref(db, `${basePath}/cardio/${date}`)).key;
    const payload = {
      id,
      date,
      name: "",
      startedAt: null,
      finishedAt: null,
      durationSec: 0,
      targetDistanceKm: null,
      distanceKm: null,
      avgSpeedKmh: null,
      avgPaceSecPerKm: null,
      updatedAt: Date.now()
    };
    upsertCardioLocal(payload);
    writeGymSet(`${basePath}/cardio/${date}/${id}`, payload);
    persistGymCache();
    return payload;
  }

  function renderCardioControls() {
    const hasStarted = Boolean(cardioDraft?.startedAt);
    const isFinished = Boolean(cardioDraft?.finishedAt);
    $gymCardioStart.classList.toggle("hidden", hasStarted);
    $gymCardioPause.classList.toggle("hidden", !cardioRunning);
    $gymCardioResume.classList.toggle("hidden", !hasStarted || cardioRunning || isFinished);
    $gymCardioFinish.classList.toggle("hidden", !hasStarted || isFinished);
  }

  function getCardioElapsed() {
    if (!cardioDraft) return 0;
    const base = cardioDraft.durationSec || 0;
    if (!cardioRunning || !cardioResumeAt) return base;
    return base + (Date.now() - cardioResumeAt) / 1000;
  }

  function startCardioTimer() {
    if (!cardioDraft) return;
    if (!cardioDraft.startedAt) {
      cardioDraft.startedAt = Date.now();
    }
    cardioRunning = true;
    cardioResumeAt = Date.now();
    startCardioTicker();
    scheduleCardioSave();
    renderCardioControls();
  }

  function resumeCardioTimer() {
    if (!cardioDraft || cardioRunning) return;
    cardioRunning = true;
    cardioResumeAt = Date.now();
    startCardioTicker();
    renderCardioControls();
  }

  function pauseCardioTimer() {
    if (!cardioDraft || !cardioRunning) return;
    cardioDraft.durationSec = Math.floor(getCardioElapsed());
    cardioRunning = false;
    cardioResumeAt = null;
    stopCardioTicker();
    scheduleCardioSave();
    renderCardioControls();
    renderCardioSummary();
  }

  function finishCardioSession() {
    if (!cardioDraft) return;
    cardioDraft.durationSec = Math.floor(getCardioElapsed());
    cardioDraft.finishedAt = Date.now();
    cardioRunning = false;
    cardioResumeAt = null;
    stopCardioTicker();
    updateCardioDerivedFields();
    saveCardioSession();
    renderCardioControls();
    renderCardioSummary();
    renderCardioList();
  }

  function startCardioTicker() {
    stopCardioTicker();
    cardioTimer = window.setInterval(() => {
      $gymCardioTime.textContent = formatTimer(getCardioElapsed());
    }, 400);
  }

  function stopCardioTicker() {
    if (cardioTimer) {
      window.clearInterval(cardioTimer);
      cardioTimer = null;
    }
  }

  function renderCardioSummary() {
    if (!cardioDraft) return;
    const duration = cardioDraft.durationSec || 0;
    const distance = cardioDraft.distanceKm || 0;
    let summary = "Introduce distancia para calcular ritmo o velocidad.";
    if (distance > 0 && duration > 0) {
      const speed = (distance / (duration / 3600));
      const pace = duration / distance;
      summary = `Tiempo ${formatTimer(duration)} · ${formatKgValue(distance)} km · ${formatKgValue(speed)} km/h · ${formatPace(pace)}`;
    } else if (duration > 0) {
      summary = `Tiempo ${formatTimer(duration)}`;
    }
    $gymCardioSummary.textContent = summary;
    const target = cardioDraft.targetDistanceKm;
    if (target && distance > 0) {
      const progress = Math.min(100, (distance / target) * 100);
      $gymCardioProgress.classList.remove("hidden");
      $gymCardioProgress.textContent = `Completado ${progress.toFixed(0)}% del objetivo`;
    } else {
      $gymCardioProgress.classList.add("hidden");
    }
  }

  function updateCardioDerivedFields() {
    if (!cardioDraft) return;
    const duration = cardioDraft.durationSec || 0;
    const distance = cardioDraft.distanceKm || 0;
    if (distance > 0 && duration > 0) {
      cardioDraft.avgSpeedKmh = distance / (duration / 3600);
      cardioDraft.avgPaceSecPerKm = duration / distance;
    } else {
      cardioDraft.avgSpeedKmh = null;
      cardioDraft.avgPaceSecPerKm = null;
    }
  }

  function scheduleCardioSave() {
    if (!cardioDraft) return;
    if (cardioSaveTimer) window.clearTimeout(cardioSaveTimer);
    cardioSaveTimer = window.setTimeout(() => {
      saveCardioSession();
    }, 700);
  }

  function saveCardioSession() {
    if (!cardioDraft) return;
    updateCardioDerivedFields();
    cardioDraft.updatedAt = Date.now();
    const path = `${basePath}/cardio/${cardioDraft.date}/${cardioDraft.id}`;
    upsertCardioLocal(cardioDraft);
    writeGymUpdate(path, cardioDraft);
    persistGymCache();
  }

  function moveCardioDate(newDate) {
    if (!cardioDraft) return;
    const oldPath = `${basePath}/cardio/${cardioDraft.date}/${cardioDraft.id}`;
    removeCardioLocal(cardioDraft.date, cardioDraft.id);
    cardioDraft.date = newDate;
    upsertCardioLocal(cardioDraft);
    const newPath = `${basePath}/cardio/${newDate}/${cardioDraft.id}`;
    writeGymSet(newPath, cardioDraft);
    writeGymRemove(oldPath);
    persistGymCache();
  }

  function cloneCardioSession(session) {
    return session ? structuredClone(session) : null;
  }

  function formatPace(secondsPerKm) {
    if (!Number.isFinite(secondsPerKm) || secondsPerKm <= 0) return "—";
    const mins = Math.floor(secondsPerKm / 60);
    const secs = Math.round(secondsPerKm % 60);
    return `${mins}:${String(secs).padStart(2, "0")} /km`;
  }

  function renderCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    $gymCalLabel.textContent = formatMonthLabel(currentMonth);
    const firstDay = new Date(year, month, 1);
    const startDay = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const workoutDays = new Set(Object.keys(workoutsByDate || {}));
    const workoutEmojiMap = buildWorkoutEmojiMap();
    const todayKey = dateKeyLocal(new Date());
    const labels = ["L", "M", "X", "J", "V", "S", "D"];
    const fragment = document.createDocumentFragment();
    labels.forEach((label) => {
      const cell = document.createElement("div");
      cell.className = "gym-calendar-day is-header";
      cell.textContent = label;
      fragment.appendChild(cell);
    });
    for (let i = 0; i < startDay; i += 1) {
      const spacer = document.createElement("div");
      spacer.className = "gym-calendar-day";
      fragment.appendChild(spacer);
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = dateKeyLocal(new Date(year, month, day));
      const hasWorkout = workoutDays.has(dateKey);
      const classes = ["gym-calendar-day"];
      if (hasWorkout) classes.push("has-workout");
      if (dateKey === todayKey) classes.push("is-today");
      const cell = document.createElement("div");
      cell.className = classes.join(" ");
      cell.textContent = getCalendarCellLabel(day, workoutEmojiMap[dateKey] || null);
      fragment.appendChild(cell);
    }
    $gymCalGrid.innerHTML = "";
    $gymCalGrid.appendChild(fragment);
  }

  function openWorkout(workoutId) {
    const workout = findWorkoutById(workoutId);
    if (!workout) return;
    currentWorkout = workout;
    workoutDraft = cloneWorkout(workout);
    migrateWorkoutExerciseData(workoutDraft);
    showScreen("workout");
    renderWorkoutEditor();
  }

  function findWorkoutById(workoutId) {
    const workouts = flattenWorkouts();
    return workouts.find((workout) => workout.id === workoutId) || null;
  }

  function renderWorkoutEditor() {
    const workout = workoutDraft || currentWorkout;
    if (!workout) return;
    $gymWorkoutName.value = workout.name || "";
    $gymWorkoutDate.value = workout.date || dateKeyLocal(new Date());
    $gymFinishWorkout.disabled = Boolean(workout.finishedAt);
    $gymDiscardWorkout.classList.toggle("hidden", Boolean(workout.finishedAt));
    renderWorkoutEmoji(workout);
    renderMetrics();
    const statsMap = buildExerciseStatsMap(workout.id);
    const entries = Object.entries(workout.exercises || {});
    if (!entries.length) {
      $gymWorkoutExercises.innerHTML = `
        <div class="gym-empty">Añade ejercicios para empezar tu sesión.</div>
      `;
      return;
    }
    $gymWorkoutExercises.innerHTML = entries
      .map(([exerciseId, exerciseData]) => {
        const stats = statsMap[exerciseId] || {};
        const lastDoneSet = stats.lastDoneSet || null;
        const exerciseType = getExerciseType(exerciseData, exerciseId);
        const useBodyweight = getExerciseUseBodyweight(exerciseData);
        const maxLabel = formatMaxLabel(stats.maxSet, useBodyweight);
        const prevLabel = exerciseType === "time"
          ? formatPreviousTimeLabel(lastDoneSet, useBodyweight)
          : maxLabel;
        const muscleGroups = getWorkoutExerciseMuscles(exerciseData);
        const muscleLabel = formatMuscleGroupsLabel(muscleGroups);
        const unilateral = getExerciseUnilateral(exerciseData, exerciseId);
        const rows = (exerciseData.sets || []).map((set, index) => {
          const prevText = prevLabel;
          const repsPlaceholder = lastDoneSet?.reps ?? "reps";
          const timePlaceholder = formatMmSs(lastDoneSet?.timeSec) || "mm:ss";
          const kgPlaceholder = getKgPlaceholder(lastDoneSet, useBodyweight);
          const kgValue = set.kg ?? set.extraKg ?? "";
          const timeValue = formatMmSs(set.timeSec);
          return `
            <div class="gym-sets-row" data-set-index="${index}">
              <span>${index + 1}</span>
              <span class="gym-set-previous">${prevText}</span>
              ${exerciseType === "time"
    ? `<input class="gym-input gym-time-input" data-field="timeText" type="text" inputmode="numeric" pattern="[0-9]*" placeholder="${timePlaceholder}" value="${timeValue}"/>`
    : `<input class="gym-input" data-field="reps" type="number" inputmode="numeric" placeholder="${repsPlaceholder}" value="${set.reps ?? ""}"/>`}
              <input class="gym-input kg" data-field="kg" type="text" inputmode="decimal" autocomplete="off" placeholder="${kgPlaceholder}" value="${kgValue}"/>
              <input class="gym-checkbox" data-field="done" type="checkbox" ${set.done ? "checked" : ""}/>
              <button type="button" class="icon-btn icon-btn-small" data-action="remove-set" aria-label="Eliminar serie">✕</button>
            </div>
          `;
        }).join("");
        return `
          <div class="gym-exercise-card" data-exercise-id="${exerciseId}">
          <div class="gym-exercise-head">
            <div>
              <div class="gym-exercise-title">${exerciseData.nameSnapshot}</div>
              <div class="gym-exercise-sub">${muscleLabel}</div>
              ${unilateral ? "<span class=\"gym-unilateral-pill\">Unilateral</span>" : ""}
            </div>
            <div class="gym-exercise-actions">
              <label class="gym-bw-toggle ${useBodyweight ? "is-active" : ""}">
                <input data-field="useBodyweight" type="checkbox" ${useBodyweight ? "checked" : ""}/>
                BW
              </label>
              <button class="icon-btn icon-btn-small" data-action="exercise-remove" type="button" aria-label="Quitar ejercicio">🗑️</button>
              <button class="icon-btn icon-btn-small gym-exercise-stats-btn" data-action="exercise-stats" type="button" aria-label="Ver estadísticas">📈</button>
            </div>
          </div>
            <div class="gym-sets-table">
              <div class="gym-sets-header">
                <span>Set</span>
<span>${exerciseType === "time" ? "Anterior" : "Max"}</span>
<span>${exerciseType === "time" ? "Tiempo" : "Reps"}</span>
<span>Kg</span>
<span>✔</span>
<span></span>
              </div>
              ${rows}
            </div>
            <button class="gym-btn gym-btn-ghost" data-action="add-set" type="button">Añadir serie</button>
          </div>
        `;
      })
      .join("");
  }

  function renderMetrics() {
    const workout = workoutDraft || currentWorkout;
    if (!workout) return;
    const { totalReps, totalVolumeKg } = computeWorkoutTotals(workout);
    $gymMetricExercises.textContent = Object.keys(workout.exercises || {}).length;
    $gymMetricVolume.textContent = `${Math.round(totalVolumeKg)} kg`;
    $gymMetricDuration.textContent = formatDuration(getCurrentDuration());
    workout.totalReps = totalReps;
    workout.totalVolumeKg = totalVolumeKg;
  }

  function getCurrentDuration() {
    if (!currentWorkout?.startedAt) return 0;
    if (currentWorkout.finishedAt) {
      return currentWorkout.durationSec || 0;
    }
    return Math.floor((Date.now() - currentWorkout.startedAt) / 1000);
  }

  function computeWorkoutTotals(workout) {
    let totalReps = 0;
    let totalVolumeKg = 0;
    Object.entries(workout.exercises || {}).forEach(([exerciseId, exercise]) => {
      const unilateral = getExerciseUnilateral(exercise, exerciseId);
      const exerciseType = getExerciseType(exercise, exerciseId);
      const useBodyweight = getExerciseUseBodyweight(exercise);
      (exercise.sets || []).forEach((set) => {
        if (!set.done) return;
        if (exerciseType === "time") {
          const timeSec = Number(set.timeSec) || 0;
          const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight) || 0;
          totalVolumeKg += timeSec * kgEff;
        } else {
          const reps = Number(set.reps) || 0;
          const repsEff = unilateral ? reps * 2 : reps;
          const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight) || 0;
          totalReps += repsEff;
          totalVolumeKg += repsEff * kgEff;
        }
      });
    });
    return { totalReps, totalVolumeKg };
  }

  function removeExerciseFromWorkout(exerciseId) {
    const workout = ensureWorkoutDraft();
    if (!workout?.exercises?.[exerciseId]) return;
    delete workout.exercises[exerciseId];
    scheduleWorkoutSave();
    renderWorkoutEditor();
    renderMetrics();
  }

  function addSetToExercise(exerciseId) {
    const workout = ensureWorkoutDraft();
    if (!workout?.exercises?.[exerciseId]) return;
    const exercise = workout.exercises[exerciseId];
    const exerciseType = getExerciseType(exercise, exerciseId);
    exercise.sets = exercise.sets || [];
    let nextSet = createEmptySet(exerciseType);
    if (exercise.sets.length) {
      const prevSet = exercise.sets[exercise.sets.length - 1];
      nextSet = exerciseType === "time"
        ? {
          timeSec: prevSet?.timeSec ?? null,
          kg: prevSet?.kg ?? null,
          extraKg: prevSet?.extraKg ?? null,
          rpe: null,
          done: false
        }
        : {
          reps: prevSet?.reps ?? null,
          kg: prevSet?.kg ?? null,
          extraKg: prevSet?.extraKg ?? null,
          rpe: null,
          done: false
        };
    }
    exercise.sets.push(nextSet);
    scheduleWorkoutSave();
    renderWorkoutEditor();
  }

  function removeSetFromExercise(exerciseId, setIndex) {
    const workout = ensureWorkoutDraft();
    const exercise = workout?.exercises?.[exerciseId];
    if (!exercise?.sets?.length) return;
    if (!Number.isFinite(setIndex) || setIndex < 0) return;
    exercise.sets.splice(setIndex, 1);
    scheduleWorkoutSave();
    renderWorkoutEditor();
    renderMetrics();
  }

  function openExerciseForWorkout(exerciseId) {
    const workout = ensureWorkoutDraft();
    if (!workout) return;
    if (!workout.exercises) workout.exercises = {};
    if (workout.exercises[exerciseId]) return;
    const exercise = exercises[exerciseId];
    if (!exercise) return;
    const exerciseType = exercise.type || "reps";
    workout.exercises[exerciseId] = {
      nameSnapshot: exercise.name,
      muscleGroupsSnapshot: getExerciseMuscleGroups(exercise),
      unilateralSnapshot: Boolean(exercise.unilateral),
      typeSnapshot: exerciseType,
      useBodyweight: false,
      sets: buildSetsFromHistory(exerciseId, workout?.id, exerciseType)
    };
    scheduleWorkoutSave();
    renderWorkoutEditor();
  }

  function renderExerciseList() {
    const query = ($gymExerciseSearch.value || "").toLowerCase();
    const recentIds = new Set();
    flattenWorkouts().slice(0, 6).forEach((workout) => {
      Object.keys(workout.exercises || {}).forEach((id) => recentIds.add(id));
    });
    const list = Object.values(exercises || {})
      .filter((exercise) => {
        const matchesQuery = exercise.name.toLowerCase().includes(query);
        const muscleGroups = getExerciseMuscleGroups(exercise);
        let matchesMuscle = true;
        if (selectedMuscle === "Recent") {
          matchesMuscle = recentIds.has(exercise.id);
        } else if (selectedMuscle !== "All") {
          matchesMuscle = muscleGroups.includes(selectedMuscle);
        }
        return matchesQuery && matchesMuscle;
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    $gymExerciseList.innerHTML = "";
    const fragment = document.createDocumentFragment();
    list.forEach((exercise) => {
      const muscleGroups = getExerciseMuscleGroups(exercise);
      const row = document.createElement("div");
      row.className = "gym-exercise-row";
      row.innerHTML = `
        <div class="gym-exercise-row-info">
          <div class="gym-exercise-row-title">${exercise.name}</div>
          <div class="gym-exercise-row-sub">${formatMuscleGroupsLabel(muscleGroups)}</div>
        </div>
        <button class="gym-btn gym-btn-primary" type="button">+</button>
      `;
      const btn = row.querySelector("button");
      btn.addEventListener("click", () => {
        openExerciseForWorkout(exercise.id);
        closeExerciseModal();
      });
      fragment.appendChild(row);
    });
    $gymExerciseList.appendChild(fragment);
    const hasResults = list.length > 0;
    const hasQuery = Boolean(query.trim());
    $gymExerciseEmpty.classList.toggle("hidden", !hasQuery || hasResults);
    if (hasQuery) {
      const rawQuery = ($gymExerciseSearch.value || "").trim();
      $gymCreateCtaText.textContent = rawQuery;
      $gymCreateCta.disabled = rawQuery.length === 0;
    }
  }

  function renderMuscleChips() {
    $gymMuscleChips.innerHTML = "";
    MUSCLE_GROUPS.forEach((group) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "gym-chip";
      chip.textContent = translateMuscle(group);
      chip.dataset.value = group;
      chip.addEventListener("click", () => {
        selectedMuscle = group;
        updateActiveChips($gymMuscleChips, group);
        renderExerciseList();
      });
      $gymMuscleChips.appendChild(chip);
    });
    updateActiveChips($gymMuscleChips, selectedMuscle);
  }

  function renderCreateMuscleChips() {
    $gymCreateMuscleChips.innerHTML = "";
    MUSCLE_GROUPS.filter((group) => group !== "All" && group !== "Recent").forEach((group) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "gym-chip";
      chip.textContent = translateMuscle(group);
      chip.dataset.value = group;
      chip.addEventListener("click", () => {
        if (createMuscles.has(group)) {
          createMuscles.delete(group);
        } else {
          createMuscles.add(group);
        }
        updateActiveChipsMulti($gymCreateMuscleChips, createMuscles);
      });
      $gymCreateMuscleChips.appendChild(chip);
    });
    updateActiveChipsMulti($gymCreateMuscleChips, createMuscles);
  }

  function updateActiveChips(container, value) {
    Array.from(container.children).forEach((chip) => {
      chip.classList.toggle("is-active", chip.dataset.value === value);
    });
  }

  function updateActiveChipsMulti(container, selected) {
    Array.from(container.children).forEach((chip) => {
      chip.classList.toggle("is-active", selected.has(chip.dataset.value));
    });
  }

  function migrateWorkoutExerciseData(workout) {
    if (!workout?.exercises) return;
    Object.values(workout.exercises).forEach((exercise) => {
      let useBodyweight = Boolean(exercise.useBodyweight);
      if (!exercise.typeSnapshot) {
        exercise.typeSnapshot = "reps";
      }
      (exercise.sets || []).forEach((set) => {
        if (set?.useBodyweight || set?.bodyweight) {
          useBodyweight = true;
        }
        if (useBodyweight && set?.kg == null && set?.extraKg != null) {
          set.kg = set.extraKg;
        }
        if (set?.timeSec != null) {
          const normalized = Number.isFinite(set.timeSec) ? set.timeSec : parseTimeInput(set.timeSec);
          set.timeSec = Number.isFinite(normalized) ? normalized : null;
        }
      });
      exercise.useBodyweight = useBodyweight;
    });
  }

  function stripSetBodyweightFlags(workout) {
    if (!workout?.exercises) return;
    Object.values(workout.exercises).forEach((exercise) => {
      (exercise.sets || []).forEach((set) => {
        if (!set) return;
        delete set.useBodyweight;
        delete set.bodyweight;
      });
    });
  }

  function translateMuscle(group) {
    const map = {
      All: "Todo",
      Recent: "Recientes",
      Shoulders: "Hombros",
      Back: "Espalda",
      Chest: "Pecho",
      Biceps: "Bíceps",
      Triceps: "Tríceps",
      Forearms: "Antebrazos",
      Core: "Core",
      Quads: "Cuádriceps",
      Hamstrings: "Isquios",
      Glutes: "Glúteos",
      Calves: "Gemelos",
      Cardio: "Cardio",
      Other: "Otros"
    };
    return map[group] || group;
  }

  function scheduleWorkoutSave() {
    if (!workoutDraft && !currentWorkout) return;
    if (saveTimer) window.clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => {
      saveWorkout();
    }, 750);
  }

  function scheduleBodyweightSave() {
    if (bodyweightSaveTimer) window.clearTimeout(bodyweightSaveTimer);
    bodyweightSaveTimer = window.setTimeout(() => {
      saveBodyweightEntry();
    }, 600);
  }

  function flushBodyweightSave() {
    if (bodyweightSaveTimer) {
      window.clearTimeout(bodyweightSaveTimer);
      bodyweightSaveTimer = null;
    }
    saveBodyweightEntry();
  }

  function saveBodyweightEntry() {
    if (!$gymBodyDate) return;
    const dateKey = $gymBodyDate.value || dateKeyLocal(new Date());
    const weightKg = parseDecimalInput($gymBodyWeight.value);
    const heightCm = parseDecimalInput($gymBodyHeight.value);
    const path = `${basePath}/body/${dateKey}`;
    if (weightKg === null && heightCm === null) {
      delete bodyweightByDate[dateKey];
      writeGymRemove(path);
      persistGymCache();
      return;
    }
    const payload = {
      weightKg: weightKg ?? null,
      heightCm: heightCm ?? null,
      updatedAt: Date.now()
    };
    bodyweightByDate[dateKey] = payload;
    writeGymSet(path, payload);
    persistGymCache();
  }

  function saveWorkout() {
    const workout = workoutDraft || currentWorkout;
    if (!workout) return;
    migrateWorkoutExerciseData(workout);
    stripSetBodyweightFlags(workout);
    const path = `${basePath}/workouts/${workout.date}/${workout.id}`;
    const { totalReps, totalVolumeKg } = computeWorkoutTotals(workout);
    workout.totalReps = totalReps;
    workout.totalVolumeKg = totalVolumeKg;
    upsertWorkoutLocal(workout);
    writeGymUpdate(path, workout);
    persistGymCache();
  }

  function flushWorkoutSave() {
    if (saveTimer) {
      window.clearTimeout(saveTimer);
      saveTimer = null;
    }
    saveWorkout();
  }

  function finishWorkout() {
    const workout = workoutDraft || currentWorkout;
    if (!workout || workout.finishedAt) return;
    const finishedAt = Date.now();
    workout.finishedAt = finishedAt;
    workout.durationSec = Math.floor((finishedAt - workout.startedAt) / 1000);
    const { totalReps, totalVolumeKg } = computeWorkoutTotals(workout);
    workout.totalReps = totalReps;
    workout.totalVolumeKg = totalVolumeKg;
    saveWorkout();
    upsertTemplateFromWorkout(workout);
    currentWorkout = null;
    workoutDraft = null;
    showScreen("home");
  }

  function upsertTemplateFromWorkout(workout, options = {}) {
    const name = (workout.name || "").trim();
    if (!name) return;
    const id = slugify(name);
    const exerciseIds = Object.keys(workout.exercises || {});
    const emoji = options.emoji ?? workout.emojiSnapshot ?? templates?.[id]?.emoji ?? null;
    const payload = {
      id,
      name,
      emoji,
      exerciseIds,
      updatedAt: Date.now()
    };
    upsertTemplateLocal(payload);
    writeGymSet(`${basePath}/templates/${id}`, payload);
    persistGymCache();
  }

  function discardWorkout() {
    const workout = workoutDraft || currentWorkout;
    if (!workout || workout.finishedAt) return;
    const path = `${basePath}/workouts/${workout.date}/${workout.id}`;
    removeWorkoutLocal(workout.date, workout.id);
    writeGymRemove(path);
    persistGymCache();
    currentWorkout = null;
    workoutDraft = null;
    showScreen("home");
  }

  function moveWorkoutDate(newDate) {
    const workout = ensureWorkoutDraft();
    if (!workout) return;
    const oldPath = `${basePath}/workouts/${workout.date}/${workout.id}`;
    removeWorkoutLocal(workout.date, workout.id);
    workout.date = newDate;
    upsertWorkoutLocal(workout);
    const newPath = `${basePath}/workouts/${newDate}/${workout.id}`;
    writeGymSet(newPath, workout);
    writeGymRemove(oldPath);
    persistGymCache();
  }

  function syncCurrentWorkout() {
    if (!currentWorkout) return;
    const fresh = findWorkoutById(currentWorkout.id);
    if (!fresh) {
      currentWorkout = null;
      workoutDraft = null;
      showScreen("home");
      return;
    }
    if (!workoutDraft) {
      currentWorkout = fresh;
    }
  }

  function startDurationTicker() {
    stopDurationTicker();
    durationTimer = window.setInterval(() => {
      if (currentWorkout && !currentWorkout.finishedAt) {
        $gymMetricDuration.textContent = formatDuration(getCurrentDuration());
      }
    }, 400);
  }

  function stopDurationTicker() {
    if (durationTimer) {
      window.clearInterval(durationTimer);
      durationTimer = null;
    }
  }

  function cloneWorkout(workout) {
    if (!workout) return null;
    return structuredClone(workout);
  }

  function ensureWorkoutDraft() {
    if (workoutDraft) return workoutDraft;
    if (!currentWorkout) return null;
    workoutDraft = cloneWorkout(currentWorkout);
    migrateWorkoutExerciseData(workoutDraft);
    return workoutDraft;
  }

  function parseDecimalInput(value) {
    const norm = value.replace(",", ".").replace(/[^\d.]/g, "");
    return norm ? Number.parseFloat(norm) : null;
  }

  function parseSetInput(field, value) {
    if (value === "") return null;
    if (field === "kg") {
      return parseDecimalInput(value);
    }
    if (field === "extraKg") {
      return parseDecimalInput(value);
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
  }

  function parseMmSsFromDigits(value) {
    const digits = String(value || "").replace(/\D/g, "");
    if (!digits) {
      return { sec: null, text: "" };
    }
    const rawSeconds = Number(digits.slice(-2));
    const mins = digits.length > 2 ? Number(digits.slice(0, -2)) : 0;
    const secs = Math.min(59, Number.isFinite(rawSeconds) ? rawSeconds : 0);
    const sec = mins * 60 + secs;
    const text = `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
    return { sec, text };
  }

  function parseTimeInput(value) {
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (trimmed.includes(":")) {
      const parts = trimmed.split(":");
      if (parts.length > 2) return null;
      const [minsPart, secsPart] = parts;
      const mins = Number(minsPart);
      const secs = Number(secsPart ?? 0);
      if (!Number.isFinite(mins) || !Number.isFinite(secs)) return null;
      return mins * 60 + Math.min(59, secs);
    }
    if (/^\d+$/.test(trimmed)) {
      return parseMmSsFromDigits(trimmed).sec;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : null;
  }

  function formatMmSs(seconds) {
    if (!Number.isFinite(seconds)) return "";
    const total = Math.max(0, Math.floor(seconds));
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }

  function formatKgValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, "");
  }

  function getSetEffectiveKg(set, dateKey, useBodyweight = false) {
    if (!set) return null;
    const extraKg = Number(set.extraKg) || 0;
    const kgValue = Number(set.kg);
    if (useBodyweight) {
      const baseKg = getBodyweightForDate(dateKey) ?? 0;
      const loadKg = Number.isFinite(kgValue) ? kgValue : 0;
      return baseKg + loadKg + extraKg;
    }
    if (!Number.isFinite(kgValue)) return null;
    return kgValue + extraKg;
  }

  function formatSetKgLabel(set, useBodyweight) {
    if (!set) return "—";
    if (useBodyweight) {
      const extra = Number(set.kg ?? set.extraKg) || 0;
      const suffix = extra ? `+${formatKgValue(extra)}` : "";
      return `BW${suffix} kg`;
    }
    const v = formatKgValue(set.kg ?? set.extraKg);
    if (v === "—") return "—";
    return `${v} kg`;
  }

  function formatMaxLabel(maxSet, useBodyweight) {
    if (!maxSet) return "—";
    return formatSetKgLabel(maxSet, useBodyweight);
  }

  function formatPreviousTimeLabel(lastSet, useBodyweight) {
    if (!lastSet) return "—";
    const timeLabel = formatMmSs(lastSet.timeSec);
    if (!timeLabel) return "—";
    const kgLabel = formatSetKgLabel(lastSet, useBodyweight);
    return `${timeLabel} · ${kgLabel}`;
  }

  function getKgPlaceholder(lastSet, useBodyweight) {
    if (useBodyweight) {
      const extra = Number(lastSet?.kg ?? lastSet?.extraKg) || 0;
      return extra ? `BW(+${formatKgValue(extra)})` : "BW(+kg)";
    }
    const fallback = lastSet?.kg ?? lastSet?.extraKg ?? null;
    return fallback != null ? formatKgValue(fallback) : "kg";
  }

  function getExerciseType(exerciseData, exerciseId) {
    return exerciseData?.typeSnapshot ?? exercises?.[exerciseId]?.type ?? "reps";
  }

  function getExerciseUseBodyweight(exerciseData) {
    if (!exerciseData) return false;
    if (exerciseData.useBodyweight !== undefined) {
      return Boolean(exerciseData.useBodyweight);
    }
    return (exerciseData.sets || []).some((set) => set?.useBodyweight || set?.bodyweight);
  }

  function getExerciseUnilateral(exerciseData, exerciseId) {
    return Boolean(exerciseData?.unilateralSnapshot ?? exercises?.[exerciseId]?.unilateral);
  }

  function normalizeMuscleGroups(groups) {
    const cleaned = (groups || []).filter(Boolean);
    return cleaned.length ? cleaned : ["Other"];
  }

  function getExerciseMuscleGroups(exercise) {
    if (!exercise) return [];
    const groups = exercise.muscleGroups ?? (exercise.muscleGroup ? [exercise.muscleGroup] : []);
    return normalizeMuscleGroups(Array.isArray(groups) ? groups : []);
  }

  function getWorkoutExerciseMuscles(exerciseData) {
    if (!exerciseData) return [];
    const groups = exerciseData.muscleGroupsSnapshot
      ?? (exerciseData.muscleGroupSnapshot ? [exerciseData.muscleGroupSnapshot] : []);
    return normalizeMuscleGroups(Array.isArray(groups) ? groups : []);
  }

  function formatMuscleGroupsLabel(groups) {
    const list = (groups || []).map((group) => translateMuscle(group));
    return list.length ? list.join(" · ") : translateMuscle("Other");
  }

  function promptForEmoji(current) {
    const value = window.prompt("Elige un emoji para esta sesión:", current || "");
    if (value === null) return current ?? null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return Array.from(trimmed)[0] || null;
  }

  function renderWorkoutEmoji(workout) {
    if (!$gymWorkoutEmoji) return;
    $gymWorkoutEmoji.textContent = workout?.emojiSnapshot || "🙂";
  }

  function buildWorkoutEmojiMap() {
    const map = {};
    Object.entries(workoutsByDate || {}).forEach(([date, dayWorkouts]) => {
      const values = Object.values(dayWorkouts || {});
      if (!values.length) return;
      const emojiSet = new Set();
      let countWithEmoji = 0;
      values.forEach((workout) => {
        if (workout?.emojiSnapshot) {
          emojiSet.add(workout.emojiSnapshot);
          countWithEmoji += 1;
        }
      });
      map[date] = { count: values.length, emojiSet, countWithEmoji };
    });
    return map;
  }

  function getCalendarCellLabel(dayNumber, entry) {
    if (!entry || entry.count === 0) return String(dayNumber);
    if (entry.count === 1) {
      if (entry.countWithEmoji === 1 && entry.emojiSet.size === 1) {
        return Array.from(entry.emojiSet)[0];
      }
      return String(dayNumber);
    }
    if (entry.countWithEmoji === entry.count && entry.emojiSet.size === 1) {
      return Array.from(entry.emojiSet)[0];
    }
    return "🔥";
  }
}
