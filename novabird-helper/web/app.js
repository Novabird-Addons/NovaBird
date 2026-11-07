// NovaBird Helper – Web-Oberfläche. Spricht nur mit /api/ desselben Servers; Sitzung per Cookie, ändernde Anfragen mit X-CSRF.
// Texte in i18n.js (Deutsch, Englisch); X-Lang sagt dem Helper, in welcher Sprache er Zustände und Fehler liefern soll.
"use strict";

const $ = id => document.getElementById(id);
const locale = () => (LANG === "de" ? "de-DE" : "en-GB");
const N = n => (n == null ? "–" : new Intl.NumberFormat(locale()).format(n));
const GB = b => (b / 1e9).toLocaleString(locale(), { maximumFractionDigits: 1 }) + " GB";
let session = null;
let page = "status";
let timer = null;

// ---- Server ------------------------------------------------------------------------------------------------------------
async function api(path, body) {
  const headers = { "X-Lang": LANG };
  const opt = body === undefined ? { headers } : {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", "X-CSRF": session?.csrf || "" },
    body: JSON.stringify(body),
  };
  const r = await fetch("/api/" + path, { credentials: "same-origin", ...opt });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401 && path !== "login") {
    session = { ...(session || {}), user: null, csrf: null }; // Sitzung abgelaufen (z. B. Helper neu gestartet): Anmelden bleibt möglich
    showAuth();
    throw new Error(data.error || t("pleaseLogin"));
  }
  if (!r.ok) throw new Error(data.error || t("errorStatus", r.status));
  return data;
}

function toast(text) {
  const el = $("toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => (el.hidden = true), 4000);
}

function banner(text) {
  $("banner").textContent = text || "";
  $("banner").hidden = !text;
}

const isAdmin = () => session?.role === "admin";
const isCalendarOnly = () => session?.role === "calendar";
const roleText = role => t(role === "admin" ? "roleAdmin" : role === "calendar" ? "roleCalendar" : "roleViewer");
const homePage = () => (isCalendarOnly() ? "kalender" : "status");

// ---- Sprache -----------------------------------------------------------------------------------------------------------
$("langSwitch").addEventListener("click", () => {
  setLang(LANG === "de" ? "en" : "de");
  if (session?.user) {
    $("whoName").textContent = `${session.user} (${roleText(session.role)})`;
    prompts = null;
    refresh(true);
  } else if (session) showAuth();
});

// ---- Anmelden / Einrichten ---------------------------------------------------------------------------------------------
async function start() {
  applyI18n();
  session = await api("session");
  $("version").textContent = session.version;
  if (session.user) showApp();
  else showAuth();
}

function showAuth() {
  clearInterval(timer);
  $("app").hidden = true;
  $("whoBox").hidden = true;
  $("auth").hidden = false;
  const setup = session?.setup;
  $("authTitle").textContent = setup ? t("setupTitle") : t("login");
  $("authButton").textContent = setup ? t("setupButton") : t("login");
  $("confirmRow").hidden = !setup;
  $("loginForm").password.autocomplete = setup ? "new-password" : "current-password";
  $("authText").textContent = setup
    ? (session.setupAllowed ? t("setupText") : t("setupRemote", `http://localhost:${location.port}/`))
    : "";
  $("authButton").disabled = setup && !session.setupAllowed;
  $("loginForm").name.focus();
}

$("loginForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  $("authError").textContent = "";
  try {
    if (session.setup) {
      if (f.password.value !== f.confirm.value) throw new Error(t("passwordsDiffer"));
      session = await api("setup", { name: f.name.value.trim(), password: f.password.value });
    } else {
      session = await api("login", { name: f.name.value.trim(), password: f.password.value });
    }
    f.reset();
    showApp();
  } catch (err) {
    $("authError").textContent = err.message;
  }
});

$("logout").addEventListener("click", async () => {
  await api("logout", {}).catch(() => {});
  session = await api("session");
  showAuth();
});

// ---- Oberfläche --------------------------------------------------------------------------------------------------------
function showApp() {
  $("auth").hidden = true;
  $("app").hidden = false;
  $("whoBox").hidden = false;
  $("whoName").textContent = `${session.user} (${roleText(session.role)})`;
  for (const el of document.querySelectorAll("[data-admin]")) el.hidden = !isAdmin();
  // „Nur Kalender“: nur Kalender und eigenes Konto
  if (isCalendarOnly()) for (const a of document.querySelectorAll("#tabs a")) a.hidden = !["kalender", "konto"].includes(a.dataset.page);
  // Gruppen (KI, Einstellungen): Überschrift nur, wenn darunter etwas sichtbar ist
  for (const g of document.querySelectorAll("#tabs .group")) g.hidden = ![...g.querySelectorAll("a")].some(a => !a.hidden);
  for (const el of document.querySelectorAll("#settingsForm input, #netForm input, #promptForm textarea")) el.disabled = !isAdmin();
  if (location.hash === "#wizard" && isAdmin()) startWizard();
  else go(location.hash.slice(1) || homePage());
  clearInterval(timer);
  timer = setInterval(() => refresh(false), 2000);
}

function go(name) {
  const link = document.querySelector(`#tabs a[data-page="${name}"]`);
  if (!link || link.hidden) name = homePage();
  page = name;
  for (const a of document.querySelectorAll("#tabs a")) a.classList.toggle("active", a.dataset.page === name);
  for (const s of document.querySelectorAll("[data-section]")) s.hidden = s.dataset.section !== name;
  banner("");
  refresh(true);
}

window.addEventListener("hashchange", () => {
  if (!session?.user) return;
  if (location.hash === "#wizard" && isAdmin()) startWizard();
  else go(location.hash.slice(1));
});

// ---- Einrichtung nach der Installation (#wizard): Schritte über die vorhandenen Seiten ---------------------------------
// Was soll der Helper machen (Bedeutungssuche, Sprachmodell, Vorlesen), wie lange im Speicher, im Netz – zum Schluss Geräte koppeln
const WIZ = [
  { page: "status", title: "wizSearchTitle", text: "wizSearchText" },
  { page: "sprachmodell", title: "wizLlmTitle", text: "wizLlmText" },
  { page: "vorlesen", title: "wizTtsTitle", text: "wizTtsText" },
  { page: "einstellungen", title: "wizNetTitle", text: "wizNetText" },
  { page: "pcs", title: "wizPcsTitle", text: "wizPcsText" },
];
let wizStep = -1;
function startWizard() {
  wizStep = 0;
  wizShow();
}
function wizShow() {
  const on = wizStep >= 0 && wizStep < WIZ.length;
  $("wizBar").hidden = !on;
  if (!on) return;
  const w = WIZ[wizStep];
  history.replaceState(null, "", "#" + w.page);
  go(w.page);
  $("wizBar").hidden = false; // go() blendet Hinweise aus, die Leiste bleibt
  $("wizStep").textContent = t("wizStep", wizStep + 1, WIZ.length);
  $("wizTitle").textContent = t(w.title);
  $("wizText").textContent = t(w.text);
  $("wizBack").hidden = wizStep === 0;
  $("wizNext").textContent = wizStep === WIZ.length - 1 ? t("wizDone") : t("wizNext");
}
$("wizBack").addEventListener("click", () => { wizStep--; wizShow(); });
$("wizNext").addEventListener("click", () => {
  wizStep++;
  if (wizStep >= WIZ.length) { wizStep = -1; $("wizBar").hidden = true; toast(t("wizFinished")); return; }
  wizShow();
});
$("wizEnd").addEventListener("click", () => { wizStep = -1; $("wizBar").hidden = true; });

// Gruppen der Navigation (KI, Einstellungen) ein- und ausklappen; gemerkt im Browser (nur Bequemlichkeit, darf fehlen)
const NAV_KEY = "nbNavCollapsed";
function navCollapsed() {
  try {
    return JSON.parse(localStorage.getItem(NAV_KEY) || "{}") || {};
  } catch {
    return {};
  }
}
for (const g of document.querySelectorAll("#tabs .group")) {
  const title = g.querySelector(".group-title");
  const set = closed => {
    g.classList.toggle("collapsed", closed);
    title.setAttribute("aria-expanded", String(!closed));
  };
  set(Boolean(navCollapsed()[title.dataset.i18n]));
  title.addEventListener("click", () => {
    const closed = !g.classList.contains("collapsed");
    set(closed);
    try {
      localStorage.setItem(NAV_KEY, JSON.stringify({ ...navCollapsed(), [title.dataset.i18n]: closed }));
    } catch {
      /* ohne Speicher: gilt nur bis zum Neuladen */
    }
  });
}

async function refresh(full) {
  try {
    if (page === "status") await showStatus();
    else if (page === "pcs") await showPcs();
    else if (page === "sprachmodell") await showLlm(full);
    else if (page === "vorlesen") await showTts(full);
    else if (full && page === "verbindung") await showConnection();
    else if (full && page === "kalender") await showCalendars();
    else if (full && page === "extern") await showExt();
    else if (full && page === "einstellungen") await showSettings();
    else if (full && page === "benutzer") await showUsers();
    else if (full && page === "protokoll") await showLog();
  } catch (err) {
    if (session?.user) banner(err.message);
  }
}

function row(cells) {
  const tr = document.createElement("tr");
  for (const c of cells) {
    const td = document.createElement("td");
    if (c instanceof Node) td.append(c);
    else if (c && typeof c === "object") {
      td.className = c.cls || "";
      td.textContent = c.text;
    } else td.textContent = c ?? "";
    tr.append(td);
  }
  return tr;
}

function button(text, cls, onClick, disabled = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = text;
  b.disabled = disabled;
  b.addEventListener("click", async () => {
    try {
      await onClick();
    } catch (err) {
      banner(err.message);
    }
  });
  return b;
}

function actionsCell(...buttons) {
  const box = document.createElement("span");
  box.className = "actions";
  box.style.margin = "0";
  box.append(...buttons.filter(Boolean));
  return box;
}

// ---- Auslastung (Statusseite) ---------------------------------------------------------------------------------------------
// Eine Zeile: Bezeichnung, Balken (Anteil 0–100, ab 85 % rot), Wert; ohne Wert „–“ ohne Balken
function meter(label, text, pct) {
  const row = document.createElement("div");
  row.className = "meter";
  const name = document.createElement("span");
  name.textContent = label;
  const bar = document.createElement("span");
  bar.className = "bar";
  const fill = document.createElement("i");
  if (pct != null) {
    fill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
    fill.classList.toggle("high", pct >= 85);
    bar.append(fill);
  }
  const value = document.createElement("span");
  value.className = "num";
  value.textContent = text ?? "–";
  row.append(name, value, bar);
  return row;
}

const pctText = v => (v == null ? null : `${Math.round(v)} %`);

function showUsage(u) {
  const g = u.gpu;
  const total = g.vramTotal || 0;
  $("uGpuName").textContent = g.name || "–";
  $("uGpuRows").replaceChildren(
    meter(t("uVram"), g.vramUsed == null ? null : t("uOf", GB(g.vramUsed), GB(total)), g.vramUsed == null || !total ? null : (g.vramUsed / total) * 100),
    meter(t("uGpuLoad"), pctText(g.util), g.util),
  );
  // Sprachmodell
  const l = u.llm;
  $("uLlmName").textContent = (l.model || (l.selected || "").replace(/^ollama:/, "")) || "–";
  let state;
  if (l.winml) state = t("uWinml");
  else if (!l.selected) state = t("uNoModel");
  else if (!l.ollama) state = t("uOllamaOff");
  else if (!l.model) state = t("uNotLoaded");
  else {
    const share = l.size ? Math.round((l.sizeVram / l.size) * 100) : 0;
    const exp = l.expires ? new Date(l.expires) : null;
    state = t("uLoadedFmt", N(l.context || 0), `${share} %`)
      + (exp && exp.getFullYear() > 2000 && exp.getFullYear() < 2100 ? t("uUntil", exp.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })) : exp ? t("uKeep") : "")
      + (l.busy ? t("uWorking") : "");
  }
  $("uLlmState").textContent = state;
  $("uLlmRows").replaceChildren(...(l.ollama ? [
    meter(t("uVram"), l.gpuMem == null ? null : GB(l.gpuMem), l.gpuMem == null || !total ? null : (l.gpuMem / total) * 100),
    meter(t("uRam"), GB(l.ram), (l.ram / u.totalRam) * 100),
    meter(t("uGpuLoad"), pctText(l.gpuUtil), l.gpuUtil),
    meter(t("uCpu"), pctText(l.cpu), l.cpu),
  ] : []));
  // Suchmodell (Helper-Prozess)
  const e = u.embed;
  $("uEmbedName").textContent = e.model.split("/").pop();
  $("uEmbedState").textContent = (e.loadedOn ? t("uEmbedOn", e.deviceName || e.loadedOn) : t("uEmbedOff")) + (e.rate > 0 ? t("uRateFmt", N(e.rate)) : "");
  $("uEmbedRows").replaceChildren(
    meter(t("uVram"), e.gpuMem == null ? null : GB(e.gpuMem), e.gpuMem == null || !total ? null : (e.gpuMem / total) * 100),
    meter(`${t("uRam")} (${t("uHelperTotal")})`, GB(e.ram), (e.ram / u.totalRam) * 100),
    meter(t("uGpuLoad"), pctText(e.gpuUtil), e.gpuUtil),
    meter(t("uCpu"), pctText(e.cpu), e.cpu),
  );
  $("uNote").hidden = g.util != null;
  $("uNote").textContent = t("uNoCounters");
}

// ---- Status ------------------------------------------------------------------------------------------------------------
async function showStatus() {
  const [s, p, u] = await Promise.all([api("status"), api("pcs"), api("usage").catch(() => null)]);
  if (u) showUsage(u);
  $("sState").textContent = s.state;
  $("sRate").textContent = s.rateCpu > 0 ? t("rateSplit", s.rate, s.rateGpu, s.rateCpu) : t("rateFmt", s.rate);
  $("sQueue").textContent = t("queueFmt", s.queue);
  $("sPcs").textContent = p.pcs.filter(x => Date.now() - Date.parse(x.lastSeen) < 864e5).length;
  $("sDevice").textContent = (s.deviceName || "–") + (s.measured && !s.fallback ? t("measured", Math.round(s.measured)) : "");
  $("sFallback").hidden = !s.fallback;
  if (s.fallback) $("sFallback").textContent = t("fallbackNote", s.fallback.name, new Date(s.fallback.time).toLocaleString(locale()), s.fallback.error);
  $("sModel").textContent = s.model.ready ? t("modelReady") : s.model.complete ? t("modelNotMeasured") : t("modelMissing");
  $("sCpu").textContent = s.cpuBlocked ? t("cpuBlocked", s.cpuBlocked) : s.cpu ? t("cpuOn", s.cpuThreads) : t("off");
  $("sMode").textContent = s.mode === "service" ? t("modeService") : t("modeUser");
  $("sStarted").textContent = new Date(s.started).toLocaleString(locale());
  const v = s.vectors;
  $("sVec").textContent = !v.enabled ? t("off") : t("vecFmt", N(v.count), GB(v.bytes)) + (v.phone ? t("vecPhone", N(v.phone)) : "") + (v.hits + v.misses > 0 ? t("vecSince", N(v.hits), N(v.stored)) : "");
  $("sChat").textContent = !s.chat.selected ? t("chatNone")
    : `${s.chat.selected.replace(/^ollama:/, "")}${s.chat.loaded === s.chat.selected ? t("chatLoaded") : ""}${s.chat.busy ? t("chatBusy") : ""}`;
  progress("sProg", s.preparing, s.preparingPct);
  $("measure").disabled = !!s.preparing;
  $("measure").textContent = s.model.complete ? t("measure") : t("measureLoad");
  banner(s.error || "");
  $("sDevices").replaceChildren(...(s.devices || []).map(d => row([
    d.name || d.device,
    { text: d.error ? "–" : (d.mailsPerSec ?? 0).toFixed(1), cls: "num" },
    d.device === s.device ? t("inUse") : d.error || "",
  ])));
}

$("measure").addEventListener("click", async () => {
  const s = await api("status");
  if (!s.model.complete && !confirm(t("confirmModelDownload"))) return;
  await api("measure", {});
  toast(t("measuring"));
});

// ---- PCs ---------------------------------------------------------------------------------------------------------------
async function showPcs() {
  const { pcs } = await api("pcs");
  let done = 0, all = 0;
  $("pcList").replaceChildren(...pcs.map(pc => {
    done += pc.indexed || 0;
    all += pc.mails || 0;
    let idx = "–";
    if (pc.mails > 0 && pc.indexed != null) {
      const pct = Math.min(100, Math.floor((pc.indexed * 100) / pc.mails));
      const span = document.createElement("span");
      const bar = document.createElement("span");
      bar.className = "bar";
      const fill = document.createElement("i");
      fill.style.width = pct + "%";
      bar.append(fill);
      span.append(t("indexedFmt", N(pc.indexed), N(pc.mails), pct), bar);
      idx = span;
    }
    const seen = new Date(pc.lastSeen);
    const today = seen.toDateString() === new Date().toDateString();
    const cells = [pc.label, pc.group || "–", idx, { text: N(pc.total), cls: "num" }, { text: N(pc.today), cls: "num" },
      today ? t("todayAt", seen.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })) : seen.toLocaleString(locale())];
    if (isAdmin()) {
      cells.push(button(t("remove"), "link danger", async () => {
        if (!confirm(t("confirmForget", pc.label))) return;
        await api("pcs/forget", { id: pc.id });
        showPcs();
      }));
    }
    return row(cells);
  }));
  $("pcSum").textContent = pcs.length === 0 ? t("noPcs") : t("pcsSum", pcs.length, N(done), N(all));
  if (isAdmin()) await showPairing();
}

// ---- Kopplung (Pairing.cs): Modus starten, Anfragen mit Vergleichszahl zulassen oder ablehnen ------------------------------
let pairGroups = false;
async function showPairing() {
  const p = await api("pairing");
  if (!pairGroups) {
    pairGroups = true;
    const { groups } = await api("connection");
    $("pairGroup").replaceChildren(...groups.map(g => Object.assign(document.createElement("option"), { value: g.id, textContent: g.name })));
    $("pairGroup").hidden = groups.length < 2;
  }
  $("pairStart").hidden = p.active;
  $("pairStop").hidden = !p.active;
  $("pairGroup").disabled = p.active;
  $("pairState").textContent = p.active ? t("pairActive", `${Math.floor(p.seconds / 60)}:${String(p.seconds % 60).padStart(2, "0")}`) : "";
  $("pairList").replaceChildren(...p.requests.map(r => {
    const sas = document.createElement("span");
    sas.className = "sas";
    sas.textContent = `${r.sas.slice(0, 3)} ${r.sas.slice(3)}`;
    const state = { pending: t("pairPending"), ok: t("pairOk"), denied: t("pairDenied") }[r.state] || r.state;
    const cells = [r.label, r.ip, sas, state];
    if (r.state === "pending") {
      const box = document.createElement("span");
      box.append(button(t("pairAllow"), "primary", () => decide(r.req, true)), " ", button(t("pairDeny"), "link danger", () => decide(r.req, false)));
      cells.push(box);
    } else cells.push("");
    return row(cells);
  }));
  $("pairTable").hidden = !p.requests.length;
}
async function decide(req, allow) {
  await api("pairing/decide", { req, allow });
  showPairing();
}
$("pairStart").addEventListener("click", async () => {
  await api("pairing/start", { group: $("pairGroup").value || null });
  showPairing();
});
$("pairStop").addEventListener("click", async () => {
  await api("pairing/stop", {});
  showPairing();
});

// ---- Sprachmodell -------------------------------------------------------------------------------------------------------
let prompts = null; // {defaults, custom} – nur beim Öffnen der Seite laden (Eingaben nicht überschreiben)

async function showLlm(full) {
  const l = await api("llm");
  const o = l.ollama;
  const sel = l.selected || "";
  const selText = sel ? sel.replace(/^ollama:/, "") + (sel.startsWith("ollama:") ? " (Ollama)" : " (Windows ML)") : t("none");
  $("lState").textContent = t("chosen", selText) + (l.busy ? t("busyNow") : "") + (l.waiting > 0 ? t("waitingFmt", l.waiting) : "");
  // Ollama
  $("oState").textContent = (o.installed ? t("ollamaStateFmt", o.version, o.status) + (o.enabled ? "" : t("ollamaDisabled")) : o.installing ? "" : t("ollamaNotInstalled")) +
    (o.error ? ` · ${o.error}` : "");
  progress("oInstallProg", o.installing, o.installingPct);
  progress("oPullProg", o.pulling, o.pullingPct);
  $("oInstall").hidden = !isAdmin() || o.installed || !!o.installing;
  $("oToggle").hidden = !isAdmin() || !o.installed;
  $("oToggle").textContent = o.enabled ? t("ollamaOff") : t("ollamaOn");
  $("oPullForm").hidden = !isAdmin() || !o.running;
  $("oPullButton").disabled = !!o.pulling;
  if (!o.running) $("oTable").hidden = true;
  if (o.running && (full || o.pulling || !showLlm.lastPull !== !o.pulling)) {
    const models = o.models || [];
    $("oTable").hidden = models.length === 0;
    $("oList").replaceChildren(...models.map(m => {
      const c = o.catalog.find(x => x.name === m.name);
      const chosen = sel === "ollama:" + m.name;
      const btns = !isAdmin() ? [] : [
        button(chosen ? t("chosenShort") : t("use"), "link", async () => { await api("llm/select", { name: "ollama:" + m.name }); showLlm(true); }, chosen),
        button(t("delete"), "link danger", async () => {
          if (confirm(t("confirmDeleteModel", m.name))) await api("ollama/delete", { name: m.name });
          showLlm(true);
        }),
      ];
      const label = (c ? c.label.split(" – ")[0].split(" (")[0] : m.name) + (chosen ? " ✓" : "");
      return row([label, { text: GB(m.bytes) + (m.vram ? t("loadedVram", GB(m.vram)) : ""), cls: "num" }, actionsCell(...btns)]);
    }));
    // Auswahlliste: die zwei empfohlenen (noch nicht geladenen) Modelle, dann „Anderes Modell …“
    const pick = $("oPick");
    const keep = pick.value;
    const options = o.catalog.filter(c => !models.some(m => m.name === c.name))
      .map(c => Object.assign(document.createElement("option"), { value: c.name, textContent: `${c.label} · ${t("about", String(c.gb).replace(".", LANG === "de" ? "," : "."))}` }));
    options.push(Object.assign(document.createElement("option"), { value: "", textContent: t("otherModel") }));
    pick.replaceChildren(...options);
    if ([...pick.options].some(x => x.value === keep)) pick.value = keep;
    $("oCustomRow").hidden = pick.value !== "";
  }
  showLlm.lastPull = o.pulling;
  progress("lProg", l.importing, l.importingPct);
  if (full) showOptions(l.options);
  if (!full && !l.importing && !showLlm.lastImport) return;
  showLlm.lastImport = l.importing;
  // Windows ML
  $("lList").replaceChildren(...l.models.map(m => {
    const chosen = m.name === sel;
    const btns = !isAdmin() ? [] : [
      button(chosen ? t("chosenShort") : t("use"), "link", async () => { await api("llm/select", { name: m.name }); showLlm(true); }, chosen),
      button(t("delete"), "link danger", async () => {
        if (confirm(t("confirmDeleteModelSize", m.name, GB(m.bytes)))) await api("llm/delete", { name: m.name });
        showLlm(true);
      }),
    ];
    return row([m.name + (chosen ? " ✓" : ""), m.type, { text: m.context ? N(m.context) : "–", cls: "num" }, { text: GB(m.bytes), cls: "num" }, actionsCell(...btns)]);
  }));
  // Anweisung
  if (full && !prompts) await showPrompt();
  const test = $("testForm").text;
  if (!test.value || test.value === I18N.de.testSample || test.value === I18N.en.testSample) test.value = t("testSample");
}

async function showPrompt() {
  prompts = await api("prompt");
  const f = $("promptForm");
  f.mail.value = prompts.custom?.mail ?? prompts.defaults.mail;
  f.thread.value = prompts.custom?.thread ?? prompts.defaults.thread;
  $("pState").textContent = prompts.custom ? t("promptIsCustom") : t("promptIsDefault");
  $("promptReset").disabled = !prompts.custom;
}

$("promptForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    // Unverändert = Standard: dann nichts Eigenes speichern
    const mail = f.mail.value.trim() === prompts.defaults.mail.trim() ? null : f.mail.value;
    const thread = f.thread.value.trim() === prompts.defaults.thread.trim() ? null : f.thread.value;
    await api("prompt", { mail, thread });
    $("pSaved").hidden = false;
    setTimeout(() => ($("pSaved").hidden = true), 2500);
    await showPrompt();
  } catch (err) {
    banner(err.message);
  }
});

$("promptReset").addEventListener("click", async () => {
  if (!confirm(t("confirmPromptReset"))) return;
  try {
    await api("prompt", {});
    await showPrompt();
  } catch (err) {
    banner(err.message);
  }
});

$("oInstall").addEventListener("click", async () => {
  const l = await api("llm");
  if (!confirm(t("confirmOllamaInstall", l.ollama.version))) return;
  try {
    await api("ollama/install", {});
    showLlm(true);
  } catch (err) {
    banner(err.message);
  }
});

$("oToggle").addEventListener("click", async () => {
  const l = await api("llm");
  await api("ollama/enable", { on: !l.ollama.enabled });
  showLlm(true);
});

$("oPick").addEventListener("change", () => {
  $("oCustomRow").hidden = $("oPick").value !== "";
});

$("oPullForm").addEventListener("submit", async e => {
  e.preventDefault();
  const name = e.target.pick.value || e.target.custom.value.trim();
  if (!name) return banner(t("needModelName"));
  try {
    await api("ollama/pull", { name });
    e.target.custom.value = "";
    showLlm(true);
  } catch (err) {
    banner(err.message);
  }
});

$("importForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("llm/import", { path: e.target.path.value });
    toast(t("importing"));
    showLlm(true);
  } catch (err) {
    banner(err.message);
  }
});

$("testForm").addEventListener("submit", async e => {
  e.preventDefault();
  const out = $("testOut");
  $("testButton").disabled = true;
  out.hidden = false;
  out.textContent = "…";
  $("testStats").textContent = "";
  const t0 = performance.now();
  try {
    const { id } = await api("llm/test", { text: e.target.text.value });
    let text = "";
    for (;;) {
      const r = await api("llm/poll", { id });
      text += r.text;
      out.textContent = text || "…";
      if (r.error) throw new Error(r.error);
      if (r.done) {
        const s = r.stats || {};
        $("testStats").textContent = t("testStats", (s.model || "").replace(/^ollama:/, ""), s.firstMs, s.tokPerSec ?? "–", ((performance.now() - t0) / 1000).toFixed(1));
        break;
      }
      if (!r.text) await new Promise(res => setTimeout(res, 20)); // der Helper wartet selbst bis zu 1 s
    }
  } catch (err) {
    banner(err.message);
  } finally {
    $("testButton").disabled = false;
  }
});

// ---- Verbindung --------------------------------------------------------------------------------------------------------
async function showConnection() {
  showNet().catch(err => banner(err.message));
  const c = await api("connection");
  $("cAddresses").replaceChildren(...c.addresses.map(a => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.className = "code small";
    code.textContent = a;
    li.append(code, button(t("copy"), "", () => copy(a)));
    return li;
  }));
  showGroups(c);
  $("cSecurity").textContent = t("connSecurity", c.port);
  $("cCert").hidden = !c.webFingerprint;
  $("cFinger").textContent = (c.webFingerprint || "").replace(/(..)(?!$)/g, "$1:");
}

// Erweiterte Optionen (Ollama): Formular nur füllen, wenn nicht gerade bearbeitet
function showOptions(opt) {
  const f = $("optForm");
  if (f.contains(document.activeElement)) return;
  f.context.replaceChildren(...opt.contexts.map(c => new Option(t("ctx" + c), c)));
  f.keepAlive.replaceChildren(...opt.keepAlives.map(k => new Option(t("keep" + k), k)));
  f.context.value = String(opt.context);
  f.keepAlive.value = opt.keepAlive;
  f.temperature.value = opt.temperature;
  f.topP.value = opt.topP;
  f.kvCompress.checked = opt.kvCompress;
  for (const el of f.querySelectorAll("input, select")) el.disabled = !isAdmin();
}

async function saveOptions(body) {
  const l = await api("llm/options", body);
  showOptions(l.options);
  if (l.restarting) toast(t("optRestarting"));
  else {
    $("optSaved").hidden = false;
    setTimeout(() => ($("optSaved").hidden = true), 2500);
  }
}

$("optForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await saveOptions({ context: Number(f.context.value), temperature: Number(f.temperature.value), topP: Number(f.topP.value), keepAlive: f.keepAlive.value, kvCompress: f.kvCompress.checked });
  } catch (err) {
    banner(err.message);
  }
});
$("optReset").addEventListener("click", async () => {
  try {
    document.activeElement?.blur();
    await saveOptions({ reset: true });
  } catch (err) {
    banner(err.message);
  }
});

// ---- Vorlesen (Qwen3-TTS) -------------------------------------------------------------------------------------------------
async function showTts(full) {
  const s = await api("tts");
  const state = s.installing ? "" : !s.installed ? t("ttsNotInstalled", N(s.downloadMb))
    : !s.enabled ? t("ttsOffState") : s.running ? t("ttsRunning") : t("ttsReady");
  $("tState").textContent = state + (s.error ? ` · ${s.error}` : "");
  progress("tInstallProg", s.installing, s.installingPct);
  $("tInstall").hidden = !isAdmin() || !!s.installing || (s.installed && !s.error);
  $("tInstall").textContent = s.installed ? t("ttsReinstall") : t("ttsInstall", N(s.downloadMb));
  $("tToggle").hidden = !isAdmin() || !s.installed || !!s.installing;
  $("tToggle").textContent = s.enabled ? t("ttsOff") : t("ttsOn");
  $("tRemove").hidden = !isAdmin() || !s.installed || !!s.installing;
  const ready = s.installed && s.enabled && s.voices.length > 0;
  $("tVoiceForm").hidden = !ready;
  $("tTestForm").hidden = !ready;
  // Auswahllisten nur beim Öffnen füllen (Eingaben nicht überschreiben)
  if (!full && showTts.filled === ready) return;
  showTts.filled = ready;
  const f = $("tVoiceForm");
  for (const lang of ["german", "english"]) {
    f[lang].replaceChildren(...s.voices.filter(v => v.lang === lang).map(v => new Option(v.name, v.name)));
    const want = lang === "german" ? s.voiceGerman : s.voiceEnglish;
    if (want) f[lang].value = want;
    f[lang].disabled = !isAdmin();
  }
  f.keep.replaceChildren(...s.keeps.map(k => new Option(t("keep" + k), k)));
  f.keep.value = s.keep;
  f.keep.disabled = !isAdmin();
  const tf = $("tTestForm");
  tf.voice.replaceChildren(...s.voices.map(v => new Option(`${v.name} (${v.lang === "german" ? t("ttsLangDe") : t("ttsLangEn")})`, v.name)));
  if (!tf.text.value) tf.text.value = t("ttsSample");
}

$("tInstall").addEventListener("click", async () => {
  const s = await api("tts");
  if (!confirm(t("confirmTtsInstall", N(s.downloadMb)))) return;
  try {
    await api("tts/install", {});
    showTts(true);
  } catch (err) {
    banner(err.message);
  }
});

$("tToggle").addEventListener("click", async () => {
  const s = await api("tts");
  await api("tts/enable", { on: !s.enabled });
  showTts(true);
});

$("tRemove").addEventListener("click", async () => {
  if (!confirm(t("confirmTtsRemove"))) return;
  try {
    await api("tts/remove", {});
    showTts(true);
  } catch (err) {
    banner(err.message);
  }
});

$("tVoiceForm").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    await api("tts/voices", { german: e.target.german.value, english: e.target.english.value });
    await api("tts/keep", { keep: e.target.keep.value });
    $("tSaved").hidden = false;
    setTimeout(() => ($("tSaved").hidden = true), 2500);
  } catch (err) {
    banner(err.message);
  }
});

// Hörprobe: der Helper spricht, der Browser spielt ab (erster Satz nach dem Start etwa 6 s, danach etwa 1 s)
let ttsAudio = null;
$("tTestForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const button = f.querySelector("button");
  const voice = f.voice.value;
  const lang = voice.startsWith("en_") ? "english" : "german";
  button.disabled = true;
  $("tTestInfo").textContent = t("ttsTesting");
  const t0 = performance.now();
  try {
    const r = await fetch("/api/tts/test", {
      method: "POST", credentials: "same-origin",
      headers: { "X-Lang": LANG, "Content-Type": "application/json", "X-CSRF": session?.csrf || "" },
      body: JSON.stringify({ text: f.text.value, lang, voice }),
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
    const blob = await r.blob();
    ttsAudio?.pause();
    if (ttsAudio) URL.revokeObjectURL(ttsAudio.src);
    ttsAudio = new Audio(URL.createObjectURL(blob));
    await ttsAudio.play();
    $("tTestInfo").textContent = t("ttsTestDone", ((performance.now() - t0) / 1000).toFixed(1));
  } catch (err) {
    $("tTestInfo").textContent = "";
    banner(err.message);
  } finally {
    button.disabled = false;
    showTts(false);
  }
});

// Fortschrittsbalken: Text + Prozent (null/-1 = läuft, Dauer unbekannt); ohne Text ausgeblendet
function progress(id, text, pct) {
  const box = $(id);
  box.hidden = !text;
  if (!text) return;
  const bar = box.querySelector("progress");
  if (pct == null || pct < 0) bar.removeAttribute("value");
  else bar.value = pct;
  box.querySelector("span").textContent = text;
}

// ---- Externe Programme (OpenAI-kompatibel) -------------------------------------------------------------------------------
function showExtData(x) {
  const f = $("extForm");
  f.enabled.checked = x.enabled;
  f.lanHttp.checked = x.lanHttp;
  for (const el of f.querySelectorAll("input")) el.disabled = !isAdmin();
  $("xState").textContent = !x.enabled ? t("extOff") : (x.ollamaRunning ? t("extReady") : t("extNoOllama")) + (x.webLan ? "" : " " + t("extLocalOnly"));
  $("xUrls").replaceChildren(...x.urls.map(u => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.className = "code small";
    code.textContent = u;
    li.append(code, button(t("copy"), "", () => copy(u)));
    return li;
  }));
  $("xModel").textContent = x.defaultModel ? t("extModelFmt", x.defaultModel) : t("extModelNone");
  $("xCert").hidden = !x.fingerprint;
  $("xKeys").replaceChildren(...x.keys.map(k => row([
    k.name + (k.prefix ? ` (${k.prefix})` : ""),
    k.ips.length ? k.ips.join(", ") : t("allAddresses"),
    k.created,
    k.lastUsed ? `${k.lastUsed} · ${k.lastIp}` : "–",
    { text: N(k.uses), cls: "num" },
    actionsCell(isAdmin() && button(t("delete"), "link danger", async () => {
      if (!confirm(t("confirmDeleteKey", k.name))) return;
      showExtData(await api("ext/keys/remove", { id: k.id }));
      toast(t("keyDeleted"));
    })),
  ])));
  const url = x.urls[0];
  $("xExample").textContent =
    `curl ${url}/chat/completions -H "Authorization: Bearer <KEY>" -H "Content-Type: application/json" \\\n` +
    `  -d '{"model":"default","messages":[{"role":"user","content":"Hallo"}]}'\n\n` +
    `# Python\nfrom openai import OpenAI\nclient = OpenAI(base_url="${url}", api_key="<KEY>")\n` +
    `print(client.chat.completions.create(model="default", messages=[{"role": "user", "content": "Hallo"}]).choices[0].message.content)`;
}

async function showExt() {
  $("xNew").hidden = true;
  showExtData(await api("ext"));
}

$("extForm").addEventListener("change", async e => {
  try {
    showExtData(await api("ext/settings", { [e.target.name]: e.target.checked }));
  } catch (err) {
    banner(err.message);
  }
});

$("xAdd").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const x = await api("ext/keys/add", { name: f.name.value.trim(), ips: f.ips.value });
    showExtData(x);
    $("xNewKey").textContent = x.newKey;
    $("xNew").hidden = false;
    f.reset();
  } catch (err) {
    banner(err.message);
  }
});

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    toast(t("copied"));
  } catch {
    toast(t("copyFailed"));
  }
}

document.addEventListener("click", e => {
  const id = e.target?.dataset?.copy;
  if (id) copy($(id).textContent);
});

// Gruppen: je Gruppe Code (kopieren), PCs, Vektoren; umbenennen, neuer Code, löschen
function showGroups(c) {
  const single = c.groups.length === 1;
  $("cGroups").replaceChildren(...c.groups.map(g => {
    const code = document.createElement("span");
    code.className = "copyrow";
    const text = document.createElement("code");
    text.className = "code";
    text.textContent = g.code;
    code.append(text, button(t("copy"), "link", () => copy(g.code)));
    const ren = button(t("rename"), "link", async () => {
      const name = prompt(t("promptGroupName"), g.name);
      if (!name || name.trim() === g.name) return;
      showGroups(await api("groups/rename", { id: g.id, name: name.trim() }));
    });
    const renew = button(t("newCode"), "link", async () => {
      if (!confirm(t("confirmRenewGroup", g.name))) return;
      showGroups(await api("connection/renew", { id: g.id }));
      toast(t("renewed"));
    });
    const del = single ? null : button(t("delete"), "link danger", async () => {
      if (!confirm(t("confirmDeleteGroup", g.name))) return;
      showGroups(await api("groups/remove", { id: g.id }));
    });
    return row([g.name, code, { text: N(g.pcs), cls: "num" }, { text: N(g.vectors), cls: "num" }, actionsCell(ren, renew, del)]);
  }));
}

$("gAdd").addEventListener("submit", async e => {
  e.preventDefault();
  try {
    showGroups(await api("groups/add", { name: e.target.name.value.trim() }));
    e.target.reset();
    toast(t("groupCreated"));
  } catch (err) {
    banner(err.message);
  }
});

// ---- Kalender ----------------------------------------------------------------------------------------------------------
let calData = null;
let calEditing = null; // Kennung des Kalenders im Bearbeiten-Formular

async function showCalendars() {
  const k = (calData = await api("calendars"));
  const admin = isAdmin();
  $("kIntro").textContent = t(admin ? "calIntroAdmin" : "calIntroUser");
  $("kTable").hidden = k.calendars.length === 0;
  $("kEmpty").hidden = k.calendars.length > 0;
  $("kEmpty").textContent = t(admin ? "calNone" : "calNoneUser");
  $("kList").replaceChildren(...k.calendars.map(c => {
    const name = document.createElement("span");
    const dot = document.createElement("i");
    dot.className = "dot";
    dot.style.background = c.color;
    name.append(dot, c.name);
    const access = admin
      ? Object.entries(c.rights || {}).map(([u, r]) => `${u}: ${t(r === "write" ? "rightWrite" : "rightRead")}`).join(", ") || t("rightNone")
      : t(c.right === "write" ? "rightWrite" : "rightRead");
    const dl = button(t("download"), "link", () => downloadPost("calendars/ics", { id: c.id }));
    const edit = admin ? button(t("edit"), "link", () => editCalendar(c)) : null;
    const del = admin ? button(t("delete"), "link danger", async () => {
      if (!confirm(t("confirmDeleteCal", c.name, N(c.items)))) return;
      await api("calendars/remove", { id: c.id });
      if (calEditing === c.id) $("kEdit").hidden = true;
      showCalendars();
    }) : null;
    return row([name, { text: N(c.items), cls: "num" }, access, actionsCell(edit, dl, del)]);
  }));
  $("kStep2").textContent = t("calStep2", k.user);
  $("kStep4").textContent = t(admin ? "calStep4Admin" : "calStep4User");
  $("kUrls").replaceChildren(...k.urls.map(u => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.className = "code small";
    code.textContent = u;
    li.append(code, button(t("copy"), "", () => copy(u)));
    return li;
  }));
  $("kLan").hidden = k.lan || !admin;
}

function editCalendar(c) {
  calEditing = c.id;
  const f = $("kEdit");
  $("kEditTitle").textContent = t("calEditTitle", c.name);
  f.name.value = c.name;
  f.color.value = c.color;
  $("kRights").replaceChildren(...calData.users.map(u => {
    const label = document.createElement("label");
    const sel = document.createElement("select");
    sel.dataset.user = u.name;
    sel.append(new Option(t("rightNone"), ""), new Option(t("rightRead"), "read"), new Option(t("rightWrite"), "write"));
    sel.value = c.rights?.[u.name] || "";
    const name = document.createElement("span");
    name.textContent = `${u.name} (${roleText(u.role)})`;
    label.append(name, sel);
    return label;
  }));
  f.hidden = false;
  f.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("kEdit").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  const rights = {};
  for (const sel of $("kRights").querySelectorAll("select")) if (sel.value) rights[sel.dataset.user] = sel.value;
  try {
    await api("calendars/update", { id: calEditing, name: f.name.value.trim(), color: f.color.value, rights });
    f.hidden = true;
    toast(t("saved"));
    showCalendars();
  } catch (err) {
    banner(err.message);
  }
});

$("kCancel").addEventListener("click", () => ($("kEdit").hidden = true));

$("kAdd").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    const { id } = await api("calendars/add", { name: f.name.value.trim(), color: f.color.value });
    f.name.value = "";
    await showCalendars();
    const c = calData.calendars.find(x => x.id === id);
    if (c) editCalendar(c);
    toast(t("calCreated"));
  } catch (err) {
    banner(err.message);
  }
});

// Datei per POST holen (Kalender als .ics, Sicherung) und speichern
async function downloadPost(path, body) {
  const r = await fetch("/api/" + path, {
    method: "POST", credentials: "same-origin",
    headers: { "X-Lang": LANG, "Content-Type": "application/json", "X-CSRF": session?.csrf || "" },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || t("errorStatus", r.status));
  const name = /filename="([^"]+)"/.exec(r.headers.get("Content-Disposition") || "")?.[1] || "download";
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

// ---- Sicherung ---------------------------------------------------------------------------------------------------------
$("backupForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  if (f.password.value !== f.confirm.value) return banner(t("passwordsDiffer"));
  $("bBusy").hidden = false;
  try {
    await downloadPost("backup/export", { password: f.password.value, vectors: f.vectors.checked });
    f.password.value = f.confirm.value = "";
    toast(t("backupDone"));
  } catch (err) {
    banner(err.message);
  } finally {
    $("bBusy").hidden = true;
  }
});

$("restore").addEventListener("click", async () => {
  const f = $("backupForm");
  const file = f.file.files[0];
  if (!file || !f.restorePassword.value) return banner(t("restoreNeedFile"));
  if (!confirm(t("confirmRestore", new Date(file.lastModified).toLocaleString(locale())))) return;
  const pw = btoa(String.fromCharCode(...new TextEncoder().encode(f.restorePassword.value)));
  const r = await fetch("/api/backup/import", {
    method: "POST", credentials: "same-origin",
    headers: { "X-Lang": LANG, "Content-Type": "application/octet-stream", "X-CSRF": session?.csrf || "", "X-Backup-Password": pw },
    body: file,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) return banner(data.error || t("errorStatus", r.status));
  alert(t("restoreDone", data.groups, data.calendars));
  session = await api("session");
  showAuth();
});

// ---- Einstellungen -----------------------------------------------------------------------------------------------------
async function showSettings() {
  const s = await api("settings");
  const f = $("settingsForm");
  f.cpu.checked = s.cpu && !s.cpuBlocked;
  f.cpu.disabled = !isAdmin() || !!s.cpuBlocked;
  $("eCpuBlocked").textContent = s.cpuBlocked ? t("cpuBlockedNow", s.cpuBlocked) : t("cpuNote");
  f.threads.value = s.threads;
  f.threads.max = s.cores;
  $("eThreads").textContent = t("threadsNote", s.autoThreads, s.cores);
  f.paused.checked = s.paused;
  f.vecShare.checked = s.vecShare;
  $("eAutostartRow").hidden = s.autostart == null;
  f.autostart.checked = !!s.autostart;
  $("eMode").textContent = s.mode === "service" ? t("modeServiceText") : t("modeUserText");
  $("eServiceRow").hidden = s.mode === "service" || !isAdmin() || !session.local;
  $("eServiceHint").textContent = s.mode === "service" ? t("serviceBack") : session.local ? t("serviceLocal") : t("serviceRemote");
}

// Verbindung: Ports und „Web-Oberfläche im Netz“ (gleiche Einstellungen, eigenes Formular)
async function showNet() {
  const s = await api("settings");
  const f = $("netForm");
  f.netPort.value = s.netPort;
  f.webPort.value = s.webPort;
  const pending = [];
  if (s.netPort !== s.netPortActive) pending.push(t("netPortPending", s.netPortActive));
  if (s.webPort !== s.webPortActive) pending.push(t("webPortPending", s.webPortActive));
  $("ePorts").textContent = pending.length ? t("portsPending", pending.join(" · ")) : t("firewall");
  f.webLan.checked = s.webLan;
}

$("netForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api("settings", { netPort: Number(f.netPort.value), webPort: Number(f.webPort.value), webLan: f.webLan.checked });
    $("nSaved").hidden = false;
    setTimeout(() => ($("nSaved").hidden = true), 2500);
    showConnection();
  } catch (err) {
    banner(err.message);
  }
});

$("settingsForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api("settings", {
      cpu: f.cpu.disabled ? undefined : f.cpu.checked,
      threads: Number(f.threads.value) || 0,
      paused: f.paused.checked,
      vecShare: f.vecShare.checked,
      autostart: $("eAutostartRow").hidden ? undefined : f.autostart.checked,
    });
    $("eSaved").hidden = false;
    setTimeout(() => ($("eSaved").hidden = true), 2500);
    showSettings();
  } catch (err) {
    banner(err.message);
  }
});

$("vecClear").addEventListener("click", async () => {
  if (!confirm(t("confirmVecClear"))) return;
  try {
    await api("vectors/clear", {});
    toast(t("deleted"));
  } catch (err) {
    banner(err.message);
  }
});

$("toService").addEventListener("click", async () => {
  if (!confirm(t("confirmService"))) return;
  $("toService").disabled = true;
  try {
    await api("mode", { target: "service" });
    toast(t("serviceDone"));
    setTimeout(() => location.reload(), 4000);
  } catch (err) {
    banner(err.message);
    $("toService").disabled = false;
  }
});

// ---- Benutzer ----------------------------------------------------------------------------------------------------------
async function showUsers() {
  const users = await api("users");
  $("uList").replaceChildren(...users.map(u => {
    const role = document.createElement("select");
    role.append(new Option(t("roleAdmin"), "admin"), new Option(t("roleViewerOption"), "viewer"), new Option(t("roleCalendar"), "calendar"));
    role.value = u.role;
    role.addEventListener("change", async () => {
      try {
        await api("users/role", { name: u.name, role: role.value });
        toast(t("roleChanged"));
      } catch (err) {
        banner(err.message);
        role.value = u.role;
      }
    });
    const pw = button(t("setPassword"), "link", async () => {
      const p = prompt(t("promptNewPassword", u.name));
      if (!p) return;
      await api("users/password", { name: u.name, password: p });
      toast(t("passwordSet"));
    });
    const del = button(t("delete"), "link danger", async () => {
      if (!confirm(t("confirmDeleteUser", u.name))) return;
      await api("users/remove", { name: u.name });
      showUsers();
    });
    del.hidden = u.name.toLowerCase() === session.user.toLowerCase();
    return row([u.name, role, u.created, actionsCell(pw, del)]);
  }));
}

$("userForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    await api("users/add", { name: f.name.value.trim(), password: f.password.value, role: f.role.value });
    f.reset();
    toast(t("userCreated"));
    showUsers();
  } catch (err) {
    banner(err.message);
  }
});

// ---- Protokoll, Konto --------------------------------------------------------------------------------------------------
async function showLog() {
  const { lines } = await api("log");
  const pre = $("logText");
  pre.textContent = lines.join("\n");
  pre.scrollTop = pre.scrollHeight;
}

$("logReload").addEventListener("click", showLog);

$("meForm").addEventListener("submit", async e => {
  e.preventDefault();
  const f = e.target;
  try {
    if (f.password.value !== f.confirm.value) throw new Error(t("newPasswordsDiffer"));
    await api("me/password", { old: f.old.value, password: f.password.value });
    f.reset();
    $("meSaved").hidden = false;
    setTimeout(() => ($("meSaved").hidden = true), 2500);
  } catch (err) {
    banner(err.message);
  }
});

start().catch(err => {
  document.body.textContent = t("unreachable", err.message);
});
