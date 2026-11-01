"use strict";

// „Was gibt's Neues?“ (Knopf oben in der Leiste): KI-Überblick über die neuen Mails der Posteingänge. Die Nummern [n] in der
// Antwort werden zu Knöpfen, die die jeweilige Mail öffnen.
const TEXTS = {
  de: { sched: "Automatisch", speak: "Vorlesen", speakStop: "Stopp", speakWait: "Stimme startet …", speakFail: "Vorlesen hat nicht geklappt:", schedOff: "aus", schedDaily: "täglich um", schedHours: "alle … Stunden", everyFmt: "$1 Std.", stand: "Stand $1", standAuto: "Stand $1 (automatisch)", tasks: "Aufgaben für heute ($1)", tasksDone: "$1 Aufgabe(n) im Kalender „$2“ angelegt, fällig heute.", nocalendar: "Es gibt keinen eingeschalteten Kalender für Aufgaben.", fromMail: "Aus der E-Mail", todo: /^(zu erledigen|aufgaben)/i, title: "Was gibt's Neues?", period: "Zeitraum", unread: "nur ungelesene", hours: { 12: "letzte 12 Stunden", 24: "letzte 24 Stunden", 72: "letzte 3 Tage", 168: "letzte 7 Tage" },
    again: "Aktualisieren", copy: "Kopieren", copied: "Kopiert", settings: "Einstellungen", reading: "Lese die neuen Mails …", working: "Erstelle den Überblick über $1 Mails …",
    none: "Keine neuen Mails im gewählten Zeitraum.", count: "$1 Mails berücksichtigt.", more: "$1 neue Mails, berücksichtigt sind die neuesten $2.",
    open: "Mail öffnen", remote: "Die Mailtexte werden an $1 gesendet.", injection: "Unter den Mails sind Sätze, die wie Anweisungen an KI-Systeme aussehen. Den Überblick mit Vorsicht lesen.",
    fail: "Das hat nicht geklappt:", disabled: "Die KI ist ausgeschaltet. Sie lässt sich in den Einstellungen unter „KI“ einschalten.", off: "Die KI ist nicht eingerichtet. Adresse und Modell stehen in den Einstellungen unter „KI“.", model: "Es ist kein Modell eingetragen.",
    permission: "Für diese Adresse fehlt die Erlaubnis. Bitte in den Einstellungen unter „KI“ speichern und die Erlaubnis bestätigen.", url: "Die Adresse ist ungültig.", code: "Der Kopplungscode passt nicht (Web-Oberfläche des Helpers → Verbindung).", nomodel: "Im Helper ist kein Sprachmodell gewählt (Web-Oberfläche → Sprachmodell).", answer: "Die Antwort des Helpers ließ sich nicht prüfen.", helper: "Fehler im Helper.",
    forbidden: "Der Server hat die Anfrage abgelehnt (403). Bei Ollama hilft die Umgebungsvariable OLLAMA_ORIGINS=moz-extension://*.",
    sorting: "Ordne die Mails ein: $1 von $2 …", feature: "„Was gibt's Neues?“ ist in den Einstellungen unter „KI“ ausgeschaltet." },
  en: { sched: "Automatically", speak: "Read aloud", speakStop: "Stop", speakWait: "Starting voice …", speakFail: "Reading aloud did not work:", schedOff: "off", schedDaily: "daily at", schedHours: "every … hours", everyFmt: "$1 h", stand: "As of $1", standAuto: "As of $1 (automatic)", tasks: "Tasks for today ($1)", tasksDone: "$1 task(s) created in calendar “$2”, due today.", nocalendar: "There is no enabled calendar for tasks.", fromMail: "From the e-mail", todo: /^(to do|tasks)/i, title: "What's new?", period: "Period", unread: "unread only", hours: { 12: "last 12 hours", 24: "last 24 hours", 72: "last 3 days", 168: "last 7 days" },
    again: "Refresh", copy: "Copy", copied: "Copied", settings: "Settings", reading: "Reading the new mail …", working: "Writing the overview of $1 messages …",
    none: "No new mail in the chosen period.", count: "$1 messages included.", more: "$1 new messages; the newest $2 are included.",
    open: "Open message", remote: "The message texts are sent to $1.", injection: "Some messages contain sentences that look like instructions to AI systems. Read the overview with caution.",
    fail: "That did not work:", disabled: "AI is switched off. You can switch it on in the settings under “AI”.", off: "AI is not set up. Address and model are in the settings under “AI”.", model: "No model has been entered.",
    permission: "Permission for this address is missing. Please save it in the settings under “AI” and confirm the permission.", url: "The address is invalid.", code: "The pairing code does not match (helper web interface → Connection).", nomodel: "No language model is selected in the helper (web interface → Language model).", answer: "The helper's answer could not be verified.", helper: "Error in the helper.",
    forbidden: "The server refused the request (403). For Ollama set the environment variable OLLAMA_ORIGINS=moz-extension://*.",
    sorting: "Sorting the messages: $1 of $2 …", feature: "“What's new?” is switched off in the settings under “AI”." },
  fr: { sched: "Automatique", speak: "Lire à voix haute", speakStop: "Arrêter", speakWait: "Démarrage de la voix …", speakFail: "La lecture à voix haute n’a pas fonctionné :", schedOff: "désactivé", schedDaily: "chaque jour à", schedHours: "toutes les … heures", everyFmt: "$1 h", stand: "État $1", standAuto: "État $1 (automatique)", tasks: "Tâches pour aujourd’hui ($1)", tasksDone: "$1 tâche(s) créée(s) dans l’agenda « $2 », pour aujourd’hui.", nocalendar: "Aucun agenda activé pour les tâches.", fromMail: "Tiré de l’e-mail", todo: /^(à faire|tâches)/i, title: "Quoi de neuf ?", period: "Période", unread: "non lus seulement", hours: { 12: "12 dernières heures", 24: "24 dernières heures", 72: "3 derniers jours", 168: "7 derniers jours" },
    again: "Actualiser", copy: "Copier", copied: "Copié", settings: "Paramètres", reading: "Lecture des nouveaux messages …", working: "Rédaction de l’aperçu de $1 messages …",
    none: "Aucun nouveau message pendant la période choisie.", count: "$1 messages pris en compte.", more: "$1 nouveaux messages ; les $2 plus récents sont pris en compte.",
    open: "Ouvrir le message", remote: "Les textes des messages sont envoyés à $1.", injection: "Certains messages contiennent des phrases qui ressemblent à des instructions pour des systèmes d’IA. Lisez l’aperçu avec prudence.",
    fail: "Cela n’a pas fonctionné :", disabled: "L’IA est désactivée. Vous pouvez l’activer dans les paramètres sous « IA ».", off: "L’IA n’est pas configurée. L’adresse et le modèle se trouvent dans les paramètres sous « IA ».", model: "Aucun modèle n’est indiqué.",
    permission: "L’autorisation pour cette adresse manque. Enregistrez-la dans les paramètres sous « IA » et confirmez l’autorisation.", url: "L’adresse est invalide.", code: "Le code d’appairage ne correspond pas (interface web du helper → Connexion).", nomodel: "Aucun modèle de langage n’est choisi dans le helper (interface web → Modèle de langage).", answer: "La réponse du helper n’a pas pu être vérifiée.", helper: "Erreur dans le helper.",
    forbidden: "Le serveur a refusé la requête (403). Avec Ollama, définissez la variable d’environnement OLLAMA_ORIGINS=moz-extension://*.",
    sorting: "Classement des messages : $1 sur $2 …", feature: "« Quoi de neuf ? » est désactivé dans les paramètres sous « IA »." },
  es: { sched: "Automático", speak: "Leer en voz alta", speakStop: "Detener", speakWait: "Iniciando la voz …", speakFail: "La lectura en voz alta no ha funcionado:", schedOff: "desactivado", schedDaily: "cada día a las", schedHours: "cada … horas", everyFmt: "$1 h", stand: "Estado $1", standAuto: "Estado $1 (automático)", tasks: "Tareas para hoy ($1)", tasksDone: "$1 tarea(s) creada(s) en el calendario «$2», para hoy.", nocalendar: "No hay ningún calendario activado para tareas.", fromMail: "Del correo", todo: /^(pendiente|tareas)/i, title: "¿Qué hay de nuevo?", period: "Periodo", unread: "solo no leídos", hours: { 12: "últimas 12 horas", 24: "últimas 24 horas", 72: "últimos 3 días", 168: "últimos 7 días" },
    again: "Actualizar", copy: "Copiar", copied: "Copiado", settings: "Ajustes", reading: "Leyendo el correo nuevo …", working: "Preparando el resumen de $1 mensajes …",
    none: "No hay correo nuevo en el periodo elegido.", count: "$1 mensajes incluidos.", more: "$1 mensajes nuevos; se incluyen los $2 más recientes.",
    open: "Abrir mensaje", remote: "Los textos de los mensajes se envían a $1.", injection: "Algunos mensajes contienen frases que parecen instrucciones para sistemas de IA. Lea el resumen con precaución.",
    fail: "No ha funcionado:", disabled: "La IA está desactivada. Puede activarla en los ajustes, en «IA».", off: "La IA no está configurada. La dirección y el modelo están en los ajustes, en «IA».", model: "No se ha indicado ningún modelo.",
    permission: "Falta el permiso para esta dirección. Guárdela en los ajustes, en «IA», y confirme el permiso.", url: "La dirección no es válida.", code: "El código de emparejamiento no coincide (interfaz web del helper → Conexión).", nomodel: "No hay ningún modelo de lenguaje elegido en el helper (interfaz web → Modelo de lenguaje).", answer: "No se pudo verificar la respuesta del helper.", helper: "Error en el helper.",
    forbidden: "El servidor rechazó la solicitud (403). Con Ollama defina la variable de entorno OLLAMA_ORIGINS=moz-extension://*.",
    sorting: "Clasificando los mensajes: $1 de $2 …", feature: "«¿Qué hay de nuevo?» está desactivado en los ajustes, en «IA»." },
};
const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const t = TEXTS[lang] || TEXTS.en;
const $ = id => document.getElementById(id);
// eigenes Fenster (Zeitplan „Automatisch“): ganze Fensterhöhe nutzen, nur der Inhalt rollt (ai.css body.overview)
if (new URLSearchParams(location.search).get("win") === "1") document.body.classList.add("win");
const MAX_MAILS = 40; // passt mit je 700 Zeichen sicher in 16.384 Token
const PER_MAIL = 700;

$("title").textContent = t.title;
document.title = t.title;
$("periodLabel").textContent = t.period;
$("unreadLabel").textContent = t.unread;
$("again").textContent = t.again;
$("copy").textContent = t.copy;
$("settings").textContent = t.settings;
for (const [h, label] of Object.entries(t.hours)) {
  $("period").append(new Option(label, h));
}

let controller = null;
let plain = "";
let mails = [];
let todos = []; // Zeilen unter „Zu erledigen“: {title, refs, box}
const LAST = "aiOverviewLast";

function setNote(lines) {
  $("note").hidden = lines.length === 0;
  $("note").textContent = lines.join(" ");
}

function showError(key) {
  $("err").hidden = false;
  $("err").textContent = t[key] || `${t.fail}\n${key}`;
}

function openMail(n) {
  const m = mails[n - 1];
  if (m) messenger.messageDisplay.open({ messageId: m.id, location: "tab" }).catch(() => {});
}

const REF = /\[\d+(?:\s*,\s*\d+)*\]/g;
const refsOf = text => (text.match(REF) || []).flatMap(r => r.slice(1, -1).split(",").map(x => Number(x.trim())));

// **fett** und Verweise [3] bzw. [3, 5] als Knöpfe; kein HTML aus der Antwort
function appendParts(el, text) {
  for (const part of text.split(/(\*\*[^*]+\*\*|\[\d+(?:\s*,\s*\d+)*\])/)) {
    if (/^\*\*[^*]+\*\*$/.test(part)) {
      el.append(Object.assign(document.createElement("strong"), { textContent: part.slice(2, -2) }));
    } else if (/^\[\d+(?:\s*,\s*\d+)*\]$/.test(part)) {
      for (const n of refsOf(part)) {
        const m = mails[n - 1];
        if (!m) continue;
        const b = Object.assign(document.createElement("button"), { type: "button", className: "ref", textContent: String(n), title: `${t.open}: ${m.subject || ""}` });
        b.addEventListener("click", () => openMail(n));
        el.append(b);
      }
    } else if (part) {
      el.append(part.replace(/\*\*/g, ""));
    }
  }
}

// Abschnitte als Überschriften, jeder Stichpunkt ein eigener Block (Abstand per CSS); unter „Zu erledigen“ mit Häkchen
function render(text) {
  plain = text;
  const out = $("out");
  out.replaceChildren();
  todos = [];
  let section = "";
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim()) continue;
    const head = raw.match(/^\s*(?:#+\s*)?\*\*([^*]+?)\*\*\s*:?\s*$/) || raw.match(/^\s*#+\s*(.+?)\s*$/);
    if (head) {
      section = head[1].replace(/:$/, "").trim();
      out.append(Object.assign(document.createElement("h3"), { textContent: section }));
      continue;
    }
    const bullet = /^\s*[*•-]\s+/.test(raw);
    const content = raw.replace(/^\s*[*•-]\s+/, "");
    const line = document.createElement("div");
    line.className = bullet ? "item" : "para";
    if (bullet && t.todo.test(section)) {
      const label = document.createElement("label");
      label.className = "todo";
      const box = Object.assign(document.createElement("input"), { type: "checkbox" });
      box.addEventListener("change", updateTasksButton);
      const textEl = document.createElement("span");
      appendParts(textEl, content);
      label.append(box, textEl);
      line.append(label);
      todos.push({ title: content.replace(REF, "").replace(/\*\*/g, "").replace(/\s+([.,;:])/g, "$1").trim(), refs: refsOf(content), box });
    } else {
      if (bullet) line.append("• ");
      appendParts(line, content);
    }
    out.append(line);
  }
  updateTasksButton();
}

// Kalender für „Aufgaben für heute“ (bei mehreren wählbar, z. B. der Team-Kalender des Helpers; die Wahl wird gemerkt)
const TASK_CAL = "aiTaskCalendar";
async function fillTaskCalendars() {
  const list = await messenger.novaCalendar.taskCalendars().catch(() => []);
  const sel = $("taskCal");
  sel.replaceChildren(...list.map(c => new Option(c.name, c.id)));
  const { [TASK_CAL]: saved, aiCalendar } = await messenger.storage.local.get({ [TASK_CAL]: "", aiCalendar: "" });
  const fixed = list.some(c => c.id === aiCalendar) ? aiCalendar : "";
  sel.value = fixed || (list.some(c => c.id === saved) ? saved : list.find(c => c.selected)?.id || list[0]?.id || "");
  sel.dataset.many = list.length > 1 && !fixed ? "1" : ""; // fester Kalender (Einstellungen): keine Auswahl
  updateTasksButton();
}
$("taskCal").addEventListener("change", () => messenger.storage.local.set({ [TASK_CAL]: $("taskCal").value }));

function updateTasksButton() {
  const n = todos.filter(x => x.box.checked && !x.box.disabled).length;
  $("taskCal").hidden = todos.length === 0 || !$("taskCal").dataset.many;
  $("tasks").hidden = todos.length === 0;
  $("tasks").disabled = n === 0;
  $("tasks").textContent = t.tasks.replace("$1", String(n));
}

const time = at => new Date(at).toLocaleTimeString(lang, { hour: "2-digit", minute: "2-digit" });

function showResult(res, notes) {
  mails = res.mails || [];
  if (!res.text) {
    $("out").textContent = t.none;
    setNote(notes);
    return;
  }
  render(res.text);
  const total = res.total ?? mails.length;
  notes.push(total > mails.length ? t.more.replace("$1", String(total)).replace("$2", String(mails.length)) : t.count.replace("$1", String(mails.length)));
  setNote(notes);
  $("warn").hidden = !res.suspicious;
  $("warn").textContent = res.suspicious ? t.injection : "";
}

async function run() {
  controller?.abort();
  controller = new AbortController();
  const signal = controller.signal;
  $("err").hidden = true;
  $("warn").hidden = true;
  setNote([]);
  $("out").classList.add("busy");
  $("out").textContent = t.reading;
  plain = "";
  todos = [];
  updateTasksButton();
  const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
  $("model").textContent = conf.aiType === "nbhelper" ? "NovaBird Helper" : conf.aiModel;
  try {
    if (!conf.aiEnabled) throw new Error("disabled");
    if (!conf.aiUrl) throw new Error("off");
    if (!conf.aiModel && conf.aiType !== "nbhelper") throw new Error("model");
    if (!nbAI.feature(conf, "overview")) throw new Error("feature");
    const hours = Number($("period").value) || 24;
    let first = true;
    const res = conf.aiPrepare
      ? await preparedOverview({ hours, unreadOnly: $("unread").checked, max: MAX_MAILS }, signal)
      : await nbAI.overview(conf, lang, { hours, unreadOnly: $("unread").checked, max: MAX_MAILS, perMail: PER_MAIL }, partial => {
        if (partial || !first) {
          first = false;
          render(partial);
        }
      }, signal);
    const notes = [];
    if (!nbAI.isLocal(nbAI.base(conf))) notes.push(t.remote.replace("$1", new URL(nbAI.base(conf)).host));
    showResult(res, notes);
    showDeadlines();
    showSpeak();
    messenger.storage.local.set({ [LAST]: { at: Date.now(), scheduled: false, seen: true, hours, ...res } }).catch(() => {});
  } catch (e) {
    if (e.name === "AbortError") return;
    $("out").textContent = "";
    showError(String(e.message || e));
  } finally {
    $("out").classList.remove("busy");
  }
}

// „Vorbereiten“ an: Die Hintergrundseite ordnet jede Mail einzeln ein (fehlende jetzt, mit Helper auch von anderen PCs) und
// setzt den Überblick daraus zusammen (ai/prep.js)
function preparedOverview(opts, signal) {
  return new Promise((resolve, reject) => {
    const port = messenger.runtime.connect({ name: "nbx-prep" });
    signal.addEventListener("abort", () => {
      port.disconnect();
      reject(new DOMException("abgebrochen", "AbortError"));
    });
    port.onMessage.addListener(m => {
      if (m.type === "progress" && m.total) $("out").textContent = t.sorting.replace("$1", String(Math.min(m.done + 1, m.total))).replace("$2", String(m.total));
      if (m.type === "result") resolve(m.res);
      if (m.type === "error") reject(new Error(m.error));
      if (m.type !== "progress") port.disconnect();
    });
    port.postMessage({ type: "overview", uiLang: lang, ...opts });
  });
}

// Fristen der nächsten 7 Tage aus den eingeordneten Mails (Einstellung „Fristen“)
async function showDeadlines() {
  const conf = await messenger.storage.local.get({ aiFeatures: {} });
  if (!nbAI.feature(conf, "deadlines")) return;
  const list = await messenger.runtime.sendMessage({ type: "nbx-deadlines", days: 7 }).catch(() => []);
  nbDeadlines.render($("deadlines"), list || [], key => showError(key));
}

// Ausgewählte Zeilen unter „Zu erledigen“ als Aufgaben (fällig heute) anlegen
$("tasks").addEventListener("click", async () => {
  const chosen = todos.filter(x => x.box.checked && !x.box.disabled);
  const items = chosen.map(x => ({
    title: x.title.slice(0, 200),
    description: x.refs.map(n => mails[n - 1]).filter(Boolean).map(m => `${t.fromMail}: ${m.subject || ""} – ${m.author || ""}`).join("\n"),
  }));
  try {
    const res = await messenger.novaCalendar.createTasks(items, $("taskCal").value || undefined);
    for (const x of chosen) {
      x.box.disabled = true;
      x.box.closest(".item")?.classList.add("done");
    }
    updateTasksButton();
    setNote([t.tasksDone.replace("$1", String(res.count)).replace("$2", res.calendar)]);
  } catch (e) {
    const key = String(e.message || e).replace(/^Error: /, "");
    showError(key === "nocalendar" ? "nocalendar" : key);
  }
});

// Zeitplan (Hintergrund: ai/schedule.js)
const SCHEDULE = "aiOverviewSchedule";
$("schedLabel").textContent = t.sched;
for (const [v, label] of [["off", t.schedOff], ["daily", t.schedDaily], ["hours", t.schedHours]]) $("sched").append(new Option(label, v));
for (const h of [1, 2, 4, 8]) $("schedEvery").append(new Option(t.everyFmt.replace("$1", String(h)), String(h)));
function showSchedule(s) {
  $("sched").value = s.mode || "off";
  $("schedTime").value = s.time || "07:00";
  $("schedEvery").value = String(s.every || 2);
  $("schedTime").hidden = $("sched").value !== "daily";
  $("schedEvery").hidden = $("sched").value !== "hours";
}
const saveSchedule = () => {
  const s = { mode: $("sched").value, time: $("schedTime").value || "07:00", every: Number($("schedEvery").value) || 2 };
  showSchedule(s);
  messenger.storage.local.set({ [SCHEDULE]: s }).catch(() => {});
};
for (const id of ["sched", "schedTime", "schedEvery"]) $(id).addEventListener("change", saveSchedule);

const saveChoice = () => messenger.storage.local.set({ aiOverviewHours: Number($("period").value), aiOverviewUnread: $("unread").checked }).catch(() => {});
$("period").addEventListener("change", () => { saveChoice(); run(); });
$("unread").addEventListener("change", () => { saveChoice(); run(); });
$("again").addEventListener("click", run);

// Vorlesen (nur mit dem NovaBird Helper und einer Stimme): wie im KI-Fenster über die Hintergrundseite (ai/speech.js),
// liest weiter, wenn das Fenster zugeht. Vorgelesen wird der Überblick ohne die Nummern der Mails.
let speechOk = false;
let speech = { key: null, status: "idle", error: null };
const speechKey = () => `overview|${plain.length}|${plain.slice(0, 40)}`;
const speechPort = messenger.runtime.connect({ name: "nbx-speech" });
function showSpeak() {
  const mine = speech.key === speechKey();
  const reading = mine && speech.status !== "idle";
  $("speak").hidden = !reading && (!speechOk || !plain || $("out").classList.contains("busy"));
  $("speak").textContent = !reading ? t.speak : speech.status === "loading" ? t.speakWait : t.speakStop;
  if (mine && speech.error?.key === speech.key) {
    $("err").hidden = false;
    $("err").textContent = `${t.speakFail} ${t[speech.error.text] || speech.error.text}`;
  }
}
speechPort.onMessage.addListener(m => {
  if (m?.type !== "speech") return;
  speech = m;
  showSpeak();
});
$("speak").addEventListener("click", () => {
  if (speech.status !== "idle" && speech.key === speechKey()) return speechPort.postMessage({ type: "stop" });
  const text = plain.replace(REF, "").replace(/ +([.,;:])/g, "$1");
  speechPort.postMessage({ type: "speak", key: speechKey(), text, lang });
});
$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(plain);
  $("copy").textContent = t.copied;
  setTimeout(() => ($("copy").textContent = t.copy), 1500);
});
$("settings").addEventListener("click", () => {
  try {
    localStorage.setItem("nbxOptionsTab", "aiTab");
  } catch {}
  messenger.settingsRedesign.openHub("ai").catch(() => messenger.runtime.openOptionsPage());
  window.close();
});

(async () => {
  fillTaskCalendars();
  // Vorlesen anbieten? Nur mit dem Helper, wenn er eine Stimme hat und die Funktion an ist
  messenger.storage.local.get(nbAI.DEFAULTS).then(c => {
    if (!c.aiEnabled || c.aiType !== "nbhelper" || !nbAI.feature(c, "speech")) return;
    nbAI.helperHello(c.aiUrl, c.aiKey).then(info => {
      speechOk = Boolean(info.speech?.available);
      showSpeak();
    }).catch(() => {});
  }).catch(() => {});
  const saved = await messenger.storage.local.get({ aiOverviewHours: 24, aiOverviewUnread: true, [SCHEDULE]: { mode: "off" }, [LAST]: null }).catch(() => ({}));
  $("period").value = String(t.hours[saved.aiOverviewHours] ? saved.aiOverviewHours : 24);
  $("unread").checked = saved.aiOverviewUnread !== false;
  showSchedule(saved[SCHEDULE] || { mode: "off" });
  messenger.browserAction.setBadgeText({ text: "" }).catch(() => {});
  const last = saved[LAST];
  if (last && ((last.scheduled && !last.seen) || Date.now() - last.at < 30 * 60_000)) {
    const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
    $("model").textContent = conf.aiType === "nbhelper" ? "NovaBird Helper" : conf.aiModel;
    showResult(last, [(last.scheduled ? t.standAuto : t.stand).replace("$1", time(last.at))]);
    showDeadlines();
    showSpeak();
    messenger.storage.local.set({ [LAST]: { ...last, seen: true } }).catch(() => {});
    return;
  }
  run();
})();
