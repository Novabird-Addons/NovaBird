#!/bin/bash
# Packt das Add-on als <Name>-<Version>.xpi nach ../../Release/Kandidaten (Version aus manifest.json).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUTDIR="$(cd "$PWD/../../Release/Kandidaten" && pwd)"
OUT="$OUTDIR/novabird-search-$VERSION.xpi"
rm -f "$OUT"
zip -r -q "$OUT" manifest.json settings.js parser.js background.js _locales icons experiments options analysis
# Gemeinsamer Code aus Source/shared (im Paket unter shared/)
(cd .. && zip -q "$OUT" shared/selftest.js shared/selftest-bg.js shared/selftest-ui.js)
echo "Gebaut: $OUT"
unzip -l "$OUT" | tail -n +4 | head -n -2
