function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function toEqMinutes(row, habitMeta) {
  const metric = row?.info?.metric || "time";
  const done = Math.max(0, Number(row?.done) || 0);
  const value = Math.max(0, Number(row?.value) || 0);
  const habit = habitMeta?.[row?.habitId] || {};
  const countMinuteValue = Math.max(1, Math.round(Number(habit?.countMinuteValue ?? habit?.countUnitMinutes) || 1));
  if (metric === "count") {
    return {
      doneEqMin: done * countMinuteValue,
      valueEqMin: value * countMinuteValue,
      countMinuteValue
    };
  }
  return {
    doneEqMin: done,
    valueEqMin: value,
    countMinuteValue
  };
}

function safeMinMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object") return out;
  Object.entries(raw).forEach(([habitId, value]) => {
    const min = Math.max(0, Math.round(Number(value) || 0));
    if (habitId && min > 0) out[habitId] = min;
  });
  return out;
}

export function computeDayCreditsAndScores({ targets = [], limits = [], neutrals = [], doneMap = {}, habitMeta = {}, dayCredits = {} } = {}) {
  const targetRows = targets.map((row) => {
    const eq = toEqMinutes(row, habitMeta);
    return { ...row, ...eq };
  });
  const limitRows = limits.map((row) => {
    const eq = toEqMinutes(row, habitMeta);
    return { ...row, ...eq };
  });

  const spentByHabitRaw = safeMinMap(dayCredits?.spentByHabit);
  const spentToLimitsRaw = safeMinMap(dayCredits?.spentToLimits);

  const budgetMin = targetRows.reduce((acc, row) => acc + row.valueEqMin, 0);
  const productiveRealMin = targetRows.reduce((acc, row) => acc + Math.min(row.doneEqMin, row.valueEqMin), 0);

  const targetCoinContributionByHabit = {};
  const targetMissingEqByHabit = {};
  const targetRealContributionByHabit = {};
  let creditsToGoals = 0;

  targetRows.forEach((row) => {
    const missingEq = Math.max(0, row.valueEqMin - row.doneEqMin);
    const spent = Math.max(0, Math.round(Number(spentByHabitRaw[row.habitId]) || 0));
    const used = Math.min(missingEq, spent);
    targetMissingEqByHabit[row.habitId] = missingEq;
    targetCoinContributionByHabit[row.habitId] = used;
    targetRealContributionByHabit[row.habitId] = Math.min(row.doneEqMin, row.valueEqMin);
    creditsToGoals += used;
  });

  const limitForgivenByHabit = {};
  const limitExcessEqByHabit = {};
  let creditsToLimits = 0;

  limitRows.forEach((row) => {
    const excessEq = Math.max(0, row.doneEqMin - row.valueEqMin);
    const spent = Math.max(0, Math.round(Number(spentToLimitsRaw[row.habitId]) || 0));
    const used = Math.min(excessEq, spent);
    limitExcessEqByHabit[row.habitId] = excessEq;
    limitForgivenByHabit[row.habitId] = used;
    creditsToLimits += used;
  });

  const templateIds = new Set([
    ...targetRows.map((row) => row.habitId),
    ...limitRows.map((row) => row.habitId),
    ...neutrals.map((row) => row.habitId)
  ]);

  const earnedFromTargets = targetRows.reduce((acc, row) => acc + Math.max(0, row.doneEqMin - row.valueEqMin), 0);
  let earnedOutside = 0;
  Object.entries(doneMap || {}).forEach(([habitId, totals]) => {
    if (!habitId || templateIds.has(habitId)) return;
    const meta = habitMeta?.[habitId] || {};
    if (!meta.creditEligibleOutsideSchedule && !meta.habitScheduleCreditEligible) return;
    const doneCount = Math.max(0, Number(totals?.doneCount) || 0);
    const doneMin = Math.max(0, Number(totals?.doneMin) || 0);
    const perCount = Math.max(1, Math.round(Number(meta?.countMinuteValue ?? meta?.countUnitMinutes) || 1));
    earnedOutside += doneMin + (doneCount * perCount);
  });

  const creditsEarned = Math.max(0, Math.round(earnedFromTargets + earnedOutside));
  const coinsSpent = creditsToGoals + creditsToLimits;
  const coinsAvailable = Math.max(0, creditsEarned - coinsSpent);

  const productiveMinAdjusted = productiveRealMin + creditsToGoals;
  const missingMin = targetRows.reduce((acc, row) => acc + Math.max(0, row.valueEqMin - row.doneEqMin), 0);
  const missingAfter = Math.max(0, missingMin - creditsToGoals);
  const wasteExcessMin = limitRows.reduce((acc, row) => acc + Math.max(0, row.doneEqMin - row.valueEqMin), 0);
  const wasteAfter = Math.max(0, wasteExcessMin - creditsToLimits);

  const scoreCred = budgetMin > 0 ? clampPercent((productiveMinAdjusted / budgetMin) * 100) : 0;

  return {
    scorePlan: 0,
    scoreCred,
    scoreNet: scoreCred,
    budgetMin,
    creditsEarned,
    coinsSpent,
    coinsAvailable,
    creditsToGoals,
    creditsToLimits,
    missingMin,
    missingAfter,
    wasteExcessMin,
    wasteAfter,
    productiveMin: productiveRealMin,
    productiveMinAdjusted,
    targetCoinContributionByHabit,
    targetMissingEqByHabit,
    targetRealContributionByHabit,
    limitForgivenByHabit,
    limitExcessEqByHabit,
    spentByHabit: spentByHabitRaw,
    spentToLimits: spentToLimitsRaw,
    earnedFromTargets,
    earnedOutside
  };
}
