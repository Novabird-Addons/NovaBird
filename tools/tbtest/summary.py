#!/usr/bin/env python3
"""Ergebnis eines Tests als Markdown-Tabelle (für $GITHUB_STEP_SUMMARY):

  tools/tbtest/summary.py <titel> <ergebnis.json> [<fortschritt.json>]

Fehlt das Ergebnis (abgebrochen), wird der Fortschritt bis dahin gezeigt.
"""
import json
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
title, result = sys.argv[1], sys.argv[2]
progress = sys.argv[3] if len(sys.argv) > 3 else None
r = None
for p in (result, progress):
    if p and os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            r = json.load(f)
        break
print(f"### {title}")
if not r:
    print("Kein Ergebnis\n")
    raise SystemExit
print(f"Thunderbird {r.get('app')} · {r.get('os')} {r.get('arch') or ''} · {r.get('cores') or '?'} Kerne")
if r.get("t"):
    st = r.get("status") or {}
    print(f"\nZeiten (s): {r['t']} · Threads: {st.get('threads')} · {st.get('rate')} Mails/s")
print("\n| Prüfung | | Wert |\n|---|---|---|")
for k, c in (r.get("checks") or {}).items():
    print(f"| {k} | {'✅' if c['ok'] else '❌'} | {c.get('info')} |")
for k in ("error", "hung", "step"):
    if r.get(k):
        print(f"\n{k}: {r[k]}")
print()
