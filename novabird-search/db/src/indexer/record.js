// Abbildung der Betterbird-Objekte (MessageHeader, MailFolder, Anhänge)
// auf den Index-Datensatz. Reine Funktionen -> in Node testbar.

import { cleanBody } from "../text/clean.js";

/** "Jonas Müller <jonas@x.de>" -> { name, email } */
export function parseAddress(s) {
  const str = String(s ?? "").trim();
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(str);
  if (m) return { name: m[1].trim(), email: m[2].trim().toLowerCase() };
  if (/^[^\s@]+@[^\s@]+$/.test(str)) return { name: "", email: str.toLowerCase() };
  return { name: str, email: "" };
}

/** Ordner-ID: MV3 hat folder.id, MV2 nur accountId + path. */
export function folderIdOf(folder) {
  return folder?.id ?? `${folder?.accountId ?? ""}:/${folder?.path ?? ""}`;
}

const SPECIAL = ["inbox", "sent", "drafts", "archives", "trash", "junk", "templates", "outbox"];

export function folderTypeOf(folder) {
  const su = folder?.specialUse; // MV3: Array
  if (Array.isArray(su)) {
    const t = su.find((x) => SPECIAL.includes(x));
    if (t) return t;
  }
  if (folder?.type && SPECIAL.includes(folder.type)) return folder.type; // MV2
  return "";
}

export function attachmentTypeOf({ name = "", contentType = "" }) {
  const ext = (/\.([a-z0-9]+)$/i.exec(name)?.[1] ?? "").toLowerCase();
  const ct = contentType.toLowerCase();
  if (ext === "pdf" || ct === "application/pdf") return "pdf";
  if (["xlsx", "xls", "xlsm", "csv", "ods"].includes(ext) || /spreadsheet|excel|text\/csv/.test(ct)) return "excel";
  if (["docx", "doc", "odt", "rtf"].includes(ext) || /wordprocessing|msword|opendocument\.text/.test(ct)) return "word";
  if (["pptx", "ppt", "odp"].includes(ext) || /presentation|powerpoint/.test(ct)) return "powerpoint";
  if (["jpg", "jpeg", "png", "gif", "heic", "webp", "tif", "tiff", "bmp"].includes(ext) || ct.startsWith("image/")) return "image";
  if (["zip", "7z", "rar", "gz", "tar"].includes(ext) || /zip|compressed/.test(ct)) return "archive";
  return "other";
}

const SUBJECT_PREFIX = /^\s*(re|aw|antw|wg|fw|fwd|sv|vs|tr|rv)(\[\d+\])?\s*:\s*/i;

/**
 * Betreff-Schlüssel für die Konversationsabfrage: Antwort-/Weiterleitungspräfixe (Re, AW, Antw, WG, Fw, Fwd, SV, VS, TR, RV,
 * auch mit [n]) entfernt, Leerraum zusammengefasst, klein geschrieben. Gleiche Regeln wie in NovaBird-Conversation.
 */
export function subjectKey(subject) {
  let text = String(subject ?? "").trim();
  for (;;) {
    const next = text.replace(SUBJECT_PREFIX, "");
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export const MAX_REFS = 100;
export const MAX_REF_LENGTH = 250;

/**
 * Message-IDs aus References/In-Reply-To (Liste von Zeichenketten, ggf. mit spitzen Klammern, auch mehrere IDs je Eintrag):
 * ohne <>, ohne Leerraum, ohne Leere/zu lange Werte, ohne Duplikate und ohne die eigene ID; höchstens MAX_REFS.
 */
export function normalizeRefs(values, ownId = "") {
  const out = [];
  const seen = new Set([String(ownId ?? "")]);
  for (const value of [].concat(values ?? [])) {
    const text = String(value ?? "");
    const ids = [...text.matchAll(/<([^<>\s]+)>/g)].map((m) => m[1]);
    // Eintrag ohne spitze Klammern (so liefert Betterbird die IDs): mehrere durch Leerraum getrennt
    if (!ids.length) ids.push(...text.split(/\s+/).map((t) => t.replace(/^<|>$/g, "")));
    for (const id of ids) {
      if (!id || id.length > MAX_REF_LENGTH || /[\s<>]/.test(id) || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
      if (out.length >= MAX_REFS) return out;
    }
  }
  return out;
}

/** Textanfang (höchstens 200 Zeichen) aus dem bereinigten Text (ohne Zitate), Leerraum zusammengefasst. */
export function snippetOf(body) {
  const s = String(body ?? "").replace(/\s+/g, " ").trim();
  if (s.length <= 200) return s;
  let cut = s.slice(0, 200);
  const last = cut.charCodeAt(cut.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1); // keine halbe Zeichenfolge (Surrogat) abschneiden
  return cut;
}

/** Schneller, nicht-kryptografischer Hash (FNV-1a) zum Erkennen von Änderungen. */
export function quickHash(s) {
  let h = 0x811c9dc5;
  const str = String(s ?? "");
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * @param header       MessageHeader aus der WebExtension-API
 * @param content      { plain, html }   Textteile der Nachricht
 * @param attachments  [{ name, contentType, size }]
 * @param tagNames     Map tagKey -> Anzeigename (aus messages.tags.list / listTags)
 * @param attachmentText  extrahierter Anhangstext (Stufe 3, sonst "")
 * @param refs         Verweise (References/In-Reply-To) aus der Kopfdatenbank, undefined = unbekannt (dann nichts ändern)
 */
export function toRecord(header, { content = {}, attachments = [], tagNames = new Map(), attachmentText = "", refs } = {}) {
  const author = parseAddress(header.author);
  const recipients = [...(header.recipients ?? []), ...(header.ccList ?? [])].join(", ");
  const body = cleanBody(content);
  const real = attachments.filter((a) => a && a.name);
  const types = [...new Set(real.map(attachmentTypeOf))];
  return {
    headerMessageId: header.headerMessageId,
    accountId: header.folder?.accountId ?? "",
    folderId: folderIdOf(header.folder),
    folderName: header.folder?.name ?? "",
    folderType: folderTypeOf(header.folder),
    date: +new Date(header.date),
    authorName: author.name,
    authorEmail: author.email,
    recipients,
    subject: header.subject ?? "",
    hasAttachment: real.length > 0,
    attachmentTypes: types,
    attachmentNames: real.map((a) => a.name),
    tags: (header.tags ?? []).map((k) => tagNames.get(k) ?? k),
    isRead: Boolean(header.read),
    isFlagged: Boolean(header.flagged),
    body,
    attachmentText,
    bodyHash: quickHash(body),
    snippet: snippetOf(body),
    subjectKey: subjectKey(header.subject),
    refs: refs === undefined ? undefined : normalizeRefs(refs, header.headerMessageId),
  };
}

/**
 * Anhänge aus einem MessagePart-Baum (messages.getFull), wie messages.listAttachments sie liefert: Teile mit Dateiname
 * oder disposition attachment; in einen Anhang (z. B. angehängte Mail) wird nicht weiter hineingesehen.
 * So reicht ein Abruf je Mail für Text und Anhänge (Betterbird zerlegt die Mail nur einmal).
 */
export function attachmentsFromParts(part) {
  const out = [];
  const walk = (p, top) => {
    if (!p) return;
    const isAttachment = !top && (Boolean(p.name) || /attachment/i.test(p.headers?.["content-disposition"]?.[0] ?? ""));
    if (isAttachment) {
      out.push({ name: p.name ?? "", contentType: p.contentType ?? "", size: p.size ?? 0 });
      return;
    }
    (p.parts ?? []).forEach((c) => walk(c, false));
  };
  walk(part, true);
  return out;
}

/**
 * Textteile aus einem MessagePart-Baum (messages.getFull) sammeln.
 * Anhänge (mit Dateiname / disposition attachment) werden übersprungen.
 */
export function textFromParts(part) {
  const out = { plain: "", html: "" };
  const walk = (p) => {
    if (!p) return;
    const ct = (p.contentType ?? "").toLowerCase();
    const isAttachment = Boolean(p.name) || /attachment/i.test(p.headers?.["content-disposition"]?.[0] ?? "");
    if (!isAttachment && typeof p.body === "string") {
      if (ct === "text/plain") out.plain += (out.plain ? "\n" : "") + p.body;
      else if (ct === "text/html") out.html += (out.html ? "\n" : "") + p.body;
    }
    (p.parts ?? []).forEach(walk);
  };
  walk(part);
  return out;
}
