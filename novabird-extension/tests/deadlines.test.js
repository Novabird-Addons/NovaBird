/* Was steht aus einer Mail schon im Kalender? (ai/deadlines.js, inCalendar) – Grundlage dafür, dass Fristen, „Zu erledigen“
 * und Termine nicht doppelt angelegt werden, auch über geteilte Kalender des Helpers. Ohne Thunderbird.
 * Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const ctx = vm.createContext({ messenger: { i18n: { getUILanguage: () => "de" } }, console });
vm.runInContext(fs.readFileSync(path.join(__dirname, "../ai/deadlines.js"), "utf8") + "\nthis.nbDeadlines = nbDeadlines;", ctx);
const { inCalendar } = ctx.nbDeadlines;

const found = [
  { mail: "aaaaaaaaaaaaaaaaaaaaaa", type: "task", date: "2026-11-02", calendar: "Team" },
  { mail: "bbbbbbbbbbbbbbbbbbbbbb", type: "event", date: "2026-11-05", calendar: "Privat" },
];

test("Zu erledigen: irgendein Eintrag aus der Mail genügt", () => {
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa"] }), "Team");
  assert.equal(inCalendar(found, { keys: ["cccccccccccccccccccccc"] }), "");
});

test("mehrere Mails: nur gesperrt, wenn aus allen etwas im Kalender steht", () => {
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbbbbbbbb"] }), "Team");
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa", "cccccccccccccccccccccc"] }), "");
});

test("Fristen und Termine: Art und Datum müssen passen", () => {
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa"], type: "task", date: "2026-11-02" }), "Team");
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa"], type: "task", date: "2026-11-09" }), "");
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa"], type: "event", date: "2026-11-02" }), "");
  assert.equal(inCalendar(found, { keys: ["bbbbbbbbbbbbbbbbbbbbbb"], type: "event", date: "2026-11-05T19:30" }), "Privat");
});

test("ohne Kennung (lokale Mail ohne Message-ID) nie gesperrt", () => {
  assert.equal(inCalendar(found, { keys: [] }), "");
  assert.equal(inCalendar(found, { keys: [""] }), "");
  assert.equal(inCalendar(found, { keys: ["aaaaaaaaaaaaaaaaaaaaaa", ""] }), "");
});
