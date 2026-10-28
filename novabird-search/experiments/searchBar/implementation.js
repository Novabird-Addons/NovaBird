/* NovaBird-Search – Experiment: Suchfeld in der Schnellfilter-Leiste (about:3pane), Symbolleistenfeld
 * ausblenden, virtueller Suchordner. Läuft privilegiert (nur Betterbird / Thunderbird ESR).
 * Geprüft gegen Betterbird 153.4.0esr (about3Pane.xhtml, quickFilterBar.js, VirtualFolderWrapper.sys.mjs).
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);
var { VirtualFolderHelper } = ChromeUtils.importESModule(
  "resource:///modules/VirtualFolderWrapper.sys.mjs"
);
var { MailServices } = ChromeUtils.importESModule(
  "resource:///modules/MailServices.sys.mjs"
);
var { getFolder } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionAccounts.sys.mjs"
);

var { Gloda } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaPublic.sys.mjs");
var { GlodaConstants } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaConstants.sys.mjs");
var { GlodaMsgSearcher } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaMsgSearcher.sys.mjs");
var { GlodaSyntheticView } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaSyntheticView.sys.mjs");

const GLODA_LIMIT = 1000; // Treffer, die Gloda höchstens liefert (nach Relevanz+Aktualität ausgewählt)

const HTML_NS = "http://www.w3.org/1999/xhtml";

// Gemeinsamer Code (shared/selftest.js im Paket), geladen in getAPI
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
// Selbsttest: Betterbird-Interna, auf die sich dieses Add-on verlässt (Namen = Schlüssel selfTest_<feature> in _locales)
const SELF_TEST = [
  { feature: "searchBar", needs: "main", test: ({ win }) => typeof win.document.getElementById("tabmail")?.registerTabMonitor === "function" },
  { feature: "quickFilter", needs: "3pane", test: ({ cw }) => typeof cw.quickFilterBar?._showFilterBar === "function" },
  { feature: "threadDates", needs: "3pane", test: ({ cw }) => typeof cw.customElements.get("thread-row")?.prototype.fillRow === "function" },
  {
    feature: "sharedFolders",
    needs: "3pane",
    test: ({ cw }) => typeof cw.folderPane?._modes?.smart?.init === "function" && typeof cw.folderPane._onSelect === "function",
  },
];
const LISTENER_NAME = "novabird-search-windows";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const ROOT_ID = "novabird-search";
const STYLE_ID = "novabird-search-style";
const MAIN_STYLE_ID = "novabird-search-main-style";
const MONITOR_NAME = "novabird-search-tabs";
const SEARCH_FOLDER_NAME = "Suchergebnisse";

// Bis setStrings kommt: englische Rückfallwerte.
const DEFAULT_STRINGS = {
  placeholder: "Search messages",
  scopeAll: "All folders",
  scopeFolder: "Current folder",
  options: "Search options",
  optFrom: "From",
  optTo: "To",
  optSubject: "Content: Subject",
  optBody: "Content: Message",
  optAttachment: "With attachment",
  optUnread: "Unread only",
  optTrash: "Trash",
  optSpam: "Spam",
  includeLabel: "Include",
  busy: "Searching message text …",
  clear: "Clear search",
  rangeAll: "All",
  rangeToday: "Today",
  range3: "3 days",
  range7: "7 days",
  range30: "30 days",
  openSettings: "Settings …",
  suggest: "Did you mean: {text}?",
  resultsTitle: "Search results",
  noteDbOff: "DB Pilot is OFFLINE – Gloda search",
  noteDbMissing: "DB Pilot is OFFLINE – Gloda search",
  noteDbBuilding: "DB Pilot is building its index – Gloda search",
  noteDbTip: "",
  historyTitle: "Recent searches",
  historyClear: "Clear history",
  historyRemove: "Remove entry",
  refinePlaceholder: "Search within results",
  askTitle: "What next with the results?",
  askFilter: "Filter",
  askAnalyze: "Analyze",
  askRemember: "Remember and don't ask again (changeable in settings)",
  markAllRead: "Mark all as read",
};

const DEFAULT_STATE = {
  scope: "all",
  from: true,
  to: false,
  subject: true,
  body: true,
  attachment: false,
  unread: false,
  trash: false,
  spam: false,
  range: "all", // Zeitfenster: all | today | 3d | 7d | 30d
};

// Systemfarben statt fester Werte: folgen dem Theme (hell/dunkel).
const CSS = `
/* Native Schnellfilter-Leiste und -Knopf ausblenden; sie bleibt intern „offen“, damit setQuickFilter wirkt. */
#quick-filter-bar,
#threadPaneQuickFilterButton { display: none !important; }
/* Kopfzeile: Titel mit Anzahl darunter, Suchfeld in der Mitte */
.list-header-bar-container-start {
  flex-direction: column;
  align-items: flex-start;
  gap: 0;
  flex: 0 1 auto;
  align-self: flex-start; /* Titelblock mittig zum Suchfeld, nicht zur ganzen Leiste inkl. Zeitfenstern */
  margin-top: var(--nbs-title-top, 6.5px);
}
#threadPaneFolderCountContainer .thread-pane-count-info { padding-inline-start: 0; font-size: 0.85rem; opacity: 0.75; }
/* Konversationsansicht (Option): neueste Nachricht der Konversation hervorheben */
tr.nbs-newest td {
  /* Textmarker: kräftiges Gelb mit Transparenz – auf hellem Grund blassgelb, auf dunklem Grund goldfarben */
  background-color: rgba(255, 213, 74, 0.45) !important;
}
tr.nbs-newest td:first-of-type {
  box-shadow: inset 5px 0 0 #f5a800;
}
#${ROOT_ID} { margin-inline: 8px; }
/* Gemeinsame Ordner (Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage) bleiben oben fixiert, auch wenn man durch die Konten scrollt */
#folderTree li.nbs-shared { position: sticky; z-index: 3; }
/* Der Ordnerbaum hat ein 4-px-Abstandselement oben (::before). Sticky-Zeilen sprängen beim Scrollen um diese 4 px („Wackeln“):
   Abstandselement weg, der Abstand liegt stattdessen im Innenabstand der ersten fixierten Zeile. */
#folderTree:has(li.nbs-shared)::before { display: none; }
#folderTree li.nbs-shared-first { padding-top: 4px; }
#folderTree li.nbs-shared-last { border-bottom: 1px solid var(--layout-border-0, color-mix(in srgb, currentColor 25%, transparent)); box-shadow: 0 2px 3px -2px rgba(0, 0, 0, 0.35); }
/* Titelbereich links (Ordnername + Anzahl) so breit wie sein Inhalt: das Suchfeld rückt nah heran und passt seine Breite an, wenn
   der Name länger wird (z. B. „Suchergebnisse“). Sehr lange Namen höchstens 35 % breit, dann mit „…“ gekürzt. */
.list-header-bar-container-start { min-width: 0; max-width: 35%; }
/* langer Ordnername: mit „…“ kürzen, das Suchfeld behält seine Mindestbreite */
.list-header-bar-container-start #threadPaneFolderName { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
#${ROOT_ID} {
  /* Farben aus dem Theme (wie Betterbirds eigene Suchleiste und Listen-Kopfzeile), Systemfarben als Rückfall */
  --nbs-field-bg: var(--search-bar-background, Field);
  --nbs-field-fg: var(--search-bar-color, var(--layout-color-1, FieldText));
  --nbs-border: var(--search-bar-border-color, color-mix(in srgb, CanvasText 28%, transparent));
  --nbs-line: var(--layout-border-0, var(--nbs-line));
  --nbs-focus: var(--focus-outline-color, AccentColor);
  --nbs-accent: var(--selected-item-color, AccentColor);
  --nbs-on-accent: var(--selected-item-text-color, AccentColorText);
  --nbs-hover: var(--button-hover-background-color, color-mix(in srgb, CanvasText 8%, transparent));
  --nbs-menu-bg: var(--layout-background-1, Canvas);
  --nbs-menu-fg: var(--layout-color-1, CanvasText);
  --nbs-muted: color-mix(in srgb, var(--nbs-field-fg) 70%, transparent);
  --nbs-menu-muted: color-mix(in srgb, var(--nbs-menu-fg) 65%, transparent);
  --nbs-track: color-mix(in srgb, var(--nbs-menu-fg) 30%, transparent);
  position: relative;
  flex: 1 1 auto;
  display: flex;
  align-items: center;
  min-width: 0;
  font: menu;
  font-size: inherit; /* Schriftart des Systems, Größe wie Thunderbird: folgt der eingestellten Schriftgröße */
  color: var(--nbs-menu-fg);
}
/* Windows: Systemschrift (Segoe UI) wirkt kleiner als unter Linux, Suchfeld und Zeitfenster etwas größer */
@media (-moz-platform: windows) {
  #${ROOT_ID} { font-size: 1.1em; }
  #${ROOT_ID} .nbs-chip { font-size: 0.9em; }
}
#${ROOT_ID} .nbs-field {
  flex: none; /* die Leiste ist eine Spalte: sonst schrumpft das Feld auf die Resthöhe der Kopfzeile */
  display: flex;
  align-items: stretch;
  min-width: 0;
  box-sizing: border-box;
  height: 36px; /* Variante A: mehr Luft in der Kopfzeile */
  border: 1px solid var(--nbs-border);
  border-radius: 8px;
  background: var(--nbs-field-bg);
  color: var(--nbs-field-fg);
}
#${ROOT_ID} .nbs-field:focus-within { outline: 2px solid var(--nbs-focus); outline-offset: -1px; }
#${ROOT_ID} button {
  all: unset;
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 10px;
  cursor: pointer;
  white-space: nowrap;
  color: var(--nbs-muted);
}
#${ROOT_ID} button:hover { background: var(--nbs-hover); }
#${ROOT_ID} .nbs-scope { border-inline-end: 1px solid var(--nbs-line); border-radius: 7px 0 0 7px; }
#${ROOT_ID} { flex-direction: column; align-items: stretch; justify-content: center; padding-block: 10px; min-width: 260px; }
#${ROOT_ID} .nbs-range { display: flex; flex-wrap: wrap; gap: 3px 4px; margin-top: 5px; }
/* Tippfehler-Vorschlag: eigene Zeile direkt unter dem Suchfeld, gleiche Form wie das Feld, klickbar */
#${ROOT_ID} .nbs-suggest {
  display: flex; align-items: center; gap: 8px; box-sizing: border-box; width: 100%; height: 34px; margin-top: 4px; padding: 0 14px;
  border: 1px solid var(--nbs-border); border-radius: 8px; background: var(--nbs-field-bg);
  font: inherit; font-size: 1em; color: inherit; text-align: start; cursor: pointer;
}
#${ROOT_ID} .nbs-suggest:hover { background: color-mix(in srgb, var(--nbs-accent) 14%, var(--nbs-field-bg)); border-color: var(--nbs-accent); }
#${ROOT_ID} .nbs-suggest .nbs-sug-word { font-weight: 700; color: inherit; text-decoration: underline; text-decoration-color: var(--nbs-accent); text-decoration-thickness: 2px; text-underline-offset: 3px; }
#${ROOT_ID} .nbs-suggest[hidden] { display: none; }
#${ROOT_ID} .nbs-note { margin-inline-start: auto; font-size: 1.05em; font-weight: 700; color: #b3261e; padding: 1px 6px; }
#${ROOT_ID} .nbs-note.nbs-info { font-weight: 400; color: var(--nbs-muted); }
#${ROOT_ID} .nbs-note[hidden] { display: none; }
#${ROOT_ID} .nbs-chip {
  padding: 1px 10px;
  border: 1px solid var(--nbs-line);
  border-radius: 999px;
  font-size: 0.85em;
  color: var(--nbs-menu-muted);
}
#${ROOT_ID} .nbs-chip:hover { background: var(--nbs-hover); }
#${ROOT_ID} .nbs-chip[aria-checked="true"] {
  background: var(--nbs-accent);
  border-color: var(--nbs-accent);
  color: var(--nbs-on-accent);
}
#${ROOT_ID} .nbs-clear { display: none; padding: 0 8px; font-size: 1.1em; }
#${ROOT_ID}[data-has-text] .nbs-clear { display: flex; }
#${ROOT_ID} .nbs-spin {
  display: none;
  align-self: center;
  flex: none;
  width: 14px;
  height: 14px;
  margin-inline: 4px 8px;
  box-sizing: border-box;
  border: 2px solid var(--nbs-line);
  border-top-color: var(--nbs-accent);
  border-radius: 50%;
  animation: nbs-rotate 0.8s linear infinite;
}
#${ROOT_ID}[data-busy] .nbs-spin { display: block; }
@keyframes nbs-rotate { to { transform: rotate(360deg); } }
#${ROOT_ID} .nbs-opt { border-inline-start: 1px solid var(--nbs-line); border-radius: 0 7px 7px 0; font-size: 1.45em; padding: 0 12px; }
#${ROOT_ID} .nbs-opt.nbs-changed { color: var(--nbs-accent); }
#${ROOT_ID} input {
  flex: 1;
  min-width: 0;
  border: none;
  outline: none;
  background: transparent;
  color: inherit;
  padding: 0 10px;
  font: inherit;
  box-shadow: none;
}
#${ROOT_ID} .nbs-menu {
  position: absolute;
  top: 36px;
  z-index: 100;
  min-width: 220px;
  padding: 4px;
  border: 1px solid var(--nbs-border);
  border-radius: 8px;
  background: var(--nbs-menu-bg);
  color: var(--nbs-menu-fg);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
}
#${ROOT_ID} .nbs-menu[hidden] { display: none; }
#${ROOT_ID} .nbs-scope-menu { left: 0; }
#${ROOT_ID} .nbs-hist-menu { left: 0; right: 0; min-width: 0; }
#${ROOT_ID} .nbs-hist-title { padding: 4px 10px; font-size: 0.8em; color: var(--nbs-menu-muted); }
#${ROOT_ID} .nbs-hist-row { display: flex; align-items: center; border-radius: 6px; }
#${ROOT_ID} .nbs-hist-row:hover { background: color-mix(in srgb, var(--nbs-menu-fg) 10%, transparent); }
#${ROOT_ID} .nbs-hist-row .nbs-hist-text { flex: 1; min-width: 0; padding: 6px 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
#${ROOT_ID} .nbs-hist-row .nbs-hist-x { padding: 4px 10px; color: var(--nbs-menu-muted); cursor: pointer; border-radius: 6px; }
#${ROOT_ID} .nbs-hist-row .nbs-hist-x:hover { color: var(--nbs-menu-fg); }
#${ROOT_ID} .nbs-hist-clear { display: block; width: auto; padding: 6px 10px; border-radius: 6px; color: var(--nbs-menu-muted); cursor: pointer; }
#${ROOT_ID} .nbs-hist-clear:hover { color: var(--nbs-menu-fg); background: color-mix(in srgb, var(--nbs-menu-fg) 10%, transparent); }
#${ROOT_ID} .nbs-opt-menu { right: 0; }
#${ROOT_ID} .nbs-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  width: auto;
  padding: 6px 10px;
  border-radius: 6px;
  color: inherit;
}
#${ROOT_ID} .nbs-menu button { color: var(--nbs-menu-fg); }
#${ROOT_ID} .nbs-check { visibility: hidden; }
#${ROOT_ID} .nbs-item[aria-checked="true"] .nbs-check { visibility: visible; }
#${ROOT_ID} .nbs-toggle {
  position: relative;
  width: 34px;
  height: 20px;
  box-sizing: border-box;
  border: 1px solid color-mix(in srgb, var(--nbs-menu-fg) 55%, var(--nbs-menu-bg));
  border-radius: 10px;
  background: color-mix(in srgb, var(--nbs-menu-fg) 28%, var(--nbs-menu-bg));
  flex: none;
}
#${ROOT_ID} .nbs-toggle::after {
  content: "";
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #fff;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--nbs-menu-fg) 45%, transparent);
}
/* an = grün, aus = grau mit Rand */
#${ROOT_ID} .nbs-item[aria-checked="true"] .nbs-toggle { background: #2f9e5b; border-color: #23824a; }
#${ROOT_ID} .nbs-item[aria-checked="true"] .nbs-toggle::after { left: 15px; box-shadow: none; }
/* Rückfrage nach Enter */
#${ROOT_ID} .nbs-ask { left: 0; min-width: 300px; padding: 12px 14px; }
#${ROOT_ID} .nbs-ask-title { margin-bottom: 10px; }
#${ROOT_ID} .nbs-ask-btns { display: flex; gap: 8px; }
#${ROOT_ID} .nbs-ask-btn { padding: 5px 14px; border: 1px solid var(--nbs-border); border-radius: 6px; background: var(--nbs-hover); color: var(--nbs-menu-fg); cursor: pointer; font: inherit; }
#${ROOT_ID} .nbs-ask-btn.nbs-ask-primary { background: var(--nbs-accent); color: var(--nbs-on-accent); border-color: var(--nbs-accent); }
#${ROOT_ID} .nbs-ask-rem { display: flex; align-items: center; gap: 6px; margin-top: 10px; font-size: 0.85em; color: var(--nbs-menu-muted); }
/* Leiste im Treffer-Tab (Filtern): nur das Feld, sucht innerhalb der Treffer */
#${ROOT_ID}[data-refine] .nbs-scope,
#${ROOT_ID}[data-refine] .nbs-opt,
#${ROOT_ID}[data-refine] .nbs-range,
#${ROOT_ID}[data-refine] .nbs-suggest { display: none !important; }
#${ROOT_ID} .nbs-sep { height: 1px; margin: 4px 0; background: var(--nbs-line); }
#${ROOT_ID} .nbs-row { display: flex; align-items: center; gap: 6px; padding: 4px 10px; }
#${ROOT_ID} .nbs-row .nbs-label { flex: 1; color: var(--nbs-menu-muted); }
#${ROOT_ID} .nbs-row .nbs-item { gap: 8px; padding: 4px 8px; }
`;

// Das globale Suchfeld der Symbolleiste (Unified Toolbar) ausblenden.
const MAIN_CSS = `global-search-bar { display: none !important; }`;

// Diagnose: schreibt nach <Profil>/novabird-search-debug.log (zum Auswerten von Suchproblemen).
const DEBUG = false;
function dbg(...parts) {
  if (!DEBUG) {
    return;
  }
  try {
    const line = `${new Date().toISOString()} ${parts.map(p => (typeof p === "string" ? p : JSON.stringify(p))).join(" ")}\n`;
    IOUtils.writeUTF8(PathUtils.join(PathUtils.profileDir, "novabird-search-debug.log"), line, {
      mode: "appendOrCreate",
    });
  } catch (e) {
    console.error("NovaBird-Search: Log fehlgeschlagen", e);
  }
}

// about:3pane ignoriert Ordnerwechsel, solange eine synthetische Ansicht (Volltext-Treffer) offen ist
// (folderPane._onSelect bricht dann ab). Ansicht wie beim Mehrfachauswählen verwerfen und den
// gewählten Ordner normal öffnen.
function leaveSyntheticView(cw) {
  try {
    cw.gViewWrapper?.close();
  } catch (e) {
    dbg("close synthetic view failed", String(e));
  }
  // Bis Thunderbird 153 eine eigene Variable; ab 158 nur ein Getter (gViewWrapper.dbView), eine Zuweisung wirft dort
  // einen Fehler und die Ordneransicht würde nicht mehr geöffnet.
  const dbView = Object.getOwnPropertyDescriptor(cw, "gDBView");
  if (!dbView || dbView.writable || dbView.set) {
    cw.gDBView = null;
  }
  cw.gViewWrapper = null;
  try {
    cw.threadTree.view = null;
  } catch (e) {
    // Liste war schon leer
  }
  cw.folderPane._onSelect();
}

// ---- Konversationsansicht: Datum der neuesten Nachricht, neueste Mail hervorheben -----------------
// ThreadRow.fillRow füllt jede Zeile der Nachrichtenliste. Wir ergänzen danach (nur solange cw._nbsGroup gesetzt ist):
// - zugeklappte Konversation: Datumsspalte zeigt die neueste Nachricht statt der ersten,
// - aufgeklappt: die neueste Nachricht bekommt die Klasse "nbs-newest".
function patchThreadRows(cw) {
  const Row = cw.customElements.get("thread-row");
  if (!Row || typeof Row.prototype.fillRow !== "function" || Row.prototype._nbsOriginalFillRow) {
    if (!Row || typeof Row.prototype.fillRow !== "function") nb.nbReportMissing?.("threadDates", "thread-row.fillRow");
    return;
  }
  const original = Row.prototype.fillRow;
  Row.prototype._nbsOriginalFillRow = original;
  Row.prototype.fillRow = function (...args) {
    original.apply(this, args);
    try {
      adjustThreadRow(cw, this);
    } catch (e) {
      if (!cw._nbsAdjustLogged) {
        cw._nbsAdjustLogged = true;
        dbg("adjustThreadRow failed", String(e));
      }
    }
  };
}

function unpatchThreadRows(cw) {
  const Row = cw.customElements?.get("thread-row");
  if (Row?.prototype._nbsOriginalFillRow) {
    Row.prototype.fillRow = Row.prototype._nbsOriginalFillRow;
    delete Row.prototype._nbsOriginalFillRow;
  }
}

function adjustThreadRow(cw, row) {
  row.classList.remove("nbs-newest");
  const view = cw.gDBView;
  if (!cw._nbsGroup || !view || !(cw.gViewWrapper._viewFlags & Ci.nsMsgViewFlagsType.kThreadedDisplay)) {
    return;
  }
  const index = row._index;
  if (view.getLevel(index) === 0 && view.isContainer(index)) {
    if (view.isContainerOpen(index)) {
      return; // aufgeklappt: die Wurzel zeigt ihr eigenes Datum
    }
    const thread = view.getThreadContainingIndex(index);
    const cell = row.querySelector(".datecol-column span");
    if (cell && thread?.newestMsgDate) {
      cell.textContent = new cw.Intl.DateTimeFormat(undefined, {
        dateStyle: "short",
        timeStyle: "short",
      }).format(new Date(thread.newestMsgDate * 1000));
    }
    return;
  }
  const hdr = view.getMsgHdrAt(index);
  const thread = view.getThreadContainingIndex(index);
  const isNewest = Boolean(
    hdr && thread && thread.numChildren > 1 && Math.floor(hdr.date / 1e6) === thread.newestMsgDate
  );
  if (thread && thread.numChildren > 1 && (cw._nbsAdjustLog = (cw._nbsAdjustLog || 0) + 1) <= 40) {
    dbg("row", index, "level", view.getLevel(index), "hdrDate", hdr?.date, "newest", thread?.newestMsgDate,
      "children", thread?.numChildren, "isNewest", isNewest);
  }
  if (isNewest) {
    row.classList.add("nbs-newest");
  }
}

// ---- Gemeinsame Ordner oben im Ordnermodus „Vereinigte/Gruppierte Ordner“ ---------------------------
// Dieser Modus listet nur die festen Sammelordner (Posteingang, Entwürfe …). Wir hängen unsere virtuellen Ordner
// als zusätzliche Zeilen OBEN ein. Namen der Ordner setzt ensureSharedFolders.
let sharedRowNames = [];

// Sammelordner-Zeilen oben fixieren (position: sticky, gestaffelt) und mit einer Trennlinie von den Konten abheben
function markSharedRows(cw, list) {
  const rows = [...list.children].filter(li => sharedRowNames.length && li.uri && !li.hidden && li.classList && isSharedUri(li.uri));
  // Die Liste des Ordnermodus schneidet per overflow:hidden ab und wäre sonst der „Scrollbereich“ der fixierten Zeilen
  list.style.setProperty("overflow", "visible", "important");
  const apply = () => {
    try {
      // Hintergrund des Ordnerbaums übernehmen, damit scrollende Zeilen nicht durchscheinen
      // Farbe von dem, was hinter der Zeile sichtbar ist: der Ordnerbaum (die Liste selbst hat bei manchen Themes eine andere Standardfarbe)
      let bg = "";
      for (let el = list.closest("#folderTree") || list; el && !bg; el = el.parentElement) {
        const c = cw.getComputedStyle(el).backgroundColor;
        if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") {
          bg = c;
        }
      }
      let top = 0;
      rows.forEach((li, i) => {
        li.classList.add("nbs-shared");
        li.classList.toggle("nbs-shared-last", i === rows.length - 1);
        li.classList.toggle("nbs-shared-first", i === 0);
        li.style.top = top + "px";
        li.style.backgroundColor = bg || "Canvas";
        top += li.getBoundingClientRect().height;
      });
    } catch (e) {
      dbg("markSharedRows failed", String(e));
    }
  };
  apply();
  cw.requestAnimationFrame(apply); // nach dem Layout noch einmal (Zeilenhöhen)
  // Beim Start sind die Theme-Farben des Ordnerbereichs oft noch nicht gesetzt: später erneut übernehmen
  cw.setTimeout(apply, 700);
  cw.setTimeout(apply, 3000);
  // Theme oder hell/dunkel wechselt zur Laufzeit: Hintergrund der fixierten Zeilen neu übernehmen (sonst bleiben sie hell auf dunklem Grund)
  cw._nbsSharedApply = apply;
  if (!cw._nbsSharedThemeWatch) {
    cw._nbsSharedThemeWatch = true;
    const again = () => cw.setTimeout(() => cw._nbsSharedApply?.(), 300);
    try {
      cw.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", again);
      new cw.MutationObserver(again).observe(cw.top.document.documentElement, { attributes: true, attributeFilter: ["lwtheme", "lwthemetextcolor", "style"] });
    } catch (e) {
      dbg("theme watch failed", String(e));
    }
  }
}

function isSharedUri(uri) {
  try {
    const localRoot = MailServices.accounts.localFoldersServer.rootFolder;
    return localRoot.subFolders.some(f => f.URI === uri && sharedRowNames.includes(f.name) && f.getFlag(Ci.nsMsgFolderFlags.Virtual));
  } catch {
    return false;
  }
}

// Alle Nachrichten eines gemeinsamen Ordners als gelesen markieren (Betterbird blendet den eigenen Eintrag bei virtuellen
// Ordnern mit Suchbegriffen aus). Suche mit den Begriffen des virtuellen Ordners; „*“ = alle Ordner aller Konten
// außer Papierkorb, Spam, Postausgang und virtuellen Ordnern.
function markSharedRead(uri) {
  const folder = MailServices.folderLookup.getFolderForURL(uri);
  const wrapper = VirtualFolderHelper.wrapVirtualFolder(folder);
  const F = Ci.nsMsgFolderFlags;
  let scope = [];
  const uriProp = folder.msgDatabase?.dBFolderInfo?.getCharProperty("searchFolderUri");
  if (uriProp === "*") {
    for (const server of MailServices.accounts.allServers) {
      if (server.hostName === "smart mailboxes") {
        continue;
      }
      for (const f of server.rootFolder.descendants) {
        if (!f.getFlag(F.Virtual) && !f.getFlag(F.Trash) && !f.getFlag(F.Junk) && !f.getFlag(F.Queue) && !f.noSelect) {
          scope.push(f);
        }
      }
    }
  } else {
    scope = [...wrapper.searchFolders];
  }
  const session = Cc["@mozilla.org/messenger/searchSession;1"].createInstance(Ci.nsIMsgSearchSession);
  for (const term of wrapper.searchTermsSession.searchTerms) {
    session.appendTerm(term);
  }
  const hits = [];
  session.registerListener(
    {
      QueryInterface: ChromeUtils.generateQI(["nsIMsgSearchNotify"]),
      onNewSearch() {},
      onSearchHit(hdr) { hits.push(hdr); },
      onSearchDone() {
        const byFolder = new Map();
        for (const hdr of hits) {
          if (!hdr.isRead) {
            if (!byFolder.has(hdr.folder)) {
              byFolder.set(hdr.folder, []);
            }
            byFolder.get(hdr.folder).push(hdr);
          }
        }
        for (const [f, list] of byFolder) {
          try {
            f.markMessagesRead(list, true);
          } catch (e) {
            dbg("markSharedRead failed", f.name, String(e));
          }
        }
        dbg("markSharedRead:", hits.length, "Treffer,", byFolder.size, "Ordner");
      },
    },
    Ci.nsIMsgSearchSession.allNotifications
  );
  for (const f of scope) {
    session.addScopeTerm(Ci.nsMsgSearchScope.offlineMail, f);
  }
  session.search(null);
}

// Rechtsklick-Menü der Ordner: bei den gemeinsamen Ordnern ganz oben „Alle als gelesen markieren“
function addSharedMenu(win, getLabel) {
  const popup = win.document.getElementById("folderPaneContext");
  if (!popup || popup._nbsItem) {
    return;
  }
  const doc = win.document;
  const item = doc.createXULElement("menuitem");
  item.id = "nbs-markAllRead";
  const sep = doc.createXULElement("menuseparator");
  sep.id = "nbs-markAllRead-sep";
  popup.prepend(sep);
  popup.prepend(item);
  popup._nbsItem = item;
  item.addEventListener("command", () => {
    try {
      const f = win.folderPaneContextMenu.activeFolder;
      if (f && isSharedUri(f.URI)) {
        markSharedRead(f.URI);
      }
    } catch (e) {
      dbg("markAllRead failed", String(e));
    }
  });
  popup._nbsShowing = () => {
    let shared = false;
    try {
      shared = isSharedUri(win.folderPaneContextMenu.activeFolder?.URI);
    } catch (e) {
      // kein Ordner
    }
    item.hidden = !shared;
    sep.hidden = !shared;
    item.setAttribute("label", getLabel());
  };
  popup.addEventListener("popupshowing", popup._nbsShowing);
}

function removeSharedMenu(win) {
  const popup = win.document?.getElementById("folderPaneContext");
  if (popup?._nbsShowing) {
    popup.removeEventListener("popupshowing", popup._nbsShowing);
  }
  popup?._nbsItem?.remove();
  win.document?.getElementById("nbs-markAllRead-sep")?.remove();
  if (popup) {
    delete popup._nbsItem;
    delete popup._nbsShowing;
  }
}

function addSharedRows(cw) {
  try {
    const fp = cw.folderPane;
    const localRoot = MailServices.accounts.localFoldersServer.rootFolder;
    // „Vereinigte Ordner“ (smart) und „Alle Ordner“ (all): unsere Ordner als oberste Zeilen
    for (const modeName of ["smart", "all"]) {
      const mode = fp?._modes?.[modeName];
      // mode.active wird erst NACH init() gesetzt, daher nur auf die Liste prüfen
      if (!mode?.containerList) {
        continue;
      }
      const list = mode.containerList;
      for (const name of [...sharedRowNames].reverse()) {
        const folder = localRoot.subFolders.find(f => f.name === name && f.getFlag(Ci.nsMsgFolderFlags.Virtual));
        if (!folder) {
          continue;
        }
        // eigene oberste Zeile suchen oder anlegen und immer nach OBEN schieben: spätere Einfügungen des
        // Ordnermodus (z. B. die Zeile „Lokale Ordner“) dürfen die Reihenfolge nicht durcheinanderbringen
        let row = [...list.children].find(li => li.uri === folder.URI);
        if (!row) {
          row = fp._createFolderRow(modeName, folder);
        }
        list.prepend(row);
        // „Alle Ordner“: die gleiche Zeile unter „Lokale Ordner“ ausblenden (sonst steht sie doppelt da)
        if (modeName === "all") {
          for (const dup of list.querySelectorAll("li")) {
            if (dup.uri === folder.URI && dup !== row) {
              dup.hidden = true;
            }
          }
        }
      }
      markSharedRows(cw, list);
      // Die Zeile „Lokale Ordner“ gehört wie ohne Add-on an ihren Platz (Modus „Vereinigte Ordner“: ans Ende)
      if (modeName === "smart") {
        const localRow = [...list.children].find(li => li.uri === localRoot.URI);
        if (localRow) {
          list.append(localRow);
        }
      }
    }
  } catch (e) {
    dbg("addSharedRows failed", String(e));
  }
}

function allMainTabs() {
  const tabs = [];
  for (const win of Services.wm.getEnumerator("mail:3pane")) {
    for (const tab of win.document.getElementById("tabmail")?.tabInfo ?? []) {
      if (tab.chromeBrowser?.contentWindow?.folderPane) {
        tabs.push(tab);
      }
    }
  }
  return tabs;
}

var searchBar = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    nbUnloadShared(this.extension);
    ExtensionSupport.unregisterWindowListener(LISTENER_NAME);
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      const tabmail = win.document.getElementById("tabmail");
      if (this._monitor && tabmail) {
        tabmail.unregisterTabMonitor(this._monitor);
      }
      win.document.getElementById(MAIN_STYLE_ID)?.remove();
      if (this._onKeyDown) {
        win.removeEventListener("keydown", this._onKeyDown, true);
      }
      for (const tab of tabmail?.tabInfo ?? []) {
        if (this._onKeyDown) {
          tab.chromeBrowser?.contentWindow?.removeEventListener("keydown", this._onKeyDown, true);
        }
        if (tab.chromeBrowser?.contentWindow) {
          const cw = tab.chromeBrowser.contentWindow;
          cw._nbsGroup = false;
          unpatchThreadRows(cw);
          removeSharedMenu(cw);
          const smartMode = cw.folderPane?._modes?.smart;
          if (smartMode?._nbsOriginalInit) {
            smartMode.init = smartMode._nbsOriginalInit;
            delete smartMode._nbsOriginalInit;
          }
        }
        if (tab._nbsSelectListener) {
          tab.chromeBrowser?.contentWindow?.folderTree?.removeEventListener("select", tab._nbsSelectListener);
          delete tab._nbsSelectListener;
        }
        const doc = tab.chromeBrowser?.contentDocument;
        doc?.getElementById(ROOT_ID)?.remove();
        doc?.getElementById(STYLE_ID)?.remove();
      }
    }
  }

  getAPI(context) {
    const self = this;
    const emitter = new ExtensionCommon.EventEmitter();
    let strings = { ...DEFAULT_STRINGS };
    if (!nb.nbRunSelfTest) {
      try {
        nbLoadShared(context.extension, ["shared/selftest.js"], nb);
      } catch (e) {
        console.error("NovaBird: gemeinsamer Code nicht geladen", e); // nur Selbsttest/Farbrechnung fehlen, Rest läuft
      }
    }
    // Jede Suchleiste (je about:3pane-Tab, auch in weiteren Hauptfenstern) hat eine feste ID und einen eigenen Zustand
    // (Haken, Bereich, Filter). Alle Ereignisse tragen die ID, alle Antworten des Hintergrunds gehen an genau diese Leiste.
    let barSeq = 0;
    const stateOf = root => (root._nbsState ??= { ...DEFAULT_STATE });
    const barOf = barId => {
      for (const win of Services.wm.getEnumerator("mail:3pane")) {
        const tabmail = win.document.getElementById("tabmail");
        for (const tab of tabmail?.tabInfo ?? []) {
          const root = tab.chromeBrowser?.contentDocument?.getElementById(ROOT_ID);
          if (root && root._nbsId === barId) {
            return { win, tabmail, tab, cw: tab.chromeBrowser.contentWindow, root };
          }
        }
      }
      return null; // unbekannte ID (Tab geschlossen): Aufrufe tun nichts, statt ein anderes Fenster zu treffen
    };

    const normalizeState = raw => {
      const out = { ...DEFAULT_STATE };
      for (const key of Object.keys(DEFAULT_STATE)) {
        if (key === "scope") {
          out.scope = raw?.scope === "folder" ? "folder" : "all";
        } else if (key === "range") {
          out.range = ["today", "3d", "7d", "30d"].includes(raw?.range) ? raw.range : "all";
        } else if (typeof raw?.[key] === "boolean") {
          out[key] = raw[key];
        }
      }
      return out;
    };

    // ---- Oberfläche in about:3pane -----------------------------------------

    const roots = () => {
      const result = [];
      for (const win of Services.wm.getEnumerator("mail:3pane")) {
        for (const tab of win.document.getElementById("tabmail")?.tabInfo ?? []) {
          const root = tab.chromeBrowser?.contentDocument?.getElementById(ROOT_ID);
          if (root) {
            result.push(root);
          }
        }
      }
      return result;
    };

    const isDefaultOptions = state =>
      Object.keys(DEFAULT_STATE).every(
        key => key === "scope" || key === "range" || state[key] === DEFAULT_STATE[key]
      );

    // Beschriftungen und Häkchen aus dem gemeinsamen Zustand neu zeichnen.
    const refresh = root => {
      const state = stateOf(root);
      const scopeText = state.scope === "folder" ? strings.scopeFolder : strings.scopeAll;
      root.querySelector(".nbs-scope .nbs-scope-text").textContent = scopeText;
      root.querySelector("input").placeholder = root.hasAttribute("data-refine") ? strings.refinePlaceholder : strings.placeholder;
      root.querySelector(".nbs-opt").title = strings.options;
      root.querySelector(".nbs-spin").title = strings.busy;
      root.querySelector(".nbs-clear").title = strings.clear;
      root.querySelector(".nbs-clear").setAttribute("aria-label", strings.clear);
      root.querySelector(".nbs-opt").classList.toggle("nbs-changed", !isDefaultOptions(state));
      for (const item of root.querySelectorAll("[data-key]")) {
        const key = item.dataset.key;
        const label = item.querySelector(".nbs-text");
        if (label) {
          label.textContent = strings[item.dataset.label];
        }
        const checked =
          key === "scope-all" ? state.scope === "all"
          : key === "scope-folder" ? state.scope === "folder"
          : key.startsWith("range:") ? state.range === key.slice(6)
          : state[key] === true;
        item.setAttribute("aria-checked", String(checked));
      }
    };
    let history = []; // Suchhistorie, neueste zuerst
    const doc0 = el => el.ownerDocument;
    const refreshAll = () => roots().forEach(refresh);

    const emitQuery = root =>
      emitter.emit("query", { barId: root._nbsId, text: root.querySelector("input").value, state: { ...stateOf(root) }, refine: root.hasAttribute("data-refine") });

    const buildUI = (doc, refine = false) => {
      const el = (tag, cls) => {
        const e = doc.createElementNS(HTML_NS, tag);
        if (cls) {
          e.className = cls;
        }
        return e;
      };
      const root = el("div");
      root.id = ROOT_ID;
      root._nbsId = `nbs${++barSeq}`; // feste ID dieser Leiste
      if (refine) {
        root.setAttribute("data-refine", "");
      }

      const field = el("div", "nbs-field");
      const scopeBtn = el("button", "nbs-scope");
      scopeBtn.type = "button";
      const scopeText = el("span", "nbs-scope-text");
      const scopeArrow = el("span");
      scopeArrow.textContent = "▾";
      scopeBtn.append(scopeText, scopeArrow);

      const input = el("input");
      input.type = "text";
      input.setAttribute("autocomplete", "off");
      input.setAttribute("spellcheck", "false");

      const optBtn = el("button", "nbs-opt");
      optBtn.type = "button";
      optBtn.textContent = "⚙";
      const spin = el("span", "nbs-spin");
      spin.setAttribute("role", "status");
      const clearBtn = el("button", "nbs-clear");
      clearBtn.type = "button";
      clearBtn.textContent = "✕";
      field.append(scopeBtn, input, clearBtn, spin, optBtn);

      // Menüeintrag mit Häkchen (Auswahl) oder Schalter
      const item = (key, labelKey, kind) => {
        const b = el("button", "nbs-item");
        b.type = "button";
        b.dataset.key = key;
        b.dataset.label = labelKey;
        b.setAttribute("role", kind === "radio" ? "menuitemradio" : "menuitemcheckbox");
        const text = el("span", "nbs-text");
        if (kind === "action") {
          b.append(text);
        } else {
          b.append(text, kind === "toggle" ? el("span", "nbs-toggle") : Object.assign(el("span", "nbs-check"), { textContent: "✓" }));
        }
        return b;
      };

      const scopeMenu = el("div", "nbs-menu nbs-scope-menu");
      scopeMenu.hidden = true;
      scopeMenu.append(item("scope-all", "scopeAll", "radio"), item("scope-folder", "scopeFolder", "radio"));

      const optMenu = el("div", "nbs-menu nbs-opt-menu");
      optMenu.hidden = true;
      const includeRow = el("div", "nbs-row");
      const includeLabel = el("span", "nbs-label nbs-text");
      includeLabel.dataset.labelOnly = "includeLabel";
      includeRow.append(includeLabel, item("trash", "optTrash", "toggle"), item("spam", "optSpam", "toggle"));
      optMenu.append(
        item("from", "optFrom", "check"),
        item("to", "optTo", "check"),
        item("subject", "optSubject", "check"),
        item("body", "optBody", "check"),
        el("div", "nbs-sep"),
        item("attachment", "optAttachment", "toggle"),
        item("unread", "optUnread", "toggle"),
        el("div", "nbs-sep"),
        includeRow,
        el("div", "nbs-sep"),
        (() => {
          const b = item("settings", "openSettings", "action");
          b.setAttribute("role", "menuitem");
          return b;
        })()
      );

      // Suchhistorie: klappt unter dem leeren, fokussierten Suchfeld auf
      const histMenu = el("div", "nbs-menu nbs-hist-menu");
      histMenu.hidden = true;
      root._renderHistory = () => {
        histMenu.replaceChildren();
        if (!history.length) {
          histMenu.hidden = true;
          return;
        }
        const title = el("div", "nbs-hist-title");
        title.textContent = strings.historyTitle || "Recent searches";
        histMenu.append(title);
        for (const text of history) {
          const row = el("div", "nbs-hist-row");
          const label = el("span", "nbs-hist-text");
          label.textContent = text;
          label.title = text;
          label.addEventListener("click", () => {
            input.value = text;
            root.toggleAttribute("data-has-text", true);
            histMenu.hidden = true;
            emitQuery(root);
          });
          const x = el("span", "nbs-hist-x");
          x.textContent = "✕";
          x.title = strings.historyRemove || "Remove entry";
          x.addEventListener("click", e => {
            e.stopPropagation();
            emitter.emit("historyRemove", text);
          });
          row.append(label, x);
          histMenu.append(row);
        }
        histMenu.append(el("div", "nbs-sep"));
        const clear = el("button", "nbs-hist-clear");
        clear.type = "button";
        clear.textContent = strings.historyClear || "Clear history";
        clear.addEventListener("click", () => {
          histMenu.hidden = true;
          emitter.emit("historyClear");
        });
        histMenu.append(clear);
      };
      root._showHistory = () => {
        if (!refine && input.value === "" && history.length) {
          root._renderHistory();
          histMenu.hidden = false;
        }
      };
      root._hideHistory = () => (histMenu.hidden = true);

      // Feste Zeitfenster unter dem Suchfeld: Alle | Heute | 3 Tage | 7 Tage | 30 Tage
      const rangeRow = el("div", "nbs-range");
      rangeRow.setAttribute("role", "radiogroup");
      for (const [value, labelKey] of [
        ["all", "rangeAll"], ["today", "rangeToday"], ["3d", "range3"], ["7d", "range7"], ["30d", "range30"],
      ]) {
        const chip = el("button", "nbs-chip");
        chip.type = "button";
        chip.dataset.key = `range:${value}`;
        chip.dataset.label = labelKey;
        chip.setAttribute("role", "radio");
        chip.append(el("span", "nbs-text"));
        rangeRow.append(chip);
      }

      // „Meinten Sie …?“ (Tippfehler-Vorschlag des NovaBird-DB) rechts in der Zeile der Zeitfenster: kein zusätzlicher Platz, kein Springen
      const suggestBtn = el("button", "nbs-suggest");
      suggestBtn.type = "button";
      suggestBtn.hidden = true;
      suggestBtn.addEventListener("click", () => {
        const text = suggestBtn.dataset.text;
        if (!text) return;
        input.value = text;
        root.toggleAttribute("data-has-text", true);
        emitQuery(root);
      });
      const note = el("span", "nbs-note");
      note.hidden = true;
      rangeRow.append(note);

      root.append(field, suggestBtn, rangeRow, scopeMenu, optMenu, histMenu);

      const closeMenus = () => {
        scopeMenu.hidden = true;
        optMenu.hidden = true;
        histMenu.hidden = true;
      };
      const toggleMenu = menu => {
        const open = menu.hidden;
        closeMenus();
        menu.hidden = !open;
      };
      scopeBtn.addEventListener("click", e => { e.stopPropagation(); toggleMenu(scopeMenu); });
      optBtn.addEventListener("click", e => { e.stopPropagation(); toggleMenu(optMenu); });
      doc.addEventListener("click", e => { if (!root.contains(e.target)) closeMenus(); });
      doc.addEventListener("keydown", e => { if (e.key === "Escape") closeMenus(); });

      const apply = key => {
        const state = stateOf(root);
        if (key === "settings") {
          closeMenus();
          emitter.emit("openSettings");
          return;
        }
        if (key.startsWith("range:")) state.range = key.slice(6);
        else if (key === "scope-all") state.scope = "all";
        else if (key === "scope-folder") state.scope = "folder";
        else state[key] = !state[key];
        refresh(root); // nur diese Leiste: der Zustand gilt je Fenster/Tab
        emitter.emit("stateChanged", { ...state });
        emitQuery(root);
      };
      rangeRow.addEventListener("click", e => {
        const b = e.target.closest("[data-key]");
        if (b) apply(b.dataset.key);
      });
      scopeMenu.addEventListener("click", e => {
        const b = e.target.closest("[data-key]");
        if (b) { apply(b.dataset.key); closeMenus(); }
      });
      optMenu.addEventListener("click", e => {
        const b = e.target.closest("[data-key]");
        if (b) { e.stopPropagation(); apply(b.dataset.key); }
      });

      const syncClear = () => root.toggleAttribute("data-has-text", input.value !== "");
      input.addEventListener("keydown", e => {
        if (e.key === "Enter" && input.value.trim() && !refine) {
          histMenu.hidden = true;
          emitter.emit("historyAdd", input.value.trim());
          emitter.emit("enter", input.value, root._nbsId);
        }
      });
      input.addEventListener("input", () => {
        syncClear();
        histMenu.hidden = true;
        emitQuery(root);
      });
      input.addEventListener("focus", () => root._showHistory());
      input.addEventListener("click", () => root._showHistory());
      // Suche in die Historie: bei Enter und wenn das Feld mit Text verlassen wird (keine Zwischenstände beim Tippen)
      input.addEventListener("blur", () => {
        const t = input.value.trim();
        if (t.length >= 3 && !refine) emitter.emit("historyAdd", t);
      });
      // „✕“: Feld leeren und Suche beenden (leerer Text = Ordneransicht zurück)
      clearBtn.addEventListener("click", () => {
        input.value = "";
        syncClear();
        root._nbsState = { ...DEFAULT_STATE }; // Ende der Suche: Bereich, Haken und Filter zurück auf Standard
        refresh(root);
        emitQuery(root);
        input.focus();
      });
      refresh(root);
      return root;
    };

    // Texte der „Einschließen“-Zeile (kein data-key)
    const refreshLabels = () => {
      for (const root of roots()) {
        for (const l of root.querySelectorAll("[data-label-only]")) {
          l.textContent = strings[l.dataset.labelOnly];
        }
      }
    };

    let openingSnapshot = false; // true, solange wir selbst einen Treffer-Tab öffnen (bekommt kein Suchfeld)

    const inject = tab => {
      const refine = Boolean(tab._nbsSnapshot); // Treffer-Tab: Leiste sucht nur innerhalb der Treffer
      const browser = tab.chromeBrowser;
      const win = browser?.contentWindow;
      if (!win || !win.location.href.startsWith("about:3pane")) {
        return;
      }
      const run = () => {
        const doc = browser.contentDocument;
        const header = doc.getElementById("threadPaneHeaderBar");
        const end = header?.querySelector(".list-header-bar-container-end");
        if (!header || !end || doc.getElementById(ROOT_ID)) {
          return;
        }
        if (!doc.getElementById(STYLE_ID)) {
          const style = doc.createElementNS(HTML_NS, "style");
          style.id = STYLE_ID;
          style.textContent = CSS;
          (doc.head || doc.documentElement).appendChild(style);
        }
        header.insertBefore(buildUI(doc, refine), end);
        // Klick auf einen anderen Ordner: Volltext-Ansicht verlassen (sonst bleibt die Trefferliste stehen)
        tab._nbsSelectListener = () => {
          if (win.gViewWrapper?.isSynthetic && !tab._nbsSnapshot) {
            leaveSyntheticView(win);
          }
        };
        win.folderTree?.addEventListener("select", tab._nbsSelectListener);
        patchThreadRows(win);
        // Gemeinsame Ordner oben im Ordnermodus „Vereinigte Ordner“: Zeilen nach jedem Aufbau des Modus einhängen
        const smartMode = win.folderPane?._modes?.smart;
        if (smartMode && !smartMode._nbsOriginalInit) {
          smartMode._nbsOriginalInit = smartMode.init;
          smartMode.init = function (...args) {
            const result = smartMode._nbsOriginalInit.apply(this, args);
            addSharedRows(win);
            win.setTimeout(() => addSharedRows(win), 500);
            return result;
          };
        }
        addSharedRows(win);
        addSharedMenu(win, () => strings.markAllRead);
        win.addEventListener("keydown", onKeyDown, true);
        refreshLabels();
        // Native Leiste intern öffnen (Betterbird merkt sich sonst den letzten Zustand); sie ist per CSS unsichtbar.
        try {
          win.quickFilterBar._showFilterBar(true, true);
        } catch (e) {
          console.error("NovaBird-Search: Leiste konnte nicht geöffnet werden", e);
        }
      };
      if (browser.contentDocument.readyState === "complete" && win.quickFilterBar?.filterer) {
        run();
      } else {
        win.addEventListener("load", () => win.setTimeout(run, 0), { once: true });
      }
    };

    // Das Dokument eines neuen Tabs/Fensters lädt erst kurz nach dem Öffnen: bis zu 10 s lang erneut versuchen
    // (neue Treffer-Tabs und ein zweites Hauptfenster; im ersten Fenster greifen die Tab-Ereignisse).
    const injectWhenReady = tab => {
      // Das Fenster dient nur als Zeitgeber (inject() findet das Fenster des Tabs selbst); chromeBrowser gibt es beim Öffnen oft noch nicht
      const win = tab.panel?.ownerGlobal ?? tab.tabNode?.ownerGlobal ?? tab.chromeBrowser?.ownerGlobal ?? Services.wm.getMostRecentWindow("mail:3pane");
      if (!win) {
        return;
      }
      let tries = 40;
      const retry = () => {
        inject(tab);
        if (tries-- > 0 && !tab.chromeBrowser?.contentDocument?.getElementById(ROOT_ID)) {
          win.setTimeout(retry, 250);
        }
      };
      win.setTimeout(retry, 100);
    };

    // Strg+K und Strg+Umschalt+K (global bzw. Schnellfilter) springen in unser Feld.
    const focusSearch = win => {
      const tabmail = win.document.getElementById("tabmail");
      const doc = tabmail?.currentTabInfo?.chromeBrowser?.contentDocument;
      const input = doc?.querySelector(`#${ROOT_ID} input`);
      if (!input) {
        return false;
      }
      // Fokus über den Fokus-Manager: input.focus() allein wirkt nicht, wenn der Fokus in einem anderen Dokument liegt.
      try {
        tabmail.currentTabInfo.chromeBrowser.focus();
        Services.focus.setFocus(input, Services.focus.FLAG_BYKEY);
      } catch (e) {
        dbg("focus failed", String(e));
        input.focus();
      }
      input.select();
      dbg("focusSearch ok, active element:", doc.activeElement?.localName);
      return true;
    };
    const onKeyDown = event => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "k") {
        // das Hauptfenster, in dem die Taste gedrückt wurde (nicht „das zuletzt aktive“)
        const src = event.currentTarget;
        const win = src?.document?.documentElement?.getAttribute("windowtype") === "mail:3pane"
          ? src
          : src?.browsingContext?.embedderElement?.ownerGlobal ?? Services.wm.getMostRecentWindow("mail:3pane");
        dbg("key", event.key, "ctrl", event.ctrlKey, "shift", event.shiftKey, "win", Boolean(win));
        if (win && focusSearch(win)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    };
    self._onKeyDown = onKeyDown;

    const monitor = {
      monitorName: MONITOR_NAME,
      onTabTitleChanged() {},
      onTabSwitched(tab) { inject(tab); },
      onTabOpened(tab) {
        if (openingSnapshot) {
          tab._nbsSnapshot = true; // Treffer-Tab: bekommt die Leiste nur zum Eingrenzen der Treffer
          injectWhenReady(tab); // das Dokument des neuen Tabs lädt erst kurz danach
          return;
        }
        inject(tab);
      },
      onTabClosing() {},
      onTabPersist() {},
      onTabRestored(tab) { inject(tab); },
    };
    self._monitor = monitor;

    ExtensionSupport.registerWindowListener(LISTENER_NAME, {
      chromeURLs: [MAIN_URL],
      onLoadWindow(win) {
        const doc = win.document;
        if (!doc.getElementById(MAIN_STYLE_ID)) {
          const style = doc.createElementNS(HTML_NS, "style");
          style.id = MAIN_STYLE_ID;
          style.textContent = MAIN_CSS;
          (doc.head || doc.documentElement).appendChild(style);
        }
        win.addEventListener("keydown", onKeyDown, true);
        const tabmail = doc.getElementById("tabmail");
        tabmail.registerTabMonitor(monitor);
        // Zweites Hauptfenster: beim Laden des Fensters ist der erste Tab oft noch nicht angelegt oder nicht fertig.
        // Bis zu 10 s lang alle Tabs des Fensters versuchen (inject ist wiederholbar).
        let tries = 40;
        const retryTabs = () => {
          let missing = tabmail.tabInfo.length === 0;
          for (const tab of tabmail.tabInfo) {
            inject(tab);
            // nur Tabs mit der Dreispaltenansicht brauchen die Leiste (Inhalts-/Nachrichten-Tabs haben kein chromeBrowser)
            if (tab.chromeBrowser && !tab.chromeBrowser.contentDocument?.getElementById(ROOT_ID)) {
              missing = true;
            }
          }
          if (missing && tries-- > 0) {
            win.setTimeout(retryTabs, 250);
          }
        };
        retryTabs();
      },
    });

    // ---- Markierung des Suchworts im Nachrichtentext ---------------------------

    // Findbar-Finder des Nachrichtenbereichs DIESER Leiste: markiert alle Vorkommen (wie Strg+F „Alle hervorheben“).
    const applyHighlight = barId => {
      const b = barOf(barId);
      if (!b) {
        return;
      }
      const word = b.root._nbsHighlight || "";
      try {
        const pane = b.cw?.messageBrowser?.contentWindow?.getMessagePaneBrowser?.();
        if (!pane?.finder) {
          return;
        }
        if (word) {
          pane.finder.highlight(true, word, false);
        } else {
          pane.finder.highlight(false, "");
        }
      } catch (e) {
        console.error("NovaBird-Search: Markieren fehlgeschlagen", e);
      }
    };

    // ---- Volltext: Kopfzeilen-Suche + Gloda, angezeigt in derselben Liste -----------

    const setBusy = (barId, on) => {
      barOf(barId)?.root.toggleAttribute("data-busy", on);
    };

    // Treffer in Von/An/Betreff aus den Kopfzeilen-Datenbanken (offline, schnell; Teilstring).
    const searchHeaders = (criteria, opts, folders) =>
      new Promise(resolve => {
        const session = newSession();
        // Nachrichtentext ist Sache von Gloda
        const headerCriteria = { ...criteria };
        delete headerCriteria.body;
        if (!(opts.from || opts.to || opts.subject)) {
          delete headerCriteria.freeText; // nur Nachrichtentext angehakt
        }
        const headerTerms = buildTerms(headerCriteria, { ...opts, body: false }, session);
        if (!headerTerms.length) {
          resolve([]); // ohne Bedingung würde jede Nachricht passen
          return;
        }
        for (const term of headerTerms) {
          session.appendTerm(term);
        }
        const hits = [];
        session.registerListener(
          {
            QueryInterface: ChromeUtils.generateQI(["nsIMsgSearchNotify"]),
            onNewSearch() {},
            onSearchHit(hdr) { hits.push(hdr); },
            onSearchDone() { resolve(hits); },
          },
          Ci.nsIMsgSearchSession.allNotifications
        );
        for (const folder of folders) {
          session.addScopeTerm(Ci.nsMsgSearchScope.offlineMail, folder);
        }
        session.search(null);
      });

    // Treffer im Volltext aus dem Gloda-Index, nur in den angehakten Feldern (Gloda hat je Spalte ein eigenes
    // Attribut: authorMatches, recipientsMatch, subjectMatches, bodyMatches; mehrere Spalten = ODER).
    const searchGloda = (criteria, opts, limit = GLODA_LIMIT) => {
      let phrase = criteria.freeText || "";
      let columns = [];
      if (phrase) {
        if (opts.from) columns.push("authorMatches");
        if (opts.to) columns.push("recipientsMatch");
        if (opts.subject) columns.push("subjectMatches");
        if (opts.body) columns.push("bodyMatches");
        if (!columns.length) columns = ["subjectMatches"];
      } else if (criteria.body) {
        phrase = criteria.body;
        columns = ["bodyMatches"];
      } else {
        return Promise.resolve([]);
      }
      // Wörter bzw. Phrasen in Anführungszeichen; jedes als Wortanfang („ärzt“ findet „ärztliche“)
      const terms = new GlodaMsgSearcher(null, phrase).fulltextTerms.filter(Boolean);
      const match = terms.map(t => `"${t.replace(/"/g, "")}*"`).join(" ");
      if (!match) {
        return Promise.resolve([]);
      }
      return new Promise(resolve => {
        const query = Gloda.newQuery(GlodaConstants.NOUN_MESSAGE);
        columns.forEach((column, i) => (i === 0 ? query : query.or())[column](match));
        query.orderBy("-date");
        query.limit(limit);
        query.getCollection({
          onItemsAdded() {},
          onItemsModified() {},
          onItemsRemoved() {},
          onQueryCompleted(collection) {
            const hdrs = collection.items.map(item => item.folderMessage).filter(Boolean);
            dbg("gloda query", { match, columns, items: collection.items.length, withHeader: hdrs.length });
            resolve(hdrs);
          },
        });
      });
    };

    // NovaBird-DB-Zeilen (headerMessageId + Ordner-ID) -> Kopfzeilen; Optionen und Zeitraum werden angewendet.
    const resolveRows = (rows, opts, criteria) => {
      const F = Ci.nsMsgFolderFlags;
      const folders = new Map(); // Ordner-ID -> Ordner (oder null)
      const hdrs = [];
      // Diagnose: warum werden NovaBird-DB-Treffer nicht angezeigt?
      const lost = { unknownFolder: 0, trashSpam: 0, noHeader: 0, filtered: 0 };
      const unknownIds = new Set();
      for (const row of rows) {
        if (!folders.has(row.folder_id)) {
          let folder = null;
          let why = "unknownFolder";
          try {
            folder = getFolder(row.folder_id).folder;
          } catch (e) {
            dbg("id search: Ordner unbekannt", row.folder_id);
            unknownIds.add(row.folder_id);
          }
          if (folder && (folder.getFlag(F.Virtual) || (!opts.trash && inFlaggedFolder(folder, F.Trash)) || (!opts.spam && inFlaggedFolder(folder, F.Junk)))) {
            folder = null;
            why = "trashSpam";
          }
          folders.set(row.folder_id, folder ? folder : why);
        }
        const folder = folders.get(row.folder_id);
        if (typeof folder === "string") {
          lost[folder]++;
          continue;
        }
        if (!folder) continue;
        let hdr = null;
        try {
          hdr = folder.msgDatabase.getMsgHdrForMessageID(row.header_msg_id);
        } catch (e) {
          dbg("id search: Kopfzeile fehlt", row.header_msg_id, String(e));
        }
        if (!hdr) {
          lost.noHeader++;
          continue;
        }
        if (opts.unread && hdr.isRead) { lost.filtered++; continue; }
        if (opts.attachment && !(hdr.flags & Ci.nsMsgMessageFlags.Attachment)) { lost.filtered++; continue; }
        const ms = hdr.date / 1000;
        if (criteria.fromDate && ms < criteria.fromDate) { lost.filtered++; continue; }
        if (criteria.toDate && ms >= criteria.toDate + 864e5) { lost.filtered++; continue; }
        hdrs.push(hdr);
      }
      return { hdrs, lost, unknownIds };
    };

    // Treffer-Ansicht: GlodaSyntheticView als Hülle, die eine eigene Liste von Kopfzeilen meldet.
    const makeView = (hdrs, keepOrder = false) => {
      const view = new GlodaSyntheticView({
        collection: Gloda.explicitCollection(GlodaConstants.NOUN_MESSAGE, []),
      });
      view.reportResults = function () {
        for (const hdr of hdrs) {
          this.searchListener.onSearchHit(hdr, hdr.folder);
        }
      };
      // Relevanz: Reihenfolge der Trefferliste beibehalten (byNone), sonst neueste zuerst
      view.defaultSort = keepOrder
        ? [[Ci.nsMsgViewSortType.byNone, Ci.nsMsgViewSortOrder.ascending]]
        : [[Ci.nsMsgViewSortType.byDate, Ci.nsMsgViewSortOrder.descending]];
      return view;
    };

    const analysisHdrs = new Map(); // Analyse-Nummer -> { hdrs, ms } (für recipientsChunk)

    const showHeaders = (b, hdrs, title, group, keepOrder = false, keepName = false) => {
      const win = b?.win;
      const cw = b?.cw;
      if (!cw?.restoreState) {
        return false;
      }
      b.root._nbsLastHdrs = hdrs; // Treffer der zuletzt angezeigten Volltext-Ansicht dieser Leiste
      cw.restoreState({ syntheticView: makeView(hdrs, keepOrder), folderPaneVisible: true, title });
      // Die Kopfzeile zählt sonst die Nachrichten des zuletzt gewählten Ordners (hier: der alte Suchordner)
      const setCount = () => {
        try {
          cw.threadPaneHeader.updateMessageCount(hdrs.length);
        } catch (e) {
          dbg("count failed", String(e));
        }
      };
      // Überschrift: bei Trefferlisten „Suchergebnisse“ statt des zuletzt gewählten Ordners
      const setTitle = () => {
        if (keepName) {
          return; // „Aktueller Ordner“: der Ordnername bleibt stehen
        }
        try {
          const h = cw.document.getElementById("threadPaneFolderName");
          if (h) {
            h.textContent = strings.resultsTitle;
            h.title = strings.resultsTitle;
          }
        } catch (e) {
          dbg("title failed", String(e));
        }
      };
      setCount();
      setTitle();
      win.setTimeout(() => (setCount(), setTitle()), 400);
      try {
        // Standard: flach (sonst steht ein alter Thread-Anfang oben); Option: nach Konversation gruppieren
        if (group) {
          cw.gViewWrapper.showThreaded = true;
        } else {
          cw.gViewWrapper.showUnthreaded = true;
        }
      } catch (e) {
        dbg("view mode failed", String(e));
      }
      return true;
    };

    // Detailsuche: Thunderbirds eigene Suchansicht (Facetten links: Absender, Empfänger, Zeitraum …).
    // Der Suchbegriff steht dort fest; jedes Wort wird als Wortanfang gesucht.
    const openFacetSearch = (b, text, limit) => {
      const tabmail = b?.tabmail;
      if (!tabmail || !text.trim()) {
        return false;
      }
      const searcher = new GlodaMsgSearcher(null, text);
      searcher.fulltextTerms = searcher.fulltextTerms.map(t =>
        /^NEAR(\/\d+)?$/.test(t) || t.endsWith("*") ? t : t + "*"
      );
      Object.defineProperty(searcher, "retrievalLimit", { get: () => limit || GLODA_LIMIT });
      tabmail.openTab("glodaFacet", { searcher });
      return true;
    };

    // Treffer der aktuellen Ansicht (Volltext-Liste oder Suchordner) als Momentaufnahme in neuem Tab.
    const openResultsInNewTab = (b, title) => {
      const cw = b?.cw;
      if (!cw) {
        return -1;
      }
      let hdrs = [];
      if (cw.gViewWrapper?.isSynthetic && b.root._nbsLastHdrs) {
        hdrs = b.root._nbsLastHdrs;
      } else {
        const dbView = cw.gViewWrapper?.dbView;
        for (let i = 0; dbView && i < dbView.rowCount; i++) {
          const hdr = dbView.getMsgHdrAt(i);
          if (hdr) {
            hdrs.push(hdr);
          }
        }
      }
      return openSnapshotTab(b, hdrs, title);
    };

    const openSnapshotTab = (b, hdrs, title) => {
      const win = b?.win;
      const tabmail = b?.tabmail;
      if (!tabmail || !hdrs.length) {
        return hdrs.length ? -1 : 0;
      }
      openingSnapshot = true;
      try {
        tabmail.openTab("mail3PaneTab", {
          folderPaneVisible: false,
          syntheticView: makeView(hdrs),
          title,
        });
      } finally {
        openingSnapshot = false;
      }
      // Diese Ansicht gehört dem Nutzer: kein Suchfeld, nicht mit der laufenden Suche zurücksetzen
      tabmail.currentTabInfo._nbsSnapshot = true;
      const newTab = tabmail.currentTabInfo;
      newTab._nbsAllHdrs = hdrs; // Ausgangsmenge für „In den Treffern suchen“
      newTab._nbsTitle = title;
      win.setTimeout(() => {
        try {
          newTab.chromeBrowser.contentWindow.threadPaneHeader.updateMessageCount(hdrs.length);
        } catch (e) {
          dbg("count (neuer Tab) failed", String(e));
        }
      }, 800);
      return hdrs.length;
    };

    // ---- Gemeinsame Ordner (virtuelle Ordner über alle Konten) -----------------------------
    // Reine Ansichten auf dem Rechner: auf dem IMAP-Server wird nichts verschoben oder angelegt.
    const simpleTerm = (session, attrib, op, setValue) => {
      const term = session.createTerm();
      term.attrib = attrib;
      term.op = op;
      term.booleanAnd = true;
      const value = term.value;
      value.attrib = attrib;
      setValue(value);
      term.value = value;
      return term;
    };

    const sharedTerms = (kind, tagKey, months) => {
      const session = newSession();
      const A = Ci.nsMsgSearchAttrib;
      const O = Ci.nsMsgSearchOp;
      if (kind === "unread") {
        return [simpleTerm(session, A.MsgStatus, O.Isnt, v => { v.status = Ci.nsMsgMessageFlags.Read; })];
      }
      if (kind === "followup") {
        // Wiedervorlage = Nachricht mit dem Schlagwort „Wiedervorlage“ (IMAP-Schlagwort, auf allen Geräten gleich)
        return [simpleTerm(session, A.Keywords, O.Contains, v => { v.str = tagKey; })];
      }
      if (months > 0) {
        // nur die letzten N Monate (relativ: „Alter in Tagen“ wird bei jeder Anzeige neu ausgewertet)
        return [simpleTerm(session, A.AgeInDays, O.IsLessThan, v => { v.age = months * 30; })];
      }
      // alle Nachrichten: Datum nach 1970
      return [simpleTerm(session, A.Date, O.IsAfter, v => { v.date = 1000; })];
    };

    const allInboxes = () => {
      const result = [];
      for (const server of MailServices.accounts.allServers) {
        if (server.hostName === "smart mailboxes") {
          continue;
        }
        const inbox = server.rootFolder.getFolderWithFlags(Ci.nsMsgFolderFlags.Inbox);
        if (inbox) {
          result.push(inbox);
        }
      }
      return result;
    };

    // Legt die Ordner an oder aktualisiert sie. specs: [{ name, kind: "inbox" | "unread" | "followup" }]
    const ensureSharedFolders = specs => {
      sharedRowNames = specs.map(spec => spec.name);
      const localRoot = MailServices.accounts.localFoldersServer.rootFolder;
      const done = [];
      for (const { name, kind, tagKey, months } of specs) {
        try {
          const existing = localRoot.subFolders.find(f => f.name === name);
          if (existing && !existing.getFlag(Ci.nsMsgFolderFlags.Virtual)) {
            dbg("shared: Ordner existiert, aber nicht virtuell:", name);
            continue; // nicht anfassen
          }
          const terms = sharedTerms(kind, tagKey, months);
          // Posteingänge: feste Liste (wird bei jedem Start erneuert); sonst vorerst ebenfalls die Posteingänge
          // und danach „*“ = alle Ordner aller Konten (ohne Papierkorb, Spam, Postausgang), von Betterbird dynamisch ausgewertet.
          const scope = allInboxes();
          let folder = existing;
          if (!folder) {
            folder = VirtualFolderHelper.createNewVirtualFolder(name, localRoot, scope, terms, false).virtualFolder;
          } else {
            const wrapper = VirtualFolderHelper.wrapVirtualFolder(folder);
            for (const f of new Set([...wrapper.searchFolders, ...scope])) {
              try {
                f.msgDatabase?.invalidateCache(folder.URI);
              } catch (e) {
                // Datenbank nicht verfügbar
              }
            }
            folder.clearFlag(Ci.nsMsgFolderFlags.CacheValid);
            wrapper.searchTerms = terms;
            wrapper.searchFolders = scope;
            wrapper.onlineSearch = false;
          }
          const wrapper = VirtualFolderHelper.wrapVirtualFolder(folder);
          if (kind !== "inbox") {
            // „*“ = alle Ordner aller Konten. Der Setter des Wrappers nimmt nur Ordner-Listen; die Eigenschaft
            // wird deshalb direkt in der Ordner-Datenbank gesetzt (so legt Betterbird sie selbst ab).
            folder.msgDatabase.dBFolderInfo.setCharProperty("searchFolderUri", "*");
            Services.obs.notifyObservers(folder, "search-folders-changed");
          }
          wrapper.cleanUpMessageDatabase();
          folder.setFlag(Ci.nsMsgFolderFlags.Favorite);
          done.push(name);
        } catch (e) {
          dbg("shared folder failed:", name, String(e), e.stack || "");
        }
      }
      MailServices.accounts.saveVirtualFolders();
      for (const tab of allMainTabs()) {
        addSharedRows(tab.chromeBrowser.contentWindow);
      }
      dbg("shared folders:", done);
      return done.length;
    };

    // Schlagwort „Wiedervorlage“ anlegen, falls es fehlt; gibt den Schlüssel zurück.
    const ensureFollowupTag = (name, color) => {
      let key = MailServices.tags.getKeyForTag(name);
      if (!key) {
        MailServices.tags.addTag(name, color, "");
        key = MailServices.tags.getKeyForTag(name);
      }
      return key;
    };

    const removeSharedFolders = names => {
      const localRoot = MailServices.accounts.localFoldersServer.rootFolder;
      let removed = 0;
      for (const name of names) {
        const folder = localRoot.subFolders.find(f => f.name === name);
        if (folder && folder.getFlag(Ci.nsMsgFolderFlags.Virtual)) {
          for (const tab of allMainTabs()) {
            try {
              for (const mode of Object.values(tab.chromeBrowser.contentWindow.folderPane._modes)) {
                for (const li of [...(mode.containerList?.querySelectorAll("li") ?? [])]) {
                  if (li.uri === folder.URI) {
                    li.remove();
                  }
                }
              }
            } catch (e) {
              // Zeile war nicht vorhanden
            }
          }
          localRoot.propagateDelete(folder, true);
          removed++;
        }
      }
      MailServices.accounts.saveVirtualFolders();
      return removed;
    };

    // ---- Virtueller Suchordner ----------------------------------------------

    const inFlaggedFolder = (folder, flag) => {
      for (let f = folder; f && !f.isServer; f = f.parent) {
        if (f.getFlag(flag)) {
          return true;
        }
      }
      return false;
    };

    // Ordner, die durchsucht werden.
    const searchFoldersFor = (criteriaState, currentFolderId) => {
      if (criteriaState.scope === "folder" && currentFolderId) {
        const { folder } = getFolder(currentFolderId);
        return [folder, ...folder.descendants];
      }
      const F = Ci.nsMsgFolderFlags;
      // Gilt auch für Unterordner (z. B. Papierkorb/Infizierte Objekte).
      const inFlagged = (folder, flag) => {
        for (let f = folder; f && !f.isServer; f = f.parent) {
          if (f.getFlag(flag)) {
            return true;
          }
        }
        return false;
      };
      const result = [];
      for (const server of MailServices.accounts.allServers) {
        for (const folder of [server.rootFolder, ...server.rootFolder.descendants]) {
          if (
            folder.isServer ||
            folder.getFlag(F.Virtual) ||
            folder.getFlag(F.Queue) ||
            (!criteriaState.trash && inFlagged(folder, F.Trash)) ||
            (!criteriaState.spam && inFlagged(folder, F.Junk))
          ) {
            continue;
          }
          result.push(folder);
        }
      }
      return result;
    };

    const newSession = () =>
      Cc["@mozilla.org/messenger/searchSession;1"].createInstance(Ci.nsIMsgSearchSession);

    // Suchbegriffe als nsIMsgSearchTerm-Objekte (robuster als ein Suchstring).
    const buildTerms = (criteria, opts, session = newSession()) => {
      const terms = [];
      const make = (attrib, op, setValue, group) => {
        const term = session.createTerm();
        term.attrib = attrib;
        term.op = op;
        term.booleanAnd = !group || group === "first";
        const value = term.value;
        value.attrib = attrib;
        setValue(value);
        term.value = value;
        if (group === "first") {
          term.beginsGrouping = true;
        }
        terms.push(term);
        return term;
      };
      const A = Ci.nsMsgSearchAttrib;
      const O = Ci.nsMsgSearchOp;
      const str = text => value => { value.str = text; };

      const textTerm = (attrib, text, group) => make(attrib, O.Contains, str(text), group);

      if (criteria.author) textTerm(A.Sender, criteria.author);
      if (criteria.recipients) textTerm(A.ToOrCC, criteria.recipients);
      if (criteria.subject) textTerm(A.Subject, criteria.subject);
      if (criteria.body) textTerm(A.Body, criteria.body);

      if (criteria.freeText) {
        const attribs = [];
        if (opts.from) attribs.push(A.Sender);
        if (opts.to) attribs.push(A.ToOrCC);
        if (opts.subject) attribs.push(A.Subject);
        if (opts.body) attribs.push(A.Body);
        if (!attribs.length) {
          // Kein Feld angehakt: es soll nichts gefunden werden (ein Betreff, der nie so lautet)
          make(A.Subject, O.Is, str("\u0001__kein-feld-ausgewaehlt__"));
        } else if (attribs.length === 1) {
          textTerm(attribs[0], criteria.freeText);
        } else {
          // (Absender ODER Betreff ODER …) als eine Gruppe, UND-verknüpft mit dem Rest
          attribs.forEach((attrib, i) => {
            const t = textTerm(attrib, criteria.freeText, i === 0 ? "first" : "or");
            if (i === attribs.length - 1) {
              t.endsGrouping = true;
            }
          });
        }
      }

      if (criteria.attachment === true || (criteria.attachment === undefined && opts.attachment)) {
        make(A.HasAttachmentStatus, O.Is, v => { v.status = Ci.nsMsgMessageFlags.Attachment; });
      }
      const unread = criteria.unread ?? (opts.unread ? true : undefined);
      if (unread === true) make(A.MsgStatus, O.Isnt, v => { v.status = Ci.nsMsgMessageFlags.Read; });
      if (unread === false) make(A.MsgStatus, O.Is, v => { v.status = Ci.nsMsgMessageFlags.Read; });
      if (criteria.flagged === true) make(A.MsgStatus, O.Is, v => { v.status = Ci.nsMsgMessageFlags.Marked; });

      // Datum in Mikrosekunden (PRTime)
      // „Nach“ vergleicht tagesgenau und schließt den Tag selbst aus: eine Millisekunde vor Tagesbeginn ansetzen,
      // sonst findet „Heute“ (ab 0:00 Uhr) nichts.
      if (criteria.fromDate) {
        const dayStart = new Date(criteria.fromDate).setHours(0, 0, 0, 0);
        make(A.Date, O.IsAfter, v => { v.date = (dayStart - 1) * 1000; });
      }
      if (criteria.toDate) make(A.Date, O.IsBefore, v => { v.date = (criteria.toDate + 864e5) * 1000; });

      return terms;
    };

    // Hat der Nutzer den Suchordner gerade offen, muss die Ansicht die neuen Suchbegriffe neu einlesen.
    // DBViewWrapper.open() liest bei einem bereits angezeigten virtuellen Ordner dessen Konfiguration neu.
    const reopenDisplayed = folder => {
      for (const win of Services.wm.getEnumerator("mail:3pane")) {
        for (const tab of win.document.getElementById("tabmail")?.tabInfo ?? []) {
          const cw = tab.chromeBrowser?.contentWindow;
          try {
            if (cw?.gFolder?.URI === folder.URI) {
              if (cw.gViewWrapper?.isSynthetic) {
                // Volltext-Ansicht aktiv: ausgewählten Ordner (den Suchordner) neu öffnen.
                leaveSyntheticView(cw);
              } else {
                cw.gViewWrapper.open(folder);
              }
              // Diagnose: wie viele Zeilen hat die Ansicht nach dem Neuladen?
              win.setTimeout(() => {
                try {
                  dbg("view rows:", cw.gDBView?.rowCount, "total:", folder.getTotalMessages(false),
                    "header:", cw.document.getElementById("threadPaneFolderCount")?.textContent);
                } catch (e) {
                  dbg("view check failed", String(e));
                }
              }, 2000);
            }
          } catch (e) {
            console.error("NovaBird-Search: Ansicht konnte nicht aktualisiert werden", e);
          }
        }
      }
    };

    return {
      searchBar: {
        // Selbsttest der Betterbird-Interna (siehe SELF_TEST); Ergebnis zeigt die Optionsseite
        async selfTest() {
          return nb.nbRunSelfTest?.(SELF_TEST) ?? null;
        },
        async setStrings(newStrings) {
          strings = { ...DEFAULT_STRINGS, ...newStrings };
          refreshAll();
          refreshLabels();
        },
        async highlight(barId, word) {
          const b = barOf(barId);
          if (!b) {
            return;
          }
          b.root._nbsHighlight = word || "";
          // Der Nachrichtentext lädt erst kurz nach dem Anzeigen: zweimal anwenden.
          b.win.setTimeout(() => applyHighlight(barId), 250);
          b.win.setTimeout(() => applyHighlight(barId), 900);
        },
        // Eindeutige Kennung der Leiste → Tab-ID der WebExtension-API (für mailTabs.*)
        async tabIdOf(barId) {
          const b = barOf(barId);
          if (!b) {
            return null;
          }
          try {
            return context.extension.tabManager.getWrapper(b.tab).id;
          } catch (e) {
            dbg("tabIdOf failed", String(e));
            return null;
          }
        },
        async restoreFolderView(barId) {
          // Aus der Treffer-Ansicht (synthetisch) dieser Leiste zurück zur normalen Ordneransicht des gewählten Ordners.
          const b = barOf(barId);
          if (!b) {
            return;
          }
          try {
            if (b.cw?.gViewWrapper?.isSynthetic && !b.tab._nbsSnapshot) {
              leaveSyntheticView(b.cw);
            }
          } catch (e) {
            dbg("restoreFolderView failed", String(e));
          }
        },
        async ensureSharedFolders(specs) {
          return ensureSharedFolders(specs);
        },
        async log(message) {
          dbg("bg:", message);
        },
        async ensureFollowupTag(name, color) {
          return ensureFollowupTag(name, color);
        },
        async removeSharedFolders(names) {
          return removeSharedFolders(names);
        },
        async openFacetSearch(barId, text, limit) {
          return openFacetSearch(barOf(barId), text, limit);
        },
        async openResultsInNewTab(barId, title) {
          return openResultsInNewTab(barOf(barId), title || SEARCH_FOLDER_NAME);
        },
        async setGroupMode(barId, on) {
          // Konversationsansicht: Datum der neuesten Nachricht und Hervorhebung nur während einer Suche (nur diese Leiste)
          const b = barOf(barId);
          if (!b?.cw || b.tab._nbsSnapshot) {
            return;
          }
          b.cw._nbsGroup = Boolean(on);
          try {
            b.cw.threadTree?.invalidate();
          } catch (e) {
            dbg("invalidate failed", String(e));
          }
        },
        async setBusy(barId, on) {
          setBusy(barId, Boolean(on));
        },
        async glodaSearch(barId, criteria, criteriaState, currentFolderId) {
          const bar = barOf(barId);
          if (!bar) {
            return -2;
          }
          const run = (bar.root._nbsRun = (bar.root._nbsRun || 0) + 1);
          const opts = normalizeState(criteriaState);
          const folders = searchFoldersFor(opts, currentFolderId);
          const t0 = Date.now();
          const [headerHits, glodaHits] = await Promise.all([
            searchHeaders(criteria, opts, folders).catch(e => { dbg("header search failed", String(e)); return []; }),
            searchGloda(criteria, opts, Number(criteriaState?.limit) || GLODA_LIMIT).catch(e => { dbg("gloda failed", String(e)); return []; }),
          ]);
          if (run !== bar.root._nbsRun) {
            return -1; // überholt
          }
          // Vereinigung, ohne Doppelte; Gloda-Treffer nach den Optionen filtern
          const F = Ci.nsMsgFolderFlags;
          const current = currentFolderId ? getFolder(currentFolderId).folder : null;
          const unread = criteria.unread ?? (opts.unread ? true : undefined);
          const wantAttachment = criteria.attachment ?? (opts.attachment ? true : undefined);
          const keep = hdr => {
            const folder = hdr.folder;
            if (!folder || folder.getFlag(F.Virtual)) return false;
            if (!opts.trash && inFlaggedFolder(folder, F.Trash)) return false;
            if (!opts.spam && inFlaggedFolder(folder, F.Junk)) return false;
            if (current && folder !== current && !current.isAncestorOf(folder)) return false;
            if (unread === true && hdr.isRead) return false;
            if (unread === false && !hdr.isRead) return false;
            if (wantAttachment === true && !(hdr.flags & Ci.nsMsgMessageFlags.Attachment)) return false;
            if (wantAttachment === false && hdr.flags & Ci.nsMsgMessageFlags.Attachment) return false;
            if (criteria.flagged === true && !hdr.isFlagged) return false;
            const has = (value, needle) => (value || "").toLowerCase().includes(needle.toLowerCase());
            if (criteria.author && !has(hdr.mime2DecodedAuthor || hdr.author, criteria.author)) return false;
            if (criteria.recipients && !has(hdr.mime2DecodedRecipients || hdr.recipients, criteria.recipients)) return false;
            if (criteria.subject && !has(hdr.mime2DecodedSubject || hdr.subject, criteria.subject)) return false;
            const ms = hdr.date / 1000;
            if (criteria.fromDate && ms < criteria.fromDate) return false;
            if (criteria.toDate && ms >= criteria.toDate + 864e5) return false;
            return true;
          };
          const merged = new Map();
          for (const hdr of [...headerHits, ...glodaHits.filter(keep)]) {
            merged.set(`${hdr.folder.URI}#${hdr.messageKey}`, hdr);
          }
          const hdrs = [...merged.values()].sort((a, b) => b.date - a.date);
          dbg("gloda", { header: headerHits.length, gloda: glodaHits.length, merged: hdrs.length, ms: Date.now() - t0 });
          const byFolder = {};
          for (const hdr of hdrs) {
            byFolder[hdr.folder.name] = (byFolder[hdr.folder.name] || 0) + 1;
          }
          dbg("gloda by folder", byFolder);
          const shown = showHeaders(bar, hdrs, SEARCH_FOLDER_NAME, criteriaState?.group === true);
          return shown ? hdrs.length : -2;
        },
        async idSearch(barId, rows, criteria, criteriaState, keepOrder) {
          const bar = barOf(barId);
          if (!bar) {
            return -2;
          }
          const run = (bar.root._nbsRun = (bar.root._nbsRun || 0) + 1);
          const opts = normalizeState(criteriaState);
          const { hdrs, lost, unknownIds } = resolveRows(rows, opts, criteria);
          if (run !== bar.root._nbsRun) {
            return -1; // überholt
          }
          if (!keepOrder) hdrs.sort((a, b) => b.date - a.date);
          dbg("id search", { rows: rows.length, shown: hdrs.length });
          Services.console.logStringMessage(`NovaBird-Search: NovaBird-DB lieferte ${rows.length} Treffer, angezeigt ${hdrs.length} (Ordner unbekannt ${lost.unknownFolder}, Papierkorb/Spam ${lost.trashSpam}, Kopfzeile fehlt ${lost.noHeader}, durch Filter ${lost.filtered})` + (unknownIds.size ? `; unbekannte Ordner: ${[...unknownIds].slice(0, 5).join(" | ")}` : ""));
          const shown = showHeaders(bar, hdrs, SEARCH_FOLDER_NAME, criteriaState?.group === true, Boolean(keepOrder), criteriaState?.scope === "folder");
          return shown ? hdrs.length : -2;
        },
        // „In den Treffern suchen“ im Treffer-Tab: zeigt nur die Treffer der Ausgangsmenge, die auch zu den NovaBird-DB-Zeilen passen.
        // Ohne rows: einfacher Textvergleich (Betreff, Absender, Empfänger); ohne Text: alle Ausgangstreffer.
        async refineSnapshot(barId, rows, text) {
          const bar = barOf(barId);
          const win = bar?.win;
          const tab = bar?.tab;
          const cw = bar?.cw;
          if (!tab?._nbsSnapshot || !tab._nbsAllHdrs || !cw?.restoreState) {
            return -1;
          }
          let list = tab._nbsAllHdrs;
          const needle = (text || "").trim().toLowerCase();
          if (Array.isArray(rows)) {
            const keep = new Set(
              resolveRows(rows, { ...DEFAULT_STATE, trash: true, spam: true }, {}).hdrs.map(h => `${h.folder.URI}#${h.messageKey}`)
            );
            list = list.filter(h => keep.has(`${h.folder.URI}#${h.messageKey}`));
          } else if (needle) {
            const has = (v, n) => (v || "").toLowerCase().includes(n);
            list = list.filter(h =>
              needle.split(/\s+/).every(
                w => has(h.mime2DecodedSubject || h.subject, w) || has(h.mime2DecodedAuthor || h.author, w) || has(h.mime2DecodedRecipients || h.recipients, w)
              )
            );
          }
          cw.restoreState({ syntheticView: makeView(list), folderPaneVisible: false, title: tab._nbsTitle });
          const setCount = () => {
            try { cw.threadPaneHeader.updateMessageCount(list.length); } catch (e) { dbg("count (refine) failed", String(e)); }
          };
          setCount();
          win.setTimeout(setCount, 400);
          return list.length;
        },
        // Treffer für die Analyseseite: einfache Objekte (Betreff, Absender, Datum, Ordner, Flags). Empfänger folgen
        // später blockweise (recipientsChunk), die Nachrichten-ID erst beim Anzeigen (spart bei vielen Treffern die meiste Zeit).
        async describeHits(rows, criteriaState, token) {
          const t0 = Date.now();
          const opts = normalizeState(criteriaState);
          const { hdrs } = resolveRows(rows, opts, {});
          hdrs.sort((a, b) => b.date - a.date);
          const t1 = Date.now();
          const out = hdrs.map(hdr => ({
            hid: hdr.messageId,
            subject: hdr.mime2DecodedSubject || hdr.subject || "",
            author: hdr.mime2DecodedAuthor || hdr.author || "",
            date: Math.round(hdr.date / 1e6), // Sekunden (hdr.date: Mikrosekunden)
            folder: hdr.folder.name,
            folderUri: hdr.folder.URI,
            account: hdr.folder.server?.prettyName || "",
            read: Boolean(hdr.isRead),
            flagged: Boolean(hdr.isFlagged),
            att: Boolean(hdr.flags & Ci.nsMsgMessageFlags.Attachment),
          }));
          if (token != null) {
            analysisHdrs.set(token, { hdrs, ms: 0 });
            for (const old of [...analysisHdrs.keys()].slice(0, -3)) analysisHdrs.delete(old); // nur die letzten drei behalten
          }
          Services.console.logStringMessage(`NovaBird-Search: Analyse – ${rows.length} Zeilen, ${hdrs.length} Kopfzeilen in ${t1 - t0} ms, Beschreibung ${Date.now() - t1} ms`);
          return out;
        },
        // Empfänger (An und Kopie) der Analyse-Treffer, blockweise: [[Adressen], [Namen]] je Treffer
        async recipientsChunk(token, from, count) {
          const entry = analysisHdrs.get(token);
          if (!entry) return [];
          const t0 = Date.now();
          const out = [];
          for (const hdr of entry.hdrs.slice(from, from + count)) {
            const toE = [];
            const toN = [];
            try {
              for (const raw of [hdr.mime2DecodedRecipients || hdr.recipients, hdr.ccList]) {
                if (!raw) continue;
                for (const a of MailServices.headerParser.parseDecodedHeader(raw)) {
                  const e = (a.email || "").toLowerCase();
                  if (e && !toE.includes(e)) {
                    toE.push(e);
                    toN.push(a.name || e);
                  }
                }
              }
            } catch (e) {
              dbg("recipients", String(e));
            }
            out.push([toE, toN]);
          }
          entry.ms += Date.now() - t0;
          if (from + count >= entry.hdrs.length) {
            Services.console.logStringMessage(`NovaBird-Search: Analyse – Empfänger von ${entry.hdrs.length} Treffern in ${entry.ms} ms`);
            analysisHdrs.delete(token); // fertig: die Kopfzeilen nicht länger festhalten
          }
          return out;
        },
        // Teilmenge der Analyse (headerMessageId + Ordner-URI) als Liste in neuem Tab öffnen.
        async openHitsInTab(barId, items, title) {
          const hdrs = [];
          for (const it of items) {
            try {
              const folder = MailServices.folderLookup.getFolderForURL(it.folderUri);
              const hdr = folder?.msgDatabase.getMsgHdrForMessageID(it.hid);
              if (hdr) hdrs.push(hdr);
            } catch (e) {
              dbg("openHits: Kopfzeile fehlt", it.hid, String(e));
            }
          }
          hdrs.sort((a, b) => b.date - a.date);
          return openSnapshotTab(barOf(barId), hdrs, title);
        },
        // Eigene Adressen aller Konten (für „Mich“ in der Analyse)
        async myAddresses() {
          const result = [];
          const seen = new Set();
          for (const identity of MailServices.accounts.allIdentities) {
            const email = (identity.email || "").toLowerCase();
            if (!email || seen.has(email)) continue;
            seen.add(email);
            const server = MailServices.accounts.getServersForIdentity(identity)[0];
            result.push({ email, account: server?.prettyName || "" });
          }
          return result;
        },
        // Öffnet eine Seite der Erweiterung in einem neuen Tab. (Über tabs.create fehlte der Seite im Labortest die Erweiterungs-API.)
        async openPage(barId, url) {
          const tabmail = barOf(barId)?.tabmail;
          if (!tabmail || !String(url).startsWith("moz-extension://")) {
            return false;
          }
          tabmail.openTab("contentTab", { url, background: false });
          // Adresszeile (moz-extension://…) des Tabs ausblenden: die Seite ist eine Programmansicht
          const box = tabmail.currentTabInfo?.panel?.querySelector(".contentTabToolbox");
          if (box) {
            box.style.display = "none";
          }
          return true;
        },
        // Farben des Themes (wie die Suchleiste) für die Analyseseite
        async themeVars() {
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          const doc = win?.document.getElementById("tabmail")?.tabInfo[0]?.chromeBrowser?.contentDocument;
          const result = {};
          if (!doc) return result;
          const cs = doc.defaultView.getComputedStyle(doc.documentElement);
          for (const name of ["--layout-background-0", "--layout-background-1", "--layout-color-1", "--layout-border-0", "--selected-item-color", "--selected-item-text-color", "--button-hover-background-color", "--search-bar-background", "--search-bar-color", "--search-bar-border-color"]) {
            const v = cs.getPropertyValue(name).trim();
            if (v) result[name] = v;
          }
          return result;
        },
        // Rückfrage unter dem Suchfeld: Filtern oder Auswerten (optional merken). Ergebnis: { choice, remember } oder null (abgebrochen).
        async askEnter(barId) {
          const bar = barOf(barId);
          const doc = bar?.tab.chromeBrowser?.contentDocument;
          const root = bar?.root;
          if (!root) return null;
          root.querySelector(".nbs-ask")?.remove();
          root._hideHistory?.();
          for (const m of root.querySelectorAll(".nbs-menu:not(.nbs-ask)")) m.hidden = true;
          return new Promise(resolve => {
            const mk = (tag, cls, text) => {
              const e = doc.createElementNS(HTML_NS, tag);
              if (cls) e.className = cls;
              if (text) e.textContent = text;
              return e;
            };
            const box = mk("div", "nbs-menu nbs-ask");
            const check = mk("input");
            check.type = "checkbox";
            const done = value => {
              doc.removeEventListener("click", onDoc, true);
              doc.removeEventListener("keydown", onKey, true);
              box.remove();
              resolve(value);
            };
            const choose = choice => done({ choice, remember: check.checked });
            const btnFilter = mk("button", "nbs-ask-btn nbs-ask-primary", strings.askFilter);
            const btnAnalyze = mk("button", "nbs-ask-btn", strings.askAnalyze);
            btnFilter.type = btnAnalyze.type = "button";
            btnFilter.addEventListener("click", () => choose("snapshot"));
            btnAnalyze.addEventListener("click", () => choose("analysis"));
            const btns = mk("div", "nbs-ask-btns");
            btns.append(btnFilter, btnAnalyze);
            const rem = mk("label", "nbs-ask-rem");
            rem.append(check, mk("span", "", strings.askRemember));
            box.append(mk("div", "nbs-ask-title", strings.askTitle), btns, rem);
            const onDoc = e => { if (!box.contains(e.target)) done(null); };
            const onKey = e => {
              if (e.key === "Escape") done(null);
            };
            doc.addEventListener("click", onDoc, true);
            doc.addEventListener("keydown", onKey, true);
            root.append(box);
            btnFilter.focus();
          });
        },
        async setHistory(items) {
          history = Array.isArray(items) ? items.filter(Boolean) : [];
          for (const root of roots()) {
            root._renderHistory?.();
            if (!history.length) root._hideHistory?.();
          }
        },
        async setNote(barId, text, tooltip, kind) {
          for (const root of [barOf(barId)?.root].filter(Boolean)) {
            const n = root.querySelector(".nbs-note");
            if (!n) continue;
            if (text) {
              n.textContent = text;
              n.title = tooltip || "";
              n.classList.toggle("nbs-info", kind === "info"); // info: dezent (kein Alarm-Rot)
              n.hidden = false;
            } else {
              n.hidden = true;
            }
          }
        },
        async setSuggestion(barId, text) {
          for (const root of [barOf(barId)?.root].filter(Boolean)) {
            const b = root.querySelector(".nbs-suggest");
            if (!b) continue;
            if (text) {
              b.dataset.text = text;
              // „Meinten Sie: <Vorschlag>?“ – der Vorschlag hervorgehoben
              const [before, after = ""] = strings.suggest.split("{text}");
              const word = doc0(b).createElement("span");
              word.className = "nbs-sug-word";
              word.textContent = text;
              const line = doc0(b).createElement("span");
              line.append(before, word, after);
              b.replaceChildren(line); // ein Textfluss: kein Abstand vor dem Fragezeichen
              b.hidden = false;
            } else {
              delete b.dataset.text;
              b.hidden = true;
            }
          }
        },
        async clearText(barId) {
          const root = barOf(barId)?.root;
          if (!root) {
            return;
          }
          root._nbsState = { ...DEFAULT_STATE }; // Ende der Suche: alle Filter/Optionen dieser Leiste zurück auf Standard
          root.querySelector("input").value = "";
          root.removeAttribute("data-has-text");
          refresh(root);
        },
        async createSearchFolder(_barId, criteria, criteriaState, currentFolderId) {
          const opts = normalizeState(criteriaState);
          const localRoot = MailServices.accounts.localFoldersServer.rootFolder;
          const terms = buildTerms(criteria, opts);
          const searchFolders = searchFoldersFor(opts, currentFolderId);

          // Vorhandenen Suchordner wiederverwenden (Löschen würde die Ansicht leeren).
          const existing = localRoot.subFolders.find(f => f.name === SEARCH_FOLDER_NAME);
          dbg("query", { criteria, opts, folders: searchFolders.length, terms: terms.length, existing: Boolean(existing) });
          if (existing) {
            const wrapper = VirtualFolderHelper.wrapVirtualFolder(existing);
            // Wie das Eigenschaften-Fenster eines Suchordners: den Ergebnis-Zwischenspeicher aller beteiligten
            // Ordner verwerfen, sonst zeigt die Ansicht weiter die alten Treffer.
            for (const folder of new Set([...wrapper.searchFolders, ...searchFolders])) {
              try {
                folder.msgDatabase?.invalidateCache(existing.URI);
              } catch (e) {
                dbg("invalidateCache failed", folder.URI, String(e));
              }
            }
            existing.clearFlag(Ci.nsMsgFolderFlags.CacheValid);
            wrapper.searchTerms = terms;
            wrapper.searchFolders = searchFolders;
            wrapper.onlineSearch = false;
            wrapper.cleanUpMessageDatabase();
            dbg("searchString after set:", wrapper.searchString);
            try {
              // Diagnose: wie liest Betterbird den gespeicherten String wieder ein?
              const parsed = wrapper.searchTermsSession.searchTerms;
              dbg("parsed terms:", parsed.map(t => ({
                attrib: t.attrib, op: t.op, and: t.booleanAnd, begin: t.beginsGrouping, end: t.endsGrouping,
                str: t.value.str, status: t.value.status,
              })));
            } catch (e) {
              dbg("parse check failed", String(e));
            }
            MailServices.accounts.saveVirtualFolders();
            reopenDisplayed(existing);
            return context.extension.folderManager.convert(existing).id;
          }
          const wrapper = VirtualFolderHelper.createNewVirtualFolder(
            SEARCH_FOLDER_NAME,
            localRoot,
            searchFolders,
            terms,
            false
          );
          return context.extension.folderManager.convert(wrapper.virtualFolder).id;
        },
        onQuery: makeEvent(context, emitter, "onQuery", "query"),
        onStateChanged: makeEvent(context, emitter, "onStateChanged", "stateChanged"),
        onEnter: makeEvent(context, emitter, "onEnter", "enter"),
        onHistoryAdd: makeEvent(context, emitter, "onHistoryAdd", "historyAdd"),
        onHistoryRemove: makeEvent(context, emitter, "onHistoryRemove", "historyRemove"),
        onHistoryClear: makeEvent(context, emitter, "onHistoryClear", "historyClear"),
        onOpenSettings: makeEvent(context, emitter, "onOpenSettings", "openSettings"),
      },
    };
  }
};

function makeEvent(context, emitter, name, emitName) {
  return new ExtensionCommon.EventManager({
    context,
    name: `searchBar.${name}`,
    register(fire) {
      const listener = (event, ...args) => fire.async(...args);
      emitter.on(emitName, listener);
      return () => emitter.off(emitName, listener);
    },
  }).api();
}
