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
 * @param options { now, myEmails, sort, limit, offset, lookupContacts, includeTrash, langs, dateOrder }
 *                langs: Sprachen des Parsers (Standard ["de"]); dateOrder: "dmy" | "mdy" für 3/4/2026
 */
export async function search(db, caps, input, options = {}) {
  const parsed = typeof input === "string" ? parseQuery(input, { now: options.now, langs: options.langs, dateOrder: options.dateOrder }) : input;
  const query = await resolvePeople(db, parsed, options);
  const chips = toChips(query, options.langs?.[0]);
  // Relevanz: breiter holen, dann mit Bonus für neuere Mails neu ordnen und kürzen
  const relevance = options.sort === "relevance" && caps.ftsMode !== "fts4";
  const limit = options.limit ?? 200;
  // Komposita im Text: Suchbegriffe um Wörter aus der Wortliste erweitern, die den Begriff enthalten (nur für die SQL-Abfrage; Chips bleiben unverändert)
  let sqlQuery = query;
  // Modus „Beim Indexieren“ (terms_de): die Zerlegung steckt im Index, keine Erweiterung aus der Wortliste nötig
  const termsIndex = options.compoundMode === "index" && caps.termsFts;
  try {
    if (!termsIndex) sqlQuery = await expandCompounds(db, caps, query);
  } catch {
    sqlQuery = query; // Wortliste fehlt (alter Index)
  }
  const { sql, params, columns } = buildSearchSql(sqlQuery, caps, relevance ? { ...options, termsIndex, limit: Math.max(limit * 3, 600) } : { ...options, sort: "date", termsIndex });
  let rows = await db.select(sql, params, columns);
  if (relevance) rows = rerank(rows, options.now ? +options.now : Date.now()).slice(0, limit);
  // „Beste zuerst“: die Liste nach Datum wie sonst, dazu eine kleine Relevanz-Abfrage über alle Treffer; deren starke
  // Treffer stehen oben. relevant (die besten 100 nach Relevanz) brauchen die Aufrufer, um Bedeutungstreffer einzumischen.
  let bestIds = [];
  let relevant = [];
  if (options.sort === "best" && caps.ftsMode !== "fts4" && rows.length) {
    const now = options.now ? +options.now : Date.now();
    const rel = buildSearchSql(sqlQuery, caps, { ...options, sort: "relevance", termsIndex, limit: 300, offset: 0 });
    relevant = rerank(await db.select(rel.sql, rel.params, rel.columns), now).slice(0, 100);
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
  return { query, chips, rows, bestIds, relevant, empty: isEmptyQuery(query), suggest };
}

/**
 * Bedeutungssuche: ihre Kandidaten (Message-IDs) auf dieselben Bedingungen wie die Wortsuche beschränken – von:/an:/
 * beteiligt, Zeitraum, Anhang(-typ), Status, Schlagwort, Ordner –, ohne die Suchwörter selbst und ohne Wort-Ausschlüsse.
 * Ergebnis: Set der erlaubten IDs oder null, wenn die Anfrage außer Suchwörtern keine Bedingung hat.
 */
export async function filterIds(db, caps, input, ids, options = {}) {
  const parsed = typeof input === "string" ? parseQuery(input, { now: options.now, langs: options.langs, dateOrder: options.dateOrder }) : input;
  // Wörter (auch „nicht X“ als Ausschluss) bleiben der Bedeutung überlassen: „Server nicht erreichbar“ ist ein Satz, kein Filter
  const query = { ...(await resolvePeople(db, parsed, options)), terms: [], phrases: [], subjectTerms: [], exclude: [] };
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
export { migrate } from "./db/schema.js";
export * as repository from "./db/repository.js";
export { createExperimentAdapter } from "./db/adapter.js";
