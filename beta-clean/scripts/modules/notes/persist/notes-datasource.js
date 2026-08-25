import {
  db,
  firebasePaths,
  onValue,
  push,
  ref,
  remove,
  runTransaction,
  update,
} from "../../../shared/data/index.js";
import { auth, getUserDataKey } from "../../../shared/auth/index.js";
import { trackedOnValue } from "../../../shared/data/read-debug.js";
import {
  createReminder as createCanonicalReminder,
  deleteReminder as deleteCanonicalReminder,
  listReminders as listCanonicalReminders,
  updateReminder as updateCanonicalReminder,
} from "../../../shared/data/reminders-api.js?v=2026-08-25-v1";
import { buildTagDefinitionKey } from "../domain/tag-utils.js?v=2026-04-28-v2";
import {
  mapFolderToDb,
  mapNoteToDb,
  mapReminderToDb,
  mapReminderFromDb,
  mapSnapshotToDomain,
  mapTagDefinitionToDb,
} from "./notes-mapper.js?v=2026-08-25-v1";

const REMINDER_REFRESH_EVENT = "bookshell:notes-reminders-refresh";
const REMINDER_POLL_VISIBLE_MS = 15 * 1000;
const REMINDER_POLL_HIDDEN_MS = 30 * 1000;

function resolveRootPath(uidParam = "") {
  const explicitAuthUid = String(uidParam || "").trim();
  const currentUid = String(auth.currentUser?.uid || "").trim();
  const authUid = explicitAuthUid
    ? (explicitAuthUid === currentUid ? getUserDataKey(auth.currentUser) : explicitAuthUid)
    : getUserDataKey(auth.currentUser);
  if (!authUid) throw new Error("UID de auth no disponible para notas");
  return firebasePaths.notes(authUid);
}

function normalizeReminderApiRows(payload = null) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.reminders)) return payload.reminders;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

async function loadReminderDomainRows() {
  const payload = await listCanonicalReminders({ limit: 100 });
  return normalizeReminderApiRows(payload)
    .map((row) => mapReminderFromDb(row?.id, row))
    .filter((row) => row?.id)
    .sort((a, b) => {
      const aAt = Date.parse(`${a.targetDate || ""}T${a.targetTime || "23:59"}:00`);
      const bAt = Date.parse(`${b.targetDate || ""}T${b.targetTime || "23:59"}:00`);
      return aAt - bAt;
    });
}

function requestReminderRefresh() {
  try {
    window.dispatchEvent(new CustomEvent(REMINDER_REFRESH_EVENT));
  } catch (_) {}
}

export function subscribeNotesRoot(uid, onData, onError) {
  const rootPath = resolveRootPath(uid);
  let latestValue = {};
  let latestReminders = [];
  let dataReady = false;
  let remindersReady = false;
  let disposed = false;
  let refreshVersion = 0;

  const emitSnapshot = () => {
    const payload = mapSnapshotToDomain(latestValue);
    onData?.({
      ...payload,
      reminders: latestReminders,
    }, rootPath);
  };

  const refreshReminders = async ({ emit = true } = {}) => {
    const version = ++refreshVersion;
    try {
      const rows = await loadReminderDomainRows();
      if (disposed || version !== refreshVersion) return;
      latestReminders = rows;
      remindersReady = true;
      if (emit && dataReady) emitSnapshot();
    } catch (error) {
      if (disposed) return;
      console.warn("[notes] no se pudieron cargar recordatorios desde /reminders", error);
      onError?.(error);
      remindersReady = true;
      if (emit && dataReady) emitSnapshot();
    }
  };

  const unsubscribe = trackedOnValue(
    ref(db, rootPath),
    (snapshot) => {
      latestValue = snapshot.val() || {};
      dataReady = true;
      if (!remindersReady) {
        void refreshReminders({ emit: true });
        return;
      }
      emitSnapshot();
      void refreshReminders({ emit: true });
    },
    {
    key: "notes-root",
    path: rootPath,
    module: "notes",
    mode: "onValue",
    reason: "notes-root-sync",
    viewId: "view-notes",
    onError: (error) => onError?.(error),
  },
    onValue);

  let pollTimer = null;
  const schedulePoll = () => {
    if (disposed) return;
    if (pollTimer) window.clearTimeout(pollTimer);
    const delay = document.hidden ? REMINDER_POLL_HIDDEN_MS : REMINDER_POLL_VISIBLE_MS;
    pollTimer = window.setTimeout(async () => {
      await refreshReminders({ emit: true });
      schedulePoll();
    }, delay);
  };
  const handleVisibility = () => schedulePoll();
  const handleRefresh = () => {
    void refreshReminders({ emit: true });
  };
  document.addEventListener("visibilitychange", handleVisibility);
  window.addEventListener(REMINDER_REFRESH_EVENT, handleRefresh);
  void refreshReminders({ emit: false });
  schedulePoll();

  return {
    rootPath,
    unsubscribe: () => {
      disposed = true;
      unsubscribe?.();
      if (pollTimer) window.clearTimeout(pollTimer);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener(REMINDER_REFRESH_EVENT, handleRefresh);
    },
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
  const reminder = await createCanonicalReminder(mapReminderToDb({
    ...payload,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }));
  requestReminderRefresh();
  return reminder?.id || "";
}

export async function updateReminder(rootPath, reminderId, payload = {}) {
  const safeReminderId = String(reminderId || "").trim();
  if (!safeReminderId) return;
  await updateCanonicalReminder(safeReminderId, mapReminderToDb({
    ...payload,
    updatedAt: Date.now(),
  }));
  requestReminderRefresh();
}

export async function deleteReminder(rootPath, reminderId) {
  const safeReminderId = String(reminderId || "").trim();
  if (!safeReminderId) return;
  await deleteCanonicalReminder(safeReminderId);
  requestReminderRefresh();
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
  requestReminderRefresh();
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
