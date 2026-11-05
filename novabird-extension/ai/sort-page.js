/* KI-Einsortieren (Beta): Regeln anlegen, Vorschläge des Probelaufs annehmen oder verwerfen, Protokoll mit Rückgängig.
 * Regeln speichert die Seite selbst (storage.local aiSortRules); alles andere macht der Hintergrund (ai/sort.js, Nachricht „nbx-sort“). */
"use strict";

const TEXTS = {
  de: {
    title: "KI-Einsortieren", beta: "Beta",
    intro: "Beschreibe in eigenen Worten, welche Mails in welchen Ordner gehören. Die KI ordnet jede neue Mail im Posteingang höchstens einer Regel zu – oder keiner, dann bleibt sie liegen. Jede neue Mail geht dafür an die KI aus Einstellungen → KI.",
    aiOff: "Die KI ist ausgeschaltet (Einstellungen → KI) – solange wird nichts einsortiert.",
    rulesTitle: "Regeln", rulesHelp: "Am besten zuerst im Probelauf: Dann siehst du unten nur Vorschläge und entscheidest selbst. Passt es, stelle die Regel auf „Automatisch verschieben“.",
    noRules: "Noch keine Regel.", add: "Regel hinzufügen",
    folderL: "Zielordner", descL: "Was gehört hinein?", descPh: "z. B. Rechnungen, Zahlungsbelege und Mahnungen von Firmen und Shops",
    scopeL: "Gilt für", scopeAccount: "Posteingang dieses Kontos", scopeAll: "Alle Posteingänge",
    modeL: "Modus", modeOff: "Aus", modeDry: "Probelauf (nur vorschlagen)", modeAuto: "Automatisch verschieben",
    stats: "$1 übernommen, $2 verworfen, $3 offen", statsMoved: ", $1 automatisch verschoben", remove: "Regel löschen", removeAsk: "Diese Regel löschen?",
    noDesc: "Ohne Beschreibung ist die Regel nicht aktiv.",
    sugTitle: "Vorschläge", sugHelp: "Aus dem Probelauf und aus „Vorhandene Mails prüfen“. „Ja“ verschiebt die Mail jetzt, „Nein“ lässt sie liegen.",
    sugNone: "Keine offenen Vorschläge.", yes: "Ja", no: "Nein", sugAll: "Alle übernehmen", sugNoAll: "Alle verwerfen", sugAllAsk: "$1 Mails jetzt verschieben?",
    scanTitle: "Vorhandene Mails prüfen", scanHelp: "Prüft die Mails, die schon in den Posteingängen liegen (höchstens 300), mit allen eingeschalteten Regeln. Ergibt nur Vorschläge, es wird nichts verschoben. Dauert je Mail etwa so lange wie eine kurze Zusammenfassung.",
    scanDaysL: "Zeitraum:", d7: "letzte 7 Tage", d30: "letzte 30 Tage", d90: "letzte 90 Tage", scanStart: "Jetzt prüfen", scanStop: "Anhalten",
    scanRun: "$1 von $2 geprüft, $3 Vorschläge …", scanDone: "Fertig: $1 Mails geprüft, $2 Vorschläge.", scanErr: "Abgebrochen: die KI ist nicht erreichbar oder nicht eingerichtet ($1).",
    scanNoRules: "Erst eine Regel mit Beschreibung anlegen und einschalten.", scanBusy: "Es läuft schon eine Prüfung.",
    logTitle: "Protokoll", logHelp: "Was verschoben wurde (30 Tage). „Rückgängig“ holt die Mail in ihren Posteingang zurück.",
    logNone: "Noch nichts verschoben.", undo: "Rückgängig", logClear: "Protokoll leeren",
    stMoved: "verschoben", stUndone: "zurückgeholt", stDismissed: "verworfen", stFailed: "fehlgeschlagen", stMoving: "wird verschoben",
    errNotFound: "Mail nicht mehr gefunden (schon verschoben oder gelöscht?)", errAct: "Hat nicht geklappt: $1",
  },
  en: {
    title: "AI sorting", beta: "Beta",
    intro: "Describe in your own words which mails belong in which folder. The AI assigns each new mail in the inbox to at most one rule – or to none, then it stays. For this, every new mail is sent to the AI from Settings → AI.",
    aiOff: "The AI is switched off (Settings → AI) – nothing is sorted until then.",
    rulesTitle: "Rules", rulesHelp: "Best start with a trial run: below you then only see suggestions and decide yourself. If it fits, set the rule to “Move automatically”.",
    noRules: "No rule yet.", add: "Add rule",
    folderL: "Target folder", descL: "What belongs in it?", descPh: "e.g. invoices, payment receipts and reminders from companies and shops",
    scopeL: "Applies to", scopeAccount: "Inbox of this account", scopeAll: "All inboxes",
    modeL: "Mode", modeOff: "Off", modeDry: "Trial run (only suggest)", modeAuto: "Move automatically",
    stats: "$1 accepted, $2 rejected, $3 open", statsMoved: ", $1 moved automatically", remove: "Delete rule", removeAsk: "Delete this rule?",
    noDesc: "Without a description the rule is not active.",
    sugTitle: "Suggestions", sugHelp: "From the trial run and from “Check existing mails”. “Yes” moves the mail now, “No” leaves it.",
    sugNone: "No open suggestions.", yes: "Yes", no: "No", sugAll: "Accept all", sugNoAll: "Reject all", sugAllAsk: "Move $1 mails now?",
    scanTitle: "Check existing mails", scanHelp: "Checks the mails already in the inboxes (at most 300) with all active rules. Only gives suggestions, nothing is moved. Takes about as long per mail as a short summary.",
    scanDaysL: "Period:", d7: "last 7 days", d30: "last 30 days", d90: "last 90 days", scanStart: "Check now", scanStop: "Stop",
    scanRun: "$1 of $2 checked, $3 suggestions …", scanDone: "Done: $1 mails checked, $2 suggestions.", scanErr: "Stopped: the AI is not reachable or not set up ($1).",
    scanNoRules: "First create and switch on a rule with a description.", scanBusy: "A check is already running.",
    logTitle: "Log", logHelp: "What was moved (30 days). “Undo” brings the mail back to its inbox.",
    logNone: "Nothing moved yet.", undo: "Undo", logClear: "Clear log",
    stMoved: "moved", stUndone: "brought back", stDismissed: "rejected", stFailed: "failed", stMoving: "moving",
    errNotFound: "Mail not found any more (already moved or deleted?)", errAct: "Did not work: $1",
  },
  fr: {
    title: "Tri par IA", beta: "Bêta",
    intro: "Décrivez avec vos propres mots quels messages vont dans quel dossier. L’IA attribue chaque nouveau message de la boîte de réception à une règle au plus – ou à aucune, il reste alors en place. Pour cela, chaque nouveau message est envoyé à l’IA de Paramètres → IA.",
    aiOff: "L’IA est désactivée (Paramètres → IA) – rien n’est trié d’ici là.",
    rulesTitle: "Règles", rulesHelp: "Commencez de préférence par un essai : vous ne voyez alors que des suggestions ci-dessous et décidez vous-même. Si cela convient, passez la règle sur « Déplacer automatiquement ».",
    noRules: "Aucune règle pour l’instant.", add: "Ajouter une règle",
    folderL: "Dossier cible", descL: "Qu’est-ce qui y va ?", descPh: "p. ex. factures, justificatifs de paiement et relances d’entreprises et de boutiques",
    scopeL: "S’applique à", scopeAccount: "Boîte de réception de ce compte", scopeAll: "Toutes les boîtes de réception",
    modeL: "Mode", modeOff: "Désactivée", modeDry: "Essai (suggérer seulement)", modeAuto: "Déplacer automatiquement",
    stats: "$1 acceptés, $2 refusés, $3 en attente", statsMoved: ", $1 déplacés automatiquement", remove: "Supprimer la règle", removeAsk: "Supprimer cette règle ?",
    noDesc: "Sans description, la règle n’est pas active.",
    sugTitle: "Suggestions", sugHelp: "Issues de l’essai et de « Vérifier les messages existants ». « Oui » déplace le message maintenant, « Non » le laisse.",
    sugNone: "Aucune suggestion en attente.", yes: "Oui", no: "Non", sugAll: "Tout accepter", sugNoAll: "Tout refuser", sugAllAsk: "Déplacer $1 messages maintenant ?",
    scanTitle: "Vérifier les messages existants", scanHelp: "Vérifie les messages déjà présents dans les boîtes de réception (300 au plus) avec toutes les règles actives. Ne donne que des suggestions, rien n’est déplacé. Prend par message à peu près le temps d’un court résumé.",
    scanDaysL: "Période :", d7: "7 derniers jours", d30: "30 derniers jours", d90: "90 derniers jours", scanStart: "Vérifier", scanStop: "Arrêter",
    scanRun: "$1 sur $2 vérifiés, $3 suggestions …", scanDone: "Terminé : $1 messages vérifiés, $2 suggestions.", scanErr: "Interrompu : l’IA n’est pas joignable ou pas configurée ($1).",
    scanNoRules: "Créez et activez d’abord une règle avec une description.", scanBusy: "Une vérification est déjà en cours.",
    logTitle: "Journal", logHelp: "Ce qui a été déplacé (30 jours). « Annuler » remet le message dans sa boîte de réception.",
    logNone: "Rien de déplacé pour l’instant.", undo: "Annuler", logClear: "Vider le journal",
    stMoved: "déplacé", stUndone: "remis", stDismissed: "refusé", stFailed: "échec", stMoving: "en cours",
    errNotFound: "Message introuvable (déjà déplacé ou supprimé ?)", errAct: "Échec : $1",
  },
  es: {
    title: "Clasificar con IA", beta: "Beta",
    intro: "Describe con tus palabras qué correos van en qué carpeta. La IA asigna cada correo nuevo de la bandeja de entrada a una regla como máximo – o a ninguna, y entonces se queda. Para ello, cada correo nuevo se envía a la IA de Ajustes → IA.",
    aiOff: "La IA está desactivada (Ajustes → IA) – hasta entonces no se clasifica nada.",
    rulesTitle: "Reglas", rulesHelp: "Mejor empezar con una prueba: abajo solo verás sugerencias y decides tú. Si encaja, pon la regla en «Mover automáticamente».",
    noRules: "Todavía no hay reglas.", add: "Añadir regla",
    folderL: "Carpeta de destino", descL: "¿Qué va dentro?", descPh: "p. ej. facturas, justificantes de pago y recordatorios de empresas y tiendas",
    scopeL: "Se aplica a", scopeAccount: "Bandeja de entrada de esta cuenta", scopeAll: "Todas las bandejas de entrada",
    modeL: "Modo", modeOff: "Desactivada", modeDry: "Prueba (solo sugerir)", modeAuto: "Mover automáticamente",
    stats: "$1 aceptados, $2 rechazados, $3 pendientes", statsMoved: ", $1 movidos automáticamente", remove: "Borrar regla", removeAsk: "¿Borrar esta regla?",
    noDesc: "Sin descripción la regla no está activa.",
    sugTitle: "Sugerencias", sugHelp: "De la prueba y de «Revisar correos existentes». «Sí» mueve el correo ahora, «No» lo deja.",
    sugNone: "No hay sugerencias pendientes.", yes: "Sí", no: "No", sugAll: "Aceptar todas", sugNoAll: "Rechazar todas", sugAllAsk: "¿Mover $1 correos ahora?",
    scanTitle: "Revisar correos existentes", scanHelp: "Revisa los correos que ya están en las bandejas de entrada (300 como máximo) con todas las reglas activas. Solo da sugerencias, no se mueve nada. Tarda por correo más o menos lo que un resumen corto.",
    scanDaysL: "Periodo:", d7: "últimos 7 días", d30: "últimos 30 días", d90: "últimos 90 días", scanStart: "Revisar ahora", scanStop: "Detener",
    scanRun: "$1 de $2 revisados, $3 sugerencias …", scanDone: "Listo: $1 correos revisados, $2 sugerencias.", scanErr: "Interrumpido: la IA no está disponible o no está configurada ($1).",
    scanNoRules: "Primero crea y activa una regla con descripción.", scanBusy: "Ya hay una revisión en curso.",
    logTitle: "Registro", logHelp: "Lo que se ha movido (30 días). «Deshacer» devuelve el correo a su bandeja de entrada.",
    logNone: "Todavía no se ha movido nada.", undo: "Deshacer", logClear: "Vaciar registro",
    stMoved: "movido", stUndone: "devuelto", stDismissed: "rechazado", stFailed: "error", stMoving: "moviendo",
    errNotFound: "Correo no encontrado (¿ya movido o borrado?)", errAct: "No ha funcionado: $1",
  },
};
const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const T = TEXTS[lang] ?? TEXTS.en;
const t = (key, ...args) => args.reduce((s, a, i) => s.replaceAll(`$${i + 1}`, a), T[key] ?? TEXTS.en[key] ?? key);
const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const n = Object.assign(document.createElement(tag), props);
  n.append(...kids);
  return n;
};
const send = (op, extra = {}) => messenger.runtime.sendMessage({ type: "nbx-sort", op, ...extra });
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(8)), b => b.toString(16).padStart(2, "0")).join("");
const sameFolder = (a, b) => a && b && a.accountId === b.accountId && a.path === b.path;

let folders = []; // {accountId, accountName, path, label, name}
let rules = [];
let log = [];
let scan = null;

// Zielordner aller Konten (ohne Papierkorb, Entwürfe, Vorlagen, Postausgang, Posteingang)
async function loadFolders() {
  const out = [];
  for (const acc of await messenger.accounts.list(true)) {
    const walk = (list, prefix) => {
      for (const f of list || []) {
        const label = prefix ? `${prefix} › ${f.name}` : f.name;
        const special = [f.type, ...(f.specialUse || [])];
        if (!special.some(s => ["trash", "drafts", "templates", "outbox", "inbox"].includes(s))) {
          out.push({ accountId: acc.id, accountName: acc.name, path: f.path, label, name: `${acc.name} › ${label}` });
        }
        walk(f.subFolders, label);
      }
    };
    walk(acc.folders, "");
  }
  return out;
}

// ---- Regeln ------------------------------------------------------------------------------------------------------------
let saveTimer = null;
function saveRules() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => messenger.storage.local.set({ aiSortRules: rules }), 400);
}

function ruleCard(r) {
  const card = el("div", { className: "rule" });
  const fid = `f-${r.id}`;
  const sel = el("select", { id: fid });
  const groups = new Map();
  for (const [i, f] of folders.entries()) {
    if (!groups.has(f.accountId)) groups.set(f.accountId, el("optgroup", { label: f.accountName }));
    groups.get(f.accountId).append(el("option", { value: String(i), selected: sameFolder(f, r.folder) }, f.label));
  }
  sel.append(...groups.values());
  const desc = el("textarea", { id: `d-${r.id}`, value: r.description, placeholder: t("descPh"), maxLength: 400 });
  const radios = ["account", "all"].map(v => el("input", { type: "radio", name: `s-${r.id}`, value: v, checked: r.scope === v }));
  const mode = el("select", { id: `m-${r.id}` }, ...[["off", "modeOff"], ["dry", "modeDry"], ["auto", "modeAuto"]].map(([v, k]) => el("option", { value: v, selected: r.mode === v }, t(k))));
  const stats = el("span", { className: "stats" });
  const del = el("button", { type: "button" }, t("remove"));

  const sync = () => {
    card.classList.toggle("off", r.mode === "off" || !r.description.trim());
    card.title = r.description.trim() ? "" : t("noDesc");
  };
  sel.addEventListener("change", () => {
    const f = folders[Number(sel.value)];
    r.folder = { accountId: f.accountId, path: f.path };
    r.name = f.name;
    sync();
    saveRules();
  });
  desc.addEventListener("input", () => {
    r.description = desc.value;
    sync();
    saveRules();
  });
  radios.forEach(x => x.addEventListener("change", () => {
    r.scope = x.value;
    saveRules();
  }));
  mode.addEventListener("change", () => {
    r.mode = mode.value;
    sync();
    saveRules();
  });
  del.addEventListener("click", () => {
    if (!confirm(t("removeAsk"))) return;
    rules = rules.filter(x => x !== r);
    saveRules();
    renderRules();
  });
  card.append(
    el("label", { htmlFor: fid }, t("folderL")), sel,
    el("label", { htmlFor: desc.id }, t("descL")), desc,
    el("span", { className: "lbl" }, el("b", {}, t("scopeL"))),
    el("div", { className: "opts" }, el("label", {}, radios[0], t("scopeAccount")), el("label", {}, radios[1], t("scopeAll"))),
    el("label", { htmlFor: mode.id }, t("modeL")), mode,
    el("div", { className: "foot" }, stats, del),
  );
  card.dataset.rule = r.id;
  sync();
  return card;
}

function renderRules() {
  $("rules").replaceChildren(...rules.map(ruleCard));
  $("noRules").hidden = rules.length > 0;
  renderStats();
}

function renderStats() {
  for (const card of $("rules").children) {
    const mine = log.filter(e => e.ruleId === card.dataset.rule);
    const n = st => mine.filter(e => e.state === st).length;
    const accepted = mine.filter(e => e.state === "moved" && e.accepted).length;
    const auto = mine.filter(e => ["moved", "undone"].includes(e.state) && !e.accepted).length;
    card.querySelector(".stats").textContent = mine.length ? t("stats", accepted, n("dismissed"), n("suggested")) + (auto ? t("statsMoved", auto) : "") : "";
  }
}

// ---- Vorschläge und Protokoll -----------------------------------------------------------------------------------------
const day = ms => (ms ? new Date(ms).toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "2-digit" }) : "");
const who = a => String(a || "").replace(/\s*<[^>]*>\s*$/, "").replace(/^"|"$/g, "") || String(a || "");

async function doAct(e, what, btns) {
  btns.forEach(b => (b.disabled = true));
  const r = await send("act", { entryId: e.id, what }).catch(err => ({ ok: false, error: String(err) }));
  if (!r?.ok) alert(r?.error === "notfound" ? t("errNotFound") : t("errAct", r?.error || "?"));
  await refresh(true);
}

function row(e, kind) {
  const btns = [];
  if (kind === "sug") {
    const yes = el("button", { type: "button", className: "primary" }, t("yes"));
    const no = el("button", { type: "button" }, t("no"));
    yes.addEventListener("click", () => doAct(e, "yes", btns));
    no.addEventListener("click", () => doAct(e, "no", btns));
    btns.push(yes, no);
  } else if (e.state === "moved") {
    const undo = el("button", { type: "button" }, t("undo"));
    undo.addEventListener("click", () => doAct(e, "undo", btns));
    btns.push(undo);
  }
  const state = { moved: "stMoved", undone: "stUndone", dismissed: "stDismissed", failed: "stFailed", moving: "stMoving" }[e.state];
  const mid = el("span", {}, `${e.subject || "—"}  → `, el("span", { className: "to" }, e.toName || e.to?.path || "?"));
  if (kind === "log" && state) mid.append(" ", el("span", { className: e.state === "failed" ? "err" : "st" }, `(${t(state)}${e.error ? ": " + e.error : ""})`));
  mid.title = `${e.subject || ""} → ${e.toName || ""}`;
  return el("li", {}, el("span", { className: "d" }, day(e.date)), el("span", { className: "a", title: e.author || "" }, who(e.author)), mid, el("span", { className: "btns" }, ...btns));
}

let shown = "";
function renderLists() {
  const sug = log.filter(e => e.state === "suggested").sort((a, b) => b.date - a.date);
  const done = log.filter(e => ["moved", "undone", "failed", "moving"].includes(e.state)).sort((a, b) => b.at - a.at);
  const key = JSON.stringify([sug.map(e => e.id), done.map(e => [e.id, e.state])]);
  if (key !== shown) {
    shown = key;
    $("sug").replaceChildren(...sug.map(e => row(e, "sug")));
    $("log").replaceChildren(...done.map(e => row(e, "log")));
  }
  $("sugCount").textContent = sug.length ? String(sug.length) : "";
  $("sugNone").hidden = sug.length > 0;
  $("sugBar").hidden = sug.length < 2;
  $("logNone").hidden = done.length > 0;
  $("logBar").hidden = done.length === 0;
  renderStats();
}

function renderScan() {
  const running = Boolean(scan?.running);
  $("scanStart").disabled = running;
  $("scanStop").hidden = !running;
  if (!scan || (!running && !scan.total && !scan.error)) return;
  $("scanState").textContent = running ? t("scanRun", scan.done, scan.total, scan.found) : scan.error ? t("scanErr", scan.error) : t("scanDone", scan.done, scan.found);
}

async function refresh(force = false) {
  const r = await send("state").catch(() => null);
  if (!r) return;
  if (force) shown = "";
  log = r.log || [];
  scan = r.scan;
  renderLists();
  renderScan();
}

async function bulk(what) {
  const sug = log.filter(e => e.state === "suggested");
  if (what === "yes" && !confirm(t("sugAllAsk", sug.length))) return;
  $("sugAll").disabled = $("sugNoAll").disabled = true;
  for (const e of sug) await send("act", { entryId: e.id, what }).catch(() => {});
  $("sugAll").disabled = $("sugNoAll").disabled = false;
  await refresh(true);
}

(async () => {
  for (const id of ["title", "beta", "intro", "aiOff", "rulesTitle", "rulesHelp", "noRules", "add", "sugTitle", "sugHelp", "sugNone", "sugAll", "sugNoAll",
    "scanTitle", "scanHelp", "scanDaysL", "scanStart", "scanStop", "logTitle", "logHelp", "logNone", "logClear"]) $(id).textContent = t(id);
  for (const o of $("scanDays").options) o.textContent = t(`d${o.value}`);
  document.title = t("title");
  const conf = await messenger.storage.local.get({ aiEnabled: false, aiSortRules: [] });
  $("aiOff").hidden = conf.aiEnabled === true;
  folders = await loadFolders();
  rules = Array.isArray(conf.aiSortRules) ? conf.aiSortRules : [];
  renderRules();
  $("add").addEventListener("click", () => {
    const f = folders[0];
    if (!f) return;
    const r = { id: newId(), name: f.name, folder: { accountId: f.accountId, path: f.path }, description: "", scope: "account", mode: "dry" };
    rules.push(r);
    saveRules();
    renderRules();
    $(`d-${r.id}`)?.focus();
  });
  $("sugAll").addEventListener("click", () => bulk("yes"));
  $("sugNoAll").addEventListener("click", () => bulk("no"));
  $("scanStart").addEventListener("click", async () => {
    clearTimeout(saveTimer);
    await messenger.storage.local.set({ aiSortRules: rules });
    const r = await send("scan", { days: Number($("scanDays").value) }).catch(e => ({ ok: false, error: String(e) }));
    if (!r?.ok) $("scanState").textContent = r?.error === "norules" ? t("scanNoRules") : r?.error === "running" ? t("scanBusy") : t("scanErr", r?.error || "?");
    refresh();
  });
  $("scanStop").addEventListener("click", () => send("stopScan").then(() => refresh()));
  $("logClear").addEventListener("click", () => send("clear").then(() => refresh(true)));
  await refresh();
  setInterval(refresh, 2000);
})();
