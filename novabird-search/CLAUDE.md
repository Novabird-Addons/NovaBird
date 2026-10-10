# NovaBird-Search – Projektkontext

Betterbird/Thunderbird-ESR-Add-on (MV2, Experiment `searchBar`, ID `novabird-search@novabird`, ab 128): EINE Suchleiste statt globaler Suche + Schnellfilter in der Kopfzeile der Nachrichtenliste. UI DE/EN/FR/ES; Kurzschreibweise auch fr/es/en (`de:`, `à:`, `para:`, `objet:`, `asunto:`, `from:` …), Freitext-Sätze versteht NovaBird-DB je nach „Suchsprachen“. Früher „Such-Pilot“. Nutzerbeschreibung: `README.md`.

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-search-<Version>.xpi` (Kandidaten `RCn`; Endnummer nur der Maintainer).
- Unit-Tests `node --test tests/*.test.js` (29). `parser.js` ist rein, neue Fälle zuerst als Test. Neue Texte in alle `_locales` (sonst schlägt `locales*.test.js` an).
- Labor `$NOVABIRD/Testlab/novabird-search/` (Port 3600, `README.md`): `pakete-holen.sh` (Search + DB als Gegenstelle), `PROF=prof-syn ./startbb.sh` (20K erfundene Mails, Index fertig), `regress.py` (9 Prüfungen), `quit.py idle`; weitere `shots.py`, `hist.py`, `typo.py`, `rc3.py`, `mr3.py`, `win.py`.
- **Vor Freigabe:** Unit-Tests, `regress.py`, `permtest.sh` (Beenden mit fest installierten Add-ons + DB, ≈ 1 s, kein FATAL/ABORT).
- Marionette: Chrome-Kontext; Leiste = `#novabird-search` im `contentDocument` des Tab-Browsers (`root._nbsId`); Screenshots per `WebDriver:TakeScreenshot` (vorher `resizeTo(1366,900)`); `tab.chromeBrowser` fehlt beim Öffnen oft noch.

## Abhängigkeiten
- Betterbird 153 ESR / TB ESR ≥ 128. Rechte: `accountsRead, messagesRead, storage, tabs, menus, messagesUpdate, messagesTags, messagesTagsList`. Kein Netzwerk.
- **NovaBird-DB (`novabird-db@novabird`), optional, Normalweg**, per `runtime.sendMessage`:
  - `{type:"ping"}` (Zeitlimit 1,5 s, 5 s gecacht): genutzt nur bei `ok && usable && !broken` und `api ≥ 1` (`REQUIRED_DB_API`); sonst Hinweis in der Leiste und Rückfall auf Gloda (≤ 20.000 Treffer, keine Relevanz, kein „Meinten Sie“).
  - `{type:"search", text, limit (≤ 1.000.000), includeTrash, folderId?, fields:[from,to,subject,body], sort:"date"|"relevance"}` → `{ok, rows:[{header_msg_id, folder_id, date}], suggest}`; Search löst Kopfzeilen selbst auf.
  - Die DB lässt Search alle externen Befehle zu (`ALLOWED_EXTERNAL` in `novabird-db/background.js`); bei ID-Änderung dort nachziehen. Einstellung `novabirdDb` = `auto`|`off`.
- „Alle Ordner“ ohne DB nutzt zusätzlich die Kopfzeilen-Suche über den virtuellen Ordner „Suchergebnisse“ (alle Fenster teilen ihn: bekannte Grenze).

## Funktionsumfang
Leiste: Bereich (Alle/Aktueller Ordner), Eingabe, ✕, Zahnrad-Menü (Von/An/Betreff/Nachricht, Anhang, ungelesen, Papierkorb, Spam, Einstellungen), Zeitfenster-Chips. Live-Treffer in der normalen Liste (flach, **strikt nach Datum**), Mindestlänge 3 (Enter erzwingt), Kurzschreibweise (`von: an: betreff: text: anh:ja seit: bis: ungelesen markiert hier`), „Meinten Sie“, Verlauf (20, 10 sichtbar), Enter-Rückfrage Filtern (Treffer-Tab) / Auswerten (Analyse: Zeitleiste, Filter, Vorschau), gemeinsame Ordner oben (Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage; Rechtsklick „Alle als gelesen markieren“), Mehrfenster (`nbs1`, `nbs2` …, Zustand je Fenster), Strg+K, Theme-Farben. Papierkorb/Spam standardmäßig ausgenommen.

## Architektur
- `settings.js` (Defaults, `sanitizeSettings`; Schlüssel `enterMode ask|snapshot|analysis|off`, `group`, `sharedFolders`, `sharedInboxMonths`, `glodaLimit`, `sortMode`, `novabirdDb`; `storage.local` `settings` + `searchHistory`), `parser.js` (`parseQuery`, `isTooShort`), `background.js` (je Leiste ein Controller `getCtl(barId)`; `runSearch`: Parser → DB → `idSearch`/`showHeaders`, sonst Kopfzeilen-Suche + `scheduleGloda`; Status, `refineSnapshot`, `openAnalysis`, Verlauf, `syncSharedFolders`, `init`).
- `experiments/searchBar/implementation.js` (≈ 2200 Zeilen) + `schema.json`: baut die Leiste in `about:3pane` (`root._nbsId`, `root._nbsState`), blendet die native aus; Treffer-Tab (`data-refine`), Analyse (`describeHits`, `openPage`), Sammelordner (sticky), Theme-Farben `--nbs-*`, `DEBUG`-Log (`novabird-search-debug.log`; vor Freigabe `DEBUG = false`).
- `analysis/`, `options/`, `_locales/`, `icons/`, `tests/`.

## Stolpersteine
- **Experiment-Schema:** weggelassene optionale Zeichenketten rutschen auf die LETZTEN Parameter: immer alle übergeben (`showNote(ctl, text, tip, kind)`).
- Pro Leiste ein Controller; leistenbezogene Funktionen haben `barId` als ersten Parameter; unbekannte Kennung = nichts tun; nie `getMostRecentWindow` als Ziel.
- Neue Tabs/Fenster laden spät: `injectWhenReady`/`retryTabs` (bis 10 s). Synthetische Ansicht verlassen: `leaveSyntheticView(cw)` (`folderPane._onSelect()` bricht dort ab).
- Virtuelle Ordner: `wrapper.searchFolders = "*"` wirft → `dBFolderInfo.setCharProperty("searchFolderUri","*")`; Ordnermodi in `folderPane._modes`; `mode.active` erst nach `init()`; `folder.markMessagesRead(Array, true)` braucht ein JS-Array.
- Sammelordner-Zeilen (sticky) holen ihren Hintergrund von der Farbe des **Ordnerbaums** (`#folderTree`, nicht der Liste); Neuberechnung beim Start (0,7 s/3 s) und bei Theme-/Hell-Dunkel-Wechsel (`matchMedia`, `MutationObserver`, `cw._nbsSharedApply`). Prüfen mit Cobalt dunkel, frischer Start.
- CSS: `.nbs-field` braucht `flex: none`; Sammelordner-Liste braucht `overflow: visible`, `#folderTree::before` ausblenden.
- `messenger.tabs.create` für Extension-Seiten hatte kein `messenger` → `openPage` (contentTab im Experiment). `hdr.date` in Mikrosekunden. „messages.listTags() deprecated“ ist harmlos.
- Nicht getestet: echtes Profil (IMAP, Mehrkonten), >2 Hauptfenster, Rückfall bei gleichzeitiger Suche mehrerer Fenster ohne DB, „Alle als gelesen markieren“ bei IMAP. Offen: Tab-Titel „Suchergebnisse“ nicht übersetzt.

## Lizenz und Ideen
„Expression Search NG“ (GPLv3) nur Ideenquelle: **keinen Code übernehmen** (Repo ist MIT). Ideen: Wortmitte in der Volltextsuche, erweiterte Suchsprache (Verneinung, und/oder/Klammern, `cc/bcc`, Größe, `tag`, `dateiname`), Mouseover-Vorschau, KI-Suche, Selbsttest für ESR-Updates, Zusammenführen mit NovaBird-DB, MV3.
