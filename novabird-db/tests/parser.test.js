import { describe, expect, it } from "vitest";
import fs from "node:fs";
import { parseQuery, isEmptyQuery } from "../src/parser/parseQuery.js";
import { isoDate } from "../src/parser/dates.js";
import { stem } from "../src/parser/stem.js";

const golden = JSON.parse(fs.readFileSync(new URL("./parser.cases.json", import.meta.url), "utf8"));
const NOW = new Date(2026, 9, 5, 12, 0);

/** Parser-Ergebnis in Vergleichsform: leere Felder weg, Datum als YYYY-MM-DD. */
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

describe("Golden-Tests Parser", () => {
  it("läuft in Europe/Berlin", () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("Europe/Berlin");
  });
  for (const c of golden.cases) {
    it(c.q, () => {
      expect(compact(parseQuery(c.q, { now: NOW }))).toEqual(c.expect);
    });
  }
});

describe("Parser – Randfälle", () => {
  it("leere Eingabe", () => {
    expect(isEmptyQuery(parseQuery("", { now: NOW }))).toBe(true);
    expect(isEmptyQuery(parseQuery("   ich suche alle mails  ", { now: NOW }))).toBe(true);
  });

  it("Monatsende: letzte 1 Monat am 31.03.", () => {
    const q = parseQuery("letzten 1 Monat", { now: new Date(2026, 2, 31, 10) });
    expect(isoDate(q.dateFrom)).toBe("2026-02-28");
  });

  it("Jahreswechsel: im Dezember, wenn heute Januar ist", () => {
    const q = parseQuery("im Dezember", { now: new Date(2027, 0, 10) });
    expect(isoDate(q.dateFrom)).toBe("2026-12-01");
    expect(isoDate(q.dateTo)).toBe("2027-01-01");
  });

  it("letzte Woche über den Jahreswechsel", () => {
    const q = parseQuery("letzte Woche", { now: new Date(2027, 0, 6) }); // Mittwoch
    expect(isoDate(q.dateFrom)).toBe("2026-12-28");
    expect(isoDate(q.dateTo)).toBe("2027-01-04");
  });

  it("Schaltjahr: 29.2.", () => {
    const q = parseQuery("am 29.2.2028", { now: new Date(2028, 5, 1) });
    expect(isoDate(q.dateFrom)).toBe("2028-02-29");
  });

  it("ungültiges Datum bleibt Text", () => {
    const q = parseQuery("31.02.", { now: NOW });
    expect(q.dateFrom).toBe(null);
  });

  it("Zeiträume werden geschnitten (mehrere Angaben)", () => {
    const q = parseQuery("seit März bis Juni", { now: NOW });
    expect(isoDate(q.dateFrom)).toBe("2026-03-01");
    expect(isoDate(q.dateTo)).toBe("2026-07-01");
  });

  it("Personen werden nicht doppelt erfasst", () => {
    const q = parseQuery("von Jonas von jonas", { now: NOW });
    expect(q.from).toHaveLength(1);
  });

  it("Stoppwörter nach 'an' sind keine Namen", () => {
    const q = parseQuery("Erinnerung an die Wartung", { now: NOW });
    expect(q.to).toHaveLength(0);
  });

  it("Parser ist schnell (< 5 ms pro Anfrage im Mittel)", () => {
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) {
      parseQuery("Speisepläne von Jonas aus den letzten 6 Monaten mit PDF im Archiv", { now: NOW });
    }
    expect((performance.now() - t0) / 200).toBeLessThan(5);
  });
});

describe("Stemming", () => {
  it.each([
    ["Speisepläne", "speiseplän"],
    ["Rechnungen", "rechnung"],
    ["Berichte", "bericht"],
    ["Lehrerinnen", "lehrerin"],
    ["Daten", "daten"],
    ["Wartung", "wartung"],
    ["KW14", "kw14"],
  ])("%s -> %s", (w, s) => expect(stem(w)).toBe(s));
});
