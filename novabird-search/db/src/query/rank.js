// Relevanz mit Abwertung älterer Mails (Alter als Gewicht, wie „decay“ in Elasticsearch; Studien: Carmel u. a.,
// „Rank by Time or by Relevance? Revisiting Email Search“, CIKM 2015 – Mischung aus Relevanz und Alter schlägt beides allein).
//   Gewicht = Boden + (1 − Boden) · 0,5^(AlterInTagen / Halbwertszeit)
// Neue Mails zählen voll, alte nie weniger als der Boden: ein sehr guter alter Treffer bleibt sichtbar, muss aber deutlich
// besser passen. Stufen in den Einstellungen (Suche → Neuere Mails bevorzugen). Keine Abwertung, wenn die Anfrage selbst
// einen Zeitraum hat (bis 2012, vor 10 Jahren, Zeitfenster der Leiste) oder „vor langer Zeit“/„damals“ sagt (timeHint).
// Wortsuche: bm25 (negativ, kleiner = besser) · Gewicht. Bedeutungssuche: Kosinus (größer = besser) · Gewicht.
// Mails ohne bm25-Wert (Treffer nur über Trigramm/LIKE im Betreff) kommen nach denen mit Wert, untereinander nach Datum.

export const AGE_LEVELS = {
  off: null,
  normal: { floor: 0.4, halfLifeDays: 548 }, // 1½ Jahre: nach 3 Jahren ~0,55, nach 15 Jahren 0,4
  strong: { floor: 0.2, halfLifeDays: 365 }, // nach 3 Jahren ~0,3, nach 15 Jahren 0,2
};
export const AGE_DEFAULT = "normal";
const DAY_MS = 86_400_000;

/** Stufe und ob die Anfrage selbst einen Zeitbezug hat (dann keine Abwertung). query: geparste Anfrage samt Filtern. */
export function ageOptions(query, level = AGE_DEFAULT) {
  const lv = Object.hasOwn(AGE_LEVELS, level) ? level : AGE_DEFAULT;
  const neutral = Boolean(query && (query.dateFrom != null || query.dateTo != null || query.timeHint === "past"));
  return { level: lv, neutral };
}

/** Gewicht 0..1 einer Mail nach Alter (1 = keine Abwertung). age: Ergebnis von ageOptions (ohne: Standardstufe). */
export function ageWeight(dateMs, now = Date.now(), age = {}) {
  const cfg = age.neutral ? null : AGE_LEVELS[age.level ?? AGE_DEFAULT];
  if (!cfg || !Number.isFinite(Number(dateMs))) return 1;
  const days = Math.max(0, (now - Number(dateMs)) / DAY_MS);
  return cfg.floor + (1 - cfg.floor) * Math.pow(0.5, days / cfg.halfLifeDays);
}

/** Früherer Name (Android-Kern): Gewicht nach Alter. */
export const recencyWeight = ageWeight;

/** Sortiert Zeilen mit `score` und `date` nach Relevanz (beste zuerst). Gibt neue Liste zurück. */
export function rerank(rows, now = Date.now(), age = {}) {
  const keyOf = (r) => (typeof r.score === "number" ? r.score * ageWeight(r.date, now, age) : Infinity);
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
const keyOf = (r, now, age) => (typeof r.score === "number" ? r.score * ageWeight(r.date, now, age) : null);

// Kosinus unpassender Mails liegt nicht bei 0, sondern um 0,3 (Suchschwellen 0,28–0,40, semantic/main.js): abgewertet wird
// nur der Teil darüber, sonst sänke jede alte Mail unter das Grundrauschen.
export const SEM_NOISE = 0.3;

/** Kosinus nach Alter: Grundrauschen + (Kosinus − Grundrauschen) · Gewicht. Ohne Wert: null. */
export function semAgeScore(r, now = Date.now(), age = {}) {
  if (typeof r.score !== "number") return null;
  return SEM_NOISE + (r.score - SEM_NOISE) * ageWeight(r.date, now, age);
}

/** Bedeutungstreffer (score = Kosinus) nach Ähnlichkeit mit Altersgewicht, beste zuerst. Gibt neue Liste zurück. */
export function sortSemByAge(semRows, { now = Date.now(), age = {} } = {}) {
  const k = (r) => semAgeScore(r, now, age) ?? -Infinity;
  return (semRows ?? []).map((r, i) => ({ r, k: k(r), i })).sort((a, b) => b.k - a.k || a.i - b.i).map((x) => x.r);
}

/**
 * Worttreffer nach Relevanz (Ergebnis von rerank, mit score) → die besten (höchstens max, mindestens ratio so gut wie
 * der erste). Ohne score (FTS4, nur Filter ohne Suchwort): keine.
 */
export function splitBest(relRows, { max = BEST_MAX, ratio = BEST_RATIO, now = Date.now(), age = {} } = {}) {
  const scored = relRows.filter((r) => keyOf(r, now, age) != null);
  if (!scored.length) return [];
  const top = Math.min(...scored.map((r) => keyOf(r, now, age))); // negativ: kleiner = besser
  return scored.filter((r) => keyOf(r, now, age) <= top * ratio).slice(0, max);
}

/**
 * Wort- und Bedeutungstreffer zusammen (Reciprocal Rank Fusion, k = 60) → die besten. Worttreffer zählen nur, wenn sie
 * nach splitBest stark sind; reine Bedeutungstreffer erst ab semFloor, gemessen mit Altersgewicht (wie bei den Worttreffern
 * entscheidet das Alter mit, ob eine Mail überhaupt oben steht – Carmel u. a., „Promoting Relevant Results in Time-Ranked
 * Mail Search“, WWW 2017; sonst rutschen bei wenigen Worttreffern lauter
 * schwache Ähnliche nach oben).
 */
export function fuseBest(relRows, semRows, { max = BEST_MAX, ratio = BEST_RATIO, semFloor = BEST_SEM_FLOOR, now = Date.now(), age = {} } = {}) {
  const lex = splitBest(relRows, { max: Infinity, ratio, now, age });
  const lexIds = new Set(relRows.map(idOf));
  const semOk = (r) => (semAgeScore(r, now, age) ?? -Infinity) >= semFloor; // Schwelle mit Altersgewicht
  const sem = sortSemByAge(semRows, { now, age }).filter((r) => lexIds.has(idOf(r)) || semOk(r));
  const score = new Map();
  const row = new Map();
  for (const list of [lex, sem]) {
    list.forEach((r, i) => {
      score.set(idOf(r), (score.get(idOf(r)) || 0) + 1 / (60 + i + 1));
      if (!row.has(idOf(r))) row.set(idOf(r), r);
    });
  }
  // nur ein Bedeutungstreffer, der auch ein (schwacher) Worttreffer ist, reicht nicht: stark muss eine Seite sein
  const strong = new Set([...lex.map(idOf), ...sem.filter(semOk).map(idOf)]);
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
