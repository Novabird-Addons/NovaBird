"use strict";
// Reiter „NovaBird Helper“ in Einstellungen → NovaBird: einmal verbinden (Adresse, Kopplungscode), dann per Häkchen wählen,
// wofür der Helper genutzt wird – Suche (NovaBird-Search rechnet die Bedeutungssuche im Helper), KI-Assistent (Sprachmodell
// des Helpers) und Team-Kalender (CalDAV, mit einem Klick eingebunden). Die Verbindung steht in storage.local „helperConn“.
(() => {
  const $ = id => document.getElementById(id);
  const SEARCH_ID = "novabird-db@novabird";
  const T = {
    de: {
      intro: "Der NovaBird Helper rechnet auf einem PC mit Grafikkarte für alle: Bedeutungssuche, KI-Assistent und Team-Kalender. Einmal verbinden, dann hier wählen, wofür er genutzt wird.",
      none: "Nicht verbunden", noneSub: "Adresse und Kopplungscode stehen in der Web-Oberfläche des Helpers unter „Verbindung“.",
      checking: "Verbinde …", ok: "Verbunden mit $1", okSub: "Gruppe $1 · $2 · Sprachmodell: $3 · Helper $4", noModel: "keins gewählt",
      fail: "Keine Verbindung: $1", errCode: "Kopplungscode passt nicht", errPerm: "Erlaubnis für die Adresse fehlt – „Verbinden“ klicken",
      openWeb: "Web-Oberfläche öffnen", useTitle: "Wofür nutzen?",
      useSearch: "Suche: Bedeutungssuche im Helper rechnen", useAi: "KI-Assistent: Sprachmodell des Helpers",
      searchMissing: "NovaBird-Search ist nicht installiert.", searchOn: "Die Suche rechnet im Helper.", searchOff: "Die Suche rechnet ohne Helper (Wortsuche bleibt immer).",
      searchChecking: "Prüfe den Helper mit den Probetexten …", searchFail: "Suche: $1",
      aiOn: "Der KI-Assistent nutzt $1 im Helper.", aiNoModel: "Eingeschaltet – im Helper ist aber noch kein Sprachmodell gewählt (Web-Oberfläche → Sprachmodell).", aiOff: "Aus – oder ein eigener Server unter „KI-Assistent“.", aiOther: "Der KI-Assistent nutzt gerade einen eigenen Server ($1); Häkchen setzen, um auf den Helper umzustellen.",
      calLabel: "Team-Kalender", calUser: "Benutzername", calPassword: "Passwort", calAdd: "Kalender einbinden",
      calHint: "Mit Benutzername und Passwort der Web-Oberfläche des Helpers. Thunderbird merkt sich das Passwort.",
      calAdded: "Eingebunden: $1", calExisting: "Schon eingebunden: $1", calWorking: "Suche Kalender …",
      calErr: { url: "Adresse ungültig.", cert: "Zertifikat des Helpers passt nicht zum Fingerabdruck – nichts eingebunden.", auth: "Benutzername oder Passwort falsch.", none: "Für diesen Benutzer ist kein Kalender freigegeben." },
      calLan: "Andere PCs erreichen die Kalender erst, wenn am Helper-PC unter Einstellungen „Web-Oberfläche auch im Netz erreichbar“ eingeschaltet ist.",
      calOld: "Dieser Helper kennt noch keine Team-Kalender (Update nötig).", readOnly: "nur lesen",
      connTitle: "Verbindung ändern", connTitleNew: "Verbinden", connText: "Adresse und Kopplungscode der Gruppe aus der Web-Oberfläche des Helpers (Verbindung). Der Name erscheint dort in der Liste der PCs.",
      url: "Adresse", code: "Kopplungscode", label: "Name dieses PCs", connect: "Verbinden", disconnect: "Trennen",
      confirmDisconnect: "Verbindung zum Helper trennen?\n\nSuche und KI-Assistent nutzen ihn dann nicht mehr; eingebundene Kalender bleiben.",
    },
    en: {
      intro: "The NovaBird Helper computes for everyone on a PC with a graphics card: meaning search, AI assistant and team calendars. Connect once, then choose here what it is used for.",
      none: "Not connected", noneSub: "Address and pairing code are shown in the helper's web interface under “Connection”.",
      checking: "Connecting …", ok: "Connected to $1", okSub: "Group $1 · $2 · Language model: $3 · Helper $4", noModel: "none selected",
      fail: "No connection: $1", errCode: "Pairing code does not match", errPerm: "Permission for the address missing – click “Connect”",
      openWeb: "Open web interface", useTitle: "Use it for",
      useSearch: "Search: compute the meaning search in the helper", useAi: "AI assistant: the helper's language model",
      searchMissing: "NovaBird-Search is not installed.", searchOn: "Search computes in the helper.", searchOff: "Search computes without the helper (word search always stays).",
      searchChecking: "Checking the helper with the probe texts …", searchFail: "Search: $1",
      aiOn: "The AI assistant uses $1 in the helper.", aiNoModel: "On – but no language model is selected in the helper yet (web interface → Language model).", aiOff: "Off – or your own server under “AI assistant”.", aiOther: "The AI assistant currently uses your own server ($1); tick to switch to the helper.",
      calLabel: "Team calendars", calUser: "User name", calPassword: "Password", calAdd: "Add calendars",
      calHint: "With user name and password of the helper's web interface. Thunderbird remembers the password.",
      calAdded: "Added: $1", calExisting: "Already added: $1", calWorking: "Looking for calendars …",
      calErr: { url: "Invalid address.", cert: "The helper's certificate does not match the fingerprint – nothing added.", auth: "Wrong user name or password.", none: "No calendar is shared with this user." },
      calLan: "Other PCs reach the calendars only when “Web interface also reachable in the network” is switched on in the settings on the helper PC.",
      calOld: "This helper has no team calendars yet (update needed).", readOnly: "read only",
      connTitle: "Change connection", connTitleNew: "Connect", connText: "Address and pairing code of the group from the helper's web interface (Connection). The name appears there in the list of PCs.",
      url: "Address", code: "Pairing code", label: "Name of this PC", connect: "Connect", disconnect: "Disconnect",
      confirmDisconnect: "Disconnect from the helper?\n\nSearch and AI assistant no longer use it; added calendars stay.",
    },
    fr: {
      intro: "Le NovaBird Helper calcule pour tous sur un PC avec carte graphique : recherche par le sens, assistant IA et calendriers d’équipe. Connectez-le une fois, puis choisissez ici son usage.",
      none: "Non connecté", noneSub: "L’adresse et le code d’appairage figurent dans l’interface web du Helper, sous « Connexion ».",
      checking: "Connexion …", ok: "Connecté à $1", okSub: "Groupe $1 · $2 · Modèle de langage : $3 · Helper $4", noModel: "aucun choisi",
      fail: "Pas de connexion : $1", errCode: "Le code d’appairage ne correspond pas", errPerm: "Autorisation pour l’adresse manquante – cliquez sur « Connecter »",
      openWeb: "Ouvrir l’interface web", useTitle: "Utiliser pour",
      useSearch: "Recherche : calculer la recherche par le sens dans le Helper", useAi: "Assistant IA : modèle de langage du Helper",
      searchMissing: "NovaBird-Search n’est pas installé.", searchOn: "La recherche calcule dans le Helper.", searchOff: "La recherche calcule sans le Helper (la recherche par mots reste toujours).",
      searchChecking: "Vérification du Helper avec les textes de test …", searchFail: "Recherche : $1",
      aiOn: "L’assistant IA utilise $1 dans le Helper.", aiNoModel: "Activé – mais aucun modèle de langage n’est encore choisi dans le Helper (interface web → Modèle de langage).", aiOff: "Désactivé – ou votre propre serveur sous « Assistant IA ».", aiOther: "L’assistant IA utilise votre propre serveur ($1) ; cochez pour passer au Helper.",
      calLabel: "Calendriers d’équipe", calUser: "Nom d’utilisateur", calPassword: "Mot de passe", calAdd: "Ajouter les calendriers",
      calHint: "Avec le nom d’utilisateur et le mot de passe de l’interface web du Helper. Thunderbird mémorise le mot de passe.",
      calAdded: "Ajoutés : $1", calExisting: "Déjà ajoutés : $1", calWorking: "Recherche des calendriers …",
      calErr: { url: "Adresse invalide.", cert: "Le certificat du Helper ne correspond pas à l’empreinte – rien n’a été ajouté.", auth: "Nom d’utilisateur ou mot de passe incorrect.", none: "Aucun calendrier n’est partagé avec cet utilisateur." },
      calLan: "Les autres PC n’accèdent aux calendriers que si « Interface web accessible aussi sur le réseau » est activé dans les réglages du PC du Helper.",
      calOld: "Ce Helper ne connaît pas encore les calendriers d’équipe (mise à jour nécessaire).", readOnly: "lecture seule",
      connTitle: "Modifier la connexion", connTitleNew: "Connecter", connText: "Adresse et code d’appairage du groupe, depuis l’interface web du Helper (Connexion). Le nom y apparaît dans la liste des PC.",
      url: "Adresse", code: "Code d’appairage", label: "Nom de ce PC", connect: "Connecter", disconnect: "Déconnecter",
      confirmDisconnect: "Déconnecter le Helper ?\n\nLa recherche et l’assistant IA ne l’utilisent plus ; les calendriers ajoutés restent.",
    },
    es: {
      intro: "El NovaBird Helper calcula para todos en un PC con tarjeta gráfica: búsqueda por significado, asistente IA y calendarios de equipo. Conéctelo una vez y elija aquí para qué se usa.",
      none: "Sin conectar", noneSub: "La dirección y el código de emparejamiento están en la interfaz web del Helper, en «Conexión».",
      checking: "Conectando …", ok: "Conectado a $1", okSub: "Grupo $1 · $2 · Modelo de lenguaje: $3 · Helper $4", noModel: "ninguno elegido",
      fail: "Sin conexión: $1", errCode: "El código de emparejamiento no coincide", errPerm: "Falta el permiso para la dirección – pulse «Conectar»",
      openWeb: "Abrir la interfaz web", useTitle: "Usar para",
      useSearch: "Búsqueda: calcular la búsqueda por significado en el Helper", useAi: "Asistente IA: modelo de lenguaje del Helper",
      searchMissing: "NovaBird-Search no está instalado.", searchOn: "La búsqueda calcula en el Helper.", searchOff: "La búsqueda calcula sin el Helper (la búsqueda por palabras siempre sigue).",
      searchChecking: "Comprobando el Helper con los textos de prueba …", searchFail: "Búsqueda: $1",
      aiOn: "El asistente IA usa $1 en el Helper.", aiNoModel: "Activado, pero aún no hay modelo de lenguaje elegido en el Helper (interfaz web → Modelo de lenguaje).", aiOff: "Desactivado – o su propio servidor en «Asistente IA».", aiOther: "El asistente IA usa ahora su propio servidor ($1); marque para cambiar al Helper.",
      calLabel: "Calendarios de equipo", calUser: "Nombre de usuario", calPassword: "Contraseña", calAdd: "Añadir calendarios",
      calHint: "Con el nombre de usuario y la contraseña de la interfaz web del Helper. Thunderbird recuerda la contraseña.",
      calAdded: "Añadidos: $1", calExisting: "Ya añadidos: $1", calWorking: "Buscando calendarios …",
      calErr: { url: "Dirección no válida.", cert: "El certificado del Helper no coincide con la huella – no se añadió nada.", auth: "Nombre de usuario o contraseña incorrectos.", none: "No hay calendarios compartidos con este usuario." },
      calLan: "Los demás PC solo acceden a los calendarios si en el PC del Helper está activado «Interfaz web accesible también en la red».",
      calOld: "Este Helper aún no tiene calendarios de equipo (hace falta actualizar).", readOnly: "solo lectura",
      connTitle: "Cambiar conexión", connTitleNew: "Conectar", connText: "Dirección y código de emparejamiento del grupo, de la interfaz web del Helper (Conexión). El nombre aparece allí en la lista de PC.",
      url: "Dirección", code: "Código de emparejamiento", label: "Nombre de este PC", connect: "Conectar", disconnect: "Desconectar",
      confirmDisconnect: "¿Desconectar del Helper?\n\nLa búsqueda y el asistente IA dejan de usarlo; los calendarios añadidos se quedan.",
    },
  };
  const lang = (messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase();
  const t = T[lang] || T.en;
  const fill = (s, ...a) => a.reduce((x, v, i) => x.replace("$" + (i + 1), v), s);

  for (const [id, key] of Object.entries({
    intro: "intro", openWeb: "openWeb", useTitle: "useTitle", useSearchLabel: "useSearch", useAiLabel: "useAi", calLabel: "calLabel",
    calAdd: "calAdd", connText: "connText", urlLabel: "url", codeLabel: "code", labelLabel: "label", connect: "connect", disconnect: "disconnect",
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
    $("connBox").querySelector("summary").textContent = conn ? t.connTitle : t.connTitleNew;
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
    await Promise.all([showSearch(), showAi(), showCalendars()]);
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
  async function showAi() {
    const c = await messenger.storage.local.get({ aiEnabled: false, aiType: "", aiUrl: "", aiModel: "" });
    const mine = c.aiEnabled && c.aiType === "nbhelper" && conn && c.aiUrl === conn.url;
    $("useAi").checked = Boolean(mine);
    $("useAiNote").textContent = mine ? (info && !info.chatModel ? t.aiNoModel : fill(t.aiOn, (info?.chatModel || "–").replace(/^ollama:/, "")))
      : c.aiEnabled && c.aiType !== "nbhelper" ? fill(t.aiOther, c.aiModel || c.aiUrl) : t.aiOff;
  }

  $("useAi").addEventListener("change", async () => {
    if ($("useAi").checked) {
      await messenger.storage.local.set({ aiEnabled: true, aiType: "nbhelper", aiUrl: conn.url, aiKey: conn.code });
    } else {
      const c = await messenger.storage.local.get({ aiType: "" });
      if (c.aiType === "nbhelper") await messenger.storage.local.set({ aiEnabled: false });
    }
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

  // ---- Verbindung ----
  $("connect").addEventListener("click", () => {
    const url = $("url").value.trim().replace(/\/+$/, "");
    const code = $("code").value.trim() || conn?.code || "";
    const label = $("label").value.trim();
    let asked = null;
    try {
      // Erlaubnis für Adressen außerhalb dieses PCs direkt im Klick erfragen (vor dem ersten await)
      if (!nbAI.isLocal(url)) asked = messenger.permissions.request({ origins: [nbAI.origin(url)] }).catch(() => false);
    } catch {
      $("connStatus").textContent = t.calErr.url;
      return;
    }
    (async () => {
      if (asked && !(await asked)) {
        showState("bad", fill(t.fail, t.errPerm));
        return;
      }
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
    })();
  });

  $("disconnect").addEventListener("click", async () => {
    if (!confirm(t.confirmDisconnect)) return;
    const c = await messenger.storage.local.get({ aiType: "" });
    if (c.aiType === "nbhelper") await messenger.storage.local.set({ aiEnabled: false });
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
