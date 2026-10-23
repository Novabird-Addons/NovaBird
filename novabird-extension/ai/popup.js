"use strict";

const TEXTS = {
  de: { title: "Zusammenfassung", again: "Neu erstellen", copy: "Kopieren", copied: "Kopiert", settings: "Einstellungen", working: "Wird zusammengefasst …",
    noMessage: "Keine Nachricht ausgewählt.", empty: "Die Nachricht enthält keinen Text.", off: "Die KI-Zusammenfassung ist nicht eingerichtet. Adresse und Modell stehen in den Einstellungen unter „KI“.",
    truncated: "Nur der Anfang der Nachricht wurde berücksichtigt (sehr lang).", fail: "Die Zusammenfassung ist fehlgeschlagen:",
    permission: "Für diese Adresse fehlt die Erlaubnis. Bitte in den Einstellungen unter „KI“ speichern und die Erlaubnis bestätigen.", model: "Es ist kein Modell eingetragen.", url: "Die Adresse ist ungültig.",
    remote: "Der Nachrichtentext wird an $1 gesendet." },
    disabled: "Die KI-Zusammenfassung ist ausgeschaltet. Sie lässt sich in den Einstellungen unter „KI“ einschalten.",
    injection: "Die Nachricht enthält Sätze, die wie Anweisungen an KI-Systeme aussehen. Die Zusammenfassung mit Vorsicht lesen.",
    forbidden: "Der Server hat die Anfrage abgelehnt (403). Bei Ollama hilft die Umgebungsvariable OLLAMA_ORIGINS=moz-extension://*; bei anderen Diensten prüfen, ob Benutzername und Schlüssel stimmen.",
  en: { title: "Summary", again: "Regenerate", copy: "Copy", copied: "Copied", settings: "Settings", working: "Summarising …",
    noMessage: "No message selected.", empty: "The message has no text.", off: "AI summary is not set up. Address and model are in the settings under “AI”.",
    truncated: "Only the beginning of the message was used (very long).", fail: "The summary failed:",
    permission: "Permission for this address is missing. Please save it in the settings under “AI” and confirm the permission.", model: "No model has been entered.", url: "The address is invalid.",
    remote: "The message text is sent to $1." },
    disabled: "AI summary is switched off. You can switch it on in the settings under “AI”.",
    injection: "The message contains sentences that look like instructions to AI systems. Read the summary with caution.",
    forbidden: "The server refused the request (403). For Ollama set the environment variable OLLAMA_ORIGINS=moz-extension://*; for other services check the user name and key.",
  fr: { title: "Résumé", again: "Régénérer", copy: "Copier", copied: "Copié", settings: "Paramètres", working: "Résumé en cours …",
    noMessage: "Aucun message sélectionné.", empty: "Le message ne contient pas de texte.", off: "Le résumé par IA n’est pas configuré. L’adresse et le modèle se trouvent dans les paramètres sous « IA ».",
    truncated: "Seul le début du message a été pris en compte (très long).", fail: "Le résumé a échoué :",
    permission: "L’autorisation pour cette adresse manque. Enregistrez-la dans les paramètres sous « IA » et confirmez l’autorisation.", model: "Aucun modèle n’est indiqué.", url: "L’adresse est invalide.",
    remote: "Le texte du message est envoyé à $1." },
    disabled: "Le résumé par IA est désactivé. Vous pouvez l’activer dans les paramètres sous « IA ».",
    injection: "Le message contient des phrases qui ressemblent à des instructions pour des systèmes d’IA. Lisez le résumé avec prudence.",
    forbidden: "Le serveur a refusé la requête (403). Avec Ollama, définissez la variable d’environnement OLLAMA_ORIGINS=moz-extension://* ; pour les autres services, vérifiez le nom d’utilisateur et la clé.",
  es: { title: "Resumen", again: "Volver a generar", copy: "Copiar", copied: "Copiado", settings: "Ajustes", working: "Resumiendo …",
    noMessage: "Ningún mensaje seleccionado.", empty: "El mensaje no tiene texto.", off: "El resumen con IA no está configurado. La dirección y el modelo están en los ajustes, en «IA».",
    truncated: "Solo se usó el principio del mensaje (muy largo).", fail: "El resumen ha fallado:",
    permission: "Falta el permiso para esta dirección. Guárdela en los ajustes, en «IA», y confirme el permiso.", model: "No se ha indicado ningún modelo.", url: "La dirección no es válida.",
    remote: "El texto del mensaje se envía a $1." },
    disabled: "El resumen con IA está desactivado. Puede activarlo en los ajustes, en «IA».",
    injection: "El mensaje contiene frases que parecen instrucciones para sistemas de IA. Lea el resumen con precaución.",
    forbidden: "El servidor rechazó la solicitud (403). Con Ollama defina la variable de entorno OLLAMA_ORIGINS=moz-extension://*; en otros servicios compruebe el usuario y la clave.",
};
const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
const t = TEXTS[lang] || TEXTS.en;
const $ = id => document.getElementById(id);

$("title").textContent = t.title;
document.title = t.title;
if (new URLSearchParams(location.search).has("ids")) {
  document.body.classList.add("win"); // eigenes Fenster (Konversation): Breite des Fensters nutzen
}
$("again").textContent = t.again;
$("copy").textContent = t.copy;
$("settings").textContent = t.settings;

let controller = null;
let plain = ""; // Antworttext ohne Formatierung (für „Kopieren“)

// Kleine Darstellung: **fett** und Aufzählungspunkte; kein HTML aus der Antwort
function render(text) {
  plain = text;
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

function showError(text) {
  $("err").hidden = false;
  $("err").textContent = text;
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

async function run() {
  controller?.abort();
  controller = new AbortController();
  $("err").hidden = true;
  $("note").hidden = true;
  $("warn").hidden = true;
  $("out").textContent = t.working;
  const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
  $("model").textContent = conf.aiModel;
  if (!conf.aiEnabled) {
    $("out").textContent = "";
    return showError(t.disabled);
  }
  if (!conf.aiUrl || !conf.aiModel) {
    $("out").textContent = "";
    return showError(conf.aiUrl ? t.model : t.off);
  }
  try {
    // Konversation (Fenster aus NovaBird-Conversation): ?ids=1,2,3 – sonst die angezeigte Nachricht
    const idsParam = new URLSearchParams(location.search).get("ids");
    const ids = idsParam ? idsParam.split(",").map(Number).filter(Number.isInteger) : [];
    let message = null;
    let thread = null;
    if (ids.length) {
      thread = await nbAI.threadText(ids, conf);
    } else {
      const [tab] = await messenger.tabs.query({ active: true, currentWindow: true });
      message = tab && (await displayedMessage(tab));
      if (!message) {
        $("out").textContent = "";
        return showError(t.noMessage);
      }
    }
    const { text, truncated } = thread || (await nbAI.mailText(message.id, conf));
    if (!text) {
      $("out").textContent = "";
      return showError(t.empty);
    }
    if (nbAI.suspicious(text)) {
      $("warn").hidden = false;
      $("warn").textContent = t.injection;
    }
    if (!nbAI.isLocal(nbAI.base(conf))) {
      $("note").hidden = false;
      $("note").textContent = t.remote.replace("$1", new URL(nbAI.base(conf)).host);
    }
    const header = thread
      ? `Subject: ${thread.subject || ""}`
      : `Subject: ${message.subject || ""}\nFrom: ${message.author || ""}\nDate: ${message.date ? new Date(message.date).toLocaleString() : ""}`;
    const messages = nbAI.prompt(conf, lang, header, text, Boolean(thread));
    let first = true;
    const result = await nbAI.chat(conf, messages, partial => {
      if (partial || !first) {
        first = false;
        render(partial);
      }
    }, controller.signal);
    render(result);
    if (truncated) {
      $("note").hidden = false;
      $("note").textContent = t.truncated;
    }
  } catch (e) {
    if (e.name === "AbortError") return;
    $("out").textContent = "";
    const key = String(e.message || e);
    showError(t[key] || `${t.fail}\n${key}`);
  }
}

$("again").addEventListener("click", run);
$("copy").addEventListener("click", async () => {
  await navigator.clipboard.writeText(plain);
  $("copy").textContent = t.copied;
  setTimeout(() => ($("copy").textContent = t.copy), 1500);
});
$("settings").addEventListener("click", () => {
  try {
    localStorage.setItem("nbxOptionsTab", "aiTab"); // Optionsseite öffnet im Reiter KI
  } catch {}
  messenger.runtime.openOptionsPage();
  window.close();
});
run();
