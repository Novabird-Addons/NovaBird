#!/usr/bin/env python3
"""Baut ein Add-on für Tests als XPI (gleicher Inhalt wie build.sh, aber mit frei wählbarem Ziel):

  tools/tbtest/build.py novabird-search out/novabird-search.xpi [--root <anderer Checkout, z. B. Branch testing>]

Für NovaBird-Search wird vorher die Laufzeit der semantischen Suche geprüft bzw. geholt (tools/vendor-semantic.py).
"""
import os
import re
import shlex
import subprocess
import sys
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def add(z, base, rel):
    p = os.path.join(base, rel)
    if os.path.isdir(p):
        for d, dirs, files in os.walk(p):
            dirs.sort()
            for f in sorted(files):
                fp = os.path.join(d, f)
                z.write(fp, os.path.relpath(fp, base).replace(os.sep, "/"))
    else:
        z.write(p, rel)


def build(name, out, root=ROOT):
    src = os.path.join(root, name)
    sh = open(os.path.join(src, "build.sh"), encoding="utf-8").read()
    if "vendor-semantic.py" in sh:
        subprocess.run([sys.executable, os.path.join(root, "tools", "vendor-semantic.py")], check=True, stdout=subprocess.DEVNULL)
    own = re.search(r'^zip -r -q "\$OUT" (.+)$', sh, re.M).group(1)
    shared = re.search(r'^\(cd \.\. && zip -q "\$OUT" (.+)\)$', sh, re.M)
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in shlex.split(own):
            add(z, src, rel)
        for rel in shlex.split(shared.group(1)) if shared else []:
            add(z, root, rel)
    return out


if __name__ == "__main__":
    args = sys.argv[1:]
    root = ROOT
    if "--root" in args:
        i = args.index("--root")
        root = os.path.abspath(args[i + 1])
        del args[i:i + 2]
    print(build(args[0], args[1], root))
