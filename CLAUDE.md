# NovaBird – Projektkontext für Claude Code (Wurzel des Repos)

Monorepo mit sechs Gruppen von Betterbird-Add-ons (siehe `README.md`). Jedes Add-on hat eine eigene `CLAUDE.md` (Ordner, Architektur, Bauen, Tests, Stolpersteine): **zuerst die des Add-ons lesen, an dem du arbeitest.**

## Layout
`novabird-search/`, `novabird-db/`, `novabird-conversation/`, `novabird-send/`, `novabird-extension/`, `novabird-themes/{novabird-t-sand,novabird-t-cobalt,novabird-t-springlight,tools}/`. Pakete (`*.xpi`), `node_modules`, Testprofile und Testdaten gehören **nicht** ins Repo (`.gitignore`).
Namensmuster: Ordner `novabird-<name>`, Add-on-ID `<ordner>@novabird`, Anzeigename `NovaBird-<Name>`; Themes `novabird-t-<name>@novabird`. Die Pfade `$NOVABIRD/Release/Kandidaten/` und `$NOVABIRD/Testlab/` in den add-on-eigenen Anleitungen meinen einen lokalen Arbeitsordner außerhalb des Repos (`$NOVABIRD` = Elternordner von `Source/`).

## Gemeinsame Regeln
- Jede Änderung: Version in `manifest.json` erhöhen; Kandidaten tragen `RC`. Keine Freigabe ohne ausdrückliches Wort des Maintainers; Endnummern vergibt er.
- Vor einer Freigabe: Unit-Tests, die Tests des Add-ons im Labor und der **Beenden-Test mit fest installierten Add-ons** (temporär geladene Add-ons verstecken Beenden-Fehler; Erwartung: Beenden in 1–2 s, kein FATAL/ABORT).
- Neue Texte immer in allen vier Sprachen (DE, EN, FR, ES; `default_locale` = en); die Tests `tests/locales*.test.js` prüfen Schlüssel und Platzhalter. Optionsseiten brauchen für jede Option eine kurze Erklärung, bei sichtbarer Wirkung eine kleine Skizze (inline SVG, `currentColor`).
- Tests im echten Betterbird nur mit erfundenen Mails; nie im Profil des Nutzers; nur die eigene Testinstanz beenden, nie `pkill`/`killall betterbird`.
- Keine Persönliches ins Repo: keine echten Namen, Adressen, Pfade oder Profilnamen, keine Beispiele aus dem Arbeitsumfeld des Maintainers. Vor jedem Commit nach Benutzernamen, Profilordnernamen, Firmen- und Domänennamen des Maintainers und nach absoluten Pfaden des Heimatverzeichnisses suchen (die konkrete Suchliste steht in der lokalen, nicht versionierten Anleitung des Maintainers).
- Nach Änderungen an einer Schnittstelle die `CLAUDE.md` beider Seiten und die Kompatibilitätstabelle unten mitziehen.

## Schnittstellen und Kopplungen
| Von → An | Weg | Wo geregelt |
|---|---|---|
| Search → DB | `runtime.sendMessage(novabird-db@novabird, {type:"ping"\|"search"…})`, Version/`api ≥ 1`, Status-Push der DB | `novabird-db/CLAUDE.md` (Clients, `ALLOWED_EXTERNAL`) |
| Conversation → DB | `ping`, `conversation` (nur diese zwei sind erlaubt), Status-Push `{type:"status", usable, version, api, broken}` | dieselbe Rechteliste; `novabird-conversation/CLAUDE.md` |
| Extension → Conversation | DOM-Klassen `.nbc-chip`, `.nbc-card`, `.nbc-name` (Anhang-Vorschau) | beide `CLAUDE.md` |
| Extension → Themes | Standard-Theme-Variablen (`--toolbar-*`, `--sidebar-*` …), keine IDs | `novabird-themes/CLAUDE.md` |
| Extension → alle NovaBird-Add-ons | Einstellungen-Seite „NovaBird“ (`settingsRedesign`): bettet die Optionsseite (`options_ui.page`) jedes aktiven `novabird-*@novabird` per iframe als Reiter ein; keine Abhängigkeit, fehlende Add-ons fehlen einfach | `novabird-extension/CLAUDE.md` |
| Send → Themes | Theme-Farben des Ordnerbereichs werden für das Overlay übernommen | `novabird-send/CLAUDE.md` |

## Kompatibilität (Stand der Kandidaten)
| Add-on | Version | braucht | min. Betterbird |
|---|---|---|---|
| NovaBird-Search | 1.2.5 | optional NovaBird-DB `api ≥ 1` | 128 |
| NovaBird-DB | 1.2.0 | – (Clients: Search, Conversation) | 128 |
| NovaBird-Conversation | 0.14.0 | optional NovaBird-DB `api ≥ 1` | 128 |
| NovaBird-Send | 1.0.2 | – | 128 |
| NovaBird-Extension | 1.9.4 | – (nutzt Conversation-DOM und Theme-Variablen, wenn vorhanden) | 128 |
| NovaBird-Sand / -Cobalt / -Springlight | 1.0.0 / 1.0.2 / 1.7.2 | – | 128 / 115 / 115 |
Nie gleichzeitig installieren: ein altes Add-on mit alter ID (Such-Pilot, DB-Pilot, Sende-Pilot, Conversation-Pilot, Stream Extension/Themes, Kalender-/Kontakt-Pilot) zusammen mit dem neuen.

## Startseite und Dokumente
`README.md` (englisch, GitHub-Startseite mit Bildern aus `docs/images/`), `README.de.md`, `HANDBOOK.md` (englisch) und `HANDBUCH.md` (deutsch) mitpflegen: Versionen und Funktionen bei jeder Freigabe angleichen. Screenshots nur mit erfundenen Demo-Daten (Labor siehe lokale Anleitung des Maintainers), nie echte Mails.
