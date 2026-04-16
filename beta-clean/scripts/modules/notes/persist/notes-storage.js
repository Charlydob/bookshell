import { getStorageService } from "../../../shared/firebase/index.js";

let storageApiPromise = null;

function normalizeId(value = "") {
  return String(value || "").trim();
}

function buildNoteImageStoragePath(uid = "", noteId = "") {
  const safeUid = normalizeId(uid);
  const safeNoteId = normalizeId(noteId);
  if (!safeUid || !safeNoteId) throw new Error("No se pudo resolver la ruta de la imagen de la nota.");
  return `notes/${safeUid}/images/${safeNoteId}/cover`;
}

async function loadStorageApi() {
  if (!storageApiPromise) {
    storageApiPromise = Promise.all([
      getStorageService(),
      import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js"),
    ]).then(([storage, storageApi]) => ({
      storage,
      storageRef: storageApi.ref,
      uploadBytes: storageApi.uploadBytes,
      getDownloadURL: storageApi.getDownloadURL,
      deleteObject: storageApi.deleteObject,
    }));
  }

  return storageApiPromise;
}

export async function downscaleNoteImageFile(file, { maxEdge = 1600, quality = 0.84 } = {}) {
  if (!(file instanceof File)) return file;
  if (!String(file.type || "").startsWith("image/")) return file;

  const preferredType = /image\/(png|webp)/i.test(file.type || "") ? file.type : "image/jpeg";
  let source = null;
  let objectUrl = null;

  try {
    if (typeof createImageBitmap === "function") {
      source = await createImageBitmap(file);
    } else {
      objectUrl = URL.createObjectURL(file);
      source = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = objectUrl;
      });
    }

    const width = Number(source?.width || 0);
    const height = Number(source?.height || 0);
    if (!width || !height) return file;

    const ratio = Math.min(1, maxEdge / width, maxEdge / height);
    if (ratio >= 0.999 && file.size <= 900 * 1024) return file;

    const nextWidth = Math.max(1, Math.round(width * ratio));
    const nextHeight = Math.max(1, Math.round(height * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = nextWidth;
    canvas.height = nextHeight;

    const ctx = canvas.getContext("2d", { alpha: preferredType === "image/png" });
    if (!ctx) return file;
    ctx.drawImage(source, 0, 0, nextWidth, nextHeight);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, preferredType, quality));
    if (!blob) return file;
    if (blob.size >= file.size && ratio >= 0.999) return file;

    const nextName = preferredType === "image/png"
      ? String(file.name || "note-photo.png").replace(/\.[a-z0-9]+$/i, ".png")
      : String(file.name || "note-photo.jpg").replace(/\.[a-z0-9]+$/i, ".jpg");

    return new File([blob], nextName, {
      type: blob.type || preferredType,
      lastModified: Date.now(),
    });
  } catch (_) {
    return file;
  } finally {
    try { source?.close?.(); } catch (_) {}
    if (objectUrl) {
      try { URL.revokeObjectURL(objectUrl); } catch (_) {}
    }
  }
}

export async function uploadNoteImageAsset(uid, noteId, file) {
  const safeUid = normalizeId(uid);
  const safeNoteId = normalizeId(noteId);
  if (!safeUid || !safeNoteId) throw new Error("No se pudo identificar al usuario o la nota.");
  if (!(file instanceof File)) throw new Error("No se ha seleccionado ninguna imagen válida.");

  const { storage, storageRef, uploadBytes, getDownloadURL } = await loadStorageApi();
  const path = buildNoteImageStoragePath(safeUid, safeNoteId);
  const imageRef = storageRef(storage, path);

  await uploadBytes(imageRef, file, {
    contentType: file.type || "image/jpeg",
    cacheControl: "public,max-age=3600",
  });

  const url = await getDownloadURL(imageRef);
  return { path, url };
}

export async function deleteNoteImageAsset(uid, noteId, path = "") {
  const safeUid = normalizeId(uid);
  const safeNoteId = normalizeId(noteId);
  if (!safeUid || !safeNoteId) return false;

  const safePath = normalizeId(path) || buildNoteImageStoragePath(safeUid, safeNoteId);
  const { storage, storageRef, deleteObject } = await loadStorageApi();

  try {
    await deleteObject(storageRef(storage, safePath));
    return true;
  } catch (error) {
    if (String(error?.code || "") === "storage/object-not-found") return false;
    throw error;
  }
}
