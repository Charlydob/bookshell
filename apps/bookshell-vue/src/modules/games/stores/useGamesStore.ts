import { defineStore } from 'pinia';
import type { GameGroupRecord } from '@/modules/games/types';

export const useGamesStore = defineStore('games', {
  state: () => ({
    groups: [] as GameGroupRecord[],
  }),
});
