// Schlüssel für die OpenAI-kompatible Schnittstelle (externe Programme): apikeys.json im Datenordner.
//  - Gespeichert wird nur SHA-256 des Schlüssels (zufällig, 32 Byte); der Schlüssel selbst wird einmal beim Anlegen angezeigt.
//  - Je Schlüssel optional erlaubte Adressen: einzelne IPs oder Netze (192.168.1.20, 192.168.1.0/24, fd00::/8). Leer = alle.
//  - Nutzung (Anzahl, zuletzt) wird mitgezählt und höchstens alle 30 s gespeichert.
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

static class ApiKeys
{
    public sealed class Key
    {
        public string Id, Name, Hash, Prefix, Created;
        public List<string> Ips = new();
        public string LastUsed, LastIp;
        public long Uses;
    }

    static readonly object Gate = new();
    static readonly Regex NameRule = new(@"^[\p{L}\p{N} ._@()-]{1,40}$");
    static List<Key> cache;
    static DateTime savedAt;
    static string FilePath => Path.Combine(Settings.Dir, "apikeys.json");

    static List<Key> Load()
    {
        if (cache != null) return cache;
        try
        {
            cache = !File.Exists(FilePath) ? new() : JsonNode.Parse(File.ReadAllText(FilePath)).AsArray().Select(n => new Key
            {
                Id = (string)n["id"], Name = (string)n["name"], Hash = (string)n["hash"], Prefix = (string)n["prefix"], Created = (string)n["created"],
                Ips = n["ips"]?.AsArray().Select(x => (string)x).ToList() ?? new(),
                LastUsed = (string)n["lastUsed"], LastIp = (string)n["lastIp"], Uses = (long?)n["uses"] ?? 0,
            }).ToList();
        }
        catch (Exception e)
        {
            Log.Write("apikeys.json unlesbar: " + e.Message);
            cache = new();
        }
        return cache;
    }

    static void Save()
    {
        Directory.CreateDirectory(Settings.Dir);
        var arr = new JsonArray(Load().Select(k => (JsonNode)new JsonObject
        {
            ["id"] = k.Id, ["name"] = k.Name, ["hash"] = k.Hash, ["prefix"] = k.Prefix, ["created"] = k.Created,
            ["ips"] = new JsonArray(k.Ips.Select(i => (JsonNode)i).ToArray()), ["lastUsed"] = k.LastUsed, ["lastIp"] = k.LastIp, ["uses"] = k.Uses,
        }).ToArray());
        File.WriteAllText(FilePath + ".tmp", arr.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        File.Move(FilePath + ".tmp", FilePath, true);
        savedAt = DateTime.UtcNow;
    }

    static string HashOf(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(key)));

    /// <summary>Prüft und vereinheitlicht die erlaubten Adressen (Komma, Leerzeichen oder Zeilen getrennt).</summary>
    public static List<string> ParseIps(string text)
    {
        var list = new List<string>();
        foreach (var part in (text ?? "").Split(new[] { ',', ';', ' ', '\n', '\r', '\t' }, StringSplitOptions.RemoveEmptyEntries))
        {
            if (part.Contains('/') && IPNetwork.TryParse(part, out var net)) list.Add(net.ToString());
            else if (!part.Contains('/') && IPAddress.TryParse(part, out var one)) list.Add(one.ToString());
            else throw new ArgumentException(L.T($"Keine gültige Adresse: {part}", $"Not a valid address: {part}"));
        }
        if (list.Count > 50) throw new ArgumentException(L.T("Höchstens 50 Adressen", "At most 50 addresses"));
        return list.Distinct().ToList();
    }

    static bool Allowed(Key k, IPAddress ip)
    {
        if (k.Ips.Count == 0) return true;
        if (ip.IsIPv4MappedToIPv6) ip = ip.MapToIPv4();
        foreach (var e in k.Ips)
        {
            if (e.Contains('/') ? IPNetwork.TryParse(e, out var net) && net.Contains(ip) : IPAddress.TryParse(e, out var one) && one.Equals(ip)) return true;
        }
        return false;
    }

    /// <summary>Beim Beenden: noch nicht gespeicherte Zähler sichern.</summary>
    public static void Flush()
    {
        lock (Gate)
        {
            if (cache != null && cache.Count > 0) Save();
        }
    }

    public static List<Key> List()
    {
        lock (Gate) return Load().ToList();
    }

    /// <summary>Neuer Schlüssel; liefert (Eintrag, Schlüssel im Klartext – nur jetzt).</summary>
    public static (Key, string) Add(string name, List<string> ips)
    {
        name = (name ?? "").Trim();
        if (!NameRule.IsMatch(name)) throw new ArgumentException(L.T("Name: 1–40 Zeichen", "Name: 1–40 characters"));
        var secret = "nbh-" + Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var k = new Key
        {
            Id = Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant(), Name = name, Hash = HashOf(secret),
            Prefix = secret[..8] + "…", Created = DateTime.Now.ToString("yyyy-MM-dd HH:mm"), Ips = ips,
        };
        lock (Gate)
        {
            var all = Load();
            if (all.Count >= 50) throw new ArgumentException(L.T("Höchstens 50 Schlüssel", "At most 50 keys"));
            all.Add(k);
            Save();
        }
        return (k, secret);
    }

    public static void Remove(string id)
    {
        lock (Gate)
        {
            if (Load().RemoveAll(k => k.Id == id) == 0) throw new ArgumentException(L.T("Schlüssel unbekannt", "Unknown key"));
            Save();
        }
    }

    public enum Result { Ok, NoKey, Denied }

    /// <summary>Schlüssel aus „Authorization: Bearer …“ prüfen; Denied = Schlüssel gültig, aber nicht von dieser Adresse.</summary>
    public static (Result, Key) Check(string secret, IPAddress ip)
    {
        if (string.IsNullOrEmpty(secret) || secret.Length > 200) return (Result.NoKey, null);
        var hash = Convert.FromHexString(HashOf(secret));
        lock (Gate)
        {
            var k = Load().FirstOrDefault(x => CryptographicOperations.FixedTimeEquals(Convert.FromHexString(x.Hash), hash));
            if (k == null) return (Result.NoKey, null);
            if (ip == null || !Allowed(k, ip)) return (Result.Denied, k);
            k.Uses++;
            k.LastUsed = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            k.LastIp = ip.ToString();
            if (DateTime.UtcNow - savedAt > TimeSpan.FromSeconds(30)) Save();
            return (Result.Ok, k);
        }
    }
}
