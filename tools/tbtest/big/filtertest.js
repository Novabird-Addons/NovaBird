// Filter vor der Höchstzahl, im großen Testarchiv (profile-new-big, siehe README): die 5 ältesten Mails im Ordner
// „Rechnungen“ werden ungelesen markiert, dann sucht die Suchleiste „rechnung“ mit dem Haken „Nur ungelesen“.
// Vorher (Filter erst nach den neuesten 1.000 Treffern): 0 Treffer. Erwartet: genau die markierten mit „Rechnung“ im Betreff. Dazu: ohne Haken meldet die
// Kopfzeile „es gibt mehr“. Am Ende werden die 5 Mails wieder als gelesen markiert.
const done = arguments[arguments.length - 1];
const { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");
const out = { checks: {} };
let finished = false;
const finish = res => { if (!finished) { finished = true; done(res); } };
setTimeout(() => finish({ ...out, pass: false, error: "Zeitlimit, zuletzt " + out.step }), 900_000);
(async () => {
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const check = (name, ok, info) => { out.checks[name] = { ok: Boolean(ok), info }; out.step = name; };
  const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
  await sleep(5000);
  const root = MailServices.accounts.localFoldersServer.rootFolder;
  const folder = root.getChildNamed("Rechnungen");
  const hdrs = [];
  for (const h of folder.msgDatabase.enumerateMessages()) {
    hdrs.push(h);
    if (hdrs.length === 5) break;
  }
  // erwartet: die markierten mit „Rechnung“ im Betreff (die erzeugten Rechnungen heißen je nach Sprache auch Invoice/Facture/Factura)
  const want = new Set(hdrs.filter(h => /rechnung/i.test(h.mime2DecodedSubject)).map(h => h.messageId));
  folder.markMessagesRead(hdrs, false);
  out.marked = hdrs.map(h => h.mime2DecodedSubject);
  await sleep(8000); // Index übernimmt is_read über messages.onUpdated

  const win = Services.wm.getMostRecentWindow("mail:3pane");
  const tabmail = win.document.getElementById("tabmail");
  tabmail.currentAbout3Pane.displayFolder(root.getChildNamed("Inbox"));
  await sleep(1500);
  const cw = tabmail.tabInfo[0].chromeBrowser.contentWindow;
  const d3 = tabmail.tabInfo[0].chromeBrowser.contentDocument;
  const bar = d3.querySelector("#novabird-search");
  const input = bar.querySelector("input");
  const type = async (text, state) => {
    bar._nbsState = { ...bar._nbsState, ...state };
    input.focus();
    input.value = text;
    input.dispatchEvent(new cw.Event("input", { bubbles: true }));
    for (let i = 0; i < 60; i++) {
      await sleep(1000);
      if (cw.gViewWrapper?.isSynthetic && !bar.hasAttribute("data-busy")) break;
    }
    await sleep(2500);
  };
  const subjects = () => Array.from({ length: Math.min(cw.gDBView?.rowCount ?? 0, 20) }, (_, i) => cw.gDBView.getMsgHdrAt(i).messageId);

  await type("rechnung", { unread: true });
  const n = cw.gDBView?.rowCount ?? 0;
  const got = subjects();
  out.unreadHits = { n, got };
  check("ungelesen_alte_gefunden", n === want.size && want.size > 0 && got.every(id => want.has(id)), { n, want: want.size });

  await type("rechnung ", { unread: false });
  const note = d3.getElementById("nbsHeaderNote")?.textContent || "";
  out.noUnread = { n: cw.gDBView?.rowCount ?? 0, note };
  check("hinweis_es_gibt_mehr", /mehr|more/i.test(note), note);

  folder.markMessagesRead(hdrs, true);
  await sleep(3000);
  finish({ ...out, pass: Object.values(out.checks).every(c => c.ok) });
})().catch(e => finish({ ...out, pass: false, error: String(e) }));
