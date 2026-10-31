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
  const view = j => ({ key: j.key, mode: j.mode, status: j.status, text: j.text, items: j.items, from: j.from, notes: j.notes, warn: j.warn, error: j.error, model: j.model });

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
    j.model = conf.aiType === "nbhelper" ? "NovaBird Helper" : conf.aiModel;
    try {
      if (!conf.aiEnabled) throw new Error("disabled");
      if (!conf.aiUrl) throw new Error("off");
      if (!conf.aiModel && conf.aiType !== "nbhelper") throw new Error("model");
      const thread = r.ids ? await nbAI.threadText(r.ids, conf) : null;
      const message = thread ? null : await messenger.messages.get(r.messageId);
      const limit = r.mode === "translate" ? TRANSLATE_CHARS : Infinity;
      const { text, truncated, quoted } = thread
        ? (limit < Infinity ? { text: thread.text.slice(0, limit), truncated: thread.truncated || thread.text.length > limit, quoted: thread.quoted } : thread)
        : await nbAI.mailText(message.id, conf, limit, { onlyNew: true });
      if (!text) throw new Error("empty");
      j.warn = nbAI.suspicious(text);
      if (!nbAI.isLocal(nbAI.base(conf))) j.notes.push({ k: "remote", v: new URL(nbAI.base(conf)).host });
      const subject = thread ? thread.subject || "" : message.subject || "";
      const header = thread
        ? `Subject: ${subject}`
        : `Subject: ${subject}\nFrom: ${message.author || ""}\nDate: ${message.date ? new Date(message.date).toLocaleString() : ""}`;
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
      const result = await nbAI.chat(conf, messages, partial => {
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
      if (quoted) j.notes.push({ k: "quoted" });
      if (truncated) j.notes.push({ k: "truncated" });
      j.status = "done";
    } catch (e) {
      if (e.name === "AbortError") {
        j.status = "aborted";
        return;
      }
      j.status = "error";
      j.error = String(e.message || e);
      j.text = "";
    }
    publish(j);
    // fertig, während niemand zusieht: Häkchen am KI-Knopf des Tabs
    if (j.status === "done" && j.ports.size === 0 && j.tabId != null) {
      messenger.messageDisplayAction.setBadgeText({ tabId: j.tabId, text: "✓" }).catch(() => {});
      messenger.messageDisplayAction.setBadgeBackgroundColor({ tabId: j.tabId, color: "#1e8e5a" }).catch(() => {});
    }
  }

  function start(r) {
    const key = keyOf(r);
    let j = jobs.get(key);
    if (j && !r.force && (j.status === "running" || j.status === "done")) return j;
    j?.controller.abort();
    j = { key, mode: r.mode, status: "running", text: "", items: null, from: "", notes: [], warn: false, error: "", model: "", ports: j?.ports || new Set(), controller: new AbortController(), tabId: r.tabId };
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

  // Andere Mail im Tab: Häkchen weg (es gehörte zur vorigen)
  const displayed = messenger.messageDisplay.onMessagesDisplayed || messenger.messageDisplay.onMessageDisplayed;
  displayed?.addListener(tab => messenger.messageDisplayAction.setBadgeText({ tabId: tab.id, text: "" }).catch(() => {}));
})();
