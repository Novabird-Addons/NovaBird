# KI in NovaBird: Bedienkonzept und Entwurf „Einsortieren“

Stand 31.10.2026, Branch `novabird-2.0`.

## 1. Bedienkonzept

Leitlinie: **eine Stelle je Situation, wenige Klicks, nichts passiert ohne Bestätigung.** Die KI-Funktionen
verteilen sich nicht auf Kontextmenüs und Untermenüs, sondern auf drei feste Orte.

| Situation | Ort | Inhalt |
|---|---|---|
| Ich lese eine Mail | Knopf **„KI-Assistent“** in der Kopfzeile der Nachricht | Fenster mit Reitern **Zusammenfassung · Übersetzen · Termine** |
| Ich komme an den Rechner | Knopf **„Was gibt's Neues?“** oben in der Leiste (Mail-Bereich) | Überblick über die neuen Mails; Nummern öffnen die Mail |
| Ich schreibe eine Mail | (geplant) Knopf **„KI“** in der Symbolleiste des Verfassen-Fensters | Reiter **Antwort · Korrektur · Ton · Übersetzen**; Übernehmen nur per Klick |
| Mails kommen an | (geplant) keine Bedienung, läuft im Hintergrund | Schlagwörter an den Mails; Einstellungen unter „KI“ |

Gemeinsame Regeln für alle KI-Fenster:

- **Gleicher Aufbau:** Reiter oben, Ergebnis in der Mitte, unten links die Hauptaktion (hervorgehoben), daneben
  „Neu erstellen“/„Kopieren“, rechts der Link „Einstellungen“.
- **Der zuletzt benutzte Reiter öffnet wieder** (wer meist übersetzt, muss nicht jedes Mal umschalten). Jeder Reiter
  merkt sich sein Ergebnis; ein Wechsel rechnet nicht neu.
- **Ergebnis erscheint sofort beim Entstehen** (Text läuft mit), damit auch langsame Rechner nicht „hängen“.
- **Datenschutz sichtbar:** Geht Text an einen anderen Rechner, steht unter dem Ergebnis, wohin. Verdächtige
  Fremdanweisungen in Mails werden rot markiert.
- **Nichts ohne Rückfrage:** Termine öffnen den Termin-Dialog von Thunderbird zum Prüfen; eingetragen wird erst
  beim Speichern. Später beim Schreiben: Text wird erst mit „Übernehmen“ eingefügt.
- **Wenige Einstellungen:** Zielsprache und Zeitraum stehen direkt im Fenster (werden gemerkt), nicht in den Optionen.

Nächster Schritt dazu (Vorschlag): in den Einstellungen unter „KI“ je Funktion ein Schalter (Zusammenfassung,
Übersetzen, Termine, Überblick, Schreiben). Ausgeschaltete Reiter verschwinden aus dem Fenster; der Überblick-Knopf
wird grau.

## 2. Entwurf „Einsortieren“ (noch nicht gebaut)

Ziel: neue Mails bekommen automatisch passende **Schlagwörter** (z. B. Rechnung, Newsletter, Schule, Termin) –
bei jeder neuen Mail, also schnell, lokal und ohne den Rechner zu belasten.

### Grundidee: Vektoren statt Sprachmodell

NovaBird-Search rechnet für jede Mail ohnehin einen Vektor (semantische Suche). Einsortieren ist damit fast
kostenlos: Vergleich des neuen Vektors mit den Vektoren von Beispielmails je Schlagwort (Kosinus), Mikrosekunden je
Mail. Ein Sprachmodell (Sekunden je Mail, Grafikkarte) wäre für „jede neue Mail“ zu teuer und unnötig.

### Woher kommen die Kategorien?

1. **Aus vorhandenen Schlagwörtern:** Mails, die der Nutzer schon mit einem Schlagwort versehen hat, sind die
   Beispiele (ab etwa 5 Mails je Schlagwort). Kein Anlernen nötig.
2. **Aus einer Beschreibung:** „Rechnungen und Zahlungsaufforderungen“ – der Text wird wie eine Suchanfrage
   eingebettet (genau das macht die semantische Suche schon). Gut für den Start ohne Beispiele.
3. **Lernen aus Korrekturen:** Entfernt der Nutzer ein automatisch gesetztes Schlagwort oder setzt ein anderes,
   wird die Mail zum Gegenbeispiel bzw. Beispiel.

### Entscheidung je Mail

- Je Schlagwort: Ähnlichkeit zum Schwerpunkt der Beispiele und zu den 7 ähnlichsten Beispielen (kNN).
- Schwelle je Schlagwort, automatisch aus den Beispielen bestimmt (jedes Beispiel einmal herausnehmen und prüfen,
  ob es richtig erkannt würde); dazu ein Regler „vorsichtig ↔ großzügig“.
- Ein Schlagwort nur, wenn die Ähnlichkeit über der Schwelle liegt **und** klar vor dem zweitbesten liegt.
- Mails nur mit Betreff (IMAP ohne Offline-Kopie) werden übersprungen oder nur bei hoher Sicherheit sortiert.

### Ablauf bei neuer Mail

1. `messages.onNewMailReceived` (nach den Filtern von Thunderbird, nur Posteingänge).
2. NovaBird-Search rechnet den Vektor der neuen Mail **vorrangig** (eigene Warteschlange vor dem Nachindizieren).
3. Einordnen, Schlagwort setzen (`messages.update`, Berechtigung `messagesUpdate`/`messagesTags`).
4. Eintrag ins Protokoll (letzte 500): Mail, Schlagwort, Sicherheit, „Rückgängig“.

### Betriebsarten

- **Vorschlagen** (Standard für die ersten Wochen): nichts wird gesetzt; eine Liste „Vorschläge“ zeigt die
  Einordnung mit Sicherheit, Bestätigen macht die Mail zum Beispiel.
- **Automatisch:** Schlagwörter werden gesetzt. **Nie** verschieben oder löschen (das bleibt Sache der
  Thunderbird-Filter, die auf Schlagwörter reagieren können).

### Einstellungen (Reiter „KI“ → „Einsortieren“)

- Liste der Kategorien: Farbe/Name des Schlagworts, Quelle (Beispiele n / Beschreibung), Ein/Aus.
- Betriebsart, Regler „vorsichtig ↔ großzügig“.
- „Probelauf“: die letzten 100 Mails einordnen und anzeigen, ohne etwas zu setzen (zum Einstellen der Regler).

### Wo es läuft

In NovaBird-Search (dort liegen die Vektoren). Der Helper wird nicht gebraucht, beschleunigt aber das Rechnen der
Vektoren. Alles bleibt auf dem Rechner bzw. beim eigenen Helper.

### Offene Punkte

- Messung mit echten Postfächern: Trefferquote je Kategorie aus vorhandenen Schlagwörtern (Probelauf).
- Konten mit sehr vielen Schlagwörtern: nur ausgewählte Schlagwörter einsortieren lassen.
- Sync der Beispiele zwischen PCs (später, über den Helper wie die Vektoren).

## 3. Phishing

Die Phishing-Erkennung gehört in das eigene Phishing-Add-on (anderer Arbeitsstrang). Hinweis dorthin: Ein lokales
Sprachmodell taugt als zusätzlicher Hinweisgeber („wirkt wie …, weil …“), nicht als alleiniger Filter; die
Erkennung von Fremdanweisungen aus der KI-Zusammenfassung (`nbAI.suspicious`) kann dort mitgenutzt werden.
