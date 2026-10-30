#!/bin/bash
# Packt das Add-on als novabird-extension-<Version>.xpi nach ../../Release/Kandidaten (Version aus manifest.json).
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(python3 -c "import json;print(json.load(open('manifest.json'))['version'])")"
OUTDIR="$(cd "$PWD/../../Release/Kandidaten" && pwd)"
OUT="$OUTDIR/novabird-extension-$VERSION.xpi"
rm -f "$OUT"
# Themes: theme.css aus den Quellen hell/dunkel bauen; ins Paket nur Farben und fertiges Stylesheet
for t in sand cobalt springlight; do python3 themes/tools/build-theme.py "$t" >/dev/null; done
zip -r -q "$OUT" manifest.json background.js experiments css options pilot rules icons _locales ai updates themes/sand/theme.json themes/sand/theme.css themes/cobalt/theme.json themes/cobalt/theme.css themes/springlight/theme.json themes/springlight/theme.css
# Gemeinsamer Code aus Source/shared (im Paket unter shared/)
(cd .. && zip -q "$OUT" shared/color.js shared/selftest.js shared/selftest-bg.js shared/selftest-ui.js)
echo "Gebaut: $OUT"
