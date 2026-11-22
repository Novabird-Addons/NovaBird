// Vorlesen für externe Programme (WebServer.ExtApi.cs): node extspeech.mjs <exe> <datenordner> <ausgabeordner>
// Datenordner wie bei ttstest.mjs: tts/stimmen mit ruhig/abenteuer/en_calm/en_adventure (.wav + .txt), settings.json mit
// ttsPython, ttsEngineDir, ttsPort 47644, ttsEnabled true, ttsKeep "-1"; mit oder ohne Ollama (ollamaEnabled, ollamaPort).
// Ports 47641/47642. Prüft Freigaben je Schlüssel (auch alte Einträge ohne Angabe), Stimmen, WAV, Zerlegung, Fehlerfälle,
// Vorladen bei „immer“ und das Vorlesen der Web-Oberfläche ohne Stimme.
import { spawn, execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createHash } from "node:crypto";
import { writeFileSync, readFileSync, existsSync } from "node:fs";
const [exe, dir, outDir] = process.argv.slice(2);
const web = 47642, net = 47641, ttsPort = 47644;
const base = `http://127.0.0.1:${web}`;
const out = { checks: {}, times: {} };
const check = (n, ok, info) => (out.checks[n] = { ok: !!ok, info });
const sleep = ms => new Promise(r => setTimeout(r, ms));
// alter Eintrag (vor 0.5.4, ohne llm/tts): darf nur das Sprachmodell
const oldKey = "nbh-alter-testschluessel-ohne-freigaben-000001";
writeFileSync(`${dir}/apikeys.json`, JSON.stringify([{ id: "0ld00001", name: "alt", hash: createHash("sha256").update(oldKey).digest("hex").toUpperCase(), prefix: "nbh-alte…", created: "2026-01-01 00:00", ips: [], uses: 0 }]));
const ttsLog = `${dir}\\tts\\tts.log`;
const pieces = () => (existsSync(ttsLog) ? (readFileSync(ttsLog, "utf8").match(/^tts [\d.]+s \d+ Zeichen/gm) ?? []).length : 0);
const t0 = Date.now();
const child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: String(net), NOVABIRD_WEB_PORT: String(web), NOVABIRD_DISCOVERY_PORT: "-1", NOVABIRD_TEST_NOMODEL: "1" } });
child.stderr.on("data", () => {});
await new Promise(r => createInterface({ input: child.stdout }).once("line", r));
const H = { "Content-Type": "application/json", Origin: base };
let cookie = "", csrf = "";
const api = async (path, body) => {
  const r = await fetch(`${base}/api/${path}`, { method: body ? "POST" : "GET", headers: { ...H, Cookie: cookie, "X-CSRF": csrf }, body: body && JSON.stringify(body) });
  const sc = r.headers.get("set-cookie"); if (sc) cookie = sc.split(";")[0];
  const buf = Buffer.from(await r.arrayBuffer()); let j = null; try { j = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, j, t: buf.toString(), buf, type: r.headers.get("content-type") };
};
const v1 = async (key, path, body, method) => {
  const t = Date.now();
  const r = await fetch(`${base}/v1/${path}`, { method: method ?? (body ? "POST" : "GET"), headers: { "Content-Type": "application/json", ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: body && JSON.stringify(body) });
  const buf = Buffer.from(await r.arrayBuffer());
  let j = null; try { j = JSON.parse(buf.toString()); } catch {}
  return { status: r.status, type: r.headers.get("content-type"), voice: r.headers.get("x-voice"), buf, j, ms: Date.now() - t };
};
const wavInfo = b => {
  if (b.length < 44 || b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WAVE") return null;
  const rate = b.readUInt32LE(24), ch = b.readUInt16LE(22), bits = b.readUInt16LE(34), dataLen = b.readUInt32LE(40);
  return { rate, ch, bits, dataLen, ok: b.toString("ascii", 36, 40) === "data" && dataLen === b.length - 44 && b.readUInt32LE(4) === b.length - 8, sec: +(dataLen / (rate * 2)).toFixed(2) };
};
try {
  let s = await api("setup", { name: "admin", password: "Ext-Test-Passwort-1" });
  if (s.status !== 200) s = await api("login", { name: "admin", password: "Ext-Test-Passwort-1" });
  csrf = s.j?.csrf ?? "";
  check("angemeldet", !!csrf, s.status);
  let running = false;
  for (let i = 0; i < 120 && !running; i++) { running = (await api("tts")).j?.running; if (!running) await sleep(500); }
  check("immer: beim Start vorgeladen", running, Date.now() - t0);
  for (let i = 0; i < 240; i++) { if (existsSync(ttsLog) && /bereit nach/.test(readFileSync(ttsLog, "utf8"))) break; await sleep(500); }
  out.times.readyMs = Date.now() - t0;
  const settings = JSON.parse(readFileSync(`${dir}/settings.json`, "utf8"));
  let ext = await api("ext/settings", { enabled: true });
  check("Externe Programme an", ext.j?.enabled === true);
  let ollama = false;
  for (let i = 0; settings.ollamaEnabled && i < 60 && !ollama; i++) { ollama = (await api("ext")).j?.ollamaRunning; if (!ollama) await sleep(500); }
  out.ollama = ollama;
  const add = async (name, llm, tts) => api("ext/keys/add", { name, ips: "", llm, tts });
  const kLlm = (await add("nur-llm", true, false)).j?.newKey;
  const ttsAdd = await add("nur-tts", false, true);
  const kTts = ttsAdd.j?.newKey;
  const kBoth = (await add("beides", true, true)).j?.newKey;
  const none = await add("nichts", false, false);
  check("Schlüssel ohne Freigabe abgelehnt", none.status === 400, none.status);
  const row = n => ttsAdd.j?.keys?.find(k => k.name === n);
  check("Liste zeigt Freigaben (neu + alt)", row("nur-tts")?.tts === true && row("nur-tts")?.llm === false && row("alt")?.llm === true && row("alt")?.tts === false && ttsAdd.j.ttsAvailable === true, [row("nur-tts"), row("alt")]);

  let r = await v1(kTts, "models");
  check("nur-tts: /v1/models = nur qwen3-tts", r.status === 200 && r.j?.data?.length === 1 && r.j.data[0].id === "qwen3-tts", [r.status, r.j]);
  r = await v1(kTts, "chat/completions", { messages: [{ role: "user", content: "x" }] });
  check("nur-tts: Chat verboten (403)", r.status === 403, r.status);
  r = await v1(kTts, "embeddings", { input: "x" });
  check("nur-tts: Embeddings verboten (403)", r.status === 403, r.status);
  r = await v1(kLlm, "audio/speech", { input: "Hallo." });
  check("nur-llm: Vorlesen verboten (403)", r.status === 403, r.status);
  r = await v1(kLlm, "audio/voices");
  check("nur-llm: Stimmen verboten (403)", r.status === 403, r.status);
  r = await v1(oldKey, "audio/speech", { input: "Hallo." });
  check("alter Schlüssel: Vorlesen verboten (403)", r.status === 403, r.status);
  r = await v1(kLlm, "models");
  check(`nur-llm: /v1/models wie bisher (${ollama ? "Ollama-Liste ohne qwen3-tts" : "ohne Ollama 503"})`, ollama ? r.status === 200 && r.j?.data?.length > 0 && !r.j.data.some(m => m.id === "qwen3-tts") : r.status === 503, [r.status, r.j?.data?.map(m => m.id)]);
  r = await v1(oldKey, "models");
  check("alter Schlüssel: /v1/models wie bisher", ollama ? r.status === 200 : r.status === 503, r.status);
  r = await v1(kBoth, "models");
  check(`beides: /v1/models ${ollama ? "Ollama + qwen3-tts" : "qwen3-tts"}`, r.status === 200 && r.j?.data?.some(m => m.id === "qwen3-tts") && (!ollama || r.j.data.length > 1), r.j?.data?.map(m => m.id));
  r = await v1("nbh-falsch", "audio/speech", { input: "Hallo." });
  check("falscher Schlüssel 401", r.status === 401, r.status);
  r = await v1(kTts, "audio/voices");
  check("Stimmen", r.status === 200 && r.j?.voices?.length === 4 && r.j.default?.german === "ruhig" && r.j.default?.english === "en_calm", r.j);
  r = await v1(kTts, "audio/speech", null, "GET");
  check("GET speech → 405", r.status === 405, r.status);

  // Sprechen
  let p0 = pieces();
  r = await v1(kTts, "audio/speech", { model: "qwen3-tts", input: "Hallo, hier spricht der NovaBird Helper.", voice: "ruhig", language: "german", response_format: "wav" });
  let w = wavInfo(r.buf);
  out.times.firstSentenceMs = r.ms;
  check("erster Satz: WAV 24 kHz mono 16 bit, unter 8 s", r.status === 200 && r.type === "audio/wav" && w?.ok && w.rate === 24000 && w.ch === 1 && w.bits === 16 && w.sec > 1 && r.voice === "ruhig" && r.ms < 8000, [r.status, w, r.voice, r.ms]);
  writeFileSync(`${outDir}/satz1.wav`, r.buf);
  p0 = pieces();
  r = await v1(kTts, "audio/speech", { input: "Am 3. Mai bringt z. B. Dr. Müller die Unterlagen: alles, was wir brauchen; auch die Pläne.", voice: "ruhig" });
  writeFileSync(`${outDir}/abkuerzungen.wav`, r.buf);
  check("Satz mit Abkürzungen, Datum, Doppelpunkt: ein Stück", r.status === 200 && pieces() - p0 === 1, [r.status, pieces() - p0, r.ms]);
  r = await v1(kTts, "audio/speech", { input: "Good evening, this is the helper speaking.", voice: "en_calm" });
  w = wavInfo(r.buf);
  out.times.voiceSwitchMs = r.ms;
  check("Stimmwechsel en_calm, Sprache aus Stimme", r.status === 200 && w?.ok && w.sec > 1 && r.voice === "en_calm", [r.status, w, r.ms]);
  writeFileSync(`${outDir}/en_calm.wav`, r.buf);
  r = await v1(kTts, "audio/speech", { model: "tts-1", input: "Noch ein kurzer Satz.", voice: "alloy", speed: 1 });
  check("OpenAI-Stimme alloy → Standard (ruhig), speed 1", r.status === 200 && r.voice === "ruhig", [r.status, r.voice, r.ms]);
  r = await v1(kTts, "audio/speech", { input: "Hallo, hier spricht der NovaBird Helper etwas schneller.", voice: "abenteuer", language: "german", response_format: "wav", speed: 1.3 });
  w = wavInfo(r.buf);
  out.times.speed13Ms = r.ms;
  check("speed 1.3 (Bridge-Anfrage): WAV", r.status === 200 && w?.ok && w.rate === 24000 && w.sec > 1 && r.voice === "abenteuer", [r.status, w, r.ms]);
  writeFileSync(`${outDir}/speed13.wav`, r.buf);
  const long = "Der Helper liest jetzt einen längeren Text vor. Er besteht aus mehreren Sätzen, damit die Zerlegung geprüft wird! " +
    "Kommt alles an? Zwischen den Sätzen soll nichts fehlen; auch Doppelpunkte trennen nicht: so wie hier.\nEine neue Zeile ist ein Ende. " +
    "Und ein sehr langer Satz ohne Punkt, der mit vielen Kommas weitergeht, damit er über sechshundert Zeichen kommt, " + "und noch weiter, ".repeat(30) + "bis er endlich aufhört.";
  p0 = pieces();
  r = await v1(kTts, "audio/speech", { input: long, voice: "ruhig" });
  w = wavInfo(r.buf);
  out.times.longMs = r.ms;
  const n = pieces() - p0;
  check(`langer Text (${long.length} Zeichen) → ein WAV, ${n} Stücke`, r.status === 200 && w?.ok && w.sec > 20 && n >= 3 && n <= 5, [r.status, w, n, r.ms]);
  writeFileSync(`${outDir}/lang.wav`, r.buf);
  // Vorlesen der Web-Oberfläche (wie Thunderbird über Say) ohne Stimme: eingestellte Stimme
  const tt = await api("tts/test", { text: "Probe ohne Stimme.", lang: "german" });
  check("Web-Hörprobe ohne Stimme", tt.status === 200 && tt.type === "audio/wav" && wavInfo(tt.buf)?.ok, [tt.status, tt.type]);
  // Fehler
  const bad = async (name, body) => { const x = await v1(kTts, "audio/speech", body); check(name, x.status === 400 && x.j?.error?.message, [x.status, x.j?.error?.message]); };
  await bad("unbekannte Stimme sophie → 400 mit Liste", { input: "Hallo.", voice: "sophie" });
  await bad("mp3 → 400", { input: "Hallo.", response_format: "mp3" });
  await bad("speed 3 → 400", { input: "Hallo.", speed: 3 });
  await bad("speed 0.3 → 400", { input: "Hallo.", speed: 0.3 });
  await bad("speed als Text → 400", { input: "Hallo.", speed: "schnell" });
  await bad("stream → 400", { input: "Hallo.", stream: true });
  await bad("Text zu lang → 400", { input: "a".repeat(5001) });
  await bad("ohne input → 400", { voice: "ruhig" });
  await bad("fremdes Modell → 400", { model: "gpt-4o", input: "Hallo." });
  await bad("unbekannte Sprache → 400", { input: "Hallo.", language: "klingon" });
  await bad("kein JSON-Objekt → 400", [1, 2]);
} catch (e) { out.error = String(e.stack); }
child.stdin.end();
await Promise.race([new Promise(r => child.once("exit", r)), sleep(15000)]);
await sleep(1500);
try { execSync(`powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${ttsPort} -State Listen -EA Stop"`, { stdio: "pipe" }); check("TTS-Dienst beendet", false); } catch { check("TTS-Dienst beendet", true); }
out.pass = Object.values(out.checks).every(c => c.ok);
console.log(JSON.stringify(out, null, 1));
