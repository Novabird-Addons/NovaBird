#!/bin/bash
# Packt das Add-on als <Name>-<Version>.xpi nach ../../Release/Kandidaten (Version aus manifest.json).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
# Optional: OUTNAME=novabird-db-test ./build.sh  (Dateiname einer Testversion; Version im Manifest bleibt Ziffern)
OUTDIR="$(cd "$PWD/../../Release/Kandidaten" && pwd)"
OUT="$OUTDIR/${OUTNAME:-novabird-db-$VERSION}.xpi"
rm -f "$OUT"
zip -r -q "$OUT" manifest.json background.js src api _locales icons debug options
echo "Gebaut: $OUT"
unzip -l "$OUT" | tail -n +4 | head -n -2
