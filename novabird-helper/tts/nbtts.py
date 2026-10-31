"""Vorlesen für den NovaBird Helper (Speech.cs): Qwen3-TTS als kleiner HTTP-Dienst, nur auf 127.0.0.1.

Läuft mit dem Python der Engine (HaujetZhao/Qwen3-TTS-GGUF: Talker/Predictor per llama.cpp/Vulkan, Decoder ONNX auf der CPU):
    <engine>/.venv/Scripts/python.exe -I -X utf8 nbtts.py --dir <engine> --port 47534 --ref stimme.wav --ref-text "…"
Schlüssel in der Umgebung (NB_TTS_TOKEN); ohne passenden Kopf X-NB-Token antwortet der Dienst 403.

GET  /health  → 200, sobald Modell und Stimme geladen sind
POST /tts     {"text": "...", "lang": "german"|"english"|… (LANGS), "ref": "…wav", "ref_text": "…"} → audio/wav (24 kHz mono, 16 bit)
Ein Satz nach dem anderen; der Helper teilt nichts, Thunderbird schickt Satz für Satz.
Nach dem Vorbild von c4bridge/tts_qwen.py.
"""
import argparse
import hmac
import io
import json
import os
import sys
import threading
import time
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import numpy as np

MAX_CHARS = 600
LANGS = ("german", "english", "french", "spanish", "italian", "portuguese", "russian", "chinese", "japanese", "korean")


class _Sink:
    """Ersetzt die Abspiel-Warteschlange der Engine: nicht am Helper-PC abspielen, nur sammeln."""
    def put(self, *_a, **_k):
        pass


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", required=True)
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--ref", required=True)
    ap.add_argument("--ref-text", default="")
    ap.add_argument("--model", default="model-base-small")
    a = ap.parse_args()
    token = os.environ.get("NB_TTS_TOKEN", "")
    if len(token) < 16:
        sys.exit("NB_TTS_TOKEN fehlt")

    os.chdir(a.dir)
    sys.path.insert(0, a.dir)
    from qwen3_tts_gguf.inference import TTSEngine, TTSConfig

    t0 = time.time()
    engine = TTSEngine(model_dir=a.model, onnx_provider="CPU", verbose=False)
    if getattr(engine, "decoder", None) is not None and hasattr(engine.decoder, "play_q"):
        engine.decoder.play_q = _Sink()
    stream = engine.create_stream()
    stream.set_voice(a.ref, a.ref_text or None)
    lock = threading.Lock()
    state = {"ready": False, "ref": os.path.abspath(a.ref)}

    def synth(text, lang, ref="", ref_text=""):
        cfg = TTSConfig(max_steps=min(600, 40 + 12 * len(text) // 5), temperature=0.7, sub_temperature=0.7, streaming=True)
        with lock:
            if ref and os.path.abspath(ref) != state["ref"] and os.path.isfile(ref):
                t = time.time()
                stream.reset()                     # Zwischenspeicher der alten Stimme leeren
                if stream.set_voice(ref, ref_text or None):
                    state["ref"] = os.path.abspath(ref)
                    print(f"stimme {os.path.basename(ref)} in {time.time() - t:.1f}s", flush=True)
            r = stream.clone(text=text, language=lang, config=cfg)
            stream.join()
            if len(text) > 3 and (r is None or r.audio is None or len(r.audio) < 2400):
                print(f"leer, wiederhole ({len(text)} Zeichen)", flush=True)   # kein Text im Protokoll
                r = stream.clone(text=text, language=lang, config=cfg)
                stream.join()
        audio = np.asarray(r.audio if r is not None and r.audio is not None else np.zeros(2400), dtype=np.float32)
        pcm = (np.clip(audio, -1, 1) * 32767).astype(np.int16).tobytes()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(24000)
            w.writeframes(pcm)
        return buf.getvalue()

    synth("Hallo.", "german")                      # aufwärmen (erster Satz baut Shader/Graph)
    state["ready"] = True
    print(f"bereit nach {time.time() - t0:.1f}s auf Port {a.port}", flush=True)

    class H(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def _send(self, code, body=b"", ctype="application/json"):
            self.send_response(code)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def _authorized(self):
            return hmac.compare_digest(self.headers.get("X-NB-Token", ""), token)

        def do_GET(self):
            if not self._authorized():
                return self._send(403)
            ok = self.path == "/health" and state["ready"]
            self._send(200 if ok else 503, b"{}" if ok else b"")

        def do_POST(self):
            if not self._authorized():
                return self._send(403)
            if self.path != "/tts":
                return self._send(404)
            try:
                n = int(self.headers.get("Content-Length") or 0)
                if n > 64 * 1024:
                    raise ValueError("zu groß")
                body = json.loads(self.rfile.read(n) or b"{}")
                text = str(body.get("text") or "").strip()[:MAX_CHARS]
                if not text:
                    raise ValueError("kein Text")
                lang = str(body.get("lang") or "german")
                if lang not in LANGS:
                    raise ValueError("Sprache")
                t = time.time()
                data = synth(text, lang, str(body.get("ref") or ""), str(body.get("ref_text") or ""))
                print(f"tts {time.time() - t:.2f}s {len(text)} Zeichen", flush=True)
                self._send(200, data, "audio/wav")
            except Exception as e:  # noqa: BLE001
                self._send(500, str(e).encode("utf-8", "replace"), "text/plain")

    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
