# NovaBird Helper – Kopplung ohne Code-Abtippen

Ein Gerät (Thunderbird, später Android) holt sich Adresse und Kopplungscode einer Helper-Gruppe, ohne den 20-stelligen Code
abzutippen. Danach läuft alles wie bisher: Schlüssel = PBKDF2-SHA256(Code, "NovaBird-Net-1", 300.000), jede Anfrage
AES-256-GCM an `POST /nbhelper/v1` (siehe `NetServer.cs`, `shared/nbnet.js`). Die Kopplung liefert **nur** Adresse + Code.

Code: `novabird-helper/Pairing.cs` (Helper), `novabird-extension/options/helper.js` (Thunderbird, Funktion `pair`),
`novabird-extension/experiments/settingsRedesign/implementation.js` (`discoverHelpers`, UDP).

## Ablauf

1. Am Helper: Web-Oberfläche → PCs → „Gerät über Kopplung hinzufügen“ → **Kopplungsmodus** (5 Minuten, für eine Gruppe).
2. Gerät: **Suche** per UDP-Multicast (nur im Kopplungsmodus antwortet der Helper).
3. Gerät: **Schlüsseltausch** (ECDH P-256), beide Seiten zeigen dieselbe **6-stellige Zahl**.
4. Am Helper: Zahl vergleichen, **„Zulassen“** (Web-Oberfläche, PCs).
5. Gerät: holt den Code verschlüsselt ab (einmalig), speichert Adresse + Code + eigenen Namen.

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

Unverschlüsseltes JSON; der Schutz kommt aus ECDH + Vergleichszahl.

**start** – `{"op":"start","pub":"<Base64>","label":"<Name des Geräts, ≤ 40 Zeichen>"}`
- `pub` = eigener öffentlicher Schlüssel P-256, **roh** (65 Byte `04 || X || Y`), Base64 (Standard, mit `=`).
- Antwort 200: `{"req":"<Kennung>","pub":"<Base64, Helper, 65 Byte roh>","name":"<PC-Name>"}`
- 403 `{"error":"pairing-off"}`: Helper nicht im Kopplungsmodus; 403 `network`: keine private Adresse; 429 `busy`: 8 offene Anfragen;
  400 `pub`: Schlüssel ungültig.

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
Befehle auf stdin: `pair-start`, `pair-list`, `pair-allow <req>`, `pair-deny <req>`. `NOVABIRD_NET_LOOPBACK=1` = nur dieser PC.
