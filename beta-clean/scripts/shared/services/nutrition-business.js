/* Native nutrition consumption calculations, units and side effects; no IO. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.BookshellNutrition=api;})(globalThis,function(){
'use strict';
const mealOrder=['breakfast','lunch','dinner','snacks'];
function normalizeUnit(v){return normalizeCostUnit(v);}
function normalizeMacros(macros = {}) {
    return {
      carbs: Number(macros.carbs) || 0,
      protein: Number(macros.protein) || 0,
      fat: Number(macros.fat) || 0,
      kcal: Number(macros.kcal) || 0,
    };
  }
function calcProductMacros(product, grams = 0) {
    const p = product || {};
    const base = Math.max(1, Number(p.servingBaseGrams) || 100);
    const ratio = Math.max(0, Number(grams) || 0) / base;
    return {
      carbs: (Number(p.macros?.carbs) || 0) * ratio,
      protein: (Number(p.macros?.protein) || 0) * ratio,
      fat: (Number(p.macros?.fat) || 0) * ratio,
      kcal: (Number(p.macros?.kcal) || 0) * ratio,
    };
  }
function normalizeCostUnit(unit) {
    const clean = String(unit || "").trim().toLowerCase();
    if (["g", "gram", "grams", "gr"].includes(clean)) return "g";
    if (["kg", "kilo", "kilogram", "kilograms"].includes(clean)) return "kg";
    if (["ml", "milliliter", "milliliters"].includes(clean)) return "ml";
    if (["l", "lt", "liter", "liters"].includes(clean)) return "l";
    if (["unit", "units", "ud", "uds", "unidad", "unidades"].includes(clean)) return "unit";
    return "";
  }
function normalizeQtyByUnit(quantity, fromUnit, toUnit) {
    const qty = Number(quantity);
    const from = normalizeCostUnit(fromUnit);
    const to = normalizeCostUnit(toUnit);
    if (!Number.isFinite(qty) || qty < 0 || !from || !to) return null;
    if (from === to) return qty;
    if (from === "kg" && to === "g") return qty * 1000;
    if (from === "g" && to === "kg") return qty / 1000;
    if (from === "l" && to === "ml") return qty * 1000;
    if (from === "ml" && to === "l") return qty / 1000;
    return null;
  }
function resolveUnitWeightSpec(product) {
    if (!product) return null;
    const qty = Number(product?.unitWeightQty);
    const unit = normalizeCostUnit(product?.unitWeightUnit);
    if (!(qty > 0) || !unit) return null;
    return { qty, unit };
  }
function convertQtyByUnitWithUnitWeight(quantity, fromUnit, toUnit, unitWeightSpec = null) {
    const basic = normalizeQtyByUnit(quantity, fromUnit, toUnit);
    if (basic != null) return basic;

    const qty = Number(quantity);
    const from = normalizeCostUnit(fromUnit);
    const to = normalizeCostUnit(toUnit);
    if (!Number.isFinite(qty) || qty < 0 || !from || !to) return null;

    if (!unitWeightSpec || !(Number(unitWeightSpec.qty) > 0) || !normalizeCostUnit(unitWeightSpec.unit)) return null;
    const perUnitQty = Number(unitWeightSpec.qty);
    const perUnitUnit = normalizeCostUnit(unitWeightSpec.unit);

    if (from === "unit") {
      const perUnitInTarget = normalizeQtyByUnit(perUnitQty, perUnitUnit, to);
      if (!(perUnitInTarget >= 0)) return null;
      return qty * perUnitInTarget;
    }

    if (to === "unit") {
      const perUnitInFrom = normalizeQtyByUnit(perUnitQty, perUnitUnit, from);
      if (!(perUnitInFrom > 0)) return null;
      return qty / perUnitInFrom;
    }

    return null;
  }
function convertAmountWithProduct(product, value, fromUnit, toUnit) {
    return convertQtyByUnitWithUnitWeight(value, fromUnit, toUnit, resolveUnitWeightSpec(product));
  }

function knownMacros(macros,ratio=1){return Object.fromEntries(['carbs','protein','fat','kcal'].map(k=>[k,typeof macros?.[k]==='number'&&Number.isFinite(macros[k])&&macros[k]>=0?macros[k]*ratio:null]));}
function preserveEntryMacros(entry){const values=entry?.macrosSnapshot||entry?.macros||entry?.macroSnapshot||{};return entry?.missingMacros?.length?Object.fromEntries(Object.entries(knownMacros(values)).map(([k,v])=>[k,entry.missingMacros.includes(k)?null:v])):normalizeMacros(values);}
function context(nutritionProducts=[],financeProducts=[],generateId=()=>globalThis.crypto.randomUUID(),now=Date.now()){
function resolveProductPackageSpec(product) {
    const directAmount = Number(product?.packageAmount);
    const directUnit = normalizeCostUnit(product?.packageUnit);
    if (directAmount > 0 && directUnit) return { amount: directAmount, unit: directUnit };

    const legacyAmount = Number(product?.priceBaseQty);
    const legacyUnit = normalizeCostUnit(product?.priceBaseUnit);
    if (legacyAmount > 0 && legacyUnit) return { amount: legacyAmount, unit: legacyUnit };

    return { amount: null, unit: "" };
  }
function findLinkedFinanceProduct(product) {
    const financeProductId = String(product?.financeProductId || "").trim();
    if (!financeProductId) return null;
    return financeProducts.find((row) => row.id === financeProductId) || null;
  }
function getEffectiveProductPrice(product) {
    const linked = findLinkedFinanceProduct(product);
    const financePrice = Number(linked?.lastPrice);
    if (financePrice > 0) return financePrice;
    const manualPrice = Number(product?.price);
    if (manualPrice > 0) return manualPrice;
    return null;
  }
function getEffectiveProductPriceSource(product) {
    const linked = findLinkedFinanceProduct(product);
    const financePrice = Number(linked?.lastPrice);
    if (financePrice > 0) return "finance-linked-last-price";
    const manualPrice = Number(product?.price);
    if (manualPrice > 0) return "manual-price";
    return null;
  }
function resolveProductPriceBase(product) {
    const pkg = resolveProductPackageSpec(product);
    if (pkg.amount > 0 && pkg.unit) return { qty: pkg.amount, unit: pkg.unit };
    const baseQty = Number(product?.baseQuantity || product?.servingBaseGrams);
    const baseUnit = normalizeUnit(product?.baseUnit || product?.servingBaseUnit || "");
    if (baseQty > 0 && baseUnit) {
      return { qty: baseQty, unit: baseUnit };
    }
    const legacyBaseGrams = Number(product?.servingBaseGrams);
    if (legacyBaseGrams > 0) {
      return { qty: legacyBaseGrams, unit: "g" };
    }
    return null;
  }
function buildNutritionSnapshot(product) {
    if (!product) return null;
    return {
      productId: String(product.id || "").trim(),
      servingBaseQty: Math.max(1, Number(product.baseQuantity || product.servingBaseGrams) || 100),
      servingBaseUnit: normalizeUnit(product.baseUnit || product.servingBaseUnit || "g") || "g",
      macrosPerBase: normalizeMacros(product.macros || {}),
      unitWeightQty: Number(product?.unitWeightQty) > 0 ? Number(product.unitWeightQty) : null,
      unitWeightUnit: normalizeCostUnit(product?.unitWeightUnit || ""),
    };
  }
function buildPricingSnapshot(product) {
    if (!product) return null;
    const base = resolveProductPriceBase(product);
    const effectivePrice = getEffectiveProductPrice(product);
    if (!base && !(effectivePrice > 0)) return null;
    return {
      productId: String(product.id || "").trim(),
      linkedFinanceProductId: String(product.financeProductId || "").trim(),
      priceSource: getEffectiveProductPriceSource(product),
      price: effectivePrice,
      baseQty: Number(base?.qty) > 0 ? Number(base.qty) : null,
      baseUnit: normalizeCostUnit(base?.unit || ""),
      unitWeightQty: Number(product?.unitWeightQty) > 0 ? Number(product.unitWeightQty) : null,
      unitWeightUnit: normalizeCostUnit(product?.unitWeightUnit || ""),
    };
  }
function calculateProductConsumedCost(product, consumedQty, consumedUnit) {
    const effectivePrice = getEffectiveProductPrice(product);
    const intakeUnit = normalizeCostUnit(consumedUnit);
    const intakeQty = Number(consumedQty);
    const base = resolveProductPriceBase(product);
    if (!(effectivePrice > 0) || !base || !(intakeQty >= 0) || !intakeUnit) return null;
    const unitWeightSpec = resolveUnitWeightSpec(product);
    const intakeInBaseUnit = convertQtyByUnitWithUnitWeight(intakeQty, intakeUnit, base.unit, unitWeightSpec);
    if (!(intakeInBaseUnit >= 0) || !(Number(base.qty) > 0)) return null;
    return (intakeInBaseUnit / Number(base.qty)) * effectivePrice;
  }
function computeConsumptionEntryCost(product, amount, unit) {
    const cost = calculateProductConsumedCost(product, amount, unit);
    if (!(Number.isFinite(Number(cost)) && Number(cost) >= 0)) {
      return { computedCost: null, costSource: null, pricingSnapshot: buildPricingSnapshot(product) || null };
    }
    const costSource = getEffectiveProductPriceSource(product) || "snapshot";
    return {
      computedCost: Number(cost),
      costSource,
      pricingSnapshot: {
        ...(buildPricingSnapshot(product) || {}),
        computedCost: Number(cost),
      },
    };
  }
function buildConsumptionEntryFromEditor({ product, amount, unit, meal }) {
    const safeAmount = Math.max(0, Number(amount) || 0);
    const safeUnit = normalizeUnit(unit || product?.baseUnit || "g") || "g";
    const safeMeal = mealOrder.includes(meal) ? meal : "breakfast";
    const baseUnit = normalizeUnit(product?.baseUnit || product?.servingBaseUnit || "g") || "g";
    const normalizedAmount = convertAmountWithProduct(product, safeAmount, safeUnit, baseUnit);
    const macrosSnapshot = normalizedAmount == null
      ? normalizeMacros({})
      : normalizeMacros(calcProductMacros({ ...product, servingBaseGrams: Number(product?.baseQuantity || product?.servingBaseGrams) || 100 }, normalizedAmount));
    const cost = computeConsumptionEntryCost(product, safeAmount, safeUnit);
    const linkedHabitId = String(product?.linkedHabitId || "").trim();
    return {
      entryId: generateId(),
      type: "product",
      mealSlot: safeMeal,
      refId: String(product?.id || "").trim(),
      productId: String(product?.id || "").trim(),
      productName: String(product?.name || "").trim(),
      nameSnapshot: String(product?.name || "").trim(),
      emoji: String(product?.emoji || "").trim().substring(0, 2),
      grams: convertAmountWithProduct(product, safeAmount, safeUnit, "g") ?? 0,
      amount: safeAmount,
      unit: safeUnit,
      amountUnit: safeUnit,
      detectedUnitType: product?.detectedUnitType || (["ml", "l"].includes(baseUnit) ? "volume" : "mass"),
      linkedFinanceProductId: String(product?.financeProductId || "").trim(),
      linkedHabitId,
      habitSync: {
        habitId: linkedHabitId,
        amount: linkedHabitId ? 1 : 0,
      },
      nutritionSnapshot: buildNutritionSnapshot(product) || null,
      pricingSnapshot: cost.pricingSnapshot,
      priceSource: getEffectiveProductPriceSource(product) || null,
      costSource: cost.costSource,
      computedCost: Number.isFinite(Number(cost.computedCost)) ? Number(cost.computedCost) : null,
      macrosSnapshot,
      servingsCount: 1,
      sideEffects: {
        habits: linkedHabitId ? [{ habitId: linkedHabitId, amount: 1 }] : [],
        financeCost: Number.isFinite(Number(cost.computedCost)) ? Number(cost.computedCost) : 0,
        productsResolved: 1,
        productsTotal: 1,
      },
      createdAt: now,
    };
  }
function buildProductSideEffects(product, quantityFactor = 1) {
    const safeFactor = Math.max(0, Number(quantityFactor) || 0);
    const habitId = String(product?.linkedHabitId || "").trim();
    const habits = habitId ? [{ habitId, amount: safeFactor }] : [];
    let financeCost = 0;
    if (String(product?.financeProductId || "").trim()) {
      const fin = financeProducts.find((f) => f.id === String(product.financeProductId || "").trim());
      const price = Number(fin?.lastPrice) || 0;
      financeCost = price > 0 ? price * safeFactor : 0;
    }
    return { habits, financeCost };
  }
function buildRecipeSideEffects(recipe, servings = 1) {
    const safeServings = Math.max(0, Number(servings) || 0);
    const ingredients = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    const summary = { habits: [], financeCost: 0, productsResolved: 0, productsTotal: ingredients.length };
    ingredients.forEach((ing) => {
      const linked = nutritionProducts.find((p) => p.id === ing?.productId);
      const ingredientLinkedHabitId = String(ing?.linkedHabitId || "").trim();
      if (!linked) {
        if (ingredientLinkedHabitId) summary.habits.push({ habitId: ingredientLinkedHabitId, amount: safeServings });
        return;
      }
      summary.productsResolved += 1;
      const productFx = buildProductSideEffects(linked, safeServings);
      summary.financeCost += Number(productFx.financeCost) || 0;
      productFx.habits.forEach((h) => summary.habits.push({ ...h }));
      if (!productFx.habits.length && ingredientLinkedHabitId) {
        summary.habits.push({ habitId: ingredientLinkedHabitId, amount: safeServings });
      }
    });
    return summary;
  }

return {productEntry:buildConsumptionEntryFromEditor,productEffects:buildProductSideEffects,recipeEffects:buildRecipeSideEffects,pricing:computeConsumptionEntryCost,nutritionSnapshot:buildNutritionSnapshot};
}
function recipeEntry(recipe,servings,meal,{id,now,computedCost,sideEffects}){
 const base=recipe.nutritionPerServing||Object.fromEntries(Object.entries(recipe.nutritionTotals||{}).map(([k,v])=>[k,v/(Number(recipe.servings)||1)]));
 const entry={entryId:id,type:'recipe',mealSlot:meal,refId:recipe.id,nameSnapshot:recipe.title,servings,servingsCount:1,macrosSnapshot:knownMacros(base,servings),computedCost,sideEffects,recipeSnapshot:structuredClone(recipe),ingredientsSnapshot:Array.isArray(recipe.ingredients)?structuredClone(recipe.ingredients):[],expanded:false,createdAt:now};
 entry.missingMacros=Object.entries(entry.macrosSnapshot).filter(([,v])=>v===null).map(([k])=>k);return entry;
}
function habitDeltas(entry,direction=1){return (entry?.sideEffects?.habits?.length?entry.sideEffects.habits:entry?.habitSync?.habitId?[{habitId:entry.habitSync.habitId,amount:entry.habitSync.amount}]:[]).map(h=>({habitId:h.habitId,delta:direction*Math.round(Number(h.amount||0)*Number(entry.servingsCount||1))})).filter(h=>h.habitId&&h.delta);}
return {context,normalizeUnit,convertAmountWithProduct,calcProductMacros,knownMacros,preserveEntryMacros,recipeEntry,habitDeltas};
});
