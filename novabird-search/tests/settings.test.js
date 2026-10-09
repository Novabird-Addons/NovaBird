/* Prüft settings.js: Standardwerte und Eingabeprüfung. */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { SETTINGS_DEFAULTS, sanitizeSettings } = require("../settings.js");

test("Standardwerte bleiben unverändert", () => {
  assert.deepEqual(sanitizeSettings(SETTINGS_DEFAULTS), SETTINGS_DEFAULTS);
  assert.deepEqual(sanitizeSettings(undefined), SETTINGS_DEFAULTS);
});

test("Enter-Modus: nur bekannte Werte, frühere Einstellung wird übernommen", () => {
  assert.equal(sanitizeSettings({ enterMode: "facet" }).enterMode, "analysis");
  assert.equal(sanitizeSettings({ enterMode: "snapshot" }).enterMode, "snapshot");
  assert.equal(sanitizeSettings({ enterMode: "unsinn" }).enterMode, "ask");
  assert.equal(sanitizeSettings({ newTab: true }).enterMode, "snapshot");
  assert.equal(sanitizeSettings({ newTab: "true" }).enterMode, "ask");
  assert.equal(sanitizeSettings({ newTab: true, enterMode: "facet" }).enterMode, "analysis");
});

test("Gemeinsame Ordner sind standardmäßig an und nur mit false aus", () => {
  assert.equal(sanitizeSettings(undefined).sharedFolders, true);
  assert.equal(sanitizeSettings({ sharedFolders: false }).sharedFolders, false);
  assert.equal(sanitizeSettings({ sharedFolders: "nein" }).sharedFolders, true);
});

test("Gemeinsamer Eingang: Monate 0 bis 60, Standard 3", () => {
  assert.equal(sanitizeSettings(undefined).sharedInboxMonths, 3);
  assert.equal(sanitizeSettings({ sharedInboxMonths: 0 }).sharedInboxMonths, 0);
  assert.equal(sanitizeSettings({ sharedInboxMonths: -5 }).sharedInboxMonths, 0);
  assert.equal(sanitizeSettings({ sharedInboxMonths: 999 }).sharedInboxMonths, 60);
  assert.equal(sanitizeSettings({ sharedInboxMonths: "6" }).sharedInboxMonths, 6);
  assert.equal(sanitizeSettings({ sharedInboxMonths: "x" }).sharedInboxMonths, 3);
});

test("Konversation gruppieren: nur echtes true schaltet ein", () => {
  assert.equal(sanitizeSettings({ group: 1 }).group, false);
  assert.equal(sanitizeSettings({ group: true }).group, true);
});

test("Trefferzahl wird auf 100 bis 5000 begrenzt", () => {
  assert.equal(sanitizeSettings({ glodaLimit: 5 }).glodaLimit, 100);
  assert.equal(sanitizeSettings({ glodaLimit: 99999 }).glodaLimit, 99999);
  assert.equal(sanitizeSettings({ glodaLimit: 5e6 }).glodaLimit, 1000000);
  assert.equal(sanitizeSettings({ glodaLimit: 0 }).glodaLimit, 0); // unbegrenzt
  assert.equal(sanitizeSettings({ glodaLimit: "" }).glodaLimit, SETTINGS_DEFAULTS.glodaLimit);
  assert.equal(sanitizeSettings({ glodaLimit: "700" }).glodaLimit, 700);
  assert.equal(sanitizeSettings({ glodaLimit: "abc" }).glodaLimit, SETTINGS_DEFAULTS.glodaLimit);
});
