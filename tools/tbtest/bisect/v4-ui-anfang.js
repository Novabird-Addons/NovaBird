// Eingrenzung Mac-Test (01.11.): Variante von smoke.js, siehe .github/workflows/macos.yml (Job smoke)
// Oberfläche mit NovaBird-Extension und NovaBird-Search: Bildschirmfotos der wichtigsten Ansichten und Lageprüfungen
// (nichts ragt über den Rand, auf macOS hält die Verfassen-Leiste 22 px für die Fensterknöpfe frei).
// Für tools/tbtest/run.py (chrome-Kontext). NBSHOTS: Ordner für die Bilder (absolut), NBPROGRESS, NBDEADLINE wie semantic.js.
const done = arguments[arguments.length - 1];
// Timer aus dem Modul statt aus dem Fenster des Skripts: auf macOS läuft das Skript sonst im versteckten Fenster, dessen
// setTimeout nie auslöste (GitHub Actions, 01.11.)
const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
const T0 = Date.now();
const secs = () => Math.round((Date.now() - T0) / 1000);
const out = { app: Services.appinfo.version, os: Services.appinfo.OS, checks: {}, shots: [] };
let finished = false;
const finish = res => {
  if (!finished) {
    finished = true;
    done(res);
  }
};
setTimeout(() => finish({ ...out, pass: false, error: `Zeitlimit nach ${secs()} s, zuletzt: ${out.step}` }), (Number(Services.env.get("NBDEADLINE")) || 600) * 1000);
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const native = p => (Services.appinfo.OS === "WINNT" ? p.replaceAll("/", "\\") : p);
  const progress = step => {
    out.step = `${step} (${secs()} s)`;
    const p = Services.env.get("NBPROGRESS");
    if (p) IOUtils.writeUTF8(native(p), JSON.stringify(out, null, 1)).catch(e => (out.progressError = String(e)));
  };
  const check = (name, ok, info) => {
    out.checks[name] = { ok: Boolean(ok), info };
    progress(name);
  };
  const mac = Services.appinfo.OS === "Darwin";

  // Bild eines Fensters (oder eines Ausschnitts) als PNG in NBSHOTS
  async function shot(win, name) {
    const dir = Services.env.get("NBSHOTS");
    if (!dir) return;
    try {
      const w = win.innerWidth;
      const h = win.innerHeight;
      const canvas = win.document.createElementNS("http://www.w3.org/1999/xhtml", "canvas");
      canvas.width = w;
      canvas.height = h;
      canvas.getContext("2d").drawWindow(win, 0, 0, w, h, "white");
      const blob = await new Promise(r => canvas.toBlob(r, "image/png"));
      await IOUtils.write(native(`${dir}/${name}.png`), new Uint8Array(await blob.arrayBuffer()));
      out.shots.push(name);
    } catch (e) {
      out.shots.push(`${name}: ${e}`);
    }
  }
  // Ragt etwas über den rechten Rand? (waagrechter Bildlauf einer Seite)
  const overflowX = doc => doc.documentElement.scrollWidth - doc.documentElement.clientWidth;

  progress("start");
  await sleep(3000);
  progress("nach sleep");
  out.pass = true;
  finish(out);
})().catch(e => finish({ ...out, pass: false, error: String(e), stack: e.stack }));
