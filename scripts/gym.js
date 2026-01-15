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
  const $gymMetricDuration = document.getElementById("gym-metric-duration");
  const $gymMetricVolume = document.getElementById("gym-metric-volume");
  const $gymMetricExercises = document.getElementById("gym-metric-exercises");
  const $gymWorkoutExercises = document.getElementById("gym-workout-exercises");

  const $gymExerciseModal = document.getElementById("gym-exercise-modal");
  const $gymExerciseClose = document.getElementById("gym-exercise-close");
  const $gymExerciseSearch = document.getElementById("gym-exercise-search");
  const $gymMuscleChips = document.getElementById("gym-muscle-chips");
  const $gymExerciseList = document.getElementById("gym-exercise-list");
  const $gymExerciseEmpty = document.getElementById("gym-exercise-empty");
  const $gymCreateCta = document.getElementById("gym-create-cta");
  const $gymCreateCtaText = document.getElementById("gym-create-cta-text");
  const $gymCreateToggle = document.getElementById("gym-create-toggle");
  const $gymCreatePanel = document.getElementById("gym-create-panel");
  const $gymCreateName = document.getElementById("gym-create-name");
  const $gymCreateMuscleChips = document.getElementById("gym-create-muscle-chips");
  const $gymCreateExercise = document.getElementById("gym-create-exercise");

  const $gymTemplateModal = document.getElementById("gym-template-modal");
  const $gymTemplateClose = document.getElementById("gym-template-close");
  const $gymTemplateName = document.getElementById("gym-template-name");
  const $gymCreateEmpty = document.getElementById("gym-create-empty");
  const $gymTemplateList = document.getElementById("gym-template-list");
  const $gymTemplateEmpty = document.getElementById("gym-template-empty");

  const deviceId = getDeviceId();
  const basePath = `gym/${deviceId}`;
  const exercisesRef = ref(db, `${basePath}/exercises`);
  const templatesRef = ref(db, `${basePath}/templates`);
  const workoutsRef = ref(db, `${basePath}/workouts`);

  let exercises = {};
  let templates = {};
  let workoutsByDate = {};
  let currentWorkout = null;
  let workoutDraft = null;
  let currentMonth = new Date();
  let saveTimer = null;
  let durationTimer = null;
  let selectedMuscle = "All";
  let createMuscles = new Set(["Chest"]);

  init();

  function init() {
    renderMuscleChips();
    renderCreateMuscleChips();
    bindEvents();
    subscribeData();
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
        createdAt: now,
        updatedAt: now
      };
      set(newRef, exercise);
      $gymCreateName.value = "";
      $gymCreatePanel.classList.add("hidden");
      renderExerciseList();
    });

    $gymExerciseSearch.addEventListener("input", () => {
      renderExerciseList();
    });

    $gymCreateToggle.addEventListener("click", () => {
      $gymCreatePanel.classList.toggle("hidden");
      if (!$gymCreatePanel.classList.contains("hidden")) {
        $gymCreateName.focus();
      }
    });

    $gymCreateCta.addEventListener("click", () => {
      const query = ($gymExerciseSearch.value || "").trim();
      if (query) {
        $gymCreateName.value = query;
      }
      $gymCreatePanel.classList.remove("hidden");
      $gymCreateName.focus();
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

  function flattenWorkouts() {
    const list = [];
    Object.entries(workoutsByDate).forEach(([date, dayWorkouts]) => {
      Object.values(dayWorkouts || {}).forEach((workout) => {
        list.push({ ...workout, date });
      });
    });
    return list.sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0));
  }

  function buildExerciseHistoryMap(excludeId) {
    const history = {};
    flattenWorkouts().forEach((workout) => {
      if (workout.id === excludeId) return;
      if (!workout.exercises) return;
      Object.entries(workout.exercises).forEach(([exerciseId, data]) => {
        if (history[exerciseId]) return;
        if (data?.sets?.length) {
          history[exerciseId] = data.sets;
        }
      });
    });
    return history;
  }

  function getLastWorkoutByName(name) {
    if (!name) return null;
    const normalized = name.toLowerCase();
    return flattenWorkouts().find((workout) => workout.name?.toLowerCase() === normalized) || null;
  }

  function buildSetsFromHistory(exerciseId, excludeId) {
    const history = buildExerciseHistoryMap(excludeId);
    const previous = history[exerciseId] || [];
    if (!previous.length) {
      return [{ reps: null, kg: null, rpe: null, done: false }];
    }
    return previous.map((set) => ({
      reps: set.reps ?? null,
      kg: set.kg ?? null,
      rpe: set.rpe ?? null,
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
    $gymCreatePanel.classList.add("hidden");
    renderExerciseList();
  }

  function closeExerciseModal() {
    $gymExerciseModal.classList.add("hidden");
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
        $gymTemplateList.appendChild(row);
      });
  }

  function startWorkout({ name, templateId }) {
    const date = dateKeyLocal(new Date());
    const workoutId = push(ref(db, `${basePath}/workouts/${date}`)).key;
    const now = Date.now();
    const exercisesData = {};
    const lastWorkout = getLastWorkoutByName(name);
    const template = templateId ? templates[templateId] : null;
    const exerciseIds = template?.exerciseIds || [];
    exerciseIds.forEach((exerciseId) => {
      const exercise = exercises[exerciseId];
      if (!exercise) return;
      const muscleGroups = getExerciseMuscleGroups(exercise);
      const sets = lastWorkout?.exercises?.[exerciseId]?.sets
        ? lastWorkout.exercises[exerciseId].sets.map((set) => ({
          reps: set.reps ?? null,
          kg: set.kg ?? null,
          rpe: set.rpe ?? null,
          done: false
        }))
        : buildSetsFromHistory(exerciseId);
      exercisesData[exerciseId] = {
        nameSnapshot: exercise.name,
        muscleGroupsSnapshot: muscleGroups,
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
      $gymHistoryList.appendChild(card);
    });
  }

  function renderCalendar() {
    const year = currentMonth.getFullYear();
    const month = currentMonth.getMonth();
    $gymCalLabel.textContent = formatMonthLabel(currentMonth);
    const firstDay = new Date(year, month, 1);
    const startDay = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const workoutDays = new Set(Object.keys(workoutsByDate || {}));
    const todayKey = dateKeyLocal(new Date());
    const labels = ["L", "M", "X", "J", "V", "S", "D"];
    const cells = [];
    labels.forEach((label) => {
      cells.push(`<div class="gym-calendar-day is-header">${label}</div>`);
    });
    for (let i = 0; i < startDay; i += 1) {
      cells.push("<div class='gym-calendar-day'></div>");
    }
    for (let day = 1; day <= daysInMonth; day += 1) {
      const dateKey = dateKeyLocal(new Date(year, month, day));
      const hasWorkout = workoutDays.has(dateKey);
      const classes = ["gym-calendar-day"];
      if (hasWorkout) classes.push("has-workout");
      if (dateKey === todayKey) classes.push("is-today");
      cells.push(`<div class="${classes.join(" ")}">${day}</div>`);
    }
    $gymCalGrid.innerHTML = cells.join("");
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
    renderMetrics();
    const previousSetsMap = buildExerciseHistoryMap(workout.id);
    const entries = Object.entries(workout.exercises || {});
    if (!entries.length) {
      $gymWorkoutExercises.innerHTML = `
        <div class="gym-empty">Añade ejercicios para empezar tu sesión.</div>
      `;
      return;
    }
    $gymWorkoutExercises.innerHTML = entries
      .map(([exerciseId, exerciseData]) => {
        const previousSets = previousSetsMap[exerciseId] || [];
        const muscleGroups = getWorkoutExerciseMuscles(exerciseData);
        const muscleLabel = formatMuscleGroupsLabel(muscleGroups);
        const rows = (exerciseData.sets || []).map((set, index) => {
          const prev = previousSets[index];
          const prevText = prev ? `${prev.reps ?? "?"} x ${prev.kg ?? "?"}kg` : "—";
          return `
            <div class="gym-sets-row" data-set-index="${index}">
              <span>${index + 1}</span>
              <span class="gym-set-previous">${prevText}</span>
              <input class="gym-input" data-field="reps" type="number" inputmode="numeric" placeholder="reps" value="${set.reps ?? ""}"/>
              <input class="gym-input kg" data-field="kg" type="text" inputmode="decimal" autocomplete="off" placeholder="kg" value="${set.kg ?? ""}"/>
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
    Object.values(workout.exercises || {}).forEach((exercise) => {
      (exercise.sets || []).forEach((set) => {
        if (!set.done) return;
        const reps = Number(set.reps) || 0;
        const kg = Number(set.kg) || 0;
        totalReps += reps;
        totalVolumeKg += reps * kg;
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
      $gymExerciseList.appendChild(row);
    });
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

  function upsertTemplateFromWorkout(workout) {
    const name = (workout.name || "").trim();
    if (!name) return;
    const id = slugify(name);
    const exerciseIds = Object.keys(workout.exercises || {});
    const payload = {
      id,
      name,
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
    }, 1000);
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
    if (field === "rpe") {
      return parseDecimalInput(value);
    }
    const numeric = Number(value);
    return Number.isNaN(numeric) ? null : numeric;
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
}
