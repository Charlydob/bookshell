function normalizeText(value = "") {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeOptionalText(value = "") {
  return String(value || "").trim();
}

function normalizePage(value = "") {
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  const page = Math.max(1, Math.round(numeric));
  return page || null;
}

function normalizeCategory(value = "") {
  return String(value || "").trim().toLowerCase();
}

export function isPersistedBookQuote(value = {}) {
  const category = normalizeCategory(value?.category);
  return category === "bookquote" || category === "libro/cita";
}

export function mapBookQuoteFromDb(id, value = {}) {
  const text = normalizeText(
    value?.quoteText
    || value?.text
    || value?.note
    || value?.content
    || value?.title
  );
  if (!text) return null;

  return {
    id: String(id || "").trim(),
    text,
    page: normalizePage(value?.page),
    note: normalizeOptionalText(value?.quoteNote || value?.annotation || ""),
    author: normalizeOptionalText(value?.author || ""),
    bookId: normalizeOptionalText(value?.bookId || ""),
    bookTitle: normalizeOptionalText(value?.bookTitle || ""),
    category: normalizeOptionalText(value?.category || "bookQuote"),
    createdAt: Number(value?.createdAt || 0),
    updatedAt: Number(value?.updatedAt || value?.createdAt || 0),
    raw: value || {},
  };
}

export function mapBookQuoteToDb(quote = {}) {
  const text = normalizeText(quote?.text);
  const note = normalizeOptionalText(quote?.note);
  const author = normalizeOptionalText(quote?.author);
  const page = normalizePage(quote?.page);
  const createdAt = Number(quote?.createdAt || Date.now());
  const updatedAt = Number(quote?.updatedAt || createdAt || Date.now());

  return {
    type: "link",
    category: "bookQuote",
    title: text.slice(0, 120),
    note: text,
    quoteNote: note,
    page,
    author,
    bookId: normalizeOptionalText(quote?.bookId),
    bookTitle: normalizeOptionalText(quote?.bookTitle),
    createdAt,
    updatedAt,
  };
}
