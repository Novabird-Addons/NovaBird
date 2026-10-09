/* Logiktests für conversation.js und settings.js (ohne Browser-API). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { dedupeByMid, normalizeSubject, parseIds, addressesOf, groupConversation, pickExpanded, rowKey, splitKey, dedupeRows, recipientNames, rowToView } = require("../conversation.js");
const { sanitizeSettings, SETTINGS_DEFAULTS } = require("../settings.js");

const msg = (id, mid, refs, date, extra = {}) => ({ id, mid, refs, subjectKey: "angebot", date, folderType: "inbox", ...extra });

test("Betreff: Präfixe und Groß-/Kleinschreibung werden ignoriert", () => {
  assert.equal(normalizeSubject("Re: AW: Fwd: Angebot  2027"), "angebot 2027");
  assert.equal(normalizeSubject("WG: Re[2]: Hallo"), "hallo");
  assert.equal(normalizeSubject(null), "");
});

test("parseIds liest References und In-Reply-To", () => {
  assert.deepEqual(parseIds(["<a@x> <b@x>", "<c@x>"]), ["a@x", "b@x", "c@x"]);
  assert.deepEqual(parseIds(undefined), []);
});

test("Kette über References, auch wenn eine Nachricht fehlt", () => {
  const list = [
    msg(1, "a", [], 1),
    msg(2, "b", ["a"], 2),
    msg(3, "d", ["c", "a"], 4),   // c fehlt, a verbindet
    msg(4, "z", ["y"], 3),        // andere Konversation
  ];
  const ids = groupConversation(2, list, { fallback: "off" }).map(m => m.id);
  assert.deepEqual(ids, [1, 2, 3]);
});

test("Geschwister mit gemeinsamem fehlendem Elternteil gehören zusammen", () => {
  const list = [msg(1, "b", ["gone"], 1), msg(2, "c", ["gone"], 2)];
  assert.equal(groupConversation(1, list, { fallback: "off" }).length, 2);
});

test("Betreff-Ersatz nur ohne Kette und abschaltbar", () => {
  const list = [msg(1, "a", [], 1, { people: ["x@a"] }), msg(2, "b", [], 2, { people: ["x@a"] })];
  assert.equal(groupConversation(1, list, { fallback: "subject" }).length, 2);
  assert.equal(groupConversation(1, list, { fallback: "off" }).length, 1);
});

test("Duplikate (gleiche Message-ID) werden zusammengelegt, Papierkorb übersprungen", () => {
  const list = [
    msg(1, "a", [], 1),
    msg(2, "b", ["a"], 2, { folderType: "trash" }),
    msg(3, "c", ["a"], 3),
    msg(4, "c", ["a"], 3, { folderType: "archives" }),
  ];
  const ids = groupConversation(1, list, { fallback: "off" }).map(m => m.id);
  assert.deepEqual(ids, [1, 3]);
});

test("Ausgewählte Nachricht im Papierkorb bleibt sichtbar", () => {
  const list = [msg(1, "a", [], 1, { folderType: "trash" }), msg(2, "b", ["a"], 2)];
  assert.deepEqual(groupConversation(1, list, { fallback: "off" }).map(m => m.id), [1, 2]);
});

test("Aufklappen: neueste, die davor und Ungelesene", () => {
  const m = [1, 2, 3, 4].map(id => ({ id, read: id !== 1 }));
  assert.deepEqual([...pickExpanded(m, "latestPrev")].sort(), [1, 3, 4]);
  assert.deepEqual([...pickExpanded(m, "latest")].sort(), [1, 4]);
  assert.equal(pickExpanded(m, "all").size, 4);
  assert.equal(pickExpanded([], "latest").size, 0);
});

test("Einstellungen: Prüfung und Standardwerte", () => {
  assert.deepEqual(sanitizeSettings(null), SETTINGS_DEFAULTS);
  const s = sanitizeSettings({ order: "x", maxHeight: 500, expand: "all", pin: "ja", attachments: "bottom" });
  assert.equal(s.order, "newest");
  assert.equal(s.maxHeight, 90);
  assert.equal(s.expand, "all");
  assert.equal(s.pin, true);
  assert.equal(s.attachments, "bottom");
});

test("Betreff-Ersatz: Zeitfenster und gemeinsamer Beteiligter nötig", () => {
  const day = 86400000;
  const list = [
    msg(1, "a", [], 1000 * day, { people: ["anna@x", "ich@y"] }),
    msg(2, "b", [], 1010 * day, { people: ["anna@x", "ich@y"] }),   // passt
    msg(3, "c", [], 1020 * day, { people: ["fremd@z", "ich@w"] }),  // anderer Beteiligter
    msg(4, "d", [], 1100 * day, { people: ["anna@x", "ich@y"] }),   // zu weit weg
  ];
  assert.deepEqual(groupConversation(1, list, { fallback: "smart" }).map(m => m.id), [1, 2]);
  assert.deepEqual(groupConversation(1, list, { fallback: "subject" }).map(m => m.id), [1, 2, 3, 4]);   // üblich: nur Betreff
  assert.deepEqual(groupConversation(1, list, { fallback: "smart", fallbackPeople: false }).map(m => m.id), [1, 2, 3]);
  assert.deepEqual(groupConversation(1, list, { fallback: "smart", fallbackDays: 200 }).map(m => m.id), [1, 2, 4]);
});

test("Einstellungen: alte Option subjectFallback und neue Regeln", () => {
  assert.equal(sanitizeSettings({ subjectFallback: false }).fallback, "off");
  assert.equal(sanitizeSettings({}).fallback, "subject");
  assert.equal(sanitizeSettings({ fallback: "smart", fallbackDays: 9999 }).fallbackDays, 365);
});

test("Adressen werden aus Anzeigenamen gelesen", () => {
  assert.deepEqual([...addressesOf(["Anna Weber <Anna@Kunde.example>", "tom@kunde.example, x@y.de"])], ["anna@kunde.example", "tom@kunde.example", "x@y.de"]);
});

test("Index-Zeilen: Schlüssel, Dubletten, Empfänger, Ansicht", () => {
  const rows = [
    { headerMessageId: "a@x", folderId: "acc:/Archiv", folderType: "archives", date: 1, authorName: "Anna", recipients: "Müller, Hans <h@x>, Tom <t@x>", snippet: "Hallo", isRead: true },
    { headerMessageId: "a@x", folderId: "acc:/INBOX", folderType: "inbox", date: 1, authorName: "Anna", recipients: "", snippet: "Hallo", isRead: false },
    { headerMessageId: "b@x", folderId: "acc:/Trash", folderType: "trash", date: 2, authorName: "", authorEmail: "b@x", recipients: "", snippet: "", isRead: true },
    { headerMessageId: "b@x", folderId: "acc:/Archiv", folderType: "archives", date: 2, authorName: "", authorEmail: "b@x", recipients: "", snippet: "", isRead: true },
  ];
  assert.deepEqual(dedupeRows(rows, "a@x", "acc:/INBOX").map(r => r.folderId), ["acc:/INBOX", "acc:/Archiv"]);
  assert.deepEqual(dedupeRows(rows, "zzz", "acc:/x").map(r => r.folderId), ["acc:/Archiv", "acc:/Archiv"]);
  assert.deepEqual(recipientNames(rows[0].recipients), ["Müller, Hans", "Tom"]);
  assert.deepEqual(splitKey(rowKey(rows[0])), { headerMessageId: "a@x", folderId: "acc:/Archiv" });
  const v = rowToView(rows[2]);
  assert.equal(v.author, "b@x");
  assert.equal(v.local, false);
  assert.equal(rowToView(rows[0]).local, true);
});

test("Einstellungen: Engine und Höchstzahl", () => {
  assert.equal(sanitizeSettings({}).engine, "auto");
  assert.equal(sanitizeSettings({ engine: "zzz" }).engine, "auto");
  assert.equal(sanitizeSettings({ limit: 1000 }).limit, 1000);
  assert.equal(sanitizeSettings({ limit: 7 }).limit, 200);
});

test("Gloda/Suche: eine Kopie je Message-ID", () => {
  const items = [
    { id: 1, mid: "a", folderType: "trash" }, { id: 2, mid: "a", folderType: "inbox" },
    { id: 3, mid: "b", folderType: "inbox" }, { id: 4, mid: "b", folderType: "archives" },
  ];
  assert.deepEqual(dedupeByMid(items, 4).map(x => x.id), [2, 4]);
  assert.deepEqual(dedupeByMid(items, 1).map(x => x.id), [1, 3]);
  assert.equal(sanitizeSettings({ engine: "gloda" }).engine, "gloda");
});
