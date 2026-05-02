import { onUserChange } from "../../shared/firebase/index.js";
import {
  buildFolderInsights,
  buildFolderOptions,
  buildFolderStats,
  createInitialNotesState,
  filterFolders,
  filterNotesByFolder,
  getChildFolders,
  getFolderPath,
  isFolderParentAllowed,
  sortNotes,
} from "./domain/store.js?v=2026-04-28-v2";
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
} from "./persist/notes-datasource.js?v=2026-04-28-v2";
import {
  deleteNoteImageAsset,
  deleteNoteTagImageAsset,
  downscaleNoteImageFile,
  uploadNoteImageAsset,
  uploadNoteTagImageAsset,
} from "./persist/notes-storage.js?v=2026-04-28-v2";
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
const state = {
  ...createInitialNotesState(),
  reminderView: loadReminderViewPreference(),
  reminderCalendarMonthKey: getCurrentMonthKey(),
  reminderCalendarSelectedDate: getTodayDateKey(),
  reminderCalendarFocusedReminderId: "",
};
let unbindAuth = null;
let unbindData = null;
let isBound = false;
let notePhotoObjectUrl = null;
let notePhotoRemove = false;
let noteSaveInFlight = false;
let noteTagImageDrafts = new Map();
let activeNoteTagImageKey = "";
let noteSelectedTagImageKey = "";
let activeNotesStatsSection = "ratings";
let reminderDraftAlerts = [];
let reminderDraftCategories = [];
let reminderDraftChecklistItems = {};
let reminderCheckTimer = null;
let reminderToastQueue = [];
let reminderToastActive = null;
let reminderNotificationsOpen = false;
const reminderExpandedChecklist = new Set();
const expandedSnippetNotes = new Set();
const REMINDER_TYPES = ["normal", "cumpleaños", "tarea", "evento", "trámite", "checklist", "personalizado"];
const REMINDER_STATUSES = ["pendiente", "completado", "vencido"];
const REMINDER_RANGES = ["all", "today", "7d", "30d", "overdue"];
const REMINDER_GROUP_BY = ["none", "category", "type", "date", "status"];
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
  return ["ratings", "tags", "notes"].includes(safeSection) ? safeSection : "ratings";
}

function normalizeNoteSortOption(sort = "") {
  const safeSort = String(sort || "").trim();
  return ["updated", "rating", "visits"].includes(safeSort) ? safeSort : "updated";
}

function normalizeRootSection(section = "") {
  return String(section || "").trim() === "reminders" ? "reminders" : "notes";
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

  activeNotesStatsSection = normalizeNotesStatsSection(activeNotesStatsSection);
  grid.innerHTML = buildActiveStatsCardMarkup(insights, averageRatingLabel, activeNotesStatsSection);
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
  return String(value || "").trim().toLowerCase() === "code" ? "code" : "text";
}

function normalizeCodeLanguage(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["css", "html", "js", "general"].includes(safe) ? safe : "general";
}

function formatNumber(value = 0) {
  return NUMBER_FORMATTER.format(Number(value || 0));
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
  $id("meta-notas-note")?.classList.toggle("hidden", !isLink);
  document.querySelector(".notes-rating-field")?.classList.toggle("hidden", !isLink);
}

function updateNoteEditorMode(nextKind = "text") {
  const noteKind = normalizeNoteKind(nextKind);
  const isCode = noteKind === "code";
  const isLink = !isCode && Boolean($id("notes-note-is-link")?.checked);

  if ($id("notes-note-kind")) $id("notes-note-kind").value = noteKind;
  $id("notes-note-content-wrap")?.classList.toggle("hidden", isCode);
  $id("notes-note-code-wrap")?.classList.toggle("hidden", !isCode);
  $id("notes-note-link-toggle-wrap")?.classList.toggle("hidden", isCode);

  if (isCode && $id("notes-note-is-link")) {
    $id("notes-note-is-link").checked = false;
  }

  updateNoteLinkDependentFields(isLink);
  syncNoteModalCodeAssist();
}

function getCurrentFolder() {
  return state.folders.find((folder) => folder.id === state.selectedFolderId) || null;
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

function notePreview(note) {
  if (normalizeNoteKind(note?.noteKind) === "code") return "";
  return note.content || "";
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
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
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
  if ($id("notes-search-notes")) $id("notes-search-notes").value = "";
  if ($id("notes-filter-note-category")) $id("notes-filter-note-category").value = "";
  if ($id("notes-filter-note-tags")) $id("notes-filter-note-tags").value = "";
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
    const noteImageUrl = isCodeNote ? "" : buildNoteImageRenderUrl(note);
    const tagPreview = resolveNoteTagPreview(note);
    const externalUrl = normalizeExternalUrl(note.url);
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
    const mediaMarkup = isCodeNote
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
        `);

    const cardClass = [
      "notes-item-card",
      noteImageUrl ? "has-note-image" : "",
      isCodeNote ? "is-code-note" : "",
    ].filter(Boolean).join(" ");
    const cardStyle = buildNoteCardStyleAttribute(note);
    const ratingMarkup = buildRatingBadgeMarkup(note?.rating);
    const visitsMarkup = buildVisitsBadgeMarkup(note);
    const codeKindMarkup = isCodeNote
      ? `<span class="notes-item-kind-badge">${escapeHtml(buildCodeLanguageBadgeLabel(note?.codeLanguage))}</span>`
      : "";
    const metaMarkup = [codeKindMarkup, ratingMarkup, visitsMarkup].filter(Boolean).join("");
    const snippetMarkup = buildSnippetMarkup(note);
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
            <h4 class="notes-item-title">${escapeHtml(note.title || "Sin título")}</h4>
            ${metaMarkup ? `<div class="notes-item-meta">${metaMarkup}</div>` : ""}
          </div>
          ${preview && !isCodeNote ? `<p class="notes-item-preview">${escapeHtml(preview)}</p>` : ""}
          ${isCodeNote ? snippetMarkup : linkMarkup}
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

  const childFolders = getChildFolders(foldersWithStats, folder.id);
  const allNotes = filterNotesByFolder(state.notes, folder.id);
  const visibleNotes = sortNotes(filterNotesByFolder(
    state.notes,
    folder.id,
    state.noteQuery,
    state.noteCategoryFilter,
    state.noteTagsFilter,
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

function getReminderChecklistSummary(reminder) {
  const items = Object.values(reminder?.checklistItems || {}).sort((a, b) => Number(a.order || 0) - Number(b.order || 0));
  const total = items.length;
  const done = items.filter((item) => item.done).length;
  return { items, total, done };
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
    return `
      <article class="notes-reminder-item is-${escapeHtml(computedStatus)}" data-reminder-id="${escapeHtml(reminder.id)}" style="${escapeHtml(accentStyle)}">
        <div class="notes-reminder-main">
          <button class="notes-reminder-title-row ${isChecklist ? "is-checklist-toggle" : ""}" ${isChecklist ? `data-act="toggle-checklist-expand" data-reminder-id="${escapeHtml(reminder.id)}"` : ""}>
            <span class="notes-reminder-emoji">${escapeHtml(reminder?.emoji || "⏰")}</span>
            <strong class="notes-reminder-title">${escapeHtml(reminder?.title || "Sin título")}</strong>
            ${isChecklist ? `<span class="notes-reminder-expand-hint">${isExpanded ? "▾" : "▸"}</span>` : ""}
          </button>
          <div class="notes-reminder-meta">${escapeHtml(dateLabel)} · ${escapeHtml(reminder?.type || "normal")} · ${escapeHtml(computedStatus)}</div>
          ${categories.length ? `<div class="notes-reminder-categories">${categories.map((category) => `<span class="notes-reminder-chip">${escapeHtml(category)}</span>`).join("")}</div>` : ""}
          <div class="notes-reminder-countdown">${escapeHtml(isBirthday ? birthdayLead : countdown)}</div>
          ${isChecklist ? `
            <div class="notes-reminder-checklist-progress">${checklist.done}/${checklist.total} completados</div>
            <div class="notes-reminder-progress"><span style="width:${progress}%;"></span></div>
            <div class="notes-reminder-checklist-items ${isExpanded ? "" : "hidden"}">
              ${visibleItems.map((item) => `
                <label class="notes-reminder-check-item ${item.done ? "is-done" : ""}">
                  <input type="checkbox" data-act="toggle-checklist-item" data-reminder-id="${escapeHtml(reminder.id)}" data-item-id="${escapeHtml(item.id)}" ${item.done ? "checked" : ""} />
                  <span>${escapeHtml(item.text)}</span>
                  <button class="notes-icon-action notes-checklist-delete-inline" type="button" data-act="delete-checklist-item" data-reminder-id="${escapeHtml(reminder.id)}" data-item-id="${escapeHtml(item.id)}">×</button>
                </label>
              `).join("")}
              <div class="notes-reminder-inline-add">
                <input type="text" id="notes-reminder-checklist-new"   placeholder="Nuevo checkpoint..." data-checklist-input="${escapeHtml(reminder.id)}" />
                <button class="notes-icon-action" type="button" data-act="add-checklist-item" data-reminder-id="${escapeHtml(reminder.id)}">+</button>
              </div>
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
              <article class="notes-reminders-calendar-panel__item is-${escapeHtml(computedStatus)}" style="${escapeHtml(accentStyle)}">
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
        <div class="${classes}" data-date-key="${escapeHtml(cell.dateKey)}">
          <button class="notes-reminders-calendar__dayButton" type="button" data-act="select-reminder-calendar-day" data-date-key="${escapeHtml(cell.dateKey)}" aria-pressed="${cell.dateKey === selectedDateKey ? "true" : "false"}">
            <span class="notes-reminders-calendar__dayNumber">${escapeHtml(String(cell.dayNumber))}</span>
          </button>
          <div class="notes-reminders-calendar__dots">
            ${visibleDots.map((reminder) => `
              <button
                class="notes-reminders-calendar__dot"
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
  const active = filtered.filter((item) => getReminderComputedStatus(item) === "pendiente");
  const history = filtered.filter((item) => getReminderComputedStatus(item) !== "pendiente");
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
  empty.classList.toggle("hidden", active.length > 0 || history.length > 0);
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
  renderRemindersPanel();
}

function openFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;
  state.rootSection = "notes";

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
  setCurrentFolder("");
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
}

function updateFilterOptionsForNotes() {
  const folder = getCurrentFolder();

  const categorySelect = $id("notes-filter-note-category");
  const tagsSelect = $id("notes-filter-note-tags");

  if (!folder) {
    if (categorySelect) categorySelect.innerHTML = '<option value="">Categoría: Todas</option>';
    if (tagsSelect) tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
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

function populateNoteTagsSelector(folderId = state.selectedFolderId) {
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

  select.innerHTML = '<option value="">-- Seleccionar o escribir --</option>';
  collectTagLabels(Array.from(tags), listTagDefinitions().map((tagDefinition) => tagDefinition.label)).forEach((tag) => {
    const option = document.createElement("option");
    option.value = tag;
    option.textContent = tag;
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

function syncNoteFolderSelection(folderId = "", { allowFolderSelection = false } = {}) {
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
  populateNoteTagsSelector(safeFolderId);
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
  clearNoteTagImageDrafts();
  notePhotoRemove = false;
  if ($id("notes-note-image-file")) $id("notes-note-image-file").value = "";
  if ($id("notes-note-tag-image-file")) $id("notes-note-tag-image-file").value = "";
  setNotePhotoStatus("");
  closeModal("notes-note-modal-backdrop");
}

function openNoteModal(note = null, options = {}) {
  const folderId = String(note?.folderId || options.folderId || state.selectedFolderId || "").trim();
  const allowFolderSelection = Boolean(options.allowFolderSelection)
    || !folderId
    || (!note && getChildFolders(state.folders, folderId).length > 0);
  syncNoteFolderSelection(folderId, { allowFolderSelection });

  notePhotoRemove = false;
  clearNotePhotoObjectUrl();
  clearNoteTagImageDrafts();
  noteSelectedTagImageKey = buildTagDefinitionKey(note?.tagImageKey);
  if ($id("notes-note-image-file")) $id("notes-note-image-file").value = "";
  if ($id("notes-note-tag-image-file")) $id("notes-note-tag-image-file").value = "";
  setNotePhotoPreview(buildNoteImageRenderUrl(note));
  setNotePhotoStatus("");

  $id("notes-note-id").value = note?.id || "";
  $id("notes-note-folder-id").value = folderId || "";
  $id("notes-note-title").value = note?.title || "";
  $id("notes-note-content").value = note?.content || "";
  $id("notes-note-kind").value = normalizeNoteKind(note?.noteKind);
  $id("notes-note-code").value = note?.code || "";
  $id("notes-note-code-language").value = normalizeCodeLanguage(note?.codeLanguage);
  $id("notes-note-preview-html").value = note?.previewHtml || "";
  $id("notes-note-category").value = note?.category || "";
  $id("notes-note-category-select").value = note?.category || "";
  $id("notes-note-tags").value = (note?.tags || []).join(", ");
  $id("notes-note-tags-select").value = "";
  $id("notes-note-rating").value = note?.rating === null || note?.rating === undefined ? "" : String(note.rating);
  $id("notes-note-is-link").checked = note?.type === "link";
  $id("notes-note-url").value = note?.url || "";
  updateNoteEditorMode(note?.noteKind);
  $id("notes-note-form-error").textContent = "";
  $id("notes-note-modal-title").textContent = note ? "Editar nota" : "Nueva nota";
  updateNoteRatingPreview();
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

function openReminderModal(reminder = null) {
  reminderDraftAlerts = Array.isArray(reminder?.remindBefore) ? [...reminder.remindBefore] : [];
  reminderDraftCategories = Array.isArray(reminder?.categories) ? [String(reminder.categories[0] || "").trim()].filter(Boolean) : [];
  reminderDraftChecklistItems = { ...(reminder?.checklistItems || {}) };
  $id("notes-reminder-id").value = reminder?.id || "";
  $id("notes-reminder-title").value = reminder?.title || "";
  $id("notes-reminder-description").value = reminder?.description || "";
  $id("notes-reminder-emoji").value = reminder?.emoji || "⏰";
  $id("notes-reminder-type").value = reminder?.type || "normal";
  $id("notes-reminder-date").value = reminder?.targetDate || "";
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
    await updateReminder(state.rootPath, reminder.id, { ...reminder, status: "completado", completedAt: Date.now() });
    return true;
  }
  if (action === "delete-reminder") {
    if (window.confirm(`Â¿Eliminar recordatorio "${reminder.title}"?`)) {
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
        appendReminderToast(`${prefix} Quedan ${alert.amount} ${label} para ${noun}: ${reminder.title || "sin título"}`, reminder.id, key);
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
  if (!window.confirm(`¿Borrar nota "${note.title || "sin título"}"?`)) return;

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
  const tagImageInput = $id("notes-note-tag-image-file");
  const tagsTextInput = $id("notes-note-tags");
  const ratingSelect = $id("notes-note-rating");
  const noteKindSelect = $id("notes-note-kind");
  const codeLanguageSelect = $id("notes-note-code-language");
  const codeEditor = $id("notes-note-code");
  const codeShell = $id("notes-note-code-editor-shell");
  const codeColorInput = $id("notes-note-code-color-input");

  isLinkInput?.addEventListener("change", () => {
    updateNoteLinkDependentFields(isLinkInput.checked);
  });

  noteKindSelect?.addEventListener("change", (event) => {
    updateNoteEditorMode(event.target?.value);
    $id("notes-note-form-error").textContent = "";
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

  $id("notes-note-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (noteSaveInFlight) return;

    const id = String($id("notes-note-id").value || "").trim();
    const folderId = String(
      $id("notes-note-folder-select")?.value
      || $id("notes-note-folder-id")?.value
      || "",
    ).trim();
    const title = $id("notes-note-title").value.trim();
    const noteKind = normalizeNoteKind($id("notes-note-kind")?.value);
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
    const errorField = $id("notes-note-form-error");
    const submitButton = $id("notes-note-form")?.querySelector?.("button[type='submit']");
    const previousSubmitText = submitButton?.textContent || "Guardar";
    const current = state.notes.find((row) => row.id === id) || null;
    let noteId = id;
    const selectedFile = imageInput?.files?.[0] || null;
    const hasTagImageChanges = Array.from(noteTagImageDrafts.values()).some((draft) => draft?.file instanceof File || draft?.remove);
    let uploadedImagePath = "";

    errorField.textContent = "";

    if (!state.rootPath || !state.uid) {
      errorField.textContent = "Espera un momento a que se cargue tu espacio de notas.";
      return;
    }
    if (!title) return;
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

    const payload = {
      folderId,
      title,
      content: noteKind === "code" ? "" : content,
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
      tagImageKey: "",
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

      const folder = state.folders.find((row) => row.id === folderId);
      closeNoteModal();
      if (folderId) {
        const canOpenFolder = !folder?.isPrivate || requireUnlockedFolder(folder) || state.selectedFolderId === folderId;
        setCurrentFolder(canOpenFolder ? folderId : "");
      }
      renderShell();
    } catch (error) {
      console.warn("[notes] no se pudo guardar la nota", error);
      errorField.textContent = (selectedFile || hasTagImageChanges)
        ? "No se ha podido subir alguna imagen o guardar la nota."
        : "No se ha podido guardar la nota.";
      if (selectedFile) setNotePhotoStatus("Ha fallado la subida de la foto.", "error");
      if (!id && uploadedImagePath) {
        try {
          await deleteNoteImageAsset(state.uid, noteId, uploadedImagePath, payload.imageUrl);
        } catch (_) {}
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
  $id("notes-btn-new-note")?.addEventListener("click", () => openNoteModal());
  $id("notes-btn-new-reminder")?.addEventListener("click", () => openReminderModal());
  $id("notes-root-switch")?.addEventListener("click", (event) => {
    const target = event.target.closest("[data-act='set-root-section']");
    if (!target) return;
    state.rootSection = normalizeRootSection(target.dataset.rootSection || "");
    if (state.rootSection !== "notes") setCurrentFolder("");
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
  $id("notes-reminders-calendar-view")?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const action = String(target.dataset.act || "").trim();
    if (action === "shift-reminders-calendar") {
      shiftReminderCalendarMonth(Number(target.dataset.monthShift || 0), getFilteredReminders());
      renderRemindersPanel();
      return;
    }
    if (action === "select-reminder-calendar-day") {
      setReminderCalendarSelectedDate(target.dataset.dateKey || "", { syncMonth: true });
      renderRemindersPanel();
      return;
    }
    if (action === "focus-reminder-calendar-item") {
      setReminderCalendarSelectedDate(target.dataset.dateKey || "", {
        syncMonth: true,
        focusedReminderId: target.dataset.reminderId || "",
      });
      renderRemindersPanel();
      return;
    }
    const reminder = state.reminders.find((row) => row.id === String(target.dataset.reminderId || "").trim());
    if (await handleReminderPrimaryAction(action, reminder)) return;
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
  $id("notes-note-folder-select")?.addEventListener("change", (event) => {
    const folderId = String(event.target.value || "").trim();
    $id("notes-note-folder-id").value = folderId;
    $id("notes-note-form-error").textContent = "";
    populateNoteCategorySelector(folderId);
    populateNoteTagsSelector(folderId);
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

  $id("notes-cards-list")?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;

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
      const itemId = String(target.dataset.itemId || "").trim();
      const item = reminder?.checklistItems?.[itemId];
      if (!item) return;
      const done = !Boolean(item.done);
      const completedAt = done ? Date.now() : 0;
      await patchReminderChecklistItem(state.rootPath, reminder.id, itemId, { ...item, done, completedAt });
      const allItems = Object.values(reminder?.checklistItems || {}).map((row) => row.id === itemId ? { ...row, done } : row);
      const allDone = allItems.length > 0 && allItems.every((row) => row.done);
      await updateReminder(state.rootPath, reminder.id, {
        ...reminder,
        checklistItems: {
          ...(reminder.checklistItems || {}),
          [itemId]: { ...item, done, completedAt },
        },
        status: allDone ? "completado" : "pendiente",
        completedAt: allDone ? Date.now() : 0,
      });
      return;
    }
    if (target.dataset.act === "add-checklist-item") {
      const input = document.querySelector(`[data-checklist-input='${CSS.escape(reminder.id)}']`);
      const text = String(input?.value || "").trim();
      if (!text) return;
      const itemId = `cli_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const order = Date.now();
      await patchReminderChecklistItem(state.rootPath, reminder.id, itemId, {
        id: itemId, text, done: false, createdAt: Date.now(), completedAt: 0, order,
      });
      if (input) input.value = "";
      return;
    }
    if (target.dataset.act === "delete-checklist-item") {
      const itemId = String(target.dataset.itemId || "").trim();
      if (!itemId) return;
      const updatedItems = { ...(reminder.checklistItems || {}) };
      delete updatedItems[itemId];
      const rows = Object.values(updatedItems);
      const allDone = rows.length > 0 && rows.every((row) => row.done);
      await updateReminder(state.rootPath, reminder.id, {
        ...reminder,
        checklistItems: updatedItems,
        status: allDone ? "completado" : "pendiente",
        completedAt: allDone ? Date.now() : 0,
      });
      return;
    }
    if (target.dataset.act === "delete-reminder") {
      if (window.confirm(`¿Eliminar recordatorio "${reminder.title}"?`)) {
        await deleteReminder(state.rootPath, reminder.id);
      }
    }
  });
  $id("notes-reminders-history-list")?.addEventListener("click", async (event) => {
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
  state.folderView = "main";
  state._reminderPrefsApplied = false;
  setCurrentFolder("");
  state.unlockedFolderIds = new Set();
  clearNotePhotoObjectUrl();
  clearNoteTagImageDrafts();
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
