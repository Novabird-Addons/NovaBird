"use strict";
// Reiter der Einstellungsseite; der zuletzt gewählte wird gemerkt (nur Bequemlichkeit, darf fehlen). #indexTab in der Adresse öffnet direkt diesen Reiter.
// ?view=<Reiter>: nur dieser Reiter, ohne Reiterleiste (Einstellungen → NovaBird zeigt jeden Reiter als eigenen Unterreiter).
(() => {
  const KEY = "novabird-search-tab";
  const buttons = [...document.querySelectorAll("nav.tabs button")];
  const view = new URLSearchParams(location.search).get("view");
  const single = buttons.some(x => x.dataset.tab === view) ? view : null;
  function show(id) {
    const b = buttons.find(x => x.dataset.tab === id) ?? buttons[0];
    for (const o of buttons) {
      o.classList.toggle("active", o === b);
      o.setAttribute("aria-selected", String(o === b));
      document.getElementById(o.dataset.tab).hidden = o !== b;
    }
    try {
      if (!single) {
        localStorage.setItem(KEY, b.dataset.tab);
      }
    } catch {
      /* ohne Speicher */
    }
  }
  if (single) {
    document.querySelector("nav.tabs").hidden = true;
    show(single);
    return;
  }
  for (const b of buttons) {
    b.addEventListener("click", () => show(b.dataset.tab));
  }
  let last = null;
  try {
    last = localStorage.getItem(KEY);
  } catch {
    /* ohne Speicher */
  }
  show(location.hash.slice(1) || last);
})();
