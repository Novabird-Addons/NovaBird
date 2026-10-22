/* Screen Scaling (experimentell) – Teil der NovaBird-Extension, privilegiert.
 *  Erkennt die Auflösung des Bildschirms, auf dem das Hauptfenster liegt (Gerätepixel, unabhängig von der eingestellten Skalierung),
 *  ordnet sie 1080p, QHD oder 4K zu und setzt layout.css.devPixelsPerPx entsprechend. Ereignisgesteuert, kein Timer-Polling:
 *  Wechselt bei einer Remote-Verbindung die Auflösung, ändert sich die Fenstergröße ("resize"); beim erneuten Verbinden kommt
 *  zusätzlich "focus". Der ursprüngliche Wert der Einstellung wird gesichert und beim Ausschalten wiederhergestellt.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.screenScale = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const LISTENER = "novabird-extension-screenscale";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const PREF = "layout.css.devPixelsPerPx";
const PREF_ORIG = "extensions.novabird.screenScale.orig"; // Wert vor unserer ersten Änderung ("" = Standard)
const PREF_SET = "extensions.novabird.screenScale.set"; // zuletzt von uns gesetzter Wert
const DEBOUNCE_MS = 600;

let cfg = { enabled: false, fhd: 100, qhd: 125, uhd: 150 };
const windows = new Map(); // Fenster -> { onChange, timer }

// Auflösung in Gerätepixeln: die Bildschirmverwaltung kennt sie unabhängig von devPixelsPerPx (window.screen rechnet in CSS-Pixeln)
function measure(win) {
  try {
    const dpr = win.devicePixelRatio || 1;
    const sm = Cc["@mozilla.org/gfx/screenmanager;1"].getService(Ci.nsIScreenManager);
    const screen = sm.screenForRect(Math.round(win.mozInnerScreenX * dpr), Math.round(win.mozInnerScreenY * dpr), 1, 1);
    const l = {}, t = {}, w = {}, h = {};
    screen.GetRect(l, t, w, h);
    if (w.value > 0 && h.value > 0) return { width: w.value, height: h.value };
  } catch (e) {
    console.error("Screen Scaling: Bildschirmverwaltung", e);
  }
  const dpr = win.devicePixelRatio || 1;
  return { width: Math.round(win.screen.width * dpr), height: Math.round(win.screen.height * dpr) };
}

function profileOf(width) {
  return width < 2200 ? "fhd" : width < 3200 ? "qhd" : "uhd";
}

function currentPct() {
  const v = parseFloat(Services.prefs.getCharPref(PREF, "-1"));
  return v > 0 ? Math.round(v * 100) : 0; // 0 = Systemstandard
}

function setPct(pct) {
  const value = String(pct / 100);
  if (!Services.prefs.prefHasUserValue(PREF_SET) && !Services.prefs.prefHasUserValue(PREF_ORIG)) {
    Services.prefs.setCharPref(PREF_ORIG, Services.prefs.prefHasUserValue(PREF) ? Services.prefs.getCharPref(PREF) : "");
  }
  if (Services.prefs.getCharPref(PREF, "-1") !== value) {
    Services.prefs.setCharPref(PREF, value);
  }
  Services.prefs.setCharPref(PREF_SET, value);
}

function restore() {
  if (!Services.prefs.prefHasUserValue(PREF_ORIG)) return;
  const orig = Services.prefs.getCharPref(PREF_ORIG);
  // nur zurücksetzen, wenn der Wert noch von uns stammt; hat der Nutzer ihn inzwischen selbst geändert, bleibt er
  if (Services.prefs.getCharPref(PREF, "") === Services.prefs.getCharPref(PREF_SET, "")) {
    if (orig) Services.prefs.setCharPref(PREF, orig); else Services.prefs.clearUserPref(PREF);
  }
  Services.prefs.clearUserPref(PREF_ORIG);
  Services.prefs.clearUserPref(PREF_SET);
}

function evaluate(win) {
  if (!cfg.enabled) return;
  const { width } = measure(win);
  const pct = Number(cfg[profileOf(width)]);
  if (pct >= 50 && pct <= 400) setPct(pct);
}

function hook(win) {
  const state = { timer: null };
  state.onChange = () => {
    win.clearTimeout(state.timer);
    state.timer = win.setTimeout(() => evaluate(win), DEBOUNCE_MS);
  };
  win.addEventListener("resize", state.onChange);
  win.addEventListener("focus", state.onChange);
  windows.set(win, state);
  state.onChange();
}

function unhook(win) {
  const state = windows.get(win);
  if (!state) return;
  win.clearTimeout(state.timer);
  win.removeEventListener("resize", state.onChange);
  win.removeEventListener("focus", state.onChange);
  windows.delete(win);
}

function start() {
  ExtensionSupport.registerWindowListener(LISTENER, {
    chromeURLs: [MAIN_URL],
    onLoadWindow(win) { try { hook(win); } catch (e) { console.error("Screen Scaling:", e); } },
    onUnloadWindow(win) { unhook(win); },
  });
}

function stop() {
  ExtensionSupport.unregisterWindowListener(LISTENER);
  for (const win of [...windows.keys()]) unhook(win);
  restore();
}

let running = false;

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) return; // beim Beenden der Anwendung bleibt der Wert für den nächsten Start stehen
    if (running) { stop(); running = false; }
  }

  getAPI() {
    return {
      screenScale: {
        async setConfig(enabled, fhd, qhd, uhd) {
          cfg = { enabled: !!enabled, fhd, qhd, uhd };
          if (cfg.enabled && !running) {
            running = true;
            start();
          } else if (!cfg.enabled && running) {
            running = false;
            stop();
          } else if (running) {
            for (const win of windows.keys()) evaluate(win);
          }
        },
        async getInfo() {
          const win = Services.wm.getMostRecentWindow("mail:3pane");
          if (!win) return null;
          const { width, height } = measure(win);
          return { width, height, profile: profileOf(width), scale: currentPct() };
        },
      },
    };
  }
};

return API;
})();
