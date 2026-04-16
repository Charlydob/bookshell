import { auth, db } from "../../../shared/firebase/index.js";
import {
  onValue,
  push,
  ref,
  remove,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { mapFolderToDb, mapNoteToDb, mapSnapshotToDomain } from "./notes-mapper.js";

function resolveRootPath(uidParam = "") {
  const uid = String(uidParam || auth.currentUser?.uid || "").trim();
  if (!uid) throw new Error("UID no disponible para notas");
  return `v2/users/${uid}/notes`;
}

export function subscribeNotesRoot(uid, onData, onError) {
  const rootPath = resolveRootPath(uid);
  const unsubscribe = onValue(
    ref(db, rootPath),
    (snapshot) => {
      const value = snapshot.val() || {};
      onData?.(mapSnapshotToDomain(value), rootPath);
    },
    (error) => onError?.(error),
  );

  return {
    rootPath,
    unsubscribe,
  };
}

export async function createFolder(rootPath, payload = {}) {
  const foldersRef = ref(db, `${rootPath}/folders`);
  const nextRef = push(foldersRef);
  await update(ref(db), {
    [`${rootPath}/folders/${nextRef.key}`]: mapFolderToDb({
      ...payload,
      createdAt: Date.now(),
    }),
  });
  return nextRef.key;
}

export async function updateFolder(rootPath, folderId, payload = {}) {
  const safeFolderId = String(folderId || "").trim();
  if (!safeFolderId) return;
  await update(ref(db), {
    [`${rootPath}/folders/${safeFolderId}`]: mapFolderToDb(payload),
  });
}

export async function deleteFolder(rootPath, folderId, folders = [], notes = []) {
  const safeFolderId = String(folderId || "").trim();
  if (!safeFolderId) return;

  const hasSubfolders = folders.some((folder) => String(folder?.parentId || "") === safeFolderId);
  const hasNotes = notes.some((note) => String(note?.folderId || "") === safeFolderId);
  if (hasSubfolders || hasNotes) {
    throw new Error("Solo se pueden borrar carpetas vacías.");
  }

  await remove(ref(db, `${rootPath}/folders/${safeFolderId}`));
}

export function createNoteId(rootPath) {
  const notesRef = ref(db, `${rootPath}/notes`);
  return push(notesRef).key;
}

export async function createNote(rootPath, payload = {}, noteId = "") {
  const notesRef = ref(db, `${rootPath}/notes`);
  const safeNoteId = String(noteId || push(notesRef).key || "").trim();
  if (!safeNoteId) throw new Error("No se pudo crear el identificador de la nota.");

  const now = Date.now();
  await update(ref(db), {
    [`${rootPath}/notes/${safeNoteId}`]: mapNoteToDb({
      ...payload,
      createdAt: now,
      updatedAt: now,
    }),
  });

  return safeNoteId;
}

export async function updateNote(rootPath, noteId, payload = {}) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId) return;
  await update(ref(db), {
    [`${rootPath}/notes/${safeNoteId}`]: mapNoteToDb({
      ...payload,
      updatedAt: Date.now(),
    }),
  });
}

export async function deleteNote(rootPath, noteId) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId) return;
  await remove(ref(db, `${rootPath}/notes/${safeNoteId}`));
}
