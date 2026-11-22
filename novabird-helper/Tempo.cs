// Tempo eines WAV ändern, die Tonhöhe bleibt (WSOLA: überlappende Stücke, jedes an der Stelle, die am besten an das
// vorige anschließt). Für externe Programme (POST /v1/audio/speech mit "speed"); Thunderbird ändert das Tempo selbst beim
// Abspielen. Erwartet 16 bit mono (wie Qwen3-TTS, 24 kHz).
//  - Fenster 30 ms (Hann, halb überlappend: Summe der Fenster = 1), Suche ±6 ms (deckt eine Grundperiode ab 80 Hz),
//    Ähnlichkeit = normierte Kreuzkorrelation über das halbe Fenster, jede zweite Probe (schnell genug für lange Texte).
namespace NovaBird.Helper;

static class Tempo
{
    public const double Min = 0.5, Max = 2.0;

    /// <summary>WAV (16 bit mono) mit anderem Tempo; speed &gt; 1 = schneller. 1 = unverändert.</summary>
    public static byte[] Wav(byte[] wav, double speed)
    {
        if (Math.Abs(speed - 1) < 0.001) return wav;
        var (rate, data, len) = Speech.WavData(wav);
        var x = new short[len / 2];
        Buffer.BlockCopy(wav, data, x, 0, x.Length * 2);
        var y = Stretch(x, speed, rate);
        var pcm = new byte[y.Length * 2];
        Buffer.BlockCopy(y, 0, pcm, 0, pcm.Length);
        return Speech.WavBytes(pcm, rate);
    }

    public static short[] Stretch(short[] x, double speed, int rate)
    {
        int n = Math.Max(64, rate * 30 / 1000) & ~1, hs = n / 2, tol = rate * 6 / 1000, cmp = hs;
        if (x.Length < n + 2 * tol) return x;
        var w = new float[n];
        for (int i = 0; i < n; i++) w[i] = (float)(0.5 - 0.5 * Math.Cos(2 * Math.PI * i / n));
        int frames = (int)((x.Length - n - tol) / (hs * speed)) + 1;
        var y = new float[frames * hs + n];
        int prev = 0, k = 0;
        for (; k < frames; k++)
        {
            int ideal = (int)Math.Round(k * hs * speed), pos = ideal;
            if (k > 0)
            {
                // natürliche Fortsetzung des vorigen Stücks; das ähnlichste Stück um die Sollstelle wählen
                int nat = prev + hs;
                int from = Math.Max(0, ideal - tol), to = Math.Min(x.Length - n, ideal + tol);
                if (nat + cmp <= x.Length && to >= from)
                {
                    double best = double.NegativeInfinity;
                    for (int c = from; c <= to; c++)
                    {
                        double dot = 0, en = 1e-9;
                        for (int i = 0; i < cmp; i += 2)
                        {
                            double v = x[c + i];
                            dot += x[nat + i] * v;
                            en += v * v;
                        }
                        double score = dot / Math.Sqrt(en);
                        if (score > best) { best = score; pos = c; }
                    }
                }
            }
            if (pos + n > x.Length) break;
            int o = k * hs;
            for (int i = 0; i < n; i++) y[o + i] += w[i] * x[pos + i];
            prev = pos;
        }
        // Anfang: die erste halbe Fensterlänge hat keinen Partner – unverändert übernehmen statt einzublenden.
        // Das Ende klingt mit der fallenden Fensterhälfte des letzten Stücks aus (kein Knacken).
        for (int i = 0; i < hs; i++) y[i] = x[i];
        int end = Math.Min(y.Length, (k - 1) * hs + n);
        var r = new short[Math.Max(0, end)];
        for (int i = 0; i < r.Length; i++) r[i] = (short)Math.Clamp(Math.Round(y[i]), short.MinValue, short.MaxValue);
        return r;
    }
}
