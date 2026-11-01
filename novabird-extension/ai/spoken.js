"use strict";

/* Vorlesen: Text so aufbereiten, dass die Stimme (Qwen3-TTS im NovaBird Helper) Zahlen, Datum, Uhrzeit, Beträge und
 * Abkürzungen richtig ausspricht – nur für die Stimme, die Anzeige bleibt unverändert. Sprachmodelle raten bei Ziffern
 * („05.11.2026“, „19:30“, „84,20 €“) und lesen sie oft englisch oder Ziffer für Ziffer. Deutsch und Englisch; andere
 * Sprachen bleiben unverändert. Aufruf je Satz (nach nbAI.sentences): nbSpoken.text(satz, "de").
 * Auch in Node nutzbar (tests/spoken.test.js). */
const nbSpoken = (() => {
  // ---- Deutsch: Zahlwörter ---------------------------------------------------------------------------------------------
  const DE_UNITS = ["null", "eins", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf",
    "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
  const DE_TENS = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
  const DE_MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  const DE_DAYS = { Mo: "Montag", Di: "Dienstag", Mi: "Mittwoch", Do: "Donnerstag", Fr: "Freitag", Sa: "Samstag", So: "Sonntag" };
  // „eins“ vor „und“, „hundert“, „tausend“ wird „ein“ (einundzwanzig, einhundert, hunderteintausend)
  const deEin = w => w.replace(/eins$/, "ein");

  function de100(n) {
    if (n < 20) return DE_UNITS[n];
    const t = DE_TENS[Math.floor(n / 10)];
    return n % 10 ? deEin(DE_UNITS[n % 10]) + "und" + t : t;
  }
  function de1000(n) {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? deEin(DE_UNITS[h]) + "hundert" : "") + (r || !h ? de100(r) : "");
  }
  function deNumber(n) {
    if (!Number.isSafeInteger(n) || n < 0 || n >= 1e9) return deDigits(String(n));
    if (n < 1000) return de1000(n);
    const m = Math.floor(n / 1e6);
    const t = Math.floor((n % 1e6) / 1000);
    const r = n % 1000;
    const mio = m ? (m === 1 ? "eine Million" : deEin(de1000(m)) + " Millionen") + (t || r ? " " : "") : "";
    return mio + (t ? deEin(de1000(t)) + "tausend" : "") + (r ? de1000(r) : "");
  }
  const deDigits = s => [...s].map(d => DE_UNITS[+d] ?? d).join(" ");
  // Ordnungszahl: „-ten“ (am vierten, bis zum dritten) oder „-ter“ (der vierte → nach „der“ erste/zweite …)
  function deOrdinal(n, form = "ten") {
    const special = { 1: "erste", 3: "dritte", 7: "siebte", 8: "achte" };
    const stem = special[n] || (n < 20 ? deNumber(n) + "te" : deNumber(n) + "ste");
    return form === "te" ? stem : stem + (form === "ter" ? "r" : "n");
  }
  function deYear(y) {
    if (y >= 1100 && y < 2000) return de100(Math.floor(y / 100)) + "hundert" + (y % 100 ? de100(y % 100) : "");
    return deNumber(y);
  }
  const fullYear = y => (y.length === 2 ? 2000 + +y : +y);
  // Ordnungszahl-Form nach dem Wort davor: „der 4.“ → vierte, sonst vierten (am, vom, zum, bis, den, Montag,)
  const deForm = before => (/\b(der|Der)\s*$/.test(before) ? "te" : "ten");
  const deDate = (d, m, y, before) => `${deOrdinal(+d, deForm(before))} ${DE_MONTHS[+m - 1]}${y ? " " + deYear(fullYear(y)) : ""}`;
  const deDecimal = (i, f) => `${deNumber(+i)} Komma ${deDigits(f)}`;
  const deMoney = (i, c, cur) => {
    const name = /^(\$|USD|Dollar)$/i.test(cur) ? "Dollar" : /^(£|GBP|Pfund)$/i.test(cur) ? "Pfund" : /^(CHF|Franken)$/i.test(cur) ? "Franken" : "Euro";
    const cents = c && +c ? " " + deNumber(+c.padEnd(2, "0")) : "";
    return `${deNumber(+i.replace(/\./g, ""))} ${name}${cents}`;
  };
  const DE_ABBR = [
    [/\bz\.\s?B\./g, "zum Beispiel"], [/\bd\.\s?h\./g, "das heißt"], [/\bu\.\s?a\./g, "unter anderem"], [/\bu\.\s?U\./g, "unter Umständen"],
    [/\bggf\./g, "gegebenenfalls"], [/\bbzw\./g, "beziehungsweise"], [/\bca\./g, "circa"], [/\busw\./g, "und so weiter"],
    [/\binkl\./g, "inklusive"], [/\bexkl\./g, "exklusive"], [/\bevtl\./g, "eventuell"], [/\bvgl\./g, "vergleiche"],
    [/\bNr\.(?=\s*\d)/g, "Nummer"], [/\bTel\.(?=\s|:)/g, "Telefon"], [/\bStr\.(?=\s|,|$)/g, "Straße"], [/\bDr\.(?=\s)/g, "Doktor"],
    [/\bProf\.(?=\s)/g, "Professor"], [/\bHr\.(?=\s)/g, "Herr"], [/\bMwSt\.?/g, "Mehrwertsteuer"], [/\bz\.\s?Hd\./g, "zu Händen"],
    [/\bab\s+sofort\b/g, "ab sofort"], [/&/g, " und "], [/°C\b/g, " Grad Celsius"], [/\bkm\b/g, "Kilometer"], [/\bkg\b/g, "Kilogramm"],
  ];

  function german(s) {
    let t = s;
    for (const [re, word] of DE_ABBR) t = t.replace(re, word);
    // Wochentag-Kürzel vor einem Datum: „Sa., 7.11.“ → Samstag, …
    t = t.replace(/\b(Mo|Di|Mi|Do|Fr|Sa|So)\.(?=,?\s*\d)/g, (m, d) => DE_DAYS[d]);
    // Datum 05.11.2026 / 5.11.26 / 5.11. (ohne Jahr) und ISO 2026-11-05
    t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d, off, all) =>
      +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= 31 ? deDate(d, mo, y, all.slice(0, off)) : m);
    t = t.replace(/(?<![\d.])(\d{1,2})\.(\d{1,2})\.(\d{4}|\d{2}(?!\d))?/g, (m, d, mo, y, off, all) =>
      +d >= 1 && +d <= 31 && +mo >= 1 && +mo <= 12 ? deDate(d, mo, y, all.slice(0, off)) : m);
    // „5. November“
    const months = DE_MONTHS.join("|");
    t = t.replace(new RegExp(`(\\d{1,2})\\.\\s*(${months})`, "g"), (m, d, mo, off, all) =>
      +d >= 1 && +d <= 31 ? `${deOrdinal(+d, deForm(all.slice(0, off)))} ${mo}` : m);
    // Uhrzeit 19:30 (Uhr) / 19.30 Uhr / 9 Uhr
    t = t.replace(/\b([01]?\d|2[0-3])[:.]([0-5]\d)(\s*Uhr)?\b/g, (m, h, mi, uhr) => {
      if (!uhr && m.includes(".")) return m; // 19.30 ohne „Uhr“ könnte eine Zahl sein
      return `${deNumber(+h)} Uhr${+mi ? " " + deNumber(+mi) : ""}`;
    });
    // Beträge: 84,20 € / 1.234,56 EUR / € 84,20 / 84 Euro / 84,– €
    const AMOUNT = "(\\d{1,3}(?:\\.\\d{3})+|\\d+)(?:,(\\d{1,2}|-|–))?";
    const CUR = "(€|EUR|Euro|\\$|USD|Dollar|£|GBP|CHF)";
    t = t.replace(new RegExp(`${AMOUNT}\\s*${CUR}(?![\\p{L}])`, "gu"), (m, i, c, cur) => deMoney(i, /\d/.test(c || "") ? c : "", cur));
    t = t.replace(new RegExp(`${CUR}\\s*${AMOUNT}`, "g"), (m, cur, i, c) => deMoney(i, /\d/.test(c || "") ? c : "", cur));
    // Prozent
    t = t.replace(/(\d+)(?:,(\d+))?\s*%/g, (m, i, f) => (f ? deDecimal(i, f) : deNumber(+i)) + " Prozent");
    // Tausender-Punkte und Dezimalkomma
    t = t.replace(/\b(\d{1,3}(?:\.\d{3})+)(?![.\d])/g, (m, n) => deNumber(+n.replace(/\./g, "")));
    t = t.replace(/(\d+),(\d+)/g, (m, i, f) => deDecimal(i, f));
    t = t.replace(/(\d+)\.(\d+)/g, (m, a, b) => `${deNumber(+a)} Punkt ${deNumber(+b)}`); // Versionen, Gliederung „3.5“
    // übrige Zahlen: mit führender Null oder ab 7 Stellen (Telefon, Konto) Ziffer für Ziffer, vierstellig 1100–1999 als
    // Jahreszahl („neunzehnhundertachtundneunzig“), sonst als Zahlwort
    t = t.replace(/\d+/g, (m, off, all) => {
      const word = m.length >= 7 || (m.length > 1 && m[0] === "0") ? deDigits(m) : m.length === 4 && +m >= 1100 && +m < 2000 ? deYear(+m) : deNumber(+m);
      return word + (/\p{L}/u.test(all[off + m.length] || "") ? " " : ""); // „5b“ → fünf b
    });
    return t.replace(/\s{2,}/g, " ").trim();
  }

  // ---- Englisch --------------------------------------------------------------------------------------------------------
  const EN_UNITS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
    "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const EN_TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  const EN_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const en100 = n => (n < 20 ? EN_UNITS[n] : EN_TENS[Math.floor(n / 10)] + (n % 10 ? "-" + EN_UNITS[n % 10] : ""));
  const en1000 = n => {
    const h = Math.floor(n / 100);
    const r = n % 100;
    return (h ? EN_UNITS[h] + " hundred" + (r ? " and " : "") : "") + (r || !h ? en100(r) : "");
  };
  function enNumber(n) {
    if (!Number.isSafeInteger(n) || n < 0 || n >= 1e9) return enDigits(String(n));
    const parts = [];
    const m = Math.floor(n / 1e6), t = Math.floor((n % 1e6) / 1000), r = n % 1000;
    if (m) parts.push(en1000(m) + " million");
    if (t) parts.push(en1000(t) + " thousand");
    if (r || !parts.length) parts.push(en1000(r));
    return parts.join(" ");
  }
  const enDigits = s => [...s].map(d => EN_UNITS[+d] ?? d).join(" ");
  function enOrdinal(n) {
    const special = { one: "first", two: "second", three: "third", five: "fifth", eight: "eighth", nine: "ninth", twelve: "twelfth" };
    const w = enNumber(n);
    const last = w.match(/[a-z]+$/)[0];
    if (special[last]) return w.slice(0, -last.length) + special[last];
    return last.endsWith("y") ? w.slice(0, -1) + "ieth" : w + "th";
  }
  const enYear = y => (y >= 2000 && y < 2010 ? enNumber(y) : y >= 1100 && y < 2100 ? `${en100(Math.floor(y / 100))} ${y % 100 ? (y % 100 < 10 ? "oh " : "") + en100(y % 100) : "hundred"}` : enNumber(y));
  const enMoney = (i, c, cur) => {
    const name = /^(€|EUR)$/i.test(cur) ? "euros" : /^(£|GBP)$/i.test(cur) ? "pounds" : "dollars";
    return `${enNumber(+i.replace(/,/g, ""))} ${name}${c && +c ? " " + enNumber(+c.padEnd(2, "0")) : ""}`;
  };
  const EN_ABBR = [[/\be\.\s?g\./gi, "for example"], [/\bi\.\s?e\./gi, "that is"], [/\betc\./g, "et cetera"], [/\bNo\.(?=\s*\d)/g, "number"],
    [/\bapprox\./g, "approximately"], [/&/g, " and "]];

  function english(s) {
    let t = s;
    for (const [re, word] of EN_ABBR) t = t.replace(re, word);
    const months = EN_MONTHS.join("|");
    t = t.replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (m, y, mo, d) => +mo >= 1 && +mo <= 12 ? `${EN_MONTHS[+mo - 1]} ${enOrdinal(+d)}, ${enYear(+y)}` : m);
    t = t.replace(new RegExp(`\\b(${months})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`, "g"), (m, mo, d, y) => `${mo} ${enOrdinal(+d)}${y ? ", " + enYear(+y) : ""}`);
    t = t.replace(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${months})\\b`, "g"), (m, d, mo) => `the ${enOrdinal(+d)} of ${mo}`);
    t = t.replace(/\b(1[0-2]|0?\d):([0-5]\d)\s*(am|pm|a\.m\.|p\.m\.)/gi, (m, h, mi, ap) => `${enNumber(+h)}${+mi ? " " + (+mi < 10 ? "oh " : "") + enNumber(+mi) : ""} ${/^a/i.test(ap) ? "a m" : "p m"}`);
    t = t.replace(/\b([01]?\d|2[0-3]):([0-5]\d)\b/g, (m, h, mi) => `${enNumber(+h)} ${+mi ? (+mi < 10 ? "oh " : "") + enNumber(+mi) : "hundred"}`);
    t = t.replace(/([$€£])\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?/g, (m, cur, i, c) => enMoney(i, c, cur));
    t = t.replace(/(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?\s*(EUR|USD|GBP)\b/g, (m, i, c, cur) => enMoney(i, c, cur));
    t = t.replace(/(\d+)(?:\.(\d+))?\s*%/g, (m, i, f) => (f ? `${enNumber(+i)} point ${enDigits(f)}` : enNumber(+i)) + " percent");
    t = t.replace(/\b(\d{1,3}(?:,\d{3})+)\b/g, (m, n) => enNumber(+n.replace(/,/g, "")));
    t = t.replace(/(\d+)\.(\d+)/g, (m, i, f) => `${enNumber(+i)} point ${enDigits(f)}`);
    t = t.replace(/\d+/g, (m, off, all) => {
      const word = m.length >= 7 || (m.length > 1 && m[0] === "0") ? enDigits(m) : enNumber(+m);
      return word + (/\p{L}/u.test(all[off + m.length] || "") ? " " : "");
    });
    return t.replace(/\s{2,}/g, " ").trim();
  }

  /** Satz für die Stimme aufbereiten; lang = Sprachcode („de“, „en“, …), andere Sprachen unverändert. */
  function text(sentence, lang) {
    const l = String(lang || "").slice(0, 2).toLowerCase();
    if (l === "de") return german(String(sentence));
    if (l === "en") return english(String(sentence));
    return String(sentence);
  }

  return { text, deNumber, deOrdinal, enNumber, enOrdinal };
})();

if (typeof module !== "undefined") module.exports = nbSpoken;
