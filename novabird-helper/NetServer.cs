// Netz-Modus: Der Helper rechnet auf diesem PC (Grafikkarte) für mehrere PCs im Netz. Thunderbird schickt Texte, der Helper
// antwortet mit Vektoren.
//  - HTTP über einen eigenen kleinen TCP-Server (braucht keine Adminrechte und keine URL-Reservierung). Port 47531.
//  - Kopplung: Code aus 20 Zeichen (wie beim Ordner-Sync); Schlüssel = PBKDF2-SHA256(Code, "NovaBird-Net-1", 300.000 Runden).
//  - Jede Anfrage und jede Antwort ist mit AES-256-GCM verschlüsselt: Mailtexte und Vektoren gehen nie lesbar durchs Netz.
//    Anfrage  POST /nbhelper/v1 {c: Client-Kennung, n: Nonce, d: Chiffrat+Tag}, AAD "nbh1-req|<c>"
//             Inhalt {ts, rid, op, …}: Zeitstempel (±10 min) und eine zufällige Anfrage-Kennung (nur einmal gültig)
//    Antwort  {n, d}, AAD "nbh1-res|<rid>" (gehört genau zu dieser Anfrage)
//    Wer den Code nicht kennt, bekommt 403; nach 20 Fehlversuchen in einer Minute wird die Adresse eine Minute gesperrt.
//  - op "hello" {label, model:{id, revision}} -> Info; op "embed" {model, texts, prio:"query"|"index"} -> {vectors}
//  - Reihenfolge: Suchanfragen vor Indexieren; beim Indexieren kommen die PCs abwechselnd dran (Scheduler). Auf Wunsch rechnet
//    die CPU neben der Grafikkarte mit (Einstellung im Menü, Threads einstellbar).
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

sealed class NetServer
{
    public const int DefaultPort = 47531;
    const string Path = "/nbhelper/v1";
    const int Iterations = 300_000;
    const int MaxHeader = 16 << 10, MaxBody = 8 << 20, MaxTexts = 64, MaxChars = 20_000;
    static readonly TimeSpan Skew = TimeSpan.FromMinutes(10);
    static readonly Regex ClientId = new("^[A-Za-z0-9_-]{8,64}$");

    readonly TcpListener listener;
    readonly ModelSpec model;
    public readonly Scheduler Scheduler;
    byte[] key;
    readonly ConcurrentDictionary<string, DateTime> seen = new(); // rid -> Zeit (gegen Wiederholung)
    readonly ConcurrentDictionary<string, (int Count, DateTime Since)> failures = new();
    public int Port { get; }
    public bool LoopbackOnly { get; }

    public NetServer(ModelSpec model, int port, bool loopbackOnly)
    {
        this.model = model;
        Port = port;
        LoopbackOnly = loopbackOnly;
        Scheduler = new Scheduler(model);
        key = DeriveKey(Code());
        listener = new TcpListener(loopbackOnly ? IPAddress.Loopback : IPAddress.Any, port);
    }

    // ---- Kopplungscode (mit DPAPI in settings.json) ----------------------------------------------------------------------------
    public static string Code()
    {
        var s = Settings.Load();
        if (s["netCode"] is JsonNode n) return Encoding.UTF8.GetString(Settings.Unprotect((string)n));
        return NewCode();
    }

    public static string NewCode()
    {
        var code = Sync.NewCode();
        var s = Settings.Load();
        s["netCode"] = Settings.Protect(Encoding.UTF8.GetBytes(code));
        Settings.Save(s);
        return code;
    }

    /// <summary>Neuer Code: alle bisher gekoppelten PCs müssen den neuen eintragen.</summary>
    public string Renew()
    {
        var code = NewCode();
        key = DeriveKey(code);
        Scheduler.ForgetClients();
        return code;
    }

    static byte[] DeriveKey(string code) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(Sync.Normalize(code)), Encoding.ASCII.GetBytes("NovaBird-Net-1"), Iterations, HashAlgorithmName.SHA256, 32);

    // ---- Server --------------------------------------------------------------------------------------------------------------
    public void Start()
    {
        listener.Start();
        Scheduler.Start();
        Log.Write($"Netz-Modus: Port {Port}{(LoopbackOnly ? " (nur dieser PC)" : "")}");
        _ = AcceptLoop();
    }

    public void Stop()
    {
        try { listener.Stop(); } catch { /* schon zu */ }
        Scheduler.Stop();
    }

    async Task AcceptLoop()
    {
        while (true)
        {
            TcpClient tcp;
            try { tcp = await listener.AcceptTcpClientAsync(); }
            catch { return; } // gestoppt
            _ = Task.Run(() => Serve(tcp));
        }
    }

    async Task Serve(TcpClient tcp)
    {
        using (tcp)
        {
            var ip = (tcp.Client.RemoteEndPoint as IPEndPoint)?.Address?.ToString() ?? "?";
            try
            {
                tcp.ReceiveTimeout = tcp.SendTimeout = 30_000;
                var stream = tcp.GetStream();
                var (method, path, length) = await ReadHead(stream);
                if (length < 0 || length > MaxBody) { await Send(stream, 400, "{\"error\":\"request\"}"); return; }
                // Rumpf immer ganz lesen, sonst bricht die Verbindung ab, bevor der Client die Antwort sieht
                var body = new byte[length];
                int got = 0;
                while (got < length)
                {
                    int n = await stream.ReadAsync(body.AsMemory(got, length - got));
                    if (n <= 0) return;
                    got += n;
                }
                if (Blocked(ip)) { await Send(stream, 429, "{\"error\":\"blocked\"}"); return; }
                if (method == "OPTIONS") { await Send(stream, 204, ""); return; }
                if (path != Path) { await Send(stream, 404, "{\"error\":\"path\"}"); return; }
                if (method == "GET") { await Send(stream, 200, "{\"service\":\"novabird-helper\",\"api\":1}"); return; }
                if (method != "POST" || length == 0) { await Send(stream, 400, "{\"error\":\"request\"}"); return; }
                var (status, reply) = await Handle(body, ip);
                await Send(stream, status, reply);
            }
            catch (Exception e)
            {
                Log.Write($"Netz {ip}: {e.Message}");
            }
        }
    }

    static async Task<(string Method, string Path, int Length)> ReadHead(NetworkStream s)
    {
        var buf = new List<byte>(1024);
        var one = new byte[1];
        while (buf.Count < MaxHeader)
        {
            if (await s.ReadAsync(one) <= 0) throw new IOException("Verbindung beendet");
            buf.Add(one[0]);
            int c = buf.Count;
            if (c >= 4 && buf[c - 4] == '\r' && buf[c - 3] == '\n' && buf[c - 2] == '\r' && buf[c - 1] == '\n') break;
        }
        var lines = Encoding.ASCII.GetString(buf.ToArray()).Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length < 2) throw new IOException("ungültige Anfrage");
        int length = 0;
        foreach (var l in lines.Skip(1))
            if (l.StartsWith("Content-Length:", StringComparison.OrdinalIgnoreCase)) int.TryParse(l[15..].Trim(), out length);
        return (first[0], first[1].Split('?')[0], length);
    }

    static async Task Send(NetworkStream s, int status, string json)
    {
        var body = Encoding.UTF8.GetBytes(json);
        var reason = status switch { 200 => "OK", 204 => "No Content", 400 => "Bad Request", 403 => "Forbidden", 404 => "Not Found", 429 => "Too Many Requests", _ => "Error" };
        var head = $"HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {body.Length}\r\nConnection: close\r\n" +
                   "Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, POST, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type\r\n\r\n";
        await s.WriteAsync(Encoding.ASCII.GetBytes(head));
        if (body.Length > 0) await s.WriteAsync(body);
    }

    bool Blocked(string ip) => failures.TryGetValue(ip, out var f) && f.Count >= 20 && DateTime.UtcNow - f.Since < TimeSpan.FromMinutes(1);

    void Fail(string ip)
    {
        failures.AddOrUpdate(ip, _ => (1, DateTime.UtcNow), (_, f) => DateTime.UtcNow - f.Since > TimeSpan.FromMinutes(1) ? (1, DateTime.UtcNow) : (f.Count + 1, f.Since));
    }

    async Task<(int, string)> Handle(byte[] body, string ip)
    {
        JsonNode env;
        string client;
        byte[] plain;
        try
        {
            env = JsonNode.Parse(body);
            client = (string)env["c"];
            if (client == null || !ClientId.IsMatch(client)) throw new FormatException();
            var nonce = Convert.FromBase64String((string)env["n"]);
            var data = Convert.FromBase64String((string)env["d"]);
            if (nonce.Length != 12 || data.Length < 16) throw new FormatException();
            plain = new byte[data.Length - 16];
            using var aes = new AesGcm(key, 16);
            aes.Decrypt(nonce, data.AsSpan(0, plain.Length), data.AsSpan(plain.Length), plain, Encoding.ASCII.GetBytes("nbh1-req|" + client));
        }
        catch
        {
            Fail(ip);
            await Task.Delay(200);
            return (403, "{\"error\":\"auth\"}"); // falscher Code oder verfälschte Anfrage
        }
        var msg = JsonNode.Parse(plain);
        var rid = (string)msg["rid"];
        var ts = DateTimeOffset.FromUnixTimeMilliseconds((long?)msg["ts"] ?? 0).UtcDateTime;
        JsonObject reply;
        if (string.IsNullOrEmpty(rid) || rid.Length > 64 || (DateTime.UtcNow - ts).Duration() > Skew || !seen.TryAdd(rid, DateTime.UtcNow))
        {
            reply = new JsonObject { ["ok"] = false, ["error"] = "Anfrage abgelaufen oder wiederholt (Uhrzeit der PCs prüfen)" };
        }
        else
        {
            Prune();
            try
            {
                reply = await Dispatch(msg, client);
                reply["ok"] = true;
            }
            catch (Exception e)
            {
                reply = new JsonObject { ["ok"] = false, ["error"] = e.Message };
            }
        }
        var outNonce = RandomNumberGenerator.GetBytes(12);
        var outPlain = Encoding.UTF8.GetBytes(reply.ToJsonString());
        var outData = new byte[outPlain.Length + 16];
        using (var aes = new AesGcm(key, 16))
            aes.Encrypt(outNonce, outPlain, outData.AsSpan(0, outPlain.Length), outData.AsSpan(outPlain.Length), Encoding.ASCII.GetBytes("nbh1-res|" + (rid ?? "")));
        return (200, new JsonObject { ["n"] = Convert.ToBase64String(outNonce), ["d"] = Convert.ToBase64String(outData) }.ToJsonString());
    }

    void Prune()
    {
        if (seen.Count < 5000) return;
        var limit = DateTime.UtcNow - Skew - Skew;
        foreach (var kv in seen) if (kv.Value < limit) seen.TryRemove(kv.Key, out _);
    }

    bool ModelMatches(JsonNode m) => m != null && (string)m["id"] == model.Id && (string)m["revision"] == model.Revision;

    async Task<JsonObject> Dispatch(JsonNode msg, string client)
    {
        switch ((string)msg["op"])
        {
            case "hello":
                Scheduler.Touch(client, (string)msg["label"]);
                return Info(msg["model"]);
            case "embed":
            {
                if (!ModelMatches(msg["model"])) throw new InvalidOperationException("anderes Modell als im Helper");
                if (!ModelStore.Ready(model)) throw new InvalidOperationException("Modell im Helper nicht bereit");
                var texts = msg["texts"]?.AsArray().Select(t => (string)t ?? "").Select(x => x.Length > MaxChars ? x[..MaxChars] : x).ToList();
                if (texts == null || texts.Count == 0 || texts.Count > MaxTexts) throw new InvalidOperationException("Anzahl der Texte");
                var vecs = await Scheduler.Embed(client, (string)msg["label"], texts, (string)msg["prio"] == "query");
                return new JsonObject { ["vectors"] = Engine.ToBase64(vecs, model.Dims) };
            }
            default:
                throw new InvalidOperationException("unbekannter Befehl");
        }
    }

    JsonObject Info(JsonNode clientModel)
    {
        var s = Settings.Load();
        return new JsonObject
        {
            ["version"] = Program.Version,
            ["api"] = 1,
            ["device"] = (string)s["device"] ?? "cpu",
            ["deviceName"] = (string)s["deviceName"] ?? Engine.DeviceName("cpu"),
            ["mailsPerSec"] = (double?)s["mailsPerSec"],
            ["modelReady"] = ModelStore.Ready(model),
            ["modelMatch"] = ModelMatches(clientModel),
            ["paused"] = Scheduler.Paused,
            ["queue"] = Scheduler.QueueLength,
            ["clients"] = Scheduler.Clients().Count,
        };
    }

    /// <summary>Adressen dieses PCs für die Anzeige (IPv4, ohne Loopback).</summary>
    public static List<string> LocalAddresses()
    {
        var list = new List<string>();
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up || ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback) continue;
            foreach (var a in ni.GetIPProperties().UnicastAddresses)
                if (a.Address.AddressFamily == AddressFamily.InterNetwork) list.Add(a.Address.ToString());
        }
        return list.Distinct().ToList();
    }
}

/// <summary>
/// Rechen-Warteschlange für alle PCs. Suchanfragen zuerst (immer auf der Grafikkarte), beim Indexieren kommen die PCs
/// abwechselnd dran. Indexpakete werden nach Länge sortiert und in Häppchen zu 16 Mails zerlegt; die Grafikkarte und – wenn
/// eingeschaltet – die CPU holen sich jeweils das nächste Häppchen, jede in ihrem Tempo. Die CPU rechnet nur mit, wenn sie
/// beim Messen dieselben Vektoren geliefert hat wie die Grafikkarte (cpuAgree). Wartungsarbeiten (Geräte messen) laufen
/// exklusiv: die CPU nimmt dann nichts Neues an.
/// </summary>
sealed class Scheduler
{
    const int PieceSize = 16;
    public const double MinAgreement = 0.995; // wie die Probe in NovaBird-Search (gemessen: etwa 0,9997)

    sealed class Job
    {
        public string Client;
        public bool Query;
        public List<string> Texts;
        public Action Work;
        public float[][] Result;
        public int Pending;
        public readonly TaskCompletionSource<float[][]> Done = new(TaskCreationOptions.RunContinuationsAsynchronously);
    }

    sealed class Piece
    {
        public Job Job;
        public int[] Index;
        public List<long[]> Ids;
        public bool Finished, Doubled;
    }

    public sealed class ClientInfo
    {
        public string Id, Label;
        public DateTime LastSeen;
        public long Today, Total;
        public DateTime Day;
    }

    readonly ModelSpec model;
    readonly object gate = new();
    readonly Queue<Job> queries = new(), work = new();
    readonly Dictionary<string, Queue<Job>> perClient = new();
    readonly List<string> order = new();
    readonly List<Piece> open = new();
    readonly Dictionary<string, ClientInfo> clients = new();
    readonly Queue<(DateTime At, int Count, bool Cpu)> recent = new();
    int next;
    bool cpuBusy;
    Piece cpuPiece; // Häppchen, das die CPU gerade rechnet
    volatile bool stop;

    public bool Paused { get; set; }
    public string Busy { get; private set; } // Kennung des PCs, dessen Paket gerade gerechnet wird

    public Scheduler(ModelSpec model) => this.model = model;

    // ---- CPU mitrechnen (Einstellungen netCpu, netCpuThreads) --------------------------------------------------------------
    public static int AutoThreads => Math.Max(1, Environment.ProcessorCount / 2 - 1);

    public bool CpuEnabled
    {
        get => (bool?)Settings.Load()["netCpu"] ?? false;
        set { var s = Settings.Load(); s["netCpu"] = value; Settings.Save(s); lock (gate) Monitor.PulseAll(gate); }
    }

    /// <summary>Threads der CPU beim Mitrechnen; 0 = automatisch (halbe logische Kernzahl minus 1).</summary>
    public int CpuThreadsSetting
    {
        get => (int?)Settings.Load()["netCpuThreads"] ?? 0;
        set { var s = Settings.Load(); s["netCpuThreads"] = Math.Max(0, Math.Min(Environment.ProcessorCount, value)); Settings.Save(s); }
    }

    public int CpuThreads => CpuThreadsSetting > 0 ? CpuThreadsSetting : AutoThreads;

    /// <summary>Warum die CPU nicht mitrechnen kann (null = sie kann).</summary>
    public static string CpuBlocked()
    {
        var s = Settings.Load();
        if (!((string)s["device"] ?? "cpu").StartsWith("dml:")) return "rechnet schon nur auf der CPU";
        if (s["cpuAgree"] == null) return "erst „Geräte neu messen“";
        if ((double)s["cpuAgree"] < MinAgreement) return $"CPU rechnet abweichend ({(double)s["cpuAgree"]:0.0000})";
        return null;
    }

    bool CpuActive => CpuEnabled && CpuBlocked() == null;

    // ---- Start/Stopp -----------------------------------------------------------------------------------------------------
    public void Start()
    {
        new Thread(() => Loop(false)) { IsBackground = true, Name = "NovaBird-GPU" }.Start();
        new Thread(() => Loop(true)) { IsBackground = true, Name = "NovaBird-CPU", Priority = ThreadPriority.BelowNormal }.Start();
    }

    public void Stop()
    {
        stop = true;
        lock (gate) Monitor.PulseAll(gate);
    }

    public int QueueLength
    {
        get { lock (gate) return queries.Count + perClient.Values.Sum(q => q.Count) + open.Select(p => p.Job).Distinct().Count(); }
    }

    public void Touch(string id, string label)
    {
        lock (gate)
        {
            if (!clients.TryGetValue(id, out var c)) clients[id] = c = new ClientInfo { Id = id };
            if (!string.IsNullOrWhiteSpace(label)) c.Label = label.Length > 40 ? label[..40] : label;
            c.LastSeen = DateTime.Now;
        }
    }

    public List<ClientInfo> Clients()
    {
        lock (gate) return clients.Values.Where(c => DateTime.Now - c.LastSeen < TimeSpan.FromDays(1)).OrderByDescending(c => c.LastSeen).ToList();
    }

    public void ForgetClients()
    {
        lock (gate) clients.Clear();
    }

    /// <summary>Mails pro Sekunde in der letzten Minute: gesamt, davon Grafikkarte und CPU.</summary>
    public (double All, double Gpu, double Cpu) Rates
    {
        get
        {
            lock (gate)
            {
                var limit = DateTime.UtcNow.AddSeconds(-60);
                while (recent.Count > 0 && recent.Peek().At < limit) recent.Dequeue();
                if (recent.Count == 0) return (0, 0, 0);
                var span = Math.Max(1, (DateTime.UtcNow - recent.Peek().At).TotalSeconds);
                double gpu = recent.Where(r => !r.Cpu).Sum(r => r.Count) / span, cpu = recent.Where(r => r.Cpu).Sum(r => r.Count) / span;
                return (Math.Round(gpu + cpu, 1), Math.Round(gpu, 1), Math.Round(cpu, 1));
            }
        }
    }

    public double Rate => Rates.All;

    public Task<float[][]> Embed(string client, string label, List<string> texts, bool query)
    {
        Touch(client, label);
        var job = new Job { Client = client, Texts = texts, Query = query };
        lock (gate)
        {
            if (query) queries.Enqueue(job);
            else
            {
                if (!perClient.TryGetValue(client, out var q)) { perClient[client] = q = new Queue<Job>(); order.Add(client); }
                q.Enqueue(job);
            }
            Monitor.PulseAll(gate);
        }
        return job.Done.Task.WaitAsync(TimeSpan.FromMinutes(10));
    }

    /// <summary>Arbeit, die exklusiv auf dem Modell laufen muss (z. B. Geräte messen).</summary>
    public Task Run(Action action)
    {
        var job = new Job { Work = action };
        lock (gate)
        {
            work.Enqueue(job);
            Monitor.PulseAll(gate);
        }
        return job.Done.Task;
    }

    // Nächstes Indexpaket (PCs abwechselnd): zerlegen, nach Länge sortieren, in Häppchen teilen
    void Refill()
    {
        if (Paused || order.Count == 0) return;
        for (int i = 0; i < order.Count; i++)
        {
            var id = order[(next + i) % order.Count];
            if (perClient[id].Count == 0) continue;
            next = (next + i + 1) % order.Count; // nächstes Mal der nächste PC
            var job = perClient[id].Dequeue();
            var ids = Engine.Encode(model, job.Texts);
            var sorted = Enumerable.Range(0, ids.Count).OrderBy(k => ids[k].Length).ToArray();
            job.Result = new float[ids.Count][];
            for (int p = 0; p < sorted.Length; p += PieceSize)
            {
                var idx = sorted.Skip(p).Take(PieceSize).ToArray();
                open.Add(new Piece { Job = job, Index = idx, Ids = idx.Select(k => ids[k]).ToList() });
                job.Pending++;
            }
            Busy = job.Client;
            return;
        }
    }

    // Grafikkarte: Wartung, Suchanfragen, Häppchen. CPU: nur Häppchen, und nur wenn eingeschaltet und keine Wartung ansteht.
    (Job Whole, Piece Piece) Take(bool cpu)
    {
        lock (gate)
        {
            while (!stop)
            {
                if (!cpu)
                {
                    if (work.Count > 0 && !cpuBusy) return (work.Dequeue(), null);
                    if (work.Count == 0 && queries.Count > 0) return (queries.Dequeue(), null);
                }
                if (work.Count == 0 && (!cpu || CpuActive))
                {
                    if (open.Count == 0) Refill();
                    if (open.Count > 0)
                    {
                        var piece = open[0];
                        open.RemoveAt(0);
                        if (cpu) { cpuBusy = true; cpuPiece = piece; }
                        return (null, piece);
                    }
                    // Grafikkarte ohne Arbeit, CPU noch an einem Häppchen: selbst noch einmal rechnen, wer zuerst fertig ist, gilt
                    // (sonst wartet das ganze Paket auf die langsamere CPU)
                    if (!cpu && cpuPiece is { Finished: false, Doubled: false })
                    {
                        cpuPiece.Doubled = true;
                        return (null, cpuPiece);
                    }
                }
                Monitor.Wait(gate, cpu ? 2000 : 1000);
            }
            return (null, null);
        }
    }

    void Count(Job job, int n, bool cpu)
    {
        recent.Enqueue((DateTime.UtcNow, n, cpu));
        if (clients.TryGetValue(job.Client ?? "", out var c))
        {
            if (c.Day != DateTime.Today) { c.Day = DateTime.Today; c.Today = 0; }
            c.Today += n;
            c.Total += n;
        }
    }

    void Loop(bool cpu)
    {
        while (!stop)
        {
            var (whole, piece) = Take(cpu);
            if (whole == null && piece == null) return;
            if (whole != null)
            {
                try
                {
                    if (whole.Work != null) whole.Work();
                    else
                    {
                        var vecs = Engine.EmbedTexts(model, whole.Texts, Device);
                        lock (gate) Count(whole, whole.Texts.Count, false);
                        whole.Done.TrySetResult(vecs);
                        continue;
                    }
                    whole.Done.TrySetResult(null);
                }
                catch (Exception e)
                {
                    Log.Write("Rechnen: " + e.Message);
                    whole.Done.TrySetException(e);
                }
                continue;
            }
            float[][] result;
            try
            {
                result = cpu ? Engine.EmbedOnCpu(model, piece.Ids, CpuThreads) : Engine.Embed(model, piece.Ids, Device);
            }
            catch (Exception e)
            {
                lock (gate)
                {
                    if (cpu)
                    {
                        // CPU-Fehler: Häppchen zurück an die Grafikkarte, CPU aus
                        Log.Write("CPU-Mitrechnen abgeschaltet: " + e.Message);
                        if (!piece.Finished && !piece.Doubled) open.Insert(0, piece);
                        cpuBusy = false;
                        cpuPiece = null;
                        var s = Settings.Load();
                        s["netCpu"] = false;
                        Settings.Save(s);
                        Monitor.PulseAll(gate);
                        continue;
                    }
                }
                Log.Write("Rechnen: " + e.Message);
                piece.Job.Done.TrySetException(e);
                continue;
            }
            lock (gate)
            {
                if (cpu)
                {
                    cpuBusy = false;
                    cpuPiece = null;
                }
                if (!piece.Finished) // doppelt gerechnet: nur das erste Ergebnis zählt
                {
                    piece.Finished = true;
                    for (int j = 0; j < piece.Index.Length; j++) piece.Job.Result[piece.Index[j]] = result[j];
                    Count(piece.Job, piece.Index.Length, cpu);
                    if (--piece.Job.Pending == 0) piece.Job.Done.TrySetResult(piece.Job.Result);
                }
                Monitor.PulseAll(gate);
            }
            if (cpu && !CpuActive) Engine.UnloadCpu(); // ausgeschaltet: Arbeitsspeicher freigeben
        }
    }

    static string Device => (string)Settings.Load()["device"] ?? "cpu";
}
