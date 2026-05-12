import {
  deleteBookQuoteRecord,
  createBookQuoteRecord,
} from "./persist/book-quotes-datasource.js";
import {
  isPersistedBookQuote,
  mapBookQuoteFromDb,
  mapBookQuoteToDb,
} from "./persist/book-quotes-mapper.js";

function normalizeBookTitle(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeQueryValue(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function resolveBookQuoteAuthor(book = {}) {
  const author = String(
    book?.author
    || (Array.isArray(book?.authors) ? book.authors.join(", ") : book?.authors)
    || ""
  ).trim();
  return author || "Autor desconocido";
}

export function listBookQuotesFromLinks(links = {}, { bookId = "", bookTitle = "" } = {}) {
  const safeBookId = String(bookId || "").trim();
  const titleKey = normalizeBookTitle(bookTitle);

  return Object.entries(links || {})
    .map(([id, item]) => mapBookQuoteFromDb(id, item))
    .filter(Boolean)
    .filter((item) => {
      if (!isPersistedBookQuote(item.raw)) return false;
      if (safeBookId && item.bookId === safeBookId) return true;
      return !!titleKey && normalizeBookTitle(item.bookTitle) === titleKey;
    })
    .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
}

export function filterBookQuotes(quotes = [], query = "") {
  const safeQuery = normalizeQueryValue(query);
  if (!safeQuery) return Array.isArray(quotes) ? [...quotes] : [];

  return (quotes || []).filter((quote) => {
    const haystack = [
      quote?.text,
      quote?.note,
      quote?.author,
      quote?.page != null ? String(quote.page) : "",
    ]
      .map((value) => normalizeQueryValue(value))
      .join(" ");
    return haystack.includes(safeQuery);
  });
}

export async function createBookQuoteForBook({
  linksPath = "",
  bookId = "",
  book = {},
  text = "",
  page = "",
  note = "",
} = {}) {
  const safeBookId = String(bookId || "").trim();
  const bookTitle = String(book?.title || "").trim();
  const normalizedText = String(text || "").replace(/\s+/g, " ").trim();
  if (!safeBookId) throw new Error("Libro no disponible para asociar la cita.");
  if (!bookTitle) throw new Error("El libro actual no tiene título.");
  if (!normalizedText) throw new Error("Escribe el texto de la cita.");

  const now = Date.now();
  const domainQuote = {
    text: normalizedText,
    page,
    note,
    author: resolveBookQuoteAuthor(book),
    bookId: safeBookId,
    bookTitle,
    createdAt: now,
    updatedAt: now,
  };

  const persistedQuote = mapBookQuoteToDb(domainQuote);
  const quoteId = await createBookQuoteRecord(linksPath, persistedQuote);
  return mapBookQuoteFromDb(quoteId, persistedQuote);
}

export async function deleteBookQuoteForBook({ linksPath = "", quoteId = "" } = {}) {
  await deleteBookQuoteRecord(linksPath, quoteId);
}
