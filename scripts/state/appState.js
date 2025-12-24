import { DEFAULT_GENRES } from "../data/firebase.js";

export const appState = {
  books: {},
  readingLog: {},
  genreOptions: [...DEFAULT_GENRES],
  bookDetailId: null,
  filterState: {
    query: "",
    genres: new Set(),
    showPending: false,
    showFinished: false
  },
  calendar: {
    year: null,
    month: null,
    viewMode: "month"
  },
  donut: {
    backupQuery: null,
    backupGenres: null,
    activeType: null
  }
};

/** @param {Record<string, any>} books */
export function setBooks(books) {
  appState.books = books || {};
}

/** @param {Record<string, any>} log */
export function setReadingLog(log) {
  appState.readingLog = log || {};
}

/** @param {string[]} genres */
export function setGenreOptions(genres) {
  appState.genreOptions = genres || [];
}

/** @param {string|null} id */
export function setBookDetailId(id) {
  appState.bookDetailId = id;
}

/**
 * Actualiza parte del estado del calendario.
 * @param {{ year?: number|null, month?: number|null, viewMode?: "month"|"year" }} partial
 */
export function updateCalendar(partial) {
  Object.assign(appState.calendar, partial);
}

/**
 * Actualiza el estado de filtros.
 * @param {{ query?: string, genres?: Set<string>, showPending?: boolean, showFinished?: boolean }} partial
 */
export function updateFilterState(partial) {
  Object.assign(appState.filterState, partial);
}

/**
 * Actualiza el estado de interacción del donut.
 * @param {{ backupQuery?: string|null, backupGenres?: Set<string>|null, activeType?: string|null }} partial
 */
export function updateDonutState(partial) {
  Object.assign(appState.donut, partial);
}
