import { defineStore } from 'pinia';
import type { WorkoutRecord } from '@/modules/gym/types';

export const useGymStore = defineStore('gym', {
  state: () => ({
    workouts: [] as WorkoutRecord[],
  }),
});
