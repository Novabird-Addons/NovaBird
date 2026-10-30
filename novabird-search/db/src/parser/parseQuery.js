// Regel-Parser: Freitext -> strukturierte Anfrage (Sprachpakete in lang/: de, en, fr, es).
//
//   parseQuery("Speisepläne von Jonas aus den letzten 6 Monaten", { now })
//   -> { terms: [["speiseplän"]], from: [{ name: "Jonas" }], dateFrom: …, … }
//   parseQuery("invoices from Jonas last week", { now, langs: ["en"] })
//
// Vorgehen: Muster werden in fester Reihenfolge erkannt und aus dem Rest-Text
// entfernt (Phrasen, Operatoren, Zeit, Anhänge, Status, Ordner, Personen).
// Was übrig bleibt, wird zu Suchbegriffen. Mit mehreren Sprachen läuft jeder Schritt
// nacheinander mit dem Paket jeder Sprache (die erste ist die Hauptsprache: Stemming).
// Die Muster selbst stehen je Sprache in lang/<code>.js.

import {
  addDays, addMonths, isoWeekOf, isoWeekStart, periodOf, startOfDay, subtractUnits,
} from "./dates.js";
import { stemWith } from "./stem.js";
import { norm, sanitizeTerm } from "../util/normalize.js";
import { alt, fragments, B, E } from "./lang/common.js";
import { resolvePacks } from "./lang/index.js";

const re = (src) => new RegExp(src, "giu");

export function emptyQuery(raw = "") {
  return {
    raw,
    terms: [], // UND-Verknüpfung von ODER-Gruppen: [["speiseplan","stundenplan"],["kw"]]
    phrases: [],
    exclude: [],
    subjectTerms: [],
    from: [],
    to: [],
    involves: [],
    dateFrom: null, // ms, inklusiv
    dateTo: null, // ms, exklusiv
    hasAttachment: null,
    attachmentTypes: [],
    unread: null,
    flagged: null,
    tags: [],
    folder: null, // { type } oder { name }
  };
}

// ---------------------------------------------------------------- Kontext je Anfrage

const ctxCache = new Map();

/** Alles, was aus den Sprachpaketen abgeleitet wird (zwischengespeichert je Sprachkombination). */
function buildContext(codes) {
  const key = codes.join(",");
  if (ctxCache.has(key)) return ctxCache.get(key);
  const packs = resolvePacks(codes);
  const months = {};
  const filler = new Set();
  const notAName = new Set();
  const orWords = new Set();
  const notWords = new Set();
  // Operatoren: universelle englische Namen plus die Namen aller Sprachen
  const opAliases = {
    from: ["from", "f"], to: ["to", "cc"], with: [], subject: ["subject"], attachment: ["attachment", "att", "anh"],
    text: ["text", "body"], is: ["is"], tag: ["tag"], folder: ["folder"], since: ["since", "after"], until: ["until", "before"], date: ["date"],
  };
  const vals = {
    meFrom: ["me", "i"], meTo: ["me"], no: ["no", "false"], unread: ["unread"], read: ["read"], flagged: ["flagged", "starred"],
  };
  const units = [];
  for (const pack of packs) {
    Object.assign(months, pack.months);
    for (const w of pack.filler) filler.add(w);
    for (const w of pack.notAName ?? []) notAName.add(w);
    for (const w of pack.orWords) orWords.add(w);
    for (const w of pack.notWords) notWords.add(w);
    for (const [k, list] of Object.entries(pack.ops)) opAliases[k] = [...(opAliases[k] ?? []), ...list];
    for (const [k, list] of Object.entries(pack.vals)) vals[k] = [...(vals[k] ?? []), ...list];
    units.push(...pack.units);
  }
  for (const w of filler) notAName.add(w);
  const opKind = {};
  for (const [kind, list] of Object.entries(opAliases)) for (const a of list) opKind[a.toLowerCase()] = kind;
  const perPack = packs.map((pack) => {
    const f = fragments(pack);
    return { pack, f, p: pack.patterns(f) };
  });
  const ctx = {
    packs,
    perPack,
    months,
    monthRe: alt(Object.keys(months)),
    filler,
    notAName,
    orWords,
    notWords,
    opKind,
    opRe: alt(Object.keys(opKind).map((a) => a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))),
    vals: Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, new Set(v.map((x) => x.toLowerCase()))])),
    unitOf: (word) => {
      const w = word.toLowerCase();
      return units.find((u) => u.words.includes(w))?.unit ?? null;
    },
    isPlural: (word) => {
      const w = word.toLowerCase();
      return units.some((u) => (u.plural ?? []).includes(w));
    },
    numberOf: (word) => {
      const w = word.toLowerCase();
      if (/^\d+$/.test(w)) return Number(w);
      for (const pack of packs) {
        if (pack.half && new RegExp(`^(?:${pack.half})$`, "iu").test(w)) return 0.5;
        if (pack.numbers[w] != null) return pack.numbers[w];
      }
      return null;
    },
    stem: stemWith(packs[0]),
  };
  ctxCache.set(key, ctx);
  return ctx;
}

// ---------------------------------------------------------------- Hilfen

function mergeDate(q, from, to) {
  if (from != null) q.dateFrom = q.dateFrom == null ? +from : Math.max(q.dateFrom, +from);
  if (to != null) q.dateTo = q.dateTo == null ? +to : Math.min(q.dateTo, +to);
}

function addPerson(list, person) {
  const key = (p) => (p.me ? "#me" : norm(p.email ?? p.name));
  if (!list.some((p) => key(p) === key(person))) list.push(person);
}

function personFromToken(token, ctx) {
  const t = token.replace(/^["'„“«»]+|["'„“«».,;:!?]+$/g, "");
  if (!t) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) return { email: t.toLowerCase() };
  if (ctx.notAName.has(norm(t))) return null;
  if (!/^\p{L}/u.test(t)) return null;
  return { name: t };
}

/** Jahr zu einem Monat ohne Jahresangabe: der letzte vergangene bzw. aktuelle. */
function inferYearForMonth(month, today) {
  const y = today.getFullYear();
  return month > today.getMonth() + 1 ? y - 1 : y;
}

/** "3.4.", "03.04.2026", "3.4.26", "15/03/2026", "3/15" -> Date (Tagesbeginn) oder null */
function parseNumericDate(s, today, order) {
  const m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})?$/.exec(s) ?? /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(s);
  if (!m) return null;
  let day = Number(m[1]);
  let month = Number(m[2]);
  if (order === "mdy" && s.includes("/")) [day, month] = [month, day];
  if (day < 1 || day > 31 || month < 1 || month > 12) return null;
  let year;
  if (m[3]) {
    year = Number(m[3]);
    if (year < 100) year += 2000;
  } else {
    year = today.getFullYear();
    if (new Date(year, month - 1, day) > today) year -= 1;
  }
  const d = new Date(year, month - 1, day);
  if (d.getMonth() !== month - 1) return null; // 31.02. o. ä.
  return d;
}

function parseIsoDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
}

/**
 * Zeitpunkt-Ausdruck -> [from, to) des gemeinten Zeitraums.
 * Unterstützt: Monat [Jahr], Datum, Jahr, ISO-Datum.
 */
function parseTimeAnchor(text, ctx) {
  const { today } = ctx;
  const s = text.trim().toLowerCase();
  let m;
  // NovaBird-Search-Schreibweise: 7t, 3w, 6m, 1j (Tage/Wochen/Monate/Jahre zurück)
  if ((m = /^(\d{1,3})([twmj])$/.exec(s))) {
    const unit = { t: "day", w: "week", m: "month", j: "year" }[m[2]];
    const f = subtractUnits(today, unit, Number(m[1]));
    return [f, addDays(today, 1)];
  }
  const withYear = (day, month, y) => {
    let year = y ? Number(y) : today.getFullYear();
    if (!y && new Date(year, month - 1, day) > today) year -= 1;
    const d = new Date(year, month - 1, day);
    return d.getMonth() === month - 1 ? [d, addDays(d, 1)] : null;
  };
  // 15 March (2026) / 15th of March / 15 de marzo de 2026
  if ((m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th|er)?\\s+(?:of\\s+|de\\s+)?(${ctx.monthRe})(?:,?\\s+(?:de\\s+)?(\\d{4}))?$`, "u").exec(s))) {
    return withYear(Number(m[1]), ctx.months[m[2]], m[3]);
  }
  // March 15 / March 15th, 2026
  if ((m = new RegExp(`^(${ctx.monthRe})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?$`, "u").exec(s))) {
    return withYear(Number(m[2]), ctx.months[m[1]], m[3]);
  }
  if ((m = new RegExp(`^(${ctx.monthRe})(?:\\s+(?:de\\s+)?(\\d{4}))?$`, "u").exec(s))) {
    const month = ctx.months[m[1]];
    const year = m[2] ? Number(m[2]) : inferYearForMonth(month, today);
    const f = new Date(year, month - 1, 1);
    return [f, addMonths(f, 1)];
  }
  if ((m = /^(\d{4})$/.exec(s))) {
    const y = Number(m[1]);
    return [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
  }
  const d = parseNumericDate(s, today, ctx.dateOrder) ?? parseIsoDate(s);
  if (d) return [d, addDays(d, 1)];
  return null;
}

// ---------------------------------------------------------------- Schritte

/** Operatoren für Profis: von:jonas an:petra betreff:x anhang:pdf ist:ungelesen tag:x ordner:x seit:… bis:… (je Sprache + englisch) */
function extractOperators(rest, q, ctx) {
  const findFolder = (v) => {
    for (const pack of ctx.packs) {
      const f = pack.folders.find((x) => new RegExp(`^(?:${x.re})$`, "iu").test(v));
      if (f) return f;
    }
    return null;
  };
  return rest.replace(
    re(`${B}(${ctx.opRe})\\s*:\\s*("[^"]*"|„[^“]*“|«[^»]*»|\\S+)`),
    (_, op, rawValue) => {
      const value = rawValue.replace(/^["„«]\s*|\s*["“»]$/g, "").trim();
      const v = value.toLowerCase();
      switch (ctx.opKind[op.toLowerCase()]) {
        case "from": {
          if (ctx.vals.meFrom.has(v)) addPerson(q.from, { me: true });
          else if (value) addPerson(q.from, value.includes("@") ? { email: v } : { name: value });
          break;
        }
        case "to":
        case "cc": {
          if (ctx.vals.meTo.has(v)) addPerson(q.to, { me: true });
          else if (value) addPerson(q.to, value.includes("@") ? { email: v } : { name: value });
          break;
        }
        case "with":
          if (value) addPerson(q.involves, value.includes("@") ? { email: v } : { name: value });
          break;
        case "subject":
          for (const w of sanitizeTerm(value).split(/\s+/).filter(Boolean)) q.subjectTerms.push(ctx.stem(w));
          break;
        case "attachment":
          if (ctx.vals.no.has(v)) q.hasAttachment = false;
          else {
            q.hasAttachment = true;
            for (const pack of ctx.packs) {
              const t = pack.attachmentTypes.find((a) => new RegExp(`^(?:${a.re})$`, "iu").test(v));
              if (t) {
                if (!q.attachmentTypes.includes(t.type)) q.attachmentTypes.push(t.type);
                break;
              }
            }
          }
          break;
        case "text":
          // NovaBird-Search-Schreibweise: Begriff im Text (hier wie freier Suchbegriff)
          for (const w of sanitizeTerm(value).split(/\s+/).filter(Boolean)) q.terms.push([ctx.stem(w)]);
          break;
        case "is":
          if (ctx.vals.unread.has(v)) q.unread = true;
          else if (ctx.vals.read.has(v)) q.unread = false;
          else if (ctx.vals.flagged.has(v)) q.flagged = true;
          break;
        case "tag":
          if (value) q.tags.push(value);
          break;
        case "folder": {
          const f = findFolder(v);
          q.folder = f ? { type: f.type } : { name: value };
          break;
        }
        case "since": {
          const r = parseTimeAnchor(value, ctx);
          if (r) mergeDate(q, r[0], null);
          break;
        }
        case "until": {
          const r = parseTimeAnchor(value, ctx);
          if (r) mergeDate(q, null, r[1]);
          break;
        }
        case "date": {
          // date:2026-03-01..2026-03-31 oder datum:märz
          const [a, b] = value.split("..");
          const ra = parseTimeAnchor(a, ctx);
          const rb = b ? parseTimeAnchor(b, ctx) : ra;
          if (ra && rb) mergeDate(q, ra[0], rb[1]);
          break;
        }
      }
      return " ";
    },
  );
}

function extractPhrases(rest, q) {
  return rest.replace(/"([^"]+)"|„([^“”"]+)[“”"]|«([^»]+)»/g, (_, a, b, c) => {
    const p = sanitizeTerm(a ?? b ?? c).toLowerCase();
    if (p) q.phrases.push(p);
    return " ";
  });
}

function extractDates(rest, q, ctx, entry) {
  const { today } = ctx;
  const { pack, f, p } = entry;
  const d = p.dates;
  const range = (a, b) => {
    const ra = parseTimeAnchor(a, ctx);
    const rb = parseTimeAnchor(b, ctx);
    if (!ra || !rb) return false;
    mergeDate(q, ra[0], rb[1]);
  };
  const anchorFrom = (a) => {
    const r = parseTimeAnchor(a, ctx);
    if (!r) return false;
    mergeDate(q, r[0], null);
  };
  const anchorTo = (a) => {
    const r = parseTimeAnchor(a, ctx);
    if (!r) return false;
    mergeDate(q, null, r[1]);
  };
  const steps = [
    [d.between, range], // zwischen Mai und Juli / zwischen 1.3. und 15.3.
    [d.range, range], // vom 1.3. bis 15.3. / 1.3.-15.3. / von März bis Mai
    [d.lastN, (num, unit) => { // in den letzten 6 Monaten / der letzten zwei Wochen / im letzten halben Jahr
      const n = ctx.numberOf(num);
      const u = ctx.unitOf(unit);
      if (n == null || !u) return false;
      if (n === 0.5) {
        if (u !== "year") return false;
        mergeDate(q, subtractUnits(today, "month", 6), null);
        return;
      }
      mergeDate(q, subtractUnits(today, u, n), null);
    }],
    [d.sinceN, (num, unit) => { // seit 3 Wochen / seit zwei Monaten
      const n = ctx.numberOf(num);
      const u = ctx.unitOf(unit);
      if (n == null || !u || n === 0.5) return false;
      mergeDate(q, subtractUnits(today, u, n), null);
    }],
    [d.agoN, (num, unit) => { // vor 3 Wochen -> Fenster um diesen Zeitpunkt (eine Einheit davor bis eine danach)
      const n = ctx.numberOf(num);
      const u = ctx.unitOf(unit);
      if (n == null || !u || n === 0.5) return false;
      mergeDate(q, subtractUnits(today, u, n + 1), subtractUnits(today, u, Math.max(n - 1, 0)));
      if (n - 1 <= 0) mergeDate(q, null, addDays(today, 1));
    }],
    [d.lastUnit, (u1, u2) => { // letzte Woche / letzten Monat / letztes Jahr (Kalenderperiode); Plural -> Standardfenster
      const unit = u1 ?? u2;
      const u = ctx.unitOf(unit);
      if (!u) return false;
      if (ctx.isPlural(unit)) {
        const defaults = { day: 7, week: 4, month: 3, quarter: 2, year: 2 };
        mergeDate(q, subtractUnits(today, u, defaults[u]), null);
        return;
      }
      const [curStart] = periodOf(today, u); // Beginn der aktuellen Periode
      const [pf, pt] = periodOf(addDays(curStart, -1), u); // Vorperiode
      mergeDate(q, pf, pt);
    }],
    [d.thisUnit, (u1, u2) => { // diese Woche / diesen Monat / dieses Jahr
      const u = ctx.unitOf(u1 ?? u2);
      if (!u) return false;
      const [from, to] = periodOf(today, u);
      mergeDate(q, from, to);
    }],
    [d.relDay, (w) => { // heute / gestern / vorgestern
      const offset = pack.relDays[w.toLowerCase().replace(/’/g, "'")];
      if (offset == null) return false;
      const day = addDays(today, offset);
      mergeDate(q, day, addDays(day, 1));
    }],
    [d.week, (w, y) => { // KW 14 / KW14 2025 / Kalenderwoche 14
      const week = Number(w);
      if (week < 1 || week > 53) return false;
      const cur = isoWeekOf(today);
      const year = y ? Number(y) : week > cur.week ? cur.year - 1 : cur.year;
      const start = isoWeekStart(year, week);
      mergeDate(q, start, addDays(start, 7));
    }],
    [d.since, anchorFrom], // seit/ab März, seit 1.3., seit 2025
    [d.until, anchorTo], // bis März / bis zum 15.3.
    [d.onDate, (a) => { // am 3.4. / 03.04.2026 / 2026-04-03
      const r = parseTimeAnchor(a, ctx);
      if (!r) return false;
      mergeDate(q, r[0], r[1]);
    }],
    [d.monthIn, (m1, y1, m2, y2) => { // im Mai / im Mai 2025 / aus dem März / Mai 2025 (bloßer Monat nur MIT Jahr)
      const r = parseTimeAnchor(`${m1 ?? m2}${(y1 ?? y2) ? " " + (y1 ?? y2) : ""}`, ctx);
      if (!r) return false;
      mergeDate(q, r[0], r[1]);
    }],
    [d.year, (y) => { // aus 2025 / im Jahr 2025 / 2025
      const r = parseTimeAnchor(y, ctx);
      mergeDate(q, r[0], r[1]);
    }],
  ];
  for (const [srcs, handler] of steps) {
    for (const src of [srcs].flat().filter(Boolean)) { // ein Schritt kann mehrere Schreibweisen haben (gleiche Gruppen)
      rest = rest.replace(re(src), (match, ...groups) => {
        const caps = groups.slice(0, -2).filter((g) => typeof g !== "object");
        const ok = handler(...caps.slice(0, Math.max(handler.length, 1)));
        return ok === false ? match : " ";
      });
    }
  }
  return rest;
}

function extractAttachments(rest, q, ctx, entry) {
  const { pack, p } = entry;
  const a = p.attach;
  rest = rest.replace(re(a.without), () => {
    q.hasAttachment = false;
    return " ";
  });
  rest = rest.replace(re(a.with), () => {
    q.hasAttachment = true;
    return " ";
  });
  for (const { type, re: tre } of pack.attachmentTypes) {
    rest = rest.replace(re(a.type(tre)), () => {
      q.hasAttachment = true;
      if (!q.attachmentTypes.includes(type)) q.attachmentTypes.push(type);
      return " ";
    });
  }
  return rest;
}

function extractStatus(rest, q, ctx, entry) {
  const s = entry.p.status;
  rest = rest.replace(re(s.unread), () => {
    q.unread = true;
    return " ";
  });
  rest = rest.replace(re(s.read), () => {
    q.unread = false;
    return " ";
  });
  rest = rest.replace(re(s.flagged), () => {
    q.flagged = true;
    return " ";
  });
  rest = rest.replace(re(s.tag), (m, t) => {
    const tag = t.replace(/^"|"$/g, "");
    if (ctx.notAName.has(norm(tag)) && !/^".*"$/.test(t)) return m;
    q.tags.push(tag);
    return " ";
  });
  return rest;
}

function extractPersons(rest, q, ctx, entry) {
  const pr = entry.p.persons;
  rest = rest.replace(re(pr.fromMe), () => (addPerson(q.from, { me: true }), " "));
  rest = rest.replace(re(pr.toMe), () => (addPerson(q.to, { me: true }), " "));
  // "die ich (an X) geschickt habe"
  rest = rest.replace(re(pr.iSent), (m, name) => {
    addPerson(q.from, { me: true });
    if (name) {
      const person = personFromToken(name, ctx);
      if (person) addPerson(q.to, person);
    }
    return " ";
  });
  // "was hat Jonas (mir) geschickt"
  for (const src of [pr.heSent].flat()) {
    rest = rest.replace(re(src), (m, name) => {
      const person = personFromToken(name, ctx);
      if (!person) return m;
      addPerson(q.from, person);
      return " ";
    });
  }
  // "von X", "an X", "cc X", "mit X"
  for (const [word, key, capsOnly] of pr.roles) {
    const list = q[key];
    rest = rest.replace(re(pr.rolePattern(word)), (m, name) => {
      // „de“/„a“ (fr/es) sind auch Verhältniswörter ("notes de réunion"): nur Eigennamen oder Adressen zählen als Person
      if (capsOnly && !/^\p{Lu}/u.test(name) && !name.includes("@")) return m;
      const person = personFromToken(name, ctx);
      if (!person) return m;
      addPerson(list, person);
      return " ";
    });
  }
  return rest;
}

function extractFolder(rest, q, ctx, entry) {
  const { pack, p } = entry;
  for (const { type, re: fre } of pack.folders) {
    rest = rest.replace(re(p.folder.wrap(fre)), () => {
      if (!q.folder) q.folder = { type };
      return " ";
    });
  }
  rest = rest.replace(re(p.folder.named), (m, name) => {
    q.folder = { name: name.replace(/^"|"$/g, "") };
    return " ";
  });
  return rest;
}

function extractTerms(rest, q, ctx) {
  const tokens = rest
    .split(/\s+/)
    .map((t) => t.replace(/^[^\p{L}\p{N}-]+|[^\p{L}\p{N}]+$/gu, ""))
    .filter(Boolean);
  let pendingOr = false;
  let negateNext = false;
  for (const tok of tokens) {
    const low = tok.toLowerCase();
    if (ctx.orWords.has(low) || tok === "OR") {
      pendingOr = q.terms.length > 0;
      continue;
    }
    if (ctx.notWords.has(low)) {
      negateNext = true;
      continue;
    }
    let word = tok;
    let negative = negateNext;
    negateNext = false;
    if (word.startsWith("-") && word.length > 1) {
      negative = true;
      word = word.slice(1);
    }
    const clean = sanitizeTerm(word).toLowerCase();
    if (!clean) continue;
    const n = norm(clean);
    if (!negative && (ctx.filler.has(n) || ctx.filler.has(n.replace(/\s+/g, "")))) {
      pendingOr = false;
      continue;
    }
    // Bindestrich-Wörter (z. B. "ERP-Wartung") wurden zu "erp wartung":
    // als Phrase behandeln, damit beide Teile nebeneinander stehen müssen.
    if (clean.includes(" ")) {
      if (negative) q.exclude.push(clean);
      else q.phrases.push(clean);
      pendingOr = false;
      continue;
    }
    if (clean.length < 2) continue;
    const s = ctx.stem(clean);
    if (negative) {
      q.exclude.push(s);
      continue;
    }
    if (pendingOr && q.terms.length) {
      const last = q.terms[q.terms.length - 1];
      if (!last.includes(s)) last.push(s);
    } else if (!q.terms.some((g) => g.length === 1 && g[0] === s)) {
      q.terms.push([s]);
    }
    pendingOr = false;
  }
}

// ---------------------------------------------------------------- Einstieg

/**
 * @param {string} input
 * @param {{ now?: Date|number, langs?: string[], dateOrder?: "dmy"|"mdy" }} options
 *   langs: Sprachen der Anfrage (Standard ["de"]); die erste ist die Hauptsprache.
 *   dateOrder: Reihenfolge bei 3/4/2026 (Standard dmy; mdy für US-Englisch).
 */
export function parseQuery(input, options = {}) {
  const now = options.now != null ? new Date(options.now) : new Date();
  const ctx = Object.create(buildContext(options.langs?.length ? options.langs : ["de"]));
  ctx.today = startOfDay(now);
  ctx.dateOrder = options.dateOrder === "mdy" ? "mdy" : "dmy";
  const q = emptyQuery(String(input ?? ""));
  let rest = ` ${q.raw.replace(/\s+/g, " ")} `;

  rest = extractOperators(rest, q, ctx);
  rest = extractPhrases(rest, q);
  for (const step of [extractDates, extractAttachments, extractStatus, extractPersons, extractFolder]) {
    for (const entry of ctx.perPack) rest = step(rest, q, ctx, entry);
  }
  extractTerms(rest, q, ctx);

  if (q.attachmentTypes.length) q.hasAttachment = true;
  return q;
}

/** Ist die Anfrage leer (keine Bedingung)? */
export function isEmptyQuery(q) {
  return (
    !q.terms.length && !q.phrases.length && !q.subjectTerms.length && !q.exclude.length &&
    !q.from.length && !q.to.length && !q.involves.length && q.dateFrom == null &&
    q.dateTo == null && q.hasAttachment == null && q.unread == null && q.flagged == null &&
    !q.tags.length && !q.folder
  );
}
