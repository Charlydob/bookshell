function normalizeId(value = "") {
  return String(value || "").trim();
}

function compareFolders(a, b) {
  const diff = Number(a?.createdAt || 0) - Number(b?.createdAt || 0);
  if (diff !== 0) return diff;
  return String(a?.name || "").localeCompare(String(b?.name || ""), "es", { sensitivity: "base" });
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

export function createInitialNotesState() {
  return {
    uid: "",
    rootPath: "",
    folders: [],
    notes: [],
    selectedFolderId: "",
    unlockedFolderIds: new Set(),
    folderQuery: "",
    noteQuery: "",
    folderCategoryFilter: "",
    folderTagsFilter: "",
    noteCategoryFilter: "",
    noteTagsFilter: "",
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
