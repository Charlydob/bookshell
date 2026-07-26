import assert from 'node:assert/strict';
import {
  DEFAULT_SHORTCUT_INTEGRATION_START_AT,
  buildShortcutTransactionDiagnostics,
  looksLikeShortcutTransaction,
  resolveShortcutAccountDeltaAmount,
} from './shortcut-integration.js';

const accountId = '-account-1';
const baseShortcutTx = {
  accountAmount: 125,
  accountCurrency: 'CHF',
  accountId,
  allocation: {
    anchorDate: '2026-07-26',
    mode: 'point',
    period: 'day',
  },
  amount: 100,
  category: 'Prueba',
  convertedAmountEUR: 115,
  createdAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT + 1000,
  currency: 'EUR',
  date: '2026-07-26',
  exchangeRateToEUR: 1.15,
  fromAccountId: '',
  inputCurrency: 'CHF',
  monthKey: '2026-07',
  note: 'Prueba',
  originalAmount: 100,
  originalCurrency: 'CHF',
  toAccountId: '',
  totalEUR: 115,
  type: 'expense',
  updatedAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT + 1000,
};

function pendingDiagnostics(transactions, processed = {}) {
  return buildShortcutTransactionDiagnostics({
    transactions,
    accountsById: { [accountId]: { id: accountId } },
    processed,
    financePath: 'v2/users/u/finance/finance',
    startAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT,
  }).filter((item) => item.status === 'pending');
}

function applyOnce(balance, transactions, processed = {}) {
  const pending = pendingDiagnostics(transactions, processed);
  const nextProcessed = { ...processed };
  let nextBalance = balance;
  pending.forEach((item) => {
    const amount = resolveShortcutAccountDeltaAmount(item.row, item.accountId);
    nextBalance += item.type === 'income' ? amount : -amount;
    nextProcessed[item.transactionId] = {
      processedAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT + 2000,
      version: 1,
      accountId: item.accountId,
      type: item.type,
    };
  });
  return { balance: nextBalance, processed: nextProcessed, pendingCount: pending.length };
}

const expenseRun = applyOnce(1000, { expenseExternal: baseShortcutTx });
assert.equal(expenseRun.pendingCount, 1);
assert.equal(expenseRun.balance, 875);

const expenseReload = applyOnce(expenseRun.balance, { expenseExternal: baseShortcutTx }, expenseRun.processed);
assert.equal(expenseReload.pendingCount, 0);
assert.equal(expenseReload.balance, 875);

const incomeTx = { ...baseShortcutTx, type: 'income', accountAmount: 80 };
const incomeRun = applyOnce(1000, { incomeExternal: incomeTx });
assert.equal(incomeRun.pendingCount, 1);
assert.equal(incomeRun.balance, 1080);

const historicalTx = { ...baseShortcutTx, createdAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT - 1 };
assert.equal(pendingDiagnostics({ historicalTx }).length, 0);

const modalTx = {
  ...baseShortcutTx,
  id: 'modalTx',
  status: 'synced',
  pending: false,
  confirmed: true,
  amount: 100,
  accountAmount: 125,
};
assert.equal(pendingDiagnostics({ modalTx }).length, 0);
assert.equal(resolveShortcutAccountDeltaAmount(modalTx, accountId), 100);

const realShortcutPayload = {
  accountAmount: 107500,
  accountCurrency: 'CHF',
  accountId: '-Ovoe3mpRHw4_BlCX9m4',
  allocation: {
    anchorDate: '2026-07-26',
    mode: 'point',
    period: 'day',
  },
  amount: 100000,
  category: 'Prueba',
  convertedAmountEUR: 107500,
  createdAt: 1785080413917,
  currency: 'EUR',
  date: '2026-07-26',
  exchangeRateToEUR: 1.075,
  fromAccountId: '',
  inputCurrency: 'CHF',
  monthKey: '2026-07',
  note: 'Prueba',
  originalAmount: 100000,
  originalCurrency: 'CHF',
  toAccountId: '',
  totalEUR: 107500,
  type: 'expense',
  updatedAt: 1785080413917,
};
assert.equal(looksLikeShortcutTransaction(realShortcutPayload, DEFAULT_SHORTCUT_INTEGRATION_START_AT), true);
const realDiagnostics = buildShortcutTransactionDiagnostics({
  transactions: { realShortcutPayload },
  accountsById: { '-Ovoe3mpRHw4_BlCX9m4': { id: '-Ovoe3mpRHw4_BlCX9m4' } },
  processed: {},
  financePath: 'v2/users/u/finance/finance',
  startAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT,
});
assert.equal(realDiagnostics[0].status, 'pending');
assert.equal(realDiagnostics[0].accountAmount, 107500);

console.info('[finance:shortcut:check] ok');
