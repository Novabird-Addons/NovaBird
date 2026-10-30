/* Semantische Suche: Modellkatalog (feste Revision, Prüfsummen) und Quantisierung der Vektoren (int8 je Vektor skaliert). */
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

test("Modellkatalog: feste Revision, jede Datei mit Größe und Prüfsumme, Adresse wie transformers.js", async () => {
  const { MODELS, DEFAULT_MODEL, fileUrl } = await import("../semantic/models.js");
  const m = MODELS[DEFAULT_MODEL];
  assert.match(m.revision, /^[0-9a-f]{40}$/);
  assert.equal(m.dtype, "fp16"); // q8 liefert andere Vektoren als Helper/GPU
  for (const f of m.files) {
    assert.ok(f.size > 0, f.path);
    assert.ok(/^[0-9a-f]{64}$/.test(f.sha256 || "") || /^[0-9a-f]{40}$/.test(f.gitSha1 || ""), f.path);
  }
  assert.equal(fileUrl(m, "onnx/model_fp16.onnx"), `https://huggingface.co/${m.repo}/resolve/${m.revision}/onnx/model_fp16.onnx`);
});

test("Quantisierung: Kosinus zu einem normierten Vektor bleibt auf etwa 0,999 genau", async () => {
  const { quantize } = await import("../semantic/store.js");
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  const norm = v => { const n = Math.hypot(...v); return v.map(x => x / n); };
  const a = Float32Array.from(norm(Array.from({ length: 768 }, rnd)));
  const b = Float32Array.from(norm(Array.from(a, x => x + rnd() * 0.05)));
  const exact = a.reduce((s, x, i) => s + x * b[i], 0);
  const { q, s } = quantize(a);
  const approx = q.reduce((sum, x, i) => sum + x * b[i], 0) * s;
  assert.ok(Math.abs(exact - approx) < 0.002, `${exact} vs ${approx}`);
});

test("Probe: Referenz besteht; andere Dimension, Rauschen und vertauschte Vektoren fallen durch", async () => {
  const { PROBES, checkProbe, refVectors } = await import("../semantic/probe.js");
  const { MODELS, DEFAULT_MODEL } = await import("../semantic/models.js");
  const m = MODELS[DEFAULT_MODEL];
  const p = PROBES[m.id];
  const ref = refVectors(m.id);
  assert.equal(ref.length, p.texts.length);
  assert.ok(ref.every(v => v.length === m.dims));
  assert.ok(checkProbe(m.id, ref, m.dims).ok);
  // kleine Rechenunterschiede (wie GPU gegen CPU) bestehen
  let seed = 3;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648) - 0.5;
  assert.ok(checkProbe(m.id, ref.map(v => v.map(x => x + rnd() * 0.002)), m.dims).ok);
  // deutlich andere Vektoren (z. B. q8, anderes Modell im selben Raum) nicht
  assert.equal(checkProbe(m.id, ref.map(v => v.map(x => x + rnd() * 0.02)), m.dims).reason, "cos");
  assert.equal(checkProbe(m.id, [...ref].reverse(), m.dims).ok, false);
  assert.equal(checkProbe(m.id, ref.map(() => new Float32Array(1024)), m.dims).reason, "dims");
  assert.equal(checkProbe(m.id, ref.slice(1), m.dims).reason, "count");
  assert.equal(checkProbe(m.id, ref.map(v => v.map(() => NaN)), m.dims).reason, "invalid");
});

test("Eigener Server: Muster ohne Port, Ollama und OpenAI-Antworten normiert, Fehler", async () => {
  const server = await import("../semantic/server.js");
  assert.equal(server.originPattern("http://192.168.1.20:11434"), "http://192.168.1.20/*");
  assert.equal(server.isLocal("http://localhost:11434"), true);
  assert.equal(server.isLocal("http://nas.local:11434"), false);
  assert.equal(server.validUrl("ftp://x"), false);
  const calls = [];
  const reply = body => ({ ok: true, status: 200, json: async () => body });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body || "null"), auth: init.headers.Authorization });
    if (url.endsWith("/api/embed")) {
      return reply({ embeddings: [[3, 4], [0, 2]] });
    }
    if (url.endsWith("/v1/embeddings")) {
      return reply({ data: [{ index: 1, embedding: [0, 5] }, { index: 0, embedding: [6, 8] }] });
    }
    return { ok: false, status: 403, json: async () => ({}) };
  };
  const v = await server.embed({ type: "ollama", url: "http://h:1/", model: "m" }, ["a", "b"], 512);
  assert.deepEqual([...v[0]].map(x => +x.toFixed(3)), [0.6, 0.8]);
  assert.equal(calls[0].url, "http://h:1/api/embed");
  assert.equal(calls[0].body.options.num_ctx, 512);
  assert.equal(calls[0].body.truncate, true);
  const o = await server.embed({ type: "openai", url: "http://h:1/v1", model: "m", key: "k" }, ["a", "b"], 512);
  assert.deepEqual([...o[0]].map(x => +x.toFixed(3)), [0.6, 0.8]); // nach index sortiert
  assert.equal(calls[1].url, "http://h:1/v1/embeddings");
  assert.equal(calls[1].auth, "Bearer k");
  await assert.rejects(server.embed({ type: "ollama", url: "http://h:1", model: "m" }, ["a"], 512), /answer/); // 2 statt 1
  await assert.rejects(server.listModels({ type: "ollama", url: "http://h:1" }), /http 403/);
});

test("Helper im Netz-Modus: eingebautes Modell gleich models.js (Revision, Größen, Prüfsummen)", async () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const { MODELS, DEFAULT_MODEL } = await import("../semantic/models.js");
  const m = MODELS[DEFAULT_MODEL];
  const cs = fs.readFileSync(path.join(__dirname, "../../novabird-helper/BuiltinModels.cs"), "utf8");
  const json = JSON.parse(cs.match(/"""\s*([\s\S]*?)\s*"""/)[1]);
  assert.equal(json.id, m.id);
  assert.equal(json.repo, m.repo);
  assert.equal(json.revision, m.revision);
  assert.equal(json.dims, m.dims);
  assert.equal(json.maxTokens, m.maxTokens);
  assert.deepEqual(json.files, m.files);
});

test("Kopplungscode: Groß/klein, Leerzeichen und Bindestriche egal, verwechselbare Zeichen fallen weg", async () => {
  const { normalizeCode } = await import("../semantic/server.js");
  assert.equal(normalizeCode("abcde-fghjk lmnpq_rstuv"), "ABCDEFGHJKLMNPQRSTUV");
  assert.equal(normalizeCode("O0I1 x"), "X");
});
