const DEFAULT_CURRENCY = 'EUR';
export const SUPPORTED_CURRENCIES = Object.freeze([
  'EUR','PEN','BTC','USD','GBP','CHF','JPY','CNY','MXN','COP','ARS','BRL','CLP','CAD','AUD','NOK','SEK','DKK',
]);
const FX_FALLBACK_FROM_EUR = Object.freeze({
  EUR: 1, PEN: 3.98, USD: 1.08, GBP: 0.85, CHF: 0.95, JPY: 165, CNY: 7.8,
  MXN: 19, COP: 4200, ARS: 980, BRL: 5.8, CLP: 1000, CAD: 1.47, AUD: 1.62,
  NOK: 11.7, SEK: 11.4, DKK: 7.46,
});
const APP_DATA_VERSION = 'v2';
function trimSlashes(value = '') { return String(value || '').replace(/^\/+|\/+$/g, ''); }
function joinPath(...parts) { return parts.map(trimSlashes).filter(Boolean).join('/'); }
export function financeRoot(uid = '') { return joinPath(APP_DATA_VERSION, 'users', uid, 'finance', 'finance'); }
export function legacyFinanceRoot(uid = '') { return joinPath(APP_DATA_VERSION, 'users', uid, 'finance'); }
export function normalizeCurrencyCode(currency = DEFAULT_CURRENCY) {
  const code = String(currency || DEFAULT_CURRENCY).trim().toUpperCase();
  return SUPPORTED_CURRENCIES.includes(code) ? code : DEFAULT_CURRENCY;
}
export function normalizeTxType(type = '') {
  const safe = String(type || '').trim().toLowerCase();
  if (safe === 'ingreso' || safe === 'ingresos') return 'income';
  if (safe === 'gasto' || safe === 'gastos' || safe === 'egreso' || safe === 'egresos') return 'expense';
  if (safe === 'transferencia' || safe === 'traspaso') return 'transfer';
  if (['income', 'expense', 'transfer'].includes(safe)) return safe;
  return 'expense';
}
export function dayKeyFromTs(ts = Date.now()) { return new Date(ts).toISOString().slice(0, 10); }
export function toIsoDay(value = '') {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}[T\s].*$/.test(raw)) return raw.slice(0, 10);
  const slash = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (slash) return `${slash[3]}-${String(slash[2]).padStart(2, '0')}-${String(slash[1]).padStart(2, '0')}`;
  const parsedTs = Date.parse(raw);
  return Number.isFinite(parsedTs) ? dayKeyFromTs(parsedTs) : null;
}
export function parseMoney(value = '') {
  if (typeof value === 'number') return value;
  const normalized = String(value || '').trim().replace(/\s/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.').replace(/[^0-9.-]/g, '');
  return Number(normalized);
}
export function accountCurrency(account = {}) { return normalizeCurrencyCode(account.currency || account.baseCurrency || DEFAULT_CURRENCY); }
export function getCurrencyRates() {
  return Object.fromEntries(Object.entries(FX_FALLBACK_FROM_EUR).map(([code, fromEUR]) => [code, code === 'EUR' ? 1 : 1 / Number(fromEUR || 1)]));
}
export function convertCurrency(amount = 0, from = DEFAULT_CURRENCY, to = DEFAULT_CURRENCY) {
  const value = Number(amount || 0);
  const fromCode = normalizeCurrencyCode(from);
  const toCode = normalizeCurrencyCode(to);
  if (fromCode === toCode) return value;
  const rates = getCurrencyRates();
  const fromToEUR = fromCode === 'EUR' ? 1 : Number(rates[fromCode]);
  const toToEUR = toCode === 'EUR' ? 1 : Number(rates[toCode]);
  if (!(fromToEUR > 0) || !(toToEUR > 0)) return Number.NaN;
  return (value * fromToEUR) / toToEUR;
}
export function normalizeMovementCurrencyPayload({ amount = 0, currency = DEFAULT_CURRENCY, exchangeRateToEUR = null } = {}) {
  const originalCurrency = normalizeCurrencyCode(currency);
  const originalAmount = Number(amount || 0);
  const rate = originalCurrency === 'EUR' ? 1 : (Number(exchangeRateToEUR) || Number(getCurrencyRates()[originalCurrency]) || 1);
  const convertedAmountEUR = originalAmount * rate;
  return { amountEUR: convertedAmountEUR, originalAmount, originalCurrency, exchangeRateToEUR: rate, convertedAmountEUR };
}
export function normalizeTxAllocation(raw = {}, fallbackDate = '') {
  const anchorDate = toIsoDay(String(raw?.anchorDate || fallbackDate || '')) || dayKeyFromTs();
  return { mode: 'point', period: 'day', anchorDate };
}
export function buildCategoryCatalogPayload(category = '', timestamps = {}) {
  const id = String(category || '').trim();
  return { id, name: id, label: id, ...timestamps };
}
export function buildShortcutMovementPayload(input = {}, { id, accountsById = {}, now = Date.now() } = {}) {
  const type = normalizeTxType(input.type);
  const amount = parseMoney(input.amount);
  if (!['income', 'expense', 'transfer'].includes(type)) throw new Error('Tipo de movimiento inválido');
  if (!Number.isFinite(amount) || amount <= 0) throw new Error('Importe inválido: introduce una cantidad mayor que 0');
  const movementCurrency = normalizeCurrencyCode(input.currency || DEFAULT_CURRENCY);
  const dateISO = toIsoDay(String(input.date || input.dateISO || '')) || dayKeyFromTs(now);
  const accountId = String(input.accountId || '').trim();
  const fromAccountId = String(input.fromAccountId || '').trim();
  const toAccountId = String(input.toAccountId || '').trim();
  if ((type === 'income' || type === 'expense') && !accountId) throw new Error('Selecciona una cuenta');
  if (type === 'transfer' && (!fromAccountId || !toAccountId || fromAccountId === toAccountId)) throw new Error('Transferencia inválida: elige dos cuentas distintas');
  const targetAccount = type === 'transfer' ? null : accountsById[accountId];
  if ((type === 'income' || type === 'expense') && !targetAccount) throw new Error('Cuenta no encontrada');
  if (type === 'transfer' && (!accountsById[fromAccountId] || !accountsById[toAccountId])) throw new Error('Cuenta de transferencia no encontrada');
  const movementAccountCurrency = targetAccount ? accountCurrency(targetAccount) : movementCurrency;
  const currencyPayload = normalizeMovementCurrencyPayload({ amount, currency: movementCurrency, exchangeRateToEUR: input.exchangeRateToEUR });
  const accountAmount = targetAccount ? convertCurrency(amount, movementCurrency, movementAccountCurrency) : Number(currencyPayload.amountEUR || amount);
  if (!Number.isFinite(accountAmount)) throw new Error('No hay tasa para convertir a la moneda de la cuenta');
  const category = type === 'transfer' ? '' : String(input.category || input.categoryId || '').trim();
  if (type !== 'transfer' && !category) throw new Error('Selecciona una categoría');
  return {
    id, type, amount: Number(accountAmount || 0), originalAmount: Number(currencyPayload.originalAmount || amount),
    originalCurrency: movementCurrency, inputCurrency: movementCurrency, accountCurrency: movementAccountCurrency,
    accountAmount: Number(accountAmount || 0), exchangeRateToEUR: Number(currencyPayload.exchangeRateToEUR || 1),
    convertedAmountEUR: Number(currencyPayload.convertedAmountEUR || currencyPayload.amountEUR || amount),
    totalEUR: Number(currencyPayload.convertedAmountEUR || currencyPayload.amountEUR || amount), currency: movementAccountCurrency,
    date: dateISO, dateISO: `${dateISO}T00:00:00`, monthKey: dateISO.slice(0, 7),
    accountId: type === 'transfer' ? '' : accountId, fromAccountId: type === 'transfer' ? fromAccountId : '', toAccountId: type === 'transfer' ? toAccountId : '',
    category, categoryId: String(input.categoryId || category || '').trim(), title: String(input.title || '').trim(), note: String(input.note || '').trim(),
    linkedHabitId: null, allocation: normalizeTxAllocation({ mode: 'point', period: 'day', anchorDate: dateISO }, dateISO),
    extras: null, source: 'apple-shortcuts', status: 'synced', pending: false, draft: false, disabled: false, excluded: false,
    deleted: false, confirmed: true, updatedAt: now, createdAt: now,
  };
}
