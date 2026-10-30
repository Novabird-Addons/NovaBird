# NovaBird (Deutsch)

[English version](README.md) · [Disclaimer](#disclaimer)

Eine Familie von Add-ons für **Betterbird** (Thunderbird ESR, getestet mit Betterbird 153 ESR): schnelle Suche, Konversationsansicht, Sende-Hilfen, eine stilvolle Oberfläche mit drei Designs. Die Add-ons arbeiten einzeln, ergänzen sich aber (siehe Tabelle).

Ab 2.0 sind es vier Add-ons statt acht: Der Suchindex (bis 1.x NovaBird-DB) steckt in NovaBird-Search, die Themes stecken in der Extension.

| Add-on | Ordner | ID | Aufgabe |
|---|---|---|---|
| **NovaBird-Search** | [`novabird-search/`](novabird-search/README.md) | `novabird-db@novabird` | Suchleiste im Hauptfenster: Operatoren, Verlauf, Analyse, „Meinten Sie“, natürliche Sätze und Volltext; eigener SQLite-/FTS5-Index im Profil (`db/`), Konversationsabfrage für andere Add-ons |
| **NovaBird-Conversation** | [`novabird-conversation/`](novabird-conversation/README.md) | `novabird-conversation@novabird` | alle Nachrichten einer Konversation im Lesebereich; nutzt optional den Index von NovaBird-Search |
| **NovaBird-Send** | [`novabird-send/`](novabird-send/README.md) | `novabird-send@novabird` | Senden mit Rückgängig-Fenster und Warteschlange |
| **NovaBird-Extension** | [`novabird-extension/`](novabird-extension/README.md) | `novabird-extension@novabird` | rechte Leiste (Termine, Aufgaben, Anhänge), Einstellungen im neuen Stil, Nova-Calendar, Nova-Contact, Anhang-Vorschau, Regel-Assistent (Beta), Designs Sand/Cobalt/Springlight (hell und dunkel), Farben und Schrift, KI-Zusammenfassung (Opt-in), Postfach-Übersicht |

Dazu optional der **[NovaBird Helper](novabird-helper/README.md)** (Windows): rechnet die semantische Suche (Beta) auf der Grafikkarte und teilt die Vektoren verschlüsselt über einen Ordner zwischen PCs.

NovaBird-Search behält die ID des früheren NovaBird-DB, damit Index und Einstellungen bei der Aktualisierung erhalten bleiben. Umstieg von 1.x: Das alte NovaBird-Search (`novabird-search@novabird`) und die alten Theme-Add-ons (`novabird-t-<name>@novabird`) werden beim ersten Start übernommen (Einstellungen, Suchverlauf, gewähltes Theme) und entfernt.

## Zusammenspiel
- **Suchleiste → Index:** im selben Add-on, direkter Aufruf (`dbCall` in `background.js`, Gegenstück `novabirdDbLocal` in `db/background.js`); solange der Index nicht bereit ist, sucht die Leiste über Betterbirds eigenen Index (Gloda).
- **Conversation → Index:** per `runtime.sendMessage("novabird-db@novabird", …)`, nur `ping` und `conversation` (feste Rechteliste `ALLOWED_EXTERNAL`); ohne Index: Gloda, dann Betterbird-Suche.
- **Extension ↔ Conversation:** die Anhang-Vorschau liest `.nbc-chip` aus dem DOM der Conversation (Klassennamen nicht ohne Abstimmung ändern).
- **Extension → Designs:** das Experiment `novaTheme` setzt das gewählte Design wie ein installiertes Theme (hell/dunkel nach Betriebssystem, eigenes Stylesheet). Ohne gewähltes Design gilt das Theme aus dem Add-ons-Manager.

## Bauen und Testen
Jedes Add-on hat einen `build.sh` (erzeugt `novabird-<name>-<Version>.xpi`). Unit-Tests: Index in `novabird-search/db` (`npm install && npm test`), `novabird-search`/`-send`/`-conversation`/`-extension` (`node --test tests/*.test.js`). Tests im echten Betterbird laufen headless per Marionette in einem lokalen Labor (nicht Teil dieses Repos).
Installieren: das `.xpi` im Add-ons-Manager („Add-on aus Datei installieren“); mehrere Pakete lassen sich im Dateifenster auf einmal markieren (Strg+A) oder zusammen auf den Add-ons-Manager ziehen.

## Hinweise
- Alle Add-ons sind unsignierte Entwicklerbuilds (noch ohne Signatur und ohne Store-Veröffentlichung).
- Der Suchindex liegt im Profilordner (`novabird-db/`) und enthält Mailinhalte: genauso schützenswert wie das Postfach.
- **Suchsprachen:** Der Freitext-Parser versteht Deutsch, Englisch, Französisch und Spanisch (Standard: Sprache von Betterbird, in den Einstellungen von NovaBird-Search unter „Index“ änderbar). Französisch und Spanisch sind noch nicht von Muttersprachlern geprüft.

Eine kurze Anleitung für Anwender: [HANDBUCH.md](HANDBUCH.md).

Lizenz: MIT, siehe `LICENSE`.

## Disclaimer

> [!WARNING]
> **Inoffiziell und experimentell.** NovaBird ist ein unabhängiges Community-Projekt und steht in keiner Verbindung zu Betterbird, Thunderbird oder der MZLA Technologies Corporation (keine Unterstützung, keine Empfehlung); Probleme bitte nicht deren Teams melden. Die Add-ons nutzen nicht unterstützte *Experiment-APIs*, die mit jedem Betterbird- oder Thunderbird-Update brechen können.
>
> Getestet wurde überwiegend mit Betterbird 153 ESR unter Linux, dazu ein paar einfache Tests unter Windows, die „ok“ ergaben - hauptsächlich mit Testdaten. IMAP-Konten und manche Funktionen sind nicht vollständig geprüft und können Fehler zeigen.
>
> Bereitstellung „wie besehen“, ohne Gewähr (siehe [LICENSE](LICENSE)) - daher **Nutzung auf eigene Gefahr und vor der Installation das Profil sichern.**
