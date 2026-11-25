// Web-API für geteilte Adressbücher (AddressBooks.cs). Anbieten und Freigeben geschieht in Thunderbird beim Besitzer; hier nur
// die Übersicht und Löschen.
//  GET  /api/addressbooks          Admins und „Nur lesen“: alle geteilten Adressbücher mit Besitzer, Freigabe und Anzahl
//  POST /api/addressbooks/remove   {id}   (Admin; bietet der Besitzer-PC es weiter an, legt er es beim nächsten Abgleich neu an)
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed partial class WebServer
{
    Response AddressBookApi(Request req)
    {
        var pcs = core.Server.Scheduler.Clients();
        string Label(string id) => pcs.FirstOrDefault(p => p.Id == id)?.Label is { Length: > 0 } l ? l : id;
        switch (req.Method, req.Path)
        {
            case ("GET", "/api/addressbooks"):
            {
                Need(req);
                return Response.Json(new JsonObject
                {
                    ["books"] = new JsonArray(AddressBooks.List().Select(b => (JsonNode)new JsonObject
                    {
                        ["id"] = b.Id, ["name"] = b.Name, ["owner"] = Label(b.Owner), ["group"] = Groups.Get(b.GroupId)?.Name ?? b.GroupId,
                        ["access"] = b.Access, ["write"] = b.Write, ["pcs"] = new JsonArray(b.Pcs.Select(p => (JsonNode)Label(p)).ToArray()),
                        ["count"] = b.Index.Count, ["updated"] = b.Updated,
                    }).ToArray()),
                });
            }
            case ("POST", "/api/addressbooks/remove"):
            {
                Need(req, admin: true);
                var name = AddressBooks.Remove((string)req.Json()["id"]);
                if (name == null) throw new ApiError(404, L.T("Adressbuch unbekannt", "Unknown address book"));
                Audit(req, $"geteiltes Adressbuch {name} gelöscht");
                return Response.Json(new JsonObject { ["ok"] = true });
            }
        }
        return null;
    }
}
