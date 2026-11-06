"use strict";
// Reiter „Semantische Suche (Beta)“: Einstellungen (storage.local "semantic"), Rechenweg (Add-on, Ollama/eigener Server; der
// Helper kommt aus dem Reiter „NovaBird Helper“ der Extension), Modell laden/löschen, Status, Probe, Export/Import der Vektoren. Die Arbeit macht semantic/main.js im Hintergrund.
(() => {
  const $ = id => document.getElementById(id);
  const t = (k, subs) => messenger.i18n.getMessage(k, subs);
  const lang = messenger.i18n.getUILanguage();
  const send = msg => messenger.runtime.sendMessage(msg);
  const KEY = "semantic";
  const mb = b => `${Math.round(b / 1048576).toLocaleString(lang)} MB`;
  const NET_PORT = 47531; // NovaBird Helper im Netz-Modus (wie semantic/server.js)
  const note = text => ($("semMsg").textContent = text || "");
  let last = null; // letzter Status
  let busy = false;

  for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }

  async function config() {
    return (await messenger.storage.local.get({ [KEY]: {} }))[KEY];
  }
  async function setConfig(patch) {
    await messenger.storage.local.set({ [KEY]: { ...(await config()), ...patch } });
    setTimeout(refresh, 300);
  }

  function renderModels(s) {
    const box = $("semModels");
    box.replaceChildren();
    for (const m of s.models) {
      const div = document.createElement("div");
      div.className = "model";
      const head = document.createElement("div");
      const name = document.createElement("b");
      name.textContent = m.name;
      head.append(name, ` (${m.repo})`);
      if (m.recommended) {
        head.append(` · ${t("semRecommended")}`);
      }
      const meta = document.createElement("div");
      meta.className = "meta";
      const ms = m.id === s.model.id ? s.modelStatus : null;
      const stateText = !ms ? "" : ms.complete ? t("semModelReady") : ms.have ? t("semModelPartial") : t("semModelMissing");
      meta.textContent = t("semModelMeta", [m.langs.join(", ").toUpperCase(), mb(m.bytes), `${(m.ramMB / 1024).toLocaleString(lang, { maximumFractionDigits: 1 })} GB`]) + (stateText ? ` · ${stateText}` : "");
      const row = document.createElement("div");
      row.className = "row";
      if (m.id === s.model.id) {
        const dl = document.createElement("button");
        dl.type = "button";
        dl.textContent = s.phase === "downloading" ? t("semCancel") : t("semDownload");
        dl.hidden = Boolean(ms?.complete) && s.phase !== "downloading";
        dl.addEventListener("click", download);
        const del = document.createElement("button");
        del.type = "button";
        del.textContent = t("semRemoveModel");
        del.hidden = !ms?.have || s.phase === "downloading";
        del.addEventListener("click", async () => {
          if (confirm(t("semRemoveModelConfirm"))) {
            await send({ type: "semantic:removeModel" });
            refresh();
          }
        });
        row.append(dl, del);
      }
      div.append(head, meta, row);
      box.append(div);
    }
  }

  async function download() {
    if (last?.phase === "downloading") {
      await send({ type: "semantic:cancelDownload" });
      return;
    }
    note("");
    const res = await send({ type: "semantic:download" });
    if (res?.error) {
      note(t("semError", [res.error]));
    }
    refresh();
  }

  const PHASE = {
    off: "semPhaseOff", "no-model": "semPhaseNoModel", downloading: "semPhaseDownloading", "waiting-index": "semPhaseWaitingIndex",
    "waiting-idle": "semPhaseWaitingIdle", "waiting-power": "semPhaseWaitingPower", indexing: "semPhaseIndexing", paused: "semPhasePaused", done: "semPhaseDone", error: "semPhaseError",
  };

  function engineText(s) {
    if (s.engine === "helper") {
      return t("semEngineHelper", [s.helper?.deviceName || s.helper?.device || "?"]);
    }
    if (s.engine === "server") {
      return t("semEngineServer", [s.server?.url || "?"]);
    }
    return s.engine === "addon" ? t("semEngineAddon", [String(s.threads)]) : "–";
  }

  const num = (x, digits) => Number(x).toLocaleString(lang, { minimumFractionDigits: digits, maximumFractionDigits: digits });

  // Probe des Rechenwegs: Übereinstimmung mit den Referenzvektoren
  function checkText(c) {
    if (!c) {
      return "–";
    }
    if (c.reason === "error") {
      return t("semServerFail", [c.error || "?"]);
    }
    if (c.reason === "dims") {
      return t("semCheckDims");
    }
    return t(c.ok ? "semCheckOk" : "semCheckBad", [num(c.minCos, 4), num(c.maxShift, 3)]);
  }

  // Anderer Server (unter „Ollama oder eigener Server“): Hinweis, wenn die Adresse nicht auf diesem PC liegt. Den NovaBird Helper
  // gibt es hier nur ohne NovaBird-Extension; mit ihr wird er im Reiter „NovaBird Helper“ verbunden.
  function renderServer(s) {
    $("semServerType").querySelector('option[value="nbhelper"]').hidden = extension;
    let url = null;
    try {
      url = new URL($("semServerUrl").value.trim());
    } catch {
      /* noch keine gültige Adresse */
    }
    const local = url && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    const nb = $("semServerType").value === "nbhelper";
    for (const el of document.querySelectorAll("#semServerBox .srv-generic")) {
      el.hidden = nb;
    }
    for (const el of document.querySelectorAll("#semServerBox .srv-nb")) {
      el.hidden = !nb;
    }
    $("semServerUrl").placeholder = nb ? `http://192.168.1.20:${NET_PORT}` : "http://localhost:11434";
    // NovaBird Helper im Netz: die Texte gehen verschlüsselt (Kopplungscode); sonst Hinweis auf Klartext bei http
    $("semServerRemote").hidden = !url || local;
    $("semServerRemote").classList.toggle("warn", !nb);
    $("semServerRemote").textContent = !url || local ? "" : nb ? t("semServerRemoteNb") : t("semServerRemote") + (url.protocol === "http:" ? " " + t("semServerInsecure") : "");
    $("semServerKey").placeholder = s?.server?.hasKey ? t("semServerKeySaved") : "";
    $("semServerCode").placeholder = s?.server?.hasCode ? t("semServerKeySaved") : "XXXXX-XXXXX-XXXXX-XXXXX";
    const c = s?.checks?.server;
    if (c && !$("semServerState").dataset.fresh) {
      $("semServerState").textContent = checkText(c);
      $("semServerState").className = c.ok ? "hint ok" : "hint bad";
    }
  }

  function renderState(s) {
    const pct = s.total ? Math.min(100, Math.round((s.vectors / s.total) * 100)) : 0;
    const rows = [
      [t("semRowPhase"), t(PHASE[s.phase] || "semPhaseOff") + (s.error ? ` (${s.error})` : "") + (s.unreadable ? ` · ${t("semUnreadable", [String(s.unreadable)])}` : "")],
      [t("semRowProgress"), s.total ? t("semProgressFmt", [s.vectors.toLocaleString(lang), s.total.toLocaleString(lang), String(pct)]) : s.vectors.toLocaleString(lang)],
      [t("semRowEngine"), engineText(s)],
      [t("semRowCheck"), checkText(s.checks?.[s.engine])],
      [t("semRowRate"), s.rate ? t("semRateFmt", [s.rate.toLocaleString(lang)]) : "–"],
      [t("semRowTiming"), s.timing ? t("semTimingFmt", [String(s.timing.batch), s.timing.waitMs.toLocaleString(lang), s.timing.embedMs.toLocaleString(lang)]) : "–"],
      ...(s.shared > 0 ? [[t("semRowShared"), t("semSharedFmt", [s.shared.toLocaleString(lang)])]] : []),
      [t("semRowLoaded"), s.loaded ? t("semYes") : t("semNo")],
    ];
    $("semState").replaceChildren(...rows.flatMap(([k, v]) => {
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = k;
      dd.textContent = v;
      return [dt, dd];
    }));
    $("semPause").textContent = s.phase === "paused" ? t("semResume") : t("semPause");
    $("semPause").disabled = !s.cfg.enabled;
    const dl = s.download;
    $("semProgress").hidden = !dl;
    if (dl) {
      $("semProgress").value = dl.total ? dl.done / dl.total : 0;
      $("semDownloadText").textContent = t("semDownloadFmt", [mb(dl.done), mb(dl.total)]);
    } else {
      $("semDownloadText").textContent = "";
    }
    $("semThreadsInfo").textContent = t("semThreadsInfo", [String(s.cores || "?"), String(s.threads)]);
    renderServer(s);
  }

  function writeForm(s) {
    const c = s.cfg;
    $("semEnabled").checked = Boolean(c.enabled);
    $("semIdleOnly").checked = c.idleOnly !== false;
    $("semThreads").value = String(c.threads || 0);
    $("semKeep").value = c.keep;
    $("semStrictness").value = c.strictness;
    $("semServerType").value = s.server?.type === "nbhelper" && !extension ? "nbhelper" : "openai";
    $("semServerBox").open = c.path === "server" && s.server?.type !== "ollama" && !viaHelper(s);
    $("semServerUrl").value = s.server?.url || "";
    $("semServerModel").value = s.server?.model || "";
    $("semServerUser").value = s.server?.user || "";
    $("semServerLabel").value = s.server?.label || "";
  }

  async function refresh() {
    if (busy) {
      return;
    }
    busy = true;
    try {
      const s = await send({ type: "semantic:status" });
      // s.error mit Status (cfg) ist der letzte Fehler beim Indizieren – steht in der Zeile „Zustand“, Status trotzdem zeigen
      if (!s || (s.error && !s.cfg)) {
        note(t("semError", [s?.error || "?"]));
        return;
      }
      const first = !last;
      last = s;
      if (first) {
        writeForm(s);
      }
      renderModels(s);
      renderWay(s);
      renderState(s);
    } finally {
      busy = false;
    }
  }

  $("semEnabled").addEventListener("change", () => setConfig({ enabled: $("semEnabled").checked }));
  // Kopfzeile der Trefferliste: „· davon N per Bedeutungssuche“ (Standard an)
  config().then(c => ($("semHeaderCount").checked = c.headerCount !== false));
  $("semHeaderCount").addEventListener("change", () => setConfig({ headerCount: $("semHeaderCount").checked }));

  // Wo wird gerechnet? Den NovaBird Helper schaltet der Reiter „NovaBird Helper“ der Extension ein und aus (eine Stelle für alles,
  // was den Helper betrifft); rechnet er, zeigt diese Seite nur, wie es läuft. Sonst: auf diesem PC im Add-on oder Ollama/eigener
  // Server. Ohne NovaBird-Extension gibt es den Reiter nicht – dann lässt sich der Helper unter „Anderer Server“ eintragen.
  const EXTENSION_ID = "novabird-extension@novabird";
  let extension = false; // NovaBird-Extension installiert (beantwortet helper:conn)
  let wayChoice = null; // vom Nutzer gewählter Rechenweg, solange er noch nicht gespeichert ist (Ollama erst nach der Probe)
  async function loadExtension() {
    try {
      await messenger.runtime.sendMessage(EXTENSION_ID, { type: "helper:conn" });
      extension = true;
    } catch {
      extension = false;
    }
  }
  const viaHelper = s => extension && s.cfg.path === "server" && s.server?.type === "nbhelper";
  function renderWay(s) {
    const helper = viaHelper(s);
    $("semViaHelper").hidden = !helper;
    $("semWays").hidden = helper;
    if (helper) {
      let host = s.server?.url || "";
      try {
        host = new URL(host).host;
      } catch {
        /* Adresse wie gespeichert */
      }
      $("semViaHelperText").textContent = t("semViaHelper", [host]);
      return;
    }
    const way = wayChoice || (s.cfg.path === "server" ? "ollama" : "pc");
    $("semWayPc").checked = way === "pc";
    $("semWayOllama").checked = way === "ollama";
    $("semWayPcBox").hidden = way !== "pc";
    $("semMac").hidden = way !== "ollama";
    $("semHelperTip").hidden = !extension;
  }
  $("semWayPc").addEventListener("change", async () => {
    wayChoice = null;
    $("semServerState").textContent = "";
    if ((await config()).path === "server") {
      await setConfig({ path: "auto" }); // auto: ein laufender Helper auf diesem PC (Native Messaging) rechnet mit, sonst das Add-on
    }
    if (last) {
      renderWay({ ...last, cfg: { ...last.cfg, path: "auto" } });
    }
  });
  $("semWayOllama").addEventListener("change", () => {
    wayChoice = "ollama";
    if (last) {
      renderWay(last);
    }
    macInit();
  });
  for (const b of document.querySelectorAll(".sem-open-helper")) {
    b.addEventListener("click", () => messenger.runtime.sendMessage(EXTENSION_ID, { type: "openSettings", key: "helper" }).catch(() => {}));
  }
  $("semServerUrl").addEventListener("input", () => renderServer(last));
  $("semServerType").addEventListener("change", () => renderServer(last));
  $("semIdleOnly").addEventListener("change", () => setConfig({ idleOnly: $("semIdleOnly").checked }));
  $("semThreads").addEventListener("change", () => setConfig({ threads: Math.max(0, Math.min(64, Number($("semThreads").value) || 0)) }));
  $("semKeep").addEventListener("change", () => setConfig({ keep: $("semKeep").value }));
  $("semStrictness").addEventListener("change", () => setConfig({ strictness: $("semStrictness").value }));
  $("semPause").addEventListener("click", async () => {
    await send({ type: last?.phase === "paused" ? "semantic:resume" : "semantic:pause" });
    refresh();
  });

  $("semTry").addEventListener("click", async () => {
    const out = $("semTryOut");
    out.replaceChildren();
    const res = await send({ type: "semantic:try", text: $("semTryText").value });
    if (!res || res.error || !res.rows) {
      note(res?.error ? t("semError", [res.error]) : t("semTryNone"));
      return;
    }
    note(t("semTryFmt", [String(res.rows.length), String(res.ms)]));
    for (const r of res.rows) {
      let subject = r.header_msg_id;
      try {
        const list = await messenger.messages.query({ headerMessageId: r.header_msg_id });
        subject = list.messages[0]?.subject || subject;
      } catch {
        /* nur die ID zeigen */
      }
      const li = document.createElement("li");
      li.textContent = `${r.score.toLocaleString(lang, { minimumFractionDigits: 2 })} · ${subject}`;
      out.append(li);
    }
  });

  // Eigener Server: Erlaubnis für genau diese Adresse (und webRequest, damit Ollama den Absender nicht ablehnt) muss
  // direkt im Klick erfragt werden; danach speichern und die Probe rechnen lassen.
  $("semServerCheck").addEventListener("click", () => {
    const url = $("semServerUrl").value.trim().replace(/\/+$/, "");
    const out = $("semServerState");
    out.className = "hint";
    let pattern;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("url");
      }
      pattern = `${u.protocol}//${u.hostname}/*`;
    } catch {
      out.textContent = t("semServerBadUrl");
      out.className = "hint bad";
      return;
    }
    const asked = messenger.permissions.request({ permissions: ["webRequest", "webRequestBlocking"], origins: [pattern] }).catch(() => false);
    (async () => {
      if (!(await asked)) {
        out.textContent = t("semServerNoPermission");
        out.className = "hint bad";
        return;
      }
      out.textContent = t("semServerChecking");
      out.dataset.fresh = "1";
      const old = (await config()).server || {};
      const key = $("semServerKey").value || old.key || "";
      const code = $("semServerCode").value.trim() || old.code || "";
      await setConfig({
        path: "server",
        server: { type: $("semServerType").value, url, model: $("semServerModel").value.trim(), user: $("semServerUser").value.trim(), key, code, label: $("semServerLabel").value.trim() },
      });
      $("semServerKey").value = "";
      $("semServerCode").value = "";
      const res = await send({ type: "semantic:serverCheck" });
      delete out.dataset.fresh;
      const c = res?.check;
      out.textContent = res?.error ? t("semServerFail", [res.error]) : c?.ok ? t("semServerOk", [num(c.minCos, 4), num(c.maxShift, 3), String(c.ms)]) : c?.reason === "error" ? t("semServerFail", [c.error || "?"]) : c?.reason === "dims" ? t("semCheckDims") : t("semServerBad", [num(c?.minCos ?? 0, 4)]);
      // NovaBird Helper im Netz: verbunden, aber ohne (passendes) Modell -> sagen, was auf dem Rechen-PC zu tun ist
      if (res?.info && res.info.modelReady === false) {
        out.textContent = t("semServerNbNoModel");
      } else if (res?.info && res.info.modelMatch === false) {
        out.textContent = t("semServerNbOtherModel");
      }
      if (c?.ok && !(await config()).enabled) {
        out.textContent += " " + t("semServerDisabled");
      }
      if (res?.info && c?.ok) {
        out.textContent += " " + t("semServerNbInfo", [res.info.version || "?", res.info.deviceName || res.info.device || "?", String(res.info.clients ?? 0)]);
      }
      out.className = c?.ok ? "hint ok" : "hint bad";
      if (Array.isArray(res?.models)) {
        $("semServerModels").replaceChildren(...res.models.map(m => Object.assign(document.createElement("option"), { value: m })));
      }
      refresh();
    })();
  });

  $("semExport").addEventListener("click", async () => {
    const blob = await send({ type: "semantic:export" });
    if (!(blob instanceof Blob)) {
      note(t("semError", [blob?.error || "?"]));
      return;
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `novabird-vektoren-${last?.model?.id || "modell"}-${new Date().toISOString().slice(0, 10)}.nbvec`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
  });
  $("semImport").addEventListener("click", () => $("semImportFile").click());
  $("semImportFile").addEventListener("change", async () => {
    const file = $("semImportFile").files[0];
    if (!file) {
      return;
    }
    const res = await send({ type: "semantic:import", buffer: await file.arrayBuffer() });
    note(res?.error ? t("semError", [res.error]) : t("semImported", [String(res.imported)]));
    $("semImportFile").value = "";
    refresh();
  });
  $("semClear").addEventListener("click", async () => {
    if (confirm(t("semClearConfirm"))) {
      await send({ type: "semantic:clear" });
      refresh();
    }
  });

  // Mac: Ollama als Rechenweg mit dem Grafikchip – Adresse, geprüftes Modell laden, im Speicher halten (Einstellung keep,
  // dieselbe wie für das Add-on-Modell), entladen. Eingeschaltet wird erst nach bestandener Probe (semantic:ollama "use").
  // Plattform über navigator.platform (getPlatformInfo fehlt der in den Hub eingebetteten Seite); ?platform=mac zum Testen.
  const isMac = new URLSearchParams(location.search).get("platform") === "mac" || /^Mac/.test(navigator.platform);
  const OLLAMA_MODEL = "jina/jina-embeddings-v2-base-de"; // wie SERVER_DEFAULTS.model in semantic/server.js
  const OLLAMA_MODEL_BYTES = 322858704; // F16, wie in der Ollama-Bibliothek
  let macTimer = null;
  function macState(res, extra = "") {
    const out = $("semMacState");
    const pull = res?.pull;
    if (!res || (res.error && !res.version)) {
      out.textContent = t("semMacUnreachable", [res?.error || "?"]);
      out.className = "hint bad";
      $("semMacPullRow").hidden = $("semMacUseRow").hidden = true;
      return;
    }
    const parts = [t("semMacVersion", [res.version]), t(res.hasModel ? "semMacModelHave" : "semMacModelMissing")];
    parts.push(res.loaded ? t("semMacLoaded", [mb(res.loaded.size), String(Math.round((100 * res.loaded.vram) / (res.loaded.size || 1)))]) : t("semMacNotLoaded"));
    if (res.inUse) {
      parts.push(t("semMacInUse"));
    }
    out.textContent = parts.join(" ") + (extra ? " " + extra : "");
    out.className = res.inUse ? "hint ok" : "hint";
    const pulling = Boolean(pull?.running);
    $("semMacPullRow").hidden = res.hasModel && !pulling && !pull?.error;
    $("semMacPull").disabled = pulling;
    $("semMacPull").textContent = t("semMacPull", [mb(OLLAMA_MODEL_BYTES)]);
    $("semMacProgress").hidden = !pulling;
    $("semMacProgress").value = pull?.total ? pull.completed / pull.total : 0;
    $("semMacPullText").textContent = pull?.error ? t("semMacPullFail", [pull.error])
      : pulling ? t("semMacPulling", [pull.total ? `${Math.round((100 * pull.completed) / pull.total)} %` : pull.status || ""])
      : pull?.status === "success" ? t("semMacPullDone") : "";
    $("semMacUseRow").hidden = !res.hasModel || res.inUse || pulling;
    clearTimeout(macTimer);
    if (pulling) {
      macTimer = setTimeout(async () => macState(await send({ type: "semantic:ollama", op: "status" })), 1000);
    }
  }
  async function macOp(op, extra) {
    const res = await send({ type: "semantic:ollama", op });
    macState(res, typeof extra === "function" ? extra(res) : extra);
    return res;
  }
  // Ollama auf allen Systemen; auf dem Mac der empfohlene Weg (Grafikchip). Status erst, wenn der Block zu sehen ist.
  $("semWayOllamaLabel").textContent = t("semWayOllama") + (isMac ? " " + t("semMacRecommend") : "");
  let macStarted = false;
  async function macInit() {
    if (macStarted) {
      return;
    }
    macStarted = true;
    const c = await config();
    $("semMacKeep").value = c.keep || "10min";
    const sv = c.server || {};
    $("semMacUrl").value = sv.type === "ollama" && sv.url ? sv.url : "http://localhost:11434";
    if (sv.type === "ollama" && sv.url) {
      macOp("status");
    }
  }
  config().then(c => c.path === "server" && macInit());
  // Erlaubnis für die Adresse (und webRequest, damit Ollama den Absender nicht ablehnt) direkt im Klick erfragen
  $("semMacConnect").addEventListener("click", () => {
    const url = $("semMacUrl").value.trim().replace(/\/+$/, "");
    const out = $("semMacState");
    let pattern;
    try {
      const u = new URL(url);
      if (u.protocol !== "http:" && u.protocol !== "https:") {
        throw new Error("url");
      }
      pattern = `${u.protocol}//${u.hostname}/*`;
    } catch {
      out.textContent = t("semServerBadUrl");
      out.className = "hint bad";
      return;
    }
    const asked = messenger.permissions.request({ permissions: ["webRequest", "webRequestBlocking"], origins: [pattern] }).catch(() => false);
    (async () => {
      if (!(await asked)) {
        out.textContent = t("semServerNoPermission");
        out.className = "hint bad";
        return;
      }
      out.textContent = t("semMacChecking");
      out.className = "hint";
      const c = await config();
      const old = c.server || {};
      // ein anderer Server (z. B. Helper im Netz) bleibt nicht Rechenweg, wenn hier Ollama eingetragen wird
      const path = c.path === "server" && old.type !== "ollama" ? "auto" : c.path;
      await setConfig({ path, server: { ...old, type: "ollama", url, model: OLLAMA_MODEL } });
      await macOp("status");
    })();
  });
  $("semMacPull").addEventListener("click", () => macOp("pull"));
  $("semMacUse").addEventListener("click", () => {
    $("semMacState").textContent = t("semServerChecking");
    macOp("use", res => {
      const c = res?.check;
      if (c?.ok) {
        $("semEnabled").checked = true;
      }
      return c?.ok ? t("semMacUseOk") : t("semMacUseBad", [c?.reason === "error" ? c.error || "?" : num(c?.minCos ?? 0, 4)]);
    }).then(() => setTimeout(refresh, 500));
  });
  $("semMacUnload").addEventListener("click", () => macOp("unload", t("semMacUnloaded")));
  $("semMacKeep").addEventListener("change", () => {
    $("semKeep").value = $("semMacKeep").value;
    setConfig({ keep: $("semMacKeep").value });
  });
  $("semKeep").addEventListener("change", () => ($("semMacKeep").value = $("semKeep").value));
  $("semMacDownload").addEventListener("click", e => {
    e.preventDefault();
    messenger.windows.openDefaultBrowser("https://ollama.com/download");
  });

  loadExtension().then(refresh);
  setInterval(() => {
    if (!document.getElementById("semanticTab").hidden) {
      refresh();
    }
  }, 1500);
})();
