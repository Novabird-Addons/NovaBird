// Modelldateien: dieselben Einträge wie novabird-search/semantic/models.js (Hugging Face, feste Revision, Prüfsumme je Datei).
// Ablage: %LOCALAPPDATA%\NovaBird\Helper\models\<repo>\<revision>\<pfad>. Eine Datei gilt erst nach bestandener Prüfung als
// vorhanden (Download in .part, prüfen, dann umbenennen).
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class ModelFile
{
    public string Path, Sha256, GitSha1;
    public long Size;
}

sealed class ModelSpec
{
    public string Id, Repo, Revision, Pooling;
    public int Dims, MaxTokens;
    public List<ModelFile> Files = new();

    static readonly System.Text.RegularExpressions.Regex Safe = new(@"^[A-Za-z0-9._\-/]+$");

    public static ModelSpec From(JsonNode n)
    {
        var m = new ModelSpec
        {
            Id = (string)n["id"], Repo = (string)n["repo"], Revision = (string)n["revision"], Pooling = (string)n["pooling"] ?? "mean",
            Dims = (int?)n["dims"] ?? 768, MaxTokens = (int?)n["maxTokens"] ?? 512,
        };
        foreach (var f in n["files"].AsArray())
            m.Files.Add(new ModelFile { Path = (string)f["path"], Size = (long)f["size"], Sha256 = (string)f["sha256"], GitSha1 = (string)f["gitSha1"] });
        // Nur einfache Pfade (kein „..“, keine Laufwerke): die Angaben kommen vom Add-on
        if (!Safe.IsMatch(m.Repo) || !System.Text.RegularExpressions.Regex.IsMatch(m.Revision, "^[0-9a-f]{40}$")
            || m.Files.Any(f => !Safe.IsMatch(f.Path) || f.Path.Contains("..")) || m.Repo.Contains(".."))
            throw new ArgumentException("ungültige Modellangaben");
        return m;
    }

    public string Folder => System.IO.Path.Combine(Settings.Dir, "models", Repo.Replace('/', '_'), Revision);
    public string FilePath(string rel) => System.IO.Path.Combine(Folder, rel.Replace('/', System.IO.Path.DirectorySeparatorChar));
    public string OnnxPath => FilePath(Files.First(f => f.Path.EndsWith(".onnx")).Path);
    public bool Complete => Files.All(f => File.Exists(FilePath(f.Path)) && new FileInfo(FilePath(f.Path)).Length == f.Size);
}

static class ModelStore
{
    static readonly HttpClient Http = new() { Timeout = TimeSpan.FromMinutes(30) };

    static bool Verify(ModelFile f, string path)
    {
        using var fs = File.OpenRead(path);
        if (fs.Length != f.Size) return false;
        if (!string.IsNullOrEmpty(f.Sha256)) return Convert.ToHexStringLower(SHA256.HashData(fs)) == f.Sha256;
        using var sha1 = IncrementalHash.CreateHash(HashAlgorithmName.SHA1);
        sha1.AppendData(Encoding.ASCII.GetBytes($"blob {fs.Length}\0"));
        var buf = new byte[1 << 16];
        int n;
        while ((n = fs.Read(buf, 0, buf.Length)) > 0) sha1.AppendData(buf, 0, n);
        return Convert.ToHexStringLower(sha1.GetHashAndReset()) == f.GitSha1;
    }

    /// <summary>Misst CPU und alle Grafikkarten mit dem Modell und merkt das schnellste Gerät (settings.json).</summary>
    public static void Measure(ModelSpec model)
    {
        var results = Engine.Benchmark(model.OnnxPath);
        var best = results.Where(r => r.Error == null && r.MailsPerSec > 0).OrderByDescending(r => r.MailsPerSec).FirstOrDefault()
                   ?? throw new InvalidOperationException("kein Gerät rechnet das Modell");
        var s = Settings.Load();
        s["device"] = best.Device;
        s["deviceName"] = best.Name;
        s["mailsPerSec"] = best.MailsPerSec;
        s["benchRevision"] = model.Revision;
        s["devices"] = new JsonArray(results.Select(r => (JsonNode)new JsonObject
        {
            ["device"] = r.Device, ["name"] = r.Name, ["mailsPerSec"] = r.MailsPerSec, ["error"] = r.Error,
        }).ToArray());
        s.Remove("fallbackFrom");
        // Netz-Modus: darf die CPU neben der Grafikkarte mitrechnen? Nur wenn beide dieselben Vektoren liefern
        s.Remove("cpuAgree");
        if (best.Device.StartsWith("dml:"))
        {
            try { s["cpuAgree"] = Math.Round(Engine.Agreement(model, best.Device), 5); }
            catch (Exception e) { Log.Write("Abgleich CPU/Grafikkarte: " + e.Message); }
        }
        Settings.Save(s);
        Engine.Unload();
    }

    /// <summary>Modell vorhanden und auf diesem PC gemessen?</summary>
    public static bool Ready(ModelSpec model) => model.Complete && (string)Settings.Load()["benchRevision"] == model.Revision;

    /// <summary>Lädt fehlende Dateien (Hugging Face, feste Revision) und prüft sie. progress(done, total).</summary>
    public static void Ensure(ModelSpec m, Action<long, long> progress)
    {
        long total = m.Files.Sum(f => f.Size), done = 0;
        foreach (var f in m.Files)
        {
            var path = m.FilePath(f.Path);
            if (File.Exists(path) && new FileInfo(path).Length == f.Size) { done += f.Size; continue; }
            Directory.CreateDirectory(System.IO.Path.GetDirectoryName(path));
            var part = path + ".part";
            var url = $"https://huggingface.co/{m.Repo}/resolve/{m.Revision}/{f.Path}";
            Log.Write("lade " + url);
            using (var res = Http.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult())
            {
                res.EnsureSuccessStatusCode();
                using var src = res.Content.ReadAsStream();
                using var dst = File.Create(part);
                var buf = new byte[1 << 20];
                int n;
                long got = 0, last = 0;
                while ((n = src.Read(buf, 0, buf.Length)) > 0)
                {
                    dst.Write(buf, 0, n);
                    got += n;
                    if (got > f.Size) throw new InvalidDataException("Datei größer als erwartet: " + f.Path);
                    if (got - last > 8 << 20) { last = got; progress(done + got, total); }
                }
            }
            if (!Verify(f, part))
            {
                File.Delete(part);
                throw new InvalidDataException("Prüfsumme stimmt nicht: " + f.Path);
            }
            File.Move(part, path, true);
            done += f.Size;
            progress(done, total);
        }
    }
}
