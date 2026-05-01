import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { firebasePaths, getUserDataKey } from "../../shared/firebase/index.js";

export function resolveFinancePathCandidates(authUidParam) {
  const authUser = getAuth().currentUser || null;
  const explicitAuthUid = String(authUidParam || "").trim();
  const currentUid = String(authUser?.uid || "").trim();
  const authUid = explicitAuthUid
    ? (explicitAuthUid === currentUid ? getUserDataKey(authUser) : explicitAuthUid)
    : getUserDataKey(authUser);
  if (!authUid) throw new Error("UID de auth no disponible");
  return [
    firebasePaths.financeRoot(authUid),
    firebasePaths.legacyFinanceRoot(authUid),
  ];
}

export function resolveFinancePath() {
  return resolveFinancePathCandidates()[0];
}
