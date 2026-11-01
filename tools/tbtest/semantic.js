// NovaBird-Search ohne Helper: Index (FTS), Modell im Add-on laden (WebAssembly), Mails rechnen, Bedeutungs- und
// Stichwortsuche prüfen. Für tools/tbtest/run.py (chrome-Kontext); Testmails: tools/tbtest/sem.mbox.
// Umgebung: NBTESTBASE (optional, lokaler Modellserver statt Hugging Face).
const done = arguments[arguments.length - 1];
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const T0 = Date.now();
  const secs = () => Math.round((Date.now() - T0) / 1000);
  const out = { app: Services.appinfo.version, os: Services.appinfo.OS, arch: Services.sysinfo.getProperty("arch"), t: {}, checks: {} };
  // Zwischenstand in eine Datei (NBPROGRESS), falls der Lauf hängen bleibt
  const progress = step => {
    out.step = `${step} (${secs()} s)`;
    const p = Services.env.get("NBPROGRESS");
    if (p) IOUtils.writeUTF8(p, JSON.stringify(out, null, 1)).catch(() => {});
  };
  const check = (name, ok, info) => {
    out.checks[name] = { ok: Boolean(ok), info };
    progress(name);
  };
  await sleep(3000);
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  const inbox = MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox");
  const win = Services.wm.getMostRecentWindow("mail:3pane");
  out.cores = win.navigator.hardwareConcurrency;
  const tabmail = win.document.getElementById("tabmail");
  tabmail.currentAbout3Pane.displayFolder(inbox);
  await sleep(1500);
  check("mails", inbox.getTotalMessages(false) === 6, inbox.getTotalMessages(false));

  const pol = WebExtensionPolicy.getByID("novabird-db@novabird");
  const optTab = tabmail.openTab("contentTab", { url: pol.getURL("options/options.html#semanticTab") });
  let page = null;
  for (let i = 0; i < 60 && !page?.messenger; i++) {
    await sleep(500);
    page = optTab.browser?.contentWindow?.wrappedJSObject;
  }
  if (!page?.messenger) throw new Error("Einstellungsseite von NovaBird-Search lädt nicht");
  progress("einstellungen");
  const C = o => Cu.cloneInto(o, page);
  const send = async msg => JSON.parse(JSON.stringify((await page.messenger.runtime.sendMessage(C(msg))) ?? null));
  const base = Services.env.get("NBTESTBASE") || "";
  await page.messenger.storage.local.set(C({ semanticTestBase: base, semantic: { enabled: true, idleOnly: false, path: "addon" } }));
  await sleep(500);

  progress("download");
  const dl = await send({ type: "semantic:download" });
  out.t.download = secs();
  check("download", dl?.modelStatus?.complete, dl?.error || dl?.phase);

  let s = null;
  for (let i = 0; i < 600; i++) {
    s = await send({ type: "semantic:status" });
    out.status = { phase: s.phase, vectors: s.vectors, total: s.total, engine: s.engine, error: s.error };
    progress("rechnen");
    if ((s.total && s.vectors >= s.total) || s.error) break;
    await sleep(1000);
  }
  out.t.indexed = secs();
  out.status = { phase: s.phase, vectors: s.vectors, total: s.total, rate: s.rate, engine: s.engine, threads: s.threads, loadMs: s.loadMs, error: s.error };
  check("indexed", s.total === 6 && s.vectors === 6, `${s.vectors}/${s.total} ${s.error || ""}`);
  check("engine", s.engine === "addon", s.engine);
  out.multiThread = (s.threads || 0) > 1; // nur Hinweis: ohne Threads rechnet es langsamer, aber richtig

  // Bedeutungssuche: das erwartete Wort muss im Betreff des besten Treffers stehen
  const subjectOf = async id => (await page.messenger.messages.query(C({ headerMessageId: id }))).messages[0]?.subject || "";
  const expect = {
    "Treffen der Eltern in der Schule": "Elternabend",
    "offene Rechnung bezahlen": "Mahnung",
    "was gibt es zu essen": "Speiseplan",
    "Server nicht erreichbar": "Wartungsfenster",
    "Ferien am Meer": "Mallorca",
  };
  out.queries = {};
  for (const [q, want] of Object.entries(expect)) {
    const t = Date.now();
    const r = await send({ type: "semantic:try", text: q, threshold: 0 });
    const rows = await Promise.all((r?.rows || []).slice(0, 3).map(async x => `${x.score} ${await subjectOf(x.header_msg_id)}`));
    out.queries[q] = { ms: Date.now() - t, rows, error: r?.error };
    check(`semantic: ${q}`, (rows[0] || "").includes(want), rows[0] || r?.error);
  }
  out.t.queries = secs();

  // Suchleiste: Stichwortsuche über den FTS-Index (Kompositum und Umlaute)
  const main = tabmail.tabInfo[0];
  tabmail.switchToTab(main);
  await sleep(800);
  const d3 = main.chromeBrowser.contentDocument;
  const input = d3.querySelector("#novabird-search input");
  const bar = async text => {
    input.focus();
    input.value = text;
    input.dispatchEvent(new d3.defaultView.Event("input", { bubbles: true }));
    await sleep(4000);
    return main.chromeBrowser.contentWindow.gDBView?.rowCount ?? null;
  };
  check("searchbar", Boolean(input), input ? "ok" : "keine Suchleiste");
  if (input) {
    out.bar = { plan: await bar("Plan"), mahnung: await bar("mahnung"), gemuese: await bar("Gemuesecurry") };
    check("keyword: Wortanfang „Plan“ findet Speiseplan (Kompositum)", out.bar.plan >= 1, out.bar.plan);
    check("keyword: „mahnung“ (Groß/klein)", out.bar.mahnung === 1, out.bar.mahnung);
    check("keyword: „Gemuesecurry“ findet Gemüsecurry (Umlaute)", out.bar.gemuese === 1, out.bar.gemuese);
    await bar("");
  }

  out.pass = Object.values(out.checks).every(c => c.ok);
  done(out);
})().catch(e => done({ pass: false, error: String(e), stack: e.stack }));
