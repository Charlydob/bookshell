import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

export function resolveFinancePathCandidates(uidParam) {
  const uid = uidParam || getAuth().currentUser?.uid;
  if (!uid) throw new Error("UID no disponible");
  return [
    `v2/users/${uid}/finance/finance`,
    `v2/users/${uid}/finance`
  ];
}

export function resolveFinancePath() {
  return resolveFinancePathCandidates()[0];
}
