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
  const code = L.readAll(root, ["experiments/messageList/implementation.js", "experiments/novaContact/implementation.js", "experiments/mailRules/implementation.js", "experiments/mailStats/implementation.js"]);
  assert.deepEqual(L.selfTestProblems({ en: TEXTS.en }, code), []);
});

test("Manifest-Texte in allen Sprachen, Icons vorhanden", () => {
  assert.deepEqual(L.structureProblems(L.loadLocales(root)), []);
  assert.deepEqual(L.manifestProblems(root), []);
});

test("Einrichtungs-Assistent: vier Sprachen, gleiche Schlüssel und Platzhalter, jeder benutzte Text vorhanden", () => {
  const code = L.readAll(root, ["setup/setup.js"]);
  const T = vm.runInNewContext("(" + code.match(/const T = (\{[\s\S]*?\n {2}\});/)[1] + ")");
  const problems = [];
  // Verschachtelte Texte (Objekte, Listen) als Pfad → Text
  const flat = (o, pre = "") => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [[pre + k, v]] : flat(v, `${pre}${k}.`)));
  const ph = s => [...s.matchAll(/\$\d/g)].map(m => m[0]).sort().join();
  const en = new Map(flat(T.en));
  for (const lang of ["de", "fr", "es"]) {
    const map = new Map(flat(T[lang] ?? {}));
    for (const k of en.keys()) if (!map.has(k)) problems.push(`${lang}: fehlt ${k}`);
    for (const [k, v] of map) {
      if (!en.has(k)) problems.push(`${lang}: nicht in en: ${k}`);
      else if (ph(v) !== ph(en.get(k))) problems.push(`${lang}/${k}: andere Platzhalter als en`);
      if (!v.trim()) problems.push(`${lang}/${k} ist leer`);
    }
  }
  for (const [, k] of code.matchAll(/\bt\.(\w+)/g)) if (!(k in T.en)) problems.push(`benutzt, aber nicht vorhanden: t.${k}`);
  assert.deepEqual(problems, []);
});

test("Optionsseite: kein Textschlüssel heißt wie ein Element mit Inhalt (die Textschleife würde ihn ersetzen)", () => {
  // options.js setzt für jeden Schlüssel textContent des gleichnamigen Elements – trägt ein Container dieselbe id, sind
  // seine Kinder weg (Fehler 05.11.: „aiViaHelper“ löschte Absatz und Knopf, die KI-Einstellungen brachen danach ab)
  const html = require("node:fs").readFileSync(path.join(root, "options/options.html"), "utf8");
  const keys = new Set(Object.values(TEXTS).flatMap((o) => Object.keys(o)));
  const hits = [];
  for (const m of html.matchAll(/<(\w+)\b[^>]*\bid="([^"]+)"[^>]*>/g)) {
    if (!keys.has(m[2])) continue;
    const after = html.slice(m.index + m[0].length).trimStart();
    if (after.startsWith("<") && !after.startsWith("</")) hits.push(`${m[2]} (${m[1]})`);
  }
  assert.deepEqual(hits, []);
});

test("HTML-Seiten der Extension: keine doppelten IDs (getElementById/querySelector fänden das falsche Element)", () => {
  // Fehler 05.11.: „cList“ war Zähler im Reiter und Trefferliste beim Aufräumen – die Liste landete im Zähler
  const fs = require("node:fs");
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? (["node_modules", "tests"].includes(e.name) ? [] : walk(path.join(d, e.name))) : e.name.endsWith(".html") ? [path.join(d, e.name)] : []);
  const dups = [];
  for (const f of walk(root)) {
    const ids = [...fs.readFileSync(f, "utf8").matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) dups.push(`${path.relative(root, f)}: ${id}`);
  }
  assert.deepEqual(dups, []);
});
