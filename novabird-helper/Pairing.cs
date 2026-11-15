// Kopplungsmodus: Ein PC holt sich den Code einer Gruppe, ohne die 20 Zeichen abzutippen.
//  - Ein Admin startet ihn in der Web-Oberfläche (PCs → „Gerät über Kopplung hinzufügen“) für eine Gruppe; er läuft 5 Minuten.
//  - Finden: Thunderbird schickt "NBHELPER?1" an die Multicast-Gruppe 239.255.77.31, UDP-Port 47531; nur im Kopplungsmodus
//    antwortet der Helper (an den Absender) mit {service, name, port, version, local}. Sonst bleibt er stumm.
//  - POST /nbhelper/pair (unverschlüsselt, der Schutz kommt aus dem Schlüsseltausch), Verfahren 2 (ab Helper 0.5.2):
//      {op:"start", v:2, commit, label} -> {req, pub, name, v:2}: der PC legt sich zuerst fest (commit = SHA-256 seines
//        öffentlichen Schlüssels, Base64), erst dann schickt der Helper seinen (ECDH P-256, roh 65 Byte 04||X||Y, Base64).
//      {op:"reveal", req, pub} -> {state:"pending"}: der PC zeigt seinen Schlüssel; passt er nicht zum commit, ist die Anfrage weg.
//        Beide Seiten zeigen dieselbe 6-stellige Zahl: HKDF-SHA256(Geheimnis, info "nbh-pair-sas|<Helper-pub>|<PC-pub>"),
//        erste 4 Byte (big endian) mod 1.000.000. Wegen der Festlegung kann ein Dritter in der Mitte die Zahl nicht passend
//        ausrechnen, nur mit neuen Starts auf Glück hoffen (begrenzt, siehe unten); der Admin vergleicht sie vor „Zulassen“, am PC bestätigt man „Zahl stimmt“.
//      {op:"poll", req} -> {state:"pending"|"denied"|"expired"} oder {state:"ok", n, d}: d = AES-256-GCM mit dem Schlüssel
//        HKDF(Geheimnis, info "nbh-pair-key|<Helper-pub>|<PC-pub>"), AAD "nbh-pair|<req>", Inhalt {code, group}.
//      Das alte Verfahren 1 ({op:"start", pub}, ohne Festlegung) lehnt der Helper ab: {error:"update"}.
//  - Höchstens 8 offene Anfragen, je Adresse höchstens eine Festlegung ohne „reveal“; Festlegungen ohne Abschluss (verfallen nach
//    1 Minute, ersetzt, falscher Schlüssel) höchstens 3 je Adresse in 10 Minuten, danach 429; die übrigen Anfragen gelten 10 Minuten;
//    unbekannte Kennungen und kaputte Anfragen zählen als Fehlversuch (Sperre wie bei 403). Keine CORS-Freigabe.
using System.Collections.Concurrent;
using System.Net;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class Pairing
{
    public const string Path = "/nbhelper/pair";
    public static readonly IPAddress Group = IPAddress.Parse("239.255.77.31");
    public static int DiscoveryPort => int.TryParse(Environment.GetEnvironmentVariable("NOVABIRD_DISCOVERY_PORT"), out var p) ? p : 47531;
    static readonly TimeSpan Window = TimeSpan.FromMinutes(5), RequestLife = TimeSpan.FromMinutes(10), CommitLife = TimeSpan.FromMinutes(1);
    const int MaxPending = 8;
    // Festlegungen ohne „reveal“ (verworfen, verfallen, falscher Schlüssel) je Adresse: ein Dritter in der Mitte müsste für jede neue
    // Vergleichszahl am Helper neu starten. Höchstens 3 in 10 Minuten, danach nimmt der Helper von dieser Adresse keinen Start an.
    const int MaxAbandoned = 3;
    static readonly TimeSpan AbandonWindow = TimeSpan.FromMinutes(10);
    readonly ConcurrentDictionary<string, (int Count, DateTime Since)> abandoned = new();

    void Abandon(string ip, string why)
    {
        var n = abandoned.AddOrUpdate(ip, _ => (1, DateTime.UtcNow), (_, a) => DateTime.UtcNow - a.Since > AbandonWindow ? (1, DateTime.UtcNow) : (a.Count + 1, a.Since));
        if (n.Count <= MaxAbandoned + 1) Log.Write($"Kopplung: Anfrage von {ip} ohne Abschluss ({why})");
    }

    bool TooManyAbandoned(string ip) =>
        abandoned.TryGetValue(ip, out var a) && a.Count >= MaxAbandoned && DateTime.UtcNow - a.Since <= AbandonWindow;

    public sealed class Request
    {
        public string Id, Label, Ip, Sas, GroupId, State = "committed"; // committed (vor reveal) | pending | ok | denied
        public byte[] Key, Commit, HelperPub;
        public ECParameters HelperKey; // privater Schlüssel des Helpers bis zum reveal
        public DateTime Created = DateTime.UtcNow;
    }

    readonly ConcurrentDictionary<string, Request> requests = new();
    readonly NetServer server;
    readonly object gate = new();
    UdpClient udp;
    public DateTime ActiveUntil { get; private set; } = DateTime.MinValue;
    public string GroupId { get; private set; }
    public bool Active => DateTime.UtcNow < ActiveUntil;
    /// <summary>Neue Anfrage (Name des PCs, Zahl): Hinweis im Infobereich.</summary>
    public Action<Request> OnRequest = _ => { };

    public Pairing(NetServer server) => this.server = server;

    /// <summary>Kopplungsmodus für eine Gruppe starten (ohne Angabe: die erste) bzw. verlängern.</summary>
    public void Start(string groupId = null)
    {
        groupId ??= Groups.List()[0].Id;
        if (Groups.Get(groupId) == null) throw new ArgumentException("Gruppe unbekannt");
        lock (gate)
        {
            GroupId = groupId;
            ActiveUntil = DateTime.UtcNow + Window;
            if (udp == null) StartDiscovery();
        }
        Log.Write($"Kopplungsmodus an (Gruppe {groupId}, 5 Minuten)");
    }

    public void Stop()
    {
        lock (gate)
        {
            ActiveUntil = DateTime.MinValue;
            try { udp?.Dispose(); } catch { /* schon zu */ }
            udp = null;
        }
        // auch zugelassene, noch nicht abgeholte: wer versehentlich zugelassen hat, nimmt es mit „Beenden“ zurück
        foreach (var r in requests.Values.Where(r => r.State is "pending" or "committed" or "ok")) { r.State = "denied"; r.Key = null; }
    }

    public List<Request> List()
    {
        Prune();
        return requests.Values.Where(r => r.State != "committed").OrderBy(r => r.Created).ToList(); // ohne reveal noch keine Zahl
    }

    public bool Decide(string id, bool allow)
    {
        if (!requests.TryGetValue(id ?? "", out var r) || r.State != "pending") return false;
        r.State = allow ? "ok" : "denied";
        Log.Write($"Kopplung „{r.Label}“ ({r.Ip}) {(allow ? "zugelassen" : "abgelehnt")}");
        return true;
    }

    void Prune()
    {
        foreach (var (id, r) in requests)
            if (DateTime.UtcNow - r.Created > (r.State == "committed" ? CommitLife : RequestLife) && requests.TryRemove(id, out _) && r.State == "committed")
                Abandon(r.Ip, "verfallen");
        if (!Active && udp != null) lock (gate) { if (!Active) { try { udp?.Dispose(); } catch { } udp = null; } }
    }

    // ---- Finden (UDP) ------------------------------------------------------------------------------------------------------------
    void StartDiscovery()
    {
        try
        {
            var u = new UdpClient(AddressFamily.InterNetwork);
            u.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            u.Client.Bind(new IPEndPoint(IPAddress.Any, DiscoveryPort));
            // Windows: Antwort an einen schon geschlossenen Port meldet sonst beim nächsten Empfangen „Verbindung zurückgesetzt“
            const int SioUdpConnReset = -1744830452;
            try { u.Client.IOControl(SioUdpConnReset, new byte[] { 0, 0, 0, 0 }, null); } catch { /* nicht Windows */ }
            // auf allen IPv4-Schnittstellen beitreten (WLAN und Kabel), sonst hört er nur auf der Standard-Schnittstelle
            foreach (var addr in LocalAddresses())
                try { u.JoinMulticastGroup(Group, addr); } catch { /* Schnittstelle ohne Multicast */ }
            udp = u;
            _ = Task.Run(() => Listen(u));
        }
        catch (Exception e)
        {
            Log.Write("Kopplung: Suche per UDP nicht möglich: " + e.Message); // Koppeln geht dann mit eingetippter Adresse
        }
    }

    static List<IPAddress> LocalAddresses()
    {
        var list = new List<IPAddress> { IPAddress.Loopback };
        foreach (var ni in System.Net.NetworkInformation.NetworkInterface.GetAllNetworkInterfaces())
        {
            if (ni.OperationalStatus != System.Net.NetworkInformation.OperationalStatus.Up || !ni.SupportsMulticast) continue;
            list.AddRange(ni.GetIPProperties().UnicastAddresses.Select(a => a.Address).Where(a => a.AddressFamily == AddressFamily.InterNetwork && !IPAddress.IsLoopback(a)));
        }
        return list;
    }

    async Task Listen(UdpClient u)
    {
        var local = LocalAddresses().Select(a => a.ToString()).ToHashSet();
        while (true)
        {
            UdpReceiveResult r;
            try { r = await u.ReceiveAsync(); }
            catch (ObjectDisposedException) { return; } // Kopplungsmodus beendet
            catch (SocketException) { if (udp != u) return; continue; } // einzelnes fehlerhaftes Paket: weiter lauschen
            if (!Active || r.Buffer.Length > 64 || Encoding.ASCII.GetString(r.Buffer) != "NBHELPER?1") continue;
            var from = r.RemoteEndPoint.Address;
            // nur eigenes Netz: privat, Link-lokal oder dieser PC; im Nur-dieser-PC-Betrieb nur dieser PC
            bool same = IPAddress.IsLoopback(from) || local.Contains(from.ToString());
            if (server.LoopbackOnly ? !same : !IsPrivate(from)) continue;
            // local: Anfrage kam von diesem PC – Thunderbird nimmt dann 127.0.0.1 (keine Erlaubnis, keine Firewall nötig)
            var reply = new JsonObject
            {
                ["service"] = "novabird-helper", ["name"] = Environment.MachineName, ["port"] = server.Port, ["version"] = Program.Version, ["local"] = same,
            };
            try { await u.SendAsync(Encoding.UTF8.GetBytes(reply.ToJsonString()), r.RemoteEndPoint); } catch { /* Absender weg */ }
        }
    }

    public static bool IsPrivate(IPAddress a)
    {
        if (IPAddress.IsLoopback(a)) return true;
        var b = a.GetAddressBytes();
        if (b.Length != 4) return a.IsIPv6LinkLocal || a.IsIPv6UniqueLocal;
        return b[0] == 10 || (b[0] == 172 && b[1] >= 16 && b[1] <= 31) || (b[0] == 192 && b[1] == 168) || (b[0] == 169 && b[1] == 254);
    }

    // ---- Schlüsseltausch (HTTP) -----------------------------------------------------------------------------------------------------
    /// <summary>POST /nbhelper/pair. Rückgabe: Status, JSON; fail = als Fehlversuch zählen.</summary>
    public (int Status, string Json, bool Fail) Handle(byte[] body, string ip)
    {
        Prune();
        try { return HandleCore(body, ip); }
        catch { return (400, "{\"error\":\"request\"}", true); } // kaputte Anfrage (falsche Typen, kein Objekt …)
    }

    (int Status, string Json, bool Fail) HandleCore(byte[] body, string ip)
    {
        JsonNode msg;
        try { msg = JsonNode.Parse(body); } catch { return (400, "{\"error\":\"request\"}", true); }
        if (msg is not JsonObject) return (400, "{\"error\":\"request\"}", true);
        switch ((string)msg["op"])
        {
            case "start":
            {
                if (!Active) return (403, "{\"error\":\"pairing-off\"}", false);
                if (server.LoopbackOnly ? ip != "127.0.0.1" && ip != "::1" : !IPAddress.TryParse(ip, out var a) || !IsPrivate(a))
                    return (403, "{\"error\":\"network\"}", true);
                if (msg["commit"] == null) return (400, "{\"error\":\"update\"}", false); // altes Verfahren ohne Festlegung
                if (TooManyAbandoned(ip)) return (429, "{\"error\":\"busy\"}", true);
                // höchstens eine offene Festlegung je Adresse: eine neue ersetzt die alte (zählt als ohne Abschluss)
                foreach (var old in requests.Values.Where(x => x.State == "committed" && x.Ip == ip).ToList())
                    if (requests.TryRemove(old.Id, out _)) Abandon(ip, "neu gestartet");
                if (TooManyAbandoned(ip)) return (429, "{\"error\":\"busy\"}", true);
                if (requests.Values.Count(r => r.State is "pending" or "committed") >= MaxPending) return (429, "{\"error\":\"busy\"}", false);
                byte[] commit;
                try { commit = Convert.FromBase64String((string)msg["commit"]); } catch { return (400, "{\"error\":\"commit\"}", true); }
                if (commit.Length != 32) return (400, "{\"error\":\"commit\"}", true);
                // Name des PCs: keine Steuerzeichen (Zeilenumbrüche würden Zeilen im Protokoll vortäuschen), höchstens 40 Zeichen
                var label = System.Text.RegularExpressions.Regex.Replace((string)msg["label"] ?? "", @"\p{C}+", " ").Trim();
                label = label.Length > 40 ? label[..40].Trim() : label;
                using var ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
                var key = ecdh.ExportParameters(true);
                var helperPub = new byte[65];
                helperPub[0] = 4;
                key.Q.X.CopyTo(helperPub, 1);
                key.Q.Y.CopyTo(helperPub, 33);
                var req = new Request
                {
                    Id = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
                    Label = label.Length > 0 ? label : ip, Ip = ip, GroupId = GroupId, Commit = commit, HelperPub = helperPub, HelperKey = key,
                };
                requests[req.Id] = req;
                return (200, new JsonObject { ["req"] = req.Id, ["pub"] = Convert.ToBase64String(helperPub), ["name"] = Environment.MachineName, ["v"] = 2 }.ToJsonString(), false);
            }
            case "reveal":
            {
                if (!requests.TryGetValue((string)msg["req"] ?? "", out var r) || r.State != "committed" || r.Ip != ip)
                    return (404, "{\"state\":\"expired\"}", true);
                byte[] clientPub;
                try { clientPub = Convert.FromBase64String((string)msg["pub"]); } catch { return (400, "{\"error\":\"pub\"}", true); }
                if (clientPub.Length != 65 || clientPub[0] != 4 || !CryptographicOperations.FixedTimeEquals(SHA256.HashData(clientPub), r.Commit))
                {
                    requests.TryRemove(r.Id, out _); // passt nicht zur Festlegung: Anfrage verworfen
                    Abandon(ip, "Schlüssel passt nicht zur Festlegung");
                    return (400, "{\"error\":\"commit\"}", true);
                }
                byte[] shared;
                try
                {
                    using var mine = ECDiffieHellman.Create(r.HelperKey);
                    using var peer = ECDiffieHellman.Create(new ECParameters
                    {
                        Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = clientPub[1..33], Y = clientPub[33..65] },
                    });
                    shared = mine.DeriveRawSecretAgreement(peer.PublicKey);
                }
                catch
                {
                    requests.TryRemove(r.Id, out _);
                    return (400, "{\"error\":\"pub\"}", true); // kein Punkt auf der Kurve
                }
                var (sas, k) = Derive(shared, r.HelperPub, clientPub);
                r.Sas = sas;
                r.Key = k;
                r.HelperKey = default;
                r.State = "pending";
                Log.Write($"Kopplung: Anfrage von „{r.Label}“ ({ip}), Zahl {sas}");
                OnRequest(r);
                return (200, "{\"state\":\"pending\"}", false);
            }
            case "poll":
            {
                if (!requests.TryGetValue((string)msg["req"] ?? "", out var r)) return (404, "{\"state\":\"expired\"}", true);
                if (r.State != "ok") return (200, new JsonObject { ["state"] = r.State }.ToJsonString(), false);
                var g = Groups.Get(r.GroupId);
                if (g == null) return (200, "{\"state\":\"expired\"}", false);
                var plain = Encoding.UTF8.GetBytes(new JsonObject { ["code"] = g.Code, ["group"] = g.Name }.ToJsonString());
                var nonce = RandomNumberGenerator.GetBytes(12);
                var data = new byte[plain.Length + 16];
                using (var aes = new AesGcm(r.Key, 16))
                    aes.Encrypt(nonce, plain, data.AsSpan(0, plain.Length), data.AsSpan(plain.Length), Encoding.ASCII.GetBytes("nbh-pair|" + r.Id));
                requests.TryRemove(r.Id, out _); // Code nur einmal ausliefern
                return (200, new JsonObject { ["state"] = "ok", ["n"] = Convert.ToBase64String(nonce), ["d"] = Convert.ToBase64String(data) }.ToJsonString(), false);
            }
            default:
                return (400, "{\"error\":\"op\"}", true);
        }
    }

    /// <summary>Vergleichszahl und Schlüssel aus dem gemeinsamen Geheimnis (auch für den Test gegen die JavaScript-Seite).</summary>
    public static (string Sas, byte[] Key) Derive(byte[] shared, byte[] helperPub, byte[] clientPub)
    {
        var pubs = "|" + Convert.ToBase64String(helperPub) + "|" + Convert.ToBase64String(clientPub);
        var sasBytes = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 4, Array.Empty<byte>(), Encoding.ASCII.GetBytes("nbh-pair-sas" + pubs));
        var n = ((uint)sasBytes[0] << 24 | (uint)sasBytes[1] << 16 | (uint)sasBytes[2] << 8 | sasBytes[3]) % 1_000_000;
        var key = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, Array.Empty<byte>(), Encoding.ASCII.GetBytes("nbh-pair-key" + pubs));
        return (n.ToString("D6"), key);
    }
}
