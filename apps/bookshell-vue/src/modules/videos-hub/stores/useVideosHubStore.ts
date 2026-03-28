import { defineStore } from 'pinia';
import type { VideosHubRecord } from '@/modules/videos-hub/types';

export const useVideosHubStore = defineStore('videosHub', {
  state: () => ({
    records: [] as VideosHubRecord[],
  }),
});
