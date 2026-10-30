import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { NOW } from "./helpers/fixtures.js";
import { migrate, repository, search } from "../src/search.js";
import { foldDe, norm } from "../src/util/normalize.js";

describe("foldDe (wie Lucene GermanNormalization)", () => {
  it("macht alle Schreibweisen gleich", () => {
    const f = ["Grüße", "Grueße", "Gruesse", "Grüsse", "Grusse"].map(foldDe);
    expect(new Set(f).size).toBe(1);
    expect(foldDe("Müller")).toBe(foldDe("Mueller"));
    expect(foldDe("Straße")).toBe(foldDe("Strasse"));
    expect(foldDe("Köln")).toBe(foldDe("Koeln"));
    expect(foldDe("Bär")).toBe(foldDe("Baer"));
  });
  it("lässt „neue“, „Quelle“, „Feuer“ unverändert bzw. stabil", () => {
    expect(foldDe("neue")).toBe("neue");
    expect(foldDe("Quelle")).toBe("quelle");
    expect(foldDe("Café")).toBe("cafe");
  });
  it("norm = foldDe plus Leerraum", () => {
    expect(norm("  Grüße   aus  Zürich ")).toBe("grusse aus zurich");
  });
});

describe("Suche findet Umlaut-/ss-Varianten", async () => {
  const db = createNodeAdapter();
  const caps = await migrate(db);
  const mk = (id, subject, body, author = "X") => ({
    headerMessageId: `${id}@x`, accountId: "a", folderId: "a://INBOX", folderName: "INBOX", folderType: "inbox", date: +NOW - 86_400_000,
    authorName: author, authorEmail: `${id}@x.de`, recipients: "", subject, hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [],
    isRead: true, isFlagged: false, body, attachmentText: "", bodyHash: "h",
  });
  await repository.upsertMessages(db, caps, [
    mk("a", "Grüße aus Zürich", "Schöne Straße am See"),
    mk("b", "Gruesse aus Zuerich", "Schoene Strasse am See", "Hans Mueller"),
    mk("c", "Grueße", "nichts", "Anna Müller"),
    mk("d", "Etwas anderes", "neue Quelle"),
  ], +NOW);
  const ids = async (q) => (await search(db, caps, q, { now: NOW })).rows.map((r) => r.header_msg_id).sort();
  it("Grüße / Grueße / Gruesse", async () => {
    for (const q of ["Grüße", "Grueße", "Gruesse", "Grüsse"]) expect(await ids(q), q).toEqual(["a@x", "b@x", "c@x"]);
  });
  it("Zürich / Zuerich / Zurich", async () => {
    for (const q of ["Zürich", "Zuerich", "Zurich"]) expect(await ids(q), q).toEqual(["a@x", "b@x"]);
  });
  it("Straße / Strasse", async () => {
    for (const q of ["Straße", "Strasse"]) expect(await ids(q), q).toEqual(["a@x", "b@x"]);
  });
  it("Absender Müller / Mueller", async () => {
    for (const q of ["von Müller", "von Mueller"]) expect(await ids(q), q).toEqual(["b@x", "c@x"]);
  });
  it("neue Quelle bleibt auffindbar", async () => {
    expect(await ids("neue")).toEqual(["d@x"]);
    expect(await ids("quelle")).toEqual(["d@x"]);
  });
});

describe("Feldwahl (fields)", async () => {
  const db = createNodeAdapter();
  const caps = await migrate(db);
  const mk = (id, subject, body, author) => ({
    headerMessageId: `${id}@x`, accountId: "a", folderId: "a://INBOX", folderName: "INBOX", folderType: "inbox", date: +NOW - 86_400_000,
    authorName: author, authorEmail: `${id}@x.de`, recipients: "Firma <p@x.de>", subject, hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [],
    isRead: true, isFlagged: false, body, attachmentText: "", bodyHash: "h",
  });
  await repository.upsertMessages(db, caps, [
    mk("s", "Wartung Jonasen", "nichts", "Anna A"),
    mk("b", "Hallo", "Das sagte Jonasen gestern", "Anna B"),
    mk("f", "Hallo 2", "nichts", "Jonasen Meier"),
  ], +NOW);
  const ids = async (fields) => (await search(db, caps, "jonasen", { now: NOW, fields })).rows.map((r) => r.header_msg_id).sort();
  it("ohne Feldwahl: überall", async () => expect(await ids(null)).toEqual(["b@x", "f@x", "s@x"]));
  it("alle vier = überall", async () => expect(await ids(["from", "to", "subject", "body"])).toEqual(["b@x", "f@x", "s@x"]));
  it("nur Betreff", async () => expect(await ids(["subject"])).toEqual(["s@x"]));
  it("nur Nachricht", async () => expect(await ids(["body"])).toEqual(["b@x"]));
  it("nur Absender", async () => expect(await ids(["from"])).toEqual(["f@x"]));
  it("Absender + Betreff", async () => expect(await ids(["from", "subject"])).toEqual(["f@x", "s@x"]));
});

describe("Nur ein Ordner (folderId)", async () => {
  const db = createNodeAdapter();
  const caps = await migrate(db);
  const mk = (id, folderId, folderType) => ({
    headerMessageId: `${id}@x`, accountId: "a", folderId, folderName: folderId, folderType, date: +NOW - 86_400_000,
    authorName: "X", authorEmail: `${id}@x.de`, recipients: "", subject: "Datenschutz Hinweis", hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [],
    isRead: true, isFlagged: false, body: "text", attachmentText: "", bodyHash: "h",
  });
  await repository.upsertMessages(db, caps, [mk("a", "a://INBOX", "inbox"), mk("b", "a://Archiv", "archives"), mk("c", "a://Trash", "trash")], +NOW);
  const ids = async (o) => (await search(db, caps, "datenschutz", { now: NOW, ...o })).rows.map((r) => r.header_msg_id).sort();
  it("ohne folderId: alle außer Papierkorb", async () => expect(await ids({})).toEqual(["a@x", "b@x"]));
  it("mit folderId: nur dieser Ordner", async () => expect(await ids({ folderId: "a://Archiv" })).toEqual(["b@x"]));
  it("auch der Papierkorb selbst, wenn man dort sucht", async () => expect(await ids({ folderId: "a://Trash" })).toEqual(["c@x"]));
});
