// Ordner-Sync der Vektoren zwischen PCs (NAS, OneDrive, Nextcloud …): keine offenen Ports, nur Dateien in einem Ordner.
//  - Kopplung: Der erste PC erzeugt einen Code (20 Zeichen); jeder weitere PC bekommt denselben Code eingetippt.
//    Schlüssel = PBKDF2-SHA256(Code, Salz aus dem Sync-Ordner, 300.000 Runden); im Ordner liegt nur Salz + Prüfwert.
//  - Pakete: AES-256-GCM verschlüsselt, Inhalt = Vektordatei des Add-ons (Message-ID + Vektor, keine Mailtexte).
//    <Ordner>\NovaBird-Sync\<modell>-<revision8>\<gerät>-<zeit>.nbsync
//  - Jeder PC liest die Pakete der anderen einmal (gemerkt in sync-state.json) und schreibt nur eigene neue Vektoren.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class Sync
{
    const string Magic = "NBSYNC1";
    const int Iterations = 300_000;
    const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O, 1/I
    static readonly Dictionary<string, byte[]> ReadCache = new();

    static string SyncRoot(string folder) => Path.Combine(folder, "NovaBird-Sync");
    static string KeyFile(string folder) => Path.Combine(SyncRoot(folder), "schluessel.json");
    static string StatePath => Path.Combine(Settings.Dir, "sync-state.json");

    internal static string Normalize(string code) => new string(code.ToUpperInvariant().Where(c => Alphabet.Contains(c)).ToArray());

    internal static string NewCode()
    {
        var bytes = RandomNumberGenerator.GetBytes(20);
        var chars = bytes.Select(b => Alphabet[b % Alphabet.Length]).ToArray(); // 32 Zeichen: gleichverteilt
        var s = new string(chars);
        return string.Join("-", Enumerable.Range(0, 4).Select(i => s.Substring(i * 5, 5)));
    }

    static byte[] Derive(string code, byte[] salt) =>
        Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(Normalize(code)), salt, Iterations, HashAlgorithmName.SHA256, 32);

    static byte[] Check(byte[] key) => HMACSHA256.HashData(key, Encoding.ASCII.GetBytes("novabird-sync-check"));

    public static JsonObject Status()
    {
        var s = Settings.Load();
        var folder = (string)s["syncFolder"];
        return new JsonObject { ["configured"] = !string.IsNullOrEmpty(folder) && s["syncKey"] != null, ["folder"] = folder };
    }

    /// <summary>Ordner koppeln. Ohne Code: neuer Sync-Ordner, liefert den Code. Mit Code: bestehendem Sync-Ordner beitreten.</summary>
    public static string Setup(string folder, string code)
    {
        if (string.IsNullOrWhiteSpace(folder) || !Directory.Exists(folder)) throw new DirectoryNotFoundException("Ordner nicht gefunden");
        Directory.CreateDirectory(SyncRoot(folder));
        string newCode = null;
        byte[] key;
        if (File.Exists(KeyFile(folder)))
        {
            if (string.IsNullOrWhiteSpace(code)) throw new InvalidOperationException("Ordner ist schon gekoppelt: Code vom ersten PC eingeben");
            var kf = JsonNode.Parse(File.ReadAllText(KeyFile(folder)));
            key = Derive(code, Convert.FromBase64String((string)kf["salt"]));
            if (!CryptographicOperations.FixedTimeEquals(Check(key), Convert.FromBase64String((string)kf["check"])))
                throw new InvalidOperationException("Code passt nicht zu diesem Sync-Ordner");
        }
        else
        {
            newCode = string.IsNullOrWhiteSpace(code) ? NewCode() : code.Trim();
            var salt = RandomNumberGenerator.GetBytes(16);
            key = Derive(newCode, salt);
            var kf = new JsonObject { ["version"] = 1, ["salt"] = Convert.ToBase64String(salt), ["check"] = Convert.ToBase64String(Check(key)) };
            File.WriteAllText(KeyFile(folder), kf.ToJsonString());
        }
        var s = Settings.Load();
        s["syncFolder"] = folder;
        s["syncKey"] = Settings.Protect(key);
        Settings.Save(s);
        Log.Write("Sync gekoppelt: " + folder);
        return newCode;
    }

    public static void Leave()
    {
        var s = Settings.Load();
        s.Remove("syncFolder");
        s.Remove("syncKey");
        Settings.Save(s);
    }

    static (string folder, byte[] key) Config()
    {
        var s = Settings.Load();
        var folder = (string)s["syncFolder"];
        if (string.IsNullOrEmpty(folder) || s["syncKey"] == null) throw new InvalidOperationException("Sync nicht eingerichtet");
        return (folder, Settings.Unprotect((string)s["syncKey"]));
    }

    static string Tag(string model, string revision) =>
        new string($"{model}-{revision[..Math.Min(8, revision.Length)]}".Where(c => char.IsLetterOrDigit(c) || c == '-').ToArray());

    static string ModelDir(string folder, string tag) => Path.Combine(SyncRoot(folder), tag);

    /// <summary>Eigenes Paket ablegen (verschlüsselt). Gibt den Dateinamen zurück.</summary>
    public static string Push(string model, string revision, byte[] plain)
    {
        var (folder, key) = Config();
        var tag = Tag(model, revision);
        Directory.CreateDirectory(ModelDir(folder, tag));
        var name = $"{Settings.DeviceId()}-{DateTime.UtcNow:yyyyMMddHHmmssfff}.nbsync";
        var nonce = RandomNumberGenerator.GetBytes(12);
        var cipher = new byte[plain.Length];
        var tagBytes = new byte[16];
        using (var aes = new AesGcm(key, 16)) aes.Encrypt(nonce, plain, cipher, tagBytes, Encoding.ASCII.GetBytes(tag));
        var path = Path.Combine(ModelDir(folder, tag), name);
        using (var fs = File.Create(path + ".tmp"))
        {
            fs.Write(Encoding.ASCII.GetBytes(Magic));
            fs.Write(nonce);
            fs.Write(tagBytes);
            fs.Write(cipher);
        }
        File.Move(path + ".tmp", path, true);
        MarkImported(name); // eigenes Paket nie wieder einlesen
        return name;
    }

    static HashSet<string> Imported()
    {
        try { return File.Exists(StatePath) ? JsonNode.Parse(File.ReadAllText(StatePath))["imported"].AsArray().Select(x => (string)x).ToHashSet() : new(); }
        catch { return new(); }
    }

    static void MarkImported(string name)
    {
        var set = Imported();
        set.Add(name);
        Directory.CreateDirectory(Settings.Dir);
        File.WriteAllText(StatePath, new JsonObject { ["imported"] = new JsonArray(set.Select(x => (JsonNode)x).ToArray()) }.ToJsonString());
    }

    /// <summary>Pakete anderer PCs, die hier noch nicht eingelesen wurden: [(Name, Größe)].</summary>
    public static List<(string Name, long Size)> Pending(string model, string revision)
    {
        var (folder, _) = Config();
        var dir = ModelDir(folder, Tag(model, revision));
        if (!Directory.Exists(dir)) return new();
        var own = Settings.DeviceId() + "-";
        var done = Imported();
        return Directory.GetFiles(dir, "*.nbsync").Select(Path.GetFileName)
            .Where(n => !n.StartsWith(own) && !done.Contains(n)).OrderBy(n => n)
            .Select(n => (n, new FileInfo(Path.Combine(dir, n)).Length)).ToList();
    }

    /// <summary>Entschlüsselten Inhalt eines Pakets stückweise lesen (Native Messaging erlaubt höchstens 1 MB je Antwort).</summary>
    public static (byte[] Data, long Total) Read(string model, string revision, string name, long offset, int length)
    {
        if (name.Contains('/') || name.Contains('\\') || name.Contains("..")) throw new ArgumentException("Name");
        var tag = Tag(model, revision);
        if (!ReadCache.TryGetValue(name, out var plain))
        {
            var (folder, key) = Config();
            var all = File.ReadAllBytes(Path.Combine(ModelDir(folder, tag), name));
            if (Encoding.ASCII.GetString(all, 0, Magic.Length) != Magic) throw new InvalidDataException("kein NovaBird-Sync-Paket");
            var nonce = all.AsSpan(Magic.Length, 12);
            var tagBytes = all.AsSpan(Magic.Length + 12, 16);
            var cipher = all.AsSpan(Magic.Length + 28);
            plain = new byte[cipher.Length];
            using var aes = new AesGcm(key, 16);
            try { aes.Decrypt(nonce, cipher, tagBytes, plain, Encoding.ASCII.GetBytes(tag)); }
            catch (CryptographicException) { throw new InvalidOperationException("Paket lässt sich nicht entschlüsseln (anderer Code?)"); }
            ReadCache.Clear(); // nur ein Paket im Speicher
            ReadCache[name] = plain;
        }
        var n = (int)Math.Max(0, Math.Min(length, plain.Length - offset));
        return (plain.AsSpan((int)offset, n).ToArray(), plain.Length);
    }

    public static void Ack(string name)
    {
        ReadCache.Remove(name);
        MarkImported(name);
    }
}
