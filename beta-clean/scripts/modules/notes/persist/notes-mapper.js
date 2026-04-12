function normalizeColor(value = "") {
  const safe = String(value || "").trim();
  return /^#[0-9a-fA-F]{6}$/.test(safe) ? safe : "#00d4ff";
}

function normalizePin(value = "") {
  const raw = String(value || "").replace(/\D+/g, "").slice(0, 4);
  return raw.length === 4 ? raw : "";
}

export function mapFolderFromDb(id, value = {}) {
  return {
    id: String(id || ""),
    name: String(value?.name || "Sin nombre").trim() || "Sin nombre",
    color: normalizeColor(value?.color),
    createdAt: Number(value?.createdAt || Date.now()),
    isPrivate: Boolean(value?.isPrivate),
    pin: normalizePin(value?.pin),
    emoji: String(value?.emoji || "📁").trim() || "📁",
    category: String(value?.category || "").trim(),
    tags: Array.isArray(value?.tags) ? value.tags.map(t => String(t).trim()).filter(t => t) : [],
  };
}

export function mapFolderToDb(folder = {}) {
  const isPrivate = Boolean(folder?.isPrivate);
  return {
    name: String(folder?.name || "").trim(),
    color: normalizeColor(folder?.color),
    createdAt: Number(folder?.createdAt || Date.now()),
    isPrivate,
    pin: isPrivate ? normalizePin(folder?.pin) : "",
    emoji: String(folder?.emoji || "📁").trim() || "📁",
    category: String(folder?.category || "").trim(),
    tags: Array.isArray(folder?.tags) ? folder.tags.map(t => String(t).trim()).filter(t => t) : [],
  };
}

export function mapNoteFromDb(id, value = {}) {
  const type = value?.type === "link" ? "link" : "note";
  return {
    id: String(id || ""),
    folderId: String(value?.folderId || ""),
    title: String(value?.title || "").trim(),
    content: String(value?.content || "").trim(),
    createdAt: Number(value?.createdAt || Date.now()),
    updatedAt: Number(value?.updatedAt || Date.now()),
    type,
    url: type === "link" ? String(value?.url || "").trim() : "",
    category: String(value?.category || "").trim(),
    tags: Array.isArray(value?.tags) ? value.tags.map(t => String(t).trim()).filter(t => t) : [],
  };
}

export function mapNoteToDb(note = {}) {
  const type = note?.type === "link" ? "link" : "note";
  return {
    folderId: String(note?.folderId || ""),
    title: String(note?.title || "").trim(),
    content: String(note?.content || "").trim(),
    createdAt: Number(note?.createdAt || Date.now()),
    updatedAt: Number(note?.updatedAt || Date.now()),
    type,
    url: type === "link" ? String(note?.url || "").trim() : "",
    category: String(note?.category || "").trim(),
    tags: Array.isArray(note?.tags) ? note.tags.map(t => String(t).trim()).filter(t => t) : [],
  };
}

export function mapSnapshotToDomain(value = {}) {
  const folderEntries = Object.entries(value?.folders || {});
  const noteEntries = Object.entries(value?.notes || {});
  return {
    folders: folderEntries.map(([id, row]) => mapFolderFromDb(id, row)).sort((a, b) => a.createdAt - b.createdAt),
    notes: noteEntries.map(([id, row]) => mapNoteFromDb(id, row)).sort((a, b) => b.updatedAt - a.updatedAt),
  };
}
