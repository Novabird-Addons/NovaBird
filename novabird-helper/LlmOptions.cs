// Erweiterte Optionen für das Sprachmodell (Ollama), in der Web-Oberfläche unter „Sprachmodell“ einstellbar.
//  - Kontextlänge und „im Speicher halten“ gelten für alles, was über das Ollama des Helpers läuft (auch externe Programme);
//    sie gehen als Umgebung an Ollama, eine Änderung startet Ollama neu.
//  - Kontextspeicher komprimieren (KV-Cache q8_0, Standard an): gemessen mit Gemma 4 E4B bei 16k Kontext 3,8 statt 4,2 GB
//    Grafikspeicher (ohne Flash Attention 5,0 GB), gleiche Punkte im LLM-Test. Gilt über die Umgebung (Neustart von Ollama).
//  - Temperatur und Top-p gelten für die KI-Funktionen von NovaBird (externe Programme schicken eigene Werte).
// Gespeichert in settings.json unter "llmOptions".
using System.Globalization;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class LlmOptions
{
    public static readonly int[] Contexts = { 8192, 16384, 32768 };
    public static readonly string[] KeepAlives = { "5m", "15m", "1h", "-1" }; // -1 = immer geladen lassen
    public const int DefaultContext = 16384;
    public const double DefaultTemperature = 0.2, DefaultTopP = 0.9;
    public const string DefaultKeepAlive = "15m";

    static JsonNode Node => Settings.Load()["llmOptions"];

    public static int Context => (int?)Node?["context"] is int c && Contexts.Contains(c) ? c : DefaultContext;
    public static double Temperature => (double?)Node?["temperature"] is double t && t is >= 0 and <= 2 ? t : DefaultTemperature;
    public static double TopP => (double?)Node?["topP"] is double p && p is > 0 and <= 1 ? p : DefaultTopP;
    public static string KeepAlive => (string)Node?["keepAlive"] is string k && KeepAlives.Contains(k) ? k : DefaultKeepAlive;
    public static bool KvCompress => (bool?)Node?["kvCompress"] ?? true;

    public static JsonObject Info() => new()
    {
        ["context"] = Context, ["temperature"] = Temperature, ["topP"] = TopP, ["keepAlive"] = KeepAlive, ["kvCompress"] = KvCompress,
        ["contexts"] = new JsonArray(Contexts.Select(c => (JsonNode)c).ToArray()),
        ["keepAlives"] = new JsonArray(KeepAlives.Select(k => (JsonNode)k).ToArray()),
        ["defaults"] = new JsonObject { ["context"] = DefaultContext, ["temperature"] = DefaultTemperature, ["topP"] = DefaultTopP, ["keepAlive"] = DefaultKeepAlive, ["kvCompress"] = true },
    };

    /// <summary>Übernimmt geänderte Werte (fehlende bleiben); liefert true, wenn Ollama neu starten muss.</summary>
    public static bool Change(JsonNode j, out string summary)
    {
        int ctx = (int?)j["context"] ?? Context;
        double temp = (double?)j["temperature"] ?? Temperature, topP = (double?)j["topP"] ?? TopP;
        string keep = (string)j["keepAlive"] ?? KeepAlive;
        bool kv = (bool?)j["kvCompress"] ?? KvCompress;
        if (!Contexts.Contains(ctx)) throw new ArgumentException(L.T("Kontextlänge: 8192, 16384 oder 32768", "Context length: 8192, 16384 or 32768"));
        if (temp is < 0 or > 2) throw new ArgumentException(L.T("Temperatur: 0 bis 2", "Temperature: 0 to 2"));
        if (topP is <= 0 or > 1) throw new ArgumentException(L.T("Top-p: über 0 bis 1", "Top-p: above 0 up to 1"));
        if (!KeepAlives.Contains(keep)) throw new ArgumentException(L.T("Im Speicher halten: unbekannter Wert", "Keep loaded: unknown value"));
        bool restart = ctx != Context || keep != KeepAlive || kv != KvCompress;
        var s = Settings.Load();
        s["llmOptions"] = new JsonObject { ["context"] = ctx, ["temperature"] = Math.Round(temp, 2), ["topP"] = Math.Round(topP, 2), ["keepAlive"] = keep, ["kvCompress"] = kv };
        Settings.Save(s);
        summary = string.Create(CultureInfo.InvariantCulture, $"Kontext {ctx}, Temperatur {temp:0.##}, Top-p {topP:0.##}, im Speicher {keep}, Kontextspeicher {(kv ? "q8_0" : "f16")}");
        return restart;
    }

    /// <summary>Alle Werte auf Standard; true, wenn Ollama neu starten muss.</summary>
    public static bool Reset()
    {
        bool restart = Context != DefaultContext || KeepAlive != DefaultKeepAlive || !KvCompress;
        var s = Settings.Load();
        s.Remove("llmOptions");
        Settings.Save(s);
        return restart;
    }
}
