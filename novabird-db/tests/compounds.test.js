import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { NOW } from "./helpers/fixtures.js";
import { migrate, repository, search, compoundsOf } from "../src/search.js";

const mk = (id, subject, body) => ({
  headerMessageId: `${id}@x`, accountId: "a", folderId: "a://INBOX", folderName: "INBOX", folderType: "inbox", date: +NOW - Number(id.replace(/\D/g, "") || 1) * 86_400_000,
  authorName: "X", authorEmail: "x@x.de", recipients: "", subject, hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [],
  isRead: true, isFlagged: false, body, attachmentText: "", bodyHash: "h",
});

async function setup(mode) {
  const db = createNodeAdapter();
  const caps = await migrate(db, { forceMode: mode });
  await repository.upsertMessages(db, caps, [
    mk("m1", "Info", "Das neue Wochenspeiseplan Update liegt vor"),
    mk("m2", "Info", "Der Wochenspeiseplan wurde geändert"),
    mk("m3", "Hinweis", "Bitte den Speiseplan beachten"),
    mk("m4", "Hinweis", "Nichts zu sehen hier"),
    mk("m5", "Hinweis", "Die Notspeiseplanänderung ist da"),
    mk("m6", "Hinweis", "Notspeiseplanänderung bitte prüfen"),
    // Vorsätze müssen als eigene Wörter vorkommen (Wortliste lernt aus den Mails)
    mk("m7", "Woche", "Diese Woche und die Speise, die Notspeise. Wochen vergehen, Not ist da"),
    mk("m8", "Woche", "Nächste Woche Speise, Notspeise, Not am Mann, Wochen"),
    mk("m9", "Anmeldung", "Anmeldung am Portal; die Fehlermeldung ist da, der Fehler bleibt"),
    mk("m10", "Anmeldung", "Anmeldung nötig. Fehlermeldung beachten, Fehler melden, Meldung lesen"),
  ], +NOW);
  return { db, caps };
}

describe("Komposita im Mailtext (FTS5, Wortliste)", async () => {
  const ctx = await setup();
  it("compoundsOf liefert Wörter, die den Begriff in der Mitte oder am Ende enthalten", async () => {
    const c = await compoundsOf(ctx.db, "speiseplan");
    expect(c).toContain("wochenspeiseplan");
    expect(c).toContain("notspeiseplananderung");
    expect(c).not.toContain("speiseplan"); // nur Zusätze
  });
  it("findet Mails, in denen der Begriff nur Teil eines längeren Worts ist", async () => {
    const r = await search(ctx.db, ctx.caps, "speiseplan", { now: NOW });
    expect(r.rows.map((x) => x.header_msg_id).sort()).toEqual(["m1@x", "m2@x", "m3@x", "m5@x", "m6@x"]);
  });
  it("ergänzt nur echte Zusammensetzungen (Vorsatz ist ein Wort), kein Zufall wie „anmeldung“", async () => {
    const c = await compoundsOf(ctx.db, "meldung");
    expect(c).toContain("fehlermeldung");
    expect(c).not.toContain("anmeldung");
  });
  it("Chips zeigen weiter nur den eingegebenen Begriff", async () => {
    const r = await search(ctx.db, ctx.caps, "speiseplan", { now: NOW });
    expect(r.chips.map((c) => c.label)).toEqual(["speiseplan"]);
  });
  it("sehr kurze Begriffe (unter 4 Zeichen) werden nicht erweitert", async () => {
    expect(await compoundsOf(ctx.db, "dir")).toEqual([]);
  });
  it("ab 4 Zeichen: „plan“ ergänzt nur echte Zusammensetzungen mit bekanntem Vorsatz", async () => {
    const c = await compoundsOf(ctx.db, "plan");
    expect(c).toContain("wochenspeiseplan");
    expect(c).not.toContain("wochenspeiseplan_x");
  });
  it("Zwischenspeicher: zweiter Aufruf liest die Wortliste nicht noch einmal", async () => {
    const db = { ...ctx.db, calls: 0, select(...a) { this.calls++; return ctx.db.select(...a); } };
    await compoundsOf(db, "speiseplan");
    const n = db.calls;
    await compoundsOf(db, "speiseplan");
    expect(db.calls).toBe(n);
  });
});

describe("FTS4-Rückfall", async () => {
  it("bleibt bei Wortanfang-Suche (keine Wortliste)", async () => {
    const ctx = await setup("fts4");
    const r = await search(ctx.db, ctx.caps, "speiseplan", { now: NOW });
    expect(r.rows.map((x) => x.header_msg_id)).toEqual(["m3@x"]);
  });
});

describe("Eigene Wortliste (vocab_words) und Weitertippen: gleiche Ergebnisse, weniger Abfragen", async () => {
  const { refreshVocabWords, vocabWordsBuiltAt, clearCompoundCache, VOCAB_TABLE } = await import("../src/search.js");
  const ctx = await setup();
  const TERMS = ["speiseplan", "meldung", "plan", "speise", "woche", "fehlermeldung", "nichts", "notspeiseplan"];
  // Zählt Abfragen an die Wortliste (LIKE-Suche) über ein umhüllendes Datenbankobjekt
  const counting = () => {
    const db = { ...ctx.db, likes: 0, select(sql, ...a) { if (/LIKE/.test(sql)) this.likes++; return ctx.db.select(sql, ...a); } };
    return db;
  };

  it("vor dem Bauen: kein Zeitstempel; danach gesetzt", async () => {
    expect(await vocabWordsBuiltAt(ctx.db)).toBe(0);
    await refreshVocabWords(ctx.db);
    expect(await vocabWordsBuiltAt(ctx.db)).toBeGreaterThan(0);
  });

  it("Tabelle liefert für jeden Begriff dieselben Zusammensetzungen wie die Sicht", async () => {
    for (const t of TERMS) {
      clearCompoundCache();
      const view = await compoundsOf(ctx.db, t);
      clearCompoundCache();
      const table = await compoundsOf(ctx.db, t, { table: VOCAB_TABLE });
      expect(table, t).toEqual(view);
    }
  });

  it("Suche mit caps.vocabWords findet dieselben Mails wie ohne", async () => {
    for (const t of ["speiseplan", "meldung", "plan"]) {
      clearCompoundCache();
      const a = await search(ctx.db, ctx.caps, t, { now: NOW });
      clearCompoundCache();
      const b = await search(ctx.db, { ...ctx.caps, vocabWords: true }, t, { now: NOW });
      expect(b.rows.map((x) => x.header_msg_id), t).toEqual(a.rows.map((x) => x.header_msg_id));
    }
  });

  it("Weitertippen: jeder Tippstand gleich wie frisch abgefragt, aber nur EINE Suche in der Wortliste", async () => {
    clearCompoundCache();
    const db = counting();
    const steps = ["spei", "speis", "speise", "speisep", "speisepl", "speisepla", "speiseplan"];
    const typed = [];
    for (const s of steps) typed.push(await compoundsOf(db, s, { table: VOCAB_TABLE }));
    expect(db.likes).toBe(1);
    for (const [i, s] of steps.entries()) {
      clearCompoundCache();
      expect(typed[i], s).toEqual(await compoundsOf(ctx.db, s, { table: VOCAB_TABLE }));
    }
  });

  it("anderer Begriff (kein Weitertippen) fragt neu ab", async () => {
    clearCompoundCache();
    const db = counting();
    await compoundsOf(db, "speise", { table: VOCAB_TABLE });
    await compoundsOf(db, "meldung", { table: VOCAB_TABLE });
    expect(db.likes).toBe(2);
  });

  it("neue Mails erscheinen in der Tabelle erst nach dem Auffrischen (die Sicht sofort)", async () => {
    await repository.upsertMessages(ctx.db, ctx.caps, [
      mk("m11", "Info", "Der Sommerspeiseplan kommt"),
      mk("m12", "Info", "Sommerspeiseplan und Sommer"),
      mk("m13", "Info", "Sommer ist schön, Sommer bleibt"),
    ], +NOW);
    clearCompoundCache();
    expect(await compoundsOf(ctx.db, "speiseplan")).toContain("sommerspeiseplan");
    clearCompoundCache();
    expect(await compoundsOf(ctx.db, "speiseplan", { table: VOCAB_TABLE })).not.toContain("sommerspeiseplan");
    await refreshVocabWords(ctx.db);
    expect(await compoundsOf(ctx.db, "speiseplan", { table: VOCAB_TABLE })).toContain("sommerspeiseplan");
  });

  it("Auffrischen ist wiederholbar (keine doppelten Wörter)", async () => {
    await refreshVocabWords(ctx.db);
    await refreshVocabWords(ctx.db);
    const [a] = await ctx.db.select(`SELECT count(*) AS n FROM ${VOCAB_TABLE}`, [], ["n"]);
    const [b] = await ctx.db.select("SELECT count(*) AS n FROM messages_vocab WHERE doc >= 2", [], ["n"]);
    expect(a.n).toBe(b.n);
  });
});
