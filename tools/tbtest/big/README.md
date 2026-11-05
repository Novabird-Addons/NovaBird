# Lasttest Suchindex (großes Archiv)

Dauerhaftes Testarchiv außerhalb von Git (z. B. `../test/corpus`), rund 1,2 Mio. Mails:

1. `python gen_synth.py <profil>/Mail/Local\ Folders --total 700000` – erzeugte Mails (9 Ordner, Mehrteiler, Kodierungen, Anhänge, Fäden; nur `.invalid`-Adressen).
2. Enron-Korpus (CMU, `enron_mail_20150507.tar.gz`, ~443 MB) herunterladen und `python enron_to_mbox.py enron.tar.gz <profil>/Mail/Local\ Folders` (150 Unterordner unter „Enron“, ohne Entpacken).
3. `run.py … --js big/bigtest.js` mit `NBMODE=prep` (ohne Add-on: alle Ordner einlesen lassen), dann `NBMODE=build` (Erstindex), danach `NBMODE=rescan` (Startlauf + erzwungener Durchgang; `NBNOFORCE=1` nur Startlauf) bzw. `NBMODE=profile` (Zeit von `messages.list` allein + Debug-Seitenzeiten). Profilordner muss „profile-new“ heißen. `NBPROGRESS=<datei>`: Zwischenstand.

Messwerte 05.11.2026 (TB 159, 1.217.395 Mails, 163 Ordner): Erstindex 51,5 min; Durchgang alles bekannt 517 s; `messages.list` allein 105.000 Mails in 43 s.
