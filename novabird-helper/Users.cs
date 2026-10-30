// Benutzer der Web-Oberfläche (eigene Konten, keine Windows-Benutzer): users.json im Datenordner.
// Passwort: PBKDF2-SHA256 mit 600.000 Runden und eigenem Salz je Benutzer. Rollen: "admin" (alles) und "viewer" (nur lesen,
// ohne Kopplungscode). Der letzte Admin kann weder gelöscht noch herabgestuft werden.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

static class Users
{
    public const string Admin = "admin", Viewer = "viewer";
    const int Iterations = 600_000;
    static readonly Regex NameRule = new("^[A-Za-z0-9._@-]{2,40}$");
    static readonly object Gate = new();
    static string FilePath => Path.Combine(Settings.Dir, "users.json");

    public sealed record User(string Name, string Role, string Salt, string Hash, int Iterations, string Created);

    static List<User> Load()
    {
        try
        {
            if (!File.Exists(FilePath)) return new();
            return JsonNode.Parse(File.ReadAllText(FilePath)).AsArray().Select(n => new User(
                (string)n["name"], (string)n["role"], (string)n["salt"], (string)n["hash"], (int?)n["iterations"] ?? Iterations, (string)n["created"])).ToList();
        }
        catch (Exception e)
        {
            Log.Write("users.json unlesbar: " + e.Message);
            return new();
        }
    }

    static void Save(List<User> users)
    {
        Directory.CreateDirectory(Settings.Dir);
        var arr = new JsonArray(users.Select(u => (JsonNode)new JsonObject
        {
            ["name"] = u.Name, ["role"] = u.Role, ["salt"] = u.Salt, ["hash"] = u.Hash, ["iterations"] = u.Iterations, ["created"] = u.Created,
        }).ToArray());
        File.WriteAllText(FilePath + ".tmp", arr.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        File.Move(FilePath + ".tmp", FilePath, true);
    }

    public static bool Any() { lock (Gate) return Load().Count > 0; }

    public static List<(string Name, string Role, string Created)> List()
    {
        lock (Gate) return Load().Select(u => (u.Name, u.Role, u.Created)).ToList();
    }

    static string HashOf(string password, byte[] salt, int iterations) =>
        Convert.ToBase64String(Rfc2898DeriveBytes.Pbkdf2(Encoding.UTF8.GetBytes(password), salt, iterations, HashAlgorithmName.SHA256, 32));

    /// <summary>Warum ein Passwort nicht taugt (null = taugt).</summary>
    public static string PasswordProblem(string pw) =>
        pw == null || pw.Length < 10 ? L.T("Passwort: mindestens 10 Zeichen", "Password: at least 10 characters") : pw.Length > 200 ? L.T("Passwort zu lang", "Password too long") : null;

    public static void Add(string name, string password, string role)
    {
        if (name == null || !NameRule.IsMatch(name)) throw new ArgumentException(L.T("Name: 2–40 Zeichen, Buchstaben, Ziffern und . _ @ -", "Name: 2–40 characters, letters, digits and . _ @ -"));
        if (role != Admin && role != Viewer) throw new ArgumentException(L.T("Rolle", "Role"));
        if (PasswordProblem(password) is string p) throw new ArgumentException(p);
        lock (Gate)
        {
            var users = Load();
            if (users.Any(u => string.Equals(u.Name, name, StringComparison.OrdinalIgnoreCase))) throw new ArgumentException(L.T("Name schon vergeben", "Name already taken"));
            var salt = RandomNumberGenerator.GetBytes(16);
            users.Add(new User(name, role, Convert.ToBase64String(salt), HashOf(password, salt, Iterations), Iterations, DateTime.Now.ToString("yyyy-MM-dd HH:mm")));
            Save(users);
        }
        Log.Write($"Web: Benutzer {name} angelegt ({role})");
    }

    // Für unbekannte Namen trotzdem rechnen, damit die Antwortzeit nichts verrät
    static readonly byte[] DummySalt = RandomNumberGenerator.GetBytes(16);

    /// <summary>Prüft Name und Passwort; liefert die Rolle oder null.</summary>
    public static (string Name, string Role)? Check(string name, string password)
    {
        User u;
        lock (Gate) u = Load().FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase));
        if (u == null || password == null)
        {
            HashOf(password ?? "", DummySalt, Iterations);
            return null;
        }
        var hash = Convert.FromBase64String(HashOf(password, Convert.FromBase64String(u.Salt), u.Iterations));
        return CryptographicOperations.FixedTimeEquals(hash, Convert.FromBase64String(u.Hash)) ? (u.Name, u.Role) : null;
    }

    public static void SetPassword(string name, string password)
    {
        if (PasswordProblem(password) is string p) throw new ArgumentException(p);
        lock (Gate)
        {
            var users = Load();
            int i = users.FindIndex(u => string.Equals(u.Name, name, StringComparison.OrdinalIgnoreCase));
            if (i < 0) throw new ArgumentException(L.T("Benutzer unbekannt", "Unknown user"));
            var salt = RandomNumberGenerator.GetBytes(16);
            users[i] = users[i] with { Salt = Convert.ToBase64String(salt), Hash = HashOf(password, salt, Iterations), Iterations = Iterations };
            Save(users);
        }
        Log.Write($"Web: Passwort von {name} geändert");
    }

    public static void SetRole(string name, string role)
    {
        if (role != Admin && role != Viewer) throw new ArgumentException(L.T("Rolle", "Role"));
        lock (Gate)
        {
            var users = Load();
            int i = users.FindIndex(u => string.Equals(u.Name, name, StringComparison.OrdinalIgnoreCase));
            if (i < 0) throw new ArgumentException(L.T("Benutzer unbekannt", "Unknown user"));
            if (users[i].Role == Admin && role != Admin && users.Count(u => u.Role == Admin) == 1) throw new ArgumentException(L.T("Der letzte Admin bleibt Admin", "The last admin stays admin"));
            users[i] = users[i] with { Role = role };
            Save(users);
        }
        Log.Write($"Web: Rolle von {name} → {role}");
    }

    public static void Remove(string name)
    {
        lock (Gate)
        {
            var users = Load();
            var u = users.FirstOrDefault(x => string.Equals(x.Name, name, StringComparison.OrdinalIgnoreCase)) ?? throw new ArgumentException(L.T("Benutzer unbekannt", "Unknown user"));
            if (u.Role == Admin && users.Count(x => x.Role == Admin) == 1) throw new ArgumentException(L.T("Der letzte Admin kann nicht gelöscht werden", "The last admin cannot be deleted"));
            users.Remove(u);
            Save(users);
        }
        Log.Write($"Web: Benutzer {name} gelöscht");
    }
}
