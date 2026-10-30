#!/usr/bin/env python3
"""Baut <thema>/theme.css aus theme-light.css (Quelle, hell) und theme-dark.css (dunkel).
Das dunkle CSS gilt nur im Dunkelmodus des Betriebssystems (prefers-color-scheme: dark).
Aufruf: themes/tools/build-theme.py sand|cobalt|springlight   (build.sh der Extension ruft es vor dem Packen auf)"""
import sys
from pathlib import Path
d = Path(__file__).resolve().parent.parent / sys.argv[1]
light = (d / "theme-light.css").read_text(encoding="utf-8")
dark = (d / "theme-dark.css").read_text(encoding="utf-8")
out = light.rstrip() + "\n\n/* ===== Dunkelmodus (Betriebssystem) ===== */\n@media (prefers-color-scheme: dark) {\n" + dark.rstrip() + "\n}\n"
(d / "theme.css").write_text(out, encoding="utf-8", newline="\n")
print("geschrieben:", d / "theme.css", len(out.splitlines()), "Zeilen")
