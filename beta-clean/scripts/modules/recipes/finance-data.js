import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { firebasePaths, getUserDataKey } from "../../shared/firebase/index.js";

export function resolveFinancePathCandidates(userKeyParam) {
  const authUser = getAuth().currentUser || null;
  const explicitUserKey = String(userKeyParam || "").trim();
  const currentUid = String(authUser?.uid || "").trim();
  const userKey = explicitUserKey
    ? (explicitUserKey === currentUid ? getUserDataKey(authUser) : explicitUserKey)
    : getUserDataKey(authUser);
  if (!userKey) throw new Error("Clave de usuario no disponible");
  return [
    firebasePaths.financeRoot(userKey),
    firebasePaths.legacyFinanceRoot(userKey),
  ];
}

export function resolveFinancePath() {
  return resolveFinancePathCandidates()[0];
}
