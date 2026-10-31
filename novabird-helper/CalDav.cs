// CalDAV für die Team-Kalender (Calendars.cs) unter /dav/ am Port der Web-Oberfläche. Thunderbird, DAVx⁵ (Android) und iOS
// gleichen damit Termine und Aufgaben ab; im Netz nur per HTTPS (wie die Web-Oberfläche).
//  - Anmeldung: HTTP Basic mit den Benutzern der Web-Oberfläche; geprüfte Anmeldungen werden 15 Minuten im Speicher gehalten
//    (PBKDF2 je Anfrage wäre zu langsam). Fehlversuche zählen wie beim Anmelden in der Web-Oberfläche.
//  - Aufbau: /dav/ (Wurzel) → /dav/<Benutzer>/ (Principal und Kalender-Heimat) → /dav/<Benutzer>/<Kalender>/ → <Eintrag>.ics
//    Jeder Benutzer sieht unter seinem Pfad die Kalender, für die er Rechte hat.
//  - Umfang (Teilmenge von RFC 4918, 4791, 6578): OPTIONS, PROPFIND, PROPPATCH (abgelehnt), REPORT (calendar-multiget,
//    calendar-query ohne Zeitfilter – der Kalender filtert selbst –, sync-collection), GET/HEAD, PUT und DELETE mit If-Match
//    bzw. If-None-Match. Kalender anlegen/löschen nur in der Web-Oberfläche. Keine Einladungen (Scheduling), kein Frei/Belegt.
using System.Collections.Concurrent;
using System.Security.Cryptography;
using System.Text;
using System.Xml;
using System.Xml.Linq;

namespace NovaBird.Helper;

sealed partial class WebServer
{
    static readonly XNamespace D = "DAV:", C = "urn:ietf:params:xml:ns:caldav", CS = "http://calendarserver.org/ns/", A = "http://apple.com/ns/ical/";
    const int DavMaxBody = Calendars.MaxItemBytes + (64 << 10);
    static readonly TimeSpan DavAuthLife = TimeSpan.FromMinutes(15);
    readonly ConcurrentDictionary<string, (string User, DateTime Until)> davAuth = new(); // Hash(Name:Passwort) -> Benutzer
    readonly byte[] davPepper = RandomNumberGenerator.GetBytes(32);

    static bool IsDavPath(string path) => path == "/dav" || path.StartsWith("/dav/") || path.StartsWith("/.well-known/caldav");

    /// <summary>Benutzer geändert (Passwort, Rolle, gelöscht): gemerkte Anmeldungen verwerfen.</summary>
    void ForgetDavLogins() => davAuth.Clear();

    static Response Dav(int status, string text = null, Dictionary<string, string> headers = null) =>
        new(status, "text/plain; charset=utf-8", Encoding.UTF8.GetBytes(text ?? ""), Headers: headers);

    async Task<Response> DavHandle(Request req)
    {
        if (req.Path.StartsWith("/.well-known/caldav")) return new Response(301, "text/plain; charset=utf-8", Array.Empty<byte>(), Location: "/dav/");
        var user = DavUser(req);
        if (user == null)
        {
            if (LoginBlocked(req.Ip)) return Dav(429, "blocked");
            await Task.Delay(req.Headers.ContainsKey("Authorization") ? 300 : 0);
            return Dav(401, "Anmeldung nötig", new() { ["WWW-Authenticate"] = "Basic realm=\"NovaBird Helper\", charset=\"UTF-8\"" });
        }
        var parts = req.Path.Split('/', StringSplitOptions.RemoveEmptyEntries).Skip(1).ToArray(); // ohne "dav"
        if (parts.Length >= 1 && !string.Equals(parts[0], user, StringComparison.OrdinalIgnoreCase)) return Dav(403, "anderer Benutzer");
        Calendars.Cal cal = null;
        if (parts.Length >= 2)
        {
            cal = Calendars.Get(parts[1]);
            if (Calendars.RightOf(cal, user) == null) return Dav(404, "nicht gefunden");
        }
        if (parts.Length >= 3 && (parts.Length > 3 || !Calendars.ValidName(parts[2]))) return Dav(404, "nicht gefunden");
        string item = parts.Length == 3 ? parts[2] : null;
        bool canWrite = Calendars.RightOf(cal, user) == Calendars.Write;
        try
        {
            switch (req.Method)
            {
                case "OPTIONS":
                    return Dav(200, "", DavHeaders());
                case "PROPFIND":
                    return Propfind(req, user, parts.Length, cal, item);
                case "PROPPATCH":
                    return Proppatch(req);
                case "REPORT":
                    if (cal == null || item != null) return Dav(403, "nur für Kalender");
                    return Report(req, user, cal);
                case "GET" or "HEAD":
                {
                    if (cal == null) return Dav(200, "NovaBird Helper CalDAV");
                    if (item == null) return new Response(200, "text/calendar; charset=utf-8", Encoding.UTF8.GetBytes(Calendars.Export(cal.Id)), Headers: new() { ["Content-Disposition"] = $"attachment; filename=\"{FileName(cal.Name)}.ics\"" });
                    var data = Calendars.Data(cal.Id, item);
                    if (data == null) return Dav(404, "nicht gefunden");
                    return new Response(200, "text/calendar; charset=utf-8", data, Headers: new() { ["ETag"] = Calendars.Find(cal.Id, item)?.Etag ?? "" });
                }
                case "PUT":
                {
                    if (item == null) return Dav(405, "nur Einträge");
                    if (!canWrite) return Dav(403, "nur lesen");
                    if (Calendars.Problem(req.Body) is string problem) return DavError(problem == "zu groß" ? 413 : 415, C + "valid-calendar-data", problem);
                    var (created, etag) = Calendars.Put(cal.Id, item, req.Body, req.Headers.GetValueOrDefault("If-Match"), req.Headers.GetValueOrDefault("If-None-Match"));
                    return Dav(created ? 201 : 204, null, new() { ["ETag"] = etag });
                }
                case "DELETE":
                    if (item == null) return Dav(403, "Kalender in der Web-Oberfläche löschen");
                    if (!canWrite) return Dav(403, "nur lesen");
                    Calendars.Remove(cal.Id, item, req.Headers.GetValueOrDefault("If-Match"));
                    return Dav(204);
                case "MKCALENDAR" or "MKCOL":
                    return Dav(403, "Kalender in der Web-Oberfläche anlegen");
                default:
                    return Dav(405, "", DavHeaders());
            }
        }
        catch (Calendars.PreconditionFailed) { return Dav(412, "geändert"); }
        catch (Calendars.Full) { return Dav(507, "Kalender voll"); }
        catch (FileNotFoundException) { return Dav(404, "nicht gefunden"); }
        catch (XmlException) { return Dav(400, "XML"); }
    }

    static Dictionary<string, string> DavHeaders() => new()
    {
        ["DAV"] = "1, 3, calendar-access",
        ["Allow"] = "OPTIONS, GET, HEAD, PUT, DELETE, PROPFIND, PROPPATCH, REPORT",
    };

    static string FileName(string name) => string.Concat(name.Select(ch => char.IsLetterOrDigit(ch) || ch is '-' or '_' or ' ' ? ch : '_'));

    /// <summary>Benutzer aus der Basic-Anmeldung (oder null). Jede Rolle darf Kalender nutzen – Rechte stehen am Kalender.</summary>
    string DavUser(Request req)
    {
        var auth = req.Headers.GetValueOrDefault("Authorization");
        if (auth == null || !auth.StartsWith("Basic ", StringComparison.OrdinalIgnoreCase)) return null;
        string pair;
        try { pair = Encoding.UTF8.GetString(Convert.FromBase64String(auth[6..].Trim())); }
        catch (FormatException) { return null; }
        int colon = pair.IndexOf(':');
        if (colon <= 0) return null;
        var key = Convert.ToHexString(HMACSHA256.HashData(davPepper, Encoding.UTF8.GetBytes(pair)));
        if (davAuth.TryGetValue(key, out var hit) && hit.Until > DateTime.UtcNow) return hit.User;
        if (LoginBlocked(req.Ip)) return null;
        var ok = Users.Check(pair[..colon], pair[(colon + 1)..]);
        if (ok == null)
        {
            LoginFailed(req.Ip);
            Log.Write($"Kalender: Anmeldung fehlgeschlagen ({req.Ip})");
            return null;
        }
        foreach (var kv in davAuth) if (kv.Value.Until < DateTime.UtcNow) davAuth.TryRemove(kv.Key, out _);
        davAuth[key] = (ok.Value.Name, DateTime.UtcNow + DavAuthLife);
        return ok.Value.Name;
    }

    // ---- XML ----------------------------------------------------------------------------------------------------------------
    static XDocument ParseXml(byte[] body)
    {
        if (body.Length == 0) return null;
        var settings = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null, MaxCharactersInDocument = 4 << 20 };
        using var reader = XmlReader.Create(new MemoryStream(body), settings);
        return XDocument.Load(reader);
    }

    static Response MultiStatus(IEnumerable<XElement> responses, XElement extra = null)
    {
        var root = new XElement(D + "multistatus",
            new XAttribute(XNamespace.Xmlns + "d", D), new XAttribute(XNamespace.Xmlns + "c", C),
            new XAttribute(XNamespace.Xmlns + "cs", CS), new XAttribute(XNamespace.Xmlns + "a", A), responses, extra);
        return new Response(207, "application/xml; charset=utf-8", Encoding.UTF8.GetBytes("<?xml version=\"1.0\" encoding=\"utf-8\"?>\n" + root.ToString(SaveOptions.DisableFormatting)));
    }

    static Response DavError(int status, XName condition, string text = null)
    {
        var root = new XElement(D + "error", new XAttribute(XNamespace.Xmlns + "d", D), new XAttribute(XNamespace.Xmlns + "c", C), new XElement(condition));
        if (text != null) root.Add(new XElement(D + "responsedescription", text));
        return new Response(status, "application/xml; charset=utf-8", Encoding.UTF8.GetBytes(root.ToString(SaveOptions.DisableFormatting)));
    }

    static string Href(params string[] segments) => "/dav/" + string.Concat(segments.Select(s => Uri.EscapeDataString(s) + "/"));
    static string ItemHref(string user, string cal, string item) => Href(user, cal) + Uri.EscapeDataString(item);

    /// <summary>Eine &lt;response&gt;: gefundene Eigenschaften mit 200, unbekannte mit 404.</summary>
    static XElement PropResponse(string href, IEnumerable<XName> wanted, Func<XName, object> value)
    {
        var ok = new List<XElement>();
        var missing = new List<XElement>();
        foreach (var name in wanted)
        {
            var v = value(name);
            if (v == null) missing.Add(new XElement(name));
            else ok.Add(new XElement(name, v));
        }
        var r = new XElement(D + "response", new XElement(D + "href", href));
        if (ok.Count > 0) r.Add(new XElement(D + "propstat", new XElement(D + "prop", ok), new XElement(D + "status", "HTTP/1.1 200 OK")));
        if (missing.Count > 0) r.Add(new XElement(D + "propstat", new XElement(D + "prop", missing), new XElement(D + "status", "HTTP/1.1 404 Not Found")));
        return r;
    }

    static readonly XName[] PrincipalProps = { D + "resourcetype", D + "displayname", D + "current-user-principal", D + "principal-URL", C + "calendar-home-set", D + "owner", D + "current-user-privilege-set" };
    static readonly XName[] CalendarProps = { D + "resourcetype", D + "displayname", D + "current-user-principal", D + "owner", D + "current-user-privilege-set", D + "supported-report-set", D + "sync-token", CS + "getctag", C + "supported-calendar-component-set", C + "calendar-description", A + "calendar-color" };
    static readonly XName[] ItemProps = { D + "resourcetype", D + "getetag", D + "getcontenttype", D + "getcontentlength", D + "getlastmodified" };

    /// <summary>Gewünschte Eigenschaften aus &lt;prop&gt;; ohne Angabe (allprop, leer) die üblichen.</summary>
    static List<XName> Wanted(XElement root, XName[] defaults)
    {
        var prop = root?.Element(D + "prop");
        return prop == null ? defaults.ToList() : prop.Elements().Select(e => e.Name).Distinct().ToList();
    }

    object PrincipalValue(XName n, string user, bool principal)
    {
        if (n == D + "resourcetype") return principal ? new object[] { new XElement(D + "collection"), new XElement(D + "principal") } : new XElement(D + "collection");
        if (n == D + "displayname") return principal ? user : "NovaBird Helper";
        if (n == D + "current-user-principal" || n == D + "principal-URL" || n == D + "owner") return new XElement(D + "href", Href(user));
        if (n == C + "calendar-home-set") return new XElement(D + "href", Href(user));
        if (n == D + "principal-collection-set") return new XElement(D + "href", "/dav/");
        if (n == D + "current-user-privilege-set") return Privileges(false);
        if (n == D + "supported-report-set") return Reports();
        return null;
    }

    static XElement[] Privileges(bool write)
    {
        var list = new List<XName> { D + "read", C + "read-free-busy", D + "read-current-user-privilege-set" };
        if (write) list.AddRange(new[] { D + "write", D + "write-content", D + "bind", D + "unbind" });
        return list.Select(p => new XElement(D + "privilege", new XElement(p))).ToArray();
    }

    static XElement[] Reports() => new[] { C + "calendar-multiget", C + "calendar-query", D + "sync-collection" }
        .Select(r => new XElement(D + "supported-report", new XElement(D + "report", new XElement(r)))).ToArray();

    static string SyncToken(Calendars.Cal c) => $"http://novabird.helper/sync/{c.Id}/{c.Seq}";

    object CalendarValue(XName n, string user, Calendars.Cal c)
    {
        if (n == D + "resourcetype") return new object[] { new XElement(D + "collection"), new XElement(C + "calendar") };
        if (n == D + "displayname") return c.Name;
        if (n == D + "current-user-principal" || n == D + "owner") return new XElement(D + "href", Href(user));
        if (n == D + "current-user-privilege-set") return Privileges(Calendars.RightOf(c, user) == Calendars.Write);
        if (n == D + "supported-report-set") return Reports();
        if (n == D + "sync-token") return SyncToken(c);
        if (n == CS + "getctag") return c.Seq.ToString();
        if (n == C + "supported-calendar-component-set") return new[] { "VEVENT", "VTODO" }.Select(x => new XElement(C + "comp", new XAttribute("name", x))).ToArray();
        if (n == C + "calendar-description") return c.Description ?? "";
        if (n == A + "calendar-color") return c.Color.ToUpperInvariant() + "FF";
        if (n == C + "supported-calendar-data") return new XElement(C + "calendar-data", new XAttribute("content-type", "text/calendar"), new XAttribute("version", "2.0"));
        if (n == C + "max-resource-size") return Calendars.MaxItemBytes.ToString();
        if (n == D + "getcontenttype") return "httpd/unix-directory";
        return null;
    }

    static object ItemValue(XName n, Calendars.Cal c, Calendars.Item it)
    {
        if (n == D + "resourcetype") return "";
        if (n == D + "getetag") return it.Etag;
        if (n == D + "getcontenttype") return "text/calendar; charset=utf-8" + (it.Component != "" ? "; component=" + it.Component.ToLowerInvariant() : "");
        if (n == D + "getcontentlength") return it.Length.ToString();
        if (n == D + "getlastmodified") return it.Modified.ToString("R");
        if (n == C + "calendar-data")
        {
            var data = Calendars.Data(c.Id, it.Name);
            return data == null ? null : Encoding.UTF8.GetString(data);
        }
        return null;
    }

    Response Propfind(Request req, string user, int level, Calendars.Cal cal, string item)
    {
        var body = ParseXml(req.Body)?.Root;
        var depth = req.Headers.GetValueOrDefault("Depth") ?? "infinity";
        bool children = depth != "0"; // „infinity“ behandeln wie 1
        var list = new List<XElement>();
        switch (level)
        {
            case 0: // /dav/
                list.Add(PropResponse("/dav/", Wanted(body, PrincipalProps), n => PrincipalValue(n, user, false)));
                if (children) list.Add(PropResponse(Href(user), Wanted(body, PrincipalProps), n => PrincipalValue(n, user, true)));
                break;
            case 1: // /dav/<Benutzer>/
                list.Add(PropResponse(Href(user), Wanted(body, PrincipalProps), n => PrincipalValue(n, user, true)));
                if (children)
                    foreach (var c in Calendars.ForUser(user))
                        list.Add(PropResponse(Href(user, c.Id), Wanted(body, CalendarProps), n => CalendarValue(n, user, c)));
                break;
            case 2: // Kalender
                list.Add(PropResponse(Href(user, cal.Id), Wanted(body, CalendarProps), n => CalendarValue(n, user, cal)));
                if (children)
                    foreach (var it in Calendars.Items(cal.Id))
                        list.Add(PropResponse(ItemHref(user, cal.Id, it.Name), Wanted(body, ItemProps), n => ItemValue(n, cal, it)));
                break;
            default: // Eintrag
            {
                var it = Calendars.Find(cal.Id, item);
                if (it == null) return Dav(404, "nicht gefunden");
                list.Add(PropResponse(ItemHref(user, cal.Id, it.Name), Wanted(body, ItemProps), n => ItemValue(n, cal, it)));
                break;
            }
        }
        return MultiStatus(list);
    }

    // Eigenschaften setzen (Name, Farbe) geht nur in der Web-Oberfläche
    static Response Proppatch(Request req)
    {
        var body = ParseXml(req.Body)?.Root;
        var names = body?.Descendants(D + "prop").SelectMany(p => p.Elements()).Select(e => e.Name).Distinct().ToList() ?? new();
        var r = new XElement(D + "response", new XElement(D + "href", req.Path),
            new XElement(D + "propstat", new XElement(D + "prop", names.Select(n => new XElement(n))), new XElement(D + "status", "HTTP/1.1 403 Forbidden")));
        return MultiStatus(new[] { r });
    }

    Response Report(Request req, string user, Calendars.Cal cal)
    {
        var root = ParseXml(req.Body)?.Root;
        if (root == null) return Dav(400, "REPORT ohne Inhalt");
        var wanted = Wanted(root, new[] { D + "getetag" });
        if (root.Name == C + "calendar-multiget")
        {
            var list = new List<XElement>();
            foreach (var href in root.Elements(D + "href").Select(h => h.Value.Trim()).Distinct())
            {
                var name = Uri.UnescapeDataString(href.TrimEnd('/').Split('/').Last());
                var it = Calendars.Find(cal.Id, name);
                list.Add(it == null
                    ? new XElement(D + "response", new XElement(D + "href", href), new XElement(D + "status", "HTTP/1.1 404 Not Found"))
                    : PropResponse(href, wanted, n => ItemValue(n, cal, it)));
            }
            return MultiStatus(list);
        }
        if (root.Name == C + "calendar-query")
        {
            // Nur nach Art filtern (VEVENT/VTODO); Zeitbereiche liefern alles – Thunderbird & Co. filtern selbst
            var comp = root.Element(C + "filter")?.Element(C + "comp-filter")?.Element(C + "comp-filter")?.Attribute("name")?.Value?.ToUpperInvariant();
            var items = Calendars.Items(cal.Id).Where(it => comp == null || it.Component == comp);
            return MultiStatus(items.Select(it => PropResponse(ItemHref(user, cal.Id, it.Name), wanted, n => ItemValue(n, cal, it))));
        }
        if (root.Name == D + "sync-collection")
        {
            var token = root.Element(D + "sync-token")?.Value?.Trim() ?? "";
            List<XElement> list;
            if (token == "")
            {
                list = Calendars.Items(cal.Id).Select(it => PropResponse(ItemHref(user, cal.Id, it.Name), wanted, n => ItemValue(n, cal, it))).ToList();
            }
            else
            {
                var prefix = $"http://novabird.helper/sync/{cal.Id}/";
                var changes = token.StartsWith(prefix) && long.TryParse(token[prefix.Length..], out var seq) ? Calendars.ChangesSince(cal, seq) : null;
                if (changes == null) return DavError(403, D + "valid-sync-token");
                list = new();
                foreach (var (name, deleted) in changes)
                {
                    var it = deleted ? null : Calendars.Find(cal.Id, name);
                    list.Add(it == null
                        ? new XElement(D + "response", new XElement(D + "href", ItemHref(user, cal.Id, name)), new XElement(D + "status", "HTTP/1.1 404 Not Found"))
                        : PropResponse(ItemHref(user, cal.Id, name), wanted, n => ItemValue(n, cal, it)));
                }
            }
            return MultiStatus(list, new XElement(D + "sync-token", SyncToken(cal))); // Stand vom Beginn der Anfrage: spätere Änderungen kommen beim nächsten Mal
        }
        return DavError(403, D + "supported-report");
    }
}
