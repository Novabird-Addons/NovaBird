// Netz-Modus mit Symbol im Infobereich (nbhelper.exe --server): rechnet für die PCs im Netz (NetServer.cs).
// Menü: Status, Warteschlange, verbundene PCs, Adresse und Kopplungscode, neuer Code, Pause, Geräte messen,
// mit Windows starten (HKCU …\Run), Protokoll, Beenden. Läuft nur einmal je Benutzer.
// nbhelper.exe --server-console: dasselbe ohne Oberfläche (Tests; Ausgabe als JSON-Zeilen, Ende mit stdin).
using System.Diagnostics;
using System.Text.Json.Nodes;
using Microsoft.Win32;

namespace NovaBird.Helper;

static class Tray
{
    const string Title = "NovaBird Helper";
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValue = "NovaBird Helper (Netz)";

    // NOVABIRD_NET_LOOPBACK=1: nur auf diesem PC erreichbar (Tests, keine Firewall-Abfrage)
    static bool LoopbackOnly => Environment.GetEnvironmentVariable("NOVABIRD_NET_LOOPBACK") == "1";

    static int PortSetting() =>
        int.TryParse(Environment.GetEnvironmentVariable("NOVABIRD_NET_PORT"), out var p) ? p : (int?)Settings.Load()["netPort"] ?? NetServer.DefaultPort;

    // ---- ohne Oberfläche (Tests) ------------------------------------------------------------------------------------------
    public static int RunConsole(bool loopback)
    {
        Console.OutputEncoding = System.Text.Encoding.UTF8;
        var model = BuiltinModels.Default;
        if (!model.Complete) { Console.WriteLine(new JsonObject { ["error"] = "Modell fehlt" }.ToJsonString()); return 1; }
        var server = new NetServer(model, PortSetting(), loopback || LoopbackOnly);
        server.Start();
        if (!ModelStore.Ready(model)) server.Scheduler.Run(() => ModelStore.Measure(model)).Wait();
        Console.WriteLine(new JsonObject { ["port"] = server.Port, ["code"] = NetServer.Code(), ["ready"] = ModelStore.Ready(model) }.ToJsonString());
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
        server.Stop();
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
            ["id"] = c.Id, ["label"] = c.Label, ["today"] = c.Today, ["total"] = c.Total,
        }).ToArray()),
    };

    // ---- mit Symbol im Infobereich ------------------------------------------------------------------------------------------
    public static int Run()
    {
        using var single = new Mutex(true, @"Local\NovaBird.Helper.Net", out bool first);
        if (!first)
        {
            MessageBox.Show("Der Netz-Modus des NovaBird Helpers läuft schon (Symbol im Infobereich).", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
            return 0;
        }
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        NetServer server;
        var model = BuiltinModels.Default;
        try
        {
            server = new NetServer(model, PortSetting(), LoopbackOnly);
            server.Start();
        }
        catch (Exception e)
        {
            MessageBox.Show($"Der Netz-Modus konnte nicht starten (Port {PortSetting()}):\n{e.Message}", Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
        Application.Run(new TrayContext(server, model));
        server.Stop();
        return 0;
    }

    sealed class TrayContext : ApplicationContext
    {
        readonly NetServer server;
        readonly ModelSpec model;
        readonly NotifyIcon icon;
        readonly ToolStripMenuItem status = new() { Enabled = false }, queue = new() { Enabled = false }, pcs = new("PCs"), pause, measure, autostart, cpu = new("CPU mitrechnen lassen"), threads = new("CPU-Threads");
        readonly System.Windows.Forms.Timer timer = new() { Interval = 2000 };
        string preparing; // Modell laden / Geräte messen (Text für den Status)

        public TrayContext(NetServer server, ModelSpec model)
        {
            this.server = server;
            this.model = model;
            var menu = new ContextMenuStrip();
            menu.Items.Add(new ToolStripMenuItem($"{Title} {Program.Version} – Netz-Modus") { Enabled = false, Font = new Font(menu.Font, FontStyle.Bold) });
            menu.Items.Add(status);
            menu.Items.Add(queue);
            menu.Items.Add(pcs);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Verbinden: Adresse und Kopplungscode …", null, (_, _) => ShowConnect());
            menu.Items.Add("Kopplungscode kopieren", null, (_, _) => Clipboard.SetText(NetServer.Code()));
            menu.Items.Add("Neuen Kopplungscode erzeugen …", null, (_, _) => Renew());
            menu.Items.Add(new ToolStripSeparator());
            pause = new ToolStripMenuItem("Pause (nur Suchanfragen beantworten)", null, (_, _) => server.Scheduler.Paused = !server.Scheduler.Paused);
            menu.Items.Add(pause);
            cpu.Click += (_, _) => ToggleCpu();
            menu.Items.Add(cpu);
            menu.Items.Add(threads);
            measure = new ToolStripMenuItem("Geräte neu messen", null, (_, _) => Prepare(measureAgain: true));
            menu.Items.Add(measure);
            autostart = new ToolStripMenuItem("Mit Windows starten", null, (_, _) => ToggleAutostart());
            menu.Items.Add(autostart);
            menu.Items.Add("Protokoll öffnen", null, (_, _) => Process.Start(new ProcessStartInfo(Path.Combine(Settings.Dir, "helper.log")) { UseShellExecute = true }));
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("Beenden", null, (_, _) => ExitThread());
            menu.Opening += (_, _) => Refresh();
            icon = new NotifyIcon
            {
                Icon = Icon.ExtractAssociatedIcon(Environment.ProcessPath) ?? SystemIcons.Application,
                ContextMenuStrip = menu,
                Visible = true,
            };
            icon.MouseClick += (_, e) => { if (e.Button == MouseButtons.Left) ShowConnect(); };
            timer.Tick += (_, _) => Refresh();
            timer.Start();
            Refresh();
            var s = Settings.Load();
            if (s["netWelcomed"] == null)
            {
                s["netWelcomed"] = true;
                Settings.Save(s);
                icon.ShowBalloonTip(8000, Title, "Der Netz-Modus läuft. Adresse und Kopplungscode: Klick auf das Symbol.", ToolTipIcon.Info);
            }
            Prepare(measureAgain: false);
        }

        // Modell laden (fragt vorher) und Geräte messen; danach rechnet der Helper
        void Prepare(bool measureAgain)
        {
            if (preparing != null) return;
            if (!model.Complete)
            {
                if (MessageBox.Show("Für den Netz-Modus braucht der Helper das Modell jina-embeddings-v2-base-de (etwa 320 MB von Hugging Face, " +
                                    "feste Version, jede Datei mit Prüfsumme).\n\nJetzt laden?", Title, MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes)
                    return;
            }
            else if (ModelStore.Ready(model) && !measureAgain) return;
            preparing = "Bereite vor …";
            Task.Run(async () =>
            {
                try
                {
                    if (!model.Complete)
                        ModelStore.Ensure(model, (done, total) => preparing = $"Lade Modell: {done * 100 / Math.Max(1, total)} %");
                    preparing = "Messe CPU und Grafikkarten …";
                    await server.Scheduler.Run(() => ModelStore.Measure(model));
                    preparing = null;
                    var s = Settings.Load();
                    icon.ShowBalloonTip(5000, Title, $"Bereit: rechnet auf {(string)s["deviceName"]} (etwa {(double?)s["mailsPerSec"]:0} Mails/s).", ToolTipIcon.Info);
                }
                catch (Exception e)
                {
                    preparing = null;
                    Log.Write("Vorbereiten: " + e);
                    icon.ShowBalloonTip(8000, Title, "Vorbereiten fehlgeschlagen: " + e.Message, ToolTipIcon.Error);
                }
            });
        }

        void Refresh()
        {
            var sch = server.Scheduler;
            var s = Settings.Load();
            var clients = sch.Clients();
            var device = (string)s["deviceName"] ?? "–";
            string state = preparing ?? (!ModelStore.Ready(model) ? "Modell fehlt"
                : sch.Busy != null && sch.Rate > 0 ? $"Rechnet für {Label(clients.FirstOrDefault(c => c.Id == sch.Busy), sch.Busy)} · {RateText(sch)}"
                : sch.Paused ? "Pausiert (Suchanfragen gehen weiter)" : $"Bereit · {device}");
            status.Text = state;
            queue.Text = $"Warteschlange: {sch.QueueLength} · letzte Minute: {RateText(sch)}";
            pause.Checked = sch.Paused;
            var blocked = Scheduler.CpuBlocked();
            cpu.Checked = sch.CpuEnabled && blocked == null;
            cpu.Text = blocked == null ? "CPU mitrechnen lassen" : $"CPU mitrechnen lassen ({blocked})";
            BuildThreads(sch);
            measure.Text = model.Complete ? "Geräte neu messen" : "Modell laden …";
            measure.Enabled = preparing == null;
            autostart.Checked = AutostartEnabled();
            pcs.Text = $"PCs ({clients.Count})";
            pcs.DropDownItems.Clear();
            if (clients.Count == 0) pcs.DropDownItems.Add(new ToolStripMenuItem("noch keiner verbunden") { Enabled = false });
            foreach (var c in clients)
                pcs.DropDownItems.Add(new ToolStripMenuItem($"{Label(c, c.Id)} – heute {c.Today:N0} Mails, zuletzt {c.LastSeen:HH:mm}") { Enabled = false });
            var tip = $"{Title} · {clients.Count} PC{(clients.Count == 1 ? "" : "s")} · {state}";
            icon.Text = tip.Length > 127 ? tip[..127] : tip;
        }

        static string RateText(Scheduler sch)
        {
            var r = sch.Rates;
            return r.Cpu > 0 ? $"{r.All:0.#} Mails/s (Grafikkarte {r.Gpu:0.#} + CPU {r.Cpu:0.#})" : $"{r.All:0.#} Mails/s";
        }

        void ToggleCpu()
        {
            var blocked = Scheduler.CpuBlocked();
            if (blocked != null)
            {
                MessageBox.Show($"Die CPU kann gerade nicht mitrechnen: {blocked}.", Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            server.Scheduler.CpuEnabled = !server.Scheduler.CpuEnabled;
            Refresh();
        }

        // Threads für das Mitrechnen der CPU: automatisch oder fest; so viele Kerne bleiben für die normale Arbeit frei
        void BuildThreads(Scheduler sch)
        {
            int cores = Environment.ProcessorCount, set = sch.CpuThreadsSetting;
            threads.Text = $"CPU-Threads: {sch.CpuThreads} von {cores}";
            threads.Enabled = Scheduler.CpuBlocked() == null;
            threads.DropDownItems.Clear();
            threads.DropDownItems.Add(new ToolStripMenuItem($"Automatisch ({Scheduler.AutoThreads})", null, (_, _) => { sch.CpuThreadsSetting = 0; Refresh(); }) { Checked = set == 0 });
            foreach (var n in new[] { 1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32 }.Where(n => n <= cores))
                threads.DropDownItems.Add(new ToolStripMenuItem($"{n}", null, (_, _) => { sch.CpuThreadsSetting = n; Refresh(); }) { Checked = set == n });
            threads.DropDownItems.Add(new ToolStripSeparator());
            threads.DropDownItems.Add(new ToolStripMenuItem($"Dieser PC hat {cores} logische Kerne; frei bleiben {Math.Max(0, cores - sch.CpuThreads)}.") { Enabled = false });
        }

        static string Label(Scheduler.ClientInfo c, string id) => !string.IsNullOrEmpty(c?.Label) ? c.Label : "PC " + id[..Math.Min(6, id.Length)];

        void ShowConnect()
        {
            var addrs = NetServer.LocalAddresses().Select(a => $"   http://{a}:{server.Port}").ToList();
            MessageBox.Show(
                "In Thunderbird auf den anderen PCs: Einstellungen von NovaBird-Search → Semantische Suche → Erweitert → Rechenweg " +
                "„Eigener Server“, Schnittstelle „NovaBird Helper (Netz)“, dann Adresse und Code eintragen.\n\n" +
                $"Adresse dieses PCs:\n{(addrs.Count > 0 ? string.Join("\n", addrs) : "   (kein Netzwerk gefunden)")}\n\n" +
                $"Kopplungscode:\n   {NetServer.Code()}\n\n" +
                "Anfragen und Antworten sind mit dem Code verschlüsselt; ohne ihn kann niemand den Helper benutzen. " +
                "Fragt Windows nach der Firewall: Zugriff im privaten Netzwerk erlauben (braucht einmal Adminrechte).",
                Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }

        void Renew()
        {
            if (MessageBox.Show("Neuen Kopplungscode erzeugen?\n\nAlle bisher verbundenen PCs müssen danach den neuen Code eintragen.", Title,
                    MessageBoxButtons.YesNo, MessageBoxIcon.Question) != DialogResult.Yes) return;
            server.Renew();
            ShowConnect();
        }

        static bool AutostartEnabled()
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(RunValue) != null;
        }

        static void ToggleAutostart()
        {
            using var k = Registry.CurrentUser.CreateSubKey(RunKey);
            if (k.GetValue(RunValue) != null) k.DeleteValue(RunValue, false);
            else k.SetValue(RunValue, $"\"{Environment.ProcessPath}\" --server");
        }

        protected override void ExitThreadCore()
        {
            timer.Stop();
            icon.Visible = false;
            icon.Dispose();
            base.ExitThreadCore();
        }
    }

    /// <summary>Autostart-Eintrag entfernen (Deinstallation).</summary>
    public static void RemoveAutostart()
    {
        using var k = Registry.CurrentUser.OpenSubKey(RunKey, true);
        k?.DeleteValue(RunValue, false);
    }
}
