// Einstiegspunkt für die Suchleiste:
//   Freitext -> parseQuery -> resolvePeople -> buildSearchSql -> Ergebnis + Chips

import { parseQuery, isEmptyQuery } from "./parser/parseQuery.js";
import { toChips } from "./parser/chips.js";
import { resolvePeople } from "./query/resolvePeople.js";
import { buildSearchSql } from "./query/buildSql.js";
import { rerank, splitBest, bestThenDate } from "./query/rank.js";
import { suggestForQuery } from "./query/suggest.js";
import { expandCompounds } from "./query/compounds.js";

/**
 * @param db      Adapter (Experiment-API oder Test)
 * @param caps    Ergebnis von migrate()
 * @param input   Freitext aus der Suchleiste ODER bereits geparste Anfrage
 *                (z. B. nach removeChip)
 * @param options { now, myEmails, sort, limit, offset, lookupContacts, includeTrash, langs, dateOrder, filters }
 *                langs: Sprachen des Parsers (Standard ["de"]); dateOrder: "dmy" | "mdy" für 3/4/2026
 *                filters: { unread, attachment, dateFrom, dateTo } aus der Oberfläche (Haken, Zeitfenster) – wirken in der
 *                Abfrage selbst, also vor der Höchstzahl (wie getippte Angaben „ungelesen“, „anh:ja“, „seit:“)
 * Ergebnis zusätzlich more: true, wenn es mehr Treffer als limit gibt (die Liste ist dann gekürzt).
 */
export async function search(db, caps, input, options = {}) {
  const parsed = typeof input === "string" ? parseQuery(input, { now: options.now, langs: options.langs, dateOrder: options.dateOrder }) : input;
  const query = await resolvePeople(db, parsed, { ...options, authorIndex: caps.authorIndex });
  const chips = toChips(query, options.langs?.[0]);
  // Relevanz: breiter holen, dann mit Bonus für neuere Mails neu ordnen und kürzen
  const relevance = options.sort === "relevance" && caps.ftsMode !== "fts4";
  const limit = options.limit ?? 200;
  // Komposita im Text: Suchbegriffe um Wörter aus der Wortliste erweitern, die den Begriff enthalten (nur für die SQL-Abfrage; Chips bleiben unverändert)
  // Filter der Oberfläche nur in die Abfrage, nicht in die Chips (die Leiste zeigt ihre Haken selbst)
  let sqlQuery = withFilters(query, options.filters);
  // Modus „Beim Indexieren“ (terms_de): die Zerlegung steckt im Index, keine Erweiterung aus der Wortliste nötig
  const termsIndex = options.compoundMode === "index" && caps.termsFts;
  try {
    if (!termsIndex) sqlQuery = await expandCompounds(db, caps, sqlQuery);
  } catch {
    // Wortliste fehlt (alter Index): ohne Erweiterung, Filter bleiben
  }
  // einen Treffer mehr holen als erlaubt: so ist ohne teures Zählen bekannt, ob die Liste gekürzt ist
  const mainOpts = { ...options, sort: relevance ? "relevance" : "date", termsIndex, dedupe: false }; // Kopien: selectUnique
  const skip = Math.max(0, Math.floor(Number(options.offset) || 0)); // Seiten: erst nach dem Entfernen der Kopien überspringen
  const copies = options.dedupe === false; // alle Kopien zeigen (Aufrufer will sie ausdrücklich)
  const got = await selectUnique(db, (n, offset) => buildSearchSql(sqlQuery, caps, { ...mainOpts, limit: n, offset }), skip + (relevance ? Math.max(limit * 3, 600) : limit + 1), copies);
  let rows = got.rows.slice(skip);
  const more = rows.length > limit || got.cut;
  rows = relevance ? rerank(rows, options.now ? +options.now : Date.now()).slice(0, limit) : rows.slice(0, limit);
  // „Beste zuerst“: die Liste nach Datum wie sonst, dazu eine kleine Relevanz-Abfrage über alle Treffer; deren starke
  // Treffer stehen oben. relevant (die besten 100 nach Relevanz) brauchen die Aufrufer, um Bedeutungstreffer einzumischen.
  let bestIds = [];
  let relevant = [];
  // Ohne Suchwort (nur von:/an:/Zeitraum …) gibt es keine Bewertung und damit keine „besten“: die zweite Abfrage entfällt
  // (sie wiederholte sonst nur die Liste nach Datum – bei „von:name“ im großen Postfach doppelte Zeit).
  const relBuild = (n, offset) => buildSearchSql(sqlQuery, caps, { ...options, sort: "relevance", termsIndex, dedupe: false, limit: n, offset });
  if (options.sort === "best" && caps.ftsMode !== "fts4" && rows.length && relBuild(1, 0).ranked) {
    const now = options.now ? +options.now : Date.now();
    relevant = rerank((await selectUnique(db, relBuild, 300, copies)).rows, now).slice(0, 100);
    ({ rows, bestIds } = bestThenDate(splitBest(relevant, { now }), rows));
  }
  // Keine Treffer: Tippfehler-Vorschlag aus der Wortliste (nur FTS5)
  let suggest = null;
  if (!rows.length && typeof input === "string") {
    try {
      suggest = await suggestForQuery(db, caps, query, input);
    } catch {
      suggest = null; // Wortliste fehlt (alter Index) -> kein Vorschlag
    }
  }
  return { query, chips, rows, bestIds, relevant, more, empty: isEmptyQuery(query), suggest };
}

// Kopien derselben Nachricht (gleiche Message-ID in mehreren Ordnern): bevorzugt Posteingang > Archiv > Gesendet > Rest >
// Papierkorb/Spam – dieselbe Wahl wie vorher ROW_NUMBER() in SQL.
const FOLDER_RANK = { inbox: 0, archives: 1, sent: 2, trash: 9, junk: 9 };
const folderRank = (type) => FOLDER_RANK[type] ?? 3;

/**
 * Treffer ohne Kopien: die Abfrage (build(n, offset), ohne dedupe) liefert sortiert, hier bleibt je Message-ID die erste
 * Stelle, belegt mit der bevorzugten Kopie. Vorher nummerierte SQL (ROW_NUMBER) alle Treffer, bevor LIMIT griff – im großen
 * Postfach Sekunden („von:jeff“ 1,2 Mio. Mails: 9,4 s → 0,4 s). Viele Kopien (z. B. Gmail „Alle Nachrichten“): weitere
 * Seiten, höchstens 5. cut: abgebrochen, obwohl es weitere Treffer gibt (dann gilt die Liste als gekürzt). copies: Kopien
 * behalten (eine Abfrage, wie dedupe: false).
 */
export async function selectUnique(db, build, want, copies = false) {
  if (copies) {
    const { sql, params, columns } = build(want, 0);
    return { rows: await db.select(sql, params, columns), cut: false };
  }
  const page = Math.max(want * 2, 200);
  const out = [];
  const at = new Map();
  let offset = 0;
  let full = false;
  for (let round = 0; round < 5; round++) {
    const { sql, params, columns } = build(page, offset);
    const rows = await db.select(sql, params, columns);
    for (const r of rows) {
      const i = at.get(r.header_msg_id);
      if (i === undefined) {
        at.set(r.header_msg_id, out.length);
        out.push(r);
      } else if (folderRank(r.folder_type) < folderRank(out[i].folder_type)) {
        out[i] = r;
      }
    }
    offset += rows.length;
    full = rows.length === page;
    if (!full || out.length >= want) break;
  }
  return { rows: out.slice(0, want), cut: full && out.length < want };
}

/**
 * Filter der Oberfläche in die Anfrage übernehmen (strenger gewinnt): unread/attachment nur „ja“ (true), Zeitraum in ms
 * (dateFrom inklusiv, dateTo exklusiv). Unbekanntes oder Ungültiges wird ignoriert.
 */
export function withFilters(query, filters) {
  if (!filters || typeof filters !== "object") return query;
  const q = { ...query };
  if (filters.unread === true) q.unread = true;
  if (filters.attachment === true) q.hasAttachment = true;
  const from = Number(filters.dateFrom);
  const to = Number(filters.dateTo);
  if (filters.dateFrom != null && Number.isFinite(from)) q.dateFrom = q.dateFrom == null ? from : Math.max(q.dateFrom, from);
  if (filters.dateTo != null && Number.isFinite(to)) q.dateTo = q.dateTo == null ? to : Math.min(q.dateTo, to);
  return q;
}

/**
 * Bedeutungssuche: ihre Kandidaten (Message-IDs) auf dieselben Bedingungen wie die Wortsuche beschränken – von:/an:/
 * beteiligt, Zeitraum, Anhang(-typ), Status, Schlagwort, Ordner –, ohne die Suchwörter selbst und ohne Wort-Ausschlüsse.
 * Ergebnis: Set der erlaubten IDs oder null, wenn die Anfrage außer Suchwörtern keine Bedingung hat.
 */
export async function filterIds(db, caps, input, ids, options = {}) {
  const parsed = typeof input === "string" ? parseQuery(input, { now: options.now, langs: options.langs, dateOrder: options.dateOrder }) : input;
  // Wörter (auch „nicht X“ als Ausschluss) bleiben der Bedeutung überlassen: „Server nicht erreichbar“ ist ein Satz, kein Filter
  const query = { ...(await resolvePeople(db, parsed, { ...options, authorIndex: caps.authorIndex })), terms: [], phrases: [], subjectTerms: [], exclude: [] };
  if (isEmptyQuery(query)) return null;
  const allowed = new Set();
  for (let i = 0; i < ids.length; i += 500) {
    const { sql, params, columns } = buildSearchSql(query, caps, { ...options, sort: "date", limit: -1, offset: 0, dedupe: false, onlyIds: ids.slice(i, i + 500) });
    for (const r of await db.select(sql, params, columns)) allowed.add(r.header_msg_id);
  }
  return allowed;
}

export { parseQuery } from "./parser/parseQuery.js";
export { toChips, removeChip } from "./parser/chips.js";
export { buildSearchSql } from "./query/buildSql.js";
export { rerank, recencyWeight, splitBest, fuseBest, bestThenDate, BEST_MAX } from "./query/rank.js";
export { suggestForQuery, editDistance, similarWords } from "./query/suggest.js";
export { compoundsOf, expandCompounds, clearCompoundCache, refreshVocabWords, vocabWordsBuiltAt, VOCAB_TABLE, VOCAB_VIEW } from "./query/compounds.js";
export { resolvePeople } from "./query/resolvePeople.js";
export { migrate, createAuthorIndex, hasAuthorIndex } from "./db/schema.js";
export * as repository from "./db/repository.js";
export { createExperimentAdapter } from "./db/adapter.js";
