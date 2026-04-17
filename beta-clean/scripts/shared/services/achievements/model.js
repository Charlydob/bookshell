import {
  buildAchievementDefinitions,
  getAchievementMedalTiers,
  getAchievementModuleMeta,
} from "./catalog.js";

const NEARBY_LIMIT = 5;
const VISIBLE_TIERS_BEFORE = 1;
const VISIBLE_TIERS_AFTER = 3;

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, value));
}

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getTierMeta(levelIndex = 0) {
  const tiers = getAchievementMedalTiers();
  if (levelIndex <= 0) return tiers[0];
  const normalizedIndex = Math.min(levelIndex, tiers.length - 1);
  return tiers[normalizedIndex] || tiers[tiers.length - 1];
}

function getReachedLevelIndex(currentValue = 0, thresholds = []) {
  let levelIndex = 0;
  thresholds.forEach((threshold, index) => {
    if (currentValue >= threshold) levelIndex = index + 1;
  });
  return levelIndex;
}

function getVisibleTierSlice(thresholds = [], displayLevelIndex = 0) {
  if (!thresholds.length) return [];
  const activeIndex = Math.max(0, displayLevelIndex);
  const start = Math.max(0, activeIndex - VISIBLE_TIERS_BEFORE);
  const end = Math.min(thresholds.length, Math.max(activeIndex + VISIBLE_TIERS_AFTER, 4));
  return thresholds.slice(start, end).map((threshold, offset) => ({
    threshold,
    index: start + offset,
  }));
}

function buildVisibleTiers(panel) {
  const nextIndex = Math.min(panel.displayLevelIndex + 1, panel.thresholds.length - 1);
  return getVisibleTierSlice(panel.thresholds, nextIndex).map(({ threshold, index }) => {
    const tierIndex = index + 1;
    let state = "locked";
    if (tierIndex <= panel.displayLevelIndex) state = "completed";
    else if (tierIndex === panel.displayLevelIndex + 1) state = "next";
    return {
      threshold,
      tierIndex,
      state,
      tier: getTierMeta(tierIndex),
      label: panel.formatValue(threshold),
    };
  });
}

function getPanelTone(panel) {
  if (panel.isMaxed) return "maxed";
  if (panel.isNear) return "near";
  if (panel.displayLevelIndex > 0) return "earned";
  return "idle";
}

function getSortScore(panel) {
  if (panel.isNear) return 0;
  if (panel.displayLevelIndex > 0 && !panel.isMaxed) return 1;
  if (panel.currentValue > 0) return 2;
  return 3;
}

function comparePanels(a, b) {
  if (a.sortScore !== b.sortScore) return a.sortScore - b.sortScore;
  if (Math.abs(b.progressToNext - a.progressToNext) > 0.0001) return b.progressToNext - a.progressToNext;
  if (a.remainingToNext !== b.remainingToNext) return a.remainingToNext - b.remainingToNext;
  if (b.displayLevelIndex !== a.displayLevelIndex) return b.displayLevelIndex - a.displayLevelIndex;
  if (a.priority !== b.priority) return a.priority - b.priority;
  if (b.currentValue !== a.currentValue) return b.currentValue - a.currentValue;
  return String(a.title || "").localeCompare(String(b.title || ""), "es");
}

function buildPanel(definition, persistedPanels = {}) {
  const currentValue = Math.max(0, toNumber(definition.getValue?.() || 0));
  const thresholds = Array.isArray(definition.thresholds) ? definition.thresholds : [];
  const remoteRecord = persistedPanels?.[definition.id] || null;
  const storedRemoteLevelIndex = Math.max(0, toNumber(remoteRecord?.levelIndex || 0));
  const reachedLevelIndex = getReachedLevelIndex(currentValue, thresholds);
  const displayLevelIndex = Math.max(storedRemoteLevelIndex, reachedLevelIndex);
  const nextThreshold = thresholds[displayLevelIndex] || 0;
  const currentThreshold = displayLevelIndex > 0 ? thresholds[displayLevelIndex - 1] || 0 : 0;
  const remainingToNext = nextThreshold ? Math.max(0, nextThreshold - currentValue) : 0;
  const progressSpan = Math.max(1, nextThreshold - currentThreshold);
  const progressToNext = nextThreshold
    ? clamp((currentValue - currentThreshold) / progressSpan)
    : 1;
  const isMaxed = thresholds.length > 0 && displayLevelIndex >= thresholds.length;
  const isNear = !isMaxed && currentValue > 0 && progressToNext >= 0.72;
  const unlockedAt = displayLevelIndex > 0
    ? Math.max(0, toNumber(remoteRecord?.unlockedAt || 0))
    : 0;

  const panel = {
    ...definition,
    currentValue,
    formattedCurrentValue: definition.formatValue(currentValue),
    thresholds,
    storedRemoteLevelIndex,
    currentReachedLevelIndex: reachedLevelIndex,
    displayLevelIndex,
    currentTier: getTierMeta(displayLevelIndex),
    nextTier: nextThreshold ? getTierMeta(displayLevelIndex + 1) : null,
    currentThreshold,
    nextThreshold,
    formattedCurrentThreshold: currentThreshold ? definition.formatValue(currentThreshold) : "",
    formattedNextThreshold: nextThreshold ? definition.formatValue(nextThreshold) : "",
    remainingToNext,
    formattedRemainingToNext: remainingToNext ? definition.formatValue(remainingToNext) : "",
    progressToNext,
    isMaxed,
    isNear,
    unlockedAt,
    pendingLevelIndex: Math.max(storedRemoteLevelIndex, reachedLevelIndex),
    shouldToastLevelIndex: reachedLevelIndex > storedRemoteLevelIndex ? reachedLevelIndex : 0,
  };

  panel.visibleTiers = buildVisibleTiers(panel);
  panel.sortScore = getSortScore(panel);
  panel.tone = getPanelTone(panel);
  panel.moduleMeta = getAchievementModuleMeta(panel.module);
  return panel;
}

function buildGroup(moduleKey, panels = []) {
  const sortedPanels = [...panels].sort(comparePanels);
  const unlockedPanels = sortedPanels.filter((panel) => panel.displayLevelIndex > 0);
  const maxedPanels = sortedPanels.filter((panel) => panel.isMaxed);
  const nearPanels = sortedPanels.filter((panel) => panel.isNear);
  const completionRatio = sortedPanels.length ? unlockedPanels.length / sortedPanels.length : 0;
  const focusPanel = sortedPanels[0] || null;
  return {
    module: moduleKey,
    meta: getAchievementModuleMeta(moduleKey),
    panels: sortedPanels,
    focusPanel,
    nearbyPanels: nearPanels.slice(0, 3),
    counts: {
      total: sortedPanels.length,
      unlocked: unlockedPanels.length,
      maxed: maxedPanels.length,
      near: nearPanels.length,
    },
    completionRatio,
  };
}

export function buildAchievementsModel({
  context = {},
  persistedPanels = {},
} = {}) {
  const definitions = buildAchievementDefinitions(context, persistedPanels);
  const panels = definitions
    .map((definition) => buildPanel(definition, persistedPanels))
    .filter((panel) => panel.currentValue > 0 || panel.displayLevelIndex > 0)
    .sort(comparePanels);

  const panelsById = Object.fromEntries(panels.map((panel) => [panel.id, panel]));
  const grouped = panels.reduce((acc, panel) => {
    if (!acc[panel.module]) acc[panel.module] = [];
    acc[panel.module].push(panel);
    return acc;
  }, {});

  const groupOrder = [
    "general",
    "books",
    "media",
    "habits",
    "recipes",
    "gym",
    "finance",
    "notes",
    "videos",
  ];

  const groups = groupOrder
    .filter((moduleKey) => Array.isArray(grouped[moduleKey]) && grouped[moduleKey].length)
    .map((moduleKey) => buildGroup(moduleKey, grouped[moduleKey]));

  const nearbyPanels = panels
    .filter((panel) => !panel.isMaxed && panel.currentValue > 0)
    .sort(comparePanels)
    .slice(0, NEARBY_LIMIT);

  return {
    panels,
    panelsById,
    groups,
    groupsByModule: Object.fromEntries(groups.map((group) => [group.module, group])),
    nearbyPanels,
    summary: {
      totalPanels: panels.length,
      unlockedPanels: panels.filter((panel) => panel.displayLevelIndex > 0).length,
      maxedPanels: panels.filter((panel) => panel.isMaxed).length,
      nearPanels: panels.filter((panel) => panel.isNear).length,
    },
  };
}

export function createPanelPersistenceRecord(panel) {
  const levelIndex = Math.max(0, toNumber(panel?.pendingLevelIndex || 0));
  const threshold = levelIndex > 0 ? toNumber(panel?.thresholds?.[levelIndex - 1] || 0) : 0;
  return {
    panelId: String(panel?.id || "").trim(),
    module: String(panel?.module || "general").trim(),
    levelIndex,
    tierKey: getTierMeta(levelIndex).key,
    threshold,
    unlockedAt: Number(panel?.unlockedAt || Date.now()) || Date.now(),
    updatedAt: Date.now(),
  };
}
