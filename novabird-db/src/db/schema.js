// Schema und Migrationen. Jede Änderung = neue Migration am Ende der Liste.
// Bestehende Migrationen nie nachträglich ändern: Die DB-Datei überlebt Updates.

import { detectCapabilities, restrictCapabilities } from "./capabilities.js";

export const FTS_COLUMNS = [
  "subject",
  "author_name",
  "recipients",
  "body",
  "attachment_names",
  "attachment_text",
];

function ftsTableSql(mode) {
  const cols = FTS_COLUMNS.join(", ");
  switch (mode) {
    case "fts5-contentless":
      // Contentless: Mailtext liegt nicht doppelt in der DB (er ist in Betterbird).
      return `CREATE VIRTUAL TABLE messages_fts USING fts5(${cols},
        content='', contentless_delete=1,
        tokenize='unicode61 remove_diacritics 2', prefix='2 3')`;
    case "fts5":
      // Ohne contentless_delete muss der Inhalt mitgespeichert werden,
      // sonst wären Löschungen nicht möglich. Kostet Platz, funktioniert überall.
      return `CREATE VIRTUAL TABLE messages_fts USING fts5(${cols},
        tokenize='unicode61 remove_diacritics 2', prefix='2 3')`;
    case "fts4":
      return `CREATE VIRTUAL TABLE messages_fts USING fts4(${cols},
        tokenize=unicode61 "remove_diacritics=2", prefix="2,3")`;
    default:
      throw new Error(`Kein Volltextmodul verfügbar (ftsMode=${mode})`);
  }
}

function trigramTableSql(caps) {
  // Trigramm nur auf dem normalisierten Betreff (deutsche Komposita).
  // Normalisierung (Umlaute falten) macht der JS-Code, nicht SQLite.
  const contentOpts = caps.contentlessDelete ? "content='', contentless_delete=1, " : "";
  return `CREATE VIRTUAL TABLE subject_trigram USING fts5(subject_norm, ${contentOpts}tokenize='trigram')`;
}

/** Migrationen: Funktion(caps) -> SQL-Anweisungen. */
export const MIGRATIONS = [
  // v1: Grundschema
  (caps) => [
    `CREATE TABLE messages (
      id               INTEGER PRIMARY KEY AUTOINCREMENT, -- IDs nie wiederverwenden
      header_msg_id    TEXT NOT NULL,
      account_id       TEXT NOT NULL,
      folder_id        TEXT NOT NULL,
      folder_name      TEXT NOT NULL DEFAULT '',
      folder_type      TEXT NOT NULL DEFAULT '',  -- inbox|sent|drafts|archives|trash|junk|templates
      date             INTEGER NOT NULL,          -- ms seit 1970
      author_name      TEXT NOT NULL DEFAULT '',
      author_email     TEXT NOT NULL DEFAULT '',
      author_norm      TEXT NOT NULL DEFAULT '',  -- norm(Name + E-Mail) für Personensuche
      recipients       TEXT NOT NULL DEFAULT '',
      recipients_norm  TEXT NOT NULL DEFAULT '',
      subject          TEXT NOT NULL DEFAULT '',
      has_attachment   INTEGER NOT NULL DEFAULT 0,
      attachment_types TEXT NOT NULL DEFAULT '',  -- ,pdf,excel,
      attachment_names TEXT NOT NULL DEFAULT '',
      tags             TEXT NOT NULL DEFAULT '',  -- ,tag1,tag2,
      is_read          INTEGER NOT NULL DEFAULT 0,
      is_flagged       INTEGER NOT NULL DEFAULT 0,
      body_hash        TEXT NOT NULL DEFAULT '',
      indexed_at       INTEGER NOT NULL,
      UNIQUE (header_msg_id, folder_id)
    )`,
    `CREATE INDEX idx_messages_date ON messages(date)`,
    `CREATE INDEX idx_messages_author_email ON messages(author_email)`,
    `CREATE INDEX idx_messages_folder ON messages(folder_id)`,
    `CREATE INDEX idx_messages_header ON messages(header_msg_id)`,
    ftsTableSql(caps.ftsMode),
    ...(caps.trigram ? [trigramTableSql(caps)] : []),
    `CREATE TABLE index_state (
      folder_id  TEXT PRIMARY KEY,
      done       INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER
    )`,
  ],
  // v2: normalisierter Betreff für die Teilwortsuche (Komposita) ohne Trigramm-Index
  () => [`ALTER TABLE messages ADD COLUMN subject_norm TEXT NOT NULL DEFAULT ''`],
  // v3: Wortliste des Volltextindex für Tippfehler-Vorschläge (nur FTS5)
  (caps) => (caps.ftsMode === "fts4" ? [] : [`CREATE VIRTUAL TABLE messages_vocab USING fts5vocab(messages_fts, 'row')`]),
  // v4: optionaler Modus „Zusammensetzungen beim Indexieren“ (terms_de): Zusatzindex + Saatliste für die Zerlegung
  (caps) => [
    `CREATE TABLE terms_seed (term TEXT PRIMARY KEY)`,
    ...(caps.ftsMode === "fts4"
      ? []
      : [
          `CREATE VIRTUAL TABLE terms_fts USING fts5(terms, ${caps.contentlessDelete ? "content='', contentless_delete=1, " : ""}tokenize='unicode61 remove_diacritics 2', prefix='2 3')`,
        ]),
  ],
  // v5: Konversationsabfrage (NovaBird-Conversation): Verweise (References/In-Reply-To), Textanfang, Betreff-Schlüssel (ohne Re:/AW:)
  () => [
    `CREATE TABLE message_refs (
      header_msg_id TEXT NOT NULL,
      ref_id        TEXT NOT NULL,
      UNIQUE (header_msg_id, ref_id)
    )`,
    `CREATE INDEX idx_refs_ref ON message_refs(ref_id)`,
    `ALTER TABLE messages ADD COLUMN snippet TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE messages ADD COLUMN subject_key TEXT NOT NULL DEFAULT ''`,
    `CREATE INDEX idx_messages_subject_key ON messages(subject_key)`,
  ],
];

export const SCHEMA_VERSION = MIGRATIONS.length;

/** Version der Konversationsdaten (Verweise/Snippet/Betreff-Schlüssel); bei Änderung wird der Index einmal neu aufgebaut. */
export const CONV_DATA_VERSION = 1;

async function readMeta(db) {
  await db.execute("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT)");
  const rows = await db.select("SELECT key, value FROM meta", [], ["key", "value"]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/**
 * Legt den Index an bzw. migriert ihn. Liefert die gespeicherten Fähigkeiten
 * ({ftsMode, trigram, ...}), die Repository und Suche brauchen.
 *
 * options.forceMode ("fts4" | "fts5") nur für Tests der Fallback-Pfade.
 */
export async function migrate(db, options = {}) {
  const meta = await readMeta(db);
  let caps;
  if (meta.caps) {
    caps = JSON.parse(meta.caps);
  } else {
    caps = restrictCapabilities(await detectCapabilities(db), options.forceMode);
    if (caps.ftsMode === "none") {
      throw new Error("SQLite ohne FTS5/FTS4 – Index nicht möglich");
    }
  }
  const current = Number(meta.schema_version ?? 0);
  if (current > MIGRATIONS.length) {
    throw new Error(
      `Index-Schema v${current} ist neuer als dieses Add-on (v${MIGRATIONS.length}). Index löschen oder Add-on aktualisieren.`,
    );
  }
  for (let v = current; v < MIGRATIONS.length; v++) {
    const statements = MIGRATIONS[v](caps).map((sql) => ({ sql, params: [] }));
    statements.push(
      { sql: "INSERT OR REPLACE INTO meta(key, value) VALUES ('schema_version', ?)", params: [String(v + 1)] },
      { sql: "INSERT OR REPLACE INTO meta(key, value) VALUES ('caps', ?)", params: [JSON.stringify(caps)] },
    );
    await db.batch(statements);
  }
  // nicht gespeichert: gilt, solange die Zusatztabelle existiert (FTS5)
  return { ...caps, termsFts: caps.ftsMode !== "fts4" };
}

/** Zusatzindex der Zerlegung (terms_de) leeren: Tabelle neu anlegen, Saatliste löschen (beim Zurückschalten auf „Bei der Suche“). */
export async function resetTermsTables(db, caps) {
  const ddl = MIGRATIONS[3](caps);
  const stmts = [{ sql: "DROP TABLE IF EXISTS terms_fts", params: [] }, { sql: "DROP TABLE IF EXISTS terms_seed", params: [] }, ...ddl.map((sql) => ({ sql, params: [] }))];
  await db.batch(stmts);
}
