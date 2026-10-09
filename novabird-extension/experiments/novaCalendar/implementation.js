/* Nova-Calendar – Experiment (privilegiert, nur Betterbird / Thunderbird ESR).
 *  1. Hauptfenster: rechter Bereich einheitlich in Mail, Kalender und Aufgaben: Termine (Tagesplan) und Aufgaben
 *     gemeinsam (Mail/Kalender: Termine oben, Aufgaben: Aufgaben oben), in Mail zusätzlich der Anhänge-Bereich.
 *  2. Termin-Dialoge und Unterdialoge: Systemgrau durch die Theme-Farben ersetzen.
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);

const LISTENER_NAME = "novabird-extension-windows";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const EVENT_DIALOG_URL = "chrome://calendar/content/calendar-event-dialog.xhtml";
const DIALOG_URLS = [
  EVENT_DIALOG_URL,
  "chrome://calendar/content/calendar-event-dialog-recurrence.xhtml",
  "chrome://calendar/content/calendar-event-dialog-reminder.xhtml",
  "chrome://calendar/content/calendar-event-dialog-attendees.xhtml",
  "chrome://calendar/content/calendar-event-dialog-timezone.xhtml",
  "chrome://calendar/content/calendar-summary-dialog.xhtml",
  "chrome://calendar/content/calendar-properties-dialog.xhtml",
];
const STYLE_ID = "novabird-extension-style";

// Texte in Deutsch, Englisch, Französisch, Spanisch (Sprache der Betterbird-Oberfläche, sonst Englisch)
function kpText(de, en, fr, es) {
  const lang = (Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
  return ({ de, en, fr, es })[lang] ?? en;
}
const HTML_NS = "http://www.w3.org/1999/xhtml";
const MIN_PANE_WIDTH = 340;
const WANTED_PANE_WIDTH = 400;

const MAIN_CSS = `
#today-pane-panel #agenda-panel, #today-pane-panel #todo-tab-panel { flex: 1 1 0; min-block-size: 110px; }
#today-pane-panel #calendar-task-tree-detail { flex: 1 1 0; min-block-size: 80px; }
/* die Terminliste unter der Kalenderansicht ersetzt der Tagesplan rechts */
#bottom-events-box, #calendar-view-splitter { display: none !important; }
/* Überschrift des Aufgabenteils, optisch wie "Heute" im Terminteil */
#nbx-todo-header {
  padding: 6px; font-weight: bold; background-color: var(--button-background-color); flex: none;
}
/* weiche Trennung zwischen Terminen und Aufgaben (verschiebbar), harte Trennung vor den Anhängen */
#today-pane-panel #today-pane-splitter {
  min-block-size: 7px; background: transparent !important;
  border-block-start: 1px dashed var(--sidebar-border-color, ThreeDShadow);
}
`;

// Farben aus dem laufenden Theme lesen (erste vorhandene Variable gewinnt)
function pick(cs, names) {
  for (const name of names) {
    const value = cs.getPropertyValue(name).trim();
    if (value) {
      return value;
    }
  }
  return "";
}

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function themeColors(dialogWin) {
  const win = Services.wm.getMostRecentWindow("mail:3pane") || dialogWin;
  const cs = win.getComputedStyle(win.document.documentElement);
  const themed = win.document.documentElement.hasAttribute("lwtheme");
  const themeAccent =
    pick(cs, ["--toolbarbutton-icon-fill-attention", "--lwt-tab-line-color", "--selected-item-color"]) ||
    "#2F6BD8";
  if (customColors) {
    const c = customColors;
    return { bg: c.bg, fg: c.fg, border: c.border, accent: c.accent || themeAccent };
  }
  if (!themed) {
    return null; // kein Theme aktiv: Systemfarben lassen
  }
  const bg = pick(cs, ["--toolbar-bgcolor", "--toolbar-background-color", "--sidebar-background-color"]);
  const fg = pick(cs, ["--toolbar-color", "--toolbar-text-color", "--sidebar-text-color"]);
  const border = pick(cs, ["--sidebar-border-color", "--toolbar-bottom-separator-color"]);
  return bg && fg ? { bg, fg, border, accent: themeAccent } : null;
}

function dialogCss(colors) {
  const { bg, fg } = colors;
  const accent = colors.accent || "#2F6BD8";
  const border = colors.border || `color-mix(in srgb, ${fg} 22%, ${bg})`;
  return `
/* Grundpalette der Oberfläche (Buttons, Auswahllisten, Felder) aus dem Theme ableiten */
:root:root {
  --layout-background-0: color-mix(in srgb, ${bg} 35%, white);
  --layout-background-1: ${bg};
  --layout-background-2: color-mix(in srgb, ${fg} 6%, ${bg});
  --layout-background-3: color-mix(in srgb, ${fg} 11%, ${bg});
  --layout-background-4: color-mix(in srgb, ${fg} 17%, ${bg});
  --layout-color-0: ${fg};
  --layout-color-1: ${fg};
  --layout-color-2: color-mix(in srgb, ${fg} 75%, ${bg});
  --layout-border-0: ${border};
  --layout-border-1: color-mix(in srgb, ${fg} 22%, ${bg});
  --button-background-color: color-mix(in srgb, ${fg} 8%, ${bg});
  --button-hover-background-color: color-mix(in srgb, ${fg} 14%, ${bg});
  --button-border-radius: 8px;
}
:root:root,
html#calendar-event-dialog-inner:root,
html#calendar-task-dialog-inner:root,
#calendar-event-dialog,
#calendar-task-dialog,
#calendar-event-summary-dialog {
  background: ${colors.bg} !important;
  color: ${colors.fg} !important;
}
/* Reiter (Beschreibung / Anhänge / Teilnehmer): Auswahl und Mausüberfahren in Akzentfarbe */
:root:root tab:hover {
  background-color: color-mix(in srgb, ${accent} 12%, transparent) !important;
}
:root:root tab[selected] {
  background-color: color-mix(in srgb, ${accent} 16%, ${bg}) !important;
  border-block-end-color: ${accent} !important;
}
/* Menüs und Auswahllisten in den Dialogen */
:root:root menupopup:not([type="arrow"]) {
  --panel-background-color: ${colors.bg};
  --panel-text-color: ${colors.fg};
  --panel-border-color: ${colors.border || "transparent"};
  --panel-border-radius: 10px;
  --panel-padding: 5px;
  --menuitem-border-radius: 6px;
}
:root:root menupopup > :is(menuitem, menu)[_moz-menuactive]:not([disabled]) {
  background-color: color-mix(in srgb, ${accent} 16%, ${colors.bg});
  color: ${colors.fg};
}
`;
}

function addStyle(doc, css) {
  let style = doc.getElementById(STYLE_ID);
  if (!style) {
    style = doc.createElementNS(HTML_NS, "style");
    style.id = STYLE_ID;
    (doc.head || doc.documentElement).appendChild(style);
  }
  if (style.textContent !== css) {
    style.textContent = css;
  }
}

function removeStyle(doc) {
  doc?.getElementById(STYLE_ID)?.remove();
}

// ---- Hauptfenster ----------------------------------------------------------------------------

let customColors = null; // { bg, fg, border, accent } aus den Einstellungen, sonst Theme-Farben

const PANEL_MODES = ["mail", "calendar", "task"];

// Termine (agenda-panel) und Aufgaben (todo-tab-panel) in Mail, Kalender und Aufgaben anzeigen
function enablePanels(doc) {
  for (const id of ["agenda-panel", "todo-tab-panel"]) {
    const el = doc.getElementById(id);
    if (!el) {
      continue;
    }
    const modes = (el.getAttribute("mode") || "").split(",").filter(Boolean);
    for (const m of PANEL_MODES) {
      if (!modes.includes(m)) {
        modes.push(m);
      }
    }
    el.setAttribute("mode", modes.join(","));
    const collapsed = (el.getAttribute("collapsedinmodes") || "").split(",").filter(m => m && !PANEL_MODES.includes(m));
    el.setAttribute("collapsedinmodes", collapsed.join(",") || ",");
  }
}

// Reihenfolge je Modus: Aufgaben-Tab = Aufgaben oben, sonst Termine oben
function placePanels(win) {
  const doc = win.document;
  const agenda = doc.getElementById("agenda-panel");
  const todo = doc.getElementById("todo-tab-panel");
  const splitter = doc.getElementById("today-pane-splitter");
  const holder = agenda?.parentNode;
  if (!agenda || !todo || !splitter || todo.parentNode !== holder) {
    return;
  }
  const first = win.gCurrentMode === "task" ? todo : agenda;
  const second = first === todo ? agenda : todo;
  if (holder.firstElementChild !== first) {
    holder.insertBefore(first, holder.firstElementChild);
  }
  holder.insertBefore(splitter, first.nextSibling);
  if (splitter.nextSibling !== second) {
    holder.insertBefore(second, splitter.nextSibling);
  }
}

function refreshPane(win) {
  try {
    placePanels(win);
    for (const id of ["agenda-panel", "todo-tab-panel"]) {
      const el = win.document.getElementById(id);
      if (el?.setVisible && el.isVisibleInMode?.(win.gCurrentMode)) {
        el.setVisible(true, false, true);
      }
    }
    win.TodayPane?.updateDisplay?.();
    win.TodayPane?.updateSplitterState?.();
    // Aufgabenliste erst nach dem Einblenden füllen (sonst bleibt sie in Mail/Aufgaben leer)
    win.setTimeout(() => {
      try {
        const tree = win.document.getElementById("unifinder-todo-tree");
        win.TodayPane?.updateCalendarToDoUnifinder?.(tree?.getAttribute("filterValue") || "throughcurrent");
        if (tree?.view && tree.view.rowCount === 0) {
          tree.refresh?.();
        }
      } catch (e) {
        console.error("NovaBird-Extension: Aufgabenliste", e);
      }
    }, 250);
    renderAttach(win).catch(e => console.error("NovaBird-Extension:", e));
  } catch (e) {
    console.error("NovaBird-Extension: Leiste", e);
  }
}

const paneObservers = new WeakMap();

function ensureTodoHeader(doc) {
  const todo = doc.getElementById("todo-tab-panel");
  if (!todo || doc.getElementById("nbx-todo-header")) {
    return;
  }
  const header = doc.createElementNS(HTML_NS, "div");
  header.id = "nbx-todo-header";
  header.textContent = kpText("Aufgaben", "Tasks", "Tâches", "Tareas");
  todo.insertBefore(header, todo.firstElementChild);
}

let paneLayout = "nova"; // "nova" = Termine/Aufgaben-Leiste dieser Erweiterung, "default" = Betterbird-Standard
const originalPanels = new WeakMap(); // Fenster -> { id: { mode, collapsedinmodes } } vor unserem Eingriff

function applyNovaPane(win) {
  const doc = win.document;
  if (!originalPanels.has(win)) {
    const saved = {};
    for (const id of ["agenda-panel", "todo-tab-panel"]) {
      const el = doc.getElementById(id);
      saved[id] = el ? { mode: el.getAttribute("mode"), collapsedinmodes: el.getAttribute("collapsedinmodes") } : null;
    }
    originalPanels.set(win, saved);
  }
  addStyle(doc, MAIN_CSS);
  enablePanels(doc);
  ensureTodoHeader(doc);
  refreshPane(win);

  // Beim Wechsel von Mail / Kalender / Aufgaben sofort umbauen (Reihenfolge, Anhänge)
  const pane = doc.getElementById("today-pane-panel");
  if (pane && !paneObservers.has(win)) {
    const obs = new win.MutationObserver(() => refreshPane(win));
    obs.observe(pane, { attributes: true, attributeFilter: ["current"] });
    const tabmail = doc.getElementById("tabmail");
    const onTab = () => win.setTimeout(() => renderAttach(win).catch(e => console.error("NovaBird-Extension:", e)), 0);
    tabmail?.addEventListener("TabSelect", onTab);
    paneObservers.set(win, { obs, tabmail, onTab });
  }

  // Rechter Bereich in Mail, Kalender und Aufgaben breit genug
  if (pane?.getModeAttribute) {
    for (const mode of PANEL_MODES) {
      const width = Number(pane.getModeAttribute("modewidths", mode));
      if (!(width >= MIN_PANE_WIDTH)) {
        pane.setModeAttribute("modewidths", String(WANTED_PANE_WIDTH), mode);
        if (win.gCurrentMode === mode) {
          pane.style.width = `${WANTED_PANE_WIDTH}px`;
        }
      }
    }
  }
}

// Betterbird-Standard wiederherstellen (Ausgangswerte der beiden Bereiche, Reihenfolge, Überschrift, Stil)
function removeNovaPane(win) {
  const doc = win.document;
  const o = paneObservers.get(win);
  if (o) {
    o.obs.disconnect();
    o.tabmail?.removeEventListener("TabSelect", o.onTab);
    paneObservers.delete(win);
  }
  doc.getElementById("nbx-todo-header")?.remove();
  removeStyle(doc);
  const saved = originalPanels.get(win);
  if (saved) {
    for (const [id, v] of Object.entries(saved)) {
      const el = doc.getElementById(id);
      if (!el || !v) {
        continue;
      }
      for (const [attr, value] of [["mode", v.mode], ["collapsedinmodes", v.collapsedinmodes]]) {
        if (value == null) {
          el.removeAttribute(attr);
        } else {
          el.setAttribute(attr, value);
        }
      }
    }
    originalPanels.delete(win);
  }
  const agenda = doc.getElementById("agenda-panel");
  const todo = doc.getElementById("todo-tab-panel");
  const splitter = doc.getElementById("today-pane-splitter");
  if (agenda && todo && splitter && agenda.parentNode === todo.parentNode) {
    const holder = agenda.parentNode;
    holder.insertBefore(agenda, holder.firstElementChild);
    holder.insertBefore(splitter, agenda.nextSibling);
    holder.insertBefore(todo, splitter.nextSibling);
  }
  for (const el of [agenda, todo]) {
    if (el?.setVisible && el.isVisibleInMode?.(win.gCurrentMode)) {
      el.setVisible(true, false, true);
    }
  }
  win.TodayPane?.updateDisplay?.();
  win.TodayPane?.updateSplitterState?.();
  renderAttach(win).catch(e => console.error("NovaBird-Extension:", e));
}

function applyPaneLayout(win) {
  if (paneLayout === "default") {
    removeNovaPane(win);
  } else {
    applyNovaPane(win);
  }
}

function arrangeMain(win) {
  setupAttach(win);
  applyPaneLayout(win);
}

function restoreMain(win) {
  teardownAttach(win);
  removeNovaPane(win);
}


// ---- Anhänge-Bereich unter dem Tagesplan ------------------------------------------------------

const ATTACH_BOX_ID = "nbx-attach-box";
const ATTACH_SPLITTER_ID = "nbx-attach-splitter";
const ATTACH_STYLE_ID = "nbx-attach-style";
const ATTACH_HEIGHT_PREF = "extensions.novabird-extension.attachHeight";
const ATTACH_SCOPE_PREF = "extensions.novabird-extension.attachScope";
const attachState = new WeakMap(); // Fenster -> { timer, sig }
let attachEnabled = true;

const ATTACH_CSS = `
#${ATTACH_SPLITTER_ID} { min-block-size: 7px; border-block-start: 1px solid var(--sidebar-border-color, ThreeDShadow); }
#${ATTACH_BOX_ID} { min-block-size: 70px; background: var(--sidebar-background-color); color: var(--sidebar-text-color); }
#${ATTACH_BOX_ID} .sa-head { display: flex; align-items: center; gap: 8px; padding: 8px 12px 6px; font-weight: 600; }
#${ATTACH_BOX_ID} .sa-head > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${ATTACH_BOX_ID} .sa-scope { display: flex; flex: none; border-radius: 99px; padding: 2px; background: color-mix(in srgb, currentColor 9%, transparent); }
#${ATTACH_BOX_ID} .sa-scope button { flex: none; min-width: 0; margin: 0; border: 0; border-radius: 99px; background: transparent; color: inherit; font-size: 12px; font-weight: 500; padding: 2px 10px; cursor: pointer; }
#${ATTACH_BOX_ID} .sa-scope button[aria-pressed="true"] { background: var(--sidebar-background-color); box-shadow: 0 1px 2px color-mix(in srgb, currentColor 25%, transparent); font-weight: 600; }
#${ATTACH_BOX_ID} .sa-list { flex: 1; overflow-y: auto; padding: 0 6px 8px; min-height: 0; }
#${ATTACH_BOX_ID} .sa-row { display: flex; align-items: center; gap: 8px; padding: 5px 8px; border-radius: 8px; cursor: pointer; }
#${ATTACH_BOX_ID} .sa-row:hover { background: color-mix(in srgb, currentColor 9%, transparent); }
#${ATTACH_BOX_ID} .sa-row.sa-current { background: color-mix(in srgb, var(--lwt-toolbarbutton-icon-fill-attention, #2F6BD8) 14%, transparent); }
#${ATTACH_BOX_ID} .sa-ico { flex: none; width: 30px; padding: 2px 0; border-radius: 5px; color: #fff; font-size: 9.5px; font-weight: 700; letter-spacing: .03em; text-align: center; line-height: 1.2; }
#${ATTACH_BOX_ID} .sa-text { flex: 1; min-width: 0; display: flex; flex-direction: column; }
#${ATTACH_BOX_ID} .sa-name, #${ATTACH_BOX_ID} .sa-meta { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#${ATTACH_BOX_ID} .sa-meta { opacity: .6; font-size: 11.5px; }
#${ATTACH_BOX_ID} .sa-size { opacity: .6; font-size: 12px; white-space: nowrap; }
#${ATTACH_BOX_ID} .sa-empty { opacity: .55; padding: 6px 12px; }
`;

const ATTACH_TEXT = () => ({
  title: kpText("Anhänge", "Attachments", "Pièces jointes", "Adjuntos"),
  none: kpText("Keine Anhänge", "No attachments", "Aucune pièce jointe", "Sin adjuntos"),
  loading: kpText("Anhänge werden gesucht …", "Looking for attachments …", "Recherche des pièces jointes …", "Buscando adjuntos …"),
  mail: kpText("Mail", "Mail", "Message", "Correo"),
  thread: kpText("Unterhaltung", "Conversation", "Conversation", "Conversación"),
  goTo: kpText("Zur Nachricht springen", "Go to message", "Aller au message", "Ir al mensaje"),
});

const HAS_ATTACHMENT_FLAG = 0x10000000; // nsMsgMessageFlags.Attachment
const IGNORED_TYPES = /^application\/(pgp-signature|pkcs7-signature|x-pkcs7-signature|pgp-keys)$/i;
const attachCache = new Map(); // folderURI|messageKey -> Promise<[{name, size, contentType}]>

function hdrKey(hdr) {
  return `${hdr.folder?.URI}|${hdr.messageKey}`;
}

const ATTACH_CACHE_MAX = 300; // nur Name/Größe/Typ je Mail im Arbeitsspeicher, keine Dateien

// IMAP/News-Mails ohne lokale Kopie würden beim Untersuchen vollständig nachgeladen
function isLocal(hdr) {
  try {
    const type = hdr.folder?.server?.type;
    return !/^(imap|nntp)$/.test(type) || hdr.folder.hasMsgOffline(hdr.messageKey);
  } catch (e) {
    return true;
  }
}

function hdrAttachments(hdr) {
  const key = hdrKey(hdr);
  if (!attachCache.has(key)) {
    if (attachCache.size >= ATTACH_CACHE_MAX) {
      attachCache.delete(attachCache.keys().next().value); // älteste Einträge zuerst
    }
    attachCache.set(
      key,
      new Promise(resolve => {
        try {
          const { MsgHdrToMimeMessage } = ChromeUtils.importESModule("resource:///modules/gloda/MimeMessage.sys.mjs");
          MsgHdrToMimeMessage(hdr, null, (_hdr, mime) => {
            let found = mime?.allUserAttachments || [];
            if (!found.length) {
              // z. B. als "inline" markierte Dokumente: alle benannten Teile außer Textkörpern nehmen
              found = (mime?.allAttachments || []).filter(a => !/^text\/(plain|html)$/i.test(a.contentType || ""));
            }
            const list = found
              .filter(a => a.name && !IGNORED_TYPES.test(a.contentType || ""))
              .map(a => ({ name: a.name, size: a.size, contentType: a.contentType, url: a.url }));
            resolve(list);
          }, true);
        } catch (e) {
          console.error("NovaBird-Extension: Anhänge lesen", e);
          resolve([]);
        }
      })
    );
  }
  return attachCache.get(key);
}

function currentHdr(win) {
  const st = attachState.get(win);
  const found = findCurrentHdr(win);
  if (found) {
    st.lastHdr = found;
    return found;
  }
  // z. B. Konversations-Tab (Add-on): letzte gewählte Nachricht weiterverwenden
  try {
    return st.lastHdr && st.lastHdr.folder ? st.lastHdr : null;
  } catch (e) {
    return null;
  }
}

function findCurrentHdr(win) {
  const tabmail = win.document.getElementById("tabmail");
  try {
    const view = tabmail.currentAbout3Pane?.gDBView;
    if (view && view.numSelected > 0) {
      const hdr = view.hdrForFirstSelectedMessage;
      if (hdr) {
        return hdr;
      }
    }
  } catch (e) {}
  return tabmail.currentAboutMessage?.gMessage || null;
}

function threadHdrs(hdr) {
  try {
    const thread = hdr.folder.msgDatabase.getThreadContainingMsgHdr(hdr);
    const out = [];
    for (let i = 0; i < thread.numChildren; i++) {
      out.push(thread.getChildHdrAt(i));
    }
    return out.length ? out : [hdr];
  } catch (e) {
    return [hdr];
  }
}

// Unterhaltung = Thread aus der Ordnerdatenbank plus (falls vorhanden) die Gloda-Konversation, die auch Ordner übergreift
async function conversationHdrs(win, hdr) {
  const out = new Map();
  const add = h => {
    if (h && h.folder) {
      out.set(hdrKey(h), h);
    }
  };
  add(hdr);
  threadHdrs(hdr).forEach(add);
  try {
    const { Gloda } = ChromeUtils.importESModule("resource:///modules/gloda/GlodaPublic.sys.mjs");
    const noop = () => {};
    const query = fn => new Promise(resolve => {
      const timer = win.setTimeout(() => resolve(null), 3000);
      fn({ onItemsAdded: noop, onItemsModified: noop, onItemsRemoved: noop, onQueryCompleted: c => { win.clearTimeout(timer); resolve(c); } });
    });
    const first = await query(l => Gloda.getMessageCollectionForHeader(hdr, l));
    const conversation = first?.items?.[0]?.conversation;
    if (conversation) {
      const all = await query(l => conversation.getMessagesCollection(l));
      (all?.items || []).forEach(m => add(m.folderMessage));
    }
  } catch (e) {
    // Gloda aus oder nicht indiziert: DB-Thread genügt
  }
  return [...out.values()];
}

function attachScope() {
  try {
    return Services.prefs.getCharPref(ATTACH_SCOPE_PREF, "thread") === "mail" ? "mail" : "thread";
  } catch (e) {
    return "thread";
  }
}

function fmtDate(win, hdr) {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(hdr.date / 1000));
  } catch (e) {
    return "";
  }
}

function senderName(hdr) {
  const raw = hdr.mime2DecodedAuthor || hdr.author || "";
  return raw.replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "") || raw;
}

const FILE_TYPES = [
  [/\.pdf$|pdf$/i, "PDF", "#D93025"],
  [/\.(docx?|odt|rtf)$|word|opendocument\.text/i, "DOC", "#2B6CD8"],
  [/\.(xlsx?|ods|csv)$|excel|spreadsheet/i, "XLS", "#1E8E3E"],
  [/\.(pptx?|odp)$|powerpoint|presentation/i, "PPT", "#E8710A"],
  [/\.(zip|rar|7z|tar|gz|tgz)$|zip|compressed/i, "ZIP", "#8A6D3B"],
  [/\.(png|jpe?g|gif|bmp|webp|svg|heic|tiff?)$|^image\//i, "IMG", "#7B4FC4"],
  [/\.(mp3|wav|ogg|m4a|flac)$|^audio\//i, "AUD", "#C2185B"],
  [/\.(mp4|mov|avi|mkv|webm)$|^video\//i, "VID", "#00838F"],
  [/\.(txt|md|log)$|^text\/plain/i, "TXT", "#6B7686"],
  [/\.(ics|vcf)$|calendar|vcard/i, "ICS", "#2F6BD8"],
  [/\.(eml|msg)$|message\/rfc822/i, "EML", "#6B7686"],
];

function fileBadge(doc, a) {
  const hit = FILE_TYPES.find(([re]) => re.test(a.name) || re.test(a.contentType || ""));
  const ext = (a.name.match(/\.([^.]{1,4})$/) || [])[1];
  const badge = doc.createElementNS(HTML_NS, "span");
  badge.className = "sa-ico";
  badge.textContent = hit ? hit[1] : (ext || "•").toUpperCase();
  badge.style.background = hit ? hit[2] : "#6B7686";
  return badge;
}

async function renderAttach(win) {
  const doc = win.document;
  const box = doc.getElementById(ATTACH_BOX_ID);
  if (!box) {
    return;
  }
  const splitter = doc.getElementById(ATTACH_SPLITTER_ID);
  const st = attachState.get(win);
  const mailMode = win.gCurrentMode === "mail" || win.gCurrentMode === undefined;
  const show = attachEnabled && mailMode;
  box.hidden = splitter.hidden = !show;
  if (!show) {
    return;
  }
  if (doc.hidden) {
    return; // Fenster minimiert/verdeckt: nichts tun
  }
  const hdr = currentHdr(win);
  const scope = attachScope();
  // Thread-Größe (teuer bei langen Threads) nur bei neuer Auswahl oder alle 10 Takte neu bestimmen
  const base = hdr ? `${hdrKey(hdr)}|${scope}` : "none";
  st.ticks = (st.ticks || 0) + 1;
  if (!hdr || scope !== "thread") {
    st.count = 1;
  } else if (st.base !== base || st.ticks % 10 === 0 || st.sig === null) {
    st.count = threadHdrs(hdr).length;
  }
  st.base = base;
  const sig = hdr ? `${base}|${st.count}` : "none";
  if (st.sig === sig) {
    return;
  }
  st.sig = sig;
  const token = (st.token = (st.token || 0) + 1);

  const t = ATTACH_TEXT();
  const h = (name, props = {}, ...kids) => {
    const e = doc.createElementNS(HTML_NS, name);
    Object.assign(e, props);
    e.append(...kids);
    return e;
  };
  const scopeBtn = (value, label) => {
    const b = h("button", { type: "button", textContent: label });
    b.setAttribute("aria-pressed", String(scope === value));
    b.addEventListener("click", () => {
      try { Services.prefs.setCharPref(ATTACH_SCOPE_PREF, value); } catch (e) {}
      st.sig = null;
      renderAttach(win);
    });
    return b;
  };
  const frame = (titleText, ...body) => {
    const head = h("div", { className: "sa-head" }, h("span", { textContent: titleText }), h("div", { className: "sa-scope" }, scopeBtn("mail", t.mail), scopeBtn("thread", t.thread)));
    box.replaceChildren(head, h("div", { className: "sa-list" }, ...body));
  };

  if (!hdr) {
    frame(t.title, h("div", { className: "sa-empty", textContent: t.none }));
    return;
  }
  frame(t.title, h("div", { className: "sa-empty", textContent: t.loading }));

  const members = scope === "thread" ? await conversationHdrs(win, hdr) : [hdr];
  if (st.token !== token) {
    return;
  }
  // Das Anhang-Merkmal fehlt bei manchen Mails: bei kleinen Mengen alle prüfen, nur große Unterhaltungen vorfiltern
  // Ohne Merkmal nur untersuchen, wenn die Mail lokal vorliegt (kein Nachladen per IMAP); die gewählte Mail immer
  const msgs = members.filter(m => hdrKey(m) === hdrKey(hdr) || m.flags & HAS_ATTACHMENT_FLAG || (members.length <= 12 && isLocal(m)));
  msgs.sort((a, b) => b.date - a.date); // neueste zuerst
  const found = [];
  for (const m of msgs) {
    const list = await hdrAttachments(m);
    if (st.token !== token) {
      return; // inzwischen andere Nachricht gewählt
    }
    for (const a of list) {
      found.push({ a, m });
    }
  }
  const about3 = doc.getElementById("tabmail").currentAbout3Pane;
  const rows = found.map(({ a, m }) => {
    const size = a.size == null || a.size < 0 ? "" : win.messenger?.formatFileSize?.(a.size) ?? "";
    const row = h("div", { className: "sa-row", title: `${a.name}\n${t.goTo}` },
      fileBadge(doc, a),
      h("div", { className: "sa-text" },
        h("div", { className: "sa-name", textContent: a.name }),
        h("div", { className: "sa-meta", textContent: `${senderName(m)} · ${fmtDate(win, m)}${scope === "thread" ? ` · ${m.mime2DecodedSubject || ""}` : ""}` })),
      h("span", { className: "sa-size", textContent: size }));
    // Daten für die Anhang-Vorschau (Experiment attachPreview)
    if (a.url) {
      row.dataset.pvUrl = a.url;
      row.dataset.pvName = a.name;
      row.dataset.pvType = a.contentType || "";
    }
    if (hdrKey(m) === hdrKey(hdr)) {
      row.classList.add("sa-current");
    }
    row.addEventListener("click", () => {
      try { about3?.selectMessage?.(m); } catch (e) { console.error(e); }
    });
    return row;
  });
  frame(`${t.title}${found.length ? ` (${found.length})` : ""}`, ...(rows.length ? rows : [h("div", { className: "sa-empty", textContent: t.none })]));
}

function setupAttach(win) {
  const doc = win.document;
  const panel = doc.getElementById("today-pane-panel");
  if (!panel || doc.getElementById(ATTACH_BOX_ID)) {
    return;
  }
  const style = doc.createElementNS(HTML_NS, "style");
  style.id = ATTACH_STYLE_ID;
  style.textContent = ATTACH_CSS;
  (doc.head || doc.documentElement).appendChild(style);

  const splitter = doc.createXULElement("splitter");
  splitter.id = ATTACH_SPLITTER_ID;
  splitter.setAttribute("orient", "vertical");
  splitter.setAttribute("resizebefore", "closest");
  splitter.setAttribute("resizeafter", "closest");
  const box = doc.createXULElement("vbox");
  box.id = ATTACH_BOX_ID;
  let height = 220;
  try { height = Services.prefs.getIntPref(ATTACH_HEIGHT_PREF, 220); } catch (e) {}
  // gespeicherte Höhe nur übernehmen, wenn sie sinnvoll ist (sonst Standard)
  const paneHeight = panel.getBoundingClientRect().height;
  if (!(height >= 90 && height <= 900) || (paneHeight > 0 && height > paneHeight - 120)) {
    height = 220;
  }
  box.style.height = `${height}px`;
  panel.append(splitter, box);
  splitter.addEventListener("mouseup", () => {
    const h = Math.round(box.getBoundingClientRect().height);
    if (h >= 90 && h <= 900) {
      try { Services.prefs.setIntPref(ATTACH_HEIGHT_PREF, h); } catch (e) {}
    }
  });

  console.log("NovaBird-Extension: Anhänge-Bereich angelegt");
  const st = { sig: null, timer: win.setInterval(() => renderAttach(win).catch(e => console.error("NovaBird-Extension:", e)), 1000) };
  attachState.set(win, st);
  renderAttach(win);
}

function teardownAttach(win) {
  const doc = win.document;
  const st = attachState.get(win);
  if (st) {
    win.clearInterval(st.timer);
    attachState.delete(win);
  }
  doc.getElementById(ATTACH_BOX_ID)?.remove();
  doc.getElementById(ATTACH_SPLITTER_ID)?.remove();
  doc.getElementById(ATTACH_STYLE_ID)?.remove();
}

// ---- Dialoge ---------------------------------------------------------------------------------

function styleDialog(win) {
  const colors = themeColors(win);
  if (!colors) {
    return; // kein Theme mit Farben: Systemfarben lassen
  }
  console.log("Nova-Calendar: Dialogfarben", JSON.stringify(colors));
  const css = dialogCss(colors);
  addStyle(win.document, css);

  // Der Termin-Dialog fügt seinen Inhalt als Iframe mit eigenem Dokument erst nach dem Laden ein:
  // mehrfach versuchen (Einfügen, load-Ereignis, Zeitpunkte danach); addStyle ist wiederholbar.
  const applyInner = () => {
    const inner = win.document.getElementById("calendar-item-panel-iframe")?.contentDocument;
    if (inner?.documentElement && inner.location.href !== "about:blank") {
      addStyle(inner, css);
      return true;
    }
    return false;
  };
  win.addEventListener(
    "load",
    event => {
      if (event.target?.id === "calendar-item-panel-iframe") {
        applyInner();
      }
    },
    true
  );
  const observer = new win.MutationObserver(() => {
    if (applyInner()) {
      observer.disconnect(); // einmal gefärbt: weitere Änderungen im Dialog nicht mehr beobachten (spart Last)
    }
  });
  observer.observe(win.document.documentElement, { childList: true, subtree: true });
  for (const delay of [0, 250, 700, 1500, 3500]) {
    win.setTimeout(applyInner, delay);
  }
}

function unstyleDialog(win) {
  removeStyle(win.document);
  removeStyle(win.document.getElementById("calendar-item-panel-iframe")?.contentDocument);
}

var novaCalendar = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    ExtensionSupport.unregisterWindowListener(LISTENER_NAME);
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      restoreMain(win);
    }
    for (const win of Services.wm.getEnumerator(null)) {
      if (DIALOG_URLS.includes(win.location.href)) {
        unstyleDialog(win);
      }
    }
  }

  getAPI() {
    return {
      novaCalendar: {
        async setColors(colors) {
          const valid =
            colors &&
            ["bg", "fg", "border", "accent"].every(key => HEX_COLOR.test(colors[key] || ""));
          customColors = valid ? { ...colors } : null;
        },
        async getStatus() {
          const lines = [];
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            const d = win.document;
            const box = d.getElementById(ATTACH_BOX_ID);
            const splitter = d.getElementById(ATTACH_SPLITTER_ID);
            const panel = d.getElementById("today-pane-panel");
            const rect = e => (e ? `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}` : "-");
            lines.push(
              `Fenster: Modus=${win.gCurrentMode}, Readystate=${d.readyState}`,
              `Tagesplan: vorhanden=${!!panel}, Größe=${rect(panel)}, display=${panel ? win.getComputedStyle(panel).display : "-"}`,
              `Anhänge-Bereich: vorhanden=${!!box}, hidden=${box?.hidden}, Größe=${rect(box)}, display=${box ? win.getComputedStyle(box).display : "-"}, Elternelement=${box?.parentNode?.id}`,
              `Teiler: vorhanden=${!!splitter}, hidden=${splitter?.hidden}, Größe=${rect(splitter)}`,
              `Termine/Aufgaben: Reihenfolge=${["agenda-panel", "todo-tab-panel"].map(i => `${i}:${d.getElementById(i)?.collapsed ? "zu" : "offen"}`).join(", ")}`,
              `Anhänge aktiviert=${attachEnabled}, Wert gespeichert=${Services.prefs.getIntPref(ATTACH_HEIGHT_PREF, -1)}`,
              `Kinder von Tagesplan: ${panel ? [...panel.children].map(c => `${c.localName}#${c.id}${c.hidden ? "(hidden)" : ""}`).join(", ") : "-"}`
            );
          }
          const clash = ["kalender-pilot@local", "settings-redesign@local", "stream-pilot@local", "stream-extension@local"]
            .filter(id => WebExtensionPolicy.getByID(id)?.active);
          lines.push(`Alte Add-ons aktiv: ${clash.length ? clash.join(", ") + "  <-- bitte entfernen" : "keine"}`);
          return lines.join("\n") || "kein Hauptfenster";
        },
        async resetAttachHeight() {
          try { Services.prefs.clearUserPref(ATTACH_HEIGHT_PREF); } catch (e) {}
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            const box = win.document.getElementById(ATTACH_BOX_ID);
            if (box) {
              box.style.height = "220px";
            }
          }
        },
        async setAttachPane(on) {
          attachEnabled = !!on;
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            const st = attachState.get(win);
            if (st) {
              st.sig = null;
              renderAttach(win);
            }
          }
        },
        async setAgendaDays(days) {
          const n = Math.round(Number(days));
          Services.prefs.setIntPref("calendar.agenda.days", n >= 1 && n <= 28 ? n : 5);
        },
        async setPaneLayout(value) {
          paneLayout = value === "default" ? "default" : "nova";
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            applyPaneLayout(win);
          }
        },
        async setOrder() {
          // Reihenfolge ist fest (Aufgaben-Tab: Aufgaben oben, sonst Termine oben)
        },
        async start() {
          ExtensionSupport.registerWindowListener(LISTENER_NAME, {
            chromeURLs: [MAIN_URL, ...DIALOG_URLS],
            onLoadWindow(win) {
              try {
                if (win.location.href === MAIN_URL) {
                  arrangeMain(win);
                } else {
                  styleDialog(win);
                }
              } catch (e) {
                console.error("Nova-Calendar:", e);
              }
            },
          });
        },
      },
    };
  }
};
