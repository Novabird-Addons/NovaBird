/* Kontakt-Sammler – reine Logik (ohne Thunderbird-API, testbar) */
(function (root) {
  "use strict";

  const GENERIC = new Set(("info kontakt contact contacts mail email office post praxis service support admin " +
    "hallo hello hi team buero sekretariat verwaltung rechnung rechnungen buchhaltung noreply newsletter sales " +
    "vertrieb bestellung order orders booking reservierung empfang anmeldung termine termin presse hr jobs " +
    "karriere bewerbung webmaster postmaster mailer daemon kundenservice kundendienst zentrale").split(" "));
  const TITLE = new Set("dr prof dipl ing med dent herr frau mr mrs ms mag rer nat".split(" "));
  const COMPANY = /\b(gmbh|ag|kg|ohg|e\.?\s?v|mbh|ug|co|inc|ltd|llc|praxis|klinik|team)\b/i;
  const VALID = /^[^@\s"<>]+@[^@\s"<>]+\.[a-z]{2,}$/i;

  function fold(s) {
    return String(s).toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  }

  /* "Name" <a@b>, c@d  →  [{name, email}] */
  function parseList(str) {
    const out = [];
    if (!str) return out;
    const push = s => {
      s = s.trim();
      if (!s) return;
      const m = s.match(/^(.*?)<\s*([^<>\s]+@[^<>\s]+)\s*>\s*$/);
      if (m) { out.push({ name: m[1].trim(), email: m[2].toLowerCase() }); return; }
      const e = s.match(/([^\s<>"',;]+@[^\s<>"',;]+)/);
      if (e) out.push({ name: "", email: e[1].toLowerCase() });
    };
    let cur = "", q = false, a = false;
    for (const ch of String(str)) {
      if (ch === '"') q = !q;
      else if (ch === "<") a = true;
      else if (ch === ">") a = false;
      if (ch === "," && !q && !a) { push(cur); cur = ""; } else cur += ch;
    }
    push(cur);
    return out;
  }

  /* Ausschlussmuster: eine Zeile = Teilstring, * = beliebig */
  function compileExclusions(text) {
    return String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l =>
      new RegExp(l.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*"), "i"));
  }

  function cleanDisplay(name, email) {
    if (!name) return "";
    let n = String(name).trim().replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ");
    if (!n || n.includes("@") || n.toLowerCase() === email) return "";
    const m = n.match(/^([^,]+),\s*([^,]+)$/);          // "Müller, Thomas" → "Thomas Müller"
    if (m && !COMPANY.test(n)) n = m[2].trim() + " " + m[1].trim();
    return n;
  }

  function record(map, mb, time, own, excl, seen, known, stats) {
    const email = mb.email.replace(/^mailto:/, "").trim();
    if (!VALID.test(email) || own.has(email) || seen.has(email)) return;
    if (excl.some(r => r.test(email))) return;
    if (known && known.has(email)) { if (stats) stats.known.add(email); return; }
    seen.add(email);
    let e = map.get(email);
    if (!e) { e = { email, names: {}, count: 0, last: 0 }; map.set(email, e); }
    e.count++;
    if (time > e.last) e.last = time;
    const n = cleanDisplay(mb.name, email);
    if (n) e.names[n] = (e.names[n] || 0) + 1;
  }

  function nameTokens(name) {
    if (!name) return [];
    return fold(name).replace(/\(.*?\)/g, " ").replace(/[^a-z\s-]/g, " ").replace(/-/g, " ")
      .split(/\s+/).filter(t => t.length > 1 && !TITLE.has(t));
  }

  function localPart(email) { return email.split("@")[0].split("+")[0]; }
  function localKey(email) { return fold(localPart(email)).replace(/[^a-z]/g, ""); }

  function nameFromLocal(email) {
    const m = fold(localPart(email)).match(/^([a-z]{2,})[._-]([a-z]{2,})$/);
    if (!m || GENERIC.has(m[1]) || GENERIC.has(m[2])) return "";
    const cap = s => s[0].toUpperCase() + s.slice(1);
    return cap(m[1]) + " " + cap(m[2]);
  }

  /* bester Anzeigename über mehrere Adressen */
  function bestName(entries) {
    const agg = {};
    for (const e of entries) for (const [n, c] of Object.entries(e.names)) agg[n] = (agg[n] || 0) + c;
    const list = Object.entries(agg).sort((a, b) => {
      const ta = nameTokens(a[0]).length >= 2, tb = nameTokens(b[0]).length >= 2;
      if (ta !== tb) return tb - ta;
      return b[1] - a[1] || b[0].length - a[0].length;
    });
    if (list.length) return list[0][0];
    for (const e of entries) { const n = nameFromLocal(e.email); if (n) return n; }
    return "";
  }

  function lev(a, b) {
    if (Math.abs(a.length - b.length) > 1) return 2;
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
      for (let j = 1; j <= b.length; j++)
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
  }

  /* Duplikat-Vorschläge: Gruppen von Adressen, die wohl zur selben Person gehören */
  function buildProposals(entries, min) {
    const n = entries.length, parent = Array.from({ length: n }, (_, i) => i), edges = [];
    const find = i => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
    const union = (a, b, why) => { if (a === b) return; edges.push([a, why]); parent[find(a)] = find(b); };

    const info = entries.map(e => {
      const toks = nameTokens(bestName([e]));
      const lp = fold(localPart(e.email));
      return { toks, full: toks.length >= 2 ? [...toks].sort().join(" ") : "",
               first: toks[0], last: toks[toks.length - 1], lk: localKey(e.email),
               generic: GENERIC.has(lp.replace(/[^a-z]/g, "")) || GENERIC.has(lp) };
    });
    const bucket = (keyFn) => {
      const m = new Map();
      info.forEach((x, i) => { const k = keyFn(x); if (k) { if (!m.has(k)) m.set(k, []); m.get(k).push(i); } });
      return m;
    };

    // 1) gleicher Name (Reihenfolge egal, Titel ignoriert)
    for (const ids of bucket(x => x.full).values()) for (let k = 1; k < ids.length; k++) union(ids[0], ids[k], "sameName");

    // 2) gleicher Namensteil der Adresse bei anderer Domain (t.mueller@a / tmueller@b)
    for (const ids of bucket(x => (x.lk.length >= 6 && !x.generic) ? x.lk : "").values())
      for (let k = 1; k < ids.length; k++) union(ids[0], ids[k], "sameLocal");

    // 3) Adresse passt zum Namen einer anderen Adresse (tmueller@ ↔ "Thomas Müller")
    const nameKeys = new Map();
    info.forEach((x, i) => {
      if (x.toks.length < 2) return;
      const f = x.first, l = x.last;
      for (const k of [f + l, l + f, f[0] + l, l + f[0]]) if (k.length >= 5) {
        if (!nameKeys.has(k)) nameKeys.set(k, []);
        nameKeys.get(k).push(i);
      }
    });
    info.forEach((x, j) => {
      if (x.generic) return;
      for (const i of nameKeys.get(x.lk) || []) if (i !== j) union(i, j, "localName");
    });

    // 4) ähnlicher Name: gleicher Nachname, Vorname gleich/Kurzform/Tippfehler
    for (const ids of bucket(x => (x.toks.length >= 2 && x.last.length >= 3) ? x.last : "").values()) {
      if (ids.length > 60) continue;              // sehr häufige Nachnamen nicht raten
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) {
        const A = info[ids[a]], B = info[ids[b]];
        if (A.full === B.full) continue;
        const fa = A.first, fb = B.first;
        const sim = fa === fb ||
          (Math.min(fa.length, fb.length) >= 3 && (fa.startsWith(fb) || fb.startsWith(fa))) ||
          (Math.min(fa.length, fb.length) >= 4 && lev(fa, fb) <= 1);
        if (sim) union(ids[a], ids[b], "similar");
      }
    }

    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(i); }
    const reasons = new Map();
    for (const [i, why] of edges) { const r = find(i); if (!reasons.has(r)) reasons.set(r, new Set()); reasons.get(r).add(why); }
    const out = [];
    for (const [r, members] of groups) {
      if (members.length < 2) continue;
      const sum = members.reduce((s, i) => s + entries[i].count, 0);
      if (sum < min) continue;
      members.sort((a, b) => entries[b].count - entries[a].count);
      out.push({ members, reasons: [...(reasons.get(r) || [])], sum });
    }
    return out.sort((a, b) => b.sum - a.sum);
  }

  /* ---------- vCard ---------- */
  const vEsc = s => String(s).replace(/\\/g, "\\\\").replace(/,/g, "\\,").replace(/;/g, "\\;").replace(/\r?\n/g, "\\n");
  function splitName(name) {
    const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
    if (parts.length < 2) return { last: parts[0] || "", given: "", prefix: "" };
    let prefix = [];
    while (parts.length > 2 && TITLE.has(fold(parts[0]).replace(/\./g, ""))) prefix.push(parts.shift());
    const last = parts.pop();
    return { last, given: parts.join(" "), prefix: prefix.join(" ") };
  }
  function buildVCard(name, emails) {
    const L = ["BEGIN:VCARD", "VERSION:4.0"];
    if (name) {
      const s = splitName(name);
      L.push("FN:" + vEsc(name), `N:${vEsc(s.last)};${vEsc(s.given)};;${vEsc(s.prefix)};`);
    }
    emails.forEach((e, i) => L.push(i === 0 ? `EMAIL;PREF=1:${e}` : `EMAIL:${e}`));
    L.push("END:VCARD");
    return L.join("\r\n");
  }
  function vcardEmails(v) {
    const out = [];
    for (const m of String(v || "").matchAll(/^(?:item\d+\.)?EMAIL[^:\r\n]*:(.+)$/gim)) out.push(m[1].trim().toLowerCase().replace(/^mailto:/, ""));
    return out;
  }
  function addEmailsToVCard(v, emails) {
    const nl = v.includes("\r\n") ? "\r\n" : "\n";
    const idx = v.search(/END:VCARD/i);
    return v.slice(0, idx) + emails.map(e => "EMAIL:" + e + nl).join("") + v.slice(idx);
  }

  function similarName(a, b) {
    const ta = nameTokens(a), tb = nameTokens(b);
    if (ta.length < 2 || tb.length < 2) return false;
    const la = ta[ta.length - 1], lb = tb[tb.length - 1], fa = ta[0], fb = tb[0];
    if (la !== lb || la.length < 3) return false;
    return fa === fb ||
      (Math.min(fa.length, fb.length) >= 3 && (fa.startsWith(fb) || fb.startsWith(fa))) ||
      (Math.min(fa.length, fb.length) >= 4 && lev(fa, fb) <= 1);
  }
  function nameKey(name) { const t = nameTokens(name); return t.length >= 2 ? [...t].sort().join(" ") : ""; }

  const api = { fold, nameKey, vEsc, similarName, nameTokens, parseList, compileExclusions, record, bestName, buildProposals, buildVCard, vcardEmails, addEmailsToVCard, splitName };
  if (typeof module !== "undefined") module.exports = api; else root.KSLogic = api;
})(this);
