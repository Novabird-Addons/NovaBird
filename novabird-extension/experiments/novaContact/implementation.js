/* Nova-Contact im Kontakte-Tab (about:addressbook) – Teil der NovaBird-Extension, privilegiert.
 *  - Knopf „Nova-Contact“ unter der Adressbuchliste (öffnet pilot/ui/ui.html: Sammeln, Zusammenführen, Aufräumen)
 *  - Leiste über der Kontaktliste: Tags (Filter), Bearbeiten (Tags, Firma, Position für mehrere Kontakte), Rückgängig (letzte 3)
 *  - ein/aus per setEnabled; Protokoll (nur im Arbeitsspeicher) per setLog/getLog.
 * In einer IIFE gekapselt, weil alle Experimente dieses Add-ons einen globalen Scope teilen.
 */
"use strict";
this.novaContact = (() => {

const { ExtensionCommon } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
const { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");
const { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
const { AddrBookCard } = ChromeUtils.importESModule("resource:///modules/AddrBookCard.sys.mjs");
const { VCardProperties, VCardPropertyEntry } = ChromeUtils.importESModule("resource:///modules/VCardUtils.sys.mjs");

const LISTENER = "novabird-extension-contacts";
const MAIN_URL = "chrome://messenger/content/messenger.xhtml";
const NS = "http://www.w3.org/1999/xhtml";
const UNDO_MAX = 3;
const SNAP_MAX = 300;

function T(de, en, fr, es) {
  const lang = (Services.locale.appLocaleAsBCP47 || "en").slice(0, 2).toLowerCase();
  return ({ de, en, fr, es })[lang] ?? en;
}

const CSS = `
#kp-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; padding: 4px 6px; flex: none; }
#kp-bar .kp-grow { flex: 1; }
#kp-bar button { font-size: 0.92em; padding: 4px 6px; min-width: 0; white-space: nowrap; flex: 0 0 auto; overflow: visible; text-overflow: clip; }
.books-pane-bottom { flex-wrap: wrap; }
#kp-open { flex: 1 1 100%; justify-content: flex-start; white-space: nowrap; }
#kp-bar button[disabled] { opacity: .45; }
#kp-pop { position: fixed; z-index: 1000; min-width: 220px; max-width: 340px; max-height: 60vh; overflow: auto; padding: 4px;
  background: var(--layout-background-0, Canvas); color: var(--layout-color-1, CanvasText);
  border: 1px solid var(--layout-border-1, ThreeDShadow); border-radius: 8px; box-shadow: 0 4px 18px rgba(0,0,0,.25); }
#kp-pop[hidden] { display: none; }
#kp-pop button { display: flex; width: 100%; justify-content: space-between; gap: 12px; text-align: start; margin: 0; }
#kp-pop .kp-sub { opacity: .65; font-size: .9em; padding: 2px 8px; }
#kp-pop button.kp-on { font-weight: 600; }
#kp-dlg-back { position: fixed; inset: 0; z-index: 1100; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; }
#kp-dlg-back[hidden] { display: none; }
#kp-dlg { width: min(440px, 92vw); padding: 16px 18px; border-radius: 12px; display: flex; flex-direction: column; gap: 8px;
  background: var(--layout-background-0, Canvas); color: var(--layout-color-1, CanvasText); border: 1px solid var(--layout-border-1, ThreeDShadow); box-shadow: 0 8px 30px rgba(0,0,0,.35); }
#kp-dlg h2 { margin: 0 0 4px; font-size: 1.15em; }
#kp-dlg label { display: flex; flex-direction: column; gap: 3px; font-size: .92em; }
#kp-dlg .kp-clear { flex-direction: row; align-items: center; gap: 6px; opacity: .8; }
#kp-dlg input[type=text] { padding: 5px 8px; }
search-bar[kp-chip] { -webkit-text-fill-color: transparent; }
#kp-chip { display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px; border-radius: 999px; font-size: .92em; background: color-mix(in srgb, var(--selected-item-color, Highlight) 18%, transparent); border: 1px solid color-mix(in srgb, var(--selected-item-color, Highlight) 45%, transparent); }
#kp-chip[hidden] { display: none; }
#kp-chip .kp-chip-x { border: 0; background: none; padding: 0 4px; cursor: pointer; color: inherit; font: inherit; opacity: .7; }
#kp-chip .kp-chip-x:hover { opacity: 1; }
.kp-sync-note { font-size: .82em; margin-top: 4px; color: color-mix(in srgb, currentColor 60%, transparent); }
#kp-dlg .kp-hint { padding: 6px 9px; border-radius: 6px; font-size: .88em; line-height: 1.4; background: color-mix(in srgb, var(--layout-color-1, CanvasText) 10%, transparent); }
#kp-dlg .kp-note { opacity: .7; font-size: .88em; }
#kp-dlg .kp-btns { display: flex; justify-content: flex-end; gap: 8px; margin-top: 6px; }
`;

const undoStack = [];
const snaps = new Map(); // UID -> { dirUID, vcard }
let suppress = 0;
let pilotUrl = null;
let started = false;
let logOn = false;
const logEntries = [];
function plog(text) {
  if (!logOn) return;
  logEntries.push({ ts: Date.now(), text });
  if (logEntries.length > 300) logEntries.shift();
}
const prepared = new WeakSet();

function openPilot() {
  if (!pilotUrl) return;
  plog("Nova-Contact geöffnet");
  const win = Services.wm.getMostRecentWindow("mail:3pane");
  const tm = win?.document.getElementById("tabmail");
  if (!tm) return;
  const open = tm.tabInfo.find(i => i.browser?.currentURI?.spec === pilotUrl);
  if (open) tm.switchToTab(open);
  else tm.openTab("contentTab", { url: pilotUrl });
}

const el = (doc, tag, props, ...kids) => {
  const e = doc.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k in e && k !== "list") e[k] = v;
    else e.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid);
  return e;
};

/* ---------- Kontakt-Hilfen ---------- */
function dirOf(card) {
  try { return MailServices.ab.getDirectoryFromUID(card.directoryUID); } catch { return null; }
}
function nameOf(card) {
  return card.displayName || card.primaryEmail || card.vCardProperties?.getFirstValue("fn") || "?";
}
/* Online-Adressbücher (Google, CardDAV) verwerfen vCard-Kategorien: Tags liegen dort nur lokal (Profildatei), nicht im Kontakt. */
const LOCAL_DIR_TYPE = 101;
const tagStore = new Map(); // "<dirUID>|<UID>" -> [Tags]
let tagStoreFile = null;
function storeKey(card) { return card.directoryUID + "|" + card.UID; }
function isStoreCard(card) { const d = dirOf(card); return !!d && d.dirType !== LOCAL_DIR_TYPE; }
async function loadTagStore() {
  try {
    tagStoreFile = PathUtils.join(PathUtils.profileDir, "novabird-extension-tags.json");
    tagStore.clear();
    if (await IOUtils.exists(tagStoreFile)) for (const [k, v] of Object.entries(await IOUtils.readJSON(tagStoreFile))) tagStore.set(k, v);
  } catch (e) { console.error("Nova-Contact Tag-Speicher:", e); }
}
function saveTagStore() {
  if (!tagStoreFile) return;
  IOUtils.writeJSON(tagStoreFile, Object.fromEntries(tagStore)).catch(e => console.error("Nova-Contact Tag-Speicher:", e));
}
function vcardTags(card) {
  const v = card.vCardProperties?.getFirstValue("categories");
  const arr = Array.isArray(v) ? v : v ? [v] : [];
  return arr.map(s => String(s).trim()).filter(Boolean);
}
function tagsOf(card) {
  const own = vcardTags(card);
  if (!isStoreCard(card)) return own;
  const all = [...(tagStore.get(storeKey(card)) || [])];
  for (const t of own) if (!all.some(a => a.toLowerCase() === t.toLowerCase())) all.push(t);
  return all;
}
function setTags(card, tags) {
  const vp = card.vCardProperties;
  for (const e of vp.getAllEntries("categories")) vp.removeEntry(e);
  if (isStoreCard(card)) {
    if (tags.length) tagStore.set(storeKey(card), tags); else tagStore.delete(storeKey(card));
    saveTagStore();
    return;
  }
  if (tags.length) vp.addEntry(new VCardPropertyEntry("categories", {}, "text", tags));
}
function setFirst(card, name, mapValue) {
  const vp = card.vCardProperties;
  const old = vp.getFirstEntry(name);
  const next = mapValue(old ? old.value : undefined);
  if (old) vp.removeEntry(old);
  if (next !== null) vp.addEntry(new VCardPropertyEntry(name, old ? old.params : {}, "text", next));
}
function cardFromVCard(vcard, uid, dirUID) {
  const c = new AddrBookCard();
  c.setProperty("_vCard", vcard);
  c.UID = uid;
  c.directoryUID = dirUID;
  return c;
}
function snapshot(card) {
  try {
    if (card.isMailList) return;
    snaps.set(card.UID, { dirUID: card.directoryUID, vcard: card.vCardProperties.toVCard() });
    if (snaps.size > SNAP_MAX) snaps.delete(snaps.keys().next().value);
  } catch (e) { /* Karte ohne vCard */ }
}
function allTags() {
  const counts = new Map();
  for (const dir of MailServices.ab.directories) {
    if (dir.isRemote) continue;
    for (const card of dir.childCards) {
      if (card.isMailList) continue;
      for (const t of tagsOf(card)) counts.set(t, (counts.get(t) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

/* ---------- Rückgängig ---------- */
function pushUndo(kind, label, item) {
  const now = Date.now();
  const top = undoStack[0];
  if (top && top.kind === kind && now - top.ts < 800 && !item.single) {
    top.items.push(item); top.ts = now; top.label = top.items.length + " " + T("Kontakte", "contacts", "contacts", "contactos") + ": " + top.what;
  } else {
    undoStack.unshift({ kind, ts: now, what: label, label, items: [item] });
    if (undoStack.length > UNDO_MAX) undoStack.length = UNDO_MAX;
  }
  refreshAll();
}
function pushBulk(label, items) {
  undoStack.unshift({ kind: "bulk", ts: Date.now(), what: label, label, items });
  if (undoStack.length > UNDO_MAX) undoStack.length = UNDO_MAX;
  refreshAll();
}
function undoEntry(index) {
  const entry = undoStack[index];
  if (!entry) return;
  suppress++;
  try {
    for (const it of entry.items) {
      if (it.tagKey) {
        if (it.tagsBefore.length) tagStore.set(it.tagKey, it.tagsBefore); else tagStore.delete(it.tagKey);
        saveTagStore();
        if (!it.vcard) continue;
      }
      const dir = MailServices.ab.getDirectoryFromUID(it.dirUID);
      if (!dir) continue;
      const card = cardFromVCard(it.vcard, it.uid, it.dirUID);
      if (it.deleted) dir.addCard(card);
      else dir.modifyCard(card);
      snapshot(card);
    }
  } catch (e) {
    console.error("Nova-Contact Rückgängig:", e);
  } finally {
    // Benachrichtigungen kommen asynchron – Sperre erst danach lösen
    Services.tm.dispatchToMainThread(() => { suppress--; });
  }
  plog("Rückgängig: " + entry.label + " (" + entry.items.length + ")");
  undoStack.splice(index, 1);
  refreshAll();
}

const observer = {
  observe(subject, topic, data) {
    if (suppress) return;
    try {
      const card = subject.QueryInterface(Ci.nsIAbCard);
      if (card.isMailList) return;
      const old = snaps.get(card.UID);
      if (topic === "addrbook-contact-updated") {
        const now = card.vCardProperties.toVCard();
        if (old && old.vcard !== now) {
          pushUndo("edit", T("Geändert: ", "Changed: ", "Modifié : ", "Cambiado: ") + nameOf(card), { dirUID: data, uid: card.UID, vcard: old.vcard, single: true });
        }
        snapshot(card);
      } else if (topic === "addrbook-contact-deleted") {
        const vcard = old ? old.vcard : card.vCardProperties.toVCard();
        pushUndo("delete", T("Gelöscht: ", "Deleted: ", "Supprimé : ", "Eliminado: ") + nameOf(card), { dirUID: data, uid: card.UID, vcard, deleted: true });
        snaps.delete(card.UID);
      }
    } catch (e) { console.error("Nova-Contact:", e); }
  },
};

/* ---------- Oberfläche je Kontakte-Tab ---------- */
const views = new Set(); // { cw, doc, refresh }
function refreshAll() {
  for (const v of views) { try { v.refresh(); } catch (e) { views.delete(v); } }
}

/* Detailansicht des Kontakts (about:addressbook): Betterbird zeigt dort nur vCard-CATEGORIES unter „Kategorien“.
   Hier heißt der Block „Tags“ und zeigt bei Online-Adressbüchern auch die lokal gespeicherten Tags mit Hinweis. */
function fixCategories(doc, card) {
  const sec = doc.querySelector("#viewContact .details-categories");
  if (!sec || !card) return;
  const h = sec.querySelector("h2"), p = sec.querySelector("p");
  if (!h || !p) return;
  h.removeAttribute("data-l10n-id");
  h.textContent = T("Tags", "Tags", "Tags", "Etiquetas");
  sec.querySelector(".kp-sync-note")?.remove();
  if (!isStoreCard(card)) return;
  const tags = tagsOf(card);
  p.textContent = tags.join(", ");
  sec.hidden = !tags.length;
  if (tags.length) {
    sec.append(el(doc, "div", { class: "kp-sync-note" },
      T("Nur auf diesem Rechner gespeichert, wird nicht synchronisiert.", "Stored only on this computer, not synchronised.",
        "Enregistré uniquement sur cet ordinateur, non synchronisé.", "Guardado solo en este equipo, no se sincroniza.")));
  }
}
function hookDetails(view) {
  const dp = view.cw.detailsPane;
  if (!dp || typeof dp.displayContact !== "function" || view.origDisplay) return;
  view.origDisplay = dp.displayContact;
  dp.displayContact = function (card, ...rest) {
    const r = view.origDisplay.call(this, card, ...rest);
    try { fixCategories(view.doc, this.currentCard); } catch (e) { console.error("Nova-Contact Details:", e); }
    return r;
  };
}
function unhookDetails(view) {
  try { if (view.origDisplay) view.cw.detailsPane.displayContact = view.origDisplay; } catch (e) { /* Tab geschlossen */ }
  view.doc.querySelector("#viewContact .details-categories h2")?.setAttribute("data-l10n-id", "about-addressbook-details-categories-header");
  view.doc.querySelector(".kp-sync-note")?.remove();
}

function build(cw) {
  const doc = cw.document;
  if (doc.getElementById("kp-bar")) return;
  const cards = cw.cardsPane;
  const style = el(doc, "style", { id: "kp-style" }); style.textContent = CSS;
  doc.documentElement.append(style);

  const pop = el(doc, "div", { id: "kp-pop", hidden: true });
  const closePop = () => { pop.hidden = true; };
  const openPop = (anchor, content) => {
    pop.replaceChildren(...content);
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    pop.style.left = Math.max(4, Math.min(r.left, doc.documentElement.clientWidth - 240)) + "px";
    pop.style.top = r.bottom + 4 + "px";
  };
  doc.addEventListener("mousedown", e => { if (!pop.hidden && !pop.contains(e.target) && !e.target.closest?.("#kp-bar")) closePop(); }, true);
  doc.addEventListener("keydown", e => { if (e.key === "Escape") { closePop(); closeDialog(); } }, true);

  /* Aktiver Tag-Filter als Chip (statt Text im Suchfeld) */
  let activeTag = "";
  const chipLabel = el(doc, "span", {});
  const chip = el(doc, "span", { id: "kp-chip", hidden: true }, "🏷 ", chipLabel,
    el(doc, "button", { class: "kp-chip-x", type: "button", title: T("Filter aufheben", "Clear filter", "Supprimer le filtre", "Quitar filtro"), onclick: () => applyFilter("") }, "✕"));
  const syncChip = () => {
    chip.hidden = !activeTag;
    chipLabel.textContent = activeTag;
    if (activeTag) cards.searchInput.setAttribute("kp-chip", ""); else cards.searchInput.removeAttribute("kp-chip");
  };
  // Eigene Eingabe im Suchfeld ersetzt den Tag-Filter
  cards.searchInput.addEventListener("focusin", () => { if (activeTag) applyFilter(""); });
  cards.searchInput.addEventListener("search", () => {
    if (activeTag && (cards.searchInput.value || "").trim().toLowerCase() !== activeTag.toLowerCase()) { activeTag = ""; syncChip(); }
  });

  /* Tags-Auswahl */
  const btnTags = el(doc, "button", { class: "button button-flat", type: "button", onclick: () => {
    const tags = allTags();
    const cur = activeTag.toLowerCase();
    const items = [];
    if (cur) items.push(el(doc, "button", { class: "button button-flat", type: "button", onclick: () => { applyFilter(""); } }, T("Filter aufheben", "Clear filter", "Supprimer le filtre", "Quitar filtro")));
    if (!tags.length) items.push(el(doc, "div", { class: "kp-sub" }, T("Noch keine Tags vergeben.", "No tags yet.", "Aucun tag.", "Aún no hay etiquetas.")));
    for (const [t, n] of tags) {
      items.push(el(doc, "button", { class: "button button-flat" + (cur === t.toLowerCase() ? " kp-on" : ""), type: "button", onclick: () => applyFilter(t) }, el(doc, "span", {}, t), el(doc, "span", { class: "kp-sub" }, String(n))));
    }
    openPop(btnTags, items);
  } }, "🏷 ", T("Tags", "Tags", "Tags", "Etiquetas"), " ▾");
  function applyFilter(t) {
    closePop();
    const si = cards.searchInput;
    si.blur();
    activeTag = t || "";
    syncChip();
    if (t) si.overrideSearchTerm(t); else si.reset();
    if (t) cw.setTimeout(() => addStoredMatches(t), 400);
  }
  /* Kontakte aus Online-Adressbüchern, deren Tag nur lokal gespeichert ist, zur gefilterten Liste hinzufügen */
  function addStoredMatches(t) {
    try {
      const view = cards.cardsList.view, want = t.toLowerCase();
      const cur = (cards.searchInput.value || "").trim().toLowerCase();
      if (cur !== want) return;
      const bl = cw.booksList, row = bl && [...bl.querySelectorAll("li")][bl.selectedIndex];
      const shown = MailServices.ab.directories.find(d => d.UID === row?.dataset?.uid) || null; // null = alle Adressbücher
      for (const dir of MailServices.ab.directories) {
        if (dir.dirType === LOCAL_DIR_TYPE || dir.isRemote) continue;
        if (shown && shown.UID !== dir.UID) continue;
        for (const card of dir.childCards) {
          if (card.isMailList || !tagStore.get(storeKey(card))?.some(x => x.toLowerCase() === want)) continue;
          if (view.getIndexForUID(card.UID) < 0) view.onSearchFoundCard(card);
        }
      }
    } catch (e) { console.error("Nova-Contact Filter:", e); }
  }

  /* Auswahl bearbeiten */
  const btnEdit = el(doc, "button", { class: "button button-flat", type: "button", onclick: () => openDialog() });
  /* Rückgängig */
  const btnUndo = el(doc, "button", { class: "button button-flat", type: "button", onclick: () => {
    if (!undoStack.length) return;
    openPop(btnUndo, [
      el(doc, "div", { class: "kp-sub" }, T("Änderung rückgängig machen:", "Undo change:", "Annuler la modification :", "Deshacer cambio:")),
      ...undoStack.map((u, i) => el(doc, "button", { class: "button button-flat", type: "button", onclick: () => { closePop(); undoEntry(i); } },
        el(doc, "span", {}, u.label), el(doc, "span", { class: "kp-sub" }, new Date(u.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })))),
    ]);
  } });
  const bar = el(doc, "div", { id: "kp-bar" }, btnTags, chip, btnEdit, el(doc, "span", { class: "kp-grow" }), btnUndo);
  doc.getElementById("cardsPaneHeader").after(bar);
  doc.body.append(pop);

  /* Knopf unter der Adressbuchliste */
  const bottom = doc.querySelector(".books-pane-bottom");
  if (bottom && !doc.getElementById("kp-open")) {
    const open = el(doc, "button", { id: "kp-open", class: "button button-flat icon-button", type: "button", title: T("Kontakte sammeln und zusammenführen", "Collect and merge contacts", "Collecter et fusionner les contacts", "Recoger y fusionar contactos"),
      onclick: () => openPilot() }, "✦ Nova-Contact");
    bottom.prepend(open);
  }

  /* Dialog */
  const back = el(doc, "div", { id: "kp-dlg-back", hidden: true });
  doc.body.append(back);
  function closeDialog() { back.hidden = true; back.replaceChildren(); }
  function selection() {
    const list = cards.selectedCards.filter(c => c && !c.isMailList);
    return list.filter(c => { const d = dirOf(c); return d && !d.readOnly; });
  }
  function openDialog() {
    const sel = selection();
    if (!sel.length) return;
    closePop();
    const inTags = el(doc, "input", { type: "text", placeholder: "Kunde, Privat", list: "kp-taglist" });
    const dl = el(doc, "datalist", { id: "kp-taglist" }, allTags().map(([t]) => el(doc, "option", { value: t })));
    const outTags = el(doc, "input", { type: "text", list: "kp-taglist" });
    const org = el(doc, "input", { type: "text" });
    const orgClr = el(doc, "input", { type: "checkbox" });
    const title = el(doc, "input", { type: "text" });
    const titleClr = el(doc, "input", { type: "checkbox" });
    const note = el(doc, "div", { class: "kp-note" }, T("Leere Felder bleiben unverändert. Mehrere Tags mit Komma trennen.", "Empty fields stay unchanged. Separate several tags with commas.", "Les champs vides restent inchangés. Séparez les tags par des virgules.", "Los campos vacíos no se modifican. Separe las etiquetas con comas."));
    const hint = sel.some(isStoreCard) ? el(doc, "div", { class: "kp-hint" }, "🖥 ",
      T("Für Online-Adressbücher (Google, CardDAV) werden Tags nur auf diesem Rechner gespeichert und nicht mit dem Server abgeglichen.",
        "For online address books (Google, CardDAV), tags are stored only on this computer and are not synced to the server.",
        "Pour les carnets d’adresses en ligne (Google, CardDAV), les tags sont enregistrés uniquement sur cet ordinateur et ne sont pas synchronisés avec le serveur.",
        "En las libretas de direcciones en línea (Google, CardDAV), las etiquetas se guardan solo en este equipo y no se sincronizan con el servidor.")) : null;
    const split = s => s.split(",").map(x => x.trim()).filter(Boolean);
    const apply = el(doc, "button", { class: "button button-primary", type: "button", onclick: () => {
      const add = split(inTags.value), rem = split(outTags.value).map(x => x.toLowerCase());
      const o = org.value.trim(), ti = title.value.trim();
      const items = [];
      suppress++;
      try {
        for (const card of sel) {
          const before = card.vCardProperties.toVCard();
          const tagsBefore = tagsOf(card);
          let tags = [...tagsBefore];
          const t0 = tags.join("\n");
          tags = tags.filter(t => !rem.includes(t.toLowerCase()));
          for (const a of add) if (!tags.some(t => t.toLowerCase() === a.toLowerCase())) tags.push(a);
          if (tags.join("\n") !== t0) setTags(card, tags);
          if (o || orgClr.checked) setFirst(card, "org", old => orgClr.checked ? null : [o, ...(Array.isArray(old) ? old.slice(1) : [])]);
          if (ti || titleClr.checked) setFirst(card, "title", () => titleClr.checked ? null : ti);
          const tagsChanged = tagsOf(card).join("\n") !== tagsBefore.join("\n");
          const store = isStoreCard(card);
          const vcardChanged = card.vCardProperties.toVCard() !== before;
          if (vcardChanged) {
            dirOf(card).modifyCard(card);
            snapshot(card);
          }
          if (vcardChanged || (store && tagsChanged)) {
            items.push({ dirUID: card.directoryUID, uid: card.UID, vcard: vcardChanged ? before : null, ...(store ? { tagKey: storeKey(card), tagsBefore } : {}) });
          }
        }
      } catch (e) {
        console.error("Nova-Contact Mehrfachbearbeitung:", e);
      } finally {
        Services.tm.dispatchToMainThread(() => { suppress--; });
      }
      plog("Mehrfachbearbeitung: " + items.length + " Kontakte geändert");
      if (items.length) pushBulk(items.length + " " + T("Kontakte bearbeitet", "contacts edited", "contacts modifiés", "contactos editados"), items);
      closeDialog();
    } }, T("Übernehmen", "Apply", "Appliquer", "Aplicar"));
    back.replaceChildren(el(doc, "div", { id: "kp-dlg" },
      el(doc, "h2", {}, sel.length === 1
        ? T("Kontakt bearbeiten: ", "Edit contact: ", "Modifier le contact : ", "Editar contacto: ") + nameOf(sel[0])
        : sel.length + " " + T("Kontakte bearbeiten", "contacts: edit", "contacts : modifier", "contactos: editar")),
      el(doc, "label", {}, T("Tags hinzufügen", "Add tags", "Ajouter des tags", "Añadir etiquetas"), inTags),
      el(doc, "label", {}, T("Tags entfernen", "Remove tags", "Retirer des tags", "Quitar etiquetas"), outTags),
      el(doc, "label", {}, T("Firma setzen", "Set company", "Définir la société", "Establecer empresa"), org),
      el(doc, "label", { class: "kp-clear" }, orgClr, T("Firma leeren", "Clear company", "Vider la société", "Vaciar empresa")),
      el(doc, "label", {}, T("Position setzen", "Set job title", "Définir la fonction", "Establecer cargo"), title),
      el(doc, "label", { class: "kp-clear" }, titleClr, T("Position leeren", "Clear job title", "Vider la fonction", "Vaciar cargo")),
      hint, note, dl,
      el(doc, "div", { class: "kp-btns" },
        el(doc, "button", { class: "button", type: "button", onclick: closeDialog }, T("Abbrechen", "Cancel", "Annuler", "Cancelar")), apply)));
    back.hidden = false;
    inTags.focus();
  }

  const refresh = () => {
    try { const cur = cw.detailsPane?.currentCard; if (cur) fixCategories(doc, cur); } catch (e) { /* ohne Detailansicht */ }
    const n = selection().length;
    btnEdit.disabled = n === 0;
    btnEdit.replaceChildren("✎ ", T("Bearbeiten", "Edit", "Modifier", "Editar") + (n > 1 ? " (" + n + ")" : ""));
    btnEdit.title = T("Tags, Firma und Position für alle gewählten Kontakte ändern", "Change tags, company and job title for all selected contacts", "Modifier tags, société et fonction des contacts sélectionnés", "Cambiar etiquetas, empresa y cargo de los contactos seleccionados");
    btnUndo.disabled = !undoStack.length;
    btnUndo.replaceChildren("↶ ", T("Rückgängig", "Undo", "Annuler", "Deshacer"), undoStack.length ? " (" + undoStack.length + ")" : "");
  };
  const view = { cw, doc, refresh, bar, style, pop, back };
  views.add(view);
  hookDetails(view);
  { const cur = cw.detailsPane?.currentCard; if (cur) fixCategories(doc, cur); }
  cards.cardsList.addEventListener("select", () => {
    for (const c of cards.selectedCards.slice(0, 60)) if (c) snapshot(c);
    refresh();
  });
  refresh();
}

function unbuild(view) {
  view.cw.document.getElementById("searchInput")?.removeAttribute("kp-chip");
  unhookDetails(view);
  view.bar.remove(); view.style.remove(); view.pop.remove(); view.back.remove();
  view.doc.getElementById("kp-open")?.remove();
  views.delete(view);
}

function scan(win) {
  const tm = win.document.getElementById("tabmail");
  if (!tm) return;
  for (const info of tm.tabInfo) {
    const b = info.browser;
    if (!b || b.currentURI?.spec !== "about:addressbook") continue;
    let tries = 0;
    const attempt = () => {
      const cw = b.contentWindow;
      try {
        if (cw && cw.document.readyState === "complete" && cw.cardsPane?.cardsList && cw.document.getElementById("cardsPaneHeader")) {
          build(cw);
          return;
        }
      } catch (e) { /* noch nicht bereit */ }
      if (++tries < 40) win.setTimeout(attempt, 250);
    };
    attempt();
  }
}

function hookWindow(win) {
  const tm = win.document.getElementById("tabmail");
  if (!tm || prepared.has(win)) return;
  prepared.add(win);
  const onTab = () => win.setTimeout(() => scan(win), 300);
  tm.tabContainer.addEventListener("TabOpen", onTab);
  tm.tabContainer.addEventListener("TabSelect", onTab);
  win._kpUnhook = () => { tm.tabContainer.removeEventListener("TabOpen", onTab); tm.tabContainer.removeEventListener("TabSelect", onTab); };
  scan(win);
}

const API = class extends ExtensionCommon.ExtensionAPI {
  onShutdown(isAppShutdown) {
    if (!isAppShutdown) stopAll();
  }

  getAPI() {
    pilotUrl = this.extension.getURL("pilot/ui/ui.html");
    return {
      novaContact: {
        async setEnabled(on) { if (on) startAll(); else stopAll(); },
        async setLog(on) { logOn = !!on; if (logOn) plog("Protokoll eingeschaltet"); },
        async getLog() { return logEntries.slice(); },
        async clearLog() { logEntries.length = 0; },
        async log(text) { plog(String(text)); },
      },
    };
  }
};

function startAll() {
  if (started) return;
  started = true;
  loadTagStore();
  Services.obs.addObserver(observer, "addrbook-contact-updated");
  Services.obs.addObserver(observer, "addrbook-contact-deleted");
  ExtensionSupport.registerWindowListener(LISTENER, {
    chromeURLs: [MAIN_URL],
    onLoadWindow(win) { try { hookWindow(win); } catch (e) { console.error("Nova-Contact:", e); } },
  });
}

function stopAll() {
  if (!started) return;
  started = false;
  ExtensionSupport.unregisterWindowListener(LISTENER);
  Services.obs.removeObserver(observer, "addrbook-contact-updated");
  Services.obs.removeObserver(observer, "addrbook-contact-deleted");
  for (const v of [...views]) unbuild(v);
  for (const win of Services.wm.getEnumerator("mail:3pane")) { win._kpUnhook?.(); prepared.delete(win); }
}

return API;
})();
