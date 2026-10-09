/* Prüft alle vier Sprachdateien (de, en, fr, es): gleiche Schlüssel, nicht leer, gleiche Platzhalter wie Englisch. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const load = lang => JSON.parse(fs.readFileSync(path.join(root, "_locales", lang, "messages.json"), "utf8"));
const all = { de: load("de"), en: load("en"), fr: load("fr"), es: load("es") };
const tokens = text => [...text.matchAll(/\$\d|\$[A-Z]+\$|\{\w+\}/g)].map(m => m[0]).sort();

test("Vier Sprachen: dieselben Schlüssel, keine leeren Texte", () => {
  for (const lang of ["de", "fr", "es"]) assert.deepEqual(Object.keys(all[lang]).sort(), Object.keys(all.en).sort(), lang);
  for (const [lang, messages] of Object.entries(all)) {
    for (const [key, entry] of Object.entries(messages)) assert.ok(entry.message?.trim(), `${lang}/${key} ist leer`);
  }
});

test("Vier Sprachen: dieselben Platzhalter wie im Englischen", () => {
  for (const [key, entry] of Object.entries(all.en)) {
    for (const lang of ["de", "fr", "es"]) {
      assert.deepEqual(tokens(all[lang][key].message), tokens(entry.message), `${lang}/${key}`);
    }
  }
});
