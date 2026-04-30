import { auth, db } from "../../../shared/firebase/index.js";
import {
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { logFirebaseRead, registerViewListener } from "../../../shared/firebase/read-debug.js";
import { buildTagDefinitionKey } from "../domain/tag-utils.js?v=2026-04-28-v2";
import {
  mapFolderToDb,
  mapNoteToDb,
  mapReminderToDb,
  mapSnapshotToDomain,
  mapTagDefinitionToDb,
} from "./notes-mapper.js?v=2026-04-28-v2";

function resolveRootPath(uidParam = "") {
  const uid = String(uidParam || auth.currentUser?.uid || "").trim();
  if (!uid) throw new Error("UID no disponible para notas");
  return `v2/users/${uid}/notes`;
}

export function subscribeNotesRoot(uid, onData, onError) {
  const rootPath = resolveRootPath(uid);
  logFirebaseRead({ path: rootPath, mode: "onValue", reason: "notes-root-sync", viewId: "view-notes" });
  const unsubscribe = registerViewListener("view-notes", onValue(
    ref(db, rootPath),
    (snapshot) => {
      const value = snapshot.val() || {};
      onData?.(mapSnapshotToDomain(value), rootPath);
    },
    (error) => onError?.(error),
  ), {
    key: "notes-root",
    path: rootPath,
    mode: "onValue",
    reason: "notes-root-sync",
  });

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

export async function createReminder(rootPath, payload = {}) {
  const remindersRef = ref(db, `${rootPath}/reminders`);
  const nextRef = push(remindersRef);
  await update(ref(db), {
    [`${rootPath}/reminders/${nextRef.key}`]: mapReminderToDb({
      ...payload,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }),
  });
  return nextRef.key;
}

export async function updateReminder(rootPath, reminderId, payload = {}) {
  const safeReminderId = String(reminderId || "").trim();
  if (!safeReminderId) return;
  await update(ref(db), {
    [`${rootPath}/reminders/${safeReminderId}`]: mapReminderToDb({
      ...payload,
      updatedAt: Date.now(),
    }),
  });
}

export async function deleteReminder(rootPath, reminderId) {
  const safeReminderId = String(reminderId || "").trim();
  if (!safeReminderId) return;
  await remove(ref(db, `${rootPath}/reminders/${safeReminderId}`));
}

export async function upsertReminderCategory(rootPath, categoryId, payload = {}) {
  const safeId = String(categoryId || "").trim();
  if (!safeId) return;
  await update(ref(db), {
    [`${rootPath}/reminderCategories/${safeId}`]: {
      id: safeId,
      name: String(payload?.name || "").trim(),
      emoji: String(payload?.emoji || "").trim(),
      color: String(payload?.color || "").trim(),
      createdAt: Number(payload?.createdAt || Date.now()),
      updatedAt: Date.now(),
    },
  });
}

export async function deleteReminderCategory(rootPath, categoryId) {
  const safeId = String(categoryId || "").trim();
  if (!safeId) return;
  await remove(ref(db, `${rootPath}/reminderCategories/${safeId}`));
}

export async function updateReminderPreferences(rootPath, payload = {}) {
  await update(ref(db), {
    [`${rootPath}/reminderPreferences`]: payload || {},
  });
}

export async function patchReminderChecklistItem(rootPath, reminderId, itemId, payload = {}) {
  const safeReminderId = String(reminderId || "").trim();
  const safeItemId = String(itemId || "").trim();
  if (!safeReminderId || !safeItemId) return;
  await update(ref(db), {
    [`${rootPath}/reminders/${safeReminderId}/checklistItems/${safeItemId}`]: payload,
    [`${rootPath}/reminders/${safeReminderId}/updatedAt`]: Date.now(),
  });
}

export async function incrementNoteVisits(rootPath, noteId) {
  const safeNoteId = String(noteId || "").trim();
  if (!safeNoteId) return false;

  const noteRef = ref(db, `${rootPath}/notes/${safeNoteId}`);
  const now = Date.now();
  const result = await runTransaction(noteRef, (current) => {
    if (!current || current?.type !== "link") return current;

    const currentVisits = Number(current?.visitsCount || 0);
    const visitsCount = Number.isFinite(currentVisits) && currentVisits > 0
      ? Math.max(0, Math.round(currentVisits))
      : 0;

    return {
      ...current,
      visitsCount: visitsCount + 1,
      lastVisitedAt: now,
    };
  });

  return Boolean(result?.committed);
}

export async function upsertTagDefinition(rootPath, tagKey, payload = {}) {
  const safeTagKey = buildTagDefinitionKey(tagKey || payload?.key || payload?.label);
  if (!safeTagKey) throw new Error("No se pudo resolver el identificador del tag.");

  await update(ref(db), {
    [`${rootPath}/tagDefinitions/${safeTagKey}`]: mapTagDefinitionToDb({
      ...payload,
      key: safeTagKey,
      createdAt: Number(payload?.createdAt || Date.now()),
      updatedAt: Date.now(),
    }),
  });

  return safeTagKey;
}
