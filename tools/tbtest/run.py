#!/usr/bin/env python3
"""Thunderbird headless mit frischem Testprofil starten, Add-ons installieren und ein Testskript (chrome-Kontext,
Marionette) ausführen. Läuft unter Windows, macOS und Linux (auch in GitHub Actions).

  tools/tbtest/run.py --tb <thunderbird> --profile <ordner mit "profile-new"> --mbox <datei> --js <testskript>
                      [--out ergebnis.json] [--shot bild.png] [--env NAME=WERT ...] <xpi> ...

Das Testskript ruft am Ende done(ergebnis) auf; ergebnis.pass === false lässt das Programm mit Code 1 enden.
"""
import argparse
import base64
import json
import os
import socket
import subprocess
import sys
import time

PREFS = """
user_pref("marionette.port", {port});
user_pref("mail.provider.suppress_dialog_on_startup", true);
user_pref("mail.shell.checkDefaultClient", false);
user_pref("mail.winsearch.firstRunDone", true);
user_pref("mail.spotlight.firstRunDone", true);
user_pref("ldap_2.servers.osx.dirType", -1);
user_pref("mailnews.start_page.enabled", false);
user_pref("app.update.enabled", false);
user_pref("app.update.disabledForTesting", true);
user_pref("datareporting.policy.dataSubmissionEnabled", false);
user_pref("extensions.experiments.enabled", true);
user_pref("mail.accountmanager.accounts", "account1");
user_pref("mail.accountmanager.localfoldersserver", "server1");
user_pref("mail.account.account1.server", "server1");
user_pref("mail.server.server1.type", "none");
user_pref("mail.server.server1.hostname", "Local Folders");
user_pref("mail.server.server1.userName", "nobody");
user_pref("mail.server.server1.directory-rel", "[ProfD]Mail/Local Folders");
user_pref("mail.server.server1.name", "Testkonto lokal");
user_pref("remote.prefs.recommended", false);
user_pref("mail.account.account1.identities", "id1");
user_pref("mail.identity.id1.useremail", "test@example.invalid");
user_pref("mail.identity.id1.fullName", "Test Konto");
user_pref("mail.accountmanager.defaultaccount", "account1");
user_pref("intl.locale.requested", "de");
user_pref("extensions.webextensions.remote", false);
user_pref("remote.log.level", "Trace");
user_pref("browser.dom.window.dump.enabled", true);
user_pref("devtools.console.stdout.chrome", true);
user_pref("devtools.console.stdout.content", true);
"""
# mail.winsearch/spotlight.firstRunDone: sonst öffnet ein frisches Profil den Dialog „Systemintegration“ (Windows-Suche,
# Spotlight) – vermutlich blockierte er auf macOS das Testskript (Läufe vom 01.11.);
# ldap_2.servers.osx.dirType=-1: ohne macOS-Adressbuch; sonst fragt macOS beim ersten Lesen der Adressbücher nach dem
# Zugriff auf die Kontakte, und ohne Klick bleibt Thunderbird stehen (Bildschirmfoto aus GitHub Actions, 01.11.);
# extensions.webextensions.remote=false: Add-on-Seiten im Hauptprozess, damit das Testskript an ihre Fenster kommt;
# devtools.console.stdout.*: Konsolenmeldungen (auch der Add-ons) landen in --log


class Marionette:
    def __init__(self, port, timeout):
        self.sock = None
        for _ in range(90):
            try:
                self.sock = socket.create_connection(("127.0.0.1", port), timeout=5)
                break
            except OSError:
                time.sleep(1)
        if not self.sock:
            raise RuntimeError("Marionette nicht erreichbar")
        self.sock.settimeout(timeout)
        self.buf = b""
        self.mid = 0
        self.recv()

    def recv(self):
        while b":" not in self.buf:
            self.buf += self.sock.recv(65536)
        n, rest = self.buf.split(b":", 1)
        n = int(n)
        while len(rest) < n:
            rest += self.sock.recv(65536)
        msg, self.buf = rest[:n], rest[n:]
        return json.loads(msg)

    def call(self, name, params=None):
        self.mid += 1
        body = json.dumps([0, self.mid, name, params or {}]).encode()
        self.sock.sendall(str(len(body)).encode() + b":" + body)
        while True:
            r = self.recv()
            if isinstance(r, list) and r[0] == 1 and r[1] == self.mid:
                if r[2]:
                    raise RuntimeError(r[2])
                return r[3]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tb", required=True)
    ap.add_argument("--profile", required=True)
    ap.add_argument("--mbox", required=True)
    ap.add_argument("--js", required=True)
    ap.add_argument("--out")
    ap.add_argument("--shot")
    ap.add_argument("--log", help="Ausgabe von Thunderbird (Konsole) in diese Datei")
    ap.add_argument("--port", type=int, default=2828)
    ap.add_argument("--timeout", type=int, default=1800)
    ap.add_argument("--headed", action="store_true", help="mit Fenster (macOS in GitHub Actions: ohne Fenster öffnet das Hauptfenster nicht)")
    ap.add_argument("--env", action="append", default=[])
    ap.add_argument("xpis", nargs="*")
    a = ap.parse_args()

    prof = os.path.abspath(a.profile)
    if "profile-new" not in os.path.basename(prof):
        sys.exit("Profilordner muss „profile-new“ im Namen tragen (Schutz vor echten Profilen)")
    lf = os.path.join(prof, "Mail", "Local Folders")
    os.makedirs(lf, exist_ok=True)
    with open(a.mbox, encoding="utf-8") as f:
        mbox = f.read()
    with open(os.path.join(lf, "Inbox"), "w", encoding="utf-8", newline="\n") as f:
        f.write(mbox)
    with open(os.path.join(prof, "user.js"), "w", encoding="utf-8") as f:
        f.write(PREFS.format(port=a.port))

    env = dict(os.environ, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS="1")
    for kv in a.env:
        k, v = kv.split("=", 1)
        env[k] = v
    log = open(a.log, "w", encoding="utf-8", errors="replace") if a.log else subprocess.DEVNULL
    args = [a.tb, "-profile", prof, "-marionette", "-remote-allow-system-access", "-no-remote"]
    if not a.headed:
        args.insert(3, "-headless")
    say = lambda *x: print(time.strftime("%H:%M:%S"), *x, flush=True)  # sofort sichtbar, auch wenn danach etwas hängt
    p = subprocess.Popen(args, env=env, stdout=log, stderr=subprocess.STDOUT)
    say("Thunderbird gestartet", "mit Fenster" if a.headed else "ohne Fenster")
    res = None
    try:
        m = Marionette(a.port, 120)  # Start und Einrichtung: höchstens 2 min je Schritt
        say("Marionette verbunden")
        m.call("WebDriver:NewSession", {"capabilities": {"timeouts": {"script": a.timeout * 1000}}})
        say("Sitzung steht")
        m.call("WebDriver:SetTimeouts", {"script": a.timeout * 1000})
        m.call("Marionette:SetContext", {"value": "chrome"})
        for x in a.xpis:
            say("Installiert:", m.call("Addon:Install", {"path": os.path.abspath(x), "temporary": True}).get("value"))
        # ins Hauptfenster wechseln (auf macOS ist sonst ein verstecktes Fenster gewählt, dort lösen Timer nicht aus)
        try:
            handles = m.call("WebDriver:GetWindowHandles")
            handles = handles.get("value", []) if isinstance(handles, dict) else handles
            for h in handles or []:
                m.call("WebDriver:SwitchToWindow", {"handle": h})
                if m.call("Marionette:GetWindowType").get("value") == "mail:3pane":
                    say("Hauptfenster gewählt")
                    break
        except Exception as e:
            say("Fensterwahl nicht möglich:", e)
        m.sock.settimeout(a.timeout)
        say("Testskript läuft")
        with open(a.js, encoding="utf-8") as f:
            res = m.call("WebDriver:ExecuteAsyncScript", {"script": f.read(), "args": [], "newSandbox": False}).get("value")
        say("Testskript fertig")
        if a.shot:
            png = m.call("WebDriver:TakeScreenshot", {"full": False, "hash": False})["value"]
            with open(a.shot, "wb") as f:
                f.write(base64.b64decode(png))
        try:
            m.call("Marionette:Quit", {"flags": ["eForceQuit"]})
        except Exception:
            pass
    finally:
        time.sleep(2)
        if p.poll() is None:
            p.kill()
    if a.out:
        with open(a.out, "w", encoding="utf-8") as f:
            json.dump(res, f, indent=1, ensure_ascii=False)
    print(json.dumps(res, indent=1, ensure_ascii=False))
    sys.exit(0 if isinstance(res, dict) and res.get("pass") is True else 1)


if __name__ == "__main__":
    main()
