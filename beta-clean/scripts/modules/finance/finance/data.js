import { auth, firebasePaths, getUserDataKey } from "../../../shared/firebase/index.js";

export function resolveFinancePathCandidates(userKeyParam) {
  const explicitUserKey = String(userKeyParam || "").trim();
  const currentUid = String(auth.currentUser?.uid || "").trim();
  const userKey = explicitUserKey
    ? (explicitUserKey === currentUid ? getUserDataKey(auth.currentUser) : explicitUserKey)
    : getUserDataKey(auth.currentUser);
  if (!userKey) throw new Error("Clave de usuario no disponible");
  return [
    firebasePaths.financeRoot(userKey),
    firebasePaths.legacyFinanceRoot(userKey),
  ];
}

export function resolveFinancePath() {
  return resolveFinancePathCandidates()[0];
}
