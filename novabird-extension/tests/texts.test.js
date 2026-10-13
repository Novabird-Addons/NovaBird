/* Texte der Optionsseite (eigenes Wörterbuch TEXTS in options/options.js): alle vier Sprachen mit denselben Schlüsseln, nicht leer.
 * Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const vm = require("node:vm");
const L = require("../../shared/tests/locales.cjs");

const root = path.join(__dirname, "..");
const source = L.readAll(root, ["options/options.js"]);
const TEXTS = vm.runInNewContext("(" + source.match(/const TEXTS = (\{[\s\S]*?\n\});/)[1] + ")");

test("Optionsseite: vier Sprachen, gleiche Schlüssel, keine leeren Texte", () => {
  const problems = [];
  const en = Object.keys(TEXTS.en).sort();
  for (const lang of ["de", "en", "fr", "es"]) {
    const keys = Object.keys(TEXTS[lang] ?? {}).sort();
    for (const k of en) if (!keys.includes(k)) problems.push(`${lang}: fehlt ${k}`);
    for (const k of keys) if (!en.includes(k)) problems.push(`${lang}: nicht in en: ${k}`);
    for (const [k, v] of Object.entries(TEXTS[lang] ?? {})) if (typeof v === "string" && !v.trim()) problems.push(`${lang}/${k} ist leer`);
  }
  assert.deepEqual(problems, []);
});

test("Selbsttest: jede geprüfte Funktion hat einen Text", () => {
  const code = L.readAll(root, ["experiments/messageList/implementation.js", "experiments/novaContact/implementation.js", "experiments/mailRules/implementation.js"]);
  assert.deepEqual(L.selfTestProblems({ en: TEXTS.en }, code), []);
});

test("Manifest-Texte in allen Sprachen, Icons vorhanden", () => {
  assert.deepEqual(L.structureProblems(L.loadLocales(root)), []);
  assert.deepEqual(L.manifestProblems(root), []);
});
