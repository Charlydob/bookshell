// paths.js — base v2 (solo nuevas rutas)

export const V2 = "v2";

export const ALIAS = {
  USER: "USER",

  BOOKS: "BOOKS",
  VIDEOS: "VIDEOS",
  RECIPES: "RECIPES",
  HABITS: "HABITS",
  GAMES: "GAMES",
  MOVIES: "MOVIES",
  TRIPS: "TRIPS",
  FINANCE: "FINANCE",
  GYM: "GYM",
};

export function makeCtx({
  uid = "XXXXXX_UID",     // reemplaza por auth.currentUser.uid
} = {}) {
  return { uid };
}

function joinPath(...parts) {
  return parts
    .filter(Boolean)
    .map(String)
    .map(p => p.replace(/^\/+|\/+$/g, ""))
    .filter(Boolean)
    .join("/");
}

// ✅ Ruta base de usuario: v2/users/{uid}
export function userRoot(ctx = makeCtx()) {
  return joinPath(V2, "users", ctx.uid);
}

// ✅ Rutas top por módulo (todas cuelgan de userRoot)
export function path(alias, ctx = makeCtx(), ...extra) {
  const base = userRoot(ctx);

  switch (alias) {
    case ALIAS.USER:    return joinPath(base, ...extra);

    case ALIAS.BOOKS:   return joinPath(base, "books",   ...extra);
    case ALIAS.VIDEOS:  return joinPath(base, "videos",  ...extra);
    case ALIAS.RECIPES: return joinPath(base, "recipes", ...extra);
    case ALIAS.HABITS:  return joinPath(base, "habits",  ...extra);
    case ALIAS.GAMES:   return joinPath(base, "games",   ...extra);
    case ALIAS.MOVIES:  return joinPath(base, "movies",  ...extra);
    case ALIAS.TRIPS:   return joinPath(base, "trips",   ...extra);
    case ALIAS.FINANCE: return joinPath(base, "finance", ...extra);
    case ALIAS.GYM:     return joinPath(base, "gym",     ...extra);

    default:
      throw new Error(`[paths] Alias no reconocido: ${alias}`);
  }
}

/*
USO:

import { path, ALIAS, makeCtx } from "./paths.js";

const ctx = makeCtx({ uid: auth.currentUser.uid });

// top:
const booksPath = path(ALIAS.BOOKS, ctx); // v2/users/UID/books

// subrama:
const oneBookPath = path(ALIAS.BOOKS, ctx, "items", bookId);
// => v2/users/UID/books/items/{bookId}
*/