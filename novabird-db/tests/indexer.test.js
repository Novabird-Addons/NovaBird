import { describe, expect, it } from "vitest";
import { createNodeAdapter } from "./helpers/node-adapter.js";
import { createFakeMessenger } from "./helpers/fake-messenger.js";
import { migrate } from "../src/db/schema.js";
import { Indexer } from "../src/indexer/indexer.js";
import { search } from "../src/search.js";

const silent = { error: () => {}, warn: () => {}, info: () => {} };

async function setup(options = {}) {
  const db = createNodeAdapter();
  const caps = await migrate(db);
  const fake = createFakeMessenger();
  const indexer = new Indexer({ db, caps, api: fake.api, pauseMs: 0, batchSize: 2, log: silent, ...options });
  const count = async (where = "1") => (await db.select(`SELECT COUNT(*) FROM messages WHERE ${where}`, [], ["n"]))[0].n;
  return { db, caps, fake, indexer, count };
}

describe("Indexer (mit nachgebauter messenger-API)", () => {
  it("Erstlauf indiziert alle Ordner inkl. Unterordner, seitenweise", async () => {
    const { fake, indexer, count, db, caps } = await setup();
    for (let i = 0; i < 5; i++) fake.addMessage("inbox", { subject: `Speiseplan ${i}`, body: "Plan" });
    fake.addMessage("projekt", { subject: "Projektstand", body: "Wartung" });
    fake.addMessage("sent", { subject: "Antwort", body: "Danke" });
    await indexer.fullRun();
    expect(await count()).toBe(7);
    const r = await search(db, caps, "Projektstand");
    expect(r.rows[0].folder_name).toBe("Projekt");
  });

  it("Ausschlüsse greifen (z. B. Papierkorb)", async () => {
    const { fake, indexer, count } = await setup({ isExcluded: (f) => f.specialUse?.includes("trash") });
    fake.addMessage("trash", { subject: "Alt" });
    fake.addMessage("inbox", { subject: "Neu" });
    await indexer.fullRun();
    expect(await count()).toBe(1);
  });

  it("erledigte Ordner werden übersprungen, force indiziert nur Neues", async () => {
    const { fake, indexer, count } = await setup();
    fake.addMessage("inbox", { subject: "A" });
    fake.addMessage("inbox", { subject: "B" });
    await indexer.fullRun();
    const readsAfterFirst = fake.calls.listInlineTextParts;
    await indexer.fullRun(); // alles erledigt -> kein Lesen
    expect(fake.calls.listInlineTextParts).toBe(readsAfterFirst);
    fake.addMessage("inbox", { subject: "C" });
    await indexer.fullRun({ force: true }); // nur C wird gelesen
    expect(fake.calls.listInlineTextParts).toBe(readsAfterFirst + 1);
    expect(await count()).toBe(3);
  });

  it("Abbruch und Wiederaufnahme", async () => {
    let stopOnce = true;
    const { fake, indexer, count } = await setup({
      onProgress: (p) => {
        if (stopOnce && p.phase === "folder" && p.indexed >= 2) {
          stopOnce = false;
          indexer.stop();
        }
      },
    });
    for (let i = 0; i < 6; i++) fake.addMessage("inbox", { subject: `M${i}` });
    await indexer.fullRun();
    const partial = await count();
    expect(partial).toBeLessThan(6);
    await indexer.fullRun(); // Ordner war nicht "fertig" -> wird fortgesetzt
    expect(await count()).toBe(6);
  });

  it("Abgleich entfernt Mails, die es nicht mehr gibt", async () => {
    const { fake, indexer, count } = await setup();
    const a = fake.addMessage("inbox", { subject: "Bleibt" });
    const b = fake.addMessage("inbox", { subject: "Verschwindet" });
    await indexer.fullRun();
    fake.removeMessage("inbox", b);
    await indexer.fullRun({ force: true });
    expect(await count()).toBe(1);
    void a;
  });

  describe("Events", () => {
    it("neue Mail, Update, Verschieben, Löschen, Ordner gelöscht", async () => {
      const { fake, indexer, count, db } = await setup();
      await indexer.loadTagNames();
      indexer.attachListeners();
      const m = fake.api.messages;

      const h = fake.addMessage("inbox", { subject: "Speiseplan KW 41", body: "Frühstück" });
      await m.onNewMailReceived.fire(fake.folders.inbox, fake.makeList([h]));
      await indexer.queue;
      expect(await count()).toBe(1);

      await m.onUpdated.fire(h, { read: true, flagged: true, tags: ["$label1"] });
      await indexer.queue;
      const [row] = await db.select("SELECT is_read, is_flagged, tags FROM messages", [], ["r", "f", "t"]);
      expect(row).toEqual({ r: 1, f: 1, t: ",wichtig," });

      const moved = { ...h, id: 99, folder: fake.folders.projekt };
      await m.onMoved.fire(fake.makeList([h]), fake.makeList([moved]));
      await indexer.queue;
      expect(await count(`folder_id = '${fake.folders.projekt.id}'`)).toBe(1);
      expect(await count(`folder_id = '${fake.folders.inbox.id}'`)).toBe(0);

      const copy = { ...moved, id: 100, folder: fake.folders.inbox };
      await m.onCopied.fire(fake.makeList([moved]), fake.makeList([copy]));
      await indexer.queue;
      expect(await count()).toBe(2);

      await m.onDeleted.fire(fake.makeList([copy]));
      await indexer.queue;
      expect(await count()).toBe(1);

      await fake.api.folders.onDeleted.fire(fake.folders.projekt);
      await indexer.queue;
      expect(await count()).toBe(0);

      indexer.detachListeners();
      expect(m.onNewMailReceived.count).toBe(0);
    });

    it("Fehler bei einer Mail bricht den Lauf nicht ab", async () => {
      const { fake, indexer, count } = await setup();
      fake.addMessage("inbox", { subject: "gut" });
      const bad = fake.addMessage("inbox", { subject: "kaputt" });
      const orig = fake.api.messages.listInlineTextParts;
      fake.api.messages.listInlineTextParts = async (id) => {
        if (id === bad.id) throw new Error("Lesefehler");
        return orig(id);
      };
      await indexer.fullRun();
      expect(await count()).toBe(1);
    });
  });
});

describe("Nur lokal vorhandene Mails lesen (Offline-Flag)", () => {
  it("Mails ohne lokalen Text: nur Kopfdaten, kein Lesen; Text wird nachgeholt, sobald lokal", async () => {
    const { fake, indexer, count, db, caps } = await setup();
    const local = new Set();
    fake.api.novabirdDb = { offlineFlags: async (ids) => ids.map((id) => local.has(id)) };
    const a = fake.addMessage("inbox", { subject: "Lokale Mail", body: "Wartungsfenster" });
    const b = fake.addMessage("inbox", { subject: "Servermail", body: "Wartungsfenster" });
    local.add(a.id);

    await indexer.fullRun();
    expect(fake.calls.listInlineTextParts).toBe(1); // nur die lokale Mail wurde gelesen
    expect(await count()).toBe(2);
    // Text nur bei der lokalen Mail durchsuchbar, Betreff bei beiden
    expect((await search(db, caps, "Wartungsfenster")).rows.map((r) => r.subject)).toEqual(["Lokale Mail"]);
    expect((await search(db, caps, "Servermail")).rows.length).toBe(1);

    // zweiter Lauf, immer noch nicht lokal: nichts wird gelesen
    await indexer.fullRun();
    expect(fake.calls.listInlineTextParts).toBe(1);

    // Mail wird heruntergeladen -> nächster Lauf holt den Text nach
    local.add(b.id);
    await indexer.fullRun();
    expect(fake.calls.listInlineTextParts).toBe(2);
    expect((await search(db, caps, "Wartungsfenster")).rows.length).toBe(2);
  });
});

describe("Anhalten und parallel lesen", () => {
  it("Anhalten mitten im Lauf verliert nichts; der nächste Lauf setzt fort", async () => {
    let indexerRef;
    const { fake, indexer, count } = await setup({
      concurrency: 3,
      onProgress: (p) => {
        if (p.phase === "folder" && p.indexed >= 2) indexerRef?.stop();
      },
    });
    indexerRef = indexer;
    for (let i = 0; i < 12; i++) fake.addMessage("inbox", { subject: `Mail ${i}`, body: "Text" });
    await indexer.fullRun();
    const partial = await count();
    expect(partial).toBeGreaterThan(0);
    expect(partial).toBeLessThan(12);
    indexerRef = null;
    await indexer.fullRun(); // Ordner war nicht fertig -> wird fortgesetzt
    expect(await count()).toBe(12);
  });

  it("paralleles Lesen liefert dasselbe wie sequentielles", async () => {
    const a = await setup({ concurrency: 1 });
    const b = await setup({ concurrency: 6 });
    for (const ctx of [a, b]) for (let i = 0; i < 9; i++) ctx.fake.addMessage("inbox", { subject: `Plan ${i}`, body: `Text ${i}` });
    await a.indexer.fullRun();
    await b.indexer.fullRun();
    expect(await b.count()).toBe(await a.count());
  });
});


describe("Mails nachholen", () => {
  it("indiziert Mails, die die Ereignisse verpasst haben; Bekanntes bleibt unberührt", async () => {
    const { fake, indexer, count, db, caps } = await setup();
    fake.addMessage("inbox", { subject: "Alt eins", body: "x", date: new Date(2026, 8, 1) });
    fake.addMessage("sent", { subject: "Alt zwei", body: "y", date: new Date(2026, 8, 2) });
    await indexer.fullRun();
    expect(await count()).toBe(2);
    const reads = fake.calls.listInlineTextParts;
    // verpasst: kam bei geschlossenem Client an bzw. wurde serverseitig in den Projektordner sortiert
    fake.addMessage("inbox", { subject: "Verpasst Posteingang", body: "Wartungsfenster", date: new Date(2026, 8, 3) });
    fake.addMessage("projekt", { subject: "Verpasst Projekt", body: "Wartungsfenster", date: new Date(2026, 8, 3, 5) });
    const r = await indexer.catchUp({ now: +new Date(2026, 8, 4) });
    expect(r.added).toBe(2);
    expect(await count()).toBe(4);
    expect(fake.calls.listInlineTextParts).toBe(reads + 2); // nur die neuen wurden gelesen
    expect((await search(db, caps, "Wartungsfenster")).rows.length).toBe(2);
    // zweiter Lauf: nichts mehr zu tun
    expect((await indexer.catchUp({ now: +new Date(2026, 8, 4) })).added).toBe(0);
  });

  it("überspringt Konten ohne indizierte Mails (Sache des Erstlaufs)", async () => {
    const { fake, indexer, count } = await setup();
    fake.addMessage("inbox", { subject: "Neu", body: "x", date: new Date(2026, 8, 3) });
    expect((await indexer.catchUp({ now: +new Date(2026, 8, 4) })).added).toBe(0);
    expect(await count()).toBe(0);
  });
});

describe("Ordner abgleichen (rückwirkend einsortierte Mails)", () => {
  it("holt Mails mit altem Datum nach und entfernt verschwundene; unveränderte Ordner werden nicht angefasst", async () => {
    const { fake, indexer, count } = await setup();
    fake.addMessage("inbox", { subject: "Eins", body: "x", date: new Date(2026, 8, 1) });
    const gone = fake.addMessage("sent", { subject: "Zwei", body: "y", date: new Date(2026, 8, 2) });
    await indexer.fullRun();
    expect(await count()).toBe(2);
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0, added: 0 });
    // Server sortiert eine uralte Mail in den Projektordner, eine andere verschwindet aus „Gesendet“
    fake.addMessage("projekt", { subject: "Uralt einsortiert", body: "Vertrag", date: new Date(2020, 0, 5) });
    fake.removeMessage("sent", gone);
    const reads = fake.calls.listInlineTextParts;
    const r = await indexer.reconcile();
    expect(r).toMatchObject({ rescanned: 2, added: 1 });
    expect(fake.calls.listInlineTextParts).toBe(reads + 1);
    expect(await count()).toBe(2); // +1 neu, −1 entfernt
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0, added: 0 });
  });

  it("dauerhafte Abweichung (doppelte Message-ID) wird nicht bei jedem Abgleich neu gelesen und zeigt keine Fortschrittsanzeige", async () => {
    const events = [];
    const { fake, indexer } = await setup({ onProgress: (e) => events.push(e) });
    fake.addMessage("inbox", { subject: "A", body: "x", headerMessageId: "dup@x" });
    fake.addMessage("inbox", { subject: "A2", body: "x", headerMessageId: "dup@x" }); // zählt in Betterbird zweimal, im Index einmal
    await indexer.fullRun();
    const reads = fake.calls.listInlineTextParts;
    events.length = 0;
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0 });
    expect(fake.calls.listInlineTextParts).toBe(reads);
    fake.addMessage("inbox", { subject: "Neu alt", body: "y", date: new Date(2020, 1, 1) });
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 1 });
    expect(events).toEqual([]); // still im Hintergrund
  });

  it("erster Abgleich ohne gemerkte Zahlen: kleine Abweichung wird nur als Basiswert gemerkt, nicht gelesen", async () => {
    const { fake, indexer, db } = await setup();
    fake.addMessage("inbox", { subject: "A", body: "x", headerMessageId: "dup@x" });
    fake.addMessage("inbox", { subject: "A2", body: "x", headerMessageId: "dup@x" });
    await indexer.fullRun();
    await db.execute("DELETE FROM meta WHERE key = 'folder_totals'"); // wie nach einem Update von beta7
    const reads = fake.calls.listInlineTextParts;
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0 });
    expect(fake.calls.listInlineTextParts).toBe(reads);
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0 });
  });

  it("Tiefenvergleich findet auch Änderungen bei gleich gebliebener Mailzahl", async () => {
    const { fake, indexer, count } = await setup();
    const old = fake.addMessage("inbox", { subject: "Alt", body: "x", date: new Date(2026, 8, 1) });
    fake.addMessage("inbox", { subject: "Bleibt", body: "y", date: new Date(2026, 8, 2) });
    await indexer.fullRun();
    fake.removeMessage("inbox", old);
    fake.addMessage("inbox", { subject: "Neu einsortiert", body: "Rahmenvertrag", date: new Date(2020, 0, 1) });
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0 }); // Mailzahl gleich: normaler Abgleich merkt nichts
    expect(await indexer.reconcile({ deep: true })).toMatchObject({ rescanned: 4 }); // alle Ordner Mail für Mail geprüft: 1 neu, 1 entfernt
    expect(await count("subject = 'Neu einsortiert'")).toBe(1);
    expect(await count("subject = 'Alt'")).toBe(0);
  });
});

describe("Ordner ohne Offline-Speicher und virtuelle Ordner", () => {
  const withFlags = (fake, flags) => {
    fake.api.novabirdDb = {
      folderInfo: async (fs) => fs.map((f) => flags[f.path] ?? null),
      offlineFlags: async (ids) => ids.map(() => false),
    };
    const listed = [];
    const orig = fake.api.messages.list;
    fake.api.messages.list = async (id) => {
      listed.push(id);
      return orig(id);
    };
    return listed;
  };

  it("Kopfdaten reichen: Ordner wird fertig, wird nicht neu gelesen; virtuelle Ordner entfallen", async () => {
    const { fake, indexer, count, db } = await setup();
    const flags = { "/INBOX": { virtual: false, offline: false }, "/Sent": { virtual: false, offline: true }, "/Trash": { virtual: true, offline: true }, "/INBOX/Projekt": { virtual: true, offline: true } };
    const listed = withFlags(fake, flags);
    fake.addMessage("inbox", { subject: "Online Mail", body: "Geheimtext" });
    fake.addMessage("projekt", { subject: "Virtuell", body: "doppelt" });
    fake.addMessage("trash", { subject: "Virtuell 2", body: "doppelt" });
    await indexer.fullRun();
    expect(await count()).toBe(1); // nur die Online-Mail, ohne Text
    expect(fake.calls.listInlineTextParts).toBe(0);
    expect(listed).not.toContain("account1://INBOX/Projekt");
    const [st] = await db.select("SELECT done FROM index_state WHERE folder_id = ?", ["account1://INBOX"], ["done"]);
    expect(st.done).toBe(1);

    listed.length = 0;
    await indexer.fullRun(); // zweiter Start: Online-Ordner ist fertig, wird nicht gelesen
    expect(listed).not.toContain("account1://INBOX");
  });

  it("Abgleich und Tiefenabgleich lesen Online-Ordner bei neuer Mailzahl nicht komplett neu", async () => {
    const { fake, indexer } = await setup();
    const listed = withFlags(fake, { "/INBOX": { virtual: false, offline: false } });
    fake.addMessage("inbox", { subject: "Eins", body: "x" });
    await indexer.fullRun();
    fake.addMessage("inbox", { subject: "Zwei", body: "y", date: new Date(2020, 1, 1) });
    listed.length = 0;
    expect(await indexer.reconcile()).toMatchObject({ rescanned: 0 });
    await indexer.reconcile({ deep: true }); // übrige Ordner ohne Flags werden wie bisher gelesen
    expect(listed).not.toContain("account1://INBOX");
  });

  it("Offline-Speicher wird eingeschaltet: Ordner wird einmal neu gelesen, Text kommt in den Index", async () => {
    const { fake, indexer, db, caps } = await setup();
    const flags = { "/INBOX": { virtual: false, offline: false } };
    const listed = withFlags(fake, flags);
    const local = new Set();
    fake.api.novabirdDb.offlineFlags = async (ids) => ids.map((id) => local.has(id));
    const m = fake.addMessage("inbox", { subject: "Servermail", body: "Wartungsfenster" });
    await indexer.fullRun();
    expect((await search(db, caps, "Wartungsfenster")).rows.length).toBe(0);
    flags["/INBOX"] = { virtual: false, offline: true };
    local.add(m.id);
    listed.length = 0;
    await indexer.fullRun();
    expect(listed).toContain("account1://INBOX");
    expect((await search(db, caps, "Wartungsfenster")).rows.length).toBe(1);
  });
});
