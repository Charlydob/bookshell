export const RANGE_OPTIONS = [
  { id: 'day', label: 'Día' },
  { id: 'week', label: 'Semana' },
  { id: 'month', label: 'Mes' },
  { id: 'year', label: 'Año' },
  { id: 'total', label: 'Total' }
];

export function renderRangeSelector(range = 'week') {
  return `<div class="rpg-range-selector">${RANGE_OPTIONS.map((opt) => `<button type="button" class="rpg-range-btn ${opt.id === range ? 'active' : ''}" data-range="${opt.id}">${opt.label}</button>`).join('')}</div>`;
}

export function renderList(rows = [], emptyText = 'Sin datos todavía') {
  if (!rows.length) return `<div class="rpg-empty">${emptyText}</div>`;
  return `<ul>${rows.join('')}</ul>`;
}
