/* Regel-Assistent (Beta) – Teil der NovaBird-Extension, privilegiert.
 *  Liest und schreibt ECHTE Betterbird-Nachrichtenfilter (msgFilterRules.dat je Konto): Regeln laufen also auch ohne
 *  NovaBird weiter und bleiben unter Extras → Nachrichtenfilter bearbeitbar. Nur anfügen, nie bestehende Filter ändern;
 *  vor jedem Schreiben wird die Filterdatei gesichert (einmalig der Ursprungsstand, dazu immer der letzte Stand).
 *  Vorschau: dieselben Bedingungen in JS gegen die Kopfdaten der Posteingänge (kein Netz, keine Mailtexte).
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.mailRules = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");

// Bedingungen und Aktionen, die der Assistent anbietet (Rest bleibt Betterbirds Filterdialog vorbehalten)
const FIELDS = {
  from: () => Ci.nsMsgSearchAttrib.Sender,
  to: () => Ci.nsMsgSearchAttrib.ToOrCC,
  subject: () => Ci.nsMsgSearchAttrib.Subject,
};
const OPS = {
  contains: () => Ci.nsMsgSearchOp.Contains,
  is: () => Ci.nsMsgSearchOp.Is,
  beginsWith: () => Ci.nsMsgSearchOp.BeginsWith,
  endsWith: () => Ci.nsMsgSearchOp.EndsWith,
};
const ACTIONS = {
  move: () => Ci.nsMsgFilterAction.MoveToFolder,
  copy: () => Ci.nsMsgFilterAction.CopyToFolder,
  tag: () => Ci.nsMsgFilterAction.AddTag,
  read: () => Ci.nsMsgFilterAction.MarkRead,
  star: () => Ci.nsMsgFilterAction.MarkFlagged,
  delete: () => Ci.nsMsgFilterAction.Delete,
};
const PREVIEW_MAX_HEADERS = 200000; // je Aufruf höchstens so viele Kopfzeilen prüfen
const PREVIEW_MS = 4000;

const reverse = table => {
  const out = new Map();
  for (const [k, f] of Object.entries(table)) out.set(f(), k);
  return out;
};

function filterServers() {
  const out = [];
  for (const account of MailServices.accounts.accounts) {
    const server = account.incomingServer;
    if (!server || !server.canHaveFilters) continue;
    out.push({ account, server });
  }
  return out;
}

function accountByKey(key) {
  return filterServers().find(x => x.account.key === key) ?? null;
}

function inboxOf(server) {
  try {
    return server.rootFolder.getFolderWithFlags(Ci.nsMsgFolderFlags.Inbox);
  } catch (e) {
    return null;
  }
}

function folderPath(folder) {
  const parts = [];
  for (let f = folder; f && !f.isServer; f = f.parent) parts.unshift(f.localizedName ?? f.name);
  return parts.join(" / ");
}

// Sicherung vor dem Schreiben: <Datei>.nbx-original (nur beim ersten Mal) und <Datei>.nbx-last (jedes Mal)
function backupFilterFile(filterList) {
  const file = filterList.defaultFile;
  if (!file || !file.exists()) return;
  const dir = file.parent;
  const original = dir.clone();
  original.append(file.leafName + ".nbx-original");
  if (!original.exists()) file.copyTo(dir, original.leafName);
  const last = dir.clone();
  last.append(file.leafName + ".nbx-last");
  if (last.exists()) last.remove(false);
  file.copyTo(dir, last.leafName);
}

function validSpec(spec) {
  if (!spec || typeof spec !== "object") throw new Error("Regel fehlt");
  const terms = (spec.terms ?? []).filter(t => FIELDS[t.field] && OPS[t.op] && String(t.value ?? "").trim());
  if (!terms.length) throw new Error("keine gültige Bedingung");
  const actions = (spec.actions ?? []).filter(a => ACTIONS[a.type]);
  if (!actions.length) throw new Error("keine gültige Aktion");
  for (const a of actions) {
    if ((a.type === "move" || a.type === "copy") && !MailServices.folderLookup.getFolderForURL(a.folder ?? "")) throw new Error("Zielordner fehlt");
    if (a.type === "tag" && !MailServices.tags.isValidKey(a.tag ?? "")) throw new Error("Schlagwort fehlt");
  }
  if (actions.some(a => a.type === "delete") && actions.some(a => a.type === "move")) throw new Error("Löschen und Verschieben zugleich");
  return { ...spec, terms, actions, match: spec.match === "any" ? "any" : "all" };
}

function buildFilter(filterList, spec) {
  const filter = filterList.createFilter(String(spec.name || "NovaBird").slice(0, 200));
  filter.enabled = true;
  filter.filterType = (spec.onNew !== false ? Ci.nsMsgFilterType.InboxRule : 0) | Ci.nsMsgFilterType.Manual;
  for (const t of spec.terms) {
    const term = filter.createTerm();
    term.attrib = FIELDS[t.field]();
    term.op = OPS[t.op]();
    const value = term.value;
    value.attrib = term.attrib;
    value.str = String(t.value).trim();
    term.value = value;
    term.booleanAnd = spec.match !== "any";
    filter.appendTerm(term);
  }
  // Reihenfolge wie im Filterdialog: Markieren/Schlagwort vor Verschieben/Löschen
  const order = ["read", "star", "tag", "copy", "move", "delete"];
  for (const a of [...spec.actions].sort((x, y) => order.indexOf(x.type) - order.indexOf(y.type))) {
    const action = filter.createAction();
    action.type = ACTIONS[a.type]();
    if (a.type === "move" || a.type === "copy") action.targetFolderUri = a.folder;
    if (a.type === "tag") action.strValue = a.tag;
    filter.appendAction(action);
  }
  return filter;
}

// Vorschau: Bedingungen wie Betterbird (ohne Groß-/Kleinschreibung) gegen die Kopfdaten prüfen
function matcher(spec) {
  const tests = spec.terms.map(t => {
    const want = String(t.value).trim().toLowerCase();
    const cmp = {
      contains: v => v.includes(want),
      is: v => v === want,
      beginsWith: v => v.startsWith(want),
      endsWith: v => v.endsWith(want),
    }[t.op];
    return hdr => {
      let values;
      if (t.field === "from") values = [hdr.mime2DecodedAuthor || hdr.author];
      else if (t.field === "subject") values = [hdr.mime2DecodedSubject || hdr.subject];
      else values = [hdr.mime2DecodedRecipients || hdr.recipients, hdr.ccList];
      // Adressfelder: einzelne Adressen und der ganze Text (so trifft „ist“ auch eine reine Adresse)
      const all = [];
      for (const v of values) {
        if (!v) continue;
        all.push(v);
        if (t.field !== "subject") {
          try {
            for (const a of MailServices.headerParser.parseDecodedHeader(v)) {
              if (a.email) all.push(a.email);
            }
          } catch (e) { /* roh vergleichen */ }
        }
      }
      return all.some(v => cmp(String(v).toLowerCase()));
    };
  });
  return spec.match === "any" ? hdr => tests.some(f => f(hdr)) : hdr => tests.every(f => f(hdr));
}

function previewFolders(spec) {
  const out = [];
  for (const { account, server } of filterServers()) {
    if (spec.accounts !== "all" && !(spec.accounts ?? []).includes(account.key)) continue;
    const inbox = inboxOf(server);
    if (inbox) out.push(inbox);
  }
  return out;
}

function describeRule(filter, index, account) {
  const fields = reverse(FIELDS);
  const ops = reverse(OPS);
  const acts = reverse(ACTIONS);
  const terms = [];
  let simple = true;
  let match = "all";
  for (const term of filter.searchTerms) {
    const field = fields.get(term.attrib);
    const op = ops.get(term.op);
    if (!term.booleanAnd) match = "any";
    if (!field || !op) simple = false;
    terms.push({ field: field ?? "other", op: op ?? "other", value: field && op ? term.value.str : "", text: field && op ? "" : String(term.termAsString ?? "") });
  }
  const actions = [];
  for (let i = 0; i < filter.actionCount; i++) {
    const a = filter.getActionAt(i);
    const type = acts.get(a.type) ?? "other";
    if (type === "other") simple = false;
    const entry = { type };
    if (type === "move" || type === "copy") {
      entry.folder = a.targetFolderUri;
      const f = MailServices.folderLookup.getFolderForURL(a.targetFolderUri);
      entry.folderName = f ? folderPath(f) : a.targetFolderUri;
    }
    if (type === "tag") {
      entry.tag = a.strValue;
      try { entry.tagName = MailServices.tags.getTagForKey(a.strValue); } catch (e) { entry.tagName = a.strValue; }
    }
    actions.push(entry);
  }
  return {
    account: account.key,
    accountName: account.incomingServer.prettyName,
    index,
    name: filter.filterName,
    enabled: filter.enabled,
    onNew: !!(filter.filterType & Ci.nsMsgFilterType.InboxRule),
    manual: !!(filter.filterType & Ci.nsMsgFilterType.Manual),
    match,
    terms,
    actions,
    simple,
  };
}

function applyToInbox(server, filter) {
  return new Promise(resolve => {
    const inbox = inboxOf(server);
    if (!inbox) return resolve(false);
    const temp = MailServices.filters.getTempFilterList(inbox);
    temp.insertFilterAt(0, filter);
    const msgWindow = Cc["@mozilla.org/messenger/msgwindow;1"].createInstance(Ci.nsIMsgWindow);
    // ohne Rückmeldung nicht ewig warten (Verschieben läuft im Hintergrund weiter)
    const timer = Cc["@mozilla.org/timer;1"].createInstance(Ci.nsITimer);
    let done = false;
    const finish = ok => { if (!done) { done = true; timer.cancel(); resolve(ok); } };
    timer.initWithCallback({ notify: () => finish(true) }, 30000, Ci.nsITimer.TYPE_ONE_SHOT);
    try {
      MailServices.filters.applyFiltersToFolders(temp, [inbox], msgWindow, { onStopOperation: () => finish(true) });
    } catch (e) {
      console.error("Regel-Assistent: anwenden", e);
      finish(false);
    }
  });
}

const SELF_TEST = [
  {
    feature: "rules",
    needs: "none",
    test: () => !!MailServices.filters && typeof MailServices.filters.applyFiltersToFolders === "function" &&
      typeof MailServices.filters.getTempFilterList === "function" && !!Ci.nsMsgFilterType && !!Ci.nsMsgFilterAction &&
      filterServers().every(({ server }) => typeof server.rootFolder.getEditableFilterList === "function"),
  },
];

// Kontextmenü der Nachrichtenliste: „Regel aus dieser Mail erstellen…“ (nur wenn der Assistent eingeschaltet ist)
const { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
const LISTENER = "novabird-extension-rules";
const MENU_ID = "nbx-rule-from-message";
const menu = { enabled: false, label: "", started: false };
const fires = new Set();

function messageInfo(hdr) {
  const server = hdr.folder?.server;
  const account = server ? MailServices.accounts.findAccountForServer(server) : null;
  return {
    author: hdr.mime2DecodedAuthor || hdr.author || "",
    subject: hdr.mime2DecodedSubject || hdr.subject || "",
    recipients: hdr.mime2DecodedRecipients || hdr.recipients || "",
    account: account?.key ?? "",
    folder: hdr.folder?.URI ?? "",
  };
}

function hookPane(cw) {
  const doc = cw.document;
  const popup = doc.getElementById("mailContext");
  if (!popup || doc.getElementById(MENU_ID)) return;
  const item = doc.createXULElement("menuitem");
  item.id = MENU_ID;
  item.setAttribute("label", menu.label);
  item.addEventListener("command", () => {
    const hdr = cw.gDBView?.hdrForFirstSelectedMessage;
    if (!hdr) return;
    const info = messageInfo(hdr);
    for (const fire of fires) fire.async(info);
  });
  const onShow = event => {
    if (event.target !== popup) return;
    // nur bei genau einer gewählten Nachricht
    item.hidden = !menu.enabled || (cw.gDBView?.numSelected ?? 0) !== 1;
  };
  popup.addEventListener("popupshowing", onShow);
  const anchor = doc.getElementById("mailContext-tags");
  popup.insertBefore(item, anchor?.nextSibling ?? null);
  cw._nbxRules = { item, popup, onShow };
}

function unhookPane(cw) {
  const h = cw._nbxRules;
  if (!h) return;
  h.popup.removeEventListener("popupshowing", h.onShow);
  h.item.remove();
  delete cw._nbxRules;
}

function threePanes(win) {
  const out = [];
  for (const info of win.document.getElementById("tabmail")?.tabInfo ?? []) {
    const cw = info.chromeBrowser?.contentWindow;
    if (cw?.location?.href === "about:3pane" && cw.document.readyState === "complete") out.push(cw);
  }
  return out;
}

function scan(win, tries = 0) {
  let missing = false;
  for (const cw of threePanes(win)) {
    if (cw.document.getElementById("mailContext")) hookPane(cw);
    else missing = true;
  }
  if ((missing || !threePanes(win).length) && tries < 30) win.setTimeout(() => scan(win, tries + 1), 500);
}

function hookWindow(win) {
  const tm = win.document.getElementById("tabmail");
  if (!tm || win._nbxRulesWin) return;
  const onTab = () => win.setTimeout(() => scan(win), 300);
  win._nbxRulesWin = { tm, onTab };
  tm.tabContainer.addEventListener("TabOpen", onTab);
  scan(win);
}

function startMenu() {
  if (menu.started) return;
  menu.started = true;
  ExtensionSupport.registerWindowListener(LISTENER, {
    chromeURLs: ["chrome://messenger/content/messenger.xhtml"],
    onLoadWindow(win) { try { hookWindow(win); } catch (e) { console.error("Regel-Assistent:", e); } },
  });
}

function stopMenu() {
  if (!menu.started) return;
  menu.started = false;
  ExtensionSupport.unregisterWindowListener(LISTENER);
  for (const win of Services.wm.getEnumerator("mail:3pane")) {
    const h = win._nbxRulesWin;
    if (h) {
      h.tm.tabContainer.removeEventListener("TabOpen", h.onTab);
      delete win._nbxRulesWin;
    }
    for (const cw of threePanes(win)) unhookPane(cw);
  }
}

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) stopMenu();
  }
  getAPI(context) {
    return {
      mailRules: {
        // Assistent ein/aus (Opt-in); label = Text des Menüeintrags in der Sprache der Oberfläche
        async setEnabled(enabled, label) {
          menu.enabled = !!enabled;
          menu.label = String(label || "");
          if (!menu.enabled) return stopMenu();
          startMenu();
          for (const win of Services.wm.getEnumerator("mail:3pane")) {
            hookWindow(win);
            for (const cw of threePanes(win)) cw._nbxRules?.item.setAttribute("label", menu.label);
          }
        },
        onCreateFromMessage: new ExtensionCommon.EventManager({
          context,
          name: "mailRules.onCreateFromMessage",
          register: fire => {
            fires.add(fire);
            return () => fires.delete(fire);
          },
        }).api(),
        async selfTest() {
          const missing = [];
          for (const c of SELF_TEST) {
            try { if (!c.test()) missing.push(c.feature); } catch (e) { missing.push(c.feature); }
          }
          return { app: Services.appinfo.name, version: Services.appinfo.version, missing, pending: false };
        },
        async listAccounts() {
          return filterServers().map(({ account, server }) => ({ key: account.key, name: server.prettyName, type: server.type, hasInbox: !!inboxOf(server) }));
        },
        async listFolders() {
          const out = [];
          for (const account of MailServices.accounts.accounts) {
            const server = account.incomingServer;
            if (!server) continue;
            for (const f of server.rootFolder.descendants) {
              if (!f.canFileMessages || f.getFlag(Ci.nsMsgFolderFlags.Virtual)) continue;
              out.push({ uri: f.URI, name: f.localizedName ?? f.name, path: folderPath(f), account: account.key, accountName: server.prettyName,
                special: ["Inbox", "Trash", "Junk", "SentMail", "Drafts", "Templates", "Queue", "Archive"].filter(n => f.getFlag(Ci.nsMsgFolderFlags[n])) });
            }
          }
          return out;
        },
        async listTags() {
          return MailServices.tags.getAllTags().map(t => ({ key: t.key, name: t.tag, color: t.color }));
        },
        async listRules() {
          const out = [];
          for (const { account, server } of filterServers()) {
            let list;
            try { list = server.rootFolder.getEditableFilterList(null); } catch (e) { continue; }
            for (let i = 0; i < list.filterCount; i++) {
              try { out.push(describeRule(list.getFilterAt(i), i, account)); } catch (e) { /* unlesbarer Filter: auslassen */ }
            }
          }
          return out;
        },
        // spec als JSON: {terms:[{field,op,value}], match, accounts:"all"|[keys]}; Ergebnis {count, scanned, samples, partial}
        async preview(specJson, limit) {
          const spec = JSON.parse(specJson);
          spec.terms = (spec.terms ?? []).filter(t => FIELDS[t.field] && OPS[t.op] && String(t.value ?? "").trim());
          if (!spec.terms.length) return { count: 0, scanned: 0, samples: [], partial: false };
          const test = matcher(spec);
          const start = Date.now();
          const hits = [];
          let scanned = 0;
          let partial = false;
          for (const folder of previewFolders(spec)) {
            let db;
            // Ordner ohne aktuellen Index (noch nie geöffnet): nicht neu einlesen, nur melden
            try { db = folder.msgDatabase; } catch (e) { partial = true; continue; }
            for (const hdr of db.enumerateMessages()) {
              if (++scanned > PREVIEW_MAX_HEADERS || Date.now() - start > PREVIEW_MS) { partial = true; break; }
              if (test(hdr)) hits.push({ author: hdr.mime2DecodedAuthor, subject: hdr.mime2DecodedSubject, date: hdr.date / 1000, folder: folderPath(folder) });
            }
            if (partial) break;
          }
          hits.sort((a, b) => b.date - a.date);
          return { count: hits.length, scanned, samples: hits.slice(0, Math.max(0, Math.min(limit ?? 5, 20))), partial };
        },
        // spec als JSON (wie preview, dazu name, actions, onNew, applyNow); legt je Konto einen Filter am ENDE der Liste an
        async create(specJson) {
          const spec = validSpec(JSON.parse(specJson));
          const servers = filterServers().filter(({ account }) => spec.accounts === "all" || (spec.accounts ?? []).includes(account.key));
          if (!servers.length) throw new Error("kein Konto");
          const result = [];
          for (const { account, server } of servers) {
            const list = server.rootFolder.getEditableFilterList(null);
            backupFilterFile(list);
            const filter = buildFilter(list, spec);
            list.insertFilterAt(list.filterCount, filter);
            list.saveToDefaultFile();
            let applied = null;
            if (spec.applyNow) applied = await applyToInbox(server, filter);
            result.push({ account: account.key, accountName: server.prettyName, index: list.filterCount - 1, applied });
          }
          return result;
        },
      },
    };
  }
};

return API;
})();
