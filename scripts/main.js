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
let bookDetailId = null;

let currentCalYear;
let currentCalMonth; // 0-11
let calViewMode = "month";

// === Utilidades fecha ===
function dateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return dateKeyLocal(new Date());
}

function dateKeyFromTimestamp(ts) {
  if (!ts) return null;
  try {
    return dateKeyLocal(new Date(ts));
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
const $bookPdf = document.getElementById("book-pdf"); // puede ser null si no usamos PDF
const $bookFavorite = document.getElementById("book-favorite");
const $bookFinishedPast = document.getElementById("book-finished-past");
const $bookFinishedPast = document.getElementById("book-finished-past");

const $booksShelfSearch = document.getElementById("books-shelf-search");
const $booksShelfResults = document.getElementById("books-shelf-results");
const $booksShelfEmpty = document.getElementById("books-shelf-empty");

const $bookDetailBackdrop = document.getElementById("book-detail-backdrop");
const $bookDetailTitle = document.getElementById("book-detail-title");
const $bookDetailClose = document.getElementById("book-detail-close");
const $bookDetailCloseBtn = document.getElementById("book-detail-close-btn");
const $bookDetailFavorite = document.getElementById("book-detail-favorite");
const $bookDetailStatus = document.getElementById("book-detail-status");
const $bookDetailAuthor = document.getElementById("book-detail-author");
const $bookDetailYear = document.getElementById("book-detail-year");
const $bookDetailGenre = document.getElementById("book-detail-genre");
const $bookDetailLanguage = document.getElementById("book-detail-language");
const $bookDetailPages = document.getElementById("book-detail-pages");
const $bookDetailProgress = document.getElementById("book-detail-progress");
const $bookDetailFinished = document.getElementById("book-detail-finished");
const $bookDetailNotes = document.getElementById("book-detail-notes");
const $bookDetailEdit = document.getElementById("book-detail-edit");

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
const $calViewMode = document.getElementById("cal-view-mode");
const $calSummary = document.getElementById("calendar-summary");

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

if ($booksShelfSearch) {
  $booksShelfSearch.addEventListener("input", () => renderBooks());
}

function closeBookDetail() {
  bookDetailId = null;
  if ($bookDetailBackdrop) $bookDetailBackdrop.classList.add("hidden");
}

function fillDetail($el, value, fallback = "—") {
  if ($el) $el.textContent = value || fallback;
}

function formatBookStatusLabel(b) {
  if (!b) return "—";
  if (isBookFinished(b)) return "Terminado";
  if (b.status === "planned") return "Pendiente";
  return "Leyendo";
}

async function handleFavoriteToggle(bookId, isFav) {
  await updateBookFavorite(bookId, isFav);
  if (books && books[bookId]) {
    books[bookId].favorite = !!isFav;
    renderBooks();
  }
}

function openBookDetail(bookId) {
  if (!$bookDetailBackdrop || !books?.[bookId]) return;
  const b = books[bookId];
  bookDetailId = bookId;

  fillDetail($bookDetailTitle, b.title || "Sin título");
  fillDetail($bookDetailAuthor, b.author || "—");
  fillDetail($bookDetailYear, b.year ? String(b.year) : "—");
  fillDetail($bookDetailGenre, b.genre || "—");
  fillDetail($bookDetailLanguage, b.language || "—");
  fillDetail($bookDetailPages, b.pages ? `${b.pages} pág` : "—");

  const total = Number(b.pages) || 0;
  const current = Number(b.currentPage) || 0;
  const percent = total > 0 ? Math.round((Math.min(current, total) / total) * 100) : 0;
  fillDetail($bookDetailProgress, total > 0 ? `${current} / ${total} (${percent}%)` : "—");

  const finishDate = getFinishDateForBook(bookId);
  fillDetail($bookDetailFinished, finishDate || "—");
  fillDetail($bookDetailStatus, formatBookStatusLabel(b));

  const notes = b.notes || b.description || "Sin notas";
  fillDetail($bookDetailNotes, notes);

  if ($bookDetailFavorite) {
    $bookDetailFavorite.checked = !!b.favorite;
    $bookDetailFavorite.onchange = () => handleFavoriteToggle(bookId, $bookDetailFavorite.checked);
  }

  $bookDetailBackdrop.classList.remove("hidden");
}

if ($bookDetailClose) $bookDetailClose.addEventListener("click", closeBookDetail);
if ($bookDetailCloseBtn) $bookDetailCloseBtn.addEventListener("click", closeBookDetail);
if ($bookDetailBackdrop) {
  $bookDetailBackdrop.addEventListener("click", (e) => {
    if (e.target === $bookDetailBackdrop) closeBookDetail();
  });
}
if ($bookDetailEdit) {
  $bookDetailEdit.addEventListener("click", () => {
    if (!bookDetailId) return;
    const id = bookDetailId;
    closeBookDetail();
    openBookModal(id);
  });
}


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
    if ($bookFavorite) $bookFavorite.checked = !!b.favorite;
    if ($bookFinishedPast) $bookFinishedPast.checked = !!b.finishedPast;
  } else {
    $modalTitle.textContent = "Nuevo libro";
    $bookId.value = "";
    $bookForm.reset();
    $bookCurrentPage.value = 0;
    $bookStatus.value = "reading";
    if ($bookFavorite) $bookFavorite.checked = false;
    if ($bookFinishedPast) $bookFinishedPast.checked = false;
  }
  if ($bookPdf) $bookPdf.value = "";
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
  const selectedStatus = $bookStatus.value || "reading";
  const finishedPast = $bookFinishedPast ? !!$bookFinishedPast.checked : false;
  let currentPage = Math.max(0, Math.min(pages, parseInt($bookCurrentPage.value, 10) || 0));

  if (selectedStatus === "finished" && pages > 0) {
    currentPage = pages;
  }

  const bookData = {
    title,
    author: $bookAuthor.value.trim() || null,
    year: $bookYear.value ? parseInt($bookYear.value, 10) : null,
    pages,
    currentPage,
    genre: $bookGenre.value.trim() || null,
    language: $bookLanguage.value.trim() || null,
    status: selectedStatus,
    favorite: $bookFavorite ? !!$bookFavorite.checked : false,
    finishedPast: false,
    updatedAt: Date.now()
  };

  // Gestión robusta de "terminado":
  // - si pasa a finished => fijamos fecha
  // - si sale de finished => borramos fecha (para que el calendario/contadores se corrijan)
  const prevBook = id && books[id] ? books[id] : null;
  const prevWasFinished = prevBook?.status === "finished" || ((Number(prevBook?.pages) || 0) > 0 && (Number(prevBook?.currentPage) || 0) >= (Number(prevBook?.pages) || 0));
  const nowIsFinished = bookData.status === "finished" || (bookData.pages > 0 && bookData.currentPage >= bookData.pages);

  if (nowIsFinished) {
    bookData.status = "finished";
    const keepPast = !!prevBook?.finishedPast && finishedPast;
    bookData.finishedPast = finishedPast || keepPast;
    if (finishedPast) {
      bookData.finishedAt = null;
      bookData.finishedOn = null;
    } else if (!prevWasFinished || prevBook?.finishedPast) {
      bookData.finishedAt = Date.now();
      bookData.finishedOn = prevBook?.finishedOn || todayKey();
    }
  } else if (!nowIsFinished && prevWasFinished) {
    // RTDB: null => elimina la propiedad
    bookData.finishedAt = null;
    bookData.finishedOn = null;
    bookData.finishedPast = false;
  }


  // Opcional: subir PDF solo si el usuario selecciona archivo
  const file = ($bookPdf && $bookPdf.files) ? $bookPdf.files[0] : null;
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

function matchesShelfQuery(book, query) {
  if (!query) return true;
  const q = query.toLowerCase();
  const fields = [
    book?.title,
    book?.author,
    book?.genre,
    book?.language,
    book?.status,
    book?.year,
    book?.pages
  ];
  return fields.some((f) => String(f || "").toLowerCase().includes(q));
}

const spinePalettes = [
  ["#f7b500", "#ff6f61"],
  ["#6dd5ed", "#2193b0"],
  ["#8e2de2", "#4a00e0"],
  ["#00b09b", "#96c93d"],
  ["#ff758c", "#ff7eb3"],
  ["#4158d0", "#c850c0"],
  ["#f83600", "#fe8c00"],
  ["#43cea2", "#185a9d"],
  ["#ffd700", "#f37335"]
];

function pickSpinePalette(seed = "") {
  const hash = Array.from(seed).reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return spinePalettes[hash % spinePalettes.length];
}

function buildFinishedSpine(id) {
  const b = books[id] || {};
  const title = b.title || "Sin título";
  const total = Number(b.pages) || 0;
  const finishDate = getFinishDateForBook(id);
  const favorite = !!b.favorite;
  const [c1, c2] = favorite ? ["#f8e6aa", "#d3a74a"] : pickSpinePalette(title + id);

  const spine = document.createElement("div");
  const baseHeight = 110 + Math.min(90, Math.round((total || 120) / 4));
  const height = favorite ? Math.min(baseHeight, 150) : baseHeight;
  spine.className = "book-spine";
  if (favorite) spine.classList.add("book-spine-favorite");
  spine.style.setProperty("--spine-height", `${height}px`);
  spine.style.setProperty("--spine-color-1", c1);
  spine.style.setProperty("--spine-color-2", c2);
  spine.title = `${title}${b.author ? ` · ${b.author}` : ""}${total ? ` · ${total} páginas` : ""}${finishDate ? ` · Terminado: ${finishDate}` : ""}`;
  spine.dataset.bookId = id;
  spine.tabIndex = 0;

  const t = document.createElement("span");
  t.className = "book-spine-title";
  t.textContent = title;

  const meta = document.createElement("span");
  meta.className = "book-spine-meta";
  meta.textContent = total ? `${total} pág` : "Terminado";

  if (favorite) {
    const star = document.createElement("span");
    star.className = "book-spine-star";
    star.textContent = "★";
    spine.appendChild(star);
  }

  spine.appendChild(t);
  spine.appendChild(meta);

  const openDetail = () => openBookDetail(id);
  spine.addEventListener("click", openDetail);
  spine.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openDetail();
    }
  });

  return spine;
}

function renderBooks() {
  const idsAll = Object.keys(books || {});
  const hasFinishedUI = !!($booksFinishedSection && $booksListFinished);
  const searchQuery = ($booksShelfSearch?.value || "").trim().toLowerCase();

  if (!idsAll.length) {
    if ($booksListActive) $booksListActive.innerHTML = "";
    if (hasFinishedUI) {
      $booksListFinished.innerHTML = "";
      $booksFinishedSection.style.display = "none";
      if ($booksFinishedCount) $booksFinishedCount.textContent = "0";
    }
    if ($booksShelfResults) $booksShelfResults.textContent = "";
    if ($booksShelfEmpty) $booksShelfEmpty.style.display = "none";
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
    card.style.setProperty("--p", percent);
    card.style.setProperty(
      "--progress-fill",
      finished ? "rgba(46, 234, 123, 0.28)" : "rgba(127, 93, 255, 0.24)"
    );

    const prog = document.createElement("div");
    prog.className = "book-progress-line";
prog.innerHTML = `
  <span class="progress-value">${percent}%</span>
  <div class="progress-bar">
    <div class="progress-bar-fill${finished ? " is-finished" : ""}" style="width:${percent}%"></div>
  </div>
  ${
    finished
      ? `<span class="progress-pages">${current} / ${total}</span>`
      : `<span class="progress-pages">
           <input
             class="progress-pages-input"
             type="number"
             min="0"
             inputmode="numeric"
             placeholder="${current}"
             aria-label="Página actual"
           />
           <span class="progress-pages-sep">/</span>
           <span class="progress-pages-total">${total}</span>
         </span>`
  }
`;
const inlineInput = prog.querySelector(".progress-pages-input");
if (inlineInput) {
  const commit = () => {
    const raw = inlineInput.value.trim();
    if (!raw) return;

    const newVal = parseInt(raw, 10);
    if (Number.isNaN(newVal)) return;

    const safe = Math.max(0, Math.min(total, newVal));
    inlineInput.value = "";
    updateBookProgress(id, safe);
  };

  inlineInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      commit();
      inlineInput.blur();
    } else if (e.key === "Escape") {
      inlineInput.value = "";
      inlineInput.blur();
    }
  });

  inlineInput.addEventListener("blur", commit);
}



    const main = document.createElement("div");
    main.className = "book-main";

    const titleRow = document.createElement("div");
    titleRow.className = "book-title-row";

    const titleEl = document.createElement("div");
    titleEl.className = "book-title";
    titleEl.textContent = b?.title || "Sin título";
    titleEl.classList.add("card-toggle");
    titleEl.setAttribute("role", "button");
    titleEl.tabIndex = 0;

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

    btnEdit.classList.add("btn-secondary-action");
    btnDone.classList.add("btn-primary-action");

    buttons.appendChild(btnEdit);
    buttons.appendChild(btnDone);

    if (finished) {
      btnDone.disabled = true;
      btnDone.style.opacity = "0.7";
      btnDone.style.pointerEvents = "none";
    } else {
      btnDone.addEventListener("click", () => markBookFinished(id));
    }


    // Input de página SOLO si NO está terminado
    if (!finished) {
      const pageInput = document.createElement("div");
      pageInput.className = "book-page-input";
      pageInput.innerHTML = `
        <span>Página actual</span>
        <input type="number" min="0" inputmode="numeric" value="${current}" />
      `;

      const inputEl = pageInput.querySelector("input");
      inputEl.addEventListener("change", () => {
        const newVal = parseInt(inputEl.value, 10) || 0;
        const safe = Math.max(0, Math.min(total, newVal));
        inputEl.value = safe;
        updateBookProgress(id, safe);
      });

      actions.appendChild(pageInput);
    }

    actions.appendChild(buttons);

    main.appendChild(titleRow);
    main.appendChild(meta);
    main.appendChild(pagesRow);
    main.appendChild(actions);

    card.appendChild(prog);
    card.appendChild(main);

    // Vista inicial plegada
    card.classList.add("is-collapsed");

    const toggle = () => card.classList.toggle("is-collapsed");
    titleEl.addEventListener("click", toggle);
    titleEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });

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
    const totalFinished = finishedIds.length;
    const favorites = [];
    const regular = [];

    finishedIds.forEach((id) => {
      const book = books[id];
      if (!matchesShelfQuery(book, searchQuery)) return;
      (book?.favorite ? favorites : regular).push(id);
    });

    const visibleFinished = favorites.length + regular.length;

    if ($booksFinishedCount) $booksFinishedCount.textContent = String(totalFinished);
    if ($booksShelfResults) {
      if (searchQuery) {
        $booksShelfResults.textContent = `Mostrando ${visibleFinished} de ${totalFinished} libros terminados`;
      } else {
        $booksShelfResults.textContent = totalFinished ? `Libros terminados: ${totalFinished}` : "";
      }
    }
    if ($booksShelfEmpty) {
      $booksShelfEmpty.style.display = visibleFinished === 0 && totalFinished > 0 ? "block" : "none";
    }

    if (totalFinished) {
      $booksFinishedSection.style.display = "block";
      const fragF = document.createDocumentFragment();
      const SHELF_SIZE = 9;

      const appendShelves = (list, isFavorite = false) => {
        if (!list.length) return;
        if (isFavorite) {
          const label = document.createElement("div");
          label.className = "books-shelf-results shelf-favorites-label";
          label.textContent = "⭐ Favoritos";
          fragF.appendChild(label);
        }
        for (let i = 0; i < list.length; i += SHELF_SIZE) {
          const row = document.createElement("div");
          row.className = "books-shelf-row";
          if (isFavorite) row.classList.add("books-shelf-row-favorites");
          list.slice(i, i + SHELF_SIZE).forEach((bookId) => {
            row.appendChild(buildFinishedSpine(bookId));
          });
          fragF.appendChild(row);
        }
      };

      appendShelves(favorites, true);
      appendShelves(regular, false);

      $booksListFinished.innerHTML = "";
      $booksListFinished.appendChild(fragF);
    } else {
      $booksListFinished.innerHTML = "";
      $booksFinishedSection.style.display = "none";
      if ($booksFinishedCount) $booksFinishedCount.textContent = "0";
      if ($booksShelfResults) $booksShelfResults.textContent = "Libros terminados: 0";
      if ($booksShelfEmpty) $booksShelfEmpty.style.display = "none";
    }
  }
}

// === Actualizar progreso y log de lectura ===
async function updateBookFavorite(bookId, favorite) {
  if (!bookId) return;
  try {
    await update(ref(db, `${BOOKS_PATH}/${bookId}`), {
      favorite: !!favorite,
      updatedAt: Date.now()
    });
  } catch (err) {
    console.error("Error actualizando favorito", err);
  }
}

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
updates.finishedPast = shouldFinish ? false : !!book.finishedPast;

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
  finishedPast: false,
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
  if (b.finishedPast) return null;

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
    if (b?.finishedPast) return;
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
    from: dateKeyLocal(monday),
    to: dateKeyLocal(sunday)
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

    if (b.finishedPast) {
      if (range === "total") count += 1;
      return;
    }

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
    const yKey = dateKeyLocal(yesterday);
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

  if ($calViewMode) {
    calViewMode = $calViewMode.value || "month";
  }

  const totals = computeDailyTotals();
  const finishedByDay = computeFinishedByDay();

  renderCalendarSummary(totals, finishedByDay);

  if (calViewMode === "year") {
    $calLabel.textContent = `Año ${currentCalYear}`;
    renderCalendarYearGrid(totals, finishedByDay);
    return;
  }

  $calGrid.classList.remove("calendar-year-grid");
  $calLabel.textContent = formatMonthLabel(currentCalYear, currentCalMonth);

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
      const key = dateKeyLocal(d);
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

function renderCalendarYearGrid(totals, finishedByDay) {
  $calGrid.classList.add("calendar-year-grid");
  const months = Array.from({ length: 12 }, () => ({ pages: 0, finished: 0 }));

  Object.entries(totals || {}).forEach(([day, pages]) => {
    const [year, month] = day.split("-");
    if (Number(year) === currentCalYear) {
      const idx = Number(month) - 1;
      months[idx].pages += Number(pages) || 0;
    }
  });

  Object.entries(finishedByDay || {}).forEach(([day, finished]) => {
    const [year, month] = day.split("-");
    if (Number(year) === currentCalYear) {
      const idx = Number(month) - 1;
      months[idx].finished += Number(finished) || 0;
    }
  });

  const monthNames = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
  const frag = document.createDocumentFragment();

  months.forEach((info, idx) => {
    const cell = document.createElement("div");
    cell.className = "cal-cell cal-cell-year";

    const name = document.createElement("div");
    name.className = "cal-month-name";
    name.textContent = monthNames[idx];

    const metrics = document.createElement("div");
    metrics.className = "cal-month-metrics";
    metrics.textContent = `${info.pages || 0} pág · ${info.finished || 0} libros`;

    cell.appendChild(name);
    cell.appendChild(metrics);

    frag.appendChild(cell);
  });

  $calGrid.innerHTML = "";
  $calGrid.appendChild(frag);
}

function renderCalendarSummary(totals, finishedByDay) {
  if (!$calSummary) return;
  const prefix =
    calViewMode === "year"
      ? `${currentCalYear}-`
      : `${currentCalYear}-${String(currentCalMonth + 1).padStart(2, "0")}-`;

  let pages = 0;
  Object.entries(totals || {}).forEach(([day, val]) => {
    if (day.startsWith(prefix)) {
      pages += Number(val) || 0;
    }
  });

  let finished = 0;
  Object.entries(finishedByDay || {}).forEach(([day, val]) => {
    if (day.startsWith(prefix)) {
      finished += Number(val) || 0;
    }
  });

  const scopeLabel = calViewMode === "year" ? "año" : "mes";
  $calSummary.textContent = `Resumen del ${scopeLabel}: ${pages} páginas · ${finished} libros terminados`;
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
  const yKey = dateKeyLocal(yesterday);

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
if ($calPrev) {
  $calPrev.addEventListener("click", () => {
    if (calViewMode === "year") {
      currentCalYear -= 1;
    } else if (currentCalMonth === 0) {
      currentCalMonth = 11;
      currentCalYear -= 1;
    } else {
      currentCalMonth -= 1;
    }
    renderCalendar();
  });
}

if ($calNext) {
  $calNext.addEventListener("click", () => {
    if (calViewMode === "year") {
      currentCalYear += 1;
    } else if (currentCalMonth === 11) {
      currentCalMonth = 0;
      currentCalYear += 1;
    } else {
      currentCalMonth += 1;
    }
    renderCalendar();
  });
}

if ($calViewMode) {
  $calViewMode.addEventListener("change", () => {
    calViewMode = $calViewMode.value || "month";
    renderCalendar();
  });
}
