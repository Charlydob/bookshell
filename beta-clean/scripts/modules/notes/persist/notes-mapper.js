import { buildTagDefinitionKey, normalizeTagLabel } from "../domain/tag-utils.js?v=2026-04-28-v1";

function normalizeColor(value = "") {
  const safe = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(safe) ? safe : "#00d4ff";
}

function normalizePin(value = "") {
  const raw = String(value || "").replace(/\D+/g, "").slice(0, 4);
  return raw.length === 4 ? raw : "";
}

function normalizeParentId(value = "") {
  return String(value || "").trim();
}

function normalizeImageUrl(value = "") {
  return String(value || "").trim();
}

function normalizeImagePath(value = "") {
  return String(value || "").trim();
}

function normalizeImageTimestamp(value = 0) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeNoteTagImageKey(value = "") {
  return buildTagDefinitionKey(value);
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

function normalizeNoteVisitTimestamp(value = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}

function normalizeNoteKind(value = "") {
  return String(value || "").trim().toLowerCase() === "code" ? "code" : "text";
}

function normalizeCodeLanguage(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["css", "html", "js", "general"].includes(safe) ? safe : "general";
}

function normalizeTagDefinitionLabel(value = "", fallback = "") {
  return normalizeTagLabel(value) || normalizeTagLabel(fallback);
}

function normalizeTagDefinitionKey(value = "", fallback = "") {
  return buildTagDefinitionKey(value) || buildTagDefinitionKey(fallback);
}

function normalizeReminderType(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["normal", "cumpleaños", "cumpleanos", "tarea", "evento", "trámite", "tramite", "checklist", "personalizado"].includes(safe)
    ? (safe === "cumpleanos" ? "cumpleaños" : (safe === "tramite" ? "trámite" : safe))
    : "normal";
}

function normalizeReminderStatus(value = "") {
  const safe = String(value || "").trim().toLowerCase();
  return ["pendiente", "completado", "vencido"].includes(safe) ? safe : "pendiente";
}

function normalizeReminderDate(value = "") {
  const safe = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(safe) ? safe : "";
}

function normalizeReminderTime(value = "") {
  const safe = String(value || "").trim();
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(safe) ? safe : "";
}

function normalizeReminderRepeat(value = "") {
  return String(value || "").trim() === "yearly" ? "yearly" : "none";
}

function normalizeReminderAlerts(value = []) {
  if (!Array.isArray(value)) return [];
  return value
    .map((row) => {
      const amount = Math.max(0, Math.round(Number(row?.amount || 0)));
      const unitRaw = String(row?.unit || "").trim().toLowerCase();
      const unit = ["minutes", "hours", "days"].includes(unitRaw) ? unitRaw : "";
      if (!amount || !unit) return null;
      return { amount, unit };
    })
    .filter(Boolean);
}

function normalizeReminderDismissedAlerts(value = []) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item || "").trim()).filter(Boolean);
}

function normalizeReminderCategories(value = []) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  const one = String(value || "").trim();
  return one ? [one] : [];
}

function normalizeReminderChecklistItems(value = {}) {
  const entries = Object.entries(value || {});
  return entries.reduce((acc, [id, item]) => {
    const safeId = String(item?.id || id || "").trim();
    const text = String(item?.text || "").trim();
    if (!safeId || !text) return acc;
    acc[safeId] = {
      id: safeId,
      text,
      done: Boolean(item?.done),
      createdAt: Number(item?.createdAt || Date.now()),
      completedAt: Number(item?.completedAt || 0),
      order: Number.isFinite(Number(item?.order)) ? Number(item.order) : Date.now(),
    };
    return acc;
  }, {});
}

export function mapFolderFromDb(id, value = {}) {
  return {
    id: String(id || ""),
    name: String(value?.name || "Sin nombre").trim() || "Sin nombre",
    color: normalizeColor(value?.color),
    createdAt: Number(value?.createdAt || Date.now()),
    parentId: normalizeParentId(value?.parentId),
    isPrivate: Boolean(value?.isPrivate),
    pin: normalizePin(value?.pin),
    emoji: String(value?.emoji || "📁").trim() || "📁",
    category: String(value?.category || "").trim(),
    tags: Array.isArray(value?.tags) ? value.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
  };
}

export function mapFolderToDb(folder = {}) {
  const isPrivate = Boolean(folder?.isPrivate);
  return {
    name: String(folder?.name || "").trim(),
    color: normalizeColor(folder?.color),
    createdAt: Number(folder?.createdAt || Date.now()),
    parentId: normalizeParentId(folder?.parentId),
    isPrivate,
    pin: isPrivate ? normalizePin(folder?.pin) : "",
    emoji: String(folder?.emoji || "📁").trim() || "📁",
    category: String(folder?.category || "").trim(),
    tags: Array.isArray(folder?.tags) ? folder.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
  };
}

export function mapNoteFromDb(id, value = {}) {
  const type = value?.type === "link" ? "link" : "note";
  const noteKind = normalizeNoteKind(value?.noteKind);
  return {
    id: String(id || ""),
    folderId: String(value?.folderId || ""),
    title: String(value?.title || "").trim(),
    content: String(value?.content || "").trim(),
    code: String(value?.code || "").trim(),
    noteKind,
    codeLanguage: normalizeCodeLanguage(value?.codeLanguage),
    previewHtml: String(value?.previewHtml || "").trim(),
    createdAt: Number(value?.createdAt || Date.now()),
    updatedAt: Number(value?.updatedAt || Date.now()),
    type,
    url: type === "link" ? String(value?.url || "").trim() : "",
    category: String(value?.category || "").trim(),
    tags: Array.isArray(value?.tags) ? value.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    imageUrl: normalizeImageUrl(value?.imageUrl),
    imagePath: normalizeImagePath(value?.imagePath),
    imageUpdatedAt: normalizeImageTimestamp(value?.imageUpdatedAt),
    tagImageKey: normalizeNoteTagImageKey(value?.tagImageKey),
    rating: normalizeNoteRating(value?.rating),
    visitsCount: normalizeNoteVisitsCount(value?.visitsCount),
    lastVisitedAt: normalizeNoteVisitTimestamp(value?.lastVisitedAt),
  };
}

export function mapNoteToDb(note = {}) {
  const type = note?.type === "link" ? "link" : "note";
  const noteKind = normalizeNoteKind(note?.noteKind);
  return {
    folderId: String(note?.folderId || ""),
    title: String(note?.title || "").trim(),
    content: noteKind === "code" ? "" : String(note?.content || "").trim(),
    code: noteKind === "code" ? String(note?.code || "").trim() : "",
    noteKind,
    codeLanguage: noteKind === "code" ? normalizeCodeLanguage(note?.codeLanguage) : "general",
    previewHtml: noteKind === "code" ? String(note?.previewHtml || "").trim() : "",
    createdAt: Number(note?.createdAt || Date.now()),
    updatedAt: Number(note?.updatedAt || Date.now()),
    type,
    url: type === "link" ? String(note?.url || "").trim() : "",
    category: String(note?.category || "").trim(),
    tags: Array.isArray(note?.tags) ? note.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    imageUrl: normalizeImageUrl(note?.imageUrl),
    imagePath: normalizeImagePath(note?.imagePath),
    imageUpdatedAt: normalizeImageTimestamp(note?.imageUpdatedAt),
    tagImageKey: normalizeNoteTagImageKey(note?.tagImageKey),
    rating: normalizeNoteRating(note?.rating),
    visitsCount: normalizeNoteVisitsCount(note?.visitsCount),
    lastVisitedAt: normalizeNoteVisitTimestamp(note?.lastVisitedAt),
  };
}

export function mapTagDefinitionFromDb(id, value = {}) {
  const key = normalizeTagDefinitionKey(value?.key, id);
  if (!key) return null;

  const label = normalizeTagDefinitionLabel(value?.label, id) || key;
  return {
    key,
    label,
    imageUrl: normalizeImageUrl(value?.imageUrl),
    imagePath: normalizeImagePath(value?.imagePath),
    imageUpdatedAt: normalizeImageTimestamp(value?.imageUpdatedAt),
    createdAt: Number(value?.createdAt || Date.now()),
    updatedAt: Number(value?.updatedAt || value?.createdAt || Date.now()),
  };
}

export function mapTagDefinitionToDb(tagDefinition = {}) {
  const key = normalizeTagDefinitionKey(tagDefinition?.key, tagDefinition?.label);
  const label = normalizeTagDefinitionLabel(tagDefinition?.label, key) || key;

  return {
    key,
    label,
    imageUrl: normalizeImageUrl(tagDefinition?.imageUrl),
    imagePath: normalizeImagePath(tagDefinition?.imagePath),
    imageUpdatedAt: normalizeImageTimestamp(tagDefinition?.imageUpdatedAt),
    createdAt: Number(tagDefinition?.createdAt || Date.now()),
    updatedAt: Number(tagDefinition?.updatedAt || tagDefinition?.createdAt || Date.now()),
  };
}

export function mapReminderFromDb(id, value = {}) {
  const type = normalizeReminderType(value?.type);
  const isBirthday = type === "cumpleaños" || Boolean(value?.isBirthday);
  const repeat = normalizeReminderRepeat(value?.repeat || (isBirthday ? "yearly" : "none"));

  return {
    id: String(id || ""),
    title: String(value?.title || "").trim(),
    description: String(value?.description || "").trim(),
    emoji: String(value?.emoji || "⏰").trim() || "⏰",
    type: isBirthday ? "cumpleaños" : type,
    status: normalizeReminderStatus(value?.status),
    targetDate: normalizeReminderDate(value?.targetDate),
    targetTime: normalizeReminderTime(value?.targetTime),
    remindBefore: normalizeReminderAlerts(value?.remindBefore),
    repeat,
    isBirthday,
    categories: normalizeReminderCategories(value?.categories),
    checklistItems: normalizeReminderChecklistItems(value?.checklistItems),
    createdAt: Number(value?.createdAt || Date.now()),
    updatedAt: Number(value?.updatedAt || value?.createdAt || Date.now()),
    completedAt: Number(value?.completedAt || 0),
    dismissedAlerts: normalizeReminderDismissedAlerts(value?.dismissedAlerts),
  };
}

export function mapReminderToDb(reminder = {}) {
  const type = normalizeReminderType(reminder?.type);
  const isBirthday = type === "cumpleaños" || Boolean(reminder?.isBirthday);
  const repeat = normalizeReminderRepeat(reminder?.repeat || (isBirthday ? "yearly" : "none"));
  return {
    title: String(reminder?.title || "").trim(),
    description: String(reminder?.description || "").trim(),
    emoji: String(reminder?.emoji || "⏰").trim() || "⏰",
    type: isBirthday ? "cumpleaños" : type,
    status: normalizeReminderStatus(reminder?.status),
    targetDate: normalizeReminderDate(reminder?.targetDate),
    targetTime: normalizeReminderTime(reminder?.targetTime),
    remindBefore: normalizeReminderAlerts(reminder?.remindBefore),
    repeat,
    isBirthday,
    categories: normalizeReminderCategories(reminder?.categories),
    checklistItems: normalizeReminderChecklistItems(reminder?.checklistItems),
    createdAt: Number(reminder?.createdAt || Date.now()),
    updatedAt: Number(reminder?.updatedAt || reminder?.createdAt || Date.now()),
    completedAt: Number(reminder?.completedAt || 0),
    dismissedAlerts: normalizeReminderDismissedAlerts(reminder?.dismissedAlerts),
  };
}

export function mapSnapshotToDomain(value = {}) {
  const folderEntries = Object.entries(value?.folders || {});
  const noteEntries = Object.entries(value?.notes || {});
  const tagDefinitionEntries = Object.entries(value?.tagDefinitions || {});
  const reminderEntries = Object.entries(value?.reminders || {});
  const reminderCategoryEntries = Object.entries(value?.reminderCategories || {});

  const tagDefinitions = tagDefinitionEntries
    .map(([id, row]) => mapTagDefinitionFromDb(id, row))
    .filter(Boolean)
    .sort((a, b) => String(a?.label || "").localeCompare(String(b?.label || ""), "es", { sensitivity: "base" }))
    .reduce((acc, tagDefinition) => {
      acc[tagDefinition.key] = tagDefinition;
      return acc;
    }, {});

  return {
    folders: folderEntries.map(([id, row]) => mapFolderFromDb(id, row)).sort((a, b) => a.createdAt - b.createdAt),
    notes: noteEntries.map(([id, row]) => mapNoteFromDb(id, row)).sort((a, b) => b.updatedAt - a.updatedAt),
    reminders: reminderEntries.map(([id, row]) => mapReminderFromDb(id, row)).sort((a, b) => {
      const aAt = Date.parse(`${a.targetDate || ""}T${a.targetTime || "23:59"}:00`);
      const bAt = Date.parse(`${b.targetDate || ""}T${b.targetTime || "23:59"}:00`);
      return aAt - bAt;
    }),
    reminderCategories: reminderCategoryEntries.map(([id, row]) => ({
      id: String(row?.id || id || "").trim(),
      name: String(row?.name || "").trim(),
      emoji: String(row?.emoji || "").trim(),
      color: String(row?.color || "").trim(),
      createdAt: Number(row?.createdAt || Date.now()),
      updatedAt: Number(row?.updatedAt || row?.createdAt || Date.now()),
    })).filter((row) => row.id && row.name),
    reminderPreferences: value?.reminderPreferences || {},
    tagDefinitions,
  };
}
