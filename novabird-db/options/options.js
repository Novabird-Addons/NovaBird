const $ = (id) => document.getElementById(id);
const send = (msg) => messenger.runtime.sendMessage(msg);
const t = (k, subs) => messenger.i18n.getMessage(k, subs);
const lang = messenger.i18n.getUILanguage();
const num = (n) => (n == null ? n : Number(n).toLocaleString(lang));
const mb = (b) => (b / 1048576).toLocaleString(lang, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " MB";
const note = (text) => ($("msg").textContent = text);

document.title = t("optPageTitle");
for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);

async function refresh() {
  const s = await send({ type: "novabird-db:status" });
  const rows = [
    [t("optRowMessages"), num(s.messages)],
    [t("optRowHeadersOnly"), num(s.headersOnly)],
    [t("optRowSize"), s.sizeBytes != null ? mb(s.sizeBytes) : "–"],
    [t("optRowFts"), `${s.ftsMode}${s.fts5Loaded ? t("optFts5Loaded") : ""} · SQLite ${s.sqliteVersion}`],
    [t("optRowCatchUp"), s.lastCatchUp ? t("optCatchUpFmt", [new Date(s.lastCatchUp.at).toLocaleString(lang), String(s.lastCatchUp.added), String(s.lastCatchUp.checked)]) : t("optNotYet")],
    [t("optRowPhase"), s.status?.phase === "folder" ? t("optPhaseFolder", [s.status.folder]) : (s.status?.phase ?? "–")],
  ];
  $("status").replaceChildren(
    ...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v ?? "–";
      return [dt, dd];
    }),
  );
  $("logging").checked = Boolean(s.logSearches);
  $("debugLog").checked = Boolean(s.debugLog);
  const cm = $("compoundMode");
  if (document.activeElement !== cm) cm.value = s.compoundMode === "index" ? "index" : "query";
  cm.disabled = !s.termsFts;
  $("compoundInfo").textContent = !s.termsFts
    ? t("optCompNoFts")
    : s.compoundMode === "index"
      ? t("optCompActiveIndex", [num(s.termsVocab)])
      : t("optCompActiveQuery");
  for (const box of document.querySelectorAll("#langs input")) {
    if (document.activeElement !== box) box.checked = (s.parserLangs ?? []).includes(box.value);
  }
  const running = s.status?.phase === "folder";
  $("pause").textContent = running ? t("optPause") : s.paused ? t("optResume") : t("optCheckNow");
  const log = await send({ type: "novabird-db:getLog" });
  $("logCount").textContent = t("optLogCount", [String(log.length)]);
}

$("maintain").addEventListener("click", async () => {
  note(t("optMaintaining"));
  const r = await send({ type: "novabird-db:maintain" });
  note(r.error ? t("optError", [r.error]) : t("optDone", [mb(r.sizeBefore), mb(r.sizeAfter)]));
  refresh();
});
$("reindex").addEventListener("click", async () => {
  if (!confirm(t("optConfirmReindex"))) return;
  await send({ type: "novabird-db:reindex" });
  note(t("optReindexStarted"));
  refresh();
});
$("delete").addEventListener("click", async () => {
  if (!confirm(t("optConfirmDelete"))) return;
  await send({ type: "novabird-db:delete" });
  note(t("optDeleted"));
  refresh();
});
$("pause").addEventListener("click", async () => {
  const s = await send({ type: "novabird-db:status" });
  await send({ type: s.status?.phase === "folder" ? "novabird-db:stop" : "novabird-db:resume" });
  setTimeout(refresh, 600);
});
$("compoundMode").addEventListener("change", async () => {
  const mode = $("compoundMode").value;
  if (mode === "index" && !confirm(t("optConfirmCompound"))) {
    refresh();
    return;
  }
  const r = await send({ type: "novabird-db:setCompoundMode", mode });
  note(r.error ? t("optError", [r.error]) : mode === "index" ? t("optSwitchedIndex") : t("optSwitchedQuery"));
  refresh();
});
$("langs").addEventListener("change", async () => {
  const langs = [...document.querySelectorAll("#langs input:checked")].map((b) => b.value);
  await send({ type: "novabird-db:setParserLangs", langs }); // leer = Sprache der Oberfläche
  refresh();
});
$("logging").addEventListener("change", () => send({ type: "novabird-db:setLogging", on: $("logging").checked }));
$("debugLog").addEventListener("change", () => send({ type: "novabird-db:setDebug", on: $("debugLog").checked }));
$("clearLog").addEventListener("click", async () => {
  if (!confirm(t("optConfirmClearLog"))) return;
  await send({ type: "novabird-db:clearLog" });
  refresh();
});
$("export").addEventListener("click", async () => {
  const log = await send({ type: "novabird-db:getLog" });
  const text = log.map((e) => `${new Date(e.t).toISOString()}\t${e.q}`).join("\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
  a.download = "novabird-db-search-log.txt";
  a.click();
});

let lastEvent = 0;
const fmtTime = (ts) => new Date(ts).toLocaleTimeString(lang);
async function refreshEvents() {
  const box = $("events");
  const list = await send({ type: "novabird-db:getEvents", since: lastEvent });
  if (!list.length) return;
  const atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 8;
  for (const e of list) {
    lastEvent = e.n;
    const d = document.createElement("div");
    d.className = e.level;
    d.textContent = `${fmtTime(e.t)} ${e.msg.replace(/^\[novabird-db\] /, "")}`;
    box.append(d);
  }
  while (box.childElementCount > 400) box.firstChild.remove();
  if (atEnd) box.scrollTop = box.scrollHeight;
}
$("copyEvents").addEventListener("click", () => navigator.clipboard.writeText($("events").innerText).then(() => note(t("optLogCopied"))));
$("clearEvents").addEventListener("click", async () => {
  await send({ type: "novabird-db:clearEvents" });
  $("events").replaceChildren();
  lastEvent = 0;
});

refresh();
refreshEvents();
setInterval(refresh, 3000);
setInterval(refreshEvents, 1500);
