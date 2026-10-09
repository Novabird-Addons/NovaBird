// Komposita im Mailtext finden („speiseplan“ findet „Wochenspeiseplan“ im Text), ohne zusätzliche Indexspalte:
// Zur Suchzeit werden aus der Wortliste des Index (fts5vocab) Wörter ergänzt, die den Suchbegriff
// MITTEN oder AM ENDE enthalten (Wörter mit dem Begriff am Anfang findet die Präfixsuche ohnehin).
// Lernt automatisch aus den eigenen Mails: neue Wörter stehen sofort in der Wortliste. Nur FTS5.

import { norm } from "../util/normalize.js";

export const MIN_LEN = 4; // kürzere Begriffe würden zu viele Wörter ergänzen; ab 4 Zeichen („plan“) sorgt die Vorsatzprüfung für Präzision
export const MAX_EXPANSIONS = 20; // je Suchbegriff, häufigste zuerst

const FUGEN = ["", "s", "n", "en", "e", "es", "er"]; // Fugenelemente: „wochen“ → „woche“, „arbeits“ → „arbeit“
const MIN_PART = 3; // der Vorsatz vor dem Suchbegriff muss ein echtes Wort sein („an“+„meldung“ zählt nicht)

/** Mögliche Wörter, die als Vorsatz in Frage kommen („wochen“ → wochen, woche …). */
function prefixForms(pre) {
  const out = [];
  for (const f of FUGEN) {
    if (f === "") out.push(pre);
    else if (pre.endsWith(f) && pre.length - f.length >= MIN_PART) out.push(pre.slice(0, -f.length));
  }
  return out;
}

// Zwischenspeicher: Die Suche in der Wortliste kostet bei großen Postfächern (300.000 Wörter) 150–400 ms je Begriff.
// Treffer je Begriff merken; verworfen nach TTL oder wenn der Index sich ändert (clearCompoundCache).
export const CACHE_TTL_MS = 10 * 60_000;
let caches = new WeakMap(); // je Datenbankobjekt
export function clearCompoundCache() {
  caches = new WeakMap();
}

export async function compoundsOf(db, term, { max = MAX_EXPANSIONS, now = Date.now() } = {}) {
  const t = norm(term);
  if (t.length < MIN_LEN || !/^[\p{L}\p{N}]+$/u.test(t)) return [];
  const key = `${t}|${max}`;
  let cache = caches.get(db);
  if (!cache) caches.set(db, (cache = new Map()));
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.list;
  const list = await computeCompounds(db, t, max);
  cache.set(key, { at: now, list });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return list;
}

async function computeCompounds(db, t, max) {
  const rows = await db.select(
    `SELECT term, doc FROM messages_vocab
     WHERE term LIKE ? AND substr(term, 1, ?) <> ? AND doc >= 2
     ORDER BY doc DESC LIMIT ?`,
    [`%${t}%`, t.length, t, max * 4],
    ["term", "doc"],
  );
  // Nur echte Zusammensetzungen: Der Vorsatz (Teil vor dem Suchbegriff) muss selbst ein Wort der Wortliste sein.
  // Das blendet Zufallstreffer aus („meldung“ → anmeldung), ohne ein Wörterbuch zu brauchen.
  const cand = rows.map((r) => ({ term: r.term, pres: new Set() }));
  for (const c of cand) {
    for (let i = c.term.indexOf(t, 1); i > 0; i = c.term.indexOf(t, i + 1)) {
      if (i >= MIN_PART) for (const f of prefixForms(c.term.slice(0, i))) c.pres.add(f);
    }
  }
  // Der Vorsatz darf selbst zusammengesetzt sein („wochen“+„dienst“ vor „plan“): alle Teilstücke mit nachschlagen
  const lookup = new Set();
  const addParts = (w, depth = 0) => {
    lookup.add(w);
    if (depth >= 2) return;
    for (let i = MIN_PART; i <= w.length - MIN_PART; i++) {
      for (const h of prefixForms(w.slice(0, i))) lookup.add(h);
      addParts(w.slice(i), depth + 1);
    }
  };
  for (const c of cand) for (const p of c.pres) addParts(p);
  const all = [...lookup];
  if (!all.length) return [];
  const known = new Set();
  for (let i = 0; i < all.length; i += 400) {
    const part = all.slice(i, i + 400);
    const rows = await db.select(`SELECT term FROM messages_vocab WHERE term IN (${part.map(() => "?").join(",")}) AND doc >= 2`, part, ["term"]);
    rows.forEach((r) => known.add(r.term));
  }
  const isWord = (w, depth = 0) => {
    if (known.has(w)) return true;
    if (depth >= 2) return false;
    for (let i = MIN_PART; i <= w.length - MIN_PART; i++) {
      if (prefixForms(w.slice(0, i)).some((h) => known.has(h)) && isWord(w.slice(i), depth + 1)) return true;
    }
    return false;
  };
  return cand
    .filter((c) => [...c.pres].some((p) => isWord(p)))
    .map((c) => c.term)
    .slice(0, max);
}

/** Kopie der Anfrage, bei der jede ODER-Gruppe der Suchbegriffe um passende Komposita erweitert ist. */
export async function expandCompounds(db, caps, query) {
  if (caps.ftsMode === "fts4" || !query.terms?.length) return query;
  const terms = [];
  let changed = false;
  for (const group of query.terms) {
    const extra = new Set();
    for (const t of group) for (const c of await compoundsOf(db, t)) extra.add(c);
    const have = new Set(group.map((x) => norm(x)));
    const add = [...extra].filter((c) => !have.has(c));
    if (add.length) changed = true;
    terms.push([...group, ...add]);
  }
  return changed ? { ...query, terms } : query;
}
