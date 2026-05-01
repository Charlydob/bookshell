import { ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { db } from "./app.js";
import { userRoot } from "./rtdb-paths.js";

export function getDbRef(path) {
  return ref(db, path);
}

export function getUserRootDbPath(authUid) {
  return userRoot(authUid);
}

export function getUserRootDbRef(authUid) {
  return getDbRef(getUserRootDbPath(authUid));
}
