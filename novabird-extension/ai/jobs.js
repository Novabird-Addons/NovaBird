"use strict";

/* KI-Assistent im Hintergrund: Zusammenfassung, Übersetzung und Termine rechnet die Hintergrundseite, nicht das Popup.
 * So läuft eine Anfrage weiter, wenn das Popup zugeht (Thunderbird schließt es beim Klick daneben); beim erneuten Öffnen
 * kommt der Stand bzw. das Ergebnis sofort. Gemerkt je Mail (oder Konversation), Reiter und Zielsprache, die letzten 30.
 * Popup und eigenes Fenster verbinden sich über runtime.connect("nbx-ai") und bekommen jede Änderung. Wird ein Ergebnis
 * fertig, während niemand zusieht, zeigt der KI-Knopf dieses Tabs ein Häkchen. */
(() => {
  const MAX_JOBS = 30;
  const TRANSLATE_CHARS = 9000; // Übersetzung braucht so viel Platz für die Antwort wie für den Text
  const jobs = new Map(); // key -> job

  const keyOf = r => [r.mode, r.ids ? `t${r.ids.join(",")}` : `m${r.messageId}`, r.mode === "translate" ? r.toLang : "", r.uiLang].join("|");

  // Zustand für Popup/Fenster (ohne Ports und Abbruch)
  const view = j => ({ key: j.key, mode: j.mode, status: j.status, text: j.text, items: j.items, from: j.from, notes: j.notes, warn: j.warn, error: j.error, model: j.model, deadlines: j.deadlines, msgKey: j.msgKey });

  function publish(j) {
    for (const p of j.ports) {
      try {
        p.postMessage(view(j));
      } catch {
        j.ports.delete(p);
      }
    }
  }

  async function compute(j, r) {
    const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
    let deadlinesFor = null; // Mail, deren Fristen nach der Zusammenfassung nachkommen
    let shared = null; // vorbereitete bzw. beim Helper angemeldete Zusammenfassung
    j.model = conf.aiType === "nbhelper" ? `NovaBird Helper${conf.aiHelperModel ? " · " + conf.aiHelperModel.replace(/^ollama:/, "") : ""}` : conf.aiModel;
    try {
      if (!conf.aiEnabled) throw new Error("disabled");
      if (!conf.aiUrl) throw new Error("off");
      if (!conf.aiModel && conf.aiType !== "nbhelper") throw new Error("model");
      if (!nbAI.feature(conf, r.mode)) throw new Error("feature");
      const thread = r.ids ? await nbAI.threadText(r.ids, conf) : null;
      const message = thread ? null : await messenger.messages.get(r.messageId);
      const limit = r.mode === "translate" ? TRANSLATE_CHARS : Infinity;
      const { text, truncated, quoted } = thread
        ? (limit < Infinity ? { text: thread.text.slice(0, limit), truncated: thread.truncated || thread.text.length > limit, quoted: thread.quoted } : thread)
        : await nbAI.mailText(message.id, conf, limit, { onlyNew: true });
      if (!text) throw new Error("empty");
      if (!nbAI.isLocal(nbAI.base(conf))) {
        let host;
        try {
          host = new URL(nbAI.base(conf)).host;
        } catch {
          throw new Error("url"); // ungültige Adresse: Hinweistext statt rohem TypeError
        }
        j.notes.push({ k: "remote", v: host });
      }
      const subject = thread ? thread.subject || "" : message.subject || "";
      j.warn = nbAI.suspicious(`${subject}\n${text}`); // Betreff mitprüfen: ebenso fremd gesteuert wie der Text
      const header = thread
        ? `Subject: ${subject}`
        : `Subject: ${subject}\nFrom: ${message.author || ""}\nDate: ${message.date ? new Date(message.date).toLocaleString() : ""}`;
      // Einzelne Mail: vorbereitete Zusammenfassung (ai/prep.js, auch von einem anderen PC über den Helper) nehmen, sonst
      // rechnen und für die anderen PCs ablegen. „Neu erstellen“ rechnet immer.
      const src = !thread ? { msg: message, msgId: message.headerMessageId || `local:${message.id}`, text, hash: await nbAI.textHash(text) } : null;
      if (src) j.msgKey = src.msgId; // Termine: was steht aus dieser Mail schon im Kalender?
      if (src && r.mode === "summary") {
        shared = await nbPrep.lookup(conf, "sum", nbPrep.sumVariant(conf, r.uiLang), src, { claim: true, wait: !r.force, local: !r.force }).catch(() => ({}));
      }
      let messages;
      let opts = {};
      if (r.mode === "summary") {
        messages = nbAI.prompt(conf, r.uiLang, header, text, Boolean(thread));
      } else if (r.mode === "translate") {
        messages = nbAI.translatePrompt(r.uiLang, r.toLang, subject, text);
        opts = { maxNew: 4096 };
      } else {
        messages = nbAI.eventsPrompt(r.uiLang, thread ? new Date() : new Date(message.date), header, text);
        opts = { maxNew: 1200, json: true };
      }
      // „Neu erstellen“ (force): auch ein beim Helper schon vorhandenes Ergebnis nicht übernehmen, sondern neu rechnen
      const prepared = r.force ? null : shared?.value;
      const result = prepared ?? await nbAI.chat(conf, messages, partial => {
        if (r.mode !== "events") {
          j.text = partial;
          publish(j);
        }
      }, j.controller.signal, opts);
      if (r.mode === "events") {
        j.items = nbAI.parseItems(result);
        j.from = thread ? subject : `${subject} – ${message.author || ""}`;
      } else {
        j.text = result;
      }
      if (prepared) j.notes.push({ k: "prepared" });
      if (quoted) j.notes.push({ k: "quoted" });
      if (truncated) j.notes.push({ k: "truncated" });
      j.status = "done";
      if (src && r.mode === "summary" && result) {
        if (!prepared) nbPrep.remember(conf, "sum", nbPrep.sumVariant(conf, r.uiLang), src, result, shared?.id).catch(() => {});
        deadlinesFor = src;
      }
    } catch (e) {
      if (shared?.claimed) nbAI.shareRelease(conf, shared.claimed);
      if (e.name === "AbortError") {
        j.status = "aborted";
        return;
      }
      j.status = "error";
      j.error = String(e.message || e);
      j.text = "";
    }
    // inzwischen abgebrochen (z. B. „Neu erstellen“, während hier noch auf einen anderen PC gewartet wurde): nichts mehr melden –
    // der neue Auftrag benutzt dieselben Ports und denselben Schlüssel
    if (j.controller.signal.aborted) return;
    publish(j);
    // fertig, während niemand zusieht: Häkchen am KI-Knopf des Tabs
    if (j.status === "done" && j.ports.size === 0 && j.tabId != null) {
      // nur, wenn der Tab noch diese Mail (bzw. eine des Fadens) zeigt – sonst stünde das Häkchen an der falschen Mail
      const shown = await messenger.messageDisplay.getDisplayedMessage(j.tabId).catch(() => null);
      if (shown && (shown.id === r.messageId || r.ids?.includes(shown.id))) {
        messenger.messageDisplayAction.setBadgeText({ tabId: j.tabId, text: "✓" }).catch(() => {});
        messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId: j.tabId, color: "#1e8e5a" }).catch(() => {});
      }
    }
    if (deadlinesFor) await addDeadlines(j, conf, r, deadlinesFor);
  }

  // Fristen der Mail unter der Zusammenfassung (Einstellung „Fristen“): aus ihrer Einordnung (ai/prep.js), ggf. jetzt gerechnet
  async function addDeadlines(j, conf, r, src) {
    if (!nbAI.feature(conf, "deadlines") || j.controller.signal.aborted) return;
    try {
      const d = await nbPrep.digestFor(conf, r.uiLang, src, { wait: true });
      const done = await nbPrep.reminded(src.msgId);
      j.deadlines = (d?.tasks || []).map((t, i) => ({ ...t, i, reminded: done.includes(i) })).filter(t => t.due);
      j.msgKey = src.msgId;
      j.from = `${src.msg.subject || ""} – ${src.msg.author || ""}`;
      if (j.deadlines.length) publish(j);
    } catch (e) {
      console.warn("NovaBird-Extension: Fristen", e);
    }
  }

  function start(r) {
    const key = keyOf(r);
    let j = jobs.get(key);
    if (j && !r.force && (j.status === "running" || j.status === "done")) return j;
    j?.controller.abort();
    j = { key, mode: r.mode, status: "running", text: "", items: null, from: "", notes: [], warn: false, error: "", model: "", deadlines: null, msgKey: "", ports: j?.ports || new Set(), controller: new AbortController(), tabId: r.tabId };
    jobs.delete(key);
    jobs.set(key, j);
    while (jobs.size > MAX_JOBS) {
      const [oldKey, old] = jobs.entries().next().value;
      if (old.status === "running") break;
      jobs.delete(oldKey);
    }
    compute(j, r);
    return j;
  }

  messenger.runtime.onConnect.addListener(port => {
    if (port.name !== "nbx-ai" || port.sender?.id !== messenger.runtime.id) return;
    const mine = new Set();
    port.onMessage.addListener(msg => {
      if (msg?.type !== "start" || !["summary", "translate", "events"].includes(msg.mode)) return;
      const r = {
        mode: msg.mode, uiLang: String(msg.uiLang || "en"), toLang: String(msg.toLang || ""), force: Boolean(msg.force),
        messageId: Number.isInteger(msg.messageId) ? msg.messageId : null,
        ids: Array.isArray(msg.ids) && msg.ids.length && msg.ids.length <= 120 && msg.ids.every(Number.isInteger) ? msg.ids : null,
        tabId: Number.isInteger(msg.tabId) ? msg.tabId : null,
      };
      if (r.messageId == null && !r.ids) return;
      const j = start(r);
      j.ports.add(port);
      mine.add(j);
      if (r.tabId != null) messenger.messageDisplayAction.setBadgeText({ tabId: r.tabId, text: "" }).catch(() => {});
      port.postMessage(view(j));
    });
    port.onDisconnect.addListener(() => {
      for (const j of mine) j.ports.delete(port);
    });
  });

  // Vorlesen (ai/speech.js) folgt einem noch laufenden Auftrag: aktueller Text und Zustand
  globalThis.nbJobs = { peek: key => (jobs.has(key) ? { text: jobs.get(key).text, status: jobs.get(key).status } : null) };

  // Andere Mail im Tab: Häkchen weg (es gehörte zur vorigen)
  const displayed = messenger.messageDisplay.onMessagesDisplayed || messenger.messageDisplay.onMessageDisplayed;
  displayed?.addListener(tab => messenger.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {}));
})();
