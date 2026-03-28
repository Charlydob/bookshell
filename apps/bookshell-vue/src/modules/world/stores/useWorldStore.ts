import { defineStore } from 'pinia';
import type { WorldRecord } from '@/modules/world/types';

export const useWorldStore = defineStore('world', {
  state: () => ({
    records: [] as WorldRecord[],
  }),
});
