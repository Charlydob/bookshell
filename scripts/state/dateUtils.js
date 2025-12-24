/**
 * Devuelve una clave YYYY-MM-DD con zona horaria local.
 * @param {Date} date
 * @returns {string}
 */
export function dateKeyLocal(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** @returns {string} Clave YYYY-MM-DD del día actual. */
export function todayKey() {
  return dateKeyLocal(new Date());
}

/**
 * Convierte un timestamp en clave de fecha local.
 * @param {number|null|undefined} ts
 * @returns {string|null}
 */
export function dateKeyFromTimestamp(ts) {
  if (!ts) return null;
  try {
    return dateKeyLocal(new Date(ts));
  } catch (_) {
    return null;
  }
}

/**
 * Etiqueta de mes localizada.
 * @param {number} year
 * @param {number} month
 * @returns {string}
 */
export function formatMonthLabel(year, month) {
  const names = [
    "enero","febrero","marzo","abril","mayo","junio",
    "julio","agosto","septiembre","octubre","noviembre","diciembre"
  ];
  return `${names[month]} ${year}`;
}

/**
 * Número de días de un mes.
 * @param {number} year
 * @param {number} month
 */
export function getDaysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Devuelve el rango lunes-domingo que contiene la fecha dada.
 * @param {Date} anchorDate
 */
export function getWeekBoundsKey(anchorDate = new Date()) {
  const d = new Date(anchorDate);
  const day = (d.getDay() + 6) % 7; // lunes=0
  const monday = new Date(d);
  monday.setDate(d.getDate() - day);
  monday.setHours(0, 0, 0, 0);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);
  return {
    from: dateKeyLocal(monday),
    to: dateKeyLocal(sunday)
  };
}
