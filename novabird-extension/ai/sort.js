"use strict";

/* KI-Einsortieren (Hintergrund): Der Nutzer beschreibt je Regel einen Zielordner in eigenen Worten; jede neue Mail im
 * Posteingang ordnet die KI höchstens einer Regel zu (eine Anfrage für alle Regeln, Antwort = Nummer, ai.js sortPrompt).
 * - Bereich je Regel: „account“ = nur der Posteingang des Kontos, in dem der Zielordner liegt; „all“ = alle Posteingänge.
 * - Modus je Regel: „off“, „dry“ (Probelauf: nur Vorschlag in der Liste, Ja verschiebt, Nein verwirft), „auto“ (verschiebt,
 *   steht im Protokoll und lässt sich rückgängig machen).
 * - Vorhandene Mails: auf Knopfdruck die Posteingänge der letzten Tage prüfen – ergibt immer nur Vorschläge.
 * - Mit dem NovaBird Helper entscheidet nur ein PC je Mail (nbPrep.obtain, Art „sort“); die Variante ist eine Prüfsumme der
 *   Regeln, ein PC mit anderen Regeln rechnet also selbst.
 * Gerufen von ai/prep.js (neue Mails); die Seite ai/sort.html spricht per runtime-Nachricht „nbx-sort“ mit diesem Teil.
 * Speicher: aiSortRules (Regeln), aiSortLog (Vorschläge und Protokoll, 30 Tage, höchstens 500 Einträge). */
(() => {
  const RULES = "aiSortRules";
  const LOG = "aiSortLog";
  const KEEP_MS = 30 * 86400_000;
  const MAX_LOG = 500;
  const SORT_CHARS = 4000;
  const SCAN_MAX = 300;
  const MODES = ["off", "dry", "auto"];

  // ---- Regeln -----------------------------------------------------------------------------------------------------------
  let rules = null;
  async function loadRules() {
    if (!rules) rules = clean((await messenger.storage.local.get({ [RULES]: [] }))[RULES]);
    return rules;
  }
  function clean(list) {
    return (Array.isArray(list) ? list : [])
      .filter(r => r && typeof r.id === "string" && r.folder && typeof r.folder.accountId === "string" && typeof r.folder.path === "string")
      .map(r => ({
        id: r.id,
        name: String(r.name || r.folder.path).slice(0, 200),
        folder: { accountId: r.folder.accountId, path: r.folder.path },
        description: String(r.description || "").slice(0, 400),
        scope: r.scope === "all" ? "all" : "account",
        mode: MODES.includes(r.mode) ? r.mode : "dry",
      }));
  }
  // Reihenfolge und Prüfsumme nur aus Ordnerpfad und Beschreibung: Kennung und Kontoname sind auf jedem PC anders, so teilen
  // sich PCs mit denselben Regeln das Ergebnis über den Helper (die Nummer der Antwort meint dort dieselbe Regel)
  const key = r => `${r.folder.path}|${r.description.trim()}`;
  /** Regeln, die für eine Mail im Konto accountId gelten (eingeschaltet, mit Beschreibung), feste Reihenfolge. */
  const applicable = (list, accountId) =>
    list.filter(r => r.mode !== "off" && r.description.trim() && (r.scope === "all" || r.folder.accountId === accountId))
      .sort((a, b) => key(a).localeCompare(key(b)) || a.id.localeCompare(b.id));
  const active = async () => (await loadRules()).some(r => r.mode !== "off" && r.description.trim());
  const variantOf = list => nbAI.textHash(JSON.stringify(list.map(r => [r.folder.path, r.description.trim()])));

  // ---- Protokoll --------------------------------------------------------------------------------------------------------
  let log = null;
  let saveTimer = null;
  async function loadLog() {
    if (!log) {
      const raw = (await messenger.storage.local.get({ [LOG]: [] }))[LOG];
      log = Array.isArray(raw) ? raw : [];
    }
    return log;
  }
  function saveLog() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const now = Date.now();
      // an Ort und Stelle kürzen: handle() und die Prüfung vorhandener Mails halten das Array über den KI-Aufruf hinweg und
      // schreiben danach hinein – ein neues Array ließe solche Einträge verloren gehen
      const keep = log.filter(e => now - (e.at || 0) < KEEP_MS).slice(-MAX_LOG);
      log.splice(0, log.length, ...keep);
      messenger.storage.local.set({ [LOG]: log }).catch(e => console.warn("NovaBird-Extension: Einsortieren-Protokoll", e));
    }, 300);
  }
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (RULES in changes) rules = clean(changes[RULES].newValue);
    if (LOG in changes && !changes[LOG].newValue) log = null;
  });
  loadRules().catch(() => {});

  const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
  const isInbox = f => f?.type === "inbox" || (f?.specialUse || []).includes("inbox");
  const folderRef = f => ({ accountId: f.accountId, path: f.path });

  /** Mail per Message-ID in einem Ordner finden (die Nummer ändert sich beim Verschieben). */
  async function findIn(msgId, folder) {
    let page = await messenger.messages.query({ headerMessageId: msgId, folder });
    for (;;) {
      const m = (page?.messages || []).find(x => x.folder?.accountId === folder.accountId && x.folder?.path === folder.path);
      if (m) return m;
      if (!page?.id) return null;
      page = await messenger.messages.continueList(page.id);
    }
  }

  // ---- Einordnen ---------------------------------------------------------------------------------------------------------
  /** Regel für eine Mail (src aus nbPrep.source) oder null; PENDING, wenn ein anderer PC gerade rechnet. */
  async function classify(c, src, list) {
    if (!list.length || !src.text) return null;
    const variant = await variantOf(list);
    const v = await nbPrep.obtain(c, "sort", variant, src, async () => {
      const text = await nbAI.chat(c, nbAI.sortPrompt(nbPrep.header(src), src.text.slice(0, SORT_CHARS), list), () => {}, undefined, { maxNew: 20, json: true });
      return { i: nbAI.parseSort(text, list.length) };
    });
    if (v === nbPrep.PENDING) return v;
    const i = Number(v?.i);
    return Number.isInteger(i) && i >= 1 && i <= list.length ? list[i - 1] : null;
  }

  async function move(id, folder) {
    await messenger.messages.move([id], folder);
  }

  function entryFor(src, rule, from, extra) {
    return {
      id: newId(), msgId: src.msgId, subject: String(src.msg.subject || "").slice(0, 300), author: String(src.msg.author || "").slice(0, 200),
      date: new Date(src.msg.date).getTime() || 0, from, ruleId: rule.id, to: { ...rule.folder }, toName: rule.name, at: Date.now(), ...extra,
    };
  }

  /** Neue Mail (aus ai/prep.js): einordnen, im Probelauf vorschlagen, sonst verschieben. Jede Mail nur einmal. */
  async function handle(c, src, messageId) {
    if (!isInbox(src.msg.folder) || src.msgId.startsWith("local:")) return null;
    const all = await loadLog();
    if (all.some(e => e.msgId === src.msgId)) return null; // schon behandelt (auch wenn der Nutzer sie zurückgeholt hat)
    const list = applicable(await loadRules(), src.msg.folder.accountId);
    const rule = await classify(c, src, list);
    if (!rule || rule === nbPrep.PENDING) return rule;
    if ((await loadLog()).some(e => e.msgId === src.msgId)) return null;
    const from = folderRef(src.msg.folder);
    if (rule.mode !== "auto") {
      all.push(entryFor(src, rule, from, { state: "suggested" }));
      saveLog();
      return null;
    }
    // noch im Posteingang? (ein anderer PC kann sie bei IMAP schon verschoben haben)
    const now = await messenger.messages.get(messageId).catch(() => null);
    if (!now || !isInbox(now.folder)) return null;
    const e = entryFor(src, rule, from, { state: "moving" });
    all.push(e);
    try {
      await move(messageId, rule.folder);
      e.state = "moved";
    } catch (err) {
      e.state = "failed";
      e.error = String(err?.message || err).slice(0, 200);
    }
    saveLog();
    return null;
  }

  // ---- Aktionen der Seite ------------------------------------------------------------------------------------------------
  async function act(entryId, what) {
    const all = await loadLog();
    const e = all.find(x => x.id === entryId);
    if (!e) return { ok: false, error: "gone" };
    try {
      if (what === "no" && e.state === "suggested") e.state = "dismissed";
      else if (what === "yes" && (e.state === "suggested" || e.state === "failed")) {
        const m = await findIn(e.msgId, e.from);
        if (!m) throw new Error("notfound");
        await move(m.id, e.to);
        Object.assign(e, { state: "moved", accepted: true, at: Date.now(), error: undefined });
      } else if (what === "undo" && e.state === "moved") {
        const m = await findIn(e.msgId, e.to);
        if (!m) throw new Error("notfound");
        await move(m.id, e.from);
        Object.assign(e, { state: "undone", at: Date.now() });
      } else return { ok: false, error: "state" };
      saveLog();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err?.message || err).slice(0, 200) };
    }
  }

  // Vorhandene Mails der Posteingänge prüfen (nur Vorschläge); höchstens ein Lauf zugleich, Fortschritt per Abfrage
  let scan = { running: false, done: 0, total: 0, found: 0, error: "" };
  async function startScan(days) {
    if (scan.running) return { ok: false, error: "running" };
    const c = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
    if (!c.aiEnabled) return { ok: false, error: "off" };
    const list = (await loadRules()).filter(r => r.mode !== "off" && r.description.trim());
    if (!list.length) return { ok: false, error: "norules" };
    const since = new Date(Date.now() - Math.max(1, Math.min(365, Number(days) || 30)) * 86400_000);
    const ids = [];
    for (const acc of await messenger.accounts.list(true)) {
      if (!applicable(list, acc.id).length) continue;
      const stack = [...(acc.folders || [])];
      while (stack.length) {
        const f = stack.shift();
        stack.push(...(f.subFolders || []));
        if (!isInbox(f)) continue;
        let page = await messenger.messages.query({ folder: f, fromDate: since });
        for (;;) {
          for (const m of page?.messages || []) if (!m.junk) ids.push(m.id);
          if (!page?.id || ids.length >= SCAN_MAX * 2) break;
          page = await messenger.messages.continueList(page.id);
        }
      }
    }
    scan = { running: true, done: 0, total: Math.min(ids.length, SCAN_MAX), found: 0, error: "" };
    (async () => {
      for (const id of ids.slice(0, SCAN_MAX)) {
        if (!scan.running) break;
        try {
          const src = await nbPrep.source(c, id);
          const all = await loadLog();
          if (!src.msgId.startsWith("local:") && !all.some(e => e.msgId === src.msgId)) {
            const rule = await classify(c, src, applicable(list, src.msg.folder.accountId));
            if (rule && rule !== nbPrep.PENDING) {
              all.push(entryFor(src, rule, folderRef(src.msg.folder), { state: "suggested", existing: true }));
              scan.found++;
              saveLog();
            }
          }
        } catch (e) {
          if (nbAI.isConfigError(e)) {
            scan.error = String(e.message);
            break;
          }
          console.warn("NovaBird-Extension: Einsortieren (vorhandene)", e);
        }
        scan.done++;
      }
      scan.running = false;
    })();
    return { ok: true, total: scan.total };
  }

  // Kein async-Listener: nur eigene Nachrichten beantworten
  messenger.runtime.onMessage.addListener((msg, sender) => {
    if (sender?.id !== messenger.runtime.id || msg?.type !== "nbx-sort") return undefined;
    if (msg.op === "state") return loadLog().then(l => ({ log: l, scan }));
    if (msg.op === "act" && typeof msg.entryId === "string" && ["yes", "no", "undo"].includes(msg.what)) return act(msg.entryId, msg.what);
    if (msg.op === "scan") return startScan(msg.days);
    if (msg.op === "stopScan") {
      scan.running = false;
      return Promise.resolve(true);
    }
    if (msg.op === "clear") {
      return loadLog().then(all => {
        all.splice(0, all.length, ...all.filter(e => e.state === "suggested")); // an Ort und Stelle (siehe saveLog)
        saveLog();
        return true;
      });
    }
    return undefined;
  });

  globalThis.nbSort = { active, handle, applicable, clean, variantOf };
})();
