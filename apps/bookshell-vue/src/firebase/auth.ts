import { getAuth } from 'firebase/auth';
import { firebaseApp } from '@/firebase/app';

export const firebaseAuth = getAuth(firebaseApp);

export function requireUid(): string {
  const uid = firebaseAuth.currentUser?.uid;
  if (!uid) {
    throw new Error('Missing authenticated user');
  }
  return uid;
}
