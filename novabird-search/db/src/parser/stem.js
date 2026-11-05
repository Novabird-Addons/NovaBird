// Leichtes Stemming für die Präfixsuche (je Sprachpaket, `stemRules`).
// Ziel ist nicht linguistische Korrektheit: Der Stamm wird als Präfix gesucht
// ("speiseplan*"), daher schadet zu starkes Kürzen nur der Präzision, nicht
// der Trefferquote. Umlaute/Akzente bleiben erhalten (FTS entfernt Diakritika selbst).

const DE_RULES = [
  ["ungen", "ung"],
  ["heiten", "heit"],
  ["keiten", "keit"],
  ["innen", "in"],
  ["en", ""],
  ["e", ""],
  ["s", ""],
];

const MIN_STEM = 4;

export function stemWithRules(word, rules) {
  const w = String(word).toLowerCase();
  if (w.length <= MIN_STEM || /\d/.test(w)) return w;
  // erste passende Endung, deren Rest lang genug bleibt („notes“: nicht „not“, sondern „note“)
  for (const [suffix, repl] of rules) {
    if (w.endsWith(suffix)) {
      const s = w.slice(0, -suffix.length) + repl;
      if (s.length >= MIN_STEM) return s;
    }
  }
  return w;
}

/**
 * Stämme eines Worts in mehreren Sprachen: nur die kürzesten (ein Stamm, der mit einem anderen beginnt, ist schon
 * abgedeckt, weil als Präfix gesucht wird). Die Hauptsprache steht vorn.
 */
export function stemsWith(packs) {
  const stemmers = packs.map(stemWith);
  return (word) => {
    const all = [...new Set(stemmers.map((f) => f(word)))];
    return all.filter((s) => !all.some((o) => o !== s && s.startsWith(o)));
  };
}

/** Stemmer eines Sprachpakets. */
export function stemWith(pack) {
  const rules = pack.stemRules ?? DE_RULES;
  return (word) => stemWithRules(word, rules);
}

/** Deutsch (Standard, für Vorschläge und Tests). */
export function stem(word) {
  return stemWithRules(word, DE_RULES);
}
