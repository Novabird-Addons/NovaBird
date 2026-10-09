# NovaBird-DB – Projektkontext für Claude Code

Add-on für Betterbird / Thunderbird ESR (MV2, Experiment-API, ID `novabird-db@novabird`, ab Version 128): eigener SQLite-Suchindex (FTS5, FTS4 als Rückfall) als Ersatz/Verbesserung für Gloda, mit mehrsprachigem Parser (DE, EN, FR, ES), Schnittstelle für andere Add-ons und Konversationsabfrage. Läuft eigenständig; Clients sind NovaBird-Search und NovaBird-Conversation. Früher „DB-Pilot“ (`db-pilot@local`).
Der Index-Ordner im Profil heißt `<Profil>/novabird-db/` (früher `db-pilot/`): neue ID = Neuaufbau des Index; altes und neues Add-on nie gleichzeitig installieren (gleiche Datei).

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-db-<Version>.xpi` (Version aus `manifest.json`; `package.json`-Version ist nur Kosmetik). Kandidaten tragen `RC`.
- **Unit-Tests:** `npm install && npm test` (= `TZ=Europe/Berlin vitest run`, 360 Tests: Parser (de + Sprachpakete en/fr/es), Chips, Ranking, Komposita, Faltung, Indexer, DB, Gesundheit, Konversation). Parser-Änderung: zuerst Fall in `tests/parser.cases.json` (Deutsch) bzw. `tests/parser.lang.cases.json` (en/fr/es), dann umsetzen. Schemaänderung: Migration + Test.
- **Labor** `$NOVABIRD/Testlab/novabird-db/` (Port 3500, `README.md`): `pakete-holen.sh`, `PROF=prof-syn ./startbb.sh`, `quit.py idle`; Schnittstelle `cvt.py` (Fake-Conversation-Add-on: Status-Push, `ping`, `conversation`, `search` abgelehnt); Index-Selbstschutz `mkbroken.py` + `scen.py`, `deep.py`; Messungen `dbq.py`, `timing.py`, `evalsyn.py`, `bench/`. Profile: `prof-syn` (20K erfundene Mails), `prof-conv` (+Antwortketten), `prof-syn75` (75K).
- **Pflicht vor jeder Freigabe:** `permtest.sh` (Beenden mit fest installiertem Add-on, ≈ 1 s, kein FATAL/ABORT; auch mitten im Indexaufbau), bei Schnittstellenänderung `cvt.py` und der Search-Test (`regress.py` im Search-Labor).

## Externe Schnittstelle (`runtime.sendMessage("novabird-db@novabird", …)`, nur lesend)
Erlaubt sind nur Absender aus `ALLOWED_EXTERNAL` (`background.js`): `novabird-search@novabird` alle Befehle, `novabird-conversation@novabird` nur `ping` und `conversation`; alles andere → `{ok:false, error:"nicht erlaubt"}`.
| Nachricht | Antwort |
|---|---|
| `{type:"ping"}` | `{ok, version, api:1, features:[…], ready, indexing, messages, initialDone, usable, ftsMode, broken}`; wirft nie; `usable` = bereit, Index nicht leer, kein Aufbau läuft, Erstlauf fertig; `broken` = `corrupt`/`newer`/`null` |
| `{type:"progress"}`, `"stop"`, `"resume"` | Fortschritt (ohne DB-Zugriff) bzw. Indexlauf anhalten/fortsetzen |
| `{type:"search", text, limit?, includeTrash?, sort?, fields?, folderId?}` | `{ok, rows:[{header_msg_id, folder_id, date}], chips, empty, suggest}`; `sort` = `date` (Standard) \| `relevance`; `suggest` nur bei 0 Treffern und FTS5; Papierkorb/Spam nur mit `includeTrash` |
| `{type:"conversation", headerMessageId, fallback:"off\|subject\|smart", fallbackDays?, fallbackPeople?, limit?}` | `{ok, messages:[{headerMessageId, folderId, folderName, folderType, date, authorName, authorEmail, recipients, subject, isRead, hasAttachment, attachmentNames, snippet}], indexedAt, truncated?}` (Datum aufsteigend, ≤ 200 Standard / 5000) |
| Push an Conversation | `{type:"status", usable, version, api, broken}` bei jeder Änderung von `usable` |
`api` im `ping` hochzählen, wenn sich Befehle/Antworten inkompatibel ändern (derzeit 1); neue Fähigkeiten in `features`. Ändert sich die Schnittstelle, `novabird-search/CLAUDE.md` (Konstante `REQUIRED_DB_API`) und `novabird-conversation/CLAUDE.md` mitziehen.

## Code-Landkarte
- `background.js`: Start (`start`, `integrityCheck`, `handleBroken`, `rebuildSafely`), Indexlauf (`runIndex`, `catchUpNow`, `deepTick`), `onMessageExternal` (`externalStatus`, `pushStatus`), interne Befehle `novabird-db:*` (Debug-Seite/Einstellungen), Einstellungen in `storage.local`, Fortschritts-Overlay, `TIMING`/`API_VERSION`.
- `api/novabirdDb/` (Experiment, **nur Datenbank**: öffnen/schließen, SQL, FTS5, `moveAside`/`deleteAside`, `references`, `offlineFlags`, `idleSeconds`, Shutdown-Blocker) und `api/novabirdDbUi/` (Overlay, Rückfrage-Dialog).
- `src/db/` (`schema.js` Migrationen, aktuell **Schema v5**, `repository.js`, `adapter.js`, `capabilities.js`, `health.js`), `src/indexer/` (`indexer.js`, `record.js`, `terms.js`), `src/parser/` (Regel-Parser: `parseQuery.js` mit gemeinsamer Logik, `lang/{common,index,de,en,fr,es}.js` = ein Sprachpaket je Sprache, `dates.js`, `lexicon.js` (nur Deutsch), `stem.js`, `chips.js`), `src/query/` (`buildSql.js`, `compounds.js`, `rank.js`, `suggest.js`, `resolvePeople.js`, `conversation.js`), `src/search.js`, `src/text/clean.js`, `src/util/normalize.js`.
- `options/` (Status, Wartung, Protokoll, Zusammensetzungen; alle Texte aus `_locales`), `debug/` (interne Testoberfläche, nur Deutsch, im Paket), `_locales/de|en|fr|es`, `tests/` (u. a. `locales.test.js`).

## Funktionen und Entwurfsentscheidungen
- **Faltung** `foldDe` (ä/ae→a, ü/ue→u, ß→ss) in Index und Suche; Änderung (`meta.text_norm`) löst einmaligen Neuaufbau aus. **Komposita** („Speiseplan“ → „Wochenspeiseplan“): Modus „Bei der Suche“ (Standard, Wortliste `fts5vocab`, Mindestlänge 4, Cache 10 min) oder „Beim Indexieren“ (`terms_fts`/`terms_seed`); Trigramm-Index auf dem Betreff, FTS4-Rückfall mit `LIKE`. **Relevanz** `rank.js` (bm25 mit Spaltengewichten + Aktualitätsbonus 0,5, Halbwertszeit 365 Tage), **„Meinten Sie“** `suggest.js` (nur FTS5, nur bei 0 Treffern).
- **Abgleich:** Ordner-Abgleich (Alarm alle 6 h und nach dem Erstlauf), Nachholen verpasster Mails, Tiefenabgleich wöchentlich im Leerlauf (frühestens 5 Min nach Start, spätestens nach 30 Min sanft). Indexaufbau startet 10 s nach dem Start. Zeiten in `TIMING` (per `storage.local.testTimings` überschreibbar).
- **Selbstschutz:** `meta.clean_shutdown`, `PRAGMA quick_check(1)` 30 s nach dem Start bei unsauberem Beenden, alle 20 Starts oder 14 Tage (`health.js`). Defekter/zu neuer Index → Rückfrage-Overlay „Neu aufbauen / Abbrechen“; solange unbrauchbar: `ping` → `broken`, `usable:false`, Indexer gestoppt. **Neuaufbau über Nebendatei** (`rebuildSafely`): `index.sqlite` wird zu `index.sqlite.alt` zur Seite gelegt und erst nach vollständigem Neuaufbau gelöscht. Öffnungsfehler 10 s zwischengespeichert.
- **Konversationsabfrage** (seit 1.1.0, `src/query/conversation.js`): Schema v5 mit `message_refs(header_msg_id, ref_id)`, `messages.snippet` (200 Zeichen ohne Zitate), `messages.subject_key` (Betreff ohne Re/AW/WG …); Verweise aus `nsIMsgDBHdr.getStringReference` (References, ersatzweise In-Reply-To; kein Mailtext, kein Netz). Kette per rekursiver CTE in beide Richtungen (Obergrenze 500); Betreff-Ersatz nur wenn weniger als zwei Nachrichten der Kette im Index sind; Papierkorb/Spam raus außer der Zielnachricht; gleiche Message-ID in mehreren Ordnern → alle Zeilen. Kette mit 25 Mails ≈ 3 ms; Index ≈ 2,0 KB/Mail.
- **Datenschutz:** Der Index liegt unverschlüsselt im Profil (wie Gloda): Hinweis in Einstellungen/README, Festplattenverschlüsselung empfohlen. Keine Netzwerkzugriffe.

## Regeln für den Code
- Experiment-API `novabirdDb` enthält nur Datenbankfunktionen (Ausnahme: `offlineFlags()`); `novabirdDbUi` nur Overlay; keine Mail-, Parser- oder UI-Logik darin. DB-Pfad nur in `implementation.js` bestimmen.
- `select()` immer mit Spaltenliste in SELECT-Reihenfolge. Nie WebExtension-Nachrichten-IDs speichern: Schlüssel ist `headerMessageId` + `folderId`.
- Alle SQL-Werte als Parameter; FTS-Ausdrücke nur aus `sanitizeTerm()`-bereinigten Begriffen.
- Schemaänderungen nur als neue Migration am Ende von `MIGRATIONS`; bestehende nie ändern.
- Indizierung bleibt unterbrechbar; Schreibzugriffe nur über die Warteschlange des Indexers.

## Stolpersteine
- **Beenden:** mit `Sqlite.wrapStorageConnection` umhüllte Verbindungen schließt Sqlite.sys.mjs beim Beenden NICHT selbst; sein Shutdown-Blocker wartet endlos → `ABORT … Sqlite.sys.mjs:239` nach ~60 s. Darum eigener `Sqlite.shutdown.addBlocker(…)` in `api/novabirdDb/implementation.js`; `onShutdown` schließt immer, `ensureOpen` öffnet bei `shuttingDown` nicht neu. Nur mit fest installiertem Add-on sichtbar (temporär geladene verstecken es).
- Experiment-Schema: optionale Zeichenketten immer vollständig übergeben (sonst rutschen Argumente).
- Beschädigte Datei meldet Sqlite.sys.mjs teils nur als Zahl `2152857611` (`NS_ERROR_FILE_CORRUPTED`); `health.js` erkennt das.
- Der Flatpak-Betterbird sieht nur das Testlab-Verzeichnis; Profile enthalten den Mail-Pfad absolut (`prefs.js`/`user.js`), Kopien müssen ihn anpassen (`permtest.sh` tut das).
- Engpass beim Indexieren ist der Einzel-Thread von Betterbird (paralleles Lesen brachte nichts).

## Mehrsprachiger Parser
- `parseQuery(text, { now, langs, dateOrder })`: `langs` = Sprachcodes (Standard `["de"]`, die erste ist die Hauptsprache für das Stemming). Jeder Schritt (Datum, Anhänge, Status, Personen, Ordner) läuft nacheinander mit dem Paket jeder Sprache; Operatoren (`von:`, `from:`, `de:`, `para:` …), Phrasen und Suchbegriffe sind sprachübergreifend (englische Operatoren gelten immer).
- Ein Sprachpaket (`lang/<code>.js`) liefert Wortlisten (Monate, Zahlwörter, Einheiten, Anhangstypen, Ordner, Füllwörter, Stemming-Regeln, Operatoren, Werte wie „mir/me/moi“) und `patterns(f)` mit den Regex-Quelltexten je Schritt (`dates.{between,range,lastN,sinceN,agoN,lastUnit,thisUnit,relDay,week,since,until,monthIn,onDate,year}`, `attach`, `status`, `persons`, `folder`). Die Handler sind gemeinsam; Gruppenreihenfolge siehe `parseQuery.js` (Schritte können mehrere Schreibweisen als Array haben). `slashDates` (15/03/2026), `dayMonth` (15 March, 15 de marzo) optional. Rollenwörter wie „de“/„a“ (fr/es) zählen nur vor Großbuchstaben oder Adressen als Person („notes de réunion“ ist kein Absender).
- Neue Sprache: Paket anlegen, in `lang/index.js` eintragen, Fälle in `tests/parser.lang.cases.json` (Ergebnis von Hand prüfen), Texte in `chips.js` und `_locales`. Der Index ändert sich nie (kein Neuaufbau).
- Einstellung `parserLangs` (`storage.local`, Optionsseite „Suchsprachen“): Standard = Sprache der Betterbird-Oberfläche; Hauptsprache = Oberflächensprache, wenn aktiv. `dateOrder` = `mdy` nur bei `en-US`. Mehrere Sprachen gleichzeitig können mehrdeutige Kurzwörter falsch deuten („an“ de/en). `toChips(q, lang)` beschriftet Chips in der Sprache der Anfrage.
- Französisch und Spanisch sind **nach bestem Wissen** geschrieben, nicht von Muttersprachlern geprüft.

## Geplant
Eigene Synonyme/Abkürzungen; Muttersprachler-Review der Pakete en/fr/es.
