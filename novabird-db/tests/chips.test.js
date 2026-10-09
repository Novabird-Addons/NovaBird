import { describe, expect, it } from "vitest";
import { parseQuery } from "../src/parser/parseQuery.js";
import { removeChip, toChips } from "../src/parser/chips.js";

const NOW = new Date(2026, 9, 5, 12, 0);

describe("Chips", () => {
  it("zeigt die Interpretation lesbar an", () => {
    const q = parseQuery("Speisepläne von Jonas aus den letzten 6 Monaten mit PDF", { now: NOW });
    expect(toChips(q).map((c) => c.label)).toEqual(["Von: Jonas", "Seit 05.04.2026", "📎 PDF", "speiseplän"]);
  });

  it("Tageszeitraum und Spanne", () => {
    expect(toChips(parseQuery("gestern", { now: NOW }))[0].label).toBe("Am 04.10.2026");
    expect(toChips(parseQuery("im Mai", { now: NOW }))[0].label).toBe("01.05.2026 – 31.05.2026");
    expect(toChips(parseQuery("bis Juni", { now: NOW }))[0].label).toBe("Bis 30.06.2026");
  });

  it("von mir / an mich", () => {
    const labels = toChips(parseQuery("von mir an mich", { now: NOW })).map((c) => c.label);
    expect(labels).toEqual(["Von: mir", "An: mich"]);
  });

  it("Chip entfernen ändert nur dieses Kriterium", () => {
    const q = parseQuery("Rechnungen von Petra seit März ungelesen", { now: NOW });
    const without = removeChip(q, "date");
    expect(without.dateFrom).toBe(null);
    expect(without.from).toEqual(q.from);
    expect(without.unread).toBe(true);
    expect(q.dateFrom).not.toBe(null); // Original unverändert
  });

  it("Anhangtyp entfernen setzt Anhang zurück, wenn kein Typ übrig", () => {
    const q = parseQuery("mit PDF", { now: NOW });
    const without = removeChip(q, "attType:pdf");
    expect(without.attachmentTypes).toEqual([]);
    expect(without.hasAttachment).toBe(null);
  });
});

describe("Chips in anderen Sprachen", () => {
  it("englisch, französisch, spanisch", () => {
    const q = parseQuery("invoices from Jonas since March unread", { now: NOW, langs: ["en"] });
    expect(toChips(q, "en").map((c) => c.label)).toEqual(["From: Jonas", "Since 01.03.2026", "Unread", "invoic"]);
    expect(toChips(q, "fr").map((c) => c.label)).toEqual(["De: Jonas", "Depuis 01.03.2026", "Non lu", "invoic"]);
    expect(toChips(q, "es")[0].label).toBe("De: Jonas");
    expect(toChips(q)[0].label).toBe("Von: Jonas"); // Standard Deutsch
  });
});
