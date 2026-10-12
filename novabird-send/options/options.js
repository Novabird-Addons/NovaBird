"use strict";

// Texte aus _locales einsetzen (Sprache bestimmt Betterbird)
for (const el of document.querySelectorAll("[data-i18n]")) {
  el.textContent = messenger.i18n.getMessage(el.dataset.i18n);
}

// Hinweis, wenn Funktionen wegen fehlender Betterbird-Interna aus sind (Selbsttest, shared/selftest-ui.js)
nbShowSelfTest(document.getElementById("nb-selftest"), (key, subs) => messenger.i18n.getMessage(key, subs));

document.getElementById("version").textContent = messenger.i18n.getMessage("optVersion", [
  messenger.runtime.getManifest().version,
]);

const fields = Object.keys(SETTINGS_DEFAULTS);
const saved = document.getElementById("saved");
const stage = document.getElementById("stage");
const mock = document.getElementById("mock");
const SCALES = { small: 0.85, normal: 1, large: 1.25, xlarge: 1.5 };
const PALETTE_VARS = {
  bg: "--sp-bg", fg: "--sp-fg", muted: "--sp-muted", border: "--sp-border", accent: "--sp-accent",
  track: "--sp-track", undo: "--sp-undo", onAccent: "--sp-on-accent", onUndo: "--sp-on-undo",
};
let hideTimer = null;

function readForm() {
  const raw = {};
  for (const key of fields) {
    const input = document.getElementById(key);
    raw[key] = input.type === "checkbox" ? input.checked : input.value;
  }
  return sanitizeSettings(raw);
}

function writeForm(settings) {
  for (const key of fields) {
    const input = document.getElementById(key);
    if (input.type === "checkbox") {
      input.checked = settings[key];
    } else {
      input.value = settings[key];
    }
  }
}

const COLOR_KEYS = ["colorBg", "colorFg", "colorAccent", "colorUndo"];
const HEX = /^#[0-9a-f]{6}$/i;
const colorMode = document.getElementById("colorMode");

// Eine Farbe zu ändern schaltet automatisch auf „Eigene Farben“ um
function markCustom() {
  if (colorMode.value !== "custom") {
    colorMode.value = "custom";
  }
}

// Farbfelder bleiben immer bedienbar; abgeblendet, wenn sie gerade nicht wirken
function updateDim(settings) {
  const custom = settings.colorMode === "custom";
  for (const row of document.querySelectorAll(".color-row")) {
    row.classList.toggle("dim", !custom);
  }
  document.getElementById("rowUndoColor").classList.toggle("dim", !custom || settings.undoTone !== "red");
}

function syncHexFields() {
  for (const key of COLOR_KEYS) {
    document.getElementById(`${key}Hex`).value = document.getElementById(key).value;
  }
}

// Vorschau neu zeichnen: Farben kommen vom Hintergrundskript (kennt die Theme-Farben)
let renderToken = 0;
async function refreshPreview() {
  const token = ++renderToken;
  const settings = readForm();
  updateDim(settings);
  let palette;
  try {
    palette = await messenger.runtime.sendMessage({ type: "palette", settings });
  } catch (e) {
    palette = null;
  }
  if (token !== renderToken) {
    return; // inzwischen neuere Eingabe
  }
  palette = palette || resolvePalette(null, settings);
  for (const [key, cssVar] of Object.entries(PALETTE_VARS)) {
    mock.style.setProperty(cssVar, palette[key]);
  }
  mock.style.setProperty("--sp-track-h", `${settings.barHeight + (settings.barStyle === "soft" ? 4 : 0)}px`);
  mock.className = settings.barStyle;
  const bar = mock.querySelector(".bar");
  bar.style.opacity = settings.barStyle === "soft" ? String(0.15 + 0.85 * 0.62) : "";
  mock.style.zoom = String(SCALES[settings.size]);
  stage.dataset.h = settings.horizontal;
}

async function save(settings) {
  await messenger.storage.local.set(settings);
  saved.style.visibility = "visible";
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => (saved.style.visibility = "hidden"), 1500);
}

async function showInMainWindow() {
  await messenger.runtime.sendMessage({ type: "preview" });
}

(async () => {
  writeForm(sanitizeSettings(await messenger.storage.local.get(SETTINGS_DEFAULTS)));
  syncHexFields();
  await refreshPreview();
})();

for (const key of fields) {
  const input = document.getElementById(key);
  const isColor = COLOR_KEYS.includes(key);
  // Farbwähler liefern beim Ziehen laufend „input“: nur die Vorschau mitführen, gespeichert wird bei „change“
  input.addEventListener("input", () => {
    if (isColor) {
      markCustom();
      syncHexFields();
    }
    refreshPreview();
  });
  input.addEventListener("change", async () => {
    if (isColor) {
      markCustom();
    }
    const settings = readForm();
    writeForm(settings); // ungültige Eingaben auf den erlaubten Bereich zurücksetzen
    syncHexFields();
    await save(settings);
    await refreshPreview();
  });
}

// Hex-Felder als Ersatz, falls sich der Farbwähler des Systems nicht öffnet
for (const key of COLOR_KEYS) {
  const color = document.getElementById(key);
  const hex = document.getElementById(`${key}Hex`);
  hex.addEventListener("input", () => {
    if (HEX.test(hex.value)) {
      color.value = hex.value.toLowerCase();
      color.dispatchEvent(new Event("input"));
    }
  });
  hex.addEventListener("change", () => {
    if (HEX.test(hex.value)) {
      color.value = hex.value.toLowerCase();
      color.dispatchEvent(new Event("change"));
    } else {
      hex.value = color.value; // ungültig: alten Wert wiederherstellen
    }
  });
}

document.getElementById("preview").addEventListener("click", showInMainWindow);

document.getElementById("reset").addEventListener("click", async () => {
  writeForm({ ...SETTINGS_DEFAULTS });
  syncHexFields();
  await save({ ...SETTINGS_DEFAULTS });
  await refreshPreview();
});
