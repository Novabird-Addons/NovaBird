// Native Messaging mit NovaBird-Search: je Nachricht 4 Byte Länge (little endian) + JSON (UTF-8), über stdin/stdout.
// Jede Anfrage hat eine id; die Antwort trägt dieselbe id und ok:true/false. Fortschritt ohne id: {type:"progress", …}.
// Antworten an Thunderbird dürfen höchstens 1 MB groß sein (Vektoren und Sync-Pakete daher stückweise).
//   hello   {api, model}            -> Info (Version, Gerät, Modell bereit, Akku, Sync)
//   prepare {model}                 -> Modell laden und prüfen, Geräte messen, schnellstes merken -> Info
//   embed   {model, ids:[[…]]}      -> {vectors: base64 float32 (n × dims), onBattery}
//   embedTexts {model, texts:[…]}   -> wie embed, der Helper zerlegt die Texte selbst (Tokenizer.cs; ab Helper 0.2, Info textApi)
//   bench                           -> Geräte neu messen -> Info
//   syncSetup {folder, code?}       -> {code} (neuer Sync-Ordner) bzw. {} (beigetreten)
//   syncLeave | syncStatus
//   syncPush {model, revision, part, parts, data}   -> eigenes Paket (Vektordatei des Add-ons), stückweise
//   syncPending {model, revision}   -> {packages:[{name,size}]}
//   syncRead {model, revision, name, offset, length} -> {data, total}
//   syncAck {name}
using System.Buffers.Binary;
using System.Text;
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

sealed class Host
{
    const int Api = 1;
    const int MaxRead = 700_000; // Rohdaten je Antwort (base64 ≈ 930 KB)
    readonly Stream input = Console.OpenStandardInput();
    readonly Stream output = Console.OpenStandardOutput();
    readonly object writeGate = new();
    ModelSpec model;
    MemoryStream pushBuffer;

    public int Run()
    {
        Log.Write($"Start {Program.Version} (Host)");
        while (true)
        {
            var msg = ReadMessage();
            if (msg == null) break; // Thunderbird hat die Verbindung beendet
            var id = msg["id"]?.DeepClone();
            JsonObject reply;
            try
            {
                reply = Handle(msg);
                reply["ok"] = true;
            }
            catch (Exception e)
            {
                Log.Write($"{(string)msg["type"]}: {e}");
                reply = new JsonObject { ["ok"] = false, ["error"] = e.Message };
            }
            reply["id"] = id;
            Write(reply);
        }
        Engine.Unload();
        Log.Write("Ende (Host)");
        return 0;
    }

    JsonNode ReadMessage()
    {
        var head = new byte[4];
        if (!ReadExactly(head)) return null;
        var len = BinaryPrimitives.ReadInt32LittleEndian(head);
        if (len <= 0 || len > 512 << 20) return null;
        var body = new byte[len];
        if (!ReadExactly(body)) return null;
        return Json.Parse(body);
    }

    bool ReadExactly(byte[] buf)
    {
        int got = 0;
        while (got < buf.Length)
        {
            int n = input.Read(buf, got, buf.Length - got);
            if (n <= 0) return false;
            got += n;
        }
        return true;
    }

    void Write(JsonNode msg)
    {
        var body = Encoding.UTF8.GetBytes(msg.ToJsonString());
        var head = new byte[4];
        BinaryPrimitives.WriteInt32LittleEndian(head, body.Length);
        lock (writeGate)
        {
            output.Write(head);
            output.Write(body);
            output.Flush();
        }
    }

    JsonObject Info()
    {
        var s = Settings.Load();
        var info = new JsonObject
        {
            ["version"] = Program.Version,
            ["api"] = Api,
            ["device"] = (string)s["device"] ?? "cpu",
            ["deviceName"] = (string)s["deviceName"] ?? Engine.DeviceName("cpu"),
            ["mailsPerSec"] = (double?)s["mailsPerSec"],
            ["modelReady"] = model != null && model.Complete && (string)s["benchRevision"] == model.Revision,
            ["onBattery"] = Settings.OnBattery(),
            ["fellBack"] = Engine.FellBack,
            ["textApi"] = true,
            ["sync"] = Sync.Status(),
        };
        if (s["devices"] is JsonArray d) info["devices"] = d.DeepClone();
        return info;
    }

    JsonObject Handle(JsonNode msg)
    {
        switch ((string)msg["type"])
        {
            case "hello":
                if (msg["model"] != null) model = ModelSpec.From(msg["model"]);
                return Info();
            case "prepare":
                model = ModelSpec.From(msg["model"]);
                ModelStore.Ensure(model, (done, total) => Write(new JsonObject { ["type"] = "progress", ["what"] = "download", ["done"] = done, ["total"] = total }));
                ModelStore.Measure(model);
                return Info();
            case "bench":
                if (model == null || !model.Complete) throw new InvalidOperationException("Modell fehlt");
                ModelStore.Measure(model);
                return Info();
            case "embed":
            {
                if (model == null || (string)msg["model"] != model.Id || !model.Complete) throw new InvalidOperationException("Modell nicht bereit");
                var ids = msg["ids"].AsArray().Select(a => a.AsArray().Select(x => (long)x).ToArray()).ToList();
                var device = (string)Settings.Load()["device"] ?? "cpu";
                var vecs = Engine.Embed(model, ids, device);
                return new JsonObject { ["vectors"] = Engine.ToBase64(vecs, model.Dims), ["onBattery"] = Settings.OnBattery() };
            }
            case "embedTexts":
            {
                if (model == null || (string)msg["model"] != model.Id || !model.Complete) throw new InvalidOperationException("Modell nicht bereit");
                var texts = msg["texts"].AsArray().Select(t => (string)t ?? "").ToList();
                var vecs = Engine.EmbedTexts(model, texts, (string)Settings.Load()["device"] ?? "cpu");
                return new JsonObject { ["vectors"] = Engine.ToBase64(vecs, model.Dims), ["onBattery"] = Settings.OnBattery() };
            }
            case "syncStatus":
                return Sync.Status();
            case "syncSetup":
                return new JsonObject { ["code"] = Sync.Setup((string)msg["folder"], (string)msg["code"]), ["sync"] = Sync.Status() };
            case "syncLeave":
                Sync.Leave();
                return Sync.Status();
            case "syncPush":
            {
                int part = (int)msg["part"], parts = (int)msg["parts"];
                if (part == 0) pushBuffer = new MemoryStream();
                if (pushBuffer == null) throw new InvalidOperationException("Teil fehlt");
                pushBuffer.Write(Convert.FromBase64String((string)msg["data"]));
                if (part < parts - 1) return new JsonObject();
                var name = Sync.Push((string)msg["model"], (string)msg["revision"], pushBuffer.ToArray());
                pushBuffer = null;
                return new JsonObject { ["name"] = name };
            }
            case "syncPending":
                return new JsonObject
                {
                    ["packages"] = new JsonArray(Sync.Pending((string)msg["model"], (string)msg["revision"])
                        .Select(p => (JsonNode)new JsonObject { ["name"] = p.Name, ["size"] = p.Size }).ToArray()),
                };
            case "syncRead":
            {
                var (data, total) = Sync.Read((string)msg["model"], (string)msg["revision"], (string)msg["name"], (long)msg["offset"], Math.Min((int?)msg["length"] ?? MaxRead, MaxRead));
                return new JsonObject { ["data"] = Convert.ToBase64String(data), ["total"] = total };
            }
            case "syncAck":
                Sync.Ack((string)msg["name"]);
                return new JsonObject();
            default:
                throw new InvalidOperationException("unbekannter Befehl");
        }
    }
}
