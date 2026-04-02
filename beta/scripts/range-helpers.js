export function dateFromKey(key) {
  if (!key || typeof key !== "string") return null;
  const [y, m, d] = key.split("-").map((v) => Number(v));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  return new Date(y, m - 1, d);
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfISOWeek(date) {
  const day = (date.getDay() + 6) % 7;
  const out = startOfDay(date);
  out.setDate(out.getDate() - day);
  return out;
}

export function getRangeBounds(rangeKey, anchorDate = new Date(), minDate = null) {
  const anchor = startOfDay(anchorDate);
  const y = anchor.getFullYear();
  const m = anchor.getMonth();
  if (rangeKey === "day") {
    const start = startOfDay(anchor);
    const endExclusive = new Date(start);
    endExclusive.setDate(endExclusive.getDate() + 1);
    return { start, endExclusive, label: "Día" };
  }
  if (rangeKey === "week") {
    const start = startOfISOWeek(anchor);
    const endExclusive = new Date(start);
    endExclusive.setDate(endExclusive.getDate() + 7);
    return { start, endExclusive, label: "Semana" };
  }
  if (rangeKey === "month") {
    const start = new Date(y, m, 1);
    const endExclusive = new Date(y, m + 1, 1);
    return { start, endExclusive, label: "Mes" };
  }
  if (rangeKey === "year") {
    const start = new Date(y, 0, 1);
    const endExclusive = new Date(y + 1, 0, 1);
    return { start, endExclusive, label: "Año" };
  }
  return {
    start: minDate ? startOfDay(minDate) : null,
    endExclusive: null,
    label: "Total"
  };
}
