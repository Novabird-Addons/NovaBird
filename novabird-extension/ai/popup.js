"use strict";

// KI-Fenster der Nachrichtenansicht: Reiter Zusammenfassung, Übersetzen, Termine. Der zuletzt benutzte Reiter öffnet wieder.
const TEXTS = {
  de: { tabSummary: "Zusammenfassung", tabTranslate: "Übersetzen", tabEvents: "Termine",
    again: "Neu erstellen", copy: "Kopieren", copied: "Kopiert", settings: "Einstellungen",
    working: "Wird zusammengefasst …", translating: "Wird übersetzt …", finding: "Suche Termine und Aufgaben …", toLabel: "Nach",
    noEvents: "Keine Termine oder Aufgaben in dieser Nachricht gefunden.", toCalendar: "Im Kalender prüfen ($1)",
    calendarHint: "Thunderbird öffnet für jeden ausgewählten Eintrag den Termin-Dialog. Eingetragen wird erst, wenn du dort speicherst.",
    opened: "$1 Dialog(e) geöffnet – bitte prüfen und speichern.", allDay: "ganztägig", due: "fällig $1", noDue: "ohne Frist", detach: "In eigenem Fenster öffnen – bleibt offen, bis du es schließt", quotedOmitted: "Zitierte ältere Nachrichten wurden weggelassen – es zählt nur diese Mail.", nocalendar: "Es gibt keinen eingeschalteten Kalender, in den sich Termine eintragen lassen. Bitte im Kalender von Thunderbird einen Kalender anlegen oder einschalten.", fromMail: "Aus der E-Mail",
    json: "Die Antwort der KI ließ sich nicht lesen. „Neu erstellen“ versucht es noch einmal.",
    noMessage: "Keine Nachricht ausgewählt.", empty: "Die Nachricht enthält keinen Text.", off: "Die KI ist nicht eingerichtet. Adresse und Modell stehen in den Einstellungen unter „KI“.",
    truncated: "Nur der Anfang der Nachricht wurde berücksichtigt (sehr lang).", fail: "Das hat nicht geklappt:",
    permission: "Für diese Adresse fehlt die Erlaubnis. Bitte in den Einstellungen unter „KI“ speichern und die Erlaubnis bestätigen.", model: "Es ist kein Modell eingetragen.", url: "Die Adresse ist ungültig.",
    remote: "Der Nachrichtentext wird an $1 gesendet.",
    disabled: "Die KI ist ausgeschaltet. Sie lässt sich in den Einstellungen unter „KI“ einschalten.",
    injection: "Die Nachricht enthält Sätze, die wie Anweisungen an KI-Systeme aussehen. Das Ergebnis mit Vorsicht lesen.",
    forbidden: "Der Server hat die Anfrage abgelehnt (403). Bei Ollama hilft die Umgebungsvariable OLLAMA_ORIGINS=moz-extension://*; bei anderen Diensten prüfen, ob Benutzername und Schlüssel stimmen.", code: "Der Kopplungscode passt nicht (Web-Oberfläche des Helpers → Verbindung).", nomodel: "Im Helper ist kein Sprachmodell gewählt (Web-Oberfläche → Sprachmodell).", answer: "Die Antwort des Helpers ließ sich nicht prüfen.", helper: "Fehler im Helper." },
  en: { tabSummary: "Summary", tabTranslate: "Translate", tabEvents: "Dates",
    again: "Regenerate", copy: "Copy", copied: "Copied", settings: "Settings",
    working: "Summarising …", translating: "Translating …", finding: "Looking for dates and tasks …", toLabel: "Into",
    noEvents: "No appointments or tasks found in this message.", toCalendar: "Review in calendar ($1)",
    calendarHint: "Thunderbird opens the event dialog for each selected entry. Nothing is added until you save it there.",
    opened: "$1 dialog(s) opened – please review and save.", allDay: "all day", due: "due $1", noDue: "no deadline", detach: "Open in its own window – stays open until you close it", quotedOmitted: "Quoted earlier messages were left out – only this mail counts.", nocalendar: "There is no enabled calendar that events can be added to. Please create or enable a calendar in Thunderbird’s calendar.", fromMail: "From the e-mail",
    json: "The AI's answer could not be read. “Regenerate” tries again.",
    noMessage: "No message selected.", empty: "The message has no text.", off: "AI is not set up. Address and model are in the settings under “AI”.",
    truncated: "Only the beginning of the message was used (very long).", fail: "That did not work:",
    permission: "Permission for this address is missing. Please save it in the settings under “AI” and confirm the permission.", model: "No model has been entered.", url: "The address is invalid.",
    remote: "The message text is sent to $1.",
    disabled: "AI is switched off. You can switch it on in the settings under “AI”.",
    injection: "The message contains sentences that look like instructions to AI systems. Read the result with caution.",
    forbidden: "The server refused the request (403). For Ollama set the environment variable OLLAMA_ORIGINS=moz-extension://*; for other services check the user name and key.", code: "The pairing code does not match (helper web interface → Connection).", nomodel: "No language model is selected in the helper (web interface → Language model).", answer: "The helper's answer could not be verified.", helper: "Error in the helper." },
  fr: { tabSummary: "Résumé", tabTranslate: "Traduire", tabEvents: "Rendez-vous",
    again: "Régénérer", copy: "Copier", copied: "Copié", settings: "Paramètres",
    working: "Résumé en cours …", translating: "Traduction en cours …", finding: "Recherche des rendez-vous et tâches …", toLabel: "Vers",
    noEvents: "Aucun rendez-vous ni tâche trouvé dans ce message.", toCalendar: "Vérifier dans l’agenda ($1)",
    calendarHint: "Thunderbird ouvre la fenêtre d’événement pour chaque entrée choisie. Rien n’est ajouté avant que vous enregistriez.",
    opened: "$1 fenêtre(s) ouverte(s) – vérifiez et enregistrez.", allDay: "toute la journée", due: "échéance $1", noDue: "sans échéance", detach: "Ouvrir dans une fenêtre – reste ouverte jusqu’à sa fermeture", quotedOmitted: "Les messages précédents cités ont été ignorés – seul ce message compte.", nocalendar: "Aucun agenda activé ne permet d’ajouter des événements. Créez ou activez un agenda dans l’agenda de Thunderbird.", fromMail: "Tiré de l’e-mail",
    json: "La réponse de l’IA n’a pas pu être lue. « Régénérer » réessaie.",
    noMessage: "Aucun message sélectionné.", empty: "Le message ne contient pas de texte.", off: "L’IA n’est pas configurée. L’adresse et le modèle se trouvent dans les paramètres sous « IA ».",
    truncated: "Seul le début du message a été pris en compte (très long).", fail: "Cela n’a pas fonctionné :",
    permission: "L’autorisation pour cette adresse manque. Enregistrez-la dans les paramètres sous « IA » et confirmez l’autorisation.", model: "Aucun modèle n’est indiqué.", url: "L’adresse est invalide.",
    remote: "Le texte du message est envoyé à $1.",
    disabled: "L’IA est désactivée. Vous pouvez l’activer dans les paramètres sous « IA ».",
    injection: "Le message contient des phrases qui ressemblent à des instructions pour des systèmes d’IA. Lisez le résultat avec prudence.",
    forbidden: "Le serveur a refusé la requête (403). Avec Ollama, définissez la variable d’environnement OLLAMA_ORIGINS=moz-extension://* ; pour les autres services, vérifiez le nom d’utilisateur et la clé.", code: "Le code d’appairage ne correspond pas (interface web du helper → Connexion).", nomodel: "Aucun modèle de langage n’est choisi dans le helper (interface web → Modèle de langage).", answer: "La réponse du helper n’a pas pu être vérifiée.", helper: "Erreur dans le helper." },
  es: { tabSummary: "Resumen", tabTranslate: "Traducir", tabEvents: "Citas",
    again: "Volver a generar", copy: "Copiar", copied: "Copiado", settings: "Ajustes",
    working: "Resumiendo …", translating: "Traduciendo …", finding: "Buscando citas y tareas …", toLabel: "Al",
    noEvents: "No se encontraron citas ni tareas en este mensaje.", toCalendar: "Revisar en el calendario ($1)",
    calendarHint: "Thunderbird abre la ventana de evento para cada entrada elegida. No se añade nada hasta que la guarde allí.",
    opened: "$1 ventana(s) abierta(s): revise y guarde.", allDay: "todo el día", due: "vence $1", noDue: "sin plazo", detach: "Abrir en una ventana propia: queda abierta hasta cerrarla", quotedOmitted: "Se omitieron los mensajes anteriores citados: solo cuenta este correo.", nocalendar: "No hay ningún calendario activado en el que se puedan añadir eventos. Cree o active un calendario en el calendario de Thunderbird.", fromMail: "Del correo",
    json: "No se pudo leer la respuesta de la IA. «Volver a generar» lo intenta de nuevo.",
    noMessage: "Ningún mensaje seleccionado.", empty: "El mensaje no tiene texto.", off: "La IA no está configurada. La dirección y el modelo están en los ajustes, en «IA».",
    truncated: "Solo se usó el principio del mensaje (muy largo).", fail: "No ha funcionado:",
    permission: "Falta el permiso para esta dirección. Guárdela en los ajustes, en «IA», y confirme el permiso.", model: "No se ha indicado ningún modelo.", url: "La dirección no es válida.",
    remote: "El texto del mensaje se envía a $1.",
    disabled: "La IA está desactivada. Puede activarla en los ajustes, en «IA».",
    injection: "El mensaje contiene frases que parecen instrucciones para sistemas de IA. Lea el resultado con precaución.",
    forbidden: "El servidor rechazó la solicitud (403). Con Ollama defina la variable de entorno OLLAMA_ORIGINS=moz-extension://*; en otros servicios compruebe el usuario y la clave.", code: "El código de emparejamiento no coincide (interfaz web del helper → Conexión).", nomodel: "No hay ningún modelo de lenguaje elegido en el helper (interfaz web → Modelo de lenguaje).", answer: "No se pudo verificar la respuesta del helper.", helper: "Error en el helper." },
};
const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const t = TEXTS[lang] || TEXTS.en;
const $ = id => document.getElementById(id);
const MODES = ["summary", "translate", "events"];
const TAB_LABEL = { summary: t.tabSummary, translate: t.tabTranslate, events: t.tabEvents };

const tabs = [...document.querySelectorAll(".tabs button")];
for (const b of tabs) {
  b.querySelector("span").textContent = TAB_LABEL[b.dataset.mode];
  b.addEventListener("click", () => select(b.dataset.mode));
}
if (new URLSearchParams(location.search).has("ids") || new URLSearchParams(location.search).has("msg")) {
  document.body.classList.add("win"); // eigenes Fenster (Konversation oder abgelöst): Breite des Fensters nutzen
}
$("again").textContent = t.again;
$("copy").textContent = t.copy;
$("settings").textContent = t.settings;
$("toLabel").textContent = t.toLabel;
for (const code of nbAI.TRANSLATE_LANGS) {
  $("toLang").append(new Option(nbAI.languageName(lang, code), code));
}

// Gerechnet wird im Hintergrund (ai/jobs.js); hier nur Anzeige. Ergebnis je Reiter (Wechsel ohne neues Rechnen).
const state = Object.fromEntries(MODES.map(m => [m, { key: null, text: "", items: null, error: "", notes: [], warn: false, busy: false, done: false }]));
const params = new URLSearchParams(location.search);
const inWindow = params.has("ids") || params.has("msg"); // eigenes Fenster statt Popup
let mode = "summary";
let source = null; // {messageId, tabId} oder {ids} – einmal ermittelt
let opened = 0;
const port = messenger.runtime.connect({ name: "nbx-ai" });
const keyOf = r => [r.mode, r.ids ? `t${r.ids.join(",")}` : `m${r.messageId}`, r.mode === "translate" ? r.toLang : "", r.uiLang].join("|");
const NOTE_TEXT = n => (n.k === "remote" ? t.remote.replace("$1", n.v) : n.k === "quoted" ? t.quotedOmitted : n.k === "truncated" ? t.truncated : "");

// Stand eines Auftrags aus dem Hintergrund übernehmen (nur den zuletzt angeforderten je Reiter)
port.onMessage.addListener(j => {
  const s = state[j.mode];
  if (!s || j.key !== s.key) return;
  const selected = s.items?.map(it => it.selected);
  s.text = j.text || "";
  s.items = j.items ? j.items.map((it, i) => ({ ...it, selected: selected?.[i] ?? true, description: `${it.note ? it.note + "\n\n" : ""}${t.fromMail}: ${j.from}` })) : null;
  s.notes = (j.notes || []).map(NOTE_TEXT).filter(Boolean);
  s.warn = j.warn;
  s.error = j.error ? t[j.error] || `${t.fail}\n${j.error}` : "";
  s.busy = j.status === "running";
  s.done = j.status !== "running";
  if (j.model) $("model").textContent = j.model;
  if (j.mode === mode) show();
});

// Kleine Darstellung: **fett** und Aufzählungspunkte; kein HTML aus der Antwort
function renderText(text) {
  const out = $("out");
  out.replaceChildren();
  const lines = text.split(/\r?\n/);
  lines.forEach((raw, i) => {
    const line = raw.replace(/^\s*[*-]\s+/, "• ");
    line.split(/(\*\*[^*]+\*\*)/).forEach(part => {
      if (/^\*\*[^*]+\*\*$/.test(part)) {
        const b = document.createElement("strong");
        b.textContent = part.slice(2, -2);
        out.append(b);
      } else if (part) {
        out.append(part.replace(/\*\*/g, ""));
      }
    });
    if (i < lines.length - 1) out.append(document.createTextNode("\u000a"));
  });
}

const fmtDay = s => new Date(`${s.slice(0, 10)}T12:00`).toLocaleDateString(lang, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const fmtTime = s => (s.length > 10 ? new Date(s).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" }) : "");

function whenText(it) {
  if (it.type === "task") {
    return it.due ? t.due.replace("$1", fmtDay(it.due)) : t.noDue;
  }
  if (it.allDay) {
    return it.end && it.end !== it.start ? `${fmtDay(it.start)} – ${fmtDay(it.end)} · ${t.allDay}` : `${fmtDay(it.start)} · ${t.allDay}`;
  }
  const sameDay = it.end && it.end.slice(0, 10) === it.start.slice(0, 10);
  const end = !it.end ? "" : sameDay ? `–${fmtTime(it.end)}` : ` – ${fmtDay(it.end)}, ${fmtTime(it.end)}`;
  return `${fmtDay(it.start)}, ${fmtTime(it.start)}${end}`;
}

const ICON = {
  event: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  task: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 12l3 3 5-6"/>',
};

function renderItems(items) {
  const list = $("items");
  list.replaceChildren();
  for (const it of items) {
    const li = document.createElement("li");
    const box = Object.assign(document.createElement("input"), { type: "checkbox", checked: it.selected !== false });
    box.addEventListener("change", () => {
      it.selected = box.checked;
      li.classList.toggle("off", !box.checked);
      updateCalendarButton();
    });
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 24 24");
    icon.classList.add("icon");
    icon.innerHTML = ICON[it.type]; // feste Formen aus dieser Datei, kein Text der KI
    const what = Object.assign(document.createElement("div"), { className: "what", textContent: it.title });
    li.append(box, icon, what, Object.assign(document.createElement("div"), { className: "when", textContent: whenText(it) }));
    if (it.location) li.append(Object.assign(document.createElement("div"), { className: "where", textContent: it.location }));
    if (it.note) li.append(Object.assign(document.createElement("div"), { className: "note", textContent: it.note }));
    li.classList.toggle("off", it.selected === false);
    list.append(li);
  }
}

function updateCalendarButton() {
  const items = state.events.items || [];
  const n = items.filter(it => it.selected !== false).length;
  $("toCalendar").textContent = t.toCalendar.replace("$1", String(n));
  $("toCalendar").disabled = n === 0;
}

// Anzeige des aktiven Reiters aus seinem Zustand
function show() {
  const s = state[mode];
  for (const b of tabs) b.setAttribute("aria-selected", String(b.dataset.mode === mode));
  $("translateBar").hidden = mode !== "translate";
  const isEvents = mode === "events";
  const hasItems = isEvents && s.items && s.items.length > 0;
  $("items").hidden = !hasItems;
  $("out").hidden = hasItems;
  $("out").classList.toggle("busy", s.busy);
  if (hasItems) {
    renderItems(s.items);
  } else if (isEvents && s.done && !s.error) {
    $("out").replaceChildren(Object.assign(document.createElement("div"), { className: "empty", textContent: t.noEvents }));
  } else {
    renderText(s.text || (s.busy ? { summary: t.working, translate: t.translating, events: t.finding }[mode] : ""));
  }
  $("toCalendar").hidden = !hasItems;
  if (hasItems) updateCalendarButton();
  $("copy").hidden = isEvents;
  $("again").disabled = s.busy && !s.text;
  $("err").hidden = !s.error;
  $("err").textContent = s.error;
  const notes = [...s.notes, ...(hasItems ? [opened ? t.opened.replace("$1", String(opened)) : t.calendarHint] : [])];
  $("note").hidden = notes.length === 0;
  $("note").textContent = notes.join(" ");
  $("warn").hidden = !s.warn;
  $("warn").textContent = s.warn ? t.injection : "";
}

function select(next) {
  mode = next;
  messenger.storage.local.set({ aiLastMode: mode }).catch(() => {});
  show();
  if (!state[mode].done && !state[mode].busy) run(mode);
}

// Angezeigte Nachricht des Tabs. messageDisplay.getDisplayedMessage wartet auf das Laden des Lesebereichs; unter
// Thunderbird 158 kam diese Antwort im Test nicht. Daher höchstens 500 ms warten, sonst im Mail-Tab die ausgewählte Nachricht nehmen.
async function displayedMessage(tab) {
  const pending = messenger.messageDisplay.getDisplayedMessage(tab.id).catch(() => null);
  const shown = await Promise.race([pending, new Promise(resolve => setTimeout(() => resolve(undefined), 500))]);
  if (shown !== undefined) {
    return shown || null;
  }
  if (tab.type !== "mail") {
    return (await pending) || null; // eigenes Nachrichtenfenster: keine Auswahl zum Ausweichen, weiter warten
  }
  try {
    const sel = await messenger.mailTabs.getSelectedMessages(tab.id);
    return sel?.messages?.length === 1 ? sel.messages[0] : null;
  } catch (e) {
    return null;
  }
}

// Nachricht oder Konversation einmal ermitteln: ?ids=1,2,3 (Konversation), ?msg=5 (eigenes Fenster), sonst angezeigte Mail
async function getSource() {
  if (source) return source;
  const ids = (params.get("ids") || "").split(",").map(Number).filter(n => Number.isInteger(n) && n > 0);
  const msg = Number(params.get("msg"));
  if (ids.length) {
    source = { ids };
  } else if (Number.isInteger(msg) && msg > 0) {
    source = { messageId: msg };
  } else {
    const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
    const message = tab && (await displayedMessage(tab));
    if (!message) throw new Error("noMessage");
    source = { messageId: message.id, tabId: tab.id };
  }
  return source;
}

// Auftrag an den Hintergrund: läuft dort weiter, auch wenn das Popup zugeht; force = neu rechnen
async function run(which, force = false) {
  const s = state[which];
  if (which === "events") opened = 0;
  try {
    const src = await getSource();
    const r = { type: "start", mode: which, uiLang: lang, toLang: $("toLang").value, force, ...src };
    s.key = keyOf(r);
    Object.assign(s, { text: "", items: null, error: "", notes: [], warn: false, busy: true, done: false });
    show();
    port.postMessage(r);
  } catch (e) {
    const key = String(e.message || e);
    Object.assign(s, { error: t[key] || `${t.fail}\n${key}`, busy: false, done: true });
    show();
  }
}

// Eigenes Fenster: bleibt offen, bis man es schließt (das Popup geht beim Klick daneben zu)
$("detach").hidden = inWindow;
$("detach").title = t.detach;
$("detach").addEventListener("click", async () => {
  try {
    const src = await getSource();
    const q = src.ids ? `ids=${src.ids.join(",")}` : `msg=${src.messageId}`;
    await messenger.windows.create({ url: messenger.runtime.getURL(`ai/popup.html?${q}&mode=${mode}`), type: "popup", width: 660, height: 760 });
    window.close();
  } catch (e) {
    /* keine Nachricht: bleibt im Popup */
  }
});

$("again").addEventListener("click", () => run(mode, true));
$("toLang").addEventListener("change", () => {
  messenger.storage.local.set({ aiTranslateTo: $("toLang").value }).catch(() => {});
  run("translate");
});
$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(state[mode].text);
  $("copy").textContent = t.copied;
  setTimeout(() => ($("copy").textContent = t.copy), 1500);
});
$("toCalendar").addEventListener("click", async () => {
  const chosen = (state.events.items || []).filter(it => it.selected !== false);
  try {
    const fields = ["type", "title", "start", "end", "due", "allDay", "location", "description"];
    opened = await messenger.novaCalendar.openItemDialogs(chosen.map(it =>
      Object.fromEntries(fields.filter(k => it[k] !== undefined && it[k] !== "").map(k => [k, it[k]]))));
  } catch (e) {
    const key = String(e.message || e).replace(/^Error: /, "");
    state.events.error = t[key] || `${t.fail}\n${key}`;
  }
  show();
});
$("settings").addEventListener("click", () => {
  try {
    localStorage.setItem("nbxOptionsTab", "aiTab"); // Optionsseite öffnet im Reiter KI
  } catch {}
  messenger.settingsRedesign.openHub("extension").catch(() => messenger.runtime.openOptionsPage());
  window.close();
});

(async () => {
  const saved = await messenger.storage.local.get({ aiLastMode: "summary", aiTranslateTo: "" }).catch(() => ({}));
  const to = nbAI.TRANSLATE_LANGS.includes(saved.aiTranslateTo) ? saved.aiTranslateTo : nbAI.TRANSLATE_LANGS.includes(lang) ? lang : "en";
  $("toLang").value = to;
  const wanted = params.get("mode");
  select(MODES.includes(wanted) ? wanted : MODES.includes(saved.aiLastMode) ? saved.aiLastMode : "summary");
})();
