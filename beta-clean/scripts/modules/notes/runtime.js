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
} from "./domain/store.js";
import {
  createFolder,
  createNote,
  createNoteId,
  createReminder,
  deleteReminder,
  deleteFolder,
  deleteNote,
  incrementNoteVisits,
  subscribeNotesRoot,
  upsertTagDefinition,
  updateFolder,
  updateNote,
  updateReminder,
} from "./persist/notes-datasource.js";
import {
  deleteNoteImageAsset,
  deleteNoteTagImageAsset,
  downscaleNoteImageFile,
  uploadNoteImageAsset,
  uploadNoteTagImageAsset,
} from "./persist/notes-storage.js";
import {
  buildTagDefinitionKey,
  normalizeTagLabel,
  parseTagList,
} from "./domain/tag-utils.js";

const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
});
const LONG_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  day: "numeric",
  month: "short",
  year: "numeric",
});
const NUMBER_FORMATTER = new Intl.NumberFormat("es-ES");
const COMPACT_NUMBER_FORMATTER = new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: 1,
});
const state = createInitialNotesState();
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
let reminderCheckTimer = null;

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

function normalizeReminderFilter(filter = "") {
  const safe = String(filter || "").trim();
  return ["all", "upcoming", "today", "birthday", "overdue"].includes(safe) ? safe : "all";
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
  return note.content || "";
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
    const noteImageUrl = buildNoteImageRenderUrl(note);
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
    const mediaMarkup = tagPreview?.imageUrl
      ? `
        <div class="notes-item-media is-image">
          <img class="notes-item-tag-image" src="${escapeHtml(tagPreview.imageUrl)}" alt="${escapeHtml(`Tag ${tagPreview.label || "nota"}`)}" loading="lazy" decoding="async" />
        </div>
      `
      : `
        <div class="notes-item-media is-placeholder">
          <span class="notes-item-icon">${note.type === "link" ? "🔗" : "🗒️"}</span>
        </div>
      `;

    const cardClass = noteImageUrl ? "notes-item-card has-note-image" : "notes-item-card";
    const cardStyle = buildNoteCardStyleAttribute(note);
    const ratingMarkup = buildRatingBadgeMarkup(note?.rating);
    const visitsMarkup = buildVisitsBadgeMarkup(note);
    const metaMarkup = [ratingMarkup, visitsMarkup].filter(Boolean).join("");

    return `
      <article class="${cardClass}"${cardStyle}>
        ${mediaMarkup}
        <div class="notes-item-content">
          <div class="notes-item-head">
            <h4 class="notes-item-title">${escapeHtml(note.title || "Sin título")}</h4>
            ${metaMarkup ? `<div class="notes-item-meta">${metaMarkup}</div>` : ""}
          </div>
          ${preview ? `<p class="notes-item-preview">${escapeHtml(preview)}</p>` : ""}
          ${linkMarkup}
        </div>
        <div class="notes-item-actions">
          <button class="icon-btn icon-btn-large" type="button" data-act="edit-note" data-note-id="${escapeHtml(note.id)}">✏️</button>
          <button class="icon-btn icon-btn-large" type="button" data-act="delete-note" data-note-id="${escapeHtml(note.id)}">🗑️</button>
        </div>
      </article>
    `;
  }).join("");
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

function getReminderTargetTimestamp(reminder, { annualizeBirthdays = false } = {}) {
  const safeDate = String(reminder?.targetDate || "").trim();
  if (!safeDate) return 0;
  const safeTime = String(reminder?.targetTime || "").trim() || "23:59";
  let date = new Date(`${safeDate}T${safeTime}:00`);
  if (!Number.isFinite(date.getTime())) return 0;
  if (annualizeBirthdays && reminder?.repeat === "yearly") {
    const now = new Date();
    date.setFullYear(now.getFullYear());
    if (date.getTime() < now.getTime()) date.setFullYear(now.getFullYear() + 1);
  }
  return date.getTime();
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

function getFilteredReminders() {
  const all = Array.isArray(state.reminders) ? state.reminders : [];
  const startToday = new Date();
  startToday.setHours(0, 0, 0, 0);
  const endToday = startToday.getTime() + (24 * 60 * 60 * 1000);
  const filter = normalizeReminderFilter(state.reminderFilter);
  const filtered = all.filter((reminder) => {
    const computedStatus = getReminderComputedStatus(reminder);
    const targetAt = getReminderTargetTimestamp(reminder, { annualizeBirthdays: true });
    if (filter === "upcoming") return computedStatus === "pendiente";
    if (filter === "today") return targetAt >= startToday.getTime() && targetAt < endToday;
    if (filter === "birthday") return reminder?.type === "cumpleaños";
    if (filter === "overdue") return computedStatus === "vencido";
    return true;
  });
  return filtered.sort((a, b) => getReminderTargetTimestamp(a, { annualizeBirthdays: true }) - getReminderTargetTimestamp(b, { annualizeBirthdays: true }));
}

function renderReminderCards(list, reminders = []) {
  if (!list) return;
  list.innerHTML = reminders.map((reminder) => {
    const computedStatus = getReminderComputedStatus(reminder);
    const targetAt = getReminderTargetTimestamp(reminder, { annualizeBirthdays: true });
    const dateLabel = targetAt ? formatLongDate(targetAt) : "Sin fecha";
    const countdown = buildReminderCountdown(reminder);
    const isBirthday = reminder?.type === "cumpleaños";
    const birthdayLead = isBirthday
      ? `🎂 ${countdown === "Es hoy" ? `Hoy es el cumpleaños de ${reminder.title || "alguien"}` : `${countdown.replace("Faltan", "Quedan")} para el cumpleaños de ${reminder.title || "alguien"}`}`
      : countdown;
    return `
      <article class="notes-reminder-item is-${escapeHtml(computedStatus)}">
        <div class="notes-reminder-main">
          <div class="notes-reminder-title-row">
            <span class="notes-reminder-emoji">${escapeHtml(reminder?.emoji || "⏰")}</span>
            <strong class="notes-reminder-title">${escapeHtml(reminder?.title || "Sin título")}</strong>
          </div>
          <div class="notes-reminder-meta">${escapeHtml(dateLabel)} · ${escapeHtml(reminder?.type || "normal")} · ${escapeHtml(computedStatus)}</div>
          <div class="notes-reminder-countdown">${escapeHtml(isBirthday ? birthdayLead : countdown)}</div>
        </div>
        <div class="notes-item-actions">
          <button class="icon-btn icon-btn-large" type="button" data-act="edit-reminder" data-reminder-id="${escapeHtml(reminder.id)}">✏️</button>
          <button class="icon-btn icon-btn-large" type="button" data-act="complete-reminder" data-reminder-id="${escapeHtml(reminder.id)}">✅</button>
          <button class="icon-btn icon-btn-large" type="button" data-act="delete-reminder" data-reminder-id="${escapeHtml(reminder.id)}">🗑️</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderRemindersPanel() {
  const list = $id("notes-reminders-list");
  const historyList = $id("notes-reminders-history-list");
  const empty = $id("notes-empty-reminders");
  const toggle = $id("notes-reminders-toggle-history");
  const filterSelect = $id("notes-reminders-filter");
  if (!list || !historyList || !empty || !toggle) return;
  if (filterSelect) filterSelect.value = normalizeReminderFilter(state.reminderFilter);
  const filtered = getFilteredReminders();
  const active = filtered.filter((item) => getReminderComputedStatus(item) === "pendiente");
  const history = filtered.filter((item) => getReminderComputedStatus(item) !== "pendiente");
  renderReminderCards(list, active);
  renderReminderCards(historyList, history);
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
  $id("notes-note-category").value = note?.category || "";
  $id("notes-note-category-select").value = note?.category || "";
  $id("notes-note-tags").value = (note?.tags || []).join(", ");
  $id("notes-note-tags-select").value = "";
  $id("notes-note-rating").value = note?.rating === null || note?.rating === undefined ? "" : String(note.rating);
  $id("notes-note-is-link").checked = note?.type === "link";
  $id("notes-note-url").value = note?.url || "";
  $id("notes-note-url-wrap")?.classList.toggle("hidden", note?.type !== "link");
  $id("notes-note-form-error").textContent = "";
  $id("notes-note-modal-title").textContent = note ? "Editar nota" : "Nueva nota";
  updateNoteRatingPreview();
  renderNoteTagImageEditor();
  openModal("notes-note-modal-backdrop");
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

function openReminderModal(reminder = null) {
  reminderDraftAlerts = Array.isArray(reminder?.remindBefore) ? [...reminder.remindBefore] : [];
  $id("notes-reminder-id").value = reminder?.id || "";
  $id("notes-reminder-title").value = reminder?.title || "";
  $id("notes-reminder-description").value = reminder?.description || "";
  $id("notes-reminder-emoji").value = reminder?.emoji || "⏰";
  $id("notes-reminder-type").value = reminder?.type || "normal";
  $id("notes-reminder-date").value = reminder?.targetDate || "";
  $id("notes-reminder-time").value = reminder?.targetTime || "";
  $id("notes-reminder-is-birthday").checked = reminder?.type === "cumpleaños";
  $id("notes-reminder-repeat-yearly").checked = reminder?.repeat === "yearly";
  $id("notes-reminder-delete")?.classList.toggle("hidden", !reminder);
  $id("notes-reminder-modal-title").textContent = reminder ? "Editar recordatorio" : "Nuevo recordatorio";
  renderReminderAlertDrafts();
  openModal("notes-reminder-modal-backdrop");
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
  const stack = $id("notes-reminder-toast-stack");
  if (!stack) return;
  const toast = document.createElement("article");
  toast.className = "notes-reminder-toast";
  toast.innerHTML = `
    <p>${escapeHtml(message)}</p>
    <button type="button" class="icon-btn" data-act="close-reminder-toast">✕</button>
  `;
  toast.querySelector("[data-act='close-reminder-toast']")?.addEventListener("click", () => {
    toast.remove();
  });
  stack.appendChild(toast);
  window.setTimeout(() => toast.remove(), 8000);
  const reminder = state.reminders.find((row) => row.id === reminderId);
  if (reminder && state.rootPath) {
    const dismissedAlerts = Array.isArray(reminder.dismissedAlerts) ? [...reminder.dismissedAlerts] : [];
    if (!dismissedAlerts.includes(key)) dismissedAlerts.push(key);
    updateReminder(state.rootPath, reminderId, { ...reminder, dismissedAlerts }).catch(() => {});
  }
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
      if (dismissedAlerts.has(key)) continue;
      if (now >= triggerAt && now <= triggerAt + 75 * 1000) {
        const label = alert.unit === "days" ? "días" : alert.unit === "hours" ? "horas" : "minutos";
        const prefix = reminder.type === "cumpleaños" ? "🎂" : "⏰";
        appendReminderToast(`${prefix} Quedan ${alert.amount} ${label} para ${reminder.title || "tu recordatorio"}`, reminder.id, key);
      }
    }
  }
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

  isLinkInput?.addEventListener("change", () => {
    $id("notes-note-url-wrap")?.classList.toggle("hidden", !isLinkInput.checked);
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
    const content = $id("notes-note-content").value.trim();
    const category = $id("notes-note-category").value.trim();
    const tagsInput = $id("notes-note-tags").value.trim();
    const tags = parseTagList(tagsInput);
    const rating = normalizeNoteRatingValue(ratingSelect?.value);
    const isLink = $id("notes-note-is-link").checked;
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
    if (isLink && !url) {
      errorField.textContent = "Introduce una URL para la nota tipo link.";
      return;
    }
    noteId = noteId || createNoteId(state.rootPath);

    const payload = {
      folderId,
      title,
      content,
      category,
      tags,
      rating,
      type: isLink ? "link" : "note",
      url,
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
  $id("notes-reminders-filter")?.addEventListener("change", (event) => {
    state.reminderFilter = normalizeReminderFilter(event.target.value || "");
    renderRemindersPanel();
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

    if (action === "edit-note") {
      openNoteModal(note);
      return;
    }
    if (action === "delete-note") {
      await handleNoteDelete(note);
    }
  });

  $id("notes-reminders-list")?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-act][data-reminder-id]");
    if (!target) return;
    const reminder = state.reminders.find((row) => row.id === String(target.dataset.reminderId || "").trim());
    if (!reminder) return;
    if (target.dataset.act === "edit-reminder") {
      openReminderModal(reminder);
      return;
    }
    if (target.dataset.act === "complete-reminder") {
      await updateReminder(state.rootPath, reminder.id, { ...reminder, status: "completado", completedAt: Date.now() });
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
    if (target.dataset.act === "edit-reminder") openReminderModal(reminder);
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
  $id("notes-reminder-is-birthday")?.addEventListener("change", (event) => {
    if (event.target.checked) {
      $id("notes-reminder-type").value = "cumpleaños";
      $id("notes-reminder-repeat-yearly").checked = true;
    }
  });
  $id("notes-reminder-type")?.addEventListener("change", (event) => {
    if (event.target.value === "cumpleaños") {
      $id("notes-reminder-is-birthday").checked = true;
      $id("notes-reminder-repeat-yearly").checked = true;
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
    const payload = {
      title,
      description,
      emoji,
      type: isBirthday ? "cumpleaños" : type,
      targetDate,
      targetTime,
      status: current?.status === "completado" ? "completado" : "pendiente",
      remindBefore: reminderDraftAlerts,
      repeat: isBirthday ? "yearly" : repeat,
      createdAt: current?.createdAt || Date.now(),
      updatedAt: Date.now(),
      completedAt: current?.completedAt || 0,
      dismissedAlerts: current?.dismissedAlerts || [],
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
  };
}

export function destroy() {
  unbindData?.();
  unbindData = null;
  unbindAuth?.();
  unbindAuth = null;
  isBound = false;
  state.rootSection = "notes";
  state.reminderFilter = "all";
  state.reminderCollapsedHistory = true;
  state.folderView = "main";
  setCurrentFolder("");
  state.unlockedFolderIds = new Set();
  clearNotePhotoObjectUrl();
  clearNoteTagImageDrafts();
  notePhotoRemove = false;
  noteSaveInFlight = false;
  reminderDraftAlerts = [];
  stopReminderChecker();
  if (window.__bookshellNotes) {
    delete window.__bookshellNotes;
  }
}
