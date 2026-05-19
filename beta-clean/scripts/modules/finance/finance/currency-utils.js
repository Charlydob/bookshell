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

const RATE_KEY = 'financeFxRates';
const RATE_CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const BASE_RATES = Object.freeze({
  EUR: 1, PEN: 0.247, USD: 0.92, GBP: 1.17, CHF: 1.03, JPY: 0.0059, CNY: 0.127,
  MXN: 0.051, COP: 0.00022, ARS: 0.001, BRL: 0.17, CLP: 0.001, CAD: 0.67, AUD: 0.61,
  NOK: 0.086, SEK: 0.087, DKK: 0.134,
});


const FX_FALLBACK_FROM_EUR = Object.freeze({
  EUR: 1, PEN: 4.0, USD: 1.08, GBP: 0.85, CHF: 0.95, JPY: 165, CNY: 7.8,
  MXN: 19, COP: 4200, ARS: 980, BRL: 5.8, CLP: 1000, CAD: 1.47, AUD: 1.62,
  NOK: 11.7, SEK: 11.4, DKK: 7.46,
});

function readRateCache() {
  try { return JSON.parse(localStorage.getItem(RATE_KEY) || '{}') || {}; } catch { return {}; }
}

function writeRateCache(next = {}) {
  try { localStorage.setItem(RATE_KEY, JSON.stringify(next || {})); } catch {}
}

export async function resolveExchangeRateFromEUR(currency = DEFAULT_CURRENCY) {
  const code = String(currency || DEFAULT_CURRENCY).toUpperCase();
  if (code === 'EUR') {
    return { fromEUR: 1, toEUR: 1, updatedAt: new Date().toISOString(), source: 'base:eur', approximate: false };
  }
  const cache = readRateCache();
  const cached = cache[code];
  const now = Date.now();
  if (cached && Number(cached.fromEUR) > 0 && (now - Number(cached.ts || 0)) < RATE_CACHE_TTL_MS) {
    console.info('[finance:fx] cache-hit', { currency: code, fromEUR: Number(cached.fromEUR) });
    return {
      fromEUR: Number(cached.fromEUR),
      toEUR: 1 / Number(cached.fromEUR),
      updatedAt: String(cached.updatedAt || new Date(Number(cached.ts || now)).toISOString()),
      source: String(cached.source || 'cache'),
      approximate: !!cached.approximate,
    };
  }
  console.info('[finance:fx] request', { currency: code });
  const endpoints = [
    `https://api.frankfurter.app/latest?from=EUR&to=${encodeURIComponent(code)}`,
    `https://open.er-api.com/v6/latest/EUR`,
  ];
  for (const endpoint of endpoints) {
    try {
      const response = await fetch(endpoint, { method: 'GET' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = await response.json();
      const rates = payload?.rates || {};
      const fromEUR = Number(rates[code]);
      if (fromEUR > 0) {
        const source = endpoint.includes('er-api') ? 'open.er-api.com' : 'frankfurter.app';
        const updatedAt = String(payload?.time_last_update_utc || payload?.date || new Date().toISOString());
        const normalized = {
          fromEUR,
          ts: now,
          source,
          updatedAt,
          approximate: false,
        };
        writeRateCache({ ...cache, [code]: normalized });
        console.info('[finance:fx] response', { currency: code, fromEUR, source });
        return { fromEUR, toEUR: 1 / fromEUR, updatedAt, source, approximate: false };
      }
    } catch (error) {
      console.info('[finance:fx] response', { currency: code, endpoint, error: String(error?.message || error) });
    }
  }
  const fallbackFromEUR = Number(FX_FALLBACK_FROM_EUR[code] || BASE_RATES[code]);
  if (!(fallbackFromEUR > 0)) throw new Error(`fx-rate-unavailable:${code}`);
  console.info('[finance:fx] fallback-used', { currency: code, fromEUR: fallbackFromEUR });
  return {
    fromEUR: fallbackFromEUR,
    toEUR: 1 / fallbackFromEUR,
    updatedAt: new Date().toISOString(),
    source: 'fallback-local',
    approximate: true,
  };
}

export function getDefaultCurrency() { return DEFAULT_CURRENCY; }

export function getCurrencyRates() {
  const parsed = readRateCache();
  const fallbackToEUR = Object.fromEntries(Object.entries(FX_FALLBACK_FROM_EUR).map(([k, value]) => [k, k === 'EUR' ? 1 : (1 / Number(value || 1))]));
  const mapped = Object.fromEntries(Object.entries(parsed || {}).map(([k, row]) => [k, 1 / Math.max(0.0000001, Number(row?.fromEUR || row || 1))]));
  return { ...fallbackToEUR, ...BASE_RATES, ...mapped, EUR: 1 };
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
