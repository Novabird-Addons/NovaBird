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
  aiEnabled: false,
  colors: { bg: "#EEF2F8", fg: "#1B2433", border: "#D2DAE6", accent: "#2F6BD8" },
  mainColors: { light: {}, dark: {} }, // geänderte Farben des Hauptfensters (nur was vom Theme abweicht), je Hell/Dunkel
  fontFamily: "", fontRow: 100, fontPad: 100, // Schriftart, Zeilenhöhe und -abstand im Hauptfenster
  fontCompose: 100, fontSubject: 100, fontLabels: 100, fontSample: 100, // Verfassen-Fenster (Prozent der bisherigen Größe)
  fontSettings: 100, fontContact: 100, // Einstellungen/Konten, Nova-Contact
  screenEnabled: false, screenFhd: 100, screenQhd: 125, screenUhd: 150, // Screen Scaling (experimentell): Skalierung in Prozent je Auflösung
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

// Farben und Schrift des Hauptfensters (Reiter "Farben und Schrift"); Farben nur im Modus "Eigene Farben", Schrift immer
async function applyMain(s) {
  const custom = s.colorMode === "custom";
  const pct = v => Math.min(200, Math.max(50, Number(v) || 100));
  await messenger.settingsRedesign.setMainStyle({
    colors: custom ? s.mainColors : { light: {}, dark: {} },
    family: s.fontFamily || "",
    rowPct: pct(s.fontRow),
    padPct: pct(s.fontPad),
  });
}

async function applyFonts(s) {
  const f = v => Math.min(200, Math.max(50, Number(v) || 100)) / 100;
  await messenger.settingsRedesign.setFonts({ fe: f(s.fontSettings), fp: f(s.fontCompose), sub: f(s.fontSubject), lab: f(s.fontLabels), sample: f(s.fontSample) });
}

const applyScreen = s => messenger.screenScale.setConfig(s.screenEnabled === true, s.screenFhd, s.screenQhd, s.screenUhd);

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
  await safe("KI-Knopf", () => messenger.settingsRedesign.setAiButton(s.aiEnabled === true));
  await safe("Schriftgrößen", () => applyFonts(s));
  await safe("Hauptfenster-Stil", () => applyMain(s));
  await safe("Screen Scaling", () => applyScreen(s));
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
  await safe("Hauptfenster-Stil", async () => applyMain(await messenger.storage.local.get(DEFAULTS))); // jetzt ist das Hauptfenster sicher da (Zeilenhöhe)
  console.log("NovaBird-Extension: gestartet");
})();

// KI-Zusammenfassung: Ollama lehnt Anfragen mit dem Absender „moz-extension://…“ ab (403, OLLAMA_ORIGINS). Bei Anfragen
// unserer eigenen Seiten an den eigenen Rechner wird der Origin-Kopf deshalb weggelassen; der Nutzer muss nichts einstellen.
const OWN_PAGES = messenger.runtime.getURL("");
messenger.webRequest.onBeforeSendHeaders.addListener(
  details => {
    if (!(details.originUrl || "").startsWith(OWN_PAGES)) {
      return {};
    }
    return { requestHeaders: details.requestHeaders.filter(h => h.name.toLowerCase() !== "origin") };
  },
  { urls: ["http://localhost/*", "http://127.0.0.1/*"] },
  ["blocking", "requestHeaders"]
);

// NovaBird-Conversation: Knopf „Zusammenfassen (KI)“ nur anbieten, wenn die KI eingerichtet ist; die Zusammenfassung öffnet hier
const CONVERSATION_ID = "novabird-conversation@novabird";
messenger.runtime.onMessageExternal.addListener(async (message, sender) => {
  if (sender?.id !== CONVERSATION_ID) {
    return undefined;
  }
  if (message?.type === "aiAvailable") {
    const c = await messenger.storage.local.get({ aiEnabled: false, aiUrl: "", aiModel: "" });
    return { available: Boolean(c.aiEnabled && c.aiUrl && c.aiModel) };
  }
  if (message?.type === "summarize" && Array.isArray(message.ids) && message.ids.length <= 120 && message.ids.every(Number.isInteger)) {
    await messenger.windows.create({
      url: messenger.runtime.getURL(`ai/popup.html?ids=${message.ids.join(",")}`),
      type: "popup",
      width: 640,
      height: 640,
    });
    return true;
  }
  return undefined;
});

// Diagnose für die Optionsseite
messenger.runtime.onMessage.addListener(async message => {
  if (message?.type === "openRules") {
    await safe("Regel-Assistent öffnen", () => openRuleWizard(null));
    return true;
  }
  if (message?.type === "themeColors") {
    try {
      return await messenger.settingsRedesign.getThemeColors();
    } catch (e) {
      console.error("NovaBird-Extension: Theme-Farben", e);
      return null;
    }
  }
  if (message?.type === "screenInfo") {
    try {
      return await messenger.screenScale.getInfo();
    } catch (e) {
      return null;
    }
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
  if (keys.includes("aiEnabled")) {
    safe("KI-Knopf", () => messenger.settingsRedesign.setAiButton(s.aiEnabled === true));
  }
  if (keys.includes("rulesEnabled")) {
    safe("Regel-Assistent", () => messenger.mailRules.setEnabled(s.rulesEnabled === true, ruleMenuLabel()));
  }
  if (keys.some(k => k.startsWith("list"))) {
    safe("Nachrichtenliste", () => applyList(s));
  }
  if (keys.some(k => ["colorMode", "mainColors", "fontFamily", "fontRow", "fontPad"].includes(k))) {
    safe("Hauptfenster-Stil", () => applyMain(s));
  }
  if (keys.some(k => ["fontSettings", "fontCompose", "fontSubject", "fontLabels", "fontSample"].includes(k))) {
    safe("Schriftgrößen", () => applyFonts(s));
  }
  if (keys.some(k => k.startsWith("screen"))) {
    safe("Screen Scaling", () => applyScreen(s));
  }
  if (keys.includes("colorMode") || keys.includes("colors")) {
    safe("Kalenderfarben", () => messenger.novaCalendar.setColors(colors));
    safe("Einstellungsfarben", () => messenger.settingsRedesign.setColors(colors));
  }
});

// Selbsttest der Betterbird-Interna (shared/selftest-bg.js); Ergebnis zeigt die Optionsseite
nbStartSelfTest([() => messenger.messageList.selfTest(), () => messenger.novaContact.selfTest(), () => messenger.mailRules.selfTest(), () => messenger.mailStats.selfTest()]);

messenger.mailRules.onCreateFromMessage.addListener(info => safe("Regel-Assistent öffnen", () => openRuleWizard(info)));

// ---- Online-Updates (Reiter „Online-Updates“, standardmäßig aus) --------------------------------------------------------
// Beim Start höchstens einmal in 20 Stunden: Kanal-Datei lesen; „nur anzeigen“ meldet die Updates, „automatisch“ installiert sie.
const UPD_TEXT = {
  de: { title: "NovaBird-Updates", avail: "Updates verfügbar: $1. Klicken zum Anzeigen.", auto: "Wird aktualisiert: $1. Danach Thunderbird neu starten." },
  en: { title: "NovaBird updates", avail: "Updates available: $1. Click to show.", auto: "Updating: $1. Restart Thunderbird afterwards." },
  fr: { title: "Mises à jour NovaBird", avail: "Mises à jour disponibles : $1. Cliquer pour afficher.", auto: "Mise à jour : $1. Redémarrez Thunderbird ensuite." },
  es: { title: "Actualizaciones de NovaBird", avail: "Actualizaciones disponibles: $1. Haga clic para verlas.", auto: "Actualizando: $1. Reinicie Thunderbird después." },
};
const updText = () => UPD_TEXT[(messenger.i18n.getUILanguage() || "en").slice(0, 2).toLowerCase()] ?? UPD_TEXT.en;
const UPD_NOTE = "novabird-updates";

async function updatesOnStart() {
  const s = await messenger.storage.local.get(nbUpdates.DEFAULTS);
  if (!s.updatesEnabled || !s.updatesOnStart || Date.now() - (s.updatesLastCheck || 0) < 20 * 3600e3) {
    return;
  }
  await messenger.storage.local.set({ updatesLastCheck: Date.now() });
  const res = await nbUpdates.check(s.updatesChannel, s.updatesManaged);
  const todo = nbUpdates.pending(res.rows);
  if (!todo.length) {
    return;
  }
  const names = todo.map(r => `${r.name} ${r.available}`).join(", ");
  const tx = updText();
  const auto = s.updatesMode === "auto";
  await messenger.notifications.create(UPD_NOTE, { type: "basic", iconUrl: "icons/icon-96.png", title: tx.title, message: (auto ? tx.auto : tx.avail).replace("$1", names) });
  if (auto) {
    await nbUpdates.apply(todo);
  }
}

messenger.notifications.onClicked.addListener(id => {
  if (id === UPD_NOTE) {
    messenger.runtime.openOptionsPage().catch(() => {});
  }
});
setTimeout(() => updatesOnStart().catch(e => console.warn("NovaBird-Extension: Online-Updates", e)), 20000);
