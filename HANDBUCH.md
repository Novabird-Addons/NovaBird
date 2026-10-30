# NovaBird – Kurzhandbuch

NovaBird ist eine Familie von Add-ons für **Betterbird** (und Thunderbird ESR, ab Version 128). Die Add-ons arbeiten einzeln, ergänzen sich aber. Dieses Handbuch ist bewusst kurz; Einzelheiten stehen in der README jedes Add-ons.

> Die Add-ons laufen nur in **Betterbird** oder **Thunderbird ESR**, nicht im monatlichen Thunderbird-Release. Alle Pakete sind unsignierte Entwicklerbuilds.

## 1. Überblick

| Add-on | Was es tut |
|---|---|
| **NovaBird-Search** | Eine Suchleiste statt zwei, Treffer beim Tippen, strikt nach Datum; mit eigenem Suchindex (schnell, findet auch Wortteile und Sätze), den auch Conversation nutzt |
| **NovaBird-Conversation** | Alle Nachrichten einer Konversation im Lesebereich |
| **NovaBird-Send** | Senden mit Rückgängig-Fenster und Warteschlange |
| **NovaBird-Extension** | Rechte Leiste (Termine, Aufgaben, Anhänge), Anhang-Vorschau, Nova-Contact, Regel-Assistent (Beta), Designs Sand, Cobalt und Springlight (hell und dunkel), Farben und Schrift, KI-Zusammenfassung (Opt-in), Postfach-Übersicht, Einstellungen im neuen Stil |

Ab Version 2.0 sind es vier Add-ons: Der Suchindex (bis dahin „NovaBird-DB“) gehört zu NovaBird-Search, die Themes gehören zur Extension.

## 2. Installieren

> **Bitte zuerst den [Disclaimer](README.de.md#disclaimer) lesen:** inoffiziell, experimentell, Nutzung auf eigene Gefahr, Profil vorher sichern.

1. **Alte Add-ons entfernen**, falls vorhanden (Such-Pilot, DB-Pilot, Sende-Pilot, Conversation-Pilot, Stream Extension, Kalender-/Kontakt-Pilot, Stream-Themes). Altes und neues Add-on nie gleichzeitig.
2. **Add-ons-Manager** öffnen (Menü → Add-ons und Themes), Zahnrad → **„Add-on aus Datei installieren“**, die `.xpi` wählen. Reihenfolge: Search, Conversation, Send, Extension. **Schneller:** im Dateifenster alle `.xpi` auf einmal markieren (Strg+A) oder alle zusammen auf den Add-ons-Manager ziehen; Betterbird fragt dann je Add-on einmal nach (Reihenfolge egal).
3. **Betterbird neu starten.**
4. **Erster Start mit NovaBird-Search:** Der Suchindex wird einmal aufgebaut (bei 75.000 Mails etwa 6 Minuten). Ein Fortschrittsfenster unten zeigt den Stand. Betterbird bleibt benutzbar, die Suche nutzt in der Zeit Betterbirds eigenen Index (Hinweis in der Leiste). Anhalten und Fortsetzen ist jederzeit möglich.

Nach einem Update einer Version: Betterbird neu starten, sonst bleibt die alte aktiv.

**Umstieg von 1.x auf 2.0:** Einfach NovaBird-Search 2.0 und die Extension 2.0 über die alten Pakete installieren. Das alte NovaBird-Search und die alten Themes werden beim ersten Start übernommen und entfernt: Einstellungen, Suchverlauf, Suchindex und das gewählte Theme bleiben erhalten (das Theme ist danach unter Farben und Schrift → Design gewählt).

## 3. Alle Einstellungen an einem Ort

Mit der **NovaBird-Extension**: **Einstellungen → NovaBird** (links in der Liste). Dort gibt es einen Reiter je installiertem Add-on: Suche, Konversation, Senden, Extension. Die Suche hat zwei Unterreiter: „Suche“ und „Index“. Die Einstellungen sind dieselben wie im Add-ons-Manager. Jede Option ist erklärt, wichtige mit einer kleinen Skizze. Änderungen wirken sofort.

## 4. Suchen (NovaBird-Search)

- **Eingabe** in der Leiste über der Nachrichtenliste (Strg+K springt hin). Links im Feld wählst du *Alle Ordner* oder *Aktueller Ordner*. Ab drei Zeichen erscheinen Treffer beim Tippen (Enter erzwingt kürzere).
- **Zahnrad:** Suche in Von / An / Betreff / Nachricht, nur mit Anhang, nur ungelesen, Papierkorb, Spam. **Chips:** Alle, Heute, 3, 7, 30 Tage.
- **Enter** fragt (einmal merkbar): *Filtern* (Treffer in neuem Tab, dort weiter eingrenzen) oder *Auswerten* (Analyseseite mit Zeitleiste und Filtern).
- **„Meinten Sie …?“** bei null Treffern, **Verlauf** unter dem Feld.
- **Gemeinsame Ordner** (oben im Ordnerbereich): Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage (Nachricht per Rechtsklick hinzufügen).

### Kurzschreibweise (immer, in jeder Sprache)

| Zweck | Deutsch | Englisch | Französisch | Spanisch |
|---|---|---|---|---|
| Absender | `von:` | `from:` | `de:` | `de:` |
| Empfänger | `an:` | `to:` | `à:` `pour:` | `para:` |
| Betreff | `betreff:` | `subject:` | `objet:` `sujet:` | `asunto:` |
| Text | `text:` | `text:` `body:` | `texte:` | `texto:` |
| Anhang | `anh:ja` | `attachment:yes` | `pj:oui` | `adjunto:sí` |
| ab Datum | `seit:` `ab:` | `since:` `after:` | `depuis:` | `desde:` |
| bis Datum | `bis:` | `until:` `before:` | `jusque:` `avant:` | `hasta:` |
| Status | `ungelesen` `markiert` | `unread` `flagged` | `nonlu` `marqué` | `noleído` `marcado` |
| Bereich | `hier` `überall` | – | `ici` `partout` | `aquí` |

Datum: `2026-01-31`, `31.01.2026`, `31/01/2026` oder relativ `7t` (Tage), `3w`, `6m`, `1j`.

### Sätze (mit dem eigenen Suchindex)

Beispiele, die gleichwertig in Deutsch, Englisch, Französisch und Spanisch funktionieren:

- „Rechnungen von Petra aus den letzten 6 Monaten“ · „invoices from Petra in the last 6 months“ · „factures de Petra des 6 derniers mois“ · „facturas de Petra en los últimos 6 meses“
- „ungelesene Mails mit Anhang seit März“ · „unread mail with attachment since March“
- „was hat Jonas mir geschickt“ · „what did Jonas send me“

Verstanden werden Personen (von, an, „von mir“), Zeiträume (gestern, letzte Woche, im Mai 2025, zwischen …), Anhänge (mit PDF, ohne Anhang), Status, Ordner, „oder“ und Verneinung („ohne“). Zusammengesetzte deutsche Wörter werden gefunden („Speiseplan“ findet „Wochenspeiseplan“).

**Suchsprache:** Standard sind Englisch und die Sprache von Betterbird (bei Deutsch also Deutsch und Englisch). In den Einstellungen der Suche unter „Index“ lässt sich das ändern; mit mehreren Sprachen können kurze mehrdeutige Wörter wie „an“ falsch gedeutet werden. Französisch und Spanisch sind noch nicht von Muttersprachlern geprüft.

### Semantische Suche (Beta, standardmäßig aus)
Findet Mails auch nach ihrer **Bedeutung**: „Treffen der Eltern“ findet den „Elternabend“, „Ferien am Meer“ die Hotelbuchung. Einschalten in den Einstellungen der Suche, Reiter **Semantische Suche**; dort einmal **„Modell laden“** (etwa 320 MB von Hugging Face, jede Datei mit Prüfsumme). Danach rechnet NovaBird-Search die Mails im Hintergrund durch, die neuesten zuerst, ältere nur im Leerlauf. Die Treffer ergänzen die normale Suche; die Leiste zeigt „+N ähnlich“. Unter *Erweitert*: Rechenweg, Threads, wie lange das Modell im Speicher bleibt (etwa 2 GB), Strenge, Export/Import der Vektoren.

**NovaBird Helper (Windows, optional):** rechnet auf der Grafikkarte, bei 70.000 Mails etwa 20 Minuten statt mehrerer Stunden. Installation per Doppelklick, nur für den eigenen Windows-Benutzer, ohne Adminrechte; danach unter *Erweitert* „Helper verbinden“ und „Modell im Helper laden“. Mit dem Helper lassen sich die Vektoren über einen gemeinsamen Ordner (NAS, OneDrive …) verschlüsselt zwischen PCs teilen (Kopplungscode). Mehr: [novabird-helper/README.md](novabird-helper/README.md).

**Ein PC rechnet für mehrere (optional):** Der NovaBird Helper hat einen Netz-Modus: Auf dem PC mit der starken Grafikkarte im Startmenü „NovaBird Helper (Netz)“ starten (Symbol im Infobereich; ein Klick zeigt Adresse und Kopplungscode). Auf den anderen PCs unter *Erweitert* den Rechenweg „Anderer PC oder Server“ wählen, Schnittstelle „NovaBird Helper (Netz)“, Adresse und Code eintragen. Anfragen und Antworten sind mit dem Code verschlüsselt; Suchanfragen gehen vor, beim Indexieren kommen die PCs abwechselnd dran. Mehr: [novabird-helper/README.md](novabird-helper/README.md).

**Eigener Server (optional):** Statt Add-on oder Helper kann auch Ollama oder ein OpenAI-kompatibler Dienst (LM Studio, llama.cpp, vLLM …) rechnen, auf diesem PC oder auf einem anderen Rechner im Netz. *Erweitert* → Rechenweg „Anderer PC oder Server“, Schnittstelle Ollama bzw. OpenAI-kompatibel, Adresse und Modell eintragen (in Ollama `jina/jina-embeddings-v2-base-de`), „Speichern und prüfen“. Der Server muss dasselbe Modell benutzen: Vor dem ersten Einsatz, danach stündlich und nach jedem Fehler rechnet er sechs Probetexte, und nur wenn seine Vektoren zu denen des Add-ons passen, kommen sie in den Index. Ein anderes Modell oder eine stark komprimierte Fassung wird abgelehnt, die Suche bleibt dann unverändert. Dasselbe prüft NovaBird auch beim Add-on und beim Helper.

## 5. Konversationen lesen (NovaBird-Conversation)

Beim Öffnen einer Nachricht erscheinen **alle Nachrichten der Konversation** (über alle Ordner, auch Gesendet): die neueste oben fixiert, ältere darunter als Zeile mit Vorschau, ungelesene und die letzten aufgeklappt. Ein Klick klappt auf oder zu.

- **Je Nachricht:** Antworten, Allen antworten, Weiterleiten, Als neu bearbeiten, Löschen, Spam. **Originalansicht** zeigt Betterbirds eigene Ansicht.
- **Aufklappen beim Scrollen** (Option): die Zeile unter dem Mauszeiger klappt auf, wenn der Zeiger kurz stehen bleibt (50–200 ms).
- **Stile:** Sanft, Klar, Faden. Externe Bilder erst nach Klick.
- Ohne NovaBird-Search funktioniert es ebenfalls (über Gloda), nur etwas langsamer.

## 6. Senden mit Rückgängig (NovaBird-Send)

Nach **Senden** verschwindet das Verfassen-Fenster, unten im Hauptfenster läuft ein Countdown (Standard 10 s).

- **Rückgängig** holt das Fenster unverändert zurück. **Jetzt senden** überspringt die Wartezeit.
- Mehrere Mails stehen in einer **Warteschlange**.
- **Beenden** während der Wartezeit speichert die Mails als Entwurf. Bei Versandfehlern kommt das Fenster zurück.
- Nicht betroffen: „Später senden“ und Senden ohne Verbindung.

## 7. Rechte Leiste, Vorschau, Kontakte (NovaBird-Extension)

- **Rechte Leiste** in Mail, Kalender und Aufgaben: Tagesplan, Aufgaben und ein **Anhänge-Bereich** (Anhänge der gewählten Mail oder der Unterhaltung; Klick springt zur Mail). Wahlweise Betterbird-Standard.
- **Anhang-Vorschau:** Maus über einen PDF- oder Bild-Anhang halten (in der rechten Leiste, im Nachrichtenkopf, an den Conversation-Chips): ein scrollbares Vorschaufenster öffnet sich.
- **Regel-Assistent (Beta, standardmäßig aus):** in den Einstellungen der Extension unter „Regeln (Beta)“ einschalten. Rechtsklick auf eine Mail in der Liste → „Regel aus dieser Mail erstellen …“: Bedingung wählen (dieser Absender, diese Domain, Betreff, Empfänger), sehen, welche Mails im Posteingang passen, Aktionen wählen (verschieben, Schlagwort, gelesen, Stern, Papierkorb) und speichern. Es entsteht ein normaler Betterbird-Filter (Extras → Nachrichtenfilter); bestehende Filter bleiben unverändert und werden vorher gesichert.
- **Nova-Contact** (Kontakte-Tab): Tags als Filter, mehrere Kontakte gemeinsam bearbeiten, letzte Änderungen rückgängig, Knopf „✦ Nova-Contact“ zum Sammeln, Zusammenführen und Aufräumen (mit Wiederherstellungspunkt).
- **Farben und Schrift** (Einstellungen der Extension): oben das **Design** wählen (Sand, Cobalt, Springlight oder das Theme aus dem Add-ons-Manager); mit Cobalt oder Springlight lässt sich jede Farbe des Hauptfensters ändern (hell und dunkel getrennt, eine Skizze zeigt den betroffenen Bereich); Schriftgrößen von Hauptfenster, Verfassen-Fenster, Einstellungsseiten und Nova-Contact in Prozent.
- **KI-Zusammenfassung (standardmäßig aus):** „Mail zusammenfassen (KI)“ im Nachrichtenkopf und in Conversation, mit einem Sprachmodell deiner Wahl (siehe Datenschutz unten).
- **Postfach:** Ordner, Nachrichten und Größe je Konto, die größten Ordner.
- **Anhänge öffnen und speichern** aus der rechten Leiste und der Konversationsansicht: Rechtsklick → „Öffnen“ / „Speichern unter …“; in der rechten Leiste öffnet ein Doppelklick den Anhang.
- **Screen Scaling (experimentell, standardmäßig aus):** passt die Skalierung des Fensters automatisch an, wenn sich die Bildschirmauflösung ändert, z. B. bei wechselnden Remoteverbindungen. Die Aufteilung des Hauptfensters (Ordnerbereich, Lesebereich) behält dabei grob ihre Anteile.
- **Online-Updates (Beta, standardmäßig aus):** hält alle NovaBird-Pakete auf dem Stand des Kanals „Stabil“ oder „Testing“ und installiert fehlende nach (siehe Datenschutz unten).
- Einstellungen, Konten und Add-ons-Manager im einheitlichen Stil; Farben vom Theme.

## 8. Designs (Themes)

Sand (ruhig, warm), Cobalt (kompakt, kräftig), Springlight (hell, frisch) sind in der Extension enthalten: Einstellungen der Extension → Farben und Schrift → **Design**. Jedes Design folgt dem Hell/Dunkel-Modus des Betriebssystems. Solange eines gewählt ist, gilt es statt des Themes im Add-ons-Manager; „Thunderbird-Theme“ gibt das Aussehen an das Theme im Add-ons-Manager zurück. Die Extension übernimmt die Farben für Dialoge, Einstellungen und die rechte Leiste.

## 9. Datenschutz

- Alles läuft **lokal**. Kein Add-on greift auf das Netz zu (nur Conversation lädt externe Bilder, und erst nach deinem Klick). Eine freiwillige Ausnahme: die **KI-Zusammenfassung** der NovaBird-Extension (Einstellungen → NovaBird → Extension → KI) ist aus, bis du sie in den Einstellungen einschaltest und die Adresse eines Sprachmodell-Servers einträgst (Ollama oder ein OpenAI-kompatibler Dienst). Erst wenn du „Mail zusammenfassen (KI)“ anklickst, geht der Text genau dieser Nachricht an diese Adresse. Mit Ollama auf dem eigenen Rechner verlässt er den Rechner nicht, bei einem entfernten Server schon, und die Einstellungsseite weist darauf hin. Zugangsdaten liegen unverschlüsselt in den Profildaten des Add-ons.
- Zweite freiwillige Ausnahme: die **Online-Updates** der NovaBird-Extension (Einstellungen → NovaBird → Extension → Online-Updates), standardmäßig aus. Eingeschaltet fragt die Extension bei GitHub (Repo Nova-Bird-Online-Updates) nach neuen Versionen der NovaBird-Pakete, beim Start höchstens einmal am Tag und wenn du „Jetzt prüfen“ klickst. Dabei geht nur die übliche Webanfrage hinaus, keine Daten aus Thunderbird; jedes Paket wird vor der Installation mit seiner SHA-256-Prüfsumme geprüft.
- Der **Suchindex** liegt unverschlüsselt im Profilordner (`novabird-db/index.sqlite`) und enthält Mailtext und Anhangnamen, wie der Index von Betterbird selbst. Wer sein Profil sichert oder die Festplatte nicht verschlüsselt, sichert den Mailtext mit. Einstellungen der Suche → Index → „Index löschen“ entfernt ihn.
- NovaBird-Search schreibt die bestätigten Suchanfragen **lokal** mit (zur späteren Verbesserung des Parsers; nichts verlässt den Rechner). Abschaltbar und löschbar unter Einstellungen der Suche → Index → „Suchprotokoll“.

- **Semantische Suche** (aus, bis du sie einschaltest): Netz nur, wenn du „Modell laden“ klickst (huggingface.co, feste Version, Prüfsumme). Die Vektoren liegen im Profil; sie verraten grob, worum es in einer Mail geht, enthalten aber keinen Text. Der NovaBird Helper rechnet auf diesem PC; der Ordner-Sync legt nur verschlüsselte Pakete (Message-ID und Vektor) in den gewählten Ordner. Mit dem **NovaBird Helper im Netz-Modus** gehen Betreff und Text (gekürzt) jeder Mail verschlüsselt an den Rechen-PC. Mit einem **eigenen Server** gehen sie an die eingetragene Adresse; auf diesem PC (localhost) verlassen sie ihn nicht, bei einer anderen Adresse schon, und die Einstellungsseite weist darauf hin. Thunderbird fragt beim ersten Prüfen nach der Erlaubnis für genau diese Adresse. Zugangsdaten liegen unverschlüsselt in den Profildaten des Add-ons.

## 10. Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Add-on als „beschädigt“ oder „nicht kompatibel“ | Läuft Betterbird / Thunderbird **ESR**? Die Add-ons brauchen Experiment-APIs; im Release-Kanal gehen sie nicht. |
| Suchleiste zeigt „Gloda-Suche“ | Der Suchindex startet noch, baut sich auf oder ist beschädigt: Einstellungen → NovaBird → Suche → Index. Dort „Index neu aufbauen“ (der alte bleibt bis zum Ende erhalten). |
| Einstellungsseite „NovaBird“ fehlt oder ist leer | NovaBird-Extension installiert und Betterbird neu gestartet? Reiter erscheinen nur für aktive Add-ons. |
| Indexaufbau hängt oder wird nie fertig (Protokoll: „Keine Fortschritte seit … s“ oder „Mail übersprungen“) | **Zuerst den betroffenen Ordner reparieren:** Rechtsklick auf den Ordner → Eigenschaften → **Ordner reparieren**; im Zweifel alle lokalen Ordner reparieren. Danach unter Einstellungen → NovaBird → Suche → Index „Index jetzt prüfen“. Mehr Details liefert dort das ausführliche Indexprotokoll. |
| Einstellungsseite eines Add-ons zeigt „Nicht alle Funktionen verfügbar“ (meist nach einem Betterbird-Update) | Das Add-on hat festgestellt, dass sich in Betterbird etwas geändert hat, worauf es angewiesen ist; nur die aufgeführten Funktionen sind aus, alles andere läuft. Nach einer neueren NovaBird-Version schauen. |
| Nichts verändert sich nach einem Update | Betterbird einmal neu starten. |
| Beenden dauert ungewöhnlich lange | Kurz warten (wartende Mails in NovaBird-Send werden erst als Entwurf gespeichert). Hängt es weiter, danach die Fehlerkonsole öffnen und die Meldungen mit „NovaBird“ bereithalten. |
| Fehler melden | **Fehlerkonsole** (Strg+Umschalt+J), Meldungen mit „NovaBird“ kopieren; dazu: welches Add-on, was erwartet, was passiert. Keine Mails oder Adressen mitschicken. |

## 11. Bekannte Grenzen

- Der Parser für Sätze ist regelbasiert. Seltene Formulierungen werden nicht erkannt; die Kurzschreibweise geht immer.
- Bunte Newsletter erscheinen in der Konversationsansicht bewusst schlicht („Originalansicht“ zeigt sie wie gewohnt).
- Vorschau gibt es nur für PDF und Bilder.
- Nicht lokal gespeicherte IMAP-Mails sind nur mit Kopfdaten im Index.

Lizenz: MIT (siehe `LICENSE`).
