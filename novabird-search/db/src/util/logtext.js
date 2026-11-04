// Sprache des Ereignisprotokolls (Einstellungen → Suche → Index): Deutsch nur bei deutscher Oberfläche, sonst Englisch,
// damit Nutzer anderer Sprachen das Protokoll in Fehlerberichte kopieren können. Ohne Angabe (Tests) Deutsch.
let german = true;

export function setLogLanguage(lang) {
  german = /^de\b/i.test(String(lang ?? "de"));
}

/** Text in der Sprache des Protokolls. */
export const L = (de, en) => (german ? de : en);
