import { defineStore } from 'pinia';
import type { FinanceAccountRecord } from '@/modules/finance/types';

export const useFinanceStore = defineStore('finance', {
  state: () => ({
    accounts: [] as FinanceAccountRecord[],
  }),
});
