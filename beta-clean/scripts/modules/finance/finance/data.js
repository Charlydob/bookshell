import { auth } from "../../../shared/firebase/index.js";

export function resolveFinancePathCandidates(uidParam) {
  const uid = uidParam || auth.currentUser?.uid;
  if (!uid) throw new Error("UID no disponible");
  return [
    `v2/users/${uid}/finance/finance`,
    `v2/users/${uid}/finance`
  ];
}

export function resolveFinancePath() {
  return resolveFinancePathCandidates()[0];
}
