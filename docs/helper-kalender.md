# Team-Kalender im NovaBird Helper (Bewertung, 31.10.2026)

Wunsch: Aufgaben und Termine (auch die aus der KI) sollen nicht nur „für mich“ gelten, sondern für das Team – ohne
OwnCloud/Nextcloud. Der Helper soll einen Kalender bereitstellen, mit dem mehrere Thunderbird synchronisieren; wer welchen
Kalender sieht und bearbeiten darf, wird in der Web-Oberfläche des Helpers festgelegt.

## Ergebnis: machbar, passt gut

- **Thunderbird kann CalDAV von Haus aus** (Termine und Aufgaben, Abgleich, Offline-Zwischenspeicher). Bietet der Helper
  einen CalDAV-Server an, braucht Thunderbird kein zusätzliches Add-on: „Neuer Kalender → Im Netzwerk → Adresse des
  Helpers“, Thunderbird findet die freigegebenen Kalender selbst.
- **Handys gleich mit:** Android (DAVx⁵) und iOS (eingebaut) sprechen ebenfalls CalDAV – ein erster Schritt zur Idee
  „NovaBird mobil“.
- **Passt zum Helper:** Web-Oberfläche, eigene Benutzer, HTTPS im Netz und Firewall-Regel gibt es schon.

## Vorschlag zum Aufbau

| Teil | Inhalt |
|---|---|
| Adresse | `https://<Helper-PC>:47532/dav/` (gleicher Port wie die Web-Oberfläche, im Netz nur HTTPS) |
| Anmeldung | Benutzer des Helpers (HTTP Basic über HTTPS); Thunderbird merkt sich das Passwort |
| Kalender | in der Web-Oberfläche anlegen, umbenennen, Farbe, löschen; je Kalender Rechte je Benutzer: lesen / schreiben |
| Speicherung | je Eintrag eine .ics-Datei im Datenordner, ETag je Eintrag, Änderungsprotokoll für den Abgleich |
| Protokoll | WebDAV/CalDAV-Teilmenge: PROPFIND (Benutzer, Kalenderliste, ctag/sync-token), REPORT (calendar-multiget, sync-collection, calendar-query), GET/PUT/DELETE mit If-Match (Konflikte), Termine und Aufgaben (VEVENT/VTODO) |
| Nicht | Einladungen per Mail (CalDAV-Scheduling), Frei/Belegt – nicht nötig für ein Team-Kalender |
| Sicherung | Export/Wiederherstellen in der Web-Oberfläche (wie gewünscht auch für die Vektoren) |

Thunderbird-Seite (NovaBird-Extension), danach:
- „Team-Kalender des Helpers einbinden“ mit einem Klick (Experiment: Netzwerk-Kalender anlegen).
- „Aufgaben für heute“ im Überblick und „Im Kalender prüfen“: Kalender wählbar, auch der Team-Kalender.

## Alternative

Radicale (kleiner, ausgereifter CalDAV-Server in Python) könnte der Helper wie Ollama verwalten (herunterladen, starten,
Rechte-Datei aus der Web-Oberfläche schreiben). Vorteil: erprobt. Nachteil: eingebettetes Python, weniger aus einem Guss.
Empfehlung: eigene schlanke Umsetzung in C#, weil Benutzer, Rechte, HTTPS und Oberfläche schon im Helper sind.

## Aufwand und Risiken

- Aufwand: mittel (Server-Teil etwa 1.500–2.500 Zeilen C# mit Tests), plus Tests mit Thunderbird 153/159, DAVx⁵, iOS.
- Risiken: Abgleich-Feinheiten (ETag, sync-token), Serienterminen bei Zeitraum-Abfragen (Einträge unverändert speichern,
  im Zweifel alles liefern – Thunderbird filtert selbst), Zeitzonen (unverändert durchreichen).
- Der Helper-PC wird zur zentralen Ablage: Sicherung/Export und Verfügbarkeit (Thunderbird arbeitet offline weiter und
  gleicht später ab).

## Schritte

1. CalDAV-Grundlage im Helper + Kalender und Rechte in der Web-Oberfläche; Tests mit Thunderbird 153/159.
2. Extension: Team-Kalender einbinden, Kalenderwahl bei Aufgaben/Terminen aus der KI.
3. Handys (DAVx⁵, iOS) testen und beschreiben.
4. Später: Adressbuch (CardDAV) nach demselben Muster.
