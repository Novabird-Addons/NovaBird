// Konversationsabfrage für den NovaBird-Conversation: alle Nachrichten einer Konversation aus dem Index,
// ohne Betterbird-Aufruf. Regeln wie in novabird-conversation/conversation.js:
//  1. Kette: Mails gehören zusammen, wenn sich Message-ID / References / In-Reply-To verbinden (transitiv; fehlende
//     Elternmails verbinden Geschwister über den gemeinsamen Verweis).
//  2. Betreff-Ersatz nur für Mails OHNE Kette (Komponente aus genau einer Message-ID): "off" | "subject" | "smart".
//  3. Papierkorb und Spam raus, außer die Zielnachricht selbst. Dieselbe Message-ID in mehreren Ordnern: alle Zeilen.

export const MAX_COMPONENT = 500; // höchstens so viele Message-IDs je Kette (Schutz vor Sammelverweisen)
export const DEFAULT_LIMIT = 200; // Nachrichten, die geliefert werden (die neuesten)
export const MAX_LIMIT = 5000;
const MAX_CANDIDATES = 5000; // Betreff-Ersatz: höchstens so viele Kandidaten prüfen (neueste zuerst)

const COLS = [
  "header_msg_id", "folder_id", "folder_name", "folder_type", "date", "author_name", "author_email", "recipients",
  "subject", "subject_key", "is_read", "has_attachment", "attachment_names", "snippet", "indexed_at",
];
const SELECT = `SELECT ${COLS.join(", ")} FROM messages`;

const emails = (text) => (String(text ?? "").toLowerCase().match(/[^\s<>,;"']+@[^\s<>,;"']+/g) ?? []).map((e) => e.replace(/[.)]+$/, ""));

function people(row) {
  return new Set([row.author_email, ...emails(row.recipients)].filter(Boolean));
}

function chunks(list, size = 400) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** Alle Message-IDs der Kette, zu der `id` gehört (einschließlich `id`), höchstens MAX_COMPONENT. */
export async function chainIds(db, id) {
  const rows = await db.select(
    `WITH RECURSIVE comp(id) AS (
       SELECT ?
       UNION
       SELECT r.ref_id FROM message_refs r JOIN comp ON r.header_msg_id = comp.id
       UNION
       SELECT r.header_msg_id FROM message_refs r JOIN comp ON r.ref_id = comp.id
       LIMIT ${MAX_COMPONENT + 1}
     ) SELECT id FROM comp`,
    [id],
    ["id"],
  );
  return rows.map((r) => r.id);
}

function toMessage(r) {
  return {
    headerMessageId: r.header_msg_id,
    folderId: r.folder_id,
    folderName: r.folder_name,
    folderType: r.folder_type,
    date: r.date,
    authorName: r.author_name,
    authorEmail: r.author_email,
    recipients: r.recipients,
    subject: r.subject,
    isRead: Boolean(r.is_read),
    hasAttachment: Boolean(r.has_attachment),
    attachmentNames: r.attachment_names ? r.attachment_names.split(", ").filter(Boolean) : [],
    snippet: r.snippet ?? "",
  };
}

/**
 * @param opts { headerMessageId, folderId?, fallback: "off"|"subject"|"smart", fallbackDays, fallbackPeople, limit }
 * @returns { ok: true, indexedAt, truncated, messages: [...] } nach Datum aufsteigend (die neuesten `limit`)
 */
export async function findConversation(db, opts) {
  const id = String(opts.headerMessageId ?? "");
  const fallback = ["off", "subject", "smart"].includes(opts.fallback) ? opts.fallback : "subject";
  const limit = Math.max(1, Math.min(Number(opts.limit) || DEFAULT_LIMIT, MAX_LIMIT));
  if (!id) return { ok: true, indexedAt: 0, truncated: false, messages: [] };

  const targets = await db.select(`${SELECT} WHERE header_msg_id = ?`, [id], COLS);
  if (!targets.length) return { ok: true, indexedAt: 0, truncated: false, messages: [] };
  // Zielzeile: der angegebene Ordner, sonst die erste Kopie
  const target = (opts.folderId && targets.find((t) => t.folder_id === opts.folderId)) || targets[0];

  const ids = await chainIds(db, id);
  let rows = [];
  for (const part of chunks(ids)) {
    rows.push(...(await db.select(`${SELECT} WHERE header_msg_id IN (${part.map(() => "?").join(",")})`, part, COLS)));
  }

  // Betreff-Ersatz nur, wenn die Mail keine Kette hat: weniger als zwei verschiedene Nachrichten im Index
  // (ein Verweis auf eine unbekannte Elternmail zählt nicht, wie im NovaBird-Conversation)
  if (new Set(rows.map((r) => r.header_msg_id)).size < 2 && fallback !== "off" && target.subject_key) {
    const candidates = await db.select(
      `${SELECT} WHERE subject_key = ? ORDER BY date DESC LIMIT ${MAX_CANDIDATES}`,
      [target.subject_key],
      COLS,
    );
    let extra = candidates;
    if (fallback === "smart") {
      const days = Number(opts.fallbackDays) > 0 ? Number(opts.fallbackDays) : 30;
      const span = days * 86_400_000;
      const mine = people(target);
      extra = candidates.filter((c) => {
        if (c.header_msg_id === id) return true;
        if (Math.abs(c.date - target.date) > span) return false;
        if (opts.fallbackPeople === false) return true;
        for (const p of people(c)) if (mine.has(p)) return true;
        return false;
      });
    }
    const have = new Set(rows.map((r) => `${r.header_msg_id}\u0000${r.folder_id}`));
    for (const c of extra) {
      const key = `${c.header_msg_id}\u0000${c.folder_id}`;
      if (!have.has(key)) rows.push(c);
    }
  }

  // Papierkorb/Spam ausschließen, außer die Zielnachricht selbst (ihre gewählte Kopie)
  rows = rows.filter((r) => !["trash", "junk"].includes(r.folder_type) || (r.header_msg_id === id && r.folder_id === target.folder_id));

  rows.sort((a, b) => a.date - b.date || (a.header_msg_id < b.header_msg_id ? -1 : 1));
  const truncated = rows.length > limit;
  if (truncated) rows = rows.slice(rows.length - limit); // die neuesten
  return {
    ok: true,
    indexedAt: Math.max(0, ...rows.map((r) => r.indexed_at ?? 0)),
    truncated,
    messages: rows.map(toMessage),
  };
}
