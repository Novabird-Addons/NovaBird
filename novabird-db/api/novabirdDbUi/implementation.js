/* Experiment-API "novabirdDbUi" – Fortschritts-Overlay des NovaBird-DB im Hauptfenster.
 * Nur Anzeige: Der Hintergrundcode des NovaBird-DB meldet den Fortschritt, hier wird er gezeichnet.
 * Optik wie das Overlay von NovaBird-Send; der Balken füllt sich von rechts nach links.
 */
"use strict";

var { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

const HTML_NS = "http://www.w3.org/1999/xhtml";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const OVERLAY_ID = "novabird-db-overlay";
const DIALOG_ID = "novabird-db-dialog";
const STYLE_ID = "novabird-db-overlay-style";
const LISTENER_NAME = "novabird-db-windows";

const DEFAULT_STRINGS = {
  title: "Building search index",
  pausedTitle: "Index build paused",
  count: "{done} of {total} mails",
  pause: "Pause",
  resume: "Resume",
  hide: "Hide",
  hint: "The first run can take quite a while. Betterbird stays usable; you can pause and resume at any time.",
};

const CSS = `
#${OVERLAY_ID} {
  --dp-bg: var(--layout-background-1, #e6ecf5);
  --dp-fg: var(--layout-color-1, #1e2838);
  --dp-border: var(--layout-border-0, #d2dae6);
  --dp-accent: var(--selected-item-color, #2f6bd8);
  --dp-muted: color-mix(in srgb, var(--dp-fg) 65%, transparent);
  --dp-track: color-mix(in srgb, var(--dp-accent) 22%, transparent);
  position: fixed;
  left: 50%;
  bottom: 10vh;
  transform: translateX(-50%);
  z-index: 2147483000;
  min-width: 340px;
  max-width: min(560px, 90vw);
  font: menu;
  font-size: 13px;
  background: var(--dp-bg);
  color: var(--dp-fg);
  border: 1px solid var(--dp-border);
  border-radius: 10px;
  box-shadow: 0 6px 24px rgba(20, 40, 80, 0.18);
  overflow: hidden;
}
#${OVERLAY_ID} .dp-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px 12px 16px; }
#${OVERLAY_ID} .dp-text { flex: 1; min-width: 0; }
#${OVERLAY_ID} .dp-title { font-weight: 600; }
#${OVERLAY_ID} .dp-status { color: var(--dp-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#${OVERLAY_ID} .dp-hint { color: var(--dp-muted); font-size: 11px; padding: 0 16px 10px; line-height: 1.35; }
#${OVERLAY_ID} .dp-pct { font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }
#${OVERLAY_ID} button {
  font: inherit; border-radius: 6px; padding: 5px 12px; cursor: pointer;
  border: 1px solid var(--dp-border); background: transparent; color: var(--dp-fg);
}
#${OVERLAY_ID} .dp-track { height: 14px; background: linear-gradient(to bottom, transparent, var(--dp-track) 70%); display: flex; justify-content: flex-end; }
#${OVERLAY_ID} .dp-bar {
  height: 100%; width: 0; background: var(--dp-accent); transition: width 0.4s linear;
  mask-image: linear-gradient(to left, #000 calc(100% - 70px), transparent), linear-gradient(to bottom, transparent, #000 70%);
  mask-composite: intersect;
}
@media (prefers-reduced-motion: reduce) { #${OVERLAY_ID} .dp-bar { transition: none; } }
#${DIALOG_ID} {
  --dp-bg: var(--layout-background-1, #e6ecf5);
  --dp-fg: var(--layout-color-1, #1e2838);
  --dp-border: var(--layout-border-0, #d2dae6);
  --dp-accent: var(--selected-item-color, #2f6bd8);
  position: fixed; left: 50%; top: 22vh; transform: translateX(-50%); z-index: 2147483001;
  min-width: 360px; max-width: min(560px, 92vw); font: menu; font-size: 13px;
  background: var(--dp-bg); color: var(--dp-fg); border: 1px solid var(--dp-border); border-radius: 10px;
  box-shadow: 0 10px 36px rgba(20, 40, 80, 0.3); padding: 16px 18px 14px;
}
#${DIALOG_ID} .dp-dlg-title { font-weight: 600; font-size: 15px; margin-bottom: 8px; }
#${DIALOG_ID} .dp-dlg-text { line-height: 1.45; white-space: pre-line; margin-bottom: 14px; }
#${DIALOG_ID} .dp-dlg-btns { display: flex; justify-content: flex-end; gap: 8px; }
#${DIALOG_ID} button { font: inherit; border-radius: 6px; padding: 5px 14px; cursor: pointer; border: 1px solid var(--dp-border); background: transparent; color: var(--dp-fg); }
#${DIALOG_ID} button.dp-primary { background: var(--dp-accent); color: var(--selected-item-text-color, #fff); border-color: var(--dp-accent); }
`;

var novabirdDbUi = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (isAppShutdown) return;
    ExtensionSupport.unregisterWindowListener(LISTENER_NAME);
    for (const win of Services.wm.getEnumerator("mail:3pane")) {
      win.document.getElementById(OVERLAY_ID)?.remove();
      win.document.getElementById(DIALOG_ID)?.remove();
      win.document.getElementById(STYLE_ID)?.remove();
    }
  }

  getAPI(context) {
    const emitter = new ExtensionCommon.EventEmitter();
    let strings = { ...DEFAULT_STRINGS };
    let progress = null;
    let dismissed = false;
    const fmt = n => Number(n).toLocaleString("de-DE");

    const render = win => {
      const doc = win.document;
      let box = doc.getElementById(OVERLAY_ID);
      if (!progress || dismissed) {
        box?.remove();
        return;
      }
      if (!doc.getElementById(STYLE_ID)) {
        const style = doc.createElementNS(HTML_NS, "style");
        style.id = STYLE_ID;
        style.textContent = CSS;
        (doc.head || doc.documentElement).appendChild(style);
      }
      if (!box) {
        const el = (tag, cls) => {
          const e = doc.createElementNS(HTML_NS, tag);
          if (cls) e.className = cls;
          return e;
        };
        box = el("div");
        box.id = OVERLAY_ID;
        box.setAttribute("role", "status");
        const row = el("div", "dp-row");
        const text = el("div", "dp-text");
        text.append(el("div", "dp-title"), el("div", "dp-status"));
        const ctl = el("button", "dp-ctl");
        ctl.addEventListener("click", () => emitter.emit("control", progress?.paused ? "resume" : "stop"));
        const hide = el("button", "dp-hide");
        hide.addEventListener("click", () => {
          dismissed = true;
          renderAll();
        });
        row.append(text, el("div", "dp-pct"), ctl, hide);
        const track = el("div", "dp-track");
        track.append(el("div", "dp-bar"));
        box.append(row, el("div", "dp-hint"), track);
        (doc.body || doc.documentElement).appendChild(box);
      }
      const q = sel => box.querySelector(sel);
      q(".dp-title").textContent = progress.paused ? strings.pausedTitle : strings.title;
      q(".dp-status").textContent =
        (progress.total
          ? strings.count.replace("{done}", fmt(Math.min(progress.done, progress.total))).replace("{total}", fmt(progress.total))
          : fmt(progress.done)) + (progress.folder ? ` · ${progress.folder}` : "");
      q(".dp-pct").textContent = progress.percent == null ? "" : `${progress.percent} %`;
      q(".dp-ctl").textContent = progress.paused ? strings.resume : strings.pause;
      q(".dp-hide").textContent = strings.hide;
      q(".dp-hint").textContent = strings.hint;
      q(".dp-bar").style.width = `${progress.percent ?? 0}%`;
    };

    const renderAll = () => {
      for (const win of Services.wm.getEnumerator("mail:3pane")) render(win);
    };

    // Auch Hauptfenster, die erst später geöffnet werden, zeigen das Overlay
    ExtensionSupport.registerWindowListener(LISTENER_NAME, {
      chromeURLs: [MAIN_URL],
      onLoadWindow(win) {
        render(win);
      },
    });

    // Meldung/Rückfrage mit Knöpfen in allen Hauptfenstern; der erste Klick beantwortet sie und schließt sie überall.
    const showDialog = (title, text, buttons) =>
      new Promise(resolve => {
        const wins = [...Services.wm.getEnumerator("mail:3pane")];
        const boxes = [];
        const finish = id => {
          for (const box of boxes) box.remove();
          resolve(id);
        };
        for (const win of wins) {
          const doc = win.document;
          if (!doc.getElementById(STYLE_ID)) {
            const style = doc.createElementNS(HTML_NS, "style");
            style.id = STYLE_ID;
            style.textContent = CSS;
            (doc.head || doc.documentElement).appendChild(style);
          }
          doc.getElementById(DIALOG_ID)?.remove();
          const el = (tag, cls, txt) => {
            const e = doc.createElementNS(HTML_NS, tag);
            if (cls) e.className = cls;
            if (txt != null) e.textContent = txt;
            return e;
          };
          const box = el("div");
          box.id = DIALOG_ID;
          box.setAttribute("role", "alertdialog");
          const btns = el("div", "dp-dlg-btns");
          buttons.forEach((b, i) => {
            const btn = el("button", i === buttons.length - 1 ? "dp-primary" : "", b.label);
            btn.type = "button";
            btn.addEventListener("click", () => finish(b.id));
            btns.append(btn);
          });
          box.append(el("div", "dp-dlg-title", title), el("div", "dp-dlg-text", text), btns);
          (doc.body || doc.documentElement).appendChild(box);
          boxes.push(box);
        }
        if (!boxes.length) resolve(buttons[0]?.id ?? "");
      });

    return {
      novabirdDbUi: {
        async showDialog(title, text, buttons) {
          return showDialog(title, text, buttons);
        },
        async setStrings(newStrings) {
          strings = { ...DEFAULT_STRINGS, ...newStrings };
          renderAll();
        },
        async showProgress(p) {
          progress = p;
          renderAll();
        },
        async hideProgress() {
          progress = null;
          dismissed = false;
          renderAll();
        },
        onControl: new ExtensionCommon.EventManager({
          context,
          name: "novabirdDbUi.onControl",
          register(fire) {
            const listener = (event, ...args) => fire.async(...args);
            emitter.on("control", listener);
            return () => emitter.off("control", listener);
          },
        }).api(),
      },
    };
  }
};
