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

function isDark(color) {
  // Computed color-mix() liefert in neueren Gecko-Versionen "color(srgb 0.1 0.2 0.3)" (Werte 0..1), sonst "rgb(r, g, b)"
  const n = (String(color).match(/-?\d*\.?\d+/g) || []).map(Number);
  if (n.length >= 3 && /^\s*color\(/.test(color)) {
    return (0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2]) * 255 < 128;
  }
  if (n.length >= 3 && /^\s*rgba?\(/.test(color)) {
    return (0.299 * n[0] + 0.587 * n[1] + 0.114 * n[2]) < 128;
  }
  const h = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(color);
  return h ? (0.299 * parseInt(h[1], 16) + 0.587 * parseInt(h[2], 16) + 0.114 * parseInt(h[3], 16)) < 128 : false;
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
  return CSS.shell + "\n" + tokenCss();
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

const HUB_ORDER = ["search", "db", "conversation", "send", "extension"];
const HUB_LABEL = {
  search: tr("Suche", "Search", "Recherche", "Búsqueda"),
  db: tr("Datenbank", "Database", "Base de données", "Base de datos"),
  conversation: tr("Konversation", "Conversation", "Conversation", "Conversación"),
  send: tr("Senden", "Send", "Envoi", "Envío"),
  extension: "Extension",
};
let hubLast = null; // zuletzt gewählter Reiter (bleibt beim erneuten Öffnen erhalten)

/** Aktive NovaBird-Add-ons mit Optionsseite, in fester Reihenfolge; unbekannte (`…@novabird`) folgen. */
function hubAddons() {
  const found = new Map();
  for (const p of WebExtensionPolicy.getActiveExtensions()) {
    const m = /^novabird-([a-z0-9-]+)@novabird$/.exec(p.id);
    const page = p.extension?.manifest?.options_ui?.page;
    if (!m || !page) {
      continue;
    }
    found.set(m[1], { id: p.id, key: m[1], label: HUB_LABEL[m[1]] || m[1], url: p.getURL(page), icon: p.getURL("icons/icon-48.png") });
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
  const onPane = () => {
    for (const page of pages.values()) {
      if (page.browser && !page.box.hidden) {
        applyScheme(page.browser);
      }
    }
  };
  doc.addEventListener("paneSelected", onPane);
  undo.push(() => {
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

function setupWindow(win, isMain) {
  const undo = [];
  perWindow.set(win, undo);

  const hide = win.document.createElement("style");
  hide.textContent = HIDE_CSS;
  win.document.documentElement.append(hide);
  undo.push(() => hide.remove());

  if (win.location.href.endsWith("messengercompose.xhtml")) {
    addStyle(win.document, shellCss() + CSS.compose, undo);
    moveRecipientToggles(win, undo);
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

function teardown() {
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
    ExtensionSupport.unregisterWindowListener(LISTENER_ID);
    teardown();
  }

  getAPI(context) {
    hubIcon = context.extension.getURL("icons/icon-48.png");
    return {
      settingsRedesign: {
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
