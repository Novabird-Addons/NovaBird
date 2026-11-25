"use strict";
// Reiter „NovaBird Helper“ in Einstellungen → NovaBird: einmal verbinden (Adresse, Kopplungscode), dann per Häkchen wählen,
// wofür der Helper genutzt wird – Suche (NovaBird-Search rechnet die Bedeutungssuche im Helper), KI-Assistent (Sprachmodell
// des Helpers), Team-Kalender (CalDAV, mit einem Klick eingebunden) und geteilte Adressbücher (contacts/abshare.js). Die Verbindung steht in storage.local „helperConn“.
(() => {
  const $ = id => document.getElementById(id);
  const SEARCH_ID = "novabird-db@novabird";
  const T = {
    de: {
      intro: "Der NovaBird Helper rechnet auf einem PC mit Grafikkarte für alle: Bedeutungssuche, KI-Assistent, Team-Kalender und geteilte Adressbücher. Einmal verbinden, dann hier wählen, wofür er genutzt wird.",
      none: "Nicht verbunden", noneSub: "Adresse und Kopplungscode stehen in der Web-Oberfläche des Helpers unter „Verbindung“.",
      checking: "Verbinde …", ok: "Verbunden mit $1", okSub: "Gruppe $1 · $2 · Sprachmodell: $3 · Helper $4", noModel: "keins gewählt",
      fail: "Keine Verbindung: $1", errCode: "Kopplungscode passt nicht", errPerm: "nicht erreichbar oder Erlaubnis für die Adresse fehlt – läuft der Helper? Sonst unten neu verbinden",
      openWeb: "Web-Oberfläche öffnen", useTitle: "Wofür nutzen?",
      useSearch: "Suche: Bedeutungssuche im Helper rechnen", useAi: "KI-Assistent: Sprachmodell des Helpers",
      searchMissing: "NovaBird-Search ist nicht installiert.", searchOn: "Die Suche rechnet im Helper.", searchOff: "Die Suche rechnet ohne Helper – Einstellungen dafür unter Suche → Bedeutungssuche (Wortsuche bleibt immer).",
      searchChecking: "Prüfe den Helper mit den Probetexten …", searchFail: "Suche: $1",
      aiOn: "Der KI-Assistent nutzt $1 im Helper.", aiNoModel: "Eingeschaltet – im Helper ist aber noch kein Sprachmodell gewählt (Web-Oberfläche → Sprachmodell).", aiOff: "Aus – ein eigener Server lässt sich unter KI → KI-Assistent eintragen.",
      modelLabel: "Sprachmodell (nur dieser PC)", modelDefault: "Wie im Helper eingestellt ($1)", modelHint: "Ein anderes Modell als im Helper lädt dort beim ersten Mal neu (einige Sekunden) und braucht Grafikspeicher.", aiOther: "Der KI-Assistent nutzt gerade einen eigenen Server ($1); Häkchen setzen, um auf den Helper umzustellen.",
      abLabel: "Adressbücher teilen", abIntro: "Eigene Adressbücher für andere PCs der Gruppe freigeben; sie bekommen eine Kopie, die sich in beide Richtungen abgleicht. „Gesammelte Adressen“ wird nie geteilt.", abWrite: "Andere dürfen ändern (auch Kontakte löschen)", abCanWrite: "änderbar", abReadOnlyCopy: "nur lesen", abConflicts: "$1 Kontakte wurden gleichzeitig an zwei PCs geändert – die zuerst gespeicherte Fassung gilt.", abHeld: "$1 Löschungen zurückgehalten (mehr als die Hälfte eines Adressbuchs auf einmal) – bitte prüfen.", abErrReadonly: "Nur lesen: der Besitzer erlaubt keine Änderungen.", abForAll: "alle PCs der Gruppe", abForSome: "ausgewählte PCs", abNoPcs: "Noch kein anderer PC in dieser Gruppe.", abOffered: "Für diesen PC angeboten", abNoOffer: "Andere PCs bieten diesem PC noch kein Adressbuch an.", abCount: "$1 Kontakte", abShared: "geteilt, $1 Kontakte", abSkipped: "$1 zu groß, nicht geteilt", abSync: "Jetzt abgleichen", abLast: "Zuletzt abgeglichen: $1", abSyncing: "Gleiche ab …", abRemoved: "Nicht mehr angeboten, Kopie entfernt: $1", abReset: "Verbindung zu einem anderen Helper oder einer anderen Gruppe: Freigaben und Kopien wurden zurückgesetzt.", abNobody: "noch für keinen PC freigegeben", abOld: "Dieser Helper kann noch keine Adressbücher teilen (Update auf Version 0.5.5 oder neuer nötig).", abConfirmUnsub: "Kopie „$1“ aus Thunderbird entfernen?\n\nDas Original beim anderen PC bleibt; ein neuer Haken holt sie wieder.", abErr: {"pckey": "Der Helper kennt diesen PC mit einem anderen Schlüssel. Abhilfe: in der Web-Oberfläche des Helpers unter „PCs“ diesen PC entfernen, dann hier „Jetzt abgleichen“.", "book": "Adressbuch im Helper nicht gefunden.", "full": "Im Helper ist kein Platz mehr (zu viele Adressbücher oder Kontakte).", "notlocal": "Kein eigenes lokales Adressbuch.", "unbekannter Befehl": "Dieser Helper kann noch keine Adressbücher teilen (Update auf Version 0.5.5 oder neuer nötig)."},
      calLabel: "Team-Kalender", calUser: "Benutzername", calPassword: "Passwort", calAdd: "Kalender einbinden",
      calHint: "Mit Benutzername und Passwort der Web-Oberfläche des Helpers. Thunderbird merkt sich das Passwort.",
      calAdded: "Eingebunden: $1", calExisting: "Schon eingebunden: $1", calWorking: "Suche Kalender …",
      calErr: { url: "Adresse ungültig.", cert: "Zertifikat des Helpers passt nicht zum Fingerabdruck – nichts eingebunden.", auth: "Benutzername oder Passwort falsch.", none: "Für diesen Benutzer ist kein Kalender freigegeben.", blocked: "Zu viele Fehlversuche – in 10 Minuten wieder.", unreachable: "Helper nicht erreichbar. Läuft er, und lässt die Firewall die Verbindung zu?" },
      calLan: "Andere PCs erreichen die Kalender erst, wenn am Helper-PC unter Einstellungen „Web-Oberfläche auch im Netz erreichbar“ eingeschaltet ist.",
      calOld: "Dieser Helper kennt noch keine Team-Kalender (Update nötig).", readOnly: "nur lesen",
      connTitle: "Anderen Helper verbinden", connTitleNew: "Verbinden", connText: "Adresse und Kopplungscode der Gruppe aus der Web-Oberfläche des Helpers (Verbindung). Der Name erscheint dort in der Liste der PCs.",
      url: "Adresse", code: "Kopplungscode", label: "Name dieses PCs", connect: "Verbinden", connectSwitch: "Wechseln", disconnect: "Trennen",
      confirmDisconnect: "Verbindung zum Helper trennen?\n\nSuche und KI-Assistent nutzen ihn dann nicht mehr; eingebundene Kalender bleiben. Geteilte Adressbücher werden zurückgezogen, Kopien fremder Adressbücher entfernt.",
      findBtn: "Helper im Netz suchen", finding: "Suche …", foundNone: "Kein Helper im Kopplungsmodus gefunden. Am Helper-PC in der Web-Oberfläche unter PCs „Gerät über Kopplung hinzufügen“ klicken und hier noch einmal suchen – oder unten Adresse und Code eintragen.", pairWith: "Koppeln", pairText: "Vergleiche diese Zahl mit der im Helper (Web-Oberfläche → PCs). Nur wenn sie gleich ist: dort „Zulassen“ und hier „Zahl stimmt“ klicken.", pairConfirm: "Zahl stimmt", pairConfirmNow: "Am Helper zugelassen – bitte hier bestätigen, dass die Zahl gleich ist.", pairOld: "Dieser Helper ist zu alt für die Kopplung – bitte auf Version 0.5.2 oder neuer aktualisieren, oder unten Adresse und Code eintragen.", pairWait: "Warte auf „Zulassen“ am Helper …", pairDenied: "Am Helper abgelehnt.", pairExpired: "Abgelaufen – bitte neu koppeln.", pairOff: "Der Helper ist nicht (mehr) im Kopplungsmodus.", pairOk: "Gekoppelt.", pairCancel: "Abbrechen", manualTitle: "Oder von Hand: Adresse und Kopplungscode",
    },
    en: {
      intro: "The NovaBird Helper computes for everyone on a PC with a graphics card: meaning search, AI assistant, team calendars and shared address books. Connect once, then choose here what it is used for.",
      none: "Not connected", noneSub: "Address and pairing code are shown in the helper's web interface under “Connection”.",
      checking: "Connecting …", ok: "Connected to $1", okSub: "Group $1 · $2 · Language model: $3 · Helper $4", noModel: "none selected",
      fail: "No connection: $1", errCode: "Pairing code does not match", errPerm: "not reachable or permission for the address missing – is the helper running? Otherwise connect again below",
      openWeb: "Open web interface", useTitle: "Use it for",
      useSearch: "Search: compute the meaning search in the helper", useAi: "AI assistant: the helper's language model",
      searchMissing: "NovaBird-Search is not installed.", searchOn: "Search computes in the helper.", searchOff: "Search computes without the helper – its settings are under Search → Meaning search (word search always stays).",
      searchChecking: "Checking the helper with the probe texts …", searchFail: "Search: $1",
      aiOn: "The AI assistant uses $1 in the helper.", aiNoModel: "On – but no language model is selected in the helper yet (web interface → Language model).", aiOff: "Off – your own server can be set under AI → AI assistant.",
      modelLabel: "Language model (this PC only)", modelDefault: "As set in the helper ($1)", modelHint: "A model other than the helper's is loaded there the first time (a few seconds) and needs graphics memory.", aiOther: "The AI assistant currently uses your own server ($1); tick to switch to the helper.",
      abLabel: "Share address books", abIntro: "Share your own address books with other PCs of the group; they get a copy that syncs in both directions. \"Collected Addresses\" is never shared.", abWrite: "Others may change it (including deleting contacts)", abCanWrite: "can change", abReadOnlyCopy: "read only", abConflicts: "$1 contacts were changed on two PCs at the same time – the version saved first applies.", abHeld: "$1 deletions held back (more than half of an address book at once) – please check.", abErrReadonly: "Read only: the owner does not allow changes.", abForAll: "all PCs of the group", abForSome: "selected PCs", abNoPcs: "No other PC in this group yet.", abOffered: "Offered to this PC", abNoOffer: "Other PCs do not offer an address book to this PC yet.", abCount: "$1 contacts", abShared: "shared, $1 contacts", abSkipped: "$1 too large, not shared", abSync: "Sync now", abLast: "Last synced: $1", abSyncing: "Syncing …", abRemoved: "No longer offered, copy removed: $1", abReset: "Connected to a different helper or group: shares and copies were reset.", abNobody: "not shared with any PC yet", abOld: "This helper cannot share address books yet (update to version 0.5.5 or newer needed).", abConfirmUnsub: "Remove the copy \"$1\" from Thunderbird?\n\nThe original on the other PC stays; ticking it again brings it back.", abErr: {"pckey": "The helper knows this PC with a different key. Fix: in the helper's web interface, remove this PC under \"PCs\", then click \"Sync now\" here.", "book": "Address book not found in the helper.", "full": "No more room in the helper (too many address books or contacts).", "notlocal": "Not an own local address book.", "unbekannter Befehl": "This helper cannot share address books yet (update to version 0.5.5 or newer needed)."},
      calLabel: "Team calendars", calUser: "User name", calPassword: "Password", calAdd: "Add calendars",
      calHint: "With user name and password of the helper's web interface. Thunderbird remembers the password.",
      calAdded: "Added: $1", calExisting: "Already added: $1", calWorking: "Looking for calendars …",
      calErr: { url: "Invalid address.", cert: "The helper's certificate does not match the fingerprint – nothing added.", auth: "Wrong user name or password.", none: "No calendar is shared with this user.", blocked: "Too many failed attempts – try again in 10 minutes.", unreachable: "Helper not reachable. Is it running, and does the firewall allow the connection?" },
      calLan: "Other PCs reach the calendars only when “Web interface also reachable in the network” is switched on in the settings on the helper PC.",
      calOld: "This helper has no team calendars yet (update needed).", readOnly: "read only",
      connTitle: "Connect another helper", connTitleNew: "Connect", connText: "Address and pairing code of the group from the helper's web interface (Connection). The name appears there in the list of PCs.",
      url: "Address", code: "Pairing code", label: "Name of this PC", connect: "Connect", connectSwitch: "Switch", disconnect: "Disconnect",
      confirmDisconnect: "Disconnect from the helper?\n\nSearch and AI assistant no longer use it; added calendars stay. Shared address books are withdrawn, copies of other PCs' address books removed.",
      findBtn: "Search the network for a helper", finding: "Searching …", foundNone: "No helper in pairing mode found. On the helper PC, click “Add device by pairing” under PCs in the web interface and search here again – or enter address and code below.", pairWith: "Pair", pairText: "Compare this number with the one shown in the helper (web interface → PCs). Only if they match: click “Allow” there and “Number matches” here.", pairConfirm: "Number matches", pairConfirmNow: "Allowed on the helper – please confirm here that the number is the same.", pairOld: "This helper is too old for pairing – please update it to version 0.5.2 or later, or enter address and code below.", pairWait: "Waiting for “Allow” on the helper …", pairDenied: "Declined on the helper.", pairExpired: "Expired – please pair again.", pairOff: "The helper is not (or no longer) in pairing mode.", pairOk: "Paired.", pairCancel: "Cancel", manualTitle: "Or by hand: address and pairing code",
    },
    fr: {
      intro: "Le NovaBird Helper calcule pour tous sur un PC avec carte graphique : recherche par le sens, assistant IA, calendriers d’équipe et carnets d’adresses partagés. Connectez-le une fois, puis choisissez ici son usage.",
      none: "Non connecté", noneSub: "L’adresse et le code d’appairage figurent dans l’interface web du Helper, sous « Connexion ».",
      checking: "Connexion …", ok: "Connecté à $1", okSub: "Groupe $1 · $2 · Modèle de langage : $3 · Helper $4", noModel: "aucun choisi",
      fail: "Pas de connexion : $1", errCode: "Le code d’appairage ne correspond pas", errPerm: "injoignable ou autorisation pour l’adresse manquante – le Helper tourne-t-il ? Sinon, reconnectez ci-dessous",
      openWeb: "Ouvrir l’interface web", useTitle: "Utiliser pour",
      useSearch: "Recherche : calculer la recherche par le sens dans le Helper", useAi: "Assistant IA : modèle de langage du Helper",
      searchMissing: "NovaBird-Search n’est pas installé.", searchOn: "La recherche calcule dans le Helper.", searchOff: "La recherche calcule sans le Helper – réglages sous Recherche → Recherche par le sens (la recherche par mots reste toujours).",
      searchChecking: "Vérification du Helper avec les textes de test …", searchFail: "Recherche : $1",
      aiOn: "L’assistant IA utilise $1 dans le Helper.", aiNoModel: "Activé – mais aucun modèle de langage n’est encore choisi dans le Helper (interface web → Modèle de langage).", aiOff: "Désactivé – un serveur à vous se règle sous IA → Assistant IA.",
      modelLabel: "Modèle de langage (ce PC seulement)", modelDefault: "Comme dans le helper ($1)", modelHint: "Un autre modèle que celui du helper y est chargé la première fois (quelques secondes) et utilise de la mémoire graphique.", aiOther: "L’assistant IA utilise votre propre serveur ($1) ; cochez pour passer au Helper.",
      abLabel: "Partager des carnets d’adresses", abIntro: "Partagez vos carnets d’adresses avec les autres PC du groupe ; ils en reçoivent une copie synchronisée dans les deux sens. « Adresses collectées » n’est jamais partagé.", abWrite: "Les autres peuvent modifier (y compris supprimer des contacts)", abCanWrite: "modifiable", abReadOnlyCopy: "lecture seule", abConflicts: "$1 contacts ont été modifiés en même temps sur deux PC – la version enregistrée en premier s’applique.", abHeld: "$1 suppressions retenues (plus de la moitié d’un carnet d’un coup) – veuillez vérifier.", abErrReadonly: "Lecture seule : le propriétaire n’autorise pas les modifications.", abForAll: "tous les PC du groupe", abForSome: "PC choisis", abNoPcs: "Aucun autre PC dans ce groupe pour l’instant.", abOffered: "Proposés à ce PC", abNoOffer: "Les autres PC ne proposent encore aucun carnet à ce PC.", abCount: "$1 contacts", abShared: "partagé, $1 contacts", abSkipped: "$1 trop grands, non partagés", abSync: "Synchroniser", abLast: "Dernière synchronisation : $1", abSyncing: "Synchronisation …", abRemoved: "Plus proposé, copie supprimée : $1", abReset: "Connexion à un autre Helper ou à un autre groupe : partages et copies réinitialisés.", abNobody: "partagé avec aucun PC pour l’instant", abOld: "Ce Helper ne sait pas encore partager des carnets d’adresses (mise à jour vers la version 0.5.5 ou plus récente nécessaire).", abConfirmUnsub: "Supprimer la copie « $1 » de Thunderbird ?\n\nL’original sur l’autre PC reste ; cocher à nouveau la ramène.", abErr: {"pckey": "Le Helper connaît ce PC avec une autre clé. Solution : dans l’interface web du Helper, retirer ce PC sous « PC », puis cliquer ici sur « Synchroniser ».", "book": "Carnet introuvable dans le Helper.", "full": "Plus de place dans le Helper (trop de carnets ou de contacts).", "notlocal": "Pas un carnet local à vous.", "unbekannter Befehl": "Ce Helper ne sait pas encore partager des carnets d’adresses (mise à jour vers la version 0.5.5 ou plus récente nécessaire)."},
      calLabel: "Calendriers d’équipe", calUser: "Nom d’utilisateur", calPassword: "Mot de passe", calAdd: "Ajouter les calendriers",
      calHint: "Avec le nom d’utilisateur et le mot de passe de l’interface web du Helper. Thunderbird mémorise le mot de passe.",
      calAdded: "Ajoutés : $1", calExisting: "Déjà ajoutés : $1", calWorking: "Recherche des calendriers …",
      calErr: { url: "Adresse invalide.", cert: "Le certificat du Helper ne correspond pas à l’empreinte – rien n’a été ajouté.", auth: "Nom d’utilisateur ou mot de passe incorrect.", none: "Aucun calendrier n’est partagé avec cet utilisateur.", blocked: "Trop de tentatives échouées – réessayez dans 10 minutes.", unreachable: "Helper injoignable. Est-il lancé, et le pare-feu autorise-t-il la connexion ?" },
      calLan: "Les autres PC n’accèdent aux calendriers que si « Interface web accessible aussi sur le réseau » est activé dans les réglages du PC du Helper.",
      calOld: "Ce Helper ne connaît pas encore les calendriers d’équipe (mise à jour nécessaire).", readOnly: "lecture seule",
      connTitle: "Connecter un autre Helper", connTitleNew: "Connecter", connText: "Adresse et code d’appairage du groupe, depuis l’interface web du Helper (Connexion). Le nom y apparaît dans la liste des PC.",
      url: "Adresse", code: "Code d’appairage", label: "Nom de ce PC", connect: "Connecter", connectSwitch: "Changer", disconnect: "Déconnecter",
      confirmDisconnect: "Déconnecter le Helper ?\n\nLa recherche et l’assistant IA ne l’utilisent plus ; les calendriers ajoutés restent. Les carnets partagés sont retirés, les copies des carnets d’autres PC supprimées.",
      findBtn: "Chercher un Helper sur le réseau", finding: "Recherche …", foundNone: "Aucun Helper en mode appairage trouvé. Sur le PC du Helper, cliquez dans l’interface web sous PC sur « Ajouter un appareil par appairage », puis cherchez à nouveau ici – ou saisissez l’adresse et le code ci-dessous.", pairWith: "Appairer", pairText: "Comparez ce nombre avec celui affiché dans le Helper (interface web → PC). Seulement s’ils sont identiques : cliquez là-bas sur « Autoriser » et ici sur « Le nombre correspond ».", pairConfirm: "Le nombre correspond", pairConfirmNow: "Autorisé sur le Helper – veuillez confirmer ici que le nombre est identique.", pairOld: "Ce Helper est trop ancien pour l’appairage – mettez-le à jour vers la version 0.5.2 ou plus récente, ou saisissez l’adresse et le code ci-dessous.", pairWait: "En attente de « Autoriser » sur le Helper …", pairDenied: "Refusé sur le Helper.", pairExpired: "Expiré – veuillez appairer à nouveau.", pairOff: "Le Helper n’est pas (plus) en mode appairage.", pairOk: "Appairé.", pairCancel: "Annuler", manualTitle: "Ou à la main : adresse et code d’appairage",
    },
    es: {
      intro: "El NovaBird Helper calcula para todos en un PC con tarjeta gráfica: búsqueda por significado, asistente IA, calendarios de equipo y libretas compartidas. Conéctelo una vez y elija aquí para qué se usa.",
      none: "Sin conectar", noneSub: "La dirección y el código de emparejamiento están en la interfaz web del Helper, en «Conexión».",
      checking: "Conectando …", ok: "Conectado a $1", okSub: "Grupo $1 · $2 · Modelo de lenguaje: $3 · Helper $4", noModel: "ninguno elegido",
      fail: "Sin conexión: $1", errCode: "El código de emparejamiento no coincide", errPerm: "no accesible o falta el permiso para la dirección – ¿está en marcha el Helper? Si no, conecte de nuevo abajo",
      openWeb: "Abrir la interfaz web", useTitle: "Usar para",
      useSearch: "Búsqueda: calcular la búsqueda por significado en el Helper", useAi: "Asistente IA: modelo de lenguaje del Helper",
      searchMissing: "NovaBird-Search no está instalado.", searchOn: "La búsqueda calcula en el Helper.", searchOff: "La búsqueda calcula sin el Helper – sus ajustes están en Búsqueda → Búsqueda por significado (la búsqueda por palabras siempre sigue).",
      searchChecking: "Comprobando el Helper con los textos de prueba …", searchFail: "Búsqueda: $1",
      aiOn: "El asistente IA usa $1 en el Helper.", aiNoModel: "Activado, pero aún no hay modelo de lenguaje elegido en el Helper (interfaz web → Modelo de lenguaje).", aiOff: "Desactivado – un servidor propio se configura en IA → Asistente IA.",
      modelLabel: "Modelo de lenguaje (solo este PC)", modelDefault: "Como en el helper ($1)", modelHint: "Un modelo distinto al del helper se carga allí la primera vez (unos segundos) y necesita memoria gráfica.", aiOther: "El asistente IA usa ahora su propio servidor ($1); marque para cambiar al Helper.",
      abLabel: "Compartir libretas de direcciones", abIntro: "Comparta sus libretas con los demás PC del grupo; reciben una copia que se sincroniza en ambos sentidos. «Direcciones recopiladas» nunca se comparte.", abWrite: "Los demás pueden modificarla (también borrar contactos)", abCanWrite: "modificable", abReadOnlyCopy: "solo lectura", abConflicts: "$1 contactos se modificaron a la vez en dos PC: vale la versión guardada primero.", abHeld: "$1 eliminaciones retenidas (más de la mitad de una libreta a la vez): compruébelo.", abErrReadonly: "Solo lectura: el propietario no permite cambios.", abForAll: "todos los PC del grupo", abForSome: "PC seleccionados", abNoPcs: "Aún no hay otro PC en este grupo.", abOffered: "Ofrecidas a este PC", abNoOffer: "Los demás PC aún no ofrecen ninguna libreta a este PC.", abCount: "$1 contactos", abShared: "compartida, $1 contactos", abSkipped: "$1 demasiado grandes, no compartidos", abSync: "Sincronizar ahora", abLast: "Última sincronización: $1", abSyncing: "Sincronizando …", abRemoved: "Ya no se ofrece, copia eliminada: $1", abReset: "Conectado a otro Helper o a otro grupo: se restablecieron los compartidos y las copias.", abNobody: "aún no compartida con ningún PC", abOld: "Este Helper aún no puede compartir libretas (hace falta actualizar a la versión 0.5.5 o posterior).", abConfirmUnsub: "¿Quitar la copia «$1» de Thunderbird?\n\nEl original en el otro PC se queda; marcarla de nuevo la recupera.", abErr: {"pckey": "El Helper conoce este PC con otra clave. Solución: en la interfaz web del Helper, quitar este PC en «PC» y pulsar aquí «Sincronizar ahora».", "book": "Libreta no encontrada en el Helper.", "full": "No queda espacio en el Helper (demasiadas libretas o contactos).", "notlocal": "No es una libreta local propia.", "unbekannter Befehl": "Este Helper aún no puede compartir libretas (hace falta actualizar a la versión 0.5.5 o posterior)."},
      calLabel: "Calendarios de equipo", calUser: "Nombre de usuario", calPassword: "Contraseña", calAdd: "Añadir calendarios",
      calHint: "Con el nombre de usuario y la contraseña de la interfaz web del Helper. Thunderbird recuerda la contraseña.",
      calAdded: "Añadidos: $1", calExisting: "Ya añadidos: $1", calWorking: "Buscando calendarios …",
      calErr: { url: "Dirección no válida.", cert: "El certificado del Helper no coincide con la huella – no se añadió nada.", auth: "Nombre de usuario o contraseña incorrectos.", none: "No hay calendarios compartidos con este usuario.", blocked: "Demasiados intentos fallidos: vuelva a intentarlo en 10 minutos.", unreachable: "No se puede acceder al Helper. ¿Está en marcha y permite el cortafuegos la conexión?" },
      calLan: "Los demás PC solo acceden a los calendarios si en el PC del Helper está activado «Interfaz web accesible también en la red».",
      calOld: "Este Helper aún no tiene calendarios de equipo (hace falta actualizar).", readOnly: "solo lectura",
      connTitle: "Conectar otro Helper", connTitleNew: "Conectar", connText: "Dirección y código de emparejamiento del grupo, de la interfaz web del Helper (Conexión). El nombre aparece allí en la lista de PC.",
      url: "Dirección", code: "Código de emparejamiento", label: "Nombre de este PC", connect: "Conectar", connectSwitch: "Cambiar", disconnect: "Desconectar",
      confirmDisconnect: "¿Desconectar del Helper?\n\nLa búsqueda y el asistente IA dejan de usarlo; los calendarios añadidos se quedan. Las libretas compartidas se retiran y se eliminan las copias de libretas de otros PC.",
      findBtn: "Buscar un Helper en la red", finding: "Buscando …", foundNone: "No se encontró ningún Helper en modo de emparejamiento. En el PC del Helper, pulse en la interfaz web, en PC, «Añadir dispositivo por emparejamiento» y vuelva a buscar aquí, o introduzca abajo la dirección y el código.", pairWith: "Emparejar", pairText: "Compare este número con el que muestra el Helper (interfaz web → PC). Solo si coinciden: pulse allí «Permitir» y aquí «El número coincide».", pairConfirm: "El número coincide", pairConfirmNow: "Permitido en el Helper: confirme aquí que el número es el mismo.", pairOld: "Este Helper es demasiado antiguo para el emparejamiento: actualícelo a la versión 0.5.2 o posterior, o introduzca abajo la dirección y el código.", pairWait: "Esperando «Permitir» en el Helper …", pairDenied: "Rechazado en el Helper.", pairExpired: "Caducado: vuelva a emparejar.", pairOff: "El Helper no está (o ya no está) en modo de emparejamiento.", pairOk: "Emparejado.", pairCancel: "Cancelar", manualTitle: "O a mano: dirección y código de emparejamiento",
    },
  };
  const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
  const t = T[lang] || T.en;
  const fill = (s, ...a) => a.reduce((x, v, i) => x.replace("$" + (i + 1), v), s);

  for (const [id, key] of Object.entries({
    intro: "intro", openWeb: "openWeb", useTitle: "useTitle", useSearchLabel: "useSearch", useAiLabel: "useAi", calLabel: "calLabel", abLabel: "abLabel", abIntro: "abIntro", abOfferedLabel: "abOffered", abSync: "abSync",
    calAdd: "calAdd", findBtn: "findBtn", pairCancel: "pairCancel", pairConfirm: "pairConfirm", manualTitle: "manualTitle", connText: "connText", urlLabel: "url", codeLabel: "code", labelLabel: "label", connect: "connect", disconnect: "disconnect", aiModelLabel: "modelLabel", aiModelHint: "modelHint",
  })) $(id).textContent = t[key];
  $("calUser").placeholder = t.calUser;
  $("calPassword").placeholder = t.calPassword;

  let conn = null; // {url, code, label}
  let info = null; // Antwort von „hello“

  const hostOf = url => new URL(url).hostname;
  const isLocalHost = h => ["localhost", "127.0.0.1", "[::1]", "::1"].includes(h);

  // Adressen der Web-Oberfläche und der Kalender: auf diesem PC per HTTP, sonst HTTPS (Port aus „hello“)
  function webBase() {
    if (!conn || !info?.web?.port) return null;
    const h = hostOf(conn.url);
    if (isLocalHost(h)) return `http://localhost:${info.web.port}`;
    return info.web.lan ? `https://${h.includes(":") ? `[${h}]` : h}:${info.web.port}` : null;
  }

  function showState(kind, title, sub = "") {
    $("state").className = "card state " + kind;
    $("stateTitle").textContent = title;
    $("stateSub").textContent = sub;
    $("openWeb").hidden = !(kind === "ok" && webBase());
    $("useBox").classList.toggle("off", kind !== "ok");
    // verbunden: „Trennen“ oben beim Zustand, unten nur „Anderen Helper verbinden“ (zugeklappt) mit „Wechseln“
    $("connBox").querySelector("summary").textContent = conn ? t.connTitle : t.connTitleNew;
    $("connect").textContent = conn ? t.connectSwitch : t.connect;
    $("disconnect").hidden = !conn;
  }

  const errText = e => {
    const m = String(e?.message || e);
    return m === "code" ? t.errCode : /NetworkError|Failed to fetch/i.test(m) ? t.errPerm : m;
  };

  async function hello() {
    showState("", t.checking);
    try {
      info = await nbAI.helperHello(conn.url, conn.code, conn.label);
      showState("ok", fill(t.ok, hostOf(conn.url)), fill(t.okSub, info.group || "–", info.deviceName || info.device || "–", info.chatModel ? info.chatModel.replace(/^ollama:/, "") : t.noModel, info.version || "?"));
    } catch (e) {
      info = null;
      showState("bad", fill(t.fail, errText(e)));
    }
    await Promise.all([showSearch(), showAi(), showCalendars(), showBooks()]);
  }

  // ---- Suche (NovaBird-Search) ----
  async function showSearch() {
    const note = $("useSearchNote");
    note.className = "note";
    let st = null;
    try {
      st = await messenger.runtime.sendMessage(SEARCH_ID, { type: "helper:searchState", url: conn?.url });
    } catch {
      st = null;
    }
    $("useSearch").disabled = !st;
    $("useSearch").checked = Boolean(st?.use);
    note.textContent = !st ? t.searchMissing : st.use ? t.searchOn : t.searchOff;
  }

  $("useSearch").addEventListener("change", async () => {
    const use = $("useSearch").checked;
    const note = $("useSearchNote");
    note.className = "note";
    note.textContent = use ? t.searchChecking : "";
    try {
      if (use) await messenger.settingsRedesign.grantSearchOrigin(conn.url);
      const res = await messenger.runtime.sendMessage(SEARCH_ID, { type: "helper:useForSearch", use, url: conn.url, code: conn.code, label: conn.label || "" });
      if (res?.error) throw new Error(res.error);
      note.textContent = use ? t.searchOn : t.searchOff;
      note.className = use ? "note good" : "note";
    } catch (e) {
      note.textContent = fill(t.searchFail, errText(e));
      note.className = "note bad";
      $("useSearch").checked = false;
    }
  });

  // ---- KI-Assistent ----
  // Sprachmodell nur für diesen PC (aiHelperModel): Auswahl nur, wenn der Helper mehrere hat
  const modelName = m => m.replace(/^ollama:/, "");
  async function showAi() {
    const c = await messenger.storage.local.get({ aiEnabled: false, aiType: "", aiUrl: "", aiModel: "", aiHelperModel: "" });
    const mine = c.aiEnabled && c.aiType === "nbhelper" && conn && c.aiUrl === conn.url;
    $("useAi").checked = Boolean(mine);
    const used = c.aiHelperModel || info?.chatModel;
    $("useAiNote").textContent = mine ? (info && !used ? t.aiNoModel : fill(t.aiOn, modelName(used || "–")))
      : c.aiEnabled && c.aiType !== "nbhelper" ? fill(t.aiOther, c.aiModel || c.aiUrl) : t.aiOff;
    const others = mine && info ? (info.chatChoices || []).filter(m => m !== info.chatModel) : [];
    $("aiModelRow").hidden = $("aiModelHint").hidden = !others.length;
    if (others.length) {
      $("aiHelperModel").replaceChildren(new Option(fill(t.modelDefault, info.chatModel ? modelName(info.chatModel) : "–"), ""), ...others.map(m => new Option(modelName(m), m)));
      $("aiHelperModel").value = others.includes(c.aiHelperModel) ? c.aiHelperModel : "";
    }
  }

  // KI lief über den Helper: abschalten und auf den eigenen Server (Standard) zurückstellen. Sonst bliebe aiType „nbhelper“
  // stehen – Einstellungen → KI blendete das Formular für einen eigenen Server dauerhaft aus, und nach „Trennen“ verbände die
  // Übernahme unten beim nächsten Öffnen wieder
  const releaseAi = async () => {
    const c = await messenger.storage.local.get({ aiType: "" });
    if (c.aiType !== "nbhelper") return;
    await messenger.storage.local.set({ aiEnabled: false, aiHelperModel: "", aiType: nbAI.DEFAULTS.aiType, aiUrl: nbAI.DEFAULTS.aiUrl, aiKey: "" });
  };

  $("useAi").addEventListener("change", async () => {
    if ($("useAi").checked) {
      await messenger.storage.local.set({ aiEnabled: true, aiType: "nbhelper", aiUrl: conn.url, aiKey: conn.code });
    } else {
      await releaseAi();
    }
    showAi();
  });
  $("aiHelperModel").addEventListener("change", async () => {
    await messenger.storage.local.set({ aiHelperModel: $("aiHelperModel").value });
    showAi();
  });

  // ---- Team-Kalender ----
  async function showCalendars() {
    const base = webBase();
    const note = $("calNote");
    note.className = "note";
    const old = info && !info.web;
    $("calForm").hidden = !base;
    note.textContent = old ? t.calOld : info && !base ? t.calLan : t.calHint;
    const list = $("calList");
    list.hidden = true;
    if (!base) return;
    const cals = await messenger.novaCalendar.helperCalendars(base + "/dav/").catch(() => []);
    list.replaceChildren(...cals.map(c => Object.assign(document.createElement("li"), { textContent: c.name + (c.readOnly ? ` (${t.readOnly})` : "") })));
    list.hidden = cals.length === 0;
  }

  $("calAdd").addEventListener("click", async () => {
    const base = webBase();
    const note = $("calNote");
    const user = $("calUser").value.trim();
    if (!base || !user || !$("calPassword").value) return;
    note.className = "note";
    note.textContent = t.calWorking;
    try {
      const host = hostOf(conn.url);
      const res = await messenger.novaCalendar.addHelperCalendars({
        davUrl: `${base}/dav/`, user, password: $("calPassword").value, fingerprint: isLocalHost(host) ? "" : info.web.fingerprint || "",
      });
      $("calPassword").value = "";
      await showCalendars();
      note.textContent = [res.added.length ? fill(t.calAdded, res.added.join(", ")) : "", res.existing.length ? fill(t.calExisting, res.existing.join(", ")) : ""].filter(Boolean).join(" · ");
      note.className = "note good";
    } catch (e) {
      const m = String(e?.message || e);
      note.textContent = t.calErr[m] || m;
      note.className = "note bad";
    }
  });

  // ---- Geteilte Adressbücher (Abgleich und alle Änderungen im Hintergrund: contacts/abshare.js) ----
  const abErr = m => (m === "readonly" ? t.abErrReadonly : t.abErr[m] || m);
  const el = (tag, props = {}, ...kids) => {
    const e = Object.assign(document.createElement(tag), props);
    e.append(...kids);
    return e;
  };
  async function showBooks() {
    const note = $("abNote");
    note.className = "note";
    $("abOwn").replaceChildren();
    $("abOffered").replaceChildren();
    $("abBody").hidden = true;
    if (!conn || !info) {
      note.textContent = "";
      return;
    }
    if (!info.addressBooks) {
      note.textContent = t.abOld;
      return;
    }
    const ov = await messenger.runtime.sendMessage({ type: "abshare:overview" }).catch(e => ({ error: String(e?.message || e) }));
    $("abBody").hidden = false;
    const st = ov.status || {};
    // eigene lokale Adressbücher: Haken = teilen; darunter für wen
    for (const b of (ov.books || []).filter(x => x.kind === "local")) {
      const cfg = ov.share?.[b.uid];
      const own = st.own?.[b.uid];
      const box = el("input", { type: "checkbox", checked: !!cfg, id: "ab-" + b.uid });
      const nobody = cfg && cfg.access === "pcs" && !(cfg.pcs || []).length;
      const text = own?.error ? abErr(own.error) : cfg && own ? [nobody ? t.abNobody : fill(t.abShared, own.count), own.skipped ? fill(t.abSkipped, own.skipped) : ""].filter(Boolean).join(" · ") : "";
      const body = el("div", { className: "body" }, el("label", { htmlFor: box.id, textContent: b.name }), el("p", { className: "note" + (own?.error ? " bad" : ""), textContent: text }));
      // erster Haken: noch für niemanden – PCs auswählen (oder auf „alle PCs der Gruppe“ stellen)
      box.addEventListener("change", () => changeBooks({ share: { [b.uid]: box.checked ? { access: "pcs", pcs: [], write: true } : null } }));
      if (cfg) {
        const sel = el("select", {}, new Option(t.abForAll, "group"), new Option(t.abForSome, "pcs"));
        sel.value = cfg.access === "pcs" ? "pcs" : "group";
        const pcsBox = el("div", { className: "pcs" });
        const wr = el("input", { type: "checkbox", checked: cfg.write !== false, id: "abw-" + b.uid });
        const send = () => changeBooks({ share: { [b.uid]: { access: sel.value, pcs: [...pcsBox.querySelectorAll("input:checked")].map(i => i.value), write: wr.checked } } });
        wr.addEventListener("change", send);
        sel.addEventListener("change", send);
        if (sel.value === "pcs") {
          if (!(ov.pcs || []).length) pcsBox.append(el("span", { className: "note", textContent: t.abNoPcs }));
          for (const p of ov.pcs || []) {
            const c = el("input", { type: "checkbox", value: p.id, checked: (cfg.pcs || []).includes(p.id) });
            c.addEventListener("change", send);
            pcsBox.append(el("label", {}, c, " " + p.label));
          }
        }
        body.append(el("div", { className: "row" }, sel), pcsBox, el("div", { className: "row" }, wr, el("label", { htmlFor: wr.id, textContent: t.abWrite })));
      }
      $("abOwn").append(el("li", {}, box, body));
    }
    // angeboten: Haken = als schreibgeschützte Kopie einbinden
    const offered = ov.offered || [];
    $("abNoOffer").hidden = offered.length > 0;
    $("abNoOffer").textContent = t.abNoOffer;
    for (const o of offered) {
      const sub = ov.subs?.[o.id];
      const s = st.subs?.[o.id];
      const box = el("input", { type: "checkbox", checked: !!sub, id: "abo-" + o.id });
      const name = `${o.name} – ${o.owner}`;
      box.addEventListener("change", () => {
        if (!box.checked && sub?.dir && !confirm(fill(t.abConfirmUnsub, name))) {
          box.checked = true;
          return;
        }
        changeBooks({ sub: { [o.id]: box.checked } });
      });
      $("abOffered").append(el("li", {}, box, el("div", { className: "body" }, el("label", { htmlFor: box.id, textContent: name }),
        el("p", { className: "note" + (s?.error ? " bad" : ""), textContent: s?.error ? abErr(s.error) : fill(t.abCount, o.count) + " · " + (o.write ? t.abCanWrite : t.abReadOnlyCopy) }))));
    }
    const lines = [];
    if (ov.error || st.error) lines.push(abErr(ov.error || st.error));
    if (st.removed?.length) lines.push(fill(t.abRemoved, st.removed.join(", ")));
    if (st.reset) lines.push(t.abReset);
    const all = [...Object.values(st.own || {}), ...Object.values(st.subs || {})];
    const conflicts = all.reduce((n, x) => n + (x.conflicts || 0), 0), held = all.reduce((n, x) => n + (x.held || 0), 0);
    if (conflicts) lines.push(fill(t.abConflicts, conflicts));
    if (held) lines.push(fill(t.abHeld, held));
    if (st.at && !st.idle) lines.push(fill(t.abLast, new Date(st.at).toLocaleString()));
    note.textContent = lines.join(" · ");
    note.className = "note" + (ov.error || st.error ? " bad" : "");
  }
  async function changeBooks(change) {
    $("abBox").classList.add("busy");
    $("abNote").textContent = t.abSyncing;
    await messenger.runtime.sendMessage({ type: "abshare:change", ...change }).catch(e => console.error(e));
    $("abBox").classList.remove("busy");
    await showBooks();
  }
  $("abSync").addEventListener("click", async () => {
    $("abNote").textContent = t.abSyncing;
    await messenger.runtime.sendMessage({ type: "abshare:sync" }).catch(e => console.error(e));
    await showBooks();
  });

  // ---- Verbindung ----
  $("connect").addEventListener("click", () => {
    const url = $("url").value.trim().replace(/\/+$/, "");
    const code = $("code").value.trim() || conn?.code || "";
    const label = $("label").value.trim();
    let asked = null;
    try {
      // Erlaubnis für Adressen außerhalb dieses PCs direkt im Klick erfragen (vor dem ersten await)
      if (nbAI.needsPermission(url)) asked = messenger.permissions.request({ origins: [nbAI.origin(url)] }).catch(() => false);
    } catch {
      $("connStatus").textContent = t.calErr.url;
      return;
    }
    (async () => {
      if (asked && !(await asked)) {
        showState("bad", fill(t.fail, t.errPerm));
        return;
      }
      await useConn(url, code, label);
    })();
  });

  // Verbindung übernehmen (von Hand oder aus der Kopplung): speichern, KI/Suche nachziehen, prüfen
  async function useConn(url, code, label) {
    conn = { url, code, label };
    await messenger.storage.local.set({ helperConn: conn });
    $("code").value = "";
    // Schon genutzt? Dann die neue Adresse/den neuen Code auch dort eintragen
    const c = await messenger.storage.local.get({ aiType: "" });
    if (c.aiType === "nbhelper") await messenger.storage.local.set({ aiUrl: url, aiKey: code });
    await hello();
    if (info && $("useSearch").checked) {
      await messenger.settingsRedesign.grantSearchOrigin(url).catch(() => {});
      await messenger.runtime.sendMessage(SEARCH_ID, { type: "helper:useForSearch", use: true, url, code, label }).catch(() => {});
    }
    if (info) $("connBox").open = false;
  }

  // ---- Kopplung: Helper im Kopplungsmodus suchen (UDP-Multicast über das Experiment), Schlüsseltausch (ECDH P-256),
  // Vergleichszahl zeigen, auf „Zulassen“ am Helper warten, Code entschlüsselt übernehmen (Protokoll: novabird-helper/Pairing.cs)
  const b64 = u8 => btoa(String.fromCharCode(...u8));
  const ub64 = str => Uint8Array.from(atob(str), ch => ch.charCodeAt(0));
  let pairRun = 0; // laufende Kopplung (Abbrechen erhöht den Zähler)

  $("findBtn").addEventListener("click", async () => {
    const note = $("findNote");
    note.className = "note";
    note.textContent = t.finding;
    $("foundList").hidden = true;
    const found = await messenger.settingsRedesign.discoverHelpers({ waitMs: 1500 }).catch(() => []);
    note.textContent = found.length ? "" : t.foundNone;
    $("foundList").replaceChildren(...found.map(h => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = `${h.name || h.address} (${h.address}:${h.port}${h.version ? " · Helper " + h.version : ""})`;
      const btn = Object.assign(document.createElement("button"), { type: "button", textContent: t.pairWith });
      btn.addEventListener("click", () => {
        const url = `http://${h.address.includes(":") ? `[${h.address}]` : h.address}:${h.port}`;
        // Erlaubnis für Adressen außerhalb dieses PCs direkt im Klick erfragen (vor dem ersten await)
        const asked = !nbAI.needsPermission(url) ? Promise.resolve(true) : messenger.permissions.request({ origins: [nbAI.origin(url)] }).catch(() => false);
        asked.then(ok => (ok ? pair(url) : showPair("bad", fill(t.fail, t.errPerm))));
      });
      li.append(name, btn);
      return li;
    }));
    $("foundList").hidden = !found.length;
  });

  function showPair(kind, text, sas) {
    $("pairBox").hidden = false;
    if (sas !== undefined) $("pairSas").textContent = sas;
    $("pairNote").className = "note " + kind;
    $("pairNote").textContent = text;
    $("pairCancel").hidden = kind !== "";
    if (kind !== "") $("pairConfirm").hidden = true;
  }

  async function pair(url) {
    const run = ++pairRun;
    const subtle = crypto.subtle;
    const post = async body => {
      const r = await fetch(url + "/nbhelper/pair", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      return { status: r.status, json: await r.json().catch(() => ({})) };
    };
    try {
      $("pairText").textContent = t.pairText;
      showPair("", t.checking, "");
      const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
      const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
      const label = $("label").value.trim() || conn?.label || "";
      // Verfahren 2: erst nur die Prüfsumme des eigenen Schlüssels schicken (Festlegung), dann den Schlüssel selbst. So kann ein
      // Dritter in der Mitte seinen Schlüssel nicht so wählen, dass beide Seiten dieselbe Zahl zeigen.
      const commit = b64(new Uint8Array(await subtle.digest("SHA-256", pub)));
      const st = await post({ op: "start", v: 2, commit, label });
      if (st.status === 403) return showPair("bad", t.pairOff, "");
      if (st.status === 400 && ["pub", "update", "op"].includes(st.json.error)) return showPair("bad", t.pairOld, ""); // Helper vor 0.5.2
      if (st.status !== 200 || !st.json.req || !st.json.pub) throw new Error(st.json.error || String(st.status));
      const rv = await post({ op: "reveal", req: st.json.req, pub: b64(pub) });
      if (rv.status !== 200) throw new Error(rv.json.error || rv.json.state || String(rv.status));
      const peer = await subtle.importKey("raw", ub64(st.json.pub), { name: "ECDH", namedCurve: "P-256" }, false, []);
      const shared = await subtle.deriveBits({ name: "ECDH", public: peer }, kp.privateKey, 256);
      const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits", "deriveKey"]);
      const info = name => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(`${name}|${st.json.pub}|${b64(pub)}`) });
      const sb = new Uint8Array(await subtle.deriveBits(info("nbh-pair-sas"), hk, 32));
      const sas = String((((sb[0] << 24) >>> 0) + (sb[1] << 16) + (sb[2] << 8) + sb[3]) % 1_000_000).padStart(6, "0");
      const key = await subtle.deriveKey(info("nbh-pair-key"), hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
      // erst nach „Zahl stimmt“ hier verbinden: sonst könnte sich ein falscher Helper im Netz selbst „zulassen“
      let confirmed = false;
      $("pairConfirm").hidden = false;
      $("pairConfirm").disabled = false;
      $("pairConfirm").onclick = () => {
        confirmed = true;
        $("pairConfirm").disabled = true;
      };
      showPair("", t.pairWait, `${sas.slice(0, 3)} ${sas.slice(3)}`);
      // höchstens 5 Minuten warten (so lange läuft der Kopplungsmodus)
      for (let i = 0; i < 200 && run === pairRun; i++) {
        await new Promise(r => setTimeout(r, 1500));
        if (run !== pairRun) return;
        const p = await post({ op: "poll", req: st.json.req });
        const state = p.json.state;
        if (state === "pending" || state === "committed") continue;
        if (state === "denied") return showPair("bad", t.pairDenied);
        if (state !== "ok") return showPair("bad", t.pairExpired);
        const plain = await subtle.decrypt({ name: "AES-GCM", iv: ub64(p.json.n), additionalData: new TextEncoder().encode("nbh-pair|" + st.json.req) }, key, ub64(p.json.d));
        const got = JSON.parse(new TextDecoder().decode(plain));
        if (!confirmed) {
          showPair("", t.pairConfirmNow);
          $("pairConfirm").hidden = false;
          while (!confirmed && run === pairRun) await new Promise(r => setTimeout(r, 300));
          if (run !== pairRun) return;
        }
        showPair("good", t.pairOk);
        $("foundList").hidden = true;
        await useConn(url, got.code, label);
        return;
      }
      if (run === pairRun) showPair("bad", t.pairExpired);
    } catch (e) {
      if (run === pairRun) showPair("bad", fill(t.fail, errText(e)));
    }
  }

  $("pairCancel").addEventListener("click", () => {
    pairRun++;
    $("pairBox").hidden = true;
  });

  $("disconnect").addEventListener("click", async () => {
    if (!confirm(t.confirmDisconnect)) return;
    await releaseAi();
    await messenger.runtime.sendMessage({ type: "abshare:disconnect" }).catch(() => {});
    await messenger.runtime.sendMessage(SEARCH_ID, { type: "helper:useForSearch", use: false }).catch(() => {});
    await messenger.storage.local.remove("helperConn");
    conn = info = null;
    $("url").value = $("label").value = "";
    showState("", t.none, t.noneSub);
    $("connBox").open = true;
    showSearch();
    showAi();
    showCalendars();
  });

  $("openWeb").addEventListener("click", () => {
    const base = webBase();
    if (base) messenger.windows.openDefaultBrowser(base + "/");
  });

  (async () => {
    ({ helperConn: conn } = await messenger.storage.local.get({ helperConn: null }));
    if (!conn) {
      // Übernahme: KI war schon auf den Helper eingestellt
      const c = await messenger.storage.local.get({ aiType: "", aiUrl: "", aiKey: "" });
      if (c.aiType === "nbhelper" && c.aiUrl && c.aiKey) {
        conn = { url: c.aiUrl, code: c.aiKey, label: "" };
        await messenger.storage.local.set({ helperConn: conn });
      }
    }
    if (conn) {
      $("url").value = conn.url;
      $("label").value = conn.label || "";
      await hello();
    } else {
      showState("", t.none, t.noneSub);
      $("connBox").open = true;
      showSearch();
      showAi();
      showCalendars();
    }
  })();

  nbHubNote("NovaBird Helper", () => messenger.settingsRedesign.openHub("helper"));
})();
