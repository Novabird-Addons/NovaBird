#!/usr/bin/env python3
"""Legt die Laufzeit der semantischen Suche nach novabird-search/semantic/lib (nicht in Git, siehe .gitignore).

  tools/vendor-semantic.py                 prüft die Dateien; fehlende werden von cdn.jsdelivr.net geladen
  tools/vendor-semantic.py --from DIR      nimmt die Dateien aus DIR (z. B. einem früheren Download)

Jede Datei wird mit der hier festgelegten SHA-256-Prüfsumme verglichen; passt eine nicht, bricht das Skript ab.
transformers.js 4.3.1 (Apache-2.0) und onnxruntime-web in der Version, die transformers.js 4.3.1 angibt (MIT).
"""
import argparse, hashlib, os, shutil, sys, urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LIB = os.path.join(ROOT, "novabird-search", "semantic", "lib")
TJS = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1/dist/"
ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.31.0-dev.20260914-8d85527a0/dist/"
FILES = {
    "transformers.min.js": (TJS, "8d6716d9086f57c30a4bf367dba61b887593573c770c454465e8019b2703e743"),
    "ort-wasm-simd-threaded.asyncify.mjs": (ORT, "0966b6105cd936744498aa60df7a22cbd47af3374dbc64a9ab561c08a71e3611"),
    "ort-wasm-simd-threaded.asyncify.wasm": (ORT, "49871f5a4409519797e127440868a6d1923339d9185907f301a5b2a1d90af082"),
}


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--from", dest="src", metavar="DIR")
    a = ap.parse_args()
    os.makedirs(LIB, exist_ok=True)
    for name, (base, want) in FILES.items():
        dst = os.path.join(LIB, name)
        if os.path.isfile(dst) and sha256(dst) == want:
            continue
        if a.src:
            shutil.copyfile(os.path.join(a.src, name), dst)
        else:
            print("lade", base + name)
            with urllib.request.urlopen(base + name, timeout=120) as r, open(dst, "wb") as f:
                shutil.copyfileobj(r, f)
        got = sha256(dst)
        if got != want:
            os.remove(dst)
            sys.exit(f"Prüfsumme falsch: {name} ({got})")
    print("Laufzeit vollständig:", LIB)


if __name__ == "__main__":
    main()
