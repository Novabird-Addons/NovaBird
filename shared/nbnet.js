"use strict";

/* NovaBird Helper im Netz-Modus: gemeinsamer Teil für NovaBird-Extension (ai/ai.js: KI, Vorlesen, geteilte Ergebnisse) und
 * NovaBird-Search (semantic/server.js: Vektoren). Gegenstück im Helper: novabird-helper/NetServer.cs.
 * Schlüssel = PBKDF2-SHA256(Kopplungscode, "NovaBird-Net-1", 300.000 Runden), einmal je Code berechnet; jede Anfrage und
 * Antwort AES-256-GCM mit Zusatzdaten „nbh1-req|<Client>“ bzw. „nbh1-res|<Anfrage-Kennung>“. Den Versand (fetch mit
 * Zeitgrenze oder Abbruch) und die Fehlertexte macht jedes Add-on selbst.
 * Klassisches Skript (globalThis.nbNet); beim Bauen nach shared/ ins Add-on kopiert, für Node-Tests auch per require. */
const nbNet = (() => {
  const PATH = "/nbhelper/v1";
  const ITERATIONS = 300_000;
  const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // ohne 0/O, 1/I – wie Helper und Kopplungscode
  const CLIENT = /^[A-Za-z0-9_-]{8,64}$/;
  const enc = text => new TextEncoder().encode(text);
  const keys = new Map();

  /** Kopplungscode ohne Leer-, Trennzeichen und verwechselbare Zeichen, groß geschrieben (gültig: 20 Zeichen). */
  const normalizeCode = code => [...String(code || "").toUpperCase()].filter(ch => CODE_ALPHABET.includes(ch)).join("");

  function toB64(bytes) {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  const fromB64 = b64 => Uint8Array.from(atob(b64), ch => ch.charCodeAt(0));

  /** Prüfsumme eines Textes zum Teilen über den Helper: die ersten 8 Byte von SHA-256 (UTF-8), hexadezimal. */
  async function textHash(text) {
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", enc(text)));
    return Array.from(d.subarray(0, 8), b => b.toString(16).padStart(2, "0")).join("");
  }

  function netKey(code) {
    const n = normalizeCode(code);
    if (!keys.has(n)) {
      keys.set(n, (async () => {
        const raw = await crypto.subtle.importKey("raw", enc(n), "PBKDF2", false, ["deriveKey"]);
        return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: enc("NovaBird-Net-1"), iterations: ITERATIONS }, raw,
          { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      })());
    }
    return keys.get(n);
  }

  /**
   * Verschlüsselte Anfrage op an den Helper unter url (ohne Pfad). post(url, body) schickt das JSON und liefert die Antwort
   * als Objekt; bei HTTP-Fehlern wirft es einen Fehler mit .status. label = Name des PCs in der Liste des Helpers (leer
   * lässt den bisherigen stehen). Fehler: "code" (Code ungültig; mit .status 403, wenn der Helper ihn ablehnt), "client",
   * "answer" (Antwort nicht prüfbar) oder der Fehlertext des Helpers ("helper" ohne Text).
   */
  async function call({ url, code, client, op, payload = {}, label = "", post }) {
    if (normalizeCode(code).length !== 20) throw new Error("code");
    if (!CLIENT.test(client || "")) throw new Error("client");
    const key = await netKey(code);
    const rid = toB64(crypto.getRandomValues(new Uint8Array(16)));
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plain = enc(JSON.stringify({ ts: Date.now(), rid, op, label, ...payload }));
    const data = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: enc(`nbh1-req|${client}`) }, key, plain));
    let res;
    try {
      res = await post(String(url || "").trim().replace(/\/+$/, "") + PATH, { c: client, n: toB64(iv), d: toB64(data) });
    } catch (e) {
      if (e.status === 403) throw Object.assign(new Error("code"), { status: 403 });
      throw e;
    }
    let msg;
    try {
      const out = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(res.n), additionalData: enc(`nbh1-res|${rid}`) }, key, fromB64(res.d));
      msg = JSON.parse(new TextDecoder().decode(out));
    } catch {
      throw new Error("answer");
    }
    if (!msg.ok) throw new Error(msg.error || "helper");
    return msg;
  }

  return { PATH, CLIENT, normalizeCode, toB64, fromB64, textHash, call };
})();

if (typeof module !== "undefined") module.exports = nbNet;
else globalThis.nbNet = nbNet;
