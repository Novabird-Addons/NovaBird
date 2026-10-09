# NovaBird-Conversation

Zeigt im Lesebereich von **Betterbird** / Thunderbird ESR (ab 128) **alle Nachrichten einer Konversation** – über alle Ordner, auch Gesendet und Archiv – übersichtlich untereinander. Version 0.14.0 · Deutsch, English, Français, Español.

## Funktionen
- **Konversation:** neueste Nachricht oben fixiert, ältere darunter (wahlweise älteste zuerst); neueste, vorherige und ungelesene aufgeklappt, der Rest als Zeile mit Name, Datum und Vorschau; Zitate hinter „…“; Anhänge als Chips; „Ganz anzeigen“ für lange Nachrichten.
- **Gruppierung** nach Antwortkette, für Mails ohne Kette wahlweise nach Betreff (aus / üblich / klug mit Zeitfenster und Personen).
- **Aktionen je Nachricht:** Antworten, Allen antworten, Weiterleiten (auch als Anhang), Als neu bearbeiten, Löschen (in den Papierkorb), Spam / Kein Spam; **Original** holt Betterbirds eigene Ansicht zurück (bei unlesbaren Einzelmails automatisch).
- **Aussehen:** drei Stile (*Sanft*, *Klar*, *Faden*), Theme-Farben hell/dunkel, einstellbare Animationen (0 = aus; „Bewegung reduzieren“ wird respektiert).
- **Datenschutz:** keine Skripte, keine Stile aus Mails, externe Bilder erst nach Klick (nur diese Nachricht / ganze Unterhaltung / immer von diesem Absender).

## Schnell auch bei großen Postfächern
Quellenkette: **[NovaBird-DB](../novabird-db/)** (optional, 5–70 ms) → Gloda (4–21 ms) → Betterbird-Suche (0,2–0,5 s). Fällt eine Quelle aus, wechselt das Add-on selbst zur nächsten, ohne Dauerabfragen. Bei IMAP werden Texte nur geladen, wenn sie sichtbar sind; Nachrichten ohne lokale Kopie sind mit ☁ markiert.

## Installation und Einstellungen
`novabird-conversation-<Version>.xpi` im Add-ons-Manager („Add-on aus Datei installieren“). Nur Betterbird / Thunderbird ESR (Experiment-API). Einstellungen (Add-ons-Manager → NovaBird-Conversation): *Einstellungen* (Quelle, Höchstzahl, Betreff-Regeln, Standardkopf, Original-Automatik) und *Aussehen* (Stil, Reihenfolge, Höhe, Aufklappen, Anhänge, Zitate, Animationen); Änderungen wirken sofort.

## Hinweise
Bunte Newsletter erscheinen bewusst schlicht (Mail-Stile werden nicht übernommen); „Original“ zeigt sie wie gewohnt. Tastatur und „als gelesen markieren“ bleiben bei den Betterbird-Standards.

Entwicklerinfo: [CLAUDE.md](CLAUDE.md).
