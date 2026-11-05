"use strict";

/* Vorlesen im Hintergrund: Die Hintergrundseite holt Satz für Satz vom NovaBird Helper (Qwen3-TTS auf seiner Grafikkarte) und
 * spielt ab. So liest Thunderbird weiter, wenn das Popup zugeht; beim erneuten Öffnen zeigt der Knopf „Stopp“.
 * Der nächste Satz wird geholt, während der vorige läuft (der Helper rechnet etwa 4-mal so schnell, wie gesprochen wird),
 * höchstens 20 s voraus. Ein AudioContext je Vorlesen; die Sätze liegen lückenlos mit kurzer Pause hintereinander.
 * Popup und eigenes Fenster verbinden sich über runtime.connect("nbx-speech"): {type:"speak", key, text, lang, follow} / {type:"stop"};
 * follow: Vorlesen beginnt, während die KI noch schreibt, und folgt dem Auftrag key in ai/jobs.js Satz für Satz.
 * zurück kommt {type:"speech", key, status:"idle"|"loading"|"playing", error:{key, text}}. */
// Tempo ohne andere Tonhöhe (WSOLA): Stücke von 40 ms werden mit einem anderen Abstand aus dem Ton genommen, als sie
// hineingelegt werden; jedes Stück wird dort genommen, wo es am besten an das vorige anschließt (Kreuzkorrelation).
// rate > 1 schneller. Auch für Tests in Node (ohne Thunderbird) nutzbar.
function nbStretch(input, rate, sampleRate = 24000) {
  if (!(rate > 0) || Math.abs(rate - 1) < 0.01 || input.length < 4096) return input;
  const N = Math.round(sampleRate * 0.04) & ~1; // Stücklänge
  const Hs = N / 2; // Abstand beim Hineinlegen
  const Ha = Hs * rate; // Abstand beim Herausnehmen
  const tol = Math.round(sampleRate * 0.008); // Suchbereich ±8 ms
  const win = new Float32Array(N);
  for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N);
  const outLen = Math.ceil(input.length / rate) + N;
  const out = new Float32Array(outLen);
  const norm = new Float32Array(outLen);
  let prev = 0; // Beginn des zuletzt genommenen Stücks
  for (let k = 0, outPos = 0; ; k++, outPos += Hs) {
    const ideal = Math.round(k * Ha);
    if (ideal + N + tol >= input.length || outPos + N >= outLen) break;
    let best = ideal;
    if (k > 0) {
      // natürliche Fortsetzung des vorigen Stücks: prev + Hs; dazu passende Stelle um ideal suchen (jede 2. Probe)
      const ref = prev + Hs;
      let bestScore = -Infinity;
      for (let d = -tol; d <= tol; d += 2) {
        const p = ideal + d;
        if (p < 0) continue;
        let s = 0;
        for (let i = 0; i < N; i += 4) s += input[ref + i] * input[p + i];
        if (s > bestScore) {
          bestScore = s;
          best = p;
        }
      }
    }
    for (let i = 0; i < N; i++) {
      out[outPos + i] += input[best + i] * win[i];
      norm[outPos + i] += win[i];
    }
    prev = best;
  }
  let end = outLen;
  while (end > 0 && norm[end - 1] === 0) end--;
  const res = new Float32Array(end);
  for (let i = 0; i < end; i++) res[i] = norm[i] > 1e-3 ? out[i] / norm[i] : 0;
  return res;
}
if (typeof module !== "undefined") module.exports = { nbStretch };

(() => {
  if (typeof messenger === "undefined") return; // Node-Test
  const PAUSE_S = 0.25, AHEAD_S = 20, MAX_TEXT = 50_000;
  const ports = new Set();
  let reader = null;    // { key, ctx, abort, status }
  let lastError = null; // { key, text } – zum Text, der nicht vorgelesen werden konnte

  const view = () => ({ type: "speech", key: reader?.key || null, status: reader?.status || "idle", error: lastError });

  function publish() {
    for (const p of ports) {
      try {
        p.postMessage(view());
      } catch {
        ports.delete(p);
      }
    }
  }

  function stop() {
    if (!reader) return;
    reader.abort.abort();
    reader.ctx.close().catch(() => {});
    reader = null;
    publish();
  }

  // follow: Die KI schreibt den Text noch (ai/jobs.js). Gesprochen wird jeder fertige Satz sofort; der letzte Satz wartet,
  // bis danach etwas kommt oder der Auftrag fertig ist. sentences() ändert beim Wachsen nur den letzten Satz, die schon
  // gesprochenen bleiben gleich (kurze Sätze hängt es an den vorigen, der ist dann aber noch der letzte).
  async function speak(key, text, lang, follow = false) {
    stop();
    lastError = null;
    const ctx = new AudioContext();
    const me = (reader = { key, ctx, abort: new AbortController(), status: "loading" });
    publish();
    let at = 0;
    try {
      const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
      if (!conf.aiEnabled || conf.aiType !== "nbhelper") throw new Error("helper");
      const rate = nbAI.SPEECH_RATES.includes(Number(conf.aiSpeechRate)) ? Number(conf.aiSpeechRate) : 1; // Tempo (Einstellungen)
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      for (let spoken = 0; ; ) {
        let cur = text, done = true;
        const job = follow ? globalThis.nbJobs?.peek(key) : null;
        if (job) {
          cur = job.text || cur;
          done = job.status !== "running";
        }
        let all = nbAI.sentences(cur);
        // langen ersten Satz teilen (schneller der erste Ton) – erst wenn er fertig ist, sonst wanderte die Teilung mit
        if (done || all.length > 1) all = nbAI.quickStart(all);
        if (job && all.length + 1 < spoken) break; // Auftrag neu gestartet (Text wieder kürzer): nicht weiterlesen
        if (spoken >= (done ? all.length : all.length - 1)) {
          if (done) break;
          await new Promise(r => setTimeout(r, 200)); // auf den nächsten Satz der KI warten
          if (reader !== me) return;
          continue;
        }
        const sentence = all[spoken++];
        // nicht zu weit vorrechnen: der Helper bedient auch andere PCs
        while (reader === me && at - ctx.currentTime > AHEAD_S) await new Promise(r => setTimeout(r, 500));
        if (reader !== me) return;
        // Zahlen, Datum, Uhrzeit, Beträge und Abkürzungen ausgeschrieben (ai/spoken.js): sonst rät die Stimme
        const wav = await nbAI.speak(conf, nbSpoken.text(sentence, lang), lang, me.abort.signal);
        if (reader !== me) return;
        let buf = await ctx.decodeAudioData(wav);
        if (rate !== 1) {
          const y = nbStretch(buf.getChannelData(0), rate, buf.sampleRate);
          buf = new AudioBuffer({ length: y.length, sampleRate: buf.sampleRate, numberOfChannels: 1 });
          buf.copyToChannel(y, 0);
        }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        at = Math.max(at, ctx.currentTime + 0.05);
        src.start(at);
        at += buf.duration + PAUSE_S / rate;
        if (me.status !== "playing") {
          me.status = "playing";
          publish();
        }
      }
      // bis zum Ende des letzten Satzes warten
      while (reader === me && ctx.currentTime < at) await new Promise(r => setTimeout(r, 300));
      if (reader === me) stop();
    } catch (e) {
      if (reader !== me) return; // abgebrochen
      lastError = { key, text: String(e.message || e).replace(/^Error: /, "") };
      stop();
    }
  }

  messenger.runtime.onConnect.addListener(port => {
    if (port.name !== "nbx-speech" || port.sender?.id !== messenger.runtime.id) return;
    ports.add(port);
    port.postMessage(view());
    port.onMessage.addListener(msg => {
      if (msg?.type === "speak" && typeof msg.text === "string" && msg.text.length <= MAX_TEXT) {
        speak(String(msg.key || ""), msg.text, String(msg.lang || "en"), msg.follow === true);
      } else if (msg?.type === "stop") {
        stop();
      }
    });
    port.onDisconnect.addListener(() => ports.delete(port));
  });
})();
