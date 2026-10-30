"use strict";
// Reiter „Semantische Suche (Beta)“: Einstellungen (storage.local "semantic"), Modell laden/löschen, Status, Probe,
// Helper verbinden, eigener Server, Export/Import der Vektoren. Die Arbeit macht semantic/main.js im Hintergrund.
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

  // Eigener Server: Felder nur bei diesem Rechenweg; Hinweis, wenn die Adresse nicht auf diesem PC liegt
  function renderServer(s) {
    const show = $("semPath").value === "server";
    $("semServerBox").hidden = !show;
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
      [t("semRowPhase"), t(PHASE[s.phase] || "semPhaseOff") + (s.error ? ` (${s.error})` : "")],
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
    const h = s.helper;
    $("semHelperState").textContent = h?.connected
      ? t("semHelperOk", [h.version || "?", h.deviceName || h.device || "?", h.modelReady ? t("semModelReady") : t("semModelMissing")])
      : t("semHelperNone", [h?.error || "–"]);
    $("semHelperPrepare").disabled = !h?.connected || Boolean(h.modelReady);
    const sy = h?.sync;
    for (const id of ["semSyncSetup", "semSyncNow", "semSyncLeave"]) {
      $(id).disabled = !h?.connected;
    }
    $("semSyncNow").disabled = !sy?.configured;
    $("semSyncLeave").disabled = !sy?.configured;
    if (sy?.configured && !$("semSyncFolder").value) {
      $("semSyncFolder").value = sy.folder || "";
    }
    $("semSyncState").textContent = !h?.connected ? t("semSyncNeedsHelper")
      : !sy?.configured ? t("semSyncStateNone")
      : t("semSyncStateOk", [sy.folder || "", s.sync?.at ? new Date(s.sync.at).toLocaleString(lang) : "–", String(s.sync?.pushed ?? 0), String(s.sync?.pulled ?? 0)])
        + (s.sync?.error ? ` · ${t("semError", [s.sync.error])}` : "");
    $("semThreadsInfo").textContent = t("semThreadsInfo", [String(s.cores || "?"), String(s.threads)]);
    renderServer(s);
  }

  function writeForm(s) {
    const c = s.cfg;
    $("semEnabled").checked = Boolean(c.enabled);
    $("semPath").value = c.path;
    $("semIdleOnly").checked = c.idleOnly !== false;
    $("semThreads").value = String(c.threads || 0);
    $("semKeep").value = c.keep;
    $("semStrictness").value = c.strictness;
    $("semServerType").value = s.server?.type || "ollama";
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
      if (!s || s.error) {
        note(t("semError", [s?.error || "?"]));
        return;
      }
      const first = !last;
      last = s;
      if (first) {
        writeForm(s);
      }
      renderModels(s);
      renderState(s);
    } finally {
      busy = false;
    }
  }

  $("semEnabled").addEventListener("change", () => setConfig({ enabled: $("semEnabled").checked }));
  $("semPath").addEventListener("change", () => {
    renderServer(last);
    setConfig({ path: $("semPath").value });
  });
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

  // Helper: Native Messaging braucht eine Berechtigung (wird hier, auf Klick, erfragt)
  $("semHelperConnect").addEventListener("click", async () => {
    note("");
    const ok = await messenger.permissions.request({ permissions: ["nativeMessaging"] }).catch(() => false);
    if (!ok) {
      note(t("semHelperNoPermission"));
      return;
    }
    const res = await send({ type: "semantic:helperConnect" });
    note(res?.info ? "" : t("semHelperNone", [res?.error || "–"]));
    refresh();
  });
  $("semHelperPrepare").addEventListener("click", async () => {
    note(t("semHelperPreparing"));
    const res = await send({ type: "semantic:helperPrepare" });
    note(res?.error ? t("semError", [res.error]) : "");
    refresh();
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

  // Ordner-Sync: ohne Code neu koppeln (der Helper erzeugt den Code), mit Code einem bestehenden Sync-Ordner beitreten
  $("semSyncSetup").addEventListener("click", async () => {
    note("");
    const res = await send({ type: "semantic:syncSetup", folder: $("semSyncFolder").value.trim(), code: $("semSyncCode").value.trim() || null });
    if (res?.error) {
      note(t("semError", [res.error]));
    } else if (res?.code) {
      $("semSyncCode").value = res.code;
      note(t("semSyncNewCode", [res.code]));
    } else {
      note(t("semSyncJoined"));
    }
    refresh();
  });
  $("semSyncNow").addEventListener("click", async () => {
    const res = await send({ type: "semantic:syncNow" });
    note(res?.error ? t("semError", [res.error]) : "");
    refresh();
  });
  $("semSyncLeave").addEventListener("click", async () => {
    await send({ type: "semantic:syncLeave" });
    $("semSyncCode").value = "";
    refresh();
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

  refresh();
  setInterval(() => {
    if (!document.getElementById("semanticTab").hidden) {
      refresh();
    }
  }, 1500);
})();
