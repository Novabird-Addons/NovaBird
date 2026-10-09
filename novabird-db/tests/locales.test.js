// Prüft alle vier Sprachdateien (de, en, fr, es): gleiche Schlüssel, nicht leer, gleiche Platzhalter wie Englisch.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const load = (lang) => JSON.parse(readFileSync(new URL(`../_locales/${lang}/messages.json`, import.meta.url), "utf8"));
const all = { de: load("de"), en: load("en"), fr: load("fr"), es: load("es") };
const tokens = (text) => [...text.matchAll(/\$\d|\$[A-Z]+\$|\{\w+\}/g)].map((m) => m[0]).sort();

describe("Sprachdateien", () => {
  it("vier Sprachen: dieselben Schlüssel, keine leeren Texte", () => {
    for (const lang of ["de", "fr", "es"]) expect(Object.keys(all[lang]).sort()).toEqual(Object.keys(all.en).sort());
    for (const messages of Object.values(all)) for (const entry of Object.values(messages)) expect(entry.message.trim()).not.toBe("");
  });
  it("dieselben Platzhalter wie im Englischen", () => {
    for (const [key, entry] of Object.entries(all.en)) {
      for (const lang of ["de", "fr", "es"]) expect(tokens(all[lang][key].message)).toEqual(tokens(entry.message));
    }
  });
  it("alle data-i18n-Schlüssel der Einstellungsseite existieren", () => {
    const html = readFileSync(new URL("../options/options.html", import.meta.url), "utf8");
    for (const m of html.matchAll(/data-i18n="(\w+)"/g)) expect(all.en[m[1]], m[1]).toBeDefined();
  });
});
