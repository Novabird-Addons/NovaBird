# NovaBird-Designs (Themes in der Extension)

Drei Designs für **Betterbird** / Thunderbird ESR, jeweils hell und dunkel (folgt dem Modus des Betriebssystems). Bis 1.x waren es eigene Theme-Add-ons (`novabird-t-<name>@novabird`); ab NovaBird-Extension 2.0 stecken sie in der Extension.

| Design | Charakter | Stand |
|---|---|---|
| **Sand** | ruhig, warme Grautöne, Blau nur als Akzent | 1.0.1 |
| **Cobalt** | kompakt, kräftiges Blau, starke Kontraste | 1.0.3 |
| **Springlight** | neutral hell mit frischem Blau, graphit im Dunkel | 1.7.3 |

Kontraste sind geprüft (Text ≥ 4,5 : 1, Symbole ≥ 3 : 1). Die Designs stylen die Hauptansichten (Mail inkl. Kartenansicht, Kalender, Adressbuch, Einstellungen). Die Farben des Hauptfensters lassen sich unter „Farben und Schrift“ anpassen (mit Cobalt und Springlight, die die Variablen `--ms-*` setzen).

## Auswahl
Einstellungen der Extension → **Farben und Schrift** → **Design**. „Thunderbird-Theme“ lässt das Theme aus dem Add-ons-Manager wirken. Das Experiment `novaTheme` setzt das gewählte Design wie ein installiertes Theme (Farben hell und dunkel, eigenes Stylesheet); neue Fenster übernehmen es.

Umstieg von 1.x: War eines der alten Theme-Add-ons aktiv, wählt die Extension beim ersten Start dasselbe Design und entfernt die alten Theme-Add-ons.

## Dateien
- `<name>/theme.json`: Farben hell (`theme`) und dunkel (`dark_theme`), wie früher im Manifest des Theme-Add-ons.
- `<name>/theme-light.css`, `<name>/theme-dark.css`: Quellen; `<name>/theme.css` wird daraus gebaut (`themes/tools/build-theme.py <name>`, ruft `build.sh` der Extension vor dem Packen auf).
- `tools/recolor.py`: Farbumrechnung (OKLCH) für die Quellen.
- `sand/icons/`: Quellen der Symbole (im Stylesheet als data:-URLs).
