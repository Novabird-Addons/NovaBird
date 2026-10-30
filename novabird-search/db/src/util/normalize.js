// Normalisierung für Vergleiche (Namen, Trigramm-Index).
// Muss im Indexer und in der Suche identisch verwendet werden.

/** Version der Textnormalisierung; ändert sie sich, wird der Index einmal neu aufgebaut (siehe background.js). */
export const TEXT_NORM_VERSION = 2;

/**
 * Deutsche Faltung wie Lucene/Elasticsearch (GermanNormalizationFilter): Kleinschreibung, ß→ss,
 * ä/ö/ü→a/o/u, ae/oe→a/o, ue→u (nicht nach a/e/q: „neue“, „Quelle“ bleiben), sonstige Diakritika entfernen.
 * So finden „Grüße“, „Grueße“, „Gruesse“, „Grusse“ einander. Wird beim Indexieren UND in der Suche benutzt.
 */
export function foldDe(s) {
  if (s == null) return "";
  return String(s)
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([ao])e/g, "$1")
    .replace(/(?<![aeq])ue/g, "u");
}

/** Wie foldDe, zusätzlich Leerraum vereinheitlicht (für Vergleiche, Namen, Trigramm-Index). */
export function norm(s) {
  return foldDe(s).replace(/\s+/g, " ").trim();
}

/** Nur Buchstaben/Ziffern behalten (für FTS-Terme). */
export function sanitizeTerm(s) {
  return String(s ?? "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Liste als ",a,b," speichern, damit LIKE '%,a,%' exakt matcht. */
export function toListField(values) {
  const list = (values ?? []).map((v) => norm(v)).filter(Boolean);
  return list.length ? "," + list.join(",") + "," : "";
}

/** LIKE-Sonderzeichen escapen (zusammen mit ESCAPE '\\' verwenden). */
export function escapeLike(s) {
  return String(s).replace(/[\\%_]/g, (c) => "\\" + c);
}
