import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

function normalizeUid(uidParam) {
  const uid = uidParam || getAuth().currentUser?.uid;
  if (!uid) throw new Error("UID no disponible");
  return uid;
}

export function resolveMediaRoot(uidParam) {
  const uid = normalizeUid(uidParam);
  return `v2/users/${uid}/movies/media`;
}

export function resolveTripsRoot(uidParam) {
  const uid = normalizeUid(uidParam);
  return `v2/users/${uid}/trips`;
}

export function resolveMediaPathCandidates(uidParam) {
  const uid = normalizeUid(uidParam);
  return [
    resolveMediaRoot(uid),
    `v2/users/${uid}/movies`,
    `v2/users/${uid}/media`,
    "media"
  ];
}

export function resolveTripsPathCandidates(uidParam) {
  const uid = normalizeUid(uidParam);
  return [
    resolveTripsRoot(uid),
    `v2/users/${uid}/world`,
    `v2/users/${uid}/travel`,
    "world",
    "travel",
    "trips"
  ];
}
