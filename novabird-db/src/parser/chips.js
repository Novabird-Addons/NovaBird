// Chips = sichtbare Interpretation der Anfrage in der Suchleiste.
// Jeder Chip hat eine id, über die er entfernt werden kann (removeChip).

import { DAY_MS, formatDate } from "./dates.js";

const TEXTS = {
  de: {
    types: { pdf: "PDF", excel: "Excel", word: "Word", image: "Bild", powerpoint: "PowerPoint", archive: "ZIP" },
    folders: { inbox: "Posteingang", sent: "Gesendet", archives: "Archiv", drafts: "Entwürfe", trash: "Papierkorb", junk: "Spam", templates: "Vorlagen" },
    from: "Von", to: "An", involves: "Mit", me: "mir", meTo: "mich", on: "Am", since: "Seit", until: "Bis", attachment: "Anhang", noAttachment: "Ohne Anhang",
    unread: "Ungelesen", read: "Gelesen", flagged: "Markiert", tag: "Schlagwort", folder: "Ordner", subject: "Betreff", or: "oder", without: "Ohne",
  },
  en: {
    types: { pdf: "PDF", excel: "Excel", word: "Word", image: "Image", powerpoint: "PowerPoint", archive: "ZIP" },
    folders: { inbox: "Inbox", sent: "Sent", archives: "Archive", drafts: "Drafts", trash: "Trash", junk: "Spam", templates: "Templates" },
    from: "From", to: "To", involves: "With", me: "me", meTo: "me", on: "On", since: "Since", until: "Until", attachment: "Attachment", noAttachment: "No attachment",
    unread: "Unread", read: "Read", flagged: "Flagged", tag: "Tag", folder: "Folder", subject: "Subject", or: "or", without: "Without",
  },
  fr: {
    types: { pdf: "PDF", excel: "Excel", word: "Word", image: "Image", powerpoint: "PowerPoint", archive: "ZIP" },
    folders: { inbox: "Réception", sent: "Envoyés", archives: "Archives", drafts: "Brouillons", trash: "Corbeille", junk: "Spam", templates: "Modèles" },
    from: "De", to: "À", involves: "Avec", me: "moi", meTo: "moi", on: "Le", since: "Depuis", until: "Jusqu’au", attachment: "Pièce jointe", noAttachment: "Sans pièce jointe",
    unread: "Non lu", read: "Lu", flagged: "Marqué", tag: "Étiquette", folder: "Dossier", subject: "Objet", or: "ou", without: "Sans",
  },
  es: {
    types: { pdf: "PDF", excel: "Excel", word: "Word", image: "Imagen", powerpoint: "PowerPoint", archive: "ZIP" },
    folders: { inbox: "Entrada", sent: "Enviados", archives: "Archivo", drafts: "Borradores", trash: "Papelera", junk: "Spam", templates: "Plantillas" },
    from: "De", to: "Para", involves: "Con", me: "mí", meTo: "mí", on: "El", since: "Desde", until: "Hasta", attachment: "Adjunto", noAttachment: "Sin adjunto",
    unread: "No leído", read: "Leído", flagged: "Marcado", tag: "Etiqueta", folder: "Carpeta", subject: "Asunto", or: "o", without: "Sin",
  },
};

function personLabel(p, meLabel) {
  if (p.me) return meLabel;
  if (p.resolved) return p.resolved.name || p.resolved.email;
  return p.name ?? p.email;
}

function dateLabel(from, to, t) {
  if (from != null && to != null) {
    if (to - from <= DAY_MS + 3_600_000) return `${t.on} ${formatDate(from)}`; // Sommerzeit-Toleranz
    return `${formatDate(from)} – ${formatDate(to - 1)}`;
  }
  if (from != null) return `${t.since} ${formatDate(from)}`;
  return `${t.until} ${formatDate(to - 1)}`;
}

/** Chips der Anfrage; `lang` (de, en, fr, es) bestimmt die Beschriftung (Standard Deutsch). */
export function toChips(q, lang = "de") {
  const t = TEXTS[lang] ?? TEXTS.de;
  const chips = [];
  const amb = (p) => Boolean(p.candidates?.length > 1 && !p.resolved);
  q.from.forEach((p, i) => chips.push({ id: `from:${i}`, kind: "from", label: `${t.from}: ${personLabel(p, t.me)}`, ambiguous: amb(p) }));
  q.to.forEach((p, i) => chips.push({ id: `to:${i}`, kind: "to", label: `${t.to}: ${personLabel(p, t.meTo)}`, ambiguous: amb(p) }));
  q.involves.forEach((p, i) => chips.push({ id: `involves:${i}`, kind: "involves", label: `${t.involves}: ${personLabel(p, t.me)}`, ambiguous: amb(p) }));
  if (q.dateFrom != null || q.dateTo != null) {
    chips.push({ id: "date", kind: "date", label: dateLabel(q.dateFrom, q.dateTo, t) });
  }
  if (q.attachmentTypes.length) {
    q.attachmentTypes.forEach((ty) => chips.push({ id: `attType:${ty}`, kind: "attachment", label: `📎 ${t.types[ty] ?? ty}` }));
  } else if (q.hasAttachment === true) {
    chips.push({ id: "att", kind: "attachment", label: `📎 ${t.attachment}` });
  } else if (q.hasAttachment === false) {
    chips.push({ id: "att", kind: "attachment", label: t.noAttachment });
  }
  if (q.unread === true) chips.push({ id: "unread", kind: "status", label: t.unread });
  if (q.unread === false) chips.push({ id: "unread", kind: "status", label: t.read });
  if (q.flagged) chips.push({ id: "flagged", kind: "status", label: `★ ${t.flagged}` });
  q.tags.forEach((tag, i) => chips.push({ id: `tag:${i}`, kind: "tag", label: `${t.tag}: ${tag}` }));
  if (q.folder) {
    const name = q.folder.type ? t.folders[q.folder.type] ?? q.folder.type : q.folder.name;
    chips.push({ id: "folder", kind: "folder", label: `${t.folder}: ${name}` });
  }
  q.subjectTerms.forEach((term, i) => chips.push({ id: `subject:${i}`, kind: "text", label: `${t.subject}: ${term}` }));
  q.phrases.forEach((p, i) => chips.push({ id: `phrase:${i}`, kind: "text", label: `„${p}“` }));
  q.terms.forEach((g, i) => chips.push({ id: `term:${i}`, kind: "text", label: g.join(` ${t.or} `) }));
  q.exclude.forEach((term, i) => chips.push({ id: `exclude:${i}`, kind: "exclude", label: `${t.without}: ${term}` }));
  return chips;
}

/** Liefert eine neue Anfrage ohne den Chip mit dieser id. */
export function removeChip(q, id) {
  const next = structuredClone(q);
  const [key, arg] = id.split(":");
  const dropIndex = (list) => list.splice(Number(arg), 1);
  switch (key) {
    case "from": dropIndex(next.from); break;
    case "to": dropIndex(next.to); break;
    case "involves": dropIndex(next.involves); break;
    case "date": next.dateFrom = null; next.dateTo = null; break;
    case "attType":
      next.attachmentTypes = next.attachmentTypes.filter((t) => t !== arg);
      if (!next.attachmentTypes.length) next.hasAttachment = null;
      break;
    case "att": next.hasAttachment = null; break;
    case "unread": next.unread = null; break;
    case "flagged": next.flagged = null; break;
    case "tag": dropIndex(next.tags); break;
    case "folder": next.folder = null; break;
    case "subject": dropIndex(next.subjectTerms); break;
    case "phrase": dropIndex(next.phrases); break;
    case "term": dropIndex(next.terms); break;
    case "exclude": dropIndex(next.exclude); break;
    default: throw new Error(`Unbekannter Chip ${id}`);
  }
  return next;
}
