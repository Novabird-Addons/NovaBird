// NovaBird-DB Hintergrundskript.
// NovaBird-DB: Indexer, Suche, Wartung und Schnittstelle für andere Add-ons (z. B. NovaBird-Search).
import { createExperimentAdapter } from "./src/db/adapter.js";
import { migrate, resetTermsTables } from "./src/db/schema.js";
import * as repo from "./src/db/repository.js";
import { Indexer } from "./src/indexer/indexer.js";
import { search, clearCompoundCache } from "./src/search.js";
import { removeChip } from "./src/parser/chips.js";
import { TEXT_NORM_VERSION } from "./src/util/normalize.js";
import { CONV_DATA_VERSION } from "./src/db/schema.js";
import { findConversation } from "./src/query/conversation.js";
import { checkDue, brokenReason, quickCheckOk } from "./src/db/health.js";

const db = createExperimentAdapter(messenger.novabirdDb);
let caps = null;
let indexer = null;
let status = { phase: "starting" };
// Standard: alle Konten und Ordner. Einschränkung (nur für Tests) über storage.local: includeAccounts / includeFolders.
let includeAccounts = [];
let includeFolders = [];
// Zeiten (Millisekunden). Für Tests über storage.local `testTimings` überschreibbar.
const TIMING = {
  start: 10_000, // Indexaufbau erst nach dem Start von Betterbird (10 s)
  deepEarliest: 5 * 60_000, // Tiefenabgleich frühestens 5 Minuten nach dem Start ...
  deepForce: 30 * 60_000, // ... im Leerlauf, spätestens nach 30 Minuten (dann sanft, auch ohne Leerlauf)
  deepRetry: 60_000, // so oft wird auf Leerlauf geprüft
  idleNeeded: 60, // Sekunden ohne Eingabe, die als Leerlauf gelten
  check: 30_000, // Indexprüfung 30 s nach dem Start
};
const API_VERSION = 1; // Schnittstellenversion für andere Add-ons (ping)
let sessionStart = Date.now();
let brokenInfo = null; // { reason, detail } solange der Index unbrauchbar ist
const OVERLAY_MIN_MAILS = 500; // Fortschritts-Overlay erst ab dieser Größe des Laufs
let overlayAt = 0;
// Add-ons, die von außen fragen dürfen, und ihre erlaubten Befehle ("*" = alle)
const ALLOWED_EXTERNAL = {
  "novabird-search@novabird": "*",
  "novabird-conversation@novabird": ["ping", "conversation"],
};
const CONVERSATION_PILOTS = ["novabird-conversation@novabird"]; // Ziele des Status-Push
let lastPushedUsable = null; // zuletzt an NovaBird-Conversation gemeldeter Wert von "usable"
let allowedAccountIds = null; // aus includeAccounts abgeleitet
let lastCatchUp = null; // { at, checked, added } der letzten Nachholung
let initialDone = false; // Erstlauf einmal vollständig durchgelaufen (erst dann darf der NovaBird-Search den Index nutzen)
let startedAt = 0;
let lastProgress = { done: 0, total: null, folder: null }; // zuletzt gemeldeter Stand (auch nach Anhalten)
let lastLogged = 0;
let logSearches = true; // Suchprotokoll (nur lokal), Auswertung später für den Parser
const LOG_MAX = 2000;

// Zusammensetzungen: "query" = Wortlisten-Erweiterung bei der Suche (Standard), "index" = Zerlegung beim Indexieren (terms_de)
let compoundMode = "query";
// Sprachen des Parsers für Freitext („Rechnungen von Jonas letzte Woche“): Standard = Sprache der Oberfläche, einstellbar
const PARSER_LANGS = ["de", "en", "fr", "es"];
const uiLang = () => (messenger.i18n.getUILanguage() || "en").toLowerCase();
const defaultParserLangs = () => [PARSER_LANGS.find((l) => uiLang().startsWith(l)) ?? "en"];
let parserLangs = defaultParserLangs();
let termsVocab = null; // Set der Saatwörter (nur im Modus "index")
let seedPassRunning = false;

function sanitizeLangs(list) {
  const out = (Array.isArray(list) ? list : []).filter((l, i, a) => PARSER_LANGS.includes(l) && a.indexOf(l) === i);
  const ui = defaultParserLangs()[0];
  if (out.includes(ui)) out.sort((a, b) => (b === ui) - (a === ui)); // Hauptsprache (Wortstämme) = Sprache der Oberfläche
  return out.length ? out : null;
}

async function loadSettings() {
  const s = await messenger.storage.local.get({ includeFolders: null, includeAccounts, logSearches, compoundMode: "query", parserLangs: null });
  logSearches = s.logSearches;
  parserLangs = sanitizeLangs(s.parserLangs) ?? defaultParserLangs();
  compoundMode = s.compoundMode === "index" ? "index" : "query";
  includeAccounts = s.includeAccounts;
  // Ordnerfilter nur, wenn kein Konto gewählt ist (Standard: Konto-Filter)
  includeFolders = s.includeFolders ?? [];
  allowedAccountIds = null;
  if (includeAccounts.length) {
    const accounts = await messenger.accounts.list(false);
    allowedAccountIds = new Set(
      accounts
        .filter((a) => includeAccounts.some((n) => a.name === n || a.identities?.some((i) => i.email === n)))
        .map((a) => a.id),
    );
  }
}

function isExcluded(folder) {
  if (!folder) return false;
  if (allowedAccountIds && !allowedAccountIds.has(folder.accountId)) return true;
  if (includeFolders.length && !includeFolders.includes(folder.name)) return true;
  return false;
}

// Fortschritts-Overlay im Hauptfenster (nur Anzeige, siehe api/novabirdDbUi). Direkt aus dem Indexer gespeist, ohne Abfragen.
function updateOverlay(p) {
  const ui = messenger.novabirdDbUi;
  if (!ui) return;
  const big = (lastProgress.total ?? 0) > OVERLAY_MIN_MAILS;
  if (p.phase === "folder" && big) {
    const now = Date.now();
    if (now - overlayAt < 400) return; // höchstens ca. zweimal pro Sekunde zeichnen
    overlayAt = now;
    const { done, total, folder } = lastProgress;
    ui.showProgress({ done, total, percent: Math.min(100, Math.round((done / total) * 100)), folder: folder ?? undefined, paused: false }).catch(() => {});
  } else if (p.phase === "stopped" && big) {
    const { done, total, folder } = lastProgress;
    ui.showProgress({ done, total, percent: Math.min(100, Math.round((done / total) * 100)), folder: folder ?? undefined, paused: true }).catch(() => {});
  } else if (p.phase === "done" || p.phase === "error" || p.phase === "deleted") {
    ui.hideProgress().catch(() => {});
  }
}

// Ereignisprotokoll für die Einstellungsseite (nur im Speicher, letzte 400 Zeilen)
const events = [];
let eventSeq = 0;
function fmt(a) {
  return a instanceof Error ? `${a.message}${a.stack ? " @ " + String(a.stack).split("\n")[0] : ""}` : typeof a === "object" ? JSON.stringify(a) : String(a);
}
let saveTimer = null;
function pushEvent(level, args) {
  events.push({ n: ++eventSeq, t: Date.now(), level, msg: args.map(fmt).join(" ") });
  if (events.length > 400) events.shift();
  // dauerhaft sichern (gebündelt, alle 2 s), damit das Protokoll auch nach einem abgeschossenen Betterbird da ist
  if (!saveTimer) {
    saveTimer = setTimeout(() => {
      saveTimer = null;
      messenger.storage.local.set({ eventLog: events.slice(-400) }).catch(() => {});
    }, 2000);
  }
}
async function restoreEvents() {
  try {
    const { eventLog } = await messenger.storage.local.get({ eventLog: [] });
    if (eventLog.length) {
      events.push(...eventLog);
      eventSeq = Math.max(...eventLog.map((e) => e.n));
      pushEvent("info", ["── Neustart des NovaBird-DB (Zeilen davor: vorheriger Lauf) ──"]);
    }
  } catch {
    /* ohne Speicher einfach leer starten */
  }
}
const dlog = {
  info: (...a) => (console.info(...a), pushEvent("info", a)),
  warn: (...a) => (console.warn(...a), pushEvent("warn", a)),
  error: (...a) => (console.error(...a), pushEvent("error", a)),
};

/** Saatliste für die Zerlegung (terms_de): Wörter aus der eigenen Wortliste, die in mindestens 3 Mails vorkommen. */
async function buildSeed() {
  await db.execute("DELETE FROM terms_seed");
  await db.execute(
    "INSERT OR IGNORE INTO terms_seed(term) SELECT term FROM messages_vocab WHERE doc >= 3 AND length(term) >= 3 AND term NOT GLOB '*[0-9]*'",
  );
  const rows = await db.select("SELECT term FROM terms_seed", [], ["term"]);
  termsVocab = new Set(rows.map((r) => r.term));
  dlog.info(`[novabird-db] Saatliste für die Zerlegung: ${termsVocab.size} Wörter`);
}

/** Einstellung „Zusammensetzungen“ mit dem Zustand des Index abgleichen (beim Start). */
async function syncCompoundMode() {
  if (!caps?.termsFts) {
    termsVocab = null;
    return;
  }
  const row = await db.select("SELECT value FROM meta WHERE key = 'terms_mode'", [], ["value"]);
  const stored = row[0]?.value ?? "query";
  if (compoundMode === "index") {
    const seed = await db.select("SELECT term FROM terms_seed", [], ["term"]);
    termsVocab = seed.length ? new Set(seed.map((r) => r.term)) : null;
  } else {
    termsVocab = null;
    if (stored === "index") {
      await resetTermsTables(db, caps);
      await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('terms_mode', 'query')");
    }
  }
}

/** Nach einem vollständigen Lauf im Modus „Beim Indexieren“ ohne Saatliste: Saatliste aus dem frischen Index bauen und einmal neu einlesen. */
async function ensureSeedPass() {
  if (compoundMode !== "index" || !caps?.termsFts || seedPassRunning || (termsVocab?.size ?? 0) > 0) return false;
  if ((await repo.stats(db)).messages === 0) return false;
  seedPassRunning = true;
  try {
    await buildSeed();
    await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('terms_mode', 'index')");
    if (termsVocab.size === 0) return false;
    dlog.info("[novabird-db] Zusammensetzungen: Index wird mit der Zerlegung einmal neu eingelesen");
    await runIndex(true);
    return true;
  } finally {
    seedPassRunning = false;
  }
}

async function setCompoundMode(mode) {
  const next = mode === "index" ? "index" : "query";
  if (next === compoundMode) return { mode: compoundMode };
  if (next === "index" && !caps?.termsFts) return { error: "Nur mit FTS5 möglich" };
  await messenger.storage.local.set({ compoundMode: next });
  compoundMode = next;
  clearCompoundCache();
  if (next === "index") {
    termsVocab = null;
    if ((await repo.stats(db)).messages > 0) {
      await buildSeed();
      await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('terms_mode', 'index')");
      if (termsVocab.size) runIndex(true).catch((e) => dlog.error("[novabird-db] Neuaufbau", e)); // alle Mails neu einlesen, jetzt mit Zerlegung
    }
  } else {
    await syncCompoundMode();
  }
  dlog.info(`[novabird-db] Zusammensetzungen: Modus „${next === "index" ? "beim Indexieren" : "bei der Suche"}“`);
  return { mode: compoundMode };
}

/** Index neu beginnen, die alte Datei bleibt als .alt bis zum vollständigen Neuaufbau erhalten. */
async function resetIndexAside(forceFts4) {
  const done = (await db.select("SELECT value FROM meta WHERE key = 'initial_done'", [], ["value"])).length > 0;
  await db.moveAside((await db.hasAside().catch(() => false)) && !done);
  await db.open({ fts5: !forceFts4 });
  caps = await migrate(db);
}

async function init() {
  await restoreEvents();
  await loadSettings();
  const { forceFts4 } = await messenger.storage.local.get({ forceFts4: false }); // nur für Tests/Rückfall
  await db.open({ fts5: !forceFts4 });
  caps = await migrate(db);
  // Index passt nicht zu dem, was jetzt verfügbar ist (z. B. alter FTS4-Index, FTS5 jetzt ladbar): einmal neu aufbauen
  const dbInfo = await db.info();
  const wanted = dbInfo.fts5Loaded ? "fts5" : "fts4";
  const have = String(caps.ftsMode).startsWith("fts5") ? "fts5" : "fts4";
  if (wanted !== have) {
    dlog.info(`[novabird-db] Index ${have} -> ${wanted}: wird neu aufgebaut`);
    await resetIndexAside(forceFts4);
  }
  // Textnormalisierung oder Konversationsdaten (Verweise, Textanfang, Betreff-Schlüssel) geändert: alte Einträge passen nicht
  // mehr, einmal neu aufbauen
  const metaVal = async (key) => (await db.select("SELECT value FROM meta WHERE key = ?", [key], ["value"]))[0]?.value;
  const normChanged = String(await metaVal("text_norm")) !== String(TEXT_NORM_VERSION);
  const convChanged = String(await metaVal("conv_data")) !== String(CONV_DATA_VERSION);
  if (normChanged || convChanged) {
    if ((await repo.stats(db)).messages > 0) {
      dlog.info(`[novabird-db] ${normChanged ? `Textnormalisierung -> v${TEXT_NORM_VERSION}` : `Konversationsdaten -> v${CONV_DATA_VERSION}`}: Index wird neu aufgebaut (alte Datei bleibt bis zum Ende erhalten)`);
      await resetIndexAside(forceFts4);
    }
    await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('text_norm', ?)", [String(TEXT_NORM_VERSION)]);
    await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('conv_data', ?)", [String(CONV_DATA_VERSION)]);
  }
  await syncCompoundMode();
  myEmails = await loadMyEmails();
  initialDone = (await db.select("SELECT value FROM meta WHERE key = 'initial_done'", [], ["value"])).length > 0;
  // Aufräumen: eine alte Indexdatei von einem früheren Neuaufbau ist nur nötig, solange der neue Index unvollständig ist
  if (initialDone && (await db.hasAside().catch(() => false))) await db.deleteAside().catch(() => {});
  dlog.info("[novabird-db] bereit:", caps.ftsMode, "·", (await repo.stats(db)).messages, "Mails im Index");
  indexer?.detachListeners();
  indexer = new Indexer({
    db,
    caps,
    log: dlog,
    termsVocab: () => (compoundMode === "index" ? termsVocab : null),
    isExcluded,
    onProgress: (p) => {
      const phaseBefore = status.phase;
      status = { ...p, seconds: Math.round((Date.now() - startedAt) / 1000) };
      if (p.phase !== phaseBefore) pushStatus();
      if (p.phase === "folder") lastProgress = { done: p.done ?? 0, total: p.total ?? null, folder: p.folder ?? null };
      updateOverlay(p);
      if (p.phase === "folder" && p.indexed - lastLogged >= 100) {
        lastLogged = p.indexed;
        console.info("[novabird-db] Fortschritt", status);
      }
      if (p.phase === "done") console.info("[novabird-db] Erstlauf fertig", status);
    },
  });
  indexer.attachListeners();
}

// Texte und Bedienung des Overlays
async function initOverlayUi() {
  const ui = messenger.novabirdDbUi;
  if (!ui) return;
  const t = (k) => messenger.i18n.getMessage(k);
  await ui.setStrings({
    title: t("uiTitle"), pausedTitle: t("uiPausedTitle"), count: t("uiCount"),
    pause: t("uiPause"), resume: t("uiResume"), hide: t("uiHide"), hint: t("uiHint"),
  });
  ui.onControl.addListener((action) => (action === "resume" ? resumeIndexing() : stopIndexing()));
}
initOverlayUi().catch((e) => console.error("[novabird-db] Overlay", e));

async function start() {
  try {
    await init();
  } catch (e) {
    const reason = brokenReason(e);
    if (!reason) throw e;
    // Index unbrauchbar (beschädigt / von neuerer Version): Nutzer fragen, ob neu aufgebaut werden soll.
    // Nicht abwarten: `ready` (und damit ping) darf nicht auf die Antwort des Nutzers warten.
    handleBroken(reason, String(e?.message ?? e)).catch((err) => dlog.error("[novabird-db] Rückfrage Neuaufbau", err));
    return;
  }
  const { testTimings } = await messenger.storage.local.get({ testTimings: null });
  if (testTimings) Object.assign(TIMING, testTimings); // nur für Tests
  await beginSession();
  // Erstlauf selbständig starten (kurz warten, bis Betterbird fertig geladen hat)
  setTimeout(() => runIndex().catch((e) => console.error("[novabird-db] Erstlauf", e)), TIMING.start);
  setTimeout(() => integrityCheck().catch((e) => dlog.error("[novabird-db] Indexprüfung", e)), TIMING.check);
  setTimeout(() => deepTick().catch((e) => dlog.error("[novabird-db] Tiefenabgleich", e)), TIMING.deepEarliest);
}

// ---- Gesundheit des Index ------------------------------------------------------------------------------
const metaGet = async (key) => (await db.select("SELECT value FROM meta WHERE key = ?", [key], ["value"]))[0]?.value;
const metaSet = (key, value) => db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES (?, ?)", [key, String(value)]);
let checkReason = null; // Grund der geplanten Prüfung (unclean | starts | days) oder null

/** Beginn einer Sitzung: war das letzte Beenden sauber? Starts mitzählen; Marke auf „läuft“ setzen. */
async function beginSession() {
  const clean = await metaGet("clean_shutdown");
  const unclean = clean === "0"; // fehlt die Marke (erster Start), gilt es als sauber
  const starts = Number((await metaGet("starts_since_check")) ?? 0) + 1;
  const lastCheck = Number((await metaGet("last_check")) ?? 0);
  if (!lastCheck) await metaSet("last_check", Date.now()); // Ausgangspunkt für die 14-Tage-Regel
  await metaSet("starts_since_check", starts);
  await metaSet("clean_shutdown", "0");
  checkReason = checkDue({ unclean, starts, lastCheck, now: Date.now() });
  if (checkReason) dlog.info(`[novabird-db] Indexprüfung geplant (${checkReason})`);
}

/** PRAGMA quick_check; bei Fehler Rückfrage zum Neuaufbau. */
async function integrityCheck() {
  if (!checkReason || !db || brokenInfo) return;
  if (status.phase === "folder") return; // während des Aufbaus ist der Index neu; nächster Start
  const reason = checkReason;
  checkReason = null;
  let ok = false;
  let detail = "";
  try {
    const rows = await db.select("PRAGMA quick_check(1)", [], ["r"]);
    ok = quickCheckOk(rows);
    detail = String(rows?.[0]?.r ?? "");
  } catch (e) {
    detail = String(e?.message ?? e);
  }
  dlog.info(`[novabird-db] Indexprüfung (${reason}): ${ok ? "in Ordnung" : "FEHLER: " + detail}`);
  if (ok) {
    await metaSet("last_check", Date.now());
    await metaSet("starts_since_check", 0);
    return;
  }
  await handleBroken("corrupt", detail);
}

/** Index unbrauchbar: Fehlerzustand melden und den Nutzer fragen (OK = neu aufbauen, Abbrechen = später manuell). */
async function handleBroken(reason, detail) {
  brokenInfo = { reason, detail };
  status = { phase: "error", error: `Index unbrauchbar (${reason}): ${detail}` };
  pushStatus(); // NovaBird-Conversation melden: nicht nutzbar (usable false)
  dlog.error(`[novabird-db] Index unbrauchbar (${reason}): ${detail}`);
  try {
    indexer?.stop(); // nichts mehr in eine beschädigte Datei schreiben
    indexer?.detachListeners();
  } catch {
    /* Indexer nicht vorhanden */
  }
  const ui = messenger.novabirdDbUi;
  if (!ui?.showDialog) return;
  const t = (k, subs) => messenger.i18n.getMessage(k, subs);
  const why = t(reason === "newer" ? "rebuildWhyNewer" : "rebuildWhyCorrupt");
  const answer = await ui.showDialog(t("rebuildTitle"), t("rebuildText", [why]), [
    { id: "cancel", label: t("rebuildNo") },
    { id: "ok", label: t("rebuildYes") },
  ]);
  if (answer === "ok") {
    await rebuildSafely();
  } else {
    await messenger.storage.local.set({ rebuildDeclinedAt: Date.now() });
    await ui.showDialog(t("rebuildDeclinedTitle"), t("rebuildDeclinedText"), [{ id: "ok", label: t("rebuildDeclinedOk") }]);
  }
}

/** Neuaufbau über eine Nebendatei: alte Datei zur Seite, neu aufbauen, erst danach die alte löschen (siehe runIndex). */
async function rebuildSafely() {
  try {
    indexer?.stop();
    await indexer?.queue;
  } catch {
    /* Indexer nicht vorhanden */
  }
  // Gibt es schon eine .alt (alter guter Index) und ist die aktuelle Datei unvollständig oder kaputt: .alt behalten, aktuelle löschen.
  // Sonst die aktuelle Datei als .alt zur Seite legen (bleibt bis zum vollständigen Neuaufbau erhalten).
  const keepOld = (await db.hasAside().catch(() => false)) && (!initialDone || Boolean(brokenInfo));
  await db.moveAside(keepOld);
  initialDone = false;
  brokenInfo = null;
  status = { phase: "starting" };
  await init();
  await beginSession();
  await metaSet("last_check", Date.now());
  runIndex().catch((e) => console.error("[novabird-db] Neuaufbau", e));
}

// ---- Tiefenabgleich im Leerlauf ------------------------------------------------------------------------
async function deepDue() {
  return Date.now() - Number((await metaGet("last_deep")) ?? 0) > 7 * 86_400_000;
}

/** Wöchentlicher Tiefenabgleich: frühestens 5 Min nach dem Start, im Leerlauf, spätestens nach 30 Min (dann sanft). */
async function deepTick() {
  if (!indexer || !initialDone || brokenInfo) return;
  if (!(await deepDue())) return;
  if (status.phase === "folder" || status.phase === "stopped") {
    setTimeout(() => deepTick().catch(() => {}), 5 * 60_000); // Aufbau läuft: später erneut
    return;
  }
  const since = Date.now() - sessionStart;
  let idle = null;
  try {
    idle = await db.idleSeconds();
  } catch {
    /* ohne Leerlauferkennung: nur die Frist */
  }
  if (since < TIMING.deepForce && !(typeof idle === "number" && idle >= TIMING.idleNeeded)) {
    setTimeout(() => deepTick().catch(() => {}), TIMING.deepRetry);
    return;
  }
  dlog.info(`[novabird-db] Tiefenabgleich startet (Leerlauf ${idle ?? "?"} s, ${Math.round(since / 60000)} Min nach dem Start)`);
  const pause = indexer.pauseMs;
  indexer.pauseMs = Math.max(pause, 150); // sanft: längere Pausen zwischen den Paketen
  try {
    const deep = await indexer.reconcile({ deep: true });
    await metaSet("last_deep", Date.now());
    lastCatchUp = { ...(lastCatchUp ?? { at: Date.now() }), deep };
    if (deep?.added) console.info("[novabird-db] Tiefenabgleich:", deep);
  } finally {
    indexer.pauseMs = pause;
  }
}

/** Mails nachholen, die die Ereignisse verpasst haben (nur nach fertigem Erstlauf, nicht während eines Laufs oder im angehaltenen Zustand). */
async function catchUpNow() {
  if (!indexer || !initialDone || status.phase === "folder" || status.phase === "stopped") {
    dlog.info(`[novabird-db] Nachholen übersprungen (${!indexer ? "nicht bereit" : !initialDone ? "Erstlauf noch nicht fertig" : "Indizierung läuft oder ist angehalten"})`);
    return null;
  }
  dlog.info("[novabird-db] Nachholen und Abgleich starten");
  const r = await indexer.catchUp();
  const rec = await indexer.reconcile(); // rückwirkend einsortierte Mails: Ordner mit abweichender Mailzahl neu durchgehen
  // Der wöchentliche Tiefenabgleich läuft getrennt im Leerlauf (deepTick)
  lastCatchUp = { at: Date.now(), ...r, reconcile: rec };
  if (r.added || rec.added || rec.rescanned) console.info("[novabird-db] Nachgeholt:", lastCatchUp);
  return lastCatchUp;
}

async function runIndex(force = false) {
  if (brokenInfo || !indexer) return; // unbrauchbarer Index: erst nach dem Neuaufbau
  startedAt = Date.now();
  lastLogged = 0;
  await indexer.fullRun({ force });
  if (status.phase === "done" && !initialDone) {
    await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('initial_done', '1')");
    await db.execute("INSERT OR REPLACE INTO meta(key, value) VALUES ('last_deep', ?)", [String(Date.now())]); // frisch gelesen: Tiefenabgleich erst in einer Woche
    initialDone = true;
  }
  // Neuaufbau vollständig: die zur Seite gelegte alte Indexdatei jetzt löschen
  if (status.phase === "done" && initialDone && (await db.hasAside().catch(() => false))) {
    await db.deleteAside().catch((e) => dlog.error("[novabird-db] alte Indexdatei", e));
    dlog.info("[novabird-db] alte Indexdatei gelöscht (Neuaufbau vollständig)");
  }
  pushStatus();
  clearCompoundCache();
  if (status.phase === "done" && (await ensureSeedPass().catch((e) => (dlog.error("[novabird-db] Saatliste", e), false)))) return { ...(await repo.stats(db)), status };
  // Nachholen/Abgleich erst eine Minute nach dem Lauf, damit Betterbird beim Start nicht zusätzlich belastet wird
  if (status.phase === "done") setTimeout(() => catchUpNow().catch((e) => dlog.error("[novabird-db] Nachholen", e)), 60_000);
  return { ...(await repo.stats(db)), status };
}

let myEmails = [];

async function loadMyEmails() {
  const out = new Set();
  try {
    for (const a of await messenger.accounts.list(false)) {
      for (const i of a.identities ?? []) if (i.email) out.add(i.email.toLowerCase());
    }
  } catch {
    /* ohne Identitäten: "von mir" findet dann nichts */
  }
  return [...out];
}

/** Adressbuch-Suche für die Namensauflösung (MV2: properties, MV3: vCard). */
async function lookupContacts(name) {
  try {
    const nodes = await messenger.contacts.quickSearch(name);
    return nodes
      .map((n) => {
        if (n.properties) return { name: n.properties.DisplayName ?? "", email: n.properties.PrimaryEmail ?? "" };
        const v = n.vCard ?? "";
        return {
          name: /^FN[^:]*:(.*)$/im.exec(v)?.[1]?.trim() ?? "",
          email: /^EMAIL[^:]*:(.*)$/im.exec(v)?.[1]?.trim() ?? "",
        };
      })
      .filter((c) => c.email);
  } catch {
    return [];
  }
}

async function stopIndexing() {
  indexer?.stop();
  await indexer?.queue;
  return { ok: true };
}

function resumeIndexing() {
  if (status.phase === "folder") return { ok: true }; // läuft schon
  runIndex().catch((e) => console.error("[novabird-db] Fortsetzen", e));
  return { ok: true };
}

const searchOptions = {
  get myEmails() {
    return myEmails;
  },
  get compoundMode() {
    return compoundMode;
  },
  get langs() {
    return parserLangs;
  },
  get dateOrder() {
    return /^en-us/.test(uiLang()) ? "mdy" : "dmy";
  },
  lookupContacts,
};

async function doSearch(msg, input) {
  const t0 = performance.now();
  const res = await search(db, caps, input, { ...searchOptions, sort: msg.sort ?? "date", limit: msg.limit ?? 200 });
  return { ...res, ms: Math.round(performance.now() - t0) };
}

async function logQuery(text) {
  if (!logSearches || !text) return;
  const { searchLog = [] } = await messenger.storage.local.get({ searchLog: [] });
  if (searchLog.at(-1)?.q === text) return;
  searchLog.push({ t: Date.now(), q: text });
  await messenger.storage.local.set({ searchLog: searchLog.slice(-LOG_MAX) });
}

async function fullStatus() {
  const info = await db.info();
  return {
    ...(await repo.stats(db)),
    headersOnly: await repo.countHeadersOnly(db),
    sizeBytes: info.sizeBytes,
    sqliteVersion: info.sqliteVersion,
    ftsMode: caps?.ftsMode,
    fts5Loaded: info.fts5Loaded,
    compoundMode,
    parserLangs,
    termsFts: Boolean(caps?.termsFts),
    termsVocab: termsVocab?.size ?? 0,
    logSearches,
    lastCatchUp,
    paused: status.phase === "stopped",
    status,
  };
}

/** Für andere Add-ons: Kann der Index jetzt Suchen beantworten? (nicht während des Aufbaus, nicht leer) */
// Meldet dem NovaBird-Conversation jede Änderung von "usable" (Aufbau beginnt/endet, Fehler), damit er nicht regelmäßig fragen muss.
// Fehler (Add-on nicht installiert) werden ignoriert.
async function pushStatus() {
  try {
    const s = await externalStatus();
    if (s.usable === lastPushedUsable) return;
    lastPushedUsable = s.usable;
    for (const target of CONVERSATION_PILOTS) {
      messenger.runtime.sendMessage(target, { type: "status", usable: s.usable, version: s.version, api: s.api, broken: s.broken }).catch(() => {});
    }
  } catch {
    /* ignorieren */
  }
}

async function externalStatus() {
  let messages = 0;
  try {
    messages = (await repo.stats(db)).messages;
  } catch {
    /* Datenbank nicht lesbar: ping darf nie werfen */
  }
  const indexing = status.phase === "folder";
  return {
    ok: true,
    version: messenger.runtime.getManifest().version,
    api: API_VERSION, // Schnittstellenversion; fehlt bei NovaBird-DB < 1.0.2 (dann gilt die Programmversion)
    features: ["search", "fields", "folderId", "includeTrash", "sort", "suggest", "limit1000000", "conversation"],
    ready: Boolean(caps) && status.phase !== "error",
    indexing,
    messages,
    initialDone,
    // nutzbar erst, wenn der Erstlauf einmal komplett fertig war (sonst bleibt der NovaBird-Search bei Gloda)
    usable: Boolean(caps) && status.phase !== "error" && messages > 0 && !indexing && initialDone,
    ftsMode: caps?.ftsMode,
    broken: brokenInfo ? brokenInfo.reason : null, // corrupt | newer, solange der Index unbrauchbar ist
  };
}

const ready = start().then(() => pushStatus()).catch((e) => {
  console.error("[novabird-db] Start fehlgeschlagen", e);
  status = { phase: "error", error: String(e?.message ?? e) };
  pushStatus();
});

messenger.runtime.onMessage.addListener((msg) => {
  const run = async () => {
    await ready;
    switch (msg?.type) {
      case "novabird-db:debug":
        return { info: await db.info(), caps, status, stats: await repo.stats(db), includeFolders, includeAccounts };
      case "novabird-db:folders": {
        const acc = await messenger.accounts.list(true);
        return acc.map((a) => ({ name: a.name, type: a.type, folders: (a.rootFolder ? a.rootFolder.subFolders : a.folders)?.map((f) => ({ name: f.name, id: f.id, path: f.path, type: f.type })) }));
      }
      case "novabird-db:fullRun":
        return runIndex(Boolean(msg.force));
      case "novabird-db:setFolders":
        includeFolders = msg.folders ?? [];
        if (msg.accounts) await messenger.storage.local.set({ includeAccounts: msg.accounts });
        await messenger.storage.local.set({ includeFolders });
        await loadSettings();
        return { includeFolders, includeAccounts };
      case "novabird-db:search":
        return doSearch(msg, msg.query ?? msg.text);
      case "novabird-db:removeChip":
        return doSearch(msg, removeChip(msg.query, msg.chipId));
      case "novabird-db:open": {
        const row = msg.row;
        const list = await messenger.messages.query({ headerMessageId: row.header_msg_id });
        const hit = list.messages.find((m) => (m.folder?.id ?? "") === row.folder_id) ?? list.messages[0];
        if (!hit) return { error: "Mail nicht gefunden" };
        await messenger.messageDisplay.open({ messageId: hit.id, location: "tab" });
        return { ok: true };
      }
      case "novabird-db:conversation": // nur Test/Debug (dieselbe Abfrage wie der externe Befehl "conversation")
        return await findConversation(db, msg);
      case "novabird-db:status":
        return fullStatus();
      case "novabird-db:setCompoundMode":
        return setCompoundMode(msg.mode);
      case "novabird-db:getEvents":
        return events.filter((e) => e.n > (Number(msg.since) || 0));
      case "novabird-db:clearEvents":
        events.length = 0;
        await messenger.storage.local.remove("eventLog");
        return { ok: true };
      case "novabird-db:catchUp":
        return (await catchUpNow()) ?? { skipped: true };
      case "novabird-db:debugForget": {
        // nur für Tests: die N neuesten (oder mit oldest:true die ältesten) Einträge aus dem Index entfernen, um „verpasste Mails“ nachzustellen
        const rows = await db.select(`SELECT header_msg_id, folder_id FROM messages ORDER BY date ${msg.oldest ? "ASC" : "DESC"} LIMIT ?`, [Number(msg.count) || 1], ["h", "f"]);
        await repo.deleteMessages(db, caps, rows.map((r) => ({ headerMessageId: r.h, folderId: r.f })));
        return { removed: rows.length };
      }
      case "novabird-db:stop":
        return stopIndexing();
      case "novabird-db:resume":
        return resumeIndexing();
      // --- Wartung ---
      case "novabird-db:reindex":
        await rebuildSafely(); // alte Datei zur Seite, neu aufbauen, danach alte löschen
        return { ok: true };
      case "novabird-db:delete":
        indexer?.stop();
        await indexer?.queue;
        await db.deleteIndex();
        await db.deleteAside().catch(() => {});
        brokenInfo = null;
        status = { phase: "deleted" };
        await init();
        return { ok: true };
      case "novabird-db:maintain": {
        const before = (await db.info()).sizeBytes;
        await repo.cleanupOrphans(db, caps);
        await db.execute("VACUUM");
        return { sizeBefore: before, sizeAfter: (await db.info()).sizeBytes };
      }
      // --- Suchprotokoll ---
      case "novabird-db:logQuery":
        return logQuery(String(msg.text ?? "").trim());
      case "novabird-db:getLog":
        return (await messenger.storage.local.get({ searchLog: [] })).searchLog;
      case "novabird-db:clearLog":
        await messenger.storage.local.set({ searchLog: [] });
        return { ok: true };
      case "novabird-db:setParserLangs": {
        const next = sanitizeLangs(msg.langs) ?? defaultParserLangs();
        parserLangs = next;
        await messenger.storage.local.set({ parserLangs: next });
        return { parserLangs };
      }
      case "novabird-db:setLogging":
        logSearches = Boolean(msg.on);
        await messenger.storage.local.set({ logSearches });
        return { logSearches };
      default:
        return undefined;
    }
  };
  if (!msg?.type?.startsWith("novabird-db:")) return undefined;
  return run().catch((e) => ({ error: String(e?.message ?? e) }));
});

// Schnittstelle für andere Add-ons. Nur Absender aus ALLOWED_EXTERNAL; nur lesende Funktionen.
//   {type:"ping"}                                   -> Status (siehe externalStatus)
//   {type:"progress"}                               -> {indexing, paused, done, total, percent, folder}
//   {type:"stop"} / {type:"resume"}                 -> Indexlauf anhalten bzw. fortsetzen
//   {type:"search", text, limit?, includeTrash?, sort?, fields?, folderId?} -> {rows:[{header_msg_id, folder_id, date}], chips, suggest}; sort: "date" (Standard) | "relevance";
//     suggest = null | { text: korrigierte Anfrage („Meinten Sie …?“, nur bei 0 Treffern und FTS5), words:[{term, options}] }
messenger.runtime.onMessageExternal.addListener((msg, sender) => {
  const allowed = ALLOWED_EXTERNAL[sender?.id];
  if (!allowed) return undefined;
  if (allowed !== "*" && !allowed.includes(msg?.type)) return Promise.resolve({ ok: false, error: "nicht erlaubt" });
  const run = async () => {
    await ready;
    switch (msg?.type) {
      case "ping":
        return externalStatus();
      case "progress": {
        // Leichtgewichtig (keine Datenbankabfrage): Fortschritt des laufenden Indexlaufs
        const indexing = status.phase === "folder";
        const paused = status.phase === "stopped";
        const { done, total, folder } = lastProgress;
        return {
          ok: true,
          indexing,
          paused,
          done: indexing || paused ? done : 0,
          total: indexing || paused ? total : null,
          percent: (indexing || paused) && total ? Math.min(100, Math.round((done / total) * 100)) : null,
          folder: indexing || paused ? folder : null,
        };
      }
      case "stop":
        return stopIndexing();
      case "resume":
        return resumeIndexing();
      case "search": {
        const res = await search(db, caps, String(msg.text ?? ""), {
          ...searchOptions,
          sort: msg.sort === "relevance" ? "relevance" : "date",
          limit: Math.min(Number(msg.limit) || 1000, 1000000),
          includeTrash: Boolean(msg.includeTrash),
          folderId: msg.folderId ? String(msg.folderId) : null, // optional: nur dieser Ordner („Aktueller Ordner“)
          fields: Array.isArray(msg.fields) ? msg.fields : null, // optional: ["from","to","subject","body"] (Teilmenge)
        });
        return {
          ok: true,
          chips: res.chips,
          empty: res.empty,
          suggest: res.suggest ? { text: res.suggest.text, words: res.suggest.words } : null,
          rows: res.rows.map((r) => ({ header_msg_id: r.header_msg_id, folder_id: r.folder_id, date: r.date })),
        };
      }
      case "conversation": {
        // Konversation einer Nachricht aus dem Index (für den NovaBird-Conversation); nur bei nutzbarem Index
        if (!(await externalStatus()).usable) return { ok: false, error: "Index nicht bereit", usable: false };
        return await findConversation(db, {
          headerMessageId: msg.headerMessageId,
          folderId: msg.folderId ? String(msg.folderId) : undefined,
          fallback: msg.fallback ?? msg.subjectFallback,
          fallbackDays: msg.fallbackDays,
          fallbackPeople: msg.fallbackPeople,
          limit: msg.limit,
        });
      }
      default:
        return { ok: false, error: "unbekannter Befehl" };
    }
  };
  return run().catch((e) => ({ ok: false, error: String(e?.message ?? e) }));
});

// Täglich nachholen (zusätzlich zum Nachholen nach jedem Erstlauf/Neustart)
messenger.alarms.create("novabird-db-catchup", { delayInMinutes: 60, periodInMinutes: 360 });
messenger.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "novabird-db-catchup") {
    catchUpNow().catch((e) => console.error("[novabird-db] Nachholen", e));
    deepTick().catch((e) => console.error("[novabird-db] Tiefenabgleich", e)); // nur wenn fällig (7 Tage)
  }
});
