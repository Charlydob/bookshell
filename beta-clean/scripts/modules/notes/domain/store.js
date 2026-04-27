const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "2-digit",
});
const folderInsightsCache = new WeakMap();

function normalizeId(value = "") {
  return String(value || "").trim();
}

function normalizeNoteRating(value = null) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(10, Math.round(numeric)));
}

function normalizeNoteVisitsCount(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.round(numeric));
}

function normalizeVisitTimestamp(value = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function compareText(a = "", b = "") {
  return String(a || "").localeCompare(String(b || ""), "es", { sensitivity: "base" });
}

function compareFolders(a, b) {
  const diff = Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
  if (diff !== 0) return diff;
  return compareText(a?.name, b?.name);
}

function createFolderMap(folders = []) {
  const map = new Map();
  for (const folder of folders) {
    const id = normalizeId(folder?.id);
    if (!id) continue;
    map.set(id, folder);
  }
  return map;
}

function getSafeParentId(folder, folderMap) {
  const folderId = normalizeId(folder?.id);
  const parentId = normalizeId(folder?.parentId);
  if (!parentId || parentId === folderId || !folderMap.has(parentId)) return "";
  return parentId;
}

function buildChildrenMap(folders = [], folderMap = createFolderMap(folders)) {
  const childrenMap = new Map();

  for (const folder of folders) {
    const parentId = getSafeParentId(folder, folderMap);
    const list = childrenMap.get(parentId) || [];
    list.push(folder);
    childrenMap.set(parentId, list);
  }

  for (const list of childrenMap.values()) {
    list.sort(compareFolders);
  }

  return childrenMap;
}

function buildNoteText(note = {}) {
  const parts = [
    String(note?.title || "").trim(),
    String(note?.content || "").trim(),
  ];

  if (note?.type === "link") {
    parts.push(String(note?.url || "").trim());
  }

  return parts.filter(Boolean).join(" ").trim();
}

function buildWordCount(text = "") {
  if (!text) return 0;
  return String(text)
    .split(/\s+/)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .length;
}

function buildMonthKey(timestamp = 0) {
  const safe = Number(timestamp || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "";
  const date = new Date(safe);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  return `${year}-${month}`;
}

function buildMonthLabel(key = "") {
  const [yearRaw, monthRaw] = String(key || "").split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
    return String(key || "");
  }
  return MONTH_FORMATTER.format(new Date(year, month - 1, 1));
}

function percentage(part = 0, total = 0) {
  const safePart = Number(part || 0);
  const safeTotal = Number(total || 0);
  if (!Number.isFinite(safePart) || !Number.isFinite(safeTotal) || safeTotal <= 0) return 0;
  return (safePart / safeTotal) * 100;
}

function compareRecentCreated(a, b) {
  const createdDiff = Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
  if (createdDiff !== 0) return createdDiff;
  const updatedDiff = Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
  if (updatedDiff !== 0) return updatedDiff;
  return compareText(a?.title, b?.title);
}

function compareRecentUpdated(a, b) {
  const updatedDiff = Number(b?.updatedAt || 0) - Number(a?.updatedAt || 0);
  if (updatedDiff !== 0) return updatedDiff;
  const createdDiff = Number(b?.createdAt || 0) - Number(a?.createdAt || 0);
  if (createdDiff !== 0) return createdDiff;
  return compareText(a?.title, b?.title);
}

function compareBestRated(a, b) {
  const ratingDiff = Number(b?.rating ?? -1) - Number(a?.rating ?? -1);
  if (ratingDiff !== 0) return ratingDiff;
  return compareRecentUpdated(a, b);
}

function compareWorstRated(a, b) {
  const ratingDiff = Number(a?.rating ?? 11) - Number(b?.rating ?? 11);
  if (ratingDiff !== 0) return ratingDiff;
  return compareRecentUpdated(a, b);
}

function compareMostVisited(a, b) {
  const visitsDiff = normalizeNoteVisitsCount(b?.visitsCount) - normalizeNoteVisitsCount(a?.visitsCount);
  if (visitsDiff !== 0) return visitsDiff;
  return compareRecentUpdated(a, b);
}

function compareRecentVisited(a, b) {
  const visitedDiff = normalizeVisitTimestamp(b?.lastVisitedAt) - normalizeVisitTimestamp(a?.lastVisitedAt);
  if (visitedDiff !== 0) return visitedDiff;
  return compareMostVisited(a, b);
}

function compareTagUsage(a, b) {
  const countDiff = Number(b?.count || 0) - Number(a?.count || 0);
  if (countDiff !== 0) return countDiff;
  return compareText(a?.label, b?.label);
}

function compareMostTags(a, b) {
  const tagDiff = Number(b?.tagsCount || 0) - Number(a?.tagsCount || 0);
  if (tagDiff !== 0) return tagDiff;
  return compareRecentUpdated(a, b);
}

function compareLongest(a, b) {
  const lengthDiff = Number(b?.characters || 0) - Number(a?.characters || 0);
  if (lengthDiff !== 0) return lengthDiff;
  return compareRecentUpdated(a, b);
}

function compareShortest(a, b) {
  const lengthDiff = Number(a?.characters || 0) - Number(b?.characters || 0);
  if (lengthDiff !== 0) return lengthDiff;
  return compareRecentUpdated(a, b);
}

function buildNoteInsight(note = {}) {
  const text = buildNoteText(note);
  const tags = Array.isArray(note?.tags)
    ? note.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];

  return {
    ...note,
    title: String(note?.title || "").trim(),
    type: note?.type === "link" ? "link" : "note",
    tags,
    tagsCount: tags.length,
    rating: normalizeNoteRating(note?.rating),
    visitsCount: normalizeNoteVisitsCount(note?.visitsCount),
    lastVisitedAt: normalizeVisitTimestamp(note?.lastVisitedAt),
    createdAt: Number(note?.createdAt || 0),
    updatedAt: Number(note?.updatedAt || note?.createdAt || 0),
    words: buildWordCount(text),
    characters: text.length,
  };
}

function createEmptyFolderInsights(folderId = "") {
  return {
    folderId: normalizeId(folderId),
    totalNotes: 0,
    ratedNotesCount: 0,
    unratedNotesCount: 0,
    ratedShare: 0,
    averageRating: null,
    maxRating: null,
    minRating: null,
    ratingDistribution: Array.from({ length: 11 }, (_, index) => ({
      value: 10 - index,
      count: 0,
      percentage: 0,
    })),
    bestRatedNotes: [],
    worstRatedNotes: [],
    topRatedTags: [],
    uniqueTagsCount: 0,
    topTags: [],
    totalTagAssignments: 0,
    notesWithTagsCount: 0,
    notesWithoutTagsCount: 0,
    tagsPerNoteAverage: 0,
    tagsCoverage: 0,
    createdRecently7d: 0,
    createdRecently30d: 0,
    editedRecently30d: 0,
    recentlyCreatedNotes: [],
    recentlyUpdatedNotes: [],
    totalWords: 0,
    totalCharacters: 0,
    averageWords: 0,
    averageCharacters: 0,
    linksCount: 0,
    visitedNotesCount: 0,
    unvisitedLinkNotesCount: 0,
    visitedLinksShare: 0,
    totalVisits: 0,
    mostVisitedNote: null,
    topVisitedNotes: [],
    recentlyVisitedNotes: [],
    notesWithMostTags: [],
    longestNote: null,
    shortestNote: null,
    activityByMonth: [],
  };
}

function computeFolderInsights(notes = [], folderId = "") {
  const safeFolderId = normalizeId(folderId);
  const empty = createEmptyFolderInsights(safeFolderId);
  if (!safeFolderId) return empty;

  const folderNotes = notes
    .filter((note) => normalizeId(note?.folderId) === safeFolderId)
    .map((note) => buildNoteInsight(note));

  if (!folderNotes.length) return empty;

  const totalNotes = folderNotes.length;
  const now = Date.now();
  const ratedNotes = folderNotes.filter((note) => note.rating !== null);
  const linkNotes = folderNotes.filter((note) => note.type === "link");
  const visitedNotes = linkNotes.filter((note) => normalizeNoteVisitsCount(note.visitsCount) > 0);
  const ratedNotesCount = ratedNotes.length;
  const unratedNotesCount = totalNotes - ratedNotesCount;
  const ratingSum = ratedNotes.reduce((sum, note) => sum + Number(note.rating || 0), 0);
  const averageRating = ratedNotesCount ? ratingSum / ratedNotesCount : null;
  const maxRating = ratedNotesCount ? Math.max(...ratedNotes.map((note) => Number(note.rating || 0))) : null;
  const minRating = ratedNotesCount ? Math.min(...ratedNotes.map((note) => Number(note.rating || 0))) : null;
  const totalVisits = linkNotes.reduce((sum, note) => sum + normalizeNoteVisitsCount(note.visitsCount), 0);
  const topVisitedNotes = [...visitedNotes].sort(compareMostVisited).slice(0, 5);
  const mostVisitedNote = topVisitedNotes[0] || null;

  const ratingCountByValue = new Map(Array.from({ length: 11 }, (_, value) => [value, 0]));
  ratedNotes.forEach((note) => {
    const key = Number(note.rating);
    ratingCountByValue.set(key, (ratingCountByValue.get(key) || 0) + 1);
  });

  const ratingDistribution = Array.from({ length: 11 }, (_, index) => {
    const value = 10 - index;
    const count = ratingCountByValue.get(value) || 0;
    return {
      value,
      count,
      percentage: percentage(count, ratedNotesCount),
    };
  });

  const tagUsage = new Map();
  const ratedTagUsage = new Map();
  let totalTagAssignments = 0;

  folderNotes.forEach((note) => {
    totalTagAssignments += Number(note.tagsCount || 0);

    note.tags.forEach((label) => {
      const tagRow = tagUsage.get(label) || { label, count: 0 };
      tagRow.count += 1;
      tagUsage.set(label, tagRow);

      if (note.rating === null) return;
      const ratedRow = ratedTagUsage.get(label) || { label, count: 0, ratingTotal: 0 };
      ratedRow.count += 1;
      ratedRow.ratingTotal += Number(note.rating || 0);
      ratedTagUsage.set(label, ratedRow);
    });
  });

  const notesWithTagsCount = folderNotes.filter((note) => Number(note.tagsCount || 0) > 0).length;
  const monthlyCounts = new Map();

  folderNotes.forEach((note) => {
    const monthKey = buildMonthKey(note.createdAt);
    if (!monthKey) return;
    monthlyCounts.set(monthKey, (monthlyCounts.get(monthKey) || 0) + 1);
  });

  const activityByMonthBase = Array.from(monthlyCounts.entries())
    .sort(([a], [b]) => compareText(a, b))
    .slice(-6)
    .map(([key, count]) => ({
      key,
      label: buildMonthLabel(key),
      count,
    }));
  const maxMonthCount = activityByMonthBase.reduce((max, row) => Math.max(max, Number(row?.count || 0)), 0);

  return {
    folderId: safeFolderId,
    totalNotes,
    ratedNotesCount,
    unratedNotesCount,
    ratedShare: percentage(ratedNotesCount, totalNotes),
    averageRating,
    maxRating,
    minRating,
    ratingDistribution,
    bestRatedNotes: ratedNotes
      .filter((note) => note.rating === maxRating)
      .sort(compareBestRated)
      .slice(0, 3),
    worstRatedNotes: minRating === null || maxRating === null || minRating === maxRating
      ? []
      : ratedNotes
        .filter((note) => note.rating === minRating)
        .sort(compareWorstRated)
        .slice(0, 3),
    topRatedTags: Array.from(ratedTagUsage.values())
      .filter((row) => Number(row?.count || 0) >= 2)
      .map((row) => ({
        label: row.label,
        count: row.count,
        averageRating: row.ratingTotal / row.count,
      }))
      .sort((a, b) => {
        const averageDiff = Number(b?.averageRating || 0) - Number(a?.averageRating || 0);
        if (averageDiff !== 0) return averageDiff;
        return compareTagUsage(a, b);
      })
      .slice(0, 5),
    uniqueTagsCount: tagUsage.size,
    topTags: Array.from(tagUsage.values())
      .map((row) => ({
        label: row.label,
        count: row.count,
        percentage: percentage(row.count, totalNotes),
      }))
      .sort(compareTagUsage)
      .slice(0, 8),
    totalTagAssignments,
    notesWithTagsCount,
    notesWithoutTagsCount: totalNotes - notesWithTagsCount,
    tagsPerNoteAverage: totalNotes ? totalTagAssignments / totalNotes : 0,
    tagsCoverage: percentage(notesWithTagsCount, totalNotes),
    createdRecently7d: folderNotes.filter((note) => note.createdAt > 0 && (now - note.createdAt) <= (7 * DAY_MS)).length,
    createdRecently30d: folderNotes.filter((note) => note.createdAt > 0 && (now - note.createdAt) <= (30 * DAY_MS)).length,
    editedRecently30d: folderNotes.filter((note) => (
      note.updatedAt > note.createdAt
      && note.updatedAt > 0
      && (now - note.updatedAt) <= (30 * DAY_MS)
    )).length,
    recentlyCreatedNotes: [...folderNotes].sort(compareRecentCreated).slice(0, 3),
    recentlyUpdatedNotes: [...folderNotes].sort(compareRecentUpdated).slice(0, 3),
    totalWords: folderNotes.reduce((sum, note) => sum + Number(note.words || 0), 0),
    totalCharacters: folderNotes.reduce((sum, note) => sum + Number(note.characters || 0), 0),
    averageWords: totalNotes
      ? folderNotes.reduce((sum, note) => sum + Number(note.words || 0), 0) / totalNotes
      : 0,
    averageCharacters: totalNotes
      ? folderNotes.reduce((sum, note) => sum + Number(note.characters || 0), 0) / totalNotes
      : 0,
    linksCount: linkNotes.length,
    visitedNotesCount: visitedNotes.length,
    unvisitedLinkNotesCount: Math.max(0, linkNotes.length - visitedNotes.length),
    visitedLinksShare: percentage(visitedNotes.length, linkNotes.length),
    totalVisits,
    mostVisitedNote,
    topVisitedNotes,
    recentlyVisitedNotes: [...visitedNotes].sort(compareRecentVisited).slice(0, 5),
    notesWithMostTags: [...folderNotes]
      .filter((note) => Number(note.tagsCount || 0) > 0)
      .sort(compareMostTags)
      .slice(0, 3),
    longestNote: [...folderNotes].sort(compareLongest)[0] || null,
    shortestNote: [...folderNotes].sort(compareShortest)[0] || null,
    activityByMonth: activityByMonthBase.map((row) => ({
      ...row,
      percentage: percentage(row.count, maxMonthCount),
    })),
  };
}

export function createInitialNotesState() {
  return {
    uid: "",
    rootPath: "",
    folders: [],
    notes: [],
    reminders: [],
    tagDefinitions: {},
    selectedFolderId: "",
    unlockedFolderIds: new Set(),
    folderQuery: "",
    noteQuery: "",
    folderCategoryFilter: "",
    folderTagsFilter: "",
    noteCategoryFilter: "",
    noteTagsFilter: "",
    noteSort: "updated",
    rootSection: "notes",
    reminderFilter: "all",
    reminderCollapsedHistory: true,
    folderView: "main",
    loading: true,
  };
}

export function buildFolderStats(folders = [], notes = []) {
  const folderMap = createFolderMap(folders);
  const noteCountByFolder = new Map();
  const childCountByFolder = new Map();

  for (const note of notes) {
    const folderId = normalizeId(note?.folderId);
    if (!folderId || !folderMap.has(folderId)) continue;
    noteCountByFolder.set(folderId, (noteCountByFolder.get(folderId) || 0) + 1);
  }

  for (const folder of folders) {
    const parentId = getSafeParentId(folder, folderMap);
    if (!parentId) continue;
    childCountByFolder.set(parentId, (childCountByFolder.get(parentId) || 0) + 1);
  }

  return [...folders]
    .sort(compareFolders)
    .map((folder) => ({
      ...folder,
      parentId: getSafeParentId(folder, folderMap),
      notesCount: noteCountByFolder.get(folder.id) || 0,
      childFoldersCount: childCountByFolder.get(folder.id) || 0,
    }));
}

export function buildFolderInsights(notes = [], folderId = "") {
  const safeFolderId = normalizeId(folderId);
  if (!safeFolderId) return createEmptyFolderInsights("");

  if (!Array.isArray(notes)) {
    return computeFolderInsights([], safeFolderId);
  }

  let cacheByFolder = folderInsightsCache.get(notes);
  if (!cacheByFolder) {
    cacheByFolder = new Map();
    folderInsightsCache.set(notes, cacheByFolder);
  }

  if (cacheByFolder.has(safeFolderId)) {
    return cacheByFolder.get(safeFolderId);
  }

  const insights = computeFolderInsights(notes, safeFolderId);
  cacheByFolder.set(safeFolderId, insights);
  return insights;
}

export function getChildFolders(folders = [], parentId = "") {
  const safeParentId = normalizeId(parentId);
  const folderMap = createFolderMap(folders);
  return [...folders]
    .filter((folder) => getSafeParentId(folder, folderMap) === safeParentId)
    .sort(compareFolders);
}

export function getFolderPath(folders = [], folderId = "") {
  const safeFolderId = normalizeId(folderId);
  if (!safeFolderId) return [];

  const folderMap = createFolderMap(folders);
  const path = [];
  const seen = new Set();
  let currentId = safeFolderId;

  while (currentId && folderMap.has(currentId) && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = folderMap.get(currentId);
    path.unshift({
      ...folder,
      parentId: getSafeParentId(folder, folderMap),
    });
    currentId = getSafeParentId(folder, folderMap);
  }

  return path;
}

export function isFolderDescendant(folders = [], folderId = "", ancestorId = "") {
  const safeFolderId = normalizeId(folderId);
  const safeAncestorId = normalizeId(ancestorId);
  if (!safeFolderId || !safeAncestorId || safeFolderId === safeAncestorId) return false;

  const folderMap = createFolderMap(folders);
  const seen = new Set();
  let currentId = safeFolderId;

  while (currentId && folderMap.has(currentId) && !seen.has(currentId)) {
    seen.add(currentId);
    const folder = folderMap.get(currentId);
    const parentId = getSafeParentId(folder, folderMap);
    if (!parentId) return false;
    if (parentId === safeAncestorId) return true;
    currentId = parentId;
  }

  return false;
}

export function isFolderParentAllowed(folders = [], folderId = "", parentId = "") {
  const safeFolderId = normalizeId(folderId);
  const safeParentId = normalizeId(parentId);
  if (!safeParentId) return true;
  if (!safeFolderId) return true;
  if (safeParentId === safeFolderId) return false;
  return !isFolderDescendant(folders, safeParentId, safeFolderId);
}

export function buildFolderOptions(
  folders = [],
  {
    excludeId = "",
    excludeDescendantsOf = "",
  } = {},
) {
  const safeExcludeId = normalizeId(excludeId);
  const safeExcludeDescendantsOf = normalizeId(excludeDescendantsOf || excludeId);
  const folderMap = createFolderMap(folders);
  const childrenMap = buildChildrenMap(folders, folderMap);
  const visited = new Set();
  const options = [];

  const shouldSkip = (folder) => {
    const folderId = normalizeId(folder?.id);
    if (!folderId) return true;
    if (safeExcludeId && folderId === safeExcludeId) return true;
    if (safeExcludeDescendantsOf && isFolderDescendant(folders, folderId, safeExcludeDescendantsOf)) return true;
    return false;
  };

  const visit = (parentId = "", path = []) => {
    const siblings = childrenMap.get(parentId) || [];
    for (const folder of siblings) {
      const folderId = normalizeId(folder?.id);
      if (!folderId || visited.has(folderId) || shouldSkip(folder)) continue;
      visited.add(folderId);
      const labelParts = [...path, String(folder?.name || "Sin nombre").trim() || "Sin nombre"];
      options.push({
        id: folderId,
        label: labelParts.join(" / "),
        depth: Math.max(0, labelParts.length - 1),
        folder,
      });
      visit(folderId, labelParts);
    }
  };

  visit("");

  for (const folder of [...folders].sort(compareFolders)) {
    const folderId = normalizeId(folder?.id);
    if (!folderId || visited.has(folderId) || shouldSkip(folder)) continue;
    const label = String(folder?.name || "Sin nombre").trim() || "Sin nombre";
    visited.add(folderId);
    options.push({
      id: folderId,
      label,
      depth: 0,
      folder,
    });
    visit(folderId, [label]);
  }

  return options;
}

export function filterFolders(folders = [], query = "", category = "", tags = "") {
  const safeQuery = String(query || "").trim().toLowerCase();
  const safeCategory = String(category || "").trim().toLowerCase();
  const safeTags = String(tags || "").trim().toLowerCase();

  return folders.filter((folder) => {
    const folderName = String(folder.name || "").toLowerCase();
    const folderCategory = String(folder.category || "").toLowerCase();
    const folderTags = (folder.tags || []).map((tag) => String(tag).toLowerCase());

    if (safeQuery && !folderName.includes(safeQuery)) return false;
    if (safeCategory && folderCategory !== safeCategory) return false;
    if (safeTags && !folderTags.includes(safeTags)) return false;

    return true;
  });
}

export function filterNotesByFolder(notes = [], folderId = "", query = "", category = "", tags = "") {
  const safeFolderId = normalizeId(folderId);
  if (!safeFolderId) return [];

  const safeQuery = String(query || "").trim().toLowerCase();
  const safeCategory = String(category || "").trim().toLowerCase();
  const safeTags = String(tags || "").trim().toLowerCase();

  const byFolder = notes.filter((note) => normalizeId(note?.folderId) === safeFolderId);

  return byFolder.filter((note) => {
    if (safeQuery) {
      const title = String(note.title || "").toLowerCase();
      const content = String(note.content || "").toLowerCase();
      const url = String(note.url || "").toLowerCase();
      if (!title.includes(safeQuery) && !content.includes(safeQuery) && !url.includes(safeQuery)) {
        return false;
      }
    }

    if (safeCategory && String(note.category || "").toLowerCase() !== safeCategory) return false;
    if (safeTags && !(note.tags || []).map((tag) => String(tag).toLowerCase()).includes(safeTags)) return false;

    return true;
  });
}

export function sortNotes(notes = [], sortBy = "updated") {
  const safeSort = String(sortBy || "").trim();
  const list = Array.isArray(notes) ? [...notes] : [];

  if (safeSort === "rating") {
    return list.sort(compareBestRated);
  }

  if (safeSort === "visits") {
    return list.sort(compareMostVisited);
  }

  return list.sort(compareRecentUpdated);
}
