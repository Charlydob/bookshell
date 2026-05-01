import { ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { db } from "./app.js";
import { userRoot } from "./rtdb-paths.js";

export function getDbRef(path) {
  return ref(db, path);
}

export function getUserRootDbPath(userKey) {
  return userRoot(userKey);
}

export function getUserRootDbRef(userKey) {
  return getDbRef(getUserRootDbPath(userKey));
}
