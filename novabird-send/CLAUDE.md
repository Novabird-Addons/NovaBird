# NovaBird-Send – Projektkontext für Claude Code

Add-on für Betterbird / Thunderbird ESR (MV2, Experiment-API `undoOverlay`, ID `novabird-send@novabird`, ab Version 128): **verzögertes Senden mit Rückgängig-Overlay**. Früher „Sende-Pilot“ (`sende-pilot@local`). UI DE/EN/FR/ES (`_locales`, Standardsprache `en`). Neue ID = neues Add-on (Einstellungen beginnen leer). Beschreibung für Nutzer: `README.md`. Keine Abhängigkeit zu anderen NovaBird-Add-ons, kein Netzwerk.
Berechtigungen: `compose`, `compose.send`, `compose.save`, `storage`, `tabs`.

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-send-<Version>.xpi` (Version aus `manifest.json`; Kandidaten `<Nummer>RC`). **Neue Dateien in `build.sh` ergänzen.** Bei jeder Änderung die Version erhöhen.
- **Unit-Tests:** `node --check background.js settings.js experiments/undoOverlay/implementation.js && node --test tests/*.test.js` (58: `background.test.js` mit nachgebauter API, `locales.test.js`, `locales4.test.js`). Die Experiment-API ist damit NICHT abgedeckt. Neue Texte immer in beiden Sprachen.
- **Rauchtest** im Labor `$NOVABIRD/Testlab/novabird-send/` (Port 3700, `README.md`): `pakete-holen.sh`, `PROF=prof-min ./startbb.sh`, `python3 smoke.py` (Add-on aktiv, Hintergrund gestartet, Experiment-API da, keine Fehler), `quit.py idle`. Verfassen/Senden/Overlay/Warteschlange sind **nicht headless getestet**: Handtest.
- **Pflicht vor jeder Freigabe:** Unit-Tests, `smoke.py`, `permtest.sh` (Beenden mit fest installiertem Add-on, ≈ 1 s, kein FATAL/ABORT; das Experiment fängt `quit-application-requested` ab), Handtest.
- **Handtest (Flatpak):** `manifest.json` über „Temporäres Add-on laden“ scheitert (das Portal gibt nur die gewählte Datei frei, `schema.json` fehlt) → **immer das gebaute `.xpi` laden**; Änderungen in `experiments/` greifen oft erst nach Neustart. Nötig: `extensions.experiments.enabled` an, `xpinstall.signatures.required` aus; Fehlerkonsole Strg+Umschalt+J. Fälle: einzelne Mail senden/rückgängig/jetzt senden; drei Mails schnell hintereinander; Antwort mit Anhang rückgängig (Anhang + Zitat noch da?); Beenden während Countdown (Entwürfe da?); Versand ohne Netz (Fenster kommt zurück?); „Später senden“ unverändert.

## Verhalten
1. „Senden“ → Verfassen-Fenster wird versteckt (NICHT geschlossen: Anhänge, Antwort-Bezug, Identität, Signatur bleiben). 2. Overlay unten mittig im Hauptfenster: Status, Betreff, „Rückgängig“, „Jetzt senden“, Zeitbalken. 3. Nach Ablauf (Standard 10 s, 3–60 s) wird gesendet. 4. „Rückgängig“ → Fenster erscheint wie vorher. 5. Mehrere Mails: Warteschlange (FIFO), Countdown der nächsten startet erst nach der vorherigen; Overlay zeigt „n weitere“. 6. Beenden oder letztes Hauptfenster schließen mit wartenden Mails → alle als Entwurf speichern, dann Beenden fortsetzen. 7. Versandfehler/Verbindungsverlust → Fenster wieder sichtbar plus Hinweis mit OK-Button (abschaltbar); hängt der Versand 20 s, ebenfalls. Nicht abgefangen: „Später senden“ und offline (`Services.io.offline` oder Link-Status).

## Architektur
- `background.js`: Abfangen per `compose.onBeforeSend` (→ `{cancel: true}`), Warteschlange, Timer, Versand per `compose.sendMessage(tabId, {mode: "sendNow"})`, Freigabe über das `approved`-Set.
- `experiments/undoOverlay/` (privilegiert): Fenster verstecken/zeigen (`nsIBaseWindow.visibility`), Overlay im Hauptfenster (`messenger.xhtml`), Beenden und Schließen des letzten Hauptfensters abfangen.
- `_locales/{de,en}`: alle Texte; das Hintergrundskript holt sie per `i18n.getMessage` und gibt sie per `undoOverlay.setStrings` ans Experiment (`{n}` in `queued` = Anzahl).
- **Farben:** Standard sind die Theme-Farben des Ordnerbereichs (`--sidebar-background-color`, `--sidebar-text-color`, `--sidebar-border-color`; Akzent `--lwt-toolbarbutton-icon-fill-attention`, ersatzweise `--lwt-tab-line-color`). Das Experiment liest sie (`getThemeColors`), `resolvePalette` (settings.js) berechnet die Palette mit Lesbarkeitsprüfung (Schrift wechselt bei zu wenig Kontrast; Text auf Akzent/Rückgängig immer Weiß oder Fast-Schwarz), `setStyle` schickt sie. Alternativ eigene Farben (`colorMode: custom`); „Rückgängig“ standardmäßig sanft rot (`undoTone`); Theme wird vor jedem Countdown neu gelesen; die Optionsseite zeigt eine Live-Vorschau.
- `settings.js`: Standardwerte und `sanitizeSettings`. `options/`: Einstellungen in `storage.local` (`delay`, `showNotices`, `size`, `horizontal`, `bottom`, `barHeight`, `barStyle` soft|classic); Änderungen wirken sofort (`storage.onChanged` → `setStyle`).

## Bewusste Entscheidungen (nicht erneut vorschlagen)
- Kein Tastenkürzel (Strg+Alt+Z zu umständlich; Strg+Z/U/R sind belegt).
- Kein „offline → lokaler Entwurf“: Offline und „Später senden“ verhalten sich wie ohne Add-on.
- Beenden während Countdown: nur Rückgängig oder Senden; das Add-on speichert zurückgehaltene Mails beim Beenden trotzdem als Entwurf. X im Hauptfenster schickt Betterbird in den Tray, nichts geht verloren.
- Optik: Theme-Farben, Rückgängig sanft rot, Zeitbalken 10 px, 10 % Abstand von unten; alles einstellbar.

## Offen / zu prüfen
Verstecken per `nsIBaseWindow.visibility` unter Windows testen (Fallback: minimieren + verschieben); Reihenfolge der `quit-application-requested`-Observer (Verfassen-Fenster fragen sonst evtl. selbst „Speichern?“; Ziel: Entwurf ohne Rückfrage); Schließen des letzten Hauptfensters per X; Beenden während laufendem Versand (`sending === true`: auf Abschluss warten); weitere Themes prüfen; ATN-Veröffentlichung.
