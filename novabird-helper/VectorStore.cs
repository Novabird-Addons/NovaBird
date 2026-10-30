// Vektoren teilen (Netz-Modus): Der Helper merkt sich jeden Vektor, den er für einen PC gerechnet hat, und gibt ihn anderen PCs
// mit demselben Postfach (gleiche Message-ID) direkt zurück, statt neu zu rechnen. Ein neuer PC ist so in Minuten indiziert.
//  - Schlüssel: HMAC-SHA256(geheimes Salz, Message-ID), gekürzt auf 16 Byte – auf der Platte stehen keine Message-IDs.
//    Das Salz liegt mit DPAPI geschützt in settings.json (vecSalt).
//  - Zu jedem Vektor die Prüfsumme des Textes, den der PC gerechnet haben wollte (8 Byte aus SHA-256, bildet NovaBird-Search).
//    Nur wenn Message-ID und Prüfsumme passen, gilt ein Vektor als Treffer; sonst rechnet der Helper neu.
//  - Je Modell und Revision eine Datei vectors\<modell>_<revision>.nbv: Kopf "NBV1" + Dimension, dann Sätze
//    (16 Byte Schlüssel, 8 Byte Prüfsumme, Vektor als float16). Neuere Sätze zum selben Schlüssel gelten.
//  - Abschaltbar (Einstellung vecShare, Standard an); „Vektoren löschen“ in der Web-Oberfläche.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class VectorStore
{
    const int HeaderBytes = 8;
    readonly ModelSpec model;
    readonly object gate = new();
    readonly Dictionary<UInt128, (ulong Hash, long Offset)> index = new();
    byte[] salt;
    FileStream file;
    public long Hits { get; private set; }
    public long Misses { get; private set; }
    public long Stored { get; private set; } // seit dem Start neu gespeichert

    public VectorStore(ModelSpec model)
    {
        this.model = model;
        Load();
    }

    static string Folder => Path.Combine(Settings.Dir, "vectors");
    string FilePath => Path.Combine(Folder, $"{model.Id.Replace('/', '_')}_{model.Revision[..Math.Min(12, model.Revision.Length)]}.nbv");
    int RecordBytes => 16 + 8 + model.Dims * 2;

    public static bool Enabled
    {
        get => (bool?)Settings.Load()["vecShare"] ?? true;
        set
        {
            var s = Settings.Load();
            s["vecShare"] = value;
            Settings.Save(s);
        }
    }

    public int Count { get { lock (gate) return index.Count; } }
    public long Bytes { get { lock (gate) return file?.Length ?? 0; } }

    byte[] Salt()
    {
        if (salt != null) return salt;
        var s = Settings.Load();
        if (s["vecSalt"] is JsonNode n)
        {
            try { return salt = Settings.Unprotect((string)n); }
            catch (Exception e) { Log.Write("Vektorspeicher: Salz unlesbar, beginne neu: " + e.Message); }
        }
        salt = RandomNumberGenerator.GetBytes(32);
        s = Settings.Load();
        s["vecSalt"] = Settings.Protect(salt);
        Settings.Save(s);
        // neues Salz: alte Sätze passen nicht mehr
        lock (gate) Reset();
        return salt;
    }

    UInt128 Key(string messageId)
    {
        var h = HMACSHA256.HashData(Salt(), Encoding.UTF8.GetBytes(messageId ?? ""));
        return new UInt128(BitConverter.ToUInt64(h, 0), BitConverter.ToUInt64(h, 8));
    }

    static bool TryHash(string hex, out ulong value) => ulong.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out value) && hex.Length == 16;

    void Load()
    {
        lock (gate)
        {
            try
            {
                Directory.CreateDirectory(Folder);
                file = new FileStream(FilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read);
                var head = new byte[HeaderBytes];
                if (file.Length < HeaderBytes || file.Read(head) != HeaderBytes || Encoding.ASCII.GetString(head, 0, 4) != "NBV1" || BitConverter.ToInt32(head, 4) != model.Dims)
                {
                    Reset();
                    return;
                }
                var rec = new byte[24];
                long count = (file.Length - HeaderBytes) / RecordBytes;
                for (long i = 0; i < count; i++)
                {
                    long off = HeaderBytes + i * RecordBytes;
                    file.Position = off;
                    if (file.Read(rec) != 24) break;
                    index[new UInt128(BitConverter.ToUInt64(rec, 0), BitConverter.ToUInt64(rec, 8))] = (BitConverter.ToUInt64(rec, 16), off);
                }
                // abgeschnittenen letzten Satz (Absturz beim Schreiben) entfernen
                file.SetLength(HeaderBytes + count * RecordBytes);
                if (index.Count > 0) Log.Write($"Vektorspeicher: {index.Count} Vektoren");
            }
            catch (Exception e)
            {
                Log.Write("Vektorspeicher nicht lesbar: " + e.Message);
                file?.Dispose();
                file = null;
            }
        }
    }

    void Reset()
    {
        index.Clear();
        if (file == null) return;
        file.SetLength(0);
        file.Write(Encoding.ASCII.GetBytes("NBV1"));
        file.Write(BitConverter.GetBytes(model.Dims));
        file.Flush();
    }

    public void Clear()
    {
        lock (gate)
        {
            Reset();
            Hits = Misses = Stored = 0;
        }
        Log.Write("Vektorspeicher geleert");
    }

    /// <summary>Gespeicherte Vektoren zu (Message-ID, Prüfsumme): Positionen der Treffer und ihre Vektoren.</summary>
    public (List<int> Found, float[][] Vectors) Lookup(IReadOnlyList<(string Id, string Hash)> items)
    {
        var found = new List<int>();
        var vecs = new List<float[]>();
        if (!Enabled || file == null) return (found, vecs.ToArray());
        var keys = items.Select(i => Key(i.Id)).ToList();
        lock (gate)
        {
            var buf = new byte[model.Dims * 2];
            for (int i = 0; i < items.Count; i++)
            {
                if (!TryHash(items[i].Hash, out var h) || !index.TryGetValue(keys[i], out var e) || e.Hash != h)
                {
                    Misses++;
                    continue;
                }
                file.Position = e.Offset + 24;
                if (file.Read(buf) != buf.Length) { Misses++; continue; }
                var v = new float[model.Dims];
                for (int d = 0; d < v.Length; d++) v[d] = (float)BitConverter.ToHalf(buf, d * 2);
                found.Add(i);
                vecs.Add(v);
                Hits++;
            }
        }
        return (found, vecs.ToArray());
    }

    /// <summary>Gerechnete Vektoren merken (keys: je Text Message-ID und Prüfsumme; fehlende werden übersprungen).</summary>
    public void Put(JsonArray keys, float[][] vecs)
    {
        if (!Enabled || file == null || keys == null || keys.Count != vecs.Length) return;
        var rows = new List<(UInt128 Key, ulong Hash, float[] Vec)>();
        for (int i = 0; i < vecs.Length; i++)
        {
            var id = (string)keys[i]?["id"];
            if (string.IsNullOrEmpty(id) || !TryHash((string)keys[i]?["h"], out var h) || vecs[i].Length != model.Dims) continue;
            rows.Add((Key(id), h, vecs[i]));
        }
        if (rows.Count == 0) return;
        lock (gate)
        {
            var rec = new byte[RecordBytes];
            file.Position = file.Length;
            foreach (var (key, hash, vec) in rows)
            {
                if (index.TryGetValue(key, out var old) && old.Hash == hash) continue; // schon da
                BitConverter.TryWriteBytes(rec.AsSpan(0, 8), (ulong)(key >> 64)); // obere Hälfte zuerst (wie in Load gelesen)
                BitConverter.TryWriteBytes(rec.AsSpan(8, 8), (ulong)key);
                BitConverter.TryWriteBytes(rec.AsSpan(16, 8), hash);
                for (int d = 0; d < vec.Length; d++) BitConverter.TryWriteBytes(rec.AsSpan(24 + d * 2, 2), (Half)vec[d]);
                long off = file.Position;
                file.Write(rec);
                index[key] = (hash, off);
                Stored++;
            }
            file.Flush();
        }
    }

    public void Dispose()
    {
        lock (gate)
        {
            file?.Dispose();
            file = null;
        }
    }
}
