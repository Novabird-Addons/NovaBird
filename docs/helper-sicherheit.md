# NovaBird Helper – Sicherheitstest (31.10.2026)

Geprüft wurde der Helper mit Gruppen, verschlüsselten Vektoren, Team-Kalendern (CalDAV), Sicherung und externen Programmen.
Vorgehen: Code-Durchsicht aller Schnittstellen, dann ein automatischer Angriffstest (`novabird-helper/tests/pentest.mjs`, 89 Angriffe) gegen einen
Test-Helper, der Anfragen von diesem PC wie Anfragen aus dem Netz behandelt (`NOVABIRD_TEST_REMOTE=1`, nur für Tests) und
HTTPS spricht. Dazu kamen eine Prüfung der Pakete auf bekannte Schwachstellen (`dotnet list package --vulnerable`: keine) und
die Funktionstests (`tests/grouptest.mjs`: Gruppen/Vektoren/Sicherung/CalDAV 56, Netz-Protokoll 20, Thunderbird 159).

## Angriffsfläche

| Schnittstelle | Erreichbar | Schutz |
|---|---|---|
| Netz-Port 47531 (PCs) | im Netz | AES-256-GCM mit Schlüssel aus dem Kopplungscode der Gruppe, Zeitstempel ±10 min, jede Anfrage nur einmal, 20 Fehlversuche/min → 1 min Sperre |
| Web-Oberfläche 47532 | lokal HTTP, im Netz nur HTTPS (abschaltbar) | eigene Benutzer (PBKDF2 600.000), Sitzungs-Cookie HttpOnly/SameSite=Strict/Secure, CSRF-Wert, Herkunft und Host geprüft, strenge CSP, 10 Fehlversuche/10 min → Sperre |
| `/v1` externe Programme | wie Web, standardmäßig aus | Schlüssel je Programm (SHA-256 gespeichert), Adressen-Freigabe, Sperre nach Fehlversuchen |
| `/dav` Team-Kalender | wie Web | HTTP Basic über HTTPS, Rechte je Kalender und Benutzer, gleiche Sperre wie die Anmeldung |
| Sicherung | Web, nur Admin | eigenes Passwort (PBKDF2 600.000, AES-256-GCM) |

## Ergebnis des Angriffstests: 89 von 89 abgewehrt

- **Anmeldung und Rechte (40):** ohne Anmeldung keine Daten; unverschlüsseltes HTTP aus dem Netz nur Umleitung; Ersteinrichtung
  aus dem Netz gesperrt; Cookie-Attribute; CSRF ohne Wert und mit fremder Herkunft abgelehnt; Sicherheitsköpfe; „Nur lesen“
  kann nichts ändern (12 Versuche, u. a. sich selbst zum Admin machen, Sicherung ziehen, Schlüssel freischalten); „Nur
  Kalender“ sieht nur eigene Kalender; Sperre nach 10 Fehlversuchen greift auch mit richtigem Passwort.
- **Eingaben (15):** Pfade nach außen bei statischen Dateien (5 Varianten), kaputtes und 5.000-fach verschachteltes JSON,
  zu große Rümpfe und Adressen, chunked und Request-Smuggling (Content-Length + Transfer-Encoding), Müll statt HTTP.
- **Sicherung (3):** Wiederherstellen ohne Admin (auch mit 2-MB-Rumpf), manipulierte Sicherung mit `../`-Pfad (Zip-Slip),
  Daten nach abgelehnter Sicherung unverändert.
- **CalDAV (19):** 8 Pfad-Varianten in fremde Kalender und Dateien (`..`, `%2e%2e`, `%2f`, `%5c`), PUT mit Pfad, XXE
  (externe Entität auf `win.ini`), „Billion Laughs“, calendar-multiget auf fremde Kalender, zu große und falsche Einträge,
  Kalender löschen, leeres/kaputtes/fremdes Passwortformat, CalDAV über unverschlüsseltes HTTP aus dem Netz.
- **Externe Programme (5):** aus, ohne/falscher Schlüssel, unverschlüsselt, Pfad-Verwechslung.
- **Netz-Port (7):** Info ohne Geheimnisse, falsches Chiffrat, riesige und negative Länge, kaputtes JSON, fremder Pfad, Sperre.
- **Verfügbarkeit (2):** 300 halb offene Verbindungen je Port – der Helper antwortet weiter in 5–70 ms.

## Gefunden und behoben

| # | Befund | Schwere | Behebung |
|---|---|---|---|
| 1 | Umleitung HTTP → HTTPS übernahm den **dekodierten** Pfad in den `Location`-Kopf: `%0d%0a` konnte Kopfzeilen einschleusen (Response Splitting) | mittel (nur unverschlüsselt aus dem Netz, kein Zugriff auf Daten) | kodierter Pfad, nur druckbare ASCII-Zeichen, kein `//`; Zeilenumbrüche werden in jedem `Location` entfernt |
| 2 | Halbe Anfragen hielten die Verbindung **unbegrenzt** offen (das 30-s-Limit galt nur für synchrones Lesen) → mit vielen Verbindungen Speicher/Sockets erschöpfbar (Slowloris) | mittel (Verfügbarkeit) | beide Ports trennen nach 30 s, wenn Handshake und Anfrage nicht vollständig sind (gemessen: 30 s) |
| 3 | Eine kaputte oder manipulierte Sicherung wurde erst mitten im Einspielen abgelehnt – Kalender und Benutzer waren dann schon ersetzt | niedrig (nur Admin mit Sicherungspasswort) | erst ganze Datei prüfen (bekannte Einträge, sichere Pfade, ≤ 4 GB ausgepackt, ≤ 200.000 Einträge), in Nebenordner auspacken, dann tauschen |
| 4 | Ein Benutzer mit Schreibrecht konnte einen Kalender unbegrenzt füllen | niedrig | höchstens 20.000 Einträge je Kalender (Antwort 507) |

## Bewusst so gelassen (Hinweise)

- **Sperre je Adresse, nicht je Konto:** Viele Rechner im eigenen Netz könnten parallel raten. Gegenmittel: Passwörter ≥ 10
  Zeichen, PBKDF2 mit 600.000 Runden (etwa 0,25 s je Versuch).
- **Kalender liegen unverschlüsselt im Datenordner** (wie bei jedem CalDAV-Server); geschützt durch die Rechte des Ordners
  (als Dienst nur SYSTEM, Administratoren, Dienstkonto). Wer Admin am Helper-PC ist, kann sie lesen. Die Sicherung ist
  verschlüsselt.
- **Kopplungscode = gemeinsames Geheimnis der Gruppe:** Wer ihn kennt, kann rechnen lassen und das Sprachmodell nutzen, aber
  keine Vektoren fremder Mails lesen (Schlüssel je Mail). Bei Verdacht „Neuer Code“ für diese Gruppe.
- **Option „unverschlüsseltes HTTP“ für externe Programme** schickt Schlüssel und Texte lesbar durchs Netz – nur auf
  ausdrücklichen Wunsch, die Oberfläche warnt.
- **Selbst erzeugtes Zertifikat:** Browser warnen; der Fingerabdruck steht unter „Verbindung“. Thunderbird bindet die
  Kalender über die NovaBird-Extension ohne Warnung ein, weil der Fingerabdruck über den mit dem Kopplungscode verschlüsselten
  Weg kommt und genau verglichen wird (falscher Fingerabdruck: nichts wird erlaubt – getestet).
- Gemerkte CalDAV-Anmeldungen (15 min) liegen nur im Speicher, als HMAC mit zufälligem Schlüssel.
- Nicht geprüft: TLS-Konfiguration mit externem Scanner (Windows-Standard, nur TLS 1.2/1.3), Fuzzing in großem Umfang.

## Wiederholen

```
node novabird-helper/tests/pentest.mjs <nbhelper.exe> <Testdatenordner> <Netzport> <Webport>
node novabird-helper/tests/slowhold.mjs <nbhelper.exe> <Testdatenordner> <Netzport> <Webport>
node novabird-helper/tests/grouptest.mjs <nbhelper.exe> <Testdatenordner> <Netzport> <Webport>
```

Der Testdatenordner braucht einen Admin (`users.json`) und das Suchmodell; Test-Passwörter stehen nur im Testskript.
