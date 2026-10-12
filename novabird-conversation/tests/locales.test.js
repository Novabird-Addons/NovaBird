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
  for (const m of read("content/view.js").matchAll(/\bt\("(\w+)"/g)) used.add(m[1]);
  used.delete("messagesCountTemplate");
  used.delete("toNamesTemplate");
  const list = read("background.js").match(/STRING_KEYS = \[([\s\S]*?)\];/)[1];
  for (const m of list.matchAll(/"(\w+)"/g)) used.add(m[1]);
  for (const m of read("options/options.html").matchAll(/data-i18n="(\w+)"/g)) used.add(m[1]);
  for (const m of read("options/options.js").matchAll(/getMessage\("(\w+)"/g)) used.add(m[1]);
  for (const m of read("manifest.json").matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
  assert.ok(used.size > 20, "zu wenige Schlüssel gefunden – Suchmuster prüfen");
  assert.deepEqual(L.missingKeys(all, used), []);
});

test("Es gibt keine ungenutzten Schlüssel", () => {
  const code = L.readAll(root, ["background.js", "content/view.js", "options/options.html", "options/options.js", "manifest.json"]);
  assert.deepEqual(L.unusedKeys(all, code), []);
});

test("Selbsttest: jede geprüfte Funktion hat einen Text", () => {
  assert.deepEqual(L.selfTestProblems(all, read("experiments/conversationView/implementation.js")), []);
});

test("Manifest: Standardsprache en, Icons vorhanden", () => {
  assert.deepEqual(L.manifestProblems(root), []);
});
