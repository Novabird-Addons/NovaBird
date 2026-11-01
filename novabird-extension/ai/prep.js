"use strict";

/* KI vorbereiten (Hintergrund, Einstellung „Vorbereiten“): Jede neue Mail im Posteingang wird gleich beim Eintreffen
 * eingeordnet (Abschnitt, Absender, ein Satz, Aufgaben mit Fristen); längere Mails bekommen auch schon ihre Zusammenfassung,
 * ebenso eine längere Mail, die man 2 s offen hat. Der Überblick („Was gibt's Neues?“) setzt sich dann ohne KI aus den
 * Einträgen zusammen, die Fristen stehen im Überblick und unter der Zusammenfassung.
 * Mit dem NovaBird Helper rechnet nur ein PC je Mail: Wer sie zuerst sieht, meldet sie beim Helper an und legt das Ergebnis
 * dort verschlüsselt ab (Schlüssel aus Message-ID und Prüfsumme des Textes); die anderen PCs holen es ab.
 * Einträge (storage.local aiDigests, je Message-ID) bleiben 10 Tage.
 * Phishing-Prüfung (Schalter, unabhängig von „Vorbereiten“): Fakten zu jeder neuen Mail für das Add-on NovaBird
 * Phishing-Schutz, abgefragt mit phish:extract, nachgereicht als phish:result (docs/ki-anbindung.md). */
(() => {
  const STORE = "aiDigests";
  const KEEP_MS = 10 * 86400_000;
  const MAX_ENTRIES = 3000;
  const LONG = 1200; // ab so vielen Zeichen (neuer Teil der Mail) wird die Zusammenfassung vorbereitet
  const DIGEST_CHARS = 6000;
  const PHISH_CHARS = 4000;
  const PHISH_WAIT = 2500; // so lange wartet eine Anfrage des Phishing-Add-ons, sonst „busy“ und das Ergebnis kommt nach
  const PHISH_ADDON = "phishing-addon@novabird";
  const RETRY_MS = 45_000; // ein anderer PC rechnet gerade: später abholen
  const OPEN_DELAY = 2000;
  const PENDING = Symbol("pending");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const uiLang = () => (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
  const config = async () => ({ ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) });
  const ready = c => Boolean(c.aiEnabled && c.aiUrl && (c.aiModel || c.aiType === "nbhelper"));

  // ---- Einträge ----------------------------------------------------------------------------------------------------------
  let store = null;
  let saveTimer = null;
  async function load() {
    if (!store) store = (await messenger.storage.local.get({ [STORE]: {} }))[STORE] || {};
    return store;
  }
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const now = Date.now();
      const keys = Object.keys(store);
      for (const k of keys) if (now - (store[k].seen || 0) > KEEP_MS) delete store[k];
      const rest = Object.keys(store);
      if (rest.length > MAX_ENTRIES) {
        rest.sort((a, b) => (store[a].seen || 0) - (store[b].seen || 0)).slice(0, rest.length - MAX_ENTRIES).forEach(k => delete store[k]);
      }
      messenger.storage.local.set({ [STORE]: store }).catch(e => console.warn("NovaBird-Extension: KI-Einträge", e));
    }, 500);
  }

  // Einträge gelöscht (storage.local.remove): Zwischenspeicher verwerfen
  messenger.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && STORE in changes && !changes[STORE].newValue) store = null;
  });

  /** Grunddaten einer Mail: {msg, msgId, text, hash}; Text wie bei der Zusammenfassung (nur der neue Teil). */
  async function source(c, messageId) {
    const msg = await messenger.messages.get(messageId);
    const { text } = await nbAI.mailText(messageId, c, Infinity, { onlyNew: true });
    return { msg, msgId: msg.headerMessageId || `local:${messageId}`, text, hash: await nbAI.textHash(text) };
  }

  async function entry(src) {
    const st = await load();
    let e = st[src.msgId];
    if (!e || e.hash !== src.hash) {
      e = st[src.msgId] = { hash: src.hash, reminded: [] };
    }
    Object.assign(e, { at: new Date(src.msg.date).getTime() || Date.now(), seen: Date.now(), subject: src.msg.subject || "", author: src.msg.author || "" });
    return e;
  }

  function localValue(e, kind, variant) {
    if (kind === "digest") return e.digest && e.digestLang === variant ? e.digest : null;
    if (kind === "phish") return e.phish && e.phish.v === variant ? e.phish.value : null;
    return e.sum && e.sum.v === variant ? e.sum.text : null;
  }

  async function putLocal(src, kind, variant, value) {
    const e = await entry(src);
    if (kind === "digest") Object.assign(e, { digest: value, digestLang: variant });
    else if (kind === "phish") e.phish = { v: variant, value };
    else e.sum = { v: variant, text: value };
    save();
  }

  // ---- Teilen über den Helper ----------------------------------------------------------------------------------------------
  let shareInfo = { key: "", ok: false, at: 0 };
  async function canShare(c) {
    if (c.aiType !== "nbhelper") return false;
    const key = `${c.aiUrl}|${c.aiKey}`;
    if (shareInfo.key === key && Date.now() - shareInfo.at < 10 * 60_000) return shareInfo.ok;
    let ok = false;
    try {
      ok = Boolean((await nbAI.helperHello(c.aiUrl, c.aiKey)).aiCache);
    } catch {
      /* Helper nicht erreichbar: selbst rechnen */
    }
    shareInfo = { key, ok, at: Date.now() };
    return ok;
  }

  /**
   * Ergebnis nachsehen: lokal, dann beim Helper. claim: beim Helper anmelden, dass dieser PC rechnet. wait: auf einen anderen
   * PC warten (bis 2 min). Liefert {value} | {claimed: id} | {pending: true} | {}; {id} ist die Kennung fürs Ablegen.
   */
  async function lookup(c, kind, variant, src, { claim = false, wait = false, local = true } = {}) {
    if (local) {
      const v = localValue(await entry(src), kind, variant);
      if (v) return { value: v };
    }
    if (!(await canShare(c))) return {};
    const id = await nbAI.shareId(kind, variant, src.msgId, src.hash);
    for (let i = 0; ; i++) {
      const r = (await nbAI.shareGet(c, [id], claim))[id] || {};
      if (r.data) {
        const v = await nbAI.unseal(id, src.msgId, src.hash, r.data);
        if (v != null) {
          await putLocal(src, kind, variant, v);
          return { value: v, id };
        }
        return claim ? { claimed: id, id } : { id }; // nicht lesbar (anderer Text): selbst rechnen
      }
      if (r.claimed) return { claimed: id, id };
      if (r.pending && wait && i < 40) {
        await sleep(3000);
        continue;
      }
      return r.pending ? { pending: true, id } : { id };
    }
  }

  /** Ergebnis merken und (mit Helper) für die anderen PCs ablegen. */
  async function remember(c, kind, variant, src, value, id) {
    await putLocal(src, kind, variant, value);
    if (!id && (await canShare(c))) id = await nbAI.shareId(kind, variant, src.msgId, src.hash);
    if (id) nbAI.seal(id, src.msgId, src.hash, value).then(data => nbAI.sharePut(c, id, data)).catch(() => {});
  }

  /** Nachsehen, sonst selbst rechnen (compute) und teilen; ohne wait liefert ein rechnender anderer PC PENDING. */
  async function obtain(c, kind, variant, src, compute, { wait = false } = {}) {
    const hit = await lookup(c, kind, variant, src, { claim: true, wait });
    if (hit.value != null) return hit.value;
    if (hit.pending) return PENDING;
    try {
      const value = await compute();
      await remember(c, kind, variant, src, value, hit.id);
      return value;
    } catch (e) {
      if (hit.claimed) nbAI.shareRelease(c, hit.claimed);
      throw e;
    }
  }

  const header = src => `Subject: ${src.msg.subject || ""}\nFrom: ${src.msg.author || ""}\nDate: ${src.msg.date ? new Date(src.msg.date).toLocaleString() : ""}`;

  async function computeDigest(c, lang, src) {
    const text = await nbAI.chat(c, nbAI.digestPrompt(lang, new Date(src.msg.date), header(src), src.text.slice(0, DIGEST_CHARS)), () => {}, undefined, { maxNew: 400, json: true });
    return nbAI.parseDigest(text);
  }
  const computeSummary = (c, lang, src) => nbAI.chat(c, nbAI.prompt(c, lang, header(src), src.text, false), () => {});
  const sumVariant = (c, lang) => `${lang}|${c.aiLang}`;

  /** Einordnung einer Mail (für Überblick und Fristen); src aus source() oder vom Aufrufer. */
  async function digestFor(c, lang, src, { wait = true } = {}) {
    const v = await obtain(c, "digest", lang, src, () => computeDigest(c, lang, src), { wait });
    return v === PENDING ? null : v;
  }

  // Phishing-Prüfung: nur Fakten (ai.js parsePhish); je Mail höchstens eine Rechnung zugleich (Warteschlange und Anfrage des
  // Phishing-Add-ons beim Öffnen treffen sich hier)
  const phishOn = c => nbAI.feature(c, "phish") && nbAI.phishLocal(c);
  const modelName = c => (c.aiType === "nbhelper" ? c.aiHelperModel || nbAI.stats()?.model || "helper" : c.aiModel);
  async function computePhish(c, src) {
    const text = await nbAI.chat(c, nbAI.phishPrompt(header(src), src.text.slice(0, PHISH_CHARS)), () => {}, undefined, { maxNew: 150, json: true });
    return { ...nbAI.parsePhish(text), model: modelName(c) };
  }
  const phishRuns = new Map(); // msgId → Promise {value, cached} | PENDING
  function phishFor(c, src, { wait = false } = {}) {
    let run = phishRuns.get(src.msgId);
    if (!run) {
      let computed = false;
      run = obtain(c, "phish", nbAI.PHISH_VARIANT, src, () => ((computed = true), computePhish(c, src)), { wait })
        .then(v => (v === PENDING ? PENDING : { value: v, cached: !computed }))
        .finally(() => phishRuns.delete(src.msgId));
      phishRuns.set(src.msgId, run);
    }
    return run;
  }

  // ---- Warteschlange: neue Mails und geöffnete längere Mails --------------------------------------------------------------
  const queue = []; // {messageId, tries, due}
  let busy = false;
  let wake = null;

  function enqueue(messageId, front = false) {
    if (queue.some(q => q.messageId === messageId)) return;
    const item = { messageId, tries: 0, due: 0 };
    front ? queue.unshift(item) : queue.push(item);
    pump();
  }

  async function pump() {
    if (busy) return;
    busy = true;
    clearTimeout(wake);
    try {
      for (;;) {
        const now = Date.now();
        const i = queue.findIndex(q => q.due <= now);
        if (i < 0) {
          if (queue.length) wake = setTimeout(pump, Math.max(1000, Math.min(...queue.map(q => q.due)) - now));
          break;
        }
        const [item] = queue.splice(i, 1);
        try {
          if ((await prepare(item.messageId)) === PENDING && ++item.tries < 6) queue.push({ ...item, due: Date.now() + RETRY_MS });
        } catch (e) {
          console.warn("NovaBird-Extension: KI vorbereiten", e);
          if (++item.tries < 2) queue.push({ ...item, due: Date.now() + 5 * 60_000 });
        }
      }
    } finally {
      busy = false;
    }
  }

  async function prepare(messageId) {
    const c = await config();
    if (!ready(c) || !(c.aiPrepare || phishOn(c))) return null;
    const lang = uiLang();
    const src = await source(c, messageId);
    if (!src.text) return null;
    let pending = false;
    // zuerst die Phishing-Prüfung: kurz, und der Phishing-Schutz wartet beim Öffnen höchstens 2,5 s
    if (phishOn(c)) {
      try {
        const r = await phishFor(c, src);
        if (r === PENDING) pending = true;
        else deliver(messageId, r, src);
      } catch (e) {
        deliver(messageId, e, src);
        throw e;
      }
    }
    if (!c.aiPrepare) return pending ? PENDING : null;
    if (nbAI.feature(c, "overview") || nbAI.feature(c, "deadlines")) {
      if ((await obtain(c, "digest", lang, src, () => computeDigest(c, lang, src))) === PENDING) pending = true;
    }
    if (nbAI.feature(c, "summary") && src.text.length >= LONG) {
      if ((await obtain(c, "sum", sumVariant(c, lang), src, () => computeSummary(c, lang, src))) === PENDING) pending = true;
    }
    return pending ? PENDING : null;
  }

  async function newMessages(folder, list) {
    const c = await config();
    if (!ready(c) || !(c.aiPrepare || phishOn(c))) return;
    const inbox = folder?.type === "inbox" || (folder?.specialUse || []).includes("inbox");
    if (!inbox) return;
    let page = list;
    for (;;) {
      for (const m of page?.messages || []) if (!m.junk) enqueue(m.id);
      if (!page?.id) break;
      page = await messenger.messages.continueList(page.id);
    }
  }
  messenger.messages.onNewMailReceived.addListener((folder, list) => {
    newMessages(folder, list).catch(e => console.warn("NovaBird-Extension: neue Mails", e));
  });

  // Längere Mail 2 s offen: Zusammenfassung vorbereiten (sie liegt dann meist schon da, wenn man den KI-Knopf drückt)
  const displayed = messenger.messageDisplay.onMessagesDisplayed || messenger.messageDisplay.onMessageDisplayed;
  displayed?.addListener((tab, arg) => {
    const list = Array.isArray(arg) ? arg : arg?.messages || (arg ? [arg] : []);
    if (list.length !== 1) return;
    const id = list[0].id;
    setTimeout(async () => {
      try {
        const c = await config();
        if (!ready(c) || !c.aiPrepare) return;
        const now = await (messenger.messageDisplay.getDisplayedMessages?.(tab.id) ?? messenger.messageDisplay.getDisplayedMessage(tab.id).then(m => [m]));
        const shown = Array.isArray(now) ? now : now?.messages || [];
        if (shown.length === 1 && shown[0]?.id === id) enqueue(id, true);
      } catch {
        /* Tab zu */
      }
    }, OPEN_DELAY);
  });

  // ---- Phishing-Schutz (Add-on phishing-addon@novabird): Fakten zu einer Mail (Vertrag: docs/ki-anbindung.md)
  const phishWanted = new Map(); // messageId → injection: Anfragen mit Antwort „busy“, das Ergebnis kommt als phish:result nach
  const errorCode = e => {
    const m = String(e?.message || e);
    if (e?.name === "AbortError" || /timeout|timed out/i.test(m)) return "timeout";
    if (["code", "permission", "url", "disabled", "off", "model", "nomodel", "forbidden"].includes(m)) return "off";
    return "error";
  };
  const phishAnswer = (r, injection) => {
    const v = r.value;
    return { ok: true, claimedOrg: v.claimedOrg, claimedDomain: v.claimedDomain, asksFor: v.asksFor, urgency: v.urgency, injection, model: v.model || "", cached: r.cached };
  };

  /** Ergebnis (oder Fehler) an das Phishing-Add-on nachreichen, wenn es auf diese Mail wartet. */
  function deliver(messageId, r, src) {
    if (!phishWanted.has(messageId)) return;
    const injection = phishWanted.get(messageId) ?? nbAI.suspicious(src?.text || "");
    phishWanted.delete(messageId);
    const res = r instanceof Error || !r?.value ? { ok: false, error: errorCode(r), injection } : phishAnswer(r, injection);
    messenger.runtime.sendMessage(PHISH_ADDON, { type: "phish:result", messageId, ...res }).catch(() => {}); // Add-on fehlt oder aus
  }

  async function phishExtract(messageId) {
    if (!Number.isInteger(messageId)) return { ok: false, error: "error" };
    const c = await config();
    const src = await source(c, messageId);
    const injection = nbAI.suspicious(src.text); // regelbasiert, ohne Modell: auch wenn die KI aus ist
    if (!ready(c)) return { ok: false, error: "off", injection };
    if (!nbAI.feature(c, "phish")) return { ok: false, error: "feature", injection };
    if (!nbAI.phishLocal(c)) return { ok: false, error: "cloud", injection };
    if (!src.text) return { ok: true, claimedOrg: null, claimedDomain: null, asksFor: "none", urgency: false, injection, model: "", cached: false };
    const local = localValue(await entry(src), "phish", nbAI.PHISH_VARIANT);
    if (local) return phishAnswer({ value: local, cached: true }, injection);
    const TIMEOUT = Symbol("timeout");
    const run = phishFor(c, src);
    const r = await Promise.race([run, sleep(PHISH_WAIT).then(() => TIMEOUT)]);
    if (r !== TIMEOUT && r !== PENDING) return phishAnswer(r, injection);
    phishWanted.set(messageId, injection);
    // ein anderer PC rechnet: auf ihn warten (bis 2 min), dann notfalls selbst rechnen
    const later = x => (x === PENDING ? phishFor(c, src, { wait: true }).then(y => (y === PENDING ? new Error("timeout") : y)) : x);
    (r === PENDING ? Promise.resolve(PENDING) : run).then(later).then(x => deliver(messageId, x, src), e => deliver(messageId, e, src));
    return { ok: false, error: "busy", injection };
  }

  // Erreichbar? Kurz bei der KI nachfragen (Modellliste, höchstens 2 s), Ergebnis 30 s gemerkt (grünes Symbol im Phishing-Schutz)
  let reach = { key: "", at: 0, value: null };
  async function phishReach(c) {
    const key = [c.aiType, c.aiUrl, c.aiModel, c.aiHelperModel].join("|");
    if (reach.key === key && Date.now() - reach.at < 30_000) return reach.value;
    let value = { reachable: false, model: c.aiType === "nbhelper" ? c.aiHelperModel : c.aiModel };
    try {
      const models = await Promise.race([nbAI.listModels(c), sleep(2000).then(() => [])]);
      const model = c.aiType === "nbhelper" ? c.aiHelperModel || models[0] || "" : c.aiModel;
      value = { reachable: models.length > 0 && (c.aiType === "nbhelper" || models.includes(model)), model };
    } catch {
      /* nicht erreichbar */
    }
    reach = { key, at: Date.now(), value };
    return value;
  }

  async function phishAvailable() {
    const c = await config();
    const available = ready(c) && nbAI.feature(c, "phish");
    const local = nbAI.phishLocal(c);
    const r = available && local ? await phishReach(c) : { reachable: false, model: "" };
    return { available, local, reachable: r.reachable, model: r.model || "" };
  }

  // Kein async-Listener: nur eigene Nachrichten des Phishing-Add-ons beantworten
  messenger.runtime.onMessageExternal.addListener((msg, sender) => {
    if (sender?.id !== PHISH_ADDON) return undefined;
    if (msg?.type === "phish:extract") return phishExtract(msg.messageId).catch(e => ({ ok: false, error: errorCode(e) }));
    if (msg?.type === "aiAvailable" && msg.feature === "phish") return phishAvailable();
    return undefined;
  });

  // ---- Überblick aus den Einträgen ----------------------------------------------------------------------------------------
  async function overview(c, lang, { hours = 24, unreadOnly = true, max = 40 } = {}, onProgress = () => {}, signal) {
    const { items, total } = await nbAI.newMails({ hours, unreadOnly, max, perMail: 0 }, c);
    const entries = [];
    let suspicious = false;
    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) throw new DOMException("abgebrochen", "AbortError");
      onProgress(i, items.length);
      const m = items[i];
      let d = null;
      try {
        const src = await source(c, m.id);
        suspicious ||= nbAI.suspicious(src.text);
        d = src.text ? await digestFor(c, lang, src, { wait: true }) : null;
      } catch (e) {
        if (e.name === "AbortError") throw e;
        if (["code", "permission", "url", "disabled", "off", "model", "forbidden", "nomodel"].includes(String(e.message))) throw e;
      }
      entries.push(d || { cat: "info", who: m.author || "", what: m.subject || "", tasks: [] });
    }
    onProgress(items.length, items.length);
    const mails = items.map(m => ({ id: m.id, subject: m.subject, author: m.author }));
    return { text: entries.length ? nbAI.digestOverviewText(lang, entries) : "", mails, total, suspicious, prepared: true };
  }

  /** Fristen der nächsten days Tage aus allen Einträgen (auch heute und überfällige der letzten 3 Tage). */
  async function deadlines(days = 7) {
    const st = await load();
    const today = new Date();
    const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const from = iso(new Date(today.getTime() - 3 * 86400_000));
    const to = iso(new Date(today.getTime() + days * 86400_000));
    const out = [];
    for (const [msgId, e] of Object.entries(st)) {
      (e.digest?.tasks || []).forEach((t, i) => {
        if (t.due && t.due >= from && t.due <= to) {
          out.push({ msgId, i, title: t.title, due: t.due, who: e.digest.who || e.author, subject: e.subject, author: e.author, reminded: (e.reminded || []).includes(i) });
        }
      });
    }
    return out.sort((a, b) => a.due.localeCompare(b.due));
  }

  async function markReminded(msgId, i) {
    const st = await load();
    const e = st[msgId];
    if (!e) return;
    e.reminded = [...new Set([...(e.reminded || []), i])];
    save();
  }

  // Überblick-Fenster: rechnet hier (läuft weiter, wenn das Popup zugeht, und doppelt nichts mit der Warteschlange)
  messenger.runtime.onConnect.addListener(port => {
    if (port.name !== "nbx-prep" || port.sender?.id !== messenger.runtime.id) return;
    const controller = new AbortController();
    port.onDisconnect.addListener(() => controller.abort());
    port.onMessage.addListener(async msg => {
      if (msg?.type !== "overview") return;
      try {
        const c = await config();
        const res = await overview(c, String(msg.uiLang || uiLang()), { hours: Number(msg.hours) || 24, unreadOnly: msg.unreadOnly !== false, max: Number(msg.max) || 40 },
          (done, total) => port.postMessage({ type: "progress", done, total }), controller.signal);
        port.postMessage({ type: "result", res });
      } catch (e) {
        if (e.name !== "AbortError") port.postMessage({ type: "error", error: String(e.message || e) });
      }
    });
  });
  // Fristen (Überblick, Popup): Liste und „erinnert“ merken. Kein async-Listener: andere Nachrichten bleiben unbeantwortet.
  messenger.runtime.onMessage.addListener((msg, sender) => {
    if (sender?.id !== messenger.runtime.id) return undefined;
    if (msg?.type === "nbx-deadlines") return deadlines(Number(msg.days) || 7);
    // Mails von Hand vorbereiten (wie beim Eintreffen; auch für Tests, ohne Fenster meldet Thunderbird keine neuen Mails)
    if (msg?.type === "nbx-prepare" && Array.isArray(msg.ids)) {
      msg.ids.filter(Number.isInteger).slice(0, 200).forEach(id => enqueue(id));
      return Promise.resolve(true);
    }
    if (msg?.type === "nbx-reminded" && typeof msg.msgId === "string" && Number.isInteger(msg.i)) return markReminded(msg.msgId, msg.i);
    return undefined;
  });

  const reminded = async msgId => (await load())[msgId]?.reminded || [];

  globalThis.nbPrep = { source, lookup, remember, digestFor, overview, deadlines, reminded, sumVariant, ready, PENDING };
})();
