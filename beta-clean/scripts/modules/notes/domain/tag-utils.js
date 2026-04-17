export function normalizeTagLabel(value = "") {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function buildTagDefinitionKey(value = "") {
  const label = normalizeTagLabel(value);
  if (!label) return "";

  const asciiLabel = label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const compactKey = asciiLabel
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  if (compactKey) return compactKey;

  const fallback = Array.from(label)
    .map((char) => char.codePointAt(0)?.toString(16) || "")
    .filter(Boolean)
    .join("-");

  return fallback ? `tag-${fallback.slice(0, 120)}` : "";
}

export function parseTagList(rawValue = "") {
  const seen = new Set();

  return String(rawValue || "")
    .split(",")
    .map((tag) => normalizeTagLabel(tag))
    .filter(Boolean)
    .filter((tag) => {
      const key = buildTagDefinitionKey(tag);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}
