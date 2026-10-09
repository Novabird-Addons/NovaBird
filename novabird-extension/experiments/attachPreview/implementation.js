/* Anhang-Vorschau (NovaBird-Extension, privilegiert): beim Überfahren eines PDF- oder Bild-Anhangs erscheint nach kurzer
 * Verzögerung eine scrollbare Vorschau (pdf.js von Betterbird) neben dem Anhang.
 *  - Anhänge-Bereich in der rechten Leiste (Zeilen `.sa-row`, Daten in `data-pv-*`, gesetzt von novaCalendar)
 *  - Anhangsliste im Nachrichtenkopf (about:message, Liste und eingeklappte Einzelanzeige), in Mail-Tabs und im 3-Fenster-Tab
 *  - Konversations-Add-on: Anhang-Chips (`.nbc-chip`) im Nachrichtenfenster
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.attachPreview = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
const { MailE10SUtils } = ChromeUtils.importESModule("resource:///modules/MailE10SUtils.sys.mjs");
const { NetUtil } = ChromeUtils.importESModule("resource://gre/modules/NetUtil.sys.mjs");

const LISTENER = "novabird-extension-preview";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const HTML_NS = "http://www.w3.org/1999/xhtml";
const BOX_ID = "nbx-preview";
const STYLE_ID = "nbx-preview-style";
const GRACE = 300; // so lange darf der Zeiger zwischen Anhang und Vorschau wechseln

let enabled = true;
let delay = 400;
const states = new Map(); // Hauptfenster -> Zustand
const hooked = new WeakSet(); // bereits ausgestattete Dokumente

function T(de, en, fr, es) {
  const lang = (Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
  return ({ de, en, fr, es })[lang] ?? en;
}

const CSS = `
#${BOX_ID} {
  position: fixed; z-index: 100000; display: flex; flex-direction: column; overflow: hidden;
  background: var(--layout-background-0, Canvas); color: var(--layout-color-1, CanvasText);
  border: 1px solid var(--layout-border-1, ThreeDShadow); border-radius: 10px;
  box-shadow: 0 8px 28px rgba(0, 0, 0, .35);
}
#${BOX_ID}[hidden] { display: none; }
#${BOX_ID} .sp-head { display: flex; align-items: center; gap: 6px; padding: 5px 6px 5px 12px; flex: none;
  background: var(--layout-background-2, ButtonFace); border-bottom: 1px solid var(--layout-border-1, ThreeDShadow); }
#${BOX_ID} .sp-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
#${BOX_ID} .sp-head button { flex: none; margin: 0; min-width: 0; padding: 3px 10px; }
#${BOX_ID} browser { flex: 1; min-height: 0; background: #fff; }
`;

const PDF_RE = /\.pdf$|^application\/pdf/i;
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|avif)$|^image\/(png|jpe?g|gif|webp|bmp|avif)/i; // kein SVG (könnte Skripte enthalten)
const IMG_MAX = 15 * 1024 * 1024;
const IMG_TYPES = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp", avif: "image/avif" };

// Vorschaubare Anhänge: PDF und Bilder
function previewKind(name, type) {
  if (PDF_RE.test(name || "") || PDF_RE.test(type || "")) return "pdf";
  if (IMG_RE.test(name || "") || IMG_RE.test(type || "")) return "img";
  return null;
}

// Bilder: Bytes lesen und als data:-Adresse laden (mailbox:-Adressen zeigt ein Browser-Element für Bilder nicht an)
function imageDataUrl(win, url, name, type) {
  return new Promise((resolve, reject) => {
    const ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    const mime = /^image\/(png|jpe?g|gif|webp|bmp|avif)$/i.test(type) ? type.toLowerCase() : IMG_TYPES[ext];
    if (!mime) return reject(new Error("Bildtyp unbekannt"));
    const channel = NetUtil.newChannel({ uri: url, loadUsingSystemPrincipal: true });
    NetUtil.asyncFetch(channel, (stream, status) => {
      try {
        if (!(status === 0 || (status > 0 && status < 0x80000000))) throw new Error("Lesen fehlgeschlagen");
        if (stream.available() > IMG_MAX) throw new Error("Bild zu groß");
        resolve(`data:${mime};base64,` + win.btoa(NetUtil.readInputStreamToString(stream, stream.available())));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function withType(url, kind) {
  // TB 157 liefert die Adresse schon mit kodiertem "type=application%2Fpdf"; das lädt pdf.js nicht, es braucht die unkodierte Form
  if (kind === "pdf" && !/[?&]type=application\/pdf/i.test(url)) {
    return url + (url.includes("?") ? "&" : "?") + "type=application/pdf";
  }
  return url;
}

// Verschiebung eines Dokuments (auch in eingebetteten about:-Seiten) gegenüber dem Hauptfenster
function offsetToMain(docWin) {
  let x = 0, y = 0, w = docWin;
  while (w) {
    // Iframes: frameElement; Inhalts-Browser (Nachrichtenfenster, Konversationsansicht): embedderElement
    const el = w.frameElement || w.browsingContext?.embedderElement;
    if (!el) break;
    const r = el.getBoundingClientRect();
    x += r.left;
    y += r.top;
    w = el.ownerDocument.defaultView;
  }
  return { x, y };
}

// Was liegt unter dem Zeiger? -> { el, url, name, type } oder null (je nach Dokumentart)
function resolveTarget(doc, target, win) {
  if (!target?.closest) return null;
  // Konversations-Add-on: Chip ohne Adresse, der Anhang wird über Name und Absender der Karte gesucht
  const chip = target.closest(".nbc-chip");
  if (chip) {
    const name = (chip.firstChild?.textContent || "").replace(/^\s*\u{1F4CE}\s*/u, "").trim();
    const sender = chip.closest(".nbc-card")?.querySelector(".nbc-name")?.textContent?.trim() || "";
    return { el: chip, name, type: "", lazy: () => findChipAttachment(win, name, sender) };
  }
  const row = target.closest(".sa-row");
  if (row?.dataset?.pvUrl) {
    return { el: row, url: row.dataset.pvUrl, name: row.dataset.pvName || "", type: row.dataset.pvType || "" };
  }
  const item = target.closest("#attachmentList > richlistitem");
  if (item?.attachment?.url && !item.attachment.isDeleted) {
    const a = item.attachment;
    return { el: item, url: a.url, name: a.name || "", type: a.contentType || "" };
  }
  // eingeklappter Anhangbereich mit genau einem Anhang
  const label = target.closest("#attachmentName, #attachmentSize, #attachmentCount");
  if (label) {
    const list = doc.getElementById("attachmentList");
    if (list?.children.length === 1 && list.firstElementChild.attachment?.url) {
      const a = list.firstElementChild.attachment;
      return { el: label, url: a.url, name: a.name || "", type: a.contentType || "" };
    }
  }
  return null;
}

// Anhang zu einem Chip der Konversationsansicht: gleicher Name in der Unterhaltung (bei mehreren: gleicher Absender)
async function findChipAttachment(win, name, sender) {
  const hdr = currentHdr(win);
  if (!hdr || !name) return null;
  const members = await conversationHdrs(win, hdr);
  const hits = [];
  for (const m of members) {
    for (const a of await hdrAttachments(m)) {
      if (a.name === name && a.url) hits.push({ a, m });
    }
  }
  const best = hits.find(h => senderName(h.m) === sender) || hits[0];
  return best ? { url: best.a.url, name: best.a.name, type: best.a.contentType || "" } : null;
}

function stateOf(win) {
  let st = states.get(win);
  if (st) return st;
  st = { win, box: null, browser: null, showTimer: 0, hideTimer: 0, current: null, cleanups: [], docCleanups: new Map() };
  states.set(win, st);
  return st;
}

function ensureBox(st) {
  if (st.box) return st.box;
  const doc = st.win.document;
  const style = doc.createElementNS(HTML_NS, "style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
  const box = doc.createElementNS(HTML_NS, "div");
  box.id = BOX_ID;
  box.hidden = true;
  const title = doc.createElementNS(HTML_NS, "span");
  title.className = "sp-title";
  const open = doc.createElementNS(HTML_NS, "button");
  open.type = "button";
  open.textContent = T("Öffnen", "Open", "Ouvrir", "Abrir");
  const close = doc.createElementNS(HTML_NS, "button");
  close.type = "button";
  close.textContent = "✕";
  close.title = T("Schließen", "Close", "Fermer", "Cerrar");
  const head = doc.createElementNS(HTML_NS, "div");
  head.className = "sp-head";
  head.append(title, open, close);
  box.append(head);
  doc.documentElement.appendChild(box);
  box.addEventListener("mouseenter", () => st.win.clearTimeout(st.hideTimer));
  box.addEventListener("mouseleave", () => scheduleHide(st));
  close.addEventListener("click", () => hide(st));
  open.addEventListener("click", () => {
    const cur = st.current;
    hide(st);
    if (!cur) return;
    try {
      const tabmail = st.win.document.getElementById("tabmail");
      tabmail.openTab("contentTab", { url: cur.data || withType(cur.url, cur.kind), background: false, linkHandler: "single-page" });
    } catch (e) {
      console.error("NovaBird-Extension: Vorschau öffnen", e);
    }
  });
  st.box = box;
  st.title = title;
  return box;
}

// Pro Vorschau ein frisches Browser-Element (ein wiederverwendetes zeigt nach dem Wechsel zwischen Dokumenten nichts an)
function freshBrowser(st) {
  dropBrowser(st);
  const doc = st.win.document;
  const browser = doc.createXULElement("browser");
  browser.setAttribute("type", "content");
  browser.setAttribute("maychangeremoteness", "true");
  browser.setAttribute("messagemanagergroup", "single-page");
  browser.setAttribute("nodefaultsrc", "true");
  browser.setAttribute("disablehistory", "true");
  browser.setAttribute("context", "aboutPagesContext");
  st.box.appendChild(browser);
  st.browser = browser;
  return browser;
}

function dropBrowser(st) {
  try { st.browser?.remove(); } catch (e) { /* schon weg */ }
  st.browser = null;
}

function hide(st) {
  st.token = (st.token || 0) + 1;
  st.win.clearTimeout(st.showTimer);
  st.win.clearTimeout(st.hideTimer);
  if (!st.box || st.box.hidden) {
    st.current = null;
    return;
  }
  st.box.hidden = true;
  st.current = null;
  dropBrowser(st);
}

function scheduleHide(st) {
  st.win.clearTimeout(st.hideTimer);
  st.hideTimer = st.win.setTimeout(() => hide(st), GRACE);
}

function show(st, t, rect, pointer) {
  if (!enabled) return;
  const kind = previewKind(t.name, t.type);
  if (!kind) return;
  const win = st.win;
  const box = ensureBox(st);
  win.clearTimeout(st.hideTimer);
  const W = win.innerWidth, H = win.innerHeight;
  const w = Math.round(Math.min(640, Math.max(380, W * 0.42)));
  const wide = rect.width > W * 0.5;
  let h, left, top;
  if (wide) {
    // breiter Anhang-Streifen unten: Vorschau darüber
    h = Math.round(Math.min(780, Math.max(200, rect.top - 16)));
    left = pointer.x - w / 2;
    top = rect.top - h - 8;
  } else {
    h = Math.round(Math.min(780, H - 24));
    left = rect.left + rect.width / 2 > W / 2 ? rect.left - w - 10 : rect.right + 10;
    top = rect.top + rect.height / 2 - h / 2;
  }
  left = Math.max(6, Math.min(left, W - w - 6));
  top = Math.max(6, Math.min(top, H - h - 6));
  box.style.cssText = `left:${Math.round(left)}px; top:${Math.round(top)}px; width:${w}px; height:${h}px;`;
  const changed = !st.current || st.current.url !== t.url;
  st.current = { url: t.url, kind };
  st.title.textContent = t.name;
  box.hidden = false;
  if (changed) {
    const token = (st.token = (st.token || 0) + 1);
    const fail = e => {
      console.error("NovaBird-Extension: Vorschau laden", e);
      if (st.token === token) hide(st);
    };
    try {
      if (kind === "img") {
        imageDataUrl(win, t.url, t.name, t.type).then(data => {
          if (st.token === token && st.current?.url === t.url) {
            st.current.data = data;
            MailE10SUtils.loadURI(freshBrowser(st), data);
          }
        }, fail);
      } else {
        MailE10SUtils.loadURI(freshBrowser(st), withType(t.url, kind));
      }
    } catch (e) {
      fail(e);
    }
  }
}

// Mausereignisse eines Dokuments (Hauptfenster oder about:message) auswerten
function hookDocument(st, doc) {
  if (!doc || hooked.has(doc)) return;
  hooked.add(doc);
  const docWin = doc.defaultView;
  const win = st.win;
  const onOver = e => {
    if (!enabled) return;
    const t = resolveTarget(doc, e.target, win);
    if (!t) return;
    win.clearTimeout(st.hideTimer);
    if (t.url && st.current && st.current.url === t.url && !st.box.hidden) return;
    win.clearTimeout(st.showTimer);
    const off = offsetToMain(docWin);
    const r = t.el.getBoundingClientRect();
    const rect = { left: r.left + off.x, right: r.right + off.x, top: r.top + off.y, bottom: r.bottom + off.y, width: r.width, height: r.height };
    const pointer = { x: e.clientX + off.x, y: e.clientY + off.y };
    st.showTimer = win.setTimeout(async () => {
      let target = t;
      if (t.lazy) {
        try { target = await t.lazy(); } catch (err) { target = null; }
        if (!target || st.hoverEl !== t.el) return;
      }
      show(st, target, rect, pointer);
    }, delay);
    st.hoverEl = t.el;
  };
  const onOut = e => {
    const t = resolveTarget(doc, e.target, win);
    if (!t) return;
    if (e.relatedTarget && t.el.contains(e.relatedTarget)) return;
    win.clearTimeout(st.showTimer);
    st.hoverEl = null;
    scheduleHide(st);
  };
  const onDown = e => {
    if (resolveTarget(doc, e.target, win)) hide(st);
  };
  doc.addEventListener("mouseover", onOver, true);
  doc.addEventListener("mouseout", onOut, true);
  doc.addEventListener("mousedown", onDown, true);
  st.docCleanups.set(doc, () => {
    doc.removeEventListener("mouseover", onOver, true);
    doc.removeEventListener("mouseout", onOut, true);
    doc.removeEventListener("mousedown", onDown, true);
    hooked.delete(doc);
  });
}

// Dokumente, die ersetzt wurden (z. B. Konversationsansicht bei jeder neuen Nachricht), nicht festhalten
function pruneDocs(st) {
  for (const doc of [...st.docCleanups.keys()]) {
    let alive = false;
    try { alive = !!doc.defaultView && !doc.defaultView.closed; } catch (e) { alive = false; }
    if (!alive) st.docCleanups.delete(doc);
  }
}

// Alle about:message-Dokumente der Tabs (3-Fenster-Tab: messageBrowser; Nachrichten-Tab: der Tab selbst)
function scanTabs(st) {
  try {
    const tabmail = st.win.document.getElementById("tabmail");
    for (const tab of tabmail?.tabInfo || []) {
      const w = tab.chromeBrowser?.contentWindow;
      if (!w) continue;
      const href = w.location?.href || "";
      let messageWin = null;
      if (href.startsWith("about:3pane")) {
        messageWin = w.messageBrowser?.contentWindow;
      } else if (href.startsWith("about:message")) {
        messageWin = w;
      }
      if (messageWin) {
        hookDocument(st, messageWin.document);
        // Konversations-Add-on: sein Inhalt ersetzt bei jeder Anzeige das Dokument des Nachrichtenfensters
        hookDocument(st, messageWin.getMessagePaneBrowser?.()?.contentDocument);
      }
    }
  } catch (e) {
    // Tabs noch nicht bereit
  }
  pruneDocs(st);
}

function setupWindow(win) {
  const st = stateOf(win);
  if (st.timer) return;
  hookDocument(st, win.document);
  scanTabs(st);
  st.timer = win.setInterval(() => scanTabs(st), 800);
  const onTab = () => hide(st);
  const tabmail = win.document.getElementById("tabmail");
  tabmail?.addEventListener("TabSelect", onTab);
  const onKey = e => { if (e.key === "Escape") hide(st); };
  win.addEventListener("keydown", onKey, true);
  st.cleanups.push(() => {
    tabmail?.removeEventListener("TabSelect", onTab);
    win.removeEventListener("keydown", onKey, true);
    win.clearInterval(st.timer);
    st.timer = 0;
  });
}

function teardownWindow(win) {
  const st = states.get(win);
  if (!st) return;
  hide(st);
  for (const fn of st.cleanups) {
    try { fn(); } catch (e) { /* Fenster schon geschlossen */ }
  }
  st.cleanups = [];
  for (const fn of st.docCleanups.values()) {
    try { fn(); } catch (e) { /* Dokument schon weg */ }
  }
  st.docCleanups.clear();
  st.box?.remove();
  win.document.getElementById(STYLE_ID)?.remove();
  states.delete(win);
}

function startAll() {
  ExtensionSupport.registerWindowListener(LISTENER, {
    chromeURLs: [MAIN_URL],
    onLoadWindow(win) {
      try { setupWindow(win); } catch (e) { console.error("NovaBird-Extension: Vorschau", e); }
    },
  });
}

function stopAll() {
  ExtensionSupport.unregisterWindowListener(LISTENER);
  for (const win of [...states.keys()]) teardownWindow(win);
}

let started = false;

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown && started) {
      started = false;
      stopAll();
    }
  }

  getAPI() {
    return {
      attachPreview: {
        async setEnabled(on) {
          enabled = !!on;
          if (enabled && !started) {
            started = true;
            startAll();
          } else if (!enabled) {
            for (const st of states.values()) hide(st);
          }
        },
        async setDelay(ms) {
          const n = Math.round(Number(ms));
          delay = n >= 0 && n <= 3000 ? n : 400;
        },
      },
    };
  }
};

return API;
})();
