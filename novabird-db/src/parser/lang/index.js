// Registry der Sprachpakete. Neue Sprache: lang/<code>.js anlegen, hier eintragen, Tests in tests/parser.lang.test.js.
import de from "./de.js";
import en from "./en.js";
import fr from "./fr.js";
import es from "./es.js";

export const PACKS = { de, en, fr, es };
export const LANGUAGES = Object.keys(PACKS);

/** Pakete für Sprachcodes (unbekannte werden übersprungen; leer -> Deutsch wie bisher). */
export function resolvePacks(codes) {
  const out = [];
  for (const c of codes) {
    const p = PACKS[String(c).toLowerCase().slice(0, 2)];
    if (p && !out.includes(p)) out.push(p);
  }
  return out.length ? out : [de];
}
