# NovaBird-Themes – Projektkontext

Drei WebExtension-Themes für Betterbird/TB-ESR (MV2, `theme_experiment`-Stylesheet, Hell und Dunkel in einem Theme):
| Ordner | ID | Charakter |
|---|---|---|
| `novabird-t-sand/` (**Referenz**) | `novabird-t-sand@novabird` | warmes Grau, Blau `#2a61c7` nur als Akzent |
| `novabird-t-cobalt/` | `novabird-t-cobalt@novabird` | blau, kräftige Kontraste, marineblaue Zähler, dunkle Schrift für Ungelesenes |
| `novabird-t-springlight/` | `novabird-t-springlight@novabird` | neutral hell, Blau `#419bf9`, dunkle Schrift `#0b2a4d` auf Akzent, graphit Dunkel |
Früher „Stream Sand/Kobalt/Springlight“ (`stream-*@themes.local`); alte Themes vor der Installation entfernen.

## Bauen und Testen
- Quelle: `theme-light.css` und `theme-dark.css` je Theme **von Hand pflegen**; `theme.css` wird erzeugt (`tools/build-theme.py`: Hell + `@media (prefers-color-scheme: dark)`), nie von Hand ändern. Dunkel testen: Pref `ui.systemUsesDarkTheme` = 1 (0 hell).
- `tools/pack-theme.sh novabird-t-sand|novabird-t-cobalt|novabird-t-springlight` → `../../Release/Kandidaten/<ordner>-<Version>.xpi` (Kandidaten `RC`; Freigabe nur auf Wort des Nutzers; bei jeder Änderung Version in `manifest.json` erhöhen).
- `tools/recolor.py`: OKLCH-Umrechnung, `contrast()` (WCAG): Text ≥ 4,5:1, Hauptknopf ≥ 4,5:1, Symbole ≥ 3:1.
- Test: Labor `../../Testlab/novabird-themes/` (Port 3900, `README.md`): `themetest.py`, `permtest.sh`.

## Arbeitsweise
**Anpassungen immer nur an EINEM Theme** (Referenz Sand); erst nach Zustimmung des Nutzers von Hand auf Cobalt, dann Springlight übertragen (Farben umrechnen). Nie parallel. Neue Texte in DE/EN/FR/ES (`_locales/<sprache>/messages.json`, `default_locale` en).

## Zusammenspiel mit der NovaBird-Extension
Ein Theme liefert nur Farben/Stylesheets, kein JS und keine Dialogfenster. Die **Extension** gestaltet den Rest (Termin-Dialoge, Einstellungen, Konten, Add-ons-Manager, Verfassen, rechte Leiste, Kontakt-Tab) und liest dafür die **Standard-Variablen des aktiven Themes** (`--toolbar-bgcolor`, `--toolbar-color`, `--sidebar-*`, `--lwt-tab-line-color` …, also `theme.colors` im Manifest) → ihre `--tbsr-*`-Palette. **Keine ID-Kopplung**; jedes funktioniert auch allein. Ändert ein Theme Manifest-Farben, ändert sich die Extension-Palette mit; neue Variablen im Theme-CSS sind für sie unsichtbar, außer in der `pick()`-Liste in `settingsRedesign/implementation.js`. Namen der Extension (`nbx-*`, `.sa-row`) kommen im Theme-CSS nicht vor.

## Technische Erkenntnisse
- Theme-CSS greift im Hauptfenster und in Tab-Dokumenten (Adressbuch, Kalender). Variablen in `:root:root:root:root` setzen (schlägt Thunderbirds Regeln); Elemente mit Schattendokument (`contact-avatar`, `calendar-minimonth`) bekommen Variablen am Element; Iframe-Wurzeln brauchen `html#id:root`.
- Grundpalette aus `--layout-background-0..4`, `--layout-color-*`, `--layout-border-*`. Verfassen-Fenster lädt keine `data:`-SVGs → Icons dort nur als `chrome://messenger/skin/icons/new/compact/*.svg`.
- Add-on-Symbole: `:root:root:root:root .spaces-addon-button > img`; fremde Symbole sind einfarbig in Leistenfarbe, vollfarbige Logos werden zur Silhouette. Kontaktseite: `#detailsActions button.icon-button` mit `padding-inline-start: 32px`.
- Kartenansicht der Nachrichtenliste: Höhe fest → nur `padding-inline`; ausgewählte Karte: `.card-container` durchsichtig, Zeile in `--ms-accent-soft`, dunkle Schrift (≥ 10:1); Cobalt zusätzlich `#threadTree:focus-within tbody tr[is="thread-card"].selected :is(.sender, .correspondent) { color: var(--ms-text) !important }`.
- Schriftgrößen sind schon relativ (`em`/`rem`).
- Offen: Farbeinstellungsseite (benannte Farbvariablen in der Extension); Sand-Hell zeigt im Headless-Test auf der Startseite keine Symbole in den Kontenknöpfen (Cobalt-Dunkel schon) – im echten Betterbird prüfen.
