# NovaBird-Themes – Projektkontext für Claude Code

Drei WebExtension-Themes für Betterbird / Thunderbird ESR (MV2, `theme_experiment`-Stylesheet, Hell und Dunkel in einem Theme):

| Ordner | ID | Anzeige | Charakter |
|---|---|---|---|
| `novabird-t-sand/` (**Referenz**) | `novabird-t-sand@novabird` | NovaBird-Sand | warmes Grau, Blau `#2a61c7` nur als Akzent |
| `novabird-t-cobalt/` | `novabird-t-cobalt@novabird` | NovaBird-Cobalt | blau, kräftige Kontraste, marineblaue Zähler, dunkle Schrift für Ungelesenes (früher „Kobalt“) |
| `novabird-t-springlight/` | `novabird-t-springlight@novabird` | NovaBird-Springlight | neutral hell mit Blau `#419bf9`, dunkle Schrift `#0b2a4d` auf dem Akzent, graphit Dunkel |

Früher „Stream Sand/Kobalt/Springlight“ (`stream-*@themes.local`). Alte Themes vor der Installation entfernen (neue ID = neues Theme).

## Ordner und Bauen
- Quelle: `theme-light.css` und `theme-dark.css` je Theme **von Hand pflegen**; `theme.css` wird erzeugt (`tools/build-theme.py`: Hell + `@media (prefers-color-scheme: dark){…}`), nie von Hand ändern. Dunkel testen: Pref `ui.systemUsesDarkTheme` = 1 (0 hell).
- Build: `tools/pack-theme.sh novabird-t-sand|novabird-t-cobalt|novabird-t-springlight` → `../../Release/Kandidaten/<ordner>-<Version>.xpi` (Kandidaten tragen `RC`; Freigabe nach `../../Release/` nur auf Wort des Nutzers). Bei jeder Änderung die Version in `manifest.json` erhöhen.
- `tools/recolor.py`: Farbumrechnung (OKLCH), `contrast()` prüft WCAG; Ziele: Text ≥ 4,5:1, Hauptknopf ≥ 4,5:1, Symbole ≥ 3:1. Die einmaligen Umbauskripte (`make-*.py`, `transfer.py`) sind nicht übernommen (im Archiv).
- Test: Labor `../../Testlab/novabird-themes/` (Port 3900, `README.md`): `themetest.py`, `permtest.sh`.

## Arbeitsweise
- **Anpassungen immer nur an EINEM Theme** (Referenz Sand). Erst wenn der Nutzer es gut findet, von Hand auf Cobalt, dann Springlight übertragen (Farben umrechnen). Nie parallel an mehreren bauen.
- Neue Texte in DE/EN/FR/ES (`_locales/<sprache>/messages.json`, `default_locale` = en).

## Abhängigkeit zur NovaBird-Extension
- Ein Theme kann nur Farben und Stylesheets liefern, kein JS und keine Dialogfenster. Die **Extension** (`../novabird-extension/`) gestaltet, was ein Theme nicht erreicht: Termin-Dialoge, Einstellungen, Konten, Add-ons-Manager, Verfassen-Feinschliff, rechte Leiste, Kontakt-Tab. Sie liest dafür die **Standard-Variablen des aktiven Themes** aus dem Hauptfenster (`--toolbar-bgcolor`, `--toolbar-color`, `--sidebar-*`, `--lwt-tab-line-color` …, also die `theme.colors` im Manifest) und leitet daraus ihre `--tbsr-*`-Palette ab. Es gibt **keine ID-Kopplung**: Extension und Themes funktionieren auch einzeln (ohne Extension bleiben Dialogfenster und Einstellungsseiten im Standardstil; ohne Theme nutzt die Extension eigene Farben).
- Folge: Ändert ein Theme die Manifest-Farben (frame, toolbar, tab_line …), ändert sich die Palette der Extension mit. Neue Farbvariablen im Theme-CSS sind für die Extension unsichtbar, außer sie stehen in der `pick()`-Liste in `settingsRedesign/implementation.js`.
- Umgekehrt zeigt das Theme-CSS nichts von der Extension; Namen der Extension (`nbx-*`, `.sa-row`) kommen im Theme-CSS nicht vor.

## Technische Erkenntnisse
- Theme-CSS greift im Hauptfenster und in Tab-Dokumenten (Adressbuch, Kalender). Variablen in `:root:root:root:root` setzen, damit sie Thunderbirds Regeln schlagen; Elemente mit Schattendokument (`contact-avatar`, `calendar-minimonth`) bekommen Variablen am Element; Iframe-Wurzeln brauchen `html#id:root`.
- Grundpalette aus `--layout-background-0..4`, `--layout-color-*`, `--layout-border-*`. Verfassen-Fenster lädt keine `data:`-SVGs → Theme-Icons dort nur als `chrome://messenger/skin/icons/new/compact/*.svg`.
- Selektor für Add-on-Symbole: `:root:root:root:root .spaces-addon-button > img`; Symbole anderer Add-ons sind einfarbig in Leistenfarbe, vollfarbige Logos werden zur Silhouette.
- Kontaktseite: `#detailsActions button.icon-button` mit `padding-inline-start: 32px`.
- Kartenansicht der Nachrichtenliste: Höhe fest → nur `padding-inline` setzen; ausgewählte Karte: `.card-container` durchsichtig, Zeile in `--ms-accent-soft`, dunkle Schrift (≥ 10:1); Cobalt braucht zusätzlich `#threadTree:focus-within tbody tr[is="thread-card"].selected :is(.sender, .correspondent) { color: var(--ms-text) !important }`.
- Schriftgrößen sind schon relativ (`em`/`rem`).
- Offen: Farbeinstellungsseite (benannte Farbvariablen, Einstellungen in der Extension); Sand-Hell zeigt im Headless-Test auf der Startseite keine Symbole in den Kontenknöpfen (Cobalt-Dunkel schon) – im echten Betterbird prüfen.
