// Einstiegspunkt für die Suchleiste:
//   Freitext -> parseQuery -> resolvePeople -> buildSearchSql -> Ergebnis + Chips

import { parseQuery, isEmptyQuery } from "./parser/parseQuery.js";
import { toChips } from "./parser/chips.js";
import { resolvePeople } from "./query/resolvePeople.js";
import { buildSearchSql } from "./query/buildSql.js";
import { rerank } from "./query/rank.js";
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
  const { sql, params, columns } = buildSearchSql(sqlQuery, caps, relevance ? { ...options, termsIndex, limit: Math.max(limit * 3, 600) } : { ...options, termsIndex });
  let rows = await db.select(sql, params, columns);
  if (relevance) rows = rerank(rows, options.now ? +options.now : Date.now()).slice(0, limit);
  // Keine Treffer: Tippfehler-Vorschlag aus der Wortliste (nur FTS5)
  let suggest = null;
  if (!rows.length && typeof input === "string") {
    try {
      suggest = await suggestForQuery(db, caps, query, input);
    } catch {
      suggest = null; // Wortliste fehlt (alter Index) -> kein Vorschlag
    }
  }
  return { query, chips, rows, empty: isEmptyQuery(query), suggest };
}

export { parseQuery } from "./parser/parseQuery.js";
export { toChips, removeChip } from "./parser/chips.js";
export { buildSearchSql } from "./query/buildSql.js";
export { rerank, recencyWeight } from "./query/rank.js";
export { suggestForQuery, editDistance, similarWords } from "./query/suggest.js";
export { compoundsOf, expandCompounds, clearCompoundCache } from "./query/compounds.js";
export { resolvePeople } from "./query/resolvePeople.js";
export { migrate } from "./db/schema.js";
export * as repository from "./db/repository.js";
export { createExperimentAdapter } from "./db/adapter.js";
