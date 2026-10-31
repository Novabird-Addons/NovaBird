"use strict";

// KI im Verfassen-Fenster: Reiter Antwort, Korrektur, Ton, Übersetzen. Gerechnet wird im Hintergrund (ai/write.js),
// eingefügt erst mit „Übernehmen“ (ai/compose-script.js, rückgängig mit Strg+Z).
const TEXTS = {
  de: { tabReply: "Antwort", tabFix: "Korrektur", tabTone: "Ton", tabTranslate: "Übersetzen",
    wishReply: "Was soll die Antwort sagen? (optional, z. B. „zusagen, Dienstag passt“)", wishDraft: "Worum geht es? (oder Stichpunkte in die Mail schreiben)", go: "Entwurf schreiben",
    toneLabel: "Ton", tones: { friendly: "Freundlicher", formal: "Förmlicher", short: "Kürzer", casual: "Lockerer" }, toLabel: "Nach",
    apply: "Übernehmen", applyReply: "Einfügen", again: "Neu erstellen", copy: "Kopieren", copied: "Kopiert", settings: "Einstellungen", working: "Wird geschrieben …",
    srcSelection: "Bearbeitet wird der markierte Text.", srcOwn: "Bearbeitet wird dein Text ohne Zitat und Signatur. Nur einen Teil? Text markieren und das Fenster neu öffnen.",
    srcReply: "Antwort auf: $1", srcDraft: "Neue Mail: Entwurf aus deiner Vorgabe oder deinen Stichpunkten.", noText: "Es gibt noch keinen eigenen Text. Schreibe etwas oder markiere einen Teil.",
    applied: "Eingefügt – Strg+Z macht es rückgängig.", noScript: "Das Verfassen-Fenster war schon offen, bevor NovaBird gestartet ist. Bitte die Mail speichern, schließen und neu öffnen.",
    remote: "Der Text wird an $1 gesendet.", fail: "Das hat nicht geklappt:", feature: "„Schreiben“ ist in den Einstellungen unter „KI“ ausgeschaltet.",
    disabled: "Die KI ist ausgeschaltet. Sie lässt sich in den Einstellungen unter „KI“ einschalten.", off: "Die KI ist nicht eingerichtet. Adresse und Modell stehen in den Einstellungen unter „KI“.", model: "Es ist kein Modell eingetragen.",
    empty: "Es gibt keinen Text zum Bearbeiten.", permission: "Für diese Adresse fehlt die Erlaubnis. Bitte in den Einstellungen unter „KI“ speichern und die Erlaubnis bestätigen.", url: "Die Adresse ist ungültig.",
    code: "Der Kopplungscode passt nicht (Web-Oberfläche des Helpers → Verbindung).", nomodel: "Im Helper ist kein Sprachmodell gewählt (Web-Oberfläche → Sprachmodell).", answer: "Die Antwort des Helpers ließ sich nicht prüfen.", helper: "Fehler im Helper.",
    forbidden: "Der Server hat die Anfrage abgelehnt (403)." },
  en: { tabReply: "Reply", tabFix: "Correct", tabTone: "Tone", tabTranslate: "Translate",
    wishReply: "What should the reply say? (optional, e.g. “accept, Tuesday works”)", wishDraft: "What is it about? (or write notes into the mail)", go: "Write draft",
    toneLabel: "Tone", tones: { friendly: "Friendlier", formal: "More formal", short: "Shorter", casual: "More relaxed" }, toLabel: "Into",
    apply: "Apply", applyReply: "Insert", again: "Regenerate", copy: "Copy", copied: "Copied", settings: "Settings", working: "Writing …",
    srcSelection: "The selected text is processed.", srcOwn: "Your text without quote and signature is processed. Only a part? Select it and open this window again.",
    srcReply: "Reply to: $1", srcDraft: "New message: draft from your instructions or notes.", noText: "There is no text of your own yet. Write something or select a part.",
    applied: "Inserted – Ctrl+Z undoes it.", noScript: "The compose window was already open before NovaBird started. Please save the message, close it and open it again.",
    remote: "The text is sent to $1.", fail: "That did not work:", feature: "“Write” is switched off in the settings under “AI”.",
    disabled: "AI is switched off. You can switch it on in the settings under “AI”.", off: "AI is not set up. Address and model are in the settings under “AI”.", model: "No model has been entered.",
    empty: "There is no text to process.", permission: "Permission for this address is missing. Please save it in the settings under “AI” and confirm the permission.", url: "The address is invalid.",
    code: "The pairing code does not match (helper web interface → Connection).", nomodel: "No language model is selected in the helper (web interface → Language model).", answer: "The helper's answer could not be verified.", helper: "Error in the helper.",
    forbidden: "The server refused the request (403)." },
  fr: { tabReply: "Réponse", tabFix: "Correction", tabTone: "Ton", tabTranslate: "Traduire",
    wishReply: "Que doit dire la réponse ? (facultatif, p. ex. « accepter, mardi me convient »)", wishDraft: "De quoi s’agit-il ? (ou écrire des notes dans le message)", go: "Rédiger",
    toneLabel: "Ton", tones: { friendly: "Plus aimable", formal: "Plus formel", short: "Plus court", casual: "Plus détendu" }, toLabel: "Vers",
    apply: "Appliquer", applyReply: "Insérer", again: "Régénérer", copy: "Copier", copied: "Copié", settings: "Paramètres", working: "Rédaction en cours …",
    srcSelection: "Le texte sélectionné est traité.", srcOwn: "Votre texte sans citation ni signature est traité. Une partie seulement ? Sélectionnez-la et rouvrez cette fenêtre.",
    srcReply: "Réponse à : $1", srcDraft: "Nouveau message : brouillon à partir de vos consignes ou notes.", noText: "Il n’y a pas encore de texte. Écrivez quelque chose ou sélectionnez une partie.",
    applied: "Inséré – Ctrl+Z annule.", noScript: "La fenêtre de rédaction était ouverte avant le démarrage de NovaBird. Enregistrez le message, fermez-le et rouvrez-le.",
    remote: "Le texte est envoyé à $1.", fail: "Cela n’a pas fonctionné :", feature: "« Écrire » est désactivé dans les paramètres sous « IA ».",
    disabled: "L’IA est désactivée. Vous pouvez l’activer dans les paramètres sous « IA ».", off: "L’IA n’est pas configurée. L’adresse et le modèle se trouvent dans les paramètres sous « IA ».", model: "Aucun modèle n’est indiqué.",
    empty: "Il n’y a pas de texte à traiter.", permission: "L’autorisation pour cette adresse manque. Enregistrez-la dans les paramètres sous « IA » et confirmez l’autorisation.", url: "L’adresse est invalide.",
    code: "Le code d’appairage ne correspond pas (interface web du helper → Connexion).", nomodel: "Aucun modèle de langage n’est choisi dans le helper (interface web → Modèle de langage).", answer: "La réponse du helper n’a pas pu être vérifiée.", helper: "Erreur dans le helper.",
    forbidden: "Le serveur a refusé la requête (403)." },
  es: { tabReply: "Respuesta", tabFix: "Corrección", tabTone: "Tono", tabTranslate: "Traducir",
    wishReply: "¿Qué debe decir la respuesta? (opcional, p. ej. «aceptar, el martes me va bien»)", wishDraft: "¿De qué se trata? (o escriba notas en el correo)", go: "Redactar",
    toneLabel: "Tono", tones: { friendly: "Más amable", formal: "Más formal", short: "Más breve", casual: "Más relajado" }, toLabel: "Al",
    apply: "Aplicar", applyReply: "Insertar", again: "Volver a generar", copy: "Copiar", copied: "Copiado", settings: "Ajustes", working: "Redactando …",
    srcSelection: "Se procesa el texto seleccionado.", srcOwn: "Se procesa su texto sin cita ni firma. ¿Solo una parte? Selecciónela y vuelva a abrir esta ventana.",
    srcReply: "Respuesta a: $1", srcDraft: "Correo nuevo: borrador a partir de sus indicaciones o notas.", noText: "Aún no hay texto propio. Escriba algo o seleccione una parte.",
    applied: "Insertado: Ctrl+Z lo deshace.", noScript: "La ventana de redacción ya estaba abierta antes de iniciarse NovaBird. Guarde el correo, ciérrelo y vuelva a abrirlo.",
    remote: "El texto se envía a $1.", fail: "No ha funcionado:", feature: "«Escribir» está desactivado en los ajustes, en «IA».",
    disabled: "La IA está desactivada. Puede activarla en los ajustes, en «IA».", off: "La IA no está configurada. La dirección y el modelo están en los ajustes, en «IA».", model: "No se ha indicado ningún modelo.",
    empty: "No hay texto que procesar.", permission: "Falta el permiso para esta dirección. Guárdela en los ajustes, en «IA», y confirme el permiso.", url: "La dirección no es válida.",
    code: "El código de emparejamiento no coincide (interfaz web del helper → Conexión).", nomodel: "No hay ningún modelo de lenguaje elegido en el helper (interfaz web → Modelo de lenguaje).", answer: "No se pudo verificar la respuesta del helper.", helper: "Error en el helper.",
    forbidden: "El servidor rechazó la solicitud (403)." },
};
const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const t = TEXTS[lang] || TEXTS.en;
const $ = id => document.getElementById(id);
const KINDS = ["reply", "fix", "tone", "translate"];
const TAB_LABEL = { reply: t.tabReply, fix: t.tabFix, tone: t.tabTone, translate: t.tabTranslate };

const tabs = [...document.querySelectorAll(".tabs button")];
for (const b of tabs) {
  b.querySelector("span").textContent = TAB_LABEL[b.dataset.kind];
  b.addEventListener("click", () => select(b.dataset.kind));
}
$("go").textContent = t.go;
$("toneLabel").textContent = t.toneLabel;
$("toLabel").textContent = t.toLabel;
$("again").textContent = t.again;
$("copy").textContent = t.copy;
$("settings").textContent = t.settings;
for (const [v, label] of Object.entries(t.tones)) $("tone").append(new Option(label, v));
for (const code of nbAI.TRANSLATE_LANGS) $("toLang").append(new Option(nbAI.languageName(lang, code), code));

const state = Object.fromEntries(KINDS.map(k => [k, { text: "", error: "", busy: false, done: false, source: "", notes: [] }]));
let kind = "reply";
let tab = null;
let details = null;
let ctx = { selection: "", own: "" }; // Text im Editor beim Öffnen
let scriptOk = true;
let related = null; // Mail, auf die geantwortet wird
const port = messenger.runtime.connect({ name: "nbx-write" });

port.onMessage.addListener(j => {
  const k = j.kind;
  if (!state[k]) return;
  Object.assign(state[k], {
    text: j.text || "", busy: j.status === "running", done: j.status !== "running", source: j.source,
    error: j.error ? t[j.error] || `${t.fail}\n${j.error}` : "",
    notes: (j.notes || []).map(n => (n.k === "remote" ? t.remote.replace("$1", n.v) : "")).filter(Boolean),
  });
  if (k === kind) show();
});

function textToEdit() {
  return ctx.selection || ctx.own;
}

function show() {
  const s = state[kind];
  for (const b of tabs) b.setAttribute("aria-selected", String(b.dataset.kind === kind));
  $("replyBar").hidden = kind !== "reply";
  $("toneBar").hidden = kind !== "tone";
  $("translateBar").hidden = kind !== "translate";
  $("wish").placeholder = related ? t.wishReply : t.wishDraft;
  let source;
  if (kind === "reply") source = related ? t.srcReply.replace("$1", related.subject || "") : t.srcDraft;
  else source = !textToEdit() ? t.noText : ctx.selection ? t.srcSelection : t.srcOwn;
  $("source").textContent = source;
  $("out").classList.toggle("busy", s.busy);
  $("out").textContent = s.text || (s.busy ? t.working : "");
  $("apply").textContent = kind === "reply" ? t.applyReply : t.apply;
  $("apply").disabled = !s.done || !s.text || Boolean(s.error) || !scriptOk;
  $("again").disabled = s.busy || (kind !== "reply" && !textToEdit());
  $("copy").disabled = !s.text;
  const err = s.error || (!scriptOk ? t.noScript : "");
  $("err").hidden = !err;
  $("err").textContent = err;
  $("note").hidden = !s.notes.length;
  $("note").textContent = s.notes.join(" ");
}

function run(which, reuse = false) {
  const s = state[which];
  const text = which === "reply" ? ctx.own : textToEdit();
  if (which !== "reply" && !text) return show();
  Object.assign(s, { text: "", error: "", busy: true, done: false, notes: [] });
  show();
  port.postMessage({
    type: "start", reuse, tabId: tab.id, kind: which, uiLang: lang, text, wish: $("wish").value, tone: $("tone").value, toLang: $("toLang").value,
    relatedId: which === "reply" && related ? related.id : null, source: ctx.selection && which !== "reply" ? "selection" : "own",
  });
}

function select(next) {
  kind = next;
  messenger.storage.local.set({ aiWriteMode: kind }).catch(() => {});
  show();
  // Korrektur, Ton und Übersetzen starten gleich; die Antwort erst mit „Entwurf schreiben“ (Vorgabe eintippen)
  if (kind !== "reply" && !state[kind].done && !state[kind].busy && textToEdit()) run(kind, true);
}

$("go").addEventListener("click", () => run("reply"));
$("wish").addEventListener("keydown", e => {
  if (e.key === "Enter") run("reply");
});
$("again").addEventListener("click", () => run(kind));
$("tone").addEventListener("change", () => {
  messenger.storage.local.set({ aiWriteTone: $("tone").value }).catch(() => {});
  run("tone");
});
$("toLang").addEventListener("change", () => {
  messenger.storage.local.set({ aiWriteTo: $("toLang").value }).catch(() => {});
  run("translate");
});
$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state[kind].text);
  $("copy").textContent = t.copied;
  setTimeout(() => ($("copy").textContent = t.copy), 1500);
});
$("apply").addEventListener("click", async () => {
  const s = state[kind];
  const mode = kind === "reply" ? "cursor" : s.source === "selection" ? "selection" : "own";
  try {
    await messenger.tabs.sendMessage(tab.id, { type: "nbx-compose-insert", text: s.text, mode, plain: Boolean(details?.isPlainText) });
    $("note").hidden = false;
    $("note").textContent = t.applied;
    window.close();
  } catch (e) {
    scriptOk = false;
    show();
  }
});
$("settings").addEventListener("click", () => {
  messenger.settingsRedesign.openHub("ai").catch(() => messenger.runtime.openOptionsPage());
  window.close();
});

(async () => {
  [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
  const saved = await messenger.storage.local.get({ aiWriteMode: "reply", aiWriteTone: "friendly", aiWriteTo: "", aiFeatures: {}, ...nbAI.DEFAULTS }).catch(() => ({}));
  $("model").textContent = saved.aiType === "nbhelper" ? "NovaBird Helper" : saved.aiModel || "";
  if (t.tones[saved.aiWriteTone]) $("tone").value = saved.aiWriteTone;
  $("toLang").value = nbAI.TRANSLATE_LANGS.includes(saved.aiWriteTo) ? saved.aiWriteTo : lang === "en" ? "de" : "en";
  try {
    details = await messenger.compose.getComposeDetails(tab.id);
    if (details.relatedMessageId && ["reply", "forward"].includes(details.type)) related = await messenger.messages.get(details.relatedMessageId);
  } catch {
    /* kein Verfassen-Tab */
  }
  try {
    ctx = (await messenger.tabs.sendMessage(tab.id, { type: "nbx-compose-get" })) || ctx;
  } catch {
    scriptOk = false;
  }
  for (const k of KINDS) port.postMessage({ type: "watch", tabId: tab.id, kind: k });
  if (!nbAI.feature(saved, "compose")) {
    state[kind].error = t.feature;
  }
  // Mit markiertem Text ist meist Korrektur/Ton gemeint, sonst zuletzt benutzter Reiter
  select(ctx.selection && saved.aiWriteMode === "reply" ? "fix" : KINDS.includes(saved.aiWriteMode) ? saved.aiWriteMode : "reply");
})();
