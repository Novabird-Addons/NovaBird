#!/usr/bin/env python3
"""Enron-Korpus (CMU, enron_mail_20150507.tar.gz, Maildir) direkt aus dem Archiv in Thunderbird-mbox umwandeln:
ein Unterordner je Enron-Nutzer unter „Enron“ (Local Folders/Enron.sbd/<nutzer>), ohne das Archiv zu entpacken.

  python enron_to_mbox.py <enron.tar.gz> <ziel: Ordner, in den Enron und Enron.sbd kommen>
"""
import os
import re
import sys
import tarfile
import time
from email.utils import parsedate_tz, mktime_tz


def from_line(raw):
    m = re.search(rb"^Date:\s*(.+)$", raw[:4000], re.M)
    ts = None
    if m:
        try:
            ts = mktime_tz(parsedate_tz(m.group(1).decode("latin-1").strip()))
        except Exception:
            ts = None
    t = time.gmtime(ts if ts and ts > 0 else 0)
    return ("From - " + time.strftime("%a %b %d %H:%M:%S %Y", t) + "\n").encode()


def main():
    src, out = sys.argv[1], sys.argv[2]
    sbd = os.path.join(out, "Enron.sbd")
    os.makedirs(sbd, exist_ok=True)
    open(os.path.join(out, "Enron"), "ab").close()
    files = {}
    n = 0
    with tarfile.open(src, "r|gz") as tar:
        for ti in tar:
            if not ti.isfile():
                continue
            parts = ti.name.split("/")
            if len(parts) < 4 or parts[0] != "maildir":
                continue
            user = re.sub(r"[^\w.-]", "_", parts[1])
            f = files.get(user)
            if f is None:
                f = files[user] = open(os.path.join(sbd, user), "wb")
            raw = tar.extractfile(ti).read().replace(b"\r\n", b"\n")
            body = b"\n".join((b">" + l) if l.startswith(b"From ") else l for l in raw.split(b"\n"))
            f.write(from_line(raw) + b"X-Mozilla-Status: 0001\nX-Mozilla-Status2: 00000000\n" + body.rstrip(b"\n") + b"\n\n")
            n += 1
            if n % 50000 == 0:
                print(n, flush=True)
    for f in files.values():
        f.close()
    print("gesamt", n, "in", len(files), "Ordnern")


if __name__ == "__main__":
    main()
