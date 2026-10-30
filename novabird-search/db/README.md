# Suchindex von NovaBird-Search (bis 1.x: NovaBird-DB)

Eigener **SQLite-/FTS5-Suchindex** für **Betterbird** / Thunderbird ESR (ab 128), als Ersatz bzw. Verbesserung für Gloda. Ab NovaBird-Search 2.0 Teil dieses Add-ons (ID `novabird-db@novabird`, wie früher NovaBird-DB). Arbeitet im Hintergrund; die Oberfläche liefern die Suchleiste von [NovaBird-Search](../README.md) und [NovaBird-Conversation](../../novabird-conversation/) (Konversationen).

## Funktionen
- **Index** im Profil (`<Profil>/novabird-db/index.sqlite`) über **alle Konten und Ordner**; Erstaufbau mit Fortschrittsanzeige (75.000 Mails ≈ 6 Minuten), danach halten Ereignisse und ein sanfter Abgleich ihn aktuell. Nur lokal gespeicherte Mails werden mit Text gelesen (IMAP ohne Offline-Kopie nur Kopfdaten); keine Änderung am Mailbestand, kein Netzwerk.
- **Deutscher Parser:** Wortanfang-Suche, Umlaute egal, Personen („von Petra“, „von mir“), Zeiträume („im März 2026“, „letzte 6 Monate“), Anhänge („mit PDF“), Status, Ordner, `oder`, Verneinung; Operatoren `von:` `an:` `betreff:` `anh:` `seit:` `bis:` `tag:` `ordner:` …
- **Komposita** („Speiseplan“ findet „Wochenspeiseplan“), **Relevanz** (optional), **„Meinten Sie“** bei 0 Treffern.
- **Selbstschutz:** prüft den Index (nach unsauberem Beenden und regelmäßig), fragt bei Beschädigung „Neu aufbauen?“ und baut über eine Nebendatei, sodass der alte Index bis zum Schluss erhalten bleibt.
- **Schnittstelle:** die Suchleiste ruft den Index direkt auf (`novabirdDbLocal`); andere Add-ons (`ping`, `conversation`, Status-Push) nur mit freigegebener Add-on-ID.

## Installation und Einstellungen
Wird mit NovaBird-Search installiert (`novabird-search-<Version>.xpi`). Einstellungen: Add-ons-Manager → NovaBird-Search → Reiter **Index** (Status, Wartung, Protokoll, Zusammensetzungen, Suchsprachen).

## Hinweise
- Der Index enthält Mailtext und Anhangnamen **unverschlüsselt** im Profil (wie Gloda) und verlässt den Rechner nie; bei Bedarf Festplattenverschlüsselung nutzen.
- Beim Wechsel von „DB-Pilot“ (alte ID) wird der Index einmal neu aufgebaut; das alte Add-on vorher entfernen (gleiche Datei).
- Der Parser versteht Deutsch, Englisch, Französisch und Spanisch (einstellbar; Französisch und Spanisch noch nicht von Muttersprachlern geprüft).

Tests: `npm install && npm test`.
