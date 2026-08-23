import { DATA_PROVIDER } from "../data/config.js";
import { db } from "./app.js";
import { userRoot } from "./rtdb-paths.js";

const firebaseDatabaseApi = DATA_PROVIDER === "api"
  ? null
  : await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js");

function assertRtdbAllowed() {
  if (DATA_PROVIDER === "api") {
    throw new Error("Firebase RTDB runtime access forbidden in API mode");
  }
}

export function getDbRef(path) {
  assertRtdbAllowed();
  return firebaseDatabaseApi.ref(db, path);
}

export function getUserRootDbPath(authUid) {
  return userRoot(authUid);
}

export function getUserRootDbRef(authUid) {
  return getDbRef(getUserRootDbPath(authUid));
}
