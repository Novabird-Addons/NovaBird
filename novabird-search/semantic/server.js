// Eigener Server als Rechenweg der semantischen Suche: Ollama (nativ, /api/embed), eine OpenAI-kompatible Schnittstelle
// (/v1/embeddings: LM Studio, llama.cpp, vLLM …) oder der NovaBird Helper im Netz-Modus (auf einem anderen PC, Anfragen und
// Antworten mit dem Kopplungscode verschlüsselt, siehe novabird-helper/NetServer.cs). Nur an die Adresse, die der Nutzer
// selbst eingetragen hat; ob die Vektoren zum Modell passen, prüft main.js mit den Probetexten (probe.js).

export const SERVER_DEFAULTS = { type: "ollama", url: "http://localhost:11434", model: "jina/jina-embeddings-v2-base-de", user: "", key: "", code: "", label: "" };
export const NET_PORT = 47531;
const TIMEOUT_MS = 120_000;

export const base = c => String(c?.url || "").trim().replace(/\/+$/, "");

export function isLocal(url) {
  try {
    const h = new URL(url).hostname;
    return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
  } catch {
    return false;
  }
}

// Muster für Berechtigung und webRequest-Filter (ohne Port: Muster in Firefox/Thunderbird kennen keine Ports)
export function originPattern(url) {
  const u = new URL(url);
  return `${u.protocol}//${u.hostname}/*`;
}

export function validUrl(url) {
  try {
    const u = new URL(url);
    return (u.protocol === "http:" || u.protocol === "https:") && Boolean(u.hostname);
  } catch {
    return false;
  }
}

function headers(c) {
  const h = { "Content-Type": "application/json" };
  if (c.type === "nbhelper") {
    return h; // Zugang über den Kopplungscode (Verschlüsselung), nicht über Kopfzeilen
  }
  if (c.user) {
    h.Authorization = "Basic " + btoa(unescape(encodeURIComponent(`${c.user}:${c.key || ""}`)));
  } else if (c.key) {
    h.Authorization = "Bearer " + c.key;
  }
  return h;
}

const openaiPath = (c, tail) => (/\/v1$/.test(base(c)) ? base(c) + tail : base(c) + "/v1" + tail);

async function request(c, url, body) {
  if (!validUrl(base(c))) {
    throw new Error("url");
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: body ? "POST" : "GET", headers: headers(c), body: body ? JSON.stringify(body) : undefined, signal: ctl.signal });
    if (!r.ok) {
      const err = new Error(`http ${r.status}`);
      err.status = r.status;
      throw err;
    }
    return await r.json();
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error("timeout");
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function listModels(c) {
  if (c.type === "nbhelper") {
    return null; // der Helper hat genau ein Modell
  }
  if (c.type === "openai") {
    return ((await request(c, openaiPath(c, "/models"))).data || []).map(m => m.id).sort();
  }
  return ((await request(c, base(c) + "/api/tags")).models || []).map(m => m.name).sort();
}

function normalized(v) {
  const out = Float32Array.from(v);
  let n = 0;
  for (const x of out) {
    n += x * x;
  }
  n = Math.sqrt(n);
  if (n > 0) {
    for (let i = 0; i < out.length; i++) {
      out[i] /= n;
    }
  }
  return out;
}

/**
 * Vektoren für texts (normiert, Float32Array je Text). maxTokens: Ollama kürzt wie das Add-on auf diese Tokenzahl
 * (num_ctx); OpenAI-kompatible Server kürzen nach eigener Einstellung (die Probe deckt die üblichen Längen ab).
 */
export async function embed(c, texts, maxTokens, { model = null, prio = "index", stats = null, keys = null } = {}) {
  if (c.type === "nbhelper") {
    // stats: Indexstand dieses PCs für die Liste im Helper; keys: je Text {id: Message-ID, h: Prüfsumme} – der Helper merkt
    // sich die Vektoren dann für andere PCs (Vektoren teilen)
    const res = await netCall(c, "embed", { model, texts, prio, stats, ...(keys ? { keys } : {}) });
    return decodeFloat32(res.vectors, texts.length).map(normalized);
  }
  if (!c.model) {
    throw new Error("model");
  }
  let list;
  if (c.type === "openai") {
    const res = await request(c, openaiPath(c, "/embeddings"), { model: c.model, input: texts, encoding_format: "float" });
    list = (res.data || []).slice().sort((a, b) => a.index - b.index).map(d => d.embedding);
  } else {
    const res = await request(c, base(c) + "/api/embed", { model: c.model, input: texts, truncate: true, options: { num_ctx: maxTokens } });
    list = res.embeddings || [];
  }
  if (list.length !== texts.length || list.some(v => !Array.isArray(v))) {
    throw new Error("answer");
  }
  return list.map(normalized);
}

/**
 * Vektoren teilen (NovaBird Helper im Netz): schon gerechnete Vektoren zu items [{id: Message-ID, h: Prüfsumme des Textes}].
 * Liefert {found: Positionen in items, vectors: Float32Array je Treffer}.
 */
export async function lookup(c, model, items, stats = null) {
  const res = await netCall(c, "vlookup", { model, items, stats });
  const found = res.found || [];
  return { found, vectors: found.length ? decodeFloat32(res.vectors, found.length).map(normalized) : [] };
}

/** Prüfsumme eines Textes für das Teilen: die ersten 8 Byte von SHA-256 (UTF-8), hexadezimal. */
export async function textHash(text) {
  const d = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return Array.from(d.subarray(0, 8), b => b.toString(16).padStart(2, "0")).join("");
}

// ---- NovaBird Helper im Netz-Modus ------------------------------------------------------------------------------------------
// Schlüssel aus dem Kopplungscode wie im Helper (PBKDF2-SHA256, 300.000 Runden, fester Salt); einmal je Code berechnet.
const NET_PATH = "/nbhelper/v1";
const NET_ITERATIONS = 300_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const enc = text => new TextEncoder().encode(text);
const keys = new Map();

export const normalizeCode = code => [...String(code || "").toUpperCase()].filter(ch => CODE_ALPHABET.includes(ch)).join("");

function toB64(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

function fromB64(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

function decodeFloat32(b64, count) {
  const all = new Float32Array(fromB64(b64).buffer);
  const dims = count ? all.length / count : 0;
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new Error("answer");
  }
  return Array.from({ length: count }, (_, i) => all.subarray(i * dims, (i + 1) * dims));
}

function netKey(code) {
  const n = normalizeCode(code);
  if (!keys.has(n)) {
    keys.set(n, (async () => {
      const raw = await crypto.subtle.importKey("raw", enc(n), "PBKDF2", false, ["deriveKey"]);
      return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: enc("NovaBird-Net-1"), iterations: NET_ITERATIONS }, raw,
        { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    })());
  }
  return keys.get(n);
}

/** Verschlüsselte Anfrage an den Helper im Netz-Modus; Antwort entschlüsselt (wirft bei ok:false). */
export async function netCall(c, op, payload = {}) {
  if (normalizeCode(c.code).length !== 20) {
    throw new Error("code");
  }
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(c.clientId || "")) {
    throw new Error("client");
  }
  const key = await netKey(c.code);
  const rid = toB64(crypto.getRandomValues(new Uint8Array(16)));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plain = enc(JSON.stringify({ ts: Date.now(), rid, op, label: c.label || "", ...payload }));
  const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc(`nbh1-req|${c.clientId}`) }, key, plain));
  let res;
  try {
    res = await request(c, base(c) + NET_PATH, { c: c.clientId, n: toB64(iv), d: toB64(data) });
  } catch (e) {
    if (e.status === 403) {
      throw new Error("Kopplungscode passt nicht");
    }
    throw e;
  }
  let msg;
  try {
    const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(res.n), additionalData: enc(`nbh1-res|${rid}`) }, key, fromB64(res.d));
    msg = JSON.parse(new TextDecoder().decode(out));
  } catch {
    throw new Error("Antwort des Helpers lässt sich nicht prüfen");
  }
  if (!msg.ok) {
    throw new Error(msg.error || "Helper-Fehler");
  }
  return msg;
}
