/* NovaBird – gemeinsame Prüfung der Sprachdateien (nur Entwicklung, kommt nicht ins Paket).
 * Jede Funktion liefert eine Liste von Problemen (leer = in Ordnung); die Tests der Add-ons prüfen
 * damit `assert.deepEqual(problems, [])` bzw. `expect(problems).toEqual([])`.
 * Welche Schlüssel ein Add-on verwendet, sammelt es selbst (die Suchmuster sind je Add-on verschieden).
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const LANGS = ["en", "de", "fr", "es"]; // en = default_locale, Maßstab für Schlüssel und Platzhalter
const tokens = text => [...String(text).matchAll(/\$\d|\$[A-Z_]+\$|\{\w+\}/gi)].map(m => m[0].toUpperCase()).sort();

/** Lädt alle vier Sprachen eines Add-ons: { en, de, fr, es }. */
function loadLocales(root) {
  const all = {};
  for (const lang of LANGS) {
    all[lang] = JSON.parse(fs.readFileSync(path.join(root, "_locales", lang, "messages.json"), "utf8"));
  }
  return all;
}

/** Gleiche Schlüssel wie Englisch, keine leeren Texte, Platzhalter definiert/benutzt und gleich wie im Englischen. */
function structureProblems(all) {
  const out = [];
  const enKeys = Object.keys(all.en).sort();
  for (const lang of LANGS) {
    const messages = all[lang];
    const keys = Object.keys(messages).sort();
    for (const k of enKeys) if (!(k in messages)) out.push(`${lang}: Schlüssel fehlt: ${k}`);
    for (const k of keys) if (!(k in all.en)) out.push(`${lang}: Schlüssel nicht in en: ${k}`);
    for (const [key, entry] of Object.entries(messages)) {
      if (!entry?.message?.trim()) {
        out.push(`${lang}/${key} ist leer`);
        continue;
      }
      const used = [...entry.message.matchAll(/\$(\w+)\$/g)].map(m => m[1].toLowerCase()).sort();
      const defined = Object.keys(entry.placeholders ?? {}).map(k => k.toLowerCase()).sort();
      if (JSON.stringify([...new Set(used)]) !== JSON.stringify(defined)) out.push(`${lang}/${key}: Platzhalter passen nicht`);
      if (lang !== "en" && key in all.en && JSON.stringify(tokens(entry.message)) !== JSON.stringify(tokens(all.en[key].message))) {
        out.push(`${lang}/${key}: andere Platzhalter als en`);
      }
    }
  }
  return out;
}

/** Jeder verwendete Schlüssel existiert (in allen Sprachen, über structureProblems). */
function missingKeys(all, usedKeys) {
  return [...usedKeys].filter(k => !(k in all.en)).map(k => `Schlüssel fehlt: ${k}`);
}

/** Jeder Schlüssel wird irgendwo im Code verwendet (als "key", 'key', data-i18n="key" oder __MSG_key__).
 *  Selbsttest-Texte (selfTest…) prüft selfTestProblems. */
function unusedKeys(all, codeText, { ignore = [] } = {}) {
  return Object.keys(all.en)
    .filter(k => !ignore.includes(k) && !k.startsWith("selfTest"))
    .filter(k => !codeText.includes(`"${k}"`) && !codeText.includes(`'${k}'`) && !codeText.includes(`__MSG_${k}__`))
    .map(k => `Schlüssel wird nirgends verwendet: ${k}`);
}

/** Selbsttest (shared/selftest*.js): Titel/Text/Hinweis vorhanden; jede Funktion aus dem Code (feature: "x" in der
 *  Prüfliste oder nbReportMissing("x")) hat einen Text selfTest_x, und es gibt keine Texte für unbekannte Funktionen. */
function selfTestProblems(all, codeText) {
  const out = [];
  const features = new Set();
  for (const m of codeText.matchAll(/feature: "(\w+)"|nbReportMissing\??\.?\(\s*"(\w+)"/g)) features.add(m[1] || m[2]);
  if (!features.size) out.push("keine Selbsttest-Funktionen im Code gefunden – Suchmuster prüfen");
  for (const k of ["selfTestTitle", "selfTestText", "selfTestHint"]) if (!(k in all.en)) out.push(`Schlüssel fehlt: ${k}`);
  for (const f of features) if (!(`selfTest_${f}` in all.en)) out.push(`Text fehlt: selfTest_${f}`);
  for (const k of Object.keys(all.en)) {
    if (k.startsWith("selfTest_") && !features.has(k.slice(9))) out.push(`Text ohne Funktion: ${k}`);
  }
  return out;
}

/** default_locale ist en und vorhanden; Icons aus dem Manifest existieren. */
function manifestProblems(root) {
  const out = [];
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  if (manifest.default_locale !== "en") out.push(`default_locale ist ${manifest.default_locale}, erwartet en`);
  if (!fs.existsSync(path.join(root, "_locales", "en", "messages.json"))) out.push("_locales/en fehlt");
  for (const file of Object.values(manifest.icons ?? {})) {
    if (!fs.existsSync(path.join(root, file))) out.push(`Icon fehlt: ${file}`);
  }
  return out;
}

/** Dateien eines Add-ons als ein Text (für unusedKeys) bzw. einzeln lesen. */
const readAll = (root, files) => files.map(f => fs.readFileSync(path.join(root, f), "utf8")).join("\n");

module.exports = { LANGS, loadLocales, structureProblems, missingKeys, unusedKeys, selfTestProblems, manifestProblems, readAll };
