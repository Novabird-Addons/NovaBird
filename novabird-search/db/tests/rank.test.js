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

describe("Beste Treffer zuerst, danach nach Datum", async () => {
  const { splitBest, fuseBest, bestThenDate } = await import("../src/query/rank.js");
  const r = (id, score, age) => ({ header_msg_id: id, score, date: day(age) });

  it("splitBest: höchstens max, nur mindestens halb so gut wie der beste, ohne Wert keine", () => {
    const rel = [r("a", -20, 1), r("b", -15, 1), r("c", -11, 1), r("d", -6, 1), r("e", null, 1)];
    expect(splitBest(rel, { now: NOW }).map((x) => x.header_msg_id)).toEqual(["a", "b", "c"]);
    expect(splitBest(rel, { now: NOW, max: 2 }).map((x) => x.header_msg_id)).toEqual(["a", "b"]);
    expect(splitBest([r("x", null, 1)], { now: NOW })).toEqual([]);
  });

  it("bestThenDate: beste oben, Rest nach Datum; wenige Treffer oder kein Rest: ohne Trennung", () => {
    const all = [r("a", null, 9), r("b", null, 1), r("c", null, 5), r("d", null, 3), r("e", null, 2), r("f", null, 7)];
    const out = bestThenDate([all[0], all[2]], all);
    expect(out.rows.map((x) => x.header_msg_id)).toEqual(["a", "c", "b", "e", "d", "f"]);
    expect(out.bestIds).toEqual(["a", "c"]);
    expect(bestThenDate([all[0]], all.slice(0, 3)).bestIds).toEqual([]); // 3 Treffer: keine Trennung
    expect(bestThenDate(all, all).bestIds).toEqual([]); // alles „beste“: keine Linie
    expect(bestThenDate([], all).rows.map((x) => x.header_msg_id)).toEqual(["b", "e", "d", "c", "f", "a"]);
  });

  it("fuseBest: schwache Bedeutungstreffer kommen nicht nach oben, starke schon; beides zusammen zählt mehr", () => {
    const rel = [r("w1", -20, 1), r("w2", -18, 1), r("w3", -3, 1)];
    const sem = [{ header_msg_id: "s1", score: 0.62, date: day(1) }, { header_msg_id: "w2", score: 0.55, date: day(1) }, { header_msg_id: "s2", score: 0.35, date: day(1) }];
    const best = fuseBest(rel, sem, { now: NOW }).map((x) => x.header_msg_id);
    expect(best[0]).toBe("w2"); // Wort und Bedeutung
    expect(best).toContain("s1");
    expect(best).not.toContain("s2"); // unter der Schwelle
    expect(best).not.toContain("w3"); // schwacher Worttreffer
  });
});

describe("Suche mit sort: best", () => {
  it("genaues Wort vor Wortform; beste oben, dann nach Datum; bestIds", async () => {
    const db = createNodeAdapter();
    const caps = await migrate(db);
    const base = { accountId: "a", folderId: "inbox", folderName: "Inbox", folderType: "inbox", recipients: "x <x@example.invalid>", hasAttachment: false,
      attachmentTypes: [], attachmentNames: [], tags: [], isRead: true, isFlagged: false, attachmentText: "", authorName: "A", authorEmail: "a@example.invalid" };
    const m = (id, age, subject, body) => ({ ...base, headerMessageId: `${id}@example.invalid`, date: day(age), subject, body });
    const mails = [
      m("exact", 200, "Facture du mois", "Votre facture est disponible."),
      m("form", 10, "Facturation", "Informations sur la facturation."),
    ];
    for (let i = 0; i < 8; i++) mails.push(m(`n${i}`, i + 1, `Nouvelles ${i}`, `Bonjour, rien à voir. Voir aussi la facturation annuelle ${i}.`));
    await repository.upsertMessages(db, caps, mails, NOW);
    const res = await search(db, caps, "facture", { now: NOW, langs: ["fr"], sort: "best", limit: 100 });
    const ids = res.rows.map((x) => x.header_msg_id.split("@")[0]);
    expect(ids[0]).toBe("exact"); // ältere Mail mit genau dem Wort steht ganz oben
    expect(res.bestIds.length).toBeGreaterThan(0);
    expect(res.bestIds.length).toBeLessThan(ids.length);
    const rest = res.rows.slice(res.bestIds.length);
    expect(rest.map((x) => x.date)).toEqual([...rest.map((x) => x.date)].sort((a, b) => b - a)); // Rest nach Datum
    expect(new Set(ids).size).toBe(10);
    // sort: date bleibt wie bisher
    const byDate = await search(db, caps, "facture", { now: NOW, langs: ["fr"], sort: "date", limit: 100 });
    expect(byDate.bestIds).toEqual([]);
    expect(byDate.rows[0].header_msg_id.split("@")[0]).toBe("n0");
  });
});
