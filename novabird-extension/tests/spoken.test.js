/* Vorlesen: Zahlen, Datum, Uhrzeit, Beträge und Abkürzungen für die Stimme ausschreiben (ai/spoken.js), ohne Thunderbird.
 * Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const nbSpoken = require("../ai/spoken.js");
const de = s => nbSpoken.text(s, "de");
const en = s => nbSpoken.text(s, "en");

test("Deutsch: Zahlwörter und Ordnungszahlen", () => {
  const n = nbSpoken.deNumber;
  assert.equal(n(0), "null");
  assert.equal(n(1), "eins");
  assert.equal(n(21), "einundzwanzig");
  assert.equal(n(101), "einhunderteins");
  assert.equal(n(1001), "eintausendeins");
  assert.equal(n(4711), "viertausendsiebenhundertelf");
  assert.equal(n(101000), "einhunderteintausend");
  assert.equal(n(1000000), "eine Million");
  assert.equal(n(2500000), "zwei Millionen fünfhunderttausend");
  assert.equal(nbSpoken.deOrdinal(1), "ersten");
  assert.equal(nbSpoken.deOrdinal(3, "te"), "dritte");
  assert.equal(nbSpoken.deOrdinal(7), "siebten");
  assert.equal(nbSpoken.deOrdinal(20), "zwanzigsten");
  assert.equal(nbSpoken.deOrdinal(31), "einunddreißigsten");
});

test("Deutsch: Datum, Uhrzeit, Beträge, Prozent", () => {
  assert.equal(de("Fällig am 05.11.2026."), "Fällig am fünften November zweitausendsechsundzwanzig.");
  assert.equal(de("bis 5.11.26"), "bis fünften November zweitausendsechsundzwanzig");
  assert.equal(de("Zählerstand senden (bis Sa., 7.11.)"), "Zählerstand senden (bis Samstag, siebten November)");
  assert.equal(de("Der 3. Oktober ist frei."), "Der dritte Oktober ist frei.");
  assert.equal(de("am Donnerstag, 6. November"), "am Donnerstag, sechsten November");
  assert.equal(de("Termin 2026-11-14"), "Termin vierzehnten November zweitausendsechsundzwanzig");
  assert.equal(de("um 19:30 Uhr"), "um neunzehn Uhr dreißig");
  assert.equal(de("ab 9:00"), "ab neun Uhr");
  assert.equal(de("um 19.30 Uhr"), "um neunzehn Uhr dreißig");
  assert.equal(de("84,20 € offen"), "vierundachtzig Euro zwanzig offen");
  assert.equal(de("1.234,56 EUR"), "eintausendzweihundertvierunddreißig Euro sechsundfünfzig");
  assert.equal(de("€ 12,50"), "zwölf Euro fünfzig");
  assert.equal(de("85 Euro"), "fünfundachtzig Euro");
  assert.equal(de("15 % Rabatt, 2,5% Zins"), "fünfzehn Prozent Rabatt, zwei Komma fünf Prozent Zins");
});

test("Deutsch: Abkürzungen, lange Nummern, Jahreszahlen, unverändert ohne Zahlen", () => {
  assert.equal(de("z. B. heute, ca. 3 Stunden, ggf. später"), "zum Beispiel heute, circa drei Stunden, gegebenenfalls später");
  assert.equal(de("Kunden-Nr. 4711"), "Kunden-Nummer viertausendsiebenhundertelf");
  assert.equal(de("Tel. 030 1234567"), "Telefon null drei null eins zwei drei vier fünf sechs sieben");
  assert.equal(de("Klasse 5b"), "Klasse fünf b");
  assert.equal(de("1998 gegründet"), "neunzehnhundertachtundneunzig gegründet");
  assert.equal(de("12.500 Besucher"), "zwölftausendfünfhundert Besucher");
  assert.equal(de("Version 3.5 läuft"), "Version drei Punkt fünf läuft");
  assert.equal(de("Liebe Grüße, Anna"), "Liebe Grüße, Anna");
});

test("Englisch: Datum, Uhrzeit, Beträge, Prozent, Abkürzungen", () => {
  assert.equal(en("Due on November 5, 2026."), "Due on November fifth, twenty twenty-six.");
  assert.equal(en("on 2026-11-04"), "on November fourth, twenty twenty-six");
  assert.equal(en("at 3:30 pm"), "at three thirty p m");
  assert.equal(en("$1,234.50 owed"), "one thousand two hundred and thirty-four dollars fifty owed");
  assert.equal(en("25% off, e.g. today"), "twenty-five percent off, for example today");
  assert.equal(en("No. 4711"), "number four thousand seven hundred and eleven");
  assert.equal(nbSpoken.enOrdinal(22), "twenty-second");
  assert.equal(nbSpoken.enOrdinal(30), "thirtieth");
});

test("Andere Sprachen bleiben unverändert", () => {
  assert.equal(nbSpoken.text("Le 05.11.2026 à 19:30", "fr"), "Le 05.11.2026 à 19:30");
});
