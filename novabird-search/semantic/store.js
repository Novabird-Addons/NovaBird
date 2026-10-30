// Vektoren der semantischen Suche (IndexedDB des Add-ons). Schlüssel: Modell + Message-ID (Kopfzeile, auf allen PCs
// gleich), damit sich Vektoren zwischen PCs teilen lassen (Export/Import, später Ordner-Sync des Helpers).
// Gespeichert als int8 mit eigenem Faktor je Vektor (normierte Vektoren, Kosinus bleibt auf etwa 0,999 genau):
// 70.000 Mails mit 768 Werten ≈ 54 MB.
const DB_NAME = "novabird-semantic";
const STORE = "vectors";

let dbPromise = null;
function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const os = req.result.createObjectStore(STORE, { keyPath: ["m", "id"] });
      os.createIndex("m", "m");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = req => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});
const txDone = tx => new Promise((resolve, reject) => {
  tx.oncomplete = () => resolve();
  tx.onerror = () => reject(tx.error);
  tx.onabort = () => reject(tx.error);
});

export function quantize(vec) {
  let max = 0;
  for (const x of vec) {
    max = Math.max(max, Math.abs(x));
  }
  const s = max / 127 || 1;
  const q = new Int8Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    q[i] = Math.round(vec[i] / s);
  }
  return { q, s };
}

/**
 * items: [{id, vec: Float32Array, date}] oder schon quantisiert [{id, q, s}].
 * a = Zeitpunkt der Berechnung auf diesem PC; übernommene Vektoren (Import, Sync) bekommen a = 0 und werden nicht weitergegeben.
 */
export async function putMany(model, items, { imported = false } = {}) {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  const os = tx.objectStore(STORE);
  const now = Date.now();
  for (const it of items) {
    const { q, s } = it.q ? it : quantize(it.vec);
    os.put({ m: model, id: it.id, q, s, d: it.date || 0, a: imported ? 0 : now });
  }
  await txDone(tx);
}

export async function allIds(model) {
  const db = await open();
  const keys = await done(db.transaction(STORE).objectStore(STORE).index("m").getAllKeys(IDBKeyRange.only(model)));
  return new Set(keys.map(k => k[1]));
}

export async function count(model) {
  const db = await open();
  return done(db.transaction(STORE).objectStore(STORE).index("m").count(IDBKeyRange.only(model)));
}

/** Alle Vektoren eines Modells am Stück (für die Suche): {ids, q: Int8Array(n*dims), s: Float32Array(n)} */
export async function loadAll(model, dims) {
  const db = await open();
  const rows = await done(db.transaction(STORE).objectStore(STORE).index("m").getAll(IDBKeyRange.only(model)));
  const ids = new Array(rows.length);
  const q = new Int8Array(rows.length * dims);
  const s = new Float32Array(rows.length);
  rows.forEach((r, i) => {
    ids[i] = r.id;
    q.set(r.q, i * dims);
    s[i] = r.s;
  });
  return { ids, q, s };
}

export async function clear(model) {
  const db = await open();
  const tx = db.transaction(STORE, "readwrite");
  const os = tx.objectStore(STORE);
  const keys = await done(os.index("m").getAllKeys(IDBKeyRange.only(model)));
  for (const k of keys) {
    os.delete(k);
  }
  await txDone(tx);
  return keys.length;
}

// ---- Export/Import: einfache Binärdatei ----------------------------------------------------------------------------
// Kopf (JSON, Länge als uint32 davor): {format:"novabird-vectors", version:1, model, revision, dims, count}
// danach je Vektor: uint16 Länge der Message-ID, Message-ID (UTF-8), float32 Faktor, dims × int8
const MAGIC = "NBVEC1";

/** Exportdatei aller Vektoren eines Modells; mit since nur die hier berechneten, die nach since entstanden sind (Sync). */
export async function exportBlob(model, info, since = null) {
  const db = await open();
  let rows = await done(db.transaction(STORE).objectStore(STORE).index("m").getAll(IDBKeyRange.only(model)));
  if (since !== null) {
    rows = rows.filter(r => (r.a || 0) > since);
  }
  const enc = new TextEncoder();
  const head = enc.encode(JSON.stringify({ format: "novabird-vectors", version: 1, model, revision: info.revision, dims: info.dims, count: rows.length }));
  const parts = [enc.encode(MAGIC), new Uint32Array([head.length]), head];
  for (const r of rows) {
    const idb = enc.encode(r.id);
    const rec = new ArrayBuffer(2 + idb.length + 4 + info.dims);
    const dv = new DataView(rec);
    dv.setUint16(0, idb.length, true);
    new Uint8Array(rec, 2, idb.length).set(idb);
    dv.setFloat32(2 + idb.length, r.s, true);
    new Int8Array(rec, 6 + idb.length, info.dims).set(r.q);
    parts.push(rec);
  }
  const blob = new Blob(parts, { type: "application/octet-stream" });
  blob.count = rows.length;
  return blob;
}

/** Liest eine Exportdatei; nur wenn Modell und Revision passen. Gibt die Zahl der übernommenen Vektoren zurück. */
export async function importBuffer(buf, model, info) {
  const dec = new TextDecoder();
  const bytes = new Uint8Array(buf);
  if (dec.decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new Error("keine NovaBird-Vektordatei");
  }
  const dv = new DataView(buf);
  const headLen = dv.getUint32(MAGIC.length, true);
  let pos = MAGIC.length + 4;
  const head = JSON.parse(dec.decode(bytes.subarray(pos, pos + headLen)));
  pos += headLen;
  if (head.model !== model || head.revision !== info.revision || head.dims !== info.dims) {
    throw new Error(`anderes Modell (${head.model} ${String(head.revision).slice(0, 8)})`);
  }
  let batch = [];
  let n = 0;
  while (pos < bytes.length) {
    const len = dv.getUint16(pos, true);
    const id = dec.decode(bytes.subarray(pos + 2, pos + 2 + len));
    const s = dv.getFloat32(pos + 2 + len, true);
    const q = new Int8Array(buf.slice(pos + 6 + len, pos + 6 + len + head.dims));
    pos += 6 + len + head.dims;
    batch.push({ id, q, s });
    if (batch.length >= 2000) {
      await putMany(model, batch, { imported: true });
      n += batch.length;
      batch = [];
    }
  }
  if (batch.length) {
    await putMany(model, batch, { imported: true });
    n += batch.length;
  }
  return n;
}
