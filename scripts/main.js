// main.js
// main.js
import {
  initializeApp,
  getApps,
  getApp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase,
  ref,
  onValue,
  push,
  set,
  update,
  runTransaction
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import {
  getStorage,
  ref as storageRef,
  uploadBytes,
  getDownloadURL
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js";

// === Firebase ===
const firebaseConfig = {
  apiKey: "AIzaSyC1oqRk7GpYX854RfcGrYHt6iRun5TfuYE",
  authDomain: "bookshell-59703.firebaseapp.com",
  databaseURL: "https://bookshell-59703-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bookshell-59703",
  storageBucket: "bookshell-59703.appspot.com",
  messagingSenderId: "554557230752",
  appId: "1:554557230752:web:37c24e287210433cf883c5"
};

const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getDatabase(app);
const storage = getStorage(app);

// Rutas base (sin auth, un solo usuario)
const BOOKS_PATH = "books";
const READING_LOG_PATH = "readingLog";

// === Estado en memoria ===
let books = {};
let readingLog = {}; // { "YYYY-MM-DD": { bookId: pages } }

let currentCalYear;
let currentCalMonth; // 0-11

// === Utilidades fecha ===
function todayKey() {
  const d = new Date();
  return d.toISOString().slice(0, 10); // YYYY-MM-DD
}

function dateKeyFromTimestamp(ts) {
  if (!ts) return null;
  try {
    return new Date(ts).toISOString().slice(0, 10);
  } catch (_) {
    return null;
  }
}

function formatMonthLabel(year, month) {
  const names = [
    "enero","febrero","marzo","abril","mayo","junio",
    "julio","agosto","septiembre","octubre","noviembre","diciembre"
  ];
  return `${names[month]} ${year}`;
}

function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

// === UI refs ===
const $viewBooks = document.getElementById("view-books");
const $viewStats = document.getElementById("view-stats");
const $booksList = document.getElementById("books-list");
const $booksEmpty = document.getElementById("books-empty");
const $booksListActive = document.getElementById("books-list-active") || document.getElementById("books-list");
const $booksFinishedSection = document.getElementById("books-finished-section");
const $booksFinishedCount = document.getElementById("books-finished-count");
const $booksListFinished = document.getElementById("books-list-finished");
const $btnAddBook = document.getElementById("btn-add-book");

const $navButtons = document.querySelectorAll(".nav-btn");

const $modalBackdrop = document.getElementById("book-modal-backdrop");
const $modalTitle = document.getElementById("book-modal-title");
const $modalClose = document.getElementById("book-modal-close");
const $modalCancel = document.getElementById("book-modal-cancel");
const $bookForm = document.getElementById("book-form");

const $bookId = document.getElementById("book-id");
const $bookTitle = document.getElementById("book-title");
const $bookAuthor = document.getElementById("book-author");
const $bookYear = document.getElementById("book-year");
const $bookPages = document.getElementById("book-pages");
const $bookCurrentPage = document.getElementById("book-current-page");
const $bookGenre = document.getElementById("book-genre");
const $bookLanguage = document.getElementById("book-language");
const $bookStatus = document.getElementById("book-status");
const $bookPdf = document.getElementById("book-pdf");

// Stats
const $statStreakCurrent = document.getElementById("stat-streak-current");
const $statStreakBest = document.getElementById("stat-streak-best");
const $statTodayPages = document.getElementById("stat-today-pages");
const $statPagesTotal = document.getElementById("stat-pages-total");

// Libros leídos
const $statBooksRead = document.getElementById("stat-books-read");
const $statBooksReadRange = document.getElementById("stat-books-read-range");
const $statBooksReadCard = document.getElementById("stat-books-read-card");


// Calendario
const $calPrev = document.getElementById("cal-prev");
const $calNext = document.getElementById("cal-next");
const $calLabel = document.getElementById("cal-label");
const $calGrid = document.getElementById("calendar-grid");

// Selector rango libros leídos
if ($statBooksReadRange) {
  $statBooksReadRange.addEventListener("change", () => renderStats());
}
if ($statBooksReadCard && $statBooksReadRange) {
  $statBooksReadCard.addEventListener("click", (e) => {
    if (e.target === $statBooksReadRange) return;
    $statBooksReadRange.focus();
    try { $statBooksReadRange.click(); } catch (_) {}
  });
}

// === Navegación ===
$navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    const viewId = btn.dataset.view;
    document.querySelectorAll(".view").forEach(v => v.classList.remove("view-active"));
    document.getElementById(viewId).classList.add("view-active");

    $navButtons.forEach(b => b.classList.remove("nav-btn-active"));
    btn.classList.add("nav-btn-active");

    if (viewId === "view-books") {
      renderStats();
      renderCalendar();
    }
  });
});


// === Modal libro ===
function openBookModal(bookId = null) {
  if (bookId && books[bookId]) {
    const b = books[bookId];
    $modalTitle.textContent = "Editar libro";
    $bookId.value = bookId;
    $bookTitle.value = b.title || "";
    $bookAuthor.value = b.author || "";
    $bookYear.value = b.year || "";
    $bookPages.value = b.pages || "";
    $bookCurrentPage.value = b.currentPage ?? 0;
    $bookGenre.value = b.genre || "";
    $bookLanguage.value = b.language || "";
    $bookStatus.value = b.status || "reading";
  } else {
    $modalTitle.textContent = "Nuevo libro";
    $bookId.value = "";
    $bookForm.reset();
    $bookCurrentPage.value = 0;
    $bookStatus.value = "reading";
  }
  $bookPdf.value = "";
  $modalBackdrop.classList.remove("hidden");
}

function closeBookModal() {
  $modalBackdrop.classList.add("hidden");
}

$btnAddBook.addEventListener("click", () => openBookModal());
$modalClose.addEventListener("click", closeBookModal);
$modalCancel.addEventListener("click", closeBookModal);

$modalBackdrop.addEventListener("click", (e) => {
  if (e.target === $modalBackdrop) closeBookModal();
});

// Guardar libro
$bookForm.addEventListener("submit", async (e) => {
  e.preventDefault();

  const id = $bookId.value || null;
  const title = $bookTitle.value.trim();
  if (!title) return;

  const pages = parseInt($bookPages.value, 10) || 0;
  const currentPage = Math.max(0, Math.min(pages, parseInt($bookCurrentPage.value, 10) || 0));

  const bookData = {
    title,
    author: $bookAuthor.value.trim() || null,
    year: $bookYear.value ? parseInt($bookYear.value, 10) : null,
    pages,
    currentPage,
    genre: $bookGenre.value.trim() || null,
    language: $bookLanguage.value.trim() || null,
    status: $bookStatus.value || "reading",
    updatedAt: Date.now()
  };

  // Gestión robusta de "terminado":
  // - si pasa a finished => fijamos fecha
  // - si sale de finished => borramos fecha (para que el calendario/contadores se corrijan)
  const prevBook = id && books[id] ? books[id] : null;
  const prevWasFinished = prevBook?.status === "finished" || ((Number(prevBook?.pages) || 0) > 0 && (Number(prevBook?.currentPage) || 0) >= (Number(prevBook?.pages) || 0));
  const nowIsFinished = bookData.status === "finished" || (bookData.pages > 0 && bookData.currentPage >= bookData.pages);

  if (nowIsFinished && !prevWasFinished) {
    bookData.status = "finished";
    bookData.finishedAt = Date.now();
    bookData.finishedOn = todayKey();
  } else if (!nowIsFinished && prevWasFinished) {
    // RTDB: null => elimina la propiedad
    bookData.finishedAt = null;
    bookData.finishedOn = null;
  }


  // Opcional: subir PDF solo si el usuario selecciona archivo
  const file = $bookPdf.files[0];
  if (file) {
    try {
      const safeId = id || push(ref(db, "_tmp")).key;
      const pdfRef = storageRef(storage, `pdfs/${safeId}.pdf`);
      await uploadBytes(pdfRef, file);
      const url = await getDownloadURL(pdfRef);
      bookData.pdfUrl = url;
      if (!id) bookData._fixedStorageId = safeId;
    } catch (err) {
      console.error("Error subiendo PDF", err);
    }
  }

  try {
    if (id) {
      await update(ref(db, `${BOOKS_PATH}/${id}`), bookData);
    } else {
      const newRef = push(ref(db, BOOKS_PATH));
      await set(newRef, {
        ...bookData,
        createdAt: Date.now()
      });
    }
  } catch (err) {
    console.error("Error guardando libro", err);
  }

  closeBookModal();
});

// === Escucha Firebase libros ===
onValue(ref(db, BOOKS_PATH), (snap) => {
  books = snap.val() || {};
  renderBooks();
});

// Escucha log lectura
onValue(ref(db, READING_LOG_PATH), (snap) => {
  readingLog = snap.val() || {};
  renderStats();
  renderCalendar();
});


// === Render libros ===
function isBookFinished(b) {
  const total = Number(b?.pages) || 0;
  const current = Number(b?.currentPage) || 0;
  return b?.status === "finished" || (total > 0 && current >= total);
}

function renderBooks() {
  const idsAll = Object.keys(books || {});
  const hasFinishedUI = !!($booksFinishedSection && $booksListFinished);

  if (!idsAll.length) {
    if ($booksListActive) $booksListActive.innerHTML = "";
    if (hasFinishedUI) {
      $booksListFinished.innerHTML = "";
      $booksFinishedSection.style.display = "none";
      if ($booksFinishedCount) $booksFinishedCount.textContent = "0";
    }
    $booksEmpty.style.display = "block";
    return;
  }

  const activeIds = [];
  const finishedIds = [];

  idsAll.forEach((id) => {
    const b = books[id];
    (isBookFinished(b) ? finishedIds : activeIds).push(id);
  });

  const sortByUpdatedDesc = (a, b) => (books[b]?.updatedAt || 0) - (books[a]?.updatedAt || 0);
  const sortByFinishedDesc = (a, b) => {
    const ta = books[a]?.finishedAt || books[a]?.updatedAt || 0;
    const tb = books[b]?.finishedAt || books[b]?.updatedAt || 0;
    return tb - ta;
  };

  activeIds.sort(sortByUpdatedDesc);
  finishedIds.sort(sortByFinishedDesc);

  $booksEmpty.style.display = (activeIds.length === 0 && finishedIds.length === 0) ? "block" : "none";

  const buildCard = (id) => {
    const b = books[id];
    const total = Number(b?.pages) || 0;
    const current = Math.min(total, Number(b?.currentPage) || 0);
    const percent = total > 0 ? Math.round((current / total) * 100) : 0;
    const finished = isBookFinished(b) || percent >= 100;

    const card = document.createElement("article");
    card.className = "book-card" + (finished ? " book-card-finished" : "");
    card.dataset.id = id;

    const prog = document.createElement("div");
    prog.className = "book-progress";
    prog.innerHTML = `
      <div class="progress-ring${finished ? " is-finished" : ""}" style="--p:${percent}">
        <div class="progress-ring-inner">${percent}%</div>
      </div>
    `;

    const main = document.createElement("div");
    main.className = "book-main";

    const titleRow = document.createElement("div");
    titleRow.className = "book-title-row";

    const titleEl = document.createElement("div");
    titleEl.className = "book-title";
    titleEl.textContent = b?.title || "Sin título";

    const status = document.createElement("span");
    status.className = "book-status-pill";
    status.textContent =
      finished ? "Terminado" :
      b?.status === "planned" ? "Pendiente" : "Leyendo";

    titleRow.appendChild(titleEl);
    titleRow.appendChild(status);

    const meta = document.createElement("div");
    meta.className = "book-meta";
    const metaBits = [];
    if (b?.author) metaBits.push(b.author);
    if (b?.year) metaBits.push(String(b.year));
    if (b?.genre) metaBits.push(b.genre);
    if (b?.language) metaBits.push(b.language);
    meta.innerHTML = metaBits.map((m) => `<span>${m}</span>`).join("");

    const pagesRow = document.createElement("div");
    pagesRow.className = "book-pages-row";
    pagesRow.innerHTML = `
      <span>Pág. ${current} / ${total}</span>
      <span>${percent}% leído</span>
    `;

    const actions = document.createElement("div");
    actions.className = "book-actions";

    const pageInput = document.createElement("div");
    pageInput.className = "book-page-input";
    pageInput.innerHTML = `
      <span>Página actual</span>
      <input type="number" min="0" inputmode="numeric" value="${current}" />
    `;

    const buttons = document.createElement("div");
    buttons.className = "book-card-buttons";

    const btnEdit = document.createElement("button");
    btnEdit.className = "btn";
    btnEdit.textContent = "Editar";
    btnEdit.addEventListener("click", () => openBookModal(id));

    const btnDone = document.createElement("button");
    btnDone.className = "btn";
    btnDone.textContent = "Terminado";
    btnDone.addEventListener("click", () => markBookFinished(id));

    buttons.appendChild(btnEdit);
    if (!finished) buttons.appendChild(btnDone);

    const inputEl = pageInput.querySelector("input");
    inputEl.addEventListener("change", () => {
      const newVal = parseInt(inputEl.value, 10) || 0;
      const safe = Math.max(0, Math.min(total, newVal));
      inputEl.value = safe;
      updateBookProgress(id, safe);
    });

    actions.appendChild(pageInput);
    actions.appendChild(buttons);

    main.appendChild(titleRow);
    main.appendChild(meta);
    main.appendChild(pagesRow);
    main.appendChild(actions);

    card.appendChild(prog);
    card.appendChild(main);

    return card;
  };

  // Render activos
  if ($booksListActive) {
    const fragA = document.createDocumentFragment();
    activeIds.forEach((id) => fragA.appendChild(buildCard(id)));
    $booksListActive.innerHTML = "";
    $booksListActive.appendChild(fragA);
  }

  // Render terminados (plegable)
  if (hasFinishedUI) {
    if (finishedIds.length) {
      $booksFinishedSection.style.display = "block";
      if ($booksFinishedCount) $booksFinishedCount.textContent = String(finishedIds.length);

      const fragF = document.createDocumentFragment();
      finishedIds.forEach((id) => fragF.appendChild(buildCard(id)));
      $booksListFinished.innerHTML = "";
      $booksListFinished.appendChild(fragF);
    } else {
      $booksListFinished.innerHTML = "";
      $booksFinishedSection.style.display = "none";
      if ($booksFinishedCount) $booksFinishedCount.textContent = "0";
    }
  }
}

// === Actualizar progreso y log de lectura ===
async function updateBookProgress(bookId, newPage) {
  const book = books[bookId];
  if (!book) return;
  const total = book.pages || 0;
  const oldPage = Math.max(0, Math.min(total, book.currentPage || 0));
  const safeNew = Math.max(0, Math.min(total, newPage));

  const diff = safeNew - oldPage;
  
const updates = {
  currentPage: safeNew,
  updatedAt: Date.now()
};

// Auto-finish / auto-unfinish (para que el calendario/contadores se corrijan al editar)
const shouldFinish = total > 0 && safeNew >= total;
const wasFinished = book.status === "finished" || (total > 0 && (Number(book.currentPage) || 0) >= total);

if (shouldFinish && (!wasFinished || !book.finishedOn)) {
  updates.status = "finished";
  updates.finishedAt = Date.now();
  updates.finishedOn = book.finishedOn || todayKey();
} else if (!shouldFinish && wasFinished) {
  // Si bajamos por debajo del total, quitamos "terminado"
  updates.status = "reading";
  updates.finishedAt = null;
  updates.finishedOn = null;
}


  try {
    await update(ref(db, `${BOOKS_PATH}/${bookId}`), updates);

    // Registramos páginas leídas del día como DELTA editable (si corriges, se corrige)
    if (diff !== 0) {
      const day = todayKey();
      const logRef = ref(db, `${READING_LOG_PATH}/${day}/${bookId}`);
      await runTransaction(logRef, (current) => {
        const prev = Number(current) || 0;
        const next = Math.max(0, prev + diff);
        return next === 0 ? null : next; // null => borra el nodo
      });
    }
  } catch (err) {
    console.error("Error actualizando progreso", err);
  }
}

// === Marcar libro terminado ===
async function markBookFinished(bookId) {
  const book = books[bookId];
  if (!book) return;
  try {
    
await update(ref(db, `${BOOKS_PATH}/${bookId}`), {
  status: "finished",
  currentPage: book.pages || book.currentPage || 0,
  finishedAt: Date.now(),
  finishedOn: book.finishedOn || todayKey(),
  updatedAt: Date.now()
});
  } catch (err) {
    console.error("Error marcando terminado", err);
  }
}

// === Stats + streak ===


// === Libros terminados: fechas ===
function getFinishDateForBook(bookId) {
  const b = books?.[bookId];
  if (!b) return null;

  // preferimos fecha explícita
  if (b.finishedOn) return b.finishedOn;

  const total = Number(b.pages) || 0;
  if (!total) return null;

  // Inferimos: primer día en el que el acumulado alcanza el total
  const days = Object.keys(readingLog || {}).sort();
  let acc = 0;
  for (const day of days) {
    const perBook = readingLog?.[day] || {};
    const n = Number(perBook?.[bookId]) || 0;
    if (n > 0) {
      acc += n;
      if (acc >= total) return day;
    }
  }

  // fallback suave
  return dateKeyFromTimestamp(b.updatedAt) || null;
}

function computeFinishedByDay() {
  const map = {}; // { YYYY-MM-DD: count }
  Object.keys(books || {}).forEach((id) => {
    const b = books[id];
    const total = Number(b?.pages) || 0;
    const current = Number(b?.currentPage) || 0;
    const isFinished = b?.status === "finished" || (total > 0 && current >= total);
    if (!isFinished) return;

    const day = getFinishDateForBook(id);
    if (!day) return;
    map[day] = (map[day] || 0) + 1;
  });
  return map;
}

function getWeekBoundsKey(anchorDate = new Date()) {
  const d = new Date(anchorDate);
  const day = (d.getDay() + 6) % 7; // lunes=0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return {
    from: monday.toISOString().slice(0, 10),
    to: sunday.toISOString().slice(0, 10)
  };
}

function computeBooksReadCount(range = "total") {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const prefixMonth = `${y}-${m}-`;
  const prefixYear = `${y}-`;
  const week = getWeekBoundsKey(today);

  let count = 0;
  Object.keys(books || {}).forEach((id) => {
    const b = books[id];
    const total = Number(b?.pages) || 0;
    const current = Number(b?.currentPage) || 0;
    const isFinished = b?.status === "finished" || (total > 0 && current >= total);
    if (!isFinished) return;

    const day = getFinishDateForBook(id);
    if (!day) return;

    if (range === "month") {
      if (!day.startsWith(prefixMonth)) return;
    } else if (range === "year") {
      if (!day.startsWith(prefixYear)) return;
    } else if (range === "week") {
      if (day < week.from || day > week.to) return;
    }

    count += 1;
  });
  return count;
}
function computeDailyTotals() {
  const totals = {}; // { date: totalPages }
  Object.entries(readingLog || {}).forEach(([day, perBook]) => {
    let sum = 0;
    Object.values(perBook || {}).forEach((n) => {
      sum += Number(n) || 0;
    });
    totals[day] = sum;
  });
  return totals;
}

function computeStreaks() {
  const totals = computeDailyTotals();
  const days = Object.keys(totals).filter((d) => totals[d] > 0);
  if (!days.length) return { current: 0, best: 0 };

  days.sort(); // YYYY-MM-DD

  let best = 1;
  let current = 1;

  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const curr = new Date(days[i]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      current += 1;
      if (current > best) best = current;
    } else {
      current = 1;
    }
  }

  // Racha actual debe ser la que llega hasta el día más reciente
  const latestDay = days[days.length - 1];
  const today = todayKey();
  if (latestDay !== today) {
    // si el último día con lectura no es hoy, comprobamos si ayer fue
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yKey = yesterday.toISOString().slice(0, 10);
    if (latestDay !== yKey) {
      current = 0;
    }
  }

  return { current, best };
}

function renderStats() {
  const totals = computeDailyTotals();
  const today = todayKey();
  const todayPages = totals[today] || 0;

  let totalAll = 0;
  Object.values(totals).forEach((n) => {
    totalAll += Number(n) || 0;
  });

  const { current, best } = computeStreaks();

  $statTodayPages.textContent = todayPages;
  $statStreakCurrent.textContent = current;
  $statStreakBest.textContent = best;
  if ($statPagesTotal) {
    $statPagesTotal.textContent = totalAll;
  }

if ($statBooksRead) {
  const range = $statBooksReadRange ? $statBooksReadRange.value : "total";
  $statBooksRead.textContent = computeBooksReadCount(range);
}

}


// === Calendario ===
function renderCalendar() {
  const now = new Date();
  if (currentCalYear == null) {
    currentCalYear = now.getFullYear();
    currentCalMonth = now.getMonth();
  }

  $calLabel.textContent = formatMonthLabel(currentCalYear, currentCalMonth);

  const totals = computeDailyTotals();
  const finishedByDay = computeFinishedByDay();

  const firstDay = new Date(currentCalYear, currentCalMonth, 1).getDay(); // 0-6
  const offset = (firstDay + 6) % 7; // hacer lunes=0

  const daysInMonth = getDaysInMonth(currentCalYear, currentCalMonth);

  // Dias con racha para pintar
  const streakInfo = computeStreakDates(totals);
  const streakDays = new Set(streakInfo.streakDays || []);

  const frag = document.createDocumentFragment();

  const totalCells = offset + daysInMonth;
  for (let i = 0; i < totalCells; i++) {
    const cell = document.createElement("div");

    if (i < offset) {
      cell.className = "cal-cell cal-cell-empty";
    } else {
      const dayNum = i - offset + 1;
      const d = new Date(currentCalYear, currentCalMonth, dayNum);
      const key = d.toISOString().slice(0, 10);
      const pages = totals[key] || 0;
      const finishedCount = finishedByDay[key] || 0;

      cell.className = "cal-cell";
      if (pages > 0) {
        cell.classList.add("cal-cell-has-pages");
      }
      if (streakDays.has(key)) {
        cell.classList.add("cal-cell-highlight");
      }
      if (finishedCount > 0) {
        cell.classList.add("cal-cell-finished");
      }

      const num = document.createElement("div");
      num.className = "cal-day-number";
      num.textContent = String(dayNum);

      const p = document.createElement("div");
      p.className = "cal-pages";
      p.textContent = pages > 0 ? `${pages} pág` : "";

      cell.appendChild(num);
      cell.appendChild(p);

      if (finishedCount > 0) {
        const fin = document.createElement("div");
        fin.className = "cal-finished";
        fin.textContent = finishedCount === 1 ? "✅" : `✅ x${finishedCount}`;
        cell.appendChild(fin);
      }
    }

    frag.appendChild(cell);
  }

  $calGrid.innerHTML = "";
  $calGrid.appendChild(frag);
}

// Devuelve lista de días que forman la racha (para pintar en amarillo)
function computeStreakDates(totals) {
  const days = Object.keys(totals).filter((d) => totals[d] > 0);
  if (!days.length) return { streakDays: [] };

  days.sort();
  let bestRun = [];
  let currentRun = [days[0]];

  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]);
    const curr = new Date(days[i]);
    const diff = (curr - prev) / (1000 * 60 * 60 * 24);
    if (diff === 1) {
      currentRun.push(days[i]);
    } else {
      if (currentRun.length > bestRun.length) {
        bestRun = currentRun.slice();
      }
      currentRun = [days[i]];
    }
  }
  if (currentRun.length > bestRun.length) {
    bestRun = currentRun.slice();
  }

  // Racha actual: secuencia que toca al día más reciente
  const lastDay = days[days.length - 1];
  const today = todayKey();
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yKey = yesterday.toISOString().slice(0, 10);

  let activeRun = [];
  if (lastDay === today || lastDay === yKey) {
    // reconstruimos run que termina en lastDay
    let run = [lastDay];
    for (let i = days.length - 2; i >= 0; i--) {
      const curr = new Date(days[i]);
      const next = new Date(days[i + 1]);
      const diff = (next - curr) / (1000 * 60 * 60 * 24);
      if (diff === 1) {
        run.unshift(days[i]);
      } else {
        break;
      }
    }
    activeRun = run;
  }

  // Pintamos la racha activa; si no hay, pintamos la mejor
  const streakDays = (activeRun.length ? activeRun : bestRun).slice();
  return { streakDays };
}

// Navegación calendario
$calPrev.addEventListener("click", () => {
  if (currentCalMonth === 0) {
    currentCalMonth = 11;
    currentCalYear -= 1;
  } else {
    currentCalMonth -= 1;
  }
  renderCalendar();
});

$calNext.addEventListener("click", () => {
  if (currentCalMonth === 11) {
    currentCalMonth = 0;
    currentCalYear += 1;
  } else {
    currentCalMonth += 1;
  }
  renderCalendar();
});
