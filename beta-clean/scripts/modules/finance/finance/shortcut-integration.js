export const SHORTCUT_INTEGRATION_VERSION = 1;
export const DEFAULT_SHORTCUT_INTEGRATION_START_AT = 1785016800000;

console.info('[ShortcutIntegration] module loaded', {
  version: SHORTCUT_INTEGRATION_VERSION,
  defaultStartAt: DEFAULT_SHORTCUT_INTEGRATION_START_AT,
  moduleUrl: import.meta.url,
});

const INTERNAL_MOVEMENT_MARKERS = Object.freeze([
  'status',
  'pending',
  'draft',
  'disabled',
  'excluded',
  'deleted',
  'confirmed',
  'source',
  'ticketId',
  'receiptId',
  'recurringId',
  'recurringAutoCreated',
]);

function hasOwn(row = {}, key = '') {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validIsoDay(value = '') {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || '').trim());
}

export function normalizeShortcutIntegrationStartAt(value = DEFAULT_SHORTCUT_INTEGRATION_START_AT) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_SHORTCUT_INTEGRATION_START_AT;
}

export function normalizeShortcutTransactionType(type = '') {
  const safe = String(type || '').trim().toLowerCase();
  return ['expense', 'income', 'transfer'].includes(safe) ? safe : '';
}

export function hasInternalMovementMarkers(row = {}) {
  if (!isPlainObject(row)) return false;
  return INTERNAL_MOVEMENT_MARKERS.some((key) => hasOwn(row, key));
}

export function getShortcutSchemaRejectionReasons(row = {}) {
  const reasons = [];
  if (!isPlainObject(row)) return ['not-plain-object'];
  const allocation = row.allocation;
  const date = String(row.date || '').trim();
  const monthKey = String(row.monthKey || '').trim();
  const converted = Number(row.convertedAmountEUR ?? row.totalEUR);
  if (!Number.isFinite(Number(row.createdAt))) reasons.push('createdAt-not-numeric');
  if (!Number.isFinite(Number(row.updatedAt))) reasons.push('updatedAt-not-numeric');
  if (!validIsoDay(date)) reasons.push('date-not-iso-day');
  if (monthKey !== date.slice(0, 7)) reasons.push('monthKey-does-not-match-date');
  if (!isPlainObject(allocation)) reasons.push('allocation-missing');
  else {
    if (String(allocation.mode || '').trim() !== 'point') reasons.push('allocation-mode-not-point');
    if (String(allocation.period || '').trim() !== 'day') reasons.push('allocation-period-not-day');
    if (!validIsoDay(allocation.anchorDate || date)) reasons.push('allocation-anchorDate-not-iso-day');
  }
  if (!Number.isFinite(Number(row.accountAmount)) || Number(row.accountAmount) <= 0) reasons.push('accountAmount-not-positive');
  if (!Number.isFinite(Number(row.originalAmount)) || Number(row.originalAmount) <= 0) reasons.push('originalAmount-not-positive');
  if (!Number.isFinite(converted) || converted <= 0) reasons.push('eur-total-not-positive');
  if (!String(row.accountCurrency || '').trim()) reasons.push('accountCurrency-missing');
  if (!String(row.inputCurrency || '').trim()) reasons.push('inputCurrency-missing');
  if (!String(row.originalCurrency || '').trim()) reasons.push('originalCurrency-missing');
  if (!String(row.currency || '').trim()) reasons.push('currency-missing');
  return reasons;
}

export function hasShortcutCompatibleSchema(row = {}) {
  return getShortcutSchemaRejectionReasons(row).length === 0;
}

export function isShortcutTransactionCandidate(row = {}, startAt = DEFAULT_SHORTCUT_INTEGRATION_START_AT) {
  const createdAt = Number(row?.createdAt || 0);
  return (
    Number.isFinite(createdAt)
    && createdAt >= normalizeShortcutIntegrationStartAt(startAt)
    && hasShortcutCompatibleSchema(row)
    && !hasInternalMovementMarkers(row)
  );
}

export function looksLikeShortcutTransaction(row = {}, startAt = DEFAULT_SHORTCUT_INTEGRATION_START_AT) {
  return isShortcutTransactionCandidate(row, startAt);
}

export function resolveShortcutAccountDeltaAmount(row = {}, accountId = '', startAt = DEFAULT_SHORTCUT_INTEGRATION_START_AT) {
  const safeAccountId = String(accountId || '').trim();
  const type = normalizeShortcutTransactionType(row?.type);
  if (
    safeAccountId
    && (type === 'expense' || type === 'income')
    && String(row?.accountId || '').trim() === safeAccountId
    && isShortcutTransactionCandidate(row, startAt)
  ) {
    return Number(row.accountAmount);
  }
  return Number(row?.amount || 0);
}

export function resolveShortcutTotalEURAmount(row = {}, startAt = DEFAULT_SHORTCUT_INTEGRATION_START_AT) {
  if (!isShortcutTransactionCandidate(row, startAt)) return Number.NaN;
  const totalEUR = Number(row?.convertedAmountEUR ?? row?.totalEUR);
  return Number.isFinite(totalEUR) && totalEUR > 0 ? totalEUR : Number.NaN;
}

export function buildShortcutTransactionDiagnostics({
  transactions = {},
  accountsById = {},
  processed = {},
  financePath = '',
  startAt = DEFAULT_SHORTCUT_INTEGRATION_START_AT,
} = {}) {
  const safeStartAt = normalizeShortcutIntegrationStartAt(startAt);
  const safeFinancePath = String(financePath || '').replace(/\/+$/g, '');
  return Object.entries(transactions || {})
    .map(([transactionId, row]) => {
      const type = normalizeShortcutTransactionType(row?.type);
      const accountId = String(row?.accountId || '').trim();
      const accountAmount = Number(row?.accountAmount);
      const processedMark = processed?.[transactionId] || null;
      const date = String(row?.date || '').trim();
      const createdAt = Number(row?.createdAt || 0);
      const schemaReasons = getShortcutSchemaRejectionReasons(row);
      const internalMarkers = INTERNAL_MOVEMENT_MARKERS.filter((key) => hasOwn(row, key));
      const routes = [
        `${safeFinancePath}/transactions/${transactionId}`,
        `${safeFinancePath}/accounts/${accountId}/entries/* from ${date}`,
        `${safeFinancePath}/accounts/${accountId}/updatedAt`,
        `${safeFinancePath}/aggregates/{day,week,month,year,total}`,
        `${safeFinancePath}/integrations/shortcutProcessed/${transactionId}`,
      ];
      let status = 'ignored';
      let reason = 'not-evaluated';
      if (!Number.isFinite(createdAt) || createdAt < safeStartAt) {
        reason = 'createdAt-before-shortcutIntegrationStartAt';
      } else if (internalMarkers.length) {
        status = 'rejected';
        reason = `internal-movement-marker:${internalMarkers.join(',')}`;
      } else if (schemaReasons.length) {
        status = 'rejected';
        reason = `schema-incompatible:${schemaReasons.join(',')}`;
      } else if (processedMark) {
        status = 'processed';
        reason = 'processed-mark-exists';
      } else if (type === 'transfer') {
        status = 'rejected';
        reason = 'transfer-not-supported';
      } else if (type !== 'expense' && type !== 'income') {
        status = 'rejected';
        reason = 'invalid-type';
      } else if (!accountId || !accountsById?.[accountId]) {
        status = 'rejected';
        reason = 'invalid-account';
      } else if (!Number.isFinite(accountAmount) || accountAmount <= 0) {
        status = 'rejected';
        reason = 'invalid-account-amount';
      } else {
        status = 'pending';
        reason = '';
      }
      return {
        transactionId,
        type,
        accountId,
        accountAmount,
        date,
        createdAt,
        processed: Boolean(processedMark),
        status,
        reason,
        schemaReasons,
        internalMarkers,
        routes,
        processedPath: `${safeFinancePath}/integrations/shortcutProcessed/${transactionId}`,
        row,
      };
    })
    .sort((left, right) => (left.createdAt - right.createdAt) || left.transactionId.localeCompare(right.transactionId));
}
