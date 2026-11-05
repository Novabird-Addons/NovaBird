// Lasttest Index (NovaBird-Search) mit großem Archiv. Für tools/tbtest/run.py (chrome-Kontext), dauerhaftes Profil.
// NBMODE=build:  warten, bis der Erstlauf fertig ist (Stunden), Zeit + Mailzahl messen.
// NBMODE=rescan: Start mit fertigem Index – Zeit des automatischen Startlaufs, danach erzwungener Durchgang über alle
//                Ordner (= Fall „Ordner nie fertig“: alles bekannt, nur durchblättern). NBPROGRESS: Zwischenstand.
const done = arguments[arguments.length - 1];
const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
const T0 = Date.now();
const secs = () => Math.round((Date.now() - T0) / 1000);
const mode = Services.env.get("NBMODE") || "rescan";
const out = { app: Services.appinfo.version, mode, t: {}, checks: {} };
let finished = false;
const finish = res => { if (!finished) { finished = true; done(res); } };
setTimeout(() => finish({ ...out, pass: false, error: `Zeitlimit nach ${secs()} s, zuletzt ${out.step}` }), (Number(Services.env.get("NBDEADLINE")) || 36000) * 1000);
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const progress = step => {
    out.step = `${step} (${secs()} s)`;
    const p = Services.env.get("NBPROGRESS");
    if (p) IOUtils.writeUTF8(p.replaceAll("/", "\\"), JSON.stringify(out, null, 1)).catch(() => {});
  };
  const check = (name, ok, info) => { out.checks[name] = { ok: Boolean(ok), info }; progress(name); };
  progress("start");
  await sleep(2000);
  if (mode === "prep") {
    // frisches Profil: Thunderbird liest mbox-Dateien erst beim Öffnen ein – vorher alle Ordner einlesen lassen
    const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
    const root = MailServices.accounts.localFoldersServer.rootFolder;
    const all = root.descendants;
    const tp = Date.now();
    let n = 0, mails = 0;
    for (const f of all) {
      const lf = f.QueryInterface(Ci.nsIMsgLocalMailFolder);
      let size = 0;
      try { size = f.filePath.fileSize; } catch {}
      let ready = false;
      try { ready = Boolean(f.msgDatabase) && f.getTotalMessages(false) > 0; } catch {}
      if (!size || ready) { mails += f.getTotalMessages(false); progress(`einlesen ${++n}/${all.length} ${mails} Mails`); continue; }
      let fired = false;
      try {
        lf.getDatabaseWithReparse({ OnStartRunningUrl() {}, OnStopRunningUrl() { fired = true; } }, null);
      } catch (e) {
        out.reparseErr = String(e);
      }
      // warten, bis das Einlesen durch ist: Listener gemeldet oder Ordner frei und Zahl stabil
      let last = -1;
      for (let k = 0; k < 1200; k++) {
        await sleep(1000);
        let c = -2;
        try { c = f.msgDatabase ? f.getTotalMessages(false) : -2; } catch {}
        if (fired && c >= 0) break;
        if (!f.locked && c > 0 && c === last) break;
        last = c;
        progress(`einlesen ${n + 1}/${all.length} ${f.prettyName} ${c}`);
      }
      try { f.msgDatabase = null; } catch {}
      mails += f.getTotalMessages(false);
      progress(`einlesen ${++n}/${all.length} ${mails} Mails`);
    }
    out.t.reparse = Math.round((Date.now() - tp) / 1000);
    out.folderMails = mails;
    return finish({ ...out, pass: mails > 1_000_000 });
    // Index des Fehlstarts (0 Mails gesehen) verwerfen und neu aufbauen
  }

  const win = Services.wm.getMostRecentWindow("mail:3pane");
  const tabmail = win.document.getElementById("tabmail");
  const pol = WebExtensionPolicy.getByID("novabird-db@novabird");
  const optTab = tabmail.openTab("contentTab", { url: pol.getURL("options/options.html") });
  let page = null;
  for (let i = 0; i < 120 && !page?.messenger; i++) {
    await sleep(500);
    page = optTab.browser?.contentWindow?.wrappedJSObject;
  }
  if (!page?.messenger) throw new Error("Einstellungsseite lädt nicht");
  const C = o => Cu.cloneInto(o, page);
  const send = async msg => JSON.parse(JSON.stringify((await page.messenger.runtime.sendMessage(C(msg))) ?? null));
  const st = async () => { const s = await send({ type: "novabird-db:status" }); out.status = { phase: s.status?.phase, done: s.status?.done, total: s.status?.total, messages: s.messages, headersOnly: s.headersOnly, size: s.sizeBytes }; return s; };

  // Startlauf (beginnt ~10 s nach dem Start): warten, bis er durch ist
  const t1 = Date.now();
  let s, seenRun = false;
  for (;;) {
    s = await st();
    const ph = s.status?.phase;
    if (ph && ph !== "done" && ph !== "idle") seenRun = true;
    progress(`startlauf ${ph} ${s.status?.done ?? ""}/${s.status?.total ?? ""} msgs=${s.messages}`);
    if ((seenRun || Date.now() - t1 > 60_000) && (ph === "done" || ph === "stopped" || ph === "error") && (mode !== "build" || s.messages > 0 || ph === "error")) break;
    await sleep(mode === "build" ? 10_000 : 1000);
  }
  out.t.startRun = Math.round((Date.now() - t1) / 1000);
  out.t.startRunTotal = secs();
  check("startlauf", s.status?.phase === "done", s.status?.phase);

  if (mode === "profile") {
    // Wohin geht die Zeit beim Durchblättern? 1) nur messages.list/continueList über einen großen Ordner,
    // 2) Debug-Protokoll des Indexers („Seite fertig: … ms“) für einen erzwungenen Durchgang (nach 90 s angehalten)
    const acc = (await page.messenger.accounts.list(true)).find(a => a.type === "none");
    const folder = acc.rootFolder.subFolders.find(f => f.name === "Archiv-2022");
    const tl = Date.now();
    let n = 0, pages = 0;
    let res = await page.messenger.messages.list(folder.id ?? C({ accountId: folder.accountId, path: folder.path }));
    for (;;) {
      n += res.messages.length; pages++;
      if (!res.id) break;
      res = await page.messenger.messages.continueList(res.id);
    }
    out.listOnly = { mails: n, pages, s: (Date.now() - tl) / 1000 };
    progress("listOnly");
    await send({ type: "novabird-db:setDebug", on: true, enabled: true });
    send({ type: "novabird-db:fullRun", force: true });
    await sleep(90_000);
    await send({ type: "novabird-db:stop" });
    await sleep(3000);
    return finish({ ...out, pass: true });
  }

  if (mode === "rescan" && !Services.env.get("NBNOFORCE")) {
    // erzwungener Durchgang: Ordner gelten als „nicht fertig“, alle Mails schon im Index
    const before = s.messages;
    const t2 = Date.now();
    const p = send({ type: "novabird-db:fullRun", force: true });
    for (let i = 0; ; i++) {
      const r = await Promise.race([p.then(() => "fertig"), sleep(5000).then(() => null)]);
      await st();
      progress(`durchgang ${out.status.done}/${out.status.total}`);
      if (r) break;
    }
    out.t.forcedPass = Math.round((Date.now() - t2) / 1000);
    s = await st();
    check("nichtsNeu", s.messages === before, `${before} → ${s.messages}`);
    out.rate = Math.round((out.status.total || before) / Math.max(1, out.t.forcedPass));
  }
  finish({ ...out, pass: Object.values(out.checks).every(c => c.ok) });
})().catch(e => finish({ ...out, pass: false, error: String(e) }));
