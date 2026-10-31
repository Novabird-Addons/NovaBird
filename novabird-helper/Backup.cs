// Sicherung des Helpers als eine Datei (Web-Oberfläche → Verbindung → Sicherung): Gruppen mit Kopplungscodes und Salzen,
// Benutzer, Schlüssel externer Programme, Team-Kalender und auf Wunsch die geteilten Vektoren. So zieht der Helper auf einen
// anderen PC um, ohne dass die PCs neu gekoppelt werden oder neu rechnen müssen.
//  - Format: "NBBK1" + Salz (16) + Nonce (12) + AES-256-GCM(ZIP) + Prüfwert (16); Schlüssel = PBKDF2-SHA256(Passwort, Salz,
//    600.000 Runden). Ohne das Passwort ist die Datei wertlos; die Vektoren darin sind zusätzlich je Mail verschlüsselt.
//  - Wiederherstellen ersetzt Gruppen, Benutzer, Schlüssel und Kalender; die Vektoren nur, wenn die Sicherung welche enthält
//    (sonst werden die vorhandenen gelöscht – sie passen nicht zu den Salzen der Sicherung). Alle Sitzungen enden.
//  - Erst wird die ganze Datei geprüft (bekannte Einträge, Pfade bleiben im Zielordner, Größe ausgepackt höchstens 4 GB) und in
//    Nebenordner ausgepackt; erst dann wird getauscht. Eine kaputte Sicherung ändert also nichts.
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class Backup
{
    public const int MaxBytes = 1 << 30;
    const long MaxUnpacked = 4L << 30;
    const int MaxEntries = 200_000;
    const int Iterations = 600_000;
    static readonly byte[] Magic = Encoding.ASCII.GetBytes("NBBK1");

    public static byte[] Create(NetServer server, string password, bool vectors)
    {
        if (Users.PasswordProblem(password) is string p) throw new ArgumentException(p);
        using var ms = new MemoryStream();
        using (var zip = new ZipArchive(ms, ZipArchiveMode.Create, true))
        {
            Text(zip, "manifest.json", new JsonObject { ["format"] = 1, ["version"] = Program.Version, ["created"] = DateTime.Now.ToString("o"), ["vectors"] = vectors }.ToJsonString());
            Text(zip, "groups.json", Groups.ExportPlain().ToJsonString());
            foreach (var f in new[] { "users.json", "apikeys.json" })
                if (File.Exists(Path.Combine(Settings.Dir, f))) zip.CreateEntryFromFile(Path.Combine(Settings.Dir, f), f);
            Calendars.Locked(() => Tree(zip, Calendars.Root, "calendars"));
            if (vectors) Tree(zip, VectorStore.Root, "vectors"); // offene Dateien: nur lesend mitbenutzen
        }
        var plain = ms.ToArray();
        var salt = RandomNumberGenerator.GetBytes(16);
        var nonce = RandomNumberGenerator.GetBytes(12);
        var output = new byte[Magic.Length + 16 + 12 + plain.Length + 16];
        Magic.CopyTo(output, 0);
        salt.CopyTo(output, Magic.Length);
        nonce.CopyTo(output, Magic.Length + 16);
        using (var aes = new AesGcm(Key(password, salt), 16))
            aes.Encrypt(nonce, plain, output.AsSpan(Magic.Length + 28, plain.Length), output.AsSpan(output.Length - 16), Magic);
        return output;
    }

    static byte[] Key(string password, byte[] salt) => Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, Iterations, HashAlgorithmName.SHA256, 32);

    static void Text(ZipArchive zip, string name, string text)
    {
        using var w = new StreamWriter(zip.CreateEntry(name).Open(), new UTF8Encoding(false));
        w.Write(text);
    }

    static void Tree(ZipArchive zip, string dir, string prefix)
    {
        if (!Directory.Exists(dir)) return;
        foreach (var f in Directory.GetFiles(dir, "*", SearchOption.AllDirectories).Where(f => !f.EndsWith(".tmp")))
        {
            var entry = zip.CreateEntry(prefix + "/" + Path.GetRelativePath(dir, f).Replace('\\', '/'), CompressionLevel.Fastest);
            using var src = new FileStream(f, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            using var dst = entry.Open();
            src.CopyTo(dst);
        }
    }

    /// <summary>Sicherung einspielen; liefert eine kurze Zusammenfassung.</summary>
    public static JsonObject Restore(NetServer server, byte[] data, string password)
    {
        if (data.Length < Magic.Length + 44 || !data.AsSpan(0, Magic.Length).SequenceEqual(Magic)) throw new ArgumentException(L.T("Keine Sicherung des NovaBird Helpers", "Not a NovaBird Helper backup"));
        var salt = data.AsSpan(Magic.Length, 16).ToArray();
        var nonce = data.AsSpan(Magic.Length + 16, 12).ToArray();
        var plain = new byte[data.Length - Magic.Length - 44];
        try
        {
            using var aes = new AesGcm(Key(password ?? "", salt), 16);
            aes.Decrypt(nonce, data.AsSpan(Magic.Length + 28, plain.Length), data.AsSpan(data.Length - 16), plain, Magic);
        }
        catch (AuthenticationTagMismatchException) { throw new ArgumentException(L.T("Passwort falsch oder Datei beschädigt", "Wrong password or damaged file")); }

        using var zip = new ZipArchive(new MemoryStream(plain), ZipArchiveMode.Read);
        string Read(string name)
        {
            var e = zip.GetEntry(name);
            if (e == null) return null;
            using var r = new StreamReader(e.Open(), Encoding.UTF8);
            return r.ReadToEnd();
        }
        var manifest = JsonNode.Parse(Read("manifest.json") ?? throw new InvalidDataException("manifest"));
        if ((int?)manifest["format"] != 1) throw new ArgumentException(L.T("Sicherung aus einer neueren Version", "Backup from a newer version"));
        var groups = JsonNode.Parse(Read("groups.json") ?? throw new InvalidDataException("groups")).AsArray();
        bool vectors = zip.Entries.Any(e => e.FullName.StartsWith("vectors/"));
        // Ganze Datei prüfen, bevor sich etwas ändert
        var known = new HashSet<string> { "manifest.json", "groups.json", "users.json", "apikeys.json" };
        if (zip.Entries.Count > MaxEntries || zip.Entries.Sum(e => e.Length) > MaxUnpacked) throw new ArgumentException(L.T("Sicherung zu groß", "Backup too large"));
        foreach (var e in zip.Entries)
            if (!known.Contains(e.FullName) && !SafeIn(e.FullName, "calendars/") && !SafeIn(e.FullName, "vectors/"))
                throw new ArgumentException(L.T("Sicherung enthält unbekannte oder unsichere Einträge", "Backup contains unknown or unsafe entries") + ": " + e.FullName);
        foreach (var f in new[] { "users.json", "apikeys.json" })
            if (Read(f) is string text) JsonNode.Parse(text).AsArray();
        // Auspacken in Nebenordner
        var calNew = Calendars.Root + ".restore";
        var vecNew = VectorStore.Root + ".restore";
        foreach (var d in new[] { calNew, vecNew })
            if (Directory.Exists(d)) Directory.Delete(d, true);
        Extract(zip, "calendars/", calNew);
        Extract(zip, "vectors/", vecNew);

        foreach (var f in new[] { "users.json", "apikeys.json" })
        {
            var text = Read(f);
            var path = Path.Combine(Settings.Dir, f);
            if (text != null) File.WriteAllText(path, text);
            else if (File.Exists(path)) File.Delete(path);
        }
        ApiKeys.Reload();
        int calendars = 0;
        Calendars.Locked(() =>
        {
            if (Directory.Exists(Calendars.Root)) Directory.Delete(Calendars.Root, true);
            if (Directory.Exists(calNew)) Directory.Move(calNew, Calendars.Root);
            calendars = Directory.Exists(Calendars.Root) ? Directory.GetDirectories(Calendars.Root).Length : 0;
        });
        server.WithVectorsClosed(() =>
        {
            if (Directory.Exists(VectorStore.Root)) Directory.Delete(VectorStore.Root, true);
            if (Directory.Exists(vecNew)) Directory.Move(vecNew, VectorStore.Root);
            Groups.ImportPlain(groups);
        });
        Log.Write($"Sicherung eingespielt (vom {(string)manifest["created"]}, {groups.Count} Gruppen, {calendars} Kalender{(vectors ? ", mit Vektoren" : "")})");
        return new JsonObject { ["created"] = (string)manifest["created"], ["groups"] = groups.Count, ["calendars"] = calendars, ["vectors"] = vectors };
    }

    /// <summary>Eintrag liegt unter prefix, ohne „..“, ohne absolute Pfade, nur übliche Zeichen.</summary>
    static bool SafeIn(string name, string prefix) =>
        name.StartsWith(prefix) && name.Length > prefix.Length && !name.Contains('\\') && !name.Contains(':')
        && name[prefix.Length..].Split('/').All(part => part.Length > 0 && part != "." && part != "..");

    static void Extract(ZipArchive zip, string prefix, string target)
    {
        var root = Path.GetFullPath(target) + Path.DirectorySeparatorChar;
        foreach (var e in zip.Entries.Where(e => e.FullName.StartsWith(prefix) && !e.FullName.EndsWith('/')))
        {
            var dst = Path.GetFullPath(Path.Combine(target, e.FullName[prefix.Length..]));
            if (!dst.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("Pfad");
            Directory.CreateDirectory(Path.GetDirectoryName(dst));
            e.ExtractToFile(dst, true);
        }
    }
}
