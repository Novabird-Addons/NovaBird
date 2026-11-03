// Netz-Modus: Der Helper rechnet auf diesem PC (Grafikkarte) für mehrere PCs im Netz. Thunderbird schickt Texte, der Helper
// antwortet mit Vektoren.
//  - HTTP über einen eigenen kleinen TCP-Server (braucht keine Adminrechte und keine URL-Reservierung). Port 47531.
//  - Kopplung: Code aus 20 Zeichen (PairCode); Schlüssel = PBKDF2-SHA256(Code, "NovaBird-Net-1", 300.000 Runden).
//    Mehrere Gruppen mit je eigenem Code (Groups.cs): Der Helper probiert die Schlüssel der Gruppen durch (zuerst die zuletzt
//    passende des PCs); jede Gruppe hat ihren eigenen Vektorspeicher.
//  - Jede Anfrage und jede Antwort ist mit AES-256-GCM verschlüsselt: Mailtexte und Vektoren gehen nie lesbar durchs Netz.
//    Anfrage  POST /nbhelper/v1 {c: Client-Kennung, n: Nonce, d: Chiffrat+Tag}, AAD "nbh1-req|<c>"
//             Inhalt {ts, rid, op, …}: Zeitstempel (±10 min) und eine zufällige Anfrage-Kennung (nur einmal gültig)
//    Antwort  {n, d}, AAD "nbh1-res|<rid>" (gehört genau zu dieser Anfrage)
//    Wer den Code nicht kennt, bekommt 403; nach 20 Fehlversuchen in einer Minute wird die Adresse eine Minute gesperrt.
//  - op "hello" {label, model:{id, revision}} -> Info (mit Gruppe und web: Port, im Netz, SHA-256 des HTTPS-Zertifikats – so
//    kann Thunderbird den Team-Kalender ohne Zertifikatsdialog einbinden: der Fingerabdruck kommt über den gekoppelten Weg); op "embed" {model, texts, prio:"query"|"index"} -> {vectors}
//  - op "vlookup" {model, items:[{id, h}]} -> {found:[Index], vectors}: schon gerechnete Vektoren anderer PCs (VectorStore.cs);
//    op "embed" mit keys:[{id, h}] (je Text) merkt die Vektoren dafür
//  - op "chat" {messages, maxNew, meta?} -> {id} (meta: Zielsprache und Markierungen für eine eigene Anweisung, Chat.cs); op "chatPoll" {id} -> {text (neu seit dem letzten Abholen), done, stats};
//    op "chatCancel" {id}: KI-Zusammenfassung mit dem im Helper gewählten Sprachmodell (Chat.cs)
//  - op "aiget" {ids, claim} -> {items: {id: {data}|{pending}|{claimed}|{}}}, "aiput" {id, data}, "airelease" {id}: KI-Ergebnisse
//    (vorbereitete Mails) zwischen PCs derselben Gruppe teilen, verschlüsselt von Thunderbird (AiCache.cs)
//  - op "tts" {text, lang:"german"|"english"|"french"|…, voice?} -> {wav: Base64, ms}: einen Satz vorlesen (Speech.cs); abgespielt wird
//    auf dem PC mit Thunderbird
//  - Kopplung ohne Code-Abtippen: POST /nbhelper/pair und Suche per Multicast, nur im Kopplungsmodus (Pairing.cs).
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
    const int MaxHeader = 16 << 10, MaxBody = 8 << 20, MaxTexts = 64, MaxChars = 20_000, MaxLookup = 1000;
    static readonly TimeSpan Skew = TimeSpan.FromMinutes(10);
    static readonly Regex ClientId = new("^[A-Za-z0-9_-]{8,64}$");

    readonly TcpListener listener;
    readonly ModelSpec model;
    public readonly Scheduler Scheduler;
    public readonly Chat Chat = new();
    public Speech Speech; // vom Kern gesetzt
    readonly object storesGate = new();
    Dictionary<string, (byte[] Key, VectorStore Vectors)> groups = new(); // Gruppen-Kennung -> Schlüssel, Vektorspeicher
    readonly Dictionary<string, string> codes = new(); // Gruppe -> Code, aus dem der Schlüssel stammt
    readonly ConcurrentDictionary<string, string> clientGroup = new(); // PC -> zuletzt passende Gruppe
    readonly ConcurrentDictionary<string, AiCache> aiCaches = new(); // Gruppe -> geteilte KI-Ergebnisse
    /// <summary>Web-Oberfläche (Port, im Netz?, Fingerabdruck des Zertifikats) für „hello“: Team-Kalender mit einem Klick einbinden.</summary>
    public Func<JsonObject> WebInfo;
    readonly ConcurrentDictionary<string, DateTime> seen = new(); // rid -> Zeit (gegen Wiederholung)
    readonly ConcurrentDictionary<string, (int Count, DateTime Since)> failures = new();
    public int Port { get; }
    public bool LoopbackOnly { get; }
    /// <summary>Kopplungsmodus: PCs holen sich den Gruppencode per Schlüsseltausch und Vergleichszahl (Pairing.cs).</summary>
    public readonly Pairing Pairing;

    public NetServer(ModelSpec model, int port, bool loopbackOnly)
    {
        this.model = model;
        Port = port;
        LoopbackOnly = loopbackOnly;
        Scheduler = new Scheduler(model);
        VectorStore.RemoveOldFormat();
        LoadGroups();
        Pairing = new Pairing(this);
        listener = new TcpListener(loopbackOnly ? IPAddress.Loopback : IPAddress.Any, port);
    }

    // ---- Gruppen und Kopplungscodes (Groups.cs) --------------------------------------------------------------------------------
    /// <summary>Code der ersten Gruppe (Symbol im Infobereich, Testkonsole).</summary>
    public static string Code() => Groups.List()[0].Code;

    /// <summary>Schlüssel und Vektorspeicher an die Gruppen anpassen (nach Anlegen, neuem Code, Löschen, Wiederherstellen).</summary>
    public void LoadGroups()
    {
        lock (storesGate)
        {
            var old = groups;
            var next = new Dictionary<string, (byte[], VectorStore)>();
            foreach (var g in Groups.List())
            {
                old.TryGetValue(g.Id, out var o);
                // Schlüssel nur neu ableiten, wenn sich der Code geändert hat (PBKDF2 dauert)
                var key = o.Key != null && codes.GetValueOrDefault(g.Id) == g.Code ? o.Key : DeriveKey(g.Code);
                codes[g.Id] = g.Code;
                var store = o.Vectors ?? new VectorStore(model, g.Id, g.Salt);
                next[g.Id] = (key, store);
            }
            foreach (var (id, o) in old)
                if (!next.ContainsKey(id)) { o.Vectors.Dispose(); codes.Remove(id); }
            groups = next;
        }
    }

    public VectorStore Vectors(string groupId)
    {
        lock (storesGate) return groupId != null && groups.TryGetValue(groupId, out var g) ? g.Vectors : null;
    }

    AiCache Ai(string groupId) => groupId == null ? null : aiCaches.GetOrAdd(groupId, id => new AiCache(id));

    public int AiCount => aiCaches.Values.Sum(a => a.Count);

    public List<VectorStore> AllVectors()
    {
        lock (storesGate) return groups.Values.Select(g => g.Vectors).ToList();
    }

    /// <summary>Neuer Code für eine Gruppe (ohne Angabe: die erste): deren PCs müssen den neuen eintragen.</summary>
    public string Renew(string groupId = null)
    {
        groupId ??= Groups.List()[0].Id;
        var code = Groups.Renew(groupId);
        LoadGroups();
        Forget(groupId);
        return code;
    }

    /// <summary>Gruppe löschen: PCs vergessen, Vektoren löschen.</summary>
    public void RemoveGroup(string groupId)
    {
        Groups.Remove(groupId);
        LoadGroups();
        Forget(groupId);
        if (aiCaches.TryRemove(groupId, out var ai)) ai.Drop();
        try { if (Directory.Exists(VectorStore.FolderOf(groupId))) Directory.Delete(VectorStore.FolderOf(groupId), true); }
        catch (Exception e) { Log.Write("Vektoren der Gruppe: " + e.Message); }
    }

    void Forget(string groupId)
    {
        Scheduler.ForgetClients(groupId);
        foreach (var kv in clientGroup) if (kv.Value == groupId) clientGroup.TryRemove(kv.Key, out _);
    }

    /// <summary>Für die Sicherung: Vektordateien schließen, Aktion ausführen, Gruppen und Speicher neu laden.</summary>
    public void WithVectorsClosed(Action a)
    {
        lock (storesGate)
        {
            foreach (var g in groups.Values) g.Vectors.Dispose();
            foreach (var ai in aiCaches.Values) ai.Dispose();
            aiCaches.Clear();
            groups = new();
            codes.Clear();
            clientGroup.Clear();
            try { a(); }
            finally { LoadGroups(); }
        }
    }

    static byte[] DeriveKey(string code) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(PairCode.Normalize(code)), Encoding.ASCII.GetBytes("NovaBird-Net-1"), Iterations, HashAlgorithmName.SHA256, 32);

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
        Pairing.Stop();
        Scheduler.Stop();
        lock (storesGate) foreach (var g in groups.Values) g.Vectors.Dispose();
        foreach (var ai in aiCaches.Values) ai.Dispose();
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
                // Anfrage muss in 30 s vollständig da sein (asynchrones Lesen kennt ReceiveTimeout nicht – Slowloris)
                using var readLimit = new CancellationTokenSource(TimeSpan.FromSeconds(30));
                using var closeOnLimit = readLimit.Token.Register(() => { try { tcp.Close(); } catch { /* schon zu */ } });
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
                closeOnLimit.Dispose();
                if (Blocked(ip)) { await Send(stream, 429, "{\"error\":\"blocked\"}"); return; }
                if (method == "OPTIONS") { await Send(stream, 204, ""); return; }
                if (path == Pairing.Path && method == "POST")
                {
                    var (st, js, fail) = Pairing.Handle(body, ip);
                    if (fail) Fail(ip);
                    await Send(stream, st, js);
                    return;
                }
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
        string client, group = null;
        byte[] plain, key = null;
        try
        {
            env = JsonNode.Parse(body);
            client = (string)env["c"];
            if (client == null || !ClientId.IsMatch(client)) throw new FormatException();
            var nonce = Convert.FromBase64String((string)env["n"]);
            var data = Convert.FromBase64String((string)env["d"]);
            if (nonce.Length != 12 || data.Length < 16) throw new FormatException();
            plain = new byte[data.Length - 16];
            var aad = Encoding.ASCII.GetBytes("nbh1-req|" + client);
            // Schlüssel der Gruppen durchprobieren, zuerst die zuletzt passende dieses PCs
            List<(string Id, byte[] Key)> keys;
            lock (storesGate) keys = groups.Select(g => (g.Key, g.Value.Key)).ToList();
            if (clientGroup.TryGetValue(client, out var last)) keys = keys.OrderBy(k => k.Id != last).ToList();
            foreach (var (id, k) in keys)
            {
                try
                {
                    using var aes = new AesGcm(k, 16);
                    aes.Decrypt(nonce, data.AsSpan(0, plain.Length), data.AsSpan(plain.Length), plain, aad);
                    (group, key) = (id, k);
                    break;
                }
                catch (AuthenticationTagMismatchException) { /* nächste Gruppe */ }
            }
            if (group == null) throw new CryptographicException();
            clientGroup[client] = group;
        }
        catch
        {
            Fail(ip);
            await Task.Delay(200);
            return (403, "{\"error\":\"auth\"}"); // falscher Code oder verfälschte Anfrage
        }
        var msg = Json.Parse(plain);
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
                reply = await Dispatch(msg, client, group);
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

    async Task<JsonObject> Dispatch(JsonNode msg, string client, string group)
    {
        switch ((string)msg["op"])
        {
            case "hello":
            {
                Scheduler.Touch(client, (string)msg["label"], msg["stats"], group);
                var info = Info(msg["model"], group);
                info["chatChoices"] = new JsonArray((await Chat.Choices()).Select(m => (JsonNode)m).ToArray());
                return info;
            }
            case "embed":
            {
                if (!ModelMatches(msg["model"])) throw new InvalidOperationException("anderes Modell als im Helper");
                if (!ModelStore.Ready(model)) throw new InvalidOperationException("Modell im Helper nicht bereit");
                var texts = msg["texts"]?.AsArray().Select(t => (string)t ?? "").Select(x => x.Length > MaxChars ? x[..MaxChars] : x).ToList();
                if (texts == null || texts.Count == 0 || texts.Count > MaxTexts) throw new InvalidOperationException("Anzahl der Texte");
                Scheduler.Touch(client, (string)msg["label"], msg["stats"], group);
                var vecs = await Scheduler.Embed(client, (string)msg["label"], msg["stats"], texts, (string)msg["prio"] == "query");
                Vectors(group)?.Put(msg["keys"] as JsonArray, vecs); // für andere PCs merken (Message-ID + Prüfsumme je Text)
                return new JsonObject { ["vectors"] = Engine.ToBase64(vecs, model.Dims) };
            }
            // Vektoren teilen: schon gerechnete Vektoren zu {id: Message-ID, h: Prüfsumme des Textes}
            case "vlookup":
            {
                if (!ModelMatches(msg["model"])) throw new InvalidOperationException("anderes Modell als im Helper");
                var items = msg["items"]?.AsArray().Select(i => ((string)i?["id"] ?? "", (string)i?["h"] ?? "")).ToList();
                if (items == null || items.Count > MaxLookup) throw new InvalidOperationException("Anzahl der Einträge");
                Scheduler.Touch(client, (string)msg["label"], msg["stats"], group);
                var (found, vecs) = Vectors(group)?.Lookup(items) ?? (new List<int>(), Array.Empty<float[]>());
                return new JsonObject
                {
                    ["found"] = new JsonArray(found.Select(i => (JsonNode)i).ToArray()),
                    ["vectors"] = vecs.Length > 0 ? Engine.ToBase64(vecs, model.Dims) : "",
                };
            }
            // Sprachmodell (KI-Zusammenfassung): starten, dann Stücke abholen, bis done
            // model (optional): anderes Sprachmodell als im Helper gewählt, nur aus der Liste chatChoices
            case "chat":
            {
                Scheduler.Touch(client, (string)msg["label"], null, group);
                var want = (string)msg["model"];
                if (string.IsNullOrEmpty(want)) want = null;
                else if (!(await Chat.Choices()).Contains(want)) throw new InvalidOperationException(L.T("Dieses Sprachmodell gibt es im Helper nicht", "This language model is not available in the helper"));
                return new JsonObject { ["id"] = Chat.Start(client, msg["messages"] as JsonArray, (int?)msg["maxNew"] ?? Chat.MaxNewDefault, msg["meta"], want) };
            }
            case "chatPoll":
                return await Chat.Poll(client, (string)msg["id"]);
            case "chatCancel":
                Chat.Cancel(client, (string)msg["id"]);
                return new JsonObject();
            // KI-Ergebnisse teilen: nachsehen (und mit claim anmelden, wer rechnet), ablegen, Anmeldung zurückgeben
            case "aiget":
            {
                var ids = msg["ids"]?.AsArray().Select(i => (string)i).ToList();
                if (ids == null || ids.Count > AiCache.MaxIds) throw new InvalidOperationException("Anzahl der Einträge");
                Scheduler.Touch(client, (string)msg["label"], null, group);
                return new JsonObject { ["items"] = Ai(group).Get(ids, client, (bool?)msg["claim"] == true) };
            }
            case "aiput":
                Ai(group).Put((string)msg["id"], (string)msg["data"]);
                return new JsonObject();
            case "airelease":
                Ai(group).Release((string)msg["id"], client);
                return new JsonObject();
            // Vorlesen: ein Satz je Anfrage, Thunderbird holt den nächsten, während der vorige läuft
            case "tts":
            {
                if (Speech == null) throw new InvalidOperationException("Vorlesen nicht verfügbar");
                Scheduler.Touch(client, (string)msg["label"], null, group);
                var (wav, ms) = await Speech.Say((string)msg["text"], (string)msg["lang"], (string)msg["voice"]);
                return new JsonObject { ["wav"] = Convert.ToBase64String(wav), ["ms"] = Math.Round(ms) };
            }
            default:
                throw new InvalidOperationException("unbekannter Befehl");
        }
    }

    JsonObject Info(JsonNode clientModel, string group)
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
            ["group"] = Groups.Get(group)?.Name,
            ["web"] = WebInfo?.Invoke(),
            ["vecShare"] = VectorStore.Enabled,
            ["chatModel"] = Chat.Selected,
            ["chatModels"] = new JsonArray(Chat.Available().Select(m => (JsonNode)m.Name).ToArray()),
            ["speech"] = Speech?.Info(),
            ["aiCache"] = true, // Thunderbird teilt vorbereitete KI-Ergebnisse (aiget/aiput)
        };
    }

    /// <summary>
    /// Adressen dieses PCs für die Anzeige (IPv4, ohne Loopback): echte Netzwerkkarten zuerst, virtuelle Adapter (Hyper-V, WSL,
    /// VMware, VPN …) danach – sie bleiben sichtbar, weil z. B. ein VPN auch der Weg zu den anderen PCs sein kann.
    /// </summary>
    public static List<string> LocalAddresses()
    {
        var list = new List<(string Ip, bool Virtual)>();
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up || ni.NetworkInterfaceType == System.Net.NetworkInformation.NetworkInterfaceType.Loopback) continue;
            bool real = ni.NetworkInterfaceType is System.Net.NetworkInformation.NetworkInterfaceType.Ethernet or System.Net.NetworkInformation.NetworkInterfaceType.Wireless80211
                        && !Regex.IsMatch(ni.Name + " " + ni.Description, "virtual|hyper-v|vethernet|vmware|virtualbox|wsl|tap-|wireguard|tailscale|zerotier", RegexOptions.IgnoreCase);
            foreach (var a in ni.GetIPProperties().UnicastAddresses)
                if (a.Address.AddressFamily == AddressFamily.InterNetwork) list.Add((a.Address.ToString(), !real));
        }
        return list.OrderBy(x => x.Virtual).Select(x => x.Ip).Distinct().ToList();
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
        public string Id, Label, Group;
        public DateTime FirstSeen, LastSeen;
        public long Today, Total; // vom Helper gerechnet
        public DateTime Day;
        public long? Indexed, Mails; // Stand auf dem PC (meldet NovaBird-Search): Mails mit Vektor / Mails insgesamt
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

    public Scheduler(ModelSpec model)
    {
        this.model = model;
        LoadClients();
        saver = new System.Threading.Timer(_ => SaveClients(), null, 30_000, 30_000);
    }

    // ---- PCs dauerhaft merken (clients.json im Datenordner) ----------------------------------------------------------------
    static string ClientsPath => Path.Combine(Settings.Dir, "clients.json");
    readonly System.Threading.Timer saver;
    bool dirty;

    void LoadClients()
    {
        try
        {
            if (!File.Exists(ClientsPath)) return;
            foreach (var n in JsonNode.Parse(File.ReadAllText(ClientsPath)).AsArray())
            {
                var c = new ClientInfo
                {
                    Id = (string)n["id"], Label = (string)n["label"], Group = (string)n["group"], Total = (long?)n["computed"] ?? 0, Today = (long?)n["today"] ?? 0,
                    Indexed = (long?)n["indexed"], Mails = (long?)n["mails"],
                    FirstSeen = DateTime.TryParse((string)n["firstSeen"], out var f) ? f : DateTime.Now,
                    LastSeen = DateTime.TryParse((string)n["lastSeen"], out var l) ? l : DateTime.Now,
                    Day = DateTime.TryParse((string)n["day"], out var d) ? d : DateTime.Today,
                };
                if (!string.IsNullOrEmpty(c.Id)) clients[c.Id] = c;
            }
        }
        catch (Exception e) { Log.Write("clients.json unlesbar: " + e.Message); }
    }

    public void SaveClients()
    {
        JsonArray arr;
        lock (gate)
        {
            if (!dirty) return;
            dirty = false;
            arr = new JsonArray(clients.Values.Select(c => (JsonNode)new JsonObject
            {
                ["id"] = c.Id, ["label"] = c.Label, ["group"] = c.Group, ["computed"] = c.Total, ["today"] = c.Today, ["day"] = c.Day.ToString("yyyy-MM-dd"),
                ["indexed"] = c.Indexed, ["mails"] = c.Mails, ["firstSeen"] = c.FirstSeen.ToString("o"), ["lastSeen"] = c.LastSeen.ToString("o"),
            }).ToArray());
        }
        try
        {
            Directory.CreateDirectory(Settings.Dir);
            File.WriteAllText(ClientsPath + ".tmp", arr.ToJsonString());
            File.Move(ClientsPath + ".tmp", ClientsPath, true);
        }
        catch (Exception e) { Log.Write("clients.json: " + e.Message); }
    }

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
        if (!((string)s["device"] ?? "cpu").StartsWith("dml:")) return L.T("rechnet schon nur auf der CPU", "already computing on the CPU only");
        if (s["cpuAgree"] == null) return L.T("erst „Geräte neu messen“", "first \"Measure devices again\"");
        if ((double)s["cpuAgree"] < MinAgreement) return L.T($"CPU rechnet abweichend ({(double)s["cpuAgree"]:0.0000})", $"CPU computes differently ({(double)s["cpuAgree"]:0.0000})");
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
        saver.Dispose();
        SaveClients();
    }

    public int QueueLength
    {
        get { lock (gate) return queries.Count + perClient.Values.Sum(q => q.Count) + open.Select(p => p.Job).Distinct().Count(); }
    }

    /// <summary>PC meldet sich: Name und Indexstand ({done, total} von NovaBird-Search) merken.</summary>
    public void Touch(string id, string label, JsonNode stats = null, string group = null)
    {
        lock (gate)
        {
            if (!clients.TryGetValue(id, out var c)) clients[id] = c = new ClientInfo { Id = id, FirstSeen = DateTime.Now, Day = DateTime.Today };
            if (group != null) c.Group = group;
            if (!string.IsNullOrWhiteSpace(label)) c.Label = label.Length > 40 ? label[..40] : label;
            c.LastSeen = DateTime.Now;
            if (stats is JsonObject)
            {
                try
                {
                    var done = (long?)stats["done"];
                    var total = (long?)stats["total"];
                    if (done is >= 0) c.Indexed = done;
                    if (total is >= 0) c.Mails = total;
                }
                catch { /* unvollständige Angaben ignorieren */ }
            }
            dirty = true;
        }
    }

    /// <summary>Alle bekannten PCs, zuletzt gesehene zuerst (Kopien, für die Anzeige).</summary>
    public List<ClientInfo> Clients()
    {
        lock (gate)
        {
            foreach (var c in clients.Values)
                if (c.Day != DateTime.Today) { c.Day = DateTime.Today; c.Today = 0; }
            return clients.Values.OrderByDescending(c => c.LastSeen).Select(c => new ClientInfo
            {
                Id = c.Id, Label = c.Label, Group = c.Group, FirstSeen = c.FirstSeen, LastSeen = c.LastSeen, Today = c.Today, Total = c.Total, Day = c.Day, Indexed = c.Indexed, Mails = c.Mails,
            }).ToList();
        }
    }

    public void Forget(string id)
    {
        lock (gate)
        {
            clients.Remove(id);
            dirty = true;
        }
        SaveClients();
    }

    /// <summary>PCs einer Gruppe vergessen (neuer Code, Gruppe gelöscht); ohne Angabe alle. PCs von vor den Gruppen zählen zu g1.</summary>
    public void ForgetClients(string group = null)
    {
        lock (gate)
        {
            foreach (var id in clients.Values.Where(c => group == null || (c.Group ?? "g1") == group).Select(c => c.Id).ToList()) clients.Remove(id);
            dirty = true;
        }
        SaveClients();
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

    public Task<float[][]> Embed(string client, string label, JsonNode stats, List<string> texts, bool query)
    {
        Touch(client, label, stats);
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
            dirty = true;
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
