// Kopplungscodes der Gruppen (Netz-Modus): 20 Zeichen in 4 Blöcken, ohne leicht verwechselbare Zeichen (0/O, 1/I).
using System.Security.Cryptography;

namespace NovaBird.Helper;

static class PairCode
{
    const string Alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

    internal static string Normalize(string code) => new string(code.ToUpperInvariant().Where(c => Alphabet.Contains(c)).ToArray());

    internal static string New()
    {
        var bytes = RandomNumberGenerator.GetBytes(20);
        var chars = bytes.Select(b => Alphabet[b % Alphabet.Length]).ToArray(); // 32 Zeichen: gleichverteilt
        var s = new string(chars);
        return string.Join("-", Enumerable.Range(0, 4).Select(i => s.Substring(i * 5, 5)));
    }
}
