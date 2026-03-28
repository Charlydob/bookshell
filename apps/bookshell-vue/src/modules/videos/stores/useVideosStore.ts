import { defineStore } from 'pinia';
import type { VideoRecord } from '@/modules/videos/types';

export const useVideosStore = defineStore('videos', {
  state: () => ({
    records: [] as VideoRecord[],
  }),
});
