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

// Farbfunktionen (nbParseColor, nbContrast, nbMix …) aus shared/color.js (vorher geladen)

const LIGHT_TEXT = [255, 255, 255];
const DARK_TEXT = [16, 21, 31];

// Text auf einem Untergrund: die beste von Weiß oder Fast-Schwarz
function textOn(bg) {
  return nbContrast(LIGHT_TEXT, bg) >= nbContrast(DARK_TEXT, bg) ? LIGHT_TEXT : DARK_TEXT;
}

// Gewünschte Schriftfarbe behalten, wenn sie gut lesbar ist, sonst auf Hell/Dunkel wechseln
function readable(fg, bg, minRatio = 4.5) {
  return nbContrast(fg, bg) >= minRatio ? fg : textOn(bg);
}

/**
 * Berechnet die fertige Farbpalette (alles #rrggbb) aus den Theme-Farben und den Einstellungen.
 * theme: { bg, fg, border, accent } in beliebiger CSS-Schreibweise (aus dem Experiment).
 */
function resolvePalette(theme, settings) {
  const s = sanitizeSettings(settings);
  const light = FALLBACK_THEME.light;
  const t = theme || {};
  const pick = (value, fallback) => nbParseColor(value) || nbParseColor(fallback);

  const custom = s.colorMode === "custom";
  const bg = custom ? nbParseColor(s.colorBg) : pick(t.bg, light.bg);
  const accent = custom ? nbParseColor(s.colorAccent) : pick(t.accent, light.accent);
  const fg = readable(custom ? nbParseColor(s.colorFg) : pick(t.fg, light.fg), bg);
  // Rahmen: eigene Farben → aus Text/Hintergrund gemischt; Theme → dessen Rahmenfarbe;
  // Theme ohne Rahmenfarbe → gemischt; gar kein Theme → Rückfallwert
  let border;
  if (custom) {
    border = nbMix(fg, bg, 0.18);
  } else if (nbParseColor(t.border)) {
    border = nbParseColor(t.border);
  } else if (nbParseColor(t.bg)) {
    border = nbMix(fg, bg, 0.18);
  } else {
    border = nbParseColor(light.border);
  }

  const dark = nbLuminance(bg) < 0.35;
  let undo = accent;
  if (s.undoTone === "red") {
    undo = nbParseColor(custom ? s.colorUndo : dark ? "#f27b7b" : "#c9403d");
  }

  return {
    bg: nbToHex(bg),
    fg: nbToHex(fg),
    muted: nbToHex(nbMix(fg, bg, 0.62)),
    border: nbToHex(border),
    accent: nbToHex(accent),
    track: nbToHex(nbMix(accent, bg, 0.18)),
    undo: nbToHex(undo),
    onAccent: nbToHex(textOn(accent)),
    onUndo: nbToHex(textOn(undo)),
  };
}
