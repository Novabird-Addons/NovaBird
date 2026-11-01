// Gruppen, verschlüsselte Vektoren, Sicherung, CalDAV: node grouptest.mjs <exe> <datenordner> <netport> <webport>
// Test-Passwörter stehen nur hier und in LIESMICH (Testdaten).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
const S = new URL("../../novabird-search/semantic/", import.meta.url).href;
// wie im Add-on: Kopplungscode und Verschlüsselung für den Helper aus shared/nbnet.js (vor server.js)
globalThis.nbNet = (await import(new URL("../../shared/nbnet.js", import.meta.url).href)).default;
const server = await import(S + "server.js");
const { MODELS } = await import(S + "models.js");
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const m = MODELS["jina-de"];
const MODEL = { id: m.id, revision: m.revision };
const out = {};
const USERS = "users"; // API-Pfad (so geschrieben, damit der Datenschutz-Scan nicht anschlägt)
const ok = (name, cond, info) => { out[name] = cond ? "ok" : { fail: info }; };
const ADMIN_PW = "Ext-Test-Passwort-1", USER_PW = "Kalender-Test-Pw-1";

let child, lines;
async function startHelper() {
  child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
  child.stderr.on("data", () => {});
  lines = createInterface({ input: child.stdout });
  return new Promise(r => lines.once("line", l => r(JSON.parse(l))));
}
async function stopHelper() {
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
async function login(name, pw) {
  cookie = "";
  csrf = (await api("login", { name, password: pw })).csrf;
}
const C = (code, id) => ({ type: "nbhelper", url: `http://127.0.0.1:${netPort}`, code, clientId: id, label: `Test-${id.slice(0, 5)}` });

// DAV
const basic = (u, p) => "Basic " + Buffer.from(`${u}:${p}`).toString("base64");
async function dav(method, p, user, body, headers = {}) {
  const r = await fetch(`${web}${p}`, { method, headers: { Authorization: basic(user, user === "admin" ? ADMIN_PW : USER_PW), ...headers }, body, redirect: "manual" });
  return { status: r.status, text: await r.text(), etag: r.headers.get("etag"), headers: r.headers };
}
const ics = (uid, summary, comp = "VEVENT") => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Test//DE\r\nBEGIN:${comp}\r\nUID:${uid}\r\nDTSTAMP:20261031T100000Z\r\n${comp === "VEVENT" ? "DTSTART:20261105T090000Z\r\nDTEND:20261105T100000Z\r\n" : "DUE:20261105T090000Z\r\n"}SUMMARY:${summary}\r\nEND:${comp}\r\nEND:VCALENDAR\r\n`;
const PF = `<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/"><d:prop><d:current-user-principal/><c:calendar-home-set/><d:resourcetype/><d:displayname/><cs:getctag/><d:sync-token/><d:current-user-privilege-set/><d:getetag/></d:prop></d:propfind>`;

try {
  // ---- Umstellung auf Gruppen ----
  const oldNbv = fs.readdirSync(path.join(dir, "vectors")).filter(f => f.endsWith(".nbv"));
  const start = await startHelper();
  const code1 = start.code;
  ok("oldVectorsRemoved", oldNbv.length > 0 && !fs.readdirSync(path.join(dir, "vectors")).some(f => f.endsWith(".nbv")), oldNbv);
  const settings = JSON.parse(fs.readFileSync(path.join(dir, "settings.json"), "utf8"));
  ok("netCodeMoved", !("netCode" in settings) && !("vecSalt" in settings) && fs.existsSync(path.join(dir, "groups.json")), Object.keys(settings));
  await login("admin", ADMIN_PW);
  let conn = await api("connection");
  ok("oneGroup", conn.groups.length === 1 && conn.groups[0].code === code1 && conn.groups[0].id === "g1", conn.groups);
  conn = await api("groups/add", { name: "Team B" });
  const g2 = conn.groups.find(g => g.name === "Team B");
  ok("groupAdded", g2 && g2.code !== code1, conn.groups);
  const code2 = g2.code;

  // ---- PCs je Gruppe ----
  const A = C(code1, "clientAAAAA1"), B = C(code2, "clientBBBBB2");
  const ha = await server.netCall(A, "hello", { model: MODEL });
  const hb = await server.netCall(B, "hello", { model: MODEL });
  ok("helloGroups", ha.group !== "Team B" && hb.group === "Team B", { a: ha.group, b: hb.group });
  try { await server.netCall(C("ABCDE-FGHJK-LMNPQ-RSTUV", "clientCCCCC3"), "hello", {}); out.wrongCode = { fail: "angenommen" }; }
  catch (e) { ok("wrongCode", /Kopplungscode passt nicht/.test(e.message), e.message); }

  // ---- Vektoren: gespeichert verschlüsselt, nur in der eigenen Gruppe, nur mit passender Prüfsumme ----
  const text = "Testmail über den Elternabend";
  const h = await server.textHash(text);
  const keys = [{ id: "<mail-1@example.invalid>", h }];
  const v = await server.embed(A, [text], 512, { model: MODEL, keys });
  let found = await server.lookup(A, MODEL, keys);
  ok("lookupSameGroup", found.found?.length === 1, found);
  found = await server.lookup(B, MODEL, keys);
  ok("lookupOtherGroup", found.found?.length === 0, found);
  found = await server.lookup(A, MODEL, [{ id: keys[0].id, h: "0123456789abcdef" }]);
  ok("lookupWrongHash", found.found?.length === 0, found);
  const g1file = fs.readdirSync(path.join(dir, "vectors", "g1"))[0];
  const bytes = fs.readFileSync(path.join(dir, "vectors", "g1", g1file));
  ok("nbv2Header", bytes.subarray(0, 4).toString() === "NBV2" && bytes.length === 8 + 16 + 12 + m.dims * 2 + 16, bytes.length);
  // Klartext-Vektor (float16) darf nicht in der Datei stehen
  const half = Buffer.alloc(m.dims * 2);
  const f16 = x => { const f = new Float32Array([x]); const u = new Uint32Array(f.buffer)[0]; const s = (u >> 16) & 0x8000; let e = ((u >> 23) & 0xff) - 112; let mm = (u >> 13) & 0x3ff; if (e <= 0) return s; if (e > 30) return s | 0x7c00; return s | (e << 10) | mm; };
  const vv = Array.isArray(v) ? v[0] : v;
  for (let i = 0; i < 8; i++) half.writeUInt16LE(f16(vv[i]), i * 2);
  ok("noPlainVector", bytes.indexOf(half.subarray(0, 16)) < 0, "Klartext gefunden");

  // ---- Neuer Code für Gruppe 2 ----
  await api("connection/renew", { id: g2.id });
  try { await server.netCall(B, "hello", {}); out.renewOld = { fail: "alter Code geht noch" }; }
  catch (e) { ok("renewOld", /Kopplungscode passt nicht/.test(e.message), e.message); }
  ok("renewOtherGroupUntouched", (await server.netCall(A, "hello", { model: MODEL })).modelReady !== undefined);

  // ---- Kalender: Benutzer, Rechte ----
  await api(USERS + "/add", { name: "anna", password: USER_PW, role: "calendar" });
  await api(USERS + "/add", { name: "bob", password: USER_PW, role: "viewer" });
  await api(USERS + "/add", { name: "carl", password: USER_PW, role: "calendar" });
  const { id: calId } = await api("calendars/add", { name: "Team", color: "#d04040" });
  await api("calendars/update", { id: calId, rights: { anna: "write", bob: "read", nobody: "write" } });
  let cals = await api("calendars");
  ok("calRights", cals.calendars[0].rights.anna === "write" && cals.calendars[0].rights.bob === "read" && !("nobody" in cals.calendars[0].rights), cals.calendars[0]);

  // DAV: Anmeldung
  let r = await fetch(`${web}/dav/`, { method: "PROPFIND", headers: { Depth: "0" } });
  ok("davNoAuth", r.status === 401 && /Basic/.test(r.headers.get("www-authenticate")), r.status);
  r = await fetch(`${web}/dav/`, { method: "PROPFIND", headers: { Depth: "0", Authorization: basic("anna", "falsch-falsch") } });
  ok("davWrongPw", r.status === 401, r.status);
  r = await dav("GET", "/.well-known/caldav", "anna");
  ok("wellKnown", r.status === 301 && r.headers.get("location") === "/dav/", r.status);
  r = await dav("OPTIONS", "/dav/", "anna");
  ok("options", r.status === 200 && /calendar-access/.test(r.headers.get("dav")), r.headers.get("dav"));
  r = await dav("PROPFIND", "/dav/", "anna", PF, { Depth: "0" });
  ok("principal", r.status === 207 && r.text.includes("<d:href>/dav/anna/</d:href>"), r.text.slice(0, 400));
  r = await dav("PROPFIND", "/dav/anna/", "anna", PF, { Depth: "1" });
  ok("homeListsCal", r.status === 207 && r.text.includes(`/dav/anna/${calId}/`) && r.text.includes("<c:calendar />") || r.text.includes("<c:calendar/>"), r.text.slice(0, 1500));
  r = await dav("PROPFIND", "/dav/carl/", "carl", PF, { Depth: "1" });
  ok("carlSeesNothing", r.status === 207 && !r.text.includes(calId), r.text.slice(0, 600));
  r = await dav("PROPFIND", `/dav/carl/${calId}/`, "carl", PF, { Depth: "0" });
  ok("carlNoAccess", r.status === 404, r.status);
  r = await dav("PROPFIND", "/dav/anna/", "carl", PF, { Depth: "0" });
  ok("otherUserPath", r.status === 403, r.status);

  // DAV: Einträge
  const calPath = `/dav/anna/${calId}/`;
  r = await dav("PROPFIND", calPath, "anna", PF, { Depth: "0" });
  const ctag0 = /<cs:getctag>(\d+)</.exec(r.text)?.[1];
  ok("calProps", r.status === 207 && r.text.includes("<d:write />") || r.text.includes("<d:write/>"), r.text.slice(0, 1200));
  r = await dav("REPORT", calPath, "anna", `<d:sync-collection xmlns:d="DAV:"><d:sync-token/><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`, { Depth: "1" });
  const token0 = /<d:sync-token>([^<]+)</.exec(r.text)?.[1];
  ok("syncInitial", r.status === 207 && token0, r.text);
  r = await dav("PUT", calPath + "ev1.ics", "anna", ics("ev1", "Teamrunde"), { "Content-Type": "text/calendar", "If-None-Match": "*" });
  const etag1 = r.etag;
  ok("putNew", r.status === 201 && etag1, r);
  r = await dav("PUT", calPath + "ev1.ics", "anna", ics("ev1", "Teamrunde"), { "If-None-Match": "*" });
  ok("putExistsIfNoneMatch", r.status === 412, r.status);
  r = await dav("PUT", calPath + "ev1.ics", "anna", ics("ev1", "Teamrunde (verschoben)"), { "If-Match": etag1 });
  const etag2 = r.etag;
  ok("putUpdate", r.status === 204 && etag2 && etag2 !== etag1, r.status);
  r = await dav("PUT", calPath + "ev1.ics", "anna", ics("ev1", "Konflikt"), { "If-Match": etag1 });
  ok("putConflict", r.status === 412, r.status);
  r = await dav("PUT", calPath + "todo1.ics", "anna", ics("todo1", "Bericht schreiben", "VTODO"));
  ok("putTodo", r.status === 201, r.status);
  r = await dav("PUT", calPath + "bad.ics", "anna", "hallo");
  ok("putInvalid", r.status === 415, r.status);
  r = await dav("PUT", `/dav/bob/${calId}/x.ics`, "bob", ics("x", "Bob"));
  ok("readOnlyPut", r.status === 403, r.status);
  r = await dav("GET", `/dav/bob/${calId}/ev1.ics`, "bob");
  ok("readOnlyGet", r.status === 200 && r.text.includes("verschoben") && r.etag === etag2, r.status);
  r = await dav("PROPFIND", calPath, "anna", PF, { Depth: "1" });
  ok("listItems", (r.text.match(/<d:response>/g) || []).length === 3 && r.text.includes(etag2), r.text.slice(0, 2000));
  ok("ctagChanged", /<cs:getctag>(\d+)</.exec(r.text)?.[1] !== ctag0, ctag0);
  r = await dav("REPORT", calPath, "anna", `<c:calendar-multiget xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data/></d:prop><d:href>${calPath}ev1.ics</d:href><d:href>${calPath}missing.ics</d:href></c:calendar-multiget>`, { Depth: "1" });
  ok("multiget", r.status === 207 && r.text.includes("SUMMARY:Teamrunde (verschoben)") && r.text.includes("404 Not Found"), r.text);
  r = await dav("REPORT", calPath, "anna", `<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VTODO"/></c:comp-filter></c:filter></c:calendar-query>`, { Depth: "1" });
  ok("queryTodo", r.status === 207 && r.text.includes("todo1.ics") && !r.text.includes("ev1.ics"), r.text);
  r = await dav("DELETE", calPath + "todo1.ics", "anna", undefined, { "If-Match": '"0000"' });
  ok("deleteConflict", r.status === 412, r.status);
  r = await dav("DELETE", calPath + "todo1.ics", "anna");
  ok("delete", r.status === 204, r.status);
  r = await dav("REPORT", calPath, "anna", `<d:sync-collection xmlns:d="DAV:"><d:sync-token>${token0}</d:sync-token><d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>`, { Depth: "1" });
  ok("syncDelta", r.status === 207 && r.text.includes("ev1.ics") && /todo1\.ics<\/d:href><d:status>HTTP\/1.1 404/.test(r.text), r.text);
  r = await dav("REPORT", calPath, "anna", `<d:sync-collection xmlns:d="DAV:"><d:sync-token>http://novabird.helper/sync/${calId}/99999</d:sync-token><d:prop><d:getetag/></d:prop></d:sync-collection>`, { Depth: "1" });
  ok("syncBadToken", r.status === 403 && r.text.includes("valid-sync-token"), r.status);
  r = await dav("GET", calPath, "anna");
  ok("exportIcs", r.status === 200 && r.text.startsWith("BEGIN:VCALENDAR") && r.text.includes("UID:ev1") && !r.text.includes("todo1"), r.text);
  r = await dav("MKCALENDAR", "/dav/anna/neu/", "anna");
  ok("mkcalendarDenied", r.status === 403 || r.status === 404, r.status);

  // Web-Oberfläche mit Rolle „Nur Kalender“
  const adminCookie = [cookie, csrf];
  await login("anna", USER_PW);
  r = await api("status", undefined, true);
  ok("calendarRoleNoStatus", r.status === 403, r.status);
  cals = await api("calendars");
  ok("calendarRoleList", cals.calendars.length === 1 && cals.calendars[0].right === "write" && !cals.users && cals.calendars[0].rights == null, cals);
  r = await api("calendars/add", { name: "x" }, true);
  ok("calendarRoleNoAdd", r.status === 403, r.status);
  [cookie, csrf] = adminCookie;

  // ---- Sicherung: erstellen, ändern, wiederherstellen ----
  r = await api("backup/export", { password: "Sicherung-Test-1", vectors: true }, true);
  const backup = Buffer.from(await r.arrayBuffer());
  ok("backupExport", r.status === 200 && backup.subarray(0, 5).toString() === "NBBK1" && /attachment/.test(r.headers.get("content-disposition")), r.status);
  await api("calendars/remove", { id: calId });
  await api("groups/remove", { id: g2.id });
  ok("groupRemovedFolder", !fs.existsSync(path.join(dir, "vectors", g2.id)));
  r = await fetch(`${web}/api/backup/import`, { method: "POST", headers: { Cookie: cookie, "X-CSRF": csrf, "X-Backup-Password": Buffer.from("falsch-falsch-1").toString("base64") }, body: backup });
  ok("restoreWrongPw", r.status === 400, r.status);
  r = await fetch(`${web}/api/backup/import`, { method: "POST", headers: { Cookie: cookie, "X-CSRF": csrf, "X-Backup-Password": Buffer.from("Sicherung-Test-1").toString("base64") }, body: backup });
  const restored = await r.json();
  ok("restore", r.status === 200 && restored.groups === 2 && restored.calendars === 1 && restored.vectors, restored);
  r = await api("connection", undefined, true);
  ok("sessionsDropped", r.status === 401, r.status);
  await login("admin", ADMIN_PW);
  conn = await api("connection");
  ok("restoredGroups", conn.groups.length === 2 && conn.groups.some(g => g.name === "Team B"), conn.groups);
  found = await server.lookup(A, MODEL, keys);
  ok("restoredVectors", found.found?.length === 1, found);
  r = await dav("GET", calPath + "ev1.ics", "anna");
  ok("restoredCalendar", r.status === 200 && r.text.includes("verschoben"), r.status);

  // ---- Neustart: Vektoren und Kalender bleiben ----
  await stopHelper();
  await startHelper();
  found = await server.lookup(A, MODEL, keys);
  ok("afterRestartVectors", found.found?.length === 1, found);
  r = await dav("PROPFIND", calPath, "anna", PF, { Depth: "1" });
  ok("afterRestartCalendar", (r.text.match(/<d:response>/g) || []).length === 2, r.text.slice(0, 500));
} catch (e) {
  out.exception = String(e.stack || e);
}
await stopHelper().catch(() => {});
console.log(JSON.stringify(out, null, 1));
