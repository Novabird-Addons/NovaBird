/* NovaBird-Send – gemeinsame Einstellungen und Farblogik (Hintergrundskript und Optionsseite). */
"use strict";

const SETTINGS_DEFAULTS = {
  delay: 10,            // Sekunden bis zum Versand (3–60)
  showNotices: true,    // Hinweis mit OK-Button, wenn Senden nicht möglich war
  size: "normal",       // Größe des Overlays: small | normal | large | xlarge
  horizontal: "center", // Position: left | center | right
  bottom: 10,           // Abstand vom unteren Rand in % der Fensterhöhe (0–40)
  barHeight: 10,        // Dicke des Zeitbalkens in px (4–20)
  barStyle: "soft",     // soft = weiche Ränder und Ausblenden (Standard), classic = einfarbig, hart
  colorMode: "theme",   // theme = Farben des Themes (Ordnerbereich), custom = eigene Farben
  colorBg: "#e6ecf5",   // eigene Farben (nur bei colorMode custom)
  colorFg: "#1e2838",
  colorAccent: "#2f6bd8",
  colorUndo: "#c9403d",
  undoTone: "red",      // red = „Rückgängig“ sanft rot, accent = in Akzentfarbe
};

// Rückfallwerte, falls sich die Theme-Farben nicht auslesen lassen
const FALLBACK_THEME = {
  light: { bg: "#e6ecf5", fg: "#1e2838", border: "#d2dae6", accent: "#2f6bd8" },
  dark: { bg: "#1d1e22", fg: "#dadde3", border: "#2a2c31", accent: "#5b9dff" },
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function sanitizeSettings(raw) {
  const clampInt = (value, min, max, fallback) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  };
  const oneOf = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);
  const color = (value, fallback) => (HEX_COLOR.test(value) ? value.toLowerCase() : fallback);
  const d = SETTINGS_DEFAULTS;
  const r = raw || {};
  return {
    delay: clampInt(r.delay, 3, 60, d.delay),
    showNotices: typeof r.showNotices === "boolean" ? r.showNotices : d.showNotices,
    size: oneOf(r.size, ["small", "normal", "large", "xlarge"], d.size),
    horizontal: oneOf(r.horizontal, ["left", "center", "right"], d.horizontal),
    bottom: clampInt(r.bottom, 0, 40, d.bottom),
    barHeight: clampInt(r.barHeight, 4, 20, d.barHeight),
    barStyle: oneOf(r.barStyle, ["soft", "classic"], d.barStyle),
    colorMode: oneOf(r.colorMode, ["theme", "custom"], d.colorMode),
    colorBg: color(r.colorBg, d.colorBg),
    colorFg: color(r.colorFg, d.colorFg),
    colorAccent: color(r.colorAccent, d.colorAccent),
    colorUndo: color(r.colorUndo, d.colorUndo),
    undoTone: oneOf(r.undoTone, ["red", "accent"], d.undoTone),
  };
}

// ---------- Farben ----------

// Versteht #rrggbb, rgb()/rgba() und color(srgb r g b) (so liefert Gecko berechnete Farben).
function parseColor(input) {
  const s = String(input ?? "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{6})$/);
  if (m) {
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  }
  m = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (m) {
    return [m[1], m[2], m[3]].map(v => Math.round(Number(v)));
  }
  m = s.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (m) {
    return [m[1], m[2], m[3]].map(v => Math.round(Number(v) * 255));
  }
  return null;
}

function toHex(rgb) {
  return "#" + rgb.map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

function luminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// Anteil t der Farbe a über Farbe b
function mix(a, b, t) {
  return a.map((v, i) => v * t + b[i] * (1 - t));
}

const LIGHT_TEXT = [255, 255, 255];
const DARK_TEXT = [16, 21, 31];

// Text auf einem Untergrund: die beste von Weiß oder Fast-Schwarz
function textOn(bg) {
  return contrast(LIGHT_TEXT, bg) >= contrast(DARK_TEXT, bg) ? LIGHT_TEXT : DARK_TEXT;
}

// Gewünschte Schriftfarbe behalten, wenn sie gut lesbar ist, sonst auf Hell/Dunkel wechseln
function readable(fg, bg, minRatio = 4.5) {
  return contrast(fg, bg) >= minRatio ? fg : textOn(bg);
}

/**
 * Berechnet die fertige Farbpalette (alles #rrggbb) aus den Theme-Farben und den Einstellungen.
 * theme: { bg, fg, border, accent } in beliebiger CSS-Schreibweise (aus dem Experiment).
 */
function resolvePalette(theme, settings) {
  const s = sanitizeSettings(settings);
  const light = FALLBACK_THEME.light;
  const t = theme || {};
  const pick = (value, fallback) => parseColor(value) || parseColor(fallback);

  const custom = s.colorMode === "custom";
  const bg = custom ? parseColor(s.colorBg) : pick(t.bg, light.bg);
  const accent = custom ? parseColor(s.colorAccent) : pick(t.accent, light.accent);
  const fg = readable(custom ? parseColor(s.colorFg) : pick(t.fg, light.fg), bg);
  // Rahmen: eigene Farben → aus Text/Hintergrund gemischt; Theme → dessen Rahmenfarbe;
  // Theme ohne Rahmenfarbe → gemischt; gar kein Theme → Rückfallwert
  let border;
  if (custom) {
    border = mix(fg, bg, 0.18);
  } else if (parseColor(t.border)) {
    border = parseColor(t.border);
  } else if (parseColor(t.bg)) {
    border = mix(fg, bg, 0.18);
  } else {
    border = parseColor(light.border);
  }

  const dark = luminance(bg) < 0.35;
  let undo = accent;
  if (s.undoTone === "red") {
    undo = parseColor(custom ? s.colorUndo : dark ? "#f27b7b" : "#c9403d");
  }

  return {
    bg: toHex(bg),
    fg: toHex(fg),
    muted: toHex(mix(fg, bg, 0.62)),
    border: toHex(border),
    accent: toHex(accent),
    track: toHex(mix(accent, bg, 0.18)),
    undo: toHex(undo),
    onAccent: toHex(textOn(accent)),
    onUndo: toHex(textOn(undo)),
  };
}
