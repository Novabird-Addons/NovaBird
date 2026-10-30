// Dienstbetrieb (optional; Standard bleibt das Programm im Benutzerkonto ohne Adminrechte).
//  - nbhelper.exe --service: wird vom Dienststeuerungs-Manager gestartet; Kern wie im Netz-Modus, Daten in %ProgramData%.
//  - nbhelper.exe --service-install / --service-remove: Einrichten bzw. Entfernen; brauchen Adminrechte (Aufruf über UAC
//    aus SwitchToService/SwitchToUser). Konto „NT SERVICE\NovaBirdHelper“ (virtuelles Dienstkonto, keine Anmeldung möglich).
//  - Umstellen übernimmt Einstellungen, Kopplungscode, PC-Liste, Benutzer der Web-Oberfläche und Modelle aus dem
//    Benutzerordner; Schlüssel werden dabei für den Rechner neu verschlüsselt (DPAPI), der Datenordner bekommt eigene Rechte.
using System.Diagnostics;
using System.Security.AccessControl;
using System.Security.Principal;
using System.ServiceProcess;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class Service : ServiceBase
{
    public const string Name = "NovaBirdHelper";
    const string DisplayName = "NovaBird Helper";
    static string ProgramDir => Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "NovaBird Helper");
    static string ServiceExe => Path.Combine(ProgramDir, "nbhelper.exe");
    static readonly string[] FirewallRules = { "NovaBird Helper (PCs)", "NovaBird Helper (Web)" };

    Core core;

    public Service() => ServiceName = Name;

    public static int RunService()
    {
        Settings.ServiceMode = true;
        Run(new Service());
        return 0;
    }

    protected override void OnStart(string[] args)
    {
        Settings.Migrate();
        var model = BuiltinModels.Default;
        core = new Core(model, Core.PortSetting, false);
        core.Start();
        if (model.Complete) core.Prepare(measureAgain: false);
        Log.Write($"Dienst gestartet ({Program.Version})");
    }

    protected override void OnStop()
    {
        core?.Stop();
        Log.Write("Dienst beendet");
    }

    public static bool IsInstalled()
    {
        try { return ServiceController.GetServices().Any(s => s.ServiceName == Name); }
        catch { return false; }
    }

    public static bool IsRunning()
    {
        try
        {
            using var sc = new ServiceController(Name);
            return sc.Status == ServiceControllerStatus.Running;
        }
        catch { return false; }
    }

    // ---- Umstellen (aus dem Benutzerkonto, fragt per UAC) ------------------------------------------------------------------
    /// <summary>Benutzerbetrieb → Dienst. Läuft im Benutzerprozess; der erhöhte Teil kommt aus --service-install.</summary>
    public static string SwitchToService()
    {
        // Schlüssel jetzt (als dieser Benutzer) entschlüsseln und für den erhöhten Prozess übergeben – nur über eine Datei,
        // die nur dieser Benutzer lesen kann und die der erhöhte Prozess sofort löscht.
        var handoff = Path.Combine(Path.GetTempPath(), $"nbhelper-handoff-{Guid.NewGuid():N}.json");
        var s = Settings.Load();
        var secrets = new JsonObject { ["userDir"] = Settings.UserDir };
        if (s["netCode"] is JsonNode c) secrets["netCode"] = Encoding.UTF8.GetString(Settings.Unprotect((string)c));
        File.WriteAllText(handoff, secrets.ToJsonString());
        try
        {
            int code = Elevated($"--service-install \"{handoff}\"");
            if (code != 0) return code == 1223 ? L.T("abgebrochen (UAC)", "cancelled (UAC)") : L.T($"fehlgeschlagen (Code {code}, siehe Protokoll)", $"failed (code {code}, see log)");
        }
        finally
        {
            if (File.Exists(handoff)) File.Delete(handoff);
        }
        // Benutzerseite: Netz-Modus nicht mehr selbst starten, stattdessen nur das Symbol
        Core.Autostart = false;
        SetTrayAutostart(true);
        Process.Start(new ProcessStartInfo(ServiceExe, "--tray") { UseShellExecute = false });
        return null;
    }

    /// <summary>Dienst → Benutzerbetrieb. Daten bleiben in %ProgramData% (für ein späteres Zurück) und im Benutzerordner.</summary>
    public static string SwitchToUser()
    {
        int code = Elevated("--service-remove");
        if (code != 0) return code == 1223 ? L.T("abgebrochen (UAC)", "cancelled (UAC)") : L.T($"fehlgeschlagen (Code {code}, siehe Protokoll)", $"failed (code {code}, see log)");
        SetTrayAutostart(false);
        return null;
    }

    static int Elevated(string args)
    {
        try
        {
            using var p = Process.Start(new ProcessStartInfo(Environment.ProcessPath, args) { UseShellExecute = true, Verb = "runas" });
            p.WaitForExit();
            return p.ExitCode;
        }
        catch (System.ComponentModel.Win32Exception e) when (e.NativeErrorCode == 1223)
        {
            return 1223; // UAC abgelehnt
        }
    }

    /// <summary>Update per Doppelklick: neue exe auch für den Dienst (erhöht). null = ok.</summary>
    public static string UpdateElevated()
    {
        int code = Elevated("--service-update");
        // Das Symbol (läuft aus derselben Datei) hat das Update beendet: als normaler Benutzer wieder starten
        if (code == 0 && TrayAutostart) Process.Start(new ProcessStartInfo(ServiceExe, "--tray") { UseShellExecute = false });
        return code == 0 ? null : code == 1223 ? L.T("abgebrochen (UAC)", "cancelled (UAC)") : L.T($"fehlgeschlagen (Code {code}, siehe Protokoll)", $"failed (code {code}, see log)");
    }

    public static int Update()
    {
        try
        {
            using (var sc = new ServiceController(Name))
            {
                if (sc.Status != ServiceControllerStatus.Stopped)
                {
                    sc.Stop();
                    sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
                }
                CopyProgram();
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            }
            Log.Write($"Dienst aktualisiert auf {Program.Version}");
            return 0;
        }
        catch (Exception e)
        {
            Log.Write("Dienst aktualisieren fehlgeschlagen: " + e);
            return 2;
        }
    }

    static void CopyProgram()
    {
        Directory.CreateDirectory(ProgramDir);
        var self = Environment.ProcessPath;
        StopTrays(); // das Symbol läuft aus derselben Datei und sperrt sie
        if (string.Equals(Path.GetFullPath(self), Path.GetFullPath(ServiceExe), StringComparison.OrdinalIgnoreCase)) return;
        CopyWhenFree(self, ServiceExe);
        #pragma warning disable IL3000 // gewollt: in der Einzeldatei leer = Release, sonst Testbau
        if (!string.IsNullOrEmpty(typeof(Service).Assembly.Location)) // Testbau: zugehörige Dateien mitnehmen
            foreach (var f in Directory.GetFiles(Path.GetDirectoryName(self), "*.dll").Concat(Directory.GetFiles(Path.GetDirectoryName(self), "nbhelper.*.json")))
                CopyWhenFree(f, Path.Combine(ProgramDir, Path.GetFileName(f)));
        #pragma warning restore IL3000
    }

    // „Beendet“ meldet der Dienst, kurz bevor sein Prozess die Dateien freigibt: bis zu 15 s nachversuchen
    static void CopyWhenFree(string src, string dst)
    {
        for (int i = 0; ; i++)
        {
            try
            {
                File.Copy(src, dst, true);
                return;
            }
            catch (IOException) when (i < 30)
            {
                Thread.Sleep(500);
            }
        }
    }

    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run", TrayValue = "NovaBird Helper (Symbol)";

    static bool TrayAutostart
    {
        get
        {
            using var k = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(TrayValue) != null;
        }
    }

    /// <summary>Symbole aus dem Programmordner des Dienstes beenden (vor dem Ersetzen der Dateien).</summary>
    static void StopTrays()
    {
        foreach (var p in Process.GetProcessesByName("nbhelper"))
        {
            try
            {
                if (p.Id != Environment.ProcessId && string.Equals(p.MainModule?.FileName, ServiceExe, StringComparison.OrdinalIgnoreCase)
                    && CommandLine(p)?.Contains("--tray") == true)
                {
                    p.Kill();
                    p.WaitForExit(5000);
                }
            }
            catch { /* anderer Benutzer o. Ä. */ }
        }
    }

    static void SetTrayAutostart(bool on)
    {
        using var k = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(RunKey);
        if (on) k.SetValue(TrayValue, $"\"{ServiceExe}\" --tray");
        else k.DeleteValue(TrayValue, false);
    }

    // ---- erhöht ------------------------------------------------------------------------------------------------------------
    public static int Install(string handoffPath)
    {
        try
        {
            var handoff = JsonNode.Parse(File.ReadAllText(handoffPath));
            File.Delete(handoffPath);
            StopAndDelete();
            // 1) Programm nach %ProgramFiles% (das Dienstkonto braucht einen Ort, den nur Admins ändern können)
            CopyProgram();
            // 2) Dienst anlegen (virtuelles Konto), Neustart bei Absturz
            Sc($"create {Name} binPath= \"\\\"{ServiceExe}\\\" --service\" start= auto obj= \"NT SERVICE\\{Name}\" DisplayName= \"{DisplayName}\"");
            Sc($"description {Name} \"Rechnet für NovaBird (semantische Suche, KI-Zusammenfassung) auf der Grafikkarte, auch für andere PCs im Netz.\"");
            Sc($"failure {Name} reset= 86400 actions= restart/5000/restart/30000//");
            // 3) Datenordner mit eigenen Rechten, Daten übernehmen
            PrepareDataDir();
            Migrate((string)handoff["userDir"], (string)handoff["netCode"]);
            // 4) Firewall: nur private Netzwerke
            Settings.ServiceMode = true;
            Firewall(Core.PortSetting, Core.WebPortSetting);
            // 5) laufenden Netz-Modus des Benutzers beenden, Dienst starten
            StopUserServers();
            using (var sc = new ServiceController(Name))
            {
                sc.Start();
                sc.WaitForStatus(ServiceControllerStatus.Running, TimeSpan.FromSeconds(30));
            }
            Log.Write("Dienst eingerichtet");
            return 0;
        }
        catch (Exception e)
        {
            Settings.ServiceMode = false;
            Log.Write("Dienst einrichten fehlgeschlagen: " + e);
            return 2;
        }
    }

    public static int Remove()
    {
        try
        {
            StopAndDelete();
            foreach (var r in FirewallRules) Netsh($"advfirewall firewall delete rule name=\"{r}\"", quiet: true); // fehlt sie, ist das kein Fehler
            Log.Write("Dienst entfernt");
            return 0;
        }
        catch (Exception e)
        {
            Log.Write("Dienst entfernen fehlgeschlagen: " + e);
            return 2;
        }
    }

    static void StopAndDelete()
    {
        if (!IsInstalled()) return;
        using (var sc = new ServiceController(Name))
        {
            if (sc.Status != ServiceControllerStatus.Stopped)
            {
                sc.Stop();
                sc.WaitForStatus(ServiceControllerStatus.Stopped, TimeSpan.FromSeconds(30));
            }
        }
        Sc($"delete {Name}");
        for (int i = 0; i < 50 && IsInstalled(); i++) Thread.Sleep(100);
    }

    static void StopUserServers()
    {
        foreach (var p in Process.GetProcessesByName("nbhelper"))
        {
            try
            {
                if (p.Id == Environment.ProcessId) continue;
                // nur Netz-Modus/Symbol aus dem Benutzerbetrieb, nicht den Native-Messaging-Host von Thunderbird
                if (CommandLine(p) is string cl && cl.Contains("--server") && !cl.Contains("--service")) p.Kill();
            }
            catch { /* anderer Benutzer o. Ä. */ }
        }
    }

    public static string CommandLine(Process p)
    {
        using var q = new System.Management.ManagementObjectSearcher($"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {p.Id}");
        return q.Get().Cast<System.Management.ManagementObject>().FirstOrDefault()?["CommandLine"] as string;
    }

    /// <summary>%ProgramData%\NovaBird\Helper: Vererbung aus, Vollzugriff SYSTEM und Administratoren, Ändern für das Dienstkonto.</summary>
    static void PrepareDataDir()
    {
        var dir = Directory.CreateDirectory(Settings.ServiceDir);
        var acl = new DirectorySecurity();
        acl.SetAccessRuleProtection(true, false);
        var inherit = InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit;
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.LocalSystemSid, null), FileSystemRights.FullControl, inherit, PropagationFlags.None, AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(new SecurityIdentifier(WellKnownSidType.BuiltinAdministratorsSid, null), FileSystemRights.FullControl, inherit, PropagationFlags.None, AccessControlType.Allow));
        acl.AddAccessRule(new FileSystemAccessRule(new NTAccount("NT SERVICE", Name), FileSystemRights.Modify, inherit, PropagationFlags.None, AccessControlType.Allow));
        dir.SetAccessControl(acl);
    }

    /// <summary>Daten aus dem Benutzerordner übernehmen (nur, was im Dienstordner noch fehlt bzw. älter ist).</summary>
    static void Migrate(string userDir, string netCode)
    {
        var target = Settings.ServiceDir;
        if (string.IsNullOrEmpty(userDir) || !Directory.Exists(userDir)) return;
        // Einstellungen: alles außer benutzergebundenen Schlüsseln; Kopplungscode für den Rechner neu verschlüsseln
        var src = Path.Combine(userDir, "settings.json");
        if (File.Exists(src) && !File.Exists(Path.Combine(target, "settings.json")))
        {
            var s = JsonNode.Parse(File.ReadAllText(src)).AsObject();
            foreach (var key in new[] { "netCode", "syncKey", "syncFolder", "webCertPass", "netWelcomed" }) s.Remove(key);
            if (!string.IsNullOrEmpty(netCode)) s["netCode"] = Settings.Protect(Encoding.UTF8.GetBytes(netCode), machine: true);
            s["migratedFromUser"] = DateTime.Now.ToString("yyyy-MM-dd HH:mm");
            File.WriteAllText(Path.Combine(target, "settings.json"), s.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
        }
        foreach (var f in new[] { "clients.json", "users.json" })
            if (File.Exists(Path.Combine(userDir, f)) && !File.Exists(Path.Combine(target, f))) File.Copy(Path.Combine(userDir, f), Path.Combine(target, f));
        // Modelle kopieren (der Native-Messaging-Host im Benutzerkonto braucht seine weiter)
        var models = Path.Combine(userDir, "models");
        if (Directory.Exists(models))
            foreach (var f in Directory.GetFiles(models, "*", SearchOption.AllDirectories))
            {
                var dst = Path.Combine(target, "models", Path.GetRelativePath(models, f));
                if (File.Exists(dst) && new FileInfo(dst).Length == new FileInfo(f).Length) continue;
                Directory.CreateDirectory(Path.GetDirectoryName(dst));
                File.Copy(f, dst, true);
            }
        Log.Write("Daten aus dem Benutzerordner übernommen");
    }

    static void Firewall(int netPort, int webPort)
    {
        foreach (var r in FirewallRules) Netsh($"advfirewall firewall delete rule name=\"{r}\"", quiet: true); // fehlt sie, ist das kein Fehler
        Netsh($"advfirewall firewall add rule name=\"{FirewallRules[0]}\" dir=in action=allow protocol=TCP localport={netPort} profile=private program=\"{ServiceExe}\"");
        Netsh($"advfirewall firewall add rule name=\"{FirewallRules[1]}\" dir=in action=allow protocol=TCP localport={webPort} profile=private program=\"{ServiceExe}\"");
    }

    static void Sc(string args) => Tool("sc.exe", args, check: true);
    static void Netsh(string args, bool quiet = false) => Tool("netsh.exe", args, check: false, quiet);

    static void Tool(string exe, string args, bool check, bool quiet = false)
    {
        using var p = Process.Start(new ProcessStartInfo(exe, args) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true });
        var output = p.StandardOutput.ReadToEnd() + p.StandardError.ReadToEnd();
        p.WaitForExit();
        if (p.ExitCode != 0)
        {
            if (!quiet) Log.Write($"{exe} {args.Split(' ')[0]}: Code {p.ExitCode} {output.Trim()}");
            if (check) throw new InvalidOperationException($"{exe} {args.Split(' ')[0]} fehlgeschlagen ({p.ExitCode})");
        }
    }
}
