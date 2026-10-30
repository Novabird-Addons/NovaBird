// Sprachmodell im Helper (KI-Zusammenfassung): über das vom Helper verwaltete Ollama (Ollama.cs, Standard; gewählte Modelle
// heißen "ollama:<name>") oder ONNX Runtime GenAI über Windows ML (DirectML, Modellordner).
//  - Modelle liegen als Ordner im GenAI-Format (genai_config.json, model.onnx …) unter <Datenordner>\llm\<name>\.
//    Gewählt wird eines (Einstellung chatModel); es bleibt geladen, bis ein anderes gewählt wird oder 15 Minuten nichts kam.
//  - Eine Antwort zur Zeit; weitere warten. Antworten entstehen stückweise: Start() gibt eine Kennung zurück, Poll() liefert
//    den neuen Text seit dem letzten Abholen und wartet dafür bis zu 1 s (so streamt auch das verschlüsselte Netzprotokoll,
//    NetServer op chat/chatPoll).
//  - Denkblöcke (<think>…</think>) werden entfernt.
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.ML.OnnxRuntimeGenAI;

namespace NovaBird.Helper;

sealed class Chat
{
    public const int MaxNewDefault = 700;
    static readonly TimeSpan IdleUnload = TimeSpan.FromMinutes(15), JobKeep = TimeSpan.FromMinutes(5);
    static readonly Regex Think = new(@"<think>[\s\S]*?(</think>|$)\s*");

    public sealed class Job
    {
        public string Id, Client;
        public readonly StringBuilder Text = new();
        public int Sent;           // so viel Text hat der Client schon
        public bool Done;
        public string Error;
        public int PromptTokens, NewTokens;
        public double FirstMs = -1, TotalMs;
        public double? TokPerSec; // von Ollama gemeldet
        public DateTime Finished;
        public readonly CancellationTokenSource Cancel = new();
        readonly SemaphoreSlim changed = new(0, 1); // neuer Text oder fertig (für das Warten in Poll)

        public void Signal()
        {
            try { if (changed.CurrentCount == 0) changed.Release(); }
            catch (SemaphoreFullException) { /* schon gemeldet */ }
        }

        public Task WaitAsync(int ms) => changed.WaitAsync(ms);
    }

    readonly object gate = new();
    readonly SemaphoreSlim one = new(1, 1);
    readonly ConcurrentDictionary<string, Job> jobs = new();
    Model model;
    Tokenizer tokenizer;
    string loaded;
    DateTime lastUse = DateTime.UtcNow;
    readonly System.Threading.Timer janitor;

    public static string Dir => Path.Combine(Settings.Dir, "llm");
    public string Loaded => loaded;
    public bool Busy => one.CurrentCount == 0;
    public int Waiting => jobs.Values.Count(j => !j.Done) - (Busy ? 1 : 0);

    public Chat() => janitor = new System.Threading.Timer(_ => Tidy(), null, 60_000, 60_000);

    // ---- Modelle -------------------------------------------------------------------------------------------------------------
    public sealed record Info(string Name, string Path, long Bytes, string Type, int Context);

    /// <summary>Vorhandene Modellordner (mit genai_config.json).</summary>
    public static List<Info> Available()
    {
        if (!Directory.Exists(Dir)) return new();
        return Directory.GetDirectories(Dir).Where(d => File.Exists(System.IO.Path.Combine(d, "genai_config.json"))).Select(d =>
        {
            string type = "?";
            int ctx = 0;
            try
            {
                var c = JsonNode.Parse(File.ReadAllText(System.IO.Path.Combine(d, "genai_config.json")));
                type = (string)c["model"]?["type"] ?? "?";
                ctx = (int?)c["model"]?["context_length"] ?? (int?)c["search"]?["max_length"] ?? 0;
            }
            catch { /* unvollständig */ }
            long bytes = Directory.GetFiles(d, "*", SearchOption.AllDirectories).Sum(f => new FileInfo(f).Length);
            return new Info(System.IO.Path.GetFileName(d), d, bytes, type, ctx);
        }).OrderBy(i => i.Name).ToList();
    }

    public static string Selected
    {
        get => (string)Settings.Load()["chatModel"];
        set
        {
            var s = Settings.Load();
            s["chatModel"] = value;
            Settings.Save(s);
        }
    }

    /// <summary>Modellordner aus einem lokalen Pfad übernehmen (Kopie). Liefert den Namen.</summary>
    public static string Import(string source, Action<long, long> progress = null)
    {
        if (!File.Exists(System.IO.Path.Combine(source, "genai_config.json"))) throw new ArgumentException(L.T("Kein Modell im GenAI-Format (genai_config.json fehlt)", "Not a model in GenAI format (genai_config.json missing)"));
        // Nur Text-Teil eines Bild-Text-Modells ohne Wort-Einbettung (erwartet inputs_embeds): allein nicht lauffähig
        var cfg = JsonNode.Parse(File.ReadAllText(System.IO.Path.Combine(source, "genai_config.json")))?["model"];
        if (cfg?["decoder"]?["inputs"]?["inputs_embeds"] != null && cfg["embedding"] == null)
            throw new ArgumentException(L.T("Modell ohne Wort-Einbettung (nur Text-Teil einer Bild-Text-Pipeline) – mit dem GenAI-Builder ab 0.18 und ohne exclude_embeds neu bauen", "Model without word embedding (text part of an image-text pipeline only) – rebuild with GenAI builder 0.18 or later and without exclude_embeds"));
        var name = Regex.Replace(System.IO.Path.GetFileName(System.IO.Path.TrimEndingDirectorySeparator(source)), "[^A-Za-z0-9._-]", "_");
        var target = System.IO.Path.Combine(Dir, name);
        var files = Directory.GetFiles(source, "*", SearchOption.AllDirectories);
        long total = files.Sum(f => new FileInfo(f).Length), done = 0;
        foreach (var f in files)
        {
            var dst = System.IO.Path.Combine(target + ".part", System.IO.Path.GetRelativePath(source, f));
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(dst));
            File.Copy(f, dst, true);
            done += new FileInfo(f).Length;
            progress?.Invoke(done, total);
        }
        if (Directory.Exists(target)) Directory.Delete(target, true);
        Directory.Move(target + ".part", target);
        Log.Write($"Sprachmodell übernommen: {name} ({total / 1_000_000} MB)");
        return name;
    }

    public void Delete(string name)
    {
        lock (gate) if (loaded == name) Unload();
        var d = System.IO.Path.Combine(Dir, name);
        if (Directory.Exists(d)) Directory.Delete(d, true);
        if (Selected == name) Selected = null;
    }

    void Ensure(string name)
    {
        lock (gate)
        {
            if (loaded == name && model != null) return;
            Unload();
            var path = System.IO.Path.Combine(Dir, name);
            if (!File.Exists(System.IO.Path.Combine(path, "genai_config.json"))) throw new InvalidOperationException(L.T($"Sprachmodell {name} fehlt", $"Language model {name} missing"));
            var sw = Stopwatch.StartNew();
            var device = (string)Settings.Load()["device"] ?? "cpu";
            bool dml = device.StartsWith("dml:");
            // DirectML mit „Graph Capture“ ist am schnellsten, geht aber nur, wenn alle Knoten auf der Grafikkarte liegen; sonst ohne
            string how;
            try
            {
                model = Load(path, dml, capture: true);
                how = dml ? "DirectML" : "CPU";
            }
            catch (OnnxRuntimeGenAIException e) when (dml && e.Message.Contains("graph capture"))
            {
                model = Load(path, dml, capture: false);
                how = "DirectML ohne Graph Capture";
            }
            tokenizer = new Tokenizer(model);
            loaded = name;
            Log.Write($"Sprachmodell geladen: {name} ({how}, {sw.ElapsedMilliseconds} ms)");
        }
    }

    static Model Load(string path, bool dml, bool capture)
    {
        using var config = new Config(path);
        config.ClearProviders();
        if (dml)
        {
            config.AppendProvider("dml");
            if (!capture) config.SetProviderOption("dml", "enable_graph_capture", "0");
        }
        return new Model(config);
    }

    void Unload()
    {
        tokenizer?.Dispose();
        model?.Dispose();
        tokenizer = null;
        model = null;
        loaded = null;
    }

    void Tidy()
    {
        foreach (var kv in jobs)
            if (kv.Value.Done && DateTime.UtcNow - kv.Value.Finished > JobKeep) jobs.TryRemove(kv.Key, out _);
        lock (gate)
            if (model != null && !Busy && DateTime.UtcNow - lastUse > IdleUnload)
            {
                Unload();
                Log.Write("Sprachmodell entladen (15 Minuten unbenutzt)");
            }
    }

    // ---- Antworten -----------------------------------------------------------------------------------------------------------
    /// <summary>Antwort beginnen; messages wie bei OpenAI [{role, content}]. Liefert die Kennung zum Abholen.</summary>
    public string Start(string client, JsonArray messages, int maxNew, JsonNode meta = null)
    {
        var name = Selected ?? throw new InvalidOperationException(L.T("Im Helper ist kein Sprachmodell gewählt", "No language model is selected in the helper"));
        if (messages == null || messages.Count == 0 || messages.Count > 50) throw new InvalidOperationException(L.T("Nachrichten fehlen", "Messages missing"));
        var clean = new JsonArray(messages.Select(m => (JsonNode)new JsonObject
        {
            ["role"] = (string)m["role"] is "system" or "user" or "assistant" ? (string)m["role"] : "user",
            ["content"] = (string)m["content"] ?? "",
        }).ToArray());
        if (clean.Sum(m => ((string)m["content"]).Length) > 200_000) throw new InvalidOperationException(L.T("Text zu lang", "Text too long"));
        clean = ApplyPrompt(clean, meta);
        var job = new Job { Id = Guid.NewGuid().ToString("N"), Client = client };
        jobs[job.Id] = job;
        _ = Task.Run(() => Generate(job, name, clean, Math.Clamp(maxNew, 16, 4096)));
        return job.Id;
    }

    // ---- Eigene Anweisung (Web-Oberfläche) ---------------------------------------------------------------------------------
    // Standard ist die Anweisung, die die Extension schickt (web/prompts.json zeigt sie). Eine eigene Fassung (chatPrompt
    // {mail, thread}) ersetzt den Systemteil, mit den Angaben der Anfrage (meta: Zielsprache und die zufälligen Markierungen).
    // Nur wenn die Markierungen gültig sind und im Mailteil vorkommen – sonst bleibt die Anweisung der Extension.
    static readonly Regex Marker = new(@"^<<<(MAIL|END) [0-9a-f]{12}>>>$");

    public static JsonObject CustomPrompt
    {
        get => Settings.Load()["chatPrompt"] as JsonObject;
        set
        {
            var s = Settings.Load();
            s["chatPrompt"] = value;
            Settings.Save(s);
        }
    }

    static JsonArray ApplyPrompt(JsonArray messages, JsonNode meta)
    {
        var custom = CustomPrompt;
        if (custom == null || meta == null) return messages;
        var template = (string)custom[(bool?)meta["thread"] == true ? "thread" : "mail"];
        string open = (string)meta["open"], close = (string)meta["close"], target = (string)meta["target"] ?? "";
        if (string.IsNullOrWhiteSpace(template) || open == null || close == null || !Marker.IsMatch(open) || !Marker.IsMatch(close)) return messages;
        var user = messages.FirstOrDefault(m => (string)m["role"] == "user");
        var text = (string)user?["content"] ?? "";
        if (!text.Contains(open) || !text.Contains(close)) return messages;
        var system = template.Replace("{ZIEL}", target.Length > 100 ? target[..100] : target).Replace("{OPEN}", open).Replace("{CLOSE}", close);
        if ((string)messages[0]["role"] == "system") messages[0]["content"] = system;
        else messages.Insert(0, new JsonObject { ["role"] = "system", ["content"] = system });
        return messages;
    }

    async Task Generate(Job job, string name, JsonArray messages, int maxNew)
    {
        try { await one.WaitAsync(job.Cancel.Token).ConfigureAwait(false); }
        catch (OperationCanceledException)
        {
            job.Error = L.T("abgebrochen", "cancelled");
            job.Done = true;
            job.Finished = DateTime.UtcNow;
            return;
        }
        var sw = Stopwatch.StartNew();
        try
        {
            if (name.StartsWith(OllamaPrefix)) await GenerateOllama(job, name[OllamaPrefix.Length..], messages, maxNew, sw);
            else GenerateWinMl(job, name, messages, maxNew, sw);
        }
        catch (Exception e)
        {
            job.Error = e.Message;
            Log.Write($"Sprachmodell: {e}");
        }
        finally
        {
            job.TotalMs = sw.Elapsed.TotalMilliseconds;
            job.Done = true;
            job.Finished = DateTime.UtcNow;
            lastUse = DateTime.UtcNow;
            one.Release();
            job.Signal();
            if (job.Error == null)
                Log.Write($"Sprachmodell {name}: {job.PromptTokens} Token Eingabe, erstes Token {job.FirstMs:0} ms, {job.NewTokens} Token in {job.TotalMs / 1000:0.0} s");
        }
    }

    const string OllamaPrefix = "ollama:";
    public Ollama Ollama; // vom Kern gesetzt

    /// <summary>Sichtbaren Text übernehmen (abgeholter Anfang bleibt gültig) und wartende Abholer wecken.</summary>
    static void Show(Job job, string visible)
    {
        lock (job)
        {
            if (visible.Length >= job.Sent && string.CompareOrdinal(visible, 0, job.Text.ToString(), 0, job.Sent) == 0)
            {
                job.Text.Clear();
                job.Text.Append(visible);
            }
        }
        job.Signal();
    }

    async Task GenerateOllama(Job job, string model, JsonArray messages, int maxNew, Stopwatch sw)
    {
        if (Ollama == null || !Ollama.Running) throw new InvalidOperationException(L.T("Ollama läuft nicht (Web-Oberfläche → Sprachmodell)", "Ollama is not running (web interface → Language model)"));
        lock (gate) if (this.model != null) Unload(); // Grafikspeicher für Ollama frei machen
        lastUse = DateTime.UtcNow;
        var raw = new StringBuilder();
        var r = await Ollama.Chat(model, messages, maxNew, piece =>
        {
            if (job.FirstMs < 0) job.FirstMs = sw.Elapsed.TotalMilliseconds;
            raw.Append(piece);
            Show(job, Think.Replace(raw.ToString(), "").TrimStart());
        }, job.Cancel.Token);
        job.PromptTokens = r.PromptTokens;
        job.NewTokens = r.NewTokens;
        job.TokPerSec = r.TokPerSec;
    }

    void GenerateWinMl(Job job, string name, JsonArray messages, int maxNew, Stopwatch sw)
    {
        Ensure(name);
        lastUse = DateTime.UtcNow;
        var prompt = tokenizer.ApplyChatTemplate(null, messages.ToJsonString(), null, true);
        using var seqs = tokenizer.Encode(prompt);
        job.PromptTokens = seqs[0].Length;
        using var gp = new GeneratorParams(model);
        gp.SetSearchOption("max_length", job.PromptTokens + maxNew);
        gp.SetSearchOption("do_sample", false);
        using var gen = new Generator(model, gp);
        gen.AppendTokenSequences(seqs);
        // Jedes Mal die ganze Antwort dekodieren statt TokenizerStream: der Stream setzt Token aus mehreren „▁“ (Gemma) nicht
        // in Leerzeichen um und wiederholt am Ende das letzte Stück
        while (!gen.IsDone() && !job.Cancel.IsCancellationRequested)
        {
            gen.GenerateNextToken();
            job.NewTokens++;
            if (job.FirstMs < 0) job.FirstMs = sw.Elapsed.TotalMilliseconds;
            var answer = tokenizer.Decode(gen.GetSequence(0)[job.PromptTokens..]);
            // „▁“ (SentencePiece-Leerzeichen) aus Zusatz-Token wie „▁▁▁“ setzt der Decoder nicht um
            var visible = Think.Replace(answer, "").Replace('▁', ' ').TrimStart();
            // Ein angefangenes Mehrbyte-Zeichen (U+FFFD am Ende) erst zeigen, wenn es vollständig ist
            if (visible.EndsWith('�') && !gen.IsDone()) continue;
            Show(job, visible);
        }
    }

    /// <summary>
    /// Neuer Text seit dem letzten Abholen; nur der PC, der die Antwort gestartet hat, darf abholen. Gibt es noch nichts Neues,
    /// wartet die Anfrage bis zu einer Sekunde darauf (so kommt jedes Stück sofort, ohne ständiges Nachfragen).
    /// </summary>
    public async Task<JsonObject> Poll(string client, string id)
    {
        if (id == null || !jobs.TryGetValue(id, out var job) || job.Client != client) throw new InvalidOperationException(L.T("Antwort unbekannt oder abgelaufen", "Answer unknown or expired"));
        bool fresh;
        lock (job) fresh = job.Text.Length > job.Sent;
        if (!fresh && !job.Done) await job.WaitAsync(1000);
        string delta;
        lock (job)
        {
            var text = job.Text.ToString();
            delta = text.Length > job.Sent ? text[job.Sent..] : "";
            job.Sent = Math.Max(job.Sent, text.Length);
        }
        var reply = new JsonObject { ["text"] = delta, ["done"] = job.Done && job.Sent >= job.Text.Length };
        if (job.Error != null) reply["error"] = job.Error;
        if (job.Done)
        {
            double genS = (job.TotalMs - job.FirstMs) / 1000;
            reply["stats"] = new JsonObject
            {
                ["model"] = loaded ?? Selected, ["promptTokens"] = job.PromptTokens, ["newTokens"] = job.NewTokens,
                ["firstMs"] = Math.Round(job.FirstMs), ["tokPerSec"] = job.TokPerSec ?? (job.NewTokens > 1 && genS > 0 ? Math.Round((job.NewTokens - 1) / genS, 1) : null),
            };
        }
        return reply;
    }

    public void Cancel(string client, string id)
    {
        if (id != null && jobs.TryGetValue(id, out var job) && job.Client == client) job.Cancel.Cancel();
    }
}
