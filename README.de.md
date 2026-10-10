# NovaBird (Deutsch)

[English version](README.md) · [Disclaimer](#disclaimer)

Eine Familie von Add-ons für **Betterbird** (Thunderbird ESR, getestet mit Betterbird 153 ESR): schnelle Suche, Konversationsansicht, Sende-Hilfen, eine stilvolle Oberfläche und passende Themes. Die Add-ons arbeiten einzeln, ergänzen sich aber (siehe Tabelle).

| Add-on | Ordner | ID | Aufgabe |
|---|---|---|---|
| **NovaBird-Search** | [`novabird-search/`](novabird-search/README.md) | `novabird-search@novabird` | Suchleiste im Hauptfenster: Operatoren, Verlauf, Analyse, „Meinten Sie“; mit NovaBird-DB natürliche Sätze und Volltext |
| **NovaBird-DB** | [`novabird-db/`](novabird-db/README.md) | `novabird-db@novabird` | eigener SQLite-/FTS5-Index im Profil: schnelle Volltextsuche, Konversationsabfrage; Schnittstelle für andere Add-ons |
| **NovaBird-Conversation** | [`novabird-conversation/`](novabird-conversation/README.md) | `novabird-conversation@novabird` | alle Nachrichten einer Konversation im Lesebereich; nutzt optional NovaBird-DB |
| **NovaBird-Send** | [`novabird-send/`](novabird-send/README.md) | `novabird-send@novabird` | Senden mit Rückgängig-Fenster und Warteschlange |
| **NovaBird-Extension** | [`novabird-extension/`](novabird-extension/README.md) | `novabird-extension@novabird` | rechte Leiste (Termine, Aufgaben, Anhänge), Einstellungen im neuen Stil, Nova-Calendar, Nova-Contact, Anhang-Vorschau |
| **NovaBird-Sand / -Cobalt / -Springlight** | [`novabird-themes/`](novabird-themes/README.md) | `novabird-t-<name>@novabird` | Themes (hell und dunkel); die Extension übernimmt ihre Farben |

## Zusammenspiel
- **Search → DB:** Search fragt per `runtime.sendMessage("novabird-db@novabird", …)` (`ping`, `search`); ohne DB fällt Search auf Betterbirds eigenen Index (Gloda) zurück. Die DB erlaubt nur Absender aus einer festen Rechteliste (`ALLOWED_EXTERNAL`).
- **Conversation → DB:** nur `ping` und `conversation`; ohne DB: Gloda, dann Betterbird-Suche.
- **Extension ↔ Conversation:** die Anhang-Vorschau liest `.nbc-chip` aus dem DOM der Conversation (Klassennamen nicht ohne Abstimmung ändern).
- **Extension ↔ Themes:** die Extension liest die Standard-Theme-Variablen des aktiven Themes (keine ID-Kopplung); beide funktionieren auch einzeln.

## Bauen und Testen
Jedes Add-on hat einen `build.sh` (erzeugt `novabird-<name>-<Version>.xpi`) und eine eigene `CLAUDE.md` mit Ordnern, Architektur, Tests und Stolpersteinen. Unit-Tests: `novabird-db` (`npm install && npm test`), `novabird-search`/`-send`/`-conversation` (`node --test tests/*.test.js`). Tests im echten Betterbird laufen headless per Marionette in einem lokalen Labor (nicht Teil dieses Repos).
Installieren: das `.xpi` im Add-ons-Manager („Add-on aus Datei installieren“).

## Hinweise
- Alle Add-ons sind unsignierte Entwicklerbuilds (noch ohne Signatur und ohne Store-Veröffentlichung).
- Der Index von NovaBird-DB liegt im Profilordner (`novabird-db/`) und enthält Mailinhalte: genauso schützenswert wie das Postfach.
- **Suchsprachen:** Der Freitext-Parser versteht Deutsch, Englisch, Französisch und Spanisch (Standard: Sprache von Betterbird, in den NovaBird-DB-Einstellungen änderbar). Französisch und Spanisch sind noch nicht von Muttersprachlern geprüft.

Eine kurze Anleitung für Anwender: [HANDBUCH.md](HANDBUCH.md).

Lizenz: MIT, siehe `LICENSE`.

## Disclaimer

> [!WARNING]
> **Inoffiziell und experimentell.** NovaBird ist ein unabhängiges Community-Projekt und steht in keiner Verbindung zu Betterbird, Thunderbird oder der Mozilla Foundation (keine Unterstützung, keine Empfehlung); Probleme bitte nicht deren Teams melden. Die Add-ons nutzen nicht unterstützte *Experiment-APIs*, die mit jedem Betterbird- oder Thunderbird-Update brechen können.
>
> Getestet wurde überwiegend mit Betterbird 153 ESR unter Linux, dazu ein paar einfache Tests unter Windows, die „ok“ ergaben - hauptsächlich mit Testdaten. IMAP-Konten und manche Funktionen sind nicht vollständig geprüft und können Fehler zeigen.
>
> Bereitstellung „wie besehen“, ohne Gewähr (siehe [LICENSE](LICENSE)) - daher **Nutzung auf eigene Gefahr und vor der Installation das Profil sichern.**
