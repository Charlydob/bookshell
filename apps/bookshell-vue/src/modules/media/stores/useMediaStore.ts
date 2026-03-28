import { defineStore } from 'pinia';
import type { MediaRecord } from '@/modules/media/types';

export const useMediaStore = defineStore('media', {
  state: () => ({
    records: [] as MediaRecord[],
  }),
});
