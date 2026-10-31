// OpenAI-kompatible Schnittstelle für andere Programme (Einstellung „Externe Programme“, standardmäßig aus):
//  - Gleicher Port wie die Web-Oberfläche, Pfade /v1/models, /v1/chat/completions, /v1/completions, /v1/embeddings.
//    Auf diesem PC per HTTP, aus dem Netz per HTTPS (nur wenn „Web-Oberfläche im Netz“ an ist); auf Wunsch im Netz auch
//    unverschlüsselt (manche Programme lehnen das selbst erzeugte Zertifikat ab).
//  - Jede Anfrage braucht „Authorization: Bearer <Schlüssel>“ (ApiKeys.cs), optional nur von bestimmten Adressen.
//    Falsche Schlüssel zählen wie falsche Anmeldungen (10 in 10 Minuten sperren die Adresse).
//  - Weitergeleitet an das vom Helper verwaltete Ollama (127.0.0.1, nie selbst im Netz); Antworten (auch gestreamt) laufen
//    unverändert durch. Modell „default“ oder ohne Angabe = das in der Web-Oberfläche gewählte Ollama-Modell.
//    Ollama lädt nichts nach (/v1 kann keine Modelle laden oder löschen).
using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed partial class WebServer
{
    const int ExtMaxBody = 8 << 20;
    static readonly string[] ExtPaths = { "/v1/models", "/v1/chat/completions", "/v1/completions", "/v1/embeddings" };
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
        if (res != null) await Write(stream, res, req.Secure);
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
        if ((req.Path == "/v1/models") != (req.Method == "GET")) return ExtError(405, "Method not allowed");
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
            }).ToArray()),
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
                var (k, secret) = ApiKeys.Add((string)j["name"], ApiKeys.ParseIps((string)j["ips"]));
                Audit(req, $"Schlüssel für externe Programme angelegt: {k.Name}{(k.Ips.Count > 0 ? " (nur " + string.Join(", ", k.Ips) + ")" : "")}");
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
