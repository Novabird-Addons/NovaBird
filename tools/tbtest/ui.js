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

  // 2b) Einstellungen → NovaBird (ab 2.0): Themen-Reiter oben, Unterreiter darunter; eine Seite je Unterreiter
  const ext2 = WebExtensionPolicy.getByID("novabird-extension@novabird");
  if (ext2 && /^2\./.test(ext2.extension.version)) {
    progress("öffne Einstellungen → NovaBird");
    win.openPreferencesTab("paneNovaBird");
    let hub = null;
    for (let i = 0; i < 40 && !hub; i++) {
      await sleep(500);
      const ptab = tabmail.tabInfo.find(t => t.browser?.contentDocument?.getElementById("nbxHub"));
      const h = ptab?.browser.contentDocument.getElementById("nbxHub");
      if (h && !h.hidden) hub = h;
    }
    check("Hub: Seite öffnet", Boolean(hub), hub ? "ok" : "fehlt");
    if (hub) {
      const doc = hub.ownerDocument;
      // breiteres Fenster: Nachrichtenliste mit vier Spalten; Bilder zeigen die Unterseite ab ihrem oberen Rand
      const oldSize = [win.outerWidth, win.outerHeight];
      win.resizeTo(1600, 1200);
      await sleep(800);
      const groupBtns = [...hub.querySelectorAll(".nbx-hub-tabs button")];
      check("Hub: Themen-Reiter", groupBtns.length >= 4, groupBtns.map(b => b.textContent).join(" | "));
      // Gruppe wählen, dann Unterreiter (Text beginnt mit sub, leer = erster); wartet, bis die Seite Höhe hat
      const openSub = async (groups, sub, name, shotName) => {
        const g = groupBtns.find(b => groups.includes(b.textContent));
        check(`Hub: Gruppe ${groups[0]}`, Boolean(g), g ? "ok" : "fehlt");
        if (!g) return null;
        g.click();
        const subBtns = [...hub.querySelectorAll(".nbx-hub-subtabs button")];
        const sb = sub ? subBtns.find(b => sub.some(x => b.textContent.startsWith(x))) : null;
        if (sub) {
          check(`Hub: Unterreiter ${sub[0]}`, Boolean(sb), subBtns.map(b => b.textContent).join(" | "));
          sb?.click();
        }
        let br = null;
        for (let i = 0; i < 30; i++) {
          await sleep(500);
          br = [...hub.querySelectorAll(".nbx-hub-box:not([hidden]) browser")][0];
          if (br && br.getBoundingClientRect().height > 100) break;
        }
        check(`Hub: ${name} lädt`, br && br.getBoundingClientRect().height > 100, br ? `${Math.round(br.getBoundingClientRect().height)} px` : "kein browser");
        await sleep(1500); // Seite füllt sich (Status, Verbindung)
        hub.querySelector(".nbx-hub-subtabs").scrollIntoView();
        await sleep(300);
        await shot(win, shotName);
        return subBtns;
      };
      const looks = await openSub(["Aussehen", "Appearance"], null, "Nachrichtenliste", "2b-einstellungen-hub");
      if (looks) check("Hub: Unterreiter Aussehen", looks.length >= 3, looks.map(b => b.textContent).join(" | "));
      const ki = await openSub(["KI", "AI", "IA"], null, "KI-Überblick", "2c-einstellungen-ki-ueberblick");
      if (ki) check("Hub: Unterreiter KI", ki.length >= 2, ki.map(b => b.textContent).join(" | "));
      await openSub(["KI", "AI", "IA"], ["KI-Assistent", "AI assistant"], "KI-Assistent", "2d-einstellungen-ki-assistent");
      await openSub(["KI", "AI", "IA"], ["NovaBird Helper"], "NovaBird Helper", "2e-einstellungen-helper");
      if (WebExtensionPolicy.getByID("novabird-db@novabird")) {
        await openSub(["Suche", "Search"], ["Bedeutungssuche", "Meaning search"], "Bedeutungssuche", "2f-einstellungen-bedeutungssuche");
      }
      win.resizeTo(...oldSize);
      await sleep(500);
      const ptab = tabmail.tabInfo.find(t => t.browser?.contentDocument === doc);
      if (ptab) tabmail.closeTab(ptab);
      await sleep(500);
    }
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
      // Thunderbird zieht die Leiste 22 px in die Titelleiste (margin -22px); die Fensterknöpfe liegen in diesen oberen
      // 22 px der Leiste, „Senden“ muss darunter beginnen (gemessen 01.11.: mit Fix 49 px, ohne 27 px bei Leiste 21 px)
      check("macOS: „Senden“ unter den Fensterknöpfen", r && r.top >= out.compose.barTop + 22, out.compose);
    }
    await shot(cw, "5-verfassen");
    cw.close();
  }

  // 4) Kalender (Extension ab 2.0): Uhrzeit und Ort unter dem Titel des Termins in der Wochenansicht
  const ext = WebExtensionPolicy.getByID("novabird-extension@novabird");
  if (ext && /^2\./.test(ext.extension.version)) {
    progress("Kalender");
    const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
    let calendar = cal.manager.getCalendars()[0];
    if (!calendar) {
      calendar = cal.manager.createCalendar("storage", Services.io.newURI("moz-storage-calendar://"));
      calendar.name = "Test";
      cal.manager.registerCalendar(calendar);
    }
    calendar.setProperty("disabled", false);
    const ev = new win.CalEvent();
    ev.title = "Elternabend";
    const start = cal.dtz.now();
    start.hour = 14;
    start.minute = 0;
    start.second = 0;
    const end = start.clone();
    end.hour = 17;
    ev.startDate = start;
    ev.endDate = end;
    ev.setProperty("LOCATION", "Aula");
    await calendar.addItem(ev);
    Services.prefs.setBoolPref("calendar.view.showLocation", true);
    tabmail.openTab("calendar");
    await sleep(1500);
    win.switchToView?.("day");
    await sleep(2500);
    const box = [...win.document.querySelectorAll("calendar-event-box")].find(b => b.occurrence?.title === "Elternabend" && b.querySelector(".location-desc")?.textContent);
    const info = { time: box?.querySelector(".nbx-event-time")?.textContent, location: box?.querySelector(".location-desc")?.textContent };
    check("Kalender: Uhrzeit und Ort im Termin", /14.*17/.test(info.time || "") && info.location === "Aula", info);
    await shot(win, "6-kalender-tag");
    tabmail.switchToTab(main);
  }

  out.pass = Object.values(out.checks).every(c => c.ok);
  finish(out);
})().catch(e => finish({ ...out, pass: false, error: String(e), stack: e.stack }));
