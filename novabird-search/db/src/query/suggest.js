// Tippfehler-Vorschläge („Meinten Sie …?“) aus der Wortliste des Index (fts5vocab).
// Nur bei FTS5; wird aufgerufen, wenn eine Suche 0 Treffer liefert.

import { norm } from "../util/normalize.js";
import { stem } from "../parser/stem.js";

/** Damerau-Levenshtein (mit benachbarter Vertauschung), bricht ab, sobald max überschritten ist. */
export function editDistance(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const dp = [];
  for (let i = 0; i <= a.length; i++) {
    dp[i] = [i];
  }
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let rowMin = Infinity;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, dp[i - 2][j - 2] + 1);
      dp[i][j] = v;
      rowMin = Math.min(rowMin, v);
    }
    if (rowMin > max) return max + 1;
  }
  return dp[a.length][b.length];
}

const maxDistanceFor = (len) => (len <= 5 ? 1 : 2);
const rangeOf = (prefix) => [prefix, prefix + "￿"];

async function hasPrefix(db, term) {
  const [lo, hi] = rangeOf(term);
  const rows = await db.select("SELECT term FROM messages_vocab WHERE term >= ? AND term < ? LIMIT 1", [lo, hi], ["term"]);
  return rows.length > 0;
}

/** Ähnliche Wörter aus dem Index für ein (normalisiertes) Suchwort, beste zuerst. */
export async function similarWords(db, term, { limit = 3 } = {}) {
  const maxDist = maxDistanceFor(term.length);
  const [lo, hi] = rangeOf(term[0]);
  const rows = await db.select("SELECT term, doc FROM messages_vocab WHERE term >= ? AND term < ? AND doc >= 2", [lo, hi], ["term", "doc"]);
  const found = [];
  for (const r of rows) {
    if (r.term === term || Math.abs(r.term.length - term.length) > maxDist) continue;
    const d = editDistance(term, r.term, maxDist);
    if (d <= maxDist) found.push({ term: r.term, doc: r.doc, d });
  }
  found.sort((x, y) => x.d - y.d || y.doc - x.doc);
  return found.slice(0, limit).map((f) => f.term);
}

/**
 * @param query  Ergebnis von parseQuery (terms: [[stem, …], …], subjectTerms)
 * @param raw    ursprünglicher Suchtext
 * @returns {{ text: string, words: [{ term, options }] } | null}
 */
export async function suggestForQuery(db, caps, query, raw) {
  if (caps.ftsMode === "fts4") return null;
  const words = [...query.terms.flat(), ...query.subjectTerms].map((t) => norm(t)).filter((t) => t.length >= 4 && /^[\p{L}\p{N}]+$/u.test(t));
  const options = new Map();
  for (const w of new Set(words)) {
    if (await hasPrefix(db, w)) continue; // Wort (oder Wortanfang) kommt im Index vor: kein Tippfehler
    const similar = await similarWords(db, w);
    if (similar.length) options.set(w, similar);
  }
  if (!options.size) return null;
  let replaced = false;
  const text = String(raw)
    .split(/(\s+)/)
    .map((tok) => {
      const core = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
      if (!core) return tok;
      const key = [...options.keys()].find((k) => k === norm(core) || k === norm(stem(core)));
      if (!key) return tok;
      replaced = true;
      return tok.replace(core, options.get(key)[0]);
    })
    .join("");
  if (!replaced) return null;
  return { text, words: [...options].map(([term, opts]) => ({ term, options: opts })) };
}
