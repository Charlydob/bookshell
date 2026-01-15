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
  const $gymStartWorkout = document.getElementById("gym-start-workout");
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

  init();

  function init() {
    renderMuscleChips();
    renderCreateMuscleChips();
    bindEvents();
    subscribeData();
    initBodyweightForm();
  }

  function bindEvents() {
    $gymStartWorkout.addEventListener("click", () => {
      openTemplateModal();
    });

    $gymBack.addEventListener("click", () => {
      showScreen("home");
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
      const newRef = push(exercisesRef);
      const exercise = {
        id: newRef.key,
        name,
        muscleGroups,
        unilateral: Boolean($gymCreateUnilateral?.checked),
        createdAt: now,
        updatedAt: now
      };
      set(newRef, exercise);
      $gymCreateName.value = "";
      $gymCreateUnilateral.checked = false;
      closeCreateExerciseModal();
      renderExerciseList();
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
      if (!card || !row) return;
      const exerciseId = card.dataset.exerciseId;
      const setIndex = Number(row.dataset.setIndex);
      if (!exerciseId || Number.isNaN(setIndex)) return;
      const field = target.dataset.field;
      if (!field) return;
      const workout = ensureWorkoutDraft();
      const exercise = workout?.exercises?.[exerciseId];
      if (!exercise || !exercise.sets || !exercise.sets[setIndex]) return;
      if (field === "done") {
        exercise.sets[setIndex].done = target.checked;
      } else if (field === "useBodyweight") {
        exercise.sets[setIndex].useBodyweight = target.checked;
        if (!target.checked) {
          exercise.sets[setIndex].extraKg = null;
        }
        renderWorkoutEditor();
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
      const btn = event.target.closest("[data-action='add-set']");
      if (!btn) return;
      const card = btn.closest(".gym-exercise-card");
      if (!card) return;
      const exerciseId = card.dataset.exerciseId;
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
    });

    onValue(templatesRef, (snap) => {
      templates = snap.val() || {};
      renderTemplates();
    });

    onValue(workoutsRef, (snap) => {
      workoutsByDate = snap.val() || {};
      syncCurrentWorkout();
      renderHistory();
      renderCalendar();
      if (!workoutDraft) {
        renderWorkoutEditor();
      }
    });

    onValue(bodyweightRef, (snap) => {
      bodyweightByDate = snap.val() || {};
      renderBodyweightForm();
      renderWorkoutEditor();
    });

    onValue(cardioRef, (snap) => {
      cardioByDate = snap.val() || {};
      renderCardioList();
      if (cardioDraft && !cardioRunning) {
        syncCardioDraft();
      }
    });
  }

  function getDeviceId() {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored) return stored;
    const id = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
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
          stats[exerciseId] = { maxSet: null, maxKgEff: null, lastSet: null };
        }
        if (!stats[exerciseId].lastSet && data?.sets?.length) {
          stats[exerciseId].lastSet = data.sets[data.sets.length - 1];
        }
        (data?.sets || []).forEach((set) => {
          const kgEff = getSetEffectiveKg(set, workout.date);
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

  function buildSetsFromHistory(exerciseId, excludeId) {
    const lastSets = getLastExerciseSets(exerciseId, excludeId);
    if (!lastSets || !lastSets.length) {
      return [{ reps: null, kg: null, extraKg: null, useBodyweight: false, rpe: null, done: false }];
    }
    return lastSets.map((set) => ({
      reps: null,
      kg: null,
      extraKg: null,
      useBodyweight: Boolean(set.useBodyweight),
      rpe: null,
      done: false
    }));
  }

  function showScreen(name) {
    $gymHome.classList.toggle("gym-screen-active", name === "home");
    $gymWorkout.classList.toggle("gym-screen-active", name === "workout");
    if (name === "workout") {
      startDurationTicker();
    } else {
      stopDurationTicker();
    }
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
    $gymCreateModal.classList.remove("hidden");
    $gymCreateName.value = prefillName;
    $gymCreateName.focus();
  }

  function closeCreateExerciseModal() {
    $gymCreateModal.classList.add("hidden");
    $gymCreateName.value = "";
    $gymCreateUnilateral.checked = false;
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
      const sets = buildSetsFromHistory(exerciseId);
      exercisesData[exerciseId] = {
        nameSnapshot: exercise.name,
        muscleGroupsSnapshot: muscleGroups,
        unilateralSnapshot: Boolean(exercise.unilateral),
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
    set(ref(db, `${basePath}/workouts/${date}/${workoutId}`), workout);
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
    set(ref(db, `${basePath}/cardio/${date}/${id}`), payload);
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
    update(ref(db, path), cardioDraft);
  }

  function moveCardioDate(newDate) {
    if (!cardioDraft) return;
    const oldPath = `${basePath}/cardio/${cardioDraft.date}/${cardioDraft.id}`;
    cardioDraft.date = newDate;
    const newPath = `${basePath}/cardio/${newDate}/${cardioDraft.id}`;
    set(ref(db, newPath), cardioDraft);
    remove(ref(db, oldPath));
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
        const lastSet = stats.lastSet || null;
        const maxLabel = formatMaxLabel(stats.maxSet);
        const muscleGroups = getWorkoutExerciseMuscles(exerciseData);
        const muscleLabel = formatMuscleGroupsLabel(muscleGroups);
        const unilateral = getExerciseUnilateral(exerciseData, exerciseId);
        const rows = (exerciseData.sets || []).map((set, index) => {
          const isBw = Boolean(set.useBodyweight);
          const prevText = maxLabel;
          const repsPlaceholder = lastSet?.reps ?? "reps";
          const kgPlaceholder = getKgPlaceholder(lastSet, isBw);
          const kgValue = isBw ? (set.extraKg ?? "") : (set.kg ?? "");
          const kgField = isBw ? "extraKg" : "kg";
          return `
            <div class="gym-sets-row" data-set-index="${index}">
              <span>${index + 1}</span>
              <span class="gym-set-previous">${prevText}</span>
              <input class="gym-input" data-field="reps" type="number" inputmode="numeric" placeholder="${repsPlaceholder}" value="${set.reps ?? ""}"/>
              <div class="gym-kg-cell">
                <label class="gym-bw-toggle ${isBw ? "is-active" : ""}">
                  <input data-field="useBodyweight" type="checkbox" ${isBw ? "checked" : ""}/>
                  BW
                </label>
                <input class="gym-input kg" data-field="${kgField}" type="text" inputmode="decimal" autocomplete="off" placeholder="${kgPlaceholder}" value="${kgValue}"/>
              </div>
              <input class="gym-input" data-field="rpe" type="text" inputmode="decimal" placeholder="RPE" value="${set.rpe ?? ""}"/>
              <input class="gym-checkbox" data-field="done" type="checkbox" ${set.done ? "checked" : ""}/>
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
          </div>
            <div class="gym-sets-table">
              <div class="gym-sets-header">
                <span>Set</span>
                <span>Previo</span>
                <span>Reps</span>
                <span>Kg</span>
                <span>RPE</span>
                <span>✔</span>
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
      (exercise.sets || []).forEach((set) => {
        if (!set.done) return;
        const reps = Number(set.reps) || 0;
        const repsEff = unilateral ? reps * 2 : reps;
        const kgEff = getSetEffectiveKg(set, workout.date) || 0;
        totalReps += repsEff;
        totalVolumeKg += repsEff * kgEff;
      });
    });
    return { totalReps, totalVolumeKg };
  }

  function addSetToExercise(exerciseId) {
    const workout = ensureWorkoutDraft();
    if (!workout?.exercises?.[exerciseId]) return;
    workout.exercises[exerciseId].sets = workout.exercises[exerciseId].sets || [];
    workout.exercises[exerciseId].sets.push({
      reps: null,
      kg: null,
      extraKg: null,
      useBodyweight: false,
      rpe: null,
      done: false
    });
    scheduleWorkoutSave();
    renderWorkoutEditor();
  }

  function openExerciseForWorkout(exerciseId) {
    const workout = ensureWorkoutDraft();
    if (!workout) return;
    if (!workout.exercises) workout.exercises = {};
    if (workout.exercises[exerciseId]) return;
    const exercise = exercises[exerciseId];
    if (!exercise) return;
    workout.exercises[exerciseId] = {
      nameSnapshot: exercise.name,
      muscleGroupsSnapshot: getExerciseMuscleGroups(exercise),
      unilateralSnapshot: Boolean(exercise.unilateral),
      sets: buildSetsFromHistory(exerciseId, workout?.id)
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
      remove(ref(db, path));
      return;
    }
    const payload = {
      weightKg: weightKg ?? null,
      heightCm: heightCm ?? null,
      updatedAt: Date.now()
    };
    set(ref(db, path), payload);
  }

  function saveWorkout() {
    const workout = workoutDraft || currentWorkout;
    if (!workout) return;
    const path = `${basePath}/workouts/${workout.date}/${workout.id}`;
    const { totalReps, totalVolumeKg } = computeWorkoutTotals(workout);
    workout.totalReps = totalReps;
    workout.totalVolumeKg = totalVolumeKg;
    update(ref(db, path), workout);
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
    set(ref(db, `${basePath}/templates/${id}`), payload);
  }

  function discardWorkout() {
    const workout = workoutDraft || currentWorkout;
    if (!workout || workout.finishedAt) return;
    const path = `${basePath}/workouts/${workout.date}/${workout.id}`;
    remove(ref(db, path));
    currentWorkout = null;
    workoutDraft = null;
    showScreen("home");
  }

  function moveWorkoutDate(newDate) {
    const workout = ensureWorkoutDraft();
    if (!workout) return;
    const oldPath = `${basePath}/workouts/${workout.date}/${workout.id}`;
    workout.date = newDate;
    const newPath = `${basePath}/workouts/${newDate}/${workout.id}`;
    set(ref(db, newPath), workout);
    remove(ref(db, oldPath));
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
    if (field === "rpe") {
      return parseDecimalInput(value);
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
  }

  function formatKgValue(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "—";
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(1).replace(/\.0$/, "");
  }

  function getSetEffectiveKg(set, dateKey) {
    if (!set) return null;
    if (set.useBodyweight) {
      const baseKg = getBodyweightForDate(dateKey) ?? 0;
      const extraKg = Number(set.extraKg) || 0;
      return baseKg + extraKg;
    }
    const kg = Number(set.kg);
    return Number.isFinite(kg) ? kg : null;
  }

  function formatMaxLabel(maxSet) {
    if (!maxSet) return "Max: —";
    if (maxSet.useBodyweight) {
      const extra = Number(maxSet.extraKg) || 0;
      const suffix = extra ? `+${formatKgValue(extra)}` : "";
      return `Max: BW${suffix}`;
    }
    return `Max: ${formatKgValue(maxSet.kg)}`;
  }

  function getKgPlaceholder(lastSet, isBw) {
    if (isBw) {
      if (lastSet?.useBodyweight) {
        const extra = Number(lastSet.extraKg) || 0;
        return extra ? `BW(+${formatKgValue(extra)})` : "BW";
      }
      return "BW(+kg)";
    }
    if (lastSet?.useBodyweight) {
      const extra = Number(lastSet.extraKg) || 0;
      return extra ? `BW(+${formatKgValue(extra)})` : "BW";
    }
    return lastSet?.kg != null ? formatKgValue(lastSet.kg) : "kg";
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
