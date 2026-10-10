# NovaBird-Extension – Projektkontext für Claude Code

Add-on für Betterbird / Thunderbird ESR (Manifest V2, ID `novabird-extension@novabird`, Anzeigename „NovaBird-Extension“). Früher „Stream Extension“ (`stream-extension@local`); enthält außerdem den früheren Nova-Calendar, den Nova-Contact und die Einstellungs-Umgestaltung. Begleiter der NovaBird-Themes (`../novabird-themes/`): **Struktur im Add-on, Farben führt das Theme** (ein Theme kann kein JS tragen; das Add-on liest die Theme-Farben und setzt `--tbsr-*`).

## Ordner und Bauen
- Quelle ist dieser Ordner; Build: `./build.sh` → `../../Release/Kandidaten/novabird-extension-<Version>.xpi` (Version aus `manifest.json`; Kandidaten tragen `RC`). Freigabe nach `../../Release/` nur auf ausdrückliches Wort des Nutzers.
- Test: Labor `../../Testlab/novabird-extension/` (Port 3800, siehe dortige `README.md`): `smoke.py`, `func.py`, `permtest.sh`.
- Abhängigkeit: keine harte. Liest optional den DOM des NovaBird-Conversation (Chips `.nbc-chip`) für die Anhang-Vorschau. Alte Add-ons `stream-extension@local`, `kalender-pilot@local`, `settings-redesign@local`, `stream-pilot@local` dürfen **nie gleichzeitig** installiert sein (doppelte Listener/Elemente); die Debug-Ausgabe von `novaCalendar` warnt davor.
- Neue ID = neues Add-on: Einstellungen (`storage.local`) und Preferenzen (`extensions.novabird-extension.*`) beginnen leer.

## Architektur
- **Vier Experimente** (teilen einen globalen Scope → alle außer dem ersten, `novaCalendar`, sind in eine IIFE gekapselt, sonst „redeclaration“; Funktionen aus `novaCalendar` sind daher in den anderen erreichbar):
  1. `novaCalendar` – rechte Leiste (Tagesplan/Aufgaben, Anhänge-Bereich), Termin-Dialog-Farben, Verfassen-Feinschliff.
  2. `settingsRedesign` – Einstellungen, Konten, Add-ons-Manager im neuen Stil.
  3. `novaContact` + `pilot/` – Nova-Contact (Tab „Kontakte“: Tags, Mehrfachbearbeitung, Rückgängig, Aufräumen).
  4. `attachPreview` – Anhang-Vorschau (PDF/Bild beim Überfahren).
- **Einstellungen-Seite „NovaBird“** (in `settingsRedesign`, `setupHub`): Kategorie `paneNovaBird` in `about:preferences` (Nav-Eintrag in `navItems`, Seite `#nbxHub`, `win.register_module("paneNovaBird", …)` damit `gotoPref` sie kennt) mit Reitern für jedes aktive `novabird-*@novabird` mit `options_ui` (feste Reihenfolge Search, DB, Conversation, Send, Extension, unbekannte danach); je Reiter ein iframe auf die Optionsseite (lazy geladen), Farben und `color-scheme` werden beim Laden in die Seite geschrieben (`themeFrame`). Neue Add-ons erscheinen automatisch, wenn ihre ID dem Muster entspricht und `options_ui.page` gesetzt ist. Jede Optionsseite läuft in einem eigenen `browser`-Element im Erweiterungsprozess (`loadOptionsBrowser`, nach Betterbirds `inline-options-browser.mjs`; hell/dunkel per `browsingContext.prefersColorSchemeOverride`, die Optionsseiten deklarieren `color-scheme: light dark`). **Ein iframe geht NICHT**: bei `extensions.webextensions.remote = true` (echtes Betterbird) bleibt er leer (`about:blank`). Das Standardprofil des Labors hat `remote = false` und verdeckt solche Fehler → Test nur mit `remote = true`: `Testlab/novabird-extension/hubremote.py` (Ablauf im Kopf der Datei, Screenshots je Reiter, `dark`).
- Optionsseite `options/` (Reiter Rechte Leiste, Farben, Anhang-Vorschau, Nova-Contact); Einstellungen in `storage.local`, `background.js` reicht geänderte Werte per `storage.onChanged` an die Experimente. Permissions: storage, accountsRead, messagesRead, addressBooks, theme. Texte immer in DE/EN/FR/ES (`_locales`, `options/options.js`, `pilot/ui/i18n*.js`).
- Eindeutige Namen: Listener `novabird-extension-{windows,settings,contacts,preview}`, Stil-ID `novabird-extension-style`, DOM-IDs `nbx-*` (`nbx-todo-header`, `nbx-attach-box/-splitter/-style`, `nbx-preview`, `nbx-preview-style`), Preferenzen `extensions.novabird-extension.{attachHeight,attachScope}`, Layout-Wert `nova` (statt früher `stream`). Gleichnamige Listener anderer Add-ons blockieren still. Die Experiment-Namespaces (`novaCalendar`, `settingsRedesign`, `novaContact`, `attachPreview`) und die Funktionsnamen „Nova-Calendar“/„Nova-Contact“ blieben bewusst.
- Theme-Schnittstelle: Variablen `--ms-*` des Themes, `--tbsr-*` im Add-on; Details zur Farbführung in `../novabird-themes/`.

## Rechte Leiste und Anhänge-Bereich
- Einheitlich in Mail, Kalender und Aufgaben (nicht Kontakte): Tagesplan (`#agenda-panel`) und Aufgabenliste (`#todo-tab-panel`), Reihenfolge je Modus per `placePanels`, Trennung `#today-pane-splitter`; Option „Layout der rechten Leiste“ (`setPaneLayout`: NovaBird-Layout oder Betterbird-Standard). Umbau bei Modus-/Tabwechsel (`current`-Attribut, `TabSelect`).
- Anhänge-Bereich unter dem Tagesplan der Mailansicht, per Teiler verschiebbar: Anhänge der gewählten Mail oder der Unterhaltung (Pille „Mail | Unterhaltung“); Zeile `.sa-row` = Name, Größe, Absender · Datum · Betreff; Klick springt zur Mail. Thread über `msgDatabase.getThreadContainingMsgHdr` + Gloda; Anhänge per `MsgHdrToMimeMessage` (gecacht, 300 Einträge); Mails ohne Anhang-Merkmal nur bei kleinen Unterhaltungen (≤ 12) und nur wenn lokal.
- Test-Falle: mit `addMessage` angelegte Testmails liefern nur für die letzte Mail ein MimeMessage → echte mbox schreiben und `displayFolder` (so macht es `func.py`). Ohne Kalender bleibt die rechte Leiste unsichtbar → im Test einen Kalender anlegen.

## Anhang-Vorschau (`experiments/attachPreview/`)
- Fenster neben dem Anhang nach 0,2–1,5 s (Standard 0,4 s; `previewEnabled`/`previewDelay`): scrollbares pdf.js bzw. Bild (png, jpg, gif, webp, bmp, avif; kein SVG, max. 15 MB); „Öffnen“ = eigener Tab, ✕/Esc/Mausverlassen schließen. Fundstellen: rechte Leiste `.sa-row`, Nachrichtenkopf `#attachmentList > richlistitem`, Chips `.nbc-chip` des Conversation-Add-ons (Zuordnung über Dateiname/Absender, weil keine Adresse im DOM; sauberer wäre ein `data-`Attribut am Chip).
- **PDF** = `MailE10SUtils.loadURI(browser, url + "&type=application/pdf")`; ab TB 157 enthält die URL schon `type=application%2Fpdf` → `withType()` hängt die unkodierte Form an, solange sie fehlt. Direktes `fixupAndLoadURIString` in ein `remote`-Element stürzt den Inhaltsprozess ab. **Pro Vorschau ein frisches `browser`-Element.** **Bilder:** `mailbox:`-Adresse bleibt leer → Bytes per `NetUtil.asyncFetch`, als `data:` laden (`win.btoa`). Koordinaten über `frameElement || browsingContext.embedderElement`, dann `el.ownerDocument.defaultView`. Meldung „tabbrowser is null“ ist harmlos.
- Manifest-Version mit Zusatz (`1.8.0RC`) erzeugt nur eine Warnung (Toolkit-Format), funktioniert.

## Nova-Contact (`experiments/novaContact/`, `pilot/`)
- Im Tab `about:addressbook` (Injektion per `ExtensionSupport.registerWindowListener`, `TabOpen`/`TabSelect`-Scan): Knopf „✦ Nova-Contact“ öffnet `pilot/ui/ui.html` (Sammeln, Zusammenführen, Aufräumen); Leiste über der Kontaktliste mit Tags-Filter (`searchInput.overrideSearchTerm()`), Bearbeiten (n) und Rückgängig (letzte 3, nur Arbeitsspeicher). Karten: `new AddrBookCard(); setProperty("_vCard", …)`; Kontakte über `messenger.contacts` (MV2; `pilot/ui/api.js` wählt V2 oder V3).
- Aufräumen (`ui/cleanup.js`): Mailverkehr auswerten, filtern, löschen mit Wiederherstellungspunkt (`storage.local`, letzte 3) und .vcf-Sicherung. Nicht umgesetzt: Signaturen als Kontakt übernehmen. **Entfallen** gegenüber dem alten Nova-Calendar: „Termine oben/unten“.

## Stolpersteine
- Nach Installation einer neuen Version Betterbird neu starten, sonst bleibt die alte aktiv.
- Dialogfenster (Termin) erreicht das Theme nicht → Extension färbt sie (liest Farben aus dem Hauptfenster). Verfassen-Fenster lädt keine `data:`-SVGs.
- Schriftgrößen: ca. 70 feste px-Werte; unter Windows wirkt die Betterbird-Oberfläche selbst klein (Standard 8,4 px bei 4K), das ist kein Add-on-Fehler (`mail.uifontsize` anheben). Umbau auf `em` + Regler nur als spätere Verbesserung.
- Nova-Contact-Seite `pilot/ui/ui.css`: die Klasse `.num` ist der runde Schritt-Zähler; Tabellenzellen `td.num/th.num` setzen das Kreisformat zurück (Fehler bis 1.9.2: „Count/Last“ als blaue Kreise).
- Offen: Tags in Nova-Contact verschwinden beim Nutzer (Labor mit lokalem Adressbuch: speichern). Verdacht CardDAV; Code `setTags` + `dirOf(card).modifyCard(card)`.
- Vor jeder Freigabe: `smoke.py`, `func.py` und **`permtest.sh`** (Beenden mit fest installiertem Add-on).
