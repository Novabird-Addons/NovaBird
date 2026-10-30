// Semantische Suche (Beta) in NovaBird-Search: findet Mails nach Bedeutung („Treffen der Eltern“ findet „Elternabend“).
// Läuft im Hintergrund des Add-ons (Modul, nach db/background.js geladen):
//  - Modell (models.js) wird erst auf Knopfdruck von Hugging Face geladen und geprüft (worker.js).
//  - Rechenweg: im Add-on (CPU, WASM-Threads, worker.js), im NovaBird Helper (nbhelper.exe, Grafikkarte über DirectML,
//    Native Messaging) oder auf einem eigenen Server (server.js: Ollama oder OpenAI-kompatibel). "auto": Helper, wenn er läuft
//    und dasselbe Modell bereit hat, sonst Add-on; Fehler im Helper -> Add-on. Den Server gibt es nur ausdrücklich.
//  - Jeder Weg muss zuerst die Probetexte (probe.js) passend zur Referenz rechnen; erst dann kommen seine Vektoren in den
//    Index. So mischen sich nie Vektoren aus verschiedenen Räumen (anderes Modell, andere Quantisierung).
//  - Indexieren: neueste Mails zuerst, nur im Leerlauf (Standard), fortsetzbar; Vektoren in store.js (Message-ID + Modell).
//  - Suche: Vektor der Anfrage gegen alle gespeicherten Vektoren; Treffer über der Schwelle (Strenge) ergänzen die Wortsuche
//    (background.js der Suchleiste) und werden dort als „ähnlich“ gezählt.
import { MODELS, DEFAULT_MODEL, modelBytes } from "./models.js";
import { PROBES, checkProbe } from "./probe.js";
import * as server from "./server.js";
import * as store from "./store.js";
import { textFromParts } from "../db/src/indexer/record.js";
import { cleanBody } from "../db/src/text/clean.js";

const KEY = "semantic";
const DEFAULTS = {
  enabled: false,
  model: DEFAULT_MODEL,
  path: "auto", // auto | addon | helper | server
  server: server.SERVER_DEFAULTS, // eigener Server (nur bei path "server")
  idleOnly: true, // Altbestand nur im Leerlauf rechnen
  threads: 0, // 0 = automatisch (halbe Kernzahl, höchstens 8)
  keep: "10min", // Modell im Speicher halten: 10min | always | search
  strictness: "medium", // low | medium | high
};
const KEEP_MS = { "10min": 10 * 60_000, always: Infinity, search: 30_000 };
// Kosinus-Schwelle je Strenge. Gemessen mit jina-de (Anfrage gegen Betreff + Text): passende Mails 0,33–0,61
// („Ferien am Meer“ → Mallorca-Buchung 0,33, „Treffen der Eltern“ → Elternabend 0,61), fremde höchstens 0,23.
const THRESHOLD = { low: 0.28, medium: 0.32, high: 0.4 };
const TEXT_CHARS = 1200; // Betreff + bereinigter Text, gekürzt (Modell: höchstens 512 Token)
const BATCH = 8; // Add-on (CPU dieses PCs)
const BATCH_REMOTE = 64; // Helper und Server: große Pakete (Helper sortiert nach Länge, rechnet Suchanfragen dazwischen)
const READ_PARALLEL = 6; // so viele Mails gleichzeitig lesen
const READ_AHEAD = 2; // so viele Pakete im Voraus lesen, während gerechnet wird
const IN_FLIGHT = 3; // Helper und Server: so viele Pakete gleichzeitig unterwegs (Grafikkarte und ggf. CPU des Helpers warten nicht)
const QUERY_LIMIT = 50;
const IDLE_SECONDS = 60;
const HELPER_HOST = "novabird_helper";
const HELPER_API = 1;
const SKIP_FOLDERS = "('trash','junk')";

const internal = () => globalThis.novabirdDbInternal;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let cfg = { ...DEFAULTS };
const model = () => MODELS[cfg.model] ?? MODELS[DEFAULT_MODEL];

// Zustand für die Einstellungsseite
const state = {
  phase: "off", // off | no-model | downloading | waiting-index | waiting-idle | indexing | paused | done | error
  done: 0,
  total: 0,
  rate: null, // Mails pro Sekunde (letzter Abschnitt)
  engine: null, // "addon" | "helper" | "server" (zuletzt gerechnet)
  error: null,
  download: null, // {done, total, file}
  modelStatus: null,
};

// ---- Worker (Add-on-Rechenweg) ------------------------------------------------------------------------------------------
let worker = null;
let seq = 0;
const pending = new Map();
let loadedModel = null;
let unloadTimer = null;

function startWorker() {
  if (worker) {
    return worker;
  }
  worker = new Worker(messenger.runtime.getURL("semantic/worker.js"), { type: "module" });
  worker.onmessage = ({ data }) => {
    if (data.type === "progress") {
      state.download = { done: data.done, total: data.total, file: data.file };
      return;
    }
    const p = pending.get(data.id);
    if (!p) {
      return;
    }
    pending.delete(data.id);
    data.ok ? p.resolve(data.result) : p.reject(new Error(data.error));
  };
  worker.onerror = e => {
    const err = new Error(`Worker: ${e.message || "Fehler"}`);
    for (const p of pending.values()) {
      p.reject(err);
    }
    pending.clear();
    worker = null;
    loadedModel = null;
  };
  return worker;
}

function call(type, data = {}) {
  const w = startWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    w.postMessage({ id, type, ...data });
  });
}

function unloadWorker() {
  clearTimeout(unloadTimer);
  unloadTimer = null;
  if (worker) {
    worker.terminate();
    worker = null;
  }
  for (const p of pending.values()) {
    p.reject(new Error("entladen"));
  }
  pending.clear();
  loadedModel = null;
  vectors = null; // Vektoren im Speicher mit freigeben
}

// Modell nach der Nutzung so lange behalten, wie eingestellt (Indexieren hält es ohnehin geladen)
function touch() {
  clearTimeout(unloadTimer);
  const ms = KEEP_MS[cfg.keep] ?? KEEP_MS["10min"];
  if (ms !== Infinity) {
    unloadTimer = setTimeout(() => {
      if (!indexing) {
        unloadWorker();
      }
    }, ms);
  }
}

const threadCount = () => Number(cfg.threads) || Math.max(1, Math.min(8, Math.floor((navigator.hardwareConcurrency || 4) / 2)));

async function ensureLoaded() {
  if (loadedModel === cfg.model && worker) {
    return;
  }
  const r = await call("load", { model: cfg.model, threads: threadCount(), wasmPaths: messenger.runtime.getURL("semantic/lib/") });
  loadedModel = cfg.model;
  state.loadMs = r.ms;
}

// ---- NovaBird Helper (Native Messaging) ---------------------------------------------------------------------------------
// Protokoll (JSON je Nachricht, Antwort mit derselben id):
//   {type:"hello", api, model:{id, repo, revision, files, dims, pooling}} -> {ok, version, api, device, deviceName, modelReady, mailsPerSec}
//   {type:"prepare", model:{…}}  -> lädt und prüft das Modell im Helper -> {ok, modelReady}
//   {type:"embed", model:"jina-de", ids:[[Token-IDs]…]} -> {ok, vectors: base64 (float32, n × dims)}
let helper = null; // {port, info, pending, seq}
let helperError = null;

async function helperAllowed() {
  try {
    return await messenger.permissions.contains({ permissions: ["nativeMessaging"] });
  } catch {
    return false;
  }
}

function helperRequest(msg, timeoutMs = 120_000) {
  const h = helper;
  if (!h) {
    return Promise.reject(new Error("Helper nicht verbunden"));
  }
  const id = ++h.seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      h.pending.delete(id);
      reject(new Error("Helper antwortet nicht"));
    }, timeoutMs);
    h.pending.set(id, { resolve, reject, timer });
    h.port.postMessage({ id, ...msg });
  });
}

const modelSpec = m => ({ id: m.id, repo: m.repo, revision: m.revision, files: m.files, dims: m.dims, pooling: m.pooling, maxTokens: m.maxTokens });

async function connectHelper() {
  if (helper) {
    return helper.info;
  }
  if (!(await helperAllowed())) {
    helperError = "keine Berechtigung";
    return null;
  }
  let port;
  try {
    port = messenger.runtime.connectNative(HELPER_HOST);
  } catch (e) {
    helperError = String(e?.message ?? e);
    return null;
  }
  const h = { port, info: null, pending: new Map(), seq: 0 };
  helper = h;
  port.onMessage.addListener(msg => {
    if (msg?.type === "progress") {
      state.download = { done: msg.done, total: msg.total, file: "Helper" };
      return;
    }
    const p = h.pending.get(msg?.id);
    if (!p) {
      return;
    }
    h.pending.delete(msg.id);
    clearTimeout(p.timer);
    msg.ok ? p.resolve(msg) : p.reject(new Error(msg.error || "Helper-Fehler"));
  });
  port.onDisconnect.addListener(p => {
    helperError = p?.error?.message || "Verbindung beendet";
    for (const x of h.pending.values()) {
      clearTimeout(x.timer);
      x.reject(new Error(helperError));
    }
    if (helper === h) {
      helper = null;
    }
  });
  try {
    h.info = await helperRequest({ type: "hello", api: HELPER_API, model: modelSpec(model()) }, 20_000);
    helperError = null;
    return h.info;
  } catch (e) {
    helperError = String(e?.message ?? e);
    try {
      port.disconnect();
    } catch {
      /* schon zu */
    }
    helper = null;
    return null;
  }
}

function disconnectHelper() {
  try {
    helper?.port.disconnect();
  } catch {
    /* schon zu */
  }
  helper = null;
}

function decodeVectors(b64, dims) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  const all = new Float32Array(bytes.buffer);
  const out = [];
  for (let i = 0; i < all.length; i += dims) {
    out.push(all.subarray(i, i + dims));
  }
  return out;
}

// ---- Probe der Rechenwege (probe.js) ----------------------------------------------------------------------------------------
// Ergebnis je Weg. Add-on und Helper sind feste Programme mit geprüftem Modell: Probe einmal am Tag und nach jedem Wechsel
// von Version oder Gerät. Ein Server kann jederzeit ein anderes Modell bekommen: Probe stündlich und nach jedem Fehler.
const CHECK_KEY = "semanticChecks";
const CHECK_TTL = { addon: 24 * 3600_000, helper: 24 * 3600_000, server: 3600_000 };
const checks = {}; // engine -> {key, ok, minCos, maxShift, reason, error, at, ms}
let checksLoaded = false;

class ProbeError extends Error {}
const CHECK_RETRY = 10 * 60_000; // nach einer nicht bestandenen Probe

const probeMessage = (engine, r) =>
  `Vektoren passen nicht zum Modell (${engine}: Übereinstimmung ${r.minCos}, Abweichung ${r.maxShift}${r.reason === "dims" ? ", andere Dimension" : ""})`;

function checkKey(engine) {
  const m = model();
  if (engine === "addon") {
    return `addon|${messenger.runtime.getManifest().version}|${m.id}|${m.revision}`;
  }
  if (engine === "helper") {
    return `helper|${helper?.info?.version}|${helper?.info?.device}|${m.id}|${m.revision}`;
  }
  const c = serverCfg();
  return `server|${c.type}|${server.base(c)}|${c.model}|${m.id}`;
}

async function verify(engine, rawEmbed, force = false) {
  const m = model();
  const probe = PROBES[m.id];
  if (!probe) {
    throw new ProbeError(`keine Probe für ${m.id}`);
  }
  if (!checksLoaded) {
    Object.assign(checks, (await messenger.storage.local.get({ [CHECK_KEY]: {} }))[CHECK_KEY]);
    delete checks.server; // den Server nach jedem Start neu prüfen
    checksLoaded = true;
  }
  const key = checkKey(engine);
  const have = checks[engine];
  if (!force && have?.key === key) {
    if (have.ok && Date.now() - have.at < CHECK_TTL[engine]) {
      return have;
    }
    if (!have.ok && have.reason !== "error" && Date.now() - have.at < CHECK_RETRY) {
      throw new ProbeError(probeMessage(engine, have)); // nicht bei jeder Anfrage neu proben
    }
  }
  const t0 = Date.now();
  let res;
  try {
    res = { ...checkProbe(m.id, await rawEmbed(probe.texts), m.dims), error: null };
  } catch (e) {
    res = { ok: false, minCos: 0, maxShift: 1, reason: "error", error: String(e?.message ?? e) };
  }
  checks[engine] = { ...res, key, at: Date.now(), ms: Date.now() - t0 };
  const { server: _server, ...persist } = checks;
  messenger.storage.local.set({ [CHECK_KEY]: persist }).catch(() => {});
  if (res.reason === "error") {
    throw new Error(res.error);
  }
  if (!res.ok) {
    throw new ProbeError(probeMessage(engine, res));
  }
  return checks[engine];
}

// ---- Eigener Server (server.js) ---------------------------------------------------------------------------------------------
const serverCfg = () => ({ ...server.SERVER_DEFAULTS, ...(cfg.server || {}), clientId });
let clientId = null; // Kennung dieses Thunderbird beim NovaBird Helper im Netz (zufällig, einmal erzeugt)

// prio "query": Suchanfrage (der Helper im Netz rechnet sie vor dem Indexieren anderer PCs)
function serverRaw(texts, prio = "query") {
  const m = model();
  return server.embed(serverCfg(), texts, m.maxTokens, { model: { id: m.id, revision: m.revision }, prio });
}

// Für die Einstellungsseite: was der Server über sich sagt (NovaBird Helper: Gerät, Modell; sonst die Modellliste)
async function serverInfo() {
  const c = serverCfg();
  if (c.type === "nbhelper") {
    const m = model();
    return { info: await server.netCall(c, "hello", { model: { id: m.id, revision: m.revision } }) };
  }
  return { models: await server.listModels(c) };
}

async function serverAllowed() {
  const url = server.base(serverCfg());
  if (!server.validUrl(url)) {
    return false;
  }
  try {
    return await messenger.permissions.contains({ origins: [server.originPattern(url)] });
  } catch {
    return false;
  }
}

// Ollama lehnt Anfragen mit dem Absender „moz-extension://…“ ab (403, OLLAMA_ORIGINS). Bei unseren Anfragen an den
// eingetragenen Server fällt der Origin-Kopf deshalb weg (webRequest wird zusammen mit der Adresse erfragt).
let originFilter = null;

function stripOrigin(details) {
  if (!(details.originUrl || details.documentUrl || "").startsWith(messenger.runtime.getURL(""))) {
    return {};
  }
  return { requestHeaders: details.requestHeaders.filter(h => h.name.toLowerCase() !== "origin") };
}

async function updateOriginFilter() {
  const wr = messenger.webRequest?.onBeforeSendHeaders;
  if (originFilter && wr) {
    wr.removeListener(stripOrigin);
  }
  originFilter = null;
  const url = server.base(serverCfg());
  if (!wr || cfg.path !== "server" || !(await serverAllowed())) {
    return;
  }
  try {
    wr.addListener(stripOrigin, { urls: [server.originPattern(url)] }, ["blocking", "requestHeaders"]);
    originFilter = url;
  } catch (e) {
    console.warn("[semantic] webRequest", e);
  }
}

async function serverEmbed(texts, prio) {
  if (!(await serverAllowed())) {
    throw new Error("keine Berechtigung für die Server-Adresse");
  }
  if (!originFilter) {
    await updateOriginFilter();
  }
  await verify("server", serverRaw);
  try {
    const vecs = await serverRaw(texts, prio);
    if (vecs.some(v => v.length !== model().dims)) {
      throw new ProbeError("andere Dimension");
    }
    return vecs;
  } catch (e) {
    delete checks.server; // nach jedem Fehler neu prüfen (Modell gewechselt, Server neu gestartet …)
    throw e;
  }
}

// ---- Vektoren berechnen: Server, Helper oder Add-on -------------------------------------------------------------------------
async function addonRaw(texts) {
  const m = model();
  await ensureLoaded();
  const flat = await call("embed", { model: m.id, texts });
  const out = [];
  for (let i = 0; i < flat.length; i += m.dims) {
    out.push(flat.subarray(i, i + m.dims));
  }
  return out;
}

async function helperRaw(texts) {
  const m = model();
  // Ab Helper 0.2 zerlegt der Helper die Texte selbst (das Add-on braucht dann kein Modell); ältere bekommen Token-IDs
  const res = helper?.info?.textApi
    ? await helperRequest({ type: "embedTexts", model: m.id, texts })
    : await helperRequest({ type: "embed", model: m.id, ids: await call("tokenize", { model: m.id, texts }) });
  state.onBattery = Boolean(res.onBattery);
  return decodeVectors(res.vectors, m.dims);
}

// Kann gerechnet werden? Das Modell im Add-on braucht nur der Add-on-Weg (und ein Helper vor 0.2, für die Token)
async function canCompute() {
  if (cfg.path === "server") {
    return true;
  }
  if (cfg.path === "helper" || cfg.path === "auto") {
    const info = await connectHelper();
    if (info?.modelReady && info.textApi) {
      return true;
    }
  }
  return modelComplete();
}

async function embedTexts(texts, prio = "index") {
  if (cfg.path === "server") {
    const vecs = await serverEmbed(texts, prio);
    state.engine = "server";
    return vecs;
  }
  if (cfg.path === "helper" || cfg.path === "auto") {
    const info = await connectHelper();
    if (info?.modelReady) {
      try {
        await verify("helper", helperRaw);
        const vecs = await helperRaw(texts);
        state.engine = "helper";
        return vecs;
      } catch (e) {
        helperError = String(e?.message ?? e);
        if (cfg.path === "helper") {
          throw e;
        }
        disconnectHelper(); // Rückfall auf das Add-on (CPU)
      }
    } else if (cfg.path === "helper") {
      throw new Error(`Helper nicht bereit${helperError ? `: ${helperError}` : ""}`);
    }
  }
  await verify("addon", addonRaw);
  const vecs = await addonRaw(texts);
  state.engine = "addon";
  return vecs;
}

// ---- Vektoren im Speicher (für die Suche) --------------------------------------------------------------------------------
let vectors = null; // {model, ids, q, s, extra: [{id, q, s}]}

async function memVectors() {
  const m = model();
  if (!vectors || vectors.model !== m.id) {
    vectors = { model: m.id, ...(await store.loadAll(m.id, m.dims)), extra: [] };
  }
  return vectors;
}

function scoreAll(mem, qv, dims, threshold) {
  const hits = [];
  const n = mem.ids.length;
  for (let i = 0; i < n; i++) {
    const base = i * dims;
    let dot = 0;
    for (let k = 0; k < dims; k++) {
      dot += mem.q[base + k] * qv[k];
    }
    dot *= mem.s[i];
    if (dot >= threshold) {
      hits.push([dot, mem.ids[i]]);
    }
  }
  for (const e of mem.extra) {
    let dot = 0;
    for (let k = 0; k < dims; k++) {
      dot += e.q[k] * qv[k];
    }
    dot *= e.s;
    if (dot >= threshold) {
      hits.push([dot, e.id]);
    }
  }
  hits.sort((a, b) => b[0] - a[0]);
  return hits;
}

// Suchtext für die Bedeutungssuche: Operatoren (von:, seit: …) und Anführungszeichen weg
function freeText(text) {
  return String(text ?? "")
    .split(/\s+/)
    .filter(w => w && !/^[\p{L}]+:/u.test(w) && !/^[-!]/.test(w))
    .join(" ")
    .replace(/["„“”]/g, "")
    .trim();
}

/**
 * Für die Suchleiste: Mails, die der Bedeutung nach passen. null = nicht verfügbar (aus, kein Modell, noch keine Vektoren).
 * Ergebnis: {rows:[{header_msg_id, folder_id, date, score}], ms}
 */
async function query(text, { includeTrash = false, folderId = null, limit = QUERY_LIMIT, threshold = null } = {}) {
  if (!cfg.enabled) {
    return null;
  }
  const q = freeText(text);
  if (q.length < 3) {
    return null;
  }
  const m = model();
  const t0 = Date.now();
  const mem = await memVectors();
  if (!mem.ids.length && !mem.extra.length) {
    return null;
  }
  const [qv] = await embedTexts([q], "query");
  touch();
  const hits = scoreAll(mem, qv, m.dims, threshold ?? THRESHOLD[cfg.strictness] ?? THRESHOLD.medium).slice(0, Math.max(limit * 3, limit));
  if (!hits.length) {
    return { rows: [], ms: Date.now() - t0 };
  }
  const score = new Map(hits.map(([s, id]) => [id, s]));
  const ids = [...score.keys()];
  const where = [`header_msg_id IN (${ids.map(() => "?").join(",")})`];
  const params = [...ids];
  if (!includeTrash) {
    where.push(`folder_type NOT IN ${SKIP_FOLDERS}`);
  }
  if (folderId) {
    where.push("folder_id = ?");
    params.push(folderId);
  }
  const rows = await internal().db.select(
    `SELECT header_msg_id, folder_id, date FROM messages WHERE ${where.join(" AND ")}`, params, ["header_msg_id", "folder_id", "date"]
  );
  const seen = new Set();
  const out = [];
  for (const r of rows.sort((a, b) => score.get(b.header_msg_id) - score.get(a.header_msg_id))) {
    if (seen.has(r.header_msg_id)) {
      continue;
    }
    seen.add(r.header_msg_id);
    out.push({ ...r, score: +score.get(r.header_msg_id).toFixed(3) });
    if (out.length >= limit) {
      break;
    }
  }
  return { rows: out, ms: Date.now() - t0 };
}

// ---- Indexieren (Altbestand und neue Mails) --------------------------------------------------------------------------------
let indexing = false;
let paused = false;
let doneIds = null; // Message-IDs mit Vektor (aktuelles Modell)
let offset = 0; // Position im Durchlauf (neueste zuerst)
let wake = null; // weckt die Schleife vorzeitig (Einstellung geändert, Fortsetzen)

const wait = ms => new Promise(r => {
  const t = setTimeout(r, ms);
  wake = () => {
    clearTimeout(t);
    r();
  };
});

async function isIdle() {
  try {
    return (await internal().idleSeconds()) >= IDLE_SECONDS;
  } catch {
    return true;
  }
}

async function countTotal() {
  const [r] = await internal().db.select(
    `SELECT COUNT(DISTINCT header_msg_id) AS n FROM messages WHERE folder_type NOT IN ${SKIP_FOLDERS}`, [], ["n"]
  );
  return Number(r?.n) || 0;
}

// Nächste Mails ohne Vektor (neueste zuerst). skip: schon unterwegs (im Voraus gelesen, noch nicht gespeichert)
async function nextBatch(have, size, skip) {
  const out = [];
  for (let guard = 0; guard < 200 && out.length < size; guard++) {
    const rows = await internal().db.select(
      `SELECT header_msg_id, folder_id, subject, author_name, date FROM messages WHERE folder_type NOT IN ${SKIP_FOLDERS}
       ORDER BY date DESC LIMIT 400 OFFSET ?`,
      [offset],
      ["header_msg_id", "folder_id", "subject", "author_name", "date"]
    );
    if (!rows.length) {
      offset = 0; // Durchlauf fertig; beim nächsten Mal von vorn (neue Mails)
      break;
    }
    for (const r of rows) {
      offset++;
      if (!have.has(r.header_msg_id) && !skip.has(r.header_msg_id) && !out.some(x => x.header_msg_id === r.header_msg_id)) {
        out.push(r);
        if (out.length >= size) {
          break;
        }
      }
    }
  }
  return out;
}

// Text einer Mail: Betreff + bereinigter Text. Liegt die Mail nicht lokal vor (IMAP ohne Offline-Kopie), nur der Betreff,
// sonst würde Thunderbird jede Mail einzeln vom Server laden.
async function textOf(row) {
  const head = `${row.subject || ""}\n`;
  try {
    let list = null;
    try {
      list = await messenger.messages.query({ headerMessageId: row.header_msg_id, folderId: row.folder_id });
    } catch {
      list = await messenger.messages.query({ headerMessageId: row.header_msg_id });
    }
    const msg = list?.messages?.[0];
    if (!msg) {
      return head;
    }
    const offline = await messenger.novabirdDb.offlineFlags([msg.id]).catch(() => null);
    if (offline && offline[msg.id] === false) {
      return head;
    }
    const body = cleanBody(textFromParts(await messenger.messages.getFull(msg.id)));
    return (head + body).slice(0, TEXT_CHARS);
  } catch {
    return head;
  }
}

// Text einer schon aufgelösten Mail ({id, offline}); nicht lokal: nur der Betreff (wie textOf)
async function bodyOf(row, ref) {
  const head = `${row.subject || ""}\n`;
  if (!ref.offline) {
    return head;
  }
  try {
    const body = cleanBody(textFromParts(await messenger.messages.getFull(ref.id)));
    return (head + body).slice(0, TEXT_CHARS);
  } catch {
    return head;
  }
}

async function modelComplete() {
  try {
    state.modelStatus = await call("status", { model: cfg.model });
    return state.modelStatus.complete;
  } catch (e) {
    state.error = String(e?.message ?? e);
    return false;
  }
}

// Rechnet ein anderes Programm (Helper, Server)? Dann größere Pakete und keine Leerlauf-Bremse: dieser PC liest nur die Texte.
const remoteEngine = () => cfg.path === "server" || (cfg.path !== "addon" && state.engine === "helper");

// Texte lesen: höchstens READ_PARALLEL gleichzeitig, über alle Pakete hinweg
let reading = 0;
const readWaiters = [];

async function limited(fn) {
  while (reading >= READ_PARALLEL) {
    await new Promise(r => readWaiters.push(r));
  }
  reading++;
  try {
    return await fn();
  } finally {
    reading--;
    readWaiters.shift()?.();
  }
}

// Mails eines Pakets auf einmal auflösen (novabirdDb.resolveMessages: Nachschlagen im Message-ID-Index statt
// messages.query je Mail, gemessen ~90 % der Lesezeit), dann die Texte parallel lesen. Nicht Gefundenes: alter Weg.
function readTexts(batch) {
  const p = (async () => {
    let refs = null;
    try {
      refs = await messenger.novabirdDb.resolveMessages(batch.map(r => ({ headerMessageId: r.header_msg_id, folderId: r.folder_id })));
    } catch {
      /* ältere Fassung der Schnittstelle: einzeln suchen */
    }
    return Promise.all(batch.map((r, i) => limited(() => (refs?.[i] ? bodyOf(r, refs[i]) : textOf(r)))));
  })();
  p.catch(() => {}); // Fehler beim Abholen
  return p;
}

let totalAt = 0; // Gesamtzahl nicht bei jedem Paket neu zählen (teuer bei vielen Mails)
const rateWindow = []; // [{from, at, n}] der letzten 30 s

async function indexLoop() {
  if (indexing) {
    return;
  }
  indexing = true;
  let ahead = []; // [{batch, texts: Promise}] im Voraus gelesen; die Leser arbeiten, während gerechnet wird
  let inflight = []; // [{batch, texts, sent, waitMs, result: Promise}] beim Rechenweg unterwegs (Reihenfolge = Speicherreihenfolge)
  let aheadFor = null; // Bestand, zu dem die vorgelesenen Pakete gehören (Leeren verwirft sie)
  let ids = null;
  const fillAhead = async size => {
    while (ahead.length < 1 + READ_AHEAD) {
      const busy = new Set([...ahead, ...inflight].flatMap(a => a.batch.map(r => r.header_msg_id)));
      const next = await nextBatch(ids, size, busy);
      if (!next.length) {
        return;
      }
      ahead.push({ batch: next, texts: readTexts(next) });
    }
  };
  try {
    while (cfg.enabled) {
      // Prüfungen nur, wenn nichts unterwegs ist: sonst gingen schon gerechnete Pakete verloren
      if (!inflight.length) {
        if (paused) {
          state.phase = "paused";
          await wait(60_000);
          continue;
        }
        if (!(await canCompute())) {
          state.phase = "no-model"; // Server und Helper (ab 0.2) brauchen kein Modell im Add-on
          break;
        }
        if (!(await internal().usable().catch(() => false))) {
          state.phase = "waiting-index"; // Wortindex baut sich noch auf
          await wait(60_000);
          continue;
        }
        if (!doneIds) {
          doneIds = await store.allIds(cfg.model);
        }
        ids = doneIds;
        if (aheadFor !== ids) {
          ahead = [];
          aheadFor = ids;
        }
        state.done = ids.size;
        if (Date.now() - totalAt > 30_000) {
          state.total = await countTotal();
          totalAt = Date.now();
        }
        state.total = Math.max(state.total, state.done);
        if (state.onBattery && state.engine === "helper") {
          // Akkubetrieb (meldet der Helper): Altbestand ruht; neue Suchen gehen weiter
          state.phase = "waiting-power";
          const fresh = await helperRequest({ type: "hello", api: HELPER_API, model: modelSpec(model()) }).catch(() => null);
          state.onBattery = Boolean(fresh?.onBattery);
          if (state.onBattery) {
            await wait(5 * 60_000);
            continue;
          }
        }
        if (cfg.idleOnly && !remoteEngine() && state.done > 0 && !(await isIdle())) {
          // Rechnet das Add-on selbst: die ersten Mails sofort, danach nur im Leerlauf
          state.phase = "waiting-idle";
          await wait(30_000);
          continue;
        }
      }
      // Wird der Bestand zurückgesetzt (Leeren, Modellwechsel, Import), gilt nichts mehr, was gelesen oder unterwegs ist
      if (doneIds !== ids) {
        ahead = [];
        inflight = [];
        aheadFor = null;
        continue;
      }
      // Helper und Server: große Pakete, zwei gleichzeitig unterwegs (der Rechenweg hat immer das nächste schon in der
      // Warteschlange, die Grafikkarte wartet nicht); das Add-on rechnet ein kleines Paket nach dem anderen.
      const remote = remoteEngine();
      const size = remote ? BATCH_REMOTE : BATCH;
      await fillAhead(size);
      while (inflight.length < (remote ? IN_FLIGHT : 1) && ahead.length) {
        const a = ahead.shift();
        const t0 = Date.now();
        const texts = await a.texts;
        const entry = { batch: a.batch, texts, sent: Date.now(), waitMs: Date.now() - t0 };
        entry.result = embedTexts(texts).then(vecs => ({ vecs }), error => ({ error }));
        inflight.push(entry);
        await fillAhead(size);
      }
      if (doneIds !== ids) {
        continue;
      }
      if (!inflight.length) {
        state.phase = "done";
        await wait(5 * 60_000); // später auf neue Mails prüfen
        continue;
      }
      state.phase = "indexing";
      const cur = inflight.shift();
      const res = await cur.result;
      if (doneIds !== ids) {
        continue;
      }
      if (res.error) {
        // dieses und die anderen unterwegs befindlichen Pakete nach der Pause noch einmal
        ahead = [cur, ...inflight].map(x => ({ batch: x.batch, texts: Promise.resolve(x.texts) })).concat(ahead);
        inflight = [];
        state.error = String(res.error?.message ?? res.error);
        state.phase = "error";
        await wait(60_000); // z. B. Helper oder Server kurz weg: nach einer Minute noch einmal
        continue;
      }
      const items = cur.batch.map((r, i) => ({ id: r.header_msg_id, vec: res.vecs[i], date: r.date }));
      await store.putMany(cfg.model, items);
      for (const it of items) {
        ids.add(it.id);
        if (vectors?.model === cfg.model) {
          vectors.extra.push({ id: it.id, ...store.quantize(it.vec) });
        }
      }
      state.done = ids.size;
      // Geschwindigkeit über die letzten 30 s; letztes Paket: Warten auf die Texte, Zeit bis zum Ergebnis
      const now = Date.now();
      rateWindow.push({ from: cur.sent, at: now, n: cur.batch.length });
      while (rateWindow.length > 1 && rateWindow[0].at < now - 30_000) {
        rateWindow.shift();
      }
      // zwischen fertigen Paketen messen (mit zwei Paketen unterwegs liegt das Absenden eine Paketdauer zu früh)
      const [first, ...rest] = rateWindow;
      state.rate = rest.length
        ? +(rest.reduce((sum, w) => sum + w.n, 0) / Math.max(0.001, (now - first.at) / 1000)).toFixed(1)
        : +(first.n / Math.max(0.001, (now - first.from) / 1000)).toFixed(1);
      state.timing = { waitMs: cur.waitMs, embedMs: now - cur.sent, batch: cur.batch.length };
      state.error = null;
      touch();
    }
  } catch (e) {
    state.error = String(e?.message ?? e);
    state.phase = "error";
  } finally {
    indexing = false;
    if (!cfg.enabled) {
      state.phase = "off";
    }
  }
}

function kick() {
  if (wake) {
    wake();
  }
  if (cfg.enabled) {
    indexLoop();
  }
}

// ---- Ordner-Sync über den Helper -------------------------------------------------------------------------------------------
// Eigene neue Vektoren (seit dem letzten Abgleich) gehen verschlüsselt in den Sync-Ordner, Pakete anderer PCs werden
// übernommen. Alle 15 Minuten, solange der Helper erreichbar und gekoppelt ist, und auf Knopfdruck.
const SYNC_KEY = "semanticSync";
const SYNC_EVERY = 15 * 60_000;
const PUSH_PART = 3 << 20; // Bytes je Nachricht an den Helper
let syncing = false;
const syncState = { at: null, pushed: 0, pulled: 0, error: null };

function toBase64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function syncNow() {
  if (syncing || !cfg.enabled) {
    return syncState;
  }
  syncing = true;
  try {
    const info = await connectHelper();
    if (!info?.sync?.configured) {
      return syncState;
    }
    const m = model();
    const { [SYNC_KEY]: st = {} } = await messenger.storage.local.get(SYNC_KEY);
    const since = Number(st[m.id]) || 0;
    const startedAt = Date.now();
    // eigene neue Vektoren
    const blob = await store.exportBlob(m.id, m, since);
    if (blob.count) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      const parts = Math.ceil(bytes.length / PUSH_PART);
      for (let i = 0; i < parts; i++) {
        await helperRequest({ type: "syncPush", model: m.id, revision: m.revision, part: i, parts, data: toBase64(bytes.subarray(i * PUSH_PART, (i + 1) * PUSH_PART)) });
      }
    }
    syncState.pushed = blob.count;
    // Pakete der anderen PCs
    let pulled = 0;
    const pend = await helperRequest({ type: "syncPending", model: m.id, revision: m.revision });
    for (const pkg of pend.packages || []) {
      const chunks = [];
      let offset = 0;
      let total = Infinity;
      while (offset < total) {
        const r = await helperRequest({ type: "syncRead", model: m.id, revision: m.revision, name: pkg.name, offset });
        const bin = atob(r.data);
        const chunk = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) {
          chunk[i] = bin.charCodeAt(i);
        }
        chunks.push(chunk);
        offset += chunk.length;
        total = r.total;
        if (!chunk.length) {
          break;
        }
      }
      const buf = await new Blob(chunks).arrayBuffer();
      pulled += await store.importBuffer(buf, m.id, m);
      await helperRequest({ type: "syncAck", name: pkg.name });
    }
    if (pulled) {
      doneIds = null;
      vectors = null;
    }
    await messenger.storage.local.set({ [SYNC_KEY]: { ...st, [m.id]: startedAt } });
    Object.assign(syncState, { at: Date.now(), pulled, error: null });
  } catch (e) {
    syncState.error = String(e?.message ?? e);
  } finally {
    syncing = false;
  }
  return syncState;
}

setInterval(() => {
  if (cfg.enabled && cfg.path !== "addon") {
    syncNow();
  }
}, SYNC_EVERY);

// ---- Einstellungen und Schnittstelle für die Einstellungsseite --------------------------------------------------------
async function loadConfig() {
  const s = await messenger.storage.local.get({ [KEY]: DEFAULTS });
  cfg = { ...DEFAULTS, ...s[KEY] };
  if (!MODELS[cfg.model]) {
    cfg.model = DEFAULT_MODEL;
  }
  if (!clientId) {
    ({ semanticClientId: clientId } = await messenger.storage.local.get({ semanticClientId: null }));
    if (!clientId) {
      clientId = [...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(16).padStart(2, "0")).join("");
      await messenger.storage.local.set({ semanticClientId: clientId });
    }
  }
}

messenger.storage.onChanged.addListener(async changes => {
  if (!changes[KEY]) {
    return;
  }
  const before = cfg;
  await loadConfig();
  if (before.model !== cfg.model) {
    doneIds = null;
    vectors = null;
    offset = 0;
  }
  if (before.threads !== cfg.threads || before.model !== cfg.model) {
    unloadWorker(); // beim nächsten Rechnen mit den neuen Werten laden
  }
  if (before.path !== cfg.path && (cfg.path === "addon" || cfg.path === "server")) {
    disconnectHelper();
  }
  if (before.path !== cfg.path || JSON.stringify(before.server) !== JSON.stringify(cfg.server)) {
    delete checks.server;
    await updateOriginFilter();
  }
  if (!cfg.enabled) {
    state.phase = "off";
    unloadWorker();
    disconnectHelper();
  }
  touch();
  kick();
});

async function status() {
  const m = model();
  if (!indexing && cfg.enabled) {
    await modelComplete();
  } else if (!state.modelStatus) {
    state.modelStatus = await call("status", { model: m.id }).catch(() => null);
  }
  return {
    cfg,
    model: { id: m.id, name: m.name, repo: m.repo, revision: m.revision, langs: m.langs, bytes: modelBytes(m), ramMB: m.ramMB, dims: m.dims },
    models: Object.values(MODELS).map(x => ({ id: x.id, name: x.name, repo: x.repo, langs: x.langs, bytes: modelBytes(x), ramMB: x.ramMB, recommended: Boolean(x.recommended) })),
    ...state,
    vectors: doneIds?.size ?? (await store.count(m.id)),
    loaded: loadedModel === m.id,
    threads: threadCount(),
    cores: navigator.hardwareConcurrency || null,
    helper: helper?.info ? { connected: true, ...helper.info } : { connected: false, error: helperError },
    server: { ...serverCfg(), key: "", code: "", clientId: undefined, hasKey: Boolean(serverCfg().key), hasCode: Boolean(serverCfg().code), local: server.isLocal(server.base(serverCfg())), allowed: await serverAllowed() },
    checks: Object.fromEntries(Object.entries(checks).map(([k, v]) => [k, { ok: v.ok, minCos: v.minCos, maxShift: v.maxShift, reason: v.reason, error: v.error, at: v.at, ms: v.ms }])),
    sync: { ...syncState, running: syncing },
    helperAllowed: await helperAllowed(),
  };
}

messenger.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== messenger.runtime.id || !String(msg?.type ?? "").startsWith("semantic:")) {
    return undefined;
  }
  const run = async () => {
    switch (msg.type) {
      case "semantic:status":
        return status();
      case "semantic:download":
        state.download = { done: 0, total: modelBytes(model()) };
        state.phase = "downloading";
        state.error = null;
        try {
          const { semanticTestBase } = await messenger.storage.local.get({ semanticTestBase: "" }); // nur Tests (localhost)
          state.modelStatus = await call("download", { model: cfg.model, testBase: semanticTestBase });
        } catch (e) {
          state.error = String(e?.message ?? e);
        }
        state.download = null;
        state.phase = cfg.enabled ? "waiting-index" : "off";
        kick();
        return status();
      case "semantic:cancelDownload":
        worker?.postMessage({ type: "cancel" });
        return { ok: true };
      case "semantic:removeModel":
        unloadWorker();
        state.modelStatus = await call("remove", { model: cfg.model });
        unloadWorker();
        return status();
      case "semantic:pause":
        paused = true;
        return status();
      case "semantic:resume":
        paused = false;
        kick();
        return status();
      case "semantic:clear":
        await store.clear(cfg.model);
        doneIds = null;
        vectors = null;
        offset = 0;
        state.done = 0;
        kick();
        return status();
      case "semantic:export":
        return store.exportBlob(cfg.model, model());
      case "semantic:import": {
        const n = await store.importBuffer(msg.buffer, cfg.model, model());
        doneIds = null;
        vectors = null;
        kick();
        return { imported: n };
      }
      case "semantic:helperConnect": {
        disconnectHelper();
        const info = await connectHelper();
        return { info, error: helperError };
      }
      case "semantic:helperPrepare": {
        await connectHelper();
        const res = await helperRequest({ type: "prepare", model: modelSpec(model()) }, 60 * 60_000);
        disconnectHelper();
        return { info: await connectHelper(), prepared: res };
      }
      case "semantic:syncSetup": {
        await connectHelper();
        const res = await helperRequest({ type: "syncSetup", folder: String(msg.folder || ""), code: msg.code ? String(msg.code) : null });
        disconnectHelper(); // Info (sync.configured) neu holen
        await connectHelper();
        syncNow();
        return { code: res.code || null };
      }
      case "semantic:syncLeave":
        await connectHelper();
        await helperRequest({ type: "syncLeave" });
        disconnectHelper();
        await connectHelper();
        return status();
      case "semantic:syncNow":
        return syncNow();
      case "semantic:serverCheck": {
        // Einstellungsseite: Server sofort prüfen (Probe), dazu seine Modelle bzw. Angaben des Helpers
        await updateOriginFilter();
        const about = await serverInfo().catch(e => ({ error: String(e?.message ?? e) }));
        await verify("server", serverRaw, true).catch(() => {}); // Ergebnis steht in checks.server
        kick();
        return { check: checks.server, ...about };
      }
      case "semantic:benchRead": {
        // Diagnose: wie schnell liest Thunderbird die Mailtexte? Zeiten je Schritt (nacheinander) und Durchsatz (parallel)
        const n = Math.max(10, Math.min(2000, Number(msg.n) || 200));
        const rows = await internal().db.select(
          `SELECT header_msg_id, folder_id, subject FROM messages WHERE folder_type NOT IN ${SKIP_FOLDERS} ORDER BY date DESC LIMIT ?`,
          [n], ["header_msg_id", "folder_id", "subject"]
        );
        const steps = { query: 0, offline: 0, getFull: 0, inlineParts: 0, clean: 0, resolveBatched: 0 };
        const seq = rows.slice(0, 40);
        const tr = performance.now();
        const refs = await messenger.novabirdDb.resolveMessages(seq.map(r => ({ headerMessageId: r.header_msg_id, folderId: r.folder_id })));
        steps.resolveBatched = performance.now() - tr; // ein Aufruf für alle; unten je Mail geteilt
        for (const r of seq) {
          let t = performance.now();
          const list = await messenger.messages.query({ headerMessageId: r.header_msg_id, folderId: r.folder_id });
          steps.query += performance.now() - t;
          const id = list?.messages?.[0]?.id;
          if (!id) {
            continue;
          }
          t = performance.now();
          await messenger.novabirdDb.offlineFlags([id]);
          steps.offline += performance.now() - t;
          t = performance.now();
          const full = await messenger.messages.getFull(id);
          steps.getFull += performance.now() - t;
          if (messenger.messages.listInlineTextParts) {
            t = performance.now();
            await messenger.messages.listInlineTextParts(id);
            steps.inlineParts += performance.now() - t;
          }
          t = performance.now();
          cleanBody(textFromParts(full));
          steps.clean += performance.now() - t;
        }
        for (const k of Object.keys(steps)) {
          steps[k] = +(steps[k] / seq.length).toFixed(1);
        }
        const t0 = performance.now();
        const fast = await readTexts(rows);
        const rate = +(rows.length / ((performance.now() - t0) / 1000)).toFixed(1);
        // gleiche Texte wie der alte Weg (messages.query je Mail)?
        const old = await Promise.all(rows.slice(0, 100).map(textOf));
        const same = old.filter((t, i) => t === fast[i]).length;
        return { mails: rows.length, sameAsOld: `${same}/${old.length}`, resolved: refs.filter(Boolean).length, of: seq.length, sampleFolderId: seq[0]?.folder_id, msPerMailSequential: steps, parallel: READ_PARALLEL, mailsPerSecParallel: rate };
      }
      case "semantic:try": {
        // Probe aus der Einstellungsseite: Treffer zu einem Suchtext (ohne Ordnerfilter)
        const res = await query(msg.text, { includeTrash: false, limit: 10, threshold: typeof msg.threshold === "number" ? msg.threshold : null });
        return res;
      }
      default:
        return { error: "unbekannt" };
    }
  };
  return run().catch(e => ({ error: String(e?.message ?? e) }));
});

// Für die Suchleiste (background.js, klassisches Skript im selben Fenster)
globalThis.novabirdSemantic = {
  enabled: () => cfg.enabled,
  query,
};

(async () => {
  await loadConfig();
  await updateOriginFilter();
  await internal()?.ready;
  if (cfg.enabled) {
    kick();
  }
})().catch(e => console.error("[semantic] Start", e));
