// Vorlesen einrichten über die Web-Oberfläche (echter Download, etwa 1,5 GB) und benutzen:
//   node ttsinstall.mjs <exe> <datenordner> <netport> <webport>
// Der Datenordner braucht das Suchmodell und einen Admin (users.json, Passwort wie in pentest.mjs); tts\ darf fehlen.
// Test-Passwörter nur hier.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
import path from "node:path";
const S = new URL("../../novabird-search/semantic/", import.meta.url).href;
const server = await import(S + "server.js");
const [exe, dir, netPort, webPort] = process.argv.slice(2);
const ADMIN_PW = "Ext-Test-Passwort-1";
const out = {};
const ok = (name, cond, info) => { out[name] = cond ? "ok" : { fail: info }; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

const child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
child.stderr.on("data", () => {});
const start = await new Promise(r => createInterface({ input: child.stdout }).once("line", l => r(JSON.parse(l))));
const C = { type: "nbhelper", url: `http://127.0.0.1:${netPort}`, code: start.code, clientId: "ttsinstall01", label: "TTS-Einrichtung" };
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

try {
  csrf = (await api("login", { name: "admin", password: ADMIN_PW })).csrf;
  let s = await api("tts");
  ok("notInstalled", !s.installed && !s.available && s.downloadMb > 1000, s);
  let h = await server.netCall(C, "hello", {});
  ok("helloNotAvailable", h.speech?.available === false, h.speech);
  try { await server.netCall(C, "tts", { text: "Hallo.", lang: "german" }); out.ttsBeforeInstall = { fail: "angenommen" }; }
  catch (e) { ok("ttsBeforeInstall", /nicht eingerichtet/.test(e.message), e.message); }

  // Einrichten mit Fortschritt
  const t0 = Date.now();
  await api("tts/install", {});
  const pcts = new Set();
  for (let i = 0; i < 1200; i++) {
    s = await api("tts");
    if (s.installingPct != null) pcts.add(s.installingPct);
    if (!s.installing) break;
    await sleep(1000);
  }
  out.installSeconds = Math.round((Date.now() - t0) / 1000);
  out.progressSteps = pcts.size;
  ok("installed", s.installed && s.enabled && s.voices.length === 4 && !s.error, s);
  ok("defaultVoices", s.voiceGerman === "ruhig" && s.voiceEnglish === "en_calm", s);
  ok("downloadsCleaned", !fs.existsSync(path.join(dir, "tts", "download")));
  ok("pthIsolated", !/import site/.test(fs.readFileSync(path.join(dir, "tts", "python", "python311._pth"), "utf8").replace(/^#.*$/m, "")));

  // Hörprobe über die Web-Oberfläche (WAV)
  let t = Date.now();
  const r = await api("tts/test", { text: "Hallo, das ist die Hörprobe.", lang: "german", voice: "ruhig" }, true);
  const wav = Buffer.from(await r.arrayBuffer());
  ok("webTest", r.status === 200 && r.headers.get("content-type") === "audio/wav" && wav.length > 48000 && wav.toString("ascii", 0, 4) === "RIFF", { status: r.status, len: wav.length });
  out.webTestColdMs = Date.now() - t;
  ok("cspMedia", /media-src 'self' blob:/.test(r.headers.get("content-security-policy") || ""), r.headers.get("content-security-policy"));

  // Thunderbird-Weg (verschlüsselt)
  h = await server.netCall(C, "hello", {});
  ok("helloAvailable", h.speech?.available === true && h.speech.running === true, h.speech);
  t = Date.now();
  const n = await server.netCall(C, "tts", { text: "Die Rechnung ist bis Ende des Monats fällig.", lang: "german" });
  out.netWarmMs = Date.now() - t;
  ok("netTts", Buffer.from(n.wav, "base64").length > 48000, null);

  // Standardstimmen: nur vorhandene Namen in der passenden Sprache
  s = await api("tts/voices", { german: "abenteuer", english: "ruhig" });
  ok("voicesSaved", s.voiceGerman === "abenteuer" && s.voiceEnglish === "en_calm", s);
  s = await api("tts/voices", { german: "..\\..\\x" });
  ok("voicesRejectBad", s.voiceGerman === "abenteuer", s);

  // Ausschalten: Thunderbird bekommt kein Vorlesen mehr, der Dienst endet
  s = await api("tts/enable", { on: false });
  h = await server.netCall(C, "hello", {});
  ok("offHello", s.enabled === false && h.speech?.available === false && h.speech.running === false, h.speech);
  try { await server.netCall(C, "tts", { text: "Hallo.", lang: "german" }); out.offTts = { fail: "angenommen" }; }
  catch (e) { ok("offTts", /ausgeschaltet/.test(e.message), e.message); }
  s = await api("tts/enable", { on: true });
  ok("onAgain", s.enabled === true);

  // Entfernen: Programm und Modell weg, Stimmen bleiben
  s = await api("tts/remove", {});
  ok("removed", !s.installed && !fs.existsSync(path.join(dir, "tts", "python")) && !fs.existsSync(path.join(dir, "tts", "qwen3")) && s.voices.length === 4, s);
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  child.stdin.end();
  await new Promise(r => child.once("exit", r));
}
console.log(JSON.stringify(out, null, 1));
