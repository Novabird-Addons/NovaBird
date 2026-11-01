#!/usr/bin/env python3
"""Gegenprobe für den Oberflächentest: entfernt den Mac-Fix der Verfassen-Leiste aus einer Kopie von compose.css.

  tools/tbtest/strip_mac_fix.py <kopie>/novabird-extension/css/compose.css

Nur für Testkopien; bricht ab, wenn der Block nicht gefunden wird.
"""
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    css = f.read()
new, n = re.subn(r"@media \(-moz-platform: macos\) \{\s*#composeToolbar2 \{[^}]*\}\s*\}", "", css)
if n != 1:
    sys.exit(f"Mac-Fix nicht gefunden ({n})")
with open(path, "w", encoding="utf-8") as f:
    f.write(new)
print("Mac-Fix entfernt:", path)
