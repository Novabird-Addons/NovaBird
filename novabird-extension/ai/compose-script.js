"use strict";

/* Schreiben: läuft im Editor des Verfassen-Fensters (composeScripts). Liefert markierten bzw. eigenen Text (ohne Zitat und
 * Signatur) und fügt das Ergebnis der KI ein – über execCommand, damit Strg+Z es wieder rückgängig macht. */
(() => {
  const STOP = "blockquote[type='cite'], .moz-cite-prefix, .moz-forward-container, .moz-signature, pre.moz-signature, span[_moz_quote]";
  let saved = null; // Markierung beim Öffnen des KI-Fensters (der Editor verliert dann den Fokus)

  // Erstes Element oben im Text, ab dem Zitat oder Signatur beginnen
  function boundary() {
    for (const n of document.body.childNodes) {
      if (n.nodeType === 1 && (n.matches(STOP) || n.querySelector(STOP))) return n;
      if (n.nodeType === 3 && n.data.trim() === "--") return n; // Signaturtrenner im Klartext
    }
    return null;
  }

  function ownRange() {
    const r = document.createRange();
    r.setStart(document.body, 0);
    const stop = boundary();
    if (stop) r.setEndBefore(stop);
    else r.setEnd(document.body, document.body.childNodes.length);
    return r;
  }

  // Text eines Bereichs mit Zeilenumbrüchen (innerText geht nur mit Layout)
  const BLOCK = /^(P|DIV|LI|H[1-6]|PRE|TR|BLOCKQUOTE|UL|OL|TABLE)$/;
  function textOf(node) {
    let out = "";
    const walk = n => {
      if (n.nodeType === 3) out += n.data;
      else if (n.nodeName === "BR") out += "\n";
      else {
        for (const c of n.childNodes) walk(c);
        if (BLOCK.test(n.nodeName) && !out.endsWith("\n")) out += "\n";
      }
    };
    walk(node);
    return out.replace(/ /g, " ").replace(/\n{3,}/g, "\n\n").trim();
  }

  const escape = s => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function insert(text, mode, plain) {
    const sel = window.getSelection();
    if (mode === "own") {
      sel.removeAllRanges();
      sel.addRange(ownRange());
    } else if (saved) {
      sel.removeAllRanges();
      sel.addRange(saved);
    }
    document.body.focus();
    if (plain) {
      document.execCommand("insertText", false, text);
    } else {
      // Absätze als <p>, einzelne Umbrüche als <br>
      const html = text.split(/\n{2,}/).map(p => `<p>${p.split("\n").map(escape).join("<br>")}</p>`).join("");
      document.execCommand("insertHTML", false, html);
    }
    saved = null;
    return true;
  }

  browser.runtime.onMessage.addListener(msg => {
    if (msg?.type === "nbx-compose-get") {
      const sel = window.getSelection();
      saved = sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
      const selection = saved && !saved.collapsed ? sel.toString().trim() : "";
      const own = document.createElement("div");
      own.append(ownRange().cloneContents());
      return Promise.resolve({ selection, own: textOf(own) });
    }
    if (msg?.type === "nbx-compose-insert" && typeof msg.text === "string") {
      return Promise.resolve(insert(msg.text, msg.mode, Boolean(msg.plain)));
    }
    return undefined;
  });
})();
