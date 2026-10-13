// Regel-Assistent: vier Sprachen mit gleichen Schlüsseln, keine leeren Texte, Platzhalter gleich wie Englisch
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "rules", "wizard.js"), "utf8");
const TEXTS = vm.runInNewContext(code.slice(0, code.indexOf("const lang =")) + ";TEXTS");

test("Regel-Assistent: Texte vollständig in DE/EN/FR/ES", () => {
  const problems = [];
  const en = TEXTS.en;
  for (const lang of ["de", "fr", "es"]) {
    for (const k of Object.keys(en)) if (!(k in TEXTS[lang])) problems.push(`${lang}: fehlt ${k}`);
    for (const k of Object.keys(TEXTS[lang])) if (!(k in en)) problems.push(`${lang}: nicht in en: ${k}`);
  }
  for (const [lang, texts] of Object.entries(TEXTS)) {
    for (const [k, v] of Object.entries(texts)) {
      if (!String(v).trim() && k !== "dot") problems.push(`${lang}/${k} ist leer`);
      const want = (String(en[k]).match(/\$\d/g) ?? []).sort().join();
      if ((String(v).match(/\$\d/g) ?? []).sort().join() !== want) problems.push(`${lang}/${k}: Platzhalter`);
    }
  }
  assert.deepEqual(problems, []);
});

test("Regel-Assistent: jeder verwendete Schlüssel existiert", () => {
  const used = new Set([...code.matchAll(/\bt\("(\w+)"/g)].map(m => m[1]));
  for (const m of code.matchAll(/(\w+): "(\w+)"/g)) if (m[2] in TEXTS.en) used.add(m[2]);
  const missing = [...used].filter(k => !(k in TEXTS.en));
  assert.deepEqual(missing, []);
});
