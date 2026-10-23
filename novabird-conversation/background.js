/* NovaBird-Conversation – Hintergrundskript: findet die Konversation und beantwortet das Anzeigeskript im Lesebereich. */
"use strict";

const MAX_CANDIDATES = 150;
const MAX_MESSAGES = 120;

const STRING_KEYS = [
  "messagesCount", "toNames", "newBadge", "reply", "replyAll", "more", "forward", "forwardAsAttachment",
  "editAsNew", "expandAll", "collapseAll", "showFull", "showLess", "quoteToggle", "remoteBlocked", "remoteShow", "remoteThis", "remoteAll", "remoteCancel", "remoteAsk", "remoteSender",
  "aiSummary", "attOpen", "attSave", "noText", "loading", "loadFailed", "history", "notDownloaded", "delete", "deleteTip", "originalBtn", "originalTip", "backToConversation", "spam", "spamTip", "notSpam", "notSpamTip", "copyAddress",
];

let settings = sanitizeSettings(null);
const themeCache = new Map(); // tabId → { at, colors } (Hauptfenster können verschiedene Themes/Modi haben)
const headerCache = new Map(); // Nachrichten-ID → { mid, refs }
const convCache = new Map();   // Nachrichten-ID → { at, messages } (jedes Mitglied zeigt auf dieselbe Liste)
const bodyCache = new Map();   // Nachrichten-ID → Promise<Body> (zuletzt benutzte zuerst entfernt)
const idCache = new Map();     // Index-Schlüssel (Message-ID + Ordner) → WebExtension-Nachrichten-ID
const CONV_TTL = 60000;
const NOVABIRD_DB_ID = "novabird-db@novabird";
const DB_TIMEOUT_MS = 300;
const DB_PAUSES = [30000, 120000, 600000]; // Pausen nach Fehlern: 30 s, 2 min, 10 min
const dbState = { usable: null, retryAt: 0, pauseUntil: 0, failures: 0 };
const glodaState = { pauseUntil: 0, failures: 0 };
const BODY_CACHE_MAX = 40;
const EXTENSION_ID = "novabird-extension@novabird";
const aiState = { at: 0, available: false };

// KI-Zusammenfassung gibt es nur, wenn die NovaBird-Extension installiert ist und die KI dort eingerichtet wurde (Opt-in).
async function aiAvailable() {
  if (Date.now() - aiState.at < 30000) return aiState.available;
  let available = false;
  try {
    const res = await withTimeout(messenger.runtime.sendMessage(EXTENSION_ID, { type: "aiAvailable" }), 400);
    available = res?.available === true;
  } catch (e) {
    // Extension fehlt oder ist zu alt: kein Knopf
  }
  aiState.at = Date.now();
  aiState.available = available;
  return available;
}

function clearCaches() {
  convCache.clear();
  bodyCache.clear();
  idCache.clear();
}

function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

// Ordner-Kennung im Format des NovaBird-DB: <accountId>:<Pfad>, z. B. account1:/INBOX
// gleiches Format wie NovaBird-DB (src/indexer/record.js): folder.id, sonst <Konto>:/<Pfad> (Pfad beginnt selbst mit "/")
const folderIdOf = folder => (folder ? (folder.id ?? `${folder.accountId}:/${folder.path}`) : undefined);

// "/Pfad" aus dem Rest der Ordner-ID ("//Pfad" bei <Konto>:/<Pfad> mit führendem Schrägstrich)
const folderPathOf = rest => (rest.startsWith("//") ? rest.slice(1) : rest);

// Schlüssel "Message-ID\u0001folderId" (Index) oder Zahl (Betterbird-Suche) → WebExtension-ID
async function resolveId(key) {
  if (typeof key === "number") return key;
  if (idCache.has(key)) return idCache.get(key);
  const parts = splitKey(key);
  if (!parts) throw new Error(i18n("loadFailed"));
  // schnell: über die lokale Ordnerdatenbank (Experiment); langsam: messages.query über alle Ordner
  const at = parts.folderId.indexOf(":");
  if (at > 0) {
    try {
      const id = await messenger.conversationView.getMessageId(parts.headerMessageId, parts.folderId.slice(0, at), folderPathOf(parts.folderId.slice(at + 1)));
      if (typeof id === "number") {
        idCache.set(key, id);
        return id;
      }
    } catch (e) {
      // dann der langsamere Weg
    }
  }
  const list = await queryAll({ headerMessageId: parts.headerMessageId });
  const pick = list.find(m => folderIdOf(m.folder) === parts.folderId)
    ?? list.find(m => !["trash", "junk"].includes(m.folder?.type)) ?? list[0];
  if (!pick) throw new Error(i18n("loadFailed"));
  idCache.set(key, pick.id);
  return pick.id;
}

const i18n = (key, ...subs) => messenger.i18n.getMessage(key, subs);

async function loadSettings() {
  const { settings: stored } = await messenger.storage.local.get("settings");
  settings = sanitizeSettings(stored);
}

async function queryAll(info) {
  let list = await messenger.messages.query(info);
  const out = [...list.messages];
  while (list.id && out.length < MAX_CANDIDATES) {
    list = await messenger.messages.continueList(list.id);
    out.push(...list.messages);
  }
  return out;
}

// References kommen aus der lokalen Ordnerdatenbank (Experiment), nie per Netzwerk.
async function referencesFor(messages) {
  const missing = messages.filter(m => !headerCache.has(m.id)).map(m => m.id);
  if (missing.length) {
    let refs = {};
    try {
      refs = await messenger.conversationView.getReferences(missing);
    } catch (e) {
      console.error("NovaBird-Conversation: References", e);
    }
    for (const m of messages) {
      if (!headerCache.has(m.id)) headerCache.set(m.id, { mid: m.headerMessageId, refs: parseIds((refs[m.id] ?? []).map(r => `<${r}>`)) });
    }
    while (headerCache.size > 5000) headerCache.delete(headerCache.keys().next().value);
  }
  return messages.map(m => headerCache.get(m.id));
}

function personName(raw) {
  const text = String(raw ?? "");
  const m = text.match(/^\s*"?([^"<]*?)"?\s*<([^>]*)>\s*$/);
  return (m ? m[1].trim() || m[2] : text).trim();
}

function emailOf(raw) {
  const m = String(raw ?? "").match(/<([^>]+)>/);
  return (m ? m[1] : String(raw ?? "")).trim().toLowerCase();
}

function toView(message, folderName, local) {
  return {
    id: message.id,
    author: personName(message.author),
    email: emailOf(message.author),
    recipients: (message.recipients ?? []).map(personName),
    date: message.date instanceof Date ? message.date.getTime() : Number(message.date) || 0,
    read: !!message.read,
    subject: message.subject ?? "",
    folder: folderName,
    local,
    mine: message.folder?.type === "sent",
    folderType: message.folder?.type ?? "",
  };
}

async function findConversation(target, timing = {}) {
  let t = Date.now();
  const lap = name => { const n = Date.now(); timing[name] = n - t; t = n; };
  const key = normalizeSubject(target.subject);
  let found = key ? await queryAll({ subject: target.subject.replace(SUBJECT_PREFIX_RE, "") }) : [];
  if (!found.some(m => m.id === target.id)) found = [target, ...found];
  found = found.slice(0, MAX_CANDIDATES).filter(m => m.id === target.id || normalizeSubject(m.subject) === key);

  lap("query");
  const heads = await referencesFor(found);
  lap("refs");
  const candidates = found.map((m, k) => ({
    id: m.id,
    mid: heads[k].mid || `id-${m.id}`,
    refs: heads[k].refs,
    subjectKey: key,
    date: m.date instanceof Date ? m.date.getTime() : Number(m.date) || 0,
    folderType: m.folder?.type,
    people: [...addressesOf([m.author, ...(m.recipients ?? []), ...(m.ccList ?? [])])],
    message: m,
  }));
  const group = groupConversation(target.id, candidates, { fallback: settings.fallback, fallbackDays: settings.fallbackDays, fallbackPeople: settings.fallbackPeople })
    .slice(-MAX_MESSAGES);
  lap("group");
  let offline = {};
  try {
    offline = await messenger.conversationView.getOfflineState(group.map(c => c.id));
  } catch (e) {
    console.error("NovaBird-Conversation: Offline-Status", e);
  }
  lap("offline");
  return group.map(c => toView(c.message, c.message.folder?.name ?? "", offline[c.id] !== false));
}

// NovaBird-DB-Index (Rückfall: null → Betterbird-Suche). Die Anfrage selbst ist die Prüfung: scheitert sie, pausiert die Nutzung (30 s, 2 min, 10 min).
function dbFailed(timing, why) {
  dbState.pauseUntil = Date.now() + DB_PAUSES[Math.min(dbState.failures, DB_PAUSES.length - 1)];
  dbState.failures++;
  timing.db = why;
  return null;
}

async function findViaDb(target, timing) {
  if (!["auto", "db"].includes(settings.engine)) return null;
  const now = Date.now();
  if (now < dbState.pauseUntil || (dbState.usable === false && now < dbState.retryAt)) {
    timing.db = "pause";
    return null;
  }
  const t0 = Date.now();
  let res;
  try {
    res = await withTimeout(messenger.runtime.sendMessage(NOVABIRD_DB_ID, {
      type: "conversation",
      headerMessageId: target.headerMessageId,
      folderId: folderIdOf(target.folder),
      fallback: settings.fallback,
      fallbackDays: settings.fallbackDays,
      fallbackPeople: settings.fallbackPeople,
      limit: settings.limit,
    }), DB_TIMEOUT_MS);
  } catch (e) {
    return dbFailed(timing, String(e?.message ?? e).slice(0, 60));
  }
  timing.dbMs = Date.now() - t0;
  if (res?.ok === false && res.usable === false) {
    dbState.usable = false;
    dbState.retryAt = Date.now() + 60000;
    timing.db = "nicht bereit";
    return null;
  }
  if (!res?.ok || !Array.isArray(res.messages)) return dbFailed(timing, res?.error ?? "Fehler");
  dbState.usable = true;
  dbState.failures = 0;
  const rows = dedupeRows(res.messages, target.headerMessageId, folderIdOf(target.folder));
  const own = rows.find(r => r.headerMessageId === target.headerMessageId && r.folderId === folderIdOf(target.folder))
    ?? rows.find(r => r.headerMessageId === target.headerMessageId);
  const views = rows.map(rowToView);
  if (!own) {
    if (res.truncated && rows.length) {
      // Der Index hat nur die neuesten `limit` geliefert; die gewählte (ältere) Nachricht kommt immer dazu
      views.push({
        id: target.id,
        author: personName(target.author),
        email: emailOf(target.author),
        recipients: (target.recipients ?? []).map(personName),
        date: target.date instanceof Date ? target.date.getTime() : Number(target.date) || 0,
        read: !!target.read,
        subject: target.subject ?? "",
        folder: target.folder?.name ?? "",
        local: true,
        folderType: target.folder?.type ?? "",
        snippet: "",
      });
      timing.source = "db";
      return { messages: views, selectedKey: target.id, truncated: true };
    }
    timing.db = "Nachricht nicht im Index"; // Index hinkt hinterher → Betterbird-Suche
    return null;
  }
  timing.source = "db";
  return { messages: views, selectedKey: rowKey(own), truncated: !!res.truncated };
}

// Gloda (Betterbirds eigener Index, wie im Original): Zwischenstufe zwischen NovaBird-DB und Suche.
// Kennt Gloda die Nachricht nicht, oder antwortet es nicht rechtzeitig, geht es weiter mit der Suche (bei Fehlern mit Pause).
async function findViaGloda(target, timing) {
  if (!["auto", "gloda"].includes(settings.engine)) return null;
  if (Date.now() < glodaState.pauseUntil) {
    timing.gloda = "pause";
    return null;
  }
  const t0 = Date.now();
  let list;
  try {
    list = await withTimeout(messenger.conversationView.getGlodaConversation(target.id), 1200);
  } catch (e) {
    list = null;
  }
  timing.glodaMs = Date.now() - t0;
  if (list === null) {
    glodaState.pauseUntil = Date.now() + DB_PAUSES[Math.min(glodaState.failures, DB_PAUSES.length - 1)];
    glodaState.failures++;
    timing.gloda = "keine Antwort";
    return null;
  }
  glodaState.failures = 0;
  if (!list.length) {
    timing.gloda = "unbekannt";
    return null;
  }
  const snippets = new Map(list.map(x => [x.id, x.snippet]));
  const ids = [...new Set([target.id, ...list.map(x => x.id)])];
  const headers = (await Promise.all(ids.map(id => (id === target.id ? target : messenger.messages.get(id).catch(() => null))))).filter(Boolean);
  const items = headers.map(m => ({ id: m.id, mid: m.headerMessageId || `id-${m.id}`, folderType: m.folder?.type, message: m }));
  const visible = items.filter(x => x.id === target.id || !SKIP_FOLDER_TYPES.includes(x.folderType)); // Papierkorb/Spam wie bei den anderen Quellen ausblenden
  const unique = dedupeByMid(visible, target.id).sort((a, b) => dateOf(a.message) - dateOf(b.message)).slice(-MAX_MESSAGES);
  let offline = {};
  try {
    offline = await messenger.conversationView.getOfflineState(unique.map(x => x.id));
  } catch (e) {
    // ohne Offline-Angabe weiter
  }
  timing.source = "gloda";
  return {
    messages: unique.map(x => ({ ...toView(x.message, x.message.folder?.name ?? "", offline[x.id] !== false), snippet: snippets.get(x.id) || undefined })),
    selectedKey: target.id,
  };
}

const dateOf = m => (m.date instanceof Date ? m.date.getTime() : Number(m.date) || 0);

// Wie normalizeSubject, aber ohne Kleinschreibung – für die Suche per Teilstring
const SUBJECT_PREFIX_RE = /^\s*(?:(?:re|aw|antw|wg|fw|fwd|sv|vs|tr|rv)(?:\[\d+\])?\s*:\s*)+/i;

function collectParts(part, acc) {
  if (!part) return acc;
  const type = (part.contentType ?? "").toLowerCase();
  if (!part.name && part.body != null) {
    if (type === "text/html" && acc.html == null) acc.html = part.body;
    else if (type === "text/plain" && acc.text == null) acc.text = part.body;
  }
  for (const sub of part.parts ?? []) collectParts(sub, acc);
  return acc;
}

// Eingebettetes (cid:) Bild als data:-URL (nur gängige Bildtypen, kein SVG)
async function loadCidImage(key, partName) {
  const id = await resolveId(key);
  const file = await messenger.messages.getAttachmentFile(id, partName);
  if (!file || !/^image\/(png|jpe?g|gif|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) return null;
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : null);
    reader.onerror = () => resolve(null);
    reader.readAsDataURL(file);
  });
}

function loadBody(id) {
  let entry = bodyCache.get(id);
  if (entry) {
    bodyCache.delete(id);
  } else {
    entry = fetchBody(id);
    entry.catch(() => bodyCache.delete(id));
  }
  bodyCache.set(id, entry);
  while (bodyCache.size > BODY_CACHE_MAX) bodyCache.delete(bodyCache.keys().next().value);
  return entry;
}

async function fetchBody(key) {
  const id = await resolveId(key);
  const full = await messenger.messages.getFull(id);
  const { html, text } = collectParts(full, {});
  let attachments = [];
  try {
    // Bilder, auf die der HTML-Text per cid: verweist, zeigt die Ansicht im Text (nicht als Anhang-Chip)
    const referenced = new Set([...String(html ?? "").matchAll(/cid:([^"'\s>)]+)/gi)].map(m => { try { return decodeURIComponent(m[1]).toLowerCase(); } catch (e) { return m[1].toLowerCase(); } }));
    attachments = (await messenger.messages.listAttachments(id)).map(a => {
      const cid = String(a.contentId ?? "").replace(/^<|>$/g, "").toLowerCase();
      const inline = !!cid && referenced.has(cid) && /^image\/(png|jpe?g|gif|webp)$/i.test(a.contentType ?? "") && (a.size ?? 0) <= 5 * 1024 * 1024;
      return { name: a.name, partName: a.partName, size: a.size, contentType: a.contentType, cid: inline ? cid : undefined, inline };
    });
  } catch (e) {
    // ohne Anhangsliste weiter
  }
  return { html: html ?? null, text: text ?? null, attachments };
}

// Konversation einer Nachricht suchen (mit Zwischenspeicher); laufende Suchen werden geteilt, damit das Vorabholen und `hello` nicht doppelt rechnen
const lookups = new Map(); // Nachrichten-ID → Promise<entry>
async function lookup(shown, timing = {}) {
  let entry = convCache.get(shown.id);
  if (entry && Date.now() - entry.at < CONV_TTL) {
    timing.cached = true;
    return entry;
  }
  let pending = lookups.get(shown.id);
  if (!pending) {
    pending = (async () => {
      const viaIndex = (await findViaDb(shown, timing)) ?? (await findViaGloda(shown, timing));
      let e;
      if (viaIndex) {
        e = { at: Date.now(), messages: viaIndex.messages, selectedKey: viaIndex.selectedKey };
        idCache.set(viaIndex.selectedKey, shown.id); // die gewählte Nachricht kennen wir schon
        for (const m of viaIndex.messages) convCache.set(m.id, e);
      } else {
        const messages = await findConversation(shown, timing);
        timing.source = "query";
        e = { at: Date.now(), messages, selectedKey: shown.id };
        for (const m of messages) convCache.set(m.id, e);
      }
      convCache.set(shown.id, e);
      return e;
    })().finally(() => lookups.delete(shown.id));
    lookups.set(shown.id, pending);
  } else {
    timing.shared = true;
  }
  return pending;
}

// Schon beim Anzeigen der Nachricht mit der Suche beginnen (noch bevor das Anzeigeskript im Dokument läuft): auf langsamen Rechnern
// ist die Konversation dann fertig, wenn `hello` kommt.
messenger.messageDisplay.onMessageDisplayed.addListener((tab, message) => {
  if (message?.id != null) lookup(message).catch(() => {});
});

async function hello(tabId) {
  const tStart = Date.now();
  // Thunderbird wartet hier auf „MsgLoaded“ des Lesebereichs; unter 158 kam das im Test nicht, und die Ansicht blieb beim
  // Hinweis „wird gesucht“ stehen. Daher höchstens 400 ms warten, sonst die Nachricht direkt aus dem Lesebereich lesen.
  let shown = await Promise.race([
    messenger.messageDisplay.getDisplayedMessage(tabId).catch(() => null),
    new Promise(resolve => setTimeout(() => resolve(null), 400)),
  ]);
  if (!shown) {
    // zugeklappter Faden: mehrere Nachrichten ausgewählt, der Lesebereich zeigt aber genau eine
    shown = await messenger.conversationView.getDisplayedMessage(tabId).catch(() => null);
  }
  if (!shown) return null;
  const timing = { shownMs: Date.now() - tStart };
  const entry = await lookup(shown, timing);
  const { messages, selectedKey } = entry;
  timing.candidates = messages.length;
  if (messages.length < 2 && !settings.alwaysRender) return null;
  const strings = {};
  for (const key of STRING_KEYS) strings[key] = i18n(key);
  strings.messagesCountTemplate = i18n("messagesCount", "%N%");
  strings.toNamesTemplate = i18n("toNames", "%NAMES%");
  let theme = null;
  const tTheme = Date.now();
  const cachedTheme = themeCache.get(tabId);
  if (cachedTheme && Date.now() - cachedTheme.at < 60000) {
    theme = cachedTheme.colors;
  } else {
    try {
      theme = await messenger.conversationView.getThemeColors(tabId);
      themeCache.set(tabId, { at: Date.now(), colors: theme });
    } catch (e) {
      // ohne Theme-Farben weiter
    }
  }
  timing.themeMs = Date.now() - tTheme;
  let allowedSenders = [];
  try {
    allowedSenders = await messenger.conversationView.getAllowedSenders([...new Set(messages.map(m => m.email).filter(Boolean))].slice(0, 100));
  } catch (e) {
    // ohne Berechtigungsprüfung weiter (Bilder bleiben dann blockiert)
  }
  const expanded = [...pickExpanded(messages, settings.expand)];
  // Texte der Nachrichten, die sofort sichtbar sind, schon jetzt laden (die Ansicht fragt danach denselben Zwischenspeicher)
  const sorted = messages.slice().sort((a, b) => a.date - b.date);
  // erst nach der Antwort starten: die Zuordnung (messages.query) blockiert den Hauptthread und würde sonst die Antwort verzögern
  const prefetch = [sorted[sorted.length - 1], sorted[sorted.length - 2], messages.find(x => x.id === selectedKey)];
  setTimeout(() => {
    for (const m of prefetch) if (m) loadBody(m.id).catch(() => {});
  }, 0);
  if (settings.debugTiming) console.info("NovaBird-Conversation: Zeiten (ms)", JSON.stringify(timing));
  const ai = await aiAvailable();
  return {
    ai,
    settings,
    timing,
    theme,
    allowedSenders,
    strings,
    lang: messenger.i18n.getUILanguage(),
    selectedId: selectedKey,
    subject: shown.subject ?? "",
    messages,
    expanded,
  };
}

// Standardkopf aus-/einblenden: nicht vor der Antwort abwarten (Betterbird lädt gleichzeitig die normale Nachricht, der Aufruf dauert dann 150–300 ms).
// Je Tab läuft höchstens ein Aufruf; zählt immer der zuletzt gewünschte Zustand.
const headerWanted = new Map();  // tabId → gewünschter Zustand
const headerApplied = new Map(); // tabId → zuletzt gesetzter Zustand
const headerBusy = new Set();

async function scheduleHeader(tabId, hidden) {
  headerWanted.set(tabId, hidden);
  if (headerBusy.has(tabId)) return;
  headerBusy.add(tabId);
  try {
    while (headerApplied.get(tabId) !== headerWanted.get(tabId)) {
      const want = headerWanted.get(tabId);
      headerApplied.set(tabId, want);
      try {
        await messenger.conversationView.setHeaderHidden(tabId, want);
      } catch (e) {
        headerApplied.delete(tabId); // beim nächsten Mal erneut versuchen
        console.error("NovaBird-Conversation: Nachrichtenkopf", e);
        break;
      }
    }
  } finally {
    headerBusy.delete(tabId);
  }
}

function applyHeader(tabId, data) {
  scheduleHeader(tabId, !!data && settings.hideHeader);
  return data;
}

async function runAction(raw, tabId) {
  const msg = { ...raw, id: await resolveId(raw.id) };
  switch (msg.action) {
    case "reply": return messenger.compose.beginReply(msg.id, "replyToSender");
    case "replyAll": return messenger.compose.beginReply(msg.id, "replyToAll");
    case "forward": return messenger.compose.beginForward(msg.id, "forwardInline");
    case "forwardAsAttachment": return messenger.compose.beginForward(msg.id, "forwardAsAttachment");
    case "editAsNew": return messenger.compose.beginNew(msg.id);
    case "openAttachment": return messenger.messages.openAttachment(msg.id, msg.partName, tabId);
    case "saveAttachment": return messenger.conversationView.saveAttachment(msg.id, String(msg.partName), String(msg.name || "attachment"), String(msg.contentType || ""));
    // in den Papierkorb (je nach Kontoeinstellung), nie endgültig löschen
    case "delete": {
      const result = await messenger.messages.delete([msg.id]);
      clearCaches();
      return result;
    }
    // wie Betterbirds Spam-Knopf: markieren und in den Spam-Ordner des Kontos verschieben (bzw. zurück in den Posteingang)
    case "junk":
    case "notJunk": {
      const junk = msg.action === "junk";
      const info = await messenger.messages.get(msg.id);
      await messenger.messages.update(msg.id, { junk });
      const account = info.folder?.accountId ? await messenger.accounts.get(info.folder.accountId, true) : null;
      const find = (folders, type) => {
        for (const f of folders ?? []) {
          if (f.type === type) return f;
          const sub = find(f.subFolders, type);
          if (sub) return sub;
        }
        return null;
      };
      const target = account ? find(account.folders, junk ? "junk" : "inbox") : null;
      if (target && target.path !== info.folder.path && (junk ? info.folder.type !== "junk" : info.folder.type === "junk")) {
        await messenger.messages.move([msg.id], target);
      }
      clearCaches();
      return true;
    }
    default: return null;
  }
}

messenger.runtime.onMessage.addListener((msg, sender) => {
  const tabId = sender.tab?.id;
  switch (msg?.type) {
    case "hello":
      return tabId == null ? Promise.resolve(null)
        : hello(tabId).catch(e => { console.error("NovaBird-Conversation: Konversation", e); return null; }).then(data => applyHeader(tabId, data));
    case "summarize":
      // die Ansicht kennt Nachrichten über Schlüssel (Text), die Extension braucht die Zahlen-IDs von Thunderbird
      return Array.isArray(msg.ids) && msg.ids.length && msg.ids.length <= MAX_MESSAGES
        ? Promise.all(msg.ids.map(id => resolveId(id)))
          .then(ids => messenger.runtime.sendMessage(EXTENSION_ID, { type: "summarize", ids }))
          .then(() => true, e => { console.error("NovaBird-Conversation: Zusammenfassung", e); return false; })
        : Promise.resolve(false);
    case "body": return loadBody(msg.id);
    case "reveal": if (tabId != null) messenger.conversationView.reveal(tabId).catch(() => {}); return Promise.resolve(true);
    case "header": if (tabId != null) scheduleHeader(tabId, !!msg.hidden && settings.hideHeader); return Promise.resolve(true);
    case "copyText": return typeof msg.text === "string" ? messenger.conversationView.copyText(msg.text) : false;
    case "allowSender": return typeof msg.email === "string" ? messenger.conversationView.allowSender(msg.email) : false;
    case "cidImage": return typeof msg.partName === "string" ? loadCidImage(msg.id, msg.partName) : null;
    case "image": return typeof msg.url === "string" ? messenger.conversationView.fetchImage(msg.url) : null;
    case "action": return runAction(msg, tabId).then(() => true);
    default: return undefined;
  }
});

// Änderungen am Postfach: Zwischenspeicher verwerfen
for (const event of [messenger.messages.onUpdated, messenger.messages.onMoved, messenger.messages.onDeleted, messenger.messages.onCopied, messenger.messages.onNewMailReceived]) {
  event?.addListener(clearCaches);
}

// Statusmeldungen des NovaBird-DB (nur als Hinweis; bei Absturz kann er nichts melden – die Anfrage selbst bleibt die Prüfung)
messenger.runtime.onMessageExternal.addListener((msg, sender) => {
  if (sender?.id !== NOVABIRD_DB_ID || msg?.type !== "status") return;
  dbState.usable = !!msg.usable;
  if (msg.usable) {
    dbState.pauseUntil = 0;
    dbState.retryAt = 0;
    dbState.failures = 0;
  } else {
    dbState.retryAt = Date.now() + 60000;
  }
  clearCaches();
});

messenger.storage.onChanged.addListener(changes => {
  if (changes.settings) {
    settings = sanitizeSettings(changes.settings.newValue);
    themeCache.clear();
  }
});

async function registerScript() {
  await messenger.messageDisplayScripts.register({
    js: [{ file: "content/view.js" }],
    css: [{ file: "content/view.css" }],
  });
}

loadSettings().then(registerScript).then(() => messenger.conversationView.startThreadHook()).catch(e => console.error("NovaBird-Conversation: Start fehlgeschlagen", e));

// „Thunderbird Conversations“ ebenfalls aktiv? Dann einmal die Optionsseite mit Hinweis und Auswahl öffnen (nie ungefragt abschalten).
// Ist es nicht mehr aktiv, wird die Merke zurückgesetzt, damit der Hinweis bei erneutem Einschalten wieder kommt.
setTimeout(async () => {
  try {
    const other = await messenger.conversationView.getOtherConversations();
    const { otherConvAsked } = await messenger.storage.local.get("otherConvAsked");
    if (other?.active && !otherConvAsked) {
      await messenger.storage.local.set({ otherConvAsked: true });
      await messenger.runtime.openOptionsPage();
    } else if (!other?.active && otherConvAsked) {
      await messenger.storage.local.set({ otherConvAsked: false });
    }
  } catch (e) {
    console.error("NovaBird-Conversation: Prüfung auf Thunderbird Conversations", e);
  }
}, 5000);

// Selbsttest der Betterbird-Interna (shared/selftest-bg.js); Ergebnis zeigt die Optionsseite
nbStartSelfTest([() => messenger.conversationView.selfTest()]);
