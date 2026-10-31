"use strict";

var settingsRedesign = (() => {
/* Settings Redesign – experiment API (parent process).
 *
 *  - One shared navigation on about:preferences and about:accountsettings
 *    (identical position, font and colours, so switching pages hardly shows).
 *  - "Konten" sits at the bottom of that navigation and opens about:accountsettings.
 *  - MsgAccountManager() (every caller) reuses a single tab.
 *  - Edit menu / app menu "Account Settings" entries are hidden.
 *  - Cards/typography for the preference panes and the account sub pages.
 */

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);

const LISTENER_ID = "novabird-extension-settings";
const MAIN = "chrome://messenger/content/messenger.xhtml";
const WINDOWS = [
  MAIN,
  "chrome://messenger/content/messageWindow.xhtml",
  "chrome://messenger/content/messengercompose/messengercompose.xhtml",
];
const XHTML = "http://www.w3.org/1999/xhtml";
const HIDE_CSS = "#menu_accountmgr, #appmenu_accountmgr { display: none !important; }";
const ICON = "chrome://messenger/skin/icons/new/touch/";
const COMPACT = "chrome://messenger/skin/icons/new/compact/";

const LANG = (Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
const tr = (de, en, fr, es) => ({ de, en, fr, es })[LANG] ?? en;
const T = {
  search: tr("Einstellungen durchsuchen…", "Search settings…", "Rechercher dans les paramètres…", "Buscar en la configuración…"),
  daily: tr("Täglich", "Everyday", "Quotidien", "Diario"),
  more: tr("Sicherheit & mehr", "Security & more", "Sécurité et plus", "Seguridad y más"),
  accounts: tr("Konten", "Accounts", "Comptes", "Cuentas"),
  addons: tr("Add-ons & Themes", "Add-ons & Themes", "Modules et thèmes", "Complementos y temas"),
};

let CSS = { shell: "", prefs: "", account: "", frame: "", compose: "", addons: "" };
let hubIcon = ""; // moz-extension-Adresse des NovaBird-Symbols (aus getAPI)
let pendingSearch = null;
const perWindow = new Map();
let customColors = null; // { bg, fg, border, accent } aus den Einstellungen, sonst Theme-Farben

function pick(cs, names) {
  for (const n of names) {
    const v = cs.getPropertyValue(n).trim();
    if (v) {
      return v;
    }
  }
  return "";
}

// Gemeinsame Farbrechnung (shared/color.js, im Paket); geladen in getAPI, vor jedem Fensteraufbau
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
function isDark(color) {
  return nb.nbIsDark ? nb.nbIsDark(color) : false;
}

/** NovaBird-Palette: Farben des laufenden Themes (oder eigene) als --tbsr-* Variablen. */
function tokenCss() {
  const win = mainWindow();
  let bg, fg, border, accent, side;
  if (customColors) {
    ({ bg, fg, border, accent } = customColors);
    side = `color-mix(in srgb, ${fg} 5%, ${bg})`;
  } else if (win && win.document.documentElement.hasAttribute("lwtheme")) {
    const cs = win.getComputedStyle(win.document.documentElement);
    bg = pick(cs, ["--toolbar-bgcolor", "--toolbar-background-color", "--sidebar-background-color"]);
    fg = pick(cs, ["--toolbar-color", "--toolbar-text-color", "--sidebar-text-color"]);
    border = pick(cs, ["--sidebar-border-color", "--toolbar-bottom-separator-color"]);
    side = pick(cs, ["--sidebar-background-color"]) || bg;
    accent = pick(cs, ["--toolbarbutton-icon-fill-attention", "--lwt-tab-line-color", "--selected-item-color"]) || "#2F6BD8";
  }
  if (!bg || !fg) {
    return "";
  }
  border = border || `color-mix(in srgb, ${fg} 18%, ${bg})`;
  const dark = isDark(bg);
  const panel = dark ? `color-mix(in srgb, ${bg} 92%, white)` : `color-mix(in srgb, ${bg} 35%, white)`;
  return `:root:root:root {
  --tbsr-bg: ${bg}; --tbsr-panel: ${panel}; --tbsr-side: ${side};
  --tbsr-text: ${fg}; --tbsr-muted: color-mix(in srgb, ${fg} 62%, ${bg}); --tbsr-line: ${border};
  --tbsr-accent: ${accent}; --tbsr-accent-bg: color-mix(in srgb, ${accent} ${dark ? 24 : 15}%, ${panel});
  --tbsr-accent-text: ${dark ? `color-mix(in srgb, ${accent} 70%, white)` : `color-mix(in srgb, ${accent} 78%, black)`};
  --tbsr-hover: color-mix(in srgb, ${fg} 8%, transparent); --tbsr-switch-off: color-mix(in srgb, ${fg} 30%, ${bg});
}`;
}

function shellCss() {
  return CSS.shell + "\n" + tokenCss() + "\n" + fontVarsCss();
}

function calendarOn() {
  try {
    const { calendarDeactivator } = ChromeUtils.importESModule(
      "resource:///modules/calendar/calCalendarDeactivator.sys.mjs"
    );
    return !!calendarDeactivator.isCalendarActivated;
  } catch (e) {
    return true;
  }
}

/** Navigation entries; mirrors the categories about:preferences really shows. */
function navItems() {
  const items = [
    { group: T.daily },
    { pane: "paneGeneral", label: tr("Allgemein", "General", "Général", "General"), icon: ICON + "settings.svg" },
    { pane: "paneAppearance", label: tr("Erscheinungsbild", "Appearance", "Apparence", "Apariencia"), icon: ICON + "paint-palette.svg" },
    { pane: "paneCompose", label: tr("Verfassen", "Composition", "Rédaction", "Redacción"), icon: ICON + "pencil.svg" },
  ];
  if (calendarOn()) {
    items.push({ pane: "paneCalendar", label: tr("Kalender", "Calendar", "Agenda", "Calendario"), icon: ICON + "calendar.svg" });
  }
  items.push(
    { group: T.more },
    { pane: "panePrivacy", label: tr("Datenschutz & Sicherheit", "Privacy & Security", "Vie privée et sécurité", "Privacidad y seguridad"), icon: ICON + "lock.svg" }
  );
  if (Services.prefs.getBoolPref("mail.chat.enabled", true)) {
    items.push({ pane: "paneChat", label: "Chat", icon: ICON + "chat.svg" });
  }
  if (Services.prefs.getBoolPref("mail.qrexport.enabled", true)) {
    items.push({
      pane: "paneQrExport",
      label: tr("Auf Mobilgerät exportieren", "Export to mobile", "Exporter vers un mobile", "Exportar al móvil"),
      icon: "chrome://messenger/skin/icons/lg/mobile-export.svg",
    });
  }
  items.push({ pane: "paneNovaBird", label: "NovaBird", icon: hubIcon || COMPACT + "settings.svg" });
  items.push(
    { separator: true },
    { accounts: true, label: T.accounts, icon: COMPACT + "account-settings.svg" },
    { addons: true, label: T.addons, icon: COMPACT + "extension.svg" }
  );
  return items;
}


// Icons for the section tree, matched against the section's l10n id / element id.
const SUB_ICONS = [
  [/accent-color/, "paint-brush"], [/window-layout/, "layout"], [/message-list|styling/, "display-options"],
  [/spelling/, "spelling"], [/html-style/, "template"], [/send-format/, "sent"], [/addressing/, "address-book"],
  [/passwords/, "key"], [/spam|junk/, "spam"], [/collection/, "fingerprint"], [/e2ee/, "lock"],
  [/doh/, "globe-secure"], [/scam|anti-virus|certificates|security/, "shield"], [/mail-content/, "mail-secure"],
  [/web-content/, "link"], [/chat-status/, "user"], [/chat-notifications|new-message-arrival/, "unread"],
  [/language|font/, "font"], [/incoming/, "get-mail"], [/attachment|files/, "attachment"], [/tags/, "tag"],
  [/reading/, "eye"], [/folder/, "folder"], [/network|diskspace|networking|offline/, "online"],
  [/search-engine/, "search"], [/system-integration|systemDefaults/, "tools"], [/scrolling/, "nav-down"],
  [/general-legend|startPage/, "inbox"], [/datetime/, "clock"], [/indexing/, "search"],
];

function subIcon(key) {
  const hit = SUB_ICONS.find(([re]) => re.test(key));
  return COMPACT + (hit ? hit[1] : "settings") + ".svg";
}

/**
 * Sections of a loaded pane for the tree: the legend groups before the first
 * sub heading, then every further sub heading.
 */
function sectionsOf(doc, pane) {
  const out = [];
  let headings = 0;
  const nodes = doc.querySelectorAll(`#paneDeck [data-category="${pane}"]`);
  for (const e of nodes) {
    if (e.hidden || e.closest("[hidden]")) {
      continue;
    }
    let head = null;
    if (e.classList.contains("subcategory")) {
      headings++;
      if (headings == 1) {
        continue; // the pane title
      }
      head = e.querySelector("h1, h2");
    } else if (e.localName == "fieldset" && headings <= 1) {
      head = e.querySelector(":scope > legend");
    }
    const label = head?.textContent.trim();
    if (label) {
      out.push({
        el: e,
        label,
        icon: subIcon((head.getAttribute("data-l10n-id") || "") + " " + e.id),
      });
    }
  }
  return out;
}

function mainWindow() {
  return Services.wm.getMostRecentWindow("mail:3pane");
}

const SETTINGS_URLS = ["about:preferences", "about:accountsettings"];

/** The (single) tab that currently shows preferences or account settings. */
function settingsTab(win) {
  const tm = win.document.getElementById("tabmail");
  return tm.tabInfo.find(t => {
    const spec = t.browser?.currentURI?.spec ?? "";
    return SETTINGS_URLS.some(u => spec.startsWith(u));
  });
}

function showing(tab) {
  return tab.browser.currentURI.spec.startsWith("about:accountsettings") ? "accounts" : "prefs";
}

// tab -> { hidden: <browser> holding the page that is NOT shown, ready: Promise }
const states = new Map();

/**
 * Both pages live in the same tab: the visible one in the tab's browser, the other one preloaded in a
 * hidden browser. Switching swaps the two docshells, so nothing reloads.
 */
function ensureHidden(win, tab, undo) {
  if (states.has(tab)) {
    return states.get(tab);
  }
  const b = win.document.createXULElement("browser");
  b.setAttribute("type", "content");
  b.setAttribute("disablehistory", "true");
  b.setAttribute("messagemanagergroup", "browsers");
  b.style.cssText = "position:fixed;left:-4000px;top:0;width:1000px;height:700px;";
  const state = { hidden: b };
  state.ready = new Promise(resolve => {
    b.addEventListener("DOMContentLoaded", e => {
      if (e.target?.location) {
        injectNav(e.target, undo);
      }
    }, true);
    b.addEventListener("load", e => {
      if (e.target?.location?.href == "about:accountsettings") {
        resolve();
      }
    }, true);
  });
  b.setAttribute("src", "about:accountsettings");
  win.document.documentElement.append(b);
  states.set(tab, state);
  return state;
}

function destroyState(tab) {
  const st = states.get(tab);
  if (st) {
    st.hidden.remove();
    states.delete(tab);
  }
}

function swapTo(tab, which) {
  const st = states.get(tab);
  if (st && showing(tab) != which) {
    tab.browser.swapDocShells(st.hidden);
  }
}

async function waitFor(fn, ms = 6000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) {
      return v;
    }
    if (Date.now() > end) {
      return null;
    }
    await new Promise(r => setTimeout(r, 40));
  }
}

/** Show the account settings (optionally a page/server) in the one settings tab. */
async function showAccounts(selectPage, server) {
  const main = mainWindow();
  const tm = main.document.getElementById("tabmail");
  let tab = settingsTab(main);
  if (!tab) {
    await main.openPreferencesTab();
    tab = await waitFor(() => settingsTab(main));
  }
  const st = tab && (await waitFor(() => states.get(tab)));
  if (!st) {
    return false;
  }
  await Promise.race([st.ready, new Promise(r => setTimeout(r, 6000))]);
  swapTo(tab, "accounts");
  const doc = tab.browser.contentDocument;
  doc.documentElement.server = server || null;
  doc.documentElement.selectPage = selectPage || null;
  doc.defaultView.onLoad?.();
  main.focus();
  tm.switchToTab(tab);
  return true;
}

/** Open a preferences pane (optionally with a search), replacing the account page. */
function gotoPane(pane, query) {
  const main = mainWindow();
  const tm = main.document.getElementById("tabmail");
  const tab = settingsTab(main);
  if (tab && states.has(tab)) {
    swapTo(tab, "prefs");
    tm.switchToTab(tab);
    const pw = tab.browser.contentWindow;
    if (query) {
      const input = pw.document.getElementById("searchInput");
      input.value = query;
      input.dispatchEvent(new pw.Event("input", { bubbles: true }));
    } else {
      pw.gotoPref(pane);
    }
    return;
  }
  // Stand-alone account tab (no preloaded twin): open preferences and close it.
  pendingSearch = query || null;
  main.openPreferencesTab(pane);
  if (tab && showing(tab) == "accounts") {
    tm.closeTab(tab);
  }
}

function el(doc, name, props = {}, ...kids) {
  const e = doc.createElementNS(XHTML, name);
  Object.assign(e, props);
  e.append(...kids);
  return e;
}

function addStyle(doc, css, undo) {
  const s = doc.createElementNS(XHTML, "style");
  s.textContent = css;
  (doc.head || doc.documentElement).append(s);
  undo.push(() => s.remove());
  return s;
}

/**
 * Build the shared navigation.
 * @param {Document} doc
 * @param {string} active  "pane…" id of the highlighted entry, or "accounts"
 * @param {(entry) => void} onGo  called for pane entries
 * @param {?Element} searchInput  existing search input to adopt, or null to create one
 */
function buildNav(doc, active, onGo, searchInput) {
  const nav = el(doc, "aside", { id: "tbsr-nav" });
  let input = searchInput;
  if (!input) {
    input = el(doc, "input", { type: "search", placeholder: T.search });
    input.addEventListener("keydown", e => {
      if (e.key == "Enter" && input.value.trim()) {
        gotoPane("paneGeneral", input.value.trim());
      }
    });
  }
  nav.append(
    el(doc, "div", { className: "tbsr-search" },
      el(doc, "img", { src: COMPACT + "search.svg", alt: "" }),
      input)
  );
  for (const it of navItems()) {
    if (it.separator) {
      nav.append(el(doc, "hr"));
      continue;
    }
    if (it.group) {
      nav.append(el(doc, "h6", { textContent: it.group }));
      continue;
    }
    const a = el(doc, "a", { href: "#", role: "link" },
      el(doc, "span", { className: "ic" }, el(doc, "img", { src: it.icon, alt: "" })),
      el(doc, "span", { textContent: it.label }));
    if (it.pane) {
      a.dataset.pane = it.pane;
    }
    if ((it.accounts && active == "accounts") || it.pane == active) {
      a.setAttribute("aria-current", "page");
    }
    a.addEventListener("click", e => {
      e.preventDefault();
      if (it.addons) {
        mainWindow().openAddonsMgr();
      } else if (it.accounts) {
        mainWindow().MsgAccountManager(null);
      } else {
        onGo(it);
      }
    });
    nav.append(a);
  }
  return { nav, input };
}

function setActive(nav, pane) {
  for (const a of nav.querySelectorAll("a")) {
    if (a.dataset.pane == pane) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  }
}

function injectNav(doc, undo) {
  const href = doc.location.href;
  if (href.startsWith("about:preferences")) {
    injectPreferences(doc, undo);
  } else if (href == "about:accountsettings") {
    injectAccountSettings(doc, undo);
  } else if (href.startsWith("about:addons") && !doc.getElementById("tbsr-addons")) {
    addStyle(doc, shellCss() + CSS.addons, undo).id = "tbsr-addons";
  }
}

// ---------- NovaBird-Sammelseite: Einstellungen aller installierten NovaBird-Add-ons als Reiter ----------

// Ab 2.0 hat NovaBird-Search (mit Suchindex) die ID des früheren NovaBird-DB, daher der Schlüssel "db" für „Suche“;
// "search" gibt es nur noch kurz beim Umstieg von 1.x (das alte Add-on wird dann entfernt).
const HUB_ORDER = ["db", "search", "conversation", "send", "extension"];
const HUB_LABEL = {
  db: tr("Suche", "Search", "Recherche", "Búsqueda"),
  search: tr("Suchleiste (alt)", "Search bar (old)", "Barre de recherche (ancienne)", "Barra de búsqueda (antigua)"),
  conversation: tr("Konversation", "Conversation", "Conversation", "Conversación"),
  send: tr("Senden", "Send", "Envoi", "Envío"),
  extension: "Extension",
};
let hubLast = null; // zuletzt gewählter Reiter (bleibt beim erneuten Öffnen erhalten)
const hubSelects = new Set(); // Reiterwahl der offenen NovaBird-Seiten (openHub)

/** Aktive NovaBird-Add-ons mit Optionsseite, in fester Reihenfolge; unbekannte (`…@novabird`) folgen. */
function hubAddons() {
  const found = new Map();
  for (const p of WebExtensionPolicy.getActiveExtensions()) {
    const m = /^novabird-([a-z0-9-]+)@novabird$/.exec(p.id);
    const page = p.extension?.manifest?.options_ui?.page;
    if (!m || !page) {
      continue;
    }
    // ?hub=1: die Seite weiß, dass sie hier in voller Breite steht (in der Add-on-Verwaltung zeigt sie nur einen Verweis hierher)
    found.set(m[1], { id: p.id, key: m[1], label: HUB_LABEL[m[1]] || m[1], url: p.getURL(page) + "?hub=1", icon: p.getURL("icons/icon-48.png") });
  }
  const out = HUB_ORDER.filter(k => found.has(k)).map(k => found.get(k));
  for (const [k, v] of found) {
    if (!HUB_ORDER.includes(k)) {
      out.push(v);
    }
  }
  return out;
}

const HUB_CSS = `
#nbxHub { padding: 12px 0 24px; }
#nbxHub .nbx-hub-title { font-size: 1.6em; font-weight: 600; margin: 0 0 12px; }
#nbxHub .nbx-hub-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 12px; border-bottom: 1px solid var(--tbsr-line, ThreeDShadow); padding-bottom: 8px; }
#nbxHub .nbx-hub-tabs button { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px; border: 1px solid transparent; border-radius: 8px;
  background: transparent; color: var(--tbsr-text, inherit); font: inherit; cursor: pointer; }
#nbxHub .nbx-hub-tabs button:hover { background: var(--tbsr-hover, color-mix(in srgb, currentColor 8%, transparent)); }
#nbxHub .nbx-hub-tabs button[aria-selected="true"] { background: var(--tbsr-accent-bg, color-mix(in srgb, AccentColor 15%, transparent)); color: var(--tbsr-accent-text, inherit); font-weight: 600; }
#nbxHub .nbx-hub-tabs img { width: 20px; height: 20px; border-radius: 5px; }

#nbxHub .nbx-hub-box { border: 1px solid var(--tbsr-line, ThreeDShadow); border-radius: 10px; background: var(--tbsr-panel, Canvas); padding: 6px 8px; overflow: hidden; }
#nbxHub .nbx-hub-box[hidden] { display: none; }
#nbxHub browser.nbx-hub-browser { display: block; width: 100%; min-height: 200px; }
#nbxHub .nbx-hub-empty { color: var(--tbsr-muted, GrayText); padding: 12px 0; }`;

/**
 * Optionsseite eines Add-ons in einem eigenen `browser`-Element (wie Betterbirds „inline options“ im Add-ons-Manager):
 * Seiten von Add-ons laufen im Erweiterungsprozess, ein einfacher iframe kann sie dort nicht laden.
 * Der Inhalt meldet seine Höhe (Extension:BrowserResized); die Seite scrollt als Ganzes.
 */
async function loadOptionsBrowser(doc, host, addonId, url) {
  const win = doc.defaultView;
  const { E10SUtils } = ChromeUtils.importESModule("resource://gre/modules/E10SUtils.sys.mjs");
  const { ExtensionParent } = ChromeUtils.importESModule("resource://gre/modules/ExtensionParent.sys.mjs");
  const policy = WebExtensionPolicy.getByID(addonId);
  const browser = doc.createXULElement("browser");
  for (const [k, v] of Object.entries({
    type: "content", disableglobalhistory: "true", messagemanagergroup: "webext-browsers", transparent: "true",
    forcemessagemanager: "true", class: "nbx-hub-browser", initialBrowsingContextGroupId: String(policy.browsingContextGroupId),
  })) {
    browser.setAttribute(k, v);
  }
  Object.defineProperty(browser, "autoCompletePopup", {
    enumerable: true,
    configurable: true,
    get() {
      return this.browsingContext.topChromeWindow.document.getElementById("PopupAutoComplete");
    },
  });
  const once = (target, type, capture) => new Promise(resolve => target.addEventListener(type, resolve, { once: true, capture }));
  const remoteType = ChromeUtils.predictRemoteTypeForURI(url, { window: win, preferredRemoteType: E10SUtils.EXTENSION_REMOTE_TYPE });
  let ready;
  if (remoteType !== E10SUtils.NOT_REMOTE) {
    browser.setAttribute("remote", "true");
    browser.setAttribute("remoteType", remoteType);
    ready = once(browser, "XULFrameLoaderCreated");
  } else {
    ready = once(browser, "load", true);
  }
  host.append(browser);
  browser.clientTop; // Bindings sofort anwenden
  await ready;
  if (!browser.messageManager) {
    return browser;
  }
  ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
  const mm = browser.messageManager;
  mm.addMessageListener("Extension:BrowserResized", {
    receiveMessage({ data }) {
      browser.style.height = `${data.height}px`;
    },
  });
  mm.loadFrameScript("chrome://extensions/content/ext-browser-content.js", false, true);
  mm.sendAsyncMessage("Extension:InitBrowser", { fixedWidth: true, isInline: true });
  const load = () => browser.fixupAndLoadURIString(url, { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });
  if (browser.isConnectedAndReady) {
    load();
  } else {
    await once(doc, "DOMContentLoaded");
    load();
  }
  return browser;
}

/** Kategorie „NovaBird“ + Seite mit Reitern in about:preferences. */
function setupHub(doc, undo) {
  const cats = doc.getElementById("categories");
  const deck = doc.getElementById("paneDeck");
  if (!cats || !deck || doc.getElementById("nbxHub")) {
    return;
  }
  const win = doc.defaultView;
  // Die Seite kennt nur registrierte Kategorien; ohne Vorlage-Element (id = Kategoriename) bleibt init() leer.
  win.register_module("paneNovaBird", { init() {} });
  const item = doc.createXULElement("richlistitem");
  item.id = "category-novabird";
  item.className = "category";
  item.setAttribute("value", "paneNovaBird");
  item.setAttribute("align", "center");
  const name = doc.createXULElement("label");
  name.className = "category-name";
  name.setAttribute("flex", "1");
  name.textContent = "NovaBird";
  item.append(name);
  cats.append(item);

  const pane = el(doc, "div", { id: "nbxHub" });
  pane.setAttribute("data-category", "paneNovaBird");
  pane.hidden = true;
  const tabs = el(doc, "div", { className: "nbx-hub-tabs", role: "tablist" });
  const frames = el(doc, "div");
  pane.append(el(doc, "h1", { className: "nbx-hub-title", textContent: "NovaBird" }), tabs, frames);
  deck.append(pane);

  const style = addStyle(doc, HUB_CSS, undo);
  const list = hubAddons();
  const pages = new Map();
  // Hell/dunkel der Seite nach der Panel-Farbe richten (die Seite im Add-on-Prozess sieht unser Theme nicht)
  const scheme = () => {
    const probe = el(doc, "span", { style: "background: var(--tbsr-panel); position: absolute; visibility: hidden" });
    pane.append(probe);
    const bg = win.getComputedStyle(probe).backgroundColor;
    probe.remove();
    return bg && bg != "rgba(0, 0, 0, 0)" ? (isDark(bg) ? "dark" : "light") : null;
  };
  const applyScheme = browser => {
    try {
      const sc = scheme();
      if (sc && browser.browsingContext) {
        browser.browsingContext.prefersColorSchemeOverride = sc;
      }
    } catch (e) {
      console.error("NovaBird-Extension hub:", e);
    }
  };
  const select = key => {
    hubLast = key;
    for (const [k, page] of pages) {
      page.btn.setAttribute("aria-selected", String(k == key));
      page.box.hidden = k != key;
      if (k == key) {
        if (!page.started) {
          page.started = true;
          const a = list.find(x => x.key == k);
          loadOptionsBrowser(doc, page.box, a.id, a.url).then(b => {
            page.browser = b;
            applyScheme(b);
          }, e => {
            page.box.append(el(doc, "p", { className: "nbx-hub-empty", textContent: String(e) }));
            console.error("NovaBird-Extension hub:", e);
          });
        } else if (page.browser) {
          applyScheme(page.browser);
        }
      }
    }
  };
  if (!list.length) {
    frames.append(el(doc, "p", { className: "nbx-hub-empty", textContent: tr("Keine NovaBird-Add-ons mit Einstellungen gefunden.", "No NovaBird add-ons with settings found.", "Aucun module NovaBird avec réglages.", "No hay complementos NovaBird con ajustes.") }));
  }
  for (const a of list) {
    const btn = el(doc, "button", { type: "button", role: "tab", textContent: a.label });
    btn.addEventListener("click", () => select(a.key));
    tabs.append(btn);
    const box = el(doc, "div", { className: "nbx-hub-box" });
    box.hidden = true;
    frames.append(box);
    pages.set(a.key, { btn, box, started: false, browser: null });
  }
  if (list.length) {
    select(pages.has(hubLast) ? hubLast : list[0].key);
  }
  const selectKnown = key => pages.has(key) && select(key);
  hubSelects.add(selectKnown);
  const onPane = () => {
    for (const page of pages.values()) {
      if (page.browser && !page.box.hidden) {
        applyScheme(page.browser);
      }
    }
  };
  doc.addEventListener("paneSelected", onPane);
  undo.push(() => {
    hubSelects.delete(selectKnown);
    doc.removeEventListener("paneSelected", onPane);
    item.remove();
    pane.remove();
    style.remove();
  });
}

/** about:preferences: replace the sidebar with the shared navigation. */
function injectPreferences(doc, undo) {
  const box = doc.getElementById("prefBox");
  const search = doc.getElementById("searchInput");
  if (!box || !search || doc.getElementById("tbsr-nav")) {
    return;
  }
  // Always start on "Allgemein" instead of the category used last time.
  Services.xulStore.setValue("about:preferences", "paneDeck", "lastSelected", "paneGeneral");

  const win = doc.defaultView;
  const searchParent = search.parentNode;
  const searchNext = search.nextSibling;

  const main = mainWindow();
  const tab = main.document.getElementById("tabmail").tabInfo.find(t => t.browser?.contentDocument === doc);
  if (tab) {
    ensureHidden(main, tab, perWindow.get(main));
  }

  addStyle(doc, shellCss(), undo);
  addStyle(doc, CSS.prefs, undo);
  setupHub(doc, undo);

  let tree = null;
  let subs = [];
  let treeEnabled = false; // the tree opens only after the first click in the navigation
  const container = doc.getElementById("preferencesContainer");

  const closeTree = () => {
    const old = tree;
    tree = null;
    subs = [];
    if (old) {
      old.classList.remove("open");
      win.setTimeout(() => old.remove(), 220);
    }
  };

  const renderTree = pane => {
    closeTree();
    const link = nav.querySelector(`a[data-pane="${pane}"]`);
    subs = link ? sectionsOf(doc, pane) : [];
    if (!subs.length) {
      return;
    }
    const inner = el(doc, "div");
    for (const sub of subs) {
      const a = el(doc, "a", { href: "#" },
        el(doc, "img", { src: sub.icon, alt: "" }),
        el(doc, "span", { textContent: sub.label }));
      a.addEventListener("click", e => {
        e.preventDefault();
        sub.el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
      sub.link = a;
      inner.append(a);
    }
    tree = el(doc, "div", { className: "tbsr-tree" }, inner);
    link.after(tree);
    win.requestAnimationFrame(() => tree?.classList.add("open"));
    spy();
  };

  // Highlight the section currently at the top of the scrolled pane.
  let spyQueued = false;
  const spy = () => {
    if (!subs.length) {
      return;
    }
    const top = container.getBoundingClientRect().top + 140;
    let current = subs[0];
    for (const sub of subs) {
      if (sub.el.getBoundingClientRect().top <= top) {
        current = sub;
      }
    }
    for (const sub of subs) {
      if (sub == current) {
        sub.link.setAttribute("aria-current", "true");
      } else {
        sub.link.removeAttribute("aria-current");
      }
    }
  };
  const onScroll = () => {
    if (!spyQueued) {
      spyQueued = true;
      win.requestAnimationFrame(() => {
        spyQueued = false;
        spy();
      });
    }
  };
  container.addEventListener("scroll", onScroll);

  const { nav } = buildNav(
    doc,
    "paneGeneral",
    it => {
      treeEnabled = true;
      if (win.gLastCategory?.category == it.pane) {
        // Same pane again: fold/unfold the tree and go back to the top.
        if (tree) {
          closeTree();
        } else {
          renderTree(it.pane);
        }
        container.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        win.gotoPref(it.pane);
      }
    },
    search
  );
  box.prepend(nav);

  const onPane = () => {
    const pane = win.gLastCategory?.category;
    setActive(nav, pane);
    if (treeEnabled) {
      renderTree(pane);
    } else {
      closeTree();
    }
    if (pendingSearch) {
      // The tab's URL hash is applied right after load and would clear the field again.
      const q = pendingSearch;
      pendingSearch = null;
      win.setTimeout(() => {
        search.value = q;
        search.dispatchEvent(new win.Event("input", { bubbles: true }));
      }, 400);
    }
  };
  doc.addEventListener("paneSelected", onPane);

  // Links inside the page (e.g. privacy pane) use the page's own copy.
  const origMgr = win.MsgAccountManager;
  win.MsgAccountManager = (...args) => mainWindow().MsgAccountManager(...args);

  undo.push(() => {
    container.removeEventListener("scroll", onScroll);
    doc.removeEventListener("paneSelected", onPane);
    searchParent.insertBefore(search, searchNext);
    nav.remove();
    win.MsgAccountManager = origMgr;
  });
}

/** about:accountsettings: same navigation, plus styling for the page and its sub pages. */
function injectAccountSettings(doc, undo) {
  if (doc.getElementById("tbsr-nav") || !doc.body) {
    return;
  }
  // Thunderbird adds aboutExtra.css only to pages loaded straight into a tab; the preloaded twin lacks it.
  if (![...doc.styleSheets].some(ss => ss.href?.endsWith("/aboutExtra.css"))) {
    const link = el(doc, "link", { rel: "stylesheet", href: "chrome://messenger/skin/aboutExtra.css" });
    doc.head.append(link);
    undo.push(() => link.remove());
  }
  addStyle(doc, shellCss(), undo);
  addStyle(doc, CSS.account, undo);

  const { nav } = buildNav(doc, "accounts", it => gotoPane(it.pane), null);
  doc.body.prepend(nav);

  // Sub pages (am-*.xhtml) load into this frame; style each one. Some pages block
  // inline <style>, so use a constructable stylesheet.
  const frame = doc.getElementById("contentFrame");
  const styled = new Set();
  const styleFrame = () => {
    const fd = frame.contentDocument;
    if (!fd?.documentElement || fd.location.href == "about:blank" || styled.has(fd)) {
      return;
    }
    const sheet = new fd.defaultView.CSSStyleSheet();
    sheet.replaceSync(shellCss() + CSS.frame);
    fd.adoptedStyleSheets = [...fd.adoptedStyleSheets, sheet];
    styled.add(fd);
  };
  frame.addEventListener("load", styleFrame, true);
  styleFrame();

  undo.push(() => {
    frame.removeEventListener("load", styleFrame, true);
    for (const fd of styled) {
      try {
        fd.adoptedStyleSheets = fd.adoptedStyleSheets.slice(0, -1);
      } catch (e) {}
    }
    nav.remove();
  });
}


/** Compose: Cc/Bcc/"more" toggles move from the From row into the To row (end of the line). */
/**
 * Compose: Thunderbirds Einstellung "Schriftgröße" (drei Striche) setzt die Schrift der Wurzel des Fensters; Thunderbirds eigene Oberfläche
 * nutzt genau diesen Wert in px (gemessen: Standard 8,4 px, Einstellung 12 → 12 px). Unsere Grundschrift ist 14 px und damit schon größer
 * als Thunderbirds Standard. Sie bleibt 13,3 px (95 % von 14), solange die Einstellung kleiner ist, und folgt ihr darüber (--tbsr-scale = Wurzel / 13,3, mindestens 1).
 */
const COMPOSE_BASE_PX = 13.3;
function trackUiScale(win, undo) {
  const root = win.document.documentElement;
  const update = () => {
    try {
      const cur = parseFloat(win.getComputedStyle(root).fontSize);
      const ratio = cur > 0 ? Math.max(1, Math.round((cur / COMPOSE_BASE_PX) * 1000) / 1000) : 1;
      root.style.setProperty("--tbsr-scale", String(ratio));
    } catch (e) {
      console.error("NovaBird: Schriftgröße", e);
    }
  };
  update();
  // Thunderbird setzt die gewählte Größe erst nach dem Laden des Fensters und bei jeder Änderung
  const timers = [300, 1500, 4000].map(ms => win.setTimeout(update, ms));
  win.addEventListener("uifontsizechange", update);
  undo.push(() => {
    for (const t of timers) {
      win.clearTimeout(t);
    }
    win.removeEventListener("uifontsizechange", update);
    root.style.removeProperty("--tbsr-scale");
  });
}

function moveRecipientToggles(win, undo) {
  const doc = win.document;
  const area = doc.getElementById("extraAddressRowsArea");
  const toRow = doc.getElementById("addressRowTo");
  if (!area || !toRow) {
    return;
  }
  const home = area.parentNode;
  const next = area.nextSibling;
  toRow.append(area);
  undo.push(() => home.insertBefore(area, next));
}


const FMT_OPEN_PREF = "extensions.novabird-extension.composeFormatOpen";
const FMT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36, 48, 72];
const FMT_T = {
  toggle: tr("Formatierung ein-/ausklappen", "Expand/collapse formatting", "Afficher/masquer la mise en forme", "Mostrar/ocultar formato"),
  size: tr("Schriftgröße", "Font size", "Taille de police", "Tamaño de fuente"),
  sample: tr(
    "Guten Tag, anbei finden Sie unser Angebot. 0123456789",
    "Hello, please find our offer attached. 0123456789",
    "Bonjour, veuillez trouver notre offre ci-jointe. 0123456789",
    "Hola, adjunto encontrará nuestra oferta. 0123456789"
  ),
};

/**
 * Compose: formatting bar. Expandable second row with a font preview, font size as a number,
 * the font list as a scrollable panel (hover = preview) and extension buttons (LanguageTool) in the bar.
 * Everything is added next to the original controls (hidden by CSS only while class "nb-fmt" is set), so a
 * failure leaves the stock bar usable.
 */
function setupFormatBar(win, undo) {
  const doc = win.document;
  const toolbox = doc.getElementById("FormatToolbox");
  const bar = doc.getElementById("FormatToolbar");
  const fontMenu = doc.getElementById("FontFaceSelect");
  const fontPopup = doc.getElementById("FontFacePopup");
  const anchorBtn = doc.getElementById("AbsoluteFontSizeButton");
  if (!toolbox || !bar || !fontMenu || !fontPopup || !anchorBtn) {
    return;
  }
  let open = false;
  try {
    open = Services.prefs.getBoolPref(FMT_OPEN_PREF, false);
  } catch (e) {}

  // 1. toggle button (first item of the bar)
  const toggle = doc.createXULElement("toolbarbutton");
  toggle.id = "nb-fmt-toggle";
  toggle.className = "formatting-button";
  toggle.setAttribute("tooltiptext", FMT_T.toggle);
  bar.insertBefore(toggle, bar.firstChild);
  // the font menu moves to the front (right behind the arrow), as in the mockup
  const fontHome = { parent: fontMenu.parentNode, next: fontMenu.nextSibling };
  toggle.after(fontMenu);

  // 2. font size as a number (replaces the three size buttons while "nb-fmt" is set)
  const sizeMenu = doc.createXULElement("menulist");
  sizeMenu.id = "nb-fmt-size";
  sizeMenu.setAttribute("tooltiptext", FMT_T.size);
  const sizePopup = doc.createXULElement("menupopup");
  for (const n of FMT_SIZES) {
    const item = doc.createXULElement("menuitem");
    item.setAttribute("label", String(n));
    item.setAttribute("value", String(n));
    sizePopup.append(item);
  }
  sizeMenu.append(sizePopup);
  anchorBtn.before(sizeMenu);

  // 3. second row: sample text
  const sample = el(doc, "div", { id: "nb-fmt-sample", textContent: FMT_T.sample });
  const row = el(doc, "div", { id: "nb-fmt-row" }, sample);
  toolbox.append(row);

  // 4. font panel
  const panel = doc.createXULElement("panel");
  panel.id = "nb-fmt-fonts";
  panel.setAttribute("noautofocus", "true");
  panel.setAttribute("norolluponanchor", "true");
  const list = el(doc, "div", { id: "nb-fmt-fontlist" });
  panel.append(list);
  toolbox.append(panel);

  const setPreview = family => {
    sample.style.fontFamily = family || "";
  };
  const currentFamily = () => fontMenu.value || "";
  // while the list is open the sample text moves to the right of it, so scrolling through the fonts shows the preview
  panel.addEventListener("popupshown", () => {
    row.style.paddingInlineStart = Math.round(fontMenu.getBoundingClientRect().left - row.getBoundingClientRect().left + list.getBoundingClientRect().width + 20) + "px";
  });
  panel.addEventListener("popuphidden", () => {
    setPreview(currentFamily());
    row.style.paddingInlineStart = "";
  });
  const buildList = () => {
    try {
      win.initLocalFontFaceMenu?.(fontPopup);
    } catch (e) {}
    list.replaceChildren();
    for (const node of fontPopup.children) {
      if (node.localName == "menuseparator") {
        if (!node.hidden) {
          list.append(el(doc, "div", { className: "nb-fmt-sep" }));
        }
        continue;
      }
      if (node.localName != "menuitem" || node.hidden) {
        continue;
      }
      const value = node.getAttribute("value") ?? "";
      const item = el(doc, "div", { className: "nb-fmt-font", textContent: node.getAttribute("label") || value });
      item.style.fontFamily = value;
      if (value == currentFamily()) {
        item.classList.add("cur");
      }
      item.addEventListener("mouseenter", () => setPreview(value));
      item.addEventListener("click", () => {
        panel.hidePopup();
        try {
          win.doStatefulCommand("cmd_fontFace", value);
        } catch (e) {
          console.error(e);
        }
        win.gContentWindow?.focus();
      });
      list.append(item);
    }
  };
  // The menulist keeps showing the current font; its own popup is replaced by the panel.
  const onFontPopup = event => {
    event.preventDefault();
    buildList();
    panel.openPopup(fontMenu, "after_start");
    list.querySelector(".cur")?.scrollIntoView({ block: "center" });
  };
  fontPopup.addEventListener("popupshowing", onFontPopup);

  // 5. editor: size from the selection, size changes
  let editorDoc = null;
  let pendingPt = 12;
  const editorDocument = () => {
    try {
      return win.GetCurrentEditor?.()?.document || null;
    } catch (e) {
      return null;
    }
  };
  const convertMarkers = d => {
    // execCommand("fontSize", 7) marks the text; 7 is not offered anywhere else, so it only means "our size"
    for (const f of d.querySelectorAll('font[size="7"]')) {
      f.removeAttribute("size");
      f.style.fontSize = pendingPt + "pt";
    }
  };
  const refresh = () => {
    const d = editorDocument();
    if (!d) {
      return;
    }
    try {
      const sel = d.getSelection();
      const node = sel?.focusNode;
      const e = node && (node.nodeType == 1 ? node : node.parentElement);
      if (!e) {
        return;
      }
      const px = parseFloat(d.defaultView.getComputedStyle(e).fontSize);
      if (!px) {
        return;
      }
      const pt = Math.round(px * 0.75 * 2) / 2;
      const idx = FMT_SIZES.indexOf(pt);
      if (idx >= 0) {
        sizeMenu.selectedIndex = idx;
      } else {
        sizeMenu.selectedIndex = -1;
        sizeMenu.setAttribute("label", String(pt));
      }
      sample.style.fontSize = Math.min(34, Math.max(13, Math.round(px))) + "px";
    } catch (e) {}
  };
  const hookEditor = () => {
    const d = editorDocument();
    if (!d || d === editorDoc) {
      return;
    }
    editorDoc = d;
    d.addEventListener("selectionchange", refresh);
    d.addEventListener("input", () => convertMarkers(d));
    refresh();
  };
  sizeMenu.addEventListener("command", () => {
    const d = editorDocument();
    const pt = parseFloat(sizeMenu.value);
    if (!d || !pt) {
      return;
    }
    pendingPt = pt;
    d.execCommand("fontSize", false, "7");
    convertMarkers(d);
    win.gContentWindow?.focus();
    refresh();
  });
  const timers = [0, 400, 1500, 4000].map(ms => win.setTimeout(hookEditor, ms));
  win.addEventListener("focus", hookEditor, true);

  // 6. extension buttons (LanguageTool etc.) from the command bar into the formatting bar
  const cmdBar = doc.getElementById("composeToolbar2");
  const actions = doc.createXULElement("hbox");
  actions.id = "nb-fmt-actions";
  actions.setAttribute("align", "center");
  bar.append(actions);
  const moved = [];
  const isExt = n => n.localName == "toolbarbutton" && n.classList.contains("webextension-compose-action") && !/novabird/i.test(n.id);
  const collect = () => {
    for (const n of cmdBar ? [...cmdBar.children] : []) {
      if (isExt(n)) {
        moved.push({ node: n, next: n.nextSibling });
        actions.append(n);
      }
    }
  };
  collect();
  const mo = cmdBar ? new win.MutationObserver(collect) : null;
  mo?.observe(cmdBar, { childList: true });

  // 7. open/close
  const apply = () => {
    toolbox.toggleAttribute("nb-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle.addEventListener("command", () => {
    open = !open;
    try {
      Services.prefs.setBoolPref(FMT_OPEN_PREF, open);
    } catch (e) {}
    apply();
  });
  apply();
  bar.classList.add("nb-fmt");

  undo.push(() => {
    bar.classList.remove("nb-fmt");
    mo?.disconnect();
    for (const t of timers) {
      win.clearTimeout(t);
    }
    win.removeEventListener("focus", hookEditor, true);
    fontPopup.removeEventListener("popupshowing", onFontPopup);
    for (const { node, next } of moved.reverse()) {
      cmdBar?.insertBefore(node, next && next.parentNode == cmdBar ? next : null);
    }
    fontHome.parent?.insertBefore(fontMenu, fontHome.next && fontHome.next.parentNode == fontHome.parent ? fontHome.next : null);
    for (const n of [toggle, sizeMenu, row, panel, actions]) {
      n.remove();
    }
    toolbox.removeAttribute("nb-open");
  });
}

function setupWindow(win, isMain) {
  const undo = [];
  perWindow.set(win, undo);

  const hide = win.document.createElement("style");
  hide.textContent = HIDE_CSS;
  win.document.documentElement.append(hide);
  undo.push(() => hide.remove());

  if (win.location.href.endsWith("messengercompose.xhtml")) {
    addStyle(win.document, shellCss() + CSS.compose, undo);
    trackUiScale(win, undo);
    moveRecipientToggles(win, undo);
    try {
      setupFormatBar(win, undo);
    } catch (e) {
      console.error("NovaBird: Formatierungsleiste", e);
    }
  }

  const orig = win.MsgAccountManager;
  if (orig) {
    win.MsgAccountManager = async function (selectPage, server) {
      try {
        if (mainWindow() && (await showAccounts(selectPage, server))) {
          return undefined;
        }
      } catch (e) {
        console.error(e);
      }
      return orig.call(this, selectPage, server);
    };
    undo.push(() => {
      win.MsgAccountManager = orig;
    });
  }

  if (isMain && win.openPreferencesTab) {
    const origOpen = win.openPreferencesTab;
    win.openPreferencesTab = function (paneID, scrollPaneTo, otherArgs) {
      const tab = settingsTab(win);
      if (tab && states.has(tab) && showing(tab) == "accounts") {
        // The tab shows the account page: swap the preferences back in instead of opening a second tab.
        swapTo(tab, "prefs");
        win.document.getElementById("tabmail").switchToTab(tab);
        const pw = tab.browser.contentWindow;
        return Promise.resolve(pw.selectPrefPane?.(paneID, scrollPaneTo, otherArgs)).then(() => pw);
      }
      return origOpen.call(this, paneID, scrollPaneTo, otherArgs);
    };
    undo.push(() => {
      win.openPreferencesTab = origOpen;
    });
  }

  if (isMain) {
    const tm = win.document.getElementById("tabmail");
    const onLoad = event => {
      const doc = event.target;
      if (doc?.location) {
        injectNav(doc, undo);
      }
    };
    const monitor = {
      monitorName: LISTENER_ID,
      onTabTitleChanged() {},
      onTabClosing(tab) {
        destroyState(tab);
      },
      onTabPersist() {},
      onTabRestored() {},
      onTabSwitched() {},
      onTabOpened(tab) {
        tab.browser?.addEventListener("DOMContentLoaded", onLoad, true);
      },
    };
    tm.registerTabMonitor(monitor);
    for (const tab of tm.tabInfo) {
      if (tab.browser) {
        tab.browser.addEventListener("DOMContentLoaded", onLoad, true);
        if (tab.browser.contentDocument?.readyState == "complete") {
          injectNav(tab.browser.contentDocument, undo);
        }
      }
    }
    undo.push(() => {
      tm.unregisterTabMonitor(monitor);
      for (const tab of tm.tabInfo) {
        tab.browser?.removeEventListener("DOMContentLoaded", onLoad, true);
      }
    });
  }

  perWindow.set(win, undo);
}

// KI-Knopf im Nachrichtenkopf: ein Add-on kann seinen Knopf dort nicht ausblenden, daher ein Stilblatt mit der (eindeutigen) Knopf-ID
// KI aus: KI-Knopf der Nachrichtenansicht und „Was gibt's Neues?“ in der Leiste (einheitliche Symbolleiste) ausblenden
const AI_BUTTON_SHEET = Services.io.newURI("data:text/css," + encodeURIComponent(
  "#novabird-extension_novabird-messageDisplayAction-toolbarbutton, li[item-id=\"ext-novabird-extension@novabird\"] { display: none !important; }"));
// „Was gibt's Neues?“ hervorheben: Hintergrund und Rahmen in der Akzentfarbe (NovaBird-Design, sonst die von Windows)
const AI_NEWS_SHEET = Services.io.newURI("data:text/css," + encodeURIComponent(`
li[item-id="ext-novabird-extension@novabird"] button {
  background-color: color-mix(in srgb, var(--ms-accent, AccentColor) 20%, transparent) !important;
  border: 1px solid color-mix(in srgb, var(--ms-accent, AccentColor) 55%, transparent) !important;
  border-radius: 6px !important;
}
li[item-id="ext-novabird-extension@novabird"] button:hover {
  background-color: color-mix(in srgb, var(--ms-accent, AccentColor) 34%, transparent) !important;
}`));
function setAiButtonVisible(visible) {
  const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
  if (!sss.sheetRegistered(AI_NEWS_SHEET, sss.USER_SHEET)) {
    sss.loadAndRegisterSheet(AI_NEWS_SHEET, sss.USER_SHEET);
  }
  const registered = sss.sheetRegistered(AI_BUTTON_SHEET, sss.USER_SHEET);
  if (visible && registered) {
    sss.unregisterSheet(AI_BUTTON_SHEET, sss.USER_SHEET);
  } else if (!visible && !registered) {
    sss.loadAndRegisterSheet(AI_BUTTON_SHEET, sss.USER_SHEET);
  }
}

/**
 * Farben und Schrift des Hauptfensters. Die NovaBird-Themes steuern alles über --ms-* Variablen auf :root. Ein Benutzer-Stilblatt
 * (nsIStyleSheetService, !important) überschreibt sie in allen Dokumenten (auch about:3pane / about:message) und gilt sofort.
 * Hell und Dunkel getrennt über prefers-color-scheme, wie die Themes selbst.
 */
const MS_VARS = {
  spaces: "--ms-spaces", toolbar: "--ms-toolbar", sidebar: "--ms-sidebar", sidebarText: "--ms-sidebar-text",
  list: "--ms-list-bg", text: "--ms-text", muted: "--ms-muted", border: "--ms-border", rowLine: "--ms-row-line",
  hover: "--ms-hover", accent: "--ms-accent", accentDark: "--ms-accent-dark", accentSoft: "--ms-accent-soft",
  accentFocus: "--ms-accent-soft-focus", countBg: "--ms-count-bg", countFg: "--ms-count-fg",
};
const HEX = /^#[0-9a-f]{6}$/i;
let mainCfg = null; // { colors: {light:{}, dark:{}}, family, rowPct, padPct } oder null = nichts überschreiben
let mainSheet = null; // aktuell registrierte nsIURI
let fontCfg = { fe: 1, fp: 1, sub: 1, lab: 1, sample: 1 }; // Faktoren für Einstellungen/Konten und das Verfassen-Fenster

function sheetService() {
  return Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
}

function dropMainSheet() {
  if (mainSheet) {
    const sss = sheetService();
    if (sss.sheetRegistered(mainSheet, sss.USER_SHEET)) {
      sss.unregisterSheet(mainSheet, sss.USER_SHEET);
    }
    mainSheet = null;
  }
}

function scalePx(text, pct) {
  return String(text).replace(/(-?\d+(?:\.\d+)?)px/g, (m, n) => `${Math.round(parseFloat(n) * pct) / 100}px`);
}

/** Aktuelle Werte der --ms-* Variablen des Themes (ohne unser Stilblatt); Hell und Dunkel über die Farbschema-Umschaltung des Fensters. */
function readThemeVars() {
  const win = mainWindow();
  if (!win) {
    return null;
  }
  const had = mainSheet;
  dropMainSheet();
  const out = { light: {}, dark: {}, rowH: "", rowPad: "", font: "" };
  const bc = win.browsingContext;
  const prev = bc.prefersColorSchemeOverride;
  try {
    const cs = () => win.getComputedStyle(win.document.documentElement);
    for (const mode of ["light", "dark"]) {
      bc.prefersColorSchemeOverride = mode;
      const c = cs();
      for (const [key, name] of Object.entries(MS_VARS)) {
        out[mode][key] = c.getPropertyValue(name).trim();
      }
    }
    bc.prefersColorSchemeOverride = prev;
    const c = cs();
    out.rowH = c.getPropertyValue("--ms-row-h").trim();
    out.rowPad = c.getPropertyValue("--ms-row-pad").trim();
    out.font = c.getPropertyValue("--ms-font").trim();
  } finally {
    bc.prefersColorSchemeOverride = prev;
    if (had) {
      applyMainStyle();
    }
  }
  return out;
}

function applyMainStyle() {
  dropMainSheet();
  if (!mainCfg) {
    return;
  }
  const block = c =>
    Object.entries(c || {})
      .filter(([k, v]) => MS_VARS[k] && HEX.test(v))
      .map(([k, v]) => `${MS_VARS[k]}: ${v} !important;`)
      .join(" ");
  const common = [];
  const family = String(mainCfg.family || "");
  if (family && /^[\w .-]+$/.test(family)) {
    common.push(`--ms-font: ${family === "system-ui" ? "system-ui" : `"${family}"`}, sans-serif !important;`);
  }
  if (mainCfg.rowPct !== 100 || mainCfg.padPct !== 100) {
    const win = mainWindow();
    const c = win ? win.getComputedStyle(win.document.documentElement) : null;
    const rowH = c ? c.getPropertyValue("--ms-row-h").trim() : "";
    const rowPad = c ? c.getPropertyValue("--ms-row-pad").trim() : "";
    if (rowH && mainCfg.rowPct !== 100) {
      common.push(`--ms-row-h: ${scalePx(rowH, mainCfg.rowPct)} !important;`);
    }
    if (rowPad && mainCfg.padPct !== 100) {
      common.push(`--ms-row-pad: ${scalePx(rowPad, mainCfg.padPct)} !important;`);
    }
  }
  let css = common.length ? `:root:root { ${common.join(" ")} }\n` : "";
  const light = block(mainCfg.colors?.light);
  const dark = block(mainCfg.colors?.dark);
  if (light) {
    css += `@media not (prefers-color-scheme: dark) { :root:root { ${light} } }\n`;
  }
  if (dark) {
    css += `@media (prefers-color-scheme: dark) { :root:root { ${dark} } }\n`;
  }
  if (!css) {
    return;
  }
  const sss = sheetService();
  mainSheet = Services.io.newURI("data:text/css," + encodeURIComponent(css));
  sss.loadAndRegisterSheet(mainSheet, sss.USER_SHEET);
}

// Schriftfaktoren als Variablen für alle NovaBird-Stilblätter (Einstellungen, Konten, Verfassen)
function fontVarsCss() {
  const f = fontCfg;
  return `:root:root:root { --tbsr-fe: ${f.fe}; --tbsr-fp: ${f.fp}; --tbsr-m-sub: ${f.sub}; --tbsr-m-lab: ${f.lab}; --tbsr-m-sample: ${f.sample}; }`;
}

const themeObserver = {
  observe() {
    // Themewechsel: Vorgaben (Zeilenhöhe) neu lesen und das Stilblatt neu aufbauen
    const win = mainWindow();
    if (win && mainCfg) {
      win.setTimeout(() => {
        try {
          applyMainStyle();
        } catch (e) {
          console.error("NovaBird: Hauptfenster-Stil", e);
        }
      }, 300);
    }
  },
};

function teardown() {
  try {
    dropMainSheet();
    Services.obs.removeObserver(themeObserver, "lightweight-theme-styling-update");
  } catch (e) {}
  try {
    setAiButtonVisible(true);
    const sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(Ci.nsIStyleSheetService);
    if (sss.sheetRegistered(AI_NEWS_SHEET, sss.USER_SHEET)) {
      sss.unregisterSheet(AI_NEWS_SHEET, sss.USER_SHEET);
    }
  } catch (e) {}
  for (const [tab] of states) {
    try {
      swapTo(tab, "prefs");
    } catch (e) {}
    destroyState(tab);
  }
  for (const undo of perWindow.values()) {
    undo.splice(0).reverse().forEach(fn => {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    });
  }
  perWindow.clear();
}

return class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    nbUnloadShared(this.extension);
    ExtensionSupport.unregisterWindowListener(LISTENER_ID);
    teardown();
  }

  getAPI(context) {
    hubIcon = context.extension.getURL("icons/icon-48.png");
    try {
      Services.obs.addObserver(themeObserver, "lightweight-theme-styling-update");
    } catch (e) {
      console.error("NovaBird: Theme-Beobachter", e);
    }
    if (!nb.nbIsDark) {
      try {
        nbLoadShared(context.extension, ["shared/color.js"], nb);
      } catch (e) {
        console.error("NovaBird: gemeinsamer Code nicht geladen", e); // nur Selbsttest/Farbrechnung fehlen, Rest läuft
      }
    }
    return {
      settingsRedesign: {
        async openHub(key) {
          hubLast = String(key);
          for (const select of hubSelects) {
            select(hubLast);
          }
          gotoPane("paneNovaBird");
        },
        async setAiButton(visible) {
          setAiButtonVisible(Boolean(visible));
        },
        async getThemeColors() {
          return readThemeVars();
        },
        async setMainStyle(cfg) {
          mainCfg = cfg && typeof cfg === "object" ? cfg : null;
          if (mainCfg) {
            mainCfg.rowPct = Number(mainCfg.rowPct) || 100;
            mainCfg.padPct = Number(mainCfg.padPct) || 100;
          }
          applyMainStyle();
        },
        async setFonts(f) {
          const n = v => (Number.isFinite(Number(v)) && Number(v) >= 0.5 && Number(v) <= 2 ? Number(v) : 1);
          fontCfg = { fe: n(f?.fe), fp: n(f?.fp), sub: n(f?.sub), lab: n(f?.lab), sample: n(f?.sample) };
        },
        async setColors(colors) {
          const ok = colors && ["bg", "fg", "border", "accent"].every(k => /^#[0-9a-f]{6}$/i.test(colors[k] || ""));
          customColors = ok ? { ...colors } : null;
        },
        async start(css) {
          CSS = { frame: "", compose: "", addons: "", ...css };
          ExtensionSupport.registerWindowListener(LISTENER_ID, {
            chromeURLs: WINDOWS,
            onLoadWindow(win) {
              setupWindow(win, win.location.href == MAIN);
            },
          });
        },
      },
    };
  }
};
})();
