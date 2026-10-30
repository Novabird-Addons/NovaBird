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
    session = null;
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

// ---- Sprache -----------------------------------------------------------------------------------------------------------
$("langSwitch").addEventListener("click", () => {
  setLang(LANG === "de" ? "en" : "de");
  if (session?.user) {
    $("whoName").textContent = `${session.user} (${isAdmin() ? t("roleAdmin") : t("roleViewer")})`;
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
  $("whoName").textContent = `${session.user} (${isAdmin() ? t("roleAdmin") : t("roleViewer")})`;
  for (const el of document.querySelectorAll("[data-admin]")) el.hidden = !isAdmin();
  for (const el of document.querySelectorAll("#settingsForm input, #promptForm textarea")) el.disabled = !isAdmin();
  go(location.hash.slice(1) || "status");
  clearInterval(timer);
  timer = setInterval(() => refresh(false), 2000);
}

function go(name) {
  const link = document.querySelector(`#tabs a[data-page="${name}"]`);
  if (!link || link.hidden) name = "status";
  page = name;
  for (const a of document.querySelectorAll("#tabs a")) a.classList.toggle("active", a.dataset.page === name);
  for (const s of document.querySelectorAll("[data-section]")) s.hidden = s.dataset.section !== name;
  banner("");
  refresh(true);
}

window.addEventListener("hashchange", () => session?.user && go(location.hash.slice(1)));

async function refresh(full) {
  try {
    if (page === "status") await showStatus();
    else if (page === "pcs") await showPcs();
    else if (page === "sprachmodell") await showLlm(full);
    else if (full && page === "verbindung") await showConnection();
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

// ---- Status ------------------------------------------------------------------------------------------------------------
async function showStatus() {
  const [s, p] = await Promise.all([api("status"), api("pcs")]);
  $("sState").textContent = s.state;
  $("sRate").textContent = s.rateCpu > 0 ? t("rateSplit", s.rate, s.rateGpu, s.rateCpu) : t("rateFmt", s.rate);
  $("sQueue").textContent = t("queueFmt", s.queue);
  $("sPcs").textContent = p.pcs.filter(x => Date.now() - Date.parse(x.lastSeen) < 864e5).length;
  $("sDevice").textContent = (s.deviceName || "–") + (s.measured ? t("measured", Math.round(s.measured)) : "");
  $("sModel").textContent = s.model.ready ? t("modelReady") : s.model.complete ? t("modelNotMeasured") : t("modelMissing");
  $("sCpu").textContent = s.cpuBlocked ? t("cpuBlocked", s.cpuBlocked) : s.cpu ? t("cpuOn", s.cpuThreads) : t("off");
  $("sMode").textContent = s.mode === "service" ? t("modeService") : t("modeUser");
  $("sStarted").textContent = new Date(s.started).toLocaleString(locale());
  const v = s.vectors;
  $("sVec").textContent = !v.enabled ? t("off") : t("vecFmt", N(v.count), GB(v.bytes)) + (v.hits + v.misses > 0 ? t("vecSince", N(v.hits), N(v.stored)) : "");
  $("sChat").textContent = !s.chat.selected ? t("chatNone")
    : `${s.chat.selected.replace(/^ollama:/, "")}${s.chat.loaded === s.chat.selected ? t("chatLoaded") : ""}${s.chat.busy ? t("chatBusy") : ""}`;
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
    const cells = [pc.label, idx, { text: N(pc.total), cls: "num" }, { text: N(pc.today), cls: "num" },
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
}

// ---- Sprachmodell -------------------------------------------------------------------------------------------------------
let prompts = null; // {defaults, custom} – nur beim Öffnen der Seite laden (Eingaben nicht überschreiben)

async function showLlm(full) {
  const l = await api("llm");
  const o = l.ollama;
  const sel = l.selected || "";
  const selText = sel ? sel.replace(/^ollama:/, "") + (sel.startsWith("ollama:") ? " (Ollama)" : " (Windows ML)") : t("none");
  $("lState").textContent = t("chosen", selText) + (l.busy ? t("busyNow") : "") + (l.waiting > 0 ? t("waitingFmt", l.waiting) : "");
  // Ollama
  $("oState").textContent = (o.installing || (o.installed ? t("ollamaStateFmt", o.version, o.status) + (o.enabled ? "" : t("ollamaDisabled")) : t("ollamaNotInstalled"))) +
    (o.pulling ? t("pullingFmt", o.pulling) : "") + (o.error ? ` · ${o.error}` : "");
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
  if (!full && !l.importing) return;
  // Windows ML
  $("lImport").textContent = l.importing || "";
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
  const c = await api("connection");
  $("cAddresses").replaceChildren(...c.addresses.map(a => {
    const li = document.createElement("li");
    const code = document.createElement("code");
    code.className = "code small";
    code.textContent = a;
    li.append(code, button(t("copy"), "", () => copy(a)));
    return li;
  }));
  $("cCode").textContent = c.code;
  $("cSecurity").textContent = t("connSecurity", c.port);
  $("cCert").hidden = !c.webFingerprint;
  $("cFinger").textContent = (c.webFingerprint || "").replace(/(..)(?!$)/g, "$1:");
}

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

$("renew").addEventListener("click", async () => {
  if (!confirm(t("confirmRenew"))) return;
  await api("connection/renew", {});
  showConnection();
  toast(t("renewed"));
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
  f.netPort.value = s.netPort;
  f.webPort.value = s.webPort;
  const pending = [];
  if (s.netPort !== s.netPortActive) pending.push(t("netPortPending", s.netPortActive));
  if (s.webPort !== s.webPortActive) pending.push(t("webPortPending", s.webPortActive));
  $("ePorts").textContent = pending.length ? t("portsPending", pending.join(" · ")) : t("firewall");
  f.webLan.checked = s.webLan;
}

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
      netPort: Number(f.netPort.value),
      webPort: Number(f.webPort.value),
      webLan: f.webLan.checked,
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
    role.append(new Option(t("roleAdmin"), "admin"), new Option(t("roleViewerOption"), "viewer"));
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
