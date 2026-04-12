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

export function filterFolders(folders = [], query = "") {
  const safeQuery = String(query || "").trim().toLowerCase();
  if (!safeQuery) return folders;
  return folders.filter((folder) => String(folder.name || "").toLowerCase().includes(safeQuery));
}

export function filterNotesByFolder(notes = [], folderId = "", query = "") {
  const safeFolderId = String(folderId || "").trim();
  if (!safeFolderId) return [];

  const safeQuery = String(query || "").trim().toLowerCase();
  const byFolder = notes.filter((note) => String(note.folderId || "") === safeFolderId);
  if (!safeQuery) return byFolder;

  return byFolder.filter((note) => {
    const title = String(note.title || "").toLowerCase();
    const content = String(note.content || "").toLowerCase();
    const url = String(note.url || "").toLowerCase();
    return title.includes(safeQuery) || content.includes(safeQuery) || url.includes(safeQuery);
  });
}
