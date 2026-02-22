const currencyFormatter = new Intl.NumberFormat('es-ES', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const numberFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const percentFormatter = new Intl.NumberFormat('es-ES', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

export function formatCurrency(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return currencyFormatter.format(Number(value));
}

export function formatSignedCurrency(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatCurrency(n)}`;
}

export function formatPercent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  return `${percentFormatter.format(Number(value))}%`;
}

export function formatSignedPercent(value) {
  if (!Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const sign = n > 0 ? '+' : '';
  return `${sign}${formatPercent(n)}`;
}

export function formatDateEs(key) {
  if (!key) return '—';
  const d = new Date(`${key}T12:00:00`);
  if (Number.isNaN(d.getTime())) return key;
  return d.toLocaleDateString('es-ES');
}
