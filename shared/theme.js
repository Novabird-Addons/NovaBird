/* NovaBird – Farben des laufenden Themes aus einem Hauptfenster lesen (Quelle: Source/shared/theme.js; im Paket shared/theme.js).
 * Nur für Experimente (braucht ein Chrome-Fenster); geladen per Services.scriptloader.loadSubScript in ein eigenes Objekt.
 * Liefert { dark, bg, fg, border, accent } als berechnete CSS-Farben (Ordnerbereich des Themes, sonst neutrale Ersatzfarben).
 */
"use strict";

function nbReadThemeColors(win) {
  if (!win) {
    return null;
  }
  const dark = win.matchMedia("(prefers-color-scheme: dark)").matches;
  const fb = dark
    ? { bg: "#1d1e22", fg: "#dadde3", border: "#2a2c31", accent: "#5b9dff" }
    : { bg: "#e6ecf5", fg: "#1e2838", border: "#d2dae6", accent: "#2f6bd8" };
  const chains = {
    bg: `var(--sidebar-background-color, ${fb.bg})`,
    fg: `var(--sidebar-text-color, ${fb.fg})`,
    border: `var(--sidebar-border-color, ${fb.border})`,
    accent: `var(--lwt-toolbarbutton-icon-fill-attention, var(--lwt-tab-line-color, var(--color-accent-primary, ${fb.accent})))`,
  };
  const doc = win.document;
  const probe = doc.createElementNS("http://www.w3.org/1999/xhtml", "span");
  (doc.body || doc.documentElement).appendChild(probe);
  try {
    const result = { dark };
    for (const [key, chain] of Object.entries(chains)) {
      probe.style.color = chain;
      result[key] = win.getComputedStyle(probe).color;
    }
    return result;
  } finally {
    probe.remove();
  }
}
