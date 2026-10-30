// Einstellungen des Helpers: settings.json im Datenordner (gewähltes Gerät, Messwerte, Sync-Ordner, Gerätekennung, Netz und
// Web-Oberfläche). Datenordner: %LOCALAPPDATA%\NovaBird\Helper, als Dienst %ProgramData%\NovaBird\Helper. Schlüssel liegen
// mit DPAPI verschlüsselt darin (nur dieser Windows-Benutzer bzw. als Dienst nur dieser Rechner kann sie lesen).
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class Settings
{
    /// <summary>Läuft als Windows-Dienst: Daten unter %ProgramData%, Schlüssel mit DPAPI für den Rechner statt für den Benutzer.</summary>
    public static bool ServiceMode;

    // NOVABIRD_HELPER_DIR nur für Tests (anderer Datenordner, z. B. zwei „PCs“ auf einem Rechner)
    public static string Dir => Environment.GetEnvironmentVariable("NOVABIRD_HELPER_DIR") is { Length: > 0 } d ? d
        : ServiceMode ? ServiceDir : UserDir;
    public static string UserDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NovaBird", "Helper");
    public static string ServiceDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "NovaBird", "Helper");
    static string FilePath => Path.Combine(Dir, "settings.json");

    // ---- Schema: Version der Einstellungen; ältere Stände werden beim Start umgestellt ------------------------------------------
    public const int Schema = 2; // 1 = Helper 0.1–0.3 (ohne Angabe), 2 = 0.4 (Web-Oberfläche, Dienst)

    public static void Migrate()
    {
        var s = Load();
        int from = (int?)s["schema"] ?? 1;
        if (from >= Schema) return;
        // 1 → 2: alles bleibt, neu sind nur Angaben mit Vorgabe (webPort, webLan, chatModel); Benutzer stehen in users.json
        s["schema"] = Schema;
        s["migratedFrom"] = $"{from} ({DateTime.Now:yyyy-MM-dd HH:mm})";
        Save(s);
        Log.Write($"Einstellungen umgestellt: Schema {from} → {Schema}");
    }

    public static JsonObject Load()
    {
        try
        {
            if (File.Exists(FilePath) && JsonNode.Parse(File.ReadAllText(FilePath)) is JsonObject o) return o;
        }
        catch (Exception e) { Log.Write("settings.json unlesbar: " + e.Message); }
        return new JsonObject();
    }

    public static void Save(JsonObject o)
    {
        Directory.CreateDirectory(Dir);
        var tmp = FilePath + ".tmp";
        File.WriteAllText(tmp, o.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        File.Move(tmp, FilePath, true);
    }

    public static string DeviceId()
    {
        var s = Load();
        var id = (string)s["deviceId"];
        if (string.IsNullOrEmpty(id))
        {
            id = Guid.NewGuid().ToString("N")[..12];
            s["deviceId"] = id;
            Save(s);
        }
        return id;
    }

    // ---- DPAPI (CryptProtectData, Bereich aktueller Benutzer) ---------------------------------------------------------------
    [StructLayout(LayoutKind.Sequential)]
    struct Blob { public int Size; public IntPtr Data; }

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CryptProtectData(ref Blob input, string description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);

    [DllImport("crypt32.dll", SetLastError = true, CharSet = CharSet.Unicode)]
    static extern bool CryptUnprotectData(ref Blob input, IntPtr description, IntPtr entropy, IntPtr reserved, IntPtr prompt, int flags, out Blob output);

    [DllImport("kernel32.dll")]
    static extern IntPtr LocalFree(IntPtr mem);

    const int UiForbidden = 0x1, LocalMachine = 0x4;

    // Dienst: Bereich Rechner (der Datenordner ist nur für SYSTEM, Administratoren und das Dienstkonto lesbar)
    public static string Protect(byte[] data) => Protect(data, ServiceMode);

    public static string Protect(byte[] data, bool machine)
    {
        var input = new Blob { Size = data.Length, Data = Marshal.AllocHGlobal(data.Length) };
        try
        {
            Marshal.Copy(data, 0, input.Data, data.Length);
            if (!CryptProtectData(ref input, "NovaBird Helper", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden | (machine ? LocalMachine : 0), out var output))
                throw new InvalidOperationException("DPAPI: " + Marshal.GetLastWin32Error());
            var bytes = new byte[output.Size];
            Marshal.Copy(output.Data, bytes, 0, output.Size);
            LocalFree(output.Data);
            return Convert.ToBase64String(bytes);
        }
        finally { Marshal.FreeHGlobal(input.Data); }
    }

    public static byte[] Unprotect(string b64)
    {
        var data = Convert.FromBase64String(b64);
        var input = new Blob { Size = data.Length, Data = Marshal.AllocHGlobal(data.Length) };
        try
        {
            Marshal.Copy(data, 0, input.Data, data.Length);
            if (!CryptUnprotectData(ref input, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out var output))
                throw new InvalidOperationException("DPAPI: " + Marshal.GetLastWin32Error());
            var bytes = new byte[output.Size];
            Marshal.Copy(output.Data, bytes, 0, output.Size);
            LocalFree(output.Data);
            return bytes;
        }
        finally { Marshal.FreeHGlobal(input.Data); }
    }

    // ---- Stromversorgung (Akku: Altbestand pausiert im Add-on) ---------------------------------------------------------------
    [StructLayout(LayoutKind.Sequential)]
    struct PowerStatus { public byte ACLineStatus, BatteryFlag, BatteryLifePercent, SystemStatusFlag; public int BatteryLifeTime, BatteryFullLifeTime; }

    [DllImport("kernel32.dll")]
    static extern bool GetSystemPowerStatus(out PowerStatus status);

    public static bool OnBattery() => GetSystemPowerStatus(out var p) && p.ACLineStatus == 0;
}
