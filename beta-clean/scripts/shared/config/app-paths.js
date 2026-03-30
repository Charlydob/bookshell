const APP_DATA_VERSION = "v2";
const USERS_SEGMENT = "users";

export const APP_DATA_ROOT = APP_DATA_VERSION;

export const MODULE_ALIASES = Object.freeze({
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
});

const MODULE_SEGMENTS = Object.freeze({
  [MODULE_ALIASES.BOOKS]: "books",
  [MODULE_ALIASES.VIDEOS]: "videos",
  [MODULE_ALIASES.RECIPES]: "recipes",
  [MODULE_ALIASES.HABITS]: "habits",
  [MODULE_ALIASES.GAMES]: "games",
  [MODULE_ALIASES.MOVIES]: "movies",
  [MODULE_ALIASES.TRIPS]: "trips",
  [MODULE_ALIASES.FINANCE]: "finance",
  [MODULE_ALIASES.GYM]: "gym",
});

export function createPathContext({ uid = "XXXXXX_UID" } = {}) {
  return { uid };
}

function normalizePathPart(part) {
  return String(part).replace(/^\/+|\/+$/g, "");
}

function joinPath(...parts) {
  return parts
    .filter((part) => part !== undefined && part !== null && part !== "")
    .map(normalizePathPart)
    .filter(Boolean)
    .join("/");
}

export function getUserRootPath(ctx = createPathContext()) {
  return joinPath(APP_DATA_VERSION, USERS_SEGMENT, ctx.uid);
}

export function buildModulePath(alias, ctx = createPathContext(), ...extraSegments) {
  const userRoot = getUserRootPath(ctx);

  if (alias === MODULE_ALIASES.USER) {
    return joinPath(userRoot, ...extraSegments);
  }

  const moduleSegment = MODULE_SEGMENTS[alias];
  if (!moduleSegment) {
    throw new Error(`[app-paths] Alias no reconocido: ${alias}`);
  }

  return joinPath(userRoot, moduleSegment, ...extraSegments);
}
