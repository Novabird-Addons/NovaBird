import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseQuery } from "../src/parser/parseQuery.js";
import { isoDate } from "../src/parser/dates.js";
import { LANGUAGES, resolvePacks } from "../src/parser/lang/index.js";

const golden = JSON.parse(fs.readFileSync(new URL("./parser.lang.cases.json", import.meta.url), "utf8"));
const NOW = new Date(2026, 9, 5, 12, 0);

function compact(q) {
  const o = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === "raw") continue;
    if (Array.isArray(v) && !v.length) continue;
    if (v == null) continue;
    o[k] = k.startsWith("date") ? isoDate(v) : v;
  }
  return o;
}

describe("Sprachpakete: Golden-Tests", () => {
  for (const lang of ["en", "fr", "es"]) {
    describe(lang, () => {
      for (const c of golden[lang]) {
        it(c.q, () => {
          expect(compact(parseQuery(c.q, { now: NOW, langs: [lang] }))).toEqual(c.expect);
        });
      }
    });
  }
});

describe("Sprachpakete: Aufbau", () => {
  it("vier Sprachen registriert, unbekannte Codes fallen auf Deutsch", () => {
    expect(LANGUAGES).toEqual(["de", "en", "fr", "es"]);
    expect(resolvePacks(["xx"]).map((p) => p.code)).toEqual(["de"]);
    expect(resolvePacks(["EN-us", "fr", "en"]).map((p) => p.code)).toEqual(["en", "fr"]);
  });
  it("ohne Angabe wie bisher Deutsch", () => {
    expect(compact(parseQuery("Speisepläne von Jonas", { now: NOW }))).toEqual({ terms: [["speiseplän"]], from: [{ name: "Jonas" }] });
  });
  it("mehrere Sprachen nacheinander: Deutsch + Englisch", () => {
    const q = parseQuery("Rechnungen from Jonas letzte Woche", { now: NOW, langs: ["de", "en"] });
    expect(compact(q)).toEqual({ terms: [["rechnung"]], from: [{ name: "Jonas" }], dateFrom: "2026-09-28", dateTo: "2026-10-05" });
  });
  it("Operatoren aller Sprachen gelten mit, englische immer", () => {
    expect(compact(parseQuery("from:jonas", { now: NOW, langs: ["fr"] })).from).toEqual([{ name: "jonas" }]);
    expect(compact(parseQuery("de:jonas", { now: NOW, langs: ["fr"] })).from).toEqual([{ name: "jonas" }]);
    expect(compact(parseQuery("asunto:plan", { now: NOW, langs: ["es"] })).subjectTerms).toEqual(["plan"]);
  });
  it("US-Datum m/d/yyyy nur mit dateOrder mdy", () => {
    expect(compact(parseQuery("on 3/15/2026", { now: NOW, langs: ["en"], dateOrder: "mdy" })).dateFrom).toBe("2026-03-15");
    expect(compact(parseQuery("on 15/3/2026", { now: NOW, langs: ["en"] })).dateFrom).toBe("2026-03-15");
  });
  it("Verhältniswort „de“ vor Kleinbuchstaben ist keine Person (fr/es)", () => {
    expect(compact(parseQuery("notes de réunion", { now: NOW, langs: ["fr"] })).from).toBeUndefined();
    expect(compact(parseQuery("notes de Jonas", { now: NOW, langs: ["fr"] })).from).toEqual([{ name: "Jonas" }]);
  });
});
