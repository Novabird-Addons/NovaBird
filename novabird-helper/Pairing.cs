// Kopplungsmodus: Ein PC holt sich den Code einer Gruppe, ohne die 20 Zeichen abzutippen.
//  - Ein Admin startet ihn in der Web-Oberfläche (PCs → „Gerät über Kopplung hinzufügen“) für eine Gruppe; er läuft 5 Minuten.
//  - Finden: Thunderbird schickt "NBHELPER?1" an die Multicast-Gruppe 239.255.77.31, UDP-Port 47531; nur im Kopplungsmodus
//    antwortet der Helper (an den Absender) mit {service, name, port, version, local}. Sonst bleibt er stumm.
//  - POST /nbhelper/pair (unverschlüsselt, der Schutz kommt aus dem Schlüsseltausch):
//      {op:"start", pub, label} -> {req, pub, name}: ECDH P-256, öffentliche Schlüssel roh (65 Byte 04||X||Y, Base64).
//        Beide Seiten zeigen dieselbe 6-stellige Zahl: HKDF-SHA256(Geheimnis, info "nbh-pair-sas|<Helper-pub>|<PC-pub>"),
//        erste 4 Byte (big endian) mod 1.000.000. Ein Dritter im Netz hätte mit jeder Seite ein anderes Geheimnis und damit
//        eine andere Zahl – darum vergleicht der Admin die Zahl, bevor er „Zulassen“ klickt.
//      {op:"poll", req} -> {state:"pending"|"denied"|"expired"} oder {state:"ok", n, d}: d = AES-256-GCM mit dem Schlüssel
//        HKDF(Geheimnis, info "nbh-pair-key|<Helper-pub>|<PC-pub>"), AAD "nbh-pair|<req>", Inhalt {code, group}.
//  - Höchstens 8 offene Anfragen; Anfragen gelten 10 Minuten; unbekannte Kennungen zählen als Fehlversuch (Sperre wie bei 403).
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
    static readonly TimeSpan Window = TimeSpan.FromMinutes(5), RequestLife = TimeSpan.FromMinutes(10);
    const int MaxPending = 8;

    public sealed class Request
    {
        public string Id, Label, Ip, Sas, GroupId, State = "pending"; // pending | ok | denied
        public byte[] Key;
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
        foreach (var r in requests.Values.Where(r => r.State == "pending")) r.State = "denied";
    }

    public List<Request> List()
    {
        Prune();
        return requests.Values.OrderBy(r => r.Created).ToList();
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
            if (DateTime.UtcNow - r.Created > RequestLife) requests.TryRemove(id, out _);
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
        JsonNode msg;
        try { msg = JsonNode.Parse(body); } catch { return (400, "{\"error\":\"request\"}", true); }
        switch ((string)msg?["op"])
        {
            case "start":
            {
                if (!Active) return (403, "{\"error\":\"pairing-off\"}", false);
                if (server.LoopbackOnly ? ip != "127.0.0.1" && ip != "::1" : !IPAddress.TryParse(ip, out var a) || !IsPrivate(a))
                    return (403, "{\"error\":\"network\"}", true);
                if (requests.Values.Count(r => r.State == "pending") >= MaxPending) return (429, "{\"error\":\"busy\"}", false);
                byte[] clientPub;
                try { clientPub = Convert.FromBase64String((string)msg["pub"]); } catch { return (400, "{\"error\":\"pub\"}", true); }
                if (clientPub.Length != 65 || clientPub[0] != 4) return (400, "{\"error\":\"pub\"}", true);
                var label = ((string)msg["label"] ?? "").Trim();
                label = label.Length > 40 ? label[..40] : label;
                using var ecdh = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
                byte[] shared;
                try
                {
                    using var peer = ECDiffieHellman.Create(new ECParameters
                    {
                        Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = clientPub[1..33], Y = clientPub[33..65] },
                    });
                    shared = ecdh.DeriveRawSecretAgreement(peer.PublicKey);
                }
                catch { return (400, "{\"error\":\"pub\"}", true); } // kein Punkt auf der Kurve
                var q = ecdh.ExportParameters(false).Q;
                var helperPub = new byte[65];
                helperPub[0] = 4;
                q.X.CopyTo(helperPub, 1);
                q.Y.CopyTo(helperPub, 33);
                var (sas, key) = Derive(shared, helperPub, clientPub);
                var req = new Request
                {
                    Id = Convert.ToBase64String(RandomNumberGenerator.GetBytes(16)).TrimEnd('=').Replace('+', '-').Replace('/', '_'),
                    Label = label.Length > 0 ? label : ip, Ip = ip, Sas = sas, Key = key, GroupId = GroupId,
                };
                requests[req.Id] = req;
                Log.Write($"Kopplung: Anfrage von „{req.Label}“ ({ip}), Zahl {sas}");
                OnRequest(req);
                return (200, new JsonObject { ["req"] = req.Id, ["pub"] = Convert.ToBase64String(helperPub), ["name"] = Environment.MachineName }.ToJsonString(), false);
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
