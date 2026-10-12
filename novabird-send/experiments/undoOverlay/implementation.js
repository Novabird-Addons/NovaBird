/* NovaBird-Send – Experiment: Overlay im Hauptfenster, Fenster verstecken, Beenden abfangen.
 * Läuft im privilegierten Kontext (nur Betterbird / Thunderbird ESR).
 * TODO (Claude Code): alle Stellen mit "PRÜFEN" gegen die laufende Betterbird-Version testen.
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionCommon.sys.mjs"
);
var { ExtensionSupport } = ChromeUtils.importESModule(
  "resource:///modules/ExtensionSupport.sys.mjs"
);

const HTML_NS = "http://www.w3.org/1999/xhtml";
const OVERLAY_ID = "novabird-send-overlay";
const STACK_ID = "novabird-send-stack";
const NOTICES_ID = "novabird-send-notices";
const STYLE_ID = "novabird-send-style";
const LISTENER_NAME = "novabird-send-windows";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const COMPOSE_URL = "chrome://messenger/content/messengercompose/messengercompose.xhtml";
const DELIVER_MODE_KEY = "novabirdSendDeliverMode";

const BAR_MIN_OPACITY = 0.15; // Deckkraft des Zeitbalkens, kurz bevor er leer ist (Stil "soft")

const SCALES = { small: 0.85, normal: 1, large: 1.25, xlarge: 1.5 };
const ALIGN = {
  left: { left: "24px", right: "auto", tx: "0", origin: "bottom left" },
  center: { left: "50%", right: "auto", tx: "-50%", origin: "bottom center" },
  right: { left: "auto", right: "24px", tx: "0", origin: "bottom right" },
};
const DEFAULT_STYLE = {
  size: "normal", horizontal: "center", bottom: 10, barHeight: 10, barStyle: "soft", palette: null,
};
const PALETTE_VARS = {
  bg: "--sp-bg",
  fg: "--sp-fg",
  muted: "--sp-muted",
  border: "--sp-border",
  accent: "--sp-accent",
  track: "--sp-track",
  undo: "--sp-undo",
  onAccent: "--sp-on-accent",
  onUndo: "--sp-on-undo",
};
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

// Übersetzte Texte kommen per setStrings vom Hintergrundskript; bis dahin englische Rückfallwerte.
const DEFAULT_STRINGS = {
  waiting: "Sending shortly",
  sending: "Sending …",
  queued: "{n} more in queue",
  undo: "Undo",
  sendNow: "Send now",
  ok: "OK",
};

// Werte kommen von der Erweiterung, werden aber vor dem Einsetzen in CSS erneut geprüft.
function sanitizeStyle(raw) {
  const r = raw || {};
  const clamp = (v, min, max, fallback) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  return {
    size: r.size in SCALES ? r.size : DEFAULT_STYLE.size,
    horizontal: r.horizontal in ALIGN ? r.horizontal : DEFAULT_STYLE.horizontal,
    bottom: clamp(r.bottom, 0, 40, DEFAULT_STYLE.bottom),
    barHeight: clamp(r.barHeight, 4, 20, DEFAULT_STYLE.barHeight),
    barStyle: r.barStyle === "classic" ? "classic" : "soft",
    // Nur gültige #rrggbb-Werte übernehmen (landen später in CSS)
    palette: r.palette
      ? Object.fromEntries(
          Object.keys(PALETTE_VARS)
            .filter(key => HEX_COLOR.test(r.palette[key]))
            .map(key => [key, r.palette[key]])
        )
      : null,
  };
}

const CSS = `
#${STACK_ID} {
  /* Standardfarben; die fertig berechnete Palette setzt ensureStack() per setStyle */
  --sp-bg: #e6ecf5;
  --sp-fg: #1e2838;
  --sp-border: #d2dae6;
  --sp-accent: #2f6bd8;
  --sp-track: #c5d5f0;
  --sp-muted: #6a7280;
  --sp-undo: #c9403d;
  --sp-on-accent: #ffffff;
  --sp-on-undo: #ffffff;
  position: fixed;
  left: var(--sp-left, 50%);
  right: var(--sp-right, auto);
  bottom: var(--sp-bottom, 10vh);
  transform: translateX(var(--sp-tx, -50%)) scale(var(--sp-scale, 1));
  transform-origin: var(--sp-origin, bottom center);
  z-index: 2147483000;
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 340px;
  max-width: min(560px, calc(90vw / var(--sp-scale, 1)));
  font: menu;
  font-size: 13px;
}
#${NOTICES_ID} { order: 1; display: flex; flex-direction: column; gap: 8px; }
#${OVERLAY_ID} {
  order: 2;
  background: var(--sp-bg);
  color: var(--sp-fg);
  border: 1px solid var(--sp-border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(20, 40, 80, 0.18);
  overflow: hidden;
}
#${OVERLAY_ID} .sp-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px 12px 16px;
}
#${OVERLAY_ID} .sp-text { flex: 1; min-width: 0; }
#${OVERLAY_ID} .sp-status { color: var(--sp-muted); font-size: 12px; }
#${OVERLAY_ID} .sp-subject {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${OVERLAY_ID} button {
  font: inherit;
  border-radius: 6px;
  padding: 5px 12px;
  cursor: pointer;
  border: 1px solid var(--sp-border);
  background: transparent;
  color: var(--sp-fg);
}
#${OVERLAY_ID} button.sp-undo {
  background: var(--sp-undo);
  border-color: var(--sp-undo);
  color: var(--sp-on-undo);
  font-weight: 600;
}
#${OVERLAY_ID} button:disabled { opacity: 0.5; cursor: default; }
#${OVERLAY_ID} button:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 2px; }
/* Zeitbalken: Dicke kommt aus --sp-track-h */
#${OVERLAY_ID} .sp-track { height: var(--sp-track-h, 14px); background: var(--sp-track); }
#${OVERLAY_ID} .sp-bar { height: 100%; width: 100%; background: var(--sp-accent); }
/* Stil "soft": Schiene geht nach oben weich ins Overlay über, der Balken läuft rechts weich aus */
#${OVERLAY_ID}.sp-soft .sp-track {
  background: linear-gradient(to bottom, transparent, var(--sp-track) 70%);
}
#${OVERLAY_ID}.sp-soft .sp-bar {
  mask-image: linear-gradient(to right, #000 calc(100% - 70px), transparent),
    linear-gradient(to bottom, transparent, #000 70%);
  mask-composite: intersect;
}
#${NOTICES_ID} .sp-notice {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 14px;
  background: var(--sp-bg);
  color: var(--sp-fg);
  border: 1px solid var(--sp-border);
  border-left: 4px solid var(--sp-accent);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(20, 40, 80, 0.18);
}
#${NOTICES_ID} .sp-notice-text { flex: 1; min-width: 0; }
#${NOTICES_ID} .sp-notice-subject {
  font-weight: 600;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
#${NOTICES_ID} button {
  font: inherit;
  border-radius: 6px;
  padding: 5px 16px;
  cursor: pointer;
  background: var(--sp-accent);
  border: 1px solid var(--sp-accent);
  color: var(--sp-on-accent);
  font-weight: 600;
}
#${NOTICES_ID} button:focus-visible { outline: 2px solid var(--sp-accent); outline-offset: 2px; }
@media (prefers-reduced-motion: reduce) {
  #${OVERLAY_ID} .sp-bar { transition: none !important; }
}
`;

var undoOverlay = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }
    ExtensionSupport.unregisterWindowListener(LISTENER_NAME);
    for (const win of Services.wm.getEnumerator("msgcompose")) {
      unwrapCompose(win);
    }
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      win.document.getElementById(STACK_ID)?.remove();
      if (this._onCloseMain) {
        win.removeEventListener("close", this._onCloseMain);
      }
    }
    if (this._quitObserver) {
      Services.obs.removeObserver(this._quitObserver, "quit-application-requested");
    }
  }

  getAPI(context) {
    const self = this;
    const emitter = new ExtensionCommon.EventEmitter();
    let pendingCount = 0;
    let bypassClose = false;
    let current = null; // { subject, endsAt, seconds, queued, sending }
    let notices = [];   // Hinweise mit OK-Button: { subject, text }
    let style = { ...DEFAULT_STYLE };
    let strings = { ...DEFAULT_STRINGS };

    // Gemeinsamer Container für Hinweise (oben) und Overlay (unten): Position, Größe, Farben.
    const ensureStack = doc => {
      ensureStyle(doc);
      let stack = doc.getElementById(STACK_ID);
      if (!stack) {
        stack = doc.createElementNS(HTML_NS, "div");
        stack.id = STACK_ID;
        (doc.body || doc.documentElement).appendChild(stack);
      }
      const a = ALIGN[style.horizontal];
      const set = (name, value) => stack.style.setProperty(name, value);
      set("--sp-left", a.left);
      set("--sp-right", a.right);
      set("--sp-tx", a.tx);
      set("--sp-origin", a.origin);
      set("--sp-scale", String(SCALES[style.size]));
      set("--sp-bottom", `${style.bottom}vh`);
      // Stil "soft" braucht 4px Platz für den weichen Übergang nach oben.
      for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
        if (style.palette?.[key]) {
          set(cssVar, style.palette[key]);
        }
      }
      set("--sp-track-h", `${style.barHeight + (style.barStyle === "soft" ? 4 : 0)}px`);
      return stack;
    };

    const getWindow = windowId =>
      context.extension.windowManager.get(windowId, context).window;

    // PRÜFEN: Funktioniert das Verstecken unter Windows zuverlässig?
    // Fallback-Idee: Fenster minimieren und aus dem sichtbaren Bereich schieben.
    const setVisible = (win, visible) => {
      const baseWin = win.docShell.treeOwner.QueryInterface(Ci.nsIBaseWindow);
      baseWin.visibility = visible;
      if (visible) {
        win.focus();
      }
    };

    const renderNotices = win => {
      const doc = win.document;
      doc.getElementById(NOTICES_ID)?.remove();
      if (!notices.length) {
        pruneStack(doc);
        return;
      }
      const stack = ensureStack(doc);
      const el = tag => doc.createElementNS(HTML_NS, tag);
      const box = el("div");
      box.id = NOTICES_ID;
      for (const item of notices) {
        const row = el("div");
        row.className = "sp-notice";
        row.setAttribute("role", "alert");
        const text = el("div");
        text.className = "sp-notice-text";
        const subject = el("div");
        subject.className = "sp-notice-subject";
        subject.textContent = item.subject;
        subject.title = item.subject;
        const message = el("div");
        message.textContent = item.text;
        text.append(subject, message);
        const ok = el("button");
        ok.textContent = strings.ok;
        ok.addEventListener("click", () => {
          notices = notices.filter(n => n !== item);
          for (const w of Services.wm.getEnumerator("mail:3pane")) {
            renderNotices(w);
          }
        });
        row.append(text, ok);
        box.append(row);
      }
      stack.appendChild(box);
    };

    const render = win => {
      removeOverlay(win);
      renderNotices(win);
      if (!current) {
        return;
      }
      const doc = win.document;
      const stack = ensureStack(doc);

      const el = tag => doc.createElementNS(HTML_NS, tag);
      const box = el("div");
      box.id = OVERLAY_ID;
      box.className = `sp-${style.barStyle}`;
      box.setAttribute("role", "status");

      const row = el("div");
      row.className = "sp-row";

      const text = el("div");
      text.className = "sp-text";
      const status = el("div");
      status.className = "sp-status";
      status.id = `${OVERLAY_ID}-status`;
      status.textContent = statusText();
      const subject = el("div");
      subject.className = "sp-subject";
      subject.textContent = current.subject;
      subject.title = current.subject;
      text.append(status, subject);

      const undo = el("button");
      undo.className = "sp-undo";
      undo.textContent = strings.undo;
      undo.disabled = current.sending;
      undo.addEventListener("click", () => emitter.emit("undo"));

      const now = el("button");
      now.className = "sp-now";
      now.textContent = strings.sendNow;
      now.disabled = current.sending;
      now.addEventListener("click", () => emitter.emit("sendnow"));

      row.append(text, undo, now);

      const track = el("div");
      track.className = "sp-track";
      const bar = el("div");
      bar.className = "sp-bar";
      track.append(bar);

      box.append(row, track);
      stack.appendChild(box);

      // Zeitbalken: Restzeit berechnen, damit ein neu geöffnetes Fenster korrekt weiterläuft.
      const remaining = Math.max(0, current.endsAt - Date.now());
      const fraction = remaining / (current.seconds * 1000);
      bar.style.width = `${fraction * 100}%`;
      const fades = style.barStyle === "soft";
      if (fades) {
        bar.style.opacity = String(BAR_MIN_OPACITY + (1 - BAR_MIN_OPACITY) * fraction);
      }
      if (!current.sending) {
        win.requestAnimationFrame(() =>
          win.requestAnimationFrame(() => {
            bar.style.transition = fades
              ? `width ${remaining}ms linear, opacity ${remaining}ms linear`
              : `width ${remaining}ms linear`;
            bar.style.width = "0%";
            if (fades) {
              bar.style.opacity = String(BAR_MIN_OPACITY);
            }
          })
        );
      }
    };

    const statusText = () => {
      if (!current) {
        return "";
      }
      const base = current.sending ? strings.sending : strings.waiting;
      return current.queued > 0
        ? `${base} · ${strings.queued.replace("{n}", current.queued)}`
        : base;
    };

    const renderAll = () => {
      for (const win of Services.wm.getEnumerator("mail:3pane")) {
        render(win);
      }
    };

    // Schließen des letzten Hauptfensters abfangen, solange Mails zurückgehalten werden.
    this._onCloseMain = event => {
      if (bypassClose || pendingCount === 0) {
        return;
      }
      const mains = [...Services.wm.getEnumerator("mail:3pane")];
      if (mains.length > 1) {
        return;
      }
      event.preventDefault();
      emitter.emit("shutdown", "close");
    };

    // Beenden der Anwendung abfangen.
    // PRÜFEN: Reihenfolge gegenüber dem eigenen Abfang der Verfassen-Fenster ("Änderungen speichern?").
    this._quitObserver = {
      observe(subject, topic) {
        if (topic !== "quit-application-requested" || pendingCount === 0) {
          return;
        }
        subject.QueryInterface(Ci.nsISupportsPRBool);
        if (subject.data) {
          return; // jemand anderes hat bereits abgebrochen
        }
        subject.data = true;
        emitter.emit("shutdown", "quit");
      },
    };
    Services.obs.addObserver(this._quitObserver, "quit-application-requested");

    ExtensionSupport.registerWindowListener(LISTENER_NAME, {
      chromeURLs: [MAIN_URL, COMPOSE_URL],
      onLoadWindow(win) {
        if (win.location.href === COMPOSE_URL) {
          wrapCompose(win);
          return;
        }
        win.addEventListener("close", self._onCloseMain);
        render(win);
      },
      onUnloadWindow(win) {
        if (win.location.href === COMPOSE_URL) {
          return;
        }
        win.removeEventListener("close", self._onCloseMain);
      },
    });

    const makeEvent = (name, emitName) =>
      new ExtensionCommon.EventManager({
        context,
        name: `undoOverlay.${name}`,
        register(fire) {
          const listener = (event, ...args) => fire.async(...args);
          emitter.on(emitName, listener);
          return () => emitter.off(emitName, listener);
        },
      }).api();

    return {
      undoOverlay: {
        async hideComposeWindow(windowId) {
          setVisible(getWindow(windowId), false);
        },
        async showComposeWindow(windowId) {
          setVisible(getWindow(windowId), true);
        },
        async getThemeColors() {
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          if (!win) {
            return null;
          }
          const dark = win.matchMedia("(prefers-color-scheme: dark)").matches;
          const fb = dark
            ? { bg: "#1d1e22", fg: "#dadde3", border: "#2a2c31", accent: "#5b9dff" }
            : { bg: "#e6ecf5", fg: "#1e2838", border: "#d2dae6", accent: "#2f6bd8" };
          const chains = {
            bg: `var(--sidebar-background-color, ${fb.bg})`,
            fg: `var(--sidebar-text-color, ${fb.fg})`,
            border: `var(--sidebar-border-color, ${fb.border})`,
            accent: `var(--lwt-toolbarbutton-icon-fill-attention, var(--lwt-tab-line-color, var(--color-accent-primary, ${fb.accent})))`,
          };
          const doc = win.document;
          const probe = doc.createElementNS(HTML_NS, "span");
          (doc.body || doc.documentElement).appendChild(probe);
          try {
            const result = {};
            for (const [key, chain] of Object.entries(chains)) {
              probe.style.color = chain;
              result[key] = win.getComputedStyle(probe).color;
            }
            return result;
          } finally {
            probe.remove();
          }
        },
        async setStrings(raw) {
          for (const key of Object.keys(DEFAULT_STRINGS)) {
            if (typeof raw?.[key] === "string" && raw[key]) {
              strings[key] = raw[key];
            }
          }
          renderAll();
        },
        async setStyle(raw) {
          style = sanitizeStyle(raw);
          renderAll();
        },
        async showNotice({ subject, text }) {
          notices.push({ subject, text });
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            renderNotices(win);
          }
        },
        async getSendInfo(windowId) {
          const win = getWindow(windowId);
          return {
            deliverMode: win[DELIVER_MODE_KEY] ?? null,
            offline: isOffline(),
          };
        },
        async showOverlay({ subject, seconds, queued }) {
          current = {
            subject,
            seconds,
            queued,
            sending: false,
            endsAt: Date.now() + seconds * 1000,
          };
          renderAll();
        },
        async setSending() {
          if (current) {
            current.sending = true;
            renderAll();
          }
        },
        async updateQueued(queued) {
          if (!current) {
            return;
          }
          current.queued = queued;
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            const status = win.document.getElementById(`${OVERLAY_ID}-status`);
            if (status) {
              status.textContent = statusText();
            }
          }
        },
        async hideOverlay() {
          current = null;
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            removeOverlay(win);
          }
        },
        async setPendingCount(count) {
          pendingCount = count;
        },
        async proceedShutdown(kind) {
          pendingCount = 0;
          if (kind === "quit") {
            Services.startup.quit(Ci.nsIAppStartup.eAttemptQuit);
          } else {
            const win = Services.wm.getMostRecentWindow("mail:3pane");
            bypassClose = true;
            win?.close();
            bypassClose = false;
          }
        },
        onUndo: makeEvent("onUndo", "undo"),
        onSendNow: makeEvent("onSendNow", "sendnow"),
        onShutdownRequested: makeEvent("onShutdownRequested", "shutdown"),
      },
    };
  }
};

// onBeforeSend liefert den Sendemodus nicht mit. Deshalb merkt sich das Verfassen-Fenster
// den Modus des letzten GenericSendMessage-Aufrufs (0 = jetzt, 1 = später senden; in Betterbird 153 vorhanden).
function wrapCompose(win) {
  const original = win.GenericSendMessage;
  if (typeof original !== "function") {
    console.error("NovaBird-Send: GenericSendMessage nicht gefunden, Sendemodus unbekannt");
    return;
  }
  if (original.novabirdSendWrapped) {
    return;
  }
  const wrapper = function (msgType, ...rest) {
    win[DELIVER_MODE_KEY] = msgType;
    return original.call(this, msgType, ...rest);
  };
  wrapper.novabirdSendWrapped = true;
  wrapper.novabirdSendOriginal = original;
  win.GenericSendMessage = wrapper;
}

function unwrapCompose(win) {
  const current = win.GenericSendMessage;
  if (current?.novabirdSendWrapped) {
    win.GenericSendMessage = current.novabirdSendOriginal;
  }
}

// Services.io.offline wird erst gesetzt, wenn Betterbird den Verbindungsverlust selbst bemerkt.
// Zusätzlich den Netzwerkstatus des Betriebssystems abfragen (PRÜFEN: verlässlich auf Linux/NM?).
function isOffline() {
  if (Services.io.offline) {
    return true;
  }
  try {
    const link = Cc["@mozilla.org/network/network-link-service;1"].getService(
      Ci.nsINetworkLinkService
    );
    return !link.isLinkUp;
  } catch (e) {
    return false;
  }
}

function ensureStyle(doc) {
  if (doc.getElementById(STYLE_ID)) {
    return;
  }
  const style = doc.createElementNS(HTML_NS, "style");
  style.id = STYLE_ID;
  style.textContent = CSS;
  (doc.head || doc.documentElement).appendChild(style);
}

// Leeren Container entfernen, damit nichts im Fenster zurückbleibt.
function pruneStack(doc) {
  const stack = doc.getElementById(STACK_ID);
  if (stack && !stack.firstChild) {
    stack.remove();
  }
}

function removeOverlay(win) {
  win.document.getElementById(OVERLAY_ID)?.remove();
  pruneStack(win.document);
}
