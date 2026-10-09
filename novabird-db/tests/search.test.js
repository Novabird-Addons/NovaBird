import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { MESSAGES, NOW } from "./helpers/fixtures.js";
import { migrate, repository, search, buildSearchSql, parseQuery } from "../src/search.js";
import { removeChip } from "../src/parser/chips.js";

const ME = ["leitung@firma.example"];

async function setup(mode) {
  const db = createNodeAdapter();
  const caps = await migrate(db, { forceMode: mode });
  await repository.upsertMessages(db, caps, MESSAGES, +NOW);
  return { db, caps };
}

const ids = (r) => r.rows.map((x) => x.header_msg_id.split("@")[0]).sort();
const run = (ctx, text, opts = {}) => search(ctx.db, ctx.caps, text, { now: NOW, myEmails: ME, ...opts });

describe("Suche (FTS5, Standard)", async () => {
  const ctx = await setup();

  it("Beispiel aus der Aufgabe: Speisepläne von Jonas aus den letzten 6 Monaten", async () => {
    const r = await run(ctx, "Speisepläne von Jonas aus den letzten 6 Monaten");
    expect(ids(r)).toEqual(["m1", "m2"]); // m3 zu alt, m4 ist Stundenplan, m8 im Papierkorb
  });

  it("Kompositum: 'speiseplan' findet 'Wochenspeisepläne' im Betreff (Trigramm)", async () => {
    const r = await run(ctx, "betreff:speiseplan");
    expect(ids(r)).toContain("m1");
  });

  it("Nachname wird über Namensauflösung zugeordnet", async () => {
    const r = await run(ctx, "Speiseplan von Jonas Müller");
    expect(r.query.from[0].resolved.email).toBe("jonas.mueller@firma.example");
    expect(r.query.terms).toEqual([["speiseplan"]]); // "müller" als Begriff entfernt
    expect(ids(r)).toEqual(["m1", "m2", "m3"]);
  });

  it("mehrdeutiger Name bleibt LIKE-Suche und liefert Kandidaten", async () => {
    const r = await run(ctx, "von Jonas");
    expect(r.query.from[0].candidates.map((c) => c.email)).toEqual(["jonas.mueller@firma.example", "n.becker@extern.example"]);
    expect(r.query.from[0].resolved).toBeUndefined();
    expect(r.chips[0].ambiguous).toBe(true);
    expect(ids(r)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("ODER-Gruppe und Ausschluss", async () => {
    expect(ids(await run(ctx, "Speiseplan oder Stundenplan"))).toEqual(["m1", "m2", "m3", "m4", "m5"]);
    expect(ids(await run(ctx, "speiseplan -juni"))).toEqual(["m1", "m3", "m5"]);
  });

  it("Anhang, Status, Ordner", async () => {
    expect(ids(await run(ctx, "ungelesene mit PDF"))).toEqual(["m2", "m6"]);
    expect(ids(await run(ctx, "Excel"))).toEqual(["m1"]);
    expect(ids(await run(ctx, "markiert"))).toEqual(["m5"]);
    expect(ids(await run(ctx, "tag:wichtig"))).toEqual(["m5"]);
    expect(ids(await run(ctx, "speiseplan im Papierkorb"))).toEqual(["m8"]);
    expect(ids(await run(ctx, "ohne Anhang Urlaubsplanung"))).toEqual(["m5", "m7"]);
  });

  it("Papierkorb ist standardmäßig ausgeschlossen", async () => {
    expect(ids(await run(ctx, "verworfen"))).toEqual([]);
    expect(ids(await run(ctx, "verworfen", { includeTrash: true }))).toEqual(["m8"]);
  });

  it("von mir / an Petra / mit Petra", async () => {
    expect(ids(await run(ctx, "von mir an Petra"))).toEqual(["m7"]);
    expect(ids(await run(ctx, "mit Petra"))).toEqual(["m5", "m7"]);
    // m1 (Jonas Müller) und m4 (Jonas Becker) gingen seit Juli an mich
    expect(ids(await run(ctx, "an mich von Jonas seit Juli"))).toEqual(["m1", "m4"]);
  });

  it("Phrase, Datum, Jahr", async () => {
    expect(ids(await run(ctx, "ERP-Wartung"))).toEqual(["m6"]);
    expect(ids(await run(ctx, "Rechnungen 2025"))).toEqual(["m9"]);
    expect(ids(await run(ctx, "im Juni"))).toEqual(["m2"]);
  });

  it("Treffer in Anhangstext und Anhangnamen", async () => {
    expect(ids(await run(ctx, "Abendessen"))).toEqual(["m1"]);
    expect(ids(await run(ctx, "Wartungsprotokoll"))).toEqual(["m6"]);
  });

  it("Dublette (Kopie im Archiv) erscheint nur einmal, Posteingang bevorzugt", async () => {
    const r = await run(ctx, "Wochenspeisepläne");
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].folder_type).toBe("inbox");
    const all = await run(ctx, "Wochenspeisepläne", { dedupe: false });
    expect(all.rows).toHaveLength(2);
  });

  it("Relevanz-Sortierung liefert Scores", async () => {
    const r = await run(ctx, "speiseplan", { sort: "relevance" });
    expect(r.rows.length).toBeGreaterThan(0);
    expect(r.rows.some((x) => typeof x.score === "number")).toBe(true);
  });

  it("Datums-Sortierung: neueste zuerst", async () => {
    const r = await run(ctx, "speiseplan");
    const dates = r.rows.map((x) => x.date);
    expect([...dates].sort((a, b) => b - a)).toEqual(dates);
  });

  it("Chip entfernen und erneut suchen", async () => {
    const r1 = await run(ctx, "Speisepläne von Jonas aus den letzten 6 Monaten");
    const r2 = await run(ctx, removeChip(r1.query, "date"));
    expect(ids(r2)).toEqual(["m1", "m2", "m3"]);
  });

  it("leere Anfrage liefert neueste Mails (ohne Papierkorb)", async () => {
    const r = await run(ctx, "");
    expect(r.empty).toBe(true);
    expect(r.rows[0].header_msg_id).toBe("m6@firma.example");
  });

  it("Sonderzeichen und SQL-Fragmente sind harmlos", async () => {
    for (const evil of [`'; DROP TABLE messages; --`, `" OR 1=1 --`, `NEAR(a b)`, `%_\\`, `von:%`, `subject:*`]) {
      await expect(run(ctx, evil)).resolves.toBeDefined();
    }
    expect((await run(ctx, "")).rows.length).toBeGreaterThan(0); // Tabelle noch da
  });

  it("alle Werte landen in Parametern", () => {
    const q = parseQuery("Rechnung von O'Brien seit März", { now: NOW });
    const { sql } = buildSearchSql(q, ctx.caps);
    expect(sql).not.toContain("O'Brien");
    expect(sql).not.toContain("rechnung");
  });

  it("Suche ist schnell genug (Testdaten, < 50 ms)", async () => {
    const t0 = performance.now();
    await run(ctx, "Speisepläne von Jonas aus den letzten 6 Monaten mit Anhang");
    expect(performance.now() - t0).toBeLessThan(50);
  });
});

describe("Suche – Fallback-Modi", async () => {
  for (const mode of ["fts5", "fts4"]) {
    const ctx = await setup(mode);
    it(`${mode}: Kernfälle funktionieren`, async () => {
      expect(ids(await run(ctx, "Speisepläne von Jonas aus den letzten 6 Monaten"))).toEqual(["m1", "m2"]);
      expect(ids(await run(ctx, "von mir an Petra"))).toEqual(["m7"]);
      expect(ids(await run(ctx, "ungelesene mit PDF"))).toEqual(["m2", "m6"]);
      expect(ids(await run(ctx, "speiseplan -juni"))).toEqual(["m1", "m3", "m5"]);
      expect(ids(await run(ctx, "Speiseplan oder Stundenplan"))).toEqual(["m1", "m2", "m3", "m4", "m5"]);
      expect(ids(await run(ctx, "ERP-Wartung"))).toEqual(["m6"]);
      expect(ids(await run(ctx, "betreff:speiseplan")).length).toBeGreaterThanOrEqual(2);
    });
  }

  it("fts4: Kompositum 'speiseplan' findet 'Wochenspeisepläne' per LIKE-Fallback", async () => {
    const ctx = await setup("fts4");
    expect(ctx.caps.trigram).toBe(false);
    expect(ids(await run(ctx, "speiseplan"))).toContain("m1");
    expect(ids(await run(ctx, "betreff:speiseplan"))).toContain("m1");
    // Teilwort mitten im Wort, mit Umlaut-Normalisierung
    expect(ids(await run(ctx, "plan"))).toContain("m1");
  });

  it("fts4: Fallback verändert Treffermenge anderer Filter nicht", async () => {
    const ctx = await setup("fts4");
    expect(ids(await run(ctx, "speiseplan von Jonas"))).toContain("m1");
    expect(ids(await run(ctx, "speiseplan von Petra"))).not.toContain("m1");
  });
});
