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

export async function deleteFolder(rootPath, folderId, notes = []) {
  const safeFolderId = String(folderId || "").trim();
  if (!safeFolderId) return;
  const patch = {
    [`${rootPath}/folders/${safeFolderId}`]: null,
  };

  for (const note of notes) {
    if (String(note.folderId || "") !== safeFolderId) continue;
    patch[`${rootPath}/notes/${note.id}`] = null;
  }

  await update(ref(db), patch);
}

export async function createNote(rootPath, payload = {}) {
  const notesRef = ref(db, `${rootPath}/notes`);
  const nextRef = push(notesRef);
  const now = Date.now();
  await update(ref(db), {
    [`${rootPath}/notes/${nextRef.key}`]: mapNoteToDb({
      ...payload,
      createdAt: now,
      updatedAt: now,
    }),
  });
  return nextRef.key;
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
