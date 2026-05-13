import { getCountryEnglishName, normalizeCountryInput } from "../../books/countries.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "short",
  year: "2-digit",
});
const folderInsightsCache = new WeakMap();
const NATIONALITY_ALIAS_TO_COUNTRY = new Map([
  ["espanola", "Spain"],
  ["española", "Spain"],
  ["espanol", "Spain"],
  ["español", "Spain"],
  ["spanish", "Spain"],
  ["frances", "France"],
  ["francés", "France"],
  ["francesa", "France"],
  ["french", "France"],
  ["ingles", "United Kingdom"],
  ["inglés", "United Kingdom"],
  ["inglesa", "United Kingdom"],
  ["british", "United Kingdom"],
  ["estadounidense", "United States"],
  ["americano", "United States"],
  ["americana", "United States"],
  ["american", "United States"],
  ["mexicano", "Mexico"],
  ["mexicana", "Mexico"],
  ["mexican", "Mexico"],
  ["argentino", "Argentina"],
  ["argentina", "Argentina"],
  ["argentine", "Argentina"],
  ["colombiano", "Colombia"],
  ["colombiana", "Colombia"],
  ["colombian", "Colombia"],
  ["brasileno", "Brazil"],
  ["brasileño", "Brazil"],
  ["brasilena", "Brazil"],
  ["brasileña", "Brazil"],
  ["brazilian", "Brazil"],
  ["portugues", "Portugal"],
  ["portugués", "Portugal"],
  ["portuguesa", "Portugal"],
  ["portuguese", "Portugal"],
  ["italiano", "Italy"],
  ["italiana", "Italy"],
  ["italian", "Italy"],
  ["aleman", "Germany"],
  ["alemán", "Germany"],
  ["alemana", "Germany"],
  ["german", "Germany"],
  ["holandes", "Netherlands"],
  ["holandés", "Netherlands"],
  ["holandesa", "Netherlands"],
  ["dutch", "Netherlands"],
  ["belga", "Belgium"],
  ["belgian", "Belgium"],
  ["suizo", "Switzerland"],
  ["suiza", "Switzerland"],
  ["swiss", "Switzerland"],
  ["austriaco", "Austria"],
  ["austriaca", "Austria"],
  ["austrian", "Austria"],
  ["irlandes", "Ireland"],
  ["irlandés", "Ireland"],
  ["irlandesa", "Ireland"],
  ["irish", "Ireland"],
  ["polaco", "Poland"],
  ["polaca", "Poland"],
  ["polish", "Poland"],
  ["rumano", "Romania"],
  ["rumana", "Romania"],
  ["romanian", "Romania"],
  ["ucraniano", "Ukraine"],
  ["ucraniana", "Ukraine"],
  ["ukrainian", "Ukraine"],
  ["ruso", "Russia"],
  ["rusa", "Russia"],
  ["russian", "Russia"],
  ["chino", "China"],
  ["china", "China"],
  ["chinese", "China"],
  ["japones", "Japan"],
  ["japonés", "Japan"],
  ["japonesa", "Japan"],
  ["japanese", "Japan"],
  ["coreano", "South Korea"],
  ["coreana", "South Korea"],
  ["korean", "South Korea"],
  ["indio", "India"],
  ["india", "India"],
  ["indian", "India"],
  ["marroqui", "Morocco"],
  ["marroquí", "Morocco"],
  ["moroccan", "Morocco"],
  ["egipcio", "Egypt"],
  ["egipcia", "Egypt"],
  ["egyptian", "Egypt"],
  ["sudafricano", "South Africa"],
  ["sudafricana", "South Africa"],
  ["south african", "South Africa"],
  ["australiano", "Australia"],
  ["australiana", "Australia"],
  ["australian", "Australia"],
  ["canadiense", "Canada"],
  ["canadian", "Canada"],
]);

function normalizeId(value = "") {
  return String(value || "").trim();
}

function normalizeNoteTextValue(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeNoteKind(value = "") {
  return String(value || "").trim().toLocaleLowerCase("es");
}

function normalizeNationalityKey(value = "") {
  return normalizeNoteTextValue(value).toLocaleLowerCase("es");
}

function normalizeLookupKey(value = "") {
  return normalizeNoteTextValue(value)
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
}

function formatNationalityLabel(value = "") {
  const safe = normalizeNoteTextValue(value);
  if (!safe) return "";
  return safe.charAt(0).toLocaleUpperCase("es") + safe.slice(1);
}

function normalizeNationalityCountry(value = "") {
  const safe = normalizeNoteTextValue(value);
  if (!safe) return null;

  const direct = normalizeCountryInput(safe);
  if (direct?.code) {
    return {
      code: direct.code,
      label: direct.name || safe,
      mapName: getCountryEnglishName(direct.code) || direct.name || safe,
      source: "country",
    };
  }

  const aliasCountry = NATIONALITY_ALIAS_TO_COUNTRY.get(normalizeLookupKey(safe));
  if (!aliasCountry) return null;

  const fromAlias = normalizeCountryInput(aliasCountry);
  if (!fromAlias?.code) return null;

  return {
    code: fromAlias.code,
    label: fromAlias.name || safe,
    mapName: getCountryEnglishName(fromAlias.code) || fromAlias.name || safe,
    source: "alias",
  };
}

function splitLegacyPersonName(title = "") {
  const normalized = normalizeNoteTextValue(title);
  if (!normalized) return { firstName: "", lastName: "" };
  const parts = normalized.split(" ");
  return {
    firstName: parts[0] || "",
    lastName: parts.slice(1).join(" "),
  };
}

function getNotePersonFields(note = {}) {
  const fallbackTitle = normalizeNoteTextValue(note?.title || note?.name || "");
  const legacy = splitLegacyPersonName(fallbackTitle);
  return {
    firstName: normalizeNoteTextValue(note?.person?.firstName) || legacy.firstName,
    lastName: normalizeNoteTextValue(note?.person?.lastName) || legacy.lastName,
    nationality: normalizeNoteTextValue(note?.person?.nationality || note?.nationality),
  };
}

function getNoteDisplayTitle(note = {}) {
  const fallbackTitle = normalizeNoteTextValue(note?.title || note?.name || "");
  if (String(note?.noteKind || "").trim() !== "persona") return fallbackTitle;
  const person = getNotePersonFields(note);
  return normalizeNoteTextValue([person.firstName || fallbackTitle, person.lastName].filter(Boolean).join(" ")) || fallbackTitle;
}

function getNoteBaseTitle(note = {}) {
  const fallbackTitle = normalizeNoteTextValue(note?.title || note?.name || "");
  if (String(note?.noteKind || "").trim() !== "persona") return fallbackTitle;
  const person = getNotePersonFields(note);
  return person.firstName || fallbackTitle;
}

function stripWikiLinkMarkup(value = "") {
  return String(value || "").replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, label = "") => normalizeNoteTextValue(label));
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
    getNoteDisplayTitle(note),
    stripWikiLinkMarkup(String(note?.content || "").trim()),
    String(note?.code || "").trim(),
    String(note?.previewHtml || "").trim(),
  ];

  if (String(note?.noteKind || "").trim() === "persona") {
    const person = getNotePersonFields(note);
    parts.push(person.firstName, person.lastName, person.nationality);
  }

  if (note?.type === "link") {
    parts.push(String(note?.url || "").trim());
  }

  return parts.filter(Boolean).join(" ").trim();
}

function splitLocationSegments(...values) {
  const seen = new Set();
  const items = [];

  values.flat().forEach((value) => {
    String(value || "")
      .split(",")
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .forEach((chunk) => {
        const key = chunk.toLocaleLowerCase("es");
        if (seen.has(key)) return;
        seen.add(key);
        items.push(chunk);
      });
  });

  return items;
}

function normalizeLocationFilterText(value = "") {
  return String(value || "").trim().toLocaleLowerCase("es");
}

export function getNoteLocationDetails(note = {}) {
  const location = note?.location || {};
  const segments = splitLocationSegments(
    location?.exactAddress,
    location?.label,
    location?.text,
  );
  const lastIndex = segments.length - 1;
  const countryFallback = lastIndex >= 1 ? segments[lastIndex] : "";
  const regionFallback = lastIndex >= 2 ? segments[lastIndex - 1] : "";
  const cityFallback = lastIndex >= 2
    ? segments[lastIndex - 2]
    : (segments[0] || "");
  const municipalityFallback = lastIndex >= 3 ? segments[lastIndex - 3] : "";
  const address = String(location?.exactAddress || location?.label || location?.text || segments.join(", ")).trim();

  return {
    country: String(location?.country || countryFallback).trim(),
    region: String(location?.region || location?.state || location?.province || location?.county || regionFallback).trim(),
    province: String(location?.province || location?.county || regionFallback).trim(),
    city: String(location?.city || location?.town || location?.village || location?.place || location?.municipality || cityFallback).trim(),
    municipality: String(location?.municipality || municipalityFallback).trim(),
    postalCode: String(location?.postalCode || "").trim(),
    address,
    label: String(location?.label || address).trim(),
    text: String(location?.text || address).trim(),
  };
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
  const person = getNotePersonFields(note);

  return {
    ...note,
    title: getNoteDisplayTitle(note),
    noteKind: normalizeNoteKind(note?.noteKind),
    type: note?.type === "link" ? "link" : "note",
    tags,
    tagsCount: tags.length,
    nationality: person.nationality,
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
    uniqueCategoriesCount: 0,
    categorizedNotesCount: 0,
    uncategorizedNotesCount: 0,
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
    personNotesCount: 0,
    nationalityKnownCount: 0,
    nationalityMissingCount: 0,
    nationalityStats: [],
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
    topCategories: [],
    longestNote: null,
    shortestNote: null,
    activityByMonth: [],
    duplicateTitles: [],
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
  const personNotes = folderNotes.filter((note) => note.noteKind === "persona");
  const ratedNotes = folderNotes.filter((note) => note.rating !== null);
  const linkNotes = folderNotes.filter((note) => note.type === "link");
  const visitedNotes = linkNotes.filter((note) => normalizeNoteVisitsCount(note.visitsCount) > 0);
  const personNotesCount = personNotes.length;
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
  const categoryUsage = new Map();
  const nationalityUsage = new Map();
  let totalTagAssignments = 0;

  folderNotes.forEach((note) => {
    totalTagAssignments += Number(note.tagsCount || 0);

    const categoryLabel = String(note.category || "").trim();
    if (categoryLabel) {
      const categoryRow = categoryUsage.get(categoryLabel) || { label: categoryLabel, count: 0 };
      categoryRow.count += 1;
      categoryUsage.set(categoryLabel, categoryRow);
    }

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

  personNotes.forEach((note) => {
    const safeNationality = normalizeNoteTextValue(note.nationality);
    const country = normalizeNationalityCountry(safeNationality);
    const key = country?.code || normalizeNationalityKey(safeNationality) || "__missing__";
    const current = nationalityUsage.get(key) || {
      code: country?.code || "",
      mapName: country?.mapName || "",
      label: country?.label || (safeNationality ? formatNationalityLabel(safeNationality) : "Sin nacionalidad"),
      rawLabel: safeNationality || "",
      count: 0,
    };
    current.count += 1;
    if (!current.code && safeNationality && current.label === current.label.toLocaleLowerCase("es")) current.label = formatNationalityLabel(safeNationality);
    nationalityUsage.set(key, current);
  });

  const notesWithTagsCount = folderNotes.filter((note) => Number(note.tagsCount || 0) > 0).length;
  const categorizedNotesCount = folderNotes.filter((note) => String(note.category || "").trim()).length;
  const monthlyCounts = new Map();
  const titleGroups = new Map();

  folderNotes.forEach((note) => {
    const monthKey = buildMonthKey(note.createdAt);
    if (!monthKey) return;
    monthlyCounts.set(monthKey, (monthlyCounts.get(monthKey) || 0) + 1);
    const baseTitle = getNoteBaseTitle(note);
    const normalizedTitle = baseTitle.toLocaleLowerCase("es");
    if (normalizedTitle) {
      const group = titleGroups.get(normalizedTitle) || { normalizedTitle, title: note.title || "Sin título", count: 0, notes: [] };
      group.count += 1;
      group.notes.push({
        id: note.id,
        title: note.title || "Sin título",
        updatedAt: note.updatedAt,
      });
      group.title = baseTitle || group.title;
      const lastGroupedNote = group.notes[group.notes.length - 1];
      if (lastGroupedNote) {
        lastGroupedNote.title = getNoteDisplayTitle(note) || lastGroupedNote.title;
      }
      titleGroups.set(normalizedTitle, group);
    }
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
    uniqueCategoriesCount: categoryUsage.size,
    categorizedNotesCount,
    uncategorizedNotesCount: totalNotes - categorizedNotesCount,
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
    personNotesCount,
    nationalityKnownCount: personNotes.filter((note) => normalizeNoteTextValue(note.nationality)).length,
    nationalityMissingCount: personNotes.filter((note) => !normalizeNoteTextValue(note.nationality)).length,
    nationalityStats: Array.from(nationalityUsage.values())
      .map((row) => ({
        code: row.code || "",
        label: row.label,
        rawLabel: row.rawLabel || row.label || "",
        mapName: row.mapName || "",
        count: row.count,
        value: row.count,
        mappable: Boolean(row.code),
        percentage: percentage(row.count, personNotesCount),
      }))
      .sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0) || compareText(a?.label, b?.label)),
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
    topCategories: Array.from(categoryUsage.values())
      .map((row) => ({
        label: row.label,
        count: row.count,
        percentage: percentage(row.count, totalNotes),
      }))
      .sort(compareTagUsage)
      .slice(0, 8),
    longestNote: [...folderNotes].sort(compareLongest)[0] || null,
    shortestNote: [...folderNotes].sort(compareShortest)[0] || null,
    activityByMonth: activityByMonthBase.map((row) => ({
      ...row,
      percentage: percentage(row.count, maxMonthCount),
    })),
    duplicateTitles: Array.from(titleGroups.values())
      .filter((group) => Number(group?.count || 0) > 1)
      .sort((a, b) => Number(b?.count || 0) - Number(a?.count || 0) || compareText(a?.title, b?.title))
      .slice(0, 20),
  };
}

export function createInitialNotesState() {
  return {
    uid: "",
    rootPath: "",
    folders: [],
    notes: [],
    reminders: [],
    reminderCategories: [],
    reminderPreferences: {},
    tagDefinitions: {},
    selectedFolderId: "",
    unlockedFolderIds: new Set(),
    folderQuery: "",
    noteQuery: "",
    folderCategoryFilter: "",
    folderTagsFilter: "",
    noteCategoryFilter: "",
    noteTagsFilter: "",
    noteLocationFilters: {
      country: "",
      region: "",
      city: "",
      address: "",
    },
    noteSort: "updated",
    rootSection: "notes",
    reminderFilters: {
      types: [],
      categories: [],
      statuses: [],
      range: "all",
    },
    reminderGroupBy: "none",
    reminderCollapsedHistory: true,
    reminderView: "list",
    reminderCalendarMonthKey: "",
    reminderCalendarSelectedDate: "",
    reminderCalendarFocusedReminderId: "",
    folderView: "main",
    loading: true,
  };
}

export function buildFolderStats(folders = [], notes = []) {
  const folderMap = createFolderMap(folders);
  const childrenMap = buildChildrenMap(folders, folderMap);
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

  function countNotesDeep(folderId = "", visitedFolderIds = new Set()) {
    const safeFolderId = normalizeId(folderId);
    if (!safeFolderId || visitedFolderIds.has(safeFolderId)) return 0;

    const nextVisited = new Set(visitedFolderIds);
    nextVisited.add(safeFolderId);

    const directNotesCount = Number(noteCountByFolder.get(safeFolderId) || 0);
    const childFolders = childrenMap.get(safeFolderId) || [];

    return childFolders.reduce(
      (total, childFolder) => total + countNotesDeep(childFolder?.id, nextVisited),
      directNotesCount,
    );
  }

  return [...folders]
    .sort(compareFolders)
    .map((folder) => ({
      ...folder,
      parentId: getSafeParentId(folder, folderMap),
      notesCount: countNotesDeep(folder.id),
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

export function filterNotesByFolder(notes = [], folderId = "", query = "", category = "", tags = "", locationFilters = {}) {
  const safeFolderId = normalizeId(folderId);
  if (!safeFolderId) return [];

  const safeQuery = String(query || "").trim().toLowerCase();
  const safeCategory = String(category || "").trim().toLowerCase();
  const safeTags = String(tags || "").trim().toLowerCase();
  const safeLocationFilters = {
    country: normalizeLocationFilterText(locationFilters?.country),
    region: normalizeLocationFilterText(locationFilters?.region),
    city: normalizeLocationFilterText(locationFilters?.city),
    address: normalizeLocationFilterText(locationFilters?.address),
  };

  const byFolder = notes.filter((note) => normalizeId(note?.folderId) === safeFolderId);

  return byFolder.filter((note) => {
    if (safeQuery) {
      const title = getNoteDisplayTitle(note).toLowerCase();
      const legacyTitle = String(note.title || "").toLowerCase();
      const content = stripWikiLinkMarkup(String(note.content || "")).toLowerCase();
      const url = String(note.url || "").toLowerCase();
      const location = getNoteLocationDetails(note);
      const address = normalizeLocationFilterText(location.address || location.label || location.text);
      if (!title.includes(safeQuery) && !legacyTitle.includes(safeQuery) && !content.includes(safeQuery) && !url.includes(safeQuery) && !address.includes(safeQuery)) {
        return false;
      }
    }

    if (safeCategory && String(note.category || "").toLowerCase() !== safeCategory) return false;
    if (safeTags && !(note.tags || []).map((tag) => String(tag).toLowerCase()).includes(safeTags)) return false;

    if (safeLocationFilters.country || safeLocationFilters.region || safeLocationFilters.city || safeLocationFilters.address) {
      const location = getNoteLocationDetails(note);
      if (safeLocationFilters.country && normalizeLocationFilterText(location.country) !== safeLocationFilters.country) return false;
      if (safeLocationFilters.region && normalizeLocationFilterText(location.region || location.province) !== safeLocationFilters.region) return false;
      if (safeLocationFilters.city && normalizeLocationFilterText(location.city || location.municipality) !== safeLocationFilters.city) return false;
      if (safeLocationFilters.address && normalizeLocationFilterText(location.address || location.label || location.text) !== safeLocationFilters.address) return false;
    }

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
