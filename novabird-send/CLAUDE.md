# NovaBird-Send – Projektkontext

Betterbird/TB-ESR-Add-on (MV2, Experiment `undoOverlay`, ID `novabird-send@novabird`, ab 128): **verzögertes Senden mit Rückgängig-Overlay**. Früher „Sende-Pilot“. UI DE/EN/FR/ES (`_locales`, Standard `en`). Rechte: `compose`, `compose.send`, `compose.save`, `storage`, `tabs`. Keine Abhängigkeit zu anderen Add-ons, kein Netzwerk. Nutzerbeschreibung: `README.md`.

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-send-<Version>.xpi` (Kandidaten `<Nr>RC`). **Neue Dateien in `build.sh` ergänzen**; bei jeder Änderung Version erhöhen.
- Unit-Tests: `node --check background.js settings.js experiments/undoOverlay/implementation.js && node --test tests/*.test.js` (58; Experiment-API NICHT abgedeckt). Neue Texte in alle `_locales`.
- Rauchtest Labor `$NOVABIRD/Testlab/novabird-send/` (Port 3700, `README.md`): `pakete-holen.sh`, `PROF=prof-min ./startbb.sh`, `smoke.py`, `quit.py idle`. Verfassen/Senden/Overlay/Warteschlange **nicht headless**: Handtest.
- **Vor Freigabe:** Unit-Tests, `smoke.py`, `permtest.sh` (Beenden fest installiert ≈ 1 s, kein FATAL/ABORT; das Experiment fängt `quit-application-requested` ab), Handtest.
- Handtest (Flatpak): `manifest.json` als temporäres Add-on scheitert (Portal gibt nur die Datei frei, `schema.json` fehlt) → **immer das `.xpi`** laden; `experiments/`-Änderungen greifen oft erst nach Neustart. Nötig: `extensions.experiments.enabled` an, `xpinstall.signatures.required` aus; Konsole Strg+Umschalt+J. Fälle: einzeln senden/rückgängig/jetzt senden; drei Mails schnell nacheinander; Antwort mit Anhang rückgängig; Beenden im Countdown (Entwürfe da?); Versand ohne Netz (Fenster kommt zurück?); „Später senden“ unverändert.

## Verhalten
„Senden“ → Verfassen-Fenster wird versteckt (NICHT geschlossen: Anhänge, Bezug, Identität, Signatur bleiben) → Overlay unten mittig im Hauptfenster (Status, Betreff, „Rückgängig“, „Jetzt senden“, Zeitbalken) → nach Ablauf (Standard 10 s, 3–60 s) wird gesendet; „Rückgängig“ zeigt das Fenster wieder. Mehrere Mails: FIFO-Warteschlange, nächster Countdown startet erst nach dem vorherigen („n weitere“). Beenden/letztes Hauptfenster schließen mit wartenden Mails → alle als Entwurf speichern, dann weiter. Versandfehler/Verbindungsverlust oder Hängen > 20 s → Fenster wieder sichtbar plus Hinweis mit OK (abschaltbar). Nicht abgefangen: „Später senden“ und offline.

## Architektur
- `background.js`: Abfangen per `compose.onBeforeSend` (`{cancel:true}`), Warteschlange, Timer, Versand `compose.sendMessage(tabId, {mode:"sendNow"})`, Freigabe über das `approved`-Set.
- `experiments/undoOverlay/`: Fenster verstecken/zeigen (`nsIBaseWindow.visibility`), Overlay im Hauptfenster, Beenden/Schließen abfangen. Texte per `i18n.getMessage` → `undoOverlay.setStrings` (`{n}` in `queued` = Anzahl).
- **Farben:** Standard = Theme-Farben des Ordnerbereichs (`--sidebar-background-color`, `--sidebar-text-color`, `--sidebar-border-color`; Akzent `--lwt-toolbarbutton-icon-fill-attention`, ersatzweise `--lwt-tab-line-color`), gelesen per `getThemeColors`; `resolvePalette` (settings.js) prüft Lesbarkeit (Text auf Akzent/Rückgängig immer Weiß oder Fast-Schwarz); `setStyle` schickt sie, Theme wird vor jedem Countdown neu gelesen. Alternativ `colorMode: custom`; „Rückgängig“ sanft rot (`undoTone`).
- `settings.js` (Defaults, `sanitizeSettings`), `options/` (Live-Vorschau): `storage.local` `delay`, `showNotices`, `size`, `horizontal`, `bottom`, `barHeight`, `barStyle soft|classic`; wirkt sofort über `storage.onChanged` → `setStyle`.

## Bewusste Entscheidungen (nicht erneut vorschlagen)
Kein Tastenkürzel (Strg+Alt+Z zu umständlich; Strg+Z/U/R belegt). Kein „offline → lokaler Entwurf“. Beenden im Countdown: nur Rückgängig oder Senden, zurückgehaltene Mails werden trotzdem als Entwurf gespeichert; X im Hauptfenster schickt Betterbird in den Tray. Optik: Theme-Farben, Rückgängig sanft rot, Zeitbalken 10 px, 10 % Abstand unten; alles einstellbar.

## Offen / zu prüfen
Verstecken per `nsIBaseWindow.visibility` unter Windows (Fallback minimieren + verschieben); Reihenfolge der `quit-application-requested`-Observer (Verfassen-Fenster fragen sonst evtl. „Speichern?“; Ziel: Entwurf ohne Rückfrage); Schließen des letzten Hauptfensters per X; Beenden während laufendem Versand (`sending === true`: auf Abschluss warten); weitere Themes; ATN-Veröffentlichung.
