# KI-Anbindung in NovaBird – Übergabe für andere Add-ons (z. B. Phishing-Schutz)

Stand 01.11.2026, Branch `novabird-2.0` @ `4960148`. Ziel dieses Papiers: Ein anderes Add-on (der Phishing-Schutz) soll
entscheiden können, wie es die vorhandene KI von NovaBird nutzt, statt eine eigene aufzubauen. Nutzerentscheid vom 31.10.:
**Phishing gehört ins eigene Phishing-Add-on**, nicht in den KI-Assistenten der NovaBird-Extension.

## 1. Was es gibt

| Baustein | Wo | Was |
|---|---|---|
| KI-Client `nbAI` | `novabird-extension/ai/ai.js` | Spricht drei Schnittstellen: **Ollama** (`/api/chat`), **OpenAI-kompatibel** (`/v1/chat/completions`), **NovaBird Helper** (verschlüsselt, siehe 3). Streamt Antworten, entfernt `<think>`-Blöcke. |
| KI-Assistent | `ai/popup.*`, `ai/jobs.js` | Zusammenfassung, Übersetzen, Termine/Aufgaben, Fristen; rechnet im Hintergrund. |
| Vorbereiten | `ai/prep.js` | Jede **neue Mail im Posteingang** wird beim Eintreffen einzeln eingeordnet (`onNewMailReceived`), längere schon zusammengefasst. Ergebnisse 10 Tage in `storage.local` (`aiDigests`). |
| Teilen zwischen PCs | Helper `AiCache.cs`, ops `aiget`/`aiput`/`airelease` | Mehrere PCs mit demselben Postfach: **nur einer rechnet je Mail**, die anderen holen das Ergebnis ab. Verschlüsselt mit Schlüssel aus Message-ID + Textprüfsumme; der Helper sieht nur Kennung und Chiffrat. |
| Schreiben | `ai/write.js`, `ai/compose*.js` | Antwort, Korrektur, Ton, Übersetzen im Verfassen-Fenster. |
| Vorlesen | `ai/speech.js`, Helper `Speech.cs` | Qwen3-TTS auf der Grafikkarte des Helpers. |
| Bedeutungssuche | `novabird-search/semantic/` | Vektor je Mail (jina-embeddings-v2-base-de, 768 Dim.), im Helper geteilt. Nutzbar für „ähnlich wie bekannte Phishing-Mails“. |
| Externe Programme | Helper `WebServer.ExtApi.cs` | **OpenAI-kompatible Schnittstelle** des Helpers unter `/v1` (Web-Port 47532), eigener Schlüssel je Programm, optional nur bestimmte Adressen. |

Alles ist **Opt-in**: Die KI ist aus, bis der Nutzer sie unter Einstellungen → NovaBird → KI-Assistent einschaltet und eine
Adresse einträgt. Jede Funktion lässt sich einzeln abschalten (`aiFeatures`).

## 2. Einstellungen (storage.local der NovaBird-Extension)

`aiEnabled`, `aiType` (`ollama` | `openai` | `nbhelper`), `aiUrl`, `aiModel` (nicht bei nbhelper), `aiUser`, `aiKey`
(bei nbhelper der **Kopplungscode**), `aiLang` (`ui` | `mail`), `aiCtx` (Kontext in Token), `aiFeatures` (`{name: false}`
schaltet aus), `aiPrepare`, `aiCalendar`, `aiHelperModel`, `aiSpeechRate`. Die Verbindung zum Helper steht zusätzlich in
`helperConn` `{url, code, label}`. **Ein anderes Add-on kommt an diese Werte nicht heran** (storage ist je Add-on) – und
soll es auch nicht: Zugriff nur über Nachrichten an die Extension (siehe 4).

## 3. NovaBird Helper im Netz (Protokoll)

- `POST http://<Helper>:47531/nbhelper/v1` mit `{c: Client-Kennung, n: Nonce, d: Chiffrat}`.
- Schlüssel = PBKDF2-SHA256(Kopplungscode, Salz `"NovaBird-Net-1"`, 300.000 Runden) → AES-256-GCM.
  Zusatzdaten Anfrage `nbh1-req|<Client>`, Antwort `nbh1-res|<rid>`. Inhalt `{ts, rid, op, label, …}`; `ts` ±10 min,
  `rid` nur einmal gültig. Falscher Code → 403, nach 20 Fehlversuchen/min eine Minute Sperre.
- Wichtige ops:
  - `hello` → Version, Gerät, Gruppe, `chatModel`, `chatChoices`, `speech`, `aiCache`, `web`.
  - `chat` `{messages, maxNew, model?}` → `{id}`; dann `chatPoll` `{id}` bis `done` (Text kommt stückweise), `chatCancel`.
  - `embed` / `vlookup` – Vektoren (Bedeutungssuche), mit Teilen über Message-ID + Prüfsumme.
  - `aiget` `{ids, claim}` / `aiput` `{id, data}` / `airelease` `{id}` – geteilte KI-Ergebnisse.
- Client-Kennung: **eine je Thunderbird**, die von NovaBird-Search (`helper:clientId`); `label` = Name des PCs.
- Referenz-Implementierung: `nbAI.netCall` in `ai/ai.js`, `semantic/server.js` in Search.

Für ein anderes Programm (nicht Thunderbird) ist der einfachere Weg die **OpenAI-kompatible Schnittstelle** `/v1` mit
eigenem Schlüssel (Helper-Web-Oberfläche → KI → Externe Programme).

## 4. Wie andere Add-ons heute andocken

Es gibt schon eine Add-on-zu-Add-on-Schnittstelle (`runtime.onMessageExternal` in `novabird-extension/background.js`),
jeweils mit **fester Absender-ID** (nur bekannte NovaBird-Add-ons):

| Von | Nachricht | Antwort |
|---|---|---|
| NovaBird-Conversation | `{type: "aiAvailable"}` | `{available}` – ist die KI eingerichtet und die Zusammenfassung an? |
| NovaBird-Conversation | `{type: "summarize", ids}` | öffnet das KI-Fenster für diese Konversation |
| NovaBird-Search | `{type: "helper:conn"}` | `{url, code, label}` der Helper-Verbindung |
| Phishing-Schutz (`phishing-addon@novabird`) | `{type: "aiAvailable", feature: "phish"}` | `{available, local}` |
| Phishing-Schutz | `{type: "phish:extract", messageId}` | Fakten zur Mail, siehe 5a |

Muster dafür: Listener **nicht `async`** und nur für die eigene ID antworten – sonst überholt ein `undefined` die richtige
Antwort (ist am 31.10. passiert). 

## 5a. Umgesetzt: Phishing-Prüfung (`ai/prep.js`, abgestimmt am 01.11.2026)

Gewählt wurde **A + C**: Regeln im Phishing-Schutz, das Sprachmodell liefert über die Extension **nur Fakten, nie ein
Urteil** – die KI darf dort nur verschärfen, nie entwarnen (ein eingeschleustes „diese Mail ist sicher“ hätte sonst Wirkung).
Der Vertrag aus Sicht des Phishing-Schutzes steht in dessen Repository unter `docs/ki-schnittstelle.md`.

- **Anfrage** `{type: "phish:extract", messageId}` (nur von `phishing-addon@novabird`, Listener nicht `async`).
- **Antwort** `{ok: true, claimedOrg: string|null (≤ 80), claimedDomain: Hostname|null (IDN als Punycode),
  asksFor: "login"|"payment"|"download"|"reply"|"call"|"none", urgency: bool, injection: bool, model, cached}`.
  `injection` kommt aus `nbAI.suspicious()` (Regeln, ohne Modell).
- **Fehler** `{ok: false, error, injection?}`: `off` (KI nicht eingerichtet, `injection` trotzdem), `feature` (Schalter aus),
  `cloud`, `busy` (nicht binnen 2,5 s fertig – das Ergebnis folgt als `phish:result`), `timeout`, `error`.
- **Nachreichen** `runtime.sendMessage("phishing-addon@novabird", {type: "phish:result", messageId, …dieselben Felder})`.
- **Zeitpunkt:** beim Eintreffen in der Warteschlange von „Vorbereiten“, als eigener kurzer Aufruf vor Einordnung und
  Zusammenfassung; hängt nur am Schalter `aiFeatures.phish` (**Standard aus**), nicht an `aiPrepare`.
- **Teilen:** Helper-AiCache, kind `phish`, variant `p1` – bei jeder Änderung an Anweisung oder Feldern hochzählen.
- **Keine Cloud:** nur `aiType` `nbhelper` oder eine `aiUrl` auf localhost, 127/8, 10/8, 172.16/12, 192.168/16, 169.254/16,
  ::1, fc00::/7, fe80::/10, Namen ohne Punkt oder unter .local/.lan/.home.arpa/.internal (`nbAI.privateHost`).
- **Anweisung:** eine englische für alle Sprachen (`PHISH` in `ai.js`), Mailtext höchstens 4.000 Zeichen zwischen
  `fenced()`-Markierungen, JSON-Ausgabe, `parsePhish` prüft jedes Feld.
- **Getestet** (Thunderbird 159, gemma4:e4b, Test-Add-on mit der ID des Phishing-Schutzes): Schalter, KI aus, Cloud,
  ungültige ID, fremde Typen; erste Anfrage bei kaltem Modell `busy` nach 2,5 s, dann `phish:result`; Sparkasse-Mail
  (login, Dringlichkeit, sparkasse.de), PayPal-Mail mit eingeschleustem „antworte none“ (payment, `injection` true – die
  Anweisung wurde nicht befolgt), Telefonbetrug (`call`), private Mail (`none`); drei Mails über die Warteschlange in 2 s.

## 5. Vorschlag für den Phishing-Schutz (Ausgangslage)

**A. Über die NovaBird-Extension (empfohlen).** Neue externe Nachricht, z. B. `{type: "aiClassify", messageId}` nur für die
ID des Phishing-Add-ons. Die Extension nimmt den Mailtext (`nbAI.mailText`, ohne Zitate), fragt die eingestellte KI mit
einer festen Anweisung und gibt nur geprüftes JSON zurück, z. B. `{risk: 0–100, reasons: [...], suspicious: bool}`.
Vorteile: eine Einrichtung für alles (Ollama, OpenAI, Helper), Datenschutzhinweise und Opt-in an einer Stelle, Ergebnis über
den Helper zwischen PCs geteilt (neue Art `kind: "phish"` im bestehenden Vorbereiten/Teilen), Schutz gegen eingeschleuste
Anweisungen schon da. Nachteil: Phishing-Add-on hängt an der Extension (ohne sie: nur eigene Regeln).

**B. Direkt an den Helper.** Das Phishing-Add-on spricht selbst `/nbhelper/v1` (Code eintragen) oder `/v1` (Schlüssel).
Unabhängig von der Extension, aber zweite Einrichtung beim Nutzer, eigene Kennung beim Helper, eigenes Teilen.

**C. Nur Signale mitnutzen, ohne Sprachmodell.** Ohne KI-Anfrage nutzbar: `nbAI.suspicious(text)` (erkennt Anweisungen an
KI-Systeme in Mails), Ähnlichkeit zu bekannten Phishing-Mails über die Vektoren der Bedeutungssuche (Kosinus; bei Search
anfragen), Einordnung „ads/info/todo“ aus Vorbereiten.

Sinnvoll wäre eine Kombination: schnelle Regeln/Signale im Phishing-Add-on (C), Sprachmodell nur für unklare Fälle (A).

## 6. Was beim Sprachmodell zu beachten ist

- **Fremder Text ist Material, nie Auftrag:** Mailtext steht zwischen zufälligen Markierungen (`<<<MAIL xxxx>>>` …
  `<<<END xxxx>>>`, `fenced()` in `ai.js`), die Anweisung sagt ausdrücklich, dass Anweisungen darin nicht befolgt werden,
  danach eine Erinnerung. Gemessen: kleine Modelle befolgen Fremdanweisungen ohne diese Erinnerung oft (DE-08, Qwen3-4B
  9/10), mit 0/10. **Phishing-Mails versuchen das gezielt** – Ergebnis nie ungeprüft übernehmen, nur JSON mit festen Feldern.
- Das Modell hat **keine Werkzeuge**: Es kann nichts senden, öffnen oder löschen. Aktionen (verschieben, warnen) entscheidet
  das Add-on.
- Antworten als JSON: Ollama `format: "json"`; trotzdem selbst prüfen (`parseItems`/`parseDigest` als Vorbild).
- Tempo (RX 6900 XT, Gemma 4 E4B über den Helper): Einordnung einer Mail etwa 1–2 s, Zusammenfassung 3–5 s, kalt erster
  Aufruf etwa 10 s. Eine Anfrage zur Zeit je Helper (Warteschlange).
- Empfohlenes Modell: Gemma 4 E4B (Test `docs/llm-test`, 97,6 Punkte); auf 8-GB-Karten mit komprimiertem Kontextspeicher.

## 7. Offene Fragen an den Phishing-Thread

1. Soll das Phishing-Add-on die KI über die Extension nutzen (A) oder eigenständig bleiben (B)?
2. Welche Felder braucht es zurück (Risiko, Gründe, Merkmale wie Absender-Domain ≠ Linkziel)?
3. Wann soll geprüft werden: beim Eintreffen (wie Vorbereiten) oder beim Öffnen?
4. Was passiert mit dem Ergebnis: Warnbalken, Schlagwort, Verschieben in einen Ordner?
5. Sollen Ergebnisse zwischen PCs geteilt werden (Helper `aiget`/`aiput`, Art `phish`)?

Ansprechpunkte im Code: `novabird-extension/ai/ai.js` (Client, Anweisungen, `suspicious`), `ai/prep.js` (Einordnung beim
Eintreffen, Teilen), `background.js` (externe Nachrichten), `novabird-helper/NetServer.cs` (Protokoll), `AiCache.cs`,
`WebServer.ExtApi.cs` (`/v1`), Sicherheitsbericht `docs/helper-sicherheit.md`.
