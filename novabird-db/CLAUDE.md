# NovaBird-DB – Projektkontext

Betterbird/TB-ESR-Add-on (MV2, Experiment-API, ID `novabird-db@novabird`, ab 128): eigener SQLite-Suchindex (FTS5, FTS4 als Rückfall) statt/neben Gloda, mehrsprachiger Parser (DE/EN/FR/ES), Schnittstelle für andere Add-ons, Konversationsabfrage. Clients: NovaBird-Search, NovaBird-Conversation. Früher „DB-Pilot“. Index im Profil: `<Profil>/novabird-db/` (neue ID = Neuaufbau; altes und neues Add-on nie gleichzeitig, gleiche Datei).

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-db-<Version>.xpi` (Version aus `manifest.json`; Kandidaten `RC`).
- Unit-Tests: `npm install && npm test` (= `TZ=Europe/Berlin vitest run`, 360). Parser-Änderung: zuerst Fall in `tests/parser.cases.json` (de) bzw. `tests/parser.lang.cases.json` (en/fr/es). Schemaänderung: Migration + Test.
- Labor `$NOVABIRD/Testlab/novabird-db/` (Port 3500, `README.md`): `pakete-holen.sh`, `PROF=prof-syn ./startbb.sh`, `quit.py idle`; `cvt.py` (Fake-Conversation: Status-Push, `ping`, `conversation`, `search` abgelehnt), `mkbroken.py` + `scen.py`, `deep.py` (Selbstschutz), Messungen `dbq.py`, `timing.py`, `evalsyn.py`, `bench/`. Profile `prof-syn` (20K), `prof-conv` (+Antwortketten), `prof-syn75` (75K).
- **Vor Freigabe:** `permtest.sh` (Beenden mit fest installiertem Add-on, ≈ 1 s, kein FATAL/ABORT; auch mitten im Indexaufbau); bei Schnittstellenänderung `cvt.py` und Search-`regress.py`.

## Externe Schnittstelle (`runtime.sendMessage("novabird-db@novabird", …)`, nur lesend)
Erlaubt nur Absender aus `ALLOWED_EXTERNAL` (`background.js`): Search alle Befehle, Conversation nur `ping`/`conversation`; sonst `{ok:false, error:"nicht erlaubt"}`.
| Nachricht | Antwort |
|---|---|
| `{type:"ping"}` | `{ok, version, api:1, features, ready, indexing, messages, initialDone, usable, ftsMode, broken}`; wirft nie; `usable` = bereit, Index nicht leer, kein Aufbau, Erstlauf fertig; `broken` = `corrupt`/`newer`/`null` |
| `progress`, `stop`, `resume` | Fortschritt (ohne DB-Zugriff) bzw. Indexlauf anhalten/fortsetzen |
| `{type:"search", text, limit?, includeTrash?, sort?, fields?, folderId?}` | `{ok, rows:[{header_msg_id, folder_id, date}], chips, empty, suggest}`; `sort` `date` (Standard)\|`relevance`; `suggest` nur bei 0 Treffern und FTS5; Papierkorb/Spam nur mit `includeTrash` |
| `{type:"conversation", headerMessageId, fallback:"off\|subject\|smart", fallbackDays?, fallbackPeople?, limit?}` | `{ok, messages:[{headerMessageId, folderId, folderName, folderType, date, authorName, authorEmail, recipients, subject, isRead, hasAttachment, attachmentNames, snippet}], indexedAt, truncated?}` (Datum aufsteigend, ≤ 200 / 5000) |
| Push an Conversation | `{type:"status", usable, version, api, broken}` bei jeder Änderung von `usable` |
`api` hochzählen bei inkompatiblen Änderungen (derzeit 1), neue Fähigkeiten in `features`. Bei Änderung `novabird-search/CLAUDE.md` (`REQUIRED_DB_API`) und `novabird-conversation/CLAUDE.md` mitziehen.

## Code-Landkarte
- `background.js`: Start (`start`, `integrityCheck`, `handleBroken`, `rebuildSafely`), Indexlauf (`runIndex`, `catchUpNow`, `deepTick`), `onMessageExternal` (`externalStatus`, `pushStatus`), interne Befehle `novabird-db:*`, Einstellungen (`storage.local`), Overlay, `TIMING`/`API_VERSION`, `PARSER_LANGS`.
- `api/novabirdDb/` (Experiment, **nur Datenbank**: öffnen/schließen, SQL, FTS5, `moveAside`/`deleteAside`, `references`, `offlineFlags`, `idleSeconds`, Shutdown-Blocker), `api/novabirdDbUi/` (Overlay, Rückfrage-Dialog).
- `src/db/` (`schema.js` Migrationen, **Schema v5**, `repository.js`, `adapter.js`, `capabilities.js`, `health.js`), `src/indexer/`, `src/parser/` (`parseQuery.js`, `lang/{common,index,de,en,fr,es}.js`, `dates.js`, `lexicon.js` (nur de), `stem.js`, `chips.js`), `src/query/` (`buildSql`, `compounds`, `rank`, `suggest`, `resolvePeople`, `conversation`), `src/search.js`, `src/text/clean.js`, `src/util/normalize.js`.
- `options/` (Status, Wartung, Protokoll, Zusammensetzungen, Suchsprachen; Texte aus `_locales`), `debug/` (interne Oberfläche, nur de), `_locales/de|en|fr|es`, `tests/` (u. a. `locales.test.js`).

## Entwurfsentscheidungen
- **Faltung** `foldDe` (ä/ae→a, ü/ue→u, ß→ss) in Index und Suche; Änderung (`meta.text_norm`) = einmaliger Neuaufbau. **Komposita:** „Bei der Suche“ (Standard, `fts5vocab`, Mindestlänge 4, Cache 10 min) oder „Beim Indexieren“ (`terms_fts`/`terms_seed`); Trigramm auf dem Betreff, FTS4-Rückfall mit `LIKE`. **Relevanz** `rank.js` (bm25 mit Spaltengewichten + Aktualitätsbonus 0,5, Halbwertszeit 365 Tage); **„Meinten Sie“** `suggest.js` (nur FTS5).
- **Abgleich:** Ordner-Abgleich alle 6 h und nach dem Erstlauf, Nachholen verpasster Mails, Tiefenabgleich wöchentlich im Leerlauf (≥ 5 Min nach Start, spätestens 30 Min sanft); Indexaufbau 10 s nach Start. Zeiten in `TIMING` (`storage.local.testTimings`).
- **Selbstschutz:** `meta.clean_shutdown`, `PRAGMA quick_check(1)` 30 s nach Start bei unsauberem Beenden, alle 20 Starts/14 Tage (`health.js`). Defekt/zu neu → Rückfrage „Neu aufbauen / Abbrechen“; solange unbrauchbar `ping` → `broken`, `usable:false`, Indexer gestoppt. **Neuaufbau über Nebendatei** (`rebuildSafely`): `index.sqlite` → `index.sqlite.alt`, erst nach vollständigem Neuaufbau gelöscht. Öffnungsfehler 10 s gecacht.
- **Konversation** (`src/query/conversation.js`): `message_refs(header_msg_id, ref_id)`, `messages.snippet` (200 Zeichen ohne Zitate), `messages.subject_key` (Betreff ohne Re/AW/WG); Verweise aus `getStringReference` (References, ersatzweise In-Reply-To). Kette per rekursiver CTE in beide Richtungen (≤ 500); Betreff-Ersatz nur bei < 2 Kettennachrichten im Index; Papierkorb/Spam raus außer Zielnachricht; gleiche Message-ID in mehreren Ordnern → alle Zeilen. 25 Mails ≈ 3 ms; Index ≈ 2,0 KB/Mail.
- **Datenschutz:** Index unverschlüsselt im Profil (wie Gloda), Festplattenverschlüsselung empfohlen; keine Netzwerkzugriffe.

## Regeln für den Code
- `novabirdDb` enthält nur Datenbankfunktionen (Ausnahme `offlineFlags()`), `novabirdDbUi` nur Overlay; keine Mail-/Parser-/UI-Logik darin; DB-Pfad nur in `implementation.js`.
- `select()` mit Spaltenliste in SELECT-Reihenfolge. Nie WebExtension-Nachrichten-IDs speichern: Schlüssel `headerMessageId` + `folderId`.
- SQL-Werte als Parameter; FTS-Ausdrücke nur aus `sanitizeTerm()`-Begriffen.
- Schema nur als neue Migration am Ende von `MIGRATIONS`, bestehende nie ändern. Indizierung unterbrechbar, Schreiben nur über die Indexer-Warteschlange.

## Stolpersteine
- **Beenden:** mit `Sqlite.wrapStorageConnection` umhüllte Verbindungen schließt Sqlite.sys.mjs NICHT selbst, sein Blocker wartet endlos → `ABORT … Sqlite.sys.mjs:239` nach ~60 s. Darum eigener `Sqlite.shutdown.addBlocker` in `api/novabirdDb/implementation.js`; `onShutdown` schließt immer, `ensureOpen` öffnet bei `shuttingDown` nicht neu. Nur mit fest installiertem Add-on sichtbar.
- Experiment-Schema: optionale Zeichenketten immer vollständig übergeben.
- Beschädigte Datei meldet Sqlite.sys.mjs teils nur als Zahl `2152857611` (`NS_ERROR_FILE_CORRUPTED`); `health.js` erkennt das.
- Flatpak-Betterbird sieht nur das Testlab; Profile enthalten den Mail-Pfad absolut (`prefs.js`/`user.js`), Kopien anpassen (`permtest.sh` tut das). Engpass beim Indexieren ist der Einzel-Thread von Betterbird.

## Mehrsprachiger Parser
- `parseQuery(text, { now, langs, dateOrder })`: `langs` (Standard `["de"]`, erste = Hauptsprache für Stemming). Jeder Schritt (Datum, Anhänge, Status, Personen, Ordner) läuft nacheinander mit dem Paket jeder Sprache; Operatoren (`von:`, `from:`, `de:`, `para:` …), Phrasen, Suchbegriffe sprachübergreifend (englische Operatoren gelten immer).
- Sprachpaket `lang/<code>.js`: Wortlisten (Monate, Zahlwörter, Einheiten, Anhangstypen, Ordner, Füllwörter, Stemming, Operatoren, Werte wie „mir/me/moi“) und `patterns(f)` mit Regex-Quelltexten je Schritt (`dates.{between,range,lastN,sinceN,agoN,lastUnit,thisUnit,relDay,week,since,until,monthIn,onDate,year}`, `attach`, `status`, `persons`, `folder`; mehrere Schreibweisen als Array). Handler gemeinsam, Gruppenreihenfolge siehe `parseQuery.js`. Optional `slashDates`, `dayMonth`. Rollenwörter „de“/„a“ (fr/es) zählen nur vor Großbuchstaben/Adressen als Person.
- Neue Sprache: Paket anlegen, in `lang/index.js` eintragen, Fälle in `tests/parser.lang.cases.json` (von Hand prüfen), Texte in `chips.js` und `_locales`. Index ändert sich nie.
- Einstellung `parserLangs` (Optionsseite „Suchsprachen“): Standard = Oberflächensprache (= Hauptsprache, wenn aktiv); `dateOrder` `mdy` nur bei `en-US`. Mehrere Sprachen können mehrdeutige Kurzwörter falsch deuten („an“ de/en). `toChips(q, lang)` beschriftet in der Sprache der Anfrage. FR/ES nach bestem Wissen, nicht von Muttersprachlern geprüft.

## Geplant
Eigene Synonyme/Abkürzungen; Muttersprachler-Review en/fr/es.
