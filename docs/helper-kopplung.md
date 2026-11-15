# NovaBird Helper – Kopplung ohne Code-Abtippen

Ein Gerät (Thunderbird, später Android) holt sich Adresse und Kopplungscode einer Helper-Gruppe, ohne den 20-stelligen Code
abzutippen. Danach läuft alles wie bisher: Schlüssel = PBKDF2-SHA256(Code, "NovaBird-Net-1", 300.000), jede Anfrage
AES-256-GCM an `POST /nbhelper/v1` (siehe `NetServer.cs`, `shared/nbnet.js`). Die Kopplung liefert **nur** Adresse + Code.

Code: `novabird-helper/Pairing.cs` (Helper), `novabird-extension/options/helper.js` (Thunderbird, Funktion `pair`),
`novabird-extension/experiments/settingsRedesign/implementation.js` (`discoverHelpers`, UDP).

## Ablauf

1. Am Helper: Web-Oberfläche → PCs → „Gerät über Kopplung hinzufügen“ → **Kopplungsmodus** (5 Minuten, für eine Gruppe).
2. Gerät: **Suche** per UDP-Multicast (nur im Kopplungsmodus antwortet der Helper).
3. Gerät: **Schlüsseltausch** (ECDH P-256, Verfahren 2 mit Festlegung), beide Seiten zeigen dieselbe **6-stellige Zahl**.
4. Am Helper: Zahl vergleichen, **„Zulassen“** (Web-Oberfläche, PCs).
5. Gerät: Nutzer bestätigt **„Zahl stimmt“** (ohne diese Bestätigung nie verbinden: sonst könnte sich ein falscher Helper im
   Netz, der auf die Suche antwortet, selbst „zulassen“).
6. Gerät: holt den Code verschlüsselt ab (einmalig), speichert Adresse + Code + eigenen Namen.

## 1. Suche (UDP)

- Anfrage: die 10 ASCII-Bytes `NBHELPER?1` an **239.255.77.31**, UDP-Port **47531** (Multicast; auf Android vorher
  `WifiManager.MulticastLock` holen). Zweimal im Abstand von ~300 ms senden, 1,5 s auf Antworten warten.
- Antwort (Unicast an Absender-IP und -Port, UTF-8-JSON):
  `{"service":"novabird-helper","name":"<PC-Name>","port":47531,"version":"0.4.1","local":false}`
  – `port` ist der TCP-Port für alles Weitere; `local:true` heißt „Anfrage kam von diesem PC“ (Thunderbird nimmt dann 127.0.0.1).
  Adresse des Helpers = Absender-IP des Antwortpakets.
- Der Helper antwortet nur im Kopplungsmodus und nur an private Adressen (10/8, 172.16/12, 192.168/16, 169.254/16, Loopback).
- Findet die Suche nichts (anderes Netzsegment, Multicast gesperrt): Adresse von Hand eingeben, dann weiter mit Schritt 2.

## 2. Schlüsseltausch: `POST http://<adresse>:<port>/nbhelper/pair`

Unverschlüsseltes JSON; der Schutz kommt aus ECDH + Festlegung + Vergleichszahl. Keine CORS-Freigabe (Browser-Seiten
können die Kopplung nicht nutzen).

**Verfahren 2 (ab Helper 0.5.2, Pflicht):** Das Gerät legt sich zuerst auf seinen Schlüssel fest und zeigt ihn erst, wenn es
den des Helpers kennt. Ohne diese Festlegung (Verfahren 1 bis 0.5.1) konnte ein Dritter in der Mitte nach dem Schlüssel des
Geräts seinen eigenen so lange wählen, bis beide Seiten dieselbe Zahl zeigen (rund 1 Million Versuche, Sekunden). Verfahren 1
(`start` mit `pub`, ohne `commit`) beantwortet der Helper mit 400 `{"error":"update"}`.

**start** – `{"op":"start","v":2,"commit":"<Base64>","label":"<Name des Geräts, ≤ 40 Zeichen>"}`
- `commit` = SHA-256 des eigenen öffentlichen Schlüssels P-256 **roh** (65 Byte `04 || X || Y`), Base64 (Standard, mit `=`).
- Antwort 200: `{"req":"<Kennung>","pub":"<Base64, Helper, 65 Byte roh>","name":"<PC-Name>","v":2}`
- 403 `{"error":"pairing-off"}`: Helper nicht im Kopplungsmodus; 403 `network`: keine private Adresse; 429 `busy`: 8 offene Anfragen;
  400 `commit`: Festlegung ungültig; 400 `update`: altes Verfahren. Ohne `reveal` verfällt die Anfrage nach 1 Minute.
- Je Adresse höchstens eine Festlegung ohne `reveal` (ein neuer `start` ersetzt sie). Festlegungen ohne Abschluss (ersetzt,
  verfallen, falscher Schlüssel) höchstens 3 je Adresse in 10 Minuten, danach 429 `busy` für `start`. Ein Gerät sollte also
  `reveal` immer direkt nach `start` schicken und bei Fehlern nicht in Schleife neu starten.
- Steuerzeichen im Namen ersetzt der Helper durch Leerzeichen.

**reveal** – `{"op":"reveal","req":"<Kennung>","pub":"<Base64, eigener Schlüssel roh>"}` (von derselben Adresse wie `start`)
- 200 `{"state":"pending"}`: erst jetzt sieht der Admin die Anfrage mit Zahl.
- 400 `commit`: Schlüssel passt nicht zur Festlegung (Anfrage verworfen); 400 `pub`: kein Punkt auf der Kurve; 404: unbekannt.
- Gerät zeigt die Zahl und einen Knopf **„Zahl stimmt“**; erst nach diesem Klick und `ok` verbinden.

**Ableitung** (beide Seiten gleich):
- `shared` = ECDH-Geheimnis, 32 Byte (X-Koordinate; WebCrypto `deriveBits(…, 256)`, .NET `DeriveRawSecretAgreement`, Java
  `KeyAgreement("ECDH")` → `generateSecret()`).
- `pubs` = `"|" + base64(helperPub) + "|" + base64(clientPub)` (genau die Base64-Texte aus der Nachricht).
- Zahl: `HKDF-SHA256(ikm = shared, salt = leer, info = "nbh-pair-sas" + pubs, Länge 4)` → 4 Byte als **uint32 big endian**
  `mod 1.000.000`, mit führenden Nullen 6-stellig. Anzeige z. B. „843 877“.
- Schlüssel: `HKDF-SHA256(shared, salt = leer, info = "nbh-pair-key" + pubs, Länge 32)` → AES-256-GCM.

**poll** – `{"op":"poll","req":"<Kennung>"}` alle ~1,5 s, höchstens 5 Minuten:
- `{"state":"pending"}` – warten; `{"state":"denied"}` – am Helper abgelehnt; `{"state":"expired"}` (auch 404) – unbekannt/abgelaufen.
- `{"state":"ok","n":"<Base64, 12 Byte>","d":"<Base64, Chiffrat + 16 Byte Tag>"}` – AES-256-GCM entschlüsseln mit Nonce `n`,
  AAD = ASCII `"nbh-pair|" + req` → JSON `{"code":"XXXXX-XXXXX-XXXXX-XXXXX","group":"<Gruppenname>"}`.
  Der Code wird **nur einmal** ausgeliefert; danach ist die Kennung weg.
- Unbekannte Kennungen zählen beim Helper als Fehlversuch (20 in einer Minute sperren die Adresse eine Minute).

Danach: `helperConn = { url: "http://<adresse>:<port>", code, label }` und wie bisher `hello` über `/nbhelper/v1`.

**Uhrzeit:** `/nbhelper/v1` nimmt `ts` nur ±10 Minuten an (Schutz gegen Wiederholung). Sonst kommt eine normal verschlüsselte
Antwort `{"ok":false,"error":"…","clock":true,"now":<Zeit des Helpers in ms>}`. Geräte merken sich dann den Versatz
(`now` − eigene Zeit) und senden einmal mit korrigiertem `ts` und neuer `rid`; sonst Meldung „Uhrzeit weicht ab“.
`now` ist mit dem Gruppenschlüssel verschlüsselt und lässt sich ohne Code nicht fälschen.

## Testvektor (feste Schlüssel, nur zum Prüfen der eigenen Umsetzung)

| | Wert |
|---|---|
| Helper privat | `1111…11` (32 Byte 0x11) |
| Gerät privat | `2222…22` (32 Byte 0x22) |
| helperPub | `BAIX5hfwtkQ5KCePlpmeaaI6TywVK99tbN9m5bgCgtTtGUp968uXcS0t2jyoWqh2Wlb0X8dYWZZS8ol8ZTBuV5Q=` |
| clientPub | `BNZak5d8qj0bCBhS/1ennkZfFmBXcwS66tUF3TpIWJzzUBheiVNy32Ih6joTdVfkc/3bZ1XwW9UHw8Uz/OnJEoU=` |
| shared | `ccfc261f58193c98ca4ad4a53bbac6f0ee29bc4d48438090446908622ca79af6` |
| Zahl | `843877` |
| Schlüssel | `5b440a4a1fbee9faea5f4ad111d37b7e7bd4636dc9931197b86579c31672541b` |

## Zum Testen ohne Bedienung des Helpers

Testkonsole: `nbhelper.exe --server-console` mit `NOVABIRD_HELPER_DIR=<eigener Ordner>`, `NOVABIRD_TEST_NOMODEL=1`;
Befehle auf stdin: `pair-start`, `pair-list`, `pair-allow <req>`, `pair-deny <req>`, `pair-stop`. „Beenden“ (`pair-stop`,
Web-Oberfläche) nimmt auch zugelassene, noch nicht abgeholte Anfragen zurück. `NOVABIRD_NET_LOOPBACK=1` = nur dieser PC.
