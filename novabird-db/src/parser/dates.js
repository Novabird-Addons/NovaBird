// Datumshilfen in lokaler Zeit. Zeiträume sind halboffen: [from, to).

export const DAY_MS = 86_400_000;

export function startOfDay(d) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

/** Monate addieren, Tag am Monatsende kappen (31.03. − 1 Monat = 28./29.02.). */
export function addMonths(d, n) {
  const x = new Date(d);
  const day = x.getDate();
  x.setDate(1);
  x.setMonth(x.getMonth() + n);
  const last = new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
  x.setDate(Math.min(day, last));
  return x;
}

export function startOfWeek(d) {
  const x = startOfDay(d);
  const dow = (x.getDay() + 6) % 7; // Montag = 0
  return addDays(x, -dow);
}

export function startOfMonth(d) {
  const x = startOfDay(d);
  x.setDate(1);
  return x;
}

export function startOfYear(d) {
  return new Date(new Date(d).getFullYear(), 0, 1);
}

/** Montag der ISO-Kalenderwoche. */
export function isoWeekStart(year, week) {
  const jan4 = new Date(year, 0, 4);
  return addDays(startOfWeek(jan4), (week - 1) * 7);
}

export function isoWeekOf(d) {
  const x = startOfDay(d);
  const thursday = addDays(x, 3 - ((x.getDay() + 6) % 7));
  const year = thursday.getFullYear();
  const week = Math.round((thursday - isoWeekStart(year, 1)) / (7 * DAY_MS)) + 1;
  return { year, week };
}

/** Einheit + Anzahl rückwärts vom Tagesbeginn (rollierender Zeitraum). */
export function subtractUnits(today, unit, n) {
  switch (unit) {
    case "day":
      return addDays(today, -n);
    case "week":
      return addDays(today, -7 * n);
    case "month":
      return addMonths(today, -n);
    case "quarter":
      return addMonths(today, -3 * n);
    case "year":
      return addMonths(today, -12 * n);
    default:
      throw new Error(`Unbekannte Einheit ${unit}`);
  }
}

/** Kalenderperiode, die `d` enthält. */
export function periodOf(d, unit) {
  switch (unit) {
    case "day": {
      const f = startOfDay(d);
      return [f, addDays(f, 1)];
    }
    case "week": {
      const f = startOfWeek(d);
      return [f, addDays(f, 7)];
    }
    case "month": {
      const f = startOfMonth(d);
      return [f, addMonths(f, 1)];
    }
    case "quarter": {
      const f = startOfMonth(d);
      f.setMonth(Math.floor(f.getMonth() / 3) * 3);
      return [f, addMonths(f, 3)];
    }
    case "year": {
      const f = startOfYear(d);
      return [f, new Date(f.getFullYear() + 1, 0, 1)];
    }
    default:
      throw new Error(`Unbekannte Einheit ${unit}`);
  }
}

export function formatDate(ms) {
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** Für Tests: lokales Datum als YYYY-MM-DD. */
export function isoDate(ms) {
  if (ms == null) return null;
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
