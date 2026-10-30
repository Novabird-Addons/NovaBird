# NovaBird 2.0 – Umbauplan

**Stand:** Schritte 1–3 umgesetzt und getestet (siehe CHANGELOG). Offen: Ende-zu-Ende-Test Thunderbird ↔ installierter Helper, Release-Bau des Helpers als eine Datei.

Branch `novabird-2.0`. `main` und `testing` bleiben unverändert, bis der Umbau getestet ist.

## 1. Zusammenlegen: 8 → 4 Add-ons

| vorher | nachher |
|---|---|
| NovaBird-Extension | **NovaBird-Extension 2.0** (mit den drei Themes) |
| NovaBird-Search, NovaBird-DB | **NovaBird-Search 2.0** (ID `novabird-db@novabird`) |
| NovaBird-Conversation | unverändert |
| NovaBird-Send | unverändert |
| NovaBird-Sand, -Cobalt, -Springlight | in der Extension (Reiter „Farben und Schrift“ → Design) |

### Search + DB
- Das gemeinsame Add-on behält die **ID von NovaBird-DB**. Damit bleiben der Suchindex (Datenbank im Profil des Add-ons) und die DB-Einstellungen erhalten, und NovaBird-Conversation findet den Index weiter unter derselben ID.
- Quelle liegt in `novabird-search/`, der Index-Teil in `novabird-search/db/` (unverändert als Modul, eigene Tests).
- Hintergrundseite: die Skripte der Suche (klassisch) und `db/background.js` (Modul). Die Suche ruft den Index direkt auf statt über `runtime.sendMessage`.
- Umstieg: Ist das alte NovaBird-Search (`novabird-search@novabird`) noch installiert, übernimmt das neue Add-on beim Start dessen Einstellungen und den Suchverlauf und entfernt es danach. Ein altes NovaBird-DB wird durch die neue Version einfach aktualisiert (gleiche ID).

### Themes in der Extension
- Die drei Themes liegen unter `novabird-extension/themes/<name>/` (Farben `theme.json`, Stylesheet `theme.css`, Quellen hell/dunkel).
- Das Experiment `novaTheme` setzt das gewählte Theme wie ein installiertes: hell und dunkel nach dem Modus des Betriebssystems, mit eigenem Stylesheet. „Thunderbird“ (Standard) lässt das installierte Theme wirken.
- Umstieg: Ist eines der alten Theme-Add-ons aktiv, wählt die Extension dasselbe Theme aus und entfernt die alten Theme-Add-ons.

### Online-Updates
- Der Kanal kennt nur noch die vier Add-ons. Alte Einträge (Search, Themes) fallen weg; NovaBird-DB heißt im Kanal „NovaBird-Search“.

## 2. Semantische Suche, Phase 1 (in NovaBird-Search)
- Reiter „Semantische Suche (Beta)“, standardmäßig aus.
- Modell `jinaai/jina-embeddings-v2-base-de` (fp16, 768 Dimensionen) mit fester Revision und SHA-256; Download von Hugging Face erst auf Knopfdruck.
- Laufzeit: transformers.js 4.3.1 und onnxruntime-web (WASM, mehrere Threads), lokal im Paket.
- Vektoren in der Index-Datenbank, Schlüssel Message-ID + Modell. Neueste Mails zuerst, nur im Leerlauf, fortsetzbar.
- Suche: Wortsuche und Bedeutungssuche gemischt (Reciprocal Rank Fusion); Bedeutungstreffer werden als „ähnlich“ markiert.
- Erweitert: Rechenweg (Automatisch / nur Add-on / nur Helper), Threads, Modell im Speicher halten, Strenge, Export/Import, Neuaufbau/Löschen.
- Schnittstelle zum NovaBird Helper (Native Messaging) vorbereitet.

## 3. NovaBird Helper (`nbhelper.exe`)
- C#/.NET, ONNX Runtime DirectML; misst beim ersten Start CPU und alle Grafikkarten und nimmt das schnellste Gerät.
- Lädt dasselbe Modell (gleiche Revision und Prüfsumme).
- Installation pro Benutzer ohne Adminrechte, Eintrag für Native Messaging unter HKCU.
- Ordner-Sync der Vektoren (NAS, OneDrive, Nextcloud): verschlüsselt, Schlüssel per Pairing-Code; keine offenen Ports.

### Eigener Server und Probe der Rechenwege
- Dritter Rechenweg „Eigener Server“: Ollama oder OpenAI-kompatibel, lokal oder im Netz, mit Benutzer/Schlüssel.
- Jeder Weg (Add-on, Helper, Server) muss sechs Probetexte passend zu Referenzvektoren rechnen (`semantic/probe.js`, Kosinus ≥ 0,995, Verschiebung ≤ 0,01), sonst schreibt er nichts in den Index. Gemessen: Add-on 0,99995, DirectML ≥ 0,9997, Ollama Vulkan 0,9979 (Verschiebung 0,005), q8 0,64.

### Helper im Netz (Helper 0.2)
- `nbhelper --server`: Symbol im Infobereich auf dem PC mit der Grafikkarte, bedient mehrere PCs: Kopplung per Code, Anfragen und Antworten verschlüsselt (AES-GCM, einmalig gültig, Zeitfenster), Suchanfragen vor Indexieren, PCs abwechselnd. In NovaBird-Search ein Server-Typ „NovaBird Helper (Netz)“ mit derselben Probe.
- Tokenizer im Helper: das Add-on schickt Texte; ohne Modell im Add-on, wenn der Helper rechnet.

## Später
- KI-Zusammenfassung über den Helper (ONNX Runtime GenAI, DirectML).
- Windows ML als zweiter Rechenweg, Linux-Weg.
