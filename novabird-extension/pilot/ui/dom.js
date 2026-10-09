"use strict";
/* Minimaler DOM-Baukasten: Elemente erzeugen ohne innerHTML.
   h("button", { class: "ok", "data-act": "merge" }, icon, "Text")
   Texte werden immer als Textknoten eingefügt und dadurch nie als HTML interpretiert. */
(function () {
  function append(el, kids) {
    for (const k of kids.flat(Infinity)) {
      if (k === null || k === undefined || k === false || k === "") continue;
      el.append(k instanceof Node ? k : String(k));
    }
    return el;
  }
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style") Object.assign(el.style, v);
      else if (k.startsWith("data-") || k.startsWith("aria-")) el.setAttribute(k, v === true ? "" : String(v));
      else if (k in el) el[k] = v;
      else el.setAttribute(k, v === true ? "" : String(v));
    }
    return append(el, kids);
  }
  /* Inhalt eines Elements vollständig ersetzen */
  function set(el, ...kids) { el.replaceChildren(); return append(el, kids); }
  globalThis.DOM = { h, set, append };
})();
