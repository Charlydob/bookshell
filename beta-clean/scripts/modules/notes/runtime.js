import { onUserChange } from "../../shared/firebase/index.js";
import {
  createLeafletMap,
  DEFAULT_MAP_CENTER_SPAIN,
  DEFAULT_MAP_ZOOM_SPAIN,
  destroyLeafletMap,
  ensureLeaflet,
  invalidateLeafletMap,
  MAX_AUTO_ZOOM,
  setLeafletViewForPoints,
} from "../../shared/vendors/leaflet.js";
import { renderCountryHeatmap } from "../books/world-heatmap.js";
import {
  buildFolderInsights,
  buildFolderOptions,
  buildFolderStats,
  createInitialNotesState,
  filterFolders,
  filterNotesByFolder,
  getNoteLocationDetails,
  getChildFolders,
  getFolderPath,
  isFolderParentAllowed,
  sortNotes,
} from "./domain/store.js?v=2026-05-13-v1";
import {
  createFolder,
  createNote,
  createNoteId,
  createReminder,
  deleteReminder,
  deleteFolder,
  deleteNote,
  incrementNoteVisits,
  patchReminderChecklistItem,
  subscribeNotesRoot,
  updateReminderPreferences,
  upsertTagDefinition,
  upsertReminderCategory,
  updateFolder,
  updateNote,
  updateReminder,
} from "./persist/notes-datasource.js?v=2026-05-15-v1";
import {
  deleteNoteAttachmentImageAsset,
  deleteNoteImageAsset,
  deleteNoteTagImageAsset,
  downscaleNoteImageFile,
  uploadNoteAttachmentImageAsset,
  uploadNoteImageAsset,
  uploadNoteTagImageAsset,
} from "./persist/notes-storage.js?v=2026-05-15-v1";
import {
  buildTagDefinitionKey,
  normalizeTagLabel,
  parseTagList,
} from "./domain/tag-utils.js?v=2026-04-28-v2";

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
});
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const TIME_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});
const REMINDER_MONTH_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  month: "long",
  year: "numeric",
});
const NUMBER_FORMATTER = new Intl.NumberFormat("es-ES");
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});
const REMINDER_WEEKDAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];
const REMINDER_COLOR_PALETTE = Object.freeze([
  "#63d6ff",
  "#7d8bff",
  "#a57dff",
  "#ff8abf",
  "#ff8f70",
  "#ffc857",
  "#7fdc8a",
  "#63d2c6",
]);
const DEFAULT_REMINDER_COLOR = REMINDER_COLOR_PALETTE[0];
const REMINDER_VIEW_STORAGE_KEY = "bookshell-notes-reminders-view:v1";
const REMINDER_CALENDAR_MAX_DOTS = 3;
const REMINDER_CALENDAR_DEBUG = true;
const state = {
  ...createInitialNotesState(),
  reminderView: loadReminderViewPreference(),
  reminderCalendarMonthKey: getCurrentMonthKey(),
  reminderCalendarSelectedDate: getTodayDateKey(),
  reminderCalendarFocusedReminderId: "",
  reminderActiveFilterMode: "allPending",
  reminderActiveFilterDate: "",
};
let unbindAuth = null;
let unbindData = null;
let isBound = false;
let notePhotoObjectUrl = null;
let notePhotoRemove = false;
let noteSaveInFlight = false;
let noteDetailSaveInFlight = false;
let noteAttachmentDrafts = [];
let noteTagImageDrafts = new Map();
let activeNoteTagImageKey = "";
let noteSelectedTagImageKey = "";
let noteLinkAutocompleteState = { start: -1, end: -1, activeIndex: 0, items: [], query: "" };
let noteLinkDraftReferences = [];
let activeNotesStatsSection = "ratings";
let reminderDraftAlerts = [];
let reminderDraftCategories = [];
let reminderDraftChecklistItems = {};
let reminderCheckTimer = null;
let reminderToastQueue = [];
let reminderToastActive = null;
let reminderNotificationsOpen = false;
let reminderChecklistToggleVersion = new Map();
let reminderChecklistToggleQueue = new Map();
let notesLocationSearchTimer = null;
let activeLocationGrouping = "country";
let activeNoteDetailId = "";
let activeNoteDetailSourceFolderId = "";
let notesLocationReverseAbort = null;
let pendingReminderRemoteRestore = null;
const noteLocationMapState = {
  map: null,
  marker: null,
  leaflet: null,
  selection: null,
  tileErrorBound: false,
  mapClickBound: false,
};
const reminderExpandedChecklist = new Set();
const expandedSnippetNotes = new Set();
const REMINDER_TYPES = ["normal", "cumpleaños", "tarea", "evento", "trámite", "checklist", "personalizado"];
const REMINDER_STATUSES = ["pendiente", "completado", "vencido"];
const REMINDER_RANGES = ["all", "today", "7d", "30d", "overdue"];
const REMINDER_GROUP_BY = ["none", "category", "type", "date", "status"];
const REMINDER_ACTIVE_FILTER_MODES = ["allPending", "day"];
const SNIPPET_PREVIEW_PLACEHOLDER = '<div class="demo-target">Demo</div>';
const CSS_PROPERTY_SUGGESTIONS = Object.freeze([
  "background",
  "background-color",
  "border",
  "border-top",
  "border-bottom",
  "border-left",
  "border-right",
  "border-radius",
  "box-shadow",
  "color",
  "display",
  "grid-template-columns",
  "gap",
  "margin",
  "margin-top",
  "margin-bottom",
  "padding",
  "padding-top",
  "padding-bottom",
  "width",
  "height",
  "min-width",
  "max-width",
  "font-size",
  "font-weight",
  "line-height",
  "text-align",
  "align-items",
  "justify-content",
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "z-index",
  "opacity",
  "transform",
  "transition",
  "backdrop-filter",
]);
const SNIPPET_SUGGESTION_LIMIT = 8;
const SNIPPET_COLOR_LIMIT = 10;

function normalizeNotesStatsSection(section = "") {
  const safeSection = String(section || "").trim();
  return ["ratings", "tags", "categories", "notes"].includes(safeSection) ? safeSection : "ratings";
}

function normalizeNoteSortOption(sort = "") {
  const safeSort = String(sort || "").trim();
  return ["updated", "rating", "visits"].includes(safeSort) ? safeSort : "updated";
}

function normalizeRootSection(section = "") {
  return String(section || "").trim() === "reminders" ? "reminders" : "notes";
}

function createEmptyNoteLocationFilters() {
  return {
    country: "",
    region: "",
    city: "",
    address: "",
  };
}

function normalizeReminderGroupBy(value = "") {
  const safe = String(value || "").trim();
  return REMINDER_GROUP_BY.includes(safe) ? safe : "none";
}

function normalizeReminderType(value = "") {
  const safe = String(value || "").trim();
  return REMINDER_TYPES.includes(safe) ? safe : "normal";
}

function normalizeReminderRange(value = "") {
  const safe = String(value || "").trim();
  return REMINDER_RANGES.includes(safe) ? safe : "all";
}

function normalizeReminderStatus(value = "") {
  const safe = String(value || "").trim();
  return REMINDER_STATUSES.includes(safe) ? safe : "pendiente";
}

function normalizeReminderMultiSelection(items = [], allowed = []) {
  const source = Array.isArray(items) ? items : [];
  const filtered = source
    .map((item) => String(item || "").trim())
    .filter((item, index, list) => item && list.indexOf(item) === index);
  if (!allowed.length) return filtered;
  return filtered.filter((item) => allowed.includes(item));
}

function normalizeReminderView(value = "") {
  return String(value || "").trim() === "calendar" ? "calendar" : "list";
}

function normalizeReminderActiveFilterMode(value = "") {
  return REMINDER_ACTIVE_FILTER_MODES.includes(String(value || "").trim())
    ? String(value || "").trim()
    : "allPending";
}

function loadReminderViewPreference() {
  try {
    return normalizeReminderView(window.localStorage?.getItem(REMINDER_VIEW_STORAGE_KEY) || "list");
  } catch (_) {
    return "list";
  }
}

function saveReminderViewPreference(value = "") {
  try {
    window.localStorage?.setItem(REMINDER_VIEW_STORAGE_KEY, normalizeReminderView(value));
  } catch (_) {}
}

function logReminderCalendarDebug(label = "", payload = {}) {
  if (!REMINDER_CALENDAR_DEBUG || typeof console === "undefined" || typeof console.log !== "function") return;
  console.log(label, payload);
}

function normalizeReminderColor(value = "") {
  const safe = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(safe) ? safe : DEFAULT_REMINDER_COLOR;
}

function padCalendarNumber(value = 0) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, "0");
}

function getDateKeyFromParts(year = 0, monthIndex = 0, day = 1) {
  return `${String(year).padStart(4, "0")}-${padCalendarNumber(monthIndex + 1)}-${padCalendarNumber(day)}`;
}

function getDateKeyFromDate(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  return getDateKeyFromParts(date.getFullYear(), date.getMonth(), date.getDate());
}

function getTodayDateKey() {
  return getDateKeyFromDate(new Date());
}

function getMonthKeyFromDate(date = new Date()) {
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return "";
  return `${String(date.getFullYear()).padStart(4, "0")}-${padCalendarNumber(date.getMonth() + 1)}`;
}

function getCurrentMonthKey() {
  return getMonthKeyFromDate(new Date());
}

function parseDateKey(dateKey = "") {
  const safe = String(dateKey || "").trim();
  const match = safe.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, monthIndex: month - 1, day };
}

function parseMonthKey(monthKey = "") {
  const safe = String(monthKey || "").trim();
  const match = safe.match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (!year || month < 1 || month > 12) return null;
  return { year, monthIndex: month - 1 };
}

function getMonthKeyFromDateKey(dateKey = "") {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return getCurrentMonthKey();
  return `${String(parsed.year).padStart(4, "0")}-${padCalendarNumber(parsed.monthIndex + 1)}`;
}

function daysInMonth(year = 0, monthIndex = 0) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

function clampDayForMonth(year = 0, monthIndex = 0, day = 1) {
  return Math.min(Math.max(1, Number(day) || 1), daysInMonth(year, monthIndex));
}

function addMonthsToMonthKey(monthKey = "", delta = 0) {
  const parsed = parseMonthKey(monthKey) || parseMonthKey(getCurrentMonthKey());
  const date = new Date(parsed.year, parsed.monthIndex + Number(delta || 0), 1);
  return getMonthKeyFromDate(date);
}

function getDateFromDateKey(dateKey = "") {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  return new Date(parsed.year, parsed.monthIndex, parsed.day);
}

function isTodayDateKey(dateKey = "") {
  return String(dateKey || "").trim() === getTodayDateKey();
}

function capitalizeText(value = "") {
  const safe = String(value || "");
  return safe ? safe.charAt(0).toUpperCase() + safe.slice(1) : "";
}

function formatReminderCalendarTitle(monthKey = "") {
  const parsed = parseMonthKey(monthKey) || parseMonthKey(getCurrentMonthKey());
  const date = new Date(parsed.year, parsed.monthIndex, 1);
  return capitalizeText(REMINDER_MONTH_FORMATTER.format(date));
}

function buildStatsSectionSwitch(active = "ratings") {
  const safeActive = normalizeNotesStatsSection(active);
  const tabs = [
    { key: "ratings", label: "Ratings" },
    { key: "tags", label: "Tags" },
    { key: "categories", label: "Categorias" },
    { key: "notes", label: "Notas" },
  ];

  return `
    <div class="notes-stats-section-switch" role="tablist" aria-label="Secciones de estadisticas">
      ${tabs.map((tab) => `
        <button
          class="notes-stats-section-tab${safeActive === tab.key ? " is-active" : ""}"
          type="button"
          role="tab"
          aria-selected="${safeActive === tab.key ? "true" : "false"}"
          data-act="set-notes-stats-section"
          data-stats-section="${tab.key}"
        >${tab.label}</button>
      `).join("")}
    </div>
  `;
}

function buildStatsVerticalRatingChart(items = [], emptyText = "Sin datos todavia.") {
  const sourceRows = Array.isArray(items) ? items : [];
  const countByValue = new Map(
    sourceRows.map((row) => [Number(row?.value), Number(row?.count || 0)]),
  );
  const chartItems = Array.from({ length: 11 }, (_, value) => ({
    value,
    count: Math.max(0, Number(countByValue.get(value) || 0)),
  }));
  const maxCount = chartItems.reduce((max, row) => Math.max(max, row.count), 0);

  if (!maxCount) {
    return `<div class="notes-stats-empty-copy">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="notes-stats-rating-chart" role="img" aria-label="Distribucion de ratings de 0 a 10">
      <div class="notes-stats-rating-chart-plot">
        ${chartItems.map((item) => {
          const rawHeight = maxCount ? (item.count / maxCount) * 100 : 0;
          const height = item.count > 0 ? Math.max(rawHeight, 10) : 0;
          const title = `${item.value}/10 · ${formatNumber(item.count)} notas`;

          return `
            <div class="notes-stats-rating-col">
              <span class="notes-stats-rating-count">${escapeHtml(formatNumber(item.count))}</span>
              <div class="notes-stats-rating-bar-wrap">
                <span
                  class="notes-stats-rating-bar${item.count > 0 ? "" : " is-empty"}"
                  style="height:${height.toFixed(1)}%;"
                  title="${escapeHtml(title)}"
                ></span>
              </div>
              <span class="notes-stats-rating-x">${escapeHtml(String(item.value))}</span>
            </div>
          `;
        }).join("")}
      </div>
    </div>
  `;
}

function buildRatingsStatsMarkup(insights, averageRatingLabel) {
  return `
    <div class="notes-stats-card-head">
      <h3 class="notes-stats-card-title">Ratings</h3>
      <p class="notes-stats-card-copy">Distribucion y notas destacadas de la carpeta.</p>
    </div>
    ${buildStatsMetricChips([
      { label: "Media", value: averageRatingLabel },
      { label: "Con rating", value: formatNumber(insights?.ratedNotesCount || 0) },
      { label: "Sin rating", value: formatNumber(insights?.unratedNotesCount || 0) },
      { label: "Mejor nota", value: insights?.maxRating === null ? "—" : formatRatingValue(insights.maxRating) },
    ])}
    <div class="notes-stats-block">
      <div class="notes-stats-block-head"><strong>Distribucion</strong></div>
      ${buildStatsVerticalRatingChart(
        insights?.ratingDistribution || [],
        "Aun no hay notas valoradas en esta carpeta."
      )}
    </div>
    <div class="notes-stats-split">
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Top rating</strong></div>
        ${buildStatsNoteList(
          insights?.bestRatedNotes || [],
          (note) => `${formatRatingValue(note.rating)} · ${formatCompactDate(note.updatedAt || note.createdAt)} · ${formatNumber(note.tagsCount || 0)} tags`,
          "Todavia no hay notas valoradas.",
        )}
      </div>
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Rating mas bajo</strong></div>
        ${buildStatsNoteList(
          insights?.worstRatedNotes || [],
          (note) => `${formatRatingValue(note.rating)} · ${formatCompactDate(note.updatedAt || note.createdAt)} · ${formatNumber(note.tagsCount || 0)} tags`,
          "No hay suficiente variedad para mostrar una peor nota.",
        )}
      </div>
    </div>
  `;
}

function buildTagsStatsMarkup(insights) {
  const topRatedTags = (insights?.topRatedTags || []).map((row) => ({
    ...row,
    percentageOfAverage: (Number(row?.averageRating || 0) / 10) * 100,
  }));

  return `
    <div class="notes-stats-card-head">
      <h3 class="notes-stats-card-title">Tags</h3>
      <p class="notes-stats-card-copy">Uso real de etiquetas y relacion con notas valoradas.</p>
    </div>
    ${buildStatsMetricChips([
      { label: "Con tags", value: formatPercentage(insights?.tagsCoverage || 0) },
      { label: "Media tags", value: formatCompactNumber(insights?.tagsPerNoteAverage || 0) },
      { label: "Sin tags", value: formatNumber(insights?.notesWithoutTagsCount || 0) },
    ])}
    <div class="notes-stats-block">
      <div class="notes-stats-block-head"><strong>Ranking de tags</strong></div>
      ${buildStatsBarList((insights?.topTags || []).slice(0, 8), {
        labelFormatter: (row) => row.label || "",
        valueFormatter: (row) => `${formatNumber(row.count)} · ${formatPercentage(row.percentage || 0)}`,
        emptyText: "Esta carpeta aun no tiene tags usados en notas.",
      })}
    </div>
    <div class="notes-stats-block">
      <div class="notes-stats-block-head"><strong>Tags mejor valorados</strong></div>
      ${buildStatsBarList(topRatedTags, {
        labelFormatter: (row) => row.label || "",
        valueFormatter: (row) => `${formatCompactNumber(row.averageRating || 0)}/10 · ${formatNumber(row.count || 0)} notas`,
        percentageKey: "percentageOfAverage",
        emptyText: "Necesitas al menos dos notas valoradas por tag para compararlos.",
      })}
    </div>
  `;
}

function buildCategoriesStatsMarkup(insights) {
  return `
    <div class="notes-stats-card-head">
      <h3 class="notes-stats-card-title">Categorias</h3>
      <p class="notes-stats-card-copy">Reparto de notas por categoria dentro del contexto actual.</p>
    </div>
    ${buildStatsMetricChips([
      { label: "Categorias", value: formatNumber(insights?.uniqueCategoriesCount || 0) },
      { label: "Con categoria", value: formatNumber(insights?.categorizedNotesCount || 0) },
      { label: "Sin categoria", value: formatNumber(insights?.uncategorizedNotesCount || 0) },
    ])}
    <div class="notes-stats-block">
      <div class="notes-stats-block-head"><strong>Notas por categoria</strong></div>
      ${buildStatsBarList(insights?.topCategories || [], {
        labelFormatter: (row) => row.label || "Sin categoria",
        valueFormatter: (row) => `${formatNumber(row.count || 0)} notas · ${formatPercentage(row.percentage || 0)}`,
        emptyText: "Esta carpeta aun no tiene categorias usadas en notas.",
      })}
    </div>
    <div class="notes-stats-block">
      <div class="notes-stats-block-head"><strong>Categorias mas usadas</strong></div>
      ${buildStatsBarList((insights?.topCategories || []).slice(0, 5), {
        labelFormatter: (row) => row.label || "Sin categoria",
        valueFormatter: (row) => `${formatNumber(row.count || 0)} notas`,
        emptyText: "Todavia no hay categorias suficientes para comparar.",
      })}
    </div>
  `;
}

function buildNotesStatsMarkup(insights) {
  const monthlyActivity = insights?.activityByMonth || [];
  const topVisitedNotes = (insights?.topVisitedNotes || []).map((note, index, list) => ({
    ...note,
    percentageOfTopVisits: Number(list?.[0]?.visitsCount || 0)
      ? (Number(note?.visitsCount || 0) / Number(list[0].visitsCount || 0)) * 100
      : 0,
  }));
  const latestVisitedAt = Number(insights?.recentlyVisitedNotes?.[0]?.lastVisitedAt || 0);
  const mostVisitedLabel = insights?.mostVisitedNote
    ? formatNumber(insights.mostVisitedNote.visitsCount || 0)
    : "—";
  const visitedLinksLabel = Number(insights?.linksCount || 0)
    ? `${formatNumber(insights?.visitedNotesCount || 0)}/${formatNumber(insights?.linksCount || 0)}`
    : "0/0";

  return `
    <div class="notes-stats-card-head">
      <h3 class="notes-stats-card-title">Notas</h3>
      <p class="notes-stats-card-copy">Actividad reciente, longitud, densidad y visitas de la carpeta.</p>
    </div>
    ${buildStatsMetricChips([
      { label: "Visitas", value: formatNumber(insights?.totalVisits || 0) },
      { label: "Links vistos", value: visitedLinksLabel },
      { label: "Mas visto", value: mostVisitedLabel },
      { label: "Ult. visita", value: latestVisitedAt ? formatCompactDate(latestVisitedAt) : "—" },
      { label: "Creadas 7d", value: formatNumber(insights?.createdRecently7d || 0) },
      { label: "Editadas 30d", value: formatNumber(insights?.editedRecently30d || 0) },
      { label: "Media car.", value: formatCompactNumber(insights?.averageCharacters || 0) },
    ])}
    <div class="notes-stats-block">
      <div class="notes-stats-block-head"><strong>Evolucion mensual</strong></div>
      ${buildStatsBarList(monthlyActivity, {
        labelFormatter: (row) => row.label || "",
        valueFormatter: (row) => `${formatNumber(row.count || 0)} notas`,
        emptyText: "Aun no hay suficientes fechas de creacion para mostrar evolucion.",
      })}
    </div>
    <div class="notes-stats-split">
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Ranking mas vistas</strong></div>
        ${buildStatsBarList(topVisitedNotes, {
          labelFormatter: (note) => note?.title || "Sin titulo",
          valueFormatter: (note) => `${formatNumber(note?.visitsCount || 0)} visitas · ${formatCompactDate(note?.lastVisitedAt || 0)}`,
          percentageKey: "percentageOfTopVisits",
          emptyText: "Todavia no hay links con visitas registradas.",
        })}
      </div>
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Ultimas visitas</strong></div>
        ${buildStatsNoteList(
          insights?.recentlyVisitedNotes || [],
          (note) => `${formatLongDate(note.lastVisitedAt || 0)} · ${formatNumber(note.visitsCount || 0)} visitas`,
          "Aun no hay aperturas recientes de links.",
        )}
      </div>
    </div>
    <div class="notes-stats-split">
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Con mas tags</strong></div>
        ${buildStatsNoteList(
          insights?.notesWithMostTags || [],
          (note) => `${formatNumber(note.tagsCount || 0)} tags · ${formatCompactDate(note.updatedAt || note.createdAt)}`,
          "Todavia no hay notas etiquetadas.",
        )}
      </div>
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Ultimas ediciones</strong></div>
        ${buildStatsNoteList(
          insights?.recentlyUpdatedNotes || [],
          (note) => `${formatLongDate(note.updatedAt)} · ${formatNumber(note.tagsCount || 0)} tags`,
          "Todavia no hay ediciones recientes.",
        )}
      </div>
    </div>
    <div class="notes-stats-split">
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Mas larga</strong></div>
        ${buildStatsNoteList(
          insights?.longestNote ? [insights.longestNote] : [],
          (note) => `${formatNumber(note.characters || 0)} car. · ${formatNumber(note.words || 0)} palabras`,
          "Sin contenido suficiente para comparar longitud.",
        )}
      </div>
      <div class="notes-stats-block">
        <div class="notes-stats-block-head"><strong>Mas corta</strong></div>
        ${buildStatsNoteList(
          insights?.shortestNote ? [insights.shortestNote] : [],
          (note) => `${formatNumber(note.characters || 0)} car. · ${formatNumber(note.words || 0)} palabras`,
          "Sin contenido suficiente para comparar longitud.",
        )}
      </div>
    </div>
  `;
}

function buildActiveStatsCardMarkup(insights, averageRatingLabel, activeSection = "ratings") {
  const safeActive = normalizeNotesStatsSection(activeSection);
  let sectionMarkup = "";

  if (safeActive === "tags") {
    sectionMarkup = buildTagsStatsMarkup(insights);
  } else if (safeActive === "categories") {
    sectionMarkup = buildCategoriesStatsMarkup(insights);
  } else if (safeActive === "notes") {
    sectionMarkup = buildNotesStatsMarkup(insights);
  } else {
    sectionMarkup = buildRatingsStatsMarkup(insights, averageRatingLabel);
  }

  return `
    <article class="notes-stats-card notes-stats-card--single" data-stats-section="${safeActive}">
      ${buildStatsSectionSwitch(safeActive)}
      ${sectionMarkup}
    </article>
  `;
}

function renderFolderStatsSectionView(folder, insights, childFolders = []) {
  const kpiWrap = $id("notes-stats-kpis");
  const grid = $id("notes-stats-grid");
  const empty = $id("notes-empty-stats");
  if (!kpiWrap || !grid || !empty) return;

  const totalNotes = Number(insights?.totalNotes || 0);
  const averageRatingLabel = insights?.averageRating === null
    ? "—"
    : `${formatCompactNumber(insights.averageRating)}/10`;

  kpiWrap.innerHTML = buildStatsKpiCards([
    {
      label: "Notas",
      value: formatNumber(totalNotes),
      meta: childFolders.length ? `${formatNumber(childFolders.length)} subcarpetas` : "En esta carpeta",
    },
    {
      label: "Visitas",
      value: formatNumber(insights?.totalVisits || 0),
      meta: insights?.mostVisitedNote
        ? `${formatNumber(insights?.mostVisitedNote?.visitsCount || 0)} en la mas vista`
        : "Sin aperturas",
    },
    {
      label: "Links vistos",
      value: Number(insights?.linksCount || 0)
        ? `${formatNumber(insights?.visitedNotesCount || 0)}/${formatNumber(insights?.linksCount || 0)}`
        : "0/0",
      meta: Number(insights?.linksCount || 0)
        ? `${formatPercentage(insights?.visitedLinksShare || 0)} con visitas`
        : "Sin notas link",
    },
    {
      label: "Media",
      value: averageRatingLabel,
      meta: insights?.ratedNotesCount ? `${formatNumber(insights.ratedNotesCount)} valoradas` : "Sin ratings",
    },
    {
      label: "Tags unicos",
      value: formatNumber(insights?.uniqueTagsCount || 0),
      meta: `${formatNumber(insights?.totalTagAssignments || 0)} usos`,
    },
    {
      label: "Categorias",
      value: formatNumber(insights?.uniqueCategoriesCount || 0),
      meta: Number(insights?.categorizedNotesCount || 0)
        ? `${formatNumber(insights?.categorizedNotesCount || 0)} con categoria`
        : "Sin categorias",
    },
    {
      label: "Creadas 30d",
      value: formatNumber(insights?.createdRecently30d || 0),
      meta: `${formatNumber(insights?.editedRecently30d || 0)} editadas`,
    },
  ]);

  const folderNotes = filterNotesByFolder(state.notes, folder?.id || "");
  const locations = collectNoteLocations(folderNotes);
  const duplicateGroups = buildDuplicateTitleGroups(folderNotes);
  console.debug("[notes:stats] repeated names computed", duplicateGroups.length);
  console.debug("[notes:map] locations count", locations.length);

  const currentNationalitiesMapHost = grid.querySelector("#notes-nationalities-world-map");
  if (typeof currentNationalitiesMapHost?.__geoCleanup === "function") {
    currentNationalitiesMapHost.__geoCleanup();
  }

  empty.classList.add("hidden");
  grid.classList.remove("hidden");

  activeNotesStatsSection = normalizeNotesStatsSection(activeNotesStatsSection);
  grid.innerHTML = `
    ${totalNotes ? buildActiveStatsCardMarkup(insights, averageRatingLabel, activeNotesStatsSection) : ""}
    ${buildNationalitiesStatsMarkup(insights)}
    <article class="notes-stats-card">
      <div class="notes-stats-card-head"><h3 class="notes-stats-card-title">Mapa de ubicaciones</h3></div>
      ${locations.length ? `<div class="notes-map-shell"><div class="notes-map-frame" id="notes-stats-map"></div></div>` : '<div class="notes-stats-empty-copy">No hay notas con ubicación en esta carpeta.</div>'}
      <label class="field">
        <span class="field-label">Agrupar ubicaciones por</span>
        <select class="field-select" data-act="set-location-grouping">
          <option value="country" ${activeLocationGrouping === "country" ? "selected" : ""}>País</option>
          <option value="region" ${activeLocationGrouping === "region" ? "selected" : ""}>Comunidad / región</option>
          <option value="province" ${activeLocationGrouping === "province" ? "selected" : ""}>Provincia</option>
          <option value="city" ${activeLocationGrouping === "city" ? "selected" : ""}>Municipio / ciudad</option>
          <option value="postalCode" ${activeLocationGrouping === "postalCode" ? "selected" : ""}>Código postal</option>
          <option value="label" ${activeLocationGrouping === "label" ? "selected" : ""}>Dirección / ubicación exacta</option>
        </select>
      </label>
      ${buildStatsBarList(buildLocationClusters(locations, activeLocationGrouping), { labelFormatter: (row) => row.label, valueFormatter: (row) => `${formatNumber(row.count)} notas`, emptyText: "Sin agrupaciones de ubicación." })}
    </article>
    <article class="notes-stats-card">
      <div class="notes-stats-card-head"><h3 class="notes-stats-card-title">Notas con el mismo nombre</h3></div>
      ${duplicateGroups.length ? `<div class="notes-stats-list">${duplicateGroups.map((group) => `<button class="notes-location-option" type="button" data-act="toggle-duplicate-group" data-title-key="${escapeHtml(group.key)}">${escapeHtml(group.title)} · ${formatNumber(group.count)} notas</button><div class="notes-stats-list hidden" id="notes-duplicate-${escapeHtml(group.key)}">${group.notes.map((note) => `<button class="notes-location-option" type="button" data-act="open-note-from-stats" data-note-id="${escapeHtml(note.id)}">${escapeHtml(note.title || "Sin título")}</button>`).join("")}</div>`).join("")}</div>` : '<div class="notes-stats-empty-copy">No hay nombres repetidos en esta carpeta.</div>'}
    </article>
  `;
  renderNotesNationalitiesWorldMap(insights);
  if (locations.length) initStatsMap(locations);
  console.debug("[notes:map] section rendered");
}

function hasRealLocationCoordinates(lat, lng) {
  const safeLat = Number(lat);
  const safeLng = Number(lng);
  return Number.isFinite(safeLat) && Number.isFinite(safeLng) && !(safeLat === 0 && safeLng === 0);
}
function collectNoteLocations(notes = []) {
  return (notes || [])
    .map((note) => ({
      ...note.location,
      ...getNoteLocationDetails(note),
      noteId: note.id,
      noteTitle: getNoteDisplayTitle(note) || note.title || "Sin titulo",
    }))
    .filter((loc) => hasRealLocationCoordinates(loc?.lat || loc?.coords?.lat, loc?.lng || loc?.coords?.lng));
}
function buildLocationClusters(locations = [], level = "country") {
  const map = new Map();
  locations.forEach((loc) => {
    const raw = getLocationValueForLevel(loc, level);
    const label = raw || String(
      loc?.address
      || loc?.label
      || loc?.exactAddress
      || loc?.text
      || getLocationValueForLevel(loc, "city")
      || getLocationValueForLevel(loc, "region")
      || getLocationValueForLevel(loc, "country")
      || "Ubicacion sin nombre"
    ).trim();
    const key = label.toLocaleLowerCase("es");
    const prev = map.get(key) || { label, count: 0 };
    prev.count += 1;
    map.set(key, prev);
  });
  return Array.from(map.values()).sort((a, b) => b.count - a.count);
}
function normalizeTitleKey(title = "") { return normalizeNoteLookup(title); }
function buildDuplicateTitleGroups(notes = []) {
  const groups = new Map();
  notes.forEach((note) => {
    const baseTitle = getNoteBaseTitle(note);
    const key = normalizeTitleKey(baseTitle);
    if (!key) return;
    const group = groups.get(key) || { key: encodeURIComponent(key), title: baseTitle.trim(), count: 0, notes: [] };
    group.count += 1;
    group.notes.push({
      ...note,
      title: getNoteDisplayTitle(note) || note?.title || "Sin titulo",
    });
    groups.set(key, group);
  });
  return Array.from(groups.values()).filter((group) => group.count > 1);
}

function buildStatsSingleMarkerPopupMarkup(location = {}) {
  const title = escapeHtml(location.noteTitle || "Nota");
  const subtitle = escapeHtml(location.address || location.label || location.text || "Ubicacion");
  const noteId = escapeHtml(location.noteId || "");
  return `
    <div class="notes-map-cluster-popup">
      <div class="notes-map-cluster-popup-title">${title}</div>
      <div class="notes-location-option-meta">${subtitle}</div>
      ${noteId ? `<button class="notes-map-cluster-popup-note" type="button" data-act="open-map-note" data-note-id="${noteId}">Abrir nota</button>` : ""}
    </div>
  `;
}

function buildStatsClusterPopupMarkup(cluster = {}) {
  return `
    <div class="notes-map-cluster-popup">
      <div class="notes-map-cluster-popup-title">${escapeHtml(`${formatNumber(cluster.items?.length || 0)} notas agrupadas`)}</div>
      <div class="notes-map-cluster-popup-list">
        ${(cluster.items || []).slice(0, 8).map((item) => `
          <button class="notes-map-cluster-popup-note" type="button" data-act="open-map-note" data-note-id="${escapeHtml(item.noteId || "")}">
            ${escapeHtml(item.noteTitle || "Nota")}
          </button>
        `).join("")}
      </div>
    </div>
  `;
}

function createStatsClusterIcon(leaflet, count = 0) {
  const safeCount = Math.max(1, Number(count || 0));
  return leaflet.divIcon({
    className: "notes-map-cluster-icon",
    html: `<span class="notes-map-cluster${safeCount >= 10 ? " is-large" : ""}"><span class="notes-map-cluster-count">${escapeHtml(String(safeCount))}</span></span>`,
    iconSize: safeCount >= 10 ? [38, 38] : [34, 34],
    iconAnchor: safeCount >= 10 ? [19, 19] : [17, 17],
  });
}

function buildStatsMapClusters(map, locations = []) {
  const zoom = Number(map?.getZoom?.() || DEFAULT_MAP_ZOOM_SPAIN);
  const cellSize = zoom >= 11 ? 34 : zoom >= 9 ? 42 : 54;
  const groups = new Map();

  locations.forEach((loc) => {
    const lat = Number(loc.lat || loc.coords?.lat);
    const lng = Number(loc.lng || loc.coords?.lng);
    if (!hasRealLocationCoordinates(lat, lng)) return;
    const projected = map.project([lat, lng], zoom);
    const key = `${Math.floor(projected.x / cellSize)}:${Math.floor(projected.y / cellSize)}`;
    const group = groups.get(key) || {
      items: [],
      latSum: 0,
      lngSum: 0,
      coordKeys: new Set(),
    };
    group.items.push({ ...loc, lat, lng });
    group.latSum += lat;
    group.lngSum += lng;
    group.coordKeys.add(`${lat.toFixed(6)},${lng.toFixed(6)}`);
    groups.set(key, group);
  });

  return Array.from(groups.values()).map((group) => ({
    items: group.items,
    lat: group.latSum / Math.max(1, group.items.length),
    lng: group.lngSum / Math.max(1, group.items.length),
    coordCount: group.coordKeys.size,
  }));
}

function zoomToStatsCluster(map, leaflet, cluster = {}) {
  const points = (cluster.items || []).map((item) => [item.lat, item.lng]);
  if (!points.length) return;
  const currentZoom = Number(map.getZoom?.() || 0);
  if ((cluster.coordCount || 0) <= 1 || points.length <= 1) {
    if (currentZoom >= 14) return;
    map.setView(points[0], Math.min(16, Math.max(currentZoom + 2, 12)));
    return;
  }
  const bounds = leaflet.latLngBounds(points);
  map.fitBounds(bounds, {
    padding: [40, 40],
    maxZoom: Math.max(currentZoom + 2, 14),
  });
}

async function initStatsMap(locations = []) {
  const el = $id("notes-stats-map");
  if (!el) return;

  try {
    if (typeof el.__notesMapClusterCleanup === "function") {
      try { el.__notesMapClusterCleanup(); } catch (_) {}
      delete el.__notesMapClusterCleanup;
    }
    const leaflet = await ensureLeaflet();
    if (!leaflet?.map) return;
    const map = createLeafletMap(el, {
      center: DEFAULT_MAP_CENTER_SPAIN,
      zoom: DEFAULT_MAP_ZOOM_SPAIN,
    });
    if (!map) return;

    const dotIcon = leaflet.divIcon({
      className: "notes-map-dot-icon",
      html: '<span class="notes-map-dot" aria-hidden="true"></span>',
      iconSize: [12, 12],
      iconAnchor: [6, 6],
    });
    const markers = locations
      .map((loc) => ({
        lat: Number(loc.lat || loc.coords?.lat),
        lng: Number(loc.lng || loc.coords?.lng),
      }))
      .filter((point) => hasRealLocationCoordinates(point.lat, point.lng));
    const layer = leaflet.layerGroup().addTo(map);

    locations.forEach((loc) => {
      const lat = Number(loc.lat || loc.coords?.lat);
      const lng = Number(loc.lng || loc.coords?.lng);
      if (!hasRealLocationCoordinates(lat, lng)) return;
      const marker = leaflet.marker([lat, lng], { icon: dotIcon }).addTo(map);
      marker.bindPopup(escapeHtml(`${loc.noteTitle || "Nota"} · ${loc.address || loc.label || loc.text || "Ubicacion"}`));
      markers.push({ lat, lng, marker });
    });

    const renderClusters = () => {
      layer.clearLayers();
      buildStatsMapClusters(map, locations).forEach((cluster) => {
        if ((cluster.items || []).length <= 1) {
          const item = cluster.items[0];
          if (!item) return;
          const marker = leaflet.marker([item.lat, item.lng], { icon: dotIcon }).addTo(layer);
          marker.bindPopup(buildStatsSingleMarkerPopupMarkup(item));
          return;
        }

        const marker = leaflet.marker([cluster.lat, cluster.lng], {
          icon: createStatsClusterIcon(leaflet, cluster.items.length),
        }).addTo(layer);
        marker.bindPopup(buildStatsClusterPopupMarkup(cluster));
        marker.on("click", () => zoomToStatsCluster(map, leaflet, cluster));
      });
    };

    setLeafletViewForPoints(map, markers, {
      defaultCenter: DEFAULT_MAP_CENTER_SPAIN,
      defaultZoom: DEFAULT_MAP_ZOOM_SPAIN,
      maxAutoZoom: MAX_AUTO_ZOOM,
      singlePointZoom: MAX_AUTO_ZOOM,
    });
    markers.forEach((point) => {
      try { point.marker?.remove?.(); } catch (_) {}
    });
    renderClusters();
    map.on("zoomend", renderClusters);
    map.on("moveend", renderClusters);
    el.__notesMapClusterCleanup = () => {
      map.off("zoomend", renderClusters);
      map.off("moveend", renderClusters);
      try { layer.clearLayers(); } catch (_) {}
    };
    invalidateLeafletMap(map, 50);
  } catch (error) {
    console.warn("[notes:map] no se pudo cargar Leaflet", error);
  }
}

function normalizeLocationLookup(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function clearLocationSuggestionList() {
  const list = $id("notes-note-location-suggestions");
  if (!list) return;
  list.classList.add("hidden");
  list.innerHTML = "";
}

function clearSelectedLocationFields({ preserveSearchValue = true } = {}) {
  const search = $id("notes-note-location-search");
  const searchValue = preserveSearchValue ? String(search?.value || "") : "";
  if (search) search.value = searchValue;
  $id("notes-note-location-label").value = "";
  $id("notes-note-location-country").value = "";
  $id("notes-note-location-region").value = "";
  $id("notes-note-location-province").value = "";
  $id("notes-note-location-city").value = "";
  $id("notes-note-location-municipality").value = "";
  $id("notes-note-location-postal-code").value = "";
  $id("notes-note-location-lat").value = "";
  $id("notes-note-location-lng").value = "";
  $id("notes-note-location-source").value = "";
  $id("notes-note-location-coords").value = "";
}

function buildLocationSuggestionKey(suggestion = {}) {
  const label = normalizeLocationLookup(suggestion?.exactAddress || suggestion?.label || suggestion?.text || "");
  const lat = Number(suggestion?.lat);
  const lng = Number(suggestion?.lng);
  if (hasRealLocationCoordinates(lat, lng)) {
    return `${label}::${lat.toFixed(5)},${lng.toFixed(5)}`;
  }
  return label;
}

function buildStoredLocationSuggestions(query = "") {
  const safeQuery = normalizeLocationLookup(query);
  if (safeQuery.length < 2) return [];

  const grouped = new Map();
  (state.notes || []).forEach((note) => {
    const location = getNoteLocationDetails(note);
    const lat = Number(note?.location?.lat ?? note?.location?.coords?.lat);
    const lng = Number(note?.location?.lng ?? note?.location?.coords?.lng);
    const haystack = normalizeLocationLookup([
      location.address,
      location.city,
      location.region,
      location.country,
      location.municipality,
      location.province,
    ].filter(Boolean).join(" "));
    if (!haystack.includes(safeQuery)) return;

    const suggestion = {
      label: location.address || location.label || location.text,
      country: location.country,
      region: location.region,
      province: location.province,
      city: location.city,
      municipality: location.municipality,
      postalCode: location.postalCode,
      exactAddress: location.address || location.label || location.text,
      lat: hasRealLocationCoordinates(lat, lng) ? lat : null,
      lng: hasRealLocationCoordinates(lat, lng) ? lng : null,
      source: hasRealLocationCoordinates(lat, lng) ? "saved" : "saved-legacy",
      noteCount: 1,
      lastUsedAt: Number(note?.updatedAt || note?.createdAt || 0),
    };
    const key = buildLocationSuggestionKey(suggestion);
    if (!key) return;
    const current = grouped.get(key);
    if (current) {
      current.noteCount += 1;
      current.lastUsedAt = Math.max(current.lastUsedAt, suggestion.lastUsedAt);
      if (!current.country && suggestion.country) current.country = suggestion.country;
      if (!current.region && suggestion.region) current.region = suggestion.region;
      if (!current.province && suggestion.province) current.province = suggestion.province;
      if (!current.city && suggestion.city) current.city = suggestion.city;
      if (!current.municipality && suggestion.municipality) current.municipality = suggestion.municipality;
      if (!current.postalCode && suggestion.postalCode) current.postalCode = suggestion.postalCode;
      if (!hasRealLocationCoordinates(current.lat, current.lng) && hasRealLocationCoordinates(suggestion.lat, suggestion.lng)) {
        current.lat = suggestion.lat;
        current.lng = suggestion.lng;
      }
      return;
    }
    grouped.set(key, suggestion);
  });

  return Array.from(grouped.values())
    .sort((a, b) => {
      const coordsDiff = Number(hasRealLocationCoordinates(b.lat, b.lng)) - Number(hasRealLocationCoordinates(a.lat, a.lng));
      if (coordsDiff !== 0) return coordsDiff;
      const countDiff = Number(b.noteCount || 0) - Number(a.noteCount || 0);
      if (countDiff !== 0) return countDiff;
      const updatedDiff = Number(b.lastUsedAt || 0) - Number(a.lastUsedAt || 0);
      if (updatedDiff !== 0) return updatedDiff;
      return String(a.label || "").localeCompare(String(b.label || ""), "es", { sensitivity: "base" });
    })
    .slice(0, 6);
}

function dedupeLocationSuggestions(items = []) {
  const merged = new Map();
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = buildLocationSuggestionKey(item);
    if (!key) return;
    const current = merged.get(key);
    if (!current) {
      merged.set(key, { ...item });
      return;
    }
    const currentScore = current.source === "saved" ? 2 : current.source === "saved-legacy" ? 1 : 0;
    const nextScore = item.source === "saved" ? 2 : item.source === "saved-legacy" ? 1 : 0;
    merged.set(key, {
      ...(nextScore >= currentScore ? current : item),
      ...(nextScore >= currentScore ? item : current),
      noteCount: Math.max(Number(current.noteCount || 0), Number(item.noteCount || 0)),
      lastUsedAt: Math.max(Number(current.lastUsedAt || 0), Number(item.lastUsedAt || 0)),
    });
  });
  return Array.from(merged.values()).slice(0, 8);
}

function buildLocationSuggestionMarkup(item = {}) {
  const parts = [];
  if (item?.source === "saved") {
    parts.push(`Guardada · ${formatNumber(item.noteCount || 1)} notas`);
  } else if (item?.source === "saved-legacy") {
    parts.push("Guardada sin coordenadas");
  } else {
    parts.push("Nueva busqueda");
  }
  if (item?.city) parts.push(item.city);
  if (item?.region && item.region !== item.city) parts.push(item.region);
  if (item?.country) parts.push(item.country);

  return `
    <button class="notes-location-option" type="button" data-act="select-location-suggestion" data-location='${escapeHtml(JSON.stringify(item))}'>
      <span class="notes-location-option-label">${escapeHtml(item.label || item.exactAddress || item.text || "Ubicacion")}</span>
      <span class="notes-location-option-meta">${escapeHtml(parts.join(" · "))}</span>
    </button>
  `;
}

function selectLocationSuggestion(suggestion = {}) {
  const details = {
    ...suggestion,
    ...getNoteLocationDetails({ location: suggestion }),
  };
  const label = String(details?.label || details?.address || details?.text || "").trim();
  const lat = Number(details?.lat);
  const lng = Number(details?.lng);
  $id("notes-note-location-search").value = label;
  $id("notes-note-location-label").value = label;
  $id("notes-note-location-country").value = details?.country || "";
  $id("notes-note-location-region").value = details?.region || "";
  $id("notes-note-location-province").value = details?.province || "";
  $id("notes-note-location-city").value = details?.city || details?.municipality || "";
  $id("notes-note-location-municipality").value = details?.municipality || "";
  $id("notes-note-location-postal-code").value = details?.postalCode || "";
  $id("notes-note-location-lat").value = hasRealLocationCoordinates(lat, lng) ? String(lat) : "";
  $id("notes-note-location-lng").value = hasRealLocationCoordinates(lat, lng) ? String(lng) : "";
  $id("notes-note-location-source").value = details?.source || "nominatim";
  $id("notes-note-location-coords").value = hasRealLocationCoordinates(lat, lng) ? `${lat}, ${lng}` : "";
  clearLocationSuggestionList();
  $id("notes-note-location-status").textContent = label ? "Ubicación seleccionada." : "Selecciona una ubicación de la lista.";
}

function emitNotesData(reason = "") {
  try {
    window.dispatchEvent(new CustomEvent("bookshell:data", { detail: { source: "notes", reason } }));
    return;
  } catch (_) {}
  try { window.dispatchEvent(new Event("bookshell:data")); } catch (_) {}
}

function $id(id) {
  return document.getElementById(id);
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[char]));
}

const EXTERNAL_LINK_PATTERN = /(?:https?:\/\/|www\.|mailto:)[^\s<>"']+|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function trimDetectedLinkText(value = "") {
  let safe = String(value || "").trim();
  while (/[),.;!?]$/.test(safe)) {
    const lastChar = safe.slice(-1);
    if (lastChar === ")" && ((safe.match(/\(/g) || []).length >= (safe.match(/\)/g) || []).length)) break;
    safe = safe.slice(0, -1);
  }
  return safe;
}

function normalizeDetectedExternalHref(rawValue = "") {
  const raw = trimDetectedLinkText(rawValue);
  if (!raw) return "";
  if (/^mailto:/i.test(raw)) {
    const address = raw.slice(7).trim();
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : "";
  }
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(raw)) {
    return `mailto:${raw}`;
  }
  return normalizeExternalUrl(raw);
}

function extractExternalLinksFromText(value = "") {
  const source = String(value || "");
  if (!source) return [];
  const matches = [];
  EXTERNAL_LINK_PATTERN.lastIndex = 0;
  let match = null;
  while ((match = EXTERNAL_LINK_PATTERN.exec(source))) {
    const matchedText = String(match[0] || "");
    const raw = trimDetectedLinkText(matchedText);
    const offset = matchedText.length - raw.length;
    const href = normalizeDetectedExternalHref(raw);
    if (!raw || !href) continue;
    matches.push({
      type: "external",
      raw,
      href,
      start: match.index,
      end: match.index + raw.length,
      trimOffset: offset,
    });
  }
  return matches;
}

function getFriendlyExternalLinkLabel(href = "") {
  const safeHref = String(href || "").trim();
  if (!safeHref) return "Enlace";
  if (/^mailto:/i.test(safeHref)) return "Correo";
  try {
    const url = new URL(safeHref);
    const host = String(url.hostname || "").toLowerCase().replace(/^www\./, "");
    const path = `${url.pathname || ""}${url.search || ""}`.toLowerCase();
    if (host.includes("mail.google.com") || host.includes("gmail.com")) return "Correo";
    if (host.includes("drive.google.com")) return "Drive";
    if (host.includes("maps.google.") || host.includes("google.com") && path.includes("/maps") || host.includes("maps.app.goo.gl")) return "Mapa";
    if (host.includes("youtube.com") || host.includes("youtu.be")) return "YouTube";
    return host || "Enlace";
  } catch (_) {
    return safeHref.replace(/^mailto:/i, "") || "Enlace";
  }
}

function escapePlainTextWithBreaks(value = "") {
  return escapeHtml(String(value || "")).replace(/\n/g, "<br>");
}

function buildExternalLinkAnchorMarkup(link, {
  className = "notes-detected-link",
  displayText = "",
} = {}) {
  const href = String(link?.href || "").trim();
  if (!href) return escapePlainTextWithBreaks(displayText || link?.raw || "");
  const label = String(displayText || link?.raw || href).trim() || href;
  return `
    <a
      class="${escapeHtml(className)}"
      href="${escapeHtml(href)}"
      target="_blank"
      rel="noopener noreferrer"
      data-external-link="true"
    >${escapePlainTextWithBreaks(label)}</a>
  `;
}

function buildSafeLinkedTextMarkup(value = "", { className = "notes-detected-link" } = {}) {
  const source = String(value || "");
  if (!source) return "";
  const matches = extractExternalLinksFromText(source);
  if (!matches.length) return escapePlainTextWithBreaks(source);
  let cursor = 0;
  let markup = "";
  matches.forEach((link) => {
    if (link.start < cursor) return;
    markup += escapePlainTextWithBreaks(source.slice(cursor, link.start));
    markup += buildExternalLinkAnchorMarkup(link, { className });
    cursor = link.end;
  });
  markup += escapePlainTextWithBreaks(source.slice(cursor));
  return markup;
}

function collectExternalLinksFromValues(...values) {
  const seen = new Set();
  const links = [];
  values.flat().forEach((value) => {
    extractExternalLinksFromText(value).forEach((item) => {
      const href = String(item?.href || "").trim();
      if (!href || seen.has(href)) return;
      seen.add(href);
      links.push(item);
    });
  });
  return links;
}

function buildDetectedLinksListMarkup(links = [], { empty = "" } = {}) {
  const safeLinks = Array.isArray(links) ? links.filter((item) => String(item?.href || "").trim()) : [];
  if (!safeLinks.length) return empty;
  return `
    <div class="notes-links-preview">
      ${safeLinks.map((link) => `
        <a
          class="notes-links-preview__item"
          href="${escapeHtml(link.href)}"
          target="_blank"
          rel="noopener noreferrer"
          data-external-link="true"
          title="${escapeHtml(link.href)}"
        >
          <span class="notes-links-preview__label">${escapeHtml(getFriendlyExternalLinkLabel(link.href))}</span>
          <span class="notes-links-preview__sep"> - </span>
          <span class="notes-links-preview__url">${escapeHtml(link.raw || link.href)}</span>
        </a>
      `).join("")}
    </div>
  `;
}

function getNoteAttachmentImages(note = {}) {
  return Array.isArray(note?.attachments?.images)
    ? note.attachments.images.filter((item) => item?.id && item?.url)
    : [];
}

function collectNoteExternalLinks(note = {}) {
  const values = [note?.title || "", note?.content || ""];
  if (note?.type === "link" && note?.url) values.push(note.url);
  if (normalizeNoteKind(note?.noteKind) === "persona") {
    values.push(note?.person?.phone || "", note?.person?.socials || "", note?.person?.address || "");
  }
  return collectExternalLinksFromValues(values);
}

function collectReminderExternalLinks(reminder = {}) {
  return collectExternalLinksFromValues(reminder?.title || "", reminder?.description || "");
}

function getReminderSelectedOccurrenceDateKey(reminder = {}) {
  if (!reminder?.targetDate) return "";
  const selectedYear = parseDateKey(state.reminderCalendarSelectedDate || "")?.year || new Date().getFullYear();
  return getReminderOccurrenceDateKey(
    reminder,
    reminder?.repeat === "yearly" ? selectedYear : null,
  );
}

function getFolderLabelById(folderId = "") {
  return String(state.folders.find((folder) => folder.id === String(folderId || "").trim())?.name || "").trim();
}

function resetNoteLinkAutocompleteState() {
  noteLinkAutocompleteState = { start: -1, end: -1, activeIndex: 0, items: [], query: "" };
}

function clearNoteLinkSuggestionList() {
  const host = $id("notes-note-link-suggestions");
  if (host) {
    host.classList.add("hidden");
    host.innerHTML = "";
  }
  resetNoteLinkAutocompleteState();
}

function buildNoteLinkSuggestions(query = "", currentNoteId = "") {
  const lookup = normalizeNoteLookup(query);
  const safeCurrentNoteId = String(currentNoteId || "").trim();

  return (state.notes || [])
    .filter((note) => note?.id && note.id !== safeCurrentNoteId)
    .map((note) => {
      const person = getNotePersonFields(note);
      const label = getNoteDisplayTitle(note) || "Sin titulo";
      const baseName = getNoteBaseTitle(note) || label;
      const folderLabel = getFolderLabelById(note?.folderId);
      const searchText = normalizeNoteLookup([
        label,
        baseName,
        note?.title,
        note?.name,
        person.firstName,
        person.lastName,
        person.nationality,
      ].filter(Boolean).join(" "));
      const meta = [];
      if (normalizeNoteKind(note?.noteKind) === "persona") {
        if (person.nationality) meta.push(person.nationality);
        else meta.push("Persona");
      }
      if (folderLabel) meta.push(folderLabel);
      return {
        note,
        id: note.id,
        label,
        baseName,
        meta: meta.join(" · "),
        searchText,
      };
    })
    .filter((item) => !lookup || item.searchText.includes(lookup))
    .sort((a, b) => {
      const aBase = normalizeNoteLookup(a.baseName);
      const bBase = normalizeNoteLookup(b.baseName);
      const aLabel = normalizeNoteLookup(a.label);
      const bLabel = normalizeNoteLookup(b.label);
      const aStarts = lookup ? Number(aBase.startsWith(lookup) || aLabel.startsWith(lookup)) : 1;
      const bStarts = lookup ? Number(bBase.startsWith(lookup) || bLabel.startsWith(lookup)) : 1;
      if (bStarts !== aStarts) return bStarts - aStarts;
      const updatedDiff = Number(b.note?.updatedAt || b.note?.createdAt || 0) - Number(a.note?.updatedAt || a.note?.createdAt || 0);
      if (updatedDiff !== 0) return updatedDiff;
      return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
    })
    .slice(0, 8);
}

function renderNoteLinkSuggestions() {
  const host = $id("notes-note-link-suggestions");
  const items = noteLinkAutocompleteState.items || [];
  if (!host) return;
  if (!items.length) {
    host.classList.add("hidden");
    host.innerHTML = "";
    return;
  }

  host.innerHTML = items.map((item, index) => `
    <button
      class="notes-note-link-option${index === noteLinkAutocompleteState.activeIndex ? " is-active" : ""}"
      type="button"
      data-act="select-note-link-suggestion"
      data-note-id="${escapeHtml(item.id)}"
      role="option"
      aria-selected="${index === noteLinkAutocompleteState.activeIndex ? "true" : "false"}"
    >
      <span class="notes-note-link-option-label">${escapeHtml(item.label)}</span>
      <span class="notes-note-link-option-meta">${escapeHtml(item.meta || "Nota")}</span>
    </button>
  `).join("");
  host.classList.remove("hidden");
}

function refreshNoteLinkSuggestions({ resetActiveIndex = false } = {}) {
  const textarea = $id("notes-note-content");
  if (!textarea || normalizeNoteKind($id("notes-note-kind")?.value) === "code") {
    clearNoteLinkSuggestionList();
    return;
  }

  const match = findActiveNoteLinkQuery(textarea.value || "", textarea.selectionStart || 0);
  if (!match) {
    clearNoteLinkSuggestionList();
    return;
  }

  const currentNoteId = String($id("notes-note-id")?.value || "").trim();
  const items = buildNoteLinkSuggestions(match.query, currentNoteId);
  if (!items.length) {
    clearNoteLinkSuggestionList();
    return;
  }

  noteLinkAutocompleteState = {
    ...match,
    items,
    activeIndex: resetActiveIndex ? 0 : Math.max(0, Math.min(noteLinkAutocompleteState.activeIndex || 0, items.length - 1)),
  };
  renderNoteLinkSuggestions();
}

function moveNoteLinkSuggestion(delta = 1) {
  const items = noteLinkAutocompleteState.items || [];
  if (!items.length) return false;
  const total = items.length;
  const currentIndex = Number(noteLinkAutocompleteState.activeIndex || 0);
  noteLinkAutocompleteState.activeIndex = (currentIndex + delta + total) % total;
  renderNoteLinkSuggestions();
  return true;
}

function selectNoteLinkSuggestion(noteId = "") {
  const textarea = $id("notes-note-content");
  const safeNoteId = String(noteId || "").trim();
  const item = (noteLinkAutocompleteState.items || []).find((entry) => entry.id === safeNoteId);
  if (!textarea || !item) return;

  const token = `[[${getNoteDisplayTitle(item.note) || item.label}]]`;
  if (!token) return;

  const value = String(textarea.value || "");
  const start = Math.max(0, Number(noteLinkAutocompleteState.start || 0));
  const end = Math.max(start, Number(noteLinkAutocompleteState.end || start));
  textarea.value = `${value.slice(0, start)}${token}${value.slice(end)}`;
  noteLinkDraftReferences.push({
    label: normalizeNoteTextValue(getNoteDisplayTitle(item.note) || item.label),
    targetId: safeNoteId,
  });
  const caret = start + token.length;
  textarea.focus();
  textarea.setSelectionRange(caret, caret);
  $id("notes-note-form-error").textContent = "";
  clearNoteLinkSuggestionList();
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function buildInlineNotePreviewMarkup(note = {}) {
  const content = String(note?.content || "");
  const links = buildResolvedWikiLinks(note);
  if (!links.length) return "";

  let cursor = 0;
  let html = "";
  links.forEach((link) => {
    html += escapeHtml(content.slice(cursor, link.start));
    const target = resolveWikiLinkTarget(link);
    const label = target ? (getNoteDisplayTitle(target) || link.label) : (link.label || "Enlace");
    html += target
      ? `<button class="notes-inline-link" type="button" data-act="open-linked-note" data-linked-note-id="${escapeHtml(target.id)}">${escapeHtml(label)}</button>`
      : `<span class="notes-inline-link-broken" title="Nota no disponible">${escapeHtml(label)}</span>`;
    cursor = link.end;
  });
  html += escapeHtml(content.slice(cursor));
  return html.trim();
}

function tint(color, alpha = 0.18) {
  const hex = String(color || "").replace("#", "");
  if (hex.length !== 6) return `rgba(127,93,255,${alpha})`;
  const value = parseInt(hex, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

function openModal(backdropId) {
  const el = $id(backdropId);
  if (!el) return;
  el.classList.remove("hidden");
  document.body.classList.add("has-open-modal");
}

function closeModal(backdropId) {
  const el = $id(backdropId);
  if (!el) return;
  el.classList.add("hidden");
  if (!document.querySelector(".modal-backdrop:not(.hidden)")) {
    document.body.classList.remove("has-open-modal");
  }
}

function pluralize(value, singular, plural) {
  return `${value} ${value === 1 ? singular : plural}`;
}

function normalizeNoteRatingValue(value = null) {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.max(0, Math.min(10, Math.round(numeric)));
}

function normalizeNoteKind(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["text", "code", "persona"].includes(safe) ? safe : "text";
}

function normalizeCodeLanguage(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["css", "html", "js", "general"].includes(safe) ? safe : "general";
}

function normalizeNoteTextValue(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function normalizeDuplicateTitleValue(value = "") {
  const normalized = normalizeNoteTextValue(value).toLowerCase();
  return normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function normalizeDuplicatePhoneValue(value = "") {
  const compact = String(value || "").trim().replace(/[\s()-]+/g, "");
  const withInternationalPrefix = compact.replace(/^00(?=\d)/, "+");
  const cleaned = withInternationalPrefix.replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  if (!cleaned.startsWith("+")) return cleaned.replace(/\+/g, "");
  return `+${cleaned.slice(1).replace(/\+/g, "")}`;
}

function getDuplicateTitleCandidatesForNote(note = {}) {
  const person = getNotePersonFields(note);
  const fullPersonName = normalizeNoteTextValue([person.firstName, person.lastName].filter(Boolean).join(" "));
  return Array.from(new Set([
    note?.title,
    note?.name,
    getNoteDisplayTitle(note),
    fullPersonName,
    person.firstName,
  ].map((value) => normalizeDuplicateTitleValue(value)).filter(Boolean)));
}

function getDuplicateTitleCandidatesForDraft({
  title = "",
  firstName = "",
  lastName = "",
} = {}) {
  const normalizedFirstName = normalizeNoteTextValue(firstName);
  const normalizedLastName = normalizeNoteTextValue(lastName);
  const fullPersonName = normalizeNoteTextValue([normalizedFirstName, normalizedLastName].filter(Boolean).join(" "));
  return Array.from(new Set([
    title,
    normalizedFirstName,
    fullPersonName,
  ].map((value) => normalizeDuplicateTitleValue(value)).filter(Boolean)));
}

function collectPotentialDuplicateNotes({
  noteId = "",
  title = "",
  firstName = "",
  lastName = "",
  phone = "",
} = {}) {
  const safeNoteId = String(noteId || "").trim();
  const titleCandidates = getDuplicateTitleCandidatesForDraft({ title, firstName, lastName });
  const phoneCandidate = normalizeDuplicatePhoneValue(phone);
  const matches = [];

  (state.notes || []).forEach((note) => {
    if (!note?.id || note.id === safeNoteId) return;
    const reasons = [];
    const existingTitleCandidates = getDuplicateTitleCandidatesForNote(note);
    if (titleCandidates.length && titleCandidates.some((candidate) => existingTitleCandidates.includes(candidate))) {
      reasons.push("title");
    }
    const existingPhone = normalizeDuplicatePhoneValue(note?.person?.phone || note?.phone || "");
    if (phoneCandidate && existingPhone && existingPhone === phoneCandidate) {
      reasons.push("phone");
    }
    if (!reasons.length) return;
    matches.push({
      noteId: note.id,
      label: getNoteDisplayTitle(note) || normalizeNoteTextValue(note?.title || note?.name || "Sin titulo"),
      reasons,
    });
  });

  return matches.sort((left, right) => left.label.localeCompare(right.label, "es"));
}

function getDuplicateCheckSignature({
  noteId = "",
  title = "",
  firstName = "",
  lastName = "",
  phone = "",
} = {}) {
  return JSON.stringify({
    noteId: String(noteId || "").trim(),
    title: getDuplicateTitleCandidatesForDraft({ title, firstName, lastName }),
    phone: normalizeDuplicatePhoneValue(phone),
  });
}

function formatDuplicateReasons(reasons = []) {
  const labels = [];
  if (reasons.includes("title")) labels.push("titulo");
  if (reasons.includes("phone")) labels.push("telefono");
  return labels.join(" y ");
}

function buildDuplicateWarningMarkup(matches = [], options = {}) {
  const safeMatches = Array.isArray(matches) ? matches : [];
  const title = String(options.title || "").trim() || "Posible duplicado";
  const continueAction = String(options.continueAction || "").trim();
  const dismissAction = String(options.dismissAction || "").trim();
  return `
    <p class="notes-duplicate-warning-title">${escapeHtml(title)}</p>
    <div class="notes-duplicate-warning-list">
      ${safeMatches.map((match) => `
        <div class="notes-duplicate-warning-item">
          <div class="notes-duplicate-warning-copy">
            <div class="notes-duplicate-warning-name">${escapeHtml(match.label || "Sin titulo")}</div>
            <div class="notes-duplicate-warning-meta">motivo: ${escapeHtml(formatDuplicateReasons(match.reasons))}</div>
          </div>
          <button class="btn ghost btn-compact" type="button" data-act="open-duplicate-note" data-note-id="${escapeHtml(match.noteId)}">Ver</button>
        </div>
      `).join("")}
    </div>
    <div class="notes-duplicate-warning-actions">
      <button class="btn primary btn-compact" type="button" data-act="${escapeHtml(continueAction)}">Guardar igualmente</button>
      <button class="btn ghost btn-compact" type="button" data-act="${escapeHtml(dismissAction)}">Seguir editando</button>
    </div>
  `;
}

function hideNoteDuplicateWarning() {
  const warning = $id("notes-note-duplicate-warning");
  if (!warning) return;
  warning.innerHTML = "";
  warning.classList.add("hidden");
}

function renderNoteDuplicateWarning(matches = []) {
  const warning = $id("notes-note-duplicate-warning");
  if (!warning) return;
  warning.innerHTML = buildDuplicateWarningMarkup(matches, {
    title: matches.length > 1 ? "Posibles duplicados detectados" : "Posible duplicado detectado",
    continueAction: "confirm-note-duplicate-save",
    dismissAction: "dismiss-note-duplicate-warning",
  });
  warning.classList.remove("hidden");
}

function hideNoteDetailDuplicateWarning() {
  const warning = $id("notes-detail-duplicate-warning");
  if (!warning) return;
  warning.innerHTML = "";
  warning.classList.add("hidden");
}

function renderNoteDetailDuplicateWarning(matches = []) {
  const warning = $id("notes-detail-duplicate-warning");
  if (!warning) return;
  warning.innerHTML = buildDuplicateWarningMarkup(matches, {
    title: matches.length > 1 ? "Posibles duplicados detectados" : "Posible duplicado detectado",
    continueAction: "confirm-save-person-detail",
    dismissAction: "dismiss-note-detail-duplicate-warning",
  });
  warning.classList.remove("hidden");
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
    phone: String(note?.person?.phone || "").trim(),
    birthday: String(note?.person?.birthday || "").trim(),
    address: String(note?.person?.address || "").trim(),
    socials: String(note?.person?.socials || "").trim(),
  };
}

function getNoteDisplayTitle(note = {}) {
  const fallbackTitle = normalizeNoteTextValue(note?.title || note?.name || "");
  if (normalizeNoteKind(note?.noteKind) !== "persona") return fallbackTitle;
  const person = getNotePersonFields(note);
  return normalizeNoteTextValue([person.firstName || fallbackTitle, person.lastName].filter(Boolean).join(" ")) || fallbackTitle;
}

function getNoteBaseTitle(note = {}) {
  const fallbackTitle = normalizeNoteTextValue(note?.title || note?.name || "");
  if (normalizeNoteKind(note?.noteKind) !== "persona") return fallbackTitle;
  const person = getNotePersonFields(note);
  return person.firstName || fallbackTitle;
}

function stripWikiLinkMarkup(value = "") {
  return String(value || "").replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, label = "") => normalizeNoteTextValue(label));
}

function parseWikiLinks(value = "") {
  const text = String(value || "");
  const matches = [];
  const regex = /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g;
  let match = regex.exec(text);
  while (match) {
    matches.push({
      raw: match[0],
      start: match.index,
      end: match.index + match[0].length,
      label: normalizeNoteTextValue(match[1] || ""),
      targetId: String(match[2] || "").trim(),
    });
    match = regex.exec(text);
  }
  return matches;
}

function normalizeNoteLinkRefs(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const label = normalizeNoteTextValue(entry?.label);
      const targetId = String(entry?.targetId || "").trim();
      if (!label || !targetId) return null;
      return { label, targetId };
    })
    .filter(Boolean);
}

function buildResolvedWikiLinks(note = {}) {
  const linkRefs = normalizeNoteLinkRefs(note?.linkRefs);
  const refQueues = new Map();
  linkRefs.forEach((ref) => {
    const key = normalizeNoteLookup(ref.label);
    refQueues.set(key, [...(refQueues.get(key) || []), ref]);
  });

  return parseWikiLinks(note?.content || "").map((link) => {
    if (link.targetId) return link;
    const key = normalizeNoteLookup(link.label);
    const queue = refQueues.get(key) || [];
    const ref = queue.shift() || null;
    refQueues.set(key, queue);
    return {
      ...link,
      targetId: ref?.targetId || "",
    };
  });
}

function sanitizeNoteContentForEditor(note = {}) {
  const content = String(note?.content || "");
  noteLinkDraftReferences = buildResolvedWikiLinks(note)
    .filter((link) => link?.targetId)
    .map((link) => ({
      label: normalizeNoteTextValue(link.label),
      targetId: String(link.targetId || "").trim(),
    }));
  return content.replace(/\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g, (_, label = "") => `[[${normalizeNoteTextValue(label)}]]`);
}

function buildNoteLinkRefsFromEditorContent(content = "") {
  const refsByLabel = new Map();
  normalizeNoteLinkRefs(noteLinkDraftReferences).forEach((ref) => {
    const key = normalizeNoteLookup(ref.label);
    refsByLabel.set(key, [...(refsByLabel.get(key) || []), ref]);
  });

  return parseWikiLinks(content).reduce((acc, link) => {
    const key = normalizeNoteLookup(link.label);
    const queue = refsByLabel.get(key) || [];
    const nextRef = queue.shift() || null;
    refsByLabel.set(key, queue);

    if (nextRef?.targetId) {
      acc.push({
        label: normalizeNoteTextValue(link.label),
        targetId: nextRef.targetId,
      });
      return acc;
    }

    const fallback = resolveWikiLinkTarget({ label: link.label, targetId: "" });
    if (fallback?.id) {
      acc.push({
        label: normalizeNoteTextValue(link.label),
        targetId: fallback.id,
      });
    }
    return acc;
  }, []);
}

function normalizeNoteLookup(value = "") {
  return String(value || "")
    .trim()
    .toLocaleLowerCase("es")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function findActiveNoteLinkQuery(text = "", caretIndex = 0) {
  const safeText = String(text || "");
  const safeCaret = Math.max(0, Math.min(safeText.length, Number(caretIndex) || 0));
  const beforeCaret = safeText.slice(0, safeCaret);
  const openIndex = beforeCaret.lastIndexOf("[[");
  if (openIndex < 0) return null;
  const fragment = beforeCaret.slice(openIndex + 2);
  if (!fragment || fragment.includes("]]") || fragment.includes("|") || /[\r\n]/.test(fragment)) {
    return null;
  }
  return {
    start: openIndex,
    end: safeCaret,
    query: normalizeNoteTextValue(fragment),
  };
}

function buildNoteLinkToken(note = {}) {
  const label = getNoteDisplayTitle(note) || normalizeNoteTextValue(note?.title || note?.name || "");
  const id = String(note?.id || "").trim();
  if (!label || !id) return "";
  return `[[${label}|${id}]]`;
}

function resolveWikiLinkTarget(link = {}) {
  const targetId = String(link?.targetId || "").trim();
  if (targetId) {
    return state.notes.find((note) => note.id === targetId) || null;
  }

  const lookup = normalizeNoteLookup(link?.label || "");
  if (!lookup) return null;

  const matches = (state.notes || []).filter((note) => {
    const values = [
      getNoteDisplayTitle(note),
      getNoteBaseTitle(note),
      String(note?.title || ""),
      String(note?.name || ""),
    ].map((value) => normalizeNoteLookup(value));
    return values.includes(lookup);
  });

  return matches.length === 1 ? matches[0] : null;
}

function formatNumber(value = 0) {
  return NUMBER_FORMATTER.format(Number(value || 0));
}

function normalizeLocationAddress(result = {}) {
  const address = result?.address || {};
  const fallbackRegion = String(address.state || address.region || "").trim();
  const fallbackProvince = String(address.province || address.county || "").trim();
  const fallbackCity = String(address.city || address.town || address.village || address.municipality || "").trim();
  const fallbackStreet = [String(address.road || "").trim(), String(address.house_number || "").trim()].filter(Boolean).join(" ").trim();
  const label = String(result?.display_name || result?.label || "").trim();
  return {
    label: label || fallbackStreet,
    country: String(address.country || result?.country || "").trim(),
    region: String(result?.region || fallbackRegion).trim(),
    province: String(result?.province || fallbackProvince).trim(),
    city: String(result?.city || fallbackCity).trim(),
    municipality: String(result?.municipality || address.municipality || "").trim(),
    postalCode: String(result?.postalCode || address.postcode || "").trim(),
    exactAddress: String(result?.exactAddress || fallbackStreet || label).trim(),
    lat: Number(result?.lat),
    lng: Number(result?.lon ?? result?.lng),
    source: String(result?.source || "nominatim").trim() || "nominatim",
  };
}

function getLocationValueForLevel(location = {}, level = "country") {
  const details = getNoteLocationDetails({ location });
  const byLevel = {
    country: details.country,
    region: details.region,
    province: details.province,
    city: details.city || details.municipality,
    postalCode: details.postalCode,
    label: details.address || details.label || details.text,
  };
  return String(byLevel[level] || "").trim();
}

async function searchLocationSuggestions(query = "") {
  const safe = String(query || "").trim();
  if (safe.length < 3) return [];
  try {
    const stored = buildStoredLocationSuggestions(safe);
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&limit=6&q=${encodeURIComponent(safe)}`;
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const data = await response.json();
    const remote = (Array.isArray(data) ? data : [])
      .map((item) => normalizeLocationAddress(item))
      .filter((item) => Number.isFinite(item.lat) && Number.isFinite(item.lng));
    return dedupeLocationSuggestions([...stored, ...remote]);
  } catch (error) {
    console.warn("[notes:location] autocomplete failed", error);
    return buildStoredLocationSuggestions(safe);
  }
}

function formatDecimal(value = 0, digits = 1) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return numeric.toLocaleString("es-ES", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatCompactNumber(value = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0";
  return COMPACT_NUMBER_FORMATTER.format(numeric);
}

function formatPercentage(value = 0) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return "0%";
  return `${Math.round(numeric)}%`;
}

function formatCompactDate(timestamp = 0) {
  const safe = Number(timestamp || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "Sin fecha";
  return SHORT_DATE_FORMATTER.format(safe);
}

function formatLongDate(timestamp = 0) {
  const safe = Number(timestamp || 0);
  if (!Number.isFinite(safe) || safe <= 0) return "Sin fecha";
  return LONG_DATE_FORMATTER.format(safe);
}

function formatReminderDateTime(reminder) {
  const safeDate = String(reminder?.targetDate || "").trim();
  if (!safeDate) return "Sin fecha";
  const safeTime = String(reminder?.targetTime || "").trim();
  const parsed = new Date(`${safeDate}T${safeTime || "23:59"}:00`);
  if (!Number.isFinite(parsed.getTime())) return "Sin fecha";
  const dateLabel = formatLongDate(parsed.getTime());
  if (!safeTime) return dateLabel;
  return `${dateLabel} · ${TIME_FORMATTER.format(parsed)}`;
}

function formatRatingValue(rating = null) {
  const safe = normalizeNoteRatingValue(rating);
  return safe === null ? "Sin rating" : `${safe}/10`;
}

function normalizeNoteVisitsCount(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;
  return Math.max(0, Math.round(numeric));
}

function buildRatingBadgeMarkup(rating = null) {
  const safe = normalizeNoteRatingValue(rating);
  if (safe === null) return "";
  return `
    <span class="notes-rating-badge" title="Rating ${safe}/10">
      <span class="notes-rating-badge-star" aria-hidden="true">★</span>
      <span class="notes-rating-badge-value">${safe}</span>
      <span class="notes-rating-badge-scale">/10</span>
    </span>
  `;
}

function buildVisitsBadgeMarkup(note = {}) {
  if (note?.type !== "link") return "";

  const visitsCount = normalizeNoteVisitsCount(note?.visitsCount);
  const lastVisitedAt = Number(note?.lastVisitedAt || 0);
  const title = lastVisitedAt > 0
    ? `${formatNumber(visitsCount)} visitas · ultima ${formatLongDate(lastVisitedAt)}`
    : `${formatNumber(visitsCount)} visitas`;

  return `
    <span class="notes-visits-badge" title="${escapeHtml(title)}">
      <span class="notes-visits-badge-icon" aria-hidden="true">👁</span>
      <span class="notes-visits-badge-value">${escapeHtml(formatNumber(visitsCount))}</span>
    </span>
  `;
}

function buildCompactNoteMetaMarkup(note = {}) {
  const items = [
    note?.person?.phone ? { icon: "📞", label: "Telefono" } : null,
    note?.person?.socials ? { icon: "📱", label: "Movil o redes" } : null,
    note?.person?.address ? { icon: "🌍 ", label: "Direccion guardada" } : null,
    note?.location?.label || note?.location?.text ? { icon: "📍", label: "Ubicacion" } : null,
    note?.person?.birthday ? { icon: "🎂", label: "Cumpleanos" } : null,
  ].filter(Boolean);

  if (!items.length) return "";

  return items.map((item) => `
    <span class="notes-item-compact-icon" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}">
      ${escapeHtml(item.icon)}
    </span>
  `).join("");
}

function buildRatingPreviewMarkup(rating = null) {
  const safe = normalizeNoteRatingValue(rating);
  if (safe === null) {
    return '<span class="notes-rating-preview-copy">Sin rating</span>';
  }

  const stars = Array.from({ length: 10 }, (_, index) => (
    `<span class="notes-rating-preview-star${index < safe ? " is-active" : ""}">★</span>`
  )).join("");

  return `
    <span class="notes-rating-preview-stars" aria-hidden="true">${stars}</span>
    <span class="notes-rating-preview-copy">${safe}/10</span>
  `;
}

function updateNoteRatingPreview() {
  const preview = $id("notes-note-rating-preview");
  const select = $id("notes-note-rating");
  if (!preview || !select) return;

  const rating = normalizeNoteRatingValue(select.value);
  preview.classList.toggle("is-empty", rating === null);
  preview.innerHTML = buildRatingPreviewMarkup(rating);
}

function updateNoteLinkDependentFields(isLink) {
  $id("notes-note-url-wrap")?.classList.toggle("hidden", !isLink);
  $id("notes-note-photo-wrap")?.classList.toggle("hidden", !isLink);
  $id("notes-note-rating-preview")?.classList.toggle("hidden", !isLink);
  $id("notes-note-tag-images")?.classList.toggle("hidden", !isLink);
  document.querySelector(".notes-rating-field")?.classList.toggle("hidden", !isLink);
}

function parseLocationCoords(rawValue = "") {
  const raw = String(rawValue || "").trim();
  if (!raw) return null;
  const match = raw.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const lat = Number(match[1]);
  const lng = Number(match[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

function formatLocationMapFallbackLabel(lat, lng) {
  return `Lat: ${Number(lat).toFixed(5)}, Lng: ${Number(lng).toFixed(5)}`;
}

function setLocationMapStatus(message = "", { isError = false } = {}) {
  const status = $id("notes-location-map-status");
  if (!status) return;
  status.textContent = String(message || "").trim();
  status.classList.toggle("is-error", Boolean(isError));
}

function getDraftLocationFromForm() {
  const locationLabel = String(
    $id("notes-note-location-label")?.value
    || $id("notes-note-location-search")?.value
    || "",
  ).trim();
  const rawLat = Number($id("notes-note-location-lat")?.value || 0);
  const rawLng = Number($id("notes-note-location-lng")?.value || 0);
  const parsedCoords = parseLocationCoords($id("notes-note-location-coords")?.value || "");
  const lat = hasRealLocationCoordinates(rawLat, rawLng) ? rawLat : Number(parsedCoords?.lat);
  const lng = hasRealLocationCoordinates(rawLat, rawLng) ? rawLng : Number(parsedCoords?.lng);
  const hasCoords = hasRealLocationCoordinates(lat, lng);
  return {
    label: locationLabel,
    exactAddress: locationLabel,
    country: String($id("notes-note-location-country")?.value || "").trim(),
    region: String($id("notes-note-location-region")?.value || "").trim(),
    province: String($id("notes-note-location-province")?.value || "").trim(),
    city: String($id("notes-note-location-city")?.value || "").trim(),
    municipality: String($id("notes-note-location-municipality")?.value || "").trim(),
    postalCode: String($id("notes-note-location-postal-code")?.value || "").trim(),
    source: String($id("notes-note-location-source")?.value || "").trim(),
    lat: hasCoords ? lat : null,
    lng: hasCoords ? lng : null,
  };
}

function syncLocationMapConfirmButton() {
  const confirmButton = $id("notes-location-map-confirm");
  if (!confirmButton) return;
  const selection = noteLocationMapState.selection;
  confirmButton.disabled = !hasRealLocationCoordinates(selection?.lat, selection?.lng);
}

function renderLocationMapSelection() {
  const selection = noteLocationMapState.selection;
  const selectionEl = $id("notes-location-map-selection");
  if (selectionEl) {
    if (hasRealLocationCoordinates(selection?.lat, selection?.lng)) {
      const parts = [
        String(selection?.label || selection?.exactAddress || "").trim() || formatLocationMapFallbackLabel(selection.lat, selection.lng),
        formatLocationMapFallbackLabel(selection.lat, selection.lng),
      ];
      selectionEl.textContent = parts.filter((part, index, list) => part && list.indexOf(part) === index).join(" · ");
    } else {
      selectionEl.textContent = "Toca el mapa o usa tu ubicaciÃ³n actual.";
    }
  }
  syncLocationMapConfirmButton();
}

function updateLocationMapMarker(selection = null) {
  const map = noteLocationMapState.map;
  const leaflet = noteLocationMapState.leaflet;
  if (!map || !leaflet?.marker) return;

  if (!hasRealLocationCoordinates(selection?.lat, selection?.lng)) {
    if (noteLocationMapState.marker?.remove) {
      try { noteLocationMapState.marker.remove(); } catch (_) {}
    }
    noteLocationMapState.marker = null;
    return;
  }

  if (!noteLocationMapState.marker) {
    noteLocationMapState.marker = leaflet.marker([selection.lat, selection.lng]).addTo(map);
  } else {
    noteLocationMapState.marker.setLatLng([selection.lat, selection.lng]);
    if (!map.hasLayer(noteLocationMapState.marker)) {
      noteLocationMapState.marker.addTo(map);
    }
  }
}

async function reverseGeocodeNoteLocation(lat, lng) {
  if (!hasRealLocationCoordinates(lat, lng)) return null;
  try {
    notesLocationReverseAbort?.abort?.();
  } catch (_) {}
  notesLocationReverseAbort = new AbortController();
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&lat=${encodeURIComponent(String(lat))}&lon=${encodeURIComponent(String(lng))}`;
    const response = await fetch(url, {
      signal: notesLocationReverseAbort.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return normalizeLocationAddress({
      ...data,
      display_name: data?.display_name || data?.name || formatLocationMapFallbackLabel(lat, lng),
      lat,
      lon: lng,
      source: "nominatim-reverse",
    });
  } catch (error) {
    if (error?.name === "AbortError") return null;
    console.warn("[notes:location-map:error]", error);
    return null;
  }
}

async function ensureNoteLocationMapReady() {
  const host = $id("notes-location-map-host");
  if (!host) return null;
  const leaflet = await ensureLeaflet();
  if (!leaflet?.map) {
    throw new Error("Leaflet no disponible.");
  }

  let map = host.__leafletMap;
  if (!map) {
    map = createLeafletMap(host, {
      center: DEFAULT_MAP_CENTER_SPAIN,
      zoom: DEFAULT_MAP_ZOOM_SPAIN,
    });
  }
  if (!map) {
    throw new Error("No se pudo crear el mapa.");
  }

  noteLocationMapState.leaflet = leaflet;
  noteLocationMapState.map = map;

  if (!noteLocationMapState.mapClickBound) {
    map.on("click", (event) => {
      const lat = Number(event?.latlng?.lat);
      const lng = Number(event?.latlng?.lng);
      void selectLocationFromMap(lat, lng, { source: "map" });
    });
    noteLocationMapState.mapClickBound = true;
  }

  const layer = host.__leafletLayer;
  if (layer?.on && !noteLocationMapState.tileErrorBound) {
    layer.on("tileerror", () => {
      setLocationMapStatus("No se han podido cargar los tiles del mapa. Puedes seguir seleccionando o confirmar igualmente.", { isError: false });
    });
    noteLocationMapState.tileErrorBound = true;
  }

  return map;
}

function centerLocationMap(selection = null) {
  const map = noteLocationMapState.map;
  if (!map) return;
  if (hasRealLocationCoordinates(selection?.lat, selection?.lng)) {
    setLeafletViewForPoints(map, [selection], {
      defaultCenter: DEFAULT_MAP_CENTER_SPAIN,
      defaultZoom: DEFAULT_MAP_ZOOM_SPAIN,
      maxAutoZoom: 13,
      singlePointZoom: 13,
    });
  } else {
    setLeafletViewForPoints(map, [], {
      defaultCenter: DEFAULT_MAP_CENTER_SPAIN,
      defaultZoom: DEFAULT_MAP_ZOOM_SPAIN,
    });
  }
  invalidateLeafletMap(map, 60);
  invalidateLeafletMap(map, 180);
}

async function selectLocationFromMap(lat, lng, { source = "map", recenter = true } = {}) {
  if (!hasRealLocationCoordinates(lat, lng)) return;
  console.info("[notes:location-map:select]", { lat, lng, source });

  const fallbackLabel = formatLocationMapFallbackLabel(lat, lng);
  const requestKey = `${lat}:${lng}:${Date.now()}`;
  noteLocationMapState.selection = {
    lat,
    lng,
    label: fallbackLabel,
    exactAddress: fallbackLabel,
    source,
    requestKey,
  };
  updateLocationMapMarker(noteLocationMapState.selection);
  renderLocationMapSelection();
  if (recenter) centerLocationMap(noteLocationMapState.selection);
  setLocationMapStatus("Intentando resolver la direcciÃ³n del punto seleccionado...");

  const reverse = await reverseGeocodeNoteLocation(lat, lng);
  if (!noteLocationMapState.selection || noteLocationMapState.selection.requestKey !== requestKey) return;

  if (reverse) {
    noteLocationMapState.selection = {
      ...noteLocationMapState.selection,
      ...reverse,
      lat,
      lng,
      label: String(reverse.label || reverse.exactAddress || fallbackLabel).trim() || fallbackLabel,
      exactAddress: String(reverse.exactAddress || reverse.label || fallbackLabel).trim() || fallbackLabel,
      source: source === "geolocation" ? "geolocation" : (reverse.source || source),
      requestKey,
    };
    renderLocationMapSelection();
    setLocationMapStatus(source === "geolocation" ? "UbicaciÃ³n actual lista para usar." : "Punto marcado y direcciÃ³n resuelta.");
    return;
  }

  noteLocationMapState.selection = {
    ...noteLocationMapState.selection,
    label: fallbackLabel,
    exactAddress: fallbackLabel,
    source,
    requestKey,
  };
  renderLocationMapSelection();
  setLocationMapStatus("No se encontrÃ³ una direcciÃ³n para ese punto. Se usarÃ¡n las coordenadas.");
}

function applyLocationMapSelectionToForm() {
  const selection = noteLocationMapState.selection;
  if (!hasRealLocationCoordinates(selection?.lat, selection?.lng)) return false;
  const label = String(selection?.label || selection?.exactAddress || formatLocationMapFallbackLabel(selection.lat, selection.lng)).trim();
  selectLocationSuggestion({
    ...selection,
    label,
    exactAddress: String(selection?.exactAddress || label).trim() || label,
    text: label,
    source: String(selection?.source || "map").trim() || "map",
    lat: selection.lat,
    lng: selection.lng,
  });
  $id("notes-note-location-status").textContent = "UbicaciÃ³n seleccionada desde el mapa.";
  return true;
}

function closeLocationMapModal({ keepSelection = false } = {}) {
  try {
    notesLocationReverseAbort?.abort?.();
  } catch (_) {}
  notesLocationReverseAbort = null;
  if (!keepSelection) {
    noteLocationMapState.selection = null;
    renderLocationMapSelection();
  }
  setLocationMapStatus("");
  closeModal("notes-location-map-backdrop");
}

async function openLocationMapModal() {
  console.info("[notes:location-map:open]");
  const currentDraft = getDraftLocationFromForm();
  noteLocationMapState.selection = hasRealLocationCoordinates(currentDraft.lat, currentDraft.lng)
    ? {
      ...currentDraft,
      label: currentDraft.label || formatLocationMapFallbackLabel(currentDraft.lat, currentDraft.lng),
      exactAddress: currentDraft.exactAddress || currentDraft.label || formatLocationMapFallbackLabel(currentDraft.lat, currentDraft.lng),
    }
    : null;
  renderLocationMapSelection();
  setLocationMapStatus("Cargando mapa...");
  const currentLocationButton = $id("notes-location-map-current");
  if (currentLocationButton) {
    currentLocationButton.disabled = !(window.isSecureContext && navigator.geolocation);
  }
  openModal("notes-location-map-backdrop");
  try {
    await ensureNoteLocationMapReady();
    updateLocationMapMarker(noteLocationMapState.selection);
    centerLocationMap(noteLocationMapState.selection);
    setLocationMapStatus(
      hasRealLocationCoordinates(noteLocationMapState.selection?.lat, noteLocationMapState.selection?.lng)
        ? "Puedes mover el marcador tocando otro punto del mapa."
        : "Toca en el mapa para fijar la ubicaciÃ³n.",
    );
  } catch (error) {
    console.warn("[notes:location-map:error]", error);
    setLocationMapStatus("No se pudo cargar el mapa. El campo manual seguirÃ¡ funcionando.", { isError: true });
  }
}

async function useCurrentLocationForMap() {
  if (!(window.isSecureContext && navigator.geolocation)) return;
  setLocationMapStatus("Obteniendo tu ubicaciÃ³n actual...");
  await new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (position) => {
        const lat = Number(position?.coords?.latitude);
        const lng = Number(position?.coords?.longitude);
        try {
          await selectLocationFromMap(lat, lng, { source: "geolocation" });
        } finally {
          resolve();
        }
      },
      (error) => {
        console.warn("[notes:location-map:error]", error);
        setLocationMapStatus("No se pudo obtener tu ubicaciÃ³n actual.", { isError: true });
        resolve();
      },
      {
        enableHighAccuracy: true,
        maximumAge: 60000,
        timeout: 12000,
      },
    );
  });
}

function updateNoteEditorMode(nextKind = "text") {
  const noteKind = normalizeNoteKind(nextKind);
  const isCode = noteKind === "code";
  const isPerson = noteKind === "persona";
  const isLink = !isCode && Boolean($id("notes-note-is-link")?.checked);

  if ($id("notes-note-kind")) $id("notes-note-kind").value = noteKind;
  $id("notes-note-content-wrap")?.classList.toggle("hidden", isCode);
  $id("notes-note-code-wrap")?.classList.toggle("hidden", !isCode);
  $id("notes-note-person-wrap")?.classList.toggle("hidden", !isPerson);
  $id("notes-note-link-toggle-wrap")?.classList.toggle("hidden", isCode);

  if (isCode && $id("notes-note-is-link")) {
    $id("notes-note-is-link").checked = false;
  }

  updateNoteLinkDependentFields(isLink);
  if (isCode) clearNoteLinkSuggestionList();
  syncNoteModalCodeAssist();
}

function syncPersonTitleFromFirstName({ force = false } = {}) {
  const titleInput = $id("notes-note-title");
  const firstNameInput = $id("notes-note-person-first-name");
  if (!titleInput || !firstNameInput || normalizeNoteKind($id("notes-note-kind")?.value) !== "persona") return;

  const currentTitle = String(titleInput.value || "").trim();
  const previousAutoTitle = String(titleInput.dataset.autoPersonTitle || "").trim();
  const nextTitle = String(firstNameInput.value || "").trim();
  if (!nextTitle) return;
  if (force || !currentTitle || currentTitle === previousAutoTitle) {
    titleInput.value = nextTitle;
  }
  titleInput.dataset.autoPersonTitle = nextTitle;
}

function getCurrentFolder() {
  return state.folders.find((folder) => folder.id === state.selectedFolderId) || null;
}
async function syncPersonBirthdayReminder(noteId = "", note = {}, previous = null) {
  const birthday = String(note?.person?.birthday || "").trim();
  const title = getNoteDisplayTitle(note) || String(note?.title || "Persona").trim();
  const existing = (state.reminders || []).find((row) => row?.noteId === noteId && row?.type === "cumpleaños");
  if (!birthday) {
    if (existing?.id) await deleteReminder(state.rootPath, existing.id);
    return;
  }
  const payload = { title: `Cumpleaños de ${title}`, date: birthday, type: "cumpleaños", isBirthday: true, repeat: "yearly", status: "pendiente", noteId, updatedAt: Date.now(), createdAt: existing?.createdAt || Date.now() };
  if (existing?.id) await updateReminder(state.rootPath, existing.id, payload);
  else await createReminder(state.rootPath, payload);
}

function buildNoteImageRenderUrl(note) {
  const url = String(note?.imageUrl || "").trim();
  const version = Number(note?.imageUpdatedAt || 0);
  if (!url) return "";
  if (!version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

function buildTagDefinitionImageRenderUrl(tagDefinition) {
  const url = String(tagDefinition?.imageUrl || "").trim();
  const version = Number(tagDefinition?.imageUpdatedAt || 0);
  if (!url) return "";
  if (!version) return url;
  return `${url}${url.includes("?") ? "&" : "?"}v=${encodeURIComponent(version)}`;
}

function escapeCssUrl(value = "") {
  return String(value || "")
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "");
}

function buildNoteCardStyleAttribute(note) {
  const imageUrl = buildNoteImageRenderUrl(note);
  if (!imageUrl) return "";
  const cssValue = `url("${escapeCssUrl(imageUrl)}")`;
  return ` style="--notes-card-bg-image:${escapeHtml(cssValue)};"`;
}

function listTagDefinitions() {
  return Object.values(state.tagDefinitions || {});
}

function collectTagLabels(...groups) {
  const labels = new Map();

  groups.flat().forEach((value) => {
    const label = normalizeTagLabel(value);
    const key = buildTagDefinitionKey(label);
    if (!label || !key || labels.has(key)) return;
    labels.set(key, label);
  });

  return Array.from(labels.values()).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function getTagDefinitionForLabel(label = "") {
  const key = buildTagDefinitionKey(label);
  if (!key) return null;
  return state.tagDefinitions?.[key] || null;
}

function buildNoteTagImageOptions(tags = []) {
  return (Array.isArray(tags) ? tags : []).map((rawTag) => {
    const label = normalizeTagLabel(rawTag);
    const key = buildTagDefinitionKey(label);
    const draft = noteTagImageDrafts.get(key);
    const tagDefinition = state.tagDefinitions?.[key] || draft?.persisted || null;
    const previewUrl = getNoteTagDraftPreviewUrl(draft, tagDefinition);
    return {
      key,
      label,
      draft,
      tagDefinition,
      previewUrl,
      hasImage: Boolean(previewUrl),
    };
  }).filter((entry) => entry.key && entry.label);
}

function ensureNoteSelectedTagImageKey(tags = [], preferredKey = "") {
  const options = buildNoteTagImageOptions(tags);
  const requestedKey = buildTagDefinitionKey(preferredKey);

  if (requestedKey) {
    const requested = options.find((entry) => entry.key === requestedKey);
    if (requested?.hasImage) {
      noteSelectedTagImageKey = requested.key;
      return noteSelectedTagImageKey;
    }
  }

  if (noteSelectedTagImageKey) {
    const current = options.find((entry) => entry.key === noteSelectedTagImageKey);
    if (current?.hasImage) return noteSelectedTagImageKey;
  }

  const fallback = options.find((entry) => entry.hasImage);
  noteSelectedTagImageKey = fallback?.key || "";
  return noteSelectedTagImageKey;
}

function resolveNoteTagPreview(note) {
  const tags = Array.isArray(note?.tags) ? note.tags : [];
  const preferredKey = buildTagDefinitionKey(note?.tagImageKey);
  const options = tags.map((rawTag) => {
    const label = normalizeTagLabel(rawTag);
    const definition = getTagDefinitionForLabel(label);
    const imageUrl = buildTagDefinitionImageRenderUrl(definition);
    return {
      key: buildTagDefinitionKey(label),
      label: definition?.label || label,
      imageUrl,
    };
  }).filter((entry) => entry.key && entry.imageUrl);

  const selected = options.find((entry) => entry.key === preferredKey) || options[0];
  if (selected) return selected;
  return null;
}

function revokeNoteTagDraftPreview(draft) {
  if (!draft?.previewUrl) return;
  try {
    URL.revokeObjectURL(draft.previewUrl);
  } catch (_) {}
  draft.previewUrl = "";
}

function clearNoteTagImageDrafts() {
  noteTagImageDrafts.forEach((draft) => revokeNoteTagDraftPreview(draft));
  noteTagImageDrafts = new Map();
  activeNoteTagImageKey = "";
  noteSelectedTagImageKey = "";
}

function getCurrentNoteModalTags() {
  return parseTagList($id("notes-note-tags")?.value || "");
}

function syncNoteTagImageDrafts(tags = []) {
  const validKeys = new Set();

  tags.forEach((rawTag) => {
    const label = normalizeTagLabel(rawTag);
    const key = buildTagDefinitionKey(label);
    if (!label || !key) return;

    validKeys.add(key);
    const existingDraft = noteTagImageDrafts.get(key);
    const persistedDefinition = state.tagDefinitions?.[key] || existingDraft?.persisted || null;

    if (existingDraft) {
      existingDraft.label = label;
      if (persistedDefinition && !existingDraft.persisted) {
        existingDraft.persisted = { ...persistedDefinition };
      }
      return;
    }

    noteTagImageDrafts.set(key, {
      key,
      label,
      file: null,
      previewUrl: "",
      remove: false,
      persisted: persistedDefinition ? { ...persistedDefinition } : null,
    });
  });

  Array.from(noteTagImageDrafts.entries()).forEach(([key, draft]) => {
    if (validKeys.has(key)) return;
    revokeNoteTagDraftPreview(draft);
    noteTagImageDrafts.delete(key);
  });
}

function getNoteTagDraftPreviewUrl(draft, tagDefinition = null) {
  if (!draft) return "";
  if (draft.previewUrl) return draft.previewUrl;
  if (draft.remove) return "";
  return buildTagDefinitionImageRenderUrl(tagDefinition || draft.persisted || null);
}

function renderNoteTagImageEditor() {
  const panel = $id("notes-note-tag-images");
  const list = $id("notes-note-tag-images-list");
  const empty = $id("notes-note-tag-images-empty");
  if (!panel || !list || !empty) return;

  const tags = getCurrentNoteModalTags();
  syncNoteTagImageDrafts(tags);
  ensureNoteSelectedTagImageKey(tags);

  panel.classList.toggle("is-empty", tags.length === 0);
  empty.classList.toggle("hidden", tags.length > 0);

  if (!tags.length) {
    list.innerHTML = "";
    return;
  }

  const selectedKey = noteSelectedTagImageKey;

  list.innerHTML = buildNoteTagImageOptions(tags).map(({ key, label, draft, previewUrl, hasImage }) => {
    const isSelected = hasImage && key === selectedKey;
    const subtitle = draft?.previewUrl
      ? "Nueva imagen lista para guardarse."
      : draft?.remove
        ? "La imagen se quitara al guardar."
        : isSelected
          ? "Esta es la imagen elegida para la nota."
          : hasImage
            ? "Disponible para usar en esta nota."
          : "Sin imagen asociada.";
    const secondaryLabel = draft?.remove ? "Restaurar" : "Quitar";
    const secondaryDisabled = !draft?.remove && !hasImage;

    return `
      <div class="notes-tag-media-row" data-tag-key="${escapeHtml(key)}">
        <label class="notes-tag-media-selector${isSelected ? " is-selected" : ""}${hasImage ? "" : " is-disabled"}">
          <input
            class="notes-tag-media-selector-input"
            type="checkbox"
            data-act="select-note-tag-image"
            data-tag-key="${escapeHtml(key)}"
            ${isSelected ? "checked" : ""}
            ${hasImage ? "" : "disabled"}
          />
          <span class="notes-tag-media-selector-box" aria-hidden="true"></span>
        </label>
        <div class="notes-tag-media-thumb${hasImage ? " is-image" : ""}">
          ${hasImage
            ? `<img class="notes-tag-media-image" src="${escapeHtml(previewUrl)}" alt="${escapeHtml(`Tag ${label}`)}" loading="lazy" decoding="async" />`
            : `<span class="notes-tag-media-empty-mark">#</span>`}
        </div>
        <div class="notes-tag-media-copy">
          <strong class="notes-tag-media-title">${escapeHtml(label)}</strong>
          <span class="notes-tag-media-meta">${escapeHtml(subtitle)}</span>
        </div>
        <div class="notes-tag-media-actions">
          <button class="btn ghost btn-compact" type="button" data-act="pick-note-tag-image" data-tag-key="${escapeHtml(key)}">
            ${hasImage && !draft?.remove ? "Cambiar" : "Imagen"}
          </button>
          <button
            class="btn ghost ${draft?.remove ? "" : "danger "}btn-compact"
            type="button"
            data-act="toggle-note-tag-image"
            data-tag-key="${escapeHtml(key)}"
            ${secondaryDisabled ? "disabled" : ""}
          >${secondaryLabel}</button>
        </div>
      </div>
    `;
  }).join("");
}

function openNoteTagImagePicker(tagKey = "") {
  const input = $id("notes-note-tag-image-file");
  const safeTagKey = buildTagDefinitionKey(tagKey);
  if (!input || !safeTagKey) return;
  activeNoteTagImageKey = safeTagKey;
  input.value = "";
  input.click();
}

function setNoteSelectedTagImageKey(tagKey = "") {
  noteSelectedTagImageKey = buildTagDefinitionKey(tagKey);
  ensureNoteSelectedTagImageKey(getCurrentNoteModalTags(), noteSelectedTagImageKey);
  renderNoteTagImageEditor();
}

function toggleNoteTagImageDraft(tagKey = "") {
  const safeTagKey = buildTagDefinitionKey(tagKey);
  const draft = noteTagImageDrafts.get(safeTagKey);
  if (!draft) return;

  if (draft.remove) {
    draft.remove = false;
    renderNoteTagImageEditor();
    return;
  }

  const persistedImageUrl = buildTagDefinitionImageRenderUrl(state.tagDefinitions?.[safeTagKey] || draft.persisted || null);
  revokeNoteTagDraftPreview(draft);
  draft.file = null;
  draft.remove = Boolean(persistedImageUrl);
  ensureNoteSelectedTagImageKey(getCurrentNoteModalTags());
  renderNoteTagImageEditor();
}

async function persistNoteTagDefinitions(tags = []) {
  const orderedTags = Array.isArray(tags) ? tags : [];
  const processed = new Set();

  for (const rawTag of orderedTags) {
    const label = normalizeTagLabel(rawTag);
    const key = buildTagDefinitionKey(label);
    if (!label || !key || processed.has(key)) continue;
    processed.add(key);

    const draft = noteTagImageDrafts.get(key) || null;
    const current = state.tagDefinitions?.[key] || draft?.persisted || null;
    const currentHasImage = Boolean(buildTagDefinitionImageRenderUrl(current));
    let nextPayload = null;

    if (draft?.remove) {
      if (currentHasImage) {
        try {
          await deleteNoteTagImageAsset(state.uid, key, current?.imagePath, current?.imageUrl);
        } catch (error) {
          console.warn("[notes] no se pudo borrar la imagen remota del tag", error);
        }
      }

      if (currentHasImage || current) {
        nextPayload = {
          ...current,
          key,
          label,
          imageUrl: "",
          imagePath: "",
          imageUpdatedAt: 0,
          createdAt: Number(current?.createdAt || Date.now()),
        };
      }
    } else if (draft?.file instanceof File) {
      if (currentHasImage) {
        try {
          await deleteNoteTagImageAsset(state.uid, key, current?.imagePath, current?.imageUrl);
        } catch (error) {
          console.warn("[notes] no se pudo limpiar la imagen anterior del tag", error);
        }
      }

      const optimizedFile = await downscaleNoteImageFile(draft.file);
      const upload = await uploadNoteTagImageAsset(state.uid, key, optimizedFile);
      nextPayload = {
        ...current,
        key,
        label,
        imageUrl: upload.url,
        imagePath: upload.path,
        imageUpdatedAt: Date.now(),
        createdAt: Number(current?.createdAt || Date.now()),
      };
    } else if (current && String(current.label || "") !== label) {
      nextPayload = {
        ...current,
        key,
        label,
        createdAt: Number(current?.createdAt || Date.now()),
      };
    }

    if (nextPayload) {
      await upsertTagDefinition(state.rootPath, key, nextPayload);
    }
  }
}

function buildNoteAttachmentsMarkup(images = [], { compact = false } = {}) {
  const safeImages = Array.isArray(images) ? images.filter((item) => item?.id && item?.url) : [];
  if (!safeImages.length) return "";
  return `
    <div class="notes-attachments-preview${compact ? " is-compact" : ""}">
      ${safeImages.map((image) => `
        <a
          class="notes-attachments-preview__item"
          href="${escapeHtml(image.url)}"
          target="_blank"
          rel="noopener noreferrer"
          data-external-link="true"
          title="${escapeHtml(image.name || "Imagen adjunta")}"
        >
          <img
            class="notes-attachments-preview__thumb"
            src="${escapeHtml(image.url)}"
            alt="${escapeHtml(image.name || "Imagen adjunta")}"
            loading="lazy"
            decoding="async"
          />
          ${compact ? "" : `<span class="notes-attachments-preview__name">${escapeHtml(image.name || "Imagen adjunta")}</span>`}
        </a>
      `).join("")}
    </div>
  `;
}

function notePreview(note) {
  if (normalizeNoteKind(note?.noteKind) === "code") return "";
  return stripWikiLinkMarkup(note.content || "");
}

function buildNoteKindIcon(note = {}) {
  if (normalizeNoteKind(note?.noteKind) === "code") return "</>";
  return note.type === "link" ? "🔗" : "🗒️";
}

function buildCodeLanguageBadgeLabel(value = "") {
  const language = normalizeCodeLanguage(value);
  if (language === "css") return "CSS";
  if (language === "html") return "HTML";
  if (language === "js") return "JS";
  return "CODIGO";
}

function escapeSnippetStyleText(value = "") {
  return String(value || "").replace(/<\/style/gi, "<\\/style");
}

function resolveSnippetPreviewHtmlValue(value = "", language = "general") {
  const safe = String(value || "").trim();
  return safe || (normalizeCodeLanguage(language) ? SNIPPET_PREVIEW_PLACEHOLDER : "");
}

function buildSnippetPreviewCss(code = "", language = "general") {
  if (normalizeCodeLanguage(language) !== "css") return "";
  const safeCode = escapeSnippetStyleText(String(code || "").trim());
  if (!safeCode) return "";
  if (/[{}]/.test(safeCode)) return safeCode;
  return `.demo-target {\n${safeCode}\n}`;
}

function escapeAttributeSelector(value = "") {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(String(value || ""));
  }
  return String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildSnippetPreviewSrcdoc(note = {}, overrides = {}) {
  if (normalizeNoteKind(note?.noteKind) !== "code") return "";

  const language = normalizeCodeLanguage(overrides?.codeLanguage ?? note?.codeLanguage);
  const code = String(overrides?.code ?? note?.code ?? "").trim();
  const previewId = String(note?.id || overrides?.id || "snippet-preview").trim() || "snippet-preview";
  const cssRules = buildSnippetPreviewCss(code, language);
  const previewMarkup = normalizeCodeLanguage(language) === "css"
    ? SNIPPET_PREVIEW_PLACEHOLDER
    : '<div class="demo-target">Preview no disponible para este lenguaje.</div>';

  return `
<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: transparent;
      color: #eff6ff;
      font: 14px/1.4 ui-sans-serif, system-ui, sans-serif;
    }
    .preview-wrap {
      padding: 12px;
    }
    .demo-target {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-height: 44px;
      border-radius: 14px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      background: rgba(255, 255, 255, 0.06);
      color: inherit;
      padding: 12px 14px;
    }
    ${cssRules}
  </style>
</head>
<body>
  <div class="preview-wrap" data-snippet-preview-id="${escapeHtml(previewId)}">
    ${previewMarkup}
  </div>
</body>
</html>`.trim();
}

function buildSnippetPreviewMarkup(note = {}) {
  const noteId = String(note?.id || "").trim();
  if (!noteId) return "";
  const isExpanded = expandedSnippetNotes.has(noteId);

  return `
    <div
      class="notes-snippet-preview-shell"
      data-snippet-preview-id="${escapeHtml(noteId)}"
      data-act="toggle-note-snippet"
      data-note-id="${escapeHtml(noteId)}"
      role="button"
      tabindex="0"
      aria-expanded="${isExpanded ? "true" : "false"}"
    >
      <iframe
        class="notes-snippet-preview-frame"
        sandbox
        loading="lazy"
        referrerpolicy="no-referrer"
        data-snippet-preview-frame="${escapeHtml(noteId)}"
        title="${escapeHtml(`Preview de ${note.title || "snippet"}`)}"
      ></iframe>
    </div>
  `;
}

function buildSnippetEditorMarkup(note = {}) {
  const noteId = String(note?.id || "").trim();
  const code = String(note?.code || "");
  if (!noteId) return "";

  return `
    <div class="notes-snippet-editor-shell" data-snippet-editor-shell="${escapeHtml(noteId)}">
      <div class="notes-snippet-editor-stage" data-snippet-editor-stage="${escapeHtml(noteId)}">
        <div class="notes-snippet-editor-backdrop" data-snippet-editor-backdrop="${escapeHtml(noteId)}" aria-hidden="true">
          <pre class="notes-snippet-code-overlay" data-snippet-editor-overlay="${escapeHtml(noteId)}"></pre>
        </div>
        <textarea class="notes-snippet-code notes-snippet-code-input" data-snippet-editor="${escapeHtml(noteId)}" spellcheck="false">${escapeHtml(code)}</textarea>
        <div class="notes-snippet-inline-swatches" data-snippet-editor-swatches="${escapeHtml(noteId)}"></div>
      </div>
      <div class="notes-snippet-editor-footer">
        <div class="notes-snippet-editor-summary hidden" data-snippet-editor-summary="${escapeHtml(noteId)}" aria-live="polite"></div>
        <div class="notes-snippet-editor-suggestions hidden" data-snippet-suggestions="${escapeHtml(noteId)}"></div>
      </div>
      <input class="notes-snippet-color-input" data-snippet-color-input="${escapeHtml(noteId)}" type="color" tabindex="-1" aria-hidden="true" />
    </div>
  `;
}

function buildSnippetMarkup(note = {}) {
  if (normalizeNoteKind(note?.noteKind) !== "code") return "";

  const code = String(note?.code || "").trim();
  const isExpanded = expandedSnippetNotes.has(note.id);
  if (!code) return "";

  return `
    <div class="notes-snippet-block${isExpanded ? " is-expanded" : " is-collapsed"}" data-snippet-block-note-id="${escapeHtml(note.id)}">
      ${buildSnippetPreviewMarkup(note)}
      <div class="notes-snippet-actions">
        <button class="btn ghost btn-compact notes-snippet-copy" type="button" data-act="copy-note-code" data-note-id="${escapeHtml(note.id)}">Copiar codigo</button>
        <button class="btn ghost btn-compact notes-snippet-toggle" type="button" data-act="toggle-note-snippet" data-note-id="${escapeHtml(note.id)}">${isExpanded ? "Ocultar codigo" : "Ver codigo"}</button>
      </div>
      <div class="notes-snippet-body${isExpanded ? "" : " hidden"}" data-snippet-body="${escapeHtml(note.id)}">
        ${buildSnippetEditorMarkup(note)}
        <div class="notes-snippet-body-actions">
          <button class="btn primary btn-compact notes-snippet-save" type="button" data-act="save-note-code" data-note-id="${escapeHtml(note.id)}">Guardar codigo</button>
        </div>
      </div>
    </div>
  `;
}

function findSnippetPreviewFrame(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-preview-frame="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetEditor(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-editor="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetEditorStage(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-editor-stage="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetEditorBackdrop(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-editor-backdrop="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetEditorOverlay(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-editor-overlay="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetEditorSwatches(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-editor-swatches="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetSuggestionsHost(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-suggestions="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetSummaryHost(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-editor-summary="${escapeAttributeSelector(safeNoteId)}"]`);
}

function findSnippetColorInput(noteId = "", root = document) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId || !root?.querySelector) return null;
  return root.querySelector(`[data-snippet-color-input="${escapeAttributeSelector(safeNoteId)}"]`);
}

function computeLineNumberFromIndex(text = "", index = 0) {
  const safeText = String(text || "");
  const safeIndex = Math.max(0, Math.min(Number(index || 0), safeText.length));
  return safeText.slice(0, safeIndex).split(/\r?\n/).length;
}

function getCssSuggestionPrefix(code = "", cursor = 0) {
  const safeCode = String(code || "");
  const safeCursor = Math.max(0, Math.min(Number(cursor || 0), safeCode.length));
  const beforeCursor = safeCode.slice(0, safeCursor);
  const match = beforeCursor.match(/([a-z-]{1,})$/i);
  if (!match) {
    return {
      prefix: "",
      start: safeCursor,
      end: safeCursor,
    };
  }

  return {
    prefix: String(match[1] || "").toLowerCase(),
    start: safeCursor - String(match[1] || "").length,
    end: safeCursor,
  };
}

function getCssPropertySuggestions(code = "", cursor = 0) {
  const { prefix } = getCssSuggestionPrefix(code, cursor);
  if (prefix.length < 2) return [];
  return CSS_PROPERTY_SUGGESTIONS
    .filter((property) => property.startsWith(prefix))
    .slice(0, SNIPPET_SUGGESTION_LIMIT);
}

function detectSnippetColorMatches(code = "") {
  const safeCode = String(code || "");
  const pattern = /#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b|\b(?:rgb|rgba|hsl|hsla|oklch)\([^)]*\)/gi;
  const matches = [];
  let match = null;

  while ((match = pattern.exec(safeCode))) {
    matches.push({
      value: String(match[0] || ""),
      start: match.index,
      end: match.index + String(match[0] || "").length,
    });
    if (matches.length >= SNIPPET_COLOR_LIMIT) break;
  }

  return matches;
}

function resolveCssColorToHex(value = "") {
  const safeValue = String(value || "").trim();
  if (!safeValue || typeof document === "undefined" || typeof window === "undefined") return null;

  const shortHex = /^#([0-9a-f]{3,4})$/i.exec(safeValue);
  if (shortHex) {
    const chars = shortHex[1].slice(0, 3).split("");
    return `#${chars.map((char) => `${char}${char}`).join("")}`.toLowerCase();
  }

  const longHex = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i.exec(safeValue);
  if (longHex) {
    return `#${longHex[1].slice(0, 6)}`.toLowerCase();
  }

  const probe = document.createElement("span");
  probe.style.color = "";
  probe.style.color = safeValue;
  if (!probe.style.color) return null;
  probe.hidden = true;
  document.body.appendChild(probe);
  const computed = window.getComputedStyle(probe).color;
  probe.remove();
  const rgbMatch = computed.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!rgbMatch) return null;
  return `#${rgbMatch.slice(1, 4).map((chunk) => Number(chunk).toString(16).padStart(2, "0")).join("")}`;
}

function pushCssIssue(issues, code, type, start, end, message) {
  const safeCode = String(code || "");
  const maxLength = safeCode.length;
  const safeStart = Math.max(0, Math.min(Number(start || 0), maxLength));
  const desiredEnd = Number.isFinite(Number(end)) ? Number(end) : (safeStart + 1);
  const safeEnd = Math.max(safeStart + (maxLength > safeStart ? 1 : 0), Math.min(desiredEnd, maxLength));
  const issue = {
    type,
    start: safeStart,
    end: safeEnd,
    line: computeLineNumberFromIndex(safeCode, safeStart),
    message,
  };

  const exists = issues.some((row) => (
    row?.type === issue.type
    && Number(row?.start) === issue.start
    && Number(row?.end) === issue.end
    && String(row?.message || "") === issue.message
  ));
  if (!exists) issues.push(issue);
}

function findTopLevelColonIndex(text = "") {
  const safeText = String(text || "");
  let parenDepth = 0;

  for (let index = 0; index < safeText.length; index += 1) {
    const char = safeText[index];
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char === ":" && parenDepth === 0) {
      return index;
    }
  }

  return -1;
}

function findNestedCssPropertyStart(value = "") {
  const safeValue = String(value || "");
  let parenDepth = 0;

  for (let index = 0; index < safeValue.length; index += 1) {
    const char = safeValue[index];
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char !== "\n" || parenDepth !== 0) continue;

    let cursor = index + 1;
    while (cursor < safeValue.length && /[ \t]/.test(safeValue[cursor])) {
      cursor += 1;
    }

    const match = safeValue.slice(cursor).match(/^([a-z-][a-z0-9-]*)\s*:/i);
    if (match) {
      return {
        offset: cursor,
        property: String(match[1] || ""),
      };
    }
  }

  return null;
}

function validateCssDeclaration(code = "", declaration = "", absoluteStart = 0, issues = [], { requireSemicolonAtClosure = false } = {}) {
  const rawDeclaration = String(declaration || "");
  const trimmedDeclaration = rawDeclaration.trim();
  if (!trimmedDeclaration) return;
  if (!trimmedDeclaration.replace(/\/\*[\s\S]*?\*\//g, "").trim()) return;

  const leadingPadding = rawDeclaration.indexOf(trimmedDeclaration);
  const declarationStart = absoluteStart + Math.max(leadingPadding, 0);
  const normalizedDeclaration = trimmedDeclaration.replace(/;+\s*$/, "");
  const colonIndex = findTopLevelColonIndex(normalizedDeclaration);

  if (colonIndex < 0) {
    const tokenMatch = normalizedDeclaration.match(/^([^\s:;{}]+)/);
    const tokenText = String(tokenMatch?.[1] || normalizedDeclaration || "css");
    const tokenOffset = tokenMatch ? normalizedDeclaration.indexOf(tokenText) : 0;
    pushCssIssue(
      issues,
      code,
      "warning",
      declarationStart + tokenOffset,
      declarationStart + tokenOffset + tokenText.length,
      "Propiedad sin ':'.",
    );
    return;
  }

  const propertyChunk = normalizedDeclaration.slice(0, colonIndex);
  const propertyName = propertyChunk.trim();
  if (!propertyName) {
    pushCssIssue(
      issues,
      code,
      "warning",
      declarationStart + colonIndex,
      declarationStart + colonIndex + 1,
      "Propiedad sin nombre.",
    );
    return;
  }

  const nestedProperty = findNestedCssPropertyStart(normalizedDeclaration.slice(colonIndex + 1));
  if (nestedProperty) {
    const nestedStart = declarationStart + colonIndex + 1 + nestedProperty.offset;
    pushCssIssue(
      issues,
      code,
      "warning",
      nestedStart,
      nestedStart + nestedProperty.property.length,
      "Falta ';' antes de esta propiedad.",
    );
  }

  if (!/;\s*$/.test(trimmedDeclaration) && requireSemicolonAtClosure) {
    const endOffset = Math.max(0, normalizedDeclaration.length - 1);
    pushCssIssue(
      issues,
      code,
      "warning",
      declarationStart + endOffset,
      declarationStart + normalizedDeclaration.length,
      "Falta ';' al cerrar la declaracion.",
    );
  }
}

function parseCssDeclarationSeries(code = "", source = "", absoluteStart = 0, issues = [], { requireSemicolonAtClosure = false } = {}) {
  const safeSource = String(source || "");
  let chunkStart = 0;
  let parenDepth = 0;

  for (let index = 0; index < safeSource.length; index += 1) {
    const char = safeSource[index];
    if (char === "(") {
      parenDepth += 1;
      continue;
    }
    if (char === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
      continue;
    }
    if (char !== ";" || parenDepth !== 0) continue;

    validateCssDeclaration(
      code,
      safeSource.slice(chunkStart, index + 1),
      absoluteStart + chunkStart,
      issues,
      { requireSemicolonAtClosure: false },
    );
    chunkStart = index + 1;
  }

  validateCssDeclaration(
    code,
    safeSource.slice(chunkStart),
    absoluteStart + chunkStart,
    issues,
    { requireSemicolonAtClosure },
  );
}

function collectCssValidationIssues(code = "") {
  const safeCode = String(code || "");
  const issues = [];
  if (!safeCode.trim()) return issues;

  const braceStack = [];
  const parenStack = [];

  for (let index = 0; index < safeCode.length; index += 1) {
    const char = safeCode[index];
    if (char === "{") {
      braceStack.push(index);
    }
    if (char === "}") {
      if (braceStack.length) {
        braceStack.pop();
      } else {
        pushCssIssue(issues, safeCode, "error", index, index + 1, "Llave de cierre sin apertura.");
      }
    }
    if (char === "(") {
      parenStack.push(index);
    }
    if (char === ")") {
      if (parenStack.length) {
        parenStack.pop();
      } else {
        pushCssIssue(issues, safeCode, "error", index, index + 1, "Parentesis de cierre sin apertura.");
      }
    }
  }

  braceStack.forEach((start) => {
    pushCssIssue(issues, safeCode, "error", start, start + 1, "Llave sin cierre.");
  });

  parenStack.forEach((start) => {
    pushCssIssue(issues, safeCode, "error", start, start + 1, "Parentesis sin cierre.");
  });

  if (!safeCode.includes("{")) {
    parseCssDeclarationSeries(safeCode, safeCode, 0, issues, { requireSemicolonAtClosure: false });
    return issues.slice(0, 8);
  }

  let blockDepth = 0;
  let currentBlock = null;
  let foundTopLevelBlock = false;
  let segmentStart = 0;

  for (let index = 0; index < safeCode.length; index += 1) {
    const char = safeCode[index];
    if (char === "{") {
      if (blockDepth === 0) {
        currentBlock = {
          selectorStart: segmentStart,
          selectorEnd: index,
          bodyStart: index + 1,
        };
        foundTopLevelBlock = true;
      }
      blockDepth += 1;
      continue;
    }

    if (char !== "}") continue;
    if (blockDepth > 0) blockDepth -= 1;
    if (blockDepth !== 0 || !currentBlock) continue;

    const selector = safeCode.slice(currentBlock.selectorStart, currentBlock.selectorEnd).trim();
    if (!selector) {
      pushCssIssue(
        issues,
        safeCode,
        "warning",
        currentBlock.selectorEnd,
        currentBlock.selectorEnd + 1,
        "Bloque sin selector.",
      );
    }

    parseCssDeclarationSeries(
      safeCode,
      safeCode.slice(currentBlock.bodyStart, index),
      currentBlock.bodyStart,
      issues,
      { requireSemicolonAtClosure: true },
    );
    currentBlock = null;
    segmentStart = index + 1;
  }

  if (!foundTopLevelBlock) {
    parseCssDeclarationSeries(safeCode, safeCode, 0, issues, { requireSemicolonAtClosure: false });
  }

  return issues.slice(0, 8);
}

function buildSnippetOverlayMarkup(code = "", issues = [], colors = []) {
  const safeCode = String(code || "");
  if (!safeCode) return " ";

  const boundaries = new Set([0, safeCode.length]);
  issues.forEach((issue) => {
    boundaries.add(Number(issue?.start || 0));
    boundaries.add(Number(issue?.end || 0));
  });
  colors.forEach((color) => {
    boundaries.add(Number(color?.start || 0));
    boundaries.add(Number(color?.end || 0));
  });

  const points = Array.from(boundaries)
    .filter((value) => Number.isFinite(value) && value >= 0 && value <= safeCode.length)
    .sort((a, b) => a - b);

  let markup = "";
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index];
    const end = points[index + 1];
    if (end <= start) continue;

    const tokenText = safeCode.slice(start, end);
    const relatedColor = colors.find((color) => start >= color.start && end <= color.end) || null;
    const relatedIssues = issues.filter((issue) => start >= issue.start && end <= issue.end);
    const hasError = relatedIssues.some((issue) => issue.type === "error");
    const hasWarning = !hasError && relatedIssues.some((issue) => issue.type === "warning");
    const classes = [];

    if (relatedColor) {
      classes.push("snippet-code-token", "snippet-code-token--color");
    }
    if (hasError) {
      if (!classes.includes("snippet-code-token")) classes.push("snippet-code-token");
      classes.push("snippet-code-token--error");
    } else if (hasWarning) {
      if (!classes.includes("snippet-code-token")) classes.push("snippet-code-token");
      classes.push("snippet-code-token--warning");
    }

    if (!classes.length) {
      markup += escapeHtml(tokenText);
      continue;
    }

    const attrs = relatedColor ? ` data-color-token-index="${Number(relatedColor.index || 0)}"` : "";
    markup += `<span class="${classes.join(" ")}"${attrs}>${escapeHtml(tokenText)}</span>`;
  }

  if (safeCode.endsWith("\n")) {
    markup += " ";
  }

  return markup;
}

function syncSnippetEditorBackdrop(editor, backdrop) {
  if (!editor || !backdrop) return;
  backdrop.scrollTop = editor.scrollTop;
  backdrop.scrollLeft = editor.scrollLeft;
}

function renderSnippetEditorSummary(host, issues = []) {
  if (!host) return;

  const errors = issues.filter((issue) => issue?.type === "error").length;
  const warnings = issues.filter((issue) => issue?.type === "warning").length;
  if (!errors && !warnings) {
    host.textContent = "";
    host.classList.add("hidden");
    host.classList.remove("has-errors", "has-warnings");
    return;
  }

  host.textContent = [
    errors ? `${errors} error${errors === 1 ? "" : "es"}` : "",
    warnings ? `${warnings} aviso${warnings === 1 ? "" : "s"}` : "",
  ].filter(Boolean).join(" · ");
  host.classList.remove("hidden");
  host.classList.toggle("has-errors", errors > 0);
  host.classList.toggle("has-warnings", errors === 0 && warnings > 0);
}

function renderSnippetSuggestionsHost(host, suggestions = [], action = "", noteId = "") {
  if (!host || !action) return;
  if (!suggestions.length) {
    host.innerHTML = "";
    host.classList.add("hidden");
    return;
  }

  host.classList.remove("hidden");
  host.innerHTML = suggestions.map((property) => `
    <button
      class="notes-snippet-suggestion-chip"
      type="button"
      data-act="${escapeHtml(action)}"
      ${noteId ? `data-note-id="${escapeHtml(noteId)}"` : ""}
      data-property="${escapeHtml(property)}"
    >${escapeHtml(property)}</button>
  `).join("");
}

function renderSnippetInlineSwatches({
  stage = null,
  overlay = null,
  swatchLayer = null,
  colors = [],
  action = "",
  noteId = "",
} = {}) {
  if (!swatchLayer) return;
  swatchLayer.innerHTML = "";
  swatchLayer.classList.toggle("hidden", !colors.length);

  if (!stage || !overlay || !colors.length || !action || stage.offsetParent === null) return;

  const stageRect = stage.getBoundingClientRect();
  colors.forEach((color) => {
    const spans = Array.from(overlay.querySelectorAll(`[data-color-token-index="${Number(color.index || 0)}"]`));
    const rect = spans.flatMap((span) => Array.from(span.getClientRects()))[0] || spans[0]?.getBoundingClientRect?.();
    if (!rect) return;

    const top = Math.max(4, Math.min(rect.top - stageRect.top + ((rect.height - 28) / 2), stage.clientHeight - 32));
    const left = Math.max(6, Math.min(rect.right - stageRect.left + 6, stage.clientWidth - 34));
    const hex = resolveCssColorToHex(color.value) || "#ffffff";

    swatchLayer.insertAdjacentHTML("beforeend", `
      <button
        class="notes-snippet-inline-swatch-button"
        type="button"
        data-act="${escapeHtml(action)}"
        ${noteId ? `data-note-id="${escapeHtml(noteId)}"` : ""}
        data-color-index="${Number(color.index || 0)}"
        title="${escapeHtml(color.value)}"
        aria-label="${escapeHtml(`Editar color ${color.value}`)}"
        style="top:${top}px;left:${left}px;"
      >
        <span class="snippet-color-swatch" style="background:${escapeHtml(hex)};"></span>
      </button>
    `);
  });
}

function renderSnippetEditorState({
  editor = null,
  stage = null,
  backdrop = null,
  overlay = null,
  swatchLayer = null,
  suggestionsHost = null,
  summaryHost = null,
  colorInput = null,
  language = "general",
  suggestionAction = "",
  colorAction = "",
  noteId = "",
} = {}) {
  if (!editor || !overlay || !backdrop) {
    return {
      issues: [],
      colors: [],
    };
  }

  const code = String(editor.value || "");
  const isCssMode = normalizeCodeLanguage(language) === "css";
  const issues = isCssMode ? collectCssValidationIssues(code) : [];
  const colors = isCssMode
    ? detectSnippetColorMatches(code).map((color, index) => ({ ...color, index }))
    : [];
  const suggestions = isCssMode ? getCssPropertySuggestions(code, Number(editor.selectionStart || 0)) : [];

  overlay.innerHTML = buildSnippetOverlayMarkup(code, issues, colors);
  syncSnippetEditorBackdrop(editor, backdrop);
  editor.classList.toggle("is-invalid", issues.some((issue) => issue.type === "error"));

  renderSnippetEditorSummary(summaryHost, issues);
  renderSnippetSuggestionsHost(suggestionsHost, suggestions, suggestionAction, noteId);
  renderSnippetInlineSwatches({
    stage,
    overlay,
    swatchLayer,
    colors,
    action: colorAction,
    noteId,
  });

  if (colorInput && colors.length) {
    colorInput.value = resolveCssColorToHex(colors[0]?.value || "") || "#ffffff";
  }

  return { issues, colors };
}

function insertSnippetSuggestionIntoEditor(editor, property = "") {
  const suggestion = String(property || "").trim();
  if (!editor || !suggestion) return false;

  const prefixInfo = getCssSuggestionPrefix(editor.value, editor.selectionStart || 0);
  const replacement = `${suggestion}: `;
  editor.value = `${editor.value.slice(0, prefixInfo.start)}${replacement}${editor.value.slice(editor.selectionEnd || prefixInfo.end)}`;
  const nextCursor = prefixInfo.start + replacement.length;
  editor.focus();
  editor.setSelectionRange(nextCursor, nextCursor);
  return true;
}

function insertSnippetSuggestion(note = {}, property = "", root = document) {
  const safeNoteId = String(note?.id || "").trim();
  const editor = findSnippetEditor(safeNoteId, root);
  if (!insertSnippetSuggestionIntoEditor(editor, property)) return;
  syncSnippetCardState(note, root);
}

function replaceSnippetColorInEditor(editor, colorIndex = -1, nextColor = "#ffffff") {
  if (!editor) return false;

  const colors = detectSnippetColorMatches(editor.value);
  const target = colors[Number(colorIndex)];
  if (!target) return false;

  const replacement = String(nextColor || "").trim() || "#ffffff";
  editor.value = `${editor.value.slice(0, target.start)}${replacement}${editor.value.slice(target.end)}`;
  const nextCursor = target.start + replacement.length;
  editor.focus();
  editor.setSelectionRange(nextCursor, nextCursor);
  return true;
}

function replaceSnippetColor(note = {}, colorIndex = -1, nextColor = "#ffffff", root = document) {
  const safeNoteId = String(note?.id || "").trim();
  const editor = findSnippetEditor(safeNoteId, root);
  if (!replaceSnippetColorInEditor(editor, colorIndex, nextColor)) return;
  syncSnippetCardState(note, root);
}

function syncSnippetCardState(note = {}, root = document) {
  const safeNoteId = String(note?.id || "").trim();
  if (!safeNoteId) return false;

  const editor = findSnippetEditor(safeNoteId, root);
  renderSnippetEditorState({
    editor,
    stage: findSnippetEditorStage(safeNoteId, root),
    backdrop: findSnippetEditorBackdrop(safeNoteId, root),
    overlay: findSnippetEditorOverlay(safeNoteId, root),
    swatchLayer: findSnippetEditorSwatches(safeNoteId, root),
    suggestionsHost: findSnippetSuggestionsHost(safeNoteId, root),
    summaryHost: findSnippetSummaryHost(safeNoteId, root),
    colorInput: findSnippetColorInput(safeNoteId, root),
    language: note?.codeLanguage,
    suggestionAction: "insert-snippet-suggestion",
    colorAction: "pick-snippet-color",
    noteId: safeNoteId,
  });

  syncSnippetPreviewFrame(note, {
    code: String(editor?.value ?? note?.code ?? ""),
  }, root);
  return true;
}

function clearNoteModalCodeAssist() {
  const editor = $id("notes-note-code");
  const overlay = $id("notes-note-code-overlay");
  const swatches = $id("notes-note-code-swatches");
  const suggestions = $id("notes-note-code-suggestions");
  const summary = $id("notes-note-code-summary");

  if (editor) editor.classList.remove("is-invalid");
  if (overlay) overlay.innerHTML = buildSnippetOverlayMarkup(String(editor?.value || ""), [], []);
  if (swatches) swatches.innerHTML = "";
  if (suggestions) {
    suggestions.innerHTML = "";
    suggestions.classList.add("hidden");
  }
  if (summary) {
    summary.textContent = "";
    summary.classList.add("hidden");
    summary.classList.remove("has-errors", "has-warnings");
  }
}

function syncNoteModalCodeAssist() {
  const kind = normalizeNoteKind($id("notes-note-kind")?.value);
  const language = normalizeCodeLanguage($id("notes-note-code-language")?.value);
  const editor = $id("notes-note-code");
  const stage = $id("notes-note-code-stage");
  const backdrop = $id("notes-note-code-backdrop");
  const overlay = $id("notes-note-code-overlay");
  const swatches = $id("notes-note-code-swatches");
  const suggestions = $id("notes-note-code-suggestions");
  const summary = $id("notes-note-code-summary");
  const colorInput = $id("notes-note-code-color-input");
  const isCodeMode = kind === "code";

  if (!editor || !stage || !backdrop || !overlay) return;
  if (!isCodeMode) {
    clearNoteModalCodeAssist();
    return;
  }

  renderSnippetEditorState({
    editor,
    stage,
    backdrop,
    overlay,
    swatchLayer: swatches,
    suggestionsHost: suggestions,
    summaryHost: summary,
    colorInput,
    language,
    suggestionAction: "insert-modal-snippet-suggestion",
    colorAction: "pick-modal-snippet-color",
  });
}

function syncSnippetPreviewFrame(note = {}, overrides = {}, root = document) {
  const safeNoteId = String(note?.id || overrides?.id || "").trim();
  const css = String(overrides?.code ?? note?.code ?? "");
  const frame = findSnippetPreviewFrame(safeNoteId, root);
  const srcdoc = buildSnippetPreviewSrcdoc(note, overrides);

  console.debug("[notes][snippet] css recibido", {
    noteId: safeNoteId,
    css,
  });
  console.debug("[notes][snippet] elemento preview encontrado", {
    noteId: safeNoteId,
    found: Boolean(frame),
    usesIframe: true,
  });

  if (!frame || !srcdoc) return false;

  frame.srcdoc = srcdoc;
  console.debug("[notes][snippet] iframe srcdoc", {
    noteId: safeNoteId,
    srcdoc,
  });
  console.debug("[notes][snippet] render de preview completado", {
    noteId: safeNoteId,
  });
  return true;
}

function syncSnippetPreviewFrames(root, notes = []) {
  const source = Array.isArray(notes) ? notes : [];
  source
    .filter((note) => normalizeNoteKind(note?.noteKind) === "code")
    .forEach((note) => {
      syncSnippetCardState(note, root);
    });
}

async function copyTextToClipboard(text = "") {
  const safeText = String(text || "");
  if (!safeText) return false;

  try {
    if (navigator?.clipboard?.writeText) {
      await navigator.clipboard.writeText(safeText);
      return true;
    }
  } catch (_) {}

  try {
    const textarea = document.createElement("textarea");
    textarea.value = safeText;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    return copied;
  } catch (_) {
    return false;
  }
}

async function handleCopyNoteCode(note, trigger) {
  const card = trigger?.closest?.("[data-note-id], .notes-item-card");
  const editor = card?.querySelector?.(`[data-snippet-editor="${note?.id || ""}"]`);
  const copied = await copyTextToClipboard(editor ? editor.value : (note?.code || ""));
  if (!trigger) return;

  const previous = trigger.textContent || "Copiar codigo";
  trigger.textContent = copied ? "Copiado" : "No se pudo copiar";
  trigger.disabled = true;
  window.setTimeout(() => {
    trigger.textContent = previous;
    trigger.disabled = false;
  }, 1400);
}

async function handleSaveNoteCode(note, trigger) {
  const safeNoteId = String(note?.id || "").trim();
  const editor = document.querySelector(`[data-snippet-editor="${safeNoteId}"]`);
  const rawCode = String(editor?.value || "");
  const nextCode = rawCode.trim();
  if (!safeNoteId || !state.rootPath || !nextCode) {
    if (trigger) {
      trigger.textContent = "Codigo vacio";
      trigger.disabled = true;
      window.setTimeout(() => {
        trigger.textContent = "Guardar codigo";
        trigger.disabled = false;
      }, 1400);
    }
    return;
  }

  const previousLabel = trigger?.textContent || "Guardar codigo";
  if (trigger) {
    trigger.textContent = "Guardando...";
    trigger.disabled = true;
  }

  try {
    await updateNote(state.rootPath, safeNoteId, {
      ...note,
      code: rawCode,
      noteKind: "code",
      previewHtml: resolveSnippetPreviewHtmlValue(note?.previewHtml, note?.codeLanguage),
    });
    note.code = rawCode;
    note.previewHtml = resolveSnippetPreviewHtmlValue(note?.previewHtml, note?.codeLanguage);
    expandedSnippetNotes.add(safeNoteId);
    renderFolderDetail();
  } catch (error) {
    console.warn("[notes] no se pudo guardar el codigo inline", error);
    if (trigger) {
      trigger.textContent = "No se pudo";
      window.setTimeout(() => {
        trigger.textContent = previousLabel;
        trigger.disabled = false;
      }, 1600);
    }
    return;
  }

  if (trigger) {
    trigger.textContent = "Guardado";
    window.setTimeout(() => {
      trigger.textContent = previousLabel;
      trigger.disabled = false;
    }, 1400);
  }
}

function normalizeExternalUrl(rawUrl = "") {
  try {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    if (/^mailto:/i.test(value)) {
      const address = value.slice(7).trim();
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) ? `mailto:${address}` : "";
    }
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(value)) {
      return `mailto:${value}`;
    }
    const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
    return url.toString();
  } catch (_) {
    return "";
  }
}

function urlHost(rawUrl = "") {
  try {
    const url = new URL(normalizeExternalUrl(rawUrl));
    return url.hostname;
  } catch (_) {
    return String(rawUrl || "").trim();
  }
}

function openExternalUrl(rawUrl = "") {
  const href = normalizeExternalUrl(rawUrl);
  if (!href) return false;

  const popup = window.open(href, "_blank", "noopener,noreferrer");
  if (popup) {
    try { popup.opener = null; } catch (_) {}
    return true;
  }

  try {
    const link = document.createElement("a");
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer external";
    link.referrerPolicy = "no-referrer";
    document.body.appendChild(link);
    link.click();
    link.remove();
    return true;
  } catch (_) {
    return false;
  }
}

function registerNoteVisit(note = null) {
  if (!note || note.type !== "link" || !state.rootPath) return;

  incrementNoteVisits(state.rootPath, note.id).catch((error) => {
    console.warn("[notes] no se pudo registrar la visita", error);
  });
}

function clearNoteFilters() {
  state.noteQuery = "";
  state.noteCategoryFilter = "";
  state.noteTagsFilter = "";
  state.noteLocationFilters = createEmptyNoteLocationFilters();
  if ($id("notes-search-notes")) $id("notes-search-notes").value = "";
  if ($id("notes-filter-note-category")) $id("notes-filter-note-category").value = "";
  if ($id("notes-filter-note-tags")) $id("notes-filter-note-tags").value = "";
  if ($id("notes-filter-note-country")) $id("notes-filter-note-country").value = "";
  if ($id("notes-filter-note-region")) $id("notes-filter-note-region").value = "";
  if ($id("notes-filter-note-city")) $id("notes-filter-note-city").value = "";
  if ($id("notes-filter-note-address")) $id("notes-filter-note-address").value = "";
}

function setCurrentFolder(folderId = "") {
  const safeFolderId = String(folderId || "").trim();
  if (state.selectedFolderId !== safeFolderId) {
    clearNoteFilters();
    state.folderView = "main";
    state._reminderPrefsApplied = false;
    reminderExpandedChecklist.clear();
    activeNotesStatsSection = "ratings";
  }
  state.selectedFolderId = safeFolderId;
}

function requireUnlockedFolder(folder) {
  if (!folder?.isPrivate) return true;
  return state.unlockedFolderIds.has(folder.id);
}

function formatFolderMeta(folder) {
  const parts = [];
  if (Number(folder?.childFoldersCount || 0) > 0) {
    parts.push(pluralize(Number(folder.childFoldersCount || 0), "carpeta", "carpetas"));
  }
  parts.push(pluralize(Number(folder?.notesCount || 0), "nota", "notas"));
  return parts.join(" · ");
}

function renderFolderCards(list, folders = [], { emptyText = "No hay carpetas todavía." } = {}) {
  if (!list) return;
  if (!folders.length) {
    list.innerHTML = `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
    return;
  }

  list.innerHTML = folders.map((folder) => {
    const subtitleClass = folder.isPrivate ? "notes-folder-meta is-private-blur" : "notes-folder-meta";
    const emoji = folder.emoji || "📁";
    return `
      <article class="notes-folder-card" data-folder-id="${escapeHtml(folder.id)}"
        style="--folder-color:${escapeHtml(folder.color)};--folder-bg:${tint(folder.color, 0.2)};--folder-glow:${tint(folder.color, 0.42)};">
        <button class="notes-folder-main" type="button" data-act="open-folder" data-folder-id="${escapeHtml(folder.id)}">
          <span class="notes-folder-icon">${escapeHtml(emoji)}</span>
          <span class="notes-folder-content">
            <strong class="notes-folder-title">${escapeHtml(folder.name)}</strong>
            <span class="${subtitleClass}">${escapeHtml(formatFolderMeta(folder))}</span>
          </span>
        </button>
        <span class="notes-folder-actions">
          <button class="icon-btn icon-btn-large" type="button" data-act="edit-folder" data-folder-id="${escapeHtml(folder.id)}">✏️</button>
          <button class="icon-btn icon-btn-large" type="button" data-act="delete-folder" data-folder-id="${escapeHtml(folder.id)}">🗑️</button>
        </span>
      </article>
    `;
  }).join("");
}

function renderRootFolders() {
  const list = $id("notes-folder-list");
  if (!list) return;

  const foldersWithStats = buildFolderStats(state.folders, state.notes);
  const rootFolders = getChildFolders(foldersWithStats, "");
  const filtered = filterFolders(
    rootFolders,
    state.folderQuery,
    state.folderCategoryFilter,
    state.folderTagsFilter,
  );

  const emptyText = state.folders.length
    ? "No hay carpetas en este nivel con esos filtros."
    : "No hay carpetas todavía.";

  renderFolderCards(list, filtered, { emptyText });
}

function renderFolderBreadcrumbs(path = []) {
  const breadcrumbs = $id("notes-folder-breadcrumbs");
  if (!breadcrumbs) return;

  const items = [
    '<button class="notes-breadcrumb-btn" type="button" data-act="breadcrumb-root">Raíz</button>',
  ];

  path.forEach((folder, index) => {
    const isCurrent = index === path.length - 1;
    items.push('<span class="notes-breadcrumb-sep">/</span>');
    if (isCurrent) {
      items.push(`<span class="notes-breadcrumb-current">${escapeHtml(folder.name)}</span>`);
      return;
    }
    items.push(`
      <button class="notes-breadcrumb-btn" type="button" data-act="open-breadcrumb" data-folder-id="${escapeHtml(folder.id)}">
        ${escapeHtml(folder.name)}
      </button>
    `);
  });

  breadcrumbs.innerHTML = items.join("");
}

function renderFolderViewSwitch() {
  const mainButton = $id("notes-folder-view-main-btn");
  const statsButton = $id("notes-folder-view-stats-btn");
  const isStatsView = state.folderView === "stats";

  if (mainButton) {
    mainButton.classList.toggle("is-active", !isStatsView);
    mainButton.setAttribute("aria-pressed", String(!isStatsView));
  }

  if (statsButton) {
    statsButton.classList.toggle("is-active", isStatsView);
    statsButton.setAttribute("aria-pressed", String(isStatsView));
  }
}

function buildStatsKpiCards(items = []) {
  return items.map((item) => `
    <article class="notes-stats-kpi">
      <span class="notes-stats-kpi-label">${escapeHtml(item.label || "")}</span>
      <strong class="notes-stats-kpi-value">${escapeHtml(item.value || "0")}</strong>
      <span class="notes-stats-kpi-meta">${escapeHtml(item.meta || "")}</span>
    </article>
  `).join("");
}

function buildStatsMetricChips(items = []) {
  const filtered = items.filter((item) => item?.label && item?.value !== undefined && item?.value !== null);
  if (!filtered.length) return "";

  return `
    <div class="notes-stats-metrics">
      ${filtered.map((item) => `
        <div class="notes-stats-metric">
          <span class="notes-stats-metric-label">${escapeHtml(item.label)}</span>
          <strong class="notes-stats-metric-value">${escapeHtml(String(item.value))}</strong>
        </div>
      `).join("")}
    </div>
  `;
}

function buildStatsBarList(items = [], {
  labelFormatter = (item) => item?.label || "",
  valueFormatter = (item) => formatNumber(item?.count || 0),
  percentageKey = "percentage",
  emptyText = "Sin datos todavia.",
} = {}) {
  if (!items.length) {
    return `<div class="notes-stats-empty-copy">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="notes-stats-bars">
      ${items.map((item) => {
        const fill = Math.max(0, Math.min(100, Number(item?.[percentageKey] || 0)));
        return `
          <div class="notes-stats-bar-row">
            <div class="notes-stats-bar-head">
              <strong class="notes-stats-bar-label">${escapeHtml(labelFormatter(item))}</strong>
              <span class="notes-stats-bar-value">${escapeHtml(valueFormatter(item))}</span>
            </div>
            <div class="notes-stats-bar-track">
              <span class="notes-stats-bar-fill" style="width:${fill.toFixed(1)}%"></span>
            </div>
          </div>
        `;
      }).join("")}
    </div>
  `;
}

function buildStatsNoteList(items = [], metaBuilder = () => "", emptyText = "Sin datos todavia.") {
  if (!items.length) {
    return `<div class="notes-stats-empty-copy">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="notes-stats-list">
      ${items.map((item) => {
        const meta = metaBuilder(item);
        return `
          <article class="notes-stats-list-item">
            <strong class="notes-stats-list-title">${escapeHtml(item?.title || "Sin titulo")}</strong>
            ${meta ? `<span class="notes-stats-list-meta">${escapeHtml(meta)}</span>` : ""}
          </article>
        `;
      }).join("")}
    </div>
  `;
}

function buildNationalitiesStatsMarkup(insights = {}) {
  const personNotesCount = Number(insights?.personNotesCount || 0);
  const nationalityStats = Array.isArray(insights?.nationalityStats) ? insights.nationalityStats : [];
  if (!personNotesCount) return "";
  const mappableNationalities = nationalityStats.filter((row) => row?.mappable);
  const unmappedNationalities = nationalityStats.filter((row) => row?.label !== "Sin nacionalidad" && !row?.mappable);

  return `
    <article class="notes-stats-card">
      <div class="notes-stats-card-head">
        <h3 class="notes-stats-card-title">Nacionalidades</h3>
        <p class="notes-stats-card-copy">Recuento de notas tipo persona agrupadas por pais.</p>
      </div>
      ${buildStatsMetricChips([
        { label: "Personas", value: formatNumber(personNotesCount) },
        { label: "Paises", value: formatNumber(nationalityStats.filter((row) => row?.label !== "Sin nacionalidad").length) },
        { label: "Sin nacionalidad", value: formatNumber(insights?.nationalityMissingCount || 0) },
        { label: "Sin mapa", value: formatNumber(unmappedNationalities.length) },
      ])}
      <div class="notes-nationalities-layout">
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Heatmap mundial</strong>
          </div>
          <div class="notes-nationalities-map-shell">
            <div class="notes-nationalities-world-map" id="notes-nationalities-world-map" data-empty-text="Aun no hay nacionalidades ubicables en el mapa."></div>
          </div>
          ${mappableNationalities.length ? `
            <p class="notes-nationalities-map-caption">
              ${escapeHtml(`${formatNumber(mappableNationalities.length)} paises ubicados en el mapa`)}
            </p>
          ` : '<div class="notes-stats-empty-copy">Aun no hay nacionalidades ubicables en el mapa.</div>'}
        </div>
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Ranking</strong>
          </div>
          ${buildStatsBarList(nationalityStats, {
            labelFormatter: (row) => row.label || "Sin nacionalidad",
            valueFormatter: (row) => `${formatNumber(row.count || 0)} personas`,
            emptyText: "Todavia no hay personas en esta carpeta.",
          })}
          ${unmappedNationalities.length ? `
            <div class="notes-stats-block">
              <div class="notes-stats-block-head">
                <strong>Sin correspondencia exacta en el mapa</strong>
              </div>
              <div class="notes-nationalities-unmapped">
                ${unmappedNationalities.map((row) => `
                  <span class="notes-nationalities-unmapped-chip">${escapeHtml(row.label || row.rawLabel || "Nacionalidad")}</span>
                `).join("")}
              </div>
            </div>
          ` : ""}
        </div>
      </div>
    </article>
  `;
}

async function renderNotesNationalitiesWorldMap(insights = {}) {
  const host = $id("notes-nationalities-world-map");
  if (!host) return;

  const nationalityStats = Array.isArray(insights?.nationalityStats) ? insights.nationalityStats : [];
  const entries = nationalityStats
    .filter((row) => row?.mappable && row?.code && Number(row?.count || 0) > 0)
    .map((row) => ({
      code: row.code,
      label: row.label || row.rawLabel || row.code,
      mapName: row.mapName || row.label || row.code,
      value: Number(row.count || 0),
    }));

  try {
    if (!entries.length) {
      if (typeof host.__geoCleanup === "function") {
        host.__geoCleanup();
        delete host.__geoCleanup;
      }
      host.innerHTML = `<div class="geo-empty">${escapeHtml(host.dataset.emptyText || "Aun no hay nacionalidades ubicables en el mapa.")}</div>`;
      return;
    }

    if (!host.__notesNationalitiesMapInitLogged) {
      console.debug("[notes:nationalities-map:init]", entries.length);
      host.__notesNationalitiesMapInitLogged = true;
    }
    console.debug("[notes:nationalities-map:update]", entries.length);

    await renderCountryHeatmap(host, entries, {
      emptyLabel: host.dataset.emptyText || "Aun no hay nacionalidades ubicables en el mapa.",
      showTooltip: true,
      tooltipNoun: "personas",
    });
  } catch (error) {
    console.warn("[notes:nationalities-map:error]", error);
    host.innerHTML = `<div class="geo-empty">${escapeHtml(host.dataset.emptyText || "No se pudo mostrar el mapa de nacionalidades.")}</div>`;
  }
}

function renderFolderStatsView(folder, insights, childFolders = []) {
  const kpiWrap = $id("notes-stats-kpis");
  const grid = $id("notes-stats-grid");
  const empty = $id("notes-empty-stats");
  if (!kpiWrap || !grid || !empty) return;

  const totalNotes = Number(insights?.totalNotes || 0);
  const averageRatingLabel = insights?.averageRating === null
    ? "—"
    : `${formatCompactNumber(insights.averageRating)}/10`;

  kpiWrap.innerHTML = buildStatsKpiCards([
    {
      label: "Notas",
      value: formatNumber(totalNotes),
      meta: childFolders.length ? `${formatNumber(childFolders.length)} subcarpetas` : "En esta carpeta",
    },
    {
      label: "Media",
      value: averageRatingLabel,
      meta: insights?.ratedNotesCount ? `${formatNumber(insights.ratedNotesCount)} valoradas` : "Sin ratings",
    },
    {
      label: "Valoradas",
      value: formatPercentage(insights?.ratedShare || 0),
      meta: `${formatNumber(insights?.unratedNotesCount || 0)} sin rating`,
    },
    {
      label: "Tags unicos",
      value: formatNumber(insights?.uniqueTagsCount || 0),
      meta: `${formatNumber(insights?.totalTagAssignments || 0)} usos`,
    },
    {
      label: "Palabras",
      value: formatNumber(insights?.totalWords || 0),
      meta: `${formatCompactNumber(insights?.averageWords || 0)} de media`,
    },
    {
      label: "Creadas 30d",
      value: formatNumber(insights?.createdRecently30d || 0),
      meta: `${formatNumber(insights?.editedRecently30d || 0)} editadas`,
    },
  ]);

  empty.classList.toggle("hidden", totalNotes > 0);
  grid.classList.toggle("hidden", totalNotes === 0);
  if (!totalNotes) {
    grid.innerHTML = "";
    return;
  }

  const ratingDistribution = (insights?.ratingDistribution || []).filter((row) => Number(row?.count || 0) > 0);
  const topRatedTags = (insights?.topRatedTags || []).map((row) => ({
    ...row,
    percentageOfAverage: (Number(row?.averageRating || 0) / 10) * 100,
  }));
  const monthlyActivity = insights?.activityByMonth || [];

  grid.innerHTML = `
    <article class="notes-stats-card">
      <div class="notes-stats-card-head">
        <h3 class="notes-stats-card-title">Ratings</h3>
        <p class="notes-stats-card-copy">Distribucion y notas destacadas de la carpeta.</p>
      </div>
      ${buildStatsMetricChips([
        { label: "Media", value: averageRatingLabel },
        { label: "Con rating", value: formatNumber(insights?.ratedNotesCount || 0) },
        { label: "Sin rating", value: formatNumber(insights?.unratedNotesCount || 0) },
        { label: "Mejor nota", value: insights?.maxRating === null ? "—" : formatRatingValue(insights.maxRating) },
      ])}
      <div class="notes-stats-block">
        <div class="notes-stats-block-head">
          <strong>Distribucion</strong>
        </div>
        ${buildStatsBarList(ratingDistribution, {
          labelFormatter: (row) => `${row.value}/10`,
          valueFormatter: (row) => `${formatNumber(row.count)} notas`,
          emptyText: "Aun no hay notas valoradas en esta carpeta.",
        })}
      </div>
      <div class="notes-stats-split">
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Top rating</strong>
          </div>
          ${buildStatsNoteList(
            insights?.bestRatedNotes || [],
            (note) => `${formatRatingValue(note.rating)} · ${formatCompactDate(note.updatedAt || note.createdAt)} · ${formatNumber(note.tagsCount || 0)} tags`,
            "Todavia no hay notas valoradas.",
          )}
        </div>
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Rating mas bajo</strong>
          </div>
          ${buildStatsNoteList(
            insights?.worstRatedNotes || [],
            (note) => `${formatRatingValue(note.rating)} · ${formatCompactDate(note.updatedAt || note.createdAt)} · ${formatNumber(note.tagsCount || 0)} tags`,
            "No hay suficiente variedad para mostrar una peor nota.",
          )}
        </div>
      </div>
    </article>

    <article class="notes-stats-card">
      <div class="notes-stats-card-head">
        <h3 class="notes-stats-card-title">Tags</h3>
        <p class="notes-stats-card-copy">Uso real de etiquetas y relacion con notas valoradas.</p>
      </div>
      ${buildStatsMetricChips([
        { label: "Con tags", value: formatPercentage(insights?.tagsCoverage || 0) },
        { label: "Media tags", value: formatCompactNumber(insights?.tagsPerNoteAverage || 0) },
        { label: "Sin tags", value: formatNumber(insights?.notesWithoutTagsCount || 0) },
      ])}
      <div class="notes-stats-block">
        <div class="notes-stats-block-head">
          <strong>Ranking de tags</strong>
        </div>
        ${buildStatsBarList((insights?.topTags || []).slice(0, 6), {
          labelFormatter: (row) => row.label || "",
          valueFormatter: (row) => `${formatNumber(row.count)} · ${formatPercentage(row.percentage || 0)}`,
          emptyText: "Esta carpeta aun no tiene tags usados en notas.",
        })}
      </div>
      <div class="notes-stats-block">
        <div class="notes-stats-block-head">
          <strong>Tags mejor valorados</strong>
        </div>
        ${buildStatsBarList(topRatedTags, {
          labelFormatter: (row) => row.label || "",
          valueFormatter: (row) => `${formatCompactNumber(row.averageRating || 0)}/10 · ${formatNumber(row.count || 0)} notas`,
          percentageKey: "percentageOfAverage",
          emptyText: "Necesitas al menos dos notas valoradas por tag para compararlos.",
        })}
      </div>
    </article>

    <article class="notes-stats-card">
      <div class="notes-stats-card-head">
        <h3 class="notes-stats-card-title">Notas</h3>
        <p class="notes-stats-card-copy">Actividad reciente, longitud y densidad de contenido.</p>
      </div>
      ${buildStatsMetricChips([
        { label: "Creadas 7d", value: formatNumber(insights?.createdRecently7d || 0) },
        { label: "Editadas 30d", value: formatNumber(insights?.editedRecently30d || 0) },
        { label: "Caracteres", value: formatNumber(insights?.totalCharacters || 0) },
        { label: "Media car.", value: formatCompactNumber(insights?.averageCharacters || 0) },
      ])}
      <div class="notes-stats-block">
        <div class="notes-stats-block-head">
          <strong>Evolucion mensual</strong>
        </div>
        ${buildStatsBarList(monthlyActivity, {
          labelFormatter: (row) => row.label || "",
          valueFormatter: (row) => `${formatNumber(row.count || 0)} notas`,
          emptyText: "Aun no hay suficientes fechas de creacion para mostrar evolucion.",
        })}
      </div>
      <div class="notes-stats-split">
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Con mas tags</strong>
          </div>
          ${buildStatsNoteList(
            insights?.notesWithMostTags || [],
            (note) => `${formatNumber(note.tagsCount || 0)} tags · ${formatCompactDate(note.updatedAt || note.createdAt)}`,
            "Todavia no hay notas etiquetadas.",
          )}
        </div>
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Ultimas ediciones</strong>
          </div>
          ${buildStatsNoteList(
            insights?.recentlyUpdatedNotes || [],
            (note) => `${formatLongDate(note.updatedAt)} · ${formatNumber(note.tagsCount || 0)} tags`,
            "Todavia no hay ediciones recientes.",
          )}
        </div>
      </div>
      <div class="notes-stats-split">
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Nombres repetidos</strong>
          </div>
          ${buildStatsBarList(insights?.duplicateTitles || [], {
            labelFormatter: (row) => row.title || "",
            valueFormatter: (row) => `${formatNumber(row.count || 0)} notas`,
            emptyText: "No hay nombres repetidos en esta carpeta.",
          })}
        </div>
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Mas larga</strong>
          </div>
          ${buildStatsNoteList(
            insights?.longestNote ? [insights.longestNote] : [],
            (note) => `${formatNumber(note.characters || 0)} car. · ${formatNumber(note.words || 0)} palabras`,
            "Sin contenido suficiente para comparar longitud.",
          )}
        </div>
        <div class="notes-stats-block">
          <div class="notes-stats-block-head">
            <strong>Mas corta</strong>
          </div>
          ${buildStatsNoteList(
            insights?.shortestNote ? [insights.shortestNote] : [],
            (note) => `${formatNumber(note.characters || 0)} car. · ${formatNumber(note.words || 0)} palabras`,
            "Sin contenido suficiente para comparar longitud.",
          )}
        </div>
      </div>
    </article>
  `;
}

function renderNoteCards(list, notes = []) {
  if (!list) return;

  list.innerHTML = notes.map((note) => {
    const preview = notePreview(note);
    const isCodeNote = normalizeNoteKind(note?.noteKind) === "code";
    const isPersonNote = normalizeNoteKind(note?.noteKind) === "persona";
    const displayTitle = getNoteDisplayTitle(note) || note.title || "Sin tÃ­tulo";
    const noteImageUrl = isCodeNote ? "" : buildNoteImageRenderUrl(note);
    const tagPreview = resolveNoteTagPreview(note);
    const externalUrl = normalizeExternalUrl(note.url);
    const detectedLinks = collectNoteExternalLinks(note);
    const attachments = getNoteAttachmentImages(note);
    const linkMarkup = note.type === "link"
      ? (externalUrl
        ? `
          <a
            class="notes-item-link notes-item-link-anchor"
            href="${escapeHtml(externalUrl)}"
            target="_blank"
            rel="noopener noreferrer external"
            referrerpolicy="no-referrer"
            data-act="open-note-link"
            data-note-id="${escapeHtml(note.id)}"
            data-note-url="${escapeHtml(note.url || "")}"
          >${escapeHtml(urlHost(note.url) || note.url || "")} ↗</a>
        `
        : `<p class="notes-item-link">${escapeHtml(urlHost(note.url) || note.url || "")}</p>`)
      : "";
    const isNormalNote = !isCodeNote && note.type !== "link";
    const mediaMarkup = isNormalNote
      ? ""
      : (isCodeNote
        ? ""
        : (tagPreview?.imageUrl
        ? `
          <div class="notes-item-media is-image">
            <img class="notes-item-tag-image" src="${escapeHtml(tagPreview.imageUrl)}" alt="${escapeHtml(`Tag ${tagPreview.label || "nota"}`)}" loading="lazy" decoding="async" />
          </div>
        `
        : `
          <div class="notes-item-media is-placeholder">
            <span class="notes-item-icon">${escapeHtml(buildNoteKindIcon(note))}</span>
          </div>
        `));

    const cardClass = [
      "notes-item-card",
      noteImageUrl ? "has-note-image" : "",
      isCodeNote ? "is-code-note" : "",
      isNormalNote ? "is-compact-note" : "",
    ].filter(Boolean).join(" ");
    const cardStyle = buildNoteCardStyleAttribute(note);
    const ratingMarkup = buildRatingBadgeMarkup(note?.rating);
    const visitsMarkup = buildVisitsBadgeMarkup(note);
    const codeKindMarkup = isCodeNote
      ? `<span class="notes-item-kind-badge">${escapeHtml(buildCodeLanguageBadgeLabel(note?.codeLanguage))}</span>`
      : "";
    const compactMetaMarkup = isNormalNote ? buildCompactNoteMetaMarkup(note) : "";
    const metaMarkup = isNormalNote
      ? compactMetaMarkup
      : [codeKindMarkup, ratingMarkup, visitsMarkup].filter(Boolean).join("");
    const snippetMarkup = buildSnippetMarkup(note);
    const personIcons = isNormalNote
      ? ""
      : isPersonNote
      ? `${note?.person?.phone ? "📞" : ""} ${note?.person?.address || note?.location?.label ? "🏠" : ""} ${note?.person?.socials ? "📱" : ""} ${note?.person?.birthday ? "🎂" : ""}`.trim()
      : "";
    const isExpanded = expandedSnippetNotes.has(note.id);
    const headClass = isCodeNote ? "notes-item-head is-snippet-toggle" : "notes-item-head";
    const headAttrs = isCodeNote
      ? ` data-act="toggle-note-snippet" data-note-id="${escapeHtml(note.id)}" role="button" tabindex="0" aria-expanded="${isExpanded ? "true" : "false"}"`
      : "";

    return `
      <article class="${cardClass}" data-note-id="${escapeHtml(note.id)}"${cardStyle}>
        ${mediaMarkup}
        <div class="notes-item-content">
          <div class="${headClass}"${headAttrs}>
            <h4 class="notes-item-title">${buildSafeLinkedTextMarkup(displayTitle, { className: "notes-inline-link notes-inline-link--external" })}</h4>
            ${metaMarkup ? `<div class="notes-item-meta">${metaMarkup}</div>` : ""}
          </div>
          ${personIcons ? `<p class="notes-item-preview">${escapeHtml(personIcons)}</p>` : ""}
          ${preview && note.type === "link" && !isCodeNote && !personIcons ? `<p class="notes-item-preview notes-item-preview-links">${buildSafeLinkedTextMarkup(preview, { className: "notes-inline-link notes-inline-link--external" })}</p>` : ""}
          ${isCodeNote ? snippetMarkup : linkMarkup}
          ${buildDetectedLinksListMarkup(detectedLinks)}
          ${attachments.length ? buildNoteAttachmentsMarkup(attachments, { compact: true }) : ""}
        </div>
        <div class="notes-item-actions">
          <button class="icon-btn icon-btn-large" type="button" data-act="edit-note" data-note-id="${escapeHtml(note.id)}">✏️</button>
          <button class="icon-btn icon-btn-large" type="button" data-act="delete-note" data-note-id="${escapeHtml(note.id)}">🗑️</button>
        </div>
      </article>
    `;
  }).join("");

  syncSnippetPreviewFrames(list, notes);
}

function formatPlainTextMarkup(value = "") {
  return escapePlainTextWithBreaks(value);
}

function buildNoteRichTextMarkup(note = {}) {
  const content = String(note?.content || "");
  const wikiLinks = buildResolvedWikiLinks(note).map((link) => ({ ...link, type: "wiki" }));
  const wikiRanges = wikiLinks.map((link) => [link.start, link.end]);
  const externalLinks = extractExternalLinksFromText(content)
    .filter((link) => !wikiRanges.some(([start, end]) => link.start < end && link.end > start))
    .map((link) => ({ ...link, type: "external" }));
  const tokens = [...wikiLinks, ...externalLinks].sort((a, b) => a.start - b.start);
  if (!tokens.length) return buildSafeLinkedTextMarkup(content, { className: "notes-inline-link notes-inline-link--external" });

  let cursor = 0;
  let html = "";
  tokens.forEach((token) => {
    if (token.start < cursor) return;
    html += formatPlainTextMarkup(content.slice(cursor, token.start));
    if (token.type === "external") {
      html += buildExternalLinkAnchorMarkup(token, { className: "notes-inline-link notes-inline-link--external" });
      cursor = token.end;
      return;
    }
    const target = resolveWikiLinkTarget(token);
    const label = target ? (getNoteDisplayTitle(target) || token.label) : (token.label || "Enlace");
    html += target
      ? `<button class="notes-inline-link" type="button" data-act="open-linked-note" data-linked-note-id="${escapeHtml(target.id)}">${escapeHtml(label)}</button>`
      : `<span class="notes-inline-link-broken" title="Nota no disponible">${escapeHtml(label)}</span>`;
    cursor = token.end;
  });
  html += formatPlainTextMarkup(content.slice(cursor));
  return html;
}

function buildDetailChipMarkup(items = []) {
  const safeItems = (Array.isArray(items) ? items : []).filter(Boolean);
  if (!safeItems.length) return "";
  return `<div class="notes-detail-chips">${safeItems.map((item) => `<span class="notes-detail-chip">${escapeHtml(item)}</span>`).join("")}</div>`;
}

function getPersonNotesEntries(note = {}) {
  return (Array.isArray(note?.person?.notesEntries) ? note.person.notesEntries : [])
    .filter((entry) => entry?.id && entry?.text)
    .sort((a, b) => Number(b?.updatedAt || b?.createdAt || 0) - Number(a?.updatedAt || a?.createdAt || 0));
}

function buildNoteRelationSnapshot(note = {}) {
  const linkedNotes = [];
  const linkedPeople = [];
  const seenLinkedIds = new Set();

  buildResolvedWikiLinks(note).forEach((link) => {
    const target = resolveWikiLinkTarget(link);
    if (!target?.id || seenLinkedIds.has(target.id)) return;
    seenLinkedIds.add(target.id);
    linkedNotes.push(target);
    if (normalizeNoteKind(target?.noteKind) === "persona") linkedPeople.push(target);
  });

  const mentioningNotes = (state.notes || []).filter((row) => row?.id && row.id !== note.id)
    .filter((row) => buildResolvedWikiLinks(row).some((link) => String(link?.targetId || "").trim() === String(note.id || "").trim()));

  const tags = new Set(Array.isArray(note?.tags) ? note.tags : []);
  const categories = new Set([String(note?.category || "").trim()].filter(Boolean));
  const locations = new Set([String(note?.location?.label || note?.location?.text || "").trim()].filter(Boolean));
  const nationalities = new Set([getNotePersonFields(note).nationality].filter(Boolean));

  mentioningNotes.forEach((row) => {
    (row?.tags || []).forEach((tag) => tags.add(String(tag || "").trim()));
    if (row?.category) categories.add(String(row.category).trim());
    const locationLabel = String(row?.location?.label || row?.location?.text || "").trim();
    if (locationLabel) locations.add(locationLabel);
    const nationality = getNotePersonFields(row).nationality;
    if (nationality) nationalities.add(nationality);
  });

  return {
    linkedNotes,
    linkedPeople,
    mentioningNotes,
    tags: Array.from(tags).filter(Boolean),
    categories: Array.from(categories).filter(Boolean),
    locations: Array.from(locations).filter(Boolean),
    nationalities: Array.from(nationalities).filter(Boolean),
  };
}

function buildNotesConnectionGraphData(notes = []) {
  const nodes = [];
  const edges = [];
  const seenNodes = new Set();
  const seenEdges = new Set();

  const pushNode = (id, kind, label, meta = {}) => {
    const safeId = String(id || "").trim();
    if (!safeId || seenNodes.has(safeId)) return;
    seenNodes.add(safeId);
    nodes.push({ id: safeId, kind, label: String(label || "").trim() || safeId, ...meta });
  };

  const pushEdge = (from, to, type) => {
    const safeFrom = String(from || "").trim();
    const safeTo = String(to || "").trim();
    const safeType = String(type || "").trim();
    const key = `${safeFrom}|${safeTo}|${safeType}`;
    if (!safeFrom || !safeTo || !safeType || seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ from: safeFrom, to: safeTo, type: safeType });
  };

  (Array.isArray(notes) ? notes : []).forEach((note) => {
    pushNode(note.id, normalizeNoteKind(note?.noteKind) === "persona" ? "person" : "note", getNoteDisplayTitle(note));

    (note?.tags || []).forEach((tag) => {
      const id = `tag:${normalizeNoteLookup(tag)}`;
      pushNode(id, "tag", tag);
      pushEdge(note.id, id, "tag");
    });

    if (note?.category) {
      const id = `category:${normalizeNoteLookup(note.category)}`;
      pushNode(id, "category", note.category);
      pushEdge(note.id, id, "category");
    }

    const locationLabel = String(note?.location?.label || note?.location?.text || "").trim();
    if (locationLabel) {
      const id = `location:${normalizeNoteLookup(locationLabel)}`;
      pushNode(id, "location", locationLabel);
      pushEdge(note.id, id, "location");
    }

    const nationality = getNotePersonFields(note).nationality;
    if (nationality) {
      const id = `nationality:${normalizeNoteLookup(nationality)}`;
      pushNode(id, "nationality", nationality);
      pushEdge(note.id, id, "nationality");
    }

    buildResolvedWikiLinks(note).forEach((link) => {
      const targetId = String(link?.targetId || "").trim();
      if (!targetId) return;
      pushEdge(note.id, targetId, "wiki-link");
    });
  });

  return { nodes, edges };
}

function createPersonNoteEntryId() {
  return `person_note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function mergeNoteIntoState(nextNote = null) {
  const noteId = String(nextNote?.id || "").trim();
  if (!noteId) return;
  state.notes = (state.notes || []).map((row) => (row.id === noteId ? nextNote : row));
}

function setNoteDetailSaveFeedback(message = "", tone = "") {
  const feedback = $id("notes-detail-save-feedback");
  if (!feedback) return;
  feedback.textContent = String(message || "").trim();
  feedback.classList.remove("is-error", "is-success");
  if (tone === "error") feedback.classList.add("is-error");
  if (tone === "success") feedback.classList.add("is-success");
}

function buildEditableDetailField(label = "", id = "", value = "", type = "text") {
  return `
    <label class="notes-detail-field notes-detail-field--editable" for="${escapeHtml(id)}">
      <span class="notes-detail-field-label">${escapeHtml(label)}</span>
      <input class="notes-detail-input" id="${escapeHtml(id)}" type="${escapeHtml(type)}" value="${escapeHtml(value)}" placeholder="—" />
    </label>
  `;
}

function renderNoteDetail() {
  const backdrop = $id("notes-note-detail-backdrop");
  const body = $id("notes-detail-body");
  const title = $id("notes-detail-title");
  const subtitle = $id("notes-detail-subtitle");
  if (!backdrop || !body || !title || !subtitle) return;

  const note = state.notes.find((row) => row.id === activeNoteDetailId);
  if (!note) {
    activeNoteDetailId = "";
    activeNoteDetailSourceFolderId = "";
    closeModal("notes-note-detail-backdrop");
    body.innerHTML = "";
    return;
  }

  const isPerson = normalizeNoteKind(note?.noteKind) === "persona";
  const person = getNotePersonFields(note);
  const relations = buildNoteRelationSnapshot(note);
  const detailTitle = getNoteDisplayTitle(note) || note.title || "Sin título";
  const avatarLabel = (person.firstName || detailTitle || "P").trim().charAt(0).toUpperCase() || "P";
  const detectedLinks = collectNoteExternalLinks(note);
  const attachments = getNoteAttachmentImages(note);
  const detailSubtitleParts = [
    isPerson ? "Persona" : "Nota",
    note?.category || "",
    person.nationality || "",
  ].filter(Boolean);
  const detailFields = isPerson
    ? [
      ["Nombre", person.firstName || "—"],
      ["Apellido", person.lastName || "—"],
      ["Nacionalidad", person.nationality || "—"],
      ["Teléfono", person.phone || "—"],
      ["Cumpleaños", person.birthday || "—"],
      ["Dirección", person.address || note?.location?.label || "—"],
      ["Redes", person.socials || "—"],
    ]
    : [
      ["Categoría", note?.category || "—"],
      ["Ubicación", note?.location?.label || note?.location?.text || "—"],
      ["Creada", formatLongDate(note?.createdAt || 0)],
      ["Actualizada", formatLongDate(note?.updatedAt || 0)],
    ];

  title.textContent = detailTitle;
  subtitle.textContent = detailSubtitleParts.join(" · ") || "Detalle";

  body.innerHTML = `
    <article class="notes-detail-card">
      <div class="notes-detail-head">
        <div class="notes-detail-copy">
          <span class="notes-detail-kicker">${escapeHtml(isPerson ? "Ficha de persona" : "Detalle de nota")}</span>
          <h3 class="notes-detail-name">${buildSafeLinkedTextMarkup(detailTitle, { className: "notes-inline-link notes-inline-link--external" })}</h3>
          <div class="notes-detail-meta">${escapeHtml(detailSubtitleParts.join(" · ") || "Sin metadatos")}</div>
          ${buildDetailChipMarkup((note?.tags || []).concat(note?.category ? [note.category] : []).filter(Boolean))}
        </div>
        <div class="notes-detail-actions">
          <button class="btn ghost btn-compact" type="button" data-act="edit-note-detail" data-note-id="${escapeHtml(note.id)}">Editar</button>
        </div>
      </div>
    </article>

    <article class="notes-detail-card">
      <h3 class="notes-detail-section-title">${escapeHtml(isPerson ? "Datos básicos" : "Resumen")}</h3>
      ${isPerson ? `
        <div class="notes-detail-grid">
          ${buildEditableDetailField("NOMBRE", "notes-detail-person-first-name", person.firstName || "", "text")}
          ${buildEditableDetailField("APELLIDO", "notes-detail-person-last-name", person.lastName || "", "text")}
          ${buildEditableDetailField("NACIONALIDAD", "notes-detail-person-nationality", person.nationality || "", "text")}
          ${buildEditableDetailField("TELEFONO", "notes-detail-person-phone", person.phone || "", "text")}
          ${buildEditableDetailField("CUMPLEANOS", "notes-detail-person-birthday", person.birthday || "", "date")}
          ${buildEditableDetailField("DIRECCION", "notes-detail-person-address", person.address || note?.location?.label || "", "text")}
          ${buildEditableDetailField("REDES", "notes-detail-person-socials", person.socials || "", "text")}
        </div>
        <div class="notes-detail-inline-actions">
          <p class="notes-detail-save-feedback" id="notes-detail-save-feedback"></p>
          <div class="notes-duplicate-warning notes-detail-duplicate-warning hidden" id="notes-detail-duplicate-warning" aria-live="polite"></div>
          <div class="notes-detail-inline-buttons">
            <button class="btn primary btn-compact" type="button" data-act="save-person-detail" data-note-id="${escapeHtml(note.id)}">Guardar cambios</button>
            <button class="btn ghost btn-compact" type="button" data-act="edit-note-detail" data-note-id="${escapeHtml(note.id)}">Editar completo</button>
          </div>
        </div>
      ` : `
        <div class="notes-detail-grid">
          ${detailFields.map(([label, value]) => `
            <div class="notes-detail-field">
              <span class="notes-detail-field-label">${escapeHtml(label)}</span>
              <span class="notes-detail-field-value">${escapeHtml(value)}</span>
            </div>
          `).join("")}
        </div>
      `}
    </article>

    ${false && note?.content ? `
      <article class="notes-detail-card">
        <h3 class="notes-detail-section-title">${escapeHtml(isPerson ? "Descripción" : "Contenido")}</h3>
        <div class="notes-detail-richtext">${buildNoteRichTextMarkup(note)}</div>
      </article>
    ` : ""}

    ${note?.content ? `
      <article class="notes-detail-card">
        <h3 class="notes-detail-section-title">${escapeHtml(isPerson ? "DescripciÃƒÂ³n" : "Contenido")}</h3>
        <div class="notes-detail-richtext">${buildNoteRichTextMarkup(note)}</div>
        ${buildDetectedLinksListMarkup(detectedLinks)}
      </article>
    ` : ""}

    ${!note?.content && detectedLinks.length ? `
      <article class="notes-detail-card">
        <h3 class="notes-detail-section-title">Enlaces detectados</h3>
        ${buildDetectedLinksListMarkup(detectedLinks)}
      </article>
    ` : ""}

    ${attachments.length ? `
      <article class="notes-detail-card">
        <h3 class="notes-detail-section-title">Imagenes adjuntas</h3>
        ${buildNoteAttachmentsMarkup(attachments)}
      </article>
    ` : ""}

    ${isPerson ? `
      <article class="notes-detail-card">
        <h3 class="notes-detail-section-title">Notas sobre esta persona</h3>
        <div class="notes-detail-add-note">
          <textarea id="notes-person-note-input" placeholder="Añadir nota breve sobre esta persona..."></textarea>
          <button class="btn primary btn-compact" type="button" data-act="add-person-note" data-note-id="${escapeHtml(note.id)}">Añadir nota</button>
        </div>
        <div class="notes-detail-person-notes">
          ${getPersonNotesEntries(note).map((entry) => `
            <article class="notes-detail-person-note">
              <div class="notes-detail-person-note-text">${formatPlainTextMarkup(entry.text)}</div>
              <div class="notes-detail-person-note-meta">${escapeHtml(formatLongDate(entry.updatedAt || entry.createdAt || 0))}</div>
              <div class="notes-detail-person-note-actions">
                <button class="btn ghost danger btn-compact" type="button" data-act="delete-person-note" data-note-id="${escapeHtml(note.id)}" data-entry-id="${escapeHtml(entry.id)}">Eliminar</button>
              </div>
            </article>
          `).join("") || '<div class="notes-stats-empty-copy">Todavía no hay notas internas sobre esta persona.</div>'}
        </div>
      </article>
    ` : ""}

    <article class="notes-detail-card">
      <h3 class="notes-detail-section-title">Relaciones</h3>
      ${relations.linkedPeople.length ? `
        <div class="notes-detail-related-list">
          <div class="notes-detail-kicker">Personas vinculadas</div>
          ${relations.linkedPeople.map((row) => `
            <button class="notes-detail-related-item" type="button" data-act="open-related-note" data-note-id="${escapeHtml(row.id)}">
              <strong>${escapeHtml(getNoteDisplayTitle(row) || row.title || "Sin título")}</strong>
              <span class="notes-detail-related-meta">${escapeHtml(getNotePersonFields(row).nationality || "Persona vinculada")}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
      ${relations.mentioningNotes.length ? `
        <div class="notes-detail-related-list">
          <div class="notes-detail-kicker">Notas donde aparece mencionada</div>
          ${relations.mentioningNotes.map((row) => `
            <button class="notes-detail-related-item" type="button" data-act="open-related-note" data-note-id="${escapeHtml(row.id)}">
              <strong>${escapeHtml(getNoteDisplayTitle(row) || row.title || "Sin título")}</strong>
              <span class="notes-detail-related-meta">${escapeHtml(row.category || "Nota")}</span>
            </button>
          `).join("")}
        </div>
      ` : ""}
      ${buildDetailChipMarkup([
        ...relations.tags,
        ...relations.categories,
        ...relations.locations,
        ...relations.nationalities,
      ]) || '<div class="notes-stats-empty-copy">Sin relaciones derivadas suficientes todavía.</div>'}
    </article>
  `;
}

function renderFolderDetail() {
  const panel = $id("notes-folder-screen");
  const mainView = $id("notes-folder-main-view");
  const statsView = $id("notes-folder-stats-view");
  const subfolderBlock = $id("notes-subfolder-block");
  const subfolderList = $id("notes-subfolder-list");
  const empty = $id("notes-empty-folder");
  const notesList = $id("notes-cards-list");
  const notesLabel = $id("notes-notes-section-label");
  if (!panel || !mainView || !statsView || !subfolderBlock || !subfolderList || !empty || !notesList || !notesLabel) return;

  const foldersWithStats = buildFolderStats(state.folders, state.notes);
  const folder = foldersWithStats.find((item) => item.id === state.selectedFolderId);
  if (!folder) {
    panel.classList.add("hidden");
    return;
  }

  updateFilterOptionsForNotes();

  const childFolders = getChildFolders(foldersWithStats, folder.id);
  const allNotes = filterNotesByFolder(state.notes, folder.id);
  const visibleNotes = sortNotes(filterNotesByFolder(
    state.notes,
    folder.id,
    state.noteQuery,
    state.noteCategoryFilter,
    state.noteTagsFilter,
    state.noteLocationFilters,
  ), state.noteSort);
  const insights = buildFolderInsights(state.notes, folder.id);
  const hasFilteredNotes = visibleNotes.length !== allNotes.length;
  const sortSelect = $id("notes-filter-note-sort");

  panel.classList.remove("hidden");
  $id("notes-folder-name").textContent = folder.name;
  $id("notes-folder-count").textContent = [
    pluralize(childFolders.length, "subcarpeta", "subcarpetas"),
    pluralize(allNotes.length, "nota", "notas"),
    hasFilteredNotes ? `${pluralize(visibleNotes.length, "resultado", "resultados")} visibles` : "",
  ].filter(Boolean).join(" · ");
  renderFolderBreadcrumbs(getFolderPath(foldersWithStats, folder.id));
  renderFolderViewSwitch();
  if (sortSelect) sortSelect.value = normalizeNoteSortOption(state.noteSort);

  subfolderBlock.classList.toggle("hidden", childFolders.length === 0);
  renderFolderCards(subfolderList, childFolders, { emptyText: "No hay subcarpetas." });

  notesLabel.classList.toggle("hidden", visibleNotes.length === 0);
  renderNoteCards(notesList, visibleNotes);
  renderFolderStatsSectionView(folder, insights, childFolders);

  empty.classList.toggle("hidden", childFolders.length > 0 || visibleNotes.length > 0);
  mainView.classList.toggle("hidden", state.folderView !== "main");
  statsView.classList.toggle("hidden", state.folderView !== "stats");
}

function getReminderOccurrenceDateParts(reminder, yearOverride = null) {
  const parsed = parseDateKey(reminder?.targetDate || "");
  if (!parsed) return null;
  const overrideYear = Number(yearOverride);
  const year = Number.isFinite(overrideYear) && overrideYear > 0
    ? Math.round(overrideYear)
    : parsed.year;
  return {
    year,
    monthIndex: parsed.monthIndex,
    day: clampDayForMonth(year, parsed.monthIndex, parsed.day),
  };
}

function getReminderOccurrenceDateKey(reminder, yearOverride = null) {
  const parts = getReminderOccurrenceDateParts(reminder, yearOverride);
  if (!parts) return "";
  return getDateKeyFromParts(parts.year, parts.monthIndex, parts.day);
}

function getReminderOccurrenceTimestamp(reminder, { yearOverride = null } = {}) {
  const safeDate = getReminderOccurrenceDateKey(reminder, yearOverride);
  if (!safeDate) return 0;
  const safeTime = String(reminder?.targetTime || "").trim() || "23:59";
  const date = new Date(`${safeDate}T${safeTime}:00`);
  return Number.isFinite(date.getTime()) ? date.getTime() : 0;
}

function getReminderTargetTimestamp(reminder, { annualizeBirthdays = false } = {}) {
  if (!(annualizeBirthdays && reminder?.repeat === "yearly")) {
    return getReminderOccurrenceTimestamp(reminder);
  }
  const now = new Date();
  const currentYear = now.getFullYear();
  let targetAt = getReminderOccurrenceTimestamp(reminder, { yearOverride: currentYear });
  if (!targetAt) return 0;
  if (targetAt < now.getTime()) {
    targetAt = getReminderOccurrenceTimestamp(reminder, { yearOverride: currentYear + 1 });
  }
  return targetAt;
}

function buildReminderCountdown(reminder) {
  const targetAt = getReminderTargetTimestamp(reminder, { annualizeBirthdays: true });
  if (!targetAt) return "Sin fecha";
  const diffMs = targetAt - Date.now();
  const absMs = Math.abs(diffMs);
  const minutes = Math.floor(absMs / (60 * 1000));
  const hours = Math.floor(absMs / (60 * 60 * 1000));
  const days = Math.floor(absMs / (24 * 60 * 60 * 1000));
  if (Math.abs(diffMs) < 60 * 1000) return "Es hoy";
  if (diffMs > 0) {
    if (days >= 1) return `Faltan ${days} día${days === 1 ? "" : "s"}`;
    if (hours >= 1) return `Faltan ${hours} hora${hours === 1 ? "" : "s"}`;
    return `Faltan ${Math.max(1, minutes)} minuto${minutes === 1 ? "" : "s"}`;
  }
  if (days >= 1) return `Venció hace ${days} día${days === 1 ? "" : "s"}`;
  if (hours >= 1) return `Venció hace ${hours} hora${hours === 1 ? "" : "s"}`;
  return `Venció hace ${Math.max(1, minutes)} minuto${minutes === 1 ? "" : "s"}`;
}

function getReminderComputedStatus(reminder) {
  if (reminder?.status === "completado") return "completado";
  const targetAt = getReminderTargetTimestamp(reminder, { annualizeBirthdays: true });
  if (!targetAt) return "pendiente";
  return targetAt < Date.now() ? "vencido" : "pendiente";
}

function sortReminderChecklistItems(items = []) {
  return [...(Array.isArray(items) ? items : [])].sort((a, b) => {
    const doneDiff = Number(Boolean(a?.done)) - Number(Boolean(b?.done));
    if (doneDiff !== 0) return doneDiff;
    return Number(a?.order || 0) - Number(b?.order || 0);
  });
}

function getReminderChecklistSummary(reminder) {
  const items = sortReminderChecklistItems(Object.values(reminder?.checklistItems || {}));
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { items, total, done };
}

function cloneReminderForLocalState(reminder = {}) {
  return {
    ...reminder,
    checklistItems: Object.entries(reminder?.checklistItems || {}).reduce((acc, [itemId, item]) => {
      const safeItemId = String(itemId || item?.id || "").trim();
      if (!safeItemId) return acc;
      acc[safeItemId] = { ...item, id: safeItemId };
      return acc;
    }, {}),
  };
}

function replaceReminderInState(reminderId = "", nextReminder = null) {
  const safeReminderId = String(reminderId || "").trim();
  if (!safeReminderId || !nextReminder) return null;
  let updatedReminder = null;
  state.reminders = (state.reminders || []).map((row) => {
    if (row.id !== safeReminderId) return row;
    updatedReminder = nextReminder;
    return nextReminder;
  });
  return updatedReminder;
}

function applyReminderChecklistToggle(reminderId = "", itemId = "", done = false) {
  const safeReminderId = String(reminderId || "").trim();
  const safeItemId = String(itemId || "").trim();
  if (!safeReminderId || !safeItemId) return null;
  const currentReminder = (state.reminders || []).find((row) => row.id === safeReminderId);
  const currentItem = currentReminder?.checklistItems?.[safeItemId];
  if (!currentReminder || !currentItem) return null;
  const nextChecklistItems = {
    ...(currentReminder.checklistItems || {}),
    [safeItemId]: {
      ...currentItem,
      done,
      completedAt: done ? Date.now() : 0,
    },
  };
  const checklistRows = Object.values(nextChecklistItems);
  const allDone = checklistRows.length > 0 && checklistRows.every((row) => Boolean(row?.done));
  const nextReminder = {
    ...currentReminder,
    checklistItems: nextChecklistItems,
    status: allDone ? "completado" : "pendiente",
    completedAt: allDone ? Date.now() : 0,
    updatedAt: Date.now(),
  };
  replaceReminderInState(safeReminderId, nextReminder);
  return nextReminder;
}

function appendReminderChecklistItemLocal(reminderId = "", item = {}) {
  const safeReminderId = String(reminderId || "").trim();
  const safeItemId = String(item?.id || "").trim();
  if (!safeReminderId || !safeItemId) return null;
  const currentReminder = (state.reminders || []).find((row) => row.id === safeReminderId);
  if (!currentReminder) return null;
  const nextReminder = {
    ...currentReminder,
    checklistItems: {
      ...(currentReminder.checklistItems || {}),
      [safeItemId]: {
        id: safeItemId,
        text: String(item?.text || "").trim(),
        done: Boolean(item?.done),
        createdAt: Number(item?.createdAt || Date.now()),
        completedAt: Number(item?.completedAt || 0),
        order: Number(item?.order || Date.now()),
      },
    },
    status: "pendiente",
    completedAt: 0,
    updatedAt: Date.now(),
  };
  replaceReminderInState(safeReminderId, nextReminder);
  return nextReminder;
}

function removeReminderChecklistItemLocal(reminderId = "", itemId = "") {
  const safeReminderId = String(reminderId || "").trim();
  const safeItemId = String(itemId || "").trim();
  if (!safeReminderId || !safeItemId) return null;
  const currentReminder = (state.reminders || []).find((row) => row.id === safeReminderId);
  if (!currentReminder?.checklistItems?.[safeItemId]) return null;
  const nextChecklistItems = { ...(currentReminder.checklistItems || {}) };
  delete nextChecklistItems[safeItemId];
  const rows = Object.values(nextChecklistItems);
  const allDone = rows.length > 0 && rows.every((row) => Boolean(row?.done));
  const nextReminder = {
    ...currentReminder,
    checklistItems: nextChecklistItems,
    status: allDone ? "completado" : "pendiente",
    completedAt: allDone ? Date.now() : 0,
    updatedAt: Date.now(),
  };
  replaceReminderInState(safeReminderId, nextReminder);
  return nextReminder;
}

function paintReminderChecklistToggle(toggleTarget, done = false) {
  const item = toggleTarget?.closest?.(".notes-reminder-check-item");
  if (!item) return;
  item.classList.toggle("is-done", Boolean(done));
  const input = item.querySelector("input[type='checkbox']");
  if (input) input.checked = Boolean(done);
}

function queueReminderChecklistTogglePersist(reminderId = "", itemId = "", nextReminder = null, previousReminder = null, version = 0) {
  const safeReminderId = String(reminderId || "").trim();
  const safeItemId = String(itemId || "").trim();
  if (!safeReminderId || !safeItemId || !nextReminder) return Promise.resolve();
  const key = `${safeReminderId}:${safeItemId}`;
  const runPersist = async () => {
    const nextItem = nextReminder?.checklistItems?.[safeItemId];
    if (!nextItem) return;
    try {
      await patchReminderChecklistItem(state.rootPath, safeReminderId, safeItemId, nextItem);
      await updateReminder(state.rootPath, safeReminderId, nextReminder);
    } catch (error) {
      if (reminderChecklistToggleVersion.get(key) === version && previousReminder) {
        replaceReminderInState(safeReminderId, previousReminder);
        renderRemindersPanel();
        enqueueReminderToast({ message: "No se pudo guardar el cambio del checklist." });
      }
      throw error;
    }
  };
  const previousQueue = reminderChecklistToggleQueue.get(key) || Promise.resolve();
  const nextQueue = previousQueue
    .catch(() => {})
    .then(runPersist);
  reminderChecklistToggleQueue.set(key, nextQueue);
  nextQueue.finally(() => {
    if (reminderChecklistToggleQueue.get(key) === nextQueue) reminderChecklistToggleQueue.delete(key);
  });
  return nextQueue;
}

function buildReminderAccentStyle(reminder) {
  const color = normalizeReminderColor(reminder?.color);
  return `--notes-reminder-accent:${color};--notes-reminder-accent-soft:${tint(color, 0.18)};--notes-reminder-accent-strong:${tint(color, 0.32)};`;
}

function buildReminderCalendarCells(monthKey = "") {
  const parsedMonth = parseMonthKey(monthKey) || parseMonthKey(getCurrentMonthKey());
  const firstOfMonth = new Date(parsedMonth.year, parsedMonth.monthIndex, 1);
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const startDate = new Date(parsedMonth.year, parsedMonth.monthIndex, 1 - startOffset);

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(startDate);
    date.setDate(startDate.getDate() + index);
    const dateKey = getDateKeyFromDate(date);
    return {
      date,
      dateKey,
      monthKey: getMonthKeyFromDate(date),
      dayNumber: date.getDate(),
      isCurrentMonth: date.getMonth() === parsedMonth.monthIndex,
      isToday: isTodayDateKey(dateKey),
    };
  });
}

function buildReminderCalendarMap(reminders = [], cells = []) {
  const map = new Map();
  const dateKeys = cells.map((cell) => cell.dateKey).filter(Boolean);
  const dateKeySet = new Set(dateKeys);
  const visibleYears = Array.from(new Set(cells.map((cell) => cell.date.getFullYear())));

  dateKeys.forEach((dateKey) => map.set(dateKey, []));

  reminders.forEach((reminder) => {
    const years = reminder?.repeat === "yearly"
      ? visibleYears
      : [parseDateKey(reminder?.targetDate || "")?.year].filter(Boolean);

    years.forEach((year) => {
      const occurrenceKey = getReminderOccurrenceDateKey(reminder, reminder?.repeat === "yearly" ? year : null);
      if (!occurrenceKey || !dateKeySet.has(occurrenceKey)) return;
      map.set(occurrenceKey, [...(map.get(occurrenceKey) || []), reminder]);
    });
  });

  for (const [dateKey, items] of map.entries()) {
    const targetYear = parseDateKey(dateKey)?.year || null;
    items.sort((a, b) => (
      getReminderOccurrenceTimestamp(a, { yearOverride: a?.repeat === "yearly" ? targetYear : null })
      - getReminderOccurrenceTimestamp(b, { yearOverride: b?.repeat === "yearly" ? targetYear : null })
    ));
  }

  return map;
}

function findFirstReminderDateKeyInMonth(reminders = [], monthKey = "") {
  const parsedMonth = parseMonthKey(monthKey);
  if (!parsedMonth) return "";
  const candidates = reminders
    .map((reminder) => getReminderOccurrenceDateKey(reminder, reminder?.repeat === "yearly" ? parsedMonth.year : null))
    .filter((dateKey) => dateKey && getMonthKeyFromDateKey(dateKey) === monthKey)
    .sort();
  return candidates[0] || "";
}

function ensureReminderCalendarSelection(reminders = []) {
  const safeMonthKey = parseMonthKey(state.reminderCalendarMonthKey)
    ? state.reminderCalendarMonthKey
    : getCurrentMonthKey();
  state.reminderCalendarMonthKey = safeMonthKey;

  const currentSelected = parseDateKey(state.reminderCalendarSelectedDate || "");
  if (currentSelected && getMonthKeyFromDateKey(state.reminderCalendarSelectedDate) === safeMonthKey) {
    return;
  }

  const todayKey = getTodayDateKey();
  if (getMonthKeyFromDateKey(todayKey) === safeMonthKey) {
    state.reminderCalendarSelectedDate = todayKey;
    return;
  }

  const firstReminderDate = findFirstReminderDateKeyInMonth(reminders, safeMonthKey);
  if (firstReminderDate) {
    state.reminderCalendarSelectedDate = firstReminderDate;
    return;
  }

  const parsedMonth = parseMonthKey(safeMonthKey);
  state.reminderCalendarSelectedDate = getDateKeyFromParts(parsedMonth.year, parsedMonth.monthIndex, 1);
}

function setReminderCalendarSelectedDate(dateKey = "", {
  syncMonth = true,
  focusedReminderId = "",
} = {}) {
  const safeDateKey = parseDateKey(dateKey) ? String(dateKey) : getTodayDateKey();
  state.reminderCalendarSelectedDate = safeDateKey;
  if (syncMonth) {
    state.reminderCalendarMonthKey = getMonthKeyFromDateKey(safeDateKey);
  }
  state.reminderCalendarFocusedReminderId = String(focusedReminderId || "").trim();
}

function clearReminderActiveFilter({
  preserveSelection = true,
} = {}) {
  state.reminderActiveFilterMode = "allPending";
  state.reminderActiveFilterDate = "";
  if (!preserveSelection) {
    state.reminderCalendarFocusedReminderId = "";
  }
}

function setReminderActiveDayFilter(dateKey = "", {
  focusedReminderId = "",
} = {}) {
  const safeDateKey = parseDateKey(dateKey) ? String(dateKey) : getTodayDateKey();
  setReminderCalendarSelectedDate(safeDateKey, {
    syncMonth: true,
    focusedReminderId,
  });
  state.reminderActiveFilterMode = "day";
  state.reminderActiveFilterDate = safeDateKey;
}

function getActiveReminderFilterDateKey() {
  if (normalizeReminderActiveFilterMode(state.reminderActiveFilterMode) !== "day") return "";
  return parseDateKey(state.reminderActiveFilterDate || "") ? state.reminderActiveFilterDate : "";
}

function shiftReminderCalendarMonth(delta = 0, reminders = []) {
  const nextMonthKey = addMonthsToMonthKey(state.reminderCalendarMonthKey, delta);
  const selected = parseDateKey(state.reminderCalendarSelectedDate || "");
  const nextMonth = parseMonthKey(nextMonthKey);
  const nextDay = clampDayForMonth(nextMonth.year, nextMonth.monthIndex, selected?.day || 1);
  state.reminderCalendarMonthKey = nextMonthKey;
  state.reminderCalendarSelectedDate = getDateKeyFromParts(nextMonth.year, nextMonth.monthIndex, nextDay);
  state.reminderCalendarFocusedReminderId = "";
  ensureReminderCalendarSelection(reminders);
}

function getReminderScrollState() {
  const scrollingElement = document.scrollingElement || document.documentElement;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const activeReminderInput = active?.matches?.("[data-checklist-input]") ? active : active?.closest?.("[data-checklist-input]");
  return {
    scrollTop: Number(scrollingElement?.scrollTop || 0),
    checklistInputReminderId: String(activeReminderInput?.dataset?.checklistInput || "").trim(),
  };
}

function restoreReminderScrollState(snapshot = null) {
  if (!snapshot) return;
  window.requestAnimationFrame(() => {
    const scrollingElement = document.scrollingElement || document.documentElement;
    if (scrollingElement) scrollingElement.scrollTop = Number(snapshot.scrollTop || 0);
    if (snapshot.checklistInputReminderId) {
      const input = document.querySelector(`[data-checklist-input='${CSS.escape(snapshot.checklistInputReminderId)}']`);
      input?.focus?.({ preventScroll: true });
    }
  });
}

function queueReminderRemoteRestore(snapshot = null) {
  pendingReminderRemoteRestore = snapshot || null;
}

function flushReminderRemoteRestore() {
  if (!pendingReminderRemoteRestore) return;
  const snapshot = pendingReminderRemoteRestore;
  pendingReminderRemoteRestore = null;
  restoreReminderScrollState(snapshot);
}

function getRemindersForSelectedCalendarDate(reminders = [], dateKey = state.reminderCalendarSelectedDate) {
  const safeDateKey = parseDateKey(dateKey || "") ? String(dateKey) : "";
  if (!safeDateKey) return Array.isArray(reminders) ? reminders : [];
  const selectedYear = parseDateKey(safeDateKey)?.year || new Date().getFullYear();
  return (Array.isArray(reminders) ? reminders : []).filter((reminder) => (
    getReminderOccurrenceDateKey(reminder, reminder?.repeat === "yearly" ? selectedYear : null) === safeDateKey
  ));
}

function selectReminderCalendarDate(dateKey = "", {
  openCreateOnRepeatClick = false,
  focusedReminderId = "",
} = {}) {
  const safeDateKey = parseDateKey(dateKey) ? String(dateKey) : getTodayDateKey();
  const wasSelected = safeDateKey === state.reminderCalendarSelectedDate;
  const isActiveDayFilter = safeDateKey === getActiveReminderFilterDateKey();
  if (wasSelected && isActiveDayFilter && openCreateOnRepeatClick && !focusedReminderId) {
    openReminderModal(null, { presetDate: safeDateKey });
    return false;
  }
  setReminderActiveDayFilter(safeDateKey, { focusedReminderId });
  return true;
}

function handleReminderCalendarDaySelection(dateKey = "", {
  target = null,
  dayEl = null,
  focusedReminderId = "",
  openCreateOnRepeatClick = false,
} = {}) {
  const safeDateKey = parseDateKey(dateKey) ? String(dateKey) : "";
  if (!safeDateKey) return false;
  if (dayEl?.dataset?.calendarDisabled === "true" || dayEl?.getAttribute?.("aria-disabled") === "true") {
    return false;
  }
  const previousSelectedDay = state.reminderCalendarSelectedDate;
  const previousFilterMode = normalizeReminderActiveFilterMode(state.reminderActiveFilterMode);
  const changed = selectReminderCalendarDate(safeDateKey, {
    openCreateOnRepeatClick,
    focusedReminderId,
  });
  logReminderCalendarDebug("[reminders:calendar:click]", {
    target,
    dayEl,
    date: safeDateKey,
    previousSelectedDay,
    nextSelectedDay: changed ? safeDateKey : previousSelectedDay,
    filterMode: changed ? normalizeReminderActiveFilterMode(state.reminderActiveFilterMode) : previousFilterMode,
  });
  return changed;
}

function getReminderListState(reminders = []) {
  const safeReminders = Array.isArray(reminders) ? reminders : [];
  const dayFilterDateKey = getActiveReminderFilterDateKey();
  const hasExplicitDayFilter = Boolean(dayFilterDateKey);
  const scopedReminders = hasExplicitDayFilter
    ? getRemindersForSelectedCalendarDate(safeReminders, dayFilterDateKey)
    : safeReminders;
  return {
    hasExplicitDayFilter,
    dayFilterDateKey,
    scopedReminders,
    active: scopedReminders.filter((item) => getReminderComputedStatus(item) === "pendiente"),
    history: scopedReminders.filter((item) => getReminderComputedStatus(item) !== "pendiente"),
  };
}

function shouldResetReminderFilterToAllPending(nextReminders = []) {
  const dayFilterDateKey = getActiveReminderFilterDateKey();
  if (!dayFilterDateKey) return false;
  return !getRemindersForSelectedCalendarDate(nextReminders, dayFilterDateKey)
    .some((item) => getReminderComputedStatus(item) === "pendiente");
}

function getFilteredReminders() {
  const all = Array.isArray(state.reminders) ? state.reminders : [];
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const endToday = startToday.getTime() + (24 * 60 * 60 * 1000);
  const day7 = startToday.getTime() + (7 * 24 * 60 * 60 * 1000);
  const day30 = startToday.getTime() + (30 * 24 * 60 * 60 * 1000);
  const visibleTypes = normalizeReminderMultiSelection(state.reminderFilters?.types, REMINDER_TYPES);
  const visibleCategories = normalizeReminderMultiSelection(state.reminderFilters?.categories);
  const visibleStatuses = normalizeReminderMultiSelection(state.reminderFilters?.statuses, REMINDER_STATUSES);
  const rangeFilter = normalizeReminderRange(state.reminderFilters?.range || "all");
  const filtered = all.filter((reminder) => {
    const computedStatus = getReminderComputedStatus(reminder);
    const targetAt = getReminderTargetTimestamp(reminder, { annualizeBirthdays: true });
    if (visibleTypes.length && !visibleTypes.includes(reminder?.type || "normal")) return false;
    if (visibleCategories.length && !visibleCategories.some((category) => (reminder?.categories || []).includes(category))) return false;
    if (visibleStatuses.length && !visibleStatuses.includes(computedStatus)) return false;
    if (rangeFilter === "today" && !(targetAt >= startToday.getTime() && targetAt < endToday)) return false;
    if (rangeFilter === "7d" && !(targetAt >= startToday.getTime() && targetAt <= day7)) return false;
    if (rangeFilter === "30d" && !(targetAt >= startToday.getTime() && targetAt <= day30)) return false;
    if (rangeFilter === "overdue" && computedStatus !== "vencido") return false;
    return true;
  });
  return filtered.sort((a, b) => getReminderTargetTimestamp(a, { annualizeBirthdays: true }) - getReminderTargetTimestamp(b, { annualizeBirthdays: true }));
}

function renderReminderCardsToMarkup(reminders = []) {
  return reminders.map((reminder) => {
    const computedStatus = getReminderComputedStatus(reminder);
    const dateLabel = formatReminderDateTime(reminder);
    const countdown = buildReminderCountdown(reminder);
    const isBirthday = reminder?.type === "cumpleaños";
    const birthdayLead = isBirthday
      ? `🎂 ${countdown === "Es hoy" ? `Hoy es el cumpleaños de ${reminder.title || "alguien"}` : `${countdown.replace("Faltan", "Quedan")} para el cumpleaños de ${reminder.title || "alguien"}`}`
      : countdown;
    const categories = Array.isArray(reminder?.categories) ? reminder.categories : [];
    const checklist = getReminderChecklistSummary(reminder);
    const isChecklist = reminder?.type === "checklist";
    const isExpanded = reminderExpandedChecklist.has(reminder.id);
    const visibleItems = isChecklist && isExpanded ? checklist.items : [];
    const progress = checklist.total ? Math.round((checklist.done / checklist.total) * 100) : 0;
    const accentStyle = buildReminderAccentStyle(reminder);
    const detectedLinks = collectReminderExternalLinks(reminder);
    return `
      <article class="notes-reminder-item is-${escapeHtml(computedStatus)}" data-reminder-id="${escapeHtml(reminder.id)}" style="${escapeHtml(accentStyle)}">
        <div class="notes-reminder-main">
          <button class="notes-reminder-title-row ${isChecklist ? "is-checklist-toggle" : ""}" ${isChecklist ? `data-act="toggle-checklist-expand" data-reminder-id="${escapeHtml(reminder.id)}"` : ""}>
            <span class="notes-reminder-emoji">${escapeHtml(reminder?.emoji || "⏰")}</span>
            <strong class="notes-reminder-title">${escapeHtml(reminder?.title || "Sin título")}</strong>
            ${isChecklist ? `<span class="notes-reminder-expand-hint">${isExpanded ? "▾" : "▸"}</span>` : ""}
          </button>

          <div class="notes-reminder-meta">${escapeHtml(dateLabel)} · ${escapeHtml(reminder?.type || "normal")} · ${escapeHtml(computedStatus)}</div>

<div class="meta-reminder">
          ${categories.length ? `<div class="notes-reminder-categories">${categories.map((category) => `<span class="notes-reminder-chip">${escapeHtml(category)}</span>`).join("")}</div>` : ""}


          <div class="notes-reminder-countdown">${escapeHtml(isBirthday ? birthdayLead : countdown)}</div>


          ${isChecklist ? `
            <div class="notes-reminder-checklist-progress">${checklist.done}/${checklist.total} completados</div>

</div>

            <div class="notes-reminder-progress"><span style="width:${progress}%;"></span></div>
            <div class="notes-reminder-checklist-items ${isExpanded ? "" : "hidden"}">

              <div class="notes-reminder-inline-add">
                <input type="text" id="notes-reminder-checklist-new"   placeholder="Nuevo checkpoint..." data-checklist-input="${escapeHtml(reminder.id)}" />
                <button class="notes-icon-action" type="button" data-act="add-checklist-item" data-reminder-id="${escapeHtml(reminder.id)}">+</button>
              </div>
                            ${visibleItems.map((item) => `
                <label class="notes-reminder-check-item ${item.done ? "is-done" : ""}" data-act="toggle-checklist-item" data-reminder-id="${escapeHtml(reminder.id)}" data-item-id="${escapeHtml(item.id)}">
                  <input type="checkbox" ${item.done ? "checked" : ""} />
                  <span>${escapeHtml(item.text)}</span>
                  <button class="notes-icon-action notes-checklist-delete-inline" type="button" data-act="delete-checklist-item" data-reminder-id="${escapeHtml(reminder.id)}" data-item-id="${escapeHtml(item.id)}">×</button>
                </label>
              `).join("")}
            </div>
          ` : ""}
        </div>

        <div class="notes-item-actions notes-reminder-actions">
          <button class="notes-icon-action" type="button" data-act="edit-reminder" data-reminder-id="${escapeHtml(reminder.id)}">✏️</button>
          <button class="notes-icon-action" type="button" data-act="complete-reminder" data-reminder-id="${escapeHtml(reminder.id)}">✅</button>
          <button class="notes-icon-action" type="button" data-act="delete-reminder" data-reminder-id="${escapeHtml(reminder.id)}">🗑️</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderReminderCards(list, reminders = []) {
  if (!list) return;
  list.innerHTML = renderReminderCardsToMarkup(reminders);
}

function buildReminderDayTimeLabel(reminder, dateKey = "") {
  const safeTime = String(reminder?.targetTime || "").trim();
  if (!safeTime) return "Todo el dia";
  const parsed = new Date(`${dateKey || reminder?.targetDate || ""}T${safeTime}:00`);
  if (!Number.isFinite(parsed.getTime())) return safeTime;
  return TIME_FORMATTER.format(parsed);
}

function buildReminderCalendarPanelMarkup(dateKey = "", reminders = []) {
  const date = getDateFromDateKey(dateKey);
  const dateLabel = date ? formatLongDate(date.getTime()) : "Sin fecha";
  const safeReminders = Array.isArray(reminders) ? reminders : [];
  return `
    <section class="notes-reminders-calendar-panel__section">
      <div class="notes-reminders-calendar-panel__head">
        <strong>${escapeHtml(dateLabel)}</strong>
        <span>${escapeHtml(pluralize(safeReminders.length, "recordatorio", "recordatorios"))}</span>
      </div>
      ${safeReminders.length ? `
        <div class="notes-reminders-calendar-panel__list">
          ${safeReminders.map((reminder) => {
            const computedStatus = getReminderComputedStatus(reminder);
            const accentStyle = buildReminderAccentStyle(reminder);
            const categories = Array.isArray(reminder?.categories) ? reminder.categories : [];
            const timeLabel = buildReminderDayTimeLabel(reminder, dateKey);
            return `
              <article class="notes-reminders-calendar-panel__item ${reminder?.status === 'completado' ? 'reminder--done' : ''} is-${escapeHtml(computedStatus)}" data-reminder-id="${escapeHtml(reminder.id)}" style="${escapeHtml(accentStyle)}">
                <button
                  class="notes-reminders-calendar-panel__itemMain"
                  type="button"
                  data-act="edit-reminder"
                  data-reminder-id="${escapeHtml(reminder.id)}"
                  data-calendar-reminder-item="true"
                >
                  <span class="notes-reminders-calendar-panel__itemEmoji">${escapeHtml(reminder?.emoji || "â°")}</span>
                  <span class="notes-reminders-calendar-panel__itemCopy">
                    <strong>${escapeHtml(reminder?.title || "Sin tÃ­tulo")}</strong>
                    <span>${escapeHtml(`${timeLabel} · ${computedStatus}`)}</span>
                  </span>
                </button>
                <div class="notes-reminders-calendar-panel__itemActions">
                  <button class="notes-icon-action" type="button" data-act="complete-reminder" data-reminder-id="${escapeHtml(reminder.id)}">✅</button>
                  <button class="notes-icon-action" type="button" data-act="delete-reminder" data-reminder-id="${escapeHtml(reminder.id)}">🗑️</button>
                </div>
                ${categories.length ? `
                  <div class="notes-reminders-calendar-panel__itemTags">
                    ${categories.map((category) => `<span class="notes-reminder-chip">${escapeHtml(category)}</span>`).join("")}
                  </div>
                ` : ""}
              </article>
            `;
          }).join("")}
        </div>
      ` : `
        <div class="notes-reminder-alert-empty">No hay recordatorios para este dia.</div>
      `}
    </section>
  `;
}

function renderReminderCalendarView(reminders = []) {
  const title = $id("notes-reminders-calendar-title");
  const grid = $id("notes-reminders-calendar-grid");
  const panel = $id("notes-reminders-calendar-panel");
  if (!title || !grid || !panel) return;

  logReminderCalendarDebug("[reminders:calendar:render:start]", {
    monthKey: state.reminderCalendarMonthKey,
    selectedDay: state.reminderCalendarSelectedDate,
    filterMode: normalizeReminderActiveFilterMode(state.reminderActiveFilterMode),
    total: Array.isArray(reminders) ? reminders.length : 0,
  });
  ensureReminderCalendarSelection(reminders);
  const cells = buildReminderCalendarCells(state.reminderCalendarMonthKey);
  const remindersByDate = buildReminderCalendarMap(reminders, cells);
  const selectedDateKey = parseDateKey(state.reminderCalendarSelectedDate)
    ? state.reminderCalendarSelectedDate
    : cells[0]?.dateKey || getTodayDateKey();
  const selectedItems = remindersByDate.get(selectedDateKey) || [];

  title.textContent = formatReminderCalendarTitle(state.reminderCalendarMonthKey);
  grid.innerHTML = `
    ${REMINDER_WEEKDAY_LABELS.map((label) => `<div class="notes-reminders-calendar__weekday">${escapeHtml(label)}</div>`).join("")}
    ${cells.map((cell) => {
      const dayItems = remindersByDate.get(cell.dateKey) || [];
      const visibleDots = dayItems.slice(0, REMINDER_CALENDAR_MAX_DOTS);
      const extraCount = Math.max(0, dayItems.length - REMINDER_CALENDAR_MAX_DOTS);
      const classes = [
        "notes-reminders-calendar__day",
        cell.isCurrentMonth ? "" : "is-outside-month",
        cell.isToday ? "is-today" : "",
        cell.dateKey === selectedDateKey ? "is-selected" : "",
        dayItems.length ? "has-reminders" : "",
      ].filter(Boolean).join(" ");

      return `
        <div class="${classes}" data-date-key="${escapeHtml(cell.dateKey)}" data-calendar-day="true">
          <button class="notes-reminders-calendar__dayButton" type="button" data-act="select-reminder-calendar-day" data-date-key="${escapeHtml(cell.dateKey)}" aria-pressed="${cell.dateKey === selectedDateKey ? "true" : "false"}">
            <span class="notes-reminders-calendar__dayNumber">${escapeHtml(String(cell.dayNumber))}</span>
          </button>
          <div class="notes-reminders-calendar__dots">
            ${visibleDots.map((reminder) => `
              <button
                class="notes-reminders-calendar__dot ${reminder?.status === 'completado' ? 'reminder-dot--done' : ''}"
                type="button"
                title="${escapeHtml(reminder?.title || "Recordatorio")}"
                aria-label="${escapeHtml(reminder?.title || "Recordatorio")}"
                data-act="focus-reminder-calendar-item"
                data-date-key="${escapeHtml(cell.dateKey)}"
                data-reminder-id="${escapeHtml(reminder.id)}"
                style="background:${escapeHtml(normalizeReminderColor(reminder?.color))};"
              ></button>
            `).join("")}
            ${extraCount ? `
              <button class="notes-reminders-calendar__more" type="button" data-act="select-reminder-calendar-day" data-date-key="${escapeHtml(cell.dateKey)}">+${extraCount}</button>
            ` : ""}
          </div>
        </div>
      `;
    }).join("")}
  `;

  panel.innerHTML = buildReminderCalendarPanelMarkup(selectedDateKey, selectedItems);
  enhanceRenderedReminderContent(panel, selectedItems);
  logReminderCalendarDebug("[reminders:calendar:render:done]", {
    monthKey: state.reminderCalendarMonthKey,
    selectedDay: selectedDateKey,
    filterMode: normalizeReminderActiveFilterMode(state.reminderActiveFilterMode),
    visibleOnSelectedDay: selectedItems.length,
  });

  const focusReminderId = String(state.reminderCalendarFocusedReminderId || "").trim();
  if (focusReminderId) {
    window.requestAnimationFrame(() => {
      const target = panel.querySelector(`[data-calendar-reminder-item][data-reminder-id="${focusReminderId}"]`);
      if (target instanceof HTMLElement) {
        target.focus({ preventScroll: false });
        target.scrollIntoView({ block: "nearest", behavior: "smooth" });
      } else {
        const reminder = state.reminders.find((row) => row.id === focusReminderId);
        if (reminder) openReminderModal(reminder);
      }
      state.reminderCalendarFocusedReminderId = "";
    });
  }
}

function enhanceRenderedReminderContent(root, reminders = []) {
  if (!(root instanceof HTMLElement)) return;
  const reminderMap = new Map((Array.isArray(reminders) ? reminders : []).map((reminder) => [String(reminder?.id || "").trim(), reminder]));
  root.querySelectorAll(".notes-reminder-item[data-reminder-id], .notes-reminders-calendar-panel__item[data-reminder-id]").forEach((node) => {
    const reminderId = String(node.dataset.reminderId || "").trim();
    const reminder = reminderMap.get(reminderId);
    if (!reminder) return;

    const titleRow = node.querySelector(".notes-reminder-title-row");
    if (titleRow instanceof HTMLElement) {
      const safeRow = document.createElement("div");
      safeRow.className = titleRow.className;
      safeRow.innerHTML = `
        <span class="notes-reminder-emoji">${escapeHtml(reminder?.emoji || "Ã¢ÂÂ°")}</span>
        <strong class="notes-reminder-title">${buildSafeLinkedTextMarkup(reminder?.title || "Sin titulo", { className: "notes-inline-link notes-inline-link--external" })}</strong>
        ${reminder?.type === "checklist"
          ? `<button class="notes-reminder-expand-hint" type="button" data-act="toggle-checklist-expand" data-reminder-id="${escapeHtml(reminder.id)}" aria-expanded="${reminderExpandedChecklist.has(reminder.id) ? "true" : "false"}">${reminderExpandedChecklist.has(reminder.id) ? "⬆️" : "⬇️"}</button>`
          : ""}`;
      titleRow.replaceWith(safeRow);
    }

    const panelMain = node.querySelector(".notes-reminders-calendar-panel__itemMain");
    if (panelMain instanceof HTMLElement) {
      const safeMain = document.createElement("div");
      safeMain.className = panelMain.className;
      safeMain.dataset.act = "edit-reminder";
      safeMain.dataset.reminderId = reminder.id;
      safeMain.dataset.calendarReminderItem = "true";
      safeMain.tabIndex = 0;
      safeMain.role = "button";
      safeMain.innerHTML = `
        <span class="notes-reminders-calendar-panel__itemEmoji">${escapeHtml(reminder?.emoji || "Ã¢ÂÂ°")}</span>
        <span class="notes-reminders-calendar-panel__itemCopy">
          <strong>${buildSafeLinkedTextMarkup(reminder?.title || "Sin titulo", { className: "notes-inline-link notes-inline-link--external" })}</strong>
          <span>${escapeHtml(`${buildReminderDayTimeLabel(reminder, state.reminderCalendarSelectedDate)} Ã‚Â· ${getReminderComputedStatus(reminder)}`)}</span>
        </span>
      `;
      panelMain.replaceWith(safeMain);
    }

    node.querySelector(".notes-reminder-description")?.remove();
    node.querySelector(".notes-links-preview")?.remove();

    const descriptionMarkup = reminder?.description
      ? `<div class="notes-reminder-description">${buildSafeLinkedTextMarkup(reminder.description, { className: "notes-inline-link notes-inline-link--external" })}</div>`
      : "";
    const linksMarkup = buildDetectedLinksListMarkup(collectReminderExternalLinks(reminder));
    const host = node.querySelector(".notes-reminder-countdown, .notes-reminders-calendar-panel__itemTags, .notes-reminders-calendar-panel__itemActions");
    if (!host || (!descriptionMarkup && !linksMarkup)) return;

    const temp = document.createElement("div");
    temp.innerHTML = `${descriptionMarkup}${linksMarkup}`;
    Array.from(temp.children).forEach((child) => {
      host.parentNode?.insertBefore(child, host);
    });
  });
}

function renderReminderViewSwitch() {
  $id("notes-reminders-list-view")?.classList.remove("hidden");
  $id("notes-reminders-calendar-view")?.classList.remove("hidden");
  const groupButton = $id("notes-reminders-group-btn");
  if (groupButton) {
    groupButton.disabled = false;
    groupButton.classList.remove("is-disabled");
  }
}

function buildGroupedReminders(reminders = []) {
  const groupBy = normalizeReminderGroupBy(state.reminderGroupBy);
  if (groupBy === "none") return [{ label: "", items: reminders }];
  const groups = new Map();
  reminders.forEach((reminder) => {
    let key = "Sin grupo";
    if (groupBy === "type") key = reminder?.type || "normal";
    if (groupBy === "status") key = getReminderComputedStatus(reminder);
    if (groupBy === "category") key = reminder?.categories?.[0] || "Sin categoría";
    if (groupBy === "date") key = reminder?.targetDate || "Sin fecha";
    groups.set(key, [...(groups.get(key) || []), reminder]);
  });
  return Array.from(groups.entries()).map(([label, items]) => ({ label, items }));
}

function buildReminderFilterCheckMarkup({ name, value, label, checked = false }) {
  return `
    <label class="notes-reminders-check-item">
      <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function buildReminderSingleChoiceMarkup({ name, value, label, checked = false }) {
  return `
    <label class="notes-reminders-check-item">
      <input type="radio" name="${escapeHtml(name)}" value="${escapeHtml(value)}" ${checked ? "checked" : ""} />
      <span>${escapeHtml(label)}</span>
    </label>
  `;
}

function renderReminderFilterControls() {
  const typesWrap = $id("notes-reminders-filter-types");
  const categoriesWrap = $id("notes-reminders-filter-categories");
  const statusesWrap = $id("notes-reminders-filter-statuses");
  const rangesWrap = $id("notes-reminders-filter-ranges");
  const groupWrap = $id("notes-reminders-group-options");
  const summaryWrap = $id("notes-reminders-active-filters");
  if (!typesWrap || !categoriesWrap || !statusesWrap || !rangesWrap || !groupWrap || !summaryWrap) return;

  const labelsByType = {
    normal: "normal",
    cumpleaños: "cumpleaños",
    tarea: "tarea",
    evento: "evento",
    trámite: "trámite",
    checklist: "checklist",
    personalizado: "personalizado",
  };
  const labelsByStatus = { pendiente: "pendiente", completado: "completado", vencido: "vencido" };
  const labelsByRange = {
    all: "todos",
    today: "hoy",
    "7d": "próximos 7 días",
    "30d": "próximos 30 días",
    overdue: "vencidos",
  };
  const labelsByGroup = {
    none: "sin agrupar",
    category: "por categoría",
    type: "por tipo",
    date: "por fecha",
    status: "por estado",
  };
  const selectedTypes = new Set(normalizeReminderMultiSelection(state.reminderFilters?.types, REMINDER_TYPES));
  const selectedStatuses = new Set(normalizeReminderMultiSelection(state.reminderFilters?.statuses, REMINDER_STATUSES));
  const selectedCategories = new Set(normalizeReminderMultiSelection(state.reminderFilters?.categories));
  const selectedRange = normalizeReminderRange(state.reminderFilters?.range || "all");
  const selectedGroup = normalizeReminderGroupBy(state.reminderGroupBy);

  typesWrap.innerHTML = REMINDER_TYPES.map((type) => buildReminderFilterCheckMarkup({
    name: "reminder-visible-types",
    value: type,
    label: labelsByType[type] || type,
    checked: selectedTypes.has(type),
  })).join("");
  statusesWrap.innerHTML = REMINDER_STATUSES.map((status) => buildReminderFilterCheckMarkup({
    name: "reminder-visible-statuses",
    value: status,
    label: labelsByStatus[status] || status,
    checked: selectedStatuses.has(status),
  })).join("");
  categoriesWrap.innerHTML = (state.reminderCategories || []).length
    ? (state.reminderCategories || []).map((category) => buildReminderFilterCheckMarkup({
      name: "reminder-visible-categories",
      value: category.name,
      label: category.name,
      checked: selectedCategories.has(category.name),
    })).join("")
    : '<div class="notes-reminder-alert-empty">Sin categorías creadas.</div>';
  rangesWrap.innerHTML = REMINDER_RANGES.map((range) => buildReminderSingleChoiceMarkup({
    name: "reminder-visible-range",
    value: range,
    label: labelsByRange[range] || range,
    checked: selectedRange === range,
  })).join("");
  groupWrap.innerHTML = REMINDER_GROUP_BY.map((group) => buildReminderSingleChoiceMarkup({
    name: "reminder-group-by",
    value: group,
    label: labelsByGroup[group] || group,
    checked: selectedGroup === group,
  })).join("");

  const chips = [];
  if (selectedTypes.size) chips.push(`${selectedTypes.size} tipo(s)`);
  if (selectedCategories.size) chips.push(`${selectedCategories.size} categoría(s)`);
  if (selectedStatuses.size) chips.push(`${selectedStatuses.size} estado(s)`);
  if (selectedRange !== "all") chips.push(labelsByRange[selectedRange]);
  if (selectedGroup !== "none") chips.push(labelsByGroup[selectedGroup]);
  summaryWrap.innerHTML = chips.map((chip) => `<span class="notes-reminder-chip">${escapeHtml(chip)}</span>`).join("");
}

async function persistReminderPreferences() {
  if (!state.rootPath) return;
  const preferences = {
    visibleTypes: normalizeReminderMultiSelection(state.reminderFilters?.types, REMINDER_TYPES),
    visibleCategories: normalizeReminderMultiSelection(state.reminderFilters?.categories),
    visibleStatuses: normalizeReminderMultiSelection(state.reminderFilters?.statuses, REMINDER_STATUSES),
    range: normalizeReminderRange(state.reminderFilters?.range || "all"),
    groupBy: normalizeReminderGroupBy(state.reminderGroupBy),
  };
  state.reminderPreferences = preferences;
  await updateReminderPreferences(state.rootPath, preferences);
}

function renderRemindersPanel() {
  const list = $id("notes-reminders-list");
  const historyList = $id("notes-reminders-history-list");
  const empty = $id("notes-empty-reminders");
  const toggle = $id("notes-reminders-toggle-history");
  if (!list || !historyList || !empty || !toggle) return;
  renderReminderFilterControls();
  renderReminderViewSwitch();
  const filtered = getFilteredReminders();
  ensureReminderCalendarSelection(filtered);
  renderReminderCalendarView(filtered);
  const reminderListState = getReminderListState(filtered);
  const active = reminderListState.active;
  const history = reminderListState.history;
  logReminderCalendarDebug("[reminders:list:filter]", {
    mode: normalizeReminderActiveFilterMode(state.reminderActiveFilterMode),
    selectedDay: getActiveReminderFilterDateKey() || state.reminderCalendarSelectedDate,
    total: filtered.length,
    visible: reminderListState.scopedReminders.length,
  });
  const activeGroups = buildGroupedReminders(active);
  const historyGroups = buildGroupedReminders(history);
  list.innerHTML = activeGroups.map((group) => `
    ${group.label ? `<div class="notes-section-label">${escapeHtml(group.label)}</div>` : ""}
    <div class="notes-reminder-list">${renderReminderCardsToMarkup(group.items)}</div>
  `).join("");
  historyList.innerHTML = historyGroups.map((group) => `
    ${group.label ? `<div class="notes-section-label">${escapeHtml(group.label)}</div>` : ""}
    <div class="notes-reminder-list">${renderReminderCardsToMarkup(group.items)}</div>
  `).join("");
  historyList.classList.toggle("hidden", state.reminderCollapsedHistory);
  toggle.textContent = state.reminderCollapsedHistory
    ? `Mostrar completados y vencidos (${history.length})`
    : `Ocultar completados y vencidos (${history.length})`;
  const hasVisibleItems = active.length > 0 || (!state.reminderCollapsedHistory && history.length > 0);
  empty.classList.toggle("hidden", hasVisibleItems);
  empty.textContent = reminderListState.hasExplicitDayFilter
    ? "No hay recordatorios para el dia seleccionado."
    : (filtered.length > 0 ? "No hay recordatorios pendientes ahora mismo." : "No hay recordatorios todavia.");
  enhanceRenderedReminderContent(list, active);
  enhanceRenderedReminderContent(historyList, history);
}

function renderRootSectionSwitch() {
  const isReminders = normalizeRootSection(state.rootSection) === "reminders";
  $id("notes-root-section-notes")?.classList.toggle("hidden", isReminders);
  $id("notes-root-section-reminders")?.classList.toggle("hidden", !isReminders);
  document.querySelectorAll("#notes-root-switch [data-root-section]").forEach((button) => {
    const active = String(button.dataset.rootSection || "") === (isReminders ? "reminders" : "notes");
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function renderShell() {
  const listScreen = $id("notes-folders-screen");
  const detailScreen = $id("notes-folder-screen");
  if (!listScreen || !detailScreen) return;

  const inFolder = Boolean(state.selectedFolderId) && normalizeRootSection(state.rootSection) === "notes";
  listScreen.classList.toggle("hidden", inFolder);
  detailScreen.classList.toggle("hidden", !inFolder);
  renderRootSectionSwitch();

  if (inFolder && normalizeRootSection(state.rootSection) === "notes") {
    updateFilterOptionsForNotes();
  } else {
    updateFilterOptions();
  }

  renderRootFolders();
  renderFolderDetail();
  if (activeNoteDetailId) renderNoteDetail();
  renderRemindersPanel();
}

function openFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  state.rootSection = "notes";
  activeNoteDetailId = "";
  activeNoteDetailSourceFolderId = "";
  closeModal("notes-note-detail-backdrop");

  if (!requireUnlockedFolder(folder)) {
    $id("notes-pin-folder-id").value = folder.id;
    $id("notes-pin-input").value = "";
    $id("notes-pin-error").textContent = "";
    openModal("notes-pin-modal-backdrop");
    return;
  }

  setCurrentFolder(folder.id);
  renderShell();
}

function goUpFolder() {
  activeNoteDetailId = "";
  activeNoteDetailSourceFolderId = "";
  closeModal("notes-note-detail-backdrop");
  const currentFolder = getCurrentFolder();
  if (!currentFolder) {
    setCurrentFolder("");
    renderShell();
    return;
  }
  setCurrentFolder(currentFolder.parentId || "");
  renderShell();
}

function closeFolderView() {
  activeNoteDetailId = "";
  activeNoteDetailSourceFolderId = "";
  closeModal("notes-note-detail-backdrop");
  setCurrentFolder("");
  renderShell();
}

function openNoteDetail(note = null) {
  if (!note?.id) return;
  activeNoteDetailId = note.id;
  activeNoteDetailSourceFolderId = state.selectedFolderId || note.folderId || "";
  renderNoteDetail();
  openModal("notes-note-detail-backdrop");
}

function openDuplicateNoteReference(noteId = "", options = {}) {
  const note = state.notes.find((row) => row.id === String(noteId || "").trim());
  if (!note) return;
  if (options.closeNoteModalFirst) closeNoteModal();
  if (options.closeNoteDetailFirst) closeNoteDetail();
  if (note.type === "note" && normalizeNoteKind(note?.noteKind) !== "code") openNoteDetail(note);
  else openNoteModal(note);
}

function closeNoteDetail() {
  activeNoteDetailId = "";
  activeNoteDetailSourceFolderId = "";
  noteDetailSaveInFlight = false;
  hideNoteDetailDuplicateWarning();
  closeModal("notes-note-detail-backdrop");
  renderShell();
}

function populateFolderCategorySelector() {
  const categories = new Set();
  state.folders.forEach((folder) => {
    if (folder.category) categories.add(folder.category);
  });

  const select = $id("notes-folder-category-select");
  if (!select) return;

  select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
  Array.from(categories).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
}

function populateFolderTagsSelector() {
  const tags = new Set();
  state.folders.forEach((folder) => {
    if (folder.tags) folder.tags.forEach((tag) => tags.add(tag));
  });

  const select = $id("notes-folder-tags-select");
  if (!select) return;

  select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
  collectTagLabels(Array.from(tags), listTagDefinitions().map((tagDefinition) => tagDefinition.label)).forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    select.appendChild(option);
  });
}

function populateFolderParentSelector(selectedParentId = "", { excludeId = "" } = {}) {
  const select = $id("notes-folder-parent-select");
  if (!select) return;

  const options = buildFolderOptions(state.folders, {
    excludeId,
    excludeDescendantsOf: excludeId,
  });

  select.innerHTML = '<option value="">Raíz</option>';
  options.forEach(({ id, label, folder }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = folder?.isPrivate ? `🔒 ${label}` : label;
    select.appendChild(option);
  });

  select.value = String(selectedParentId || "").trim();
}

function openFolderModal(folder = null, options = {}) {
  const selectedParentId = String(folder?.parentId || options.parentId || "").trim();

  populateFolderCategorySelector();
  populateFolderTagsSelector();
  populateFolderParentSelector(selectedParentId, { excludeId: folder?.id || "" });

  $id("notes-folder-id").value = folder?.id || "";
  $id("notes-folder-name-input").value = folder?.name || "";
  $id("notes-folder-emoji").value = folder?.emoji || "📁";
  $id("notes-folder-parent-select").value = selectedParentId;
  $id("notes-folder-category").value = folder?.category || "";
  $id("notes-folder-category-select").value = folder?.category || "";
  $id("notes-folder-tags").value = (folder?.tags || []).join(", ");
  $id("notes-folder-tags-select").value = "";
  $id("notes-folder-color").value = folder?.color || "#00d4ff";
  $id("notes-folder-private").checked = Boolean(folder?.isPrivate);
  $id("notes-folder-pin").value = folder?.pin || "";
  $id("notes-folder-pin-wrap")?.classList.toggle("hidden", !folder?.isPrivate);
  $id("notes-folder-form-error").textContent = "";
  $id("notes-folder-modal-title").textContent = folder
    ? "Editar carpeta"
    : (selectedParentId ? "Nueva subcarpeta" : "Nueva carpeta");
  openModal("notes-folder-modal-backdrop");
}

function legacyUpdateFilterOptions() {
  const categories = new Set();
  const tags = new Set();

  state.folders.forEach((folder) => {
    if (folder.category) categories.add(folder.category);
    if (folder.tags) folder.tags.forEach((tag) => tags.add(tag));
  });

  const categorySelect = $id("notes-filter-category");
  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Categoría: Todas</option>';
    Array.from(categories).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = `Categoría: ${category}`;
      categorySelect.appendChild(option);
    });
    categorySelect.value = currentValue;
  }

  const tagsSelect = $id("notes-filter-tags");
  if (tagsSelect) {
    const currentValue = tagsSelect.value;
    tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    Array.from(tags).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `Tag: ${tag}`;
      tagsSelect.appendChild(option);
    });
    tagsSelect.value = currentValue;
  }

  const scopedNotes = (locationKey = "") => filterNotesByFolder(
    state.notes,
    folder.id,
    state.noteQuery,
    state.noteCategoryFilter,
    state.noteTagsFilter,
    {
      ...state.noteLocationFilters,
      [locationKey]: "",
    },
  );

  populateSimpleFilterSelect(countrySelect, "Pais: Todos", buildLocationFilterOptions(scopedNotes("country"), "country"));
  populateSimpleFilterSelect(regionSelect, "Region: Todas", buildLocationFilterOptions(scopedNotes("region"), "region"));
  populateSimpleFilterSelect(citySelect, "Ciudad: Todas", buildLocationFilterOptions(scopedNotes("city"), "city"));
  populateSimpleFilterSelect(addressSelect, "Direccion: Todas", buildLocationFilterOptions(scopedNotes("address"), "address"));
}

function legacyUpdateFilterOptionsForNotes() {
  const folder = getCurrentFolder();

  const categorySelect = $id("notes-filter-note-category");
  const tagsSelect = $id("notes-filter-note-tags");
  const countrySelect = $id("notes-filter-note-country");
  const regionSelect = $id("notes-filter-note-region");
  const citySelect = $id("notes-filter-note-city");
  const addressSelect = $id("notes-filter-note-address");

  if (!folder) {
    if (categorySelect) categorySelect.innerHTML = '<option value="">Categoría: Todas</option>';
    if (tagsSelect) tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    if (countrySelect) countrySelect.innerHTML = '<option value="">PaÃ­s: Todos</option>';
    if (regionSelect) regionSelect.innerHTML = '<option value="">RegiÃ³n: Todas</option>';
    if (citySelect) citySelect.innerHTML = '<option value="">Ciudad: Todas</option>';
    if (addressSelect) addressSelect.innerHTML = '<option value="">DirecciÃ³n: Todas</option>';
    return;
  }

  const notesInFolder = state.notes.filter((note) => note.folderId === folder.id);
  const categories = new Set();
  const tags = new Set();

  notesInFolder.forEach((note) => {
    if (note.category) categories.add(note.category);
    if (note.tags) note.tags.forEach((tag) => tags.add(tag));
  });

  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Categoría: Todas</option>';
    Array.from(categories).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = `Categoría: ${category}`;
      categorySelect.appendChild(option);
    });
    categorySelect.value = currentValue;
  }

  if (tagsSelect) {
    const currentValue = tagsSelect.value;
    tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    Array.from(tags).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `Tag: ${tag}`;
      tagsSelect.appendChild(option);
    });
    tagsSelect.value = currentValue;
  }
}

function updateFilterOptions() {
  const categories = new Set();
  const tags = new Set();

  state.folders.forEach((folder) => {
    if (folder.category) categories.add(folder.category);
    if (folder.tags) folder.tags.forEach((tag) => tags.add(tag));
  });

  const categorySelect = $id("notes-filter-category");
  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Categoria: Todas</option>';
    Array.from(categories).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = `Categoria: ${category}`;
      categorySelect.appendChild(option);
    });
    categorySelect.value = currentValue;
  }

  const tagsSelect = $id("notes-filter-tags");
  if (tagsSelect) {
    const currentValue = tagsSelect.value;
    tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    Array.from(tags).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `Tag: ${tag}`;
      tagsSelect.appendChild(option);
    });
    tagsSelect.value = currentValue;
  }
}

function updateFilterOptionsForNotes() {
  const folder = getCurrentFolder();

  const categorySelect = $id("notes-filter-note-category");
  const tagsSelect = $id("notes-filter-note-tags");
  const countrySelect = $id("notes-filter-note-country");
  const regionSelect = $id("notes-filter-note-region");
  const citySelect = $id("notes-filter-note-city");
  const addressSelect = $id("notes-filter-note-address");

  if (!folder) {
    if (categorySelect) categorySelect.innerHTML = '<option value="">Categoria: Todas</option>';
    if (tagsSelect) tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    if (countrySelect) countrySelect.innerHTML = '<option value="">Pais: Todos</option>';
    if (regionSelect) regionSelect.innerHTML = '<option value="">Region: Todas</option>';
    if (citySelect) citySelect.innerHTML = '<option value="">Ciudad: Todas</option>';
    if (addressSelect) addressSelect.innerHTML = '<option value="">Direccion: Todas</option>';
    state.noteLocationFilters = createEmptyNoteLocationFilters();
    return;
  }

  const notesInFolder = state.notes.filter((note) => note.folderId === folder.id);
  const categories = new Set();
  const tags = new Set();

  notesInFolder.forEach((note) => {
    if (note.category) categories.add(note.category);
    if (note.tags) note.tags.forEach((tag) => tags.add(tag));
  });

  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Categoria: Todas</option>';
    Array.from(categories).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = `Categoria: ${category}`;
      categorySelect.appendChild(option);
    });
    categorySelect.value = currentValue;
  }

  if (tagsSelect) {
    const currentValue = tagsSelect.value;
    tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    Array.from(tags).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `Tag: ${tag}`;
      tagsSelect.appendChild(option);
    });
    tagsSelect.value = currentValue;
  }

  const buildScopedNotes = (locationFilters = {}) => filterNotesByFolder(
    state.notes,
    folder.id,
    state.noteQuery,
    state.noteCategoryFilter,
    state.noteTagsFilter,
    locationFilters,
  );

  const nextLocationFilters = {
    country: String(state.noteLocationFilters?.country || "").trim(),
    region: String(state.noteLocationFilters?.region || "").trim(),
    city: String(state.noteLocationFilters?.city || "").trim(),
    address: String(state.noteLocationFilters?.address || "").trim(),
  };

  populateSimpleFilterSelect(
    countrySelect,
    "Pais: Todos",
    buildLocationFilterOptions(buildScopedNotes(createEmptyNoteLocationFilters()), "country"),
  );
  nextLocationFilters.country = countrySelect?.value || "";

  populateSimpleFilterSelect(
    regionSelect,
    "Region: Todas",
    buildLocationFilterOptions(buildScopedNotes({
      ...createEmptyNoteLocationFilters(),
      country: nextLocationFilters.country,
    }), "region"),
  );
  nextLocationFilters.region = regionSelect?.value || "";

  populateSimpleFilterSelect(
    citySelect,
    "Ciudad: Todas",
    buildLocationFilterOptions(buildScopedNotes({
      ...createEmptyNoteLocationFilters(),
      country: nextLocationFilters.country,
      region: nextLocationFilters.region,
    }), "city"),
  );
  nextLocationFilters.city = citySelect?.value || "";

  populateSimpleFilterSelect(
    addressSelect,
    "Direccion: Todas",
    buildLocationFilterOptions(buildScopedNotes({
      ...createEmptyNoteLocationFilters(),
      country: nextLocationFilters.country,
      region: nextLocationFilters.region,
      city: nextLocationFilters.city,
    }), "address"),
  );
  nextLocationFilters.address = addressSelect?.value || "";

  state.noteLocationFilters = nextLocationFilters;
  
}

function buildLocationFilterOptions(notes = [], level = "country") {
  const values = new Set();
  (Array.isArray(notes) ? notes : []).forEach((note) => {
    const location = getNoteLocationDetails(note);
    const value = level === "address"
      ? (location.address || location.label || location.text)
      : location[level];
    if (value) values.add(value);
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function populateSimpleFilterSelect(select, placeholder, values = []) {
  if (!select) return;
  const currentValue = select.value;
  select.innerHTML = `<option value="">${placeholder}</option>`;
  values.forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = value;
    select.appendChild(option);
  });
  select.value = values.includes(currentValue) ? currentValue : "";
}

function populateNoteCategorySelector(folderId = state.selectedFolderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  const select = $id("notes-note-category-select");
  if (!select) return;

  if (!folder) {
    select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
    select.value = "";
    return;
  }

  const notesInFolder = state.notes.filter((note) => note.folderId === folder.id);
  const categories = new Set();
  notesInFolder.forEach((note) => {
    if (note.category) categories.add(note.category);
  });

  select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
  Array.from(categories).sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" })).forEach((category) => {
    const option = document.createElement("option");
    option.value = category;
    option.textContent = category;
    select.appendChild(option);
  });
}

function populateNoteTagsSelector(folderId = state.selectedFolderId, { legacyTags = [] } = {}) {
  const folder = state.folders.find((item) => item.id === folderId);
  const select = $id("notes-note-tags-select");
  if (!select) return;

  if (!folder) {
    select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
    select.value = "";
    return;
  }

  const notesInFolder = state.notes.filter((note) => note.folderId === folder.id);
  const tags = new Set();
  notesInFolder.forEach((note) => {
    if (note.tags) note.tags.forEach((tag) => tags.add(tag));
  });

  const folderTagLabels = collectTagLabels(Array.from(tags));
  const folderTagKeys = new Set(folderTagLabels.map((tag) => buildTagDefinitionKey(tag)));
  const safeLegacyTags = collectTagLabels(Array.isArray(legacyTags) ? legacyTags : [])
    .filter((tag) => !folderTagKeys.has(buildTagDefinitionKey(tag)));

  select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
  folderTagLabels.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
    select.appendChild(option);
  });
  safeLegacyTags.forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = `[Legacy] ${tag}`;
    select.appendChild(option);
  });
}

function populateNoteFolderSelector(selectedFolderId = "") {
  const select = $id("notes-note-folder-select");
  if (!select) return;

  const safeSelectedFolderId = String(selectedFolderId || "").trim();
  const options = buildFolderOptions(state.folders);
  select.innerHTML = '<option value="">Selecciona una carpeta</option>';
  options.forEach(({ id, label, folder }) => {
    const option = document.createElement("option");
    option.value = id;
    option.textContent = folder?.isPrivate ? `🔒 ${label}` : label;
    select.appendChild(option);
  });
  select.value = safeSelectedFolderId;
}

function syncNoteFolderSelection(folderId = "", { allowFolderSelection = false, legacyTags = [] } = {}) {
  const safeFolderId = String(folderId || "").trim();
  const wrap = $id("notes-note-folder-wrap");
  const select = $id("notes-note-folder-select");

  populateNoteFolderSelector(safeFolderId);
  if (wrap) {
    wrap.classList.toggle("hidden", !(allowFolderSelection || !safeFolderId));
  }
  if (select) {
    select.disabled = state.folders.length === 0;
    select.value = safeFolderId;
  }
  $id("notes-note-folder-id").value = safeFolderId;
  populateNoteCategorySelector(safeFolderId);
  populateNoteTagsSelector(safeFolderId, { legacyTags });
  renderNoteTagImageEditor();
}

function setNotePhotoStatus(message = "", tone = "") {
  const status = $id("notes-note-image-status");
  if (!status) return;
  status.textContent = message || "";
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

function setNotePhotoPreview(src = "") {
  const image = $id("notes-note-image-preview");
  const placeholder = $id("notes-note-image-placeholder");
  if (!image || !placeholder) return;

  if (!src) {
    image.classList.add("hidden");
    image.removeAttribute("src");
    placeholder.classList.remove("hidden");
    return;
  }

  image.src = src;
  image.classList.remove("hidden");
  placeholder.classList.add("hidden");
}

function clearNotePhotoObjectUrl() {
  if (!notePhotoObjectUrl) return;
  try {
    URL.revokeObjectURL(notePhotoObjectUrl);
  } catch (_) {}
  notePhotoObjectUrl = null;
}

function createNoteAttachmentDraftId() {
  return `att_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeAttachmentDraftsFromNote(note = {}) {
  return getNoteAttachmentImages(note).map((image, index) => ({
    id: String(image?.id || `attachment_${index}`).trim(),
    name: String(image?.name || `Imagen ${index + 1}`).trim() || `Imagen ${index + 1}`,
    url: String(image?.url || "").trim(),
    storagePath: String(image?.storagePath || "").trim(),
    createdAt: Number(image?.createdAt || Date.now()),
    file: null,
    previewUrl: "",
    remove: false,
  }));
}

function revokeNoteAttachmentDraftPreview(draft = {}) {
  const previewUrl = String(draft?.previewUrl || "").trim();
  if (!previewUrl) return;
  try { URL.revokeObjectURL(previewUrl); } catch (_) {}
  draft.previewUrl = "";
}

function clearNoteAttachmentDrafts() {
  noteAttachmentDrafts.forEach((draft) => revokeNoteAttachmentDraftPreview(draft));
  noteAttachmentDrafts = [];
}

function getActiveNoteAttachmentDrafts() {
  return noteAttachmentDrafts.filter((draft) => !draft?.remove);
}

function setNoteAttachmentsStatus(message = "", tone = "") {
  const status = $id("notes-note-attachments-status");
  if (!status) return;
  status.textContent = String(message || "").trim();
  if (tone) status.dataset.tone = tone;
  else delete status.dataset.tone;
}

function renderNoteAttachmentEditor() {
  const list = $id("notes-note-attachments-list");
  const empty = $id("notes-note-attachments-empty");
  if (!list || !empty) return;
  const drafts = getActiveNoteAttachmentDrafts();
  empty.classList.toggle("hidden", drafts.length > 0);
  list.innerHTML = drafts.map((draft) => {
    const previewUrl = String(draft.previewUrl || draft.url || "").trim();
    const subtitle = draft.file ? "Nueva imagen lista para guardarse." : "Adjunto guardado.";
    return `
      <article class="notes-attachment-draft" data-attachment-id="${escapeHtml(draft.id)}">
        <button
          class="notes-attachment-draft__thumb"
          type="button"
          data-act="preview-note-attachment-draft"
          data-attachment-id="${escapeHtml(draft.id)}"
          aria-label="${escapeHtml(draft.name || "Imagen adjunta")}"
        >
          <img src="${escapeHtml(previewUrl)}" alt="${escapeHtml(draft.name || "Imagen adjunta")}" loading="lazy" decoding="async" />
        </button>
        <div class="notes-attachment-draft__copy">
          <strong>${escapeHtml(draft.name || "Imagen adjunta")}</strong>
          <span>${escapeHtml(subtitle)}</span>
        </div>
        <button
          class="notes-icon-action"
          type="button"
          data-act="remove-note-attachment-draft"
          data-attachment-id="${escapeHtml(draft.id)}"
          aria-label="Quitar adjunto"
        >Ã—</button>
      </article>
    `;
  }).join("");
}

function openNoteAttachmentsPicker() {
  const input = $id("notes-note-attachments-file");
  if (!input) return;
  input.value = "";
  input.click();
}

function openNoteAttachmentDraftPreview(attachmentId = "") {
  const draft = noteAttachmentDrafts.find((item) => item.id === String(attachmentId || "").trim() && !item.remove);
  const href = String(draft?.previewUrl || draft?.url || "").trim();
  if (!href) return;
  if (/^(blob:|data:)/i.test(href)) {
    const popup = window.open(href, "_blank", "noopener,noreferrer");
    if (popup) {
      try { popup.opener = null; } catch (_) {}
    }
    return;
  }
  openExternalUrl(href);
}

function openNoteImagePicker(mode = "gallery") {
  const input = $id("notes-note-image-file");
  if (!input) return;
  input.value = "";
  if (mode === "camera") input.setAttribute("capture", "environment");
  else input.removeAttribute("capture");
  input.click();
}

function closeNoteModal() {
  clearNotePhotoObjectUrl();
  clearNoteAttachmentDrafts();
  clearNoteTagImageDrafts();
  clearLocationSuggestionList();
  closeLocationMapModal();
  clearNoteLinkSuggestionList();
  hideNoteDuplicateWarning();
  const noteForm = $id("notes-note-form");
  if (noteForm) {
    delete noteForm.dataset.duplicateConfirmed;
    delete noteForm.dataset.duplicateSignature;
  }
  noteLinkDraftReferences = [];
  notePhotoRemove = false;
  if ($id("notes-note-image-file")) $id("notes-note-image-file").value = "";
  if ($id("notes-note-attachments-file")) $id("notes-note-attachments-file").value = "";
  if ($id("notes-note-tag-image-file")) $id("notes-note-tag-image-file").value = "";
  setNotePhotoStatus("");
  setNoteAttachmentsStatus("");
  closeModal("notes-note-modal-backdrop");
}

function openNoteModal(note = null, options = {}) {
  const folderId = String(note?.folderId || options.folderId || state.selectedFolderId || "").trim();
  const person = getNotePersonFields(note);
  const allowFolderSelection = Boolean(options.allowFolderSelection)
    || !folderId
    || (!note && getChildFolders(state.folders, folderId).length > 0);
  syncNoteFolderSelection(folderId, {
    allowFolderSelection,
    legacyTags: note?.tags || [],
  });

  notePhotoRemove = false;
  clearNotePhotoObjectUrl();
  clearNoteAttachmentDrafts();
  clearNoteTagImageDrafts();
  clearNoteLinkSuggestionList();
  noteLinkDraftReferences = [];
  noteAttachmentDrafts = normalizeAttachmentDraftsFromNote(note);
  noteSelectedTagImageKey = buildTagDefinitionKey(note?.tagImageKey);
  if ($id("notes-note-image-file")) $id("notes-note-image-file").value = "";
  if ($id("notes-note-attachments-file")) $id("notes-note-attachments-file").value = "";
  if ($id("notes-note-tag-image-file")) $id("notes-note-tag-image-file").value = "";
  setNotePhotoPreview(buildNoteImageRenderUrl(note));
  setNotePhotoStatus("");
  setNoteAttachmentsStatus("");

  $id("notes-note-id").value = note?.id || "";
  $id("notes-note-folder-id").value = folderId || "";
  $id("notes-note-title").value = note?.title || "";
  $id("notes-note-content").value = sanitizeNoteContentForEditor(note);
  const inferredKind = note?.noteKind || state.folders.find((row) => row.id === folderId)?.defaultNoteKind || "text";
  $id("notes-note-kind").value = normalizeNoteKind(inferredKind);
  $id("notes-note-code").value = note?.code || "";
  $id("notes-note-code-language").value = normalizeCodeLanguage(note?.codeLanguage);
  $id("notes-note-preview-html").value = note?.previewHtml || "";
  $id("notes-note-category").value = note?.category || "";
  $id("notes-note-category-select").value = note?.category || "";
  $id("notes-note-tags").value = (note?.tags || []).join(", ");
  populateNoteTagsSelector(folderId, { legacyTags: note?.tags || [] });
  $id("notes-note-tags-select").value = "";
  $id("notes-note-rating").value = note?.rating === null || note?.rating === undefined ? "" : String(note.rating);
  $id("notes-note-is-link").checked = note?.type === "link";
  $id("notes-note-url").value = note?.url || "";
  $id("notes-note-location-search").value = note?.location?.label || note?.location?.text || "";
  $id("notes-note-location-label").value = note?.location?.label || "";
  $id("notes-note-location-country").value = note?.location?.country || "";
  $id("notes-note-location-region").value = note?.location?.region || "";
  $id("notes-note-location-province").value = note?.location?.province || "";
  $id("notes-note-location-city").value = note?.location?.city || note?.location?.place || "";
  $id("notes-note-location-municipality").value = note?.location?.municipality || "";
  $id("notes-note-location-postal-code").value = note?.location?.postalCode || "";
  $id("notes-note-location-lat").value = note?.location?.lat || note?.location?.coords?.lat || "";
  $id("notes-note-location-lng").value = note?.location?.lng || note?.location?.coords?.lng || "";
  $id("notes-note-location-source").value = note?.location?.source || "";
  $id("notes-note-location-coords").value = note?.location?.coords
    ? `${note.location.coords.lat}, ${note.location.coords.lng}`
    : "";
  $id("notes-note-location-status").textContent = note?.location?.label || note?.location?.text
    ? "UbicaciÃ³n cargada."
    : "Escribe una direcciÃ³n o elige un punto en el mapa.";
  $id("notes-note-person-first-name").value = person.firstName || "";
  $id("notes-note-person-last-name").value = person.lastName || "";
  $id("notes-note-person-nationality").value = person.nationality || "";
  $id("notes-note-person-phone").value = note?.person?.phone || "";
  $id("notes-note-person-birthday").value = note?.person?.birthday || "";
  $id("notes-note-person-address").value = note?.person?.address || "";
  $id("notes-note-person-socials").value = note?.person?.socials || "";
  $id("notes-note-title").dataset.autoPersonTitle = person.firstName || note?.title || "";
  updateNoteEditorMode(inferredKind);
  hideNoteDuplicateWarning();
  const noteForm = $id("notes-note-form");
  if (noteForm) {
    delete noteForm.dataset.duplicateConfirmed;
    delete noteForm.dataset.duplicateSignature;
  }
  $id("notes-note-form-error").textContent = "";
  $id("notes-note-modal-title").textContent = note ? "Editar nota" : "Nueva nota";
  updateNoteRatingPreview();
  renderNoteAttachmentEditor();
  renderNoteTagImageEditor();
  openModal("notes-note-modal-backdrop");
  syncNoteModalCodeAssist();
}

function openGlobalNoteModal() {
  const folderId = String(state.selectedFolderId || "").trim();
  openNoteModal(null, {
    folderId,
    allowFolderSelection: !folderId,
  });
}

function closeReminderModal() {
  reminderDraftAlerts = [];
  reminderDraftCategories = [];
  reminderDraftChecklistItems = {};
  reminderExpandedChecklist.clear();
  $id("notes-reminder-form-error").textContent = "";
  closeModal("notes-reminder-modal-backdrop");
}

function renderReminderAlertDrafts() {
  const list = $id("notes-reminder-alert-list");
  if (!list) return;
  if (!reminderDraftAlerts.length) {
    list.innerHTML = '<div class="notes-reminder-alert-empty">Sin avisos configurados.</div>';
    return;
  }
  list.innerHTML = reminderDraftAlerts.map((alert, index) => `
    <button class="notes-reminder-alert-chip" type="button" data-act="remove-reminder-alert" data-alert-index="${index}">
      ${escapeHtml(`${alert.amount} ${alert.unit}`)} ✕
    </button>
  `).join("");
}

function renderReminderCategoryDrafts() {
  const select = $id("notes-reminder-categories");
  if (!select) return;
  const selected = reminderDraftCategories?.[0] || "";
  select.innerHTML = `<option value="">Sin categoría</option>` + (state.reminderCategories || []).map((category) => `
    <option value="${escapeHtml(category.name)}" ${selected === category.name ? "selected" : ""}>
      ${escapeHtml(`${category.emoji || ""} ${category.name}`.trim())}
    </option>
  `).join("");
}

function renderReminderColorPalette(selectedColor = DEFAULT_REMINDER_COLOR) {
  const palette = $id("notes-reminder-color-palette");
  const input = $id("notes-reminder-color");
  if (!palette || !input) return;
  const safeColor = normalizeReminderColor(selectedColor || input.value || DEFAULT_REMINDER_COLOR);
  input.value = safeColor;
  palette.innerHTML = REMINDER_COLOR_PALETTE.map((color, index) => `
    <button
      class="notes-reminder-color-swatch${safeColor === color ? " is-selected" : ""}"
      type="button"
      role="radio"
      aria-checked="${safeColor === color ? "true" : "false"}"
      aria-label="Color ${index + 1}"
      data-act="set-reminder-color"
      data-color="${color}"
      style="--notes-reminder-swatch:${color};"
    ></button>
  `).join("");
}

function renderReminderChecklistDrafts() {
  const list = $id("notes-reminder-checklist-list");
  if (!list) return;
  const items = Object.values(reminderDraftChecklistItems || {}).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  if (!items.length) {
    list.innerHTML = '<div class="notes-reminder-alert-empty">Sin checkpoints.</div>';
    return;
  }
  list.innerHTML = items.map((item) => `
    <div class="notes-reminder-checklist-draft-item">
      <input type="checkbox" ${item.done ? "checked" : ""} data-act="toggle-draft-checklist-item" data-item-id="${escapeHtml(item.id)}" />
      <input type="text" value="${escapeHtml(item.text)}" data-act="edit-draft-checklist-item" data-item-id="${escapeHtml(item.id)}" />
      <button class="notes-icon-action" type="button" data-act="delete-draft-checklist-item" data-item-id="${escapeHtml(item.id)}">×</button>
    </div>
  `).join("");
}

function openReminderModal(reminder = null, options = {}) {
  const presetDate = parseDateKey(options?.presetDate || "")
    ? String(options.presetDate || "")
    : (parseDateKey(state.reminderCalendarSelectedDate || "") ? state.reminderCalendarSelectedDate : getTodayDateKey());
  reminderDraftAlerts = Array.isArray(reminder?.remindBefore) ? [...reminder.remindBefore] : [];
  reminderDraftCategories = Array.isArray(reminder?.categories) ? [String(reminder.categories[0] || "").trim()].filter(Boolean) : [];
  reminderDraftChecklistItems = { ...(reminder?.checklistItems || {}) };
  $id("notes-reminder-id").value = reminder?.id || "";
  $id("notes-reminder-title").value = reminder?.title || "";
  $id("notes-reminder-description").value = reminder?.description || "";
  $id("notes-reminder-emoji").value = reminder?.emoji || "⏰";
  $id("notes-reminder-type").value = reminder?.type || "normal";
  $id("notes-reminder-date").value = reminder?.targetDate || presetDate || "";
  $id("notes-reminder-time").value = reminder?.targetTime || "";
  $id("notes-reminder-color").value = normalizeReminderColor(reminder?.color);
  $id("notes-reminder-is-birthday").checked = reminder?.type === "cumpleaños";
  $id("notes-reminder-repeat-yearly").checked = reminder?.repeat === "yearly";
  $id("notes-reminder-delete")?.classList.toggle("hidden", !reminder);
  $id("notes-reminder-modal-title").textContent = reminder ? "Editar recordatorio" : "Nuevo recordatorio";
  if ($id("notes-reminder-category-new")) $id("notes-reminder-category-new").value = "";
  renderReminderAlertDrafts();
  renderReminderCategoryDrafts();
  renderReminderColorPalette(reminder?.color);
  renderReminderChecklistDrafts();
  $id("notes-reminder-checklist-wrap")?.classList.toggle("hidden", (reminder?.type || "normal") !== "checklist");
  openModal("notes-reminder-modal-backdrop");
}

async function handleReminderPrimaryAction(action = "", reminder = null) {
  if (!reminder) return false;
  if (action === "edit-reminder") {
    openReminderModal(reminder);
    return true;
  }
  if (action === "complete-reminder") {
    const nextReminder = { ...reminder, status: "completado", completedAt: Date.now() };
    const nextReminders = (state.reminders || []).map((item) => (item.id === reminder.id ? nextReminder : item));
    if (shouldResetReminderFilterToAllPending(nextReminders)) {
      clearReminderActiveFilter();
    }
    await updateReminder(state.rootPath, reminder.id, nextReminder);
    return true;
  }
  if (action === "delete-reminder") {
    if (window.confirm(`Â¿Eliminar recordatorio "${reminder.title}"?`)) {
      const nextReminders = (state.reminders || []).filter((item) => item.id !== reminder.id);
      if (shouldResetReminderFilterToAllPending(nextReminders)) {
        clearReminderActiveFilter();
      }
      await deleteReminder(state.rootPath, reminder.id);
    }
    return true;
  }
  return false;
}

function reminderAlertToMs(alert) {
  const amount = Number(alert?.amount || 0);
  if (!amount) return 0;
  if (alert?.unit === "days") return amount * 24 * 60 * 60 * 1000;
  if (alert?.unit === "hours") return amount * 60 * 60 * 1000;
  if (alert?.unit === "minutes") return amount * 60 * 1000;
  return 0;
}

function appendReminderToast(message, reminderId, key) {
  enqueueReminderToast({ message, reminderId, key });
  const reminder = state.reminders.find((row) => row.id === reminderId);
  if (reminder && state.rootPath) {
    updateReminder(state.rootPath, reminderId, { ...reminder, notifiedAt: Date.now() }).catch(() => {});
    emitReminderNotificationsUpdated();
  }
}

function emitReminderNotificationsUpdated() {
  try {
    window.dispatchEvent(new CustomEvent("bookshell:reminder-notifications", {
      detail: { pendingTodayCount: getReminderNotificationItems().filter((item) => item.status !== "hecho").length },
    }));
  } catch (_) {}
}

function enqueueReminderToast(payload = {}) {
  reminderToastQueue.push(payload);
  if (!reminderToastActive) showNextReminderToast();
}

function showNextReminderToast() {
  if (reminderToastActive || !reminderToastQueue.length) return;
  const stack = $id("notes-reminder-toast-stack");
  if (!stack) return;
  const payload = reminderToastQueue.shift();
  reminderToastActive = payload;
  const toast = document.createElement("article");
  toast.className = "notes-reminder-toast reminder-toast";
  toast.dataset.reminderId = payload.reminderId || "";
  toast.innerHTML = `<p>${escapeHtml(payload.message || "Recordatorio")}</p>`;
  stack.innerHTML = "";
  stack.appendChild(toast);
  const closeNow = () => {
    if (!toast.isConnected) return;
    toast.remove();
    reminderToastActive = null;
    showNextReminderToast();
  };
  window.setTimeout(closeNow, 2600);
  if (navigator.vibrate) navigator.vibrate(50);
  toast.addEventListener("click", async (event) => {
    event.stopPropagation();
    const reminderId = String(payload.reminderId || "").trim();
    await navigateToReminder(reminderId);
    closeNow();
  });
  window.setTimeout(() => {
    document.addEventListener("click", (event) => {
      if (!toast.contains(event.target)) closeNow();
    }, { once: true });
  }, 0);
}

async function navigateToReminder(reminderId = "") {
  const safeId = String(reminderId || "").trim();
  if (window.__bookshellOpenViewRoot) {
    await window.__bookshellOpenViewRoot("view-notes", { pushHash: true });
  }
  state.rootSection = "reminders";
  state.reminderCalendarFocusedReminderId = safeId;
  renderShell();
}

function getReminderNotificationItems() {
  const today = getTodayDateKey();
  return (state.reminders || [])
    .filter((reminder) => {
      const reminderDay = getReminderOccurrenceDateKey(reminder, reminder?.repeat === "yearly" ? new Date().getFullYear() : null);
      return reminderDay === today;
    })
    .map((reminder) => ({
      id: reminder.id,
      title: reminder.title || "Sin título",
      targetTime: reminder.targetTime || "",
      status: reminder.status === "completado" ? "hecho" : (getReminderComputedStatus(reminder) === "vencido" ? "vencido" : "pendiente"),
    }));
}

function runReminderChecks() {
  console.info('[reminders:global-check]', { total: (state.reminders || []).length });
  const now = Date.now();
  for (const reminder of state.reminders || []) {
    if (getReminderComputedStatus(reminder) !== "pendiente") continue;
    const targetAt = getReminderTargetTimestamp(reminder, { annualizeBirthdays: true });
    if (!targetAt) continue;
    const dismissedAlerts = new Set(Array.isArray(reminder.dismissedAlerts) ? reminder.dismissedAlerts : []);
    for (const alert of reminder.remindBefore || []) {
      const beforeMs = reminderAlertToMs(alert);
      const triggerAt = targetAt - beforeMs;
      const key = `${reminder.id}:${alert.amount}:${alert.unit}:${targetAt}`;
      if (dismissedAlerts.has(key) || Number(reminder?.notifiedAt || 0) > 0) continue;
      if (now >= triggerAt && now <= triggerAt + 75 * 1000) {
        const label = alert.unit === "days" ? "días" : alert.unit === "hours" ? "horas" : "minutos";
        const prefix = reminder.type === "cumpleaños" ? "🎂" : (reminder.type === "checklist" ? "🧾" : "⏰");
        const noun = reminder.type === "checklist" ? "checklist" : "recordatorio";
        const msg = alert.unit === 'days' ? `${prefix} En ${alert.amount} días: ${reminder.title || "sin título"}` : `${prefix} Quedan ${alert.amount} ${label} para ${noun}: ${reminder.title || "sin título"}`;
        appendReminderToast(msg, reminder.id, key);
      }
    }
    const dueKey = `${reminder.id}:due:${targetAt}`;
    if (!Number(reminder?.notifiedAt || 0) && now >= targetAt) {
      appendReminderToast(`⏰ Es la hora de: ${reminder.title || "sin título"}`, reminder.id, dueKey);
    }
  }
  emitReminderNotificationsUpdated();
}

function startReminderChecker() {
  if (reminderCheckTimer) return;
  runReminderChecks();
  reminderCheckTimer = window.setInterval(runReminderChecks, 45 * 1000);
}

function stopReminderChecker() {
  if (!reminderCheckTimer) return;
  window.clearInterval(reminderCheckTimer);
  reminderCheckTimer = null;
}

async function handleFolderDelete(folder) {
  const hasSubfolders = state.folders.some((item) => item.parentId === folder.id);
  const hasNotes = state.notes.some((item) => item.folderId === folder.id);
  if (hasSubfolders || hasNotes) {
    window.alert("Solo puedes borrar carpetas vacías. Mueve o elimina antes sus subcarpetas y notas.");
    return;
  }

  if (!window.confirm(`¿Borrar carpeta "${folder.name}"?`)) return;
  try {
    await deleteFolder(state.rootPath, folder.id, state.folders, state.notes);
  } catch (error) {
    console.warn("[notes] no se pudo borrar la carpeta", error);
    window.alert("No se ha podido borrar la carpeta.");
  }
}

async function handleNoteDelete(note) {
  if (!window.confirm(`¿Borrar nota "${getNoteDisplayTitle(note) || note.title || "sin título"}"?`)) return;

  try {
    await deleteNote(state.rootPath, note.id);
  } catch (error) {
    console.warn("[notes] no se pudo borrar la nota", error);
    window.alert("No se ha podido borrar la nota.");
    return;
  }

  if (note.imageUrl || note.imagePath) {
    try {
      await deleteNoteImageAsset(state.uid, note.id, note.imagePath, note.imageUrl);
    } catch (error) {
      console.warn("[notes] la nota se borró, pero no se pudo limpiar la imagen", error);
    }
  }
  for (const attachment of getNoteAttachmentImages(note)) {
    try {
      await deleteNoteAttachmentImageAsset(state.uid, note.id, attachment.id, attachment.storagePath, attachment.url);
    } catch (error) {
      console.warn("[notes] la nota se borro, pero no se pudo limpiar un adjunto", error);
    }
  }
}

function bindFolderModalEvents() {
  const privateInput = $id("notes-folder-private");
  privateInput?.addEventListener("change", () => {
    const enabled = Boolean(privateInput.checked);
    $id("notes-folder-pin-wrap")?.classList.toggle("hidden", !enabled);
    if (!enabled) {
      $id("notes-folder-pin").value = "";
    }
  });

  $id("notes-folder-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = $id("notes-folder-id").value;
    const name = $id("notes-folder-name-input").value.trim();
    const color = $id("notes-folder-color").value;
    const emoji = $id("notes-folder-emoji").value.trim() || "📁";
    const parentId = String($id("notes-folder-parent-select")?.value || "").trim();
    const category = $id("notes-folder-category").value.trim();
    const tagsInput = $id("notes-folder-tags").value.trim();
    const tags = parseTagList(tagsInput);
    const isPrivate = $id("notes-folder-private").checked;
    const pin = String($id("notes-folder-pin").value || "").replace(/\D+/g, "").slice(0, 4);
    const errorField = $id("notes-folder-form-error");

    errorField.textContent = "";
    if (!state.rootPath || !state.uid) {
      errorField.textContent = "Espera un momento a que se cargue tu espacio de notas.";
      return;
    }
    if (!name) return;
    if (!isFolderParentAllowed(state.folders, id, parentId)) {
      errorField.textContent = "Selecciona una carpeta padre válida.";
      return;
    }
    if (isPrivate && pin.length !== 4) {
      errorField.textContent = "El PIN debe tener 4 dígitos.";
      return;
    }

    const payload = {
      name,
      color,
      emoji,
      parentId,
      category,
      tags,
      createdAt: Date.now(),
      isPrivate,
      pin,
    };

    try {
      if (id) {
        const current = state.folders.find((row) => row.id === id);
        await updateFolder(state.rootPath, id, {
          ...current,
          ...payload,
          createdAt: current?.createdAt || payload.createdAt,
        });
      } else {
        await createFolder(state.rootPath, payload);
      }
      closeModal("notes-folder-modal-backdrop");
      renderShell();
    } catch (error) {
      console.warn("[notes] no se pudo guardar la carpeta", error);
      errorField.textContent = "No se ha podido guardar la carpeta.";
    }
  });

  $id("notes-folder-modal-close")?.addEventListener("click", () => closeModal("notes-folder-modal-backdrop"));
  $id("notes-folder-modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $id("notes-folder-modal-backdrop")) {
      closeModal("notes-folder-modal-backdrop");
    }
  });
}

function bindNoteModalEvents() {
  const isLinkInput = $id("notes-note-is-link");
  const imageInput = $id("notes-note-image-file");
  const attachmentsInput = $id("notes-note-attachments-file");
  const tagImageInput = $id("notes-note-tag-image-file");
  const tagsTextInput = $id("notes-note-tags");
  const ratingSelect = $id("notes-note-rating");
  const noteKindSelect = $id("notes-note-kind");
  const noteContentInput = $id("notes-note-content");
  const personFirstNameInput = $id("notes-note-person-first-name");
  const codeLanguageSelect = $id("notes-note-code-language");
  const codeEditor = $id("notes-note-code");
  const codeShell = $id("notes-note-code-editor-shell");
  const codeColorInput = $id("notes-note-code-color-input");

  isLinkInput?.addEventListener("change", () => {
    updateNoteLinkDependentFields(isLinkInput.checked);
  });

  noteKindSelect?.addEventListener("change", (event) => {
    updateNoteEditorMode(event.target?.value);
    if (normalizeNoteKind(event.target?.value) === "persona") {
      syncPersonTitleFromFirstName({ force: false });
    }
    $id("notes-note-form-error").textContent = "";
  });

  personFirstNameInput?.addEventListener("input", () => {
    syncPersonTitleFromFirstName({ force: false });
    $id("notes-note-form-error").textContent = "";
  });

  noteContentInput?.addEventListener("input", () => {
    refreshNoteLinkSuggestions({ resetActiveIndex: true });
    $id("notes-note-form-error").textContent = "";
  });

  noteContentInput?.addEventListener("click", () => {
    refreshNoteLinkSuggestions({ resetActiveIndex: false });
  });

  noteContentInput?.addEventListener("keyup", () => {
    refreshNoteLinkSuggestions({ resetActiveIndex: false });
  });

  noteContentInput?.addEventListener("keydown", (event) => {
    const hasSuggestions = (noteLinkAutocompleteState.items || []).length > 0;
    if (!hasSuggestions) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveNoteLinkSuggestion(1);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveNoteLinkSuggestion(-1);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      const active = noteLinkAutocompleteState.items[noteLinkAutocompleteState.activeIndex] || noteLinkAutocompleteState.items[0];
      if (active?.id) selectNoteLinkSuggestion(active.id);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      clearNoteLinkSuggestionList();
    }
  });

  noteContentInput?.addEventListener("blur", () => {
    window.setTimeout(() => {
      const host = $id("notes-note-link-suggestions");
      if (host?.matches(":hover")) return;
      clearNoteLinkSuggestionList();
    }, 120);
  });

  codeLanguageSelect?.addEventListener("change", () => {
    syncNoteModalCodeAssist();
    $id("notes-note-form-error").textContent = "";
  });

  codeEditor?.addEventListener("input", () => {
    syncNoteModalCodeAssist();
    $id("notes-note-form-error").textContent = "";
  });

  codeEditor?.addEventListener("keyup", () => {
    syncNoteModalCodeAssist();
  });

  codeEditor?.addEventListener("click", () => {
    syncNoteModalCodeAssist();
  });

  codeEditor?.addEventListener("scroll", () => {
    syncNoteModalCodeAssist();
  });

  codeShell?.addEventListener("click", (event) => {
    const target = event.target?.closest?.("[data-act]");
    if (!target || !codeEditor) return;

    if (target.dataset.act === "insert-modal-snippet-suggestion") {
      event.preventDefault();
      insertSnippetSuggestionIntoEditor(codeEditor, String(target.dataset.property || "").trim());
      syncNoteModalCodeAssist();
      return;
    }

    if (target.dataset.act === "pick-modal-snippet-color") {
      event.preventDefault();
      const colors = detectSnippetColorMatches(codeEditor.value);
      const colorIndex = Number(target.dataset.colorIndex || -1);
      const selected = colors[colorIndex];
      if (!codeColorInput || !selected) return;
      codeColorInput.dataset.colorIndex = String(colorIndex);
      codeColorInput.value = resolveCssColorToHex(selected.value) || "#ffffff";
      if (typeof codeColorInput.showPicker === "function") codeColorInput.showPicker();
      else codeColorInput.click();
    }
  });

  codeColorInput?.addEventListener("change", () => {
    if (!codeEditor) return;
    if (!replaceSnippetColorInEditor(codeEditor, Number(codeColorInput.dataset.colorIndex || -1), codeColorInput.value)) return;
    syncNoteModalCodeAssist();
  });

  $id("notes-note-image-camera")?.addEventListener("click", () => openNoteImagePicker("camera"));
  $id("notes-note-image-gallery")?.addEventListener("click", () => openNoteImagePicker("gallery"));
  $id("notes-note-image-remove")?.addEventListener("click", () => {
    notePhotoRemove = true;
    if (imageInput) imageInput.value = "";
    clearNotePhotoObjectUrl();
    setNotePhotoPreview("");
    setNotePhotoStatus("La foto se quitará al guardar.", "warning");
    $id("notes-note-form-error").textContent = "";
  });

  imageInput?.addEventListener("change", (event) => {
    const file = event.target?.files?.[0] || null;
    if (!file) return;
    notePhotoRemove = false;
    clearNotePhotoObjectUrl();
    notePhotoObjectUrl = URL.createObjectURL(file);
    setNotePhotoPreview(notePhotoObjectUrl);
    setNotePhotoStatus("Foto lista para guardarse.");
    $id("notes-note-form-error").textContent = "";
  });

  $id("notes-note-attachments-add")?.addEventListener("click", () => {
    openNoteAttachmentsPicker();
  });

  attachmentsInput?.addEventListener("change", (event) => {
    const files = Array.from(event.target?.files || []).filter((file) => String(file?.type || "").startsWith("image/"));
    if (!files.length) return;
    files.forEach((file) => {
      noteAttachmentDrafts.push({
        id: createNoteAttachmentDraftId(),
        name: String(file.name || "Imagen adjunta").trim() || "Imagen adjunta",
        url: "",
        storagePath: "",
        createdAt: Date.now(),
        file,
        previewUrl: URL.createObjectURL(file),
        remove: false,
      });
    });
    renderNoteAttachmentEditor();
    setNoteAttachmentsStatus(pluralize(files.length, "Imagen lista para guardarse.", "Imagenes listas para guardarse."));
    $id("notes-note-form-error").textContent = "";
  });

  tagImageInput?.addEventListener("change", (event) => {
    const file = event.target?.files?.[0] || null;
    const safeTagKey = buildTagDefinitionKey(activeNoteTagImageKey);
    activeNoteTagImageKey = "";
    if (!file || !safeTagKey) return;

    syncNoteTagImageDrafts(getCurrentNoteModalTags());
    const draft = noteTagImageDrafts.get(safeTagKey);
    if (!draft) return;

    revokeNoteTagDraftPreview(draft);
    draft.file = file;
    draft.previewUrl = URL.createObjectURL(file);
    draft.remove = false;
    renderNoteTagImageEditor();
    $id("notes-note-form-error").textContent = "";
  });

  tagsTextInput?.addEventListener("input", () => {
    ensureNoteSelectedTagImageKey(getCurrentNoteModalTags());
    renderNoteTagImageEditor();
    $id("notes-note-form-error").textContent = "";
  });

  ratingSelect?.addEventListener("change", () => {
    updateNoteRatingPreview();
    $id("notes-note-form-error").textContent = "";
  });

  $id("notes-note-rating-clear")?.addEventListener("click", () => {
    if (ratingSelect) ratingSelect.value = "";
    updateNoteRatingPreview();
    $id("notes-note-form-error").textContent = "";
  });

  $id("notes-note-location-search")?.addEventListener("input", async (event) => {
    const query = String(event.target?.value || "").trim();
    const list = $id("notes-note-location-suggestions");
    const status = $id("notes-note-location-status");
    if (!list || !status) return;
    clearTimeout(notesLocationSearchTimer);
    if (normalizeLocationLookup(query) !== normalizeLocationLookup($id("notes-note-location-label")?.value || "")) {
      clearSelectedLocationFields();
    }
    if (query.length < 3) {
      clearLocationSuggestionList();
      status.textContent = "Escribe al menos 3 caracteres.";
      return;
    }
    status.textContent = "Buscando ubicación…";
    notesLocationSearchTimer = setTimeout(async () => {
      const rows = await searchLocationSuggestions(query);
      list.innerHTML = rows.map((item) => buildLocationSuggestionMarkup(item)).join("");
      list.classList.toggle("hidden", rows.length === 0);
      status.textContent = rows.length ? `${rows.length} sugerencias` : "Sin resultados.";
    }, 300);
  });
  $id("notes-note-location-map-open")?.addEventListener("click", () => {
    void openLocationMapModal();
  });
  $id("notes-location-map-close")?.addEventListener("click", () => closeLocationMapModal());
  $id("notes-location-map-cancel")?.addEventListener("click", () => closeLocationMapModal());
  $id("notes-location-map-current")?.addEventListener("click", () => {
    void useCurrentLocationForMap();
  });
  $id("notes-location-map-confirm")?.addEventListener("click", () => {
    if (!applyLocationMapSelectionToForm()) return;
    closeLocationMapModal();
  });
  $id("notes-location-map-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $id("notes-location-map-backdrop")) {
      closeLocationMapModal();
    }
  });

  $id("notes-note-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (noteSaveInFlight) return;

    const noteForm = $id("notes-note-form");
    const id = String($id("notes-note-id").value || "").trim();
    const folderId = String(
      $id("notes-note-folder-select")?.value
      || $id("notes-note-folder-id")?.value
      || "",
    ).trim();
    const noteKind = normalizeNoteKind($id("notes-note-kind")?.value);
    const rawTitle = $id("notes-note-title").value.trim();
    const content = $id("notes-note-content").value.trim();
    const code = $id("notes-note-code").value.trim();
    const codeLanguage = normalizeCodeLanguage($id("notes-note-code-language")?.value);
    const previewHtml = $id("notes-note-preview-html").value.trim();
    const category = $id("notes-note-category").value.trim();
    const tagsInput = $id("notes-note-tags").value.trim();
    const tags = parseTagList(tagsInput);
    const rating = normalizeNoteRatingValue(ratingSelect?.value);
    const isLink = noteKind !== "code" && $id("notes-note-is-link").checked;
    const url = $id("notes-note-url").value.trim();
    const locationLabel = $id("notes-note-location-label")?.value?.trim?.() || $id("notes-note-location-search")?.value?.trim?.() || "";
    const locationCountry = $id("notes-note-location-country")?.value?.trim?.() || "";
    const locationRegion = $id("notes-note-location-region")?.value?.trim?.() || "";
    const locationProvince = $id("notes-note-location-province")?.value?.trim?.() || "";
    const locationCity = $id("notes-note-location-city")?.value?.trim?.() || "";
    const locationMunicipality = $id("notes-note-location-municipality")?.value?.trim?.() || "";
    const locationPostalCode = $id("notes-note-location-postal-code")?.value?.trim?.() || "";
    const locationLat = Number($id("notes-note-location-lat")?.value || 0);
    const locationLng = Number($id("notes-note-location-lng")?.value || 0);
    const locationSource = $id("notes-note-location-source")?.value?.trim?.() || "";
    const locationCoords = parseLocationCoords($id("notes-note-location-coords")?.value || "");
    const personFirstName = $id("notes-note-person-first-name")?.value?.trim?.() || "";
    const personLastName = $id("notes-note-person-last-name")?.value?.trim?.() || "";
    const personNationality = $id("notes-note-person-nationality")?.value?.trim?.() || "";
    const personPhone = $id("notes-note-person-phone")?.value?.trim?.() || "";
    const personBirthday = $id("notes-note-person-birthday")?.value?.trim?.() || "";
    const personAddress = $id("notes-note-person-address")?.value?.trim?.() || "";
    const personSocials = $id("notes-note-person-socials")?.value?.trim?.() || "";
    const title = noteKind === "persona" ? (rawTitle || personFirstName || "") : rawTitle;
    const duplicateFirstName = noteKind === "persona" ? personFirstName : "";
    const duplicateLastName = noteKind === "persona" ? personLastName : "";
    const duplicatePhone = noteKind === "persona" ? personPhone : "";
    const errorField = $id("notes-note-form-error");
    const submitButton = noteForm?.querySelector?.("button[type='submit']");
    const previousSubmitText = submitButton?.textContent || "Guardar";
    const current = state.notes.find((row) => row.id === id) || null;
    let noteId = id;
    const selectedFile = imageInput?.files?.[0] || null;
    const removedAttachmentDrafts = noteAttachmentDrafts.filter((draft) => draft?.remove);
    const newAttachmentDrafts = noteAttachmentDrafts.filter((draft) => !draft?.remove && draft?.file instanceof File);
    const keptAttachmentDrafts = noteAttachmentDrafts.filter((draft) => !draft?.remove && !(draft?.file instanceof File));
    const hasTagImageChanges = Array.from(noteTagImageDrafts.values()).some((draft) => draft?.file instanceof File || draft?.remove);
    let uploadedImagePath = "";
    const uploadedAttachmentPaths = [];

    errorField.textContent = "";
    hideNoteDuplicateWarning();

    if (!state.rootPath || !state.uid) {
      errorField.textContent = "Espera un momento a que se cargue tu espacio de notas.";
      return;
    }
    if (!title) {
      errorField.textContent = noteKind === "persona" ? "Introduce al menos el nombre de la persona." : "Introduce un titulo para la nota.";
      (noteKind === "persona" ? $id("notes-note-person-first-name") : $id("notes-note-title"))?.focus?.();
      return;
    }
    if (!folderId) {
      errorField.textContent = "Selecciona una carpeta para guardar la nota.";
      $id("notes-note-folder-select")?.focus();
      return;
    }
    if (noteKind === "code" && !code) {
      errorField.textContent = "Pega codigo para guardar el snippet.";
      $id("notes-note-code")?.focus();
      return;
    }
    if (isLink && !url) {
      errorField.textContent = "Introduce una URL para la nota tipo link.";
      return;
    }
    noteId = noteId || createNoteId(state.rootPath);

    const rawLocationLat = Number.isFinite(locationLat) && locationLat ? locationLat : Number(locationCoords?.lat || 0);
    const rawLocationLng = Number.isFinite(locationLng) && locationLng ? locationLng : Number(locationCoords?.lng || 0);
    const hasValidLocationCoordinates = hasRealLocationCoordinates(rawLocationLat, rawLocationLng);
    const hasLocationText = Boolean(locationLabel || $id("notes-note-location-search")?.value?.trim?.());
    if (hasLocationText && !hasValidLocationCoordinates) {
      errorField.textContent = "Selecciona una ubicación de la lista.";
      $id("notes-note-location-search")?.focus();
      return;
    }

    const duplicateSignature = getDuplicateCheckSignature({
      noteId: id,
      title,
      firstName: duplicateFirstName,
      lastName: duplicateLastName,
      phone: duplicatePhone,
    });
    const duplicateMatches = collectPotentialDuplicateNotes({
      noteId: id,
      title,
      firstName: duplicateFirstName,
      lastName: duplicateLastName,
      phone: duplicatePhone,
    });
    const duplicateConfirmed = noteForm?.dataset?.duplicateConfirmed === duplicateSignature;
    if (duplicateMatches.length && !duplicateConfirmed) {
      if (noteForm) noteForm.dataset.duplicateSignature = duplicateSignature;
      renderNoteDuplicateWarning(duplicateMatches);
      return;
    }

    const payload = {
      folderId,
      title,
      name: title,
      content: noteKind === "code" ? "" : content,
      linkRefs: noteKind === "code" ? [] : buildNoteLinkRefsFromEditorContent(content),
      code: noteKind === "code" ? code : "",
      noteKind,
      codeLanguage: noteKind === "code" ? codeLanguage : "general",
      previewHtml: noteKind === "code" ? resolveSnippetPreviewHtmlValue(previewHtml, codeLanguage) : "",
      category,
      tags,
      rating,
      type: noteKind === "code" ? "note" : (isLink ? "link" : "note"),
      url: noteKind === "code" ? "" : url,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      imageUrl: current?.imageUrl || "",
      imagePath: current?.imagePath || "",
      imageUpdatedAt: Number(current?.imageUpdatedAt || 0),
      attachments: {
        images: keptAttachmentDrafts.map((draft) => ({
          id: draft.id,
          url: draft.url,
          storagePath: draft.storagePath,
          name: draft.name,
          createdAt: Number(draft.createdAt || Date.now()),
        })),
      },
      tagImageKey: "",
      location: {
        ...normalizeLocationAddress({
          label: locationLabel,
          country: locationCountry,
          region: locationRegion,
          province: locationProvince,
          city: locationCity,
          municipality: locationMunicipality,
          postalCode: locationPostalCode,
          lat: hasValidLocationCoordinates ? rawLocationLat : null,
          lng: hasValidLocationCoordinates ? rawLocationLng : null,
          source: locationSource || "manual",
          exactAddress: locationLabel,
        }),
        text: locationLabel,
        coords: hasValidLocationCoordinates ? { lat: rawLocationLat, lng: rawLocationLng } : null,
      },
      person: {
        firstName: personFirstName,
        lastName: personLastName,
        nationality: personNationality,
        notesEntries: Array.isArray(current?.person?.notesEntries) ? current.person.notesEntries : [],
        phone: personPhone,
        birthday: personBirthday,
        address: personAddress,
        socials: personSocials,
      },
    };

    ensureNoteSelectedTagImageKey(tags, current?.tagImageKey);
    payload.tagImageKey = noteSelectedTagImageKey || "";

    noteSaveInFlight = true;
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.textContent = selectedFile ? "Subiendo foto…" : "Guardando…";
    }

    try {
      if (notePhotoRemove && (current?.imageUrl || current?.imagePath)) {
        setNotePhotoStatus("Quitando foto…");
        try {
          await deleteNoteImageAsset(state.uid, noteId, current?.imagePath, current?.imageUrl);
        } catch (error) {
          console.warn("[notes] no se pudo borrar el archivo remoto de la nota", error);
        }
        payload.imageUrl = "";
        payload.imagePath = "";
        payload.imageUpdatedAt = 0;
        setNotePhotoStatus("Foto quitada.");
      }

      if (selectedFile) {
        setNotePhotoStatus("Preparando foto…");
        const optimizedFile = await downscaleNoteImageFile(selectedFile);
        setNotePhotoStatus("Subiendo foto…");
        const upload = await uploadNoteImageAsset(state.uid, noteId, optimizedFile);
        uploadedImagePath = upload.path;
        payload.imageUrl = upload.url;
        payload.imagePath = upload.path;
        payload.imageUpdatedAt = Date.now();
        setNotePhotoStatus("Foto subida.");
      }

      for (const draft of newAttachmentDrafts) {
        setNoteAttachmentsStatus(`Subiendo ${draft.name || "imagen"}...`);
        const optimizedFile = await downscaleNoteImageFile(draft.file);
        const upload = await uploadNoteAttachmentImageAsset(state.uid, noteId, draft.id, optimizedFile);
        uploadedAttachmentPaths.push({ id: draft.id, path: upload.path, url: upload.url });
        payload.attachments.images.push({
          id: draft.id,
          url: upload.url,
          storagePath: upload.path,
          name: draft.name,
          createdAt: Number(draft.createdAt || Date.now()),
        });
      }

      if (removedAttachmentDrafts.length) {
        setNoteAttachmentsStatus("Quitando adjuntos...", "warning");
        for (const draft of removedAttachmentDrafts) {
          try {
            await deleteNoteAttachmentImageAsset(state.uid, noteId, draft.id, draft.storagePath, draft.url);
          } catch (error) {
            console.warn("[notes] no se pudo borrar un adjunto de la nota", error);
          }
        }
      }

      if (newAttachmentDrafts.length) setNoteAttachmentsStatus("Adjuntos guardados.");

      await persistNoteTagDefinitions(tags);

      if (id) {
        await updateNote(state.rootPath, id, {
          ...current,
          ...payload,
          createdAt: current?.createdAt || payload.createdAt,
        });
      } else {
        await createNote(state.rootPath, payload, noteId);
      }
      const selectedFolder = state.folders.find((row) => row.id === folderId);
      if (selectedFolder && selectedFolder.defaultNoteKind !== noteKind) {
        await updateFolder(state.rootPath, folderId, { ...selectedFolder, defaultNoteKind: noteKind });
      }
      if (noteKind === "persona") await syncPersonBirthdayReminder(noteId, payload, current);
      else if (current?.person?.birthday) await syncPersonBirthdayReminder(noteId, { ...payload, person: { ...payload.person, birthday: "" } }, current);

      const folder = state.folders.find((row) => row.id === folderId);
      closeNoteModal();
      if (folderId) {
        const canOpenFolder = !folder?.isPrivate || requireUnlockedFolder(folder) || state.selectedFolderId === folderId;
        setCurrentFolder(canOpenFolder ? folderId : "");
      }
      renderShell();
    } catch (error) {
      console.warn("[notes] no se pudo guardar la nota", error);
      errorField.textContent = (selectedFile || newAttachmentDrafts.length || hasTagImageChanges)
        ? "No se ha podido subir alguna imagen o guardar la nota."
        : "No se ha podido guardar la nota.";
      if (selectedFile) setNotePhotoStatus("Ha fallado la subida de la foto.", "error");
      if (newAttachmentDrafts.length) setNoteAttachmentsStatus("Ha fallado la subida de algun adjunto.", "error");
      if (!id && uploadedImagePath) {
        try {
          await deleteNoteImageAsset(state.uid, noteId, uploadedImagePath, payload.imageUrl);
        } catch (_) {}
      }
      if (!id && uploadedAttachmentPaths.length) {
        for (const uploaded of uploadedAttachmentPaths) {
          try {
            await deleteNoteAttachmentImageAsset(state.uid, noteId, uploaded.id, uploaded.path, uploaded.url);
          } catch (_) {}
        }
      }
    } finally {
      noteSaveInFlight = false;
      if (submitButton) {
        submitButton.disabled = false;
        submitButton.textContent = previousSubmitText;
      }
    }
  });

  $id("notes-note-modal-close")?.addEventListener("click", closeNoteModal);
  $id("notes-note-duplicate-warning")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    if (target.dataset.act === "open-duplicate-note") {
      openDuplicateNoteReference(target.dataset.noteId || "", { closeNoteModalFirst: true });
      return;
    }
    const noteForm = $id("notes-note-form");
    if (target.dataset.act === "confirm-note-duplicate-save") {
      const signature = String(noteForm?.dataset?.duplicateSignature || "").trim();
      if (noteForm && signature) noteForm.dataset.duplicateConfirmed = signature;
      hideNoteDuplicateWarning();
      noteForm?.requestSubmit?.();
      return;
    }
    if (target.dataset.act === "dismiss-note-duplicate-warning") {
      if (noteForm) {
        delete noteForm.dataset.duplicateConfirmed;
        delete noteForm.dataset.duplicateSignature;
      }
      hideNoteDuplicateWarning();
    }
  });
  $id("notes-note-link-suggestions")?.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("[data-act='select-note-link-suggestion'][data-note-id]");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    selectNoteLinkSuggestion(target.dataset.noteId || "");
  });
  $id("notes-note-attachments-list")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act][data-attachment-id]");
    if (!target) return;
    const attachmentId = String(target.dataset.attachmentId || "").trim();
    if (!attachmentId) return;
    if (target.dataset.act === "preview-note-attachment-draft") {
      openNoteAttachmentDraftPreview(attachmentId);
      return;
    }
    if (target.dataset.act === "remove-note-attachment-draft") {
      const draft = noteAttachmentDrafts.find((item) => item.id === attachmentId);
      if (!draft) return;
      draft.remove = true;
      revokeNoteAttachmentDraftPreview(draft);
      renderNoteAttachmentEditor();
      setNoteAttachmentsStatus("Adjunto marcado para quitarse.", "warning");
    }
  });
  $id("notes-note-tag-images-list")?.addEventListener("click", (event) => {
    const actionTarget = event.target.closest("[data-act][data-tag-key]");
    if (!actionTarget) return;

    const action = String(actionTarget.dataset.act || "");
    const tagKey = String(actionTarget.dataset.tagKey || "");
    if (!tagKey) return;

    if (action === "pick-note-tag-image") {
      openNoteTagImagePicker(tagKey);
      return;
    }

    if (action === "select-note-tag-image") {
      event.preventDefault();
      setNoteSelectedTagImageKey(tagKey);
      return;
    }

    if (action === "toggle-note-tag-image") {
      toggleNoteTagImageDraft(tagKey);
    }
  });
  $id("notes-note-modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $id("notes-note-modal-backdrop")) {
      closeNoteModal();
    }
  });
}

function bindPinModalEvents() {
  $id("notes-pin-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const folderId = $id("notes-pin-folder-id").value;
    const pin = String($id("notes-pin-input").value || "").replace(/\D+/g, "").slice(0, 4);
    const folder = state.folders.find((row) => row.id === folderId);
    if (!folder) return;

    if (pin && pin === folder.pin) {
      state.unlockedFolderIds.add(folder.id);
      closeModal("notes-pin-modal-backdrop");
      openFolder(folder.id);
      return;
    }

    $id("notes-pin-error").textContent = "PIN incorrecto.";
  });

  $id("notes-pin-modal-close")?.addEventListener("click", () => closeModal("notes-pin-modal-backdrop"));
  $id("notes-pin-modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $id("notes-pin-modal-backdrop")) {
      closeModal("notes-pin-modal-backdrop");
    }
  });
}

function bindUiEvents() {
  if (isBound) return;
  isBound = true;

  $id("notes-btn-new-folder")?.addEventListener("click", () => openFolderModal());
  $id("notes-btn-new-subfolder")?.addEventListener("click", () => openFolderModal(null, {
    parentId: state.selectedFolderId,
  }));
  $id("notes-btn-back")?.addEventListener("click", () => {
    if (state.selectedFolderId) goUpFolder();
    else closeFolderView();
  });
  $id("notes-note-detail-close")?.addEventListener("click", closeNoteDetail);
  $id("notes-note-detail-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $id("notes-note-detail-backdrop")) closeNoteDetail();
  });
  $id("notes-btn-new-note")?.addEventListener("click", () => openNoteModal());
  $id("notes-btn-new-reminder")?.addEventListener("click", () => openReminderModal());
  $id("notes-root-switch")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='set-root-section']");
    if (!target) return;
    state.rootSection = normalizeRootSection(target.dataset.rootSection || "");
    if (state.rootSection !== "notes") {
      activeNoteDetailId = "";
      setCurrentFolder("");
      clearReminderActiveFilter();
    }
    renderShell();
    runReminderChecks();
  });
  $id("notes-reminders-toolbar")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='toggle-reminders-panel']");
    if (!target) return;
    const panel = String(target.dataset.panel || "");
    const showPanel = $id("notes-reminders-show-panel");
    const groupPanel = $id("notes-reminders-group-panel");
    if (!showPanel || !groupPanel) return;
    const nextShowHidden = panel === "show" ? !showPanel.classList.contains("hidden") : true;
    const nextGroupHidden = panel === "group" ? !groupPanel.classList.contains("hidden") : true;
    showPanel.classList.toggle("hidden", nextShowHidden);
    groupPanel.classList.toggle("hidden", nextGroupHidden);
  });
  $id("notes-reminders-calendar-shell")?.addEventListener("click", async (event) => {
    const externalLink = event.target.closest?.("a[data-external-link='true']");
    if (externalLink) {
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-act]");
    const dayEl = event.target.closest?.(".notes-reminders-calendar__day");
    const dayDateKey = String(dayEl?.dataset?.dateKey || target?.dataset?.dateKey || "").trim();
    if (dayEl && target?.dataset?.act !== "focus-reminder-calendar-item" && target?.dataset?.act !== "shift-reminders-calendar") {
      const changed = handleReminderCalendarDaySelection(dayDateKey, {
        target,
        dayEl,
        openCreateOnRepeatClick: true,
      });
      if (!changed) return;
      renderRemindersPanel();
      return;
    }
    if (!target) return;
    const action = String(target.dataset.act || "").trim();
    if (action === "shift-reminders-calendar") {
      shiftReminderCalendarMonth(Number(target.dataset.monthShift || 0), getFilteredReminders());
      clearReminderActiveFilter();
      renderRemindersPanel();
      return;
    }
    if (action === "focus-reminder-calendar-item") {
      const changed = handleReminderCalendarDaySelection(dayDateKey, {
        target,
        dayEl,
        focusedReminderId: target.dataset.reminderId || "",
      });
      if (!changed) return;
      renderRemindersPanel();
      return;
    }
  });
  $id("notes-reminders-calendar-panel")?.addEventListener("click", async (event) => {
    const externalLink = event.target.closest?.("a[data-external-link='true']");
    if (externalLink) {
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const reminder = state.reminders.find((row) => row.id === String(target.dataset.reminderId || "").trim());
    if (await handleReminderPrimaryAction(String(target.dataset.act || "").trim(), reminder)) return;
  });
  $id("notes-reminders-show-panel")?.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement)) return;
    if (input.name === "reminder-visible-types") {
      const selected = Array.from(document.querySelectorAll("input[name='reminder-visible-types']:checked"))
        .map((item) => item.value);
      state.reminderFilters.types = normalizeReminderMultiSelection(selected, REMINDER_TYPES);
    }
    if (input.name === "reminder-visible-categories") {
      const selected = Array.from(document.querySelectorAll("input[name='reminder-visible-categories']:checked"))
        .map((item) => item.value);
      state.reminderFilters.categories = normalizeReminderMultiSelection(selected);
    }
    if (input.name === "reminder-visible-statuses") {
      const selected = Array.from(document.querySelectorAll("input[name='reminder-visible-statuses']:checked"))
        .map((item) => item.value);
      state.reminderFilters.statuses = normalizeReminderMultiSelection(selected, REMINDER_STATUSES);
    }
    if (input.name === "reminder-visible-range") {
      state.reminderFilters.range = normalizeReminderRange(input.value || "all");
    }
    clearReminderActiveFilter();
    renderRemindersPanel();
    try { await persistReminderPreferences(); } catch (_) {}
  });
  $id("notes-reminders-group-panel")?.addEventListener("change", async (event) => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.name !== "reminder-group-by") return;
    state.reminderGroupBy = normalizeReminderGroupBy(input.value || "none");
    renderRemindersPanel();
    try { await persistReminderPreferences(); } catch (_) {}
  });
  $id("notes-reminders-toggle-history")?.addEventListener("click", () => {
    state.reminderCollapsedHistory = !state.reminderCollapsedHistory;
    renderRemindersPanel();
  });
  $id("notes-folder-view-switch")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='set-folder-view']");
    if (!target) return;
    const nextView = String(target.dataset.folderView || "").trim();
    state.folderView = nextView === "stats" ? "stats" : "main";
    renderFolderDetail();
  });
  $id("notes-folder-stats-view")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='set-notes-stats-section']");
    if (!target) return;
    const nextSection = normalizeNotesStatsSection(target.dataset.statsSection || "");
    if (nextSection === activeNotesStatsSection) return;
    activeNotesStatsSection = nextSection;
    renderFolderDetail();
  });
  $id("notes-folder-stats-view")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    if (target.dataset.act === "toggle-duplicate-group") {
      $id(`notes-duplicate-${target.dataset.titleKey}`)?.classList.toggle("hidden");
    }
    if (target.dataset.act === "open-note-from-stats") {
      const note = state.notes.find((row) => row.id === target.dataset.noteId);
      if (note) {
        if (note.type === "note" && normalizeNoteKind(note?.noteKind) !== "code") openNoteDetail(note);
        else openNoteModal(note);
      }
    }
    if (target.dataset.act === "open-map-note") {
      const note = state.notes.find((row) => row.id === target.dataset.noteId);
      if (note) {
        if (note.type === "note" && normalizeNoteKind(note?.noteKind) !== "code") openNoteDetail(note);
        else openNoteModal(note);
      }
    }
  });
  $id("notes-folder-stats-view")?.addEventListener("change", (event) => {
    const target = event.target.closest("[data-act='set-location-grouping']");
    if (!target) return;
    activeLocationGrouping = String(target.value || "country");
    renderFolderDetail();
  });
  $id("notes-note-location-suggestions")?.addEventListener("pointerdown", (event) => {
    const target = event.target.closest("[data-act='select-location-suggestion']");
    if (!target) return;
    event.preventDefault();
    event.stopPropagation();
    const data = JSON.parse(target.dataset.location || "{}");
    selectLocationSuggestion(data);
  });
  $id("notes-note-folder-select")?.addEventListener("change", (event) => {
    const folderId = String(event.target.value || "").trim();
    $id("notes-note-folder-id").value = folderId;
    $id("notes-note-form-error").textContent = "";
    populateNoteCategorySelector(folderId);
    populateNoteTagsSelector(folderId, { legacyTags: getCurrentNoteModalTags() });
  });

  $id("notes-folder-category-select")?.addEventListener("change", (event) => {
    if (event.target.value) {
      $id("notes-folder-category").value = event.target.value;
    }
  });

  $id("notes-folder-tags-select")?.addEventListener("change", (event) => {
    if (event.target.value) {
      const current = $id("notes-folder-tags").value.trim();
      const newTag = event.target.value;
      $id("notes-folder-tags").value = parseTagList(current ? `${current}, ${newTag}` : newTag).join(", ");
      event.target.value = "";
    }
  });

  $id("notes-note-category-select")?.addEventListener("change", (event) => {
    if (event.target.value) {
      $id("notes-note-category").value = event.target.value;
    }
  });

  $id("notes-note-tags-select")?.addEventListener("change", (event) => {
    if (event.target.value) {
      const current = $id("notes-note-tags").value.trim();
      const newTag = event.target.value;
      $id("notes-note-tags").value = parseTagList(current ? `${current}, ${newTag}` : newTag).join(", ");
      event.target.value = "";
      renderNoteTagImageEditor();
    }
  });

  $id("notes-search-folders")?.addEventListener("input", (event) => {
    state.folderQuery = event.target.value || "";
    renderRootFolders();
  });

  $id("notes-filter-category")?.addEventListener("change", (event) => {
    state.folderCategoryFilter = event.target.value || "";
    renderRootFolders();
  });

  $id("notes-filter-tags")?.addEventListener("change", (event) => {
    state.folderTagsFilter = event.target.value || "";
    renderRootFolders();
  });

  $id("notes-search-notes")?.addEventListener("input", (event) => {
    state.noteQuery = event.target.value || "";
    renderFolderDetail();
  });

  $id("notes-filter-note-category")?.addEventListener("change", (event) => {
    state.noteCategoryFilter = event.target.value || "";
    renderFolderDetail();
  });

  $id("notes-filter-note-tags")?.addEventListener("change", (event) => {
    state.noteTagsFilter = event.target.value || "";
    renderFolderDetail();
  });

  $id("notes-filter-note-country")?.addEventListener("change", (event) => {
    state.noteLocationFilters = {
      ...state.noteLocationFilters,
      country: event.target.value || "",
    };
    renderFolderDetail();
  });

  $id("notes-filter-note-region")?.addEventListener("change", (event) => {
    state.noteLocationFilters = {
      ...state.noteLocationFilters,
      region: event.target.value || "",
    };
    renderFolderDetail();
  });

  $id("notes-filter-note-city")?.addEventListener("change", (event) => {
    state.noteLocationFilters = {
      ...state.noteLocationFilters,
      city: event.target.value || "",
    };
    renderFolderDetail();
  });

  $id("notes-filter-note-address")?.addEventListener("change", (event) => {
    state.noteLocationFilters = {
      ...state.noteLocationFilters,
      address: event.target.value || "",
    };
    renderFolderDetail();
  });

  $id("notes-filter-note-sort")?.addEventListener("change", (event) => {
    state.noteSort = normalizeNoteSortOption(event.target.value || "");
    renderFolderDetail();
  });

  const handleFolderAction = async (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;

    const action = target.dataset.act;
    const folderId = target.dataset.folderId;
    const folder = state.folders.find((row) => row.id === folderId);
    if (!folder) return;

    if (action === "open-folder") {
      openFolder(folderId);
      return;
    }
    if (action === "edit-folder") {
      openFolderModal(folder);
      return;
    }
    if (action === "delete-folder") {
      await handleFolderDelete(folder);
    }
  };

  $id("notes-folder-list")?.addEventListener("click", handleFolderAction);
  $id("notes-subfolder-list")?.addEventListener("click", handleFolderAction);

  $id("notes-folder-breadcrumbs")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;

    if (target.dataset.act === "breadcrumb-root") {
      closeFolderView();
      return;
    }

    if (target.dataset.act === "open-breadcrumb") {
      openFolder(String(target.dataset.folderId || "").trim());
    }
  });

  $id("notes-detail-body")?.addEventListener("click", async (event) => {
    const externalLink = event.target.closest?.("a[data-external-link='true']");
    if (externalLink) {
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-act]");
    if (!target) return;

    if (target.dataset.act === "open-duplicate-note") {
      openDuplicateNoteReference(target.dataset.noteId || "", { closeNoteDetailFirst: true });
      return;
    }

    if (target.dataset.act === "dismiss-note-detail-duplicate-warning") {
      delete target.dataset.duplicateConfirmed;
      hideNoteDetailDuplicateWarning();
      setNoteDetailSaveFeedback("");
      return;
    }

    if (target.dataset.act === "confirm-save-person-detail") {
      const saveButton = $id("notes-detail-body")?.querySelector?.("[data-act='save-person-detail'][data-note-id]");
      if (!saveButton) return;
      const signature = String(saveButton.dataset.duplicateSignature || "").trim();
      if (signature) saveButton.dataset.duplicateConfirmed = signature;
      hideNoteDetailDuplicateWarning();
      saveButton.click();
      return;
    }

    if (target.dataset.act === "edit-note-detail") {
      const note = state.notes.find((row) => row.id === String(target.dataset.noteId || "").trim());
      if (note) {
        closeNoteDetail();
        openNoteModal(note);
      }
      return;
    }

    if (target.dataset.act === "open-related-note") {
      const note = state.notes.find((row) => row.id === String(target.dataset.noteId || "").trim());
      if (!note) return;
      if (note.type === "note" && normalizeNoteKind(note?.noteKind) !== "code") openNoteDetail(note);
      else openNoteModal(note);
      return;
    }

    if (target.dataset.act === "open-linked-note") {
      const note = state.notes.find((row) => row.id === String(target.dataset.linkedNoteId || "").trim());
      if (!note) return;
      if (note.type === "note" && normalizeNoteKind(note?.noteKind) !== "code") openNoteDetail(note);
      else openNoteModal(note);
      return;
    }

    if (target.dataset.act === "save-person-detail") {
      const note = state.notes.find((row) => row.id === String(target.dataset.noteId || "").trim());
      if (!note || !state.rootPath || noteDetailSaveInFlight) return;

      const firstName = normalizeNoteTextValue($id("notes-detail-person-first-name")?.value || "");
      const lastName = normalizeNoteTextValue($id("notes-detail-person-last-name")?.value || "");
      const nationality = normalizeNoteTextValue($id("notes-detail-person-nationality")?.value || "");
      const phone = String($id("notes-detail-person-phone")?.value || "").trim();
      const birthday = String($id("notes-detail-person-birthday")?.value || "").trim();
      const address = String($id("notes-detail-person-address")?.value || "").trim();
      const socials = String($id("notes-detail-person-socials")?.value || "").trim();

      if (!firstName) {
        setNoteDetailSaveFeedback("El nombre es obligatorio.", "error");
        return;
      }

      hideNoteDetailDuplicateWarning();
      const duplicateSignature = getDuplicateCheckSignature({
        noteId: note.id,
        title: firstName,
        firstName,
        lastName,
        phone,
      });
      const duplicateMatches = collectPotentialDuplicateNotes({
        noteId: note.id,
        title: firstName,
        firstName,
        lastName,
        phone,
      });
      const duplicateConfirmed = target.dataset.duplicateConfirmed === duplicateSignature;
      target.dataset.duplicateSignature = duplicateSignature;
      if (duplicateMatches.length && !duplicateConfirmed) {
        renderNoteDetailDuplicateWarning(duplicateMatches);
        setNoteDetailSaveFeedback("Revisa los posibles duplicados antes de guardar.", "error");
        return;
      }

      const currentTitle = normalizeNoteTextValue(note?.title || note?.name || "");
      const nextTitle = firstName || currentTitle || "Persona";
      const currentLocation = getNoteLocationDetails(note);
      const nextLocationAddress = address || String(note?.location?.label || currentLocation.address || "").trim();
      const normalizedLocation = normalizeLocationAddress({
        label: nextLocationAddress,
        country: currentLocation.country,
        region: currentLocation.region,
        province: currentLocation.province,
        city: currentLocation.city,
        municipality: currentLocation.municipality,
        postalCode: currentLocation.postalCode,
        exactAddress: nextLocationAddress,
        lat: currentLocation.lat,
        lng: currentLocation.lng,
        source: note?.location?.source || currentLocation.source || "manual",
      });
      const nextNote = {
        ...note,
        title: nextTitle,
        name: nextTitle,
        updatedAt: Date.now(),
        location: {
          ...note.location,
          ...normalizedLocation,
          text: normalizedLocation.label || note?.location?.text || "",
          coords: hasRealLocationCoordinates(normalizedLocation.lat, normalizedLocation.lng)
            ? { lat: normalizedLocation.lat, lng: normalizedLocation.lng }
            : (note?.location?.coords || null),
        },
        person: {
          ...note.person,
          firstName,
          lastName,
          nationality,
          phone,
          birthday,
          address,
          socials,
          notesEntries: getPersonNotesEntries(note),
        },
      };

      noteDetailSaveInFlight = true;
      delete target.dataset.duplicateConfirmed;
      setNoteDetailSaveFeedback("Guardando...");
      try {
        await updateNote(state.rootPath, note.id, nextNote);
        await syncPersonBirthdayReminder(note.id, nextNote, note);
        mergeNoteIntoState(nextNote);
        renderFolderDetail();
        renderNoteDetail();
        setNoteDetailSaveFeedback("Cambios guardados.", "success");
      } catch (error) {
        console.warn("[notes] no se pudo guardar el detalle de persona", error);
        setNoteDetailSaveFeedback("No se pudo guardar.", "error");
      } finally {
        noteDetailSaveInFlight = false;
      }
      return;
    }

    if (target.dataset.act === "add-person-note") {
      const note = state.notes.find((row) => row.id === String(target.dataset.noteId || "").trim());
      const input = $id("notes-person-note-input");
      const text = String(input?.value || "").trim();
      if (!note || !text || !state.rootPath) return;
      const entries = getPersonNotesEntries(note);
      const nextEntry = {
        id: createPersonNoteEntryId(),
        text,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await updateNote(state.rootPath, note.id, {
        ...note,
        person: {
          ...note.person,
          notesEntries: [nextEntry, ...entries],
        },
      });
      if (input) input.value = "";
      return;
    }

    if (target.dataset.act === "delete-person-note") {
      const note = state.notes.find((row) => row.id === String(target.dataset.noteId || "").trim());
      const entryId = String(target.dataset.entryId || "").trim();
      if (!note || !entryId || !state.rootPath) return;
      await updateNote(state.rootPath, note.id, {
        ...note,
        person: {
          ...note.person,
          notesEntries: getPersonNotesEntries(note).filter((entry) => entry.id !== entryId),
        },
      });
    }
  });

  $id("notes-cards-list")?.addEventListener("click", async (event) => {
    const externalLink = event.target.closest?.("a[data-external-link='true']");
    if (externalLink) {
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-act]");
    if (!target) {
      const card = event.target.closest(".notes-item-card[data-note-id]");
      if (!card) return;
      const noteId = String(card.dataset.noteId || "").trim();
      const note = state.notes.find((row) => row.id === noteId);
      if (!note) return;
      if (note.type === "note" && normalizeNoteKind(note?.noteKind) !== "code") {
        openNoteDetail(note);
      } else {
        openNoteModal(note);
      }
      return;
    }

    const action = target.dataset.act;
    if (action === "open-note-link") {
      event.preventDefault();
      event.stopPropagation();
      const noteId = String(target.dataset.noteId || "").trim();
      const note = state.notes.find((row) => row.id === noteId) || null;
      const opened = openExternalUrl(String(target.dataset.noteUrl || note?.url || ""));
      if (opened) {
        registerNoteVisit(note);
      }
      return;
    }

    if (action === "open-linked-note") {
      event.preventDefault();
      event.stopPropagation();
      const linkedNote = state.notes.find((row) => row.id === String(target.dataset.linkedNoteId || "").trim());
      if (linkedNote) {
        if (linkedNote.type === "note" && normalizeNoteKind(linkedNote?.noteKind) !== "code") openNoteDetail(linkedNote);
        else openNoteModal(linkedNote);
      }
      return;
    }

    const noteId = target.dataset.noteId;
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;

    if (action === "toggle-note-snippet") {
      event.preventDefault();
      event.stopPropagation();
      if (expandedSnippetNotes.has(note.id)) expandedSnippetNotes.delete(note.id);
      else expandedSnippetNotes.add(note.id);
      renderFolderDetail();
      return;
    }

    if (action === "copy-note-code") {
      event.preventDefault();
      event.stopPropagation();
      await handleCopyNoteCode(note, target);
      return;
    }

    if (action === "insert-snippet-suggestion") {
      event.preventDefault();
      event.stopPropagation();
      insertSnippetSuggestion(note, String(target.dataset.property || "").trim(), $id("notes-cards-list"));
      return;
    }

    if (action === "pick-snippet-color") {
      event.preventDefault();
      event.stopPropagation();
      const input = findSnippetColorInput(note.id, $id("notes-cards-list"));
      const editor = findSnippetEditor(note.id, $id("notes-cards-list"));
      const colors = detectSnippetColorMatches(String(editor?.value ?? note?.code ?? ""));
      const colorIndex = Number(target.dataset.colorIndex || -1);
      const selected = colors[colorIndex];
      if (!input || !selected) return;
      input.dataset.colorIndex = String(colorIndex);
      input.value = resolveCssColorToHex(selected.value) || "#ffffff";
      if (typeof input.showPicker === "function") input.showPicker();
      else input.click();
      return;
    }

    if (action === "save-note-code") {
      event.preventDefault();
      event.stopPropagation();
      await handleSaveNoteCode(note, target);
      return;
    }

    if (action === "edit-note") {
      openNoteModal(note);
      return;
    }
    if (action === "delete-note") {
      await handleNoteDelete(note);
    }
  });

  $id("notes-cards-list")?.addEventListener("keydown", (event) => {
    const toggleTarget = event.target?.closest?.('[data-act="toggle-note-snippet"]');
    if (!toggleTarget) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggleTarget.click();
  });

  $id("notes-cards-list")?.addEventListener("input", (event) => {
    const editor = event.target?.closest?.("[data-snippet-editor]");
    if (!editor) return;

    const noteId = String(editor.dataset.snippetEditor || "").trim();
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;

    syncSnippetCardState(note, $id("notes-cards-list"));
  });

  $id("notes-cards-list")?.addEventListener("keyup", (event) => {
    const editor = event.target?.closest?.("[data-snippet-editor]");
    if (!editor) return;
    const noteId = String(editor.dataset.snippetEditor || "").trim();
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;
    syncSnippetCardState(note, $id("notes-cards-list"));
  });

  $id("notes-cards-list")?.addEventListener("click", (event) => {
    const editor = event.target?.closest?.("[data-snippet-editor]");
    if (!editor) return;
    const noteId = String(editor.dataset.snippetEditor || "").trim();
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;
    syncSnippetCardState(note, $id("notes-cards-list"));
  });

  $id("notes-cards-list")?.addEventListener("scroll", (event) => {
    const editor = event.target?.closest?.("[data-snippet-editor]");
    if (!editor) return;
    const noteId = String(editor.dataset.snippetEditor || "").trim();
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;
    syncSnippetCardState(note, $id("notes-cards-list"));
  }, true);

  $id("notes-cards-list")?.addEventListener("change", (event) => {
    const input = event.target?.closest?.("[data-snippet-color-input]");
    if (!input) return;
    const noteId = String(input.dataset.snippetColorInput || "").trim();
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;
    replaceSnippetColor(note, Number(input.dataset.colorIndex || -1), input.value, $id("notes-cards-list"));
  });

  $id("notes-reminders-list")?.addEventListener("click", async (event) => {
    const externalLink = event.target.closest?.("a[data-external-link='true']");
    if (externalLink) {
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-act][data-reminder-id]");
    if (!target) return;
    const reminder = state.reminders.find((row) => row.id === String(target.dataset.reminderId || "").trim());
    if (!reminder) return;
    if (await handleReminderPrimaryAction(target.dataset.act, reminder)) return;
    if (target.dataset.act === "toggle-checklist-expand") {
      if (reminderExpandedChecklist.has(reminder.id)) reminderExpandedChecklist.delete(reminder.id);
      else reminderExpandedChecklist.add(reminder.id);
      renderRemindersPanel();
      return;
    }
    if (target.dataset.act === "toggle-checklist-item") {
      const toggleTarget = event.target.closest('[data-act="toggle-checklist-item"]');
      if (!toggleTarget) return;
      event.preventDefault();
      const snapshot = getReminderScrollState();
      const itemId = String(toggleTarget.dataset.itemId || "").trim();
      const item = reminder?.checklistItems?.[itemId];
      if (!item) return;
      const key = `${reminder.id}:${itemId}`;
      const version = Number(reminderChecklistToggleVersion.get(key) || 0) + 1;
      const previousReminder = cloneReminderForLocalState(reminder);
      const done = !Boolean(item.done);
      reminderChecklistToggleVersion.set(key, version);
      paintReminderChecklistToggle(toggleTarget, done);
      const nextReminder = applyReminderChecklistToggle(reminder.id, itemId, done);
      if (!nextReminder) {
        paintReminderChecklistToggle(toggleTarget, Boolean(item.done));
        return;
      }
      queueReminderRemoteRestore(snapshot);
      renderRemindersPanel();
      restoreReminderScrollState(snapshot);
      queueReminderChecklistTogglePersist(reminder.id, itemId, nextReminder, previousReminder, version).catch(() => {});
      return;
    }
    if (target.dataset.act === "add-checklist-item") {
      const input = document.querySelector(`[data-checklist-input='${CSS.escape(reminder.id)}']`);
      const text = String(input?.value || "").trim();
      if (!text) return;
      const itemId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const now = Date.now();
      const snapshot = getReminderScrollState();
      const nextReminder = appendReminderChecklistItemLocal(reminder.id, {
        id: itemId,
        text,
        done: false,
        createdAt: now,
        completedAt: 0,
        order: now,
      });
      queueReminderRemoteRestore(snapshot);
      if (input) input.value = "";
      renderRemindersPanel();
      restoreReminderScrollState(snapshot);
      if (!nextReminder) return;
      await patchReminderChecklistItem(state.rootPath, reminder.id, itemId, {
        id: itemId, text, done: false, createdAt: now, completedAt: 0, order: now,
      });
      await updateReminder(state.rootPath, reminder.id, nextReminder);
      return;
    }
    if (target.dataset.act === "delete-checklist-item") {
      const snapshot = getReminderScrollState();
      const itemId = String(target.dataset.itemId || "").trim();
      if (!itemId) return;
      const nextReminder = removeReminderChecklistItemLocal(reminder.id, itemId);
      queueReminderRemoteRestore(snapshot);
      renderRemindersPanel();
      restoreReminderScrollState(snapshot);
      if (!nextReminder) return;
      await updateReminder(state.rootPath, reminder.id, nextReminder);
      return;
    }
    if (target.dataset.act === "delete-reminder") {
      if (window.confirm(`¿Eliminar recordatorio "${reminder.title}"?`)) {
        await deleteReminder(state.rootPath, reminder.id);
      }
    }
  });
  $id("notes-reminders-history-list")?.addEventListener("click", async (event) => {
    const externalLink = event.target.closest?.("a[data-external-link='true']");
    if (externalLink) {
      event.stopPropagation();
      return;
    }
    const target = event.target.closest("[data-act][data-reminder-id]");
    if (!target) return;
    const reminder = state.reminders.find((row) => row.id === String(target.dataset.reminderId || "").trim());
    if (!reminder) return;
    if (await handleReminderPrimaryAction(target.dataset.act, reminder)) return;
    if (target.dataset.act === "delete-reminder" && window.confirm(`¿Eliminar recordatorio "${reminder.title}"?`)) {
      await deleteReminder(state.rootPath, reminder.id);
    }
  });

  $id("notes-reminder-alert-add")?.addEventListener("click", () => {
    const amount = Math.max(1, Math.round(Number($id("notes-reminder-alert-amount")?.value || 0)));
    const unit = String($id("notes-reminder-alert-unit")?.value || "");
    if (!amount || !["minutes", "hours", "days"].includes(unit)) return;
    reminderDraftAlerts.push({ amount, unit });
    $id("notes-reminder-alert-amount").value = "";
    renderReminderAlertDrafts();
  });
  $id("notes-reminder-alert-list")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='remove-reminder-alert']");
    if (!target) return;
    const index = Number(target.dataset.alertIndex || -1);
    if (index < 0) return;
    reminderDraftAlerts.splice(index, 1);
    renderReminderAlertDrafts();
  });
  $id("notes-reminder-categories")?.addEventListener("change", (event) => {
    const selected = String(event.target.value || "").trim();
    reminderDraftCategories = selected ? [selected] : [];
  });
  $id("notes-reminder-color-palette")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='set-reminder-color'][data-color]");
    if (!target) return;
    const color = normalizeReminderColor(target.dataset.color || DEFAULT_REMINDER_COLOR);
    if ($id("notes-reminder-color")) $id("notes-reminder-color").value = color;
    renderReminderColorPalette(color);
  });
  $id("notes-reminder-category-create")?.addEventListener("click", async () => {
    const name = String($id("notes-reminder-category-new")?.value || "").trim();
    if (!name || !state.rootPath) return;
    const existing = (state.reminderCategories || []).find((row) => row.name.localeCompare(name, "es", { sensitivity: "base" }) === 0);
    if (existing) {
      reminderDraftCategories = [existing.name];
      if ($id("notes-reminder-category-new")) $id("notes-reminder-category-new").value = "";
      renderReminderCategoryDrafts();
      return;
    }
    const categoryId = `cat_${name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, "_").replace(/[^\w-]/g, "")}`;
    await upsertReminderCategory(state.rootPath, categoryId, { id: categoryId, name, createdAt: Date.now() });
    reminderDraftCategories = [name];
    if ($id("notes-reminder-category-new")) $id("notes-reminder-category-new").value = "";
    renderReminderCategoryDrafts();
  });
  $id("notes-reminder-is-birthday")?.addEventListener("change", (event) => {
    if (event.target.checked) {
      $id("notes-reminder-type").value = "cumpleaños";
      $id("notes-reminder-repeat-yearly").checked = true;
    }
  });
  $id("notes-reminder-type")?.addEventListener("change", (event) => {
    $id("notes-reminder-checklist-wrap")?.classList.toggle("hidden", event.target.value !== "checklist");
    if (event.target.value === "cumpleaños") {
      $id("notes-reminder-is-birthday").checked = true;
      $id("notes-reminder-repeat-yearly").checked = true;
    }
  });
  $id("notes-reminder-checklist-add")?.addEventListener("click", () => {
    const input = $id("notes-reminder-checklist-new");
    const text = String(input?.value || "").trim();
    if (!text) return;
    const id = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    reminderDraftChecklistItems[id] = { id, text, done: false, createdAt: Date.now(), completedAt: 0, order: Date.now() };
    if (input) input.value = "";
    renderReminderChecklistDrafts();
  });
  $id("notes-reminder-checklist-list")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act][data-item-id]");
    if (!target) return;
    const itemId = String(target.dataset.itemId || "").trim();
    if (!itemId || !reminderDraftChecklistItems[itemId]) return;
    if (target.dataset.act === "delete-draft-checklist-item") {
      delete reminderDraftChecklistItems[itemId];
      renderReminderChecklistDrafts();
    }
  });
  $id("notes-reminder-checklist-list")?.addEventListener("change", (event) => {
    const target = event.target.closest("[data-act][data-item-id]");
    if (!target) return;
    const itemId = String(target.dataset.itemId || "").trim();
    const item = reminderDraftChecklistItems[itemId];
    if (!item) return;
    if (target.dataset.act === "toggle-draft-checklist-item") {
      item.done = Boolean(target.checked);
      item.completedAt = item.done ? Date.now() : 0;
    }
    if (target.dataset.act === "edit-draft-checklist-item") {
      item.text = String(target.value || "").trim();
    }
  });
  $id("notes-reminder-delete")?.addEventListener("click", async () => {
    const reminderId = String($id("notes-reminder-id").value || "").trim();
    if (!reminderId) return;
    if (!window.confirm("¿Eliminar este recordatorio?")) return;
    await deleteReminder(state.rootPath, reminderId);
    closeReminderModal();
  });
  $id("notes-reminder-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = String($id("notes-reminder-id").value || "").trim();
    const title = String($id("notes-reminder-title").value || "").trim();
    const description = String($id("notes-reminder-description").value || "").trim();
    const emoji = String($id("notes-reminder-emoji").value || "⏰").trim() || "⏰";
    const type = String($id("notes-reminder-type").value || "normal");
    const targetDate = String($id("notes-reminder-date").value || "").trim();
    const targetTime = String($id("notes-reminder-time").value || "").trim();
    const color = normalizeReminderColor($id("notes-reminder-color")?.value || DEFAULT_REMINDER_COLOR);
    const isBirthday = Boolean($id("notes-reminder-is-birthday").checked) || type === "cumpleaños";
    const repeat = $id("notes-reminder-repeat-yearly").checked ? "yearly" : "none";
    const errorField = $id("notes-reminder-form-error");
    errorField.textContent = "";
    if (!state.rootPath || !state.uid) {
      errorField.textContent = "Espera a que cargue tu espacio de notas.";
      return;
    }
    if (!title || !targetDate) {
      errorField.textContent = "Título y fecha son obligatorios.";
      return;
    }
    const current = state.reminders.find((row) => row.id === id);
    const checklistItems = type === "checklist" ? reminderDraftChecklistItems : {};
    const checklistRows = Object.values(checklistItems || {});
    const checklistAllDone = checklistRows.length > 0 && checklistRows.every((item) => item.done);
    const payload = {
      title,
      description,
      emoji,
      type: isBirthday ? "cumpleaños" : type,
      targetDate,
      targetTime,
      color,
      status: checklistAllDone ? "completado" : (current?.status === "completado" ? "completado" : "pendiente"),
      categories: reminderDraftCategories,
      remindBefore: reminderDraftAlerts,
      checklistItems,
      repeat: isBirthday ? "yearly" : repeat,
      createdAt: current?.createdAt || Date.now(),
      updatedAt: Date.now(),
      completedAt: checklistAllDone ? Date.now() : (current?.completedAt || 0),
      dismissedAlerts: current?.dismissedAlerts || [],
      notifiedAt: 0,
    };
    try {
      if (id) await updateReminder(state.rootPath, id, payload);
      else await createReminder(state.rootPath, payload);
      closeReminderModal();
      runReminderChecks();
    } catch (error) {
      console.warn("[notes] no se pudo guardar el recordatorio", error);
      errorField.textContent = "No se ha podido guardar el recordatorio.";
    }
  });
  $id("notes-reminder-modal-close")?.addEventListener("click", closeReminderModal);
  $id("notes-reminder-modal-backdrop")?.addEventListener("click", (event) => {
    if (event.target === $id("notes-reminder-modal-backdrop")) closeReminderModal();
  });

  bindFolderModalEvents();
  bindNoteModalEvents();
  bindPinModalEvents();
}

function subscribeData(uid) {
  unbindData?.();
  if (!uid) {
    state.uid = "";
    state.rootPath = "";
    state.folders = [];
    state.notes = [];
    state.reminders = [];
    state.reminderCategories = [];
    state.reminderPreferences = {};
    state.tagDefinitions = {};
    state.folderView = "main";
    setCurrentFolder("");
    state.unlockedFolderIds = new Set();
    clearNoteTagImageDrafts();
    renderShell();
    return;
  }

  const { rootPath, unsubscribe } = subscribeNotesRoot(
    uid,
    (payload, safeRootPath) => {
      state.loading = false;
      state.rootPath = safeRootPath;
      state.folders = payload.folders;
      state.notes = payload.notes;
      state.reminders = payload.reminders || [];
      state.reminderCategories = payload.reminderCategories || [];
      state.reminderPreferences = payload.reminderPreferences || {};
      if (state.reminderPreferences && !state._reminderPrefsApplied) {
        state.reminderGroupBy = normalizeReminderGroupBy(
          state.reminderPreferences.groupBy || state.reminderPreferences.grouping || "none",
        );
        state.reminderFilters.types = normalizeReminderMultiSelection(state.reminderPreferences.visibleTypes, REMINDER_TYPES);
        state.reminderFilters.categories = normalizeReminderMultiSelection(state.reminderPreferences.visibleCategories);
        state.reminderFilters.statuses = normalizeReminderMultiSelection(
          state.reminderPreferences.visibleStatuses || (state.reminderPreferences.visibleStatus ? [state.reminderPreferences.visibleStatus] : []),
          REMINDER_STATUSES,
        );
        state.reminderFilters.range = normalizeReminderRange(
          state.reminderPreferences.range || state.reminderPreferences.visibleRange || "all",
        );
        state._reminderPrefsApplied = true;
      }
      state.tagDefinitions = payload.tagDefinitions || {};
      state.unlockedFolderIds = new Set(
        Array.from(state.unlockedFolderIds).filter((folderId) => state.folders.some((folder) => folder.id === folderId)),
      );

      if (state.selectedFolderId && !state.folders.some((folder) => folder.id === state.selectedFolderId)) {
        setCurrentFolder("");
      }

      renderShell();
      flushReminderRemoteRestore();
      renderNoteTagImageEditor();
      runReminderChecks();
      emitNotesData("remote:notes");
    },
    (error) => {
      console.warn("[notes] error de carga", error);
    },
  );

  state.rootPath = rootPath;
  unbindData = unsubscribe;
}

function bindAuth() {
  if (unbindAuth) return;
  unbindAuth = onUserChange((user) => {
    const uid = user?.uid || "";
    state.uid = uid;
    subscribeData(uid);
  });
}

export async function onShow() {
  bindUiEvents();
  bindAuth();
  startReminderChecker();
  renderShell();
  window.__bookshellNotes = {
    openGlobalNoteModal,
    openNoteModal: (note = null, options = {}) => openNoteModal(note, options),
    openNoteDetail: (note = null) => openNoteDetail(note),
    getConnectionsData: () => buildNotesConnectionGraphData(state.notes || []),
    getAchievementsSnapshot: () => ({
      folders: Object.fromEntries((state.folders || []).map((folder) => [folder.id, folder])),
      notes: Object.fromEntries((state.notes || []).map((note) => [note.id, note])),
      tagDefinitions: Object.fromEntries(listTagDefinitions().map((tagDefinition) => [tagDefinition.key, tagDefinition])),
    }),
    getReminderNotifications: () => getReminderNotificationItems(),
    openReminderNotificationsPanel: () => {
      reminderNotificationsOpen = !reminderNotificationsOpen;
      const panelId = "notifications-panel";
      let panel = document.getElementById(panelId);
      if (!panel) {
        panel = document.createElement("div");
        panel.id = panelId;
        panel.className = "modal-backdrop";
        document.body.appendChild(panel);
      }
      if (!reminderNotificationsOpen) {
        panel.classList.add("hidden");
        return;
      }
      const items = getReminderNotificationItems();
      panel.classList.remove("hidden");
      panel.innerHTML = `<section class="modal"><header class="modal-header"><div class="modal-title">Notificaciones</div><button class="icon-btn" data-close-notifications>✕</button></header><div class="modal-body" id="lista-de-notificaciones" >${items.map((item) => `<button class="btn ghost" id="notificaciones"  data-open-reminder-notification="${escapeHtml(item.id)}">${escapeHtml(item.title)} ${item.targetTime ? `· ${escapeHtml(item.targetTime)}` : ""} · ${escapeHtml(item.status)}</button>`).join("") || "<p>Sin notificaciones para hoy.</p>"}</div></section>`;
      panel.addEventListener("click", async (event) => {
        if (event.target === panel || event.target.closest("[data-close-notifications]")) {
          reminderNotificationsOpen = false;
          panel.classList.add("hidden");
          return;
        }
        const button = event.target.closest("[data-open-reminder-notification]");
        if (button) {
          await navigateToReminder(button.dataset.openReminderNotification || "");
          reminderNotificationsOpen = false;
          panel.classList.add("hidden");
        }
      });
    },
  };
}

export function destroy() {
  unbindData?.();
  unbindData = null;
  unbindAuth?.();
  unbindAuth = null;
  isBound = false;
  state.rootSection = "notes";
  state.reminderFilters = { types: [], categories: [], statuses: [], range: "all" };
  state.reminderGroupBy = "none";
  state.reminderCollapsedHistory = true;
  state.reminderView = loadReminderViewPreference();
  state.reminderCalendarMonthKey = getCurrentMonthKey();
  state.reminderCalendarSelectedDate = getTodayDateKey();
  state.reminderCalendarFocusedReminderId = "";
  state.reminderActiveFilterMode = "allPending";
  state.reminderActiveFilterDate = "";
  state.folderView = "main";
  state._reminderPrefsApplied = false;
  setCurrentFolder("");
  state.unlockedFolderIds = new Set();
  clearNotePhotoObjectUrl();
  clearNoteTagImageDrafts();
  closeLocationMapModal();
  try {
    notesLocationReverseAbort?.abort?.();
  } catch (_) {}
  notesLocationReverseAbort = null;
  destroyLeafletMap($id("notes-location-map-host"));
  noteLocationMapState.map = null;
  noteLocationMapState.marker = null;
  noteLocationMapState.leaflet = null;
  noteLocationMapState.selection = null;
  noteLocationMapState.tileErrorBound = false;
  noteLocationMapState.mapClickBound = false;
  notePhotoRemove = false;
  noteSaveInFlight = false;
  reminderDraftAlerts = [];
  reminderDraftCategories = [];
  reminderDraftChecklistItems = {};
  stopReminderChecker();
  if (window.__bookshellNotes) {
    delete window.__bookshellNotes;
  }
}
const filtersDropdown = document.querySelector('.notes-filters-dropdown');
const filtersToggle = document.querySelector('[data-notes-toggle-filters]');
const filtersPanel = document.querySelector('.notes-filters-dropdown__panel');

filtersToggle?.addEventListener('click', () => {
  const isOpen = filtersDropdown.classList.toggle('is-open');

  filtersPanel.hidden = !isOpen;
  filtersToggle.setAttribute('aria-expanded', String(isOpen));
});
