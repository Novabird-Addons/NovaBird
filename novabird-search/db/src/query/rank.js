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

// ---- „Beste Treffer zuerst, danach nach Datum“ -------------------------------------------------------------------------
// Oben stehen höchstens BEST_MAX Treffer, die deutlich passen; alle übrigen folgen nach Datum (neueste zuerst). Gemeinsam
// für Desktop und Android (dort dieselben Funktionen).
export const BEST_MAX = 10;
export const BEST_RATIO = 0.5; // Worttreffer: bm25 mindestens halb so gut wie der beste
export const BEST_SEM_FLOOR = 0.5; // Bedeutungstreffer (Kosinus) ohne Worttreffer: erst ab diesem Wert „beste“
export const BEST_SPLIT_FROM = 6; // weniger Treffer insgesamt: keine Trennung, alle nach Relevanz

const idOf = (r) => r.header_msg_id;
const keyOf = (r, now) => (typeof r.score === "number" ? r.score * recencyWeight(r.date, now) : null);

/**
 * Worttreffer nach Relevanz (Ergebnis von rerank, mit score) → die besten (höchstens max, mindestens ratio so gut wie
 * der erste). Ohne score (FTS4, nur Filter ohne Suchwort): keine.
 */
export function splitBest(relRows, { max = BEST_MAX, ratio = BEST_RATIO, now = Date.now() } = {}) {
  const scored = relRows.filter((r) => keyOf(r, now) != null);
  if (!scored.length) return [];
  const top = keyOf(scored[0], now); // negativ: kleiner = besser
  return scored.filter((r) => keyOf(r, now) <= top * ratio).slice(0, max);
}

/**
 * Wort- und Bedeutungstreffer zusammen (Reciprocal Rank Fusion, k = 60) → die besten. Worttreffer zählen nur, wenn sie
 * nach splitBest stark sind; reine Bedeutungstreffer erst ab semFloor (sonst rutschen bei wenigen Worttreffern lauter
 * schwache Ähnliche nach oben).
 */
export function fuseBest(relRows, semRows, { max = BEST_MAX, ratio = BEST_RATIO, semFloor = BEST_SEM_FLOOR, now = Date.now() } = {}) {
  const lex = splitBest(relRows, { max: Infinity, ratio, now });
  const lexIds = new Set(relRows.map(idOf));
  const sem = (semRows ?? []).filter((r) => lexIds.has(idOf(r)) || (typeof r.score === "number" && r.score >= semFloor));
  const score = new Map();
  const row = new Map();
  for (const list of [lex, sem]) {
    list.forEach((r, i) => {
      score.set(idOf(r), (score.get(idOf(r)) || 0) + 1 / (60 + i + 1));
      if (!row.has(idOf(r))) row.set(idOf(r), r);
    });
  }
  // nur ein Bedeutungstreffer, der auch ein (schwacher) Worttreffer ist, reicht nicht: stark muss eine Seite sein
  const strong = new Set([...lex.map(idOf), ...sem.filter((r) => typeof r.score === "number" && r.score >= semFloor).map(idOf)]);
  return [...row.values()].filter((r) => strong.has(idOf(r))).sort((a, b) => score.get(idOf(b)) - score.get(idOf(a))).slice(0, max);
}

/**
 * Anzeige-Reihenfolge: best zuerst (in ihrer Reihenfolge), dann alle anderen aus all nach Datum. Bei sehr wenigen Treffern
 * (unter splitFrom) alles nach Relevanz ohne Trennung. Liefert { rows, bestIds } (bestIds leer = keine Trennung).
 */
export function bestThenDate(best, all, { splitFrom = BEST_SPLIT_FROM } = {}) {
  const ids = new Set(best.map(idOf));
  const rest = all.filter((r) => !ids.has(idOf(r))).sort((a, b) => b.date - a.date);
  if (!best.length || !rest.length) return { rows: [...best, ...rest], bestIds: [] };
  if (best.length + rest.length < splitFrom) return { rows: [...best, ...rest], bestIds: [] };
  return { rows: [...best, ...rest], bestIds: best.map(idOf) };
}
