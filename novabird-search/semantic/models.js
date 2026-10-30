// Modelle für die semantische Suche: feste Hugging-Face-Pfade mit Revision und Prüfsumme je Datei.
// Geladen wird nur, was hier steht; jede Datei wird vor dem Speichern geprüft (sha256, bei kleinen Textdateien ohne
// LFS die Git-Prüfsumme gitSha1, wie sie Hugging Face für die Revision angibt).
// Der NovaBird Helper (nbhelper.exe) nutzt dieselben Einträge (gleiche Datei, gleiche Vektoren).
export const MODELS = {
  "jina-de": {
    id: "jina-de",
    name: "Jina Embeddings v2 Base DE",
    repo: "jinaai/jina-embeddings-v2-base-de",
    revision: "3f9eede875721714945b6a99a3198299243cf2be",
    license: "Apache-2.0",
    langs: ["de", "en"],
    dtype: "fp16", // q8 ist numerisch instabil (andere Vektoren als GPU/Helper), daher fp16
    dims: 768,
    pooling: "mean",
    maxTokens: 512,
    ramMB: 2100, // Arbeitsspeicher im Add-on mit geladenem Modell (gemessen)
    recommended: true,
    files: [
      { path: "config.json", size: 1177, sha256: "8d4c498741937d1467af5be739dc0fbcc4d033eb1fb93ece4f1c9c6bbdd37ec5" },
      { path: "tokenizer.json", size: 2633554, sha256: "376c53a06d6911569afc19f584002a11dbcd6b871afb6d96b8600eb3c4e7e7a7" },
      { path: "tokenizer_config.json", size: 1211, gitSha1: "d4469aadf1a566e8b3f05187afefdea86cf66b26" },
      { path: "onnx/model_fp16.onnx", size: 320852338, sha256: "e039ce538df36cb7ecee6bb88aacf0699227277be769a8e9adb5da719d23c571" },
    ],
  },
};

export const DEFAULT_MODEL = "jina-de";
export const HF_HOST = "https://huggingface.co/";

// Adresse wie transformers.js sie bildet (env.remoteHost + remotePathTemplate); unter genau dieser Adresse liegt die
// geprüfte Datei im Cache "transformers-cache", sodass transformers.js sie ohne Netz findet.
export function fileUrl(model, path) {
  return `${HF_HOST}${model.repo}/resolve/${encodeURIComponent(model.revision)}/${path}`;
}

export function modelBytes(model) {
  return model.files.reduce((s, f) => s + f.size, 0);
}
