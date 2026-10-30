// Web-Oberfläche des Helpers (Port 47532): Status, PCs, Verbindung, Modelle, Einstellungen, Benutzer, Protokoll.
//  - Ein Port für beides: Auf diesem PC (localhost) per HTTP; aus dem Netz nur per HTTPS (selbst erzeugtes Zertifikat, das
//    erste Byte der Verbindung entscheidet). Im Netz erreichbar nur, wenn „Web-Oberfläche im Netz“ eingeschaltet ist.
//  - Eigene Benutzer (Users.cs), Rollen admin/viewer. Erster Admin nur von diesem PC aus.
//  - Sitzung: zufälliges Cookie (HttpOnly, SameSite=Strict, über HTTPS Secure), 12 Stunden. Jede ändernde Anfrage braucht
//    den CSRF-Wert der Sitzung im Kopf X-CSRF; Origin muss (falls gesendet) zum Host passen.
//  - Anmeldung: nach 10 Fehlversuchen in 10 Minuten ist die Adresse 10 Minuten gesperrt.
//  - Seiten liegen als Ressourcen in der exe (web/index.html, app.js, app.css); die API antwortet mit JSON unter /api/.
using System.Collections.Concurrent;
using System.Net;
using System.Net.Security;
using System.Security.Authentication;
using System.Net.Sockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class WebServer
{
    public const int DefaultPort = 47532;
    const int MaxHeader = 16 << 10, MaxBody = 64 << 10;
    static readonly TimeSpan SessionLife = TimeSpan.FromHours(12), FailWindow = TimeSpan.FromMinutes(10);

    sealed class Session
    {
        public string User, Role, Csrf;
        public DateTime Expires;
    }

    sealed class Request
    {
        public string Method, Path, Ip;
        public bool Local, Secure;
        public Dictionary<string, string> Headers = new(StringComparer.OrdinalIgnoreCase);
        public byte[] Body = Array.Empty<byte>();
        public Session Session;
        public JsonNode Json() => Body.Length == 0 ? new JsonObject() : JsonNode.Parse(Body) ?? new JsonObject();
        public string Cookie(string name) =>
            Headers.TryGetValue("Cookie", out var c) ? c.Split(';').Select(p => p.Trim().Split('=', 2)).FirstOrDefault(p => p.Length == 2 && p[0] == name)?[1] : null;
    }

    sealed record Response(int Status, string Type, byte[] Body, string SetCookie = null, string Location = null)
    {
        public static Response Json(JsonNode n, int status = 200, string cookie = null) => new(status, "application/json; charset=utf-8", Encoding.UTF8.GetBytes(n.ToJsonString()), cookie);
        public static Response Error(int status, string text) => Json(new JsonObject { ["error"] = text }, status);
    }

    sealed class ApiError(int status, string message) : Exception(message) { public int Status = status; }

    readonly Core core;
    readonly ConcurrentDictionary<string, Session> sessions = new();
    readonly ConcurrentDictionary<string, (int Count, DateTime Since)> loginFails = new();
    TcpListener listener;
    X509Certificate2 cert;
    public int Port { get; }
    public bool LocalOnly { get; private set; }

    public WebServer(Core core, int port, bool localOnly)
    {
        this.core = core;
        Port = port;
        LocalOnly = localOnly;
    }

    public void Start()
    {
        // NOVABIRD_WEB_TLS=1 nur für Tests: HTTPS auch, wenn nur dieser PC zugreifen darf (ohne Firewall-Abfrage)
        if (!LocalOnly || Environment.GetEnvironmentVariable("NOVABIRD_WEB_TLS") == "1") cert = Certificate();
        listener = new TcpListener(LocalOnly ? IPAddress.Loopback : IPAddress.Any, Port);
        listener.Start();
        Log.Write($"Web-Oberfläche: Port {Port}{(LocalOnly ? " (nur dieser PC)" : " (im Netz per HTTPS)")}");
        _ = AcceptLoop(listener);
    }

    public void Stop()
    {
        try { listener?.Stop(); } catch { /* schon zu */ }
    }

    /// <summary>Im Netz erreichbar ja/nein: Listener neu binden (Sitzungen bleiben).</summary>
    public void Restart(bool localOnly)
    {
        Stop();
        LocalOnly = localOnly;
        Start();
    }

    async Task AcceptLoop(TcpListener l)
    {
        while (true)
        {
            TcpClient tcp;
            try { tcp = await l.AcceptTcpClientAsync(); }
            catch { return; }
            _ = Task.Run(() => Serve(tcp));
        }
    }

    async Task Serve(TcpClient tcp)
    {
        using (tcp)
        {
            var remote = (tcp.Client.RemoteEndPoint as IPEndPoint)?.Address;
            var ip = remote?.ToString() ?? "?";
            bool local = remote != null && IPAddress.IsLoopback(remote);
            try
            {
                tcp.ReceiveTimeout = tcp.SendTimeout = 30_000;
                Stream stream = tcp.GetStream();
                // Erstes Byte ansehen, ohne es zu verbrauchen: 0x16 = TLS-Handshake
                var first = new byte[1];
                if (await tcp.Client.ReceiveAsync(first, SocketFlags.Peek) <= 0) return;
                bool secure = first[0] == 0x16;
                if (secure)
                {
                    if (cert == null) return; // HTTPS nur, wenn im Netz eingeschaltet
                    var ssl = new SslStream(stream, false);
                    await ssl.AuthenticateAsServerAsync(new SslServerAuthenticationOptions { ServerCertificate = cert, ClientCertificateRequired = false, EnabledSslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13 });
                    stream = ssl;
                }
                var req = await Read(stream);
                req.Ip = ip;
                req.Local = local;
                req.Secure = secure;
                Response res;
                if (!secure && !local)
                {
                    // Aus dem Netz nur verschlüsselt
                    var host = req.Headers.GetValueOrDefault("Host") ?? "";
                    res = new Response(301, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes("HTTPS verwenden"), Location: $"https://{host}{req.Path}");
                }
                else res = await Route(req);
                await Write(stream, res, secure);
            }
            catch (Exception e) when (e is IOException or AuthenticationException or SocketException or ObjectDisposedException)
            {
                // Verbindung abgebrochen oder kein gültiges TLS – nichts zu tun
            }
            catch (Exception e)
            {
                Log.Write($"Web {ip}: {e.Message}");
            }
        }
    }

    static async Task<Request> Read(Stream s)
    {
        var buf = new List<byte>(1024);
        var one = new byte[1];
        while (true)
        {
            if (buf.Count >= MaxHeader) throw new IOException("Kopf zu groß");
            if (await s.ReadAsync(one) <= 0) throw new IOException("Verbindung beendet");
            buf.Add(one[0]);
            int c = buf.Count;
            if (c >= 4 && buf[c - 4] == '\r' && buf[c - 3] == '\n' && buf[c - 2] == '\r' && buf[c - 1] == '\n') break;
        }
        var lines = Encoding.ASCII.GetString(buf.ToArray()).Split("\r\n");
        var first = lines[0].Split(' ');
        if (first.Length < 3) throw new IOException("ungültige Anfrage");
        var req = new Request { Method = first[0], Path = Uri.UnescapeDataString(first[1].Split('?')[0]) };
        foreach (var l in lines.Skip(1))
        {
            int i = l.IndexOf(':');
            if (i > 0) req.Headers[l[..i].Trim()] = l[(i + 1)..].Trim();
        }
        if (req.Headers.TryGetValue("Content-Length", out var len) && int.TryParse(len, out var n) && n > 0)
        {
            if (n > MaxBody) throw new IOException("Rumpf zu groß");
            req.Body = new byte[n];
            int got = 0;
            while (got < n)
            {
                int k = await s.ReadAsync(req.Body.AsMemory(got, n - got));
                if (k <= 0) throw new IOException("Verbindung beendet");
                got += k;
            }
        }
        return req;
    }

    static async Task Write(Stream s, Response r, bool secure)
    {
        var reason = r.Status switch
        {
            200 => "OK", 301 => "Moved Permanently", 400 => "Bad Request", 401 => "Unauthorized", 403 => "Forbidden", 404 => "Not Found",
            409 => "Conflict", 429 => "Too Many Requests", _ => "Error",
        };
        var head = new StringBuilder();
        head.Append($"HTTP/1.1 {r.Status} {reason}\r\nContent-Type: {r.Type}\r\nContent-Length: {r.Body.Length}\r\nConnection: close\r\n");
        head.Append("Cache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nReferrer-Policy: no-referrer\r\nX-Frame-Options: DENY\r\n");
        head.Append("Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'\r\n");
        if (r.SetCookie != null) head.Append($"Set-Cookie: {r.SetCookie}\r\n");
        if (r.Location != null) head.Append($"Location: {r.Location}\r\n");
        head.Append("\r\n");
        await s.WriteAsync(Encoding.ASCII.GetBytes(head.ToString()));
        if (r.Body.Length > 0) await s.WriteAsync(r.Body);
        await s.FlushAsync();
    }

    // ---- Routen --------------------------------------------------------------------------------------------------------------
    async Task<Response> Route(Request req)
    {
        // Gegen DNS-Rebinding: über HTTP (nur localhost) muss der Host localhost/127.0.0.1/[::1] sein
        if (!req.Secure)
        {
            var host = (req.Headers.GetValueOrDefault("Host") ?? "").ToLowerInvariant();
            var name = host.StartsWith('[') ? host[..(host.IndexOf(']') + 1)] : host.Split(':')[0];
            if (name is not ("localhost" or "127.0.0.1" or "[::1]")) return Response.Error(400, "Host");
        }
        if (req.Method == "GET" && !req.Path.StartsWith("/api/")) return Static(req.Path);
        req.Session = SessionOf(req);
        // Sprache der Antworten: X-Lang der Oberfläche, sonst Accept-Language
        var lang = req.Headers.GetValueOrDefault("X-Lang") ?? req.Headers.GetValueOrDefault("Accept-Language");
        if (!string.IsNullOrEmpty(lang)) L.ForRequest(!lang.StartsWith("de", StringComparison.OrdinalIgnoreCase)); // sonst Windows-Sprache
        try
        {
            if (req.Method == "POST")
            {
                // Ändernde Anfragen: gleiche Herkunft und (außer Anmelden/Einrichten) CSRF-Wert der Sitzung
                if (req.Headers.TryGetValue("Origin", out var origin) && origin != $"{(req.Secure ? "https" : "http")}://{req.Headers.GetValueOrDefault("Host")}")
                    return Response.Error(403, L.T("Herkunft", "Origin"));
                if (req.Path is not ("/api/login" or "/api/setup") && (req.Session == null || req.Headers.GetValueOrDefault("X-CSRF") != req.Session.Csrf))
                    return Response.Error(403, L.T("Sitzung abgelaufen – bitte neu anmelden", "Session expired – please sign in again"));
            }
            return await Api(req);
        }
        catch (ApiError e) { return Response.Error(e.Status, e.Message); }
        catch (ArgumentException e) { return Response.Error(400, e.Message); }
        catch (Exception e)
        {
            Log.Write($"Web-API {req.Path}: {e}");
            return Response.Error(500, e.Message);
        }
    }

    static Response Static(string path)
    {
        if (path == "/") path = "/index.html";
        var (name, type) = path switch
        {
            "/index.html" => ("web/index.html", "text/html; charset=utf-8"),
            "/app.js" => ("web/app.js", "text/javascript; charset=utf-8"),
            "/app.css" => ("web/app.css", "text/css; charset=utf-8"),
            "/i18n.js" => ("web/i18n.js", "text/javascript; charset=utf-8"),
            "/favicon.ico" => ("web/favicon.ico", "image/x-icon"),
            _ => (null, null),
        };
        using var res = name == null ? null : typeof(WebServer).Assembly.GetManifestResourceStream(name);
        if (res == null) return Response.Error(404, L.T("nicht gefunden", "not found"));
        using var ms = new MemoryStream();
        res.CopyTo(ms);
        return new Response(200, type, ms.ToArray());
    }

    Session SessionOf(Request req)
    {
        var token = req.Cookie("nbh_session");
        if (token == null || !sessions.TryGetValue(token, out var s)) return null;
        if (s.Expires < DateTime.UtcNow) { sessions.TryRemove(token, out _); return null; }
        return s;
    }

    static void Need(Request req, bool admin = false)
    {
        if (req.Session == null) throw new ApiError(401, L.T("Bitte anmelden", "Please sign in"));
        if (admin && req.Session.Role != Users.Admin) throw new ApiError(403, L.T("Nur für Admins", "Admins only"));
    }

    Response NewSession(Request req, string user, string role)
    {
        foreach (var kv in sessions) if (kv.Value.Expires < DateTime.UtcNow) sessions.TryRemove(kv.Key, out _);
        var token = Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');
        var s = new Session { User = user, Role = role, Csrf = Convert.ToHexString(RandomNumberGenerator.GetBytes(16)), Expires = DateTime.UtcNow + SessionLife };
        sessions[token] = s;
        req.Session = s;
        var cookie = $"nbh_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={(int)SessionLife.TotalSeconds}{(req.Secure ? "; Secure" : "")}";
        return Response.Json(SessionInfo(req), 200, cookie);
    }

    JsonObject SessionInfo(Request req) => new()
    {
        ["user"] = req.Session?.User,
        ["role"] = req.Session?.Role,
        ["csrf"] = req.Session?.Csrf,
        ["setup"] = !Users.Any(),
        ["setupAllowed"] = req.Local,
        ["local"] = req.Local,
        ["version"] = Program.Version,
        ["mode"] = core.Mode,
    };

    bool LoginBlocked(string ip) => loginFails.TryGetValue(ip, out var f) && f.Count >= 10 && DateTime.UtcNow - f.Since < FailWindow;

    void LoginFailed(string ip) =>
        loginFails.AddOrUpdate(ip, _ => (1, DateTime.UtcNow), (_, f) => DateTime.UtcNow - f.Since > FailWindow ? (1, DateTime.UtcNow) : (f.Count + 1, f.Since));

    void Audit(Request req, string what) => Log.Write($"Web: {req.Session?.User ?? "?"} ({req.Ip}) {what}");

    async Task<Response> Api(Request req)
    {
        var sch = core.Server.Scheduler;
        switch (req.Method, req.Path)
        {
            // ---- ohne Anmeldung ----
            case ("GET", "/api/ping"):
                // Für das Symbol im Infobereich (Dienstbetrieb): nur Zustand, nur von diesem PC
                if (!req.Local) throw new ApiError(403, L.T("nur lokal", "local only"));
                return Response.Json(new JsonObject
                {
                    ["version"] = Program.Version, ["mode"] = core.Mode, ["state"] = core.StateText(), ["paused"] = sch.Paused,
                    ["pcs"] = sch.Clients().Count(c => DateTime.Now - c.LastSeen < TimeSpan.FromDays(1)),
                    ["setup"] = !Users.Any(), // noch kein Admin: das Symbol weist darauf hin
                });
            case ("GET", "/api/session"):
                return Response.Json(SessionInfo(req));
            case ("POST", "/api/setup"):
            {
                if (Users.Any()) throw new ApiError(409, L.T("Schon eingerichtet", "Already set up"));
                if (!req.Local) throw new ApiError(403, L.T("Den ersten Admin nur an diesem PC anlegen (http://localhost)", "Create the first admin on this PC only (http://localhost)"));
                var j = req.Json();
                Users.Add((string)j["name"], (string)j["password"], Users.Admin);
                Log.Write($"Web: erster Admin {(string)j["name"]} angelegt ({req.Ip})");
                return NewSession(req, (string)j["name"], Users.Admin);
            }
            case ("POST", "/api/login"):
            {
                if (LoginBlocked(req.Ip)) throw new ApiError(429, L.T("Zu viele Fehlversuche – in 10 Minuten wieder", "Too many failed attempts – try again in 10 minutes"));
                var j = req.Json();
                var who = await Task.Run(() => Users.Check((string)j["name"], (string)j["password"]));
                if (who == null)
                {
                    LoginFailed(req.Ip);
                    Log.Write($"Web: Anmeldung fehlgeschlagen ({req.Ip})");
                    throw new ApiError(401, L.T("Name oder Passwort falsch", "Wrong name or password"));
                }
                loginFails.TryRemove(req.Ip, out _);
                Log.Write($"Web: {who.Value.Name} angemeldet ({req.Ip})");
                return NewSession(req, who.Value.Name, who.Value.Role);
            }
            case ("POST", "/api/logout"):
            {
                var token = req.Cookie("nbh_session");
                if (token != null) sessions.TryRemove(token, out _);
                return Response.Json(new JsonObject { ["ok"] = true }, 200, $"nbh_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0{(req.Secure ? "; Secure" : "")}");
            }

            // ---- lesen (alle Rollen) ----
            case ("GET", "/api/status"):
                Need(req);
                return Response.Json(Status());
            case ("GET", "/api/pcs"):
                Need(req);
                return Response.Json(Pcs());
            case ("GET", "/api/settings"):
                Need(req);
                return Response.Json(SettingsInfo());

            // ---- nur Admins ----
            case ("GET", "/api/connection"):
                Need(req, admin: true);
                return Response.Json(new JsonObject
                {
                    ["addresses"] = new JsonArray(core.Addresses().Select(a => (JsonNode)a).ToArray()), ["code"] = NetServer.Code(), ["port"] = core.Server.Port,
                    ["webFingerprint"] = cert?.GetCertHashString(HashAlgorithmName.SHA256),
                });
            case ("POST", "/api/connection/renew"):
                Need(req, admin: true);
                core.Server.Renew();
                Audit(req, "neuer Kopplungscode");
                return Response.Json(new JsonObject { ["ok"] = true });
            case ("POST", "/api/pcs/forget"):
                Need(req, admin: true);
                sch.Forget((string)req.Json()["id"]);
                Audit(req, "PC aus der Liste entfernt");
                return Response.Json(Pcs());
            case ("POST", "/api/settings"):
                Need(req, admin: true);
                return Response.Json(ChangeSettings(req));
            case ("POST", "/api/vectors/clear"):
                Need(req, admin: true);
                core.Server.Vectors.Clear();
                Audit(req, "geteilte Vektoren gelöscht");
                return Response.Json(Status());
            case ("POST", "/api/measure"):
                Need(req, admin: true);
                core.Prepare(measureAgain: true);
                Audit(req, "Geräte messen");
                return Response.Json(new JsonObject { ["ok"] = true });
            case ("GET", "/api/users"):
                Need(req, admin: true);
                return Response.Json(new JsonArray(Users.List().Select(u => (JsonNode)new JsonObject { ["name"] = u.Name, ["role"] = u.Role, ["created"] = u.Created }).ToArray()));
            case ("POST", "/api/users/add"):
            {
                Need(req, admin: true);
                var j = req.Json();
                Users.Add((string)j["name"], (string)j["password"], (string)j["role"]);
                Audit(req, $"Benutzer {(string)j["name"]} angelegt");
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("POST", "/api/users/role"):
            {
                Need(req, admin: true);
                var j = req.Json();
                Users.SetRole((string)j["name"], (string)j["role"]);
                DropSessions((string)j["name"]);
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("POST", "/api/users/password"):
            {
                Need(req, admin: true);
                var j = req.Json();
                Users.SetPassword((string)j["name"], (string)j["password"]);
                DropSessions((string)j["name"], keep: req.Session);
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("POST", "/api/users/remove"):
            {
                Need(req, admin: true);
                var j = req.Json();
                if (string.Equals((string)j["name"], req.Session.User, StringComparison.OrdinalIgnoreCase)) throw new ApiError(400, L.T("Sich selbst nicht löschen", "You cannot delete yourself"));
                Users.Remove((string)j["name"]);
                DropSessions((string)j["name"]);
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("POST", "/api/me/password"):
            {
                Need(req);
                var j = req.Json();
                if (await Task.Run(() => Users.Check(req.Session.User, (string)j["old"])) == null) throw new ApiError(400, L.T("Bisheriges Passwort falsch", "Current password is wrong"));
                Users.SetPassword(req.Session.User, (string)j["password"]);
                DropSessions(req.Session.User, keep: req.Session);
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            // ---- Sprachmodell ----
            case ("GET", "/api/llm"):
                Need(req);
                return Response.Json(await LlmInfo());
            case ("POST", "/api/llm/select"):
            {
                Need(req, admin: true);
                var name = (string)req.Json()["name"];
                if (name != null && name.StartsWith("ollama:"))
                {
                    if (!core.Ollama.Running || !(await core.Ollama.Models()).Any(m => m.Name == name[7..])) throw new ApiError(400, L.T("Modell in Ollama nicht vorhanden", "Model not available in Ollama"));
                }
                else if (name != null && !Chat.Available().Any(m => m.Name == name)) throw new ApiError(400, L.T("Modell unbekannt", "Unknown model"));
                Chat.Selected = name;
                Audit(req, $"Sprachmodell gewählt: {name ?? "keins"}");
                return Response.Json(await LlmInfo());
            }
            case ("POST", "/api/llm/delete"):
            {
                Need(req, admin: true);
                var name = (string)req.Json()["name"];
                if (!Chat.Available().Any(m => m.Name == name)) throw new ApiError(400, L.T("Modell unbekannt", "Unknown model"));
                core.Server.Chat.Delete(name);
                Audit(req, $"Sprachmodell gelöscht: {name}");
                return Response.Json(await LlmInfo());
            }
            case ("POST", "/api/ollama/install"):
                Need(req, admin: true);
                core.Ollama.Install();
                Audit(req, $"Ollama {Ollama.Version} einrichten");
                return Response.Json(await LlmInfo());
            case ("POST", "/api/ollama/enable"):
            {
                Need(req, admin: true);
                bool on = (bool?)req.Json()["on"] ?? true;
                Ollama.Enabled = on;
                if (on) core.Ollama.Start(); else core.Ollama.Stop();
                Audit(req, $"Ollama {(on ? "an" : "aus")}");
                return Response.Json(await LlmInfo());
            }
            case ("POST", "/api/ollama/pull"):
            {
                Need(req, admin: true);
                var name = ((string)req.Json()["name"])?.Trim();
                if (!core.Ollama.Running) throw new ApiError(400, L.T("Ollama läuft nicht", "Ollama is not running"));
                core.Ollama.Pull(name);
                Audit(req, $"Ollama-Modell laden: {name}");
                return Response.Json(await LlmInfo());
            }
            case ("POST", "/api/ollama/delete"):
            {
                Need(req, admin: true);
                var name = (string)req.Json()["name"];
                await core.Ollama.Delete(name);
                if (Chat.Selected == "ollama:" + name) Chat.Selected = null;
                Audit(req, $"Ollama-Modell gelöscht: {name}");
                return Response.Json(await LlmInfo());
            }
            case ("GET", "/api/prompt"):
            {
                Need(req);
                var lang = req.Headers.GetValueOrDefault("X-Lang") == "en" ? "en" : "de";
                using var res = typeof(WebServer).Assembly.GetManifestResourceStream("web/prompts.json");
                var all = JsonNode.Parse(res);
                return Response.Json(new JsonObject { ["defaults"] = all[lang]?.DeepClone(), ["custom"] = Chat.CustomPrompt?.DeepClone() });
            }
            case ("POST", "/api/prompt"):
            {
                Need(req, admin: true);
                var j = req.Json();
                JsonObject custom = null;
                if (j["mail"] != null || j["thread"] != null)
                {
                    custom = new JsonObject();
                    foreach (var kind in new[] { "mail", "thread" })
                    {
                        var t = ((string)j[kind])?.Trim();
                        if (string.IsNullOrEmpty(t)) continue;
                        if (t.Length > 10_000) throw new ApiError(400, L.T("Anweisung zu lang", "Instruction too long"));
                        if (!t.Contains("{OPEN}") || !t.Contains("{CLOSE}")) throw new ApiError(400, L.T("Die Platzhalter {OPEN} und {CLOSE} müssen in der Anweisung bleiben (sie umschließen den Mailtext).", "The placeholders {OPEN} and {CLOSE} must stay in the instruction (they enclose the message text)."));
                        custom[kind] = t;
                    }
                    if (custom.Count == 0) custom = null;
                }
                Chat.CustomPrompt = custom;
                Audit(req, custom == null ? "Anweisung: Standard" : "Anweisung: eigene Fassung gespeichert");
                return Response.Json(new JsonObject { ["custom"] = custom?.DeepClone() });
            }
            case ("POST", "/api/llm/import"):
            {
                Need(req, admin: true);
                var path = ((string)req.Json()["path"])?.Trim().Trim('"');
                if (string.IsNullOrEmpty(path) || !Directory.Exists(path)) throw new ApiError(400, L.T("Ordner nicht gefunden (Pfad auf diesem PC)", "Folder not found (path on this PC)"));
                if (importing != null) throw new ApiError(409, L.T("Es wird schon ein Modell übernommen", "A model is already being taken over"));
                importing = new Txt("Übernehme …", "Taking over …");
                Audit(req, $"Sprachmodell übernehmen aus {path}");
                _ = Task.Run(() =>
                {
                    try
                    {
                        var name = Chat.Import(path, (d, t) => importing = new Txt($"Übernehme: {d * 100 / Math.Max(1, t)} %", $"Taking over: {d * 100 / Math.Max(1, t)} %"));
                        Chat.Selected ??= name;
                        importing = null;
                    }
                    catch (Exception e)
                    {
                        importing = null;
                        core.Notify(L.T("Sprachmodell übernehmen fehlgeschlagen: ", "Taking over the language model failed: ") + e.Message, true);
                        Log.Write("Sprachmodell übernehmen: " + e.Message);
                    }
                });
                return Response.Json(await LlmInfo());
            }
            case ("POST", "/api/llm/test"):
            {
                Need(req, admin: true);
                var text = (string)req.Json()["text"];
                if (string.IsNullOrWhiteSpace(text)) throw new ApiError(400, L.T("Text fehlt", "Text missing"));
                var messages = new JsonArray(
                    new JsonObject { ["role"] = "system", ["content"] = L.T("Fasse den Text kurz und sachlich auf Deutsch zusammen.", "Summarise the text briefly and objectively in English.") },
                    new JsonObject { ["role"] = "user", ["content"] = text.Length > 20_000 ? text[..20_000] : text });
                return Response.Json(new JsonObject { ["id"] = core.Server.Chat.Start("web:" + req.Session.User, messages, 400) });
            }
            case ("POST", "/api/llm/poll"):
                Need(req, admin: true);
                return Response.Json(await core.Server.Chat.Poll("web:" + req.Session.User, (string)req.Json()["id"]));
            case ("POST", "/api/mode"):
            {
                // Umstellen braucht die UAC-Bestätigung am PC selbst – daher nur von localhost
                Need(req, admin: true);
                if (!req.Local) throw new ApiError(403, L.T("Nur direkt an diesem PC (http://localhost) möglich – Windows fragt dort nach Adminrechten.", "Only possible directly on this PC (http://localhost) – Windows asks for admin rights there."));
                if ((string)req.Json()["target"] != "service" || Settings.ServiceMode)
                    throw new ApiError(400, L.T("Zurück zum Programm im Benutzerkonto: Rechtsklick auf das Symbol im Infobereich.", "Back to the program in the user account: right-click the icon in the notification area."));
                Audit(req, "auf Windows-Dienst umstellen");
                var error = await Task.Run(Service.SwitchToService);
                if (error != null) throw new ApiError(500, L.T("Umstellen ", "Switching ") + error);
                _ = Task.Delay(500).ContinueWith(_ => core.Exit()); // der Dienst übernimmt die Ports
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("GET", "/api/log"):
                Need(req, admin: true);
                return Response.Json(new JsonObject { ["lines"] = new JsonArray(LogTail(400).Select(l => (JsonNode)l).ToArray()) });
        }
        throw new ApiError(404, L.T("unbekannt", "unknown"));
    }

    void DropSessions(string user, Session keep = null)
    {
        foreach (var kv in sessions)
            if (kv.Value != keep && string.Equals(kv.Value.User, user, StringComparison.OrdinalIgnoreCase)) sessions.TryRemove(kv.Key, out _);
    }

    static List<string> LogTail(int n)
    {
        try
        {
            using var f = new FileStream(Core.LogPath, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var r = new StreamReader(f);
            var lines = r.ReadToEnd().Split('\n', StringSplitOptions.RemoveEmptyEntries);
            return lines.Skip(Math.Max(0, lines.Length - n)).Select(l => l.TrimEnd('\r')).ToList();
        }
        catch { return new(); }
    }

    // ---- Inhalte ------------------------------------------------------------------------------------------------------------
    JsonObject Status()
    {
        var sch = core.Server.Scheduler;
        var s = Settings.Load();
        var r = sch.Rates;
        return new JsonObject
        {
            ["version"] = Program.Version,
            ["mode"] = core.Mode,
            ["started"] = core.Started.ToString("o"),
            ["state"] = core.StateText(),
            ["preparing"] = core.Preparing,
            ["error"] = core.LastError,
            ["device"] = (string)s["device"],
            ["deviceName"] = (string)s["deviceName"],
            ["measured"] = (double?)s["mailsPerSec"],
            ["rate"] = r.All, ["rateGpu"] = r.Gpu, ["rateCpu"] = r.Cpu,
            ["queue"] = sch.QueueLength,
            ["paused"] = sch.Paused,
            ["cpu"] = sch.CpuEnabled, ["cpuThreads"] = sch.CpuThreads, ["cpuBlocked"] = Scheduler.CpuBlocked(),
            ["model"] = new JsonObject
            {
                ["id"] = core.Model.Id, ["revision"] = core.Model.Revision, ["complete"] = core.Model.Complete, ["ready"] = ModelStore.Ready(core.Model),
            },
            ["devices"] = s["devices"]?.DeepClone(),
            ["vectors"] = new JsonObject
            {
                ["enabled"] = VectorStore.Enabled, ["count"] = core.Server.Vectors.Count, ["bytes"] = core.Server.Vectors.Bytes,
                ["hits"] = core.Server.Vectors.Hits, ["misses"] = core.Server.Vectors.Misses, ["stored"] = core.Server.Vectors.Stored,
            },
            ["chat"] = new JsonObject { ["selected"] = Chat.Selected, ["loaded"] = core.Server.Chat.Loaded, ["busy"] = core.Server.Chat.Busy, ["ollama"] = core.Ollama.Status },
            ["netPort"] = core.Server.Port,
            ["webLan"] = !LocalOnly,
        };
    }

    volatile Txt importing;

    async Task<JsonObject> LlmInfo()
    {
        var chat = core.Server.Chat;
        var o = core.Ollama;
        var ollama = new JsonObject
        {
            ["version"] = Ollama.Version, ["installed"] = Ollama.Installed, ["enabled"] = Ollama.Enabled, ["running"] = o.Running,
            ["status"] = o.Status, ["installing"] = o.Installing, ["pulling"] = o.Pulling, ["error"] = o.LastError,
            ["catalog"] = new JsonArray(Ollama.Catalog.Select(c => (JsonNode)new JsonObject { ["name"] = c.Tag, ["label"] = c.Label, ["gb"] = c.Gb }).ToArray()),
        };
        if (o.Running)
        {
            try
            {
                var loaded = await o.Loaded();
                ollama["models"] = new JsonArray((await o.Models()).Select(m => (JsonNode)new JsonObject
                {
                    ["name"] = m.Name, ["bytes"] = m.Bytes, ["vram"] = loaded.FirstOrDefault(l => l.Name == m.Name).Vram,
                }).ToArray());
            }
            catch (Exception e) { ollama["error"] = "Ollama antwortet nicht: " + e.Message; }
        }
        return new JsonObject
        {
            ["ollama"] = ollama,
            ["models"] = new JsonArray(Chat.Available().Select(m => (JsonNode)new JsonObject
            {
                ["name"] = m.Name, ["bytes"] = m.Bytes, ["type"] = m.Type, ["context"] = m.Context,
            }).ToArray()),
            ["selected"] = Chat.Selected,
            ["loaded"] = chat.Loaded,
            ["busy"] = chat.Busy,
            ["waiting"] = chat.Waiting,
            ["importing"] = importing?.ToString(),
            ["dir"] = Chat.Dir,
        };
    }

    JsonObject Pcs()
    {
        var list = core.Server.Scheduler.Clients();
        return new JsonObject
        {
            ["pcs"] = new JsonArray(list.Select(c => (JsonNode)new JsonObject
            {
                ["id"] = c.Id, ["label"] = Core.Label(c, c.Id), ["today"] = c.Today, ["total"] = c.Total, ["indexed"] = c.Indexed, ["mails"] = c.Mails,
                ["firstSeen"] = c.FirstSeen.ToString("o"), ["lastSeen"] = c.LastSeen.ToString("o"),
            }).ToArray()),
        };
    }

    JsonObject SettingsInfo()
    {
        var sch = core.Server.Scheduler;
        return new JsonObject
        {
            ["cpu"] = sch.CpuEnabled, ["threads"] = sch.CpuThreadsSetting, ["autoThreads"] = Scheduler.AutoThreads, ["cores"] = Environment.ProcessorCount,
            ["cpuBlocked"] = Scheduler.CpuBlocked(),
            ["paused"] = sch.Paused,
            ["autostart"] = Settings.ServiceMode ? null : Core.Autostart,
            ["netPort"] = Core.PortSetting, ["netPortActive"] = core.Server.Port,
            ["webPort"] = Core.WebPortSetting, ["webPortActive"] = Port,
            ["webLan"] = Core.WebLan,
            ["vecShare"] = VectorStore.Enabled,
            ["mode"] = core.Mode,
        };
    }

    JsonObject ChangeSettings(Request req)
    {
        var j = req.Json();
        var sch = core.Server.Scheduler;
        var changed = new List<string>();
        if (j["cpu"] is JsonNode cpu) { sch.CpuEnabled = (bool)cpu; changed.Add($"CPU {(bool)cpu}"); }
        if (j["threads"] is JsonNode th) { sch.CpuThreadsSetting = (int)th; changed.Add($"Threads {(int)th}"); }
        if (j["paused"] is JsonNode pa) { sch.Paused = (bool)pa; changed.Add($"Pause {(bool)pa}"); }
        if (j["vecShare"] is JsonNode vs) { VectorStore.Enabled = (bool)vs; changed.Add($"Vektoren teilen {(bool)vs}"); }
        if (j["autostart"] is JsonNode au && !Settings.ServiceMode) { Core.Autostart = (bool)au; changed.Add($"Autostart {(bool)au}"); }
        if (j["netPort"] is JsonNode np) { Core.PortSetting = CheckPort((int)np); changed.Add($"Netz-Port {(int)np}"); }
        if (j["webPort"] is JsonNode wp) { Core.WebPortSetting = CheckPort((int)wp); changed.Add($"Web-Port {(int)wp}"); }
        if (j["webLan"] is JsonNode wl && (bool)wl != Core.WebLan)
        {
            Core.WebLan = (bool)wl;
            changed.Add($"Web im Netz {(bool)wl}");
            // Erst antworten, dann neu binden (sonst bricht diese Verbindung ab)
            _ = Task.Delay(300).ContinueWith(_ => Restart(!(bool)wl));
        }
        Audit(req, "Einstellungen: " + string.Join(", ", changed));
        return SettingsInfo();
    }

    static int CheckPort(int p) => p is >= 1024 and <= 65535 ? p : throw new ArgumentException(L.T("Port: 1024–65535", "Port: 1024–65535"));

    // ---- Zertifikat für HTTPS (selbst erzeugt, RSA 2048, 5 Jahre; Datei + Passwort mit DPAPI im Datenordner) -----------------
    static X509Certificate2 Certificate()
    {
        var path = Path.Combine(Settings.Dir, "web-cert.pfx");
        var s = Settings.Load();
        try
        {
            if (File.Exists(path) && s["webCertPass"] is JsonNode p)
            {
                var c = X509CertificateLoader.LoadPkcs12(File.ReadAllBytes(path), Encoding.UTF8.GetString(Settings.Unprotect((string)p)));
                if (c.NotAfter > DateTime.Now.AddDays(30)) return c;
            }
        }
        catch (Exception e) { Log.Write("Web-Zertifikat unlesbar, erzeuge neu: " + e.Message); }
        using var rsa = RSA.Create(2048);
        var req = new CertificateRequest($"CN=NovaBird Helper ({Environment.MachineName})", rsa, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        var san = new SubjectAlternativeNameBuilder();
        san.AddDnsName(Environment.MachineName);
        san.AddDnsName("localhost");
        san.AddIpAddress(IPAddress.Loopback);
        foreach (var a in NetServer.LocalAddresses()) if (IPAddress.TryParse(a, out var ip)) san.AddIpAddress(ip);
        req.CertificateExtensions.Add(san.Build());
        req.CertificateExtensions.Add(new X509KeyUsageExtension(X509KeyUsageFlags.DigitalSignature | X509KeyUsageFlags.KeyEncipherment, true));
        req.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid("1.3.6.1.5.5.7.3.1") }, false));
        using var made = req.CreateSelfSigned(DateTimeOffset.Now.AddDays(-1), DateTimeOffset.Now.AddYears(5));
        var pass = Convert.ToBase64String(RandomNumberGenerator.GetBytes(24));
        var pfx = made.Export(X509ContentType.Pfx, pass);
        Directory.CreateDirectory(Settings.Dir);
        File.WriteAllBytes(path, pfx);
        s = Settings.Load();
        s["webCertPass"] = Settings.Protect(Encoding.UTF8.GetBytes(pass));
        Settings.Save(s);
        Log.Write("Web-Zertifikat erzeugt");
        return X509CertificateLoader.LoadPkcs12(pfx, pass);
    }
}
