import { ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { createPathContext, getUserRootPath } from "../config/app-paths.js";
import { db } from "./app.js";

export function getDbRef(path) {
  return ref(db, path);
}

export function getUserRootDbPath(uid) {
  return getUserRootPath(createPathContext({ uid }));
}

export function getUserRootDbRef(uid) {
  return getDbRef(getUserRootDbPath(uid));
}
