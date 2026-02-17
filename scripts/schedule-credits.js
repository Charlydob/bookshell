function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, Math.round(n)));
}

function normalizeOrder(orderRaw) {
  const fallback = ["goals", "limits"];
  if (!Array.isArray(orderRaw) || !orderRaw.length) return fallback;
  const cleaned = orderRaw
    .map((item) => String(item || "").trim().toLowerCase())
    .filter((item) => item === "goals" || item === "limits");
  const unique = Array.from(new Set(cleaned));
  if (!unique.length) return fallback;
  if (!unique.includes("goals")) unique.push("goals");
  if (!unique.includes("limits")) unique.push("limits");
  return unique.slice(0, 2);
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

export function computeDayCreditsAndScores({ targets = [], limits = [], neutrals = [], doneMap = {}, settings = {}, habitMeta = {} } = {}) {
  const creditRateRaw = Number(settings?.creditRate);
  const creditRate = Number.isFinite(creditRateRaw) && creditRateRaw >= 0 ? creditRateRaw : 1;
  const order = normalizeOrder(settings?.creditAllocationOrder);
  const allowOutside = !!settings?.allowCreditsOutsideTemplate;

  const targetRows = targets.map((row) => {
    const eq = toEqMinutes(row, habitMeta);
    return { ...row, ...eq };
  });
  const limitRows = limits.map((row) => {
    const eq = toEqMinutes(row, habitMeta);
    return { ...row, ...eq };
  });

  const budgetMin = targetRows.reduce((acc, row) => acc + row.valueEqMin, 0);
  const productiveMin = targetRows.reduce((acc, row) => acc + Math.min(row.doneEqMin, row.valueEqMin), 0);
  const missingMin = targetRows.reduce((acc, row) => acc + Math.max(0, row.valueEqMin - row.doneEqMin), 0);
  const wasteExcessMin = limitRows.reduce((acc, row) => acc + Math.max(0, row.doneEqMin - row.valueEqMin), 0);

  const earnedFromTargets = targetRows.reduce((acc, row) => acc + Math.max(0, row.doneEqMin - row.valueEqMin), 0);

  const templateIds = new Set([
    ...targetRows.map((row) => row.habitId),
    ...limitRows.map((row) => row.habitId),
    ...neutrals.map((row) => row.habitId)
  ]);

  let earnedOutside = 0;
  if (allowOutside) {
    Object.entries(doneMap || {}).forEach(([habitId, totals]) => {
      if (!habitId || templateIds.has(habitId)) return;
      const meta = habitMeta?.[habitId] || {};
      if (!meta.habitScheduleCreditEligible) return;
      const doneCount = Math.max(0, Number(totals?.doneCount) || 0);
      const doneMin = Math.max(0, Number(totals?.doneMin) || 0);
      const perCount = Math.max(1, Math.round(Number(meta?.countMinuteValue ?? meta?.countUnitMinutes) || 1));
      earnedOutside += doneMin + (doneCount * perCount);
    });
  }

  const creditsEarned = (earnedFromTargets + earnedOutside) * creditRate;

  let remainingCredits = creditsEarned;
  let creditsToGoals = 0;
  let creditsToLimits = 0;

  order.forEach((slot) => {
    if (slot === "goals") {
      const used = Math.min(remainingCredits, missingMin - creditsToGoals);
      creditsToGoals += Math.max(0, used);
      remainingCredits -= Math.max(0, used);
      return;
    }
    if (slot === "limits") {
      const used = Math.min(remainingCredits, wasteExcessMin - creditsToLimits);
      creditsToLimits += Math.max(0, used);
      remainingCredits -= Math.max(0, used);
    }
  });

  const productiveMinAdjusted = productiveMin + creditsToGoals;
  const missingAfter = Math.max(0, missingMin - creditsToGoals);
  const wasteAfter = Math.max(0, wasteExcessMin - creditsToLimits);

  const scoreCred = budgetMin > 0 ? clampPercent((productiveMinAdjusted / budgetMin) * 100) : 0;
  const scoreNet = budgetMin > 0 ? clampPercent(((productiveMinAdjusted - wasteAfter) / budgetMin) * 100) : 0;

  return {
    scorePlan: 0,
    scoreCred,
    scoreNet,
    budgetMin,
    creditsEarned,
    creditsToGoals,
    creditsToLimits,
    missingMin,
    missingAfter,
    wasteExcessMin,
    wasteAfter,
    productiveMin,
    productiveMinAdjusted
  };
}
