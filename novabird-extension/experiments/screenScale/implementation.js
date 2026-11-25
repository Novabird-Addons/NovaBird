/* Screen Scaling (experimentell) – Teil der NovaBird-Extension, privilegiert.
 *  Erkennt die Auflösung des Bildschirms, auf dem das Hauptfenster liegt (Gerätepixel, unabhängig von der eingestellten Skalierung),
 *  ordnet sie 1080p, QHD oder 4K zu und setzt layout.css.devPixelsPerPx entsprechend. Ereignisgesteuert, kein Timer-Polling:
 *  Wechselt bei einer Remote-Verbindung die Auflösung, ändert sich die Fenstergröße ("resize"); beim erneuten Verbinden kommt
 *  zusätzlich "focus". Der ursprüngliche Wert der Einstellung wird gesichert und beim Ausschalten wiederhergestellt.
 *  Die Aufteilung des Hauptfensters (Breite des Ordnerbereichs, Breite oder Höhe des Lesebereichs) speichert Thunderbird in
 *  CSS-Pixeln; sie würde beim Umskalieren mitwachsen oder schrumpfen. Daher werden ihre Anteile am Fensterinhalt gemerkt und
 *  nach einer Änderung der Skalierung wiederhergestellt (grob, ohne Mindestbreiten zu berücksichtigen).
 *  Wahlweise richtet sich die Breite des Ordnerbereichs nach dem längsten sichtbaren Konto- oder Ordnernamen (höchstens ein
 *  Drittel des Fensters, längere Namen werden wie gewohnt gekürzt): beim Start, beim Einschalten und nach jedem Umskalieren.
 *  Dazwischen bleibt sie, wie der Nutzer sie zieht.
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
const RELAYOUT_MS = 300; // Wartezeit nach dem Umskalieren, bis das Fenster neu aufgebaut ist
// Trenner im Mail-Tab und ihr Eintrag im xulStore (wie in Thunderbirds pane-layout.mjs)
const SPLITTERS = { folderPaneSplitter: "folderPaneBox", messagePaneSplitter: "messagepaneboxwrapper" };
const STORE_URL = "chrome://messenger/content/messenger.xhtml";
const FIT_MAX_SHARE = 1 / 3; // Ordnerbereich höchstens ein Drittel des Fensters
const FIT_MIN_EM = 12; // und mindestens 12rem (Knöpfe oben in der Leiste)
const FIT_GAP_EM = 0.5; // etwas Luft hinter dem längsten Namen

let cfg = { enabled: false, fhd: 100, qhd: 125, uhd: 150, fitFolders: true };
const windows = new Map(); // Fenster -> { onChange, timer, fit }
const shares = new WeakMap(); // paneLayout (about:3pane) -> { splitterId: { dim, share } }

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

// liefert true, wenn sich der Wert geändert hat
function setPct(pct) {
  const value = String(pct / 100);
  if (!Services.prefs.prefHasUserValue(PREF_SET) && !Services.prefs.prefHasUserValue(PREF_ORIG)) {
    Services.prefs.setCharPref(PREF_ORIG, Services.prefs.prefHasUserValue(PREF) ? Services.prefs.getCharPref(PREF) : "");
  }
  const changed = Services.prefs.getCharPref(PREF, "-1") !== value;
  if (changed) {
    Services.prefs.setCharPref(PREF, value);
  }
  Services.prefs.setCharPref(PREF_SET, value);
  return changed;
}

// liefert true, wenn die Skalierung zurückgesetzt wurde
function restore() {
  if (!Services.prefs.prefHasUserValue(PREF_ORIG)) return false;
  const orig = Services.prefs.getCharPref(PREF_ORIG);
  let changed = false;
  // nur zurücksetzen, wenn der Wert noch von uns stammt; hat der Nutzer ihn inzwischen selbst geändert, bleibt er
  if (Services.prefs.getCharPref(PREF, "") === Services.prefs.getCharPref(PREF_SET, "")) {
    changed = Services.prefs.getCharPref(PREF, "") !== orig;
    if (orig) Services.prefs.setCharPref(PREF, orig); else Services.prefs.clearUserPref(PREF);
  }
  Services.prefs.clearUserPref(PREF_ORIG);
  Services.prefs.clearUserPref(PREF_SET);
  return changed;
}

// paneLayout-Elemente aller Mail-Tabs eines Hauptfensters
function paneLayouts(win) {
  const tabmail = win.document.getElementById("tabmail");
  return (tabmail?.tabInfo || [])
    .filter(tab => tab.mode?.name === "mail3PaneTab")
    .map(tab => tab.chromeBrowser?.contentDocument?.getElementById("paneLayout"))
    .filter(Boolean);
}

function splitterDim(splitter) {
  return splitter.resizeDirection === "vertical" ? "height" : "width";
}

// Größe des Fensterinhalts; Tabs im Hintergrund haben keine Maße, daher die des sichtbaren Tabs für alle
function layoutSize(layouts) {
  for (const layout of layouts) {
    const rect = layout.getBoundingClientRect();
    if (rect.width > 0 && rect.height > 0) return rect;
  }
  return null;
}

// Anteile merken; onlyMissing: nur für Tabs, die noch keine haben (vor dem ersten Umskalieren)
function rememberShares(win, onlyMissing = false) {
  const layouts = paneLayouts(win);
  const size = layoutSize(layouts);
  if (!size) return;
  for (const layout of layouts) {
    if (onlyMissing && shares.has(layout)) continue;
    const entry = {};
    for (const id of Object.keys(SPLITTERS)) {
      const splitter = layout.querySelector("#" + id);
      if (!splitter) continue;
      const dim = splitterDim(splitter);
      const value = Number(splitter[dim]);
      if (value > 0) entry[id] = { dim, share: value / size[dim] };
    }
    shares.set(layout, entry);
  }
}

function applyShares(win) {
  const layouts = paneLayouts(win);
  const size = layoutSize(layouts);
  if (!size) return;
  for (const layout of layouts) {
    for (const [id, { dim, share }] of Object.entries(shares.get(layout) || {})) {
      try {
        const splitter = layout.querySelector("#" + id);
        if (!splitter || splitterDim(splitter) !== dim) continue; // Ansicht inzwischen gewechselt
        const value = Math.round(share * size[dim]);
        splitter[dim] = value;
        // wie nach dem Ziehen mit der Maus speichern, damit der Wert beim nächsten Start gilt
        Services.xulStore.setValue(STORE_URL, SPLITTERS[id], dim, String(value));
      } catch (e) {
        console.error("Screen Scaling: Aufteilung", id, e);
      }
    }
  }
}

// Breite, die der Ordnerbereich braucht, damit der längste sichtbare Name ganz dasteht (CSS-Pixel); 0 = nicht messbar
// (Tab im Hintergrund, Ordnerbereich eingeklappt oder noch leer). Gemessen wird die Textbreite jedes Namens gegen den Platz,
// den er gerade hat: so zählen Einrückung, Symbole und Zähler (ungelesen, gesamt, Größe) automatisch mit.
function neededFolderWidth(layout) {
  const doc = layout.ownerDocument, view = doc.defaultView;
  const pane = doc.getElementById("folderPane"), tree = doc.getElementById("folderTree");
  const splitter = layout.querySelector("#folderPaneSplitter");
  if (!pane || !tree || !splitter || splitter.isCollapsed) return 0;
  const current = pane.getBoundingClientRect().width;
  if (!(current > 0)) return 0;
  const range = doc.createRange();
  let extra = -Infinity;
  for (const name of tree.querySelectorAll("li > .container > .name")) {
    if (!name.getClientRects().length) continue; // in einem zugeklappten Konto oder Ordner
    range.selectNodeContents(name);
    const text = range.getBoundingClientRect().width;
    if (!(text > 0)) continue;
    const cs = view.getComputedStyle(name);
    extra = Math.max(extra, text + (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) - name.clientWidth);
  }
  if (extra === -Infinity) return 0;
  const em = parseFloat(view.getComputedStyle(tree).fontSize) || 16;
  const rem = parseFloat(view.getComputedStyle(doc.documentElement).fontSize) || 16;
  return Math.max(Math.round(FIT_MIN_EM * rem), Math.ceil(current + extra + FIT_GAP_EM * em));
}

// liefert true, wenn gemessen und gesetzt wurde
function fitFolders(win) {
  const layouts = paneLayouts(win);
  const size = layoutSize(layouts);
  if (!size) return false;
  let need = 0;
  for (const layout of layouts) {
    need = neededFolderWidth(layout);
    if (need) break;
  }
  if (!need) return false;
  const value = Math.min(need, Math.round(size.width * FIT_MAX_SHARE));
  for (const layout of layouts) {
    const splitter = layout.querySelector("#folderPaneSplitter");
    if (!splitter || splitter.isCollapsed) continue;
    if (Math.abs(Number(splitter.width) - value) > 1) splitter.width = value;
  }
  Services.xulStore.setValue(STORE_URL, SPLITTERS.folderPaneSplitter, "width", String(value));
  rememberShares(win); // neue Aufteilung ist der ruhige Zustand fürs nächste Umskalieren
  return true;
}

function tryFit(win) {
  const state = windows.get(win);
  if (!cfg.fitFolders || !state?.fit) return;
  try {
    if (fitFolders(win)) state.fit = false;
  } catch (e) {
    console.error("Screen Scaling: Breite des Ordnerbereichs", e);
  }
}

function followLayout(wins) {
  for (const win of wins) {
    const state = windows.get(win);
    if (state) state.fit = true;
    win.setTimeout(() => {
      try { applyShares(win); } catch (e) { console.error("Screen Scaling: Aufteilung", e); }
      tryFit(win);
    }, RELAYOUT_MS);
  }
}

function evaluate(win) {
  if (!cfg.enabled) return;
  // Die Skalierung ist eine globale Einstellung: bei mehreren Hauptfenstern bestimmt nur das erste (sonst wechselte sie bei jedem
  // Fokuswechsel zwischen Fenstern auf verschiedenen Bildschirmen hin und her, und alle Fenster bauten sich neu auf)
  if (windows.size > 1 && windows.keys().next().value !== win) return;
  const { width } = measure(win);
  const pct = Number(cfg[profileOf(width)]);
  if (!(pct >= 50 && pct <= 400)) return;
  try {
    // Anteile stammen aus dem letzten ruhigen Zustand; Tabs ohne gemerkte Anteile (erstes Einschalten) jetzt erfassen
    for (const w of windows.keys()) rememberShares(w, pct !== currentPct());
  } catch (e) {
    console.error("Screen Scaling: Aufteilung", e);
  }
  if (setPct(pct)) followLayout(windows.keys());
  else tryFit(win); // beim Start, beim Einschalten, oder die letzte Messung ging nicht (Tab im Hintergrund)
}

function hook(win) {
  const state = { timer: null, fit: true };
  state.onChange = () => {
    win.clearTimeout(state.timer);
    state.timer = win.setTimeout(() => evaluate(win), DEBOUNCE_MS);
  };
  // eine ausstehende Anpassung der Ordnerbreite nachholen, sobald wieder ein Mail-Tab vorn ist
  state.onTab = () => { if (state.fit) state.onChange(); };
  win.addEventListener("resize", state.onChange);
  win.addEventListener("focus", state.onChange);
  win.document.getElementById("tabmail")?.tabContainer?.addEventListener("TabSelect", state.onTab);
  windows.set(win, state);
  state.onChange();
}

function unhook(win) {
  const state = windows.get(win);
  if (!state) return;
  win.clearTimeout(state.timer);
  win.removeEventListener("resize", state.onChange);
  win.removeEventListener("focus", state.onChange);
  win.document.getElementById("tabmail")?.tabContainer?.removeEventListener("TabSelect", state.onTab);
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
  const wins = [...windows.keys()];
  for (const win of wins) unhook(win);
  if (restore()) followLayout(wins);
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
        async setConfig(enabled, fhd, qhd, uhd, fitFolders) {
          const fitOn = fitFolders !== false && !cfg.fitFolders;
          cfg = { enabled: !!enabled, fhd, qhd, uhd, fitFolders: fitFolders !== false };
          if (fitOn) for (const state of windows.values()) state.fit = true;
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
