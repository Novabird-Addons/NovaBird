# NovaBird Helper 0.4 – Plan

Stand 30.10.2026. Ziel: Helper als Rechenknoten im Heimnetz, der auch die KI-Zusammenfassung übernimmt, mit Web-Oberfläche.

## Entscheidungen

| Thema | Entscheidung |
|---|---|
| Laufzeit | **Windows ML** (`Microsoft.ML.OnnxRuntimeGenAI.WinML` 0.18 → `Microsoft.Windows.AI.MachineLearning` 2.1.1: ONNX Runtime 1.24 + DirectML 1.15). Eine Laufzeit für Suche und Sprachmodell. |
| Betriebsart | Standard wie bisher **ohne Adminrechte** (Programm im Benutzerkonto, Symbol im Infobereich). **Optional als Windows-Dienst** (läuft ohne Anmeldung; Umstellen fragt einmal per UAC). |
| Bedienung | **Web-Oberfläche** mit eigenen Benutzern (nicht Windows-Konten), Rollen **Admin** und **Nur lesen**. Standard nur am PC selbst (`http://localhost`), im Netz zuschaltbar, dann nur über **HTTPS** (selbst erzeugtes Zertifikat). Das Symbol im Infobereich zeigt den Zustand und öffnet die Web-Oberfläche. |
| Sprachmodell | Der Helper beantwortet Zusammenfassungen. **Standard: vom Helper verwaltetes Ollama** (nur 127.0.0.1; Entscheid 30.10. nach den Messungen unten), alternativ Modellordner über Windows ML. **Modell wählbar** in der Web-Oberfläche. Kandidaten aus `docs/llm-test`: Gemma 4 E4B (Empfehlung), Gemma 3 4B, Qwen3.5-4B. |
| Update | Doppelklick auf die neue `nbhelper.exe` ersetzt die alte; Einstellungen, Kopplungscode, PC-Liste und Modelle bleiben. Einstellungen bekommen eine Schema-Version mit Umstellung. |

## Messungen (Windows ML gegen bisheriges Paket, RX 6900 XT)

| | ORT DirectML 1.24.4 (0.3) | Windows ML 2.1.1 |
|---|---|---|
| Probetexte jina-de | ≥ 0,9997 | 0,99971 (Verschiebung 0,0019) |
| Suche, Mails/s | 60,9–61,4 | 61,2–61,6 |
| Netz-Protokolltests | alle ok | alle ok |
| Sprachmodelle | GenAI 0.14.1 (ohne Gemma 4) | GenAI 0.18 (Gemma 4, Qwen3.5) |

Windows ML bringt für AMD-Grafikkarten zusätzlich „MIGraphX“, aber erst ab RDNA 3 und noch nicht für Sprachmodelle; auf RDNA 1/2
bleibt es bei DirectML (gleiches Tempo wie bisher).

## Aufbau

```
nbhelper.exe
  (Thunderbird, Native Messaging) ─ Host.cs: Suche auf diesem PC, wie bisher
  --server            Kern im Benutzerkonto + Symbol im Infobereich
  --service           Kern als Windows-Dienst (Konto „NT SERVICE\NovaBirdHelper“)
  --tray              nur Symbol (Dienstbetrieb): fragt den Dienst nach dem Zustand, öffnet die Web-Oberfläche
Kern
  NetServer   Port 47531  verschlüsseltes Protokoll (Kopplungscode): embed, hello, chat (neu)
  WebServer   Port 47532  Web-Oberfläche + JSON-API mit Anmeldung; localhost per HTTP, im Netz nur HTTPS
  Scheduler   Grafikkarte/CPU für Einbettungen; Sprachmodell reiht sich ein (eine Aufgabe zur Zeit auf der Grafikkarte)
  Chat        GenAI-Modell laden/entladen, Streaming
Datenordner
  Benutzerbetrieb  %LOCALAPPDATA%\NovaBird\Helper   (wie bisher)
  Dienstbetrieb    %ProgramData%\NovaBird\Helper    (Zugriff: SYSTEM, Administratoren, Dienstkonto)
```

### Web-Oberfläche

Seiten: **Status** (Gerät, Tempo, Warteschlange, Sprachmodell), **PCs** (je PC heute/gesamt, Indexstand, vergessen),
**Verbindung** (Adressen und Kopplungscode zum Kopieren, Code erneuern), **Modelle** (Suchmodell, Sprachmodelle laden/wählen,
Geräte messen), **Einstellungen** (Port, CPU mitrechnen, Threads, Pause, Autostart, Web im Netz), **Benutzer** (anlegen,
Rolle, Passwort, löschen), **Protokoll**.

Sicherheit:
- Passwörter: PBKDF2-SHA256, 600.000 Runden, je Benutzer eigenes Salz. Erster Start: Einrichtung des ersten Admins nur von
  `localhost` aus.
- Sitzung: zufälliges Cookie (`HttpOnly`, `SameSite=Strict`, im Netz `Secure`), 12 h; jede ändernde Anfrage mit CSRF-Token.
- Anmeldung: nach 10 Fehlversuchen in 10 Minuten Sperre der Adresse für 10 Minuten.
- Im Netz nur HTTPS; Zertifikat wird beim Einschalten erzeugt (RSA 2048, 5 Jahre), Fingerabdruck steht in der Oberfläche.
- Rolle „Nur lesen“ sieht keinen Kopplungscode.

### Sprachmodell im Netz

Die KI-Zusammenfassung der Extension bekommt die Schnittstelle **„NovaBird Helper“**: gleiche Verschlüsselung wie die Suche
(Kopplungscode), Op `chat` mit Teilantworten (Streaming über Abholen der nächsten Stücke). Mailtexte gehen damit nie lesbar
durchs Netz – anders als bei einer OpenAI-kompatiblen Schnittstelle über HTTP.

## Stufen

1. Windows ML statt ORT DirectML (Paketwechsel, Tests).
2. Datenordner je Betriebsart, Schema-Version + Umstellung, Update-Pfad 0.3 → 0.4.
3. Web-Oberfläche + Benutzer (zuerst localhost), dann HTTPS im Netz.
4. Dienstbetrieb: Ein-/Ausschalten (UAC), Übernahme der Einstellungen in `%ProgramData%`, Symbol `--tray`.
5. Sprachmodell: Chat-Engine (GenAI), Modellauswahl, Op `chat`; Extension: Schnittstelle „NovaBird Helper“.
6. Ollama im Hintergrund (Ollama.cs): Einrichten aus dem offiziellen Release, Modelle laden/wählen/löschen in der Web-Oberfläche.

## Sprachmodell: Windows ML gegen Ollama (Gemma 3 4B, RX 6900 XT, docs/llm-test)

| | Punkte | DE-08 befolgt (10×) | Token/s |
|---|---|---|---|
| Ollama Q4_K_M | 95,5 | 0 | 120 |
| Windows ML int4 RTN | 92,5–93,9 | 4–6 | 62–87 |
| Windows ML int4 k_quant | 94,8 | 5 | 65 |
| Windows ML k_quant_mixed (int8-Anteile) | 94,8 | 1 | 19 |

Selbst bauen (Builder 0.18) braucht für DirectML `shared_embeddings=false` (sonst läuft die quantisierte Einbettung auf der CPU, Graph Capture fällt aus: 3,9 Token/s) und bei Gemma 3 eine Umsetzung der RoPE-Angaben von transformers 5. Gemma 4 E4B (bestes Modell über Ollama, 98 Punkte) kann der Builder 0.18 nicht bauen (nur Gemma 4 12B und 26B-MoE). Daher Ollama als Standard.

## Offen

- ~~Download-Quelle der Sprachmodelle~~ (mit Ollama erledigt; für Windows ML weiter offen): Für Gemma 4 / Qwen3.5 gibt es keine fertigen GenAI-DirectML-Modelle. Wir bauen
  sie selbst (int4); sie müssten irgendwo zum Laden liegen (z. B. eigenes Hugging-Face-Konto, Lizenz Apache 2.0 erlaubt das).
  Bis dahin: Modellordner in der Web-Oberfläche importieren.
- Dienst unter Windows-Sitzung 0 mit DirectML: im Test prüfen.
