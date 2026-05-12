import { db } from "../../../shared/firebase/index.js";
import {
  push,
  ref,
  remove,
  update,
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

export async function createBookQuoteRecord(rootPath, payload = {}) {
  const safeRootPath = String(rootPath || "").trim();
  if (!safeRootPath) throw new Error("Ruta de citas no disponible.");

  const quotesRef = ref(db, safeRootPath);
  const nextRef = push(quotesRef);
  const quoteId = String(nextRef.key || "").trim();
  if (!quoteId) throw new Error("No se pudo generar el identificador de la cita.");

  await update(ref(db), {
    [`${safeRootPath}/${quoteId}`]: payload,
  });

  return quoteId;
}

export async function deleteBookQuoteRecord(rootPath, quoteId = "") {
  const safeRootPath = String(rootPath || "").trim();
  const safeQuoteId = String(quoteId || "").trim();
  if (!safeRootPath || !safeQuoteId) return;
  await remove(ref(db, `${safeRootPath}/${safeQuoteId}`));
}
