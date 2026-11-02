/* Zeitplan von „Was gibt's Neues?“ (ai/schedule.js): wann ist der nächste Lauf fällig – täglich zu bis zu drei Uhrzeiten
 * oder alle N Stunden. Ohne Thunderbird. Ausführen: node --test tests/ (nicht ins Paket). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const vm = require("node:vm");

const noop = () => {};
const event = { addListener: noop };
const ctx = vm.createContext({
  messenger: { notifications: { onClicked: event }, storage: { onChanged: event }, i18n: { getUILanguage: () => "de" } },
  setTimeout: noop, setInterval: noop, console, Date,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, "../ai/schedule.js"), "utf8") + "\nthis.due = nbSchedule.due;", ctx);
const due = ctx.due;
const at = (day, hm) => new Date(`2026-11-${day}T${hm}:00`).getTime();

test("täglich, mehrere Uhrzeiten: nächste Uhrzeit heute, danach morgen die erste", () => {
  const s = { mode: "daily", times: ["07:00", "12:00", "15:00"] };
  assert.equal(due(s, at("02", "07:01"), new Date(at("02", "09:00"))), at("02", "12:00"));
  assert.equal(due(s, at("02", "15:00"), new Date(at("02", "16:00"))), at("03", "07:00"));
  assert.equal(due(s, at("02", "12:00"), new Date(at("02", "12:30"))), at("02", "15:00"));
});

test("täglich: verpasste Uhrzeit wird nachgeholt, aber nur die letzte", () => {
  const s = { mode: "daily", times: ["07:00", "12:00"] };
  // Thunderbird war von gestern Abend bis 13 Uhr aus: 12:00 ist fällig (sofort), nicht zweimal
  assert.equal(due(s, at("01", "20:00"), new Date(at("02", "13:00"))), at("02", "12:00"));
});

test("täglich: alte Einstellung mit einer Uhrzeit (time) gilt weiter", () => {
  assert.equal(due({ mode: "daily", time: "08:30" }, at("02", "06:00"), new Date(at("02", "07:00"))), at("02", "08:30"));
});

test("alle N Stunden und aus", () => {
  assert.equal(due({ mode: "hours", every: 4 }, at("02", "08:00"), new Date(at("02", "09:00"))), at("02", "12:00"));
  assert.equal(due({ mode: "off" }, 0, new Date()), null);
});
