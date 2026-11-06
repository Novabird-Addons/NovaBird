import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { MESSAGES, NOW } from "./helpers/fixtures.js";
import { migrate, repository, search, filterIds, buildSearchSql, parseQuery } from "../src/search.js";
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

describe("Bedeutungssuche: Kandidaten mit den Bedingungen der Wortsuche filtern", async () => {
  const ctx = await setup();
  const all = MESSAGES.map((m) => m.headerMessageId);
  const allowed = (text, opts = {}) => filterIds(ctx.db, ctx.caps, text, all, { now: NOW, myEmails: ME, ...opts });

  it("nur Suchwörter: keine Bedingung (null), auch „nicht X“ ist hier kein Ausschluss", async () => {
    expect(await allowed("rechnung bezahlen")).toBeNull();
    expect(await allowed("Server nicht erreichbar")).toBeNull();
  });

  it("von: lässt nur Mails dieses Absenders durch, die Suchwörter selbst filtern nicht", async () => {
    const got = await allowed("von:jonas.mueller@firma.example ganz anderes thema");
    expect([...got].map((id) => id.split("@")[0]).sort()).toEqual(
      [...new Set(MESSAGES.filter((m) => m.authorEmail === "jonas.mueller@firma.example" && !["trash", "junk"].includes(m.folderType)).map((m) => m.headerMessageId.split("@")[0]))].sort(),
    );
  });

  it("Papierkorb nur mit includeTrash", async () => {
    const without = await allowed("von:jonas.mueller@firma.example x");
    const withTrash = await allowed("von:jonas.mueller@firma.example x", { includeTrash: true });
    expect(withTrash.size).toBeGreaterThanOrEqual(without.size);
  });
});

describe("Wortformen in Französisch, Spanisch und Englisch (Stamm als Präfix)", async () => {
  const db = createNodeAdapter();
  const caps = await migrate(db, {});
  const mail = (id, subject, body) => ({
    accountId: "account1", folderId: "inbox", folderName: "Inbox", folderType: "inbox", recipients: "x <x@example.invalid>",
    hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [], isRead: true, isFlagged: false, attachmentText: "",
    headerMessageId: `${id}@example.invalid`, date: +new Date(2026, 8, 1), authorName: "A", authorEmail: "a@example.invalid", subject, body,
  });
  await repository.upsertMessages(db, caps, [
    mail("fr1", "Facturation septembre", "Votre facturation est disponible."),
    mail("fr2", "Colis envoyé", "Le colis a été envoyé hier."),
    mail("fr3", "Réunions de projet", "Les réunions auront lieu mardi."),
    mail("es1", "Facturación", "Adjuntamos la facturación del mes."),
    mail("es2", "Pedido enviado", "Su pedido ha sido enviado."),
    mail("en1", "Companies list", "All companies in the region."),
    mail("en2", "Note", "A short note for you."),
    mail("en3", "Booking confirmation", "Your booking is confirmed."),
  ], +NOW);
  const find = async (text, langs) => (await search(db, caps, text, { now: NOW, langs })).rows.map((x) => x.header_msg_id.split("@")[0]).sort();

  it("Französisch", async () => {
    expect(await find("facture", ["fr"])).toEqual(["es1", "fr1"]); // „factur*“: auch die spanische
    expect(await find("envoyer", ["fr"])).toEqual(["fr2"]);
    expect(await find("réunion", ["fr"])).toEqual(["fr3"]);
  });
  it("Spanisch", async () => {
    expect(await find("factura", ["es"])).toEqual(["es1", "fr1"]);
    expect(await find("enviar", ["es"])).toEqual(["es2"]);
  });
  it("Englisch", async () => {
    expect(await find("company", ["en"])).toEqual(["en1"]);
    expect(await find("notes", ["en"])).toEqual(["en2"]);
  });
  it("mehrere Sprachen: Englisch kürzt bei deutscher Oberfläche mit", async () => {
    expect(await find("booked", ["de"])).toEqual([]); // nur deutsche Endungen: „booked*“
    expect(await find("booked", ["de", "en"])).toEqual(["en3"]); // dazu Englisch: „book*“
  });
});

describe("Filter der Oberfläche vor der Höchstzahl (Haken „ungelesen“/„Anhang“, Zeitfenster) und Hinweis „es gibt mehr“", async () => {
  // 30 neue gelesene Rechnungen ohne Anhang, 3 ältere ungelesene, 2 ältere mit Anhang – Höchstzahl 10
  const db = createNodeAdapter();
  const caps = await migrate(db);
  const day = (n) => +NOW - n * 864e5;
  const base = { accountId: "account1", folderId: "inbox", folderName: "Posteingang", folderType: "inbox", recipients: "a@x.example",
    attachmentTypes: [], attachmentNames: [], tags: [], isFlagged: false, attachmentText: "", authorName: "Shop", authorEmail: "shop@x.example" };
  const mails = [];
  for (let i = 0; i < 30; i++) mails.push({ ...base, headerMessageId: `neu${i}@x`, date: day(i + 1), subject: `Rechnung ${i}`, body: "Ihre Rechnung", isRead: true, hasAttachment: false });
  for (let i = 0; i < 3; i++) mails.push({ ...base, headerMessageId: `alt-ungelesen${i}@x`, date: day(400 + i), subject: `Rechnung alt ${i}`, body: "Ihre Rechnung", isRead: false, hasAttachment: false });
  for (let i = 0; i < 2; i++) mails.push({ ...base, headerMessageId: `alt-anhang${i}@x`, date: day(500 + i), subject: `Rechnung PDF ${i}`, body: "Ihre Rechnung", isRead: true, hasAttachment: true });
  await repository.upsertMessages(db, caps, mails, +NOW);
  const go = (opts) => search(db, caps, "rechnung", { now: NOW, limit: 10, ...opts });

  it("ohne Filter: die neuesten 10, more = true", async () => {
    const r = await go({});
    expect(r.rows.length).toBe(10);
    expect(r.more).toBe(true);
  });

  it("ungelesen: auch die alten ungelesenen (lagen hinter der Höchstzahl), more = false", async () => {
    const r = await go({ filters: { unread: true } });
    expect(r.rows.map((x) => x.header_msg_id).sort()).toEqual(["alt-ungelesen0@x", "alt-ungelesen1@x", "alt-ungelesen2@x"]);
    expect(r.more).toBe(false);
  });

  it("Anhang: die alten mit Anhang", async () => {
    const r = await go({ filters: { attachment: true } });
    expect(r.rows.map((x) => x.header_msg_id).sort()).toEqual(["alt-anhang0@x", "alt-anhang1@x"]);
  });

  it("Zeitraum: nur ab dateFrom, Chips bleiben ohne Filter", async () => {
    const r = await go({ filters: { dateFrom: day(5) } });
    expect(r.rows.length).toBe(5);
    expect(r.chips.some((c) => /date|seit/i.test(c.kind ?? ""))).toBe(false);
  });

  it("„Beste zuerst“ nimmt dieselben Filter", async () => {
    const r = await go({ sort: "best", filters: { unread: true } });
    expect(r.rows.every((x) => x.header_msg_id.startsWith("alt-ungelesen"))).toBe(true);
    expect(r.relevant.every((x) => x.header_msg_id.startsWith("alt-ungelesen"))).toBe(true);
  });

  it("ungültige Filter werden ignoriert, strengerer Zeitraum gewinnt", async () => {
    const r = await go({ filters: { unread: "ja", dateFrom: "x" } });
    expect(r.rows.length).toBe(10);
    const both = await search(db, caps, "rechnung seit:3t", { now: NOW, limit: 10, filters: { dateFrom: day(20) } });
    expect(both.rows.length).toBeLessThanOrEqual(3);
  });
});

describe("Tempo im großen Postfach: Kopien nach dem Sortieren, Absender-Index, „Beste zuerst“ nur mit Suchwort", async () => {
  const ctx = await setup();
  const { selectUnique } = await import("../src/search.js");

  it("Kopien über Seitengrenzen: je Message-ID eine Stelle, bevorzugt der Posteingang", async () => {
    // 3 Kopien je Nachricht, die im Posteingang zuletzt: muss die erste Stelle übernehmen
    const data = [];
    for (let i = 0; i < 200; i++) for (const t of ["archives", "other", "inbox"]) data.push({ header_msg_id: `n${i}`, folder_type: t, date: 1000 - i });
    const db = { calls: 0, async select(sql, [n, offset]) { this.calls++; return data.slice(offset, offset + n); } };
    const build = (n, offset) => ({ sql: "x", params: [n, offset], columns: [] });
    const r = await selectUnique(db, build, 150);
    expect(r.rows).toHaveLength(150);
    expect(new Set(r.rows.map((x) => x.header_msg_id)).size).toBe(150);
    expect(r.rows.every((x) => x.folder_type === "inbox")).toBe(true);
    expect(r.rows.map((x) => x.header_msg_id).slice(0, 3)).toEqual(["n0", "n1", "n2"]);
    expect(db.calls).toBe(2); // erste Seite (300 Zeilen) ergibt 100, die zweite reicht
    expect(r.cut).toBe(false);
    // Seitengrenze mitten in einer Nachricht: want 101 → Seite 202 = 67 Nachrichten + 1 Kopie von n67; deren Posteingang-Kopie
    // liegt auf der zweiten Seite und muss die erste Stelle übernehmen
    const r2 = await selectUnique({ async select(sql, [n, offset]) { return data.slice(offset, offset + n); } }, build, 101);
    expect(r2.rows).toHaveLength(101);
    expect(r2.rows[67]).toMatchObject({ header_msg_id: "n67", folder_type: "inbox" });
  });

  it("lauter Kopien: nach 5 Seiten Schluss, Liste gilt als gekürzt", async () => {
    const data = Array.from({ length: 5000 }, () => ({ header_msg_id: "gleich", folder_type: "other", date: 1 }));
    const db = { calls: 0, async select(sql, [n, offset]) { this.calls++; return data.slice(offset, offset + n); } };
    const r = await selectUnique(db, (n, offset) => ({ sql: "x", params: [n, offset], columns: [] }), 10);
    expect(r.rows).toHaveLength(1);
    expect(db.calls).toBe(5);
    expect(r.cut).toBe(true);
  });

  it("dedupe: false behält die Kopien (eine Abfrage)", async () => {
    const data = [{ header_msg_id: "a", folder_type: "inbox" }, { header_msg_id: "a", folder_type: "archives" }];
    const db = { async select(sql, [n, offset]) { return data.slice(offset, offset + n); } };
    const r = await selectUnique(db, (n, offset) => ({ sql: "x", params: [n, offset], columns: [] }), 5, true);
    expect(r.rows).toHaveLength(2);
  });

  it("migrate legt den Absender-Index an und meldet ihn", async () => {
    expect(ctx.caps.authorIndex).toBe(true);
    const rows = await ctx.db.select("SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'idx_messages_author_norm'", [], ["name"]);
    expect(rows).toHaveLength(1);
  });

  it("bestehender Index ohne Absender-Index: migrate legt ihn nicht an (Leerlauf), createAuthorIndex schon; Teilindex bleibt", async () => {
    const { createAuthorIndex, hasAuthorIndex } = await import("../src/search.js");
    const c2 = await setup();
    await c2.db.execute("DROP INDEX idx_messages_author_norm");
    const caps = await migrate(c2.db);
    expect(caps.authorIndex).toBe(false);
    expect(await hasAuthorIndex(c2.db)).toBe(false);
    // ohne Index: alter Weg (kein INDEXED BY, sonst Fehler) mit denselben Treffern
    expect(ids(await search(c2.db, caps, "von Jonas", { now: NOW, myEmails: ME }))).toEqual(["m1", "m2", "m3", "m4"]);
    expect(await createAuthorIndex(c2.db)).toBe(true);
    expect(await hasAuthorIndex(c2.db)).toBe(true);
    const partial = await c2.db.select("SELECT name FROM sqlite_master WHERE name = 'idx_messages_headers_only'", [], ["name"]);
    expect(partial).toHaveLength(1);
  });

  it("von:Name über den Absender-Index: dieselben Treffer wie über die Tabelle", async () => {
    for (const text of ["von Jonas", "von becker", "mit Petra", "von firma speiseplan"]) {
      const viaIndex = await run(ctx, text);
      const viaTable = await search(ctx.db, { ...ctx.caps, authorIndex: false }, text, { now: NOW, myEmails: ME });
      expect(ids(viaIndex), text).toEqual(ids(viaTable));
    }
    const sql = buildSearchSql(parseQuery("von:jonas"), ctx.caps, {}).sql;
    expect(sql).toContain("m.id IN (SELECT rowid FROM messages WHERE author_norm LIKE ?");
    expect(buildSearchSql(parseQuery("von:jonas"), { ...ctx.caps, authorIndex: false }, {}).sql).toContain("m.author_norm LIKE ?");
  });

  it("„Beste zuerst“ ohne Suchwort: keine zweite Abfrage, mit Suchwort schon", async () => {
    let selects = 0;
    let ranked = 0;
    const db = { ...ctx.db, async select(sql, ...a) { selects++; if (sql.includes("WITH ranked")) ranked++; return ctx.db.select(sql, ...a); } };
    await search(db, ctx.caps, "von Jonas", { now: NOW, myEmails: ME, sort: "date" });
    const dateSelects = selects;
    selects = 0;
    const plain = await search(db, ctx.caps, "von Jonas", { now: NOW, myEmails: ME, sort: "best" });
    expect(plain.rows.length).toBeGreaterThan(0);
    expect(plain.relevant).toEqual([]);
    expect(selects).toBe(dateSelects); // genauso viele Abfragen wie nach Datum: keine zweite
    await search(db, ctx.caps, "speiseplan", { now: NOW, myEmails: ME, sort: "best" });
    expect(ranked).toBe(1);
  });

  it("offset überspringt erst nach dem Entfernen der Kopien", async () => {
    const all = await run(ctx, "speiseplan");
    for (const offset of [1, 2]) {
      const rest = await run(ctx, "speiseplan", { offset });
      expect(rest.rows.map((x) => x.header_msg_id), `offset ${offset}`).toEqual(all.rows.slice(offset).map((x) => x.header_msg_id));
    }
    expect(all.rows.length).toBeGreaterThan(2);
  });
});
