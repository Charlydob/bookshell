const normalizeLabel = (v) => String(v ?? "").trim();

/** Normaliza un ISBN eliminando caracteres no válidos. */
export function normalizeIsbn(raw = "") {
  return String(raw || "").replace(/[^0-9Xx]/g, "").toUpperCase();
}

const parsePublishYear = (val) => {
  if (!val) return null;
  const n = Number(val);
  if (Number.isInteger(n) && n > 0) return n;
  if (typeof val === "string" && val.length >= 4) {
    const maybeYear = Number(val.slice(0, 4));
    if (Number.isInteger(maybeYear)) return maybeYear;
  }
  return null;
};

const dedupeMatches = (matches) => {
  const seen = new Set();
  return (matches || []).filter((m) => {
    const key = `${(m.title || "").toLowerCase()}|${(m.author || "").toLowerCase()}|${m.year || ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const fetchFromOpenLibrary = async (isbn) => {
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
};

const fetchFromGoogleBooks = async (isbn) => {
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
};

/**
 * Busca información de un libro a partir de su ISBN.
 * @param {string} isbn
 */
export async function fetchBookByISBN(isbn) {
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

/** Ordena etiquetas alfabéticamente en español. */
export function sortLabels(arr) {
  return [...arr].sort((a, b) => a.localeCompare(b, "es", { sensitivity: "base" }));
}

/** Normaliza el texto de una etiqueta. */
export function normalizeLabelText(v) {
  return normalizeLabel(v);
}
