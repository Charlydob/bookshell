import { db } from "../shared/firebase/index.js";
import { ref, remove } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const MEDIA_ROUTE_PATH = "media";

// One-shot cleanup utility. Set globalThis.DELETE_MEDIA_ROUTE = true before importing.
function canDeleteMediaRoute() {
  const flag = globalThis.DELETE_MEDIA_ROUTE;
  return flag === true || flag === "true";
}

export async function deleteMediaRoute() {
  if (MEDIA_ROUTE_PATH !== "media") {
    throw new Error("[cleanup:media:error] invalid target path");
  }

  if (!canDeleteMediaRoute()) {
    throw new Error("[cleanup:media:error] DELETE_MEDIA_ROUTE=true is required");
  }

  console.info("[cleanup:media:start]", { path: MEDIA_ROUTE_PATH });
  try {
    await remove(ref(db, "media"));
    console.info("[cleanup:media:done]", { path: MEDIA_ROUTE_PATH });
    return true;
  } catch (error) {
    console.error("[cleanup:media:error]", {
      path: MEDIA_ROUTE_PATH,
      message: error?.message || String(error || ""),
    });
    throw error;
  }
}

if (canDeleteMediaRoute()) {
  void deleteMediaRoute();
}
