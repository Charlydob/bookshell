import { auth, firebasePaths, getUserDataKey } from "../../../shared/firebase/index.js";

export function resolveFinancePathCandidates(authUidParam) {
  const explicitAuthUid = String(authUidParam || "").trim();
  const currentUid = String(auth.currentUser?.uid || "").trim();
  const authUid = explicitAuthUid
    ? (explicitAuthUid === currentUid ? getUserDataKey(auth.currentUser) : explicitAuthUid)
    : getUserDataKey(auth.currentUser);
  if (!authUid) throw new Error("UID de auth no disponible");
  return [
    firebasePaths.financeRoot(authUid),
    firebasePaths.legacyFinanceRoot(authUid),
  ];
}

export function resolveFinancePath() {
  return resolveFinancePathCandidates()[0];
}
