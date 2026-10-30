"use strict";
// Reiter der Einstellungsseite; der zuletzt gewählte wird gemerkt (nur Bequemlichkeit, darf fehlen). #indexTab in der Adresse öffnet direkt diesen Reiter.
(() => {
  const KEY = "novabird-search-tab";
  const buttons = [...document.querySelectorAll("nav.tabs button")];
  function show(id) {
    const b = buttons.find(x => x.dataset.tab === id) ?? buttons[0];
    for (const o of buttons) {
      o.classList.toggle("active", o === b);
      o.setAttribute("aria-selected", String(o === b));
      document.getElementById(o.dataset.tab).hidden = o !== b;
    }
    try {
      localStorage.setItem(KEY, b.dataset.tab);
    } catch {
      /* ohne Speicher */
    }
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
