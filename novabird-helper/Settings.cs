// Einstellungen des Helpers: %LOCALAPPDATA%\NovaBird\Helper\settings.json (gewähltes Gerät, Messwerte, Sync-Ordner,
// Gerätekennung). Der Sync-Schlüssel liegt mit DPAPI verschlüsselt darin (nur dieser Windows-Benutzer kann ihn lesen).
using System.Runtime.InteropServices;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class Settings
{
    // NOVABIRD_HELPER_DIR nur für Tests (anderer Datenordner, z. B. zwei „PCs“ auf einem Rechner)
    public static string Dir => Environment.GetEnvironmentVariable("NOVABIRD_HELPER_DIR") is { Length: > 0 } d ? d
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "NovaBird", "Helper");
    static string FilePath => Path.Combine(Dir, "settings.json");

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

    const int UiForbidden = 0x1;

    public static string Protect(byte[] data)
    {
        var input = new Blob { Size = data.Length, Data = Marshal.AllocHGlobal(data.Length) };
        try
        {
            Marshal.Copy(data, 0, input.Data, data.Length);
            if (!CryptProtectData(ref input, "NovaBird Helper", IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, UiForbidden, out var output))
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
