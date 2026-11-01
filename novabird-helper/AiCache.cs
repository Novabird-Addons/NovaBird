// KI-Ergebnisse teilen (Netz-Modus): Haben mehrere PCs dasselbe Postfach, bereitet nur einer eine neue Mail vor (Überblick,
// Fristen, Zusammenfassung); die anderen holen das Ergebnis hier ab, statt selbst zu rechnen.
//  - Thunderbird bildet die Kennung selbst (SHA-256 aus Message-ID, Prüfsumme des Textes, Art, Sprache) und verschlüsselt das
//    Ergebnis vorher mit einem Schlüssel aus Message-ID und Prüfsumme. Hier liegen nur Kennung und Chiffrat: lesen kann es nur,
//    wer die Mail selbst hat.
//  - Anmelden statt doppelt rechnen: Wer mit claim fragt und nichts findet, bekommt „claimed“ und rechnet; wer danach fragt,
//    bekommt „pending“ und fragt später wieder. Eine Anmeldung gilt 3 Minuten (rechnet der PC nicht fertig, darf ein anderer).
//  - Je Gruppe eine Datei vectors\<gruppe>\ai.json (fällt mit der Gruppe weg), Einträge höchstens 10 Tage, höchstens 20.000.
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

sealed class AiCache : IDisposable
{
    public const int MaxData = 48 * 1024, MaxIds = 200;
    static readonly TimeSpan Keep = TimeSpan.FromDays(10), ClaimFor = TimeSpan.FromMinutes(3);
    const int MaxEntries = 20_000;
    static readonly Regex IdRe = new("^[A-Za-z0-9_-]{20,64}$");

    readonly string path;
    readonly object gate = new();
    readonly Dictionary<string, (string Data, DateTime At)> items = new();
    readonly Dictionary<string, (string Client, DateTime Until)> claims = new();
    readonly System.Threading.Timer saver;
    bool dirty;

    public AiCache(string groupId)
    {
        path = Path.Combine(VectorStore.FolderOf(groupId), "ai.json");
        try
        {
            if (File.Exists(path) && JsonNode.Parse(File.ReadAllText(path)) is JsonObject o)
                foreach (var (id, v) in o)
                    if (v is JsonArray a && a.Count == 2 && IdRe.IsMatch(id))
                        items[id] = ((string)a[0], DateTimeOffset.FromUnixTimeSeconds((long)a[1]).UtcDateTime);
        }
        catch (Exception e) { Log.Write("KI-Ablage nicht lesbar: " + e.Message); }
        saver = new System.Threading.Timer(_ => Save(), null, 30_000, 30_000);
    }

    public static bool ValidId(string id) => id != null && IdRe.IsMatch(id);

    public int Count { get { lock (gate) return items.Count; } }

    /// <summary>Je Kennung: {data} (vorhanden), {pending} (ein anderer PC rechnet), {claimed} (dieser PC soll rechnen) oder {}.</summary>
    public JsonObject Get(IEnumerable<string> ids, string client, bool claim)
    {
        var now = DateTime.UtcNow;
        var res = new JsonObject();
        lock (gate)
        {
            foreach (var id in ids.Where(ValidId).Distinct())
            {
                if (items.TryGetValue(id, out var it) && now - it.At < Keep)
                    res[id] = new JsonObject { ["data"] = it.Data };
                else if (claims.TryGetValue(id, out var c) && c.Until > now && c.Client != client)
                    res[id] = new JsonObject { ["pending"] = true };
                else if (claim)
                {
                    claims[id] = (client, now + ClaimFor);
                    res[id] = new JsonObject { ["claimed"] = true };
                }
                else res[id] = new JsonObject();
            }
        }
        return res;
    }

    public void Put(string id, string data)
    {
        if (!ValidId(id) || string.IsNullOrEmpty(data) || data.Length > MaxData) throw new InvalidOperationException("Eintrag ungültig");
        lock (gate)
        {
            items[id] = (data, DateTime.UtcNow);
            claims.Remove(id);
            dirty = true;
            if (items.Count > MaxEntries) Prune();
        }
    }

    /// <summary>Anmeldung zurückgeben (Rechnen fehlgeschlagen): ein anderer PC darf sofort.</summary>
    public void Release(string id, string client)
    {
        lock (gate)
            if (claims.TryGetValue(id ?? "", out var c) && c.Client == client) claims.Remove(id);
    }

    void Prune()
    {
        var now = DateTime.UtcNow;
        foreach (var id in items.Where(kv => now - kv.Value.At >= Keep).Select(kv => kv.Key).ToList()) items.Remove(id);
        if (items.Count > MaxEntries)
            foreach (var id in items.OrderBy(kv => kv.Value.At).Take(items.Count - MaxEntries).Select(kv => kv.Key).ToList()) items.Remove(id);
        foreach (var id in claims.Where(kv => kv.Value.Until <= now).Select(kv => kv.Key).ToList()) claims.Remove(id);
        dirty = true;
    }

    public void Save()
    {
        JsonObject o;
        lock (gate)
        {
            if (!dirty) return;
            Prune();
            o = new JsonObject();
            foreach (var (id, v) in items) o[id] = new JsonArray(v.Data, new DateTimeOffset(v.At).ToUnixTimeSeconds());
            dirty = false;
        }
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            var tmp = path + ".tmp";
            File.WriteAllText(tmp, o.ToJsonString());
            File.Move(tmp, path, true);
        }
        catch (Exception e) { Log.Write("KI-Ablage nicht gespeichert: " + e.Message); }
    }

    /// <summary>Gruppe gelöscht: nichts mehr schreiben.</summary>
    public void Drop()
    {
        saver.Dispose();
        lock (gate) { items.Clear(); dirty = false; }
    }

    public void Dispose()
    {
        saver.Dispose();
        Save();
    }
}
