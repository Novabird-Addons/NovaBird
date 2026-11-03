// Gruppen (Netz-Modus): Jede Gruppe hat einen eigenen Kopplungscode und einen eigenen Vektorspeicher. PCs mit Code 1 und PCs
// mit Code 2 teilen sich so die Grafikkarte, aber keine Daten. groups.json im Datenordner:
//   [{id, name, code (DPAPI), salt (DPAPI, Grundlage der Vektor-Schlüssel), created}]
//  - Umstellung: Der bisherige einzelne Code (settings.json netCode) wird zur Gruppe „Standard“ – gekoppelte PCs laufen weiter.
//  - Höchstens 20 Gruppen; die letzte Gruppe kann nicht gelöscht werden.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class Groups
{
    public const int Max = 20;
    public sealed record Group(string Id, string Name, string Code, byte[] Salt, string Created);

    static readonly object Gate = new();
    static List<Group> cache;
    static string FilePath => Path.Combine(Settings.Dir, "groups.json");

    public static List<Group> List()
    {
        lock (Gate) return new List<Group>(Load());
    }

    public static Group Get(string id) => List().FirstOrDefault(g => g.Id == id);

    static List<Group> Load()
    {
        if (cache != null) return cache;
        try
        {
            if (File.Exists(FilePath))
                cache = JsonNode.Parse(File.ReadAllText(FilePath)).AsArray().Select(n => new Group(
                    (string)n["id"], (string)n["name"], Encoding.UTF8.GetString(Settings.Unprotect((string)n["code"])),
                    Settings.Unprotect((string)n["salt"]), (string)n["created"])).ToList();
        }
        catch (Exception e) { Log.Write("groups.json unlesbar: " + e.Message); }
        if (cache is { Count: > 0 }) return cache;
        // Erster Start mit Gruppen: bisherigen Code übernehmen (sonst neuen erzeugen)
        var s = Settings.Load();
        string code = null;
        try { if (s["netCode"] is JsonNode n) code = Encoding.UTF8.GetString(Settings.Unprotect((string)n)); }
        catch (Exception e) { Log.Write("Kopplungscode unlesbar, erzeuge neuen: " + e.Message); }
        cache = new() { New("g1", L.T("Standard", "Default"), code ?? PairCode.New()) };
        Save();
        if (s.Remove("netCode") | s.Remove("vecSalt")) Settings.Save(s);
        Log.Write("Gruppen: Kopplungscode als Gruppe „Standard“ übernommen");
        return cache;
    }

    static Group New(string id, string name, string code) =>
        new(id, name, code, RandomNumberGenerator.GetBytes(32), DateTime.Now.ToString("yyyy-MM-dd HH:mm"));

    static void Save()
    {
        Directory.CreateDirectory(Settings.Dir);
        File.WriteAllText(FilePath + ".tmp", ToJson(cache, plain: false).ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        File.Move(FilePath + ".tmp", FilePath, true);
    }

    /// <summary>Als JSON; plain = Code und Salz unverschlüsselt (nur für die Sicherung und die Übergabe an den Dienst).</summary>
    static JsonArray ToJson(IEnumerable<Group> list, bool plain, bool machine = false) => new(list.Select(g => (JsonNode)new JsonObject
    {
        ["id"] = g.Id, ["name"] = g.Name, ["created"] = g.Created,
        ["code"] = plain ? g.Code : Settings.Protect(Encoding.UTF8.GetBytes(g.Code), machine || Settings.ServiceMode),
        ["salt"] = plain ? Convert.ToBase64String(g.Salt) : Settings.Protect(g.Salt, machine || Settings.ServiceMode),
    }).ToArray());

    public static JsonArray ExportPlain() => ToJson(List(), plain: true);

    /// <summary>Gruppen aus einer Sicherung oder der Übergabe an den Dienst übernehmen (ersetzt alle).</summary>
    public static void ImportPlain(JsonArray arr, string dir = null, bool machine = false)
    {
        var list = arr.Select(n => new Group((string)n["id"], (string)n["name"], (string)n["code"], Convert.FromBase64String((string)n["salt"]), (string)n["created"])).ToList();
        if (list.Count == 0 || list.Any(g => string.IsNullOrEmpty(g.Id) || string.IsNullOrEmpty(g.Code) || g.Salt.Length != 32)) throw new InvalidDataException("groups");
        var json = ToJson(list, plain: false, machine).ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true });
        if (dir != null)
        {
            File.WriteAllText(Path.Combine(dir, "groups.json"), json); // Dienst-Ordner (Übergabe)
            return;
        }
        lock (Gate)
        {
            cache = list;
            Save();
        }
    }

    public static string CheckName(string name)
    {
        name = name?.Trim();
        if (string.IsNullOrEmpty(name) || name.Length > 40) throw new ArgumentException(L.T("Name: 1–40 Zeichen", "Name: 1–40 characters"));
        return name;
    }

    public static Group Add(string name)
    {
        name = CheckName(name);
        lock (Gate)
        {
            var list = Load();
            if (list.Count >= Max) throw new ArgumentException(L.T($"Höchstens {Max} Gruppen", $"At most {Max} groups"));
            if (list.Any(g => string.Equals(g.Name, name, StringComparison.OrdinalIgnoreCase))) throw new ArgumentException(L.T("Name schon vergeben", "Name already taken"));
            int n = 1;
            while (list.Any(g => g.Id == "g" + n)) n++;
            var g = New("g" + n, name, PairCode.New());
            list.Add(g);
            Save();
            return g;
        }
    }

    public static void Rename(string id, string name)
    {
        name = CheckName(name);
        Change(id, g => g with { Name = name });
    }

    public static string Renew(string id)
    {
        var code = PairCode.New();
        Change(id, g => g with { Code = code });
        return code;
    }

    static void Change(string id, Func<Group, Group> f)
    {
        lock (Gate)
        {
            var list = Load();
            int i = list.FindIndex(g => g.Id == id);
            if (i < 0) throw new ArgumentException(L.T("Gruppe unbekannt", "Unknown group"));
            list[i] = f(list[i]);
            Save();
        }
    }

    public static void Remove(string id)
    {
        lock (Gate)
        {
            var list = Load();
            if (list.Count <= 1) throw new ArgumentException(L.T("Die letzte Gruppe bleibt", "The last group stays"));
            if (list.RemoveAll(g => g.Id == id) == 0) throw new ArgumentException(L.T("Gruppe unbekannt", "Unknown group"));
            Save();
        }
    }
}
