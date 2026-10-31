#!/bin/bash
# Packt das Add-on als novabird-search-<Version>.xpi nach ../../Release/Kandidaten (Version aus manifest.json).
# Ab 2.0 enthält NovaBird-Search den Suchindex (db/, bis 1.x Add-on NovaBird-DB, dessen ID es übernimmt).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUTDIR="$(cd "$PWD/../../Release/Kandidaten" && pwd)"
OUT="$OUTDIR/novabird-search-$VERSION.xpi"
rm -f "$OUT"
# Laufzeit der semantischen Suche (transformers.js, onnxruntime-web; nicht in Git): prüfen bzw. holen
python3 ../tools/vendor-semantic.py >/dev/null
zip -r -q "$OUT" manifest.json background.html settings.js parser.js background.js _locales icons experiments options analysis db/background.js db/src db/api db/debug semantic
# Gemeinsamer Code aus Source/shared (im Paket unter shared/)
(cd .. && zip -q "$OUT" shared/selftest.js shared/selftest-bg.js shared/selftest-ui.js shared/hubnote.js)
echo "Gebaut: $OUT"
unzip -l "$OUT" | tail -n +4 | head -n -2
