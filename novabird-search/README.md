# NovaBird-Search

Eine Suchleiste statt zwei für **Betterbird** / Thunderbird ESR (ab 128): ersetzt globale Suche und Schnellfilter durch **ein Feld in der Kopfzeile der Nachrichtenliste**. Version 1.2.4 · Deutsch, English, Français, Español.

## Funktionen
- **Treffer beim Tippen** in der normalen Nachrichtenliste, flach und **strikt nach Datum** (neueste zuerst). Bereich links im Feld: *Alle Ordner* oder *Aktueller Ordner*.
- **Zahnrad-Menü:** Von / An / Betreff / Nachricht, Mit Anhang, Nur ungelesen, Papierkorb, Spam. **Zeitfenster-Chips:** Alle, Heute, 3, 7, 30 Tage.
- **Kurzschreibweise:** `von:` `an:` `betreff:` `text:` `anh:ja` `seit:7t` `bis:` `ungelesen` `markiert` `hier` (auch `from:`/`to:`, `de:`/`à:`/`objet:`, `para:`/`asunto:` …); Datum als 2026-01-31, 31.01.2026 oder relativ (7t, 3w, 6m, 1j). Mit NovaBird-DB auch Sätze wie „Rechnungen von Petra aus den letzten 6 Monaten“.
- **„Meinten Sie …?“** bei 0 Treffern, **Suchverlauf** (einzeln löschbar), **Strg+K** springt ins Feld.
- **Enter** fragt (merkbar): *Filtern* (Treffer in neuem Tab, dort weiter eingrenzen) oder *Auswerten* (Analyseseite mit Zeitleiste, Filtern und Vorschau).
- **Gemeinsame Ordner:** Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage; Rechtsklick „Alle als gelesen markieren“.
- **Mehrere Hauptfenster** (je Fenster eigene Suche), Farben folgen dem Theme (hell/dunkel).

## Mit NovaBird-DB
Ohne [NovaBird-DB](../novabird-db/) sucht die Leiste über Gloda (Betterbirds Index): kleinere Treffermenge, keine Relevanz, kein „Meinten Sie“, und es erscheint ein Hinweis. Mit NovaBird-DB läuft der Volltext über alle Konten und Ordner in Sekundenbruchteilen.

## Installation und Einstellungen
`novabird-search-<Version>.xpi` im Add-ons-Manager (Zahnrad → „Add-on aus Datei installieren“). Nur Betterbird / Thunderbird ESR (Experiment-API), nicht der monatliche Release-Kanal. Einstellungen (Add-ons-Manager → NovaBird-Search): Höchstzahl der Treffer, Enter-Verhalten, NovaBird-DB an/aus, gemeinsame Ordner, Sortierung (Relevanz: experimentell).

Entwicklerinfo: [CLAUDE.md](CLAUDE.md).
