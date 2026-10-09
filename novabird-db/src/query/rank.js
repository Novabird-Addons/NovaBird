// Relevanz: bm25 (negativ, kleiner = besser) mit Bonus für neuere Mails.
// score' = score * (1 + BONUS * 0.5^(AlterInTagen / HALBWERTSZEIT_TAGE))
// Mails ohne bm25-Wert (Treffer nur über Trigramm/LIKE im Betreff) kommen nach denen mit Wert, untereinander nach Datum.

export const RECENCY_BONUS = 0.5;
export const HALF_LIFE_DAYS = 365;
const DAY_MS = 86_400_000;

export function recencyWeight(dateMs, now = Date.now()) {
  const age = Math.max(0, (now - Number(dateMs)) / DAY_MS);
  return 1 + RECENCY_BONUS * Math.pow(0.5, age / HALF_LIFE_DAYS);
}

/** Sortiert Zeilen mit `score` und `date` nach Relevanz (beste zuerst). Gibt neue Liste zurück. */
export function rerank(rows, now = Date.now()) {
  const keyOf = (r) => (typeof r.score === "number" ? r.score * recencyWeight(r.date, now) : Infinity);
  return rows
    .map((r, i) => ({ r, k: keyOf(r), i }))
    .sort((a, b) => (a.k === b.k ? b.r.date - a.r.date || a.i - b.i : a.k < b.k ? -1 : 1))
    .map((x) => x.r);
}
