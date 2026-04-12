import { onUserChange } from "../../shared/firebase/index.js";
import {
  buildFolderStats,
  createInitialNotesState,
  filterFolders,
  filterNotesByFolder,
} from "./domain/store.js";
import {
  createFolder,
  createNote,
  deleteFolder,
  deleteNote,
  subscribeNotesRoot,
  updateFolder,
  updateNote,
} from "./persist/notes-datasource.js";

const state = createInitialNotesState();
let unbindAuth = null;
let unbindData = null;
let isBound = false;

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

function formatDate(ts) {
  try {
    return new Date(Number(ts || Date.now())).toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  } catch (_) {
    return "";
  }
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

function renderFolders() {
  const list = $id("notes-folder-list");
  if (!list) return;

  const foldersWithStats = buildFolderStats(state.folders, state.notes);
  const filtered = filterFolders(
    foldersWithStats,
    state.folderQuery,
    state.folderCategoryFilter,
    state.folderTagsFilter
  );

  if (!filtered.length) {
    list.innerHTML = '<div class="empty-state">No hay carpetas todavía.</div>';
    return;
  }

  list.innerHTML = filtered.map((folder) => {
    const subtitleClass = folder.isPrivate ? "notes-folder-meta is-private-blur" : "notes-folder-meta";
    const emoji = folder.emoji || "📁";
    return `
      <article class="notes-folder-card" data-folder-id="${escapeHtml(folder.id)}"
        style="--folder-color:${escapeHtml(folder.color)};--folder-bg:${tint(folder.color, 0.2)};--folder-glow:${tint(folder.color, 0.42)};">
        <button class="notes-folder-main" type="button" data-act="open-folder" data-folder-id="${escapeHtml(folder.id)}">
          <span class="notes-folder-icon">${escapeHtml(emoji)}</span>
          <span class="notes-folder-content">
            <strong class="notes-folder-title">${escapeHtml(folder.name)}</strong>
            <span class="${subtitleClass}">${folder.notesCount} notas</span>
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

function notePreview(note) {
  return note.content || (note.type === "link" ? "Sin descripción" : "Sin contenido");
}

function urlHost(rawUrl = "") {
  try {
    const value = String(rawUrl || "").trim();
    if (!value) return "";
    const url = new URL(value.startsWith("http") ? value : `https://${value}`);
    return url.hostname;
  } catch (_) {
    return String(rawUrl || "").trim();
  }
}

function renderFolderDetail() {
  const panel = $id("notes-folder-screen");
  const empty = $id("notes-empty-folder");
  const list = $id("notes-cards-list");
  if (!panel || !list || !empty) return;

  const folder = state.folders.find((item) => item.id === state.selectedFolderId);
  if (!folder) {
    panel.classList.add("hidden");
    return;
  }

  panel.classList.remove("hidden");
  $id("notes-folder-name").textContent = folder.name;

  const rows = filterNotesByFolder(
    state.notes,
    folder.id,
    state.noteQuery,
    state.noteCategoryFilter,
    state.noteTagsFilter
  );
  $id("notes-folder-count").textContent = `${rows.length} notas`;

  if (!rows.length) {
    list.innerHTML = "";
    empty.classList.remove("hidden");
    return;
  }

  empty.classList.add("hidden");
  list.innerHTML = rows.map((note) => `
    <article class="notes-item-card">
      <div class="notes-item-icon">${note.type === "link" ? "🔗" : "🗒️"}</div>
      <div class="notes-item-content">
        <h4 class="notes-item-title">${escapeHtml(note.title || "Sin título")}</h4>
        <p class="notes-item-preview">${escapeHtml(notePreview(note))}</p>
        ${note.type === "link" ? `<p class="notes-item-link">${escapeHtml(urlHost(note.url) || note.url || "")}</p>` : ""}
      </div>
      <div class="notes-item-actions">
        <button class="icon-btn icon-btn-large" type="button" data-act="edit-note" data-note-id="${escapeHtml(note.id)}">✏️</button>
        <button class="icon-btn icon-btn-large" type="button" data-act="delete-note" data-note-id="${escapeHtml(note.id)}">🗑️</button>
      </div>
    </article>
  `).join("");
}

function renderShell() {
  const listScreen = $id("notes-folders-screen");
  const detailScreen = $id("notes-folder-screen");
  if (!listScreen || !detailScreen) return;

  const inFolder = Boolean(state.selectedFolderId);
  listScreen.classList.toggle("hidden", inFolder);
  detailScreen.classList.toggle("hidden", !inFolder);

  if (!inFolder) {
    updateFilterOptions();
  } else {
    updateFilterOptionsForNotes();
  }
  renderFolders();
  renderFolderDetail();
}

function requireUnlockedFolder(folder) {
  if (!folder?.isPrivate) return true;
  return state.unlockedFolderId === folder.id;
}

function openFolder(folderId) {
  const folder = state.folders.find((item) => item.id === folderId);
  if (!folder) return;

  if (!requireUnlockedFolder(folder)) {
    $id("notes-pin-folder-id").value = folder.id;
    $id("notes-pin-input").value = "";
    $id("notes-pin-error").textContent = "";
    openModal("notes-pin-modal-backdrop");
    return;
  }

  state.selectedFolderId = folder.id;
  state.noteQuery = "";
  $id("notes-search-notes").value = "";
  renderShell();
}

function closeFolderView() {
  state.selectedFolderId = "";
  state.unlockedFolderId = "";
  state.noteQuery = "";
  state.noteCategoryFilter = "";
  state.noteTagsFilter = "";
  renderShell();
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
    const category = $id("notes-folder-category").value.trim();
    const tagsInput = $id("notes-folder-tags").value.trim();
    const tags = tagsInput ? tagsInput.split(",").map(t => t.trim()).filter(t => t) : [];
    const isPrivate = $id("notes-folder-private").checked;
    const pin = String($id("notes-folder-pin").value || "").replace(/\D+/g, "").slice(0, 4);

    if (!name) return;
    if (isPrivate && pin.length !== 4) {
      $id("notes-folder-form-error").textContent = "El PIN debe tener 4 dígitos.";
      return;
    }

    const payload = {
      name,
      color,
      emoji,
      category,
      tags,
      createdAt: Date.now(),
      isPrivate,
      pin,
    };

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
    updateFilterOptions();
    renderShell();
  });

  $id("notes-folder-modal-close")?.addEventListener("click", () => closeModal("notes-folder-modal-backdrop"));
}

function bindNoteModalEvents() {
  const isLinkInput = $id("notes-note-is-link");
  isLinkInput?.addEventListener("change", () => {
    $id("notes-note-url-wrap")?.classList.toggle("hidden", !isLinkInput.checked);
  });

  $id("notes-note-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const id = $id("notes-note-id").value;
    const folderId = $id("notes-note-folder-id").value;
    const title = $id("notes-note-title").value.trim();
    const content = $id("notes-note-content").value.trim();
    const category = $id("notes-note-category").value.trim();
    const tagsInput = $id("notes-note-tags").value.trim();
    const tags = tagsInput ? tagsInput.split(",").map(t => t.trim()).filter(t => t) : [];
    const isLink = $id("notes-note-is-link").checked;
    const url = $id("notes-note-url").value.trim();

    if (!title || !folderId) return;
    if (isLink && !url) {
      $id("notes-note-form-error").textContent = "Introduce una URL para la nota tipo link.";
      return;
    }

    const payload = {
      folderId,
      title,
      content,
      category,
      tags,
      type: isLink ? "link" : "note",
      url,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    if (id) {
      const current = state.notes.find((row) => row.id === id);
      await updateNote(state.rootPath, id, {
        ...current,
        ...payload,
        createdAt: current?.createdAt || payload.createdAt,
      });
    } else {
      await createNote(state.rootPath, payload);
    }

    closeModal("notes-note-modal-backdrop");
    updateFilterOptionsForNotes();
    renderFolderDetail();
  });
}

function updateFilterOptionsForNotes() {
  const folder = state.folders.find((item) => item.id === state.selectedFolderId);
  if (!folder) return;

  const notesInFolder = state.notes.filter((note) => note.folderId === folder.id);
  const categories = new Set();
  const tags = new Set();

  notesInFolder.forEach((note) => {
    if (note.category) categories.add(note.category);
    if (note.tags) note.tags.forEach(tag => tags.add(tag));
  });

  // Actualizar categorías
  const categorySelect = $id("notes-filter-note-category");
  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Categoría: Todas</option>';
    Array.from(categories).sort().forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat;
      option.textContent = `Categoría: ${cat}`;
      categorySelect.appendChild(option);
    });
    categorySelect.value = currentValue;
  }

  // Actualizar tags
  const tagsSelect = $id("notes-filter-note-tags");
  if (tagsSelect) {
    const currentValue = tagsSelect.value;
    tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    Array.from(tags).sort().forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `Tag: ${tag}`;
      tagsSelect.appendChild(option);
    });
    tagsSelect.value = currentValue;
  }
}

function bindPinModalEvents() {
  $id("notes-pin-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const folderId = $id("notes-pin-folder-id").value;
    const pin = String($id("notes-pin-input").value || "").replace(/\D+/g, "").slice(0, 4);
    const folder = state.folders.find((row) => row.id === folderId);
    if (!folder) return;

    if (pin && pin === folder.pin) {
      state.unlockedFolderId = folder.id;
      closeModal("notes-pin-modal-backdrop");
      openFolder(folder.id);
      return;
    }

    $id("notes-pin-error").textContent = "PIN incorrecto.";
  });

  $id("notes-pin-modal-close")?.addEventListener("click", () => closeModal("notes-pin-modal-backdrop"));
}

function updateFilterOptions() {
  const categories = new Set();
  const tags = new Set();

  state.folders.forEach((folder) => {
    if (folder.category) categories.add(folder.category);
    if (folder.tags) folder.tags.forEach(tag => tags.add(tag));
  });

  // Actualizar categorías
  const categorySelect = $id("notes-filter-category");
  if (categorySelect) {
    const currentValue = categorySelect.value;
    categorySelect.innerHTML = '<option value="">Categoría: Todas</option>';
    Array.from(categories).sort().forEach((cat) => {
      const option = document.createElement("option");
      option.value = cat;
      option.textContent = `Categoría: ${cat}`;
      categorySelect.appendChild(option);
    });
    categorySelect.value = currentValue;
  }

  // Actualizar tags
  const tagsSelect = $id("notes-filter-tags");
  if (tagsSelect) {
    const currentValue = tagsSelect.value;
    tagsSelect.innerHTML = '<option value="">Tags: Todos</option>';
    Array.from(tags).sort().forEach((tag) => {
      const option = document.createElement("option");
      option.value = tag;
      option.textContent = `Tag: ${tag}`;
      tagsSelect.appendChild(option);
    });
    tagsSelect.value = currentValue;
  }
}

function openFolderModal(folder = null) {
  $id("notes-folder-id").value = folder?.id || "";
  $id("notes-folder-name-input").value = folder?.name || "";
  $id("notes-folder-emoji").value = folder?.emoji || "📁";
  $id("notes-folder-category").value = folder?.category || "";
  $id("notes-folder-tags").value = (folder?.tags || []).join(", ");
  $id("notes-folder-color").value = folder?.color || "#00d4ff";
  $id("notes-folder-private").checked = Boolean(folder?.isPrivate);
  $id("notes-folder-pin").value = folder?.pin || "";
  $id("notes-folder-pin-wrap")?.classList.toggle("hidden", !folder?.isPrivate);
  $id("notes-folder-form-error").textContent = "";
  $id("notes-folder-modal-title").textContent = folder ? "Editar carpeta" : "Nueva carpeta";
  openModal("notes-folder-modal-backdrop");
}

function openNoteModal(note = null) {
  const folderId = note?.folderId || state.selectedFolderId;
  $id("notes-note-id").value = note?.id || "";
  $id("notes-note-folder-id").value = folderId || "";
  $id("notes-note-title").value = note?.title || "";
  $id("notes-note-content").value = note?.content || "";
  $id("notes-note-category").value = note?.category || "";
  $id("notes-note-tags").value = (note?.tags || []).join(", ");
  $id("notes-note-is-link").checked = note?.type === "link";
  $id("notes-note-url").value = note?.url || "";
  $id("notes-note-url-wrap")?.classList.toggle("hidden", note?.type !== "link");
  $id("notes-note-form-error").textContent = "";
  $id("notes-note-modal-title").textContent = note ? "Editar nota" : "Nueva nota";
  openModal("notes-note-modal-backdrop");
}

function bindUiEvents() {
  if (isBound) return;
  isBound = true;

  $id("notes-btn-new-folder")?.addEventListener("click", () => openFolderModal());
  $id("notes-btn-back")?.addEventListener("click", () => closeFolderView());
  $id("notes-btn-new-note")?.addEventListener("click", () => openNoteModal());

  $id("notes-search-folders")?.addEventListener("input", (event) => {
    state.folderQuery = event.target.value || "";
    renderFolders();
  });

  $id("notes-filter-category")?.addEventListener("change", (event) => {
    state.folderCategoryFilter = event.target.value || "";
    renderFolders();
  });

  $id("notes-filter-tags")?.addEventListener("change", (event) => {
    state.folderTagsFilter = event.target.value || "";
    renderFolders();
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

  $id("notes-folder-list")?.addEventListener("click", async (event) => {
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
      if (!window.confirm(`¿Borrar carpeta "${folder.name}" y sus notas?`)) return;
      await deleteFolder(state.rootPath, folder.id, state.notes);
    }
  });

  $id("notes-cards-list")?.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-act]");
    if (!target) return;
    const action = target.dataset.act;
    const noteId = target.dataset.noteId;
    const note = state.notes.find((row) => row.id === noteId);
    if (!note) return;

    if (action === "edit-note") {
      openNoteModal(note);
      return;
    }
    if (action === "delete-note") {
      if (!window.confirm(`¿Borrar nota "${note.title || "sin título"}"?`)) return;
      await deleteNote(state.rootPath, note.id);
    }
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
    state.selectedFolderId = "";
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
      if (state.selectedFolderId && !state.folders.some((folder) => folder.id === state.selectedFolderId)) {
        state.selectedFolderId = "";
        state.unlockedFolderId = "";
      }
      renderShell();
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
  renderShell();
}

export function destroy() {
  unbindData?.();
  unbindData = null;
  unbindAuth?.();
  unbindAuth = null;
  isBound = false;
  state.selectedFolderId = "";
  state.unlockedFolderId = "";
}
