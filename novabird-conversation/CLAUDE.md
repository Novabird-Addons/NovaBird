# NovaBird-Conversation – Projektkontext

Konversationsansicht („Gmail Conversation View“) für Betterbird/TB-ESR (getestet mit 153 ESR, ab 128). ID `novabird-conversation@novabird`, früher „Conversation-Pilot“ (bis 0.12.0). Orientiert am Add-on „Thunderbird Conversations“ (MPL-2.0; nur gelesen, kein Code übernommen). DE/EN/FR/ES. Nutzerbeschreibung: `README.md` (bei neuen Funktionen/Version mitpflegen).

## Bauen und Testen
- `./build.sh` → `$NOVABIRD/Release/Kandidaten/novabird-conversation-<Version>.xpi` (packt manifest, settings.js, conversation.js, background.js, _locales, icons, content, experiments, options; Kandidaten `RC`; Freigabe nur auf Wort des Nutzers). Jede Änderung: Version erhöhen.
- Tests: `node --check` auf die JS-Dateien und `node --test tests/conversation.test.js tests/locales.test.js` (22; `node --test tests/` allein geht nicht). Neue Texte in allen vier `_locales` (`locales.test.js` prüft Schlüssel, Platzhalter, Verwendung). Labor `$NOVABIRD/Testlab/novabird-conversation/` (Port 4000, `README.md`): `convtest.py`, `permtest.sh`.
- Optional **NovaBird-DB** (Konversation in Millisekunden). Die **NovaBird-Extension** liest den DOM (Chips `.nbc-chip`, Karten `.nbc-card`, Absender `.nbc-name`) → diese Klassennamen nicht ohne Abstimmung ändern. Neue ID = Einstellungen (`storage.local` `settings`) beginnen leer; altes Add-on vorher entfernen.

## Verhalten
Alle Nachrichten der Konversation (über alle Ordner) im Lesebereich: neueste oben fixiert, ältere darunter (Option „älteste zuerst“); Auto-Aufklappen (neueste + vorherige + ungelesene + gewählte), Rest als Zeile mit Vorschau; Höchsthöhe mit „Ganz anzeigen“; je Nachricht Header mit „Original“ und „Spam“; Anhänge als Chips; cid-Bilder im Text; Zitate hinter „…“; Aktionen Antworten/Allen antworten/Weiterleiten/Als Anhang/Als neu bearbeiten/Löschen (nur Papierkorb)/Spam; Betterbirds Kopf ausgeblendet (`hideHeader`), Einzelmails behalten die Standardanzeige (`alwaysRender`); Stile Sanft, Klar, Faden; Animationen einstellbar (respektiert „Bewegung reduzieren“); externe Bilder mit Hinweis und Menü (nur diese Nachricht / Unterhaltung / immer von diesem Absender); Fallback „Original“ (auch automatisch bei unlesbaren Mails). Tastatur und „als gelesen markieren“ bleiben Betterbird-Standard. Leitbild: möglichst lokal, nichts auf Vorrat per Netz.

## Architektur
- `background.js`: antwortet auf `hello` des Anzeigeskripts (je Tab); Quellenkette **DB → Gloda → `messages.query`** (`engine` auto|db|gloda|query); Cache je Konversation (60 s) und Nachrichtentext (40), geleert bei Postfachänderungen; `resolveId`, `runAction` (reply, replyAll, forward, forwardAsAttachment, editAsNew, openAttachment, delete, junk/notJunk), `body`, `image`, `cidImage`, `allowSender`, `header`; Status-Push der DB (`onMessageExternal`).
- `conversation.js` (rein, Node-testbar): `normalizeSubject`, `groupConversation` (Union-Find über Message-ID/References/In-Reply-To, Betreff-Ersatz `off|subject|smart`), `pickExpanded`, Index-Zeilen (`rowKey`, `dedupeRows`, `rowToView`), `dedupeByMid`, `addressesOf`.
- `settings.js`: `SETTINGS_DEFAULTS` + `sanitizeSettings` (u. a. style, order, pin, maxHeight, expand, attachments, collapseQuotes, alwaysRender, fallback(+Days/People), engine, limit, hideHeader, stickyHeader, rowLines, autoOriginal, autoOpen, openMs, fadeMs, debugTiming).
- `content/view.js` + `view.css`: per `messageDisplayScripts.register` (Recht `messagesModify`) ins Nachrichtendokument injiziert, ersetzt `document.body`; Stilblätter/`<body>`-Attribute der Mail aus; HTML per DOMParser in eine Whitelist kopiert (kein Skript, keine Stile). Klassen `nbc-*`, Variablen `--nbc-accent/-border/-tint`, Messpunkte `data-nbc-timing`/`data-nbc-bg` (mit `debugTiming` auch Konsole).
- `experiments/conversationView/`: `setHeaderHidden`, `getThemeColors`, `getReferences`, `getOfflineState`, `getMessageId`, `getGlodaConversation`, `getAllowedSenders`/`allowSender`, `fetchImage` (über das Hauptfenster: ohne Cookies/Referrer, ≤ 5 MB, 10 s, png/jpg/gif/webp, als `data:`; im Experiment kein `fetch`/`btoa`).
- `options/`: Reiter „Einstellungen“, „Aussehen“; wirkt sofort; Erklärung + Skizzen (inline SVG). Aufklappen beim Scrollen (`autoOpen`): `autoOpenTrigger` scroll|hover, `autoOpenDelay` 50–200 ms nur wenn `autoOpenDwell` an (Standard aus; **experimentell**, funktioniert nicht zuverlässig; aus = keine Wartezeit); Zeiger bleibt auf zugeklappter Zeile, dann klappt genau diese auf.

## Schnittstelle zu NovaBird-DB
`runtime.sendMessage("novabird-db@novabird", {type:"conversation", headerMessageId, folderId, fallback…, limit})`; erlaubt nur `ping` und `conversation` (`ALLOWED_EXTERNAL` in der DB). Zeitlimit 300 ms (Ergebnis 5–70 ms). Die Anfrage selbst ist die Prüfung (kein periodischer `ping`): Fehler → Pause 30 s/2 min/10 min und sofort Rückfall; `ok:false,usable:false` → 60 s; Status-Push `{type:"status", usable, version, api, broken}` hebt die Pause auf. Ordner-Kennung `<accountId>:<Pfad>`. Gruppierungsregeln müssen mit der DB übereinstimmen (Tests dort).
Quellen: Antwortketten zuerst; Betreff-Ersatz nur für Mails ohne Kette (`subject` Standard, `smart`, `off`; gilt für DB und `messages.query`, nicht Gloda); Papierkorb/Spam raus (außer der gewählten), Dubletten einmal, gewählte Nachricht kommt immer dazu. Gloda: Zeitlimit 900 ms/1,2 s.

## Offline/IMAP
Lokale Nachrichten: Text und Vorschau sofort. Nicht lokale: Wolken-Symbol, kein Abruf auf Vorrat; automatisch nur neueste, vorherige, gewählte, Rest beim Aufklappen; Texte max. 3 gleichzeitig, 45 s Zeitlimit. Anhänge holt Betterbird beim Klick.

## Stolpersteine
- Python-Bearbeitung per `s.index(a)…s.index(b)` kann dazwischenliegenden Code löschen (so ging einmal `setAll` verloren): nach größeren Ersetzungen Funktionen gegenprüfen.
- Regex für versteckte Stile braucht Lookbehind `(?<![\w-])`, sonst trifft `color:transparent` auch `background-color:transparent`.
- `animation-fill-mode: both` macht die Karte zum Bezugsrahmen für `position: fixed` → `backwards`; Animationen starten erst nach zwei `requestAnimationFrame`.
- Scroll-Aufklappen nicht auf Nutzereingaben gaten, sondern Aufbau/eigenes Aufklappen ausnehmen. `getMostRecentWindow` nicht zur Zuordnung nutzen; alles je Tab.
- Headless-Test: **nie echte Verfassen-Fenster öffnen** (mehrere beenden die Instanz); Nachrichten-Tabs laden headless nicht; dieselbe Mail erneut wählen lädt das Dokument nicht neu; Experiment-Änderungen brauchen frischen Start; eingebettete Optionsseite hat im Headless-Profil kein `messenger`.

## Offen
Echter IMAP-Dauertest durch den Nutzer (Beenden, Löschen/Spam auf IMAP, Optionsseite im Add-ons-Manager, Stil „Faden“, Wolken-Symbol); Scroll-Aufklappen bei sehr langen Nachrichten; Option „nur aktueller Ordner“; weitere Aussehen-Optionen; FR/ES prüfen lassen; Veröffentlichung (ATN, Lizenz).
