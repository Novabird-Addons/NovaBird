# Windows: breiter Rand um Menüs

Branch: `windows` · Getestet mit Thunderbird 153.4 unter Windows 11

## Symptom

Unter Windows lag um jedes Menü (Extras, Kontextmenüs) ein etwa 30 px breiter
Rand beziehungsweise Schatten. Unter Linux tritt das nicht auf.

## Ursache

Thunderbird zeichnet Menüs unter Windows in einem transparenten Fenster. Dessen
Inhalt hat `margin: var(--panel-box-shadow-margin)`, das Fenster selbst den
negativen Gegenwert (`toolkit/skin/classic/global/popup.css`). Dieser Rand ist
für den Schatten reserviert.

Die Themes setzten:

```css
--panel-box-shadow: 0 6px 22px rgba(...);
--panel-box-shadow-margin: 12px;
```

plus dasselbe `box-shadow` mit `!important` auf `menupopup::part(content)`.
Der Schatten (22 px Unschärfe, 6 px Versatz) passte nicht in den 12-px-Rand und
wurde hart abgeschnitten. Dazu kommt die Skalierung der Windows-Anzeige. Das
ergab den breiten, sichtbaren Rahmen. Unter Linux zeichnet GTK oder der
Compositor den Schatten, dort fällt der Rand nicht auf.

## Lösung

In allen drei Themes (`sand`, `cobalt`, `springlight`), jeweils in
`theme-light.css` und `theme-dark.css`:

```css
--panel-box-shadow: none;
--panel-box-shadow-margin: 0px;
...
menupopup:not([type="arrow"])::part(content) {
  box-shadow: none !important;
}
```

Es bleibt der 1-px-Rahmen mit den abgerundeten Ecken. `theme.css` wird wie
bisher mit `novabird-themes/tools/build-theme.py <thema>` aus den beiden
Quelldateien erzeugt.

Zwischenstand, der nicht gereicht hat: Schatten `0 2px 8px` mit 10 px Rand.
Der Rand blieb sichtbar, erst der Verzicht auf Rand und Schatten half.

## Versionen

| Theme | Vorher | Jetzt |
|---|---|---|
| `novabird-t-sand` | 1.0.0 | 1.0.1 |
| `novabird-t-cobalt` | 1.0.2 | 1.0.3 |
| `novabird-t-springlight` | 1.7.2 | 1.7.3 |

Die Extension (`novabird-extension`) ist unverändert (1.9.7).

## Zu prüfen unter Linux

- Menüs und Kontextmenüs sehen mit dem Fix noch richtig aus, also Rahmen,
  Rundung und Farben in hell und dunkel.
- Es fehlt kein Schatten, der unter Linux bisher sichtbar war. Falls doch,
  den Schatten nur per `@media (-moz-platform: linux)` wieder einführen, damit
  Windows unverändert bleibt.
- Getestet wurde unter Windows nur mit `sand` per Hand. `cobalt` und
  `springlight` haben dieselbe Änderung, wurden aber noch nicht visuell
  geprüft.
