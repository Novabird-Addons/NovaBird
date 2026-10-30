// Zerlegung deutscher Zusammensetzungen beim Indexieren („terms_de“, optionaler Modus „Beim Indexieren“).
// Ohne Wörterbuch: Ein Wort wird geteilt, wenn beide Teile (Vorsatz mit Fugenelement) in der Wortliste vorkommen,
// die aus den eigenen Mails stammt (Saatliste in der Tabelle terms_seed). Beispiel: „wochenspeiseplan“ → woche, dienst, plan, speiseplan.

import { foldDe } from "../util/normalize.js";

const FUGEN = ["", "s", "n", "en", "e", "es", "er"];
export const MIN_WORD = 8; // kürzere Wörter werden nicht zerlegt
export const MIN_PART = 3;

/** Zerlegt ein (gefaltetes) Wort; liefert Set der Teile oder null. */
export function decompose(word, vocab, depth = 0) {
  if (word.length < MIN_WORD || depth > 2) return null;
  const parts = new Set();
  for (let i = MIN_PART; i <= word.length - MIN_PART; i++) {
    const a = word.slice(0, i);
    const b = word.slice(i);
    const aOk = FUGEN.some((f) => (f === "" ? vocab.has(a) : a.endsWith(f) && a.length - f.length >= MIN_PART && vocab.has(a.slice(0, -f.length))));
    if (!aOk) continue;
    const sub = vocab.has(b) ? null : decompose(b, vocab, depth + 1);
    if (!vocab.has(b) && !sub) continue;
    for (const f of FUGEN) {
      const base = f === "" ? a : a.endsWith(f) ? a.slice(0, -f.length) : null;
      if (base && vocab.has(base)) {
        parts.add(base);
        break;
      }
    }
    parts.add(b);
    if (sub) sub.forEach((x) => parts.add(x));
  }
  return parts.size ? parts : null;
}

/** Zusätzliche Terme für den Volltextindex: Teile aller zerlegbaren Wörter von Betreff und Text. */
export function termsDeFor(record, vocab) {
  if (!vocab?.size) return "";
  const text = foldDe(`${record.subject ?? ""} ${record.body ?? ""}`);
  const out = new Set();
  for (const w of new Set(text.match(/[\p{L}\p{N}]+/gu) ?? [])) {
    const p = decompose(w, vocab);
    if (p) p.forEach((x) => out.add(x));
  }
  return [...out].join(" ");
}
