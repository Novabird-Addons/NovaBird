# NovaBird-DB

Eigener **SQLite-/FTS5-Suchindex** für **Betterbird** / Thunderbird ESR (ab 128), als Ersatz bzw. Verbesserung für Gloda. Version 1.2.0 · Deutsch, English, Français, Español. Arbeitet im Hintergrund; die Oberfläche liefern [NovaBird-Search](../novabird-search/) (Suche) und [NovaBird-Conversation](../novabird-conversation/) (Konversationen).

## Funktionen
- **Index** im Profil (`<Profil>/novabird-db/index.sqlite`) über **alle Konten und Ordner**; Erstaufbau mit Fortschrittsanzeige (75.000 Mails ≈ 6 Minuten), danach halten Ereignisse und ein sanfter Abgleich ihn aktuell. Nur lokal gespeicherte Mails werden mit Text gelesen (IMAP ohne Offline-Kopie nur Kopfdaten); keine Änderung am Mailbestand, kein Netzwerk.
- **Deutscher Parser:** Wortanfang-Suche, Umlaute egal, Personen („von Petra“, „von mir“), Zeiträume („im März 2026“, „letzte 6 Monate“), Anhänge („mit PDF“), Status, Ordner, `oder`, Verneinung; Operatoren `von:` `an:` `betreff:` `anh:` `seit:` `bis:` `tag:` `ordner:` …
- **Komposita** („Speiseplan“ findet „Wochenspeiseplan“), **Relevanz** (optional), **„Meinten Sie“** bei 0 Treffern.
- **Selbstschutz:** prüft den Index (nach unsauberem Beenden und regelmäßig), fragt bei Beschädigung „Neu aufbauen?“ und baut über eine Nebendatei, sodass der alte Index bis zum Schluss erhalten bleibt.
- **Schnittstelle** für andere Add-ons (`ping`, `search`, `conversation`, Status-Push), nur für freigegebene Add-on-IDs; Beschreibung in [CLAUDE.md](CLAUDE.md).

## Installation und Einstellungen
`novabird-db-<Version>.xpi` im Add-ons-Manager („Add-on aus Datei installieren“). Nur Betterbird / Thunderbird ESR (Experiment-API). Einstellungen (Add-ons-Manager → NovaBird-DB): Status, Wartung (aufräumen, neu aufbauen, löschen), Protokoll, Zusammensetzungen.

## Hinweise
- Der Index enthält Mailtext und Anhangnamen **unverschlüsselt** im Profil (wie Gloda) und verlässt den Rechner nie; bei Bedarf Festplattenverschlüsselung nutzen.
- Beim Wechsel von „DB-Pilot“ (alte ID) baut NovaBird-DB den Index einmal neu auf; das alte Add-on vorher entfernen (gleiche Datei).
- Der Parser versteht Deutsch, Englisch, Französisch und Spanisch (einstellbar; Französisch und Spanisch noch nicht von Muttersprachlern geprüft).

Entwicklerinfo, Tests und Schnittstelle: [CLAUDE.md](CLAUDE.md) · `npm install && npm test`.
