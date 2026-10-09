/* NovaBird-Extension – startet die Experimente und gibt die Einstellungen weiter. */
"use strict";

const DEFAULTS = {
  attachPane: true,
  paneLayout: "nova",
  agendaDays: 5,
  colorMode: "theme",
  pilotEnabled: true,
  pilotLog: false,
  previewEnabled: true,
  previewDelay: 400,
  colors: { bg: "#EEF2F8", fg: "#1B2433", border: "#D2DAE6", accent: "#2F6BD8" },
};

// Jeder Schritt einzeln abgesichert: ein Fehler im einen Teil darf den anderen nicht verhindern.
async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`NovaBird-Extension: ${label}`, e);
  }
}

async function applySettings() {
  const s = await messenger.storage.local.get(DEFAULTS);
  const colors = s.colorMode === "custom" ? s.colors : null;
  await safe("Leistenlayout", () => messenger.novaCalendar.setPaneLayout(s.paneLayout === "default" ? "default" : "nova"));
  await safe("Tage voraus", () => messenger.novaCalendar.setAgendaDays(s.agendaDays));
  await safe("Kalenderfarben", () => messenger.novaCalendar.setColors(colors));
  await safe("Anhänge-Bereich", () => messenger.novaCalendar.setAttachPane(s.attachPane !== false));
  await safe("Einstellungsfarben", () => messenger.settingsRedesign.setColors(colors));
  await safe("Nova-Contact Protokoll", () => messenger.novaContact.setLog(s.pilotLog));
  await safe("Nova-Contact", () => messenger.novaContact.setEnabled(s.pilotEnabled !== false));
  await safe("Vorschau Verzögerung", () => messenger.attachPreview.setDelay(s.previewDelay));
  await safe("Vorschau", () => messenger.attachPreview.setEnabled(s.previewEnabled !== false));
}

(async () => {
  await safe("Einstellungen lesen", applySettings);
  await safe("Kalender starten", () => messenger.novaCalendar.start());
  await safe("Einstellungsseiten starten", async () => {
    // Die Stylesheets lädt das Add-on selbst; das Experiment kann moz-extension-Dateien nicht lesen.
    const css = {};
    for (const n of ["shell", "prefs", "account", "frame", "compose", "addons"]) {
      css[n] = await (await fetch(messenger.runtime.getURL(`css/${n}.css`))).text();
    }
    await messenger.settingsRedesign.start(css);
  });
  console.log("NovaBird-Extension: gestartet");
})();

// Diagnose für die Optionsseite
messenger.runtime.onMessage.addListener(async message => {
  if (message?.type === "status") {
    try {
      return await messenger.novaCalendar.getStatus();
    } catch (e) {
      return `Fehler: ${e}`;
    }
  }
  return undefined;
});

messenger.storage.onChanged.addListener(async changes => {
  if (changes.resetTick) {
    safe("Teiler zurücksetzen", () => messenger.novaCalendar.resetAttachHeight());
  }
  const keys = Object.keys(changes).filter(k => k !== "resetTick");
  if (!keys.length) {
    return;
  }
  const s = await messenger.storage.local.get(DEFAULTS);
  const colors = s.colorMode === "custom" ? s.colors : null;
  if (keys.includes("paneLayout")) {
    safe("Leistenlayout", () => messenger.novaCalendar.setPaneLayout(s.paneLayout === "default" ? "default" : "nova"));
  }
  if (keys.includes("agendaDays")) {
    safe("Tage voraus", () => messenger.novaCalendar.setAgendaDays(s.agendaDays));
  }
  if (keys.includes("attachPane")) {
    safe("Anhänge-Bereich", () => messenger.novaCalendar.setAttachPane(s.attachPane !== false));
  }
  if (keys.includes("pilotLog")) {
    safe("Nova-Contact Protokoll", () => messenger.novaContact.setLog(s.pilotLog));
  }
  if (keys.includes("pilotEnabled")) {
    safe("Nova-Contact", () => messenger.novaContact.setEnabled(s.pilotEnabled !== false));
  }
  if (keys.includes("previewDelay")) {
    safe("Vorschau Verzögerung", () => messenger.attachPreview.setDelay(s.previewDelay));
  }
  if (keys.includes("previewEnabled")) {
    safe("Vorschau", () => messenger.attachPreview.setEnabled(s.previewEnabled !== false));
  }
  if (keys.includes("colorMode") || keys.includes("colors")) {
    safe("Kalenderfarben", () => messenger.novaCalendar.setColors(colors));
    safe("Einstellungsfarben", () => messenger.settingsRedesign.setColors(colors));
  }
});
