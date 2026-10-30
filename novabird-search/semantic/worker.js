// Rechenteil der semantischen Suche im Add-on (Web Worker, Modul). Lädt Modelldateien geprüft in den Cache, lädt das
// Modell (transformers.js mit onnxruntime-web, WASM mit mehreren Threads) und wandelt Texte in Vektoren um.
// Für den NovaBird Helper liefert er nur die Token-IDs (der Helper rechnet das Modell, Tokenizer bleibt derselbe).
// Nachrichten: {id, type, ...} -> {id, ok, result} oder {id, ok:false, error}; Fortschritt: {type:"progress", ...}.
import { pipeline, AutoTokenizer, env } from "./lib/transformers.min.js";
import { MODELS, fileUrl } from "./models.js";

const CACHE = "transformers-cache"; // Name, unter dem transformers.js im Browser-Cache sucht
let extractor = null; // geladene Pipeline
let extractorModel = null;
let tokenizer = null;
let tokenizerModel = null;
let cancelDownload = false;

// Nur Dateien, die vorher geprüft im Cache liegen: nichts aus dem Netz; „lokale Modelle“ zeigen auf einen Pfad im
// Add-on, den es nicht gibt (transformers.js verlangt, dass eine der beiden Quellen erlaubt ist). Fehlt etwas im Cache,
// schlägt das Laden fehl, statt ungeprüft nachzuladen.
env.useBrowserCache = true;
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = new URL("./kein-lokales-modell/", import.meta.url).href;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

// Prüfsumme wie in models.js angegeben: sha256 oder (kleine Textdateien) Git-Prüfsumme "blob <Länge>\0<Inhalt>"
async function verify(file, bytes) {
  if (bytes.byteLength !== file.size) {
    return false;
  }
  if (file.sha256) {
    return hex(await crypto.subtle.digest("SHA-256", bytes)) === file.sha256;
  }
  const head = new TextEncoder().encode(`blob ${bytes.byteLength}\0`);
  const all = new Uint8Array(head.length + bytes.byteLength);
  all.set(head);
  all.set(bytes, head.length);
  return hex(await crypto.subtle.digest("SHA-1", all)) === file.gitSha1;
}

async function modelStatus(modelId) {
  const model = MODELS[modelId];
  const cache = await caches.open(CACHE);
  let have = 0;
  let bytes = 0;
  for (const f of model.files) {
    if (await cache.match(fileUrl(model, f.path))) {
      have++;
      bytes += f.size;
    }
  }
  return { model: modelId, files: model.files.length, have, bytes, complete: have === model.files.length, loaded: extractorModel === modelId };
}

// testBase: nur für Tests ein Server auf diesem Rechner (http://127.0.0.1:<port>/ oder localhost) statt huggingface.co;
// gespeichert wird unter der Hugging-Face-Adresse, geprüft wird genauso.
const TEST_BASE = /^http:\/\/(127\.0\.0\.1|localhost):\d+\/$/;

async function download(modelId, testBase) {
  const model = MODELS[modelId];
  const cache = await caches.open(CACHE);
  const total = model.files.reduce((s, f) => s + f.size, 0);
  let done = 0;
  cancelDownload = false;
  for (const f of model.files) {
    const url = fileUrl(model, f.path);
    if (await cache.match(url)) {
      done += f.size;
      continue;
    }
    const from = TEST_BASE.test(testBase || "") ? `${testBase}${model.repo}/resolve/${model.revision}/${f.path}` : url;
    const res = await fetch(from, { credentials: "omit", cache: "no-store" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} (${f.path})`);
    }
    const reader = res.body.getReader();
    const bytes = new Uint8Array(f.size);
    let got = 0;
    let lastPost = 0;
    for (;;) {
      const { done: end, value } = await reader.read();
      if (end) {
        break;
      }
      if (cancelDownload) {
        await reader.cancel();
        throw new Error("abgebrochen");
      }
      if (got + value.length > bytes.length) {
        throw new Error(`Datei größer als erwartet (${f.path})`);
      }
      bytes.set(value, got);
      got += value.length;
      if (Date.now() - lastPost > 250) {
        lastPost = Date.now();
        postMessage({ type: "progress", what: "download", done: done + got, total, file: f.path });
      }
    }
    const data = got === bytes.length ? bytes : bytes.subarray(0, got);
    if (!(await verify(f, data))) {
      throw new Error(`Prüfsumme stimmt nicht (${f.path})`);
    }
    await cache.put(url, new Response(data, { headers: { "content-type": "application/octet-stream", "content-length": String(got) } }));
    done += f.size;
    postMessage({ type: "progress", what: "download", done, total, file: f.path });
  }
  return modelStatus(modelId);
}

async function remove(modelId) {
  const model = MODELS[modelId];
  if (extractorModel === modelId) {
    await extractor?.dispose?.();
    extractor = null;
    extractorModel = null;
  }
  const cache = await caches.open(CACHE);
  for (const f of model.files) {
    await cache.delete(fileUrl(model, f.path));
  }
  return modelStatus(modelId);
}

// Revision fest in die Adressvorlage: transformers.js reicht die Revision nicht an jede Datei weiter (sonst „main“), der
// Cache-Schlüssel muss aber genau die geprüfte Adresse sein (fileUrl in models.js).
function pinRevision(model) {
  env.remotePathTemplate = `{model}/resolve/${encodeURIComponent(model.revision)}/`;
}

async function load(modelId, threads, wasmPaths) {
  if (extractor && extractorModel === modelId) {
    return { ms: 0 };
  }
  const model = MODELS[modelId];
  const t0 = performance.now();
  pinRevision(model);
  env.backends.onnx.wasm.wasmPaths = wasmPaths;
  env.backends.onnx.wasm.numThreads = Math.max(1, Number(threads) || 1);
  await extractor?.dispose?.();
  extractor = await pipeline("feature-extraction", model.repo, { dtype: model.dtype, device: "wasm", revision: model.revision });
  extractorModel = modelId;
  return { ms: Math.round(performance.now() - t0), threads: env.backends.onnx.wasm.numThreads };
}

async function embed(modelId, texts) {
  if (extractorModel !== modelId) {
    throw new Error("Modell nicht geladen");
  }
  const model = MODELS[modelId];
  const out = await extractor(texts, { pooling: model.pooling, normalize: true });
  return out.data instanceof Float32Array ? out.data : Float32Array.from(out.data);
}

async function tokenize(modelId, texts) {
  const model = MODELS[modelId];
  if (tokenizerModel !== modelId) {
    pinRevision(model);
    tokenizer = await AutoTokenizer.from_pretrained(model.repo, { revision: model.revision });
    tokenizerModel = modelId;
  }
  return texts.map(t => {
    const enc = tokenizer(t, { truncation: true, max_length: model.maxTokens });
    return Array.from(enc.input_ids.data, Number);
  });
}

self.onmessage = async ({ data }) => {
  const { id, type } = data;
  if (type === "cancel") {
    cancelDownload = true;
    return;
  }
  try {
    let result;
    let transfer = [];
    switch (type) {
      case "status":
        result = await modelStatus(data.model);
        break;
      case "download":
        result = await download(data.model, data.testBase);
        break;
      case "remove":
        result = await remove(data.model);
        break;
      case "load":
        result = await load(data.model, data.threads, data.wasmPaths);
        break;
      case "embed":
        result = await embed(data.model, data.texts);
        transfer = [result.buffer];
        break;
      case "tokenize":
        result = await tokenize(data.model, data.texts);
        break;
      default:
        throw new Error(`unbekannt: ${type}`);
    }
    postMessage({ id, ok: true, result }, transfer);
  } catch (e) {
    postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
