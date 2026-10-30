#!/usr/bin/env python3
"""Veröffentlicht das komplette NovaBird-Set als Online-Update (Reiter „Online-Updates“ der NovaBird-Extension).

  tools/publish-updates.py testing            baut alle Pakete, legt ein Release im Update-Repo an und schreibt channels/testing.json
  tools/publish-updates.py stable             dasselbe für den Kanal „stable“ (nur vom Branch main)
  tools/publish-updates.py testing --dry-run  baut und zeigt die Kanal-Datei, lädt nichts hoch
  tools/publish-updates.py testing --local DIR --base-url http://127.0.0.1:8791/
                                              nur zum Testen: Pakete und Kanal-Datei nach DIR (für einen Server auf diesem Rechner)

Braucht Python 3 und für das Hochladen die GitHub-CLI (gh, angemeldet). Die Dateilisten der Pakete kommen aus den build.sh-Skripten,
der Inhalt ist also derselbe wie beim normalen Bauen. Die Extension prüft jedes Paket mit der SHA-256-Prüfsumme aus der Kanal-Datei.
"""
import argparse, base64, datetime, hashlib, json, os, re, shlex, shutil, subprocess, sys, tempfile, zipfile

REPO_UPDATES = "Novabird-Addons/Nova-Bird-Online-Updates"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
# Ab NovaBird 2.0: vier Add-ons. Die Themes stecken in der Extension, NovaBird-Search enthält den Index (ID novabird-db@novabird).
ADDONS = ["novabird-extension", "novabird-search", "novabird-conversation", "novabird-send"]
THEMES_IN_EXTENSION = ["sand", "cobalt", "springlight"]


def git(*args):
    return subprocess.run(["git", "-C", ROOT, *args], check=True, capture_output=True, text=True).stdout.strip()


def add(z, base, rel):
    p = os.path.join(base, rel)
    if os.path.isdir(p):
        for d, dirs, fs in os.walk(p):
            dirs.sort()
            for f in sorted(fs):
                fp = os.path.join(d, f)
                z.write(fp, os.path.relpath(fp, base).replace("\\", "/"))
    elif os.path.isfile(p):
        z.write(p, rel.replace("\\", "/"))
    else:
        raise FileNotFoundError(p)


def manifest(path):
    with open(os.path.join(path, "manifest.json"), encoding="utf-8") as f:
        return json.load(f)


def build_addon(name, out_dir):
    src = os.path.join(ROOT, name)
    if name == "novabird-extension":
        for t in THEMES_IN_EXTENSION:  # wie build.sh: theme.css aus den Quellen hell/dunkel
            subprocess.run([sys.executable, os.path.join(src, "themes", "tools", "build-theme.py"), t], check=True, stdout=subprocess.DEVNULL)
    if name == "novabird-search":  # wie build.sh: Laufzeit der semantischen Suche prüfen bzw. holen (nicht in Git)
        subprocess.run([sys.executable, os.path.join(ROOT, "tools", "vendor-semantic.py")], check=True, stdout=subprocess.DEVNULL)
    with open(os.path.join(src, "build.sh"), encoding="utf-8") as f:
        sh = f.read()
    m = manifest(src)
    out = os.path.join(out_dir, f"{name}-{m['version']}.xpi")
    own = re.search(r'^zip -r -q "\$OUT" (.+)$', sh, re.M).group(1)
    shared = re.search(r'^\(cd \.\. && zip -q "\$OUT" (.+)\)$', sh, re.M)
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for rel in shlex.split(own):
            add(z, src, rel)
        if shared:
            for rel in shlex.split(shared.group(1)):
                add(z, ROOT, rel)
    return out, m, "extension"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 16), b""):
            h.update(chunk)
    return h.hexdigest()


def gh(*args, stdin=None):
    return subprocess.run(["gh", *args], check=True, capture_output=True, text=True, input=stdin).stdout


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("channel", choices=["stable", "testing"])
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--local", metavar="DIR")
    ap.add_argument("--base-url", metavar="URL")
    ap.add_argument("--allow-dirty", action="store_true", help="auch mit nicht committeten Änderungen (nur --dry-run/--local)")
    a = ap.parse_args()

    commit = git("rev-parse", "--short", "HEAD")
    branch = git("rev-parse", "--abbrev-ref", "HEAD")
    dirty = bool(git("status", "--porcelain"))
    upload = not a.dry_run and not a.local
    if dirty and (upload or not a.allow_dirty):
        sys.exit("Arbeitsstand nicht sauber: erst committen (oder --dry-run/--local mit --allow-dirty).")
    if upload and a.channel == "stable" and branch != "main":
        sys.exit(f"Kanal stable nur vom Branch main (aktuell: {branch}).")

    day = datetime.date.today().isoformat()
    tag = f"{a.channel}-{day}-{commit}"
    out_dir = a.local or tempfile.mkdtemp(prefix="novabird-updates-")
    os.makedirs(out_dir, exist_ok=True)
    built = [build_addon(n, out_dir) for n in ADDONS]

    if a.local:
        base = (a.base_url or "http://127.0.0.1:8791/").rstrip("/") + "/"
        url_of = lambda f: base + os.path.basename(f)
    else:
        url_of = lambda f: f"https://github.com/{REPO_UPDATES}/releases/download/{tag}/{os.path.basename(f)}"

    entries = []
    for path, m, kind in built:
        gecko = (m.get("browser_specific_settings") or m.get("applications") or {}).get("gecko", {})
        entries.append({
            "id": gecko["id"], "version": m["version"], "type": kind, "url": url_of(path),
            "sha256": sha256(path), "size": os.path.getsize(path), "minApp": gecko.get("strict_min_version", ""),
        })
    channel = {"schema": 1, "channel": a.channel, "built": day, "commit": commit, "branch": branch, "addons": entries}
    text = json.dumps(channel, indent=2, ensure_ascii=False) + "\n"

    for e in entries:
        print(f"  {e['id']:34} {e['version']:8} {e['size']:>8} B  {e['sha256'][:12]}...")
    if a.local:
        os.makedirs(os.path.join(out_dir, "channels"), exist_ok=True)
        with open(os.path.join(out_dir, "channels", f"{a.channel}.json"), "w", encoding="utf-8", newline="\n") as f:
            f.write(text)
        print(f"Lokal abgelegt: {out_dir}")
        return
    if a.dry_run:
        print(text)
        print(f"(--dry-run: nichts hochgeladen; Pakete in {out_dir})")
        return

    notes = f"NovaBird {a.channel}, Stand {day}, Commit {commit} (Branch {branch}). Wird von der NovaBird-Extension (Reiter „Online-Updates“) geladen."
    files = [p for p, _, _ in built]
    gh("release", "create", tag, *files, "--repo", REPO_UPDATES, "--title", f"NovaBird {a.channel} {day} ({commit})", "--notes", notes,
       *(["--prerelease"] if a.channel == "testing" else []))
    path = f"channels/{a.channel}.json"
    sha = ""
    try:
        sha = json.loads(gh("api", f"repos/{REPO_UPDATES}/contents/{path}"))["sha"]
    except subprocess.CalledProcessError:
        pass  # Datei gibt es noch nicht
    body = {"message": f"{a.channel}: {day} ({commit})", "content": base64.b64encode(text.encode("utf-8")).decode("ascii"), "branch": "main"}
    if sha:
        body["sha"] = sha
    gh("api", "-X", "PUT", f"repos/{REPO_UPDATES}/contents/{path}", "--input", "-", stdin=json.dumps(body))
    print(f"Veröffentlicht: {tag} → {path}")
    shutil.rmtree(out_dir, ignore_errors=True)


if __name__ == "__main__":
    main()
