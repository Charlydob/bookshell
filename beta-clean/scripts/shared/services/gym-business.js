/* Native gym calculations and snapshots, shared by the editor and MCP. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BookshellGym=api;})(globalThis,function(){
'use strict';
function context(exercises={},bodyweightByDate={}){
function toNumber(value) {
    if (value == null) return null;
    if (typeof value === "string" && !value.trim()) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
  }
function getSetSideValue(primary, fallback) {
    const primaryValue = toNumber(primary);
    if (primaryValue != null) return primaryValue;
    return toNumber(fallback);
  }
function getUnilateralReps(set) {
    const fallback = toNumber(set?.reps);
    return {
      repsR: getSetSideValue(set?.repsR, fallback),
      repsL: getSetSideValue(set?.repsL, fallback)
    };
  }
function getUnilateralKg(set) {
    const fallback = getSetSideValue(set?.kg, set?.extraKg);
    return {
      kgR: getSetSideValue(set?.kgR, fallback),
      kgL: getSetSideValue(set?.kgL, fallback)
    };
  }
function normalizeExerciseDefinition(exercise) {
    const rawType = exercise?.type;
    if (rawType === "cardio") {
      return { kind: "cardio", strengthType: "reps" };
    }
    if (rawType === "strength") {
      return { kind: "strength", strengthType: exercise?.strengthType || "reps" };
    }
    if (rawType === "time" || rawType === "reps") {
      return { kind: "strength", strengthType: rawType };
    }
    return { kind: "strength", strengthType: exercise?.strengthType || "reps" };
  }
function getExerciseKind(exerciseData, exerciseId) {
    const rawType = exerciseData?.typeSnapshot ?? exercises?.[exerciseId]?.type;
    if (rawType === "cardio") return "cardio";
    return "strength";
  }
function getExerciseStrengthType(exerciseData, exerciseId) {
    const snapshot = exerciseData?.strengthTypeSnapshot;
    if (snapshot === "time" || snapshot === "reps") return snapshot;
    const rawType = exerciseData?.typeSnapshot ?? exercises?.[exerciseId]?.type;
    if (rawType === "time" || rawType === "reps") return rawType;
    if (rawType === "strength") {
      return exercises?.[exerciseId]?.strengthType || "reps";
    }
    return exercises?.[exerciseId]?.strengthType || "reps";
  }
function getExerciseType(exerciseData, exerciseId) {
    const kind = getExerciseKind(exerciseData, exerciseId);
    if (kind === "cardio") return "cardio";
    return getExerciseStrengthType(exerciseData, exerciseId);
  }
function getExerciseUseBodyweight(exerciseData, exerciseId) {
    if (!exerciseData && !exerciseId) return false;
    const resolvedExerciseId = String(exerciseData?.id || exerciseId || "").trim();
    const catalogExercise = resolvedExerciseId
      && exercises?.[resolvedExerciseId]
      && exercises[resolvedExerciseId] !== exerciseData
      ? exercises[resolvedExerciseId]
      : null;
    const fallbackToCatalog = catalogExercise
      ? getExerciseUseBodyweight(catalogExercise)
      : false;
    if (!exerciseData) return fallbackToCatalog;
    if (exerciseData.useBodyweight !== undefined) {
      return Boolean(exerciseData.useBodyweight) || fallbackToCatalog;
    }
    if (exerciseData.bw !== undefined) {
      return Boolean(exerciseData.bw) || fallbackToCatalog;
    }
    if (exerciseData.isBodyweight !== undefined) {
      return Boolean(exerciseData.isBodyweight) || fallbackToCatalog;
    }
    if (exerciseData.bodyweight !== undefined) {
      return Boolean(exerciseData.bodyweight) || fallbackToCatalog;
    }
    return (exerciseData.sets || []).some((set) => set?.useBodyweight || set?.bodyweight)
      || fallbackToCatalog;
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
function getLatestBodyweightEntry(dateKey) {
    const dates = Object.keys(bodyweightByDate || {}).filter((date) => date <= dateKey).sort();
    if (!dates.length) return null;
    const latest = dates[dates.length - 1];
    return { date: latest, entry: bodyweightByDate[latest] };
  }
function getBodyweightForDate(dateKey) {
    return getLatestBodyweightEntry(dateKey)?.entry?.weightKg ?? null;
  }
function getSetEffectiveKg(set, dateKey, useBodyweight = false, kgOverride) {
    if (!set) return null;
    const extraKg = Number(set.extraKg) || 0;
    const kgValue = toNumber(kgOverride !== undefined ? kgOverride : set.kg);
    if (useBodyweight) {
      const baseKg = getBodyweightForDate(dateKey) ?? 0;
      const loadKg = kgValue ?? 0;
      return baseKg + loadKg + extraKg;
    }
    if (kgValue == null) return null;
    return kgValue + extraKg;
  }
function computeWorkoutTotals(workout) {
    let totalReps = 0;
    let totalVolumeKg = 0;
    Object.entries(workout.exercises || {}).forEach(([exerciseId, exercise]) => {
      const unilateral = getExerciseUnilateral(exercise, exerciseId);
      const exerciseType = getExerciseType(exercise, exerciseId);
      const useBodyweight = getExerciseUseBodyweight(exercise, exerciseId);
      (exercise.sets || []).forEach((set) => {
        if (!set.done) return;
        if (exerciseType === "cardio") {
          return;
        }
        if (exerciseType === "time") {
          const timeSec = Number(set.timeSec) || 0;
          const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight) || 0;
          totalVolumeKg += timeSec * kgEff;
        } else if (unilateral) {
          const { repsR, repsL } = getUnilateralReps(set);
          const repsRight = repsR || 0;
          const repsLeft = repsL || 0;
          const { kgR, kgL } = getUnilateralKg(set);
          const kgEffR = getSetEffectiveKg(set, workout.date, useBodyweight, kgR);
          const kgEffL = getSetEffectiveKg(set, workout.date, useBodyweight, kgL);
          totalReps += repsRight + repsLeft;
          if (kgEffR != null) totalVolumeKg += repsRight * kgEffR;
          if (kgEffL != null) totalVolumeKg += repsLeft * kgEffL;
        } else {
          const reps = Number(set.reps) || 0;
          const kgEff = getSetEffectiveKg(set, workout.date, useBodyweight) || 0;
          totalReps += reps;
          totalVolumeKg += reps * kgEff;
        }
      });
    });
    return { totalReps, totalVolumeKg };
  }

function snapshot(exerciseId,sets,index=0){
 const exercise=exercises[exerciseId];if(!exercise)throw Error('EXERCISE_NOT_FOUND');
 const {kind,strengthType}=normalizeExerciseDefinition(exercise);
 return {nameSnapshot:exercise.name,muscleGroupsSnapshot:getExerciseMuscleGroups(exercise),unilateralSnapshot:Boolean(exercise.unilateral),typeSnapshot:kind,strengthTypeSnapshot:kind==='strength'?strengthType:null,metCategoryIdSnapshot:String(exercise.metCategoryId||'').trim(),originalIndex:index,useBodyweight:getExerciseUseBodyweight(exercise,exerciseId),sets};
}
return {totals:computeWorkoutTotals,snapshot,type:getExerciseType,unilateral:getExerciseUnilateral,useBodyweight:getExerciseUseBodyweight,bodyweight:getBodyweightForDate};
}
function template(id,name,exerciseIds,emoji,now){return {id,name,emoji:emoji??null,exerciseIds,updatedAt:now};}
return {context,template};
});
