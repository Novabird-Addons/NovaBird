# NovaBird-Send

Verzögertes Senden mit Rückgängig-Overlay für **Betterbird** / Thunderbird ESR (ab 128). Version 1.0.2 · Deutsch, English, Français, Español · passt sich dem Theme an.

![Overlay hell](docs/overlay-hell.svg)

## Funktionen
- Nach „Senden“ verschwindet das Verfassen-Fenster, unten im Hauptfenster läuft ein Countdown (Standard 10 s, 3–60 s).
- **Rückgängig** holt das Fenster unverändert zurück (Anhänge, Zitat, Signatur bleiben). **Jetzt senden** überspringt die Wartezeit.
- **Warteschlange** für mehrere Mails nacheinander:

  ![Warteschlange](docs/overlay-warteschlange.svg)

- **Beenden** mit wartenden Mails: sie werden als Entwurf gespeichert, ein laufender Versand wird abgewartet.
- **Fehler** (Versand, Verbindung, 20 s Hänger): das Fenster kommt zurück, dazu ein Hinweis (abschaltbar). Kein Eingriff bei „Später senden“ und offline.
- **Theme-Farben** mit Lesbarkeitsprüfung, auch dunkel:

  ![Overlay dunkel](docs/overlay-dunkel.svg)

## Installation und Einstellungen
`novabird-send-<Version>.xpi` im Add-ons-Manager („Add-on aus Datei installieren“). Nur Betterbird / Thunderbird ESR (Experiment-API). Einstellungen (Add-ons-Manager → NovaBird-Send): Wartezeit, Hinweise, Größe, Position, Zeitbalken (Höhe, Stil), Farben (Theme oder eigene), Ton von „Rückgängig“ – mit Live-Vorschau.

*Die Bilder sind gezeichnete Darstellungen, keine Bildschirmfotos.*

