import { get, ref, remove } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js';
import { db, getCurrentUserDataRootKey } from '../shared/firebase/index.js';

const DELETE_PATHS = ['media','movies','peliculas','games','achievements','logros','missions','misiones','quests','tasks','rewards','badges'];
const KEEP_PATHS = ['world','mundo','places','locales','stays','notes','finance','habits','recipes','books','gym','settings/profile/auth/meta/schema'];

function bytes(v){ try{return new TextEncoder().encode(JSON.stringify(v??null)).length;}catch{return 0;} }

export async function runFirebasePrune() {
  const userKey = getCurrentUserDataRootKey();
  if (!userKey) throw new Error('Missing userKey');
  const base = `v2/users/${userKey}`;

  const found = [];
  for (const key of DELETE_PATHS) {
    const path = `${base}/${key}`;
    const snap = await get(ref(db, path));
    if (snap.exists()) found.push({ path, approxBytes: bytes(snap.val()) });
  }
  console.table(found);

  const backup = {};
  for (const key of KEEP_PATHS) {
    const path = `${base}/${key}`;
    const snap = await get(ref(db, path));
    if (snap.exists()) backup[key] = snap.val();
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `bookshell-keep-backup-${userKey}-${Date.now()}.json`; a.click();
  URL.revokeObjectURL(url);

  for (const key of DELETE_PATHS) {
    const path = `${base}/${key}`;
    await remove(ref(db, path));
    console.debug('[firebase:cleanup:removed-module]', path);
  }
}

window.runFirebasePrune = runFirebasePrune;
