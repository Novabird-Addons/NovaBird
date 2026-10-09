"use strict";
/* Kontakt-Manager – Bereich „Kontakte zusammenführen“ */
(() => {
  const api = globalThis.messenger || globalThis.browser;
  const L = globalThis.KSLogic;
  const t = (...a) => I18N.t(...a);
  const $ = s => document.querySelector(s);
  const { h, set } = DOM;
  const C = () => CP_API.contacts;
  const I = (n, c) => UI_ICONS.icon(n, c), AV = (n, e, s) => UI_ICONS.avatar(n, e, s);
  const FIELD_IC = { NAME: "user", EMAIL: "mail", TEL: "phone", ADR: "pin", ORG: "building", TITLE: "briefcase", ROLE: "briefcase",
    URL: "globe", IMPP: "chat", BDAY: "cake", ANNIVERSARY: "calendar", NICKNAME: "user", CATEGORIES: "tag", NOTE: "note", PHOTO: "image", _other: "list" };

  const FIELDS = [["EMAIL", "multi"], ["TEL", "multi"], ["ADR", "multi"], ["ORG", "single"], ["TITLE", "single"],
    ["ROLE", "single"], ["URL", "multi"], ["IMPP", "multi"], ["BDAY", "single"], ["ANNIVERSARY", "single"],
    ["NICKNAME", "single"], ["CATEGORIES", "multi"], ["NOTE", "multi"], ["PHOTO", "single"]];
  const KNOWN = new Set(FIELDS.map(f => f[0]));
  const SKIP = new Set(["BEGIN", "END", "VERSION", "PRODID", "REV", "UID", "FN", "N", "KIND", "CLIENTPIDMAP"]);
  const TYPES = new Set(["work", "home", "cell", "fax", "pager", "other"]);

  const M = { books: [], a: { contacts: [], sel: new Set(), search: "", only: null }, b: { contacts: [], sel: new Set(), search: "", only: null },
              dup: { a: new Map(), b: new Map() }, groupKey: { a: new Map(), b: new Map() }, onlyDup: false, merge: null,
              loaded: false, banner: null };

  /* ---------- vCard ---------- */
  function parseVCard(v) {
    const lines = String(v || "").replace(/\r?\n[ \t]/g, "").split(/\r?\n/).filter(Boolean);
    const props = [];
    for (const raw of lines) {
      const i = raw.indexOf(":");
      if (i < 0) continue;
      const parts = raw.slice(0, i).split(";");
      props.push({ name: parts[0].replace(/^[^.]*\./, "").toUpperCase(), params: parts.slice(1), value: raw.slice(i + 1), raw });
    }
    return props;
  }
  const unesc = s => String(s).replace(/\\n/gi, " ").replace(/\\([,;\\])/g, "$1");
  function display(p) {
    if (p.name === "PHOTO") return t("photo");
    if (p.name === "BDAY" || p.name === "ANNIVERSARY") {
      const m = p.value.match(/^(\d{4})-?(\d{2})-?(\d{2})/);
      if (m) return I18N.lang === "de" ? `${m[3]}.${m[2]}.${m[1]}` : `${m[1]}-${m[2]}-${m[3]}`;
    }
    if (p.name === "ADR" || p.name === "N" || p.name === "ORG")
      return p.value.split(/(?<!\\);/).map(unesc).map(s => s.trim()).filter(Boolean).join(", ");
    const v = unesc(p.value).replace(/^(mailto|tel):/i, "");
    return v.length > 140 ? v.slice(0, 140) + " …" : v;
  }
  function typeText(p) {
    const out = [];
    for (const par of p.params) {
      const m = par.match(/^type=(.*)$/i);
      const vals = m ? m[1].replace(/"/g, "").split(",") : (/=/.test(par) ? [] : [par]);
      for (const x of vals) if (TYPES.has(x.toLowerCase())) out.push(t("t_" + x.toLowerCase()));
    }
    return [...new Set(out)].join(", ");
  }
  function norm(p) {
    if (p.name === "EMAIL") return p.value.replace(/^mailto:/i, "").trim().toLowerCase();
    if (p.name === "TEL") {
      let d = p.value.replace(/^tel:/i, "").replace(/[^\d+]/g, "");
      if (d.startsWith("+49")) d = "0" + d.slice(3); else if (d.startsWith("0049")) d = "0" + d.slice(4);
      return d;
    }
    return unesc(p.value).toLowerCase().replace(/\s+/g, " ").trim();
  }
  function toContact(node, book, side) {
    const v = C().vCardOf(node);
    const props = parseVCard(v);
    const get = n => props.find(p => p.name === n);
    const emails = props.filter(p => p.name === "EMAIL").map(norm);
    let fn = get("FN") ? unesc(get("FN").value).trim() : "";
    if (!fn && get("N")) { const n = get("N").value.split(";").map(unesc); fn = [n[1], n[0]].filter(Boolean).join(" "); }
    return { id: node.id, side, book: book.id, bookName: book.name, readOnly: !!book.readOnly, vCard: v, props, fn, emails };
  }

  /* ---------- Adressbücher & Listen ---------- */
  const colOf = side => document.querySelector(`#viewManage .col[data-side="${side}"]`);
  function fillBookSelects() {
    document.querySelectorAll("#viewManage .col").forEach((col, idx) => {
      const sel = col.querySelector(".mBook"), cur = sel.value;
      set(sel, M.books.map(b => h("option", { value: b.id }, b.name + (b.readOnly ? " " + t("readOnlyBook") : ""))));
      if (cur && M.books.some(b => b.id === cur)) sel.value = cur;
      else if (M.books[idx]) sel.value = M.books[idx].id;
    });
  }
  async function loadSide(side) {
    const book = M.books.find(b => b.id === colOf(side).querySelector(".mBook").value);
    M[side].sel.clear();
    if (!book) { M[side].contacts = []; return; }
    let nodes = [];
    try { nodes = await C().list(book.id); } catch (e) { colOf(side).querySelector(".mCount").textContent = e.message; }
    let list = nodes.filter(n => !n.type || n.type === "contact").map(n => toContact(n, book, side));
    if (M[side].only) list = list.filter(c => M[side].only.has(c.id));
    M[side].contacts = list.sort((x, y) => (x.fn || x.emails[0] || "").localeCompare(y.fn || y.emails[0] || "", I18N.locale()));
  }
  async function refresh() {
    M.books = await api.addressBooks.list(false);
    fillBookSelects();
    await Promise.all(["a", "b"].map(loadSide));
    computeDups(); renderLists();
  }

  function computeDups() {
    const byName = $("#mByName").checked, byMail = $("#mByMail").checked, bySim = $("#mBySim").checked;
    const keysOf = c => {
      const k = [];
      if (byMail) c.emails.forEach(e => k.push("e:" + e));
      if (byName) { const nk = L.nameKey(c.fn); if (nk) k.push("n:" + nk); }
      return k;
    };
    const ib = new Map();
    for (const c of M.b.contacts) for (const k of keysOf(c)) { if (!ib.has(k)) ib.set(k, []); ib.get(k).push(c); }
    M.dup = { a: new Map(), b: new Map() };
    const link = (x, y) => {
      if (x.id === y.id) return;
      if (!M.dup.a.has(x.id)) M.dup.a.set(x.id, new Set()); M.dup.a.get(x.id).add(y.id);
      if (!M.dup.b.has(y.id)) M.dup.b.set(y.id, new Set()); M.dup.b.get(y.id).add(x.id);
    };
    for (const c of M.a.contacts) for (const k of keysOf(c)) for (const o of ib.get(k) || []) link(c, o);
    if (bySim) {
      const lastOf = c => { const tk = L.nameTokens(c.fn); return tk.length >= 2 ? tk[tk.length - 1] : ""; };
      const bucket = new Map();
      for (const o of M.b.contacts) { const l = lastOf(o); if (l) { if (!bucket.has(l)) bucket.set(l, []); bucket.get(l).push(o); } }
      for (const c of M.a.contacts) for (const o of bucket.get(lastOf(c)) || []) if (L.similarName(c.fn, o.fn)) link(c, o);
    }
    // gleiche Sortierung zusammengehöriger Kontakte in beiden Listen
    const parent = new Map(), find = x => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
    for (const side of ["a", "b"]) for (const c of M[side].contacts) parent.set(side + ":" + c.id, side + ":" + c.id);
    for (const [id, set] of M.dup.a) for (const o of set) parent.set(find("a:" + id), find("b:" + o));
    const label = new Map();
    for (const side of ["a", "b"]) for (const c of M[side].contacts) {
      const r = find(side + ":" + c.id), n = (c.fn || c.emails[0] || "").toLowerCase();
      if (!label.has(r) || n < label.get(r)) label.set(r, n);
    }
    M.groupKey = { a: new Map(), b: new Map() };
    for (const side of ["a", "b"]) for (const c of M[side].contacts) M.groupKey[side].set(c.id, label.get(find(side + ":" + c.id)) + "\u0000" + find(side + ":" + c.id));
  }

  function renderBanner() {
    const el = $("#mBanner");
    if (!M.banner) { el.hidden = true; return; }
    const { n, a, b } = M.banner;
    const none = M.dup.a.size === 0;
    el.hidden = false;
    el.className = "banner" + (none ? " none" : "");
    set(el, I(none ? "checkcircle" : "info", "big"), h("span", null, none ? t("bannerNone", n, b) : t("bannerCompare", n, a, b)));
  }

  function listItem(side, c) {
    const dup = M.dup[side].has(c.id), sel = M[side].sel.has(c.id);
    return h("li", { class: [dup ? "dup" : "", sel ? "sel" : ""].join(" ").trim() },
      h("label", null,
        h("input", { type: "checkbox", "data-mact": "sel", "data-side": side, "data-id": c.id, checked: sel }),
        AV(c.fn, c.emails[0], "sm"),
        h("span", { class: "nb" },
          h("span", { class: "n" }, c.fn || t("noName"), dup ? h("span", { class: "dupic", title: t("legend") }, I("link")) : null),
          h("span", { class: "e" }, c.emails.join(", ") || "–")),
        dup ? h("button", { type: "button", class: "link pick", "data-mact": "pick", "data-side": side, "data-id": c.id }, t("pick"))
            : h("span")));
  }

  function renderLists() {
    for (const side of ["a", "b"]) {
      const col = colOf(side);
      const q = M[side].search.trim().toLowerCase();
      let list = M[side].contacts.filter(c => !q || c.fn.toLowerCase().includes(q) || c.emails.some(e => e.includes(q)));
      if (M.onlyDup) {
        list = list.filter(c => M.dup[side].has(c.id));
        const gk = M.groupKey[side];
        list = [...list].sort((x, y) => gk.get(x.id).localeCompare(gk.get(y.id), I18N.locale()) || (x.fn || "").localeCompare(y.fn || "", I18N.locale()));
      }
      const shown = list.slice(0, 800);
      const on = col.querySelector(".onlynew");
      on.hidden = !M[side].only;
      if (M[side].only) set(on,
        h("span", null, I("sparkle", "mi"), t("onlyNewChip", M[side].only.size)),
        h("button", { type: "button", class: "link", "data-mact": "showall", "data-side": side }, t("bannerAll")));
      col.querySelector(".mCount").textContent = t("mCount", M[side].contacts.length, M.dup[side].size, M[side].sel.size) +
        (list.length > shown.length ? t("mMore", list.length - shown.length) : "");
      set(col.querySelector(".mList"), shown.length ? shown.map(c => listItem(side, c))
        : h("li", { class: "none" }, h("div", { class: "empty-state small" }, h("span", { class: "es-ico" }, I("book")), h("p", null, t("noContactsList")))));
    }
    const n = M.a.sel.size + M.b.sel.size;
    $("#mMerge").disabled = n < 1;
    set($("#mMerge"), I("merge"), h("span", null, n >= 2 ? t("mergeN", n) : n === 1 ? t("editOne") : t("mergeSel")));
    renderBanner();
  }

  /* ---------- Zusammenführen ---------- */
  function openMerge() {
    const list = [...M.a.contacts.filter(c => M.a.sel.has(c.id)), ...M.b.contacts.filter(c => M.b.sel.has(c.id) && !M.a.sel.has(c.id))];
    if (!list.length) return;
    const cnt = { a: 0, b: 0 };
    list.forEach(c => { c.tag = c.side.toUpperCase() + (++cnt[c.side]); });
    const items = [], byKey = new Map(), nameOpts = [];
    list.forEach((c, k) => {
      const nP = c.props.find(p => p.name === "N");
      if (c.fn) {
        const ex = nameOpts.find(o => o.fn === c.fn);
        if (ex) ex.src.add(k); else nameOpts.push({ fn: c.fn, nRaw: nP ? nP.raw : null, src: new Set([k]) });
      }
      for (const p of c.props) {
        if (SKIP.has(p.name) || p.name.startsWith("X-MOZILLA")) continue;
        const key = p.name + "|" + norm(p);
        if (byKey.has(key)) { byKey.get(key).src.add(k); continue; }
        const it = { key, p, src: new Set([k]), on: true };
        byKey.set(key, it); items.push(it);
      }
    });
    const groups = [];
    for (const [name, mode] of FIELDS) {
      const its = items.filter(i => i.p.name === name);
      if (its.length) groups.push({ name, mode, items: its, choice: its[0].key });
    }
    const other = items.filter(i => !KNOWN.has(i.p.name));
    if (other.length) groups.push({ name: "_other", mode: "multi", items: other });
    const writable = M.books.filter(b => !b.readOnly);
    const firstWritable = list.find(c => !c.readOnly);
    M.merge = { list, groups, nameOpts, nameIdx: 0, fn: nameOpts[0]?.fn || "",
                primary: groups.find(g => g.name === "EMAIL")?.items[0].key || null,
                target: firstWritable ? firstWritable.book : writable[0]?.id, del: list.length > 1 };
    renderMerge();
    $("#mergePanel").scrollIntoView({ behavior: "smooth" });
  }

  const srcChips = src => [...src].map(k => {
    const c = M.merge.list[k];
    return h("span", { class: "src " + c.side, title: c.fn + " · " + c.bookName }, c.tag);
  });

  function fieldOption(g, grp, gi, it) {
    const ty = typeText(it.p);
    const ctl = grp.mode === "single"
      ? h("input", { type: "radio", name: "g" + gi, "data-mact": "single", "data-g": gi, value: it.key, checked: grp.choice === it.key })
      : h("input", { type: "checkbox", "data-mact": "item", "data-key": it.key, checked: it.on });
    const prim = grp.name === "EMAIL"
      ? h("label", { class: "prim" }, h("input", { type: "radio", name: "m_prim", "data-mact": "prim", value: it.key, checked: g.primary === it.key }), t("primary"))
      : null;
    const off = grp.mode === "single" ? grp.choice !== it.key : !it.on;
    return h("div", { class: "fopt" + (off ? " off" : "") },
      h("label", { class: "main" }, ctl,
        h("span", { class: "val" },
          grp.name === "_other" ? [h("b", null, it.p.name), " "] : null,
          display(it.p),
          ty ? h("span", { class: "typ" }, ty) : null)),
      h("span", { class: "right" }, prim, srcChips(it.src)));
  }

  function renderMerge() {
    const g = M.merge, panel = $("#mergePanel");
    if (!g) { panel.hidden = true; return; }
    panel.hidden = false;
    const writable = M.books.filter(b => !b.readOnly);

    const sources = h("div", { class: "sources" }, h("span", { class: "muted" }, t("sources")),
      g.list.map(c => h("span", { class: "srccard" }, AV(c.fn, c.emails[0], "sm"),
        h("span", { class: "sc-txt" },
          h("span", { class: "sc-top" }, h("span", { class: "src " + c.side }, c.tag), c.fn || c.emails[0] || "?"),
          h("small", null, I("book", "mi"), c.bookName)))));

    const nameGroup = h("div", { class: "fgroup" }, h("h3", null, I("user"), t("fl_NAME")),
      g.nameOpts.map((o, i) => h("div", { class: "fopt" },
        h("label", { class: "main" },
          h("input", { type: "radio", name: "m_name", "data-mact": "name", value: String(i), checked: i === g.nameIdx }),
          h("span", { class: "val" }, o.fn)),
        h("span", { class: "right" }, srcChips(o.src)))),
      h("input", { type: "text", class: "fninput", "data-mact": "fn", value: g.fn, placeholder: t("displayNamePh") }));

    const groups = g.groups.map((grp, gi) => h("div", { class: "fgroup" },
      h("h3", null, I(FIELD_IC[grp.name] || "list"), t("fl_" + grp.name)),
      grp.mode === "single" ? h("div", { class: "fopt" },
        h("label", { class: "main" },
          h("input", { type: "radio", name: "g" + gi, "data-mact": "single", "data-g": gi, value: "", checked: grp.choice === "" }),
          h("span", { class: "val muted" }, t("notTake"))), h("span")) : null,
      grp.items.map(it => fieldOption(g, grp, gi, it))));

    const target = h("select", { "data-mact": "target" }, writable.map(b => h("option", { value: b.id }, b.name)));
    target.value = g.target || "";

    set(panel,
      h("h2", null, t(g.list.length > 1 ? "mergeTitle" : "editTitle")),
      sources,
      h("div", { class: "merge-grid" },
        h("div", null, nameGroup, groups),
        h("aside", { class: "preview", id: "mPreview" })),
      h("div", { class: "merge-foot" },
        h("label", { class: "field" }, I("book"), t("saveIn"), target),
        h("label", { class: "check" }, h("input", { type: "checkbox", "data-mact": "del", checked: g.del }), " ", t("delSources")),
        h("div", { class: "info", id: "mInfo" }),
        h("div", { class: "actions", style: { marginTop: "0" } },
          h("button", { type: "button", class: "primary", "data-mact": "save" }, I("save"), t("save")),
          h("button", { type: "button", "data-mact": "close" }, I("x"), t("cancel"))),
        h("div", { id: "mResult" })));
    updatePreview();
  }

  function chosenItems() {
    const out = [];
    for (const grp of M.merge.groups) {
      if (grp.mode === "single") { const it = grp.items.find(i => i.key === grp.choice); if (it) out.push(it); }
      else out.push(...grp.items.filter(i => i.on));
    }
    return out;
  }
  const keepContact = () => M.merge.list.find(c => c.book === M.merge.target && !c.readOnly) || null;
  const sortedEmails = items => items.filter(i => i.p.name === "EMAIL").sort((x, y) => (y.key === M.merge.primary) - (x.key === M.merge.primary));

  function buildFinal() {
    const g = M.merge, keep = keepContact();
    const lines = ["BEGIN:VCARD", "VERSION:4.0"];
    if (keep) lines.push("UID:" + keep.id);
    const fn = g.fn.trim();
    if (fn) {
      lines.push("FN:" + L.vEsc(fn));
      const opt = g.nameOpts[g.nameIdx];
      if (opt && opt.fn === fn && opt.nRaw) lines.push(opt.nRaw.replace(/^[^.:;]*\./, ""));
      else { const s = L.splitName(fn); lines.push(`N:${L.vEsc(s.last)};${L.vEsc(s.given)};;${L.vEsc(s.prefix)};`); }
    }
    const items = chosenItems();
    sortedEmails(items).forEach((it, i) => {
      const params = it.p.params.filter(p => !/^pref(=|$)/i.test(p) && !/^type=pref$/i.test(p));
      if (i === 0) params.push("PREF=1");
      lines.push(["EMAIL", ...params].join(";") + ":" + it.p.value);
    });
    for (const it of items) if (it.p.name !== "EMAIL") lines.push(it.p.raw);
    lines.push("END:VCARD");
    return lines.join("\r\n");
  }

  function updatePreview() {
    const g = M.merge, items = chosenItems(), keep = keepContact();
    const sec = (key, its) => its.length ? h("div", { class: "prow" },
      h("span", { class: "pic" }, I(FIELD_IC[key] || "list")),
      h("div", null, its.map(i => h("div", { class: "pv" }, display(i.p),
        typeText(i.p) ? [" ", h("span", { class: "muted" }, "· " + typeText(i.p))] : null)))) : null;
    const em = sortedEmails(items);
    const org = items.find(i => i.p.name === "ORG");
    set($("#mPreview"),
      h("div", { class: "phead" }, AV(g.fn, em[0] ? norm(em[0].p) : "", "lg"), h("h4", null, g.fn || t("noName")),
        org ? h("span", { class: "muted" }, display(org.p)) : null),
      sec("EMAIL", em),
      FIELDS.filter(f => f[0] !== "EMAIL").map(f => sec(f[0], items.filter(i => i.p.name === f[0]))),
      sec("_other", items.filter(i => !KNOWN.has(i.p.name))));
    const book = M.books.find(b => b.id === g.target)?.name || "";
    const others = g.list.filter(c => c !== keep);
    const delable = others.filter(c => !c.readOnly), locked = others.filter(c => c.readOnly);
    const tags = l => l.map(c => c.tag).join(", ");
    let txt = keep ? t("infoUpdate", keep.tag, book) : t("infoNew", book);
    if (g.del && delable.length) txt += t("infoDel", tags(delable), delable.length);
    if (!g.del && others.length) txt += t("infoKeep", tags(others), others.length);
    if (g.del && locked.length) txt += t("infoLocked", tags(locked));
    set($("#mInfo"), I("info"), h("span", null, txt));
  }

  async function saveMerge() {
    const g = M.merge, keep = keepContact();
    if (!g.target) { alert(t("noWritable")); return; }
    const toDelete = g.del ? g.list.filter(c => c !== keep && !c.readOnly) : [];
    if (toDelete.length && !confirm(t("confirmDel", toDelete.length))) return;
    try {
      const v = buildFinal();
      let newId = null;
      if (keep) await C().update(keep.id, v);
      else newId = await C().create(g.target, v);
      for (const c of toDelete) { await C().delete(c.id); M.a.only?.delete(c.id); M.b.only?.delete(c.id); }
      // neu angelegten Kontakt im „nur neue“-Filter behalten
      for (const side of ["a", "b"]) if (M[side].only && newId && colOf(side).querySelector(".mBook").value === g.target) M[side].only.add(newId);
      CPLog.add(`Zusammenführen: ${keep ? "bestehender Kontakt aktualisiert" : "neuer Kontakt angelegt"}, ${toDelete.length} gelöscht`);
      M.merge = null;
      $("#mergePanel").hidden = true;
      await refresh();
      alert(t("saved"));
    } catch (e) {
      set($("#mResult"), h("div", { class: "result" }, h("ul", null, h("li", null, I("alert", "mi"), e.message))));
    }
  }

  /* ---------- Öffentliche Schnittstelle ---------- */
  globalThis.KSManager = {
    async activate() { if (!M.loaded) { M.loaded = true; await refresh(); } },
    async openCompare(bookA, bookB, newIds) {
      M.loaded = true;
      M.books = await api.addressBooks.list(false);
      fillBookSelects();
      colOf("a").querySelector(".mBook").value = bookA;
      colOf("b").querySelector(".mBook").value = bookB;
      M.a.only = new Set(newIds); M.b.only = null;
      M.a.search = M.b.search = "";
      document.querySelectorAll("#viewManage .mSearch").forEach(s => s.value = "");
      $("#mOnlyDup").checked = M.onlyDup = true;
      $("#mByName").checked = $("#mByMail").checked = $("#mBySim").checked = true;
      M.merge = null; $("#mergePanel").hidden = true;
      await Promise.all(["a", "b"].map(loadSide));
      M.banner = { n: newIds.length, a: M.books.find(b => b.id === bookA)?.name || "", b: M.books.find(b => b.id === bookB)?.name || "" };
      computeDups(); renderLists();
    }
  };

  /* ---------- Events ---------- */
  document.addEventListener("DOMContentLoaded", () => {
    I18N.onChange(() => { if (!M.loaded) return; fillBookSelects(); renderLists(); if (M.merge) renderMerge(); });
    for (const side of ["a", "b"]) {
      const col = colOf(side);
      col.querySelector(".mBook").addEventListener("change", async () => {
        M[side].only = null; M.banner = null;
        await loadSide(side); computeDups(); renderLists();
      });
      col.querySelector(".mSearch").addEventListener("input", e => { M[side].search = e.target.value; renderLists(); });
      col.addEventListener("change", e => {
        const el = e.target; if (el.dataset.mact !== "sel") return;
        el.checked ? M[side].sel.add(el.dataset.id) : M[side].sel.delete(el.dataset.id);
        renderLists();
      });
      col.addEventListener("click", async e => {
        const b = e.target.closest("[data-mact=pick],[data-mact=showall]"); if (!b) return;
        e.preventDefault();
        if (b.dataset.mact === "showall") { M[side].only = null; M.banner = null; await loadSide(side); computeDups(); renderLists(); return; }
        const os = side === "a" ? "b" : "a";
        M[side].sel.add(b.dataset.id);
        for (const id of M.dup[side].get(b.dataset.id) || []) M[os].sel.add(id);
        renderLists();
      });
    }
    $("#mOnlyDup").addEventListener("change", e => { M.onlyDup = e.target.checked; renderLists(); });
    for (const id of ["#mByName", "#mByMail", "#mBySim"]) $(id).addEventListener("change", () => {
      if (!$("#mByName").checked && !$("#mByMail").checked && !$("#mBySim").checked) $("#mByMail").checked = true;
      computeDups(); renderLists();
    });
    $("#mMerge").addEventListener("click", openMerge);

    const panel = $("#mergePanel");
    panel.addEventListener("change", e => {
      const el = e.target, g = M.merge; if (!g) return;
      switch (el.dataset.mact) {
        case "name": g.nameIdx = +el.value; g.fn = g.nameOpts[g.nameIdx].fn; panel.querySelector(".fninput").value = g.fn; break;
        case "single": g.groups[+el.dataset.g].choice = el.value; break;
        case "item": g.groups.flatMap(x => x.items).find(i => i.key === el.dataset.key).on = el.checked; break;
        case "prim": g.primary = el.value; { const it = g.groups.flatMap(x => x.items).find(i => i.key === el.value); if (it) it.on = true; } break;
        case "target": g.target = el.value; break;
        case "del": g.del = el.checked; break;
        default: return;
      }
      if (["single", "item", "prim"].includes(el.dataset.mact)) renderMerge(); else updatePreview();
    });
    panel.addEventListener("input", e => { if (e.target.dataset.mact === "fn") { M.merge.fn = e.target.value; updatePreview(); } });
    panel.addEventListener("click", e => {
      const b = e.target.closest("button[data-mact]"); if (!b) return;
      if (b.dataset.mact === "save") saveMerge();
      if (b.dataset.mact === "close") { M.merge = null; panel.hidden = true; }
    });
  });
})();
