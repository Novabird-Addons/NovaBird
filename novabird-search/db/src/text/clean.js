// Textbereinigung vor dem Indizieren. Weniger Rauschen = bessere Treffer:
// Zitierte Vorgängermails würden sonst jede Antwort im Thread erneut treffen.

const ENTITIES = {
  nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'",
  auml: "ä", ouml: "ö", uuml: "ü", Auml: "Ä", Ouml: "Ö", Uuml: "Ü", szlig: "ß",
  euro: "€", ndash: "–", mdash: "—", hellip: "…", laquo: "«", raquo: "»",
  bdquo: "„", ldquo: "“", rdquo: "”", sbquo: "‚", lsquo: "‘", rsquo: "’",
};

function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e] ?? m;
  });
}

/**
 * HTML -> Text. Bewusst ohne DOM, damit es überall gleich läuft
 * (Hintergrundskript, Worker, Node-Tests).
 */
export function htmlToText(html) {
  let s = String(html ?? "");
  s = s.replace(/<(script|style|head|title)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<!--[\s\S]*?-->/g, " ");
  // Zitatblöcke markieren, damit stripQuotes sie entfernen kann
  s = s.replace(/<blockquote[^>]*type=["']?cite["']?[^>]*>/gi, "\n[[QUOTE]]\n");
  s = s.replace(/<\/blockquote>/gi, "\n[[/QUOTE]]\n");
  s = s.replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|hr)[^>]*>/gi, "\n");
  s = s.replace(/<(td|th)[^>]*>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s
    .replace(/[ \t\u00a0]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const QUOTE_HEADERS = [
  /^-{2,}\s*(original message|ursprüngliche nachricht|weitergeleitete nachricht|forwarded message)\s*-{2,}/i,
  /^am .{3,120}(schrieb|wrote|geschrieben)\b.{0,80}:\s*$/i,
  /^on .{3,80} wrote:\s*$/i,
  /^(von|from):\s.+$/i, // Outlook-Kopfblock: "Von: … / Gesendet: … / An: …"
];

/**
 * Zitierte Vorgängermails abschneiden.
 * - Zeilen mit ">" am Anfang werden entfernt.
 * - Ab einem typischen Zitatkopf wird der Rest verworfen.
 * Weitergeleitete Mails (Fwd) behalten den Inhalt: options.keepForwarded.
 */
export function stripQuotes(text, options = {}) {
  const lines = String(text ?? "").split(/\r?\n/);
  const out = [];
  let inQuoteBlock = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (t === "[[QUOTE]]") { inQuoteBlock++; continue; }
    if (t === "[[/QUOTE]]") { inQuoteBlock = Math.max(0, inQuoteBlock - 1); continue; }
    if (inQuoteBlock) continue;
    if (/^>/.test(t)) continue;
    const isForwardHeader = /weitergeleitete nachricht|forwarded message/i.test(t);
    if (isForwardHeader && options.keepForwarded) continue;
    if (QUOTE_HEADERS.some((re) => re.test(t))) {
      // Outlook-Kopf nur, wenn kurz darauf "Gesendet:/Sent:" folgt
      if (/^(von|from):/i.test(t)) {
        const next = lines.slice(i + 1, i + 4).join("\n");
        if (!/^(gesendet|sent|datum|date):/im.test(next)) {
          out.push(line);
          continue;
        }
      }
      break;
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

/** Signatur ab "-- " (RFC 3676) abschneiden. */
export function stripSignature(text) {
  const idx = String(text ?? "").search(/^-- ?$/m);
  return idx >= 0 ? text.slice(0, idx).trim() : String(text ?? "").trim();
}

/** Komplette Bereinigung für den Index. */
export function cleanBody({ plain, html }, options = {}) {
  const base = plain && plain.trim() ? plain : htmlToText(html ?? "");
  let t = base.replace(/\r\n/g, "\n");
  if (options.stripQuotes !== false) t = stripQuotes(t, options);
  if (options.stripSignature !== false) t = stripSignature(t);
  return t.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}
