import { defineStore } from 'pinia';
import type { BookRecord } from '@/modules/books/types';

export const useBooksStore = defineStore('books', {
  state: () => ({
    records: [] as BookRecord[],
    booted: false,
  }),
});
