// Angriffstest Kopplung Verfahren 2 (POST /nbhelper/pair) gegen einen Test-Helper: node pairtest.mjs <exe> <datenordner> <netport> <webport>
// Client-Seite wie novabird-extension/options/helper.js (WebCrypto). Helper nur Loopback, ohne UDP-Suche, ohne Modell.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
const subtle = globalThis.crypto.subtle;
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const out = {};
const ok = (n, c, info) => { out[n] = c ? "ok" : { FAIL: info }; };
const child = spawn(exe, ["--server-console", "--loopback"], {
  env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort, NOVABIRD_DISCOVERY_PORT: "-1", NOVABIRD_TEST_NOMODEL: "1" },
});
child.stderr.on("data", () => {});
const rl = createInterface({ input: child.stdout });
const queue = [];
rl.on("line", l => { const w = queue.shift(); w && w(JSON.parse(l)); });
const next = () => new Promise(r => queue.push(r));
const start = await next();
const cmd = async c => { const p = next(); child.stdin.write(c + "\n"); return p; };
const url = `http://127.0.0.1:${netPort}/nbhelper/pair`;
const post = async (body, raw, method = "POST") => {
  const r = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: method === "POST" ? (raw ?? JSON.stringify(body)) : undefined });
  let j = {}; try { j = await r.json(); } catch {}
  return { status: r.status, json: j, cors: r.headers.get("access-control-allow-origin") };
};
const b64 = u8 => Buffer.from(u8).toString("base64");
const ub64 = s => new Uint8Array(Buffer.from(s, "base64"));
async function newClient() {
  const kp = await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  const pub = new Uint8Array(await subtle.exportKey("raw", kp.publicKey));
  const commit = b64(new Uint8Array(await subtle.digest("SHA-256", pub)));
  return { kp, pub, commit };
}
async function derive(c, helperPubB64) {
  const peer = await subtle.importKey("raw", ub64(helperPubB64), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = await subtle.deriveBits({ name: "ECDH", public: peer }, c.kp.privateKey, 256);
  const hk = await subtle.importKey("raw", shared, "HKDF", false, ["deriveBits", "deriveKey"]);
  const info = name => ({ name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: new TextEncoder().encode(`${name}|${helperPubB64}|${b64(c.pub)}`) });
  const sb = new Uint8Array(await subtle.deriveBits(info("nbh-pair-sas"), hk, 32));
  const sas = String((((sb[0] << 24) >>> 0) + (sb[1] << 16) + (sb[2] << 8) + sb[3]) % 1_000_000).padStart(6, "0");
  const key = await subtle.deriveKey(info("nbh-pair-key"), hk, { name: "AES-GCM", length: 256 }, false, ["decrypt"]);
  return { sas, key };
}
async function pairTo(label) {
  const c = await newClient();
  const st = await post({ op: "start", v: 2, commit: c.commit, label });
  const rv = st.json.req ? await post({ op: "reveal", req: st.json.req, pub: b64(c.pub) }) : null;
  const d = st.json.pub ? await derive(c, st.json.pub) : null;
  return { c, st, rv, d };
}
try {
  let r = await post({ op: "start", v: 2, commit: (await newClient()).commit, label: "x" });
  ok("Q1 startWhilePairingOff", r.status === 403 && r.json.error === "pairing-off", r);
  await cmd("pair-start");
  // Q2: altes Verfahren abgelehnt
  r = await post({ op: "start", pub: b64((await newClient()).pub), label: "alt" });
  ok("Q2 oldProtocolRejected", r.status === 400 && r.json.error === "update", r);
  // Q3: CORS – keine Freigabe für die Kopplung, Preflight ohne Freigabe; Hauptpfad unverändert
  ok("Q3 noCorsOnPair", r.cors === null, r.cors);
  const pre = await fetch(url, { method: "OPTIONS", headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" } });
  ok("Q3b preflightPairNoCors", pre.headers.get("access-control-allow-origin") === null, pre.headers.get("access-control-allow-origin"));
  const pre2 = await fetch(`http://127.0.0.1:${netPort}/nbhelper`, { method: "OPTIONS" });
  ok("Q3c mainPathStillCors (Hinweis)", pre2.headers.get("access-control-allow-origin") === "*", pre2.headers.get("access-control-allow-origin"));
  // Q4: festgelegt, aber ohne reveal: nicht in der Liste (keine Zahl)
  const c0 = await newClient();
  const st0 = await post({ op: "start", v: 2, commit: c0.commit, label: "nur-start" });
  let list = await cmd("pair-list");
  ok("Q4 committedNotListed", st0.status === 200 && !list.requests.some(x => x.req === st0.json.req), list);
  // Q5: reveal mit anderem Schlüssel als festgelegt → abgelehnt, Anfrage weg
  const other = await newClient();
  r = await post({ op: "reveal", req: st0.json.req, pub: b64(other.pub) });
  ok("Q5 revealWrongKeyRejected", r.status === 400 && r.json.error === "commit", r);
  r = await post({ op: "reveal", req: st0.json.req, pub: b64(c0.pub) });
  ok("Q5b requestGoneAfterMismatch", r.status === 404, r);
  // Q6: echte Kopplung abgelehnt
  const a = await pairTo("Abgelehnt");
  list = await cmd("pair-list");
  const ma = list.requests.find(x => x.req === a.st.json.req);
  ok("Q6 sasMatches", a.rv.status === 200 && ma?.sas === a.d.sas, { helper: ma?.sas, client: a.d.sas, rv: a.rv });
  let p = await post({ op: "poll", req: a.st.json.req });
  ok("Q6b pollPendingNoCode", p.json.state === "pending" && !p.json.d, p.json);
  await cmd(`pair-deny ${a.st.json.req}`);
  p = await post({ op: "poll", req: a.st.json.req });
  ok("Q6c deniedNoCode", p.json.state === "denied" && !p.json.d, p.json);
  // Q7: zugelassen → Code verschlüsselt, nur einmal
  const b = await pairTo("Echt");
  await cmd(`pair-allow ${b.st.json.req}`);
  p = await post({ op: "poll", req: b.st.json.req });
  let code;
  try {
    const plain = await subtle.decrypt({ name: "AES-GCM", iv: ub64(p.json.n), additionalData: new TextEncoder().encode("nbh-pair|" + b.st.json.req) }, b.d.key, ub64(p.json.d));
    code = JSON.parse(new TextDecoder().decode(plain)).code;
  } catch (e) { code = "ERR " + e; }
  ok("Q7 codeDeliveredEncrypted", code === start.code && !JSON.stringify(p.json).includes(start.code), { code });
  p = await post({ op: "poll", req: b.st.json.req });
  ok("Q7b codeOnlyOnce", p.status === 404 && !p.json.d, p);
  // Q8: Zulassung zurücknehmen mit „Beenden“
  const c = await pairTo("Versehen");
  await cmd(`pair-allow ${c.st.json.req}`);
  await cmd("pair-stop");
  p = await post({ op: "poll", req: c.st.json.req });
  ok("Q8 stopRevokesApproved", p.json.state === "denied" && !p.json.d, p.json);
  await cmd("pair-start");
  // Q9: Name mit Zeilenumbruch → keine vorgetäuschte Protokollzeile
  await pairTo("A\r\n2099-01-01 00:00:00 FAKE <b>x</b>");
  const log = fs.readFileSync(path.join(dir, "helper.log"), "utf8");
  ok("Q9 logNoInjectedLine", !/^2099-01-01 00:00:00 FAKE/m.test(log), log.split(/\r?\n/).filter(x => /FAKE/.test(x)));
  // Q10: kaputte Rümpfe → 400 (keine hängende Verbindung)
  const bad = [];
  for (const raw of ["1", "[]", '{"op":"poll","req":5}', '{"op":"reveal","req":[1]}', '{"op":"start","v":2,"commit":7}']) bad.push((await post(null, raw)).status);
  ok("Q10 malformedBodies400", bad.every(s => s === 400), bad);
  await cmd("pair-stop");
  await cmd("pair-start");
  // Q11: höchstens 8 offene (festgelegt oder wartend)
  const st = [];
  for (let i = 0; i < 10; i++) st.push((await post({ op: "start", v: 2, commit: (await newClient()).commit, label: "flood" + i })).status);
  ok("Q11 maxPending", st.filter(s => s === 200).length <= 8 && st.includes(429), st);
  // Q12: Kennungen raten → Sperre, danach alles blockiert
  let last = 0;
  for (let i = 0; i < 25; i++) last = (await post({ op: "poll", req: Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(16))).toString("base64url") })).status;
  ok("Q12 guessLockout", last === 429, last);
  r = await post({ op: "start", v: 2, commit: (await newClient()).commit, label: "nach Sperre" });
  ok("Q12b blockedAfterLockout", r.status === 429, r.status);
} catch (e) {
  out.exception = String(e.stack || e);
}
child.stdin.end();
await new Promise(r => child.once("exit", r));
console.log(JSON.stringify(out, null, 1));
