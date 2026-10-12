/* Gemeinsame Farbrechnung (shared/color.js). Ausführen: node --test shared/tests/color.test.js */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const C = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "color.js"), "utf8"), C);

test("Farbformate: #hex, rgb(), rgba(), color(srgb …) wie von Gecko", () => {
  assert.deepEqual([...C.nbParseColor("#1d1e22")], [29, 30, 34]);
  assert.deepEqual([...C.nbParseColor("#1d1e22ff")], [29, 30, 34]);
  assert.deepEqual([...C.nbParseColor("rgb(250, 250, 250)")], [250, 250, 250]);
  assert.deepEqual([...C.nbParseColor("rgba(10 20 30 / 0.5)")], [10, 20, 30]);
  assert.deepEqual([...C.nbParseColor("color(srgb 0.116863 0.111176 0.12098)")], [30, 28, 31]);
  assert.equal(C.nbParseColor("Canvas"), null);
});

test("Hell/Dunkel (Fehler 1.9.9: color(srgb) mit Werten 0..1)", () => {
  assert.equal(C.nbIsDark("color(srgb 0.116863 0.111176 0.12098)"), true);
  assert.equal(C.nbIsDark("color(srgb 0.968235 0.964706 0.957647)"), false);
  assert.equal(C.nbIsDark("rgb(24, 24, 27)"), true);
  assert.equal(C.nbIsDark("#f7f6f4"), false);
  assert.equal(C.nbIsDark("unbekannt"), false);
});

test("Kontrast nach WCAG", () => {
  assert.equal(Math.round(C.nbContrast([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(C.nbContrast([120, 120, 120], [120, 120, 120]), 1);
});
