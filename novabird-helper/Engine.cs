// Rechnet Vektoren mit ONNX Runtime: DirectML (Grafikkarte) oder CPU. Meldungen von ONNX Runtime gehen nach stderr (nie in den
// Native-Messaging-Strom auf stdout), und nur Fehler. Beim Vorbereiten eines Modells werden CPU und alle
// Grafikkarten gemessen; das schnellste Gerät wird gemerkt. Fällt die Grafikkarte aus, wird auf die CPU gewechselt.
// Ergebnis wie im Add-on: Mean-Pooling über die Token, dann auf Länge 1 normiert (gleiche Vektoren, ≥ 0,9998 gemessen).
using System.Diagnostics;
using Microsoft.ML.OnnxRuntime;
using Microsoft.ML.OnnxRuntime.Tensors;

namespace NovaBird.Helper;

static class Engine
{
    static InferenceSession session;
    static string sessionKey; // Gerät + Modelldatei
    public static bool FellBack { get; private set; }
    /// <summary>Gerät, auf dem das Suchmodell gerade geladen ist ("dml:1", "cpu"), sonst null.</summary>
    public static string LoadedOn => session == null ? null : sessionKey?.Split('|')[0];

    static int CpuThreads => Math.Max(1, Math.Min(16, Environment.ProcessorCount / 2));

    public static SessionOptions OptionsFor(string device)
    {
        if (device.StartsWith("dml:"))
        {
            var so = new SessionOptions { EnableMemoryPattern = false, ExecutionMode = ExecutionMode.ORT_SEQUENTIAL, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR };
            so.AppendExecutionProvider_DML(int.Parse(device[4..]));
            return so;
        }
        // fp16-Modell auf der CPU: höhere Optimierungsstufen scheitern (SimplifiedLayerNormFusion), daher BASIC
        return new SessionOptions { IntraOpNumThreads = CpuThreads, GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_BASIC, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR };
    }

    public static string DeviceName(string device)
    {
        if (!device.StartsWith("dml:")) return $"CPU ({CpuThreads} Threads)";
        int idx = int.Parse(device[4..]);
        return Dxgi.Adapters().FirstOrDefault(a => a.Index == idx).Name ?? device;
    }

    static InferenceSession Session(string onnxPath, string device)
    {
        var key = device + "|" + onnxPath;
        if (session != null && sessionKey == key) return session;
        session?.Dispose();
        session = null;
        using var so = OptionsFor(device);
        session = new InferenceSession(onnxPath, so);
        sessionKey = key;
        return session;
    }

    public static void Unload()
    {
        session?.Dispose();
        session = null;
        sessionKey = null;
    }

    // Länge eines Pakets auf Stufen von 64 Token runden: DirectML richtet sich je neuer Form neu ein, so gibt es nur 8 Formen.
    // Die aufgefüllten Stellen sind maskiert (attention_mask 0) und zählen beim Mitteln nicht mit.
    const int LengthStep = 64;

    static float[][] Run(InferenceSession s, IReadOnlyList<long[]> batch)
    {
        int b = batch.Count, len = Math.Max(1, batch.Max(x => x.Length));
        len = (len + LengthStep - 1) / LengthStep * LengthStep;
        var ids = new DenseTensor<long>(new[] { b, len });
        var mask = new DenseTensor<long>(new[] { b, len });
        var types = new DenseTensor<long>(new[] { b, len });
        for (int i = 0; i < b; i++)
            for (int j = 0; j < batch[i].Length; j++) { ids[i, j] = batch[i][j]; mask[i, j] = 1; }
        var inputs = new List<NamedOnnxValue>();
        foreach (var name in s.InputMetadata.Keys)
            inputs.Add(NamedOnnxValue.CreateFromTensor(name, name == "input_ids" ? ids : name == "attention_mask" ? mask : types));
        using var res = s.Run(inputs);
        var first = res.First();
        float[] flat;
        int dim;
        if (first.Value is Tensor<Float16> h) { flat = h.ToArray().Select(x => (float)x).ToArray(); dim = h.Dimensions[2]; }
        else { var t = (Tensor<float>)first.Value; flat = t.ToArray(); dim = t.Dimensions[2]; }
        var outv = new float[b][];
        for (int i = 0; i < b; i++)
        {
            var v = new float[dim];
            int n = Math.Max(1, batch[i].Length);
            for (int j = 0; j < batch[i].Length; j++)
                for (int d = 0; d < dim; d++) v[d] += flat[(i * len + j) * dim + d];
            double norm = Math.Sqrt(v.Sum(x => (double)x * x));
            if (norm > 0) for (int d = 0; d < dim; d++) v[d] = (float)(v[d] / norm);
            outv[i] = v;
        }
        return outv;
    }

    /// <summary>
    /// Vektoren für Token-ID-Folgen (Pakete zu höchstens 16, nach Länge sortiert, damit wenig aufgefüllt wird; Ergebnis in der
    /// ursprünglichen Reihenfolge). Bei einem Fehler der Grafikkarte: CPU.
    /// </summary>
    public static float[][] Embed(ModelSpec m, IReadOnlyList<long[]> ids, string device)
    {
        var order = Enumerable.Range(0, ids.Count).OrderBy(i => ids[i].Length).ToArray();
        var result = new float[ids.Count][];
        for (int i = 0; i < order.Length; i += 16)
        {
            var idx = order.Skip(i).Take(16).ToArray();
            var part = idx.Select(k => ids[k]).ToList();
            float[][] vecs;
            try
            {
                vecs = Run(Session(m.OnnxPath, device), part);
            }
            catch (Exception e) when (device != "cpu")
            {
                Log.Write($"Gerät {device} fehlgeschlagen, wechsle auf CPU: {e.Message}");
                FellBack = true;
                var s = Settings.Load();
                s["fallbackFrom"] = device;
                s["device"] = "cpu";
                s["deviceName"] = DeviceName("cpu");
                Settings.Save(s);
                device = "cpu";
                vecs = Run(Session(m.OnnxPath, device), part);
            }
            for (int j = 0; j < idx.Length; j++) result[idx[j]] = vecs[j];
        }
        return result;
    }

    // ---- CPU als zweiter Rechner im Netz-Modus (neben der Grafikkarte), eigene Sitzung mit einstellbaren Threads --------------
    static InferenceSession cpuExtra;
    static int cpuExtraThreads;

    /// <summary>Häppchen auf der CPU rechnen (nur vom CPU-Arbeiter des Netz-Modus benutzt).</summary>
    public static float[][] EmbedOnCpu(ModelSpec m, IReadOnlyList<long[]> ids, int threads)
    {
        if (cpuExtra == null || cpuExtraThreads != threads)
        {
            cpuExtra?.Dispose();
            using var so = new SessionOptions
            {
                IntraOpNumThreads = threads, InterOpNumThreads = 1, ExecutionMode = ExecutionMode.ORT_SEQUENTIAL,
                GraphOptimizationLevel = GraphOptimizationLevel.ORT_ENABLE_BASIC, LogSeverityLevel = OrtLoggingLevel.ORT_LOGGING_LEVEL_ERROR,
            };
            cpuExtra = new InferenceSession(m.OnnxPath, so);
            cpuExtraThreads = threads;
        }
        return Run(cpuExtra, ids);
    }

    public static void UnloadCpu()
    {
        cpuExtra?.Dispose();
        cpuExtra = null;
    }

    // Echte Sätze für den Abgleich CPU/Grafikkarte (künstliche Token-Folgen verstärken die fp16-Unterschiede unrealistisch)
    static readonly string[] AgreementTexts =
    {
        "Elternabend der Klasse 4b\nLiebe Eltern, am Donnerstag um 19:30 Uhr findet im Musiksaal der Elternabend statt. Themen: Klassenfahrt, Hausaufgaben und die Wahl der Elternvertreter.",
        "Invoice overdue\nHello, according to our records the invoice dated 3 April has not been paid yet. Please transfer the amount within 7 days.",
        "Wartungsfenster Samstag 02:00–04:00\nIn diesem Zeitraum werden die Server aktualisiert; das Kundenportal ist nicht erreichbar, E-Mails werden danach zugestellt.",
        "Ihre Buchung: Hotel am Meer\nVielen Dank für Ihre Reservierung vom 14. bis 21. Juli, Doppelzimmer mit Meerblick, Halbpension. Der Transfer vom Flughafen ist im Preis enthalten.",
        "Treffen der Eltern in der Schule",
    };

    /// <summary>
    /// Stimmen CPU und Grafikkarte überein? Kleinster Kosinus über einige echte Sätze (beim Messen der Geräte; nur dann darf die
    /// CPU im Netz-Modus mitrechnen).
    /// </summary>
    public static double Agreement(ModelSpec m, string gpuDevice)
    {
        var onnxPath = m.OnnxPath;
        var seqs = Encode(m, AgreementTexts);
        float[][] On(string device)
        {
            using var so = OptionsFor(device);
            using var session = new InferenceSession(onnxPath, so);
            return Run(session, seqs);
        }
        var g = On(gpuDevice);
        var c = On("cpu");
        return Enumerable.Range(0, seqs.Count).Min(i => g[i].Zip(c[i], (x, y) => (double)x * y).Sum());
    }

    /// <summary>Texte zerlegen (Tokenizer.cs).</summary>
    public static List<long[]> Encode(ModelSpec m, IReadOnlyList<string> texts)
    {
        var tok = BpeTokenizer.For(m);
        return texts.Select(t => tok.Encode(t, m.MaxTokens)).ToList();
    }

    /// <summary>Texte selbst zerlegen (Tokenizer.cs) und rechnen.</summary>
    public static float[][] EmbedTexts(ModelSpec m, IReadOnlyList<string> texts, string device) => Embed(m, Encode(m, texts), device);

    public static string ToBase64(float[][] vecs, int dims)
    {
        var bytes = new byte[vecs.Length * dims * 4];
        for (int i = 0; i < vecs.Length; i++) Buffer.BlockCopy(vecs[i], 0, bytes, i * dims * 4, dims * 4);
        return Convert.ToBase64String(bytes);
    }

    public sealed record Result(string Device, string Name, double MailsPerSec, string Error);

    /// <summary>
    /// Misst CPU und jede Grafikkarte mit 64 künstlichen Mails in realistischen Längen (80–512 Token, Mitte etwa 320 wie
    /// Betreff + 1.200 Zeichen Text), gerechnet wie im Betrieb (sortiert, Längenstufen).
    /// </summary>
    public static List<Result> Benchmark(string onnxPath)
    {
        var mails = Enumerable.Range(0, 64)
            .Select(i => 80 + (i * 37) % 433)
            .Select((n, i) => new long[] { 0 }.Concat(Enumerable.Range(0, n - 2).Select(j => (long)(100 + (i * 7 + j * 13) % 5000))).Append(2L).ToArray())
            .OrderBy(x => x.Length)
            .ToList();
        var devices = new List<string> { "cpu" };
        devices.AddRange(Dxgi.Adapters().Select(a => "dml:" + a.Index));
        var results = new List<Result>();
        foreach (var dev in devices)
        {
            try
            {
                using var so = OptionsFor(dev);
                using var s = new InferenceSession(onnxPath, so);
                Run(s, mails.Take(2).ToList()); // Aufwärmen
                var sw = Stopwatch.StartNew();
                int n = dev == "cpu" ? 32 : 64;
                for (int i = 0; i < n; i += 16) Run(s, mails.Skip(i).Take(16).ToList());
                results.Add(new Result(dev, DeviceName(dev), Math.Round(n / sw.Elapsed.TotalSeconds, 1), null));
            }
            catch (Exception e)
            {
                results.Add(new Result(dev, DeviceName(dev), 0, e.GetType().Name + ": " + e.Message));
            }
        }
        Log.Write("Messung: " + string.Join("; ", results.Select(r => $"{r.Device} {r.Name} {r.MailsPerSec}/s {r.Error}")));
        return results;
    }
}
