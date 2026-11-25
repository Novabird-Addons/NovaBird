// Geteilte Adressbücher (AddressBooks.cs) über einen Test-Helper: node abshare.mjs <exe> <leerer datenordner> <netport> <webport>
// PCs A, B, C in Gruppe 1, D in Gruppe 2. Prüft Freigabe (Gruppe / ausgewählte PCs), nur der Besitzer ändert, PC-Schlüssel gegen
// fremde Kennungen, Grenzen, Entfernen eines PCs, Web-API und Sicherung.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import crypto from "node:crypto";
import fs from "node:fs";
const S = new URL("../../novabird-search/semantic/", import.meta.url).href;
globalThis.nbNet = (await import(new URL("../../shared/nbnet.js", import.meta.url).href)).default;
const server = await import(S + "server.js");
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const out = {};
const ok = (name, cond, info) => { out[name] = cond ? "ok" : { fail: info }; };
const ADMIN_PW = "Adressbuch-Test-Pw-1";

let child;
function startHelper() {
  child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
  child.stderr.on("data", d => { if (process.env.ABDEBUG) process.stderr.write(d); });
  const lines = createInterface({ input: child.stdout });
  return new Promise(r => lines.once("line", l => r(JSON.parse(l))));
}
async function stopHelper() {
  if (child.exitCode !== null) return;
  child.stdin.end();
  await new Promise(r => child.once("exit", r));
}
const web = `http://127.0.0.1:${webPort}`;
let cookie = "", csrf = "";
async function api(p, body, raw) {
  const r = await fetch(`${web}/api/${p}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie, "X-CSRF": csrf, "X-Lang": "de" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = r.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  if (raw) return r;
  const j = await r.json();
  if (!r.ok) throw new Error(`${p}: ${r.status} ${j.error}`);
  return j;
}
const etag = text => crypto.createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex").slice(0, 16);
const vcard = (uid, fn, extra = "") => `BEGIN:VCARD\r\nVERSION:4.0\r\nUID:${uid}\r\nFN:${fn}\r\nEMAIL:${uid}@example.invalid\r\n${extra}END:VCARD\r\n`;
// PC mit eigenem Schlüssel: call(op, payload) schickt pcKey mit und merkt sich einen neu vergebenen
function pc(code, id, label) {
  const c = { type: "nbhelper", url: `http://127.0.0.1:${netPort}`, code, clientId: id, label };
  c.call = async (op, payload = {}) => {
    const r = await server.netCall(c, op, { ...payload, pcKey: c.key });
    if (r.pcKey) c.key = r.pcKey;
    return r;
  };
  c.fails = async (op, payload = {}) => {
    try { await c.call(op, payload); return null; } catch (e) { return e.message; }
  };
  return c;
}

const start = await startHelper();
try {
  await api("setup", { name: "admin", password: ADMIN_PW });
  csrf = (await api("login", { name: "admin", password: ADMIN_PW })).csrf;
  const conn = await api("groups/add", { name: "Team 2" });
  const code2 = conn.groups.find(g => g.name === "Team 2").code;
  const A = pc(start.code, "pcAAAAAAAA01", "Empfang"), B = pc(start.code, "pcBBBBBBBB02", "Labor"), Cc = pc(start.code, "pcCCCCCCCC03", "Chef");
  const D = pc(code2, "pcDDDDDDDD04", "Andere Gruppe");
  for (const p of [A, B, Cc, D]) await server.netCall(p, "hello", {});
  const hello = await server.netCall(A, "hello", {});
  ok("helloFlag", hello.addressBooks === 1, hello.addressBooks);

  // ---- Schlüssel und Info ----
  ok("pcsOnlyWithKey", (await A.call("abInfo")).pcs.length === 0, null); // B und C haben sich noch nicht angemeldet
  await B.call("abInfo");
  await Cc.call("abInfo");
  const infoA = await A.call("abInfo");
  ok("keyIssued", typeof A.key === "string" && A.key.length >= 40, A.key);
  ok("pcsSameGroup", infoA.pcs.map(p => p.label).join() === "Chef,Labor", infoA.pcs);
  const infoA2 = await A.call("abInfo");
  ok("keyOnlyOnce", infoA2.pcKey === undefined, Object.keys(infoA2));

  // ---- Anbieten: A teilt "Persönliches Adressbuch" mit der Gruppe, "Kunden" nur mit B ----
  const pers = await A.call("abPublish", { tb: "ldap_2.servers.pab", name: "Persönliches Adressbuch", access: "group" });
  const kunden = await A.call("abPublish", { tb: "uid-kunden", name: "Kunden", access: "pcs", pcs: [B.clientId] });
  ok("published", pers.id && kunden.id && pers.id !== kunden.id && pers.owner === "Empfang", { pers, kunden });
  const again = await A.call("abPublish", { tb: "ldap_2.servers.pab", name: "Persönliches Adressbuch", access: "group" });
  ok("publishIdempotent", again.id === pers.id && again.seq === pers.seq, { again, pers });
  const cards = Array.from({ length: 30 }, (_, i) => ({ uid: `u${i}`, vcard: vcard(`u${i}`, `Kontakt ${i}`) }));
  const put = await A.call("abPut", { id: pers.id, put: cards });
  ok("putCount", put.count === 30, put);
  await A.call("abPut", { id: kunden.id, put: [{ uid: "k1", vcard: vcard("k1", "Kunde Eins") }] });

  // ---- Wer sieht was ----
  const offB = (await B.call("abInfo")).offered, offC = (await Cc.call("abInfo")).offered, offD = (await D.call("abInfo")).offered, offA = (await A.call("abInfo")).offered;
  ok("offeredB", offB.map(b => b.name).sort().join() === "Kunden,Persönliches Adressbuch" && offB.every(b => b.owner === "Empfang"), offB);
  ok("offeredC", offC.map(b => b.name).join() === "Persönliches Adressbuch", offC);
  ok("offeredNotOtherGroup", offD.length === 0, offD);
  ok("notOwnAsOffer", offA.length === 0, offA);
  ok("ownListed", (await A.call("abInfo")).own.length === 2, null);

  // ---- Lesen: Stand und Karten ----
  const st = await B.call("abState", { id: pers.id });
  ok("stateEtags", Object.keys(st.cards).length === 30 && st.cards.u3 === etag(cards[3].vcard), st.cards.u3);
  const got = await B.call("abGet", { id: pers.id, uids: ["u1", "u2", "gibtsnicht"] });
  ok("getCards", got.cards.length === 2 && got.cards[0].vcard === cards[1].vcard, got.cards.map(c => c.uid));
  ok("cNoKunden", /book/.test(await Cc.fails("abState", { id: kunden.id }) || ""), null);
  ok("dNoAccess", /book/.test(await D.fails("abGet", { id: pers.id, uids: ["u1"] }) || ""), null);

  // ---- nur der Besitzer ändert ----
  ok("bCannotPutReadonly", /readonly/.test(await B.fails("abPut", { id: pers.id, put: [{ uid: "x", vcard: vcard("x", "X") }] }) || ""), null);
  ok("bCannotUnpublish", /book/.test(await B.fails("abUnpublish", { id: pers.id }) || ""), null);
  ok("dCannotPut", /book/.test(await D.fails("abPut", { id: pers.id, put: [{ uid: "x", vcard: vcard("x", "X") }] }) || ""), null);

  // ---- alle dürfen ändern: bedingtes Schreiben ----
  const team = await A.call("abPublish", { tb: "uid-team", name: "Team", access: "group", write: true });
  ok("writeFlagOffered", (await B.call("abInfo")).offered.find(o => o.id === team.id)?.write === true, null);
  const t1 = vcard("t1", "Team Eins"), t1b = vcard("t1", "Team Eins (B)"), t1c = vcard("t1", "Team Eins (C)");
  await A.call("abPut", { id: team.id, put: [{ uid: "t1", vcard: t1, base: "" }] });
  // B ändert mit dem richtigen Stand
  const rb = await B.call("abPut", { id: team.id, put: [{ uid: "t1", vcard: t1b, base: etag(t1) }] });
  ok("bWritesWithBase", rb.conflicts.length === 0 && (await A.call("abState", { id: team.id })).cards.t1 === etag(t1b), rb);
  // C ändert gleichzeitig mit altem Stand: abgelehnt, Fassung von B bleibt
  const rc = await Cc.call("abPut", { id: team.id, put: [{ uid: "t1", vcard: t1c, base: etag(t1) }] });
  ok("cConflict", rc.conflicts.join() === "t1" && (await A.call("abState", { id: team.id })).cards.t1 === etag(t1b), rc);
  // neu anlegen, das es schon gibt: abgelehnt
  const rn = await Cc.call("abPut", { id: team.id, put: [{ uid: "t1", vcard: t1c, base: "" }] });
  ok("createExistsConflict", rn.conflicts.join() === "t1", rn);
  // löschen mit altem Stand: abgelehnt; mit richtigem: weg
  const rd1 = await Cc.call("abPut", { id: team.id, del: [{ uid: "t1", base: etag(t1) }] });
  ok("deleteStaleConflict", rd1.conflicts.join() === "t1" && "t1" in (await A.call("abState", { id: team.id })).cards, rd1);
  const rd2 = await Cc.call("abPut", { id: team.id, del: [{ uid: "t1", base: etag(t1b) }] });
  ok("deleteWithBase", rd2.conflicts.length === 0 && !("t1" in (await A.call("abState", { id: team.id })).cards), rd2);
  // Schreibrecht zurückgenommen: B darf nicht mehr
  await A.call("abPublish", { tb: "uid-team", name: "Team", access: "group", write: false });
  ok("writeRevoked", /readonly/.test(await B.fails("abPut", { id: team.id, put: [{ uid: "t2", vcard: vcard("t2", "T2"), base: "" }] }) || ""), null);
  await A.call("abUnpublish", { id: team.id });

  // ---- fremde Kennung: B gibt sich als A aus (kennt A's Kennung, nicht A's Schlüssel) ----
  const fakeA = pc(start.code, A.clientId, "Empfang");
  ok("spoofNoKey", (await fakeA.fails("abInfo")) === "pckey", null);
  fakeA.key = B.key;
  ok("spoofWrongKey", (await fakeA.fails("abPut", { id: pers.id, del: ["u1"] })) === "pckey", null);
  fakeA.label = "Fremder Name";
  await fakeA.fails("abInfo");
  ok("spoofNoRename", (await api("pcs")).pcs.find(p => p.id === A.clientId)?.label === "Empfang", (await api("pcs")).pcs);
  ok("ownerStillThere", Object.keys((await A.call("abState", { id: pers.id })).cards).length === 30, null);

  // ---- Änderungen: seq, Löschen, unverändert ----
  const seq0 = (await B.call("abState", { id: pers.id })).seq;
  await A.call("abPut", { id: pers.id, put: [cards[0]] });
  ok("unchangedSameSeq", (await B.call("abState", { id: pers.id })).seq === seq0, null);
  await A.call("abPut", { id: pers.id, put: [{ uid: "u0", vcard: vcard("u0", "Kontakt Null geändert") }], del: ["u29"] });
  const st2 = await B.call("abState", { id: pers.id });
  ok("changeSeq", st2.seq === seq0 + 1 && !("u29" in st2.cards) && st2.cards.u0 !== cards[0].vcard && Object.keys(st2.cards).length === 29, st2.seq);

  // ---- Grenzen ----
  ok("tooBig", /size/.test(await A.fails("abPut", { id: pers.id, put: [{ uid: "big", vcard: vcard("big", "Groß", "NOTE:" + "x".repeat(300 << 10) + "\r\n") }] }) || ""), null);
  ok("notVcard", /vcard/.test(await A.fails("abPut", { id: pers.id, put: [{ uid: "bad", vcard: "hallo" }] }) || ""), null);
  ok("badUid", /uid/.test(await A.fails("abPut", { id: pers.id, put: [{ uid: "", vcard: vcard("x", "X") }] }) || ""), null);
  ok("batchLimit", /batch/.test(await A.fails("abPut", { id: pers.id, del: Array.from({ length: 1001 }, (_, i) => "d" + i) }) || ""), null);
  // viele große Karten: abGet liefert höchstens ~4 MB, der Rest kommt danach
  const fat = Array.from({ length: 30 }, (_, i) => ({ uid: `f${i}`, vcard: vcard(`f${i}`, `Foto ${i}`, "NOTE:" + "y".repeat(200 << 10) + "\r\n") }));
  for (let i = 0; i < fat.length; i += 10) await A.call("abPut", { id: pers.id, put: fat.slice(i, i + 10) });
  const g1 = await B.call("abGet", { id: pers.id, uids: fat.map(f => f.uid) });
  ok("getPaged", g1.cards.length > 0 && g1.cards.length < 30, g1.cards.length);

  // ---- Freigabe ändern: Kunden jetzt für C statt B ----
  await A.call("abPublish", { tb: "uid-kunden", name: "Kunden 2027", access: "pcs", pcs: [Cc.clientId] });
  const offB2 = (await B.call("abInfo")).offered.map(b => b.name), offC2 = (await Cc.call("abInfo")).offered.map(b => b.name);
  ok("accessMoved", !offB2.includes("Kunden 2027") && !offB2.includes("Kunden") && offC2.includes("Kunden 2027"), { offB2, offC2 });

  // ---- Web-API ----
  const wl = await api("addressbooks");
  ok("webList", wl.books.length === 2 && wl.books.some(b => b.name === "Kunden 2027" && b.owner === "Empfang" && b.pcs.join() === "Chef"), wl.books);

  // ---- Sicherung: mit Adressbüchern, nach Einspielen noch da und Schlüssel gelten ----
  const bk = await api("backup/export", { password: ADMIN_PW, vectors: false }, true);
  const data = Buffer.from(await bk.arrayBuffer());
  await A.call("abUnpublish", { id: kunden.id });
  ok("unpublished", (await Cc.call("abInfo")).offered.length === 1, null);
  const r = await fetch(`${web}/api/backup/import`, { method: "POST", headers: { Cookie: cookie, "X-CSRF": csrf, "X-Backup-Password": Buffer.from(ADMIN_PW).toString("base64") }, body: data });
  const rj = await r.json();
  ok("restoreCount", rj.addressBooks === 2, rj);
  csrf = (await api("login", { name: "admin", password: ADMIN_PW })).csrf;
  ok("restoredOffer", (await Cc.call("abInfo")).offered.length === 2, null);

  // ---- PC entfernen: seine Adressbücher weg, Schlüssel neu ----
  await api("pcs/forget", { id: A.clientId });
  ok("forgetDropsBooks", (await B.call("abInfo")).offered.length === 0 && (await api("addressbooks")).books.length === 0, null);
  const oldKey = A.key;
  await A.call("abInfo"); // bringt den alten Schlüssel mit: wird wieder angenommen
  ok("forgetKeyReaccepted", A.key === oldKey, null);
  // Web-Löschen
  const again2 = await A.call("abPublish", { tb: "x", name: "Neu", access: "group" });
  await api("addressbooks/remove", { id: again2.id });
  ok("webRemove", (await B.call("abInfo")).offered.length === 0, null);
  ok("noPlainFilesOutside", fs.existsSync(`${dir}/addressbooks/pckeys.json`) && !fs.readFileSync(`${dir}/addressbooks/pckeys.json`, "utf8").includes(B.key), null);
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  await stopHelper();
}
const failed = Object.entries(out).filter(([, v]) => v !== "ok");
console.log(JSON.stringify(out, null, 1));
console.log(failed.length ? `FEHLER: ${failed.length}` : "alles ok");
process.exit(failed.length ? 1 : 0);
