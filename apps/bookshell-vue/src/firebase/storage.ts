import { getStorage } from 'firebase/storage';
import { firebaseApp } from '@/firebase/app';

export const firebaseStorage = getStorage(firebaseApp);
