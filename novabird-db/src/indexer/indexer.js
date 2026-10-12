// Indexer: liest Mails über die WebExtension-API und schreibt sie in den Index.
//
// STATUS: Logik vollständig, aber NOCH NICHT IN BETTERBIRD GETESTET.
// Die API-Aufrufe (messenger.*) sind gegen die Thunderbird-Doku geschrieben
// und müssen beim ersten Lauf geprüft werden (siehe ANLEITUNG.md, Schritt 3).
// Die Logik ist über eine injizierbare `api` in Node testbar (Fake-API in
// tests/indexer.test.js).
//
// Grundsätze:
// - Wiederaufnahme: Bereits indizierte Nachrichten werden übersprungen, ein
//   abgebrochener Lauf setzt also einfach erneut an.
// - Abgleich: Nach einem vollständigen Ordnerdurchlauf werden Einträge
//   entfernt, die es im Ordner nicht mehr gibt.
// - Alle Schreibvorgänge laufen über eine Warteschlange (keine Wettläufe
//   zwischen Erstlauf und Events).

import * as repo from "../db/repository.js";
import { folderIdOf, folderTypeOf, textFromParts, toRecord } from "./record.js";
import { termsDeFor } from "./terms.js";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPAIR_HINT = "Tipp: Zuerst den Ordner reparieren (Rechtsklick auf den Ordner → Eigenschaften → Ordner reparieren), dann den Index neu prüfen lassen.";

export class Indexer {
  /**
   * @param {object} o
   * @param o.db      Adapter
   * @param o.caps    Ergebnis von migrate()
   * @param o.api     messenger (Standard: globalThis.messenger)
   * @param o.batchSize      Nachrichten pro Transaktion
   * @param o.pauseMs        Pause zwischen Batches (UI bleibt bedienbar)
   * @param o.concurrency    Wie viele Mails gleichzeitig gelesen werden (Standard 1: der Engpass ist der Einzel-Thread von Betterbird, mehr bringt nichts)
   * @param o.isExcluded     (folder) => boolean  Konten/Ordner ausschließen
   * @param o.onProgress     ({ phase, folder, indexed, skipped, total }) => void
   * @param o.log            Logger (Standard: console)
   */
  constructor({ db, caps, api = globalThis.messenger, batchSize = 200, pauseMs = 50, concurrency = 1, isExcluded = () => false, onProgress = () => {}, log = console, termsVocab = () => null, limits = {}, debug = false }) {
    Object.assign(this, { termsVocab, db, caps, api, batchSize, pauseMs, concurrency: Math.max(1, Math.min(16, Math.round(concurrency) || 1)), isExcluded, onProgress, log });
    // Zeitgrenzen (ms): eine Mail ist normalerweise in unter 1 s gelesen; hängt etwas, geht es ohne die Mail weiter
    this.limits = { mail: 5000, step: 30_000, page: 60_000, stall: 30_000, watch: 10_000, stuck: 3, ...limits };
    this.debug = debug; // ausführliches Protokoll (Seiten, langsame Mails)
    this.cur = null; // aktueller Schritt für den Wächter
    this.timeoutsInRow = 0;
    this.queue = Promise.resolve();
    this.progress = { done: 0, total: null };
    this.stopped = false;
    this.tagNames = new Map();
    this.listeners = [];
  }

  /** Arbeit seriell ausführen. */
  enqueue(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch((e) => this.log.error("[novabird-db]", e));
    return run;
  }

  stop() {
    this.stopped = true;
  }

  // ---------------------------------------------------------------- Hilfen

  async loadTagNames() {
    const m = this.api.messages;
    const list = m.tags?.list ? await m.tags.list() : m.listTags ? await m.listTags() : [];
    this.tagNames = new Map(list.map((t) => [t.key, t.tag]));
  }

  /** Alle Ordner aller Konten (MV3: rootFolder.subFolders, MV2: account.folders). */
  async listFolders() {
    const accounts = await this.api.accounts.list(true);
    const out = [];
    const walk = (folders) => {
      for (const f of folders ?? []) {
        out.push(f);
        walk(f.subFolders);
      }
    };
    for (const a of accounts) {
      walk(a.rootFolder ? a.rootFolder.subFolders : a.folders);
    }
    return this.loadFolderInfo(out.filter((f) => !this.isExcluded(f)));
  }

  /**
   * Virtuelle Ordner (Sammel-/Suchordner) auslassen: ihre Mails liegen schon in den echten Ordnern.
   * Merkt außerdem je Ordner, ob Betterbird den Text lokal vorhält (this.folderInfo); ohne Experiment-Funktion
   * bleibt alles beim alten Verhalten.
   */
  async loadFolderInfo(folders) {
    this.folderInfo = new Map();
    const fn = this.api.novabirdDb?.folderInfo;
    if (!fn || !folders.length) return folders;
    let infos;
    try {
      infos = await fn(folders.map((f) => ({ accountId: f.accountId, path: f.path })));
    } catch (e) {
      this.log.warn("[novabird-db] Ordner-Flags nicht lesbar", e);
      return folders;
    }
    if (!Array.isArray(infos)) return folders;
    const out = [];
    folders.forEach((f, i) => {
      const info = infos[i];
      if (info) {
        this.folderInfo.set(folderIdOf(f), info);
        if (info.virtual) return;
      }
      out.push(f);
    });
    return out;
  }

  /** Ordner ohne Offline-Speicher: nur Kopfdaten, kein Nachrichtentext (wird nie lokal). */
  onlineOnly(fid) {
    return this.folderInfo?.get(fid)?.offline === false;
  }


  // ---------------------------------------------------------------- Zeitgrenzen und Wächter

  /** Promise mit Zeitgrenze; bei Überschreitung Fehler `timeout`. Der hängende Aufruf selbst lässt sich nicht abbrechen, sein Ergebnis wird ignoriert. */
  withTimeout(promise, ms, what) {
    let timer;
    const limit = new Promise((_, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Zeitgrenze (${ms} ms): ${what}`), { timeout: true })), ms);
    });
    return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
  }

  dbg(...a) {
    if (this.debug) this.log.info("[novabird-db] ·", ...a);
  }

  /** Aktuellen Schritt für den Wächter merken (und im Debug-Protokoll zeigen). */
  mark(step, extra = {}) {
    this.cur = { ...(this.cur ?? {}), step, since: Date.now(), ...extra };
  }

  /** Wächter für einen Ordner: meldet im Protokoll, wenn sich lange nichts bewegt (auch ohne Debug-Option). */
  watch(name) {
    this.cur = { folder: name, step: "Start", since: Date.now(), seen: 0 };
    let lastReport = 0;
    const timer = setInterval(() => {
      const c = this.cur;
      if (!c || this.stopped) return;
      const idle = Date.now() - c.since;
      if (idle >= this.limits.stall && Date.now() - lastReport >= this.limits.stall) {
        lastReport = Date.now();
        this.log.warn(`[novabird-db] Keine Fortschritte seit ${Math.round(idle / 1000)} s: Ordner „${c.folder}“, Schritt „${c.step}“, ${c.seen ?? 0} Mails gesehen. ${REPAIR_HINT}`);
      }
    }, this.limits.watch);
    return () => {
      clearInterval(timer);
      this.cur = null;
    };
  }

  /** Alle Header einer MessageList (inkl. Folgeseiten). */
  async *pages(list) {
    this.mark("Liste laden");
    let page = await this.withTimeout(Promise.resolve(list), this.limits.page, "Nachrichtenliste laden");
    let n = 0;
    while (page) {
      yield page.messages ?? [];
      if (!page.id) break;
      this.mark(`Seite ${++n + 1} laden`);
      page = await this.withTimeout(this.api.messages.continueList(page.id), this.limits.page, "nächste Seite der Nachrichtenliste");
    }
  }

  async readContent(id) {
    const m = this.api.messages;
    if (m.listInlineTextParts) {
      // Neuere Versionen: liefert nur die Textteile, ohne Anhänge zu laden
      const parts = await m.listInlineTextParts(id);
      const out = { plain: "", html: "" };
      for (const p of parts ?? []) {
        if (/text\/plain/i.test(p.contentType)) out.plain += (out.plain ? "\n" : "") + p.content;
        else if (/text\/html/i.test(p.contentType)) out.html += (out.html ? "\n" : "") + p.content;
      }
      return out;
    }
    return textFromParts(await m.getFull(id));
  }

  async readAttachments(id) {
    try {
      return (await this.api.messages.listAttachments(id)) ?? [];
    } catch (e) {
      this.log.warn("[novabird-db] listAttachments fehlgeschlagen", id, e);
      return [];
    }
  }

  /**
   * Welche dieser Nachrichten liegen lokal vor? Nur dann dürfen Text und Anhänge gelesen werden,
   * sonst lädt Betterbird jede Mail einzeln vom IMAP-Server. Ohne Experiment-Funktion: alle.
   */
  async offlineMap(headers) {
    const fn = this.api.novabirdDb?.offlineFlags;
    const map = new Map();
    if (!fn || !headers.length) {
      headers.forEach((h) => map.set(h.id, true));
      return map;
    }
    const flags = await fn(headers.map((h) => h.id));
    headers.forEach((h, i) => map.set(h.id, Boolean(flags[i])));
    return map;
  }

  /**
   * Verweise (References/In-Reply-To) der Nachrichten aus der Kopfdatenbank: Map Nachrichten-ID -> Liste (oder fehlt).
   * Ohne Experiment-Funktion bleibt die Map leer (dann werden vorhandene Verweise im Index nicht angefasst).
   */
  async refsMap(headers) {
    const fn = this.api.novabirdDb?.references;
    const map = new Map();
    if (!fn || !headers.length) return map;
    try {
      const lists = await fn(headers.map((h) => h.id));
      headers.forEach((h, i) => {
        if (Array.isArray(lists?.[i])) map.set(h.id, lists[i]);
      });
    } catch (e) {
      this.log.warn("[novabird-db] Verweise nicht lesbar", e);
    }
    return map;
  }

  async buildRecord(header, offline = true, refs = undefined) {
    const vocab = this.termsVocab?.();
    if (!offline) {
      // Nur Kopfdaten: Betreff, Absender, Datum usw. sind trotzdem durchsuchbar
      const rec = { ...toRecord(header, { tagNames: this.tagNames, refs }), bodyHash: repo.HEADERS_ONLY };
      if (vocab) rec.termsDe = termsDeFor(rec, vocab);
      return rec;
    }
    let content, attachments;
    const t0 = Date.now();
    try {
      [content, attachments] = await this.withTimeout(Promise.all([this.readContent(header.id), this.readAttachments(header.id)]), this.limits.mail, "Mail lesen");
      this.timeoutsInRow = 0;
      if (Date.now() - t0 > 1000) this.dbg(`langsame Mail (${Date.now() - t0} ms): „${String(header.subject ?? "").slice(0, 60)}“`);
    } catch (e) {
      if (!e.timeout) throw e;
      // Mail hängt: nur Kopfdaten übernehmen, damit der Lauf weitergeht
      this.timeoutsInRow++;
      this.log.warn(`[novabird-db] Mail nach ${this.limits.mail} ms übersprungen (nur Kopfdaten): „${String(header.subject ?? "").slice(0, 60)}“ (${header.headerMessageId ?? header.id})`);
      const rec = { ...toRecord(header, { tagNames: this.tagNames, refs }), bodyHash: repo.HEADERS_ONLY };
      if (vocab) rec.termsDe = termsDeFor(rec, vocab);
      return rec;
    }
    const rec = toRecord(header, { content, attachments, tagNames: this.tagNames, refs });
    if (vocab) rec.termsDe = termsDeFor(rec, vocab);
    return rec;
  }

  // ---------------------------------------------------------------- Erstlauf

  /** Vollständiger Lauf über alle Ordner; bereits erledigte werden übersprungen. */
  async fullRun({ force = false } = {}) {
    this.stopped = false;
    await this.loadTagNames();
    const folders = await this.listFolders();
    const states = await repo.folderStates(this.db);
    // Offline-Speicher eines Ordners umgestellt: einmal neu lesen (Texte holen bzw. nicht mehr erwarten)
    const flags = await repo.loadFolderOffline(this.db);
    const changed = new Set();
    for (const f of folders) {
      const fid = folderIdOf(f);
      const info = this.folderInfo?.get(fid);
      if (info && fid in flags && flags[fid] !== info.offline) {
        changed.add(fid);
        await repo.setFolderDone(this.db, fid, false);
      }
      if (info) flags[fid] = info.offline;
    }
    if (this.folderInfo?.size) await repo.saveFolderOffline(this.db, flags);
    const todo = folders.filter((f) => force || changed.has(folderIdOf(f)) || !states.get(folderIdOf(f))?.done);
    this.progress = { done: 0, total: await this.countMessages(todo) };
    this.log.info(`[novabird-db] Erstlauf: ${todo.length} von ${folders.length} Ordnern, ${this.progress.total ?? "?"} Mails zu lesen`);
    for (const folder of todo) {
      if (this.stopped) break;
      const fid = folderIdOf(folder);
      try {
        await this.enqueue(() => this.indexFolder(folder));
      } catch (e) {
        this.log.error("[novabird-db] Ordner fehlgeschlagen", folder.name, e, e?.timeout ? REPAIR_HINT : ""); // nächster Ordner
      }
    }
    this.log.info(`[novabird-db] Erstlauf ${this.stopped ? "angehalten" : "fertig"}`);
    this.onProgress({ phase: this.stopped ? "stopped" : "done" });
  }

  /** Gesamtzahl der Mails für die Fortschrittsanzeige (null, wenn die API sie nicht liefert). */
  async countMessages(folders) {
    const f = this.api.folders;
    if (!f?.getFolderInfo) return null;
    let total = 0;
    for (const folder of folders) {
      try {
        total += (await f.getFolderInfo(folder.id ?? folder)).totalMessageCount ?? 0;
      } catch {
        return null;
      }
    }
    return total;
  }

  async indexFolder(folder, { quiet = false } = {}) {
    const fid = folderIdOf(folder);
    const t0 = Date.now();
    this.log.info(`[novabird-db] ${quiet ? "Abgleich: lese" : "Lese"} Ordner „${folder.name ?? fid}“ …`);
    const stopWatch = this.watch(folder.name ?? fid);
    this.timeoutsInRow = 0;
    try {
      await this.indexFolderBody(folder, fid, t0, quiet);
    } finally {
      stopWatch();
    }
  }

  async indexFolderBody(folder, fid, t0, quiet) {
    let read = 0;
    const seen = new Set();
    let indexed = 0;
    let skipped = 0;
    let noBody = 0; // Nachrichten, die (noch) nicht lokal vorliegen
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      await repo.upsertMessages(this.db, this.caps, batch);
      indexed += batch.length;
      batch = [];
      if (!quiet) this.onProgress({ phase: "folder", folder: folder.name, indexed, skipped, ...this.progress });
      if (this.pauseMs) await sleep(this.pauseMs);
    };

    for await (const headers of this.pages(this.api.messages.list(folder.id ?? folder))) {
      if (this.stopped) {
        await flush();
        return; // Ordner bleibt "nicht fertig" -> nächster Lauf setzt fort
      }
      if (!quiet) {
        this.progress.done += headers.length;
        this.onProgress({ phase: "folder", folder: folder.name, indexed, skipped, ...this.progress });
      }
      const ids = headers.map((h) => h.headerMessageId).filter(Boolean);
      ids.forEach((id) => seen.add(id));
      const before = Math.floor(read / 5000);
      read += headers.length;
      if (this.cur) this.cur.seen = read;
      if (Math.floor(read / 5000) > before) this.log.info(`[novabird-db]   „${folder.name ?? fid}“: ${read} Mails gesehen, ${indexed} neu, ${skipped} übersprungen`);
      this.mark(`Seite mit ${headers.length} Mails prüfen`);
      const tPage = Date.now();
      const known = await this.withTimeout(repo.knownState(this.db, fid, ids), this.limits.step, "Index abfragen");
      const offline = await this.withTimeout(this.offlineMap(headers), this.limits.step, "Offline-Flags lesen");
      const refs = await this.withTimeout(this.refsMap(headers), this.limits.step, "Verweise lesen");
      const work = [];
      for (const h of headers) {
        const isOffline = offline.get(h.id) ?? true;
        const hasBody = known.get(h.headerMessageId);
        // überspringen: schon vollständig drin, oder nur Kopfdaten drin und weiter nicht lokal
        if (!h.headerMessageId || (known.has(h.headerMessageId) && (hasBody || !isOffline))) {
          skipped++;
          continue;
        }
        work.push({ h, isOffline, refs: refs.get(h.id) });
      }
      // Mails parallel lesen (Reihenfolge bleibt erhalten); zwischen den Gruppen auf Anhalten prüfen
      for (let i = 0; i < work.length; i += this.concurrency) {
        if (this.stopped) {
          await flush();
          return;
        }
        const group = work.slice(i, i + this.concurrency);
        const records = await Promise.all(
          group.map(async ({ h, isOffline, refs: refList }) => {
            try {
              return await this.buildRecord(h, isOffline, refList);
            } catch (e) {
              this.log.warn("[novabird-db] Nachricht übersprungen", h.subject, e);
              return null;
            }
          }),
        );
        if (this.timeoutsInRow >= this.limits.stuck) {
          await flush();
          throw new Error(`Ordner „${folder.name ?? fid}“ hängt: ${this.timeoutsInRow} Mails nacheinander nicht lesbar. ${REPAIR_HINT}`);
        }
        records.forEach((r, k) => {
          if (!r) return;
          if (!group[k].isOffline) noBody++;
          batch.push(r);
        });
        if (batch.length >= this.batchSize) await flush();
      }
      this.dbg(`Seite fertig: ${headers.length} Mails, ${work.length} zu lesen, ${Date.now() - tPage} ms (Ordner „${folder.name ?? fid}“, ${read} gesehen)`);
    }
    this.mark("Abschluss");
    await flush();

    // Abgleich: Einträge, die es im Ordner nicht mehr gibt, entfernen
    const stale = (await repo.headerIdsInFolder(this.db, fid)).filter((id) => !seen.has(id));
    if (stale.length) {
      await repo.deleteMessages(this.db, this.caps, stale.map((headerMessageId) => ({ headerMessageId, folderId: fid })));
    }
    // Ordner ohne Offline-Speicher sind mit den Kopfdaten fertig. Sonst gelten Ordner mit Kopfdaten-Einträgen nicht als fertig:
    // der nächste Lauf holt den Text nach, sobald er lokal ist
    await repo.setFolderDone(this.db, fid, this.onlineOnly(fid) || (noBody === 0 && !(await repo.hasHeadersOnly(this.db, fid))));
    await this.noteTotal(folder);
    this.log.info(`[novabird-db] Ordner „${folder.name ?? fid}“ fertig: ${read} Mails gesehen, ${indexed} neu, ${skipped} übersprungen, ${stale.length} entfernt, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  }

  /** Mailzahl des Ordners nach vollständigem Durchgang merken (dauerhaft in meta), Grundlage für reconcile(). */
  async noteTotal(folder) {
    try {
      const total = (await this.api.folders.getFolderInfo(folder.id ?? folder)).totalMessageCount;
      if (typeof total !== "number") return;
      const totals = await repo.loadFolderTotals(this.db);
      totals[folderIdOf(folder)] = total;
      await repo.saveFolderTotals(this.db, totals);
    } catch {
      /* API fehlt: dann gibt es auch keinen Abgleich */
    }
  }

  // ---------------------------------------------------------------- Events

  async processHeaders(headers) {
    const records = [];
    const offline = await this.offlineMap(headers);
    const refs = await this.refsMap(headers);
    for (const h of headers) {
      if (!h.headerMessageId || this.isExcluded(h.folder)) continue;
      try {
        records.push(await this.buildRecord(h, offline.get(h.id) ?? true, refs.get(h.id)));
      } catch (e) {
        this.log.warn("[novabird-db] Nachricht übersprungen", h.subject, e);
      }
    }
    await repo.upsertMessages(this.db, this.caps, records);
  }

  // ---------------------------------------------------------------- Nachholen

  /**
   * Mails nachholen, die die Ereignisse verpasst haben (Betterbird war geschlossen, Server hat einsortiert):
   * je Konto alle Mails seit (neueste indizierte Mail − 1 Tag) abfragen und die noch unbekannten indizieren.
   * Konten ohne indizierte Mails überlässt das dem Erstlauf.
   */
  async catchUp({ now = Date.now() } = {}) {
    this.stopped = false;
    await this.loadTagNames();
    const accounts = await this.api.accounts.list(false);
    let checked = 0;
    let added = 0;
    for (const a of accounts) {
      if (this.stopped) break;
      const newest = await repo.newestDate(this.db, a.id);
      if (!newest) continue;
      const from = new Date(Math.min(newest, now) - 86_400_000);
      let list;
      try {
        list = this.api.messages.query({ accountId: a.id, fromDate: from, includeSubFolders: true });
      } catch (e) {
        this.log.warn("[novabird-db] Nachholen: messages.query nicht möglich", a.id, e);
        continue;
      }
      for await (const headers of this.pages(list)) {
        if (this.stopped) break;
        checked += headers.length;
        added += await this.indexNew(headers);
      }
    }
    this.log.info(`[novabird-db] Nachholen nach Datum: ${checked} Mails geprüft, ${added} neu`);
    return { checked, added };
  }

  /**
   * Ordner abgleichen: Mails, die rückwirkend einsortiert wurden (Server-Regel/Filter mit altem Datum, Verschieben auf
   * einem anderen Gerät), erwischt das Nachholen nach Datum nicht. Darum je Ordner die Mailzahl von Betterbird
   * (`folders.getFolderInfo`) mit der Zahl der indizierten Mails vergleichen und nur abweichende Ordner neu durchgehen
   * (bekannte Mails werden übersprungen, verschwundene entfernt). Kostet pro Ordner nur eine Abfrage.
   */
  async reconcile({ deep = false } = {}) {
    this.stopped = false;
    const f = this.api.folders;
    if (!f?.getFolderInfo) return { checked: 0, rescanned: 0, added: 0 };
    await this.loadTagNames();
    const counts = await repo.countsByFolder(this.db);
    const totals = await repo.loadFolderTotals(this.db); // Mailzahl je Ordner beim letzten vollständigen Durchgang
    let checked = 0;
    let rescanned = 0;
    let added = 0;
    const baseline = {};
    for (const folder of await this.listFolders()) {
      if (this.stopped) break;
      if (this.isExcluded(folder)) continue;
      const fid = folderIdOf(folder);
      // Online-only-Ordner nie komplett neu lesen: neue Mails kommen über Ereignisse und das Nachholen nach Datum
      if (this.onlineOnly(fid)) continue;
      let total;
      try {
        total = (await f.getFolderInfo(folder.id ?? folder)).totalMessageCount;
      } catch {
        continue;
      }
      if (typeof total !== "number") continue;
      checked++;
      const have = counts.get(fid) ?? 0;
      // bekannter Ordner: nur neu lesen, wenn sich die Mailzahl seit dem letzten Durchgang geändert hat;
      // unbekannter Ordner: wenn Index und Betterbird abweichen
      if (!deep && (fid in totals ? totals[fid] === total : total === have)) continue;
      if (!deep && !(fid in totals) && Math.abs(total - have) <= Math.max(5, total * 0.01)) {
        // erster Abgleich für diesen Ordner und nur kleine Abweichung (doppelte Message-IDs u. ä.): als Basiswert merken statt den ganzen Ordner zu lesen
        baseline[fid] = total;
        this.log.info(`[novabird-db] Abgleich: „${folder.name ?? fid}“ Basiswert ${total} (Index ${have}) gemerkt`);
        continue;
      }
      if (!deep) this.log.info(`[novabird-db] Abgleich: „${folder.name ?? fid}“ weicht ab (Betterbird ${total}, Index ${have}, zuletzt ${totals[fid] ?? "unbekannt"}) → neu lesen`);
      const before = have;
      try {
        await this.enqueue(() => this.indexFolder(folder, { quiet: true }));
      } catch (e) {
        this.log.error("[novabird-db] Abgleich fehlgeschlagen", folder.name, e);
        continue;
      }
      rescanned++;
      const after = (await repo.countsByFolder(this.db)).get(fid) ?? 0;
      added += Math.max(0, after - before);
    }
    if (Object.keys(baseline).length) await repo.saveFolderTotals(this.db, { ...(await repo.loadFolderTotals(this.db)), ...baseline });
    this.log.info(`[novabird-db] ${deep ? "Tiefenvergleich" : "Abgleich"} fertig: ${checked} Ordner geprüft, ${rescanned} neu gelesen, ${added} neu`);
    return { checked, rescanned, added };
  }

  /** Nur Unbekannte (oder jetzt lokal vorliegende Kopfdaten-Einträge) indizieren. */
  async indexNew(headers) {
    const byFolder = new Map();
    for (const h of headers) {
      if (!h.headerMessageId || this.isExcluded(h.folder)) continue;
      const fid = folderIdOf(h.folder);
      if (!byFolder.has(fid)) byFolder.set(fid, []);
      byFolder.get(fid).push(h);
    }
    const offline = await this.offlineMap(headers);
    const todo = [];
    for (const [fid, hs] of byFolder) {
      const known = await repo.knownState(this.db, fid, hs.map((h) => h.headerMessageId));
      for (const h of hs) {
        const isOffline = offline.get(h.id) ?? true;
        if (known.has(h.headerMessageId) && (known.get(h.headerMessageId) || !isOffline)) continue;
        todo.push(h);
      }
    }
    if (!todo.length) return 0;
    await this.enqueue(() => this.processHeaders(todo));
    return todo.length;
  }

  async collect(list) {
    const all = [];
    for await (const page of this.pages(list)) all.push(...page);
    return all;
  }

  on(event, handler) {
    event.addListener(handler);
    this.listeners.push([event, handler]);
  }

  attachListeners() {
    const m = this.api.messages;
    this.on(m.onNewMailReceived, (folder, list) =>
      this.enqueue(async () => this.processHeaders(await this.collect(list))),
    );
    this.on(m.onCopied, (_orig, copied) =>
      this.enqueue(async () => this.processHeaders(await this.collect(copied))),
    );
    this.on(m.onDeleted, (list) =>
      this.enqueue(async () => {
        const headers = await this.collect(list);
        await repo.deleteMessages(
          this.db,
          this.caps,
          headers.filter((h) => h.headerMessageId).map((h) => ({ headerMessageId: h.headerMessageId, folderId: folderIdOf(h.folder) })),
        );
      }),
    );
    this.on(m.onMoved, (orig, moved) =>
      this.enqueue(async () => {
        const from = await this.collect(orig);
        const to = await this.collect(moved);
        // Annahme: beide Listen haben dieselbe Reihenfolge (laut API-Doku so vorgesehen)
        for (let i = 0; i < Math.min(from.length, to.length); i++) {
          const a = from[i];
          const b = to[i];
          if (!a.headerMessageId) continue;
          if (this.isExcluded(b.folder)) {
            await repo.deleteMessages(this.db, this.caps, [{ headerMessageId: a.headerMessageId, folderId: folderIdOf(a.folder) }]);
            continue;
          }
          await repo.moveMessage(this.db, this.caps, a.headerMessageId, folderIdOf(a.folder), {
            folderId: folderIdOf(b.folder),
            folderName: b.folder?.name ?? "",
            folderType: folderTypeOf(b.folder),
            accountId: b.folder?.accountId ?? "",
          });
        }
      }),
    );
    this.on(m.onUpdated, (header, changed) =>
      this.enqueue(async () => {
        if (!header.headerMessageId) return;
        const patch = {};
        if ("read" in changed) patch.isRead = changed.read;
        if ("flagged" in changed) patch.isFlagged = changed.flagged;
        if ("tags" in changed) patch.tags = (changed.tags ?? []).map((k) => this.tagNames.get(k) ?? k);
        await repo.updateFlags(this.db, header.headerMessageId, folderIdOf(header.folder), patch);
      }),
    );
    const f = this.api.folders;
    if (f?.onDeleted) {
      this.on(f.onDeleted, (folder) => this.enqueue(() => repo.deleteFolder(this.db, this.caps, folderIdOf(folder))));
    }
    if (f?.onRenamed) {
      // Umbenannt = neue Ordner-ID: alte Einträge weg, neuer Ordner wird beim nächsten Lauf indiziert
      this.on(f.onRenamed, (oldFolder) => this.enqueue(() => repo.deleteFolder(this.db, this.caps, folderIdOf(oldFolder))));
    }
    if (f?.onMoved) {
      this.on(f.onMoved, (oldFolder) => this.enqueue(() => repo.deleteFolder(this.db, this.caps, folderIdOf(oldFolder))));
    }
  }

  detachListeners() {
    for (const [event, handler] of this.listeners) event.removeListener(handler);
    this.listeners = [];
  }
}
