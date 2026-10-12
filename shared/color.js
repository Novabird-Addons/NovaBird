/* NovaBird – gemeinsame Farbrechnung (Quelle: Source/shared/color.js; build.sh packt sie als shared/color.js ins Paket).
 * Klassisches Skript ohne Abhängigkeiten: in Hintergrund-/Optionsseiten per <script>/manifest, in Experimenten per
 * Services.scriptloader.loadSubScript, in Node-Tests per vm. Definiert nur Funktionen (globale Namen nb*), keine Seiteneffekte.
 */
"use strict";

/** Versteht #rrggbb(aa), rgb()/rgba() und color(srgb r g b) (so liefert Gecko berechnete Farben). Liefert [r, g, b] (0..255) oder null. */
function nbParseColor(input) {
  const s = String(input ?? "").trim().toLowerCase();
  let m = s.match(/^#([0-9a-f]{6})(?:[0-9a-f]{2})?$/);
  if (m) {
    return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  }
  m = s.match(/^rgba?\(\s*(-?[\d.]+)[\s,]+(-?[\d.]+)[\s,]+(-?[\d.]+)/);
  if (m) {
    return [m[1], m[2], m[3]].map(v => Math.round(Number(v)));
  }
  // color(srgb 0.1 0.2 0.3 / a): Werte 0..1 (neuere Gecko-Versionen, z. B. bei color-mix())
  m = s.match(/^color\(\s*[a-z0-9-]+\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/);
  if (m) {
    return [m[1], m[2], m[3]].map(v => Math.round(Number(v) * 255));
  }
  return null;
}

function nbToHex(rgb) {
  return "#" + rgb.map(v => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0")).join("");
}

/** Relative Leuchtdichte nach WCAG (0..1). */
function nbLuminance(rgb) {
  const [r, g, b] = rgb.map(v => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Kontrastverhältnis nach WCAG (1..21). */
function nbContrast(a, b) {
  const [hi, lo] = [nbLuminance(a), nbLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Anteil t der Farbe a über Farbe b. */
function nbMix(a, b, t) {
  return a.map((v, i) => v * t + b[i] * (1 - t));
}

/** Wahrgenommene Helligkeit 0..255 (einfache Gewichtung, für die Hell/Dunkel-Entscheidung). */
function nbBrightness(rgb) {
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2];
}

/** Dunkle Farbe? Unlesbare Angaben gelten als hell. */
function nbIsDark(color) {
  const rgb = Array.isArray(color) ? color : nbParseColor(color);
  return rgb ? nbBrightness(rgb) < 128 : false;
}
