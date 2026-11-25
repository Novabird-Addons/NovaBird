// Geteilte Adressbücher: Ein PC (Besitzer) bietet ein eigenes Thunderbird-Adressbuch an, der Helper hält die gemeinsame Fassung,
// andere PCs derselben Gruppe gleichen eine lokale Kopie damit ab. Alles über den gekoppelten, verschlüsselten Weg (NetServer, ops
// ab*); keine Anmeldung, die Web-Oberfläche muss dafür nicht im Netz erreichbar sein.
//  - Freigabe je Adressbuch: alle PCs der Gruppe ("group") oder ausgewählte PCs ("pcs"); write = die anderen dürfen ändern
//    (sonst nur lesen). Ein PC sieht nie sein eigenes Adressbuch als Angebot.
//  - Abgleich in beide Richtungen (Besitzer und andere gleich): jeder PC vergleicht drei Stände (zuletzt abgeglichen, lokal, hier).
//    Schreiben ist bedingt: put/del tragen den ETag, den der PC zuletzt gesehen hat ("" = darf es noch nicht geben). Hat ein
//    anderer PC den Kontakt inzwischen geändert, wird nur dieser Kontakt abgelehnt (conflicts) – der PC holt dann die neue Fassung.
//  - PC-Schlüssel: Die Kennung eines PCs (Feld c) ist nicht geheim. Damit kein PC der Gruppe sich als ein anderer ausgibt, bekommt
//    jeder PC beim ersten Aufruf einen eigenen Schlüssel (verschlüsselt übertragen, gespeichert nur als SHA-256) und schickt ihn bei
//    jedem Aufruf mit. Bringt ein PC einen Schlüssel mit, den der Helper nicht kennt (Helper neu eingerichtet), gilt dieser.
//    Wird der PC unter „PCs“ entfernt, sind auch Schlüssel und Adressbücher weg.
//  - Ablage im Datenordner unter addressbooks\ (kommt so in die Sicherung):
//      pckeys.json               {PC: {hash, group}}
//      <id>\book.json            {id, group, owner, tb, name, access, pcs, write, created, updated, seq}
//      <id>\index.json           {UID: ETag}
//      <id>\cards\<Name>.vcf     vCard so, wie Thunderbird sie geschickt hat; Name = SHA-256 der UID
//  - ETag = die ersten 16 Hex-Zeichen von SHA-256 des Inhalts (Thunderbird rechnet genauso und vergleicht so den Stand).
//    seq zählt jede Änderung: unverändertes seq = nichts zu holen.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

static class AddressBooks
{
    public const string Group = "group", Pcs = "pcs";
    public const int MaxCardBytes = 256 << 10, MaxCards = 20_000, MaxBooksPerPc = 20, MaxBooks = 200, MaxReplyBytes = 4 << 20, MaxBatch = 1000;
    static readonly object Gate = new();
    static readonly Regex SafeId = new("^[0-9a-f]{16}$");
    static readonly Regex ClientId = new("^[A-Za-z0-9_-]{8,64}$");

    public sealed class Book
    {
        public string Id, GroupId, Owner, Tb, Name, Access = Group, Created, Updated;
        public List<string> Pcs = new();
        public bool Write; // die anderen dürfen ändern
        public long Seq;
        public Dictionary<string, string> Index = new(StringComparer.Ordinal); // UID -> ETag
    }

    sealed class PcKey { public string Hash, Group; }

    public sealed class KeyProblem : Exception
    {
        public KeyProblem() : base("pckey") { }
    }

    public static string Root => Path.Combine(Settings.Dir, "addressbooks");
    static string KeysPath => Path.Combine(Root, "pckeys.json");
    static string DirOf(string id) => Path.Combine(Root, id);
    static string CardsDir(string id) => Path.Combine(DirOf(id), "cards");
    static string CardPath(string id, string uid) => Path.Combine(CardsDir(id), Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(uid))).ToLowerInvariant()[..40] + ".vcf");

    static Dictionary<string, Book> books;
    static Dictionary<string, PcKey> keys;

    public static string Etag(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant()[..16];

    /// <summary>Für die Sicherung: alles unter Root ruht, während die Aktion läuft; danach neu einlesen.</summary>
    public static void Locked(Action a)
    {
        lock (Gate)
        {
            try { a(); }
            finally { books = null; keys = null; }
        }
    }

    // ---- Laden und Speichern -------------------------------------------------------------------------------------------------
    static void Load()
    {
        if (books != null) return;
        books = new();
        keys = new();
        try
        {
            if (File.Exists(KeysPath))
                foreach (var (pc, v) in JsonNode.Parse(File.ReadAllText(KeysPath)).AsObject())
                    if (v?["hash"] is JsonNode h) keys[pc] = new PcKey { Hash = (string)h, Group = (string)v["group"] };
        }
        catch (Exception e) { Log.Write("Adressbücher: pckeys.json unlesbar: " + e.Message); }
        if (!Directory.Exists(Root)) return;
        foreach (var dir in Directory.GetDirectories(Root))
        {
            var id = Path.GetFileName(dir);
            if (!SafeId.IsMatch(id)) continue;
            try
            {
                var n = JsonNode.Parse(File.ReadAllText(Path.Combine(dir, "book.json")));
                var b = new Book
                {
                    Id = id, GroupId = (string)n["group"], Owner = (string)n["owner"], Tb = (string)n["tb"] ?? "", Name = (string)n["name"] ?? "",
                    Access = (string)n["access"] == Pcs ? Pcs : Group, Created = (string)n["created"], Updated = (string)n["updated"], Seq = (long?)n["seq"] ?? 0,
                    Write = (bool?)n["write"] ?? false,
                };
                if (n["pcs"] is JsonArray pcs) b.Pcs = pcs.Select(p => (string)p).Where(p => p != null && ClientId.IsMatch(p)).Distinct().ToList();
                var indexPath = Path.Combine(dir, "index.json");
                if (File.Exists(indexPath))
                    foreach (var (uid, etag) in JsonNode.Parse(File.ReadAllText(indexPath)).AsObject()) b.Index[uid] = (string)etag;
                books[id] = b;
            }
            catch (Exception e) { Log.Write($"Adressbuch {id} unlesbar: {e.Message}"); }
        }
    }

    static void Write(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path));
        File.WriteAllText(path + ".tmp", text);
        File.Move(path + ".tmp", path, true);
    }

    static void SaveKeys() => Write(KeysPath, new JsonObject(keys.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode)new JsonObject { ["hash"] = kv.Value.Hash, ["group"] = kv.Value.Group }))).ToJsonString());

    static void SaveMeta(Book b) => Write(Path.Combine(DirOf(b.Id), "book.json"), new JsonObject
    {
        ["id"] = b.Id, ["group"] = b.GroupId, ["owner"] = b.Owner, ["tb"] = b.Tb, ["name"] = b.Name, ["access"] = b.Access,
        ["pcs"] = new JsonArray(b.Pcs.Select(p => (JsonNode)p).ToArray()), ["write"] = b.Write, ["created"] = b.Created, ["updated"] = b.Updated, ["seq"] = b.Seq,
    }.ToJsonString());

    static void SaveIndex(Book b) => Write(Path.Combine(DirOf(b.Id), "index.json"), new JsonObject(b.Index.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode)kv.Value))).ToJsonString());

    // ---- PC-Schlüssel ----------------------------------------------------------------------------------------------------------
    static string HashKey(string key) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes("nbab1|" + key))).ToLowerInvariant();

    /// <summary>PC prüfen; liefert einen neuen Schlüssel, wenn der PC noch keinen hat und keinen mitbringt (sonst null).</summary>
    static string Authorize(string client, string group, string key)
    {
        if (!string.IsNullOrEmpty(key) && (key.Length < 32 || key.Length > 100)) throw new KeyProblem();
        if (keys.TryGetValue(client, out var known))
        {
            if (string.IsNullOrEmpty(key) || !CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(known.Hash), Encoding.ASCII.GetBytes(HashKey(key)))) throw new KeyProblem();
            if (known.Group != group) { known.Group = group; SaveKeys(); }
            return null;
        }
        string issued = null;
        if (string.IsNullOrEmpty(key)) key = issued = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        keys[client] = new PcKey { Hash = HashKey(key), Group = group };
        SaveKeys();
        return issued;
    }

    // ---- Rechte ----------------------------------------------------------------------------------------------------------------
    static bool Offered(Book b, string client, string group) =>
        b.Owner != client && b.GroupId == group && (b.Access == Group || b.Pcs.Contains(client));

    static Book Own(string id, string client, string group)
    {
        if (id == null || !books.TryGetValue(id, out var b) || b.Owner != client || b.GroupId != group) throw new InvalidOperationException("book");
        return b;
    }

    // Besitzer oder (angeboten und die anderen dürfen ändern)
    static Book Writable(string id, string client, string group)
    {
        if (id == null || !books.TryGetValue(id, out var b)) throw new InvalidOperationException("book");
        if (b.Owner == client && b.GroupId == group) return b;
        if (Offered(b, client, group)) return b.Write ? b : throw new InvalidOperationException("readonly");
        throw new InvalidOperationException("book");
    }

    static Book Readable(string id, string client, string group)
    {
        if (id == null || !books.TryGetValue(id, out var b) || (b.Owner != client || b.GroupId != group) && !Offered(b, client, group)) throw new InvalidOperationException("book");
        return b;
    }

    // ---- Befehle über den gekoppelten Weg ------------------------------------------------------------------------------------
    /// <summary>op abInfo, abPublish, abUnpublish, abState, abPut, abGet. labels: PC-Kennung -> Name und Gruppe (Liste des Helpers).</summary>
    public static JsonObject Handle(string op, JsonNode msg, string client, string group, IReadOnlyList<Scheduler.ClientInfo> pcs, Action touch = null)
    {
        lock (Gate)
        {
            Load();
            var issued = Authorize(client, group, (string)msg["pcKey"]);
            touch?.Invoke(); // Name des PCs erst nach geprüftem Schlüssel übernehmen
            var reply = op switch
            {
                "abInfo" => Info(client, group, pcs),
                "abPublish" => Summary(Publish(msg, client, group), pcs, true),
                "abUnpublish" => Unpublish(msg, client, group),
                "abState" => State(Readable((string)msg["id"], client, group)),
                "abPut" => Put(Writable((string)msg["id"], client, group), msg),
                "abGet" => Get(Readable((string)msg["id"], client, group), msg),
                _ => throw new InvalidOperationException("unbekannter Befehl"),
            };
            if (issued != null) reply["pcKey"] = issued;
            return reply;
        }
    }

    static string LabelOf(string pc, IReadOnlyList<Scheduler.ClientInfo> pcs) => pcs.FirstOrDefault(p => p.Id == pc)?.Label is { Length: > 0 } l ? l : pc;

    static JsonObject Summary(Book b, IReadOnlyList<Scheduler.ClientInfo> pcs, bool own)
    {
        var o = new JsonObject
        {
            ["id"] = b.Id, ["name"] = b.Name, ["owner"] = LabelOf(b.Owner, pcs), ["count"] = b.Index.Count, ["seq"] = b.Seq, ["updated"] = b.Updated,
            ["write"] = b.Write,
        };
        if (own)
        {
            o["tb"] = b.Tb;
            o["access"] = b.Access;
            o["pcs"] = new JsonArray(b.Pcs.Select(p => (JsonNode)p).ToArray());
        }
        return o;
    }

    static JsonObject Info(string client, string group, IReadOnlyList<Scheduler.ClientInfo> pcs) => new()
    {
        ["group"] = group, // Thunderbird bindet seine Freigaben an Helper und Gruppe
        // andere PCs dieser Gruppe zur Auswahl, nur mit eigenem Schlüssel (PCs aus der Zeit vor den Gruppen zählen zu g1)
        ["pcs"] = new JsonArray(pcs.Where(p => p.Id != client && (p.Group ?? "g1") == group && keys.ContainsKey(p.Id)).OrderBy(p => p.Label, StringComparer.CurrentCultureIgnoreCase)
            .Select(p => (JsonNode)new JsonObject { ["id"] = p.Id, ["label"] = string.IsNullOrEmpty(p.Label) ? p.Id : p.Label }).ToArray()),
        ["own"] = new JsonArray(books.Values.Where(b => b.Owner == client && b.GroupId == group).Select(b => (JsonNode)Summary(b, pcs, true)).ToArray()),
        ["offered"] = new JsonArray(books.Values.Where(b => Offered(b, client, group)).OrderBy(b => b.Name, StringComparer.CurrentCultureIgnoreCase)
            .Select(b => (JsonNode)Summary(b, pcs, false)).ToArray()),
        ["limits"] = new JsonObject { ["cardBytes"] = MaxCardBytes, ["cards"] = MaxCards, ["batch"] = MaxBatch, ["bytes"] = MaxReplyBytes },
    };

    static string CleanName(string name)
    {
        name = Regex.Replace((name ?? "").Trim(), @"[\u0000-\u001f\u007f]", "");
        if (name.Length == 0) throw new InvalidOperationException("name");
        return name.Length > 120 ? name[..120] : name;
    }

    static Book Publish(JsonNode msg, string client, string group)
    {
        var tb = (string)msg["tb"] ?? "";
        if (tb.Length == 0 || tb.Length > 200) throw new InvalidOperationException("tb");
        var name = CleanName((string)msg["name"]);
        var access = (string)msg["access"] == Pcs ? Pcs : Group;
        var write = (bool?)msg["write"] ?? false;
        var chosen = (msg["pcs"] as JsonArray)?.Select(p => (string)p).Where(p => p != null && ClientId.IsMatch(p) && p != client).Distinct().Take(500).ToList() ?? new();
        var b = books.Values.FirstOrDefault(x => x.Owner == client && x.GroupId == group && x.Tb == tb);
        var now = DateTime.UtcNow.ToString("o");
        if (b == null)
        {
            if (books.Values.Count(x => x.Owner == client) >= MaxBooksPerPc || books.Count >= MaxBooks) throw new InvalidOperationException("full");
            string id;
            do id = Convert.ToHexString(RandomNumberGenerator.GetBytes(8)).ToLowerInvariant(); while (books.ContainsKey(id));
            b = new Book { Id = id, GroupId = group, Owner = client, Tb = tb, Created = now, Updated = now };
            Directory.CreateDirectory(CardsDir(id));
            books[id] = b;
            SaveIndex(b);
            Log.Write($"Adressbuch „{name}“ wird geteilt");
        }
        if (b.Name != name || b.Access != access || !b.Pcs.SequenceEqual(chosen) || b.Write != write)
        {
            b.Name = name;
            b.Access = access;
            b.Pcs = chosen;
            b.Write = write;
            b.Seq++; // Name oder Freigabe geändert: PCs holen den neuen Namen
            b.Updated = now;
        }
        SaveMeta(b);
        return b;
    }

    static JsonObject Unpublish(JsonNode msg, string client, string group)
    {
        var b = Own((string)msg["id"], client, group);
        Delete(b.Id);
        return new JsonObject();
    }

    static JsonObject State(Book b) => new()
    {
        ["seq"] = b.Seq, ["name"] = b.Name,
        ["cards"] = new JsonObject(b.Index.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode)kv.Value))),
    };

    static bool ValidUid(string uid) => !string.IsNullOrEmpty(uid) && uid.Length <= 200 && !uid.Any(char.IsControl);

    // Bedingung eines Eintrags: fehlt base, gilt er immer; "" = Kontakt darf es noch nicht geben; sonst muss der ETag passen
    static bool Matches(Book b, string uid, JsonNode baseNode)
    {
        if (baseNode == null) return true;
        var want = (string)baseNode ?? "";
        return b.Index.TryGetValue(uid, out var cur) ? cur == want : want == "";
    }

    static JsonObject Put(Book b, JsonNode msg)
    {
        var put = msg["put"] as JsonArray ?? new JsonArray();
        var del = msg["del"] as JsonArray ?? new JsonArray();
        if (put.Count + del.Count > MaxBatch) throw new InvalidOperationException("batch");
        // erst alles prüfen, dann schreiben
        var items = new List<(string Uid, byte[] Data, JsonNode Base)>();
        foreach (var p in put)
        {
            var uid = (string)p?["uid"];
            var vcard = (string)p?["vcard"] ?? "";
            if (!ValidUid(uid)) throw new InvalidOperationException("uid");
            var data = Encoding.UTF8.GetBytes(vcard);
            if (data.Length > MaxCardBytes) throw new InvalidOperationException("size");
            if (!vcard.TrimStart().StartsWith("BEGIN:VCARD", StringComparison.OrdinalIgnoreCase) || !vcard.TrimEnd().EndsWith("END:VCARD", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("vcard");
            items.Add((uid, data, p.AsObject().ContainsKey("base") ? p["base"] ?? JsonValue.Create("") : null));
        }
        // del: UID (immer) oder {uid, base}
        var gone = new List<(string Uid, JsonNode Base)>();
        foreach (var d in del)
        {
            if (d is JsonObject o) { if (ValidUid((string)o["uid"])) gone.Add(((string)o["uid"], o.ContainsKey("base") ? o["base"] ?? JsonValue.Create("") : null)); }
            else if (ValidUid((string)d)) gone.Add(((string)d, null));
        }
        var conflicts = new JsonArray();
        items = items.Where(i => Matches(b, i.Uid, i.Base) || Reject(conflicts, i.Uid)).ToList();
        gone = gone.Where(g => Matches(b, g.Uid, g.Base) || Reject(conflicts, g.Uid)).ToList();
        int after = b.Index.Count + items.Count(i => !b.Index.ContainsKey(i.Uid)) - gone.Count(g => b.Index.ContainsKey(g.Uid) && !items.Any(i => i.Uid == g.Uid));
        if (after > MaxCards) throw new InvalidOperationException("full");
        int changed = 0;
        foreach (var (uid, data, _) in items)
        {
            var etag = Etag(data);
            if (b.Index.TryGetValue(uid, out var old) && old == etag) continue;
            var path = CardPath(b.Id, uid);
            Directory.CreateDirectory(Path.GetDirectoryName(path));
            File.WriteAllBytes(path + ".tmp", data);
            File.Move(path + ".tmp", path, true);
            b.Index[uid] = etag;
            changed++;
        }
        foreach (var (uid, _) in gone)
        {
            if (!b.Index.Remove(uid)) continue;
            try { File.Delete(CardPath(b.Id, uid)); } catch (IOException) { /* beim nächsten Mal */ }
            changed++;
        }
        if (changed > 0)
        {
            b.Seq++;
            b.Updated = DateTime.UtcNow.ToString("o");
            SaveIndex(b);
            SaveMeta(b);
        }
        return new JsonObject { ["seq"] = b.Seq, ["count"] = b.Index.Count, ["conflicts"] = conflicts };
    }

    static bool Reject(JsonArray conflicts, string uid)
    {
        conflicts.Add(uid);
        return false;
    }

    static JsonObject Get(Book b, JsonNode msg)
    {
        var uids = (msg["uids"] as JsonArray)?.Select(u => (string)u).Where(ValidUid).Distinct().Take(MaxBatch).ToList() ?? new();
        var cards = new JsonArray();
        long bytes = 0;
        foreach (var uid in uids)
        {
            if (!b.Index.TryGetValue(uid, out var etag)) continue;
            byte[] data;
            try { data = File.ReadAllBytes(CardPath(b.Id, uid)); }
            catch (IOException) { continue; }
            if (bytes > 0 && bytes + data.Length > MaxReplyBytes) break; // der Rest kommt mit der nächsten Anfrage
            bytes += data.Length;
            cards.Add(new JsonObject { ["uid"] = uid, ["etag"] = etag, ["vcard"] = Encoding.UTF8.GetString(data) });
        }
        return new JsonObject { ["seq"] = b.Seq, ["cards"] = cards };
    }

    static void Delete(string id)
    {
        books.Remove(id);
        try { if (Directory.Exists(DirOf(id))) Directory.Delete(DirOf(id), true); }
        catch (Exception e) { Log.Write($"Adressbuch {id} löschen: {e.Message}"); }
    }

    // ---- Verwaltung (Web-Oberfläche, PCs, Gruppen) ---------------------------------------------------------------------------
    public static List<Book> List()
    {
        lock (Gate)
        {
            Load();
            return books.Values.OrderBy(b => b.Name, StringComparer.CurrentCultureIgnoreCase).ToList();
        }
    }

    public static string Remove(string id)
    {
        lock (Gate)
        {
            Load();
            if (id == null || !books.TryGetValue(id, out var b)) return null;
            Delete(id);
            return b.Name;
        }
    }

    /// <summary>PC entfernt: seine Adressbücher und sein Schlüssel sind weg; aus den Freigaben anderer fällt er heraus.</summary>
    public static void ForgetPc(string client)
    {
        lock (Gate)
        {
            Load();
            foreach (var b in books.Values.Where(b => b.Owner == client).ToList()) Delete(b.Id);
            foreach (var b in books.Values)
            {
                if (!b.Pcs.Remove(client)) continue;
                b.Seq++;
                SaveMeta(b);
            }
            if (keys.Remove(client)) SaveKeys();
        }
    }

    /// <summary>Gruppe gelöscht: ihre Adressbücher und die Schlüssel ihrer PCs sind weg.</summary>
    public static void ForgetGroup(string group)
    {
        lock (Gate)
        {
            Load();
            foreach (var b in books.Values.Where(b => b.GroupId == group).ToList()) Delete(b.Id);
            foreach (var pc in keys.Where(kv => kv.Value.Group == group).Select(kv => kv.Key).ToList()) keys.Remove(pc);
            SaveKeys();
        }
    }
}
