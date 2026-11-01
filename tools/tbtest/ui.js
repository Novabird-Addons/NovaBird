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
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox");
  const win = Services.wm.getMostRecentWindow("mail:3pane");
  const tabmail = win.document.getElementById("tabmail");
  progress("posteingang");
  tabmail.currentAbout3Pane.displayFolder(inbox);
  await sleep(2000);
  out.addons = ["novabird-extension@novabird", "novabird-db@novabird"].map(id => `${id}: ${Boolean(WebExtensionPolicy.getByID(id))}`);

  // 1) Hauptfenster: Suchleiste mit Treffern
  const main = tabmail.tabInfo[0];
  const d3 = main.chromeBrowser.contentDocument;
  const haveSearch = Boolean(WebExtensionPolicy.getByID("novabird-db@novabird"));
  const input = haveSearch ? d3.querySelector("#novabird-search input") : null;
  if (haveSearch) check("Suchleiste vorhanden", Boolean(input), input ? "ok" : "fehlt");
  if (input) {
    input.focus();
    input.value = "Speiseplan";
    input.dispatchEvent(new d3.defaultView.Event("input", { bubbles: true }));
    await sleep(4000);
    const bar = d3.querySelector("#novabird-search").getBoundingClientRect();
    const pane = d3.documentElement.getBoundingClientRect();
    check("Suchleiste innerhalb des Fensters", bar.left >= 0 && bar.right <= pane.right + 1 && bar.height > 0, `${Math.round(bar.left)}–${Math.round(bar.right)} von ${Math.round(pane.right)}`);
    await shot(win, "1-hauptfenster-suche");
    input.value = "";
    input.dispatchEvent(new d3.defaultView.Event("input", { bubbles: true }));
    await sleep(1000);
  }

  // 2) Einstellungsseiten: NovaBird-Hub (Extension) und NovaBird-Search
  const pages = [
    ["2-einstellungen-novabird", "novabird-extension@novabird", "options/options.html?hub=1"],
    ["3-einstellungen-ki", "novabird-extension@novabird", "options/options.html?hub=1", "tabAi"],
    ["4-einstellungen-search", "novabird-db@novabird", "options/options.html"],
  ];
  for (const [name, id, path, tabButton] of pages) {
    const pol = WebExtensionPolicy.getByID(id);
    if (!pol) continue; // Add-on nicht im Test (z. B. Extension 1.4 allein)
    progress(`öffne ${name}`);
    const tab = tabmail.openTab("contentTab", { url: pol.getURL(path) });
    let doc = null;
    for (let i = 0; i < 40 && doc?.readyState !== "complete"; i++) {
      await sleep(500);
      doc = tab.browser?.contentDocument;
    }
    if (tabButton) doc?.getElementById(tabButton)?.click(); // Reiter auf der Seite (z. B. KI)
    await sleep(2000);
    check(`${name}: nichts ragt über den Rand`, doc && overflowX(doc) <= 1, doc ? `${overflowX(doc)} px` : "lädt nicht");
    await shot(win, name);
    tabmail.closeTab(tab);
    await sleep(500);
  }

  // 3) Verfassen-Fenster: Leiste und „Senden“ (auf macOS 22 px frei für die Fensterknöpfe)
  progress("öffne Verfassen");
  win.goDoCommand("cmd_newMessage"); // wie der Knopf „Verfassen“
  let cw = null;
  for (let i = 0; i < 40 && !cw?.document.getElementById("composeToolbar2"); i++) {
    await sleep(500);
    cw = Services.wm.getMostRecentWindow("msgcompose");
  }
  const bar = cw?.document.getElementById("composeToolbar2");
  check("Verfassen-Fenster öffnet", Boolean(bar), bar ? "ok" : "fehlt");
  if (bar) {
    await sleep(3000);
    const style = cw.getComputedStyle(bar);
    const send = cw.document.getElementById("button-send");
    const r = send?.getBoundingClientRect();
    out.compose = { paddingTop: style.paddingTop, marginTop: style.marginBlockStart, barTop: Math.round(bar.getBoundingClientRect().top), sendTop: r && Math.round(r.top), sendHeight: r && Math.round(r.height) };
    check("Verfassen: „Senden“ sichtbar", r && r.height > 0 && r.width > 0, out.compose);
    if (mac) {
      // Fensterknöpfe liegen in den oberen 22 px des Fensters; „Senden“ muss darunter beginnen
      check("macOS: „Senden“ unter den Fensterknöpfen", r && r.top >= 22, out.compose);
    }
    await shot(cw, "5-verfassen");
    cw.close();
  }

  out.pass = Object.values(out.checks).every(c => c.ok);
  finish(out);
})().catch(e => finish({ ...out, pass: false, error: String(e), stack: e.stack }));
