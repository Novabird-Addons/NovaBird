// Modell für den Netz-Modus (dort schickt kein Add-on die Angaben mit): derselbe Eintrag wie in
// novabird-search/semantic/models.js (feste Revision, Prüfsumme je Datei). Ein Test in NovaBird-Search vergleicht beide.
using System.Text.Json.Nodes;

namespace NovaBird.Helper;

static class BuiltinModels
{
    const string JinaDe = """
    {
      "id": "jina-de",
      "repo": "jinaai/jina-embeddings-v2-base-de",
      "revision": "3f9eede875721714945b6a99a3198299243cf2be",
      "dims": 768,
      "pooling": "mean",
      "maxTokens": 512,
      "files": [
        { "path": "config.json", "size": 1177, "sha256": "8d4c498741937d1467af5be739dc0fbcc4d033eb1fb93ece4f1c9c6bbdd37ec5" },
        { "path": "tokenizer.json", "size": 2633554, "sha256": "376c53a06d6911569afc19f584002a11dbcd6b871afb6d96b8600eb3c4e7e7a7" },
        { "path": "tokenizer_config.json", "size": 1211, "gitSha1": "d4469aadf1a566e8b3f05187afefdea86cf66b26" },
        { "path": "onnx/model_fp16.onnx", "size": 320852338, "sha256": "e039ce538df36cb7ecee6bb88aacf0699227277be769a8e9adb5da719d23c571" }
      ]
    }
    """;

    public static ModelSpec Default => ModelSpec.From(JsonNode.Parse(JinaDe));
}
