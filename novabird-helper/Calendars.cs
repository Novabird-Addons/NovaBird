// Team-Kalender (CalDAV, CalDav.cs): Ablage im Datenordner, je Kalender ein Ordner
//   calendars\<id>\calendar.json  {id, name, color, description, created, rights: {Benutzer: "read"|"write"}, seq, logStart, log: [[seq, Datei, gelöscht]]}
//   calendars\<id>\items\<Datei>.ics  (Termine und Aufgaben unverändert so, wie der Kalender sie geschickt hat)
//  - seq zählt jede Änderung; daraus entstehen ctag und sync-token für den Abgleich. Das Protokoll behält die letzten 5.000
//    Änderungen; ältere sync-token sind ungültig, dann gleicht der Kalender einmal alles ab.
//  - ETag = die ersten 16 Hex-Zeichen von SHA-256 des Inhalts.
//  - Rechte je Benutzer der Web-Oberfläche: lesen oder lesen und schreiben. Kalender anlegen, umbenennen und löschen nur in der
//    Web-Oberfläche (Admins).
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

static class Calendars
{
    public const string Read = "read", Write = "write";
    public const int MaxItemBytes = 2 << 20, MaxCalendars = 50, MaxItems = 20_000; // Einträge je Kalender (Schutz der Platte)
    const int MaxLog = 5000;
    static readonly object Gate = new();
    static readonly Regex SafeName = new(@"^[A-Za-z0-9][A-Za-z0-9._@+=~-]{0,200}$");
    static readonly Regex Color = new("^#[0-9A-Fa-f]{6}$");
    static readonly Dictionary<string, (DateTime Time, long Length, string Etag)> etags = new();

    public sealed class Cal
    {
        public string Id, Name, Color, Description, Created;
        public Dictionary<string, string> Rights = new(StringComparer.OrdinalIgnoreCase);
        public long Seq, LogStart;
        public List<(long Seq, string Name, bool Deleted)> Log = new();
    }

    public sealed record Item(string Name, string Etag, long Length, DateTime Modified, string Component);

    public static string Root => Path.Combine(Settings.Dir, "calendars");
    static string DirOf(string id) => Path.Combine(Root, id);
    static string MetaPath(string id) => Path.Combine(DirOf(id), "calendar.json");
    static string ItemsDir(string id) => Path.Combine(DirOf(id), "items");

    // ---- Kalender ------------------------------------------------------------------------------------------------------------
    static Cal LoadMeta(string id)
    {
        var path = MetaPath(id);
        if (!File.Exists(path)) return null;
        var n = JsonNode.Parse(File.ReadAllText(path));
        var c = new Cal
        {
            Id = (string)n["id"] ?? id, Name = (string)n["name"], Color = (string)n["color"] ?? "#3a76be", Description = (string)n["description"] ?? "",
            Created = (string)n["created"], Seq = (long?)n["seq"] ?? 0, LogStart = (long?)n["logStart"] ?? 0,
        };
        if (n["rights"] is JsonObject r)
            foreach (var (user, right) in r) if ((string)right is Read or Write) c.Rights[user] = (string)right;
        if (n["log"] is JsonArray log)
            foreach (var e in log) c.Log.Add(((long)e[0], (string)e[1], (bool)e[2]));
        return c;
    }

    static void SaveMeta(Cal c)
    {
        Directory.CreateDirectory(DirOf(c.Id));
        var o = new JsonObject
        {
            ["id"] = c.Id, ["name"] = c.Name, ["color"] = c.Color, ["description"] = c.Description, ["created"] = c.Created,
            ["rights"] = new JsonObject(c.Rights.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode)kv.Value))),
            ["seq"] = c.Seq, ["logStart"] = c.LogStart,
            ["log"] = new JsonArray(c.Log.Select(e => (JsonNode)new JsonArray(e.Seq, e.Name, e.Deleted)).ToArray()),
        };
        var path = MetaPath(c.Id);
        File.WriteAllText(path + ".tmp", o.ToJsonString());
        File.Move(path + ".tmp", path, true);
    }

    public static List<Cal> List()
    {
        lock (Gate)
        {
            if (!Directory.Exists(Root)) return new();
            var list = new List<Cal>();
            foreach (var d in Directory.GetDirectories(Root))
            {
                try { if (LoadMeta(Path.GetFileName(d)) is Cal c) list.Add(c); }
                catch (Exception e) { Log.Write($"Kalender {Path.GetFileName(d)} unlesbar: {e.Message}"); }
            }
            return list.OrderBy(c => c.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
    }

    public static Cal Get(string id)
    {
        if (id == null || !Regex.IsMatch(id, "^c[0-9a-f]{8}$")) return null;
        lock (Gate) return LoadMeta(id);
    }

    /// <summary>Recht des Benutzers am Kalender: null, "read" oder "write".</summary>
    public static string RightOf(Cal c, string user) => c != null && user != null && c.Rights.TryGetValue(user, out var r) ? r : null;

    public static List<Cal> ForUser(string user) => List().Where(c => RightOf(c, user) != null).ToList();

    static string CheckName(string name)
    {
        name = name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 60) throw new ArgumentException(L.T("Name: 1–60 Zeichen", "Name: 1–60 characters"));
        return name;
    }

    static string CheckColor(string color) =>
        color == null || !Color.IsMatch(color) ? throw new ArgumentException(L.T("Farbe", "Colour")) : color.ToLowerInvariant();

    public static Cal Create(string name, string color)
    {
        name = CheckName(name);
        color = CheckColor(color ?? "#3a76be");
        lock (Gate)
        {
            if (List().Count >= MaxCalendars) throw new ArgumentException(L.T($"Höchstens {MaxCalendars} Kalender", $"At most {MaxCalendars} calendars"));
            string id;
            do id = "c" + Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant();
            while (Directory.Exists(DirOf(id)));
            var c = new Cal { Id = id, Name = name, Color = color, Description = "", Created = DateTime.Now.ToString("yyyy-MM-dd HH:mm") };
            Directory.CreateDirectory(ItemsDir(id));
            SaveMeta(c);
            return c;
        }
    }

    public static void Update(string id, string name, string color, JsonObject rights)
    {
        lock (Gate)
        {
            var c = Get(id) ?? throw new ArgumentException(L.T("Kalender unbekannt", "Unknown calendar"));
            if (name != null) c.Name = CheckName(name);
            if (color != null) c.Color = CheckColor(color);
            if (rights != null)
            {
                var known = Users.List().Select(u => u.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
                c.Rights.Clear();
                foreach (var (user, right) in rights)
                    if (known.Contains(user) && (string)right is Read or Write) c.Rights[user] = (string)right;
            }
            c.Seq++; // Name/Farbe geändert: Kalender holen die Eigenschaften neu
            SaveMeta(c);
        }
    }

    public static void Delete(string id)
    {
        lock (Gate)
        {
            if (Get(id) == null) throw new ArgumentException(L.T("Kalender unbekannt", "Unknown calendar"));
            Directory.Delete(DirOf(id), true);
        }
    }

    /// <summary>Benutzer gelöscht: seine Rechte entfernen.</summary>
    public static void RemoveUser(string user)
    {
        lock (Gate)
            foreach (var c in List())
                if (c.Rights.Remove(user)) SaveMeta(c);
    }

    // ---- Einträge ------------------------------------------------------------------------------------------------------------
    /// <summary>Dateiname aus der Adresse → Name auf der Platte (unübliche Zeichen hexadezimal).</summary>
    static string FileOf(string name) => SafeName.IsMatch(name) ? name : "_" + Convert.ToHexString(Encoding.UTF8.GetBytes(name)).ToLowerInvariant();

    static string NameOf(string file)
    {
        if (!file.StartsWith('_')) return file;
        try { return Encoding.UTF8.GetString(Convert.FromHexString(file[1..])); }
        catch { return file; }
    }

    public static bool ValidName(string name) => !string.IsNullOrEmpty(name) && name.Length <= 255 && name != "." && name != ".." && !name.Contains('/') && !name.Contains('\\');

    static string Etag(string path)
    {
        var fi = new FileInfo(path);
        lock (etags)
        {
            if (etags.TryGetValue(path, out var e) && e.Time == fi.LastWriteTimeUtc && e.Length == fi.Length) return e.Etag;
            var tag = "\"" + Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)))[..16].ToLowerInvariant() + "\"";
            etags[path] = (fi.LastWriteTimeUtc, fi.Length, tag);
            return tag;
        }
    }

    static string ComponentOf(string path)
    {
        // Nur der Anfang zählt: VTIMEZONE steht meist vor dem eigentlichen Eintrag
        foreach (var line in File.ReadLines(path))
        {
            if (line.StartsWith("BEGIN:VEVENT", StringComparison.OrdinalIgnoreCase)) return "VEVENT";
            if (line.StartsWith("BEGIN:VTODO", StringComparison.OrdinalIgnoreCase)) return "VTODO";
            if (line.StartsWith("BEGIN:VJOURNAL", StringComparison.OrdinalIgnoreCase)) return "VJOURNAL";
        }
        return "";
    }

    static Item ItemOf(string path)
    {
        var fi = new FileInfo(path);
        return new Item(NameOf(fi.Name), Etag(path), fi.Length, fi.LastWriteTimeUtc, ComponentOf(path));
    }

    public static List<Item> Items(string id)
    {
        lock (Gate)
        {
            var dir = ItemsDir(id);
            if (!Directory.Exists(dir)) return new();
            return Directory.GetFiles(dir).Where(f => !f.EndsWith(".tmp")).Select(ItemOf).ToList();
        }
    }

    public static int Count(string id)
    {
        lock (Gate)
        {
            var dir = ItemsDir(id);
            return Directory.Exists(dir) ? Directory.GetFiles(dir).Count(f => !f.EndsWith(".tmp")) : 0;
        }
    }

    public static Item Find(string id, string name)
    {
        lock (Gate)
        {
            var path = Path.Combine(ItemsDir(id), FileOf(name));
            return File.Exists(path) ? ItemOf(path) : null;
        }
    }

    public static byte[] Data(string id, string name)
    {
        lock (Gate)
        {
            var path = Path.Combine(ItemsDir(id), FileOf(name));
            return File.Exists(path) ? File.ReadAllBytes(path) : null;
        }
    }

    public sealed class PreconditionFailed : Exception { }
    public sealed class Full : Exception { }

    /// <summary>Eintrag speichern. ifMatch: ETag, den der Kalender kennt; ifNoneMatch "*": nur neu anlegen. Liefert (neu?, ETag).</summary>
    public static (bool Created, string Etag) Put(string id, string name, byte[] data, string ifMatch, string ifNoneMatch)
    {
        lock (Gate)
        {
            var c = Get(id) ?? throw new FileNotFoundException();
            var dir = ItemsDir(id);
            Directory.CreateDirectory(dir);
            var file = FileOf(name);
            var path = Path.Combine(dir, file);
            bool exists = File.Exists(path);
            if (ifNoneMatch == "*" && exists) throw new PreconditionFailed();
            if (ifMatch != null && (!exists || (ifMatch != "*" && ifMatch != Etag(path)))) throw new PreconditionFailed();
            if (!exists && Directory.GetFiles(dir).Length >= MaxItems) throw new Full();
            File.WriteAllBytes(path + ".tmp", data);
            File.Move(path + ".tmp", path, true);
            Logged(c, file, false);
            return (!exists, Etag(path));
        }
    }

    public static void Remove(string id, string name, string ifMatch)
    {
        lock (Gate)
        {
            var c = Get(id) ?? throw new FileNotFoundException();
            var file = FileOf(name);
            var path = Path.Combine(ItemsDir(id), file);
            if (!File.Exists(path)) throw new FileNotFoundException();
            if (ifMatch != null && ifMatch != "*" && ifMatch != Etag(path)) throw new PreconditionFailed();
            File.Delete(path);
            Logged(c, file, true);
        }
    }

    static void Logged(Cal c, string file, bool deleted)
    {
        c.Seq++;
        c.Log.RemoveAll(e => e.Name == file); // je Datei zählt nur die letzte Änderung
        c.Log.Add((c.Seq, file, deleted));
        if (c.Log.Count > MaxLog)
        {
            c.LogStart = c.Log[c.Log.Count - MaxLog - 1].Seq;
            c.Log.RemoveRange(0, c.Log.Count - MaxLog);
        }
        SaveMeta(c);
    }

    /// <summary>Änderungen seit seq (für sync-collection): Name und ob gelöscht; null, wenn seq zu alt oder unbekannt ist.</summary>
    public static List<(string Name, bool Deleted)> ChangesSince(Cal c, long seq)
    {
        if (seq > c.Seq || seq < c.LogStart) return null;
        // Das Protokoll hält je Datei nur die letzte Änderung; eine Datei, die vor seq geändert wurde, fehlt also nicht
        return c.Log.Where(e => e.Seq > seq).Select(e => (NameOf(e.Name), e.Deleted)).ToList();
    }

    /// <summary>Alles in eine .ics-Datei (Herunterladen, Abonnieren): Einträge hintereinander, Zeitzonen nur einmal.</summary>
    public static string Export(string id)
    {
        var sb = new StringBuilder("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//NovaBird//Helper//DE\r\n");
        var zones = new HashSet<string>();
        lock (Gate)
        {
            var dir = ItemsDir(id);
            if (Directory.Exists(dir))
                foreach (var f in Directory.GetFiles(dir).Where(f => !f.EndsWith(".tmp")))
                {
                    var lines = Unfold(File.ReadAllText(f));
                    for (int i = 0; i < lines.Count; i++)
                    {
                        var m = Regex.Match(lines[i], "^BEGIN:(VEVENT|VTODO|VJOURNAL|VTIMEZONE)$", RegexOptions.IgnoreCase);
                        if (!m.Success) continue;
                        var comp = m.Groups[1].Value.ToUpperInvariant();
                        int end = lines.FindIndex(i, l => l.Equals("END:" + comp, StringComparison.OrdinalIgnoreCase));
                        if (end < 0) break;
                        var block = lines.GetRange(i, end - i + 1);
                        var tzid = comp == "VTIMEZONE" ? block.FirstOrDefault(l => l.StartsWith("TZID", StringComparison.OrdinalIgnoreCase)) : null;
                        if (tzid == null || zones.Add(tzid))
                            foreach (var l in block) sb.Append(l).Append("\r\n");
                        i = end;
                    }
                }
        }
        return sb.Append("END:VCALENDAR\r\n").ToString();
    }

    // Zeilen ohne Faltung (RFC 5545 3.1); die gefalteten Fortsetzungen bleiben beim Export erhalten, daher hier nur zum Zuordnen
    static List<string> Unfold(string text) => text.Replace("\r\n", "\n").Split('\n').Where(l => l.Length > 0).ToList();

    /// <summary>Prüft, ob die Daten wie ein einzelner Kalendereintrag aussehen.</summary>
    public static string Problem(byte[] data)
    {
        if (data.Length == 0) return "leer";
        if (data.Length > MaxItemBytes) return "zu groß";
        var text = Encoding.UTF8.GetString(data).TrimStart('﻿', ' ', '\r', '\n', '\t');
        if (!text.StartsWith("BEGIN:VCALENDAR", StringComparison.OrdinalIgnoreCase)) return "kein iCalendar";
        if (!Regex.IsMatch(text, @"^BEGIN:(VEVENT|VTODO|VJOURNAL)\r?$", RegexOptions.IgnoreCase | RegexOptions.Multiline)) return "kein Termin und keine Aufgabe";
        if (!Regex.IsMatch(text, @"^UID[;:]", RegexOptions.IgnoreCase | RegexOptions.Multiline)) return "UID fehlt";
        return null;
    }

    // ---- Sicherung -----------------------------------------------------------------------------------------------------------
    /// <summary>Aktion mit gesperrter Ablage ausführen (Sicherung ersetzt den Ordner).</summary>
    public static void Locked(Action a)
    {
        lock (Gate)
        {
            a();
            lock (etags) etags.Clear();
        }
    }
}
