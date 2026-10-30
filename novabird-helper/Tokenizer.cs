// Tokenizer im Helper: Byte-Level-BPE nach tokenizer.json des Modells (jina-de: ohne Normalisierung, RoBERTa-Rahmen <s> … </s>).
// Damit kann der Helper Texte selbst zerlegen: Clients im Netz (und Thunderbird mit lokalem Helper) brauchen keine
// Tokenizer-Dateien. Die Zerlegung entspricht der von transformers.js im Add-on und der Python-Bibliothek tokenizers
// (geprüft mit --tokenize gegen tokenizers; die Probe in NovaBird-Search prüft das Ergebnis zusätzlich).
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

sealed class BpeTokenizer
{
    // Vor-Zerlegung wie ByteLevel (GPT-2-Muster)
    static readonly Regex Pieces = new(@"'s|'t|'re|'ve|'m|'ll|'d| ?\p{L}+| ?\p{N}+| ?[^\s\p{L}\p{N}]+|\s+(?!\S)|\s+", RegexOptions.Compiled);
    static readonly char[] ByteChar = BuildByteChars();

    readonly Dictionary<string, int> vocab;
    readonly Dictionary<(string, string), int> ranks = new();
    readonly List<(string Content, int Id, bool Lstrip, bool Rstrip)> special = new();
    readonly Dictionary<string, int[]> cache = new();
    readonly int cls, sep;

    static readonly object Gate = new();
    static BpeTokenizer loaded;
    static string loadedPath;

    /// <summary>Tokenizer des Modells (einmal geladen, danach aus dem Speicher).</summary>
    public static BpeTokenizer For(ModelSpec m) => ForFile(m.FilePath("tokenizer.json"));

    public static BpeTokenizer ForFile(string path)
    {
        lock (Gate)
        {
            if (loaded == null || loadedPath != path)
            {
                loaded = new BpeTokenizer(path);
                loadedPath = path;
            }
            return loaded;
        }
    }

    // GPT-2: jedes Byte wird zu einem druckbaren Zeichen
    static char[] BuildByteChars()
    {
        var bs = new List<int>();
        for (int b = '!'; b <= '~'; b++) bs.Add(b);
        for (int b = 0xA1; b <= 0xAC; b++) bs.Add(b);
        for (int b = 0xAE; b <= 0xFF; b++) bs.Add(b);
        var map = new char[256];
        int n = 0;
        for (int b = 0; b < 256; b++)
            map[b] = bs.Contains(b) ? (char)b : (char)(256 + n++);
        return map;
    }

    BpeTokenizer(string path)
    {
        using var doc = JsonDocument.Parse(File.ReadAllBytes(path));
        var root = doc.RootElement;
        var model = root.GetProperty("model");
        if (model.GetProperty("type").GetString() != "BPE") throw new NotSupportedException("nur BPE-Tokenizer");
        if (root.TryGetProperty("normalizer", out var norm) && norm.ValueKind != JsonValueKind.Null) throw new NotSupportedException("Normalisierung nicht unterstützt");
        vocab = new Dictionary<string, int>();
        foreach (var p in model.GetProperty("vocab").EnumerateObject()) vocab[p.Name] = p.Value.GetInt32();
        int rank = 0;
        foreach (var m in model.GetProperty("merges").EnumerateArray())
        {
            string a, b;
            if (m.ValueKind == JsonValueKind.Array) { a = m[0].GetString(); b = m[1].GetString(); }
            else { var s = m.GetString(); int i = s.IndexOf(' '); a = s[..i]; b = s[(i + 1)..]; }
            ranks.TryAdd((a, b), rank++);
        }
        foreach (var t in root.GetProperty("added_tokens").EnumerateArray())
            if (t.GetProperty("special").GetBoolean())
                special.Add((t.GetProperty("content").GetString(), t.GetProperty("id").GetInt32(),
                    t.TryGetProperty("lstrip", out var l) && l.GetBoolean(), t.TryGetProperty("rstrip", out var r) && r.GetBoolean()));
        var post = root.GetProperty("post_processor");
        cls = post.GetProperty("cls")[1].GetInt32();
        sep = post.GetProperty("sep")[1].GetInt32();
    }

    /// <summary>Token-IDs mit &lt;s&gt; … &lt;/s&gt;, gekürzt auf maxTokens (Rahmen eingeschlossen).</summary>
    public long[] Encode(string text, int maxTokens)
    {
        var ids = new List<int>();
        foreach (var (part, specialId) in SplitSpecial(text ?? ""))
        {
            if (specialId >= 0) { ids.Add(specialId); continue; }
            foreach (Match m in Pieces.Matches(part)) ids.AddRange(Word(m.Value));
            if (ids.Count >= maxTokens) break;
        }
        int keep = Math.Min(ids.Count, Math.Max(0, maxTokens - 2));
        var outIds = new long[keep + 2];
        outIds[0] = cls;
        for (int i = 0; i < keep; i++) outIds[i + 1] = ids[i];
        outIds[keep + 1] = sep;
        return outIds;
    }

    // Sondertokens im Text (z. B. ein wörtliches „</s>“) werden wie in tokenizers als solche erkannt
    IEnumerable<(string Part, int SpecialId)> SplitSpecial(string text)
    {
        int pos = 0;
        while (pos < text.Length)
        {
            int best = -1, bestIdx = -1;
            for (int s = 0; s < special.Count; s++)
            {
                int idx = text.IndexOf(special[s].Content, pos, StringComparison.Ordinal);
                if (idx >= 0 && (bestIdx < 0 || idx < bestIdx || (idx == bestIdx && special[s].Content.Length > special[best].Content.Length)))
                {
                    best = s;
                    bestIdx = idx;
                }
            }
            if (best < 0) { yield return (text[pos..], -1); yield break; }
            var sp = special[best];
            int start = bestIdx, end = bestIdx + sp.Content.Length;
            if (sp.Lstrip) while (start > pos && char.IsWhiteSpace(text[start - 1])) start--;
            if (sp.Rstrip) while (end < text.Length && char.IsWhiteSpace(text[end])) end++;
            if (start > pos) yield return (text[pos..start], -1);
            yield return (null, sp.Id);
            pos = end;
        }
    }

    int[] Word(string piece)
    {
        lock (cache)
        {
            if (cache.TryGetValue(piece, out var hit)) return hit;
        }
        var bytes = Encoding.UTF8.GetBytes(piece);
        var symbols = new List<string>(bytes.Length);
        foreach (var b in bytes) symbols.Add(ByteChar[b].ToString());
        while (symbols.Count > 1)
        {
            int bestRank = int.MaxValue;
            (string, string) bestPair = default;
            for (int i = 0; i < symbols.Count - 1; i++)
                if (ranks.TryGetValue((symbols[i], symbols[i + 1]), out var r) && r < bestRank) { bestRank = r; bestPair = (symbols[i], symbols[i + 1]); }
            if (bestRank == int.MaxValue) break;
            var merged = new List<string>(symbols.Count);
            for (int i = 0; i < symbols.Count; i++)
            {
                if (i < symbols.Count - 1 && symbols[i] == bestPair.Item1 && symbols[i + 1] == bestPair.Item2)
                {
                    merged.Add(symbols[i] + symbols[i + 1]);
                    i++;
                }
                else merged.Add(symbols[i]);
            }
            symbols = merged;
        }
        var ids = new int[symbols.Count];
        for (int i = 0; i < ids.Length; i++)
            ids[i] = vocab.TryGetValue(symbols[i], out var id) ? id : vocab.GetValueOrDefault("<unk>", 3);
        lock (cache)
        {
            if (cache.Count > 50_000) cache.Clear();
            cache[piece] = ids;
        }
        return ids;
    }
}
