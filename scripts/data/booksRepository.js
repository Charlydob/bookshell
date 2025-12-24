import {
  ref,
  onValue,
  push,
  set,
  update,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";
import {
  db,
  storage,
  BOOKS_PATH,
  READING_LOG_PATH,
  META_GENRES_PATH
} from "./firebase.js";
import { todayKey } from "../state/dateUtils.js";

/**
 * Observa los libros en Firebase RTDB.
 * @param {(books: Record<string, any>) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeToBooks(handler) {
  const off = onValue(ref(db, BOOKS_PATH), (snap) => {
    handler(snap.val() || {});
  });
  return () => off();
}

/**
 * Observa el log de lectura en Firebase RTDB.
 * @param {(log: Record<string, any>) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeToReadingLog(handler) {
  const off = onValue(ref(db, READING_LOG_PATH), (snap) => {
    handler(snap.val() || {});
  });
  return () => off();
}

/**
 * Observa la lista de géneros guardada en Firebase.
 * @param {(genres: unknown) => void} handler
 * @returns {() => void} unsubscribe
 */
export function subscribeToGenres(handler) {
  const off = onValue(ref(db, META_GENRES_PATH), (snap) => handler(snap.val()));
  return () => off();
}

/**
 * Persiste la lista de géneros en Firebase.
 * @param {string[]} genres
 */
export async function saveGenres(genres) {
  await set(ref(db, META_GENRES_PATH), genres);
}

/**
 * Guarda o actualiza un libro.
 * @param {string|null} id
 * @param {Record<string, any>} bookData
 * @returns {Promise<string>} id del libro
 */
export async function saveBookRecord(id, bookData) {
  if (id) {
    await update(ref(db, `${BOOKS_PATH}/${id}`), bookData);
    return id;
  }

  const newRef = push(ref(db, BOOKS_PATH));
  await set(newRef, {
    ...bookData,
    createdAt: Date.now()
  });
  return newRef.key;
}

/**
 * Sube un PDF asociado a un libro.
 * @param {string|null} bookId
 * @param {File} file
 * @returns {Promise<{ url: string, storageId: string }>}
 */
export async function uploadBookPdf(bookId, file) {
  const safeId = bookId || push(ref(db, "_tmp")).key;
  const pdfRef = storageRef(storage, `pdfs/${safeId}.pdf`);
  await uploadBytes(pdfRef, file);
  const url = await getDownloadURL(pdfRef);
  return { url, storageId: safeId };
}

/**
 * Marca o desmarca un libro como favorito.
 * @param {string} bookId
 * @param {boolean} favorite
 */
export async function updateBookFavorite(bookId, favorite) {
  await update(ref(db, `${BOOKS_PATH}/${bookId}`), {
    favorite: !!favorite,
    updatedAt: Date.now()
  });
}

/**
 * Actualiza el progreso de un libro y registra el delta en el log de lectura.
 * @param {string} bookId
 * @param {number} newPage
 */
export async function updateBookProgress(bookId, newPage) {
  let diff = 0;

  const bookRef = ref(db, `${BOOKS_PATH}/${bookId}`);
  const res = await runTransaction(bookRef, (book) => {
    if (!book) return;

    const total = Number(book.pages) || 0;
    const oldPage = Math.max(0, Math.min(total, Number(book.currentPage) || 0));
    const safeNew = Math.max(0, Math.min(total, Number(newPage) || 0));
    diff = safeNew - oldPage;

    const updates = {
      ...book,
      currentPage: safeNew,
      updatedAt: Date.now()
    };

    const shouldFinish = total > 0 && safeNew >= total;
    const wasFinished =
      book.status === "finished" || (total > 0 && (Number(book.currentPage) || 0) >= total);
    updates.finishedPast = shouldFinish ? false : !!book.finishedPast;

    if (shouldFinish && (!wasFinished || !book.finishedOn)) {
      updates.status = "finished";
      updates.finishedAt = Date.now();
      updates.finishedOn = book.finishedOn || todayKey();
    } else if (!shouldFinish && wasFinished) {
      updates.status = "reading";
      updates.finishedAt = null;
      updates.finishedOn = null;
    }

    return updates;
  });

  if (res?.committed && diff !== 0) {
    const day = todayKey();
    const logRef = ref(db, `${READING_LOG_PATH}/${day}/${bookId}`);
    await runTransaction(logRef, (current) => {
      const prev = Number(current) || 0;
      const next = Math.max(0, prev + diff);
      return next === 0 ? null : next;
    });
  }
}

/**
 * Marca un libro como terminado.
 * @param {string} bookId
 * @param {Record<string, any>} book
 */
export async function markBookFinished(bookId, book) {
  await update(ref(db, `${BOOKS_PATH}/${bookId}`), {
    status: "finished",
    currentPage: book.pages || book.currentPage || 0,
    finishedPast: false,
    finishedAt: Date.now(),
    finishedOn: book.finishedOn || todayKey(),
    updatedAt: Date.now()
  });
}
