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
  listStyle: "default",
  listPreview: true,
  listAvatars: true,
  listDensity: "airy",
  listAcct: "none",
  listScroll: true,
  listAcctColors: {},
  rulesEnabled: false,
  colors: { bg: "#EEF2F8", fg: "#1B2433", border: "#D2DAE6", accent: "#2F6BD8" },
};

const ACCT_PALETTE = ["#378ADD", "#1D9E75", "#D85A30", "#7F77DD", "#BA7517", "#D4537E", "#0F6E56", "#888780"];

// Kontofarben: gespeicherte Wahl, sonst Palette nach Reihenfolge der Konten (Optionsseite nutzt dieselbe Regel)
async function accountColors(s) {
  const out = {};
  try {
    const list = await messenger.accounts.list(false);
    list.forEach((a, i) => { out[a.id] = (s.listAcctColors || {})[a.id] || ACCT_PALETTE[i % ACCT_PALETTE.length]; });
  } catch (e) { /* ohne Kontofarben */ }
  return JSON.stringify(out);
}

async function applyList(s) {
  await messenger.messageList.setOptions(s.listStyle, s.listPreview !== false, s.listAvatars !== false,
    ["normal", "compact"].includes(s.listDensity) ? s.listDensity : "airy",
    ["bar", "ring", "dot"].includes(s.listAcct) ? s.listAcct : "none", await accountColors(s), s.listScroll !== false);
}

// Jeder Schritt einzeln abgesichert: ein Fehler im einen Teil darf den anderen nicht verhindern.
async function safe(label, fn) {
  try {
    await fn();
  } catch (e) {
    console.error(`NovaBird-Extension: ${label}`, e);
  }
}

// Regel-Assistent (Beta, Opt-in): Menüeintrag in der Nachrichtenliste und Fenster rules/wizard.html
const RULE_MENU = {
  de: "Regel aus dieser Mail erstellen …",
  en: "Create rule from this mail …",
  fr: "Créer une règle à partir de ce message …",
  es: "Crear regla a partir de este correo …",
};
const ruleMenuLabel = () => RULE_MENU[(messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase()] ?? RULE_MENU.en;

async function openRuleWizard(info) {
  const query = info ? `?m=${encodeURIComponent(JSON.stringify(info))}` : "";
  await messenger.windows.create({ url: messenger.runtime.getURL(`rules/wizard.html${query}`), type: "popup", width: 780, height: 860 });
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
  await safe("Nachrichtenliste", () => applyList(s));
  await safe("Regel-Assistent", () => messenger.mailRules.setEnabled(s.rulesEnabled === true, ruleMenuLabel()));
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
  if (message?.type === "openRules") {
    await safe("Regel-Assistent öffnen", () => openRuleWizard(null));
    return true;
  }
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
  const keys = Object.keys(changes).filter(k => k !== "resetTick" && !k.startsWith("selfTest"));
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
  if (keys.includes("rulesEnabled")) {
    safe("Regel-Assistent", () => messenger.mailRules.setEnabled(s.rulesEnabled === true, ruleMenuLabel()));
  }
  if (keys.some(k => k.startsWith("list"))) {
    safe("Nachrichtenliste", () => applyList(s));
  }
  if (keys.includes("colorMode") || keys.includes("colors")) {
    safe("Kalenderfarben", () => messenger.novaCalendar.setColors(colors));
    safe("Einstellungsfarben", () => messenger.settingsRedesign.setColors(colors));
  }
});

// Selbsttest der Betterbird-Interna (shared/selftest-bg.js); Ergebnis zeigt die Optionsseite
nbStartSelfTest([() => messenger.messageList.selfTest(), () => messenger.novaContact.selfTest(), () => messenger.mailRules.selfTest(), () => messenger.mailStats.selfTest()]);

messenger.mailRules.onCreateFromMessage.addListener(info => safe("Regel-Assistent öffnen", () => openRuleWizard(info)));
