# NovaBird Helper (Windows)

Rechnet für die **semantische Suche** von [NovaBird-Search](../novabird-search/README.md) auf der Grafikkarte: ONNX Runtime mit **DirectML** (AMD, NVIDIA, Intel, auch integrierte Grafik). Gemessen mit `jina-embeddings-v2-base-de` (fp16) auf Ryzen 9 9950X / RX 6900 XT mit realistischen Mails (Betreff + 1.200 Zeichen Text, 80–512 Token): etwa 60–65 Mails pro Sekunde statt etwa 5 im Add-on, 70.000 Mails in rund 20 Minuten (NovaBird-Search hält dafür zwei Pakete gleichzeitig beim Helper, die Karte rechnet durchgehend). Kurze Mails gehen schneller (200 Token: etwa 140 pro Sekunde). Der Helper sortiert jedes Paket nach Länge und rundet auf Stufen von 64 Token (weniger Auffüllen, wenige Formen für DirectML). Die Vektoren passen zu denen des Add-ons (Kosinus ≥ 0,9997); NovaBird-Search prüft das vor jedem Einsatz mit Probetexten.

Zwei Betriebsarten:
- **Auf diesem PC** (Native Messaging): Thunderbird startet den Helper bei Bedarf, kein Fenster, keine offenen Ports.
- **Netz-Modus** (ab 0.2): Der Helper läuft mit Symbol im Infobereich auf dem PC mit der starken Grafikkarte und rechnet für mehrere PCs im Netz.

## Installation
`NovaBird-Helper-<Version>.exe` doppelklicken → „installieren?“ → Ja. Installiert wird nur für den angemeldeten Windows-Benutzer, **ohne Adminrechte**:
- Programm: `%LOCALAPPDATA%\Programs\NovaBird Helper\nbhelper.exe`
- Native-Messaging-Eintrag: `HKCU\Software\Mozilla\NativeMessagingHosts\novabird_helper` (nur NovaBird-Search, ID `novabird-db@novabird`, darf ihn starten)
- Startmenü: „NovaBird Helper (Netz)“ (startet den Netz-Modus)
- **Aktualisieren:** die neue `nbhelper.exe` doppelklicken → „ersetzen?“ → Ja (Modelle und Einstellungen bleiben; ein laufender Netz-Modus wird beendet und danach im Startmenü neu gestartet)
- Eintrag unter „Installierte Apps“ zum Entfernen (fragt, ob Modelle und Einstellungen mit gelöscht werden sollen; beendet einen laufenden Netz-Modus und entfernt Verknüpfung und Autostart)

## Auf diesem PC
In Thunderbird: Einstellungen von NovaBird-Search → **Semantische Suche** → Erweitert → „Helper verbinden“ (Thunderbird fragt einmal nach der Berechtigung) → „Modell im Helper laden“. Der Helper lädt das Modell von Hugging Face (feste Revision, jede Datei mit Prüfsumme), misst CPU und alle Grafikkarten und nimmt das schnellste Gerät. Er läuft nur, solange NovaBird-Search ihn braucht.

- **Rechenweg „Automatisch“** (Add-on): läuft der Helper und hat er das Modell bereit, rechnet er; sonst und bei Fehlern rechnet das Add-on auf der CPU. Fällt die Grafikkarte aus, wechselt der Helper selbst auf die CPU.
- **Akku:** Im Akkubetrieb ruht das Durchrechnen des Altbestands; Suchen gehen weiter.
- **Tokenizer:** Ab 0.2 zerlegt der Helper die Texte selbst (`Tokenizer.cs`, Byte-Level-BPE nach `tokenizer.json`; Token gleich der Python-Bibliothek `tokenizers`, geprüft mit 269 Texten und 26.682 Token einschließlich Sonderzeichen, Emoji und Überlänge). Das Add-on braucht dann kein eigenes Modell. Ältere Helper bekommen weiter Token-IDs vom Add-on.

## Netz-Modus: ein PC rechnet für mehrere
Auf dem Rechen-PC: Startmenü → **„NovaBird Helper (Netz)“**. Beim ersten Start fragt er, ob er das Modell laden darf (etwa 320 MB), und misst die Geräte. Ein Klick auf das Symbol zeigt **Adresse** (z. B. `http://192.168.1.20:47531`) und **Kopplungscode**. Fragt Windows nach der Firewall: Zugriff im privaten Netzwerk erlauben (braucht einmal Adminrechte).

Auf den anderen PCs in Thunderbird: NovaBird-Search → Semantische Suche → Erweitert → Rechenweg **„Anderer PC oder Server“**, Schnittstelle **„NovaBird Helper (Netz)“**, Adresse und Code eintragen, optional einen Namen für den PC, „Speichern und prüfen“.

- **Verschlüsselt:** Jede Anfrage und jede Antwort ist mit AES-256-GCM verschlüsselt; der Schlüssel entsteht aus dem Kopplungscode (20 Zeichen, PBKDF2-SHA256 mit 300.000 Runden). Mailtexte und Vektoren gehen nie lesbar durchs Netz, auch ohne Zertifikate. Ohne Code: 403; nach 20 Fehlversuchen in einer Minute ist die Adresse eine Minute gesperrt. Jede Anfrage gilt nur einmal und nur mit aktueller Uhrzeit (±10 Minuten).
- **Reihenfolge:** Suchanfragen gehen vor (gemessen: 0,1–0,3 s Antwort, während drei PCs gleichzeitig indexieren); beim Indexieren kommen die PCs abwechselnd dran.
- **Menü:** Status, Warteschlange, verbundene PCs (Name, Mails heute), Adresse und Code, Code kopieren, neuer Code (alle PCs müssen ihn dann neu eintragen), Pause (nur Suchanfragen werden beantwortet), CPU mitrechnen lassen, CPU-Threads, Geräte neu messen, mit Windows starten, Protokoll, Beenden.
- **CPU mitrechnen (aus, bis du es einschaltest):** Die CPU rechnet neben der Grafikkarte Häppchen zu 16 Mails; die Threads stellst du im Menü ein (so viele Kerne bleiben für die normale Arbeit frei, wie du übrig lässt). Nur wenn CPU und Grafikkarte beim Messen dieselben Vektoren liefern (≥ 0,995, gemessen 0,9998). Hat die Grafikkarte nichts zu tun, rechnet sie das Häppchen der CPU selbst noch einmal (wer zuerst fertig ist, gilt), damit kein Paket auf die langsamere CPU wartet. Lohnt sich, wenn die Grafikkarte im Vergleich zur CPU schwach ist; auf Ryzen 9 9950X mit RX 6900 XT (Karte etwa viermal so schnell) bringt es nichts, weil beide denselben Prozessor für die Zuarbeit brauchen. Der Status zeigt die Aufteilung („Grafikkarte … + CPU …“).
- Port 47531 (Einstellung `netPort` in `settings.json`). Kein Dienst: der Netz-Modus läuft, solange du angemeldet bist (mit „Mit Windows starten“ nach jeder Anmeldung).

## Ordner-Sync zwischen PCs
Der Helper legt neue Vektoren **verschlüsselt** (AES-256-GCM) in einen gemeinsamen Ordner (NAS, OneDrive, Nextcloud …) und übernimmt die der anderen PCs; so rechnet nicht jeder PC alles selbst. Schlüssel aus dem **Kopplungscode** (20 Zeichen, PBKDF2-SHA256 mit 300.000 Runden); im Ordner liegen nur Salz und Prüfwert, auf dem PC der Schlüssel mit DPAPI geschützt. Inhalt der Pakete: Message-ID und Vektor, keine Mailtexte.

Erster PC: Ordner eintragen, Code leer lassen, „Koppeln“ → Code notieren. Weitere PCs: denselben Ordner und den Code eintragen.

## Dateien
- Einstellungen, Modelle, Protokoll: `%LOCALAPPDATA%\NovaBird\Helper\` (`settings.json` mit DPAPI-geschützten Codes, `models\`, `helper.log`)
- Sync-Ordner: `<Ordner>\NovaBird-Sync\schluessel.json` und `<Ordner>\NovaBird-Sync\<Modell>-<Revision>\<Gerät>-<Zeit>.nbsync`

## Bauen
`build.sh` (eine selbstständige Datei, .NET-10-SDK nötig). Zum Testen ohne Laufzeitpakete: `dotnet build -c Release -p:PublishSingleFile=false` (braucht dann .NET 10 auf dem Rechner).

Befehle für Skripte und Tests: `--install` / `--uninstall` (mit `--quiet` ohne Rückfrage), `--server` (Netz-Modus), `--server-console [--loopback]` (Netz-Modus ohne Oberfläche), `--bench <model.onnx>` (Geräte messen), `--tokenize <tokenizer.json> <texte.json>` (Token-IDs). Umgebungsvariablen nur für Tests: `NOVABIRD_HELPER_DIR` (anderer Datenordner), `NOVABIRD_NET_PORT`, `NOVABIRD_NET_LOOPBACK=1` (nur dieser PC).

Protokolle: Native Messaging siehe Kopf von `Host.cs`, Netz-Modus siehe Kopf von `NetServer.cs`.
