// NovaBird Helper – Texte der Web-Oberfläche (Deutsch, Englisch). Im HTML: data-i18n (Text), data-i18n-html (eigener Text mit
// <b>/<code>), data-i18n-ph (Platzhalter). In app.js: t("schlüssel", wert1, wert2 …) ersetzt {1}, {2} …
"use strict";

const I18N = {
  de: {
    title: "NovaBird Helper", logout: "Abmelden", langSwitch: "English",
    login: "Anmelden", setupTitle: "Einrichten", setupButton: "Admin anlegen", name: "Name", password: "Passwort",
    passwordRepeat: "Passwort wiederholen",
    setupText: "Noch kein Benutzer: Lege den ersten Admin an. Name und Passwort gelten nur für diese Oberfläche (nicht für Windows). Passwort mindestens 10 Zeichen.",
    setupRemote: "Noch kein Benutzer. Den ersten Admin bitte direkt an diesem PC anlegen: {1}",
    passwordsDiffer: "Die Passwörter sind verschieden.", pleaseLogin: "Bitte anmelden", errorStatus: "Fehler {1}",
    roleAdmin: "Admin", roleViewer: "nur lesen", roleViewerOption: "Nur lesen",
    navStatus: "Status", navPcs: "PCs", navLlm: "Sprachmodell", navConnection: "Verbindung", navSettings: "Einstellungen",
    navUsers: "Benutzer", navLog: "Protokoll", navAccount: "Mein Konto",
    // Status
    statusTitle: "Status", stState: "Zustand", stRate: "Tempo (letzte Minute)", stQueue: "Warteschlange", stPcsToday: "PCs heute",
    stDevice: "Rechnet auf", stModel: "Suchmodell", stCpu: "CPU", stChat: "Sprachmodell", stVectors: "Geteilte Vektoren",
    stMode: "Betrieb", stStarted: "Läuft seit", devicesTitle: "Gemessene Geräte",
    devicesText: "Mails mit Betreff und etwa 1.200 Zeichen Text pro Sekunde.", thDevice: "Gerät", thMailsPerSec: "Mails/s",
    thNote: "Hinweis", measure: "Geräte neu messen", measureLoad: "Modell laden und messen",
    rateFmt: "{1} Mails/s", rateSplit: "{1} Mails/s (Grafikkarte {2} + CPU {3})", queueFmt: "{1} Pakete",
    measured: " (gemessen etwa {1} Mails/s)", modelReady: "bereit (jina-embeddings-v2-base-de, fp16)",
    modelNotMeasured: "geladen, Geräte noch nicht gemessen", modelMissing: "fehlt", cpuBlocked: "rechnet nicht mit ({1})",
    cpuOn: "rechnet mit, {1} Threads", off: "aus", modeService: "Windows-Dienst", modeUser: "Programm im Benutzerkonto",
    vecFmt: "{1} gespeichert ({2})", vecSince: " · seit dem Start {1} an PCs zurückgegeben, {2} neu", chatNone: "keins gewählt",
    chatLoaded: " (geladen)", chatBusy: " · rechnet", inUse: "wird benutzt",
    confirmModelDownload: "Das Suchmodell jina-embeddings-v2-base-de fehlt (etwa 320 MB von Hugging Face, feste Version mit Prüfsummen). Jetzt laden?",
    measuring: "Messung läuft …",
    // PCs
    pcsTitle: "PCs",
    pcsText: "PCs, die diesen Helper benutzen. „Indiziert“ meldet NovaBird-Search bei jeder Anfrage mit (Mails mit Vektor von allen Mails des PCs).",
    thPc: "PC", thIndexed: "Indiziert auf dem PC", thComputed: "Vom Helper gerechnet", thToday: "Heute", thLastSeen: "Zuletzt gesehen",
    indexedFmt: "{1} von {2} ({3} %)", todayAt: "heute {1}", remove: "entfernen",
    confirmForget: "„{1}“ aus der Liste entfernen? Der PC erscheint wieder, sobald er sich meldet.", noPcs: "Noch kein PC verbunden.",
    pcsSum: "{1} PC(s) · zusammen {2} von {3} Mails indiziert",
    // Sprachmodell
    llmTitle: "Sprachmodell",
    llmText: "Für die KI-Zusammenfassung in NovaBird: Thunderbird schickt die Mail verschlüsselt (Kopplungscode) an den Helper, das gewählte Modell fasst auf der Grafikkarte zusammen.",
    chosen: "Gewählt: {1}", none: "keins", busyNow: " · rechnet gerade", waitingFmt: " · {1} warten",
    ollamaTitle: "Ollama (empfohlen)",
    ollamaText: "Der Helper verwaltet ein eigenes Ollama im Hintergrund (nur auf diesem PC erreichbar, startet und endet mit dem Helper). Modelle kommen fertig von ollama.com.",
    ollamaInstall: "Ollama einrichten (etwa 1,5 GB) …", ollamaOn: "Ollama einschalten", ollamaOff: "Ollama ausschalten",
    ollamaNotInstalled: "Ollama ist noch nicht eingerichtet.", ollamaStateFmt: "Ollama {1}: {2}", ollamaDisabled: " (ausgeschaltet)",
    pullingFmt: " · lädt {1}", thLoadedModels: "Geladene Modelle", thSize: "Größe", loadModel: "Modell laden", otherModel: "Anderes Modell …",
    ollamaName: "Name bei ollama.com", ollamaNamePh: "z. B. qwen3:4b-instruct-2507-q4_K_M", load: "Laden", about: "etwa {1} GB",
    loadedVram: " · geladen ({1} Grafikspeicher)", use: "verwenden", chosenShort: "gewählt", delete: "löschen",
    confirmDeleteModel: "Modell {1} löschen?", needModelName: "Bitte den Namen des Modells bei ollama.com eintragen.",
    confirmOllamaInstall: "Ollama {1} einrichten?\n\nDer Helper lädt das offizielle Paket von GitHub (etwa 1,5 GB, Prüfsumme wird geprüft) in seinen Datenordner und startet es nur auf diesem PC.",
    winmlTitle: "Windows ML (Modellordner)",
    winmlText: "Alternativ ein selbst gebautes Modell im Format von ONNX Runtime GenAI (Ordner mit <code>genai_config.json</code>, int4 für DirectML). Nach den Messungen in docs/llm-test meist etwas schwächer als dasselbe Modell über Ollama.",
    thModel: "Modell", thType: "Art", thContext: "Kontext", importTitle: "Modellordner übernehmen", importPath: "Pfad auf diesem PC",
    importButton: "Übernehmen", importing: "Übernahme läuft …", confirmDeleteModelSize: "Modell {1} ({2}) löschen?",
    promptTitle: "Anweisung an das Modell",
    promptText: "Diese Anweisung steht vor jeder Mail. Standard ist die Anweisung der NovaBird-Extension; eine eigene Fassung gilt für alle PCs, die über diesen Helper zusammenfassen. <b>{OPEN}</b> und <b>{CLOSE}</b> müssen bleiben (Markierungen um den Mailtext, Schutz gegen eingeschleuste Anweisungen); <b>{ZIEL}</b> wird zur gewählten Sprache. Die Erinnerung nach dem Mailtext und die Warnung bei verdächtigen Mails setzt die Extension weiter selbst.",
    promptMail: "Einzelne Mail", promptThread: "Konversation", promptSave: "Speichern", promptReset: "Standard wiederherstellen",
    promptIsDefault: "Es gilt die Standard-Anweisung.", promptIsCustom: "Es gilt eine eigene Anweisung.", promptSaved: "Gespeichert",
    confirmPromptReset: "Wieder die Standard-Anweisung der Extension verwenden?",
    testTitle: "Testen", testText: "Text", summarize: "Zusammenfassen",
    testSample: "Hallo Frau Berger, der Elternabend der Klasse 5b findet am Donnerstag, 12. März, um 19:30 Uhr im Musiksaal statt. Themen: Klassenfahrt nach Füssen (185 €, Anzahlung 50 € bis 31. März) und Wahl der Elternvertreter. Bitte bis Montag zurückmelden. Viele Grüße, M. Keller",
    testStats: "{1} · erstes Wort {2} ms · {3} Token/s · gesamt {4} s",
    // Verbindung
    connTitle: "Verbindung",
    connText: "In Thunderbird auf den anderen PCs: Einstellungen von NovaBird-Search → Semantische Suche → Erweitert → Rechenweg „Anderer PC oder Server“, Schnittstelle „NovaBird Helper (Netz)“, dann Adresse und Kopplungscode eintragen und „Speichern und prüfen“. Für die KI-Zusammenfassung: Einstellungen der NovaBird-Extension → KI → Schnittstelle „NovaBird Helper“, dieselbe Adresse und derselbe Code.",
    addresses: "Adressen dieses PCs", pairingCode: "Kopplungscode", copy: "Kopieren", newCode: "Neuer Code …",
    connSecurity: "Anfragen und Antworten sind mit dem Kopplungscode verschlüsselt (AES-256-GCM); ohne ihn kann niemand den Helper benutzen. Firewall: eingehend TCP-Port {1} nur im privaten Netzwerk freigeben.",
    certTitle: "Zertifikat der Web-Oberfläche",
    certText: "Im Netz läuft die Web-Oberfläche über HTTPS mit einem selbst erzeugten Zertifikat. Der Browser warnt beim ersten Aufruf; vergleiche dann diesen Fingerabdruck (SHA-256):",
    copied: "Kopiert", copyFailed: "Kopieren nicht möglich – bitte markieren",
    confirmRenew: "Neuen Kopplungscode erzeugen?\n\nAlle bisher verbundenen PCs müssen danach den neuen Code eintragen.", renewed: "Neuer Code erzeugt",
    // Einstellungen
    settingsTitle: "Einstellungen", compute: "Rechnen", cpuAlong: "CPU neben der Grafikkarte mitrechnen lassen", cpuThreads: "CPU-Threads",
    pause: "Pause: nur Suchanfragen beantworten, nicht indexieren", vecShare: "Vektoren zwischen den PCs teilen",
    vecShareText: "Was der Helper für einen PC gerechnet hat, bekommen andere PCs mit derselben Mail (gleiche Message-ID und gleicher Text) direkt zurück, statt neu zu rechnen. Gespeichert werden nur Vektoren und Prüfsummen, keine Mailtexte und keine Message-IDs im Klartext.",
    vecClear: "Geteilte Vektoren löschen …", startTitle: "Start", autostart: "Mit Windows starten (bei der Anmeldung)",
    toService: "Als Windows-Dienst einrichten …", network: "Netz", netPort: "Port für die PCs (TCP)", webPort: "Port der Web-Oberfläche (TCP)",
    webLan: "Web-Oberfläche auch im Netz erreichbar (nur über HTTPS)", save: "Speichern", saved: "Gespeichert",
    cpuBlockedNow: "Geht gerade nicht: {1}", cpuNote: "Die CPU rechnet nur mit, wenn sie beim Messen dieselben Vektoren liefert wie die Grafikkarte.",
    threadsNote: "0 = automatisch ({1}) · dieser PC hat {2} logische Kerne",
    modeServiceText: "Läuft als Windows-Dienst und startet mit Windows, auch ohne Anmeldung.", modeUserText: "Läuft als Programm im Benutzerkonto.",
    serviceBack: "Zurück zum Programm im Benutzerkonto: Rechtsklick auf das Symbol im Infobereich.",
    serviceLocal: "Als Dienst läuft der Helper ohne Anmeldung an Windows. Einrichten fragt einmal nach Adminrechten; Einstellungen, Kopplungscode, PC-Liste, Benutzer und Modelle werden übernommen.",
    serviceRemote: "Als Windows-Dienst einrichten geht nur direkt an diesem PC (Windows fragt dort nach Adminrechten).",
    netPortPending: "PCs-Port läuft noch auf {1}", webPortPending: "Web-Port läuft noch auf {1}", portsPending: "{1} – neuer Port gilt nach dem nächsten Start.",
    firewall: "Windows-Firewall: eingehend TCP nur im privaten Netzwerk freigeben.",
    confirmVecClear: "Alle geteilten Vektoren im Helper löschen?\n\nDie Indizes auf den PCs bleiben; neue PCs rechnen dann wieder alles selbst.",
    deleted: "Gelöscht",
    confirmService: "Den Helper als Windows-Dienst einrichten?\n\nWindows fragt gleich nach Adminrechten. Danach läuft der Netz-Modus als Dienst; diese Seite lädt neu, die Anmeldung bleibt gleich.",
    serviceDone: "Eingerichtet – der Dienst startet …",
    // Benutzer
    usersTitle: "Benutzer",
    usersText: "Eigene Konten nur für diese Oberfläche. <b>Admin</b> darf alles; <b>Nur lesen</b> sieht Status, PCs und Einstellungen, aber keinen Kopplungscode.",
    thRole: "Rolle", thCreated: "Angelegt", newUser: "Neuer Benutzer", role: "Rolle", create: "Anlegen", roleChanged: "Rolle geändert",
    setPassword: "Passwort setzen", promptNewPassword: "Neues Passwort für {1} (mindestens 10 Zeichen):", passwordSet: "Passwort gesetzt",
    confirmDeleteUser: "Benutzer {1} löschen?", userCreated: "Benutzer angelegt",
    // Protokoll, Konto
    logTitle: "Protokoll", reload: "Neu laden", accountTitle: "Mein Konto", oldPassword: "Bisheriges Passwort", newPassword: "Neues Passwort",
    newPasswordRepeat: "Neues Passwort wiederholen", changePassword: "Passwort ändern", changed: "Geändert",
    newPasswordsDiffer: "Die neuen Passwörter sind verschieden.", unreachable: "Helper nicht erreichbar: {1}",
  },
  en: {
    title: "NovaBird Helper", logout: "Sign out", langSwitch: "Deutsch",
    login: "Sign in", setupTitle: "Set up", setupButton: "Create admin", name: "Name", password: "Password",
    passwordRepeat: "Repeat password",
    setupText: "No user yet: create the first admin. Name and password are only for this interface (not for Windows). Password at least 10 characters.",
    setupRemote: "No user yet. Please create the first admin directly on this PC: {1}",
    passwordsDiffer: "The passwords do not match.", pleaseLogin: "Please sign in", errorStatus: "Error {1}",
    roleAdmin: "Admin", roleViewer: "read only", roleViewerOption: "Read only",
    navStatus: "Status", navPcs: "PCs", navLlm: "Language model", navConnection: "Connection", navSettings: "Settings",
    navUsers: "Users", navLog: "Log", navAccount: "My account",
    statusTitle: "Status", stState: "State", stRate: "Speed (last minute)", stQueue: "Queue", stPcsToday: "PCs today",
    stDevice: "Computes on", stModel: "Search model", stCpu: "CPU", stChat: "Language model", stVectors: "Shared vectors",
    stMode: "Mode", stStarted: "Running since", devicesTitle: "Measured devices",
    devicesText: "Messages with subject and about 1,200 characters of text per second.", thDevice: "Device", thMailsPerSec: "Msgs/s",
    thNote: "Note", measure: "Measure devices again", measureLoad: "Load model and measure",
    rateFmt: "{1} msgs/s", rateSplit: "{1} msgs/s (graphics card {2} + CPU {3})", queueFmt: "{1} batches",
    measured: " (measured about {1} msgs/s)", modelReady: "ready (jina-embeddings-v2-base-de, fp16)",
    modelNotMeasured: "loaded, devices not measured yet", modelMissing: "missing", cpuBlocked: "not computing ({1})",
    cpuOn: "computing, {1} threads", off: "off", modeService: "Windows service", modeUser: "Program in the user account",
    vecFmt: "{1} stored ({2})", vecSince: " · since start {1} returned to PCs, {2} new", chatNone: "none selected",
    chatLoaded: " (loaded)", chatBusy: " · computing", inUse: "in use",
    confirmModelDownload: "The search model jina-embeddings-v2-base-de is missing (about 320 MB from Hugging Face, fixed version with checksums). Download now?",
    measuring: "Measuring …",
    pcsTitle: "PCs",
    pcsText: "PCs using this helper. \"Indexed\" is reported by NovaBird-Search with every request (messages with a vector out of all messages on that PC).",
    thPc: "PC", thIndexed: "Indexed on the PC", thComputed: "Computed by the helper", thToday: "Today", thLastSeen: "Last seen",
    indexedFmt: "{1} of {2} ({3} %)", todayAt: "today {1}", remove: "remove",
    confirmForget: "Remove \"{1}\" from the list? The PC appears again as soon as it reports.", noPcs: "No PC connected yet.",
    pcsSum: "{1} PC(s) · {2} of {3} messages indexed in total",
    llmTitle: "Language model",
    llmText: "For the AI summary in NovaBird: Thunderbird sends the message encrypted (pairing code) to the helper, and the chosen model summarises it on the graphics card.",
    chosen: "Selected: {1}", none: "none", busyNow: " · computing", waitingFmt: " · {1} waiting",
    ollamaTitle: "Ollama (recommended)",
    ollamaText: "The helper runs its own Ollama in the background (reachable only on this PC, starts and stops with the helper). Models come ready-made from ollama.com.",
    ollamaInstall: "Set up Ollama (about 1.5 GB) …", ollamaOn: "Switch Ollama on", ollamaOff: "Switch Ollama off",
    ollamaNotInstalled: "Ollama is not set up yet.", ollamaStateFmt: "Ollama {1}: {2}", ollamaDisabled: " (switched off)",
    pullingFmt: " · downloading {1}", thLoadedModels: "Downloaded models", thSize: "Size", loadModel: "Download model", otherModel: "Other model …",
    ollamaName: "Name on ollama.com", ollamaNamePh: "e.g. qwen3:4b-instruct-2507-q4_K_M", load: "Download", about: "about {1} GB",
    loadedVram: " · loaded ({1} graphics memory)", use: "use", chosenShort: "selected", delete: "delete",
    confirmDeleteModel: "Delete model {1}?", needModelName: "Please enter the name of the model on ollama.com.",
    confirmOllamaInstall: "Set up Ollama {1}?\n\nThe helper downloads the official package from GitHub (about 1.5 GB, checksum verified) into its data folder and starts it only on this PC.",
    winmlTitle: "Windows ML (model folder)",
    winmlText: "Alternatively a self-built model in the ONNX Runtime GenAI format (folder with <code>genai_config.json</code>, int4 for DirectML). According to the measurements in docs/llm-test usually a bit weaker than the same model through Ollama.",
    thModel: "Model", thType: "Type", thContext: "Context", importTitle: "Take over a model folder", importPath: "Path on this PC",
    importButton: "Take over", importing: "Taking over …", confirmDeleteModelSize: "Delete model {1} ({2})?",
    promptTitle: "Instruction to the model",
    promptText: "This instruction comes before every message. The default is the instruction of the NovaBird Extension; your own version applies to all PCs that summarise through this helper. <b>{OPEN}</b> and <b>{CLOSE}</b> must stay (markers around the message text, protection against injected instructions); <b>{ZIEL}</b> becomes the chosen language. The reminder after the message text and the warning for suspicious messages are still added by the Extension.",
    promptMail: "Single message", promptThread: "Conversation", promptSave: "Save", promptReset: "Restore default",
    promptIsDefault: "The default instruction applies.", promptIsCustom: "Your own instruction applies.", promptSaved: "Saved",
    confirmPromptReset: "Use the default instruction of the Extension again?",
    testTitle: "Test", testText: "Text", summarize: "Summarise",
    testSample: "Hello Ms Berger, the parents' evening of class 5b takes place on Thursday, 12 March, at 7:30 pm in the music room. Topics: class trip to Füssen (€185, deposit of €50 by 31 March) and election of the parent representatives. Please reply by Monday. Best regards, M. Keller",
    testStats: "{1} · first word {2} ms · {3} tokens/s · total {4} s",
    connTitle: "Connection",
    connText: "In Thunderbird on the other PCs: settings of NovaBird-Search → Semantic search → Advanced → computing path \"Other PC or server\", interface \"NovaBird Helper (network)\", then enter address and pairing code and \"Save and check\". For the AI summary: settings of the NovaBird Extension → AI → interface \"NovaBird Helper\", same address and code.",
    addresses: "Addresses of this PC", pairingCode: "Pairing code", copy: "Copy", newCode: "New code …",
    connSecurity: "Requests and answers are encrypted with the pairing code (AES-256-GCM); without it nobody can use the helper. Firewall: allow incoming TCP port {1} in the private network only.",
    certTitle: "Certificate of the web interface",
    certText: "In the network the web interface runs over HTTPS with a self-made certificate. The browser warns on first access; then compare this fingerprint (SHA-256):",
    copied: "Copied", copyFailed: "Cannot copy – please select the text",
    confirmRenew: "Create a new pairing code?\n\nAll PCs connected so far must enter the new code afterwards.", renewed: "New code created",
    settingsTitle: "Settings", compute: "Computing", cpuAlong: "Let the CPU compute alongside the graphics card", cpuThreads: "CPU threads",
    pause: "Pause: answer searches only, do not index", vecShare: "Share vectors between the PCs",
    vecShareText: "What the helper has computed for one PC, other PCs with the same message (same Message-ID and same text) get back directly instead of computing it again. Only vectors and checksums are stored, no message texts and no message IDs in plain text.",
    vecClear: "Delete shared vectors …", startTitle: "Start", autostart: "Start with Windows (at sign-in)",
    toService: "Set up as Windows service …", network: "Network", netPort: "Port for the PCs (TCP)", webPort: "Port of the web interface (TCP)",
    webLan: "Web interface also reachable in the network (HTTPS only)", save: "Save", saved: "Saved",
    cpuBlockedNow: "Not possible right now: {1}", cpuNote: "The CPU only computes alongside if it returned the same vectors as the graphics card when measuring.",
    threadsNote: "0 = automatic ({1}) · this PC has {2} logical cores",
    modeServiceText: "Runs as a Windows service and starts with Windows, even without sign-in.", modeUserText: "Runs as a program in the user account.",
    serviceBack: "Back to the program in the user account: right-click the icon in the notification area.",
    serviceLocal: "As a service the helper runs without anyone signed in to Windows. Setting it up asks once for admin rights; settings, pairing code, list of PCs, users and models are taken over.",
    serviceRemote: "Setting up the Windows service is only possible directly on this PC (Windows asks for admin rights there).",
    netPortPending: "PC port still running on {1}", webPortPending: "web port still running on {1}", portsPending: "{1} – the new port applies after the next start.",
    firewall: "Windows Firewall: allow incoming TCP in the private network only.",
    confirmVecClear: "Delete all shared vectors in the helper?\n\nThe indexes on the PCs stay; new PCs then compute everything themselves again.",
    deleted: "Deleted",
    confirmService: "Set up the helper as a Windows service?\n\nWindows will ask for admin rights. Afterwards the network mode runs as a service; this page reloads, the sign-in stays the same.",
    serviceDone: "Set up – the service is starting …",
    usersTitle: "Users",
    usersText: "Own accounts only for this interface. <b>Admin</b> may do everything; <b>Read only</b> sees status, PCs and settings but no pairing code.",
    thRole: "Role", thCreated: "Created", newUser: "New user", role: "Role", create: "Create", roleChanged: "Role changed",
    setPassword: "Set password", promptNewPassword: "New password for {1} (at least 10 characters):", passwordSet: "Password set",
    confirmDeleteUser: "Delete user {1}?", userCreated: "User created",
    logTitle: "Log", reload: "Reload", accountTitle: "My account", oldPassword: "Current password", newPassword: "New password",
    newPasswordRepeat: "Repeat new password", changePassword: "Change password", changed: "Changed",
    newPasswordsDiffer: "The new passwords do not match.", unreachable: "Helper not reachable: {1}",
  },
};

let LANG = (() => {
  try {
    const saved = localStorage.getItem("nbh.lang");
    if (saved === "de" || saved === "en") return saved;
  } catch {
    /* kein Speicher */
  }
  return (navigator.language || "en").toLowerCase().startsWith("de") ? "de" : "en";
})();

function t(key, ...args) {
  const s = I18N[LANG][key] ?? I18N.de[key] ?? key;
  return s.replace(/\{(\d)\}/g, (m, i) => (args[i - 1] ?? m));
}

function applyI18n() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll("[data-i18n-html]")) el.innerHTML = I18N[LANG][el.dataset.i18nHtml]; // nur eigene Texte
  for (const el of document.querySelectorAll("[data-i18n-ph]")) el.placeholder = t(el.dataset.i18nPh);
}

function setLang(lang) {
  LANG = lang;
  try {
    localStorage.setItem("nbh.lang", lang);
  } catch {
    /* kein Speicher */
  }
  applyI18n();
}
