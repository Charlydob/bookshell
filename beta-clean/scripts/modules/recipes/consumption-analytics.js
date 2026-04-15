// Analitica reutilizable de consumo por producto.
// Acepta historico normalizado y devuelve agregados compactos para UI.
const MONTH_AVG_DAYS = 30.4375;
const WEEKDAY_LABELS = ["Dom", "Lun", "Mar", "Mie", "Jue", "Vie", "Sab"];
const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function safeNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function normalizeUnit(unit) {
  const normalized = String(unit || "").trim().toLowerCase();
  if (!normalized) return "";
  if (normalized === "kg" || normalized === "g") return normalized;
  if (normalized === "l" || normalized === "ml") return normalized;
  if (normalized === "unit" || normalized === "ud" || normalized === "u") return "unit";
  return normalized;
}

function normalizeIsoDate(value) {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return "";
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const raw = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!raw) return "";
  const parsed = new Date(raw);
  return normalizeIsoDate(parsed);
}

function parseIsoDate(isoDate) {
  const normalized = normalizeIsoDate(isoDate);
  if (!normalized) return null;
  const date = new Date(`${normalized}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function diffDays(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return 0;
  const diff = end.getTime() - start.getTime();
  return Math.round(diff / 86400000);
}

function addDays(isoDate, days) {
  const base = parseIsoDate(isoDate);
  if (!base || !Number.isFinite(Number(days))) return "";
  base.setDate(base.getDate() + Math.round(Number(days) || 0));
  return normalizeIsoDate(base);
}

function toMonthKey(isoDate) {
  const normalized = normalizeIsoDate(isoDate);
  return normalized ? normalized.slice(0, 7) : "";
}

function toWeekKey(isoDate) {
  const date = parseIsoDate(isoDate);
  if (!date) return "";
  const weekDay = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - weekDay);
  return normalizeIsoDate(date);
}

function listMonthKeysWindow(endIsoDate, count = 6) {
  const end = parseIsoDate(endIsoDate) || new Date();
  const total = Math.max(1, Math.round(Number(count) || 0));
  const keys = [];
  for (let index = total - 1; index >= 0; index -= 1) {
    const cursor = new Date(end.getFullYear(), end.getMonth() - index, 1);
    keys.push(toMonthKey(cursor));
  }
  return keys;
}

function monthDistanceInclusive(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return 0;
  return Math.max(1, (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth()) + 1);
}

function mean(values = []) {
  if (!Array.isArray(values) || !values.length) return null;
  const total = values.reduce((acc, value) => acc + safeNumber(value), 0);
  return total / values.length;
}

function standardDeviation(values = []) {
  const avg = mean(values);
  if (!(avg >= 0) || values.length < 2) return null;
  const variance = values.reduce((acc, value) => {
    const current = safeNumber(value);
    return acc + ((current - avg) ** 2);
  }, 0) / values.length;
  return Math.sqrt(Math.max(0, variance));
}

function coefficientOfVariation(values = []) {
  const avg = mean(values);
  const deviation = standardDeviation(values);
  if (!(avg > 0) || !(deviation >= 0)) return null;
  return deviation / avg;
}

function resolveUnitWeightSpec(source = {}) {
  const qty = safeNumber(source?.unitWeightQty, NaN);
  const unit = normalizeUnit(source?.unitWeightUnit);
  if (!(qty > 0) || !unit) return null;
  return { qty, unit };
}

function convertAmount(quantity, fromUnit, toUnit, unitWeightSpec = null) {
  const value = safeNumber(quantity, NaN);
  const from = normalizeUnit(fromUnit);
  const to = normalizeUnit(toUnit);
  if (!(value >= 0) || !from || !to) return null;
  if (from === to) return value;
  if (from === "kg" && to === "g") return value * 1000;
  if (from === "g" && to === "kg") return value / 1000;
  if (from === "l" && to === "ml") return value * 1000;
  if (from === "ml" && to === "l") return value / 1000;
  if (!unitWeightSpec) return null;
  const perUnit = safeNumber(unitWeightSpec.qty, NaN);
  const perUnitUnit = normalizeUnit(unitWeightSpec.unit);
  if (!(perUnit > 0) || !perUnitUnit) return null;
  if (from === "unit") {
    const perUnitInTarget = convertAmount(perUnit, perUnitUnit, to);
    return perUnitInTarget == null ? null : value * perUnitInTarget;
  }
  if (to === "unit") {
    const perUnitInSource = convertAmount(perUnit, perUnitUnit, from);
    return perUnitInSource == null || perUnitInSource <= 0 ? null : value / perUnitInSource;
  }
  return null;
}

function resolvePriceBase(product = {}) {
  const directQty = safeNumber(product?.priceBaseQty, NaN);
  const directUnit = normalizeUnit(product?.priceBaseUnit);
  if (directQty > 0 && directUnit) return { qty: directQty, unit: directUnit };
  const packageQty = safeNumber(product?.packageAmount, NaN);
  const packageUnit = normalizeUnit(product?.packageUnit);
  if (packageQty > 0 && packageUnit) return { qty: packageQty, unit: packageUnit };
  const baseQty = safeNumber(product?.baseQuantity, NaN);
  const baseUnit = normalizeUnit(product?.baseUnit);
  if (baseQty > 0 && baseUnit) return { qty: baseQty, unit: baseUnit };
  return null;
}

function computeCostFromPriceSpec({ amount, unit, price, baseQty, baseUnit, unitWeightSpec }) {
  const safePrice = safeNumber(price, NaN);
  const safeBaseQty = safeNumber(baseQty, NaN);
  const normalizedBaseUnit = normalizeUnit(baseUnit);
  if (!(safePrice > 0) || !(safeBaseQty > 0) || !normalizedBaseUnit) return null;
  const amountInBase = convertAmount(amount, unit, normalizedBaseUnit, unitWeightSpec);
  if (!(amountInBase >= 0)) return null;
  return (amountInBase / safeBaseQty) * safePrice;
}

function safeMapRecord(map, key, factory) {
  if (!map.has(key)) map.set(key, factory());
  return map.get(key);
}

function createTimeBuckets() {
  return {
    byDate: new Map(),
    byWeek: new Map(),
    byMonth: new Map(),
    byWeekday: Array.from({ length: 7 }, () => ({ quantity: 0, cost: 0, count: 0 })),
    byMonthOfYear: Array.from({ length: 12 }, () => ({ quantity: 0, cost: 0, count: 0 })),
    byMeal: new Map(),
  };
}

function createProductRecord(product = {}) {
  const baseUnit = normalizeUnit(product?.baseUnit || product?.packageUnit || "g") || "g";
  return {
    id: String(product?.id || "").trim(),
    name: String(product?.name || "Producto").trim() || "Producto",
    emoji: String(product?.emoji || "").trim().substring(0, 2),
    baseUnit,
    packageAmount: safeNumber(product?.packageAmount, 0) > 0 ? safeNumber(product.packageAmount) : null,
    packageUnit: normalizeUnit(product?.packageUnit),
    effectivePrice: safeNumber(product?.effectivePrice, 0) > 0 ? safeNumber(product.effectivePrice) : null,
    priceBaseQty: safeNumber(product?.priceBaseQty, 0) > 0 ? safeNumber(product.priceBaseQty) : null,
    priceBaseUnit: normalizeUnit(product?.priceBaseUnit),
    budgetTargetMonthly: safeNumber(product?.budgetTargetMonthly, 0) > 0 ? safeNumber(product.budgetTargetMonthly) : null,
    unitWeightSpec: resolveUnitWeightSpec(product),
    totalOccurrences: 0,
    totalQuantity: 0,
    quantityEvents: 0,
    totalCost: 0,
    costEvents: 0,
    directOccurrences: 0,
    recipeOccurrences: 0,
    firstUsedDate: "",
    lastUsedDate: "",
    activeDates: new Set(),
    gapDays: [],
    recent30Occurrences: 0,
    recent30Cost: 0,
    recent30Quantity: 0,
    recent60Occurrences: 0,
    recent60Cost: 0,
    recent60Quantity: 0,
    time: createTimeBuckets(),
  };
}

function registerBucket(map, key) {
  return safeMapRecord(map, key, () => ({ quantity: 0, cost: 0, count: 0 }));
}

function applyEventToProduct(record, event, nowIsoDate) {
  if (!record || !event?.date) return;
  const count = Math.max(0, safeNumber(event.occurrences, 0));
  const quantity = safeNumber(event.quantity, NaN);
  const cost = safeNumber(event.cost, NaN);
  if (!(count > 0)) return;

  record.totalOccurrences += count;
  if (event.source === "recipe") record.recipeOccurrences += count;
  else record.directOccurrences += count;

  if (quantity >= 0) {
    record.totalQuantity += quantity;
    record.quantityEvents += count;
  }
  if (cost >= 0) {
    record.totalCost += cost;
    record.costEvents += count;
  }

  if (!record.firstUsedDate || event.date < record.firstUsedDate) record.firstUsedDate = event.date;
  if (!record.lastUsedDate || event.date > record.lastUsedDate) record.lastUsedDate = event.date;
  record.activeDates.add(event.date);

  const dateBucket = registerBucket(record.time.byDate, event.date);
  dateBucket.count += count;
  if (quantity >= 0) dateBucket.quantity += quantity;
  if (cost >= 0) dateBucket.cost += cost;

  const weekKey = toWeekKey(event.date);
  if (weekKey) {
    const weekBucket = registerBucket(record.time.byWeek, weekKey);
    weekBucket.count += count;
    if (quantity >= 0) weekBucket.quantity += quantity;
    if (cost >= 0) weekBucket.cost += cost;
  }

  const monthKey = toMonthKey(event.date);
  if (monthKey) {
    const monthBucket = registerBucket(record.time.byMonth, monthKey);
    monthBucket.count += count;
    if (quantity >= 0) monthBucket.quantity += quantity;
    if (cost >= 0) monthBucket.cost += cost;
  }

  const date = parseIsoDate(event.date);
  if (date) {
    const weekDay = date.getDay();
    const monthIndex = date.getMonth();
    const weekdayBucket = record.time.byWeekday[weekDay];
    const monthOfYearBucket = record.time.byMonthOfYear[monthIndex];
    weekdayBucket.count += count;
    monthOfYearBucket.count += count;
    if (quantity >= 0) {
      weekdayBucket.quantity += quantity;
      monthOfYearBucket.quantity += quantity;
    }
    if (cost >= 0) {
      weekdayBucket.cost += cost;
      monthOfYearBucket.cost += cost;
    }
  }

  const mealKey = String(event.meal || "").trim() || "other";
  const mealBucket = registerBucket(record.time.byMeal, mealKey);
  mealBucket.count += count;
  if (quantity >= 0) mealBucket.quantity += quantity;
  if (cost >= 0) mealBucket.cost += cost;

  const daysAgo = diffDays(event.date, nowIsoDate);
  if (daysAgo >= 0 && daysAgo <= 29) {
    record.recent30Occurrences += count;
    if (quantity >= 0) record.recent30Quantity += quantity;
    if (cost >= 0) record.recent30Cost += cost;
  }
  if (daysAgo >= 0 && daysAgo <= 59) {
    record.recent60Occurrences += count;
    if (quantity >= 0) record.recent60Quantity += quantity;
    if (cost >= 0) record.recent60Cost += cost;
  }
}

function resolveProductQuantityInBase({ amount, unit, grams, product }) {
  const safeAmount = safeNumber(amount, NaN);
  const safeUnit = normalizeUnit(unit);
  const baseUnit = normalizeUnit(product?.baseUnit || product?.packageUnit || "g") || "g";
  const unitWeightSpec = resolveUnitWeightSpec(product);
  if (safeAmount >= 0 && safeUnit) {
    const converted = convertAmount(safeAmount, safeUnit, baseUnit, unitWeightSpec);
    if (converted != null) return { quantity: converted, unit: baseUnit };
  }
  const safeGrams = safeNumber(grams, NaN);
  if (safeGrams >= 0) {
    const convertedGrams = convertAmount(safeGrams, "g", baseUnit, unitWeightSpec);
    if (convertedGrams != null) return { quantity: convertedGrams, unit: baseUnit };
  }
  return { quantity: null, unit: baseUnit };
}

function resolveEventCost({ amount, unit, explicitCost, product, pricingSnapshot = null }) {
  const directCost = safeNumber(explicitCost, NaN);
  if (directCost >= 0) return directCost;

  const pricing = pricingSnapshot && typeof pricingSnapshot === "object" ? pricingSnapshot : {};
  const price = safeNumber(pricing?.price, NaN) > 0 ? safeNumber(pricing.price) : safeNumber(product?.effectivePrice, NaN);
  const priceBaseQty = safeNumber(pricing?.baseQty, NaN) > 0 ? safeNumber(pricing.baseQty) : safeNumber(product?.priceBaseQty, NaN);
  const priceBaseUnit = normalizeUnit(pricing?.baseUnit || product?.priceBaseUnit);
  const unitWeightSpec = resolveUnitWeightSpec(pricing) || resolveUnitWeightSpec(product);
  return computeCostFromPriceSpec({
    amount,
    unit,
    price,
    baseQty: priceBaseQty,
    baseUnit: priceBaseUnit,
    unitWeightSpec,
  });
}

function buildDirectProductEvent({ entry, date, product }) {
  const occurrences = Math.max(0, safeNumber(entry?.servingsCount, 1));
  const quantityInBase = resolveProductQuantityInBase({
    amount: entry?.amount,
    unit: entry?.unit || entry?.amountUnit,
    grams: entry?.grams,
    product,
  });
  return [{
    productId: product.id,
    source: "direct",
    date,
    meal: entry?.mealSlot,
    occurrences,
    quantity: quantityInBase.quantity,
    unit: quantityInBase.unit,
    cost: resolveEventCost({
      amount: entry?.amount,
      unit: entry?.unit || entry?.amountUnit || product.baseUnit,
      explicitCost: entry?.computedCost != null ? safeNumber(entry?.computedCost, NaN) * occurrences : NaN,
      product,
      pricingSnapshot: entry?.pricingSnapshot,
    }),
  }];
}

function buildRecipeIngredientEvents({ entry, date, productMap }) {
  const ingredients = Array.isArray(entry?.ingredientsSnapshot)
    ? entry.ingredientsSnapshot
    : (Array.isArray(entry?.recipeSnapshot?.ingredients) ? entry.recipeSnapshot.ingredients : []);
  if (!ingredients.length) return [];

  const recipeServings = Math.max(1, safeNumber(entry?.recipeSnapshot?.servings, 1));
  const consumedServings = Math.max(0, safeNumber(entry?.servings, 0)) || 1;
  const entryCount = Math.max(0, safeNumber(entry?.servingsCount, 1));
  const recipeFactor = (consumedServings / recipeServings) * entryCount;
  if (!(recipeFactor > 0)) return [];

  return ingredients.reduce((events, ingredient) => {
    const productId = String(ingredient?.productId || "").trim();
    if (!productId) return events;
    const product = productMap.get(productId);
    if (!product) return events;
    const qty = safeNumber(ingredient?.qty, NaN);
    const unit = normalizeUnit(ingredient?.unit);
    const quantityRaw = qty >= 0 && unit ? qty * recipeFactor : NaN;
    const quantityInBase = quantityRaw >= 0
      ? convertAmount(quantityRaw, unit, product.baseUnit, resolveUnitWeightSpec(ingredient) || product.unitWeightSpec)
      : null;
    const cost = quantityRaw >= 0
      ? resolveEventCost({
        amount: quantityRaw,
        unit,
        explicitCost: NaN,
        product,
        pricingSnapshot: ingredient?.pricingSnapshot,
      })
      : null;
    events.push({
      productId,
      source: "recipe",
      date,
      meal: entry?.mealSlot,
      occurrences: entryCount,
      quantity: quantityInBase,
      unit: product.baseUnit,
      cost,
    });
    return events;
  }, []);
}

function finalizeProductRecord(record, nowIsoDate) {
  const activeDates = Array.from(record.activeDates).sort();
  for (let index = 1; index < activeDates.length; index += 1) {
    record.gapDays.push(diffDays(activeDates[index - 1], activeDates[index]));
  }
  const firstDate = activeDates[0] || record.firstUsedDate || "";
  const lastDate = activeDates[activeDates.length - 1] || record.lastUsedDate || "";
  const spanDays = firstDate && lastDate ? Math.max(1, diffDays(firstDate, lastDate) + 1) : 0;
  const observedWeeks = spanDays ? Math.max(1, Math.ceil(spanDays / 7)) : 0;
  const observedMonths = spanDays ? monthDistanceInclusive(firstDate, lastDate) : 0;
  const avgDailyQuantity = record.quantityEvents > 0 && spanDays ? record.totalQuantity / spanDays : null;
  const avgWeeklyQuantity = avgDailyQuantity != null ? avgDailyQuantity * 7 : null;
  const avgMonthlyQuantity = avgDailyQuantity != null ? avgDailyQuantity * MONTH_AVG_DAYS : null;
  const avgOccurrencesPerDay = spanDays ? record.totalOccurrences / spanDays : null;
  const avgOccurrencesPerWeek = observedWeeks ? record.totalOccurrences / observedWeeks : null;
  const avgOccurrencesPerMonth = observedMonths ? record.totalOccurrences / observedMonths : null;
  const avgGapDays = mean(record.gapDays);
  const irregularityScore = coefficientOfVariation(record.gapDays);
  const avgQuantityPerOccurrence = record.quantityEvents > 0 ? record.totalQuantity / record.quantityEvents : null;
  const avgCostPerOccurrence = record.costEvents > 0 ? record.totalCost / record.costEvents : null;
  const avgMonthlyCost = spanDays ? (record.totalCost / spanDays) * MONTH_AVG_DAYS : null;
  const daysSinceLastUse = lastDate ? Math.max(0, diffDays(lastDate, nowIsoDate)) : null;

  const weekdayPeakIndex = record.time.byWeekday.reduce((best, bucket, index) => {
    const score = safeNumber(bucket.quantity, 0) > 0 ? safeNumber(bucket.quantity, 0) : safeNumber(bucket.count, 0);
    if (score > best.score) return { index, score };
    return best;
  }, { index: -1, score: 0 }).index;

  const monthPeakIndex = record.time.byMonthOfYear.reduce((best, bucket, index) => {
    const score = safeNumber(bucket.quantity, 0) > 0 ? safeNumber(bucket.quantity, 0) : safeNumber(bucket.count, 0);
    if (score > best.score) return { index, score };
    return best;
  }, { index: -1, score: 0 }).index;

  const quantityUnit = normalizeUnit(record.baseUnit || record.packageUnit || "g") || "g";
  const packageDurationDays = (() => {
    const packageAmount = safeNumber(record.packageAmount, NaN);
    const packageUnit = normalizeUnit(record.packageUnit);
    if (!(packageAmount > 0) || !packageUnit || !(avgDailyQuantity > 0)) return null;
    const convertedPackage = convertAmount(packageAmount, packageUnit, quantityUnit, record.unitWeightSpec);
    if (!(convertedPackage > 0)) return null;
    return convertedPackage / avgDailyQuantity;
  })();

  const replenishmentDays = packageDurationDays || avgGapDays || (avgOccurrencesPerDay > 0 ? 1 / avgOccurrencesPerDay : null);
  const forecastDate = replenishmentDays && lastDate ? addDays(lastDate, replenishmentDays) : "";
  const daysUntilRestock = forecastDate ? diffDays(nowIsoDate, forecastDate) : null;
  const restockUrgency = daysUntilRestock == null
    ? "unknown"
    : (daysUntilRestock < 0 ? "overdue" : (daysUntilRestock <= 7 ? "soon" : "ok"));
  const suggestedMonthlyPurchaseUnits = (() => {
    const packageAmount = safeNumber(record.packageAmount, NaN);
    const packageUnit = normalizeUnit(record.packageUnit);
    if (!(packageAmount > 0) || !packageUnit || !(avgMonthlyQuantity > 0)) return null;
    const convertedPackage = convertAmount(packageAmount, packageUnit, quantityUnit, record.unitWeightSpec);
    if (!(convertedPackage > 0)) return null;
    return avgMonthlyQuantity / convertedPackage;
  })();

  const meals = Array.from(record.time.byMeal.entries())
    .map(([meal, bucket]) => ({ meal, count: safeNumber(bucket.count, 0), quantity: safeNumber(bucket.quantity, 0), cost: safeNumber(bucket.cost, 0) }))
    .sort((left, right) => right.count - left.count);

  return {
    ...record,
    activeDates,
    spanDays,
    observedWeeks,
    observedMonths,
    daysSinceLastUse,
    avgDailyQuantity,
    avgWeeklyQuantity,
    avgMonthlyQuantity,
    avgOccurrencesPerDay,
    avgOccurrencesPerWeek,
    avgOccurrencesPerMonth,
    avgGapDays,
    irregularityScore,
    avgQuantityPerOccurrence,
    avgCostPerOccurrence,
    avgMonthlyCost,
    quantityUnit,
    weekdayPeakIndex,
    weekdayPeakLabel: weekdayPeakIndex >= 0 ? WEEKDAY_LABELS[weekdayPeakIndex] : "",
    monthPeakIndex,
    monthPeakLabel: monthPeakIndex >= 0 ? MONTH_LABELS[monthPeakIndex] : "",
    packageDurationDays,
    replenishmentDays,
    forecastDate,
    daysUntilRestock,
    restockUrgency,
    suggestedMonthlyPurchaseUnits,
    suggestedBudgetMonthly: avgMonthlyCost,
    effectiveBudgetMonthly: record.budgetTargetMonthly || avgMonthlyCost,
    meals,
    dominantMeal: meals[0]?.meal || "",
  };
}

function buildShareSegments(records, valueKey, { top = 5, otherLabel = "Otros" } = {}) {
  const source = records
    .filter((item) => safeNumber(item?.[valueKey], 0) > 0)
    .sort((left, right) => safeNumber(right?.[valueKey], 0) - safeNumber(left?.[valueKey], 0));
  if (!source.length) return [];
  const selected = source.slice(0, top).map((item) => ({ ...item }));
  const leftover = source.slice(top).reduce((acc, item) => acc + safeNumber(item?.[valueKey], 0), 0);
  if (leftover > 0) {
    selected.push({
      id: "other",
      name: otherLabel,
      emoji: "•",
      [valueKey]: leftover,
    });
  }
  return selected;
}

function buildMonthlyTimeline(records, nowIsoDate, totalMonths = 6) {
  const months = listMonthKeysWindow(nowIsoDate, totalMonths);
  const monthMap = new Map(months.map((monthKey) => [monthKey, { monthKey, label: monthKey, count: 0, cost: 0, quantity: 0 }]));
  records.forEach((record) => {
    record.time.byMonth.forEach((bucket, monthKey) => {
      if (!monthMap.has(monthKey)) return;
      const current = monthMap.get(monthKey);
      current.count += safeNumber(bucket.count, 0);
      current.cost += safeNumber(bucket.cost, 0);
      current.quantity += safeNumber(bucket.quantity, 0);
    });
  });
  return months.map((monthKey) => {
    const row = monthMap.get(monthKey) || { monthKey, count: 0, cost: 0, quantity: 0 };
    const [year, month] = monthKey.split("-");
    const monthIndex = Math.max(0, Math.min(11, safeNumber(month, 1) - 1));
    return {
      ...row,
      label: `${MONTH_LABELS[monthIndex]} ${String(year || "").slice(-2)}`,
    };
  });
}

function rankRecords(records, key, { minValue = 0, descending = true } = {}) {
  return records
    .filter((item) => safeNumber(item?.[key], 0) > minValue)
    .sort((left, right) => {
      const delta = safeNumber(left?.[key], 0) - safeNumber(right?.[key], 0);
      return descending ? -delta : delta;
    });
}

function buildMemoryPanels(usedRecords) {
  const shortestDuration = rankRecords(usedRecords, "packageDurationDays", { minValue: 0, descending: false });
  const frequentRestock = rankRecords(usedRecords, "replenishmentDays", { minValue: 0, descending: false });
  const irregular = rankRecords(usedRecords.filter((item) => item.activeDates.length >= 3), "irregularityScore", { minValue: 0, descending: true });
  const lowUsage = usedRecords
    .filter((item) => (item.daysSinceLastUse || 0) >= 14 || item.recent30Occurrences <= 1)
    .sort((left, right) => {
      const recentDelta = safeNumber(left.recent30Occurrences, 0) - safeNumber(right.recent30Occurrences, 0);
      if (recentDelta !== 0) return recentDelta;
      return safeNumber(right.daysSinceLastUse, 0) - safeNumber(left.daysSinceLastUse, 0);
    });

  return {
    mostConsumed: rankRecords(usedRecords, "totalOccurrences", { minValue: 0, descending: true }).slice(0, 5),
    highestCost: rankRecords(usedRecords, "totalCost", { minValue: 0, descending: true }).slice(0, 5),
    shortestDuration: shortestDuration.slice(0, 5),
    frequentRestock: frequentRestock.slice(0, 5),
    irregular: irregular.slice(0, 5),
    lowUsage: lowUsage.slice(0, 5),
  };
}

function buildFeaturedProducts(usedRecords) {
  const countMax = Math.max(1, ...usedRecords.map((item) => safeNumber(item.totalOccurrences, 0)));
  const costMax = Math.max(1, ...usedRecords.map((item) => safeNumber(item.avgMonthlyCost, 0)));
  const recentMax = Math.max(1, ...usedRecords.map((item) => safeNumber(item.recent30Occurrences, 0)));
  return usedRecords
    .map((item) => {
      const countScore = safeNumber(item.totalOccurrences, 0) / countMax;
      const costScore = safeNumber(item.avgMonthlyCost, 0) / costMax;
      const recentScore = safeNumber(item.recent30Occurrences, 0) / recentMax;
      const urgencyScore = item.restockUrgency === "overdue" ? 1 : (item.restockUrgency === "soon" ? 0.65 : 0);
      return { ...item, featuredScore: (countScore * 0.45) + (costScore * 0.3) + (recentScore * 0.15) + (urgencyScore * 0.1) };
    })
    .sort((left, right) => right.featuredScore - left.featuredScore)
    .slice(0, 8);
}

export function buildConsumptionAnalytics({
  dailyLogsByDate = {},
  products = [],
  nowIsoDate = "",
} = {}) {
  const safeNowIsoDate = normalizeIsoDate(nowIsoDate) || normalizeIsoDate(new Date());
  const productMap = new Map();
  products.forEach((product) => {
    const id = String(product?.id || "").trim();
    if (!id) return;
    productMap.set(id, {
      id,
      name: String(product?.name || "").trim() || "Producto",
      emoji: String(product?.emoji || "").trim().substring(0, 2),
      baseUnit: normalizeUnit(product?.baseUnit || product?.packageUnit || "g") || "g",
      baseQuantity: safeNumber(product?.baseQuantity, 0) > 0 ? safeNumber(product.baseQuantity) : 100,
      packageAmount: safeNumber(product?.packageAmount, 0) > 0 ? safeNumber(product.packageAmount) : null,
      packageUnit: normalizeUnit(product?.packageUnit),
      effectivePrice: safeNumber(product?.effectivePrice, 0) > 0 ? safeNumber(product.effectivePrice) : null,
      priceBaseQty: (() => {
        const priceBase = resolvePriceBase(product);
        return priceBase?.qty || null;
      })(),
      priceBaseUnit: (() => {
        const priceBase = resolvePriceBase(product);
        return priceBase?.unit || "";
      })(),
      budgetTargetMonthly: safeNumber(product?.budgetTargetMonthly, 0) > 0 ? safeNumber(product.budgetTargetMonthly) : null,
      unitWeightQty: safeNumber(product?.unitWeightQty, 0) > 0 ? safeNumber(product.unitWeightQty) : null,
      unitWeightUnit: normalizeUnit(product?.unitWeightUnit),
    });
  });

  const recordsMap = new Map();
  const logDates = Object.keys(dailyLogsByDate || {})
    .map((date) => normalizeIsoDate(date))
    .filter(Boolean)
    .sort();

  logDates.forEach((date) => {
    const log = dailyLogsByDate?.[date];
    const meals = log?.meals && typeof log.meals === "object" ? log.meals : {};
    Object.values(meals).forEach((mealLog) => {
      const entries = Array.isArray(mealLog?.entries) ? mealLog.entries : [];
      entries.forEach((entry) => {
        if (entry?.type === "recipe") {
          const recipeEvents = buildRecipeIngredientEvents({ entry, date, productMap });
          recipeEvents.forEach((event) => {
            const product = productMap.get(event.productId);
            if (!product) return;
            const record = safeMapRecord(recordsMap, event.productId, () => createProductRecord(product));
            applyEventToProduct(record, event, safeNowIsoDate);
          });
          return;
        }

        const productId = String(entry?.productId || entry?.refId || "").trim();
        const product = productMap.get(productId);
        if (!product) return;
        const directEvents = buildDirectProductEvent({ entry, date, product });
        directEvents.forEach((event) => {
          const record = safeMapRecord(recordsMap, event.productId, () => createProductRecord(product));
          applyEventToProduct(record, event, safeNowIsoDate);
        });
      });
    });
  });

  const records = Array.from(recordsMap.values()).map((record) => finalizeProductRecord(record, safeNowIsoDate));
  const usedRecords = records.filter((item) => item.totalOccurrences > 0);
  const restockSoon = usedRecords
    .filter((item) => item.daysUntilRestock != null && item.daysUntilRestock <= 14)
    .sort((left, right) => safeNumber(left.daysUntilRestock, 999) - safeNumber(right.daysUntilRestock, 999))
    .slice(0, 6);
  const budgetCandidates = usedRecords
    .filter((item) => safeNumber(item.avgMonthlyCost, 0) > 0 || safeNumber(item.budgetTargetMonthly, 0) > 0)
    .sort((left, right) => safeNumber(right.avgMonthlyCost, 0) - safeNumber(left.avgMonthlyCost, 0))
    .slice(0, 6);

  return {
    generatedAt: safeNowIsoDate,
    totals: {
      productsTracked: usedRecords.length,
      totalOccurrences: usedRecords.reduce((acc, item) => acc + safeNumber(item.totalOccurrences, 0), 0),
      totalCost: usedRecords.reduce((acc, item) => acc + safeNumber(item.totalCost, 0), 0),
      avgMonthlyCost: usedRecords.reduce((acc, item) => acc + safeNumber(item.avgMonthlyCost, 0), 0),
      soonToRestock: restockSoon.length,
      quantityCoverageProducts: usedRecords.filter((item) => item.quantityEvents > 0).length,
      costCoverageProducts: usedRecords.filter((item) => item.costEvents > 0).length,
    },
    products: usedRecords.sort((left, right) => {
      const countDelta = safeNumber(right.totalOccurrences, 0) - safeNumber(left.totalOccurrences, 0);
      if (countDelta !== 0) return countDelta;
      return safeNumber(right.totalCost, 0) - safeNumber(left.totalCost, 0);
    }),
    featuredProducts: buildFeaturedProducts(usedRecords),
    memoryPanels: buildMemoryPanels(usedRecords),
    restockSoon,
    budgetCandidates,
    charts: {
      consumptionShare: buildShareSegments(usedRecords, "totalOccurrences"),
      costShare: buildShareSegments(usedRecords, "totalCost"),
      monthlyTimeline: buildMonthlyTimeline(usedRecords, safeNowIsoDate, 6),
    },
  };
}
