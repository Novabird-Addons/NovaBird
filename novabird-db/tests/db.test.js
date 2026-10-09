import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { MESSAGES, NOW } from "./helpers/fixtures.js";
import { migrate, SCHEMA_VERSION } from "../src/db/schema.js";
import { detectCapabilities } from "../src/db/capabilities.js";
import * as repo from "../src/db/repository.js";

const MODES = [undefined, "fts5", "fts4"];

async function setup(mode) {
  const db = createNodeAdapter();
  const caps = await migrate(db, { forceMode: mode });
  await repo.upsertMessages(db, caps, MESSAGES, +NOW);
  return { db, caps };
}

const count = async (db, sql, params = []) => (await db.select(sql, params, ["n"]))[0].n;

describe("Fähigkeiten und Migration", () => {
  it("erkennt FTS5, Trigramm und contentless_delete im Test-SQLite", async () => {
    const caps = await detectCapabilities(createNodeAdapter());
    expect(caps).toMatchObject({ fts5: true, trigram: true, contentlessDelete: true, ftsMode: "fts5-contentless" });
  });

  it("Migration ist idempotent und speichert Version und Fähigkeiten", async () => {
    const db = createNodeAdapter();
    const caps1 = await migrate(db);
    const caps2 = await migrate(db);
    expect(caps2).toEqual(caps1);
    const rows = await db.select("SELECT value FROM meta WHERE key = 'schema_version'", [], ["v"]);
    expect(Number(rows[0].v)).toBe(SCHEMA_VERSION);
  });

  it("lehnt neueres Schema ab", async () => {
    const db = createNodeAdapter();
    await migrate(db);
    await db.execute("UPDATE meta SET value = '999' WHERE key = 'schema_version'");
    await expect(migrate(db)).rejects.toThrow(/neuer/);
  });
});

for (const mode of MODES) {
  describe(`Repository (${mode ?? "fts5-contentless"})`, () => {
    it("Upsert ist wiederholbar ohne Dubletten im Volltext", async () => {
      const { db, caps } = await setup(mode);
      await repo.upsertMessages(db, caps, MESSAGES);
      expect(await count(db, "SELECT COUNT(*) FROM messages")).toBe(MESSAGES.length);
      expect(await count(db, "SELECT COUNT(*) FROM messages WHERE id IN (SELECT rowid FROM messages_fts)")).toBe(MESSAGES.length);
      expect(await count(db, "SELECT COUNT(*) FROM (SELECT rowid FROM messages_fts)")).toBe(MESSAGES.length);
    });

    it("Neuindizierung ersetzt den Volltext", async () => {
      const { db, caps } = await setup(mode);
      const m = { ...MESSAGES[0], body: "Komplett neuer Inhalt Zebrastreifen" };
      await repo.upsertMessages(db, caps, [m]);
      expect(await count(db, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?", ["zebrastreifen"])).toBe(1);
      expect(await count(db, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?", ["nächsten"])).toBe(1); // nur noch Archiv-Kopie
    });

    it("Löschen entfernt Zeile und Volltext", async () => {
      const { db, caps } = await setup(mode);
      await repo.deleteMessages(db, caps, [{ headerMessageId: "m6@firma.example", folderId: "inbox" }]);
      expect(await count(db, "SELECT COUNT(*) FROM messages WHERE header_msg_id = 'm6@firma.example'")).toBe(0);
      expect(await count(db, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?", ["wartungsprotokoll"])).toBe(0);
    });

    it("Verschieben behält den Volltext und ersetzt Ziel-Dublette", async () => {
      const { db, caps } = await setup(mode);
      // m1 existiert in inbox und archive -> nach archive verschieben
      await repo.moveMessage(db, caps, "m1@firma.example", "inbox", { folderId: "archive", folderName: "Archiv", folderType: "archives", accountId: "account1" });
      const rows = await db.select("SELECT folder_id FROM messages WHERE header_msg_id = 'm1@firma.example'", [], ["f"]);
      expect(rows).toEqual([{ f: "archive" }]);
      expect(await count(db, "SELECT COUNT(*) FROM messages_fts WHERE messages_fts MATCH ?", ["anbei"])).toBeGreaterThan(0);
    });

    it("Flags aktualisieren", async () => {
      const { db } = await setup(mode);
      await repo.updateFlags(db, "m2@firma.example", "inbox", { isRead: true, tags: ["Erledigt"] });
      const [r] = await db.select("SELECT is_read, tags FROM messages WHERE header_msg_id = 'm2@firma.example'", [], ["r", "t"]);
      expect(r).toEqual({ r: 1, t: ",erledigt," });
    });

    it("bekannte IDs, Ordnerstatus, Ordner löschen, Waisen aufräumen", async () => {
      const { db, caps } = await setup(mode);
      const known = await repo.knownHeaderIds(db, "inbox", ["m1@firma.example", "gibt-es-nicht"]);
      expect([...known]).toEqual(["m1@firma.example"]);
      await repo.setFolderDone(db, "inbox");
      expect((await repo.folderStates(db)).get("inbox").done).toBe(1);
      await repo.deleteFolder(db, caps, "inbox");
      expect(await count(db, "SELECT COUNT(*) FROM messages WHERE folder_id = 'inbox'")).toBe(0);
      expect((await repo.folderStates(db)).has("inbox")).toBe(false);
      await repo.cleanupOrphans(db, caps);
      expect(await count(db, "SELECT COUNT(*) FROM (SELECT rowid FROM messages_fts)")).toBe(
        await count(db, "SELECT COUNT(*) FROM messages"),
      );
    });

    it("Statistik", async () => {
      const { db } = await setup(mode);
      const s = await repo.stats(db);
      expect(s.messages).toBe(MESSAGES.length);
    });
  });
}
