import { describe, expect, it } from "vitest";
import { rerank, recencyWeight } from "../src/query/rank.js";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { migrate, repository, search } from "../src/search.js";

const NOW = +new Date(2026, 9, 5);
const day = (n) => NOW - n * 86_400_000;

describe("Relevanz-Neuordnung", () => {
  it("neuere Mail gewinnt bei gleichem bm25-Wert", () => {
    const rows = [{ id: 1, score: -5, date: day(900) }, { id: 2, score: -5, date: day(2) }];
    expect(rerank(rows, NOW).map((r) => r.id)).toEqual([2, 1]);
  });
  it("deutlich besserer bm25-Wert schlägt Aktualität", () => {
    const rows = [{ id: 1, score: -12, date: day(900) }, { id: 2, score: -4, date: day(1) }];
    expect(rerank(rows, NOW).map((r) => r.id)).toEqual([1, 2]);
  });
  it("Zeilen ohne Wert stehen hinten, untereinander nach Datum", () => {
    const rows = [{ id: 1, score: null, date: day(5) }, { id: 2, score: null, date: day(1) }, { id: 3, score: -1, date: day(800) }];
    expect(rerank(rows, NOW).map((r) => r.id)).toEqual([3, 2, 1]);
  });
  it("Gewicht fällt mit dem Alter (Halbwertszeit ein Jahr)", () => {
    expect(recencyWeight(NOW, NOW)).toBeCloseTo(1.5, 5);
    expect(recencyWeight(day(365), NOW)).toBeCloseTo(1.25, 5);
  });
});

describe("Relevanz-Suche (FTS5)", () => {
  it("Betreff-Treffer steht vor Treffer nur im Text", async () => {
    const db = createNodeAdapter();
    const caps = await migrate(db);
    const mk = (id, subject, body, daysAgo) => ({
      headerMessageId: `${id}@x`, accountId: "a", folderId: "a://INBOX", folderName: "INBOX", folderType: "inbox", date: day(daysAgo),
      authorName: "X", authorEmail: "x@x.de", recipients: "", subject, hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [],
      isRead: true, isFlagged: false, body, attachmentText: "", bodyHash: "h",
    });
    await repository.upsertMessages(db, caps, [
      mk("a", "Allgemeine Info", "bitte die Rechnung prüfen", 1),
      mk("b", "Rechnung 4711", "anbei", 30),
    ], NOW);
    const r = await search(db, caps, "rechnung", { sort: "relevance", now: new Date(NOW) });
    expect(r.rows.map((x) => x.header_msg_id)).toEqual(["b@x", "a@x"]);
  });
});
