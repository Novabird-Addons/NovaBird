// Komposita im Mailtext finden („speiseplan“ findet „Wochenspeiseplan“ im Text), ohne zusätzliche Indexspalte:
// Zur Suchzeit werden aus der Wortliste des Index Wörter ergänzt, die den Suchbegriff
// MITTEN oder AM ENDE enthalten (Wörter mit dem Begriff am Anfang findet die Präfixsuche ohnehin).
// Lernt automatisch aus den eigenen Mails (Wortliste = Wörter des Index). Nur FTS5.

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

// Wortliste: eigene Tabelle vocab_words (abgeleitet aus der fts5vocab-Sicht messages_vocab, nur doc ≥ 2 – genau die Wörter,
// die hier gebraucht werden), solange sie nicht gebaut ist die Sicht selbst. Die Sicht muss für jede Abfrage den ganzen
// Volltextindex durchgehen (in großen echten Postfächern weit über eine Sekunde); die Tabelle ist eine einfache Liste.
// Inhalt gleich, nur aufgefrischt statt live (refreshVocabWords, nach Indexläufen und im Leerlauf).
export const VOCAB_VIEW = "messages_vocab";
export const VOCAB_TABLE = "vocab_words";
const sourceOf = (table) => (table === VOCAB_TABLE ? VOCAB_TABLE : VOCAB_VIEW);

// Zwischenspeicher in zwei Stufen:
// 1. Ergebnis je Begriff (Liste der Zusammensetzungen).
// 2. Wörter je Tippstand: Was „galaxu“ enthält, enthält auch „galax“ – beim Weitertippen wird der längere Stand im Speicher
//    aus den Wörtern des kürzeren gefiltert statt neu gesucht (gleiches Ergebnis).
// Verworfen nach TTL oder wenn sich Index bzw. Wortliste ändern (clearCompoundCache).
export const CACHE_TTL_MS = 10 * 60_000;
export const SCAN_MAX = 20_000; // so viele Wörter je Tippstand im Speicher; mehr = nicht zwischenspeichern, gezielt abfragen
let caches = new WeakMap(); // je Datenbankobjekt: Ergebnisse
let scans = new WeakMap(); // je Datenbankobjekt: Wörter je Tippstand
export function clearCompoundCache() {
  caches = new WeakMap();
  scans = new WeakMap();
}

export async function compoundsOf(db, term, { max = MAX_EXPANSIONS, now = Date.now(), table = VOCAB_VIEW } = {}) {
  const t = norm(term);
  if (t.length < MIN_LEN || !/^[\p{L}\p{N}]+$/u.test(t)) return [];
  const src = sourceOf(table);
  const key = `${src}|${t}|${max}`;
  let cache = caches.get(db);
  if (!cache) caches.set(db, (cache = new Map()));
  const hit = cache.get(key);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.list;
  const list = await computeCompounds(db, src, t, max, now);
  cache.set(key, { at: now, list });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return list;
}

/**
 * Wörter der Wortliste (doc ≥ 2), die t enthalten und NICHT mit t beginnen, häufigste zuerst (bei Gleichstand alphabetisch),
 * höchstens limit. Nutzt die Wörter eines kürzeren, zwischengespeicherten Tippstands, wenn es einen gibt.
 */
async function candidates(db, src, t, limit, now) {
  let store = scans.get(db);
  if (!store) scans.set(db, (store = new Map()));
  let base = null;
  for (const v of store.values()) {
    if (v.src === src && now - v.at < CACHE_TTL_MS && t.includes(v.t) && (!base || v.t.length > base.t.length)) base = v;
  }
  let words;
  if (base) {
    words = base.rows.filter((r) => r.term.includes(t));
  } else {
    const rows = await db.select(
      `SELECT term, doc FROM ${src} WHERE term LIKE ? AND doc >= 2 ORDER BY doc DESC, term LIMIT ?`,
      [`%${t}%`, SCAN_MAX + 1],
      ["term", "doc"],
    );
    if (rows.length > SCAN_MAX) {
      // sehr viele Wörter (kurzer, häufiger Begriff): nicht zwischenspeichern, gezielt abfragen
      return db.select(
        `SELECT term, doc FROM ${src} WHERE term LIKE ? AND substr(term, 1, ?) <> ? AND doc >= 2 ORDER BY doc DESC, term LIMIT ?`,
        [`%${t}%`, t.length, t, limit],
        ["term", "doc"],
      );
    }
    words = rows;
    store.set(`${src}|${t}`, { src, t, at: now, rows });
    if (store.size > 50) store.delete(store.keys().next().value);
  }
  return words.filter((r) => !r.term.startsWith(t)).slice(0, limit);
}

async function computeCompounds(db, src, t, max, now) {
  const rows = await candidates(db, src, t, max * 4, now);
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
    const rows = await db.select(`SELECT term FROM ${src} WHERE term IN (${part.map(() => "?").join(",")}) AND doc >= 2`, part, ["term"]);
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
  const table = caps.vocabWords ? VOCAB_TABLE : VOCAB_VIEW;
  const terms = [];
  let changed = false;
  for (const group of query.terms) {
    const extra = new Set();
    for (const t of group) for (const c of await compoundsOf(db, t, { table })) extra.add(c);
    const have = new Set(group.map((x) => norm(x)));
    const add = [...extra].filter((c) => !have.has(c));
    if (add.length) changed = true;
    terms.push([...group, ...add]);
  }
  return changed ? { ...query, terms } : query;
}

/**
 * Eigene Wortliste (vocab_words) aus dem Volltextindex neu füllen. Kostet etwa so viel wie EINE Suche in der Sicht,
 * daher selten (nach Indexläufen, im Leerlauf). Kein Schema-Schritt: reine abgeleitete Tabelle, die ältere Versionen
 * ignorieren (Rückweg auf eine ältere Version ohne Neuaufbau möglich). Nur FTS5.
 */
export async function refreshVocabWords(db) {
  await db.batch([
    { sql: `CREATE TABLE IF NOT EXISTS ${VOCAB_TABLE} (term TEXT PRIMARY KEY, doc INTEGER NOT NULL) WITHOUT ROWID`, params: [] },
    { sql: `DELETE FROM ${VOCAB_TABLE}`, params: [] },
    { sql: `INSERT INTO ${VOCAB_TABLE}(term, doc) SELECT term, doc FROM ${VOCAB_VIEW} WHERE doc >= 2`, params: [] },
    { sql: "INSERT OR REPLACE INTO meta(key, value) VALUES ('vocab_words_at', ?)", params: [String(Date.now())] },
  ]);
  clearCompoundCache();
}

/** Zeitpunkt des letzten Auffrischens der eigenen Wortliste (0 = noch nicht gebaut). */
export async function vocabWordsBuiltAt(db) {
  const rows = await db.select("SELECT value FROM meta WHERE key = 'vocab_words_at'", [], ["value"]);
  return rows.length ? Number(rows[0].value) || 0 : 0;
}
