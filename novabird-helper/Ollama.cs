// Ollama im Hintergrund, vom Helper verwaltet (Standard für die KI-Zusammenfassung; Vergleich der Modelle in docs/llm-test).
//  - Programm: festes Release von GitHub (Version und SHA-256 unten), entpackt nach <Datenordner>\ollama\programm; die
//    CUDA-Bibliotheken nur, wenn eine NVIDIA-Karte da ist (AMD/Intel rechnen über Vulkan). Modelle in ...\ollama\modelle.
//  - Läuft nur auf 127.0.0.1 (Port 47533, Einstellung ollamaPort) und ist von außen nie erreichbar; Thunderbird spricht
//    weiter verschlüsselt mit dem Helper (NetServer op chat), der Helper reicht an Ollama weiter.
//  - Ein Job-Objekt beendet Ollama zusammen mit dem Helper; stürzt Ollama ab, startet der Helper es neu.
using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class Ollama
{
    public const string Version = "0.40.4";
    const string Url = "https://github.com/ollama/ollama/releases/download/v" + Version + "/ollama-windows-amd64.zip";
    const string Sha256 = "7485a1172f8527db4342a63521b9342fc466185ff0855da378cc864ecf6354cf";
    const long ZipBytes = 1_470_000_000; // ungefähr, für die Anzeige
    public const int DefaultPort = 47533;

    /// <summary>Die zwei besten Modelle aus docs/llm-test (RX 6900 XT) für die Auswahlliste; andere per Name.</summary>
    public static readonly (string Tag, string Label, double Gb)[] Catalog =
    {
        ("gemma4:e4b", "Gemma 4 E4B – Empfehlung (98 von 100 Punkten, 160–175 Token/s, etwa 5,5 GB Grafikspeicher)", 6.6),
        ("qwen3.5:4b", "Qwen3.5-4B (96,7 Punkte, etwa 110 Token/s, kleiner: etwa 4 GB Grafikspeicher)", 3.3),
    };

    static readonly HttpClient Http = new() { Timeout = Timeout.InfiniteTimeSpan };
    Process process;
    IntPtr job;
    volatile bool stopping;
    int restarts;

    // Zustände in beiden Sprachen (entstehen im Hintergrund, angezeigt in der Sprache des Betrachters)
    Txt status = new("aus", "off"), pulling, installing, lastError;
    volatile bool running;
    public string Status => status.ToString();
    public string Pulling => pulling?.ToString();       // "gemma4:e4b 37 %"
    public string Installing => installing?.ToString(); // "Lade Ollama: 37 %"
    public string LastError => lastError?.ToString();

    public static string Dir => Path.Combine(Settings.Dir, "ollama");
    static string ProgramDir => Path.Combine(Dir, "programm");
    static string ModelDir => Path.Combine(Dir, "modelle");
    static string Exe => Path.Combine(ProgramDir, "ollama.exe");
    static string VersionFile => Path.Combine(ProgramDir, "novabird-version.txt");

    public static int Port => (int?)Settings.Load()["ollamaPort"] ?? DefaultPort;
    string Base => $"http://127.0.0.1:{Port}";

    public static bool Installed => File.Exists(Exe) && File.Exists(VersionFile) && File.ReadAllText(VersionFile).Trim() == Version;

    /// <summary>Ollama benutzen (nach dem Einrichten an; aus = Ollama läuft nicht).</summary>
    public static bool Enabled
    {
        get => (bool?)Settings.Load()["ollamaEnabled"] ?? false;
        set
        {
            var s = Settings.Load();
            s["ollamaEnabled"] = value;
            Settings.Save(s);
        }
    }

    public bool Running => process is { HasExited: false } && running;

    // ---- Einrichten ------------------------------------------------------------------------------------------------------
    /// <summary>Programm laden, prüfen, entpacken und starten (im Hintergrund; Fortschritt in Installing).</summary>
    public void Install()
    {
        if (installing != null) return;
        installing = new Txt("Lade Ollama …", "Downloading Ollama …");
        lastError = null;
        Task.Run(async () =>
        {
            var zip = Path.Combine(Dir, $"ollama-{Version}.zip");
            try
            {
                Directory.CreateDirectory(Dir);
                if (!File.Exists(zip) || !await Verify(zip))
                {
                    await Download(zip);
                    if (!await Verify(zip)) throw new InvalidOperationException(L.T("Prüfsumme des Ollama-Pakets stimmt nicht", "Checksum of the Ollama package does not match"));
                }
                installing = new Txt("Entpacke …", "Unpacking …");
                Stop();
                bool cuda = Dxgi.HasNvidia();
                if (Directory.Exists(ProgramDir)) Directory.Delete(ProgramDir, true);
                using (var a = ZipFile.OpenRead(zip))
                    foreach (var e in a.Entries)
                    {
                        if (string.IsNullOrEmpty(e.Name)) continue;
                        if (!cuda && e.FullName.Replace('\\', '/').Contains("/cuda_")) continue;
                        var dst = Path.GetFullPath(Path.Combine(ProgramDir, e.FullName));
                        if (!dst.StartsWith(Path.GetFullPath(ProgramDir) + Path.DirectorySeparatorChar)) continue; // Zip-Slip
                        Directory.CreateDirectory(Path.GetDirectoryName(dst));
                        e.ExtractToFile(dst, true);
                    }
                File.WriteAllText(VersionFile, Version);
                File.Delete(zip);
                Log.Write($"Ollama {Version} eingerichtet ({(cuda ? "mit CUDA" : "ohne CUDA, Vulkan")})");
                Enabled = true;
                installing = null;
                Start();
            }
            catch (Exception e)
            {
                installing = null;
                lastError = new Txt("Ollama einrichten: " + e.Message, "Setting up Ollama: " + e.Message);
                Log.Write(lastError.De);
            }
        });
    }

    async Task Download(string zip)
    {
        var part = zip + ".part";
        long have = File.Exists(part) ? new FileInfo(part).Length : 0;
        using var req = new HttpRequestMessage(HttpMethod.Get, Url);
        if (have > 0) req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(have, null);
        using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        if (res.StatusCode != System.Net.HttpStatusCode.PartialContent) have = 0; // Server setzt nicht fort: von vorn
        res.EnsureSuccessStatusCode();
        long total = have + (res.Content.Headers.ContentLength ?? ZipBytes);
        using (var src = await res.Content.ReadAsStreamAsync())
        using (var dst = new FileStream(part, have > 0 ? FileMode.Append : FileMode.Create))
        {
            var buf = new byte[1 << 20];
            int n;
            while ((n = await src.ReadAsync(buf)) > 0)
            {
                await dst.WriteAsync(buf.AsMemory(0, n));
                have += n;
                installing = new Txt($"Lade Ollama: {have * 100 / Math.Max(1, total)} % von {total / 1_000_000} MB", $"Downloading Ollama: {have * 100 / Math.Max(1, total)} % of {total / 1_000_000} MB");
            }
        }
        File.Move(part, zip, true);
    }

    async Task<bool> Verify(string zip)
    {
        installing = new Txt("Prüfe …", "Verifying …");
        await using var f = File.OpenRead(zip);
        return Convert.ToHexString(await SHA256.HashDataAsync(f)).Equals(Sha256, StringComparison.OrdinalIgnoreCase);
    }

    // ---- Starten / Beenden -----------------------------------------------------------------------------------------------
    public void Start()
    {
        if (!Installed || !Enabled || process is { HasExited: false }) return;
        stopping = false;
        Directory.CreateDirectory(ModelDir);
        var psi = new ProcessStartInfo(Exe, "serve")
        {
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true,
            WorkingDirectory = ProgramDir,
        };
        psi.Environment["OLLAMA_HOST"] = $"127.0.0.1:{Port}";
        psi.Environment["OLLAMA_MODELS"] = ModelDir;
        psi.Environment["OLLAMA_VULKAN"] = "1";            // AMD/Intel; NVIDIA nimmt trotzdem CUDA
        psi.Environment["OLLAMA_NO_CLOUD"] = "1";          // keine Cloud-Modelle
        psi.Environment["OLLAMA_KEEP_ALIVE"] = "15m";
        psi.Environment["OLLAMA_NUM_PARALLEL"] = "1";
        psi.Environment["OLLAMA_MAX_LOADED_MODELS"] = "1";
        running = false;
        status = new Txt("startet …", "starting …");
        process = Process.Start(psi);
        AttachToJob(process);
        var logPath = Path.Combine(Dir, "ollama.log");
        _ = Task.Run(() => Pump(process.StandardError, logPath));
        _ = Task.Run(() => Pump(process.StandardOutput, logPath));
        process.EnableRaisingEvents = true;
        process.Exited += (_, _) =>
        {
            if (stopping) return;
            running = false;
            status = new Txt("abgestürzt", "crashed");
            Log.Write($"Ollama beendet (Code {SafeExit()}), starte neu");
            if (++restarts <= 5) Task.Delay(TimeSpan.FromSeconds(5 * restarts)).ContinueWith(_ => Start());
        };
        _ = Task.Run(async () =>
        {
            for (int i = 0; i < 60 && !stopping; i++)
            {
                try
                {
                    var v = JsonNode.Parse(await Http.GetStringAsync($"{Base}/api/version"));
                    status = new Txt($"läuft (Ollama {(string)v["version"]})", $"running (Ollama {(string)v["version"]})");
                    running = true;
                    restarts = 0;
                    Log.Write($"Ollama läuft auf 127.0.0.1:{Port}");
                    return;
                }
                catch { await Task.Delay(500); }
            }
        });
    }

    int SafeExit()
    {
        try { return process.ExitCode; } catch { return -1; }
    }

    static void Pump(StreamReader r, string path)
    {
        // Ollama protokolliert viel: nur die letzten etwa 2 MB behalten
        string line;
        while ((line = r.ReadLine()) != null)
        {
            try
            {
                lock (Http)
                {
                    if (File.Exists(path) && new FileInfo(path).Length > 2_000_000) File.Delete(path);
                    File.AppendAllText(path, line + Environment.NewLine);
                }
            }
            catch { /* Protokoll darf nicht stören */ }
        }
    }

    public void Stop()
    {
        stopping = true;
        try { if (process is { HasExited: false }) process.Kill(true); } catch { /* schon weg */ }
        process = null;
        running = false;
        status = new Txt("aus", "off");
    }

    // Job-Objekt mit „beim Schließen beenden“: Ollama und seine Rechenprozesse enden mit dem Helper, auch bei einem Absturz
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attr, string name);
    [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimit info, int size);
    [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    [StructLayout(LayoutKind.Sequential)]
    struct ExtendedLimit
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount, ReadTransferCount, WriteTransferCount, OtherTransferCount;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    void AttachToJob(Process p)
    {
        try
        {
            if (job == IntPtr.Zero)
            {
                job = CreateJobObject(IntPtr.Zero, null);
                var info = new ExtendedLimit { LimitFlags = 0x2000 }; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
                SetInformationJobObject(job, 9, ref info, Marshal.SizeOf<ExtendedLimit>());
            }
            AssignProcessToJobObject(job, p.Handle);
        }
        catch (Exception e) { Log.Write("Ollama Job-Objekt: " + e.Message); }
    }

    // ---- Modelle -----------------------------------------------------------------------------------------------------------
    public async Task<List<(string Name, long Bytes, string Modified)>> Models()
    {
        var j = JsonNode.Parse(await Http.GetStringAsync($"{Base}/api/tags"));
        return j["models"].AsArray().Select(m => ((string)m["name"], (long?)m["size"] ?? 0, (string)m["modified_at"])).ToList();
    }

    /// <summary>Geladene Modelle mit Grafikspeicher (Bytes).</summary>
    public async Task<List<(string Name, long Vram)>> Loaded()
    {
        var j = JsonNode.Parse(await Http.GetStringAsync($"{Base}/api/ps"));
        return j["models"].AsArray().Select(m => ((string)m["name"], (long?)m["size_vram"] ?? 0)).ToList();
    }

    /// <summary>Modell laden (im Hintergrund, Fortschritt in Pulling).</summary>
    public void Pull(string name)
    {
        if (pulling != null) throw new InvalidOperationException(L.T("Es wird schon ein Modell geladen", "A model is already being downloaded"));
        if (!System.Text.RegularExpressions.Regex.IsMatch(name ?? "", @"^[a-z0-9][a-z0-9._/-]{0,80}(:[A-Za-z0-9._-]{1,60})?$")) throw new ArgumentException(L.T("Modellname", "Model name"));
        pulling = new Txt($"{name}: startet …", $"{name}: starting …");
        lastError = null;
        Task.Run(async () =>
        {
            try
            {
                using var req = new HttpRequestMessage(HttpMethod.Post, $"{Base}/api/pull")
                {
                    Content = new StringContent(new JsonObject { ["model"] = name, ["stream"] = true }.ToJsonString(), Encoding.UTF8, "application/json"),
                };
                using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
                res.EnsureSuccessStatusCode();
                using var r = new StreamReader(await res.Content.ReadAsStreamAsync());
                string line;
                while ((line = await r.ReadLineAsync()) != null)
                {
                    if (line.Length == 0) continue;
                    var j = JsonNode.Parse(line);
                    if ((string)j["error"] is string err) throw new InvalidOperationException(err);
                    long total = (long?)j["total"] ?? 0, done = (long?)j["completed"] ?? 0;
                    pulling = total > 0 ? new Txt($"{name}: {done * 100 / total} % von {total / 1_000_000} MB", $"{name}: {done * 100 / total} % of {total / 1_000_000} MB")
                        : new Txt($"{name}: {(string)j["status"]}", $"{name}: {(string)j["status"]}");
                }
                Log.Write($"Ollama-Modell geladen: {name}");
            }
            catch (Exception e)
            {
                lastError = new Txt($"Modell {name} laden: {e.Message}", $"Downloading model {name}: {e.Message}");
                Log.Write(lastError.De);
            }
            finally { pulling = null; }
        });
    }

    public async Task Delete(string name)
    {
        using var req = new HttpRequestMessage(HttpMethod.Delete, $"{Base}/api/delete")
        {
            Content = new StringContent(new JsonObject { ["model"] = name }.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        (await Http.SendAsync(req)).EnsureSuccessStatusCode();
        Log.Write($"Ollama-Modell gelöscht: {name}");
    }

    // ---- Antworten -----------------------------------------------------------------------------------------------------------
    public sealed record Result(int PromptTokens, int NewTokens, double TokPerSec);

    /// <summary>Antwort streamen (onPiece je Stück). Denkmodus aus, wo es ihn gibt (wie die Extension).</summary>
    public async Task<Result> Chat(string model, JsonArray messages, int maxNew, Action<string> onPiece, CancellationToken ct)
    {
        async Task<HttpResponseMessage> Send(bool think)
        {
            var body = new JsonObject
            {
                ["model"] = model, ["messages"] = messages.DeepClone(), ["stream"] = true,
                ["options"] = new JsonObject { ["num_ctx"] = 16384, ["temperature"] = 0.2, ["num_predict"] = maxNew },
            };
            if (think) body["think"] = false;
            var req = new HttpRequestMessage(HttpMethod.Post, $"{Base}/api/chat") { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
            return await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, ct);
        }
        var res = await Send(true);
        if (res.StatusCode == System.Net.HttpStatusCode.BadRequest)
        {
            res.Dispose();
            res = await Send(false); // Modelle ohne Denkmodus kennen "think" nicht
        }
        using (res)
        {
            if (!res.IsSuccessStatusCode) throw new InvalidOperationException($"Ollama: {(int)res.StatusCode} {await res.Content.ReadAsStringAsync(ct)}");
            using var r = new StreamReader(await res.Content.ReadAsStreamAsync(ct));
            string line;
            while ((line = await r.ReadLineAsync(ct)) != null)
            {
                if (line.Length == 0) continue;
                var j = JsonNode.Parse(line);
                if ((string)j["error"] is string err) throw new InvalidOperationException(err);
                if ((string)j["message"]?["content"] is { Length: > 0 } piece) onPiece(piece);
                if ((bool?)j["done"] == true)
                {
                    int evalCount = (int?)j["eval_count"] ?? 0;
                    long evalNs = (long?)j["eval_duration"] ?? 0;
                    return new Result((int?)j["prompt_eval_count"] ?? 0, evalCount, evalNs > 0 ? Math.Round(evalCount / (evalNs / 1e9), 1) : 0);
                }
            }
        }
        return new Result(0, 0, 0);
    }
}
