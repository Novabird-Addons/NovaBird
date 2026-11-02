"use strict";
// Einrichtungs-Assistent (Reiter „Einrichtung“ in Einstellungen → NovaBird). Eine Seite, zwei Ansichten: Schritt für Schritt
// (geht nach einer Neuinstallation oder dem Umstieg von 1.x einmal von selbst auf, background.js setupStart) und danach die
// Übersicht mit dem Stand jedes Bereichs. Zustand in storage.local „setup“: {mode: "upgrade"|"new", wizard, steps: {Schritt:
// "seen"}, answers: {semantic, multi, alwaysOn}, measure: {rate, engine, at}}. Der Stand von Suche, Helper und KI wird nicht
// gespeichert, sondern jedes Mal nachgesehen. Die Geschwindigkeit misst NovaBird-Search an echten Mails (setup:measure);
// Grafikkarte und Sprachmodell kennt nur der NovaBird Helper – hier steht nur, was er meldet.
(() => {
  const SEARCH_ID = "novabird-db@novabird";
  const HELPER_URL = "https://github.com/Novabird-Addons/NovaBird/releases/latest";
  const GPU_MINUTES = 30; // ab dieser geschätzten Rechenzeit die Grafikkarte (Helper) empfehlen
  const MEASURE_MAILS = 64; // wie NovaBird-Search semantic/main.js
  const T = {
    de: {
      titleUp: "Willkommen bei NovaBird 2.0", titleNew: "Willkommen bei NovaBird", titleOverview: "Einrichtung",
      leadWizard: "In ein paar Minuten ist alles eingerichtet. Jeder Schritt lässt sich überspringen und später hier unter „Einrichtung“ nachholen.",
      leadOverview: "Was auf diesem PC eingerichtet ist – und was noch fehlt.",
      steps: { intro: "Neu", moved: "Umgezogen", search: "Bedeutungssuche", helper: "NovaBird Helper", ai: "KI-Assistent", done: "Fertig" },
      back: "Zurück", next: "Weiter", finish: "Fertig", toOverview: "Zur Übersicht", restart: "Assistent von vorn", setUp: "Einrichten", view: "Ansehen",
      pill: { done: "Erledigt", open: "Offen", run: "Läuft", none: "Optional" },
      introUpH: "Das ist neu in 2.0", introNewH: "Das kann NovaBird",
      f: {
        semantic: ["Bedeutungssuche (Beta)", "Findet Mails nach dem Sinn: „Treffen der Eltern“ findet auch „Elternabend“. Die Wortsuche bleibt wie gewohnt."],
        ai: ["KI-Assistent", "Zusammenfassen, Übersetzen, Termine und Fristen erkennen, Antworten schreiben, „Was gibt's Neues?“ und Vorlesen – mit einer KI auf dem eigenen PC oder im eigenen Netz."],
        helper: ["NovaBird Helper (optional)", "Rechnet Suche und KI auf der Grafikkarte – für alle PCs der Familie oder im Büro. Für Windows."],
        four: ["Vier Add-ons statt acht", "Die Designs stecken jetzt in der Extension, Suchleiste und Suchindex sind ein Add-on: NovaBird-Search."],
        tabs: ["Einstellungen nach Aufgaben", "Einstellungen → NovaBird hat Reiter: Allgemein, Suche, KI-Assistent, NovaBird Helper, Konversation, Senden."],
        look: ["Aufgeräumter Thunderbird", "Nachrichtenliste, Kalender-Leiste, Anhang-Vorschau, Designs und übersichtliche Einstellungen."],
      },
      movedH: "Was ist umgezogen?", movedLead: "Alle Einstellungen wurden übernommen, nur ihr Ort hat sich geändert. Markiert ist, was dich betrifft.",
      mine: "betrifft dich", show: "Zeigen",
      mv: {
        tabs: ["Ein Reiter je Add-on", "Reiter nach Aufgaben: Allgemein · Suche · KI-Assistent · NovaBird Helper · Konversation · Senden"],
        ai: ["KI-Zusammenfassung im Reiter der Extension", "Eigener Reiter „KI-Assistent“"],
        theme: ["Theme-Add-ons Sand, Cobalt, Springlight", "Allgemein → Farben und Schrift → Design"],
        search: ["NovaBird-Search und NovaBird-DB", "Ein Reiter „Suche“ mit den Unterreitern Suche und Index"],
      },
      searchWhat: "Die Bedeutungssuche findet Mails nach dem Sinn statt nach dem genauen Wort. Dazu rechnet NovaBird für jede Mail einmal einen „Fingerabdruck“ ihrer Bedeutung. Die Wortsuche bleibt immer.",
      searchCost: "Einmalig wird das Sprachmodell für die Suche geladen ($1). Beim Rechnen braucht Thunderbird etwa $2 mehr Arbeitsspeicher; gerechnet wird, wenn der PC gerade nicht benutzt wird.",
      searchYes: "Einrichten und messen", searchNo: "Nein, nur Wortsuche", searchNoSet: "Nur die Wortsuche ist eingeschaltet.", searchUndo: "Doch einrichten",
      searchMissing: "NovaBird-Search ist nicht installiert – dieser Schritt entfällt.",
      dl: "Lade das Sprachmodell für die Suche … $1 von $2",
      waitIndex: "Der Suchindex wird gerade aufgebaut. Gemessen wird, sobald er fertig ist – du kannst schon weitermachen; das Ergebnis steht danach hier unter „Einrichtung“.",
      measuring: "Messe die Geschwindigkeit an $1 deiner neuesten Mails …", measureErr: "Messen ging nicht: $1", again: "Erneut messen", measure: "Geschwindigkeit messen",
      statRate: "Mails pro Sekunde", statMails: "Mails insgesamt", statTime: "Rechenzeit (geschätzt)", statDone: "schon fertig",
      engine: { addon: "Gerechnet im Add-on (Prozessor, $1 Kerne).", helper: "Gerechnet im NovaBird Helper.", server: "Gerechnet auf dem eigenen Server." },
      timeNote: "Reine Rechenzeit: NovaBird rechnet nur, wenn der PC gerade nicht benutzt wird, Thunderbird bleibt nutzbar. Neue Mails kommen sofort dazu.",
      allDone: "Alle Mails haben ihren Fingerabdruck schon.",
      recOk: "Passt: Dieser PC schafft das allein.", recRemote: "Läuft schon auf der Grafikkarte bzw. dem eigenen Server.",
      recGpu: "Ab $1 lohnt sich die Grafikkarte: Mit dem NovaBird Helper ist das meist in einem Bruchteil der Zeit fertig – nächster Schritt.",
      recGpuOther: "Ab $1 lohnt sich ein eigener Server mit Grafikchip (z. B. Ollama auf einem Mac): Suche → Bedeutungssuche → Wo rechnen?",
      recGpuMac: "Ab $1 lohnt sich der Grafikchip: Auf dem Mac rechnet Ollama die Suche – Suche → Bedeutungssuche → „Ollama auf diesem Mac“.",
      qMulti: "Nutzt ihr NovaBird auf mehreren PCs oder auf einem Notebook?", qOn: "Ist einer davon meistens eingeschaltet?", yes: "Ja", no: "Nein",
      recMultiOn: "Dann lohnt sich der NovaBird Helper auf dem PC, der meistens läuft: Er rechnet für alle, die anderen PCs und Notebooks bekommen die fertigen Ergebnisse und sparen Zeit und Akku.",
      recMultiOff: "Dann rechnet jeder PC selbst. Mit dem Helper lassen sich die Ergebnisse über einen geteilten Ordner abgleichen, sodass jede Mail nur einmal gerechnet wird.",
      helperRec: "Für dich empfohlen.", whyTime: "Die Bedeutungssuche bräuchte auf diesem PC etwa $1.", whyMulti: "Ihr nutzt mehrere PCs, und einer läuft meistens.",
      helperWhatH: "Was macht der Helper?",
      helperWhat: [
        "Rechnet die Bedeutungssuche auf der Grafikkarte – meist ein Vielfaches schneller als der Prozessor.",
        "Stellt ein Sprachmodell für den KI-Assistenten bereit und liest Mails vor.",
        "Rechnet für alle PCs im Netz; Ergebnisse werden verschlüsselt geteilt, sodass jede Mail nur einmal gerechnet wird.",
        "Speichert keine Mailtexte, nur verschlüsselte Ergebnisse. Installation ohne Adminrechte; Grafikkarte und passendes Sprachmodell sucht er selbst aus.",
      ],
      helperHowH: "So geht's",
      helperHow: [
        "Helper herunterladen und auf dem PC installieren, der meistens läuft – am besten einer mit Grafikkarte.",
        "In seiner Web-Oberfläche stehen unter „Verbindung“ Adresse und Kopplungscode.",
        "Im Reiter „NovaBird Helper“ beides eintragen und „Verbinden“ klicken. Danach steht hier, was er erkannt hat.",
      ],
      download: "Helper herunterladen", openHelperTab: "Reiter „NovaBird Helper“ öffnen",
      helperOk: "Verbunden mit $1", helperOkSub: "Gerät: $1 · Sprachmodell: $2", noModel: "noch keins gewählt",
      helperFail: "Eingetragen, aber gerade nicht erreichbar: $1",
      helperOther: "Den Helper gibt es nur für Windows. Ohne ihn rechnet die Suche im Add-on; für KI und schnellere Suche eignet sich ein eigener Server wie Ollama (nutzt auf dem Mac den Grafikchip). Ein Helper auf einem Windows-PC im Netz lässt sich trotzdem verbinden.",
      helperOptional: "Optional: Ohne Helper funktioniert alles – die Suche rechnet dann auf dem Prozessor, die KI braucht einen eigenen Server.",
      aiWhat: "Der KI-Assistent fasst Mails zusammen, übersetzt, erkennt Termine und Fristen, hilft beim Schreiben und stellt „Was gibt's Neues?“ zusammen. Mailtexte gehen nur an die KI, die hier eingerichtet ist.",
      aiReady: "Eingerichtet: $1", aiOff: "Eingerichtet, aber ausgeschaltet (Reiter „KI-Assistent“).", aiViaHelper: "$1 im NovaBird Helper", aiViaOwn: "$1 auf $2",
      aiUseHelper: "KI über den Helper nutzen ($1)", aiHelperReady: "Der verbundene Helper hat ein Sprachmodell: $1.",
      aiHelperNoModel: "Der Helper ist verbunden, hat aber noch kein Sprachmodell. In seiner Web-Oberfläche unter „Sprachmodell“ eins wählen – er schlägt eins passend zur Grafikkarte vor.",
      aiOllama: "Ollama auf diesem PC gefunden (Modelle: $1). Im Reiter „KI-Assistent“ ein Modell wählen.",
      aiNone: "Keine KI gefunden. Möglich sind der NovaBird Helper (Sprachmodell in seiner Web-Oberfläche wählen) oder ein eigenes Ollama bzw. ein OpenAI-kompatibler Server.",
      openAiTab: "Reiter „KI-Assistent“ öffnen", featH: "Funktionen",
      feat: { summary: "Zusammenfassung", translate: "Übersetzen", events: "Termine und Aufgaben", deadlines: "Fristen", overview: "Was gibt's Neues?", speech: "Vorlesen (nur mit Helper)", compose: "Schreiben", phish: "Phishing-Prüfung (für NovaBird Phishing-Schutz, jede neue Mail)" },
      doneH: "Fertig", doneLead: "So ist NovaBird jetzt eingerichtet. Offenes lässt sich jederzeit hier unter „Einrichtung“ nachholen.",
      ovIntroUp: "Was neu ist und wo die Einstellungen jetzt stehen.", ovIntroNew: "Was NovaBird kann.",
      sOff: "Aus – nur Wortsuche.", sMissing: "NovaBird-Search ist nicht installiert.", sOpen: "Noch nicht eingerichtet.", sDl: "Sprachmodell wird geladen ($1 %).",
      sWait: "Wartet auf den Suchindex.", sRun: "$1 von $2 Mails ($3 %)", sEta: " · noch etwa $1", sDone: "Fertig: $1 Mails.", sErr: "Fehler: $1",
      hOk: "Verbunden: $1", hOpen: "Nicht verbunden.", hRec: "Nicht verbunden – für dich empfohlen.", hOther: "Nur für Windows – hier nicht nötig.",
      aOpen: "Noch nicht eingerichtet.",
      lt1: "unter einer Minute", about: "etwa $1",
    },
    en: {
      titleUp: "Welcome to NovaBird 2.0", titleNew: "Welcome to NovaBird", titleOverview: "Setup",
      leadWizard: "A few minutes and everything is set up. Every step can be skipped and done later here under “Setup”.",
      leadOverview: "What is set up on this PC – and what is still missing.",
      steps: { intro: "New", moved: "Moved", search: "Meaning search", helper: "NovaBird Helper", ai: "AI assistant", done: "Done" },
      back: "Back", next: "Next", finish: "Done", toOverview: "Overview", restart: "Start the assistant again", setUp: "Set up", view: "View",
      pill: { done: "Done", open: "Open", run: "Running", none: "Optional" },
      introUpH: "What's new in 2.0", introNewH: "What NovaBird does",
      f: {
        semantic: ["Meaning search (beta)", "Finds messages by meaning: “parents' meeting” also finds “parent-teacher evening”. Word search stays as it was."],
        ai: ["AI assistant", "Summarise, translate, spot appointments and deadlines, draft replies, “What's new?” and read aloud – with an AI on your own PC or network."],
        helper: ["NovaBird Helper (optional)", "Computes search and AI on the graphics card – for all PCs of the family or the office. For Windows."],
        four: ["Four add-ons instead of eight", "The designs are now part of the Extension; search bar and search index are one add-on: NovaBird-Search."],
        tabs: ["Settings sorted by task", "Settings → NovaBird has tabs: General, Search, AI assistant, NovaBird Helper, Conversation, Send."],
        look: ["A tidier Thunderbird", "Message list, calendar pane, attachment preview, designs and clearer settings."],
      },
      movedH: "What has moved?", movedLead: "All settings were taken over; only their place has changed. What concerns you is marked.",
      mine: "concerns you", show: "Show",
      mv: {
        tabs: ["One tab per add-on", "Tabs by task: General · Search · AI assistant · NovaBird Helper · Conversation · Send"],
        ai: ["AI summary in the Extension's tab", "Its own tab “AI assistant”"],
        theme: ["Theme add-ons Sand, Cobalt, Springlight", "General → Colors and fonts → Design"],
        search: ["NovaBird-Search and NovaBird-DB", "One tab “Search” with the sub-tabs Search and Index"],
      },
      searchWhat: "Meaning search finds messages by what they mean instead of the exact word. For this NovaBird computes a “fingerprint” of each message's meaning once. Word search always stays.",
      searchCost: "The language model for search is downloaded once ($1). While computing, Thunderbird needs about $2 more memory; it computes while the PC is not in use.",
      searchYes: "Set up and measure", searchNo: "No, word search only", searchNoSet: "Only word search is switched on.", searchUndo: "Set it up after all",
      searchMissing: "NovaBird-Search is not installed – this step does not apply.",
      dl: "Downloading the language model for search … $1 of $2",
      waitIndex: "The search index is still being built. Measuring starts once it is ready – you can carry on; the result will then be shown here under “Setup”.",
      measuring: "Measuring the speed with $1 of your newest messages …", measureErr: "Measuring failed: $1", again: "Measure again", measure: "Measure the speed",
      statRate: "messages per second", statMails: "messages in total", statTime: "computing time (estimate)", statDone: "already done",
      engine: { addon: "Computed in the add-on (processor, $1 cores).", helper: "Computed in the NovaBird Helper.", server: "Computed on your own server." },
      timeNote: "Pure computing time: NovaBird only computes while the PC is not in use, Thunderbird stays usable. New messages are added right away.",
      allDone: "All messages already have their fingerprint.",
      recOk: "Fine: this PC manages on its own.", recRemote: "Already runs on the graphics card or your own server.",
      recGpu: "From $1 on a graphics card pays off: with the NovaBird Helper it is usually done in a fraction of the time – next step.",
      recGpuOther: "From $1 on your own server with a graphics chip pays off (e.g. Ollama on a Mac): Search → Meaning search → Where to compute?",
      recGpuMac: "From $1 on the graphics chip pays off: on a Mac, Ollama computes the search – Search → Meaning search → “Ollama on this Mac”.",
      qMulti: "Do you use NovaBird on several PCs or on a laptop?", qOn: "Is one of them switched on most of the time?", yes: "Yes", no: "No",
      recMultiOn: "Then the NovaBird Helper pays off on the PC that is usually on: it computes for everyone, the other PCs and laptops get the finished results and save time and battery.",
      recMultiOff: "Then every PC computes on its own. With the Helper the results can be synced through a shared folder, so each message is computed only once.",
      helperRec: "Recommended for you.", whyTime: "Meaning search would take about $1 on this PC.", whyMulti: "You use several PCs and one is usually on.",
      helperWhatH: "What does the Helper do?",
      helperWhat: [
        "Computes the meaning search on the graphics card – usually many times faster than the processor.",
        "Provides a language model for the AI assistant and reads messages aloud.",
        "Computes for all PCs on the network; results are shared encrypted, so each message is computed only once.",
        "Stores no message texts, only encrypted results. Installs without admin rights; picks the graphics card and a fitting language model itself.",
      ],
      helperHowH: "How it works",
      helperHow: [
        "Download the Helper and install it on the PC that is usually on – ideally one with a graphics card.",
        "Its web interface shows address and pairing code under “Connection”.",
        "Enter both in the tab “NovaBird Helper” and click “Connect”. What it detected is then shown here.",
      ],
      download: "Download the Helper", openHelperTab: "Open the “NovaBird Helper” tab",
      helperOk: "Connected to $1", helperOkSub: "Device: $1 · Language model: $2", noModel: "none selected yet",
      helperFail: "Configured, but not reachable right now: $1",
      helperOther: "The Helper is only available for Windows. Without it, search computes in the add-on; for AI and faster search your own server such as Ollama works well (uses the graphics chip on a Mac). A Helper on a Windows PC on the network can still be connected.",
      helperOptional: "Optional: everything works without the Helper – search then computes on the processor, AI needs your own server.",
      aiWhat: "The AI assistant summarises messages, translates, spots appointments and deadlines, helps with writing and puts together “What's new?”. Message texts only go to the AI set up here.",
      aiReady: "Set up: $1", aiOff: "Set up, but switched off (tab “AI assistant”).", aiViaHelper: "$1 in the NovaBird Helper", aiViaOwn: "$1 on $2",
      aiUseHelper: "Use AI through the Helper ($1)", aiHelperReady: "The connected Helper has a language model: $1.",
      aiHelperNoModel: "The Helper is connected but has no language model yet. Choose one in its web interface under “Language model” – it suggests one that fits the graphics card.",
      aiOllama: "Found Ollama on this PC (models: $1). Choose a model in the tab “AI assistant”.",
      aiNone: "No AI found. Options are the NovaBird Helper (choose a language model in its web interface) or your own Ollama or an OpenAI-compatible server.",
      openAiTab: "Open the “AI assistant” tab", featH: "Functions",
      feat: { summary: "Summary", translate: "Translate", events: "Appointments and tasks", deadlines: "Deadlines", overview: "What's new?", speech: "Read aloud (Helper only)", compose: "Write", phish: "Phishing check (for NovaBird Phishing Protection, every new message)" },
      doneH: "Done", doneLead: "This is how NovaBird is set up now. Anything open can be done any time here under “Setup”.",
      ovIntroUp: "What is new and where the settings are now.", ovIntroNew: "What NovaBird does.",
      sOff: "Off – word search only.", sMissing: "NovaBird-Search is not installed.", sOpen: "Not set up yet.", sDl: "Downloading the language model ($1 %).",
      sWait: "Waiting for the search index.", sRun: "$1 of $2 messages ($3 %)", sEta: " · about $1 left", sDone: "Done: $1 messages.", sErr: "Error: $1",
      hOk: "Connected: $1", hOpen: "Not connected.", hRec: "Not connected – recommended for you.", hOther: "Windows only – not needed here.",
      aOpen: "Not set up yet.",
      lt1: "less than a minute", about: "about $1",
    },
    fr: {
      titleUp: "Bienvenue dans NovaBird 2.0", titleNew: "Bienvenue dans NovaBird", titleOverview: "Configuration",
      leadWizard: "En quelques minutes, tout est configuré. Chaque étape peut être ignorée et reprise plus tard ici, sous « Configuration ».",
      leadOverview: "Ce qui est configuré sur ce PC – et ce qui manque encore.",
      steps: { intro: "Nouveautés", moved: "Déplacé", search: "Recherche par le sens", helper: "NovaBird Helper", ai: "Assistant IA", done: "Terminé" },
      back: "Retour", next: "Suivant", finish: "Terminé", toOverview: "Vue d’ensemble", restart: "Relancer l’assistant", setUp: "Configurer", view: "Voir",
      pill: { done: "Fait", open: "À faire", run: "En cours", none: "Facultatif" },
      introUpH: "Nouveautés de la 2.0", introNewH: "Ce que fait NovaBird",
      f: {
        semantic: ["Recherche par le sens (bêta)", "Trouve les messages par leur sens : « réunion des parents » trouve aussi « soirée parents-professeurs ». La recherche par mots reste inchangée."],
        ai: ["Assistant IA", "Résumer, traduire, repérer rendez-vous et échéances, rédiger des réponses, « Quoi de neuf ? » et lecture à voix haute – avec une IA sur votre PC ou votre réseau."],
        helper: ["NovaBird Helper (facultatif)", "Calcule la recherche et l’IA sur la carte graphique – pour tous les PC de la famille ou du bureau. Pour Windows."],
        four: ["Quatre modules au lieu de huit", "Les thèmes font maintenant partie de l’Extension ; barre de recherche et index ne forment qu’un module : NovaBird-Search."],
        tabs: ["Paramètres par tâche", "Paramètres → NovaBird a des onglets : Général, Recherche, Assistant IA, NovaBird Helper, Conversation, Envoi."],
        look: ["Un Thunderbird plus clair", "Liste des messages, volet agenda, aperçu des pièces jointes, thèmes et paramètres plus lisibles."],
      },
      movedH: "Qu’est-ce qui a changé de place ?", movedLead: "Tous les paramètres ont été repris, seul leur emplacement a changé. Ce qui vous concerne est signalé.",
      mine: "vous concerne", show: "Afficher",
      mv: {
        tabs: ["Un onglet par module", "Onglets par tâche : Général · Recherche · Assistant IA · NovaBird Helper · Conversation · Envoi"],
        ai: ["Résumé IA dans l’onglet de l’Extension", "Onglet propre « Assistant IA »"],
        theme: ["Modules de thème Sand, Cobalt, Springlight", "Général → Couleurs et polices → Thème"],
        search: ["NovaBird-Search et NovaBird-DB", "Un onglet « Recherche » avec les sous-onglets Recherche et Index"],
      },
      searchWhat: "La recherche par le sens trouve les messages selon ce qu’ils veulent dire, pas selon le mot exact. Pour cela, NovaBird calcule une fois une « empreinte » du sens de chaque message. La recherche par mots reste toujours disponible.",
      searchCost: "Le modèle de langue pour la recherche est téléchargé une fois ($1). Pendant le calcul, Thunderbird utilise environ $2 de mémoire en plus ; le calcul se fait quand le PC n’est pas utilisé.",
      searchYes: "Configurer et mesurer", searchNo: "Non, recherche par mots seulement", searchNoSet: "Seule la recherche par mots est activée.", searchUndo: "Configurer quand même",
      searchMissing: "NovaBird-Search n’est pas installé – cette étape est sans objet.",
      dl: "Téléchargement du modèle de langue … $1 sur $2",
      waitIndex: "L’index de recherche est en cours de construction. La mesure démarre dès qu’il est prêt – vous pouvez continuer ; le résultat apparaîtra ensuite ici, sous « Configuration ».",
      measuring: "Mesure de la vitesse sur $1 de vos messages les plus récents …", measureErr: "Mesure impossible : $1", again: "Mesurer à nouveau", measure: "Mesurer la vitesse",
      statRate: "messages par seconde", statMails: "messages au total", statTime: "temps de calcul (estimé)", statDone: "déjà fait",
      engine: { addon: "Calculé dans le module (processeur, $1 cœurs).", helper: "Calculé dans le NovaBird Helper.", server: "Calculé sur votre propre serveur." },
      timeNote: "Temps de calcul pur : NovaBird ne calcule que lorsque le PC n’est pas utilisé, Thunderbird reste utilisable. Les nouveaux messages sont ajoutés tout de suite.",
      allDone: "Tous les messages ont déjà leur empreinte.",
      recOk: "Parfait : ce PC s’en sort seul.", recRemote: "Tourne déjà sur la carte graphique ou votre propre serveur.",
      recGpu: "À partir de $1, la carte graphique vaut le coup : avec le NovaBird Helper, c’est en général fait en une fraction du temps – étape suivante.",
      recGpuOther: "À partir de $1, un serveur avec puce graphique vaut le coup (p. ex. Ollama sur un Mac) : Recherche → Recherche par le sens → Où calculer ?",
      recGpuMac: "À partir de $1, la puce graphique vaut le coup : sur Mac, Ollama calcule la recherche – Recherche → Recherche par le sens → « Ollama sur ce Mac ».",
      qMulti: "Utilisez-vous NovaBird sur plusieurs PC ou sur un portable ?", qOn: "L’un d’eux est-il allumé la plupart du temps ?", yes: "Oui", no: "Non",
      recMultiOn: "Le NovaBird Helper vaut alors le coup sur le PC qui reste allumé : il calcule pour tous, les autres PC et portables reçoivent les résultats et économisent temps et batterie.",
      recMultiOff: "Chaque PC calcule alors lui-même. Avec le Helper, les résultats peuvent être synchronisés via un dossier partagé, chaque message n’est calculé qu’une fois.",
      helperRec: "Recommandé pour vous.", whyTime: "La recherche par le sens prendrait environ $1 sur ce PC.", whyMulti: "Vous utilisez plusieurs PC et l’un d’eux reste allumé.",
      helperWhatH: "Que fait le Helper ?",
      helperWhat: [
        "Calcule la recherche par le sens sur la carte graphique – en général bien plus vite que le processeur.",
        "Fournit un modèle de langue à l’assistant IA et lit les messages à voix haute.",
        "Calcule pour tous les PC du réseau ; les résultats sont partagés chiffrés, chaque message n’est calculé qu’une fois.",
        "Ne stocke aucun texte de message, seulement des résultats chiffrés. S’installe sans droits d’administrateur ; choisit lui-même la carte graphique et un modèle adapté.",
      ],
      helperHowH: "Comment faire",
      helperHow: [
        "Télécharger le Helper et l’installer sur le PC qui reste allumé – idéalement avec une carte graphique.",
        "Son interface web affiche l’adresse et le code d’appairage sous « Connexion ».",
        "Saisir les deux dans l’onglet « NovaBird Helper » et cliquer sur « Connecter ». Ce qu’il a détecté s’affiche ensuite ici.",
      ],
      download: "Télécharger le Helper", openHelperTab: "Ouvrir l’onglet « NovaBird Helper »",
      helperOk: "Connecté à $1", helperOkSub: "Appareil : $1 · Modèle de langue : $2", noModel: "aucun choisi",
      helperFail: "Configuré, mais injoignable pour le moment : $1",
      helperOther: "Le Helper n’existe que pour Windows. Sans lui, la recherche calcule dans le module ; pour l’IA et une recherche plus rapide, un serveur comme Ollama convient (utilise la puce graphique sur un Mac). Un Helper sur un PC Windows du réseau peut tout de même être connecté.",
      helperOptional: "Facultatif : tout fonctionne sans le Helper – la recherche calcule alors sur le processeur, l’IA a besoin de votre propre serveur.",
      aiWhat: "L’assistant IA résume les messages, traduit, repère rendez-vous et échéances, aide à rédiger et prépare « Quoi de neuf ? ». Les textes des messages ne vont qu’à l’IA configurée ici.",
      aiReady: "Configuré : $1", aiOff: "Configuré, mais désactivé (onglet « Assistant IA »).", aiViaHelper: "$1 dans le NovaBird Helper", aiViaOwn: "$1 sur $2",
      aiUseHelper: "Utiliser l’IA via le Helper ($1)", aiHelperReady: "Le Helper connecté a un modèle de langue : $1.",
      aiHelperNoModel: "Le Helper est connecté mais n’a pas encore de modèle de langue. En choisir un dans son interface web sous « Modèle de langue » – il en propose un adapté à la carte graphique.",
      aiOllama: "Ollama trouvé sur ce PC (modèles : $1). Choisir un modèle dans l’onglet « Assistant IA ».",
      aiNone: "Aucune IA trouvée. Possible : le NovaBird Helper (choisir un modèle dans son interface web) ou votre propre Ollama ou un serveur compatible OpenAI.",
      openAiTab: "Ouvrir l’onglet « Assistant IA »", featH: "Fonctions",
      feat: { summary: "Résumé", translate: "Traduire", events: "Rendez-vous et tâches", deadlines: "Échéances", overview: "Quoi de neuf ?", speech: "Lecture à voix haute (Helper uniquement)", compose: "Rédiger", phish: "Contrôle anti-hameçonnage (pour NovaBird Protection anti-hameçonnage, chaque nouveau message)" },
      doneH: "Terminé", doneLead: "Voici comment NovaBird est configuré. Ce qui reste peut être fait à tout moment ici, sous « Configuration ».",
      ovIntroUp: "Ce qui est nouveau et où se trouvent les paramètres.", ovIntroNew: "Ce que fait NovaBird.",
      sOff: "Désactivée – recherche par mots seulement.", sMissing: "NovaBird-Search n’est pas installé.", sOpen: "Pas encore configurée.", sDl: "Téléchargement du modèle ($1 %).",
      sWait: "En attente de l’index de recherche.", sRun: "$1 sur $2 messages ($3 %)", sEta: " · encore environ $1", sDone: "Terminé : $1 messages.", sErr: "Erreur : $1",
      hOk: "Connecté : $1", hOpen: "Non connecté.", hRec: "Non connecté – recommandé pour vous.", hOther: "Windows uniquement – inutile ici.",
      aOpen: "Pas encore configuré.",
      lt1: "moins d’une minute", about: "environ $1",
    },
    es: {
      titleUp: "Bienvenido a NovaBird 2.0", titleNew: "Bienvenido a NovaBird", titleOverview: "Configuración",
      leadWizard: "En unos minutos está todo configurado. Cada paso se puede omitir y hacer más tarde aquí, en «Configuración».",
      leadOverview: "Qué está configurado en este PC y qué falta todavía.",
      steps: { intro: "Novedades", moved: "Cambios de lugar", search: "Búsqueda por significado", helper: "NovaBird Helper", ai: "Asistente IA", done: "Listo" },
      back: "Atrás", next: "Siguiente", finish: "Listo", toOverview: "Resumen", restart: "Iniciar el asistente de nuevo", setUp: "Configurar", view: "Ver",
      pill: { done: "Hecho", open: "Pendiente", run: "En curso", none: "Opcional" },
      introUpH: "Novedades de la 2.0", introNewH: "Qué hace NovaBird",
      f: {
        semantic: ["Búsqueda por significado (beta)", "Encuentra correos por su sentido: «reunión de padres» también encuentra «tutoría de padres». La búsqueda por palabras sigue igual."],
        ai: ["Asistente IA", "Resumir, traducir, detectar citas y plazos, redactar respuestas, «¿Qué hay de nuevo?» y lectura en voz alta, con una IA en su propio PC o red."],
        helper: ["NovaBird Helper (opcional)", "Calcula la búsqueda y la IA en la tarjeta gráfica, para todos los PC de la familia o la oficina. Para Windows."],
        four: ["Cuatro complementos en vez de ocho", "Los diseños forman parte de la Extension; barra de búsqueda e índice son un solo complemento: NovaBird-Search."],
        tabs: ["Ajustes por tareas", "Ajustes → NovaBird tiene pestañas: General, Búsqueda, Asistente IA, NovaBird Helper, Conversación, Envío."],
        look: ["Un Thunderbird más ordenado", "Lista de mensajes, panel de calendario, vista previa de adjuntos, diseños y ajustes más claros."],
      },
      movedH: "¿Qué ha cambiado de lugar?", movedLead: "Se han conservado todos los ajustes; solo ha cambiado su lugar. Está marcado lo que le afecta.",
      mine: "le afecta", show: "Mostrar",
      mv: {
        tabs: ["Una pestaña por complemento", "Pestañas por tareas: General · Búsqueda · Asistente IA · NovaBird Helper · Conversación · Envío"],
        ai: ["Resumen IA en la pestaña de la Extension", "Pestaña propia «Asistente IA»"],
        theme: ["Complementos de tema Sand, Cobalt, Springlight", "General → Colores y fuentes → Diseño"],
        search: ["NovaBird-Search y NovaBird-DB", "Una pestaña «Búsqueda» con las subpestañas Búsqueda e Índice"],
      },
      searchWhat: "La búsqueda por significado encuentra correos por lo que quieren decir y no por la palabra exacta. Para ello NovaBird calcula una vez una «huella» del significado de cada correo. La búsqueda por palabras siempre sigue disponible.",
      searchCost: "El modelo de lenguaje para la búsqueda se descarga una vez ($1). Mientras calcula, Thunderbird necesita unos $2 más de memoria; calcula cuando el PC no se está usando.",
      searchYes: "Configurar y medir", searchNo: "No, solo búsqueda por palabras", searchNoSet: "Solo está activada la búsqueda por palabras.", searchUndo: "Configurar de todos modos",
      searchMissing: "NovaBird-Search no está instalado; este paso no aplica.",
      dl: "Descargando el modelo de lenguaje … $1 de $2",
      waitIndex: "El índice de búsqueda se está creando. La medición empieza en cuanto esté listo; puede continuar y el resultado aparecerá luego aquí, en «Configuración».",
      measuring: "Midiendo la velocidad con $1 de sus correos más recientes …", measureErr: "No se pudo medir: $1", again: "Medir de nuevo", measure: "Medir la velocidad",
      statRate: "correos por segundo", statMails: "correos en total", statTime: "tiempo de cálculo (estimado)", statDone: "ya hecho",
      engine: { addon: "Calculado en el complemento (procesador, $1 núcleos).", helper: "Calculado en el NovaBird Helper.", server: "Calculado en su propio servidor." },
      timeNote: "Tiempo de cálculo puro: NovaBird solo calcula cuando el PC no se usa y Thunderbird sigue disponible. Los correos nuevos se añaden enseguida.",
      allDone: "Todos los correos ya tienen su huella.",
      recOk: "Perfecto: este PC puede solo.", recRemote: "Ya se ejecuta en la tarjeta gráfica o en su propio servidor.",
      recGpu: "A partir de $1 compensa la tarjeta gráfica: con el NovaBird Helper suele estar listo en una fracción del tiempo – siguiente paso.",
      recGpuOther: "A partir de $1 compensa un servidor propio con chip gráfico (p. ej. Ollama en un Mac): Búsqueda → Búsqueda por significado → ¿Dónde calcular?",
      recGpuMac: "A partir de $1 compensa el chip gráfico: en un Mac, Ollama calcula la búsqueda – Búsqueda → Búsqueda por significado → «Ollama en este Mac».",
      qMulti: "¿Usan NovaBird en varios PC o en un portátil?", qOn: "¿Uno de ellos está encendido casi siempre?", yes: "Sí", no: "No",
      recMultiOn: "Entonces compensa el NovaBird Helper en el PC que suele estar encendido: calcula para todos, los demás PC y portátiles reciben los resultados y ahorran tiempo y batería.",
      recMultiOff: "Entonces cada PC calcula por su cuenta. Con el Helper los resultados se pueden sincronizar mediante una carpeta compartida, así cada correo se calcula una sola vez.",
      helperRec: "Recomendado para usted.", whyTime: "La búsqueda por significado tardaría unos $1 en este PC.", whyMulti: "Usan varios PC y uno suele estar encendido.",
      helperWhatH: "¿Qué hace el Helper?",
      helperWhat: [
        "Calcula la búsqueda por significado en la tarjeta gráfica, normalmente mucho más rápido que el procesador.",
        "Ofrece un modelo de lenguaje al asistente IA y lee correos en voz alta.",
        "Calcula para todos los PC de la red; los resultados se comparten cifrados, así cada correo se calcula una sola vez.",
        "No guarda textos de correos, solo resultados cifrados. Se instala sin derechos de administrador; elige él mismo la tarjeta gráfica y un modelo adecuado.",
      ],
      helperHowH: "Cómo se hace",
      helperHow: [
        "Descargar el Helper e instalarlo en el PC que suele estar encendido, idealmente uno con tarjeta gráfica.",
        "Su interfaz web muestra la dirección y el código de emparejamiento en «Conexión».",
        "Introducir ambos en la pestaña «NovaBird Helper» y pulsar «Conectar». Lo que detectó aparece luego aquí.",
      ],
      download: "Descargar el Helper", openHelperTab: "Abrir la pestaña «NovaBird Helper»",
      helperOk: "Conectado a $1", helperOkSub: "Dispositivo: $1 · Modelo de lenguaje: $2", noModel: "ninguno elegido",
      helperFail: "Configurado, pero ahora no accesible: $1",
      helperOther: "El Helper solo existe para Windows. Sin él, la búsqueda calcula en el complemento; para la IA y una búsqueda más rápida sirve un servidor propio como Ollama (en un Mac usa el chip gráfico). Aun así se puede conectar un Helper en un PC con Windows de la red.",
      helperOptional: "Opcional: todo funciona sin el Helper; la búsqueda calcula entonces en el procesador y la IA necesita su propio servidor.",
      aiWhat: "El asistente IA resume correos, traduce, detecta citas y plazos, ayuda a redactar y prepara «¿Qué hay de nuevo?». Los textos de los correos solo van a la IA configurada aquí.",
      aiReady: "Configurado: $1", aiOff: "Configurado, pero desactivado (pestaña «Asistente IA»).", aiViaHelper: "$1 en el NovaBird Helper", aiViaOwn: "$1 en $2",
      aiUseHelper: "Usar la IA del Helper ($1)", aiHelperReady: "El Helper conectado tiene un modelo de lenguaje: $1.",
      aiHelperNoModel: "El Helper está conectado pero aún no tiene modelo de lenguaje. Elija uno en su interfaz web, en «Modelo de lenguaje»; él propone uno adecuado a la tarjeta gráfica.",
      aiOllama: "Ollama encontrado en este PC (modelos: $1). Elija un modelo en la pestaña «Asistente IA».",
      aiNone: "No se encontró ninguna IA. Opciones: el NovaBird Helper (elegir un modelo en su interfaz web) o su propio Ollama o un servidor compatible con OpenAI.",
      openAiTab: "Abrir la pestaña «Asistente IA»", featH: "Funciones",
      feat: { summary: "Resumen", translate: "Traducir", events: "Citas y tareas", deadlines: "Plazos", overview: "¿Qué hay de nuevo?", speech: "Lectura en voz alta (solo con Helper)", compose: "Redactar", phish: "Control antiphishing (para NovaBird Protección antiphishing, cada correo nuevo)" },
      doneH: "Listo", doneLead: "Así está configurado NovaBird ahora. Lo pendiente se puede hacer en cualquier momento aquí, en «Configuración».",
      ovIntroUp: "Qué hay de nuevo y dónde están ahora los ajustes.", ovIntroNew: "Qué hace NovaBird.",
      sOff: "Desactivada: solo búsqueda por palabras.", sMissing: "NovaBird-Search no está instalado.", sOpen: "Aún no configurada.", sDl: "Descargando el modelo ($1 %).",
      sWait: "Esperando al índice de búsqueda.", sRun: "$1 de $2 correos ($3 %)", sEta: " · faltan unos $1", sDone: "Listo: $1 correos.", sErr: "Error: $1",
      hOk: "Conectado: $1", hOpen: "Sin conectar.", hRec: "Sin conectar: recomendado para usted.", hOther: "Solo Windows: aquí no hace falta.",
      aOpen: "Aún no configurado.",
      lt1: "menos de un minuto", about: "unos $1",
    },
  };
  const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
  const t = T[lang] || T.en;
  const fill = (s, ...a) => a.reduce((x, v, i) => x.replace("$" + (i + 1), v), s);
  const $ = id => document.getElementById(id);
  const num = (n, digits = 0) => new Intl.NumberFormat(lang, { maximumFractionDigits: digits }).format(n);
  const unit = (n, u, digits = 0) => new Intl.NumberFormat(lang, { style: "unit", unit: u, unitDisplay: u === "megabyte" || u === "gigabyte" ? "short" : "long", maximumFractionDigits: digits }).format(n);
  const mb = bytes => unit(Math.round(bytes / 1e6), "megabyte");
  function duration(minutes) {
    if (minutes < 1) return t.lt1;
    if (minutes < 90) return fill(t.about, unit(Math.round(minutes), "minute"));
    if (minutes < 48 * 60) return fill(t.about, unit(Math.round(minutes / 30) / 2, "hour", 1));
    return fill(t.about, unit(Math.round(minutes / 60 / 24), "day"));
  }

  // Kleines DOM-Werkzeug: h("p", {className: "x"}, "Text", kind, …); null/false-Kinder fallen weg
  function h(tag, props, ...kids) {
    const e = Object.assign(document.createElement(tag), props || {});
    e.append(...kids.flat().filter(k => k !== null && k !== undefined && k !== false));
    return e;
  }
  const btn = (text, onclick, primary = false) => h("button", { type: "button", textContent: text, className: primary ? "primary" : "", onclick });
  const row = (...kids) => h("div", { className: "row" }, ...kids);
  const note = (kind, ...kids) => h("div", { className: "note " + kind }, h("span", { className: "sym", textContent: kind === "ok" ? "✓" : kind === "warn" ? "!" : "i", ariaHidden: "true" }), h("div", null, ...kids.map(k => (typeof k === "string" ? h("p", { textContent: k }) : k))));
  const bar = frac => h("div", { className: "progress" }, h("div", { style: `width: ${Math.max(0, Math.min(100, frac * 100)).toFixed(1)}%` }));
  const spinner = () => h("span", { className: "spin", ariaHidden: "true" });
  const openHub = key => messenger.settingsRedesign.openHub(key).catch(() => {});

  // Symbole (24×24, Strich)
  const ICONS = {
    semantic: ["M11 4a7 7 0 1 0 0 14a7 7 0 1 0 0-14z", "M20 20l-4-4", "M8.5 11h5"],
    ai: ["M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z", "M18.5 15l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z"],
    helper: ["M7 7h10v10H7z", "M10 3v4M14 3v4M10 17v4M14 17v4M3 10h4M3 14h4M17 10h4M17 14h4"],
    four: ["M4 4h7v7H4z", "M13 4h7v7h-7z", "M4 13h7v7H4z", "M13 13h7v7h-7z"],
    tabs: ["M4 6h16", "M4 12h16", "M4 18h10"],
    look: ["M3 5h18v14H3z", "M3 9h18", "M9 9v10"],
    moved: ["M4 12h14", "M13 7l5 5-5 5"],
  };
  function icon(name) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    for (const d of ICONS[name] || []) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      svg.append(p);
    }
    return h("span", { className: "icon", ariaHidden: "true" }, svg);
  }
  const STEP_ICON = { intro: "four", moved: "moved", search: "semantic", helper: "helper", ai: "ai" };

  // ---- Zustand --------------------------------------------------------------------------------------------------------
  let setup = null; // storage.local „setup“
  let search = null; // Antwort von NovaBird-Search auf setup:state; null = nicht installiert
  let conn = null; // Verbindung zum Helper (storage.local „helperConn“)
  let info = null; // Antwort des Helpers auf „hello“
  let helperErr = null;
  let ai = null; // KI-Einstellungen
  let ollama = null; // Modelle eines Ollama auf diesem PC (nur wenn die KI noch nicht eingerichtet ist)
  let platform = "win";
  let uiTheme = "";
  let folderTotal = null; // Mails laut Thunderbird (ohne Papierkorb und Spam), solange der Suchindex noch nicht zählt
  let measuring = false;
  let measureErr = null;
  let current = null; // Schritt im Assistenten; null = Übersicht

  const save = () => messenger.storage.local.set({ setup });
  const steps = () => ["intro", setup.mode === "upgrade" ? "moved" : null, "search", "helper", "ai", "done"].filter(Boolean);

  async function loadSearch() {
    try {
      search = (await messenger.runtime.sendMessage(SEARCH_ID, { type: "setup:state" })) || null;
    } catch {
      search = null;
    }
  }
  async function loadHelper() {
    const { helperConn } = await messenger.storage.local.get({ helperConn: null });
    conn = helperConn?.url ? helperConn : null;
    info = null;
    helperErr = null;
    if (!conn) return;
    try {
      info = await nbAI.helperHello(conn.url, conn.code, conn.label);
    } catch (e) {
      helperErr = String(e?.message || e);
    }
  }
  const aiReady = () => Boolean(ai.aiUrl && (ai.aiModel || ai.aiType === "nbhelper") && (ai.aiType !== "nbhelper" || ai.aiKey));
  async function loadAi() {
    ai = await messenger.storage.local.get(nbAI.DEFAULTS);
    ollama = null;
    if (!aiReady()) {
      ollama = await nbAI.listModels({ ...nbAI.DEFAULTS, aiType: "ollama", aiUrl: ai.aiType === "ollama" && ai.aiUrl ? ai.aiUrl : nbAI.DEFAULTS.aiUrl }).catch(() => null);
    }
  }
  async function countFolders() {
    let n = 0;
    const walk = async folders => {
      for (const f of folders || []) {
        const use = f.specialUse || [];
        if (!use.includes("trash") && !use.includes("junk") && f.type !== "trash" && f.type !== "junk") {
          n += (await messenger.folders.getFolderInfo(f).catch(() => null))?.totalMessageCount || 0;
        }
        await walk(f.subFolders);
      }
    };
    for (const a of await messenger.accounts.list(true)) await walk(a.folders);
    return n;
  }

  // ---- Schätzung und Empfehlung ---------------------------------------------------------------------------------------
  const totalMails = () => Math.max(search?.done || 0, search?.wordIndex && search.total ? search.total : folderTotal || 0);
  function minutesLeft() {
    const rate = setup.measure?.rate;
    if (!rate || !search) return null;
    return Math.max(0, totalMails() - (search.done || 0)) / rate / 60;
  }
  const needsGpu = () => setup.measure?.rate && setup.measure.engine === "addon" && minutesLeft() >= GPU_MINUTES;
  const multiOn = () => setup.answers.multi === "yes" && setup.answers.alwaysOn === "yes";
  const helperReasons = () => [needsGpu() ? fill(t.whyTime, duration(minutesLeft())) : null, multiOn() ? t.whyMulti : null].filter(Boolean);

  // Stand je Bereich: pill done | open | run | none, Text, Fortschritt (0..1)
  function status(key) {
    if (key === "intro" || key === "moved") {
      return { pill: setup.steps.intro || setup.steps.moved ? "done" : "open", text: setup.mode === "upgrade" ? t.ovIntroUp : t.ovIntroNew };
    }
    if (key === "search") {
      const s = search;
      if (!s) return { pill: "none", text: t.sMissing };
      if (!s.enabled) return setup.answers.semantic === "no" ? { pill: "none", text: t.sOff } : { pill: "open", text: t.sOpen };
      if (s.phase === "downloading") {
        const d = s.download || {};
        return { pill: "run", text: fill(t.sDl, num(d.total ? (100 * d.done) / d.total : 0)), frac: d.total ? d.done / d.total : 0 };
      }
      if (s.phase === "waiting-index" || !s.wordIndex) return { pill: "run", text: t.sWait };
      if (s.phase === "error" && s.error) return { pill: "open", text: fill(t.sErr, s.error) };
      const total = totalMails();
      const frac = total ? Math.min(1, s.done / total) : 0;
      if (s.phase === "done" || (total && s.done >= total)) return { pill: "done", text: fill(t.sDone, num(s.done)), frac: 1 };
      const left = minutesLeft();
      return { pill: "run", text: fill(t.sRun, num(s.done), num(total), num(frac * 100)) + (left !== null ? fill(t.sEta, duration(left)) : ""), frac };
    }
    if (key === "helper") {
      if (info) return { pill: "done", text: fill(t.hOk, info.deviceName || info.device || conn.label || new URL(conn.url).hostname) };
      if (conn && helperErr) return { pill: "open", text: fill(t.helperFail, helperErr) };
      if (helperReasons().length) return { pill: "open", text: t.hRec };
      return { pill: "none", text: platform === "win" ? t.hOpen : t.hOther };
    }
    if (key === "ai") {
      if (aiReady()) return { pill: ai.aiEnabled ? "done" : "open", text: ai.aiEnabled ? aiLabel() : t.aiOff };
      return { pill: "open", text: t.aOpen };
    }
    return { pill: "none", text: "" };
  }
  const aiLabel = () =>
    ai.aiType === "nbhelper"
      ? fill(t.aiViaHelper, (info?.chatModel || "").replace(/^ollama:/, "") || "–")
      : fill(t.aiViaOwn, ai.aiModel, (() => { try { return new URL(ai.aiUrl).host; } catch { return ai.aiUrl; } })());

  // ---- Schritte ---------------------------------------------------------------------------------------------------------
  function featureCard(key) {
    const [title, text] = t.f[key];
    const ic = { semantic: "semantic", ai: "ai", helper: "helper", four: "four", tabs: "tabs", look: "look" }[key];
    return h("div", { className: "feature" }, icon(ic), h("div", null, h("h3", { textContent: title }), h("p", { textContent: text })));
  }
  function introView() {
    const keys = setup.mode === "upgrade" ? ["semantic", "ai", "helper", "four", "tabs"] : ["semantic", "ai", "helper", "look"];
    return [h("h2", { textContent: setup.mode === "upgrade" ? t.introUpH : t.introNewH }), h("div", { className: "features" }, keys.map(featureCard))];
  }

  function movedView() {
    const rows = [
      { k: "ai", hub: "ai", mine: Boolean(ai.aiEnabled || ai.aiModel) },
      { k: "theme", hub: "extension", mine: ["sand", "cobalt", "springlight"].includes(uiTheme) },
      { k: "search", hub: search ? "db" : null, mine: Boolean(search?.migrated) },
      { k: "tabs", hub: "extension", mine: false },
    ].sort((a, b) => Number(b.mine) - Number(a.mine));
    return [
      h("h2", { textContent: t.movedH }),
      h("p", { className: "muted", textContent: t.movedLead }),
      h("div", { className: "card" }, h("table", { className: "moves" }, h("tbody", null, rows.map(r =>
        h("tr", null,
          h("td", { className: "was", textContent: t.mv[r.k][0] }),
          h("td", { className: "arrow", textContent: "→" }),
          h("td", null, t.mv[r.k][1], r.mine ? h("span", { className: "tag", textContent: t.mine }) : null),
          h("td", { className: "go" }, r.hub ? btn(t.show, () => openHub(r.hub)) : null)))))),
    ];
  }

  function choice(key) {
    const b = (val, text) => {
      const e = btn(text, async () => {
        setup.answers[key] = val;
        await save();
        refresh();
      });
      e.setAttribute("aria-pressed", String(setup.answers[key] === val));
      return e;
    };
    return h("div", { className: "choice" }, b("yes", t.yes), b("no", t.no));
  }

  function searchBody() {
    const s = search;
    if (!s) return [note("info", t.searchMissing)];
    const out = [h("p", { textContent: t.searchWhat })];
    if (!s.enabled) {
      if (setup.answers.semantic === "no") {
        out.push(note("info", t.searchNoSet), row(btn(t.searchUndo, enableSearch)));
      } else {
        out.push(h("p", { className: "muted", textContent: fill(t.searchCost, mb(s.bytes), unit(s.ramMB / 1024, "gigabyte", 1)) }));
        out.push(row(btn(t.searchYes, enableSearch, true), btn(t.searchNo, async () => {
          setup.answers.semantic = "no";
          await save();
          refresh();
        })));
      }
      return out;
    }
    if (s.phase === "downloading") {
      const d = s.download || {};
      out.push(h("p", null, spinner(), fill(t.dl, mb(d.done || 0), mb(d.total || s.bytes))), bar(d.total ? d.done / d.total : 0));
      return out;
    }
    if (s.phase === "waiting-index" || !s.wordIndex) {
      out.push(note("info", t.waitIndex));
    } else if (measuring) {
      out.push(h("p", null, spinner(), fill(t.measuring, num(MEASURE_MAILS))));
    } else {
      if (measureErr) out.push(note("warn", fill(t.measureErr, measureErr)));
      if (setup.measure) {
        out.push(...resultView());
      } else {
        // schon vorher eingeschaltet (oder Messen ging nicht): Stand zeigen, Messen auf Knopfdruck
        const st = status("search");
        out.push(note(st.pill === "done" ? "ok" : "info", st.text), st.pill === "run" && st.frac !== undefined ? bar(st.frac) : null, st.pill === "done" ? null : row(btn(t.measure, runMeasure, true)));
      }
    }
    out.push(h("h3", { textContent: t.qMulti }), choice("multi"));
    if (setup.answers.multi === "yes") out.push(h("h3", { textContent: t.qOn }), choice("alwaysOn"));
    if (setup.answers.multi === "yes" && setup.answers.alwaysOn) out.push(note("info", setup.answers.alwaysOn === "yes" ? t.recMultiOn : t.recMultiOff));
    return out.filter(Boolean);
  }

  function resultView() {
    const m = setup.measure;
    const s = search;
    const out = [];
    if (m.allDone || !m.rate) {
      out.push(note("ok", t.allDone));
      return out;
    }
    const total = totalMails();
    const left = minutesLeft();
    out.push(h("div", { className: "stats" },
      h("div", { className: "stat" }, h("b", { textContent: num(m.rate, m.rate < 10 ? 1 : 0) }), h("span", { textContent: t.statRate })),
      h("div", { className: "stat" }, h("b", { textContent: num(total) }), h("span", { textContent: t.statMails })),
      h("div", { className: "stat" }, h("b", { textContent: duration(left) }), h("span", { textContent: t.statTime })),
      h("div", { className: "stat" }, h("b", { textContent: num(total ? (100 * s.done) / total : 0) + " %" }), h("span", { textContent: t.statDone }))));
    out.push(bar(total ? s.done / total : 0));
    out.push(h("p", { className: "muted small", textContent: fill(t.engine[m.engine] || t.engine.addon, num(s.cores || 0)) + " " + t.timeNote }));
    if (m.engine !== "addon") out.push(note("ok", t.recRemote));
    else if (left < GPU_MINUTES) out.push(note("ok", t.recOk));
    else out.push(note("warn", fill(platform === "win" ? t.recGpu : platform === "mac" ? t.recGpuMac : t.recGpuOther, duration(GPU_MINUTES))));
    out.push(row(btn(t.again, runMeasure)));
    return out;
  }

  function searchView() {
    return [h("h2", { textContent: t.steps.search }), h("div", { id: "searchLive" }, searchBody())];
  }

  async function enableSearch() {
    setup.answers.semantic = "yes";
    await save();
    await messenger.runtime.sendMessage(SEARCH_ID, { type: "setup:enable" }).catch(e => (measureErr = String(e?.message || e)));
    await loadSearch();
    refresh();
    maybeMeasure();
  }

  // Gemessen wird, sobald das Modell bereit und der Suchindex nutzbar ist – auch später in der Übersicht
  function maybeMeasure() {
    const s = search;
    if (!s?.enabled || measuring || setup.measure || setup.answers.semantic !== "yes" || !s.wordIndex) return;
    if (s.phase === "downloading" || s.phase === "no-model" || s.phase === "off") return;
    if (!s.modelReady && !["indexing", "waiting-idle", "done"].includes(s.phase)) return;
    runMeasure();
  }

  async function runMeasure() {
    measuring = true;
    measureErr = null;
    refresh();
    try {
      const r = await messenger.runtime.sendMessage(SEARCH_ID, { type: "setup:measure" });
      if (r?.rate) setup.measure = { rate: r.rate, engine: r.engine || "addon", at: Date.now() };
      else if (r?.phase === "done") setup.measure = { rate: null, engine: r.engine || "addon", at: Date.now(), allDone: true };
      else if (r?.phase !== "waiting-index") measureErr = r?.error || r?.phase || "?";
      await save();
    } catch (e) {
      measureErr = String(e?.message || e);
    }
    measuring = false;
    await loadSearch();
    refresh();
  }

  function helperView() {
    const out = [h("h2", { textContent: "NovaBird Helper" })];
    const why = helperReasons();
    if (info) {
      out.push(note("ok", h("p", null, h("b", { textContent: fill(t.helperOk, new URL(conn.url).hostname) })),
        fill(t.helperOkSub, info.deviceName || info.device || "–", info.chatModel ? info.chatModel.replace(/^ollama:/, "") : t.noModel)));
    } else if (why.length) {
      out.push(note("warn", h("p", null, h("b", { textContent: t.helperRec })), why.join(" ")));
    }
    if (conn && helperErr) out.push(note("warn", fill(t.helperFail, helperErr)));
    out.push(h("div", { className: "card flat" }, h("h3", { textContent: t.helperWhatH }), h("ul", { className: "plain" }, t.helperWhat.map(x => h("li", { textContent: x })))));
    if (!info) {
      if (platform !== "win") out.push(note("info", t.helperOther));
      out.push(h("h3", { textContent: t.helperHowH }), h("ol", { className: "how" }, t.helperHow.map(x => h("li", { textContent: x }))));
      out.push(row(platform === "win" ? btn(t.download, () => messenger.windows.openDefaultBrowser(HELPER_URL), true) : null, btn(t.openHelperTab, () => openHub("helper"))));
      if (!why.length) out.push(h("p", { className: "muted small", textContent: t.helperOptional }));
    } else {
      out.push(row(btn(t.openHelperTab, () => openHub("helper"))));
    }
    return out;
  }

  function aiView() {
    const out = [h("h2", { textContent: t.steps.ai }), h("p", { textContent: t.aiWhat })];
    if (aiReady()) {
      out.push(note(ai.aiEnabled ? "ok" : "info", ai.aiEnabled ? fill(t.aiReady, aiLabel()) : t.aiOff));
      out.push(h("h3", { textContent: t.featH }), h("div", { className: "checks" }, nbAI.FEATURES.map(f => {
        const box = h("input", { type: "checkbox", checked: nbAI.feature(ai, f) });
        box.addEventListener("change", async () => {
          ai.aiFeatures = { ...(ai.aiFeatures || {}), [f]: box.checked };
          await messenger.storage.local.set({ aiFeatures: ai.aiFeatures });
        });
        return h("label", null, box, h("span", { textContent: t.feat[f] || f }));
      })));
      out.push(row(btn(t.openAiTab, () => openHub("ai"))));
      return out;
    }
    if (info?.chatModel) {
      const model = info.chatModel.replace(/^ollama:/, "");
      out.push(note("info", fill(t.aiHelperReady, model)), row(btn(fill(t.aiUseHelper, model), useHelperAi, true)));
    } else if (info) {
      out.push(note("warn", t.aiHelperNoModel));
    }
    if (ollama?.length) out.push(note("info", fill(t.aiOllama, ollama.slice(0, 4).join(", ") + (ollama.length > 4 ? ", …" : ""))));
    if (!info && !ollama?.length) out.push(note("info", t.aiNone));
    out.push(row(btn(t.openAiTab, () => openHub("ai"))));
    return out;
  }

  // Wie der Haken „KI-Assistent“ im Reiter „NovaBird Helper“
  async function useHelperAi() {
    await messenger.storage.local.set({ aiEnabled: true, aiType: "nbhelper", aiUrl: conn.url, aiKey: conn.code });
    await loadAi();
    refresh();
  }

  function item(key) {
    const st = status(key);
    const title = key === "intro" ? (setup.mode === "upgrade" ? t.introUpH : t.introNewH) : t.steps[key];
    return h("div", { className: "item", id: "ov-" + key },
      h("div", { className: "head" }, icon(STEP_ICON[key]), h("h3", { textContent: title }), h("span", { className: "pill " + st.pill, textContent: t.pill[st.pill] })),
      h("p", { textContent: st.text }),
      st.frac !== undefined && st.pill === "run" ? bar(st.frac) : null,
      h("div", { className: "actions" }, btn(st.pill === "done" || key === "intro" ? t.view : t.setUp, () => go(key))));
  }
  const overviewGrid = () => h("div", { className: "overview" }, ["search", "helper", "ai", "intro"].map(item));
  const doneView = () => [h("h2", { textContent: t.doneH }), h("p", { className: "muted", textContent: t.doneLead }), overviewGrid()];

  const VIEWS = { intro: introView, moved: movedView, search: searchView, helper: helperView, ai: aiView, done: doneView };

  // ---- Darstellung --------------------------------------------------------------------------------------------------------
  function go(key) {
    current = key;
    render();
    window.scrollTo(0, 0);
  }

  async function next() {
    setup.steps[current] = "seen";
    const list = steps();
    const i = list.indexOf(current);
    if (i >= list.length - 1) {
      setup.wizard = false;
      current = null;
    } else {
      current = list[i + 1];
    }
    await save();
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    const wizard = current !== null;
    $("title").textContent = wizard ? (setup.mode === "upgrade" ? t.titleUp : t.titleNew) : t.titleOverview;
    $("lead").textContent = wizard ? t.leadWizard : t.leadOverview;
    const stepper = $("stepper");
    stepper.hidden = !wizard;
    stepper.replaceChildren(...(wizard ? steps().map((k, i) => {
      const b = h("button", { type: "button", onclick: () => go(k) }, h("span", { className: "num", textContent: setup.steps[k] && k !== current ? "✓" : String(i + 1) }), t.steps[k]);
      if (setup.steps[k]) b.className = "done";
      if (k === current) b.setAttribute("aria-current", "step");
      return b;
    }) : []));
    $("view").replaceChildren(...(wizard ? VIEWS[current]() : [overviewGrid()]));
    const list = steps();
    const last = current === list[list.length - 1];
    $("bar").replaceChildren(...(wizard
      ? [list.indexOf(current) > 0 ? btn(t.back, () => go(list[list.indexOf(current) - 1])) : null, h("span", { className: "space" }),
        setup.wizard ? null : btn(t.toOverview, () => go(null)), btn(last ? t.finish : t.next, next, true)].filter(Boolean)
      : [h("span", { className: "space" }), btn(t.restart, () => go(steps()[0]))]));
  }

  // Nur die Teile neu zeichnen, die sich ändern (Fortschritt der Suche, Antworten) – Knöpfe der Leiste bleiben
  function refresh() {
    const live = $("searchLive");
    if (current === "search" && live) {
      live.replaceChildren(...searchBody());
    } else if (current === null || current === "done") {
      $("view").replaceChildren(...(current === null ? [overviewGrid()] : doneView()));
    } else if (current === "helper" || current === "ai") {
      $("view").replaceChildren(...VIEWS[current]());
    }
  }

  // Suche nachsehen: oft, solange etwas läuft und die Seite sichtbar ist; sonst selten
  let pollTimer = null;
  function poll() {
    clearTimeout(pollTimer);
    const busy = measuring || (search?.enabled && !["done", "off"].includes(search.phase));
    pollTimer = setTimeout(async () => {
      if (search && !document.hidden) {
        await loadSearch();
        if (setup.answers.semantic === "yes" && !totalMails()) folderTotal = await countFolders().catch(() => null);
        maybeMeasure();
        if (!measuring && (current === "search" || current === null || current === "done")) refresh();
      }
      poll();
    }, busy ? 1500 : 10000);
  }

  // Verbindet jemand den Helper oder richtet die KI ein (anderer Reiter), steht das hier gleich
  messenger.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    if (changes.helperConn) await loadHelper();
    // nur KI-Einstellungen, nicht der Vorrat der vorbereiteten Mails (aiDigests ändert sich mit jeder neuen Mail)
    if (changes.helperConn || Object.keys(changes).some(k => k in nbAI.DEFAULTS)) {
      await loadAi();
      refresh();
    }
  });

  (async () => {
    const stored = await messenger.storage.local.get({ setup: null, uiTheme: "" });
    setup = { mode: "new", wizard: false, steps: {}, answers: {}, ...(stored.setup || {}) };
    uiTheme = stored.uiTheme;
    // runtime.getPlatformInfo fehlt der Seite im Hub (eingebettet wie eine Optionsseite)
    platform = /^Win/.test(navigator.platform) ? "win" : /^Mac/.test(navigator.platform) ? "mac" : "linux";
    await Promise.all([loadSearch(), loadHelper(), loadAi()]);
    if (search?.enabled && !(search.wordIndex && search.total)) folderTotal = await countFolders().catch(() => null);
    current = setup.wizard ? steps()[0] : null;
    render();
    maybeMeasure();
    poll();
  })();
})();
