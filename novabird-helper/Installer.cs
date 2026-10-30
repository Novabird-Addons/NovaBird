// Installation pro Benutzer, ohne Adminrechte, wie ein normales Windows-Programm:
//  - nbhelper.exe nach %LOCALAPPDATA%\Programs\NovaBird Helper\
//  - Manifest novabird_helper.json daneben, Eintrag HKCU\Software\Mozilla\NativeMessagingHosts\novabird_helper (Thunderbird
//    sucht dort; nur NovaBird-Search darf den Helper starten)
//  - Eintrag unter „Installierte Apps“ (HKCU …\Uninstall\NovaBirdHelper) mit Deinstallation
//  - Startmenü: „NovaBird Helper (Netz)“ startet den Netz-Modus (nbhelper.exe --server, Symbol im Infobereich)
// Doppelklick auf nbhelper.exe fragt, ob installiert bzw. entfernt werden soll.
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace NovaBird.Helper;

static class Installer
{
    const string Title = "NovaBird Helper";
    const string HostKey = @"Software\Mozilla\NativeMessagingHosts\" + Program.HostName;
    const string UninstallKey = @"Software\Microsoft\Windows\CurrentVersion\Uninstall\NovaBirdHelper";
    static string InstallDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "NovaBird Helper");
    static string InstalledExe => Path.Combine(InstallDir, "nbhelper.exe");
    public static string InstalledExePath => InstalledExe;
    static string ManifestPath => Path.Combine(InstallDir, Program.HostName + ".json");
    static string ShortcutPath => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Programs), "NovaBird Helper (Netz).lnk");

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    static extern int MessageBoxW(IntPtr hwnd, string text, string caption, uint type);
    const uint MbOk = 0, MbYesNo = 4, MbIconInfo = 0x40, MbIconQuestion = 0x20, MbIconError = 0x10;
    const int IdYes = 6;

    static bool Ask(string text) => MessageBoxW(IntPtr.Zero, text, Title, MbYesNo | MbIconQuestion) == IdYes;
    static void Tell(string text, bool error = false) => MessageBoxW(IntPtr.Zero, text, Title, MbOk | (error ? MbIconError : MbIconInfo));

    public static bool IsInstalled()
    {
        using var k = Registry.CurrentUser.OpenSubKey(HostKey);
        return k?.GetValue("") is string p && File.Exists(p);
    }

    static string InstalledVersion()
    {
        using var k = Registry.CurrentUser.OpenSubKey(UninstallKey);
        return k?.GetValue("DisplayVersion") as string;
    }

    public static int Interactive()
    {
        if (IsInstalled() && !string.Equals(Path.GetFullPath(Environment.ProcessPath), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase))
        {
            // Andere Datei als die installierte gestartet: aktualisieren (ein laufender Netz-Modus wird dafür beendet)
            bool service = Service.IsInstalled();
            if (!Ask(L.T($"NovaBird Helper {InstalledVersion() ?? "?"} ist installiert.\n\nDurch Version {Program.Version} ersetzen? Modelle, Einstellungen, PC-Liste und " +
                         "Benutzer der Web-Oberfläche bleiben erhalten; ein laufender Netz-Modus startet danach neu." +
                         (service ? "\n\nDer Windows-Dienst wird mit aktualisiert (Windows fragt nach Adminrechten)." : ""),
                     $"NovaBird Helper {InstalledVersion() ?? "?"} is installed.\n\nReplace it with version {Program.Version}? Models, settings, list of PCs and " +
                         "users of the web interface are kept; a running network mode restarts afterwards." +
                         (service ? "\n\nThe Windows service is updated too (Windows asks for admin rights)." : "")))) return 0;
            bool wasRunning = StopOthers();
            Thread.Sleep(500);
            if (!Install(false)) return 1;
            if (service && Service.UpdateElevated() is string err) Tell(L.T("Der Windows-Dienst wurde nicht aktualisiert: ", "The Windows service was not updated: ") + err, true);
            if (wasRunning && !service) System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(InstalledExe, "--server") { UseShellExecute = false });
            return 0;
        }
        if (IsInstalled())
        {
            if (!Ask(L.T($"NovaBird Helper {Program.Version} ist installiert.\n\nJetzt entfernen?", $"NovaBird Helper {Program.Version} is installed.\n\nRemove it now?"))) return 0;
            bool all = Ask(L.T("Auch die geladenen Modelle und Einstellungen löschen?\n\n(Nein: bleiben für eine spätere Installation erhalten.)", "Also delete the downloaded models and settings?\n\n(No: they are kept for a later installation.)"));
            return Uninstall(false, all) ? 0 : 1;
        }
        if (!Ask(L.T($"NovaBird Helper {Program.Version} installieren?\n\nDer Helper rechnet für die semantische Suche von NovaBird-Search auf der Grafikkarte " +
                     "(DirectML). Er wird nur für diesen Windows-Benutzer installiert, braucht keine Adminrechte und startet nur, wenn " +
                     "NovaBird-Search ihn braucht.\n\nZiel: " + InstallDir,
                 $"Install NovaBird Helper {Program.Version}?\n\nThe helper computes the semantic search of NovaBird-Search on the graphics card " +
                     "(DirectML). It is installed for this Windows user only, needs no admin rights and only starts when " +
                     "NovaBird-Search needs it.\n\nTarget: " + InstallDir))) return 0;
        return Install(false) ? 0 : 1;
    }

    public static bool Install(bool quiet)
    {
        try
        {
            Directory.CreateDirectory(InstallDir);
            var self = Environment.ProcessPath;
            if (!string.Equals(Path.GetFullPath(self), Path.GetFullPath(InstalledExe), StringComparison.OrdinalIgnoreCase))
            {
                File.Copy(self, InstalledExe, true);
                // Testbau (keine Einzeldatei): die zugehörigen Dateien mitnehmen, nur diese (nicht den ganzen Ordner)
                #pragma warning disable IL3000 // gewollt: in der Einzeldatei leer = Release, sonst Testbau
                if (!string.IsNullOrEmpty(typeof(Installer).Assembly.Location))
                {
                    var src = Path.GetDirectoryName(self);
                    foreach (var f in Directory.GetFiles(src, "*.dll").Concat(Directory.GetFiles(src, "nbhelper.*.json")))
                        File.Copy(f, Path.Combine(InstallDir, Path.GetFileName(f)), true);
                }
                #pragma warning restore IL3000
            }
            var manifest = new JsonObject
            {
                ["name"] = Program.HostName,
                ["description"] = "NovaBird Helper (semantische Suche, DirectML)",
                ["path"] = InstalledExe,
                ["type"] = "stdio",
                ["allowed_extensions"] = new JsonArray(Program.ExtensionId),
            };
            File.WriteAllText(ManifestPath, manifest.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            using (var k = Registry.CurrentUser.CreateSubKey(HostKey)) k.SetValue("", ManifestPath);
            Shortcut(ShortcutPath, InstalledExe, "--server", "NovaBird Helper im Netz-Modus: rechnet für andere PCs");
            using (var k = Registry.CurrentUser.CreateSubKey(UninstallKey))
            {
                k.SetValue("DisplayName", "NovaBird Helper");
                k.SetValue("DisplayVersion", Program.Version);
                k.SetValue("Publisher", "NovaBird");
                k.SetValue("InstallLocation", InstallDir);
                k.SetValue("DisplayIcon", InstalledExe);
                k.SetValue("UninstallString", $"\"{InstalledExe}\" --uninstall");
                k.SetValue("QuietUninstallString", $"\"{InstalledExe}\" --uninstall --quiet");
                k.SetValue("NoModify", 1, RegistryValueKind.DWord);
                k.SetValue("NoRepair", 1, RegistryValueKind.DWord);
                k.SetValue("EstimatedSize", (int)(new FileInfo(InstalledExe).Length / 1024), RegistryValueKind.DWord);
                k.SetValue("InstallDate", DateTime.Now.ToString("yyyyMMdd"));
            }
            Log.Write("installiert: " + InstallDir);
            if (!quiet)
                Tell(L.T("NovaBird Helper ist installiert.\n\nIn Thunderbird: Einstellungen von NovaBird-Search → Semantische Suche → Erweitert → „Helper verbinden“, " +
                         "danach „Modell im Helper laden“. Der Helper misst dabei CPU und Grafikkarten und nimmt das schnellste Gerät.\n\n" +
                         "Soll dieser PC auch für andere PCs rechnen: Startmenü → „NovaBird Helper (Netz)“.",
                     "NovaBird Helper is installed.\n\nIn Thunderbird: settings of NovaBird-Search → Semantic search → Advanced → \"Connect helper\", " +
                         "then \"Load model in the helper\". The helper measures CPU and graphics cards and uses the fastest device.\n\n" +
                         "If this PC should also compute for other PCs: Start menu → \"NovaBird Helper (Netz)\"."));
            return true;
        }
        catch (Exception e)
        {
            Log.Write("Installation fehlgeschlagen: " + e);
            if (!quiet) Tell(L.T("Installation fehlgeschlagen:\n", "Installation failed:\n") + e.Message, true);
            return false;
        }
    }

    public static bool Uninstall(bool quiet, bool removeData = false)
    {
        try
        {
            if (!quiet && !removeData && Environment.GetCommandLineArgs().Contains("--uninstall"))
            {
                // Aufruf aus „Installierte Apps“: einmal nachfragen
                if (!Ask(L.T("NovaBird Helper entfernen?", "Remove NovaBird Helper?"))) return false;
                removeData = Ask(L.T("Auch die geladenen Modelle und Einstellungen löschen?", "Also delete the downloaded models and settings?"));
            }
            StopOthers();
            if (Service.IsInstalled() && Service.SwitchToUser() is string err && !quiet) Tell(L.T("Der Windows-Dienst wurde nicht entfernt: ", "The Windows service was not removed: ") + err, true);
            Tray.RemoveAutostart();
            if (File.Exists(ShortcutPath)) File.Delete(ShortcutPath);
            Registry.CurrentUser.DeleteSubKeyTree(HostKey, false);
            Registry.CurrentUser.DeleteSubKeyTree(UninstallKey, false);
            if (File.Exists(ManifestPath)) File.Delete(ManifestPath);
            if (removeData && Directory.Exists(Settings.Dir)) Directory.Delete(Settings.Dir, true);
            // Die laufende Datei kann sich nicht selbst löschen: kurz danach per cmd aufräumen
            if (Directory.Exists(InstallDir))
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "cmd.exe",
                    Arguments = $"/c ping -n 3 127.0.0.1 >nul & rmdir /s /q \"{InstallDir}\"",
                    CreateNoWindow = true,
                    UseShellExecute = false,
                });
            }
            Log.Write("entfernt");
            if (!quiet) Tell(L.T("NovaBird Helper wurde entfernt.", "NovaBird Helper has been removed."));
            return true;
        }
        catch (Exception e)
        {
            Log.Write("Entfernen fehlgeschlagen: " + e);
            if (!quiet) Tell(L.T("Entfernen fehlgeschlagen:\n", "Removing failed:\n") + e.Message, true);
            return false;
        }
    }

    // Laufende Helper aus dem Installationsordner (z. B. der Netz-Modus) beenden, damit der Ordner gelöscht werden kann.
    // true = der Netz-Modus lief (dann nach dem Update neu starten).
    static bool StopOthers()
    {
        bool server = false;
        foreach (var p in System.Diagnostics.Process.GetProcessesByName("nbhelper"))
        {
            try
            {
                if (p.Id != Environment.ProcessId && string.Equals(Path.GetDirectoryName(p.MainModule?.FileName), InstallDir, StringComparison.OrdinalIgnoreCase))
                {
                    server |= Service.CommandLine(p)?.Contains("--server") == true;
                    p.Kill();
                }
            }
            catch { /* anderer Benutzer o. Ä. */ }
        }
        return server;
    }

    // ---- Verknüpfung (Shell Link über COM) -----------------------------------------------------------------------------------
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    class ShellLink { }

    [ComImport, InterfaceType(ComInterfaceType.InterfaceIsIUnknown), Guid("000214F9-0000-0000-C000-000000000046")]
    interface IShellLinkW
    {
        void GetPath([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder file, int max, IntPtr data, int flags);
        void GetIDList(out IntPtr pidl);
        void SetIDList(IntPtr pidl);
        void GetDescription([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder name, int max);
        void SetDescription([MarshalAs(UnmanagedType.LPWStr)] string name);
        void GetWorkingDirectory([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder dir, int max);
        void SetWorkingDirectory([MarshalAs(UnmanagedType.LPWStr)] string dir);
        void GetArguments([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder args, int max);
        void SetArguments([MarshalAs(UnmanagedType.LPWStr)] string args);
        void GetHotkey(out short key);
        void SetHotkey(short key);
        void GetShowCmd(out int cmd);
        void SetShowCmd(int cmd);
        void GetIconLocation([Out, MarshalAs(UnmanagedType.LPWStr)] StringBuilder path, int max, out int index);
        void SetIconLocation([MarshalAs(UnmanagedType.LPWStr)] string path, int index);
        void SetRelativePath([MarshalAs(UnmanagedType.LPWStr)] string rel, int reserved);
        void Resolve(IntPtr hwnd, int flags);
        void SetPath([MarshalAs(UnmanagedType.LPWStr)] string file);
    }

    public static bool Shortcut(string lnk, string target, string args, string description)
    {
        try
        {
            var link = (IShellLinkW)new ShellLink();
            link.SetPath(target);
            link.SetArguments(args);
            link.SetDescription(description);
            link.SetWorkingDirectory(Path.GetDirectoryName(target));
            link.SetIconLocation(target, 0);
            Directory.CreateDirectory(Path.GetDirectoryName(lnk));
            ((IPersistFile)link).Save(lnk, true);
            return true;
        }
        catch (Exception e)
        {
            Log.Write("Verknüpfung: " + e.Message);
            return false;
        }
    }
}
