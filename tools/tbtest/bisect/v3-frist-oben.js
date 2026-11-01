// Eingrenzung Mac-Test (01.11.): Variante von smoke.js, siehe .github/workflows/macos.yml (Job smoke)
// Vortest: läuft das Testskript in Thunderbird überhaupt weiter? Jeder Schritt schreibt eine Marke (NBPROGRESS), damit man
// sieht, bis wohin es kam: sync → microtask → runnable → timer (Modul) → wintimer (Hauptfenster) → fertig.
// Für tools/tbtest/run.py (chrome-Kontext).
const done = arguments[arguments.length - 1];
const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs"); // V2: oben wie ui.js
const marks = [];
const T0 = Date.now();
const mark = name => {
  marks.push(`${name} ${Date.now() - T0} ms`);
  const p = Services.env.get("NBPROGRESS");
  if (p) IOUtils.writeUTF8(Services.appinfo.OS === "WINNT" ? p.replaceAll("/", "\\") : p, JSON.stringify({ step: name, marks }, null, 1)).catch(() => {});
};
setTimeout(() => done({ pass: false, error: "Frist", marks }), 600000); // V3: Frist oben wie ui.js
(async () => {
  mark("sync");
  await Promise.resolve();
  mark("microtask");
  await new Promise(r => Services.tm.dispatchToMainThread(r));
  mark("runnable");
  await new Promise(r => setTimeout(r, 200));
  mark("timer");
  const win = Services.wm.getMostRecentWindow("mail:3pane");
  mark(`mail:3pane ${win ? "da" : "fehlt"}`);
  if (win) {
    await new Promise(r => win.setTimeout(r, 200));
    mark("wintimer");
  }
  // noch 8 s weiterzählen: Add-ons starten erst nach der Installation (bleibt Thunderbird danach stehen, sieht man es hier)
  for (let i = 1; i <= 8; i++) {
    await new Promise(r => setTimeout(r, 1000));
    mark(`${i} s`);
  }
  const types = [...Services.wm.getEnumerator(null)].map(w => w.document?.documentElement?.getAttribute("windowtype") || w.location?.href);
  mark("fertig");
  done({ pass: Boolean(win), app: Services.appinfo.version, os: Services.appinfo.OS, marks, windows: types });
})().catch(e => done({ pass: false, error: String(e), marks }));
