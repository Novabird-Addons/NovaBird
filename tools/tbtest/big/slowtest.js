// Langsame Suche im großen Testarchiv: was zeigt die Suchleiste, wenn der Index länger als die Zeitgrenze braucht?
// NBQUERIES (JSON-Liste) = Suchtexte; je Suche: Trefferzahl in der Liste, Hinweis unter dem Feld, Dauer bis fertig.
const done = arguments[arguments.length - 1];
const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
const out = { runs: [] };
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  await sleep(6000);
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  const win = Services.wm.getMostRecentWindow("mail:3pane");
  const tabmail = win.document.getElementById("tabmail");
  tabmail.currentAbout3Pane.displayFolder(MailServices.accounts.localFoldersServer.rootFolder.getChildNamed("Inbox"));
  await sleep(1500);
  const cw = tabmail.tabInfo[0].chromeBrowser.contentWindow;
  const d3 = tabmail.tabInfo[0].chromeBrowser.contentDocument;
  const bar = d3.querySelector("#novabird-search");
  const input = bar.querySelector("input");
  for (const q of JSON.parse(Services.env.get("NBQUERIES") || '["rechnung"]')) {
    const t0 = Date.now();
    input.focus();
    input.value = q;
    input.dispatchEvent(new cw.Event("input", { bubbles: true }));
    await sleep(1500);
    for (let i = 0; i < 90 && bar.hasAttribute("data-busy"); i++) await sleep(1000);
    await sleep(1500);
    out.runs.push({
      q,
      s: Math.round((Date.now() - t0) / 1000),
      rows: cw.gViewWrapper?.isSynthetic ? cw.gDBView?.rowCount ?? 0 : "keine Trefferliste",
      note: bar.querySelector(".nbs-note")?.textContent || bar.querySelector("[class*=note]")?.textContent || "",
      header: d3.getElementById("nbsHeaderNote")?.textContent || "",
    });
    // Feld leeren: zurück zur Ordneransicht
    input.value = "";
    input.dispatchEvent(new cw.Event("input", { bubbles: true }));
    await sleep(2500);
  }
  done({ ...out, pass: true });
})().catch(e => done({ ...out, pass: false, error: String(e) }));
