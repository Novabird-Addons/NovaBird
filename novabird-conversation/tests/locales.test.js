/* Prüft die Sprachdateien: gleiche Schlüssel, alle verwendeten Texte vorhanden, Platzhalter stimmig. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = name => fs.readFileSync(path.join(root, name), "utf8");
const de = JSON.parse(read("_locales/de/messages.json"));
const en = JSON.parse(read("_locales/en/messages.json"));
const fr = JSON.parse(read("_locales/fr/messages.json"));
const es = JSON.parse(read("_locales/es/messages.json"));

test("Alle vier Sprachen haben dieselben Schlüssel", () => {
  for (const other of [de, fr, es]) assert.deepEqual(Object.keys(other).sort(), Object.keys(en).sort());
});

test("Jeder Text ist nicht leer", () => {
  for (const [lang, messages] of [["de", de], ["en", en], ["fr", fr], ["es", es]]) {
    for (const [key, entry] of Object.entries(messages)) {
      assert.ok(entry.message?.trim(), `${lang}/${key} ist leer`);
    }
  }
});

test("Platzhalter sind in beiden Sprachen definiert und werden verwendet", () => {
  for (const [lang, messages] of [["de", de], ["en", en], ["fr", fr], ["es", es]]) {
    for (const [key, entry] of Object.entries(messages)) {
      const used = [...entry.message.matchAll(/\$(\w+)\$/g)].map(m => m[1].toLowerCase());
      const defined = Object.keys(entry.placeholders ?? {});
      assert.deepEqual(used.sort(), defined.sort(), `${lang}/${key}: Platzhalter passen nicht`);
    }
  }
  for (const key of Object.keys(en)) {
    for (const other of [de, fr, es]) {
      assert.deepEqual(
        Object.keys(other[key].placeholders ?? {}).sort(),
        Object.keys(en[key].placeholders ?? {}).sort(),
        `${key}: Platzhalter unterscheiden sich zwischen den Sprachen`
      );
    }
  }
});

test("Alle im Code verwendeten Schlüssel gibt es", () => {
  const used = new Set();
  for (const file of ["content/view.js"]) {
    for (const m of read(file).matchAll(/\bt\("(\w+)"/g)) used.add(m[1]);
  }
  used.delete("messagesCountTemplate");
  used.delete("toNamesTemplate");
  const list = read("background.js").match(/STRING_KEYS = \[([\s\S]*?)\];/)[1];
  for (const m of list.matchAll(/"(\w+)"/g)) used.add(m[1]);
  for (const m of read("options/options.html").matchAll(/data-i18n="(\w+)"/g)) used.add(m[1]);
  for (const m of read("options/options.js").matchAll(/getMessage\("(\w+)"/g)) used.add(m[1]);
  for (const m of read("manifest.json").matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
  assert.ok(used.size > 20, "zu wenige Schlüssel gefunden – Suchmuster prüfen");
  for (const key of used) {
    assert.ok(key in de, `Schlüssel fehlt in de: ${key}`);
    assert.ok(key in en, `Schlüssel fehlt in en: ${key}`);
  }
});

test("Es gibt keine ungenutzten Schlüssel", () => {
  const code = ["background.js", "content/view.js", "options/options.html", "options/options.js", "manifest.json"].map(read).join("\n");
  for (const key of Object.keys(de)) {
    assert.ok(
      code.includes(`"${key}"`) || code.includes(`data-i18n="${key}"`) || code.includes(`__MSG_${key}__`),
      `Schlüssel wird nirgends verwendet: ${key}`
    );
  }
});

test("Manifest verweist auf vorhandene Standardsprache", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.equal(manifest.default_locale, "en");
  assert.ok(fs.existsSync(path.join(root, "_locales", manifest.default_locale, "messages.json")));
});

test("Icons aus dem Manifest existieren", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.ok(Object.keys(manifest.icons).length >= 2);
  for (const file of Object.values(manifest.icons)) {
    assert.ok(fs.existsSync(path.join(root, file)), `Icon fehlt: ${file}`);
  }
});
