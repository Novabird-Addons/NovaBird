/* Die Standard-Anweisung im NovaBird Helper (novabird-helper/web/prompts.json) muss der Anweisung in ai/ai.js entsprechen;
 * sonst zeigt die Web-Oberfläche des Helpers einen alten Text. Neu erzeugen: node tools/sync-helper-prompts.mjs
 * Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { pathToFileURL } = require("node:url");

const repo = path.join(__dirname, "..", "..");

test("Helper-Standardanweisung entspricht ai.js", async () => {
  const { prompts } = await import(pathToFileURL(path.join(repo, "tools", "sync-helper-prompts.mjs")).href);
  const saved = fs.readFileSync(path.join(repo, "novabird-helper", "web", "prompts.json"), "utf8");
  assert.equal(saved, prompts(), "veraltet: node tools/sync-helper-prompts.mjs");
});

test("Helper-Standardanweisung hat die Platzhalter", () => {
  const p = JSON.parse(fs.readFileSync(path.join(repo, "novabird-helper", "web", "prompts.json"), "utf8"));
  for (const lang of ["de", "en", "fr", "es"]) {
    for (const kind of ["mail", "thread"]) {
      for (const ph of ["{ZIEL}", "{OPEN}", "{CLOSE}"]) {
        assert.ok(p[lang][kind].includes(ph), `${lang}.${kind} ohne ${ph}`);
      }
    }
  }
});
