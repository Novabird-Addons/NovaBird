// JSON der Add-ons lesen. JavaScript schreibt halbe UTF-16-Paare (z. B. ein beim Kürzen zerschnittenes Emoji) als
// "\ud83d" ohne zweite Hälfte; System.Text.Json lehnt das beim Lesen des Texts ab und das ganze Paket scheitert.
// Solche einzelnen Hälften werden vorher durch U+FFFD ersetzt, vollständige Paare bleiben.
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace NovaBird.Helper;

static class Json
{
    // gerade Anzahl Backslashes davor = echte Escape-Folge; erst ein ganzes Paar versuchen, sonst eine einzelne Hälfte
    static readonly Regex Surrogate = new(@"(?<!\\)((?:\\\\)*)(\\u[dD][89abAB][0-9a-fA-F]{2}\\u[dD][c-fC-F][0-9a-fA-F]{2}|\\u[dD][89a-fA-F][0-9a-fA-F]{2})");

    public static JsonNode Parse(byte[] utf8)
    {
        if (utf8.AsSpan().IndexOf("\\ud"u8) < 0 && utf8.AsSpan().IndexOf("\\uD"u8) < 0) return JsonNode.Parse(utf8);
        return JsonNode.Parse(Repair(Encoding.UTF8.GetString(utf8)));
    }

    public static string Repair(string json) =>
        Surrogate.Replace(json, m => m.Groups[2].Length == 12 ? m.Value : m.Groups[1].Value + "\\ufffd");
}
