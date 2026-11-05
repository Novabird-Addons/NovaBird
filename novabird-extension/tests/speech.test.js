/* Vorlesen: Satzteilung (nbAI.sentences) und Spracherkennung (nbAI.guessLang) aus ai/ai.js, ohne Thunderbird.
 * Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

// wie im Add-on: shared/nbnet.js vor ai/ai.js
const src = ["../../shared/nbnet.js", "../ai/ai.js"].map(f => fs.readFileSync(path.join(__dirname, f), "utf8")).join("\n");
const ctx = vm.createContext({ crypto, TextEncoder, TextDecoder, btoa, atob, console });
vm.runInContext(src + "\nthis.nbAI = nbAI;", ctx);
const { sentences, quickStart, guessLang } = ctx.nbAI;

const SUMMARY = `**Kernpunkte**
- Herr Becker bittet um einen Termin für die Abnahme der Heizungsanlage
- Vorschlag: Dienstag, 4. November, 10 Uhr. Alternativ geht auch Mittwoch.
- Die Rechnung über 1.240 € ist z. B. bis Ende des Monats fällig.

**Was zu tun ist:** Termin bestätigen oder zwei Alternativen nennen.`;

test("Sätze: ohne Markdown, Stichpunkt bekommt einen Punkt, kurze Überschrift wird angehängt", () => {
  const s = sentences(SUMMARY);
  assert.ok(s.every(x => !/\*\*|^[-•]/.test(x)), s.join(" | "));
  assert.ok(s.some(x => x.endsWith("Heizungsanlage.")));
  assert.ok(!s.includes("Kernpunkte."));
  assert.equal(s.length, 5);
});

test("Sätze: Abkürzungen und Ordnungszahlen teilen nicht", () => {
  const s = sentences(SUMMARY);
  assert.ok(s.some(x => x.includes("z. B. bis Ende")));
  assert.ok(s.some(x => x.includes("4. November, 10 Uhr.")));
  assert.deepEqual([...sentences("Dr. Meier kommt am Montag um 9 Uhr ins Büro. Danach gibt es eine kurze Pause.")],
    ["Dr. Meier kommt am Montag um 9 Uhr ins Büro.", "Danach gibt es eine kurze Pause."]);
});

test("Sätze: lange werden an Kommas geteilt (höchstens 280 Zeichen), leerer Text gibt nichts", () => {
  const long = "Wort, ".repeat(120) + "Ende.";
  const s = sentences(long);
  assert.ok(s.length > 1 && s.every(x => x.length <= 280));
  assert.equal(s.join(" ").replace(/\s+/g, " ").length >= long.length - 5, true);
  assert.deepEqual([...sentences("  \n\n ")], []);
});

test("Schneller Start: kurzer erster Satz bleibt ganz", () => {
  const s = ["Die Rechnung ist da.", "Bitte bis Freitag zahlen."];
  assert.deepEqual([...quickStart(s)], s);
  assert.deepEqual([...quickStart([])], []);
});

test("Schneller Start: langer erster Satz am letzten Komma vor Zeichen 100 geteilt", () => {
  const first = "Herr Meier schickt die Rechnung für die Wartung der Heizung im Oktober, " +
    "die Summe beträgt 120 Euro, fällig ist sie bis zum 15. November.";
  assert.deepEqual([...quickStart([first, "Zweiter Satz."])], [
    "Herr Meier schickt die Rechnung für die Wartung der Heizung im Oktober, die Summe beträgt 120 Euro,",
    "fällig ist sie bis zum 15. November.",
    "Zweiter Satz.",
  ]);
  // nur der erste Satz wird geteilt
  assert.deepEqual([...quickStart(["Kurz und gut.", first])], ["Kurz und gut.", first]);
});

test("Schneller Start: ohne Komma erst ab 160 Zeichen an einem Leerzeichen", () => {
  const medium = "Wort ".repeat(25).trim() + ".";
  assert.deepEqual([...quickStart([medium])], [medium]);
  const long = "Wort ".repeat(40).trim() + ".";
  const parts = quickStart([long]);
  assert.equal(parts.length, 2);
  assert.ok(parts[0].length <= 100);
  assert.equal(parts.join(" "), long);
});

test("Sprache am Text erkennen, sonst Rückfall", () => {
  assert.equal(guessLang(SUMMARY, "en"), "de");
  assert.equal(guessLang("Mr. Becker asks for an appointment and the invoice is due by the end of the month.", "de"), "en");
  assert.equal(guessLang("Monsieur Becker demande un rendez-vous pour la réception et la facture est due à la fin du mois.", "de"), "fr");
  assert.equal(guessLang("El señor Becker pide una cita para la revisión y la factura vence a final de mes.", "de"), "es");
  assert.equal(guessLang("OK", "de"), "de");
});

test("Tempo: Länge passt, Tonhöhe bleibt (WSOLA)", () => {
  const { nbStretch } = require(path.join(__dirname, "..", "ai", "speech.js"));
  const sr = 24000;
  const x = Float32Array.from({ length: sr * 2 }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / sr) * 0.5);
  const freq = y => {
    let z = 0;
    for (let i = 1; i < y.length; i++) if (y[i - 1] < 0 && y[i] >= 0) z++;
    return (z / y.length) * sr;
  };
  for (const r of [0.8, 1.2, 1.5]) {
    const y = nbStretch(x, r, sr);
    assert.ok(Math.abs(y.length / sr - 2 / r) < 0.06, `${r}: ${y.length / sr} s`);
    assert.ok(Math.abs(freq(y) - 200) < 6, `${r}: ${freq(y)} Hz`);
  }
  assert.equal(nbStretch(x, 1, sr), x);
});
