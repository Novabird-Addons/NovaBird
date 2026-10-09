/* Prüft parser.js: Suchtext → Kriterien. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { parseQuery, parseDate, isEmpty, isTooShort } = require("../parser.js");


test("Leere Eingabe ist leer", () => {
  assert.ok(isEmpty(parseQuery("")));
  assert.ok(isEmpty(parseQuery("   ")));
});

test("von:name", () => {
  const c = parseQuery("von:jonas");
  assert.equal(c.author, "jonas");
  assert.equal(c.freeText, undefined);
});

test("Freitext, mehrere Wörter", () => {
  assert.equal(parseQuery("rechnung jonas").freeText, "rechnung jonas");
});

test("Werte mit Leerzeichen in Anführungszeichen", () => {
  const c = parseQuery('von:"Berger, Jonas" betreff:"KW 41"');
  assert.equal(c.author, "Berger, Jonas");
  assert.equal(c.subject, "KW 41");
});

test("Phrase in Anführungszeichen bleibt Freitext", () => {
  assert.equal(parseQuery('"angebot carport"').freeText, "angebot carport");
});

test("anh:ja und anh:nein", () => {
  assert.equal(parseQuery("anh:ja").attachment, true);
  assert.equal(parseQuery("anh:nein").attachment, false);
});

test("ungelesen, markiert, hier", () => {
  const c = parseQuery("ungelesen markiert hier");
  assert.equal(c.unread, true);
  assert.equal(c.flagged, true);
  assert.equal(c.scope, "folder");
});

test("Datum: ISO, deutsch, relativ", () => {
  const iso = parseDate("2026-01-31");
  assert.deepEqual([iso.getFullYear(), iso.getMonth(), iso.getDate()], [2026, 0, 31]);
  const de = parseDate("31.01.2026");
  assert.deepEqual([de.getFullYear(), de.getMonth(), de.getDate()], [2026, 0, 31]);
  const short = parseDate("31.1.26");
  assert.equal(short.getFullYear(), 2026);
  const rel = parseDate("7t");
  const diff = Math.round((Date.now() - rel.getTime()) / 864e5);
  assert.equal(diff, 7);
});

test("anh:ja seit:30t kombiniert", () => {
  const c = parseQuery("anh:ja seit:30t rechnung");
  assert.equal(c.attachment, true);
  assert.ok(c.fromDate < Date.now());
  assert.equal(c.freeText, "rechnung");
});

test("Unbekanntes Kürzel bleibt Freitext", () => {
  assert.equal(parseQuery("foo:bar").freeText, "foo:bar");
});

test("Ungültiges Datum wird ignoriert", () => {
  assert.equal(parseQuery("seit:morgen").fromDate, undefined);
});

test("Zu kurze Suchbegriffe (< 3 Zeichen) lösen keine Live-Suche aus", () => {
  assert.ok(isTooShort(parseQuery("IT")));
  assert.ok(isTooShort(parseQuery("a")));
  assert.ok(isTooShort(parseQuery("von:it")));
  assert.ok(isTooShort(parseQuery('"it"')));
  assert.ok(!isTooShort(parseQuery("PCs")));
  assert.ok(!isTooShort(parseQuery("von:jonas")));
  assert.ok(!isTooShort(parseQuery("it jonas")));          // ein Wort reicht
  assert.ok(!isTooShort(parseQuery("")));                 // leer: eigener Pfad
  assert.ok(!isTooShort(parseQuery("ungelesen")));        // reiner Filter
  assert.ok(!isTooShort(parseQuery("seit:7t")));
  assert.ok(isTooShort(parseQuery("it seit:7t")));        // Text zu kurz, Filter ändert daran nichts
});

test("Kurzschreibweise auch auf Französisch, Spanisch, Englisch", () => {
  assert.equal(parseQuery("de:jonas").author, "jonas");
  assert.equal(parseQuery("à:petra objet:budget").recipients, "petra");
  assert.equal(parseQuery("à:petra objet:budget").subject, "budget");
  assert.equal(parseQuery("para:petra asunto:plan").subject, "plan");
  assert.equal(parseQuery("from:jonas since:2026-01-01").author, "jonas");
  assert.equal(parseQuery("pj:oui").attachment, true);
  assert.equal(parseQuery("adjunto:sí").attachment, true);
  assert.equal(parseQuery("nonlus").unread, true);
  assert.equal(parseQuery("noleído").unread, true);
  assert.equal(parseQuery("unread starred").flagged, true);
  const c = parseQuery("depuis:15/03/2026");
  assert.equal(new Date(c.fromDate).getFullYear(), 2026);
  assert.equal(new Date(c.fromDate).getMonth(), 2);
  assert.equal(new Date(c.fromDate).getDate(), 15);
});
