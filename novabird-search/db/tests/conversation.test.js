import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { createFakeMessenger } from "./helpers/fake-messenger.js";
import { migrate } from "../src/db/schema.js";
import * as repo from "../src/db/repository.js";
import { Indexer } from "../src/indexer/indexer.js";
import { toRecord, subjectKey, normalizeRefs, snippetOf } from "../src/indexer/record.js";
import { findConversation, chainIds, MAX_COMPONENT } from "../src/query/conversation.js";

const silent = { error: () => {}, warn: () => {}, info: () => {} };
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 8, 1, 10);

async function setup() {
  const db = createNodeAdapter();
  const caps = await migrate(db);
  let n = 0;
  /** Nachricht anlegen: mid, refs, subject, Tage ab T0, Ordner, Absender/Empfänger */
  const add = async (mid, { refs = [], subject = "Plan", day = 0, folderType = "inbox", folderId = "a:/INBOX", from = "jonas@x.example", to = "ich@x.example", attachments = [] } = {}) => {
    const rec = toRecord(
      { headerMessageId: mid, subject, author: `Jonas <${from}>`, recipients: [to], ccList: [], date: new Date(T0 + day * DAY), read: false, flagged: false, tags: [], folder: { id: folderId, accountId: "a", path: folderId.split(":")[1], name: folderId.split("/").pop() || "INBOX", specialUse: folderType ? [folderType] : [] } },
      { content: { plain: `Text ${mid}` }, attachments, refs },
    );
    await repo.upsertMessages(db, caps, [rec], 1000 + n++);
  };
  const ids = async (opts) => (await findConversation(db, opts)).messages.map((m) => m.headerMessageId);
  return { db, caps, add, ids };
}

describe("Hilfsfunktionen", () => {
  it("subjectKey entfernt Antwortpräfixe, auch verschachtelt und mit [n]", () => {
    expect(subjectKey("Re: AW: Speiseplan  Oktober")).toBe("speiseplan oktober");
    expect(subjectKey("WG[2]: Fwd: SV: tr: RV: Hallo")).toBe("hallo");
    expect(subjectKey("Antw: Rechnung")).toBe("rechnung");
    expect(subjectKey("Review: Angebot")).toBe("review: angebot"); // kein Präfix
    expect(subjectKey("")).toBe("");
  });

  it("normalizeRefs: ohne <>, Duplikate, eigene ID, kaputte und zu lange Werte", () => {
    expect(normalizeRefs(["<a@x> <b@x>", "<a@x>", "c@x d@x"], "own@x")).toEqual(["a@x", "b@x", "c@x", "d@x"]);
    expect(normalizeRefs(["<own@x>", "", "  ", "<>"], "own@x")).toEqual([]);
    expect(normalizeRefs(["x".repeat(300) + "@y"])).toEqual([]);
    expect(normalizeRefs(undefined)).toEqual([]);
    expect(normalizeRefs(Array.from({ length: 300 }, (_, i) => `<m${i}@x>`)).length).toBe(100);
    // Folded Header: Zeilenumbruch zwischen den IDs
    expect(normalizeRefs(["<a@x>\r\n <b@x>"])).toEqual(["a@x", "b@x"]);
  });

  it("snippetOf: Leerraum zusammenfassen, höchstens 200 Zeichen, kein halbes Surrogat", () => {
    expect(snippetOf("Hallo\n\n  Welt")).toBe("Hallo Welt");
    expect(snippetOf("a".repeat(500)).length).toBe(200);
    const s = snippetOf("a".repeat(199) + "😀😀");
    expect([...s].every((c) => c.codePointAt(0) < 0xd800 || c.codePointAt(0) > 0xdfff)).toBe(true);
    expect(snippetOf(undefined)).toBe("");
  });

  it("toRecord: Snippet ohne Zitate, Betreff-Schlüssel, Verweise nur wenn bekannt", () => {
    const header = { headerMessageId: "m1@x", subject: "AW: Test", author: "A <a@x.de>", recipients: [], date: new Date(T0), folder: { id: "f", accountId: "a", name: "F" } };
    const r = toRecord(header, { content: { plain: "Neue Zeile.\n> altes Zitat\n" }, refs: ["<p@x>"] });
    expect(r.snippet).toBe("Neue Zeile.");
    expect(r.subjectKey).toBe("test");
    expect(r.refs).toEqual(["p@x"]);
    expect(toRecord(header, {}).refs).toBeUndefined();
  });
});

describe("Speicherung der Verweise", () => {
  it("schreibt, ersetzt und räumt beim Löschen auf (nur wenn keine Kopie bleibt)", async () => {
    const { db, caps, add } = await setup();
    const count = async () => (await db.select("SELECT COUNT(*) FROM message_refs", [], ["n"]))[0].n;
    await add("b@x", { refs: ["a@x", "z@x"] });
    expect(await count()).toBe(2);
    await add("b@x", { refs: ["a@x"] }); // neu indiziert: ersetzt
    expect(await count()).toBe(1);
    await add("b@x", { refs: ["a@x"], folderId: "a:/Archiv" }); // zweite Kopie in anderem Ordner
    expect(await count()).toBe(1);
    await repo.deleteMessages(db, caps, [{ headerMessageId: "b@x", folderId: "a:/INBOX" }]);
    expect(await count()).toBe(1); // Kopie im Archiv bleibt
    await repo.deleteMessages(db, caps, [{ headerMessageId: "b@x", folderId: "a:/Archiv" }]);
    expect(await count()).toBe(0);
  });

  it("deleteFolder entfernt verwaiste Verweise", async () => {
    const { db, caps, add } = await setup();
    await add("b@x", { refs: ["a@x"] });
    await add("c@x", { refs: ["b@x"], folderId: "a:/Anderer" });
    await repo.deleteFolder(db, caps, "a:/INBOX");
    const rows = await db.select("SELECT header_msg_id FROM message_refs", [], ["h"]);
    expect(rows.map((r) => r.h)).toEqual(["c@x"]);
  });

  it("Indexer liest Verweise über die Experiment-Funktion; ohne Funktion bleiben vorhandene Verweise", async () => {
    const db = createNodeAdapter();
    const caps = await migrate(db);
    const fake = createFakeMessenger();
    const m1 = fake.addMessage("inbox", { subject: "Start", headerMessageId: "m1@x" });
    const m2 = fake.addMessage("inbox", { subject: "AW: Start", headerMessageId: "m2@x" });
    fake.api.novabirdDb = { references: async (ids) => ids.map((id) => (id === m2.id ? ["m1@x"] : [])) };
    const indexer = new Indexer({ db, caps, api: fake.api, pauseMs: 0, batchSize: 2, log: silent });
    await indexer.fullRun();
    const r = await db.select("SELECT header_msg_id, ref_id FROM message_refs", [], ["h", "r"]);
    expect(r).toEqual([{ h: "m2@x", r: "m1@x" }]);
    const conv = await findConversation(db, { headerMessageId: "m1@x" });
    expect(conv.messages.map((m) => m.headerMessageId)).toEqual(["m1@x", "m2@x"]);
    // zweiter Lauf ohne Funktion: vorhandene Verweise bleiben
    delete fake.api.novabirdDb;
    fake.addMessage("inbox", { subject: "Neu", headerMessageId: "m3@x" });
    await indexer.fullRun({ force: true });
    expect((await db.select("SELECT COUNT(*) FROM message_refs", [], ["n"]))[0].n).toBe(1);
  });
});

describe("Konversationsabfrage", () => {
  it("Kette über mehrere Stufen (jede Mail verweist auf alle Vorgänger), aufsteigend nach Datum", async () => {
    const { add, ids } = await setup();
    await add("t0@x", { day: 0, subject: "Thema" });
    await add("t1@x", { day: 1, subject: "Re: Thema", refs: ["t0@x"] });
    await add("t2@x", { day: 2, subject: "AW: Thema", refs: ["t0@x", "t1@x"] });
    await add("fremd@x", { day: 1, subject: "Anderes" });
    expect(await ids({ headerMessageId: "t1@x", fallback: "off" })).toEqual(["t0@x", "t1@x", "t2@x"]);
    expect(await ids({ headerMessageId: "t2@x", fallback: "off" })).toEqual(["t0@x", "t1@x", "t2@x"]);
  });

  it("fehlende Elternmail verbindet Geschwister; Verweis auf Unbekanntes zählt nicht als Kette", async () => {
    const { add, ids } = await setup();
    await add("k1@x", { day: 0, subject: "Frage", refs: ["fehlt@x"] });
    await add("k2@x", { day: 1, subject: "Frage 2", refs: ["fehlt@x"] });
    expect(await ids({ headerMessageId: "k1@x", fallback: "off" })).toEqual(["k1@x", "k2@x"]);
    const { add: add2, ids: ids2 } = await setup();
    await add2("e1@x", { day: 0, subject: "Allein", refs: ["fehlt@x"] });
    await add2("e2@x", { day: 3, subject: "Re: Allein" });
    // nur eine Mail der Kette im Index -> Betreff-Ersatz greift
    expect(await ids2({ headerMessageId: "e1@x", fallback: "subject" })).toEqual(["e1@x", "e2@x"]);
    expect(await ids2({ headerMessageId: "e1@x", fallback: "off" })).toEqual(["e1@x"]);
  });

  it("Betreff-Ersatz: subject, smart (Zeitfenster, Beteiligte), nicht bei vorhandener Kette", async () => {
    const { add, ids } = await setup();
    await add("s1@x", { day: 0, subject: "Rechnung" });
    await add("s2@x", { day: 10, subject: "AW: Rechnung" });
    await add("s3@x", { day: 100, subject: "WG: Rechnung" });
    await add("s4@x", { day: 12, subject: "Rechnung", from: "fremd@y.example", to: "andere@y.example" });
    expect(await ids({ headerMessageId: "s1@x", fallback: "subject" })).toEqual(["s1@x", "s2@x", "s4@x", "s3@x"]);
    expect(await ids({ headerMessageId: "s1@x", fallback: "smart", fallbackDays: 30, fallbackPeople: true })).toEqual(["s1@x", "s2@x"]);
    expect(await ids({ headerMessageId: "s1@x", fallback: "smart", fallbackDays: 30, fallbackPeople: false })).toEqual(["s1@x", "s2@x", "s4@x"]);
    // mit Kette kein Ersatz
    await add("c1@x", { day: 0, subject: "Kette" });
    await add("c2@x", { day: 1, subject: "Re: Kette", refs: ["c1@x"] });
    await add("c3@x", { day: 2, subject: "Kette" }); // gleicher Betreff, aber ohne Verbindung
    expect(await ids({ headerMessageId: "c1@x", fallback: "subject" })).toEqual(["c1@x", "c2@x"]);
  });

  it("Papierkorb/Spam raus, außer die Zielnachricht selbst", async () => {
    const { add, ids } = await setup();
    await add("p1@x", { day: 0, subject: "Mail" });
    await add("p2@x", { day: 1, subject: "Re: Mail", refs: ["p1@x"], folderType: "trash", folderId: "a:/Trash" });
    await add("p3@x", { day: 2, subject: "Re: Mail", refs: ["p1@x"], folderType: "junk", folderId: "a:/Junk" });
    expect(await ids({ headerMessageId: "p1@x" })).toEqual(["p1@x"]);
    expect(await ids({ headerMessageId: "p2@x" })).toEqual(["p1@x", "p2@x"]); // Ziel im Papierkorb
  });

  it("dieselbe Message-ID in mehreren Ordnern: alle Zeilen; Ziel-Ordner wählbar", async () => {
    const { add, db } = await setup();
    await add("d1@x", { day: 0, subject: "Doppelt" });
    await add("d1@x", { day: 0, subject: "Doppelt", folderId: "a:/Archiv" });
    const res = await findConversation(db, { headerMessageId: "d1@x", fallback: "off" });
    expect(res.messages.map((m) => m.folderId).sort()).toEqual(["a:/Archiv", "a:/INBOX"]);
  });

  it("unbekannte Nachricht und leere ID liefern leere Liste", async () => {
    const { db } = await setup();
    expect(await findConversation(db, { headerMessageId: "gibtsnicht@x" })).toMatchObject({ ok: true, messages: [] });
    expect(await findConversation(db, { headerMessageId: "" })).toMatchObject({ ok: true, messages: [] });
  });

  it("Felder, Anhangsnamen, Snippet; limit liefert die neuesten und meldet truncated", async () => {
    const { add, db } = await setup();
    await add("l0@x", { day: 0, subject: "Lang", attachments: [{ name: "a.pdf", contentType: "application/pdf" }, { name: "b.xlsx" }] });
    for (let i = 1; i <= 5; i++) await add(`l${i}@x`, { day: i, subject: "Re: Lang", refs: ["l0@x"] });
    const res = await findConversation(db, { headerMessageId: "l0@x", limit: 3 });
    expect(res.truncated).toBe(true);
    expect(res.messages.map((m) => m.headerMessageId)).toEqual(["l3@x", "l4@x", "l5@x"]);
    const full = await findConversation(db, { headerMessageId: "l0@x" });
    const first = full.messages[0];
    expect(first).toMatchObject({ hasAttachment: true, attachmentNames: ["a.pdf", "b.xlsx"], authorEmail: "jonas@x.example", isRead: false, snippet: "Text l0@x", subject: "Lang" });
    expect(full.indexedAt).toBeGreaterThan(0);
  });

  it("Sammelverweis: Kette wird bei MAX_COMPONENT gekappt, Abfrage bleibt schnell", async () => {
    const { add, db } = await setup();
    await add("hub@x", { day: 0, subject: "Sammelmail" });
    const statements = [];
    for (let i = 0; i < MAX_COMPONENT + 200; i++) statements.push({ sql: "INSERT INTO message_refs (header_msg_id, ref_id) VALUES (?, ?)", params: [`kind${i}@x`, "hub@x"] });
    await db.batch(statements);
    const ids = await chainIds(db, "hub@x");
    expect(ids.length).toBeLessThanOrEqual(MAX_COMPONENT + 1);
  });
});
