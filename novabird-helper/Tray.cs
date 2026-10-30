// Symbol im Infobereich.
//  - nbhelper.exe --server: Netz-Modus im Benutzerkonto (Kern: Core.cs). Klick auf das Symbol öffnet die Web-Oberfläche
//    (WebServer.cs); das Kontextmenü hat nur das Nötigste. Läuft nur einmal je Benutzer.
//  - nbhelper.exe --tray: nur das Symbol, wenn der Kern als Windows-Dienst läuft (Service.cs); fragt den Dienst über
//    http://localhost/api/ping nach dem Zustand.
//  - nbhelper.exe --server-console: Kern ohne Oberfläche (Tests; Ausgabe als JSON-Zeilen, Befehle auf stdin, Ende mit EOF).
using System.Diagnostics;
using System.Net.Http;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class Tray
{
    public const string Title = "NovaBird Helper";

    // NOVABIRD_NET_LOOPBACK=1: nur auf diesem PC erreichbar (Tests, keine Firewall-Abfrage)
    static bool LoopbackOnly => Environment.GetEnvironmentVariable("NOVABIRD_NET_LOOPBACK") == "1";

    public static int PortSetting() =>
        int.TryParse(Environment.GetEnvironmentVariable("NOVABIRD_NET_PORT"), out var p) ? p : Core.PortSetting;

    // ---- ohne Oberfläche (Tests) ------------------------------------------------------------------------------------------
    public static int RunConsole(bool loopback)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        Settings.Migrate();
        var model = BuiltinModels.Default;
        if (!model.Complete) { Console.WriteLine(new JsonObject { ["error"] = "Modell fehlt" }.ToJsonString()); return 1; }
        var core = new Core(model, PortSetting(), loopback || LoopbackOnly);
        core.Start();
        var server = core.Server;
        if (!ModelStore.Ready(model)) server.Scheduler.Run(() => ModelStore.Measure(model)).Wait();
        Console.WriteLine(new JsonObject { ["port"] = server.Port, ["webPort"] = core.Web.Port, ["code"] = NetServer.Code(), ["ready"] = ModelStore.Ready(model) }.ToJsonString());
        Console.Out.Flush();
        // Befehle auf stdin (eine Zeile je Befehl), Ende mit EOF
        string line;
        while ((line = Console.ReadLine()) != null)
        {
            var reply = line.Trim() switch
            {
                "status" => Status(server),
                "pause" => Do(() => server.Scheduler.Paused = true, server),
                "resume" => Do(() => server.Scheduler.Paused = false, server),
                "renew" => new JsonObject { ["code"] = server.Renew() },
                "measure" => Do(() => server.Scheduler.Run(() => ModelStore.Measure(model)).Wait(), server),
                "cpu on" => Do(() => server.Scheduler.CpuEnabled = true, server),
                "cpu off" => Do(() => server.Scheduler.CpuEnabled = false, server),
                var t when t.StartsWith("threads ") && int.TryParse(t[8..], out var n) => Do(() => server.Scheduler.CpuThreadsSetting = n, server),
                _ => new JsonObject { ["error"] = "unbekannt" },
            };
            Console.WriteLine(reply.ToJsonString());
            Console.Out.Flush();
        }
        core.Stop();
        return 0;
    }

    static JsonObject Do(Action a, NetServer s)
    {
        a();
        return Status(s);
    }

    static JsonObject Status(NetServer s) => new()
    {
        ["paused"] = s.Scheduler.Paused,
        ["queue"] = s.Scheduler.QueueLength,
        ["rate"] = s.Scheduler.Rates.All,
        ["rateGpu"] = s.Scheduler.Rates.Gpu,
        ["rateCpu"] = s.Scheduler.Rates.Cpu,
        ["cpu"] = s.Scheduler.CpuEnabled,
        ["cpuThreads"] = s.Scheduler.CpuThreads,
        ["cpuBlocked"] = Scheduler.CpuBlocked(),
        ["cpuAgree"] = (double?)Settings.Load()["cpuAgree"],
        ["clients"] = new JsonArray(s.Scheduler.Clients().Select(c => (JsonNode)new JsonObject
        {
            ["id"] = c.Id, ["label"] = c.Label, ["today"] = c.Today, ["total"] = c.Total, ["indexed"] = c.Indexed, ["mails"] = c.Mails,
        }).ToArray()),
    };

    // ---- mit Symbol im Infobereich ------------------------------------------------------------------------------------------
    static void InitUi()
    {
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
    }

    public static int Run()
    {
        using var single = new Mutex(true, @"Local\NovaBird.Helper.Net", out bool first);
        if (!first)
        {
            MessageBox.Show(L.T("Der Netz-Modus des NovaBird Helpers läuft schon (Symbol im Infobereich).", "The network mode of the NovaBird Helper is already running (icon in the notification area)."), Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        if (Service.IsInstalled())
        {
            MessageBox.Show(L.T("Der NovaBird Helper ist als Windows-Dienst eingerichtet; der Netz-Modus läuft dort. Das Symbol startet mit „nbhelper.exe --tray“.", "The NovaBird Helper is set up as a Windows service; the network mode runs there. The icon starts with \"nbhelper.exe --tray\"."),
                Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        InitUi();
        Settings.Migrate();
        var model = BuiltinModels.Default;
        var core = new Core(model, PortSetting(), LoopbackOnly);
        try
        {
            core.Start();
        }
        catch (Exception e)
        {
            MessageBox.Show(L.T($"Der Netz-Modus konnte nicht starten (Port {PortSetting()}):\n{e.Message}", $"The network mode could not start (port {PortSetting()}):\n{e.Message}"), Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Application.Run(new TrayContext(core));
        core.Stop();
        return 0;
    }

    public static void OpenWeb(int port) => Process.Start(new ProcessStartInfo($"http://localhost:{port}/") { UseShellExecute = true });

    /// <summary>Netz-Modus im Benutzerkonto: Kern läuft in diesem Prozess.</summary>
    sealed class TrayContext : ApplicationContext
    {
        readonly Core core;
        readonly NotifyIcon icon;
        readonly ToolStripMenuItem status = new() { Enabled = false }, pause;
        readonly System.Windows.Forms.Timer timer = new() { Interval = 2000 };

        public TrayContext(Core core)
        {
            this.core = core;
            core.Exit = ExitThread;
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem($"{Title} {Program.Version} – {L.T("Netz-Modus", "network mode")}") { Enabled = false });
            menu.Items.Add(status);
            menu.Items.Add(new ToolStripSeparator());
            var open = new ToolStripMenuItem(L.T("Web-Oberfläche öffnen", "Open web interface"), null, (_, _) => OpenWeb(core.Web.Port));
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);
            menu.Items.Add(L.T("Kopplungscode kopieren", "Copy pairing code"), null, (_, _) => Clipboard.SetText(NetServer.Code()));
            pause = new ToolStripMenuItem(L.T("Pause (nur Suchanfragen beantworten)", "Pause (answer searches only)"), null, (_, _) => core.Server.Scheduler.Paused = !core.Server.Scheduler.Paused);
            menu.Items.Add(pause);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(L.T("Als Windows-Dienst einrichten …", "Set up as Windows service …"), null, (_, _) => ToService());
            menu.Items.Add(L.T("Netz-Modus beenden", "Quit network mode"), null, (_, _) => ExitThread());
            menu.Opening += (_, _) => Refresh();
            icon = new NotifyIcon
            {
                Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath) ?? SystemIcons.Application,
                ContextMenuStrip = menu,
                Visible = true,
            };
            icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenWeb(core.Web.Port); };
            core.Notify = (text, error) => icon.ShowBalloonTip(error ? 8000 : 5000, Title, text, error ? ToolTipIcon.Error : ToolTipIcon.Info);
            timer.Tick += (_, _) => Refresh();
            timer.Start();
            Refresh();
            var s = Settings.Load();
            if (s["netWelcomed"] == null || !Users.Any())
            {
                s["netWelcomed"] = true;
                Settings.Save(s);
                icon.ShowBalloonTip(8000, Title, Users.Any() ? L.T("Der Netz-Modus läuft. Bedienung: Klick auf das Symbol.", "The network mode is running. Click the icon to open it.")
                    : L.T("Der Netz-Modus läuft. Lege in der Web-Oberfläche den ersten Admin an (öffnet sich jetzt).", "The network mode is running. Create the first admin in the web interface (opening now)."), ToolTipIcon.Info);
                if (!Users.Any()) OpenWeb(core.Web.Port);
            }
            if (!core.Model.Complete)
            {
                if (MessageBox.Show(L.T("Für den Netz-Modus braucht der Helper das Modell jina-embeddings-v2-base-de (etwa 320 MB von Hugging Face, " +
                                        "feste Version, jede Datei mit Prüfsumme).\n\nJetzt laden?",
                                    "For the network mode the helper needs the model jina-embeddings-v2-base-de (about 320 MB from Hugging Face, " +
                                        "fixed version, every file with checksum).\n\nDownload now?"), Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) == DialogResult.Yes)
                    core.Prepare(measureAgain: false);
            }
            else core.Prepare(measureAgain: false);
        }

        void ToService()
        {
            if (MessageBox.Show(L.T("Den Helper als Windows-Dienst einrichten?\n\nDann läuft der Netz-Modus auch ohne Anmeldung an Windows. Windows fragt gleich nach " +
                                    "Adminrechten. Einstellungen, Kopplungscode, PC-Liste, Benutzer der Web-Oberfläche und Modelle werden übernommen.",
                                "Set up the helper as a Windows service?\n\nThen the network mode runs even without anyone signed in to Windows. Windows will ask for " +
                                    "admin rights. Settings, pairing code, list of PCs, users of the web interface and models are taken over."),
                    Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            // Ports freigeben, bevor der Dienst startet; bei Fehler wieder aufnehmen
            core.Stop();
            var error = Service.SwitchToService();
            if (error == null) { ExitThread(); return; }
            MessageBox.Show(L.T("Als Dienst einrichten ", "Setting up the service ") + error + ".", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            core.Start();
        }

        void Refresh()
        {
            var state = core.StateText();
            status.Text = state;
            pause.Checked = core.Server.Scheduler.Paused;
            int n = core.Server.Scheduler.Clients().Count(c => DateTime.Now - c.LastSeen < TimeSpan.FromDays(1));
            var tip = $"{Title} · {n} PC{(n == 1 ? "" : "s")} · {state}";
            icon.Text = tip.Length > 127 ? tip[..127] : tip;
        }

        protected override void ExitThreadCore()
        {
            timer.Stop();
            icon.Visible = false;
            icon.Dispose();
            base.ExitThreadCore();
        }
    }

    // ---- nur Symbol (Dienstbetrieb) ---------------------------------------------------------------------------------------
    public static int RunTray()
    {
        using var single = new Mutex(true, @"Local\NovaBird.Helper.Tray", out bool first);
        if (!first) return 0;
        InitUi();
        Application.Run(new ServiceTray());
        return 0;
    }

    /// <summary>Symbol für den Dienst: Zustand alle 3 s über /api/ping (nur von diesem PC aus erreichbar).</summary>
    sealed class ServiceTray : ApplicationContext
    {
        readonly NotifyIcon icon;
        readonly ToolStripMenuItem status = new() { Enabled = false };
        readonly System.Windows.Forms.Timer timer = new() { Interval = 3000 };
        readonly HttpClient http = new() { Timeout = TimeSpan.FromSeconds(2) };
        readonly int port = Core.WebPortSetting;
        bool setupShown;

        public ServiceTray()
        {
            http.DefaultRequestHeaders.Add("X-Lang", L.En ? "en" : "de"); // Zustand in der Sprache des Symbols
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem($"{Title} – {L.T("Windows-Dienst", "Windows service")}") { Enabled = false });
            menu.Items.Add(status);
            menu.Items.Add(new ToolStripSeparator());
            var open = new ToolStripMenuItem(L.T("Web-Oberfläche öffnen", "Open web interface"), null, (_, _) => OpenWeb(port));
            open.Font = new Font(open.Font, FontStyle.Bold);
            menu.Items.Add(open);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add(L.T("Zurück zum Programm im Benutzerkonto …", "Back to the program in the user account …"), null, (_, _) => ToUser());
            menu.Items.Add(L.T("Symbol ausblenden (Dienst läuft weiter)", "Hide icon (service keeps running)"), null, (_, _) => ExitThread());
            icon = new NotifyIcon
            {
                Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath) ?? SystemIcons.Application,
                ContextMenuStrip = menu,
                Visible = true,
                Text = Title,
            };
            icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) OpenWeb(port); };
            timer.Tick += async (_, _) => await Poll();
            timer.Start();
            _ = Poll();
        }

        void ToUser()
        {
            if (MessageBox.Show(L.T("Den Windows-Dienst entfernen und den Netz-Modus wieder als Programm im Benutzerkonto starten?\n\nWindows fragt gleich nach Adminrechten. " +
                                    "Die Daten des Dienstes bleiben erhalten; das Programm nutzt seine Einstellungen im Benutzerordner.",
                                "Remove the Windows service and start the network mode as a program in the user account again?\n\nWindows will ask for admin rights. " +
                                    "The data of the service is kept; the program uses its settings in the user folder."),
                    Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            var error = Service.SwitchToUser();
            if (error != null)
            {
                MessageBox.Show(L.T("Umstellen ", "Switching ") + error + ".", Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return;
            }
            var exe = Installer.IsInstalled() ? Installer.InstalledExePath : Environment.ProcessPath;
            Core.SetAutostart(true, exe);
            Process.Start(new ProcessStartInfo(exe, "--server") { UseShellExecute = false });
            ExitThread();
        }

        async Task Poll()
        {
            string text;
            try
            {
                var j = JsonNode.Parse(await http.GetStringAsync($"http://localhost:{port}/api/ping"));
                int n = (int?)j["pcs"] ?? 0;
                text = $"{(string)j["state"]} · {n} PC{(n == 1 ? "" : "s")}";
                if ((bool?)j["setup"] == true)
                {
                    text = L.T("Einrichten: ersten Admin anlegen", "Setup: create the first admin");
                    if (!setupShown)
                    {
                        // einmal je Start: Hinweis und Einrichtungsseite öffnen
                        setupShown = true;
                        icon.ShowBalloonTip(8000, Title, L.T("Der Dienst läuft. Lege in der Web-Oberfläche den ersten Admin an (öffnet sich jetzt).", "The service is running. Create the first admin in the web interface (opening now)."), ToolTipIcon.Info);
                        OpenWeb(port);
                    }
                }
            }
            catch
            {
                text = L.T("Dienst nicht erreichbar", "Service not reachable");
            }
            status.Text = text;
            var tip = $"{Title} · {text}";
            icon.Text = tip.Length > 127 ? tip[..127] : tip;
        }

        protected override void ExitThreadCore()
        {
            timer.Stop();
            icon.Visible = false;
            icon.Dispose();
            http.Dispose();
            base.ExitThreadCore();
        }
    }

    /// <summary>Autostart-Eintrag entfernen (Deinstallation).</summary>
    public static void RemoveAutostart() => Core.Autostart = false;
}
