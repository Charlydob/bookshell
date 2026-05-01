import { db } from "../firebase/index.js";
import { get, push, ref, set, query, orderByChild, startAt, endAt, limitToFirst, runTransaction } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export function normalizeCatalogName(value = "") {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildSearchTokens(value = "") {
  const normalized = normalizeCatalogName(value);
  if (!normalized) return [];
  const tokens = new Set();
  normalized.split(" ").filter(Boolean).forEach((word) => {
    tokens.add(word);
    for (let i = 3; i <= Math.min(word.length, 12); i += 1) tokens.add(word.slice(0, i));
  });
  return Array.from(tokens).slice(0, 32);
}

export async function findPublicCatalogMatches(catalogPath, item = {}, max = 10) {
  const normalizedName = normalizeCatalogName(item?.name || "");
  const barcode = String(item?.barcode || "").trim();
  const out = [];
  if (normalizedName) {
    const q = query(ref(db, catalogPath), orderByChild("normalizedName"), startAt(normalizedName), endAt(`${normalizedName}\uf8ff`), limitToFirst(max));
    const snap = await get(q);
    if (snap.exists()) {
      snap.forEach((child) => out.push({ id: child.key, ...(child.val() || {}) }));
    }
  }
  if (barcode) {
    const byCode = out.find((it) => String(it?.barcode || "").trim() === barcode);
    if (byCode) return [byCode, ...out.filter((it) => it !== byCode)];
  }
  return out;
}

export async function upsertPublicCatalogItem(catalogPath, item = {}, uid = "") {
  const normalizedName = normalizeCatalogName(item?.name || "");
  if (!normalizedName) return null;
  const barcode = String(item?.barcode || "").trim();
  const brand = normalizeCatalogName(item?.brand || "");
  const category = normalizeCatalogName(item?.category || "");
  const now = Date.now();
  const matches = await findPublicCatalogMatches(catalogPath, item, 25);
  const found = matches.find((m) => {
    const mBarcode = String(m?.barcode || "").trim();
    if (barcode && mBarcode) return barcode === mBarcode;
    return normalizeCatalogName(m?.normalizedName || m?.name || "") === normalizedName
      && normalizeCatalogName(m?.brand || "") === brand
      && normalizeCatalogName(m?.category || "") === category;
  });
  const sanitized = {
    name: String(item?.name || "").trim(),
    normalizedName,
    category: String(item?.category || "").trim(),
    brand: String(item?.brand || "").trim(),
    barcode,
    baseUnit: String(item?.baseUnit || item?.unit || "").trim(),
    unit: String(item?.unit || item?.baseUnit || "").trim(),
    macros: item?.macros && typeof item.macros === "object" ? item.macros : undefined,
    source: "public",
    createdByUid: String(uid || "").trim(),
    updatedAt: now,
    searchTokens: buildSearchTokens(`${item?.name || ""} ${item?.brand || ""}`),
  };
  Object.keys(sanitized).forEach((k) => sanitized[k] === undefined && delete sanitized[k]);
  if (found?.id) {
    const target = ref(db, `${catalogPath}/${found.id}`);
    await set(target, { ...found, ...sanitized, id: found.id, createdAt: found.createdAt || now });
    await runTransaction(ref(db, `${catalogPath}/${found.id}/usageCount`), (v) => (Number(v) || 0) + 1);
    return { id: found.id, ...found, ...sanitized };
  }
  const newRef = push(ref(db, catalogPath));
  const payload = { ...sanitized, id: newRef.key, createdAt: now, usageCount: 1 };
  await set(newRef, payload);
  return payload;
}

export function clonePublicItemToUserCatalog(item = {}, extras = {}) {
  return {
    ...item,
    ...extras,
    id: extras?.id || item?.id,
    publicSourceId: String(item?.id || "").trim(),
    source: "copied",
    updatedAt: Date.now(),
  };
}
