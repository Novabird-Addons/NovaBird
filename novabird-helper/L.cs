// Sprache der Texte (Deutsch/Englisch). Web-Oberfläche: je Anfrage nach dem Kopf X-Lang (sonst Accept-Language); Symbol,
// Dialoge, Installer und Antworten an Thunderbird: nach der Anzeigesprache von Windows. Das Protokoll bleibt deutsch.
// Txt hält einen Text in beiden Sprachen (für Zustände, die im Hintergrund entstehen und später angezeigt werden).
using System.Runtime.InteropServices;

namespace NovaBird.Helper;

static class L
{
    static readonly AsyncLocal<bool?> request = new();

    [DllImport("kernel32.dll")]
    static extern ushort GetUserDefaultUILanguage();

    static readonly bool systemEn = Environment.GetEnvironmentVariable("NOVABIRD_LANG") is { Length: > 0 } l ? l != "de" : (GetUserDefaultUILanguage() & 0x3FF) != 0x07; // 0x07 = Deutsch

    public static bool En => request.Value ?? systemEn;

    /// <summary>Für die laufende Web-Anfrage (gilt auch in den davon gestarteten Aufgaben).</summary>
    public static void ForRequest(bool en) => request.Value = en;

    public static string T(string de, string en) => En ? en : de;
}

// Pct: Fortschritt 0–100 für einen Balken in der Web-Oberfläche (-1 = läuft, Dauer unbekannt)
sealed record Txt(string De, string En, int Pct = -1)
{
    public override string ToString() => L.En ? En : De;
}
