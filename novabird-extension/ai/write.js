"use strict";

/* Schreiben (Hintergrund): Antwort entwerfen, korrigieren, Ton ändern, übersetzen – für das KI-Fenster im Verfassen-Fenster
 * (ai/compose.html). Gerechnet wird hier, damit nichts verloren geht, wenn das Fenster beim Klick in den Text zugeht; beim
 * erneuten Öffnen ist das Ergebnis da. Je Verfassen-Fenster und Reiter ein Auftrag. Eingefügt wird erst mit „Übernehmen“
 * (ai/compose-script.js im Editor). */
(() => {
  const jobs = new Map(); // `${tabId}|${kind}` -> {key, kind, status, text, error, ports, controller, source}
  const MAX_TEXT = 12000;

  messenger.composeScripts?.register({ js: [{ file: "ai/compose-script.js" }] }).catch(e => console.warn("NovaBird-Extension: Verfassen-Skript", e));

  const view = j => ({ key: j.key, kind: j.kind, status: j.status, text: j.text, error: j.error, source: j.source, notes: j.notes });
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
    try {
      const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
      if (!conf.aiEnabled) throw new Error("disabled");
      if (!conf.aiUrl) throw new Error("off");
      if (!conf.aiModel && conf.aiType !== "nbhelper") throw new Error("model");
      if (!nbAI.feature(conf, "compose")) throw new Error("feature");
      if (!nbAI.isLocal(nbAI.base(conf))) j.notes.push({ k: "remote", v: new URL(nbAI.base(conf)).host });
      let messages;
      if (r.kind === "reply" && r.relatedId) {
        const msg = await messenger.messages.get(r.relatedId);
        const { text } = await nbAI.mailText(r.relatedId, conf, MAX_TEXT, { onlyNew: true });
        if (!text) throw new Error("empty");
        const header = `Subject: ${msg.subject || ""}\nFrom: ${msg.author || ""}\nDate: ${msg.date ? new Date(msg.date).toLocaleString() : ""}`;
        messages = nbAI.writePrompt(r.uiLang, "reply", text, { header, wish: r.wish });
      } else {
        // Neue Mail (nichts zu beantworten): Entwurf aus dem eigenen Text als Stichpunkte, sonst aus der Vorgabe
        const own = r.text.trim();
        const draft = r.kind === "reply";
        const text = (draft && !own ? r.wish : r.text).slice(0, MAX_TEXT);
        if (!text.trim()) throw new Error("empty");
        messages = nbAI.writePrompt(r.uiLang, draft ? "draft" : r.kind, text, { wish: draft && own ? r.wish : "", tone: r.tone, toLang: r.toLang });
      }
      const result = await nbAI.chat(conf, messages, partial => {
        j.text = partial;
        publish(j);
      }, j.controller.signal, { maxNew: 2048 });
      j.text = result.trim();
      j.status = "done";
    } catch (e) {
      if (e.name === "AbortError") return;
      j.status = "error";
      j.error = String(e.message || e);
    }
    publish(j);
  }

  messenger.runtime.onConnect.addListener(port => {
    if (port.name !== "nbx-write" || port.sender?.id !== messenger.runtime.id) return;
    const mine = new Set();
    port.onMessage.addListener(msg => {
      if (!Number.isInteger(msg?.tabId) || !["reply", "fix", "tone", "translate"].includes(msg.kind)) return;
      const key = `${msg.tabId}|${msg.kind}`;
      let j = jobs.get(key);
      // reuse: automatischer Start beim Öffnen – ein vorhandenes Ergebnis bleibt
      if (msg.type === "start" && !(msg.reuse && j && j.status !== "error")) {
        j?.controller.abort();
        j = {
          key, kind: msg.kind, status: "running", text: "", error: "", notes: [], ports: j?.ports || new Set(), controller: new AbortController(),
          source: msg.source === "selection" ? "selection" : "own",
        };
        jobs.set(key, j);
        compute(j, {
          kind: msg.kind, uiLang: String(msg.uiLang || "en"), text: String(msg.text || ""), wish: String(msg.wish || ""),
          tone: String(msg.tone || ""), toLang: String(msg.toLang || ""), relatedId: Number.isInteger(msg.relatedId) ? msg.relatedId : null,
        });
      } else if (msg.type !== "watch" && msg.type !== "start") {
        return;
      }
      if (!j) return;
      j.ports.add(port);
      mine.add(j);
      port.postMessage(view(j));
    });
    port.onDisconnect.addListener(() => {
      for (const j of mine) j.ports.delete(port);
    });
  });

  // Verfassen-Fenster zu: seine Aufträge vergessen
  messenger.tabs.onRemoved.addListener(tabId => {
    for (const [key, j] of jobs) {
      if (key.startsWith(`${tabId}|`)) {
        j.controller.abort();
        jobs.delete(key);
      }
    }
  });
})();
