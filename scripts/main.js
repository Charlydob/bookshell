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
import {
  ensureCountryDatalist,
  getCountryEnglishName,
  normalizeCountryInput
} from "./countries.js";
import { renderCountryHeatmap, renderCountryList } from "./world-heatmap.js";

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

// Categorías (género): opciones
const META_GENRES_PATH = "meta/genres";
const DEFAULT_GENRES = [
  "Novela","Ensayo","Fantasía","Ciencia ficción","Terror",
  "Historia","Biografía","Filosofía","Poesía","Misterio","Otros"
];
let genreOptions = [...DEFAULT_GENRES];


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
const $bookIsbn = document.getElementById("book-isbn");
const $bookIsbnSearch = document.getElementById("book-isbn-search");
const $bookIsbnStatus = document.getElementById("book-isbn-status");
const $bookIsbnResults = document.getElementById("book-isbn-results");
const $bookPages = document.getElementById("book-pages");
const $bookCurrentPage = document.getElementById("book-current-page");
const $bookGenre = document.getElementById("book-genre");
const $bookLanguage = document.getElementById("book-language");
const $bookCountry = document.getElementById("book-country");
const $bookStatus = document.getElementById("book-status");
const $bookPdf = document.getElementById("book-pdf"); // puede ser null si no usamos PDF
const $bookFavorite = document.getElementById("book-favorite");
const $bookFinishedPast = document.getElementById("book-finished-past");

// Categorías (selector)
const $genreAddBtn = document.getElementById("genre-add-btn");
const $genreRemoveBtn = document.getElementById("genre-remove-btn");

// Charts (donut)
const $booksChartsSection = document.getElementById("books-charts-section");
const $chartGenre = document.getElementById("chart-genre");
const $chartAuthor = document.getElementById("chart-author");
const $chartCentury = document.getElementById("chart-century");
const $chartLanguage = document.getElementById("chart-language");
const $appMain = document.querySelector(".app-main");
const $booksGeoSection = document.getElementById("books-geo-section");
const $booksWorldMap = document.getElementById("books-world-map");
const $booksCountryList = document.getElementById("books-country-list");


const $booksShelfSearch = document.getElementById("books-shelf-search");
const $booksShelfResults = document.getElementById("books-shelf-results");
const $booksShelfEmpty = document.getElementById("books-shelf-empty");
const $booksFilterSearch = document.getElementById("books-filter-search");
const $booksFilters = document.getElementById("books-filters");
const $booksFiltersToggle = document.getElementById("books-filters-toggle");
const $booksFiltersBody = document.getElementById("books-filters-body");
const $booksFiltersHeader = document.getElementById("books-filters-header");
const $booksFilterChips = document.getElementById("books-filter-chips");
const $booksFilterPending = document.getElementById("books-filter-pending");
const $booksFilterFinished = document.getElementById("books-filter-finished");
const $booksFilterEmpty = document.getElementById("books-filter-empty");

const filterState = {
  query: "",
  genres: new Set(),
  authors: new Set(),
  languages: new Set(),
  centuries: new Set(),
  showPending: false,
  showFinished: false
};

ensureCountryDatalist();

const $bookDetailBackdrop = document.getElementById("book-detail-backdrop");
const $bookDetailTitle = document.getElementById("book-detail-title");
const $bookDetailClose = document.getElementById("book-detail-close");
const $bookDetailCloseBtn = document.getElementById("book-detail-close-btn");
const $bookDetailFavorite = document.getElementById("book-detail-favorite");
const $bookDetailStatus = document.getElementById("book-detail-status");
const $bookDetailAuthor = document.getElementById("book-detail-author");
const $bookDetailYear = document.getElementById("book-detail-year");
const $bookDetailCentury = document.getElementById("book-detail-century");
const $bookDetailGenre = document.getElementById("book-detail-genre");
const $bookDetailLanguage = document.getElementById("book-detail-language");
const $bookDetailCountry = document.getElementById("book-detail-country");
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

function debounce(fn, delay = 200) {
  let t = null;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function withStableMainScroll(renderFn) {
  if (typeof renderFn !== "function") return;
  const scroller = $appMain;
  const prev = scroller ? scroller.scrollTop : null;
  renderFn();
  if (scroller != null && prev != null) {
    const max = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    scroller.scrollTop = Math.min(max, prev);
  }
}

if ($booksFilterSearch) {
  const handleInput = debounce((e) => {
    const value = e?.target?.value || "";
    filterState.query = value.trim();
    renderBooks();
  }, 200);
  $booksFilterSearch.addEventListener("input", handleInput);
}

if ($booksFilters) {
  const setFiltersCollapsed = (collapsed) => {
    if (!$booksFilters) return;
    if (collapsed) {
      $booksFilters.classList.add("is-collapsed");
    } else {
      $booksFilters.classList.remove("is-collapsed");
    }
    if ($booksFiltersBody) {
      $booksFiltersBody.hidden = collapsed;
    }
    if ($booksFiltersToggle) {
      $booksFiltersToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
      const text = $booksFiltersToggle.querySelector(".filters-toggle-text");
      if (text) text.textContent = collapsed ? "Mostrar filtros" : "Ocultar filtros";
    }
  };

  const toggleFilters = () => setFiltersCollapsed(!$booksFilters.classList.contains("is-collapsed"));

  if ($booksFiltersToggle) {
    $booksFiltersToggle.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFilters();
    });
  }
  if ($booksFiltersHeader) {
    $booksFiltersHeader.addEventListener("click", (e) => {
      if (e.target.closest("input") || e.target.closest("button")) return;
      toggleFilters();
    });
  }
  if ($booksFilterSearch) {
    $booksFilterSearch.addEventListener("focus", () => setFiltersCollapsed(false));
  }
  setFiltersCollapsed(true);
}

if ($booksFilterPending) {
  $booksFilterPending.addEventListener("change", (e) => {
    filterState.showPending = !!e.target.checked;
    renderBooks();
  });
}

if ($booksFilterFinished) {
  $booksFilterFinished.addEventListener("change", (e) => {
    filterState.showFinished = !!e.target.checked;
    renderBooks();
  });
}

// === Categorías (selector) ===
function escapeHtml(str) {
  return String(str ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function normalizeLabel(v) {
  return String(v ?? "").trim();
}

function normalizeCountryRecord(value, label = "") {
  const candidate = label || value;
  const normalized = normalizeCountryInput(candidate || value);
  if (normalized) {
    const code = normalized.code || null;
    return {
      code,
      label: normalized.name || label || value || code,
      english: getCountryEnglishName(code) || normalized.name || code
    };
  }
  const fallbackLabel = normalizeLabel(candidate || value);
  if (fallbackLabel) {
    const rawCode = normalizeLabel(value || "").toUpperCase() || null;
    return { code: rawCode, label: fallbackLabel, english: fallbackLabel };
  }
  return null;
}

function parseGenresValue(val) {
  if (!val) return null;
  if (Array.isArray(val)) return val.filter(Boolean).map((x) => normalizeLabel(x)).filter(Boolean);
  if (typeof val === "object") return Object.values(val).filter(Boolean).map((x) => normalizeLabel(x)).filter(Boolean);
  return null;
}

function sortLabels(arr) {
  return [...arr].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

function collectBookLabels(getter) {
  const map = new Map();
  Object.values(books || {}).forEach((b) => {
    const label = normalizeLabel(getter(b));
    if (!label) return;
    const key = label.toLowerCase();
    if (!map.has(key)) map.set(key, label);
  });
  return Array.from(map.values());
}

function mergeOptionsWithActive(baseLabels, activeSet, sorter = null) {
  const map = new Map();
  (baseLabels || []).forEach((label) => {
    const norm = normalizeLabel(label);
    if (!norm) return;
    const key = norm.toLowerCase();
    if (!map.has(key)) map.set(key, norm);
  });
  Array.from(activeSet || []).forEach((key) => {
    if (!map.has(key)) map.set(key, key);
  });
  const arr = Array.from(map.entries()).map(([key, label]) => ({ key, label }));
  arr.sort((a, b) => {
    if (typeof sorter === "function") return sorter(a.label, b.label);
    return a.label.localeCompare(b.label, "es", { sensitivity: "base" });
  });
  return arr;
}

function buildFilterOptionsFromBooks() {
  const genreLabels = mergeOptionsWithActive(
    [...(genreOptions || []), ...collectBookLabels((b) => b?.genre)],
    new Set()
  ).map((o) => o.label);
  const authorOptions = sortLabels(collectBookLabels((b) => b?.author));
  const centuryOptions = collectBookLabels((b) => yearToCenturyLabel(b?.year)).sort((a, b) =>
    a.localeCompare(b, "es", { sensitivity: "base" })
  );
  const languageOptions = sortLabels(collectBookLabels((b) => b?.language));

  return {
    genres: genreLabels,
    authors: authorOptions,
    centuries: centuryOptions,
    languages: languageOptions
  };
}

function renderFilterChips() {
  if (!$booksFilterChips) return;
  const { genres, authors, centuries, languages } = buildFilterOptionsFromBooks();

  const groups = [
    { key: "genres", title: "Categorías", options: mergeOptionsWithActive(genres, filterState.genres) },
    { key: "authors", title: "Autores", options: mergeOptionsWithActive(authors, filterState.authors) },
    { key: "centuries", title: "Siglos", options: mergeOptionsWithActive(centuries, filterState.centuries) },
    { key: "languages", title: "Idiomas", options: mergeOptionsWithActive(languages, filterState.languages) }
  ];

  const frag = document.createDocumentFragment();

  groups.forEach((group) => {
    const wrapper = document.createElement("div");
    wrapper.className = "filter-chip-group";
    const title = document.createElement("div");
    title.className = "filter-chip-group-title";
    title.textContent = group.title;
    wrapper.appendChild(title);

    const row = document.createElement("div");
    row.className = "filter-chips";
    row.setAttribute("role", "listbox");
    row.setAttribute("aria-label", `Filtrar por ${group.title.toLowerCase()}`);

    if (!group.options.length) {
      const empty = document.createElement("div");
      empty.className = "filter-chip-empty";
      empty.textContent = "Añade libros para ver opciones";
      row.appendChild(empty);
    } else {
      group.options.forEach(({ label, key }) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "filter-chip";
        btn.textContent = label;
        const set = filterState[group.key] || new Set();
        const active = set.has(key);
        if (active) btn.classList.add("is-active");
        btn.setAttribute("role", "option");
        btn.setAttribute("aria-pressed", active ? "true" : "false");
        btn.tabIndex = 0;
        btn.addEventListener("click", () => {
          if (set.has(key)) {
            set.delete(key);
          } else {
            set.add(key);
          }
          filterState[group.key] = set;
          renderFilterChips();
          renderBooks();
        });
        row.appendChild(btn);
      });
    }

    wrapper.appendChild(row);
    frag.appendChild(wrapper);
  });

  $booksFilterChips.innerHTML = "";
  $booksFilterChips.appendChild(frag);
}

function populateGenreSelect(selected = null) {
  if (!$bookGenre) return;

  const current = normalizeLabel(selected != null ? selected : $bookGenre.value);
  const opts = sortLabels(genreOptions || []);

  // Si llega un género antiguo que no está en la lista, lo metemos para no romper edición
  if (current && !opts.some((o) => o.toLowerCase() === current.toLowerCase())) opts.unshift(current);

  $bookGenre.innerHTML =
    `<option value="">—</option>` +
    opts.map((o) => `<option value="${escapeHtml(o)}">${escapeHtml(o)}</option>`).join("");

  if (current) $bookGenre.value = current;
}

if ($genreAddBtn) {
  $genreAddBtn.addEventListener("click", async () => {
    const raw = prompt("Nueva categoría:");
    const label = normalizeLabel(raw);
    if (!label) return;

    const exists = (genreOptions || []).some((o) => String(o).toLowerCase() === label.toLowerCase());
    if (!exists) genreOptions = [...(genreOptions || []), label];

    genreOptions = sortLabels(genreOptions);
    populateGenreSelect(label);

    try {
      await set(ref(db, META_GENRES_PATH), genreOptions);
    } catch (err) {
      console.error("Error guardando categorías", err);
    }
  });
}

if ($genreRemoveBtn) {
  $genreRemoveBtn.addEventListener("click", async () => {
    if (!$bookGenre) return;
    const current = normalizeLabel($bookGenre.value);
    if (!current) return;

    const confirmed = confirm(`¿Eliminar la categoría "${current}" de la lista?`);
    if (!confirmed) return;

    const next = (genreOptions || []).filter((o) => o.toLowerCase() !== current.toLowerCase());
    genreOptions = sortLabels(next);
    populateGenreSelect("");

    try {
      await set(ref(db, META_GENRES_PATH), genreOptions);
    } catch (err) {
      console.error("Error guardando categorías", err);
    }
  });
}

// Carga categorías desde Firebase (si existen)
onValue(ref(db, META_GENRES_PATH), (snap) => {
  const arr = parseGenresValue(snap.val());
  if (arr) {
    genreOptions = sortLabels(arr);
  } else {
    genreOptions = [...DEFAULT_GENRES];
  }
  populateGenreSelect();
  renderFilterChips();
});

// === ISBN autofill ===
function normalizeIsbn(raw = "") {
  return String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

function parsePublishYear(val) {
  if (!val) return null;
  const n = Number(val);
  if (Number.isInteger(n) && n > 0) return n;
  if (typeof val === "string" && val.length >= 4) {
    const maybeYear = Number(val.slice(0, 4));
    if (Number.isInteger(maybeYear)) return maybeYear;
  }
  return null;
}

function dedupeMatches(matches) {
  const seen = new Set();
  return (matches || []).filter((m) => {
    const key = `${(m.title || "").toLowerCase()}|${(m.author || "").toLowerCase()}|${m.year || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchFromOpenLibrary(isbn) {
  const res = await fetch(`https://openlibrary.org/search.json?isbn=${encodeURIComponent(isbn)}`, {
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) throw new Error("Open Library respondió con error");
  const data = await res.json();
  const docs = Array.isArray(data?.docs) ? data.docs : [];
  const matches = docs.map((doc) => {
    const title = doc?.title || doc?.title_suggest;
    const author = Array.isArray(doc?.author_name) ? doc.author_name[0] : null;
    const year = parsePublishYear(doc?.first_publish_year || (Array.isArray(doc?.publish_year) ? doc.publish_year[0] : null));
    const pages = Number(doc?.number_of_pages_median || doc?.number_of_pages || 0) || null;
    return {
      title: title || null,
      author: author || null,
      year,
      pages,
      source: "openlibrary"
    };
  }).filter((m) => m.title);
  return dedupeMatches(matches);
}

async function fetchFromGoogleBooks(isbn) {
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=isbn:${encodeURIComponent(isbn)}`);
  if (!res.ok) throw new Error("Google Books respondió con error");
  const data = await res.json();
  const items = Array.isArray(data?.items) ? data.items : [];
  const matches = items.map((item) => {
    const info = item?.volumeInfo || {};
    const title = info.title;
    const authors = Array.isArray(info.authors) ? info.authors.join(", ") : null;
    const year = parsePublishYear(info.publishedDate);
    const pages = Number(info.pageCount || 0) || null;
    return {
      title: title || null,
      author: authors,
      year,
      pages,
      source: "google"
    };
  }).filter((m) => m.title);
  return dedupeMatches(matches);
}

async function fetchBookByISBN(isbn) {
  const normalized = normalizeIsbn(isbn);
  if (!normalized) return { matches: [], source: null };

  try {
    const ol = await fetchFromOpenLibrary(normalized);
    if (ol.length) return { matches: ol, source: "openlibrary" };
  } catch (_) {}

  try {
    const gb = await fetchFromGoogleBooks(normalized);
    if (gb.length) return { matches: gb, source: "google" };
  } catch (_) {}

  return { matches: [], source: null };
}

function setIsbnStatus(message, tone = "muted") {
  if (!$bookIsbnStatus) return;
  $bookIsbnStatus.textContent = message;
  if (tone === "error") {
    $bookIsbnStatus.dataset.tone = "error";
  } else if (tone === "success") {
    $bookIsbnStatus.dataset.tone = "success";
  } else {
    delete $bookIsbnStatus.dataset.tone;
  }
}

function renderIsbnResults(matches) {
  if (!$bookIsbnResults) return;
  if (!matches || matches.length < 2) {
    $bookIsbnResults.style.display = "none";
    $bookIsbnResults.innerHTML = "";
    return;
  }

  const frag = document.createDocumentFragment();
  const title = document.createElement("div");
  title.className = "isbn-results-title";
  title.textContent = "Posibles coincidencias";
  frag.appendChild(title);

  matches.slice(0, 6).forEach((match) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "isbn-result-item";
    item.innerHTML = `
      <div class="isbn-result-title">${escapeHtml(match.title || "Sin título")}</div>
      <div class="isbn-result-meta">${escapeHtml([match.author, match.year, match.pages ? `${match.pages} pág` : ""].filter(Boolean).join(" · ") || "—")}</div>
    `;
    item.addEventListener("click", () => applyIsbnMatch(match));
    frag.appendChild(item);
  });

  $bookIsbnResults.innerHTML = "";
  $bookIsbnResults.appendChild(frag);
  $bookIsbnResults.style.display = "flex";
}

function applyIsbnMatch(match) {
  if (!match) return;
  if ($bookTitle && match.title) $bookTitle.value = match.title;
  if ($bookAuthor && match.author) $bookAuthor.value = match.author;
  if ($bookYear && match.year) $bookYear.value = match.year;
  if ($bookPages && match.pages) $bookPages.value = match.pages;
  setIsbnStatus("Datos completados, puedes editarlos antes de guardar.", "success");
}

function resetIsbnUI() {
  if ($bookIsbn) $bookIsbn.value = "";
  setIsbnStatus("Autocompleta título, autor, año y páginas.");
  renderIsbnResults([]);
}

async function handleIsbnLookup() {
  if (!$bookIsbn) return;
  const raw = $bookIsbn.value || "";
  const isbn = normalizeIsbn(raw);
  if (!isbn) {
    setIsbnStatus("Introduce un ISBN válido para buscar.", "error");
    renderIsbnResults([]);
    return;
  }

  $bookIsbn.value = isbn;
  if ($bookIsbnSearch) $bookIsbnSearch.disabled = true;
  setIsbnStatus("Buscando en Open Library…");

  try {
    const { matches, source } = await fetchBookByISBN(isbn);
    if (!matches || matches.length === 0) {
      setIsbnStatus("No se encontraron resultados para este ISBN.", "error");
      renderIsbnResults([]);
      return;
    }

    applyIsbnMatch(matches[0]);
    renderIsbnResults(matches);
    const sourceLabel = source === "google" ? "Google Books" : "Open Library";
    setIsbnStatus(`Información encontrada en ${sourceLabel}.`, "success");
  } catch (err) {
    console.error("Error buscando ISBN", err);
    setIsbnStatus("Hubo un problema al buscar. Inténtalo de nuevo.", "error");
    renderIsbnResults([]);
  } finally {
    if ($bookIsbnSearch) $bookIsbnSearch.disabled = false;
  }
}

if ($bookIsbnSearch) {
  $bookIsbnSearch.addEventListener("click", handleIsbnLookup);
}

if ($bookIsbn) {
  $bookIsbn.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleIsbnLookup();
    }
  });
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
  fillDetail($bookDetailCentury, yearToCenturyLabel(b.year));
  fillDetail($bookDetailGenre, b.genre || "—");
  fillDetail($bookDetailLanguage, b.language || "—");
  const countryInfo = normalizeCountryRecord(b.country, b.countryLabel);
  fillDetail($bookDetailCountry, countryInfo?.label || "—");
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
    if ($bookIsbn) $bookIsbn.value = b.isbn || "";
    setIsbnStatus("Autocompleta título, autor, año y páginas.");
    renderIsbnResults([]);
    $bookTitle.value = b.title || "";
    $bookAuthor.value = b.author || "";
    $bookYear.value = b.year || "";
    $bookPages.value = b.pages || "";
    $bookCurrentPage.value = b.currentPage ?? 0;
    populateGenreSelect(b.genre || "");
    $bookLanguage.value = b.language || "";
    if ($bookCountry) $bookCountry.value = b.countryLabel || b.country || "";
    $bookStatus.value = b.status || "reading";
    if ($bookFavorite) $bookFavorite.checked = !!b.favorite;
    if ($bookFinishedPast) $bookFinishedPast.checked = !!b.finishedPast;
  } else {
    $modalTitle.textContent = "Nuevo libro";
    $bookId.value = "";
    $bookForm.reset();
    resetIsbnUI();
    $bookCurrentPage.value = 0;
    populateGenreSelect("");
    if ($bookCountry) $bookCountry.value = "";
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
  const countryInfo = normalizeCountryRecord($bookCountry?.value);

  if (selectedStatus === "finished" && pages > 0) {
    currentPage = pages;
  }

  const bookData = {
    title,
    author: $bookAuthor.value.trim() || null,
    year: $bookYear.value ? parseInt($bookYear.value, 10) : null,
    isbn: normalizeIsbn($bookIsbn ? $bookIsbn.value : "") || null,
    pages,
    currentPage,
    genre: $bookGenre.value.trim() || null,
    language: $bookLanguage.value.trim() || null,
    country: countryInfo?.code || null,
    countryLabel: countryInfo?.label || null,
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
    book?.year,
    book?.countryLabel,
    book?.country
  ];
  return fields.some((f) => String(f || "").toLowerCase().includes(q));
}

function applyFilters(bookMap, query, filters) {
  const ids = Object.keys(bookMap || {});
  const q = (query || "").trim().toLowerCase();
  const genresSet = new Set(Array.from(filters?.genres || []).map((g) => g.toLowerCase()));
  const authorsSet = new Set(Array.from(filters?.authors || []).map((a) => a.toLowerCase()));
  const languagesSet = new Set(Array.from(filters?.languages || []).map((l) => l.toLowerCase()));
  const centuriesSet = new Set(Array.from(filters?.centuries || []).map((c) => c.toLowerCase()));
  const wantPending = !!filters?.showPending;
  const wantFinished = !!filters?.showFinished;

  return ids.filter((id) => {
    const b = bookMap[id];
    const isFinished = isBookFinished(b);

    // Estado: si ambos apagados o ambos encendidos => no filtramos
    if (wantPending !== wantFinished) {
      if (wantFinished && !isFinished) return false;
      if (wantPending && isFinished) return false;
    }

    if (genresSet.size > 0) {
      const g = String(b?.genre || "").toLowerCase();
      if (!genresSet.has(g)) return false;
    }

    if (authorsSet.size > 0) {
      const a = String(b?.author || "").toLowerCase();
      if (!a || !authorsSet.has(a)) return false;
    }

    if (languagesSet.size > 0) {
      const l = String(b?.language || "").toLowerCase();
      if (!l || !languagesSet.has(l)) return false;
    }

    if (centuriesSet.size > 0) {
      const c = yearToCenturyLabel(b?.year).toLowerCase();
      if (!centuriesSet.has(c)) return false;
    }

    if (q && !matchesShelfQuery(b, q)) return false;

    return true;
  });
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

// === Charts (donut 2D interactivo) ===
const donutActiveFill = "#f5e6a6";
const donutActiveStroke = "#e3c45a";
const donutSliceStroke = "rgba(255,255,255,0.22)";
const donutFocusHint = "Toca o navega una sección";
let donutBackupQuery = null;
let donutBackupGenres = null;
let donutBackupAuthors = null;
let donutBackupLanguages = null;
let donutBackupCenturies = null;
let donutActiveType = null;
let donutActiveLabel = null;

function toRoman(num) {
  const n = Math.max(0, Math.floor(Number(num) || 0));
  if (!n) return "—";
  const map = [
    [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
    [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
    [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"]
  ];
  let x = n;
  let out = "";
  for (const [v, sym] of map) {
    while (x >= v) { out += sym; x -= v; }
  }
  return out || "—";
}

function yearToCenturyLabel(year) {
  const y = Number(year) || 0;
  if (!y) return "Sin año";
  const c = Math.floor((y - 1) / 100) + 1;
  return `S. ${toRoman(c)}`;
}

function countBy(ids, getter) {
  const m = new Map();
  (ids || []).forEach((id) => {
    const b = books?.[id];
    const key = normalizeLabel(getter(b));
    const label = key || "—";
    m.set(label, (m.get(label) || 0) + 1);
  });
  return m;
}

function topNMap(m, maxSlices = 6) {
  const arr = Array.from(m.entries()).map(([label, value]) => ({ label, value }));
  arr.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label, "es"));
  if (arr.length <= maxSlices) return arr;

  const head = arr.slice(0, maxSlices - 1);
  const tail = arr.slice(maxSlices - 1);
  const others = tail.reduce((acc, x) => acc + x.value, 0);
  head.push({ label: "Otros", value: others });
  return head;
}

function polar(cx, cy, r, deg) {
  const a = (deg - 90) * Math.PI / 180;
  return { x: cx + (r * Math.cos(a)), y: cy + (r * Math.sin(a)) };
}

function donutSlicePath(cx, cy, rOuter, rInner, startDeg, endDeg) {
  // Evita 360 exactos (SVG se rompe)
  const sweep = Math.max(0.001, endDeg - startDeg);
  const e = startDeg + Math.min(359.999, sweep);

  const p1 = polar(cx, cy, rOuter, startDeg);
  const p2 = polar(cx, cy, rOuter, e);
  const p3 = polar(cx, cy, rInner, e);
  const p4 = polar(cx, cy, rInner, startDeg);

  const large = (e - startDeg) > 180 ? 1 : 0;

  return [
    `M ${p1.x.toFixed(3)} ${p1.y.toFixed(3)}`,
    `A ${rOuter} ${rOuter} 0 ${large} 1 ${p2.x.toFixed(3)} ${p2.y.toFixed(3)}`,
    `L ${p3.x.toFixed(3)} ${p3.y.toFixed(3)}`,
    `A ${rInner} ${rInner} 0 ${large} 0 ${p4.x.toFixed(3)} ${p4.y.toFixed(3)}`,
    "Z"
  ].join(" ");
}

function createSvgEl(tag, attrs = {}) {
  const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
  Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
  return el;
}

function getDonutGeometry(hostWidth = 360) {
  const baseW = 360;
  const baseH = 240;
  const minW = 260;
  const maxW = 520;
  const width = Math.max(minW, Math.min(maxW, hostWidth || baseW));
  const scale = width / baseW;
  const height = baseH * scale;
  const cx = width / 2;
  const cy = height / 2;
  const rOuter = 92 * scale;
  const rInner = 60 * scale;

  return {
    width,
    height,
    cx,
    cy,
    rOuter,
    rInner,
    strokeWidth: rOuter - rInner,
    calloutInnerGap: 2 * scale,
    calloutOuterGap: 18 * scale,
    labelOffset: 32 * scale,
    centerYOffset: 4 * scale,
    centerSubYOffset: 14 * scale,
    focusYOffset: 34 * scale
  };
}

function renderDonutChart($host, centerTitle, mapData, options = {}) {
  if (!$host) return;

  if (typeof $host.__donutCleanup === "function") {
    $host.__donutCleanup();
    delete $host.__donutCleanup;
  }

  const data = topNMap(mapData, 6);
  const total = data.reduce((acc, d) => acc + d.value, 0);

  if (!total) {
    $host.innerHTML = `<div class="books-shelf-empty">Sin datos</div>`;
    return;
  }

  let a0 = 0;
  const slicesData = data.map((d) => {
    const frac = d.value / total;
    const a1 = a0 + frac * 360;
    const mid = (a0 + a1) / 2;
    const pct = Math.round(frac * 100);
    const out = { ...d, frac, a0, a1, mid, pct };
    a0 = a1;
    return out;
  });

  const onSliceSelect = typeof options.onSliceSelect === "function" ? options.onSliceSelect : null;
  const activeLabel = normalizeLabel(options.activeLabel || "").toLowerCase();
  let activeIdx = activeLabel
    ? slicesData.findIndex((s) => normalizeLabel(s.label).toLowerCase() === activeLabel)
    : null;
  if (activeIdx != null && activeIdx < 0) activeIdx = null;
  let applyActive = () => {};

  const renderWithWidth = (hostWidth) => {
    const { svg, setActive } = buildDonutSvg(hostWidth);
    applyActive = setActive;
    $host.innerHTML = "";
    $host.appendChild(svg);
    applyActive(activeIdx);
  };

  const handleSelect = (idx) => {
    activeIdx = idx === activeIdx ? null : idx;
    applyActive(activeIdx);
    if (onSliceSelect) {
      onSliceSelect(activeIdx != null ? slicesData[activeIdx] : null);
    }
  };

  function buildDonutSvg(hostWidth = 360) {
    const {
      width,
      height,
      cx,
      cy,
      rOuter,
      rInner,
      strokeWidth,
      calloutInnerGap,
      calloutOuterGap,
      labelOffset,
      centerYOffset,
      centerSubYOffset,
      focusYOffset
    } = getDonutGeometry(hostWidth);

    const svg = createSvgEl("svg", {
      class: "donut-svg",
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": escapeHtml(centerTitle)
    });

    const defs = createSvgEl("defs");
    const glow = createSvgEl("filter", {
      id: "donut-glow",
      x: "-50%",
      y: "-50%",
      width: "200%",
      height: "200%"
    });
    glow.appendChild(createSvgEl("feDropShadow", {
      dx: "0",
      dy: "6",
      stdDeviation: "8",
      "flood-color": "rgba(245,230,166,0.45)"
    }));
    defs.appendChild(glow);
    svg.appendChild(defs);

    const ring = createSvgEl("circle", {
      class: "donut-ring-base",
      cx,
      cy,
      r: (rOuter + rInner) / 2,
      "stroke-width": strokeWidth
    });
    svg.appendChild(ring);

    const slicesGroup = createSvgEl("g", { class: "donut-slices" });
    const calloutsGroup = createSvgEl("g", { class: "donut-callouts" });
    const centerGroup = createSvgEl("g", { class: "donut-center-group" });

    const centerMain = createSvgEl("text", {
      class: "donut-center",
      x: cx,
      y: cy - centerYOffset,
      "text-anchor": "middle"
    });
    centerMain.textContent = centerTitle;

    const centerSub = createSvgEl("text", {
      class: "donut-center-sub",
      x: cx,
      y: cy + centerSubYOffset,
      "text-anchor": "middle"
    });
    centerSub.textContent = `${total} libros`;

    const centerFocus = createSvgEl("text", {
      class: "donut-center-focus",
      x: cx,
      y: cy + focusYOffset,
      "text-anchor": "middle"
    });
    centerFocus.textContent = donutFocusHint;

    centerGroup.appendChild(centerMain);
    centerGroup.appendChild(centerSub);
    centerGroup.appendChild(centerFocus);

    const slicesEls = [];
    const calloutEls = [];

    slicesData.forEach((s, idx) => {
      const path = createSvgEl("path", {
        class: "donut-slice",
        d: donutSlicePath(cx, cy, rOuter, rInner, s.a0, s.a1),
        fill: "transparent",
        stroke: donutSliceStroke,
        "data-index": String(idx),
        role: "button",
        tabindex: "0",
        "aria-label": `${s.label}: ${s.value} (${s.pct}%)`
      });
      path.dataset.label = s.label;
      path.dataset.value = String(s.value);
      path.dataset.pct = String(s.pct);
      slicesGroup.appendChild(path);
      slicesEls.push(path);

      const p1 = polar(cx, cy, rOuter + calloutInnerGap, s.mid);
      const p2 = polar(cx, cy, rOuter + calloutOuterGap, s.mid);
      const right = Math.cos((s.mid - 90) * Math.PI / 180) >= 0;
      const x3 = right ? (p2.x + labelOffset) : (p2.x - labelOffset);
      const y3 = p2.y;
      const tx = right ? (x3 + 3) : (x3 - 3);
      const anchor = right ? "start" : "end";

      const callout = createSvgEl("g", {
        class: "donut-callout",
        "data-index": String(idx),
        role: "button",
        tabindex: "0",
        "aria-label": `${s.label}: ${s.value} (${s.pct}%)`
      });
      const line = createSvgEl("polyline", {
        class: "donut-line",
        points: `${p1.x.toFixed(2)},${p1.y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)} ${x3.toFixed(2)},${y3.toFixed(2)}`,
        fill: "none"
      });
      const label = createSvgEl("text", {
        class: "donut-label",
        x: tx.toFixed(2),
        y: (y3 - 2).toFixed(2),
        "text-anchor": anchor
      });
      const t1 = createSvgEl("tspan", { x: tx.toFixed(2), dy: "0" });
      t1.textContent = s.label;
      const t2 = createSvgEl("tspan", {
        class: "donut-label-value",
        x: tx.toFixed(2),
        dy: "12"
      });
      t2.textContent = `${s.value} · ${s.pct}%`;
      label.appendChild(t1);
      label.appendChild(t2);

      callout.appendChild(line);
      callout.appendChild(label);
      calloutsGroup.appendChild(callout);
      calloutEls.push(callout);

      const activate = () => handleSelect(idx);
      const handleKey = (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          activate();
        }
      };

      path.addEventListener("click", activate);
      path.addEventListener("keydown", handleKey);
      callout.addEventListener("click", activate);
      callout.addEventListener("keydown", handleKey);
    });

    function setActive(idx = null) {
      slicesEls.forEach((p, i) => {
        const isActive = i === idx;
        p.classList.toggle("active", isActive);
        p.setAttribute("fill", isActive ? donutActiveFill : "transparent");
        p.setAttribute("stroke", isActive ? donutActiveStroke : donutSliceStroke);
        p.setAttribute("filter", isActive ? "url(#donut-glow)" : "");
        p.setAttribute("aria-pressed", isActive ? "true" : "false");
      });
      calloutEls.forEach((c, i) => {
        const isActive = i === idx;
        c.classList.toggle("active", isActive);
        c.setAttribute("aria-pressed", isActive ? "true" : "false");
      });

      if (idx == null) {
        centerFocus.textContent = donutFocusHint;
      } else {
        const s = slicesData[idx];
        centerFocus.textContent = `${s.label}: ${s.value} (${s.pct}%)`;
      }
    }

    setActive(activeIdx);

    svg.appendChild(slicesGroup);
    svg.appendChild(calloutsGroup);
    svg.appendChild(centerGroup);

    return { svg, setActive };
  }

  const ro = new ResizeObserver((entries) => {
    const width = Math.round(entries?.[0]?.contentRect?.width || $host.clientWidth || 360);
    renderWithWidth(width);
  });
  ro.observe($host);
  $host.__donutCleanup = () => ro.disconnect();
  renderWithWidth($host.clientWidth || 360);
}

function applyDonutFilter(selection, type = "search") {
  const label = normalizeLabel(selection?.label || "");
  const isAggregated = label.toLowerCase() === "otros";
  const previousType = donutActiveType;
  if (selection && !isAggregated && previousType && previousType !== type) {
    applyDonutFilter(null, previousType);
  }

  if (!selection || isAggregated) {
    if (donutActiveType === "genre") {
      filterState.genres = donutBackupGenres ? new Set(donutBackupGenres) : new Set();
    }
    if (donutActiveType === "author") {
      filterState.authors = donutBackupAuthors ? new Set(donutBackupAuthors) : new Set();
    }
    if (donutActiveType === "language") {
      filterState.languages = donutBackupLanguages ? new Set(donutBackupLanguages) : new Set();
    }
    if (donutActiveType === "century") {
      filterState.centuries = donutBackupCenturies ? new Set(donutBackupCenturies) : new Set();
    }
    if (donutActiveType === "search") {
      const restored = donutBackupQuery ?? filterState.query ?? "";
      filterState.query = restored;
      if ($booksFilterSearch) {
        $booksFilterSearch.value = restored;
      }
    }
    donutActiveType = null;
    donutActiveLabel = null;
    donutBackupQuery = null;
    donutBackupGenres = null;
    donutBackupAuthors = null;
    donutBackupLanguages = null;
    donutBackupCenturies = null;
    withStableMainScroll(() => {
      renderFilterChips();
      renderBooks();
    });
    return;
  }

  if (type === "genre") {
    if (donutActiveType !== "genre") {
      donutBackupGenres = new Set(filterState.genres);
    }
    donutActiveType = "genre";
    donutActiveLabel = label;
    filterState.genres = label ? new Set([label.toLowerCase()]) : new Set();
  } else if (type === "author") {
    if (donutActiveType !== "author") {
      donutBackupAuthors = new Set(filterState.authors);
    }
    donutActiveType = "author";
    donutActiveLabel = label;
    filterState.authors = label ? new Set([label.toLowerCase()]) : new Set();
  } else if (type === "language") {
    if (donutActiveType !== "language") {
      donutBackupLanguages = new Set(filterState.languages);
    }
    donutActiveType = "language";
    donutActiveLabel = label;
    filterState.languages = label ? new Set([label.toLowerCase()]) : new Set();
  } else if (type === "century") {
    if (donutActiveType !== "century") {
      donutBackupCenturies = new Set(filterState.centuries);
    }
    donutActiveType = "century";
    donutActiveLabel = label;
    filterState.centuries = label ? new Set([label.toLowerCase()]) : new Set();
  } else {
    if (donutActiveType !== "search") {
      donutBackupQuery = filterState.query || "";
    }
    donutActiveType = "search";
    donutActiveLabel = label;
    filterState.query = label;
    if ($booksFilterSearch) {
      $booksFilterSearch.value = label;
    }
  }

  withStableMainScroll(() => {
    renderFilterChips();
    renderBooks();
  });
}

function buildBookCountryStats(ids) {
  const m = new Map();
  (ids || []).forEach((id) => {
    const b = books?.[id];
    const country = normalizeCountryRecord(b?.country, b?.countryLabel);
    if (!country || !country.label) return;
    const key = country.code || country.label.toLowerCase();
    const current = m.get(key) || { code: country.code, label: country.label, english: country.english, value: 0 };
    current.value += 1;
    m.set(key, current);
  });
  return Array.from(m.values()).sort(
    (a, b) => b.value - a.value || a.label.localeCompare(b.label, "es", { sensitivity: "base" })
  );
}

function renderBooksGeo(ids) {
  if (!$booksGeoSection) return;
  const stats = buildBookCountryStats(ids);
  if (!stats.length) {
    $booksGeoSection.style.display = "none";
    if ($booksWorldMap) {
      if (typeof $booksWorldMap.__geoCleanup === "function") $booksWorldMap.__geoCleanup();
      $booksWorldMap.innerHTML = "";
    }
    if ($booksCountryList) $booksCountryList.innerHTML = "";
    return;
  }
  $booksGeoSection.style.display = "block";
  const mapData = stats
    .filter((s) => s.code)
    .map((s) => ({
      code: s.code,
      value: s.value,
      label: s.label,
      mapName: s.english
    }));
  renderCountryHeatmap($booksWorldMap, mapData, { emptyLabel: "Añade el país de tus libros" });
  renderCountryList($booksCountryList, stats, "libro");
}

function renderFinishedCharts(finishedIds) {
  if (!$booksChartsSection) return;

  const ids = finishedIds || [];
  if (!ids.length) {
    $booksChartsSection.style.display = "none";
    return;
  }
  $booksChartsSection.style.display = "block";

  const byGenre = countBy(ids, (b) => b?.genre || "Sin categoría");
  const byAuthor = countBy(ids, (b) => b?.author || "Sin autor");
  const byCentury = countBy(ids, (b) => yearToCenturyLabel(b?.year));
  const byLanguage = countBy(ids, (b) => b?.language || "Sin idioma");

  renderDonutChart($chartGenre, "Categoría", byGenre, {
    onSliceSelect: (selection) => applyDonutFilter(selection, "genre"),
    activeLabel: donutActiveType === "genre" ? donutActiveLabel : null
  });
  renderDonutChart($chartAuthor, "Autor", byAuthor, {
    onSliceSelect: (selection) => applyDonutFilter(selection, "author"),
    activeLabel: donutActiveType === "author" ? donutActiveLabel : null
  });
  renderDonutChart($chartCentury, "Siglo", byCentury, {
    onSliceSelect: (selection) => applyDonutFilter(selection, "century"),
    activeLabel: donutActiveType === "century" ? donutActiveLabel : null
  });
  renderDonutChart($chartLanguage, "Idioma", byLanguage, {
    onSliceSelect: (selection) => applyDonutFilter(selection, "language"),
    activeLabel: donutActiveType === "language" ? donutActiveLabel : null
  });
}



function buildReadingSpine(id) {
  const b = books[id] || {};
  const title = b.title || "Sin título";
  const total = Number(b.pages) || 0;
  const current = Math.min(total || Infinity, Number(b.currentPage) || 0);
  const percent = total > 0 ? Math.round((current / total) * 100) : 0;
  const favorite = !!b.favorite;
  const [c1, c2] = favorite ? ["#f8e6aa", "#d3a74a"] : pickSpinePalette(title + id);

  const spine = document.createElement("div");
  const baseHeight = 118 + Math.min(90, Math.round((total || 120) / 4));
  const height = Math.min(baseHeight, 170);
  spine.className = "book-spine book-spine-reading";
  if (favorite) spine.classList.add("book-spine-favorite");
  spine.style.setProperty("--spine-height", `${height}px`);
  spine.style.setProperty("--spine-color-1", c1);
  spine.style.setProperty("--spine-color-2", c2);
  spine.style.setProperty("--p", percent);
  spine.title = `${title}${b.author ? ` · ${b.author}` : ""}${total ? ` · ${current}/${total} (${percent}%)` : ""}`;
  spine.dataset.bookId = id;
  spine.tabIndex = 0;

  // Bookmark (SOLO input)
  const bm = document.createElement("div");
  bm.className = "book-bookmark";

  const input = document.createElement("input");
  input.className = "book-bookmark-input";
  input.type = "number";
  input.min = "0";
  input.inputMode = "numeric";
  input.placeholder = String(current);
  input.setAttribute("aria-label", "Página actual");

  const commit = () => {
    const raw = (input.value || "").trim();
    if (!raw) return;
    const newVal = parseInt(raw, 10);
    if (Number.isNaN(newVal)) return;
    const safe = total > 0 ? Math.max(0, Math.min(total, newVal)) : Math.max(0, newVal);
    input.value = "";
    updateBookProgress(id, safe);
  };

  input.addEventListener("click", (e) => e.stopPropagation());
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      e.stopPropagation();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      input.value = "";
      input.blur();
    }
  });
  input.addEventListener("blur", commit);

  bm.appendChild(input);

  if (favorite) {
    const star = document.createElement("span");
    star.className = "book-spine-star";
    star.textContent = "★";
    spine.appendChild(star);
  }

  const t = document.createElement("span");
  t.className = "book-spine-title";
  t.textContent = title;

  const stats = document.createElement("div");
  stats.className = "book-spine-stats";

  const pages = document.createElement("span");
  pages.className = "book-spine-meta";
  pages.textContent = total ? String(total) : "—";

  const pctEl = document.createElement("span");
  pctEl.className = "book-spine-pct";
  pctEl.textContent = `${percent}%`;

  stats.appendChild(pages);
  stats.appendChild(pctEl);

  spine.appendChild(bm);
  spine.appendChild(t);
  spine.appendChild(stats);

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
  const searchQuery = (filterState.query || "").trim().toLowerCase();
  renderFilterChips();

  const finishedIdsAll = [];
  idsAll.forEach((id) => {
    const b = books[id];
    const total = Number(b?.pages) || 0;
    const current = Math.min(total || Infinity, Number(b?.currentPage) || 0);
    const finished = isBookFinished(b) || (total > 0 && current >= total);
    if (finished) finishedIdsAll.push(id);
  });

  if (!idsAll.length) {
    if ($booksListActive) $booksListActive.innerHTML = "";
    if (hasFinishedUI) {
      $booksListFinished.innerHTML = "";
      $booksFinishedSection.style.display = "none";
      if ($booksFinishedCount) $booksFinishedCount.textContent = "0";
    }
    if ($booksGeoSection) {
      $booksGeoSection.style.display = "none";
      if ($booksWorldMap) $booksWorldMap.innerHTML = "";
      if ($booksCountryList) $booksCountryList.innerHTML = "";
    }
    if ($booksChartsSection) $booksChartsSection.style.display = "none";
    if ($booksShelfResults) $booksShelfResults.textContent = "";
    if ($booksShelfEmpty) $booksShelfEmpty.style.display = "none";
    if ($booksFilterEmpty) $booksFilterEmpty.style.display = "none";
    $booksEmpty.style.display = "block";
    return;
  }

  const filteredIds = applyFilters(books, searchQuery, filterState);

  const activeIds = [];
  const finishedIds = [];

  filteredIds.forEach((id) => {
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

  const hasFilteredBooks = activeIds.length > 0 || finishedIds.length > 0;
  if ($booksEmpty) {
    $booksEmpty.style.display = "none";
  }
  if ($booksFilterEmpty) {
    $booksFilterEmpty.style.display = hasFilteredBooks ? "none" : "block";
  }

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
    if (b?.countryLabel || b?.country) metaBits.push(b.countryLabel || b.country);
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

  // Render activos (estantería)
  if ($booksListActive) {
    const fragA = document.createDocumentFragment();
    const SHELF_SIZE_ACTIVE = 7;

    for (let i = 0; i < activeIds.length; i += SHELF_SIZE_ACTIVE) {
      const row = document.createElement("div");
      row.className = "books-shelf-row books-shelf-row-reading";
      activeIds.slice(i, i + SHELF_SIZE_ACTIVE).forEach((bookId) => {
        row.appendChild(buildReadingSpine(bookId));
      });
      fragA.appendChild(row);
    }

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

  // Charts bajo “Terminados”
  renderBooksGeo(idsAll); // mapa con todos los libros que tengan país
  renderFinishedCharts(finishedIdsAll);
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
  let diff = 0;

  try {
    const bookRef = ref(db, `${BOOKS_PATH}/${bookId}`);
    const res = await runTransaction(bookRef, (book) => {
      if (!book) return; // aborta si no existe

      const total = Number(book.pages) || 0;
      const oldPage = Math.max(0, Math.min(total, Number(book.currentPage) || 0));
      const safeNew = Math.max(0, Math.min(total, Number(newPage) || 0));
      diff = safeNew - oldPage;

      const updates = {
        ...book,
        currentPage: safeNew,
        updatedAt: Date.now()
      };

      // Auto-finish / auto-unfinish (para que el calendario/contadores se corrijan al editar)
      const shouldFinish = total > 0 && safeNew >= total;
      const wasFinished =
        book.status === "finished" || (total > 0 && (Number(book.currentPage) || 0) >= total);
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

      return updates;
    });

    // Registramos páginas leídas del día como DELTA editable (si corriges, se corrige)
    if (res?.committed && diff !== 0) {
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

function computeFinishedPastPages() {
  let pages = 0;
  Object.values(books || {}).forEach((b) => {
    if (!b?.finishedPast) return;
    if (!isBookFinished(b)) return;
    pages += Number(b.pages) || 0;
  });
  return pages;
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
  totalAll += computeFinishedPastPages();

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
