"use strict";
/* Analyseseite des NovaBird-Search: Treffer des NovaBird-DB mit anklickbaren Filtern (Absender, Ordner, Monat, Anhang). */

const t = (key, vars = {}) =>
  (messenger.i18n.getMessage(key) || key).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
const $ = id => document.getElementById(id);
const PAGE = 100;       // so viele Zeilen auf einmal
const FACET_TOP = 12;   // so viele Einträge je Filtergruppe, der Rest hinter „Mehr“

let data = null;
let words = [];
const sel = { from: new Set(), to: new Set(), folder: new Set(), month: new Set(), att: false, me: false };
const expanded = { from: false, to: false, folder: false };
let mine = [];            // eigene Adressen aller Konten
const ownOn = new Set();  // davon für „Mich“ aktiv (abwählbar)
let meOpen = false;       // Aufklappmenü der eigenen Adressen offen
const range = { min: 0, max: 0 }; // Datumsspanne aller Treffer (Sekunden)
let gran = "month";       // Auflösung der Zeitleiste: month | year
let shown = PAGE;
let selected = null;      // angeklickter Treffer (Vorschau rechts)
const recip = { done: false, pct: 0 }; // Empfänger werden blockweise nachgeladen
let paneToken = 0;
const narrow = window.matchMedia("(max-width: 1000px)"); // zu schmal für die Vorschau: Klick öffnet einen Tab

const authorName = a => {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(a || "");
  return (m ? m[1].trim() || m[2] : (a || "").trim()) || "?";
};
const bucketKey = ts => {
  const d = new Date(ts * 1000);
  return gran === "year" ? String(d.getFullYear()) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};
const isMe = h => h.toE.some(e => ownOn.has(e));

function matches(h, skip) {
  if (skip !== "from" && sel.from.size && !sel.from.has(h._from)) return false;
  if (skip !== "folder" && sel.folder.size && !sel.folder.has(h._folder)) return false;
  if (skip !== "to" && sel.to.size && !h._to.some(n => sel.to.has(n))) return false;
  if (skip !== "me" && sel.me && !isMe(h)) return false;
  if (skip !== "month" && sel.month.size && !sel.month.has(h._month)) return false;
  if (skip !== "att" && sel.att && !h.att) return false;
  return true;
}

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function counts(cat) {
  const map = new Map();
  for (const h of data.hits) {
    if (!matches(h, cat)) continue;
    const v = h["_" + cat];
    for (const k of Array.isArray(v) ? v : [v]) {
      map.set(k, (map.get(k) || 0) + 1);
    }
  }
  return map;
}

function facet(cat, label) {
  const box = document.createDocumentFragment();
  const map = counts(cat);
  for (const k of sel[cat]) if (!map.has(k)) map.set(k, 0);
  const list = [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (!list.length) return box;
  box.append(el("div", "facet-h", label));
  const limit = expanded[cat] ? list.length : FACET_TOP;
  list.forEach(([k, n], i) => {
    if (i >= limit && !sel[cat].has(k)) return;
    const b = el("button", "chip" + (sel[cat].has(k) ? " on" : ""));
    b.type = "button";
    b.title = k;
    b.append(el("span", "", k), el("span", "n", String(n)));
    b.addEventListener("click", () => {
      sel[cat].has(k) ? sel[cat].delete(k) : sel[cat].add(k);
      render();
    });
    box.append(b);
  });
  if (list.length > FACET_TOP) {
    const more = el("button", "more", expanded[cat] ? "−" : `+ ${list.length - FACET_TOP}`);
    more.type = "button";
    more.addEventListener("click", () => { expanded[cat] = !expanded[cat]; render(); });
    box.append(more);
  }
  return box;
}

// „Mich“: Treffer, die an eine meiner Adressen gingen; das Aufklappmenü wählt einzelne Adressen ab
function meFacet() {
  const box = el("div", "me-wrap");
  if (!mine.length) return box;
  const n = data.hits.filter(h => matches(h, "me") && isMe(h)).length;
  const row = el("div", "me-row");
  const chip = el("button", "chip" + (sel.me ? " on" : ""));
  chip.type = "button";
  chip.append(el("span", "", t("anaMe")), el("span", "n", String(n)));
  chip.addEventListener("click", () => { sel.me = !sel.me; render(); });
  const arrow = el("button", "chip-arrow" + (sel.me ? " on" : ""), "▾");
  arrow.type = "button";
  arrow.title = t("anaMyAddresses");
  arrow.addEventListener("click", e => { e.stopPropagation(); meOpen = !meOpen; render(); });
  row.append(chip, arrow);
  box.append(row);
  if (meOpen) {
    const pop = el("div", "me-pop");
    pop.append(el("div", "facet-h", t("anaMyAddresses")));
    for (const m of mine) {
      const label = el("label", "me-item");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = ownOn.has(m.email);
      cb.addEventListener("change", () => {
        cb.checked ? ownOn.add(m.email) : ownOn.delete(m.email);
        render();
      });
      const txt = el("span", "", m.email);
      txt.title = m.account;
      label.append(cb, txt);
      pop.append(label);
    }
    box.append(pop);
  }
  return box;
}

function renderFacets() {
  const side = $("facets");
  side.replaceChildren(facet("from", t("anaFrom")));
  // „An“: Mich (mit Aufklappmenü) und die übrigen Empfänger
  if (!recip.done) {
    side.append(el("div", "facet-h", t("anaTo")), Object.assign(el("div"), { id: "recip-progress", textContent: t("anaRecipLoading", { p: recip.pct }) }));
    side.append(facet("folder", t("anaFolder")));
    appendAttachment(side);
    return;
  }
  const toFacet = facet("to", t("anaTo"));
  const me = meFacet();
  if (me.childNodes.length || toFacet.childNodes.length) {
    const head = toFacet.firstChild && toFacet.firstChild.className === "facet-h" ? toFacet.firstChild : el("div", "facet-h", t("anaTo"));
    side.append(head, me, toFacet);
  }
  side.append(facet("folder", t("anaFolder")));
  appendAttachment(side);
}

function appendAttachment(side) {
  const withAtt = [...counts("att").entries()].filter(([k]) => k).reduce((s, [, n]) => s + n, 0);
  if (withAtt || sel.att) {
    side.append(el("div", "facet-h", t("anaAttachment")));
    const b = el("button", "chip" + (sel.att ? " on" : ""));
    b.type = "button";
    b.append(el("span", "", t("anaWithAtt")), el("span", "n", String(withAtt)));
    b.addEventListener("click", () => { sel.att = !sel.att; render(); });
    side.append(b);
  }
}

const tip = el("div", "tip");
tip.hidden = true;
document.body.append(tip);

function bucketLabel(key, long) {
  const [y, m] = key.split("-").map(Number);
  if (gran === "year") return String(y);
  return new Intl.DateTimeFormat(undefined, long ? { month: "long", year: "numeric" } : { month: "short", year: "2-digit" }).format(new Date(y, m - 1, 1));
}

function renderChart() {
  const map = counts("month");
  const lo = new Date(range.min * 1000);
  const hi = new Date(range.max * 1000);
  // Auflösung nach Zeitspanne: bis 5 Jahre Monate, darüber Jahre
  const span = (hi.getFullYear() - lo.getFullYear()) * 12 + hi.getMonth() - lo.getMonth() + 1;
  const keys = [];
  if (gran === "year") {
    for (let y = lo.getFullYear(); y <= hi.getFullYear(); y++) keys.push(String(y));
  } else {
    let y = lo.getFullYear();
    let m = lo.getMonth();
    // mindestens 12 Balken, damit wenige Monate nicht zu riesigen Balken werden
    const missing = Math.max(0, 12 - span);
    m -= missing;
    while (m < 0) { m += 12; y--; }
    while (y < hi.getFullYear() || (y === hi.getFullYear() && m <= hi.getMonth())) {
      keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      if (++m > 11) { m = 0; y++; }
    }
  }
  const max = Math.max(1, ...keys.map(k => map.get(k) || 0));
  const chart = $("chart");
  chart.replaceChildren();
  chart.style.gridTemplateColumns = `repeat(${keys.length}, minmax(0, 1fr))`;
  chart.classList.toggle("has-sel", sel.month.size > 0);
  keys.forEach(k => {
    const n = map.get(k) || 0;
    const slot = el("div", "slot");
    const bar = el("div", "bar" + (sel.month.has(k) ? " on" : ""));
    bar.style.height = n ? `${Math.max(4, Math.round((n / max) * 100))}%` : "2px";
    slot.append(bar);
    slot.addEventListener("mouseenter", () => { tip.textContent = `${bucketLabel(k, true)} · ${n}`; tip.hidden = false; });
    slot.addEventListener("mousemove", e => {
      tip.style.left = `${Math.min(e.clientX + 12, window.innerWidth - tip.offsetWidth - 8)}px`;
      tip.style.top = `${e.clientY - 34}px`;
    });
    slot.addEventListener("mouseleave", () => { tip.hidden = true; });
    slot.addEventListener("click", () => {
      sel.month.has(k) ? sel.month.delete(k) : sel.month.add(k);
      render();
    });
    chart.append(slot);
  });
  // Achse: Bezugspunkte in gleichmäßigen Abständen (höchstens etwa neun)
  const axis = $("chart-axis");
  axis.replaceChildren();
  const steps = gran === "year" ? [1, 2, 5, 10, 20] : [1, 3, 6, 12, 24, 60];
  const step = steps.find(x => keys.length / x <= 9) || steps[steps.length - 1];
  keys.forEach((k, i) => {
    const [y, m] = k.split("-").map(Number);
    const idx = gran === "year" ? y : y * 12 + (m - 1);
    if (idx % step !== 0) return;
    const tick = el("span", "tick", step >= 12 && gran === "month" ? String(y) : bucketLabel(k, false));
    tick.style.left = `${((i + 0.5) / keys.length) * 100}%`;
    axis.append(tick);
  });
}

function highlight(node, text) {
  if (!words.length) { node.textContent = text; return; }
  const re = new RegExp(`(${words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`, "ig");
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) node.append(text.slice(last, m.index));
    node.append(el("mark", "", m[0]));
    last = m.index + m[0].length;
    if (m[0].length === 0) break;
  }
  node.append(text.slice(last));
}

// Nachrichten-ID erst jetzt ermitteln (für alle Treffer vorab wäre es zu langsam)
async function messageIdOf(h) {
  if (h._id != null) return h._id;
  const res = await messenger.messages.query({ headerMessageId: h.hid });
  const list = res.messages || [];
  const pick = list.find(m => m.folder?.name === h.folder) || list[0];
  h._id = pick ? pick.id : null;
  return h._id;
}

async function openInTab(h) {
  try {
    const id = await messageIdOf(h);
    if (id != null) await messenger.messageDisplay.open({ messageId: id, location: "tab" });
  } catch (e) {
    console.error("NovaBird-Search: Nachricht öffnen", e);
  }
}

function collectParts(part, acc) {
  const ct = (part.contentType || "").toLowerCase();
  if (part.body != null && ct === "text/html" && !part.name) acc.html.push(part.body);
  else if (part.body != null && ct === "text/plain" && !part.name) acc.text.push(part.body);
  if (part.name) acc.atts.push(part);
  const cid = (part.headers?.["content-id"] || [])[0];
  if (cid && ct.startsWith("image/")) acc.cids.set(cid.replace(/^<|>$/g, ""), part);
  for (const sub of part.parts || []) collectParts(sub, acc);
}

const toDataUrl = file => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result);
  r.onerror = reject;
  r.readAsDataURL(file);
});

async function selectHit(h) {
  selected = h;
  for (const row of document.querySelectorAll("#list .row.sel")) row.classList.remove("sel");
  h._row?.classList.add("sel");
  const token = ++paneToken;
  const pane = $("pane");
  try {
    const id = await messageIdOf(h);
    if (id == null) throw new Error("keine ID");
    const [head, full] = await Promise.all([messenger.messages.get(id), messenger.messages.getFull(id)]);
    if (token !== paneToken) return;
    const acc = { html: [], text: [], atts: [], cids: new Map() };
    collectParts(full, acc);
    pane.replaceChildren();
    const mh = el("div", "mh");
    mh.append(el("h2", "mt", head.subject || ""));
    const mm = el("div", "mm");
    const line = (label, value) => {
      if (!value) return;
      const d = el("div");
      d.append(el("b", "", label + ": "), document.createTextNode(value));
      mm.append(d);
    };
    line(t("anaFrom"), head.author);
    line(t("anaTo"), (head.recipients || []).join(", "));
    line(t("anaCc"), (head.ccList || []).join(", "));
    const when = head.date ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(head.date)) : "";
    mm.append(el("div", "", `${when} · ${h.folder}`));
    mh.append(mm);
    const acts = el("div", "acts");
    const openBtn = el("button", "", t("anaOpenTab"));
    openBtn.type = "button";
    openBtn.addEventListener("click", () => openInTab(h));
    acts.append(openBtn);
    for (const part of acc.atts) {
      const b = el("button", "att", part.name);
      b.type = "button";
      b.addEventListener("click", async () => {
        try {
          const tab = await messenger.tabs.getCurrent();
          await messenger.messages.openAttachment(id, part.partName, tab.id);
        } catch (e) {
          console.error("NovaBird-Search: Anhang öffnen", e);
        }
      });
      acts.append(b);
    }
    mh.append(acts);
    const body = el("div", "body");
    if (acc.html.length) {
      let html = acc.html.join("\n");
      // eingebettete Bilder (cid:) einsetzen, höchstens 12 Stück bis 3 MB
      let n = 0;
      for (const [cid, part] of acc.cids) {
        if (n >= 12 || !html.includes("cid:" + cid)) continue;
        try {
          const file = await messenger.messages.getAttachmentFile(id, part.partName);
          if (file.size <= 3e6) {
            html = html.split("cid:" + cid).join(await toDataUrl(file));
            n++;
          }
        } catch (e) {
          console.warn("NovaBird-Search: Bild", cid, e);
        }
      }
      if (token !== paneToken) return;
      const frame = el("iframe");
      // abgesichert: keine Skripte, keine fremden Inhalte (Bilder nur eingebettet)
      frame.setAttribute("sandbox", "allow-popups allow-popups-to-escape-sandbox");
      frame.srcdoc = `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'"><base target="_blank"><style>body{font:14px/1.5 sans-serif;margin:8px;overflow-wrap:anywhere}</style>${html}`;
      body.append(frame);
    } else {
      body.append(Object.assign(el("pre"), { textContent: acc.text.join("\n\n") || t("anaNoText") }));
    }
    pane.append(mh, body);
    pane.scrollTop = 0;
    if (!h.read) {
      h.read = true;
      h._row?.classList.remove("unread");
      messenger.messages.update(id, { read: true }).catch(() => {});
    }
  } catch (e) {
    if (token !== paneToken) return;
    console.error("NovaBird-Search: Vorschau", e);
    pane.replaceChildren(Object.assign(el("div", "empty"), { textContent: t("anaMsgError") }));
  }
}

document.addEventListener("keydown", e => {
  if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || e.target.closest?.("input, textarea, select") || narrow.matches) return;
  const hits = data?.hits.filter(h => matches(h)) || [];
  if (!hits.length) return;
  const i = hits.indexOf(selected);
  const next = hits[Math.max(0, Math.min(hits.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
  if (next && next !== selected) {
    e.preventDefault();
    if (hits.indexOf(next) >= shown) shown = hits.indexOf(next) + PAGE;
    selectHit(next);
    if (!next._row || !next._row.isConnected) renderList();
    document.querySelector("#list .row.sel")?.scrollIntoView({ block: "nearest" });
  }
});

function renderList() {
  const box = $("list");
  box.replaceChildren();
  const hits = data.hits.filter(h => matches(h));
  if (!hits.length) {
    box.append(el("div", "footer", t("anaNone")));
    return hits;
  }
  const fmt = new Intl.DateTimeFormat(undefined, { day: "2-digit", month: "2-digit", year: "2-digit" });
  for (const h of hits.slice(0, shown)) {
    const row = el("button", "row" + (h.read ? "" : " unread") + (h === selected ? " sel" : ""));
    h._row = row;
    row.type = "button";
    const l1 = el("div", "l1");
    const subj = el("span", "subj");
    highlight(subj, h.subject || "(–)");
    l1.append(subj, el("span", "date", fmt.format(new Date(h.date * 1000))));
    const l2 = el("div", "l2");
    l2.append(`${h._from} · ${h.folder}`);
    if (h.att) l2.append(el("span", "badge", t("anaAttachment")));
    row.title = `${h.account}${h.account ? " / " : ""}${h.folder}`;
    row.append(l1, l2);
    row.addEventListener("click", () => (narrow.matches ? openInTab(h) : selectHit(h)));
    row.addEventListener("dblclick", () => openInTab(h));
    box.append(row);
  }
  if (hits.length > shown) {
    const foot = el("div", "footer");
    const more = el("button", "", t("anaMore"));
    more.type = "button";
    more.addEventListener("click", () => { shown += PAGE; renderList(); });
    foot.append(el("span", "", t("anaShown", { n: Math.min(shown, hits.length), m: hits.length })), more);
    box.append(foot);
  }
  return hits;
}

function render() {
  renderFacets();
  renderChart();
  const hits = renderList();
  const active = sel.from.size || sel.to.size || sel.folder.size || sel.month.size || sel.att || sel.me;
  $("reset").hidden = !active;
  $("count").textContent = t("anaCount", { n: hits.length, f: new Set(hits.map(h => h._folder)).size });
}

$("reset").addEventListener("click", () => {
  sel.from.clear(); sel.to.clear(); sel.folder.clear(); sel.month.clear(); sel.att = false; sel.me = false;
  shown = PAGE;
  render();
});
$("open").addEventListener("click", () => {
  const items = data.hits.filter(h => matches(h)).map(h => ({ hid: h.hid, folderUri: h.folderUri }));
  messenger.runtime.sendMessage({ type: "analysis:open-list", id: data.id, items, title: data.text });
});

function applyTheme(vars) {
  const root = document.documentElement.style;
  const map = {
    "--layout-background-1": "--bg", "--layout-color-1": "--fg", "--layout-border-0": "--line",
    "--selected-item-color": "--accent", "--selected-item-text-color": "--on-accent",
    "--button-hover-background-color": "--hover",
  };
  for (const [from, to] of Object.entries(map)) {
    if (vars?.[from]) root.setProperty(to, vars[from]);
  }
  if (vars?.["--layout-color-1"]) {
    root.setProperty("--muted", `color-mix(in srgb, ${vars["--layout-color-1"]} 62%, transparent)`);
  }
}

async function init() {
  document.title = `${t("anaTitle")} – NovaBird-Search`;
  $("reset").textContent = t("anaReset");
  $("open").textContent = t("anaOpenList");
  $("chart-title").textContent = t("anaPerMonth");
  $("count").textContent = t("anaLoading");
  // Die Seite wird ohne Parameter geöffnet (mit „?id=“ oder „#id“ fehlte im Labortest die Erweiterungs-API); der Hintergrund gibt die neueste noch nicht abgeholte Analyse heraus.
  const res = await messenger.runtime.sendMessage({ type: "analysis:get" });
  if (!res?.ok) {
    document.querySelector("main").hidden = true;
    $("chart-wrap").hidden = true;
    $("msg").hidden = false;
    $("msg").textContent = t("anaGone");
    return;
  }
  applyTheme(res.theme);
  data = res;
  mine = (res.mine || []).map(m => ({ email: String(m.email), account: String(m.account || "") }));
  for (const m of mine) ownOn.add(m.email);
  // kleinstes/größtes Datum (Schleife statt Math.min(...): bei sehr vielen Treffern zu groß für die Argumentliste)
  range.min = Infinity;
  range.max = -Infinity;
  for (const h of data.hits) {
    if (h.date < range.min) range.min = h.date;
    if (h.date > range.max) range.max = h.date;
  }
  const spanMonths = data.hits.length ? (range.max - range.min) / (30.44 * 86400) : 0;
  gran = spanMonths > 60 ? "year" : "month";
  for (const h of data.hits) {
    h._from = authorName(h.author);
    h._folder = h.folder;
    h._month = bucketKey(h.date);
    h.toE = [];
    h.toN = [];
    h._to = [];
  }
  document.addEventListener("click", e => {
    if (meOpen && !e.target.closest(".me-wrap")) { meOpen = false; render(); }
  });
  words = (data.text.match(/[^\s"]{2,}/g) || []).filter(w => !/^\w+:/.test(w));
  $("title").textContent = `${t("anaTitle")}: ${data.text}`;
  const [q1, q2] = (messenger.i18n.getUILanguage() || "").startsWith("de") ? ["„", "“"] : ["“", "”"];
  document.title = `${t("anaTitle")} ${q1}${data.text}${q2}`; // Tab-Titel nach dem Suchbegriff
  $("pane").append(Object.assign(el("div", "empty"), { textContent: t("anaPickMsg") }));
  render();
  loadRecipients();
}

// Empfänger (An/Kopie) in Blöcken nachladen, damit die Seite sofort bedienbar ist
async function loadRecipients() {
  const n = data.hits.length;
  const CH = 500;
  try {
    for (let from = 0; from < n; from += CH) {
      const part = await messenger.runtime.sendMessage({ type: "analysis:recipients", id: data.id, from, count: CH });
      (part || []).forEach(([e, names], i) => {
        const h = data.hits[from + i];
        if (h) { h.toE = e; h.toN = names; }
      });
      recip.pct = Math.round((Math.min(n, from + CH) / n) * 100);
      const label = $("recip-progress");
      if (label) label.textContent = t("anaRecipLoading", { p: recip.pct });
    }
    for (const h of data.hits) {
      h._to = h.toE.map((e, i) => (mine.some(m => m.email === e) ? null : h.toN[i])).filter(Boolean);
    }
  } catch (e) {
    console.error("NovaBird-Search: Empfänger", e);
  }
  recip.done = true;
  render();
}
// Trennlinie zwischen Liste und Vorschau: ziehbar (Doppelklick = Standard), Breite wird gemerkt
(function setupSplit() {
  const main = document.querySelector("main");
  const split = $("split");
  const KEY = "analysisListWidth";
  const apply = px => main.style.setProperty("--list-w", `${Math.round(px)}px`);
  try {
    const saved = Number(localStorage.getItem(KEY));
    if (saved >= 240) apply(saved);
  } catch (e) { /* kein Speicher: Standardbreite */ }
  let dragging = false;
  split.addEventListener("pointerdown", e => {
    dragging = true;
    split.classList.add("drag");
    try { split.setPointerCapture(e.pointerId); } catch (err) { /* ohne Capture reicht der Fensterhörer unten */ }
  });
  const move = e => {
    if (!dragging) return;
    const left = $("list").getBoundingClientRect().left;
    apply(Math.max(240, Math.min(e.clientX - left, main.clientWidth - 230 - 320)));
  };
  split.addEventListener("pointermove", move);
  window.addEventListener("pointermove", move);
  const end = () => {
    if (!dragging) return;
    dragging = false;
    split.classList.remove("drag");
    try { localStorage.setItem(KEY, String(Math.round($("list").getBoundingClientRect().width))); } catch (err) { /* egal */ }
  };
  split.addEventListener("pointerup", end);
  split.addEventListener("pointercancel", end);
  window.addEventListener("pointerup", end);
  split.addEventListener("dblclick", () => {
    main.style.removeProperty("--list-w");
    try { localStorage.removeItem(KEY); } catch (err) { /* egal */ }
  });
})();

init().catch(e => {
  console.error("NovaBird-Search: Analyse", e);
  $("msg").hidden = false;
  $("msg").textContent = String(e);
});
