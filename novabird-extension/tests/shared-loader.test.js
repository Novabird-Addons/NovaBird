/* Lader für den gemeinsamen Code (nbSharedHost/nbLoadShared/nbUnloadShared) steht in jedem Experiment, das shared/*.js
 * nutzt – er kann sich nicht selbst aus shared/ laden. Die Kopien müssen gleich bleiben: wer eine ändert, ändert alle.
 * Ausführen: node --test tests/ (liest die Experimente der anderen Add-ons im selben Checkout, nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.join(__dirname, "..", "..");
const FILES = [
  "novabird-conversation/experiments/conversationView/implementation.js",
  "novabird-extension/experiments/messageList/implementation.js",
  "novabird-extension/experiments/novaContact/implementation.js",
  "novabird-extension/experiments/settingsRedesign/implementation.js",
  "novabird-search/experiments/searchBar/implementation.js",
  "novabird-send/experiments/undoOverlay/implementation.js",
];

// die drei Funktionen als Text (von „function name(“ bis zur schließenden Klammer am Zeilenanfang)
function loader(file) {
  const src = fs.readFileSync(path.join(repo, file), "utf8").replace(/\r\n/g, "\n");
  return ["nbSharedHost", "nbLoadShared", "nbUnloadShared"].map(name => {
    const m = src.match(new RegExp(`^function ${name}\\(extension[^]*?\\n}\\n`, "m"));
    assert.ok(m, `${file}: ${name} fehlt`);
    return m[0];
  }).join("");
}

test("Lader für shared/*.js: alle Kopien gleich", () => {
  const first = loader(FILES[0]);
  for (const file of FILES.slice(1)) assert.equal(loader(file), first, `${file} weicht ab`);
});

test("kein Experiment mit eigenem, abweichendem Lader übersehen", () => {
  const found = [];
  const walk = dir => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory() && !["node_modules", ".git", "tests"].includes(e.name)) walk(p);
      else if (e.name === "implementation.js" && /^function nbLoadShared\(/m.test(fs.readFileSync(p, "utf8"))) {
        found.push(path.relative(repo, p).replace(/\\/g, "/"));
      }
    }
  };
  for (const addon of ["novabird-conversation", "novabird-extension", "novabird-search", "novabird-send"]) walk(path.join(repo, addon));
  assert.deepEqual(found.sort(), [...FILES].sort());
});
