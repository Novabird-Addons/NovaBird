# NovaBird Helper (Windows)

Rechnet für die **semantische Suche** von [NovaBird-Search](../novabird-search/README.md) und ab 0.4 für die **KI-Zusammenfassung** der NovaBird-Extension auf der Grafikkarte: **Windows ML** (ONNX Runtime mit **DirectML**; AMD, NVIDIA, Intel, auch integrierte Grafik; Sprachmodelle mit ONNX Runtime GenAI). Gemessen mit `jina-embeddings-v2-base-de` (fp16) auf Ryzen 9 9950X / RX 6900 XT mit realistischen Mails (Betreff + 1.200 Zeichen Text, 80–512 Token): etwa 60–65 Mails pro Sekunde statt etwa 5 im Add-on, 70.000 Mails in rund 20 Minuten (NovaBird-Search hält dafür zwei Pakete gleichzeitig beim Helper, die Karte rechnet durchgehend). Kurze Mails gehen schneller (200 Token: etwa 140 pro Sekunde). Der Helper sortiert jedes Paket nach Länge und rundet auf Stufen von 64 Token (weniger Auffüllen, wenige Formen für DirectML). Die Vektoren passen zu denen des Add-ons (Kosinus ≥ 0,9997); NovaBird-Search prüft das vor jedem Einsatz mit Probetexten.

Betriebsarten:
- **Auf diesem PC** (Native Messaging): Thunderbird startet den Helper bei Bedarf, kein Fenster, keine offenen Ports.
- **Netz-Modus** (ab 0.2): Der Helper läuft mit Symbol im Infobereich auf dem PC mit der starken Grafikkarte und rechnet für mehrere PCs im Netz. Bedienung ab 0.4 über eine **Web-Oberfläche** mit eigenen Benutzern.
- **Netz-Modus als Windows-Dienst** (ab 0.4, optional): läuft ohne Anmeldung an Windows; das Symbol zeigt dann nur den Zustand.

## Installation
`NovaBird-Helper-<Version>.exe` doppelklicken → „installieren?“ → Ja. Installiert wird nur für den angemeldeten Windows-Benutzer, **ohne Adminrechte**:
- Programm: `%LOCALAPPDATA%\Programs\NovaBird Helper\nbhelper.exe`
- Native-Messaging-Eintrag: `HKCU\Software\Mozilla\NativeMessagingHosts\novabird_helper` (nur NovaBird-Search, ID `novabird-db@novabird`, darf ihn starten)
- Startmenü: „NovaBird Helper (Netz)“ (startet den Netz-Modus)
- **Aktualisieren:** die neue `nbhelper.exe` doppelklicken → „ersetzen?“ → Ja. Modelle, Einstellungen, Kopplungscode, PC-Liste und Benutzer der Web-Oberfläche bleiben; ältere Einstellungen werden beim Start umgestellt (Schema-Version). Ein laufender Netz-Modus startet danach neu; ist der Dienst eingerichtet, wird er mit aktualisiert (Windows fragt nach Adminrechten).
- Eintrag unter „Installierte Apps“ zum Entfernen (fragt, ob Modelle und Einstellungen mit gelöscht werden sollen; beendet einen laufenden Netz-Modus, entfernt Verknüpfung, Autostart und einen eingerichteten Dienst)

## Auf diesem PC
In Thunderbird: Einstellungen von NovaBird-Search → **Semantische Suche** → Erweitert → „Helper verbinden“ (Thunderbird fragt einmal nach der Berechtigung) → „Modell im Helper laden“. Der Helper lädt das Modell von Hugging Face (feste Revision, jede Datei mit Prüfsumme), misst CPU und alle Grafikkarten und nimmt das schnellste Gerät. Er läuft nur, solange NovaBird-Search ihn braucht.

- **Rechenweg „Automatisch“** (Add-on): läuft der Helper und hat er das Modell bereit, rechnet er; sonst und bei Fehlern rechnet das Add-on auf der CPU. Fällt die Grafikkarte aus, wechselt der Helper selbst auf die CPU.
- **Akku:** Im Akkubetrieb ruht das Durchrechnen des Altbestands; Suchen gehen weiter.
- **Tokenizer:** Ab 0.2 zerlegt der Helper die Texte selbst (`Tokenizer.cs`, Byte-Level-BPE nach `tokenizer.json`; Token gleich der Python-Bibliothek `tokenizers`, geprüft mit 269 Texten und 26.682 Token einschließlich Sonderzeichen, Emoji und Überlänge). Das Add-on braucht dann kein eigenes Modell. Ältere Helper bekommen weiter Token-IDs vom Add-on.

## Netz-Modus: ein PC rechnet für mehrere
Auf dem Rechen-PC: Startmenü → **„NovaBird Helper (Netz)“**. Beim ersten Start öffnet sich die **Web-Oberfläche** (`http://localhost:47532`): ersten Admin anlegen (Name und Passwort nur für diese Oberfläche). Der Helper fragt, ob er das Suchmodell laden darf (etwa 320 MB), und misst die Geräte. Unter **Verbindung** stehen **Adresse** (z. B. `http://192.168.1.20:47531`) und **Kopplungscode** zum Kopieren. Fragt Windows nach der Firewall: Zugriff im privaten Netzwerk erlauben (braucht einmal Adminrechte).

Auf den anderen PCs in Thunderbird: NovaBird-Search → Semantische Suche → Erweitert → Rechenweg **„Anderer PC oder Server“**, Schnittstelle **„NovaBird Helper (Netz)“**, Adresse und Code eintragen, optional einen Namen für den PC, „Speichern und prüfen“.

- **Verschlüsselt:** Jede Anfrage und jede Antwort ist mit AES-256-GCM verschlüsselt; der Schlüssel entsteht aus dem Kopplungscode (20 Zeichen, PBKDF2-SHA256 mit 300.000 Runden). Mailtexte und Vektoren gehen nie lesbar durchs Netz, auch ohne Zertifikate. Ohne Code: 403; nach 20 Fehlversuchen in einer Minute ist die Adresse eine Minute gesperrt. Jede Anfrage gilt nur einmal und nur mit aktueller Uhrzeit (±10 Minuten).
- **Reihenfolge:** Suchanfragen gehen vor (gemessen: 0,1–0,3 s Antwort, während drei PCs gleichzeitig indexieren); beim Indexieren kommen die PCs abwechselnd dran.
- **Web-Oberfläche** (Klick auf das Symbol, Port 47532): *Status* (Zustand, Gerät, Geschwindigkeit mit Aufteilung Grafikkarte/CPU, Warteschlange, Modelle, gemessene Geräte, Geräte neu messen), *PCs* (jeder PC mit „Indiziert auf dem PC“ – meldet NovaBird-Search mit jeder Anfrage –, vom Helper heute und insgesamt gerechnete Mails, zuletzt gesehen; aus der Liste entfernen), *Sprachmodell* (siehe unten), *Verbindung* (Adressen und Kopplungscode zum Kopieren, neuer Code, Fingerabdruck des HTTPS-Zertifikats), *Einstellungen* (CPU mitrechnen, Threads, Pause, mit Windows starten, Ports, Web-Oberfläche im Netz, als Dienst einrichten), *Benutzer*, *Protokoll*, *Mein Konto*. Die PC-Liste bleibt über Neustarts erhalten (`clients.json`).
- **Benutzer der Web-Oberfläche:** eigene Konten (keine Windows-Benutzer), Rollen *Admin* (alles) und *Nur lesen* (Status, PCs, Einstellungen ansehen; kein Kopplungscode). Den ersten Admin nur an diesem PC anlegen. Passwörter mit PBKDF2-SHA256 (600.000 Runden); Sitzung 12 Stunden; nach 10 Fehlversuchen in 10 Minuten ist die Adresse 10 Minuten gesperrt.
- **Web-Oberfläche im Netz** (Einstellungen, standardmäßig aus): dann nur über **HTTPS** mit selbst erzeugtem Zertifikat; der Browser warnt beim ersten Aufruf – Fingerabdruck mit dem unter *Verbindung* vergleichen.
- **Vektoren teilen (Standard an):** Der Helper merkt sich jeden Vektor, den er für einen PC gerechnet hat, und gibt ihn anderen PCs mit derselben Mail direkt zurück (gleiche Message-ID und gleicher Text, geprüft mit einer Prüfsumme des Textes). Ein neuer PC mit demselben Postfach ist so in Minuten indiziert. Gespeichert werden nur Vektoren (float16, etwa 1,5 KB je Mail) und Prüfsummen unter `vectors\`, keine Mailtexte und keine Message-IDs im Klartext (HMAC mit geheimem Salz). Abschalten und Löschen in den Einstellungen der Web-Oberfläche.
- **CPU mitrechnen (aus, bis du es einschaltest):** Die CPU rechnet neben der Grafikkarte Häppchen zu 16 Mails; die Threads stellst du im Menü ein (so viele Kerne bleiben für die normale Arbeit frei, wie du übrig lässt). Nur wenn CPU und Grafikkarte beim Messen dieselben Vektoren liefern (≥ 0,995, gemessen 0,9998). Hat die Grafikkarte nichts zu tun, rechnet sie das Häppchen der CPU selbst noch einmal (wer zuerst fertig ist, gilt), damit kein Paket auf die langsamere CPU wartet. Lohnt sich, wenn die Grafikkarte im Vergleich zur CPU schwach ist; auf Ryzen 9 9950X mit RX 6900 XT (Karte etwa viermal so schnell) bringt es nichts, weil beide denselben Prozessor für die Zuarbeit brauchen. Der Status zeigt die Aufteilung („Grafikkarte … + CPU …“).
- Ports 47531 (PCs, `netPort`) und 47532 (Web-Oberfläche, `webPort`). Als Programm läuft der Netz-Modus, solange du angemeldet bist (mit „Mit Windows starten“ nach jeder Anmeldung).

## Als Windows-Dienst (optional)
Web-Oberfläche (an diesem PC) → Einstellungen → **„Als Windows-Dienst einrichten …“** oder Rechtsklick auf das Symbol. Windows fragt einmal nach Adminrechten. Danach läuft der Netz-Modus ohne Anmeldung an Windows:
- Konto `NT SERVICE\NovaBirdHelper` (virtuelles Dienstkonto), Programm in `%ProgramFiles%\NovaBird Helper`, Daten in `%ProgramData%\NovaBird\Helper` (nur SYSTEM, Administratoren und das Dienstkonto), Schlüssel mit DPAPI für den Rechner geschützt.
- Übernommen werden Einstellungen, Kopplungscode (die PCs müssen nichts ändern), PC-Liste, Benutzer der Web-Oberfläche und Modelle.
- Firewall-Regeln für beide Ports, nur private Netzwerke. Neustart nach einem Absturz.
- Das Symbol im Infobereich (`--tray`, startet mit der Anmeldung) zeigt den Zustand und öffnet die Web-Oberfläche; **„Zurück zum Programm im Benutzerkonto …“** entfernt den Dienst wieder.

## Sprachmodell (KI-Zusammenfassung)
Der Helper fasst Mails für die NovaBird-Extension zusammen (Einstellungen der Extension → KI → Schnittstelle **„NovaBird Helper“**, Adresse und Kopplungscode wie bei der Suche). Mailtext und Antwort gehen verschlüsselt durchs Netz, die Antwort kommt stückweise. Das Modell wählst du in der Web-Oberfläche unter *Sprachmodell*; eine Antwort zur Zeit. Vergleich der Modelle: [docs/llm-test](../docs/llm-test/TEST-LLM.md).
- **Ollama (empfohlen):** „Ollama einrichten“ lädt das offizielle Paket Ollama 0.40.4 von GitHub (etwa 1,5 GB, Prüfsumme wird geprüft; CUDA-Teile nur bei NVIDIA, AMD/Intel rechnen über Vulkan) in den Datenordner (`ollama\programm`, Modelle in `ollama\modelle`). Der Helper startet es nur auf 127.0.0.1 (Port 47533, aus dem Netz nicht erreichbar), beendet es mit sich selbst und startet es nach einem Absturz neu. Empfohlene Modelle mit einem Klick laden (Gemma 4 E4B, Gemma 3 4B, Qwen3.5-4B) oder ein anderes per Name; Fortschritt und belegter Grafikspeicher stehen dabei.
- **Windows ML (Modellordner):** selbst gebautes Modell im Format von ONNX Runtime GenAI (`genai_config.json`, int4 für DirectML) übernehmen, wählen, testen; bleibt geladen, bis 15 Minuten nichts kam. Gemessen etwas schwächer als dasselbe Modell über Ollama; Gemma 4 E4B lässt sich dafür noch nicht bauen.

## Ordner-Sync zwischen PCs
Der Helper legt neue Vektoren **verschlüsselt** (AES-256-GCM) in einen gemeinsamen Ordner (NAS, OneDrive, Nextcloud …) und übernimmt die der anderen PCs; so rechnet nicht jeder PC alles selbst. Schlüssel aus dem **Kopplungscode** (20 Zeichen, PBKDF2-SHA256 mit 300.000 Runden); im Ordner liegen nur Salz und Prüfwert, auf dem PC der Schlüssel mit DPAPI geschützt. Inhalt der Pakete: Message-ID und Vektor, keine Mailtexte.

Erster PC: Ordner eintragen, Code leer lassen, „Koppeln“ → Code notieren. Weitere PCs: denselben Ordner und den Code eintragen.

## Dateien
- Einstellungen, Modelle, Protokoll: `%LOCALAPPDATA%\NovaBird\Helper\`, als Dienst `%ProgramData%\NovaBird\Helper\` (`settings.json` mit DPAPI-geschützten Codes, `clients.json` mit der PC-Liste des Netz-Modus, `users.json` mit den Benutzern der Web-Oberfläche, `web-cert.pfx`, `models\`, `llm\`, `helper.log`)
- Sync-Ordner: `<Ordner>\NovaBird-Sync\schluessel.json` und `<Ordner>\NovaBird-Sync\<Modell>-<Revision>\<Gerät>-<Zeit>.nbsync`

## Bauen
`build.sh` (eine selbstständige Datei, .NET-10-SDK nötig). Zum Testen ohne Laufzeitpakete: `dotnet build -c Release -p:PublishSingleFile=false` (braucht dann .NET 10 auf dem Rechner).

Befehle für Skripte und Tests: `--install` / `--uninstall` (mit `--quiet` ohne Rückfrage), `--server` (Netz-Modus), `--server-console [--loopback]` (Netz-Modus ohne Oberfläche), `--service` / `--tray` / `--service-install` / `--service-remove` / `--service-update` (Dienst), `--bench <model.onnx>` (Geräte messen), `--tokenize <tokenizer.json> <texte.json>` (Token-IDs). Umgebungsvariablen nur für Tests: `NOVABIRD_HELPER_DIR` (anderer Datenordner), `NOVABIRD_NET_PORT`, `NOVABIRD_WEB_PORT`, `NOVABIRD_NET_LOOPBACK=1` (nur dieser PC), `NOVABIRD_WEB_TLS=1` (HTTPS auch nur lokal).

Protokolle: Native Messaging siehe Kopf von `Host.cs`, Netz-Modus siehe Kopf von `NetServer.cs`, Web-Oberfläche siehe Kopf von `WebServer.cs`.
