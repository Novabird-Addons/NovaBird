/* Experiment-API "novabirdDb" – privilegierter Teil des NovaBird-Search.
 *
 * STATUS: geschrieben gegen die Gecko-/Thunderbird-APIs (Sqlite.sys.mjs,
 * PathUtils, IOUtils, ExtensionCommon), NOCH NICHT IN BETTERBIRD GETESTET.
 *
 * Grundsatz: Diese Datei kennt nur Datenbank-Operationen. Keine Mail-, Parser-
 * oder UI-Logik. Der Datenbankpfad wird hier fest bestimmt und nie vom
 * WebExtension-Teil übergeben.
 *
 * Datei: <Profil>/novabird-db/index.sqlite  (WAL-Modus)
 */

/* global ChromeUtils, PathUtils, IOUtils */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionUtils } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
var { Sqlite } = ChromeUtils.importESModule("resource://gre/modules/Sqlite.sys.mjs");

const DIR_NAME = "novabird-db";
const FILE_NAME = "index.sqlite";

function fail(e) {
  // ExtensionError wird mit Meldung an den Add-on-Code weitergereicht,
  // normale Fehler kämen dort nur als "An unexpected error occurred" an.
  throw new ExtensionUtils.ExtensionError(String(e?.message ?? e));
}

function cleanParams(params) {
  if (!Array.isArray(params)) return [];
  return params.map((v) => (v === undefined ? null : typeof v === "boolean" ? (v ? 1 : 0) : v));
}

function toObjects(rows, columns) {
  // Spalten werden über ihre Position gelesen; die Reihenfolge in `columns`
  // muss der SELECT-Liste entsprechen (so auch im Node-Testadapter).
  return rows.map((row) => {
    const o = {};
    for (let i = 0; i < columns.length; i++) {
      let v = row.getResultByIndex(i);
      if (v && typeof v === "object" && typeof v.length === "number") v = Array.from(v); // BLOB
      o[columns[i]] = v;
    }
    return o;
  });
}

var novabirdDb = class extends ExtensionCommon.ExtensionAPI {
  constructor(extension) {
    super(extension);
    this.conn = null;
    this.opening = null;
    this.wantFts5 = true;
    this.fts5Loaded = false;
  }

  get dir() {
    return PathUtils.join(PathUtils.profileDir, DIR_NAME);
  }

  get path() {
    return PathUtils.join(this.dir, FILE_NAME);
  }

  /**
   * Öffnet die Datenbank. Bevorzugt mit nachgeladener FTS5-Erweiterung (Betterbird/Thunderbird erlauben
   * `loadExtension("fts5")` auf einer Storage-Verbindung, geprüft in 153.4); schlägt das fehl oder ist es
   * abgeschaltet, wird normal geöffnet (nur FTS4). Die Erweiterung gilt pro Verbindung und muss vor dem
   * ersten Zugriff auf FTS-Tabellen geladen sein.
   */
  async _open() {
    await IOUtils.makeDirectory(this.dir, { ignoreExisting: true, createAncestors: true });
    let conn = null;
    this.fts5Loaded = false;
    if (this.wantFts5) {
      let raw = null;
      try {
        const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
        file.initWithPath(this.path);
        raw = Services.storage.openUnsharedDatabase(file);
        await new Promise((resolve, reject) => {
          try {
            raw.loadExtension("fts5", (rv) => (Components.isSuccessCode(rv) ? resolve() : reject(new Error(`loadExtension: ${rv}`))));
          } catch (e) {
            reject(e);
          }
        });
        conn = await Sqlite.wrapStorageConnection({ connection: raw });
        this.fts5Loaded = true;
      } catch (e) {
        console.warn("[novabird-db] FTS5 konnte nicht geladen werden, nutze FTS4:", e);
        try {
          raw?.asyncClose();
        } catch {
          /* ignorieren */
        }
        conn = null;
      }
    }
    if (!conn) conn = await Sqlite.openConnection({ path: this.path });
    await conn.execute("PRAGMA journal_mode = WAL");
    await conn.execute("PRAGMA synchronous = NORMAL");
    this.conn = conn;
    // Beim Beenden von Betterbird wartet Sqlite.sys.mjs („shutdown blocker“) darauf, dass ALLE Verbindungen geschlossen
    // sind, und bricht nach einer Minute mit einem Absturz ab (Prozess läuft nach dem Schließen des Fensters weiter).
    // Das Schließen ist Aufgabe des Besitzers der Verbindung: hier vor „profile-before-change“ erledigen.
    if (!this._shutdownBlocker) {
      this._shutdownBlocker = async () => {
        this.shuttingDown = true;
        await this.closeConnection().catch(() => {});
      };
      Sqlite.shutdown.addBlocker("novabird-db: Datenbank schließen", this._shutdownBlocker);
    }
    return conn;
  }

  ensureOpen() {
    if (this.shuttingDown) {
      return Promise.reject(new Error("Betterbird wird beendet"));
    }
    // Öffnen ist gerade fehlgeschlagen (z. B. beschädigte Datei): nicht bei jedem Aufruf neu versuchen (Protokoll, Last)
    if (!this.opening && this.openError && Date.now() - this.openFailedAt < 10_000) {
      return Promise.reject(this.openError);
    }
    if (!this.opening) {
      this.opening = this._open()
        .then((conn) => {
          this.openError = null;
          return conn;
        })
        .catch((e) => {
          this.opening = null;
          this.openError = e;
          this.openFailedAt = Date.now();
          throw e;
        });
    }
    return this.opening;
  }

  async closeConnection() {
    try {
      await this.opening; // ein laufendes Öffnen erst abwarten, sonst bliebe die neue Verbindung offen
    } catch {
      /* Öffnen fehlgeschlagen: nichts zu schließen */
    }
    const conn = this.conn;
    this.conn = null;
    this.opening = null;
    this.openError = null; // die Datei wird gleich ersetzt/gelöscht: kein zwischengespeicherter Öffnungsfehler mehr
    this.openFailedAt = 0;
    if (conn) {
      // Marke „sauber beendet“ (beim nächsten Start: fehlt sie, wird der Index geprüft)
      try {
        await conn.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('clean_shutdown', '1')");
      } catch {
        /* Datei beschädigt oder meta fehlt: egal */
      }
      await conn.close();
    }
  }

  get asidePath() {
    return this.path + ".alt";
  }

  onShutdown(isAppShutdown) {
    // Datei freigeben (Add-on-Update/Deaktivierung und Beenden von Betterbird). Sqlite.sys.mjs schließt fremde
    // Verbindungen NICHT selbst, sondern wartet beim Beenden darauf (sonst Absturz nach 60 s).
    if (isAppShutdown) {
      this.shuttingDown = true;
    }
    if (this.conn || this.opening) {
      this.closeConnection().catch(() => {});
    }
    if (!isAppShutdown && this._shutdownBlocker) {
      try {
        Sqlite.shutdown.removeBlocker(this._shutdownBlocker);
      } catch {
        /* schon entfernt */
      }
      this._shutdownBlocker = null;
    }
  }

  getAPI(context) {
    const self = this;
    return {
      novabirdDb: {
        async open(options) {
          try {
            // Nur wirksam beim ersten Öffnen (Verbindung ist danach offen): fts5:false schaltet FTS5 ab (Tests, Rückfall)
            if (!self.conn && !self.opening) self.wantFts5 = options?.fts5 !== false;
            await self.ensureOpen();
            return { path: self.path };
          } catch (e) {
            return fail(e);
          }
        },

        async execute(sql, params) {
          try {
            const conn = await self.ensureOpen();
            await conn.execute(sql, cleanParams(params));
            return null;
          } catch (e) {
            return fail(e);
          }
        },

        async select(sql, params, columns) {
          try {
            const conn = await self.ensureOpen();
            const rows = await conn.execute(sql, cleanParams(params));
            return toObjects(rows ?? [], columns);
          } catch (e) {
            return fail(e);
          }
        },

        async executeBatch(statements) {
          try {
            const conn = await self.ensureOpen();
            await conn.executeTransaction(async () => {
              for (const s of statements) {
                // executeCached: gleiche SQL-Texte (Upserts) werden nur einmal vorbereitet
                await conn.executeCached(s.sql, cleanParams(s.params));
              }
            });
            return null;
          } catch (e) {
            return fail(e);
          }
        },

        // Liest nur das Betterbird-Flag "Nachricht liegt lokal vor" (nsMsgMessageFlags.Offline).
        // Keine Mail-Logik: der Aufrufer entscheidet, was damit geschieht.
        async offlineFlags(messageIds) {
          try {
            const mm = context.extension.messageManager;
            return messageIds.map((id) => {
              try {
                const hdr = mm.get(id);
                if (!hdr) return false;
                // Lokale Ordner haben das Flag nicht, ihre Mails liegen aber immer lokal vor.
                const type = hdr.folder?.server?.type;
                return Boolean(hdr.flags & 0x80) || (Boolean(type) && type !== "imap" && type !== "nntp");
              } catch {
                return false;
              }
            });
          } catch (e) {
            return fail(e);
          }
        },

        // Mails über Message-ID + Ordner auflösen, viele auf einmal: Nachschlagen im Message-ID-Index der Ordnerdatenbank statt
        // messages.query je Mail (das sucht den Ordner ab und kostete gemessen ~90 % der Lesezeit der semantischen Suche).
        // Ergebnis je Eintrag: {id (Nachrichten-ID der WebExtension-API), offline} oder null (nicht gefunden).
        async resolveMessages(items) {
          try {
            const fm = context.extension.folderManager;
            const mm = context.extension.messageManager;
            const folders = new Map();
            return items.map(({ headerMessageId, folderId }) => {
              try {
                let folder = folders.get(folderId);
                if (folder === undefined) {
                  const i = folderId.indexOf(":/"); // MailFolder.id = "<Konto>:/<Pfad>", Pfad beginnt mit "/"
                  folder = (i > 0 && fm.get(folderId.slice(0, i), folderId.slice(i + 2))) || null;
                  folders.set(folderId, folder);
                }
                const hdr = folder?.msgDatabase?.getMsgHdrForMessageID(headerMessageId);
                if (!hdr) return null;
                const type = folder.server?.type;
                // Lokale Ordner haben das Offline-Flag nicht, ihre Mails liegen aber immer lokal vor.
                const offline = Boolean(hdr.flags & 0x80) || (Boolean(type) && type !== "imap" && type !== "nntp");
                return { id: mm.convert(hdr).id, offline };
              } catch {
                return null;
              }
            });
          } catch (e) {
            return fail(e);
          }
        },

        // Liest je Ordner ({accountId, path}) nur zwei Betterbird-Flags: virtuell (Such-/Sammelordner) und Offline-Speicher.
        // Keine Mail-Logik: der Aufrufer entscheidet. null, wenn der Ordner nicht aufgelöst werden kann.
        async folderInfo(folders) {
          try {
            const fm = context.extension.folderManager;
            return folders.map((f) => {
              try {
                const folder = fm.get(f.accountId, f.path);
                if (!folder) return null;
                const type = folder.server?.type;
                const virtual = Boolean(folder.flags & 0x20);
                // Lokale Ordner haben das Flag nicht, ihre Mails liegen aber immer lokal vor.
                const offline = Boolean(folder.flags & 0x08000000) || (Boolean(type) && type !== "imap" && type !== "nntp");
                return { virtual, offline };
              } catch {
                return null;
              }
            });
          } catch (e) {
            return fail(e);
          }
        },

        // Verweise (References, ersatzweise In-Reply-To) je Nachricht aus der Kopfdatenbank von Betterbird (nsIMsgDBHdr).
        // Kein Mailtext, kein Netz: geht auch für IMAP-Mails ohne lokale Kopie. Liefert je ID eine Liste von Message-IDs
        // (ohne spitze Klammern) oder null, wenn die Nachricht nicht gefunden wurde.
        async references(messageIds) {
          try {
            const mm = context.extension.messageManager;
            return messageIds.map((id) => {
              try {
                const hdr = mm.get(id);
                if (!hdr) return null;
                const out = [];
                const n = hdr.numReferences;
                for (let i = 0; i < n; i++) out.push(hdr.getStringReference(i));
                return out;
              } catch {
                return null;
              }
            });
          } catch (e) {
            return fail(e);
          }
        },

        async info() {
          try {
            const conn = await self.ensureOpen();
            const rows = await conn.execute("SELECT sqlite_version()");
            let sizeBytes = 0;
            try {
              sizeBytes = (await IOUtils.stat(self.path)).size;
            } catch {
              /* Datei existiert noch nicht */
            }
            return {
              path: self.path,
              sizeBytes,
              sqliteVersion: rows[0].getResultByIndex(0),
              fts5Loaded: self.fts5Loaded,
            };
          } catch (e) {
            return fail(e);
          }
        },

        async close() {
          try {
            await self.closeConnection();
            return null;
          } catch (e) {
            return fail(e);
          }
        },

        async deleteIndex() {
          try {
            await self.closeConnection();
            for (const suffix of ["", "-wal", "-shm"]) {
              await IOUtils.remove(self.path + suffix, { ignoreAbsent: true });
            }
            return null;
          } catch (e) {
            return fail(e);
          }
        },

        // Neuaufbau über eine Nebendatei: die aktuelle Indexdatei wird als index.sqlite.alt zur Seite gelegt (keepOld=false)
        // bzw. – wenn schon eine .alt existiert und die aktuelle Datei unvollständig ist (keepOld=true) – gelöscht, die .alt bleibt.
        async moveAside(keepOld) {
          try {
            await self.closeConnection();
            if (keepOld) {
              for (const suffix of ["", "-wal", "-shm"]) await IOUtils.remove(self.path + suffix, { ignoreAbsent: true });
            } else {
              for (const suffix of ["", "-wal", "-shm"]) await IOUtils.remove(self.asidePath + suffix, { ignoreAbsent: true });
              for (const suffix of ["", "-wal"]) {
                if (await IOUtils.exists(self.path + suffix)) await IOUtils.move(self.path + suffix, self.asidePath + suffix);
              }
              await IOUtils.remove(self.path + "-shm", { ignoreAbsent: true });
            }
            return null;
          } catch (e) {
            return fail(e);
          }
        },

        // Die zur Seite gelegte alte Indexdatei löschen (nach vollständigem Neuaufbau).
        async deleteAside() {
          try {
            for (const suffix of ["", "-wal", "-shm"]) await IOUtils.remove(self.asidePath + suffix, { ignoreAbsent: true });
            return null;
          } catch (e) {
            return fail(e);
          }
        },

        async hasAside() {
          try {
            return await IOUtils.exists(self.asidePath);
          } catch (e) {
            return fail(e);
          }
        },

        // Sekunden seit der letzten Eingabe des Benutzers (Leerlauf), für den Tiefenabgleich
        async idleSeconds() {
          try {
            const idle = Cc["@mozilla.org/widget/useridleservice;1"].getService(Ci.nsIUserIdleService);
            return Math.floor(idle.idleTime / 1000);
          } catch (e) {
            return fail(e);
          }
        },
      },
    };
  }
};
