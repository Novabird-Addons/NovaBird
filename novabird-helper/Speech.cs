// Vorlesen im Helper: Qwen3-TTS 0.6B auf der Grafikkarte (llama.cpp/Vulkan, Decoder ONNX auf der CPU) als eigener
// Python-Prozess, nur auf 127.0.0.1 – wie Ollama. Thunderbird schickt Satz für Satz verschlüsselt (NetServer op "tts") und
// spielt den Ton selbst ab; der Helper-PC gibt nichts aus.
//  - Einrichten (Web-Oberfläche → Vorlesen): alles mit fester Adresse und SHA-256, braucht keine Adminrechte und kein
//    installiertes Python. <Datenordner>\tts\
//      python\   Python 3.11.9 portabel (python.org) + Pakete als Wheels von PyPI, ohne pip entpackt (Wheels sind Zip-Dateien)
//      qwen3\    Engine HaujetZhao/Qwen3-TTS-GGUF (MIT) mit llama.cpp (MIT, Vulkan), Modell Qwen3-TTS-12Hz-0.6B-Base (Apache-2.0)
//                als GGUF/ONNX – beides aus dem Release v1.0.0 von c4bridge
//      stimmen\  Stimmvorlagen <name>.wav + gesprochener Text <name>.txt (5–10 s); vier synthetische aus c4bridge (MIT),
//                eigene lassen sich dazulegen. Namen mit „en_“ sind englisch; Standard je Sprache: ttsVoiceGerman / ttsVoiceEnglish.
//    Tests: ttsPython / ttsEngineDir zeigen auf eine andere Installation.
//  - Startet beim ersten Satz (etwa 6 s), endet nach 15 Minuten ohne Satz (Grafikspeicher frei, etwa 0,8 GB).
//  - Der Dienst bekommt bei jedem Start einen Zufallsschlüssel: andere Programme auf dem PC können ihn nicht benutzen.
using System.Diagnostics;
using System.IO.Compression;
using System.Net.Http;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

sealed class Speech
{
    public const int DefaultPort = 47534, MaxChars = 600;
    public const string Version = "1"; // Stand der Pakete unten; ändert er sich, ist neu einzurichten
    static readonly TimeSpan IdleStop = TimeSpan.FromMinutes(15), StartWait = TimeSpan.FromSeconds(120);
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(2) };
    static readonly HttpClient Download = new() { Timeout = Timeout.InfiniteTimeSpan };
    static readonly Regex VoiceName = new("^[A-Za-z0-9_-]{1,40}$");
    // Sprachen der Engine; Stimmvorlagen gibt es auf Deutsch und Englisch, andere Sprachen sprechen mit der englischen Stimme
    public static readonly string[] Langs = { "german", "english", "french", "spanish", "italian", "portuguese", "russian", "chinese", "japanese", "korean" };
    readonly SemaphoreSlim gate = new(1, 1);
    Process process;
    string token;
    DateTime lastUse;
    System.Threading.Timer idle;

    // ---- Pakete (Art, Adresse, SHA-256, Größe; bei "Voice" der Dateiname im Ordner stimmen) --------------------------------
    sealed record Part(string Kind, string Url, string Sha256, long Bytes, string Name = null);
    const string C4 = "https://github.com/blublub/c4bridge/releases/download/v1.0.0/";
    const string C4Raw = "https://raw.githubusercontent.com/blublub/c4bridge/2e0d8f03811ddcc1d713544e3fbdea2444829b2f/data/tts/";
    static readonly Part[] Parts =
    {
        new("Python", "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip", "009d6bf7e3b2ddca3d784fa09f90fe54336d5b60f0e0f305c37f400bf83cfd3b", 11249023),
        new("Wheel", "https://files.pythonhosted.org/packages/c5/31/7fc6239c12bce7e931463251cca4426c465e1876ba3cc785402ef4dd8f4e/numpy-2.4.6-cp311-cp311-win_amd64.whl", "1e254a00cdf42b1e4d5b3d68d33af63268d41340d8885df2ab6470f2e1500147", 12608406),
        new("Wheel", "https://files.pythonhosted.org/packages/be/90/99566dc6398028e7691a5b12720fd85f757a0901818b84599d28abb3f085/onnxruntime_directml-1.24.4-cp311-cp311-win_amd64.whl", "96642a787e5a6f33bf043521c0f06eb1eb663f6b830e5862a2026d03f9c90543", 25106000),
        new("Wheel", "https://files.pythonhosted.org/packages/b3/bb/d71d6da82763528c2c2ed6b59a9d6142c6595545a4c448e2085d155e88c2/gguf-0.19.0-py3-none-any.whl", "70bcd10edfe697fb2dad6e40af2234b9d8ece9a41a99761405121ebda1c3c1cd", 118475),
        new("Wheel", "https://files.pythonhosted.org/packages/da/e3/ea007450a105ae919a72393cb06f122f288ef60bba2dc64b26e2646fa315/pyyaml-6.0.3-cp311-cp311-win_amd64.whl", "9f3bfb4965eb874431221a3ff3fdcddc7e74e3b07799e0e84ca4a0f867d449bf", 158763),
        new("Wheel", "https://files.pythonhosted.org/packages/a7/03/921a3d3c75785aca9ebfbfcabfbc3a1be12e2ab5265deb026d55a5a3f83e/tqdm-4.70.1-py3-none-any.whl", "c293e525e6fef9c20e8728fd4612df02a0aa31bb5fe91ecd93e123b1b7bffa73", 80199),
        new("Wheel", "https://files.pythonhosted.org/packages/d1/d6/3965ed04c63042e047cb6a3e6ed1a63a35087b6a609aa3a15ed8ac56c221/colorama-0.4.6-py2.py3-none-any.whl", "4f1d9991f5acc0ca119f9d443620b77f9d6b33703e51011c16baf57afb285fc6", 25335),
        new("Wheel", "https://files.pythonhosted.org/packages/65/71/0670843133a43d43070abeb1949abfdef12a86d490bea9cd9e18e37c5ff7/tokenizers-0.22.2-cp39-abi3-win_amd64.whl", "c9ea31edff2968b44a88f97d784c2f16dc0729b8b143ed004699ebca91f05c48", 2747786),
        new("Wheel", "https://files.pythonhosted.org/packages/ed/97/b39c18ac1df45e755ca22b8b00e872929da5d107998a207a5e4ac831bfda/soundfile-0.14.0-py2.py3-none-win_amd64.whl", "299491d3499460fb1b74bb4bd78b57ffc2d243a5fafa7b6ec1b264875c78453e", 1021480),
        new("Wheel", "https://files.pythonhosted.org/packages/73/c0/77ba02423c2f7d7091143c45cd49e0e6575c4c1967394bb542bd923a9b74/cffi-2.1.1-cp311-cp311-win_amd64.whl", "42f6930c31dc7f50732c9ae793c2786c7b6b044195967bbdde40bb9be81c4cc0", 185096),
        new("Wheel", "https://files.pythonhosted.org/packages/b6/ae/315bbeee126a769cbde43cf4908acb4b40408d8bf8bbf334dd7368d8dadf/pycparser-3.12-py3-none-any.whl", "a076f3f489b39b43ed13563a1dafe42447445bec2e294154ec5c57fcdda4c85e", 62600),
        new("Wheel", "https://files.pythonhosted.org/packages/95/da/0d1df507cf574b3f224ccc3d45244c9a1d732c81dcb26b1e8a766ae271a8/scipy-1.17.1-cp311-cp311-win_amd64.whl", "d30e57c72013c2a4fe441c2fcb8e77b14e152ad48b5464858e07e2ad9fbfceff", 36607512),
        new("Wheel", "https://files.pythonhosted.org/packages/8d/3e/cbc593c31a5f0d817b3fe97e64aa8461bd0f55cb07b67ce1b776296ae336/sounddevice-0.5.6-py3-none-win_amd64.whl", "7f4162f514f007b0bf25a3ccfed3f1705bc2ec311888a90232729eec4f57a4f4", 1009630),
        new("Wheel", "https://files.pythonhosted.org/packages/49/d3/b8441a820a491ddfc024b0b0cf0393375b75ea13866d9c66727e54c2fc80/typing_extensions-4.16.0-py3-none-any.whl", "481caa481374e813c1b176ada14e97f1f67a4539ce9cfeb3f350d78d6370c2e8", 45571),
        new("Engine", C4 + "qwen3-engine-win-x64.zip", "debe765bf5c605c58dc8576d7cc44c31e4f521d4db40f2d50f74280d9cc3fca5", 28317339),
        new("Model", C4 + "qwen3-tts-0.6b-base.zip", "3c6f5ca8b71e5353bc32616cf2c6a0e7b86041c41f374d5071cc33c01b67b0f7", 1389107758),
        new("Voice", C4Raw + "qwen_ref_ruhig.wav", "e888d9faaeedb18cac344783793992f9f4fca2d699ecb9c0c74a9a8408916971", 412844, "ruhig.wav"),
        new("Voice", C4Raw + "qwen_ref_ruhig.txt", "1e5f3241b3fd38902d4f06aafb60fceba21e2b32e75903b427c429abf6c25352", 135, "ruhig.txt"),
        new("Voice", C4Raw + "qwen_ref_abenteuer.wav", "330e61c2876c6cddb66d5f7d0a3586753dbe04430d572df959fbe05123f0749f", 448844, "abenteuer.wav"),
        new("Voice", C4Raw + "qwen_ref_abenteuer.txt", "1e5f3241b3fd38902d4f06aafb60fceba21e2b32e75903b427c429abf6c25352", 135, "abenteuer.txt"),
        new("Voice", C4Raw + "qwen_ref_en_calm.wav", "f5b960ca065e0db3e2e87a79457f56a425d6883c99b3ccdaa729cf0f6c2199e2", 330284, "en_calm.wav"),
        new("Voice", C4Raw + "qwen_ref_en_calm.txt", "c75254f4b7f51846b88d07904c0323eccb79ac2281bc2f08e71d5ae72529427b", 120, "en_calm.txt"),
        new("Voice", C4Raw + "qwen_ref_en_adventure.wav", "65165e7f792364734b803b34ee201cbb8582b5d3a91fa3ccdb7b125c97a16ed9", 349484, "en_adventure.wav"),
        new("Voice", C4Raw + "qwen_ref_en_adventure.txt", "c75254f4b7f51846b88d07904c0323eccb79ac2281bc2f08e71d5ae72529427b", 120, "en_adventure.txt"),
    };
    public static long DownloadBytes => Parts.Sum(p => p.Bytes);

    public static string Dir => Path.Combine(Settings.Dir, "tts");
    static string EngineDir => (string)Settings.Load()["ttsEngineDir"] is { Length: > 0 } d ? d : Path.Combine(Dir, "qwen3");
    static string PythonDir => Path.Combine(Dir, "python");
    static string Python => (string)Settings.Load()["ttsPython"] is { Length: > 0 } p ? p : Path.Combine(PythonDir, "python.exe");
    static string VoiceDir => Path.Combine(Dir, "stimmen");
    static string VersionFile => Path.Combine(Dir, "novabird-version.txt");
    static int Port => (int?)Settings.Load()["ttsPort"] ?? DefaultPort;
    static bool TestInstall => (string)Settings.Load()["ttsPython"] is { Length: > 0 };

    public static bool Installed => File.Exists(Python) && File.Exists(Path.Combine(EngineDir, "model-base-small", "qwen3_tts_talker.q5_k.gguf"))
                                    && (TestInstall || (File.Exists(VersionFile) && File.ReadAllText(VersionFile).Trim() == Version));

    /// <summary>Vorlesen anbieten (nach dem Einrichten an; aus = Thunderbird zeigt den Knopf nicht, der Dienst läuft nicht).</summary>
    public static bool Enabled
    {
        get => (bool?)Settings.Load()["ttsEnabled"] ?? true;
        set
        {
            var s = Settings.Load();
            s["ttsEnabled"] = value;
            Settings.Save(s);
        }
    }

    public bool Running => process is { HasExited: false };
    public bool Available => Installed && Enabled && Voices().Count > 0;

    // Zustand der Einrichtung in beiden Sprachen (entsteht im Hintergrund, angezeigt in der Sprache des Betrachters)
    volatile Txt installing, lastError;
    public string Installing => installing?.ToString();
    public int? InstallingPct => installing?.Pct;
    public string LastError => lastError?.ToString();

    /// <summary>Stimmvorlagen mit Text (Name, Sprache "german"/"english").</summary>
    public static List<(string Name, string Lang)> Voices()
    {
        if (!Directory.Exists(VoiceDir)) return new();
        return Directory.GetFiles(VoiceDir, "*.wav").Select(Path.GetFileNameWithoutExtension)
            .Where(n => VoiceName.IsMatch(n) && File.Exists(Path.Combine(VoiceDir, n + ".txt")))
            .OrderBy(n => n).Select(n => (n, n.StartsWith("en_") ? "english" : "german")).ToList();
    }

    /// <summary>Für „hello“ (Thunderbird): nur, ob es geht und welche Stimmen es gibt.</summary>
    public JsonObject Info() => new()
    {
        ["available"] = Available,
        ["running"] = Running,
        ["voices"] = new JsonArray(Voices().Select(v => (JsonNode)new JsonObject { ["name"] = v.Name, ["lang"] = v.Lang }).ToArray()),
    };

    /// <summary>Für die Web-Oberfläche.</summary>
    public JsonObject Status()
    {
        var s = Settings.Load();
        var o = Info();
        o["version"] = Version;
        o["installed"] = Installed;
        o["enabled"] = Enabled;
        o["installing"] = Installing;
        o["installingPct"] = InstallingPct;
        o["error"] = LastError;
        o["downloadMb"] = DownloadBytes / 1_000_000;
        o["voiceGerman"] = (string)s["ttsVoiceGerman"];
        o["voiceEnglish"] = (string)s["ttsVoiceEnglish"];
        o["dir"] = Dir;
        return o;
    }

    // ---- Einrichten ----------------------------------------------------------------------------------------------------
    /// <summary>Alles laden, prüfen und entpacken (im Hintergrund; Fortschritt in Installing).</summary>
    public void Install()
    {
        if (installing != null) return;
        installing = new Txt("Lade Vorlesen …", "Downloading read-aloud …", 0);
        lastError = null;
        Task.Run(async () =>
        {
            var dl = Path.Combine(Dir, "download");
            try
            {
                Directory.CreateDirectory(dl);
                long total = DownloadBytes, done = 0;
                var files = new List<(Part Part, string File)>();
                foreach (var p in Parts)
                {
                    var file = Path.Combine(dl, p.Name ?? Path.GetFileName(new Uri(p.Url).AbsolutePath));
                    if (!(File.Exists(file) && await Sha(file) == p.Sha256))
                    {
                        await Fetch(p.Url, file, b => installing = Progress(done + b, total));
                        if (await Sha(file) != p.Sha256)
                        {
                            File.Delete(file);
                            throw new InvalidOperationException(L.T($"Prüfsumme stimmt nicht: {Path.GetFileName(file)}", $"Checksum does not match: {Path.GetFileName(file)}"));
                        }
                    }
                    done += p.Bytes;
                    installing = Progress(done, total);
                    files.Add((p, file));
                }
                installing = new Txt("Entpacke …", "Unpacking …");
                await gate.WaitAsync();
                try
                {
                    Stop();
                    File.Delete(VersionFile);
                    foreach (var d in new[] { PythonDir, Path.Combine(Dir, "qwen3") })
                        if (Directory.Exists(d)) Directory.Delete(d, true);
                    var site = Path.Combine(PythonDir, "Lib", "site-packages");
                    foreach (var (p, file) in files)
                    {
                        switch (p.Kind)
                        {
                            case "Python": Unzip(file, PythonDir); break;
                            case "Wheel": Unzip(file, site); break;
                            case "Engine": Unzip(file, Path.Combine(Dir, "qwen3")); break;
                            case "Model": Unzip(file, Path.Combine(Dir, "qwen3", "model-base-small")); break;
                            case "Voice":
                                Directory.CreateDirectory(VoiceDir);
                                File.Copy(file, Path.Combine(VoiceDir, p.Name), true);
                                break;
                        }
                    }
                    // Suchpfad des portablen Python: eigene Pakete; „import site“ bleibt aus (nichts vom PC mischt sich ein)
                    File.WriteAllText(Path.Combine(PythonDir, "python311._pth"), "python311.zip\r\n.\r\nLib\\site-packages\r\n");
                    File.WriteAllText(VersionFile, Version);
                }
                finally { gate.Release(); }
                Directory.Delete(dl, true);
                var s = Settings.Load();
                if (s["ttsVoiceGerman"] == null) s["ttsVoiceGerman"] = "ruhig";
                if (s["ttsVoiceEnglish"] == null) s["ttsVoiceEnglish"] = "en_calm";
                s["ttsEnabled"] = true;
                Settings.Save(s);
                Log.Write($"Vorlesen eingerichtet (Stand {Version})");
                installing = null;
            }
            catch (Exception e)
            {
                installing = null;
                lastError = new Txt("Vorlesen einrichten: " + e.Message, "Setting up read-aloud: " + e.Message);
                Log.Write(lastError.De);
            }
        });
    }

    static Txt Progress(long done, long total)
    {
        int pct = (int)(done * 100 / Math.Max(1, total));
        return new Txt($"Lade Vorlesen: {pct} % von {total / 1_000_000} MB", $"Downloading read-aloud: {pct} % of {total / 1_000_000} MB", pct);
    }

    /// <summary>Datei laden; große Dateien setzen nach einem Abbruch fort (.part).</summary>
    static async Task Fetch(string url, string file, Action<long> progress)
    {
        var part = file + ".part";
        long have = File.Exists(part) ? new FileInfo(part).Length : 0;
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.UserAgent.ParseAdd("NovaBird-Helper/" + Program.Version);
        if (have > 0) req.Headers.Range = new System.Net.Http.Headers.RangeHeaderValue(have, null);
        using var res = await Download.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        if (res.StatusCode != System.Net.HttpStatusCode.PartialContent) have = 0; // Server setzt nicht fort: von vorn
        res.EnsureSuccessStatusCode();
        using (var src = await res.Content.ReadAsStreamAsync())
        using (var dst = new FileStream(part, have > 0 ? FileMode.Append : FileMode.Create))
        {
            var buf = new byte[1 << 20];
            int n;
            long last = 0;
            while ((n = await src.ReadAsync(buf)) > 0)
            {
                await dst.WriteAsync(buf.AsMemory(0, n));
                have += n;
                if (have - last > (4 << 20)) { last = have; progress(have); }
            }
        }
        File.Move(part, file, true);
    }

    static async Task<string> Sha(string file)
    {
        await using var f = File.OpenRead(file);
        return Convert.ToHexString(await SHA256.HashDataAsync(f)).ToLowerInvariant();
    }

    static void Unzip(string zip, string target)
    {
        var root = Path.GetFullPath(target) + Path.DirectorySeparatorChar;
        using var a = ZipFile.OpenRead(zip);
        foreach (var e in a.Entries)
        {
            if (string.IsNullOrEmpty(e.Name)) continue;
            var dst = Path.GetFullPath(Path.Combine(target, e.FullName));
            if (!dst.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Ungültiger Pfad im Paket: " + e.FullName); // Zip-Slip
            Directory.CreateDirectory(Path.GetDirectoryName(dst));
            e.ExtractToFile(dst, true);
        }
    }

    /// <summary>Programm und Modell entfernen (etwa 2 GB); Stimmen und Einstellungen bleiben.</summary>
    public async Task Remove()
    {
        if (installing != null) throw new InvalidOperationException(L.T("Einrichtung läuft noch", "Setup is still running"));
        await gate.WaitAsync();
        try
        {
            Stop();
            await Task.Delay(500); // Dateien freigeben lassen
            File.Delete(VersionFile);
            foreach (var d in new[] { PythonDir, Path.Combine(Dir, "qwen3"), Path.Combine(Dir, "download") })
                if (Directory.Exists(d)) Directory.Delete(d, true);
            Log.Write("Vorlesen entfernt");
        }
        finally { gate.Release(); }
    }

    // ---- Sprechen ------------------------------------------------------------------------------------------------------
    /// <summary>Einen Satz sprechen: WAV (24 kHz, mono, 16 bit). voice leer = eingestellte bzw. erste Stimme der Sprache.</summary>
    public async Task<(byte[] Wav, double Ms)> Say(string text, string lang, string voice)
    {
        text = (text ?? "").Trim();
        if (text.Length == 0) throw new InvalidOperationException(L.T("kein Text", "no text"));
        if (text.Length > MaxChars) text = text[..MaxChars];
        if (!Langs.Contains(lang)) lang = "german";
        var voiceLang = lang == "german" ? "german" : "english";
        if (!Installed) throw new InvalidOperationException(L.T("Vorlesen ist im Helper nicht eingerichtet", "Read-aloud is not set up in the helper"));
        if (!Enabled) throw new InvalidOperationException(L.T("Vorlesen ist im Helper ausgeschaltet", "Read-aloud is switched off in the helper"));
        var voices = Voices();
        var v = voices.FirstOrDefault(x => x.Name == voice);
        // sonst die eingestellte Stimme der Sprache (ttsVoiceGerman / ttsVoiceEnglish), sonst die erste
        if (v.Name == null) v = voices.FirstOrDefault(x => x.Name == (string)Settings.Load()[voiceLang == "english" ? "ttsVoiceEnglish" : "ttsVoiceGerman"] && x.Lang == voiceLang);
        if (v.Name == null) v = voices.FirstOrDefault(x => x.Lang == voiceLang);
        if (v.Name == null) v = voices.FirstOrDefault();
        if (v.Name == null) throw new InvalidOperationException(L.T("keine Stimme im Helper", "no voice in the helper"));
        var wav = Path.Combine(VoiceDir, v.Name + ".wav");
        var refText = File.ReadAllText(Path.Combine(VoiceDir, v.Name + ".txt")).Trim();

        await gate.WaitAsync();
        try
        {
            await EnsureStarted(wav, refText);
            lastUse = DateTime.UtcNow;
            var sw = Stopwatch.StartNew();
            using var req = new HttpRequestMessage(HttpMethod.Post, $"http://127.0.0.1:{Port}/tts")
            {
                Content = new StringContent(new JsonObject { ["text"] = text, ["lang"] = lang, ["ref"] = wav, ["ref_text"] = refText }.ToJsonString(), Encoding.UTF8, "application/json"),
            };
            req.Headers.Add("X-NB-Token", token);
            using var r = await Http.SendAsync(req);
            var body = await r.Content.ReadAsByteArrayAsync();
            if (!r.IsSuccessStatusCode) throw new InvalidOperationException(L.T("Vorlesen: ", "Read-aloud: ") + Encoding.UTF8.GetString(body, 0, Math.Min(body.Length, 200)));
            lastUse = DateTime.UtcNow;
            return (body, sw.Elapsed.TotalMilliseconds);
        }
        finally { gate.Release(); }
    }

    async Task EnsureStarted(string wav, string refText)
    {
        if (Running && await Healthy()) return;
        Stop();
        Directory.CreateDirectory(Dir);
        // Dienst-Skript aus der exe neben die Daten legen (immer neu: passt zur Helper-Version)
        var script = Path.Combine(Dir, "nbtts.py");
        using (var res = typeof(Speech).Assembly.GetManifestResourceStream("tts/nbtts.py"))
        using (var f = File.Create(script)) res.CopyTo(f);
        token = Convert.ToHexString(RandomNumberGenerator.GetBytes(24));
        var psi = new ProcessStartInfo(Python)
        {
            // eigene Eingabe: die geerbte des Helpers (Konsole/Pipe, auf der er gerade liest) lässt Python beim Start hängen
            UseShellExecute = false, CreateNoWindow = true, RedirectStandardInput = true, RedirectStandardOutput = true,
            RedirectStandardError = true, WorkingDirectory = EngineDir,
        };
        foreach (var a in new[] { "-I", "-u", "-X", "utf8", script, "--dir", EngineDir, "--port", Port.ToString(), "--ref", wav, "--ref-text", refText })
            psi.ArgumentList.Add(a);
        psi.Environment["NB_TTS_TOKEN"] = token;
        var log = Path.Combine(Dir, "tts.log");
        process = Process.Start(psi);
        process.StandardInput.Close();
        Ollama.AttachToJob(process); // endet mit dem Helper
        _ = Task.Run(() => Ollama.Pump(process.StandardError, log));
        _ = Task.Run(() => Ollama.Pump(process.StandardOutput, log));
        var until = DateTime.UtcNow + StartWait;
        while (DateTime.UtcNow < until)
        {
            if (process.HasExited) throw new InvalidOperationException(L.T("Vorlesen ließ sich nicht starten (tts.log im Datenordner)", "Read-aloud did not start (tts.log in the data folder)"));
            if (await Healthy())
            {
                Log.Write($"Vorlesen läuft auf 127.0.0.1:{Port}");
                idle ??= new System.Threading.Timer(_ => { if (Running && DateTime.UtcNow - lastUse > IdleStop && gate.Wait(0)) { try { Stop(); } finally { gate.Release(); } } }, null, TimeSpan.FromMinutes(1), TimeSpan.FromMinutes(1));
                return;
            }
            await Task.Delay(300);
        }
        Stop();
        throw new InvalidOperationException(L.T("Vorlesen startet zu langsam", "Read-aloud starts too slowly"));
    }

    async Task<bool> Healthy()
    {
        try
        {
            using var req = new HttpRequestMessage(HttpMethod.Get, $"http://127.0.0.1:{Port}/health");
            req.Headers.Add("X-NB-Token", token);
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(2));
            using var r = await Http.SendAsync(req, cts.Token);
            return r.IsSuccessStatusCode;
        }
        catch { return false; }
    }

    public void Stop()
    {
        try { if (process is { HasExited: false }) process.Kill(true); } catch { /* schon weg */ }
        process = null;
    }
}
