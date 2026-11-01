// Vorlesen (Qwen3-TTS im Helper, Speech.cs) über einen Test-Helper: node ttstest.mjs <exe> <datenordner> <netport> <webport> <ausgabeordner>
// Der Datenordner braucht das Suchmodell, tts/stimmen/<name>.wav + .txt und in settings.json ttsPython (python.exe mit den Paketen),
// ttsEngineDir (Engine mit Modell) und ttsPort – oder eine Einrichtung über ttsinstall.mjs. Die erzeugten Sätze landen als WAV
// im Ausgabeordner (zum Anhören).
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import fs from "node:fs";
const S = new URL("../../novabird-search/semantic/", import.meta.url).href;
// wie im Add-on: Kopplungscode und Verschlüsselung für den Helper aus shared/nbnet.js (vor server.js)
globalThis.nbNet = (await import(new URL("../../shared/nbnet.js", import.meta.url).href)).default;
const server = await import(S + "server.js");
const [exe, dir, netPort, webPort, outDir] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const out = {};
const ok = (name, cond, info) => { out[name] = cond ? "ok" : { fail: info }; };

const child = spawn(exe, ["--server-console", "--loopback"], { env: { ...process.env, NOVABIRD_HELPER_DIR: dir, NOVABIRD_NET_PORT: netPort, NOVABIRD_WEB_PORT: webPort } });
child.stderr.on("data", () => {});
const lines = createInterface({ input: child.stdout });
const start = await new Promise(r => lines.once("line", l => r(JSON.parse(l))));
const C = { type: "nbhelper", url: `http://127.0.0.1:${netPort}`, code: start.code, clientId: "ttsclient01", label: "TTS-Test" };
const dur = b64 => { const b = Buffer.from(b64, "base64"); return (b.length - 44) / 48000; };
try {
  const hello = await server.netCall(C, "hello", {});
  ok("helloSpeech", hello.speech?.available === true && hello.speech.voices.length === 4, hello.speech);
  ok("notRunningYet", hello.speech?.running === false, hello.speech);

  // Erster Satz: startet den Dienst (Kaltstart)
  let t = Date.now();
  let r = await server.netCall(C, "tts", { text: "Hallo, hier ist die Zusammenfassung deiner Mails.", lang: "german" });
  const cold = Date.now() - t;
  fs.writeFileSync(`${outDir}/0-kaltstart.wav`, Buffer.from(r.wav, "base64"));
  ok("coldStart", r.wav && dur(r.wav) > 1, { cold, dur: dur(r.wav) });
  out.coldMs = cold;

  const SAETZE = [
    ["german", "ruhig", "Herr Becker bittet um einen Termin für die Abnahme der Heizungsanlage."],
    ["german", "ruhig", "Er schlägt Dienstag, den vierten November, um zehn Uhr vor."],
    ["german", "ruhig", "Die Rechnung über 1.240 Euro ist bis Ende des Monats fällig."],
    ["german", "abenteuer", "Bitte bestätige den Termin oder nenne zwei Alternativen."],
    ["english", "", "Mr. Becker asks for an appointment to inspect the heating system next Tuesday at ten."],
    ["english", "en_adventure", "Please confirm or suggest two other dates."],
    ["french", "", "Monsieur Becker demande un rendez-vous mardi prochain à dix heures."], // englische Stimme, französisch gesprochen
  ];
  out.saetze = [];
  for (const [i, [lang, voice, text]] of SAETZE.entries()) {
    t = Date.now();
    r = await server.netCall(C, "tts", { text, lang, voice });
    const ms = Date.now() - t;
    fs.writeFileSync(`${outDir}/${i + 1}-${voice || lang}.wav`, Buffer.from(r.wav, "base64"));
    out.saetze.push(`${lang} ${voice || "(Standard)"}: Netz ${ms} ms, Helper ${r.ms} ms, Ton ${dur(r.wav).toFixed(2)} s`);
  }
  ok("allSentences", out.saetze.length === SAETZE.length);

  // Gleichzeitig zwei Anfragen (zweiter PC): beide kommen an, nacheinander gerechnet
  t = Date.now();
  const [a, b] = await Promise.all([
    server.netCall(C, "tts", { text: "Erster Satz von PC eins.", lang: "german" }),
    server.netCall({ ...C, clientId: "ttsclient02", label: "TTS-Test-2" }, "tts", { text: "Zweiter Satz von PC zwei.", lang: "german" }),
  ]);
  ok("parallel", a.wav && b.wav, null);
  out.parallelMs = Date.now() - t;

  // Fehlerfälle
  try { await server.netCall(C, "tts", { text: "   ", lang: "german" }); out.emptyText = { fail: "angenommen" }; }
  catch (e) { ok("emptyText", /kein Text/.test(e.message), e.message); }
  r = await server.netCall(C, "tts", { text: "Stimme gibt es nicht.", lang: "german", voice: "../../win" });
  ok("badVoiceFallsBack", dur(r.wav) > 0.5, null);
  r = await server.netCall(C, "tts", { text: "Unbekannte Sprache wird Deutsch.", lang: "klingon" });
  ok("badLangGerman", dur(r.wav) > 0.5, null);
  t = Date.now();
  r = await server.netCall(C, "tts", { text: "Sehr langer Text. ".repeat(80), lang: "german" });
  ok("longTextCut", dur(r.wav) < 60, { dur: dur(r.wav), ms: Date.now() - t });

  // Dienst nur mit Schlüssel: direkter Aufruf ohne X-NB-Token
  const ttsPort = JSON.parse(fs.readFileSync(`${dir}/settings.json`, "utf8")).ttsPort;
  const direct = await fetch(`http://127.0.0.1:${ttsPort}/tts`, { method: "POST", body: JSON.stringify({ text: "x" }) }).then(x => x.status).catch(e => e.message);
  ok("directNeedsToken", direct === 403, direct);

  const hello2 = await server.netCall(C, "hello", {});
  ok("runningAfter", hello2.speech?.running === true, hello2.speech);
} catch (e) {
  out.error = String(e.stack || e);
} finally {
  child.stdin.end();
  await new Promise(r => child.once("exit", r));
  // Dienst muss mit dem Helper enden (Job-Objekt)
  await new Promise(r => setTimeout(r, 1500));
  const ttsPort = JSON.parse(fs.readFileSync(`${dir}/settings.json`, "utf8")).ttsPort;
  const after = await fetch(`http://127.0.0.1:${ttsPort}/health`).then(x => x.status).catch(() => "weg");
  ok("serviceEndsWithHelper", after === "weg", after);
}
console.log(JSON.stringify(out, null, 1));
