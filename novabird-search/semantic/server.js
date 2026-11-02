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
    const keep = c.keepAlive !== undefined && c.keepAlive !== "" ? { keep_alive: c.keepAlive } : {};
    const res = await request(c, base(c) + "/api/embed", { model: c.model, input: texts, truncate: true, options: { num_ctx: maxTokens }, ...keep });
    list = res.embeddings || [];
  }
  if (list.length !== texts.length || list.some(v => !Array.isArray(v))) {
    throw new Error("answer");
  }
  return list.map(normalized);
}

// ---- Ollama steuern (Mac: Einstellungsseite „Ollama auf diesem Mac“) --------------------------------------------------------
// Nur das geprüfte Modell (SERVER_DEFAULTS.model); ob seine Vektoren passen, prüft danach wie immer die Probe.
const sameModel = (a, b) => String(a).replace(/:latest$/, "") === String(b).replace(/:latest$/, "");

/** Version, ob das Modell vorhanden ist, und ob es gerade im Speicher liegt (size, size_vram = davon auf der Grafik, bis wann). */
export async function ollamaStatus(c) {
  const version = (await request(c, base(c) + "/api/version")).version || "?";
  const tags = (await request(c, base(c) + "/api/tags")).models || [];
  const ps = (await request(c, base(c) + "/api/ps").catch(() => ({}))).models || [];
  const have = tags.find(m => sameModel(m.name, c.model));
  const run = ps.find(m => sameModel(m.name, c.model));
  return {
    version,
    hasModel: Boolean(have),
    modelBytes: have?.size || 0,
    loaded: run ? { size: run.size || 0, vram: run.size_vram || 0, until: run.expires_at || null } : null,
  };
}

/** Modell aus der Ollama-Bibliothek laden; onProgress({status, total, completed}) je Zeile der Antwort (NDJSON). */
export async function ollamaPull(c, onProgress) {
  if (!validUrl(base(c))) {
    throw new Error("url");
  }
  const ctl = new AbortController();
  let idle = null;
  const alive = () => {
    clearTimeout(idle);
    idle = setTimeout(() => ctl.abort(), TIMEOUT_MS); // nur Stillstand bricht ab, nicht die Dauer
  };
  alive();
  try {
    const r = await fetch(base(c) + "/api/pull", { method: "POST", headers: headers(c), body: JSON.stringify({ model: c.model, stream: true }), signal: ctl.signal });
    if (!r.ok) {
      throw new Error(`http ${r.status}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let last = null;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      alive();
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) {
          continue;
        }
        last = JSON.parse(line);
        if (last.error) {
          throw new Error(last.error);
        }
        onProgress?.(last);
      }
    }
    if (last?.status !== "success") {
      throw new Error("abgebrochen");
    }
  } catch (e) {
    throw e.name === "AbortError" ? new Error("timeout") : e;
  } finally {
    clearTimeout(idle);
  }
}

/** Modell sofort aus dem Speicher nehmen (leere Anfrage mit keep_alive 0). */
export async function ollamaUnload(c) {
  await request(c, base(c) + "/api/embed", { model: c.model, input: [], keep_alive: 0 });
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

/** Prüfsumme eines Textes für das Teilen: die ersten 8 Byte von SHA-256 (UTF-8), hexadezimal (shared/nbnet.js). */
export const textHash = text => net().textHash(text);

// ---- NovaBird Helper im Netz-Modus ------------------------------------------------------------------------------------------
// Kopplungscode, Schlüssel und Verschlüsselung gemeinsam mit NovaBird-Extension in shared/nbnet.js (klassisches Skript,
// background.html lädt es vor diesem Modul); hier nur Versand (request: Zeitgrenze) und Fehlertexte.
const net = () => globalThis.nbNet;

export const normalizeCode = code => net().normalizeCode(code);

function decodeFloat32(b64, count) {
  const all = new Float32Array(net().fromB64(b64).buffer);
  const dims = count ? all.length / count : 0;
  if (!Number.isInteger(dims) || dims <= 0) {
    throw new Error("answer");
  }
  return Array.from({ length: count }, (_, i) => all.subarray(i * dims, (i + 1) * dims));
}

/** Verschlüsselte Anfrage an den Helper im Netz-Modus; Antwort entschlüsselt (wirft bei ok:false). */
export async function netCall(c, op, payload = {}) {
  try {
    return await net().call({ url: base(c), code: c.code, client: c.clientId, op, payload, label: c.label || "", post: (url, body) => request(c, url, body) });
  } catch (e) {
    if (e.status === 403) {
      throw new Error("Kopplungscode passt nicht");
    }
    if (e.message === "answer") {
      throw new Error("Antwort des Helpers lässt sich nicht prüfen");
    }
    if (e.message === "helper") {
      throw new Error("Helper-Fehler");
    }
    throw e;
  }
}
