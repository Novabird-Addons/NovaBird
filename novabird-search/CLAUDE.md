# NovaBird-Search – Projektkontext für Claude Code

Add-on für Betterbird / Thunderbird ESR (MV2, Experiment-API `searchBar`, ID `novabird-search@novabird`, ab Version 128): EINE Suchleiste statt zwei (globale Suche + Schnellfilter) in der Kopfzeile der Nachrichtenliste. UI Deutsch, Englisch, Französisch, Spanisch (`_locales`; Kurzschreibweise auch fr/es/en: `de:`, `à:`, `para:`, `objet:`, `asunto:`, `from:` …; Freitext-Sätze versteht NovaBird-DB je nach „Suchsprachen“). Früher „Such-Pilot“ (`such-pilot@local`). Neue ID = neues Add-on (Einstellungen beginnen leer).
Beschreibung für Nutzer: `README.md`.

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-search-<Version>.xpi` (Version aus `manifest.json`; Kandidaten tragen `RCn`; eine neue `*.X`-Nummer nur der Maintainer).
- **Unit-Tests:** `node --test tests/*.test.js` (29: `parser.test.js`, `settings.test.js`, `locales.test.js`, `locales4.test.js`). `parser.js` ist rein; neue Parser-Fälle zuerst als Test. **Neue Texte immer in `_locales/de` und `/en`** (sonst schlägt `locales.test.js` an).
- **Labor** `$NOVABIRD/Testlab/novabird-search/` (Port 3600, `README.md`): `pakete-holen.sh` (holt Search und das DB-Paket als Gegenstelle), `PROF=prof-syn ./startbb.sh` (20K erfundene Mails, DB-Index fertig), `regress.py` (9 Prüfungen, Einzelfenster + zwei Hauptfenster), `quit.py idle`; weitere: `shots.py`, `hist.py`, `typo.py`, `rc3.py` (Zahnrad-Menü, Enter-Rückfrage, Treffer-Tab, Analyse), `mr3.py` („Alle als gelesen markieren“), `win.py`.
- **Pflicht vor jeder Freigabe:** Unit-Tests, `regress.py`, `permtest.sh` (Beenden mit fest installierten Add-ons zusammen mit NovaBird-DB, ≈ 1 s, kein FATAL/ABORT; temporär geladene Add-ons verstecken Beenden-Fehler).
- **Marionette-Fallen:** Chrome-Kontext; Leiste = `#novabird-search` im `contentDocument` des Tab-Browsers (`root._nbsId` = Kennung); Screenshots per `WebDriver:TakeScreenshot` (Fenster vorher `resizeTo(1366,900)`); `tab.chromeBrowser` fehlt beim Öffnen neuer Tabs oft noch.

## Abhängigkeiten
- Betterbird 153 ESR / Thunderbird ESR ≥ 128, Experiment `searchBar` (`addon_parent`). Berechtigungen: `accountsRead, messagesRead, storage, tabs, menus, messagesUpdate, messagesTags, messagesTagsList`. Kein Netzwerk.
- **NovaBird-DB (`novabird-db@novabird`), optional, aber der Normalweg.** Befehle per `runtime.sendMessage`:
  - `{type:"ping"}` (Zeitlimit 1,5 s, 5 s zwischengespeichert): DB wird nur genutzt bei `ok && usable && !broken` und `api ≥ 1` (Konstante `REQUIRED_DB_API`). Sonst Hinweis in der Leiste („DB ist OFFLINE / veraltet / Index defekt / baut auf – Gloda-Suche“) und Rückfall auf Gloda (Treffer ≤ 20.000, keine Relevanz, kein „Meinten Sie“).
  - `{type:"search", text, limit (≤ 1.000.000), includeTrash, folderId?, fields:["from","to","subject","body"], sort:"date"|"relevance"}` → `{ok, rows:[{header_msg_id, folder_id, date}], suggest}`; Search löst `header_msg_id` + `folder_id` selbst in Kopfzeilen auf.
  - Die DB lässt Search alle externen Befehle zu (`ALLOWED_EXTERNAL` in `novabird-db/background.js`): ändert sich die Add-on-ID, dort nachziehen. Einstellung `novabirdDb` = `auto` | `off`; die Optionsseite zeigt den Status.
- Gloda nur als Rückfall; „Alle Ordner“ ohne DB nutzt zusätzlich die Kopfzeilen-Suche über den virtuellen Ordner „Suchergebnisse“ (alle Fenster teilen ihn: bekannte Grenze).

## Funktionsumfang (1.2.1)
Eine Leiste in der Kopfzeile: Bereich (Alle Ordner / Aktueller Ordner), Eingabe, ✕, Zahnrad-Menü (Von/An/Betreff/Nachricht, Mit Anhang, Nur ungelesen, Papierkorb, Spam, Einstellungen), Zeitfenster-Chips. Live-Treffer in der normalen Liste (flach, **strikt nach Datum, neueste zuerst**; Relevanz nur optional/experimentell), Mindestlänge 3 Zeichen (Enter erzwingt), Kurzschreibweise (`von:` `an:` `betreff:` `text:` `anh:ja` `seit:` `bis:` `ungelesen` `markiert` `hier`), „Meinten Sie“, Suchverlauf (20, 10 sichtbar), Enter-Rückfrage Filtern (Treffer-Tab mit Eingrenzen) / Auswerten (Analyseseite: Zeitleiste, Filter, Vorschau), gemeinsame Ordner oben (Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage; Rechtsklick „Alle als gelesen markieren“), Mehrfenster (Kennung `nbs1`, `nbs2` … je Leiste, Zustand je Fenster), Strg+K, Theme-Farben, Optionsseite. Papierkorb/Spam standardmäßig nicht durchsucht.

## Architektur
- `settings.js` (Standardwerte, `sanitizeSettings`; Schlüssel `enterMode` ask|snapshot|analysis|off, `group`, `sharedFolders`, `sharedInboxMonths`, `glodaLimit`, `sortMode`, `novabirdDb`; in `storage.local` unter `settings`, dazu `searchHistory`), `parser.js` (`parseQuery`, `isTooShort`), `background.js` (Logik: je Leiste ein Controller `getCtl(barId)`; `runSearch`: Parser → DB `novabirdDbSearch` → Anzeige über `idSearch`/`showHeaders`, sonst Kopfzeilen-Suche + `scheduleGloda`; `novabirdDbStatus`, `refineSnapshot`, `openAnalysis`, Verlauf, `syncSharedFolders`, `init`).
- `experiments/searchBar/implementation.js` (privilegiert, ≈ 2200 Zeilen) + `schema.json`: baut die Leiste in `about:3pane` (Kennung `root._nbsId`, Zustand `root._nbsState`), Zahnrad-Menü, Chips, Verlauf, Rückfrage-Popover; blendet die native Leiste aus; Trefferanzeige, Treffer-Tab (`data-refine`), Analyse-Seite (`describeHits`, `openPage`), gemeinsame Ordner (sticky Zeilen), Theme-Farben (`--nbs-*`), `DEBUG`-Log (`novabird-search-debug.log` im Profil; vor einer Freigabe `DEBUG = false`).
- `analysis/` (Auswerten-Seite), `options/`, `_locales/de|en`, `icons/`, `tests/`.

## Stolpersteine
- **Experiment-Schema:** bei mehreren optionalen Zeichenketten ordnet WebExtension weggelassene Argumente den LETZTEN Parametern zu: immer alle übergeben (`showNote(ctl, text, tip, kind)`).
- **Pro Leiste ein Controller**; alle leistenbezogenen Experiment-Funktionen haben `barId` als ersten Parameter; unbekannte Kennung = nichts tun; nie `getMostRecentWindow` als Ziel.
- Neue Tabs/Fenster laden spät: `injectWhenReady`/`retryTabs` (bis 10 s).
- Synthetische Ansicht verlassen: `folderPane._onSelect()` bricht dort ab → `leaveSyntheticView(cw)`.
- Virtuelle Ordner: `wrapper.searchFolders = "*"` wirft → `dBFolderInfo.setCharProperty("searchFolderUri","*")`; Ordnermodi in `folderPane._modes`; `mode.active` erst nach `init()`; `folder.markMessagesRead(Array, true)` braucht ein JS-Array.
- Sammelordner-Zeilen (sticky) bekommen ihren Hintergrund aus der Farbe des **Ordnerbaums** (`#folderTree` bzw. Vorfahren, nicht der Liste selbst); beim Start (0,7 s/3 s später) und bei Theme-/Hell-Dunkel-Wechsel (`matchMedia`, `MutationObserver` auf dem Hauptfenster) wird sie neu gelesen (`cw._nbsSharedApply`). Prüfen mit Cobalt dunkel, frischer Start (Fehler bis 1.2.4).
- CSS: `.nbs-field` braucht `flex: none`; Sammelordner-Zeilen `position: sticky` (Liste des Ordnermodus braucht `overflow: visible`, `#folderTree::before` ausblenden).
- `messenger.tabs.create` für Extension-Seiten hatte im Test kein `messenger` → `openPage` (contentTab im Experiment); `hdr.date` ist in Mikrosekunden. `messages.listTags() deprecated` in der Konsole ist harmlos.
- Nicht getestet: echtes Profil (IMAP, Mehrkonten), mehr als zwei Hauptfenster, Rückfallweg bei gleichzeitiger Suche mehrerer Fenster ohne DB, „Alle als gelesen markieren“ bei IMAP.

## Lizenz-Hinweis und Ideen
„Expression Search NG“ (GPLv3) wurde nur als Ideenquelle analysiert: **keinen Code daraus übernehmen** (das Repo ist MIT).
Ideen: Wortmitte in der Volltextsuche (FTS kann nur Wortende-Wildcards; DB-Trigramm deckt Komposita im Betreff), erweiterte Suchsprache (Verneinung, und/oder/Klammern, `cc`/`bcc`, Größe, `tag`, `dateiname`), Mouseover-Vorschau, KI-Suche, Selbsttest für ESR-Updates, Zusammenführen mit NovaBird-DB (Schnittstelle zu Conversation bliebe `novabird-db@novabird`), Manifest V3 (mehrsprachiger Parser: erledigt, siehe DB).
