// Getrennter Vektorspeicher für Handys (space:"phone"): node phonespace.mjs <exe> <datenordner> <netport> <webport>
// Der Datenordner braucht das Suchmodell (models\…) und settings.json mit benchRevision (sonst rechnet der Helper nicht).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
const S = new URL("../../novabird-search/semantic/", import.meta.url).href;
globalThis.nbNet = (await import(new URL("../../shared/nbnet.js", import.meta.url).href)).default;
const server = await import(S + "server.js");
const { MODELS } = await import(S + "models.js");
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const m = MODELS["jina-de"];
const MODEL = { id: m.id, revision: m.revision };
const out = {};
const ok = (name, cond, info) => { out[name] = cond ? "ok" : { fail: info }; };

let child;
async function startHelper() {
  child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
  child.stderr.on("data", () => {});
  const lines = createInterface({ input: child.stdout });
  return new Promise(r => lines.once("line", l => r(JSON.parse(l))));
}
async function stopHelper() {
  child.stdin.end();
  await new Promise(r => child.once("exit", r));
}
const C = (code, clientId, label) => ({ type: "nbhelper", url: `http://127.0.0.1:${netPort}`, code, clientId, label });
const nbv = sub => { const d = path.join(dir, "vectors", "g1", ...sub); return fs.existsSync(d) ? fs.readdirSync(d).filter(f => f.endsWith(".nbv")) : []; };
const found = r => r.found?.length ?? -1;

try {
  const start = await startHelper();
  const pc = C(start.code, "clientPC0001", "PC"), phone = C(start.code, "clientPH0001", "Handy");
  const hello = await server.netCall(phone, "hello", { model: MODEL });
  ok("helloSpaces", Array.isArray(hello.vecSpaces) && hello.vecSpaces.includes("phone"), hello.vecSpaces);

  // gleiche Message-ID, verschiedener Text (PC und Handy bilden ihn verschieden) -> verschiedene Prüfsummen
  const id = "<mail-1@example.invalid>";
  const hPc = await server.textHash("Elternabend am Dienstag\nText vom PC");
  const hPh = await server.textHash("Elternabend am Dienstag\nText vom Handy");
  ok("noPhoneFolderBefore", !fs.existsSync(path.join(dir, "vectors", "g1", "phone")), "phone schon da");
  await server.netCall(pc, "embed", { model: MODEL, texts: ["Text vom PC"], prio: "index", keys: [{ id, h: hPc }] });
  await server.netCall(phone, "embed", { model: MODEL, texts: ["Text vom Handy"], prio: "index", keys: [{ id, h: hPh }], space: "phone" });
  ok("pcKept", found(await server.netCall(pc, "vlookup", { model: MODEL, items: [{ id, h: hPc }] })) === 1, "PC-Satz verdrängt");
  ok("phoneFound", found(await server.netCall(phone, "vlookup", { model: MODEL, items: [{ id, h: hPh }], space: "phone" })) === 1, "Handy-Satz fehlt");
  ok("pcStoreHasNoPhone", found(await server.netCall(pc, "vlookup", { model: MODEL, items: [{ id, h: hPh }] })) === 0, "Handy-Satz im PC-Speicher");
  ok("phoneStoreHasNoPc", found(await server.netCall(phone, "vlookup", { model: MODEL, items: [{ id, h: hPc }], space: "phone" })) === 0, "PC-Satz im Handy-Speicher");
  ok("files", nbv([]).length === 1 && nbv(["phone"]).length === 1, { pc: nbv([]), phone: nbv(["phone"]) });

  // unbekannte Werte gelten als PC und legen keinen Ordner an
  await server.netCall(pc, "embed", { model: MODEL, texts: ["x"], prio: "index", keys: [{ id: "<mail-2@example.invalid>", h: hPc }], space: "..\\..\\evil" });
  await server.netCall(pc, "vlookup", { model: MODEL, items: [{ id, h: hPc }], space: 42 });
  const folders = fs.readdirSync(path.join(dir, "vectors", "g1"), { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
  ok("unknownSpaceIsPc", folders.length === 1 && folders[0] === "phone" && !fs.existsSync(path.join(dir, "evil")), folders);
  ok("unknownSpaceStored", found(await server.netCall(pc, "vlookup", { model: MODEL, items: [{ id: "<mail-2@example.invalid>", h: hPc }] })) === 1, "nicht im PC-Speicher");

  // nach dem Neustart wird der Handy-Speicher wieder geöffnet
  await stopHelper();
  await startHelper();
  ok("phoneAfterRestart", found(await server.netCall(phone, "vlookup", { model: MODEL, items: [{ id, h: hPh }], space: "phone" })) === 1, "nach Neustart weg");
  ok("pcAfterRestart", found(await server.netCall(pc, "vlookup", { model: MODEL, items: [{ id, h: hPc }] })) === 1, "nach Neustart weg");

  // Web-Oberfläche: Anzeige, Sicherung mit Wiederherstellen, Gruppe löschen, Vektoren löschen
  const web = `http://127.0.0.1:${webPort}`;
  let cookie = "", csrf = "";
  const api = async (p, body, headers = {}) => {
    const r = await fetch(`${web}/api/${p}`, { method: body === undefined ? "GET" : "POST", headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF": csrf, "X-Lang": "de", ...headers }, body: body === undefined ? undefined : body instanceof Buffer ? body : JSON.stringify(body) });
    const set = r.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    return r;
  };
  const ADMIN_PW = "Phone-Test-Passwort-1"; // Testdaten
  const login = async () => { cookie = ""; csrf = (await (await api(fs.existsSync(path.join(dir, "users.json")) ? "login" : "setup", { name: "admin", password: ADMIN_PW })).json()).csrf; };
  await login();
  let st = await (await api("status")).json();
  ok("statusPhone", st.vectors.phone === 1 && st.vectors.count === 3, st.vectors);
  let conn = await (await api("connection")).json();
  ok("groupCountsPhone", conn.groups[0].vectors === 3, conn.groups);
  const backup = Buffer.from(await (await api("backup/export", { password: "Sicherung-Test-1", vectors: true })).arrayBuffer());
  await api("vectors/clear", {});
  st = await (await api("status")).json();
  ok("clearIncludesPhone", st.vectors.count === 0 && st.vectors.phone === 0, st.vectors);
  const r = await api("backup/import", backup, { "Content-Type": "application/octet-stream", "X-Backup-Password": Buffer.from("Sicherung-Test-1").toString("base64") });
  ok("restore", r.status === 200, r.status);
  await login();
  ok("phoneAfterRestore", found(await server.netCall(phone, "vlookup", { model: MODEL, items: [{ id, h: hPh }], space: "phone" })) === 1, "nach Wiederherstellen weg");
  // zweite Gruppe mit Handy-Speicher löschen: Ordner samt phone\ weg, solange die Datei offen war
  conn = await (await api("groups/add", { name: "Team B" })).json();
  const g2 = conn.groups.find(g => g.name === "Team B");
  const ph2 = C(g2.code, "clientPH0002", "Handy B");
  await server.netCall(ph2, "embed", { model: MODEL, texts: ["B"], prio: "index", keys: [{ id, h: hPh }], space: "phone" });
  ok("group2Phone", fs.existsSync(path.join(dir, "vectors", g2.id, "phone")), "kein phone-Ordner");
  await api("groups/remove", { id: g2.id });
  ok("groupRemovedWithPhone", !fs.existsSync(path.join(dir, "vectors", g2.id)), fs.existsSync(path.join(dir, "vectors", g2.id)) && fs.readdirSync(path.join(dir, "vectors", g2.id), { recursive: true }));
} catch (e) {
  out.error = String(e?.stack || e);
} finally {
  if (child && child.exitCode === null) await stopHelper();
}
console.log(JSON.stringify(out, null, 1));
process.exit(Object.values(out).every(v => v === "ok") ? 0 : 1);
