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
  for (const [suffix, repl] of rules) {
    if (w.endsWith(suffix)) {
      const s = w.slice(0, -suffix.length) + repl;
      if (s.length >= MIN_STEM) return s;
      return w;
    }
  }
  return w;
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
