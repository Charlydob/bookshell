function normalizeId(value = "") {
  return String(value || "").trim();
}

function buildNoteImageStoragePath(uid = "", noteId = "") {
  const safeUid = normalizeId(uid);
  const safeNoteId = normalizeId(noteId);
  if (!safeUid || !safeNoteId) throw new Error("No se pudo resolver la ruta de la imagen de la nota.");
  return `notes/${safeUid}/images/${safeNoteId}/cover`;
}

function buildTagImageStoragePath(uid = "", tagKey = "") {
  const safeUid = normalizeId(uid);
  const safeTagKey = normalizeId(tagKey);
  if (!safeUid || !safeTagKey) throw new Error("No se pudo resolver la ruta de la imagen del tag.");
  return `notes/${safeUid}/tags/${safeTagKey}/cover`;
}

function isRemoteUrl(value = "") {
  return /^https?:\/\//i.test(String(value || "").trim());
}

async function uploadImageToCloudinary(file) {
  const fn =
    typeof window !== "undefined" && typeof window.subirImagenACloudinary === "function"
      ? window.subirImagenACloudinary
      : async (nextFile) => {
          const formData = new FormData();
          formData.append("file", nextFile);
          formData.append("upload_preset", "publico");
          const response = await fetch("https://api.cloudinary.com/v1_1/dgdavibcx/image/upload", {
            method: "POST",
            body: formData,
          });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || !String(payload?.secure_url || "").trim()) {
            throw new Error(payload?.error?.message || "No se pudo subir la imagen a Cloudinary.");
          }
          return String(payload.secure_url).trim();
        };

  return fn(file);
}

async function loadFirebaseDeleteApi() {
  const [{ getStorageService }, storageApi] = await Promise.all([
    import("../../../shared/firebase/index.js"),
    import("https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js"),
  ]);
  const storage = await getStorageService();
  return {
    storage,
    storageRef: storageApi.ref,
    deleteObject: storageApi.deleteObject,
  };
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
  if (!(file instanceof File)) throw new Error("No se ha seleccionado ninguna imagen valida.");

  const path = buildNoteImageStoragePath(safeUid, safeNoteId);
  const url = await uploadImageToCloudinary(file);
  return { path, url };
}

export async function uploadNoteTagImageAsset(uid, tagKey, file) {
  const safeUid = normalizeId(uid);
  const safeTagKey = normalizeId(tagKey);
  if (!safeUid || !safeTagKey) throw new Error("No se pudo identificar el tag de la nota.");
  if (!(file instanceof File)) throw new Error("No se ha seleccionado ninguna imagen valida.");

  const path = buildTagImageStoragePath(safeUid, safeTagKey);
  const url = await uploadImageToCloudinary(file);
  return { path, url };
}

export async function deleteNoteImageAsset(uid, noteId, path = "") {
  const safeUid = normalizeId(uid);
  const safeNoteId = normalizeId(noteId);
  if (!safeUid || !safeNoteId) return false;

  const safePath = normalizeId(path) || buildNoteImageStoragePath(safeUid, safeNoteId);
  if (isRemoteUrl(safePath)) return false;

  const { storage, storageRef, deleteObject } = await loadFirebaseDeleteApi();

  try {
    await deleteObject(storageRef(storage, safePath));
    return true;
  } catch (error) {
    if (String(error?.code || "") === "storage/object-not-found") return false;
    throw error;
  }
}

export async function deleteNoteTagImageAsset(uid, tagKey, path = "") {
  const safeUid = normalizeId(uid);
  const safeTagKey = normalizeId(tagKey);
  if (!safeUid || !safeTagKey) return false;

  const safePath = normalizeId(path) || buildTagImageStoragePath(safeUid, safeTagKey);
  if (isRemoteUrl(safePath)) return false;

  const { storage, storageRef, deleteObject } = await loadFirebaseDeleteApi();

  try {
    await deleteObject(storageRef(storage, safePath));
    return true;
  } catch (error) {
    if (String(error?.code || "") === "storage/object-not-found") return false;
    throw error;
  }
}
