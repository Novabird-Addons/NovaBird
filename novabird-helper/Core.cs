// Kern des Netz-Modus, gemeinsam für Symbol im Infobereich, Web-Oberfläche und Dienst: Netz-Server (Einbettungen für die PCs),
// Web-Server (Bedienung), Zustand und Vorbereiten (Modell laden, Geräte messen). Keine Oberfläche hier – Rückfragen stellt
// der Aufrufer (Symbol: Dialog, Web: Knopf).
using System.Diagnostics;
using Microsoft.Win32;

namespace NovaBird.Helper;

sealed class Core
{
    const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    const string RunValue = "NovaBird Helper (Netz)";

    public readonly NetServer Server;
    public readonly WebServer Web;
    public readonly ModelSpec Model;
    public readonly Ollama Ollama = new();
    public readonly DateTime Started = DateTime.Now;
    // Zustände entstehen im Hintergrund und werden später in der Sprache des Betrachters angezeigt: beide Sprachen merken
    Txt preparing, lastError;
    public string Preparing => preparing?.ToString(); // Modell laden / Geräte messen (Text für den Status)
    public int? PreparingPct => preparing?.Pct;
    public string LastError => lastError?.ToString();
    public Action Exit = () => { };
    public Action<string, bool> Notify = (_, _) => { };

    public Core(ModelSpec model, int port, bool loopbackOnly)
    {
        Model = model;
        Server = new NetServer(model, port, loopbackOnly);
        Server.Chat.Ollama = Ollama;
        Web = new WebServer(this, WebPortSetting, loopbackOnly || !WebLan);
    }

    public void Start()
    {
        Server.Start();
        Ollama.Start(); // nur, wenn eingerichtet und eingeschaltet
        try { Web.Start(); }
        catch (Exception e)
        {
            // Web-Oberfläche ist Bedienung, nicht Rechnen: ohne sie läuft der Netz-Modus weiter
            lastError = new Txt($"Web-Oberfläche (Port {WebPortSetting}): {e.Message}", $"Web interface (port {WebPortSetting}): {e.Message}");
            Log.Write(lastError.De);
        }
    }

    public void Stop()
    {
        Web.Stop();
        Ollama.Stop();
        Server.Stop();
    }

    public string Mode => Settings.ServiceMode ? "service" : "user";

    public string StateText()
    {
        var sch = Server.Scheduler;
        if (Preparing != null) return Preparing;
        if (!ModelStore.Ready(Model)) return Model.Complete ? L.T("Geräte noch nicht gemessen", "Devices not measured yet") : L.T("Modell fehlt", "Model missing");
        if (sch.Busy != null && sch.Rate > 0) return $"{L.T("Rechnet für", "Computing for")} {Label(sch.Clients().FirstOrDefault(c => c.Id == sch.Busy), sch.Busy)} · {RateText()}";
        return sch.Paused ? L.T("Pausiert (Suchanfragen gehen weiter)", "Paused (searches continue)") : $"{L.T("Bereit", "Ready")} · {(string)Settings.Load()["deviceName"] ?? "–"}";
    }

    public string RateText()
    {
        var r = Server.Scheduler.Rates;
        return r.Cpu > 0 ? L.T($"{r.All:0.#} Mails/s (Grafikkarte {r.Gpu:0.#} + CPU {r.Cpu:0.#})", $"{r.All:0.#} msgs/s (graphics card {r.Gpu:0.#} + CPU {r.Cpu:0.#})")
            : L.T($"{r.All:0.#} Mails/s", $"{r.All:0.#} msgs/s");
    }

    public static string Label(Scheduler.ClientInfo c, string id) => !string.IsNullOrEmpty(c?.Label) ? c.Label : "PC " + id[..Math.Min(6, id.Length)];

    public List<string> Addresses() => NetServer.LocalAddresses().Select(a => $"http://{a}:{Server.Port}").ToList();

    /// <summary>Modell laden (falls es fehlt) und Geräte messen; danach rechnet der Helper. Rückfrage vorher beim Aufrufer.</summary>
    public void Prepare(bool measureAgain)
    {
        if (preparing != null) return;
        if (Model.Complete && ModelStore.Ready(Model) && !measureAgain) return;
        preparing = new Txt("Bereite vor …", "Preparing …");
        Task.Run(async () =>
        {
            try
            {
                if (!Model.Complete)
                    ModelStore.Ensure(Model, (done, total) => preparing = new Txt($"Lade Modell: {done * 100 / Math.Max(1, total)} %", $"Downloading model: {done * 100 / Math.Max(1, total)} %", (int)(done * 100 / Math.Max(1, total))));
                preparing = new Txt("Messe CPU und Grafikkarten …", "Measuring CPU and graphics cards …");
                await Server.Scheduler.Run(() => ModelStore.Measure(Model));
                preparing = null;
                var s = Settings.Load();
                Notify(L.T($"Bereit: rechnet auf {(string)s["deviceName"]} (etwa {(double?)s["mailsPerSec"]:0} Mails/s).", $"Ready: computing on {(string)s["deviceName"]} (about {(double?)s["mailsPerSec"]:0} msgs/s)."), false);
            }
            catch (Exception e)
            {
                preparing = null;
                lastError = new Txt("Vorbereiten fehlgeschlagen: " + e.Message, "Preparing failed: " + e.Message);
                Log.Write("Vorbereiten: " + e);
                Notify(LastError, true);
            }
        });
    }

    // ---- Einstellungen -----------------------------------------------------------------------------------------------------
    /// <summary>Start mit Windows (nur Benutzerbetrieb; der Dienst startet ohnehin mit Windows).</summary>
    public static bool Autostart
    {
        get
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(RunValue) != null;
        }
        set => SetAutostart(value, Environment.ProcessPath);
    }

    public static void SetAutostart(bool on, string exe)
    {
        using var k = Registry.CurrentUser.CreateSubKey(RunKey);
        if (!on) k.DeleteValue(RunValue, false);
        else k.SetValue(RunValue, $"\"{exe}\" --server");
    }

    public static int PortSetting
    {
        get => (int?)Settings.Load()["netPort"] ?? NetServer.DefaultPort;
        set => Set("netPort", value);
    }

    public static int WebPortSetting
    {
        get => int.TryParse(Environment.GetEnvironmentVariable("NOVABIRD_WEB_PORT"), out var p) ? p : (int?)Settings.Load()["webPort"] ?? WebServer.DefaultPort;
        set => Set("webPort", value);
    }

    /// <summary>Web-Oberfläche auch im Netz (dann nur über HTTPS); Standard: nur dieser PC.</summary>
    public static bool WebLan
    {
        get => (bool?)Settings.Load()["webLan"] ?? false;
        set => Set("webLan", value);
    }

    static void Set(string key, System.Text.Json.Nodes.JsonNode value)
    {
        var s = Settings.Load();
        s[key] = value;
        Settings.Save(s);
    }

    public static string LogPath => Path.Combine(Settings.Dir, "helper.log");

    public static void OpenLog() => Process.Start(new ProcessStartInfo(LogPath) { UseShellExecute = true });

    public string WebUrl => $"http://localhost:{Web.Port}/";
}
