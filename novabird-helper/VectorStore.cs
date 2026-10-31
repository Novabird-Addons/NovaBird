// Vektoren teilen (Netz-Modus): Der Helper merkt sich jeden Vektor, den er für einen PC gerechnet hat, und gibt ihn anderen PCs
// derselben Gruppe mit demselben Postfach (gleiche Message-ID) direkt zurück, statt neu zu rechnen. Ein neuer PC ist so in
// Minuten indiziert. Jede Gruppe (Groups.cs) hat ihren eigenen Speicher und ihr eigenes Salz.
//  - Schlüssel des Satzes: HMAC-SHA256(Salz, Message-ID), gekürzt auf 16 Byte – auf der Platte stehen keine Message-IDs.
//  - Verschlüsselt (AES-256-GCM): Der Schlüssel jedes Vektors ist HMAC-SHA256(Salz, Message-ID + Prüfsumme des Textes). Die
//    Prüfsumme (8 Byte aus SHA-256 des Textes, bildet NovaBird-Search) steht nirgends auf der Platte. Entschlüsseln kann den
//    Vektor also nur, wer die Mail selbst hat – auch nicht, wer die Datei und das Salz besitzt. Passt die Prüfsumme nicht
//    (Mail anders, Text geändert), schlägt die Prüfung fehl und der Helper rechnet neu.
//  - Das Salz liegt mit DPAPI geschützt in groups.json.
//  - Je Gruppe, Modell und Revision eine Datei vectors\<gruppe>\<modell>_<revision>.nbv: Kopf "NBV2" + Dimension, dann Sätze
//    (16 Byte Schlüssel, 12 Byte Nonce, Vektor als float16 verschlüsselt, 16 Byte Prüfwert). Neuere Sätze zum selben Schlüssel
//    gelten. Dateien des alten Formats (NBV1, unverschlüsselt) werden beim Start gelöscht.
//  - Abschaltbar (Einstellung vecShare, Standard an); „Vektoren löschen“ in der Web-Oberfläche.
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class VectorStore
{
    const int HeaderBytes = 8, KeyBytes = 16, NonceBytes = 12, TagBytes = 16;
    readonly ModelSpec model;
    readonly byte[] salt;
    readonly object gate = new();
    readonly Dictionary<UInt128, long> index = new(); // Schlüssel -> Position des neuesten Satzes
    FileStream file;
    public readonly string GroupId;
    public long Hits { get; private set; }
    public long Misses { get; private set; }
    public long Stored { get; private set; } // seit dem Start neu gespeichert

    public VectorStore(ModelSpec model, string groupId, byte[] salt)
    {
        this.model = model;
        this.salt = salt;
        GroupId = groupId;
        Load();
    }

    public static string Root => Path.Combine(Settings.Dir, "vectors");
    public static string FolderOf(string groupId) => Path.Combine(Root, groupId);
    string FilePath => Path.Combine(FolderOf(GroupId), $"{model.Id.Replace('/', '_')}_{model.Revision[..Math.Min(12, model.Revision.Length)]}.nbv");
    int VecBytes => model.Dims * 2;
    int RecordBytes => KeyBytes + NonceBytes + VecBytes + TagBytes;

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

    /// <summary>Alte, unverschlüsselte Speicher (Helper 0.4, direkt in vectors\) entfernen.</summary>
    public static void RemoveOldFormat()
    {
        try
        {
            if (!Directory.Exists(Root)) return;
            foreach (var f in Directory.GetFiles(Root, "*.nbv"))
            {
                File.Delete(f);
                Log.Write("Vektorspeicher: altes unverschlüsseltes Format gelöscht (" + Path.GetFileName(f) + ")");
            }
        }
        catch (Exception e) { Log.Write("Vektorspeicher (alt): " + e.Message); }
    }

    public int Count { get { lock (gate) return index.Count; } }
    public long Bytes { get { lock (gate) return file?.Length ?? 0; } }

    UInt128 Key(string messageId)
    {
        var h = HMACSHA256.HashData(salt, Encoding.UTF8.GetBytes("id|" + (messageId ?? "")));
        return new UInt128(BitConverter.ToUInt64(h, 0), BitConverter.ToUInt64(h, 8));
    }

    byte[] VecKey(string messageId, ulong hash) => HMACSHA256.HashData(salt, Encoding.UTF8.GetBytes($"vec|{hash:x16}|{messageId}"));

    static byte[] KeyBytesOf(UInt128 key)
    {
        var b = new byte[KeyBytes];
        BitConverter.TryWriteBytes(b.AsSpan(0, 8), (ulong)(key >> 64)); // obere Hälfte zuerst (wie in Load gelesen)
        BitConverter.TryWriteBytes(b.AsSpan(8, 8), (ulong)key);
        return b;
    }

    static bool TryHash(string hex, out ulong value) => ulong.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out value) && hex.Length == 16;

    void Load()
    {
        lock (gate)
        {
            try
            {
                Directory.CreateDirectory(FolderOf(GroupId));
                file = new FileStream(FilePath, FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.Read);
                var head = new byte[HeaderBytes];
                if (file.Length < HeaderBytes || file.Read(head) != HeaderBytes || Encoding.ASCII.GetString(head, 0, 4) != "NBV2" || BitConverter.ToInt32(head, 4) != model.Dims)
                {
                    Reset();
                    return;
                }
                var rec = new byte[KeyBytes];
                long count = (file.Length - HeaderBytes) / RecordBytes;
                for (long i = 0; i < count; i++)
                {
                    long off = HeaderBytes + i * RecordBytes;
                    file.Position = off;
                    if (file.Read(rec) != KeyBytes) break;
                    index[new UInt128(BitConverter.ToUInt64(rec, 0), BitConverter.ToUInt64(rec, 8))] = off;
                }
                // abgeschnittenen letzten Satz (Absturz beim Schreiben) entfernen
                file.SetLength(HeaderBytes + count * RecordBytes);
                if (index.Count > 0) Log.Write($"Vektorspeicher {GroupId}: {index.Count} Vektoren");
            }
            catch (Exception e)
            {
                Log.Write($"Vektorspeicher {GroupId} nicht lesbar: " + e.Message);
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
        file.Write(Encoding.ASCII.GetBytes("NBV2"));
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
        Log.Write($"Vektorspeicher {GroupId} geleert");
    }

    /// <summary>Entschlüsselt den Satz an off mit dem Schlüssel aus Message-ID und Prüfsumme; null, wenn sie nicht passen.</summary>
    float[] Read(long off, string id, ulong hash, byte[] rec)
    {
        file.Position = off;
        if (file.Read(rec) != rec.Length) return null;
        var plain = new byte[VecBytes];
        try
        {
            using var aes = new AesGcm(VecKey(id, hash), TagBytes);
            aes.Decrypt(rec.AsSpan(KeyBytes, NonceBytes), rec.AsSpan(KeyBytes + NonceBytes, VecBytes), rec.AsSpan(KeyBytes + NonceBytes + VecBytes, TagBytes), plain, rec.AsSpan(0, KeyBytes));
        }
        catch (AuthenticationTagMismatchException) { return null; } // andere Prüfsumme: Text hat sich geändert
        var v = new float[model.Dims];
        for (int d = 0; d < v.Length; d++) v[d] = (float)BitConverter.ToHalf(plain, d * 2);
        return v;
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
            var rec = new byte[RecordBytes];
            for (int i = 0; i < items.Count; i++)
            {
                if (!TryHash(items[i].Hash, out var h) || !index.TryGetValue(keys[i], out var off) || Read(off, items[i].Id, h, rec) is not float[] v)
                {
                    Misses++;
                    continue;
                }
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
        var rows = new List<(string Id, UInt128 Key, ulong Hash, float[] Vec)>();
        for (int i = 0; i < vecs.Length; i++)
        {
            var id = (string)keys[i]?["id"];
            if (string.IsNullOrEmpty(id) || !TryHash((string)keys[i]?["h"], out var h) || vecs[i].Length != model.Dims) continue;
            rows.Add((id, Key(id), h, vecs[i]));
        }
        if (rows.Count == 0) return;
        lock (gate)
        {
            var rec = new byte[RecordBytes];
            var plain = new byte[VecBytes];
            foreach (var (id, key, hash, vec) in rows)
            {
                if (index.TryGetValue(key, out var old) && Read(old, id, hash, rec) != null) continue; // schon da
                KeyBytesOf(key).CopyTo(rec, 0);
                RandomNumberGenerator.Fill(rec.AsSpan(KeyBytes, NonceBytes));
                for (int d = 0; d < vec.Length; d++) BitConverter.TryWriteBytes(plain.AsSpan(d * 2, 2), (Half)vec[d]);
                using (var aes = new AesGcm(VecKey(id, hash), TagBytes))
                    aes.Encrypt(rec.AsSpan(KeyBytes, NonceBytes), plain, rec.AsSpan(KeyBytes + NonceBytes, VecBytes), rec.AsSpan(KeyBytes + NonceBytes + VecBytes, TagBytes), rec.AsSpan(0, KeyBytes));
                long off = file.Length;
                file.Position = off;
                file.Write(rec);
                index[key] = off;
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
