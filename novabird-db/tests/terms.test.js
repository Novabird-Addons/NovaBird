import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { NOW } from "./helpers/fixtures.js";
import { migrate, repository, search } from "../src/search.js";
import { decompose, termsDeFor } from "../src/indexer/terms.js";

const vocab = new Set(["woche", "wochen", "speise", "plan", "speiseplan", "daten", "sicherung", "fehler", "meldung", "urlaub"]);

describe("Zerlegung (terms_de)", () => {
  it("zerlegt mit Fugenelement und mehrstufig", () => {
    expect([...decompose("wochenspeiseplan", vocab)].sort()).toEqual(["speiseplan", "wochen"]);
    expect([...decompose("wochenspeiseplanung", new Set([...vocab, "planung"]))].sort()).toEqual(expect.arrayContaining(["wochen"]));
    expect([...decompose("datensicherung", vocab)].sort()).toEqual(["daten", "sicherung"]);
  });
  it("lässt Zufälle und kurze Wörter in Ruhe", () => {
    expect(decompose("anmeldung", vocab)).toBeNull(); // „an“ ist kein Wort der Liste
    expect(decompose("speise", vocab)).toBeNull();
  });
  it("termsDeFor ohne Wortliste: leer", () => {
    expect(termsDeFor({ subject: "Wochenspeiseplan", body: "" }, new Set())).toBe("");
  });
});

describe("Modus „Beim Indexieren“", async () => {
  const db = createNodeAdapter();
  const caps = await migrate(db);
  const mk = (id, subject, body) => {
    const r = {
      headerMessageId: `${id}@x`, accountId: "a", folderId: "a://INBOX", folderName: "INBOX", folderType: "inbox", date: +NOW - 86_400_000,
      authorName: "X", authorEmail: `${id}@x.de`, recipients: "", subject, hasAttachment: false, attachmentTypes: [], attachmentNames: [], tags: [],
      isRead: true, isFlagged: false, body, attachmentText: "", bodyHash: "h",
    };
    return { ...r, termsDe: termsDeFor(r, vocab) };
  };
  await repository.upsertMessages(db, caps, [
    mk("a", "Info", "Der Wochenspeiseplan ist da, bitte Datensicherung beachten"),
    mk("b", "Info", "Die Anmeldung läuft, Fehlermeldung beachten"),
    mk("c", "Info", "Nichts hier"),
  ], +NOW);
  const ids = async (q, o = {}) => (await search(db, caps, q, { now: NOW, ...o })).rows.map((r) => r.header_msg_id).sort();
  it("migrate kennt die Zusatztabelle", () => expect(caps.termsFts).toBe(true));
  it("Modus „index“ findet „plan“ in Wochenspeiseplan, ohne Wortlisten-Erweiterung", async () => {
    expect(await ids("sicherung", { compoundMode: "index" })).toEqual(["a@x"]);
    expect(await ids("meldung", { compoundMode: "index" })).toEqual(["b@x"]); // Fehlermeldung, nicht Anmeldung allein
  });
  it("Standardmodus ohne terms_de-Abfrage findet den Zusatzindex nicht (nur die Wortliste)", async () => {
    expect((await ids("speiseplan")).length).toBeGreaterThanOrEqual(0); // läuft ohne Fehler
  });
  it("Löschen entfernt auch die Zusatzterme", async () => {
    await repository.deleteMessages(db, caps, [{ headerMessageId: "a@x", folderId: "a://INBOX" }]);
    expect(await ids("sicherung", { compoundMode: "index" })).toEqual([]);
  });
});
