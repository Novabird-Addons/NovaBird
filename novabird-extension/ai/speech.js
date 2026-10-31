"use strict";

/* Vorlesen im Hintergrund: Die Hintergrundseite holt Satz für Satz vom NovaBird Helper (Qwen3-TTS auf seiner Grafikkarte) und
 * spielt ab. So liest Thunderbird weiter, wenn das Popup zugeht; beim erneuten Öffnen zeigt der Knopf „Stopp“.
 * Der nächste Satz wird geholt, während der vorige läuft (der Helper rechnet etwa 4-mal so schnell, wie gesprochen wird),
 * höchstens 20 s voraus. Ein AudioContext je Vorlesen; die Sätze liegen lückenlos mit kurzer Pause hintereinander.
 * Popup und eigenes Fenster verbinden sich über runtime.connect("nbx-speech"): {type:"speak", key, text, lang} / {type:"stop"};
 * zurück kommt {type:"speech", key, status:"idle"|"loading"|"playing", error:{key, text}}. */
(() => {
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

  async function speak(key, text, lang) {
    stop();
    lastError = null;
    const ctx = new AudioContext();
    const me = (reader = { key, ctx, abort: new AbortController(), status: "loading" });
    publish();
    let at = 0;
    try {
      const conf = { ...nbAI.DEFAULTS, ...(await messenger.storage.local.get(nbAI.DEFAULTS)) };
      if (!conf.aiEnabled || conf.aiType !== "nbhelper") throw new Error("helper");
      if (ctx.state === "suspended") await ctx.resume().catch(() => {});
      for (const sentence of nbAI.sentences(text)) {
        // nicht zu weit vorrechnen: der Helper bedient auch andere PCs
        while (reader === me && at - ctx.currentTime > AHEAD_S) await new Promise(r => setTimeout(r, 500));
        if (reader !== me) return;
        const wav = await nbAI.speak(conf, sentence, lang, me.abort.signal);
        if (reader !== me) return;
        const buf = await ctx.decodeAudioData(wav);
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.connect(ctx.destination);
        at = Math.max(at, ctx.currentTime + 0.05);
        src.start(at);
        at += buf.duration + PAUSE_S;
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
        speak(String(msg.key || ""), msg.text, String(msg.lang || "en"));
      } else if (msg?.type === "stop") {
        stop();
      }
    });
    port.onDisconnect.addListener(() => ports.delete(port));
  });
})();
