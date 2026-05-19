export const DEFAULT_CURRENCY = 'EUR';
export const SUPPORTED_CURRENCIES = Object.freeze([
  { code: 'EUR', symbol: '€', label: 'EUR €' },
  { code: 'PEN', symbol: 'S/', label: 'PEN S/' },
  { code: 'USD', symbol: '$', label: 'USD $' },
]);

const RATE_KEY = 'bookshell_finance_currency_rates_v1';
const BASE_RATES = Object.freeze({ EUR: 1, PEN: 0.25, USD: 0.92 });

export function getDefaultCurrency() { return DEFAULT_CURRENCY; }

export function getCurrencyRates() {
  let parsed = {};
  try { parsed = JSON.parse(localStorage.getItem(RATE_KEY) || '{}') || {}; } catch { parsed = {}; }
  return { ...BASE_RATES, ...parsed, EUR: 1 };
}

export function formatCurrency(amount = 0, currency = DEFAULT_CURRENCY) {
  const safe = Number.isFinite(Number(amount)) ? Number(amount) : 0;
  const code = String(currency || DEFAULT_CURRENCY).toUpperCase();
  return new Intl.NumberFormat('es-ES', { style: 'currency', currency: code, maximumFractionDigits: 2 }).format(safe);
}

export function convertToEUR(amount = 0, currency = DEFAULT_CURRENCY, rate = null) {
  const value = Number(amount || 0);
  const code = String(currency || DEFAULT_CURRENCY).toUpperCase();
  if (!Number.isFinite(value)) return 0;
  if (code === 'EUR') return value;
  const rates = getCurrencyRates();
  const effectiveRate = Number(rate) || Number(rates[code]) || 1;
  return value * effectiveRate;
}

export function normalizeMovementCurrencyPayload({ amount = 0, currency = DEFAULT_CURRENCY, exchangeRateToEUR = null } = {}) {
  const originalCurrency = String(currency || DEFAULT_CURRENCY).toUpperCase();
  const originalAmount = Number(amount || 0);
  const rates = getCurrencyRates();
  const rate = originalCurrency === 'EUR' ? 1 : (Number(exchangeRateToEUR) || Number(rates[originalCurrency]) || 1);
  const convertedAmountEUR = convertToEUR(originalAmount, originalCurrency, rate);
  return {
    amountEUR: convertedAmountEUR,
    originalAmount,
    originalCurrency,
    exchangeRateToEUR: rate,
    convertedAmountEUR,
  };
}
