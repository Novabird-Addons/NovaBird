// NovaBird Helper – Einstieg.
//  - Von Thunderbird gestartet (Native Messaging: erstes Argument ist der Pfad der Manifest-Datei): Host-Schleife (Host.cs).
//  - Doppelklick ohne Argumente: Installieren bzw. Entfernen anbieten (Installer.cs).
//  - nbhelper.exe --install | --uninstall [--quiet]: dasselbe ohne Rückfrage (für Skripte).
//  - nbhelper.exe --bench <Modellordner>: Geräte messen und Ergebnis ausgeben (Test).
//  - nbhelper.exe --server: Netz-Modus mit Symbol im Infobereich, rechnet für andere PCs (Tray.cs, NetServer.cs).
//  - nbhelper.exe --server-console [--loopback]: Netz-Modus ohne Oberfläche (Tests).
//  - nbhelper.exe --tokenize <tokenizer.json> <texte.json>: Token-IDs als JSON ausgeben (Test gegen tokenizers).
namespace NovaBird.Helper;

static class Program
{
    public const string HostName = "novabird_helper";
    public const string ExtensionId = "novabird-db@novabird"; // NovaBird-Search (ab 2.0 mit der ID des früheren NovaBird-DB)
    public static string Version => typeof(Program).Assembly.GetName().Version?.ToString(3) ?? "0";

    [STAThread]
    static int Main(string[] args)
    {
        try
        {
            if (args.Length > 0 && args[0].EndsWith(".json", StringComparison.OrdinalIgnoreCase))
                return new Host().Run();
            bool quiet = args.Contains("--quiet");
            if (args.Contains("--install")) return Installer.Install(quiet) ? 0 : 1;
            if (args.Contains("--uninstall")) return Installer.Uninstall(quiet) ? 0 : 1;
            if (args.Contains("--server")) return Tray.Run();
            if (args.Contains("--server-console")) return Tray.RunConsole(args.Contains("--loopback"));
            if (args.Length > 2 && args[0] == "--tokenize")
            {
                var tok = BpeTokenizer.ForFile(args[1]);
                var texts = System.Text.Json.Nodes.JsonNode.Parse(File.ReadAllText(args[2])).AsArray().Select(t => (string)t).ToList();
                Console.Write(System.Text.Json.JsonSerializer.Serialize(texts.Select(t => tok.Encode(t, 512)).ToList()));
                return 0;
            }
            if (args.Length > 1 && args[0] == "--test-shortcut") return Installer.Shortcut(args[1], Environment.ProcessPath, "--server", "Test") ? 0 : 1;
            if (args.Length > 1 && args[0] == "--bench")
            {
                foreach (var r in Engine.Benchmark(args[1])) Console.WriteLine($"{r.Device,-10} {r.Name,-40} {r.MailsPerSec,8:F1} Mails/s {r.Error}");
                return 0;
            }
            return Installer.Interactive();
        }
        catch (Exception e)
        {
            Log.Write("Absturz: " + e);
            return 2;
        }
    }
}

/// <summary>Einfaches Protokoll unter %LOCALAPPDATA%\NovaBird\Helper\helper.log (höchstens etwa 1 MB, dann neu).</summary>
static class Log
{
    static readonly object Gate = new();
    public static void Write(string text)
    {
        try
        {
            lock (Gate)
            {
                var path = Path.Combine(Settings.Dir, "helper.log");
                Directory.CreateDirectory(Settings.Dir);
                if (File.Exists(path) && new FileInfo(path).Length > 1_000_000) File.Delete(path);
                File.AppendAllText(path, $"{DateTime.Now:yyyy-MM-dd HH:mm:ss} {text}{Environment.NewLine}");
            }
        }
        catch { /* Protokoll darf nie stören */ }
    }
}
