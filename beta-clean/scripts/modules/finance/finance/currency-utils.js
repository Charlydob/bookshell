export const DEFAULT_CURRENCY = 'EUR';
export const SUPPORTED_CURRENCIES = Object.freeze([
  { code: 'EUR', symbol: '€', label: 'EUR € Euro' },
  { code: 'PEN', symbol: 'S/', label: 'PEN S/ Sol peruano' },
  { code: 'USD', symbol: '$', label: 'USD $ Dólar estadounidense' },
  { code: 'GBP', symbol: '£', label: 'GBP £ Libra esterlina' },
  { code: 'CHF', symbol: 'CHF', label: 'CHF CHF Franco suizo' },
  { code: 'JPY', symbol: '¥', label: 'JPY ¥ Yen japonés' },
  { code: 'CNY', symbol: '¥', label: 'CNY ¥ Yuan chino' },
  { code: 'MXN', symbol: '$', label: 'MXN $ Peso mexicano' },
  { code: 'COP', symbol: '$', label: 'COP $ Peso colombiano' },
  { code: 'ARS', symbol: '$', label: 'ARS $ Peso argentino' },
  { code: 'BRL', symbol: 'R$', label: 'BRL R$ Real brasileño' },
  { code: 'CLP', symbol: '$', label: 'CLP $ Peso chileno' },
  { code: 'CAD', symbol: '$', label: 'CAD $ Dólar canadiense' },
  { code: 'AUD', symbol: '$', label: 'AUD $ Dólar australiano' },
  { code: 'NOK', symbol: 'kr', label: 'NOK kr Corona noruega' },
  { code: 'SEK', symbol: 'kr', label: 'SEK kr Corona sueca' },
  { code: 'DKK', symbol: 'kr', label: 'DKK kr Corona danesa' },
]);

const RATE_KEY = 'bookshell_finance_currency_rates_v1';
const BASE_RATES = Object.freeze({
  EUR: 1, PEN: 0.247, USD: 0.92, GBP: 1.17, CHF: 1.03, JPY: 0.0059, CNY: 0.127,
  MXN: 0.051, COP: 0.00022, ARS: 0.001, BRL: 0.17, CLP: 0.001, CAD: 0.67, AUD: 0.61,
  NOK: 0.086, SEK: 0.087, DKK: 0.134,
});

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
