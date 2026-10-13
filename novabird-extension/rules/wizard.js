/* Regel-Assistent (Beta): legt per Experiment mailRules einen echten Betterbird-Filter an.
 * Aufruf: rules/wizard.html?m=<JSON {author, subject, recipients, account, folder}> (aus dem Kontextmenü) oder ohne m (leer).
 */
"use strict";

const TEXTS = {
  de: {
    title: "Regel-Assistent", beta: "Beta",
    intro: "Lege in drei Schritten eine Regel an. Sie wird als normaler Betterbird-Filter gespeichert und läuft auch ohne NovaBird; ändern oder löschen kannst du sie jederzeit unter Extras → Nachrichtenfilter.",
    s1Title: "Welche Mails?", s1Help: "Wähle, woran die Regel eine Mail erkennt. Darunter siehst du sofort, welche Mails im Posteingang passen würden.",
    cFromAddr: "Von diesem Absender", cFromAddrSub: "Nur Mails genau dieser Adresse.",
    cFromDomain: "Von allen Absendern dieser Domain", cFromDomainSub: "Z. B. alle Mails eines Shops oder einer Firma, egal von welcher Adresse.",
    cSubject: "Betreff enthält", cSubjectSub: "Für wiederkehrende Mails mit festem Betreff (Rechnungen, Berichte).",
    cTo: "An diese Adresse", cToSub: "Für Aliase, Verteiler oder Mails an eine zweite Adresse.",
    cCustom: "Eigene Bedingung", cCustomSub: "Feld, Vergleich und Text frei wählen.",
    fFrom: "Absender", fTo: "Empfänger (An/Kopie)", fSubject: "Betreff",
    oContains: "enthält", oIs: "ist genau", oBegins: "beginnt mit", oEnds: "endet mit",
    pNone: "Noch keine Bedingung.", pBusy: "Suche …", pCount: "$1 passende Mails in den Posteingängen", pOne: "1 passende Mail in den Posteingängen",
    pZero: "Im Posteingang passt derzeit keine Mail – die Regel wirkt dann nur auf neue Mails.", pPartial: " (nicht alle Ordner geprüft)",
    s2Title: "Was soll damit passieren?", s2Help: "Mehrere Aktionen sind möglich. Verschieben und Löschen schließen sich aus.",
    aMove: "In Ordner verschieben:", aTag: "Schlagwort setzen:", aRead: "Als gelesen markieren", aStar: "Mit Stern markieren", aDelete: "In den Papierkorb verschieben",
    s3Title: "Für welche Konten und wann?",
    acctOne: "Nur für das Konto", acctAll: "Für alle Konten",
    acctHelp: "Betterbird speichert Regeln je Konto. „Alle Konten“ legt die Regel in jedem Konto einmal an.",
    onNew: "Bei neuen Mails automatisch anwenden", applyNow: "Jetzt auch auf die vorhandenen Mails im Posteingang anwenden", applyNowN: "Jetzt auch auf die $1 vorhandenen Mails im Posteingang anwenden",
    sumTitle: "Zusammenfassung", nameL: "Name der Regel:",
    sumFromAddr: "Wenn eine Mail von „$1“ kommt", sumFromDomain: "Wenn eine Mail von einer Adresse mit „$1“ kommt", sumSubject: "Wenn der Betreff „$1“ enthält",
    sumTo: "Wenn eine Mail an „$1“ geht", sumCustom: "Wenn $1 $2 „$3“",
    sumThen: ", wird sie $1.", and: " und ", sumNoAct: " … (noch keine Aktion gewählt).",
    actMove: "nach „$1“ verschoben", actTag: "mit dem Schlagwort „$1“ versehen", actRead: "als gelesen markiert", actStar: "mit Stern markiert", actDelete: "in den Papierkorb verschoben",
    whenOne: "Gilt für das Konto „$1“", whenAll: "Gilt für alle Konten", whenAuto: ", automatisch bei neuen Mails", whenManual: ", nur wenn du die Filter von Hand startest",
    whenNow: "; vorhandene Mails im Posteingang werden gleich mit sortiert", dot: ".",
    namePrefix: "NovaBird: ",
    cancel: "Abbrechen", save: "Regel speichern", close: "Schließen", saving: "Speichere …",
    doneTitle: "Regel gespeichert", doneText: "Die Regel „$1“ steht jetzt in Betterbirds Nachrichtenfiltern ($2), ganz unten in der Liste.", doneApplied: " Vorhandene Mails im Posteingang wurden sortiert.",
    doneHelp: "Ändern, abschalten oder löschen kannst du sie unter Extras → Nachrichtenfilter. Eine Sicherung der vorherigen Filter liegt im Profil neben der Filterdatei (msgFilterRules.dat.nbx-last).",
    errSave: "Speichern fehlgeschlagen: $1",
  },
  en: {
    title: "Rule assistant", beta: "Beta",
    intro: "Create a rule in three steps. It is saved as a normal Betterbird filter and keeps working without NovaBird; you can change or delete it any time under Tools → Message Filters.",
    s1Title: "Which mails?", s1Help: "Choose how the rule recognises a mail. Below you immediately see which mails in your inbox would match.",
    cFromAddr: "From this sender", cFromAddrSub: "Only mails from exactly this address.",
    cFromDomain: "From all senders of this domain", cFromDomainSub: "E.g. all mails from a shop or company, whatever the address.",
    cSubject: "Subject contains", cSubjectSub: "For recurring mails with a fixed subject (invoices, reports).",
    cTo: "To this address", cToSub: "For aliases, mailing lists or mails to a second address.",
    cCustom: "Custom condition", cCustomSub: "Choose field, comparison and text freely.",
    fFrom: "Sender", fTo: "Recipient (To/Cc)", fSubject: "Subject",
    oContains: "contains", oIs: "is exactly", oBegins: "begins with", oEnds: "ends with",
    pNone: "No condition yet.", pBusy: "Searching …", pCount: "$1 matching mails in the inboxes", pOne: "1 matching mail in the inboxes",
    pZero: "No mail in the inbox matches right now – the rule will only act on new mail.", pPartial: " (not all folders checked)",
    s2Title: "What should happen?", s2Help: "Several actions are possible. Moving and deleting exclude each other.",
    aMove: "Move to folder:", aTag: "Add tag:", aRead: "Mark as read", aStar: "Star", aDelete: "Move to trash",
    s3Title: "Which accounts and when?",
    acctOne: "Only for the account", acctAll: "For all accounts",
    acctHelp: "Betterbird stores rules per account. \"All accounts\" creates the rule once in every account.",
    onNew: "Apply automatically to new mail", applyNow: "Also apply now to the existing mails in the inbox", applyNowN: "Also apply now to the $1 existing mails in the inbox",
    sumTitle: "Summary", nameL: "Rule name:",
    sumFromAddr: "When a mail comes from \"$1\"", sumFromDomain: "When a mail comes from an address containing \"$1\"", sumSubject: "When the subject contains \"$1\"",
    sumTo: "When a mail is sent to \"$1\"", sumCustom: "When $1 $2 \"$3\"",
    sumThen: ", it is $1.", and: " and ", sumNoAct: " … (no action chosen yet).",
    actMove: "moved to \"$1\"", actTag: "tagged \"$1\"", actRead: "marked as read", actStar: "starred", actDelete: "moved to the trash",
    whenOne: "Applies to the account \"$1\"", whenAll: "Applies to all accounts", whenAuto: ", automatically for new mail", whenManual: ", only when you run the filters by hand",
    whenNow: "; existing mails in the inbox are sorted right away", dot: ".",
    namePrefix: "NovaBird: ",
    cancel: "Cancel", save: "Save rule", close: "Close", saving: "Saving …",
    doneTitle: "Rule saved", doneText: "The rule \"$1\" is now in Betterbird's message filters ($2), at the bottom of the list.", doneApplied: " Existing mails in the inbox have been sorted.",
    doneHelp: "You can change, disable or delete it under Tools → Message Filters. A backup of the previous filters is kept in the profile next to the filter file (msgFilterRules.dat.nbx-last).",
    errSave: "Saving failed: $1",
  },
  fr: {
    title: "Assistant de règles", beta: "Bêta",
    intro: "Créez une règle en trois étapes. Elle est enregistrée comme un filtre Betterbird normal et fonctionne aussi sans NovaBird ; vous pouvez la modifier ou la supprimer à tout moment sous Outils → Filtres de messages.",
    s1Title: "Quels messages ?", s1Help: "Choisissez comment la règle reconnaît un message. Juste en dessous, vous voyez les messages de la boîte de réception qui correspondraient.",
    cFromAddr: "De cet expéditeur", cFromAddrSub: "Uniquement les messages de cette adresse exacte.",
    cFromDomain: "De tous les expéditeurs de ce domaine", cFromDomainSub: "Par ex. tous les messages d'une boutique ou d'une entreprise, quelle que soit l'adresse.",
    cSubject: "Le sujet contient", cSubjectSub: "Pour les messages récurrents au sujet fixe (factures, rapports).",
    cTo: "À cette adresse", cToSub: "Pour les alias, listes de diffusion ou messages envoyés à une seconde adresse.",
    cCustom: "Condition personnalisée", cCustomSub: "Choisissez librement le champ, la comparaison et le texte.",
    fFrom: "Expéditeur", fTo: "Destinataire (À/Cc)", fSubject: "Sujet",
    oContains: "contient", oIs: "est exactement", oBegins: "commence par", oEnds: "se termine par",
    pNone: "Pas encore de condition.", pBusy: "Recherche …", pCount: "$1 messages correspondants dans les boîtes de réception", pOne: "1 message correspondant dans les boîtes de réception",
    pZero: "Aucun message de la boîte de réception ne correspond pour l'instant – la règle n'agira que sur les nouveaux messages.", pPartial: " (tous les dossiers n'ont pas été vérifiés)",
    s2Title: "Que doit-il se passer ?", s2Help: "Plusieurs actions sont possibles. Déplacer et supprimer s'excluent.",
    aMove: "Déplacer vers le dossier :", aTag: "Ajouter l'étiquette :", aRead: "Marquer comme lu", aStar: "Ajouter une étoile", aDelete: "Mettre à la corbeille",
    s3Title: "Pour quels comptes et quand ?",
    acctOne: "Uniquement pour le compte", acctAll: "Pour tous les comptes",
    acctHelp: "Betterbird enregistre les règles par compte. « Tous les comptes » crée la règle une fois dans chaque compte.",
    onNew: "Appliquer automatiquement aux nouveaux messages", applyNow: "Appliquer aussi maintenant aux messages existants de la boîte de réception", applyNowN: "Appliquer aussi maintenant aux $1 messages existants de la boîte de réception",
    sumTitle: "Résumé", nameL: "Nom de la règle :",
    sumFromAddr: "Quand un message vient de « $1 »", sumFromDomain: "Quand un message vient d'une adresse contenant « $1 »", sumSubject: "Quand le sujet contient « $1 »",
    sumTo: "Quand un message est envoyé à « $1 »", sumCustom: "Quand $1 $2 « $3 »",
    sumThen: ", il est $1.", and: " et ", sumNoAct: " … (aucune action choisie).",
    actMove: "déplacé vers « $1 »", actTag: "étiqueté « $1 »", actRead: "marqué comme lu", actStar: "marqué d'une étoile", actDelete: "mis à la corbeille",
    whenOne: "S'applique au compte « $1 »", whenAll: "S'applique à tous les comptes", whenAuto: ", automatiquement aux nouveaux messages", whenManual: ", seulement quand vous lancez les filtres à la main",
    whenNow: " ; les messages existants de la boîte de réception sont triés tout de suite", dot: ".",
    namePrefix: "NovaBird : ",
    cancel: "Annuler", save: "Enregistrer la règle", close: "Fermer", saving: "Enregistrement …",
    doneTitle: "Règle enregistrée", doneText: "La règle « $1 » figure maintenant dans les filtres de messages de Betterbird ($2), en bas de la liste.", doneApplied: " Les messages existants de la boîte de réception ont été triés.",
    doneHelp: "Vous pouvez la modifier, la désactiver ou la supprimer sous Outils → Filtres de messages. Une sauvegarde des filtres précédents se trouve dans le profil à côté du fichier de filtres (msgFilterRules.dat.nbx-last).",
    errSave: "Échec de l'enregistrement : $1",
  },
  es: {
    title: "Asistente de reglas", beta: "Beta",
    intro: "Crea una regla en tres pasos. Se guarda como un filtro normal de Betterbird y funciona también sin NovaBird; puedes cambiarla o borrarla cuando quieras en Herramientas → Filtros de mensajes.",
    s1Title: "¿Qué correos?", s1Help: "Elige cómo reconoce la regla un correo. Justo debajo verás qué correos de la bandeja de entrada coincidirían.",
    cFromAddr: "De este remitente", cFromAddrSub: "Solo correos de esta dirección exacta.",
    cFromDomain: "De todos los remitentes de este dominio", cFromDomainSub: "P. ej. todos los correos de una tienda o empresa, sea cual sea la dirección.",
    cSubject: "El asunto contiene", cSubjectSub: "Para correos recurrentes con asunto fijo (facturas, informes).",
    cTo: "A esta dirección", cToSub: "Para alias, listas de distribución o correos a una segunda dirección.",
    cCustom: "Condición propia", cCustomSub: "Elige libremente campo, comparación y texto.",
    fFrom: "Remitente", fTo: "Destinatario (Para/CC)", fSubject: "Asunto",
    oContains: "contiene", oIs: "es exactamente", oBegins: "empieza por", oEnds: "termina en",
    pNone: "Aún no hay condición.", pBusy: "Buscando …", pCount: "$1 correos coincidentes en las bandejas de entrada", pOne: "1 correo coincidente en las bandejas de entrada",
    pZero: "Ahora mismo ningún correo de la bandeja de entrada coincide; la regla solo actuará sobre correos nuevos.", pPartial: " (no se revisaron todas las carpetas)",
    s2Title: "¿Qué debe pasar?", s2Help: "Se pueden elegir varias acciones. Mover y borrar se excluyen.",
    aMove: "Mover a la carpeta:", aTag: "Añadir etiqueta:", aRead: "Marcar como leído", aStar: "Marcar con estrella", aDelete: "Mover a la papelera",
    s3Title: "¿Para qué cuentas y cuándo?",
    acctOne: "Solo para la cuenta", acctAll: "Para todas las cuentas",
    acctHelp: "Betterbird guarda las reglas por cuenta. «Todas las cuentas» crea la regla una vez en cada cuenta.",
    onNew: "Aplicar automáticamente a los correos nuevos", applyNow: "Aplicar también ahora a los correos existentes de la bandeja de entrada", applyNowN: "Aplicar también ahora a los $1 correos existentes de la bandeja de entrada",
    sumTitle: "Resumen", nameL: "Nombre de la regla:",
    sumFromAddr: "Cuando un correo viene de «$1»", sumFromDomain: "Cuando un correo viene de una dirección que contiene «$1»", sumSubject: "Cuando el asunto contiene «$1»",
    sumTo: "Cuando un correo va a «$1»", sumCustom: "Cuando $1 $2 «$3»",
    sumThen: ", se $1.", and: " y ", sumNoAct: " … (aún no hay acción).",
    actMove: "mueve a «$1»", actTag: "etiqueta como «$1»", actRead: "marca como leído", actStar: "marca con estrella", actDelete: "mueve a la papelera",
    whenOne: "Vale para la cuenta «$1»", whenAll: "Vale para todas las cuentas", whenAuto: ", automáticamente con los correos nuevos", whenManual: ", solo cuando ejecutas los filtros a mano",
    whenNow: "; los correos existentes de la bandeja de entrada se ordenan enseguida", dot: ".",
    namePrefix: "NovaBird: ",
    cancel: "Cancelar", save: "Guardar regla", close: "Cerrar", saving: "Guardando …",
    doneTitle: "Regla guardada", doneText: "La regla «$1» está ahora en los filtros de mensajes de Betterbird ($2), al final de la lista.", doneApplied: " Los correos existentes de la bandeja de entrada se han ordenado.",
    doneHelp: "Puedes cambiarla, desactivarla o borrarla en Herramientas → Filtros de mensajes. Una copia de los filtros anteriores queda en el perfil junto al archivo de filtros (msgFilterRules.dat.nbx-last).",
    errSave: "No se pudo guardar: $1",
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

const msg = (() => {
  try { return JSON.parse(new URLSearchParams(location.search).get("m") || "null"); } catch (e) { return null; }
})();

// Absender/Empfänger zerlegen: „Name <a@b.c>“ → a@b.c
const emailOf = text => (/<([^>]+)>/.exec(text ?? "")?.[1] ?? String(text ?? "").split(",")[0]).trim().toLowerCase();
const cleanSubject = s => String(s ?? "").replace(/^\s*((re|aw|fw|fwd|wg|tr|rv|sv)\s*(\[\d+\])?\s*:\s*)+/i, "").trim();

let accounts = [];
let folders = [];
let tags = [];
let lastPreview = null;

// Bedingungen: vorbereitete Vorschläge aus der Mail, sonst nur „Eigene Bedingung“
function buildConditions() {
  const box = $("conds");
  const sender = msg ? emailOf(msg.author) : "";
  const domain = sender.includes("@") ? sender.slice(sender.indexOf("@")) : "";
  const to = msg ? emailOf(msg.recipients) : "";
  const presets = [];
  if (sender) presets.push({ id: "fromAddr", field: "from", op: "is", value: sender });
  if (domain) presets.push({ id: "fromDomain", field: "from", op: "contains", value: domain });
  if (msg && cleanSubject(msg.subject)) presets.push({ id: "subject", field: "subject", op: "contains", value: cleanSubject(msg.subject) });
  if (to) presets.push({ id: "to", field: "to", op: "contains", value: to });
  presets.push({ id: "custom", field: "from", op: "contains", value: "" });
  for (const [i, p] of presets.entries()) {
    const key = { fromAddr: "cFromAddr", fromDomain: "cFromDomain", subject: "cSubject", to: "cTo", custom: "cCustom" }[p.id];
    const radio = el("input", { type: "radio", name: "cond", value: p.id, checked: i === 0, id: `c-${p.id}` });
    const row = el("div", { className: "row" });
    const input = el("input", { type: "text", value: p.value, id: `v-${p.id}` });
    if (p.id === "custom") {
      const f = el("select", { id: "cf" }, ...[["from", "fFrom"], ["to", "fTo"], ["subject", "fSubject"]].map(([v, k]) => el("option", { value: v }, t(k))));
      const o = el("select", { id: "co" }, ...[["contains", "oContains"], ["is", "oIs"], ["beginsWith", "oBegins"], ["endsWith", "oEnds"]].map(([v, k]) => el("option", { value: v }, t(k))));
      row.append(f, o);
      for (const s of [f, o]) s.addEventListener("change", () => { radio.checked = true; update(); });
    }
    row.append(input);
    input.addEventListener("input", () => { radio.checked = true; update(); });
    radio.addEventListener("change", update);
    const label = el("label", { htmlFor: radio.id }, el("b", {}, t(key)));
    // Wert grau neben der Überschrift, solange die Bedingung nicht gewählt ist (das Textfeld erscheint nur bei der gewählten)
    if (p.value) {
      const hint = el("span", { className: "val" }, p.value);
      input.addEventListener("input", () => { hint.textContent = input.value; });
      label.append(hint);
    }
    box.append(el("div", { className: "cond" }, radio, label, el("span", { className: "sub" }, t(`${key}Sub`)), row));
    box.lastChild.dataset.field = p.field;
    box.lastChild.dataset.op = p.op;
  }
}

function currentCondition() {
  const radio = document.querySelector("input[name=cond]:checked");
  if (!radio) return null;
  const id = radio.value;
  const value = $(`v-${id}`).value.trim();
  if (id === "custom") return { id, field: $("cf").value, op: $("co").value, value };
  const row = radio.closest(".cond");
  return { id, field: row.dataset.field, op: row.dataset.op, value };
}

function selectedAccounts() {
  return $("acctAll").checked ? "all" : [$("acctSel").value];
}

function currentActions() {
  const out = [];
  if ($("aRead").checked) out.push({ type: "read" });
  if ($("aStar").checked) out.push({ type: "star" });
  if ($("aTag").checked && $("aTagV").value) out.push({ type: "tag", tag: $("aTagV").value });
  if ($("aMove").checked && $("aMoveF").value) out.push({ type: "move", folder: $("aMoveF").value });
  if ($("aDelete").checked) out.push({ type: "delete" });
  return out;
}

function conditionSentence(c) {
  if (!c || !c.value) return "";
  if (c.id === "fromAddr") return t("sumFromAddr", c.value);
  if (c.id === "fromDomain") return t("sumFromDomain", c.value);
  if (c.id === "subject") return t("sumSubject", c.value);
  if (c.id === "to") return t("sumTo", c.value);
  const field = t({ from: "fFrom", to: "fTo", subject: "fSubject" }[c.field]);
  const op = t({ contains: "oContains", is: "oIs", beginsWith: "oBegins", endsWith: "oEnds" }[c.op]);
  return t("sumCustom", field, op, c.value);
}

function actionWords(actions) {
  const words = actions.map(a => {
    if (a.type === "move") return t("actMove", folders.find(f => f.uri === a.folder)?.path ?? "?");
    if (a.type === "tag") return t("actTag", tags.find(x => x.key === a.tag)?.name ?? a.tag);
    return t({ read: "actRead", star: "actStar", delete: "actDelete" }[a.type]);
  });
  if (words.length <= 1) return words.join("");
  return words.slice(0, -1).join(", ") + t("and") + words.at(-1);
}

function summary() {
  const c = currentCondition();
  const acts = currentActions();
  const cond = conditionSentence(c);
  if (!cond) return "";
  let s = cond + (acts.length ? t("sumThen", actionWords(acts)) : t("sumNoAct"));
  const acct = selectedAccounts();
  s += " " + (acct === "all" ? t("whenAll") : t("whenOne", accounts.find(a => a.key === acct[0])?.name ?? "?"));
  s += $("onNew").checked ? t("whenAuto") : t("whenManual");
  if ($("applyNow").checked) s += t("whenNow");
  return s + t("dot");
}

let nameTouched = false;
function defaultName() {
  const c = currentCondition();
  if (!c?.value) return "";
  const target = currentActions().find(a => a.type === "move");
  const folder = target ? folders.find(f => f.uri === target.folder)?.name : null;
  return `${t("namePrefix")}${c.value}${folder ? ` → ${folder}` : ""}`.slice(0, 120);
}

let previewTimer = 0;
let previewSeq = 0;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 250);
}
async function runPreview() {
  const c = currentCondition();
  const head = $("pHead");
  const list = $("pList");
  if (!c?.value) {
    head.textContent = t("pNone");
    list.replaceChildren();
    lastPreview = null;
    syncApplyNow();
    return;
  }
  const seq = ++previewSeq;
  head.textContent = t("pBusy");
  let r;
  try {
    r = await messenger.mailRules.preview(JSON.stringify({ terms: [c], accounts: selectedAccounts() }), 5);
  } catch (e) {
    r = null;
  }
  if (seq !== previewSeq) return;
  lastPreview = r;
  if (!r) { head.textContent = ""; list.replaceChildren(); return; }
  head.textContent = (r.count === 0 ? t("pZero") : r.count === 1 ? t("pOne") : t("pCount", String(r.count))) + (r.partial ? t("pPartial") : "");
  const fmt = new Intl.DateTimeFormat(lang, { dateStyle: "short" });
  list.replaceChildren(...r.samples.map(m => el("li", {},
    el("span", { className: "d" }, fmt.format(new Date(m.date))),
    el("span", { title: m.author }, m.author.replace(/\s*<[^>]+>/, "") || m.author),
    el("span", { title: m.subject }, m.subject))));
  syncApplyNow();
}

function syncApplyNow() {
  const n = lastPreview?.count ?? 0;
  $("applyNowL").textContent = n > 0 ? t("applyNowN", String(n)) : t("applyNow");
}

function syncActions() {
  // Verschieben und Löschen schließen sich aus; Auswahlfelder nur aktiv, wenn angehakt
  $("aDelete").disabled = $("aMove").checked;
  $("aMove").disabled = $("aDelete").checked;
  $("aDelete").closest("label").classList.toggle("off", $("aDelete").disabled);
  $("aMove").closest("label").classList.toggle("off", $("aMove").disabled);
  $("aMoveF").disabled = !$("aMove").checked;
  $("aTagV").disabled = !$("aTag").checked;
}

function update() {
  syncActions();
  if (!nameTouched) $("name").value = defaultName();
  $("sumText").textContent = summary();
  const ok = !!currentCondition()?.value && currentActions().length > 0 && $("name").value.trim();
  $("save").disabled = !ok;
  $("error").hidden = true;
  schedulePreview();
}

async function save() {
  const c = currentCondition();
  const spec = {
    name: $("name").value.trim(),
    terms: [{ field: c.field, op: c.op, value: c.value }],
    match: "all",
    actions: currentActions(),
    accounts: selectedAccounts(),
    onNew: $("onNew").checked,
    applyNow: $("applyNow").checked,
  };
  $("save").disabled = true;
  $("save").textContent = t("saving");
  try {
    const result = await messenger.mailRules.create(JSON.stringify(spec));
    $("form").hidden = true;
    $("done").hidden = false;
    $("doneText").textContent = t("doneText", spec.name, result.map(r => r.accountName).join(", ")) + (spec.applyNow ? t("doneApplied") : "");
  } catch (e) {
    $("error").textContent = t("errSave", e?.message ?? String(e));
    $("error").hidden = false;
    $("save").textContent = t("save");
    $("save").disabled = false;
  }
}

function fillSelects() {
  // Zielordner: nach Konto gruppiert, Papierkorb/Entwürfe/Vorlagen/Postausgang nicht anbieten
  const groups = new Map();
  for (const f of folders) {
    if (f.special.some(s => ["Trash", "Drafts", "Templates", "Queue"].includes(s))) continue;
    if (!groups.has(f.accountName)) groups.set(f.accountName, el("optgroup", { label: f.accountName }));
    groups.get(f.accountName).append(el("option", { value: f.uri }, f.path));
  }
  $("aMoveF").replaceChildren(...groups.values());
  $("aTagV").replaceChildren(...tags.map(x => el("option", { value: x.key }, x.name)));
  $("acctSel").replaceChildren(...accounts.map(a => el("option", { value: a.key }, a.name)));
  if (msg?.account && accounts.some(a => a.key === msg.account)) $("acctSel").value = msg.account;
  // nur ein Konto: Auswahl ausblenden
  $("acctBox").hidden = accounts.length < 2;
}

(async () => {
  for (const [id, key] of Object.entries({
    title: "title", beta: "beta", intro: "intro", s1Title: "s1Title", s1Help: "s1Help", s2Title: "s2Title", s2Help: "s2Help",
    aMoveL: "aMove", aTagL: "aTag", aReadL: "aRead", aStarL: "aStar", aDeleteL: "aDelete", s3Title: "s3Title",
    acctOneL: "acctOne", acctAllL: "acctAll", acctHelp: "acctHelp", onNewL: "onNew", applyNowL: "applyNow",
    sumTitle: "sumTitle", nameL: "nameL", cancel: "cancel", save: "save", doneTitle: "doneTitle", doneHelp: "doneHelp", close: "close",
  })) $(id).textContent = t(key);
  document.title = t("title");
  [accounts, folders, tags] = await Promise.all([messenger.mailRules.listAccounts(), messenger.mailRules.listFolders(), messenger.mailRules.listTags()]);
  fillSelects();
  buildConditions();
  for (const id of ["aMove", "aTag", "aRead", "aStar", "aDelete", "aMoveF", "aTagV", "acctOne", "acctAll", "acctSel", "onNew", "applyNow"]) {
    $(id).addEventListener("change", () => {
      if (id === "acctSel") $("acctOne").checked = true;
      update();
    });
  }
  $("aMoveF").addEventListener("change", () => { $("aMove").checked = true; update(); });
  $("aTagV").addEventListener("change", () => { $("aTag").checked = true; update(); });
  $("name").addEventListener("input", () => { nameTouched = true; update(); });
  $("save").addEventListener("click", save);
  $("cancel").addEventListener("click", () => window.close());
  $("close").addEventListener("click", () => window.close());
  update();
})();
