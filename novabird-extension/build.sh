#!/bin/bash
# Packt das Add-on als novabird-extension-<Version>.xpi nach ../../Release/Kandidaten (Version aus manifest.json).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUTDIR="$(cd "$PWD/../../Release/Kandidaten" && pwd)"
OUT="$OUTDIR/novabird-extension-$VERSION.xpi"
rm -f "$OUT"
zip -r -q "$OUT" manifest.json background.js experiments css options pilot icons _locales
echo "Gebaut: $OUT"
