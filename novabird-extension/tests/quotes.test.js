/* KI: Nur die aktuelle Mail – zitierter Verlauf wird weggelassen (nbAI.stripQuotedText in ai/ai.js).
 * Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const code = fs.readFileSync(path.join(__dirname, "..", "ai", "ai.js"), "utf8") + "\nglobalThis.nbAI = nbAI;";
const ctx = { crypto: globalThis.crypto, console, URL, TextEncoder, TextDecoder };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const strip = ctx.nbAI.stripQuotedText;

test("Thunderbird-Antwort: „Am … schrieb“ + >-Zitat fällt weg", () => {
  const text = [
    "Hallo Anna,",
    "",
    "passt, ich komme am Donnerstag um 19:30.",
    "",
    "Gruß Tom",
    "",
    "Am 30.10.2026 um 18:10 schrieb Anna Schmidt:",
    "> Hallo Tom,",
    "> der Elternabend ist am Donnerstag.",
    "> Kommst du?",
  ].join("\n");
  const out = strip(text);
  assert.match(out, /19:30/);
  assert.doesNotMatch(out, /Elternabend|schrieb|Kommst/);
});

test("Outlook-Antwort: „Von: … Gesendet:“ und alles darunter fällt weg (ohne >)", () => {
  const text = [
    "Hallo Herr Weber,",
    "die Rechnung ist bezahlt.",
    "",
    "Von: Max Weber <max@firma.example>",
    "Gesendet: Donnerstag, 30. Oktober 2026 09:12",
    "An: Tom",
    "Betreff: Rechnung 4711",
    "",
    "Bitte zahlen Sie bis 14.11. den Betrag von 85 Euro.",
  ].join("\n");
  const out = strip(text);
  assert.match(out, /bezahlt/);
  assert.doesNotMatch(out, /85 Euro|Gesendet/);
});

test("„-----Ursprüngliche Nachricht-----“ schneidet ab", () => {
  const out = strip("Danke, erledigt.\n\n-----Ursprüngliche Nachricht-----\nVon: X\nAlte Frage nach dem Termin am 3.11.");
  assert.equal(out, "Danke, erledigt.");
});

test("Antwort zwischen den Zitaten bleibt erhalten", () => {
  const text = [
    "Am 30.10.2026 um 18:10 schrieb Anna Schmidt:",
    "> Kommst du am Donnerstag?",
    "Ja, um 19:30.",
    "> Bringst du den Kuchen mit?",
    "Nein, Salat.",
  ].join("\n");
  const out = strip(text);
  assert.match(out, /19:30/);
  assert.match(out, /Salat/);
  assert.doesNotMatch(out, /Kuchen|schrieb/);
});

test("umgebrochene Zeile „On … wrote:“ (zwei Zeilen) wird erkannt", () => {
  const text = "Sounds good, see you Tuesday.\n\nOn Fri, Oct 31, 2026 at 7:05 AM Mark Ellis\n<mark@agency.example> wrote:\nLet's do the kickoff on Tuesday, November 4.";
  const out = strip(text);
  assert.equal(out, "Sounds good, see you Tuesday.");
});

test("Mail ohne Zitat bleibt unverändert", () => {
  const text = "Liebe Eltern,\n\nder Elternabend ist am Donnerstag, 6. November, um 19:30 Uhr.\nAm Ende gibt es Kuchen.";
  assert.equal(strip(text), text);
});
