/* NovaBird-Search – Suchtext in Kriterien zerlegen.
 * Beispiel: 'von:müller anh:ja seit:2026-01-01 "angebot carport"'
 * Die Chips im Dropdown fügen nur Text-Tokens ein; der Text bleibt die einzige Quelle der Wahrheit.
 */
"use strict";

const TOKEN_KEYS = {
  von: "author", from: "author", f: "author",
  an: "recipients", to: "recipients", t: "recipients",
  betreff: "subject", subj: "subject", s: "subject",
  text: "body", body: "body",
  anh: "attachment", anhang: "attachment",
  seit: "fromDate", ab: "fromDate", bis: "toDate",
  // Französisch
  de: "author", à: "recipients", pour: "recipients", objet: "subject", sujet: "subject", texte: "body", pj: "attachment",
  depuis: "fromDate", jusque: "toDate", avant: "toDate",
  // Spanisch (de: gilt für beide)
  para: "recipients", asunto: "subject", texto: "body", adjunto: "attachment", desde: "fromDate", hasta: "toDate",
  // Englisch
  since: "fromDate", after: "fromDate", until: "toDate", before: "toDate", attachment: "attachment", att: "attachment",
};

const FLAG_WORDS = {
  ungelesen: ["unread", true],
  gelesen: ["unread", false],
  markiert: ["flagged", true],
  hier: ["scope", "folder"],
  überall: ["scope", "all"],
  // Französisch, Spanisch, Englisch
  nonlu: ["unread", true], nonlus: ["unread", true], marqué: ["flagged", true],
  noleído: ["unread", true], leído: ["unread", false], marcado: ["flagged", true],
  unread: ["unread", true], flagged: ["flagged", true], starred: ["flagged", true],
  ici: ["scope", "folder"], partout: ["scope", "all"], aquí: ["scope", "folder"],
};

function parseQuery(text) {
  const criteria = { scope: "all" };
  const free = [];
  // Tokens: key:"wert mit leerzeichen" | key:wert | "phrase" | wort
  const re = /(\S+?):"([^"]*)"|(\S+?):(\S+)|"([^"]*)"|(\S+)/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const key = (m[1] || m[3] || "").toLowerCase();
    const value = m[2] ?? m[4];
    const word = m[5] ?? m[6];

    if (key && TOKEN_KEYS[key]) {
      applyToken(criteria, TOKEN_KEYS[key], value);
      continue;
    }
    if (word !== undefined && FLAG_WORDS[word.toLowerCase()]) {
      const [prop, val] = FLAG_WORDS[word.toLowerCase()];
      criteria[prop] = val;
      continue;
    }
    free.push(word ?? `${m[1] || m[3]}:${value}`);
  }
  if (free.length) {
    criteria.freeText = free.join(" ");
  }
  return criteria;
}

function applyToken(criteria, prop, value) {
  if (!value) {
    return;
  }
  switch (prop) {
    case "attachment":
      criteria.attachment = /^(ja|yes|oui|si|sí|1|true)$/i.test(value);
      break;
    case "fromDate":
    case "toDate": {
      const d = parseDate(value);
      if (d) {
        criteria[prop] = d.getTime();
      }
      break;
    }
    default:
      criteria[prop] = value;
  }
}

// Akzeptiert 2026-01-31, 31.01.2026, 31.1.26 sowie relative Angaben: 7t (Tage), 3w, 6m, 1j
function parseDate(value) {
  const rel = value.match(/^(\d+)([twmj])$/i);
  if (rel) {
    const n = parseInt(rel[1], 10);
    const d = new Date();
    const unit = rel[2].toLowerCase();
    if (unit === "t") d.setDate(d.getDate() - n);
    if (unit === "w") d.setDate(d.getDate() - n * 7);
    if (unit === "m") d.setMonth(d.getMonth() - n);
    if (unit === "j") d.setFullYear(d.getFullYear() - n);
    return d;
  }
  const slash = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); // 31/01/2026 (Tag/Monat/Jahr)
  if (slash) {
    const year = slash[3].length === 2 ? 2000 + +slash[3] : +slash[3];
    return new Date(year, +slash[2] - 1, +slash[1]);
  }
  const iso = value.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) {
    return new Date(+iso[1], +iso[2] - 1, +iso[3]);
  }
  const de = value.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (de) {
    const year = de[3].length === 2 ? 2000 + +de[3] : +de[3];
    return new Date(year, +de[2] - 1, +de[1]);
  }
  return null;
}

function isEmpty(criteria) {
  return Object.keys(criteria).filter(k => k !== "scope").length === 0;
}

/**
 * Zu kurz für die Live-Suche: es gibt Textbestandteile (Freitext, von:, an:, betreff:, text:), aber keiner hat mindestens
 * `min` Zeichen (Anführungszeichen und Leerraum zählen nicht). Reine Filter (ungelesen, seit:, …) sind nie „zu kurz“.
 */
function isTooShort(criteria, min = 3) {
  const parts = [criteria.freeText, criteria.author, criteria.recipients, criteria.subject, criteria.body].filter(Boolean);
  return parts.length > 0 && parts.every(p => String(p).replace(/["\s]/g, "").length < min);
}

if (typeof module !== "undefined") {
  module.exports = { parseQuery, parseDate, isEmpty, isTooShort };
}
