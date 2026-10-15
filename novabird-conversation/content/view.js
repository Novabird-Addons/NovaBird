/* NovaBird-Conversation – Anzeige im Lesebereich. Läuft im Nachrichtendokument, spricht nur über runtime-Nachrichten mit dem Hintergrundskript. */
"use strict";

(async () => {
  const api = typeof messenger !== "undefined" ? messenger : browser;
  if (window !== window.top) return;

  // Ursprüngliches Dokument der Mail (für „Original anzeigen“); wird beim ersten Übernehmen gesichert
  let original = null;

  // Die ganze Ansicht ist eine Funktion, damit sie nach dem Löschen einer Nachricht neu aufgebaut werden kann
  async function run() {
  if (document.getElementById("nbc-root")) return;

  const T0 = performance.now();
  // Standardtext kurz unsichtbar halten, bis die Konversation da ist (kein Aufblitzen und Ersetzen); nach 1,5 s wird er in jedem Fall gezeigt
  const rootEl = document.documentElement;
  // (das Verstecken selbst macht view.css von Anfang an, ohne Aufblitzen; hier wird nur wieder gezeigt)
  // Lesebereich wieder sichtbar machen: das Experiment versteckt ihn vor dem Laden einer anderen Mail (kein Aufblitzen des Originals)
  const revealPane = () => api.runtime.sendMessage({ type: "reveal" }).catch(() => {});
  const unpend = () => {
    if (rootEl.classList.contains("nbc-shown")) return;
    if (document.body) document.body.style.transition = "opacity 90ms";
    rootEl.classList.add("nbc-shown");
    revealPane();
  };
  setTimeout(unpend, 1500);
  // kleiner Hinweis, solange die Konversation gesucht wird (der normale Text bleibt sichtbar)
  const hint = document.createElement("div");
  hint.id = "nbc-hint";
  hint.textContent = "◐";
  hint.hidden = true;
  setTimeout(() => { hint.hidden = false; }, 120);
  document.documentElement.append(hint);
  const marks = {};
  const mark = name => { marks[name] = Math.round(performance.now() - T0); document.documentElement.dataset.nbcTiming = JSON.stringify(marks); };
  let data;
  try {
    data = await api.runtime.sendMessage({ type: "hello" });
    mark("hello");
    if (data?.timing) document.documentElement.dataset.nbcBg = JSON.stringify(data.timing);
  } catch (e) {
    unpend();
    return;
  }
  hint.remove();
  if (!data) {
    unpend();
    return;
  }

  const { settings, strings, lang } = data;
  const t = key => strings[key] ?? key;
  const send = msg => api.runtime.sendMessage(msg);
  const asc = data.messages.slice().sort((a, b) => a.date - b.date || String(a.id).localeCompare(String(b.id), undefined, { numeric: true }));
  const expanded = new Set(data.expanded);
  expanded.add(data.selectedId);
  // Nicht lokal gespeicherte Nachrichten (IMAP ohne Offline-Speicherung) nur automatisch laden, wenn der Nutzer sie ohnehin sieht:
  // die neueste, die davor und die gewählte. Alle anderen bleiben zu, bis jemand sie aufklappt.
  const keepAuto = new Set([asc[asc.length - 1]?.id, asc[asc.length - 2]?.id, data.selectedId]);
  for (const m of asc) if (m.local === false && !keepAuto.has(m.id)) expanded.delete(m.id);
  const bodies = new Map();   // id → Promise<{html,text,attachments}>
  const els = new Map();      // id → { card, body }
  const newestFirst = settings.order === "newest";
  const ordered = newestFirst ? asc.slice().reverse() : asc;
  const pinnedMsg = newestFirst && settings.pin ? ordered[0] : null;
  const relative = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  const timeFmt = new Intl.DateTimeFormat(lang, { hour: "2-digit", minute: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat(lang, { day: "2-digit", month: "2-digit", year: "numeric" });
  const weekdayFmt = new Intl.DateTimeFormat(lang, { weekday: "short" });

  const el = (tag, cls, text) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  };

  function formatDate(ms) {
    const d = new Date(ms);
    const days = Math.round((new Date().setHours(0, 0, 0, 0) - new Date(ms).setHours(0, 0, 0, 0)) / 86400000);
    if (days === 0 || days === 1) return `${relative.format(-days, "day")}, ${timeFmt.format(d)}`;
    if (days > 1 && days < 7) return `${weekdayFmt.format(d)}, ${timeFmt.format(d)}`;
    return `${dateFmt.format(d)}, ${timeFmt.format(d)}`;
  }

  function initials(name) {
    const parts = name.replace(/[<>"@.]/g, " ").trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
  }

  function hue(name) {
    let h = 0;
    for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
    return h;
  }

  function sizeText(n) {
    if (!n) return "";
    return n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
  }

  function getBody(id) {
    if (!bodies.has(id)) {
      const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error(t("loadFailed"))), 45000));
      const request = Promise.race([send({ type: "body", id }), timeout]);
      request.catch(() => bodies.delete(id));
      bodies.set(id, request);
    }
    return bodies.get(id);
  }

  // ---------- Text aufbereiten ----------

  function quoteBox(contentNode) {
    const details = el("details", "nbc-q");
    const summary = el("summary", null, "…");
    summary.title = t("quoteToggle");
    details.append(summary, contentNode);
    return details;
  }

  function renderPlain(text) {
    const wrap = el("div");
    let block = [];
    let quoted = false;
    const flush = () => {
      if (!block.length) return;
      const pre = el("pre", "nbc-text", block.join("\n"));
      wrap.append(quoted && settings.collapseQuotes ? quoteBox(pre) : pre);
      block = [];
    };
    for (const line of text.slice(0, 200000).split(/\r?\n/)) {
      const isQuote = /^\s*>/.test(line);
      if (isQuote !== quoted) flush();
      quoted = isQuote;
      block.push(line);
    }
    flush();
    return wrap;
  }

  const DROP = new Set(["script", "style", "head", "title", "meta", "link", "iframe", "frame", "frameset", "object", "embed",
    "form", "input", "button", "textarea", "select", "svg", "math", "base", "noscript", "template", "audio", "video", "canvas", "map"]);
  const KEEP = new Set(["a", "abbr", "b", "blockquote", "br", "center", "cite", "code", "dd", "div", "dl", "dt", "em", "font",
    "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "li", "ol", "p", "pre", "q", "s", "small", "span", "strike",
    "strong", "sub", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul"]);

  // Externe Bilder: nur nach Klick auf „Anzeigen“ (nur diese Nachricht oder die ganze Unterhaltung), gilt bis die Ansicht neu geladen wird
  let autoChecked = false;
  const fullShown = new Set(); // Nachrichten, die über „Ganz anzeigen“ vollständig gezeigt werden
  const remoteOk = new Set();
  let remoteEverything = false;
  const allowedSenders = new Set(data.allowedSenders ?? []);
  const emailOfMsg = id => asc.find(m => m.id === id)?.email;
  const allowsRemote = id => remoteEverything || remoteOk.has(id) || allowedSenders.has(emailOfMsg(id));

  // Hinweisleiste (gelb, wie im Original) mit kleinem Optionen-Menü
  function remoteNotice(id) {
    const bar = el("div", "nbc-rbar");
    bar.append(el("span", "nbc-ricon", "⚠"), el("span", "nbc-rtext", t("remoteBlocked")));
    const holder = el("span", "nbc-rmenu");
    const button = el("button", "nbc-rbtn", `${t("remoteShow")} ▾`);
    button.type = "button";
    const popup = el("div", "nbc-popup");
    popup.hidden = true;
    popup.append(el("div", "nbc-ph", t("remoteAsk")));
    const item = (label, fn, small) => {
      const b = el("button", "nbc-mi", label);
      b.type = "button";
      if (small) b.append(el("small", null, small));
      b.addEventListener("click", () => { close(); fn(); });
      popup.append(b);
    };
    const email = emailOfMsg(id);
    item(t("remoteThis"), () => { remoteOk.add(id); fill(asc.find(m => m.id === id)); });
    item(t("remoteAll"), () => { remoteEverything = true; for (const m of asc) if (isPinnedOrOpen(m.id)) fill(m); });
    if (email) {
      popup.append(el("hr"));
      item(t("remoteSender"), async () => {
        if (!await send({ type: "allowSender", email })) return;
        allowedSenders.add(email);
        for (const m of asc) if (m.email === email && isPinnedOrOpen(m.id)) fill(m);
      }, email);
    }
    const onOutside = event => { if (!holder.contains(event.target)) close(); };
    const onKey = event => { if (event.key === "Escape") close(); };
    function close() {
      popup.hidden = true;
      document.removeEventListener("click", onOutside, true);
      document.removeEventListener("keydown", onKey, true);
    }
    button.addEventListener("click", () => {
      if (!popup.hidden) return close();
      popup.hidden = false;
      // fest positionieren, damit das Menü nicht vom scrollbaren Bereich der Karte abgeschnitten wird; nach oben, wenn unten kein Platz ist
      const r = button.getBoundingClientRect();
      const view = document.documentElement;
      popup.style.position = "fixed";
      popup.style.left = "auto";
      popup.style.right = `${Math.max(4, Math.round(view.clientWidth - r.right))}px`;
      const h = popup.offsetHeight;
      const below = r.bottom + 4;
      popup.style.top = `${Math.round(below + h > view.clientHeight && r.top - h - 4 >= 0 ? r.top - h - 4 : below)}px`;
      document.addEventListener("click", onOutside, true);
      document.addEventListener("keydown", onKey, true);
    });
    holder.append(button, popup);
    bar.append(holder);
    return bar;
  }

  const imageQueue = [];
  let imageBusy = 0;
  function loadRemoteImages(container) {
    for (const img of container.querySelectorAll("img.nbc-remote, img.nbc-cid")) imageQueue.push(img);
    const next = () => {
      while (imageBusy < 4 && imageQueue.length) {
        const img = imageQueue.shift();
        imageBusy++;
        send(img.dataset.nbcCid ? { type: "cidImage", id: img.nbcMsgId, partName: img.dataset.nbcCid } : { type: "image", url: img.dataset.nbcSrc }).then(data => {
          if (data) img.src = data;
          else img.replaceWith(el("span", null, `[${img.alt || "✕"}]`));
        }).catch(() => {}).finally(() => { imageBusy--; next(); });
      }
    };
    next();
  }

  // Absender verstecken Füllstoff (Anti-Spam-Zufallstext, Vorschauzeilen) per Stil; den übernehmen wir nicht, also gleich weglassen.
  // font-size:0 / max-height:0 nur bei Blättern: Layout-Zellen setzen font-size:0 gern, ihre Kinder haben eigene Größen.
  // (?<![\w-]) verhindert Treffer wie „background-color:transparent“ (das ist kein versteckter Text)
  const HIDDEN_ANY = /(?<![\w-])(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?![.\d])|mso-hide\s*:\s*all|color\s*:\s*transparent)|(?<![\w-])max-height\s*:\s*0[a-z%]*\s*[;!]?[^"]*overflow\s*:\s*hidden|overflow\s*:\s*hidden[^"]*(?<![\w-])max-height\s*:\s*0[a-z%]*\s*(?:;|!|$)/i;
  const HIDDEN_LEAF = /(?<![\w-])(?:font-size|max-height)\s*:\s*0[a-z%]*\s*(?:;|!|$)/i;
  const isHidden = node => {
    const style = node.getAttribute("style");
    if (!style) return false;
    return HIDDEN_ANY.test(style) || (node.childElementCount === 0 && HIDDEN_LEAF.test(style));
  };
  // Schriftgröße 0 vererbt sich: Leerraum und <br> darin sind im Original unsichtbar. Ohne Stile würden sie bei uns
  // eine Zeile hoch (Pixelbilder aus Tausenden 1-px-Zellen mit <br> werden sonst seitenlange leere Tabellen).
  // Echter Text bleibt (seine Größe kann aus einem Stilblatt kommen, das wir nicht übernehmen).
  const zeroFontOf = (node, inherited) => {
    if (node.localName === "font" && node.hasAttribute("size")) return false;
    const m = /(?<![\w-])font-size\s*:\s*([\d.]+)/i.exec(node.getAttribute("style") ?? "");
    return m ? Number(m[1]) === 0 : inherited;
  };
  const cssPx = (style, prop) => {
    const m = String(style ?? "").match(new RegExp(`(?:^|;)\\s*${prop}\\s*:\\s*(\\d+(?:\\.\\d+)?)px`, "i"));
    return m ? Number(m[1]) : null;
  };
  // Größe von Bildern aus Stil oder Attributen (sonst werden Abstandshalter-Bilder in voller Originalgröße gezeigt)
  function sizeImage(img, source) {
    const style = source.getAttribute("style");
    const num = v => (/^\d{1,4}(\.\d+)?$/.test(String(v ?? "").trim()) ? Number(v) : null);
    const w = cssPx(style, "width") ?? num(source.getAttribute("width"));
    const h = cssPx(style, "height") ?? num(source.getAttribute("height"));
    if (w != null && w <= 4000) img.style.width = `${w}px`;
    if (h != null && h <= 4000) {
      if (h <= 60 || w == null) img.style.height = `${h}px`;
      else if (w != null) img.style.aspectRatio = `${w} / ${h}`;
    }
    if (w != null && w > 0 && h != null && h > 60) img.style.height = "auto";
  }

  function renderHtml(html, id, body) {
    const doc = new DOMParser().parseFromString(html.slice(0, 1500000), "text/html");
    const state = { blocked: false };
    const out = el("div");

    const copy = (src, into, inQuote, zero) => {
      for (const child of src.childNodes) {
        if (child.nodeType === 3) {
          if (zero && !/\S/.test(child.nodeValue)) continue;
          into.append(document.createTextNode(child.nodeValue));
        } else if (child.nodeType === 1) {
          const tag = child.localName;
          if (DROP.has(tag) || isHidden(child)) continue;
          const childZero = zeroFontOf(child, zero);
          if (!KEEP.has(tag)) {
            copy(child, into, inQuote, childZero);
            continue;
          }
          if (tag === "br" && zero) continue;
          if (tag === "img") {
            const src2 = child.getAttribute("src") ?? "";
            const cidMatch = /^cid:(.+)$/i.exec(src2.trim());
            if (cidMatch) {
              // eingebettetes Bild der Mail selbst (harmlos, kein Netzzugriff)
              let wanted = cidMatch[1];
              try { wanted = decodeURIComponent(wanted); } catch (e) { /* roh lassen */ }
              const part = body?.attachments?.find(a => a.cid === wanted.toLowerCase());
              if (part) {
                const img = el("img", "nbc-cid");
                img.dataset.nbcCid = part.partName;
                img.nbcMsgId = id; // Schlüssel behält seinen Typ (Zahl oder Index-Schlüssel)
                if (child.alt) img.alt = child.alt;
                sizeImage(img, child);
                into.append(img);
              } else if (child.alt?.trim()) {
                into.append(el("span", null, `[${child.alt.trim()}]`));
              }
              continue;
            }
            if (/^data:image\/(png|jpe?g|gif|webp);/i.test(src2)) {
              const img = el("img");
              img.src = src2;
              if (child.alt) img.alt = child.alt;
              sizeImage(img, child);
              into.append(img);
            } else if (allowsRemote(id) && /^https?:\/\//i.test(src2)) {
              // erst nach Klick und über das Hintergrundskript geladen (ohne Cookies/Referrer), dann als data:-Bild eingesetzt
              const img = el("img", "nbc-remote");
              img.dataset.nbcSrc = src2;
              if (child.alt) img.alt = child.alt;
              sizeImage(img, child);
              into.append(img);
            } else {
              state.blocked = true;
              if (child.alt?.trim()) into.append(el("span", null, `[${child.alt.trim()}]`));
            }
            continue;
          }
          const node = el(tag);
          if (tag === "a") {
            const href = child.getAttribute("href") ?? "";
            if (/^(https?:|mailto:|tel:)/i.test(href)) node.setAttribute("href", href);
            node.setAttribute("rel", "noopener noreferrer");
          }
          for (const attr of ["colspan", "rowspan"]) {
            if (/^\d{1,3}$/.test(child.getAttribute(attr) ?? "")) node.setAttribute(attr, child.getAttribute(attr));
          }
          if (tag === "blockquote" && settings.collapseQuotes && !inQuote) {
            copy(child, node, true, childZero);
            into.append(quoteBox(node));
          } else {
            copy(child, node, inQuote || tag === "blockquote", childZero);
            into.append(node);
          }
        }
      }
    };
    copy(doc.body ?? doc.documentElement, out, false, false);
    // Tabellen ohne Text und Bild zeigen bei uns nichts (Farben/Größen sind weg), kosten aber Platz: weglassen
    for (const table of [...out.querySelectorAll("table")].reverse()) {
      if (!/\S/.test(table.textContent) && !table.querySelector("img, hr")) table.remove();
    }
    if (state.blocked) out.prepend(remoteNotice(id));
    loadRemoteImages(out);
    return out;
  }

  function previewOf(body) {
    const raw = body.text ?? (body.html ? new DOMParser().parseFromString(body.html.slice(0, 200000), "text/html").body?.textContent ?? "" : "");
    const lines = raw.split(/\r?\n/).filter(l => l.trim() && !/^\s*>/.test(l));
    return lines.join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
  }

  // ---------- Karten ----------

  function attachmentsNode(body) {
    const list = (body.attachments ?? []).filter(a => !a.inline);
    if (!list.length) return null;
    const box = el("div", "nbc-att");
    for (const a of list) {
      const chip = el("button", "nbc-chip");
      chip.type = "button";
      chip.append(document.createTextNode(`📎 ${a.name}`));
      if (a.size) chip.append(el("small", null, sizeText(a.size)));
      chip.addEventListener("click", () => send({ type: "action", action: "openAttachment", id: body.id, partName: a.partName }));
      box.append(chip);
    }
    return box;
  }

  function actionsNode(msg) {
    const row = el("div", "nbc-act");
    const btn = (key, action) => {
      const b = el("button", "nbc-btn", t(key));
      b.type = "button";
      b.addEventListener("click", () => send({ type: "action", action, id: msg.id }));
      return b;
    };
    const more = el("details");
    const summary = el("summary", "nbc-btn", `${t("more")} ▾`);
    more.append(summary, btn("forward", "forward"), btn("forwardAsAttachment", "forwardAsAttachment"), btn("editAsNew", "editAsNew"));
    const del = el("button", "nbc-btn nbc-del", `🗑 ${t("delete")}`);
    del.type = "button";
    del.title = t("deleteTip");
    del.addEventListener("click", async () => {
      del.disabled = true;
      try {
        await send({ type: "action", action: "delete", id: msg.id });
        document.getElementById("nbc-root")?.remove(); // Ansicht neu aufbauen (die gelöschte Nachricht ist dann weg)
        await run();
      } catch (e) {
        del.disabled = false;
      }
    });
    row.append(btn("reply", "reply"), btn("replyAll", "replyAll"), more, del);
    return row;
  }

  function toLine(msg) {
    if (!msg.recipients.length) return "";
    const names = msg.recipients.slice(0, 2).join(", ") + (msg.recipients.length > 2 ? ` (+${msg.recipients.length - 2})` : "");
    return t("toNamesTemplate").replace("%NAMES%", names);
  }

  // Rechtsklick auf den Absendernamen: eigenes kleines Menü „Mailadresse kopieren“
  function showAddressMenu(event, address) {
    document.querySelector(".nbc-ctx")?.remove();
    const menu = el("div", "nbc-ctx");
    const item = el("button", "nbc-ctx-item", t("copyAddress"));
    item.type = "button";
    const close = () => { menu.remove(); document.removeEventListener("mousedown", onDown, true); document.removeEventListener("keydown", onKey, true); };
    const onDown = e => { if (!menu.contains(e.target)) close(); };
    const onKey = e => { if (e.key === "Escape") close(); };
    item.addEventListener("click", () => {
      send({ type: "copyText", text: address }).catch(e => console.error("NovaBird-Conversation: Kopieren", e));
      close();
    });
    menu.append(item);
    document.body.append(menu);
    menu.style.left = Math.max(4, Math.min(event.clientX, document.documentElement.clientWidth - menu.offsetWidth - 4)) + "px";
    menu.style.top = Math.max(4, Math.min(event.clientY, document.documentElement.clientHeight - menu.offsetHeight - 4)) + "px";
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
  }

  function buildCard(msg, isPinned) {
    const card = el("section", "nbc-card");
    if (!msg.read) card.classList.add("unread");
    if (msg.id === data.selectedId) card.classList.add("selected");
    if (msg.mine) card.classList.add("mine");
    const hd = el("div", "nbc-hd");
    const av = el("div", "nbc-av", initials(msg.author));
    av.style.setProperty("--h", hue(msg.author));
    const who = el("div", "nbc-who");
    const name = el("div", "nbc-name", msg.author);
    if (msg.email) {
      name.title = msg.email; // Absenderadresse beim Überfahren
      name.addEventListener("contextmenu", event => { event.preventDefault(); event.stopPropagation(); showAddressMenu(event, msg.email); });
    }
    if (!msg.read) name.append(el("span", "nbc-badge", t("newBadge")));
    who.append(name);
    const sub = el("div", "nbc-sub", toLine(msg));
    if (sub.textContent) who.append(sub);
    hd.append(av, who);
    if (msg.local === false) {
      const cloud = el("span", "nbc-cloud", "☁");
      cloud.title = t("notDownloaded");
      hd.append(cloud);
    }
    if (msg.id === data.selectedId) {
      const orig = el("button", "nbc-orig", t("originalBtn"));
      orig.type = "button";
      orig.title = t("originalTip");
      orig.addEventListener("click", event => { event.stopPropagation(); showOriginal(); });
      hd.append(orig);
    }
    if (!msg.mine) {
      const isJunk = msg.folderType === "junk";
      const spam = el("button", "nbc-spam", t(isJunk ? "notSpam" : "spam"));
      spam.type = "button";
      spam.title = t(isJunk ? "notSpamTip" : "spamTip");
      spam.addEventListener("click", async event => {
        event.stopPropagation();
        spam.disabled = true;
        try {
          await send({ type: "action", action: isJunk ? "notJunk" : "junk", id: msg.id });
          document.getElementById("nbc-root")?.remove();
          await run();
        } catch (e) {
          spam.disabled = false;
        }
      });
      hd.append(spam);
    }
    hd.append(el("div", "nbc-date", formatDate(msg.date)));
    card.append(hd);
    const slot = el("div");
    card.append(slot);
    els.set(msg.id, { card, hd, slot, who, preview: null, isPinned, built: false });
    if (!isPinned) hd.addEventListener("click", () => toggle(msg.id));
    return card;
  }

  async function fill(msg, animate = false) {
    const e = els.get(msg.id);
    const open = isPinnedOrOpen(msg.id);
    e.card.classList.toggle("open", open);
    e.slot.replaceChildren();
    if (open && e.preview) {
      e.preview.remove();
      e.preview = null;
    }
    if (!open) {
      if (msg.snippet && !e.preview) {
        // Vorschau aus dem Index (kein Textabruf nötig)
        e.preview = el("div", "nbc-pv", msg.snippet);
        e.hd.insertBefore(e.preview, e.hd.querySelector(".nbc-date") ?? null);
      }
      if (e.preview) e.who.querySelector(".nbc-sub")?.remove();
      else if (!e.who.querySelector(".nbc-sub") && toLine(msg)) e.who.append(el("div", "nbc-sub", toLine(msg)));
      return;
    }
    e.slot.append(el("p", "nbc-blocked nbc-loading", t("loading")));
    let body;
    try {
      body = await getBody(msg.id);
    } catch (err) {
      if (e.slot.isConnected && isPinnedOrOpen(msg.id)) {
        e.slot.replaceChildren(el("p", "nbc-blocked", String(err?.message ?? err)), actionsNode(msg));
      }
      return;
    }
    if (!isPinnedOrOpen(msg.id)) return;
    e.slot.replaceChildren();
    body.id = msg.id;
    const attNode = attachmentsNode(body);
    if (attNode && settings.attachments === "top") e.slot.append(attNode);
    const content = body.html ? renderHtml(body.html, msg.id, body) : body.text ? renderPlain(body.text) : el("p", null, t("noText"));
    const bodyBox = el("div", "nbc-body");
    const rbar = content.querySelector?.(":scope > .nbc-rbar");
    if (rbar) e.slot.append(rbar);
    bodyBox.append(content);
    e.slot.append(bodyBox);
    if (settings.autoOriginal && asc.length === 1 && msg.id === data.selectedId && !autoChecked && looksUnreadable(body, bodyBox)) {
      autoChecked = true;
      showOriginal();
      return;
    }
    autoChecked = true;
    // Höchsthöhe nur, wenn darunter weitere Nachrichten folgen; eine einzelne Nachricht steht immer ganz da
    if (e.isPinned && asc.length > 1) {
      bodyBox.classList.add("limited");
      const more = el("div", "nbc-more");
      // „Ganz anzeigen“ bleibt erhalten, wenn die Nachricht neu aufgebaut wird (z. B. nach dem Laden der Bilder)
      const wasFull = fullShown.has(msg.id);
      if (wasFull) bodyBox.classList.add("full");
      const toggleBtn = el("button", "nbc-link", wasFull ? `▴ ${t("showLess")}` : `▾ ${t("showFull")}`);
      toggleBtn.type = "button";
      toggleBtn.addEventListener("click", () => {
        const full = bodyBox.classList.toggle("full");
        if (full) fullShown.add(msg.id);
        else fullShown.delete(msg.id);
        toggleBtn.textContent = full ? `▴ ${t("showLess")}` : `▾ ${t("showFull")}`;
      });
      more.append(toggleBtn);
      e.slot.append(more);
      // Link nur zeigen, wenn der Text wirklich abgeschnitten ist; wächst der Inhalt später (nachgeladene Bilder), erscheint er von selbst
      const check = () => { more.hidden = bodyBox.classList.contains("full") ? false : bodyBox.scrollHeight <= bodyBox.clientHeight + 2; };
      more.hidden = true;
      requestAnimationFrame(check);
      if (window.ResizeObserver) new ResizeObserver(check).observe(content);
    }
    if (attNode && settings.attachments === "bottom") e.slot.append(attachmentsNode(body));
    e.slot.append(actionsNode(msg));
    if (animate) reveal(e.slot);
  }

  // kurzes Aufgleiten + Einblenden (Höhe 0 → volle Höhe), nur wenn eingestellt und vom System nicht unerwünscht
  const calm = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  function reveal(slot) {
    const ms = settings.openMs;
    if (!ms || calm || !slot.animate) return;
    const h = slot.scrollHeight;
    slot.style.overflow = "hidden";
    const done = () => { slot.style.overflow = ""; };
    slot.animate([{ height: "0px", opacity: 0 }, { height: `${h}px`, opacity: 1 }], { duration: ms, easing: "ease-out" }).addEventListener("finish", done);
    setTimeout(done, ms + 100);
  }

  // Originalansicht von Betterbird (Mail mit eigenem HTML/CSS) wiederherstellen; oben ein schmaler Rückweg zur Konversationsansicht
  function showOriginal() {
    if (!original) return;
    document.getElementById("nbc-root")?.remove();
    document.body.className = "";
    for (const attr of [...document.body.attributes]) document.body.removeAttribute(attr.name);
    for (const [name, value] of original.bodyAttrs) if (name !== "class") document.body.setAttribute(name, value);
    for (const [name, value] of original.htmlAttrs) document.documentElement.setAttribute(name, value);
    for (const sheet of original.sheets) sheet.disabled = false;
    document.body.replaceChildren(...original.nodes);
    document.body.style.overflow = "";
    const bar = el("div");
    bar.id = "nbc-back";
    const back = el("button", "nbc-btn", `← ${t("backToConversation")}`);
    back.type = "button";
    back.addEventListener("click", async () => {
      bar.remove();
      send({ type: "header", hidden: true }).catch(() => {});
      await run();
    });
    bar.append(back);
    document.body.prepend(bar);
    send({ type: "header", hidden: false }).catch(() => {});
  }

  // Ist nach dem Filtern kaum Text übrig, obwohl die Mail viel enthält? Dann ist die Ansicht vermutlich unbrauchbar.
  function looksUnreadable(body, shown) {
    const visible = shown.textContent.replace(/\s+/g, " ").trim().length;
    let source = 0;
    if (body.text) {
      source = body.text.replace(/\s+/g, " ").trim().length;
    } else if (body.html) {
      const doc = new DOMParser().parseFromString(body.html.slice(0, 1500000), "text/html");
      for (const node of doc.querySelectorAll("style, script, head, title")) node.remove();
      source = (doc.body?.textContent ?? "").replace(/[\s\u200b-\u200f\u00ad\u034f\ufeff]+/g, " ").trim().length;
    }
    return source >= 200 && visible < source * 0.1;
  }

  const isPinnedOrOpen = id => els.get(id).isPinned || expanded.has(id);

  const closedByUser = new Set();
  function toggle(id) {
    if (expanded.has(id)) {
      expanded.delete(id);
      closedByUser.add(id);
      closing(id);
      return;
    }
    expanded.add(id);
    fill(asc.find(m => m.id === id), true);
  }

  // Zuklappen: Höhe → 0 mit Ausblenden (gleiche Dauer wie das Aufklappen), danach die Zeile neu aufbauen
  function closing(id) {
    const msg = asc.find(m => m.id === id);
    const slot = els.get(id).slot;
    const ms = settings.openMs;
    if (!ms || calm || !slot.animate || !slot.firstChild) {
      fill(msg);
      return;
    }
    slot.style.overflow = "hidden";
    const anim = slot.animate([{ height: `${slot.offsetHeight}px`, opacity: 1 }, { height: "0px", opacity: 0 }], { duration: ms, easing: "ease-in", fill: "forwards" });
    const done = () => { anim.cancel(); slot.style.overflow = ""; fill(msg); };
    anim.addEventListener("finish", done, { once: true });
  }

  function setAll(open) {
    for (const m of asc) {
      if (els.get(m.id).isPinned) continue;
      if (open) {
        expanded.add(m.id);
        closedByUser.delete(m.id);
      } else {
        expanded.delete(m.id);
        closedByUser.add(m.id);
      }
    }
    // Texte höchstens 3 gleichzeitig holen (bei IMAP ein Abruf je Nachricht); zugeklappte sofort
    const todo = asc.filter(m => !els.get(m.id).isPinned);
    const lane = async () => {
      while (todo.length) {
        try { await fill(todo.shift()); } catch (e) { /* Karte zeigt den Fehler selbst */ }
      }
    };
    return Promise.all([lane(), lane(), lane()]);
  }

  // Beim Scrollen: die zugeklappte Zeile unter dem Mauszeiger klappt auf, wenn der Zeiger nach dem Scrollen kurz stehen bleibt
  // (autoOpenDelay ms ohne Scrollen und ohne Mausbewegung). autoOpenTrigger "hover": auch ohne vorheriges Scrollen, nur durch Verweilen. Reagiert nur auf Eingaben des Nutzers, nicht auf Verschiebungen
  // durch den Aufbau oder unser eigenes Aufklappen.
  function setupAutoOpen(scroller) {
    if (!settings.autoOpen || !scroller) return;
    let quietUntil = Date.now() + 800;
    let timer = null, busy = false, scrolled = false;
    let px = -1, py = -1;
    const fire = async () => {
      timer = null;
      if (busy || px < 0 || !(scrolled || settings.autoOpenTrigger === "hover")) return;
      scrolled = false;
      const hit = document.elementFromPoint(px, py);
      if (!hit || !scroller.contains(hit)) return;
      for (const [id, e] of els) {
        if (e.isPinned || expanded.has(id) || closedByUser.has(id) || !e.card.contains(hit)) continue;
        busy = true;
        expanded.add(id);
        quietUntil = Date.now() + settings.openMs + 300;
        try { await fill(asc.find(m => m.id === id), true); } catch (err) { /* Karte zeigt den Fehler selbst */ }
        quietUntil = Date.now() + settings.openMs + 150;
        busy = false;
        break;
      }
    };
    const rearm = () => { clearTimeout(timer); timer = setTimeout(fire, settings.autoOpenDwell ? settings.autoOpenDelay : 0); };
    scroller.addEventListener("scroll", () => {
      if (Date.now() < quietUntil || busy) return;
      scrolled = true;
      rearm();
    }, { passive: true });
    scroller.addEventListener("pointermove", (ev) => {
      px = ev.clientX; py = ev.clientY;
      if (scrolled || settings.autoOpenTrigger === "hover") rearm();
    }, { passive: true });
    scroller.addEventListener("pointerleave", () => { px = py = -1; clearTimeout(timer); scrolled = false; });
  }

  // ---------- Aufbau ----------

  if (!original) {
    original = {
      nodes: [...document.body.childNodes],
      bodyAttrs: [...document.body.attributes].map(a => [a.name, a.value]),
      htmlAttrs: [...document.documentElement.attributes].filter(a => ["style", "bgcolor", "background"].includes(a.name)).map(a => [a.name, a.value]),
      sheets: [...document.styleSheets].filter(sheet => sheet.ownerNode && !sheet.disabled),
    };
  }
  document.body.replaceChildren();
  // Das Dokument gehört noch der ursprünglichen Mail: deren Stilblätter (<style>/<link>) und die Eigenschaften von <body>
  // (Hintergrund, Textfarbe, Schrift …) würden sonst auf unsere Ansicht wirken (z. B. weiße Schrift auf hellem Grund).
  for (const sheet of original.sheets) sheet.disabled = true;
  for (const name of ["style", "bgcolor", "text", "link", "vlink", "alink", "background", "class", "dir", "lang"]) document.body.removeAttribute(name);
  for (const name of ["style", "bgcolor", "background"]) document.documentElement.removeAttribute(name);
  document.body.classList.add("nbc-on");
  const root = el("div");
  root.id = "nbc-root";
  root.classList.add(`nbc-style-${settings.style}`);
  if (settings.stickyHeader) root.classList.add("nbc-sticky");
  root.style.setProperty("--nbc-lines", String(settings.rowLines));
  root.style.setProperty("--nbc-max", `${settings.maxHeight}vh`);
  const SAFE_COLOR = /^(rgba?\([\d\s.,%/]+\)|color\(srgb [\d.\s/]+\)|#[0-9a-f]{6})$/i;
  for (const [key, prop] of [["accent", "--nbc-accent"], ["border", "--nbc-border"], ["bg", "--nbc-tint"]]) {
    if (typeof data.theme?.[key] === "string" && SAFE_COLOR.test(data.theme[key])) root.style.setProperty(prop, data.theme[key]);
  }

  const head = el("div", "nbc-head");
  const title = el("h1", null, data.subject);
  title.append(" ", el("span", "nbc-count", t("messagesCountTemplate").replace("%N%", String(asc.length))));
  let allOpen = false;
  const allBtn = el("button", "nbc-btn", t("expandAll"));
  allBtn.type = "button";
  allBtn.addEventListener("click", () => {
    allOpen = !allOpen;
    allBtn.textContent = t(allOpen ? "collapseAll" : "expandAll");
    setAll(allOpen);
  });
  const aiBtn = data.ai ? el("button", "nbc-btn", t("aiSummary")) : null;
  if (aiBtn) {
    aiBtn.type = "button";
    aiBtn.addEventListener("click", () => send({ type: "summarize", ids: asc.map(m => m.id) }).catch(() => {}));
  }
  if (asc.length > 1) head.append(title, ...(aiBtn ? [aiBtn] : []), allBtn);
  else head.append(title, ...(aiBtn ? [aiBtn] : []));
  root.append(head);

  const sep = () => el("hr", "nbc-sep");
  const cards = new Map(ordered.map(m => [m.id, buildCard(m, m === pinnedMsg)]));
  if (pinnedMsg) {
    const pinned = el("div", "nbc-pinned");
    pinned.append(cards.get(pinnedMsg.id));
    const history = el("div", "nbc-history");
    if (ordered.length > 1) history.append(el("div", "nbc-label", t("history")));
    for (const m of ordered) if (m !== pinnedMsg) history.append(cards.get(m.id));
    root.append(pinned, sep(), history);
  } else {
    const list = el("div", "nbc-list");
    ordered.forEach((m, i) => {
      // dezente Linie zwischen der aktuellen (neuesten) Nachricht und dem Verlauf
      if ((newestFirst && i === 1) || (!newestFirst && i === ordered.length - 1 && ordered.length > 1)) list.append(sep());
      list.append(cards.get(m.id));
    });
    root.append(list);
  }
  document.body.append(root);
  rootEl.classList.add("nbc-shown");
  // erst aufdecken, wenn die Ansicht einmal gezeichnet ist (der Bereich ist nur durchsichtig, gezeichnet wird weiter)
  requestAnimationFrame(() => revealPane());
  // Einblenden: Kopf und Karten steigen kurz auf und blenden ein, die ersten leicht versetzt (nur wenn eingestellt und vom System nicht unerwünscht).
  // Start erst, wenn das Dokument wirklich gezeichnet wird (requestAnimationFrame läuft nicht, solange der Lesebereich nicht sichtbar ist),
  // sonst ist die Animation vorbei, bevor Betterbird den Bereich zeigt.
  if (settings.fadeMs && !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
    root.classList.add("nbc-enter");
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      const step = Math.round(settings.fadeMs / 6);
      [head, ...root.querySelectorAll(".nbc-card")].forEach((node, i) => {
        node.style.animation = `nbc-rise ${settings.fadeMs}ms ease-out ${Math.min(i, 6) * step}ms backwards`;
      });
      root.classList.remove("nbc-enter");
    };
    requestAnimationFrame(() => requestAnimationFrame(start));
    setTimeout(start, 1500);
  }
  setupAutoOpen(root.querySelector(".nbc-history, .nbc-list"));
  // Vorschauzeilen aus dem Index sofort setzen (kein Textabruf)
  for (const m of ordered) if (!isPinnedOrOpen(m.id) && m.snippet) fill(m);
  mark("built");

  // Nur aufgeklappte Nachrichten laden (bei IMAP ein Abruf je Nachricht), höchstens 3 gleichzeitig
  const queue = ordered.filter(m => isPinnedOrOpen(m.id));
  const worker = async () => {
    while (queue.length) {
      const m = queue.shift();
      try {
        await fill(m);
      } catch (e) {
        els.get(m.id).slot.replaceChildren(el("p", "nbc-blocked", String(e?.message ?? e)));
      }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  mark("bodies");

  // Vorschauzeilen: nur für lokal gespeicherte, zugeklappte Nachrichten, nacheinander und begrenzt
  let alive = true;
  window.addEventListener("pagehide", () => { alive = false; });
  let previews = 0;
  for (const m of ordered) {
    if (!alive || previews >= 40) break;
    const e = els.get(m.id);
    if (isPinnedOrOpen(m.id) || m.local === false || e.preview || m.snippet !== undefined) continue;
    try {
      const text = previewOf(await getBody(m.id));
      if (!alive || isPinnedOrOpen(m.id)) continue;
      e.preview = el("div", "nbc-pv", text);
      e.hd.insertBefore(e.preview, e.hd.querySelector(".nbc-date"));
      e.who.querySelector(".nbc-sub")?.remove();
      previews++;
    } catch (err) {
      // Vorschau ist optional
    }
  }
  mark("previews");
  if (settings.debugTiming) console.info("NovaBird-Conversation: Anzeige (ms)", JSON.stringify(marks), "Hintergrund", JSON.stringify(data.timing));
  const selected = els.get(data.selectedId);
  if (selected && !selected.isPinned) selected.card.scrollIntoView({ block: "nearest" });
  }

  await run();
})();
