#!/bin/bash
# Baut theme.css und packt <thema> als novabird-t-<name>-<Version>.xpi nach ../../Release/Kandidaten (Version aus manifest.json).
# Aufruf: tools/pack-theme.sh novabird-t-sand|novabird-t-cobalt|novabird-t-springlight
set -euo pipefail
cd "$(dirname "$0")/.."
T="$1"
[ -d "$T" ] || { echo "kein Ordner $T"; exit 1; }
python3 tools/build-theme.py "$T"
V="$(python3 -c "import json;print(json.load(open('$T/manifest.json'))['version'])")"
OUTDIR="$(cd ../../Release/Kandidaten && pwd)"
OUT="$OUTDIR/$T-$V.xpi"
FILES="manifest.json theme.css _locales"
[ -d "$T/icons" ] && FILES="$FILES icons"
[ -f "$T/icon.svg" ] && FILES="$FILES icon.svg"
rm -f "$OUT"
(cd "$T" && zip -qr "$OUT" $FILES)
echo "Gebaut: $OUT"
