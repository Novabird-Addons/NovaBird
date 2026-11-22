// OpenAI-kompatible Schnittstelle für andere Programme (Einstellung „Externe Programme“, standardmäßig aus):
//  - Gleicher Port wie die Web-Oberfläche, Pfade /v1/models, /v1/chat/completions, /v1/completions, /v1/embeddings.
//    Auf diesem PC per HTTP, aus dem Netz per HTTPS (nur wenn „Web-Oberfläche im Netz“ an ist); auf Wunsch im Netz auch
//    unverschlüsselt (manche Programme lehnen das selbst erzeugte Zertifikat ab).
//  - Jede Anfrage braucht „Authorization: Bearer <Schlüssel>“ (ApiKeys.cs), optional nur von bestimmten Adressen.
//    Falsche Schlüssel zählen wie falsche Anmeldungen (10 in 10 Minuten sperren die Adresse).
//  - Weitergeleitet an das vom Helper verwaltete Ollama (127.0.0.1, nie selbst im Netz); Antworten (auch gestreamt) laufen
//    unverändert durch. Modell „default“ oder ohne Angabe = das in der Web-Oberfläche gewählte Ollama-Modell.
//    Ollama lädt nichts nach (/v1 kann keine Modelle laden oder löschen).
//  - Vorlesen (Qwen3-TTS, Speech.cs), nur für Schlüssel mit „Vorlesen“; läuft auch ohne Ollama:
//      POST /v1/audio/speech  {"model": "qwen3-tts", "input": "…", "voice": "ruhig", "language": "german", "response_format": "wav"}
//                             → audio/wav (24 kHz, mono, 16 bit); bis 5000 Zeichen, längere Texte Satz für Satz zu einem WAV.
//                             voice: Name einer Stimmvorlage; ohne Angabe oder OpenAI-Name (alloy …) die eingestellte der Sprache;
//                             unbekannt → 400. language: ohne Angabe die der Stimme (en_… englisch, sonst deutsch).
//                             response_format nur "wav", kein stream (sonst 400). speed 0,5–2 (Standard 1): Tempo ändern,
//                             Tonhöhe bleibt (Tempo.cs).
//      GET  /v1/audio/voices  → {"voices": [{"id": "ruhig", "language": "german"}, …], "default": {"german": …, "english": …}}
//    /v1/models nennt dann zusätzlich "qwen3-tts".
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed partial class WebServer
{
    const int ExtMaxBody = 8 << 20;
    static readonly string[] ExtPaths = { "/v1/models", "/v1/chat/completions", "/v1/completions", "/v1/embeddings", "/v1/audio/speech", "/v1/audio/voices" };
    const string TtsModel = "qwen3-tts";
    static readonly string[] TtsModelAliases = { TtsModel, "tts-1", "tts-1-hd", "gpt-4o-mini-tts" };
    static readonly string[] OpenAiVoices = { "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse" };
    static readonly HttpClient ExtHttp = new() { Timeout = TimeSpan.FromMinutes(15) };

    public static bool ExtEnabled
    {
        get => (bool?)Settings.Load()["extApi"]?["enabled"] ?? false;
        set => SetExt("enabled", value);
    }

    public static bool ExtLanHttp
    {
        get => (bool?)Settings.Load()["extApi"]?["lanHttp"] ?? false;
        set => SetExt("lanHttp", value);
    }

    static void SetExt(string name, bool value)
    {
        var s = Settings.Load();
        var o = s["extApi"] as JsonObject ?? new JsonObject();
        o[name] = value;
        s["extApi"] = o.DeepClone();
        Settings.Save(s);
    }

    static bool IsExtPath(string path) => path.StartsWith("/v1/", StringComparison.Ordinal);

    // Fehler im Format der OpenAI-Schnittstelle
    static Response ExtError(int status, string message, string type = "invalid_request_error") =>
        Response.Json(new JsonObject { ["error"] = new JsonObject { ["message"] = message, ["type"] = type } }, status);

    async Task ExtHandle(Request req, Stream stream, IPAddress remote)
    {
        var res = await ExtRoute(req, stream, remote);
        if (res != null) await Write(stream, res);
    }

    /// <summary>Liefert eine Antwort oder null, wenn die Antwort schon (gestreamt) geschrieben wurde.</summary>
    async Task<Response> ExtRoute(Request req, Stream stream, IPAddress remote)
    {
        if (!ExtEnabled) return ExtError(404, "OpenAI-compatible interface is switched off in the NovaBird Helper (web interface → External apps)");
        if (!req.Secure && !req.Local && !ExtLanHttp) return ExtError(403, "Use HTTPS (or allow unencrypted access in the NovaBird Helper)");
        if (LoginBlocked(req.Ip)) return ExtError(429, "Too many wrong keys – try again in 10 minutes", "rate_limit_error");
        var auth = req.Headers.GetValueOrDefault("Authorization") ?? "";
        var secret = auth.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase) ? auth[7..].Trim() : null;
        var (result, key) = ApiKeys.Check(secret, remote);
        if (result == ApiKeys.Result.NoKey)
        {
            LoginFailed(req.Ip);
            return ExtError(401, "Invalid API key", "authentication_error");
        }
        if (result == ApiKeys.Result.Denied)
        {
            Log.Write($"Externe Programme: Schlüssel „{key.Name}“ von nicht erlaubter Adresse {req.Ip}");
            return ExtError(403, "This key is not allowed from this address", "permission_error");
        }
        if (!ExtPaths.Contains(req.Path)) return ExtError(404, "Not supported: " + req.Path);
        if ((req.Path is "/v1/models" or "/v1/audio/voices") != (req.Method == "GET")) return ExtError(405, "Method not allowed");
        // Vorlesen: eigene Freigabe je Schlüssel, braucht kein Ollama
        if (req.Path.StartsWith("/v1/audio/", StringComparison.Ordinal))
        {
            if (!key.Tts) return ExtError(403, "This key may not use read-aloud (allow it in the NovaBird Helper: External apps → key)", "permission_error");
            return req.Path == "/v1/audio/voices" ? ExtVoices() : await ExtSpeech(req);
        }
        if (req.Path == "/v1/models" && key.Tts && (!key.Llm || !core.Ollama.Running)) return ExtModels(null);
        if (!key.Llm) return ExtError(403, "This key may only use read-aloud (/v1/audio)", "permission_error");
        if (req.Path == "/v1/models" && key.Tts && core.Speech.Available)
        {
            // Modelle von Ollama plus qwen3-tts
            try { return ExtModels(JsonNode.Parse(await ExtHttp.GetStringAsync(core.Ollama.BaseUrl + "/v1/models"))); }
            catch (Exception e) { return ExtError(502, "Ollama did not answer: " + e.Message, "server_error"); }
        }
        var o = core.Ollama;
        if (!o.Running) return ExtError(503, "Ollama is not running in the NovaBird Helper", "server_error");

        var body = req.Body;
        if (req.Method == "POST")
        {
            JsonNode j;
            try { j = JsonNode.Parse(body); }
            catch { return ExtError(400, "Invalid JSON"); }
            if (j is not JsonObject obj) return ExtError(400, "Invalid JSON");
            var model = (string)obj["model"];
            if (string.IsNullOrWhiteSpace(model) || model is "default" or "novabird")
            {
                var sel = Chat.Selected;
                if (sel == null || !sel.StartsWith(Chat.OllamaPrefix)) return ExtError(400, "No Ollama model is selected in the NovaBird Helper; give a model name");
                obj["model"] = sel[Chat.OllamaPrefix.Length..];
            }
            body = Encoding.UTF8.GetBytes(obj.ToJsonString());
        }
        using var up = new HttpRequestMessage(req.Method == "GET" ? HttpMethod.Get : HttpMethod.Post, o.BaseUrl + req.Path);
        if (req.Method == "POST") up.Content = new ByteArrayContent(body) { Headers = { ContentType = new MediaTypeHeaderValue("application/json") } };
        HttpResponseMessage r;
        try { r = await ExtHttp.SendAsync(up, HttpCompletionOption.ResponseHeadersRead); }
        catch (Exception e) { return ExtError(502, "Ollama did not answer: " + e.Message, "server_error"); }
        using (r)
        {
            // Kopf selbst schreiben, Rumpf unverändert und ohne Länge durchreichen (Ende = Verbindungsende), jedes Stück sofort
            var type = r.Content.Headers.ContentType?.ToString() ?? "application/json";
            var head = $"HTTP/1.1 {(int)r.StatusCode} {r.ReasonPhrase}\r\nContent-Type: {type}\r\nCache-Control: no-store\r\nConnection: close\r\nX-Content-Type-Options: nosniff\r\n\r\n";
            await stream.WriteAsync(Encoding.ASCII.GetBytes(head));
            await using var src = await r.Content.ReadAsStreamAsync();
            var buf = new byte[16 << 10];
            int n;
            while ((n = await src.ReadAsync(buf)) > 0)
            {
                await stream.WriteAsync(buf.AsMemory(0, n));
                await stream.FlushAsync();
            }
        }
        return null;
    }

    // ---- Vorlesen ------------------------------------------------------------------------------------------------------------
    Response ExtModels(JsonNode ollama)
    {
        var list = ollama?["data"] as JsonArray ?? new JsonArray();
        if (core.Speech.Available) list.Add(new JsonObject { ["id"] = TtsModel, ["object"] = "model", ["created"] = 0, ["owned_by"] = "novabird" });
        return Response.Json(new JsonObject { ["object"] = "list", ["data"] = list.DeepClone() });
    }

    Response ExtVoices()
    {
        if (ExtTtsUnavailable() is Response no) return no;
        return Response.Json(new JsonObject
        {
            ["voices"] = new JsonArray(Speech.Voices().Select(v => (JsonNode)new JsonObject { ["id"] = v.Name, ["language"] = v.Lang }).ToArray()),
            ["default"] = new JsonObject { ["german"] = Speech.Pick(null, "german"), ["english"] = Speech.Pick(null, "english") },
            ["languages"] = new JsonArray(Speech.Langs.Select(l => (JsonNode)l).ToArray()),
        });
    }

    Response ExtTtsUnavailable() =>
        !Speech.Installed ? ExtError(503, "Read-aloud is not set up in the NovaBird Helper (web interface → Read aloud)", "server_error")
        : !Speech.Enabled ? ExtError(503, "Read-aloud is switched off in the NovaBird Helper", "server_error")
        : Speech.Voices().Count == 0 ? ExtError(503, "No voice in the NovaBird Helper", "server_error")
        : null;

    async Task<Response> ExtSpeech(Request req)
    {
        JsonObject j;
        try { j = JsonNode.Parse(req.Body) as JsonObject; }
        catch { j = null; }
        if (j == null) return ExtError(400, "Invalid JSON");
        string Str(string name) => j[name] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;
        var model = Str("model");
        if (!string.IsNullOrEmpty(model) && !TtsModelAliases.Contains(model)) return ExtError(400, $"Unknown model: {model} (use {TtsModel})");
        var input = Str("input");
        if (string.IsNullOrWhiteSpace(input)) return ExtError(400, "input is missing");
        if (input.Length > Speech.MaxTotal) return ExtError(400, $"input is too long ({input.Length} characters, at most {Speech.MaxTotal})");
        var format = Str("response_format");
        if (j["response_format"] != null && format != "wav") return ExtError(400, "response_format: only \"wav\" is supported");
        double speed = 1;
        if (j["speed"] is JsonNode sp && !(sp is JsonValue spv && spv.TryGetValue(out speed) && speed >= Tempo.Min && speed <= Tempo.Max))
            return ExtError(400, FormattableString.Invariant($"speed: {Tempo.Min} to {Tempo.Max}"));
        if (j["stream"] is JsonNode st && !(st is JsonValue stv && stv.TryGetValue<bool>(out var stream) && !stream)) return ExtError(400, "stream is not supported");
        if (j["stream_format"] != null && Str("stream_format") != "audio") return ExtError(400, "stream_format is not supported");
        if (ExtTtsUnavailable() is Response no) return no;

        var voices = Speech.Voices();
        var voice = Str("voice");
        if (j["voice"] != null && voice == null) return ExtError(400, "voice: give a voice name");
        (string Name, string Lang) found = default;
        if (!string.IsNullOrEmpty(voice) && !OpenAiVoices.Contains(voice.ToLowerInvariant()))
        {
            found = voices.FirstOrDefault(v => v.Name == voice);
            if (found.Name == null) return ExtError(400, $"Unknown voice: {voice} (available: {string.Join(", ", voices.Select(v => v.Name))})");
        }
        var lang = Str("language");
        if (j["language"] != null && (lang == null || !Speech.Langs.Contains(lang))) return ExtError(400, $"Unknown language (use one of: {string.Join(", ", Speech.Langs)})");
        lang ??= found.Lang ?? "german";
        var name = found.Name ?? Speech.Pick(null, lang == "german" ? "german" : "english");
        try
        {
            var wav = await core.Speech.SayAll(input, lang, name);
            if (Math.Abs(speed - 1) >= 0.001) wav = await Task.Run(() => Tempo.Wav(wav, speed));
            return new Response(200, "audio/wav", wav, Headers: new Dictionary<string, string> { ["X-Voice"] = name });
        }
        catch (Exception e)
        {
            Log.Write("Externe Programme: Vorlesen: " + e.Message);
            return ExtError(500, "Read-aloud failed: " + e.Message, "server_error");
        }
    }

    // ---- Verwaltung in der Web-Oberfläche -------------------------------------------------------------------------------------
    JsonObject ExtInfo(Request req)
    {
        var admin = req.Session?.Role == Users.Admin;
        var urls = new JsonArray { (JsonNode)$"http://localhost:{Port}/v1" };
        if (!LocalOnly)
            foreach (var a in core.Addresses())
            {
                urls.Add((JsonNode)$"https://{a}:{Port}/v1");
                if (ExtLanHttp) urls.Add((JsonNode)$"http://{a}:{Port}/v1");
            }
        var sel = Chat.Selected;
        return new JsonObject
        {
            ["enabled"] = ExtEnabled, ["lanHttp"] = ExtLanHttp, ["webLan"] = !LocalOnly, ["urls"] = urls,
            ["ollamaRunning"] = core.Ollama.Running,
            ["defaultModel"] = sel != null && sel.StartsWith(Chat.OllamaPrefix) ? sel[Chat.OllamaPrefix.Length..] : null,
            ["fingerprint"] = cert?.GetCertHashString(System.Security.Cryptography.HashAlgorithmName.SHA256),
            ["keys"] = new JsonArray(ApiKeys.List().Select(k => (JsonNode)new JsonObject
            {
                ["id"] = k.Id, ["name"] = k.Name, ["prefix"] = admin ? k.Prefix : null, ["created"] = k.Created,
                ["ips"] = new JsonArray(k.Ips.Select(i => (JsonNode)i).ToArray()), ["lastUsed"] = k.LastUsed, ["lastIp"] = k.LastIp, ["uses"] = k.Uses,
                ["llm"] = k.Llm, ["tts"] = k.Tts,
            }).ToArray()),
            ["ttsAvailable"] = core.Speech.Available,
        };
    }

    Response ExtManage(Request req)
    {
        switch (req.Method, req.Path)
        {
            case ("GET", "/api/ext"):
                Need(req);
                return Response.Json(ExtInfo(req));
            case ("POST", "/api/ext/settings"):
            {
                Need(req, admin: true);
                var j = req.Json();
                if (j["enabled"] is JsonNode en) { ExtEnabled = (bool)en; Audit(req, $"Externe Programme {(bool)en}"); }
                if (j["lanHttp"] is JsonNode lh) { ExtLanHttp = (bool)lh; Audit(req, $"Externe Programme unverschlüsselt im Netz {(bool)lh}"); }
                return Response.Json(ExtInfo(req));
            }
            case ("POST", "/api/ext/keys/add"):
            {
                Need(req, admin: true);
                var j = req.Json();
                var (k, secret) = ApiKeys.Add((string)j["name"], ApiKeys.ParseIps((string)j["ips"]), (bool?)j["llm"] ?? true, (bool?)j["tts"] ?? false);
                var may = string.Join(" + ", new[] { k.Llm ? "Sprachmodell" : null, k.Tts ? "Vorlesen" : null }.Where(x => x != null));
                Audit(req, $"Schlüssel für externe Programme angelegt: {k.Name} ({may}){(k.Ips.Count > 0 ? " (nur " + string.Join(", ", k.Ips) + ")" : "")}");
                var info = ExtInfo(req);
                info["newKey"] = secret;
                return Response.Json(info);
            }
            case ("POST", "/api/ext/keys/remove"):
            {
                Need(req, admin: true);
                var id = (string)req.Json()["id"];
                var name = ApiKeys.List().FirstOrDefault(k => k.Id == id)?.Name;
                ApiKeys.Remove(id);
                Audit(req, $"Schlüssel für externe Programme gelöscht: {name}");
                return Response.Json(ExtInfo(req));
            }
        }
        return null;
    }

    /// <summary>Öffentliches Zertifikat (PEM) zum Eintragen in andere Programme; nur wenn HTTPS aktiv ist.</summary>
    Response CertificateFile() =>
        cert == null ? Response.Error(404, L.T("Kein Zertifikat (Web-Oberfläche nur auf diesem PC)", "No certificate (web interface on this PC only)"))
            : new Response(200, "application/x-pem-file", Encoding.ASCII.GetBytes(cert.ExportCertificatePem() + "\n"));
}
