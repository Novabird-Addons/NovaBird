// Strukturierte Anfrage -> parametrisiertes SQL.
// Nutzereingaben landen ausschließlich in Parametern. Die FTS-Ausdrücke werden
// aus bereinigten Begriffen (nur Buchstaben/Ziffern) gebaut und ebenfalls als
// Parameter übergeben.

import { escapeLike, foldDe, norm, sanitizeTerm } from "../util/normalize.js";

export const RESULT_COLUMNS = [
  "id", "header_msg_id", "account_id", "folder_id", "folder_name", "folder_type", "date",
  "author_name", "author_email", "recipients", "subject", "has_attachment",
  "attachment_types", "tags", "is_read", "is_flagged", "score",
];

// ------------------------------------------------------------ FTS-Ausdrücke

function clean(t) {
  return foldDe(sanitizeTerm(t));
}

/** Einzelner Präfix-Begriff. */
function ftsTerm(t, mode) {
  const c = clean(t);
  if (!c) return null;
  // FTS5: "begriff"*   FTS4: "begriff*"
  return mode === "fts4" ? `"${c}*"` : `"${c}"*`;
}

function ftsPhrase(p) {
  const c = clean(p);
  return c ? `"${c}"` : null;
}

function ftsGroup(group, mode) {
  const parts = group.map((t) => ftsTerm(t, mode)).filter(Boolean);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  // FTS4 (Standard-Syntax): OR bindet stärker als implizites UND, Klammern evtl. nicht verfügbar
  return mode === "fts4" ? parts.join(" OR ") : `(${parts.join(" OR ")})`;
}

function ftsSubject(t, mode) {
  const c = clean(t);
  if (!c) return null;
  return mode === "fts4" ? `subject:${c}*` : `subject : "${c}"*`;
}

/** Trigramm-Ausdruck (Teilwortsuche im Betreff). Nur Begriffe ab 3 Zeichen. */
function trigramGroup(group) {
  const parts = group.map((t) => norm(clean(t))).filter((t) => t.length >= 3);
  if (parts.length !== group.length || !parts.length) return null;
  return parts.map((t) => `"${t}"`).join(" OR ");
}

/**
 * Teilwortsuche im Betreff ohne Trigramm-Index (FTS4 bzw. FTS5 ohne Trigramm):
 * LIKE auf dem normalisierten Betreff. Nur Begriffe ab 3 Zeichen; sonst null.
 */
function subjectLikeGroup(group, params) {
  const parts = group.map((t) => norm(clean(t))).filter((t) => t.length >= 3);
  if (parts.length !== group.length || !parts.length) return null;
  params.push(...parts.map((t) => `%${escapeLike(t)}%`));
  return parts.map(() => "m.subject_norm LIKE ? ESCAPE '\\'").join(" OR ");
}

// ------------------------------------------------------------ Personen

function personCondition(p, field, myEmails, params) {
  // field: "from" | "to"
  const emails = p.me ? myEmails : p.resolved?.emails ?? (p.email ? [p.email] : null);
  if (emails) {
    if (!emails.length) return "0"; // "von mir" ohne bekannte eigene Adressen
    if (field === "from") {
      params.push(...emails.map((e) => e.toLowerCase()));
      return `m.author_email IN (${emails.map(() => "?").join(",")})`;
    }
    const parts = emails.map((e) => {
      params.push(`%${escapeLike(norm(e))}%`);
      return "m.recipients_norm LIKE ? ESCAPE '\\'";
    });
    return `(${parts.join(" OR ")})`;
  }
  params.push(`%${escapeLike(norm(p.name))}%`);
  return field === "from"
    ? "m.author_norm LIKE ? ESCAPE '\\'"
    : "m.recipients_norm LIKE ? ESCAPE '\\'";
}

function personsCondition(list, field, myEmails, params) {
  if (!list.length) return null;
  const parts = list.map((p) => personCondition(p, field, myEmails, params));
  return parts.length === 1 ? parts[0] : `(${parts.join(" OR ")})`;
}

// ------------------------------------------------------------ Hauptfunktion

/**
 * @param q        Ergebnis von parseQuery (ggf. nach resolvePeople)
 * @param caps     Fähigkeiten aus migrate() ({ ftsMode, trigram })
 * @param options  { myEmails, sort: "date"|"relevance", limit, offset, dedupe, includeTrash }
 * @returns {{ sql: string, params: any[], columns: string[] }}
 */
export function buildSearchSql(q, caps, options = {}) {
  const {
    myEmails = [],
    sort = "date",
    limit = 200,
    offset = 0,
    dedupe = true,
    includeTrash = false,
    termsIndex = false, // Modus „Zusammensetzungen beim Indexieren“: Zusatzindex terms_fts mit durchsuchen
    folderId = null, // nur diesen Ordner durchsuchen (Papierkorb/Spam-Ausschluss entfällt dann)
    fields = null, // Felder, in denen der Freitext gesucht wird: Teilmenge von from|to|subject|body (null/leer/alle = überall)
  } = options;
  const mode = caps.ftsMode === "fts4" ? "fts4" : "fts5";
  const where = [];
  const params = [];
  // Feldwahl (nur FTS5): Spaltenfilter vor den Ausdruck setzen
  const FIELD_COLS = { from: ["author_name"], to: ["recipients"], subject: ["subject"], body: ["body", "attachment_names", "attachment_text"] };
  const chosen = Array.isArray(fields) ? [...new Set(fields.filter((f) => f in FIELD_COLS))] : [];
  const restrict = mode === "fts5" && chosen.length > 0 && chosen.length < 4;
  const onlyCols = restrict ? `{${chosen.flatMap((f) => FIELD_COLS[f]).join(" ")}} : ` : "";
  const withCols = (expr) => (restrict && !expr.startsWith("subject :") ? `${onlyCols}(${expr})` : expr);
  const allowSubjectFallback = !restrict || chosen.includes("subject"); // Trigramm/LIKE betreffen nur den Betreff
  const FTS_IN = "m.id IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)";
  const TRI_IN = "m.id IN (SELECT rowid FROM subject_trigram WHERE subject_trigram MATCH ?)";
  const likeParams = [];
  const positive = []; // für das Relevanz-Ranking

  // Suchbegriffe: jede ODER-Gruppe muss treffen (Volltext ODER Teilwort im Betreff ODER Zerlegung terms_de)
  const TERMS_IN = "m.id IN (SELECT rowid FROM terms_fts WHERE terms_fts MATCH ?)";
  const termsOn = Boolean(termsIndex && caps.termsFts && mode === "fts5" && (!restrict || chosen.includes("body")));
  for (const group of q.terms) {
    const raw = ftsGroup(group, mode);
    if (!raw) continue;
    const expr = withCols(raw);
    positive.push(expr);
    const alts = [{ sql: FTS_IN, params: [expr] }];
    const tri = caps.trigram && allowSubjectFallback ? trigramGroup(group) : null;
    if (tri) {
      alts.push({ sql: TRI_IN, params: [tri] });
    } else {
      const like = caps.trigram || !allowSubjectFallback ? null : subjectLikeGroup(group, likeParams);
      if (like) alts.push({ sql: `(${like})`, params: likeParams.splice(0) });
    }
    if (termsOn) alts.push({ sql: TERMS_IN, params: [raw] });
    where.push(alts.length > 1 ? `(${alts.map((a) => a.sql).join(" OR ")})` : alts[0].sql);
    params.push(...alts.flatMap((a) => a.params));
  }
  for (const p of q.phrases) {
    const raw = ftsPhrase(p);
    if (!raw) continue;
    const expr = withCols(raw);
    positive.push(expr);
    where.push(FTS_IN);
    params.push(expr);
  }
  for (const t of q.subjectTerms) {
    const expr = ftsSubject(t, mode);
    if (!expr) continue;
    positive.push(expr);
    const tri = caps.trigram ? trigramGroup([t]) : null;
    if (tri) {
      where.push(`(${FTS_IN} OR ${TRI_IN})`);
      params.push(expr, tri);
    } else {
      const like = caps.trigram ? null : subjectLikeGroup([t], likeParams);
      if (like) {
        where.push(`(${FTS_IN} OR (${like}))`);
        params.push(expr, ...likeParams.splice(0));
      } else {
        where.push(FTS_IN);
        params.push(expr);
      }
    }
  }
  const excl = q.exclude
    .map((t) => (t.includes(" ") ? ftsPhrase(t) : ftsTerm(t, mode)))
    .filter(Boolean);
  if (excl.length) {
    where.push("m.id NOT IN (SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?)");
    params.push(excl.join(" OR "));
  }

  // Personen
  const fromC = personsCondition(q.from, "from", myEmails, params);
  if (fromC) where.push(fromC);
  const toC = personsCondition(q.to, "to", myEmails, params);
  if (toC) where.push(toC);
  if (q.involves.length) {
    const a = personsCondition(q.involves, "from", myEmails, params);
    const b = personsCondition(q.involves, "to", myEmails, params);
    where.push(`(${a} OR ${b})`);
  }

  // Zeitraum
  if (q.dateFrom != null) (where.push("m.date >= ?"), params.push(q.dateFrom));
  if (q.dateTo != null) (where.push("m.date < ?"), params.push(q.dateTo));

  // Anhänge
  if (q.hasAttachment === true) where.push("m.has_attachment = 1");
  if (q.hasAttachment === false) where.push("m.has_attachment = 0");
  if (q.attachmentTypes.length) {
    where.push(`(${q.attachmentTypes.map(() => "m.attachment_types LIKE ?").join(" OR ")})`);
    params.push(...q.attachmentTypes.map((t) => `%,${t},%`));
  }

  // Status, Schlagwörter, Ordner
  if (q.unread === true) where.push("m.is_read = 0");
  if (q.unread === false) where.push("m.is_read = 1");
  if (q.flagged === true) where.push("m.is_flagged = 1");
  for (const t of q.tags) {
    where.push("m.tags LIKE ? ESCAPE '\\'");
    params.push(`%,${escapeLike(norm(t))},%`);
  }
  if (folderId) {
    where.push("m.folder_id = ?");
    params.push(String(folderId));
  } else if (q.folder?.type) {
    where.push("m.folder_type = ?");
    params.push(q.folder.type);
  } else if (q.folder?.name) {
    where.push("m.folder_name LIKE ? ESCAPE '\\'");
    params.push(`%${escapeLike(q.folder.name)}%`);
  } else if (!includeTrash) {
    where.push("m.folder_type NOT IN ('trash', 'junk')");
  }

  // Relevanz (nur FTS5): bm25 des gesamten positiven Ausdrucks; Spaltengewichte: Betreff 3, Absender 2, Empfänger 1,5, Text/Anhang 1
  // bm25 wird einmal für alle Treffer berechnet (CTE + LEFT JOIN), nicht pro Zeile.
  let scoreSql = "NULL";
  let withSql = "";
  let joinSql = "";
  const scoreParams = [];
  if (sort === "relevance" && mode === "fts5" && positive.length) {
    withSql =
      "WITH ranked AS MATERIALIZED (SELECT rowid AS rid, bm25(messages_fts, 3, 2, 1.5, 1, 1, 1) AS score FROM messages_fts WHERE messages_fts MATCH ?)\n";
    joinSql = "LEFT JOIN ranked r ON r.rid = m.id";
    scoreSql = "r.score";
    scoreParams.push(positive.join(" AND "));
  }

  const whereSql = where.length ? `WHERE ${where.join("\n  AND ")}` : "";
  const cols =
    "m.id, m.header_msg_id, m.account_id, m.folder_id, m.folder_name, m.folder_type, m.date, " +
    "m.author_name, m.author_email, m.recipients, m.subject, m.has_attachment, " +
    "m.attachment_types, m.tags, m.is_read, m.is_flagged";
  const order =
    sort === "relevance" && scoreParams.length
      ? "ORDER BY score IS NULL, score, date DESC"
      : "ORDER BY date DESC";

  let sql;
  if (dedupe) {
    // Dieselbe Nachricht in mehreren Ordnern (Kopien) nur einmal zeigen,
    // bevorzugt Posteingang > Archiv > Gesendet > Rest > Papierkorb.
    sql = `${withSql}SELECT ${RESULT_COLUMNS.join(", ")} FROM (
  SELECT ${cols}, ${scoreSql} AS score,
    ROW_NUMBER() OVER (PARTITION BY m.header_msg_id ORDER BY
      CASE m.folder_type WHEN 'inbox' THEN 0 WHEN 'archives' THEN 1 WHEN 'sent' THEN 2
        WHEN 'trash' THEN 9 WHEN 'junk' THEN 9 ELSE 3 END) AS rn
  FROM messages m ${joinSql}
  ${whereSql}
) WHERE rn = 1
${order}
LIMIT ? OFFSET ?`;
  } else {
    sql = `${withSql}SELECT ${cols}, ${scoreSql} AS score
FROM messages m ${joinSql}
${whereSql}
${order}
LIMIT ? OFFSET ?`;
  }
  // Reihenfolge der Platzhalter: CTE (Relevanz) steht vor dem WHERE.
  return {
    sql,
    params: [...scoreParams, ...params, limit, offset],
    columns: RESULT_COLUMNS,
  };
}
