// Auslastung für die Statusseite: Grafikkarte gesamt, Sprachmodell (Ollama-Prozesse) und Suchmodell (dieser Prozess).
// Grafikspeicher und GPU-Last kommen aus den Windows-Leistungsindikatoren (wie im Task-Manager):
//   \GPU Engine(*)\Utilization Percentage   je Prozess und Engine („pid_123_luid_0x…_0x…_phys_0_eng_0_engtype_3D“)
//   \GPU Process Memory(*)\Dedicated Usage  je Prozess und Grafikkarte
//   \GPU Adapter Memory(*)\Dedicated Usage  je Grafikkarte
// GPU-Last eines Prozesses = höchste Last über seine Engine-Arten (wie die Spalte „GPU“ im Task-Manager).
// Gemessen wird nur, wenn jemand die Statusseite ansieht (höchstens einmal je Sekunde).
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

static class Usage
{
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhOpenQuery(string source, IntPtr user, out IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhAddEnglishCounter(IntPtr query, string path, IntPtr user, out IntPtr counter);
    [DllImport("pdh.dll")] static extern uint PdhCollectQueryData(IntPtr query);
    [DllImport("pdh.dll", CharSet = CharSet.Unicode)] static extern uint PdhGetFormattedCounterArray(IntPtr counter, uint format, ref uint size, out uint count, IntPtr buffer);

    const uint FmtDouble = 0x200, FmtNoCap100 = 0x8000, MoreData = 0x800007D2;
    static readonly Regex EngineName = new(@"^pid_(\d+)_(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys_\d+_eng_\d+_engtype_(.+)$", RegexOptions.IgnoreCase);
    static readonly Regex ProcMemName = new(@"^pid_(\d+)_(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys_\d+$", RegexOptions.IgnoreCase);
    static readonly Regex AdapterMemName = new(@"^(luid_0x[0-9a-f]+_0x[0-9a-f]+)_phys_\d+$", RegexOptions.IgnoreCase);

    static readonly object Gate = new();
    static IntPtr query, engine, procMem, adapterMem;
    static bool broken;
    static DateTime collected;
    static Dictionary<string, double> engineValues = new(), procMemValues = new(), adapterMemValues = new();
    static readonly Dictionary<int, (TimeSpan Cpu, DateTime At, double Pct)> cpu = new();

    /// <summary>Werte holen (höchstens einmal je Sekunde); false, wenn die Leistungsindikatoren nicht verfügbar sind.</summary>
    static bool Collect()
    {
        if (broken) return false;
        if (DateTime.UtcNow - collected < TimeSpan.FromSeconds(1)) return true;
        try
        {
            if (query == IntPtr.Zero)
            {
                if (PdhOpenQuery(null, IntPtr.Zero, out query) != 0
                    || PdhAddEnglishCounter(query, @"\GPU Engine(*)\Utilization Percentage", IntPtr.Zero, out engine) != 0
                    || PdhAddEnglishCounter(query, @"\GPU Process Memory(*)\Dedicated Usage", IntPtr.Zero, out procMem) != 0
                    || PdhAddEnglishCounter(query, @"\GPU Adapter Memory(*)\Dedicated Usage", IntPtr.Zero, out adapterMem) != 0)
                {
                    broken = true;
                    Log.Write("Auslastung: Leistungsindikatoren der Grafikkarte nicht verfügbar");
                    return false;
                }
                PdhCollectQueryData(query); // Last braucht zwei Messungen
                Thread.Sleep(250);
            }
            PdhCollectQueryData(query);
            engineValues = Read(engine);
            procMemValues = Read(procMem);
            adapterMemValues = Read(adapterMem);
            collected = DateTime.UtcNow;
            return true;
        }
        catch (Exception e)
        {
            broken = true;
            Log.Write("Auslastung: " + e.Message);
            return false;
        }
    }

    // Alle Instanzen eines Platzhalter-Zählers: Name -> Wert (x64: Zeiger auf den Namen, Status, 4 Byte Füllung, double)
    static Dictionary<string, double> Read(IntPtr counter)
    {
        var result = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase);
        uint size = 0;
        if (PdhGetFormattedCounterArray(counter, FmtDouble | FmtNoCap100, ref size, out _, IntPtr.Zero) != MoreData || size == 0) return result;
        var buf = Marshal.AllocHGlobal((int)size);
        try
        {
            if (PdhGetFormattedCounterArray(counter, FmtDouble | FmtNoCap100, ref size, out var count, buf) != 0) return result;
            int item = IntPtr.Size == 8 ? 24 : 16;
            for (int i = 0; i < count; i++)
            {
                var p = buf + i * item;
                var name = Marshal.PtrToStringUni(Marshal.ReadIntPtr(p));
                int status = Marshal.ReadInt32(p, IntPtr.Size);
                if (name == null || status != 0) continue; // 0 = gültig (neue Instanzen haben noch keinen Wert)
                var value = BitConverter.Int64BitsToDouble(Marshal.ReadInt64(p, item - 8));
                result[name] = result.GetValueOrDefault(name) + value;
            }
        }
        finally { Marshal.FreeHGlobal(buf); }
        return result;
    }

    public sealed record Gpu(double? Util, long? Mem);

    /// <summary>GPU-Last (höchste Engine-Art) und Grafikspeicher dieser Prozesse; luid null = alle Grafikkarten.</summary>
    public static Gpu ForProcesses(IReadOnlyCollection<int> pids, string luid)
    {
        lock (Gate)
        {
            if (!Collect()) return new Gpu(null, null);
            var byType = new Dictionary<string, double>();
            foreach (var (name, v) in engineValues)
            {
                var m = EngineName.Match(name);
                if (!m.Success || !pids.Contains(int.Parse(m.Groups[1].Value))) continue;
                if (luid != null && !m.Groups[2].Value.Equals(luid, StringComparison.OrdinalIgnoreCase)) continue;
                byType[m.Groups[3].Value] = byType.GetValueOrDefault(m.Groups[3].Value) + v;
            }
            long mem = 0;
            foreach (var (name, v) in procMemValues)
            {
                var m = ProcMemName.Match(name);
                if (!m.Success || !pids.Contains(int.Parse(m.Groups[1].Value))) continue;
                if (luid != null && !m.Groups[2].Value.Equals(luid, StringComparison.OrdinalIgnoreCase)) continue;
                mem += (long)v;
            }
            return new Gpu(Math.Min(100, Math.Round(byType.Values.DefaultIfEmpty(0).Max(), 1)), mem);
        }
    }

    /// <summary>Ganze Grafikkarte: Last (alle Prozesse, höchste Engine-Art) und belegter Grafikspeicher.</summary>
    public static Gpu ForAdapter(string luid)
    {
        lock (Gate)
        {
            if (!Collect() || luid == null) return new Gpu(null, null);
            var byType = new Dictionary<string, double>();
            foreach (var (name, v) in engineValues)
            {
                var m = EngineName.Match(name);
                if (m.Success && m.Groups[2].Value.Equals(luid, StringComparison.OrdinalIgnoreCase))
                    byType[m.Groups[3].Value] = byType.GetValueOrDefault(m.Groups[3].Value) + v;
            }
            long mem = 0;
            foreach (var (name, v) in adapterMemValues)
            {
                var m = AdapterMemName.Match(name);
                if (m.Success && m.Groups[1].Value.Equals(luid, StringComparison.OrdinalIgnoreCase)) mem += (long)v;
            }
            return new Gpu(Math.Min(100, Math.Round(byType.Values.DefaultIfEmpty(0).Max(), 1)), mem);
        }
    }

    /// <summary>Arbeitsspeicher (Working Set) und CPU-Last in % aller Kerne seit der letzten Abfrage.</summary>
    public static (long Ram, double Cpu) ForCpu(IReadOnlyCollection<int> pids)
    {
        long ram = 0;
        double pct = 0;
        var now = DateTime.UtcNow;
        lock (Gate)
        {
            foreach (var pid in pids)
            {
                try
                {
                    using var p = Process.GetProcessById(pid);
                    ram += p.WorkingSet64;
                    var t = p.TotalProcessorTime;
                    if (cpu.TryGetValue(pid, out var last) && (now - last.At).TotalSeconds >= 0.5)
                    {
                        var share = (t - last.Cpu).TotalSeconds / (now - last.At).TotalSeconds / Environment.ProcessorCount * 100;
                        cpu[pid] = (t, now, share);
                        pct += share;
                    }
                    else if (cpu.TryGetValue(pid, out last)) pct += last.Pct;
                    else cpu[pid] = (t, now, 0);
                }
                catch { /* Prozess beendet */ }
            }
            // Beendete Prozesse vergessen (mehrere Abfragen mit verschiedenen Prozessen teilen sich die Liste)
            foreach (var gone in cpu.Where(kv => now - kv.Value.At > TimeSpan.FromMinutes(1)).Select(kv => kv.Key).ToList()) cpu.Remove(gone);
        }
        return (ram, Math.Round(Math.Min(100, pct), 1));
    }

    /// <summary>Gesamter Arbeitsspeicher des PCs (Bytes).</summary>
    public static long TotalRam => GC.GetGCMemoryInfo().TotalAvailableMemoryBytes;
}
