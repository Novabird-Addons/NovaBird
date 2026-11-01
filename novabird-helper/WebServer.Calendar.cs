// Web-API für Team-Kalender (Calendars.cs, CalDav.cs) und die Sicherung (Backup.cs).
//  GET  /api/calendars          Admins: alle Kalender mit Rechten und die Benutzer; sonst: die eigenen Kalender
//  POST /api/calendars/add      {name, color}                   (Admin)
//  POST /api/calendars/update   {id, name?, color?, rights?}    (Admin; rights: {Benutzer: "read"|"write"})
//  POST /api/calendars/remove   {id}                            (Admin)
//  POST /api/calendars/ics      {id} -> .ics-Datei              (wer den Kalender sieht)
//  POST /api/backup/export      {password, vectors} -> Datei    (Admin)
//  POST /api/backup/import      Datei als Rumpf, Passwort im Kopf X-Backup-Password (Base64) (Admin)
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed partial class WebServer
{
    const string BackupImportPath = "/api/backup/import";

    async Task<Response> CalendarApi(Request req)
    {
        switch (req.Method, req.Path)
        {
            case ("GET", "/api/calendars"):
            {
                Need(req, calendar: true);
                bool admin = req.Session.Role == Users.Admin;
                var user = req.Session.User;
                var list = admin ? Calendars.List() : Calendars.ForUser(user);
                var o = new JsonObject
                {
                    ["calendars"] = new JsonArray(list.Select(c => (JsonNode)new JsonObject
                    {
                        ["id"] = c.Id, ["name"] = c.Name, ["color"] = c.Color, ["items"] = Calendars.Count(c.Id), ["right"] = Calendars.RightOf(c, user),
                        ["rights"] = admin ? new JsonObject(c.Rights.Select(kv => KeyValuePair.Create(kv.Key, (JsonNode)kv.Value))) : null,
                    }).ToArray()),
                    ["urls"] = new JsonArray(DavUrls(req).Select(u => (JsonNode)u).ToArray()),
                    ["lan"] = !LocalOnly,
                    ["user"] = user,
                };
                if (admin) o["users"] = new JsonArray(Users.List().Select(u => (JsonNode)new JsonObject { ["name"] = u.Name, ["role"] = u.Role }).ToArray());
                return Response.Json(o);
            }
            case ("POST", "/api/calendars/add"):
            {
                Need(req, admin: true);
                var j = req.Json();
                var c = Calendars.Create((string)j["name"], (string)j["color"]);
                Audit(req, $"Kalender {c.Name} angelegt");
                return Response.Json(new JsonObject { ["id"] = c.Id });
            }
            case ("POST", "/api/calendars/update"):
            {
                Need(req, admin: true);
                var j = req.Json();
                Calendars.Update((string)j["id"], (string)j["name"], (string)j["color"], j["rights"] as JsonObject);
                Audit(req, $"Kalender {Calendars.Get((string)j["id"])?.Name} geändert");
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("POST", "/api/calendars/remove"):
            {
                Need(req, admin: true);
                var id = (string)req.Json()["id"];
                var name = Calendars.Get(id)?.Name;
                Calendars.Delete(id);
                Audit(req, $"Kalender {name} gelöscht");
                return Response.Json(new JsonObject { ["ok"] = true });
            }
            case ("POST", "/api/calendars/ics"):
            {
                Need(req, calendar: true);
                var c = Calendars.Get((string)req.Json()["id"]);
                if (c == null || (req.Session.Role != Users.Admin && Calendars.RightOf(c, req.Session.User) == null)) throw new ApiError(404, L.T("Kalender unbekannt", "Unknown calendar"));
                return FileResponse("text/calendar; charset=utf-8", Encoding.UTF8.GetBytes(Calendars.Export(c.Id)), FileName(c.Name) + ".ics");
            }
            case ("POST", "/api/backup/export"):
            {
                Need(req, admin: true);
                var j = req.Json();
                bool vectors = (bool?)j["vectors"] ?? false;
                var data = await Task.Run(() => Backup.Create((string)j["password"], vectors));
                Audit(req, $"Sicherung erstellt{(vectors ? " (mit Vektoren)" : "")}");
                return FileResponse("application/octet-stream", data, $"novabird-helper-{DateTime.Now:yyyy-MM-dd}.nbbackup");
            }
            case ("POST", BackupImportPath):
            {
                Need(req, admin: true);
                string password;
                try { password = Encoding.UTF8.GetString(Convert.FromBase64String(req.Headers.GetValueOrDefault("X-Backup-Password") ?? "")); }
                catch (FormatException) { throw new ApiError(400, L.T("Passwort", "Password")); }
                var result = await Task.Run(() => Backup.Restore(core.Server, req.Body, password));
                Audit(req, "Sicherung eingespielt");
                sessions.Clear(); // Benutzer stammen jetzt aus der Sicherung: neu anmelden
                ForgetDavLogins();
                return Response.Json(result);
            }
        }
        return null;
    }

    static Response FileResponse(string type, byte[] data, string name) =>
        new(200, type, data, Headers: new() { ["Content-Disposition"] = $"attachment; filename=\"{name}\"" });

    /// <summary>Adressen für „Neuer Kalender → Im Netzwerk“: auf diesem PC per HTTP, aus dem Netz per HTTPS.</summary>
    List<string> DavUrls(Request req)
    {
        var list = new List<string>();
        if (req.Local) list.Add($"http://localhost:{Port}/dav/");
        if (!LocalOnly) list.AddRange(NetServer.LocalAddresses().Select(a => $"https://{a}:{Port}/dav/"));
        else if (!req.Local) list.Add($"https://{req.Headers.GetValueOrDefault("Host")}/dav/");
        return list;
    }
}
