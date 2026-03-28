import { defineStore } from 'pinia';
import type { RecipeRecord } from '@/modules/recipes/types';

export const useRecipesStore = defineStore('recipes', {
  state: () => ({
    records: [] as RecipeRecord[],
  }),
});
