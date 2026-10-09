"use strict";
/* Nova-Contact – Bereich „Kontakte aufräumen“: Kontakte eines Adressbuchs nach Mailverkehr und Qualität filtern, prüfen, löschen */
(() => {
  const api = globalThis.messenger || globalThis.browser;
  const L = globalThis.KSLogic;
  const t = (...a) => I18N.t(...a);
  const $ = s => document.querySelector(s);
  const { h, set } = DOM;
  const AV = (n, e, s) => UI_ICONS.avatar(n, e, s);
  const MAX_ROWS = 400, RESTORE_KEEP = 3;
  const C = { loaded: false, books: [], contacts: [], matches: [], sel: new Set(), cancel: false, analysed: false };

  const unesc = s => String(s).replace(/\\([,;\\n])/g, "$1");
  function parse(node, book) {
    const v = CP_API.contacts.vCardOf(node);
    const line = n => (v.match(new RegExp("^(?:item\\d+\\.)?" + n + "[^:\\r\\n]*:(.*)$", "im")) || [])[1];
    const emails = L.vcardEmails(v);
    let name = unesc(line("FN") || "").trim();
    if (!name) { const n = (line("N") || "").split(";").map(unesc); name = [n[1], n[0]].filter(Boolean).join(" ").trim(); }
    const plain = !/^(?:item\d+\.)?(TEL|ADR|NOTE|ORG|TITLE|ROLE|BDAY|ANNIVERSARY|URL|IMPP|PHOTO|CATEGORIES|NICKNAME)\b/im.test(v);
    const nameIsAddr = !name || name.includes("@") || emails.includes(name.toLowerCase());
    return { id: node.id, vCard: v, emails, name, plain, noName: nameIsAddr, book: book.id, readOnly: !!book.readOnly, count: 0, last: 0, dup: false };
  }

  async function activate() {
    if (C.loaded) { renderRestore(); return; }
    C.loaded = true;
    C.books = await api.addressBooks.list(false);
    set($("#cBook"), C.books.map(b => h("option", { value: b.id }, b.name + (b.readOnly ? " (" + t("readOnlyTag") + ")" : ""))));
    renderRestore();
  }

  function setProg(done, total, text) {
    $("#cprog").hidden = false;
    $("#cprogBar").style.width = (total ? Math.min(100, done / total * 100) : 0) + "%";
    $("#cprogText").textContent = text;
  }

  async function analyse() {
    const book = C.books.find(b => b.id === $("#cBook").value);
    if (!book) { alert(t("c_needBook")); return; }
    const folders = S.folders.filter(x => x.cb.checked);
    if (!folders.length) { alert(t("c_needFolder")); return; }
    const how = $("#cCount").value;
    C.cancel = false; $("#cGo").disabled = true; $("#cCancel").hidden = false;
    setProg(0, 1, t("c_reading"));
    let nodes = [];
    try { nodes = await CP_API.contacts.list(book.id); } catch (e) { alert(e.message); }
    C.contacts = nodes.filter(n => !n.type || n.type === "contact").map(n => parse(n, book));
    const byMail = new Map(), seenMail = new Map();
    for (const c of C.contacts) for (const e of c.emails) { if (!byMail.has(e)) byMail.set(e, []); byMail.get(e).push(c); }
    for (const c of C.contacts) c.dup = c.emails.some(e => byMail.get(e).length > 1);
    let msgs = 0;
    try {
      for (let i = 0; i < folders.length && !C.cancel; i++) {
        let page = await api.messages.list(folders[i].folder.id ?? folders[i].folder);
        for (;;) {
          for (const m of page.messages) {
            msgs++;
            const ts = m.date ? new Date(m.date).getTime() : 0;
            const seen = new Set();
            const hit = s => { for (const mb of L.parseList(s)) { const e = mb.email.toLowerCase().replace(/^mailto:/, "").trim(); if (byMail.has(e) && !seen.has(e)) { seen.add(e); for (const c of byMail.get(e)) { c.count++; if (ts > c.last) c.last = ts; } } } };
            if (how !== "sent") hit(m.author);
            if (how !== "recv") { (m.recipients || []).forEach(hit); (m.ccList || []).forEach(hit); (m.bccList || []).forEach(hit); }
          }
          setProg(i, folders.length, t("c_prog", i + 1, folders.length, msgs.toLocaleString(I18N.locale())));
          if (!page.id) break;
          if (C.cancel) { try { await api.messages.abortList(page.id); } catch {} break; }
          page = await api.messages.continueList(page.id);
        }
      }
    } catch (e) { alert(e.message); }
    setProg(1, 1, t("c_done", C.cancel, msgs.toLocaleString(I18N.locale())));
    $("#cGo").disabled = false; $("#cCancel").hidden = true;
    CPLog.add(`Aufräumen: ${C.contacts.length} Kontakte in „${book.name}“, ${msgs} Mails ausgewertet${C.cancel ? " (abgebrochen)" : ""}`);
    C.analysed = true; C.sel.clear(); $("#cMsg").replaceChildren();
    $("#cResult").hidden = false;
    refilter();
  }

  function refilter() {
    if (!C.analysed) return;
    const conds = [];
    if ($("#cFew").checked) { const n = Math.max(0, parseInt($("#cFewN").value, 10) || 0); conds.push(c => c.count <= n); }
    if ($("#cOld").checked) { const y = Math.max(1, parseFloat($("#cOldN").value) || 1), cut = Date.now() - y * 365.25 * 864e5; conds.push(c => c.last < cut); }
    if ($("#cNoMail").checked) conds.push(c => !c.emails.length);
    if ($("#cNoName").checked) conds.push(c => c.noName);
    if ($("#cDup").checked) conds.push(c => c.dup);
    if ($("#cPlain").checked) conds.push(c => c.plain);
    const all = $("#cMode").value === "all";
    C.matches = conds.length ? C.contacts.filter(c => (all ? conds.every(f => f(c)) : conds.some(f => f(c)))) : [];
    C.matches.sort((a, b) => a.last - b.last || a.count - b.count || a.name.localeCompare(b.name));
    const ids = new Set(C.matches.map(c => c.id));
    for (const id of [...C.sel]) if (!ids.has(id)) C.sel.delete(id);
    render();
  }

  const date = ts => ts ? new Date(ts).toLocaleDateString(I18N.locale(), { month: "2-digit", year: "numeric" }) : t("c_never");
  function render() {
    $("#cCountText").textContent = t("c_result", C.matches.length, C.contacts.length);
    const shown = C.matches.slice(0, MAX_ROWS);
    set($("#cList"), shown.length ? h("ul", { class: "cList" }, shown.map(c => h("li", { class: c.readOnly ? "ro" : "" },
      h("label", null,
        h("input", { type: "checkbox", "data-id": c.id, checked: C.sel.has(c.id), disabled: c.readOnly }),
        AV(c.name, c.emails[0] || "", "sm"),
        h("span", { class: "nb" }, h("span", { class: "n" }, c.name || c.emails[0] || "–"), h("span", { class: "e" }, c.emails.join(", "))),
        h("span", { class: "meta" }, t("c_mails", c.count), " · ", t("c_last"), " ", date(c.last)))))) : h("p", { class: "empty" }, t("c_noMatch")));
    $("#cMore").hidden = C.matches.length <= MAX_ROWS;
    $("#cMore").textContent = t("c_more", MAX_ROWS);
    updateButtons();
  }
  function updateButtons() {
    const n = C.sel.size;
    $("#cDel").textContent = t("c_delete", n);
    $("#cDel").disabled = !n; $("#cSave").disabled = !n;
  }

  /* ---------- Löschen mit Wiederherstellung ---------- */
  const chosen = () => C.contacts.filter(c => C.sel.has(c.id) && !c.readOnly);
  async function remove() {
    const list = chosen();
    if (!list.length || !confirm(t("c_confirm", list.length))) return;
    const bookId = $("#cBook").value, bookName = C.books.find(b => b.id === bookId)?.name || "";
    try {
      const old = (await api.storage.local.get("cpRestore")).cpRestore || [];
      old.unshift({ ts: Date.now(), bookId, bookName, vcards: list.map(c => c.vCard) });
      await api.storage.local.set({ cpRestore: old.slice(0, RESTORE_KEEP) });
    } catch (e) {
      if (!confirm(t("c_noRestore"))) return;
    }
    let n = 0;
    for (const c of list) { try { await CP_API.contacts.delete(c.id); n++; } catch (e) { console.error(e); } }
    CPLog.add(`Aufräumen: ${n} Kontakte gelöscht (Wiederherstellungspunkt gespeichert)`);
    C.contacts = C.contacts.filter(c => !(C.sel.has(c.id) && !c.readOnly));
    C.sel.clear();
    $("#cMsg").replaceChildren(h("div", { class: "result" }, t("c_deleted", n)));
    refilter(); renderRestore();
  }
  function saveFile() {
    const list = chosen();
    if (!list.length) return;
    const blob = new Blob([list.map(c => c.vCard.trim()).join("\r\n") + "\r\n"], { type: "text/vcard" });
    const a = h("a", { href: URL.createObjectURL(blob), download: "contacts.vcf" });
    document.body.append(a); a.click(); a.remove();
  }
  async function renderRestore() {
    let items = [];
    try { items = (await api.storage.local.get("cpRestore")).cpRestore || []; } catch {}
    $("#cRestore").hidden = !items.length;
    set($("#cRestoreList"), items.map((it, i) => h("div", { class: "restoreRow" },
      h("span", null, t("c_restoreItem", it.vcards.length, it.bookName, new Date(it.ts).toLocaleString(I18N.locale(), { dateStyle: "short", timeStyle: "short" }))),
      h("button", { type: "button", onclick: () => restore(i) }, t("c_restore")))));
  }
  async function restore(i) {
    const items = (await api.storage.local.get("cpRestore")).cpRestore || [];
    const it = items[i];
    if (!it) return;
    let n = 0;
    for (const v of it.vcards) { try { await CP_API.contacts.create(it.bookId, v); n++; } catch (e) { console.error(e); } }
    CPLog.add(`Aufräumen: ${n} Kontakte wiederhergestellt`);
    items.splice(i, 1);
    await api.storage.local.set({ cpRestore: items });
    $("#cMsg").replaceChildren(h("div", { class: "result" }, t("c_restored", n)));
    renderRestore();
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("#cGo").addEventListener("click", analyse);
    $("#cCancel").addEventListener("click", () => { C.cancel = true; });
    $("#viewClean").addEventListener("change", e => {
      if (e.target.dataset.id) { e.target.checked ? C.sel.add(e.target.dataset.id) : C.sel.delete(e.target.dataset.id); updateButtons(); }
      else if (e.target.id !== "cBook" && e.target.closest(".grid")) refilter();
    });
    $("#cBook").addEventListener("change", () => { C.analysed = false; $("#cResult").hidden = true; });
    $("#cFewN").addEventListener("input", refilter); $("#cOldN").addEventListener("input", refilter);
    $("#cSelAll").addEventListener("click", () => { C.matches.filter(c => !c.readOnly).forEach(c => C.sel.add(c.id)); render(); });
    $("#cSelNone").addEventListener("click", () => { C.sel.clear(); render(); });
    $("#cDel").addEventListener("click", remove);
    $("#cSave").addEventListener("click", saveFile);
    I18N.onChange(() => { if (C.analysed) render(); renderRestore(); });
  });
  globalThis.KSClean = { activate };
})();
