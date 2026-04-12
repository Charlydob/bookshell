export function createInitialNotesState() {
  return {
    uid: "",
    rootPath: "",
    folders: [],
    notes: [],
    selectedFolderId: "",
    unlockedFolderId: "",
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
  const countByFolder = new Map();
  for (const note of notes) {
    const folderId = String(note?.folderId || "");
    if (!folderId) continue;
    countByFolder.set(folderId, (countByFolder.get(folderId) || 0) + 1);
  }

  return folders.map((folder) => ({
    ...folder,
    notesCount: countByFolder.get(folder.id) || 0,
  }));
}

export function filterFolders(folders = [], query = "", category = "", tags = "") {
  const safeQuery = String(query || "").trim().toLowerCase();
  const safeCategory = String(category || "").trim().toLowerCase();
  const safeTags = String(tags || "").trim().toLowerCase();

  return folders.filter((folder) => {
    const folderName = String(folder.name || "").toLowerCase();
    const folderCategory = String(folder.category || "").toLowerCase();
    const folderTags = (folder.tags || []).map(t => String(t).toLowerCase());

    // Filtro por nombre
    if (safeQuery && !folderName.includes(safeQuery)) return false;

    // Filtro por categoría
    if (safeCategory && folderCategory !== safeCategory) return false;

    // Filtro por tags
    if (safeTags && !folderTags.includes(safeTags)) return false;

    return true;
  });
}

export function filterNotesByFolder(notes = [], folderId = "", query = "", category = "", tags = "") {
  const safeFolderId = String(folderId || "").trim();
  if (!safeFolderId) return [];

  const safeQuery = String(query || "").trim().toLowerCase();
  const safeCategory = String(category || "").trim().toLowerCase();
  const safeTags = String(tags || "").trim().toLowerCase();

  const byFolder = notes.filter((note) => String(note.folderId || "") === safeFolderId);

  return byFolder.filter((note) => {
    // Filtro por nombre/contenido
    if (safeQuery) {
      const title = String(note.title || "").toLowerCase();
      const content = String(note.content || "").toLowerCase();
      const url = String(note.url || "").toLowerCase();
      if (!title.includes(safeQuery) && !content.includes(safeQuery) && !url.includes(safeQuery)) {
        return false;
      }
    }

    // Filtro por categoría
    if (safeCategory && String(note.category || "").toLowerCase() !== safeCategory) return false;

    // Filtro por tags
    if (safeTags && !(note.tags || []).map(t => String(t).toLowerCase()).includes(safeTags)) return false;

    return true;
  });
}
