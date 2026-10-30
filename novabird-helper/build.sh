#!/bin/bash
# Baut den NovaBird Helper als eine selbstständige Datei (braucht kein .NET auf dem Zielrechner) nach
# ../../Release/Kandidaten/NovaBird-Helper-<Version>.exe. Braucht das .NET-10-SDK; beim ersten Mal lädt dotnet die
# Laufzeitpakete für win-x64 aus NuGet.
set -euo pipefail
cd "$(dirname "$0")"
VERSION="$(sed -n 's:.*<Version>\(.*\)</Version>.*:\1:p' NovaBirdHelper.csproj)"
OUTDIR="$(cd "$PWD/../../Release/Kandidaten" && pwd)"
dotnet publish -c Release -p:NovaBirdRelease=true -o obj/publish
cp obj/publish/nbhelper.exe "$OUTDIR/NovaBird-Helper-$VERSION.exe"
echo "Gebaut: $OUTDIR/NovaBird-Helper-$VERSION.exe"
