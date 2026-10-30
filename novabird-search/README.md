# NovaBird-Search

Eine Suchleiste statt zwei für **Betterbird** / Thunderbird ESR (ab 128): ersetzt globale Suche und Schnellfilter durch **ein Feld in der Kopfzeile der Nachrichtenliste**. Version 2.0.0 · mit eigenem Suchindex · Deutsch, English, Français, Español.

## Funktionen
- **Treffer beim Tippen** in der normalen Nachrichtenliste, flach und **strikt nach Datum** (neueste zuerst). Bereich links im Feld: *Alle Ordner* oder *Aktueller Ordner*.
- **Zahnrad-Menü:** Von / An / Betreff / Nachricht, Mit Anhang, Nur ungelesen, Papierkorb, Spam. **Zeitfenster-Chips:** Alle, Heute, 3, 7, 30 Tage.
- **Kurzschreibweise:** `von:` `an:` `betreff:` `text:` `anh:ja` `seit:7t` `bis:` `ungelesen` `markiert` `hier` (auch `from:`/`to:`, `de:`/`à:`/`objet:`, `para:`/`asunto:` …); Datum als 2026-01-31, 31.01.2026 oder relativ (7t, 3w, 6m, 1j). Mit dem eigenen Suchindex auch Sätze wie „Rechnungen von Petra aus den letzten 6 Monaten“.
- **„Meinten Sie …?“** bei 0 Treffern, **Suchverlauf** (einzeln löschbar), **Strg+K** springt ins Feld.
- **Enter** fragt (merkbar): *Filtern* (Treffer in neuem Tab, dort weiter eingrenzen) oder *Auswerten* (Analyseseite mit Zeitleiste, Filtern und Vorschau).
- **Gemeinsame Ordner:** Gemeinsamer Eingang, Alle ungelesenen, Wiedervorlage; Rechtsklick „Alle als gelesen markieren“.
- **Mehrere Hauptfenster** (je Fenster eigene Suche), Farben folgen dem Theme (hell/dunkel).

## Eigener Suchindex (ab 2.0 enthalten)
Bis 1.x war der Index ein eigenes Add-on (NovaBird-DB); ab 2.0 steckt er in NovaBird-Search ([`db/`](db/README.md)), und das Add-on hat die ID des früheren NovaBird-DB (`novabird-db@novabird`), damit Index und Einstellungen beim Update erhalten bleiben. Der Volltext läuft über alle Konten und Ordner in Sekundenbruchteilen. Solange der Index startet oder aufgebaut wird, sucht die Leiste über Gloda (Betterbirds Index): kleinere Treffermenge, keine Relevanz, kein „Meinten Sie“, und es erscheint ein Hinweis.

**Umstieg von 1.x:** NovaBird-Search 2.0 über das alte NovaBird-DB installieren. Ist das alte NovaBird-Search (`novabird-search@novabird`) noch da, übernimmt 2.0 beim Start dessen Einstellungen und Suchverlauf und entfernt es; bis dahin wartet die eigene Suchleiste, damit nie zwei Leisten laufen.

## Semantische Suche (Beta, ab 2.0)
Findet Mails auch nach ihrer Bedeutung (Modell `jinaai/jina-embeddings-v2-base-de`, fp16, Deutsch und Englisch). Standardmäßig aus; das Modell wird erst auf Knopfdruck geladen (feste Revision, jede Datei mit Prüfsumme, `semantic/models.js`). Gerechnet wird im Add-on (transformers.js 4.3.1 mit onnxruntime-web, WASM mit mehreren Threads, `semantic/worker.js`) oder im [NovaBird Helper](../novabird-helper/README.md) auf der Grafikkarte. Die Vektoren liegen in IndexedDB (Message-ID + Modell, int8), neueste Mails zuerst, Altbestand nur im Leerlauf, fortsetzbar. Bei der Suche ergänzen Treffer über der Schwelle (Strenge) die Wortsuche; die Leiste zeigt „+N ähnlich“, bei Sortierung „Relevanz“ mischt Reciprocal Rank Fusion beide Ranglisten. Export/Import der Vektoren und Ordner-Sync (über den Helper) zwischen PCs. Dritter Rechenweg: ein anderer PC oder Server (`semantic/server.js`): der NovaBird Helper im Netz-Modus (verschlüsselt mit dem Kopplungscode), Ollama `/api/embed` oder OpenAI-kompatibel `/v1/embeddings`. Jeder Weg rechnet vor dem Einsatz sechs Probetexte (`semantic/probe.js`) und muss die Referenzvektoren treffen (jeder Vektor Kosinus ≥ 0,995, keine Ähnlichkeit verschiebt sich um mehr als 0,01), sonst kommen seine Vektoren nicht in den Index. Die Laufzeit (`semantic/lib/`) steht nicht in Git: `tools/vendor-semantic.py` legt sie an (feste Versionen, SHA-256), `build.sh` ruft es auf.

## Installation und Einstellungen
`novabird-search-<Version>.xpi` im Add-ons-Manager (Zahnrad → „Add-on aus Datei installieren“). Nur Betterbird / Thunderbird ESR (Experiment-API), nicht der monatliche Release-Kanal. Einstellungen (Add-ons-Manager → NovaBird-Search), Reiter **Suche:** Höchstzahl der Treffer, Enter-Verhalten, eigener Index an/aus, gemeinsame Ordner, Sortierung (Relevanz: experimentell). Reiter **Index:** Status, Wartung (aufräumen, neu aufbauen, löschen), Protokoll, Zusammensetzungen, Suchsprachen.

