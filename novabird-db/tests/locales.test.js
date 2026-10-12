// Prüft alle vier Sprachdateien (gemeinsame Prüfung in shared/tests/locales.cjs) und die Schlüssel der Einstellungsseite.
import { describe, expect, it } from "vitest";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const L = createRequire(import.meta.url)("../../shared/tests/locales.cjs");
const root = fileURLToPath(new URL("..", import.meta.url));
const all = L.loadLocales(root);

describe("Sprachdateien", () => {
  it("vier Sprachen: gleiche Schlüssel, nicht leer, Platzhalter stimmig", () => {
    expect(L.structureProblems(all)).toEqual([]);
  });
  it("alle data-i18n-Schlüssel der Einstellungsseite existieren", () => {
    const html = L.readAll(root, ["options/options.html"]);
    expect(L.missingKeys(all, [...html.matchAll(/data-i18n="(\w+)"/g)].map((m) => m[1]))).toEqual([]);
  });
  it("Manifest: Standardsprache en, Icons vorhanden", () => {
    expect(L.manifestProblems(root)).toEqual([]);
  });
});
