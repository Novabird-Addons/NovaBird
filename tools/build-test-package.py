#!/usr/bin/env python3
"""Baut ein Testpaket (nicht veröffentlicht) mit allen Add-ons – jede XPI mit eigener Build-Nummer als vierter Stelle der
Version (z. B. 2.0.0.611052130), damit Thunderbird jedes Testpaket sicher als Update erkennt und ersetzt.

  tools/build-test-package.py [--notes notizen.txt] [--helper <Ordner NovaBird-Helper-x.y.z>] [--keep 3]

Ziel: ../builds/test/aktuell/NovaBird-2.0-Test-<Datum><Buchstabe>/ (nächster freier Buchstabe des Tages), dazu
NovaBird-2.0-XPIs-<Datum><Buchstabe>.zip mit allen XPIs. Ohne --helper wird der Helper-Ordner aus dem jüngsten
Testpaket übernommen. Ältere Testpakete werden gelöscht, nur die letzten --keep bleiben (Standard 3).
Quellen bleiben unverändert: die Build-Nummer steht nur in der manifest.json im Paket.

Build-Nummer: J MM TT hh mm mit J = Jahr − 2020 (eine Stelle; bleibt unter 2^31 und wächst bis 2029 stetig).
"""
import argparse
import datetime
import glob
import importlib.util
import json
import os
import shutil
import string
import sys
import tempfile
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEST = os.path.normpath(os.path.join(ROOT, "..", "builds", "test", "aktuell"))

spec = importlib.util.spec_from_file_location("publish_updates", os.path.join(ROOT, "tools", "publish-updates.py"))
pu = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pu)


def stamp(now):
    return f"{now.year - 2020}{now:%m%d%H%M}"


def restamp(xpi, out, build):
    """XPI kopieren, dabei nur die Version in manifest.json um die Build-Nummer ergänzen."""
    with zipfile.ZipFile(xpi) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for item in zin.infolist():
            data = zin.read(item.filename)
            if item.filename == "manifest.json":
                m = json.loads(data.decode("utf-8"))
                base = ".".join(m["version"].split(".")[:3])
                m["version"] = f"{base}.{build}"
                data = (json.dumps(m, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
                version = m["version"]
            zout.writestr(item, data)
    return version


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", help="Text für LIESMICH.txt (was ist neu)")
    ap.add_argument("--helper", help="Ordner des Helpers (sonst aus dem jüngsten Testpaket)")
    ap.add_argument("--keep", type=int, default=3)
    a = ap.parse_args()

    now = datetime.datetime.now()
    build = stamp(now)
    day = now.strftime("%Y-%m-%d")
    letter = next(c for c in string.ascii_lowercase if not glob.glob(os.path.join(DEST, f"NovaBird-2.0-Test-{day}{c}*")) and not glob.glob(os.path.join(DEST, "*", f"NovaBird-2.0-XPIs-{day}{c}.zip")))
    name = f"{day}{letter}"
    previous = sorted((d for d in glob.glob(os.path.join(DEST, "NovaBird-2.0-Test-*")) if os.path.isdir(d)), key=os.path.getmtime)
    out_dir = os.path.join(DEST, f"NovaBird-2.0-Test-{name}")
    os.makedirs(out_dir)

    rows = []
    with tempfile.TemporaryDirectory() as tmp:
        for addon in pu.ADDONS:
            raw, m, _ = pu.build_addon(addon, tmp)
            target = os.path.join(out_dir, os.path.basename(raw))
            version = restamp(raw, target, build)
            rows.append((os.path.basename(target), version))

    helper = a.helper or next((h for d in reversed(previous) for h in glob.glob(os.path.join(d, "NovaBird-Helper-*")) if os.path.isdir(h)), None)
    if helper:
        shutil.copytree(helper, os.path.join(out_dir, os.path.basename(helper)))

    with zipfile.ZipFile(os.path.join(out_dir, f"NovaBird-2.0-XPIs-{name}.zip"), "w", zipfile.ZIP_DEFLATED) as z:
        for f, _ in rows:
            z.write(os.path.join(out_dir, f), f)

    notes = open(a.notes, encoding="utf-8").read().rstrip() + "\n\n" if a.notes else ""
    commit = pu.git("rev-parse", "--short", "HEAD")
    dirty = " + lokale Änderungen" if pu.git("status", "--porcelain", "--untracked-files=no") else ""
    with open(os.path.join(out_dir, "LIESMICH.txt"), "w", encoding="utf-8") as f:
        title = f"NovaBird 2.0 – Testpaket {name} (Stand {commit}{dirty}, nicht veröffentlicht)"
        f.write(f"{title}\n{'=' * len(title)}\n\n{notes}Inhalt\n")
        for fn, v in rows:
            f.write(f"  {fn:34} Version {v}\n")
        if helper:
            f.write(f"  {os.path.basename(helper) + chr(92):34} Helper (unverändert übernommen)\n" if not a.helper else f"  {os.path.basename(helper) + chr(92):34} Helper\n")
        f.write("\nInstallieren\n  Add-ons: Thunderbird → Add-ons → Zahnrad → „Add-on aus Datei installieren“, je XPI.\n"
                "  Jede XPI trägt eine eigene Build-Nummer (letzte Stelle der Version): Thunderbird ersetzt damit sicher die vorherige.\n")

    # nur die letzten --keep Testpakete behalten
    all_dirs = sorted((d for d in glob.glob(os.path.join(DEST, "NovaBird-2.0-Test-*")) if os.path.isdir(d)), key=os.path.getmtime)
    for old in all_dirs[: max(0, len(all_dirs) - a.keep)]:
        shutil.rmtree(old)
        print("gelöscht:", os.path.basename(old))
    print(out_dir)
    for fn, v in rows:
        print(f"  {fn:34} {v}")


if __name__ == "__main__":
    sys.exit(main())
