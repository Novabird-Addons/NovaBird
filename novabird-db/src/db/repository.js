// Schreibzugriffe auf den Index. Alles läuft über db.batch() und damit in
// einer Transaktion pro Aufruf. Kein Zwischenlesen nötig: Die Zeilen-ID wird
// per Subselect über (header_msg_id, folder_id) ermittelt.

import { foldDe, norm, toListField } from "../util/normalize.js";
import { FTS_COLUMNS } from "./schema.js";

/** Markierung in body_hash für Datensätze ohne Volltext (Nachricht nicht lokal gespeichert). */
export const HEADERS_ONLY = "headers-only";
export const MAX_BODY_CHARS = 100_000;
export const MAX_ATTACHMENT_TEXT_CHARS = 200_000;

const ID_OF = "(SELECT id FROM messages WHERE header_msg_id = ? AND folder_id = ?)";

/**
 * Datensatz-Format (erzeugt vom Indexer, siehe indexer/record.js):
 * { headerMessageId, accountId, folderId, folderName, folderType, date,
 *   authorName, authorEmail, recipients, subject, hasAttachment,
 *   attachmentTypes[], attachmentNames[], tags[], isRead, isFlagged,
 *   body, attachmentText, bodyHash }
 */
export function upsertStatements(caps, r, now = Date.now()) {
  const key = [r.headerMessageId, r.folderId];
  const body = String(r.body ?? "").slice(0, MAX_BODY_CHARS);
  const attachmentText = String(r.attachmentText ?? "").slice(0, MAX_ATTACHMENT_TEXT_CHARS);
  const attachmentNames = (r.attachmentNames ?? []).join(", ");
  const stmts = [
    {
      sql: `INSERT INTO messages (
          header_msg_id, account_id, folder_id, folder_name, folder_type, date,
          author_name, author_email, author_norm, recipients, recipients_norm, subject, subject_norm,
          has_attachment, attachment_types, attachment_names, tags, is_read, is_flagged,
          body_hash, indexed_at, snippet, subject_key)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(header_msg_id, folder_id) DO UPDATE SET
          account_id=excluded.account_id, folder_name=excluded.folder_name,
          folder_type=excluded.folder_type, date=excluded.date,
          author_name=excluded.author_name, author_email=excluded.author_email,
          author_norm=excluded.author_norm, recipients=excluded.recipients,
          recipients_norm=excluded.recipients_norm, subject=excluded.subject,
          subject_norm=excluded.subject_norm,
          has_attachment=excluded.has_attachment, attachment_types=excluded.attachment_types,
          attachment_names=excluded.attachment_names, tags=excluded.tags,
          is_read=excluded.is_read, is_flagged=excluded.is_flagged,
          body_hash=excluded.body_hash, indexed_at=excluded.indexed_at,
          snippet=excluded.snippet, subject_key=excluded.subject_key`,
      params: [
        r.headerMessageId,
        r.accountId ?? "",
        r.folderId,
        r.folderName ?? "",
        r.folderType ?? "",
        Number(r.date),
        r.authorName ?? "",
        (r.authorEmail ?? "").toLowerCase(),
        norm(`${r.authorName ?? ""} ${r.authorEmail ?? ""}`),
        r.recipients ?? "",
        norm(r.recipients ?? ""),
        r.subject ?? "",
        norm(r.subject ?? ""),
        r.hasAttachment ? 1 : 0,
        toListField(r.attachmentTypes),
        attachmentNames,
        toListField(r.tags),
        r.isRead ? 1 : 0,
        r.isFlagged ? 1 : 0,
        r.bodyHash ?? "",
        now,
        String(r.snippet ?? ""),
        String(r.subjectKey ?? ""),
      ],
    },
    // Alten Volltexteintrag entfernen (bei Neuindizierung), dann neu schreiben.
    { sql: `DELETE FROM messages_fts WHERE rowid = ${ID_OF}`, params: key },
    {
      sql: `INSERT INTO messages_fts (rowid, ${FTS_COLUMNS.join(", ")})
            VALUES (${ID_OF}, ?, ?, ?, ?, ?, ?)`,
      params: [
        ...key,
        // gefaltet (ä→a, ue→u, ß→ss …), damit Suche und Index dieselbe Schreibweise sehen
        foldDe(r.subject ?? ""),
        foldDe(r.authorName ?? ""),
        foldDe(r.recipients ?? ""),
        foldDe(body),
        foldDe(attachmentNames),
        foldDe(attachmentText),
      ],
    },
  ];
  if (Array.isArray(r.refs)) {
    // Verweise der Nachricht neu schreiben (gelten je Message-ID, nicht je Ordner)
    stmts.push({ sql: "DELETE FROM message_refs WHERE header_msg_id = ?", params: [r.headerMessageId] });
    for (const ref of r.refs) {
      stmts.push({ sql: "INSERT OR IGNORE INTO message_refs (header_msg_id, ref_id) VALUES (?, ?)", params: [r.headerMessageId, ref] });
    }
  }
  if (caps.termsFts && r.termsDe !== undefined) {
    // Zusatzterme aus der Zerlegung (nur im Modus „Beim Indexieren“)
    stmts.push({ sql: `DELETE FROM terms_fts WHERE rowid = ${ID_OF}`, params: key });
    if (r.termsDe) stmts.push({ sql: `INSERT INTO terms_fts (rowid, terms) VALUES (${ID_OF}, ?)`, params: [...key, r.termsDe] });
  }
  if (caps.trigram) {
    stmts.push(
      { sql: `DELETE FROM subject_trigram WHERE rowid = ${ID_OF}`, params: key },
      {
        sql: `INSERT INTO subject_trigram (rowid, subject_norm) VALUES (${ID_OF}, ?)`,
        params: [...key, norm(r.subject ?? "")],
      },
    );
  }
  return stmts;
}

function deleteStatements(caps, headerMessageId, folderId) {
  const key = [headerMessageId, folderId];
  const stmts = [{ sql: `DELETE FROM messages_fts WHERE rowid = ${ID_OF}`, params: key }];
  if (caps.termsFts) stmts.push({ sql: `DELETE FROM terms_fts WHERE rowid = ${ID_OF}`, params: key });
  if (caps.trigram) {
    stmts.push({ sql: `DELETE FROM subject_trigram WHERE rowid = ${ID_OF}`, params: key });
  }
  stmts.push({ sql: "DELETE FROM messages WHERE header_msg_id = ? AND folder_id = ?", params: key });
  // Verweise nur entfernen, wenn keine andere Kopie (anderer Ordner) der Nachricht mehr im Index ist
  stmts.push({
    sql: "DELETE FROM message_refs WHERE header_msg_id = ? AND NOT EXISTS (SELECT 1 FROM messages WHERE header_msg_id = ?)",
    params: [headerMessageId, headerMessageId],
  });
  return stmts;
}

export async function upsertMessages(db, caps, records, now = Date.now()) {
  if (!records.length) return;
  await db.batch(records.flatMap((r) => upsertStatements(caps, r, now)));
}

/** keys: [{ headerMessageId, folderId }] */
export async function deleteMessages(db, caps, keys) {
  if (!keys.length) return;
  await db.batch(keys.flatMap((k) => deleteStatements(caps, k.headerMessageId, k.folderId)));
}

/**
 * Nachricht in anderen Ordner verschieben, ohne neu zu indizieren.
 * target: { folderId, folderName, folderType, accountId }
 */
export async function moveMessage(db, caps, headerMessageId, fromFolderId, target) {
  await db.batch([
    // Falls die Nachricht im Zielordner schon existiert: dort zuerst entfernen.
    ...deleteStatements(caps, headerMessageId, target.folderId),
    {
      sql: `UPDATE messages SET folder_id = ?, folder_name = ?, folder_type = ?, account_id = ?
            WHERE header_msg_id = ? AND folder_id = ?`,
      params: [
        target.folderId,
        target.folderName ?? "",
        target.folderType ?? "",
        target.accountId ?? "",
        headerMessageId,
        fromFolderId,
      ],
    },
  ]);
}

/** Alle Einträge eines Ordners entfernen (Ordner gelöscht/umbenannt). */
export async function deleteFolder(db, caps, folderId) {
  const sub = "(SELECT id FROM messages WHERE folder_id = ?)";
  const stmts = [{ sql: `DELETE FROM messages_fts WHERE rowid IN ${sub}`, params: [folderId] }];
  if (caps.termsFts) stmts.push({ sql: `DELETE FROM terms_fts WHERE rowid IN ${sub}`, params: [folderId] });
  if (caps.trigram) {
    stmts.push({ sql: `DELETE FROM subject_trigram WHERE rowid IN ${sub}`, params: [folderId] });
  }
  stmts.push(
    { sql: "DELETE FROM messages WHERE folder_id = ?", params: [folderId] },
    { sql: "DELETE FROM index_state WHERE folder_id = ?", params: [folderId] },
    // Verweise von Nachrichten, die nirgends mehr im Index sind
    { sql: "DELETE FROM message_refs WHERE NOT EXISTS (SELECT 1 FROM messages m WHERE m.header_msg_id = message_refs.header_msg_id)", params: [] },
  );
  await db.batch(stmts);
}

/** Alle indizierten Message-IDs eines Ordners (für den Abgleich nach dem Durchlauf). */
export async function headerIdsInFolder(db, folderId) {
  const rows = await db.select(
    "SELECT header_msg_id FROM messages WHERE folder_id = ?",
    [folderId],
    ["header_msg_id"],
  );
  return rows.map((r) => r.header_msg_id);
}

/** Gelesen/Markiert/Schlagwörter aktualisieren (onUpdated). */
export async function updateFlags(db, headerMessageId, folderId, { isRead, isFlagged, tags }) {
  const sets = [];
  const params = [];
  if (isRead !== undefined) (sets.push("is_read = ?"), params.push(isRead ? 1 : 0));
  if (isFlagged !== undefined) (sets.push("is_flagged = ?"), params.push(isFlagged ? 1 : 0));
  if (tags !== undefined) (sets.push("tags = ?"), params.push(toListField(tags)));
  if (!sets.length) return;
  await db.execute(
    `UPDATE messages SET ${sets.join(", ")} WHERE header_msg_id = ? AND folder_id = ?`,
    [...params, headerMessageId, folderId],
  );
}

/** Welche dieser Message-IDs sind im Ordner bereits indiziert? (für Wiederaufnahme) */
export async function knownHeaderIds(db, folderId, headerIds) {
  const known = new Set();
  const CHUNK = 400; // unter dem SQLite-Limit für Parameter bleiben
  for (let i = 0; i < headerIds.length; i += CHUNK) {
    const part = headerIds.slice(i, i + CHUNK);
    const rows = await db.select(
      `SELECT header_msg_id FROM messages
       WHERE folder_id = ? AND header_msg_id IN (${part.map(() => "?").join(",")})
         AND (subject_norm != '' OR subject = '')`,
      [folderId, ...part],
      ["header_msg_id"],
    );
    for (const r of rows) known.add(r.header_msg_id);
  }
  return known;
}

export async function setFolderDone(db, folderId, done = true, now = Date.now()) {
  await db.execute(
    `INSERT INTO index_state (folder_id, done, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(folder_id) DO UPDATE SET done = excluded.done, updated_at = excluded.updated_at`,
    [folderId, done ? 1 : 0, now],
  );
}

export async function folderStates(db) {
  const rows = await db.select(
    "SELECT folder_id, done, updated_at FROM index_state",
    [],
    ["folder_id", "done", "updated_at"],
  );
  return new Map(rows.map((r) => [r.folder_id, r]));
}

/** Zahl der Nachrichten je Ordner (für Konsistenzcheck gegen Betterbird). */
export async function countsByFolder(db) {
  const rows = await db.select(
    "SELECT folder_id, COUNT(*) FROM messages GROUP BY folder_id",
    [],
    ["folder_id", "count"],
  );
  return new Map(rows.map((r) => [r.folder_id, r.count]));
}

/** Verwaiste Volltexteinträge entfernen (Wartung, z. B. einmal pro Woche). */
export async function cleanupOrphans(db, caps) {
  const stmts = [
    { sql: "DELETE FROM messages_fts WHERE rowid NOT IN (SELECT id FROM messages)", params: [] },
  ];
  if (caps.trigram) {
    stmts.push({
      sql: "DELETE FROM subject_trigram WHERE rowid NOT IN (SELECT id FROM messages)",
      params: [],
    });
  }
  await db.batch(stmts);
}

/** Statistik für Einstellungsseite und Fortschrittsanzeige. */
export async function stats(db) {
  const [row] = await db.select(
    "SELECT COUNT(*), MIN(date), MAX(date) FROM messages",
    [],
    ["messages", "oldest", "newest"],
  );
  return row;
}

/** Wie knownHeaderIds, liefert aber Map headerId -> hat Volltext (false = nur Kopfdaten). */
export async function knownState(db, folderId, headerIds) {
  const known = new Map();
  const CHUNK = 400;
  for (let i = 0; i < headerIds.length; i += CHUNK) {
    const part = headerIds.slice(i, i + CHUNK);
    const rows = await db.select(
      `SELECT header_msg_id, body_hash FROM messages
       WHERE folder_id = ? AND header_msg_id IN (${part.map(() => "?").join(",")})
         AND (subject_norm != '' OR subject = '')`,
      [folderId, ...part],
      ["header_msg_id", "body_hash"],
    );
    for (const r of rows) known.set(r.header_msg_id, r.body_hash !== HEADERS_ONLY);
  }
  return known;
}

export async function hasHeadersOnly(db, folderId) {
  const [r] = await db.select(
    "SELECT COUNT(*) AS n FROM messages WHERE folder_id = ? AND body_hash = ?",
    [folderId, HEADERS_ONLY],
    ["n"],
  );
  return r.n > 0;
}

export async function countHeadersOnly(db) {
  const [r] = await db.select("SELECT COUNT(*) AS n FROM messages WHERE body_hash = ?", [HEADERS_ONLY], ["n"]);
  return r.n;
}

/** Datum (ms) der neuesten indizierten Mail eines Kontos oder null. */
export async function newestDate(db, accountId) {
  const [r] = await db.select("SELECT MAX(date) AS d FROM messages WHERE account_id = ?", [accountId], ["d"]);
  return r?.d ?? null;
}

/** Mailzahl je Ordner beim letzten vollständigen Durchgang ({folderId: n}); Grundlage des Ordner-Abgleichs. */
export async function loadFolderTotals(db) {
  const rows = await db.select("SELECT value FROM meta WHERE key = 'folder_totals'", [], ["value"]);
  try {
    return rows.length ? JSON.parse(rows[0].value) : {};
  } catch {
    return {};
  }
}

export async function saveFolderTotals(db, totals) {
  await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('folder_totals', ?)", [JSON.stringify(totals)]);
}
