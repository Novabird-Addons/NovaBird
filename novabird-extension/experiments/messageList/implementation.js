/* Nachrichtenliste im neuen Stil (Kartenansicht in about:3pane) – Teil der NovaBird-Extension, privilegiert.
 *  Dichte (airy|normal|compact) und Kontofarbe (bar|ring|dot) kommen dazu; Kompakt = einzeilig (Klar-Aufbau).
 *  Stile: "soft" (Sanft: Avatar, Vorschauzeile, runde Karten), "clear" (Klar: eine flache Zeile je Mail), "thread" (Faden: Zeitleiste mit Datum links), "default" (unverändert).
 *  Technik: Stylesheet je about:3pane-Dokument (Attribut data-nbx-ml an <html>), fillRow der Karte um Avatar/Vorschau erweitert,
 *  ThreadCard.ROW_HEIGHT angepasst (Zeilen haben feste Höhe) und die Liste neu aufgebaut.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.messageList = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

const LISTENER = "novabird-extension-messagelist";

// Gemeinsamer Selbsttest (shared/selftest.js im Paket), geladen in getAPI. Die Startprüfungen der ganzen Extension
// stehen hier (sie prüfen nur Fenster/Module); was erst beim Einhängen auffällt, meldet novaContact selbst.
const nb = {};
// Gemeinsamen Code aus dem Paket laden (shared/*.js). loadSubScript nimmt nur vertrauenswürdige Adressen
// (nicht moz-extension:, jar:, file:), daher über eine eigene resource://-Adresse; ohne Cache, damit nach
// einem Update nicht die alte Fassung kommt. Abmelden in onShutdown (nbUnloadShared).
function nbSharedHost(extension) {
  return extension.id.replace(/@.*/, "").replace(/[^a-z0-9-]/gi, "") + "-shared";
}
function nbLoadShared(extension, files, target) {
  const res = Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler);
  const host = nbSharedHost(extension);
  res.setSubstitution(host, extension.rootURI);
  for (const file of files) {
    Services.scriptloader.loadSubScriptWithOptions(`resource://${host}/${file}`, { target, ignoreCache: true });
  }
}
function nbUnloadShared(extension) {
  try {
    Services.io.getProtocolHandler("resource").QueryInterface(Ci.nsIResProtocolHandler).setSubstitution(nbSharedHost(extension), null);
  } catch (e) {
    /* schon abgemeldet */
  }
}
const SELF_TEST = [
  {
    feature: "listCards",
    needs: "3pane",
    test: ({ cw }) => typeof cw.customElements.get("thread-card")?.prototype.fillRow === "function" && !!cw.threadPane && "densityChange" in cw.threadPane,
  },
  {
    feature: "folderInboxes",
    needs: "3pane",
    test: ({ cw }) => !!cw.folderPane?._modes && typeof cw.folderPane._createFolderRow === "function" && "activeModes" in cw.folderPane,
  },
  {
    feature: "calendarLayout",
    needs: "main",
    test: ({ win }) => !!win.TodayPane && !!win.document.getElementById("today-pane-panel") && !!win.document.getElementById("agenda-panel"),
  },
  {
    feature: "contacts",
    needs: "none",
    test: ({ hasModule }) => hasModule("resource:///modules/ABQueryUtils.sys.mjs") && hasModule("resource:///modules/VCardUtils.sys.mjs"),
  },
];
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const STYLE_ID = "nbx-ml-style";
const SNIP_MAX = 160;
const CACHE_MAX = 600;

const opts = { style: "default", preview: true, avatars: true, density: "airy", acct: "none", colors: {}, scroll: true };
const acctCache = new Map(); // Server-Schlüssel -> { key, name }
const snippets = new Map(); // messageId -> Text
const wins = new Map();     // about:3pane-Fenster -> { orig, origDensity }
let started = false;
let running = 0;
const waiting = [];

const CSS = `
html[data-nbx-ml] { --nbx-accent: var(--lwt-toolbarbutton-icon-fill-attention, AccentColor); }
#threadTree .nbx-av, #threadTree .nbx-av2, #threadTree .nbx-snip, #threadTree .nbx-acct { display: none; }

/* ---------- Kontofarbe (Balken, Ring um den Avatar, Punkt mit Kontoname) ---------- */
html[data-nbx-ml] #threadTree[rows="thread-card"] .card-layout.nbx-ac:not([data-properties~="dummy"]) .card-container {
  --nbx-acm: color-mix(in srgb, var(--nbx-ac) 92%, var(--tree-card-background, Canvas));
}
html[data-nbx-ml-ac="bar"] #threadTree[rows="thread-card"] .card-layout.nbx-ac:not([data-properties~="dummy"]) > td > .card-container { box-shadow: inset 4.6px 0 0 var(--nbx-acm); }
html[data-nbx-ml="clear"][data-nbx-ml-ac="bar"] #threadTree[rows="thread-card"] .card-layout.nbx-ac[data-properties~="unread"]:not([data-properties~="dummy"]) > td > .card-container::before { inset-inline-start: 6px; }
html[data-nbx-ml-ac="ring"] #threadTree[rows="thread-card"] .card-layout.nbx-ac:not([data-properties~="dummy"]) .card-container .nbx-av { box-shadow: inset 0 0 0 2.3px var(--nbx-acm); }
html[data-nbx-ml-ac="dot"] #threadTree[rows="thread-card"] .card-layout.nbx-ac:not([data-properties~="dummy"]) .card-container .nbx-acct {
  display: inline-flex; align-items: center; gap: 5px; flex: none; margin-inline-end: 6px; white-space: nowrap;
  font-size: .85em; font-weight: 400; color: color-mix(in srgb, currentColor 62%, transparent);
}
#threadTree .nbx-acct i { display: block; inline-size: 8px; block-size: 8px; border-radius: 50%; background: var(--nbx-acm); flex: none; }
#threadTree .nbx-acct b { font-weight: 400; }
html[data-nbx-ml="clear"] #threadTree .nbx-acct b { display: none; }

/* ---------- gemeinsam: Karten-Zeilen ---------- */
html[data-nbx-ml] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .sender { font-weight: 500; }
html[data-nbx-ml] #threadTree[rows="thread-card"] .card-layout[data-properties~="unread"] .card-container .sender { font-weight: 700; }
html[data-nbx-ml] #threadTree[rows="thread-card"] .nbx-snip { color: color-mix(in srgb, currentColor 62%, transparent); font-size: .92em; font-weight: 400; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }

/* ---------- Sanft ---------- */
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] { padding-inline: 6px; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout > td { padding: 2px 0; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) > td > .card-container {
  border-radius: 12px; padding: 5px 10px; column-gap: 8px; align-items: center;
  border-color: color-mix(in srgb, currentColor 12%, transparent);
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-column:first-child { align-items: center; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .read-status { display: none; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .nbx-av {
  display: flex; align-items: center; justify-content: center; position: relative;
  inline-size: 30px; block-size: 30px; border-radius: 50%; flex: none;
  font-size: 11px; font-weight: 600; letter-spacing: .02em; line-height: 1;
  background: color-mix(in srgb, currentColor 10%, transparent); color: color-mix(in srgb, currentColor 75%, transparent);
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout[data-properties~="unread"] .card-container .nbx-av {
  background: color-mix(in srgb, var(--nbx-accent) 16%, transparent); color: var(--nbx-accent);
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout[data-properties~="unread"]:not([data-properties~="dummy"]) .card-container .thread-card-column:first-child::after {
  content: ""; position: absolute; inset-block-start: 50%; inset-inline-start: -9px; margin-block-start: -3px;
  inline-size: 6px; block-size: 6px; border-radius: 50%; background: var(--nbx-accent);
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-av="0"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container { grid-template-columns: 0 1fr; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container { grid-template-columns: 30px 1fr; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-pv="1"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .nbx-snip { display: block; grid-area: snip; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-dynamic-row {
  grid-template: "subject button" max-content "snip info" minmax(auto, 1fr) / 1fr auto;
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-pv="0"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-dynamic-row {
  grid-template: "subject button info" max-content / 1fr auto auto;
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-button { grid-area: button; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-row { padding-inline-end: 0; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .tree-button-more { display: none; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]):hover .card-container .tree-button-more { display: flex; position: absolute; inset-inline-end: -4px; inset-block-start: 0; background-color: var(--tree-card-background); }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-subject-container { padding-inline-start: 0; }
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .sender { padding-inline-start: 0; }

/* ---------- Faden: Zeitleiste links (Linie + Punkt), Datum links, eigene Nachrichten getönt ---------- */
html[data-nbx-ml="thread"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) {
  & > td { padding-inline: 0; position: relative; }
  & > td::before {
    content: ""; display: block; position: absolute; inset-inline-start: 67px; inset-block: 0; inline-size: 2px; block-size: auto; border: 0;
    background: color-mix(in srgb, currentColor 16%, transparent);
  }
  & > td::after {
    content: ""; display: block; position: absolute; inset-inline-start: 62px; inset-block: 12px auto; inline-size: 10px; block-size: 10px; border-radius: 50%; box-sizing: border-box;
    background: color-mix(in srgb, currentColor 40%, transparent); border: 2px solid var(--tree-pane-background, Canvas); z-index: 1; fill: none; stroke: none;
  }
  &[data-properties~="unread"] > td::after, &.nbx-me > td::after { background: var(--nbx-accent); }
  & .card-container { margin-inline: 90px 8px; margin-block: 3px; }
  &[data-properties~="thread-children"] .card-container { margin-inline-start: 116px; }
  & .card-container .thread-card-column:first-child { inline-size: 0; padding: 0; overflow: hidden; visibility: hidden; }
  & .card-container .thread-card-column:nth-child(2) { margin-inline-start: -8px; position: static; overflow: visible; }
  & .card-container .thread-card-row { position: static; overflow: visible; }
  & .card-container .date {
    position: absolute; inset-inline-start: -90px; inset-block-start: 4px; inline-size: 52px; text-align: end;
    white-space: pre; font-size: .78em; line-height: 1.25; opacity: .7;
  }
  &[data-properties~="thread-children"] .card-container .date { inset-inline-start: -116px; }
  &.nbx-me .card-container { background-color: color-mix(in srgb, var(--nbx-accent) 9%, var(--tree-card-background)); }
}

/* ---------- Unterhaltungen: Baum (Antworten eingerückt) und Gruppenmarker ---------- */
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"]) #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) {
  &[data-properties~="thread-children"] .card-container::before {
    content: ""; position: absolute; inset-inline-start: -16px; inset-block: -5px 50%; inline-size: 14px;
    border-inline-start: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); border-block-end: 1.5px solid color-mix(in srgb, currentColor 30%, transparent);
    border-end-start-radius: 8px; pointer-events: none;
  }
  &[data-properties~="thread-children"]:has(+ tr[data-properties~="thread-children"]) .card-container::after {
    content: ""; position: absolute; inset-inline-start: -16px; inset-block: 50% -5px; inline-size: 0;
    border-inline-start: 1.5px solid color-mix(in srgb, currentColor 30%, transparent); pointer-events: none;
  }
  &.children .card-container .thread-card-button {
    display: flex; align-items: center; gap: 3px; background: none; border: 0; padding: 0; margin: 0; opacity: 1;
    color: var(--nbx-accent); font-size: 1em; font-weight: 500; grid-area: button; min-block-size: 0;
  }
  &.children .card-container .thread-card-button :is(.replies-icon, .thread-replies) { display: none; }
  &.children .card-container .thread-card-button .twisty-icon { order: -1; inline-size: 12px; block-size: 12px; fill: currentColor; stroke: currentColor; -moz-context-properties: fill, stroke; }
  &.children .card-container .nbx-grp { white-space: nowrap; }
  &.children .card-container .nbx-av2 { display: none; }
}
html[data-nbx-ml="soft"][data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .nbx-av2 {
  display: flex; align-items: center; justify-content: center; position: absolute; inset-inline-start: 20px; inset-block-start: 50%; margin-block-start: -10px;
  inline-size: 24px; block-size: 24px; border-radius: 50%; font-size: 10px; font-weight: 600; line-height: 1; z-index: 0;
  background: color-mix(in srgb, currentColor 10%, var(--tree-card-background)); color: color-mix(in srgb, currentColor 75%, transparent);
  border: 2px solid var(--tree-card-background);
}
html[data-nbx-ml="soft"][data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .nbx-av { z-index: 1; margin-inline-end: 0; }
html[data-nbx-ml="soft"][data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container { grid-template-columns: 42px 1fr; }
html[data-nbx-ml="soft"][data-nbx-ml-av="1"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-column:first-child { align-items: flex-start; justify-content: center; }
html[data-nbx-ml="soft"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) > td::before,
html[data-nbx-ml="soft"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) > td::after { content: none; }
html[data-nbx-ml="soft"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"])[data-properties~="thread-children"] .card-container { margin-inline-start: 40px; }
html[data-nbx-ml="soft"][data-nbx-ml-pv="1"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-dynamic-row,
html[data-nbx-ml="thread"][data-nbx-ml-pv="1"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-dynamic-row {
  grid-template: "subject subject subject" max-content "button snip info" minmax(auto, 1fr) / auto 1fr auto; column-gap: 8px;
}
html:is([data-nbx-ml="soft"], [data-nbx-ml="thread"])[data-nbx-ml-pv="0"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-dynamic-row {
  grid-template: "subject button info" max-content / 1fr auto auto; column-gap: 8px;
}

/* ---------- Klar ---------- */
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] { padding-block: 0; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout > td { padding: 0; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) > td > .card-container {
  border: 0; border-radius: 0; padding: 0 8px; align-items: center;
  border-block-end: 1px solid color-mix(in srgb, currentColor 11%, transparent);
  grid-template-columns: 12px 1fr;
}
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout[data-properties~="unread"]:not([data-properties~="dummy"]) > td > .card-container::before {
  content: ""; position: absolute; inset-block: 0; inset-inline-start: 0; inline-size: 3px; background: var(--nbx-accent); z-index: 1;
}
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .read-status { display: none; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-column:nth-child(2) {
  display: grid; grid-template-columns: 11em minmax(0, 1fr) auto auto auto; align-items: center; column-gap: 10px; padding-block: 0;
}
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container :is(.thread-card-row, .thread-card-dynamic-row) { display: contents; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container :is(.account-indicator, .tree-button-more, .state) { display: none; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .sender { grid-column: 1; grid-row: 1; padding-inline-start: 0; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-subject-container { grid-column: 2; grid-row: 1; padding-inline-start: 0; display: flex; gap: 8px; min-width: 0; overflow: hidden; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-subject-container .subject { flex: 0 1 auto; max-inline-size: 70%; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-subject-container .nbx-snip { flex: 1 1 0; }
html[data-nbx-ml="clear"][data-nbx-ml-pv="1"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .nbx-snip { display: block; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-button { grid-column: 3; grid-row: 1; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .thread-card-icon-info { grid-column: 4; grid-row: 1; margin: 0; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"]) .card-container .date { grid-column: 5; grid-row: 1; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-button {
  display: flex; align-items: center; gap: 1px; padding: 0 7px 0 3px; margin: 0; opacity: 1; min-block-size: 0; border-radius: 10px;
  background: color-mix(in srgb, var(--nbx-accent) 14%, transparent); color: var(--nbx-accent); border: .5px solid color-mix(in srgb, var(--nbx-accent) 40%, transparent);
  font-size: .9em; font-weight: 600;
}
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-button :is(.replies-icon, .thread-replies) { display: none; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout.children:not([data-properties~="dummy"]) .card-container .thread-card-button .twisty-icon { order: -1; inline-size: 11px; block-size: 11px; fill: currentColor; stroke: currentColor; -moz-context-properties: fill, stroke; }
html[data-nbx-ml="clear"] #threadTree[rows="thread-card"] .card-layout:not([data-properties~="dummy"])[data-properties~="thread-children"] .card-container { margin-inline-start: 18px; }
`;

function initials(name) {
  const clean = String(name || "").replace(/["'<>()]/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "?";
  if (clean.includes("@") && !clean.includes(" ")) return clean[0].toUpperCase();
  const parts = clean.split(" ").filter(Boolean);
  const a = parts[0][0] || "?";
  const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (a + b).toUpperCase();
}

function shortDate(micro) {
  const d = new Date(micro / 1000), now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(now) - day(d)) / 86400000);
  if (diff === 0) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff > 0 && diff < 7) return d.toLocaleDateString([], { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString([], { month: "short", day: "numeric" });
  return d.toLocaleDateString([], { year: "2-digit", month: "numeric", day: "numeric" });
}

/* Faden: Datum links in zwei Zeilen (Tag, Uhrzeit) */
function threadDate(micro) {
  const d = new Date(micro / 1000), now = new Date();
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const diff = Math.round((day(now) - day(d)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (diff === 0) return time;
  const dayText = diff > 0 && diff < 7 ? d.toLocaleDateString([], { weekday: "short" })
    : d.getFullYear() === now.getFullYear() ? d.toLocaleDateString([], { month: "short", day: "numeric" })
    : d.toLocaleDateString([], { year: "2-digit", month: "numeric", day: "numeric" });
  return dayText + "\n" + time;
}

let mine = null;
function isMine(hdr) {
  try {
    if (!mine) {
      mine = new Set();
      const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
      for (const id of MailServices.accounts.allIdentities) if (id.email) mine.add(id.email.toLowerCase());
    }
    const m = /<?([^<>\s]+@[^<>\s]+)>?\s*$/.exec(hdr.author || "");
    return !!m && mine.has(m[1].toLowerCase());
  } catch (e) { return false; }
}

function toSnippet(text) {
  const lines = String(text || "").split(/\r?\n/).filter(l => l.trim() && !l.trim().startsWith(">"));
  let s = lines.join(" ").replace(/\s+/g, " ").trim();
  if (s.length > SNIP_MAX) s = s.slice(0, SNIP_MAX);
  return s;
}

function remember(id, text) {
  snippets.set(id, text);
  if (snippets.size > CACHE_MAX) snippets.delete(snippets.keys().next().value);
}

function pump() {
  while (running < 3 && waiting.length) {
    const job = waiting.shift();
    running++;
    job(() => { running--; pump(); });
  }
}

/* Vorschautext: erst das Kopfzeilen-Merkmal „preview“, sonst bei lokaler Nachricht der Text per MimeMessage (gecacht, höchstens 3 gleichzeitig). */
function loadSnippet(hdr, apply) {
  const id = hdr.messageId;
  if (snippets.has(id)) { apply(snippets.get(id)); return; }
  let pre = "";
  try { pre = hdr.getStringProperty("preview") || ""; } catch (e) { /* keins */ }
  if (pre) { remember(id, toSnippet(pre)); apply(snippets.get(id)); return; }
  let local = false;
  try { local = hdr.folder && (hdr.folder.hasMsgOffline(hdr.messageKey) || !hdr.folder.server.type.match(/imap|nntp/)); } catch (e) { /* unbekannt */ }
  if (!local) return;
  waiting.push(done => {
    let finished = false;
    const end = () => { if (!finished) { finished = true; done(); } };
    try {
      const { MsgHdrToMimeMessage } = ChromeUtils.importESModule("resource:///modules/gloda/MimeMessage.sys.mjs");
      MsgHdrToMimeMessage(hdr, null, (_h, mime) => {
        try {
          const text = mime ? toSnippet(mime.coerceBodyToPlaintext()) : "";
          remember(id, text);
          apply(text);
        } catch (e) { /* ohne Vorschau */ }
        end();
      }, true, { saneBodySize: true });
    } catch (e) { end(); }
    setTimeoutCompat(end, 4000); // Zeitlimit
  });
  pump();
}
function setTimeoutCompat(fn, ms) {
  const t = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
  t.initWithCallback({ notify: fn }, ms, Ci.nsITimer.TYPE_ONE_SHOT);
  setTimeoutCompat.keep = (setTimeoutCompat.keep || new Set()).add(t);
  if (setTimeoutCompat.keep.size > 50) setTimeoutCompat.keep.delete(setTimeoutCompat.keep.values().next().value);
}

function groupWord(n) {
  const lang = (Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
  const w = ({ de: "Nachrichten", en: "messages", fr: "messages", es: "mensajes" })[lang] || "messages";
  return n + " " + w;
}

/* Wirksamer Stil: „Kompakt“ macht aus Sanft/Faden die einzeilige Liste (Klar-Aufbau). */
function eff() { return opts.density === "compact" && (opts.style === "soft" || opts.style === "thread") ? "clear" : opts.style; }
function avOn() { return opts.avatars && eff() === "soft" && opts.density !== "compact"; }
function pvOn() { return opts.preview && (opts.density === "airy" || (eff() === "clear" && opts.density === "normal")); }
function acMode() {
  if (opts.acct === "none" || opts.style === "default") return "none";
  if (opts.acct === "dot") return opts.density === "compact" ? "bar" : "dot";
  if (opts.acct === "ring") return avOn() ? "ring" : "bar";
  return "bar";
}

function acctOf(hdr) {
  const server = hdr.folder.server;
  let a = acctCache.get(server.key);
  if (!a) {
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    a = { key: MailServices.accounts.findAccountForServer(server)?.key || "", name: server.prettyName || "" };
    acctCache.set(server.key, a);
  }
  return a;
}

function cleanDoc(doc) {
  for (const el of doc.querySelectorAll(".nbx-av, .nbx-av2, .nbx-grp, .nbx-snip, .nbx-acct")) el.remove();
  for (const r of doc.querySelectorAll(".nbx-me, .nbx-ac")) { r.classList.remove("nbx-me", "nbx-ac"); r.style.removeProperty("--nbx-ac"); }
}

function decorate(cw, row) {
  const card = row.querySelector(".card-container");
  if (!card || (row.dataset.properties || "").split(" ").includes("dummy")) return;
  const doc = row.ownerDocument;
  const col1 = card.querySelector(".thread-card-column");
  const dyn = card.querySelector(".thread-card-dynamic-row");
  const subjectBox = card.querySelector(".thread-card-subject-container");
  if (!col1 || !dyn || !subjectBox) return;
  let av = col1.querySelector(".nbx-av");
  if (!av) { av = doc.createElement("span"); av.className = "nbx-av"; col1.append(av); }
  av.textContent = initials(row.querySelector(".sender")?.textContent);
  let sn = card.querySelector(".nbx-snip");
  if (!sn) { sn = doc.createElement("span"); sn.className = "nbx-snip"; }
  const parent = eff() === "clear" ? subjectBox : dyn;
  if (sn.parentNode !== parent) parent.append(sn);
  sn.textContent = "";
  let hdr = null;
  try { hdr = cw.gDBView?.getMsgHdrAt(row.index); } catch (e) { return; }
  if (!hdr) return;
  /* Unterhaltung: Zähler im Marker und zweiter Avatar (letzter anderer Absender) */
  let grp = card.querySelector(".nbx-grp"), av2 = card.querySelector(".nbx-av2");
  if (row.classList.contains("children")) {
    try {
      const th = hdr.folder.msgDatabase.getThreadContainingMsgHdr(hdr), total = th.numChildren;
      const btn = card.querySelector(".thread-card-button");
      if (btn && !grp) { grp = row.ownerDocument.createElement("span"); grp.className = "nbx-grp"; btn.append(grp); }
      if (grp) grp.textContent = eff() === "clear" ? String(total) : groupWord(total);
      if (!av2) { av2 = row.ownerDocument.createElement("span"); av2.className = "nbx-av2"; col1.append(av2); }
      const first = hdr.mime2DecodedAuthor || "";
      let other = "";
      for (let i = total - 1; i >= 0 && !other; i--) {
        const a = th.getChildHdrAt(i)?.mime2DecodedAuthor || "";
        if (a && a !== first) other = a;
      }
      av2.textContent = initials(other || first);
    } catch (e) { /* ohne Gruppenmarker */ }
  } else { grp?.remove(); av2?.remove(); }
  const dl = row.querySelector(".date");
  if (dl && hdr.date) { dl.title = dl.textContent; dl.textContent = eff() === "thread" ? threadDate(hdr.date) : shortDate(hdr.date); }
  row.classList.toggle("nbx-me", eff() === "thread" && isMine(hdr));
  /* Kontofarbe */
  const mode = acMode();
  let acct = null, color = "";
  if (mode !== "none") { try { acct = acctOf(hdr); color = opts.colors[acct.key] || ""; } catch (e) { /* ohne Farbe */ } }
  if (/^#[0-9a-f]{6}$/i.test(color)) { row.style.setProperty("--nbx-ac", color); row.classList.add("nbx-ac"); }
  else { row.style.removeProperty("--nbx-ac"); row.classList.remove("nbx-ac"); color = ""; }
  let ad = card.querySelector(".nbx-acct");
  if (mode === "dot" && color) {
    if (!ad) { ad = doc.createElement("span"); ad.className = "nbx-acct"; ad.append(doc.createElement("i"), doc.createElement("b")); }
    if (subjectBox.firstChild !== ad) subjectBox.prepend(ad);
    ad.lastChild.textContent = acct.name; ad.title = acct.name;
  } else ad?.remove();
  if (!pvOn()) return;
  const idx = row.index;
  loadSnippet(hdr, text => { if (row.index === idx && row.isConnected && text) sn.textContent = text; });
}

function rowHeight(cw, base) {
  if (eff() === "clear") {
    const fs = parseFloat(cw.getComputedStyle(cw.document.documentElement).fontSize) || 14;
    return Math.round(fs * 1.5) + (opts.density === "compact" ? 2 : opts.density === "normal" ? 6 : 10);
  }
  if (opts.style === "soft" || opts.style === "thread") {
    const fs = parseFloat(cw.getComputedStyle(cw.document.documentElement).fontSize) || 14;
    const lines = pvOn() ? 3 : 2;
    const h = Math.round(fs * 1.5 * lines) + 14;
    return opts.density === "airy" ? Math.max(h, base) : h;
  }
  return base;
}

const SB_ID = "nbx-sb-style";
const SB_CSS = "*{scrollbar-width:auto!important;scrollbar-color:color-mix(in srgb,currentColor 55%,transparent) color-mix(in srgb,currentColor 9%,transparent)!important}";
function applyScroll(doc) {
  let el = doc.getElementById(SB_ID);
  if (!opts.scroll) { el?.remove(); return; }
  if (el) return;
  el = doc.createElement("style");
  el.id = SB_ID; el.textContent = SB_CSS;
  doc.documentElement.append(el);
}

// Knopf „Neue Nachricht“ im Ordnerbereich: Betterbird kürzt den Text schon bei Standardbreite („Neue Nachri…“).
// Engere Abstände in der Kopfleiste; reicht der Platz trotzdem nicht, fällt das „+“ weg (Attribut data-nbx-tight).
const HDR_ID = "nbx-hdr-style";
const HDR_CSS = `#folderPaneHeaderBar { gap: 5px; padding-inline: 6px; }
#folderPaneWriteMessage { padding-inline-end: 8px; }
#folderPaneWriteMessage[data-nbx-tight] { background-image: none; padding-inline: 6px; }`;
const hdrObservers = new Map();
function fitWriteButton(doc) {
  const b = doc.getElementById("folderPaneWriteMessage");
  if (!b) return;
  // ohne Kürzung messen (gleiche Aufgabe, kein Zwischenbild)
  b.removeAttribute("data-nbx-tight");
  if (b.scrollWidth > b.clientWidth + 1) b.setAttribute("data-nbx-tight", "");
}
function applyHeader(cw) {
  const doc = cw.document;
  if (doc.getElementById(HDR_ID)) return;
  const bar = doc.getElementById("folderPaneHeaderBar");
  if (!bar) return;
  const el = doc.createElement("style");
  el.id = HDR_ID; el.textContent = HDR_CSS;
  doc.documentElement.append(el);
  fitWriteButton(doc);
  // die Leiste beobachten, nicht den Knopf (seine Breite ändert sich durch das eigene Umschalten)
  if (cw.ResizeObserver) {
    const ro = new cw.ResizeObserver(() => fitWriteButton(doc));
    ro.observe(bar);
    hdrObservers.set(cw, ro);
  }
}
function undoHeader(cw) {
  hdrObservers.get(cw)?.disconnect();
  hdrObservers.delete(cw);
  cw.document.getElementById(HDR_ID)?.remove();
  cw.document.getElementById("folderPaneWriteMessage")?.removeAttribute("data-nbx-tight");
}

// „Was gibt's Neues?“ unter „Neue Nachricht“ im Ordnerbereich: in der oberen Leiste hängt Thunderbird Add-on-Knöpfe ans
// Ende (rechts außen) oder sie ist ganz ausgeblendet. Zahl = neue Mails im letzten automatischen Überblick. Ein Klick meldet
// onNewsButton mit der Bildschirmposition unter dem Knopf; die Extension öffnet den Überblick dort.
// Aussehen wie „Neue Nachricht“ (button-primary, folgt dem Theme), darunter auf derselben Mittelachse: der breitere der
// beiden Knöpfe steht links und rechts gleich weit über (alignNews).
const NEWS_ROW = "nbx-news-row";
const NEWS_STYLE = "nbx-news-style";
const NEWS_CSS = `#${NEWS_ROW} { display: flex; padding: 0 6px 6px; }
#${NEWS_ROW} button { max-width: 100%; margin: 0; justify-content: center; gap: 6px; }
#${NEWS_ROW} .nbx-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${NEWS_ROW} .nbx-count { flex: none; min-width: 1.5em; padding: 0 0.45em; border-radius: 1em; font-size: 0.85em; line-height: 1.5;
  background: var(--button-primary-text-color, #fff); color: var(--button-primary-background-color, AccentColor); }`;
const news = { show: false, label: "", count: 0 };
const newsFires = new Set();
const newsObservers = new Map();
function alignNews(doc) {
  const row = doc.getElementById(NEWS_ROW), bar = doc.getElementById("folderPaneHeaderBar");
  const write = doc.getElementById("folderPaneWriteMessage");
  if (!row || !bar) return;
  const button = row.firstChild;
  const ok = write && !write.hidden && write.offsetWidth > 0 && !bar.hidden;
  if (!ok) {
    button.style.marginInlineStart = "";
    return;
  }
  // Abstand vom Anfang der Zeile so, dass beide Mitten übereinander liegen; nie über den Rand des Ordnerbereichs
  const cs = doc.defaultView.getComputedStyle(row);
  const rowBox = row.getBoundingClientRect(), writeBox = write.getBoundingClientRect();
  const padLeft = parseFloat(cs.paddingLeft) || 0;
  const inner = row.clientWidth - padLeft - (parseFloat(cs.paddingRight) || 0);
  const width = button.offsetWidth;
  const center = writeBox.left + writeBox.width / 2 - rowBox.left - padLeft;
  const left = Math.min(Math.max(0, center - width / 2), Math.max(0, inner - width));
  const start = cs.direction === "rtl" ? inner - width - left : left;
  button.style.marginInlineStart = `${Math.max(0, Math.round(start))}px`;
}
function applyNews(cw) {
  const doc = cw.document;
  let row = doc.getElementById(NEWS_ROW);
  const bar = doc.getElementById("folderPaneHeaderBar");
  if (!news.show || !bar) {
    undoNews(cw);
    return;
  }
  if (!doc.getElementById(NEWS_STYLE)) {
    const style = doc.createElement("style");
    style.id = NEWS_STYLE;
    style.textContent = NEWS_CSS;
    doc.documentElement.append(style);
  }
  if (!row) {
    row = doc.createElement("div");
    row.id = NEWS_ROW;
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "button button-primary";
    button.addEventListener("click", () => {
      const r = button.getBoundingClientRect();
      const pos = { left: Math.round(cw.mozInnerScreenX + r.left), top: Math.round(cw.mozInnerScreenY + r.bottom + 4) };
      for (const fire of newsFires) fire.async(pos);
    });
    row.append(button);
    bar.after(row);
    // Leiste und „Neue Nachricht“ beobachten (Breite des Ordnerbereichs, gekürzter Knopf, Knopf ausgeblendet)
    if (cw.ResizeObserver && !newsObservers.has(cw)) {
      const ro = new cw.ResizeObserver(() => alignNews(doc));
      ro.observe(bar);
      const write = doc.getElementById("folderPaneWriteMessage");
      if (write) ro.observe(write);
      ro.observe(button); // eigene Breite ändert sich mit Zahl und Beschriftung
      newsObservers.set(cw, ro);
    }
  }
  const button = row.firstChild;
  const label = doc.createElement("span");
  label.className = "nbx-label";
  label.textContent = news.label;
  const count = doc.createElement("span");
  count.className = "nbx-count";
  count.textContent = String(Math.min(news.count, 99));
  button.title = news.label;
  button.replaceChildren(label, ...(news.count > 0 ? [count] : []));
  alignNews(doc);
}
function undoNews(cw) {
  newsObservers.get(cw)?.disconnect();
  newsObservers.delete(cw);
  cw.document.getElementById(NEWS_ROW)?.remove();
  cw.document.getElementById(NEWS_STYLE)?.remove();
}

// Rubrik „Posteingänge“ im Ordnerbereich, direkt unter „Gruppierte Ordner“ (sonst ganz oben): eine eigene Ansicht in
// folderPane._modes mit dem Posteingang je Konto, Zeilenname = Kontoname. Ungelesen-Zahlen, Auswahl, Kontextmenü und
// Ziehen übernimmt Thunderbird (Zeilen wie in den anderen Ansichten). Thunderbird merkt sich die Ansichten im xulStore
// und filtert beim Start unbekannte heraus; ohne NovaBird bleibt also nichts zurück, mit NovaBird setzt applyInboxes sie neu.
const INBOX_MODE = "nbxInboxes";
const inboxes = { show: false, label: "", hide: [] }; // hide = Konto-Schlüssel (account1 …), die nicht erscheinen sollen
function inboxMode(cw) {
  const fp = cw.folderPane;
  return {
    name: INBOX_MODE,
    active: false,
    canBeCompact: false,
    init() {
      // .accounts ist in der Reihenfolge der Kontenliste
      for (const account of MailServices.accounts.accounts) {
        const server = account.incomingServer;
        if (!server || server.type === "im" || inboxes.hide.includes(account.key)) continue;
        if (server.type === "none" && fp.hideLocalFolders) continue;
        if (server instanceof Ci.nsIPop3IncomingServer && server.deferredToAccount) continue;
        const inbox = server.rootFolder?.getFolderWithFlags(Ci.nsMsgFolderFlags.Inbox);
        if (inbox) this.containerList.append(fp._createFolderRow(this.name, inbox, "server"));
      }
    },
    rebuild() {
      this.containerList.replaceChildren();
      this.init();
    },
    addFolder(parent, child) {
      if (child.flags & Ci.nsMsgFolderFlags.Inbox) this.rebuild();
    },
    removeFolder(parent, child) {
      fp.getRowForFolder(child, this.name)?.remove();
    },
    changeAccountOrder() {
      this.rebuild();
    },
  };
}
function inboxHeader(mode) {
  const name = mode.containerHeader?.querySelector(".mode-name");
  if (!name) return;
  name.removeAttribute("data-l10n-id"); // Thunderbird kennt für die Ansicht keinen Text
  name.textContent = inboxes.label;
}
function applyInboxes(cw, tries = 0) {
  const fp = cw.folderPane;
  if (!fp?._modes) return;
  // folderPane.init ist asynchron: erst wenn die Ansichten stehen, einhängen
  if (!fp._modeTemplate || !fp.activeModes.length) {
    if (inboxes.show && tries < 40) cw.setTimeout(() => applyInboxes(cw, tries + 1), 500);
    return;
  }
  const modes = fp.activeModes.filter(m => m !== INBOX_MODE);
  if (!inboxes.show) {
    if (fp._modes[INBOX_MODE]?.active) fp.activeModes = modes;
    delete fp._modes[INBOX_MODE];
    return;
  }
  const sig = JSON.stringify([inboxes.label, inboxes.hide]);
  let mode = fp._modes[INBOX_MODE];
  if (!mode) mode = fp._modes[INBOX_MODE] = inboxMode(cw);
  if (mode.active) {
    if (mode.sig !== sig) mode.rebuild();
  } else {
    modes.splice(modes.indexOf("smart") + 1, 0, INBOX_MODE); // ohne „Gruppierte Ordner“: Index 0
    fp.activeModes = modes;
  }
  mode.sig = sig;
  inboxHeader(mode);
}
function undoInboxes(cw) {
  const fp = cw.folderPane;
  if (!fp?._modes?.[INBOX_MODE]) return;
  if (fp._modes[INBOX_MODE].active) fp.activeModes = fp.activeModes.filter(m => m !== INBOX_MODE);
  delete fp._modes[INBOX_MODE];
}

function applyWindow(cw) {
  const doc = cw.document;
  let st = wins.get(cw);
  const cardClass = cw.customElements.get("thread-card");
  if (!cardClass || !cw.threadPane || !cw.threadTree) return false;
  applyScroll(doc);
  try { applyHeader(cw); } catch (e) { console.error("Ordnerkopf:", e); }
  try { applyNews(cw); } catch (e) { console.error("Was gibt's Neues?:", e); }
  try { applyInboxes(cw); } catch (e) { console.error("Posteingänge:", e); }
  if (!st) {
    st = { baseDensity: cw.threadPane.densityChange, baseFill: cardClass.prototype.fillRow, cardClass };
    wins.set(cw, st);
    cardClass.prototype.fillRow = function () {
      st.baseFill.call(this);
      if (opts.style !== "default") { try { decorate(cw, this); } catch (e) { console.error("Nachrichtenliste:", e); } }
    };
    cw.threadPane.densityChange = async function (...a) {
      const r = await st.baseDensity.apply(this, a);
      if (opts.style !== "default") cardClass.ROW_HEIGHT = rowHeight(cw, cardClass.ROW_HEIGHT);
      return r;
    };
    const style = doc.createElement("style");
    style.id = STYLE_ID; style.textContent = CSS;
    doc.documentElement.append(style);
  }
  const root = doc.documentElement;
  if (opts.style === "default") {
    for (const a of ["data-nbx-ml", "data-nbx-ml-av", "data-nbx-ml-pv", "data-nbx-ml-ac"]) root.removeAttribute(a);
    cleanDoc(doc);
  } else {
    root.setAttribute("data-nbx-ml", eff());
    root.setAttribute("data-nbx-ml-av", avOn() ? "1" : "0");
    root.setAttribute("data-nbx-ml-pv", pvOn() ? "1" : "0");
    root.setAttribute("data-nbx-ml-ac", acMode());
  }
  return refreshHeight(cw);
}

function refreshHeight(cw) {
  const st = wins.get(cw);
  if (!st) return false;
  // Ausgangshöhe der Standarddichte neu berechnen lassen, dann unseren Wert darüberlegen
  Promise.resolve(st.baseDensity.call(cw.threadPane)).then(() => {
    if (opts.style !== "default") st.cardClass.ROW_HEIGHT = rowHeight(cw, st.cardClass.ROW_HEIGHT);
    for (const row of cw.threadTree.querySelectorAll("tr[is='thread-card']")) { try { row.style.height = st.cardClass.ROW_HEIGHT + "px"; row.fillRow?.(); } catch (e) { /* Zeile wird neu gebaut */ } }
    cw.threadTree.reset?.();
  }).catch(e => console.error("Nachrichtenliste:", e));
  return true;
}

function undoWindow(cw) {
  const st = wins.get(cw);
  if (!st) return;
  const doc = cw.document;
  try { undoHeader(cw); } catch (e) { /* Fenster schon weg */ }
  try { undoNews(cw); } catch (e) { /* Fenster schon weg */ }
  try { undoInboxes(cw); } catch (e) { /* Fenster schon weg */ }
  st.cardClass.prototype.fillRow = st.baseFill;
  cw.threadPane.densityChange = st.baseDensity;
  doc.getElementById(STYLE_ID)?.remove();
  doc.getElementById(SB_ID)?.remove(); // breite Scrollleisten (applyScroll)
  const root = doc.documentElement;
  for (const a of ["data-nbx-ml", "data-nbx-ml-av", "data-nbx-ml-pv", "data-nbx-ml-ac"]) root.removeAttribute(a);
  cleanDoc(doc);
  wins.delete(cw);
  Promise.resolve(st.baseDensity.call(cw.threadPane)).then(() => cw.threadTree.reset?.()).catch(() => {});
}

function threePanes(win) {
  const out = [];
  const tm = win.document.getElementById("tabmail");
  for (const info of tm?.tabInfo || []) {
    const cw = info.chromeBrowser?.contentWindow;
    try { if (cw && cw.location.href === "about:3pane" && cw.document.readyState === "complete") out.push(cw); } catch (e) { /* noch nicht bereit */ }
  }
  return out;
}

function scan(win, tries = 0) {
  let missing = false;
  for (const cw of threePanes(win)) { if (!applyWindow(cw)) missing = true; }
  if ((missing || !threePanes(win).length) && tries < 30) win.setTimeout(() => scan(win, tries + 1), 500);
}

// Einträge geschlossener Tabs/Fenster aus den Zuständen entfernen (Schlüssel sind about:3pane-Fenster; ohne Aufräumen hielten
// wins, hdrObservers und newsObservers jedes je geöffnete 3-Pane-Dokument bis zum Abschalten fest)
function pruneClosed() {
  const dead = cw => {
    try {
      return cw.closed || !cw.document;
    } catch (e) {
      return true; // totes Objekt
    }
  };
  for (const map of [wins, hdrObservers, newsObservers]) {
    for (const [cw, v] of [...map]) {
      if (!dead(cw)) continue;
      try { v?.disconnect?.(); } catch (e) { /* schon weg */ }
      map.delete(cw);
    }
  }
}

function hookWindow(win) {
  const tm = win.document.getElementById("tabmail");
  if (!tm || win._nbxMl) return;
  const onTab = () => win.setTimeout(() => { pruneClosed(); scan(win); }, 300);
  win._nbxMl = { onTab, tm };
  tm.tabContainer.addEventListener("TabOpen", onTab);
  tm.tabContainer.addEventListener("TabSelect", onTab);
  tm.tabContainer.addEventListener("TabClose", win._nbxMl.onClose = () => win.setTimeout(pruneClosed, 500));
  scan(win);
}

function unhookWindow(win) {
  const h = win._nbxMl;
  if (!h) return;
  h.tm.tabContainer.removeEventListener("TabOpen", h.onTab);
  h.tm.tabContainer.removeEventListener("TabSelect", h.onTab);
  if (h.onClose) h.tm.tabContainer.removeEventListener("TabClose", h.onClose);
  delete win._nbxMl;
  for (const cw of [...wins.keys()]) { try { undoWindow(cw); } catch (e) { wins.delete(cw); } }
}

function startAll() {
  if (started) return;
  started = true;
  ExtensionSupport.registerWindowListener(LISTENER, {
    chromeURLs: [MAIN_URL],
    onLoadWindow(win) { try { hookWindow(win); } catch (e) { console.error("Nachrichtenliste:", e); } },
    onUnloadWindow() { setTimeoutCompat(pruneClosed, 1000); }, // geschlossenes Hauptfenster: seine 3-Pane-Einträge freigeben
  });
}

function stopAll() {
  if (!started) return;
  started = false;
  ExtensionSupport.unregisterWindowListener(LISTENER);
  for (const win of Services.wm.getEnumerator("mail:3pane")) unhookWindow(win);
}

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) {
      stopAll();
      nbUnloadShared(this.extension);
    }
  }
  getAPI(context) {
    if (!nb.nbRunSelfTest) {
      try {
        nbLoadShared(this.extension, ["shared/selftest.js"], nb);
      } catch (e) {
        console.error("NovaBird: gemeinsamer Code nicht geladen", e); // nur Selbsttest/Farbrechnung fehlen, Rest läuft
      }
    }
    return {
      messageList: {
        // Selbsttest der Betterbird-Interna (siehe SELF_TEST); Ergebnis zeigt die Optionsseite
        async selfTest() {
          return nb.nbRunSelfTest?.(SELF_TEST) ?? null;
        },
        async setOptions(style, preview, avatars, density, acct, colors, scroll) {
          opts.style = ["soft", "clear", "thread"].includes(style) ? style : "default";
          opts.preview = !!preview;
          opts.avatars = !!avatars;
          opts.density = ["normal", "compact"].includes(density) ? density : "airy";
          opts.acct = ["bar", "ring", "dot"].includes(acct) ? acct : "none";
          try { opts.colors = JSON.parse(colors || "{}") || {}; } catch (e) { opts.colors = {}; }
          opts.scroll = scroll !== false;
          acctCache.clear();
          if (!started) startAll();
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            if (!win._nbxMl) hookWindow(win);
            for (const cw of threePanes(win)) applyWindow(cw);
          }
        },
        async setNewsButton(show, label, count) {
          news.show = !!show;
          news.label = String(label || "");
          news.count = Math.max(0, Math.round(Number(count) || 0));
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            for (const cw of threePanes(win)) {
              try { applyNews(cw); } catch (e) { console.error("Was gibt's Neues?:", e); }
            }
          }
        },
        async setInboxes(show, label, hide) {
          inboxes.show = !!show;
          inboxes.label = String(label || "");
          inboxes.hide = (Array.isArray(hide) ? hide : []).map(String);
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            for (const cw of threePanes(win)) {
              try { applyInboxes(cw); } catch (e) { console.error("Posteingänge:", e); }
            }
          }
        },
        onNewsButton: new ExtensionCommon.EventManager({
          context,
          name: "messageList.onNewsButton",
          register: fire => {
            newsFires.add(fire);
            return () => newsFires.delete(fire);
          },
        }).api(),
      },
    };
  }
};

return API;
})();
