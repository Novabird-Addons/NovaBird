"use strict";
// Übernimmt die Farben des aktiven Themes (NovaBird-Themes); ohne Theme bleiben die eigenen Farben.
(() => {
  const api = globalThis.messenger || globalThis.browser;
  const STYLE_ID = "cp-theme";
  const lum = c => {
    const m = /(\d+)[ ,]+(\d+)[ ,]+(\d+)/.exec(c) || [];
    return m.length ? 0.299 * m[1] + 0.587 * m[2] + 0.114 * m[3] : 255;
  };
  const css = (colors) => {
    const c = colors || {};
    const asRgb = v => (Array.isArray(v) ? `rgb(${v.join(",")})` : v);
    const bg = asRgb(c.toolbar) || asRgb(c.frame);
    const fg = asRgb(c.toolbar_text) || asRgb(c.tab_text);
    if (!bg || !fg) return "";
    const dark = lum(bg.startsWith("#") ? hexToRgb(bg) : bg) < 128;
    const accent = asRgb(c.icons_attention) || asRgb(c.tab_line) || "#419bf9";
    const border = asRgb(c.sidebar_border) || asRgb(c.toolbar_bottom_separator) || `color-mix(in srgb, ${fg} 18%, ${bg})`;
    const card = dark ? `color-mix(in srgb, ${bg} 90%, white)` : `color-mix(in srgb, ${bg} 35%, white)`;
    return `
:root { color-scheme: ${dark ? "dark" : "light"};
  --bg: ${bg}; --card: ${card}; --text: ${fg}; --muted: color-mix(in srgb, ${fg} 62%, ${bg});
  --border: ${border}; --line: color-mix(in srgb, ${fg} 8%, ${bg});
  --accent: ${accent}; --accent-dark: color-mix(in srgb, ${accent} ${dark ? 60 : 78}%, ${dark ? "white" : "black"});
  --accent-soft: color-mix(in srgb, ${accent} ${dark ? 24 : 14}%, ${card});
  --shadow: 0 1px 3px color-mix(in srgb, ${fg} 14%, transparent);
  --ok-soft: color-mix(in srgb, #2f9e6b ${dark ? 22 : 14}%, ${card});
}
input[type=text], input[type=number], input[type=search], select, textarea, button, .card, .lang,
.srccard, .preview, .step, .cList { background-color: var(--card); color: var(--text); }
body { background: var(--bg); }
button:hover { background-color: var(--accent-soft); }
button.primary { background-color: var(--accent); color: ${dark ? "#08111F" : "#fff"}; }
.mainnav button, .mainnav button.active { background-color: transparent; }
.mainnav button.active { color: var(--accent); }
.cList, .folders, .books, .mList { background-color: var(--card); }
.card.merged { background-color: var(--ok-soft); border-color: color-mix(in srgb, #2f9e6b 45%, var(--border)); }
textarea, .folders { scrollbar-color: var(--border) var(--card); }
.av { box-shadow: 0 0 0 2px var(--card); }
`;
  };
  function hexToRgb(h) {
    const n = parseInt(h.slice(1, 7), 16);
    return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`;
  }
  async function apply() {
    try {
      const theme = await api.theme.getCurrent();
      let el = document.getElementById(STYLE_ID);
      if (!el) {
        el = document.createElement("style");
        el.id = STYLE_ID;
        document.head.append(el);
      }
      el.textContent = css(theme && theme.colors);
    } catch (e) {
      console.error("Nova-Contact Theme:", e);
    }
  }
  apply();
  try { api.theme.onUpdated.addListener(apply); } catch (e) {}
})();
