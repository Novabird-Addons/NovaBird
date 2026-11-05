#!/usr/bin/env python3
"""Erzeugt ein großes, möglichst „echt“ wirkendes Test-Mailarchiv (mbox je Ordner) für Lasttests der Suche.

  python gen_synth.py <zielordner> [--total 700000] [--seed 42]

Eigenheiten wie in echten Postfächern: Mehrteiler (text+html), quoted-printable und base64, kodierte Betreffs
(RFC 2047), lange References-Ketten, Antworten/Weiterleitungen mit Zitaten, Anhänge (klein bis ~200 KB),
Newsletter mit viel HTML, Mails in DE/EN/FR/ES, gemischte Zeitzonen. Nur erfundene Namen und .invalid-Adressen.
"""
import argparse
import base64
import os
import quopri
import random
import time
from email.header import Header

FOLDERS = [  # (Name, Anteil)
    ("Archiv-2019", 0.12), ("Archiv-2020", 0.13), ("Archiv-2021", 0.14), ("Archiv-2022", 0.15),
    ("Archiv-2023", 0.15), ("Archiv-2024", 0.13), ("Newsletter", 0.10), ("Rechnungen", 0.04), ("Projekte", 0.04),
]
FIRST = ["Anna", "Ben", "Clara", "David", "Elena", "Felix", "Greta", "Hugo", "Ines", "Jonas", "Karla", "Luca", "Marie",
         "Noah", "Olivia", "Paul", "Quentin", "Rosa", "Simon", "Tara", "Ugo", "Vera", "Willem", "Xenia", "Yann", "Zoé",
         "José", "Lucía", "Mateo", "Sofía", "Chloé", "Théo", "Jürgen", "Björn", "Søren"]
LAST = ["Müller", "Schmidt", "Weber", "Fischer", "Dubois", "Martin", "García", "López", "Smith", "Brown", "Rossi",
        "Bernard", "Petit", "Fernández", "Wagner", "Becker", "Hoffmann", "Moreau", "Jones", "Taylor", "Nowak"]
DOMAINS = ["firma-a.invalid", "beispiel.invalid", "shop.invalid", "verein.invalid", "agence.invalid", "empresa.invalid",
           "corp.invalid", "uni.invalid", "news.invalid", "bank.invalid"]
WORDS = {
    "de": "Rechnung Angebot Termin Besprechung Projekt Bericht Vertrag Lieferung Bestellung Zahlung Erinnerung Mahnung "
          "Protokoll Entwurf Freigabe Urlaub Reise Hotel Flug Konferenz Budget Planung Abstimmung Kunde Lieferant "
          "Mitarbeiter Schulung Wartung Störung Server Datenbank Sicherung Änderung Anfrage Rückfrage Unterlagen "
          "Steuer Versicherung Kündigung Verlängerung Prüfung Ergebnis Zusammenfassung Übersicht Quartal Jahresabschluss "
          "bitte danke gerne heute morgen nächste Woche dringend wichtig anbei beigefügt wie besprochen".split(),
    "en": "invoice offer meeting project report contract delivery order payment reminder minutes draft approval holiday "
          "travel hotel flight conference budget planning customer supplier employee training maintenance outage server "
          "database backup change request question documents tax insurance renewal review results summary overview "
          "quarter please thanks today tomorrow next week urgent important attached as discussed".split(),
    "fr": "facture devis réunion projet rapport contrat livraison commande paiement rappel compte-rendu brouillon "
          "validation congés voyage hôtel vol conférence budget planification client fournisseur salarié formation "
          "maintenance panne serveur base sauvegarde modification demande question documents impôts assurance "
          "renouvellement résultats résumé trimestre merci aujourd'hui demain semaine prochaine urgent important ci-joint".split(),
    "es": "factura presupuesto reunión proyecto informe contrato entrega pedido pago recordatorio acta borrador "
          "aprobación vacaciones viaje hotel vuelo conferencia planificación cliente proveedor empleado formación "
          "mantenimiento avería servidor copia cambio solicitud pregunta documentos impuestos seguro renovación "
          "resultados resumen trimestre gracias hoy mañana próxima semana urgente importante adjunto".split(),
}
GREET = {"de": ("Hallo {n},", "Viele Grüße\n{s}"), "en": ("Hi {n},", "Best regards,\n{s}"),
         "fr": ("Bonjour {n},", "Cordialement,\n{s}"), "es": ("Hola {n},", "Saludos,\n{s}")}
RE = {"de": "AW: ", "en": "Re: ", "fr": "RE: ", "es": "RE: "}
FW = {"de": "WG: ", "en": "Fwd: ", "fr": "TR: ", "es": "RV: "}
TZ = ["+0100", "+0200", "+0000", "-0500", "-0800", "+0530", "+0900"]
DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def person(r):
    f, l = r.choice(FIRST), r.choice(LAST)
    mail = f"{f.lower()}.{l.lower()}".encode("ascii", "ignore").decode() or "x"
    return f"{f} {l}", f"{mail}@{r.choice(DOMAINS)}"


def addr(name, mail):
    try:
        name.encode("ascii")
        return f'"{name}" <{mail}>'
    except UnicodeEncodeError:
        return f"{Header(name, 'utf-8').encode()} <{mail}>"


def subj_header(s, r):
    try:
        s.encode("ascii")
        return s
    except UnicodeEncodeError:
        return Header(s, "utf-8").encode() if r.random() < 0.7 else "=?utf-8?Q?" + quopri.encodestring(s.encode(), header=True).decode().replace("\n", "") + "?="


def sentence(r, lang, n=None):
    w = WORDS[lang]
    n = n or r.randint(6, 18)
    s = " ".join(r.choice(w) for _ in range(n))
    return s[0].upper() + s[1:] + r.choice([".", ".", ".", "?", "!"])


def paragraphs(r, lang, k):
    return "\n\n".join(" ".join(sentence(r, lang) for _ in range(r.randint(1, 5))) for _ in range(k))


def date_str(ts, r):
    t = time.gmtime(ts)
    return f"{DAYS[t.tm_wday]}, {t.tm_mday} {MONTHS[t.tm_mon - 1]} {t.tm_year} {t.tm_hour:02}:{t.tm_min:02}:{t.tm_sec:02} {r.choice(TZ)}"


def qp(text):
    return quopri.encodestring(text.encode("utf-8")).decode("ascii")


def b64(data):
    s = base64.b64encode(data).decode("ascii")
    return "\n".join(s[i:i + 76] for i in range(0, len(s), 76))


def html_of(text, newsletter, r):
    body = "".join(f"<p style=\"font-family:Arial,sans-serif;font-size:14px;color:#333\">{p}</p>" for p in text.split("\n\n"))
    if newsletter:
        rows = "".join(f'<tr><td style="padding:12px"><a href="https://news.invalid/t/{r.getrandbits(64):x}">'
                       f'<img src="https://news.invalid/i/{r.getrandbits(32):x}.png" width="560"></a></td></tr>' for _ in range(r.randint(5, 25)))
        body = f'<table width="600" cellpadding="0" cellspacing="0" style="margin:auto">{rows}</table>{body}'
    return f"<!DOCTYPE html><html><head><meta charset=\"utf-8\"><style>body{{margin:0}}</style></head><body>{body}</body></html>"


def message(r, i, folder, ts, threads):
    lang = r.choices(["de", "en", "fr", "es"], [0.5, 0.25, 0.13, 0.12])[0]
    newsletter = folder == "Newsletter"
    fn, fm = person(r)
    tn, tm = person(r)
    mid = f"<{r.getrandbits(80):x}.{i}@{fm.split('@')[1]}>"
    refs = []
    subject = " ".join(r.choice(WORDS[lang]) for _ in range(r.randint(2, 7))).capitalize()
    if folder == "Rechnungen":
        subject = {"de": "Rechnung", "en": "Invoice", "fr": "Facture", "es": "Factura"}[lang] + f" {r.randint(10000, 99999)}"
    quote = ""
    if not newsletter and threads and r.random() < 0.45:  # Antwort in einem Faden
        t = r.choice(threads)
        refs = (t["refs"] + [t["mid"]])[-r.randint(3, 40):]
        subject = (RE[lang] if r.random() < 0.85 else FW[lang]) + t["subject"]
        quote = "\n\n" + "\n".join("> " + line for line in t["text"].splitlines()[:40])
    g, sig = GREET[lang]
    text = g.format(n=tn.split()[0]) + "\n\n" + paragraphs(r, lang, r.randint(1, 8 if not newsletter else 20)) + "\n\n" + sig.format(s=fn) + quote
    hdr = [
        f"From - {time.strftime('%a %b %d %H:%M:%S %Y', time.gmtime(ts))}",
        "X-Mozilla-Status: 0001",
        "X-Mozilla-Status2: 00000000",
        f"Return-Path: <{fm}>",
        f"Received: from mx{r.randint(1, 9)}.{fm.split('@')[1]} (mx.{fm.split('@')[1]} [192.0.2.{r.randint(1, 254)}])\n\tby mail.invalid with ESMTPS id {r.getrandbits(48):x}\n\tfor <{tm}>; {date_str(ts, r)}",
        f"Received: from localhost (localhost [127.0.0.1])\n\tby relay.invalid with SMTP id {r.getrandbits(40):x}; {date_str(ts, r)}",
        f"Date: {date_str(ts, r)}",
        f"From: {addr(fn, fm)}",
        f"To: {addr(tn, tm)}" + "".join(f", {addr(*person(r))}" for _ in range(r.choice([0, 0, 0, 1, 2, 5]))),
    ]
    if r.random() < 0.2:
        hdr.append("Cc: " + ", ".join(addr(*person(r)) for _ in range(r.randint(1, 4))))
    hdr += [f"Subject: {subj_header(subject, r)}", f"Message-ID: {mid}"]
    if refs:
        hdr.append(f"In-Reply-To: {refs[-1]}")
        hdr.append("References: " + "\n ".join(refs))
    hdr += ["MIME-Version: 1.0", f"X-Mailer: {r.choice(['Thunderbird 128.0', 'Microsoft Outlook 16.0', 'Apple Mail (2.3774)', 'Roundcube Webmail/1.6'])}"]
    if newsletter:
        hdr += [f"List-Unsubscribe: <https://news.invalid/u/{r.getrandbits(64):x}>", "Precedence: bulk"]
    for _ in range(r.randint(0, 4)):
        hdr.append(f"X-Spam-Info-{r.randint(1, 99)}: score={r.random() * 5:.2f} tests={','.join(r.choice(['BAYES_00', 'DKIM_SIGNED', 'SPF_PASS', 'HTML_MESSAGE', 'RCVD_IN_DNSWL']) for _ in range(4))}")

    attach = (folder == "Rechnungen" and r.random() < 0.9) or r.random() < 0.06
    html = newsletter or r.random() < 0.55
    b1 = f"----=_Part_{r.getrandbits(48):x}"
    parts = []
    if html:
        b2 = f"----=_Alt_{r.getrandbits(48):x}"
        alt = (f"--{b2}\nContent-Type: text/plain; charset=utf-8\nContent-Transfer-Encoding: quoted-printable\n\n{qp(text)}\n"
               f"--{b2}\nContent-Type: text/html; charset=utf-8\nContent-Transfer-Encoding: "
               + ("base64\n\n" + b64(html_of(text, newsletter, r).encode()) if r.random() < 0.4 else "quoted-printable\n\n" + qp(html_of(text, newsletter, r)))
               + f"\n--{b2}--\n")
        parts.append((f"multipart/alternative; boundary=\"{b2}\"", None, alt))
    else:
        enc = r.choice(["8bit", "quoted-printable", "quoted-printable", "base64"])
        payload = text if enc == "8bit" else qp(text) if enc == "quoted-printable" else b64(text.encode())
        parts.append(("text/plain; charset=utf-8; format=flowed", enc, payload))
    if attach:
        size = int(min(200_000, r.lognormvariate(9.5, 1.0)))
        name = r.choice(["Rechnung", "invoice", "facture", "Angebot", "scan", "photo", "Protokoll"]) + f"_{r.randint(1, 9999)}." + r.choice(["pdf", "pdf", "jpg", "docx", "xlsx"])
        parts.append((f"application/octet-stream; name=\"{name}\"", "base64", b64(os.urandom(size)), name))
    if len(parts) == 1 and parts[0][1] is None:
        body = parts[0][2]
        hdr.append(f"Content-Type: {parts[0][0]}")
    elif len(parts) == 1:
        hdr += [f"Content-Type: {parts[0][0]}", f"Content-Transfer-Encoding: {parts[0][1]}"]
        body = parts[0][2] + "\n"
    else:
        hdr.append(f"Content-Type: multipart/mixed; boundary=\"{b1}\"")
        body = "This is a multi-part message in MIME format.\n"
        for p in parts:
            body += f"--{b1}\nContent-Type: {p[0]}\n"
            if p[1]:
                body += f"Content-Transfer-Encoding: {p[1]}\n"
            if len(p) > 3:
                body += f"Content-Disposition: attachment; filename=\"{p[3]}\"\n"
            body += f"\n{p[2]}\n"
        body += f"--{b1}--\n"
    body = "\n".join((">" + line) if line.startswith("From ") else line for line in body.split("\n"))
    msg = "\n".join(hdr) + "\n\n" + body + "\n\n"
    if not newsletter and r.random() < 0.3:
        threads.append({"mid": mid, "refs": refs, "subject": subject.split(": ", 1)[-1], "text": text})
        if len(threads) > 3000:
            del threads[: len(threads) - 3000]
    return msg


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--total", type=int, default=700_000)
    ap.add_argument("--seed", type=int, default=42)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    r = random.Random(a.seed)
    i = 0
    for k, (name, share) in enumerate(FOLDERS):
        n = int(a.total * share)
        year = 2019 + min(k, 5)
        start = time.mktime((year, 1, 1, 0, 0, 0, 0, 0, 0)) if name.startswith("Archiv") else time.mktime((2019, 1, 1, 0, 0, 0, 0, 0, 0))
        end = time.mktime((year + 1, 1, 1, 0, 0, 0, 0, 0, 0)) if name.startswith("Archiv") else time.mktime((2025, 12, 31, 0, 0, 0, 0, 0, 0))
        stamps = sorted(r.uniform(start, end) for _ in range(n))
        threads = []
        with open(os.path.join(a.out, name), "w", encoding="utf-8", newline="\n") as f:
            for ts in stamps:
                f.write(message(r, i, name, ts, threads))
                i += 1
        print(name, n, flush=True)
    print("gesamt", i)


if __name__ == "__main__":
    main()
