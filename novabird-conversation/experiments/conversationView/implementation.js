/* NovaBird-Conversation – Experiment: Standard-Nachrichtenkopf im Lesebereich ausblenden, Theme-Farben lesen.
 * Läuft im privilegierten Kontext (nur Betterbird / Thunderbird ESR).
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const HTML_NS = "http://www.w3.org/1999/xhtml";
const STYLE_ID = "novabird-conversation-style";
const ATTR = "novabird-conversation-active";
const HIDE_SELECTORS = ["#messageHeader", "#attachmentView", "#mail-notification-top [value=remoteContent]"];
const CSS = HIDE_SELECTORS.map(s => `:root[${ATTR}] ${s}`).join(",\n") + " { display: none !important; }\n";

// about:message-Dokument eines Tabs: im Dreispalten-Tab steckt es im messageBrowser, im Nachrichten-Tab ist es der Tab selbst.
function messageDocument(nativeTab) {
  const doc = nativeTab?.chromeBrowser?.contentDocument;
  if (!doc) {
    return null;
  }
  if (doc.URL.startsWith("about:3pane")) {
    return doc.getElementById("messageBrowser")?.contentDocument ?? null;
  }
  return doc.URL.startsWith("about:message") ? doc : null;
}

function setHidden(doc, hidden) {
  if (!doc?.documentElement) {
    return;
  }
  if (hidden && !doc.getElementById(STYLE_ID)) {
    const style = doc.createElementNS(HTML_NS, "style");
    style.id = STYLE_ID;
    style.textContent = CSS;
    (doc.head || doc.documentElement).appendChild(style);
  }
  if (hidden) {
    doc.documentElement.setAttribute(ATTR, "true");
  } else {
    doc.documentElement.removeAttribute(ATTR);
  }
}

// Wie Betterbird selbst (msgHdrView.js): Berechtigung "image" für das Prinzipal chrome://messenger/content/email=<Adresse>
const EMAIL_OK = /^[^\s<>"'\\]+@[^\s<>"'\\]+$/;
function senderPrincipal(email) {
  return Services.scriptSecurityManager.createContentPrincipal(Services.io.newURI("chrome://messenger/content/email=" + email), {});
}

// Zugeklappte Unterhaltung in der Nachrichtenliste: Betterbird wählt dann alle Nachrichten des Fadens aus und zeigt seine
// eigene Fadenübersicht (multimessage) statt der Nachricht, dort läuft unsere Ansicht nicht. Ist nur EINE Zeile gewählt,
// zeigen wir stattdessen die Nachricht dieser Zeile an (wie bei aufgeklapptem Faden). Echte Mehrfachauswahl bleibt unverändert.
const THREAD_LISTENER = "novabird-conversation-thread";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const MSG_VIEW_FLAG_DUMMY = 0x20000000;
const hooked = new Map(); // about:3pane-Fenster -> { mp, orig }
const winHooks = new Map(); // Hauptfenster -> { tm, onTab }

function hookPane(cw) {
  const mp = cw.messagePane;
  if (!mp || typeof mp.displayMessages !== "function" || hooked.has(cw)) {
    return;
  }
  const orig = mp.displayMessages;
  mp.displayMessages = function (...args) {
    try {
      const tree = cw.threadTree;
      if (tree && cw.gDBView && tree.selectedIndices.length === 1) {
        const idx = tree.selectedIndex;
        if (!(cw.gDBView.getFlagsAt(idx) & MSG_VIEW_FLAG_DUMMY)) {
          return this.displayMessage(cw.gDBView.getURIForViewIndex(idx));
        }
      }
    } catch (e) {
      console.error("NovaBird-Conversation:", e);
    }
    return orig.apply(this, args);
  };
  hooked.set(cw, { mp, orig });
}

function scanThreads(win, tries = 0) {
  let missing = false;
  for (const info of win.document.getElementById("tabmail")?.tabInfo ?? []) {
    const cw = info.chromeBrowser?.contentWindow;
    try {
      if (cw && cw.location.href === "about:3pane") {
        if (cw.document.readyState === "complete" && cw.messagePane) {
          hookPane(cw);
        } else {
          missing = true;
        }
      }
    } catch (e) {
      missing = true;
    }
  }
  if (missing && tries < 30) {
    win.setTimeout(() => scanThreads(win, tries + 1), 500);
  }
}

function hookThreadWindow(win) {
  const tm = win.document.getElementById("tabmail");
  if (!tm || winHooks.has(win)) {
    return;
  }
  const onTab = () => win.setTimeout(() => scanThreads(win), 300);
  winHooks.set(win, { tm, onTab });
  tm.tabContainer.addEventListener("TabOpen", onTab);
  tm.tabContainer.addEventListener("TabSelect", onTab);
  scanThreads(win);
}

function startThreadHook() {
  ExtensionSupport.registerWindowListener(THREAD_LISTENER, {
    chromeURLs: [MAIN_URL],
    onLoadWindow(win) {
      try {
        hookThreadWindow(win);
      } catch (e) {
        console.error("NovaBird-Conversation:", e);
      }
    },
  });
}

function stopThreadHook() {
  ExtensionSupport.unregisterWindowListener(THREAD_LISTENER);
  for (const [win, h] of winHooks) {
    try {
      h.tm.tabContainer.removeEventListener("TabOpen", h.onTab);
      h.tm.tabContainer.removeEventListener("TabSelect", h.onTab);
    } catch (e) {
      /* Fenster schon geschlossen */
    }
  }
  winHooks.clear();
  for (const [, h] of hooked) {
    try {
      h.mp.displayMessages = h.orig;
    } catch (e) {
      /* Tab schon geschlossen */
    }
  }
  hooked.clear();
}

this.conversationView = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    return {
      conversationView: {
        // Text in die Zwischenablage (Rechtsklick auf den Absender: Mailadresse kopieren); funktioniert ohne Benutzeraktion im Seitenskript
        async copyText(text) {
          try {
            Cc["@mozilla.org/widget/clipboardhelper;1"].getService(Ci.nsIClipboardHelper).copyString(String(text).slice(0, 500));
            return true;
          } catch (e) {
            return false;
          }
        },
        async startThreadHook() {
          startThreadHook();
        },
        async setHeaderHidden(tabId, hidden) {
          const tab = context.extension.tabManager.get(tabId);
          setHidden(messageDocument(tab?.nativeTab), !!hidden);
        },
        async getReferences(messageIds) {
          const out = {};
          for (const id of messageIds) {
            try {
              const hdr = context.extension.messageManager.get(id);
              const refs = [];
              for (let i = 0; i < hdr.numReferences; i++) {
                refs.push(hdr.getStringReference(i));
              }
              out[id] = refs;
            } catch (e) {
              out[id] = [];
            }
          }
          return out;
        },
        async getGlodaConversation(messageId) {
          if (!Services.prefs.getBoolPref("mailnews.database.global.indexer.enabled", true)) {
            return null; // globale Indexierung ausgeschaltet
          }
          let Gloda;
          try {
            Gloda = ChromeUtils.importESModule("resource:///modules/gloda/GlodaPublic.sys.mjs").Gloda;
          } catch (e) {
            return null;
          }
          const hdr = context.extension.messageManager.get(messageId);
          // Gloda-Abfrage mit eigenem Zeitlimit, damit nie etwas hängen bleibt
          const collect = start => new Promise(resolve => {
            let finished = false;
            const finish = value => {
              if (!finished) {
                finished = true;
                clearTimeout(timer);
                resolve(value);
              }
            };
            const timer = setTimeout(() => finish(null), 900);
            try {
              start({
                onItemsAdded() {},
                onItemsModified() {},
                onItemsRemoved() {},
                onQueryCompleted(collection) {
                  finish(collection.items ?? []);
                },
              });
            } catch (e) {
              finish(null);
            }
          });
          const first = await collect(listener => Gloda.getMessageCollectionForHeaders([hdr], listener, null));
          if (first === null) return null;
          if (!first.length) return [];
          const conversation = first[0].conversation;
          if (!conversation) return [];
          const items = await collect(listener => conversation.getMessagesCollection(listener, true));
          if (items === null) return null;
          const out = [];
          for (const item of items) {
            try {
              if (!item.folderMessage) continue;
              const converted = await context.extension.messageManager.convert(item.folderMessage);
              if (converted?.id != null) {
                out.push({ id: converted.id, snippet: String(item.indexedBodyText ?? "").replace(/\s+/g, " ").trim().slice(0, 200) });
              }
            } catch (e) {
              // diese Nachricht überspringen
            }
          }
          return out;
        },
        // Nachricht, die der Lesebereich wirklich zeigt (bei zugeklapptem Faden sind mehrere ausgewählt, dann liefert
        // messageDisplay.getDisplayedMessage null).
        async getDisplayedMessage(tabId) {
          try {
            const cw = context.extension.tabManager.get(tabId)?.nativeTab?.chromeBrowser?.contentWindow;
            const hdr = cw?.location.href.startsWith("about:3pane") ? cw.messageBrowser?.contentWindow?.gMessage : null;
            return hdr ? await context.extension.messageManager.convert(hdr) : null;
          } catch (e) {
            return null;
          }
        },
        async getMessageId(headerMessageId, accountId, path) {
          try {
            const folder = context.extension.folderManager.get(accountId, path);
            const hdr = folder?.msgDatabase?.getMsgHdrForMessageID(headerMessageId);
            return hdr ? (await context.extension.messageManager.convert(hdr)).id : null;
          } catch (e) {
            return null;
          }
        },
        async getOfflineState(messageIds) {
          const out = {};
          for (const id of messageIds) {
            try {
              const hdr = context.extension.messageManager.get(id);
              const type = hdr.folder?.server?.type;
              out[id] = type === "imap" || type === "nntp" ? !!(hdr.flags & Ci.nsMsgMessageFlags.Offline) : true;
            } catch (e) {
              out[id] = true;
            }
          }
          return out;
        },
        async getAllowedSenders(emails) {
          const out = [];
          for (const email of emails) {
            try {
              if (EMAIL_OK.test(email) && Services.perms.testPermissionFromPrincipal(senderPrincipal(email), "image") === Services.perms.ALLOW_ACTION) {
                out.push(email);
              }
            } catch (e) {
              // Adresse nicht prüfbar: nicht erlaubt
            }
          }
          return out;
        },
        async allowSender(email) {
          if (!EMAIL_OK.test(email)) {
            return false;
          }
          Services.perms.addFromPrincipal(senderPrincipal(email), "image", Services.perms.ALLOW_ACTION);
          return true;
        },
        async fetchImage(url) {
          try {
            if (!/^https?:\/\//i.test(url)) {
              return null;
            }
            // fetch/btoa gibt es im Experiment-Bereich nicht: das Hauptfenster (nur als Werkzeug, keine Fensterzuordnung) liefert sie
            const win = Services.wm.getMostRecentWindow("mail:3pane");
            if (!win) {
              return null;
            }
            const ctl = new win.AbortController();
            const timer = setTimeout(() => ctl.abort(), 10000);
            try {
              const res = await win.fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", cache: "no-store", redirect: "follow", signal: ctl.signal });
              const type = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
              if (!res.ok || !/^image\/(png|jpe?g|gif|webp)$/.test(type)) {
                return null;
              }
              const bytes = new Uint8Array(await res.arrayBuffer());
              if (bytes.length > 5 * 1024 * 1024) {
                return null;
              }
              let bin = "";
              for (let i = 0; i < bytes.length; i += 0x8000) {
                bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
              }
              return `data:${type};base64,${win.btoa(bin)}`;
            } finally {
              clearTimeout(timer);
            }
          } catch (e) {
            return null;
          }
        },
        async getThemeColors(tabId) {
          // Fenster des fragenden Tabs (nicht das zuletzt aktive), erst danach Rückfall
          let win = null;
          try {
            win = tabId == null ? null : context.extension.tabManager.get(tabId)?.nativeTab?.chromeBrowser?.ownerGlobal?.top ?? null;
          } catch (e) {
            win = null;
          }
          win ??= Services.wm.getMostRecentWindow("mail:3pane");
          if (!win) {
            return null;
          }
          const dark = win.matchMedia("(prefers-color-scheme: dark)").matches;
          const fb = dark
            ? { bg: "#1d1e22", border: "#2a2c31", accent: "#5b9dff" }
            : { bg: "#e6ecf5", border: "#d2dae6", accent: "#2f6bd8" };
          const chains = {
            bg: `var(--sidebar-background-color, ${fb.bg})`,
            border: `var(--sidebar-border-color, ${fb.border})`,
            accent: `var(--lwt-toolbarbutton-icon-fill-attention, var(--lwt-tab-line-color, var(--color-accent-primary, ${fb.accent})))`,
          };
          const doc = win.document;
          const probe = doc.createElementNS(HTML_NS, "span");
          (doc.body || doc.documentElement).appendChild(probe);
          try {
            const result = { dark };
            for (const [key, chain] of Object.entries(chains)) {
              probe.style.color = chain;
              result[key] = win.getComputedStyle(probe).color;
            }
            return result;
          } finally {
            probe.remove();
          }
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    stopThreadHook();
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      const tabmail = win.document.getElementById("tabmail");
      for (const info of tabmail?.tabInfo ?? []) {
        const doc = messageDocument(info);
        if (doc) {
          doc.getElementById(STYLE_ID)?.remove();
          doc.documentElement.removeAttribute(ATTR);
        }
      }
    }
  }
};
