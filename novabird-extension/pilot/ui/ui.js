"use strict";
/* Kontakt-Manager – Bereich „Kontakte aus E-Mails sammeln“ */
const api = globalThis.messenger || globalThis.browser;
const L = globalThis.KSLogic;
const t = (...a) => I18N.t(...a);
const $ = s => document.querySelector(s);
const I = (n, c) => UI_ICONS.icon(n, c), AV = (n, e, s) => UI_ICONS.avatar(n, e, s);
const FOLDER_IC = { inbox: "inbox", sent: "sent", archives: "archive", trash: "trash", junk: "junk", drafts: "drafts", templates: "note", outbox: "sent" };
const { h, set } = DOM;
const emptyState = (ic, text) => h("div", { class: "empty-state" }, h("span", { class: "es-ico" }, I(ic)), h("p", null, text));
const fmtDate = ts => ts ? new Date(ts).toLocaleDateString(I18N.locale(), { month: "2-digit", year: "numeric" }) : "–";
const fmtNum = n => Number(n).toLocaleString(I18N.locale());

const DEFAULT_ON = new Set(["inbox", "sent", "archives"]);
const KNOWN_USE = new Set(["inbox", "sent", "archives", "trash", "junk", "drafts", "templates", "outbox"]);

const S = { folders: [], own: new Set(), books: [], cmpSel: null, entries: [], proposals: [], seq: 0, cancel: false,
            include: new Map(), nameOv: new Map(), marked: new Set(), min: 3, view: "open", search: "",
            scanned: false, knownCount: 0 };

const folderUse = f => (Array.isArray(f.specialUse) && f.specialUse[0]) || f.type || "";

/* ---------------- Navigation ---------------- */
function showView(name) {
  document.querySelectorAll(".mainnav button").forEach(x => x.classList.toggle("active", x.dataset.main === name));
  $("#viewCollect").hidden = name !== "collect";
  $("#viewManage").hidden = name !== "manage";
  $("#viewClean").hidden = name !== "clean";
  if (name === "manage") globalThis.KSManager?.activate();
  const pick = $("#folderPick");   // eine Ordnerauswahl für „Sammeln“ und „Aufräumen“
  if (name === "clean") { $("#cFolders").append(pick); globalThis.KSClean?.activate(); }
  else if (pick.parentElement.id === "cFolders") $("#step1 .grid > div:first-child h3:first-child").after(pick);
  window.scrollTo(0, 0);
}

/* ---------------- Adressbücher ---------------- */
async function readContacts(bookIds) {
  const out = [];
  for (const b of S.books.filter(b => bookIds.includes(b.id))) {
    let cs = [];
    try { cs = await CP_API.contacts.list(b.id); } catch { continue; }
    for (const ct of cs) {
      if (ct.type && ct.type !== "contact") continue;
      const v = CP_API.contacts.vCardOf(ct);
      const emails = new Set(L.vcardEmails(v));
      out.push({ id: ct.id, vCard: v, emails, readOnly: !!b.readOnly, book: b.name });
    }
  }
  return out;
}

async function loadBooks() {
  S.books = await api.addressBooks.list(false);
  if (!S.cmpSel) { S.cmpSel = new Set(S.books.map(b => b.id)); S.seenBooks = new Set(S.cmpSel); }
  for (const b of S.books) if (!S.seenBooks.has(b.id)) { S.seenBooks.add(b.id); S.cmpSel.add(b.id); }  // neue Adressbücher automatisch abgleichen
  for (const id of [...S.cmpSel]) if (!S.books.some(b => b.id === id)) S.cmpSel.delete(id);
  renderCmpBooks();
  renderBookSelects();
}

function renderCmpBooks() {
  const all = S.books.length && S.books.every(b => S.cmpSel.has(b.id));
  set($("#cmpBooks"),
    h("label", { class: "check allrow" }, h("input", { type: "checkbox", "data-cmp": "all", checked: !!all }), " ", t("allBooks")),
    S.books.map(b => h("label", { class: "check" },
      h("input", { type: "checkbox", "data-cmp": b.id, checked: S.cmpSel.has(b.id) }), " ", b.name,
      b.readOnly ? [" ", h("span", { class: "tag" }, t("readOnlyTag"))] : null)));
  updateCmpHint();
}
function updateCmpHint() {
  const on = $("#cmpOn").checked;
  $("#cmpBooks").hidden = !on;
  $("#cmpHint").textContent = t(on ? "cmpOnHint" : "cmpOffHint");
}

function renderBookSelects() {
  const sel = $("#book"), cur = sel.value;
  set(sel, h("option", { value: "__new" }, t("newBookOpt")),
    S.books.filter(b => !b.readOnly).map(b => h("option", { value: b.id }, b.name)));
  sel.value = cur && [...sel.options].some(o => o.value === cur) ? cur : "__new";
  $("#newBookWrap").hidden = sel.value !== "__new";
  if (!$("#newBook").value) $("#newBook").value = t("newBookDefault");
  renderDupBook();
}
function renderDupBook() {
  const sel = $("#dupBook"), cur = sel.value, target = $("#book").value;
  const list = S.books.filter(b => b.id !== target);
  set(sel, list.map(b => h("option", { value: b.id }, b.name)));
  const pref = [...(S.cmpSel || [])].find(id => list.some(b => b.id === id));
  sel.value = cur && list.some(b => b.id === cur) ? cur : (pref || list[0]?.id || "");
  $("#optCheckDup").disabled = !list.length;
  if (!list.length) $("#optCheckDup").checked = false;
  $("#dupBookWrap").hidden = !$("#optCheckDup").checked;
  updateSaveLabel();
}

/* ---------------- Ordner ---------------- */
async function loadFolders() {
  const box = $("#folders");
  const accounts = await api.accounts.list(true);
  box.replaceChildren();
  for (const acc of accounts) {
    for (const id of acc.identities || []) if (id.email) S.own.add(id.email.toLowerCase());
    const folders = await CP_API.foldersOf(acc);
    const det = document.createElement("details"); det.open = true;
    const sum = document.createElement("summary"); sum.textContent = acc.name;
    const ul = document.createElement("ul");
    det.append(sum, ul);
    const walk = (list, depth) => {
      for (const f of list || []) {
        const use = folderUse(f);
        const li = document.createElement("li"); li.style.paddingInlineStart = depth * 16 + "px";
        const lab = document.createElement("label");
        const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = DEFAULT_ON.has(use);
        const fi = h("span", { class: "fic" }, I(FOLDER_IC[use] || "folder"));
        lab.append(cb, fi, document.createTextNode(f.name));
        let tag = null;
        if (KNOWN_USE.has(use)) { tag = document.createElement("span"); tag.className = "tag"; tag.textContent = t("f_" + use); lab.append(tag); }
        li.append(lab); ul.append(li);
        S.folders.push({ folder: f, cb, use, tag });
        walk(f.subFolders, depth + 1);
      }
    };
    walk(folders, 0);
    box.append(det);
  }
}

function progress(prefix, done, total, text) {
  $(`#${prefix}`).hidden = false;
  $(`#${prefix}Bar`).style.width = (total ? Math.min(100, done / total * 100) : 0) + "%";
  $(`#${prefix}Text`).textContent = text;
}

/* ---------------- Scan ---------------- */
async function scan() {
  const sel = S.folders.filter(x => x.cb.checked);
  if (!sel.length) { alert(t("needFolder")); return; }
  const fields = { from: $("#fFrom").checked, to: $("#fTo").checked, cc: $("#fCc").checked };
  if (!fields.from && !fields.to && !fields.cc) { alert(t("needField")); return; }
  const cmp = $("#cmpOn").checked;
  if (cmp && !S.cmpSel.size) { alert(t("needBook")); return; }
  S.min = Math.max(1, parseInt($("#min").value, 10) || 1);
  const years = Math.max(0, parseFloat($("#years").value) || 0);
  const minDate = years > 0 ? Date.now() - years * 365.25 * 864e5 : 0;
  const excl = L.compileExclusions($("#excl").value);

  S.cancel = false;
  $("#scan").disabled = true; $("#cancel").hidden = false;
  const known = new Set(), stats = { known: new Set() };
  if (cmp) {
    progress("prog", 0, 1, t("readingBooks"));
    for (const c of await readContacts([...S.cmpSel])) c.emails.forEach(e => known.add(e));
  }
  const map = new Map();
  let msgs = 0, used = 0;
  try {
    for (let i = 0; i < sel.length && !S.cancel; i++) {
      const f = sel[i].folder;
      let page = await api.messages.list(f.id ?? f);
      for (;;) {
        for (const m of page.messages) {
          msgs++;
          const ts = m.date ? new Date(m.date).getTime() : 0;
          if (minDate && ts < minDate) continue;
          used++;
          const seen = new Set();
          const add = s => { for (const mb of L.parseList(s)) L.record(map, mb, ts, S.own, excl, seen, known, stats); };
          if (fields.from) add(m.author);
          if (fields.to) (m.recipients || []).forEach(add);
          if (fields.cc) (m.ccList || []).forEach(add);
        }
        progress("prog", i, sel.length, t("progScan", i + 1, sel.length, fmtNum(msgs), fmtNum(map.size)));
        if (!page.id) break;
        if (S.cancel) { try { await api.messages.abortList(page.id); } catch {} break; }
        page = await api.messages.continueList(page.id);
      }
    }
  } catch (e) {
    alert(t("scanError") + e.message);
  }
  $("#scan").disabled = false; $("#cancel").hidden = true;
  S.knownCount = stats.known.size;
  CPLog.add(`Sammeln: ${used} Mails ausgewertet, ${map.size} neue Adressen${S.cancel ? " (abgebrochen)" : ""}`);
  progress("prog", 1, 1, t("scanDone", S.cancel, fmtNum(used), fmtNum(map.size), fmtNum(S.knownCount)));

  S.entries = [...map.values()];
  S.proposals = L.buildProposals(S.entries, S.min).map(p => ({
    id: ++S.seq, members: p.members, checked: new Set(p.members), reasons: p.reasons, state: "open",
    name: L.bestName(p.members.map(i => S.entries[i]))
  }));
  S.include.clear(); S.nameOv.clear(); S.marked.clear();
  S.view = S.proposals.length ? "open" : "list";
  S.scanned = true;
  $("#step2").hidden = false; $("#step3").hidden = false;
  $("#saveResult").replaceChildren(); $("#sprog").hidden = true;
  await loadBooks();
  if (!cmp) $("#book").value = "__new";
  $("#newBookWrap").hidden = $("#book").value !== "__new";
  $("#optCheckDup").checked = !$("#optCheckDup").disabled;
  renderDupBook();
  render();
  $("#step2").scrollIntoView({ behavior: "smooth" });
}

/* ---------------- Datenmodell ---------------- */
function makeContact(key, mem, name, p) {
  const es = mem.map(i => S.entries[i]).sort((a, b) => b.count - a.count);
  return { key, mem, proposal: p, emails: es.map(e => e.email), entries: es,
           count: es.reduce((s, e) => s + e.count, 0), last: Math.max(...es.map(e => e.last)),
           name: p ? p.name : (S.nameOv.get(key) ?? L.bestName(es)) };
}
function computeContacts() {
  const used = new Set(), out = [];
  for (const p of S.proposals) {
    if (p.state === "split") continue;
    if (p.state === "excluded") { p.members.forEach(i => used.add(i)); continue; }
    const mem = p.members.filter(i => p.checked.has(i));
    if (!mem.length) continue;
    mem.forEach(i => used.add(i));
    out.push(makeContact("p:" + p.id, mem, p.name, p));
  }
  S.entries.forEach((e, i) => { if (!used.has(i)) out.push(makeContact("e:" + e.email, [i], null, null)); });
  return out.filter(c => c.count >= S.min).sort((a, b) => b.count - a.count);
}
const pSum = p => p.members.reduce((s, i) => s + S.entries[i].count, 0);
const visibleProposals = () => S.proposals.filter(p => p.members.length >= 2 && pSum(p) >= S.min);

function updateSaveLabel() {
  if (!S.scanned) return;
  const n = computeContacts().filter(c => S.include.get(c.key) !== false).length;
  const chk = $("#optCheckDup").checked;
  set($("#save"), I(chk ? "link" : "save"), h("span", null, t(chk ? "saveBtnCheck" : "saveBtn", fmtNum(n))));
}

/* ---------------- Schritt 2: Darstellung ---------------- */
function statTile(ic, cls, num, label, sub) {
  return h("div", { class: "stat " + cls }, h("span", { class: "st-ic" }, I(ic)),
    h("div", null, h("b", null, num), h("span", null, label), h("small", null, sub)));
}
function stateBadge(state) {
  const map = { merged: ["checkcircle", "stMerged"], split: ["split", "stSplit"], excluded: ["userx", "stExcluded"] };
  if (!map[state]) return null;
  return h("span", { class: "state " + state }, I(map[state][0]), t(map[state][1]));
}
function proposalCard(p) {
  const head = h("div", { class: "card-head" },
    AV(p.name, S.entries[p.members[0]].email),
    h("input", { type: "text", class: "nm", "data-act": "pname", "data-p": p.id, value: p.name, placeholder: t("namePh") }),
    p.reasons.map(r => h("span", { class: "chip" }, I("link"), t("r_" + r))),
    stateBadge(p.state));
  const members = h("ul", { class: "members" }, p.members.map(i => {
    const e = S.entries[i];
    const alt = Object.keys(e.names).filter(n => n !== p.name).slice(0, 2);
    return h("li", null,
      h("input", { type: "checkbox", "data-act": "member", "data-p": p.id, "data-i": i, checked: p.checked.has(i) }),
      h("span", null, I("mail", "mi"), h("span", { class: "em" }, e.email), alt.length ? h("span", { class: "alt" }, alt.join(" · ")) : null),
      h("span", { class: "meta" }, I("clock", "mi"), t("times", e.count, fmtDate(e.last))));
  }));
  const actions = h("div", { class: "card-actions" },
    h("button", { type: "button", class: "ok", "data-act": "merge", "data-p": p.id }, I("merge"), t("btnMerge")),
    h("button", { type: "button", "data-act": "split", "data-p": p.id }, I("split"), t("btnSplit")),
    h("button", { type: "button", class: "danger", "data-act": "exclude", "data-p": p.id, title: t("btnExcludeTitle") }, I("userx"), t("btnExclude")));
  return h("div", { class: "card " + p.state }, head, members, actions);
}
function contactRow(c) {
  const inc = S.include.get(c.key) !== false;
  return h("tr", { class: inc ? "" : "off" },
    h("td", null, h("input", { type: "checkbox", "data-act": "inc", "data-key": c.key, checked: inc })),
    h("td", null, h("input", { type: "checkbox", "data-act": "mark", "data-key": c.key, checked: S.marked.has(c.key) })),
    h("td", null, h("div", { class: "namecell" }, AV(c.name, c.emails[0], "sm"),
      h("input", { type: "text", class: "nm", "data-act": "name", "data-key": c.key, value: c.name, placeholder: t("noName") }))),
    h("td", { class: "ems" }, c.emails.map((e, i) => [i ? h("br") : null, e])),
    h("td", { class: "num" }, c.count),
    h("td", { class: "num" }, fmtDate(c.last)));
}

function render() {
  if (!S.scanned) return;
  const props = visibleProposals();
  const open = props.filter(p => p.state === "open");
  const contacts = computeContacts();
  $("#cOpen").textContent = open.length;
  $("#cAll").textContent = props.length;
  $("#cList").textContent = contacts.length;
  set($("#summary"),
    statTile("at", "c1", fmtNum(S.entries.length), t("statAddr"), t("statAddrSub")),
    statTile("users", "c2", fmtNum(contacts.length), t("statPeople"), t("statPeopleSub", S.min)),
    statTile("sparkle", "c3", props.length, t("statProps"), t("statOpen", open.length)),
    S.knownCount ? statTile("bookcheck", "c4", fmtNum(S.knownCount), t("statKnown"), t("statKnownSub")) : null);
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("active", b.dataset.view === S.view));
  updateSaveLabel();
  $("#openHint").textContent = open.length ? t("openHint", open.length) : "";

  const tb = $("#toolbar"), res = $("#results");
  if (S.view === "list") {
    set(tb,
      h("input", { type: "search", id: "search", placeholder: t("searchPh"), value: S.search }),
      h("button", { type: "button", "data-act": "mergeMarked", disabled: S.marked.size < 2 }, I("link"), t("mergeMarked", S.marked.size)),
      h("button", { type: "button", class: "link", "data-act": "incAll" }, I("check"), t("incAll")),
      h("button", { type: "button", class: "link", "data-act": "incNone" }, I("x"), t("incNone")));
    const q = S.search.trim().toLowerCase();
    const rows = contacts.filter(c => !q || c.name.toLowerCase().includes(q) || c.emails.some(e => e.includes(q)));
    const shown = rows.slice(0, 600);
    if (!rows.length) { set(res, emptyState("users", t("noContacts"))); return; }
    set(res,
      h("table", null,
        h("thead", null, h("tr", null,
          h("th", { title: t("thIncTitle") }, t("thInc")), h("th", { title: t("thMarkTitle") }, t("thMark")),
          h("th", null, t("thName")), h("th", null, t("thAddr")),
          h("th", { class: "num" }, t("thCount")), h("th", { class: "num" }, t("thLast")))),
        h("tbody", null, shown.map(contactRow))),
      rows.length > shown.length ? h("p", { class: "hint" }, t("more", fmtNum(rows.length - shown.length))) : null);
    return;
  }

  set(tb, S.view === "open" && open.length
    ? h("button", { type: "button", "data-act": "acceptAll" }, I("merge"), t("acceptAll")) : null);
  const list = S.view === "open" ? open : props;
  set(res, list.length ? list.map(proposalCard)
    : emptyState(S.view === "open" ? "checkcircle" : "sparkle", t(S.view === "open" ? "allDone" : "noProps")));
}

const findP = id => S.proposals.find(p => p.id === Number(id));

function mergeMarked() {
  const sel = computeContacts().filter(c => S.marked.has(c.key));
  if (sel.length < 2) return;
  const mem = [...new Set(sel.flatMap(c => c.mem))];
  const set = new Set(mem);
  for (const p of S.proposals) { p.members = p.members.filter(i => !set.has(i)); mem.forEach(i => p.checked.delete(i)); }
  S.proposals = S.proposals.filter(p => p.members.length);
  const named = sel.find(c => c.name);
  S.proposals.push({ id: ++S.seq, members: mem, checked: new Set(mem), reasons: ["manual"], state: "merged",
                     name: named ? named.name : L.bestName(mem.map(i => S.entries[i])) });
  S.marked.clear();
  render();
}

function onClick(ev) {
  const b = ev.target.closest("[data-act]");
  if (!b || b.tagName === "INPUT") return;
  const act = b.dataset.act;
  if (act === "merge" || act === "split" || act === "exclude") {
    findP(b.dataset.p).state = { merge: "merged", split: "split", exclude: "excluded" }[act]; render();
  }
  else if (act === "acceptAll") { visibleProposals().forEach(p => { if (p.state === "open") p.state = "merged"; }); render(); }
  else if (act === "mergeMarked") mergeMarked();
  else if (act === "incAll" || act === "incNone") { computeContacts().forEach(c => S.include.set(c.key, act === "incAll")); render(); }
}
function onChange(ev) {
  const el = ev.target, act = el.dataset.act;
  if (act === "member") { const p = findP(el.dataset.p); el.checked ? p.checked.add(+el.dataset.i) : p.checked.delete(+el.dataset.i); render(); }
  else if (act === "pname") findP(el.dataset.p).name = el.value.trim();
  else if (act === "inc") { S.include.set(el.dataset.key, el.checked); render(); }
  else if (act === "mark") { el.checked ? S.marked.add(el.dataset.key) : S.marked.delete(el.dataset.key); render(); }
  else if (act === "name") {
    const k = el.dataset.key;
    if (k.startsWith("p:")) findP(k.slice(2)).name = el.value.trim(); else S.nameOv.set(k, el.value.trim());
  }
}

/* ---------------- Schritt 3: Anlegen ---------------- */
async function save() {
  const list = computeContacts().filter(c => S.include.get(c.key) !== false);
  if (!list.length) { alert(t("noneSelected")); return; }
  $("#save").disabled = true;
  const out = $("#saveResult"); out.replaceChildren();
  const problems = [], createdIds = [];
  let created = 0, extended = 0, skipped = 0, bookId = null;
  const checkDup = $("#optCheckDup").checked, dupBook = $("#dupBook").value;
  try {
    bookId = $("#book").value;
    if (bookId === "__new") bookId = await api.addressBooks.create({ name: $("#newBook").value.trim() || t("newBookDefault") });

    const existing = new Map();
    if ($("#optExisting").checked) {
      progress("sprog", 0, 1, t("readingBooks"));
      for (const rec of await readContacts(S.books.map(b => b.id)))
        for (const e of rec.emails) if (!existing.has(e)) existing.set(e, rec);
    }

    for (let i = 0; i < list.length; i++) {
      const c = list[i], label = c.name || c.emails[0];
      if (i % 10 === 0) progress("sprog", i, list.length, t("savingOf", i, list.length));
      try {
        const hits = new Set(c.emails.map(e => existing.get(e)).filter(Boolean));
        if (!hits.size) {
          const id = await CP_API.contacts.create(bookId, L.buildVCard(c.name, c.emails));
          if (id) createdIds.push(id);
          created++; continue;
        }
        const missing = c.emails.filter(e => !existing.has(e));
        if (!missing.length) { skipped++; continue; }
        if (hits.size > 1) { problems.push(t("pMulti", label)); skipped++; continue; }
        const rec = [...hits][0];
        if (!$("#optExtend").checked || rec.readOnly || !rec.vCard) {
          problems.push(t("pNotAdded", label, missing.join(", "), rec.readOnly ? t("whyRO", rec.book) : t("whyExisting", rec.book)));
          skipped++; continue;
        }
        rec.vCard = L.addEmailsToVCard(rec.vCard, missing);
        await CP_API.contacts.update(rec.id, rec.vCard);
        missing.forEach(e => existing.set(e, rec));
        extended++;
      } catch (e) { problems.push(`${label}: ${e.message}`); }
    }
    progress("sprog", 1, 1, t("done"));
    CPLog.add(`Sammeln speichern: ${created} neu, ${extended} erweitert, ${skipped} übersprungen, ${problems.length} Hinweise`);
    set(out, h("div", { class: "result" },
      h("div", { class: "res-head" }, I("checkcircle", "big"), h("span", null, t("saveResult", created, extended, skipped))),
      problems.length ? h("ul", null, problems.slice(0, 100).map(p => h("li", null, I("alert", "mi"), p))) : null));
    await loadBooks();
    $("#book").value = bookId; $("#newBookWrap").hidden = true; renderDupBook();
  } catch (e) {
    set(out, h("div", { class: "result" }, h("ul", null, h("li", null, I("alert", "mi"), e.message))));
  }
  $("#save").disabled = false;
  if (checkDup && createdIds.length && dupBook && dupBook !== bookId) {
    showView("manage");
    await globalThis.KSManager.openCompare(bookId, dupBook, createdIds);
  }
}

/* ---------------- Start ---------------- */
function relabel() {
  for (const f of S.folders) if (f.tag) f.tag.textContent = t("f_" + f.use);
  renderCmpBooks();
  renderBookSelects();
  render();
}

document.addEventListener("DOMContentLoaded", async () => {
  UI_ICONS.apply();
  I18N.apply();
  I18N.onChange(relabel);
  document.querySelector(".mainnav").addEventListener("click", e => { const b = e.target.closest("button[data-main]"); if (b) showView(b.dataset.main); });
  $("#scan").addEventListener("click", scan);
  $("#cancel").addEventListener("click", () => { S.cancel = true; });
  $("#selDefault").addEventListener("click", () => S.folders.forEach(x => x.cb.checked = DEFAULT_ON.has(x.use)));
  $("#selNone").addEventListener("click", () => S.folders.forEach(x => x.cb.checked = false));
  $("#cmpOn").addEventListener("change", updateCmpHint);
  $("#cmpBooks").addEventListener("change", e => {
    const id = e.target.dataset.cmp; if (!id) return;
    if (id === "all") S.cmpSel = new Set(e.target.checked ? S.books.map(b => b.id) : []);
    else e.target.checked ? S.cmpSel.add(id) : S.cmpSel.delete(id);
    renderCmpBooks();
  });
  document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("button"); if (b) { S.view = b.dataset.view; render(); } });
  $("#results").addEventListener("click", onClick);
  $("#toolbar").addEventListener("click", onClick);
  $("#results").addEventListener("change", onChange);
  $("#toolbar").addEventListener("input", e => { if (e.target.id === "search") { S.search = e.target.value; const pos = e.target.selectionStart; render(); const s = $("#search"); s.focus(); s.setSelectionRange(pos, pos); } });
  $("#book").addEventListener("change", () => { $("#newBookWrap").hidden = $("#book").value !== "__new"; renderDupBook(); });
  $("#optCheckDup").addEventListener("change", () => { $("#dupBookWrap").hidden = !$("#optCheckDup").checked; updateSaveLabel(); });
  $("#save").addEventListener("click", save);
  try { await loadBooks(); } catch {}
  try { await loadFolders(); }
  catch (e) { set($("#folders"), h("p", { class: "muted" }, e.message)); }
});
