/* NovaBird-Search – Hintergrundlogik: Eingabe → Filter im aktuellen Ordner oder Suchordner (alle Ordner).
 * Die Treffer erscheinen immer in der normalen Nachrichtenliste, neueste zuerst.
 */
"use strict";

const DEBOUNCE_MS = 250;
const GLODA_DELAY_MS = 600;   // Volltext erst nach kurzer Tipp-Pause (die Liste soll nicht ständig springen)
const STATE_KEY = "searchState";

let settings = { ...SETTINGS_DEFAULTS };

// ---- Jede Suchleiste (je Hauptfenster/Tab) hat eine feste Kennung und einen eigenen Zustand („Controller“) -------------
// Die Kennung kommt mit jedem Ereignis der Leiste; alle Antworten gehen mit derselben Kennung an genau diese Leiste zurück.
// Dadurch können beliebig viele Hauptfenster unabhängig voneinander suchen und filtern.
const controllers = new Map();
const BAR_FUNCS = ["setNote", "setSuggestion", "setBusy", "setGroupMode", "highlight", "clearText", "restoreFolderView", "createSearchFolder", "glodaSearch", "idSearch", "openResultsInNewTab", "openFacetSearch", "askEnter", "refineSnapshot", "openHitsInTab", "openPage"];
function barApi(barId) {
  const api = {};
  for (const name of BAR_FUNCS) {
    api[name] = (...args) => messenger.searchBar[name](barId, ...args);
  }
  return api;
}
let lastBarId = null; // zuletzt benutzte Leiste (für Aufrufe aus Seiten der Erweiterung, z. B. die Analyse)
function getCtl(barId) {
  let ctl = controllers.get(barId);
  if (!ctl) {
    ctl = {
      id: barId,
      sb: barApi(barId),
      tabId: null,              // Tab-ID der WebExtension-API
      generation: 0,            // verwirft Ergebnisse veralteter Suchen
      searchFolderId: null,     // MailFolderId des aktuellen Suchordners
      folderBeforeSearch: null, // dorthin zurück, wenn das Suchfeld geleert wird
      highlightWord: "",        // Suchwort, das im Nachrichtentext markiert wird
      ownChange: false,         // true, solange wir selbst den Ordner wechseln
      debounceTimer: null,
      glodaTimer: null,
      lastState: null,          // zuletzt gemeldeter Zustand der Optionen (für Enter → Analyse)
      refineGen: 0,
    };
    controllers.set(barId, ctl);
  }
  lastBarId = barId;
  return ctl;
}
async function ctlTab(ctl) {
  if (ctl.tabId == null) {
    ctl.tabId = (await messenger.searchBar.tabIdOf(ctl.id).catch(() => null)) ?? null;
  }
  if (ctl.tabId == null) {
    return undefined;
  }
  try {
    return await messenger.mailTabs.get(ctl.tabId);
  } catch {
    return undefined;
  }
}
const ctlByTab = tabId => [...controllers.values()].find(c => c.tabId === tabId);
// Tab geschlossen: Controller und Zeitgeber freigeben
messenger.tabs.onRemoved.addListener(tabId => {
  const ctl = ctlByTab(tabId);
  if (ctl) {
    clearTimeout(ctl.debounceTimer);
    clearTimeout(ctl.glodaTimer);
    controllers.delete(ctl.id);
  }
});

// Feste Reihenfolge: neueste zuerst
const DATE_DESC = { sortType: "date", sortOrder: "descending" };

// Nativen Schnellfilter (nur aktueller Ordner, EIN Suchtext) nutzen, wenn die Kriterien dazu passen.
// Sonst: Suchordner über den aktuellen Ordner (Datum, mehrere Felder, Empfänger, markiert).
function canUseQuickFilter(criteria, state) {
  // Kein Feld angehakt: der Schnellfilter wüsste nicht wo; der Suchordner liefert dann „nichts“.
  if (criteria.freeText && !(state.from || state.to || state.subject || state.body)) {
    return false;
  }
  const fieldTokens = [criteria.author, criteria.subject, criteria.body].filter(Boolean).length;
  const texts = fieldTokens + (criteria.freeText ? 1 : 0);
  return texts <= 1 && !criteria.fromDate && !criteria.toDate && !criteria.flagged && !criteria.recipients;
}

async function applyQuickFilter(tab, criteria, state) {
  let text = { text: "" };
  if (criteria.freeText) {
    text = { text: criteria.freeText, author: state.from, recipients: state.to, subject: state.subject, body: state.body };
  } else if (criteria.author) {
    text = { text: criteria.author, author: true };
  } else if (criteria.subject) {
    text = { text: criteria.subject, subject: true };
  } else if (criteria.body) {
    text = { text: criteria.body, body: true };
  }
  await messenger.mailTabs.setQuickFilter(tab.id, {
    show: true,
    unread: criteria.unread ?? (state.unread ? true : undefined),
    attachment: criteria.attachment ?? (state.attachment ? true : undefined),
    text,
  });
  await messenger.mailTabs.update(tab.id, DATE_DESC);
}

// Das längste Einzelwort der Suche (Finder markiert nur einen Begriff).
function pickHighlightWord(criteria) {
  const words = [criteria.freeText, criteria.author, criteria.subject, criteria.body]
    .filter(Boolean)
    .join(" ")
    .split(/\s+/)
    .map(w => w.replace(/^"+|"+$/g, ""))
    .filter(Boolean);
  return words.sort((a, b) => b.length - a.length)[0] || "";
}

async function setHighlight(ctl, word) {
  ctl.highlightWord = word;
  await ctl.sb.highlight(word).catch(() => {});
}

// setNote immer mit allen drei Parametern aufrufen: bei weggelassenen optionalen Zeichenketten ordnet die Schema-Prüfung die
// vorhandenen Argumente den LETZTEN Parametern zu (Text würde zum Tooltip/Art verrutschen).
const showNote = (ctl, text = "", tip = "", kind = "") => ctl.sb.setNote(text, tip, kind).catch(() => {});

async function leaveSearch(ctl, tab) {
  ctl.generation++;
  ctl.sb.setSuggestion("").catch(() => {});
  showNote(ctl); // Hinweise (z. B. „mindestens 3 Zeichen“) enden mit der Suche
  clearTimeout(ctl.glodaTimer);
  ctl.sb.setBusy(false).catch(() => {});
  ctl.sb.setGroupMode(false).catch(() => {});
  await setHighlight(ctl, "");
  if (tab && ctl.searchFolderId && tab.displayedFolder?.id === ctl.searchFolderId && ctl.folderBeforeSearch) {
    ctl.ownChange = true;
    try {
      await messenger.mailTabs.update(tab.id, { displayedFolder: ctl.folderBeforeSearch });
    } finally {
      ctl.ownChange = false;
    }
  }
  // Ist eine Treffer-Ansicht (Volltext) offen, zurück zum Ordner
  await ctl.sb.restoreFolderView().catch(() => {});
  if (tab) {
    await messenger.mailTabs.setQuickFilter(tab.id, { show: true });
  }
  ctl.searchFolderId = null;
}

// --- Eigener Suchindex (früher Add-on NovaBird-DB) -------------------------------------------------
// Ab 2.0 läuft der Index im selben Add-on (db/background.js, Modul, lädt nach diesen Skripten). Er meldet sich über
// globalThis.novabirdDbLocal an; bis dahin gilt er als „startet noch“.
let novabirdDbCache = { at: 0, status: null };
function dbCall(msg) {
  const local = globalThis.novabirdDbLocal;
  return local ? local(msg) : Promise.reject(new Error("Suchindex startet noch"));
}

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

// Status des NovaBird-DB (kurz zwischengespeichert); null = nicht vorhanden, nicht bereit oder abgeschaltet.
let novabirdDbWhy = "missing"; // warum der NovaBird-DB gerade nicht genutzt wird: off | missing | building

async function novabirdDbStatus() {
  if (settings.novabirdDb === "off") {
    novabirdDbWhy = "off";
    return null;
  }
  if (Date.now() - novabirdDbCache.at < 5000) {
    return novabirdDbCache.status;
  }
  let status = null;
  try {
    const st = await withTimeout(dbCall({ type: "ping" }), 1500);
    if (st?.ok && st.broken) {
      status = null;
      novabirdDbWhy = "broken"; // Index beschädigt: Neuaufbau in den NovaBird-DB-Einstellungen
    } else if (st?.ok && !novabirdDbApiOk(st)) {
      status = null;
      novabirdDbWhy = "outdated"; // NovaBird-DB zu alt für diese NovaBird-Search-Version
    } else {
      status = st?.ok && st.usable ? st : null;
      novabirdDbWhy = st?.ok && !st.usable ? "building" : "missing";
    }
  } catch {
    status = null; // startet noch oder defekt -> Gloda
    novabirdDbWhy = globalThis.novabirdDbLocal ? "missing" : "building";
  }
  novabirdDbCache = { at: Date.now(), status };
  return status;
}

// Schnittstellenversion des NovaBird-DB: `api` im ping (ab NovaBird-DB 1.0.2), sonst gilt die Programmversion (1.0 und 1.0.1 haben alle benötigten Funktionen)
const REQUIRED_DB_API = 1;
function versionAtLeast(version, min) {
  const nums = (String(version ?? "").match(/\d+/g) ?? []).map(Number);
  for (let i = 0; i < min.length; i++) {
    const a = nums[i] ?? 0;
    if (a !== min[i]) return a > min[i];
  }
  return true;
}
function novabirdDbApiOk(st) {
  return Number(st.api) >= REQUIRED_DB_API || (st.api === undefined && versionAtLeast(st.version, [1, 0]));
}

// Höchstzahl der Treffer: 0 = unbegrenzt (NovaBird-DB) bzw. höchstens 20000 (Gloda, sonst zu langsam)
const dbLimit = () => settings.glodaLimit || 1000000;
const glodaCap = () => Math.min(settings.glodaLimit || 20000, 20000);

// Rohtreffer vom NovaBird-DB (rows) oder null, wenn er nicht bereit ist / nicht antwortet.
async function novabirdDbFetch(text, state, folderId, limit) {
  if (!(await novabirdDbStatus())) {
    return null;
  }
  try {
    const res = await withTimeout(
      dbCall({
        type: "search",
        text,
        limit: limit || dbLimit(),
        includeTrash: Boolean(state.trash || state.spam || folderId),
        folderId: folderId || undefined,
        fields: ["from", "to", "subject", "body"].filter(k => state[k]),
        sort: "date",
      }),
      15000
    );
    return res?.ok ? res : null;
  } catch (e) {
    console.warn("NovaBird-Search: NovaBird-DB-Abfrage fehlgeschlagen", e);
    return null;
  }
}

// Volltext aus dem NovaBird-DB. Gibt die Trefferzahl zurück oder null, wenn nicht möglich (dann Gloda).
async function novabirdDbSearch(ctl, text, criteria, state, gen, folderId) {
  if (!(await novabirdDbStatus())) {
    return null;
  }
  try {
    const res = await withTimeout(
      dbCall({
        type: "search",
        text,
        limit: dbLimit(),
        includeTrash: Boolean(state.trash || state.spam || folderId),
        folderId: folderId || undefined, // „Aktueller Ordner“: nur dieser Ordner
        fields: ["from", "to", "subject", "body"].filter(k => state[k]), // Haken des Optionsmenüs: wo gesucht wird
        sort: settings.sortMode === "relevance" ? "relevance" : "date",
      }),
      8000
    );
    if (!res?.ok) {
      return null;
    }
    if (gen !== ctl.generation) {
      return -1;
    }
    ctl.sb.setSuggestion(res.rows.length ? "" : res.suggest?.text ?? "").catch(() => {});
    // Aktueller Ordner: auch im Papierkorb/Spam-Ordner selbst anzeigen
    const showState = folderId ? { ...state, trash: true, spam: true } : state;
    const count = await ctl.sb.idSearch(res.rows, criteria, { ...showState, group: settings.group }, settings.sortMode === "relevance");
    if (count >= 0) {
      semanticAugment(ctl, text, criteria, showState, gen, folderId, res.rows); // nicht abwarten: Worttreffer stehen schon
    }
    return count === -2 ? null : count;
  } catch (e) {
    console.warn("NovaBird-Search: NovaBird-DB-Suche fehlgeschlagen, nutze Gloda", e);
    novabirdDbCache = { at: 0, status: null };
    return null;
  }
}

// Semantische Suche (Beta, semantic/main.js): ergänzt die Worttreffer um Mails, die der Bedeutung nach passen. Läuft erst
// nach der Anzeige der Worttreffer, damit das Tippen nicht langsamer wird; der Hinweis „+N ähnlich“ zählt die ergänzten.
// Dieselben Filter wie bei der Wortsuche (Zeitraum, ungelesen, Anhang, Papierkorb/Spam, aktueller Ordner).
// Solange sie rechnet, dreht das Lade-Symbol weiter (eigener Tooltip); die Worttreffer sind schon benutzbar.
async function semanticAugment(ctl, text, criteria, showState, gen, folderId, lexRows) {
  const sem = globalThis.novabirdSemantic;
  if (!sem?.enabled()) {
    return;
  }
  ctl.semanticGen = gen;
  ctl.sb.setBusy(true, messenger.i18n.getMessage("busySimilar")).catch(() => {});
  try {
    const res = await sem.query(text, { includeTrash: Boolean(showState.trash || showState.spam || folderId), folderId: folderId || null });
    if (!res?.rows?.length || gen !== ctl.generation) {
      return;
    }
    const have = new Set(lexRows.map(r => r.header_msg_id));
    const extra = res.rows.filter(r => !have.has(r.header_msg_id));
    if (!extra.length) {
      return;
    }
    const relevance = settings.sortMode === "relevance";
    const rows = relevance ? fuseRanks(lexRows, res.rows) : [...lexRows, ...extra];
    const count = await ctl.sb.idSearch(rows, criteria, { ...showState, group: settings.group }, relevance);
    if (count >= 0 && gen === ctl.generation) {
      showNote(ctl, messenger.i18n.getMessage("noteSimilar", [String(extra.length)]), messenger.i18n.getMessage("noteSimilarTip"), "info");
    }
  } catch (e) {
    console.warn("NovaBird-Search: semantische Suche", e);
  } finally {
    if (ctl.semanticGen === gen) {
      ctl.semanticGen = 0;
      endBusy(ctl, gen);
    }
  }
}

// Lade-Symbol der Suche gen ausschalten, außer sie ist überholt oder die semantische Suche rechnet noch
function endBusy(ctl, gen) {
  if (gen === ctl.generation && ctl.semanticGen !== gen) {
    ctl.sb.setBusy(false).catch(() => {});
  }
}

// Reciprocal Rank Fusion (k = 60): gemeinsame Rangfolge aus Wortsuche und Bedeutungssuche (nur bei Sortierung „Relevanz“)
function fuseRanks(lexRows, semRows) {
  const score = new Map();
  const row = new Map();
  [lexRows, semRows].forEach(list => list.forEach((r, i) => {
    score.set(r.header_msg_id, (score.get(r.header_msg_id) || 0) + 1 / (60 + i + 1));
    if (!row.has(r.header_msg_id)) {
      row.set(r.header_msg_id, r);
    }
  }));
  return [...row.values()].sort((a, b) => score.get(b.header_msg_id) - score.get(a.header_msg_id));
}

// Volltext nach kurzer Pause; bis dahin und währenddessen dreht das Lade-Symbol.
function scheduleGloda(ctl, criteria, state, gen, text) {
  clearTimeout(ctl.glodaTimer);
  ctl.sb.setBusy(true).catch(() => {});
  ctl.glodaTimer = setTimeout(async () => {
    if (gen !== ctl.generation) {
      return;
    }
    try {
      const viaDb = await novabirdDbSearch(ctl, text, criteria, state, gen);
      if (viaDb !== null) {
        console.log("NovaBird-Search: Volltext (NovaBird-DB)", viaDb, "Höchstzahl", settings.glodaLimit || "unbegrenzt");
        return;
      }
      const count = await ctl.sb.glodaSearch(
        criteria,
        { ...state, group: settings.group, limit: glodaCap() },
        undefined
      );
      console.log("NovaBird-Search: Volltext", count);
    } catch (e) {
      console.error("NovaBird-Search: Volltextsuche fehlgeschlagen", e);
    } finally {
      endBusy(ctl, gen);
    }
  }, GLODA_DELAY_MS);
}

// Beginn des gewählten Zeitfensters (ms) oder 0 für „Alle“
function rangeStart(range) {
  const days = { "3d": 3, "7d": 7, "30d": 30 }[range];
  if (range === "today") {
    return new Date().setHours(0, 0, 0, 0);
  }
  return days ? Date.now() - days * 864e5 : 0;
}

async function runSearch(ctl, query) {
  const gen = ++ctl.generation;
  ctl.sb.setSuggestion("").catch(() => {});
  const text = (query.text || "").trim();
  const state = query.state || {};
  const tab = await ctlTab(ctl);
  if (!tab) {
    return;
  }

  const criteria = parseQuery(text);
  // Zeitfenster unter dem Suchfeld wirkt auch ohne Suchtext (zeigt dann die neuen Nachrichten)
  const from = rangeStart(state.range);
  if (from) {
    criteria.fromDate = Math.max(criteria.fromDate || 0, from);
  }
  if (isEmpty(criteria)) {
    await leaveSearch(ctl, tab);
    return;
  }

  // Weniger als 3 Zeichen: keine Live-Suche (kurze Vorsilben treffen fast den ganzen Index); Enter sucht trotzdem (query.force)
  if (!query.force && isTooShort(criteria)) {
    showNote(ctl, messenger.i18n.getMessage("noteShort"), messenger.i18n.getMessage("noteShortTip"), "info");
    return;
  }
  await setHighlight(ctl, pickHighlightWord(criteria));
  ctl.sb.setGroupMode(settings.group).catch(() => {});

  const inSearchFolder = ctl.searchFolderId && tab.displayedFolder?.id === ctl.searchFolderId;
  if (!inSearchFolder) {
    ctl.folderBeforeSearch = tab.displayedFolder?.id ?? ctl.folderBeforeSearch;
  }
  const currentFolderId = inSearchFolder ? ctl.folderBeforeSearch : tab.displayedFolder?.id;
  const folderScope = criteria.scope === "folder" || state.scope === "folder";

  // Volltext (Nachrichtentext) über alle Ordner: Gloda. Zuerst die schnelle Kopfzeilen-Suche.
  const useGloda = Boolean(state.body) && !folderScope && Boolean(criteria.freeText || criteria.body);
  // Ist der NovaBird-DB einsatzbereit, fragt der NovaBird-Search NUR ihn (kein Zwischenergebnis der Kopfsuche): gleiche Ergebnisse
  // unabhängig von Schreibweise/Haken. Die Haken Von/An/Betreff/Nachricht wählen nur die Felder. Sonst alter Weg (Kopfsuche + Gloda).
  const dbReady = text && (state.from || state.to || state.subject || state.body) && (!folderScope || currentFolderId) && (await novabirdDbStatus());
  // Hinweis, wenn statt des NovaBird-DB Gloda/Betterbirds Filter sucht
  if (text) {
    const key = { off: "noteDbOff", missing: "noteDbMissing", building: "noteDbBuilding", broken: "noteDbBroken", outdated: "noteDbOutdated" }[novabirdDbWhy];
    const tipKey = { broken: "noteDbTipBroken", outdated: "noteDbTipOutdated" }[novabirdDbWhy] || "noteDbTip";
    if (dbReady) {
      showNote(ctl);
    } else {
      showNote(ctl, messenger.i18n.getMessage(key), messenger.i18n.getMessage(tipKey));
    }
  } else {
    showNote(ctl);
  }
  if (dbReady) {
    ctl.sb.setBusy(true).catch(() => {});
    try {
      const viaDb = await novabirdDbSearch(ctl, text, criteria, state, gen, folderScope ? currentFolderId : undefined);
      if (viaDb !== null) {
        if (gen === ctl.generation) {
          console.log("NovaBird-Search: Suche (NovaBird-DB)", viaDb);
        }
        return;
      }
    } catch (e) {
      console.error("NovaBird-Search: NovaBird-DB-Suche fehlgeschlagen", e);
    } finally {
      endBusy(ctl, gen);
    }
    if (gen !== ctl.generation) {
      return;
    }
    // NovaBird-DB hat nicht geantwortet: Rückfall, das zeigen wir an
    showNote(ctl, messenger.i18n.getMessage("noteDbMissing"), messenger.i18n.getMessage("noteDbTip"));
  }

  const quickCriteria = { ...criteria };
  if (useGloda) {
    delete quickCriteria.body;
    if (!(state.from || state.to || state.subject)) {
      delete quickCriteria.freeText; // nur Nachrichtentext angehakt
    }
  }
  const quickEmpty = isEmpty(quickCriteria);

  try {
    if (folderScope && canUseQuickFilter(criteria, state) && !inSearchFolder) {
      await applyQuickFilter(tab, criteria, state);
      return;
    }
    if (!quickEmpty) {
      ctl.ownChange = true;
      try {
        const folderId = await ctl.sb.createSearchFolder(
          quickCriteria,
          { ...state, body: useGloda ? false : state.body, scope: folderScope ? "folder" : "all" },
          folderScope ? currentFolderId : undefined
        );
        if (gen !== ctl.generation) {
          return; // überholt
        }
        ctl.searchFolderId = folderId;
        if (!inSearchFolder) {
          // Standard: flache Liste (nicht nach Konversationen gruppiert), neueste zuerst
          await messenger.mailTabs.update(tab.id, { displayedFolder: folderId, viewType: settings.group ? "groupedByThread" : "ungrouped", ...DATE_DESC });
        }
      } finally {
        ctl.ownChange = false;
      }
    }
    if (useGloda) {
      scheduleGloda(ctl, criteria, state, gen, text);
    } else {
      ctl.sb.setBusy(false).catch(() => {});
    }
  } catch (e) {
    console.error("NovaBird-Search: Suche fehlgeschlagen", e);
  }
}


// Treffer-Tab („Filtern“): die Leiste grenzt nur die Treffer des Tabs weiter ein.
async function refineSnapshot(ctl, text) {
  const gen = ++ctl.refineGen;
  const t = (text || "").trim();
  if (!t) {
    await ctl.sb.refineSnapshot(undefined, "");
    return;
  }
  const res = await novabirdDbFetch(t, { from: true, to: true, subject: true, body: true, trash: true }, undefined, dbLimit());
  if (gen !== ctl.refineGen) {
    return;
  }
  if (res) {
    await ctl.sb.refineSnapshot(res.rows, t);
  } else {
    await ctl.sb.refineSnapshot(undefined, t); // NovaBird-DB nicht verfügbar: einfacher Textvergleich
  }
}

messenger.searchBar.onQuery.addListener(query => {
  const ctl = getCtl(query.barId);
  clearTimeout(ctl.debounceTimer);
  clearTimeout(ctl.glodaTimer);
  if (query.refine) {
    ctl.debounceTimer = setTimeout(() => refineSnapshot(ctl, query.text).catch(e => console.error("NovaBird-Search: Eingrenzen", e)), DEBOUNCE_MS);
    return;
  }
  ctl.lastState = query.state || ctl.lastState;
  ctl.debounceTimer = setTimeout(() => runSearch(ctl, query), DEBOUNCE_MS);
});

// Wechselt der Nutzer selbst den Ordner, ist die Suche in DIESEM Tab beendet: Feld leeren.
messenger.mailTabs.onDisplayedFolderChanged.addListener(async (tab, folder) => {
  const ctl = ctlByTab(tab.id);
  if (!ctl || ctl.ownChange || !folder || (ctl.searchFolderId && folder.id === ctl.searchFolderId)) {
    return;
  }
  clearTimeout(ctl.debounceTimer);
  clearTimeout(ctl.glodaTimer);
  ctl.generation++;
  ctl.searchFolderId = null;
  ctl.sb.setBusy(false).catch(() => {});
  ctl.sb.setGroupMode(false).catch(() => {});
  await setHighlight(ctl, "");
  await ctl.sb.clearText();
});

// Jede neu angezeigte Nachricht: Suchwort der Leiste dieses Tabs erneut markieren
messenger.messageDisplay.onMessageDisplayed.addListener(tab => {
  const ctl = ctlByTab(tab?.id);
  if (ctl?.highlightWord) {
    ctl.sb.highlight(ctl.highlightWord).catch(() => {});
  }
});

// Enter: je nach Einstellung nichts, Filtern (Treffer als Momentaufnahme in neuem Tab), Auswerten (Analyseseite) oder Rückfrage.
messenger.searchBar.onEnter.addListener(async (text, barId) => {
  const ctl = getCtl(barId);
  let mode = settings.enterMode;
  clearTimeout(ctl.debounceTimer);
  clearTimeout(ctl.glodaTimer);
  // Kurzer Suchbegriff (< 3 Zeichen): Enter sucht jetzt direkt in der Liste, ohne Rückfrage und ohne neuen Tab
  if (isTooShort(parseQuery(text))) {
    await runSearch(ctl, { text, state: ctl.lastState || {}, force: true });
    return;
  }
  if (mode === "off") {
    return;
  }
  if (mode === "ask") {
    const answer = await ctl.sb.askEnter();
    if (!answer) {
      return;
    }
    mode = answer.choice === "analysis" ? "analysis" : "snapshot";
    if (answer.remember) {
      settings = sanitizeSettings({ ...settings, enterMode: mode });
      await messenger.storage.local.set({ [SETTINGS_KEY]: settings });
    }
  }
  if (mode === "analysis") {
    await openAnalysis(ctl, text);
    return; // die Suche im Fenster bleibt stehen
  }
  const tab = await ctlTab(ctl);
  const before = ctl.folderBeforeSearch;
  // Laufende Anfragen zu Ende kommen lassen, damit die Liste vollständig ist
  await new Promise(resolve => setTimeout(resolve, GLODA_DELAY_MS + 400));
  const opened = (await ctl.sb.openResultsInNewTab(text.trim())) > 0;
  if (!opened) {
    return;
  }
  // Ursprünglichen Tab zurücksetzen (Feld leeren, Ordner wieder anzeigen)
  ctl.generation++;
  await setHighlight(ctl, "");
  ctl.sb.setGroupMode(false).catch(() => {});
  await ctl.sb.clearText();
  await ctl.sb.restoreFolderView().catch(() => {});
  if (tab && before) {
    ctl.ownChange = true;
    try {
      await messenger.mailTabs.update(tab.id, { displayedFolder: before });
    } finally {
      ctl.ownChange = false;
    }
  }
  ctl.searchFolderId = null;
});

// ---- Analyseseite (Auswerten) ------------------------------------------------------------------
// Treffer des NovaBird-DB als eigene Seite mit anklickbaren Filtern (Absender, Ordner, Monat, Anhang).
const analyses = new Map(); // id -> { text, hits }
const analysisBars = new Map(); // id -> Kennung der Leiste, aus der die Analyse stammt (für „Als Liste öffnen“)
let analysisSeq = 0;

async function openAnalysis(ctl, text) {
  const state = { from: true, to: false, subject: true, body: true, ...(ctl.lastState || {}), trash: false, spam: false };
  const res = await novabirdDbFetch(text.trim(), state);
  if (!res) {
    // Ohne NovaBird-DB: Thunderbirds alte Detailsuche (Gloda) als Rückfall
    const c = parseQuery(text);
    const words = [c.freeText, c.author, c.recipients, c.subject, c.body].filter(Boolean).join(" ");
    await ctl.sb.openFacetSearch(words, glodaCap());
    return;
  }
  const id = ++analysisSeq;
  const hits = await messenger.searchBar.describeHits(res.rows, { ...state, group: false }, id);
  analyses.set(id, { id, text: text.trim(), hits });
  analysisBars.set(id, ctl.id);
  for (const old of [...analysisBars.keys()].slice(0, -20)) {
    analysisBars.delete(old);
  }
  for (const old of [...analyses.keys()].slice(0, -5)) {
    analyses.delete(old); // nur die letzten fünf behalten
  }
  await ctl.sb.openPage(messenger.runtime.getURL("analysis/analysis.html"));
}

// Nur "analysis:*" beantworten; alles andere (z. B. "novabird-db:*" für den Index) bleibt beim anderen Listener.
// Darum kein async-Listener: der gäbe für jede Nachricht ein Promise zurück und käme dem Index zuvor.
messenger.runtime.onMessage.addListener((msg, sender) => {
  if (sender.id !== messenger.runtime.id || !String(msg?.type ?? "").startsWith("analysis:")) {
    return undefined;
  }
  return handleAnalysisMessage(msg);
});
async function handleAnalysisMessage(msg) {
  if (msg?.type === "analysis:get") {
    // neueste noch nicht abgeholte Analyse (jede Seite holt genau eine)
    const open = [...analyses.entries()].filter(([, v]) => !v.claimed).pop();
    if (!open) {
      return { ok: false };
    }
    const a = open[1];
    a.claimed = true;
    analyses.delete(open[0]); // die Seite hat die Treffer jetzt; im Hintergrund bleibt nichts liegen
    return { ok: true, id: a.id, text: a.text, hits: a.hits, theme: await messenger.searchBar.themeVars(), mine: await messenger.searchBar.myAddresses() };
  }
  if (msg?.type === "analysis:recipients") {
    return messenger.searchBar.recipientsChunk(Number(msg.id), Number(msg.from), Number(msg.count));
  }
  if (msg?.type === "analysis:open-list") {
    // in dem Fenster öffnen, aus dem die Analyse kam (sonst in der zuletzt benutzten Leiste)
    const target = controllers.get(analysisBars.get(Number(msg.id))) || controllers.get(lastBarId);
    if (!target) {
      return { ok: false };
    }
    await target.sb.openHitsInTab(msg.items || [], msg.title || "");
    return { ok: true };
  }
  return undefined;
}

messenger.searchBar.onOpenSettings.addListener(() => {
  // Einstellungen → NovaBird (volle Breite, über NovaBird-Extension); ohne Extension die Seite in der Add-on-Verwaltung
  messenger.runtime.sendMessage("novabird-extension@novabird", { type: "openSettings" })
    .catch(() => messenger.runtime.openOptionsPage())
    .catch(e => console.error("NovaBird-Search: Einstellungen", e));
});

// ---- Suchhistorie ----------------------------------------------------------------------------------
// Bis zu 20 Suchen werden lokal gespeichert, die letzten 10 klappen unter dem leeren Suchfeld auf.
const HISTORY_KEY = "searchHistory";
const HISTORY_STORE = 20;
const HISTORY_SHOWN = 10;
async function readHistory() {
  const s = await messenger.storage.local.get({ [HISTORY_KEY]: [] });
  return Array.isArray(s[HISTORY_KEY]) ? s[HISTORY_KEY].filter(x => typeof x === "string") : [];
}
async function writeHistory(list) {
  await messenger.storage.local.set({ [HISTORY_KEY]: list.slice(0, HISTORY_STORE) });
  messenger.searchBar.setHistory(list.slice(0, HISTORY_SHOWN)).catch(() => {});
}
messenger.searchBar.onHistoryAdd.addListener(async text => {
  const t = String(text || "").trim();
  if (t.length < 3) {
    return;
  }
  const list = await readHistory();
  if (list[0]?.toLowerCase() === t.toLowerCase()) {
    return;
  }
  await writeHistory([t, ...list.filter(x => x.toLowerCase() !== t.toLowerCase())]);
});
messenger.searchBar.onHistoryRemove.addListener(async text => {
  await writeHistory((await readHistory()).filter(x => x !== text));
});
messenger.searchBar.onHistoryClear.addListener(async () => {
  await writeHistory([]);
});

// ---- Gemeinsame virtuelle Ordner und Wiedervorlage -------------------------------------------------
const FOLLOWUP_COLOR = "#e8890c";
const MENU_ID = "novabird-search-followup";
let followupKey = "";

// Rechtsklick auf Nachrichten: zur Wiedervorlage legen / wieder herausnehmen (Schlagwort „Wiedervorlage“)
async function setupFollowupMenu(enabled) {
  await messenger.menus.remove(MENU_ID).catch(() => {});
  if (!enabled || !followupKey) {
    return;
  }
  messenger.menus.create({
    id: MENU_ID,
    title: messenger.i18n.getMessage("menuFollowupAdd"),
    contexts: ["message_list"],
  });
}

messenger.menus.onShown.addListener(async info => {
  if (!followupKey || !info.menuIds.includes(MENU_ID)) {
    return;
  }
  const messages = info.selectedMessages?.messages ?? [];
  const allSet = messages.length > 0 && messages.every(m => m.tags?.includes(followupKey));
  await messenger.menus.update(MENU_ID, {
    title: messenger.i18n.getMessage(allSet ? "menuFollowupRemove" : "menuFollowupAdd"),
  });
  messenger.menus.refresh();
});

messenger.menus.onClicked.addListener(async info => {
  if (info.menuItemId !== MENU_ID || !followupKey) {
    return;
  }
  const messages = info.selectedMessages?.messages ?? [];
  const allSet = messages.length > 0 && messages.every(m => m.tags?.includes(followupKey));
  for (const message of messages) {
    const tags = new Set(message.tags ?? []);
    if (allSet) {
      tags.delete(followupKey);
    } else {
      tags.add(followupKey);
    }
    await messenger.messages.update(message.id, { tags: [...tags] });
  }
});

// Gemeinsame virtuelle Ordner (Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage) anlegen oder entfernen
async function syncSharedFolders() {
  messenger.searchBar.log(`syncSharedFolders, Option: ${settings.sharedFolders}`).catch(() => {});
  const names = {
    inbox: messenger.i18n.getMessage("sharedInbox"),
    unread: messenger.i18n.getMessage("sharedUnread"),
    followup: messenger.i18n.getMessage("sharedFollowup"),
  };
  try {
    if (settings.sharedFolders) {
      followupKey = await messenger.searchBar.ensureFollowupTag(names.followup, FOLLOWUP_COLOR);
      await messenger.searchBar.ensureSharedFolders(
        Object.entries(names).map(([kind, name]) => ({
          name,
          kind,
          tagKey: kind === "followup" ? followupKey : undefined,
          months: kind === "inbox" ? settings.sharedInboxMonths : undefined,
        }))
      );
    } else {
      await messenger.searchBar.removeSharedFolders(Object.values(names));
    }
    await setupFollowupMenu(settings.sharedFolders);
  } catch (e) {
    console.error("NovaBird-Search: gemeinsame Ordner", e);
    messenger.searchBar.log(`gemeinsame Ordner fehlgeschlagen: ${e}`).catch(() => {});
  }
}

async function loadSettings() {
  const stored = await messenger.storage.local.get(SETTINGS_KEY);
  settings = sanitizeSettings(stored[SETTINGS_KEY]);
}
messenger.storage.onChanged.addListener(changes => {
  if (changes[SETTINGS_KEY]) {
    const before = [settings.sharedFolders, settings.sharedInboxMonths];
    settings = sanitizeSettings(changes[SETTINGS_KEY].newValue);
    if (settings.sharedFolders !== before[0] || settings.sharedInboxMonths !== before[1]) {
      syncSharedFolders();
    }
  }
});

async function init() {
  await loadSettings();
  const strings = {};
  for (const key of [
    "placeholder", "scopeAll", "scopeFolder", "options", "optFrom", "optTo", "optSubject",
    "optBody", "optAttachment", "optUnread", "optTrash", "optSpam", "includeLabel", "busy", "clear", "openSettings", "rangeAll", "rangeToday", "range3", "range7", "range30", "suggest", "resultsTitle", "historyTitle", "historyClear", "historyRemove", "refinePlaceholder", "askTitle", "askFilter", "askAnalyze", "askRemember", "markAllRead",
  ]) {
    strings[key] = messenger.i18n.getMessage(key) || key;
  }
  await messenger.searchBar.setStrings(strings);
  // Filter und Optionen gelten nur für die laufende Sitzung: nach dem Start immer Standard (alter gespeicherter Zustand wird verworfen)
  await messenger.storage.local.remove(STATE_KEY).catch(() => {});
  messenger.searchBar.setHistory((await readHistory()).slice(0, HISTORY_SHOWN)).catch(() => {});
}
// Betterbird startet sonst im alten Suchordner (mit den Treffern der letzten Sitzung): zurück zum Posteingang.
async function leaveStaleSearchFolder() {
  const tabs = await messenger.mailTabs.query({});
  for (const tab of tabs) {
    const folder = tab.displayedFolder;
    if (folder?.isVirtual && folder.name === "Suchergebnisse") {
      const accounts = await messenger.accounts.list();
      for (const account of accounts) {
        const inbox = account.folders?.find(f => f.specialUse?.includes("inbox"));
        if (inbox) {
          ctl.ownChange = true;
          try {
            await messenger.mailTabs.update(tab.id, { displayedFolder: inbox.id });
          } finally {
            ctl.ownChange = false;
          }
          return;
        }
      }
    }
  }
}

// Umstieg von 1.x: Bis dahin waren Suchleiste (novabird-search@novabird) und Suchindex (dieses Add-on, früher NovaBird-DB) getrennt.
// Einstellungen und Suchverlauf der alten Suchleiste einmal übernehmen, das alte Add-on entfernen, dann die eigene Leiste starten.
async function migrateLegacySearch() {
  try {
    const old = await messenger.searchMigrate.legacy();
    if (old.installed) {
      const { migratedFromSearch } = await messenger.storage.local.get({ migratedFromSearch: false });
      if (!migratedFromSearch) {
        const data = await messenger.searchMigrate.readLegacyStorage([SETTINGS_KEY, HISTORY_KEY]).catch(e => {
          console.error("NovaBird-Search: alte Einstellungen nicht lesbar", e);
          return {};
        });
        const patch = { migratedFromSearch: true };
        if (data[SETTINGS_KEY]) {
          patch[SETTINGS_KEY] = sanitizeSettings(data[SETTINGS_KEY]);
        }
        if (Array.isArray(data[HISTORY_KEY])) {
          patch[HISTORY_KEY] = data[HISTORY_KEY];
        }
        await messenger.storage.local.set(patch);
      }
      await messenger.searchMigrate.removeLegacy();
      console.log(`NovaBird-Search: altes NovaBird-Search ${old.version} übernommen und entfernt`);
    }
  } catch (e) {
    console.error("NovaBird-Search: Umstieg von 1.x", e);
  }
  await messenger.searchBar.startUi();
}

migrateLegacySearch().then(init).then(syncSharedFolders).then(leaveStaleSearchFolder).catch(e => console.error("NovaBird-Search: Start fehlgeschlagen", e));

// Selbsttest der Betterbird-Interna (shared/selftest-bg.js); Ergebnis zeigt die Optionsseite
nbStartSelfTest([() => messenger.searchBar.selfTest()]);
