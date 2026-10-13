# NovaBird – Kurzhandbuch

NovaBird ist eine Familie von Add-ons für **Betterbird** (und Thunderbird ESR, ab Version 128). Die Add-ons arbeiten einzeln, ergänzen sich aber. Dieses Handbuch ist bewusst kurz; Einzelheiten stehen in der README jedes Add-ons.

> Die Add-ons laufen nur in **Betterbird** oder **Thunderbird ESR**, nicht im monatlichen Thunderbird-Release. Alle Pakete sind unsignierte Entwicklerbuilds.

## 1. Überblick

| Add-on | Was es tut |
|---|---|
| **NovaBird-Search** | Eine Suchleiste statt zwei, Treffer beim Tippen, strikt nach Datum |
| **NovaBird-DB** | Eigener Suchindex (schnell, findet auch Wortteile und Sätze), Grundlage für Search und Conversation |
| **NovaBird-Conversation** | Alle Nachrichten einer Konversation im Lesebereich |
| **NovaBird-Send** | Senden mit Rückgängig-Fenster und Warteschlange |
| **NovaBird-Extension** | Rechte Leiste (Termine, Aufgaben, Anhänge), Anhang-Vorschau, Nova-Contact, Einstellungen im neuen Stil |
| **NovaBird-Sand / -Cobalt / -Springlight** | Themes (hell und dunkel) |

## 2. Installieren

> **Bitte zuerst den [Disclaimer](README.de.md#disclaimer) lesen:** inoffiziell, experimentell, Nutzung auf eigene Gefahr, Profil vorher sichern.

1. **Alte Add-ons entfernen**, falls vorhanden (Such-Pilot, DB-Pilot, Sende-Pilot, Conversation-Pilot, Stream Extension, Kalender-/Kontakt-Pilot, Stream-Themes). Altes und neues Add-on nie gleichzeitig.
2. **Add-ons-Manager** öffnen (Menü → Add-ons und Themes), Zahnrad → **„Add-on aus Datei installieren“**, die `.xpi` wählen. Reihenfolge: **DB**, Search, Conversation, Send, Extension. Die Themes unter „Themes“ installieren und aktivieren. **Schneller:** im Dateifenster alle `.xpi` auf einmal markieren (Strg+A) oder alle zusammen auf den Add-ons-Manager ziehen; Betterbird fragt dann je Add-on einmal nach (Reihenfolge egal).
3. **Betterbird neu starten.**
4. **Erster Start mit NovaBird-DB:** Der Suchindex wird einmal aufgebaut (bei 75.000 Mails etwa 6 Minuten). Ein Fortschrittsfenster unten zeigt den Stand. Betterbird bleibt benutzbar, die Suche nutzt in der Zeit Betterbirds eigenen Index (Hinweis in der Leiste). Anhalten und Fortsetzen ist jederzeit möglich.

Nach einem Update einer Version: Betterbird neu starten, sonst bleibt die alte aktiv.

## 3. Alle Einstellungen an einem Ort

Mit der **NovaBird-Extension**: **Einstellungen → NovaBird** (links in der Liste). Dort gibt es einen Reiter je installiertem Add-on: Suche, Datenbank, Konversation, Senden, Extension. Die Einstellungen sind dieselben wie im Add-ons-Manager. Jede Option ist erklärt, wichtige mit einer kleinen Skizze. Änderungen wirken sofort.

## 4. Suchen (NovaBird-Search + NovaBird-DB)

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

### Sätze (mit NovaBird-DB)

Beispiele, die gleichwertig in Deutsch, Englisch, Französisch und Spanisch funktionieren:

- „Rechnungen von Petra aus den letzten 6 Monaten“ · „invoices from Petra in the last 6 months“ · „factures de Petra des 6 derniers mois“ · „facturas de Petra en los últimos 6 meses“
- „ungelesene Mails mit Anhang seit März“ · „unread mail with attachment since March“
- „was hat Jonas mir geschickt“ · „what did Jonas send me“

Verstanden werden Personen (von, an, „von mir“), Zeiträume (gestern, letzte Woche, im Mai 2025, zwischen …), Anhänge (mit PDF, ohne Anhang), Status, Ordner, „oder“ und Verneinung („ohne“). Zusammengesetzte deutsche Wörter werden gefunden („Speiseplan“ findet „Wochenspeiseplan“).

**Suchsprache:** Standard sind Englisch und die Sprache von Betterbird (bei Deutsch also Deutsch und Englisch). In den NovaBird-DB-Einstellungen lässt sich das ändern; mit mehreren Sprachen können kurze mehrdeutige Wörter wie „an“ falsch gedeutet werden. Französisch und Spanisch sind noch nicht von Muttersprachlern geprüft.

## 5. Konversationen lesen (NovaBird-Conversation)

Beim Öffnen einer Nachricht erscheinen **alle Nachrichten der Konversation** (über alle Ordner, auch Gesendet): die neueste oben fixiert, ältere darunter als Zeile mit Vorschau, ungelesene und die letzten aufgeklappt. Ein Klick klappt auf oder zu.

- **Je Nachricht:** Antworten, Allen antworten, Weiterleiten, Als neu bearbeiten, Löschen, Spam. **Original** zeigt Betterbirds eigene Ansicht.
- **Aufklappen beim Scrollen** (Option): die Zeile unter dem Mauszeiger klappt auf, wenn der Zeiger kurz stehen bleibt (50–200 ms).
- **Stile:** Sanft, Klar, Faden. Externe Bilder erst nach Klick.
- Ohne NovaBird-DB funktioniert es ebenfalls (über Gloda), nur etwas langsamer.

## 6. Senden mit Rückgängig (NovaBird-Send)

Nach **Senden** verschwindet das Verfassen-Fenster, unten im Hauptfenster läuft ein Countdown (Standard 10 s).

- **Rückgängig** holt das Fenster unverändert zurück. **Jetzt senden** überspringt die Wartezeit.
- Mehrere Mails stehen in einer **Warteschlange**.
- **Beenden** während der Wartezeit speichert die Mails als Entwurf. Bei Versandfehlern kommt das Fenster zurück.
- Nicht betroffen: „Später senden“ und Senden ohne Verbindung.

## 7. Rechte Leiste, Vorschau, Kontakte (NovaBird-Extension)

- **Rechte Leiste** in Mail, Kalender und Aufgaben: Tagesplan, Aufgaben und ein **Anhänge-Bereich** (Anhänge der gewählten Mail oder der Unterhaltung; Klick springt zur Mail). Wahlweise Betterbird-Standard.
- **Anhang-Vorschau:** Maus über einen PDF- oder Bild-Anhang halten (in der rechten Leiste, im Nachrichtenkopf, an den Conversation-Chips): ein scrollbares Vorschaufenster öffnet sich.
- **Nova-Contact** (Kontakte-Tab): Tags als Filter, mehrere Kontakte gemeinsam bearbeiten, letzte Änderungen rückgängig, Knopf „✦ Nova-Contact“ zum Sammeln, Zusammenführen und Aufräumen (mit Wiederherstellungspunkt).
- Einstellungen, Konten und Add-ons-Manager im einheitlichen Stil; Farben vom Theme.

## 8. Themes

NovaBird-Sand (ruhig, warm), -Cobalt (kompakt, kräftig), -Springlight (hell, frisch). Jedes Theme folgt dem Hell/Dunkel-Modus des Betriebssystems. Die Extension übernimmt die Themefarben für Dialoge, Einstellungen und die rechte Leiste.

## 9. Datenschutz

- Alles läuft **lokal**. Kein Add-on greift auf das Netz zu (nur Conversation lädt externe Bilder, und erst nach deinem Klick).
- Der **Suchindex** liegt unverschlüsselt im Profilordner (`novabird-db/index.sqlite`) und enthält Mailtext und Anhangnamen, wie der Index von Betterbird selbst. Wer sein Profil sichert oder die Festplatte nicht verschlüsselt, sichert den Mailtext mit. NovaBird-DB → „Index löschen“ entfernt ihn.
- NovaBird-DB schreibt die bestätigten Suchanfragen **lokal** mit (zur späteren Verbesserung des Parsers; nichts verlässt den Rechner). Abschaltbar und löschbar unter NovaBird-DB → „Suchprotokoll“.

## 10. Wenn etwas nicht klappt

| Problem | Lösung |
|---|---|
| Add-on als „beschädigt“ oder „nicht kompatibel“ | Läuft Betterbird / Thunderbird **ESR**? Die Add-ons brauchen Experiment-APIs; im Release-Kanal gehen sie nicht. |
| Suchleiste zeigt „Gloda-Suche“ | NovaBird-DB fehlt, baut den Index noch auf oder ist beschädigt: Einstellungen → NovaBird → Datenbank. Dort „Index neu aufbauen“ (der alte bleibt bis zum Ende erhalten). |
| Einstellungsseite „NovaBird“ fehlt oder ist leer | NovaBird-Extension installiert und Betterbird neu gestartet? Reiter erscheinen nur für aktive Add-ons. |
| Indexaufbau hängt oder wird nie fertig (Protokoll: „Keine Fortschritte seit … s“ oder „Mail übersprungen“) | **Zuerst den betroffenen Ordner reparieren:** Rechtsklick auf den Ordner → Eigenschaften → **Ordner reparieren**; im Zweifel alle lokalen Ordner reparieren. Danach unter Einstellungen → NovaBird → Datenbank „Index jetzt prüfen“. Mehr Details liefert dort das ausführliche Indexprotokoll. |
| Einstellungsseite eines Add-ons zeigt „Nicht alle Funktionen verfügbar“ (meist nach einem Betterbird-Update) | Das Add-on hat festgestellt, dass sich in Betterbird etwas geändert hat, worauf es angewiesen ist; nur die aufgeführten Funktionen sind aus, alles andere läuft. Nach einer neueren NovaBird-Version schauen. |
| Nichts verändert sich nach einem Update | Betterbird einmal neu starten. |
| Beenden dauert ungewöhnlich lange | Kurz warten (wartende Mails in NovaBird-Send werden erst als Entwurf gespeichert). Hängt es weiter, danach die Fehlerkonsole öffnen und die Meldungen mit „NovaBird“ bereithalten. |
| Fehler melden | **Fehlerkonsole** (Strg+Umschalt+J), Meldungen mit „NovaBird“ kopieren; dazu: welches Add-on, was erwartet, was passiert. Keine Mails oder Adressen mitschicken. |

## 11. Bekannte Grenzen

- Der Parser für Sätze ist regelbasiert. Seltene Formulierungen werden nicht erkannt; die Kurzschreibweise geht immer.
- Bunte Newsletter erscheinen in der Konversationsansicht bewusst schlicht („Original“ zeigt sie wie gewohnt).
- Vorschau gibt es nur für PDF und Bilder.
- Nicht lokal gespeicherte IMAP-Mails sind nur mit Kopfdaten im Index.

Lizenz: MIT (siehe `LICENSE`).
