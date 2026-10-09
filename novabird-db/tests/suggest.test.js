import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { MESSAGES, NOW } from "./helpers/fixtures.js";
import { migrate, repository, search, editDistance } from "../src/search.js";

async function setup(mode) {
  const db = createNodeAdapter();
  const caps = await migrate(db, { forceMode: mode });
  await repository.upsertMessages(db, caps, MESSAGES, +NOW);
  return { db, caps };
}

describe("Editierdistanz", () => {
  it("zählt Einfügen, Löschen, Ersetzen und Vertauschen je 1", () => {
    expect(editDistance("speiseplan", "speisepaln")).toBe(1);
    expect(editDistance("speiseplan", "speiseplna")).toBe(1);
    expect(editDistance("speiseplan", "speiseplane")).toBe(1);
    expect(editDistance("speiseplan", "speisepln")).toBe(1);
    expect(editDistance("speiseplan", "stundenplan", 2)).toBeGreaterThan(2);
  });
});

describe("Tippfehler-Vorschläge (FTS5)", async () => {
  const ctx = await setup();
  const run = (text) => search(ctx.db, ctx.caps, text, { now: NOW });

  it("schlägt bei 0 Treffern ein ähnliches Wort aus dem Index vor", async () => {
    const r = await run("speisepaln");
    expect(r.rows).toHaveLength(0);
    expect(r.suggest?.text).toBe("speiseplan");
    expect(r.suggest.words[0].options).toContain("speiseplan");
  });
  it("ersetzt nur das falsche Wort und behält den Rest der Anfrage", async () => {
    const r = await run("speisepaln von Jonas");
    expect(r.suggest?.text).toBe("speiseplan von Jonas");
  });
  it("kein Vorschlag, wenn es Treffer gibt oder das Wort existiert", async () => {
    expect((await run("speiseplan")).suggest).toBeNull();
    expect((await run("xyzqwk")).suggest).toBeNull(); // nichts Ähnliches im Index
  });
  it("kein Vorschlag bei sehr kurzen Wörtern", async () => {
    expect((await run("dpl")).suggest).toBeNull();
  });
});

describe("Tippfehler-Vorschläge im FTS4-Rückfall", async () => {
  it("liefert keinen Vorschlag (keine Wortliste)", async () => {
    const ctx = await setup("fts4");
    const r = await search(ctx.db, ctx.caps, "speisepaln", { now: NOW });
    expect(r.suggest).toBeNull();
  });
});
