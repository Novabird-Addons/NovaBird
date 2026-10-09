/* NovaBird-Conversation – reine Logik zum Gruppieren (ohne Browser-API, getestet mit node). */
"use strict";

const SUBJECT_PREFIX = /^\s*(re|aw|antw|wg|fw|fwd|sv|vs|tr|rv)(\[\d+\])?\s*:\s*/i;

function normalizeSubject(subject) {
  let text = String(subject ?? "").trim();
  for (;;) {
    const next = text.replace(SUBJECT_PREFIX, "");
    if (next === text) break;
    text = next;
  }
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

// Message-IDs aus References / In-Reply-To (Werte oder Liste von Werten), ohne spitze Klammern.
function parseIds(values) {
  const out = [];
  for (const value of [].concat(values ?? [])) {
    for (const m of String(value).matchAll(/<([^<>\s]+)>/g)) out.push(m[1]);
  }
  return out;
}

const SKIP_FOLDER_TYPES = ["trash", "junk"];

/*
 * candidates: [{ id, mid, refs: [mid…], subjectKey, date, folderType }]
 * Liefert die Kandidaten der Konversation von `targetId`, ohne Duplikate (gleiche Message-ID in mehreren Ordnern).
 */
const FALLBACK_DAYS = 30;

// E-Mail-Adressen aus "Name <a@b>" oder "a@b" (klein geschrieben)
function addressesOf(values) {
  const out = new Set();
  for (const value of [].concat(values ?? [])) {
    for (const m of String(value).matchAll(/[^\s<>,;"']+@[^\s<>,;"']+/g)) out.add(m[0].toLowerCase());
  }
  return out;
}

/*
 * fallback: off = nur Antwortketten, subject = ohne Kette alle mit gleichem Betreff (üblich),
 *           smart = wie subject, aber nur innerhalb von fallbackDays Tagen und (fallbackPeople) mit gemeinsamem Beteiligten.
 */
function groupConversation(targetId, candidates, { fallback = "subject", fallbackDays = FALLBACK_DAYS, fallbackPeople = true } = {}) {
  const target = candidates.find(c => c.id === targetId);
  if (!target) return [];

  const parent = new Map();
  const find = key => {
    if (!parent.has(key)) parent.set(key, key);
    let root = key;
    while (parent.get(root) !== root) root = parent.get(root);
    while (parent.get(key) !== root) {
      const next = parent.get(key);
      parent.set(key, root);
      key = next;
    }
    return root;
  };
  const union = (a, b) => parent.set(find(a), find(b));

  for (const c of candidates) {
    find(c.mid);
    for (const ref of c.refs) union(c.mid, ref);
  }
  const root = find(target.mid);
  let group = candidates.filter(c => find(c.mid) === root);

  if (fallback !== "off" && new Set(group.map(c => c.mid)).size < 2 && target.subjectKey) {
    if (fallback === "smart") {
      const limit = fallbackDays * 86400000;
      const mine = new Set(target.people ?? []);
      group = candidates.filter(c => c.id === targetId || (
        c.subjectKey === target.subjectKey &&
        Math.abs(c.date - target.date) <= limit &&
        (!fallbackPeople || (c.people ?? []).some(a => mine.has(a)))));
    } else {
      group = candidates.filter(c => c.subjectKey === target.subjectKey);
    }
  }

  const byMid = new Map();
  const rank = c => (c.id === targetId ? 0 : SKIP_FOLDER_TYPES.includes(c.folderType) ? 2 : 1);
  for (const c of group) {
    if (SKIP_FOLDER_TYPES.includes(c.folderType) && c.id !== targetId) continue;
    const have = byMid.get(c.mid);
    if (!have || rank(c) < rank(have)) byMid.set(c.mid, c);
  }
  return [...byMid.values()].sort((a, b) => a.date - b.date || a.id - b.id);
}

/*
 * messages: aufsteigend nach Datum sortiert, mit .id und .read. Ungelesene sind immer aufgeklappt.
 * mode: latest = nur die neueste, latestPrev = neueste und die davor, all = alle.
 */
function pickExpanded(messages, mode) {
  const open = new Set();
  const n = messages.length;
  if (!n) return open;
  if (mode === "all") return new Set(messages.map(m => m.id));
  open.add(messages[n - 1].id);
  if (mode === "latestPrev" && n > 1) open.add(messages[n - 2].id);
  for (const m of messages) if (!m.read) open.add(m.id);
  return open;
}

// Gloda/Suche: eine Kopie je Message-ID (items: { id, mid, folderType }); die gewählte Nachricht zuerst, Papierkorb/Spam zuletzt
function dedupeByMid(items, targetId) {
  const best = new Map();
  const rank = r => (r.id === targetId ? 0 : SKIP_FOLDER_TYPES.includes(r.folderType) ? 2 : 1);
  for (const r of items) {
    const have = best.get(r.mid);
    if (!have || rank(r) < rank(have)) best.set(r.mid, r);
  }
  return items.filter(r => best.get(r.mid) === r);
}

// ---------- Zeilen aus dem NovaBird-DB-Index ----------

const ROW_SEP = "\u0001";
const rowKey = row => `${row.headerMessageId}${ROW_SEP}${row.folderId}`;
const splitKey = key => { const i = String(key).indexOf(ROW_SEP); return i < 0 ? null : { headerMessageId: key.slice(0, i), folderId: key.slice(i + 1) }; };

// Eine Kopie je Message-ID: die Kopie im Ordner der gewählten Nachricht, sonst eine außerhalb von Papierkorb/Spam, sonst die erste.
function dedupeRows(rows, targetHeaderId, targetFolderId) {
  const best = new Map();
  const rank = r => (r.headerMessageId === targetHeaderId && r.folderId === targetFolderId ? 0 : SKIP_FOLDER_TYPES.includes(r.folderType) ? 2 : 1);
  for (const r of rows) {
    const have = best.get(r.headerMessageId);
    if (!have || rank(r) < rank(have)) best.set(r.headerMessageId, r);
  }
  return rows.filter(r => best.get(r.headerMessageId) === r);
}

// "Name <a@b>, Name2 <c@d>" → ["Name", "Name2"] (Kommas in Anzeigenamen bleiben heil)
function recipientNames(text) {
  const out = [];
  for (const chunk of String(text ?? "").split(/(?<=>)\s*,\s*/)) {
    for (const part of chunk.includes("<") ? [chunk] : chunk.split(",")) {
      const trimmed = part.trim();
      const named = trimmed.match(/^"?([^"<]*?)"?\s*<([^>]*)>$/);
      const name = named ? named[1].trim() || named[2] : trimmed;
      if (name) out.push(name);
    }
  }
  return out;
}

function authorName(row) {
  return String(row.authorName || row.authorEmail || "").trim();
}

function rowToView(row) {
  return {
    id: rowKey(row),
    author: authorName(row),
    email: String(row.authorEmail ?? "").trim().toLowerCase(),
    recipients: recipientNames(row.recipients),
    date: Number(row.date) || 0,
    read: !!row.isRead,
    subject: row.subject ?? "",
    folder: row.folderName ?? "",
    local: !!row.snippet,   // ohne lokalen Text liefert der Index kein Snippet
    mine: row.folderType === "sent",
    folderType: row.folderType ?? "",
    snippet: row.snippet ?? "",
  };
}

if (typeof module !== "undefined") {
  module.exports = { dedupeByMid, normalizeSubject, parseIds, addressesOf, groupConversation, pickExpanded, rowKey, splitKey, dedupeRows, recipientNames, rowToView };
}
