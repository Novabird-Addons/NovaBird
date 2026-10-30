/* Prüft die Sprachdateien (gemeinsame Prüfung in shared/tests/locales.cjs) und welche Schlüssel der Code verwendet. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const L = require("../../shared/tests/locales.cjs");

const root = path.join(__dirname, "..");
const all = L.loadLocales(root);
const read = file => L.readAll(root, [file]);

test("Vier Sprachen: gleiche Schlüssel, nicht leer, Platzhalter stimmig", () => {
  assert.deepEqual(L.structureProblems(all), []);
});

test("Alle im Code verwendeten Schlüssel gibt es", () => {
  const used = new Set();
  for (const file of ["background.js", "options/options.js", "options/index.js", "options/semantic.js", "db/background.js", "db/debug/debug.js"]) {
    for (const m of read(file).matchAll(/"(\w+)"/g)) if (m[1] in all.en || m[1] in all.de) used.add(m[1]);
  }
  for (const m of read("manifest.json").matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
  for (const m of read("options/options.html").matchAll(/data-i18n="(\w+)"/g)) used.add(m[1]);
  // Texte, die das Experiment per setStrings bekommt, stehen in der Liste in background.js (init)
  const list = read("background.js").match(/for \(const key of \[([\s\S]*?)\]\)/)[1];
  for (const m of list.matchAll(/"(\w+)"/g)) used.add(m[1]);
  assert.ok(used.size > 10, "zu wenige Schlüssel gefunden – Suchmuster prüfen");
  assert.deepEqual(L.missingKeys(all, used), []);
});

test("Jeder Text aus den Sprachdateien wird verwendet", () => {
  const code = L.readAll(root, [
    "background.js", "manifest.json", "options/options.html", "options/options.js", "analysis/analysis.js",
    // Suchindex (bis 1.x Add-on NovaBird-DB)
    "options/index.js", "db/background.js", "db/debug/debug.js", "db/api/novabirdDbUi/implementation.js",
    // Semantische Suche (Beta)
    "options/semantic.js",
  ]);
  assert.deepEqual(L.unusedKeys(all, code), []);
});

test("Strings des Experiments stimmen mit den Sprachschlüsseln überein", () => {
  const block = read("experiments/searchBar/implementation.js").match(/const DEFAULT_STRINGS = \{([\s\S]*?)\};/)[1];
  const keys = [...block.matchAll(/^\s*(\w+):/gm)].map(m => m[1]);
  assert.deepEqual(L.missingKeys(all, keys), []);
});

test("Selbsttest: jede geprüfte Funktion hat einen Text", () => {
  assert.deepEqual(L.selfTestProblems(all, read("experiments/searchBar/implementation.js")), []);
});

test("Manifest: Standardsprache en, Icons vorhanden", () => {
  assert.deepEqual(L.manifestProblems(root), []);
});
