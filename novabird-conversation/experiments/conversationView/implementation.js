/* NovaBird-Conversation – Experiment: Standard-Nachrichtenkopf im Lesebereich ausblenden, Theme-Farben lesen.
 * Läuft im privilegierten Kontext (nur Betterbird / Thunderbird ESR).
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { setTimeout, clearTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const HTML_NS = "http://www.w3.org/1999/xhtml";

// Gemeinsamer Code (shared/theme.js, shared/selftest.js im Paket), geladen in getAPI
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
  { feature: "threadHook", needs: "3pane", test: ({ cw }) => typeof cw.messagePane?.displayMessages === "function" && !!cw.threadTree && "gDBView" in cw },
  {
    feature: "hideHeader",
    needs: "3pane",
    test: ({ cw }) => {
      const doc = cw.messageBrowser?.contentDocument;
      return !doc || doc.readyState !== "complete" || (!!doc.getElementById("messageHeader") && !!doc.getElementById("attachmentView"));
    },
  },
  { feature: "noFlicker", needs: "3pane", test: ({ cw }) => typeof cw.messagePane?.displayMessage === "function" && !!cw.messageBrowser },
  { feature: "displayedMessage", needs: "3pane", test: ({ cw }) => !cw.messageBrowser?.contentWindow || "gMessage" in cw.messageBrowser.contentWindow },
  { feature: "gloda", needs: "none", test: ({ hasModule }) => hasModule("resource:///modules/gloda/GlodaPublic.sys.mjs") },
];
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

// Kein Aufblitzen des Originals (Stufe B, ab 0.14.7): Vor dem Laden einer ANDEREN Mail wird der Lesebereich unsichtbar
// (opacity, damit weiter gezeichnet wird und requestAnimationFrame läuft); die Ansicht meldet „reveal“, sobald die
// Konversation steht oder klar ist, dass das Original gezeigt wird. Sicherheitsfrist wie im Seitenskript (1,5 s).
const REVEAL_MAX_MS = 1500;
// „Thunderbird Conversations“ hängt sich an dieselben Stellen; beide zusammen stören sich (Hinweis mit Auswahl, nie ungefragt abschalten)
const OTHER_CONVERSATIONS_IDS = ["gconversation@xulforum.org"];
async function findOtherConversations() {
  const { AddonManager } = ChromeUtils.importESModule("resource://gre/modules/AddonManager.sys.mjs");
  const all = await AddonManager.getAddonsByTypes(["extension"]);
  return all.find(a => OTHER_CONVERSATIONS_IDS.includes(a.id) || /^thunderbird conversations$/i.test(String(a.name).trim())) ?? null;
}
const veiled = new Map(); // about:3pane-Fenster -> Timer
function veilPane(cw) {
  const b = cw.messageBrowser;
  if (!b) return;
  cw.clearTimeout(veiled.get(cw));
  b.style.opacity = "0";
  veiled.set(cw, cw.setTimeout(() => revealPane(cw), REVEAL_MAX_MS));
}
function revealPane(cw) {
  try {
    cw.clearTimeout(veiled.get(cw));
    veiled.delete(cw);
    if (cw.messageBrowser) cw.messageBrowser.style.opacity = "";
  } catch (e) {
    veiled.delete(cw); // Fenster schon geschlossen
  }
}

function hookPane(cw) {
  const mp = cw.messagePane;
  if (!mp || typeof mp.displayMessages !== "function" || hooked.has(cw)) {
    if (mp && typeof mp.displayMessages !== "function") nb.nbReportMissing?.("threadHook", "messagePane.displayMessages");
    return;
  }
  const orig = mp.displayMessages;
  const origOne = typeof mp.displayMessage === "function" ? mp.displayMessage : null;
  if (origOne) {
    mp.displayMessage = function (uri, ...rest) {
      try {
        // dieselbe Mail erneut gewählt: Betterbird lädt nichts neu, also auch nichts verstecken
        if (uri && uri !== cw.messageBrowser?.contentWindow?.gMessageURI) veilPane(cw);
      } catch (e) {
        console.error("NovaBird-Conversation:", e);
      }
      return origOne.call(this, uri, ...rest);
    };
  } else {
    nb.nbReportMissing?.("noFlicker", "messagePane.displayMessage");
  }
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
  // Geschlossene Tabs austragen, sonst hielte die Liste ihre Fenster bis zum Neustart im Speicher
  const onUnload = () => {
    hooked.delete(cw);
    veiled.delete(cw);
  };
  cw.addEventListener("unload", onUnload, { once: true });
  hooked.set(cw, { mp, orig, origOne, onUnload });
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
  const onUnload = () => winHooks.delete(win);
  winHooks.set(win, { tm, onTab, onUnload });
  win.addEventListener("unload", onUnload, { once: true });
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
      win.removeEventListener("unload", h.onUnload);
    } catch (e) {
      /* Fenster schon geschlossen */
    }
  }
  winHooks.clear();
  for (const [cw, h] of hooked) {
    try {
      cw.removeEventListener("unload", h.onUnload);
      h.mp.displayMessages = h.orig;
      if (h.origOne) h.mp.displayMessage = h.origOne;
      revealPane(cw);
    } catch (e) {
      /* Tab schon geschlossen */
    }
  }
  hooked.clear();
}

this.conversationView = class extends ExtensionCommon.ExtensionAPI {
  getAPI(context) {
    if (!nb.nbRunSelfTest) {
      try {
        nbLoadShared(context.extension, ["shared/theme.js", "shared/selftest.js"], nb);
      } catch (e) {
        console.error("NovaBird: gemeinsamer Code nicht geladen", e); // nur Selbsttest/Theme-Farben fehlen, Rest läuft
      }
    }
    return {
      conversationView: {
        // Selbsttest der Betterbird-Interna (siehe SELF_TEST); Ergebnis zeigt die Optionsseite
        async selfTest() {
          return nb.nbRunSelfTest?.(SELF_TEST) ?? null;
        },
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
        // Ansicht steht (oder das Original wird gezeigt): Lesebereich dieses Tabs wieder sichtbar machen
        async reveal(tabId) {
          try {
            const cw = context.extension.tabManager.get(tabId)?.nativeTab?.chromeBrowser?.contentWindow;
            if (cw && veiled.has(cw)) revealPane(cw);
          } catch (e) {
            /* Tab weg */
          }
        },
        async getOtherConversations() {
          const a = await findOtherConversations();
          return a ? { id: a.id, name: a.name, active: a.isActive } : null;
        },
        async disableOtherConversations() {
          const a = await findOtherConversations();
          if (!a || !a.isActive) return false;
          await a.disable();
          return true;
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
        // Anhang speichern wie die Anhangleiste von Thunderbird (Dateiauswahl, Name und Typ des Anhangs). Rechtsklick auf einen
        // Anhang in der Konversation bot sonst nur „Seite speichern“ (die ganze Mail als .eml).
        async saveAttachment(messageId, partName, name, contentType) {
          const hdr = context.extension.messageManager.get(messageId);
          if (!hdr || !/^[\d.]+$/.test(partName)) {
            return false;
          }
          const { AttachmentInfo } = ChromeUtils.importESModule("resource:///modules/AttachmentInfo.sys.mjs");
          const { getMsgPartUrl } = ChromeUtils.importESModule("resource:///modules/ExtensionMessages.sys.mjs");
          const info = new AttachmentInfo({
            contentType: contentType || "application/octet-stream",
            url: `${getMsgPartUrl(hdr, partName)}&filename=${encodeURIComponent(name)}`,
            name,
            uri: hdr.folder ? hdr.folder.getUriForMsg(hdr) : hdr.getStringProperty("dummyMsgUrl"),
            isExternalAttachment: false,
            message: hdr,
          });
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          return Boolean(await info.save(win.browsingContext));
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
          return nb.nbReadThemeColors?.(win);
        },
      },
    };
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    nbUnloadShared(this.extension);
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
