import { getDatabase } from 'firebase/database';
import { firebaseApp } from '@/firebase/app';

export const firebaseDatabase = getDatabase(firebaseApp);
