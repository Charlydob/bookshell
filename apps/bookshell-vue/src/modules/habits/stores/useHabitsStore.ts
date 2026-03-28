import { defineStore } from 'pinia';
import type { HabitRecord } from '@/modules/habits/types';

export const useHabitsStore = defineStore('habits', {
  state: () => ({
    records: [] as HabitRecord[],
  }),
});
